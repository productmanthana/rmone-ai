/* ─────────────────────────────────────────────────────────────
 * exportExecForecast.ts — Excel / CSV download for the Executive
 * Forecast table. Same engines and download ritual as the Reports
 * pages (exceljs dynamically imported; CSV is dependency-free).
 *
 * Contract (client's approved wording):
 * - Rows arrive from the page ALREADY filtered + sorted, so the
 *   file matches exactly what the executive sees on screen — every
 *   row matching the search, not just the visible scroll window.
 * - Headers reuse the exact on-page column wording; the three
 *   unit-scoped metrics carry BOTH families (Hours and Cost ($))
 *   regardless of the page's unit toggle, composed with the same
 *   "label — unit" pattern the page uses for its chart title.
 * - "As of" (each project's snapshot week) is always included.
 * - The substituted / reconstructed disclosure chips ride along in
 *   a Flags column using the exact chip wording.
 * ──────────────────────────────────────────────────────────── */
import type { AfOverviewProject } from "./api";
import { execPctUsed, round2, unitValues, UNIT_LABEL } from "./afMath";

export interface ExecForecastExportRow {
  project: AfOverviewProject;
  /** Display title resolved by the page (may be ""). */
  title: string;
}

export interface ExecForecastExportMeta {
  currentWeek: string;
  /** Trimmed active search text ("" = no filter). */
  search: string;
  /** Row count before the search filter, for the population line. */
  totalCount: number;
}

type ColKind = "text" | "hours" | "money" | "pct";

interface ExportCol {
  header: string;
  kind: ColKind;
  width: number;
  value: (r: ExecForecastExportRow) => string | number | null;
}

/** Disclosure chips shown in the on-page Project cell, exact wording. */
function flagsOf(p: AfOverviewProject): string {
  const flags: string[] = [];
  if (p.substitutedHours > 0) flags.push("substituted");
  if (p.backfilled) flags.push("reconstructed");
  return flags.join(", ");
}

const H = UNIT_LABEL.hours; // "Hours"
const C = UNIT_LABEL.cost;  // "Cost ($)"

/** Column model shared by the Excel and CSV writers — one wording source. */
export const EXEC_FORECAST_EXPORT_COLUMNS: ExportCol[] = [
  { header: "Project", kind: "text", width: 16, value: (r) => r.project.ticket },
  { header: "Title", kind: "text", width: 40, value: (r) => r.title },
  { header: `Actual to Date — ${H}`, kind: "hours", width: 20, value: (r) => unitValues(r.project, "hours").actualTd },
  { header: `Actual to Date — ${C}`, kind: "money", width: 20, value: (r) => unitValues(r.project, "cost").actualTd },
  { header: `Remaining Forecast — ${H}`, kind: "hours", width: 23, value: (r) => unitValues(r.project, "hours").remaining },
  { header: `Remaining Forecast — ${C}`, kind: "money", width: 23, value: (r) => unitValues(r.project, "cost").remaining },
  { header: `Forecast at Completion — ${H}`, kind: "hours", width: 26, value: (r) => unitValues(r.project, "hours").eac },
  { header: `Forecast at Completion — ${C}`, kind: "money", width: 26, value: (r) => unitValues(r.project, "cost").eac },
  { header: "Hours Variance", kind: "hours", width: 15, value: (r) => r.project.hoursVariance },
  { header: "Cost Variance", kind: "money", width: 15, value: (r) => r.project.costVariance },
  { header: `% Used — ${H}`, kind: "pct", width: 15, value: (r) => execPctUsed(unitValues(r.project, "hours").actualTd, unitValues(r.project, "hours").eac) },
  { header: `% Used — ${C}`, kind: "pct", width: 15, value: (r) => execPctUsed(unitValues(r.project, "cost").actualTd, unitValues(r.project, "cost").eac) },
  { header: "As of", kind: "text", width: 12, value: (r) => r.project.weekMonday },
  { header: "Flags", kind: "text", width: 24, value: (r) => flagsOf(r.project) },
];

/* ── CSV ──────────────────────────────────────────────────────────────── */

/**
 * Neutralize spreadsheet formula injection: quotes are stripped when a CSV
 * is opened in Excel/Sheets, so an untrusted text cell (project ticket,
 * imported title) starting with =, +, -, @, tab or CR would execute as a
 * formula. A leading apostrophe renders it as inert text. Only TEXT cells
 * pass through here — numeric cells are emitted from typed number fields,
 * so negative variances stay real numbers. (The Excel writer is safe
 * structurally: exceljs stores strings as strings, never as formulas.)
 */
