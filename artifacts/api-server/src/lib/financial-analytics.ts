// ─────────────────────────────────────────────────────────────────────────────
// Financial analytics aggregation (Analytics Center → Financial page).
//
// Pure math over tenant-wide allocation rows fetched by
// getFinancialAllocationRowsRds (rds-provider). Turns raw ResourceAllocation
// rows into annualized planned-labor metrics across three bases:
//   t12m    — trailing 12 months (already a full year, factor 1)
//   fytd    — Jan 1 → today, annualized by 365/daysElapsed
//             (calendar-year assumption; the client has not chosen a fiscal
//             start, so we say so in the UI rather than guess one)
//   runrate — last 91 days × 365/91
//
// Every figure is PLANNED (allocation plans × rates), never timesheet actuals —
// the UI labels them that way. Rules mirrored from the team/utilization
// providers (single source of truth for the semantics, see memory notes):
//   • hours = AllocationHour when > 0, else PctAllocation-derived
//   • PctAllocation may hold raw HOURS: assigned rows with pct > 150 are
//     treated as total hours over the span (import-side reinterpretation rule)
//   • assigned rows cap implied weekly hours at 168; DEMAND rows are exempt
//     (pct > 100 = multi-FTE demand, legitimate)
//   • hours-win: when a (person, project) has real-hours rows covering a week,
//     percent-only rows for that same week are the superseded plan — skipped
//   • billing $ and internal cost $ stay SEPARATE (Roles.BillingRate vs
//     JobTitle.EmpCostRate) — never blended
//   • NonChargeable hours remain planned work and internal cost, but are
//     deliberately excluded from client-billable revenue
//   • hours with no configured rate are counted separately (unrated*) and
//     EXCLUDED from dollar figures — surfaced honestly, never priced at 0
//     silently
// ─────────────────────────────────────────────────────────────────────────────

export interface FinAllocRow {
  ticket: string;          // project/opportunity ticket id ("" when unlinked)
  person: string;          // resource GUID; "" = open demand (unfilled slot)
  // RA identity — present when the live query fetches ra.ID
  allocationId: string;    // ra.ID as string ("" when not available)
  // RA date range from the raw row (before any per-week expansion)
  allocationStart: string; // ISO yyyy-mm-dd, same as start (explicit copy)
  allocationEnd: string;   // ISO yyyy-mm-dd, same as end   (explicit copy)
  start: string;           // ISO yyyy-mm-dd ("" when missing)
  end: string;
  hours: number;           // ra.AllocationHour (0 when absent/blank)
  pct: number;             // ra.PctAllocation (may hold raw hours — see above)
  nonChargeable: boolean;  // ra.NonChargeable BIT
  billRate: number;        // resolved client billing $/h (0 = no rate found)
  costRate: number;        // resolved internal cost $/h (0 = no rate found)
  division: string;        // assignment division title ("" when unknown)
  // Canonical org dimensions — each resolved from its OWN relationship, never
  // inferred from another dimension's labels (business-unit-separate-entity):
  //   businessUnit — division's BusinessUnitIdLookup → BusinessUnit.Title
  //   department   — assignment job title's DepartmentId → Department.Title
  businessUnit?: string;   // "" / absent when unknown
  department?: string;     // "" / absent when unknown
  /** Display role of THIS assignment (assignment role first, then job
   * title) — the role whose rate generated this row's dollars. Used by the
   * Actuals-vs-Forecast engine to match imported actual hours to the right
   * assignment rate. Optional: absent on legacy fixtures/tests. */
  roleName?: string;
}

export interface FinMonthly {
  ym: string;              // "2026-03"
  plannedHours: number;
  billDollars: number;     // client-billable assigned hours × billing rate
  costDollars: number;     // assigned hours × cost rate
}

export interface FinDivisionRow {
  division: string;
  plannedHours: number;
  assignedHours: number;
  billDollars: number;
}

export interface FinBURow {
  bu: string;
  plannedHours: number;
  assignedHours: number;
  billDollars: number;
}

export interface FinDeptRow {
  department: string;
  plannedHours: number;
  assignedHours: number;
  billDollars: number;
}

export interface FinProjectRow {
  ticket: string;
  plannedHours: number;
  assignedHours: number;
  billDollars: number;
  jobCost: number;
  nonJobCost: number;
}
/** A project's allocation-derived contribution to one org-unit drilldown.
 * `aggregateOf` is present only on the final bounded-list remainder row. */
export interface FinOrgProjectRow extends FinProjectRow {
  aggregateOf?: number;
}
/** Project evidence behind one division, business unit, or department total. */
export interface FinOrgProjectGroup {
  org: string;
  rows: FinOrgProjectRow[];
  /** Number of smaller project rows combined into the final aggregate row. */
  rowsTruncated: number;
}
/** A project contribution to one displayed calendar month.  These are built
 * inside the authoritative weekly expansion so month drills never try to
 * reverse-engineer a month from all-window totals. */
export interface FinMonthlyProjectRow extends FinProjectRow {
  ym: string;
  totalInternalCost: number;
  /** One final aggregate row when a month has more project rows than we send. */
  aggregateOf?: number;
}

