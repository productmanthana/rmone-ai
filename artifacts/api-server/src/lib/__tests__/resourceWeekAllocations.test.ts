/**
 * Executable unit tests for task #590 — resource weekly workload aggregation.
 *
 * Section A — parseWeekKeyToMondayMs: DD-Mon-YY ↔ ISO round-trip
 * Section B — spreadHoursByWeek: hours distribution contract
 * Section C — buildResourceWeekBuckets: the core dedupe / narrow-wins algorithm
 *   C1  narrow row written directly into its bucket
 *   C2  broad container suppressed for a week already owned by a narrow row
 *   C3  broad container fills weeks with NO narrow row (legitimate fallback)
 *   C4  two narrow rows on the same project/week AGGREGATE (separate assignments)
 *   C5  narrow row + broad row on DIFFERENT projects in the same week both appear
 *   C6  only duplicate projections of the same RA identity are collapsed
 *   C7  unfilled rows (hours=0, pct=0) are excluded
 *   C8  PctAllocation fallback is interpreted as raw hours
 *   C9  broad PctAllocation-hours row fills only unclaimed weeks
 *   C10 multi-week broad row partially overlapping narrow: claimed weeks suppressed,
 *       unclaimed weeks contributed
 *   C11 window filter: buckets outside [windowStart, windowEnd] are omitted
 *   C12 flags (isLocked, isNonChargeable, isSoftAllocation) propagate
 *   C13 narrow PctAllocation-hours row preserves raw/decimal hours
 *   C14–C16 narrow/broad boundary: Wed→Tue + 8-day rows collapse to ONE
 *            canonical Monday (grid/editor identity); 10-day rows are broad
 *   C17 zero-hour placeholders do not suppress a positive dated total
 *   C18 flags are allocation-level: a lock on a suppressed container still
 *        stamps every bucket of that project (Team grid FLAGS parity)
 * Section D — rds-provider.ts source checks (export, SQL guards, VarChar binding)
 * Section E — rmone-proxy.ts route checks (401 / 400 / 502)
 * Section F — api.ts web helper checks
 * Section G — mergeMemberWeeklyHours: the team-grid weekly view shares the
 *             narrow-wins + even-spread rule with this engine (one entry per
 *             week; lump/container rows never land whole in their start week)
 * Section H — date-independent membership recordset: the batch's SECOND
 *             statement feeds projects[] with every live assignment and NO
 *             date predicates, so zero-hour assignments and assignments dated
 *             entirely outside the requested window still reach the popups
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  spreadHoursByWeek,
  buildResourceWeekBuckets,
  parseWeekKeyToMondayMs,
  mergeMemberWeeklyHours,
  allocationSpanWeekCount,
  type RawAllocRow,
} from "../rds-provider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rdsProviderSrc = readFileSync(
  path.resolve(__dirname, "../rds-provider.ts"),
  "utf8",
);
const rmoneProxySrc = readFileSync(
  path.resolve(__dirname, "../../routes/rmone-proxy.ts"),
  "utf8",
);
const apiTsSrc = readFileSync(
  path.resolve(__dirname, "../../../../rmone-web/src/lib/api.ts"),
  "utf8",
);

// ─── tiny test runner ─────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${(e as Error).message}`);
    failed++;
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const MON_2025_06_16 = Date.UTC(2025, 5, 16); // Monday 2025-06-16
const MON_2025_06_23 = MON_2025_06_16 + WEEK;
const MON_2025_06_30 = MON_2025_06_23 + WEEK;
const MON_2025_07_07 = MON_2025_06_30 + WEEK;

/** Build a minimal RawAllocRow with defaults. */
function row(patch: Partial<RawAllocRow> & { projectId: string; startMs: number; endMs: number }): RawAllocRow {
  return {
    id: 1,
    projectName: "Test Project",
    hours: 32,
    pct: 0,
    isLocked: false,
    isNonChargeable: false,
    isSoftAllocation: false,
    ...patch,
  };
}

const WINDOW_START = "2025-06-16";
const WINDOW_END   = "2025-07-13";
const FWH = 40; // fullWeekHours

// ─── A) parseWeekKeyToMondayMs ────────────────────────────────────────────────
console.log("\nA) parseWeekKeyToMondayMs");

test("returns null for empty string", () => {
  assert.equal(parseWeekKeyToMondayMs(""), null);
});
test("returns null for ISO format (wrong shape)", () => {
  assert.equal(parseWeekKeyToMondayMs("2025-06-16"), null);
  assert.equal(parseWeekKeyToMondayMs("foo"), null);
});
test("round-trips a known Monday 16-Jun-25", () => {
  const ms = parseWeekKeyToMondayMs("16-Jun-25");
  assert.ok(ms !== null);
  const d = new Date(ms!);
  assert.equal(d.getUTCFullYear(), 2025);
  assert.equal(d.getUTCMonth(), 5);
  assert.equal(d.getUTCDate(), 16);
});
test("round-trips 06-Jan-25", () => {
  const ms = parseWeekKeyToMondayMs("06-Jan-25");
  assert.ok(ms !== null);
  const d = new Date(ms!);
  assert.equal(d.getUTCFullYear(), 2025);
  assert.equal(d.getUTCMonth(), 0);
  assert.equal(d.getUTCDate(), 6);
});
test("round-trips 29-Dec-25", () => {
  const ms = parseWeekKeyToMondayMs("29-Dec-25");
  assert.ok(ms !== null);
  const d = new Date(ms!);
  assert.equal(d.getUTCFullYear(), 2025);
  assert.equal(d.getUTCMonth(), 11);
  assert.equal(d.getUTCDate(), 29);
});

// ─── B) spreadHoursByWeek ─────────────────────────────────────────────────────
console.log("\nB) spreadHoursByWeek");

