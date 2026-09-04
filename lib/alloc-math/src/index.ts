/**
 * Shared allocation / utilization / demand math — the ONE place where
 * "how allocated is this person over a date window" and "how many open
 * demand positions are there" are defined.
 *
 * Consumed by BOTH the web client (Resources page, Daily Briefing,
 * home intelligence) and the api-server (daily forecast snapshot in
 * routes/alerts.ts), so every surface counts the same way by construction.
 *
 * Background: the /resource-allocations feed's per-resource `currentPct`
 * means "allocated TODAY" — a portfolio whose weekly rows mostly live in
 * the past or future reports ~everyone at 0% even though the window view
 * (quarter, forecast horizon) is fully booked. Every KPI that reasons
 * about utilization must therefore window `allAllocations` with
 * deriveWindowedLoad() instead of trusting raw `currentPct`.
 *
 * Pure module: no imports, no I/O, thresholds passed in as arguments.
 */

/** One allocation entry as served by /resource-allocations (`allAllocations`). */
export interface AllocEntryLike {
  projectId?: string;
  projectName?: string;
  /** Percent-of-week intensity (100 = full week). */
  pct?: number;
  /** Explicit hours-per-week when the tenant tracks hours. */
  hours?: number;
  /** Date-only ISO strings ("2026-03-02"). */
  startDate?: string;
  endDate?: string;
}

/** Minimal resource shape shared by web LiveResourceProxy and the server payload. */
export interface ResourceLike {
  currentPct?: number;
  allAllocations?: AllocEntryLike[];
  activeAllocations?: AllocEntryLike[];
}

/* ── date helpers (local-midnight, DST-safe) ─────────────────────────── */

/** Date-only strings ("2026-03-02") must be parsed as LOCAL midnight — the
 *  default Date parse treats them as UTC, which shifts week boundaries for
 *  any user west of UTC and double-counts week-aligned allocation rows. */
export function parseLocalDay(x: string): number {
  return new Date(x && x.length === 10 ? x + "T00:00:00" : x).getTime();
}

/** Monday (local midnight) of the week containing `t`. */
export function mondayOf(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // DST-safe day arithmetic
  return d.getTime();
}

const DAY_MS = 86_400_000;
const END_OF_DAY_MS = DAY_MS - 1;

/** Hours-per-week an allocation entry represents (explicit hours win;
 *  otherwise pct of the tenant's full work week). */
export function allocEntryHrsPerWeek(a: AllocEntryLike, fullWeekHours = 40): number {
  const h = a.hours;
  return h && h > 0 ? h : Math.round(((a.pct ?? 0) / 100) * fullWeekHours * 10) / 10;
}

/* ── windowed load derivation (ported from the Resources page) ───────── */

export interface WindowedLoad {
  /** Avg summed load across the person's ACTIVE weeks in the window. */
  pct: number;
  /** Number of weeks in the window with any load (> 0). */
  activeWeeks: number;
  /** Total booked hours across the window. */
  totalHrs: number;
  /** Max number of FUNDED projects sharing a single week. */
  maxConcurrent: number;
  /** One merged entry per project overlapping the window (gantt-friendly:
   *  min start, max end, week-weighted avg pct / hours-per-week). */
  merged: AllocEntryLike[];
}

/**
 * Window a person's allocation entries into weekly Monday-keyed buckets and
 * average the summed load over their ACTIVE weeks (weeks with any booking).
 *
 * Returns null when NO entry overlaps the window at all — callers decide the
 * fallback (Resources keeps the backend row untouched; briefing/home treat
 * the person as 0% for that window).
 *
 * `windowStartMs`/`windowEndMs`: local-midnight ms of the first day and the
 * LAST day of the window (end treated as inclusive end-of-day).
 */
