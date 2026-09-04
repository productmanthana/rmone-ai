// Shared phase-hours derivation + types, used by both the editable
// EditAllocationModal and the read-only PhaseBreakdown shown in the expanded
// team card. Keeping ONE copy of this date-overlap bucketing avoids the two
// views drifting apart.


const DEFAULT_PHASE_COLOR = "var(--rm-green)";

export interface WeekEntry { key: string; hours: number; }
export interface PhaseHourEntry {
  phaseName: string;
  stageStep: number;
  color: string;
  weeks: WeekEntry[];
  // The phase's ACTUAL schedule dates (from /task-data StartDate/DueDate), when
  // known. The weekly grid columns are Monday-aligned, so the first/last week
  // keys can land a day or two off the real phase boundary (e.g. a phase that
  // starts Tue Jun 16 shows in the Mon Jun 15 column). Carry the true dates so
  // the per-phase range label can show what the Schedule tab shows, not the
  // Monday-aligned week start.
  phaseStart?: string;
  phaseEnd?: string;
  // True when derivePhaseHours pre-filled this phase's weeks with the
  // work-week default because NO saved hours existed anywhere in the phase.
  // Only set when the caller opts in via `defaultWeeklyHours` (the edit
  // modal); read-only surfaces never pass it, so they mirror stored data.
  defaulted?: boolean;
}

/** A dated project phase normalized from the authoritative /task-data payload.
 * Shared planner consumers use these fields to align their weekly columns to
 * the Schedule tab without depending on a particular API row shape. */
export interface PlannerSchedulePhase {
  title: string;
  stageStep: number;
  start: string;
  end: string;
  color: string;
}

export type PlannerScheduleState = "loading" | "ready" | "no-lifecycle" | "no-dates" | "error" | "disabled";

export interface PlannerSchedule {
  state: PlannerScheduleState;
  phases: PlannerSchedulePhase[];
  /** Named lifecycle phases that lack one or both usable schedule dates. */
  missingDateCount: number;
}

/**
 * Fair, no-bias distribution of a total across weeks: hours divided as evenly
 * as possible, with the small rounding remainder spread one-per-week from the
 * front — never capped at the hours-per-week setting and never dumped onto a
 * single week. Shared by the modal's "Spread evenly" button and the editable
 * phase-total field so the two can never disagree.
 */
export function spreadTotalOverWeeks(weeks: WeekEntry[], total: number): WeekEntry[] {
  const n = weeks.length;
  const t = Math.max(0, Math.round(total));
  if (n === 0) return weeks;
  const base = Math.floor(t / n);
  let rem = t - base * n;
  return weeks.map((w) => ({ ...w, hours: base + (rem-- > 0 ? 1 : 0) }));
}

export interface AllocationRow {
  ID?: number;
  ProjectID?: string;
  AssignedTo?: string;
  AssignedToName?: string;
  ResourceId?: string;
  ResourceID?: string;
  ResourceName?: string;
  FirstName?: string;
  LastName?: string;
  PctAllocation?: number;
  Percentage?: number;
  IsModified?: boolean;
  [key: string]: unknown;
}

export interface AllocationsResponse {
  objProjectLifeCycle?: Array<{ Title?: string; StageStep?: number; ItemOrder?: number }>;
  ExistingAllocations?: AllocationRow[];
  NewAllocations?: AllocationRow[];
}

export interface PhasePerson {
  name: string;
  resourceId?: string;
  /** Assignment start (local midnight). Weeks entirely before this are hidden. */
  memberStart?: Date | null;
  /** Assignment end (local midnight). Weeks entirely after this are hidden. */
  memberEnd?: Date | null;
}

/** Format a weekly column key "DD-Mon-YY" → "DD Mon" for display. */
export const fmtWeekLabel = (wk: string) => {
  const parts = wk.split("-");
  return `${parts[0]} ${parts[1]}`;
};

const PHASE_ABBR_MAP: Record<string, string> = {
  "PD": "Pre-Design",
  "SD": "Schematic Design",
  "DD": "Design Development",
  "CD": "Construction Documents",
  "BP": "Bidding & Permitting",
  "BN": "Bidding & Negotiation",
  "CA": "Construction Administration",
  "PCA": "Pre-Construction Administration",
};

