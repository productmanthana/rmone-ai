import {
  getInsightRows,
  upsertInsightRows,
  deleteInsightsByRecord,
  deleteInsightsByKind,
  pruneExpiredInsights,
} from "@workspace/db";

type Severity = "red" | "amber" | "green";

export interface InsightValue {
  severity: Severity;
  text: string;
}

// --- In-memory failover cache -----------------------------------------------
//
// Sits "in front of" `getInsightsWithStale` only for the failure path: every
// successful DB read populates this LRU, and a subsequent DB read that throws
// (transient pool error, DNS blip, brief Postgres restart) falls back to it
// instead of returning an empty hit map. That empty map is what triggers a
// full synchronous OpenAI regeneration for every record on the request, so
// avoiding it during a brief outage prevents a cost+latency stampede.
//
// Behaviour when the DB is healthy is unchanged: we still issue the same
// SELECT, return the same `{ fresh, stale }` shape, and only populate the
// LRU as a side-effect after the SELECT resolves. The LRU is only *consulted*
// when the SELECT throws.
//
// Sizing/TTL tradeoff:
//   * MEM_CACHE_MAX bounds memory use per replica. A typical card request
//     batches ~60 records and most users repeatedly hit a working set of a
//     few hundred records, so 5k entries comfortably covers active traffic
//     without growing unbounded.
//   * MEM_CACHE_TTL_MS bounds how long a value can be served from memory
//     after we last saw it in the DB. The DB row itself has its own TTL/SWR
//     window, but admins can `DELETE /card-insights/cache/...` to flush
//     entries before they expire — capping the in-memory copy short means a
//     deletion + DB outage can't cause us to serve a "deleted" insight for
//     long.
const MEM_CACHE_MAX = 5_000;
const MEM_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface MemEntry {
  value: InsightValue;
  /** Mirrors the DB row's `expires_at` so we can replicate fresh/stale partitioning. */
  expiresAt: number;
  /** Wall-clock time at which this in-memory copy itself becomes unusable. */
  memExpiresAt: number;
}

// Plain Map abused as an LRU: JS Maps preserve insertion order, so deleting
// + re-setting on access pushes hot keys to the back, and trimming from the
// front when oversized evicts the coldest keys.
const _memCache = new Map<string, MemEntry>();

function memCacheSet(key: string, entry: MemEntry): void {
  if (_memCache.has(key)) _memCache.delete(key);
  _memCache.set(key, entry);
  if (_memCache.size > MEM_CACHE_MAX) {
    // Evict oldest until we're back under the cap. A single oversize
    // typically triggers one eviction; the loop guards against future
    // changes that might insert in bulk.
    const overflow = _memCache.size - MEM_CACHE_MAX;
    let i = 0;
    for (const k of _memCache.keys()) {
      if (i++ >= overflow) break;
      _memCache.delete(k);
    }
  }
}

function memCacheGet(key: string, now: number): MemEntry | undefined {
  const entry = _memCache.get(key);
  if (!entry) return undefined;
  if (entry.memExpiresAt <= now) {
    _memCache.delete(key);
    return undefined;
  }
  // Touch for LRU ordering.
  _memCache.delete(key);
  _memCache.set(key, entry);
  return entry;
}

/** Test/ops hook: drop everything from the in-memory failover cache. */
export function _clearInsightsMemCache(): void {
  _memCache.clear();
}

/**
 * Drop every in-memory entry whose key starts with the given prefix.
 * Used by the invalidate paths so that an admin deletion still takes
 * effect on this replica even if the DB is briefly unreachable for the
 * very next read — otherwise the failover LRU would happily serve the
 * "deleted" value for up to MEM_CACHE_TTL_MS.
 */
function memCacheDeleteByPrefix(prefix: string): void {
  for (const k of _memCache.keys()) {
    if (k.startsWith(prefix)) _memCache.delete(k);
  }
}

export interface InsightCacheGetResult {
  /** Map of cache key -> live (non-expired) insight value. */
  hits: Map<string, InsightValue>;
}

