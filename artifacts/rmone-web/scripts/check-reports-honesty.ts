/**
 * Reports Center data-honesty check (CI gate).
 * Run: pnpm --filter @workspace/rmone-web run check:reports-honesty
 *
 * Contract under test:
 *   1. Period boundary math (Monday week-start, [start, end) half-open,
 *      month/quarter/YTD anchors, custom local-date parsing).
 *   2. Time-bucket assignment — records land in the right bucket and the
 *      mode transitions (day ≤14 / week ≤120 / month) are correct.
 *   3. Undated-decision exclusion — decided bids with no decidedDate are
 *      counted in the note, never injected into period-filtered arrays.
 *   4. allOpps / allLeads legacy-model fallbacks — absence triggers the
 *      labeled-incomplete note and the KPI/hero uses the open book only
 *      (never presents that subset as an authoritative all-time total).
 *   5. Builders don't crash on empty or minimal models.
 *   6. Backfill clears the undated-decisions note — after backfillDecisionDatesRds
 *      fills in AwardedorLossDate (→ decidedDate), the note count drops to zero.
 *      The count after must drop by at least the eligible count the dry-run found.
 *   7. AfExplainPopup person drill-down — personWeekSeries weekly cells
 *      (same-week multi-role rows sum first, cutoff windows partition) whose
 *      totals reconcile with explainRows, and buildWeekStrip axis layout
 *      (zero-fill short gaps, collapse long ones, align multi-series).
 *   8. Executive Forecast popup ↔ table reconciliation — unitValues returns
 *      the frozen overview row's own unit-family fields, variance stays
 *      forecast − actual (positive = favorable), the shared comparator keeps
 *      nulls last with variance columns opening worst-first, and % Used =
 *      actual ÷ FAC clamped 0–100 (no FAC → null).
 *   9. Negative-zero quantization — stored variances are raw float sums, so
 *      round2 must fold −0/tails into +0 and fmtNum/fmtUsd must never render
 *      "−0" / "−$0" (Intl formats IEEE −0 with a minus sign); real negatives
 *      keep their sign.
 *
 * Exit code 0 = all good; 1 = at least one assertion failed.
 */
import {
  getPeriodRange,
  parseLocalDay,
  inPeriod,
  timeBuckets,
  buildLeadsReport,
  buildOppsReport,
  buildProjectsReport,
  buildCloseoutReport,
  buildReportsHubStats,
  buildHubHonestyNotes,
  getClosedProjectsInPeriod,
  type PeriodRange,
} from "../src/lib/reportsCenter";
import { buildReportModel, type ReportModel, type LeadRow, type OppRow, type ProjectRow } from "../src/lib/reportData";
import { isLifecycleReportField, type AfDetailRow, type AfWeekRow } from "../src/lib/api";
import {
  personWeekSeries, buildWeekStrip, explainRows,
  execInitialSortDir, execPctUsed, execRowComparator,
  fmtNum, fmtUsd, round2, seriesFromDetail, unitValues,
  type AfWeekCell,
} from "../src/lib/afMath";
import { filterCardByField, filterRowsByOrgKey } from "../src/lib/analyticsCenter";
import {
  buildExecutiveSection,
  buildLeadSection,
  buildOppSection,
  buildPipelineSection,
  buildProjectSection,
} from "../src/lib/analyticsSections";
import { buildStaffSection } from "../src/lib/analyticsPeople";
import {
  buildPeriodAnalyticsDetail,
  filterScheduleHealthCard,
  periodAnalyticsExportCards,
} from "../src/lib/periodAnalyticsCards";

let failures = 0;
function checkTrue(name: string, cond: boolean, hint = ""): void {
  if (cond) { console.log(`  OK   ${name}`); return; }
  failures++;
  console.error(`  FAIL ${name}${hint ? `\n       ${hint}` : ""}`);
}

/* ── minimal fixture model ── */
function baseModel(): ReportModel {
  return {
    generatedAt: new Date().toISOString(),
    backlogValue: 8_000_000,
    pipelineValue: 2_000_000,
    weightedPipeline: 1_000_000,
    activeBids: 2,
    activeProjects: 2,
    avgProjectValue: 4_000_000,
    totalForecastCost: 1_000_000,
    winRate: 60,
    onTimeRate: 50,
    onScheduleCount: 1,
    overdueCount: 1,
    noDateCount: 0,
    totalStaff: 3,
    benchCount: 1,
    overAllocCount: 0,
    healthyCount: 2,
    deployedRate: 67,
    openDemands: 0,
    backlogByDivision: [
      { label: "Civil", value: 5_000_000, count: 1 },
      { label: "Rail", value: 3_000_000, count: 1 },
    ],
    utilizationBands: [],
    projects: [
      {
        id: "PMM-01", name: "Bridge", client: "City", division: "Civil",
        sector: "Infra", value: 5_000_000, status: "Active",
        overdue: false, noDate: false, daysOverdue: null,
        targetStart: "2026-08-12T00:00:00.000Z",
        targetEnd: "2026-12-01T00:00:00.000Z",
        laborContract: 1_000_000, forecastCost: 900_000,
        created: "2026-08-12T00:00:00.000Z",
        closeoutDate: null,
      },
      {
        id: "PMM-02", name: "Tunnel", client: "State", division: "Rail",
        sector: "Infra", value: 3_000_000, status: "Active",
        overdue: true, noDate: false, daysOverdue: 12,
        targetStart: null,
        targetEnd: "2026-06-01T00:00:00.000Z",
        laborContract: 700_000, forecastCost: 800_000,
        created: "2026-07-01T00:00:00.000Z",
        closeoutDate: "2026-09-15T00:00:00.000Z",
      },
    ] as unknown as ProjectRow[],
    closedProjects: [
      {
        id: "PMM-99", name: "Depot", client: "State", division: "Rail",
        sector: "Infra", value: 1_000_000, status: "Closed",
        overdue: false, noDate: false, daysOverdue: null,
        targetStart: null, targetEnd: null,
        laborContract: 0, forecastCost: 0,
        created: "2025-01-10T00:00:00.000Z",
        closeoutDate: null,
      },
    ] as unknown as ProjectRow[],
    staff: [],
    demands: [],
    wonCount: 3, lostCount: 2, wonValue: 4_000_000, lostValue: 1_000_000,
    leadCount: 1, leadValue: 500_000, marginRiskCount: 0,
    cfo: null,
    funnel: [],
    winLossBySector: [],
    backlogBySector: [],
    clientConcentration: [],
    cityExposure: [],
    valueRanges: [],
    opmByStage: [],
    scheduleHealth: { onSchedule: 1, overdue: 1, noDate: 0 },
    conversion: {
      leadsTotal: 2, leadsConverted: 1, leadsConvertedValue: 200_000, leadConversionRate: 50,
      oppsTotal: 3, oppsConverted: 1, oppsConvertedValue: 2_000_000, oppConversionRate: 33,
      convertedLeads: [
        { id: "LEM-99", name: "Old Lead", client: "Acme", status: "Converted", division: null, owner: null, created: "2025-06-01T00:00:00.000Z", value: 200_000 },
      ] as LeadRow[],
      convertedOpps: [],
    },
    opps: [
      {
        id: "OPM-01", name: "Airport", client: "Port", sector: "Infra", city: null,
        division: "Civil", stage: "Proposal", value: 2_000_000,
        probability: 50, weighted: 1_000_000,
        bidDate: null, daysToBid: null, closed: false, won: false,
        created: "2026-08-12T00:00:00.000Z",
        decidedDate: null,
      },
    ] as unknown as OppRow[],
    decidedOpps: [
      {
        id: "OPM-02", name: "Awarded Opp", client: "State", sector: "Infra", city: null,
        division: "Rail", stage: "Awarded", value: 4_000_000,
        probability: null, weighted: 0,
        bidDate: null, daysToBid: null, closed: true, won: true,
        created: "2026-07-01T00:00:00.000Z",
        decidedDate: "2026-08-12T00:00:00.000Z",
      },
      {
        id: "OPM-03", name: "Undated Decided", client: "City", sector: "Infra", city: null,
        division: "Civil", stage: "Lost", value: 500_000,
        probability: null, weighted: 0,
        bidDate: null, daysToBid: null, closed: true, won: false,
        created: "2026-05-01T00:00:00.000Z",
        decidedDate: null,   // ← no date: must NOT appear in period counts
      },
    ] as unknown as OppRow[],
    leads: [
      { id: "LEM-01", name: "Alpha Lead", client: "Corp", status: "Active", division: "Civil", owner: "Alice", created: "2026-08-12T00:00:00.000Z", value: 300_000 },
      { id: "LEM-02", name: "Beta Lead", client: "Inc", status: "Active", division: null, owner: null, created: "2026-07-01T00:00:00.000Z", value: 200_000 },
    ] as LeadRow[],
  } as unknown as ReportModel;
}

/* ═══════════════════════════════════════════════════════════════
 * 1. parseLocalDay — "YYYY-MM-DD" parses as LOCAL midnight, not UTC
 * ═══════════════════════════════════════════════════════════════ */
console.log("check-reports-honesty: parseLocalDay");
{
  const d = parseLocalDay("2026-08-18");
  checkTrue("parseLocalDay returns a Date", d instanceof Date);
  if (d) {
    checkTrue("parseLocalDay — hours are 0 (local midnight, not UTC)",
      d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0,
      `got ${d.toISOString()}`);
    checkTrue("parseLocalDay — correct calendar date in local time",
      d.getFullYear() === 2026 && d.getMonth() === 7 && d.getDate() === 18);
  }
  checkTrue("parseLocalDay returns null for empty string", parseLocalDay("") === null);
  checkTrue("parseLocalDay returns null for bad format (DD/MM/YYYY)", parseLocalDay("18/08/2026") === null);
  checkTrue("parseLocalDay returns null for ISO with time component", parseLocalDay("2026-08-18T00:00:00") === null);
  checkTrue("parseLocalDay returns null for null-ish string", parseLocalDay("null") === null);
}

/* ═══════════════════════════════════════════════════════════════
 * 2. getPeriodRange — boundary dates, Monday week-start, [start,end)
 *    Fixed clock: Wed 2026-08-12, local.
 *    Week 0 = Mon Aug 10 .. Sun Aug 16 → [Aug10, Aug17)
 * ═══════════════════════════════════════════════════════════════ */
console.log("\ncheck-reports-honesty: getPeriodRange — week");
{
  // Wednesday 2026-08-12
  const NOW = new Date(2026, 7, 12, 10, 0, 0);

  const w = getPeriodRange("week", undefined, undefined, NOW);
  checkTrue("week.kind = 'week'", w.kind === "week");
  // start = Mon Aug 10
  checkTrue("week starts on Monday (Aug 10)",
    w.start.getFullYear() === 2026 && w.start.getMonth() === 7 && w.start.getDate() === 10,
    `got ${w.start.toDateString()}`);
  // end = Mon Aug 17 (exclusive)
  checkTrue("week ends on the following Monday (exclusive Aug 17)",
    w.end.getFullYear() === 2026 && w.end.getMonth() === 7 && w.end.getDate() === 17,
    `got ${w.end.toDateString()}`);
  // [start, end) semantics: Sunday Aug 16 is IN, Monday Aug 17 is OUT
  const sun = new Date(2026, 7, 16, 23, 59, 59).toISOString();
  const mon = new Date(2026, 7, 17, 0, 0, 0).toISOString();
  checkTrue("Sunday of the week is IN the period [start, end)", inPeriod(sun, w),
    `sun=${sun}, start=${w.start.toISOString()}, end=${w.end.toISOString()}`);
  checkTrue("Monday following the week is OUT of the period", !inPeriod(mon, w),
    `mon=${mon}`);
  // Previous Sunday (Aug 9) is also OUT
  const prevSun = new Date(2026, 7, 9, 12, 0, 0).toISOString();
  checkTrue("Sunday BEFORE the week is OUT", !inPeriod(prevSun, w));
}

