/* ─────────────────────────────────────────────────────────────
 * exportPdf.ts — executive report PDF engine.
 * Charts are drawn NATIVELY in jsPDF (rects / line-segment donut
 * wedges) on a fixed light palette — never serialized from the
 * on-screen recharts SVG (CSS vars don't resolve there).
 * jspdf + jspdf-autotable are imported dynamically so the
 * dashboards never pay the bundle cost.
 * ──────────────────────────────────────────────────────────── */
import type { ReportModel } from "@/lib/reportData";
import { fmtMoney, fmtMoneyFull, fmtDateShort } from "@/lib/reportData";

export type ReportKey = "executive" | "pipeline" | "portfolio" | "workforce" | "financial" | "conversion";

export const REPORT_TITLES: Record<ReportKey, string> = {
  executive: "Executive Portfolio Summary",
  pipeline: "Pipeline & Win/Loss Report",
  portfolio: "Project Portfolio Report",
  workforce: "Workforce Utilization & Demand",
  financial: "Financial Health Report",
  conversion: "Conversion Tracking Report",
};

/* fixed light export palette (RGB tuples) */
const DARK: [number, number, number] = [30, 41, 51];
const MUTED: [number, number, number] = [107, 126, 138];
const FAINT: [number, number, number] = [148, 163, 184];
const GREEN: [number, number, number] = [107, 165, 57];
const BLUE: [number, number, number] = [59, 130, 246];
const ORANGE: [number, number, number] = [249, 115, 22];
const AMBER: [number, number, number] = [245, 158, 11];
const PURPLE: [number, number, number] = [168, 85, 247];
const TEAL: [number, number, number] = [20, 184, 166];
const SLATE: [number, number, number] = [148, 163, 184];
const BORDER: [number, number, number] = [226, 232, 240];
const SOFT: [number, number, number] = [247, 249, 247];
const SERIES: [number, number, number][] = [GREEN, BLUE, AMBER, PURPLE, TEAL, ORANGE, SLATE];

const MX = 46;          // page margin
type Doc = any;         // jsPDF instance (dynamically imported)
type AutoTableFn = (doc: any, opts: any) => void;

/* ── low-level drawing helpers ── */
function pageW(doc: Doc) { return doc.internal.pageSize.getWidth(); }
function pageH(doc: Doc) { return doc.internal.pageSize.getHeight(); }

function ensureSpace(doc: Doc, y: number, needed: number): number {
  if (y + needed > pageH(doc) - 54) { doc.addPage(); return 58; }
  return y;
}

function reportHeader(doc: Doc, title: string, generatedAt: string): number {
  const w = pageW(doc);
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, w, 6, "F");
  let y = 46;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.setTextColor(...GREEN);
  doc.text("RM ONE  ·  OPERATIONAL INTELLIGENCE", MX, y);
  y += 20;
  doc.setFontSize(21); doc.setTextColor(...DARK);
  doc.text(title, MX, y);
  y += 16;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  const dt = new Date(generatedAt).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  doc.text(`Generated ${dt}  ·  Live operational data`, MX, y);
  y += 8;
  doc.setDrawColor(...BORDER); doc.setLineWidth(0.75);
  doc.line(MX, y + 4, w - MX, y + 4);
  return y + 22;
}

function sectionTitle(doc: Doc, y: number, text: string): number {
  y = ensureSpace(doc, y, 40);
  doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
  doc.setTextColor(...DARK);
  doc.text(text.toUpperCase(), MX, y);
  doc.setDrawColor(...GREEN); doc.setLineWidth(1.4);
  doc.line(MX, y + 5, MX + 26, y + 5);
  return y + 18;
}

