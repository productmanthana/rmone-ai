// Computes the Phase-2 "operational intelligence" home screen entirely from
// real PMM / OPM / LEM / resource demand records returned by the API. No
// hard-coded demo numbers — every value here is a function of the live data.

import { compactUsd } from "./money";

export type FormulaDetail = {
  currentReading: string;
  howCalculated: string;
  formula: string;
  /** e.g. "PMM (active book) + OPM (pipeline)" — rendered as DATA SOURCE pills */
  dataSource?: string;
  impact: string;
  tableTitle: string;
  scoreLabel?: string;
  eyebrow?: string;
  liveData?: {
    title: string;
    rows: { label: string; value: string; highlight?: boolean }[];
  };
  topTable?: {
    title: string;
    rows: { label: string; value: string }[];
    total?: string;
    totalValue?: string;
    footnote?: string;
  };
  secondaryTable?: {
    title: string;
    columns: { key: string; label: string; align?: "left" | "right" }[];
    rows: Record<string, string | number>[];
  };
};

export type SubDriver = {
  label: string;
  value: number;
  /**
   * When false the metric could not be measured (e.g. the allocation feed
   * failed) — the UI renders "Not available yet" instead of the
   * (meaningless) numeric value.
   */
  available?: boolean;
  raw?: string;
  /**
   * Short pill label showing which timeframe this metric is computed over,
   * mirroring the picker at the top of the Operational Health card
   * ("30d" / "60d" / "90d" / "6mo"). For drivers that aren't influenced by
   * the forecast-window selector (e.g. Proposal coverage compares
   * all-time totals) this is set to "all-time" so the user understands why the picker
   * doesn't change that number.
   */
  windowLabel?: string;
  records?: ActionDetail;
  /** When present, tapping the tile opens the rich formula-detail panel. */
  formulaDetail?: FormulaDetail;
};
export type RiskItem = {
  level: "CRIT" | "WARN" | "INSIGHT";
  horizon: string;
  text: string;
  detail: string;
  records?: ActionDetail;
};
export type DetailColumn = { key: string; label: string; align?: "left" | "right" };
export type ActionDetail = {
  title: string;
  subtitle?: string;
  columns: DetailColumn[];
  rows: Record<string, string | number>[];
  emptyText?: string;
} | null;
export type Decision = {
  num: number;
  category: string;
  text: string;
  cta: string;
  tone: "green" | "orange";
  detail: ActionDetail;
};
export type PinnedCritical = {
  title: string;
  detail: string;
  horizon: string;
  records: ActionDetail;
} | null;

