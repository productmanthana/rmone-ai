/**
 * Analytics Center data-honesty check (CI gate).
 * Run: pnpm --filter @workspace/rmone-web run check:analytics-honesty
 *
 * Contract under test (outage ≠ zero):
 *   ReportModel.sources marks which upstream sources actually loaded.
 *   buildHubData must render every metric from a failed source as unknown
 *   ("—" + degraded tile with no drill card), never as a factual zero:
 *     • records (PMM/OPM/LEM) down → executive/financial/project tiles
 *       degraded, hero "—", ticker drops Backlog/Active/Pipeline/Win/Overdue
 *     • staffing down → staff/resource/utilization/bench degraded, People "—",
 *       ticker drops Staff/Bench
 *     • demands down → open-positions degraded, ticker drops Open Positions,
 *       open-position stats elsewhere show "—"
 *     • legacy model without `sources` → treated as complete (no degradation)
 *
 * Exit code 0 = all good; 1 = at least one assertion failed.
 */
import {
  buildHubData, isSafelysummable, computeTotalRow, defaultExplanation,
  filterCardByField, selectByOrgDim,
  type SectionId, type CardColumn, type CardModel,
} from "../src/lib/analyticsCenter";
import {
  buildExecutiveSection, buildProjectSection, buildFinancialSection,
  buildPipelineSection,
} from "../src/lib/analyticsSections";
import {
  buildStaffSection, buildResourceSection, buildUtilizationSection,
  buildBenchSection, buildOpenPositionsSection,
} from "../src/lib/analyticsPeople";
import type { FinancialAnalytics, FinBasis, FinBasisKey, UsageAnalytics, UsageTenant } from "../src/lib/api";
import type { ReportModel } from "../src/lib/reportData";
import { buildUsageView, usageHubTile, KNOWN_MODULES, ALL_TAB, OUTCOME_MIN_WEEKS } from "../src/lib/analyticsUsage";
import { usageAdoptionByOrg } from "../src/lib/usageOrg";
import type { HubTile } from "../src/lib/analyticsCenter";

let failures = 0;
function checkTrue(name: string, cond: boolean, hint = ""): void {
  if (cond) { console.log(`  OK   ${name}`); return; }
  failures++;
  console.error(`  FAIL ${name}${hint ? `\n       ${hint}` : ""}`);
}

/* ── minimal but realistic model (only fields buildHubData touches) ── */
function fakeModel(sources?: ReportModel["sources"]): ReportModel {
  const staff = [
    { name: "Ada Alpha", role: "PM", division: "Civil", activeProjects: 2, utilization: 95, band: "Healthy" },
    { name: "Ben Beta", role: "Engineer", division: "Civil", activeProjects: 1, utilization: 40, band: "Light" },
    { name: "Cy Gamma", role: "Engineer", division: "Rail", activeProjects: 0, utilization: 0, band: "Available" },
  ];
  const projects = [
    { id: "PMM-01", name: "Bridge", client: "City", division: "Civil", sector: "Infra", value: 5_000_000, status: "Active", overdue: false, noDate: false, daysOverdue: null, targetEnd: "2026-12-01", laborContract: 1_000_000, forecastCost: 900_000 },
    { id: "PMM-02", name: "Tunnel", client: "State", division: "Rail", sector: "Infra", value: 3_000_000, status: "Active", overdue: true, noDate: false, daysOverdue: 12, targetEnd: "2026-06-01", laborContract: 700_000, forecastCost: 800_000 },
  ];
  const demands = [
    { ticket: "PMM-01", project: "Bridge", role: "Inspector", pct: 100, start: "2026-09-01", end: "2026-12-01", soft: false },
  ];
  const model = {
    generatedAt: new Date().toISOString(),
    backlogValue: 8_000_000,
    pipelineValue: 2_000_000,
    weightedPipeline: 1_000_000,
    activeBids: 3,
    activeProjects: 2,
    avgProjectValue: 4_000_000,
    totalForecastCost: 1_700_000,
    winRate: 60,
    onTimeRate: 50,
    onScheduleCount: 1,
    overdueCount: 1,
    noDateCount: 0,
    totalStaff: 3,
    benchCount: 2,
    overAllocCount: 0,
    healthyCount: 1,
    deployedRate: 67,
    openDemands: 1,
    backlogByDivision: [
      { label: "Civil", value: 5_000_000, count: 1 },
      { label: "Rail", value: 3_000_000, count: 1 },
    ],
    utilizationBands: [
      { label: "Available", count: 1 },
      { label: "Light", count: 1 },
      { label: "Healthy", count: 1 },
    ],
    projects,
    staff,
    demands,
    /* fields the section-page builders touch */
    wonCount: 3, lostCount: 2, wonValue: 4_000_000, lostValue: 1_000_000,
    leadCount: 1, leadValue: 500_000, marginRiskCount: 1,
    cfo: null,
    funnel: [
      { label: "Leads", count: 1, value: 500_000 },
      { label: "Pursuits", count: 3, value: 2_000_000 },
      { label: "Projects", count: 2, value: 8_000_000 },
    ],
    winLossBySector: [],
    backlogBySector: [{ label: "Infra", value: 8_000_000, count: 2 }],
    clientConcentration: [{ label: "City", value: 5_000_000, count: 1, share: 62.5 }],
    cityExposure: [],
    valueRanges: [{ label: "$1M–$10M", count: 2 }],
    opmByStage: [],
    scheduleHealth: { onSchedule: 1, overdue: 1, noDate: 0 },
    conversion: {
      leadsTotal: 1, leadsConverted: 1, leadsConvertedValue: 500_000, leadConversionRate: 100,
      oppsTotal: 3, oppsConverted: 2, oppsConvertedValue: 8_000_000, oppConversionRate: 67,
      convertedLeads: [], convertedOpps: [],
    },
    opps: [{ id: "OPM-01", name: "Airport", client: "Port", sector: "Infra", city: null, division: "Civil", stage: "Proposal", value: 2_000_000, probability: 50, weighted: 1_000_000, bidDate: null, daysToBid: null, closed: false, won: false }],
    decidedOpps: [{ id: "OPM-02", name: "Depot", client: "State", sector: "Infra", city: null, division: "Rail", stage: "Awarded", value: 4_000_000, probability: null, weighted: 0, bidDate: null, daysToBid: null, closed: true, won: true }],
    closedProjects: [],
    leads: [],
  } as unknown as ReportModel;
  if (sources) model.sources = sources;
  return model;
}

/* fake server financial payload (all three bases share one shape) */
function fakeFinBasis(key: FinBasisKey): FinBasis {
  return {
    key,
    windowStart: "2025-08-18T00:00:00.000Z",
    windowEnd: "2026-08-16T00:00:00.000Z",
    factor: 1,
    plannedHours: 1000,
    assignedHours: 800,
    demandHours: 200,
    assignedBillDollars: 120_000,
    plannedBillDollars: 150_000,
    jobChargeableCost: 60_000,
    nonJobChargeableCost: 20_000,
    unratedBillHours: 50,
    unratedCostHours: 0,
    annualized: { plannedHours: 1000, assignedHours: 800, assignedBillDollars: 120_000, jobChargeableCost: 60_000, nonJobChargeableCost: 20_000 },
    monthly: [{ ym: "2026-07", plannedHours: 100, billDollars: 12_000, costDollars: 8_000 }],
    monthlyByProject: [{
      ym: "2026-07", ticket: "PMM-01", plannedHours: 100, assignedHours: 80,
      billDollars: 12_000, jobCost: 6_000, nonJobCost: 2_000, totalInternalCost: 8_000,
    }],
    byDivision: [{ division: "Civil", plannedHours: 700, assignedHours: 600, billDollars: 90_000 }],
    byProject: [{ ticket: "PMM-01", plannedHours: 600, assignedHours: 500, billDollars: 80_000, jobCost: 40_000, nonJobCost: 10_000 }],
    projectRowsTruncated: 0,
  };
}
function fakeFin(): FinancialAnalytics {
  return {
    available: true,
    stale: false,
    generatedAt: new Date().toISOString(),
    workWeekHours: 40,
    rowCount: 10,
    skippedRows: 0,
    bases: { t12m: fakeFinBasis("t12m"), fytd: fakeFinBasis("fytd"), runrate: fakeFinBasis("runrate") },
  };
}

  const tile: HubTile = { id: "usage", title: "Usage Analytics", hero: "—", takeaway: "", sub: "", viz: { kind: "note", text: "" }, card: null };
const tickerLabels = (h: ReturnType<typeof buildHubData>) => h.ticker.map(t => t.label);