/** grid of KPI stat boxes, 4 per row */
function kpiGrid(doc: Doc, y: number, items: { label: string; value: string; sub?: string }[]): number {
  const w = pageW(doc) - MX * 2;
  const perRow = 4, gap = 8;
  const boxW = (w - gap * (perRow - 1)) / perRow;
  const boxH = 52;
  for (let i = 0; i < items.length; i += perRow) {
    y = ensureSpace(doc, y, boxH + 10);
    const row = items.slice(i, i + perRow);
    row.forEach((it, j) => {
      const x = MX + j * (boxW + gap);
      doc.setFillColor(...SOFT);
      doc.setDrawColor(...BORDER); doc.setLineWidth(0.5);
      doc.roundedRect(x, y, boxW, boxH, 4, 4, "FD");
      doc.setFillColor(...GREEN);
      doc.rect(x, y + 10, 2.5, boxH - 20, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(6.6);
      doc.setTextColor(...FAINT);
      doc.text(it.label.toUpperCase(), x + 10, y + 15);
      doc.setFontSize(15); doc.setTextColor(...DARK);
      doc.text(it.value, x + 10, y + 33);
      if (it.sub) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(7);
        doc.setTextColor(...MUTED);
        doc.text(it.sub, x + 10, y + 44, { maxWidth: boxW - 16 });
      }
    });
    y += boxH + 10;
  }
  return y + 4;
}

/** narrative bullet block */
function narrative(doc: Doc, y: number, lines: string[]): number {
  const w = pageW(doc) - MX * 2;
  for (const line of lines) {
    const split = doc.splitTextToSize(line, w - 22);
    const h = split.length * 11 + 4;
    y = ensureSpace(doc, y, h);
    doc.setFillColor(...GREEN);
    doc.circle(MX + 4, y - 2.4, 1.7, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.6);
    doc.setTextColor(...DARK);
    doc.text(split, MX + 14, y);
    y += h;
  }
  return y + 6;
}

/** horizontal bar chart */
function hBars(
  doc: Doc, y: number,
  rows: { label: string; value: number; sub?: string }[],
  valueFmt: (v: number) => string,
  color: [number, number, number] = GREEN,
  multiColor = false,
): number {
  if (!rows.length) {
    doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
    doc.text("No data available.", MX, y);
    return y + 18;
  }
  const w = pageW(doc) - MX * 2;
  const labelW = 128, valueW = 84;
  const barW = w - labelW - valueW - 16;
  const max = Math.max(...rows.map(r => r.value), 1);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    y = ensureSpace(doc, y, 17);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.2);
    doc.setTextColor(...DARK);
    const label = r.label.length > 30 ? r.label.slice(0, 29) + "…" : r.label;
    doc.text(label, MX + labelW, y, { align: "right" });
    doc.setFillColor(...BORDER);
    doc.roundedRect(MX + labelW + 8, y - 6.5, barW, 8, 2, 2, "F");
    const c = multiColor ? SERIES[i % SERIES.length] : color;
    doc.setFillColor(...c);
    doc.roundedRect(MX + labelW + 8, y - 6.5, Math.max((r.value / max) * barW, 3), 8, 2, 2, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.2);
    doc.setTextColor(...DARK);
    doc.text(valueFmt(r.value) + (r.sub ? `  ${r.sub}` : ""), MX + labelW + 14 + barW, y);
    y += 16;
  }
  return y + 8;
}

