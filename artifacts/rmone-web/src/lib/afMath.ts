/**
 * Client-side math for the Actuals vs Forecast pages (graph, forecast report,
 * executive rollup).
 *
 * Sign convention (documented in the Definitions card on every page):
 *   variance = forecast-to-date − actual-to-date, POSITIVE = favorable
 *   (fewer hours / dollars burned than planned so far).
 *
 * Unfiltered views read the FROZEN weekly snapshots from the server. When a
 * division / person filter is active the series is recomputed client-side
 * from the detail table, which always reflects the CURRENT plan — filtered
 * history is a reconstruction and can differ from the frozen snapshot line
 * (each page shows a footnote saying so).
 */
import type { AfWeekRow, AfDetailRow } from "@/lib/api";
import { compactUsd } from "./money";

export type AfUnit = "hours" | "cost" | "bill";
export type PeriodKind = "week" | "month" | "year";

export const UNIT_LABEL: Record<AfUnit, string> = {
  hours: "Hours",
  cost: "Cost ($)",
  bill: "Billing ($)",
};

/** Snapshot-row field names for each unit family. */
export function unitFields(unit: AfUnit): {
  actualTd: keyof AfWeekRow;
  forecastTd: keyof AfWeekRow;
  eac: keyof AfWeekRow;
  variance: keyof AfWeekRow;
} {
  if (unit === "cost") {
    return { actualTd: "actualCostTd", forecastTd: "forecastCostTd", eac: "forecastTotalCost", variance: "costVariance" };
  }
  if (unit === "bill") {
    return { actualTd: "actualBillTd", forecastTd: "forecastBillTd", eac: "forecastTotalBill", variance: "billVariance" };
  }
  return { actualTd: "actualHoursTd", forecastTd: "forecastHoursTd", eac: "forecastTotalHours", variance: "hoursVariance" };
}

/** Frozen-row values for one unit family: actual to date, remaining
 * forecast, forecast at completion (EAC) and the unit's variance. */
export function unitValues(row: AfWeekRow, unit: AfUnit): {
  actualTd: number; remaining: number; eac: number; variance: number;
} {
  if (unit === "cost") {
    return { actualTd: row.actualCostTd, remaining: row.forecastRemainingCost, eac: row.forecastTotalCost, variance: row.costVariance };
  }
  if (unit === "bill") {
    return { actualTd: row.actualBillTd, remaining: row.forecastRemainingBill, eac: row.forecastTotalBill, variance: row.billVariance };
  }
  return { actualTd: row.actualHoursTd, remaining: row.forecastRemainingHours, eac: row.forecastTotalHours, variance: row.hoursVariance };
}

/* ── period bucketing ─────────────────────────────────────────────────── */

