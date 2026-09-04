/* ─────────────────────────────────────────────────────────────
 * exportCard.ts — per-card PDF / Excel export for the Analytics
 * Center. Same engines as the Reports page (jspdf + autotable,
 * exceljs), imported dynamically so dashboards never pay the
 * bundle cost. A card export contains exactly what the card's
 * data drawer shows: title, plain-language takeaway, headline
 * stats and the full underlying row table.
 *
 * Both exportCardPdf and exportCardExcel accept an optional
 * totalRow parameter so the visible computed total row is also
 * included in the exported file. The rows passed in card.rows
 * should already be the actively filtered population — the
 * drawer passes filtered rows, not the full card rows.
 * ──────────────────────────────────────────────────────────── */
import { fmtCell, isSafelysummable, type CardModel, type CardRow } from "@/lib/analyticsCenter";
import { fmtDateShort } from "@/lib/reportData";

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/* fixed light export palette (files are printed/shared — always light) */
const DARK: [number, number, number] = [30, 41, 51];
const MUTED: [number, number, number] = [107, 126, 138];
const GREEN: [number, number, number] = [107, 165, 57];
const BORDER: [number, number, number] = [226, 232, 240];
const SOFT: [number, number, number] = [247, 249, 247];
const TOTAL_BG: [number, number, number] = [236, 246, 226];
const MX = 46;

export type CardExportSection = { label: string; card: CardModel };

/**
 * jsPDF's built-in Helvetica and some spreadsheet viewers do not render the
 * decorative Unicode glyphs used by the dashboard reliably. Keep exported
 * files readable without changing the on-screen card or user-entered names.
 */
