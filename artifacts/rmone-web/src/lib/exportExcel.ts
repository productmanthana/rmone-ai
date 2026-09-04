/* ─────────────────────────────────────────────────────────────
 * exportExcel.ts — executive report Excel engine (exceljs,
 * dynamically imported). Multi-sheet workbooks with styled
 * headers, currency number formats, freeze panes and column
 * widths. All data comes from the shared ReportModel.
 * ──────────────────────────────────────────────────────────── */
import type { ReportModel } from "@/lib/reportData";
import type { ReportKey } from "@/lib/exportPdf";
import { REPORT_TITLES } from "@/lib/exportPdf";

const GREEN = "FF6BA539";
const DARK = "FF1E2933";
const WHITE = "FFFFFFFF";
const SOFT = "FFF4F7F2";
const MONEY = '"$"#,##0';

type WB = any;   // ExcelJS.Workbook
type WS = any;   // ExcelJS.Worksheet

function styleHeaderRow(ws: WS, rowIdx = 1) {
  const row = ws.getRow(rowIdx);
  row.height = 20;
  row.eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    cell.alignment = { vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: DARK } } };
  });
}

function addSheet(wb: WB, name: string, columns: { header: string; key: string; width: number; money?: boolean; pct?: boolean }[], rows: Record<string, unknown>[]): WS {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map(c => ({
    header: c.header, key: c.key, width: c.width,
    style: c.money ? { numFmt: MONEY } : c.pct ? { numFmt: '0"%"' } : undefined,
  }));
  for (const r of rows) ws.addRow(r);
  styleHeaderRow(ws);
  /* subtle zebra striping */
  for (let i = 2; i <= rows.length + 1; i++) {
    if (i % 2 === 0) {
      ws.getRow(i).eachCell({ includeEmpty: false }, (cell: any) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
      });
    }
  }
  return ws;
}

