/**
 * StaffUtilModal capacity-strip regression harness (CI gate).
 * Run: pnpm --filter @workspace/api-server run check:capacity-strip
 *
 * Guards the Aug 2026 rewrite of the capacity bars to the PLAIN formula:
 *   % = booked hours ÷ configured work-week hours (Settings, default 40h).
 * Leave and company holidays must NEVER scale the % — they are separate
 * indicators (hatching, holiday dots, tags). The old capacity-scaled
 * denominator turned 30h booked in a mostly-on-leave week into 375%.
 *
 * The block lives inline in a React component
 * (../rmone-web/src/pages/resources.tsx, StaffUtilModal weekBookedHrs /
 * weeklyCap / monthlyCap), so — following the established harness pattern
 * (see check-hours-win.ts / check-title-reroute-web.ts) — this script
 * extracts the REAL source slice into a temp module and drives fixtures
 * against it. Pure web helpers (parseLocalDay, mondayOf, hoursWinFilter,
 * allocEntryHrsPerWeek) are imported directly from rmone-web utilGrid.
 *
 * Fixture edges (reviewer-flagged):
 *   1. leave whose inclusive end is a SUNDAY vs a MONDAY (hatch must not
 *      bleed into the next week / must reach the next week respectively)
 *   2. a company holiday on a Monday week-boundary → exactly ONE weekly
 *      bucket and exactly ONE monthly bucket
 *   3. DST-crossing weeks (spring-forward and fall-back, TZ pinned)
 *   4. workWeekHours ≠ 40
 *   5. regression: % identical with and without leave/holidays in the week
 *
 * Exit code 0 = all good; 1 = extraction drift or a fixture failure.
 */
// Allow a parent TZ-sweep harness to inject the zone via CAPACITY_STRIP_TZ;
// default to America/New_York for deterministic DST boundaries (Mar 8 / Nov 1 2026).
process.env.TZ = process.env.CAPACITY_STRIP_TZ || "America/New_York";

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pagePath = join(here, "../../rmone-web/src/pages/resources.tsx");
const src = readFileSync(pagePath, "utf8");
const utilGridUrl = pathToFileURL(join(here, "../../rmone-web/src/lib/utilGrid.ts")).href;

// ── Extraction ──────────────────────────────────────────────────────────────
// The slice is anchored on stable declarations. If one goes missing the script
// fails loudly ("extraction drift") rather than silently testing nothing.
function sliceBetween(startRe: RegExp, endRe: RegExp, label: string): string {
  const s = src.search(startRe);
  if (s < 0) throw new Error(`extraction drift: start marker not found for ${label} (${startRe})`);
  const rest = src.slice(s);
  const e = rest.search(endRe);
  if (e < 0) throw new Error(`extraction drift: end marker not found for ${label} (${endRe})`);
  const m = rest.slice(e).match(endRe)!;
  return rest.slice(0, e + m[0].length);
}

// Everything from the DST-safe day helper through the end of the weeklyCap
// IIFE: nextLocalDayMs, leaveEndExclusive, wwHrs, holidayList, weekBookedHrs,
// weekLeaveOverlap, monthlyCap, monthlyPct, weeklyCap.
const stripBody = sliceBetween(
  /const DAY_MS = 86_400_000;/,
  /return out;\s*\n\s*\}\)\(\);/,
  "capacity-strip block",
);
for (const marker of [
  "const wwHrs = br.workWeekHours || 40;",
  "const weekBookedHrs = (ws: number, weExcl: number): number =>",
  // Display-source parity (Aug 2026): booked totals must come from the
  // /resource-week-allocations engine FIRST — the same per-week source the
  // save path verifies against — with the allocation-span math kept only as
  // the loading/error fallback exercised by this harness.
  "const engineTotal = resolveWeekTotal(ws);",
  "const weekLeaveOverlap = (ws: number, weExcl: number): boolean =>",
  "const monthlyCap = months.map(m0 => {",
  "const weeklyCap = (() => {",
]) {
  if (!stripBody.includes(marker)) {
    throw new Error(`extraction drift: capacity-strip slice lost "${marker}"`);
  }
}
// Regression guard in the SOURCE itself: the plain-formula denominator must be
// wwHrs, and no leave/holiday term may appear in either pct computation.
const pctExprs = stripBody.match(/Math\.round\(\((avgHrs|hrs) \/ [^)]+\) \* 100\)/g) ?? [];
if (pctExprs.length !== 2 || pctExprs.some(e => !/ \/ wwHrs\)/.test(e))) {
  throw new Error(
    `extraction drift: capacity % is no longer "booked ÷ wwHrs" — found ${JSON.stringify(pctExprs)}. ` +
    "Leave/holidays must never scale the denominator.",
  );
}

