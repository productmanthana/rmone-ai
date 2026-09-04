/**
 * Unified client data-sync bus — ONE choke point through which every write
 * (hours/allocation saves, team adds/removes, open-position changes, record
 * status/field edits, staff changes) announces "data changed" to every page.
 *
 * Why one bus: Home, Alerts, Resources, Demand, Project Detail and Quick
 * Actions each cache their own data. Before this module, only allocation
 * writes broadcast a signal (`rmone:allocationChanged`) — removing a team
 * member or changing a record's status updated the page you were on, while
 * every OTHER mounted page kept its stale copy until a manual browser
 * refresh. The client called this out as their biggest hurdle.
 *
 * Contract:
 *  1. `notifyDataChanged(scopes)` — call after ANY successful write.
 *     - Synchronously runs the registered bust handler (drops fetch-layer
 *       caches, arms one-shot fresh reads, invalidates React Query keys) so
 *       every refetch the event triggers goes to the network, never a stale
 *       local cache.
 *     - Dispatches `rmone:dataChanged` (this tab) and writes the
 *       `rmone:dataSyncTs` marker (other tabs). The FIRST publish dispatches
 *       synchronously; publishes that arrive while the coalescing window is
 *       open are merged into ONE trailing dispatch — so a burst of 50 rapid
 *       saves refreshes listening pages twice (leading + final state), not
 *       50 times.
 *     - Emits the legacy `rmone:allocationChanged` event + `rmone:allocationTs`
 *       marker for allocation-ish scopes so not-yet-migrated listeners and
 *       mount-time marker compares keep working unchanged.
 *  2. `subscribeDataChanged(scopes, cb)` — pages listen with scope filters;
 *     covers both this tab (CustomEvent) and sibling tabs (storage event).
 *
 * Privacy: the cross-tab storage marker carries scopes + timestamp + nonce
 * ONLY — record IDs never enter localStorage (same stance as the legacy
 * timestamp-only `rmone:allocationTs` marker). Record IDs ride the same-tab
 * CustomEvent only.
 */

export type DataScope = "allocation" | "team" | "demand" | "record" | "staff";

export const DATA_CHANGED_EVENT = "rmone:dataChanged";
export const DATA_SYNC_MARKER_KEY = "rmone:dataSyncTs";

const LEGACY_EVENT = "rmone:allocationChanged";
const LEGACY_MARKER_KEY = "rmone:allocationTs";
/** Scopes that legacy `rmone:allocationChanged` listeners care about. */
const LEGACY_SCOPES: readonly DataScope[] = ["allocation", "team", "demand", "staff"];

export interface DataChangeDetail {
  scopes: DataScope[];
  /** Ticket IDs of the records a "record" publish touched (same-tab only). */
  recordIds: string[];
  at: number;
  nonce: string;
}

type BustHandler = (scopes: ReadonlySet<DataScope>, recordIds: readonly string[]) => void;

let bustHandler: BustHandler | null = null;

/** api.ts registers the cache-bust half of the bus here (fetch-layer busts,
 *  one-shot fresh arming, React Query invalidation). Registered once at
 *  module init; kept as a registry so this module has ZERO imports and can
 *  never form an import cycle with api.ts. */
export function registerSyncBustHandler(fn: BustHandler): void {
  bustHandler = fn;
}

// ── Coalescing window ────────────────────────────────────────────────────
// Leading dispatch is synchronous (single saves feel instant everywhere).
// While the window is open, further publishes accumulate; when the timer
// fires they flush as ONE union dispatch and the window re-arms — a long
// burst emits at most one dispatch per window instead of one per save.
// When a window fires with nothing pending it closes, so the next isolated
// save is synchronous again.
//
// Re-entrancy: the window is ALWAYS armed BEFORE dispatchNow runs (both the
// leading path and each trailing flush). A subscriber that synchronously
// publishes from inside its callback therefore sees an open window and joins
// the pending union instead of nesting another synchronous dispatch — which
// would break the leading+one-trailing guarantee, orphan duplicate timers,
// and allow unbounded recursion between two mutually-publishing listeners.
let coalesceMs = 350;
let windowTimer: ReturnType<typeof setTimeout> | null = null;
let pendingScopes = new Set<DataScope>();
let pendingRecordIds = new Set<string>();

function makeNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function dispatchNow(scopes: ReadonlySet<DataScope>, recordIds: ReadonlySet<string>): void {
  const detail: DataChangeDetail = {
    scopes: [...scopes],
    recordIds: [...recordIds],
    at: Date.now(),
    nonce: makeNonce(),
  };
  try {
    window.dispatchEvent(new CustomEvent<DataChangeDetail>(DATA_CHANGED_EVENT, { detail }));
  } catch { /* SSR / non-browser */ }
  // Cross-tab marker: scopes only — no record IDs in localStorage.
  try {
    localStorage.setItem(
      DATA_SYNC_MARKER_KEY,
      JSON.stringify({ scopes: detail.scopes, recordIds: [], at: detail.at, nonce: detail.nonce }),
    );
  } catch { /* storage unavailable */ }
  if (detail.scopes.some((s) => LEGACY_SCOPES.includes(s))) {
    try { window.dispatchEvent(new CustomEvent(LEGACY_EVENT)); } catch { /* SSR */ }
    // Unique even for two saves in the same millisecond — a same-value write
    // does not emit a storage event in sibling tabs.
    try {
      localStorage.setItem(LEGACY_MARKER_KEY, `${Date.now()}:${Math.random().toString(36).slice(2)}`);
    } catch { /* storage unavailable */ }
  }
}