/* ── summary sheet (KPIs + key breakdowns) ── */
function addSummarySheet(wb: WB, m: ReportModel) {
  const ws = wb.addWorksheet("Summary");
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 20;
  ws.getColumn(3).width = 30;

  ws.mergeCells("A1:C1");
  const title = ws.getCell("A1");
  title.value = "RM ONE — Executive Report";
  title.font = { bold: true, size: 15, color: { argb: DARK } };
  ws.getRow(1).height = 26;

  ws.mergeCells("A2:C2");
  const sub = ws.getCell("A2");
  sub.value = `Generated ${new Date(m.generatedAt).toLocaleString("en-US")} · Live operational data`;
  sub.font = { size: 9, color: { argb: "FF6B7E8A" } };

  let r = 4;
  const section = (label: string) => {
    const cell = ws.getCell(r, 1);
    cell.value = label.toUpperCase();
    cell.font = { bold: true, size: 10, color: { argb: GREEN } };
    r += 1;
  };
  const kpi = (label: string, value: number | string | null, opts?: { money?: boolean; pct?: boolean; note?: string }) => {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).font = { size: 10, color: { argb: DARK } };
    const vc = ws.getCell(r, 2);
    vc.value = value ?? "—";
    vc.font = { bold: true, size: 10, color: { argb: DARK } };
    if (opts?.money) vc.numFmt = MONEY;
    if (opts?.pct) vc.numFmt = '0"%"';
    if (opts?.note) {
      ws.getCell(r, 3).value = opts.note;
      ws.getCell(r, 3).font = { size: 9, color: { argb: "FF6B7E8A" } };
    }
    r += 1;
  };

  section("Portfolio");
  kpi("Contracted Backlog", m.backlogValue, { money: true, note: `${m.activeProjects} active projects` });
  kpi("Average Project Size", Math.round(m.avgProjectValue), { money: true });
  kpi("On-Time Delivery Rate", m.onTimeRate, { pct: true, note: `${m.overdueCount} overdue · ${m.noDateCount} missing end dates` });
  r += 1;

  section("Pipeline");
  kpi("Open Pipeline Value", m.pipelineValue, { money: true, note: `${m.activeBids} active bids` });
  kpi("Weighted Pipeline", Math.round(m.weightedPipeline), { money: true, note: "probability-adjusted" });
  kpi("Win Rate (decided bids)", m.winRate, { pct: true, note: `${m.wonCount} won · ${m.lostCount} lost` });
  kpi("Won Value", m.wonValue, { money: true });
  kpi("Early-Stage Leads", m.leadCount, { note: `estimated ${Math.round(m.leadValue).toLocaleString("en-US")}` });
  r += 1;

  section("Conversions");
  kpi("Leads → Opportunities", m.conversion.leadsConverted, {
    note: m.conversion.leadConversionRate != null
      ? `${m.conversion.leadConversionRate}% of ${m.conversion.leadsTotal} leads on record`
      : "no leads on record yet",
  });
  kpi("Converted Lead Value", m.conversion.leadsConvertedValue, { money: true, note: "estimated value carried forward" });
  kpi("Opportunities → Projects", m.conversion.oppsConverted, {
    note: m.conversion.oppConversionRate != null
      ? `${m.conversion.oppConversionRate}% of ${m.conversion.oppsTotal} opportunities on record`
      : "no opportunities on record yet",
  });
  kpi("Converted Opportunity Value", m.conversion.oppsConvertedValue, { money: true, note: "contract value moved to delivery" });
  r += 1;

  section("Workforce");
  kpi("Total Staff", m.totalStaff);
  kpi("Deployed Rate", m.deployedRate, { pct: true, note: `${m.benchCount} available · ${m.overAllocCount} over-allocated` });
  kpi("Unfilled Positions", m.openDemands);
  r += 1;

  section("Financial Signals");
  kpi("Labor Forecast (committed)", m.totalForecastCost, { money: true });
  kpi("Margin-Risk Projects", m.marginRiskCount, { note: "overdue with contract value at stake" });
  if (m.cfo) {
    kpi("Pipeline Coverage Score", Math.round(m.cfo.pipelineCoverage), { pct: true });
    kpi("Labor Margin Score", Math.round(m.cfo.laborMargin), { pct: true });
    kpi("Hours-on-Plan Score", Math.round(m.cfo.hoursOnPlan), { pct: true });
  }
  r += 1;

  section("Concentration (Top Clients)");
  for (const c of m.clientConcentration.slice(0, 5)) {
    kpi(c.label, c.value, { money: true, note: `${c.share}% of backlog` });
  }
}

/* ── data sheets ── */
function addProjectsSheet(wb: WB, m: ReportModel) {
  addSheet(wb, "Projects", [
    { header: "Project ID", key: "id", width: 16 },
    { header: "Project", key: "name", width: 40 },
    { header: "Client", key: "client", width: 26 },
    { header: "Sector", key: "sector", width: 18 },
    { header: "Division", key: "division", width: 20 },
    { header: "City", key: "city", width: 16 },
    { header: "Status", key: "status", width: 14 },
    { header: "Contract Value", key: "value", width: 16, money: true },
    { header: "Labor Contract", key: "laborContract", width: 16, money: true },
    { header: "Forecast Cost", key: "forecastCost", width: 16, money: true },
    { header: "Target Start", key: "targetStart", width: 13 },
    { header: "Target End", key: "targetEnd", width: 13 },
    { header: "Schedule", key: "schedule", width: 14 },
  ], m.projects.map(p => ({
    ...p,
    client: p.client ?? "",
    division: p.division ?? "",
    city: p.city ?? "",
    targetStart: p.targetStart ? p.targetStart.slice(0, 10) : "",
    targetEnd: p.targetEnd ? p.targetEnd.slice(0, 10) : "",
    schedule: p.overdue ? `Overdue ${p.daysOverdue ?? ""}d` : p.noDate ? "No end date" : "On schedule",
  })));
}