const tmp = mkdtempSync(join(tmpdir(), "capacity-strip-"));
const modPath = join(tmp, "extracted.ts");
writeFileSync(modPath, `
import { parseLocalDay, mondayOf, hoursWinFilter, allocEntryHrsPerWeek } from ${JSON.stringify(utilGridUrl)};

type Alloc = { startDate: string; endDate: string; pct: number; hours?: number; projectId?: string };
type LeaveWin = { startDate: string; endDate: string };

export function capacityStrip(opts: {
  workWeekHours: number;
  holidayDates?: string[];
  allAllocs: Alloc[];
  windows: LeaveWin[];
  winStart: Date;            // first day of the window (month 1st)
  M: number;                 // number of months in the window
}) {
  const br = { workWeekHours: opts.workWeekHours, holidayDates: opts.holidayDates };
  const allAllocs = opts.allAllocs;
  const windows = opts.windows;
  const winStart = opts.winStart, M = opts.M;
  const months: Date[] = Array.from({ length: M }, (_, i) => new Date(winStart.getFullYear(), winStart.getMonth() + i, 1));
  const winEnd = new Date(winStart.getFullYear(), winStart.getMonth() + M, 1);
  const wsMs = winStart.getTime(), weMs = winEnd.getTime();
  // The REAL component resolves weekly totals from the /resource-week-allocations
  // engine first (display-source parity with the save path). These fixtures pin
  // the FALLBACK math — the formula used while that fetch is loading or failed —
  // so the engine is stubbed to "not loaded" here.
  const resolveWeekTotal = (_ws: number): number | null => null;
  ${stripBody}
  return { monthlyCap, weeklyCap, weekBookedHrs, weekLeaveOverlap, leaveEndExclusive, nextLocalDayMs };
}
`);
const { capacityStrip } = await import(pathToFileURL(modPath).href) as {
  capacityStrip: (opts: {
    workWeekHours: number;
    holidayDates?: string[];
    allAllocs: { startDate: string; endDate: string; pct: number; hours?: number; projectId?: string }[];
    windows: { startDate: string; endDate: string }[];
    winStart: Date;
    M: number;
  }) => {
    monthlyCap: { pct: number; hrs: number; holidays: { ms: number; label: string }[] }[];
    weeklyCap: { ws: number; hrs: number; pct: number; hasLeave: boolean; holidays: { ms: number; label: string }[] }[];
    weekBookedHrs: (ws: number, weExcl: number) => number;
    weekLeaveOverlap: (ws: number, weExcl: number) => boolean;
    leaveEndExclusive: (endDate: string) => number;
    nextLocalDayMs: (ms: number) => number;
  };
};

// ── Harness ─────────────────────────────────────────────────────────────────
let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual ?? null), e = JSON.stringify(expected ?? null);
  if (a === e) { console.log(`  OK   ${name}`); return; }
  failures++;
  console.error(`  FAIL ${name}\n       expected ${e}\n       got      ${a}`);
}
const localDay = (y: number, m0: number, d: number) => new Date(y, m0, d).getTime();
const ymd = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* Window: March + April 2026 (America/New_York; spring-forward Sun Mar 8).
   One real-hours assignment of 16h/wk spanning the week of Mon Mar 2. */
const winStart = new Date(2026, 2, 1);
const alloc16 = { startDate: "2026-03-02", endDate: "2026-03-08", pct: 100, hours: 16, projectId: "PMM-1" };
const base = { workWeekHours: 32, allAllocs: [alloc16], windows: [] as { startDate: string; endDate: string }[], winStart, M: 2 };