console.log("\ncheck-reports-honesty: getPeriodRange — month");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0); // Aug 12
  const m = getPeriodRange("month", undefined, undefined, NOW);
  checkTrue("month starts Aug 1",
    m.start.getMonth() === 7 && m.start.getDate() === 1, `got ${m.start.toDateString()}`);
  checkTrue("month ends Sep 1 (exclusive)",
    m.end.getMonth() === 8 && m.end.getDate() === 1, `got ${m.end.toDateString()}`);
  checkTrue("Aug 31 23:59 is IN the month",
    inPeriod(new Date(2026, 7, 31, 23, 59, 59).toISOString(), m));
  checkTrue("Sep 1 00:00 is OUT of the month",
    !inPeriod(new Date(2026, 8, 1, 0, 0, 0).toISOString(), m));
}

console.log("\ncheck-reports-honesty: getPeriodRange — quarter");
{
  // Q3 2026 = Jul 1 – Sep 30; NOW = Aug 12 → Q3
  const NOW = new Date(2026, 7, 12, 10, 0, 0);
  const q = getPeriodRange("quarter", undefined, undefined, NOW);
  checkTrue("Q3 starts Jul 1",
    q.start.getMonth() === 6 && q.start.getDate() === 1, `got ${q.start.toDateString()}`);
  checkTrue("Q3 ends Oct 1 (exclusive)",
    q.end.getMonth() === 9 && q.end.getDate() === 1, `got ${q.end.toDateString()}`);
  checkTrue("Sep 30 is IN Q3", inPeriod(new Date(2026, 8, 30, 12, 0, 0).toISOString(), q));
  checkTrue("Oct 1 is OUT of Q3", !inPeriod(new Date(2026, 9, 1, 0, 0, 0).toISOString(), q));

  // Q1 boundary (Jan–Mar)
  const q1Now = new Date(2026, 1, 15, 0, 0, 0);
  const q1 = getPeriodRange("quarter", undefined, undefined, q1Now);
  checkTrue("Q1 starts Jan 1",
    q1.start.getMonth() === 0 && q1.start.getDate() === 1, `got ${q1.start.toDateString()}`);
  checkTrue("Q1 ends Apr 1 (exclusive)",
    q1.end.getMonth() === 3 && q1.end.getDate() === 1, `got ${q1.end.toDateString()}`);
}

console.log("\ncheck-reports-honesty: getPeriodRange — ytd");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0);
  const y = getPeriodRange("ytd", undefined, undefined, NOW);
  checkTrue("YTD starts Jan 1 of this year",
    y.start.getFullYear() === 2026 && y.start.getMonth() === 0 && y.start.getDate() === 1,
    `got ${y.start.toDateString()}`);
  checkTrue("YTD end is today + 1 day (today is included)",
    y.end.getDate() === 13, // Aug 12 + 1 = Aug 13
    `got ${y.end.toDateString()}`);
  checkTrue("Aug 12 is IN YTD (today included)",
    inPeriod(new Date(2026, 7, 12, 15, 0, 0).toISOString(), y));
  checkTrue("Dec 31 last year is OUT of YTD",
    !inPeriod(new Date(2025, 11, 31, 23, 59).toISOString(), y));
}

console.log("\ncheck-reports-honesty: getPeriodRange — custom");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0);
  const c = getPeriodRange("custom", "2026-08-01", "2026-08-07", NOW);
  checkTrue("custom start = Aug 1 local midnight",
    c.start.getFullYear() === 2026 && c.start.getMonth() === 7 && c.start.getDate() === 1 && c.start.getHours() === 0,
    `got ${c.start.toDateString()} T${c.start.getHours()}`);
  checkTrue("custom end = Aug 8 (Aug 7 + 1 day, exclusive)",
    c.end.getFullYear() === 2026 && c.end.getMonth() === 7 && c.end.getDate() === 8,
    `got ${c.end.toDateString()}`);
  checkTrue("Aug 7 23:59 is IN the custom range",
    inPeriod(new Date(2026, 7, 7, 23, 59, 59).toISOString(), c));
  checkTrue("Aug 8 00:00 is OUT of the custom range",
    !inPeriod(new Date(2026, 7, 8, 0, 0, 0).toISOString(), c));

  // invalid custom (end < start) → falls back to current week
  const bad = getPeriodRange("custom", "2026-08-15", "2026-08-01", NOW);
  checkTrue("invalid custom (end < start) falls back to current week",
    bad.kind === "custom" && bad.start.getDate() === 10, // Mon Aug 10
    `got kind=${bad.kind} start=${bad.start.toDateString()}`);
}

/* ═══════════════════════════════════════════════════════════════
 * 3. timeBuckets — mode selection and bucket assignment
 * ═══════════════════════════════════════════════════════════════ */
console.log("\ncheck-reports-honesty: timeBuckets — mode selection + assignment");
{
  // 7-day range → day mode
  const weekRange: PeriodRange = getPeriodRange("week", undefined, undefined, new Date(2026, 7, 12));
  // Put a record on Aug 11 (Tue, inside the week)
  const dayRows = [{ d: "2026-08-11T12:00:00.000Z", v: 100 }];
  const { buckets: dayBuckets } = timeBuckets(dayRows, r => r.d, r => r.v, weekRange);
  checkTrue("7-day range → day-mode (7 buckets)", dayBuckets.length === 7,
    `got ${dayBuckets.length}`);
  checkTrue("day-mode: Aug 11 record increments Tuesday bucket",
    dayBuckets.some(b => b.count === 1 && b.value === 100),
    `buckets: ${JSON.stringify(dayBuckets.map(b => ({ label: b.label, count: b.count })))}`);
  checkTrue("day-mode: all other buckets are zero",
    dayBuckets.filter(b => b.count !== 0).length === 1);

  // 30-day range → week mode
  const monthRange: PeriodRange = getPeriodRange("month", undefined, undefined, new Date(2026, 7, 12));
  const weekRows = [{ d: "2026-08-10T12:00:00.000Z", v: 200 }]; // Mon Aug 10 → week of Aug 10
  const { buckets: wBuckets } = timeBuckets(weekRows, r => r.d, r => r.v, monthRange);
  checkTrue("30-day range → week-mode (≥4 buckets, each starting Monday)",
    wBuckets.length >= 4,
    `got ${wBuckets.length}`);
  checkTrue("week-mode: Aug 10 record lands in its week bucket (count=1)",
    wBuckets.some(b => b.count === 1 && b.value === 200),
    `buckets: ${JSON.stringify(wBuckets.map(b => ({ label: b.label, count: b.count })))}`);

  // 180-day range → month mode
  const longStart = new Date(2026, 1, 1); // Feb 1
  const longEnd = new Date(2026, 7, 1);   // Aug 1
  const longRange: PeriodRange = { kind: "custom", start: longStart, end: longEnd, label: "Feb–Jul 2026" };
  const monthRows = [{ d: "2026-04-15T12:00:00.000Z", v: 50 }];
  const { buckets: mBuckets } = timeBuckets(monthRows, r => r.d, r => r.v, longRange);
  checkTrue("180-day range → month-mode (6 buckets)", mBuckets.length === 6,
    `got ${mBuckets.length}`);
  checkTrue("month-mode: Apr 15 record lands in the April bucket",
    mBuckets.some(b => b.count === 1 && b.value === 50 && b.label.startsWith("Apr")),
    `buckets: ${JSON.stringify(mBuckets.map(b => ({ label: b.label, count: b.count })))}`);

  // Records outside the range don't increment any bucket
  const outsideRows = [{ d: "2025-01-01T00:00:00.000Z", v: 999 }];
  const { buckets: outBuckets } = timeBuckets(outsideRows, r => r.d, r => r.v, weekRange);
  checkTrue("record outside the period is not placed in any bucket",
    outBuckets.every(b => b.count === 0 && b.value === 0));

  // Null date records are excluded
  const nullRows = [{ d: null as string | null, v: 42 }];
  const { buckets: nullBuckets } = timeBuckets(nullRows, r => r.d, r => r.v, weekRange);
  checkTrue("null-date record is excluded from all buckets",
    nullBuckets.every(b => b.count === 0));
}

/* ═══════════════════════════════════════════════════════════════
 * 4. buildLeadsReport — period counts, allLeads fallback, notes
 *    Fixed clock: Wed Aug 12 2026 (week = Aug 10–16)
 * ═══════════════════════════════════════════════════════════════ */
console.log("\ncheck-reports-honesty: buildLeadsReport — with allLeads");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0);
  const weekRange = getPeriodRange("week", undefined, undefined, NOW);
  const m = baseModel();
  // allLeads includes the two active leads + one closed one
  (m as any).allLeads = [
    ...m.leads,
    { id: "LEM-98", name: "Closed Lead", client: "Old", status: "Closed", division: null, owner: null, created: "2026-01-10T00:00:00.000Z", value: 100_000 },
  ] as LeadRow[];

  const r = buildLeadsReport(m, weekRange, NOW);

  // hero = active leads count, not allLeads
  checkTrue("leads hero = active count (2, not allLeads total 3)",
    r.hero.value === "2", `got ${r.hero.value}`);
  checkTrue("leads hero has a drill card", r.hero.card !== null);

  // "New this week" KPI: only LEM-01 was created Aug 12
  const newKpi = r.kpis.find(k => k.label.startsWith("New"));
  checkTrue("leads: new-this-week KPI = 1 (only Aug 12 record)", newKpi?.value === "1",
    `got ${newKpi?.value}`);
  checkTrue("leads: new KPI has a drill card", newKpi?.card !== null);

  // allLeads present → no incomplete note
  checkTrue("leads: allLeads present → no incomplete-note in notes",
    !r.notes.some(n => n.includes("open leads only")));

  // "every lead on record" KPI covers allLeads (3)
  const allKpi = r.kpis.find(k => k.label.includes("every") || k.label.includes("Every") || k.label.includes("record"));
  checkTrue("leads: all-record KPI = 3 (includes closed)",
    allKpi?.value === "3", `got ${allKpi?.value}`);
}

console.log("\ncheck-reports-honesty: buildLeadsReport — missing allLeads (legacy fallback)");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0);
  const weekRange = getPeriodRange("week", undefined, undefined, NOW);
  const m = baseModel();
  // no allLeads on the model

  const r = buildLeadsReport(m, weekRange, NOW);

  // hero still = active
  checkTrue("leads (no allLeads): hero = active count (2)", r.hero.value === "2");

  // incomplete note MUST appear
  checkTrue("leads (no allLeads): incomplete note appears in notes[]",
    r.notes.some(n => n.toLowerCase().includes("open leads only") || n.toLowerCase().includes("full history")),
    `notes: ${JSON.stringify(r.notes)}`);

  // all-record KPI shows open count (2), not a fabricated total
  const allKpi = r.kpis.find(k => k.label.includes("loaded") || k.label.includes("record") || k.label.includes("Every"));
  checkTrue("leads (no allLeads): all-record KPI shows open leads count (2)",
    allKpi?.value === "2", `got ${allKpi?.value}`);
}

