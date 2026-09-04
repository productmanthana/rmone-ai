import type { UsageAnalytics } from "@/lib/api";

/* In-session seed cache for the Usage Analytics page — the same
 * stale-while-revalidate pattern as lib/overlayCache.ts: seed React state
 * from here on mount, paint instantly, always revalidate in the background.
 *
 * MEMORY-ONLY: nothing is persisted to localStorage/sessionStorage (customer
 * requirement — no app data may occupy browser storage). The cache therefore
 * makes SPA navigation back to the page instant within one session; a full
 * page reload relies on the server-side cluster cache instead. */

const MAX_SEED_AGE_MS = 4 * 60 * 60 * 1000; // past this, show the loading state and wait
const MAX_ENTRIES = 40; // one per (identity, date window) — tiny, but bound it anyway

const cache = new Map<string, { value: UsageAnalytics; fetchedAt: number }>();

/* Tenant + username scope tag. The payload is admin-scoped per tenant (or
 * superadmin cross-tenant), and the same email can exist in two tenants on
 * one browser — keying by window alone could flash one company's usage data
 * to the other. Guards below skip caching entirely for an unresolved user. */
function userScope(): { scope: string; ok: boolean } {
  let tenant = "";
  let user = "";
  try {
    tenant = (typeof window !== "undefined" ? window.localStorage.getItem("rmone_tenant") : "") ?? "";
    user = (typeof window !== "undefined" ? window.localStorage.getItem("rmone_username") : "") ?? "";
  } catch { /* storage unavailable */ }
  const t = tenant.trim().toLowerCase();
  const u = user.trim().toLowerCase();
  // BOTH parts must be resolved — an empty tenant with a username would put
  // the same email's two tenants into one shared bucket.
  return { scope: `${t}:${u}`, ok: t.length > 0 && u.length > 0 };
}

/** Capture the identity scope BEFORE starting a fetch; pass it to
 *  writeUsageSeed so a slow fetch that resolves after a login-as-someone-else
 *  can never cache the old identity's payload under the new key. */
export function currentUsageScope(): string {
  return userScope().scope;
}

const keyFor = (scope: string, start: string, end: string) => `${scope}|${start}|${end}`;

/** Last good payload for this identity + date window, or null. TTL-capped so
 *  ancient data never flashes; callers always revalidate in the background. */
export function readUsageSeed(start: string, end: string): UsageAnalytics | null {
  const { scope, ok } = userScope();
  if (!ok) return null; // never read a bucket for an unresolved user
  const hit = cache.get(keyFor(scope, start, end));
  if (!hit) return null;
  return Date.now() - hit.fetchedAt < MAX_SEED_AGE_MS ? hit.value : null;
}

/** Cache a freshly fetched payload. Failure/off/restricted shapes are never
 *  seeded — only real, previously-rendered telemetry may paint instantly. */
export function writeUsageSeed(
  start: string,
  end: string,
  value: UsageAnalytics | null,
  scopeAtStart?: string,
): void {
  if (!value || value.available !== true) return;
  const { scope, ok } = userScope();
  if (!ok) return;
  if (scopeAtStart !== undefined && scopeAtStart !== scope) return; // identity changed mid-fetch
  cache.set(keyFor(scope, start, end), { value, fetchedAt: Date.now() });
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

// Auth boundary: login, logout, and tenant switch all dispatch this event
// (see api.ts) — drop everything so no usage data survives an identity change.
if (typeof window !== "undefined") {
  window.addEventListener("rmone:authChanged", () => cache.clear());
}
