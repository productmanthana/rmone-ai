// Guards the import-time team display-mode auto-select.
//
// classifyTeamDisplayMode (src/lib/pipeline.ts) inspects the uploaded file's
// team-assignment rows and picks the "Visible sections (display mode)" value
// that fits the data:
//   • weekly date buckets (many ≤8-day spans)  → hours-grid modes
//   • long date spans / percent-only rows      → table/Gantt (no grid) modes
//   • no dates AND no hours/percent            → Summary Only
// The pipeline writes the result to the tenant's projectDisplayMode after every
// import that carries assignments (unless the admin chose a layout manually),
// so a wrong classification here silently rewires what users see on every
// project page. Run via `pnpm --filter @workspace/api-server run check:display-mode`.

import { classifyTeamDisplayMode } from "../src/lib/pipeline.js";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual ?? null), e = JSON.stringify(expected ?? null);
  if (a === e) { console.log(`  OK   ${name}`); return; }
  failures++;
  console.error(`  FAIL ${name}\n       expected ${e}\n       got      ${a}`);
}

type Row = Record<string, unknown>;
const mode = (rows: Row[], hasSchedule: boolean) =>
  classifyTeamDisplayMode(rows, hasSchedule)?.mode ?? null;

// Row builders ---------------------------------------------------------------
const span = (start: unknown, end: unknown, extra: Row = {}): Row =>
  ({ Name: "A Person", JobTitle: "PM", AllocationStartDate: start, AllocationEndDate: end, ...extra });
const weeklyUS: Row[] = [ // the shape from the user's file: one 7-day row per week, 20h each
  span("11/9/2026",  "11/15/2026", { AllocationHour: 20 }),
  span("11/16/2026", "11/22/2026", { AllocationHour: 20 }),
  span("11/23/2026", "11/29/2026", { AllocationHour: 20 }),
  span("11/30/2026", "12/6/2026",  { AllocationHour: 20 }),
  span("12/7/2026",  "12/13/2026", { AllocationHour: 20 }),
  span("12/28/2026", "1/3/2027",   { AllocationHour: 20 }), // crosses year
];
const longSpans: Row[] = [
  span("1/5/2026", "6/26/2026",  { AllocationHour: 480 }),
  span("2/2/2026", "9/25/2026",  { PctAllocation: "50%" }),
  span("3/2/2026", "12/18/2026", { AllocationHour: 800 }),
];

console.log("check-display-mode-autoselect: classifyTeamDisplayMode fixtures");

// 1-2. Weekly buckets → hours-grid modes (schedule decides full vs grid-only).
check("weekly buckets, no schedule → Hours Grid Only", mode(weeklyUS, false), "no-schedule");
check("weekly buckets, schedule present → Full View", mode(weeklyUS, true), "full");

// 3-4. Long spans → no-grid modes (schedule decides schedule+table vs table/Gantt).
check("long spans, no schedule → Table / Gantt", mode(longSpans, false), "no-schedule-no-grid");
check("long spans, schedule present → Schedule + Table", mode(longSpans, true), "schedule-no-grid");

// 5. Names/roles only → Summary Only (no dates, no hours, no percent).
check("names only → Summary Only",
  mode([{ Name: "A" }, { Name: "B", JobTitle: "PM" }, { Name: "C", AllocationHour: "" }], false),
  "no-schedule-no-hours");

// 6. Percent-only rows without dates still mean effort → table mode, NOT summary.
check("percent-only, no dates → Table / Gantt",
  mode([{ Name: "A", PctAllocation: "50%" }, { Name: "B", PctAllocation: 25 }], false),
  "no-schedule-no-grid");

// 7. Hours column present (even 0) is effort → not Summary Only.
check("zero hours, no dates → Table / Gantt",
  mode([{ Name: "A", AllocationHour: 0 }], false), "no-schedule-no-grid");

// 8. Below the 60% weekly threshold → span-based wins.
check("50/50 short vs long → Table / Gantt",
  mode([
    span("1/5/2026", "1/11/2026", { AllocationHour: 20 }),
    span("2/2/2026", "2/8/2026",  { AllocationHour: 20 }),
    span("1/5/2026", "6/26/2026", { AllocationHour: 480 }),
    span("2/2/2026", "9/25/2026", { AllocationHour: 600 }),
  ], false),
  "no-schedule-no-grid");

// 9. At/above the threshold → weekly wins.
check("7 of 10 short → Hours Grid Only",
  mode([
    ...weeklyUS, span("12/14/2026", "12/20/2026", { AllocationHour: 20 }),
    span("1/5/2026", "6/26/2026", { AllocationHour: 480 }),
    span("2/2/2026", "9/25/2026", { AllocationHour: 600 }),
    span("3/2/2026", "12/18/2026", { AllocationHour: 800 }),
  ], false),
  "no-schedule");

// 10. A single short row is not enough weekly evidence (needs ≥2 dated rows).
check("one short row only → Table / Gantt",
  mode([span("11/9/2026", "11/15/2026", { AllocationHour: 20 })], false),
  "no-schedule-no-grid");

// 11. Day-first files (dd/mm/yyyy): "15/11" proves day-first; weeks parse as weeks
// even when both parts are ≤12 ("07/12" = 7 Dec, not 12 Jul).
check("day-first weekly file → Hours Grid Only",
  mode([
    span("09/11/2026", "15/11/2026", { AllocationHour: 20 }),
    span("16/11/2026", "22/11/2026", { AllocationHour: 20 }),
    span("30/11/2026", "06/12/2026", { AllocationHour: 20 }),
    span("07/12/2026", "13/12/2026", { AllocationHour: 20 }),
  ], false),
  "no-schedule");

// 12. Excel serial dates (raw parse) and Date objects both count.
check("serial + Date-object weekly rows → Hours Grid Only",
  mode([
    span(46252, 46258, { AllocationHour: 20 }), // Excel serials, 7 days apart
    span(46259, 46265, { AllocationHour: 20 }),
    span(new Date("2026-11-23"), new Date("2026-11-29"), { AllocationHour: 20 }),
  ], false),
  "no-schedule");

// 13. ISO date strings (our generated templates) classify like any other date.
check("ISO weekly rows → Full View with schedule",
  mode([
    span("2026-11-09", "2026-11-15", { AllocationHour: 20 }),
    span("2026-11-16", "2026-11-22", { AllocationHour: 20 }),
  ], true),
  "full");

// 14. Empty input → no opinion (pipeline skips the write).
check("no rows → null", mode([], false), null);

// 15. Garbage dates fall back to effort-based classification, never throw.
check("unparseable dates + hours → Table / Gantt",
  mode([span("not-a-date", "also-bad", { AllocationHour: 20 })], false),
  "no-schedule-no-grid");

if (failures) {
  console.error(`\ncheck-display-mode-autoselect: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-display-mode-autoselect: all fixtures passed");