console.log("\ncheck-reports-honesty: buildLeadsReport — conversion notice stays hidden");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0);
  const weekRange = getPeriodRange("week", undefined, undefined, NOW);
  const m = baseModel();
  const r = buildLeadsReport(m, weekRange, NOW);
  checkTrue("leads: all-time conversion notice is not rendered",
    !r.notes.some(n => /conversion numbers are all-time|can't be counted per week/i.test(n)),
    `notes: ${JSON.stringify(r.notes)}`);
}

/* ═══════════════════════════════════════════════════════════════
 * 5. buildOppsReport — undated decided bids excluded from period,
 *    note emitted, allOpps fallback
 * ═══════════════════════════════════════════════════════════════ */
console.log("\ncheck-reports-honesty: buildOppsReport — undated decided bids excluded");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0);
  const weekRange = getPeriodRange("week", undefined, undefined, NOW);
  const m = baseModel();
  // decidedOpps: OPM-02 has decidedDate=Aug12 (IN), OPM-03 has decidedDate=null (must NOT appear in period)

  const r = buildOppsReport(m, weekRange, NOW);

  // won this week: OPM-02 won, Aug 12 IN the week
  const wonKpi = r.kpis.find(k => k.label.startsWith("Won"));
  checkTrue("opps: won-this-week KPI = 1 (dated won)", wonKpi?.value.startsWith("1"),
    `got ${wonKpi?.value}`);

  // lost this week: OPM-03 has no date → must be 0 in the period
  const lostKpi = r.kpis.find(k => k.label.startsWith("Lost"));
  checkTrue("opps: undated-lost bid NOT counted in period (0 this week)",
    lostKpi?.value === "0", `got ${lostKpi?.value}`);

  // note must disclose the undated bid
  checkTrue("opps: note discloses undated decided bid (1 without date)",
    r.notes.some(n => n.includes("no recorded decision date") || n.includes("1 decided")),
    `notes: ${JSON.stringify(r.notes)}`);
}

console.log("\ncheck-reports-honesty: buildOppsReport — missing allOpps (legacy fallback)");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0);
  const weekRange = getPeriodRange("week", undefined, undefined, NOW);
  const m = baseModel();
  // no allOpps on the model

  const r = buildOppsReport(m, weekRange, NOW);

  // incomplete note must appear (cancelled/on-hold missing)
  checkTrue("opps (no allOpps): incomplete note appears in notes[]",
    r.notes.some(n => n.toLowerCase().includes("full history") || n.toLowerCase().includes("cancelled")),
    `notes: ${JSON.stringify(r.notes)}`);

  // cancelled KPI must NOT appear (it's only rendered when hasAll)
  checkTrue("opps (no allOpps): cancelled KPI is absent (not 0 as an authoritative figure)",
    !r.kpis.some(k => k.label.toLowerCase().includes("cancelled")));
}

console.log("\ncheck-reports-honesty: buildOppsReport — with allOpps");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0);
  const weekRange = getPeriodRange("week", undefined, undefined, NOW);
  const m = baseModel();
  // Provide allOpps including a cancelled record
  (m as any).allOpps = [
    ...m.opps, ...m.decidedOpps,
    {
      id: "OPM-77", name: "Cancelled Opp", client: "X", sector: "Infra", city: null,
      division: "Civil", stage: "Cancelled", value: 100_000,
      probability: null, weighted: 0, bidDate: null, daysToBid: null,
      closed: true, won: false, created: "2026-04-01T00:00:00.000Z", decidedDate: null,
    },
  ] as OppRow[];

  const r = buildOppsReport(m, weekRange, NOW);

  // no incomplete note since allOpps is present
  checkTrue("opps (with allOpps): no incomplete note",
    !r.notes.some(n => n.toLowerCase().includes("full history")));

  checkTrue("opps: all-time conversion notice is not rendered",
    !r.notes.some(n => /conversion to projects is all-time|per-week conversion rates/i.test(n)),
    `notes: ${JSON.stringify(r.notes)}`);
}

/* ═══════════════════════════════════════════════════════════════
 * 6. buildProjectsReport — period boundaries (created / targetEnd)
 * ═══════════════════════════════════════════════════════════════ */
console.log("\ncheck-reports-honesty: buildProjectsReport — period filters");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0);
  const weekRange = getPeriodRange("week", undefined, undefined, NOW);
  const m = baseModel();
  // PMM-01 created Aug 12 → IN the week; PMM-02 created Jul 1 → OUT

  const r = buildProjectsReport(m, weekRange);

  checkTrue("projects: hero = active count (2)", r.hero.value === "2",
    `got ${r.hero.value}`);

  // new-this-week = 1 (only PMM-01)
  const newKpi = r.kpis.find(k => k.label.startsWith("New"));
  checkTrue("projects: new-this-week = 1 (only Aug 12 record)",
    newKpi?.value === "1", `got ${newKpi?.value}`);

  // starting-this-week: PMM-01 targetStart=Aug 12 → IN
  const startKpi = r.kpis.find(k => k.label.startsWith("Starting"));
  checkTrue("projects: starting-this-week = 1 (PMM-01 starts Aug 12)",
    startKpi?.value === "1", `got ${startKpi?.value}`);

  // due-to-finish: no project has targetEnd in Aug 10–16
  const finKpi = r.kpis.find(k => k.label.startsWith("Due to finish"));
  checkTrue("projects: due-to-finish = 0 (no project ends this week)",
    finKpi?.value === "0", `got ${finKpi?.value}`);

  // closed all-time = 1 (PMM-99)
  const closedKpi = r.kpis.find(k => k.label.includes("Closed"));
  checkTrue("projects: closed-all-time = 1", closedKpi?.value === "1",
    `got ${closedKpi?.value}`);

  // schedule note is always present
  checkTrue("projects: schedule-limitation note always present",
    r.notes.some(n => n.toLowerCase().includes("planned") || n.toLowerCase().includes("schedule")));
}

/* ═══════════════════════════════════════════════════════════════
 * 7. buildCloseoutReport — close-out date filters + hero label
 * ═══════════════════════════════════════════════════════════════ */
console.log("\ncheck-reports-honesty: buildCloseoutReport — close-out date coverage");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0); // Aug 12
  const weekRange = getPeriodRange("week", undefined, undefined, NOW);
  const m = baseModel();
  // PMM-01 closeoutDate=null, PMM-02 closeoutDate=Sep 15 (future), PMM-99 closeoutDate=null (closed)
  // total projects = 3 (2 active + 1 closed), with date = 1

  const r = buildCloseoutReport(m, weekRange, NOW);

  // hero: "1 of 3"
  checkTrue("closeout: hero shows dated vs total (1 of 3)",
    r.hero.value === "1 of 3", `got ${r.hero.value}`);
  checkTrue("closeout: hero card present", r.hero.card !== null);

  // entering this week: Sep 15 is NOT in Aug 10–16 → 0
  const enterKpi = r.kpis.find(k => k.label.startsWith("Entering"));
  checkTrue("closeout: entering-this-week = 0 (Sep 15 is not in Aug week)",
    enterKpi?.value === "0", `got ${enterKpi?.value}`);

  // scheduled ahead: Sep 15 > Aug 12 → upcoming = 1
  const aheadKpi = r.kpis.find(k => k.label.startsWith("Scheduled"));
  checkTrue("closeout: scheduled ahead = 1 (Sep 15 future)",
    aheadKpi?.value === "1", `got ${aheadKpi?.value}`);

  // past date, still open: none (Sep 15 hasn't passed Aug 12)
  const pastKpi = r.kpis.find(k => k.label.includes("Past date"));
  checkTrue("closeout: past-date-still-open = 0 (Sep 15 not past Aug 12)",
    pastKpi?.value === "0", `got ${pastKpi?.value}`);

  // incomplete-coverage note: 2 of 3 projects lack a close-out date
  checkTrue("closeout: coverage-incomplete note present",
    r.notes.some(n => n.includes("2 of 3") || n.includes("close-out date")),
    `notes: ${JSON.stringify(r.notes)}`);
}

console.log("\ncheck-reports-honesty: buildCloseoutReport — past close-out date");
{
  const NOW = new Date(2026, 9, 1, 10, 0, 0); // Oct 1 — AFTER Sep 15
  const weekRange = getPeriodRange("week", undefined, undefined, NOW);
  const m = baseModel();

  const r = buildCloseoutReport(m, weekRange, NOW);

  // Sep 15 is now in the past → PMM-02 should appear in "past date, still open"
  const pastKpi = r.kpis.find(k => k.label.includes("Past date"));
  checkTrue("closeout (Oct 1): past-date-still-open = 1 (Sep 15 now past)",
    pastKpi?.value === "1", `got ${pastKpi?.value}`);
}

/* ═══════════════════════════════════════════════════════════════
 * 8. buildReportsHubStats — spot-check hub aggregate stats
 * ═══════════════════════════════════════════════════════════════ */
console.log("\ncheck-reports-honesty: buildReportsHubStats");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0);
  const weekRange = getPeriodRange("week", undefined, undefined, NOW);
  const m = baseModel();

  const stats = buildReportsHubStats(m, weekRange);
  checkTrue("hub: returns 4 modules (leads/opps/projects/closeout)",
    stats.length === 4, `got ${stats.length}`);

  const leads = stats.find(s => s.id === "leads");
  checkTrue("hub leads: active stat = 2", leads?.stats.some(s => s.label === "Active" && s.value === "2"),
    `got ${JSON.stringify(leads?.stats)}`);

  const opps = stats.find(s => s.id === "opportunities");
  checkTrue("hub opps: open-bids stat = 1", opps?.stats.some(s => s.label === "Open bids" && s.value === "1"),
    `got ${JSON.stringify(opps?.stats)}`);

  const projects = stats.find(s => s.id === "projects");
  checkTrue("hub projects: active stat = 2", projects?.stats.some(s => s.label === "Active" && s.value === "2"),
    `got ${JSON.stringify(projects?.stats)}`);

  const closeout = stats.find(s => s.id === "closeout");
  checkTrue("hub closeout: with-date stat = 1", closeout?.stats.some(s => s.label === "With close-out date" && s.value === "1"),
    `got ${JSON.stringify(closeout?.stats)}`);
}

/* ═══════════════════════════════════════════════════════════════
 * 8b. buildHubHonestyNotes — period/history coverage disclosure
 *     Hub KPIs ("Won in period", "Closed in period") must disclose when
 *     they are known incomplete (undated decided bids, undated closed
 *     projects). Conversion-rates note is always present.
 * ═══════════════════════════════════════════════════════════════ */
