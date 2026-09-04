/**
 * Lump ("Total Hours") row replacement regression harness (CI gate).
 * Run: pnpm --filter @workspace/api-server run check:lump-hours
 * (chained into check:hours-win — over the 10-workflow cap, no new workflows)
 *
 * Guards the Aug 2026 fix for stacked hour rows on SHORT assignments: each
 * Edit Assignment "Total Hours" save used to INSERT a new ResourceAllocation
 * row when the assignment spanned ≤ 30 days (the previous save's lump row had
 * hours > 0 with span ≤ 30d, so the old empty-or->30-day UPDATE predicate
 * matched nothing and the fallback inserted a fresh row — verified in prod:
 * 15h + 35h + 62h rows all active for the same Jul 8–28 span → 112h shown).
 *
 * The REAL classification (src/lib/lump-hours.ts, imported directly — it is
 * dependency-free) is driven through simulated repeated saves against an
 * in-memory RA table that applies the plan exactly like assignResourceRds
 * Step 1b does: update the chosen row (hours + new window dates), zero the
 * stale lump rows, insert when no candidate exists. Assertions:
 *   1. Repeated total-hours saves on a short assignment leave EXACTLY ONE
 *      active lump row holding the latest total (same dates and changed dates).
 *   2. Rows already stacked by the old bug are self-healed on the next save.
 *   3. Weekly breakdown rows are never updated or zeroed.
 *   4. Pure-import members (no container row) still get exactly one insert.
 *   5. Long-span container rows keep being updated in place (old behavior).
 * A source-wiring guard asserts rds-provider.ts Step 1b actually calls
 * classifyLumpRows, so the wiring can't silently drift away from this harness.
 *
 * Exit code 0 = all good; 1 = a fixture failure or wiring drift.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyLumpRows, type LumpRowInput } from "../src/lib/lump-hours.js";

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ FAIL: ${label}`);
  }
}

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

// ── In-memory simulation of assignResourceRds Step 1b ───────────────────────
interface SimRow extends LumpRowInput { deleted?: boolean }
let nextId = 1000;

/** Step 1 twin: move empty rows and >30-day hour rows onto the new window. */
function applyStep1(rows: SimRow[], newStart: Date, newEnd: Date) {
  for (const r of rows) {
    if (r.deleted) continue;
    const empty = r.hour == null || r.hour === 0;
    const longSpan =
      (r.hour ?? 0) > 0 && r.start && r.end &&
      (r.end.getTime() - r.start.getTime()) / 86_400_000 > 30;
    if (empty || longSpan) { r.start = newStart; r.end = newEnd; }
  }
}

/** Step 1b twin: classify with the REAL function, apply plan like the server. */
function applyStep1b(
  rows: SimRow[],
  win: { oldStart: Date | null; oldEnd: Date | null; newStart: Date; newEnd: Date },
  hours: number,
) {
  const active = rows.filter((r) => !r.deleted);
  const plan = classifyLumpRows(active, win);
  if (plan.updateId != null) {
    const row = rows.find((r) => r.id === plan.updateId)!;
    row.hour = hours; row.pct = hours;
    row.start = win.newStart; row.end = win.newEnd;
  }
  for (const zid of plan.zeroIds) {
    const row = rows.find((r) => r.id === zid)!;
    row.hour = 0; row.pct = 0;
  }
  if (plan.insert) {
    rows.push({ id: nextId++, hour: hours, pct: hours, start: win.newStart, end: win.newEnd });
  }
  return plan;
}

/** One full Edit Assignment total-hours save (dates + hours). */
function simulateSave(
  rows: SimRow[],
  rwi: { start: Date | null; end: Date | null },
  newStart: Date,
  newEnd: Date,
  hours: number,
) {
  const oldStart = rwi.start, oldEnd = rwi.end;
  rwi.start = newStart; rwi.end = newEnd;          // Step 1: RWI update
  applyStep1(rows, newStart, newEnd);              // Step 1: RA date updates
  return applyStep1b(rows, { oldStart, oldEnd, newStart, newEnd }, hours);
}

const activeLumpRows = (rows: SimRow[]) => rows.filter((r) => !r.deleted && (r.hour ?? 0) > 0);
const totalHours = (rows: SimRow[]) => activeLumpRows(rows).reduce((s, r) => s + (r.hour ?? 0), 0);