/** donut chart drawn via short thick line segments + legend */
function donut(
  doc: Doc, y: number,
  slices: { label: string; value: number; color?: [number, number, number] }[],
  centerLabel: string, centerSub?: string,
): number {
  const data = slices.filter(s => s.value > 0);
  if (!data.length) {
    doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
    doc.text("No data available.", MX, y);
    return y + 18;
  }
  const R = 44, ring = 15;
  const cx = MX + R + 14, cyTop = y;
  const cy = cyTop + R + 4;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  doc.setLineWidth(ring);
  doc.setLineCap("butt");
  let angle = -90; // start at top, clockwise
  const rMid = R - ring / 2;
  for (let i = 0; i < data.length; i++) {
    const sweep = (data[i].value / total) * 360;
    const c = data[i].color ?? SERIES[i % SERIES.length];
    doc.setDrawColor(...c);
    const step = 2; // degrees per segment
    for (let a = angle; a < angle + sweep; a += step) {
      const a2 = Math.min(a + step, angle + sweep);
      const x1 = cx + rMid * Math.cos((a * Math.PI) / 180);
      const y1 = cy + rMid * Math.sin((a * Math.PI) / 180);
      const x2 = cx + rMid * Math.cos((a2 * Math.PI) / 180);
      const y2 = cy + rMid * Math.sin((a2 * Math.PI) / 180);
      doc.line(x1, y1, x2, y2);
    }
    angle += sweep;
  }
  doc.setLineWidth(0.5);
  /* center text */
  doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.setTextColor(...DARK);
  doc.text(centerLabel, cx, cy + (centerSub ? -1 : 3), { align: "center" });
  if (centerSub) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.8);
    doc.setTextColor(...MUTED);
    doc.text(centerSub, cx, cy + 9, { align: "center" });
  }
  /* legend */
  let ly = cyTop + 8;
  const lx = cx + R + 30;
  const legendMaxW = pageW(doc) - MX - lx;
  for (let i = 0; i < data.length && i < 8; i++) {
    const c = data[i].color ?? SERIES[i % SERIES.length];
    doc.setFillColor(...c);
    doc.roundedRect(lx, ly - 5.5, 7, 7, 1.5, 1.5, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.2);
    doc.setTextColor(...DARK);
    const pct = Math.round((data[i].value / total) * 100);
    let label = data[i].label;
    if (label.length > 34) label = label.slice(0, 33) + "…";
    doc.text(label, lx + 12, ly, { maxWidth: legendMaxW - 60 });
    doc.setFont("helvetica", "bold");
    doc.text(`${pct}%`, lx + legendMaxW - 12, ly, { align: "right" });
    ly += 13.5;
  }
  return Math.max(cy + R + 14, ly + 6);
}

/** vertical column chart */
function columns(
  doc: Doc, y: number,
  data: { label: string; count: number }[],
  color: [number, number, number] = PURPLE,
): number {
  if (!data.length || data.every(d => d.count === 0)) {
    doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
    doc.text("No data available.", MX, y);
    return y + 18;
  }
  const w = pageW(doc) - MX * 2;
  const chartH = 84;
  y = ensureSpace(doc, y, chartH + 30);
  const max = Math.max(...data.map(d => d.count), 1);
  const gap = 14;
  const barW = Math.min((w - gap * (data.length - 1)) / data.length, 68);
  const totalW = barW * data.length + gap * (data.length - 1);
  const x0 = MX + (w - totalW) / 2;
  const base = y + chartH;
  doc.setDrawColor(...BORDER); doc.setLineWidth(0.6);
  doc.line(MX, base, MX + w, base);
  data.forEach((d, i) => {
    const x = x0 + i * (barW + gap);
    const h = Math.max((d.count / max) * (chartH - 16), d.count > 0 ? 3 : 0);
    if (h > 0) {
      doc.setFillColor(...color);
      doc.roundedRect(x, base - h, barW, h, 2, 2, "F");
    }
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.4);
    doc.setTextColor(...DARK);
    doc.text(String(d.count), x + barW / 2, base - h - 5, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.2);
    doc.setTextColor(...MUTED);
    doc.text(d.label, x + barW / 2, base + 11, { align: "center" });
  });
  return base + 26;
}