export function deriveWindowedLoad(
  entries: AllocEntryLike[] | undefined,
  windowStartMs: number,
  windowEndMs: number,
  fullWeekHours = 40,
): WindowedLoad | null {
  const all = entries ?? [];
  if (isNaN(windowStartMs) || isNaN(windowEndMs)) return null;
  const qsd = windowStartMs;
  const qed = windowEndMs + END_OF_DAY_MS; // end-of-day inclusive
  const inWindow = all.filter((a) => {
    const s = parseLocalDay(a.startDate ?? "");
    const e = parseLocalDay(a.endDate ?? "");
    return !isNaN(s) && !isNaN(e) && s <= qed && e + END_OF_DAY_MS >= qsd;
  });
  if (!inWindow.length) return null;

  // Weekly load buckets (Monday-keyed, clamped to the window), built under
  // the SAME weekly-bucket-parity contract as the server engine so alert /
  // KPI percentages agree with the Timeline popup by construction:
  //   - Positive NARROW rows (≤ 8 elapsed days — one week's booking, e.g. a
  //     weekly edit) collapse WHOLE into ONE canonical Monday week and CLAIM it.
  //     Empty weekly placeholders do not erase a positive monthly/EAC total.
  //   - BROAD rows (containers) fill only weeks NO narrow row of the same
  //     project claimed (narrow-wins / container suppression).
  //   - Same-kind rows on one (project, week) SUM (stacked lumps display
  //     honestly).
  // Without the claim step, a container row plus its weekly-edit rows
  // double-count and a person shows e.g. 171% here while the Timeline
  // (engine buckets) correctly shows them under capacity.
  type WeekVal = { pct: number; hrs: number };
  const projWeeks = new Map<string, Map<number, { narrow?: WeekVal; broad?: WeekVal }>>();
  const winFirstMonday = mondayOf(qsd);
  for (const a of inWindow) {
    const sRaw = parseLocalDay(a.startDate ?? "");
    const eRaw = parseLocalDay(a.endDate ?? "");
    const pid = String(a.projectId ?? "");
    const hrsWk = allocEntryHrsPerWeek(a, fullWeekHours);
    const pctWk = a.pct || 0;
    const weeks = projWeeks.get(pid) ?? new Map<number, { narrow?: WeekVal; broad?: WeekVal }>();
    projWeeks.set(pid, weeks);
    const elapsedDays = Math.round((eRaw - sRaw) / DAY_MS); // round soaks DST drift
    if (elapsedDays <= 8) {
      // Canonical Monday: the Monday INSIDE the span when one exists,
      // otherwise the Monday of the start's calendar week.
      let mon = mondayOf(sRaw);
      if (mon < sRaw) {
        const next = new Date(mon);
        next.setDate(next.getDate() + 7); // DST-safe week step
        if (next.getTime() <= eRaw + END_OF_DAY_MS) mon = next.getTime();
      }
      if (mon < winFirstMonday || mon > qed) continue;
      const slot = weeks.get(mon) ?? {};
      if (pctWk > 0 || hrsWk > 0) {
        slot.narrow = {
          pct: (slot.narrow?.pct ?? 0) + pctWk,
          hrs: (slot.narrow?.hrs ?? 0) + hrsWk,
        };
      }
      weeks.set(mon, slot);
    } else {
      const eEnd = Math.min(eRaw, qed);
      const cur = new Date(mondayOf(Math.max(sRaw, qsd)));
      while (cur.getTime() <= eEnd) {
        const k = cur.getTime();
        const slot = weeks.get(k) ?? {};
        slot.broad = {
          pct: (slot.broad?.pct ?? 0) + pctWk,
          hrs: (slot.broad?.hrs ?? 0) + hrsWk,
        };
        weeks.set(k, slot);
        cur.setDate(cur.getDate() + 7); // DST-safe week step
      }
    }
  }
  // Resolve claims → person-level weekly load. weekProjs tracks which FUNDED
  // projects share each week (post-suppression true temporal overlap).
  const weekPct = new Map<number, number>();
  const weekProjs = new Map<number, Set<string>>();
  let totalHrs = 0;
  for (const [pid, weeks] of projWeeks) {
    for (const [k, slot] of weeks) {
      const v = slot.narrow ?? slot.broad;
      if (!v) continue;
      weekPct.set(k, (weekPct.get(k) ?? 0) + v.pct);
      totalHrs += v.hrs;
      if (v.pct > 0 || v.hrs > 0) {
        const set = weekProjs.get(k) ?? new Set<string>();
        set.add(pid);
        weekProjs.set(k, set);
      }
    }
  }
  let maxConcurrent = 0;
  for (const s of weekProjs.values()) maxConcurrent = Math.max(maxConcurrent, s.size);
  const activeWeekLoads = Array.from(weekPct.values()).filter((v) => v > 0);
  if (!activeWeekLoads.length) return null;
  const pct =
    Math.round((activeWeekLoads.reduce((s, v) => s + v, 0) / activeWeekLoads.length) * 100) / 100;

  // Collapse per project → one gantt-friendly entry (min start, max end,
  // week-weighted avg pct / hours-per-week), mirroring the Timeline bars.
  const isoLocal = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const byProj = new Map<string, AllocEntryLike[]>();
  for (const a of inWindow) {
    const pid = String(a.projectId ?? "");
    const list = byProj.get(pid) ?? [];
    list.push(a);
    byProj.set(pid, list);
  }
  const merged = Array.from(byProj.entries()).map(([pid, list]) => {
    let sMin = Infinity, eMax = -Infinity, wSum = 0, pctW = 0, hrsW = 0, hasHrs = false;
    for (const a of list) {
      const s = parseLocalDay(a.startDate ?? "");
      const e = parseLocalDay(a.endDate ?? "");
      const wks = Math.max(1, Math.round(((e - s) / DAY_MS + 1) / 7));
      sMin = Math.min(sMin, s);
      eMax = Math.max(eMax, e);
      wSum += wks;
      pctW += (a.pct || 0) * wks;
      const h = a.hours;
      if (h && h > 0) { hrsW += h * wks; hasHrs = true; }
    }
    return {
      projectId: pid,
      projectName: list[0]?.projectName ?? "",
      pct: Math.round((pctW / Math.max(1, wSum)) * 100) / 100,
      hours: hasHrs ? Math.round((hrsW / Math.max(1, wSum)) * 10) / 10 : undefined,
      startDate: isoLocal(sMin),
      endDate: isoLocal(eMax),
    } as AllocEntryLike;
  });

  return { pct, activeWeeks: activeWeekLoads.length, totalHrs: Math.round(totalHrs), maxConcurrent, merged };
}

