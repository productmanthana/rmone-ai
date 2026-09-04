/**
 * Regression tests: open-slot auto-consume window matching (#347/#349 class).
 *
 * getOpenRolesForProject collapses every open demand row of one role into a
 * single display position (earliest start, latest end, ALL backing RA ids).
 * The bug class under test: destructive retirement that matches against the
 * COLLAPSED span can soft-delete a disjoint same-role window the new member
 * never covered. These tests prove lib/openSlotMatch.ts only ever returns the
 * ids of the single contiguous window the member actually overlaps, and fails
 * closed on every ambiguity.
 */
import assert from "node:assert/strict";
import { splitSlotWindows, pickAutoConsumeWindow } from "../openSlotMatch.js";

const d = (s: string) => new Date(s).getTime();
let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// ── splitSlotWindows ─────────────────────────────────────────────────────────

t("weekly back-to-back rows collapse into one window", () => {
  const w = splitSlotWindows([
    { id: 1, start: "2026-01-05", end: "2026-01-11" },
    { id: 2, start: "2026-01-12", end: "2026-01-18" },
    { id: 3, start: "2026-01-19", end: "2026-01-25" },
  ]);
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].ids.sort(), [1, 2, 3]);
  assert.equal(w[0].startMs, d("2026-01-05"));
  assert.equal(w[0].endMs, d("2026-01-25"));
});

t("disjoint same-role periods split into separate windows", () => {
  const w = splitSlotWindows([
    { id: 1, start: "2026-01-05", end: "2026-03-01" },
    { id: 2, start: "2026-09-01", end: "2026-12-20" },
  ]);
  assert.equal(w.length, 2);
  assert.deepEqual(w[0].ids, [1]);
  assert.deepEqual(w[1].ids, [2]);
});

t("only touching/overlapping rows merge; any real gap starts a new window", () => {
  // next start = prev end + 1 day (back-to-back weekly rows) → same window
  const touching = splitSlotWindows([
    { id: 1, start: "2026-01-05", end: "2026-01-11" },
    { id: 2, start: "2026-01-12", end: "2026-01-18" },
  ]);
  assert.equal(touching.length, 1);
  // one skipped week → separate windows
  const skippedWeek = splitSlotWindows([
    { id: 1, start: "2026-01-05", end: "2026-01-11" },
    { id: 2, start: "2026-01-19", end: "2026-01-25" },
  ]);
  assert.equal(skippedWeek.length, 2);
  // even a 2-day gap → separate windows
  const twoDayGap = splitSlotWindows([
    { id: 1, start: "2026-01-05", end: "2026-01-11" },
    { id: 2, start: "2026-01-14", end: "2026-01-20" },
  ]);
  assert.equal(twoDayGap.length, 2);
});

// A member sitting ENTIRELY inside a gap between demand rows overlaps no
// actual row — nothing may be consumed, no matter how the rows would merge.
t("member entirely inside a gap between rows matches nothing", () => {
  const candidates = [{
    role: "Coordinator",
    raRows: [
      { id: 1, start: "2026-01-05", end: "2026-01-11" },
      { id: 2, start: "2026-01-19", end: "2026-01-25" }, // skipped week Jan 12–18
    ],
  }];
  assert.equal(pickAutoConsumeWindow(candidates, d("2026-01-12"), d("2026-01-18")), null);
  // member overlapping BOTH sides of the gap → two overlapping windows → ambiguous → null
  assert.equal(pickAutoConsumeWindow(candidates, d("2026-01-10"), d("2026-01-20")), null);
  // member overlapping only the first week → unique → only that row
  const hit = pickAutoConsumeWindow(candidates, d("2026-01-05"), d("2026-01-11"));
  assert.ok(hit);
  assert.deepEqual(hit!.raIds, [1]);
});

t("any unparseable row date poisons the whole group (fail closed)", () => {
  assert.deepEqual(splitSlotWindows([
    { id: 1, start: "2026-01-05", end: "2026-01-11" },
    { id: 2, start: "", end: "2026-01-18" },
  ]), []);
  assert.deepEqual(splitSlotWindows([
    { id: 1, start: "not-a-date", end: "2026-01-11" },
  ]), []);
});

t("end-before-start row poisons the group; missing end = single day", () => {
  assert.deepEqual(splitSlotWindows([{ id: 1, start: "2026-02-01", end: "2026-01-01" }]), []);
  const w = splitSlotWindows([{ id: 1, start: "2026-02-01", end: "" }]);
  assert.equal(w.length, 1);
  assert.equal(w[0].startMs, w[0].endMs);
});

// ── pickAutoConsumeWindow ────────────────────────────────────────────────────