console.log("\ncheck-reports-honesty: buildHubHonestyNotes — coverage disclosure");
{
  const m = baseModel();
  // baseModel has 1 undated decided opp (OPM-03, decidedDate: null) and
  // closedProjects[0] (PMM-99) has no closedDate → both gaps should be disclosed.
  const notes = buildHubHonestyNotes(m);

  checkTrue("hub notes: undated-decided note present (OPM-03 has no date)",
    notes.some(n => /no recorded decision date|decided bid/i.test(n)),
    `notes: ${JSON.stringify(notes)}`);

  checkTrue("hub notes: undated-closed note present (PMM-99 has no closedDate)",
    notes.some(n => /no recorded close date|closed project/i.test(n)),
    `notes: ${JSON.stringify(notes)}`);

  checkTrue("hub notes: conversion-rate disclaimer is not rendered",
    !notes.some(n => /conversion rates shown in the lifecycle diagram/i.test(n)),
    `notes: ${JSON.stringify(notes)}`);

  // When no undated decided opps, that note is absent.
  const m2 = baseModel();
  (m2 as any).decidedOpps = (m.decidedOpps as any[]).map((o: any) => ({
    ...o,
    decidedDate: o.decidedDate ?? "2026-07-01T00:00:00.000Z",
  }));
  // Give the closed project a closedDate too
  (m2 as any).closedProjects = (m.closedProjects as any[]).map((p: any) => ({
    ...p,
    closedDate: "2026-01-15T00:00:00.000Z",
  }));
  const notes2 = buildHubHonestyNotes(m2);
  checkTrue("hub notes: undated-decided note absent when all decisions are dated",
    !notes2.some(n => /no recorded decision date/i.test(n)),
    `notes: ${JSON.stringify(notes2)}`);
  checkTrue("hub notes: undated-closed note absent when all closed projects have a date",
    !notes2.some(n => /no recorded close date/i.test(n)),
    `notes: ${JSON.stringify(notes2)}`);
  checkTrue("hub notes: conversion-rate disclaimer remains hidden with complete data",
    !notes2.some(n => /conversion rates shown in the lifecycle diagram/i.test(n)),
    `notes: ${JSON.stringify(notes2)}`);
}

/* ═══════════════════════════════════════════════════════════════
 * 8c. Closed-in-period uses status history when ClosedDate is blank
 * ═══════════════════════════════════════════════════════════════ */
console.log("\ncheck-reports-honesty: closed-in-period status-history fallback");
{
  const m = baseModel();
  const range = getPeriodRange("week", undefined, undefined, new Date(2026, 7, 12, 10, 0, 0));
  (m as any).statusHistory = [{
    module: "PMM",
    ticketId: "PMM-99",
    oldStatus: "Active",
    newStatus: "Closed",
    changedAt: "2026-08-12T15:00:00.000Z",
    changedBy: null,
    source: "user",
  }];
  (m as any).statusHistorySince = "2026-08-01T00:00:00.000Z";
  (m as any).statusHistoryTruncated = false;

  const closed = getClosedProjectsInPeriod(m, range);
  checkTrue("closed-in-period: includes closed project with history but no ClosedDate",
    closed.projects.some(p => p.id === "PMM-99"),
    `got ${closed.projects.map(p => p.id).join(", ")}`);
  checkTrue("closed-in-period: exposes the real status-change timestamp",
    closed.closedAtById.get("pmm-99") === "2026-08-12T15:00:00.000Z",
    `got ${closed.closedAtById.get("pmm-99")}`);
}

/* ═══════════════════════════════════════════════════════════════
 * 9. Robustness — all builders handle empty/minimal model without crashing
 * ═══════════════════════════════════════════════════════════════ */
console.log("\ncheck-reports-honesty: robustness — empty data arrays");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0);
  const weekRange = getPeriodRange("week", undefined, undefined, NOW);
  const m = baseModel();
  (m as any).leads = [];
  (m as any).opps = [];
  (m as any).decidedOpps = [];
  (m as any).projects = [];
  (m as any).closedProjects = [];
  (m as any).leadValue = 0;
  (m as any).pipelineValue = 0;
  (m as any).weightedPipeline = 0;
  (m as any).activeProjects = 0;
  (m as any).backlogValue = 0;
  (m as any).overdueCount = 0;
  (m.conversion as any).convertedLeads = [];
  (m.conversion as any).convertedOpps = [];
  (m as any).backlogByDivision = [];

  let threw = false;
  let lr: ReturnType<typeof buildLeadsReport> | null = null;
  let or: ReturnType<typeof buildOppsReport> | null = null;
  let pr: ReturnType<typeof buildProjectsReport> | null = null;
  let cr: ReturnType<typeof buildCloseoutReport> | null = null;
  try {
    lr = buildLeadsReport(m, weekRange, NOW);
    or = buildOppsReport(m, weekRange, NOW);
    pr = buildProjectsReport(m, weekRange);
    cr = buildCloseoutReport(m, weekRange, NOW);
  } catch (e) {
    threw = true;
    console.error("  threw:", e);
  }
  checkTrue("empty model: no builder throws", !threw);
  checkTrue("empty leads: hero = 0", lr?.hero.value === "0", `got ${lr?.hero.value}`);
  checkTrue("empty opps: hero value is a money string", typeof or?.hero.value === "string" && or.hero.value.includes("$"));
  checkTrue("empty projects: hero = 0", pr?.hero.value === "0", `got ${pr?.hero.value}`);
  checkTrue('empty closeout: hero = "0 of 0"', cr?.hero.value === "0 of 0", `got ${cr?.hero.value}`);
  checkTrue("empty leads: 0 charts or charts without undefined entries",
    lr !== null && Array.isArray(lr.charts));
  checkTrue("empty opps: conversion notice stays hidden",
    or !== null && !or.notes.some(n => /conversion to projects is all-time|per-week conversion rates/i.test(n)));
}

/* ═══════════════════════════════════════════════════════════════
 * 10. Backfill clears the undated-decisions note
 *
 * backfillDecisionDatesRds fills AwardedorLossDate (→ decidedDate) for
 * decided opps that lack it. This block confirms that the same count
 * logic the Reports page uses (decidedOpps.filter(o => !o.decidedDate))
 * goes to zero after the backfill writes a date, and that the note is
 * no longer emitted. The dry-run eligible count is used as the lower
 * bound: count_after <= count_before - eligible.
 * ═══════════════════════════════════════════════════════════════ */
console.log("\ncheck-reports-honesty: backfill clears undated-decisions note");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0);
  const weekRange = getPeriodRange("week", undefined, undefined, NOW);

  // ── BEFORE: three decided opps, two of them undated ────────────────────
  // This mirrors the state before backfillDecisionDatesRds runs:
  //   AwardedorLossDate IS NULL  →  buildOppRow maps to decidedDate: null.
  const mBefore = baseModel();
  (mBefore as any).decidedOpps = [
    {
      id: "OPM-A1", name: "Won Dated", client: "City", sector: "Infra", city: null,
      division: "Civil", stage: "Awarded", value: 3_000_000,
      probability: null, weighted: 0, bidDate: null, daysToBid: null,
      closed: true, won: true,
      created: "2026-06-01T00:00:00.000Z",
      decidedDate: "2026-07-15T00:00:00.000Z",   // ← already dated
    },
    {
      id: "OPM-A2", name: "Lost Undated 1", client: "State", sector: "Infra", city: null,
      division: "Rail", stage: "Lost", value: 1_000_000,
      probability: null, weighted: 0, bidDate: null, daysToBid: null,
      closed: true, won: false,
      created: "2026-05-01T00:00:00.000Z",
      decidedDate: null,                           // ← AwardedorLossDate IS NULL
    },
    {
      id: "OPM-A3", name: "Lost Undated 2", client: "Dept", sector: "Civic", city: null,
      division: "Civil", stage: "No Bid", value: 500_000,
      probability: null, weighted: 0, bidDate: null, daysToBid: null,
      closed: true, won: false,
      created: "2026-04-01T00:00:00.000Z",
      decidedDate: null,                           // ← AwardedorLossDate IS NULL
    },
  ] as unknown as OppRow[];

  const rBefore = buildOppsReport(mBefore, weekRange, NOW);

  // The note counting undated decided bids must appear before the backfill.
  const notesBefore = rBefore.notes;
  const hasUndatedNoteBefore = notesBefore.some(
    n => n.includes("no recorded decision date") ||
         /\d+ decided/.test(n) ||
         n.toLowerCase().includes("undated"),
  );
  checkTrue(
    "backfill check — undated note PRESENT before backfill (2 undated opps)",
    hasUndatedNoteBefore,
    `notes before: ${JSON.stringify(notesBefore)}`,
  );

  // Dry-run eligible count = number of decidedOpps with no decidedDate.
  // This mirrors what backfillDecisionDatesRds returns in dryRun:true mode.
  const eligibleCount = (mBefore as any).decidedOpps.filter(
    (o: OppRow) => !o.decidedDate,
  ).length;
  checkTrue(
    "backfill check — dry-run eligible count = 2",
    eligibleCount === 2,
    `got ${eligibleCount}`,
  );

  // Count undated in the note text (the note says "N decided bid(s)…").
  // Extract the leading integer from the note so we can assert the exact
  // number matches eligibleCount.
  const undatedNoteText = notesBefore.find(
    n => n.includes("no recorded decision date") || /\d+ decided/.test(n),
  ) ?? "";
  const countInNote = parseInt(undatedNoteText.match(/^(\d+)/)?.[1] ?? "-1", 10);
  checkTrue(
    "backfill check — note count matches eligible count (2)",
    countInNote === eligibleCount,
    `note says ${countInNote}, eligible=${eligibleCount}, note="${undatedNoteText}"`,
  );

  // ── AFTER: simulate backfillDecisionDatesRds with dryRun:false ─────────
  // The backfill runs UPDATE … SET AwardedorLossDate = COALESCE(…) WHERE
  // AwardedorLossDate IS NULL AND <outcome-status predicate>.
  // Effect on the report model: every previously-null decidedDate gets a
  // real date (here we use the Created fallback, matching the server logic).
  const mAfter = baseModel();
  (mAfter as any).decidedOpps = (mBefore as any).decidedOpps.map((o: OppRow) => ({
    ...o,
    // Backfill assigns COALESCE(StatusManualDate, Created, GETUTCDATE()).
    // Using the created date here mirrors the server's fallback logic.
    decidedDate: o.decidedDate ?? o.created ?? NOW.toISOString(),
  }));

  const rAfter = buildOppsReport(mAfter, weekRange, NOW);
  const notesAfter = rAfter.notes;

  const hasUndatedNoteAfter = notesAfter.some(
    n => n.includes("no recorded decision date") ||
         /\d+ decided/.test(n) ||
         n.toLowerCase().includes("undated"),
  );
  checkTrue(
    "backfill check — undated note ABSENT after backfill (0 undated opps)",
    !hasUndatedNoteAfter,
    `notes after: ${JSON.stringify(notesAfter)}`,
  );

  // Count undated decided opps remaining after the backfill.
  const undatedAfter = (mAfter as any).decidedOpps.filter(
    (o: OppRow) => !o.decidedDate,
  ).length;
  checkTrue(
    "backfill check — 0 undated decided opps remain after backfill",
    undatedAfter === 0,
    `got ${undatedAfter} remaining`,
  );

  // Count drop is at least the eligible count reported by the dry-run.
  const undatedBefore = (mBefore as any).decidedOpps.filter(
    (o: OppRow) => !o.decidedDate,
  ).length;
  const countDrop = undatedBefore - undatedAfter;
  checkTrue(
    "backfill check — count drop ≥ eligible (dry-run eligible = 2, drop = 2)",
    countDrop >= eligibleCount,
    `drop=${countDrop}, eligible=${eligibleCount}`,
  );
}

/* ═══════════════════════════════════════════════════════════════
 * Status-change ledger — coverage honesty under truncation.
 * The server caps returned rows newest-first; when truncated, the
 * loaded window only reaches back to the OLDEST returned row. The
 * UI must NEVER drop the limitation note (i.e. claim full coverage)
 * based on the tenant-wide `since` when the loaded rows are an
 * incomplete slice of the period.
 * ═══════════════════════════════════════════════════════════════ */