function inertCsvText(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/**
 * Pure CSV text builder (exported for tests). Numbers stay raw round2
 * values — no $ signs, % suffixes or thousands separators — so the file
 * pastes cleanly into an executive's own workbook; blank = not computable
 * (matching the on-page "—").
 */
export function buildExecForecastCsvText(rows: ExecForecastExportRow[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const cell = (col: ExportCol, r: ExecForecastExportRow): string => {
    const v = col.value(r);
    if (v === null || v === "") return "";
    if (typeof v === "number") return String(round2(v));
    return esc(inertCsvText(v));
  };
  const lines = [EXEC_FORECAST_EXPORT_COLUMNS.map((c) => esc(c.header)).join(",")];
  for (const r of rows) {
    lines.push(EXEC_FORECAST_EXPORT_COLUMNS.map((c) => cell(c, r)).join(","));
  }
  return lines.join("\n");
}

/* ── shared download ritual (same as exportCard / exportExcel) ────────── */

function download(blob: Blob, filename: string): void {
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

export function exportExecForecastCsv(rows: ExecForecastExportRow[]): void {
  /* BOM so Excel reads the UTF-8 headers (em-dashes) correctly. */
  const blob = new Blob(["\uFEFF" + buildExecForecastCsvText(rows)], { type: "text/csv;charset=utf-8" });
  download(blob, `RMONE-executive-forecast-${stamp()}.csv`);
}

/* ── Excel ────────────────────────────────────────────────────────────── */

const GREEN = "FF6BA539";
const DARK = "FF1E2933";
const WHITE = "FFFFFFFF";
const SOFT = "FFF4F7F2";
const MONEY = '"$"#,##0';
const HOURS = "#,##0.##";
const PCT = '0.##"%"';

export async function exportExecForecastExcel(
  rows: ExecForecastExportRow[],
  meta: ExecForecastExportMeta,
): Promise<void> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "RM ONE";
  wb.created = new Date();
  const ws = wb.addWorksheet("Executive Forecast", { views: [{ state: "frozen", ySplit: 4 }] });

  const colCount = EXEC_FORECAST_EXPORT_COLUMNS.length;
  ws.mergeCells(1, 1, 1, colCount);
  const title = ws.getCell(1, 1);
  title.value = "RM ONE — Executive Forecast";
  title.font = { bold: true, size: 14, color: { argb: DARK } };
  ws.getRow(1).height = 24;

  /* population disclosure — says exactly which rows this file contains */
  ws.mergeCells(2, 1, 2, colCount);
  const population = meta.search
    ? `${rows.length} of ${meta.totalCount} projects — search "${meta.search}"`
    : `All ${rows.length} project${rows.length === 1 ? "" : "s"}`;
  const sub = ws.getCell(2, 1);
  sub.value = `Generated ${new Date().toLocaleString("en-US")} · As of week ${meta.currentWeek} · ${population} · Frozen weekly snapshots`;
  sub.font = { size: 9, color: { argb: "FF6B7E8A" } };

  const headRow = ws.getRow(4);
  EXEC_FORECAST_EXPORT_COLUMNS.forEach((c, i) => {
    const cell = headRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: WHITE }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    cell.alignment = { vertical: "middle", horizontal: c.kind === "text" ? "left" : "right" };
    ws.getColumn(i + 1).width = c.width;
  });
  headRow.height = 20;

  rows.forEach((r, idx) => {
    const xr = ws.getRow(5 + idx);
    EXEC_FORECAST_EXPORT_COLUMNS.forEach((c, i) => {
      const cell = xr.getCell(i + 1);
      const v = c.value(r);
      if (typeof v === "number") {
        cell.value = round2(v);
        cell.numFmt = c.kind === "money" ? MONEY : c.kind === "pct" ? PCT : HOURS;
      } else {
        /* on-page "—" for a % Used that isn't computable (FAC ≤ 0) */
        cell.value = v === null || v === "" ? (c.kind === "pct" ? "—" : "") : v;
      }
      if (c.kind !== "text") cell.alignment = { horizontal: "right" };
      if (idx % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  download(blob, `RMONE-executive-forecast-${stamp()}.xlsx`);
}
