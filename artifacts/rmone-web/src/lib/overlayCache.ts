import { fetchHomeOverlay, type LiveOverlay } from "@/lib/homeLiveData";
import type { WindowKey } from "@/lib/roleHomeData";
import type { RolePersona } from "@/lib/roleResolver";
import { getBusinessRulesFingerprint } from "@/lib/businessRules";

// Code version — bump whenever a homeIntelligence formula change produces
// different computed values so the in-memory Map (which survives Vite HMR)
// gets a cache miss and the fresh fetch picks up the new formula.
// Exported so RoleHome can add it as a useEffect dep — when HMR fires with a
// new CODE_VER the effect dependency changes and re-runs the fetch automatically.
export const CODE_VER = "v40";

/* MEMORY-ONLY: overlay payloads are cached in the in-memory Map below and
 * NOTHING is persisted to localStorage. Customer requirement — no app data
 * may occupy browser storage (limited quota on customer machines; a full
 * quota once blocked the login token write entirely). The cache therefore
 * seeds instant renders for SPA navigation within one session; a full page
 * reload starts cold and refetches. */

// Tenant + username scope tag. Overlay payloads are per-user AND per-company:
// the same email can exist in two different tenants on one browser, so keying
// by username alone could leak one company's cached home data into the other.
// The tenant is read from the session store at call time — after login it is
// always set; before login the guards below (falsy username) skip caching.
function userScope(username: string | undefined): string {
  let tenant = "";
  try {
    tenant = (typeof window !== "undefined" ? window.localStorage.getItem("rmone_tenant") : "") ?? "";
  } catch { /* storage unavailable */ }
  return `${tenant.trim().toLowerCase()}:${(username ?? "").trim().toLowerCase()}`;
}

// Public snapshot of the scope tag. Callers capture this BEFORE starting a
// long overlay fetch and pass it to writeOverlayCache, which drops the write
// if the signed-in identity changed while the fetch was in flight (login as
// a different user/tenant in the same SPA session). Without this, a slow
// fetch started under tenant A could resolve after a switch to tenant B and
// cache A's data under B's key.
export function currentUserScope(username: string | undefined): string {
  return userScope(username);
}

// A business-rules CONTENT fingerprint is embedded in the key so that any
// admin change to thresholds (overCapacityPct, targetUtilizationPct, etc.)
// immediately produces a cache miss and triggers a fresh overlay fetch — no
// stale threshold values can survive a rule save.
export const overlayCacheKey = (
  role: RolePersona,
  windowKey: WindowKey,
  username: string | undefined,
) => `${CODE_VER}|${role}|${windowKey}|${userScope(username)}|br${getBusinessRulesFingerprint()}`;

export const overlayCache = new Map<
  string,
  { value: LiveOverlay; fetchedAt: number }
>();

// ── Last-SHOWN fallback slot ─────────────────────────────────────────────
// The exact cache key above embeds role + window + business-rules
// fingerprint, so a mount where any of those differ from the write-time
// values misses and the home page regresses to "Loading live data…" even
// though this user already saw a populated home seconds ago. Worse, a
// PARTIAL overlay (one source call failed once) is deliberately never
// written to the exact-key cache — so one transient 502 used to poison the
// whole session: every later visit refetched from scratch.
//
// This slot remembers the last overlay that was ACTUALLY RENDERED for this
// user (partial ones included — the user already saw that exact payload on
// screen, so re-showing it while revalidating is strictly no worse). It is
// used only as a seed when the exact key misses; the background refresh
// still runs on every mount and upgrades/replaces it.
//
// Key = CODE_VER + tenant:username scope. CODE_VER is embedded so a formula
// change still cold-starts (stale-math guarantee); tenant+user scope keeps
// the same no-cross-user/no-cross-tenant isolation as the main map.
//
// Deliberate tradeoff: the business-rules fingerprint is NOT in this key
// (fingerprint drift is one of the misses this slot exists to bridge), so
// for a few seconds after an admin saves new thresholds the seed may show
// pre-save numbers before the mandatory background revalidation replaces
// them. The exact-key cache retains the strict no-stale-thresholds key.
const lastShownCache = new Map<string, { value: LiveOverlay; fetchedAt: number }>();

const lastShownKey = (username: string | undefined) =>
  `${CODE_VER}|${userScope(username)}`;

/**
 * Record an overlay that RoleHome actually put on screen. Same identity
 * guards as writeOverlayCache; additionally requires real content
 * (generatedAt > 0 and at least one live sub-driver) so empty/failed
 * payloads can never become a seed.
 */
export function noteOverlayShown(
  username: string | undefined,
  value: LiveOverlay,
  scopeAtStart?: string,
): void {
  if (!username || value.generatedAt === 0 || Object.keys(value.liveSubs ?? {}).length === 0) return;
  try {
    const cur = (typeof window !== "undefined" ? window.localStorage.getItem("rmone_username") : "") ?? "";
    if (cur.trim().toLowerCase() !== username.trim().toLowerCase()) return;
  } catch { /* storage unavailable — fall through to scope check */ }
  if (scopeAtStart !== undefined && scopeAtStart !== userScope(username)) return;
  lastShownCache.set(lastShownKey(username), { value, fetchedAt: Date.now() });
}

/**
 * Read the last overlay this user saw on screen, for use as a seed when the
 * exact-key cache misses. TTL-guarded like readOverlayCache. May be a
 * partial overlay — callers always revalidate in the background.
 */