test("single-week returns one entry with full hours", () => {
  const pairs = spreadHoursByWeek(new Date(MON_2025_06_16), new Date(MON_2025_06_16 + 6 * DAY), 32, 40);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0][1], 32);
});
test("two-week span distributes hours, sum preserved", () => {
  const pairs = spreadHoursByWeek(new Date(MON_2025_06_16), new Date(MON_2025_06_23 + 6 * DAY), 80, 40);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0][1] + pairs[1][1], 80);
});
test("total always equals round(input)", () => {
  const pairs = spreadHoursByWeek(new Date("2025-01-06T00:00:00Z"), new Date("2025-03-30T00:00:00Z"), 200, 40);
  const total = pairs.reduce((s, [, h]) => s + h, 0);
  assert.equal(total, Math.round(200));
});
test("excess after cap rides last week; total preserved", () => {
  const pairs = spreadHoursByWeek(new Date(MON_2025_06_16), new Date(MON_2025_07_07 + 6 * DAY), 200, 40);
  assert.equal(pairs.length, 4);
  assert.equal(pairs.reduce((s, [, h]) => s + h, 0), 200);
});

// ─── C) buildResourceWeekBuckets ─────────────────────────────────────────────
console.log("\nC) buildResourceWeekBuckets — narrow-wins algorithm");

// C1: single narrow row lands in the correct bucket
test("C1 narrow row: hours appear in correct project/week bucket", () => {
  const rows = [row({ id: 1, projectId: "P1", startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 32 })];
  const buckets = buildResourceWeekBuckets(rows, FWH, WINDOW_START, WINDOW_END);
  const b = buckets.get("P1|2025-06-16");
  assert.ok(b, "bucket must exist for P1 week 2025-06-16");
  assert.equal(b!.hours, 32);
  assert.deepEqual(b!.ids, [1]);
});

// C14–C16 (grouped with C1: narrow/broad classification boundary — must stay
// in LOCKSTEP with the Team grid's isNarrowSpan rule and canonicalMondayWeekWindow)

// C14: legacy Wed→Tue narrow row collapses to ONE canonical Monday bucket
test("C14 Wed→Tue narrow row lands WHOLE on the Monday it crosses", () => {
  // Wed 18-Jun-25 → Tue 24-Jun-25 touches two Monday windows, but it is one
  // week's booking: full hours on Monday 23-Jun, nothing smeared into 16-Jun.
  const rows = [row({ id: 1, projectId: "P1",
    startMs: MON_2025_06_16 + 2 * DAY, endMs: MON_2025_06_23 + 1 * DAY, hours: 27.5 })];
  const buckets = buildResourceWeekBuckets(rows, FWH, WINDOW_START, WINDOW_END);
  const b = buckets.get("P1|2025-06-23");
  assert.ok(b, "canonical Monday bucket must exist");
  assert.equal(b!.hours, 27.5, "full hours in ONE week, never split");
  assert.equal(buckets.get("P1|2025-06-16"), undefined, "no share in the start's Monday window");
});

// C15: 8-day Mon→next-Mon narrow row stays whole in its start Monday week
test("C15 8-day Mon→Mon narrow row keeps its start Monday (no second bucket)", () => {
  const rows = [row({ id: 1, projectId: "P1",
    startMs: MON_2025_06_16, endMs: MON_2025_06_23, hours: 40 })];
  const buckets = buildResourceWeekBuckets(rows, FWH, WINDOW_START, WINDOW_END);
  const b = buckets.get("P1|2025-06-16");
  assert.ok(b, "start Monday bucket must exist");
  assert.equal(b!.hours, 40);
  assert.equal(buckets.get("P1|2025-06-23"), undefined, "8-day row is still ONE week");
});

// C16: a 10-calendar-day row (9 elapsed days) is BROAD — spread, not collapsed
test("C16 10-day row is broad: split across its two Monday weeks, total preserved", () => {
  const rows = [row({ id: 1, projectId: "P1",
    startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 9 * DAY, hours: 50 })];
  const buckets = buildResourceWeekBuckets(rows, FWH, WINDOW_START, WINDOW_END);
  const b1 = buckets.get("P1|2025-06-16");
  const b2 = buckets.get("P1|2025-06-23");
  assert.ok(b1 && b2, "both Monday windows get a share");
  assert.equal(Math.round((b1!.hours + b2!.hours) * 100) / 100, 50, "total preserved");
});

// C2: broad container suppressed when narrow row owns the same project/week
test("C2 broad container suppressed when narrow row owns the week", () => {
  const narrowRow = row({ id: 1, projectId: "P1",
    startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 32 });
  // Broad row covers 4 weeks including 2025-06-16
  const broadRow = row({ id: 2, projectId: "P1",
    startMs: MON_2025_06_16, endMs: MON_2025_07_07 + 6 * DAY, hours: 160 });
  const buckets = buildResourceWeekBuckets([narrowRow, broadRow], FWH, WINDOW_START, WINDOW_END);
  const b = buckets.get("P1|2025-06-16");
  assert.ok(b, "bucket must exist");
  // Only the narrow row's 32h should be present; broad must NOT add its 40h share
  assert.equal(b!.hours, 32, `expected 32h (narrow only), got ${b!.hours}`);
  // The broad row's ID must NOT appear in this slot
  assert.ok(!b!.ids.includes(2), "broad row ID must not appear in a narrow-owned slot");
});

