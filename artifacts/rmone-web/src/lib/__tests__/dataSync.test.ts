/**
 * Unit tests for the unified data-sync bus (lib/dataSync.ts).
 *
 * Covers:
 *  A) Bust handler runs synchronously on EVERY publish, before dispatch
 *  B) Leading dispatch is synchronous; rapid bursts coalesce into exactly
 *     one trailing dispatch carrying the union of scopes + recordIds
 *  C) Legacy rmone:allocationChanged event + rmone:allocationTs marker fire
 *     for allocation-ish scopes only — never for record-only publishes
 *  D) subscribeDataChanged scope filtering, "any", and unsubscribe
 *  E) Cross-tab storage marker: scopes only (NO record IDs in localStorage),
 *     nonce dedupe, wrong-key ignored
 *  F) The coalescing window closes when idle — the next isolated publish is
 *     leading/synchronous again
 *  G) A throwing bust handler never blocks the dispatch
 */

import assert from "node:assert/strict";

// ── Browser shims (must exist BEFORE the module under test is imported) ──
class FakeStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}
const fakeWindow = new EventTarget();
(globalThis as any).window = fakeWindow;
(globalThis as any).localStorage = new FakeStorage();
if (typeof (globalThis as any).CustomEvent === "undefined") {
  (globalThis as any).CustomEvent = class<T> extends Event {
    detail: T;
    constructor(type: string, init?: { detail?: T }) {
      super(type);
      this.detail = init?.detail as T;
    }
  };
}

const {
  notifyDataChanged,
  subscribeDataChanged,
  registerSyncBustHandler,
  DATA_CHANGED_EVENT,
  DATA_SYNC_MARKER_KEY,
  __configureDataSyncCoalescingForTests,
  __flushDataSyncForTests,
  __resetDataSyncForTests,
} = await import("../dataSync.js");