/** Auto granularity: ≤26 weeks → weekly, ≤132 weeks (~2.5y) → monthly, else yearly. */
export function pickPeriodKind(weekCount: number): PeriodKind {
  if (weekCount <= 26) return "week";
  if (weekCount <= 132) return "month";
  return "year";
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function bucketKeyOf(weekMonday: string, kind: PeriodKind): string {
  if (kind === "week") return weekMonday;
  if (kind === "month") return weekMonday.slice(0, 7); // YYYY-MM
  return weekMonday.slice(0, 4); // YYYY
}

export function bucketLabelOf(key: string, kind: PeriodKind): string {
  if (kind === "week") {
    const [y, m, d] = key.split("-").map(Number);
    if (!y || !m || !d) return key;
    return `${MONTH_SHORT[m - 1]} ${d}`;
  }
  if (kind === "month") {
    const [y, m] = key.split("-").map(Number);
    if (!y || !m) return key;
    return `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}`;
  }
  return key;
}

/** One chart/table point per period bucket. Cumulative (TD) metrics take the
 * LAST weekly snapshot inside the bucket — "where the project stood at the
 * end of that period". */
export interface AfPoint {
  key: string;
  label: string;
  weekMonday: string; // last snapshot week in the bucket
  actualTd: number;
  forecastTd: number;
  eac: number; // forecast total at completion (actual TD + remaining)
  variance: number; // forecastTd − actualTd, positive = favorable
  final: boolean;
  backfilled: boolean;
  substitutedHours: number;
  unratedActualHours: number;
  actualsCovered: boolean;
  isCurrent: boolean; // bucket containing the current week
  isFuture: boolean; // bucket entirely after the current week
}

export function toPoints(
  weeks: AfWeekRow[],
  unit: AfUnit,
  kind: PeriodKind,
  currentWeek: string,
): AfPoint[] {
  const f = unitFields(unit);
  const byBucket = new Map<string, AfWeekRow>();
  const order: string[] = [];
  const sorted = [...weeks].sort((a, b) => a.weekMonday.localeCompare(b.weekMonday));
  for (const w of sorted) {
    const key = bucketKeyOf(w.weekMonday, kind);
    if (!byBucket.has(key)) order.push(key);
    byBucket.set(key, w); // ascending walk → last write wins = last week in bucket
  }
  const currentKey = bucketKeyOf(currentWeek, kind);
  return order.map((key) => {
    const w = byBucket.get(key)!;
    return {
      key,
      label: bucketLabelOf(key, kind),
      weekMonday: w.weekMonday,
      actualTd: Number(w[f.actualTd]) || 0,
      forecastTd: Number(w[f.forecastTd]) || 0,
      eac: Number(w[f.eac]) || 0,
      variance: Number(w[f.variance]) || 0,
      final: w.final,
      backfilled: w.backfilled,
      substitutedHours: w.substitutedHours,
      unratedActualHours: w.unratedActualHours,
      actualsCovered: w.actualsCovered || w.substitutedHours > 0,
      isCurrent: key === currentKey,
      isFuture: key > currentKey,
    };
  });
}

/* ── filtered recompute from the detail table ─────────────────────────── */

export interface AfDetailFilter {
  division?: string; // exact match; "" filter value means "missing division"
  person?: string; // resource GUID (lowercase); "" means open/unstaffed demand
}

export function filterDetail(rows: AfDetailRow[], filter: AfDetailFilter): AfDetailRow[] {
  return rows.filter((r) => {
    if (filter.division !== undefined && r.division !== filter.division) return false;
    if (filter.person !== undefined && r.person !== filter.person) return false;
    return true;
  });
}

/**
 * Rebuild a snapshot-shaped weekly series from (filtered) detail rows.
 * remaining(W) = filtered plan total − plan TD(W), so the EAC line still
 * converges to the plan end. All three unit families are computed so the
 * result feeds toPoints() unchanged. final/backfilled are false — this is a
 * live reconstruction, not frozen history.
 */
export function seriesFromDetail(rows: AfDetailRow[]): AfWeekRow[] {
  if (!rows.length) return [];
  const byWeek = new Map<string, AfDetailRow[]>();
  for (const r of rows) {
    const list = byWeek.get(r.weekMonday);
    if (list) list.push(r);
    else byWeek.set(r.weekMonday, [r]);
  }
  const weeks = [...byWeek.keys()].sort();
  let planH = 0, planC = 0, planB = 0;
  for (const r of rows) {
    planH += r.forecastHours;
    planC += r.forecastCost;
    planB += r.forecastBill;
  }
  let aH = 0, aC = 0, aB = 0;
  let fH = 0, fC = 0, fB = 0;
  let sub = 0;
  const out: AfWeekRow[] = [];
  for (const wk of weeks) {
    const weekRows = byWeek.get(wk)!;
    for (const r of weekRows) {
      aH += r.actualHours; aC += r.actualCost; aB += r.actualBill;
      fH += r.forecastHours; fC += r.forecastCost; fB += r.forecastBill;
      if (r.substituted) sub += r.actualHours;
    }
    out.push({
      weekMonday: wk,
      actualHoursTd: round2(aH),
      forecastRemainingHours: round2(planH - fH),
      forecastTotalHours: round2(aH + (planH - fH)),
      forecastHoursTd: round2(fH),
      actualCostTd: round2(aC),
      forecastRemainingCost: round2(planC - fC),
      forecastTotalCost: round2(aC + (planC - fC)),
      forecastCostTd: round2(fC),
      actualBillTd: round2(aB),
      forecastRemainingBill: round2(planB - fB),
      forecastTotalBill: round2(aB + (planB - fB)),
      forecastBillTd: round2(fB),
      hoursVariance: round2(fH - aH),
      costVariance: round2(fC - aC),
      billVariance: round2(fB - aB),
      substitutedHours: round2(sub),
      unratedActualHours: 0, // not reconstructable per-week client-side
      actualsCovered: weekRows.some((r) => r.actualsCovered || r.substituted),
      final: false,
      backfilled: false,
      computedAt: null,
    });
  }
  return out;
}

/* ── KPI helpers ──────────────────────────────────────────────────────── */

export function latestAtOrBefore(weeks: AfWeekRow[], currentWeek: string): AfWeekRow | null {
  let best: AfWeekRow | null = null;
  for (const w of weeks) {
    if (w.weekMonday > currentWeek) continue;
    if (!best || w.weekMonday > best.weekMonday) best = w;
  }
  return best;
}

/**
 * Anchor point for picker-triggered detail popups, ALWAYS computed from the
 * UNFILTERED frozen series: page-level points follow the active filter, so
 * choosing person B while person A is selected must not anchor B's popup on
 * A's sparse (possibly future-only) timeline. Picks the point covering the
 * latest snapshot at/before the current week — the same "now" the picker
 * stats and KPIs use — never the final (often future) point. A series that
 * lies entirely in the future falls back to its last point, mirroring the
 * picker-stats `?? lastWeek` fallback for young projects.
 */
export function afPickerAnchorPoint(weeks: AfWeekRow[], currentWeek: string, unit: AfUnit): AfPoint | null {
  const kind = pickPeriodKind(weeks.length);
  const points = toPoints(weeks, unit, kind, currentWeek);
  if (points.length === 0) return null;
  const cutoff = (latestAtOrBefore(weeks, currentWeek) ?? lastWeek(weeks))?.weekMonday;
  if (!cutoff) return points[points.length - 1];
  const cutoffKey = bucketKeyOf(cutoff, kind);
  return points.find((p) => p.key === cutoffKey)
    ?? [...points].reverse().find((p) => p.weekMonday <= cutoff)
    ?? points[points.length - 1];
}

export function lastWeek(weeks: AfWeekRow[]): AfWeekRow | null {
  let best: AfWeekRow | null = null;
  for (const w of weeks) {
    if (!best || w.weekMonday > best.weekMonday) best = w;
  }
  return best;
}

/** Tolerant "contract value"-style parse: strips $, commas, spaces. null = not a number. */
export function parseMoneyish(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function round2(n: number): number {
  // "+ 0" folds IEEE negative zero (e.g. round2(-1e-13) → -0) into +0 so
  // formatters never render "-0" (Intl formats -0 with a minus sign).
  return Math.round((n + Number.EPSILON) * 100) / 100 + 0;
}

/** Two-decimal max display (hours + multiples), no float tails. */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const r = round2(n);
  return r.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Magnitude-safe money display: delegates to compactUsd at ≥$1B. */
export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const v = Math.abs(n);
  // Decide the sign at DISPLAY precision: a value that renders as $0 (a
  // −1e-10 float tail, or −$0.40 in whole-dollar display) keeps no stray "−".
  const sign = n < 0 && Math.round(v) > 0 ? "−" : "";
  if (v >= 1e9) return sign + compactUsd(v);
  if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (v >= 1e4) return `${sign}$${Math.round(v / 1e3).toLocaleString("en-US")}K`;
  return `${sign}$${Math.round(v).toLocaleString("en-US")}`;
}

/** UTC Monday (ISO date) of the week containing the given ISO date. */
export function mondayIsoOf(dateIso: string): string | null {
  const t = Date.parse(dateIso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow))
    .toISOString().slice(0, 10);
}

