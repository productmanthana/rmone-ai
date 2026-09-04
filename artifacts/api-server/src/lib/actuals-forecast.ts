/* ─────────────────────────────────────────────────────────────────────────
 * Actuals vs Forecast — the ONE calculation engine.
 *
 * Client rule (COO spec, Aug 2026): a single common calculation engine and
 * weekly point-in-time snapshots. Every surface (per-project graph, Project
 * Forecast Report, Executive rollup) reads the SAME stored numbers; frozen
 * history is never recomputed from today's plan.
 *
 * Planned weekly slices come exclusively from walkPlannedWeeklySlices — the
 * same walker the Financial Analytics page aggregates through — so planned
 * hours semantics (hours-win, shorter-span-first claiming, the 168 h cap,
 * pct-as-hours reinterpretation) can never diverge between surfaces.
 *
 * Definitions (variance sign is the CONTRACT — document everywhere):
 *   forecastHoursTd   = cumulative PLANNED hours through the week (plan TD)
 *   actualHoursTd     = cumulative ACTUAL hours through the week
 *   forecastRemaining = total planned − plan TD  (work still ahead of week)
 *   forecastTotal     = actual TD + remaining    (EAC — converges to actual
 *                       at completion, exactly like the legacy chart)
 *   variance          = forecast TD − actual TD  (POSITIVE = under plan =
 *                       favorable/green). NOTE: the legacy screen's labels
 *                       claimed this but its code subtracted remaining — the
 *                       new numbers are the labeled definition, on purpose.
 *
 * Everything in this file is pure (no IO) so it is unit-testable offline.
 * ──────────────────────────────────────────────────────────────────────── */
import {
  type FinAllocRow,
  walkPlannedWeeklySlices,
  mondayUtc,
  WEEK,
} from "./financial-analytics.js";

/* ── shared small helpers ─────────────────────────────────────────────── */

export const normRole = (s: unknown): string =>
  String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export const isoDayUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Monday (UTC ms) of the week considered "current" under the UTC−12
 * convention used by past-week edit locks: a week only counts as finished
 * once it is over everywhere on Earth. */
export const currentWeekMsUtcMinus12 = (now: number = Date.now()): number =>
  mondayUtc(now - 12 * 3_600_000);

export interface AfFlags {
  /** true (default): Actuals come ONLY from imported files; missing = 0. */
  useImportedActuals: boolean;
  /** Only honored when useImportedActuals is false: completed weeks with no
   * imported actuals for a person+project substitute PLANNED hours, flagged. */
  usePlannedAsActualFallback: boolean;
}

export interface AfRoleRate { billingRate: number; empCostRate: number }

/** One imported (or substituted) actual-hours fact. weekMs MUST be a UTC
 * Monday (the engine re-snaps defensively). person = resource GUID, any case. */
export interface AfActualRow {
  ticket: string;
  person: string;
  personName: string;
  weekMs: number;
  hours: number;
  roleName: string;  // "" when the file had no role column
  division: string;  // "" when the file had no division column
}

/** Structural key of one upsertable actual-hours fact (weekIso = the already
 * Monday-snapped ISO date the store writes). */
export interface ActualKeyRow {
  ticket: string; person: string; personName: string;
  weekIso: string; hours: number; roleName: string; division: string;
}

/**
 * Collapse duplicate (ticket, person, week, role) rows into ONE row by
 * summing hours — real timesheet exports carry one row per DAY or per task,
 * and the storage key is per WEEK. Key folding mirrors the DB unique index
 * (case-insensitive collation). First non-empty personName/division wins;
 * display casing comes from the first row seen.
 */
export function aggregateActualKeyRows<T extends ActualKeyRow>(rows: T[]): T[] {
  const out = new Map<string, T>();
  for (const r of rows) {
    const key = [
      r.ticket.trim().toLowerCase(),
      r.person.trim().toLowerCase(),
      r.weekIso,
      normRole(r.roleName),
    ].join("|");
    const prev = out.get(key);
    if (!prev) { out.set(key, { ...r }); continue; }
    prev.hours += r.hours;
    if (!prev.personName && r.personName) prev.personName = r.personName;
    if (!prev.division && r.division) prev.division = r.division;
  }
  return [...out.values()];
}

/* ── plan model (built once per tenant from FinAllocRows) ─────────────── */

