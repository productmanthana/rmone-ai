/**
 * Data Cleaning Assistant — deterministic engine.
 *
 * Takes a messy client workbook and produces a cleaned .xlsx in the EXACT
 * import-page template format (our sheet names + our column labels, never the
 * client's). Deterministic code does the heavy lifting (header mapping via
 * synonyms, value formatting, duplicate removal, cross-tab Project ID checks);
 * Claude Opus handles only unmapped-header judgment calls on tiny samples.
 *
 * Cross-referencing NEVER guesses: a Project ID is assigned only when the
 * project name matches exactly one project (whitespace/case-insensitive).
 * An exact-title match beats a punctuation-variant match. Ambiguous or
 * unmatched rows are MOVED out of the main tab into a per-tab review sheet
 * ("<Tab> — Review") that mirrors the tab's exact columns plus a final
 * "Remarks" column, so the user can fix the cell and copy the row (minus
 * Remarks) straight back into the main tab.
 *
 * NEVER writes to any database. Output = cleaned workbook + per-tab review
 * sheets + a machine-readable report the chat endpoint uses as context.
 */
import ExcelJS from "exceljs";
import fs from "fs";
import os from "os";
import path from "path";
import sql from "mssql";
import { parseExcel } from "../excel.js";
import type { SheetData, PipelineRow } from "../pipeline.js";
import { parseTolerantNumber, isEmptySentinel, normalizeTicketId } from "../pipeline.js";
import { getPool } from "../db.js";
import { writeStatus, saveResult, type DcStatus, type DcSummary } from "./store.js";
import {
  TEMPLATE_COLS, SHEET_NAME, REQUIRED_ID, normKey,
  matchHeader, classifySheet, templateLabels, colKind, catalogForPrompt,
  type ModuleId,
} from "./template.js";
import {
  aiMapColumns, aiPlanSheet, CONFIDENCE_FLOOR,
  type PlanColumnInput, type PlanSeriesInput,
} from "./ai.js";
import { anthropicConfigured } from "../anthropic.js";
import {
  fingerprintColumn, describeFingerprint, detectWideDateRuns, type WideRun,
} from "./profile.js";
import { loadLearnedMappings, type LearnedTarget } from "./learned.js";
import { splitSheet, unpivotWide, type WorkUnit, type ModuleAssignment } from "./executors.js";

// Session state (status/report/cleaned file) is persisted in the app-owned
// S3 bucket via ./store.js — shared across both cluster workers.

// ── Report shapes ────────────────────────────────────────────────────────────

export interface ColumnMapEntry {
  source: string;
  target: string | null;      // null = dropped (no safe mapping)
  /** "exact" | "synonym" | "learned" | "ai" | "unmapped" | "unpivot" | "split-carry" */
  method: string;
}

export interface ReviewItem {
  sheet: string;              // OUTPUT sheet name
  row: number;                // 1-based data row in the SOURCE sheet
  issue: string;              // short problem name
  detail: string;             // plain language: what we found and what we did
  action: string;             // plain language: what the user should do
  level: "fix" | "check" | "info";
  record: string;             // short human identifier for the affected row
  data: string;               // compact preview of the original row
}

export interface SheetReport {
  sourceSheet: string;
  module: ModuleId | null;
  targetSheet: string | null;
  totalRows: number;
  cleanRows: number;
  columnMap: ColumnMapEntry[];
  fixes: { dates: number; numbers: number; emails: number; trimmed: number; idsFilled: number };
  duplicates: { exactRemoved: number; conflictsResolved: number };
  crossRef?: { resolvedInFile: number; resolvedByAi: number; resolvedInDb: number; unresolved: number };
  /** Plain-language description of what one source row represents (v2 plan). */
  grain?: string | null;
  notes: string[];
}

/**
 * A data-bearing source column that could not be mapped to any template
 * column and was therefore left out of the cleaned file. Surfaced in the
 * import grid so the user can pick the right destination and re-clean —
 * silent data loss is never acceptable.
 */
export interface DroppedColumn {
  sourceSheet: string;        // sheet name in the user's original file
  tab: string;                // OUTPUT tab the rest of the sheet landed on
  module: ModuleId;
  header: string;             // the source column header
  samples: string[];          // up to 5 example values
  rows: number;               // how many rows have data in this column
}

export interface CleaningReport {
  sessionId: string;
  fileName: string;
  tenantId: string;
  startedAt: string;
  finishedAt: string;
  sheets: SheetReport[];
  reviewCount: number;
  reviewByIssue: Record<string, number>;
  /** Full review items (capped) so the frontend can render the detail view. */
  review: ReviewItem[];
  /** Data-bearing columns left out of the cleaned file (capped per sheet). */
  droppedColumns?: DroppedColumn[];
  aiCalls: number;
  notes: string[];
}

/** A user-confirmed mapping applied on re-clean: absolute, beats the AI. */
export interface CleanOverride {
  sheet: string;              // source sheet name (as in DroppedColumn.sourceSheet)
  header: string;             // source column header
  module: ModuleId;
  target: string;             // template column label
}

// ── Value cleaning ───────────────────────────────────────────────────────────

type Cell = string | number | boolean | null;

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function toIsoDate(v: Cell): { value: string | null; fixed: boolean; bad: boolean } {
  if (v == null || String(v).trim() === "") return { value: null, fixed: false, bad: false };
  // Excel serial number
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const dt = new Date(EXCEL_EPOCH_MS + Math.round(v) * 86400000);
    return { value: dt.toISOString().slice(0, 10), fixed: true, bad: false };
  }
  const s = String(v).trim();
  // Already ISO (or ISO datetime from ExcelJS date cells)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { value: iso[0], fixed: s.length > 10, bad: false };
  // US-style M/D/YYYY or M-D-YYYY (import template + client files are US)
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (us) {
    let [, m, d, y] = us as unknown as [string, string, string, string];
    let yr = Number(y); if (yr < 100) yr += yr < 50 ? 2000 : 1900;
    const mo = Number(m), da = Number(d);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      return { value: `${yr}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`, fixed: true, bad: false };
    }
  }
  // "Jan 5, 2026" / "5 January 2026" style
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed) && /[a-z]/i.test(s)) {
    return { value: new Date(parsed).toISOString().slice(0, 10), fixed: true, bad: false };
  }
  return { value: s, fixed: false, bad: true };
}

function toNumber(v: Cell): { value: number | null; fixed: boolean; bad: boolean } {
  if (v == null || String(v).trim() === "") return { value: null, fixed: false, bad: false };
  if (typeof v === "number") return { value: v, fixed: false, bad: false };
  const s = String(v).trim();
  // Shared tolerant coercer (pipeline.ts): "$1.2M", "₹12,34,567", "3 Cr",
  // "(1,200)", "fifty percent", trailing currency codes, "N/A"/"TBD" → null.
  if (isEmptySentinel(s)) return { value: null, fixed: true, bad: false };
  const num = parseTolerantNumber(s);
  if (num != null) {
    return { value: num, fixed: String(num) !== s, bad: false };
  }
  return { value: null, fixed: false, bad: true };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toEmail(v: Cell): { value: string | null; fixed: boolean; bad: boolean } {
  if (v == null || String(v).trim() === "") return { value: null, fixed: false, bad: false };
  const s = String(v).trim().toLowerCase();
  if (EMAIL_RE.test(s)) return { value: s, fixed: s !== String(v), bad: false };
  return { value: String(v).trim(), fixed: false, bad: true };
}

function toText(v: Cell): { value: string | null; fixed: boolean } {
  if (v == null) return { value: null, fixed: false };
  const s = String(v);
  const t = s.replace(/\s+/g, " ").trim();
  return { value: t === "" ? null : t, fixed: t !== s && t !== "" };
}

/** Short human identifier for a row, e.g. `Project Title: X | Project ID: Y`. */
const RECORD_LABEL_FIELDS: Record<string, string[]> = {
  projects:      ["Project Title", "Project ID", "Company Name"],
  assignments:   ["Name", "Email", "Project", "Project ID"],
  schedule:      ["Project ID", "Project Title", "Phase Name"],
  team:          ["Full Name", "Login Email"],
  opportunities: ["Opportunity Title", "Opportunity ID", "Company Name"],
  leads:         ["Lead Name", "Lead ID"],
  companies:     ["Company Name"],
};

/** Human-friendly cell value: ISO datetimes become plain dates. */
function prettyVal(v: Cell): string {
  const s = String(v).trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})T\d{2}:/);
  return (iso ? iso[1]! : s).slice(0, 60);
}

function recordLabel(mod: ModuleId, cleaned: Record<string, Cell> | null, src: PipelineRow): string {
  const parts: string[] = [];
  if (cleaned) {
    for (const f of RECORD_LABEL_FIELDS[mod] ?? []) {
      const v = cleaned[f];
      if (v != null && String(v).trim() !== "") {
        parts.push(`${f}: ${prettyVal(v)}`);
        if (parts.length >= 2) break;
      }
    }
  }
  if (!parts.length) {
    for (const [k, v] of Object.entries(src)) {
      if (v == null || String(v).trim() === "") continue;
      parts.push(`${k}: ${prettyVal(v)}`);
      if (parts.length >= 2) break;
    }
  }
  return parts.join("  |  ") || "(empty row)";
}

function rowPreview(row: PipelineRow, max = 160): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (v == null || String(v).trim() === "") continue;
    parts.push(`${k}=${String(v).slice(0, 30)}`);
    if (parts.join(" | ").length > max) break;
  }
  return parts.join(" | ").slice(0, max);
}

// ── DB existence check (READ-ONLY, optional) ────────────────────────────────

async function dbProjectRefsExist(tenantId: string, refs: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (!refs.length) return found;
  try {
    const pool = await getPool();
    for (let i = 0; i < refs.length; i += 50) {
      const chunk = refs.slice(i, i + 50);
      const req = pool.request().input("tid", sql.NVarChar, tenantId);
      const params = chunk.map((r, j) => { req.input(`r${j}`, sql.NVarChar, r); return `@r${j}`; }).join(",");
      // REPLACE(TicketId,' ','') bridges legacy space-carrying rows
      // ("LEM- 000220") so a cleaned ref ("LEM-000220") still resolves.
      const q = await req.query(`
        SELECT TicketId, Title FROM core2.dbo.PMM
          WHERE TenantID=@tid AND Deleted=0 AND (TicketId IN (${params}) OR REPLACE(TicketId, ' ', '') IN (${params}) OR Title IN (${params}))
        UNION ALL
        SELECT TicketId, Title FROM core2.dbo.Opportunity
          WHERE TenantID=@tid AND Deleted=0 AND (TicketId IN (${params}) OR REPLACE(TicketId, ' ', '') IN (${params}) OR Title IN (${params}))`);
      for (const rec of q.recordset as { TicketId: string; Title: string }[]) {
        found.add(normKey(String(rec.TicketId)));
        found.add(normKey(normalizeTicketId(rec.TicketId)));
        found.add(normKey(String(rec.Title)));
      }
    }
  } catch (e) {
    console.warn("[data-cleaning] DB cross-check skipped:", e instanceof Error ? e.message : String(e));
  }
  return found;
}

// ── v2 sheet planning ────────────────────────────────────────────────────────

const CHILD_MODULES: ReadonlySet<ModuleId> = new Set(["assignments", "schedule"] as ModuleId[]);

const emptyFixes = () => ({ dates: 0, numbers: 0, emails: 0, trimmed: 0, idsFilled: 0 });

// ── Row-level record-type routing ────────────────────────────────────────────
// A sheet can mix project / opportunity / lead ROWS distinguished by a "Type"
// column. Routing is purely deterministic — the discriminator VALUES must be
// unambiguous record-type words; anything else goes to Review, never guessed.

const ROUTABLE: ReadonlySet<ModuleId> = new Set(["projects", "opportunities", "leads"] as ModuleId[]);

/** normKey(cell value) → the tab those rows belong on. */
const ROW_TYPE_TOKENS: Record<string, ModuleId> = {
  project: "projects", projects: "projects", prj: "projects", pmm: "projects",
  job: "projects", jobs: "projects",
  opportunity: "opportunities", opportunities: "opportunities",
  opp: "opportunities", opps: "opportunities", opm: "opportunities",
  pursuit: "opportunities", pursuits: "opportunities",
  lead: "leads", leads: "leads", lem: "leads",
  prospect: "leads", prospects: "leads",
};