export const expandPhaseName = (raw: string): string => {
  const t = (raw ?? "").trim();
  if (!t) return t;
  const direct = PHASE_ABBR_MAP[t.toUpperCase()];
  if (direct) return direct;
  // Handle suffixes like "CD (Past)" or "CA - Future"
  const m = t.match(/^([A-Za-z]{2,4})(\s*[-(\s].*)$/);
  if (m) {
    const expanded = PHASE_ABBR_MAP[m[1].toUpperCase()];
    if (expanded) return `${expanded}${m[2]}`;
  }
  return t;
};

/** Parse a weekly column key "DD-Mon-YY" → Date (local midnight). */
export function parseWeekKey(s: string): Date | null {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{2})$/.exec(s);
  if (!m) return null;
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const mo = months[m[2]];
  if (mo === undefined) return null;
  return new Date(2000 + Number(m[3]), mo, Number(m[1]));
}

/** Parse an RM ONE schedule date (ISO date/datetime or "YYYY-MM-DD") → Date
 *  at LOCAL midnight so comparisons line up with parseWeekKey. Returns null
 *  for empty / sentinel ("0001-…") values. */
export function parseScheduleDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.startsWith("0001")) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const PLANNER_PHASE_COLORS = [
  "var(--rm-green)", "#38BDF8", "#FB923C", "#A78BFA",
  "#2DD4BF", "#F472B6", "#FBBF24", "#F87171",
];

/**
 * Normalize the same Project Phase Schedule rows (`/task-data`) consumed by
 * Edit Allocation. An empty named-phase list means no lifecycle; named phases
 * with no usable date range means lifecycle exists but schedule dates are not
 * set. Invalid/reversed ranges count as missing rather than silently becoming
 * a planning window.
 */
