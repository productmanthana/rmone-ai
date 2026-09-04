/**
 * Excel parser — reads .xlsx/.xls files and returns structured SheetData.
 *
 * MEMORY: parsing uses ExcelJS's STREAMING WorkbookReader (row-by-row), never
 * `wb.xlsx.load(buffer)`. A full-DOM load needs ~5–10x the file size in RAM
 * (every cell becomes a rich object with style metadata) and has OOM-killed
 * production during a large client import (64k-row Team Assignments sheet on a
 * 4 GiB machine). The streaming reader keeps only ONE row of ExcelJS objects
 * alive at a time; we retain plain scalar values per sheet, which is the same
 * data the pipeline needs anyway. Do not reintroduce full-workbook loads on
 * any path that can receive client-sized files.
 *
 * The ONE sanctioned exception is the ≤20 MB entry-order fallback at the
 * bottom of this file (see withEntryOrderFallback) — the streaming reader
 * intermittently crashes on archives whose xl/workbook.xml comes AFTER the
 * worksheet entries (SheetJS-generated files), and small files may be re-read
 * with the order-immune full-DOM loader instead of failing the upload.
 */
import ExcelJS from "exceljs";
import { Readable } from "stream";
import type { SheetData, PipelineRow } from "./pipeline.js";
import { TEMPLATE_HEADER_LABELS } from "./pipeline.js";

// The current template emits a SINGLE header row (the real column name, e.g.
// "Division"), with guidance attached as a hover comment — so it parses with no
// special handling. The promotion logic below is LEGACY support for older
// downloaded templates that used TWO header rows: row 1 = a long instruction hint
// ("★ Your company division (e.g. Infrastructure)"), row 2 = the short friendly
// column name ("Division"). Detect when a row is that friendly-name row so we can
// promote it to be the real header — that way the column-mapping screen shows the
// user's actual column name instead of the instruction sentence.
function isFriendlyHeaderRow(cells: (string | number | boolean | null)[]): boolean {
  const vals = cells
    .filter(c => c != null && String(c).trim() !== "")
    .map(c => String(c).trim().toLowerCase());
  if (vals.length < 2) return false; // too thin to be confident
  return vals.every(v => TEMPLATE_HEADER_LABELS.has(v));
}

// The template's instruction row always carries a hint marker (a leading "★" or
// an "(e.g." example). Requiring this signal on row 1 before promoting row 2
// ensures we never reclassify an arbitrary workbook whose real data happens to
// collide with friendly-label words.
function looksLikeHintRow(cells: (string | number | boolean | null)[]): boolean {
  return cells.some(c => {
    if (c == null) return false;
    const s = String(c).toLowerCase();
    return s.includes("★") || s.includes("(e.g");
  });
}

type Cell = string | number | boolean | null;

// Normalise one raw ExcelJS cell value into a plain scalar.
function normalizeCell(v: string | number | boolean | null | undefined): Cell {
  if (v == null) return null;
  if (typeof v === "object" && "richText" in (v as object)) {
    // In-cell formatting: {richText:[{text:"..."},…]} — join the fragments so
    // the value doesn't stringify to "[object Object]".
    const parts = (v as { richText: { text?: string }[] }).richText;
    return Array.isArray(parts) ? parts.map(p => p.text ?? "").join("") : null;
  }
  if (typeof v === "object" && "text" in (v as object)) return String((v as any).text);
  if (typeof v === "object" && "result" in (v as object)) return (v as any).result as number;
  if (typeof v === "object" && v !== null && Object.prototype.toString.call(v) === "[object Date]") return (v as unknown as Date).toISOString();
  return v as string | number | boolean;
}

const isBlankCell = (c: Cell) => c == null || String(c).trim() === "";
const looksNumeric = (c: Cell) =>
  typeof c === "number" ||
  (typeof c === "string" && c.trim() !== "" && !Number.isNaN(Number(c.replace(/[$,%\s]/g, ""))));

// Score how "header-like" a row is. Real headers are a wide row of mostly
// distinct, short TEXT labels with data lined up beneath them. Title banners and
// spacer rows have few populated cells; data rows are numeric-heavy; instruction
// rows are very long sentences — all score low.
function scoreHeaderRow(cells: Cell[], next?: Cell[]): number {
  const nonEmpty = cells.filter(c => !isBlankCell(c));
  if (nonEmpty.length < 2) return -1; // title / spacer row

  const strs        = nonEmpty.map(c => String(c).trim());
  const numericFrac = strs.filter(looksNumeric).length / strs.length;
  const longFrac    = strs.filter(s => s.length > 60).length / strs.length;
  const distinctFrac = new Set(strs.map(s => s.toLowerCase())).size / strs.length;

  // Data should line up beneath a header — reward a next row with a similar
  // number of populated cells.
  let alignment = 0.5;
  if (next) {
    const nextNonEmpty = next.filter(c => !isBlankCell(c)).length;
    alignment = Math.min(nextNonEmpty, nonEmpty.length) / nonEmpty.length;
  }

  return (
    nonEmpty.length * distinctFrac * (1 - numericFrac) *
    (1 - 0.5 * longFrac) * (0.5 + 0.5 * alignment)
  );
}