/** Windowed pct for one resource for KPI purposes: a person with no
 *  allocations overlapping the window is idle (0%) for that window. */
export function windowedPctForResource(
  r: ResourceLike,
  windowStartMs: number,
  windowEndMs: number,
  fullWeekHours = 40,
): number {
  const entries = r.allAllocations ?? r.activeAllocations ?? [];
  const load = deriveWindowedLoad(entries, windowStartMs, windowEndMs, fullWeekHours);
  return load ? load.pct : 0;
}

/* ── leave / partial availability windows ────────────────────────────── */

/** One leave / partial-availability window for a person. Dates are date-only
 *  ISO strings; `availabilityPct` is the capacity that REMAINS during the
 *  window (0 = fully out, 50 = half-time). Windows outside any entry imply
 *  100% availability. Overlapping windows: the LOWEST availability wins. */
export interface AvailabilityWindow {
  startDate: string;
  endDate: string;
  availabilityPct: number;
}

/** Remaining capacity % on one local-midnight day (100 when no window applies). */
export function availabilityOnDay(dayMs: number, windows: AvailabilityWindow[] | undefined): number {
  if (!windows || windows.length === 0) return 100;
  let cap = 100;
  for (const w of windows) {
    const s = parseLocalDay(w.startDate);
    const e = parseLocalDay(w.endDate);
    if (isNaN(s) || isNaN(e)) continue;
    if (dayMs >= s && dayMs <= e + END_OF_DAY_MS) {
      cap = Math.min(cap, Math.max(0, Math.min(100, w.availabilityPct)));
    }
  }
  return cap;
}

/** Day-weighted average remaining capacity % across an inclusive date window.
 *  Used to scale a person's capacity basis when summarizing utilization —
 *  e.g. 100% booked while on half-time leave is effectively 200% of what they
 *  can actually work. Returns 100 when no leave overlaps the window. */
export function avgAvailabilityPct(
  windows: AvailabilityWindow[] | undefined,
  windowStartMs: number,
  windowEndMs: number,
): number {
  if (!windows || windows.length === 0) return 100;
  if (isNaN(windowStartMs) || isNaN(windowEndMs) || windowEndMs < windowStartMs) return 100;
  // Cap the day walk at ~2 years to keep this O(days) loop bounded.
  const days = Math.min(731, Math.round((windowEndMs - windowStartMs) / DAY_MS) + 1);
  let sum = 0;
  const cur = new Date(windowStartMs);
  cur.setHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    sum += availabilityOnDay(cur.getTime(), windows);
    cur.setDate(cur.getDate() + 1); // DST-safe day step
  }
  return Math.round((sum / days) * 10) / 10;
}

/** The availability window covering `now` (lowest-capacity one wins), or null
 *  when the person is fully available today. Drives "On leave" badges. */