export interface HomeIntelligence {
  health: number;
  healthDetail: ActionDetail;
  subDrivers: SubDriver[];
  pinned: PinnedCritical;
  risks: RiskItem[];
  decisions: Decision[];
  meta: {
    activePmm: number;
    closedPmm: number;
    opmCount: number;
    lemCount: number;
    activeDemands: number;
    opmValue: number;
    pmmActiveValue: number;
    lemValue: number;
  };
  signalCount: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function getValue(p: any): number {
  // Fallback chain includes ContractValue and ContractedAmount — some client
  // imports populate ONLY ContractedAmount, and ignoring it renders every
  // record as $0 across the home page. Keep in lockstep with web
  // src/lib/homeIntelligence.ts getValue().
  for (const key of ["ApproxContractValue", "ContractValue", "ContractedAmount", "LaborContractAmount", "ForecastedProjectCost"]) {
    const n = Number(p?.[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}
function isClosed(p: any): boolean {
  return p?.Closed === true;
}
function getProjectTitle(p: any): string {
  return (
    p?.Title ||
    p?.RecordCode ||
    p?.TicketId ||
    p?.Code ||
    p?.ItemKey ||
    "Project"
  );
}
function getProjectCity(p: any): string | null {
  const c = p?.City || p?.Location;
  if (!c || typeof c !== "string") return null;
  const t = c.trim();
  return t || null;
}
export function inForecastWindow(d: any, days: number): boolean {
  // Returns true if the demand is active or starts within the horizon.
  // Compare against today at 00:00 so a record that ends "today" is still
  // counted as active (date-only end values come in at midnight).
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const horizon = new Date(todayStart.getTime() + days * 86400000);
  const start = d?.AllocationStartDate ? new Date(d.AllocationStartDate) : null;
  const end = d?.AllocationEndDate ? new Date(d.AllocationEndDate) : null;
  if (start && start > horizon) return false;
  if (end && end < todayStart) return false;
  return true;
}
function isOpmEarlyStage(o: any): boolean {
  const s = String(o?.CRMProjectStatusChoice || o?.Status || "").toLowerCase();
  return (
    s.includes("identify") ||
    s.includes("qualify") ||
    s.includes("rom") ||
    s.includes("assign") ||
    s.includes("budget")
  );
}

function fmtMoney(n: number): string {
  if (n >= 1e9) return compactUsd(n);
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}
function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}
function fmtRange(a: string | null | undefined, b: string | null | undefined): string {
  return `${fmtDate(a)} → ${fmtDate(b)}`;
}

// Sentinel windowDays value meaning "no date window at all" — aggregate
// every record in the tenant regardless of date. Large enough (~100
// years) that all real-world dates fall inside the horizon, so the
// existing date-range math below "just works" without needing
// Infinity/NaN special-casing in every branch.
export const ALL_TIME_DAYS = 36500;

export function buildHomeIntelligence(
  rawPmm: any[],
  rawOpm: any[],
  rawLem: any[],
  rawDemands: any[],
  windowDays: number = 30,
  alloc?: { resources?: Array<{ allProjectIds?: string[] }> } | null,
): HomeIntelligence {
  const pmm = Array.isArray(rawPmm) ? rawPmm : [];
  const opm = Array.isArray(rawOpm) ? rawOpm : [];
  const lem = Array.isArray(rawLem) ? rawLem : [];
  const demands = Array.isArray(rawDemands) ? rawDemands : [];

  // Projects that already have people assigned (from the resources feed's
  // per-resource project lists). Demand rows only represent OPEN (unfilled)
  // positions, so a fully staffed project legitimately has ZERO demand rows —
  // it must NOT be flagged as "unstaffed". A project counts as covered when
  // it has EITHER open-demand rows OR at least one assigned team member.
  // Mirrors the identical fix in rmone-web/src/lib/homeIntelligence.ts.
  const staffedTids = new Set<string>();
  for (const r of alloc?.resources ?? []) {
    const ids = Array.isArray(r?.allProjectIds) ? r.allProjectIds : [];
    for (const id of ids) {
      const t = String(id ?? "").trim().toLowerCase();
      if (t) staffedTids.add(t);
    }
  }
  const isStaffed = (tid: string) =>
    staffedTids.has(String(tid ?? "").trim().toLowerCase());
  // When the allocation feed failed to load (alloc == null), staffedTids is
  // empty — NOT because projects are unstaffed, but because we don't know.
  // Every "N projects unstaffed / no staffing data" signal must be suppressed
  // in that state or a transient fetch failure paints the whole portfolio as
  // an unstaffed crisis. Mirrors web src/lib/homeIntelligence.ts allocFeedOk.
  const allocFeedOk = alloc != null;

  // Project name lookup keyed by TicketId — resolves project names for demand
  // rows whose own Title field is often blank (ResourceAllocation.Title).
  const projectNameByTid = new Map<string, string>();
  for (const p of [...pmm, ...opm]) {
    const tid = String(p?.TicketId ?? "").trim();
    const name = String(p?.Title ?? "").trim();
    if (tid && name) projectNameByTid.set(tid, name);
  }
  function demandProjectName(d: any): string {
    const tid = String(d?.TicketId ?? "").trim();
    return projectNameByTid.get(tid) || String(d?.Title ?? "").trim() || tid || "—";
  }

  // Human-readable label for the chosen forecast window, used in modal
  // subtitles and empty-state copy. Reads naturally as "30 days" /
  // "60 days" / "90 days" / "6 months" to match product language.
  // ALL_TIME_DAYS means the whole tenant's data with no date cutoff — in
  // that case there is no window to label, so this is deliberately blank
  // (never render a "window" phrase when there is no window).
  const isAllTime = windowDays >= ALL_TIME_DAYS;
  const windowLabel =
    isAllTime ? "" : windowDays === 180 ? "6 months" : `${windowDays} days`;
  // Short pill form, matching the selector at the top of the Operational
  // Health card ("30d" / "60d" / "90d" / "6mo"). Used on each sub-driver
  // tile so the user can see at a glance which window every metric uses.
  const windowShort =
    isAllTime ? "" : windowDays === 180 ? "6mo" : `${windowDays}d`;
  // Uppercase variant, used for the small horizon pills on the Risk Feed
  // and the Pinned Critical card ("30D" / "60D" / "90D" / "6MO") so they
  // visually track the user's forecast-window selection.
  const windowShortUpper = windowShort.toUpperCase();

  const activePmm = pmm.filter((p) => p && !isClosed(p));
  const closedPmm = pmm.filter((p) => p && isClosed(p));

  const pmmActiveValue = activePmm.reduce((s, p) => s + getValue(p), 0);
  const opmValue = opm.reduce((s, o) => s + getValue(o), 0);
  const lemValue = lem.reduce((s, l) => s + getValue(l), 0);

  // Bucket demands by project + by role — ALL-TIME, no date-window filter.
  // Pinned Critical / Risk Feed / Decision Support must show the whole
  // portfolio's demand picture regardless of the 7D/30D/60D/90D selector;
  // that selector only scopes the Operational Health sub-drivers below,
  // which use the separate `winDemandsByProject` bucket.
  const demandsByProject: Record<string, any[]> = {};
  const demandsByRole: Record<string, any[]> = {};
  let activeDemands = 0;
  for (const d of demands) {
    if (!d) continue;
    activeDemands++;
    const tid = String(d?.TicketId ?? "");
    if (tid) (demandsByProject[tid] ??= []).push(d);
    const role = String(d?.Role ?? "Unassigned").trim() || "Unassigned";
    (demandsByRole[role] ??= []).push(d);
  }
  // Windowed variant — used ONLY by the Operational Health sub-driver
  // calculations below (staffing balance, utilization stability, delivery
  // exposure), which are meant to track the forecast-window selector.
  const winDemandsByProject: Record<string, any[]> = {};
  let winActiveDemands = 0;
  let winTotalAlloc = 0;
  for (const d of demands) {
    if (!d || !inForecastWindow(d, windowDays)) continue;
    winActiveDemands++;
    winTotalAlloc += Number(d?.PctAllocation) || 0;
    const tid = String(d?.TicketId ?? "");
    if (tid) (winDemandsByProject[tid] ??= []).push(d);
  }

  // ---- Sub-drivers (each 0–100) ----

  // Staffing balance: how close is the average % allocation to the 80% sweet spot?
  // 80% = 100. Drift ±20pts halves the score.
  const meanAlloc = winActiveDemands > 0 ? winTotalAlloc / winActiveDemands : 0;
  const staffingBalance = winActiveDemands === 0
    ? 50
    : Math.round(clamp(100 - Math.abs(meanAlloc - 80) * 1.5, 0, 100));

  // Utilization stability: how evenly demand is spread across projects.
  // 100 = perfectly even. Anything heavily concentrated drops the score.
  const projectLoads = Object.values(winDemandsByProject).map((arr) =>
    arr.reduce((s, d) => s + (Number(d?.PctAllocation) || 0), 0),
  );
  let utilStability = 50;
  if (projectLoads.length >= 2) {
    const mean = projectLoads.reduce((s, n) => s + n, 0) / projectLoads.length;
    const variance =
      projectLoads.reduce((s, n) => s + (n - mean) ** 2, 0) / projectLoads.length;
    const stddev = Math.sqrt(variance);
    const cv = mean > 0 ? stddev / mean : 1; // coefficient of variation
    utilStability = Math.round(clamp(100 - cv * 60, 0, 100));
  } else if (projectLoads.length === 1) {
    utilStability = 100;
  }

  // Proposal coverage: share of the open pipeline already converted into
  // signed active work (all-time totals — deliberately window-independent).
  // Same definition as the web home tile so both apps agree.
  const pipelineCovPct = opmValue > 0
    ? Math.round(clamp((pmmActiveValue / opmValue) * 100, 0, 999))
    : 0;
  const propCoverage = Math.min(pipelineCovPct, 100);

  // Delivery exposure: % of active projects that have at least one demand record
  // within the selected window. The unsupplied ones are the exposed ones.
  const projectsWithDemand = activePmm.filter((p) => {
    const tid = String(p?.TicketId ?? p?.RecordCode ?? "");
    return !!tid && (!!winDemandsByProject[tid] || isStaffed(tid));
  }).length;
  const deliveryExposure = activePmm.length > 0
    ? Math.round((projectsWithDemand / activePmm.length) * 100)
    : 100;

  // Aliases reused by Pinned Critical / Risk Feed / Decision Support. These
  // used to be hard-coded to a 30-day window; they now follow the user's
  // forecast-window selection (see follow-up #4). The names are kept with
  // the historical `30` suffix so the heavy downstream code below doesn't
  // need to be rewritten — they now simply point at the windowed values.
  const projectLoads30 = projectLoads;
  const projectsWithDemand30 = projectsWithDemand;
  const deliveryExposure30 = deliveryExposure;

  // Pre-compute the per-driver record sets so each tile is clickable.
  // The three windowed drivers use the windowed buckets; coverageRecords
  // (Proposal coverage) is unaffected.
  // No visible cap on detail-modal record sets — the modal scrolls. Caps are
  // only applied to the AI-prompt context (token budget) inside home.tsx.
  const balanceRecords = demands
    .filter((d) => inForecastWindow(d, windowDays))
    .slice()
    .sort(
      (a, b) =>
        Math.abs((Number(b?.PctAllocation) || 0) - 80) -
        Math.abs((Number(a?.PctAllocation) || 0) - 80),
    );
  const stabilityRecords = Object.entries(winDemandsByProject)
    .map(([tid, arr]) => {
      const proj = activePmm.find(
        (p) => String(p?.TicketId ?? p?.RecordCode ?? "") === tid,
      );
      return {
        title: getProjectTitle(proj) || tid,
        count: arr.length,
        sum: arr.reduce((s, d) => s + (Number(d?.PctAllocation) || 0), 0),
      };
    })
    .sort((a, b) => b.sum - a.sum);
  const coverageRecords = opm
    .slice()
    .sort((a, b) => getValue(b) - getValue(a));
  const exposureRecords = activePmm
    .filter((p) => {
      const tid = String(p?.TicketId ?? p?.RecordCode ?? "");
      return !tid || (!winDemandsByProject[tid] && !isStaffed(tid));
    })
    .slice()
    .sort((a, b) => getValue(b) - getValue(a));
  // Risk Feed now uses the same windowed exposure record set — alias kept
  // so the existing Risk Feed code below doesn't need to be touched.
  const exposureRecords30 = exposureRecords;

  const subDrivers: SubDriver[] = [
    {
      label: "Staffing balance",
      value: staffingBalance,
      raw: `mean alloc ${Math.round(meanAlloc)}%`,
      windowLabel: windowShort,
      records: {
        title: "Staffing balance · resource allocations",
        subtitle: `${winActiveDemands} active demands · mean ${Math.round(meanAlloc)}% (target 80%)`,
        columns: [
          { key: "role", label: "Role" },
          { key: "title", label: "Demand" },
          { key: "alloc", label: "% Alloc", align: "right" },
          { key: "window", label: "Window", align: "right" },
        ],
        rows: balanceRecords.map((d) => ({
          role: String(d?.Role ?? "Unassigned"),
          title: demandProjectName(d),
          alloc: `${Math.round(Number(d?.PctAllocation) || 0)}%`,
          window: fmtRange(d?.AllocationStartDate, d?.AllocationEndDate),
        })),
        emptyText: `No active resource demands.`,
      },
    },
    {
      label: "Utilization stability",
      value: utilStability,
      raw: `${projectLoads.length} loaded projects`,
      windowLabel: windowShort,
      records: {
        title: "Utilization stability · per-project load",
        subtitle: `${projectLoads.length} project${projectLoads.length === 1 ? "" : "s"} carrying active demand · sorted by total FTE`,
        columns: [
          { key: "title", label: "Project" },
          { key: "count", label: "Demands", align: "right" },
          { key: "sum", label: "Avg / FTE total", align: "right" },
        ],
        rows: stabilityRecords.map((x) => ({
          title: x.title,
          count: x.count,
          sum: `avg ${x.count ? Math.round(x.sum / x.count) : 0}% · ~${(x.sum / 100).toFixed(1)} FTE`,
        })),
        emptyText: `No projects with active demand.`,
      },
    },
    {
      label: "Proposal coverage",
      value: propCoverage,
      raw: `${fmtMoney(pmmActiveValue)} of ${fmtMoney(opmValue)} pipeline booked`,
      // Proposal coverage compares all-time totals (active book vs open
      // pipeline), so it is tagged "all-time" rather than left blank like
      // the other window-derived sub-drivers.
      windowLabel: "all-time",
      formulaDetail: (() => {
        const activeBook = pmmActiveValue;
        const totalPipeline = opmValue;
        const covPct = pipelineCovPct;
        return {
          currentReading: `${fmtMoney(activeBook)} of ${fmtMoney(totalPipeline)} total pipeline already booked · ${covPct}% covered`,
          howCalculated: `What share of the potential work currently being pursued has already turned into signed, active work. Both sides are all-time, firm-wide totals, so this reading is stable and doesn't move just because you change the time window. There's no fixed target since we don't track a sales quota, but if the active book ever exceeds the pipeline, that's an early warning to submit more proposals or improve win rates before existing work runs out.`,
          formula: `Active Project Book (PMM) ÷ Open Opportunity Pipeline (OPM) × 100 = ${fmtMoney(activeBook)} ÷ ${fmtMoney(totalPipeline)} × 100 = ${covPct}%${covPct > 100 ? " (gauge capped at 100%)" : ""}`,
          dataSource: "PMM (active book) + OPM (pipeline)",
          impact: `${fmtMoney(activeBook)} of ${fmtMoney(totalPipeline)} total pipeline already booked · ${covPct}% covered. This is simply the share of the firm's total pipeline of bids and proposals that has already converted into active, signed work — there's no fixed target since RM ONE has no sales-quota field. Watch for this approaching 100%, which would mean the active book is catching up to the entire known pipeline.`,
          tableTitle: `OPEN PIPELINE (OPM) · ${opm.length} OPPORTUNIT${opm.length === 1 ? "Y" : "IES"} · TOTAL ${fmtMoney(totalPipeline)}`,
          secondaryTable: {
            title: `ACTIVE PROJECT BOOK (PMM) · ${activePmm.length} PROJECT${activePmm.length === 1 ? "" : "S"} · TOTAL ${fmtMoney(activeBook)}`,
            columns: [
              { key: "project", label: "Project" },
              { key: "client",  label: "Client" },
              { key: "value",   label: "Value", align: "right" as const },
            ],
            rows: [...activePmm]
              .sort((a, b) => getValue(b) - getValue(a))
              .map((p) => ({
                project: getProjectTitle(p),
                client:  String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
                value:   fmtMoney(getValue(p)),
              })),
          },
        };
      })(),
      records: {
        title: "Proposal coverage · pipeline opportunities",
        subtitle: `${opm.length} OPM record${opm.length === 1 ? "" : "s"} · ${fmtMoney(opmValue)} open pipeline`,
        columns: [
          { key: "title", label: "Opportunity" },
          { key: "client", label: "Client" },
          { key: "stage", label: "Stage" },
          { key: "value", label: "Value", align: "right" },
        ],
        rows: coverageRecords.map((o) => ({
          title: getProjectTitle(o),
          client: String(o?.CRMCompanyLookupName ?? o?.ClientName ?? o?.CompanyName ?? "—"),
          stage: String(o?.CRMProjectStatusChoice ?? o?.Status ?? "—"),
          value: fmtMoney(getValue(o)),
        })),
        emptyText: "No opportunities in the pipeline.",
      },
    },
    {
      label: "Demand data coverage",
      // When the allocation feed failed, coverage cannot be measured (team
      // assignments are invisible) — mark unavailable rather than show a
      // falsely low percentage.
      value: deliveryExposure,
      available: allocFeedOk,
      raw: allocFeedOk
        ? `${projectsWithDemand}/${activePmm.length} resourced`
        : "Staffing feed unavailable",
      windowLabel: windowShort,
      formulaDetail: (() => {
        const withDemandRecords = activePmm
          .filter((p) => {
            const tid = String(p?.TicketId ?? p?.RecordCode ?? "");
            return !!tid && (!!winDemandsByProject[tid] || isStaffed(tid));
          })
          .slice()
          .sort((a, b) => getValue(b) - getValue(a));
        const without = activePmm.length - projectsWithDemand;
        return {
          currentReading: `${projectsWithDemand} of ${activePmm.length} active projects have staffing data on file (team members or open demands) · ${deliveryExposure}% covered`,
          howCalculated: `Measures what share of the active project portfolio has staffing data attached — either assigned team members or an open resource demand (staffing request). Projects with neither cannot be staffed proactively, increasing delivery risk and last-minute hiring pressure.`,
          formula: `Projects with Staffing Data ÷ Active Projects × 100 = ${projectsWithDemand} ÷ ${activePmm.length} × 100 = ${deliveryExposure}%`,
          dataSource: "PMM + Resource Demands + Team Assignments",
          impact: without === 0
            ? `All ${activePmm.length} active projects have team members or a documented resource demand on file. Staffing coverage is complete — no gaps detected.`
            : `Only ${projectsWithDemand} of ${activePmm.length} active projects have team members or a documented resource demand. Staffing cannot be forecast reliably across most of the portfolio, increasing the risk of last-minute staffing decisions and delivery delays. Immediate staffing planning is recommended.`,
          tableTitle: `PROJECTS WITH STAFFING DATA · ${projectsWithDemand} OF ${activePmm.length}`,
          secondaryTable: {
            title: `PROJECTS WITHOUT STAFFING DATA · ${without} OF ${activePmm.length}`,
            columns: [
              { key: "project", label: "Project" },
              { key: "client",  label: "Client" },
              { key: "due",     label: "Target End", align: "right" as const },
              { key: "value",   label: "Value", align: "right" as const },
            ],
            rows: exposureRecords.map((p) => ({
              project: getProjectTitle(p),
              client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
              due: fmtDate(p?.TargetCompletionDate ?? p?.ActualCompletionDate),
              value: fmtMoney(getValue(p)),
            })),
          },
        };
      })(),
      records: {
        title: `Demand data coverage · projects with staffing data · ${projectsWithDemand} of ${activePmm.length}`,
        subtitle: `${projectsWithDemand} of ${activePmm.length} active projects have team members or a resource demand record`,
        columns: [
          { key: "title", label: "Project" },
          { key: "client", label: "Client" },
          { key: "due", label: "Target End", align: "right" },
          { key: "value", label: "Value", align: "right" },
        ],
        rows: activePmm
          .filter((p) => {
            const tid = String(p?.TicketId ?? p?.RecordCode ?? "");
            return !!tid && (!!winDemandsByProject[tid] || isStaffed(tid));
          })
          .sort((a, b) => getValue(b) - getValue(a))
          .map((p) => ({
            title: getProjectTitle(p),
            client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
            due: fmtDate(p?.TargetCompletionDate ?? p?.ActualCompletionDate),
            value: fmtMoney(getValue(p)),
          })),
        emptyText: `No active projects have staffing data on file.`,
      },
    },
  ];

  const health = Math.round(
    (staffingBalance + utilStability + propCoverage + deliveryExposure) / 4,
  );

  const healthDetail: ActionDetail = {
    title: "Operational health · breakdown",
    subtitle: `Composite score ${health}/100 · average of four sub-drivers`,
    columns: [
      { key: "label", label: "Driver" },
      { key: "value", label: "Score", align: "right" },
      { key: "raw", label: "Underlying" },
    ],
    rows: subDrivers.map((d) => ({
      label: d.label,
      value: d.value,
      raw: d.raw ?? "—",
    })),
  };

  // ---- Pinned critical: top overloaded project, or top demand role ----
  const overloaded = Object.entries(demandsByProject)
    .map(([tid, arr]) => ({
      tid,
      total: arr.reduce((s, d) => s + (Number(d?.PctAllocation) || 0), 0),
      count: arr.length,
    }))
    .filter((x) => x.total > 200)
    .sort((a, b) => b.total - a.total);

  let pinned: PinnedCritical = null;
  if (overloaded.length > 0) {
    const top = overloaded[0];
    const proj = activePmm.find(
      (p) => String(p?.TicketId ?? p?.RecordCode ?? "") === top.tid,
    );
    const records = (demandsByProject[top.tid] || [])
      .slice()
      .sort((a, b) => (Number(b?.PctAllocation) || 0) - (Number(a?.PctAllocation) || 0));
    pinned = {
      title: `${getProjectTitle(proj)} projected at ~${(top.total / 100).toFixed(1)} FTE total demand`,
      detail: `${top.count} concurrent resource demands (avg ${top.count ? Math.round(top.total / top.count) : 0}% per req) · cascade risk inside the 7-day window`,
      horizon: "7D",
      records: {
        title: `Resource allocations on ${getProjectTitle(proj)}`,
        subtitle: `${top.count} concurrent demands · avg ${top.count ? Math.round(top.total / top.count) : 0}% per req · ~${(top.total / 100).toFixed(1)} FTE total`,
        columns: [
          { key: "role", label: "Role" },
          { key: "title", label: "Demand" },
          { key: "alloc", label: "% Alloc", align: "right" },
          { key: "window", label: "Window", align: "right" },
        ],
        rows: records.map((d) => ({
          role: String(d?.Role ?? "Unassigned"),
          title: demandProjectName(d),
          alloc: `${Math.round(Number(d?.PctAllocation) || 0)}%`,
          window: fmtRange(d?.AllocationStartDate, d?.AllocationEndDate),
        })),
      },
    };
  } else {
    const cityCounts: Record<string, { count: number; projects: any[] }> = {};
    for (const p of activePmm) {
      const c = getProjectCity(p);
      if (c) {
        cityCounts[c] ??= { count: 0, projects: [] };
        cityCounts[c].count++;
        cityCounts[c].projects.push(p);
      }
    }
    const topCity = Object.entries(cityCounts).sort(
      ([, a], [, b]) => b.count - a.count,
    )[0];
    if (topCity && topCity[1].count >= 5) {
      const projs = topCity[1].projects
        .slice()
        .sort((a, b) => getValue(b) - getValue(a));
      pinned = {
        title: `${topCity[0]} concentration at ${topCity[1].count} active projects · capacity at risk`,
        detail: `Largest active footprint in the portfolio · monitor 7-day staffing draws`,
        horizon: "7D",
        records: {
          title: `Active projects in ${topCity[0]}`,
          subtitle: `${topCity[1].count} active projects · sorted by contract value`,
          columns: [
            { key: "title", label: "Project" },
            { key: "client", label: "Client" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: projs.map((p) => ({
            title: getProjectTitle(p),
            client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
            value: fmtMoney(getValue(p)),
          })),
        },
      };
    } else if (allocFeedOk && deliveryExposure30 < 70 && activePmm.length > 0) {
      const exposedCount = activePmm.length - projectsWithDemand30;
      const exposed = activePmm
        .filter((p) => {
          const tid = String(p?.TicketId ?? p?.RecordCode ?? "");
          return !tid || (!demandsByProject[tid] && !isStaffed(tid));
        })
        .slice()
        .sort((a, b) => getValue(b) - getValue(a));
      pinned = {
        title: `${exposedCount} active projects unstaffed`,
        detail: `Delivery exposure at ${deliveryExposure30}% · staffing coverage gap forecasted`,
        horizon: windowShortUpper,
        records: {
          title: `Unstaffed active projects`,
          subtitle: `${exposedCount} active projects with no team members or staffing plan on file`,
          columns: [
            { key: "title", label: "Project" },
            { key: "city", label: "City" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: exposed.map((p) => ({
            title: getProjectTitle(p),
            city: getProjectCity(p) || "—",
            value: fmtMoney(getValue(p)),
          })),
        },
      };
    }
  }

  // ---- Risk feed (predictive language, real numbers) ----
  // Risk feed now follows the user's forecast-window selection so the whole
  // home page tells one consistent story (see follow-up #4). The short
  // pill on each risk row uses `windowShortUpper` so it visually matches
  // the selector at the top of the Operational Health card.
  // exposedCount forced to 0 when the allocation feed failed — "unstaffed"
  // claims are only valid when we actually loaded the staffing data.
  const exposedCount = allocFeedOk
    ? Math.max(0, activePmm.length - projectsWithDemand30)
    : 0;
  const overloadedRoles = Object.entries(demandsByRole)
    .map(([role, arr]) => ({
      role,
      count: arr.length,
      sum: arr.reduce((s, d) => s + (Number(d?.PctAllocation) || 0), 0),
    }))
    .sort((a, b) => b.sum - a.sum);
  const topRole = overloadedRoles[0];
  const stretchedProjects = projectLoads30.filter((n) => n > 100).length;
  const earlyOpmCount = opm.filter(isOpmEarlyStage).length;

  const risks: RiskItem[] = [];
  if (exposedCount > 0) {
    risks.push({
      level: exposedCount >= 5 ? "CRIT" : "WARN",
      horizon: windowShortUpper,
      text: `${exposedCount} active project${exposedCount === 1 ? "" : "s"} projected under-resourced`,
      detail: `No staffing demand recorded · ${activePmm.length} active in portfolio`,
      records: {
        title: "Under-resourced active projects",
        subtitle: `${exposedCount} active projects with no resource demand recorded`,
        columns: [
          { key: "title", label: "Project" },
          { key: "client", label: "Client" },
          { key: "city", label: "City" },
          { key: "value", label: "Value", align: "right" },
        ],
        rows: exposureRecords30.map((p) => ({
          title: getProjectTitle(p),
          client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
          city: getProjectCity(p) || "—",
          value: fmtMoney(getValue(p)),
        })),
      },
    });
  }
  if (topRole && topRole.count >= 2) {
    const roleDemands = (demandsByRole[topRole.role] || [])
      .slice()
      .sort((a, b) => (Number(b?.PctAllocation) || 0) - (Number(a?.PctAllocation) || 0));
    const fteNeeded = (topRole.sum / 100).toFixed(1);
    const avgPct = Math.round(topRole.sum / topRole.count);
    risks.push({
      level: topRole.sum > 300 ? "CRIT" : "WARN",
      horizon: windowShortUpper,
      text: `Likely ${topRole.role} shortage · ${topRole.count} concurrent reqs forecasted`,
      detail: `${topRole.count} reqs · avg ${avgPct}% per req · ~${fteNeeded} FTE total across portfolio · typical hire close ~45 days`,
      records: {
        title: `${topRole.role} demand · forecasted shortage`,
        subtitle: `${topRole.count} demand record${topRole.count === 1 ? "" : "s"} · avg ${avgPct}% per req · ~${fteNeeded} FTE total needed`,
        columns: [
          { key: "title", label: "Demand / Project" },
          { key: "alloc", label: "% Alloc", align: "right" },
          { key: "window", label: "Window", align: "right" },
        ],
        rows: roleDemands.map((d) => ({
          title: demandProjectName(d),
          alloc: `${Math.round(Number(d?.PctAllocation) || 0)}%`,
          window: fmtRange(d?.AllocationStartDate, d?.AllocationEndDate),
        })),
      },
    });
  }
  if (stretchedProjects > 0) {
    const stretched = Object.entries(demandsByProject)
      .map(([tid, arr]) => ({
        tid,
        sum: arr.reduce((s, d) => s + (Number(d?.PctAllocation) || 0), 0),
        count: arr.length,
      }))
      .filter((x) => x.sum > 100)
      .sort((a, b) => b.sum - a.sum);
    risks.push({
      level: stretchedProjects >= 3 ? "CRIT" : "WARN",
      horizon: windowShortUpper,
      text: `Burnout risk on ${stretchedProjects} project team${stretchedProjects === 1 ? "" : "s"}`,
      detail: `Total demand > 1.0 FTE on these teams · forecast peak across the portfolio`,
      records: {
        title: "Project teams at burnout risk",
        subtitle: `${stretchedProjects} team${stretchedProjects === 1 ? "" : "s"} with total demand > 1.0 FTE`,
        columns: [
          { key: "title", label: "Project" },
          { key: "count", label: "Demands", align: "right" },
          { key: "alloc", label: "Avg / FTE total", align: "right" },
        ],
        rows: stretched.map((x) => {
          const proj = activePmm.find(
            (p) => String(p?.TicketId ?? p?.RecordCode ?? "") === x.tid,
          );
          const avg = x.count ? Math.round(x.sum / x.count) : 0;
          return {
            title: getProjectTitle(proj) || x.tid,
            count: x.count,
            alloc: `avg ${avg}% · ~${(x.sum / 100).toFixed(1)} FTE`,
          };
        }),
      },
    });
  }
  if (risks.length === 0 && opmValue > 0) {
    risks.push({
      level: "INSIGHT",
      horizon: windowShortUpper,
      text: `Pipeline coverage at ${fmtMoney(opmValue)} across ${opm.length} opportunit${opm.length === 1 ? "y" : "ies"}`,
      detail: `Forward-looking; no critical risks detected across the portfolio`,
      records: {
        title: "Pipeline opportunities",
        subtitle: `${opm.length} opportunities · ${fmtMoney(opmValue)} total`,
        columns: [
          { key: "title", label: "Opportunity" },
          { key: "client", label: "Client" },
          { key: "value", label: "Value", align: "right" },
        ],
        rows: coverageRecords.map((o) => ({
          title: getProjectTitle(o),
          client: String(o?.CRMCompanyLookupName ?? o?.ClientName ?? o?.CompanyName ?? "—"),
          value: fmtMoney(getValue(o)),
        })),
      },
    });
  }
  // Always cap at three for scan speed.
  const trimmedRisks = risks.slice(0, 3);

  // ---- Decision support: real, actionable, derived from the data ----
  const decisions: Decision[] = [];
  let n = 1;

  if (exposedCount > 0) {
    const exposedProjects = activePmm
      .filter((p) => {
        const tid = String(p?.TicketId ?? p?.RecordCode ?? "");
        return !tid || (!demandsByProject[tid] && !isStaffed(tid));
      })
      .slice()
      .sort((a, b) => getValue(b) - getValue(a));
    decisions.push({
      num: n++,
      category: "OPEN REQ",
      text: `Open requisitions for ${exposedCount} unstaffed project${exposedCount === 1 ? "" : "s"}`,
      cta: "Open",
      tone: "green",
      detail: {
        title: `Unstaffed active projects requiring requisitions`,
        subtitle: `${exposedCount} active projects with no team members or staffing plan · sorted by contract value`,
        columns: [
          { key: "title", label: "Project" },
          { key: "client", label: "Client" },
          { key: "city", label: "City" },
          { key: "value", label: "Value", align: "right" },
        ],
        rows: exposedProjects.map((p) => ({
          title: getProjectTitle(p),
          client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
          city: getProjectCity(p) || "—",
          value: fmtMoney(getValue(p)),
        })),
        emptyText: "No unstaffed projects in the current dataset.",
      },
    });
  }

  if (topRole && topRole.count >= 2) {
    const roleDemands = (demandsByRole[topRole.role] || [])
      .slice()
      .sort((a, b) => (Number(b?.PctAllocation) || 0) - (Number(a?.PctAllocation) || 0));
    decisions.push({
      num: n++,
      category: "HIRE",
      text: `Hire ${Math.max(1, Math.ceil(topRole.sum / 100) - 1)} ${topRole.role} · close 45D`,
      cta: "Hire",
      tone: "green",
      detail: {
        title: `${topRole.role} demand across the portfolio`,
        subtitle: `${topRole.count} concurrent demands · avg ${topRole.count ? Math.round(topRole.sum / topRole.count) : 0}% per req · ~${(topRole.sum / 100).toFixed(1)} FTE total`,
        columns: [
          { key: "title", label: "Demand / Project" },
          { key: "alloc", label: "% Alloc", align: "right" },
          { key: "window", label: "Window", align: "right" },
        ],
        rows: roleDemands.map((d) => ({
          title: demandProjectName(d),
          alloc: `${Math.round(Number(d?.PctAllocation) || 0)}%`,
          window: fmtRange(d?.AllocationStartDate, d?.AllocationEndDate),
        })),
        emptyText: "No active demands recorded for this role.",
      },
    });
  }

  if (stretchedProjects > 0) {
    const stretched = Object.entries(demandsByProject)
      .map(([tid, arr]) => ({
        tid,
        sum: arr.reduce((s, d) => s + (Number(d?.PctAllocation) || 0), 0),
        count: arr.length,
      }))
      .filter((x) => x.sum > 100)
      .sort((a, b) => b.sum - a.sum);
    decisions.push({
      num: n++,
      category: "REBALANCE",
      text: `Re-balance ${stretchedProjects} overloaded project team${stretchedProjects === 1 ? "" : "s"}`,
      cta: "Apply",
      tone: "green",
      detail: {
        title: `Overloaded project teams`,
        subtitle: `${stretchedProjects} project${stretchedProjects === 1 ? "" : "s"} with total demand > 1.0 FTE`,
        columns: [
          { key: "title", label: "Project" },
          { key: "count", label: "Demands", align: "right" },
          { key: "alloc", label: "Avg / FTE total", align: "right" },
        ],
        rows: stretched.map((x) => {
          const proj = activePmm.find(
            (p) => String(p?.TicketId ?? p?.RecordCode ?? "") === x.tid,
          );
          const avg = x.count ? Math.round(x.sum / x.count) : 0;
          return {
            title: getProjectTitle(proj) || x.tid,
            count: x.count,
            alloc: `avg ${avg}% · ~${(x.sum / 100).toFixed(1)} FTE`,
          };
        }),
        emptyText: "No overloaded teams detected.",
      },
    });
  }

  if (earlyOpmCount > 0) {
    const earlyOpms = opm
      .filter(isOpmEarlyStage)
      .slice()
      .sort((a, b) => getValue(b) - getValue(a));
    decisions.push({
      num: n++,
      category: "DEFER",
      text: `Defer ${Math.min(3, earlyOpmCount)} low-confidence pursuit${earlyOpmCount === 1 ? "" : "s"} · 14D`,
      cta: "Defer",
      tone: "orange",
      detail: {
        title: `Low-confidence pursuits in the pipeline`,
        subtitle: `${earlyOpmCount} early-stage opportunit${earlyOpmCount === 1 ? "y" : "ies"} (Identify/Qualify/ROM)`,
        columns: [
          { key: "title", label: "Opportunity" },
          { key: "client", label: "Client" },
          { key: "stage", label: "Stage" },
          { key: "value", label: "Value", align: "right" },
        ],
        rows: earlyOpms.map((o) => ({
          title: getProjectTitle(o),
          client: String(o?.CRMCompanyLookupName ?? o?.ClientName ?? o?.CompanyName ?? "—"),
          stage: String(o?.CRMProjectStatusChoice ?? o?.Status ?? "—"),
          value: fmtMoney(getValue(o)),
        })),
        emptyText: "No early-stage pursuits.",
      },
    });
  }

  if (decisions.length === 0 && lem.length > 0) {
    const leads = lem.slice();
    decisions.push({
      num: n++,
      category: "QUALIFY",
      text: `Qualify ${lem.length} active LEM lead${lem.length === 1 ? "" : "s"} this week`,
      cta: "Qualify",
      tone: "green",
      detail: {
        title: `Active leads to qualify`,
        subtitle: `${lem.length} active lead${lem.length === 1 ? "" : "s"}`,
        columns: [
          { key: "title", label: "Lead" },
          { key: "client", label: "Client" },
          { key: "value", label: "Value", align: "right" },
        ],
        rows: leads.map((l) => ({
          title: getProjectTitle(l),
          client: String(l?.CRMCompanyLookupName ?? l?.ClientName ?? l?.CompanyName ?? "—"),
          value: fmtMoney(getValue(l)),
        })),
      },
    });
  }
  if (decisions.length === 0) {
    decisions.push({
      num: n++,
      category: "CONFIRM",
      text: `Maintain current staffing posture · forecast nominal`,
      cta: "Confirm",
      tone: "green",
      detail: null,
    });
  }
  const trimmedDecisions = decisions.slice(0, 4);

  // Live-signal pill: total observable drivers = sub-drivers + risks + decisions
  const signalCount =
    subDrivers.length + trimmedRisks.length + trimmedDecisions.length;

  return {
    health,
    healthDetail,
    subDrivers,
    pinned,
    risks: trimmedRisks,
    decisions: trimmedDecisions,
    meta: {
      activePmm: activePmm.length,
      closedPmm: closedPmm.length,
      opmCount: opm.length,
      lemCount: lem.length,
      activeDemands,
      opmValue,
      pmmActiveValue,
      lemValue,
    },
    signalCount,
  };
}
