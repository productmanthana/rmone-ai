/**
 * Recruitment-math regression harness (CI gate).
 * Run: pnpm --filter @workspace/api-server run check:recruitment
 *
 * Guards the Analytics Center → Recruitment card math
 * (src/lib/recruitment-analytics.ts), whose weekly expansion deliberately
 * mirrors financial-analytics semantics. A code-review pass already caught
 * one bug here (two identical-role open slots on one project collapsing into
 * one counted position — fixed via slotKey); these fixtures lock the rules in
 * so future edits to EITHER analytics module can't silently diverge:
 *
 *   1. slotKey — "PM" + "PM (2)" on one ticket = 2 open positions, hours
 *      still grouped under one "PM" role row (route mapping guarded too)
 *   2. hours-win — real-hours weeks suppress percent rows for the same
 *      (person, ticket); PARITY-checked against computeFinancialAnalytics
 *   3. shorter-span hours rows claim weeks first (container dedup) — parity
 *   4. PctAllocation > 150 on assigned rows = raw hours over the span;
 *      pct = 150 stays genuine percent — parity
 *   5. 168 h/week integrity cap on both hours and legacy raw-hours paths
 *   6. week capacity — holidays on WORKING days reduce capacity, weekend
 *      holidays don't (weekCapacityHours is the one calendar choke point);
 *      holidays never reduce the REQUIRED side
 *   7. leave windows scale availability (full, half, partial-week)
 *   8. honesty — junk rows are SKIPPED (never fabricated as zeros), no-role
 *      people land in "No role recorded", empty roles are omitted, and no
 *      non-finite number ever reaches the payload
 *
 * Exit code 0 = all good; 1 = drift or a fixture failure.
 */
// Deterministic date math: the compute pipeline is UTC-Monday keyed and the
// alloc-math leave walk uses local days — pin the zone so both agree.
process.env.TZ = "UTC";

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeRecruitmentAnalytics, NO_ROLE_LABEL,
  type RecruitStaffedRow, type RecruitDemandRow, type RecruitPerson,
  type RecruitmentAnalyticsCore,
} from "../src/lib/recruitment-analytics.js";
import { computeFinancialAnalytics, type FinAllocRow } from "../src/lib/financial-analytics.js";
import { weekCapacityHours, weekAvailableHours, parseHolidaySet, type AvailabilityWindow } from "@workspace/alloc-math";