// THE core regression: one role, two disjoint windows behind a single
// collapsed slot. A member covering only the early window must retire ONLY
// the early window's rows — never the future demand.
t("member overlapping one of two disjoint windows retires only that window", () => {
  const candidates = [{
    role: "Project Coordinator",
    raRows: [
      { id: 10, start: "2026-01-05", end: "2026-01-11" },
      { id: 11, start: "2026-01-12", end: "2026-01-18" },
      { id: 20, start: "2026-09-07", end: "2026-09-13" },
      { id: 21, start: "2026-09-14", end: "2026-09-20" },
    ],
  }];
  const early = pickAutoConsumeWindow(candidates, d("2026-01-01"), d("2026-02-01"));
  assert.ok(early);
  assert.deepEqual(early!.raIds.sort(), [10, 11]);
  const late = pickAutoConsumeWindow(candidates, d("2026-09-01"), d("2026-12-31"));
  assert.ok(late);
  assert.deepEqual(late!.raIds.sort(), [20, 21]);
});

t("member spanning BOTH windows is ambiguous → retires nothing", () => {
  const candidates = [{
    role: "Coordinator",
    raRows: [
      { id: 1, start: "2026-01-05", end: "2026-03-01" },
      { id: 2, start: "2026-09-01", end: "2026-12-20" },
    ],
  }];
  assert.equal(pickAutoConsumeWindow(candidates, d("2026-01-01"), d("2026-12-31")), null);
});

// Concurrent duplicate same-role slots ("Coordinator" + "Coordinator (2)"
// arrive as separate candidates after suffix-stripped role matching). Both
// overlap the member → indistinguishable → nothing may be deleted.
t("two concurrent same-role slots are ambiguous → retires nothing (either row order)", () => {
  const a = { role: "Coordinator",     raRows: [{ id: 1, start: "2026-01-05", end: "2026-06-01" }] };
  const b = { role: "Coordinator (2)", raRows: [{ id: 2, start: "2026-01-05", end: "2026-06-01" }] };
  assert.equal(pickAutoConsumeWindow([a, b], d("2026-02-01"), d("2026-03-01")), null);
  assert.equal(pickAutoConsumeWindow([b, a], d("2026-02-01"), d("2026-03-01")), null);
});

t("two concurrent slots with PARTIALLY overlapping spans still ambiguous when member overlaps both", () => {
  const a = { role: "Coordinator",     raRows: [{ id: 1, start: "2026-01-05", end: "2026-04-01" }] };
  const b = { role: "Coordinator (2)", raRows: [{ id: 2, start: "2026-03-01", end: "2026-08-01" }] };
  // member covers Mar → overlaps both → nothing
  assert.equal(pickAutoConsumeWindow([a, b], d("2026-03-05"), d("2026-03-20")), null);
  // member covers only the late slot's tail → unique → retires only that one
  const hit = pickAutoConsumeWindow([a, b], d("2026-06-01"), d("2026-07-01"));
  assert.ok(hit);
  assert.deepEqual(hit!.raIds, [2]);
});

t("partial overlap counts; zero overlap fails closed", () => {
  const candidates = [{
    role: "Engineer",
    raRows: [{ id: 5, start: "2026-06-01", end: "2026-08-31" }],
  }];
  assert.ok(pickAutoConsumeWindow(candidates, d("2026-08-15"), d("2026-10-01")));
  assert.equal(pickAutoConsumeWindow(candidates, d("2026-09-01"), d("2026-10-01")), null);
  assert.equal(pickAutoConsumeWindow(candidates, d("2026-01-01"), d("2026-05-31")), null);
});

t("unparseable member dates fail closed", () => {
  const candidates = [{ role: "R", raRows: [{ id: 1, start: "2026-01-01", end: "2026-12-31" }] }];
  assert.equal(pickAutoConsumeWindow(candidates, NaN, d("2026-06-01")), null);
  assert.equal(pickAutoConsumeWindow(candidates, d("2026-06-01"), NaN), null);
});

t("candidate with an unparseable row never matches, other candidates still can", () => {
  const candidates = [
    { role: "A", raRows: [{ id: 1, start: "", end: "2026-06-01" }] },
    { role: "B", raRows: [{ id: 2, start: "2026-05-01", end: "2026-07-01" }] },
  ];
  const hit = pickAutoConsumeWindow(candidates, d("2026-05-15"), d("2026-06-15"));
  assert.ok(hit);
  assert.equal(hit!.role, "B");
  assert.deepEqual(hit!.raIds, [2]);
});

t("two overlapping candidates → ambiguous → null; unique overlap → that one", () => {
  const candidates = [
    { role: "Later",   raRows: [{ id: 1, start: "2026-03-01", end: "2026-06-01" }] },
    { role: "Earlier", raRows: [{ id: 2, start: "2026-02-01", end: "2026-02-20" }] },
  ];
  // member overlaps only "Later" → unique
  const hit = pickAutoConsumeWindow(candidates, d("2026-04-01"), d("2026-05-01"));
  assert.ok(hit);
  assert.equal(hit!.role, "Later");
  // member overlaps both → ambiguous
  assert.equal(pickAutoConsumeWindow(candidates, d("2026-02-10"), d("2026-04-01")), null);
});

t("no candidates → null", () => {
  assert.equal(pickAutoConsumeWindow([], d("2026-01-01"), d("2026-12-31")), null);
});

console.log(`\nopenSlotMatch: ${passed} tests passed`);