// Return the first row at or after `from` that has ≥2 non-empty cells.
// Sparse hint/instruction rows (often a single populated cell) are skipped so
// they don't penalise the alignment score of the real header row above them.
function findNextDense(allRows: Cell[][], from: number): Cell[] | undefined {
  for (let i = from; i < allRows.length; i++) {
    if (allRows[i]!.filter(c => !isBlankCell(c)).length >= 2) return allRows[i];
  }
  return undefined;
}

// Pick the most likely header row from the first several non-empty rows, so a
// title/marketing banner or blank spacer above the table doesn't get mistaken
// for the column headers.
function findHeaderRow(allRows: Cell[][]): number {
  const SCAN = Math.min(allRows.length, 15);
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < SCAN; i++) {
    // Use the next *dense* row for alignment — a single-cell hint/instruction
    // row immediately below real headers would otherwise drop their score.
    const score = scoreHeaderRow(allRows[i]!, findNextDense(allRows, i + 1));
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

// How many leading non-empty rows to buffer before locking in the header row.
// findHeaderRow only scans the first 15 candidates; the extra rows exist so
// alignment scoring (findNextDense) has dense data rows to look at even when
// several sparse hint/banner rows sit between the header and the table body.
const HEADER_DECIDE_BUFFER = 64;

// Incrementally builds one sheet's SheetData while rows stream in. Buffers
// only the first HEADER_DECIDE_BUFFER non-empty rows to run header detection
// (identical logic to the old full-load parser), then converts every later
// row to its PipelineRow object immediately — so raw cell arrays for the bulk
// of a big sheet are never retained.
//
// maxDataRows: when set, row OBJECTS are stored only up to this limit but every
// row is still counted for the totalRowCount tally (so callers get accurate
// row counts without retaining the full data set in memory).
class SheetAccumulator {
  private buffered: Cell[][] = [];
  private bufferedNums: number[] = [];
  private headerDecided = false;
  private columns: string[] = [];
  private rows: PipelineRow[] = [];
  private rowNums: number[] = [];
  // Tracks all non-blank data rows seen (post-header), regardless of maxDataRows.
  totalRowCount = 0;

  constructor(private sheetName: string, private maxDataRows?: number) {}

  push(cells: Cell[], rowNum: number): void {
    if (!this.headerDecided) {
      this.buffered.push(cells);
      this.bufferedNums.push(rowNum);
      if (this.buffered.length >= HEADER_DECIDE_BUFFER) this.decideHeader();
      return;
    }
    this.convertRow(cells, rowNum);
  }

  finish(): SheetData | null {
    if (!this.headerDecided) this.decideHeader();
    if (this.buffered.length === 0 && this.columns.length === 0) return null;
    if (!this.columns.some(c => c !== "")) return null;
    return { sheetName: this.sheetName, columns: this.columns, rows: this.rows, rowNums: this.rowNums };
  }

  private decideHeader(): void {
    this.headerDecided = true;
    if (this.buffered.length === 0) return;

    // Find the real header row — don't assume it's row 1 (clients often put a
    // title/logo/notes above the table).
    let headerIdx = findHeaderRow(this.buffered);

    // LEGACY two-row template: the chosen row may be the instruction-hint row,
    // with the friendly column-name row directly below it. Promote that row.
    if (
      headerIdx + 1 < this.buffered.length &&
      looksLikeHintRow(this.buffered[headerIdx]!) &&
      isFriendlyHeaderRow(this.buffered[headerIdx + 1]!)
    ) {
      headerIdx += 1;
    }

    this.columns = this.buffered[headerIdx]!.map(c => (c == null ? "" : String(c).trim()));

    for (let i = headerIdx + 1; i < this.buffered.length; i++) {
      this.convertRow(this.buffered[i]!, this.bufferedNums[i]!);
    }
    // Keep length>0 as the "sheet had content" marker for finish(); drop data.
    this.buffered = this.buffered.length > 0 ? [[]] : [];
    this.bufferedNums = [];
  }

  private convertRow(cells: Cell[], rowNum: number): void {
    if (cells.every(isBlankCell)) return;
    this.totalRowCount++;
    // When a row cap is set: count every row for the tally but only materialise
    // PipelineRow objects up to the limit — keeps peak memory bounded.
    if (this.maxDataRows != null && this.rows.length >= this.maxDataRows) return;
    const rowObj: PipelineRow = {};
    this.columns.forEach((col, idx) => {
      if (col) rowObj[col] = cells[idx] ?? null;
    });
    this.rows.push(rowObj);
    this.rowNums.push(rowNum);
  }
}

async function parseExcelStreaming(buffer: Buffer): Promise<SheetData[]> {
  // Streaming reader: one row of ExcelJS cell objects alive at a time.
  //  - sharedStrings "cache": required so string cells resolve to text.
  //  - styles "cache": required so date-formatted numbers arrive as Date
  //    objects (matching the old full-load behaviour) instead of raw serials.
  //  - hyperlinks/worksheets/entries: emit each worksheet as it appears in
  //    the zip archive (usually — but not guaranteed — workbook tab order;
  //    callers must match sheets by NAME, never by position).
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    sharedStrings: "cache",
    styles: "cache",
    hyperlinks: "ignore",
    worksheets: "emit",
    entries: "emit",
  });

  const sheets: SheetData[] = [];

  for await (const wsReader of reader) {
    // The streaming WorksheetReader exposes id/name, but the shipped typings
    // lag behind the runtime — hence the structural cast.
    const meta = wsReader as unknown as { id?: number; name?: string };
    const sheetName = (meta.name && String(meta.name).trim() !== "")
      ? String(meta.name)
      : `Sheet${meta.id ?? sheets.length + 1}`;

    // Feed every non-empty row (in order) into the accumulator as a normalised
    // cell array, with each row's REAL worksheet row number so downstream
    // "Source Row" references match what the user sees in Excel.
    const acc = new SheetAccumulator(sheetName);
    for await (const row of wsReader) {
      // row.values is 1-indexed — strip the leading undefined slot.
      const cells = (row.values as (string | number | boolean | null | undefined)[])
        .slice(1)
        .map(normalizeCell);
      if (cells.every(isBlankCell)) continue; // skip blank rows
      acc.push(cells, row.number);
    }

    const sheet = acc.finish();
    if (sheet) sheets.push(sheet);
  }

  return sheets;
}

