/**
 * In-memory replacement for the localStorage-backed data caches.
 *
 * Customer requirement: NO app/customer data may persist in browser storage —
 * many customer machines have a very limited localStorage quota, and the old
 * persisted caches (project team seeds, detail snapshots, forecast sources,
 * home overlay, card insights) could fill it completely, which at its worst
 * blocked the login token write and locked users out.
 *
 * This store keeps the exact string getItem/setItem semantics the old
 * localStorage code used, so the in-session "instant render on return visit"
 * seeding still works unchanged — but everything lives in a plain Map and
 * vanishes on page reload. Nothing is ever written to disk.
 *
 * BOUNDED: the store enforces a hard budget (entries + approximate bytes).
 * When a write would exceed it, the least-recently-used entries are evicted
 * first. Every entry here is a re-fetchable seed — evicting one only means
 * that page falls back to a normal server fetch, so eviction is always safe.
 */

// ~40 MB of string data (chars ≈ 2 bytes each, so ~80 MB of JS heap worst
// case) and at most 800 entries. Far below any browser tab's memory limit,
// but roomy enough that a long session never notices eviction.
const MAX_TOTAL_CHARS = 20_000_000;
const MAX_ENTRIES = 800;

const store = new Map<string, string>();
let totalChars = 0;

function evictUntilFits(incomingChars: number): void {
  // Map iteration order = insertion order; getItem re-inserts on hit, so the
  // first keys are the least recently used.
  for (const k of store.keys()) {
    if (store.size < MAX_ENTRIES && totalChars + incomingChars <= MAX_TOTAL_CHARS) break;
    const v = store.get(k);
    store.delete(k);
    totalChars -= k.length + (v?.length ?? 0);
  }
}

export const memSeed = {
  getItem(key: string): string | null {
    const v = store.get(key);
    if (v === undefined) return null;
    // Refresh recency (LRU): move the key to the end of the insertion order.
    store.delete(key);
    store.set(key, v);
    return v;
  },
  setItem(key: string, value: string): void {
    const prev = store.get(key);
    if (prev !== undefined) {
      store.delete(key);
      totalChars -= key.length + prev.length;
    }
    const incoming = key.length + value.length;
    // A single entry larger than the whole budget is never stored.
    if (incoming > MAX_TOTAL_CHARS) return;
    if (store.size >= MAX_ENTRIES || totalChars + incoming > MAX_TOTAL_CHARS) {
      evictUntilFits(incoming);
    }
    store.set(key, value);
    totalChars += incoming;
  },
  removeItem(key: string): void {
    const v = store.get(key);
    if (v === undefined) return;
    store.delete(key);
    totalChars -= key.length + v.length;
  },
  /** Snapshot of all keys — used by the per-cache trim/purge helpers. */
  keys(): string[] {
    return Array.from(store.keys());
  },
  /** Wipe EVERYTHING. Called from every FULL bustCache() — that includes
   *  login/logout/auth-error (tenant isolation: seeds here are keyed by record
   *  id WITHOUT a tenant tag, and numeric ids collide across tenants, so a
   *  same-tab tenant switch would serve the previous tenant's data as an
   *  instant-render seed) and also mutation-driven full busts (allocation /
   *  schedule edits etc.), where losing the seeds merely costs one instant
   *  render — every entry is a re-fetchable seed by contract. */
  clear(): void {
    store.clear();
    totalChars = 0;
  },
};
