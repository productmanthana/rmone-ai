import { getStoredUser } from "@/lib/api";
import { memSeed } from "@/lib/memSeed";

/* =============================================================
   Forecast source-data cache (MEMORY-ONLY)

   The Forecast page's raw query payloads (utilization, allocations,
   demand, …) are cached per tenant+user so a return visit WITHIN the
   same session renders the charts instantly from the last good
   payload while React Query refetches fresh data in the background
   (staleTime already handles the revalidation).

   Customer requirement: no app data may occupy browser storage, so
   this cache lives in an in-memory store (memSeed) and vanishes on
   page reload — nothing is ever persisted to localStorage.

   Keys are tenant+user scoped BY CONSTRUCTION (never rely on
   clearing at login/logout): a different company or user signing in
   on the same browser reads/writes entirely different keys, so
   cross-tenant data can never leak through this cache.
   ============================================================= */

// Bump when a payload's cached shape changes so old entries miss.
const CODE_VER = "v1";

const PREFIX = `rmone:fc-src:${CODE_VER}:`;

// A cached payload older than this is ignored as a seed. The page always
// revalidates in the background, so this only bounds how stale the
// instantly-shown charts can be. Matches the Home overlay seed TTL.
const MAX_SEED_AGE_MS = 4 * 60 * 60 * 1000;

type Entry = { data: unknown; ts: number };

function scope(): string | null {
  const u = getStoredUser();
  if (!u) return null;
  return `${u.tenant.toLowerCase()}:${u.username.toLowerCase()}`;
}

function fullKey(name: string, sub?: string): string | null {
  const s = scope();
  if (!s) return null;
  return `${PREFIX}${s}:${name}${sub ? `:${sub}` : ""}`;
}

/** Read the last good payload for this query (undefined on miss/stale). */
export function readForecastSrc<T>(name: string, sub?: string): T | undefined {
  const key = fullKey(name, sub);
  if (!key) return undefined;
  try {
    const raw = memSeed.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Entry;
    if (!parsed || parsed.data == null) return undefined;
    if (Date.now() - parsed.ts > MAX_SEED_AGE_MS) return undefined;
    return parsed.data as T;
  } catch {
    return undefined;
  }
}

/** Cache a freshly fetched payload (in memory only). */
export function writeForecastSrc(name: string, sub: string | undefined, data: unknown): void {
  const key = fullKey(name, sub);
  if (!key || data == null) return;
  let raw: string;
  try {
    raw = JSON.stringify({ data, ts: Date.now() } satisfies Entry);
  } catch {
    return; // non-serializable — never throw into the caller
  }
  // Oversized payloads would balloon memory for one entry — skip.
  if (raw.length > 2_500_000) return;
  memSeed.setItem(key, raw);
}

/**
 * Fast check used by the Forecast page's loading-modal lazy init: if the
 * core payloads are cached for this tenant+user, the charts will render
 * instantly from placeholders and the modal can be skipped. Pass the
 * current utilization window sub-key so a new week (whose util entry
 * naturally misses) still shows the modal instead of a broken instant
 * render — the model cannot build without utilization rows.
 */
export function hasForecastSrcCache(utilSub?: string): boolean {
  if (readForecastSrc("alloc") === undefined) return false;
  if (readForecastSrc("demand") === undefined) return false;
  if (utilSub !== undefined && readForecastSrc("util", utilSub) === undefined) return false;
  return true;
}