console.log("\ncheck-reports-honesty: status ledger — truncated history never claims coverage");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0);
  const weekRange = getPeriodRange("week", undefined, undefined, NOW);

  // >5,000 in-period rows, truncated: oldest RETURNED row is mid-period
  // (Aug 11), but tenant-wide `since` predates the period start (Aug 10).
  const bigRows: any[] = [];
  for (let i = 0; i < 5001; i++) {
    bigRows.push({
      module: "LEM", ticketId: `LEM-BULK-${i}`, oldStatus: "Active", newStatus: "Converted",
      changedAt: new Date(2026, 7, 11, 12, 0, i % 60).toISOString(), changedBy: null, source: "user",
    });
  }
  const m = baseModel();
  (m as any).statusHistory = bigRows;
  (m as any).statusHistorySince = "2026-08-01T00:00:00.000Z"; // ≤ period start — tempting but WRONG basis
  (m as any).statusHistoryTruncated = true;
  const r = buildLeadsReport(m, weekRange, NOW);
  checkTrue("truncated ledger: limitation note retained (coverage NOT claimed)",
    r.notes.some(n => /incomplete|tracking|cover|all-time/i.test(n)),
    `notes: ${JSON.stringify(r.notes)}`);
  checkTrue("truncated ledger (leads): per-period conversion KPI withheld",
    !r.kpis.some(k => /Converted to opps \(/.test(k.label) && !/all time/i.test(k.label)),
    `kpis: ${JSON.stringify(r.kpis.map(k => k.label))}`);
  const rOppTrunc = buildOppsReport(m, weekRange, NOW);
  checkTrue("truncated ledger (opps): per-period became-projects KPI withheld",
    !rOppTrunc.kpis.some(k => /Became projects \(/.test(k.label) && !/all time/i.test(k.label)),
    `kpis: ${JSON.stringify(rOppTrunc.kpis.map(k => k.label))}`);

  // Ledger began MID-period (since after period start, untruncated): partial
  // slice — per-period KPI must also be withheld.
  const mMid = baseModel();
  (mMid as any).statusHistory = bigRows.slice(0, 10);
  (mMid as any).statusHistorySince = new Date(2026, 7, 11, 0, 0, 0).toISOString(); // after Aug 10 period start
  (mMid as any).statusHistoryTruncated = false;
  const rMid = buildLeadsReport(mMid, weekRange, NOW);
  checkTrue("mid-period history start (leads): per-period conversion KPI withheld",
    !rMid.kpis.some(k => /Converted to opps \(/.test(k.label) && !/all time/i.test(k.label)),
    `kpis: ${JSON.stringify(rMid.kpis.map(k => k.label))}`);
  const rMidOpp = buildOppsReport(mMid, weekRange, NOW);
  checkTrue("mid-period history start (opps): per-period became-projects KPI withheld",
    !rMidOpp.kpis.some(k => /Became projects \(/.test(k.label) && !/all time/i.test(k.label)),
    `kpis: ${JSON.stringify(rMidOpp.kpis.map(k => k.label))}`);

  // Same rows, NOT truncated, since ≤ period start → full coverage, notes drop.
  const m2 = baseModel();
  (m2 as any).statusHistory = bigRows;
  (m2 as any).statusHistorySince = "2026-08-01T00:00:00.000Z";
  (m2 as any).statusHistoryTruncated = false;
  const r2 = buildLeadsReport(m2, weekRange, NOW);
  checkTrue("covered ledger: all-time honesty note dropped",
    !r2.notes.some(n => /all-time|can't be counted per week/i.test(n)),
    `notes: ${JSON.stringify(r2.notes)}`);
  checkTrue("covered ledger: per-period converted KPI present",
    r2.kpis.some(k => /Converted to opps \(/.test(k.label) && !/all time/i.test(k.label)));

  // Ledger absence must not restore the retired conversion banner.
  const m3 = baseModel();
  (m3 as any).statusHistory = null;
  const r3 = buildLeadsReport(m3, weekRange, NOW);
  checkTrue("no ledger: all-time conversion notice stays hidden",
    !r3.notes.some(n => /conversion numbers are all-time|can't be counted per week/i.test(n)), `notes: ${JSON.stringify(r3.notes)}`);
}

/* ═══════════════════════════════════════════════════════════════
 * CRMStatusLedger feed (the page-passed, period-scoped `ledger`
 * param). A TRUNCATED feed has real rows but the server row cap
 * was hit — it must never claim coverage, silence the honesty
 * notes, or replace the dated won/lost fallback.
 * ═══════════════════════════════════════════════════════════════ */
console.log("\ncheck-reports-honesty: CRM ledger feed — truncated fetch never claims coverage");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0);
  const weekRange = getPeriodRange("week", undefined, undefined, NOW);
  const feedRows = [{
    ticketId: "LEM-001", module: "LEM", oldStatus: "Active", newStatus: "Converted",
    changedAt: new Date(2026, 7, 11, 12, 0, 0).toISOString(), changedBy: null,
  }];

  // Truncated CRM feed, no model history → conversion banner stays hidden.
  const m = baseModel();
  (m as any).statusHistory = null;
  const COVERING_SINCE = "2026-01-01T00:00:00.000Z"; // recording began before the period
  const r = buildLeadsReport(m, weekRange, NOW, { rows: feedRows, truncated: true, since: COVERING_SINCE });
  checkTrue("truncated CRM feed: all-time conversion notice stays hidden",
    !r.notes.some(n => /conversion numbers are all-time|can't be counted per week/i.test(n)), `notes: ${JSON.stringify(r.notes)}`);

  // Untruncated CRM feed → covers the fetched period, note drops, KPI appears.
  const r2 = buildLeadsReport(m, weekRange, NOW, { rows: feedRows, truncated: false, since: COVERING_SINCE });
  checkTrue("untruncated CRM feed: all-time note dropped",
    !r2.notes.some(n => /all-time|can't be counted per week/i.test(n)),
    `notes: ${JSON.stringify(r2.notes)}`);
  checkTrue("untruncated CRM feed: per-period converted KPI present",
    r2.kpis.some(k => /Converted to opps \(/.test(k.label) && !/all time/i.test(k.label)));

  // Opps: truncated feed must NOT hide the undated-decisions caveat path —
  // won/lost falls back to dated decisions, undated note logic unchanged.
  const om = baseModel();
  (om as any).statusHistory = null;
  const oppFeed = [{
    ticketId: "OPP-001", module: "OPM", oldStatus: "Pipeline", newStatus: "Closed - Won",
    changedAt: new Date(2026, 7, 11, 12, 0, 0).toISOString(), changedBy: null,
  }];
  const ro = buildOppsReport(om, weekRange, NOW, { rows: oppFeed, truncated: true, since: COVERING_SINCE });
  checkTrue("opps truncated CRM feed: conversion notice stays hidden",
    !ro.notes.some(n => /conversion to projects is all-time|per-week conversion rates/i.test(n)), `notes: ${JSON.stringify(ro.notes)}`);
  const ro2 = buildOppsReport(om, weekRange, NOW, { rows: oppFeed, truncated: false, since: COVERING_SINCE });
  checkTrue("opps untruncated CRM feed: all-time conversion note dropped",
    !ro2.notes.some(n => /all-time/i.test(n)), `notes: ${JSON.stringify(ro2.notes)}`);

  /* Coverage watermark honesty: an untruncated response does NOT prove the
   * ledger existed for the period. */
  // Empty ledger, no watermark (table empty / never recorded) → note stays.
  const rEmpty = buildLeadsReport(m, weekRange, NOW, { rows: [], truncated: false, since: null });
  checkTrue("empty untruncated CRM feed (since null): all-time conversion notice stays hidden",
    !rEmpty.notes.some(n => /conversion numbers are all-time|can't be counted per week/i.test(n)), `notes: ${JSON.stringify(rEmpty.notes)}`);
  // Recording began AFTER the period started → note stays (historical period).
  const lateSince = new Date(2026, 7, 11, 12, 0, 0).toISOString(); // mid-period
  const rLate = buildLeadsReport(m, weekRange, NOW, { rows: feedRows, truncated: false, since: lateSince });
  checkTrue("CRM feed recording began mid-period: all-time conversion notice stays hidden",
    !rLate.notes.some(n => /conversion numbers are all-time|can't be counted per week/i.test(n)), `notes: ${JSON.stringify(rLate.notes)}`);
  // Echo save (old === new) must never count as a conversion.
  const echoRow = [{
    ticketId: "LEM-ECHO", module: "LEM", oldStatus: "Converted", newStatus: "Converted",
    changedAt: new Date(2026, 7, 11, 12, 0, 0).toISOString(), changedBy: null,
  }];
  const rEcho = buildLeadsReport(m, weekRange, NOW, { rows: echoRow, truncated: false, since: COVERING_SINCE });
  const echoKpi = rEcho.kpis.find(k => /Converted to opps \(/.test(k.label) && !/all time/i.test(k.label));
  checkTrue("echo save in CRM feed: not counted as a conversion",
    echoKpi != null && String(echoKpi.value) === "0", `kpi: ${JSON.stringify(echoKpi)}`);
}

/* ═══════════════════════════════════════════════════════════════
 * Org-dimension grouping — Division / Business Unit / Department are
 * SEPARATE canonical fields. Switching the selector regroups real
 * data; a missing dimension yields NO chart (never a silent fallback
 * to another dimension), and export columns follow the selection.
 * ═══════════════════════════════════════════════════════════════ */
console.log("\ncheck-reports-honesty: org-dimension grouping (Div / BU / Dept)");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0);
  const weekRange = getPeriodRange("week", undefined, undefined, NOW);

  /* Same label on different dimensions must NOT merge: division "Civil"
   * and businessUnit "Civil" are unrelated groups. */
  const m = baseModel();
  (m.projects[0] as any).businessUnit = "Transit";
  (m.projects[0] as any).department = "Structures";
  (m.projects[1] as any).businessUnit = "Civil"; // BU that shares a DIVISION's name
  // projects[1] has no department on purpose

  const rDiv = buildProjectsReport(m, weekRange, "division");
  const rBu = buildProjectsReport(m, weekRange, "businessUnit");
  const rDept = buildProjectsReport(m, weekRange, "department");

  const orgChart = (r: ReturnType<typeof buildProjectsReport>, label: string) =>
    r.charts.find(c => c.title === `Backlog Value by ${label}`) ?? null;

  const cDiv = orgChart(rDiv, "Division");
  const cBu = orgChart(rBu, "Business Unit");
  const cDept = orgChart(rDept, "Department");

  checkTrue("projects: Division chart groups by the division field",
    cDiv !== null && cDiv.viz.kind === "hbars"
    && cDiv.viz.rows.some(r => r.label === "Civil" && r.v === 5_000_000),
    `rows: ${JSON.stringify(cDiv?.viz)}`);
  checkTrue("projects: BU chart groups ONLY by businessUnit ('Civil' BU = Tunnel's 3M, not the Civil division's 5M)",
    cBu !== null && cBu.viz.kind === "hbars"
    && cBu.viz.rows.some(r => r.label === "Civil" && r.v === 3_000_000)
    && cBu.viz.rows.some(r => r.label === "Transit" && r.v === 5_000_000),
    `rows: ${JSON.stringify(cBu?.viz)}`);
  checkTrue("projects: Dept chart shows only genuinely attributed rows (1 dept, no fallback)",
    cDept !== null && cDept.viz.kind === "hbars"
    && cDept.viz.rows.length === 1 && cDept.viz.rows[0].label === "Structures",
    `rows: ${JSON.stringify(cDept?.viz)}`);

  /* Two different stable division IDs may legitimately share a name. They
   * must become separate, disambiguated bars, and each bar's drill must show
   * only the record carrying that exact ID. */
  const duplicateNames = baseModel();
  (duplicateNames.projects[0] as any).divisionId = "101";
  (duplicateNames.projects[1] as any).division = "Civil";
  (duplicateNames.projects[1] as any).divisionId = "202";
  const duplicateReport = buildProjectsReport(duplicateNames, weekRange, "division");
  const duplicateChart = orgChart(duplicateReport, "Division");
  const duplicateBars = duplicateChart?.viz.kind === "hbars"
    ? duplicateChart.viz.rows.filter(row => row.label.startsWith("Civil"))
    : [];
  const firstCivil = duplicateBars.find(row => row.filterValue === "id:101");
  const secondCivil = duplicateBars.find(row => row.filterValue === "id:202");
  const firstDrill = firstCivil && duplicateChart?.card
    ? filterCardByField(duplicateChart.card, "division", firstCivil.filterValue ?? firstCivil.label)
    : null;
  const secondDrill = secondCivil && duplicateChart?.card
    ? filterCardByField(duplicateChart.card, "division", secondCivil.filterValue ?? secondCivil.label)
    : null;
  checkTrue("projects: same-named divisions with different IDs render as separate labeled bars",
    duplicateBars.length === 2
    && duplicateBars.every(row => /^Civil \((?:1|2)\)$/.test(row.label))
    && firstCivil?.v === 5_000_000 && secondCivil?.v === 3_000_000,
    `rows: ${JSON.stringify(duplicateBars)}`);
  checkTrue("projects: same-named division bar drills match only its stable ID",
    firstDrill?.rows.length === 1 && secondDrill?.rows.length === 1
    && firstDrill.rows[0]?.id === "PMM-01" && secondDrill.rows[0]?.id === "PMM-02",
    `first: ${JSON.stringify(firstDrill?.rows)}, second: ${JSON.stringify(secondDrill?.rows)}`);
  checkTrue("legacy analytics: same-named division drill matches only its stable ID",
    filterRowsByOrgKey(duplicateNames.projects, "division", "id:101").map(p => p.id).join(",") === "PMM-01"
    && filterRowsByOrgKey(duplicateNames.projects, "division", "id:202").map(p => p.id).join(",") === "PMM-02");

  duplicateNames.staff = [
    { id: "staff-101", name: "Civil One", role: "Engineer", division: "Civil", divisionId: "101", utilization: 70, activeProjects: 1, band: "Normal" },
    { id: "staff-202", name: "Civil Two", role: "Engineer", division: "Civil", divisionId: "202", utilization: 80, activeProjects: 1, band: "Normal" },
  ] as any;
  duplicateNames.demands = [
    { ticket: "PMM-01", project: "Bridge", role: "Designer", pct: 40, start: null, end: null, soft: false },
    { ticket: "PMM-02", project: "Tunnel", role: "Designer", pct: 40, start: null, end: null, soft: false },
  ] as any;
  const executive = buildExecutiveSection(duplicateNames);
  const executiveCivil = executive.divisionScore?.tabs.find(tab => tab.key === "div")?.rows ?? [];
  const executiveCivilOne = executiveCivil.find(row => row.key === "id:101");
  const executiveCivilTwo = executiveCivil.find(row => row.key === "id:202");
  checkTrue("executive scorecard: same-named divisions remain separate ID-backed rows",
    executiveCivilOne?.label === "Civil (1)" && executiveCivilTwo?.label === "Civil (2)"
    && executiveCivilOne.backlogValue === 5_000_000 && executiveCivilTwo.backlogValue === 3_000_000
    && executiveCivilOne.peopleCount === 1 && executiveCivilTwo.peopleCount === 1
    && executiveCivilOne.openSeatsCount === 1 && executiveCivilTwo.openSeatsCount === 1);
  const scorecardSources = (key: string) => {
    const projects = filterRowsByOrgKey(duplicateNames.projects, "division", key);
    const people = filterRowsByOrgKey(duplicateNames.staff, "division", key);
    const projectIds = new Set(projects.map(project => project.id));
    const seats = duplicateNames.demands.filter(demand => projectIds.has(demand.ticket));
    return { projects, people, seats };
  };
  const executiveSourceOne = scorecardSources("id:101");
  const executiveSourceTwo = scorecardSources("id:202");
  checkTrue("executive scorecard: backlog, people, and open-seat drills select only their stable-ID source rows",
    executiveSourceOne.projects.map(row => row.id).join(",") === "PMM-01"
    && executiveSourceOne.people.map(row => row.id).join(",") === "staff-101"
    && executiveSourceOne.seats.map(row => row.ticket).join(",") === "PMM-01"
    && executiveSourceTwo.projects.map(row => row.id).join(",") === "PMM-02"
    && executiveSourceTwo.people.map(row => row.id).join(",") === "staff-202"
    && executiveSourceTwo.seats.map(row => row.ticket).join(",") === "PMM-02");

  const duplicateOpps = baseModel();
  const firstOpp = duplicateOpps.opps[0] as any;
  firstOpp.division = "Civil";
  firstOpp.divisionId = "101";
  duplicateOpps.opps.push({
    ...firstOpp,
    id: "OPM-04",
    name: "Second Civil Pursuit",
    value: 750_000,
    weighted: 375_000,
    divisionId: "202",
  });
  const assertOppDrills = (
    name: string,
    rows: { key: string }[],
    card: import("../src/lib/analyticsCenter").CardModel,
  ) => {
    const first = rows.find(row => row.key === "id:101");
    const second = rows.find(row => row.key === "id:202");
    const firstRows = first ? filterCardByField(card, "division", first.key).rows : [];
    const secondRows = second ? filterCardByField(card, "division", second.key).rows : [];
    checkTrue(`${name}: same-named division bars retain exact opportunity rows`,
      firstRows.length === 1 && firstRows[0]?.id === "OPM-01"
      && secondRows.length === 1 && secondRows[0]?.id === "OPM-04",
      `first: ${JSON.stringify(firstRows)}, second: ${JSON.stringify(secondRows)}`);
  };
  const pipelineSection = buildPipelineSection(duplicateOpps, "division");
  const oppSection = buildOppSection(duplicateOpps, NOW, "division");
  assertOppDrills("pipeline analytics", pipelineSection.byOrg?.rows ?? [], pipelineSection.byOrg?.card ?? pipelineSection.hero.card!);
  assertOppDrills("project analytics opportunities", oppSection.byOrg?.rows ?? [], oppSection.allCard);

  /* Export/table columns must follow the selected dimension. */
  const heroCols = (r: ReturnType<typeof buildProjectsReport>) =>
    (r.hero.card?.columns ?? []).map(c => c.key);
  checkTrue("projects: BU report table/export columns carry businessUnit (not division)",
    heroCols(rBu).includes("businessUnit") && !heroCols(rBu).includes("division"),
    `cols: ${JSON.stringify(heroCols(rBu))}`);
  checkTrue("projects: Dept report table/export columns carry department",
    heroCols(rDept).includes("department"), `cols: ${JSON.stringify(heroCols(rDept))}`);

  /* A model with NO BU data anywhere → no BU chart at all. */
  const bare = baseModel();
  const rBare = buildProjectsReport(bare, weekRange, "businessUnit");
  checkTrue("projects: no businessUnit data → NO BU chart (never falls back to Division)",
    orgChart(rBare, "Business Unit") === null && orgChart(rBare, "Division") === null);

  /* Leads + opps builders honor the dimension the same way. */
  const lm = baseModel();
  (lm.leads[0] as any).businessUnit = "Transit";
  const rLeads = buildLeadsReport(lm, weekRange, NOW, undefined, "businessUnit");
  checkTrue("leads: BU chart present only for attributed leads",
    rLeads.charts.some(c => c.title === "Leads by Business Unit"));
  const om2 = baseModel();
  (om2.opps[0] as any).department = "Structures";
  const rOpps = buildOppsReport(om2, weekRange, NOW, undefined, "department");
  checkTrue("opps: Dept chart present only for attributed pursuits",
    rOpps.charts.some(c => c.title === "Pipeline Value by Department"));
}

console.log("\ncheck-reports-honesty: period-scoped Analytics Center detail cards");
{
  const model = baseModel();
  const customRange: PeriodRange = {
    start: new Date(2026, 7, 10),
    end: new Date(2026, 7, 21),
    label: "Aug 10 – Aug 20, 2026",
  };
  const scopedLeads = (model.allLeads ?? model.leads).filter(lead => inPeriod(lead.created, customRange));
  const scopedOpps = model.opps.filter(opportunity => inPeriod(opportunity.created, customRange));
  const scopedProjects = model.projects.filter(project => inPeriod(project.created, customRange));

  const leads = buildLeadSection(model, "division", { rows: scopedLeads, label: customRange.label });
  const opps = buildOppSection(model, new Date(2026, 7, 20), "division", { rows: scopedOpps, label: customRange.label });
  const projects = buildProjectSection(model, new Date(2026, 7, 20), "division", { rows: scopedProjects, label: customRange.label });

  checkTrue("custom period keeps only in-range leads in every lead drawer",
    leads.allCard.rows.length === 1
    && leads.allCard.rows.every(row => row._ticket === "LEM-01")
    && leads.byStatus?.rows.reduce((sum, row) => sum + row.v, 0) === leads.allCard.rows.length,
    `drawer=${leads.allCard.rows.map(row => row._ticket).join(",")}`);

  checkTrue("custom period recomputes opportunity totals from scoped rows",
    opps.allCard.rows.length === 1
    && opps.pipelineValue === 2_000_000
    && opps.weightedPipeline === 1_000_000
    && opps.byStage?.rows.reduce((sum, row) => sum + row.count, 0) === opps.allCard.rows.length,
    `drawer=${opps.allCard.rows.length}, value=${opps.pipelineValue}, weighted=${opps.weightedPipeline}`);

  checkTrue("custom period recomputes project health and groupings from scoped rows",
    projects.health.card?.rows.length === 1
    && projects.health.card.rows.every(row => row._ticket === "PMM-01")
    && projects.health.pct === 100
    && projects.statuses?.rows.reduce((sum, row) => sum + row.v, 0) === projects.health.card.rows.length,
    `drawer=${projects.health.card?.rows.map(row => row._ticket).join(",")}, health=${projects.health.pct}`);

  checkTrue("period-scoped card drawer titles identify the selected custom range",
    leads.allCard.title.includes(customRange.label)
    && opps.allCard.title.includes(customRange.label)
    && projects.health.card?.title.includes(customRange.label) === true);

  const exportedLeadCards = periodAnalyticsExportCards(
    buildPeriodAnalyticsDetail("leads", model, customRange, "division", new Date(2026, 7, 20)),
  );
  const exportedLeadTicketIds = exportedLeadCards
    .flatMap(card => card.rows.map(row => String(row._ticket ?? "")))
    .filter(Boolean);
  checkTrue("report-level export uses the same scoped lead rows as the visible detail cards",
    exportedLeadCards.length > 0
    && exportedLeadTicketIds.length > 0
    && exportedLeadTicketIds.every(ticketId => ticketId === "LEM-01"),
    `exported=${exportedLeadTicketIds.join(",")}`);

  const projectRange: PeriodRange = {
    start: new Date(2026, 5, 1),
    end: new Date(2026, 8, 1),
    label: "Jun 1 – Aug 31, 2026",
  };
  const projectDetail = buildPeriodAnalyticsDetail("projects", model, projectRange, "division", new Date(2026, 7, 20));
  const overdueCard = filterScheduleHealthCard(projectDetail.section.health.card!, "Overdue");
  const onScheduleCard = filterScheduleHealthCard(projectDetail.section.health.card!, "On schedule");
  checkTrue("schedule-health metric drills open only the matching selected-period projects",
    overdueCard.rows.length === 1
    && overdueCard.rows[0]._ticket === "PMM-02"
    && onScheduleCard.rows.length === 1
    && onScheduleCard.rows[0]._ticket === "PMM-01",
    `overdue=${overdueCard.rows.map(row => row._ticket).join(",")}, onSchedule=${onScheduleCard.rows.map(row => row._ticket).join(",")}`);
}

console.log("\ncheck-reports-honesty: lifecycle transitions rebuild Pipeline Review");
{
  checkTrue("report refresh trigger includes all lifecycle status and close-out date fields",
    [
      "LeadStatus",
      "CRMOpportunityStatusChoice",
      "CRMProjectStatusChoice",
      "CloseoutDate",
      "ClosedDate",
      "ActualCompletionDate",
      "AwardedorLossDate",
    ].every(isLifecycleReportField)
    && !isLifecycleReportField("Title"));

  const common = { resources: [], demands: [], cfo: null };

  const leadBefore = buildReportModel({
    ...common,
    pmm: [],
    opm: [],
    lem: [{ TicketId: "LEM-LIVE-1", Title: "Live lead", LeadStatus: "Active", Closed: false }],
  });
  const leadAfter = buildReportModel({
    ...common,
    pmm: [],
    opm: [{ TicketId: "OPM-LIVE-1", Title: "Converted pursuit", CRMOpportunityStatusChoice: "Proposal", Closed: false }],
    lem: [{ TicketId: "LEM-LIVE-1", Title: "Live lead", LeadStatus: "Converted", Closed: false }],
  });
  checkTrue("lead conversion removes the lead and adds the pursuit in one rebuilt model",
    leadBefore?.leadCount === 1
    && leadAfter?.leadCount === 0
    && leadAfter.activeBids === 1
    && leadAfter.conversion.leadsConverted === 1,
    `before leads=${leadBefore?.leadCount}, after leads=${leadAfter?.leadCount}, bids=${leadAfter?.activeBids}`);

  const oppBefore = buildReportModel({
    ...common,
    pmm: [],
    opm: [{ TicketId: "OPM-LIVE-2", Title: "Winning pursuit", CRMOpportunityStatusChoice: "Proposal", Closed: false }],
    lem: [],
  });
  const oppAfter = buildReportModel({
    ...common,
    pmm: [{ TicketId: "PMM-LIVE-2", Title: "New project", CRMProjectStatusChoice: "Active", Closed: false }],
    opm: [{ TicketId: "OPM-LIVE-2", Title: "Winning pursuit", CRMOpportunityStatusChoice: "Closed – Won", Closed: false }],
    lem: [],
  });
  checkTrue("opportunity conversion removes the bid and adds the project in one rebuilt model",
    oppBefore?.activeBids === 1
    && oppAfter?.activeBids === 0
    && oppAfter.activeProjects === 1
    && oppAfter.conversion.oppsConverted === 1,
    `before bids=${oppBefore?.activeBids}, after bids=${oppAfter?.activeBids}, projects=${oppAfter?.activeProjects}`);

  const projectBefore = buildReportModel({
    ...common,
    pmm: [{ TicketId: "PMM-LIVE-3", Title: "Closing project", CRMProjectStatusChoice: "Active", Closed: false }],
    opm: [],
    lem: [],
  });
  const projectAfter = buildReportModel({
    ...common,
    pmm: [{ TicketId: "PMM-LIVE-3", Title: "Closing project", CRMProjectStatusChoice: "Closed", Closed: true }],
    opm: [],
    lem: [],
  });
  checkTrue("project close-out moves the project from active to closed in one rebuilt model",
    projectBefore?.activeProjects === 1
    && projectAfter?.activeProjects === 0
    && projectAfter.closedProjects.some((project) => project.id === "PMM-LIVE-3"),
    `before active=${projectBefore?.activeProjects}, after active=${projectAfter?.activeProjects}, closed=${projectAfter?.closedProjects.length}`);
}

console.log("\ncheck-reports-honesty: staff project counts");
{
  const model = buildReportModel({
    pmm: [], opm: [], lem: [], demands: [], cfo: null,
    resources: [{
      id: "staff-history",
      name: "History Person",
      divisionName: "Architecture",
      currentPct: 50,
      totalProjects: 4,
      allAllocations: [
        { projectId: "PMM-PAST-1", endDate: "2020-01-01", pct: 10 },
        { projectId: "PMM-PAST-2", endDate: "2020-02-01", pct: 10 },
        { projectId: "PMM-LIVE-1", endDate: "2099-01-01", pct: 15 },
        { projectId: "PMM-LIVE-2", endDate: "2099-02-01", pct: 15 },
      ],
    }],
  });
  const person = model?.staff[0];
  checkTrue("staff model keeps active and total project counts separate",
    person?.activeProjects === 2 && person.totalProjects === 4,
    `active=${person?.activeProjects}, total=${person?.totalProjects}`);

  const divisionCard = model ? buildStaffSection(model).byDivision?.card : null;
  const drawerRow = divisionCard?.rows.find(row => row.name === "History Person");
  const projectsColumn = divisionCard?.columns.find(column => column.key === "totalProjects");
  checkTrue("staff headcount drawer shows the full-history project total",
    drawerRow?.totalProjects === 4 && projectsColumn?.label === "Total Projects",
    `drawer=${drawerRow?.totalProjects}, label=${projectsColumn?.label}`);
}

/* ── 7. AfExplainPopup person drill-down (week-by-week strip) ── */
console.log("\nAF explain popup person week strip:");
{
  const dr = (over: Partial<AfDetailRow>): AfDetailRow => ({
    weekMonday: "2025-01-06", person: "p1", personName: "P One", roleName: "Eng", division: "Civil",
    actualHours: 0, actualCost: 0, actualBill: 0,
    forecastHours: 0, forecastCost: 0, forecastBill: 0,
    remainingHours: 0, remainingCost: 0, remainingBill: 0,
    substituted: false, rateApproximated: false, missingDivision: false,
    ...over,
  });
  const sum = (s: AfWeekCell[]) => s.reduce((t, c) => t + c.value, 0);

  // (a) same-week multi-role rows sum into ONE weekly cell; other people
  //     excluded; result comes back week-sorted regardless of input order
  const multi = [
    dr({ weekMonday: "2025-01-13", forecastHours: 500 }),
    dr({ weekMonday: "2025-01-06", roleName: "Eng", forecastHours: 200 }),
    dr({ weekMonday: "2025-01-06", roleName: "PM", forecastHours: 300 }),
    dr({ weekMonday: "2025-01-06", person: "p2", personName: "Other", forecastHours: 999 }),
  ];
  let cells = personWeekSeries(multi, "p1", "plan", "hours", null, "2025-12-29");
  checkTrue("same-week multi-role rows sum into one weekly cell; others excluded; sorted",
    cells.length === 2 && cells[0].weekMonday === "2025-01-06" && cells[0].hours === 500 && cells[1].value === 500,
    JSON.stringify(cells));

  // (b) cutoff week stays in the left window, is excluded from the right one,
  //     and the two windows partition the plan (EAC used-so-far vs still-planned)
  const span = ["2025-01-06", "2025-01-13", "2025-01-20", "2025-01-27"]
    .map((w) => dr({ weekMonday: w, forecastHours: 100 }));
  const cutoff = "2025-01-13";
  const before = personWeekSeries(span, "p1", "plan", "hours", null, cutoff);
  const after = personWeekSeries(span, "p1", "plan", "hours", cutoff, null);
  checkTrue("cutoff is inclusive left / exclusive right and the windows partition the plan",
    sum(before) === 200 && sum(after) === 200
      && before[before.length - 1]?.weekMonday === cutoff && after[0]?.weekMonday === "2025-01-20",
    `before=${sum(before)} after=${sum(after)}`);

  // (c) strip totals reconcile with the person's row (explainRows) for the
  //     same cutoff — the popup's expansion must add up to the row it explains
  const mixed = [
    dr({ weekMonday: "2025-01-06", actualHours: 40, actualCost: 4000, forecastHours: 50, forecastCost: 5000 }),
    dr({ weekMonday: "2025-01-13", actualHours: 32, actualCost: 3200, forecastHours: 50, forecastCost: 5000, substituted: true }),
    dr({ weekMonday: "2025-01-20", forecastHours: 60, forecastCost: 6000 }),
    dr({ weekMonday: "2025-01-27", forecastHours: 60, forecastCost: 6000 }),
  ];
  const person = explainRows(mixed, "2025-01-13").find((p) => p.person === "p1");
  const aCells = personWeekSeries(mixed, "p1", "actual", "hours", null, "2025-01-13");
  const stillPlanned = personWeekSeries(mixed, "p1", "plan", "cost", "2025-01-13", null);
  checkTrue("strip totals reconcile with the person row (actual ≤ cutoff; still-planned = planTotal − planTd)",
    !!person && sum(aCells) === person.actual.hours
      && sum(stillPlanned) === person.planTotal.cost - person.plan.cost,
    `actual=${sum(aCells)} vs ${person?.actual.hours}; still=${sum(stillPlanned)} vs ${(person?.planTotal.cost ?? 0) - (person?.plan.cost ?? 0)}`);
  checkTrue("substituted weeks mark their cell (auto-counted disclosure)",
    aCells.some((c) => c.substituted), JSON.stringify(aCells));

  // (d) zero weeks never produce cells; open-demand ("" person) rows aggregate
  const demand = [
    dr({ weekMonday: "2025-01-06", person: "", personName: "", forecastHours: 0 }),
    dr({ weekMonday: "2025-01-13", person: "", personName: "", forecastHours: 80 }),
  ];
  cells = personWeekSeries(demand, "", "plan", "hours", null, "2025-12-29");
  checkTrue("zero weeks are dropped; open-demand rows keyed by empty person work",
    cells.length === 1 && cells[0].weekMonday === "2025-01-13" && cells[0].value === 80,
    JSON.stringify(cells));

  // (e) strip axis: short zero runs become explicit 0-week columns, long ones
  //     collapse into a single gap column (person planned in Jan and June)
  const wk = (w: string, v: number): AfWeekCell => ({ weekMonday: w, hours: v, value: v, substituted: false, approx: false });
  const shortGap = buildWeekStrip([[wk("2025-01-06", 10), wk("2025-01-27", 10)]]); // 2 zero weeks between
  const longGap = buildWeekStrip([[wk("2025-01-06", 10), wk("2025-06-02", 10)]]);  // 20 zero weeks between
  const zeroCols = shortGap.filter((c) => c.kind === "week" && c.cells[0] === null).length;
  const gapCol = longGap.find((c) => c.kind === "gap");
  checkTrue("strip fills short zero runs as explicit 0-weeks and collapses long ones",
    shortGap.length === 4 && zeroCols === 2 && longGap.length === 3
      && !!gapCol && gapCol.kind === "gap" && gapCol.weeks === 20,
    `short=${shortGap.length} zeros=${zeroCols} long=${longGap.length} gap=${gapCol && gapCol.kind === "gap" ? gapCol.weeks : "none"}`);

  // (f) two series (Planned/Actual) share one aligned union week axis
  const strip2 = buildWeekStrip([[wk("2025-01-06", 10)], [wk("2025-01-13", 20)]]);
  checkTrue("two-series strips align on the union week axis",
    strip2.length === 2
      && strip2[0].kind === "week" && strip2[0].cells[0]?.value === 10 && strip2[0].cells[1] === null
      && strip2[1].kind === "week" && strip2[1].cells[0] === null && strip2[1].cells[1]?.value === 20,
    JSON.stringify(strip2));
}

/* ═══════════════════════════════════════════════════════════════
 * 8. Executive Forecast — the drill-down popup must always match the
 *    table row the user clicked. Both surfaces read the SAME frozen
 *    overview row through unitValues/execPctUsed, so these pin:
 *    per-unit-family field routing, the favorable-positive variance
 *    sign, the shared null-last sort comparator with variance columns
 *    opening worst-first, and % Used = actual ÷ FAC clamped 0–100.
 * ═══════════════════════════════════════════════════════════════ */
console.log("\ncheck-reports-honesty: Executive Forecast popup ↔ table");
{
  // Frozen overview row with every unit-family field distinct, so any
  // crossed wire (wrong field or wrong family) shows up as a mismatch.
  const frozen: AfWeekRow = {
    weekMonday: "2026-08-24",
    actualHoursTd: 111, forecastRemainingHours: 222, forecastTotalHours: 333, forecastHoursTd: 141,
    actualCostTd: 1111, forecastRemainingCost: 2222, forecastTotalCost: 3333, forecastCostTd: 1411,
    actualBillTd: 11111, forecastRemainingBill: 22222, forecastTotalBill: 33333, forecastBillTd: 14111,
    hoursVariance: 12.5, costVariance: -340, billVariance: 0,
    substitutedHours: 0, unratedActualHours: 0,
    actualsCovered: true,
    final: true, backfilled: false, computedAt: null,
  };
  const h = unitValues(frozen, "hours");
  const c = unitValues(frozen, "cost");
  const b = unitValues(frozen, "bill");
  checkTrue("unitValues(hours) returns the frozen row's hours fields (actualTd/remaining/eac/variance)",
    h.actualTd === 111 && h.remaining === 222 && h.eac === 333 && h.variance === 12.5,
    JSON.stringify(h));
  checkTrue("unitValues(cost) returns the frozen row's cost fields",
    c.actualTd === 1111 && c.remaining === 2222 && c.eac === 3333 && c.variance === -340,
    JSON.stringify(c));
  checkTrue("unitValues(bill) returns the frozen row's bill fields",
    b.actualTd === 11111 && b.remaining === 22222 && b.eac === 33333 && b.variance === 0,
    JSON.stringify(b));
  checkTrue("popup's fixed Hours/Cost Variance tiles read the same fields the unit families do",
    h.variance === frozen.hoursVariance && c.variance === frozen.costVariance,
    `hours ${h.variance} vs ${frozen.hoursVariance}, cost ${c.variance} vs ${frozen.costVariance}`);

  // Sign convention where the numbers are BUILT (seriesFromDetail mirrors the
  // server snapshot math): variance = forecast TD − actual TD, positive =
  // favorable (under plan), and EAC = actual TD + remaining in every family.
  const dr = (over: Partial<AfDetailRow>): AfDetailRow => ({
    weekMonday: "2026-08-17", person: "p1", personName: "P One", roleName: "Eng", division: "Civil",
    actualHours: 0, actualCost: 0, actualBill: 0,
    forecastHours: 0, forecastCost: 0, forecastBill: 0,
    remainingHours: 0, remainingCost: 0, remainingBill: 0,
    substituted: false, rateApproximated: false, missingDivision: false, actualsCovered: true,
    ...over,
  });
  const under = seriesFromDetail([
    dr({ weekMonday: "2026-08-17", actualHours: 60, actualCost: 6000, actualBill: 9000, forecastHours: 100, forecastCost: 10000, forecastBill: 15000 }),
    dr({ weekMonday: "2026-08-24", actualHours: 50, actualCost: 5500, actualBill: 8000, forecastHours: 40, forecastCost: 4000, forecastBill: 6000 }),
  ]);
  const famTd = (row: AfWeekRow, u: "hours" | "cost" | "bill") => u === "hours"
    ? { f: row.forecastHoursTd, a: row.actualHoursTd }
    : u === "cost"
      ? { f: row.forecastCostTd, a: row.actualCostTd }
      : { f: row.forecastBillTd, a: row.actualBillTd };
  const identities = under.every((row) => (["hours", "cost", "bill"] as const).every((u) => {
    const v = unitValues(row, u);
    const { f, a } = famTd(row, u);
    return v.variance === round2(f - a) && v.eac === round2(v.actualTd + v.remaining);
  }));
  checkTrue("every family: variance = forecast TD − actual TD and EAC = actual TD + remaining",
    identities, JSON.stringify(under));
  checkTrue("under plan ⇒ POSITIVE variance in all families (favorable/green)",
    unitValues(under[1], "hours").variance === 30
    && unitValues(under[1], "cost").variance === 2500
    && unitValues(under[1], "bill").variance === 4000,
    JSON.stringify(under[1]));
  const over = seriesFromDetail([
    dr({ actualHours: 130, actualCost: 13000, actualBill: 20000, forecastHours: 100, forecastCost: 10000, forecastBill: 15000 }),
  ]);
  checkTrue("over plan ⇒ NEGATIVE variance in all families (unfavorable/red), never flipped",
    unitValues(over[0], "hours").variance === -30
    && unitValues(over[0], "cost").variance === -3000
    && unitValues(over[0], "bill").variance === -5000,
    JSON.stringify(over[0]));
  const missingActual = seriesFromDetail([dr({ actualsCovered: false, forecastHours: 8 })])[0];
  const explicitZero = seriesFromDetail([dr({ actualsCovered: true, actualHours: 0, forecastHours: 8 })])[0];
  const substituted = seriesFromDetail([dr({ actualsCovered: false, substituted: true, actualHours: 8, forecastHours: 8 })])[0];
  checkTrue("no imported row stays distinguishable from a confirmed numeric zero",
    missingActual.actualsCovered === false && explicitZero.actualsCovered === true,
    JSON.stringify({ missingActual, explicitZero }));
  checkTrue("planned-hours substitution counts as a valid actual source",
    substituted.actualsCovered === true,
    JSON.stringify(substituted));

  // Shared sort comparator (table header clicks): nulls last regardless of
  // direction, variance columns open ascending = worst first, ticket tie-break.
  const mk = (ticket: string, costVar: number, pctUsed: number | null) => ({
    ticket, actual: 1, remaining: 1, fac: 1, hoursVar: 0, costVar, pctUsed,
  });
  const tableRows = [mk("PMM-B", 250, null), mk("PMM-A", -500, 80), mk("PMM-C", 0, 40)];
  const order = (key: "costVar" | "pctUsed", dir: "asc" | "desc") =>
    [...tableRows].sort(execRowComparator(key, dir)).map((r) => r.ticket).join(",");
  checkTrue("costVar ascending puts the WORST (most over forecast) project first",
    order("costVar", "asc") === "PMM-A,PMM-C,PMM-B", order("costVar", "asc"));
  checkTrue("costVar descending reverses the numeric order",
    order("costVar", "desc") === "PMM-B,PMM-C,PMM-A", order("costVar", "desc"));
  checkTrue("null % Used sorts LAST ascending",
    order("pctUsed", "asc") === "PMM-C,PMM-A,PMM-B", order("pctUsed", "asc"));
  checkTrue("null % Used sorts LAST descending too (unknown is never best or worst)",
    order("pctUsed", "desc") === "PMM-A,PMM-C,PMM-B", order("pctUsed", "desc"));
  const ties = [mk("PMM-2", 100, null), mk("PMM-1", 100, null)];
  checkTrue("equal values and double-null both tie-break by ticket (stable order)",
    [...ties].sort(execRowComparator("costVar", "desc")).map((r) => r.ticket).join(",") === "PMM-1,PMM-2"
    && [...ties].sort(execRowComparator("pctUsed", "asc")).map((r) => r.ticket).join(",") === "PMM-1,PMM-2");
  checkTrue("variance columns START ascending (worst first); magnitude columns start descending",
    execInitialSortDir("hoursVar") === "asc" && execInitialSortDir("costVar") === "asc"
    && execInitialSortDir("actual") === "desc" && execInitialSortDir("remaining") === "desc"
    && execInitialSortDir("fac") === "desc" && execInitialSortDir("pctUsed") === "desc");

  // % Used — one shared helper feeds the table column AND the popup tile.
  checkTrue("% Used = actual ÷ FAC as a percent (60/80 → 75)", execPctUsed(60, 80) === 75,
    `got ${execPctUsed(60, 80)}`);
  checkTrue("% Used clamps to 0–100 (overspend → 100, negative actuals → 0)",
    execPctUsed(150, 100) === 100 && execPctUsed(-20, 100) === 0);
  checkTrue("no FAC (0 / negative) → null ('—'), never Infinity, NaN or 0%",
    execPctUsed(50, 0) === null && execPctUsed(50, -10) === null && execPctUsed(0, 0) === null);
  checkTrue("% Used from the frozen row's own actualTd/eac (111/333 → 33.33)",
    round2(execPctUsed(h.actualTd, h.eac) ?? NaN) === 33.33,
    `got ${execPctUsed(h.actualTd, h.eac)}`);
}

// ─── 9. Negative-zero quantization ───────────────────────────────────────────
// Variances are stored as raw float sums (no server-side rounding), so a
// −1e-13 tail reaches the display layer. It must render as a plain "0"/"$0" —
// never a signed "−0" — while real negatives keep their sign. Tone (red/green)
// is judged on round2(v) at the page level for the same reason.
{
  console.log("\n— negative-zero quantization —");
  checkTrue("round2 folds float tails and −0 into +0 (Object.is)",
    Object.is(round2(-1e-13), 0) && Object.is(round2(-0), 0) && Object.is(round2(0), 0));
  checkTrue("hour-tail variances display as plain 0 (never \"−0\")",
    fmtNum(-1e-13) === "0" && fmtNum(-0.004) === "0" && fmtNum(0) === "0");
  checkTrue("money tails display as $0 (never \"−$0\"), incl. sub-dollar negatives",
    fmtUsd(-1e-10) === "$0" && fmtUsd(-0.4) === "$0" && fmtUsd(0) === "$0");
  checkTrue("real negatives keep their sign at every magnitude",
    round2(-0.011) === -0.01 && fmtNum(-2.35) === "-2.35"
    && fmtUsd(-2) === "−$2" && fmtUsd(-12345) === "−$12K");
  checkTrue("sign boundary sits exactly at the rounded display magnitude (−$0.49 → $0, −$0.50 → −$1)",
    fmtUsd(-0.49) === "$0" && fmtUsd(-0.5) === "−$1"
    && fmtUsd(-10000) === "−$10K" && fmtUsd(-1e6) === "−$1M");
}
if (failures) {
  console.error(`\ncheck-reports-honesty: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-reports-honesty: all assertions passed");
