/**
 * Deterministic plan executors for the Data Cleaning engine (v2).
 *
 * The AI produces a PLAN (which column goes to which template tab, whether a
 * sheet mixes entities, what a wide date-column series means) — this module
 * EXECUTES it with plain code:
 *
 *   splitSheet   — one mixed source sheet → one virtual work unit per module,
 *                  carrying the project reference into child rows and
 *                  pre-collapsing repeated parent rows (a person-grained
 *                  sheet repeats its project columns on every row; that must
 *                  become ONE project row + N assignment rows, silently).
 *   unpivotWide  — a run of weekly date columns → template-native assignment
 *                  rows (start = first week with hours, end = last week + 6
 *                  days, total = sum). The import pipeline collapses
 *                  duplicate (person, project) pairs and spreads lump hours
 *                  weekly itself, so per-week output rows would be lost.
 *
 * Every virtual row keeps its PARENT source row number — the "Source Row"
 * column in Review sheets must always point at the uploaded file.
 */
import type { PipelineRow } from "../pipeline.js";
import { parseTolerantNumber } from "../pipeline.js";
import { normKey, type ModuleId } from "./template.js";
import { headerToIsoDate, type WideRun } from "./profile.js";

export interface UnitColumnMapEntry { source: string; target: string | null; method: string }

/** One cleanable unit of work: a (possibly virtual) sheet locked to one module. */
export interface WorkUnit {
  module: ModuleId;
  sourceSheet: string;
  /** src column key → template label. For synthesized rows keys ARE labels. */
  mapped: Map<string, string>;
  rows: PipelineRow[];
  rowNums: number[];
  columnMap: UnitColumnMapEntry[];
  notes: string[];
  grain: string | null;
}

/** Modules whose rows describe ONE entity that may repeat across source rows. */
const PARENT_MODULES: ReadonlySet<ModuleId> = new Set([
  "projects", "opportunities", "leads", "companies", "team",
] as ModuleId[]);

/** Per-module identity used for pre-collapsing repeated parent rows. */
const COLLAPSE_KEYS: Partial<Record<ModuleId, { primary: string[]; fallback: string[] }>> = {
  projects:      { primary: ["Project ID"],     fallback: ["Project Title", "Company Name"] },
  opportunities: { primary: ["Opportunity ID"], fallback: ["Opportunity Title"] },
  leads:         { primary: ["Lead ID"],        fallback: ["Lead Name"] },
  companies:     { primary: ["Company Name"],   fallback: ["Company Name"] },
  team:          { primary: ["Login Email"],    fallback: ["Full Name"] },
};

const blank = (v: unknown): boolean => v == null || String(v).trim() === "";

function reverseMap(mapped: Map<string, string>): Map<string, string> {
  const rev = new Map<string, string>();
  for (const [src, label] of mapped) if (!rev.has(label)) rev.set(label, src);
  return rev;
}

/**
 * Collapse repeated parent rows: group by the module's identity key, coalesce
 * blanks (first non-blank value wins per column). Rows with a blank key are
 * kept as-is. Returns rows + rowNums + how many rows were merged away.
 */
function collapseParentRows(
  module: ModuleId,
  mapped: Map<string, string>,
  rows: PipelineRow[],
  rowNums: number[],
): { rows: PipelineRow[]; rowNums: number[]; merged: number } {
  const spec = COLLAPSE_KEYS[module];
  if (!spec) return { rows, rowNums, merged: 0 };
  const rev = reverseMap(mapped);
  const keyOf = (row: PipelineRow): string | null => {
    for (const labels of [spec.primary, spec.fallback]) {
      const parts = labels
        .map(l => rev.get(l))
        .filter((c): c is string => Boolean(c))
        .map(c => normKey(String(row[c] ?? "")))
        .filter(Boolean);
      if (parts.length) return parts.join("|");
    }
    return null;
  };

  const outRows: PipelineRow[] = [];
  const outNums: number[] = [];
  const byKey = new Map<string, number>();  // key → index in outRows
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const key = keyOf(row);
    if (!key) { outRows.push(row); outNums.push(rowNums[i]!); continue; }
    const at = byKey.get(key);
    if (at == null) {
      byKey.set(key, outRows.length);
      outRows.push({ ...row });
      outNums.push(rowNums[i]!);
    } else {
      const acc = outRows[at]!;
      for (const src of mapped.keys()) {
        if (blank(acc[src]) && !blank(row[src])) acc[src] = row[src];
      }
    }
  }
  return { rows: outRows, rowNums: outNums, merged: rows.length - outRows.length };
}

export interface ModuleAssignment {
  mapped: Map<string, string>;
  columnMap: UnitColumnMapEntry[];
}

/**
 * Split one mixed sheet into per-module work units.
 * - Parent modules get pre-collapsed rows (ONE info note, never per-row
 *   conflict spam downstream).
 * - Child modules (assignments, schedule) keep every row and automatically
 *   inherit the project reference columns from the projects assignment when
 *   they lack their own.
 */