interface RolePlan {
  roleName: string;          // display casing
  division: string;          // last seen non-empty division
  nonChargeable: boolean;
  totalHours: number;
  billRate: number;          // representative (last seen > 0)
  costRate: number;
  weeks: Map<number, { hours: number; billRate: number; costRate: number }>;
}
interface PersonPlan { roles: Map<string, RolePlan> }

export interface TicketPlan {
  ticket: string;
  /** person GUID (lowercase) → roles; "" = open/unstaffed demand. */
  people: Map<string, PersonPlan>;
  divisions: Set<string>;
  totals: { hours: number; cost: number; bill: number };
}

/**
 * Expand a tenant's allocation rows into per-ticket plans, keyed by week and
 * (person, role, division). Demand rows (no person) are INCLUDED: unstaffed
 * planned work is still forecast work — this intentionally differs from the
 * Financial page's assigned-only cost KPI and is documented in the UI.
 */
export function buildTicketPlans(
  rows: FinAllocRow[],
  workWeekHours: number,
): Map<string, TicketPlan> {
  const plans = new Map<string, TicketPlan>();
  walkPlannedWeeklySlices(
    rows,
    { workWeekHours, minWs: Number.NEGATIVE_INFINITY, maxWe: Number.POSITIVE_INFINITY },
    (row, w, h) => {
      const ticket = (row.ticket || "").trim();
      if (!ticket || !(h > 0)) return; // unlinked rows can't join a project graph
      let plan = plans.get(ticket);
      if (!plan) {
        plan = { ticket, people: new Map(), divisions: new Set(), totals: { hours: 0, cost: 0, bill: 0 } };
        plans.set(ticket, plan);
      }
      const person = (row.person || "").trim().toLowerCase();
      const rKey = normRole(row.roleName) || "(no role)";
      let pp = plan.people.get(person);
      if (!pp) { pp = { roles: new Map() }; plan.people.set(person, pp); }
      let rp = pp.roles.get(rKey);
      if (!rp) {
        rp = {
          roleName: (row.roleName || "").trim(),
          division: (row.division || "").trim(),
          nonChargeable: !!row.nonChargeable,
          totalHours: 0, billRate: 0, costRate: 0,
          weeks: new Map(),
        };
        pp.roles.set(rKey, rp);
      }
      // NC allocations are real planned work with real internal cost but must
      // never inflate the client-billable forecast (same rule as Financial).
      const billRate = !row.nonChargeable && row.billRate > 0 ? row.billRate : 0;
      const costRate = row.costRate > 0 ? row.costRate : 0;
      const wk = rp.weeks.get(w) ?? { hours: 0, billRate: 0, costRate: 0 };
      const tot = wk.hours + h;
      if (tot > 0) { // blended rates when two rows share person+role+week
        wk.billRate = (wk.billRate * wk.hours + billRate * h) / tot;
        wk.costRate = (wk.costRate * wk.hours + costRate * h) / tot;
      }
      wk.hours = tot;
      rp.weeks.set(w, wk);
      rp.totalHours += h;
      if (billRate > 0) rp.billRate = billRate;
      if (costRate > 0) rp.costRate = costRate;
      if (row.nonChargeable) rp.nonChargeable = true;
      const div = (row.division || "").trim();
      if (div) { rp.division = div; plan.divisions.add(div); }
      plan.totals.hours += h;
      plan.totals.cost += h * costRate;
      plan.totals.bill += h * billRate;
    },
  );
  return plans;
}

/** Re-key a raw role catalogue (name → rates) by normalized role name. */
export function normalizeRoleRates(
  raw: Map<string, { billingRate?: number | null; empCostRate?: number | null }> | undefined,
): Map<string, AfRoleRate> {
  const out = new Map<string, AfRoleRate>();
  if (!raw) return out;
  for (const [name, r] of raw) {
    const k = normRole(name);
    if (!k) continue;
    const prev = out.get(k);
    const billingRate = Number(r?.billingRate) > 0 ? Number(r?.billingRate) : 0;
    const empCostRate = Number(r?.empCostRate) > 0 ? Number(r?.empCostRate) : 0;
    // Duplicate role names (memory: dup roles exist in the wild): keep the
    // first entry that actually carries a rate.
    if (!prev || (prev.billingRate <= 0 && prev.empCostRate <= 0)) {
      out.set(k, { billingRate, empCostRate });
    }
  }
  return out;
}