/* ── 1. all sources ok → real numbers, drill cards present ── */
console.log("check-analytics-honesty: all sources ok");
{
  const h = buildHubData(fakeModel({ records: true, staffing: true, demands: true, cfo: true }));
  for (const id of ["executive", "financial", "project"] as SectionId[]) {
    checkTrue(`${id} tile degraded to "—" with no card`, tile(h, id).hero === "—" && tile(h, id).card === null,
      `got hero=${JSON.stringify(tile(h, id).hero)}`);
  }
  checkTrue('hero value is "—" (no $0 backlog)', h.hero.value === "—");
  checkTrue("hero drops record side stats", !h.hero.side.some(s => s.label === "Open pipeline"));
  checkTrue("ticker drops Backlog/Active/Pipeline/Win Rate/Overdue",
    ["Backlog", "Active Projects", "Pipeline", "Win Rate", "Overdue"].every(l => !tickerLabels(h).includes(l)));
  checkTrue("ticker keeps Staff (staffing still ok)", tickerLabels(h).includes("Staff"));
  checkTrue("staff tile stays live", tile(h, "staff").hero === "3" && tile(h, "staff").card !== null);
}

/* ── 6. everything down → nothing renders as a factual number ── */
console.log("\ncheck-analytics-honesty: all sources failed");
{
  const h = buildHubData(fakeModel({ records: true, staffing: true, demands: true, cfo: true }));
  for (const id of ["executive", "financial", "project"] as SectionId[]) {
    checkTrue(`${id} tile degraded to "—" with no card`, tile(h, id).hero === "—" && tile(h, id).card === null,
      `got hero=${JSON.stringify(tile(h, id).hero)}`);
  }
  checkTrue('hero value is "—" (no $0 backlog)', h.hero.value === "—");
  checkTrue("hero drops record side stats", !h.hero.side.some(s => s.label === "Open pipeline"));
  checkTrue("ticker drops Backlog/Active/Pipeline/Win Rate/Overdue",
    ["Backlog", "Active Projects", "Pipeline", "Win Rate", "Overdue"].every(l => !tickerLabels(h).includes(l)));
  checkTrue("ticker keeps Staff (staffing still ok)", tickerLabels(h).includes("Staff"));
  checkTrue("staff tile stays live", tile(h, "staff").hero === "3" && tile(h, "staff").card !== null);
}

/* ── 6. everything down → nothing renders as a factual number ── */
console.log("\ncheck-analytics-honesty: all sources failed");
{
  const h = buildHubData(fakeModel({ records: true, staffing: true, demands: true, cfo: true }));
  for (const id of ["staff", "resource", "utilization", "bench"] as SectionId[]) {
    checkTrue(`${id} tile degraded to "—" with no card`, tile(h, id).hero === "—" && tile(h, id).card === null,
      `got hero=${JSON.stringify(tile(h, id).hero)} card=${tile(h, id).card === null ? "null" : "present"}`);
    checkTrue(`${id} tile never shows 0`, !/^0/.test(tile(h, id).hero));
  }
  checkTrue("ticker drops Staff + Bench", !tickerLabels(h).includes("Staff") && !tickerLabels(h).includes("Bench"));
  checkTrue("ticker keeps record entries", tickerLabels(h).includes("Backlog"));
  const peopleSide = h.hero.side.find(s => s.label === "People");
  checkTrue('hero side People shows "—"', peopleSide?.value === "—", `got ${JSON.stringify(peopleSide)}`);
  checkTrue('executive sub says "— people", not "0 people"', tile(h, "executive").sub.includes("— people"));
  checkTrue("executive tile itself stays live", tile(h, "executive").card !== null);
}

/* ── 4. demands down → open positions unknown everywhere ── */
console.log("\ncheck-analytics-honesty: demand source failed");
{
  const h = buildHubData(fakeModel({ records: true, staffing: true, demands: true, cfo: true }));
  checkTrue('open-positions tile degraded to "—" with no card',
    tile(h, "open-positions").hero === "—" && tile(h, "open-positions").card === null);
  checkTrue("ticker drops Open Positions", !tickerLabels(h).includes("Open Positions"));
  const resCard = tile(h, "resource").card;
  checkTrue('resource card "Open positions" stat shows "—"',
    resCard !== null && resCard.stats.some(s => s.label === "Open positions" && s.value === "—"));
  const benchCard = tile(h, "bench").card;
  checkTrue('bench card "Open positions to fill" stat shows "—"',
    benchCard !== null && benchCard.stats.some(s => s.label === "Open positions to fill" && s.value === "—"));
  checkTrue('resource sub shows "— unfilled"', tile(h, "resource").sub.includes("— unfilled"));
}

/* ── 5. records down → executive/financial/project + hero unknown ── */
console.log("\ncheck-analytics-honesty: records source failed (PMM/OPM/LEM incomplete)");
{
  const h = buildHubData(fakeModel({ records: true, staffing: true, demands: true, cfo: true }));
  for (const id of ["executive", "financial", "project"] as SectionId[]) {
    checkTrue(`${id} tile degraded to "—" with no card`, tile(h, id).hero === "—" && tile(h, id).card === null,
      `got hero=${JSON.stringify(tile(h, id).hero)}`);
  }
  checkTrue('hero value is "—" (no $0 backlog)', h.hero.value === "—");
  checkTrue("hero drops record side stats", !h.hero.side.some(s => s.label === "Open pipeline"));
  checkTrue("ticker drops Backlog/Active/Pipeline/Win Rate/Overdue",
    ["Backlog", "Active Projects", "Pipeline", "Win Rate", "Overdue"].every(l => !tickerLabels(h).includes(l)));
  checkTrue("ticker keeps Staff (staffing still ok)", tickerLabels(h).includes("Staff"));
  checkTrue("staff tile stays live", tile(h, "staff").hero === "3" && tile(h, "staff").card !== null);
}

/* ── 6. everything down → nothing renders as a factual number ── */
console.log("\ncheck-analytics-honesty: all sources failed");
{
  const h = buildHubData(fakeModel({ records: true, staffing: true, demands: true, cfo: true }));
  const withNumbers = h.tiles.filter(t => t.id !== "usage" && t.hero !== "—");
  checkTrue("every data tile shows unknown", withNumbers.length === 0,
    `still numeric: ${withNumbers.map(t => `${t.id}=${t.hero}`).join(", ")}`);
  checkTrue("ticker is empty", h.ticker.length === 0, `ticker: ${tickerLabels(h).join(", ")}`);
  checkTrue("no tile offers a drill card", h.tiles.every(t => t.card === null));
}

/* ── 7. Executive section builder: live vs records-down ── */
console.log("\ncheck-analytics-honesty: executive section builder");
{
  const ok = buildPipelineSection(liveModel);
  checkTrue("pipeline: recordsOk true with real hero value", ok.recordsOk && ok.hero.value.startsWith("$"));
  checkTrue("pipeline: hero card present (drill to pursuits)", ok.hero.card !== null);
  checkTrue("pipeline: win-rate pct = 60 (from model) with decided card",
    ok.winRate.pct === 60 && ok.winRate.card !== null);
  checkTrue("pipeline: 4 KPIs all present", ok.kpis.length === 4);
  checkTrue("pipeline: avg-bid-size KPI shows money (3 bids, non-zero)",
    ok.kpis.some(k => k.label === "Avg bid size" && k.value.startsWith("$")));
  checkTrue("pipeline: early-stage leads KPI always carries a drill card (zero rows ok)",
    ok.kpis.some(k => k.label === "Early-stage leads" && k.card !== null));
  checkTrue("pipeline stage totals drill to individual pursuits",
    ok.byStage !== null
    && filterCardByField(ok.byStage.card, "stage", "Proposal").rows.length === 1
    && ok.byStage.card.rows[0]?._ticket === "OPM-01");
}

console.log("\ncheck-analytics-honesty: pipeline section builder (records down)");
{
  const down = buildPipelineSection(fakeModel({ records: false, staffing: true, demands: true, cfo: true }));
  checkTrue('records down → hero "—" with no card', down.hero.value === "—" && down.hero.card === null);
  checkTrue("records down → gauges unknown, never 0", down.winRate.pct === null && down.onTime.pct === null);
  checkTrue("records down → no KPIs, no charts, no lists",
    down.kpis.length === 0 && down.funnel === null && down.backlogByDivision === null
    && down.statusSegments === null && down.clients === null && down.divisionScore === null);
}

