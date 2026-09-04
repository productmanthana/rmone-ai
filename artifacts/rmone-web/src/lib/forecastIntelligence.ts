/**
 * Computes the /forecast page entirely from real RM ONE allocation, demand,
 * and utilization data. The previous implementation used hand-tuned mock
 * objects (HEATMAP, DEMAND_CAP, COLLISION); this module derives the same
 * structures from live API responses so the heatmap, demand-vs-capacity
 * curve and resource-collision view stay in sync with what the rest of
 * the app already displays.
 *
 * Inputs:
 *   - utilRows: rows from getAllocationUtilization (Weekly mode, ~8wk window)
 *   - resources: getResourceAllocations().resources
 *   - demands: getResourceDemands().data
 *   - projectNameMap: getResourceAllocations().projectNameMap
 *
 * Output: a ForecastModel containing the 8-week window + per-pivot data
 * structures matching what forecast.tsx expects.
 */

import { compactUsd } from "./money";
import type { LiveResourceProxy, DemandItem, ResourceMasterRow, ModuleRecord } from "./api";
import { getBusinessRules } from "./businessRules";

export type Pivot = "Office" | "Role" | "Discipline";
export type Scenario = "Base" | "Win";

export const PIVOTS: Pivot[] = ["Office", "Role", "Discipline"];

export interface WeekInfo {
  label: string;          // e.g. "W18"
  startDate: Date;        // Monday 00:00 local
  endDate: Date;          // Sunday 23:59 local
  monthShort: string;     // e.g. "May"
  isoWeek: number;
}

export type Heatmap = Record<string, number[]>;

export interface HeatmapHeadline {
  week: string;
  row: string;
  pct: number;
}

export interface DemandCapacity {
  demand: number[];
  capacity: number[];
}

export interface HireTrigger {
  month: string;
  week: string;
  demand: string;
}

export interface CollisionBar {
  name: string;
  weeks: string[];
}

export interface CollisionView {
  person: string;
  pct: number;
  failWeek: string;
  bars: CollisionBar[];
  overlap: string[];
  /** The collision person's utilization % per week, aligned to weekLabels, so
   *  the card can label each week cell (mirrors the Peak-overload card). */
  weekPct: number[];
}

/** A real person behind a heatmap cell: their name, the role/department we
 *  could resolve, the single project they were most allocated to that week,
 *  and their own utilization percent for that week. */
export interface DrillPerson {
  name: string;
  role: string;
  project: string;
  pct: number;
}

/** drill.cells[pivot][rowBucket][weekLabel] → real contributors for that cell.
 *  Derived from the same utilization rows + live allocations that feed the
 *  heatmap, so the "who & what" panel never invents records. */
export type DrillCells = Record<Pivot, Record<string, Record<string, DrillPerson[]>>>;

export interface ForecastModel {
  weeks: WeekInfo[];
  weekLabels: string[];
  rowsByPivot: Record<Pivot, string[]>;
  heatmap: Record<Pivot, Record<Scenario, Heatmap>>;
  heatmapHeadline: Record<Pivot, Record<Scenario, HeatmapHeadline>>;
  demandCap: Record<Pivot, Record<Scenario, DemandCapacity>>;
  hireTrigger: Record<Pivot, Record<Scenario, HireTrigger>>;
  collision: Record<Pivot, CollisionView>;
  drill: { cells: DrillCells };
}

export interface PursuitInfo {
  hasPursuit: boolean;
  title: string;
  value: number;
  /** "+$8.2M" formatted from the opportunity's recorded value (see opmValue).
   *  "+$0" when no pursuit or no value is recorded. */
  valueLabel: string;
  /** True when the opportunity has NO recorded contract value, so `value` is an
   *  illustrative default (DEFAULT_PURSUIT_VALUE) used purely to let the Win-
   *  pursuit scenario show a directional impact instead of a silent no-op. */
  estimated?: boolean;
}

/** Illustrative award size used when an open opportunity has no contract value
 *  recorded in RM ONE (every value field empty). Without this the Win-pursuit
 *  uplift scales to 0 and the toggle appears to "do nothing". The figure is a
 *  neutral mid-size AEC award and is always surfaced to the user as an estimate. */
const DEFAULT_PURSUIT_VALUE = 5_000_000;

/** Raw RM ONE module records type the Closed flag loosely — it can arrive as a
 *  boolean, the strings "true"/"false"/"1"/"0", or a number. Normalize so an
 *  opportunity only counts as open when it is genuinely not closed. */
function isClosed(o: ModuleRecord): boolean {
  const v = (o as Record<string, unknown>)?.Closed;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  }
  return false;
}

/** An OPM opportunity's size for scenario modelling. Different RM ONE tenants
 *  record it under different fields — the canonical ApproxContractValue is
 *  often empty for opportunities (which aren't yet won), so we fall back to
 *  the forecasted cost / labor amount / fee. This is a derived scenario value,
 *  not a list-display number, so the fallback is appropriate here. */