/* ── actual-hours rate resolution (the client's PM-vs-Estimator rule) ──── */

export interface ResolvedActual {
  billRate: number;
  costRate: number;
  roleName: string;   // resolved display role
  division: string;   // resolved division ("" = unknown → missing-division flag)
  approximated: boolean; // rate NOT from an exact assignment match
  unrated: boolean;      // no rate found anywhere — hours counted, dollars 0
}

/**
 * Rate of the SPECIFIC assignment that generated the hours. Ladder:
 *   1. exact role match on the person's assignments (role column in file)
 *   2. person has a single assignment role → that role
 *   3. assignment role with planned hours THAT week (flagged approximated)
 *   4. person's dominant assignment role by total hours (flagged)
 *   5. person unknown to the plan → tenant role catalogue by role text (flagged)
 *   6. nothing → unrated: hours count, dollars 0, surfaced separately —
 *      NEVER silently priced at 0 without the unrated flag.
 */
export function resolveActualRates(
  plan: TicketPlan | undefined,
  roleRates: Map<string, AfRoleRate> | undefined,
  a: AfActualRow,
): ResolvedActual {
  const person = a.person.trim().toLowerCase();
  const pp = person ? plan?.people.get(person) : undefined;
  const wanted = normRole(a.roleName);
  const weekMs = mondayUtc(a.weekMs);
  const pick = (rp: RolePlan, approximated: boolean): ResolvedActual => {
    const wk = rp.weeks.get(weekMs);
    return {
      billRate: wk && wk.hours > 0 && wk.billRate > 0 ? wk.billRate : rp.billRate,
      costRate: wk && wk.hours > 0 && wk.costRate > 0 ? wk.costRate : rp.costRate,
      roleName: rp.roleName || a.roleName,
      division: (a.division || rp.division || "").trim(),
      approximated,
      unrated: false,
    };
  };
  if (pp && pp.roles.size > 0) {
    if (wanted && pp.roles.has(wanted)) return pick(pp.roles.get(wanted)!, false);
    if (pp.roles.size === 1) return pick(pp.roles.values().next().value!, false);
    let best: RolePlan | null = null;
    for (const rp of pp.roles.values()) {
      const hrs = rp.weeks.get(weekMs)?.hours ?? 0;
      if (hrs > 0 && (!best || hrs > (best.weeks.get(weekMs)?.hours ?? 0))) best = rp;
    }
    if (best) return pick(best, true);
    let dom: RolePlan | null = null;
    for (const rp of pp.roles.values()) if (!dom || rp.totalHours > dom.totalHours) dom = rp;
    if (dom) return pick(dom, true);
  }
  if (wanted && roleRates) {
    const rr = roleRates.get(wanted);
    if (rr && (rr.billingRate > 0 || rr.empCostRate > 0)) {
      return {
        billRate: rr.billingRate,
        costRate: rr.empCostRate,
        roleName: a.roleName,
        division: (a.division || "").trim(),
        approximated: true,
        unrated: false,
      };
    }
  }
  return {
    billRate: 0, costRate: 0,
    roleName: a.roleName,
    division: (a.division || "").trim(),
    approximated: true, unrated: true,
  };
}

/* ── the series computation ───────────────────────────────────────────── */

export interface AfWeekPoint {
  weekMonday: string;              // ISO date (UTC Monday)
  actualHoursTd: number;
  forecastRemainingHours: number;
  forecastTotalHours: number;      // EAC hours = actual TD + remaining
  forecastHoursTd: number;         // plan TD (variance input)
  actualCostTd: number;
  forecastRemainingCost: number;
  forecastTotalCost: number;
  forecastCostTd: number;
  actualBillTd: number;
  forecastRemainingBill: number;
  forecastTotalBill: number;
  forecastBillTd: number;
  hoursVariance: number;           // forecast TD − actual TD (positive = favorable)
  costVariance: number;
  billVariance: number;
  substitutedHours: number;        // cumulative TD, disclosed in UI
  unratedActualHours: number;      // cumulative TD hours priced at $0
}