export function activeAvailabilityWindow(
  windows: AvailabilityWindow[] | undefined,
  now = new Date(),
): AvailabilityWindow | null {
  if (!windows || windows.length === 0) return null;
  const t = new Date(now); t.setHours(0, 0, 0, 0);
  const dayMs = t.getTime();
  let best: AvailabilityWindow | null = null;
  for (const w of windows) {
    const s = parseLocalDay(w.startDate);
    const e = parseLocalDay(w.endDate);
    if (isNaN(s) || isNaN(e)) continue;
    if (dayMs >= s && dayMs <= e + END_OF_DAY_MS) {
      if (!best || w.availabilityPct < best.availabilityPct) best = w;
    }
  }
  return best;
}

/* ── holiday-aware weekly capacity (Settings-driven) ─────────────────── */
/*
 * Capacity basis for "available hours" math (Recruitment Analytics et al.):
 *   hoursPerDay  = fullWeekHours ÷ workingDaysPerWeek
 *   weekCapacity = fullWeekHours − (holidays on WORKING days that week × hoursPerDay)
 * Holidays that land on a non-working day (e.g. Saturday) are NOT deducted —
 * the weekend already removed that day. Personal leave scaling happens
 * separately via avgAvailabilityPct. This is the ONE choke point for
 * calendar-driven capacity; never re-derive it inline elsewhere.
 */

/** Number of working days per week given Settings' non-working day indices
 *  (0=Sun … 6=Sat). Defaults to Mon–Fri when the list is missing. */
export function workingDaysPerWeek(nonWorkingDays: number[] | undefined): number {
  const off = new Set((nonWorkingDays ?? [0, 6]).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  return 7 - off.size;
}

/** Normalize Settings' holidayDates ("YYYY-MM-DD" or "YYYY-MM-DD|Label")
 *  into a Set of bare "YYYY-MM-DD" strings. Invalid entries are dropped. */
export function parseHolidaySet(holidayDates: string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of holidayDates ?? []) {
    const d = String(raw ?? "").split("|")[0].trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) out.add(d);
  }
  return out;
}

/**
 * Capacity hours for ONE week starting at `weekStartMs` (a Monday midnight —
 * local or UTC, matching `utcDays`). Deducts company holidays that fall on
 * working days inside that week. `utcDays` = true when weekStartMs was built
 * with UTC week math (server-side date-only pipelines); false for local.
 */