// ── 1. Prod repro: short (20-day) assignment, three saves, same window ──────
console.log("Fixture 1: repeated saves on a short assignment (same window)");
{
  const rows: SimRow[] = [];
  const rwi = { start: null as Date | null, end: null as Date | null };
  const s = d("2024-07-08"), e = d("2024-07-28");
  const p1 = simulateSave(rows, rwi, s, e, 15);
  assert(p1.insert && rows.length === 1, "first save inserts the lump row (no container existed)");
  simulateSave(rows, rwi, s, e, 35);
  simulateSave(rows, rwi, s, e, 62);
  assert(rows.length === 1, `no extra rows stacked (rows=${rows.length})`);
  assert(activeLumpRows(rows).length === 1, "exactly one active lump row");
  assert(totalHours(rows) === 62, `total is the LAST save's hours (got ${totalHours(rows)}h, want 62h)`);
}

// ── 2. Self-heal: rows already stacked by the old bug ───────────────────────
console.log("Fixture 2: already-stacked rows are healed by the next save");
{
  const s = d("2024-07-08"), e = d("2024-07-28");
  const rows: SimRow[] = [
    { id: 19713710, hour: 15, pct: 15, start: s, end: e },
    { id: 19713711, hour: 35, pct: 35, start: s, end: e },
    { id: 19713712, hour: 62, pct: 62, start: s, end: e },
  ];
  const rwi = { start: s, end: e };
  const plan = simulateSave(rows, rwi, s, e, 62);
  assert(!plan.insert, "no new row inserted");
  assert(plan.updateId === 19713712, "most recent lump row receives the total");
  assert(activeLumpRows(rows).length === 1, "stale stacked rows zeroed — one active lump row left");
  assert(totalHours(rows) === 62, `member total healed to 62h (got ${totalHours(rows)}h)`);
}

// ── 3. Short assignment with a DATE change between saves ────────────────────
console.log("Fixture 3: short assignment, dates change between saves");
{
  const rows: SimRow[] = [];
  const rwi = { start: null as Date | null, end: null as Date | null };
  simulateSave(rows, rwi, d("2024-07-08"), d("2024-07-28"), 15);
  // Next save moves the window — the old lump row still carries the OLD dates
  // and must be found via the RWI's pre-update window.
  const plan = simulateSave(rows, rwi, d("2024-07-15"), d("2024-08-04"), 40);
  assert(!plan.insert, "moved-window save updates the existing lump row (no insert)");
  assert(rows.length === 1 && totalHours(rows) === 40, "one row, 40h, after the window move");
  assert(rows[0]!.start!.getTime() === d("2024-07-15").getTime()
      && rows[0]!.end!.getTime() === d("2024-08-04").getTime(),
    "lump row dates moved to the new window");
}

// ── 4. Weekly breakdown rows are never clobbered ─────────────────────────────
console.log("Fixture 4: weekly breakdown rows untouched");
{
  const weekly: SimRow[] = [
    { id: 1, hour: 10, pct: 10, start: d("2024-07-08"), end: d("2024-07-14") },
    { id: 2, hour: 12, pct: 12, start: d("2024-07-15"), end: d("2024-07-21") },
    { id: 3, hour: 8,  pct: 8,  start: d("2024-07-22"), end: d("2024-07-28") },
  ];
  const plan = classifyLumpRows(weekly, {
    oldStart: d("2024-07-08"), oldEnd: d("2024-07-28"),
    newStart: d("2024-07-08"), newEnd: d("2024-07-28"),
  });
  assert(plan.updateId == null && plan.zeroIds.length === 0,
    "no weekly row selected for update or zeroing");
  assert(plan.insert, "falls back to inserting a container (pre-fix behavior preserved)");
}

// ── 5. Long-span container keeps being updated in place ─────────────────────
console.log("Fixture 5: long-span container row updated in place");
{
  const rows: SimRow[] = [
    { id: 7, hour: 3840, pct: 3840, start: d("2024-01-01"), end: d("2025-12-31") },
  ];
  const rwi = { start: d("2024-01-01"), end: d("2025-12-31") };
  const plan = simulateSave(rows, rwi, d("2024-01-01"), d("2025-12-31"), 4000);
  assert(!plan.insert && plan.updateId === 7, "container row receives the new total");
  assert(rows.length === 1 && totalHours(rows) === 4000, "one row, updated total");
}