export interface AfDetailCell {
  weekMonday: string;
  person: string;        // GUID lowercase, "" = open demand
  personName: string;
  roleName: string;
  division: string;
  actualHours: number;   actualCost: number;   actualBill: number;
  forecastHours: number; forecastCost: number; forecastBill: number;
  remainingHours: number; remainingCost: number; remainingBill: number; // person+role plan after this week
  substituted: boolean;
  rateApproximated: boolean;
  missingDivision: boolean;
}

export interface AfProjectSeries {
  ticket: string;
  weeks: AfWeekPoint[];
  detail: AfDetailCell[];
  divisions: string[];
  planTotals: { hours: number; cost: number; bill: number };
  flagsApplied: AfFlags;
  substitutionUsed: boolean;
}

const EPS = 1e-9;
// Junk-data guard, mirroring the walker's per-row cap: never emit a series
// longer than ~15 years of weeks.
const MAX_SERIES_WEEKS = 800;

export function computeProjectAf(input: {
  ticket: string;
  plan?: TicketPlan;
  actuals: AfActualRow[];
  roleRates?: Map<string, AfRoleRate>; // NORMALIZED keys (normalizeRoleRates)
  flags: AfFlags;
  currentWeekMs: number;
  fromWeekMs?: number;
  toWeekMs?: number;
  personNames?: Map<string, string>;   // guid (lowercase) → display name
}): AfProjectSeries {
  const { ticket, plan, flags } = input;
  const currentWeekMs = mondayUtc(input.currentWeekMs);
  const subsEnabled = !flags.useImportedActuals && flags.usePlannedAsActualFallback;
  const nameOf = (guid: string, fallback: string): string =>
    input.personNames?.get(guid) || fallback || (guid ? guid : "Open position");

  /* Pre-aggregate the plan per week + per cell, and per-role prefix sums so
   * per-cell "remaining after week w" is O(1) during the walk. */
  interface Cell { person: string; roleKey: string; roleName: string; division: string; h: number; c: number; b: number }
  const planWeekAgg = new Map<number, { h: number; c: number; b: number }>();
  const planCells = new Map<number, Map<string, Cell>>();
  interface RoleCum { weeks: number[]; cumH: number[]; cumC: number[]; cumB: number[]; totH: number; totC: number; totB: number }
  const roleCums = new Map<string, RoleCum>(); // person|roleKey
  if (plan) {
    for (const [person, pp] of plan.people) {
      for (const [roleKey, rp] of pp.roles) {
        const weeks = [...rp.weeks.keys()].sort((a, b) => a - b);
        const rc: RoleCum = { weeks, cumH: [], cumC: [], cumB: [], totH: 0, totC: 0, totB: 0 };
        for (const w of weeks) {
          const wk = rp.weeks.get(w)!;
          const c = wk.hours * wk.costRate, b = wk.hours * wk.billRate;
          rc.totH += wk.hours; rc.totC += c; rc.totB += b;
          rc.cumH.push(rc.totH); rc.cumC.push(rc.totC); rc.cumB.push(rc.totB);
          const agg = planWeekAgg.get(w) ?? { h: 0, c: 0, b: 0 };
          agg.h += wk.hours; agg.c += c; agg.b += b;
          planWeekAgg.set(w, agg);
          let cells = planCells.get(w);
          if (!cells) { cells = new Map(); planCells.set(w, cells); }
          const key = `${person}|${roleKey}|${rp.division}`;
          const cell = cells.get(key) ?? { person, roleKey, roleName: rp.roleName, division: rp.division, h: 0, c: 0, b: 0 };
          cell.h += wk.hours; cell.c += c; cell.b += b;
          cells.set(key, cell);
        }
        roleCums.set(`${person}|${roleKey}`, rc);
      }
    }
  }
  /** plan cum through week w for person|roleKey (binary search over prefix). */
  const roleCumThrough = (person: string, roleKey: string, w: number): { h: number; c: number; b: number; totH: number; totC: number; totB: number } => {
    const rc = roleCums.get(`${person}|${roleKey}`);
    if (!rc) return { h: 0, c: 0, b: 0, totH: 0, totC: 0, totB: 0 };
    let lo = 0, hi = rc.weeks.length - 1, idx = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (rc.weeks[mid] <= w) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    return idx < 0
      ? { h: 0, c: 0, b: 0, totH: rc.totH, totC: rc.totC, totB: rc.totB }
      : { h: rc.cumH[idx], c: rc.cumC[idx], b: rc.cumB[idx], totH: rc.totH, totC: rc.totC, totB: rc.totB };
  };

  /* Actual cells (imported, then substituted where allowed). */
  interface ACell {
    person: string; personName: string; roleKey: string; roleName: string; division: string;
    h: number; c: number; b: number; substituted: boolean; approximated: boolean; unratedH: number;
  }
  const actualCells = new Map<number, Map<string, ACell>>();
  const realPersonWeeks = new Set<string>(); // `${person}|${week}` with an imported row
  const addActual = (w: number, cell: Omit<ACell, "h" | "c" | "b" | "unratedH">, h: number, c: number, b: number, unratedH: number) => {
    let cells = actualCells.get(w);
    if (!cells) { cells = new Map(); actualCells.set(w, cells); }
    const key = `${cell.person}|${cell.roleKey}|${cell.division}|${cell.substituted ? 1 : 0}`;
    const prev = cells.get(key);
    if (prev) {
      prev.h += h; prev.c += c; prev.b += b; prev.unratedH += unratedH;
      prev.approximated = prev.approximated || cell.approximated;
    } else {
      cells.set(key, { ...cell, h, c, b, unratedH });
    }
  };
  const actualDivisions = new Set<string>();
  for (const a of input.actuals) {
    if (!(Number(a.hours) >= 0) || !Number.isFinite(a.weekMs)) continue;
    const w = mondayUtc(a.weekMs);
    const person = a.person.trim().toLowerCase();
    if (person) realPersonWeeks.add(`${person}|${w}`);
    const res = resolveActualRates(plan, input.roleRates, a);
    if (res.division) actualDivisions.add(res.division);
    addActual(
      w,
      {
        person,
        personName: nameOf(person, a.personName),
        roleKey: normRole(res.roleName) || "(no role)",
        roleName: res.roleName || "(no role)",
        division: res.division,
        substituted: false,
        approximated: res.approximated,
      },
      a.hours,
      a.hours * res.costRate,
      a.hours * res.billRate,
      res.unrated ? a.hours : 0,
    );
  }
  let substitutionUsed = false;
  if (subsEnabled && plan) {
    for (const [person, pp] of plan.people) {
      if (!person) continue; // demand rows never substitute (nobody worked them)
      for (const [roleKey, rp] of pp.roles) {
        for (const [w, wk] of rp.weeks) {
          if (!(wk.hours > EPS)) continue;
          if (w >= currentWeekMs) continue;             // only completed weeks
          if (realPersonWeeks.has(`${person}|${w}`)) continue; // imported wins
          substitutionUsed = true;
          addActual(
            w,
            {
              person,
              personName: nameOf(person, ""),
              roleKey,
              roleName: rp.roleName || "(no role)",
              division: rp.division,
              substituted: true,
              approximated: false,
            },
            wk.hours, wk.hours * wk.costRate, wk.hours * wk.billRate, 0,
          );
        }
      }
    }
  }

  /* Emission range. */
  const allWeeks: number[] = [];
  for (const w of planWeekAgg.keys()) allWeeks.push(w);
  for (const w of actualCells.keys()) allWeeks.push(w);
  const planTotals = plan ? { ...plan.totals } : { hours: 0, cost: 0, bill: 0 };
  const flagsApplied = { ...flags };
  if (allWeeks.length === 0) {
    return { ticket, weeks: [], detail: [], divisions: [], planTotals, flagsApplied, substitutionUsed };
  }
  let from = mondayUtc(input.fromWeekMs ?? Math.min(...allWeeks));
  let to = mondayUtc(input.toWeekMs ?? Math.max(Math.max(...allWeeks), currentWeekMs));
  if (to < from) to = from;
  if ((to - from) / WEEK + 1 > MAX_SERIES_WEEKS) from = to - (MAX_SERIES_WEEKS - 1) * WEEK;

  /* Cumulatives BEFORE the emission window so points are correct mid-series. */
  const cumPlan = { h: 0, c: 0, b: 0 };
  for (const [w, agg] of planWeekAgg) if (w < from) { cumPlan.h += agg.h; cumPlan.c += agg.c; cumPlan.b += agg.b; }
  const cumAct = { h: 0, c: 0, b: 0 };
  let cumSubH = 0, cumUnratedH = 0;
  for (const [w, cells] of actualCells) {
    if (w >= from) continue;
    for (const cell of cells.values()) {
      cumAct.h += cell.h; cumAct.c += cell.c; cumAct.b += cell.b;
      if (cell.substituted) cumSubH += cell.h;
      cumUnratedH += cell.unratedH;
    }
  }

  const weeks: AfWeekPoint[] = [];
  const detail: AfDetailCell[] = [];
  for (let w = from; w <= to; w += WEEK) {
    const agg = planWeekAgg.get(w);
    if (agg) { cumPlan.h += agg.h; cumPlan.c += agg.c; cumPlan.b += agg.b; }
    const aCells = actualCells.get(w);
    if (aCells) {
      for (const cell of aCells.values()) {
        cumAct.h += cell.h; cumAct.c += cell.c; cumAct.b += cell.b;
        if (cell.substituted) cumSubH += cell.h;
        cumUnratedH += cell.unratedH;
      }
    }
    const remH = Math.max(0, planTotals.hours - cumPlan.h);
    const remC = Math.max(0, planTotals.cost - cumPlan.c);
    const remB = Math.max(0, planTotals.bill - cumPlan.b);
    weeks.push({
      weekMonday: isoDayUtc(w),
      actualHoursTd: cumAct.h,
      forecastRemainingHours: remH,
      forecastTotalHours: cumAct.h + remH,
      forecastHoursTd: cumPlan.h,
      actualCostTd: cumAct.c,
      forecastRemainingCost: remC,
      forecastTotalCost: cumAct.c + remC,
      forecastCostTd: cumPlan.c,
      actualBillTd: cumAct.b,
      forecastRemainingBill: remB,
      forecastTotalBill: cumAct.b + remB,
      forecastBillTd: cumPlan.b,
      hoursVariance: cumPlan.h - cumAct.h,
      costVariance: cumPlan.c - cumAct.c,
      billVariance: cumPlan.b - cumAct.b,
      substitutedHours: cumSubH,
      unratedActualHours: cumUnratedH,
    });

    /* Detail cells: union of plan + actual activity this week. */
    const seen = new Set<string>();
    const pushDetail = (
      person: string, personName: string, roleKey: string, roleName: string, division: string,
      aH: number, aC: number, aB: number, fH: number, fC: number, fB: number,
      substituted: boolean, approximated: boolean,
    ) => {
      if (aH <= EPS && fH <= EPS && aC <= EPS && fC <= EPS) return;
      const rc = roleCumThrough(person, roleKey, w);
      detail.push({
        weekMonday: isoDayUtc(w),
        person, personName, roleName, division,
        actualHours: aH, actualCost: aC, actualBill: aB,
        forecastHours: fH, forecastCost: fC, forecastBill: fB,
        remainingHours: Math.max(0, rc.totH - rc.h),
        remainingCost: Math.max(0, rc.totC - rc.c),
        remainingBill: Math.max(0, rc.totB - rc.b),
        substituted,
        rateApproximated: approximated,
        missingDivision: !division,
      });
    };
    const pCells = planCells.get(w);
    if (aCells) {
      for (const cell of aCells.values()) {
        const planKey = `${cell.person}|${cell.roleKey}|${cell.division}`;
        const pc = pCells?.get(planKey);
        if (pc) seen.add(planKey);
        pushDetail(
          cell.person, cell.personName, cell.roleKey, cell.roleName, cell.division,
          cell.h, cell.c, cell.b, pc?.h ?? 0, pc?.c ?? 0, pc?.b ?? 0,
          cell.substituted, cell.approximated,
        );
      }
    }
    if (pCells) {
      for (const [key, pc] of pCells) {
        if (seen.has(key)) continue;
        pushDetail(
          pc.person, nameOf(pc.person, ""), pc.roleKey, pc.roleName, pc.division,
          0, 0, 0, pc.h, pc.c, pc.b, false, false,
        );
      }
    }
  }

  const divisions = new Set<string>(plan?.divisions ?? []);
  for (const d of actualDivisions) divisions.add(d);
  return {
    ticket,
    weeks,
    detail,
    divisions: [...divisions].sort((a, b) => a.localeCompare(b)),
    planTotals,
    flagsApplied,
    substitutionUsed,
  };
}