// C3: broad container fills weeks with NO narrow row (legitimate fallback)
test("C3 broad container fills unclaimed weeks", () => {
  // Only one narrow row on week 0; broad row spans weeks 0–3
  const narrowRow = row({ id: 1, projectId: "P1",
    startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 32 });
  const broadRow = row({ id: 2, projectId: "P1",
    startMs: MON_2025_06_16, endMs: MON_2025_07_07 + 6 * DAY, hours: 160 });
  const buckets = buildResourceWeekBuckets([narrowRow, broadRow], FWH, WINDOW_START, WINDOW_END);
  // Weeks 1–3 must have the broad row's contribution (~40h each)
  const b1 = buckets.get("P1|2025-06-23");
  const b2 = buckets.get("P1|2025-06-30");
  const b3 = buckets.get("P1|2025-07-07");
  assert.ok(b1, "week 2 must have a bucket (broad fills it)");
  assert.ok(b2, "week 3 must have a bucket (broad fills it)");
  assert.ok(b3, "week 4 must have a bucket (broad fills it)");
  assert.ok(b1!.hours > 0);
  assert.ok(b2!.hours > 0);
  assert.ok(b3!.hours > 0);
  // The broad row's ID must appear in the unclaimed slots
  assert.ok(b1!.ids.includes(2), "broad row ID must appear in unclaimed week 2");
});

// C4: two narrow rows on the same project/week AGGREGATE
test("C4 two narrow rows on the same project/week aggregate (separate assignments)", () => {
  const r1 = row({ id: 1, projectId: "P1", startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 20 });
  const r2 = row({ id: 2, projectId: "P1", startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 12 });
  const buckets = buildResourceWeekBuckets([r1, r2], FWH, WINDOW_START, WINDOW_END);
  const b = buckets.get("P1|2025-06-16");
  assert.ok(b, "bucket must exist");
  assert.equal(b!.hours, 32, `expected 32h (20+12), got ${b!.hours}`);
  assert.ok(b!.ids.includes(1) && b!.ids.includes(2), "both row IDs must appear");
});

// C4b: three narrow rows on the same week for separate role assignments
test("C4b three narrow rows aggregate correctly", () => {
  const r1 = row({ id: 10, projectId: "P2", startMs: MON_2025_06_23, endMs: MON_2025_06_23 + 6 * DAY, hours: 10 });
  const r2 = row({ id: 11, projectId: "P2", startMs: MON_2025_06_23, endMs: MON_2025_06_23 + 6 * DAY, hours: 15 });
  const r3 = row({ id: 12, projectId: "P2", startMs: MON_2025_06_23, endMs: MON_2025_06_23 + 6 * DAY, hours: 5 });
  const buckets = buildResourceWeekBuckets([r1, r2, r3], FWH, WINDOW_START, WINDOW_END);
  const b = buckets.get("P2|2025-06-23");
  assert.ok(b, "bucket must exist");
  assert.equal(b!.hours, 30, `expected 30h (10+15+5), got ${b!.hours}`);
});

// C5: narrow rows on different projects in the same week are independent
test("C5 narrow rows on different projects both appear independently", () => {
  const rA = row({ id: 1, projectId: "PA", startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 20 });
  const rB = row({ id: 2, projectId: "PB", startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 16 });
  const buckets = buildResourceWeekBuckets([rA, rB], FWH, WINDOW_START, WINDOW_END);
  assert.equal(buckets.get("PA|2025-06-16")?.hours, 20);
  assert.equal(buckets.get("PB|2025-06-16")?.hours, 16);
});

// C5b: a broad row on project B does NOT interfere with narrow rows on project A
test("C5b broad row on project B does not suppress narrow row on project A", () => {
  const narrowA = row({ id: 1, projectId: "PA", startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 20 });
  const broadB  = row({ id: 2, projectId: "PB", startMs: MON_2025_06_16, endMs: MON_2025_07_07 + 6 * DAY, hours: 160 });
  const buckets = buildResourceWeekBuckets([narrowA, broadB], FWH, WINDOW_START, WINDOW_END);
  // PA week 0 must have only the narrow row's 20h
  assert.equal(buckets.get("PA|2025-06-16")?.hours, 20);
  // PB week 0 must have the broad row's share (no narrow for PB)
  assert.ok((buckets.get("PB|2025-06-16")?.hours ?? 0) > 0);
});

// C6: distinct same-shaped rows are legitimate and aggregate; duplicate
// projections of the SAME RA identity collapse.
test("C6 distinct same-shaped rows aggregate", () => {
  const r1 = row({ id: 1, projectId: "P1", startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 32 });
  const r2 = row({ id: 2, projectId: "P1", startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 32 });
  const buckets = buildResourceWeekBuckets([r1, r2], FWH, WINDOW_START, WINDOW_END);
  assert.equal(buckets.get("P1|2025-06-16")?.hours, 64);
});

test("C6b same RA identity projected twice is collapsed", () => {
  const b1 = row({ id: 1, projectId: "P1", startMs: MON_2025_06_16, endMs: MON_2025_07_07 + 6 * DAY, hours: 160 });
  const b2 = row({ id: 1, projectId: "P1", startMs: MON_2025_06_16, endMs: MON_2025_07_07 + 6 * DAY, hours: 160 });
  const buckets = buildResourceWeekBuckets([b1, b2], FWH, WINDOW_START, WINDOW_END);
  // Total across 4 weeks should be 160, not 320
  const total = Array.from(buckets.values())
    .filter((b) => b.projectId === "P1")
    .reduce((s, b) => s + b.hours, 0);
  assert.equal(total, 160, `expected 160h total (deduped broad), got ${total}`);
});

// C7: unfilled rows (hours=0, pct=0) are excluded
test("C7 unfilled rows (hours=0 AND pct=0) are excluded", () => {
  const empty = row({ id: 1, projectId: "P1", startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 0, pct: 0 });
  const buckets = buildResourceWeekBuckets([empty], FWH, WINDOW_START, WINDOW_END);
  assert.equal(buckets.size, 0, "unfilled rows must produce no buckets");
});

// C8: PctAllocation is raw hours, even when it is greater than 150.
test("C8 PctAllocation fallback is interpreted as raw hours", () => {
  const legacy = row({ id: 1, projectId: "P1", startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 0, pct: 40 });
  const buckets = buildResourceWeekBuckets([legacy], FWH, WINDOW_START, WINDOW_END);
  assert.equal(buckets.get("P1|2025-06-16")?.hours, 40);
});