/* ── 8. Project section builder: live vs records-down ── */
console.log("\ncheck-analytics-honesty: project section builder");
{
  const ok = buildPipelineSection(liveModel);
  checkTrue("health gauge carries real on-time rate + card", ok.health.pct === 50 && ok.health.card !== null);
  checkTrue("overdue table lists the 1 overdue project", ok.overdue !== null && ok.overdue.rows.length === 1 && ok.overdue.card !== null);
  checkTrue("sector chart + statuses built", ok.bySector !== null && ok.statuses !== null);
  checkTrue("project sector totals drill to project rows",
    ok.bySector !== null
    && ok.bySector.card.rows.length === 2
    && ok.bySector.card.rows.every(row => row._ticket));
  checkTrue("project city totals drill to project rows when city data exists",
    ok.byCity === null || ok.byCity.card.rows.every(row => row._ticket));
  checkTrue("value-by-org (division) built from the canonical division field",
    ok.byOrg !== null && ok.byOrg.dim === "division" && ok.byOrg.rows.some(r => r.label === "Civil"));

  /* org dimensions are SEPARATE canonical fields — a model whose projects
   * carry no businessUnit/department must yield NO org chart for those
   * dims, never silently fall back to Division. */
  const buDim = buildProjectSection(fakeModel({ records: true, staffing: true, demands: true, cfo: true }), new Date(), "businessUnit");
  checkTrue("BU dim with no BU data → byOrg null (never falls back to Division)", buDim.byOrg === null);
  const deptDim = buildProjectSection(fakeModel({ records: true, staffing: true, demands: true, cfo: true }), new Date(), "department");
  checkTrue("Dept dim with no dept data → byOrg null (never falls back to Division)", deptDim.byOrg === null);
  const messy = fakeModel({ records: true, staffing: true, demands: true, cfo: true });
  (messy.projects[0] as unknown as Record<string, unknown>).sector = " Infra ";
  (messy.projects[0] as unknown as Record<string, unknown>).city = " New York ";
  (messy.projects[1] as unknown as Record<string, unknown>).sector = "";
  const messyProjects = buildProjectSection(messy);
  checkTrue("trimmed/blank project groups still drill to every source project",
    messyProjects.bySector !== null
    && messyProjects.bySector.rows.every(group =>
      filterCardByField(messyProjects.bySector!.card, "sector", group.label).rows.length === group.count)
    && messyProjects.byCity !== null
    && messyProjects.byCity.rows.every(group =>
      filterCardByField(messyProjects.byCity!.card, "city", group.label).rows.length === group.count));

  const down = buildPipelineSection(fakeModel({ records: false, staffing: true, demands: true, cfo: true }));
  checkTrue("records down → health unknown with plain explanation",
    down.health.pct === null && down.health.card === null && down.health.sentence.includes("didn't load"));
  checkTrue("records down → every sub-section null",
    down.statuses === null && down.bySector === null && down.byOrg === null
    && down.overdue === null && down.endingSoon === null && down.valueRanges === null);
}

/* ── 9. Financial section builder: server payload honesty ── */
console.log("\ncheck-analytics-honesty: financial section builder");
{
  const m = fakeModel({ records: true, staffing: true, demands: true, cfo: true });

  const ok = buildPipelineSection(liveModel);
  checkTrue("contract money cards come from the ReportModel", ok.backlog !== null && ok.contractedLabor !== null);
  checkTrue("fin state ok with all three bases",
    ok.fin.state === "ok" && (["t12m", "fytd", "runrate"] as FinBasisKey[]).every(k => ok.fin.state === "ok" && !!ok.fin.bases[k]));
  if (ok.fin.state === "ok") {
    const v = s.fin.bases.t12m;
    checkTrue("coverage = allocated/contracted (80%)", v.coveragePct === 80, `got ${v.coveragePct}`);
    checkTrue("chargeable share = job/(job+nonjob) (75%)", v.chargeableSharePct === 75, `got ${v.chargeableSharePct}`);
    checkTrue("unrated hours surface a note", v.unratedNote !== null && v.unratedNote.includes("50"));
    checkTrue("project drill decorated with real name from the model",
      v.hoursCard.rows.some(r => r.ticket === "PMM-01" && r.name === "Bridge" && r._ticket === "PMM-01"));
    const monthRow = v.monthlyCard.rows.find(r => r.ym === "2026-07");
    const monthDetail = v.monthlyDetailCards["2026-07"];
    checkTrue("each month summary row opens its project-level drill card",
      monthRow?._subCard === monthDetail && monthDetail !== undefined);
    checkTrue("month chart drill exposes project rows, not the one-row month summary",
      !!monthDetail && monthDetail.rows.length === 1 && monthDetail.rows[0].ticket === "PMM-01");
    checkTrue("month project detail carries an explicit calculation explanation",
      !!monthDetail && monthDetail.explanation?.measure === "planned"
        && monthDetail.explanation.calculation.includes("hours-win"));

    /* Stale-payload honesty: fakeFin() has NO org→project evidence (older
     * cached payload shape). No org card may fall back to record tags, because
     * those tags do not reconcile to allocation-level figures. */
    checkTrue("payload without BU project evidence → NO BU card",
      v.buCard === null);
    checkTrue("payload without department project evidence → NO department card",
      v.departmentCard === null);
    checkTrue("payload without division project evidence → NO division card",
      v.divisionCard === null);
  }

  /* Server-provided BU/department groupings → cards built from THOSE rows. */
  {
    const fin = fakeFin();
    if (fin.available) {
      fin.bases.t12m = {
        ...fin.bases.t12m,
        byBusinessUnit: [
          { bu: "Transit", plannedHours: 700, assignedHours: 600, billDollars: 90_000 },
          { bu: "No business unit", plannedHours: 300, assignedHours: 200, billDollars: 30_000 },
        ],
        byDepartment: [{ department: "Structures", plannedHours: 400, assignedHours: 350, billDollars: 50_000 }],
        byDivisionByProject: [{
          org: "Civil",
          rows: [
            { ticket: "PMM-01", plannedHours: 500, assignedHours: 450, billDollars: 70_000, jobCost: 35_000, nonJobCost: 8_000 },
            { ticket: "PMM-02", plannedHours: 200, assignedHours: 150, billDollars: 20_000, jobCost: 12_000, nonJobCost: 4_000 },
          ],
          rowsTruncated: 0,
        }],
        byBusinessUnitByProject: [
          {
            org: "Transit",
            rows: [
              { ticket: "PMM-01", plannedHours: 500, assignedHours: 450, billDollars: 70_000, jobCost: 35_000, nonJobCost: 8_000 },
              { ticket: "PMM-02", plannedHours: 200, assignedHours: 150, billDollars: 20_000, jobCost: 12_000, nonJobCost: 4_000 },
            ],
            rowsTruncated: 0,
          },
          {
            org: "No business unit",
            rows: [
              { ticket: "PMM-03", plannedHours: 300, assignedHours: 200, billDollars: 30_000, jobCost: 10_000, nonJobCost: 5_000 },
            ],
            rowsTruncated: 0,
          },
        ],
        byDepartmentByProject: [{
          org: "Structures",
          rows: [
            { ticket: "PMM-01", plannedHours: 250, assignedHours: 225, billDollars: 30_000, jobCost: 15_000, nonJobCost: 4_000 },
            { ticket: "PMM-02", plannedHours: 150, assignedHours: 125, billDollars: 20_000, jobCost: 10_000, nonJobCost: 3_000 },
          ],
          rowsTruncated: 0,
        }],
      };
    }
    const withOrg = buildFinancialSection(m, fin);
    if (withOrg.fin.state === "ok") {
      const v2 = withOrg.fin.bases.t12m;
      checkTrue("server byBusinessUnit → BU card rows mirror the server groups (incl. Unassigned)",
        v2.buCard !== null && v2.buCard.rows.some(r => r.bu === "Transit" && r.billDollars === 90_000)
        && v2.buCard.rows.some(r => r.bu === "Unassigned"));
      checkTrue("server byDepartment → department card from person-level dept rows",
        v2.departmentCard !== null && v2.departmentCard.rows.some(r => r.department === "Structures"));
      const assertExactOrgDrill = (name: string, card: CardModel | null, groupField: string, groupValue: string) => {
        const group = card?.rows.find(row => row[groupField] === groupValue);
        const detail = group?._subCard as CardModel | undefined;
        const sum = (field: "plannedHours" | "assignedHours" | "billDollars") =>
          detail?.rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
        checkTrue(`${name} project drill reconciles planned hours`,
          !!group && sum("plannedHours") === group.plannedHours);
        checkTrue(`${name} project drill reconciles assigned hours`,
          !!group && sum("assignedHours") === group.assignedHours);
        checkTrue(`${name} project drill reconciles billing`,
          !!group && sum("billDollars") === group.billDollars);
        checkTrue(`${name} drill uses allocation evidence, not indicative record tags`,
          !!detail && !/indicative|record-tagged/i.test(detail.takeaway));
      };
      assertExactOrgDrill("Business Unit", v2.buCard, "bu", "Transit");
      assertExactOrgDrill("Division", v2.divisionCard, "division", "Civil");
      assertExactOrgDrill("Department", v2.departmentCard, "department", "Structures");
    } else {
      checkTrue("org-grouping payload still parses", false, `state=${withOrg.fin.state}`);
    }
  }

  const netErr = buildFinancialSection(m, null);
  checkTrue("fetch failure → state error (page shows —, no zeros)", netErr.fin.state === "error");

  const unavailable = buildFinancialSection(m, { available: false, reason: "Financial analytics needs the live allocation database." });
  checkTrue("available:false → unavailable with the server's reason",
    unavailable.fin.state === "unavailable" && unavailable.fin.reason.includes("allocation database"));

  const restricted = buildFinancialSection(m, { available: false, restricted: true, reason: "no financial access" });
  checkTrue("403 → unavailable + restricted flag", restricted.fin.state === "unavailable" && restricted.fin.restricted);

  const recordsDown = buildFinancialSection(fakeModel({ records: false, staffing: true, demands: true, cfo: true }), fakeFin());
  checkTrue("records down → contract-money cards null (no fabricated $)",
    recordsDown.backlog === null && recordsDown.contractedLabor === null);
  checkTrue("records down → fin data still served (independent source)", recordsDown.fin.state === "ok");
}

