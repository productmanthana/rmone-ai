/**
 * Deterministic per-column value profiling for the Data Cleaning engine.
 *
 * No AI here — pure regex/statistics computed over the column's values.
 * The resulting "fingerprint" travels with the header into the whole-sheet
 * AI planning call, so the model judges columns by what the DATA looks like,
 * never by the header name alone. Also detects "wide" layouts: runs of
 * consecutive date-like headers (week-by-week hours grids).
 */
import type { PipelineRow } from "../pipeline.js";
import { parseTolerantNumber } from "../pipeline.js";

export interface ColumnFingerprint {
  header: string;
  /** Share of sheet rows with a non-blank value in this column (0..1). */
  fill: number;
  /** Distinct non-blank values / non-blank count (0..1). */
  distinctRatio: number;
  pctDate: number;
  pctNumeric: number;
  pctCurrencyHint: number;
  pctEmail: number;
  pctPersonName: number;
  pctProjectId: number;
  headerIsDate: boolean;
  samples: string[];
}

type Cell = string | number | boolean | null;

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// "John Smith", "Mary-Anne O'Neil", "Smith, John" — 2..4 capitalised words, no digits.
const PERSON_RE = /^[A-Z][a-zA-Z'’.-]*(?:,)?(?:\s+[A-Z][a-zA-Z'’.-]*){1,3}$/;
// "PMM-22-000598", "CPR16_002368", "P-1042" — short letter prefix + digits.
const PROJECT_ID_RE = /^[A-Za-z]{1,6}[-_ ]?\d{2,}(?:[-_]\d+)*$/;

function isBlank(v: Cell): boolean {
  return v == null || String(v).trim() === "";
}

function looksDate(v: Cell): boolean {
  if (typeof v === "number") return v > 20000 && v < 80000;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return true;
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(s)) return true;
  if (/[a-z]/i.test(s) && !Number.isNaN(Date.parse(s)) && /\d/.test(s)) return true;
  return false;
}

function looksNumeric(v: Cell): boolean {
  if (typeof v === "number") return true;
  // Shared tolerant coercer — recognizes "$1.2M", "3 Cr", "(1,200)",
  // "fifty percent" etc. so such columns profile as numeric, matching what
  // the cleaning step (toNumber) and import pipeline will actually accept.
  return parseTolerantNumber(String(v)) != null;
}

function currencyHint(v: Cell): boolean {
  const s = String(v).trim();
  return /[$€£]/.test(s) || /^\(?\d{1,3}(,\d{3})+(\.\d+)?\)?$/.test(s);
}

export function fingerprintColumn(header: string, rows: PipelineRow[], col: string): ColumnFingerprint {
  const values: Cell[] = [];
  for (const r of rows) {
    const v = (r[col] ?? null) as Cell;
    if (!isBlank(v)) values.push(v);
    if (values.length >= 200) break;   // profile on a bounded sample
  }
  const total = Math.min(rows.length, 200) || 1;
  const n = values.length || 1;

  let dates = 0, nums = 0, cur = 0, emails = 0, persons = 0, projIds = 0;
  const distinct = new Set<string>();
  for (const v of values) {
    const s = String(v).trim();
    distinct.add(s.toLowerCase());
    if (looksDate(v)) dates++;
    if (looksNumeric(v)) nums++;
    if (currencyHint(v)) cur++;
    if (EMAIL_RE.test(s)) emails++;
    if (!/\d/.test(s) && PERSON_RE.test(s)) persons++;
    if (PROJECT_ID_RE.test(s)) projIds++;
  }

  const samples: string[] = [];
  for (const v of values) {
    const s = String(v).trim().slice(0, 60);
    if (!samples.includes(s)) samples.push(s);
    if (samples.length >= 5) break;
  }

  return {
    header,
    fill: values.length / total,
    distinctRatio: distinct.size / n,
    pctDate: dates / n,
    pctNumeric: nums / n,
    pctCurrencyHint: cur / n,
    pctEmail: emails / n,
    pctPersonName: persons / n,
    pctProjectId: projIds / n,
    headerIsDate: headerToIsoDate(header) != null,
    samples,
  };
}