/* ── Executive Forecast rollup (table + ExecForecastPopup) ────────────── */

export type ExecSortKey = "actual" | "remaining" | "fac" | "hoursVar" | "costVar" | "pctUsed";
export type ExecSortDir = "asc" | "desc";

/** Minimal row shape the Executive Forecast table comparator sorts on. */
export interface ExecSortableRow {
  ticket: string;
  actual: number | null;
  remaining: number | null;
  fac: number | null;
  hoursVar: number | null;
  costVar: number | null;
  pctUsed: number | null;
}

/**
 * First-click sort direction per column: variance columns start ASCENDING so
 * the worst projects (most over forecast — most negative variance) surface
 * first; magnitude columns start descending (biggest first).
 */
export function execInitialSortDir(key: ExecSortKey): ExecSortDir {
  return key === "hoursVar" || key === "costVar" ? "asc" : "desc";
}

/**
 * Executive Forecast table comparator: numeric on the selected column with
 * the ticket as a stable tie-break; null values (e.g. % Used without a FAC)
 * sort LAST regardless of direction, so "unknown" never poses as best or
 * worst. Guarded by check:reports-honesty.
 */
export function execRowComparator<T extends ExecSortableRow = ExecSortableRow>(
  key: ExecSortKey,
  dir: ExecSortDir,
): (a: T, b: T) => number {
  const mul = dir === "asc" ? 1 : -1;
  return (a, b) => {
    const an = a[key];
    const bn = b[key];
    if (an == null && bn == null) return a.ticket.localeCompare(b.ticket);
    if (an == null) return 1; // nulls last regardless of direction
    if (bn == null) return -1;
    return (an - bn) * mul || a.ticket.localeCompare(b.ticket);
  };
}