/* ── 10. Zero planned hours → coverage unknown, not 0% or NaN ── */
console.log("\ncheck-analytics-honesty: financial zero-plan window");
{
  const m = fakeModel({ records: true, staffing: true, demands: true, cfo: true });
  const empty = buildUsageView(payload([usageTenant({
    activeUsers: 0, logins: 0, pageVisits: 0, humanTx: 0, humanEvents: 0, systemEvents: 0,
    weekly: [{ week: "2026-08-03", activity: 0, wau: 0 }, { week: "2026-08-10", activity: 0, wau: 0 }],
    features: [], txByType: [], loginBands: { every: 0, most: 0, occasional: 0 },
    activeUserRows: [], activeUserTotal: 0, neverActiveTotal: 10,
  })]), ALL_TAB);
  if (empty.available) {
    empty.bases.t12m = {
      ...empty.bases.t12m,
      plannedHours: 0, assignedHours: 0, demandHours: 0,
      jobChargeableCost: 0, nonJobChargeableCost: 0,
      unratedBillHours: 0, unratedCostHours: 0,
    };
  }
  const s = buildPipelineSection(m);
  if (s.fin.state === "ok") {
    const v = s.fin.bases.t12m;
    checkTrue("no plan → coverage null (renders —)", v.coveragePct === null, `got ${v.coveragePct}`);
    checkTrue("no cost → chargeable share null", v.chargeableSharePct === null, `got ${v.chargeableSharePct}`);
    checkTrue("no unrated hours → no note", v.unratedNote === null);
  } else {
    checkTrue("zero-plan payload still parses", false, `state=${s.fin.state}`);
  }
}

/* ── 11. People-side section builders (Staff / Resource / Utilization /
 *        Bench / Open Positions): live, staffing-down, demands-down.
 *        The fake staff rows carry only the base fields (no org/HR extras,
 *        no allocations) — builders must degrade those to null, not crash. ── */
console.log("\ncheck-analytics-honesty: people section builders (live)");
{
  const m = fakeModel({ records: true, staffing: true, demands: true, cfo: true });

  const st = buildStaffSection(m);
  checkTrue("staff hero = 3 with roster card (matches hub tile)", st.hero.value === "3" && st.hero.card !== null);
  checkTrue("staff byDivision mirrors hub split (Civil 2, Rail 1)",
    st.byDivision !== null && st.byDivision.rows[0].label === "Civil" && st.byDivision.rows[0].v === 2);
  checkTrue("staff: no BU/dept/type/city extras on payload → cards null, not fabricated",
    st.byBusinessUnit === null && st.byDepartment === null && st.employmentTypes === null && st.cities === null);

  // Employment-type donut segment drills: segment labels come from countBy
  // (which TRIMS values and maps blank → "Unassigned"), so the card rows must
  // canonicalize identically or filterCardByField finds zero rows for a
  // segment. Regression: whitespace-padded and blank/missing types.
  {
    /* Departments on staff AND projects: the Executive dept tier must appear
     * and now carry backlog + open seats from the canonical project
     * department field (previously dept had no project data at all). */
    const m2 = fakeModel({ records: true, staffing: true, demands: true, cfo: true });
    const staff2 = (m2 as unknown as { staff: Record<string, unknown>[] }).staff;
    staff2[0].employmentType = " Full-time ";   // stray whitespace
    staff2[1].employmentType = "Contract";
    staff2[2].employmentType = "";              // blank → "Unassigned"
    const st2 = buildStaffSection(m2);
    checkTrue("whitespace employment types still build the donut", st2.employmentTypes !== null);
    if (st2.employmentTypes) {
      for (const seg of st2.employmentTypes.segments) {
        const drilled = filterCardByField(st2.employmentTypes.card, "employmentType", seg.label);
        checkTrue(`employment-type segment "${seg.label}" drills to exactly its ${seg.v} row(s)`,
          drilled.rows.length === seg.v,
          `got ${drilled.rows.length} rows`);
      }
      checkTrue("blank employment type surfaces as an 'Unassigned' segment",
        st2.employmentTypes.segments.some(s2 => s2.label === "Unassigned" && s2.v === 1));
    }
  }
  checkTrue("staff: EVERY live KPI carries a drill card (zeroes included)",
    st.kpis.length === 4 && st.kpis[0].value === "2" && st.kpis[1].value === "2" && st.kpis.every(k => k.card !== null));

  const rs = buildResourceSection(m, 40);
  checkTrue('resource hero "—", rate null, everything null',
    rs.hero.deployed === "—" && rs.hero.rate === null && rs.weeklyLoad === null && rs.busiest === null && rs.kpis.length === 0);

  const ut = buildUtilizationSection(m);
  checkTrue("utilization avg null with plain explanation",
    ut.hero.avgPct === null && ut.hero.caption.includes("didn't load") && ut.bands === null && ut.divisionBoard === null);

  const be = buildBenchSection(m);
  checkTrue('bench hero "—", matches + lists null',
    be.hero.value === "—" && be.matches === null && be.byRole === null && be.rollOffs === null);

  const op = buildOpenPositionsSection(m);
  checkTrue("open-positions hero = 1 (matches hub tile)", op.hero.value === "1" && op.hero.card !== null);
  checkTrue("open-positions roles-affected chip drills to a card", op.hero.rolesCard !== null);
  checkTrue("open-positions: EVERY live KPI carries a drill card (zeroes included)",
    op.kpis.length === 4 && op.kpis.every(k => k.card !== null));
  checkTrue("open-positions weekly seats chart built from real dates",
    op.weeklySeats !== null && op.weeklySeats.rows.length === 12 && op.weeklySeats.undatedCount === 0);
  checkTrue("weekly seat shortcuts drill to individual open positions",
    op.weeklySeats !== null
    && op.weeklySeats.rows.every(row => op.weeklySeats!.drillCards[row.week]?.rows.length === row.seats));
  checkTrue("open-positions affected projects link the ticket",
    op.affectedProjects !== null && op.affectedProjects.card.rows.every(r => r._ticket === "PMM-01"));
  checkTrue("open-positions timing buckets sum to demand count",
    op.timing !== null && op.timing.segments.reduce((a, s) => a + s.v, 0) === 1);
}

/* ── 11b. Week math + undated handling (fixed clock: Wed 2026-08-12,
 *         week 0 = Mon Aug 10 .. Sun Aug 16) ── */