function flushWindow(): void {
  // Called by the armed timer (or the test flush helper). Clear the handle
  // first so the close/re-arm decision below fully owns the window state.
  if (windowTimer) clearTimeout(windowTimer);
  windowTimer = null;
  if (pendingScopes.size === 0) return; // idle window → close
  const scopes = pendingScopes;
  const ids = pendingRecordIds;
  pendingScopes = new Set();
  pendingRecordIds = new Set();
  // Re-arm BEFORE dispatching: a subscriber publishing synchronously from
  // inside this trailing dispatch must join the NEXT window's pending set,
  // not start a nested leading dispatch that orphans this timer.
  windowTimer = setTimeout(flushWindow, coalesceMs);
  dispatchNow(scopes, ids);
}

/**
 * Announce a successful write. Cache busts run synchronously on EVERY call
 * (they are idempotent and must precede any listener refetch); the event
 * dispatch itself is coalesced — see module docs.
 */
export function notifyDataChanged(
  scopes: DataScope | readonly DataScope[],
  opts?: { recordIds?: readonly string[] },
): void {
  const set = new Set<DataScope>(Array.isArray(scopes) ? scopes : [scopes as DataScope]);
  if (set.size === 0) return;
  const ids = (opts?.recordIds ?? []).filter((id) => typeof id === "string" && id.trim().length > 0);
  try { bustHandler?.(set, ids); } catch { /* bust failures must never block the save path */ }
  if (windowTimer) {
    for (const s of set) pendingScopes.add(s);
    for (const id of ids) pendingRecordIds.add(id);
    return;
  }
  // Open the window BEFORE the leading dispatch — see the re-entrancy note
  // on the coalescing block above.
  windowTimer = setTimeout(flushWindow, coalesceMs);
  dispatchNow(set, new Set(ids));
}

/**
 * Listen for data changes from THIS tab and sibling tabs.
 * `scopes: "any"` matches every publish. Returns an unsubscribe function.
 */
export function subscribeDataChanged(
  scopes: readonly DataScope[] | "any",
  cb: (detail: DataChangeDetail) => void,
): () => void {
  const wants = scopes === "any" ? null : new Set(scopes);
  const matches = (d: DataChangeDetail | null | undefined): d is DataChangeDetail =>
    !!d && Array.isArray(d.scopes) && (wants === null || d.scopes.some((s) => wants.has(s)));
  const onEvent = (e: Event) => {
    const d = (e as CustomEvent<DataChangeDetail>).detail;
    if (matches(d)) cb(d);
  };
  // Nonce dedupe: some browsers can deliver a storage event more than once,
  // and a marker re-write with identical JSON is possible in principle.
  const seenNonces = new Set<string>();
  const onStorage = (e: StorageEvent) => {
    if (e.key !== DATA_SYNC_MARKER_KEY || !e.newValue) return;
    let d: DataChangeDetail | null = null;
    try { d = JSON.parse(e.newValue) as DataChangeDetail; } catch { return; }
    if (d?.nonce) {
      if (seenNonces.has(d.nonce)) return;
      seenNonces.add(d.nonce);
      if (seenNonces.size > 128) seenNonces.clear();
    }
    if (matches(d)) cb({ ...d, recordIds: Array.isArray(d.recordIds) ? d.recordIds : [] });
  };
  try {
    window.addEventListener(DATA_CHANGED_EVENT, onEvent);
    window.addEventListener("storage", onStorage);
  } catch { /* SSR */ }
  return () => {
    try {
      window.removeEventListener(DATA_CHANGED_EVENT, onEvent);
      window.removeEventListener("storage", onStorage);
    } catch { /* SSR */ }
  };
}

// ── Test hooks ───────────────────────────────────────────────────────────

/** Tests only: shrink/grow the coalescing window. */
export function __configureDataSyncCoalescingForTests(ms: number): void {
  coalesceMs = Math.max(0, ms);
}

/** Tests only: synchronously flush any pending trailing dispatch and close
 *  the window. Loops because a flush that dispatched re-arms the window
 *  (flushWindow clears the armed timer itself before deciding). */
export function __flushDataSyncForTests(): void {
  for (let i = 0; i < 8 && windowTimer; i++) flushWindow();
  if (windowTimer) { clearTimeout(windowTimer); windowTimer = null; }
}

/** Tests only: full reset — handler, window, pending state, default timing. */
export function __resetDataSyncForTests(): void {
  if (windowTimer) { clearTimeout(windowTimer); windowTimer = null; }
  pendingScopes = new Set();
  pendingRecordIds = new Set();
  bustHandler = null;
  coalesceMs = 350;
}