/** styled autotable wrapper */
function table(
  doc: Doc, autoTable: AutoTableFn, y: number,
  head: string[], body: (string | number)[][],
  colStyles?: Record<number, any>,
): number {
  if (!body.length) {
    doc.setFont("helvetica", "italic"); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
    doc.text("No rows to display.", MX, y);
    return y + 18;
  }
  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    margin: { left: MX, right: MX },
    theme: "plain",
    styles: { fontSize: 7.6, textColor: DARK, cellPadding: { top: 4, bottom: 4, left: 5, right: 5 }, lineColor: BORDER, lineWidth: { bottom: 0.5 } },
    headStyles: { fontSize: 6.8, fontStyle: "bold", textColor: MUTED, fillColor: SOFT, lineColor: BORDER, lineWidth: { bottom: 1 } },
    alternateRowStyles: { fillColor: [252, 253, 252] },
    columnStyles: colStyles ?? {},
  });
  return (doc as any).lastAutoTable.finalY + 18;
}

function footerAllPages(doc: Doc) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const w = pageW(doc), h = pageH(doc);
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.5);
    doc.line(MX, h - 34, w - MX, h - 34);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7);
    doc.setTextColor(...FAINT);
    doc.text("RM ONE  ·  Confidential — for internal management use", MX, h - 22);
    doc.text(`Page ${i} of ${pages}`, w - MX, h - 22, { align: "right" });
  }
}

/* ── narrative builders (deterministic, real data only) ── */
function execNarrative(m: ReportModel): string[] {
  const lines: string[] = [];
  lines.push(`The firm carries ${fmtMoney(m.backlogValue)} in contracted backlog across ${m.activeProjects} active project${m.activeProjects === 1 ? "" : "s"}, with ${fmtMoney(m.pipelineValue)} in open pursuits (${fmtMoney(m.weightedPipeline)} probability-weighted).`);
  if (m.winRate != null) lines.push(`Win rate on decided bids is ${m.winRate}% — ${m.wonCount} won, ${m.lostCount} lost (${fmtMoney(m.wonValue)} won value).`);
  else lines.push(`No bids have been decided yet this cycle, so win rate cannot be computed.`);
  if (m.onTimeRate != null) lines.push(`${m.onTimeRate}% of active projects are on schedule; ${m.overdueCount} ${m.overdueCount === 1 ? "is" : "are"} past target completion and ${m.noDateCount} ${m.noDateCount === 1 ? "has" : "have"} no end date on file.`);
  if (m.totalStaff > 0) lines.push(`Workforce: ${m.totalStaff} staff, ${m.deployedRate ?? 0}% deployed, ${m.benchCount} available, ${m.overAllocCount} over-allocated, and ${m.openDemands} unfilled position${m.openDemands === 1 ? "" : "s"}.`);
  const topClient = m.clientConcentration[0];
  if (topClient && topClient.share >= 25) lines.push(`Concentration risk: ${topClient.label} represents ${topClient.share}% of contracted backlog.`);
  return lines;
}