export function splitSheet(opts: {
  sheetName: string;
  rows: PipelineRow[];
  rowNums: number[];
  byModule: Map<ModuleId, ModuleAssignment>;
  grain: string | null;
}): WorkUnit[] {
  const { sheetName, rows, rowNums, byModule, grain } = opts;
  const units: WorkUnit[] = [];
  const projects = byModule.get("projects" as ModuleId);
  const projRev = projects ? reverseMap(projects.mapped) : null;

  for (const [module, assign] of byModule) {
    const mapped = new Map(assign.mapped);
    const columnMap = [...assign.columnMap];
    const notes: string[] = [];

    if (!PARENT_MODULES.has(module) && projRev) {
      // Carry project reference into child rows.
      const carries: [string, string][] = module === ("schedule" as ModuleId)
        ? [["Project ID", "Project ID"], ["Project Title", "Project Title"]]
        : [["Project ID", "Project ID"], ["Project Title", "Project"]];
      const childLabels = new Set(mapped.values());
      for (const [projLabel, childLabel] of carries) {
        const src = projRev.get(projLabel);
        if (src && !childLabels.has(childLabel) && !mapped.has(src)) {
          mapped.set(src, childLabel);
          columnMap.push({ source: src, target: childLabel, method: "split-carry" });
        }
      }
    }

    if (PARENT_MODULES.has(module)) {
      const { rows: cRows, rowNums: cNums, merged } = collapseParentRows(module, mapped, rows, rowNums);
      if (merged > 0) {
        notes.push(`${merged} repeated row${merged === 1 ? "" : "s"} merged — expected when several source rows share one ${module === "team" ? "person" : "record"}.`);
      }
      units.push({ module, sourceSheet: sheetName, mapped, rows: cRows, rowNums: cNums, columnMap, notes, grain });
    } else {
      units.push({ module, sourceSheet: sheetName, mapped, rows, rowNums: [...rowNums], columnMap, notes, grain });
    }
  }
  return units;
}

function toNumberLoose(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // Shared tolerant coercer (pipeline.ts) — same acceptance as the cleaning
  // step and the import pipeline ("$1,200", "(40)", "N/A" → null, …).
  return parseTolerantNumber(v);
}

function addDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

/**
 * Unpivot a wide weekly-hours grid into template-native assignment rows:
 * ONE row per source row (person×project) with Start Date = first week that
 * has hours, End Date = last such week + 6 days, Total Hours = sum.
 */
export function unpivotWide(opts: {
  sheetName: string;
  rows: PipelineRow[];
  rowNums: number[];
  run: WideRun;
  /** Scalar source columns already mapped to assignments labels (Name, Project…). */
  scalarMap: Map<string, string>;
  scalarColumnMap: UnitColumnMapEntry[];
  grain: string | null;
}): WorkUnit {
  const { sheetName, rows, rowNums, run, scalarMap, scalarColumnMap, grain } = opts;
  const nowYear = new Date().getFullYear();
  // Same parse as detection; fall back to the current year for year-less headers.
  const headerDates = run.headers.map(h => headerToIsoDate(h) ?? headerToIsoDate(h, nowYear));

  const outRows: PipelineRow[] = [];
  const outNums: number[] = [];
  let skippedEmpty = 0;

  for (let i = 0; i < rows.length; i++) {
    const src = rows[i]!;
    let total = 0;
    let firstIdx = -1, lastIdx = -1;
    for (let h = 0; h < run.headers.length; h++) {
      const n = toNumberLoose(src[run.headers[h]!]);
      if (n == null || n === 0) continue;
      total += n;
      if (firstIdx < 0) firstIdx = h;
      lastIdx = h;
    }
    if (total === 0 || firstIdx < 0) { skippedEmpty++; continue; }

    const row: PipelineRow = {};
    for (const [srcCol, label] of scalarMap) {
      if (!blank(src[srcCol])) row[label] = src[srcCol];
    }
    row["Start Date"] = headerDates[firstIdx] ?? run.firstIso;
    row["End Date"] = addDays(headerDates[lastIdx] ?? run.lastIso, 6);
    row["Total Hours"] = Math.round(total * 100) / 100;
    outRows.push(row);
    outNums.push(rowNums[i]!);
  }

  const mapped = new Map<string, string>();
  for (const label of scalarMap.values()) mapped.set(label, label);
  mapped.set("Start Date", "Start Date");
  mapped.set("End Date", "End Date");
  mapped.set("Total Hours", "Total Hours");

  const columnMap: UnitColumnMapEntry[] = [
    ...scalarColumnMap,
    {
      source: `"${run.headers[0]}" … "${run.headers[run.headers.length - 1]}" (${run.headers.length} weekly columns)`,
      target: "Total Hours",
      method: "unpivot",
    },
  ];

  const notes: string[] = [
    `Week-by-week hours combined into one assignment per row (start = first week with hours, end = last week + 6 days, hours = sum). The import spreads hours evenly across that span.`,
  ];
  if (run.yearAssumed) {
    notes.push(`Weekly column headers had no year — assumed ${nowYear}. Verify the dates before importing.`);
  }
  if (skippedEmpty > 0) {
    notes.push(`${skippedEmpty} row${skippedEmpty === 1 ? "" : "s"} with zero hours across all weeks left out.`);
  }

  return {
    module: "assignments" as ModuleId,
    sourceSheet: sheetName,
    mapped,
    rows: outRows,
    rowNums: outNums,
    columnMap,
    notes,
    grain,
  };
}