// ─── Reconciliation ──────────────────────────────────────────────────────────
// One row per (project × person × allocation identity × rates × NC flag).
// Accumulates planned hours, billing, and cost for auditable cross-checking
// against project/basis totals.  Truncation is explicit and surfaced.
export interface FinReconRow {
  ticket: string;           // project ticket ("" = unlinked)
  person: string;           // resource GUID ("" = open demand)
  allocationId: string;     // ra.ID ("" when not available from query)
  allocationStart: string;  // ISO date of the raw RA row
  allocationEnd: string;    // ISO date of the raw RA row
  nonChargeable: boolean;
  billRate: number;         // $/h resolved from rates
  costRate: number;         // $/h resolved from rates
  // in-window planned sums for this group:
  plannedHours: number;     // all planned hours (assigned + demand)
  chargeableHours: number;  // assigned, non-NC hours (used for client billing)
  planClientBilling: number; // chargeableHours × billRate
  jobCost: number;          // assigned, non-NC × costRate
  ncCost: number;           // assigned, NC × costRate
  totalInternalCost: number; // jobCost + ncCost
  windowStart: string;      // ISO date of window start
  windowEnd: string;        // ISO date of window end
  // When the per-allocation list is capped, ONE trailing row carries the sum
  // of every omitted group so the serialized rows still add up EXACTLY to the
  // basis totals. aggregateOf = number of omitted allocation groups.
  aggregateOf?: number;
}

export interface FinReconMeta {
  basisKey: "all" | "t12m" | "fytd" | "runrate";
  rows: FinReconRow[];
  rowsTruncated: number;   // rows beyond MAX_RECON_ROWS that were dropped
  // Reconciliation sums — must equal the basis totals (modulo rounding)
  sumPlannedHours: number;
  sumChargeableHours: number;
  sumPlanClientBilling: number;
  sumJobCost: number;
  sumNcCost: number;
  sumTotalInternalCost: number;
}

export interface FinBasis {
  key: "all" | "t12m" | "fytd" | "runrate";
  windowStart: string;     // ISO date (inclusive, by week start)
  windowEnd: string;       // ISO date (today)
  factor: number;          // annualization multiplier applied to `annualized`
  // Raw in-window totals:
  plannedHours: number;    // all planned hours (assigned + open demand)
  assignedHours: number;   // hours assigned to a named person
  demandHours: number;     // plannedHours − assignedHours
  assignedBillDollars: number;
  plannedBillDollars: number;
  jobChargeableCost: number;     // assigned, NonChargeable = 0, × cost rate
  nonJobChargeableCost: number;  // assigned, NonChargeable = 1, × cost rate
  // Hours excluded from the matching dollar figures because no rate exists:
  unratedBillHours: number;
  unratedCostHours: number;
  // Headline (annualized = raw × factor):
  annualized: {
    plannedHours: number;
    assignedHours: number;
    assignedBillDollars: number;
    jobChargeableCost: number;
    nonJobChargeableCost: number;
  };
  monthly: FinMonthly[];
  /** Project-level evidence behind each month chart point. Present for the
   * default Overall basis only, keeping this already-large endpoint bounded. */
  monthlyByProject?: FinMonthlyProjectRow[];
  byDivision: FinDivisionRow[];
  /** Same aggregation as byDivision, grouped by the allocation's canonical
   * Business Unit (division→BU hierarchy). */
  byBusinessUnit: FinBURow[];
  /** Same aggregation, grouped by the assignment job title's Department. */
  byDepartment: FinDeptRow[];
  /** Exact allocation-level project contributions behind each org group.
   * These lists are capped per group and retain an explicit aggregate row. */
  byDivisionByProject: FinOrgProjectGroup[];
  byBusinessUnitByProject: FinOrgProjectGroup[];
  byDepartmentByProject: FinOrgProjectGroup[];
  byProject: FinProjectRow[];
  projectRowsTruncated: number;  // rows dropped from byProject beyond the cap
  recon: FinReconMeta;
}

export interface FinancialAnalyticsCore {
  workWeekHours: number;
  rowCount: number;        // allocation rows considered
  skippedRows: number;     // rows dropped for missing/invalid/junk dates
  bases: { all: FinBasis; t12m: FinBasis; fytd: FinBasis; runrate: FinBasis };
}

export const DAY = 86_400_000;
export const WEEK = 7 * DAY;
// Rows spanning more than ~15 years are junk data, not plans.
export const MAX_WEEKS_PER_ROW = 800;
// Drill-down payload bound; tenants rarely exceed a few hundred projects.
const MAX_PROJECT_ROWS = 500;
// An org unit can have hundreds of projects. Retain the largest contributions
// plus one explicit remainder line rather than multiplying the payload by every
// division / BU / department.
const MAX_ORG_PROJECT_ROWS = 100;
// Reconciliation row cap — one row per (ticket, person, allocationId, billRate, costRate, NC)
const MAX_RECON_ROWS = 5000;

/** UTC Monday (ms) of the week containing t. */
export function mondayUtc(t: number): number {
  const d = new Date(t);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return midnight - dow * DAY;
}

function isoDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function ymOf(t: number): string {
  return new Date(t).toISOString().slice(0, 7);
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r0 = (n: number) => Math.round(n);

interface FinProjectTally {
  plannedHours: number;
  assignedHours: number;
  billDollars: number;
  jobCost: number;
  nonJobCost: number;
}

interface Acc {
  plannedHours: number; assignedHours: number;
  assignedBillDollars: number; plannedBillDollars: number;
  jobCost: number; nonJobCost: number;
  unratedBillHours: number; unratedCostHours: number;
  monthly: Map<string, { plannedHours: number; billDollars: number; jobCost: number; nonJobCost: number }>;
  /** Allocated lazily for the Overall basis only; month project evidence is
   * intentionally not built for hidden comparison bases. */
  monthlyByProject?: Map<string, Map<string, { plannedHours: number; assignedHours: number; billDollars: number; jobCost: number; nonJobCost: number }>>;
  byDivision: Map<string, { plannedHours: number; assignedHours: number; billDollars: number }>;
  byBusinessUnit: Map<string, { plannedHours: number; assignedHours: number; billDollars: number }>;
  byDepartment: Map<string, { plannedHours: number; assignedHours: number; billDollars: number }>;
  byProject: Map<string, FinProjectTally>;
  /** Each map is org label → project ticket → allocation-level contribution. */
  byDivisionByProject: Map<string, Map<string, FinProjectTally>>;
  byBusinessUnitByProject: Map<string, Map<string, FinProjectTally>>;
  byDepartmentByProject: Map<string, Map<string, FinProjectTally>>;
  // reconciliation: key = `${ticket}|${person}|${allocationId}|${billRate}|${costRate}|${nc ? 1 : 0}`
  recon: Map<string, {
    ticket: string; person: string; allocationId: string;
    allocationStart: string; allocationEnd: string;
    nonChargeable: boolean; billRate: number; costRate: number;
    plannedHours: number; chargeableHours: number; planClientBilling: number;
    jobCost: number; ncCost: number;
  }>;
}

function newAcc(): Acc {
  return {
    plannedHours: 0, assignedHours: 0,
    assignedBillDollars: 0, plannedBillDollars: 0,
    jobCost: 0, nonJobCost: 0,
    unratedBillHours: 0, unratedCostHours: 0,
    monthly: new Map(), byDivision: new Map(), byBusinessUnit: new Map(), byDepartment: new Map(), byProject: new Map(),
    byDivisionByProject: new Map(), byBusinessUnitByProject: new Map(), byDepartmentByProject: new Map(),
    recon: new Map(),
  };
}

function addProjectTally(
  projects: Map<string, FinProjectTally>,
  ticket: string,
  h: number,
  assigned: boolean,
  bill: number,
  cost: number,
  nonChargeable: boolean,
): void {
  const p = projects.get(ticket) ?? {
    plannedHours: 0, assignedHours: 0, billDollars: 0, jobCost: 0, nonJobCost: 0,
  };
  p.plannedHours += h;
  if (assigned) {
    p.assignedHours += h;
    p.billDollars += bill;
    if (nonChargeable) p.nonJobCost += cost; else p.jobCost += cost;
  }
  projects.set(ticket, p);
}

function addOrgProjectTally(
  groups: Map<string, Map<string, FinProjectTally>>,
  org: string,
  ticket: string,
  h: number,
  assigned: boolean,
  bill: number,
  cost: number,
  nonChargeable: boolean,
): void {
  const projects = groups.get(org) ?? new Map<string, FinProjectTally>();
  addProjectTally(projects, ticket, h, assigned, bill, cost, nonChargeable);
  groups.set(org, projects);
}

/** Serialize an org-unit's project evidence with a bounded, explicit remainder.
 * Carry rounding between rows so the visible drill exactly equals its displayed
 * org total — independent row rounding would drift. */
function serializeOrgProjectBreakdowns(
  groups: Map<string, Map<string, FinProjectTally>>,
): FinOrgProjectGroup[] {
  return [...groups.entries()]
    .map(([org, projects]) => {
      const sorted = [...projects.entries()]
        .map(([ticket, values]) => ({ ticket, ...values }))
        .sort((a, b) => b.plannedHours - a.plannedHours || a.ticket.localeCompare(b.ticket));
      const rows: FinOrgProjectRow[] = sorted.slice(0, MAX_ORG_PROJECT_ROWS).map(p => ({ ...p }));
      const rowsTruncated = Math.max(0, sorted.length - MAX_ORG_PROJECT_ROWS);
      if (rowsTruncated > 0) {
        const aggregate: FinOrgProjectRow = {
          ticket: "", plannedHours: 0, assignedHours: 0, billDollars: 0, jobCost: 0, nonJobCost: 0,
          aggregateOf: rowsTruncated,
        };
        for (const p of sorted.slice(MAX_ORG_PROJECT_ROWS)) {
          aggregate.plannedHours += p.plannedHours;
          aggregate.assignedHours += p.assignedHours;
          aggregate.billDollars += p.billDollars;
          aggregate.jobCost += p.jobCost;
          aggregate.nonJobCost += p.nonJobCost;
        }
        rows.push(aggregate);
      }
      const carryQuantize = (field: keyof FinProjectTally) => {
        let exact = 0;
        let emitted = 0;
        for (const row of rows) {
          exact += row[field];
          row[field] = Math.round(exact) - emitted;
          emitted += row[field];
        }
      };
      carryQuantize("plannedHours");
      carryQuantize("assignedHours");
      carryQuantize("billDollars");
      carryQuantize("jobCost");
      carryQuantize("nonJobCost");
      return { org, rows, rowsTruncated };
    })
    .sort((a, b) => a.org.localeCompare(b.org));
}

function visibleOrgProjectTotals(rows: FinOrgProjectRow[]): Pick<FinProjectTally, "plannedHours" | "assignedHours" | "billDollars"> {
  return rows.reduce(
    (total, row) => ({
      plannedHours: total.plannedHours + row.plannedHours,
      assignedHours: total.assignedHours + row.assignedHours,
      billDollars: total.billDollars + row.billDollars,
    }),
    { plannedHours: 0, assignedHours: 0, billDollars: 0 },
  );
}

/**
 * The ONE weekly expansion of planned allocation rows — every consumer of
 * per-week planned hours (Financial page aggregation AND the
 * Actuals-vs-Forecast engine) walks slices through here, so the hours-win
 * rule, shorter-span-first claiming, the 168 h cap, and the pct-as-hours
 * reinterpretation can never diverge between surfaces (the client's
 * "common calculation engine" rule).
 *
 * Calls `cb(row, weekStartMs, hours)` once per ACCEPTED weekly slice, in the
 * exact order (and with the exact skips) the Financial aggregation always
 * used. Claiming happens after the callback, mirroring the original loop.
 */
export function walkPlannedWeeklySlices(
  rows: FinAllocRow[],
  opts: { workWeekHours: number; minWs: number; maxWe: number },
  cb: (row: FinAllocRow, weekStartMs: number, hours: number) => void,
): { skippedRows: number } {
  const wwh = opts.workWeekHours > 0 ? opts.workWeekHours : 40;
  const { minWs, maxWe } = opts;

  // Pass 1 — hours-win sets: per (person|ticket), the week-starts covered by
  // rows that carry REAL hours. Percent-only rows are skipped on those weeks.
  const hourWeeks = new Map<string, Set<number>>();
  for (const row of rows) {
    if (!row.person || !(row.hours > 0)) continue;
    const s = Date.parse(row.start), e = Date.parse(row.end || row.start);
    if (!Number.isFinite(s)) continue;
    const w0 = mondayUtc(s), w1 = Number.isFinite(e) && e >= s ? mondayUtc(e) : w0;
    if ((w1 - w0) / WEEK > MAX_WEEKS_PER_ROW) continue;
    const key = `${row.person}|${row.ticket}`;
    let set = hourWeeks.get(key);
    if (!set) { set = new Set(); hourWeeks.set(key, set); }
    for (let w = w0; w <= w1; w += WEEK) set.add(w);
  }

  // Pass 2 — expand each row to weekly slices.
  //
  // Dedup guard: when a project has BOTH an explicit weekly RA row
  // (AllocationHour set for a single week) AND a container/lump-sum row
  // spanning that same week, both rows would otherwise contribute their
  // prorated share independently — double-counting. Shorter (more-specific)
  // rows are processed first; a per-(person|ticket) "claimedWeeks" set then
  // lets each week be counted only once across all hours rows.
  const sortedRows = [...rows].sort((a, b) => {
    const aH = a.hours > 0, bH = b.hours > 0;
    if (!aH && !bH) return 0;
    if (!aH) return 1;   // non-hours rows after all hours rows
    if (!bH) return -1;
    const sa = Date.parse(a.start), ea = Date.parse(a.end || a.start);
    const sb = Date.parse(b.start), eb = Date.parse(b.end || b.start);
    const spanA = Number.isFinite(ea) && ea >= sa ? ea - sa : 0;
    const spanB = Number.isFinite(eb) && eb >= sb ? eb - sb : 0;
    return spanA - spanB; // shorter span (weekly) first → claims the week
  });
  // Per (person|ticket): week-starts already counted by an hours row.
  const hoursClaimedWeeks = new Map<string, Set<number>>();

  let skippedRows = 0;
  for (const row of sortedRows) {
    const s = Date.parse(row.start), eRaw = Date.parse(row.end || row.start);
    if (!Number.isFinite(s)) { skippedRows++; continue; }
    const e = Number.isFinite(eRaw) && eRaw >= s ? eRaw : s;
    const w0 = mondayUtc(s), w1 = mondayUtc(e);
    const weeks = Math.round((w1 - w0) / WEEK) + 1;
    if (weeks > MAX_WEEKS_PER_ROW) { skippedRows++; continue; }
    if (w1 < minWs) continue; // entirely before every window

    const assigned = !!row.person;
    const fromHours = row.hours > 0;
    let perWeek: number;
    if (fromHours) {
      perWeek = row.hours / weeks;
      if (assigned && perWeek > 168) perWeek = 168; // integrity cap (log-free read path)
    } else if (row.pct > 0) {
      if (assigned && row.pct > 150) {
        // Legacy rows where PctAllocation holds raw hours for the span.
        perWeek = Math.min(row.pct / weeks, 168);
      } else {
        // Genuine percent. Demand rows may legitimately exceed 100% (multi-FTE).
        perWeek = (row.pct / 100) * wwh;
        if (assigned && perWeek > 168) perWeek = 168;
      }
    } else {
      continue; // nothing planned on this row
    }

    // hours-win: pct-only rows are suppressed for weeks already covered by any
    // hours row for the same (person, ticket).
    const winSet = !fromHours && assigned ? hourWeeks.get(`${row.person}|${row.ticket}`) : undefined;
    // hours-on-hours dedup: the shorter-span row (processed first by sort
    // above) claims the week; subsequent hours rows skip claimed weeks.
    const claimedKey = fromHours && assigned && row.person ? `${row.person}|${row.ticket}` : null;

    for (let w = w0; w <= w1; w += WEEK) {
      if (w < minWs || w >= maxWe) continue;
      if (winSet && winSet.has(w)) continue; // hours-win: pct row superseded
      if (claimedKey) {
        const claimed = hoursClaimedWeeks.get(claimedKey);
        if (claimed && claimed.has(w)) continue; // shorter span already owns this week
      }
      cb(row, w, perWeek);
      // Claim this week so no other hours row for the same (person, ticket)
      // counts it again.
      if (claimedKey) {
        let claimed = hoursClaimedWeeks.get(claimedKey);
        if (!claimed) { claimed = new Set(); hoursClaimedWeeks.set(claimedKey, claimed); }
        claimed.add(w);
      }
    }
  }
  return { skippedRows };
}

export function computeFinancialAnalytics(
  rows: FinAllocRow[],
  workWeekHours: number,
  now: Date = new Date(),
): FinancialAnalyticsCore {
  const wwh = workWeekHours > 0 ? workWeekHours : 40;
  const nowMs = now.getTime();
  const jan1 = Date.UTC(now.getUTCFullYear(), 0, 1);
  const fyDays = Math.max(1, Math.ceil((nowMs - jan1) / DAY));

  const windows: Record<"all" | "t12m" | "fytd" | "runrate", { ws: number; we: number; factor: number }> = {
    // "all" = every planned week, past AND future. ±10 years bounds the junk
    // (rows with quintillion-scale or far-out test dates are already capped by
    // MAX_WEEKS_PER_ROW; this keeps the monthly map from exploding regardless).
    all:     { ws: nowMs - 3650 * DAY, we: nowMs + 3650 * DAY, factor: 1 },
    t12m:    { ws: nowMs - 365 * DAY, we: nowMs, factor: 1 },
    fytd:    { ws: jan1,              we: nowMs, factor: 365 / fyDays },
    runrate: { ws: nowMs - 91 * DAY,  we: nowMs, factor: 365 / 91 },
  };
  const keys = Object.keys(windows) as Array<"all" | "t12m" | "fytd" | "runrate">;
  const accs: Record<string, Acc> = { all: newAcc(), t12m: newAcc(), fytd: newAcc(), runrate: newAcc() };
  // Weeks outside every window can never contribute — skip early.
  const minWs = Math.min(...keys.map((k) => windows[k].ws));
  const maxWe = Math.max(...keys.map((k) => windows[k].we));

  // Weekly expansion via the ONE shared walker (walkPlannedWeeklySlices) so
  // this aggregation and the Actuals-vs-Forecast engine can never disagree on
  // hours-win, claiming, caps, or pct interpretation. The callback body below
  // is the original accumulation loop body, unchanged.
  const { skippedRows } = walkPlannedWeeklySlices(
    rows,
    { workWeekHours: wwh, minWs, maxWe },
    (row, w, h) => {
      const assigned = !!row.person;
      const division = row.division || "No division";
      const businessUnit = row.businessUnit || "No business unit";
      const department = row.department || "No department";
      const ticket = row.ticket || "(unlinked)";

      // Reconciliation group key — one row per unique (ticket, person, allocationId,
      // billRate, costRate, NC).  allocationId disambiguates multiple RA rows for
      // the same person/project with different rates (e.g. rate change mid-project).
      const reconKey = `${ticket}|${row.person}|${row.allocationId}|${row.billRate}|${row.costRate}|${row.nonChargeable ? 1 : 0}`;
      // A non-chargeable allocation is real planned work with a real internal
      // cost, but it must never inflate the client-billable forecast.
      const clientBillable = !row.nonChargeable;
      const bill = clientBillable && row.billRate > 0 ? h * row.billRate : 0;
      const cost = row.costRate > 0 ? h * row.costRate : 0;
      for (const k of keys) {
        const { ws, we } = windows[k];
        if (w < ws || w >= we) continue;
        const a = accs[k];
        a.plannedHours += h;
        if (clientBillable && row.billRate > 0) a.plannedBillDollars += bill;
        if (assigned) {
          a.assignedHours += h;
          if (clientBillable) {
            if (row.billRate > 0) a.assignedBillDollars += bill; else a.unratedBillHours += h;
          }
          if (row.costRate > 0) {
            if (row.nonChargeable) a.nonJobCost += cost; else a.jobCost += cost;
          } else {
            a.unratedCostHours += h;
          }
        }
        const ym = ymOf(w);
        const m = a.monthly.get(ym) ?? { plannedHours: 0, billDollars: 0, jobCost: 0, nonJobCost: 0 };
        m.plannedHours += h;
        if (assigned) {
          m.billDollars += bill;
          if (row.nonChargeable) m.nonJobCost += cost; else m.jobCost += cost;
        }
        a.monthly.set(ym, m);
        const d = a.byDivision.get(division) ?? { plannedHours: 0, assignedHours: 0, billDollars: 0 };
        d.plannedHours += h;
        if (assigned) { d.assignedHours += h; d.billDollars += bill; }
        a.byDivision.set(division, d);
        const bu = a.byBusinessUnit.get(businessUnit) ?? { plannedHours: 0, assignedHours: 0, billDollars: 0 };
        bu.plannedHours += h;
        if (assigned) { bu.assignedHours += h; bu.billDollars += bill; }
        a.byBusinessUnit.set(businessUnit, bu);
        const dep = a.byDepartment.get(department) ?? { plannedHours: 0, assignedHours: 0, billDollars: 0 };
        dep.plannedHours += h;
        if (assigned) { dep.assignedHours += h; dep.billDollars += bill; }
        a.byDepartment.set(department, dep);
        addProjectTally(a.byProject, ticket, h, assigned, bill, cost, row.nonChargeable);
        // Build each org-unit project drill from this same accepted weekly
        // slice, after all hours-win / overlap de-duplication has run. Do not
        // derive these later from record metadata: one project can genuinely
        // have allocation value in several org units.
        addOrgProjectTally(a.byDivisionByProject, division, ticket, h, assigned, bill, cost, row.nonChargeable);
        addOrgProjectTally(a.byBusinessUnitByProject, businessUnit, ticket, h, assigned, bill, cost, row.nonChargeable);
        addOrgProjectTally(a.byDepartmentByProject, department, ticket, h, assigned, bill, cost, row.nonChargeable);

        // This is the evidence behind the month charts. Build it in the same
        // weekly loop as the month headline (rather than filtering an
        // all-window project or reconciliation total later) so every drill
        // obeys the same hours-win, NC and rate rules as the chart point.
        // Only the default Overall basis is displayed by the Financial page;
        // keeping this verbose evidence to that basis avoids multiplying the
        // response size across hidden comparison bases.
        if (k === "all") {
          const monthlyByProject = a.monthlyByProject ?? new Map();
          const monthProjects = monthlyByProject.get(ym) ?? new Map();
          const mp = monthProjects.get(ticket) ?? {
            plannedHours: 0, assignedHours: 0, billDollars: 0, jobCost: 0, nonJobCost: 0,
          };
          mp.plannedHours += h;
          if (assigned) {
            mp.assignedHours += h;
            mp.billDollars += bill;
            if (row.nonChargeable) mp.nonJobCost += cost; else mp.jobCost += cost;
          }
          monthProjects.set(ticket, mp);
          monthlyByProject.set(ym, monthProjects);
          a.monthlyByProject = monthlyByProject;
        }

        // Accumulate reconciliation group
        const rc = a.recon.get(reconKey) ?? {
          ticket, person: row.person, allocationId: row.allocationId,
          allocationStart: row.allocationStart || row.start,
          allocationEnd: row.allocationEnd || row.end,
          nonChargeable: row.nonChargeable,
          billRate: row.billRate, costRate: row.costRate,
          plannedHours: 0, chargeableHours: 0, planClientBilling: 0,
          jobCost: 0, ncCost: 0,
        };
        rc.plannedHours += h;
        if (assigned) {
          rc.chargeableHours += clientBillable ? h : 0;
          rc.planClientBilling += bill;
          if (row.nonChargeable) rc.ncCost += cost; else rc.jobCost += cost;
        }
        a.recon.set(reconKey, rc);
      }
    },
  );

  const bases = {} as FinancialAnalyticsCore["bases"];
  for (const k of keys) {
    const { ws, we, factor } = windows[k];
    const a = accs[k];
    const byProjectAll = [...a.byProject.entries()]
      .map(([ticket, v]) => ({
        ticket,
        plannedHours: r1(v.plannedHours), assignedHours: r1(v.assignedHours),
        billDollars: r0(v.billDollars), jobCost: r0(v.jobCost), nonJobCost: r0(v.nonJobCost),
      }))
      .sort((x, y) => y.plannedHours - x.plannedHours);
    const byDivisionByProject = serializeOrgProjectBreakdowns(a.byDivisionByProject);
    const byBusinessUnitByProject = serializeOrgProjectBreakdowns(a.byBusinessUnitByProject);
    const byDepartmentByProject = serializeOrgProjectBreakdowns(a.byDepartmentByProject);
    // Parent org rows use the already-quantized drill totals. That means a
    // clicked row and the project lines beneath it stay equal at the exact
    // whole-hour / whole-dollar precision users see.
    const divisionVisibleTotals = new Map(byDivisionByProject.map(g => [g.org, visibleOrgProjectTotals(g.rows)]));
    const businessUnitVisibleTotals = new Map(byBusinessUnitByProject.map(g => [g.org, visibleOrgProjectTotals(g.rows)]));
    const departmentVisibleTotals = new Map(byDepartmentByProject.map(g => [g.org, visibleOrgProjectTotals(g.rows)]));

    // Each calendar-month chart point needs a project-level audit trail. Keep
    // each month bounded, but append an explicit aggregate remainder rather
    // than allowing a large tenant to silently lose projects from the drill.
    // Quantizing with carried remainders makes the VISIBLE project values add
    // exactly to the VISIBLE month headline (not merely the underlying floats).
    const monthlyByProject: FinMonthlyProjectRow[] = [];
    for (const [ym, projects] of (k === "all" ? [...(a.monthlyByProject ?? new Map()).entries()] : []).sort(([aYm], [bYm]) => aYm.localeCompare(bYm))) {
      const sorted = [...projects.entries()]
        .map(([ticket, v]) => ({ ticket, ...v }))
        .sort((a, b) => b.plannedHours - a.plannedHours || a.ticket.localeCompare(b.ticket));
      const visible = sorted.slice(0, MAX_PROJECT_ROWS);
      const monthRows: FinMonthlyProjectRow[] = visible.map(p => ({
        ym, ticket: p.ticket,
        plannedHours: p.plannedHours, assignedHours: p.assignedHours,
        billDollars: p.billDollars, jobCost: p.jobCost, nonJobCost: p.nonJobCost,
        totalInternalCost: p.jobCost + p.nonJobCost,
      }));
      if (sorted.length > MAX_PROJECT_ROWS) {
        const aggregate: FinMonthlyProjectRow = {
          ym, ticket: "", plannedHours: 0, assignedHours: 0, billDollars: 0,
          jobCost: 0, nonJobCost: 0, totalInternalCost: 0,
          aggregateOf: sorted.length - MAX_PROJECT_ROWS,
        };
        for (const p of sorted.slice(MAX_PROJECT_ROWS)) {
          aggregate.plannedHours += p.plannedHours;
          aggregate.assignedHours += p.assignedHours;
          aggregate.billDollars += p.billDollars;
          aggregate.jobCost += p.jobCost;
          aggregate.nonJobCost += p.nonJobCost;
        }
        aggregate.totalInternalCost = aggregate.jobCost + aggregate.nonJobCost;
        monthRows.push(aggregate);
      }
      const carryQuantize = (field: "plannedHours" | "assignedHours" | "billDollars" | "jobCost" | "nonJobCost") => {
        let exact = 0;
        let emitted = 0;
        for (const row of monthRows) {
          exact += row[field];
          row[field] = Math.round(exact) - emitted;
          emitted += row[field];
        }
      };
      carryQuantize("plannedHours");
      carryQuantize("assignedHours");
      carryQuantize("billDollars");
      carryQuantize("jobCost");
      carryQuantize("nonJobCost");
      for (const row of monthRows) row.totalInternalCost = row.jobCost + row.nonJobCost;
      monthlyByProject.push(...monthRows);
    }

    // Build reconciliation rows — sorted by ticket then person for determinism
    const reconAll = [...a.recon.values()].sort((x, y) => {
      const tc = x.ticket.localeCompare(y.ticket);
      if (tc !== 0) return tc;
      return x.person.localeCompare(y.person);
    });
    // Serialize raw first; quantized below with remainder carrying so the
    // VISIBLE (whole-dollar / whole-hour) values still sum exactly.
    const reconRows: FinReconRow[] = reconAll.slice(0, MAX_RECON_ROWS).map(rc => ({
      ticket: rc.ticket,
      person: rc.person,
      allocationId: rc.allocationId,
      allocationStart: rc.allocationStart,
      allocationEnd: rc.allocationEnd,
      nonChargeable: rc.nonChargeable,
      billRate: rc.billRate,
      costRate: rc.costRate,
      plannedHours: rc.plannedHours,
      chargeableHours: rc.chargeableHours,
      planClientBilling: rc.planClientBilling,
      jobCost: rc.jobCost,
      ncCost: rc.ncCost,
      totalInternalCost: rc.jobCost + rc.ncCost,
      windowStart: isoDay(ws),
      windowEnd: isoDay(we),
    }));
    // If the list was capped, append ONE explicit aggregate row carrying the
    // sum of every omitted group, so the serialized rows STILL sum exactly to
    // the basis totals. Never silently drop value from the audit table.
    if (reconAll.length > MAX_RECON_ROWS) {
      const omitted = reconAll.slice(MAX_RECON_ROWS);
      const agg: FinReconRow = {
        ticket: "", person: "", allocationId: "",
        allocationStart: "", allocationEnd: "",
        nonChargeable: false, billRate: 0, costRate: 0,
        plannedHours: 0, chargeableHours: 0, planClientBilling: 0,
        jobCost: 0, ncCost: 0, totalInternalCost: 0,
        windowStart: isoDay(ws), windowEnd: isoDay(we),
        aggregateOf: omitted.length,
      };
      for (const rc of omitted) {
        agg.plannedHours += rc.plannedHours;
        agg.chargeableHours += rc.chargeableHours;
        agg.planClientBilling += rc.planClientBilling;
        agg.jobCost += rc.jobCost;
        agg.ncCost += rc.ncCost;
      }
      agg.totalInternalCost = agg.jobCost + agg.ncCost;
      reconRows.push(agg);
    }
    // Remainder-carrying quantization: round each row to whole units while
    // carrying the rounding remainder into the next row, so the sum of the
    // LISTED values equals the once-rounded exact total. This is what makes
    // the drawer's visible rows add up exactly to the visible total/headline —
    // independent per-row rounding would drift by up to ±$0.5 per row.
    const carryQuantize = (field: "plannedHours" | "chargeableHours" | "planClientBilling" | "jobCost" | "ncCost") => {
      let exact = 0;    // running exact sum
      let emitted = 0;  // running sum of quantized values already assigned
      for (const r of reconRows) {
        exact += r[field];
        const v = Math.round(exact) - emitted;
        r[field] = v;
        emitted += v;
      }
    };
    carryQuantize("plannedHours");
    carryQuantize("chargeableHours");
    carryQuantize("planClientBilling");
    carryQuantize("jobCost");
    carryQuantize("ncCost");
    // Keep the per-row invariant total = job + nc AFTER quantization, so the
    // total column also sums exactly (sum job + sum nc = quantized totals).
    for (const r of reconRows) r.totalInternalCost = r.jobCost + r.ncCost;
    // Reconciliation sums over ALL rows (not just truncated slice) for integrity check
    let sumPlannedHours = 0, sumChargeableHours = 0, sumPlanClientBilling = 0;
    let sumJobCost = 0, sumNcCost = 0;
    for (const rc of reconAll) {
      sumPlannedHours += rc.plannedHours;
      sumChargeableHours += rc.chargeableHours;
      sumPlanClientBilling += rc.planClientBilling;
      sumJobCost += rc.jobCost;
      sumNcCost += rc.ncCost;
    }

    bases[k] = {
      key: k,
      windowStart: isoDay(ws), windowEnd: isoDay(we),
      factor: Math.round(factor * 1000) / 1000,
      plannedHours: r1(a.plannedHours),
      assignedHours: r1(a.assignedHours),
      demandHours: r1(a.plannedHours - a.assignedHours),
      assignedBillDollars: r0(a.assignedBillDollars),
      plannedBillDollars: r0(a.plannedBillDollars),
      jobChargeableCost: r0(a.jobCost),
      nonJobChargeableCost: r0(a.nonJobCost),
      unratedBillHours: r1(a.unratedBillHours),
      unratedCostHours: r1(a.unratedCostHours),
      annualized: {
        plannedHours: r1(a.plannedHours * factor),
        assignedHours: r1(a.assignedHours * factor),
        assignedBillDollars: r0(a.assignedBillDollars * factor),
        jobChargeableCost: r0(a.jobCost * factor),
        nonJobChargeableCost: r0(a.nonJobCost * factor),
      },
      monthly: [...a.monthly.entries()]
        // Cost is the same visible job-cost + NC-cost basis used by the
        // project drill, so its displayed total cannot disagree by a dollar
        // with the two visible cost columns below it.
        .map(([ym, v]) => ({
          ym,
          plannedHours: r1(v.plannedHours),
          billDollars: r0(v.billDollars),
          costDollars: r0(v.jobCost) + r0(v.nonJobCost),
        }))
        .sort((x, y) => (x.ym < y.ym ? -1 : 1)),
      ...(k === "all" ? { monthlyByProject } : {}),
      byDivision: [...a.byDivision.entries()]
        .map(([division, v]) => {
          const visible = divisionVisibleTotals.get(division);
          return {
            division,
            plannedHours: visible?.plannedHours ?? r0(v.plannedHours),
            assignedHours: visible?.assignedHours ?? r0(v.assignedHours),
            billDollars: visible?.billDollars ?? r0(v.billDollars),
          };
        })
        .sort((x, y) => y.plannedHours - x.plannedHours),
      byBusinessUnit: [...a.byBusinessUnit.entries()]
        .map(([bu, v]) => {
          const visible = businessUnitVisibleTotals.get(bu);
          return {
            bu,
            plannedHours: visible?.plannedHours ?? r0(v.plannedHours),
            assignedHours: visible?.assignedHours ?? r0(v.assignedHours),
            billDollars: visible?.billDollars ?? r0(v.billDollars),
          };
        })
        .sort((x, y) => y.plannedHours - x.plannedHours),
      byDepartment: [...a.byDepartment.entries()]
        .map(([department, v]) => {
          const visible = departmentVisibleTotals.get(department);
          return {
            department,
            plannedHours: visible?.plannedHours ?? r0(v.plannedHours),
            assignedHours: visible?.assignedHours ?? r0(v.assignedHours),
            billDollars: visible?.billDollars ?? r0(v.billDollars),
          };
        })
        .sort((x, y) => y.plannedHours - x.plannedHours),
      byDivisionByProject,
      byBusinessUnitByProject,
      byDepartmentByProject,
      byProject: byProjectAll.slice(0, MAX_PROJECT_ROWS),
      projectRowsTruncated: Math.max(0, byProjectAll.length - MAX_PROJECT_ROWS),
      recon: {
        basisKey: k,
        rows: reconRows,
        rowsTruncated: Math.max(0, reconAll.length - MAX_RECON_ROWS),
        sumPlannedHours: r1(sumPlannedHours),
        sumChargeableHours: r1(sumChargeableHours),
        sumPlanClientBilling: r0(sumPlanClientBilling),
        sumJobCost: r0(sumJobCost),
        sumNcCost: r0(sumNcCost),
        sumTotalInternalCost: r0(sumJobCost + sumNcCost),
      },
    };
  }

  return { workWeekHours: wwh, rowCount: rows.length, skippedRows, bases };
}