function addOppsSheet(wb: WB, m: ReportModel) {
  addSheet(wb, "Opportunities", [
    { header: "Bid ID", key: "id", width: 16 },
    { header: "Opportunity", key: "name", width: 40 },
    { header: "Client", key: "client", width: 26 },
    { header: "Sector", key: "sector", width: 18 },
    { header: "Stage", key: "stage", width: 18 },
    { header: "Value", key: "value", width: 16, money: true },
    { header: "Probability %", key: "probability", width: 13, pct: true },
    { header: "Weighted Value", key: "weighted", width: 16, money: true },
    { header: "Bid Due Date", key: "bidDate", width: 13 },
    { header: "Days to Bid", key: "daysToBid", width: 11 },
  ], [...m.opps, ...m.decidedOpps].map(o => ({
    ...o,
    client: o.client ?? "",
    probability: o.probability ?? "",
    weighted: Math.round(o.weighted),
    bidDate: o.bidDate ? o.bidDate.slice(0, 10) : "",
    daysToBid: o.daysToBid ?? "",
  })));
}

function addLeadsSheet(wb: WB, m: ReportModel) {
  addSheet(wb, "Leads", [
    { header: "Lead ID", key: "id", width: 16 },
    { header: "Lead", key: "name", width: 40 },
    { header: "Client", key: "client", width: 26 },
    { header: "Sector", key: "sector", width: 18 },
    { header: "Status", key: "status", width: 16 },
    { header: "Est. Value", key: "value", width: 16, money: true },
    { header: "City", key: "city", width: 16 },
  ], m.leads.map(l => ({ ...l, client: l.client ?? "", city: l.city ?? "" })));
}

function addWorkforceSheet(wb: WB, m: ReportModel) {
  addSheet(wb, "Workforce", [
    { header: "Name", key: "name", width: 28 },
    { header: "Role", key: "role", width: 24 },
    { header: "Division", key: "division", width: 22 },
    { header: "Utilization %", key: "utilization", width: 13, pct: true },
    { header: "Active Projects", key: "activeProjects", width: 14 },
    { header: "Status", key: "band", width: 13 },
  ], m.staff.map(s => ({ ...s, role: s.role ?? "", division: s.division ?? "" })));
}

function addDemandSheet(wb: WB, m: ReportModel) {
  addSheet(wb, "Open Demand", [
    { header: "Project ID", key: "ticket", width: 16 },
    { header: "Project", key: "project", width: 40 },
    { header: "Role Needed", key: "role", width: 24 },
    { header: "Allocation %", key: "pct", width: 13, pct: true },
    { header: "Start", key: "start", width: 13 },
    { header: "End", key: "end", width: 13 },
    { header: "Soft Hold", key: "soft", width: 10 },
  ], m.demands.map(d => ({
    ...d,
    start: d.start ? d.start.slice(0, 10) : "",
    end: d.end ? d.end.slice(0, 10) : "",
    soft: d.soft ? "Yes" : "No",
  })));
}

function addConvertedLeadsSheet(wb: WB, m: ReportModel) {
  addSheet(wb, "Converted Leads", [
    { header: "Lead ID", key: "id", width: 16 },
    { header: "Lead", key: "name", width: 40 },
    { header: "Client", key: "client", width: 26 },
    { header: "Sector", key: "sector", width: 18 },
    { header: "Status", key: "status", width: 16 },
    { header: "Est. Value", key: "value", width: 16, money: true },
    { header: "City", key: "city", width: 16 },
  ], m.conversion.convertedLeads.map(l => ({ ...l, client: l.client ?? "", city: l.city ?? "" })));
}

function addConvertedOppsSheet(wb: WB, m: ReportModel) {
  addSheet(wb, "Converted Opportunities", [
    { header: "Bid ID", key: "id", width: 16 },
    { header: "Opportunity", key: "name", width: 40 },
    { header: "Client", key: "client", width: 26 },
    { header: "Sector", key: "sector", width: 18 },
    { header: "Stage", key: "stage", width: 18 },
    { header: "Contract Value", key: "value", width: 16, money: true },
  ], m.conversion.convertedOpps.map(o => ({ ...o, client: o.client ?? "" })));
}