export function derivePlannerSchedule(schedulePhasesRaw: unknown): PlannerSchedule {
  // getTaskData historically returns its task rows directly, but some sources
  // retain the API envelope. Accept both established shapes so an otherwise
  // valid lifecycle is never misreported as absent.
  const raw: unknown[] = Array.isArray(schedulePhasesRaw)
    ? schedulePhasesRaw
    : Array.isArray((schedulePhasesRaw as any)?.Data)
      ? (schedulePhasesRaw as any).Data
      : Array.isArray((schedulePhasesRaw as any)?.data)
        ? (schedulePhasesRaw as any).data
        : [];
  const named = raw
    .map((value: any, index) => ({
      title: expandPhaseName(String(value?.Title ?? value?.Alias ?? "").trim()),
      stageStep: Number(value?.StageStep ?? value?.ItemOrder ?? index + 1),
      start: parseScheduleDate(value?.StartDate),
      end: parseScheduleDate(value?.DueDate ?? value?.EndDate),
      index,
    }))
    .filter((phase) => phase.title)
    .sort((a, b) => (a.stageStep - b.stageStep) || (a.index - b.index));

  if (named.length === 0) {
    return { state: "no-lifecycle", phases: [], missingDateCount: 0 };
  }

  const dated = named.filter((phase) => phase.start && phase.end && phase.start <= phase.end);
  if (dated.length === 0) {
    return { state: "no-dates", phases: [], missingDateCount: named.length };
  }

  return {
    state: "ready",
    phases: dated.map((phase, index) => ({
      title: phase.title,
      stageStep: Number.isFinite(phase.stageStep) ? phase.stageStep : index + 1,
      start: toISODate(phase.start!),
      end: toISODate(phase.end!),
      color: PLANNER_PHASE_COLORS[index % PLANNER_PHASE_COLORS.length],
    })),
    missingDateCount: named.length - dated.length,
  };
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format a Date → "DD-Mon-YY" (the week-key shape RM ONE uses). */
export function fmtWeekKey(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd}-${MONTH_ABBR[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
}

/** Format a Date → "YYYY-MM-DD" (stable, parseable phase-date storage). */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Format a schedule date ("YYYY-MM-DD"/ISO) → "DD Mon" for display. */
export function fmtDateLabel(v: unknown): string {
  const d = parseScheduleDate(v);
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")} ${MONTH_ABBR[d.getMonth()]}`;
}

/** Monday on/before the given date (RM ONE weeks are Monday-aligned). */
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** All Monday week-starts that overlap [start, due], inclusive. */
export function enumerateWeekMondays(start: Date, due: Date): Date[] {
  const out: Date[] = [];
  const end = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  let cur = mondayOf(start);
  let guard = 0;
  while (cur <= end && guard < 520) {
    out.push(new Date(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 7);
    guard++;
  }
  return out;
}

/** The exact union of Monday week columns touched by dated schedule phases.
 * Deliberately does not fill gaps between phases: a phase-free week must never
 * appear as an editable schedule-planning week. */
export function enumeratePlannerScheduleWeeks(phases: PlannerSchedulePhase[]): Date[] {
  const byIso = new Map<string, Date>();
  for (const phase of phases) {
    const start = parseScheduleDate(phase.start);
    const end = parseScheduleDate(phase.end);
    if (!start || !end || start > end) continue;
    for (const monday of enumerateWeekMondays(start, end)) {
      byIso.set(toISODate(monday), monday);
    }
  }
  return Array.from(byIso.values()).sort((a, b) => a.getTime() - b.getTime());
}

/** Sum hours across a phase's weeks. */
export const getPhaseTotal = (ph: PhaseHourEntry) => ph.weeks.reduce((s, w) => s + w.hours, 0);

const MONTH_NUM: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/**
 * Locate the saved allocation row for ONE member from the full project grid,
 * synthesizing a minimal record when no row exists yet so a save isn't blocked.
 * Shared by the modal AND the inline phase-matrix editor so the identity fields
 * a save carries (DivisionLookup/JobTitleLookup/Title etc.) are resolved the
 * exact same way in both places — see weekly-hours-save-identity.
 */
export function matchMemberAlloc(
  rawData: AllocationsResponse | null,
  person: { name: string; resourceId?: string; pct?: number },
  projectId: string,
): AllocationRow | null {
  if (!rawData) return null;
  const normTarget = person.name.trim().toLowerCase();
  const normWords = normTarget.split(/\s+/).filter(Boolean);
  const resId = (person.resourceId ?? "").trim().toLowerCase();
  const GUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rowPersonId = (ea: AllocationRow) =>
    String(ea.ResourceId ?? ea.ResourceID ?? ea.AssignedTo ?? "").trim().toLowerCase();
  // Exact person-id match wins outright, checked across ALL rows before any
  // name matching. Display names are NOT unique — a tenant can hold two
  // enabled accounts named "Matthew Johnson" — and a name-first match can
  // return the OTHER account's row; the save payload then carries that
  // account's AssignedTo and silently re-adds someone the user never picked.
  const idMatchFn = (ea: AllocationRow) => resId !== "" && rowPersonId(ea) === resId;
  const nameMatchFn = (ea: AllocationRow) => {
    // A row carrying a DIFFERENT person GUID is a different person, no matter
    // how well the display name matches (duplicate-name accounts). Only guard
    // when both sides are GUID-shaped — some tenants store display names in
    // the id columns, where a GUID-vs-name mismatch is meaningless.
    const rid = rowPersonId(ea);
    if (GUID_SHAPE.test(rid) && GUID_SHAPE.test(resId) && rid !== resId) return false;
    const assignN = (ea.AssignedToName ?? "").trim().toLowerCase();
    if (assignN && assignN === normTarget) return true;
    const full = `${ea.FirstName ?? ""} ${ea.LastName ?? ""}`.trim().toLowerCase();
    const resName = (ea.ResourceName ?? "").trim().toLowerCase();
    if (full && full === normTarget) return true;
    if (resName && resName === normTarget) return true;
    const fullWords = (assignN || full).split(/\s+/).filter(Boolean);
    if (
      normWords.length >= 2 && fullWords.length >= 2 &&
      normWords[0] === fullWords[0] &&
      normWords[normWords.length - 1] === fullWords[fullWords.length - 1]
    ) return true;
    return false;
  };

  const existingAllocs = rawData.ExistingAllocations ?? [];
  const newAllocsArr = rawData.NewAllocations ?? [];
  let row = existingAllocs.find(idMatchFn) ?? existingAllocs.find(nameMatchFn) ?? null;
  if (!row) {
    const newRec = newAllocsArr.find(idMatchFn) ?? newAllocsArr.find(nameMatchFn);
    if (newRec) row = { ...newRec, Percentage: 0, IsModified: true };
  }
  if (!row) {
    row = {
      ID: 0,
      ProjectID: projectId,
      AssignedTo: person.resourceId ?? "",
      AssignedToName: person.name,
      PctAllocation: person.pct ?? 0,
      Percentage: 0,
      IsModified: true,
    };
  }
  return row;
}

/**
 * Build the per-week Allocations payload from the edited phase grid + the
 * member's base allocation row. Carries every identity field off memberAlloc
 * (minus the per-week date columns and stage markers) onto each week so the
 * UpdateBatchWeekly save resolves correctly. Shared by the modal and the
 * inline matrix editor.
 */
export function buildWeeklyAllocations(
  phaseHours: PhaseHourEntry[],
  memberAlloc: AllocationRow,
): Record<string, unknown>[] {
  const baseFields: Record<string, unknown> = {};
  const skipKeys = new Set(["AllocationStartDate", "AllocationEndDate", "AllocationHour", "isChanged"]);
  for (const k of Object.keys(memberAlloc)) {
    if (
      !skipKeys.has(k) &&
      !k.includes("_stageStep") &&
      !k.includes("_stageColor") &&
      !/^\d{2}-[A-Za-z]{3}-\d{2}$/.test(k)
    ) {
      baseFields[k] = (memberAlloc as Record<string, unknown>)[k];
    }
  }

  // Sum hours per UNIQUE week across every phase row. The saved record is
  // per-week and phase-agnostic, so a week that carries hours under more than
  // one phase (e.g. a resource splitting a week between a finishing and a
  // starting phase, now that the matrix lets any cell be edited) must collapse
  // to a single record — otherwise the same week emits duplicate, conflicting
  // rows. For the non-overlapping accordion editor this is a no-op.
  const perWeek = new Map<string, number>();
  for (const ph of phaseHours) {
    for (const wk of ph.weeks) {
      perWeek.set(wk.key, (perWeek.get(wk.key) ?? 0) + wk.hours);
    }
  }

  const orderedWeeks = Array.from(perWeek.entries()).sort((a, b) => {
    const da = parseWeekKey(a[0]), db = parseWeekKey(b[0]);
    if (!da || !db) return a[0].localeCompare(b[0]);
    return da.getTime() - db.getTime();
  });

  const allocations: Record<string, unknown>[] = [];
  for (const [key, hours] of orderedWeeks) {
    const parts = key.split("-");
    const yr = "20" + parts[2];
    const mo = MONTH_NUM[parts[1]] ?? "01";
    const dy = parts[0];
    const startDate = `${yr}-${mo}-${dy}T00:00:00`;
    const sd = new Date(`${yr}-${mo}-${dy}`);
    const ed = new Date(sd);
    ed.setDate(ed.getDate() + 6);
    const endDate =
      `${ed.getFullYear()}-${String(ed.getMonth() + 1).padStart(2, "0")}-${String(ed.getDate()).padStart(2, "0")}T00:00:00`;
    allocations.push({
      ...baseFields,
      AllocationStartDate: startDate,
      AllocationEndDate: endDate,
      // In the weekly-hours contract PctAllocation is a legacy mirror of raw
      // hours, not a percentage. A member's base row can carry a historical
      // whole-assignment total here (for example 602); never let that stale
      // value travel with a 4h weekly edit and trip the server's 168h guard.
      PctAllocation: hours,
      AllocationHour: hours,
      isChanged: true,
    });
  }
  return allocations;
}

/**
 * Build a complete ISO week→hours replacement through the same allocation-row
 * payload builder used by the Project/Opportunity Team editor. The phase labels
 * are intentionally irrelevant here: buildWeeklyAllocations collapses them into
 * one canonical row per week while preserving the real member allocation
 * metadata (IDs, org lookups, role fields, and other server identity fields).
 */
export function buildTeamWeeklyAllocations(
  weekMap: Record<string, number>,
  memberAlloc: AllocationRow,
): Record<string, unknown>[] {
  const weeks = Object.entries(weekMap)
    .filter(([week]) => /^\d{4}-\d{2}-\d{2}$/.test(week))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, hours]) => {
      const [year, month, day] = week.split("-").map(Number);
      return {
        key: fmtWeekKey(new Date(year, month - 1, day)),
        hours,
      };
    });
  return buildWeeklyAllocations([{
    phaseName: "Unscheduled",
    stageStep: 0,
    color: DEFAULT_PHASE_COLOR,
    weeks,
  }], memberAlloc);
}