// C9: broad percent-only row fills only unclaimed weeks
test("C9 broad percent-only row fills unclaimed weeks; narrow hours row wins", () => {
  // Narrow hours row for week 0
  const narrowRow = row({ id: 1, projectId: "P1",
    startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 32 });
  // Broad legacy row covering weeks 0–3 (PctAllocation stores 80 raw hours)
  const broadPct  = row({ id: 2, projectId: "P1",
    startMs: MON_2025_06_16, endMs: MON_2025_07_07 + 6 * DAY, hours: 0, pct: 80 });
  const buckets = buildResourceWeekBuckets([narrowRow, broadPct], FWH, WINDOW_START, WINDOW_END);
  // Week 0: only narrow (32h)
  assert.equal(buckets.get("P1|2025-06-16")?.hours, 32, "week 0 must use narrow hours only");
  assert.ok(!buckets.get("P1|2025-06-16")?.ids.includes(2), "broad pct row must not appear in narrow-owned slot");
  // Weeks 1–3: broad raw-hours fallback fills them (80 ÷ 4 = 20h/wk)
  const w1 = buckets.get("P1|2025-06-23");
  assert.ok(w1, "week 1 must have a bucket from broad pct");
  assert.ok(Math.abs(w1!.hours - 20) < 1, `week 1 should be ~20h, got ${w1!.hours}`);
});

// C10: broad row partially overlapping narrow — claimed weeks suppressed, unclaimed contributed
test("C10 broad row: claimed weeks suppressed, unclaimed weeks contributed", () => {
  // Narrow rows for weeks 0 and 2 only
  const n0 = row({ id: 1, projectId: "P1", startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 30 });
  const n2 = row({ id: 3, projectId: "P1", startMs: MON_2025_06_30, endMs: MON_2025_06_30 + 6 * DAY, hours: 25 });
  // Broad row covers all 4 weeks (160h total → 40h/wk)
  const broad = row({ id: 10, projectId: "P1", startMs: MON_2025_06_16, endMs: MON_2025_07_07 + 6 * DAY, hours: 160 });
  const buckets = buildResourceWeekBuckets([n0, n2, broad], FWH, WINDOW_START, WINDOW_END);
  // Week 0: narrow only (30h)
  assert.equal(buckets.get("P1|2025-06-16")?.hours, 30, "week 0: narrow wins, must be 30h");
  // Week 1: broad fills (unclaimed, ~40h)
  const w1 = buckets.get("P1|2025-06-23");
  assert.ok(w1, "week 1 must exist from broad");
  assert.ok(w1!.hours > 0, "week 1 broad hours must be > 0");
  assert.ok(!w1!.ids.includes(1) && !w1!.ids.includes(3), "narrow IDs must not appear in broad-only week");
  // Week 2: narrow only (25h)
  assert.equal(buckets.get("P1|2025-06-30")?.hours, 25, "week 2: narrow wins, must be 25h");
  // Week 3: broad fills (unclaimed, ~40h)
  const w3 = buckets.get("P1|2025-07-07");
  assert.ok(w3, "week 3 must exist from broad");
  assert.ok(w3!.hours > 0);
});

// C11: window filter — buckets outside the window are omitted
test("C11 buckets outside [windowStart, windowEnd] are omitted", () => {
  // Row entirely before the window
  const before = row({ id: 1, projectId: "P1",
    startMs: Date.UTC(2025, 4, 5), endMs: Date.UTC(2025, 4, 11), hours: 32 }); // 2025-05-05
  // Row entirely after the window
  const after = row({ id: 2, projectId: "P1",
    startMs: Date.UTC(2025, 7, 4), endMs: Date.UTC(2025, 7, 10), hours: 32 }); // 2025-08-04
  // Row inside the window
  const inside = row({ id: 3, projectId: "P1",
    startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 32 });
  const buckets = buildResourceWeekBuckets([before, after, inside], FWH, WINDOW_START, WINDOW_END);
  // Only the inside row's bucket should appear
  assert.equal(buckets.size, 1, `expected 1 bucket, got ${buckets.size}`);
  assert.ok(buckets.has("P1|2025-06-16"));
});

// C12: flags propagate into the bucket
test("C12 isLocked / isNonChargeable / isSoftAllocation flags propagate", () => {
  const locked = row({ id: 1, projectId: "P1",
    startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 16, isLocked: true });
  const nc = row({ id: 2, projectId: "P1",
    startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 8, isNonChargeable: true });
  const buckets = buildResourceWeekBuckets([locked, nc], FWH, WINDOW_START, WINDOW_END);
  const b = buckets.get("P1|2025-06-16");
  assert.ok(b, "bucket must exist");
  assert.equal(b!.isLocked, true, "isLocked must be true when any contributing row is locked");
  assert.equal(b!.isNonChargeable, true, "isNonChargeable must be true when any row is NC");
  assert.equal(b!.hours, 24, "hours must aggregate (16+8=24)");
});
test("C12b isSoftAllocation propagates from broad fallback row", () => {
  const soft = row({ id: 1, projectId: "P1",
    startMs: MON_2025_06_16, endMs: MON_2025_07_07 + 6 * DAY,
    hours: 160, isSoftAllocation: true });
  const buckets = buildResourceWeekBuckets([soft], FWH, WINDOW_START, WINDOW_END);
  for (const b of buckets.values()) {
    assert.equal(b.isSoftAllocation, true, "isSoftAllocation must propagate from broad row");
  }
});

// C13: narrow PctAllocation-hours row preserves its exact decimal value.
test("C13 narrow PctAllocation-hours row preserves raw decimals", () => {
  const pctRow = row({ id: 1, projectId: "P1",
    startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY,
    hours: 0, pct: 12.5 });
  const buckets = buildResourceWeekBuckets([pctRow], FWH, WINDOW_START, WINDOW_END);
  const b = buckets.get("P1|2025-06-16");
  assert.ok(b, "bucket must exist for narrow pct row");
  assert.equal(b!.hours, 12.5);
});