export function weekCapacityHours(
  weekStartMs: number,
  fullWeekHours: number,
  nonWorkingDays: number[] | undefined,
  holidaySet: ReadonlySet<string>,
  utcDays = false,
): number {
  const wwh = fullWeekHours > 0 ? fullWeekHours : 40;
  const wd = workingDaysPerWeek(nonWorkingDays);
  if (wd <= 0) return 0; // every day is non-working — zero capacity, honestly
  if (holidaySet.size === 0) return wwh;
  const off = new Set((nonWorkingDays ?? [0, 6]).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  let holidayWorkdays = 0;
  const cur = new Date(weekStartMs);
  for (let i = 0; i < 7; i++) {
    const dow = utcDays ? cur.getUTCDay() : cur.getDay();
    if (!off.has(dow)) {
      const iso = utcDays
        ? cur.toISOString().slice(0, 10)
        : `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      if (holidaySet.has(iso)) holidayWorkdays++;
    }
    if (utcDays) cur.setUTCDate(cur.getUTCDate() + 1);
    else cur.setDate(cur.getDate() + 1); // DST-safe day step
  }
  if (holidayWorkdays <= 0) return wwh;
  const capacity = wwh - holidayWorkdays * (wwh / wd);
  return Math.max(0, Math.round(capacity * 10) / 10);
}

/** Remaining capacity % on one date-only ISO day (100 when no window applies).
 *  Pure string comparison keeps this timezone-independent; overlapping
 *  windows: the LOWEST availability wins; malformed window dates are ignored. */
export function availabilityPctOnIsoDay(iso: string, windows: AvailabilityWindow[] | undefined): number {
  if (!windows || windows.length === 0) return 100;
  let cap = 100;
  for (const w of windows) {
    const s = String(w.startDate ?? "").slice(0, 10);
    const e = String(w.endDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e) || e < s) continue;
    if (iso >= s && iso <= e) cap = Math.min(cap, Math.max(0, Math.min(100, w.availabilityPct)));
  }
  return cap;
}

/**
 * Available hours for ONE person for ONE week, at WORKING-DAY granularity:
 * each working day contributes (fullWeekHours ÷ workingDays) hours, company
 * holidays contribute nothing, and the rest is scaled by the person's
 * remaining leave availability % for THAT day. This is the choke point for
 * combining calendar capacity with personal leave — never scale a weekly
 * capacity total by a 7-calendar-day leave average: weekend leave would
 * wrongly deduct working capacity, and leave on a holiday workday would
 * deduct a second time. With no leave windows this equals weekCapacityHours.
 * Date comparison is date-only (ISO strings), so results are TZ-independent.
 */
export function weekAvailableHours(
  weekStartMs: number,
  fullWeekHours: number,
  nonWorkingDays: number[] | undefined,
  holidaySet: ReadonlySet<string>,
  windows: AvailabilityWindow[] | undefined,
  utcDays = false,
): number {
  const wwh = fullWeekHours > 0 ? fullWeekHours : 40;
  const wd = workingDaysPerWeek(nonWorkingDays);
  if (wd <= 0) return 0; // every day is non-working — zero capacity, honestly
  const off = new Set((nonWorkingDays ?? [0, 6]).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  const dayHours = wwh / wd;
  let sum = 0;
  const cur = new Date(weekStartMs);
  for (let i = 0; i < 7; i++) {
    const dow = utcDays ? cur.getUTCDay() : cur.getDay();
    if (!off.has(dow)) {
      const iso = utcDays
        ? cur.toISOString().slice(0, 10)
        : `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      if (!holidaySet.has(iso)) {
        sum += dayHours * (availabilityPctOnIsoDay(iso, windows) / 100);
      }
    }
    if (utcDays) cur.setUTCDate(cur.getUTCDate() + 1);
    else cur.setDate(cur.getDate() + 1); // DST-safe day step
  }
  return Math.max(0, Math.round(sum * 10) / 10);
}

/* ── utilization summary (business-rule thresholds passed in) ────────── */

export interface UtilizationThresholds {
  /** Allocation at or above this % counts as overloaded (e.g. 110). */
  overCapacityPct: number;
  /** Allocation below this % (but > 0) counts as under-used (e.g. 60). */
  underAllocatedPct: number;
}

export interface UtilizationSummary {
  total: number;
  /** 0% in the window. */
  bench: number;
  /** ≥ overCapacityPct. */
  overloaded: number;
  /** > 0 and < underAllocatedPct. */
  underUsed: number;
  /** In the healthy band [underAllocatedPct, overCapacityPct). */
  healthy: number;
  /** Average across ACTIVE (> 0) resources, rounded. 0 when nobody active. */
  avgUtilization: number;
}

export function summarizeUtilization(
  pcts: number[],
  t: UtilizationThresholds,
): UtilizationSummary {
  let bench = 0, overloaded = 0, underUsed = 0, healthy = 0, activeSum = 0, active = 0;
  for (const raw of pcts) {
    const pct = Number.isFinite(raw) ? raw : 0;
    if (pct <= 0) { bench++; continue; }
    active++;
    activeSum += pct;
    if (pct >= t.overCapacityPct) overloaded++;
    else if (pct < t.underAllocatedPct) underUsed++;
    else healthy++;
  }
  return {
    total: pcts.length,
    bench,
    overloaded,
    underUsed,
    healthy,
    avgUtilization: active ? Math.round(activeSum / active) : 0,
  };
}

/** Window every resource and summarize in one call. */
export function summarizeWindowedUtilization(
  resources: ResourceLike[],
  windowStartMs: number,
  windowEndMs: number,
  t: UtilizationThresholds,
  fullWeekHours = 40,
): UtilizationSummary {
  return summarizeUtilization(
    resources.map((r) => windowedPctForResource(r, windowStartMs, windowEndMs, fullWeekHours)),
    t,
  );
}

/** Forecast window per the tenant's business rules: today (local midnight)
 *  through today + forecastWeeks×7 − 1 days (inclusive last day). A rolling
 *  window — unlike calendar quarters it never "resets" at a boundary, so
 *  day-over-day deltas stay continuous. */
export function forecastWindow(forecastWeeks: number, now = new Date()): { startMs: number; endMs: number } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days = Math.max(1, Math.round((forecastWeeks || 8) * 7));
  return { startMs: start.getTime(), endMs: start.getTime() + (days - 1) * DAY_MS };
}

/**
 * True when the allocations feed carries a real allocation signal — at least
 * one resource has an allocation entry or a non-zero pct. A feed that returns
 * resources but ZERO allocation rows anywhere is either a brand-new tenant or
 * a degraded read; snapshot writers must not persist baselines from it, or
 * day-over-day deltas get poisoned ("bench +975 since yesterday").
 */