const MAR2 = localDay(2026, 2, 2), MAR9 = localDay(2026, 2, 9), MAR16 = localDay(2026, 2, 16);
const weekOf = (r: ReturnType<typeof capacityStrip>, ws: number) => {
  const w = r.weeklyCap.find(x => x.ws === ws);
  if (!w) throw new Error(`no weekly bucket at ${ymd(ws)}`);
  return w;
};

console.log("check-capacity-strip: custom work week (workWeekHours ≠ 40)");
{
  const r = capacityStrip(base);
  // 1. 16h booked ÷ 32h work week = 50%, and the hours themselves are honest.
  check("16h @ 32h/wk → 50%", weekOf(r, MAR2).pct, 50);
  check("16h @ 32h/wk → hrs=16", weekOf(r, MAR2).hrs, 16);
  // 2. Same data at 40h → 40% (denominator IS the setting, not a constant).
  const r40 = capacityStrip({ ...base, workWeekHours: 40 });
  check("16h @ 40h/wk → 40%", weekOf(r40, MAR2).pct, 40);
  // 3. Monthly bar averages over March's 5 Mon-start weeks (Mar 2..30): 16/5=3.2h → 10%.
  check("monthly avg 3.2h @ 32h/wk → 10%", r.monthlyCap[0].pct, 10);
  check("monthly avg hrs", r.monthlyCap[0].hrs, 3.2);
}

console.log("\ncheck-capacity-strip: leave end on Sunday vs Monday week boundary");
{
  // 4. Inclusive leave end Sunday Mar 8: hatch on week Mar 2 ONLY — must not
  //    bleed into the week of Mon Mar 9 (exclusive end lands exactly on ws).
  const rSun = capacityStrip({ ...base, windows: [{ startDate: "2026-03-04", endDate: "2026-03-08" }] });
  check("leave ends Sun → week Mar 2 hatched", weekOf(rSun, MAR2).hasLeave, true);
  check("leave ends Sun → week Mar 9 NOT hatched", weekOf(rSun, MAR9).hasLeave, false);
  // 5. Inclusive leave end Monday Mar 9: hatch reaches the Mar 9 week, stops there.
  const rMon = capacityStrip({ ...base, windows: [{ startDate: "2026-03-04", endDate: "2026-03-09" }] });
  check("leave ends Mon → week Mar 2 hatched", weekOf(rMon, MAR2).hasLeave, true);
  check("leave ends Mon → week Mar 9 hatched", weekOf(rMon, MAR9).hasLeave, true);
  check("leave ends Mon → week Mar 16 NOT hatched", weekOf(rMon, MAR16).hasLeave, false);
  // 6. Leave starting Monday must not hatch the PREVIOUS week.
  const rStart = capacityStrip({ ...base, windows: [{ startDate: "2026-03-09", endDate: "2026-03-10" }] });
  check("leave starts Mon → previous week NOT hatched", weekOf(rStart, MAR2).hasLeave, false);
  check("leave starts Mon → its own week hatched", weekOf(rStart, MAR9).hasLeave, true);
}

console.log("\ncheck-capacity-strip: holiday on a Monday week boundary");
{
  // 7. Holiday Mon Mar 9: exactly one weekly bucket (the Mar 9 week) and
  //    exactly one monthly bucket (March).
  const r = capacityStrip({ ...base, holidayDates: ["2026-03-09|Casimir Pulaski Day"] });
  const weeklyHits = r.weeklyCap.filter(w => w.holidays.length > 0);
  check("holiday Monday → exactly one weekly bucket", weeklyHits.length, 1);
  check("holiday Monday → lands in ITS week", weeklyHits[0]?.ws, MAR9);
  check("holiday label survives", weeklyHits[0]?.holidays.map(h => h.label), ["Casimir Pulaski Day"]);
  const monthlyHits = r.monthlyCap.map(m => m.holidays.length);
  check("holiday Monday → exactly one monthly bucket", monthlyHits, [1, 0]);
  // 8. Holiday on the 1st of a month (Apr 1): April only, never March.
  const rApr = capacityStrip({ ...base, holidayDates: ["2026-04-01"] });
  check("holiday on month 1st → second month only", rApr.monthlyCap.map(m => m.holidays.length), [0, 1]);
  check("holiday default label", rApr.monthlyCap[1].holidays[0]?.label, "Company holiday");
}