// ── 6. Long → short shrink does not stack ────────────────────────────────────
console.log("Fixture 6: shrinking a long assignment to ≤30 days");
{
  const rows: SimRow[] = [
    { id: 9, hour: 500, pct: 500, start: d("2024-01-01"), end: d("2024-12-31") },
  ];
  const rwi = { start: d("2024-01-01"), end: d("2024-12-31") };
  const plan = simulateSave(rows, rwi, d("2024-07-08"), d("2024-07-28"), 60);
  assert(!plan.insert && plan.updateId === 9, "shrunk container updated, not duplicated");
  assert(rows.length === 1 && totalHours(rows) === 60, "one row, 60h");
  // …and the following short-window save still converges on the same row.
  const plan2 = simulateSave(rows, rwi, d("2024-07-08"), d("2024-07-28"), 45);
  assert(!plan2.insert && rows.length === 1 && totalHours(rows) === 45,
    "next short save updates in place too");
}

// ── 7. Empty container row (pure %-plan / zeroed) receives the hours ────────
console.log("Fixture 7: empty container row is reused, not duplicated");
{
  const rows: SimRow[] = [
    { id: 4, hour: null, pct: 50, start: d("2024-07-01"), end: d("2024-07-31") },
  ];
  const rwi = { start: d("2024-07-01"), end: d("2024-07-31") };
  const plan = simulateSave(rows, rwi, d("2024-07-08"), d("2024-07-28"), 20);
  assert(!plan.insert && plan.updateId === 4, "empty container chosen");
  assert(rows.length === 1 && totalHours(rows) === 20, "one row, 20h");
}

// ── 8. Replace-all: weekly rows + stacked lump collapse to ONE row ──────────
console.log("Fixture 8: replaceAll zeroes weekly rows (prod duplicate-period repro)");
{
  // Prod repro (Aug 2026): weekly import rows (~204h) + a fresh 208h lump
  // stacked by the pre-fix hours edit → TWO visible periods. Replace-all
  // keeps exactly the lump and zeroes every other hours row.
  const rows: LumpRowInput[] = [
    { id: 1, hour: 4,   pct: 0,   start: d("2025-09-15"), end: d("2025-09-21") },
    { id: 2, hour: 4,   pct: 0,   start: d("2025-09-22"), end: d("2025-09-28") },
    { id: 3, hour: 196, pct: 0,   start: d("2025-09-29"), end: d("2026-10-11") },
    { id: 4, hour: 208, pct: 208, start: d("2025-09-15"), end: d("2026-10-11") },
  ];
  const win = {
    oldStart: d("2025-09-15"), oldEnd: d("2026-10-11"),
    newStart: d("2025-09-15"), newEnd: d("2026-10-11"),
  };
  const plan = classifyLumpRows(rows, win, { replaceAll: true });
  assert(plan.updateId === 4 && !plan.insert, "existing lump chosen as the surviving row");
  assert(plan.zeroIds.slice().sort((a, b) => a - b).join(",") === "1,2,3",
    `ALL weekly rows zeroed (got [${plan.zeroIds.join(",")}])`);
  const legacy = classifyLumpRows(rows, win);
  assert(legacy.updateId === 4 && legacy.zeroIds.length === 0,
    "without the flag weekly rows stay untouched (legacy path unchanged)");
}

// ── 9. Replace-all with NO candidate: insert + zero everything else ─────────
console.log("Fixture 9: replaceAll on a pure-weekly member (no lump row yet)");
{
  const rows: LumpRowInput[] = [
    { id: 11, hour: 6, pct: 0, start: d("2024-07-08"), end: d("2024-07-14") },
    { id: 12, hour: 6, pct: 0, start: d("2024-07-15"), end: d("2024-07-21") },
  ];
  const win = {
    oldStart: d("2024-07-08"), oldEnd: d("2024-07-28"),
    newStart: d("2024-07-08"), newEnd: d("2024-07-28"),
  };
  const plan = classifyLumpRows(rows, win, { replaceAll: true });
  assert(plan.insert && plan.updateId == null, "fresh lump inserted");
  assert(plan.zeroIds.slice().sort((a, b) => a - b).join(",") === "11,12",
    "old weekly rows zeroed so the insert doesn't stack a second period");
}