function opmValue(o: ModuleRecord): number {
  const rec = o as Record<string, unknown>;
  for (const f of [
    "ApproxContractValue",
    "ForecastedProjectCost",
    "LaborContractAmount",
    "Fee",
  ]) {
    const n = Number(rec?.[f]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export function pickPursuit(opm: ModuleRecord[], selectedId?: string | null): PursuitInfo {
  // Open opportunities only (not yet Closed). Matches the mobile surface:
  // any open OPM enables the scenario; prefer a NYCHA-related opportunity
  // (the historical "what if we win NYCHA?" narrative), else the largest
  // open OPM by recorded value.
  const open = (opm ?? []).filter((o) => !isClosed(o));

  // If the user explicitly selected an opportunity by TicketId, use it.
  if (selectedId) {
    const sel = open.find((o) => {
      const rec = o as Record<string, unknown>;
      return (
        String(rec?.TicketId ?? "").trim() === selectedId ||
        String(rec?.Id ?? "").trim() === selectedId
      );
    });
    if (sel) {
      const recorded = opmValue(sel);
      const estimated = !(recorded > 0);
      const value = estimated ? DEFAULT_PURSUIT_VALUE : recorded;
      return {
        hasPursuit: true,
        title: String((sel as Record<string, unknown>)?.Title || "Pursuit").trim(),
        value,
        valueLabel: estimated
          ? `~$${Math.round(DEFAULT_PURSUIT_VALUE / 1_000_000)}M est.`
          : formatPursuitValue(recorded),
        estimated,
      };
    }
  }

  const nycha = open.find((o) => {
    const t = String((o as Record<string, unknown>)?.Title || "").toLowerCase();
    const c = String(
      (o as Record<string, unknown>)?.CRMCompanyLookupName ||
        (o as Record<string, unknown>)?.ClientName ||
        (o as Record<string, unknown>)?.CompanyName ||
        "",
    ).toLowerCase();
    return t.includes("nycha") || c.includes("nycha");
  });
  const sorted = open.slice().sort((a, b) => opmValue(b) - opmValue(a));
  const top = nycha ?? sorted[0];
  if (!top) {
    return { hasPursuit: false, title: "", value: 0, valueLabel: "+$0" };
  }
  const recorded = opmValue(top);
  const estimated = !(recorded > 0);
  const value = estimated ? DEFAULT_PURSUIT_VALUE : recorded;
  return {
    hasPursuit: true,
    title: String((top as Record<string, unknown>)?.Title || "Pursuit").trim(),
    value,
    valueLabel: estimated
      ? `~$${Math.round(DEFAULT_PURSUIT_VALUE / 1_000_000)}M est.`
      : formatPursuitValue(recorded),
    estimated,
  };
}

/** All open opportunities, sorted largest first, for the scenario picker. */
export interface OpenPursuit {
  id: string;
  title: string;
  valueLabel: string;
}

export function getOpenPursuits(opm: ModuleRecord[]): OpenPursuit[] {
  return (opm ?? [])
    .filter((o) => !isClosed(o))
    .map((o) => {
      const rec = o as Record<string, unknown>;
      const id =
        String(rec?.TicketId ?? "").trim() || String(rec?.Id ?? "").trim();
      const title = String(rec?.Title ?? "Pursuit").trim();
      const recorded = opmValue(o);
      const estimated = !(recorded > 0);
      const v = estimated ? DEFAULT_PURSUIT_VALUE : recorded;
      return {
        id,
        title,
        valueLabel: estimated
          ? `~$${Math.round(DEFAULT_PURSUIT_VALUE / 1_000_000)}M est.`
          : formatPursuitValue(recorded),
        _sort: v,
      };
    })
    .filter((o) => o.id && o.title)
    .sort((a, b) => b._sort - a._sort)
    .map(({ _sort: _s, ...o }) => o);
}

function formatPursuitValue(v: number): string {
  if (!v) return "+$0";
  if (v >= 1_000_000_000) return `+${compactUsd(v)}`;
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return `+$${m >= 10 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (v >= 1_000) return `+$${Math.round(v / 1_000)}K`;
  return `+$${Math.round(v)}`;
}

/* ------------------------------------------------------------------ */
/* Date / week helpers                                                */
/* ------------------------------------------------------------------ */

const MONTHS_IDX: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Returns the forward weeks starting on the Monday of the current week. The
 * number of weeks is the admin-tuned "Forecast window (weeks)" business rule
 * (Onboarding → Settings), clamped to a sane 1..26 range so a bad value can't
 * blow up the heatmap. Defaults to 8 when the rule is unset.
 */
export function computeForecastWindow(now: Date = new Date(), totalWeeks?: number): {
  startDate: string; endDate: string; weeks: WeekInfo[];
} {
  const raw = Math.round(getBusinessRules().forecastWeeks);
  const weekCount = totalWeeks ?? (Number.isFinite(raw) ? Math.min(52, Math.max(1, raw)) : 8);

  const monday = new Date(now);
  const dow = monday.getDay();              // 0=Sun ... 6=Sat
  const offsetToMon = dow === 0 ? -6 : 1 - dow;
  monday.setDate(monday.getDate() + offsetToMon);
  monday.setHours(0, 0, 0, 0);

  const weeks: WeekInfo[] = [];
  for (let i = 0; i < weekCount; i++) {
    const start = new Date(monday);
    start.setDate(monday.getDate() + i * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    weeks.push({
      label: `W${isoWeek(start)}`,
      startDate: start,
      endDate: end,
      monthShort: MONTH_SHORT[start.getMonth()],
      isoWeek: isoWeek(start),
    });
  }
  return {
    startDate: fmtISO(weeks[0].startDate),
    endDate: fmtISO(weeks[weeks.length - 1].endDate),
    weeks,
  };
}

/** Parse a utilization period column key like "Apr-15-26" into a Date. */
function parsePeriodKey(k: string): Date | null {
  let m = k.match(/^([A-Z][a-z]{2})-(\d{1,2})-(\d{2,4})$/);
  if (m) {
    const mon = MONTHS_IDX[m[1]];
    if (mon === undefined) return null;
    const day = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    return new Date(year, mon, day);
  }
  m = k.match(/^(\d{1,2})-([A-Z][a-z]{2})-(\d{2,4})$/);
  if (m) {
    const mon = MONTHS_IDX[m[2]];
    if (mon === undefined) return null;
    const day = parseInt(m[1], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    return new Date(year, mon, day);
  }
  return null;
}

/** Parse a utilization cell value like "P:115#H:46#C:3#S:over". */
function parseUtilP(v: unknown): number {
  if (v == null) return 0;
  const s = String(v);
  if (!s) return 0;
  for (const part of s.split("#")) {
    const i = part.indexOf(":");
    if (i > -1 && part.slice(0, i) === "P") {
      const n = parseFloat(part.slice(i + 1));
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

const META_KEYS = new Set([
  "UserId", "ResourceUser", "Name", "Title", "Department",
  "Discipline", "Role", "OfficeName", "ManagerName", "Total", "Id",
]);

function isPeriodKey(k: string): boolean {
  if (META_KEYS.has(k)) return false;
  if (/^[A-Z][a-z]{2}-\d{1,2}-\d{2,4}$/.test(k)) return true;
  if (/^\d{1,2}-[A-Z][a-z]{2}-\d{2,4}$/.test(k)) return true;
  return false;
}

/** Return mapping: weekIndex (0..7) → matching period column key from a row. */
function alignPeriodsToWeeks(
  row: Record<string, unknown> | undefined,
  weeks: WeekInfo[],
): (string | null)[] {
  const result: (string | null)[] = weeks.map(() => null);
  if (!row) return result;
  for (const k of Object.keys(row)) {
    if (!isPeriodKey(k)) continue;
    const d = parsePeriodKey(k);
    if (!d) continue;
    const t = d.getTime();
    for (let i = 0; i < weeks.length; i++) {
      if (t >= weeks[i].startDate.getTime() && t <= weeks[i].endDate.getTime()) {
        if (!result[i]) result[i] = k;
        break;
      }
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

function pivotField(p: Pivot): string {
  if (p === "Office") return "OfficeName";
  if (p === "Role") return "Role";
  return "Discipline";
}

interface RowSlice {
  bucket: string;        // group label for the active pivot
  weekly: number[];      // per-week P value
  total: number;         // sum across the window (used for ranking)
}

function buildRowSlices(
  utilRows: Record<string, unknown>[],
  weeks: WeekInfo[],
  pivot: Pivot,
): RowSlice[] {
  const field = pivotField(pivot);
  const periodKeys = utilRows.length > 0 ? alignPeriodsToWeeks(utilRows[0], weeks) : weeks.map(() => null);
  const out: RowSlice[] = [];
  for (const r of utilRows) {
    const bucket = String(r[field] ?? "").trim();
    if (!bucket) continue;
    const weekly: number[] = [];
    let total = 0;
    for (let i = 0; i < weeks.length; i++) {
      const k = periodKeys[i] ?? alignPeriodsToWeeks(r, weeks)[i];
      const v = k ? parseUtilP(r[k]) : 0;
      weekly.push(v);
      total += v;
    }
    out.push({ bucket, weekly, total });
  }
  return out;
}

/**
 * Discipline-specific slice builder.
 *
 * The generic buildRowSlices assigns each person ONE dominant discipline and
 * puts their full utilization there — so "Field Superintendent 133%" becomes
 * "Industrial 133%", producing identical numbers to the Role tab.
 *
 * This function splits each person's utilization proportionally across every
 * discipline they are actually allocated to inside the forecast window.
 * Example: Kevin is 70% on an Industrial project and 30% on a Technology
 * project.  His 133% utilization contributes 93% to Industrial and 40% to
 * Technology.  The resulting Discipline heatmap is driven by allocation
 * distribution, not just person counts.
 */
function buildDisciplineSlices(
  utilRows: Record<string, unknown>[],
  resources: LiveResourceProxy[],
  projectDiscipline: Record<string, string>,
  weeks: WeekInfo[],
): RowSlice[] {
  const blankLabel = getBusinessRules().unassignedLabel;
  const wStart = weeks[0]?.startDate ?? null;
  const wEnd = weeks[weeks.length - 1]?.endDate ?? null;

  // Build fast-lookup maps from the resource directory.
  const proxyById = new Map<string, LiveResourceProxy>();
  const proxyByName = new Map<string, LiveResourceProxy>();
  for (const r of resources ?? []) {
    if (r.id) proxyById.set(r.id.toLowerCase(), r);
    if (r.name) proxyByName.set(r.name.toLowerCase(), r);
  }

  const periodKeys = utilRows.length > 0
    ? alignPeriodsToWeeks(utilRows[0], weeks)
    : weeks.map(() => null);

  const out: RowSlice[] = [];

  for (const r of utilRows) {
    const name = String(r.ResourceUser ?? r.Name ?? "").trim();
    const userId = String(r.UserId ?? r.Id ?? "").trim().toLowerCase();
    const proxy =
      (userId ? proxyById.get(userId) : undefined) ??
      (name ? proxyByName.get(name.toLowerCase()) : undefined);

    // Tally allocation pct per discipline for allocations that overlap the
    // forecast window so out-of-window work doesn't skew the fractions.
    const discPct: Record<string, number> = {};
    let totalPct = 0;
    for (const a of proxy?.activeAllocations ?? []) {
      const key = String(a.projectId ?? "").trim().toUpperCase();
      const disc = (projectDiscipline[key] ?? "").trim();
      if (!disc) continue;
      const aStart = a.startDate ? new Date(a.startDate) : null;
      const aEnd = a.endDate ? new Date(a.endDate) : null;
      if (wEnd && aStart && aStart > wEnd) continue;
      if (wStart && aEnd && aEnd < wStart) continue;
      const pct = Math.max(0, Number(a.pct) || 1);
      discPct[disc] = (discPct[disc] ?? 0) + pct;
      totalPct += pct;
    }

    // Read this person's per-week utilization values once.
    const rawWeekly: number[] = [];
    let rawTotal = 0;
    for (let i = 0; i < weeks.length; i++) {
      const k = periodKeys[i];
      const v = k ? parseUtilP(r[k]) : 0;
      rawWeekly.push(v);
      rawTotal += v;
    }
    if (rawTotal <= 0) continue; // bench / inactive — skip

    if (Object.keys(discPct).length === 0) {
      // No allocation discipline info — use the enriched dominant discipline
      // or fall back to the unassigned label so this person still appears.
      const bucket = String(r.Discipline ?? "").trim() || blankLabel;
      out.push({ bucket, weekly: rawWeekly, total: rawTotal });
      continue;
    }

    // Emit one slice per discipline, scaling utilization by allocation fraction.
    for (const [disc, dPct] of Object.entries(discPct)) {
      const fraction = totalPct > 0 ? dPct / totalPct : 1;
      out.push({
        bucket: disc,
        weekly: rawWeekly.map((v) => v * fraction),
        total: rawTotal * fraction,
      });
    }
  }

  return out;
}

function buildHeatmap(
  slices: RowSlice[],
  weeks: WeekInfo[],
  maxRows: number,
): { rows: string[]; data: Heatmap; headline: HeatmapHeadline } {
  // Group rows by bucket, then for each (bucket × week) compute the mean of
  // all per-resource P values. Only the "Unassigned" bucket is dropped when
  // it contributed zero in every week — real named buckets (an office, a
  // role) are kept even at 0% so a fully-benched location still shows as
  // available capacity instead of vanishing from the heatmap entirely.
  const blankLabel = getBusinessRules().unassignedLabel;
  const grouped: Record<string, { sums: number[]; counts: number[]; total: number }> = {};
  for (const r of slices) {
    const g = (grouped[r.bucket] ??= {
      sums: weeks.map(() => 0),
      counts: weeks.map(() => 0),
      total: 0,
    });
    for (let i = 0; i < weeks.length; i++) {
      const v = r.weekly[i];
      if (v > 0) {
        g.sums[i] += v;
        g.counts[i] += 1;
      }
    }
    g.total += r.total;
  }
  const ranked = Object.entries(grouped)
    .map(([bucket, g]) => ({
      bucket,
      values: g.sums.map((s, i) => (g.counts[i] > 0 ? s / g.counts[i] : 0)),
      total: g.total,
    }))
    .filter((r) => r.total > 0 || r.bucket !== blankLabel)
    .sort((a, b) => b.total - a.total)
    .slice(0, maxRows);

  const rows = ranked.map((r) => r.bucket);
  const data: Heatmap = {};
  let peakRow = "";
  let peakWeek = weeks[0]?.label ?? "W1";
  let peakPct = 0;
  for (const r of ranked) {
    const rounded = r.values.map((v) => Math.round(v));
    data[r.bucket] = rounded;
    for (let i = 0; i < rounded.length; i++) {
      if (rounded[i] > peakPct) {
        peakPct = rounded[i];
        peakRow = r.bucket;
        peakWeek = weeks[i].label;
      }
    }
  }
  return { rows, data, headline: { week: peakWeek, row: peakRow, pct: peakPct } };
}

function buildDemandCapacity(
  utilRows: Record<string, unknown>[],
  demands: DemandItem[],
  weeks: WeekInfo[],
  pivot: Pivot,
  /** The headline (most-loaded) bucket for this pivot, e.g. "Field Superintendent"
   *  for Role or "Industrial" for Discipline.  When supplied the capacity count
   *  is scoped to people in that bucket and the demand count (Role only) is
   *  scoped to demand items in that role, so each pivot tab shows genuinely
   *  different supply/demand numbers instead of the same total. */
  headlineRow?: string,
): DemandCapacity {
  // DEMAND: sum FTE demand across all open DemandItems whose window overlaps.
  // For the Role pivot we additionally filter to items whose Role field matches
  // the headline bucket (e.g. only "Field Superintendent" open positions).
  // For other pivots we keep the full demand so the curve still has signal
  // even when demand rows don't carry a matching field.
  const demand = weeks.map(() => 0);
  for (const d of demands) {
    const pct = Number(d?.PctAllocation) || 0;
    if (pct <= 0) continue;
    if (pivot === "Role" && headlineRow) {
      const dRole = String(d?.Role ?? "").trim();
      if (dRole && dRole !== headlineRow) continue;
    }
    const start = d?.AllocationStartDate ? new Date(d.AllocationStartDate) : null;
    const end = d?.AllocationEndDate ? new Date(d.AllocationEndDate) : null;
    for (let i = 0; i < weeks.length; i++) {
      const w = weeks[i];
      if (start && start > w.endDate) continue;
      if (end && end < w.startDate) continue;
      demand[i] += pct / 100;
    }
  }

  // CAPACITY: count distinct active resources scoped to the headline bucket.
  // Scoping means each pivot tab shows the supply for its own top group
  // (e.g. how many Field Superintendents are active, not the whole firm).
  // Falls back to all eligible people when there is no headline bucket
  // (empty data, first load, or Office pivot where a single bucket can be
  // large enough that scoping would misrepresent firm-wide capacity).
  const field = pivotField(pivot);
  const byBucket: Record<string, Set<string>> = {};
  const allEligible = new Set<string>();
  const periodCache = utilRows.length > 0 ? alignPeriodsToWeeks(utilRows[0], weeks) : weeks.map(() => null);
  for (const r of utilRows) {
    const bucket = String(r[field] ?? "").trim();
    if (!bucket) continue;
    const id = String(r.UserId ?? r.Id ?? r.ResourceUser ?? "").trim().toLowerCase();
    if (!id) continue;
    const aligned = periodCache.some((k) => k != null) ? periodCache : alignPeriodsToWeeks(r, weeks);
    let active = false;
    for (let i = 0; i < weeks.length; i++) {
      const k = aligned[i];
      if (k && parseUtilP(r[k]) > 0) { active = true; break; }
    }
    if (!active) continue;
    allEligible.add(id);
    if (!byBucket[bucket]) byBucket[bucket] = new Set();
    byBucket[bucket].add(id);
  }

  // Use headline-bucket count for Role / Discipline so that the supply line
  // reflects the group being examined. For Office, use the total so the curve
  // keeps macro context (offices can be firm-wide groups).
  let cap: number;
  if (headlineRow && pivot !== "Office" && byBucket[headlineRow]) {
    cap = byBucket[headlineRow].size;
  } else {
    cap = allEligible.size;
  }
  const capacity = weeks.map(() => Math.max(1, cap));

  return {
    demand: demand.map((v) => Math.round(v * 10) / 10),
    capacity,
  };
}

function buildHireTrigger(
  curve: DemandCapacity,
  weeks: WeekInfo[],
  demands: DemandItem[],
  weekStart: Date,
  weekEnd: Date,
): HireTrigger {
  // Find the first week where FTE demand exceeds FTE capacity. If demand
  // never crosses, fall back to the highest-demand week so the headline
  // still shows *something* useful while the right-tag conveys "no
  // crossover".
  let crossIdx = curve.demand.findIndex((d, i) => d > curve.capacity[i]);
  if (crossIdx < 0) {
    let peak = 0; crossIdx = curve.demand.length - 1;
    for (let i = 0; i < curve.demand.length; i++) {
      if (curve.demand[i] > peak) { peak = curve.demand[i]; crossIdx = i; }
    }
  }
  const w = weeks[crossIdx] ?? weeks[weeks.length - 1];

  // FTE shortfall at the peak week (demand minus capacity, rounded up).
  // Pair it with the role that has the largest concurrent demand inside
  // the forecast window so the headline tells the user *what* to hire.
  const peakDemand = Math.max(...curve.demand);
  const peakCap = curve.capacity[crossIdx] ?? 0;
  const fteShortfall = Math.max(1, Math.ceil(peakDemand - peakCap));
  const roleSums: Record<string, number> = {};
  for (const d of demands) {
    const start = d?.AllocationStartDate ? new Date(d.AllocationStartDate) : null;
    const end = d?.AllocationEndDate ? new Date(d.AllocationEndDate) : null;
    if (start && start > weekEnd) continue;
    if (end && end < weekStart) continue;
    const role = String(d?.Role ?? "").trim();
    if (!role) continue;
    roleSums[role] = (roleSums[role] ?? 0) + (Number(d?.PctAllocation) || 0);
  }
  const topRole = Object.entries(roleSums).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "PM";
  return {
    month: w.monthShort,
    week: w.label,
    demand: `${fteShortfall} ${topRole}`,
  };
}

/* ------------------------------------------------------------------ */
/* Collision view                                                      */
/* ------------------------------------------------------------------ */

function buildCollision(
  utilRows: Record<string, unknown>[],
  resources: LiveResourceProxy[],
  projectNameMap: Record<string, string>,
  weeks: WeekInfo[],
  pivot: Pivot,
  pivotRow: string | null,
): CollisionView {
  const field = pivotField(pivot);

  // For each utilization row, find the peak week + value, and keep the full
  // per-week series so the collision card can label each week with the
  // person's utilization % (mirrors the Peak-overload card's in-cell numbers).
  type PeakRow = { name: string; userId: string; bucket: string; pct: number; weekIdx: number; weekPct: number[] };
  const peaks: PeakRow[] = [];
  const periodCache = utilRows.length > 0 ? alignPeriodsToWeeks(utilRows[0], weeks) : weeks.map(() => null);
  for (const r of utilRows) {
    const aligned = periodCache.some((k) => k != null) ? periodCache : alignPeriodsToWeeks(r, weeks);
    let best = 0;
    let bestIdx = 0;
    const series: number[] = [];
    for (let i = 0; i < weeks.length; i++) {
      const k = aligned[i];
      const v = k ? parseUtilP(r[k]) : 0;
      series.push(Math.round(v));
      if (v > best) {
        best = v;
        bestIdx = i;
      }
    }
    if (best <= 0) continue;
    peaks.push({
      name: String(r.ResourceUser ?? "").trim(),
      userId: String(r.UserId ?? r.Id ?? "").trim(),
      bucket: String(r[field] ?? "").trim(),
      pct: best,
      weekIdx: bestIdx,
      weekPct: series,
    });
  }

  // Resolve the project bars a candidate would show: match their
  // LiveResourceProxy (UserId first, then case-insensitive name) and list
  // the live allocations overlapping the forecast window.
  const barsFor = (cand: PeakRow): CollisionBar[] => {
    const lower = cand.name.toLowerCase();
    const proxy = resources.find(
      (r) =>
        (cand.userId && r.id.toLowerCase() === cand.userId.toLowerCase()) ||
        r.name.toLowerCase() === lower,
    );
    if (!proxy) return [];
    type Bar = { name: string; pct: number; weeks: string[] };
    const bars: Bar[] = [];
    for (const a of proxy.activeAllocations ?? []) {
      const aStart = a.startDate ? new Date(a.startDate) : null;
      const aEnd = a.endDate ? new Date(a.endDate) : null;
      const overlapWeeks: string[] = [];
      for (const w of weeks) {
        const startsAfter = aStart && aStart > w.endDate;
        const endsBefore = aEnd && aEnd < w.startDate;
        if (startsAfter || endsBefore) continue;
        overlapWeeks.push(w.label);
      }
      if (overlapWeeks.length === 0) continue;
      const projName = projectNameMap[a.projectId] || a.projectId;
      bars.push({ name: projName, pct: a.pct, weeks: overlapWeeks });
    }
    bars.sort((a, b) => b.weeks.length - a.weeks.length || b.pct - a.pct);
    return bars.slice(0, 3).map((b) => ({ name: b.name, weeks: b.weeks }));
  };

  // Prefer someone in the headline row (e.g. "NY Metro" for Office) so each
  // pivot's collision view ties back to its own peak overload group — but a
  // candidate only "wins" if we can actually show their project bars.
  // Previously pool[0] was taken blindly: when that one person had no
  // matching resource record the card fell back to "No collisions detected"
  // even though the next overloaded person DID have overlapping projects.
  // Scan by pct desc in tiers: genuinely overloaded people (>=100%) with
  // >=2 bars first (a real overlap), then overloaded with >=1 bar, and only
  // then relax the overload gate — so a 45% person with resolvable projects
  // never outranks a 150% person, and the card never paints a sub-100%
  // "failure point" red while true overloads exist.
  const filtered = pivotRow ? peaks.filter((p) => p.bucket === pivotRow) : [];
  const pools = [filtered, peaks].map((p) =>
    [...p].filter((c) => !!c.name).sort((a, b) => b.pct - a.pct).slice(0, 15),
  );
  const barsCache = new Map<PeakRow, CollisionBar[]>();
  const cachedBars = (cand: PeakRow): CollisionBar[] => {
    let b = barsCache.get(cand);
    if (!b) { b = barsFor(cand); barsCache.set(cand, b); }
    return b;
  };
  let winner: PeakRow | undefined;
  let projectBars: CollisionBar[] = [];
  outer: for (const minPct of [100, 0]) {
    for (const minBars of [2, 1]) {
      for (const pool of pools) {
        for (const cand of pool) {
          if (cand.pct < minPct) continue;
          const bars = cachedBars(cand);
          if (bars.length >= minBars) {
            winner = cand;
            projectBars = bars;
            break outer;
          }
        }
      }
    }
  }
  // Nobody has resolvable projects — keep the old behavior (top person, no
  // bars) so the card still names the overload instead of a blank.
  if (!winner) winner = pools[0][0] ?? pools[1][0];

  if (!winner || !winner.name) {
    return {
      person: "—",
      pct: 0,
      failWeek: weeks[0]?.label ?? "W1",
      bars: [],
      overlap: [],
      weekPct: [],
    };
  }

  // Compute weeks where ≥2 of the (possibly truncated) bars overlap.
  const overlap: string[] = [];
  for (const w of weeks) {
    const hits = projectBars.reduce((n, b) => n + (b.weeks.includes(w.label) ? 1 : 0), 0);
    if (hits >= 2) overlap.push(w.label);
  }

  // Pretty display name: "FIRST L." style, like the original mock.
  const parts = winner.name.trim().split(/\s+/);
  const display =
    parts.length >= 2
      ? `${parts[0].toUpperCase()} ${parts[parts.length - 1][0].toUpperCase()}.`
      : winner.name.toUpperCase();

  return {
    person: display,
    pct: Math.round(winner.pct),
    failWeek: weeks[winner.weekIdx]?.label ?? weeks[0]?.label ?? "W1",
    bars: projectBars,
    overlap: overlap.length > 0 ? overlap : [weeks[winner.weekIdx]?.label ?? weeks[0].label],
    weekPct: winner.weekPct,
  };
}

/* ------------------------------------------------------------------ */
/* Cell drill-down (real contributors)                                 */
/* ------------------------------------------------------------------ */

/** Builds the real "who & what" behind every heatmap cell. For each pivot we
 *  walk the utilization rows, and for every week a person is active (P > 0)
 *  we record them under their pivot bucket + week, resolving:
 *    - role  : Role/Title from the util row, falling back to the resource
 *              master job title / department (the only reliably-populated
 *              upstream dimension), then "—".
 *    - project: the single live allocation they were most loaded to that
 *              week (matched via LiveResourceProxy), mapped to its name.
 *    - pct   : their own utilization percent for that week.
 *  Each cell list is sorted by pct desc and capped so the panel stays tidy. */
function buildDrillCells(
  utilRows: Record<string, unknown>[],
  resources: LiveResourceProxy[],
  projectNameMap: Record<string, string>,
  weeks: WeekInfo[],
  resourceMaster: ResourceMasterRow[],
): DrillCells {
  const proxyById = new Map<string, LiveResourceProxy>();
  const proxyByName = new Map<string, LiveResourceProxy>();
  for (const r of resources) {
    if (r.id) proxyById.set(r.id.toLowerCase(), r);
    if (r.name) proxyByName.set(r.name.toLowerCase(), r);
  }
  const rmById = new Map<string, ResourceMasterRow>();
  const rmByName = new Map<string, ResourceMasterRow>();
  for (const m of resourceMaster ?? []) {
    if (m.id) rmById.set(String(m.id).toLowerCase(), m);
    if (m.name) rmByName.set(m.name.toLowerCase(), m);
  }

  const out: DrillCells = { Office: {}, Role: {}, Discipline: {} };
  const periodCache = utilRows.length > 0 ? alignPeriodsToWeeks(utilRows[0], weeks) : weeks.map(() => null);

  for (const pivot of PIVOTS) {
    const field = pivotField(pivot);
    const rowsMap = out[pivot];
    for (const r of utilRows) {
      const bucket = String(r[field] ?? "").trim();
      if (!bucket) continue;
      const name = String(r.ResourceUser ?? r.Name ?? "").trim();
      if (!name) continue;
      const userId = String(r.UserId ?? r.Id ?? "").trim();
      const rm =
        (userId ? rmById.get(userId.toLowerCase()) : undefined) ??
        rmByName.get(name.toLowerCase());
      const role =
        String(
          r.Role ?? r.Title ?? rm?.jobTitle ?? r.Department ?? rm?.department ?? "",
        ).trim() || "—";
      const proxy =
        (userId ? proxyById.get(userId.toLowerCase()) : undefined) ??
        proxyByName.get(name.toLowerCase());
      const aligned = periodCache.some((k) => k != null) ? periodCache : alignPeriodsToWeeks(r, weeks);

      for (let i = 0; i < weeks.length; i++) {
        const k = aligned[i];
        const pct = k ? parseUtilP(r[k]) : 0;
        if (pct <= 0) continue;
        const w = weeks[i];

        // Top live allocation for this person inside this week.
        let project = "";
        if (proxy) {
          let best = -1;
          for (const a of proxy.activeAllocations ?? []) {
            const aStart = a.startDate ? new Date(a.startDate) : null;
            const aEnd = a.endDate ? new Date(a.endDate) : null;
            if (aStart && aStart > w.endDate) continue;
            if (aEnd && aEnd < w.startDate) continue;
            if (a.pct > best) {
              best = a.pct;
              project = projectNameMap[a.projectId] || a.projectId;
            }
          }
        }

        const byBucket = (rowsMap[bucket] ??= {});
        const list = (byBucket[w.label] ??= []);
        list.push({ name, role, project: project || "—", pct: Math.round(pct) });
      }
    }
    for (const bucket of Object.keys(rowsMap)) {
      for (const wl of Object.keys(rowsMap[bucket])) {
        rowsMap[bucket][wl].sort((a, b) => b.pct - a.pct);
        rowsMap[bucket][wl] = rowsMap[bucket][wl].slice(0, 8);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Win-pursuit scenario                                                */
/* ------------------------------------------------------------------ */

/** "Win pursuit" models a hypothetical award. Like the mobile surface, the
 *  uplift is scaled by the pursuit's dollar value and ADDED on top of the
 *  current load (not a flat percentage), so it stays visible even when base
 *  demand is near zero. Heatmap: ~5 percentage points per $1M at peak on the
 *  most-stressed cohort row. Curve: ~1 FTE per $1.5M of contract value (a
 *  common AEC rule of thumb). Both ramp linearly across the window so the
 *  staffing need builds over time, and both move together on toggle. */
function applyUpliftHeatmap(
  h: Heatmap,
  weeks: WeekInfo[],
  pursuitValue: number,
  targetRow: string,
): Heatmap {
  const out: Heatmap = {};
  if (!(pursuitValue > 0) || !targetRow) {
    for (const [k, arr] of Object.entries(h)) out[k] = arr.slice();
    return out;
  }
  const peakPct = (pursuitValue / 1_000_000) * 5;
  const n = weeks.length || 1;
  for (const [k, arr] of Object.entries(h)) {
    if (k !== targetRow) {
      out[k] = arr.slice();
      continue;
    }
    out[k] = arr.map((v, i) => Math.round(v + peakPct * ((i + 1) / n)));
  }
  return out;
}

function recomputeHeadline(h: Heatmap, weeks: WeekInfo[]): HeatmapHeadline {
  let row = "";
  let week = weeks[0]?.label ?? "W1";
  let pct = 0;
  for (const [k, arr] of Object.entries(h)) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] > pct) {
        pct = arr[i];
        row = k;
        week = weeks[i].label;
      }
    }
  }
  return { row, week, pct };
}

function applyUpliftCurve(
  c: DemandCapacity,
  weeks: WeekInfo[],
  pursuitValue: number,
): DemandCapacity {
  if (!(pursuitValue > 0)) {
    return { demand: c.demand.slice(), capacity: c.capacity.slice() };
  }
  const peakFTE = pursuitValue / 1_500_000;
  const n = weeks.length || 1;
  return {
    demand: c.demand.map((v, i) => v + peakFTE * ((i + 1) / n)),
    capacity: c.capacity.slice(),
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export interface BuildForecastInput {
  utilRows: Record<string, unknown>[];
  resources: LiveResourceProxy[];
  demands: DemandItem[];
  projectNameMap: Record<string, string>;
  weeks: WeekInfo[];
  /** Optional directory used only to enrich the cell drill-down (role/dept)
   *  when the utilization rows themselves don't carry a role. */
  resourceMaster?: ResourceMasterRow[];
  /** Optional flat list of project module records (PMM/OPM/LEM rows). Used to
   *  resolve each project's discipline (market sector) so the Discipline pivot
   *  reflects real project data. Keyed internally by TicketId. */
  projectRecords?: Record<string, unknown>[];
  /** Dollar value of the open pursuit being modelled (from pickPursuit). Scales
   *  the "Win pursuit" uplift. 0/undefined ⇒ Win equals Base (no uplift). */
  pursuitValue?: number;
}

/* ------------------------------------------------------------------ */
/* Util-row enrichment (Office / Role / Discipline)                    */
/* ------------------------------------------------------------------ */

const SECTOR_FIELDS = [
  "SectorChoice", "Sector", "SectorName",
  "IndustryChoice", "MarketSector", "CRMBusinessUnitChoice",
];

/** Resolve a project's discipline (market sector) from a module record, using
 *  the same field priority the mobile forecast uses. Returns "" when none of
 *  the sector fields are populated. */
function getProjectDiscipline(r: Record<string, unknown>): string {
  for (const f of SECTOR_FIELDS) {
    const v = r?.[f];
    if (v !== null && v !== undefined && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return "";
}

/** Build a TicketId → discipline lookup from the flat list of project module
 *  records. Allocation projectIds are TicketIds (see rmone-proxy), so this map
 *  lets us resolve each person's project discipline. */
function buildProjectDiscipline(
  records: Record<string, unknown>[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of records ?? []) {
    const id = String(r?.TicketId ?? "").trim().toUpperCase();
    if (!id) continue;
    const disc = getProjectDiscipline(r);
    if (disc && !map[id]) map[id] = disc;
  }
  return map;
}

/** Build a TicketId → office lookup from project module records. Used as a
 *  fallback for the Office pivot when a person's own office field is blank —
 *  they are assigned to their most-allocated project's managing office. */
function buildProjectOffice(
  records: Record<string, unknown>[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of records ?? []) {
    const id = String(r?.TicketId ?? "").trim().toUpperCase();
    if (!id) continue;
    const office = String(r?.Office ?? r?.City ?? "").trim();
    if (office && !map[id]) map[id] = office;
  }
  return map;
}

/** Inject OfficeName / Role / Discipline onto every utilization row so the
 *  heatmap, slices, demand/capacity, collision and drill-down all have a real
 *  dimension to group by:
 *    - OfficeName : the person's own office/location (resource-master
 *                   department, the only reliably-readable location field).
 *    - Role       : their role from live allocations, then the directory job
 *                   title.
 *    - Discipline : the dominant market sector across the projects they're
 *                   allocated to inside the forecast window (weighted by pct).
 *  Anything we can't resolve falls back to "Unassigned" so the row is still
 *  counted instead of silently dropped. */
function enrichUtilRows(
  utilRows: Record<string, unknown>[],
  resources: LiveResourceProxy[],
  resourceMaster: ResourceMasterRow[],
  projectDiscipline: Record<string, string>,
  weeks: WeekInfo[],
  projectOffice: Record<string, string> = {},
): Record<string, unknown>[] {
  const proxyById = new Map<string, LiveResourceProxy>();
  const proxyByName = new Map<string, LiveResourceProxy>();
  for (const r of resources ?? []) {
    if (r.id) proxyById.set(r.id.toLowerCase(), r);
    if (r.name) proxyByName.set(r.name.toLowerCase(), r);
  }
  const rmById = new Map<string, ResourceMasterRow>();
  const rmByName = new Map<string, ResourceMasterRow>();
  for (const m of resourceMaster ?? []) {
    if (m.id) rmById.set(String(m.id).toLowerCase(), m);
    if (m.name) rmByName.set(m.name.toLowerCase(), m);
  }
  const wStart = weeks[0]?.startDate ?? null;
  const wEnd = weeks[weeks.length - 1]?.endDate ?? null;

  return (utilRows ?? []).map((r) => {
    const name = String(r.ResourceUser ?? r.Name ?? "").trim();
    const userId = String(r.UserId ?? r.Id ?? "").trim().toLowerCase();
    const proxy =
      (userId ? proxyById.get(userId) : undefined) ??
      (name ? proxyByName.get(name.toLowerCase()) : undefined);
    const rm =
      (userId ? rmById.get(userId) : undefined) ??
      (name ? rmByName.get(name.toLowerCase()) : undefined);

    const blankLabel = getBusinessRules().unassignedLabel;
    // Office: physical location from the HR directory (AspNetUsers.Office /
    // DeskLocation). When that's blank, fall back to the person's City from
    // the resource proxy (staff city field). If still blank, derive from the
    // person's most heavily allocated project's Office field — same
    // weighted-tally as Discipline.
    // Do NOT fall back to division/BU/department — those are org-structure
    // fields whose values (e.g. "Industrial", "Education") would appear as
    // fake office names in the Office pivot.
    let officeVal = (rm?.office ?? "").trim() || (proxy?.city ?? "").trim() || (rm?.department ?? "").trim();
    if (!officeVal && proxy) {
      const allAllocs = (proxy.allAllocations ?? proxy.activeAllocations) ?? [];
      const tally = new Map<string, number>();
      const tallyAll = new Map<string, number>();
      const wStart = weeks[0]?.startDate ?? null;
      const wEnd = weeks[weeks.length - 1]?.endDate ?? null;
      for (const a of allAllocs) {
        const key = String(a.projectId ?? "").trim().toUpperCase();
        const proj = (projectOffice[key] ?? "").trim();
        if (!proj) continue;
        const aStart = a.startDate ? new Date(a.startDate) : null;
        const aEnd = a.endDate ? new Date(a.endDate) : null;
        tallyAll.set(proj, (tallyAll.get(proj) ?? 0) + (Number(a.pct) || 1));
        if (wEnd && aStart && aStart > wEnd) continue;
        if (wStart && aEnd && aEnd < wStart) continue;
        tally.set(proj, (tally.get(proj) ?? 0) + (Number(a.pct) || 1));
      }
      const source = tally.size > 0 ? tally : tallyAll;
      const best = [...source.entries()].sort((x, y) => y[1] - x[1])[0];
      if (best) officeVal = best[0];
    }
    const office = officeVal || blankLabel;
    const role =
      (proxy?.role ?? "").trim() ||
      (rm?.jobTitle ?? "").trim() ||
      blankLabel;

    let discipline = blankLabel;
    if (proxy) {
      const tally = new Map<string, number>();
      for (const a of proxy.activeAllocations ?? []) {
        const key = String(a.projectId ?? "").trim().toUpperCase();
        const disc = (projectDiscipline[key] ?? "").trim();
        if (!disc) continue;
        const aStart = a.startDate ? new Date(a.startDate) : null;
        const aEnd = a.endDate ? new Date(a.endDate) : null;
        if (wEnd && aStart && aStart > wEnd) continue;
        if (wStart && aEnd && aEnd < wStart) continue;
        tally.set(disc, (tally.get(disc) ?? 0) + (Number(a.pct) || 1));
      }
      const best = [...tally.entries()].sort((x, y) => y[1] - x[1])[0];
      if (best) discipline = best[0];
    }

    return { ...r, OfficeName: office, Role: role, Discipline: discipline };
  });
}

export function buildForecast(input: BuildForecastInput): ForecastModel {
  const { resources, demands, projectNameMap, weeks } = input;
  const resourceMaster = input.resourceMaster ?? [];
  const pursuitValue = input.pursuitValue ?? 0;
  // The upstream utilization rows only carry a person + weekly P values — they
  // have NO Office/Role/Discipline columns. Without these the pivot bucket is
  // always empty and every row is dropped, leaving the heatmap blank on all
  // three tabs. Enrich each row with the real dimensions we *can* resolve
  // (resource office/role from the directory + live allocations, project
  // discipline from the module records) so the pipeline below has something to
  // group by. Everything downstream reads these injected fields via pivotField.
  const projectDiscipline = buildProjectDiscipline(input.projectRecords ?? []);
  const projectOffice     = buildProjectOffice(input.projectRecords ?? []);
  const utilRows = enrichUtilRows(
    input.utilRows, resources, resourceMaster, projectDiscipline, weeks, projectOffice,
  );
  const weekLabels = weeks.map((w) => w.label);

  const heatmap: ForecastModel["heatmap"] = { Office: { Base: {}, Win: {} }, Role: { Base: {}, Win: {} }, Discipline: { Base: {}, Win: {} } };
  const heatmapHeadline: ForecastModel["heatmapHeadline"] = {
    Office: { Base: blankHeadline(weekLabels), Win: blankHeadline(weekLabels) },
    Role: { Base: blankHeadline(weekLabels), Win: blankHeadline(weekLabels) },
    Discipline: { Base: blankHeadline(weekLabels), Win: blankHeadline(weekLabels) },
  };
  const demandCap: ForecastModel["demandCap"] = {
    Office: { Base: blankCurve(weeks), Win: blankCurve(weeks) },
    Role: { Base: blankCurve(weeks), Win: blankCurve(weeks) },
    Discipline: { Base: blankCurve(weeks), Win: blankCurve(weeks) },
  };
  const hireTrigger: ForecastModel["hireTrigger"] = {
    Office: { Base: blankTrigger(weeks), Win: blankTrigger(weeks) },
    Role: { Base: blankTrigger(weeks), Win: blankTrigger(weeks) },
    Discipline: { Base: blankTrigger(weeks), Win: blankTrigger(weeks) },
  };
  const collision: ForecastModel["collision"] = {
    Office: blankCollision(weeks),
    Role: blankCollision(weeks),
    Discipline: blankCollision(weeks),
  };
  const rowsByPivot: ForecastModel["rowsByPivot"] = { Office: [], Role: [], Discipline: [] };

  const windowStart = weeks[0].startDate;
  const windowEnd = weeks[weeks.length - 1].endDate;

  for (const pivot of PIVOTS) {
    const slices = pivot === "Discipline"
      ? buildDisciplineSlices(utilRows, resources, projectDiscipline, weeks)
      : buildRowSlices(utilRows, weeks, pivot);

    const baseHeat = buildHeatmap(slices, weeks, 8);
    rowsByPivot[pivot] = baseHeat.rows;
    heatmap[pivot].Base = baseHeat.data;
    heatmapHeadline[pivot].Base = baseHeat.headline;

    const winData = applyUpliftHeatmap(
      baseHeat.data, weeks, pursuitValue, baseHeat.headline.row,
    );
    heatmap[pivot].Win = winData;
    heatmapHeadline[pivot].Win = recomputeHeadline(winData, weeks);

    const baseCurve = buildDemandCapacity(utilRows, demands, weeks, pivot, baseHeat.headline.row || undefined);
    demandCap[pivot].Base = baseCurve;
    demandCap[pivot].Win = applyUpliftCurve(baseCurve, weeks, pursuitValue);

    hireTrigger[pivot].Base = buildHireTrigger(baseCurve, weeks, demands, windowStart, windowEnd);
    hireTrigger[pivot].Win = buildHireTrigger(demandCap[pivot].Win, weeks, demands, windowStart, windowEnd);

    collision[pivot] = buildCollision(
      utilRows, resources, projectNameMap, weeks, pivot,
      baseHeat.headline.row || null,
    );
  }

  const drill = {
    cells: buildDrillCells(utilRows, resources, projectNameMap, weeks, resourceMaster),
  };

  // Replace the Discipline heatmap with a relative load index so that the
  // Discipline tab shows numbers that are meaningfully different from Role and
  // Office even when the underlying data has one person per discipline bucket.
  // Index = 100 → exactly at firm average; >100 → above average (stressed);
  // <100 → below average (capacity available).  The win-scenario values are
  // normalised independently so their relative uplift is preserved.
  const discBaseNorm = normToIndex(heatmap.Discipline.Base);
  const discWinNorm = normToIndex(heatmap.Discipline.Win);
  heatmap.Discipline.Base = discBaseNorm;
  heatmap.Discipline.Win = discWinNorm;
  heatmapHeadline.Discipline.Base = recomputeHeadline(discBaseNorm, weeks);
  heatmapHeadline.Discipline.Win = recomputeHeadline(discWinNorm, weeks);

  return { weeks, weekLabels, rowsByPivot, heatmap, heatmapHeadline, demandCap, hireTrigger, collision, drill };
}

/** Normalise a Discipline heatmap to a relative load index.
 *  Each cell value v → round(v / firmAvg × 100), where firmAvg is the
 *  mean of every non-zero cell across all buckets and all weeks.
 *  Index = 100 means exactly at firm average; >100 = above average (stressed);
 *  <100 = below average (capacity available).
 *  This guarantees Discipline numbers differ from Role/Office even when the
 *  data has a 1-person-per-discipline structure (each person maps to exactly
 *  one sector), because the denominator is the firm average, not a per-bucket
 *  count. */
function normToIndex(h: Heatmap): Heatmap {
  const allVals: number[] = [];
  for (const vals of Object.values(h)) {
    for (const v of vals) {
      if (v > 0) allVals.push(v);
    }
  }
  if (allVals.length === 0) return h;
  const firmAvg = allVals.reduce((a, b) => a + b, 0) / allVals.length;
  if (firmAvg <= 0) return h;
  const out: Heatmap = {};
  for (const [k, vals] of Object.entries(h)) {
    out[k] = vals.map((v) => (v > 0 ? Math.round((v / firmAvg) * 100) : 0));
  }
  return out;
}

function blankHeadline(weeks: string[]): HeatmapHeadline {
  return { week: weeks[0] ?? "W1", row: "", pct: 0 };
}
function blankCurve(weeks: WeekInfo[]): DemandCapacity {
  return { demand: weeks.map(() => 0), capacity: weeks.map(() => 0) };
}
function blankTrigger(weeks: WeekInfo[]): HireTrigger {
  return { month: weeks[0]?.monthShort ?? "—", week: weeks[0]?.label ?? "W1", demand: "—" };
}
function blankCollision(weeks: WeekInfo[]): CollisionView {
  return {
    person: "—", pct: 0, failWeek: weeks[0]?.label ?? "W1", bars: [], overlap: [], weekPct: [],
  };
}