export function sanitizeExportText(value: unknown): string {
  return String(value ?? "")
    .replace(/📋/gu, "")
    .replace(/[→⇒⇢]/gu, "->")
    .replace(/[←⇐⇠]/gu, "<-")
    .replace(/[↔⇔]/gu, "<->")
    .replace(/[—–]/gu, "-")
    .replace(/…/gu, "...")
    .replace(/·/gu, " - ")
    .replace(/[✓✔]/gu, "[OK]")
    .replace(/⚠️?/gu, "[Warning]")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function exportCardPdf(
  card: CardModel,
  totalRow?: CardRow,
  extraSections: CardExportSection[] = [],
): Promise<void> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableMod.default as (doc: any, opts: any) => void;
  const doc: any = new jsPDF({ unit: "pt", format: "letter" });
  const w = doc.internal.pageSize.getWidth();

  /* header (matches the Reports page export branding) */
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, w, 6, "F");
  let y = 46;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.setTextColor(...GREEN);
  doc.text(sanitizeExportText("RM ONE  ·  ANALYTICS CENTER"), MX, y);
  y += 20;
  doc.setFontSize(19); doc.setTextColor(...DARK);
  doc.text(sanitizeExportText(card.title), MX, y);
  y += 15;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  const dt = new Date().toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  doc.text(sanitizeExportText(`Generated ${dt}  ·  Live operational data`), MX, y);
  y += 14;
  doc.setFontSize(10); doc.setTextColor(...DARK);
  const takeaway = doc.splitTextToSize(sanitizeExportText(card.takeaway), w - MX * 2);
  doc.text(takeaway, MX, y);
  y += takeaway.length * 12 + 4;

  /* explanation block if present */
  if (card.explanation) {
    const expl = card.explanation;
    doc.setFontSize(8.5); doc.setTextColor(...MUTED);
    const metaParts: string[] = [];
    if (expl.period) metaParts.push(`Period: ${expl.period}`);
    if (expl.measure) metaParts.push(`Measure: ${expl.measure}`);
    if (expl.source) metaParts.push(`Source: ${expl.source}`);
    if (expl.completeness !== undefined) {
      metaParts.push(`Completeness: ${typeof expl.completeness === "number" ? `${Math.round(expl.completeness * 100)}%` : expl.completeness}`);
    }
    if (metaParts.length > 0) {
      doc.text(sanitizeExportText(metaParts.join("  ·  ")), MX, y);
      y += 12;
    }
  }

  doc.setDrawColor(...BORDER); doc.setLineWidth(0.75);
  doc.line(MX, y, w - MX, y);
  y += 16;

  /* headline stat boxes */
  if (card.stats.length > 0) {
    const perRow = Math.min(4, card.stats.length);
    const gap = 8;
    const boxW = (w - MX * 2 - gap * (perRow - 1)) / perRow;
    const boxH = 46;
    card.stats.slice(0, 8).forEach((s, i) => {
      const col = i % perRow, row = Math.floor(i / perRow);
      const x = MX + col * (boxW + gap);
      const by = y + row * (boxH + gap);
      doc.setFillColor(...SOFT);
      doc.setDrawColor(...BORDER);
      doc.roundedRect(x, by, boxW, boxH, 5, 5, "FD");
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(sanitizeExportText(s.label).toUpperCase(), x + 9, by + 16);
      doc.setFont("helvetica", "bold"); doc.setFontSize(14);
      doc.setTextColor(...DARK);
      doc.text(sanitizeExportText(s.value), x + 9, by + 34);
    });
    y += Math.ceil(Math.min(8, card.stats.length) / perRow) * (boxH + gap) + 8;
  }

  /* build body rows — the actively filtered population */
  const bodyRows = card.rows.map(r => card.columns.map(c => sanitizeExportText(fmtCell(r[c.key], c))));

  /* append total row if provided */
  if (totalRow && card.rows.length > 1) {
    const totalRowFormatted = card.columns.map((c, idx) => {
      if (idx === 0) return "TOTAL";
      if (isSafelysummable(c) && totalRow[c.key] !== undefined) return fmtCell(totalRow[c.key], c);
      return "";
    });
    bodyRows.push(totalRowFormatted);
  }

  /* full row table */
  autoTable(doc, {
    startY: y,
    margin: { left: MX, right: MX },
      head: [card.columns.map(c => sanitizeExportText(c.label))],
    body: bodyRows,
    styles: { fontSize: 7.5, cellPadding: 4, textColor: DARK, lineColor: BORDER, lineWidth: 0.4, overflow: "ellipsize" },
    headStyles: { fillColor: GREEN, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.5 },
    alternateRowStyles: { fillColor: SOFT },
    columnStyles: Object.fromEntries(
      card.columns.map((c, i) => [i, c.align === "right" ? { halign: "right" } : {}]),
    ),
    /* Style the total row distinctly */
    didParseCell: (data: any) => {
      if (totalRow && card.rows.length > 1 && data.row.index === bodyRows.length - 1 && data.section === "body") {
        data.cell.styles.fillColor = TOTAL_BG;
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = [40, 100, 20];
      }
    },
  });

  /* Hub exports also include the period-scoped population. Keep it as a
   * separate labeled table so "4 active" and "8 new" cannot be mistaken for
   * one combined or silently truncated population. */
  let sectionY = (doc as any).lastAutoTable?.finalY ?? y;
  for (const section of extraSections) {
    if (section.card.rows.length === 0) continue;
    if (sectionY + 44 > doc.internal.pageSize.getHeight() - 48) {
      doc.addPage();
      sectionY = 46;
    } else {
      sectionY += 20;
    }
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...DARK);
     doc.text(sanitizeExportText(`${section.label} (${section.card.rows.length})`), MX, sectionY);
    sectionY += 8;
    autoTable(doc, {
      startY: sectionY,
      margin: { left: MX, right: MX },
       head: [section.card.columns.map(c => sanitizeExportText(c.label))],
       body: section.card.rows.map(r => section.card.columns.map(c => sanitizeExportText(fmtCell(r[c.key], c)))),
      styles: { fontSize: 7.5, cellPadding: 4, textColor: DARK, lineColor: BORDER, lineWidth: 0.4, overflow: "ellipsize" },
      headStyles: { fillColor: GREEN, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.5 },
      alternateRowStyles: { fillColor: SOFT },
      columnStyles: Object.fromEntries(
        section.card.columns.map((c, i) => [i, c.align === "right" ? { halign: "right" } : {}]),
      ),
    });
    sectionY = (doc as any).lastAutoTable?.finalY ?? sectionY;
  }

  /* footer on all pages */
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
     doc.text(sanitizeExportText(`RM ONE Analytics Center · ${card.title}`), MX, doc.internal.pageSize.getHeight() - 24);
     doc.text(sanitizeExportText(`Page ${p} of ${pages}`), w - MX, doc.internal.pageSize.getHeight() - 24, { align: "right" });
  }

  doc.save(`RMONE-analytics-${card.id}-${stamp()}.pdf`);
}