function addBreakdownSheet(wb: WB, m: ReportModel) {
  const ws = wb.addWorksheet("Breakdowns");
  let r = 1;
  const block = (title: string, head: string[], rows: (string | number)[][], moneyCols: number[] = []) => {
    const t = ws.getCell(r, 1);
    t.value = title.toUpperCase();
    t.font = { bold: true, size: 10, color: { argb: GREEN } };
    r += 1;
    head.forEach((h, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = h;
      c.font = { bold: true, size: 9, color: { argb: WHITE } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    });
    r += 1;
    for (const row of rows) {
      row.forEach((v, i) => {
        const c = ws.getCell(r, i + 1);
        c.value = v;
        c.font = { size: 9.5 };
        if (moneyCols.includes(i)) c.numFmt = MONEY;
      });
      r += 1;
    }
    r += 2;
  };
  ws.getColumn(1).width = 32;
  for (let i = 2; i <= 6; i++) ws.getColumn(i).width = 16;

  block("Backlog by Sector", ["Sector", "Value", "Projects"],
    m.backlogBySector.map(s => [s.label, s.value, s.count]), [1]);
  block("Backlog by Division", ["Division", "Value", "Projects"],
    m.backlogByDivision.map(d => [d.label, d.value, d.count]), [1]);
  block("Client Concentration", ["Client", "Value", "Projects", "Share of Backlog %"],
    m.clientConcentration.map(c => [c.label, c.value, c.count, c.share]), [1]);
  block("Geographic Exposure", ["City", "Value", "Projects"],
    m.cityExposure.map(c => [c.label, c.value, c.count]), [1]);
  block("Active Bids by Stage", ["Stage", "Value", "Bids"],
    m.opmByStage.map(s => [s.label, s.value, s.count]), [1]);
  block("Win / Loss by Sector", ["Sector", "Won", "Lost", "Won Value", "Lost Value"],
    m.winLossBySector.map(s => [s.sector, s.won, s.lost, s.wonValue, s.lostValue]), [3, 4]);
  block("Project Size Distribution", ["Value Band", "Projects"],
    m.valueRanges.map(v => [v.label, v.count]));
  block("Workforce Utilization Bands", ["Band", "Staff"],
    m.utilizationBands.map(u => [u.label, u.count]));
}

/* ── per-report sheet composition ── */
const SHEETS: Record<ReportKey, ((wb: WB, m: ReportModel) => void)[]> = {
  executive: [addSummarySheet, addBreakdownSheet, addProjectsSheet],
  pipeline: [addSummarySheet, addOppsSheet, addLeadsSheet, addBreakdownSheet],
  portfolio: [addSummarySheet, addProjectsSheet, addBreakdownSheet],
  workforce: [addSummarySheet, addWorkforceSheet, addDemandSheet],
  financial: [addSummarySheet, addProjectsSheet, addBreakdownSheet],
  conversion: [addSummarySheet, addConvertedLeadsSheet, addConvertedOppsSheet],
};

async function downloadWorkbook(wb: WB, filename: string) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

async function newWorkbook(): Promise<WB> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "RM ONE";
  wb.created = new Date();
  return wb;
}

export async function exportReportExcel(m: ReportModel, key: ReportKey): Promise<void> {
  const wb = await newWorkbook();
  for (const add of SHEETS[key]) add(wb, m);
  await downloadWorkbook(wb, `RMONE-${key}-report-${stamp()}.xlsx`);
}

export async function exportAllExcel(m: ReportModel): Promise<void> {
  const wb = await newWorkbook();
  addSummarySheet(wb, m);
  addBreakdownSheet(wb, m);
  addProjectsSheet(wb, m);
  addOppsSheet(wb, m);
  addLeadsSheet(wb, m);
  addWorkforceSheet(wb, m);
  addDemandSheet(wb, m);
  addConvertedLeadsSheet(wb, m);
  addConvertedOppsSheet(wb, m);
  await downloadWorkbook(wb, `RMONE-executive-workbook-${stamp()}.xlsx`);
}

export { REPORT_TITLES };