/* ── section renderers per report ── */
function renderExecutive(doc: Doc, autoTable: AutoTableFn, m: ReportModel, y: number): number {
  y = sectionTitle(doc, y, "Key Performance Indicators");
  y = kpiGrid(doc, y, [
    { label: "Contracted Backlog", value: fmtMoney(m.backlogValue), sub: `${m.activeProjects} active projects` },
    { label: "Open Pipeline", value: fmtMoney(m.pipelineValue), sub: `${m.activeBids} active bids` },
    { label: "Weighted Pipeline", value: fmtMoney(m.weightedPipeline), sub: "probability-adjusted" },
    { label: "Win Rate (YTD)", value: m.winRate != null ? `${m.winRate}%` : "—", sub: `${m.wonCount} won / ${m.lostCount} lost` },
    { label: "On-Time Delivery", value: m.onTimeRate != null ? `${m.onTimeRate}%` : "—", sub: `${m.overdueCount} overdue` },
    { label: "Staff Deployed", value: m.deployedRate != null ? `${m.deployedRate}%` : "—", sub: `${m.totalStaff} staff / ${m.benchCount} avail.` },
    { label: "Unfilled Positions", value: String(m.openDemands), sub: "open staffing requests" },
    { label: "Avg Project Size", value: fmtMoney(m.avgProjectValue), sub: "active portfolio" },
  ]);
  y = sectionTitle(doc, y, "Executive Narrative");
  y = narrative(doc, y, execNarrative(m));
  y = sectionTitle(doc, y, "Business Development Funnel");
  y = hBars(doc, y, m.funnel.map(f => ({ label: f.label, value: f.count, sub: `(${fmtMoney(f.value)})` })), v => String(v), BLUE, true);
  y = ensureSpace(doc, y, 130);
  y = sectionTitle(doc, y, "Backlog by Sector");
  y = donut(doc, y, m.backlogBySector.map(s => ({ label: s.label, value: s.value })), fmtMoney(m.backlogValue), "backlog");
  y = sectionTitle(doc, y, "Client Concentration (Top 10)");
  y = hBars(doc, y, m.clientConcentration.map(c => ({ label: c.label, value: c.value, sub: `${c.share}%` })), fmtMoney, BLUE);
  y = sectionTitle(doc, y, "Largest Active Engagements");
  y = table(doc, autoTable, y,
    ["Project", "Client", "Sector", "Division", "Contract Value", "Schedule"],
    m.projects.slice(0, 12).map(p => [
      p.name, p.client ?? "—", p.sector, p.division ?? "—", fmtMoneyFull(p.value),
      p.overdue ? `Overdue ${p.daysOverdue ?? ""}d` : p.noDate ? "No end date" : "On schedule",
    ]),
    { 4: { halign: "right", fontStyle: "bold" } },
  );
  return y;
}

