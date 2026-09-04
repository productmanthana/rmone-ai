/**
 * Shared in-memory state for the financial analytics cache.
 *
 * Extracted into its own lib module so both analytics.ts (the HTTP route that
 * reads/computes the cache) and pipeline.ts (the import path that writes
 * allocation rows) can call bustFinancialCache without creating a circular
 * import between lib/ and routes/.
 *
 * All Maps are module singletons — one set per worker process, which is exactly
 * the per-worker cache isolation the bust + IPC pattern depends on.
 */

/** Opaque payload shape stored per tenant. The analytics route imports
 *  FinancialAnalyticsCore and extends it with generatedAt; we use `unknown`
 *  here to keep this module free of analytics-domain types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface FinCacheEntry {
  payload: unknown;
  exp: number;       // fresh until (ms epoch)
  staleExp: number;  // usable as stale-if-error until (ms epoch)
}

export const finCache    = new Map<string, FinCacheEntry>();
export const finInflight = new Map<string, Promise<unknown>>();
/** Records the timestamp of the last bustFinancialCache call per tenant.
 *  Prevents a post-bust in-flight fetch from writing its pre-bust results back
 *  into finCache after the Map entry was already cleared. */
export const finBustAt   = new Map<string, number>();

/** Allocation-data dirty markers, stamped by bustFinancialCache — every caller
 *  of that bust is an allocation or flag mutation, and the IPC bust fan-out
 *  runs it in every worker, so each worker's marker tracks its own view.
 *  Read by the alerts feed (routes/alerts.ts) to decide whether today's AI
 *  escalation cards may be stale and need a fingerprint re-check. */
export const allocDirtyAt = new Map<string, number>();
export function allocationsDirtyAt(tid: string): number {
  return allocDirtyAt.get(tid) ?? 0;
}

/** Drop one tenant's financial analytics cache entry immediately.
 *  Called by:
 *   • the IPC bust handler (sibling workers) — so every worker clears its own
 *     copy when allocation hours or NC flags change;
 *   • rmone-proxy.ts after saveWeeklyHours / setAllocationFlag (real-time path);
 *   • pipeline.ts after runPipeline (bulk-import path).
 *
 *  The bustAt timestamp ensures any in-flight computation that started before
 *  this bust discards its result rather than overwriting fresh data with stale
 *  results (same pattern as projectDetailBustAt / taskDataBustAt in
 *  rmone-proxy.ts — see the bust guard in computeForTenant in analytics.ts). */
export function bustFinancialCache(tid: string): void {
  finBustAt.set(tid, Date.now());
  finCache.delete(tid);
  finInflight.delete(tid);
  // The alerts feed watches this same choke point: stamp the allocation dirty
  // marker the AI-escalation freshness gate reads (see routes/alerts.ts).
  allocDirtyAt.set(tid, Date.now());
  // Recruitment analytics reads the same allocation rows — every write path
  // (and the IPC bust fan-out) that invalidates financial must invalidate it
  // too, or the recruitment page/hub tile serves pre-write numbers for 5 min.
  bustRecruitmentCache(tid);
}

/* ── recruitment analytics cache (same bust choke point) ───────────────────
 * Keys are `${tid}|${start}|${end}|${rulesFingerprint}` — prefix-delete by
 * tenant. The rules fingerprint (work week hours, working days, holidays)
 * lives in the KEY so a Settings change takes effect on the next request
 * without waiting out the TTL. */
export interface RecCacheEntry {
  payload: unknown;
  exp: number;      // fresh until (ms epoch)
  staleExp: number; // serve-stale-while-revalidating until (ms epoch)
}
export const recCache    = new Map<string, RecCacheEntry>();
export const recInflight = new Map<string, Promise<unknown>>();
/** Same post-bust write-guard pattern as finBustAt. */
export const recBustAt   = new Map<string, number>();

/* ── cross-worker recruitment payload sharing (adoptCache) ──────────────────
 * Same pattern as the projectDetail/projectTeam/taskData adoptCache flow in
 * rmone-proxy.ts: the worker that computed the payload broadcasts the RESULT,
 * siblings adopt it instead of re-running the 4-5s RDS fan-out per worker.
 * Helpers live HERE (leaf module) so analytics.ts can broadcast and
 * rmone-proxy.ts can adopt without a routes↔routes import cycle. */
const REC_ADOPT_MAX_JSON_BYTES = 1_500_000;
export const REC_CACHE_MAX = 200; // per-worker guard — keys include the date range

/** Bounded-memory eviction shared by the compute write path and IPC adoption:
 *  drop the entry closest to expiry (bounded memory beats exact LRU here). */
export function capRecCache(): void {
  if (recCache.size < REC_CACHE_MAX) return;
  let oldest: string | null = null, oldestExp = Infinity;
  for (const [k, v] of recCache) if (v.exp < oldestExp) { oldestExp = v.exp; oldest = k; }
  if (oldest) recCache.delete(oldest);
}

/** True when the payload is a healthy, non-empty recruitment result. Failure
 *  or empty shapes are never shared and never adopted (hollow-cache rule) —
 *  a genuinely empty tenant recomputes locally in milliseconds anyway. */
function isShareableRecPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const p = payload as { roles?: unknown; totals?: unknown; generatedAt?: unknown };
  return Array.isArray(p.roles) && p.roles.length > 0
    && !!p.totals && typeof p.totals === "object"
    && typeof p.generatedAt === "string";
}

/** Share a freshly computed recruitment payload with sibling workers. */
export function broadcastRecruitmentPayload(key: string, payload: unknown, exp: number, staleExp: number): void {
  if (!process.send) return; // single-process run — nobody to share with
  try {
    if (!isShareableRecPayload(payload)) return;
    const json = JSON.stringify(payload);
    if (!json || json.length > REC_ADOPT_MAX_JSON_BYTES) return;
    process.send({ type: "adoptCache", fn: "recruitment", key, json, expiresAt: exp, staleExpiresAt: staleExp, settledAt: Date.now() });
  } catch { /* worker shutting down or unserializable payload — skip */ }
}

/** Adopt a sibling worker's recruitment payload. Guards, in order: shape
 *  (fail-closed, never adopt emptiness/failure), post-bust staleness
 *  (+1s IPC skew slack), local in-flight wins, never downgrade a fresher
 *  local entry. */
export function adoptRecruitmentPayload(key: string, payload: unknown, exp: number, staleExp: number, settledAt: number): void {
  if (!isShareableRecPayload(payload)) return;
  const tid = key.split("|")[0] ?? "";
  if (!tid || settledAt <= (recBustAt.get(tid) ?? 0) + 1000) return;
  if (recInflight.has(key)) return;
  const hit = recCache.get(key);
  if (hit && hit.exp >= exp) return;
  capRecCache();
  recCache.set(key, { payload, exp, staleExp });
}

export function bustRecruitmentCache(tid: string): void {
  recBustAt.set(tid, Date.now());
  const prefix = `${tid}|`;
  for (const k of recCache.keys()) if (k.startsWith(prefix)) recCache.delete(k);
  for (const k of recInflight.keys()) if (k.startsWith(prefix)) recInflight.delete(k);
}