/**
 * % Used = Actual to Date ÷ Forecast at Completion as a percent, clamped to
 * 0–100 (a junk snapshot can put actuals past the FAC or below zero — the
 * gauge never reads past its ends). No usable FAC (≤ 0) → null, rendered as
 * "—", never 0%, Infinity or NaN. The rollup table and ExecForecastPopup
 * both call this on the SAME frozen overview row, so the popup tile always
 * matches the table column. Guarded by check:reports-honesty.
 */
export function execPctUsed(actualTd: number, eac: number): number | null {
  if (!(eac > 0)) return null;
  return Math.min(100, Math.max(0, (actualTd / eac) * 100));
}

/* ── person display identity ──────────────────────────────────────────── */

/** One honest label for every surface that can't resolve a person's name. */
export const UNKNOWN_PERSON_LABEL = "Unknown team member";

/** Picker label for the open-demand pseudo-person (person === ""). */
export const UNSTAFFED_DEMAND_LABEL = "Unstaffed demand";

/** GUID-shaped display value — a raw id must never be shown as a name. */
export function looksLikePersonId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

/**
 * Canonical display name for a detail-row person. GUIDs stay internal filter
 * keys; a blank, GUID-shaped, or id-echoing stored name collapses to the one
 * honest fallback label instead of leaking the raw id. Open (unstaffed)
 * demand rows (person === "") pass through — each surface labels open demand
 * itself ("Unstaffed demand" / "Open roles (not yet staffed)").
 */
export function afPersonDisplayName(person: string, storedName: string): string {
  if (person === "") return storedName;
  const name = String(storedName ?? "").trim();
  if (!name || looksLikePersonId(name) || name.toLowerCase() === person.trim().toLowerCase()) {
    return UNKNOWN_PERSON_LABEL;
  }
  return name;
}

/* ── click-to-explain aggregation ─────────────────────────────────────── */

export type AfMetric = "actual" | "plan" | "variance" | "eac";

/** The table/chart value a metric reads off an AfPoint. */
export function pointValueOf(p: AfPoint, m: AfMetric): number {
  return m === "actual" ? p.actualTd : m === "plan" ? p.forecastTd : m === "variance" ? p.variance : p.eac;
}

export interface AfUnitTriple { hours: number; cost: number; bill: number }

export function tripleValue(t: AfUnitTriple, unit: AfUnit): number {
  return unit === "hours" ? t.hours : unit === "cost" ? t.cost : t.bill;
}

export interface AfExplainPerson {
  person: string; // GUID lowercase, "" = open (unstaffed) demand
  name: string;
  roles: string[];
  division: string;
  actual: AfUnitTriple;    // imported actuals through the cutoff week
  plan: AfUnitTriple;      // planned through the cutoff week
  planTotal: AfUnitTriple; // planned across ALL weeks (EAC remaining = planTotal − plan)
  anyApprox: boolean;      // some actual rows were priced with an estimated rate
  anySubstituted: boolean; // some "actuals" are planned hours substituted by setting
  firstActualWeek: string | null; lastActualWeek: string | null;
  firstPlanWeek: string | null;   lastPlanWeek: string | null;
}

/**
 * Group detail rows per person with sums through cutoffWeek (inclusive), for
 * the "where does this number come from?" popup. planTotal spans every week
 * so remaining = planTotal − plan matches how seriesFromDetail builds the EAC.
 * The detail table always reflects the CURRENT plan — callers must disclose
 * when a frozen snapshot value differs from these sums.
 */
