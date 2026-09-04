// ─────────────────────────────────────────────────────────────────────────────
// utilGrid — shared parsing/date helpers for the Resources utilization grid.
//
// Extracted from pages/resources.tsx so the ResourcesTimelineGrid component
// (and any future Gantt view) reads the SAME cell encoding and week math as
// the page-level modals. Do not fork these — drift here silently disagrees
// on hours between the grid and its drill-down modals.
// ─────────────────────────────────────────────────────────────────────────────
import type { ActiveAllocationProxy } from "@/lib/api";

export type UtilMode = "Weekly" | "Monthly";

/** Decoded utilization grid cell: "P:50#H:20#C:2#S:ok#IDS:PMM-1:30|PMM-2:20" */
export interface UtilCellData {
  p: number;
  h: number;
  c: number;
  status: string;
  projectIds?: { pid: string; pct: number }[];
}

export function parseUtilCell(v: unknown): UtilCellData | null {
  if (v == null) return null;
  const s = String(v);
  if (!s) return null;
  const map: Record<string, string> = {};
  for (const part of s.split("#")) {
    const i = part.indexOf(":");
    if (i > -1) map[part.slice(0, i)] = part.slice(i + 1);
  }
  const p = parseFloat(map.P ?? "0") || 0;
  const h = parseFloat(map.H ?? "0") || 0;
  const c = parseInt(map.C ?? "0") || 0;
  const status = map.S ?? "";
  const projectIds = map.IDS
    ? map.IDS.split("|").map(seg => {
        const col = seg.indexOf(":");
        return { pid: col > -1 ? seg.slice(0, col) : seg, pct: col > -1 ? parseInt(seg.slice(col + 1)) || 0 : 0 };
      }).filter(e => e.pid)
    : undefined;
  return { p, h, c, status, projectIds: projectIds?.length ? projectIds : undefined };
}

/* Date-only strings ("2026-03-02") must be parsed as LOCAL midnight — the
   default Date parse treats them as UTC, which shifts week boundaries for
   any user west of UTC and double-counts week-aligned allocation rows.

   RDS occasionally exposes a missing allocation date as numeric 0. Passing
   that through Date() silently turns it into 1 Jan 1970, which in turn makes
   workload drawers start on 29 Dec 1969. Treat every non-string / blank
   boundary as missing rather than inventing a historical allocation. */
export function parseLocalDay(x: unknown): number {
  if (typeof x !== "string") return NaN;
  const value = x.trim();
  if (!value || value === "0") return NaN;
  return new Date(value.length === 10 ? value + "T00:00:00" : value).getTime();
}

export function mondayOf(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // DST-safe day arithmetic
  return d.getTime();
}

/* Parse a util-grid period key like "Jun-29-26" → local ms (NaN if invalid) */
export function parsePeriodKey(p: string): number {
  const m = p.match(/^([A-Z][a-z]{2})-(\d{1,2})-(\d{2})$/);
  if (m) {
    const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].indexOf(m[1]);
    if (mo < 0) return NaN;
    return new Date(2000 + parseInt(m[3], 10), mo, parseInt(m[2], 10)).getTime();
  }
  const dm = p.match(/^(\d{1,2})-([A-Z][a-z]{2})-(\d{2,4})$/);
  if (dm) {
    const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].indexOf(dm[2]);
    if (mo < 0) return NaN;
    const rawYear = parseInt(dm[3], 10);
    return new Date(rawYear < 100 ? 2000 + rawYear : rawYear, mo, parseInt(dm[1], 10)).getTime();
  }
  /* Monthly period keys ("Apr-26") → first day of that month */
  const mm = p.match(/^([A-Z][a-z]{2})-(\d{2})$/);
  if (mm) {
    const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].indexOf(mm[1]);
    if (mo < 0) return NaN;
    return new Date(2000 + parseInt(mm[2], 10), mo, 1).getTime();
  }
  return NaN;
}

const MONTH_NAMES = new Set([
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]);