type Detail = { scopes: string[]; recordIds: string[]; at: number; nonce: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freshStart() {
  __resetDataSyncForTests();
  __configureDataSyncCoalescingForTests(15);
  (globalThis as any).localStorage.clear();
}

// ── A) bust handler synchronous + before dispatch ─────────────────────────
{
  freshStart();
  const order: string[] = [];
  registerSyncBustHandler(() => order.push("bust"));
  const unsub = subscribeDataChanged("any", () => order.push("event"));
  notifyDataChanged(["allocation"]);
  assert.deepEqual(order, ["bust", "event"], "bust handler must run before the leading dispatch, both synchronously");
  unsub();
  __flushDataSyncForTests();
  console.log("PASS A: bust handler runs synchronously before dispatch");
}

// ── B) leading + coalesced trailing with scope/recordId union ─────────────
{
  freshStart();
  let busts = 0;
  registerSyncBustHandler(() => { busts++; });
  const seen: Detail[] = [];
  const unsub = subscribeDataChanged("any", (d) => seen.push(d as Detail));
  notifyDataChanged(["allocation"]);                                   // leading (sync)
  notifyDataChanged(["team"], { recordIds: ["PMM-26-001"] });          // pends
  notifyDataChanged(["record"], { recordIds: ["OPM-26-002"] });        // pends
  notifyDataChanged(["allocation", "demand"]);                          // pends
  assert.equal(seen.length, 1, "burst must not dispatch per publish");
  assert.deepEqual(seen[0].scopes, ["allocation"]);
  assert.equal(busts, 4, "bust handler runs on EVERY publish even while coalescing");
  await sleep(40);
  assert.equal(seen.length, 2, "exactly one trailing dispatch for the whole burst");
  assert.deepEqual([...seen[1].scopes].sort(), ["allocation", "demand", "record", "team"], "trailing carries the scope union");
  assert.deepEqual([...seen[1].recordIds].sort(), ["OPM-26-002", "PMM-26-001"], "trailing carries the recordId union");
  unsub();
  __flushDataSyncForTests();
  console.log("PASS B: leading dispatch + single trailing union dispatch");
}

// ── C) legacy event/marker for allocation-ish scopes only ─────────────────
{
  freshStart();
  let legacy = 0;
  const onLegacy = () => legacy++;
  fakeWindow.addEventListener("rmone:allocationChanged", onLegacy);
  notifyDataChanged(["record"], { recordIds: ["PMM-1"] });
  __flushDataSyncForTests();
  assert.equal(legacy, 0, "record-only publish must NOT fire the legacy allocation event");
  assert.equal((globalThis as any).localStorage.getItem("rmone:allocationTs"), null, "record-only publish must not write the legacy marker");
  notifyDataChanged(["allocation"]);
  assert.equal(legacy, 1, "allocation publish fires the legacy event for un-migrated listeners");
  assert.ok((globalThis as any).localStorage.getItem("rmone:allocationTs"), "allocation publish writes the legacy marker");
  notifyDataChanged(["team"]); // pends within window
  __flushDataSyncForTests();
  assert.equal(legacy, 2, "trailing dispatch with team scope also fires the legacy event");
  fakeWindow.removeEventListener("rmone:allocationChanged", onLegacy);
  console.log("PASS C: legacy event/marker only for allocation-ish scopes");
}

// ── D) scope filtering, any, unsubscribe ──────────────────────────────────
{
  freshStart();
  const recordHits: string[][] = [];
  const anyHits: string[][] = [];
  const unsubRecord = subscribeDataChanged(["record"], (d) => recordHits.push(d.scopes));
  const unsubAny = subscribeDataChanged("any", (d) => anyHits.push(d.scopes));
  notifyDataChanged(["allocation"]);
  __flushDataSyncForTests();
  assert.equal(recordHits.length, 0, "record subscriber must ignore allocation-only publishes");
  assert.equal(anyHits.length, 1);
  notifyDataChanged(["record", "team"]);
  __flushDataSyncForTests();
  assert.equal(recordHits.length, 1, "mixed publish including record reaches the record subscriber");
  unsubRecord();
  unsubAny();
  notifyDataChanged(["record"]);
  __flushDataSyncForTests();
  assert.equal(recordHits.length, 1, "unsubscribed listener must not fire");
  assert.equal(anyHits.length, 2);
  console.log("PASS D: scope filtering, any, unsubscribe");
}

// ── E) storage marker privacy + cross-tab delivery + nonce dedupe ─────────
{
  freshStart();
  notifyDataChanged(["record"], { recordIds: ["PMM-26-777"] });
  __flushDataSyncForTests();
  const raw = (globalThis as any).localStorage.getItem(DATA_SYNC_MARKER_KEY);
  assert.ok(raw, "publish writes the cross-tab marker");
  const marker = JSON.parse(raw) as Detail;
  assert.deepEqual(marker.recordIds, [], "cross-tab marker must NEVER carry record IDs");
  assert.deepEqual(marker.scopes, ["record"]);
  assert.ok(marker.nonce, "marker carries a dedupe nonce");
  assert.ok(!raw.includes("PMM-26-777"), "no record identifier may appear anywhere in localStorage");

  // Simulate the receiving tab: storage events carry key + newValue.
  const got: Detail[] = [];
  const unsub = subscribeDataChanged(["record"], (d) => got.push(d as Detail));
  const fireStorage = (key: string, newValue: string) => {
    const ev = new Event("storage") as Event & { key?: string; newValue?: string };
    ev.key = key;
    ev.newValue = newValue;
    fakeWindow.dispatchEvent(ev);
  };
  fireStorage("some:other:key", raw);
  assert.equal(got.length, 0, "unrelated storage keys are ignored");
  fireStorage(DATA_SYNC_MARKER_KEY, raw);
  assert.equal(got.length, 1, "marker storage event reaches scope-matched subscribers");
  fireStorage(DATA_SYNC_MARKER_KEY, raw);
  assert.equal(got.length, 1, "duplicate delivery of the same nonce is deduped");
  fireStorage(DATA_SYNC_MARKER_KEY, "{not json");
  assert.equal(got.length, 1, "malformed marker is ignored, never throws");
  unsub();
  console.log("PASS E: cross-tab marker is scope-only, deduped, and delivered");
}

// ── F) idle window closes → next publish is leading again ─────────────────
{
  freshStart();
  const seen: Detail[] = [];
  const unsub = subscribeDataChanged("any", (d) => seen.push(d as Detail));
  notifyDataChanged(["allocation"]);
  await sleep(45); // leading window fires empty → closes; no trailing dispatch
  assert.equal(seen.length, 1, "an idle window must not emit an empty trailing dispatch");
  notifyDataChanged(["team"]);
  assert.equal(seen.length, 2, "after the window closes, the next publish is leading/synchronous again");
  unsub();
  __flushDataSyncForTests();
  console.log("PASS F: idle window closes and synchronous leading resumes");
}

// ── G) throwing bust handler never blocks dispatch ────────────────────────
{
  freshStart();
  registerSyncBustHandler(() => { throw new Error("bust exploded"); });
  let events = 0;
  const unsub = subscribeDataChanged("any", () => events++);
  assert.doesNotThrow(() => notifyDataChanged(["allocation"]));
  assert.equal(events, 1, "dispatch must still fire when the bust handler throws");
  unsub();
  __flushDataSyncForTests();
  console.log("PASS G: throwing bust handler never blocks dispatch");
}

// ── H) re-entrant publish during the LEADING dispatch joins the window ────
{
  freshStart();
  const seen: Detail[] = [];
  let republished = false;
  const unsub = subscribeDataChanged("any", (d) => {
    seen.push(d as Detail);
    if (!republished) {
      republished = true;
      // Fired synchronously from INSIDE the leading dispatch — must join the
      // already-open window, never nest a second synchronous dispatch.
      notifyDataChanged(["record"], { recordIds: ["PMM-9"] });
    }
  });
  notifyDataChanged(["allocation"]);
  assert.equal(seen.length, 1, "a listener-originated publish must NOT nest a second synchronous dispatch");
  await sleep(40);
  assert.equal(seen.length, 2, "the re-entrant publish arrives as exactly one trailing dispatch");
  assert.deepEqual(seen[1].scopes, ["record"]);
  assert.deepEqual(seen[1].recordIds, ["PMM-9"]);
  await sleep(40);
  assert.equal(seen.length, 2, "no orphan timer may emit further dispatches");
  notifyDataChanged(["team"]);
  assert.equal(seen.length, 3, "the window must be fully closed after the cycle — the next publish is leading again");
  unsub();
  __flushDataSyncForTests();
  console.log("PASS H: re-entrant publish during leading dispatch coalesces");
}

// ── I) re-entrant publish during the TRAILING flush joins the NEXT window ─
{
  freshStart();
  // Wider window than the other sections: the checkpoints below must land
  // BETWEEN consecutive flushes (t≈60 trailing, t≈120 next flush, t≈180
  // idle-close), so give each boundary a ~30ms margin.
  __configureDataSyncCoalescingForTests(60);
  const seen: Detail[] = [];
  let republished = false;
  const unsub = subscribeDataChanged("any", (d) => {
    seen.push(d as Detail);
    if (d.scopes.includes("team") && !republished) {
      republished = true;
      notifyDataChanged(["staff"]); // synchronously inside the trailing dispatch
    }
  });
  notifyDataChanged(["allocation"]); // leading
  notifyDataChanged(["team"]);       // pends → trailing
  await sleep(90); // past the t≈60 trailing, before the t≈120 follow-up flush
  assert.equal(seen.length, 2, "the trailing flush must not nest a synchronous dispatch for the re-entrant publish");
  assert.deepEqual(seen[1].scopes, ["team"]);
  await sleep(60); // past the t≈120 flush that carries the re-entrant publish
  assert.equal(seen.length, 3, "the re-entrant publish flushes with the NEXT window");
  assert.deepEqual(seen[2].scopes, ["staff"]);
  await sleep(80); // past the t≈180 idle-close
  assert.equal(seen.length, 3, "the chain drains and the window closes — no orphan timers");
  unsub();
  __flushDataSyncForTests();
  console.log("PASS I: re-entrant publish during trailing flush joins the next window");
}

__resetDataSyncForTests();
console.log("dataSync.test.ts: all checks passed");