/** Compact one-line description for the AI prompt. */
export function describeFingerprint(fp: ColumnFingerprint): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const parts: string[] = [`fill ${pct(fp.fill)}`];
  if (fp.pctDate >= 0.5) parts.push(`${pct(fp.pctDate)} dates`);
  if (fp.pctEmail >= 0.5) parts.push(`${pct(fp.pctEmail)} emails`);
  else if (fp.pctPersonName >= 0.5) parts.push(`${pct(fp.pctPersonName)} person-name-like`);
  if (fp.pctProjectId >= 0.5) parts.push(`${pct(fp.pctProjectId)} code/ID-like`);
  if (fp.pctNumeric >= 0.5 && fp.pctDate < 0.5) {
    parts.push(fp.pctCurrencyHint >= 0.3 ? `${pct(fp.pctNumeric)} numeric (currency-formatted)` : `${pct(fp.pctNumeric)} numeric`);
  }
  parts.push(fp.distinctRatio >= 0.9 ? "all values unique" : fp.distinctRatio <= 0.15 ? "few repeated values" : `${pct(fp.distinctRatio)} unique`);
  return parts.join(", ");
}

/**
 * Parse a HEADER string as a date (weekly-hours grid columns).
 * Handles Excel serials, ISO, US m/d/y, month-name forms, and month/day
 * without a year (fallbackYear applied — caller notes the assumption).
 */
export function headerToIsoDate(header: string, fallbackYear?: number): string | null {
  const s = String(header).trim();
  if (!s) return null;
  // Excel serial that arrived as header text
  if (/^\d{5}$/.test(s)) {
    const num = Number(s);
    if (num > 20000 && num < 80000) {
      return new Date(EXCEL_EPOCH_MS + num * 86400000).toISOString().slice(0, 10);
    }
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (us) {
    let yr = Number(us[3]); if (yr < 100) yr += yr < 50 ? 2000 : 1900;
    const mo = Number(us[1]), da = Number(us[2]);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      return `${yr}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
    }
  }
  // "Jan 6, 2025" / "6-Jan-2025" / "Week of 1/6/2025"
  if (/[a-z]/i.test(s) && /\d/.test(s)) {
    const cleaned = s.replace(/^(week|wk|w\/?e|week of|w\/o)\s*[:.]?\s*/i, "");
    const parsed = Date.parse(cleaned);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  }
  // "1/6" month/day without year
  const md = s.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (md && fallbackYear) {
    const mo = Number(md[1]), da = Number(md[2]);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      return `${fallbackYear}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
    }
  }
  return null;
}

export interface WideRun {
  id: string;            // "R0", "R1"…
  headers: string[];     // the source headers, in sheet order
  firstIso: string;
  lastIso: string;
  yearAssumed: boolean;  // headers had no year — fallback year applied
}

/**
 * Detect runs of ≥4 consecutive date-like headers whose values are mostly
 * numeric — a wide week-by-week (or month-by-month) hours grid.
 */
export function detectWideDateRuns(columns: string[], rows: PipelineRow[]): WideRun[] {
  const nowYear = new Date().getFullYear();
  const dateLike = columns.map(h =>
    headerToIsoDate(h) != null || /^(\d{1,2})[/-](\d{1,2})$/.test(String(h).trim()));

  const numericEnough = (col: string): boolean => {
    let nonBlank = 0, numeric = 0;
    for (const r of rows) {
      const v = r[col];
      if (v == null || String(v).trim() === "") continue;
      nonBlank++;
      if (looksNumeric(v as Cell)) numeric++;
      if (nonBlank >= 50) break;
    }
    return nonBlank === 0 || numeric / nonBlank >= 0.6;
  };

  const runs: WideRun[] = [];
  let start = -1;
  const flush = (end: number) => {
    if (start < 0) return;
    const len = end - start;
    if (len >= 4) {
      const headers = columns.slice(start, end);
      if (headers.every(numericEnough)) {
        let yearAssumed = false;
        const isoOf = (h: string) => {
          const strict = headerToIsoDate(h);
          if (strict) return strict;
          yearAssumed = true;
          return headerToIsoDate(h, nowYear);
        };
        const firstIso = isoOf(headers[0]!);
        const lastIso = isoOf(headers[headers.length - 1]!);
        if (firstIso && lastIso) {
          runs.push({ id: `R${runs.length}`, headers, firstIso, lastIso, yearAssumed });
        }
      }
    }
    start = -1;
  };
  for (let i = 0; i < columns.length; i++) {
    if (dateLike[i] && columns[i]!.trim() !== "") {
      if (start < 0) start = i;
    } else {
      flush(i);
    }
  }
  flush(columns.length);
  return runs;
}
