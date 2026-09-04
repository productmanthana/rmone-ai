// ─────────────────────────────────────────────────────────────────────────────
// projectPhases — tenant-wide "which phase is this project in?" lookup.
//
// Source: GET /bulk-schedule (already fetched + 5-min cached by getBulkSchedule
// in lib/api.ts) — one row per PMMTasks phase across ALL projects. This module
// folds those rows into a Map keyed by ticketId and answers "the phase active
// on <date>" per project, so Gantt views can color allocations by phase WITHOUT
// N× per-project /task-data calls.
//
// Resolution rules (matches the approved mockups — ONE phase per project row):
//   • date inside a phase's [start, end]  → that phase
//   • date before the first phase starts  → first phase (upcoming work)
//   • date after the last phase ends      → last phase (project winding down)
//   • date in a gap between phases        → the next upcoming phase
//   • no schedule rows at all             → null → "No Phase" tan fallback
// ─────────────────────────────────────────────────────────────────────────────
import { getBulkSchedule, type BulkScheduleRow } from "@/lib/api";
import { resolvePhaseColor, PHASE_COLORS, type PhaseColor } from "@/lib/phaseColors";

export interface ProjectPhaseEntry {
  name: string;
  order: number;    // schedule position (sorted by start date, then phaseOrder)
  startMs: number;  // NaN when the row has no usable date
  endMs: number;
  startDay: string; // canonical "YYYY-MM-DD" schedule day ("" when unusable) —
                    // day STRING for latch comparisons (lib/manualStatusLatch)
}

export type ProjectPhaseMap = Map<string, ProjectPhaseEntry[]>;

export type ProjectRecordModule = "PMM" | "OPM" | "LEM";

/** Leads can appear in resource allocation data but do not have schedule
 * phases. Keep their record type visible instead of presenting the phase
 * fallback as if it were a missing project phase. */
export function isLeadProject(
  module: ProjectRecordModule | null | undefined,
  ticketId: string | null | undefined,
): boolean {
  return module === "LEM" || /^LD(?:-|$)/i.test((ticketId ?? "").trim());
}

export function projectPhaseDisplayName(
  module: ProjectRecordModule | null | undefined,
  ticketId: string | null | undefined,
  phaseName: string,
): string {
  return isLeadProject(module, ticketId) ? "Lead" : phaseName;
}

function parseMs(v: string, endOfDay = false): number {
  if (!v) return NaN;
  // Schedule dates are inclusive calendar-day windows. Treat an end date as
  // valid through 23:59:59.999, even when the API serializes it at midnight.
  const day = v.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [year, month, date] = day.split("-").map(Number);
    return new Date(year, month - 1, date, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0).getTime();
  }
  return Date.parse(v);
}

// Fold is memoized on the rows array identity — getBulkSchedule() returns the
// same cached array within its TTL, so repeated callers share one fold.
let lastRows: BulkScheduleRow[] | null = null;
let lastMap: ProjectPhaseMap | null = null;

export function foldPhaseMap(rows: BulkScheduleRow[]): ProjectPhaseMap {
  if (rows === lastRows && lastMap) return lastMap;
  const map: ProjectPhaseMap = new Map();
  for (const r of rows) {
    const tid = (r.ticketId || "").trim();
    if (!tid || !r.phaseName) continue;
    let list = map.get(tid);
    if (!list) { list = []; map.set(tid, list); }
    const startDayRaw = (r.startDate || "").slice(0, 10);
    list.push({
      name: r.phaseName,
      order: r.phaseOrder ?? 0,
      startMs: parseMs(r.startDate),
      endMs: parseMs(r.endDate, true),
      startDay: /^\d{4}-\d{2}-\d{2}$/.test(startDayRaw) ? startDayRaw : "",
    });
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      const as = isNaN(a.startMs) ? Infinity : a.startMs;
      const bs = isNaN(b.startMs) ? Infinity : b.startMs;
      if (as !== bs) return as - bs;
      return a.order - b.order;
    });
    list.forEach((p, i) => { p.order = i; });
  }
  lastRows = rows; lastMap = map;
  return map;
}

/** Fetch (client-cached) bulk schedule and fold it. Never throws — a failed
 *  fetch yields an EMPTY map so every project falls back to "No Phase" tan
 *  rather than blocking the view. The empty result is NOT memoized. */
export async function loadProjectPhaseMap(): Promise<ProjectPhaseMap> {
  try {
    const rows = await getBulkSchedule();
    return foldPhaseMap(rows);
  } catch {
    return new Map();
  }
}

export interface CurrentPhase {
  name: string;
  index: number;
  total: number;
}

/** The phase active on `dateMs` (default: now) for a phase list. */
export function currentPhaseOf(
  phases: ProjectPhaseEntry[] | undefined,
  dateMs: number = Date.now(),
): CurrentPhase | null {
  if (!phases || phases.length === 0) return null;
  const total = phases.length;
  // 1. Active: date inside [start, end]
  for (let i = 0; i < total; i++) {
    const p = phases[i];
    if (!isNaN(p.startMs) && !isNaN(p.endMs) && dateMs >= p.startMs && dateMs <= p.endMs) {
      return { name: p.name, index: i, total };
    }
  }
  // 2. Next upcoming phase (covers "before schedule" and gaps)
  let upcoming: { i: number; startMs: number } | null = null;
  for (let i = 0; i < total; i++) {
    const p = phases[i];
    if (!isNaN(p.startMs) && p.startMs > dateMs && (!upcoming || p.startMs < upcoming.startMs)) {
      upcoming = { i, startMs: p.startMs };
    }
  }
  if (upcoming) return { name: phases[upcoming.i].name, index: upcoming.i, total };
  // 3. Past the end → last phase with a usable date, else last row
  for (let i = total - 1; i >= 0; i--) {
    if (!isNaN(phases[i].endMs) || !isNaN(phases[i].startMs)) {
      return { name: phases[i].name, index: i, total };
    }
  }
  return { name: phases[total - 1].name, index: total - 1, total };
}

/** One-stop: phase color for a project on a date. No schedule → No Phase tan. */
export function projectPhaseColor(
  map: ProjectPhaseMap,
  ticketId: string | null | undefined,
  dateMs: number = Date.now(),
): { color: PhaseColor; phaseName: string } {
  const cur = currentPhaseOf(map.get((ticketId || "").trim()), dateMs);
  if (!cur) return { color: PHASE_COLORS["No Phase"], phaseName: "No Phase" };
  return { color: resolvePhaseColor(cur.name, cur.index, cur.total), phaseName: cur.name };
}