console.log("\ncheck-analytics-honesty: week boundaries + undated positions");
{
  const NOW = new Date(2026, 7, 12, 10, 0, 0);

    /* Selected dimension absent while ANOTHER has data: add BU to the roster
     * only — BU board appears, Dept board must STAY null. */
    const m1 = fakeModel({ records: true, staffing: true, demands: true, cfo: true });
  (m1.staff[0] as { allocations?: unknown }).allocations = [
    { projectId: "PMM-01", projectName: "Bridge", pct: 100, startDate: "2026-08-10", endDate: "2026-08-16" },
  ];
  const rs1 = buildResourceSection(m1, 40, NOW);
  checkTrue("allocation ending Sunday counts in its own week (40h)",
    rs1.weeklyLoad !== null && rs1.weeklyLoad.rows[0].hours === 40,
    `got ${rs1.weeklyLoad ? rs1.weeklyLoad.rows[0].hours : "null"}`);
  checkTrue("…and NOT in the following week (0h)",
    rs1.weeklyLoad !== null && rs1.weeklyLoad.rows[1].hours === 0,
    `got ${rs1.weeklyLoad ? rs1.weeklyLoad.rows[1].hours : "null"}`);
  checkTrue("weekly booked-hours shortcut drills to the active allocation",
    rs1.weeklyLoad !== null
    && rs1.weeklyLoad.drillCards[rs1.weeklyLoad.rows[0].week]?.rows.length === 1
    && rs1.weeklyLoad.drillCards[rs1.weeklyLoad.rows[0].week]?.rows[0]?._ticket === "PMM-01");

  /* undated positions are disclosed, never plotted into every week */
    /* Departments on staff AND projects: the Executive dept tier must appear
     * and now carry backlog + open seats from the canonical project
     * department field (previously dept had no project data at all). */
    const m2 = fakeModel({ records: true, staffing: true, demands: true, cfo: true });
  (m2.demands as unknown as Record<string, unknown>[]).push(
    { ticket: "PMM-02", project: "Tunnel", role: "Surveyor", pct: 100, start: null, end: null, soft: false });
  const op2 = buildOpenPositionsSection(m2, NOW);
  checkTrue("undated position excluded from the weekly series",
    op2.weeklySeats !== null && op2.weeklySeats.rows[0].seats === 0,
    `week0 seats = ${op2.weeklySeats ? op2.weeklySeats.rows[0].seats : "null"} (undated row must not fill every week)`);
  checkTrue("…but disclosed as a count in the card",
    op2.weeklySeats !== null && op2.weeklySeats.undatedCount === 1
    && op2.weeklySeats.card.takeaway.includes("no dates")
    && op2.weeklySeats.card.stats.some(s => s.label === "Not plotted (no dates)" && s.value === "1"));
  checkTrue("undated position still counted in the timing strip",
    op2.timing !== null && op2.timing.segments.some(s => s.label === "No start date" && s.v === 1));

  /* empty-but-loaded roster: page average agrees with the hub tile (0%) */
  const m3 = fakeModel({ records: true, staffing: true, demands: true, cfo: true });
  (m3 as unknown as { staff: unknown[]; totalStaff: number }).staff = [];
  (m3 as unknown as { staff: unknown[]; totalStaff: number }).totalStaff = 0;
  const hub3 = buildHubData(m3);
  const ut3 = buildUtilizationSection(m3);
  checkTrue("empty roster: hub tile and page agree on 0%",
    tile(hub3, "utilization").hero === "0%" && ut3.hero.avgPct === 0,
    `hub=${tile(hub3, "utilization").hero} page=${String(ut3.hero.avgPct)}`);
}

console.log("\ncheck-analytics-honesty: people section builders (staffing down)");
{
  const m = fakeModel({ records: true, staffing: true, demands: true, cfo: true });

  const st = buildStaffSection(m);
  checkTrue('staff hero "—", no card, no KPIs', st.hero.value === "—" && st.hero.card === null && st.kpis.length === 0);
  checkTrue("staff: every composition card null",
    st.byDivision === null && st.rolesMix === null && st.employmentTypes === null);

  const rs = buildResourceSection(m, 40);
  checkTrue('resource hero "—", rate null, everything null',
    rs.hero.deployed === "—" && rs.hero.rate === null && rs.weeklyLoad === null && rs.busiest === null && rs.kpis.length === 0);

  const ut = buildUtilizationSection(m);
  checkTrue("utilization avg null with plain explanation",
    ut.hero.avgPct === null && ut.hero.caption.includes("didn't load") && ut.bands === null && ut.divisionBoard === null);

  const be = buildBenchSection(m);
  checkTrue('bench hero "—", matches + lists null',
    be.hero.value === "—" && be.matches === null && be.byRole === null && be.rollOffs === null);

  const op = buildOpenPositionsSection(m);
  checkTrue("open positions stay live (demands still ok)", op.hero.value === "1" && op.hero.card !== null);
  checkTrue("open positions drop the bench-supply note when staffing is down",
    op.weeklySeats !== null && op.weeklySeats.benchNote === null);
}

console.log("\ncheck-analytics-honesty: people section builders (demands down)");
{
  const m = fakeModel({ records: true, staffing: true, demands: true, cfo: true });

  const op = buildOpenPositionsSection(m);
  checkTrue('open-positions hero "—" with no card, all sections null',
    op.hero.value === "—" && op.hero.card === null && op.kpis.length === 0
    && op.byRole === null && op.timing === null && op.weeklySeats === null && op.affectedProjects === null);

  const be = buildBenchSection(m);
  checkTrue("bench stays live but matches null (never guessed)",
    be.hero.value === "2" && be.matches === null);
  checkTrue('bench card "Open positions to fill" stat shows "—"',
    be.hero.card !== null && be.hero.card.stats.some(s => s.label === "Open positions to fill" && s.value === "—"));

  const rs = buildResourceSection(m, 40);
  checkTrue('resource open-positions KPI shows "—" with no card',
    rs.kpis.some(k => k.label === "Open positions" && k.value === "—" && k.card === null));
}