export function explainRows(rows: AfDetailRow[], cutoffWeek: string): AfExplainPerson[] {
  const by = new Map<string, AfExplainPerson>();
  for (const r of rows) {
    let p = by.get(r.person);
    if (!p) {
      p = {
        person: r.person, name: afPersonDisplayName(r.person, r.personName), roles: [], division: r.division,
        actual: { hours: 0, cost: 0, bill: 0 },
        plan: { hours: 0, cost: 0, bill: 0 },
        planTotal: { hours: 0, cost: 0, bill: 0 },
        anyApprox: false, anySubstituted: false,
        firstActualWeek: null, lastActualWeek: null, firstPlanWeek: null, lastPlanWeek: null,
      };
      by.set(r.person, p);
    } else if (p.person !== "" && p.name === UNKNOWN_PERSON_LABEL) {
      // A person's rows can mix blank and real names (e.g. imported actuals
      // carry a name while roster-less demand rows don't) — upgrade to the
      // first real one instead of latching the fallback.
      const candidate = afPersonDisplayName(r.person, r.personName);
      if (candidate !== UNKNOWN_PERSON_LABEL) p.name = candidate;
    }
    if (r.roleName && !p.roles.includes(r.roleName)) p.roles.push(r.roleName);
    p.planTotal.hours += r.forecastHours; p.planTotal.cost += r.forecastCost; p.planTotal.bill += r.forecastBill;
    if (r.weekMonday > cutoffWeek) continue;
    p.actual.hours += r.actualHours; p.actual.cost += r.actualCost; p.actual.bill += r.actualBill;
    p.plan.hours += r.forecastHours; p.plan.cost += r.forecastCost; p.plan.bill += r.forecastBill;
    if (r.actualHours !== 0) {
      if (!p.firstActualWeek || r.weekMonday < p.firstActualWeek) p.firstActualWeek = r.weekMonday;
      if (!p.lastActualWeek || r.weekMonday > p.lastActualWeek) p.lastActualWeek = r.weekMonday;
      if (r.rateApproximated) p.anyApprox = true;
      if (r.substituted) p.anySubstituted = true;
    }
    if (r.forecastHours !== 0) {
      if (!p.firstPlanWeek || r.weekMonday < p.firstPlanWeek) p.firstPlanWeek = r.weekMonday;
      if (!p.lastPlanWeek || r.weekMonday > p.lastPlanWeek) p.lastPlanWeek = r.weekMonday;
    }
  }
  return [...by.values()];
}

/* ── people picker choices (project people popup) ─────────────────────── */

export interface AfPersonChoice {
  /** Resource GUID, "" = open (unstaffed) demand — the stable filter key. */
  id: string;
  name: string;
  role: string;     // comma list of distinct role names seen on detail rows
  division: string; // comma list of distinct divisions
  actualHours: number;   // imported actuals through the latest snapshot week
  plannedHours: number;  // planned through the latest snapshot week
  varianceHours: number; // plannedHours − actualHours (page sign convention)
  /** Planned across ALL weeks — catches people planned only in the future. */
  plannedTotalHours: number;
}

/**
 * One row per person for the people picker popup: honest display name plus
 * role/division context and to-date hour stats from the same explainRows()
 * math the explain popup shows, so the two surfaces always agree. Rows are
 * keyed by GUID — two people sharing a display name stay separate entries.
 */