export async function exportCardExcel(card: CardModel, totalRow?: CardRow): Promise<void> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "RM ONE";

  const G = "FF6BA539";
  const D = "FF1E2933";
  const W = "FFFFFFFF";
  const S = "FFF4F7F2";
  const T = "FFECF6E2"; /* total row highlight */

  /* summary block + data on one sheet (a card is one table) */
  const ws = wb.addWorksheet(sanitizeExportText(card.title).slice(0, 31).replace(/[\\/*?:[\]]/g, "-"));

  ws.mergeCells(1, 1, 1, Math.max(3, card.columns.length));
  const title = ws.getCell(1, 1);
  title.value = sanitizeExportText(`RM ONE — ${card.title}`);
  title.font = { bold: true, size: 14, color: { argb: D } };
  ws.getRow(1).height = 24;

  ws.mergeCells(2, 1, 2, Math.max(3, card.columns.length));
  const sub = ws.getCell(2, 1);
  sub.value = sanitizeExportText(`${card.takeaway}  ·  Generated ${new Date().toLocaleString("en-US")} · Live operational data`);
  sub.font = { size: 9, color: { argb: "FF6B7E8A" } };

  /* explanation metadata row */
  let extraRows = 0;
  if (card.explanation) {
    const expl = card.explanation;
    const metaParts: string[] = [];
    if (expl.period) metaParts.push(`Period: ${expl.period}`);
    if (expl.measure) metaParts.push(`Measure: ${expl.measure}`);
    if (expl.source) metaParts.push(`Source: ${expl.source}`);
    if (expl.completeness !== undefined) {
      metaParts.push(`Completeness: ${typeof expl.completeness === "number" ? `${Math.round(expl.completeness * 100)}%` : expl.completeness}`);
    }
    if (metaParts.length > 0) {
      ws.mergeCells(3, 1, 3, Math.max(3, card.columns.length));
      const metaCell = ws.getCell(3, 1);
      metaCell.value = sanitizeExportText(metaParts.join("  ·  "));
      metaCell.font = { size: 8, color: { argb: "FF8A9BAA" }, italic: true };
      extraRows = 1;
    }
  }

  /* headline stats */
  let r = 4 + extraRows;
  for (const s of card.stats) {
    ws.getCell(r, 1).value = sanitizeExportText(s.label);
    ws.getCell(r, 1).font = { size: 10, color: { argb: D } };
    ws.getCell(r, 2).value = sanitizeExportText(s.value);
    ws.getCell(r, 2).font = { bold: true, size: 10, color: { argb: D } };
    r += 1;
  }
  r += 1;

  /* table header */
  const headRow = ws.getRow(r);
  card.columns.forEach((c, i) => {
    const cell = headRow.getCell(i + 1);
    cell.value = sanitizeExportText(c.label);
    cell.font = { bold: true, color: { argb: W }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: G } };
    cell.alignment = { vertical: "middle", horizontal: c.align === "right" ? "right" : "left" };
    ws.getColumn(i + 1).width = c.width ?? 18;
  });
  headRow.height = 20;
  ws.views = [{ state: "frozen", ySplit: r }];

  /* rows — the actively filtered population; real numbers stay numbers */
  const MONEY = '"$"#,##0';
  card.rows.forEach((row, idx) => {
    const xr = ws.getRow(r + 1 + idx);
    card.columns.forEach((c, i) => {
      const cell = xr.getCell(i + 1);
      const v = row[c.key];
      if (c.kind === "money" || c.kind === "moneyFull") {
        cell.value = Number(v) || 0;
        cell.numFmt = MONEY;
      } else if (c.kind === "pct") {
        cell.value = Math.round(Number(v) || 0);
        cell.numFmt = '0"%"';
      } else if (c.kind === "int") {
        cell.value = Number(v) || 0;
      } else if (c.kind === "date") {
        cell.value = sanitizeExportText(v ? fmtDateShort(String(v)) : "—");
      } else {
        cell.value = sanitizeExportText(v === null || v === undefined || v === "" ? "—" : String(v));
      }
      if (c.align === "right") cell.alignment = { horizontal: "right" };
      if (idx % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: S } };
    });
  });

  /* total row in Excel — only when summable columns exist */
  if (totalRow && card.rows.length > 1) {
    const hasSummable = card.columns.some(isSafelysummable);
    if (hasSummable) {
      const tr = ws.getRow(r + 1 + card.rows.length);
      card.columns.forEach((c, i) => {
        const cell = tr.getCell(i + 1);
        if (i === 0) {
          cell.value = "TOTAL";
          cell.font = { bold: true, size: 10, color: { argb: D } };
        } else if (isSafelysummable(c) && totalRow[c.key] !== undefined) {
          const v = totalRow[c.key];
          if (c.kind === "money" || c.kind === "moneyFull") {
            cell.value = Number(v) || 0;
            cell.numFmt = MONEY;
          } else if (c.kind === "int") {
            cell.value = Number(v) || 0;
          } else {
            cell.value = Number(v) || 0;
          }
          cell.font = { bold: true, size: 10 };
        }
        if (c.align === "right") cell.alignment = { horizontal: "right" };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: T } };
        cell.border = { top: { style: "medium", color: { argb: "FF6BA539" } } };
      });
      tr.height = 20;
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `RMONE-analytics-${card.id}-${stamp()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