/**
 * Memory-efficient preview: streams the workbook but stores at most
 * HEADER_DECIDE_BUFFER + PREVIEW_ROWS row objects per sheet (enough for
 * header detection + the 5-row preview). All rows are still counted so
 * `totalRows` is accurate even for 65k-row files.
 *
 * Previously this called parseExcel() which retained every PipelineRow
 * object for all sheets simultaneously — ~150-400 MB for a 65k-row file —
 * before discarding everything beyond the first 5 rows.
 */
const PREVIEW_ROWS = 5;

async function previewExcelStreaming(buffer: Buffer): Promise<{
  sheetName: string;
  columns: string[];
  preview: PipelineRow[];
  totalRows: number;
}[]> {
  // Store at most this many data-row objects per sheet. Header detection
  // needs HEADER_DECIDE_BUFFER rows; the preview needs PREVIEW_ROWS on top.
  // Every additional row is counted but not materialised.
  const MAX_STORED = HEADER_DECIDE_BUFFER + PREVIEW_ROWS;

  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    sharedStrings: "cache",
    styles: "cache",
    hyperlinks: "ignore",
    worksheets: "emit",
    entries: "emit",
  });

  const results: { sheetName: string; columns: string[]; preview: PipelineRow[]; totalRows: number }[] = [];

  for await (const wsReader of reader) {
    const meta = wsReader as unknown as { id?: number; name?: string };
    const sheetName = (meta.name && String(meta.name).trim() !== "")
      ? String(meta.name)
      : `Sheet${meta.id ?? results.length + 1}`;

    const acc = new SheetAccumulator(sheetName, MAX_STORED);
    for await (const row of wsReader) {
      const cells = (row.values as (string | number | boolean | null | undefined)[])
        .slice(1)
        .map(normalizeCell);
      if (cells.every(isBlankCell)) continue;
      acc.push(cells, row.number);
    }

    const sheet = acc.finish();
    if (!sheet) continue;
    results.push({
      sheetName: sheet.sheetName,
      columns:   sheet.columns,
      preview:   sheet.rows.slice(0, PREVIEW_ROWS),
      totalRows: acc.totalRowCount,
    });
  }

  return results;
}