console.log("Fixture 10: replaceAll never targets a legacy null-lookup row (zero-only)");
{
  // Target RWI holds an older lump; a NEWER legacy null-lookup row (targetable:
  // false) also matches the window. The legacy row must be zeroed — never chosen
  // as the update target, or the new total detaches from the RWI being edited.
  const rows: LumpRowInput[] = [
    { id: 21, hour: 62, pct: 62, start: d("2024-07-08"), end: d("2024-07-28") },
    { id: 99, hour: 40, pct: 40, start: d("2024-07-08"), end: d("2024-07-28"), targetable: false },
  ];
  const win = {
    oldStart: d("2024-07-08"), oldEnd: d("2024-07-28"),
    newStart: d("2024-07-08"), newEnd: d("2024-07-28"),
  };
  const plan = classifyLumpRows(rows, win, { replaceAll: true });
  assert(plan.updateId === 21, "target-RWI lump chosen even though legacy row is newer");
  assert(plan.zeroIds.join(",") === "99", "legacy null-lookup row zeroed");

  // Even when the ONLY candidate-shaped rows are legacy ones, fall through to
  // insert (a fresh container on the target RWI) instead of adopting them.
  const planLegacyOnly = classifyLumpRows(
    [{ id: 99, hour: 40, pct: 40, start: d("2024-07-08"), end: d("2024-07-28"), targetable: false }],
    win, { replaceAll: true },
  );
  assert(planLegacyOnly.insert && planLegacyOnly.updateId == null,
    "legacy-only net inserts a fresh target-RWI container");
  assert(planLegacyOnly.zeroIds.join(",") === "99", "legacy row still zeroed on insert path");
}

// ── Wiring guard: Step 1b in rds-provider.ts must use classifyLumpRows ───────
console.log("Wiring guard: rds-provider.ts Step 1b calls classifyLumpRows");
{
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "../src/lib/rds-provider.ts"), "utf8");
  assert(/import \{ classifyLumpRows \} from "\.\/lump-hours\.js"/.test(src),
    "rds-provider imports classifyLumpRows");
  const step1b = src.slice(src.indexOf("Step 1b: persist edited total hours"));
  assert(step1b.includes("classifyLumpRows("),
    "Step 1b calls classifyLumpRows");
  assert(step1b.includes("plan.zeroIds") && step1b.includes("plan.insert"),
    "Step 1b applies zeroIds + insert plan");
  assert(step1b.includes("replaceAll: replaceAllHours"),
    "Step 1b threads the ReplaceAllHours flag into classifyLumpRows");
  assert(step1b.includes("AS IsTarget") && step1b.includes("targetable: Number(r.IsTarget) === 1"),
    "Step 1b marks legacy null-lookup rows as zero-only (never the update target)");
  // ReplaceAllHours saves carry the period's NARROW window: the cross-RWI
  // container-date stamp (Step 1) and cross-RWI zero sweep (Step 2) must both
  // be gated off, or a per-period replace corrupts the member's OTHER
  // legitimate periods (separate RWIs) on the same project.
  const step1 = src.slice(src.indexOf("Step 1: update RWI + container RA rows"), src.indexOf("Step 1b:"));
  assert(/\$\{replaceAllHours \? "" : `[\s\S]*container rows across ALL/.test(step1),
    "Step 1 cross-RWI container stamp skipped under ReplaceAllHours");
  const step2 = src.slice(src.indexOf("Step 2: zero weekly hours outside"));
  assert(/\$\{replaceAllHours \? `` : `[\s\S]*?ResourceWorkItemLookup IS NOT NULL/.test(step2),
    "Step 2 cross-RWI zero branch excluded under ReplaceAllHours");
  assert(!/DATEDIFF\(day, AllocationStartDate, AllocationEndDate\) > 30\s*\)\s*\);/.test(
    step1b.slice(0, step1b.indexOf("Step 2:"))),
    "old empty-or->30-day hours predicate is gone from Step 1b");
}

if (failures > 0) {
  console.error(`\ncheck-lump-hours: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-lump-hours: all good");