// C13b: narrow pct row owns its slot — broad on same project/week suppressed
test("C13b narrow pct row owns slot — broad hours row on same week suppressed", () => {
  const narrowPct = row({ id: 1, projectId: "P1",
    startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 0, pct: 30 });
  const broad = row({ id: 2, projectId: "P1",
    startMs: MON_2025_06_16, endMs: MON_2025_07_07 + 6 * DAY, hours: 160 });
  const buckets = buildResourceWeekBuckets([narrowPct, broad], FWH, WINDOW_START, WINDOW_END);
  const b = buckets.get("P1|2025-06-16");
  // Only the narrow raw-hours contribution (30h), not 30+40
  assert.ok(b, "bucket must exist");
  assert.ok(Math.abs(b!.hours - 30) < 0.01, `expected 30h (narrow pct only), got ${b!.hours}`);
  assert.ok(!b!.ids.includes(2), "broad row must not appear in narrow-owned slot");
});

test("C14 broad container spreads its full total without a 168h total cap", () => {
  const broad = row({ id: 20, projectId: "P1",
    startMs: MON_2025_06_16, endMs: MON_2025_07_07 + 6 * DAY, hours: 320 });
  const buckets = buildResourceWeekBuckets([broad], FWH, WINDOW_START, WINDOW_END);
  const total = Array.from(buckets.values()).reduce((sum, bucket) => sum + bucket.hours, 0);
  assert.equal(total, 320);
  for (const bucket of buckets.values()) assert.equal(bucket.hours, 80);
});

// C17: an empty weekly placeholder does not erase a positive dated total
test("C17 zero-hour narrow row does not suppress container distribution", () => {
  const rows = [
    // Empty weekly placeholder
    row({ id: 1, projectId: "P1", startMs: MON_2025_06_23, endMs: MON_2025_06_23 + 6 * DAY, hours: 0, pct: 0 }),
    // 4-week container: 120h over 06-16..07-13 → 30h/week where unclaimed
    row({ id: 2, projectId: "P1", startMs: MON_2025_06_16, endMs: MON_2025_07_07 + 6 * DAY, hours: 120 }),
  ];
  const buckets = buildResourceWeekBuckets(rows, FWH, WINDOW_START, WINDOW_END);
  assert.equal(buckets.get("P1|2025-06-23")?.hours, 30,
    "positive dated total must fill through an empty weekly placeholder");
  assert.equal(buckets.get("P1|2025-06-16")?.hours, 30);
  assert.equal(buckets.get("P1|2025-06-30")?.hours, 30);
  assert.equal(buckets.get("P1|2025-07-07")?.hours, 30);
  const total = [...buckets.values()].reduce((s, b) => s + b.hours, 0);
  assert.equal(total, 120, "weekly buckets must preserve the complete dated total");
});

// C18: allocation-level flags surface even when the flagged row is suppressed
test("C18 lock on a suppressed container still stamps every project bucket", () => {
  const rows = [
    row({ id: 1, projectId: "P1", startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 32 }),
    row({ id: 2, projectId: "P1", startMs: MON_2025_06_23, endMs: MON_2025_06_23 + 6 * DAY, hours: 24 }),
    // Locked container whose weeks are BOTH claimed above — contributes no
    // hours, but the lock is allocation-level truth (Team grid FLAGS column
    // ORs across all RA rows): the popup must warn upfront instead of letting
    // an edit bounce off the server's 423 lock rejection.
    row({ id: 3, projectId: "P1", startMs: MON_2025_06_16, endMs: MON_2025_06_23 + 6 * DAY, hours: 40, isLocked: true }),
    // Unrelated project must stay untouched by P1's flags.
    row({ id: 4, projectId: "P2", startMs: MON_2025_06_16, endMs: MON_2025_06_16 + 6 * DAY, hours: 8 }),
  ];
  const buckets = buildResourceWeekBuckets(rows, FWH, WINDOW_START, WINDOW_END);
  assert.equal(buckets.get("P1|2025-06-16")?.hours, 32, "suppressed container adds no hours");
  assert.equal(buckets.get("P1|2025-06-23")?.hours, 24, "suppressed container adds no hours");
  assert.equal(buckets.get("P1|2025-06-16")?.isLocked, true, "lock must surface on claimed weeks");
  assert.equal(buckets.get("P1|2025-06-23")?.isLocked, true, "lock must surface on claimed weeks");
  assert.equal(buckets.get("P2|2025-06-16")?.isLocked, false, "flags never leak across projects");
});

// ─── D) rds-provider.ts source checks ────────────────────────────────────────
console.log("\nD) rds-provider.ts source checks");

function extractFn(src: string, name: string): string | null {
  const startIdx = src.indexOf(`async function ${name}(`);
  if (startIdx === -1) return null;
  const after = src.slice(startIdx + 1);
  const nextFn = after.search(/\nexport\s+(async\s+)?function\s|\nexport\s+function\s/);
  return nextFn === -1 ? after : after.slice(0, nextFn);
}

const fnSrc = extractFn(rdsProviderSrc, "getResourceWeekAllocationsRds");