// ── Entry-order race fallback ────────────────────────────────────────────────
// exceljs's streaming reader resolves each worksheet's name from
// `this.model.sheets`, which only exists once `xl/workbook.xml` has been
// parsed (workbook-reader.js:303 reads it null-unsafely). Excel writes
// workbook.xml near the start of the archive, but SheetJS-generated files
// (and exports from various SaaS tools) place it AFTER the worksheet entries.
// Whether a worksheet entry is processed before the workbook entry then
// depends on stream-chunk timing, so the SAME file can parse fine one attempt
// and throw "Cannot read properties of undefined (reading 'sheets')" the next.
//
// Strategy: retry the stream once (the race is timing-dependent), then fall
// back to the full-DOM loader for SMALL files only — it reads via the zip
// central directory and is immune to entry order, but needs ~5-10x the file
// size in RAM (see the header warning), so bigger files rethrow the original
// error loudly instead of risking an OOM.
const ENTRY_ORDER_MSG = /reading 'sheets'/i;
const FULL_LOAD_MAX_BYTES = 20 * 1024 * 1024; // 20 MB — matches the no-S3 upload cap

async function withEntryOrderFallback<T>(
  buffer: Buffer,
  label: string,
  streaming: () => Promise<T>,
  fullLoad: () => Promise<T>,
): Promise<T> {
  try { return await streaming(); }
  catch (e1: any) {
    if (!ENTRY_ORDER_MSG.test(String(e1?.message ?? e1))) throw e1;
    console.warn(`[excel] ${label}: streaming reader hit the workbook.xml entry-order race — retrying once`);
    try { return await streaming(); }
    catch (e2: any) {
      if (!ENTRY_ORDER_MSG.test(String(e2?.message ?? e2))) throw e2;
      if (buffer.length > FULL_LOAD_MAX_BYTES) {
        console.error(`[excel] ${label}: entry-order race persisted and the file is too large (${buffer.length} bytes) for the full-DOM fallback — rethrowing`);
        throw e2;
      }
      console.warn(`[excel] ${label}: entry-order race persisted — re-reading with the order-immune full-DOM loader (${buffer.length} bytes)`);
      return await fullLoad();
    }
  }
}

// Full-DOM variant — ONLY reachable through withEntryOrderFallback's ≤20 MB
// gate. Semantics mirror the streaming path exactly: same normalizeCell, same
// blank-row skip, same SheetAccumulator header logic, real worksheet row
// numbers. Returns the accumulator's total row tally alongside each sheet so
// the preview wrapper can report accurate totalRows past the storage cap.
async function fullLoadSheets(
  buffer: Buffer,
  maxStored?: number,
): Promise<Array<{ sheet: SheetData; totalRows: number }>> {
  const wb = new ExcelJS.Workbook();
  // Node 22 types Buffer as Buffer<ArrayBufferLike>, which no longer satisfies
  // exceljs's older Buffer signature — runtime accepts a Node Buffer fine.
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const out: Array<{ sheet: SheetData; totalRows: number }> = [];
  for (const ws of wb.worksheets) {
    const sheetName = (ws.name && String(ws.name).trim() !== "")
      ? String(ws.name)
      : `Sheet${ws.id ?? out.length + 1}`;
    const acc = new SheetAccumulator(sheetName, maxStored);
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells = (row.values as (string | number | boolean | null | undefined)[])
        .slice(1)
        .map(normalizeCell);
      if (cells.every(isBlankCell)) return;
      acc.push(cells, rowNumber);
    });
    const sheet = acc.finish();
    if (sheet) out.push({ sheet, totalRows: acc.totalRowCount });
  }
  return out;
}

export function parseExcel(buffer: Buffer): Promise<SheetData[]> {
  return withEntryOrderFallback(
    buffer,
    "parseExcel",
    () => parseExcelStreaming(buffer),
    async () => (await fullLoadSheets(buffer)).map(r => r.sheet),
  );
}

export function previewExcel(buffer: Buffer): ReturnType<typeof previewExcelStreaming> {
  return withEntryOrderFallback(
    buffer,
    "previewExcel",
    () => previewExcelStreaming(buffer),
    async () => {
      const MAX_STORED = HEADER_DECIDE_BUFFER + PREVIEW_ROWS;
      return (await fullLoadSheets(buffer, MAX_STORED)).map(r => ({
        sheetName: r.sheet.sheetName,
        columns:   r.sheet.columns,
        preview:   r.sheet.rows.slice(0, PREVIEW_ROWS),
        totalRows: r.totalRows,
      }));
    },
  );
}