export interface InsightCacheGetWithStaleResult {
  /** Map of cache key -> insight value whose `expiresAt` is still in the future. */
  fresh: Map<string, InsightValue>;
  /**
   * Map of cache key -> insight value whose `expiresAt` is in the past but
   * still within the configured grace window. Callers should serve these
   * immediately and schedule a background refresh ("stale-while-revalidate").
   */
  stale: Map<string, InsightValue>;
}

function isSeverity(s: string): s is Severity {
  return s === "red" || s === "amber" || s === "green";
}

/**
 * Look up a batch of cache keys. Only entries whose `expiresAt` is still in
 * the future are returned — anything stale is treated as a miss so the caller
 * regenerates it.
 */
export async function getInsights(
  keys: string[],
): Promise<InsightCacheGetResult> {
  const hits = new Map<string, InsightValue>();
  if (keys.length === 0) return { hits };

  const now = new Date();
  const rows = await getInsightRows(keys, now);

  for (const row of rows) {
    if (row.expiresAt <= now) continue;
    const sev = row.severity;
    if (!isSeverity(sev)) continue;
    hits.set(row.cacheKey, { severity: sev, text: row.text });
  }
  return { hits };
}

/**
 * Look up a batch of cache keys, partitioning the rows into:
 *   - `fresh` — `expiresAt` is still in the future. Use as-is.
 *   - `stale` — `expiresAt` is in the past, but no further than `graceMs`
 *               beyond it. Caller should serve immediately AND queue a
 *               background regeneration ("stale-while-revalidate").
 *
 * Anything older than `expiresAt + graceMs` (or rows that don't exist) are
 * absent from both maps and should be treated as a true miss by the caller —
 * i.e. regenerate synchronously, the same as before this method existed.
 *
 * `graceMs` of 0 makes this behave identically to `getInsights`.
 */
export async function getInsightsWithStale(
  keys: string[],
  graceMs: number,
): Promise<InsightCacheGetWithStaleResult> {
  const fresh = new Map<string, InsightValue>();
  const stale = new Map<string, InsightValue>();
  if (keys.length === 0) return { fresh, stale };

  const now = new Date();
  // Anything whose expiresAt is older than `graceCutoff` is past the grace
  // window and should be treated as a true miss — we filter those out at the
  // SQL layer rather than dragging them across the wire.
  const safeGraceMs = Math.max(0, graceMs);
  const graceCutoff = new Date(now.getTime() - safeGraceMs);
  let rows: Awaited<ReturnType<typeof getInsightRows>>;
  try {
    rows = await getInsightRows(keys, graceCutoff);
  } catch (e) {
    // DB unreachable: fall back to the in-memory failover cache so a brief
    // outage doesn't trigger a synchronous OpenAI regen for every record.
    // Anything not in memory is still a true miss — the caller will treat
    // those the same way they would have without this layer.
    const nowMs = now.getTime();
    let memHits = 0;
    for (const key of keys) {
      const entry = memCacheGet(key, nowMs);
      if (!entry) continue;
      if (entry.expiresAt > nowMs) {
        fresh.set(key, entry.value);
        memHits++;
      } else if (entry.expiresAt + safeGraceMs > nowMs) {
        stale.set(key, entry.value);
        memHits++;
      }
      // Else: in-memory copy is itself past the grace window, treat as miss.
    }
    console.log(
      `[insightsCache] DB read failed, served ${memHits}/${keys.length} from memory (degraded): ${String(e).slice(0, 200)}`,
    );
    return { fresh, stale };
  }

  const nowMs = now.getTime();
  const memExpiresAt = nowMs + MEM_CACHE_TTL_MS;
  for (const row of rows) {
    const sev = row.severity;
    if (!isSeverity(sev)) continue;
    const value: InsightValue = { severity: sev, text: row.text };
    const expiresAtMs = row.expiresAt.getTime();
    // Compare in JS so the partitioning is unambiguous even if the DB clock
    // and the app clock drift slightly between SELECTs.
    if (expiresAtMs > nowMs) {
      fresh.set(row.cacheKey, value);
    } else {
      stale.set(row.cacheKey, value);
    }
    // Mirror the row into the failover LRU. We refresh on every successful
    // read so the in-memory copy tracks the latest DB state — including
    // updates from another replica — while the DB is healthy.
    memCacheSet(row.cacheKey, { value, expiresAt: expiresAtMs, memExpiresAt });
  }
  return { fresh, stale };
}