function renderPipeline(doc: Doc, autoTable: AutoTableFn, m: ReportModel, y: number): number {
  y = sectionTitle(doc, y, "Pipeline Overview");
  y = kpiGrid(doc, y, [
    { label: "Open Pipeline", value: fmtMoney(m.pipelineValue), sub: `${m.activeBids} active bids` },
    { label: "Weighted Pipeline", value: fmtMoney(m.weightedPipeline), sub: "probability-adjusted" },
    { label: "Win Rate", value: m.winRate != null ? `${m.winRate}%` : "—", sub: `${m.wonCount} of ${m.wonCount + m.lostCount} decided` },
    { label: "Won Value (YTD)", value: fmtMoney(m.wonValue), sub: `lost ${fmtMoney(m.lostValue)}` },
    { label: "Early-Stage Leads", value: String(m.leadCount), sub: fmtMoney(m.leadValue) },
    { label: "Avg Bid Size", value: m.activeBids > 0 ? fmtMoney(m.pipelineValue / m.activeBids) : "—", sub: "open pursuits" },
  ]);
  y = sectionTitle(doc, y, "Active Bids by Stage");
  y = hBars(doc, y, m.opmByStage.map(s => ({ label: s.label, value: s.value, sub: `(${s.count})` })), fmtMoney, BLUE);
  y = sectionTitle(doc, y, "Win / Loss by Sector");
  y = table(doc, autoTable, y,
    ["Sector", "Won", "Lost", "Win Rate", "Won Value", "Lost Value"],
    m.winLossBySector.map(s => [
      s.sector, s.won, s.lost,
      s.won + s.lost > 0 ? `${Math.round((s.won / (s.won + s.lost)) * 100)}%` : "—",
      fmtMoneyFull(s.wonValue), fmtMoneyFull(s.lostValue),
    ]),
    { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
  );
  y = sectionTitle(doc, y, "Open Opportunities");
  y = table(doc, autoTable, y,
    ["Opportunity", "Client", "Stage", "Value", "Prob.", "Weighted", "Bid Date"],
    m.opps.slice(0, 30).map(o => [
      o.name, o.client ?? "—", o.stage, fmtMoneyFull(o.value),
      o.probability != null ? `${o.probability}%` : "—", fmtMoneyFull(o.weighted), fmtDateShort(o.bidDate),
    ]),
    { 3: { halign: "right", fontStyle: "bold" }, 4: { halign: "right" }, 5: { halign: "right" } },
  );
  if (m.leads.length) {
    y = sectionTitle(doc, y, "Early-Stage Leads");
    y = table(doc, autoTable, y,
      ["Lead", "Client", "Sector", "Status", "Est. Value"],
      m.leads.slice(0, 20).map(l => [l.name, l.client ?? "—", l.sector, l.status, fmtMoneyFull(l.value)]),
      { 4: { halign: "right" } },
    );
  }
  return y;
}

function renderPortfolio(doc: Doc, autoTable: AutoTableFn, m: ReportModel, y: number): number {
  y = sectionTitle(doc, y, "Portfolio Overview");
  y = kpiGrid(doc, y, [
    { label: "Contracted Backlog", value: fmtMoney(m.backlogValue), sub: `${m.activeProjects} active projects` },
    { label: "On-Time Delivery", value: m.onTimeRate != null ? `${m.onTimeRate}%` : "—", sub: `${m.onScheduleCount} on schedule` },
    { label: "Overdue Projects", value: String(m.overdueCount), sub: "past target completion" },
    { label: "Missing End Dates", value: String(m.noDateCount), sub: "untrackable schedules" },
    { label: "Avg Project Size", value: fmtMoney(m.avgProjectValue), sub: "active portfolio" },
    { label: "Closed Projects", value: String(m.closedProjects.length), sub: "historical record" },
  ]);
  y = ensureSpace(doc, y, 130);
  y = sectionTitle(doc, y, "Schedule Health");
  y = donut(doc, y, [
    { label: "On schedule", value: m.scheduleHealth.onSchedule, color: GREEN },
    { label: "Overdue", value: m.scheduleHealth.overdue, color: ORANGE },
    { label: "No end date", value: m.scheduleHealth.noDate, color: SLATE },
  ], m.onTimeRate != null ? `${m.onTimeRate}%` : "—", "on schedule");
  y = sectionTitle(doc, y, "Backlog by Division");
  y = hBars(doc, y, m.backlogByDivision.map(d => ({ label: d.label, value: d.value, sub: `(${d.count})` })), fmtMoney, GREEN);
  y = sectionTitle(doc, y, "Project Size Distribution");
  y = columns(doc, y, m.valueRanges, PURPLE);
  y = sectionTitle(doc, y, "Active Project Register");
  y = table(doc, autoTable, y,
    ["Project", "Client", "Sector", "Division", "Contract Value", "Target End", "Schedule"],
    m.projects.map(p => [
      p.name, p.client ?? "—", p.sector, p.division ?? "—",
      fmtMoneyFull(p.value), fmtDateShort(p.targetEnd),
      p.overdue ? `Overdue ${p.daysOverdue ?? ""}d` : p.noDate ? "No date" : "On track",
    ]),
    { 4: { halign: "right", fontStyle: "bold" } },
  );
  return y;
}

function renderWorkforce(doc: Doc, autoTable: AutoTableFn, m: ReportModel, y: number): number {
  y = sectionTitle(doc, y, "Workforce Overview");
  y = kpiGrid(doc, y, [
    { label: "Total Staff", value: String(m.totalStaff), sub: "active resources" },
    { label: "Deployed", value: m.deployedRate != null ? `${m.deployedRate}%` : "—", sub: "with active assignments" },
    { label: "Available", value: String(m.benchCount), sub: "ready to assign" },
    { label: "Over-Allocated", value: String(m.overAllocCount), sub: "above 100% load" },
    { label: "Unfilled Positions", value: String(m.openDemands), sub: "open staffing requests" },
    { label: "At Normal Load", value: String(m.healthyCount), sub: "healthy utilization" },
  ]);
  y = sectionTitle(doc, y, "Utilization Distribution");
  y = columns(doc, y, m.utilizationBands, TEAL);
  y = sectionTitle(doc, y, "Staff Utilization Register");
  y = table(doc, autoTable, y,
    ["Name", "Role", "Division", "Utilization", "Active Projects", "Status"],
    m.staff.map(s => [s.name, s.role ?? "—", s.division ?? "—", `${s.utilization}%`, s.activeProjects, s.band]),
    { 3: { halign: "right", fontStyle: "bold" }, 4: { halign: "right" } },
  );
  if (m.demands.length) {
    y = sectionTitle(doc, y, "Open Demand (Unfilled Positions)");
    y = table(doc, autoTable, y,
      ["Project", "Role Needed", "Allocation", "Start", "End"],
      m.demands.map(d => [d.project, d.role, d.pct > 0 ? `${d.pct}%` : "—", fmtDateShort(d.start), fmtDateShort(d.end)]),
      { 2: { halign: "right" } },
    );
  }
  return y;
}

function renderFinancial(doc: Doc, autoTable: AutoTableFn, m: ReportModel, y: number): number {
  const kpis: { label: string; value: string; sub?: string }[] = [
    { label: "Contracted Backlog", value: fmtMoney(m.backlogValue), sub: `${m.activeProjects} active projects` },
    { label: "Labor Forecast", value: fmtMoney(m.totalForecastCost), sub: "committed labor value" },
    { label: "Weighted Pipeline", value: fmtMoney(m.weightedPipeline), sub: "future revenue signal" },
    { label: "Margin-Risk Projects", value: String(m.marginRiskCount), sub: "overdue with value at stake" },
  ];
  if (m.cfo) {
    kpis.push(
      { label: "Pipeline Coverage", value: `${Math.round(m.cfo.pipelineCoverage)}%`, sub: "vs. coverage target" },
      { label: "Labor Margin Score", value: `${Math.round(m.cfo.laborMargin)}%`, sub: "portfolio labor health" },
      { label: "Hours on Plan", value: `${Math.round(m.cfo.hoursOnPlan)}%`, sub: "execution vs. plan" },
      { label: "At-Risk Projects", value: String(m.cfo.detail?.atRiskCount ?? "—"), sub: "flagged by financial scan" },
    );
  }
  y = sectionTitle(doc, y, "Financial Position");
  y = kpiGrid(doc, y, kpis);
  y = sectionTitle(doc, y, "Revenue Concentration by Sector");
  y = hBars(doc, y, m.backlogBySector.map(s => ({ label: s.label, value: s.value, sub: `(${s.count})` })), fmtMoney, GREEN, true);
  y = sectionTitle(doc, y, "Top Client Exposure");
  y = hBars(doc, y, m.clientConcentration.map(c => ({ label: c.label, value: c.value, sub: `${c.share}%` })), fmtMoney, BLUE);
  y = sectionTitle(doc, y, "Contract Financial Register");
  y = table(doc, autoTable, y,
    ["Project", "Client", "Contract Value", "Labor Contract", "Forecast Cost", "Schedule"],
    m.projects.slice(0, 40).map(p => [
      p.name, p.client ?? "—", fmtMoneyFull(p.value), fmtMoneyFull(p.laborContract), fmtMoneyFull(p.forecastCost),
      p.overdue ? "Overdue" : p.noDate ? "No date" : "On track",
    ]),
    { 2: { halign: "right", fontStyle: "bold" }, 3: { halign: "right" }, 4: { halign: "right" } },
  );
  return y;
}

function renderConversion(doc: Doc, autoTable: AutoTableFn, m: ReportModel, y: number): number {
  const c = m.conversion;
  y = sectionTitle(doc, y, "Conversion Overview");
  y = kpiGrid(doc, y, [
    { label: "Leads Converted", value: String(c.leadsConverted), sub: `of ${c.leadsTotal} leads on record` },
    { label: "Lead → Opp Rate", value: c.leadConversionRate != null ? `${c.leadConversionRate}%` : "—", sub: "leads that became opportunities" },
    { label: "Converted Lead Value", value: fmtMoney(c.leadsConvertedValue), sub: "estimated value carried forward" },
    { label: "Opps Converted", value: String(c.oppsConverted), sub: `of ${c.oppsTotal} opportunities on record` },
    { label: "Opp → Project Rate", value: c.oppConversionRate != null ? `${c.oppConversionRate}%` : "—", sub: "opportunities that became projects" },
    { label: "Converted Opp Value", value: fmtMoney(c.oppsConvertedValue), sub: "contract value moved to delivery" },
  ]);
  y = sectionTitle(doc, y, "Lifecycle Flow");
  y = hBars(doc, y, [
    { label: "Leads (all recorded)", value: c.leadsTotal, sub: `${c.leadsConverted} converted` },
    { label: "Opportunities (all recorded)", value: c.oppsTotal, sub: `${c.oppsConverted} converted` },
    { label: "Projects (active + closed)", value: m.activeProjects + m.closedProjects.length, sub: `${m.activeProjects} active` },
  ], v => String(v), BLUE, true);
  if (c.convertedLeads.length) {
    y = sectionTitle(doc, y, "Leads That Became Opportunities");
    y = table(doc, autoTable, y,
      ["Lead", "Client", "Sector", "Est. Value"],
      c.convertedLeads.slice(0, 40).map(l => [l.name, l.client ?? "—", l.sector, fmtMoneyFull(l.value)]),
      { 3: { halign: "right", fontStyle: "bold" } },
    );
  }
  if (c.convertedOpps.length) {
    y = sectionTitle(doc, y, "Opportunities That Became Projects");
    y = table(doc, autoTable, y,
      ["Opportunity", "Client", "Sector", "Contract Value"],
      c.convertedOpps.slice(0, 40).map(o => [o.name, o.client ?? "—", o.sector, fmtMoneyFull(o.value)]),
      { 3: { halign: "right", fontStyle: "bold" } },
    );
  }
  if (!c.convertedLeads.length && !c.convertedOpps.length) {
    y = ensureSpace(doc, y, 24);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    doc.setTextColor(...MUTED);
    doc.text("No conversions recorded yet. Convert a lead to an opportunity, or an opportunity to a project, and it will appear here.", MX, y);
    y += 18;
  }
  return y;
}

const RENDERERS: Record<ReportKey, (doc: Doc, at: AutoTableFn, m: ReportModel, y: number) => number> = {
  executive: renderExecutive,
  pipeline: renderPipeline,
  portfolio: renderPortfolio,
  workforce: renderWorkforce,
  financial: renderFinancial,
  conversion: renderConversion,
};

/* ── public API ── */
async function loadLibs() {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  return { jsPDF, autoTable: autoTableMod.default as AutoTableFn };
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function exportReportPdf(m: ReportModel, key: ReportKey): Promise<void> {
  const { jsPDF, autoTable } = await loadLibs();
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const y = reportHeader(doc, REPORT_TITLES[key], m.generatedAt);
  RENDERERS[key](doc, autoTable, m, y);
  footerAllPages(doc);
  doc.save(`RMONE-${key}-report-${stamp()}.pdf`);
}

export async function exportAllPdf(m: ReportModel): Promise<void> {
  const { jsPDF, autoTable } = await loadLibs();
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const keys: ReportKey[] = ["executive", "pipeline", "portfolio", "workforce", "financial", "conversion"];
  keys.forEach((key, i) => {
    if (i > 0) doc.addPage();
    const y = reportHeader(doc, REPORT_TITLES[key], m.generatedAt);
    RENDERERS[key](doc, autoTable, m, y);
  });
  footerAllPages(doc);
  doc.save(`RMONE-executive-report-pack-${stamp()}.pdf`);
}