console.log("\ncheck-capacity-strip: DST-crossing weeks (America/New_York)");
{
  const r = capacityStrip(base);
  // 9. Spring-forward: the week of Mon Mar 2 contains the 23h Sunday (Mar 8).
  //    Its exclusive end must be Mon Mar 9 LOCAL midnight — an alloc starting
  //    exactly Mar 9 must NOT leak into the Mar 2 week (a flat ws+7×24h end
  //    would sit at Mar 9 01:00 and wrongly include it).
  const weExclMar2 = MAR9;
  const r2 = capacityStrip({ ...base, allAllocs: [{ startDate: "2026-03-09", endDate: "2026-03-15", pct: 100, hours: 8, projectId: "PMM-2" }] });
  check("alloc starting Mon after DST week → not in DST week", r2.weekBookedHrs(MAR2, weExclMar2), 0);
  check("alloc starting Mon after DST week → in its own week", weekOf(r2, MAR9).hrs, 8);
  // 10. Alloc ending Sun Mar 8 (inside the short week) stays in the Mar 2 week only.
  check("alloc ending DST Sunday → in DST week", weekOf(r, MAR2).hrs, 16);
  check("alloc ending DST Sunday → not in next week", weekOf(r, MAR9).hrs, 0);
  // 11. Leave whose inclusive end is the DST Sunday itself: exclusive end must
  //     snap to Mon Mar 9 00:00 local, so the next week stays un-hatched.
  const rL = capacityStrip({ ...base, windows: [{ startDate: "2026-03-07", endDate: "2026-03-08" }] });
  check("leave ending DST Sunday → exclusive end = Mon 00:00", ymd(rL.leaveEndExclusive("2026-03-08")), "2026-03-09");
  check("leave ending DST Sunday → next week NOT hatched", weekOf(rL, MAR9).hasLeave, false);
  // 12. Fall-back (Sun Nov 1 2026 has 25h): nextLocalDayMs must land on Nov 2,
  //     where a flat +24h would still be Nov 1 23:00 (same local day).
  check("fall-back day-after → Nov 2", ymd(r.nextLocalDayMs(localDay(2026, 10, 1))), "2026-11-02");
  check("spring-forward day-after → Mar 9", ymd(r.nextLocalDayMs(localDay(2026, 2, 8))), "2026-03-09");
  // 13. Weekly buckets around fall-back stay Monday-aligned 7 local days apart.
  const rNov = capacityStrip({ ...base, winStart: new Date(2026, 9, 1), M: 2, allAllocs: [] });
  const novMondays = rNov.weeklyCap.map(w => new Date(w.ws).getDay());
  check("all fall-back-window buckets start Monday", novMondays.every(d => d === 1), true);
  check("Nov 2 bucket exists exactly once", rNov.weeklyCap.filter(w => w.ws === localDay(2026, 10, 2)).length, 1);
}

console.log("\ncheck-capacity-strip: % NEVER scaled by leave/holidays (plain-formula guard)");
{
  // 14. Same booked hours, with vs without full-week leave AND a holiday in
  //     the week: pct and hrs must be IDENTICAL. Any reintroduction of
  //     capacity scaling (the old 375% bug) fails here.
  const clean = capacityStrip(base);
  const loaded = capacityStrip({
    ...base,
    windows: [{ startDate: "2026-03-02", endDate: "2026-03-08" }],   // leave covers the whole booked week
    holidayDates: ["2026-03-02|Holiday", "2026-03-06|Holiday 2"],    // plus two holidays in it
  });
  check("full-week leave + holidays → pct unchanged", weekOf(loaded, MAR2).pct, weekOf(clean, MAR2).pct);
  check("full-week leave + holidays → hrs unchanged", weekOf(loaded, MAR2).hrs, weekOf(clean, MAR2).hrs);
  check("leave/holidays still SIGNALLED (hatch on)", weekOf(loaded, MAR2).hasLeave, true);
  check("leave/holidays still SIGNALLED (2 holiday dots)", weekOf(loaded, MAR2).holidays.length, 2);
  check("monthly pct unchanged under leave/holidays", loaded.monthlyCap[0].pct, clean.monthlyCap[0].pct);
}

if (failures) {
  console.error(`\ncheck-capacity-strip: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-capacity-strip: all fixtures passed");