export interface InsightWriteEntry {
  key: string;
  kind: string;
  recordId: string;
  fieldsHash: string;
  value: InsightValue;
}

// Retry schedule for `putInsights` writes. We only retry the *write*, not
// the read: a flaky DB connection that drops the regenerated value entirely
// is the failure mode we're guarding against — losing the OpenAI call's
// output to a single timed-out connection means the next request pays the
// cost again. Three attempts with short exponential backoff (~50/200/800 ms)
// fits comfortably inside the background-refresh path without making the
// synchronous-miss path noticeably slower; total worst-case added latency
// when all attempts fail is ~1s before we give up and propagate the error.
const PUT_RETRY_DELAYS_MS = [50, 200, 800];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upsert a batch of cache entries with a shared TTL (ms). On conflict the
 * existing row is replaced so a refreshed insight overwrites the stale one.
 *
 * Wrapped in a small retry/backoff loop so a single flaky connection during
 * a brief Postgres blip doesn't permanently drop the regenerated value —
 * which would otherwise force the next read to pay another OpenAI call.
 * On a healthy DB the first attempt succeeds and there's no extra latency.
 */
export async function putInsights(
  entries: InsightWriteEntry[],
  ttlMs: number,
): Promise<void> {
  if (entries.length === 0) return;
  const expiresAt = new Date(Date.now() + ttlMs);
  const rows = entries.map((e) => ({
    cacheKey: e.key,
    kind: e.kind,
    recordId: e.recordId,
    fieldsHash: e.fieldsHash,
    severity: e.value.severity,
    text: e.value.text,
    expiresAt,
  }));

  let lastErr: unknown;
  for (let attempt = 0; attempt <= PUT_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await upsertInsightRows(rows);
      // Mirror writes into the failover LRU so reads from this replica stay
      // self-consistent if the DB hiccups again immediately after the write.
      // Other replicas only learn about the new value via their next DB
      // read, which is the same as before this layer existed.
      const expiresAtMs = expiresAt.getTime();
      const memExpiresAt = Date.now() + MEM_CACHE_TTL_MS;
      for (const e of entries) {
        memCacheSet(e.key, {
          value: { severity: e.value.severity, text: e.value.text },
          expiresAt: expiresAtMs,
          memExpiresAt,
        });
      }
      if (attempt > 0) {
        console.log(
          `[insightsCache] putInsights succeeded on attempt ${attempt + 1}/${PUT_RETRY_DELAYS_MS.length + 1}`,
        );
      }
      return;
    } catch (e) {
      lastErr = e;
      if (attempt >= PUT_RETRY_DELAYS_MS.length) break;
      const delay = PUT_RETRY_DELAYS_MS[attempt];
      console.log(
        `[insightsCache] putInsights attempt ${attempt + 1} failed, retrying in ${delay}ms: ${String(e).slice(0, 200)}`,
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Delete every cached insight for a (kind, recordId) pair regardless of
 * fieldsHash. Returns the number of rows removed.
 */
export async function invalidateInsight(
  kind: string,
  recordId: string,
): Promise<number> {
  const deletedKeys = await deleteInsightsByRecord(kind, recordId);
  // Mirror the deletion into this replica's failover LRU so a DB blip
  // immediately after the admin DELETE can't resurrect the just-removed
  // value. Cache keys are formatted `${kind}:${recordId}:${fieldsHash}`
  // — matching by prefix covers every fieldsHash variant for this record.
  memCacheDeleteByPrefix(`${kind}:${recordId}:`);
  return deletedKeys.length;
}

/** Delete every cached insight for a kind. */
export async function invalidateKind(kind: string): Promise<number> {
  const deletedKeys = await deleteInsightsByKind(kind);
  memCacheDeleteByPrefix(`${kind}:`);
  return deletedKeys.length;
}

// --- Cross-replica regeneration coordination ---------------------------------
//
// Background insight regeneration is rate-controlled inside a single Node
// process by `_inFlightRefreshKeys` in card-insights.ts. That set lives in
// memory and does NOT span replicas, so when the API server runs with more
// than one pod (or two pods overlap during a rolling deploy) each replica
// can fire its own OpenAI call for the same stale row — wasting money and
// racing two writes against each other.
//
// To dedupe across replicas we use Postgres session-level advisory locks via
// `pg_try_advisory_lock(int4, int4)`:
//   * The first int is a fixed namespace constant so we never collide with
//     advisory locks taken elsewhere in the system.
//   * The second int is `hashtext(cacheKey)` — a 32-bit hash of the cache
//     key, computed in SQL so the hashing is identical across replicas.
//
// Hash-collision tradeoff: `hashtext` is 32-bit, so two distinct cache keys
// could in principle map to the same lock id (~birthday collision around
// ~65k concurrent stale keys). The cost of a collision is minor — one
// replica skips a regen it could have done, the other does it instead, and
// the loser's row simply stays stale until its next read. No data corruption
// is possible because the actual cache write keys off the full string key,
// not the hash. If concurrent stale-key counts ever approach that scale,
// switch to `pg_try_advisory_lock(bigint)` with a 64-bit hash.
//
// Sessions can hold many advisory locks simultaneously, so a single pooled
// connection can guard a whole batch of stale records. Locks auto-release
// when the session disconnects, so a crashed replica can never permanently
// block regeneration.

// Arbitrary, but fixed: chosen so it doesn't collide with any other
// advisory-lock namespace we might introduce later. Treat as a constant.
const REFRESH_LOCK_NAMESPACE = 0x73494e53; // "sINS"

export interface AdvisoryLockBatchHandle {
  /**
   * Subset of the requested keys that this caller actually owns. Other keys
   * are either being regenerated by another replica right now, or the
   * coordination backend was unavailable (see `degraded`).
   */
  acquired: string[];
  /**
   * True when we couldn't talk to the coordination backend at all (e.g. the
   * pool failed to hand out a connection). Callers should fall back to
   * regenerating without cross-replica dedupe rather than skipping work
   * entirely — at worst that costs one extra OpenAI call per replica, the
   * same as before this layer existed.
   */
  degraded: boolean;
  release(): Promise<void>;
}

const NOOP_HANDLE: AdvisoryLockBatchHandle = {
  acquired: [],
  degraded: false,
  release: async () => {},
};

/**
 * Try to acquire a cross-replica regeneration lock for each key. Returns a
 * handle whose `acquired` field lists only the keys this caller actually
 * owns; other keys are being regenerated by some other replica and should
 * be skipped here.
 *
 * The returned handle MUST be released (in a `finally`) to free the locks
 * and the underlying pool connection. Releasing is idempotent.
 *
 * If the coordination backend is briefly unavailable we resolve with
 * `degraded: true` and an empty `acquired` list so callers can choose to
 * proceed without cross-replica coordination instead of dropping the
 * refresh entirely.
 */
// In-memory per-process lock set replaces Postgres advisory locks.
// Prevents duplicate regeneration within a single process.
const _inMemoryRefreshLocks = new Set<string>();

export async function tryAcquireRefreshLocks(
  keys: string[],
): Promise<AdvisoryLockBatchHandle> {
  if (keys.length === 0) return NOOP_HANDLE;

  const uniqueKeys = Array.from(new Set(keys));
  const acquired: string[] = [];
  for (const k of uniqueKeys) {
    if (!_inMemoryRefreshLocks.has(k)) {
      _inMemoryRefreshLocks.add(k);
      acquired.push(k);
    }
  }
  return {
    acquired,
    degraded: false,
    release: async () => {
      for (const k of acquired) _inMemoryRefreshLocks.delete(k);
    },
  };
}

/**
 * Best-effort sweep of expired rows so the table doesn't grow unbounded.
 * Safe to call from a request path — failures are swallowed and logged so
 * a transient DB hiccup never breaks insight serving.
 */
export async function pruneExpired(): Promise<number> {
  try {
    return await pruneExpiredInsights(new Date());
  } catch (e) {
    console.log(`[insightsCache] prune failed: ${String(e).slice(0, 200)}`);
    return 0;
  }
}