/** Same-concept template labels across the three record-type tabs. */
const CONCEPT_LABELS: Partial<Record<ModuleId, string>>[] = [
  { projects: "Project ID",     opportunities: "Opportunity ID",        leads: "Lead ID" },
  { projects: "Project Title",  opportunities: "Opportunity Title",     leads: "Lead Name" },
  { projects: "Contract Value", opportunities: "Approx Contract Value", leads: "Est. Contract Value" },
  { projects: "Start Date",     opportunities: "Forecast Start",        leads: "Forecast Start" },
  { projects: "End Date",       opportunities: "Forecast End",          leads: "Forecast End" },
  { projects: "Category",       opportunities: "Project Category" },
];

function translateLabel(from: ModuleId, label: string, to: ModuleId): string | null {
  for (const c of CONCEPT_LABELS) if (c[from] === label) return c[to] ?? null;
  return null;
}

/**
 * Find the row-type discriminator column, if any. Strict on purpose:
 *  - the HEADER must look like a discriminator (contains type/kind/record/
 *    entity) — a "Source"/"Origin" column saying "Lead" means "converted FROM
 *    a lead", not "IS a lead", and must never trigger routing;
 *  - ≥80% of non-blank values must be recognized record-type words;
 *  - at least one row must route AWAY from the sheet's primary module.
 * Blank values stay with the primary module (that is what the sheet IS);
 * unrecognized values are surfaced per-row as "unknown" → Review.
 */
function detectRowTypeColumn(
  primary: ModuleId,
  scalarCols: string[],
  rows: PipelineRow[],
): { col: string; perRow: (ModuleId | "unknown" | null)[] } | null {
  let best: { col: string; perRow: (ModuleId | "unknown" | null)[]; frac: number } | null = null;
  for (const col of scalarCols) {
    if (!/type|kind|record|entity/i.test(col)) continue;
    let nonBlank = 0, recognized = 0, foreign = 0;
    const perRow: (ModuleId | "unknown" | null)[] = rows.map(r => {
      const v = r[col];
      if (v == null || String(v).trim() === "") return null;
      nonBlank++;
      const mod = ROW_TYPE_TOKENS[normKey(String(v))];
      if (!mod) return "unknown";
      recognized++;
      if (mod !== primary) foreign++;
      return mod;
    });
    if (nonBlank < 2 || !foreign) continue;
    const frac = recognized / nonBlank;
    if (frac < 0.8) continue;
    if (!best || frac > best.frac) best = { col, perRow, frac };
  }
  return best ? { col: best.col, perRow: best.perRow } : null;
}

/** A source row held back at planning time — lands on "<Tab> — Review". */
interface HeldRow {
  module: ModuleId;
  srcRow: PipelineRow;
  srcRowNum: number;
  /** src column → template label of `module` (raw values, no cleaning). */
  mapped: Map<string, string>;
  remarks: string;
}

interface PlanOutcome {
  units: WorkUnit[];
  skipped?: SheetReport;   // set when the sheet produced no units
  held?: HeldRow[];        // rows quarantined at planning time
  aiCalls: number;
}

/**
 * Plan ONE source sheet into cleanable work units (v2):
 *   pin exact-label + learned columns → profile every column's VALUES →
 *   ONE whole-sheet AI planning call → validate → deterministic executors
 *   (split mixed sheets, unpivot weekly-hours grids).
 * Falls back to the deterministic v1 path when the AI is unavailable or the
 * plan is unusable, so cleaning always completes. Ambiguous data-bearing
 * columns are NEVER guessed — they go to the review list.
 */