export function fmtPeriodLabel(p: string, mode: UtilMode): string {
  const parts = p.split("-");
  const monthNum: Record<string, string> = {
    Jan: "1", Feb: "2", Mar: "3", Apr: "4", May: "5", Jun: "6",
    Jul: "7", Aug: "8", Sep: "9", Oct: "10", Nov: "11", Dec: "12",
  };
  if (mode === "Monthly") {
    if (parts[0] && MONTH_NAMES.has(parts[0])) return parts[0];
    if (parts[1] && MONTH_NAMES.has(parts[1])) return parts[1];
    return p;
  }
  // Weekly: try "MMM-dd-yy"
  if (parts[0] && MONTH_NAMES.has(parts[0]) && parts.length >= 2) {
    return `${monthNum[parts[0]]}/${parseInt(parts[1], 10) || parts[1]}`;
  }
  // Weekly: try "dd-MMM-yy"
  if (parts[1] && MONTH_NAMES.has(parts[1])) {
    return `${monthNum[parts[1]]}/${parseInt(parts[0], 10) || parts[0]}`;
  }
  return p;
}

/** Physical ceiling for one person-week: 7 days × 24h. Shared by display
 *  caps AND the inline input caps in the hour editors — the server enforces
 *  the same bound (saveWeeklyHoursRds), so this is UX-only mirroring. */
export const MAX_WEEK_HOURS = 168;
/** Plain-language hint shown when an input is capped at MAX_WEEK_HOURS. */
export const MAX_WEEK_HOURS_HINT = "a week has at most 168 hours";

/** Max total hours for an assignment spanning the given dates — 24h × span
 *  days (min 168, mirroring the server's assignResourceRds gate). Dates are
 *  "YYYY-MM-DD"; unknown/invalid dates fall back to the 7-day floor. */
export function maxAssignmentHours(startYmd?: string, endYmd?: string): { cap: number; days: number } {
  const s = startYmd ? parseLocalDay(startYmd.slice(0, 10)) : NaN;
  const e = endYmd ? parseLocalDay(endYmd.slice(0, 10)) : NaN;
  const days = Number.isFinite(s) && Number.isFinite(e) && e >= s
    ? Math.max(1, Math.round((e - s) / 864e5) + 1)
    : 7;
  return { cap: Math.max(MAX_WEEK_HOURS, days * 24), days };
}

/** Implied hours/week for one allocation entry — real hours when present,
 *  else pct of the tenant's Settings work week (callers pass
 *  getBusinessRules().workWeekHours; this module stays pure so the server
 *  check harness can import it). Must stay in lockstep with the server's
 *  pct-derived H cells (rds-provider utilCell). */
export function allocEntryHrsPerWeek(a: ActiveAllocationProxy, weekHours: number): number {
  const h = (a as { hours?: number }).hours;
  const wwh = weekHours > 0 ? weekHours : 40;
  const wk = h && h > 0 ? h : Math.round(a.pct / 100 * wwh * 10) / 10;
  // Physical ceiling: one person-week can never exceed 168h (7×24). Junk is
  // blocked at every server write path too — this cap just keeps any stale
  // cached row from rendering impossible hours in the grids.
  return Math.min(wk, MAX_WEEK_HOURS);
}

/** Hours-win rule: when a project has a real-hours entry inside the window
 *  being summed, a percent-only entry for that SAME project is the %-plan
 *  those hours replaced (the long container span written by a %-only
 *  assignment) — drop it so plan% + real hours never double-count one week.
 *  Projects with no hour entries are untouched: their % plan still counts.
 *  Callers must pass entries already narrowed to ONE week/day window —
 *  filtering a whole multi-week list would wrongly hide the plan on weeks
 *  the hours don't cover. Mirrors the server's utilization-cell rule. */
export function hoursWinFilter<T extends { projectId?: string; hours?: number }>(entries: T[]): T[] {
  const hourPids = new Set<string>();
  for (const e of entries) if ((e.hours ?? 0) > 0 && e.projectId) hourPids.add(e.projectId);
  if (hourPids.size === 0) return entries;
  return entries.filter(e => (e.hours ?? 0) > 0 || !e.projectId || !hourPids.has(e.projectId));
}