const here = dirname(fileURLToPath(import.meta.url));

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}\n      expected ${e}\n      actual   ${a}`);
  }
}

// ── Shared fixture frame ─────────────────────────────────────────────────────
// 2026-06-01 is a Monday; period = 4 exact UTC weeks (Jun 1, 8, 15, 22).
const PERIOD = { periodStart: "2026-06-01", periodEnd: "2026-06-28" };
const BASE = {
  staffedRows: [] as RecruitStaffedRow[],
  demandRows: [] as RecruitDemandRow[],
  people: [] as RecruitPerson[],
  availabilityByGuid: new Map<string, AvailabilityWindow[]>(),
  workWeekHours: 40,
  nonWorkingDays: undefined as number[] | undefined,
  holidayDates: undefined as string[] | undefined,
  ...PERIOD,
};
const run = (over: Partial<typeof BASE>): RecruitmentAnalyticsCore =>
  computeRecruitmentAnalytics({ ...BASE, ...over });
const roleOf = (r: RecruitmentAnalyticsCore, name: string) => {
  const row = r.roles.find((x) => x.role === name);
  if (!row) throw new Error(`fixture drift: role row "${name}" missing (have: ${r.roles.map((x) => x.role).join(", ")})`);
  return row;
};
const finRow = (r: RecruitStaffedRow): FinAllocRow => ({
  ticket: r.ticket, person: r.person, allocationId: "",
  allocationStart: r.start, allocationEnd: r.end,
  start: r.start, end: r.end, hours: r.hours, pct: r.pct,
  nonChargeable: false, billRate: 0, costRate: 0, division: "",
});
// Fixed "now" inside the period so the financial "all" window covers every week.
const FIN_NOW = new Date(Date.UTC(2026, 5, 15));
const finAssignedHours = (rows: RecruitStaffedRow[]): number =>
  computeFinancialAnalytics(rows.map(finRow), 40, FIN_NOW).bases.all.assignedHours;

console.log("check-recruitment-analytics: period frame");
{
  const r = run({});
  check("weekStarts = 4 UTC Mondays", r.weekStarts, ["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22"]);
  check("empty input → no role rows fabricated", r.roles.length, 0);
  check("empty input → totals stay zero, not NaN", r.totals.variance, 0);
}

// ── 1. slotKey: duplicate-role open slots count separately ──────────────────
console.log("\ncheck-recruitment-analytics: slotKey — dup-role slots count, hours group");
{
  const r = run({
    demandRows: [
      { ticketId: "PRJ-01", role: "PM", slotKey: "PM",     start: "2026-06-01", end: "2026-06-14", pct: 100 },
      { ticketId: "PRJ-01", role: "PM", slotKey: "PM (2)", start: "2026-06-01", end: "2026-06-14", pct: 50 },
      { ticketId: "PRJ-02", role: "PM", slotKey: "PM",     start: "2026-06-08", end: "2026-06-14", pct: 100 },
      { ticketId: "PRJ-03", role: " pm ", slotKey: "pm",   start: "2026-06-01", end: "2026-06-07", pct: 25 },
    ],
  });
  check("hours group under ONE role row", r.roles.length, 1);
  const pm = roleOf(r, "PM");
  check("two same-role slots on one ticket count as 2 (4 total)", pm.openPositions, 4);
  check("demand hours sum per week × span", pm.demandHours, 170);
  check("weekly required [70, 100, 0, 0]", pm.weekly.map((w) => w.required), [70, 100, 0, 0]);
  check("multi-FTE demand uncapped by 100%", pm.required, 170);
  check("totals.openPositions mirrors role rows", r.totals.openPositions, 4);
}
{
  // Fallback: no slotKey → identity falls back to role, duplicates collapse.
  const r = run({
    demandRows: [
      { ticketId: "PRJ-09", role: "PM", start: "2026-06-01", end: "2026-06-07", pct: 100 },
      { ticketId: "PRJ-09", role: "PM", start: "2026-06-01", end: "2026-06-07", pct: 100 },
    ],
  });
  check("no slotKey → same (ticket, role) collapses to 1 position", roleOf(r, "PM").openPositions, 1);
}

// ── 2. hours-win over percent rows (+ financial parity) ─────────────────────
console.log("\ncheck-recruitment-analytics: hours-win — real-hours weeks suppress pct rows");
const hoursWinRows: RecruitStaffedRow[] = [
  { person: "P1", ticket: "T1", start: "2026-06-01", end: "2026-06-28", hours: 0, pct: 50 },  // container plan
  { person: "P1", ticket: "T1", start: "2026-06-08", end: "2026-06-14", hours: 20, pct: 0 },  // real week
];
{
  const r = run({ people: [{ guid: "P1", role: "Engineer" }], staffedRows: hoursWinRows });
  const eng = roleOf(r, "Engineer");
  check("weekly required: pct(20) ×3 + hours(20) — never 40 on the hours week",
    eng.weekly.map((w) => w.required), [20, 20, 20, 20]);
  check("staffed hours total 80 (no double count)", eng.staffedHours, 80);
  check("FINANCIAL PARITY: same rows → same assigned hours", finAssignedHours(hoursWinRows), 80);
}

// ── 3. shorter-span hours rows claim weeks first (+ parity) ──────────────────
console.log("\ncheck-recruitment-analytics: shorter-span hours rows claim weeks first");
const claimRows: RecruitStaffedRow[] = [
  { person: "P2", ticket: "T2", start: "2026-06-01", end: "2026-06-28", hours: 80, pct: 0 },  // container 20/wk
  { person: "P2", ticket: "T2", start: "2026-06-08", end: "2026-06-14", hours: 30, pct: 0 },  // explicit week
];
{
  const r = run({ people: [{ guid: "P2", role: "Analyst" }], staffedRows: claimRows });
  const an = roleOf(r, "Analyst");
  check("explicit week wins its week; container keeps the rest",
    an.weekly.map((w) => w.required), [20, 30, 20, 20]);
  check("total 90, not the naive 110", an.staffedHours, 90);
  check("FINANCIAL PARITY: same rows → same assigned hours", finAssignedHours(claimRows), 90);
}

// ── 4. pct > 150 = raw hours; pct = 150 stays percent (+ parity) ─────────────
console.log("\ncheck-recruitment-analytics: pct>150 raw-hours reinterpretation boundary");
const pctRows: RecruitStaffedRow[] = [
  { person: "P3", ticket: "T3", start: "2026-06-01", end: "2026-06-14", hours: 0, pct: 160 }, // raw hours over span
  { person: "P4", ticket: "T4", start: "2026-06-01", end: "2026-06-07", hours: 0, pct: 150 }, // genuine percent
];
{
  const r = run({
    people: [{ guid: "P3", role: "RoleA" }, { guid: "P4", role: "RoleB" }],
    staffedRows: pctRows,
  });
  check("pct=160 over 2 weeks → 80 h/wk raw hours (160 total)", roleOf(r, "RoleA").staffedHours, 160);
  check("pct=150 stays percent → 1.5 × 40 = 60", roleOf(r, "RoleB").staffedHours, 60);
  check("FINANCIAL PARITY: boundary handled identically", finAssignedHours(pctRows), 220);
}

// ── 5. 168 h/week integrity cap (+ parity) ───────────────────────────────────
console.log("\ncheck-recruitment-analytics: 168 h/week integrity cap");
const capRows: RecruitStaffedRow[] = [
  { person: "P5", ticket: "T5", start: "2026-06-01", end: "2026-06-07", hours: 1000, pct: 0 }, // hours path
  { person: "P6", ticket: "T6", start: "2026-06-08", end: "2026-06-14", hours: 0, pct: 600 },  // raw-hours path
];
{
  const r = run({
    people: [{ guid: "P5", role: "RoleC" }, { guid: "P6", role: "RoleD" }],
    staffedRows: capRows,
  });
  check("1000 explicit hours in one week caps at 168", roleOf(r, "RoleC").staffedHours, 168);
  check("pct=600 (raw hours) in one week caps at 168", roleOf(r, "RoleD").staffedHours, 168);
  check("FINANCIAL PARITY: caps applied identically", finAssignedHours(capRows), 336);
}

// Combined parity sweep — all staffed fixtures through BOTH modules at once.
console.log("\ncheck-recruitment-analytics: combined financial-analytics parity sweep");
{
  const all = [...hoursWinRows, ...claimRows, ...pctRows, ...capRows];
  const r = run({
    people: [
      { guid: "P1", role: "Engineer" }, { guid: "P2", role: "Analyst" },
      { guid: "P3", role: "RoleA" }, { guid: "P4", role: "RoleB" },
      { guid: "P5", role: "RoleC" }, { guid: "P6", role: "RoleD" },
    ],
    staffedRows: all,
  });
  const recruitTotal = Math.round(r.roles.reduce((s, x) => s + x.staffedHours, 0) * 10) / 10;
  check("Σ recruitment staffed hours == financial assignedHours", recruitTotal, finAssignedHours(all));
  check("combined total is the sum of the scenario expectations", recruitTotal, 726);
}

// ── 6. week capacity: working-day holidays deduct, weekend ones don't ────────
console.log("\ncheck-recruitment-analytics: weekCapacityHours holiday rules");
{
  const WK = Date.UTC(2026, 5, 1); // Mon Jun 1
  const cap = (holidays: string[], nwd?: number[]) =>
    weekCapacityHours(WK, 40, nwd, parseHolidaySet(holidays), true);
  check("no holidays → full 40", cap([]), 40);
  check("Wed holiday → 40 − 40/5 = 32", cap(["2026-06-03"]), 32);
  check("Saturday holiday deducts NOTHING", cap(["2026-06-06"]), 40);
  check("Wed + Sat holidays → only Wed deducts (32)", cap(["2026-06-03", "2026-06-06|Label"]), 32);
  check("two working-day holidays → 24", cap(["2026-06-02", "2026-06-04"]), 24);
  check("4-day week (Fri off): Wed holiday → 40 − 10 = 30", cap(["2026-06-03"], [0, 5, 6]), 30);
  check("4-day week: Friday holiday on the OFF day → 40", cap(["2026-06-05"], [0, 5, 6]), 40);
  check("all days non-working → 0 capacity, honestly", weekCapacityHours(WK, 40, [0, 1, 2, 3, 4, 5, 6], new Set()), 0);
}
{
  // Through the full compute: capacity drops, the REQUIRED side must not.
  const base = {
    people: [{ guid: "A1", role: "PM" }],
    staffedRows: [{ person: "A1", ticket: "T9", start: "2026-06-01", end: "2026-06-07", hours: 40, pct: 0 }],
    periodStart: "2026-06-01", periodEnd: "2026-06-07",
  };
  const r = run({ ...base, holidayDates: ["2026-06-03|Midweek", "2026-06-06|Weekend"] });
  const pm = roleOf(r, "PM");
  check("available reflects ONLY the working-day holiday (32)", pm.available, 32);
  check("required stays as booked — holidays never deduct twice", pm.required, 40);
  check("holidaysInPeriod lists both configured dates", r.holidaysInPeriod, ["2026-06-03", "2026-06-06"]);
  check("workingDays surfaced from settings default", r.workingDays, 5);
  const weekend = run({ ...base, holidayDates: ["2026-06-06|Weekend"] });
  check("weekend-only holiday leaves availability at 40", roleOf(weekend, "PM").available, 40);
}

// ── 7. leave windows scale availability at WORKING-DAY granularity ──────────
console.log("\ncheck-recruitment-analytics: leave scales WORKING days only");
{
  // Direct helper checks — the calendar/leave combination choke point.
  const WK = Date.UTC(2026, 5, 1); // Mon Jun 1
  const wah = (windows: AvailabilityWindow[] | undefined, holidays: string[] = []) =>
    weekAvailableHours(WK, 40, undefined, parseHolidaySet(holidays), windows, true);
  check("helper: no windows == weekCapacityHours (lockstep)",
    wah(undefined, ["2026-06-03"]), weekCapacityHours(WK, 40, undefined, parseHolidaySet(["2026-06-03"]), true));
  check("helper: Mon–Wed 0% leave → 2 working days remain = 16",
    wah([{ startDate: "2026-06-01", endDate: "2026-06-03", availabilityPct: 0 }]), 16);
  check("helper: weekend-only 0% leave deducts NOTHING",
    wah([{ startDate: "2026-06-06", endDate: "2026-06-07", availabilityPct: 0 }]), 40);
  check("helper: 0% leave on a HOLIDAY workday never deducts twice",
    wah([{ startDate: "2026-06-03", endDate: "2026-06-03", availabilityPct: 0 }], ["2026-06-03"]), 32);
  check("helper: overlapping windows — lowest availability wins per day",
    wah([
      { startDate: "2026-06-01", endDate: "2026-06-05", availabilityPct: 50 },
      { startDate: "2026-06-02", endDate: "2026-06-02", availabilityPct: 0 },
    ]), 16); // Mon 4 + Tue 0 (0% wins) + Wed/Thu/Fri 4 each
  check("helper: malformed window dates are ignored, not zeroed",
    wah([{ startDate: "junk", endDate: "2026-06-05", availabilityPct: 0 }]), 40);

  const twoWeeks = { periodStart: "2026-06-01", periodEnd: "2026-06-14" };
  const leave = (windows: AvailabilityWindow[], holidayDates?: string[]) => run({
    ...twoWeeks,
    holidayDates,
    people: [{ guid: "L1", role: "Designer" }],
    availabilityByGuid: new Map([["L1", windows]]),
  });
  check("full-week 0% leave zeroes that week only",
    roleOf(leave([{ startDate: "2026-06-01", endDate: "2026-06-07", availabilityPct: 0 }]), "Designer")
      .weekly.map((w) => w.available), [0, 40]);
  check("half-time leave halves the week",
    roleOf(leave([{ startDate: "2026-06-01", endDate: "2026-06-07", availabilityPct: 50 }]), "Designer")
      .weekly.map((w) => w.available), [20, 40]);
  check("Mon–Wed 0% leave → Thu+Fri remain = 16 (NOT a 7-day average)",
    roleOf(leave([{ startDate: "2026-06-01", endDate: "2026-06-03", availabilityPct: 0 }]), "Designer")
      .weekly.map((w) => w.available), [16, 40]);
  check("weekend-only leave leaves capacity untouched",
    roleOf(leave([{ startDate: "2026-06-06", endDate: "2026-06-07", availabilityPct: 0 }]), "Designer")
      .weekly.map((w) => w.available), [40, 40]);
  check("leave on a holiday workday: capacity drops ONCE (32, not 24)",
    roleOf(leave(
      [{ startDate: "2026-06-03", endDate: "2026-06-03", availabilityPct: 0 }],
      ["2026-06-03|Midweek"],
    ), "Designer").weekly.map((w) => w.available), [32, 40]);
  check("leave outside the period changes nothing",
    roleOf(leave([{ startDate: "2026-05-01", endDate: "2026-05-31", availabilityPct: 0 }]), "Designer")
      .weekly.map((w) => w.available), [40, 40]);
}

// ── 8. honesty: skip junk, never fabricate, no non-finite output ─────────────
console.log("\ncheck-recruitment-analytics: honesty — junk skipped, nothing fabricated");
{
  const r = run({
    workWeekHours: 0, // misconfigured settings
    people: [
      { guid: "N1", role: "" },        // no role recorded
      { guid: "N2", role: "Writer" },
    ],
    staffedRows: [
      { person: "N2", ticket: "TX", start: "", end: "2026-06-07", hours: 40, pct: 0 },           // invalid start
      { person: "N2", ticket: "TY", start: "2026-06-01", end: "2040-01-01", hours: 4000, pct: 0 }, // junk span >530wk
      { person: "GHOST", ticket: "TZ", start: "2026-06-01", end: "2026-06-07", hours: 40, pct: 0 }, // not on roster
    ],
    demandRows: [
      { ticketId: "D1", role: "QA", start: "", end: "", pct: 100 },                               // invalid dates
      { ticketId: "D2", role: "QA", start: "2026-06-01", end: "2026-06-07", pct: 0 },             // zero-pct noise
      { ticketId: "D3", role: "Off-Period", start: "2026-07-06", end: "2026-07-12", pct: 100 },   // outside period
    ],
  });
  check("workWeekHours ≤ 0 falls back to 40, never 0-capacity", r.workWeekHours, 40);
  const noRole = roleOf(r, NO_ROLE_LABEL);
  check("blank-role person lands in the no-role row, not dropped", noRole.people, 1);
  check("off-roster staffed hours land in the no-role row, not dropped", noRole.staffedHours, 40);
  check("invalid-start and junk-span rows are SKIPPED (Writer req = 0)", roleOf(r, "Writer").staffedHours, 0);
  check("Writer capacity intact despite skipped rows", roleOf(r, "Writer").available, 160);
  check("invalid/zero/off-period demand creates NO role rows or positions",
    [r.roles.some((x) => x.role === "QA" || x.role === "Off-Period"), r.totals.openPositions], [false, 0]);

  // Nothing anywhere in the payload may be non-finite (NaN → JSON null).
  const badPaths: string[] = [];
  (function scan(v: unknown, path: string) {
    if (typeof v === "number") { if (!Number.isFinite(v)) badPaths.push(path); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => scan(x, `${path}[${i}]`)); return; }
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) scan(x, `${path}.${k}`);
  })(r, "$");
  check("no NaN/Infinity anywhere in the payload", badPaths, []);
}
{
  // Roles with zero activity in the period are OMITTED, not zero-fabricated.
  const r = run({
    demandRows: [{ ticketId: "D9", role: "Surveyor", start: "2026-07-06", end: "2026-07-12", pct: 100 }],
  });
  check("out-of-period-only role emits NO row", r.roles.length, 0);
}

// ── 9. route mapping + cross-module lockstep guards (source-level) ───────────
console.log("\ncheck-recruitment-analytics: route slotKey mapping + lockstep markers");
{
  const routeSrc = readFileSync(join(here, "../src/routes/analytics.ts"), "utf8");
  const recStart = routeSrc.indexOf('router.get("/recruitment"');
  check("recruitment route handler present", recStart >= 0, true);
  check("recruitment route enforces the server-side editor gate (blockIfReadOnly)",
    recStart >= 0 && routeSrc.slice(recStart).includes("await blockIfReadOnly(req, res)"), true);
  check("route strips the display-only \" (N)\" suffix for the role group",
    routeSrc.includes('role: String(d.Role ?? "").replace(/ \\(\\d+\\)$/, "")'), true);
  check("route keeps the suffixed original as slotKey",
    routeSrc.includes('slotKey: String(d.Role ?? "")'), true);

  const recSrc = readFileSync(join(here, "../src/lib/recruitment-analytics.ts"), "utf8");
  const finSrc = readFileSync(join(here, "../src/lib/financial-analytics.ts"), "utf8");
  for (const marker of ["row.pct > 150", "Math.min(row.pct / weeks, 168)", "spanA - spanB"]) {
    check(`lockstep marker "${marker}" present in BOTH analytics modules`,
      recSrc.includes(marker) && finSrc.includes(marker), true);
  }
}

if (failures) {
  console.error(`\ncheck-recruitment-analytics: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-recruitment-analytics: all fixtures passed");