async function planSheetUnits(
  sheet: SheetData,
  learned: Map<string, LearnedTarget[]>,
  catalog: string,
  review: ReviewItem[],
  dropped: DroppedColumn[],
  overrides: CleanOverride[] = [],
): Promise<PlanOutcome> {
  const srcCols = sheet.columns.filter(Boolean);
  const rowNums = sheet.rows.map((_, i) => sheet.rowNums?.[i] ?? i + 1);
  /** User-confirmed mapping for a column of THIS sheet (re-clean flow). */
  const ovFor = (col: string): CleanOverride | undefined => overrides.find(o =>
    o.sheet.trim().toLowerCase() === sheet.sheetName.trim().toLowerCase() &&
    (o.header === col || normKey(o.header) === normKey(col)));
  const skippedReport = (notes: string[]): SheetReport => ({
    sourceSheet: sheet.sheetName, module: null, targetSheet: null,
    totalRows: sheet.rows.length, cleanRows: 0,
    columnMap: [], fixes: emptyFixes(),
    duplicates: { exactRemoved: 0, conflictsResolved: 0 }, notes,
  });

  // Review sheets from a previously cleaned file hold quarantined rows —
  // never re-process them (mirrors the classifySheet guard; must stay ahead
  // of ALL AI analysis).
  if (/[—–-]\s*review\s*$/i.test(sheet.sheetName.trim())) {
    return {
      units: [], aiCalls: 0,
      skipped: skippedReport([
        `"${sheet.sheetName}" looks like a review sheet from a previous cleaning run — skipped so held-back rows are not merged into the clean output.`,
      ]),
    };
  }
  if (!srcCols.length || !sheet.rows.length) {
    return { units: [], aiCalls: 0, skipped: skippedReport(["Sheet is empty — skipped."]) };
  }

  const tabHint = classifySheet(sheet.sheetName, srcCols);

  // Wide date-column runs (week-by-week hours grids) — detected
  // deterministically; each run is planned as ONE unit, never per-column.
  const runs = detectWideDateRuns(srcCols, sheet.rows);
  const runCols = new Set(runs.flatMap(r => r.headers));
  const scalarCols = srcCols.filter(c => !runCols.has(c));
  const runLabel = (run: WideRun) =>
    `"${run.headers[0]}" … "${run.headers[run.headers.length - 1]}" (${run.headers.length} date columns)`;

  const fps = new Map(scalarCols.map(c => [c, fingerprintColumn(c, sheet.rows, c)] as const));

  // Deterministic pins: exact template-label matches, then learned aliases
  // from previous user-confirmed imports. Pins are handed to the AI as fixed.
  const modIds = Object.keys(TEMPLATE_COLS) as ModuleId[];
  const pinned = new Map<string, { module: ModuleId; target: string; method: "exact" | "learned" }>();
  const pinTaken = new Set<string>();
  for (const col of scalarCols) {
    const key = normKey(col);
    if (!key) continue;
    let pick: { module: ModuleId; target: string; method: "exact" | "learned" } | null = null;
    const exactMods = modIds.filter(m => TEMPLATE_COLS[m].some(c => normKey(c.label) === key));
    if (exactMods.length === 1 || (tabHint && exactMods.includes(tabHint))) {
      const m = exactMods.length === 1 ? exactMods[0]! : tabHint!;
      pick = { module: m, target: TEMPLATE_COLS[m].find(c => normKey(c.label) === key)!.label, method: "exact" };
    } else if (!exactMods.length) {
      const cands = learned.get(key) ?? [];
      const scoped = tabHint ? cands.filter(c => c.module === tabHint) : [];
      const use = scoped.length === 1 ? scoped[0]! : cands.length === 1 ? cands[0]! : null;
      if (use) pick = { module: use.module, target: use.target, method: "learned" };
    }
    if (pick) {
      const tkey = `${pick.module}|${pick.target}`;
      if (!pinTaken.has(tkey)) { pinTaken.add(tkey); pinned.set(col, pick); }
    }
  }

  // ONE whole-sheet AI planning call (headers + samples + value profiles +
  // the full template catalog), keyed by column index.
  let aiCalls = 0;
  let plan: Awaited<ReturnType<typeof aiPlanSheet>> = null;
  if (anthropicConfigured()) {
    const planCols: PlanColumnInput[] = scalarCols.map((c, idx) => {
      const fp = fps.get(c)!;
      const input: PlanColumnInput = { i: idx, header: c, samples: fp.samples, profile: describeFingerprint(fp) };
      const pin = pinned.get(c);
      if (pin) input.pinned = { module: pin.module, target: pin.target };
      return input;
    });
    const planSeries: PlanSeriesInput[] = runs.map(r => ({
      id: r.id, count: r.headers.length,
      first: r.headers[0]!, last: r.headers[r.headers.length - 1]!,
    }));
    aiCalls++;
    plan = await aiPlanSheet({ sheetName: sheet.sheetName, tabHint, catalog, columns: planCols, series: planSeries });
  }

  // ── Fallback: deterministic v1 path (AI unavailable or plan unusable) ──
  if (!plan) {
    if (!tabHint) {
      return {
        units: [], aiCalls,
        skipped: skippedReport([
          "Sheet could not be identified as any import template tab — skipped. Ask me about it if it contains real data.",
        ]),
      };
    }
    const columnMap: ColumnMapEntry[] = [];
    const mapped = new Map<string, string>();
    const taken = new Set<string>();
    const unknown: { header: string; samples: string[] }[] = [];
    for (const col of srcCols) {
      const ov = ovFor(col);
      if (ov && !taken.has(ov.target)) {
        mapped.set(col, ov.target); taken.add(ov.target);
        columnMap.push({ source: col, target: ov.target, method: "user" });
        continue;
      }
      const hit = matchHeader(tabHint, col);
      if (hit && !taken.has(hit)) {
        mapped.set(col, hit); taken.add(hit);
        columnMap.push({ source: col, target: hit, method: normKey(col) === normKey(hit) ? "exact" : "synonym" });
      } else if (hit) {
        columnMap.push({ source: col, target: null, method: "unmapped" });
      } else {
        const samples = sheet.rows.slice(0, 30)
          .map(r => r[col]).filter(v => v != null && String(v).trim() !== "")
          .slice(0, 5).map(v => String(v));
        unknown.push({ header: col, samples });
      }
    }
    if (unknown.length && anthropicConfigured()) {
      aiCalls++;
      const aiMap = await aiMapColumns(
        SHEET_NAME[tabHint], templateLabels(tabHint).filter(l => !taken.has(l)), unknown);
      for (const u of unknown) {
        const target = aiMap[u.header];
        if (target && !taken.has(target)) {
          mapped.set(u.header, target); taken.add(target);
          columnMap.push({ source: u.header, target, method: "ai" });
        } else {
          columnMap.push({ source: u.header, target: null, method: "unmapped" });
        }
      }
    } else {
      for (const u of unknown) columnMap.push({ source: u.header, target: null, method: "unmapped" });
    }
    if (!mapped.size) {
      return {
        units: [], aiCalls,
        skipped: skippedReport(["No columns matched the import template — sheet skipped."]),
      };
    }
    let fbDropped = 0;
    for (const e of columnMap) {
      if (e.target != null || fbDropped >= 15) continue;
      const vals = sheet.rows
        .map(r => r[e.source])
        .filter(v => v != null && String(v).trim() !== "");
      if (!vals.length) continue;
      fbDropped++;
      dropped.push({
        sourceSheet: sheet.sheetName, tab: SHEET_NAME[tabHint], module: tabHint,
        header: e.source,
        samples: [...new Set(vals.slice(0, 30).map(v => String(v).trim().slice(0, 60)))].slice(0, 5),
        rows: vals.length,
      });
    }
    return {
      units: [{
        module: tabHint, sourceSheet: sheet.sheetName, mapped,
        rows: sheet.rows, rowNums, columnMap,
        notes: anthropicConfigured()
          ? ["Automatic layout analysis was unavailable for this sheet — columns were mapped with the standard rules only."]
          : [],
        grain: null,
      }],
      aiCalls,
    };
  }
  const p = plan;
  console.log(
    `[data-cleaning] plan "${sheet.sheetName}": primary=${p.primaryModule} grain=${JSON.stringify(p.grain)} ` +
    `split=${p.split.needed}@${p.split.confidence} cols=` +
    JSON.stringify([...p.columns].map(([i, d]) => `${scalarCols[i]}→${d ? `${d.module}.${d.target}@${d.confidence}` : "null"}`)) +
    (p.series.size ? ` series=${JSON.stringify([...p.series])}` : ""),
  );

  // The planner looked at every column WITH its values and concluded the sheet
  // fits no template tab and mapped nothing itself → trust it over name-based
  // pins (a "Status" pin on a task list is noise, not data) and skip whole.
  const aiMappedAny = [...p.columns.entries()].some(([idx, d]) => d && !pinned.has(scalarCols[idx]!));
  const seriesOk = [...p.series.values()].some(s => s.meaning === "weekly-hours" && s.confidence >= CONFIDENCE_FLOOR);
  // …unless nearly every column is an exact/learned pin (e.g. a re-upload of
  // an already-clean template file) — then a spurious null primaryModule must
  // not throw the sheet away.
  const pinnedDominant = pinned.size >= 3 && pinned.size >= Math.ceil(scalarCols.length * 0.8);
  if (!p.primaryModule && !aiMappedAny && !seriesOk && !pinnedDominant) {
    return {
      units: [], aiCalls,
      skipped: skippedReport([
        `"${sheet.sheetName}" does not fit any import template tab (rows are not projects, staff, assignments, schedule, opportunities, leads or companies) — sheet skipped. Ask me about it if it contains data you need imported.`,
      ]),
    };
  }

  // Deterministic snap: a header that EXACTLY matches a template label of the
  // planned primary module belongs there. This overrides both AI wobble AND
  // wrong-module pins: shared labels (Business Unit, Division, Role…) exist on
  // several tabs, and a tab-hint picked from column CONTENT can pin them to a
  // sibling module (e.g. a staff list hinted as "assignments"), which the
  // split gate would then silently drop.
  const snapped = new Set<number>();
  if (p.primaryModule) {
    const pm = p.primaryModule;
    const takenTargets = new Set<string>();
    for (const d of p.columns.values()) if (d) takenTargets.add(`${d.module}|${d.target}`);
    scalarCols.forEach((col, idx) => {
      const key = normKey(col);
      if (!key) return;
      const label = TEMPLATE_COLS[pm].find(c => normKey(c.label) === key)?.label;
      if (!label) return;
      const cur = p.columns.get(idx) ?? null;
      if (cur && cur.module === pm) return;
      const tkey = `${pm}|${label}`;
      if (takenTargets.has(tkey)) return;
      if (cur) takenTargets.delete(`${cur.module}|${cur.target}`);
      takenTargets.add(tkey);
      p.columns.set(idx, { module: pm, target: label, confidence: 1 });
      pinned.delete(col);   // pin (if any) pointed at the wrong module
      snapped.add(idx);
    });
  }

  // ── Deterministic rescue of would-be-dropped columns (never guesses) ──
  // The AI plan can return null for a column the deterministic layer actually
  // knows: a pin it ignored, or a SYN synonym (historically only consulted on
  // the no-AI fallback path). A null decision silently drops the column's
  // DATA, so before executing the plan: apply user overrides (absolute), then
  // restore ignored pins, then synonym-match leftovers against the primary
  // module. Every rescue respects already-claimed targets — a collision
  // degrades to "unmapped" (surfaced for review), never a guess.
  const userMapped = new Set<number>();
  const synonymMapped = new Set<number>();
  {
    const pm = p.primaryModule ?? tabHint;
    const takenT = new Set<string>();
    for (const d of p.columns.values()) if (d) takenT.add(`${d.module}|${d.target}`);

    // User overrides first — they beat the AI, pins and snaps. If another
    // column currently claims the same target, that column loses its mapping
    // (and is surfaced as dropped): the user explicitly named THIS column.
    scalarCols.forEach((col, idx) => {
      const ov = ovFor(col);
      if (!ov) return;
      const tkey = `${ov.module}|${ov.target}`;
      for (const [oidx, d] of p.columns) {
        if (oidx !== idx && d && `${d.module}|${d.target}` === tkey) {
          p.columns.set(oidx, null);
          snapped.delete(oidx);
        }
      }
      const cur = p.columns.get(idx);
      if (cur) takenT.delete(`${cur.module}|${cur.target}`);
      takenT.add(tkey);
      p.columns.set(idx, { module: ov.module, target: ov.target, confidence: 1 });
      pinned.delete(col);
      snapped.delete(idx);
      userMapped.add(idx);
    });

    scalarCols.forEach((col, idx) => {
      if (userMapped.has(idx)) return;
      if (p.columns.get(idx)) return;
      if ((fps.get(col)?.fill ?? 0) === 0) return;   // no data — nothing to lose
      const pin = pinned.get(col);
      let dec: { module: ModuleId; target: string } | null =
        pin ? { module: pin.module, target: pin.target } : null;
      if (!dec && pm) {
        const label = matchHeader(pm, col);
        if (label) dec = { module: pm, target: label };
      }
      if (!dec) return;
      const tkey = `${dec.module}|${dec.target}`;
      if (takenT.has(tkey)) return;
      takenT.add(tkey);
      p.columns.set(idx, { module: dec.module, target: dec.target, confidence: 1 });
      if (!pin) synonymMapped.add(idx);
    });
  }

  // ── Execute the validated plan ──
  const byModule = new Map<ModuleId, ModuleAssignment>();
  const extraEntries: ColumnMapEntry[] = [];   // unmapped / dropped columns
  const extraNotes: string[] = [];
  const unmappedDataCols: string[] = [];

  scalarCols.forEach((col, idx) => {
    const decision = p.columns.get(idx) ?? null;
    if (!decision) {
      extraEntries.push({ source: col, target: null, method: "unmapped" });
      if ((fps.get(col)?.fill ?? 0) > 0) unmappedDataCols.push(col);
      return;
    }
    const pin = pinned.get(col);
    const entry: ColumnMapEntry = {
      source: col, target: decision.target,
      method: userMapped.has(idx) ? "user"
        : synonymMapped.has(idx) ? "synonym"
        : pin ? pin.method
        : snapped.has(idx) ? "exact" : "ai",
    };
    const asg = byModule.get(decision.module) ?? { mapped: new Map<string, string>(), columnMap: [] };
    asg.mapped.set(col, decision.target);
    asg.columnMap.push(entry);
    byModule.set(decision.module, asg);
  });

  // Wide-series decisions.
  const validRuns: WideRun[] = [];
  for (const run of runs) {
    const d = p.series.get(run.id);
    if (d?.meaning === "weekly-hours" && d.confidence >= CONFIDENCE_FLOOR) {
      validRuns.push(run);
    } else {
      extraEntries.push({ source: runLabel(run), target: null, method: "unmapped" });
      extraNotes.push(`A block of ${run.headers.length} date columns (${runLabel(run)}) could not be confidently identified, so it was left out. Ask me about it if those are weekly hours.`);
    }
  }

  // Unpivot weekly-hours runs → assignment rows (needs person + project anchors).
  const unpivotUnits: WorkUnit[] = [];
  if (validRuns.length) {
    const asg = byModule.get("assignments");
    const scalarMap = new Map(asg?.mapped ?? []);
    const scalarEntries: ColumnMapEntry[] = [...(asg?.columnMap ?? [])];
    const revOf = (m: ModuleAssignment | undefined) => {
      const rev = new Map<string, string>();
      for (const [src, label] of m?.mapped ?? []) if (!rev.has(label)) rev.set(label, src);
      return rev;
    };
    const has = (label: string) => [...scalarMap.values()].includes(label);
    // The unpivot computes Start/End/Total — scalar columns mapped there would collide.
    for (const label of ["Start Date", "End Date", "Total Hours"]) {
      for (const [src, l] of [...scalarMap]) {
        if (l !== label) continue;
        scalarMap.delete(src);
        const i = scalarEntries.findIndex(e => e.source === src);
        if (i >= 0) scalarEntries[i] = { source: src, target: null, method: "unmapped" };
        extraNotes.push(`"${src}" was ignored — ${label.toLowerCase()} is derived from the weekly hours columns instead.`);
      }
    }
    if (!has("Name") && !has("Email")) {
      const teamRev = revOf(byModule.get("team"));
      const nameSrc = teamRev.get("Full Name");
      const emailSrc = teamRev.get("Login Email");
      if (nameSrc) { scalarMap.set(nameSrc, "Name"); scalarEntries.push({ source: nameSrc, target: "Name", method: "split-carry" }); }
      if (emailSrc) { scalarMap.set(emailSrc, "Email"); scalarEntries.push({ source: emailSrc, target: "Email", method: "split-carry" }); }
    }
    if (!has("Project") && !has("Project ID")) {
      const projRev = revOf(byModule.get("projects"));
      const idSrc = projRev.get("Project ID");
      const titleSrc = projRev.get("Project Title");
      if (idSrc) { scalarMap.set(idSrc, "Project ID"); scalarEntries.push({ source: idSrc, target: "Project ID", method: "split-carry" }); }
      if (titleSrc) { scalarMap.set(titleSrc, "Project"); scalarEntries.push({ source: titleSrc, target: "Project", method: "split-carry" }); }
    }
    const anchorsOk = (has("Name") || has("Email")) && (has("Project") || has("Project ID"));
    if (anchorsOk) {
      for (const run of validRuns) {
        unpivotUnits.push(unpivotWide({
          sheetName: sheet.sheetName, rows: sheet.rows, rowNums, run,
          scalarMap, scalarColumnMap: scalarEntries, grain: p.grain,
        }));
      }
      byModule.delete("assignments");   // scalars consumed by the unpivot
    } else {
      for (const run of validRuns) {
        extraEntries.push({ source: runLabel(run), target: null, method: "unmapped" });
        extraNotes.push(`Weekly hours columns were found (${runLabel(run)}), but no person or project column could be identified alongside them, so they were left out.`);
      }
    }
  }

  // Split gating (never guessed): a split is honored only when the plan is
  // confident AND each child unit has real anchors; otherwise the foreign
  // columns are dropped to review.
  const pickPrimary = (): ModuleId | null => {
    if (p.primaryModule && byModule.has(p.primaryModule)) return p.primaryModule;
    let best: ModuleId | null = null; let bestN = 0;
    for (const [m, a] of byModule) if (a.mapped.size > bestN) { best = m; bestN = a.mapped.size; }
    return best;
  };
  const droppedForeign = new Map<ModuleId, ModuleAssignment>();
  const droppedNote = new Map<ModuleId, string>();
  if (byModule.size > 1) {
    const primary = pickPrimary();
    const splitOk = p.split.needed && p.split.confidence >= CONFIDENCE_FLOOR;
    for (const [m, a] of [...byModule]) {
      if (m === primary) continue;
      let keep = splitOk;
      if (keep && CHILD_MODULES.has(m)) {
        const labels = new Set(a.mapped.values());
        keep = m === "assignments"
          ? (labels.has("Name") || labels.has("Email"))
          : labels.has("Phase Name");
      }
      if (!keep) {
        byModule.delete(m);
        // Rescue before dropping: a foreign-pinned header that is ALSO a
        // known label/synonym of the primary module belongs there (e.g.
        // "Point of Contact" is an exact Opportunities label AND the
        // "Contact Name" synonym on a Projects sheet).
        const primAsg = primary ? byModule.get(primary) : undefined;
        if (primary && primAsg) {
          const primTaken = new Set(primAsg.mapped.values());
          for (const src of [...a.mapped.keys()]) {
            const label = matchHeader(primary, src);
            if (!label || primTaken.has(label)) continue;
            a.mapped.delete(src);
            primAsg.mapped.set(src, label);
            primTaken.add(label);
            primAsg.columnMap.push({ source: src, target: label, method: "synonym" });
          }
        }
        if (!a.mapped.size) continue;   // everything rescued — nothing dropped
        droppedForeign.set(m, a);
        for (const [src] of a.mapped) {
          extraEntries.push({ source: src, target: null, method: "unmapped" });
          unmappedDataCols.push(src);
        }
        const note = `Columns that look like they belong on the "${SHEET_NAME[m]}" tab (${[...a.mapped.keys()].slice(0, 5).map(s => `"${s}"`).join(", ")}) could not be split out safely — they were left out. Check the review list.`;
        droppedNote.set(m, note);
        extraNotes.push(note);
      }
    }
  }

  // ── Row-level record-type routing (deterministic) ──
  // A "Type" column whose values are record-type words routes each row to its
  // own tab: opportunity rows → Opportunities, lead rows → Leads. Rows with an
  // unrecognized type are held for the Review sheet — never guessed.
  let primaryRows = sheet.rows;
  let primaryRowNums = rowNums;
  const routedUnits: WorkUnit[] = [];
  const heldRows: HeldRow[] = [];
  const routePrimary = pickPrimary();
  if (routePrimary && ROUTABLE.has(routePrimary) && byModule.size === 1 && !unpivotUnits.length) {
    const det = detectRowTypeColumn(routePrimary, scalarCols, sheet.rows);
    if (det) {
      const prim = byModule.get(routePrimary)!;
      const buckets = new Map<ModuleId, { rows: PipelineRow[]; nums: number[] }>();
      const keepRows: PipelineRow[] = [];
      const keepNums: number[] = [];
      sheet.rows.forEach((r, i) => {
        const t = det.perRow[i];
        if (t === "unknown") {
          // A row whose mapped columns are ALL blank has nothing importable
          // (e.g. a template guidance row whose only text sits in the type
          // column) — drop it silently, like the empty-row check downstream.
          // The type column itself never counts as data: it may still be in
          // prim.mapped here (it is only consumed AFTER this loop), and its
          // cell is non-blank by definition of an "unknown" type.
          const hasData = [...prim.mapped.keys()].some(src => {
            if (src === det.col) return false;
            const v = r[src];
            return v != null && String(v).trim() !== "";
          });
          if (!hasData) return;
          heldRows.push({
            // Snapshot the map — prim.mapped is mutated right after this loop
            // (the type column is deleted) and held rows are consumed later.
            module: routePrimary, srcRow: r, srcRowNum: rowNums[i]!, mapped: new Map(prim.mapped),
            remarks: `The "${det.col}" column says "${String(r[det.col]).trim()}" — not a recognized record type (Project, Opportunity or Lead), so RM ONE will not guess which tab this row belongs on. Correct the row and copy it (everything except Remarks and the columns after it) to the bottom of the right tab.`,
          });
          return;
        }
        const mod = t ?? routePrimary;
        if (mod === routePrimary) { keepRows.push(r); keepNums.push(rowNums[i]!); return; }
        const b = buckets.get(mod) ?? { rows: [], nums: [] };
        b.rows.push(r); b.nums.push(rowNums[i]!);
        buckets.set(mod, b);
      });

      if (buckets.size || heldRows.length) {
        primaryRows = keepRows;
        primaryRowNums = keepNums;

        // The type column is consumed by the router — it must not double as a
        // mapped column or sit in the review list as "unmapped".
        if (prim.mapped.has(det.col)) {
          prim.mapped.delete(det.col);
          const ci = prim.columnMap.findIndex(e => e.source === det.col);
          if (ci >= 0) prim.columnMap[ci] = { source: det.col, target: null, method: "type-router" };
        } else {
          const ei = extraEntries.findIndex(e => e.source === det.col);
          if (ei >= 0) extraEntries[ei] = { source: det.col, target: null, method: "type-router" };
          else extraEntries.push({ source: det.col, target: null, method: "type-router" });
          const ui = unmappedDataCols.indexOf(det.col);
          if (ui >= 0) unmappedDataCols.splice(ui, 1);
          // If the type column was the ONLY column of a module the split gate
          // dropped, its "could not be split out safely" note is now moot.
          for (const [dm, da] of droppedForeign) {
            if (da.mapped.has(det.col) && da.mapped.size === 1) {
              const note = droppedNote.get(dm);
              const ni = note ? extraNotes.indexOf(note) : -1;
              if (ni >= 0) extraNotes.splice(ni, 1);
            }
          }
        }

        for (const [mod, b] of buckets) {
          const mapped = new Map<string, string>();
          const columnMap: ColumnMapEntry[] = [];
          const taken = new Set<string>();

          // Reclaim columns the AI already mapped to this module but the
          // column-split gate dropped (e.g. "Chance of Success" on a mixed
          // projects sheet) — with row routing they have a home again.
          const reclaimed = droppedForeign.get(mod);
          if (reclaimed) {
            for (const [src, label] of reclaimed.mapped) {
              if (src === det.col || taken.has(label)) continue;
              mapped.set(src, label); taken.add(label);
              columnMap.push({ source: src, target: label, method: "ai" });
              const ei = extraEntries.findIndex(e => e.source === src && e.target === null);
              if (ei >= 0) extraEntries.splice(ei, 1);
              const ui = unmappedDataCols.indexOf(src);
              if (ui >= 0) unmappedDataCols.splice(ui, 1);
            }
            const note = droppedNote.get(mod);
            const ni = note ? extraNotes.indexOf(note) : -1;
            if (ni >= 0) extraNotes.splice(ni, 1);
          }

          // Re-target the primary module's mapping: exact/synonym match on the
          // source header first, then the cross-tab concept translation
          // (Project ID → Opportunity ID, Contract Value → Approx Contract
          // Value, Start Date → Forecast Start, …).
          for (const [src, label] of prim.mapped) {
            if (mapped.has(src)) continue;
            const target = matchHeader(mod, src) ?? translateLabel(routePrimary, label, mod);
            if (!target || taken.has(target)) continue;
            mapped.set(src, target); taken.add(target);
            columnMap.push({
              source: src, target,
              method: normKey(src) === normKey(target) ? "exact" : "type-route",
            });
          }

          if (!mapped.size) {
            // Nothing translatable (pathological) — hold the rows instead of
            // silently losing them.
            b.rows.forEach((r, j) => heldRows.push({
              module: routePrimary, srcRow: r, srcRowNum: b.nums[j]!, mapped: new Map(prim.mapped),
              remarks: `This row's "${det.col}" says it belongs on the "${SHEET_NAME[mod]}" tab, but none of the sheet's columns could be matched to that tab. Move it there by hand.`,
            }));
            continue;
          }

          routedUnits.push({
            module: mod, sourceSheet: sheet.sheetName, mapped,
            rows: b.rows, rowNums: b.nums, columnMap,
            notes: [`${b.rows.length} row${b.rows.length === 1 ? "" : "s"} moved here from "${sheet.sheetName}" — their "${det.col}" column marks them as ${SHEET_NAME[mod].toLowerCase()}, not ${SHEET_NAME[routePrimary].toLowerCase()}.`],
            grain: p.grain,
          });
        }

        const parts = [...buckets]
          .filter(([m]) => routedUnits.some(u => u.module === m))
          .map(([m, b]) => `${b.rows.length} moved to ${SHEET_NAME[m]}`);
        if (heldRows.length) parts.push(`${heldRows.length} with an unclear type moved to the review sheet`);
        extraNotes.push(`Rows were routed by the "${det.col}" column: ${keepRows.length} stayed on ${SHEET_NAME[routePrimary]}${parts.length ? `, ${parts.join(", ")}` : ""}.`);
      }
    }
  }

  // Build the work units.
  let units: WorkUnit[];
  if (byModule.size > 1 || (byModule.size === 1 && unpivotUnits.length)) {
    units = splitSheet({ sheetName: sheet.sheetName, rows: sheet.rows, rowNums, byModule, grain: p.grain });
  } else if (byModule.size === 1) {
    const [m, a] = [...byModule.entries()][0]!;
    units = [{
      module: m, sourceSheet: sheet.sheetName, mapped: a.mapped,
      rows: primaryRows, rowNums: primaryRowNums, columnMap: a.columnMap, notes: [], grain: p.grain,
    }];
  } else {
    units = [];
  }
  units.push(...routedUnits, ...unpivotUnits);
  units = units.filter(u => u.mapped.size > 0);

  if (!units.length) {
    return {
      units: [], aiCalls,
      skipped: skippedReport([
        ...extraNotes,
        "No columns could be safely mapped to the import template — sheet skipped. Ask me about it if it contains real data.",
      ]),
    };
  }

  // Ambiguous data-bearing columns go to Review — never guessed.
  const primaryUnit = units.find(u => u.module === pickPrimary()) ?? units[0]!;
  primaryUnit.columnMap.push(...extraEntries);
  primaryUnit.notes.push(...extraNotes);
  for (const col of unmappedDataCols.slice(0, 15)) {
    const fp = fps.get(col);
    review.push({
      sheet: SHEET_NAME[primaryUnit.module], row: rowNums[0] ?? 1,
      issue: "Column needs review",
      detail: `The column "${col}" on sheet "${sheet.sheetName}" has data but no template column it safely matches${fp?.samples.length ? ` (examples: ${fp.samples.slice(0, 3).join(", ")})` : ""}. Guessing wrong would corrupt the import, so it was left out.`,
      action: `If this column matters, tell me in the chat what it holds (for example "that column is the contract value") and I will re-clean the file with it mapped.`,
      level: "check", record: `Column "${col}"`,
      data: fp?.samples.slice(0, 5).join(" | ") ?? "",
    });
    dropped.push({
      sourceSheet: sheet.sheetName,
      tab: SHEET_NAME[primaryUnit.module],
      module: primaryUnit.module,
      header: col,
      samples: fp?.samples.slice(0, 5) ?? [],
      rows: sheet.rows.reduce((n, r) => {
        const v = r[col];
        return v != null && String(v).trim() !== "" ? n + 1 : n;
      }, 0),
    });
  }
  return { units, aiCalls, held: heldRows.length ? heldRows : undefined };
}