/** One local Monday–Sunday window, annotated with the configured working-day
 * calendar. Resources allocations are weekly buckets, not time-sheet entries:
 * use this solely to explain a weekly plan at day level, never as a save
 * payload or a record of actual hours worked. */
export interface SelectedWeekDay {
  start: number;
  isoDay: string;
  weekday: string;
  shortLabel: string;
  isWorkingDay: boolean;
  holidayLabel?: string;
}

export function selectedWeekDays(
  mondayStart: number,
  nonWorkingDays: readonly number[],
  holidayDates: readonly string[],
): SelectedWeekDay[] {
  const start = mondayOf(mondayStart);
  const nonWorking = new Set(nonWorkingDays);
  const holidays = new Map(
    holidayDates
      .map(value => {
        const [isoDay, label] = value.split("|", 2);
        return [isoDay.trim(), label?.trim() || "Company holiday"] as const;
      })
      .filter(([isoDay]) => /^\d{4}-\d{2}-\d{2}$/.test(isoDay)),
  );
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    const isoDay = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const holidayLabel = holidays.get(isoDay);
    return {
      start: date.getTime(),
      isoDay,
      weekday: date.toLocaleDateString("en-US", { weekday: "short" }),
      shortLabel: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      isWorkingDay: !nonWorking.has(date.getDay()) && !holidayLabel,
      ...(holidayLabel ? { holidayLabel } : {}),
    };
  });
}

/** Distribute a WEEKLY planned allocation over its configured working days.
 * The final working day carries any hundredth-hour remainder, guaranteeing that
 * the visible daily values add up exactly to the weekly total. When no working
 * day exists, return zeroes so callers can expose the weekly total as
 * explicitly undistributed instead of inventing work on a non-working day. */
export function splitWeeklyHoursAcrossDays(
  weeklyHours: number,
  days: readonly Pick<SelectedWeekDay, "isWorkingDay">[],
): number[] {
  const total = Math.round((Math.max(0, weeklyHours) + Number.EPSILON) * 100) / 100;
  const active = days
    .map((day, index) => day.isWorkingDay ? index : -1)
    .filter((index): index is number => index >= 0);
  const out = days.map(() => 0);
  if (active.length === 0) return out;
  let remainder = total;
  for (let position = 0; position < active.length; position++) {
    const slotsLeft = active.length - position;
    const value = position === active.length - 1
      ? remainder
      : Math.round(((remainder / slotsLeft) + Number.EPSILON) * 100) / 100;
    out[active[position]] = value;
    remainder = Math.round(((remainder - value) + Number.EPSILON) * 100) / 100;
  }
  return out;
}

/** Split one authoritative weekly total across project weights without losing
 * a hundredth-hour to per-project rounding. Each intermediate share is rounded
 * to the UI's two-decimal precision; the final project receives the deterministic
 * remainder so the segment sum always equals the source cell. */
export function splitTotalHoursByWeights(
  totalHours: number,
  weights: readonly number[],
): number[] {
  const total = Math.round((Math.max(0, totalHours) + Number.EPSILON) * 100) / 100;
  const normalized = weights.map(weight => Number.isFinite(weight) && weight > 0 ? weight : 0);
  let remainingHours = total;
  let remainingWeight = normalized.reduce((sum, weight) => sum + weight, 0);
  return normalized.map((weight, index) => {
    const slotsLeft = normalized.length - index;
    const isLast = index === normalized.length - 1;
    const rawShare = remainingWeight > 0
      ? remainingHours * weight / remainingWeight
      : remainingHours / Math.max(slotsLeft, 1);
    const share = isLast
      ? remainingHours
      : Math.min(remainingHours, Math.round((rawShare + Number.EPSILON) * 100) / 100);
    remainingHours = Math.round(((remainingHours - share) + Number.EPSILON) * 100) / 100;
    remainingWeight = Math.max(0, remainingWeight - weight);
    return share;
  });
}