export function readFallbackOverlay(username: string | undefined): LiveOverlay | null {
  if (!username) return null;
  const hit = lastShownCache.get(lastShownKey(username));
  if (!hit) return null;
  return Date.now() - hit.fetchedAt < MAX_SEED_AGE_MS ? hit.value : null;
}

// Cap how old a cached payload may be before we ignore it as a seed. The
// overlay always revalidates in the background on every mount, so this only
// bounds how stale the instantly-shown seed can be — past this we show the
// loading state and wait for a fresh fetch rather than flashing ancient data.
// NOTE: any business-rules save or code deploy already forces a cache miss
// via the versioned cache key, so stale thresholds/formula data can never
// survive past a rule change regardless of this TTL.
const MAX_SEED_AGE_MS = 4 * 60 * 60 * 1000;

// Fast check: does ANY overlay cache entry exist for this user?
// Used only by the RoleHome lazy-init to decide whether to skip the
// loading skeleton on mount — the exact role/window/rules-version is
// resolved after auth settles, but we can confidently skip the splash
// if ANYTHING was cached for this username in this session.
export function hasAnyCachedOverlay(username: string | undefined): boolean {
  if (!username) return false;
  // Needle embeds the SAME tenant+user scope tag the writer uses, so entries
  // written for another tenant's identically-named user never count as a hit.
  const scoped = `|${userScope(username)}|`;
  for (const key of overlayCache.keys()) {
    if (key.includes(scoped)) return true;
  }
  // The last-shown fallback slot counts too: a user whose only in-session
  // payload was a partial overlay still SAW a populated home, so the
  // skeleton must not re-engage on their next visit. TTL-guarded so a
  // >4h-stale entry (which readFallbackOverlay would refuse to seed) can't
  // suppress the skeleton while providing no data.
  const shown = lastShownCache.get(lastShownKey(username));
  return shown != null && Date.now() - shown.fetchedAt < MAX_SEED_AGE_MS;
}

// Read the last good overlay for this context from the in-memory map
// (survives SPA navigation between pages within one session).
//
// Guard: we never read/write a cache bucket for an unresolved user
// (username falsy). Overlay data is per-user, so caching under an empty
// username could let one user briefly see a payload fetched for another.
export function readOverlayCache(
  role: RolePersona,
  windowKey: WindowKey,
  username: string | undefined,
): LiveOverlay | null {
  if (!username) return null;
  const key = overlayCacheKey(role, windowKey, username);
  const mem = overlayCache.get(key);
  if (!mem) return null;
  return Date.now() - mem.fetchedAt < MAX_SEED_AGE_MS ? mem.value : null;
}

// Cache a freshly fetched overlay in the memory map so later mounts within
// this session render instantly. No-op for an unresolved user (see
// readOverlayCache guard). Nothing is persisted to browser storage.
export function writeOverlayCache(
  role: RolePersona,
  windowKey: WindowKey,
  username: string | undefined,
  value: LiveOverlay,
  scopeAtStart?: string,
): void {
  // Never cache a failed/empty/partial overlay. Guards:
  // 1. generatedAt === 0 → API still booting, nothing to cache
  // 2. liveSubs empty → overlay computed but has no sub-driver data; caching
  //    it would evict a previously-good entry and leave every sub-driver showing
  //    "NOT AVAILABLE YET" on subsequent page navigations until TTL expires.
  // 3. partial → one or more source calls failed, so the computed signals are
  //    incomplete (e.g. "1 of 4 signals" with only Open Positions). Caching
  //    it would pin misleading numbers to the home page for the full seed TTL.
  if (!username || value.generatedAt === 0 || value.partial === true || Object.keys(value.liveSubs ?? {}).length === 0) return;
  // Identity-switch guards — a fetch that started under one signed-in
  // identity must never cache its payload under another's key.
  // (a) The user whose data this is must still be the signed-in user.
  try {
    const cur = (typeof window !== "undefined" ? window.localStorage.getItem("rmone_username") : "") ?? "";
    if (cur.trim().toLowerCase() !== username.trim().toLowerCase()) return;
  } catch { /* storage unavailable — fall through to (b) */ }
  // (b) When the caller captured the scope at fetch start, the tenant must
  //     not have changed either (covers the same-email-two-tenants case).
  if (scopeAtStart !== undefined && scopeAtStart !== userScope(username)) return;
  const key = overlayCacheKey(role, windowKey, username);
  overlayCache.set(key, { value, fetchedAt: Date.now() });
  // A complete cached overlay is also the best "last shown" seed.
  lastShownCache.set(lastShownKey(username), { value, fetchedAt: Date.now() });
}

export async function warmOverlayCache(
  role: RolePersona,
  windowKey: WindowKey,
  username: string | undefined,
): Promise<void> {
  const key = overlayCacheKey(role, windowKey, username);
  const hit = overlayCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < 60_000) return;
  // Capture the identity scope before the (potentially long) fetch so the
  // write is dropped if the user/tenant changed while it was in flight.
  const scopeAtStart = userScope(username);
  try {
    const value = await fetchHomeOverlay(role, windowKey, { username });
    writeOverlayCache(role, windowKey, username, value, scopeAtStart);
  } catch {
    /* best-effort prewarm; alerts page will retry on mount */
  }
}