// ── Main engine ──────────────────────────────────────────────────────────────

interface CleanSheet {
  module: ModuleId;
  sourceSheet: string;
  rows: Record<string, Cell>[];     // keyed by template label
  srcRows: PipelineRow[];           // original rows aligned with `rows`
  srcRowNums: number[];             // 1-based source data row numbers
  report: SheetReport;
}

export async function runCleaningSession(opts: {
  tenantId: string;
  sessionId: string;
  fileName: string;
  buffer: Buffer;
  checkDb: boolean;
  /** Re-clean flow: user-confirmed column mappings — absolute, beat the AI. */
  overrides?: CleanOverride[];
}): Promise<void> {
  const { tenantId, sessionId, fileName, buffer, overrides = [] } = opts;
  const startedAt = new Date().toISOString();
  const review: ReviewItem[] = [];
  const droppedColumns: DroppedColumn[] = [];
  /**
   * Rows pulled out of (or flagged against) the main tabs. Each becomes one
   * row on the "<Tab> — Review" sheet: the tab's exact columns + "Remarks",
   * then two info-only columns — "Source Row" (the row number in the user's
   * ORIGINAL uploaded file) and "Matched ID" (the ID(s) this row collided
   * with or could belong to) — so the user can verify every decision.
   * `alsoInMainTab` rows stay on the main tab too (flag-only, "do not paste").
   */
  const quarantine: {
    mod: ModuleId;
    row: Record<string, Cell>;
    srcRowNum: number;
    remarks: string;
    alsoInMainTab?: boolean;
    matchedId?: string;
  }[] = [];
  const globalNotes: string[] = [];
  let aiCalls = 0;

  const status = (stage: DcStatus["stage"], pct: number, message: string) =>
    writeStatus(tenantId, sessionId, { stage, pct, message, updatedAt: new Date().toISOString(), fileName });

  await status("parsing", 5, "Reading your Excel file…");
  const sheets = await parseExcel(buffer);
  if (!sheets.length) throw new Error("No readable sheets found in the file.");

  // 1. Plan every sheet (v2): pin known columns, profile the values, ONE
  //    whole-sheet AI planning call per sheet, then deterministic executors
  //    (split mixed sheets / unpivot weekly-hours grids). Each sheet falls
  //    back to the v1 deterministic path when the AI is unavailable.
  await status("mapping", 8, "Analyzing sheet layouts…");
  const learned = await loadLearnedMappings();
  const catalog = catalogForPrompt();

  const units: WorkUnit[] = [];
  const sheetReports: SheetReport[] = [];
  let planIdx = 0;
  for (const sheet of sheets) {
    planIdx++;
    await status("mapping", 8 + Math.round((planIdx / sheets.length) * 28),
      `Analyzing "${sheet.sheetName}"…`);
    const outcome = await planSheetUnits(sheet, learned, catalog, review, droppedColumns, overrides);
    aiCalls += outcome.aiCalls;
    if (outcome.skipped) sheetReports.push(outcome.skipped);
    units.push(...outcome.units);

    // Rows held back at planning time (e.g. an unrecognized record type in a
    // routed "Type" column) go straight to the tab's Review sheet.
    for (const h of outcome.held ?? []) {
      const row: Record<string, Cell> = {};
      for (const [src, label] of h.mapped) {
        const v = h.srcRow[src];
        if (v != null && String(v).trim() !== "") row[label] = v as Cell;
      }
      // Nothing importable on the row (e.g. a template guidance row whose only
      // text sits in the type column) — drop it silently, exactly like the
      // empty-row check in the cleaning loop.
      if (!Object.keys(row).length) continue;
      quarantine.push({ mod: h.module, row, srcRowNum: h.srcRowNum, remarks: h.remarks });
      review.push({
        sheet: SHEET_NAME[h.module], row: h.srcRowNum,
        issue: "Row type not recognized",
        detail: h.remarks,
        action: `Find this row on the "${SHEET_NAME[h.module]} — Review" sheet, decide which tab it belongs on, then copy it (everything except Remarks and the columns after it) to the bottom of that tab.`,
        level: "fix", record: recordLabel(h.module, row, h.srcRow), data: rowPreview(h.srcRow),
      });
    }
  }

  const cleanSheets: CleanSheet[] = [];

  // Process projects first so cross-referencing has the project index ready.
  units.sort((a, b) => (a.module === "projects" ? 0 : 1) - (b.module === "projects" ? 0 : 1));

  let unitIdx = 0;
  for (const unit of units) {
    unitIdx++;
    const basePct = 38 + Math.round((unitIdx / units.length) * 24);
    const module = unit.module;
    const mapped = unit.mapped;

    // 3. Row-by-row value cleaning
    await status("cleaning", basePct, `Cleaning "${unit.sourceSheet}" → "${SHEET_NAME[module]}"…`);
    const fixes = { dates: 0, numbers: 0, emails: 0, trimmed: 0, idsFilled: 0 };
    const outRows: Record<string, Cell>[] = [];
    const srcRows: PipelineRow[] = [];
    const srcRowNums: number[] = [];

    unit.rows.forEach((src, i) => {
      // Real worksheet row number (as seen in Excel) — split/unpivot units
      // carry their PARENT source row numbers.
      const srcNum = unit.rowNums[i] ?? i + 1;
      const out: Record<string, Cell> = {};
      let hasData = false;
      for (const [srcCol, target] of mapped) {
        const raw = src[srcCol] ?? null;
        const kind = colKind(module, target);
        if (kind === "date") {
          const r = toIsoDate(raw);
          if (r.bad) review.push({
            sheet: SHEET_NAME[module], row: srcNum,
            issue: "Date could not be read",
            detail: `The "${target}" column says "${String(raw)}". That is not a recognizable date, so it was left exactly as it was.`,
            action: `On the "${SHEET_NAME[module]}" tab, find this record and replace the value in "${target}" with a real date (for example 03/15/2026).`,
            level: "fix", record: recordLabel(module, out, src), data: rowPreview(src),
          });
          else if (r.fixed) fixes.dates++;
          out[target] = r.value;
        } else if (kind === "currency" || kind === "number") {
          const r = toNumber(raw);
          if (r.bad) review.push({
            sheet: SHEET_NAME[module], row: srcNum,
            issue: "Not a number",
            detail: `The "${target}" column says "${String(raw)}". That is text, not a number, so the cell was left blank in the cleaned file.`,
            action: `If you know the correct amount, enter it in the "${target}" column on the "${SHEET_NAME[module]}" tab. If there is no amount, it can stay blank.`,
            level: "check", record: recordLabel(module, out, src), data: rowPreview(src),
          });
          else if (r.fixed) fixes.numbers++;
          out[target] = r.value;
        } else if (kind === "email") {
          const r = toEmail(raw);
          if (r.bad) review.push({
            sheet: SHEET_NAME[module], row: srcNum,
            issue: "Email looks wrong",
            detail: `"${String(raw)}" does not look like a valid email address. It was kept as-is.`,
            action: `Correct the email in the "${target}" column on the "${SHEET_NAME[module]}" tab, or clear it if unknown.`,
            level: "check", record: recordLabel(module, out, src), data: rowPreview(src),
          });
          else if (r.fixed) fixes.emails++;
          out[target] = r.value;
        } else {
          const r = toText(raw);
          if (r.fixed) fixes.trimmed++;
          out[target] = r.value;
        }
        if (out[target] != null && String(out[target]).trim() !== "") hasData = true;
      }
      if (hasData) { outRows.push(out); srcRows.push(src); srcRowNums.push(srcNum); }
    });

    const rpt: SheetReport = {
      sourceSheet: unit.sourceSheet, module, targetSheet: SHEET_NAME[module],
      totalRows: unit.rows.length, cleanRows: outRows.length,
      columnMap: unit.columnMap, fixes,
      duplicates: { exactRemoved: 0, conflictsResolved: 0 },
      notes: [...unit.notes],
    };
    if (unit.grain) rpt.grain = unit.grain;
    sheetReports.push(rpt);
    cleanSheets.push({ module, sourceSheet: unit.sourceSheet, rows: outRows, srcRows, srcRowNums, report: rpt });
  }

  // 4. Duplicate handling (within each module, across all its sheets)
  await status("cleaning", 65, "Removing duplicates…");
  const byModule = new Map<ModuleId, CleanSheet[]>();
  for (const cs of cleanSheets) {
    byModule.set(cs.module, [...(byModule.get(cs.module) ?? []), cs]);
  }

  const dupKey = (m: ModuleId, r: Record<string, Cell>): string | null => {
    const pick = (...labels: string[]) => labels.map(l => normKey(String(r[l] ?? ""))).join("~");
    switch (m) {
      case "projects": {
        const id = normKey(String(r["Project ID"] ?? ""));
        return id ? `id:${id}` : (r["Project Title"] ? `t:${pick("Project Title", "Company Name")}` : null);
      }
      case "team": {
        const emailVal = normKey(String(r["Login Email"] ?? ""));
        return emailVal ? `e:${emailVal}` : null;
      }
      case "assignments":
        return `a:${pick("Project ID", "Project", "Name", "Email", "Start Date", "End Date")}`;
      case "schedule":
        return `s:${pick("Project ID", "Project Title", "Phase Name", "Start Date")}`;
      case "opportunities": {
        const id = normKey(String(r["Opportunity ID"] ?? ""));
        return id ? `id:${id}` : (r["Opportunity Title"] ? `t:${pick("Opportunity Title", "Company Name")}` : null);
      }
      case "leads": {
        const id = normKey(String(r["Lead ID"] ?? ""));
        return id ? `id:${id}` : (r["Lead Name"] ? `t:${pick("Lead Name")}` : null);
      }
      case "companies": {
        const nameVal = normKey(String(r["Company Name"] ?? ""));
        return nameVal ? `c:${nameVal}` : null;
      }
    }
  };

  const filled = (r: Record<string, Cell>) =>
    Object.values(r).filter(v => v != null && String(v).trim() !== "").length;

  for (const [mod, group] of byModule) {
    const seen = new Map<string, { cs: CleanSheet; i: number }>();
    for (const cs of group) {
      for (let i = 0; i < cs.rows.length; i++) {
        const key = dupKey(mod, cs.rows[i]!);
        if (!key) continue;
        const prev = seen.get(key);
        if (!prev) { seen.set(key, { cs, i }); continue; }
        const a = prev.cs.rows[prev.i]!;
        const b = cs.rows[i]!;
        const identical = JSON.stringify(a) === JSON.stringify(b);
        if (identical) {
          cs.rows[i] = null as unknown as Record<string, Cell>; // mark for removal
          cs.report.duplicates.exactRemoved++;
        } else {
          // Keep the most complete row; report the dropped variant.
          const keepB = filled(b) > filled(a);
          const dropped = keepB ? a : b;
          const kept = keepB ? b : a;
          const droppedLoc = keepB ? { cs: prev.cs, i: prev.i } : { cs, i };
          if (keepB) {
            prev.cs.rows[prev.i] = null as unknown as Record<string, Cell>;
            seen.set(key, { cs, i });
          } else {
            cs.rows[i] = null as unknown as Record<string, Cell>;
          }
          cs.report.duplicates.conflictsResolved++;
          const diffs: string[] = [];
          for (const col of Object.keys(dropped)) {
            const dv = dropped[col], kv = kept[col];
            if (String(dv ?? "").trim() === String(kv ?? "").trim()) continue;
            if (dv == null || String(dv).trim() === "") continue;
            diffs.push(`"${col}" was ${String(dv).trim().slice(0, 40)} on the removed row (kept row has ${String(kv ?? "").trim().slice(0, 40) || "blank"})`);
            if (diffs.length >= 4) break;
          }
          review.push({
            sheet: SHEET_NAME[mod], row: droppedLoc.cs.srcRowNums[droppedLoc.i]!,
            issue: "Duplicate row removed",
            detail: `This row and another row describe the same record. The row with the most complete information was kept; this one was removed.${diffs.length ? ` Differences: ${diffs.join("; ")}.` : ""}`,
            action: `Nothing is required — just confirm the kept record on the "${SHEET_NAME[mod]}" tab looks right.`,
            level: "info",
            record: recordLabel(mod, kept, droppedLoc.cs.srcRows[droppedLoc.i]!),
            data: rowPreview(droppedLoc.cs.srcRows[droppedLoc.i]!),
          });
        }
      }
    }
    for (const cs of group) {
      const keepIdx: number[] = [];
      cs.rows.forEach((r, i) => { if (r) keepIdx.push(i); });
      cs.rows       = keepIdx.map(i => cs.rows[i]!);
      cs.srcRows    = keepIdx.map(i => cs.srcRows[i]!);
      cs.srcRowNums = keepIdx.map(i => cs.srcRowNums[i]!);
      cs.report.cleanRows = cs.rows.length;
    }
  }

  // 4b. Default-ID minting — ONLY when the ENTIRE file contains zero IDs.
  //     Some companies do not use project/opportunity IDs at all. In that
  //     case (and ONLY that case) sequential defaults are generated
  //     (PMM-00001…, OPM-00001…, LD-00001…) so the import can proceed and
  //     the cross-reference pass below can fill assignments/schedule rows.
  //     If even ONE ID appears anywhere in the file, nothing is minted —
  //     mixing generated defaults with a company's real ERP ids was
  //     explicitly rejected.
  const ID_SCAN_COLS: [ModuleId, string][] = [
    ["projects", "Project ID"], ["assignments", "Project ID"],
    ["schedule", "Project ID"], ["opportunities", "Opportunity ID"],
    ["leads", "Lead ID"],
  ];
  const fileHasAnyId = ID_SCAN_COLS.some(([mod, col]) =>
    (byModule.get(mod) ?? []).some(cs => cs.rows.some(r => String(r[col] ?? "").trim() !== "")));
  const MINT_SPEC: { mod: ModuleId; idCol: string; prefix: string }[] = [
    { mod: "projects",      idCol: "Project ID",     prefix: "PMM" },
    { mod: "opportunities", idCol: "Opportunity ID", prefix: "OPM" },
    { mod: "leads",         idCol: "Lead ID",        prefix: "LD"  },
  ];
  const mintable = MINT_SPEC.filter(s => (byModule.get(s.mod) ?? []).some(cs => cs.rows.length > 0));
  if (!fileHasAnyId && mintable.length) {
    await status("cross-check", 72, "No IDs found in the file — generating default IDs…");
    // Existing tenant record IDs (PMM also holds leads; Opportunity holds opps).
    // FAIL-CLOSED: if this lookup fails, mint NOTHING — a generated ID that
    // collides with an existing record would silently overwrite it at import.
    let existing: Set<string> | null = null;
    try {
      const pool = await getPool();
      const q = await pool.request().input("tid", sql.NVarChar, tenantId).query(`
        SELECT TicketId FROM core2.dbo.PMM WHERE TenantID=@tid AND Deleted=0
        UNION SELECT TicketId FROM core2.dbo.Opportunity WHERE TenantID=@tid AND Deleted=0`);
      existing = new Set((q.recordset as { TicketId: string | null }[])
        .map(r => normKey(String(r.TicketId ?? ""))).filter(Boolean));
    } catch (e) {
      console.warn("[data-cleaning] default-ID mint skipped (existing-record check failed):",
        e instanceof Error ? e.message : String(e));
      globalNotes.push(
        "No IDs were found anywhere in your file. RM ONE normally generates default IDs (PMM-00001, OPM-00001…) in this case, but the check against existing records failed, so no IDs were generated this time. Add your own IDs to the file, or re-upload to try again.");
    }
    if (existing) {
      for (const spec of mintable) {
        let n = 0;
        const nextId = () => {
          let id: string;
          do { n++; id = `${spec.prefix}-${String(n).padStart(5, "0")}`; } while (existing!.has(normKey(id)));
          existing!.add(normKey(id));
          return id;
        };
        let firstId = "", lastId = "", minted = 0, firstSrcRow = 0;
        for (const cs of byModule.get(spec.mod) ?? []) {
          let sheetMinted = 0;
          cs.rows.forEach((r, i) => {
            if (String(r[spec.idCol] ?? "").trim()) return;
            const id = nextId();
            r[spec.idCol] = id;
            minted++; sheetMinted++;
            if (!firstId) { firstId = id; firstSrcRow = cs.srcRowNums[i]!; }
            lastId = id;
            cs.report.fixes.idsFilled++;
          });
          if (sheetMinted) cs.report.notes.push(
            `Your file has no IDs anywhere, so ${sheetMinted.toLocaleString()} default ${spec.idCol}s were generated automatically (${spec.prefix}-00001 style).`);
        }
        if (minted) review.push({
          sheet: SHEET_NAME[spec.mod], row: firstSrcRow,
          issue: `Default ${spec.idCol}s generated`,
          detail: `Your file contains no IDs anywhere, so RM ONE generated ${minted.toLocaleString()} sequential ${spec.idCol}s automatically (${firstId} through ${lastId}), skipping any IDs already used by existing records.`,
          action: `Nothing is required — the generated IDs are on the "${SHEET_NAME[spec.mod]}" tab of the cleaned file. If your company does use its own IDs, add them to the file and re-upload instead.`,
          level: "info",
          record: `${minted.toLocaleString()} rows on "${SHEET_NAME[spec.mod]}"`,
          data: `${firstId} … ${lastId}`,
        });
      }
      globalNotes.push(
        "No IDs were found anywhere in your file, so default IDs were generated automatically. If your company uses its own project/opportunity IDs, add them to the file and re-upload — generated and real IDs are never mixed.");
    }
  }

  // 5. Cross-tab Project ID checks (assignments + schedule vs Projects tab).
  //    STRICT: an ID is assigned only on a CERTAIN match — the name matches
  //    exactly one project (whitespace/case-insensitive). Exact-title beats
  //    punctuation-variant. Ambiguous/unmatched rows are quarantined.
  await status("cross-check", 75, "Cross-checking Project IDs…");
  const projSheets = byModule.get("projects") ?? [];

  /** Exact-match key: case-insensitive, whitespace-collapsed — punctuation KEPT. */
  const exactTitleKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

  // _cs/_i let step 5b null out extra same-name rows so they move to the
  // review sheet instead of staying on the main Projects tab.
  interface ProjEntry { id: string; title: string; row: Record<string, Cell>; srcRowNum: number; _cs: typeof projSheets[number]; _i: number }
  const projById = new Map<string, string>();            // normKey(id) → Project ID
  const byExactTitle = new Map<string, ProjEntry[]>();   // exactTitleKey(title) → projects
  const byPunctTitle = new Map<string, ProjEntry[]>();   // normKey(title) (punctuation stripped) → projects
  for (const cs of projSheets) {
    cs.rows.forEach((r, i) => {
      // Strip stray whitespace inside IDs ("LEM- 000220" → "LEM-000220") so
      // stored tickets, in-file cross-refs and URLs all use the clean form.
      const rawId = String(r["Project ID"] ?? "").trim();
      const id = normalizeTicketId(rawId);
      if (id !== rawId) { r["Project ID"] = id; cs.report.fixes.trimmed++; }
      const title = String(r["Project Title"] ?? "").trim();
      if (id) projById.set(normKey(id), id);
      if (title && id) {
        const e: ProjEntry = { id, title, row: r, srcRowNum: cs.srcRowNums[i]!, _cs: cs, _i: i };
        const k1 = exactTitleKey(title);
        byExactTitle.set(k1, [...(byExactTitle.get(k1) ?? []), e]);
        const k2 = normKey(title);
        byPunctTitle.set(k2, [...(byPunctTitle.get(k2) ?? []), e]);
      }
    });
  }

  // Opportunities are LEGAL targets for assignment and schedule rows — the
  // import resolves both against projects AND opportunities, by ID or title.
  // So in-file opportunities that carry an ID (including IDs minted in step
  // 4b for files with no IDs anywhere) participate in cross-referencing
  // exactly like projects: a certain title match fills the row's Project ID.
  const oppSheets = byModule.get("opportunities") ?? [];
  const oppById = new Map<string, string>();              // normKey(id) → Opportunity ID
  const oppByExactTitle = new Map<string, ProjEntry[]>();
  const oppByPunctTitle = new Map<string, ProjEntry[]>();
  for (const cs of oppSheets) {
    cs.rows.forEach((r, i) => {
      const rawId = String(r["Opportunity ID"] ?? "").trim();
      const id = normalizeTicketId(rawId);
      if (id !== rawId) { r["Opportunity ID"] = id; cs.report.fixes.trimmed++; }
      const title = String(r["Opportunity Title"] ?? "").trim();
      if (id) oppById.set(normKey(id), id);
      if (title && id) {
        const e: ProjEntry = { id, title, row: r, srcRowNum: cs.srcRowNums[i]!, _cs: cs, _i: i };
        const k1 = exactTitleKey(title);
        oppByExactTitle.set(k1, [...(oppByExactTitle.get(k1) ?? []), e]);
        const k2 = normKey(title);
        oppByPunctTitle.set(k2, [...(oppByPunctTitle.get(k2) ?? []), e]);
      }
    });
  }

  // Titles/IDs that live on the Opportunities/Leads tabs (including rows a
  // "Type" column routed there) — an assignment pointing at one of these is
  // reported as "that record is an opportunity/lead", not "does not exist".
  const oppLeadIndex = new Map<string, ModuleId>();   // normKey(ref) → module
  const OPP_LEAD_REF_COLS: [ModuleId, string[]][] = [
    ["opportunities", ["Opportunity ID", "Opportunity Title"]],
    ["leads", ["Lead ID", "Lead Name"]],
  ];
  for (const [olMod, refCols] of OPP_LEAD_REF_COLS) {
    for (const cs of byModule.get(olMod) ?? []) {
      for (const r of cs.rows) {
        for (const c of refCols) {
          const k = normKey(String(r[c] ?? ""));
          if (k && !oppLeadIndex.has(k)) oppLeadIndex.set(k, olMod);
        }
      }
    }
  }

  // Each candidate carries its own source-file row number so duplicate/
  // ambiguity messages show BOTH sides of the collision ("row 44 looks like a
  // copy of CPR-16-002368 at row 12"). The frontend parses this exact
  // `ID ("Title", row N)` shape — keep the format in lockstep with the
  // candidate regexes in InlineDataGrid.tsx.
  const listCandidates = (cands: ProjEntry[]): string => {
    const shown = cands.slice(0, 6).map(c => `${c.id} ("${c.title}", row ${c.srcRowNum})`).join(", ");
    return cands.length > 6 ? `${shown} and ${cands.length - 6} more` : shown;
  };

  // 5a. Flag punctuation-twin projects (e.g. "Supercell Mothers Room" vs
  //     "Supercell - Mother's Room") — likely the same job entered twice.
  //     Rows STAY on the Projects tab; the review sheet carries a flag-only copy.
  let twinFlags = 0;
  for (const entries of byPunctTitle.values()) {
    if (entries.length < 2) continue;
    const distinctNames = new Set(entries.map(e => exactTitleKey(e.title)));
    if (distinctNames.size < 2) continue;   // same exact name → handled in 5b
    if (twinFlags >= 100) break;
    for (const e of entries) {
      twinFlags++;
      const others = entries.filter(o => o !== e);
      review.push({
        sheet: "Projects", row: e.srcRowNum,
        issue: "Possible duplicate project",
        detail: `"${e.title}" (${e.id}) and ${listCandidates(others)} have names that differ only by punctuation or spacing — they may be the same project entered more than once.`,
        action: `Check whether these are really the same project. If yes, keep one and delete the other on the "Projects" tab. This row was NOT removed — the review copy is just a flag.`,
        level: "check", record: `Project Title: ${e.title}  |  Project ID: ${e.id}`,
        data: `Project ID=${e.id} | Project Title=${e.title}`,
      });
      quarantine.push({
        mod: "projects", row: e.row, srcRowNum: e.srcRowNum, alsoInMainTab: true,
        matchedId: others.slice(0, 6).map(o => o.id).join(", "),
        remarks: `ALREADY on the "Projects" tab — do NOT paste this row again. Possible duplicate: the name differs only by punctuation/spacing from ${listCandidates(others)}. If they are the same project, keep one and delete the other on the "Projects" tab.`,
      });
    }
  }

  // 5b. Same exact name used by several different projects (e.g. three
  //     projects all called "Affirm"). The import rejects files where the
  //     same title appears more than once, so all but the most complete row
  //     are MOVED to the "Projects — Review" sheet. The user can paste them
  //     back if they are genuinely different jobs, but they must first give
  //     each one a distinct name so the import can tell them apart.
  const step5bNulled = new Set<ProjEntry>();
  // Moved-away ID → both sides of the same-name clash. Assignment /
  // Schedule rows that carried the moved ID are held as "ambiguous" so the
  // user can pick the right project via candidate buttons — we never silently
  // re-point them at the kept row because the file may have two genuinely
  // different projects sharing a name.
  const step5bRemap = new Map<string, {
    fromId: string; fromTitle: string; fromSrcRowNum: number;
    toId: string;   toTitle: string;   toSrcRowNum: number;
  }>();
  for (const entries of byExactTitle.values()) {
    if (entries.length < 2) continue;
    // Keep the most complete row; move all others to the review sheet.
    const sorted = [...entries].sort((a, b) => filled(b.row) - filled(a.row));
    const kept = sorted[0]!;
    const extras = sorted.slice(1);

    // Review note on the kept row (info only — it stays on the Projects tab).
    review.push({
      sheet: "Projects", row: kept.srcRowNum,
      issue: "Several projects share the same name",
      detail: `${entries.length} projects are all named "${kept.title}": ${listCandidates(entries)}. The most complete row was kept on the "Projects" tab; the others were moved to "Projects — Review" so the import doesn't reject the file.`,
      action: `If the moved rows are truly different jobs, give each one a unique "Project Title" and paste it back onto the "Projects" tab. If they are duplicates, delete them from the review sheet.`,
      level: "check", record: `Project Title: ${kept.title}`,
      data: entries.map(e => e.id).join(", "),
    });

    for (const e of extras) {
      const othersStr = listCandidates(sorted.filter(o => o !== e));
      review.push({
        sheet: "Projects", row: e.srcRowNum,
        issue: "Moved — same name as another project",
        detail: `"${e.title}" (${e.id}) has the same name as ${sorted.length - 1} other project(s) in the file: ${othersStr}. The most complete row was kept on the "Projects" tab; this one was moved here so the import does not reject the file for having duplicate titles.`,
        action: `If this is truly a different job from "${kept.title}" (${kept.id}), give it a unique "Project Title" and paste it back onto the "Projects" tab. If it is a duplicate, delete it.`,
        level: "fix",
        record: `Project Title: ${e.title}  |  Project ID: ${e.id}`,
        data: `Project ID=${e.id} | Project Title=${e.title}`,
      });
      quarantine.push({
        mod: "projects", row: e.row, srcRowNum: e.srcRowNum, alsoInMainTab: false,
        matchedId: kept.id,
        remarks: `Belongs on "Projects" only if it is a DIFFERENT job from "${kept.title}" (${kept.id}). Give it a unique "Project Title", then paste this row (everything except Remarks and the columns after it) back onto the "Projects" tab. If it is a duplicate, delete it.`,
      });
      // Null out so the cleanup pass removes it from the main Projects tab.
      e._cs.rows[e._i] = null as unknown as Record<string, Cell>;
      step5bNulled.add(e);
      // Record the clash so assignment/schedule rows that carried the moved
      // ID are held as "ambiguous" with candidate buttons for both options,
      // rather than silently re-pointed at the kept row.
      if (e.id) {
        step5bRemap.set(normKey(e.id), {
          fromId: e.id, fromTitle: e.title, fromSrcRowNum: e.srcRowNum,
          toId: kept.id, toTitle: kept.title, toSrcRowNum: kept.srcRowNum,
        });
        projById.delete(normKey(e.id));
      }
      const pt = byPunctTitle.get(normKey(e.title));
      if (pt) byPunctTitle.set(normKey(e.title), pt.filter(o => o !== e));
    }
    // Only the kept row answers to this name from here on — child rows
    // naming this project now resolve certainly instead of "ambiguous".
    entries.length = 0;
    entries.push(kept);
  }

  // Flush nulled rows from every project sheet.
  if (step5bNulled.size) {
    for (const cs of projSheets) {
      const keepIdx: number[] = [];
      cs.rows.forEach((r, i) => { if (r) keepIdx.push(i); });
      cs.rows       = keepIdx.map(i => cs.rows[i]!);
      cs.srcRows    = keepIdx.map(i => cs.srcRows[i]!);
      cs.srcRowNums = keepIdx.map(i => cs.srcRowNums[i]!);
      cs.report.cleanRows = cs.rows.length;
    }
  }

  for (const mod of ["assignments", "schedule"] as ModuleId[]) {
    const group = byModule.get(mod) ?? [];
    const tab = SHEET_NAME[mod];
    for (const cs of group) {
      const xr = { resolvedInFile: 0, resolvedByAi: 0, resolvedInDb: 0, unresolved: 0 };
      cs.report.crossRef = xr;
      const titleCol = mod === "assignments" ? "Project" : "Project Title";

      type Pending = { i: number; kind: "ambiguous" | "notfound" | "noproject"; cands?: ProjEntry[]; resolved?: boolean };
      const pending: Pending[] = [];

      cs.rows.forEach((r, i) => {
        // Same whitespace cleanup as the project/opportunity ID cells above —
        // a spaced ref ("LEM- 000220") must keep matching the cleaned ID.
        const rawId = String(r["Project ID"] ?? "").trim();
        const id = normalizeTicketId(rawId);
        if (id !== rawId) { r["Project ID"] = id; cs.report.fixes.trimmed++; }
        const title = String(r[titleCol] ?? "").trim();
        // The ID points at a project that step 5b moved to "Projects —
        // Review" (same name as another project). Re-point the row at the
        // kept project so this tab never references a missing ID.
        const remap = id ? step5bRemap.get(normKey(id)) : undefined;
        if (remap) {
          // Two projects share the same name — the one this row pointed at was
          // moved to "Projects — Review". Rather than silently re-pointing the
          // row at the kept project, hold it as "ambiguous" so the user can
          // pick the right project via the candidate buttons in the review UI.
          const cands = [
            { id: remap.fromId, title: remap.fromTitle, srcRowNum: remap.fromSrcRowNum } as ProjEntry,
            { id: remap.toId,   title: remap.toTitle,   srcRowNum: remap.toSrcRowNum   } as ProjEntry,
          ];
          pending.push({ i, kind: "ambiguous", cands });
          return;
        }
        // Certain via ID — a known project OR opportunity ID both count (the
        // import accepts either). With neither tab in the file there is
        // nothing to check against, so IDs pass through untouched.
        if (id && (projById.has(normKey(id)) || oppById.has(normKey(id)) ||
                   (!projSheets.length && !oppSheets.length))) return;

        if (title) {
          // Certain match #1: name matches exactly ONE project, punctuation and all.
          const exact = byExactTitle.get(exactTitleKey(title)) ?? [];
          if (exact.length === 1) {
            if (!id) { r["Project ID"] = exact[0]!.id; cs.report.fixes.idsFilled++; }
            else if (normKey(id) !== normKey(exact[0]!.id)) {
              // The row carried an ID that matches nothing, but the name is a
              // certain match — trust the name, log the replacement.
              review.push({
                sheet: tab, row: cs.srcRowNums[i]!,
                issue: "Project ID corrected from name",
                detail: `This row had Project ID "${id}", which matches no project in the file — but its project name "${title}" matches exactly one project (${exact[0]!.id}). The ID was replaced.`,
                action: `Confirm ${exact[0]!.id} ("${exact[0]!.title}") is the right project for this row on the "${tab}" tab.`,
                level: "check", record: recordLabel(mod, r, cs.srcRows[i]!), data: rowPreview(cs.srcRows[i]!),
              });
              r["Project ID"] = exact[0]!.id;
              cs.report.fixes.idsFilled++;
            }
            xr.resolvedInFile++;
            return;
          }
          if (exact.length > 1) { pending.push({ i, kind: "ambiguous", cands: exact }); return; }

          // Certain match #2: no exact match, but exactly ONE project matches
          // after stripping punctuation ("minor cleanup").
          const variants = byPunctTitle.get(normKey(title)) ?? [];
          if (variants.length === 1) {
            if (!id) { r["Project ID"] = variants[0]!.id; cs.report.fixes.idsFilled++; }
            else if (normKey(id) !== normKey(variants[0]!.id)) {
              // Unknown ID on the row, but the name pins down exactly one
              // project — trust the name, log the replacement.
              review.push({
                sheet: tab, row: cs.srcRowNums[i]!,
                issue: "Project ID corrected from name",
                detail: `This row had Project ID "${id}", which matches no project in the file — but its project name "${title}" matches exactly one project after punctuation cleanup (${variants[0]!.id}). The ID was replaced.`,
                action: `Confirm ${variants[0]!.id} ("${variants[0]!.title}") is the right project for this row on the "${tab}" tab.`,
                level: "check", record: recordLabel(mod, r, cs.srcRows[i]!), data: rowPreview(cs.srcRows[i]!),
              });
              r["Project ID"] = variants[0]!.id;
              cs.report.fixes.idsFilled++;
            }
            review.push({
              sheet: tab, row: cs.srcRowNums[i]!,
              issue: "Matched after punctuation cleanup",
              detail: `"${title}" is not an exact project name, but ignoring punctuation and spacing it matches exactly one project: ${variants[0]!.id} ("${variants[0]!.title}").`,
              action: `Nothing required — just confirm the match looks right on the "${tab}" tab.`,
              level: "info", record: recordLabel(mod, r, cs.srcRows[i]!), data: rowPreview(cs.srcRows[i]!),
            });
            xr.resolvedInFile++;
            return;
          }
          if (variants.length > 1) { pending.push({ i, kind: "ambiguous", cands: variants }); return; }

          // No project matched — try the opportunities in the file. Team
          // assignment and schedule rows may legally point at an opportunity,
          // and when a file with no IDs anywhere had Opportunity IDs minted
          // in step 4b, THIS is what carries those new IDs onto the other
          // tabs. Same strictness: fill only on a CERTAIN match.
          const oppExact = oppByExactTitle.get(exactTitleKey(title)) ?? [];
          const oppMatches = oppExact.length ? oppExact : (oppByPunctTitle.get(normKey(title)) ?? []);
          if (oppMatches.length === 1) {
            const hit = oppMatches[0]!;
            if (!id) { r["Project ID"] = hit.id; cs.report.fixes.idsFilled++; }
            else if (normKey(id) !== normKey(hit.id)) {
              review.push({
                sheet: tab, row: cs.srcRowNums[i]!,
                issue: "ID corrected from name",
                detail: `This row had Project ID "${id}", which matches nothing in the file — but its name "${title}" matches exactly one opportunity (${hit.id}). The ID was replaced.`,
                action: `Confirm ${hit.id} ("${hit.title}") is the right opportunity for this row on the "${tab}" tab.`,
                level: "check", record: recordLabel(mod, r, cs.srcRows[i]!), data: rowPreview(cs.srcRows[i]!),
              });
              r["Project ID"] = hit.id;
              cs.report.fixes.idsFilled++;
            }
            if (!oppExact.length) review.push({
              sheet: tab, row: cs.srcRowNums[i]!,
              issue: "Matched after punctuation cleanup",
              detail: `"${title}" is not an exact name, but ignoring punctuation and spacing it matches exactly one opportunity: ${hit.id} ("${hit.title}").`,
              action: `Nothing required — just confirm the match looks right on the "${tab}" tab.`,
              level: "info", record: recordLabel(mod, r, cs.srcRows[i]!), data: rowPreview(cs.srcRows[i]!),
            });
            xr.resolvedInFile++;
            return;
          }
          if (oppMatches.length > 1) { pending.push({ i, kind: "ambiguous", cands: oppMatches }); return; }
          pending.push({ i, kind: "notfound" });
          return;
        }
        // No title; unknown or blank ID.
        pending.push({ i, kind: id ? "notfound" : "noproject" });
      });

      // Optional read-only DB check for unmatched references (never for
      // ambiguous ones — ambiguity needs a human decision, not more lookups).
      const dbCheckable = pending.filter(p => p.kind === "notfound");
      if (dbCheckable.length && opts.checkDb) {
        const refs = [...new Set(dbCheckable.flatMap(p => {
          const r = cs.rows[p.i]!;
          return [String(r["Project ID"] ?? "").trim(), String(r[titleCol] ?? "").trim()].filter(Boolean);
        }))];
        const found = await dbProjectRefsExist(tenantId, refs);
        for (const p of dbCheckable) {
          const r = cs.rows[p.i]!;
          if (found.has(normKey(String(r["Project ID"] ?? ""))) || found.has(normKey(String(r[titleCol] ?? "")))) {
            p.resolved = true;
            xr.resolvedInDb++;
          }
        }
      }

      // Everything still pending is MOVED to the "<Tab> — Review" sheet.
      const toDrop = pending.filter(p => !p.resolved);
      if (toDrop.length) {
        xr.unresolved = toDrop.length;
        for (const p of toDrop) {
          const r = cs.rows[p.i]!;
          const title = String(r[titleCol] ?? "").trim();
          const ref = title || String(r["Project ID"] ?? "").trim();
          let issue: string, detail: string, action: string, remarks: string;
          let matchedId: string | undefined;
          if (p.kind === "ambiguous") {
            const list = listCandidates(p.cands!);
            matchedId = p.cands!.slice(0, 6).map(c => c.id).join(", ");
            r["Project ID"] = null;   // never keep a guess
            issue = "Project name matches several projects";
            detail = `"${ref}" matches ${p.cands!.length} different projects in your file: ${list}. Picking one would be a guess, so the Project ID was left blank and the row was moved to the "${tab} — Review" tab.`;
            action = `On the "${tab} — Review" tab, type the correct ID into "Project ID", then copy the row (everything except Remarks and the columns after it) to the bottom of the "${tab}" tab.`;
            remarks = `Belongs on "${tab}". The project name matches ${p.cands!.length} projects — pick the right one: ${list}. Type its ID into "Project ID", then copy this row (everything except Remarks and the columns after it) to the bottom of the "${tab}" tab.`;
          } else if (p.kind === "notfound") {
            const olMod = oppLeadIndex.get(normKey(ref)) ??
              oppLeadIndex.get(normKey(String(r["Project ID"] ?? "")));
            if (olMod === "opportunities") {
              // Only reachable when that opportunity carries no Opportunity
              // ID (or the name is ambiguous-free but unmatched) — rows that
              // name an opportunity WITH an ID were resolved above.
              issue = "Opportunity has no ID";
              detail = `This row refers to "${ref}", which is an opportunity on the "${SHEET_NAME[olMod]}" tab — but that opportunity has no Opportunity ID, so this row cannot be linked to it. The row was moved to the "${tab} — Review" tab.`;
              action = `Add an Opportunity ID for "${ref}" on the "${SHEET_NAME[olMod]}" tab (or type the right ID into "Project ID" on the review row), then copy the row (everything except Remarks and the columns after it) to the bottom of the "${tab}" tab.`;
              remarks = `Belongs on "${tab}". "${ref}" is an opportunity on the "${SHEET_NAME[olMod]}" tab but has no Opportunity ID, so this row cannot be linked to it. Give that opportunity an ID (or type the right ID into "Project ID" here), then copy this row (everything except Remarks and the columns after it) to the bottom of the "${tab}" tab.`;
            } else if (olMod) {
              issue = "Refers to a lead, not a project";
              detail = `This row refers to "${ref}", which is a lead (see the "${SHEET_NAME[olMod]}" tab), not a project. ${tab} rows can only be imported against projects or opportunities, so the row was moved to the "${tab} — Review" tab.`;
              action = `If "${ref}" is really a project or opportunity, fix its type and re-upload. If it is a lead, keep this row on the review tab until it becomes one.`;
              remarks = `Belongs on "${tab}". "${ref}" is a lead on the "${SHEET_NAME[olMod]}" tab — ${tab.toLowerCase()} rows can only point at projects or opportunities. If it should be one, fix its type and re-upload; otherwise leave this row here until it becomes one.`;
            } else {
              issue = "Project not found";
              detail = `This row refers to the project "${ref}", but no project with that name or ID exists in the file${opts.checkDb ? " or in the system" : ""}. The row was moved to the "${tab} — Review" tab.`;
              action = `On the "${tab} — Review" tab, correct the project name or type the right ID into "Project ID", then copy the row (everything except Remarks and the columns after it) to the bottom of the "${tab}" tab.`;
              remarks = `Belongs on "${tab}". No project called "${ref}" exists in the file${opts.checkDb ? " or in the system" : ""}. Fix the project name or type the right ID into "Project ID", then copy this row (everything except Remarks and the columns after it) to the bottom of the "${tab}" tab.`;
            }
          } else {
            issue = "No project on this row";
            detail = `This row does not say which project it belongs to — the project column is blank. The row was moved to the "${tab} — Review" tab.`;
            action = `On the "${tab} — Review" tab, fill in "Project ID" (and the project name), then copy the row (everything except Remarks and the columns after it) to the bottom of the "${tab}" tab.`;
            remarks = `Belongs on "${tab}". The project column is blank. Fill in "Project ID" (and the project name), then copy this row (everything except Remarks and the columns after it) to the bottom of the "${tab}" tab.`;
          }
          review.push({
            sheet: tab, row: cs.srcRowNums[p.i]!, issue, detail, action,
            level: "fix",
            record: recordLabel(mod, r, cs.srcRows[p.i]!),
            data: rowPreview(cs.srcRows[p.i]!),
          });
          quarantine.push({ mod, row: r, srcRowNum: cs.srcRowNums[p.i]!, remarks, matchedId });
        }
        const drop = new Set(toDrop.map(p => p.i));
        const keepIdx: number[] = [];
        cs.rows.forEach((_, i) => { if (!drop.has(i)) keepIdx.push(i); });
        cs.rows       = keepIdx.map(i => cs.rows[i]!);
        cs.srcRows    = keepIdx.map(i => cs.srcRows[i]!);
        cs.srcRowNums = keepIdx.map(i => cs.srcRowNums[i]!);
        cs.report.cleanRows = cs.rows.length;
      }
    }
  }

  // 6. Missing mandatory IDs. Assignments/schedule rows were already
  //    cross-checked — a remaining blank ID means the project was found in
  //    the SYSTEM by name, so those stay put (advisory only). On every other
  //    tab the import will reject the row, so it is MOVED to the review sheet.
  for (const [mod, group] of byModule) {
    const reqId = REQUIRED_ID[mod];
    if (!reqId) continue;
    const tab = SHEET_NAME[mod];
    const crossChecked = mod === "assignments" || mod === "schedule";
    for (const cs of group) {
      const dropIdx: number[] = [];
      let missing = 0;
      cs.rows.forEach((r, i) => {
        if (String(r[reqId] ?? "").trim()) return;
        missing++;
        if (crossChecked) {
          if (missing <= 50) review.push({
            sheet: tab, row: cs.srcRowNums[i]!,
            issue: `Missing ${reqId}`,
            detail: `This row has no "${reqId}". The import will not accept the row without one.`,
            action: `Fill in the "${reqId}" column for this record on the "${tab}" tab before importing.`,
            level: "fix",
            record: recordLabel(mod, r, cs.srcRows[i]!),
            data: rowPreview(cs.srcRows[i]!),
          });
          return;
        }
        review.push({
          sheet: tab, row: cs.srcRowNums[i]!,
          issue: `Missing ${reqId}`,
          detail: `This row has no "${reqId}" and the import will not accept it, so it was moved to the "${tab} — Review" tab.`,
          action: `On the "${tab} — Review" tab, fill in "${reqId}", then copy the row (everything except Remarks and the columns after it) to the bottom of the "${tab}" tab.`,
          level: "fix",
          record: recordLabel(mod, r, cs.srcRows[i]!),
          data: rowPreview(cs.srcRows[i]!),
        });
        quarantine.push({
          mod, row: r, srcRowNum: cs.srcRowNums[i]!,
          remarks: `Belongs on "${tab}". "${reqId}" is blank and the import will not accept the row without it. Fill in "${reqId}", then copy this row (everything except Remarks and the columns after it) to the bottom of the "${tab}" tab.`,
        });
        dropIdx.push(i);
      });
      if (dropIdx.length) {
        const drop = new Set(dropIdx);
        const keepIdx: number[] = [];
        cs.rows.forEach((_, i) => { if (!drop.has(i)) keepIdx.push(i); });
        cs.rows       = keepIdx.map(i => cs.rows[i]!);
        cs.srcRows    = keepIdx.map(i => cs.srcRows[i]!);
        cs.srcRowNums = keepIdx.map(i => cs.srcRowNums[i]!);
        cs.report.cleanRows = cs.rows.length;
      }
      if (missing > 0) cs.report.notes.push(crossChecked
        ? `${missing} rows are missing "${reqId}".`
        : `${missing} rows were moved to "${tab} — Review" because "${reqId}" is blank.`);
    }
  }

  // 7. Build the cleaned workbook in EXACT template format.
  // MEMORY: written with the STREAMING WorkbookWriter (rows committed to a
  // temp file as they're added), never a full in-memory Workbook — a full
  // write DOM balloons the same way a full-load parse does and can OOM the
  // worker on client-sized files (see lib/excel.ts header note).
  await status("building", 88, "Building the cleaned Excel file…");
  const tmpXlsx = path.join(
    os.tmpdir(),
    `dc-cleaned-${String(sessionId).replace(/[^\w.-]/g, "_")}-${Date.now()}.xlsx`,
  );
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: tmpXlsx,
    useStyles: true,
    useSharedStrings: false,
  });
  const MODULE_ORDER: ModuleId[] = ["projects", "assignments", "schedule", "team", "opportunities", "leads", "companies"];
  const qByMod = new Map<ModuleId, typeof quarantine>();
  for (const q of quarantine) qByMod.set(q.mod, [...(qByMod.get(q.mod) ?? []), q]);
  let outBuf: Buffer;
  try {
    for (const mod of MODULE_ORDER) {
      const group = byModule.get(mod);
      // Emit the tab if it has rows — or header-only if every row was moved to
      // its review sheet, so "copy back to the <Tab> tab" always has a target.
      if (!group || (!group.some(cs => cs.rows.length) && !qByMod.get(mod)?.length)) continue;
      const ws = wb.addWorksheet(SHEET_NAME[mod]);
      const labels = templateLabels(mod);
      // Column widths must be declared before the first committed row.
      labels.forEach((l, i) => { ws.getColumn(i + 1).width = Math.max(14, Math.min(32, l.length + 6)); });
      const header = ws.addRow(labels);
      header.font = { bold: true, color: { argb: "FFFFFFFF" } };
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3B57" } };
      header.commit();
      for (const cs of group) {
        for (const r of cs.rows) {
          ws.addRow(labels.map(l => {
            const v = r[l];
            return v == null ? null : v;
          })).commit();
        }
      }
      ws.commit();
    }
    // Per-tab review sheets: same columns as the main tab + a final "Remarks"
    // column, then two info-only verification columns: "Source Row" (row number
    // in the ORIGINAL uploaded file) and "Matched ID" (the ID(s) the row
    // collided with / could belong to). Fix the flagged cell, then copy the row
    // (minus Remarks and the info columns after it) to the bottom of the main
    // tab. Flag-only rows (alsoInMainTab) say "do NOT paste".
    for (const mod of MODULE_ORDER) {
      const qRows = qByMod.get(mod);
      if (!qRows?.length) continue;
      const labels = templateLabels(mod);
      const remCol = labels.length + 1;
      const srcCol = labels.length + 2;
      const midCol = labels.length + 3;
      const ws = wb.addWorksheet(`${SHEET_NAME[mod]} — Review`, { views: [{ state: "frozen", ySplit: 1 }] });
      // Column widths + autoFilter must be declared before the first committed row.
      labels.forEach((l, i) => { ws.getColumn(i + 1).width = Math.max(14, Math.min(32, l.length + 6)); });
      ws.getColumn(remCol).width = 90;
      ws.getColumn(srcCol).width = 12;
      ws.getColumn(midCol).width = 30;
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: midCol } };
      const header = ws.addRow([...labels, "Remarks", "Source Row", "Matched ID"]);
      header.font = { bold: true, color: { argb: "FFFFFFFF" } };
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3B57" } };
      header.getCell(remCol).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF9C0006" } };
      header.commit();

      // Rows to fix-and-paste first (source order), flag-only rows last.
      qRows.sort((a, b) =>
        Number(a.alsoInMainTab ?? false) - Number(b.alsoInMainTab ?? false) ||
        a.srcRowNum - b.srcRowNum);
      for (const q of qRows) {
        const r = ws.addRow([...labels.map(l => q.row[l] ?? null), q.remarks, q.srcRowNum, q.matchedId ?? null]);
        const cell = r.getCell(remCol);
        cell.alignment = { wrapText: true, vertical: "top" };
        cell.font = { color: { argb: q.alsoInMainTab ? "FF9C6500" : "FF9C0006" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: q.alsoInMainTab ? "FFFFEB9C" : "FFFFC7CE" } };
        const srcCell = r.getCell(srcCol);
        srcCell.alignment = { vertical: "top" };
        srcCell.font = { color: { argb: "FF6B7280" } };
        const midCell = r.getCell(midCol);
        midCell.alignment = { wrapText: true, vertical: "top" };
        midCell.font = { bold: true, color: { argb: "FF1F3B57" } };
        r.commit();
      }
      ws.commit();
    }
    await wb.commit();
    outBuf = await fs.promises.readFile(tmpXlsx);
  } finally {
    // Always remove the temp file — on error paths the workbook may be only
    // partially written; on success it has already been read into outBuf.
    fs.promises.unlink(tmpXlsx).catch(() => {});
  }

  // 8. Persist report + cleaned file + final status
  const reviewByIssue: Record<string, number> = {};
  for (const it of review) reviewByIssue[it.issue] = (reviewByIssue[it.issue] ?? 0) + 1;

  if (!byModule.size) globalNotes.push("No sheet in the file matched any import template tab.");

  const REVIEW_PERSIST_CAP = 2000;
  if (review.length > REVIEW_PERSIST_CAP) {
    globalNotes.push(`Review list truncated to ${REVIEW_PERSIST_CAP} of ${review.length} items in this report — the "— Review" tabs in the Excel file still contain every moved row.`);
  }

  const report: CleaningReport = {
    sessionId, fileName, tenantId, startedAt,
    finishedAt: new Date().toISOString(),
    sheets: sheetReports,
    reviewCount: review.length,
    reviewByIssue,
    review: review.slice(0, REVIEW_PERSIST_CAP),
    droppedColumns: droppedColumns.slice(0, 60),
    aiCalls,
    notes: globalNotes,
  };
  await saveResult(tenantId, sessionId, report, outBuf);

  // Final status carries a compact summary so the History list can show
  // per-session counts without downloading every full report.
  const mapped = sheetReports.filter(s => s.module);
  const summary: DcSummary = {
    sheets: mapped.length,
    rowsIn:  mapped.reduce((a, s) => a + s.totalRows, 0),
    rowsOut: mapped.reduce((a, s) => a + s.cleanRows, 0),
    fixed:   mapped.reduce((a, s) => a + s.fixes.dates + s.fixes.numbers + s.fixes.emails + s.fixes.idsFilled, 0),
    dupes:   mapped.reduce((a, s) => a + s.duplicates.exactRemoved + s.duplicates.conflictsResolved, 0),
    review:  review.length,
    fix:     review.filter(r => r.level === "fix").length,
    check:   review.filter(r => r.level === "check").length,
    info:    review.filter(r => r.level === "info").length,
  };
  await writeStatus(tenantId, sessionId, {
    stage: "done", pct: 100, message: "Cleaning complete.",
    updatedAt: new Date().toISOString(), fileName, summary,
  });
}