export function hasAllocationSignal(resources: ResourceLike[]): boolean {
  return resources.some(
    (r) =>
      (r.allAllocations?.length ?? 0) > 0 ||
      (r.activeAllocations?.length ?? 0) > 0 ||
      (r.currentPct ?? 0) > 0,
  );
}

/* ── demand-position math (canonical counting rules) ─────────────────── */
/*
 * The demand feed returns ONE ROW PER WEEK per open position, so a single
 * requisition that runs for months arrives as dozens of near-identical weekly
 * rows. Counting those rows (or summing their PctAllocation) over-states both
 * the number of open requisitions and the FTE demand. The API proxy already
 * disambiguates genuinely-separate slots on the same project by suffixing the
 * Role ("Plumbing Engineer (2)"), so a unique position is (TicketId + Role).
 *
 * CANONICAL COUNTING RULES (keep every surface consistent — home, Daily
 * Briefing, Weekly Demand popup, reports, server snapshots):
 *  - A "position" is one (TicketId, Role) pair, never a raw weekly row.
 *  - When counting demand inside a time window, only positions that have
 *    unfilled HOURS in that window count (PctAllocation > 0 on at least one
 *    overlapping row). Zero-hour placeholder weeks are noise, not demand.
 *  - Contract value "at risk" counts each project ONCE.
 */

/** Collapse weekly demand rows into one record per (TicketId, Role) position:
 *  earliest start, latest end, and the AVERAGE weekly % allocation (which is
 *  the concurrent FTE for that one position). */
export function collapseDemandsToPositions(rows: any[]): any[] {
  const groups = new Map<string, any[]>();
  for (const r of rows) {
    if (!r) continue;
    const key = `${String(r.TicketId ?? "")}||${String(r.Role ?? "")}`;
    let g = groups.get(key);
    if (!g) { g = []; groups.set(key, g); }
    g.push(r);
  }
  const positions: any[] = [];
  for (const arr of groups.values()) {
    if (arr.length === 0) continue;
    let minStart = Infinity;
    let maxEnd = -Infinity;
    let pctSum = 0;
    let pctCount = 0;
    let rep = arr[0];
    let anySoft = false;
    for (const d of arr) {
      const s = d?.AllocationStartDate ? new Date(d.AllocationStartDate).getTime() : NaN;
      const e = d?.AllocationEndDate ? new Date(d.AllocationEndDate).getTime() : NaN;
      if (!isNaN(s) && s < minStart) { minStart = s; rep = d; }
      if (!isNaN(e) && e > maxEnd) maxEnd = e;
      const p = Number(d?.PctAllocation);
      if (Number.isFinite(p)) { pctSum += p; pctCount++; }
      if (d?.SoftAllocation) anySoft = true;
    }
    const pct = pctCount > 0 ? pctSum / pctCount : (Number(rep?.PctAllocation) || 0);
    positions.push({
      ...rep,
      PctAllocation: pct,
      AllocationStartDate: isFinite(minStart) ? new Date(minStart).toISOString() : rep?.AllocationStartDate,
      AllocationEndDate: isFinite(maxEnd) ? new Date(maxEnd).toISOString() : rep?.AllocationEndDate,
      SoftAllocation: anySoft,
      _weekRows: arr.length,
    });
  }
  return positions;
}

/** Window rule: keep only rows that carry unfilled hours (PctAllocation > 0).
 *  Apply to the window-overlapping row slice BEFORE collapsing so a position
 *  whose only in-window weeks are zero-hour placeholders doesn't count —
 *  mirrors the Weekly Demand popup's ctxHrs > 0 filter. */
export function fundedDemandRows(rows: any[]): any[] {
  return rows.filter((r) => (Number(r?.PctAllocation) || 0) > 0);
}

/** Contract value across demand rows/positions counting each project once. */
export function uniqueProjectDemandValue(rows: any[]): number {
  const seen = new Set<string>();
  let sum = 0;
  for (const d of rows) {
    if (!d) continue;
    const t = String(d.TicketId ?? "");
    if (seen.has(t)) continue;
    seen.add(t);
    sum += Number(d.ApproxContractValue ?? 0) || 0;
  }
  return sum;
}

/** Canonical open-demand count for snapshots/KPIs: funded rows collapsed to
 *  unique positions. NEVER count raw weekly rows. */
export function countDemandPositions(rows: any[]): number {
  return collapseDemandsToPositions(fundedDemandRows(rows ?? [])).length;
}