/**
 * Build the minimal canonical weekly-hours payload for a known team member.
 *
 * The direct Team Allocation workspace has the selected person's stable GUID
 * and every visible week already, so it must not fetch the project's full
 * allocation matrix merely to copy an existing row before saving. The
 * /hours-allocation contract only needs this identity, role metadata, and the
 * exact weekly values. Zero-hour rows are intentionally retained: posting
 * those rows is how an existing member's entire weekly plan is cleared.
 */
export function buildDirectWeeklyAllocations(
  member: { personId: string; personName: string; role: string },
  weeks: Array<{ week: string; hours: number }>,
): Record<string, unknown>[] {
  return weeks
    .filter(({ week }) => /^\d{4}-\d{2}-\d{2}$/.test(week))
    .map(({ week, hours }) => {
      const [year, month, day] = week.split("-").map(Number);
      const weekStart = new Date(year, month - 1, day);
      const weekEnd = new Date(year, month - 1, day + 6);
      const toIsoLocalMidnight = (date: Date) =>
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T00:00:00`;
      return {
        AssignedTo: member.personId,
        AssignedToName: member.personName,
        // saveWeeklyHoursRds uses this when it needs to repair an old RA-only
        // membership into an RWI row; normal saves retain their existing role.
        TypeName: member.role,
        RoleName: member.role,
        AllocationStartDate: `${week}T00:00:00`,
        AllocationEndDate: toIsoLocalMidnight(weekEnd),
        // PctAllocation is the legacy mirror of weekly raw HOURS here, not a
        // percentage. Keep it in lockstep with AllocationHour for the server's
        // integrity guard and post-save team totals.
        // Do not clamp here. The planner preflight blocks invalid values and
        // the server is the final integrity gate. Preserving the raw number
        // ensures a bypass receives a clear rejection instead of saving 168h.
        PctAllocation: hours,
        AllocationHour: hours,
        isChanged: true,
      };
    });
}

/**
 * Spread a member's TOTAL hours evenly across every currently-known week
 * (total ÷ weeks, whole hours, first N weeks absorb the +1 rounding,
 * fractional remainder on the last week) and return the ready-to-save
 * allocation rows. Total never changes — only how it's paced across weeks.
 *
 * Shared by PhaseBreakdown's "Distribute evenly" button AND the Edit
 * Assignment flow's automatic backward-extension rebalance, so a date
 * range extended earlier (new leading weeks appear at 0h) gets the exact
 * same fair redistribution as an explicit manual click, instead of
 * silently leaving the new weeks stuck at 0.
 */
export function computeEvenSpreadDraft(
  phaseHours: PhaseHourEntry[],
): PhaseHourEntry[] | null {
  const seenKeys = new Set<string>();
  const weekKeys: string[] = [];
  for (const p of phaseHours) for (const w of p.weeks) if (!seenKeys.has(w.key)) { seenKeys.add(w.key); weekKeys.push(w.key); }
  const grandTotal = phaseHours.reduce((s, p) => s + getPhaseTotal(p), 0);
  if (weekKeys.length === 0 || grandTotal <= 0) return null;

  const weeksN = weekKeys.length;
  const base = Math.floor(grandTotal / weeksN);
  const extra = Math.floor(grandTotal - base * weeksN);
  const fraction = Math.round((grandTotal - base * weeksN - extra) * 100) / 100;
  const valueByKey = new Map<string, number>();
  weekKeys.forEach((k, i) => {
    let v = i < extra ? base + 1 : base;
    if (i === weeksN - 1 && fraction > 0) v = Math.round((v + fraction) * 100) / 100;
    valueByKey.set(k, v);
  });

  const seen = new Set<string>();
  return phaseHours.map((p) => ({
    ...p,
    weeks: p.weeks.map((w) => {
      if (seen.has(w.key)) return { ...w, hours: 0 };
      seen.add(w.key);
      return { ...w, hours: valueByKey.get(w.key) ?? 0 };
    }),
  }));
}

export function buildEvenSpreadAllocations(
  phaseHours: PhaseHourEntry[],
  memberAlloc: AllocationRow,
): Record<string, unknown>[] | null {
  const evenDraft = computeEvenSpreadDraft(phaseHours);
  return evenDraft ? buildWeeklyAllocations(evenDraft, memberAlloc) : null;
}

/**
 * Apply ONE fixed hours/week value to every currently-known week (unlike
 * buildEvenSpreadAllocations, the total is NOT held constant — every week
 * simply gets set to the given value). Used by the "Set specific hours per
 * week" quick action, which asks for a single number instead of opening the
 * full per-week grid.
 */
export function computeFlatDraft(
  phaseHours: PhaseHourEntry[],
  hoursPerWeek: number,
): PhaseHourEntry[] | null {
  const seenKeys = new Set<string>();
  const weekKeys: string[] = [];
  for (const p of phaseHours) for (const w of p.weeks) if (!seenKeys.has(w.key)) { seenKeys.add(w.key); weekKeys.push(w.key); }
  if (weekKeys.length === 0 || hoursPerWeek < 0) return null;

  const seen = new Set<string>();
  return phaseHours.map((p) => ({
    ...p,
    weeks: p.weeks.map((w) => {
      if (seen.has(w.key)) return { ...w, hours: 0 };
      seen.add(w.key);
      return { ...w, hours: hoursPerWeek };
    }),
  }));
}

export function buildFlatAllocations(
  phaseHours: PhaseHourEntry[],
  memberAlloc: AllocationRow,
  hoursPerWeek: number,
): Record<string, unknown>[] | null {
  const flatDraft = computeFlatDraft(phaseHours, hoursPerWeek);
  return flatDraft ? buildWeeklyAllocations(flatDraft, memberAlloc) : null;
}

/**
 * Derive the per-phase weekly hours for ONE member from the full project
 * allocations grid + the authoritative Project Phase Schedule (/task-data).
 * Identical logic to what the edit modal used inline, extracted so the
 * read-only card breakdown and the editable modal can never diverge.
 */
export function derivePhaseHours(
  data: AllocationsResponse | null,
  schedulePhasesRaw: any[],
  person: PhasePerson,
  opts?: {
    /** EDITOR-ONLY opt-in: pre-fill every week of a phase that has NO saved
        hours with this many hours (the Settings work-week value), so a fresh
        member starts at full-time instead of a wall of zeros. Read-only
        displays must NOT pass this — they must mirror stored data verbatim. */
    defaultWeeklyHours?: number;
  },
): PhaseHourEntry[] {
  const phases = data?.objProjectLifeCycle ?? [];
  const eaList = data?.ExistingAllocations ?? [];
  const naList = data?.NewAllocations ?? [];
  const resId = person.resourceId ?? "";
  const normName = person.name.trim().toLowerCase();

  const matchFn = (r: AllocationRow) => {
    const n = (r.AssignedToName ?? "").trim().toLowerCase();
    if (n && n === normName) return true;
    if (resId && String(r.AssignedTo ?? r.ResourceId ?? r.ResourceID ?? "") === resId) return true;
    const full = `${r.FirstName ?? ""} ${r.LastName ?? ""}`.trim().toLowerCase();
    if (full && full === normName) return true;
    return false;
  };

  const memberRows = [...naList.filter(matchFn), ...eaList.filter(matchFn)];
  const summaryRow = naList.find((r) => !(r.AssignedToName ?? "").trim());
  const memberRow = memberRows[0] ?? summaryRow;

  // Clip displayed weeks to the person's assignment window when provided.
  // This prevents old weekly RA rows from a prior assignment (which the DB
  // may still hold) from showing hours outside the current [start, end] span.
  const assignStart = person.memberStart ?? null;
  const assignEnd   = person.memberEnd   ?? null;

  // Authoritative Project Phase Schedule (/task-data) → sorted phases.
  // Also keep a name-only list for the case where a lifecycle IS assigned but
  // no schedule dates have been saved yet (placeholders with empty Start/Due).
  const rawPhaseArr = Array.isArray(schedulePhasesRaw) ? schedulePhasesRaw : [];
  const sched = rawPhaseArr
    .map((p: any) => ({
      title: expandPhaseName(String(p.Title ?? p.Alias ?? "").trim()),
      step: Number(p.StageStep ?? p.ItemOrder ?? 0),
      start: parseScheduleDate(p.StartDate),
      due: parseScheduleDate(p.DueDate ?? p.EndDate),
    }))
    .filter((p) => p.title && p.start && p.due)
    .sort((a, b) => a.step - b.step);
  // Lifecycle-assigned, no dates yet: phases have titles but no valid dates.
  const schedNames = rawPhaseArr
    .map((p: any) => ({
      title: expandPhaseName(String(p.Title ?? p.Alias ?? "").trim()),
      step: Number(p.StageStep ?? p.ItemOrder ?? 0),
    }))
    .filter((p) => p.title)
    .sort((a, b) => a.step - b.step);

  let entries: PhaseHourEntry[] = [];

  if (memberRow || summaryRow) {
    const dateKeyRe = /^\d{2}-[A-Za-z]{3}-\d{2}$/;
    const weekKeysSet = new Set<string>();
    const allRows = [...memberRows, ...(summaryRow ? [summaryRow] : [])];
    for (const row of allRows) {
      for (const k of Object.keys(row)) {
        if (dateKeyRe.test(k) && !k.includes("_")) weekKeysSet.add(k);
      }
    }
    const weekDateKeys = Array.from(weekKeysSet).sort((a, b) => {
      const da = parseWeekKey(a), db = parseWeekKey(b);
      if (!da || !db) return 0;
      return da.getTime() - db.getTime();
    });
    const stageSource = summaryRow ?? memberRow;

    // PRIMARY — authoritative Project Phase Schedule (/task-data) mapped
    // to weeks by DATE-RANGE overlap, so the phase list matches the real
    // RM ONE Schedule tab exactly (names, order, week counts).
    if (sched.length > 0) {
      const buckets = sched.map((p) => ({ ...p, color: "", weeks: [] as WeekEntry[] }));
      const otherWeeks: WeekEntry[] = [];
      for (const wk of weekDateKeys) {
        const wkStart = parseWeekKey(wk);
        const wkEnd = wkStart ? new Date(wkStart.getTime() + 6 * 864e5) : null;
        // Skip weeks entirely outside the assignment window.
        if (wkStart && assignStart && wkEnd && wkEnd < assignStart) continue;
        if (wkStart && assignEnd  && wkStart > assignEnd)            continue;
        let hours = 0;
        for (const row of memberRows) {
          const v = Number((row as Record<string, unknown>)[wk] ?? 0);
          if (!isNaN(v)) hours += v;
        }
        let placed = false;
        if (wkStart && wkEnd) {
          for (const b of buckets) {
            if (wkStart <= b.due! && wkEnd >= b.start!) {
              b.weeks.push({ key: wk, hours });
              if (!b.color) {
                const cr = (stageSource as Record<string, unknown> | undefined)?.[`${wk}_stageColor`];
                b.color = (typeof cr === "string" && cr) ? cr : DEFAULT_PHASE_COLOR;
              }
              placed = true;
              break;
            }
          }
        }
        if (!placed) otherWeeks.push({ key: wk, hours });
      }

      // NO smoothing / redistribution of any kind: this grid must mirror the
      // Team List's stored weekly rows verbatim, week for week. Any heuristic
      // that rewrites a displayed week (e.g. the old "lump-sum" spreader)
      // makes the two views disagree and confuses users — both views share
      // the same backend rows, so they must show the same numbers.

      // Every phase must show its full Monday-aligned week span from the
      // authoritative schedule — including weeks the backend never persisted.
      // A week that carried 0 hours is dropped on save (hr=0 rows are
      // suppressed as phantom rows), so a phase that kept SOME weeks would
      // otherwise silently lose its empty schedule weeks — most visibly the
      // leading week of a phase that starts mid-week (e.g. Preconstruction
      // starting Tue Jun 23 loses its Mon Jun 22 column once any later week
      // gets hours). Backfill missing weeks into EVERY bucket, not just empty
      // ones, honoring `claimed` so a week straddling two phases stays in a
      // single column (first overlapping phase wins, matching the loop above).
      const claimed = new Set<string>();
      for (const b of buckets) for (const w of b.weeks) claimed.add(w.key);
      for (const b of buckets) {
        for (const mon of enumerateWeekMondays(b.start!, b.due!)) {
          // Don't backfill weeks outside the assignment window.
          if (assignStart && mon < assignStart) continue;
          if (assignEnd   && mon > assignEnd)   continue;
          const key = fmtWeekKey(mon);
          if (claimed.has(key)) continue;
          claimed.add(key);
          b.weeks.push({ key, hours: 0 });
        }
        b.weeks.sort((x, y) => {
          const dx = parseWeekKey(x.key), dy = parseWeekKey(y.key);
          if (!dx || !dy) return x.key.localeCompare(y.key);
          return dx.getTime() - dy.getTime();
        });
      }
      for (const b of buckets) {
        if (b.weeks.length > 0) {
          entries.push({ phaseName: b.title, stageStep: b.step, color: b.color || DEFAULT_PHASE_COLOR, weeks: b.weeks, phaseStart: toISODate(b.start!), phaseEnd: toISODate(b.due!) });
        }
      }
      if (otherWeeks.some((w) => w.hours > 0)) {
        entries.push({ phaseName: "Other / Unscheduled", stageStep: -1, color: DEFAULT_PHASE_COLOR, weeks: otherWeeks });
      }
    }

    // FALLBACK — no authoritative phase captured any week → derive phases
    // from objProjectLifeCycle + per-week _stageStep markers (legacy).
    const hasRealPhase = entries.some((e) => e.stageStep >= 0);
    if (!hasRealPhase && phases.length > 0) {
      const stageMap = new Map<number, { name: string; color: string; weeks: WeekEntry[] }>();
      for (const p of phases) {
        const step = p.StageStep ?? p.ItemOrder ?? 0;
        stageMap.set(step, { name: expandPhaseName(p.Title ?? `Phase ${step}`), color: "", weeks: [] });
      }
      for (const wk of weekDateKeys) {
        const stepRaw = (stageSource as Record<string, unknown> | undefined)?.[`${wk}_stageStep`]
          ?? (memberRow as Record<string, unknown> | undefined)?.[`${wk}_stageStep`];
        const step = typeof stepRaw === "number" ? stepRaw : Number(stepRaw);
        const colorRaw = (stageSource as Record<string, unknown> | undefined)?.[`${wk}_stageColor`]
          ?? (stageSource as Record<string, unknown> | undefined)?.[`P${step}_stageColor`];
        const color = typeof colorRaw === "string" ? colorRaw : "#6BA539";
        let hours = 0;
        for (const row of memberRows) {
          const v = Number((row as Record<string, unknown>)[wk] ?? 0);
          if (!isNaN(v)) hours += v;
        }
        if (!isNaN(step) && stageMap.has(step)) {
          const entry = stageMap.get(step)!;
          entry.weeks.push({ key: wk, hours });
          if (!entry.color) entry.color = color;
        }
      }
      entries = [];
      for (const [step, info] of stageMap) {
        if (info.weeks.length > 0) {
          entries.push({
            phaseName: info.name,
            stageStep: step,
            color: info.color || DEFAULT_PHASE_COLOR,
            weeks: info.weeks,
          });
        }
      }
      entries.sort((a, b) => a.stageStep - b.stageStep);
    }
  }

  // FINAL FALLBACK — the project HAS a real phase schedule but we built no
  // phase rows (e.g. a freshly-assigned member with no weekly grid yet).
  if (entries.length === 0 && sched.length > 0) {
    const seen = new Set<string>();
    for (const p of sched) {
      const weeks: WeekEntry[] = [];
      for (const mon of enumerateWeekMondays(p.start!, p.due!)) {
        const key = fmtWeekKey(mon);
        if (seen.has(key)) continue;
        seen.add(key);
        weeks.push({ key, hours: 0 });
      }
      if (weeks.length > 0) {
        entries.push({ phaseName: p.title, stageStep: p.step, color: DEFAULT_PHASE_COLOR, weeks, phaseStart: toISODate(p.start!), phaseEnd: toISODate(p.due!) });
      }
    }
  }

  // LIFECYCLE-ASSIGNED / NO-DATES FALLBACK — a lifecycle template is assigned
  // (we got named stages back from /task-data) but no schedule dates have been
  // saved to PMMTasks yet, so every stage came back with empty Start/Due and
  // was filtered out of `sched`.  Show the phase names as skeleton rows so the
  // user can see the lifecycle structure.  All actual member hours are collected
  // into an "Other / Unscheduled" row so nothing is hidden.
  if (entries.length === 0 && sched.length === 0 && schedNames.length > 0) {
    for (const p of schedNames) {
      entries.push({ phaseName: p.title, stageStep: p.step, color: DEFAULT_PHASE_COLOR, weeks: [] });
    }
    const dateKeyRe = /^\d{2}-[A-Za-z]{3}-\d{2}$/;
    const unscheduled = new Map<string, number>();
    for (const row of memberRows) {
      for (const k of Object.keys(row)) {
        if (!dateKeyRe.test(k) || k.includes("_")) continue;
        const h = Number((row as Record<string, unknown>)[k] ?? 0);
        if (!isNaN(h) && h > 0) unscheduled.set(k, (unscheduled.get(k) ?? 0) + h);
      }
    }
    if (unscheduled.size > 0) {
      const unscheduledWeeks: WeekEntry[] = Array.from(unscheduled.entries())
        .map(([key, hours]) => ({ key, hours }))
        .sort((a, b) => {
          const da = parseWeekKey(a.key), db = parseWeekKey(b.key);
          if (!da || !db) return a.key.localeCompare(b.key);
          return da.getTime() - db.getTime();
        });
      entries.push({ phaseName: "Other / Unscheduled", stageStep: -1, color: DEFAULT_PHASE_COLOR, weeks: unscheduledWeeks });
    }
  }

  // NO auto-spread here either: even a phase with a single bulk week must be
  // shown exactly as stored — the Team List and this grid share the same
  // backend rows and must always display identical numbers.

  // EDITOR DEFAULT (opt-in): a real phase whose every week is 0 — nothing
  // saved yet, typical right after adding a member — starts each week at the
  // Settings work-week hours instead of forcing the user to type into every
  // week. The entry is flagged so the modal can disclose the default.
  const dflt = Math.max(0, Math.round(opts?.defaultWeeklyHours ?? 0));
  if (dflt > 0) {
    for (const e of entries) {
      if (e.stageStep < 0 || e.weeks.length === 0) continue; // never default "Other / Unscheduled"
      if (e.weeks.some((w) => w.hours > 0)) continue;
      e.weeks = e.weeks.map((w) => ({ ...w, hours: dflt }));
      e.defaulted = true;
    }
  }

  return entries;
}

/**
 * Returns true when the raw /task-data array indicates a lifecycle IS assigned
 * to the project (at least one named stage returned), regardless of whether
 * schedule dates have been saved yet.  Use this to distinguish "no lifecycle"
 * (show "Set up schedule") from "lifecycle assigned, no dates" (different UX).
 */
export function hasLifecycleAssigned(schedulePhasesRaw: any[]): boolean {
  if (!Array.isArray(schedulePhasesRaw)) return false;
  return schedulePhasesRaw.some((p: any) => String(p.Title ?? p.Alias ?? "").trim().length > 0);
}