export function buildAfPersonChoices(
  detail: AfDetailRow[],
  weeks: AfWeekRow[],
  currentWeek: string,
): AfPersonChoice[] {
  const latest = latestAtOrBefore(weeks, currentWeek) ?? lastWeek(weeks);
  // With no snapshot weeks yet the to-date stats are honestly zero, but the
  // all-weeks plan total still accumulates (explainRows sums planTotal before
  // its cutoff check), so future-only people don't look like empty rows.
  const stats = new Map(
    explainRows(detail, latest?.weekMonday ?? "0000-00-00").map((p) => [p.person, p]),
  );
  const m = new Map<string, AfPersonChoice>();
  for (const r of detail) {
    const id = r.person;
    const name = id === "" ? UNSTAFFED_DEMAND_LABEL : afPersonDisplayName(id, r.personName);
    const previous = m.get(id);
    if (previous) {
      if (id !== "" && previous.name === UNKNOWN_PERSON_LABEL && name !== UNKNOWN_PERSON_LABEL) {
        previous.name = name;
      }
      if (r.roleName && !previous.role.split(", ").includes(r.roleName)) {
        previous.role = previous.role ? `${previous.role}, ${r.roleName}` : r.roleName;
      }
      if (r.division && !previous.division.split(", ").includes(r.division)) {
        previous.division = previous.division ? `${previous.division}, ${r.division}` : r.division;
      }
      continue;
    }
    const stat = stats.get(id);
    const actualHours = stat?.actual.hours ?? 0;
    const plannedHours = stat?.plan.hours ?? 0;
    m.set(id, {
      id, name, role: r.roleName || "", division: r.division || "",
      actualHours, plannedHours, varianceHours: plannedHours - actualHours,
      plannedTotalHours: stat?.planTotal.hours ?? 0,
    });
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Which explain-popup tab a picker selection opens on — the tab where the
 * person actually has rows, so click-to-detail never lands on an empty
 * breakdown: planned-to-date → Planned; actuals only → Actual; plan entirely
 * after the latest snapshot (future-only people) → Expected total, whose
 * rows include still-planned hours.
 */
export function afDetailMetricFor(
  choice: Pick<AfPersonChoice, "actualHours" | "plannedHours" | "plannedTotalHours">,
): AfMetric {
  if (choice.plannedHours !== 0) return "plan";
  if (choice.actualHours !== 0) return "actual";
  if (choice.plannedTotalHours !== 0) return "eac";
  return "plan";
}

/**
 * Metric routing evaluated AT the popup's cutoff week over the rows the
 * popup will actually render. The picker's to-date stats and the popup's
 * anchor cutoff can legally differ (a person planned only after the latest
 * snapshot has zero to-date hours but nonzero plan at a later anchor), so
 * the tab decision must come from the same explainRows() the popup makes:
 * plan row needs planTd ≠ 0, actual row needs actual ≠ 0, and the EAC row
 * needs actual ≠ 0 or remaining (planTotal − planTd) ≠ 0 — afDetailMetricFor
 * applied to the cutoff stats picks exactly a tab whose predicate holds.
 * The predicates evaluate in the popup's SELECTED unit family, so routing
 * takes the unit too (a person with plan hours but $0 cost has no visible
 * cost rows anywhere — Planned's empty state is then the honest answer).
 */
export function afDetailMetricAt(detail: AfDetailRow[], cutoffWeek: string, person: string, unit: AfUnit = "hours"): AfMetric {
  const stat = explainRows(detail, cutoffWeek).find((p) => p.person === person);
  if (!stat) return "plan";
  return afDetailMetricFor({
    actualHours: tripleValue(stat.actual, unit),
    plannedHours: tripleValue(stat.plan, unit),
    plannedTotalHours: tripleValue(stat.planTotal, unit),
  });
}

/* ── per-person week-by-week timeline (popup drill-down) ─────────────── */

export function plusDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}

export type AfTimelineKind = "actual" | "plan";

export interface AfWeekCell {
  weekMonday: string;
  hours: number;
  value: number; // in the requested unit
  substituted: boolean;
  approx: boolean;
}

/**
 * One person's per-week values for the drill-down strip. Window:
 * weekMonday > fromWeekExclusive (if set) and <= toWeekInclusive (if set) —
 * pass (null, cutoff) for "through the period" and (cutoff, null) for
 * "still planned after it". Same-person same-week rows (multiple roles) are
 * summed into one cell; zero weeks are dropped; result is week-sorted.
 * Cell sums equal exactly what explainRows reports for the same window,
 * because both read the same detail rows.
 */
export function personWeekSeries(
  rows: AfDetailRow[],
  person: string,
  kind: AfTimelineKind,
  unit: AfUnit,
  fromWeekExclusive: string | null,
  toWeekInclusive: string | null,
): AfWeekCell[] {
  const byWeek = new Map<string, { hours: number; value: number; sub: boolean; approx: boolean }>();
  for (const r of rows) {
    if (r.person !== person) continue;
    if (toWeekInclusive && r.weekMonday > toWeekInclusive) continue;
    if (fromWeekExclusive && r.weekMonday <= fromWeekExclusive) continue;
    const hours = kind === "actual" ? r.actualHours : r.forecastHours;
    const value = unit === "hours"
      ? hours
      : kind === "actual"
        ? (unit === "cost" ? r.actualCost : r.actualBill)
        : (unit === "cost" ? r.forecastCost : r.forecastBill);
    if (!hours && !value) continue;
    const w = byWeek.get(r.weekMonday) ?? { hours: 0, value: 0, sub: false, approx: false };
    w.hours += hours;
    w.value += value;
    if (kind === "actual" && r.substituted) w.sub = true;
    if (kind === "actual" && r.rateApproximated) w.approx = true;
    byWeek.set(r.weekMonday, w);
  }
  return [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([weekMonday, w]) => ({ weekMonday, hours: w.hours, value: w.value, substituted: w.sub, approx: w.approx }));
}

export type AfStripCol =
  | { kind: "week"; weekMonday: string; cells: (AfWeekCell | null)[] }
  | { kind: "gap"; fromWeek: string; weeks: number };

/**
 * Lay one or more week series onto a single shared weekly axis (union range,
 * so parallel rows like Planned/Actual stay column-aligned). Interior weeks
 * where EVERY series is zero become explicit 0-columns, except runs of
 * `collapseAt`+ zero weeks, which collapse into one "gap" column — a person
 * planned in 2025 and again in 2027 doesn't produce a hundred empty cells.
 * `cells` is parallel to the input series list (null = nothing that week).
 */
export function buildWeekStrip(seriesList: AfWeekCell[][], collapseAt = 7): AfStripCol[] {
  const maps = seriesList.map((s) => new Map(s.map((c) => [c.weekMonday, c])));
  let min: string | null = null;
  let max: string | null = null;
  for (const s of seriesList) {
    for (const c of s) {
      if (!min || c.weekMonday < min) min = c.weekMonday;
      if (!max || c.weekMonday > max) max = c.weekMonday;
    }
  }
  if (!min || !max) return [];
  const cols: AfStripCol[] = [];
  let zeroRun: string[] = [];
  const flush = () => {
    if (zeroRun.length === 0) return;
    if (zeroRun.length >= collapseAt) {
      cols.push({ kind: "gap", fromWeek: zeroRun[0], weeks: zeroRun.length });
    } else {
      for (const w of zeroRun) cols.push({ kind: "week", weekMonday: w, cells: maps.map(() => null) });
    }
    zeroRun = [];
  };
  for (let w = min; w <= max; w = plusDaysIso(w, 7)) {
    const cells = maps.map((m) => m.get(w) ?? null);
    if (cells.every((c) => !c)) { zeroRun.push(w); continue; }
    flush();
    cols.push({ kind: "week", weekMonday: w, cells });
  }
  flush();
  return cols;
}

/* ── actuals-import upload planning ───────────────────────────────────── */

export interface UploadChunkPlan<R> {
  /** Exactly the rows that will be uploaded, in original file order. */
  rows: R[];
  /** `rows` cut into consecutive slices of ≤ chunkSize; concatenated in
   *  order they re-form `rows` exactly. */
  chunks: R[][];
  /** The rowsTotal the commit call must receive — always rows.length, so
   *  the server's accounting is checked against the rows actually sent. */
  total: number;
}

/**
 * Row selection + chunking for the actuals-import upload, kept in ONE pure
 * helper so a regression test can pin it. "Skip flagged" must filter FIRST
 * and the chunk loop must slice the FILTERED list — an earlier version
 * sliced the ORIGINAL row list while committing the filtered count, which
 * uploads the wrong rows (flagged ones included, trailing ready ones
 * dropped) while every total still balances, so nothing looks wrong.
 *
 * `checks` is positional (checks[i] judges allRows[i]); when the pre-check
 * couldn't run (null) there is nothing to skip and every row uploads — the
 * server re-validates each row either way. A checks list whose length
 * doesn't match the rows was computed for a DIFFERENT row list; filtering
 * by index would misalign, so it throws loudly instead of guessing.
 */
export function planUploadChunks<R>(
  allRows: readonly R[],
  checks: readonly { ok: boolean }[] | null,
  skipFlagged: boolean,
  chunkSize: number,
): UploadChunkPlan<R> {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`Upload chunk size must be a positive integer, got ${chunkSize}.`);
  }
  if (checks && checks.length !== allRows.length) {
    throw new Error(`Pre-check results don't line up with the rows (${checks.length} checks for ${allRows.length} rows).`);
  }
  const rows = skipFlagged && checks ? allRows.filter((_, i) => checks[i].ok) : [...allRows];
  const chunks: R[][] = [];
  for (let at = 0; at < rows.length; at += chunkSize) {
    chunks.push(rows.slice(at, at + chunkSize)); // slice the FILTERED list, never the original
  }
  return { rows, chunks, total: rows.length };
}