test("getResourceWeekAllocationsRds is exported", () => {
  assert.ok(rdsProviderSrc.includes("export async function getResourceWeekAllocationsRds("));
});
test("buildResourceWeekBuckets is exported", () => {
  assert.ok(rdsProviderSrc.includes("export function buildResourceWeekBuckets("));
});
test("parseWeekKeyToMondayMs is exported", () => {
  assert.ok(rdsProviderSrc.includes("export function parseWeekKeyToMondayMs("));
});
test("RawAllocRow interface is exported", () => {
  assert.ok(rdsProviderSrc.includes("export interface RawAllocRow"));
});
test("ResourceWeekAllocations interface is exported", () => {
  assert.ok(rdsProviderSrc.includes("export interface ResourceWeekAllocations"));
});
test("ResourceWeekAllocRow interface is exported", () => {
  assert.ok(rdsProviderSrc.includes("export interface ResourceWeekAllocRow"));
});
test("contains Deleted=0 predicate on RA rows", () => {
  assert.ok(fnSrc !== null, "function not found");
  assert.ok(
    /ResourceAllocation[\s\S]{0,600}AND\s*\(\s*ra\.Deleted\s*=\s*0\s+OR\s+ra\.Deleted\s+IS\s+NULL\s*\)/i.test(fnSrc!),
  );
});
test("uses sql.VarChar for tid (ticket-ID whitespace bridge)", () => {
  assert.ok(fnSrc !== null);
  assert.ok(fnSrc!.includes("sql.VarChar,   tid") || fnSrc!.includes("sql.VarChar, tid"));
});
test("uses sql.VarChar for resourceId", () => {
  assert.ok(fnSrc !== null);
  assert.ok(fnSrc!.includes("sql.VarChar,   resourceId") || fnSrc!.includes("sql.VarChar, resourceId"));
});
test("liveness guard joins PMM and Opportunity", () => {
  assert.ok(fnSrc !== null);
  assert.ok(/JOIN.*core2\.dbo\.PMM/i.test(fnSrc!) && /JOIN.*core2\.dbo\.Opportunity/i.test(fnSrc!));
});
test("open-position guard uses NULLIF(LTRIM(RTRIM(...)))", () => {
  assert.ok(fnSrc !== null);
  assert.ok(/NULLIF\s*\(\s*LTRIM\s*\(\s*RTRIM/i.test(fnSrc!));
});
test("provider validates date format before querying", () => {
  assert.ok(fnSrc !== null);
  assert.ok(/DATE_RE\.test\(start\)/i.test(fnSrc!));
});
test("provider calls buildResourceWeekBuckets (delegates to pure engine)", () => {
  assert.ok(fnSrc !== null);
  assert.ok(fnSrc!.includes("buildResourceWeekBuckets("), "provider must delegate to the pure engine");
});

// ─── E) rmone-proxy.ts route checks ──────────────────────────────────────────
console.log("\nE) rmone-proxy.ts route checks");

const routeBlock = (() => {
  const idx = rmoneProxySrc.indexOf('"/resource-week-allocations"');
  if (idx === -1) return null;
  return rmoneProxySrc.slice(idx, idx + 3000);
})();

test("route /resource-week-allocations is registered", () => {
  assert.ok(routeBlock !== null, "route not found");
});
test("route returns 401 for unauthenticated requests", () => {
  assert.ok(routeBlock!.includes("status(401)"));
});
test("route returns 400 for bad inputs", () => {
  assert.ok(routeBlock!.includes("status(400)"));
});
test("route validates GUID format for resourceId", () => {
  assert.ok(/GUID_RE\.test\(resourceId\)/.test(routeBlock!));
});
test("route calls getResourceWeekAllocationsRds", () => {
  assert.ok(routeBlock!.includes("getResourceWeekAllocationsRds("));
});
test("route passes rds.tid for tenant scoping", () => {
  assert.ok(routeBlock!.includes("rds.tid"));
});
test("route returns 502 on provider error (not fake empty data)", () => {
  assert.ok(routeBlock!.includes("502"));
});
test("getResourceWeekAllocationsRds imported in rmone-proxy.ts", () => {
  assert.ok(rmoneProxySrc.includes("getResourceWeekAllocationsRds"));
});

// ─── F) api.ts web helper checks ─────────────────────────────────────────────
console.log("\nF) api.ts web helper checks");

test("getResourceWeekAllocations exported from api.ts", () => {
  assert.ok(apiTsSrc.includes("export async function getResourceWeekAllocations("));
});
test("ResourceWeekAllocRow exported from api.ts", () => {
  assert.ok(apiTsSrc.includes("export interface ResourceWeekAllocRow"));
});
test("ResourceWeekAllocations exported from api.ts", () => {
  assert.ok(apiTsSrc.includes("export interface ResourceWeekAllocations"));
});
test("helper calls /resource-week-allocations endpoint", () => {
  assert.ok(apiTsSrc.includes("/resource-week-allocations"));
});
test("helper uses URLSearchParams", () => {
  assert.ok(apiTsSrc.includes("URLSearchParams"));
});
test("helper uses authHeaders()", () => {
  const idx = apiTsSrc.indexOf("async function getResourceWeekAllocations(");
  assert.ok(idx !== -1);
  assert.ok(apiTsSrc.slice(idx, idx + 600).includes("authHeaders()"));
});
test("helper uses handleResponse (throws on non-2xx)", () => {
  const idx = apiTsSrc.indexOf("async function getResourceWeekAllocations(");
  assert.ok(idx !== -1);
  assert.ok(apiTsSrc.slice(idx, idx + 600).includes("handleResponse("));
});

// ─── G) mergeMemberWeeklyHours — team-grid weekly view parity ────────────────
console.log("\nG) mergeMemberWeeklyHours — narrow-wins merge for the team grid");

test("G1 two stacked lump rows spread evenly — never dumped into the start week", () => {
  // The Laura case: 200h + 240h containers, both Mon 2026-08-03 → Fri 2026-11-20
  // (16 Monday weeks). Grid must show 27.5h every week — matching the workload
  // popup — instead of 440h crammed under Aug 03.
  const out = mergeMemberWeeklyHours([], [
    { start: "2026-08-03", end: "2026-11-20", hours: 200 },
    { start: "2026-08-03", end: "2026-11-20", hours: 240 },
  ]);
  assert.equal(out.length, 16);
  assert.equal(out[0].week, "2026-08-03");
  assert.equal(out[out.length - 1].week, "2026-11-16");
  for (const e of out) assert.equal(e.hours, 27.5);
  const sum = out.reduce((s, e) => s + e.hours, 0);
  assert.equal(Math.round(sum * 100) / 100, 440);
});

test("G2 a weekly row owns its week — broad hours fill only unclaimed weeks", () => {
  const out = mergeMemberWeeklyHours(
    [{ week: "2026-08-10", hours: 30 }],
    [{ start: "2026-08-03", end: "2026-11-20", hours: 160 }], // 10h/week over 16 weeks
  );
  const map = Object.fromEntries(out.map((e) => [e.week, e.hours]));
  assert.equal(map["2026-08-10"], 30);      // narrow value, NOT 30+10
  assert.equal(map["2026-08-03"], 10);
  assert.equal(map["2026-11-16"], 10);
  assert.equal(out.length, 16);
});

test("G3 two weekly rows on the same week SUM into one entry", () => {
  const out = mergeMemberWeeklyHours(
    [
      { week: "2026-08-03", hours: 12 },
      { week: "2026-08-03", hours: 8 },
    ],
    [],
  );
  assert.deepEqual(out, [{ week: "2026-08-03", hours: 20 }]);
});

test("G4 output is one entry per week, ascending", () => {
  const out = mergeMemberWeeklyHours(
    [
      { week: "2026-08-17", hours: 5 },
      { week: "2026-08-03", hours: 7 },
      { week: "2026-08-17", hours: 5 },
    ],
    [],
  );
  assert.deepEqual(out.map((e) => e.week), ["2026-08-03", "2026-08-17"]);
  assert.deepEqual(out.map((e) => e.hours), [7, 10]);
});

test("G5 zero/negative lump rows and zero-hour weeks are dropped from OUTPUT", () => {
  const out = mergeMemberWeeklyHours(
    [{ week: "2026-08-03", hours: 0 }],
    [
      { start: "2026-08-03", end: "2026-09-20", hours: 0 },
      { start: "2026-08-03", end: "2026-09-20", hours: -40 },
    ],
  );
  assert.deepEqual(out, []);
});

test("G5b zero-hour placeholder does not suppress same-project lump fill", () => {
  // 20h lump over two weeks (08-03 + 08-10) → 10h each. The empty weekly
  // placeholder must not make the positive dated total disappear.
  const out = mergeMemberWeeklyHours(
    [{ week: "2026-08-03", hours: 0 }],
    [{ start: "2026-08-03", end: "2026-08-16", hours: 20 }],
  );
  assert.deepEqual(out, [
    { week: "2026-08-03", hours: 10 },
    { week: "2026-08-10", hours: 10 },
  ]);
});

test("G5c 5,000-hour dated total survives zero weekly placeholders", () => {
  const zeroWeeks = [
    "2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24",
    "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21",
  ].map((week) => ({ week, hours: 0 }));
  const out = mergeMemberWeeklyHours(
    zeroWeeks,
    [{ start: "2026-08-03", end: "2026-09-27", hours: 5_000 }],
  );
  assert.equal(out.length, 8);
  assert.deepEqual(out.map((entry) => entry.hours), Array(8).fill(625));
  assert.equal(out.reduce((sum, entry) => sum + entry.hours, 0), 5_000);
});

test("G6 uneven spread keeps the exact total (remainder in the last week)", () => {
  // 100h over 3 weeks → 33.33 + 33.33 + 33.34
  const out = mergeMemberWeeklyHours([], [
    { start: "2026-08-03", end: "2026-08-21", hours: 100 },
  ]);
  assert.deepEqual(out.map((e) => e.hours), [33.33, 33.33, 33.34]);
  assert.equal(Math.round(out.reduce((s, e) => s + e.hours, 0) * 100) / 100, 100);
});

test("G7 single-day degenerate lump lands on its own Monday week", () => {
  const out = mergeMemberWeeklyHours([], [
    { start: "2026-08-05", end: "2026-08-05", hours: 16 }, // Wed → week of Mon 08-03
  ]);
  assert.deepEqual(out, [{ week: "2026-08-03", hours: 16 }]);
});

test("G8 10-day lump row spreads across two weeks (matches engine C16 classification)", () => {
  // The grid's isNarrowSpan rule sends a 10-calendar-day row to broadRows —
  // same as the engine's ≤8-elapsed-days boundary — so both surfaces split it.
  const out = mergeMemberWeeklyHours([], [
    { start: "2026-08-03", end: "2026-08-12", hours: 50 },
  ]);
  assert.deepEqual(out.map((e) => e.week), ["2026-08-03", "2026-08-10"]);
  assert.equal(Math.round(out.reduce((s, e) => s + e.hours, 0) * 100) / 100, 50);
});

test("G8b direct range percentage uses every Monday bucket touched by the dates", () => {
  // Aug 1–Oct 13 touches twelve Monday-aligned buckets. A 120h total at
  // 40h/week is therefore 25%, not 27% from rounded calendar-day division.
  assert.equal(allocationSpanWeekCount("2026-08-01", "2026-10-13"), 12);
  assert.equal(Math.round((120 / (allocationSpanWeekCount("2026-08-01", "2026-10-13") * 40)) * 100), 25);
  // Preserve the canonical single-week treatment for narrow legacy rows.
  assert.equal(allocationSpanWeekCount("2026-08-05", "2026-08-11"), 1);
});

test("G9 getProjectTeamRds does not let zero rows suppress a positive total", () => {
  // Regression guard for the 5,000h case: zero weekly placeholders must not be
  // pushed into the merge as claims, or every weekly cell becomes 0 while EAC
  // still shows the positive total.
  const teamFnSrc = extractFn(rdsProviderSrc, "getProjectTeamRds");
  assert.ok(teamFnSrc !== null, "getProjectTeamRds not found");
  // Match CODE, not prose: strip comments so a commented-out constant or an
  // explanatory remark can never satisfy the asserts below.
  const code = teamFnSrc!
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const branch = /if\s*\(!validHours\)\s*\{([\s\S]*?)\n\s*continue;\s*\n\s*\}/.exec(code);
  assert.ok(branch, "expected a !validHours block ending in continue");
  const body = branch![1];
  assert.doesNotMatch(body, /row\.weeklyHours\.push/,
    "zero-hour rows must not be passed to mergeMemberWeeklyHours as claims");
});

// ─── H) Date-independent membership recordset (zero-hour / out-of-window) ────
console.log("\nH) date-independent membership recordset (zero-hour / out-of-window)");

// The popup's projects[] list comes from the batch's SECOND statement. A
// brand-new team member whose every assignment is zero-hour — or whose
// allocation dates fall entirely OUTSIDE the requested start/end window —
// produces no weeks buckets, so ONLY this recordset makes their projects
// appear in the popups at all. These checks pin the recordset's shape: if a
// date predicate ever creeps in (or the mapping stops reading recordsets[1]),
// out-of-window assignments silently vanish again.
const membershipStart = fnSrc?.indexOf("Second recordset") ?? -1;
const membershipEnd = membershipStart >= 0 ? fnSrc!.indexOf("`)", membershipStart) : -1;
const membershipSql = membershipStart >= 0 && membershipEnd > membershipStart
  ? fnSrc!.slice(membershipStart, membershipEnd)
  : null;

test("H1 the query batch carries a second, membership-only statement", () => {
  assert.ok(fnSrc !== null, "getResourceWeekAllocationsRds not found");
  assert.ok(
    membershipSql !== null,
    "second-recordset marker (\"Second recordset\") not found inside the SQL batch",
  );
});

test("H2 membership statement lists BOTH direct-RA and bare RWI assignments, deduped", () => {
  assert.ok(membershipSql !== null);
  assert.ok(/ra\.ResourceUser\s*=\s*@person/.test(membershipSql!), "RA branch must filter on ra.ResourceUser = @person");
  assert.ok(/rwi\.ResourceUser\s*=\s*@person/.test(membershipSql!), "RWI branch must filter on rwi.ResourceUser = @person");
  assert.ok(/SELECT\s+rwi\.WorkItem/i.test(membershipSql!), "RWI branch must project rwi.WorkItem as the ticket");
  assert.ok(/\bUNION\b/.test(membershipSql!), "RA and RWI branches must UNION (dedupe)");
  assert.ok(/SELECT\s+DISTINCT/i.test(membershipSql!), "membership rows must be DISTINCT per ticket");
  assert.ok(
    /\(\s*ra\.Deleted\s*=\s*0\s+OR\s+ra\.Deleted\s+IS\s+NULL\s*\)/.test(membershipSql!),
    "RA branch must exclude deleted rows",
  );
  assert.ok(
    /\(\s*rwi\.Deleted\s*=\s*0\s+OR\s+rwi\.Deleted\s+IS\s+NULL\s*\)/.test(membershipSql!),
    "RWI branch must exclude deleted rows",
  );
});

test("H3 membership statement has NO date predicate — an assignment dated entirely outside the requested window still qualifies", () => {
  assert.ok(membershipSql !== null);
  for (const forbidden of ["@start", "@end", "AllocationStartDate", "AllocationEndDate"]) {
    assert.ok(
      !membershipSql!.includes(forbidden),
      `membership recordset must stay date-independent; found "${forbidden}" — ` +
        "zero-hour / out-of-window assignments would drop out of projects[]",
    );
  }
});

test("H4 contrast: the FIRST (weeks) statement DOES window-filter on @start/@end", () => {
  assert.ok(fnSrc !== null && membershipStart >= 0);
  const weeksStatement = fnSrc!.slice(0, membershipStart);
  assert.ok(/AllocationStartDate\s*<=\s*@end/.test(weeksStatement), "in_range must clip by AllocationStartDate <= @end");
  assert.ok(/AllocationEndDate\s*>=\s*@start/.test(weeksStatement), "in_range must clip by AllocationEndDate >= @start");
});

test("H5 membership rows keep the project-liveness guard (no ghost projects)", () => {
  assert.ok(membershipSql !== null);
  assert.ok(
    /COALESCE\(p\.TicketId,\s*o\.TicketId,\s*l\.TicketId\)\s+IS\s+NOT\s+NULL/.test(membershipSql!),
    "membership recordset must keep the PMM/Opportunity/Lead liveness guard",
  );
});

test("H6 provider maps recordsets[1] into projects[] (membership first, in-window rows only backfill)", () => {
  assert.ok(fnSrc !== null);
  assert.ok(fnSrc!.includes("?.[1]"), "provider must read the SECOND recordset (recordsets[1])");
  const memberSeed = fnSrc!.indexOf("for (const m of memberRows) addProject");
  const backfill = fnSrc!.indexOf("for (const row of rawRows) addProject");
  assert.ok(memberSeed >= 0, "membership rows must seed projects[] via addProject");
  assert.ok(backfill > memberSeed, "in-window rows may only merge in AFTER membership rows (name backfill)");
  assert.ok(
    fnSrc!.includes("return { resourceId, start, end, fullWeekHours, weeks, projects }"),
    "provider must return the projects list alongside weeks",
  );
});

test("H7 web contract: ResourceWeekAllocations carries the optional projects[] list", () => {
  assert.ok(
    apiTsSrc.includes("projects?: { projectId: string; projectName: string }[]"),
    "web api.ts must keep the optional projects[] field consumers use to seed zero-hour rows",
  );
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
if (failed === 0) {
  console.log(`✓ All ${passed} tests passed.`);
} else {
  console.log(`${passed} passed, ${failed} FAILED.`);
  process.exit(1);
}