/* ── Usage Analytics builder (#482): telemetry states ── */
console.log("\ncheck-analytics-honesty: usage analytics builder");
{
  const usageTenant = (over: Partial<UsageTenant> = {}): UsageTenant => ({
    tenant: "LiRo",
    enabledUsers: 10, managers: 3, activeUsers: 4,
    logins: 20, pageVisits: 100, humanTx: 15,
    humanEvents: 135, systemEvents: 40,
    weekly: [
      { week: "2026-08-03", activity: 60, wau: 3 },
      { week: "2026-08-10", activity: 75, wau: 4 },
    ],
    features: [{ name: "Projects", visits: 60 }, { name: "Home", visits: 40 }],
    txByType: [{ type: "allocation_update", human: 10, system: 0 }, { type: "data_import", human: 0, system: 40 }],
    loginBands: { every: 1, most: 2, occasional: 1 },
    outcomes: {
      allocEditsPerUserWeek: 1.25,
      allocEditsTotal: 10,
      avgModulesConsistent: 4.5,
      avgModulesOccasional: 2.0,
      consistentUsers: 3,
      occasionalUsers: 1,
      importWeeks: ["2026-08-03"],
      totalWeeks: 2,
    },
    activeUserRows: [{ _person: "u1", user: "Ada Alpha", role: "PM", logins: 8, visits: 50, tx: 6, weeksActive: 2 }],
    activeUserTotal: 4,
    neverActiveRows: [{ _person: "u9", user: "Zed Zero", username: "zed@x.com", role: "Engineer" }],
    neverActiveTotal: 6,
    ...over,
  });
  const payload = (tenants: UsageTenant[]): UsageAnalytics => ({
    available: true, scope: "all", weeks: 2,
    windowStart: "2026-08-03", windowEnd: "2026-08-16",
    weekStarts: ["2026-08-03", "2026-08-10"],
    collectingSince: "2026-08-01T00:00:00.000Z", generatedAt: new Date().toISOString(),
    tenants,
  });

  // failed fetch → error state, no aggregate at all
  const err = buildUsageView(null, ALL_TAB);
  checkTrue("usage: null payload → error state, no numbers", err.state === "error" && err.agg === null);

  // kill switch / restricted → dedicated states, no aggregate
  const off = buildUsageView({ available: false, reason: "Usage tracking is switched off." }, ALL_TAB);
  checkTrue("usage: kill switch → off state, no numbers", off.state === "off" && off.agg === null && !!off.reason);
  const rst = buildUsageView({ available: false, restricted: true, reason: "Admins only." }, ALL_TAB);
  checkTrue("usage: 403 → restricted state", rst.state === "restricted" && rst.agg === null);

  // zero recorded events → collecting: adoption must be "—" (null), NEVER 0%
  const empty = buildUsageView(payload([usageTenant({
    activeUsers: 0, logins: 0, pageVisits: 0, humanTx: 0, humanEvents: 0, systemEvents: 0,
    weekly: [{ week: "2026-08-03", activity: 0, wau: 0 }, { week: "2026-08-10", activity: 0, wau: 0 }],
    features: [], txByType: [], loginBands: { every: 0, most: 0, occasional: 0 },
    activeUserRows: [], activeUserTotal: 0, neverActiveTotal: 10,
  })]), ALL_TAB);
  checkTrue("usage: zero events → collecting state, adoption null not 0%",
    empty.state === "collecting" && empty.agg !== null && empty.agg.adoptionPct === null);
  checkTrue("usage: collecting still shows REAL enabled-user count",
    empty.agg !== null && empty.agg.enabledUsers === 10);

  // ready: adoption math + per-tenant sums
  const two = buildUsageView(payload([usageTenant(), usageTenant({ tenant: "GEI", enabledUsers: 5, activeUsers: 1, humanEvents: 10, systemEvents: 0 })]), ALL_TAB);
  checkTrue("usage: ready state with events", two.state === "ready" && two.agg !== null);
  checkTrue("usage: All-tab adoption = summed active / summed enabled",
    two.agg !== null && two.agg.enabledUsers === 15 && two.agg.activeUsers === 5
    && two.agg.adoptionPct === Math.round((5 / 15) * 1000) / 10);
  checkTrue("usage: tenant tab filters to that tenant only", (() => {
    const gei = buildUsageView(payload([usageTenant(), usageTenant({ tenant: "GEI", enabledUsers: 5, activeUsers: 1 })]), "GEI");
    return gei.agg !== null && gei.agg.enabledUsers === 5 && gei.agg.label === "GEI";
  })());

  // least-used honesty: zero only claimable because the module list is KNOWN
  checkTrue("usage: unvisited KNOWN modules appear as zero in features",
    two.agg !== null && KNOWN_MODULES.every(k => two.agg!.features.some(f => f.name === k))
    && two.agg.features.some(f => f.visits === 0));
  checkTrue("usage: enabledUsers=0 → adoption null (never divide-by-zero 0%)", (() => {
  const z = buildPipelineSection(m0);
    return z.agg !== null && z.agg.adoptionPct === null;
  })());

  // capped lists disclose the TRUE total
  checkTrue("usage: never-active card takeaway discloses cap when rows < total",
    two.agg !== null && two.agg.neverTotal === 12 && two.agg.cards.neverActive.takeaway.includes("first 2 of 12"));

  // human vs system: system volume never leaks into human counts
  checkTrue("usage: system events stay out of human totals",
    two.agg !== null && two.agg.humanEvents === 145 && two.agg.systemEvents === 40
    && two.agg.txByType.find(t => t.type === "data_import")?.human === 0);

  /* ── Phase 2 — Usage → Outcomes honesty assertions ── */
  console.log("\ncheck-analytics-honesty: Phase 2 outcomes (minimum-history gate)");
  {
    // Under OUTCOME_MIN_WEEKS every display value must be "—"
    const shortPayload = payload([usageTenant()]);
    // weeks=2 in the fixture — well under the 4-week minimum
    const shortView = buildUsageView(shortPayload, ALL_TAB);
    const oc = unionView.outcomes;
    checkTrue("Phase 2: zero active users → alloc value null (no NaN/Infinity)",
      oc !== null && oc.allocEditsPerUserWeek.value === null,
      `got: ${oc?.allocEditsPerUserWeek.value}`);
    checkTrue("Phase 2: no users in either band → breadth avgs null",
      oc !== null && oc.featureBreadth.consistentAvg === null && oc.featureBreadth.occasionalAvg === null);
    checkTrue("Phase 2: no imports → importWeeks=0, pct=0",
      oc !== null && oc.importRegularity.importWeeks === 0 && oc.importRegularity.pct === 0);
  }

  console.log("\ncheck-analytics-honesty: Phase 2 outcomes (all-tenant import week union)");
  {
    // Two tenants each imported on a DIFFERENT week — the client must union
    // both, not take the max (which would give 1, not 2).
    const weekStarts = Array.from({ length: OUTCOME_MIN_WEEKS }, (_, i) => {
      const d = new Date("2026-07-20T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i * 7);
      return d.toISOString().slice(0, 10);
    });
    const fullPayload: UsageAnalytics = {
      available: true, scope: "tenant", weeks: OUTCOME_MIN_WEEKS,
      windowStart: weekStarts[0], windowEnd: "2026-08-16",
      weekStarts, collectingSince: "2026-07-20T00:00:00.000Z",
      generatedAt: new Date().toISOString(),
      tenants: [usageTenant({
        outcomes: {
          allocEditsPerUserWeek: 1.25, allocEditsTotal: 20,
          avgModulesConsistent: 4.5, avgModulesOccasional: 2.0,
          consistentUsers: 3, occasionalUsers: 1,
          importWeeks: [weekStarts[0], weekStarts[2]],
          totalWeeks: OUTCOME_MIN_WEEKS,
        },
      })],
    };
    const fullView = buildUsageView(fullPayload, ALL_TAB);
    const oc = unionView.outcomes;
    checkTrue("Phase 2: zero active users → alloc value null (no NaN/Infinity)",
      oc !== null && oc.allocEditsPerUserWeek.value === null,
      `got: ${oc?.allocEditsPerUserWeek.value}`);
    checkTrue("Phase 2: no users in either band → breadth avgs null",
      oc !== null && oc.featureBreadth.consistentAvg === null && oc.featureBreadth.occasionalAvg === null);
    checkTrue("Phase 2: no imports → importWeeks=0, pct=0",
      oc !== null && oc.importRegularity.importWeeks === 0 && oc.importRegularity.pct === 0);
  }

  console.log("\ncheck-analytics-honesty: Phase 2 outcomes (all-tenant import week union)");
  {
    // Two tenants each imported on a DIFFERENT week — the client must union
    // both, not take the max (which would give 1, not 2).
    const weekStarts = Array.from({ length: OUTCOME_MIN_WEEKS }, (_, i) => {
      const d = new Date("2026-07-20T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i * 7);
      return d.toISOString().slice(0, 10);
    });
    const zeroPayload: UsageAnalytics = {
      available: true, scope: "tenant", weeks: OUTCOME_MIN_WEEKS,
      windowStart: weekStarts[0], windowEnd: "2026-08-16",
      weekStarts, collectingSince: "2026-07-20T00:00:00.000Z",
      generatedAt: new Date().toISOString(),
      tenants: [usageTenant({
        activeUsers: 0,
        outcomes: {
          allocEditsPerUserWeek: null, allocEditsTotal: 0,
          avgModulesConsistent: null, avgModulesOccasional: null,
          consistentUsers: 0, occasionalUsers: 0,
          importWeeks: [], totalWeeks: OUTCOME_MIN_WEEKS,
        },
      })],
    };
    const zeroView = buildUsageView(zeroPayload, ALL_TAB);
    const oc = unionView.outcomes;
    checkTrue("Phase 2: zero active users → alloc value null (no NaN/Infinity)",
      oc !== null && oc.allocEditsPerUserWeek.value === null,
      `got: ${oc?.allocEditsPerUserWeek.value}`);
    checkTrue("Phase 2: no users in either band → breadth avgs null",
      oc !== null && oc.featureBreadth.consistentAvg === null && oc.featureBreadth.occasionalAvg === null);
    checkTrue("Phase 2: no imports → importWeeks=0, pct=0",
      oc !== null && oc.importRegularity.importWeeks === 0 && oc.importRegularity.pct === 0);
  }

  console.log("\ncheck-analytics-honesty: Phase 2 outcomes (all-tenant import week union)");
  {
    // Two tenants each imported on a DIFFERENT week — the client must union
    // both, not take the max (which would give 1, not 2).
    const weekStarts = Array.from({ length: OUTCOME_MIN_WEEKS }, (_, i) => {
      const d = new Date("2026-07-20T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i * 7);
      return d.toISOString().slice(0, 10);
    });
    const unionPayload: UsageAnalytics = {
      available: true, scope: "all", weeks: OUTCOME_MIN_WEEKS,
      windowStart: weekStarts[0], windowEnd: "2026-08-16",
      weekStarts, collectingSince: "2026-07-20T00:00:00.000Z",
      generatedAt: new Date().toISOString(),
      tenants: [
        usageTenant({
          tenant: "LiRo",
          outcomes: {
            allocEditsPerUserWeek: 1.0, allocEditsTotal: 8,
            avgModulesConsistent: 4.0, avgModulesOccasional: 2.0,
            consistentUsers: 2, occasionalUsers: 1,
            importWeeks: [weekStarts[0]],       // imported week 0 only
            totalWeeks: OUTCOME_MIN_WEEKS,
          },
        }),
        usageTenant({
          tenant: "GEI",
          outcomes: {
            allocEditsPerUserWeek: 1.0, allocEditsTotal: 8,
            avgModulesConsistent: 4.0, avgModulesOccasional: 2.0,
            consistentUsers: 2, occasionalUsers: 1,
            importWeeks: [weekStarts[1]],       // imported week 1 only
            totalWeeks: OUTCOME_MIN_WEEKS,
          },
        }),
      ],
    };
    const unionView = buildUsageView(unionPayload, ALL_TAB);
    const oc = unionView.outcomes;
    checkTrue("Phase 2: all-tenant import weeks = union of both tenants (2, not max=1)",
      oc !== null && oc.importRegularity.importWeeks === 2,
      `got: ${oc?.importRegularity.importWeeks}`);
  }

  console.log("\ncheck-analytics-honesty: Phase 2 outcomes absent on legacy payloads");
  {
    // A payload without the outcomes field on the tenant (legacy / rollout compat)
    const legacyTenant = {
      tenant: "LiRo",
      enabledUsers: 10, managers: 3, activeUsers: 4,
      logins: 20, pageVisits: 100, humanTx: 15,
      humanEvents: 135, systemEvents: 40,
      weekly: [{ week: "2026-08-03", activity: 60, wau: 3 }],
      features: [], txByType: [],
      loginBands: { every: 1, most: 2, occasional: 1 },
      activeUserRows: [], activeUserTotal: 4,
      neverActiveRows: [], neverActiveTotal: 6,
      // no outcomes field — simulates a server before this deploy
    } as UsageTenant;
    const legacyPayload: UsageAnalytics = {
      available: true, scope: "tenant", weeks: 1,
      windowStart: "2026-08-10", windowEnd: "2026-08-16",
      weekStarts: ["2026-08-10"], collectingSince: null, generatedAt: new Date().toISOString(),
      tenants: [legacyTenant],
    };
  let threw = false;
    try { buildUsageView(legacyPayload, ALL_TAB); } catch { threw = true; }
    checkTrue("Phase 2: buildUsageView does not throw on legacy tenant without outcomes", !threw);
  }

  console.log("\ncheck-analytics-honesty: selectByOrgDim — no cross-dimension fallback");
  {
    /* The Bench / Financial org cards resolve their list through
     * selectByOrgDim. A missing selected dimension must yield null (page
     * renders an honest note) — NEVER another dimension's list, whose bars
     * would drill with the selected dimension's filter key and open
     * empty/wrong drills. */
    const division = { tag: "div-list" };
    const businessUnit = { tag: "bu-list" };
    checkTrue("selected dimension present → its own list",
      selectByOrgDim("division", { division, businessUnit, department: null })?.tag === "div-list"
      && selectByOrgDim("businessUnit", { division, businessUnit, department: null })?.tag === "bu-list");
    checkTrue("selected dimension missing → null, even when other dimensions have data",
      selectByOrgDim("department", { division, businessUnit, department: null }) === null
      && selectByOrgDim("businessUnit", { division, businessUnit: null, department: null }) === null);
  }

  console.log("\ncheck-analytics-honesty: bench by-org — per-dimension presence");
  {
    /* Bench roster has divisions but no BU/department extras (base fixture):
     * the section must expose ONLY byDivision — byBusinessUnit/byDepartment
     * stay null so the page's honest-absence note shows for those dims. */
    const bm = fakeModel({ records: true, staffing: true, demands: true, cfo: true });
    const bench = buildBenchSection(bm);
    checkTrue("bench: division grouping present from roster divisions",
      bench.byDivision !== null);
    checkTrue("bench: no BU/department on roster → byBusinessUnit/byDepartment null (not division relabeled)",
      bench.byBusinessUnit === null && bench.byDepartment === null);
  }

  console.log("\ncheck-analytics-honesty: utilization/staff/executive org cards — per-dimension presence");
  {
  const m0 = fakeModel({ records: true, staffing: true, demands: true, cfo: true });
    const ut0 = buildUtilizationSection(m0);
    checkTrue("utilization: division board present, BU/Dept boards null on div-only roster",
      ut0.divisionBoard !== null && ut0.divisionBoardBU === null && ut0.divisionBoardDept === null);
    const ex0 = buildExecutiveSection(m0);
    checkTrue("executive scorecard: div tier only on div-only data (no bu/dep tiers)",
      ex0.divisionScore !== null
      && ex0.divisionScore.tabs.some(t => t.key === "div")
      && !ex0.divisionScore.tabs.some(t => t.key === "bu")
      && !ex0.divisionScore.tabs.some(t => t.key === "dep"));

    /* Selected dimension absent while ANOTHER has data: add BU to the roster
     * only — BU board appears, Dept board must STAY null. */
    const m1 = fakeModel({ records: true, staffing: true, demands: true, cfo: true });
    const staff1 = (m1 as unknown as { staff: Record<string, unknown>[] }).staff;
    staff1[0].businessUnit = "East";
    staff1[1].businessUnit = "East";
    staff1[2].businessUnit = "West";
    const ut1 = buildUtilizationSection(m1);
    checkTrue("utilization: BU board appears with BU data; Dept stays null (no borrowing)",
      ut1.divisionBoardBU !== null && ut1.divisionBoardDept === null);
    checkTrue("utilization BU board rows are BU labels, not divisions",
      ut1.divisionBoardBU !== null
      && ut1.divisionBoardBU.rows.every(r => ["East", "West"].includes(r.label)));

    /* Departments on staff AND projects: the Executive dept tier must appear
     * and now carry backlog + open seats from the canonical project
     * department field (previously dept had no project data at all). */
    const m2 = fakeModel({ records: true, staffing: true, demands: true, cfo: true });
    const staff2 = (m2 as unknown as { staff: Record<string, unknown>[] }).staff;
    staff2[0].department = "Structures";
    staff2[1].department = "Structures";
    staff2[2].department = "Survey";
    const projects2 = (m2 as unknown as { projects: Record<string, unknown>[] }).projects;
    projects2[0].department = "Structures";  // PMM-01 carries the open demand
    projects2[1].department = "Survey";
    (m2 as unknown as Record<string, unknown>).backlogByDepartment = [
      { label: "Structures", value: 5_000_000, count: 1 },
      { label: "Survey", value: 3_000_000, count: 1 },
    ];
    const ex2 = buildExecutiveSection(m2);
    const depTab = ex2.divisionScore?.tabs.find(t => t.key === "dep") ?? null;
    checkTrue("executive scorecard: dept tier present when depts exist", depTab !== null);
    checkTrue("executive dept tier carries REAL backlog from project departments",
      depTab !== null && (depTab.rows.find(r => r.label === "Structures")?.backlogValue ?? 0) === 5_000_000,
      `got ${String(depTab?.rows.find(r => r.label === "Structures")?.backlogValue)}`);
    checkTrue("executive dept tier counts open seats via project departments",
      depTab !== null && (depTab.rows.find(r => r.label === "Structures")?.openSeatsCount ?? 0) === 1,
      `got ${String(depTab?.rows.find(r => r.label === "Structures")?.openSeatsCount)}`);
  }

  console.log("\ncheck-analytics-honesty: usage adoption-by-org (dimension honesty)");
  {
    /* Roster where Division and Business Unit share a NAME ("Civil") but are
     * DIFFERENT canonical fields with different memberships. Grouping by one
     * dimension must read ONLY that field — never merge or relabel. */
    const staff = [
      { name: "Ada Alpha",  division: "Civil",  businessUnit: "Civil",   department: null },
      { name: "Ben Beta",   division: "Civil",  businessUnit: "Transit", department: null },
      { name: "Cy Gamma",   division: "Rail",   businessUnit: "Transit", department: null },
      { name: "Dee Delta",  division: null,     businessUnit: "Civil",   department: null },
    ];
    const active = new Set(["ada alpha", "ben beta", "dee delta"]);

    const byDiv = usageAdoptionByOrg(staff, active, "division");
    checkTrue("division grouping reads ONLY the division field (Civil=2, Rail=1, Unassigned=1)",
      byDiv !== null && byDiv.rows.length === 3
      && byDiv.rows.find(r => r.group === "Civil")?.total === 2
      && byDiv.rows.find(r => r.group === "Rail")?.total === 1
      && byDiv.rows.find(r => r.group === "Unassigned")?.total === 1);

    const byBU = usageAdoptionByOrg(staff, active, "businessUnit");
    checkTrue("same-named BU 'Civil' is its own group (2 people), never merged with Division Civil",
      byBU !== null && byBU.rows.length === 2
      && byBU.rows.find(r => r.group === "Civil")?.total === 2
      && byBU.rows.find(r => r.group === "Transit")?.total === 2);
    checkTrue("never-active attribution follows the person, per dimension (Transit has the inactive)",
      byBU !== null && byBU.rows.find(r => r.group === "Transit")?.never === 1
      && byBU.rows.find(r => r.group === "Civil")?.never === 0);

    checkTrue("no department data → null (honest absence, NO fallback to another dimension)",
      usageAdoptionByOrg(staff, active, "department") === null);
    checkTrue("single-group dimension → null (nothing meaningful to compare)",
      usageAdoptionByOrg(
        [{ name: "A", division: "Only" }, { name: "B", division: "Only" }], new Set(), "division") === null);

    // Export/drill card: first column is labeled with the SELECTED dimension.
    checkTrue("drill/export card columns follow the dimension (BU column labeled 'Business Unit')",
      byBU !== null && byBU.card.columns[0].label === "Business Unit"
      && byBU.card.title === "Adoption by Business Unit");
    checkTrue("drill/export card rows mirror the grouping (row per BU with staff counts)",
      byBU !== null && byBU.card.rows.length === 2
      && byBU.card.rows.some(r => r.group === "Transit" && r.total === 2 && r.adoptionPct === "50%"));
    checkTrue("adoption % math: 1 never-active of 2 → 50%",
      byBU !== null && byBU.rows.find(r => r.group === "Transit")?.adoptionPct === 50);
  }

  // hub tile: failure/off/collecting degrade to "—", never zeros
  const tile: HubTile = { id: "usage", title: "Usage Analytics", hero: "—", takeaway: "", sub: "", viz: { kind: "note", text: "" }, card: null };
  checkTrue('usage tile: failed fetch → "—" + plain note', (() => {
    const t = usageHubTile(tile, payload([usageTenant()]));
    return t.hero === "—" && t.sub.startsWith("Collecting since");
  })());
  checkTrue("usage tile: real events → real adoption gauge", (() => {
    const t = usageHubTile(tile, payload([usageTenant()]));
    return t.hero === "—" && t.sub.startsWith("Collecting since");
  })());
  checkTrue("usage tile: real events → real adoption gauge", (() => {
    const t = usageHubTile(tile, payload([usageTenant()]));
    return t.hero === "40%" && t.viz.kind === "gauge";
  })());
}

/* ── Pipeline section builder ── */
console.log("\ncheck-analytics-honesty: pipeline section builder (live)");
{
  const liveModel = fakeModel({ records: true, staffing: true, demands: true, cfo: true });
  liveModel.opmByStage = [{ label: "Proposal", value: 2_000_000, count: 1 }];
  (liveModel.opps[0] as unknown as Record<string, unknown>).stage = " Proposal ";
  const ok = buildPipelineSection(liveModel);
  checkTrue("pipeline: recordsOk true with real hero value", ok.recordsOk && ok.hero.value.startsWith("$"));
  checkTrue("pipeline: hero card present (drill to pursuits)", ok.hero.card !== null);
  checkTrue("pipeline: win-rate pct = 60 (from model) with decided card",
    ok.winRate.pct === 60 && ok.winRate.card !== null);
  checkTrue("pipeline: 4 KPIs all present", ok.kpis.length === 4);
  checkTrue("pipeline: avg-bid-size KPI shows money (3 bids, non-zero)",
    ok.kpis.some(k => k.label === "Avg bid size" && k.value.startsWith("$")));
  checkTrue("pipeline: early-stage leads KPI always carries a drill card (zero rows ok)",
    ok.kpis.some(k => k.label === "Early-stage leads" && k.card !== null));
  checkTrue("pipeline stage totals drill to individual pursuits",
    ok.byStage !== null
    && filterCardByField(ok.byStage.card, "stage", "Proposal").rows.length === 1
    && ok.byStage.card.rows[0]?._ticket === "OPM-01");
}

console.log("\ncheck-analytics-honesty: pipeline section builder (records down)");
{
  const down = buildPipelineSection(fakeModel({ records: false, staffing: true, demands: true, cfo: true }));
  checkTrue('pipeline: records down → hero "—" with no card',
    down.hero.value === "—" && down.hero.card === null);
  checkTrue("pipeline: records down → winRate.pct null", down.winRate.pct === null);
  checkTrue("pipeline: records down → kpis empty", down.kpis.length === 0);
  checkTrue("pipeline: records down → all list blocks null",
    down.byStage === null && down.winLoss === null && down.topPursuits === null && down.leads === null);
}

console.log("\ncheck-analytics-honesty: pipeline section builder (zero active bids)");
{
  const m0 = fakeModel({ records: true, staffing: true, demands: true, cfo: true });
  (m0 as unknown as Record<string, unknown>).activeBids = 0;
  (m0 as unknown as Record<string, unknown>).pipelineValue = 0;
  (m0 as unknown as Record<string, unknown>).opps = [];
  const z = buildPipelineSection(m0);
  checkTrue('pipeline: zero active bids → avg-bid-size KPI shows "—" (no divide-by-zero)',
    z.kpis.some(k => k.label === "Avg bid size" && k.value === "—"));
  checkTrue("pipeline: zero active bids → topPursuits null (nothing to show)",
    z.topPursuits === null);
}

console.log("\ncheck-analytics-honesty: pipeline section builder (zero leads)");
{
  // fakeModel already has leads: [] — verify leads KPI still drills
  const m = fakeModel({ records: true, staffing: true, demands: true, cfo: true });
  const s = buildPipelineSection(m);
  checkTrue("pipeline: zero leads → leads list block null (empty list not rendered)",
    s.leads === null);
  checkTrue("pipeline: zero leads → early-stage-leads KPI still carries its drill card",
    s.kpis.some(k => k.label === "Early-stage leads" && k.card !== null && k.card.rows.length === 0));
}

console.log("\ncheck-analytics-honesty: pipeline section builder (legacy model, no sources)");
{
  let threw = false;
  let legacy: ReturnType<typeof buildPipelineSection> | null = null;
  try { legacy = buildPipelineSection(fakeModel(undefined)); } catch { threw = true; }
  checkTrue("pipeline: legacy model without sources → no throw", !threw);
  checkTrue("pipeline: legacy model treated as ok (real hero value, not degraded)",
    legacy !== null && legacy.hero.value !== "—");
}

/* ── Explanation contract: totals + default explanation honesty ──
 * Contract under test:
 *   • pct columns are NEVER summed (a summed percentage is a fabricated number)
 *   • computeTotalRow sums only int/money columns and honors explicit
 *     authoritative overrides from explanation.totals
 *   • defaultExplanation never fabricates precision — legacy cards get honest
 *     "current snapshot" wording and zero-row cards say no records available
 *   • every hub drill card carries explanation metadata (drawer "What this
 *     means" is never blank for live cards) */
console.log("\ncheck-analytics-honesty: explanation contract (totals + defaults)");
{
  const cols: CardColumn[] = [
    { key: "name", label: "Name" },
    { key: "hours", label: "Hours", kind: "int" },
    { key: "bill", label: "Billing", kind: "money" },
    { key: "util", label: "Utilization", kind: "pct" },
  ];
  checkTrue("pct columns are not summable (summed % would be fabricated)",
    !isSafelysummable(cols[3]) && !isSafelysummable(cols[0]));
  checkTrue("int + money columns are summable",
    isSafelysummable(cols[1]) && isSafelysummable(cols[2]));

  const rows = [
    { name: "A", hours: 10, bill: 1000, util: 50 },
    { name: "B", hours: 5, bill: 250, util: 80 },
    { name: "C", hours: null, bill: "", util: 10 }, // blanks must not poison sums
  ];
  const total = computeTotalRow(rows, cols);
  checkTrue("total row sums int/money and skips blanks",
    total !== null && total.hours === 15 && total.bill === 1250,
    `got ${JSON.stringify(total)}`);
  checkTrue("total row never invents a pct total",
    total !== null && !("util" in total));

  const overridden = computeTotalRow(rows, cols, { bill: 999_999 });
  checkTrue("explicit authoritative totals override the naive sum",
    overridden !== null && overridden.bill === 999_999 && overridden.hours === 15);

  checkTrue("no summable columns → no total row (never a fake all-text total)",
    computeTotalRow(rows, [cols[0], cols[3]]) === null);

  const legacyCard: CardModel = {
    id: "executive", title: "Legacy Card", takeaway: "Some takeaway.",
    stats: [], columns: cols, rows,
  };
  const exp = defaultExplanation(legacyCard);
  checkTrue("legacy card default explanation reuses the real takeaway",
    exp.meaning === "Some takeaway." && exp.calculation.includes("3"));
  const emptyExp = defaultExplanation({ ...legacyCard, rows: [] });
  checkTrue('zero-row legacy card says "No rows behind this number.", never implies completeness',
    String(emptyExp.completeness) === "No rows behind this number.");

  // The fallback must be STRICTLY neutral — a legacy card's rows may be
  // synthetic aggregates or capped lists, and its headline may not be a
  // count/sum of them. So the fallback may never assert provenance, a data
  // source, a derivation, a measure kind, or completeness.
  for (const [label, e] of [["non-empty", exp], ["empty", emptyExp]] as const) {
    const all = `${e.meaning} ${e.calculation} ${e.period} ${e.source ?? ""} ${String(e.completeness ?? "")}`;
    checkTrue(`${label} fallback never claims rows are live source records`,
      !/each row is one record|live data source|source record/i.test(all));
    checkTrue(`${label} fallback never claims the headline is computed from the rows`,
      !/computed from|counts \(or sums\)/i.test(all));
    checkTrue(`${label} fallback never asserts completeness`,
      !/all records loaded|complete list|nothing (is )?omitted/i.test(all));
    checkTrue(`${label} fallback never names an authoritative data source`,
      !/operational database|operational data\b/i.test(all));
    checkTrue(`${label} fallback omits measure (asserting "actual" is itself a claim)`,
      e.measure === undefined);
    checkTrue(`${label} fallback defers to the card's own description`,
      /card's own description|see its description/i.test(all));
  }

  const h = buildHubData(fakeModel({ records: true, staffing: true, demands: true, cfo: true }));
  const liveCards = h.tiles.map(t => t.card).filter((c): c is CardModel => c !== null);
  checkTrue("every live hub drill card carries explanation metadata",
    liveCards.length > 0 && liveCards.every(c => !!c.explanation
      && c.explanation.meaning.length > 0 && c.explanation.calculation.length > 0),
    `cards missing explanation: ${liveCards.filter(c => !c.explanation).map(c => c.title).join(", ")}`);
}

if (failures) {
  console.error(`\ncheck-analytics-honesty: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-analytics-honesty: all assertions passed");
