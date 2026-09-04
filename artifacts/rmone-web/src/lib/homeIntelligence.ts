// Computes the Phase-2 "operational intelligence" home screen entirely from
// real PMM / OPM / LEM / resource demand records returned by the API. No
// hard-coded demo numbers — every value here is a function of the live data.

import { compactUsd } from "./money";
import type { RolePersona } from "./roleResolver";
import { getBusinessRules } from "./businessRules";
import { collapseDemandsToPositions } from "./demandPositions";
import { effStart, effEnd, effStarted } from "./projectDates";
import { windowedPctForResource, type ResourceLike } from "@workspace/alloc-math";

// Drill-down record tables must show the FULL matching set (panels paginate/scroll).
// This is only a runaway-safety cap, never a display subset — headline counts
// always come from the full arrays.
const MAX_DETAIL_ROWS = 500;

/** Pick the largest per-project allocation, preserving the first project on a tie. */
export function highestAllocationTicket(
  projects: readonly { ticket: string; pct: number }[],
): string | null {
  let highest: { ticket: string; pct: number } | null = null;
  for (const project of projects) {
    if (!project.ticket || (highest !== null && project.pct <= highest.pct)) continue;
    highest = project;
  }
  return highest?.ticket ?? null;
}

export type SubDriver = {
  label: string;
  value: number;
  raw?: string;
  /**
   * Short pill label showing which timeframe this metric is computed over,
   * mirroring the picker at the top of the Operational Health card
   * ("30d" / "60d" / "90d" / "6mo"). For drivers that aren't influenced by
   * the forecast-window selector (e.g. Win rate uses annual totals,
   * Proposal coverage all-time totals) this is set to "annual" or
   * "all-time" so the user understands why the picker
   * doesn't change that number.
   */
  windowLabel?: string;
  records?: ActionDetail;
  /** Visual tone for the gauge tile ("good" = green, "warn" = amber). */
  tone?: "good" | "warn";
  /**
   * When false, this sub-driver has no live data feed yet and the UI should
   * render "Not available yet" instead of the (meaningless) numeric value.
   */
  available?: boolean;
  /**
   * Rich "how this number is calculated" detail shown in the KPI drawer for
   * sub-drivers that have been redesigned to match the pixel-exact
   * Firm Health drill-down mock (current reading / formula / impact boxes
   * plus a supporting records table). Sub-drivers without this render the
   * generic What's happening / Why it matters panel instead.
   */
  formulaDetail?: {
    currentReading: string;
    howCalculated: string;
    formula: string;
    /** e.g. "PMM (active book) + OPM (pipeline)" — rendered as DATA SOURCE pills */
    dataSource?: string;
    impact: string;
    tableTitle: string;
    /** Badge label in the current-reading card (default "score"). */
    scoreLabel?: string;
    /** When set, replaces the `valuePct%` badge display (e.g. "5.58×" for a ratio metric). */
    scoreFormatted?: string;
    /** Eyebrow override for this sub-driver (e.g. "FINANCIAL HEALTH · LIVE CALCULATION"). */
    eyebrow?: string;
    /**
     * LIVE DATA stats block rendered after DATA SOURCE. When present, triggers
     * the financial layout: liveData → topTable → Impact → primary table.
     */
    liveData?: {
      title: string;
      /** Optional italic caption rendered below the title (scope note). */
      subtitle?: string;
      rows: {
        label: string;
        value: string;
        /** Always-orange value (non-sortable). Sortable rows get orange only when selected. */
        highlight?: boolean;
        /** When set, this row is clickable and re-sorts the TOP PROJECTS block. */
        sortKey?: string;
        /** Title suffix shown in TOP PROJECTS header when this row is selected. */
        sortTitle?: string;
        /** Pre-formatted grand total for this sort dimension (TOTAL row value). */
        sortTotal?: string;
      }[];
    };
    /**
     * Pre-formatted per-project data for dynamic top-table sorting.
     * Each entry has a display label and per-sortKey numeric + string values.
     */
    projects?: Array<{
      label: string;
      values: Record<string, { raw: number; str: string }>;
    }>;
    /** Static TOP PROJECTS block (fallback when `projects` is absent). */
    topTable?: {
      title: string;
      rows: { label: string; value: string }[];
      total?: string;
      totalValue?: string;
      footnote?: string;
    };
    /** Optional second table rendered below the primary one (classic layout only). */
    secondaryTable?: {
      title: string;
      columns: { key: string; label: string; align?: "left" | "right" }[];
      rows: Record<string, string | number>[];
    };
  };
};
export type RiskItem = {
  level: "CRIT" | "WARN" | "INSIGHT";
  horizon: string;
  text: string;
  detail: string;
  /** Stable driver key ("concentration", "demand-coverage", "over-allocation",
   *  "pipeline", "data-quality", ...) so the UI can explain the risk in
   *  plain language instead of guessing from the title text. */
  kind?: string;
  records?: ActionDetail;
};
export type DetailColumn = { key: string; label: string; align?: "left" | "right"; note?: string };
export type ActionDetail = {
  title: string;
  subtitle?: string;
  columns: DetailColumn[];
  rows: Record<string, string | number>[];
  emptyText?: string;
  /** Optional "Go to issue" deep link attached by the data builder that
   *  knows what category this detail represents (e.g. open demands →
   *  /resources?view=Demand). Rendered as a navigation button in
   *  RiskSidePanel / KpiFormulaPanel footers. */
  goTo?: { to: string; label: string };
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
  /** Persona-specific health-card title, e.g. "Operational Health". */
  healthLabel: string;
  /** Persona-specific status word for the badge, e.g. STABLE / WATCH / TIGHT. */
  statusWord: string;
  /** The persona this intelligence was computed for. */
  role: RolePersona;
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
  // ApproxContractValue is sparsely populated on OPM; fall back to
  // ContractValue / ContractedAmount (some client imports populate ONLY
  // ContractedAmount) then LaborContractAmount / ForecastedProjectCost.
  for (const key of ["ApproxContractValue", "ContractValue", "ContractedAmount", "LaborContractAmount", "ForecastedProjectCost"]) {
    const n = Number(p?.[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}
// OPM-specific value, mirroring mapOPM() in pages/projects.tsx: RM ONE rarely
// has ApproxContractValue (revenue) filled in this early in the pursuit, so
// the project team enters ForecastedProjectCost (internal cost estimate)
// instead. Per user direction (May 2026) ForecastedProjectCost is the
// primary OPM "Value", falling back to ApproxContractValue then
// LaborContractAmount. Keep this in lockstep with mapOPM's `value` field or
// the Pipeline Coverage KPI drifts from the Opps tab's totals again.
function getOpmValue(o: any): number {
  const forecast = Number(o?.ForecastedProjectCost ?? 0);
  if (forecast > 0) return forecast;
  const apx = Number(o?.ApproxContractValue ?? 0);
  if (apx > 0) return apx;
  const cv = Number(o?.ContractValue ?? 0);
  if (cv > 0) return cv;
  const ca = Number(o?.ContractedAmount ?? 0);
  if (ca > 0) return ca;
  return Number(o?.LaborContractAmount ?? 0) || 0;
}
function isClosed(p: any): boolean {
  return p?.Closed === true;
}
function getProjectTitle(p: any): string {
  if (!p) return "";
  const name = (p?.Title ?? "").toString().trim();
  const tid  = (p?.TicketId ?? p?.RecordCode ?? "").toString().trim();
  if (tid && name && name !== tid) return `${tid} · ${name}`;
  return name || tid || (p?.Code ?? p?.ItemKey ?? "").toString().trim();
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
// Mirrors OPM_CLOSED in pages/projects.tsx so "open opportunities" here means
// the same set of records the Opps tab shows under "All Open" (excludes
// Cancelled/Lost/Declined/Dead; "Awarded" opportunities stay counted as open
// pipeline until they're converted, matching the Opps list behavior).
const OPM_CLOSED_STAGES = new Set(["Cancelled", "Lost", "Declined", "Dead"]);
// Stage priority mirrors the `stage` derivation in pages/projects.tsx exactly
// (CRMOpportunityStatusChoice || CRMOpportunityStageChoice || Status || ModuleStepLookup)
// so "closed" and "decided" checks here never disagree with what the Opps list shows.
// CRMOpportunityStageChoice is also checked because some tenants write Awarded/Lost
// into that column instead of (or in addition to) CRMOpportunityStatusChoice.
function opmStageOf(o: any): string {
  return String(o?.CRMOpportunityStatusChoice ?? o?.CRMOpportunityStageChoice ?? o?.Status ?? o?.ModuleStepLookup ?? "").trim();
}
function isOpmClosed(o: any): boolean {
  if (o?.Closed === true) return true;
  const s = opmStageOf(o);
  return OPM_CLOSED_STAGES.has(s);
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
// Attaches the real TicketId to a row object so chat prompts can reference it
// without guessing. Intentionally absent from 'columns' arrays so it stays
// invisible in the UI table but appears in the AI-sent rowSummary string.
const ticketOf = (p: any): string => String(p?.TicketId ?? p?.RecordCode ?? '').trim();

function fmtHrs(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K hrs`;
  return `${sign}${Math.round(abs)} hrs`;
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
// Effective dates (client rule: phase schedule wins — first phase start / last
// phase end — with Target dates only as the no-schedule fallback; see
// lib/projectDates). ISO-string variants feed the string-based fmtDate.
const effEndStr = (p: any): string | null => effEnd(p)?.toISOString() ?? null;
const effStartStr = (p: any): string | null => effStart(p)?.toISOString() ?? null;

// Weekly demand rows → unique positions: the canonical collapse logic lives
// in lib/demandPositions.ts (shared with the Daily Briefing) so every surface
// counts open demand the same way.
function baseRole(role: string): string {
  const s = String(role ?? "");
  return s.replace(/\s*\(\d+\)\s*$/, "").trim() || s;
}

// Sentinel windowDays value meaning "no date window at all" — aggregate
// every record in the tenant regardless of target/completion/allocation
// dates. Large enough (~100 years) that all real-world dates fall inside
// the horizon, so the existing date-range math below "just works" without
// needing Infinity/NaN special-casing in every branch.
export const ALL_TIME_DAYS = 36500;

export function buildHomeIntelligence(
  rawPmm: any[],
  rawOpm: any[],
  rawLem: any[],
  rawDemands: any[],
  windowDays: number = 30,
  role: RolePersona = "COO",
  alloc?: {
    total?: number;
    bench?: number;
    resources?: Array<{ name?: string; currentPct?: number; allProjectIds?: string[] }>;
  } | null,
): HomeIntelligence {
  const pmm = Array.isArray(rawPmm) ? rawPmm : [];
  const opm = Array.isArray(rawOpm) ? rawOpm : [];
  const lem = Array.isArray(rawLem) ? rawLem : [];
  // Collapse per-week demand rows into distinct positions before any counting
  // or FTE summing (see collapseDemandsToPositions). Every downstream metric
  // — role load, project load, pinned critical, risk feed, decisions — then
  // operates on real positions instead of weekly slices.
  const demands = collapseDemandsToPositions(Array.isArray(rawDemands) ? rawDemands : []);
  // Hoisted early so COO sub-drivers can build the full allocation table.
  // Every resource's currentPct is rewritten to its WINDOWED load over the
  // home screen's selected window (today → +windowDays) using the shared
  // math in lib/alloc-math — the feed's raw currentPct means "allocated
  // TODAY", which reads ~0% when weekly rows live in the past/future.
  const hiRules = getBusinessRules();
  const hiWinStartMs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const hiWinEndMs = hiWinStartMs + (Math.max(1, Math.round(windowDays)) - 1) * 86400000;
  const rawAllocResources = Array.isArray(alloc?.resources) ? alloc!.resources : [];
  const allAllocResources = rawAllocResources.map((r) => ({
    ...r,
    currentPct: windowedPctForResource(
      r as unknown as ResourceLike,
      hiWinStartMs,
      hiWinEndMs,
      hiRules.workWeekHours,
    ),
  }));
  // When the allocation feed failed to load (alloc == null), staffedTids is
  // empty — NOT because projects are unstaffed, but because we don't know.
  // Every "N projects with no staffing data" signal must be suppressed in
  // that state or a transient fetch failure paints the whole portfolio as
  // an unstaffed crisis (the "831 active projects with no staffing data" bug).
  const allocFeedOk = alloc != null;

  // Projects that already have people assigned (from the resources feed's
  // per-resource project lists). Demand rows only represent OPEN (unfilled)
  // positions, so a fully staffed project legitimately has ZERO demand rows —
  // it must NOT be flagged as "no staffing data". A project counts as covered
  // when it has EITHER open-demand rows OR at least one assigned team member.
  const staffedTids = new Set<string>();
  for (const r of allAllocResources) {
    const ids = Array.isArray((r as any)?.allProjectIds) ? (r as any).allProjectIds : [];
    for (const id of ids) {
      const t = String(id ?? "").trim().toLowerCase();
      if (t) staffedTids.add(t);
    }
  }
  const isStaffed = (tid: string) =>
    staffedTids.has(String(tid ?? "").trim().toLowerCase());

  // Project name lookup keyed by TicketId — resolves project names for demand
  // rows whose own Title field is blank (ResourceAllocation.Title is often empty).
  const projectNameByTid = new Map<string, string>();
  for (const p of [...pmm, ...opm]) {
    const tid = String(p?.TicketId ?? "").trim();
    const name = String(p?.Title ?? "").trim();
    if (tid && name) projectNameByTid.set(tid, name);
  }
  function demandProjectName(d: any): string {
    const tid  = String(d?.TicketId ?? "").trim();
    const name = (projectNameByTid.get(tid) || String(d?.Title ?? "")).trim();
    if (tid && name && name !== tid) return `${tid} · ${name}`;
    return name || tid || "—";
  }
  // Hidden ticket marker for demand rows — lets the drill-down panel derive
  // a record-level "Open <project>" link when the user selects the row
  // (issueLink.deriveRowLink validates it against the strict ticket regex).
  const demandTicket = (d: any): string => String(d?.TicketId ?? "").trim();
  // The backing ResourceAllocation ID identifies this exact demand row. It is
  // intentionally carried as a hidden table field so the alert panel can fill
  // the chosen position without guessing from a role/title label.
  const demandRaId = (d: any): number | null => {
    const value = Number(d?.RaId ?? d?.RAId ?? d?.AllocationId);
    return Number.isInteger(value) && value > 0 ? value : null;
  };

  // Human-readable label for the chosen forecast window, used in modal
  // subtitles and empty-state copy. Reads naturally as "30 days" /
  // "60 days" / "90 days" / "6 months" to match product language.
  // ALL_TIME_DAYS means the whole tenant's data with no date cutoff.
  const isAllTime = windowDays >= ALL_TIME_DAYS;
  // The home screen has no date-window selector — every persona always
  // aggregates the whole tenant. These labels are kept only for the rare
  // leftover template that still needs a duration noun (isAllTime is
  // always true in production; the dated branches only matter if this
  // function is ever called with a real windowDays again).
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
  // Natural-language equivalents used in all display-facing text so labels
  // read as "this week / this month / next 60 days / this quarter" rather
  // than the raw chip key ("7D / 30D / 60D / 90D"). Portfolio-wide replaces
  // any mention of a time window since the home screen is date-agnostic.
  const winNatUpper =
    isAllTime ? "PORTFOLIO-WIDE" :
    windowDays === 7 ? "THIS WEEK" :
    windowDays === 30 ? "THIS MONTH" :
    windowDays === 60 ? "NEXT 60 DAYS" :
    windowDays === 90 ? "THIS QUARTER" : windowShortUpper;
  const winNatProse =
    isAllTime ? "across your entire portfolio" :
    windowDays === 7 ? "this week" :
    windowDays === 30 ? "this month" :
    windowDays === 60 ? "next 60 days" :
    windowDays === 90 ? "this quarter" : windowLabel;

  const activePmm = pmm.filter((p) => p && !isClosed(p));
  const closedPmm = pmm.filter((p) => p && isClosed(p));

  const pmmActiveValue = activePmm.reduce((s, p) => s + getValue(p), 0);
  const opmValue = opm.reduce((s, o) => s + getValue(o), 0);
  const lemValue = lem.reduce((s, l) => s + getValue(l), 0);
  // Window-weighted OPM pipeline value: each opportunity contributes proportionally
  // to how much of its remaining time falls inside the window (same share logic as
  // the financial cost projection). Overdue/no-date = counted fully/half.
  const nowMs = Date.now();
  const windowEndMs = nowMs + windowDays * 86400000;
  let winOpmValue = 0;
  for (const o of opm) {
    const val = getValue(o);
    if (val <= 0) continue;
    const dEff = effEnd(o);
    if (!dEff) { winOpmValue += val * 0.5; continue; }
    const ms = dEff.getTime();
    const remainingMs = Math.max(0, ms - nowMs);
    const share = remainingMs <= 0 ? 1 : Math.min(1, (windowDays * 86400000) / remainingMs);
    winOpmValue += val * share;
  }
  // Keep winOpm array for display rows (show all OPM sorted by value)
  const winOpm = opm.slice().sort((a, b) => getValue(b) - getValue(a));

  // Bucket demands by project + by role — ALL-TIME, no date-window filter.
  // Pinned Critical / Risk Feed / Decision Support must show the whole
  // portfolio's demand picture regardless of the 7D/30D/60D/90D selector;
  // that selector only scopes the Operational Health sub-drivers (staffing
  // balance, utilization stability, delivery exposure, capacity primitives),
  // which use the separate `winDemandsByProject` / `winDemandsByRole` buckets.
  const demandsByProject: Record<string, any[]> = {};
  const demandsByRole: Record<string, any[]> = {};
  let activeDemands = 0;
  for (const d of demands) {
    if (!d) continue;
    activeDemands++;
    const tid = String(d?.TicketId ?? "");
    if (tid) (demandsByProject[tid] ??= []).push(d);
    const role = baseRole(String(d?.Role ?? "Unassigned").trim() || "Unassigned");
    (demandsByRole[role] ??= []).push(d);
  }
  // Windowed variants — used ONLY by the Operational Health sub-driver
  // calculations below.
  const winDemandsByProject: Record<string, any[]> = {};
  const winDemandsByRole: Record<string, any[]> = {};
  let winActiveDemands = 0;
  let winTotalAlloc = 0;
  for (const d of demands) {
    if (!d || !inForecastWindow(d, windowDays)) continue;
    winActiveDemands++;
    winTotalAlloc += Number(d?.PctAllocation) || 0;
    const tid = String(d?.TicketId ?? "");
    if (tid) (winDemandsByProject[tid] ??= []).push(d);
    const role = baseRole(String(d?.Role ?? "Unassigned").trim() || "Unassigned");
    (winDemandsByRole[role] ??= []).push(d);
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

  // Projects completing within the selected window — needed by propCoverage below.
  // The full COO window block reuses this variable; it is NOT redeclared there.
  const projectsClosingInWindow = activePmm
    .filter((p) => {
      const d = effEnd(p);
      if (!d) return false;
      const ms = d.getTime();
      // All-time mode also counts already-overdue projects — no date is
      // excluded, per the "entire tenant, irrespective of dates" behavior.
      return (isAllTime || ms >= nowMs) && ms <= windowEndMs;
    })
    .sort((a, b) => (effEnd(a)?.getTime() ?? 0) - (effEnd(b)?.getTime() ?? 0));
  const closingValue = projectsClosingInWindow.reduce((s, p) => s + getValue(p), 0);

  // Proposal coverage — window-sensitive pipeline-share metric.
  // Score = winOpmValue / (winOpmValue + closingValue) × 100.
  //   • closingValue grows as window expands (more projects closing) → score falls.
  //   • winOpmValue is roughly constant (OPMs mostly lack close dates → 50% weight).
  //   • No closing projects → falls back to run-rate formula.
  // This guarantees visible change across 7D/30D/60D/90D without fabricating data.
  // `target` (run-rate) is kept unchanged for pipelineGap / Risk Feed text below.
  // NOTE: this is the risk-feed "pipeline replenishment" signal — new pipeline
  // vs revenue closing out in the window. It is deliberately DIFFERENT from
  // the COO "Proposal coverage" tile, which is the all-time booked share
  // (pmmActiveValue ÷ open pipeline, see cooCovPct). Risk-feed wording must
  // say "replenishment", never plain "coverage", so the two are never confused.
  const target = pmmActiveValue * 0.25;
  const propCoverage = closingValue > 0
    ? Math.round(clamp((winOpmValue / (winOpmValue + closingValue)) * 100, 0, 100))
    : target > 0
      ? Math.round(clamp((winOpmValue / target) * 100, 0, 100))
      : winOpmValue > 0 ? 80 : 50;
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
  const coverageRecords = winOpm
    .filter((o) => !isOpmClosed(o))
    .slice()
    .sort((a, b) => getOpmValue(b) - getOpmValue(a));
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

  // ---- COO window-scoped sub-driver inputs ----
  // projectsClosingInWindow and closingValue are declared above (before propCoverage)
  // so that propCoverage can use closing revenue as its window-sensitive target.
  // ── COO sub-driver scores ──────────────────────────────────────────────────
  // Each tile's score IS the simple ratio its formula card documents, computed
  // from the same inputs the drill-down tables list — so the number on the
  // tile, the formula chain, and the tables always agree. currentPct is
  // already windowed (see allAllocResources above), so the people-based
  // scores follow the selected forecast window.
  // Staffing balance: share of resources with any active assignment.
  const cooAllocatedList = allAllocResources.filter((r) => Number(r?.currentPct ?? 0) > 0);
  const cooTotalRes = allAllocResources.length;
  const cooAllocPct = cooTotalRes > 0
    ? Math.round((cooAllocatedList.length / cooTotalRes) * 100)
    : 0;
  // Utilization stability: 100 − share of allocated people at/over the
  // over-capacity threshold (same definition as the Executive persona's
  // Workforce Health card, so the two personas always agree).
  const cooOverloadedList = allAllocResources.filter(
    (r) => Number(r?.currentPct ?? 0) >= hiRules.overCapacityPct,
  );
  const cooOverloadedPct = cooAllocatedList.length > 0
    ? Math.round((cooOverloadedList.length / cooAllocatedList.length) * 100)
    : 0;
  const cooUtilScore = 100 - cooOverloadedPct;
  // Proposal coverage: share of the open pipeline already converted into
  // signed active work (all-time totals — deliberately window-independent).
  const cooOpenOpps = opm.filter((o) => !isOpmClosed(o));
  const cooTotalPipeline = cooOpenOpps.reduce((s, o) => s + getOpmValue(o), 0);
  const cooCovPct = cooTotalPipeline > 0
    ? Math.round(clamp((pmmActiveValue / cooTotalPipeline) * 100, 0, 999))
    : 0;
  // Closing projects with no demand rows and no staffed team — feeds the
  // "staffing blind spot" risk item and its recommended action below.
  const cooClosingNoStaffing = projectsClosingInWindow.filter((p) => {
    const tid = String(p?.TicketId ?? p?.RecordCode ?? "");
    return !tid || (!demandsByProject[tid] && !isStaffed(tid));
  });
  const cooUntrackedClosing = cooClosingNoStaffing.length;

  const cooSubDrivers: SubDriver[] = [
    {
      label: "Staffing balance",
      value: cooAllocPct,
      available: allocFeedOk,
      raw: !allocFeedOk
        ? "Staffing feed unavailable"
        : `${cooAllocatedList.length} of ${cooTotalRes} on active assignments`,
      windowLabel: windowShort,
      formulaDetail: (() => {
        const rules = getBusinessRules();
        const cooAllocated = cooAllocatedList;
        const cooTotal = cooTotalRes;
        const cooCapacityPct = 100 - cooAllocPct;
        const tierLabel = (pct: number): string => {
          if (pct >= rules.overCapacityPct)       return "Overloaded";
          if (pct >= rules.targetUtilizationPct)  return "Optimal";
          if (pct >  rules.underAllocatedPct)     return "Active";
          if (pct >  0)                           return "Under-used";
          return "Bench";
        };
        const cooUnallocated = allAllocResources.filter((r) => Number(r?.currentPct ?? 0) === 0);
        return {
          currentReading: `${cooAllocated.length} of ${cooTotal} people currently on active assignments (projects, pursuits & other) (${cooCapacityPct}% capacity available)`,
          howCalculated: `Measures the percentage of available resources with an active RM ONE assignment (projects, pursuits, or other work). A healthy staffing balance minimises idle capacity while avoiding widespread overallocation.`,
          formula: `Allocated Resources ÷ Total Available Resources × 100 = ${cooAllocated.length} ÷ ${cooTotal} × 100 = ${cooAllocPct}%`,
          impact: [
            cooAllocPct >= 75
              ? `${cooAllocPct}% of available resources are on active assignments — staffing balance is healthy.`
              : cooAllocPct >= 50
                ? `${cooAllocPct}% of available resources are on active assignments, leaving ${cooCapacityPct}% available capacity. Review unallocated resources and align them with upcoming demand to improve utilisation.`
                : `Staffing balance is critical — ${cooCapacityPct}% of the workforce is unallocated. Immediate action is required to align resources with active project demand.`,
          ].join("\n"),
          tableTitle: `ALLOCATED RESOURCES · ${cooAllocated.length} OF ${cooTotal}`,
          secondaryTable: cooUnallocated.length > 0 ? {
            title: `UNALLOCATED RESOURCES · ${cooUnallocated.length} OF ${cooTotal}`,
            columns: [
              { key: "person", label: "Person" },
              { key: "status", label: "Status" },
              { key: "allocation", label: "Allocation", align: "right" as const, note: "How much of this person's working time is booked — 50% means half their week is assigned" },
            ],
            rows: cooUnallocated
              .slice()
              .sort((a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? "")))
              .map((r) => ({
                person: String(r?.name ?? "—"),
                status: "Bench",
                allocation: "0%",
              })),
          } : undefined,
        };
      })(),
      records: (() => {
        const rules = getBusinessRules();
        const tierLabel = (pct: number): string => {
          if (pct >= rules.overCapacityPct)       return "Overloaded";
          if (pct >= rules.targetUtilizationPct)  return "Optimal";
          if (pct >  rules.underAllocatedPct)     return "Active";
          if (pct >  0)                           return "Under-used";
          return "Bench";
        };
        const allocatedOnly = allAllocResources.filter((r) => Number(r?.currentPct ?? 0) > 0);
        return {
          title: `Allocated Resources · ${allocatedOnly.length} of ${allAllocResources.length}`,
          subtitle: `${allocatedOnly.length} on active assignments · sorted by allocation`,
          columns: [
            { key: "person",     label: "Person" },
            { key: "status",     label: "Status" },
            { key: "allocation", label: "Allocation", align: "right" as const, note: "How much of this person's working time is booked — 50% means half their week is assigned" },
          ],
          rows: [...allocatedOnly]
            .sort((a, b) => Number(b?.currentPct ?? 0) - Number(a?.currentPct ?? 0))
            .map((r) => {
              const pct = Math.round(Number(r?.currentPct ?? 0));
              return {
                person:     String(r?.name ?? "—"),
                status:     tierLabel(pct),
                allocation: `${pct}%`,
              };
            }),
          emptyText: "No allocated resources found.",
        };
      })(),
    },
    {
      label: "Utilization stability",
      value: cooUtilScore,
      available: allocFeedOk,
      raw: !allocFeedOk
        ? "Staffing feed unavailable"
        : `${cooOverloadedList.length} of ${cooAllocatedList.length} allocated at ≥${hiRules.overCapacityPct}% load`,
      windowLabel: windowShort,
      formulaDetail: (() => {
        const rules = getBusinessRules();
        const utilAllocated = cooAllocatedList;
        const utilOverloaded = cooOverloadedList;
        const overloadedPct = cooOverloadedPct;
        const tierLabel = (pct: number): string => {
          if (pct >= rules.overCapacityPct)       return "Overloaded";
          if (pct >= rules.targetUtilizationPct)  return "Optimal";
          if (pct >  rules.underAllocatedPct)     return "Active";
          if (pct >  0)                           return "Under-used";
          return "Bench";
        };
        const allAllocSorted = [...allAllocResources]
          .filter((r) => Number(r?.currentPct ?? 0) > 0)
          .sort((a, b) => Number(b?.currentPct ?? 0) - Number(a?.currentPct ?? 0));
        return {
          currentReading: `${utilOverloaded.length} of ${utilAllocated.length} allocated resources are at or above ${rules.overCapacityPct}% (Overloaded) right now (${overloadedPct}% overloaded)`,
          howCalculated: `Measures the percentage of active resources operating within planned capacity. A higher score indicates balanced workloads with minimal resource overallocation, reducing delivery risk.`,
          formula: `100 − (Overloaded ≥${rules.overCapacityPct}% ÷ Allocated (>0%) × 100) = 100 − (${utilOverloaded.length} ÷ ${utilAllocated.length} × 100) = 100 − ${overloadedPct}% = ${cooUtilScore}%`,
          impact: utilOverloaded.length === 0
            ? `${cooUtilScore}% of allocated resources are operating within planned capacity limits. No overloaded staff — workload is well-distributed across the team.`
            : cooUtilScore >= 75
              ? `${cooUtilScore}% of allocated resources are operating within planned capacity limits. Only ${utilOverloaded.length} of ${utilAllocated.length} allocated ${utilOverloaded.length === 1 ? "person is" : "people are"} Overloaded (≥${rules.overCapacityPct}%) — workload is well-distributed across the team.`
              : `${utilOverloaded.length} of ${utilAllocated.length} allocated staff are overloaded (≥${rules.overCapacityPct}%). Review workload distribution to reduce delivery risk.`,
          tableTitle: "RESOURCES EXCEEDING CAPACITY",
          secondaryTable: {
            title: "ALL ALLOCATED RESOURCES · CURRENT ALLOCATION",
            columns: [
              { key: "person",     label: "Person" },
              { key: "status",     label: "Status" },
              { key: "allocation", label: "Allocation", align: "right" as const, note: "How much of this person's working time is booked — 50% means half their week is assigned" },
            ],
            rows: allAllocSorted.map((r) => {
              const pct = Math.round(Number(r?.currentPct ?? 0));
              return { person: String(r?.name ?? "—"), status: tierLabel(pct), allocation: `${pct}%` };
            }),
          },
        };
      })(),
      records: (() => {
        const rules = getBusinessRules();
        const utilOverloaded = allAllocResources.filter((r) => Number(r?.currentPct ?? 0) >= rules.overCapacityPct);
        return {
          title: "Resources Exceeding Capacity",
          subtitle: `${utilOverloaded.length} staff at or above ${rules.overCapacityPct}%`,
          columns: [
            { key: "person",     label: "Person" },
            { key: "allocation", label: "Allocation", align: "right" as const, note: "How much of this person's working time is booked — 50% means half their week is assigned" },
          ],
          rows: [...utilOverloaded]
            .sort((a, b) => Number(b?.currentPct ?? 0) - Number(a?.currentPct ?? 0))
            .map((r) => ({
              person:     String(r?.name ?? "—"),
              allocation: `${Math.round(Number(r?.currentPct ?? 0))}%`,
            })),
          emptyText: `No staff are currently overloaded (≥${rules.overCapacityPct}%).`,
        };
      })(),
    },
    {
      label: "Proposal coverage",
      value: Math.min(cooCovPct, 100),
      raw: `${fmtMoney(pmmActiveValue)} of ${fmtMoney(cooTotalPipeline)} pipeline booked`,
      windowLabel: "all-time",
      formulaDetail: (() => {
        const openOpps = cooOpenOpps;
        const totalPipeline = cooTotalPipeline;
        const activeBook = pmmActiveValue;
        const covPct = cooCovPct;
        return {
          currentReading: `${fmtMoney(activeBook)} of ${fmtMoney(totalPipeline)} total pipeline already booked · ${covPct}% covered`,
          howCalculated: `What share of the potential work currently being pursued has already turned into signed, active work. Both sides are all-time, firm-wide totals, so this reading is stable and doesn't move just because you change the time window. There's no fixed target since we don't track a sales quota, but if the active book ever exceeds the pipeline, that's an early warning to submit more proposals or improve win rates before existing work runs out.`,
          formula: `Active Project Book (PMM) ÷ Open Opportunity Pipeline (OPM) × 100 = ${fmtMoney(activeBook)} ÷ ${fmtMoney(totalPipeline)} × 100 = ${covPct}%${covPct > 100 ? " (gauge capped at 100%)" : ""}`,
          dataSource: "PMM (active book) + OPM (pipeline)",
          impact: `${fmtMoney(activeBook)} of ${fmtMoney(totalPipeline)} total pipeline already booked · ${covPct}% covered. This is simply the share of the firm's total pipeline of bids and proposals that has already converted into active, signed work — there's no fixed target since RM ONE has no sales-quota field. Watch for this approaching 100%, which would mean the active book is catching up to the entire known pipeline.`,
          tableTitle: `OPEN PIPELINE (OPM) · ${openOpps.length} OPPORTUNIT${openOpps.length === 1 ? "Y" : "IES"} · TOTAL ${fmtMoney(totalPipeline)}`,
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
        subtitle: `${coverageRecords.length} open opportunit${coverageRecords.length === 1 ? "y" : "ies"} · ${fmtMoney(coverageRecords.reduce((s, o) => s + getOpmValue(o), 0))} pipeline`,
        columns: [
          { key: "title",  label: "Opportunity" },
          { key: "client", label: "Client" },
          { key: "stage",  label: "Stage" },
          { key: "value",  label: "Value", align: "right" },
        ],
        rows: coverageRecords.map((o) => ({
          _ticket: ticketOf(o),
          title:  getProjectTitle(o),
          client: String(o?.CRMCompanyLookupName ?? o?.ClientName ?? o?.CompanyName ?? "—"),
          stage:  String(o?.CRMProjectStatusChoice ?? o?.Status ?? "—"),
          value:  fmtMoney(getOpmValue(o)),
        })),
        emptyText: "No opportunities in the pipeline.",
      },
    },
    {
      label: "Demand-data coverage",
      // When the allocation feed failed, coverage cannot be measured (team
      // assignments are invisible) — mark unavailable rather than show a
      // falsely low percentage.
      value: deliveryExposure,
      available: allocFeedOk,
      raw: !allocFeedOk
        ? "Staffing feed unavailable"
        : `${projectsWithDemand} of ${activePmm.length} active projects with staffing data`,
      windowLabel: windowShort,
      formulaDetail: (() => {
        const total = activePmm.length;
        // Same inputs as deliveryExposure (window-scoped demands OR staffed),
        // so the formula chain lands exactly on the tile value.
        const withDemandRecords = activePmm
          .filter((p) => {
            const tid = String(p?.TicketId ?? p?.RecordCode ?? "");
            return !!tid && (!!winDemandsByProject[tid] || isStaffed(tid));
          })
          .slice()
          .sort((a, b) => getValue(b) - getValue(a));
        const withoutDemandRecords = activePmm
          .filter((p) => {
            const tid = String(p?.TicketId ?? p?.RecordCode ?? "");
            return !tid || (!winDemandsByProject[tid] && !isStaffed(tid));
          })
          .slice()
          .sort((a, b) => getValue(b) - getValue(a));
        const withDemand = withDemandRecords.length;
        const without = withoutDemandRecords.length;
        const demandScore = total > 0 ? Math.round((withDemand / total) * 100) : 100;
        return {
          currentReading: `${withDemand} of ${total} active projects have staffing data on file (team members or open demands) · ${demandScore}% covered`,
          howCalculated: `Measures what share of the active project portfolio has staffing data attached — either assigned team members or an open resource demand (staffing request). Projects with neither cannot be staffed proactively, increasing delivery risk and last-minute hiring pressure.`,
          formula: `Projects with Staffing Data ÷ Active Projects × 100 = ${withDemand} ÷ ${total} × 100 = ${demandScore}%`,
          dataSource: "PMM + Resource Demands + Team Assignments",
          impact: without === 0
            ? `All ${total} active projects have team members or a documented resource demand on file. Staffing coverage is complete — no gaps detected.`
            : `Only ${withDemand} of ${total} active projects have team members or a documented resource demand. Staffing cannot be forecast reliably across most of the portfolio, increasing the risk of last-minute staffing decisions and delivery delays. Immediate staffing planning is recommended.`,
          tableTitle: `PROJECTS WITH STAFFING DATA · ${withDemandRecords.length} OF ${total}`,
          secondaryTable: {
            title: `PROJECTS WITHOUT STAFFING DATA · ${withoutDemandRecords.length} OF ${total}`,
            columns: [
              { key: "project", label: "Project" },
              { key: "client",  label: "Client" },
              { key: "due",     label: "End Date", align: "right" as const },
              { key: "value",   label: "Value", align: "right" as const },
            ],
            rows: withoutDemandRecords.map((p) => ({
              _ticket: ticketOf(p),
              project: getProjectTitle(p),
              client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
              due: fmtDate(effEndStr(p)),
              value: fmtMoney(getValue(p)),
            })),
          },
        };
      })(),
      records: {
        title: `Demand-data coverage · projects with staffing data · ${projectsWithDemand} of ${activePmm.length}`,
        subtitle: `${projectsWithDemand} of ${activePmm.length} active projects have team members or a resource demand record`,
        columns: [
          { key: "title", label: "Project" },
          { key: "client", label: "Client" },
          { key: "due", label: "End Date", align: "right" },
          { key: "value", label: "Value", align: "right" },
        ],
        rows: activePmm
          .filter((p) => {
            const tid = String(p?.TicketId ?? p?.RecordCode ?? "");
            return !!tid && (!!demandsByProject[tid] || isStaffed(tid));
          })
          .sort((a, b) => getValue(b) - getValue(a))
          .map((p) => ({
            _ticket: ticketOf(p),
            title: getProjectTitle(p),
            client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
            due: fmtDate(effEndStr(p)),
            value: fmtMoney(getValue(p)),
          })),
        emptyText: `No active projects have staffing data on file.`,
      },
    },
  ];

  // ---- Role-specific sub-drivers (live where computable) ----
  // The four COO operational drivers above are the live operational metrics.
  // Other personas reuse a subset and add their own; any metric that has no
  // live data feed yet is emitted with `available: false` so the UI shows
  // "Not available yet" instead of a fabricated number. COO is unchanged.
  const [cooStaffing, , cooProposal, cooDelivery] = cooSubDrivers;

  const naSub = (label: string): SubDriver => ({
    label,
    value: 0,
    available: false,
    raw: "Not available yet",
  });

  // Bench coverage (Resource Manager). Live from the org-wide allocation feed
  // (getResourceAllocations): bench = people with 0% current allocation. This
  // is a point-in-time snapshot, not windowed. Score is "higher = healthier"
  // like every other sub-driver, so we report it as the share of the workforce
  // that is engaged (100 - idle%); a large idle bench drags the score down.
  // Over-allocation is captured separately by "Overload roles", so this slot
  // focuses purely on the idle/waste side. When the allocation feed is absent
  // the slot stays honestly "Not available yet" (available:false).
  const benchTotal = Math.max(0, Number(alloc?.total) || 0);
  // Windowed bench, not the server's "allocated today" bench count — a
  // person with zero load across the selected window is on the bench.
  const benchCount = allAllocResources.length
    ? allAllocResources.filter((r) => Number(r?.currentPct ?? 0) <= 0).length
    : Math.max(0, Number(alloc?.bench) || 0);
  const benchAvailable = benchTotal > 0;
  const benchIdlePct = benchAvailable
    ? Math.round((benchCount / benchTotal) * 100)
    : 0;
  const benchScore = benchAvailable ? clamp(100 - benchIdlePct, 0, 100) : 0;
  const benchResourcesList = allAllocResources.filter(
    (r) => Number(r?.currentPct ?? 0) <= 0,
  );
  const benchRecords: ActionDetail = benchAvailable
    ? {
        title: "Bench coverage · people with no current allocation",
        subtitle: `${benchCount} of ${benchTotal} ${benchTotal === 1 ? "person is" : "people are"} on the bench (0% allocated)`,
        columns: [
          { key: "name", label: "Name" },
          { key: "pct", label: "Allocation", align: "right", note: "How much of this person's working time is booked — 50% means half their week is assigned" },
        ],
        rows: benchResourcesList
          .slice(0, MAX_DETAIL_ROWS)
          .map((r) => ({
            name: String(r?.name ?? "—"),
            pct: `${Math.round(Number(r?.currentPct ?? 0))}%`,
          })),
        emptyText: "No one is on the bench.",
      }
    : null;
  const benchSub: SubDriver = {
    label: "Bench coverage",
    value: benchScore,
    available: benchAvailable,
    raw: benchAvailable
      ? `${benchCount} of ${benchTotal} on bench (${benchIdlePct}% idle)`
      : "Not available yet",
    records: benchAvailable ? benchRecords : undefined,
  };

  // Capacity primitives (Resource Manager). Higher score = fewer overloaded
  // roles. Derived from the windowed demand-by-role buckets so this tracks
  // the forecast-window selector along with the other sub-drivers.
  const roleLoadEntries = Object.entries(winDemandsByRole).map(([r, arr]) => ({
    role: r,
    sum: arr.reduce((s, d) => s + (Number(d?.PctAllocation) || 0), 0),
    count: arr.length,
  }));
  const overloadRoleCount = roleLoadEntries.filter((r) => r.sum >= hiRules.overCapacityPct).length;
  const totalRoleCount = roleLoadEntries.length;
  const overloadRolesScore =
    totalRoleCount > 0
      ? Math.round(clamp(100 - (overloadRoleCount / totalRoleCount) * 120, 0, 100))
      : null;
  const exposedNow = activePmm.length - projectsWithDemand;

  // Window-projected bench + overload (Resource Manager).
  // Uses activeAllocations per resource to project who is engaged vs idle
  // inside the selected forecast window — so the values vary across 7D/30D/60D/90D.
  // allAllocResources is hoisted above cooSubDrivers — see top of function.
  const windowStartDate = new Date(nowMs);
  const windowEndDate = new Date(windowEndMs);
  const allocOverlapsWindow = (a: any): boolean => {
    const s = a?.startDate ? new Date(a.startDate) : null;
    const e = a?.endDate ? new Date(a.endDate) : null;
    if (s && s > windowEndDate) return false;
    if (e && e < windowStartDate) return false;
    return true;
  };
  // Use allAllocations (includes future bookings) so that resources staffed onto
  // projects starting in Aug/Sep appear active in 60D/90D but not in 7D/30D.
  const resourcesActiveInWindow = allAllocResources.filter((r) => {
    const rr = r as Record<string, unknown>;
    const allocArr =
      (rr.allAllocations as unknown[] | undefined) ??
      (rr.activeAllocations as unknown[] | undefined) ??
      [];
    return allocArr.some(allocOverlapsWindow);
  });
  const benchInWindowCount = allAllocResources.length - resourcesActiveInWindow.length;
  const winBenchAvailable = allAllocResources.length > 0;
  const winBenchScore = winBenchAvailable
    ? clamp(100 - Math.round((benchInWindowCount / allAllocResources.length) * 100), 0, 100)
    : benchScore;
  const winBenchIdlePct = winBenchAvailable
    ? Math.round((benchInWindowCount / allAllocResources.length) * 100)
    : benchIdlePct;
  const overloadedInWindow = resourcesActiveInWindow.filter(
    (r) => Number(r?.currentPct ?? 0) >= hiRules.overCapacityPct,
  );
  const winOverloadCount = overloadedInWindow.length;
  const winActiveCount = resourcesActiveInWindow.length;
  // People with NO window-overlapping allocation — the "bench" for the
  // selected window. Distinct from benchResourcesList (currentPct===0)
  // which is the all-time snapshot; this set uses the same window filter
  // that drives winBenchScore so the records always match the headline.
  const winBenchResList = allAllocResources.filter((r) => {
    const rr = r as Record<string, unknown>;
    const allocArr =
      (rr.allAllocations as unknown[] | undefined) ??
      (rr.activeAllocations as unknown[] | undefined) ??
      [];
    return !allocArr.some(allocOverlapsWindow);
  });
  const winOverloadScore = winBenchAvailable
    ? Math.round(clamp(100 - (winOverloadCount / Math.max(1, winActiveCount)) * 120, 0, 100))
    : (overloadRolesScore ?? 0);

  // Open demand positions in this window (RM staffing-gap view).
  // Include all positions that are active/needed in [today, today+N]:
  //   - Not yet expired (end >= today)
  //   - Has already started OR starts within the window
  // Window-sensitivity comes from the SCORE below: positions expiring
  // sooner contribute more urgency pressure in shorter windows.
  const winDemandsRaw = demands.filter((d) => {
    const s = d?.AllocationStartDate ? new Date(d.AllocationStartDate) : null;
    const e = d?.AllocationEndDate ? new Date(d.AllocationEndDate) : null;
    if (e && e < windowStartDate) return false; // already expired
    if (s && s > windowEndDate) return false;   // starts beyond this window
    return true;
  });
  const winDemandPositions = collapseDemandsToPositions(winDemandsRaw);
  const openPositionCount = winDemandPositions.length;
  const openPosBaseCount = allAllocResources.length || alloc?.total || 1;
  // Score = staffing coverage: what share of the TOTAL need (current
  // headcount + open positions) is actually filled.
  //   coverage = Headcount ÷ (Headcount + Open Roles) × 100
  // Unlike the old subtractive formula (100 − open/headcount×100), this
  // never bottoms out at a meaningless hard 0 when open roles exceed
  // headcount (e.g. 103 open vs 40 staff → 28% coverage, not 0%). It
  // degrades smoothly: 0 open = 100%, open == headcount = 50%, and very
  // large gaps asymptote toward 0 without clamping.
  const openPositionsScore = Math.round(
    clamp((openPosBaseCount / Math.max(1, openPosBaseCount + openPositionCount)) * 100, 0, 100),
  );
  const openPositionsRecords: ActionDetail = demands.length > 0
    ? {
        title: `Open positions · ${openPositionCount} unfilled role${openPositionCount !== 1 ? "s" : ""} ${winNatProse}`,
        subtitle: `${openPositionCount} open role${openPositionCount !== 1 ? "s" : ""} · ${openPosBaseCount} current staff headcount · unsatisfied demand`,
        columns: [
          { key: "role", label: "Role" },
          { key: "project", label: "Project" },
          { key: "window", label: "Period", align: "right", note: "The start and end dates when this role is needed on the project" },
          { key: "alloc", label: "% Alloc", align: "right", note: "Hours booked on this role ÷ total working hours in the period" },
        ],
        rows: winDemandPositions.slice(0, MAX_DETAIL_ROWS).map((d: any) => {
          const rawRole = d?.Role ?? d?.Title ?? "";
          // "(2)" or bare "2" stored in the Role field means "N open positions
          // for an unspecified role" — display it as "Open role ×N".
          const countMatch = String(rawRole).match(/^\(?(\d+)\)?$/);
          const roleLabel = countMatch
            ? `Open role ×${countMatch[1]}`
            : rawRole
              ? String(rawRole)
              : "Open role";
          const raId = demandRaId(d);
          return {
            _ticket: demandTicket(d),
            ...(raId !== null ? { _raId: raId } : {}),
            role: roleLabel,
            project: demandProjectName(d),
            window: fmtRange(d?.AllocationStartDate, d?.AllocationEndDate),
            alloc: `${Math.round(Number(d?.PctAllocation) || 0)}%`,
          };
        }),
        emptyText: "No open demand positions.",
      }
    : null;

  // Schedule primitives (Project Manager) from the EFFECTIVE end date:
  // phase-schedule last end when a schedule exists, TargetCompletionDate
  // fallback otherwise (client rule, see lib/projectDates).
  const pmTodayStart = new Date();
  pmTodayStart.setHours(0, 0, 0, 0);
  const pmHorizonEnd = new Date(pmTodayStart.getTime() + windowDays * 86400000);
  const getDeadline = (p: any): Date | null => effEnd(p);
  const withDeadline = activePmm.filter((p) => getDeadline(p));
  const dueSoon = withDeadline.filter((p) => {
    const d = getDeadline(p)!;
    return d >= pmTodayStart && d <= pmHorizonEnd;
  });
  // Milestone concentration: what fraction of all tracked-deadline projects
  // fall in this window. Scaled ×10 so 1% → 10, 10% → 100 on the gauge.
  // High score = busy window (many deadlines concentrated here = pressure).
  // Low score = comfortable window (few deadlines).
  const milestonesConcentration =
    withDeadline.length === 0
      ? null
      : Math.min(Math.round((dueSoon.length / withDeadline.length) * 100 * 10), 100);

  // Near-term schedule: bilateral ±window band around today.
  // Captures BOTH upcoming and recently-overdue projects → larger pool → more variation.
  // Score = % of band projects that are NOT yet overdue.
  const pmBandProjects = withDeadline.filter((p) => {
    const d = getDeadline(p)!;
    return d >= new Date(pmTodayStart.getTime() - windowDays * 86400000) && d <= pmHorizonEnd;
  });
  const pmBandOnTrack = pmBandProjects.filter((p) => getDeadline(p)! >= pmTodayStart);
  const nearTermScheduleScore =
    pmBandProjects.length === 0
      ? null
      : Math.round((pmBandOnTrack.length / pmBandProjects.length) * 100);

  // Common backward-window cutoff (used by schedule float + on-time delivery).
  const pmWindowCutoff = new Date(pmTodayStart.getTime() - windowDays * 86400000);

  // All-time overdue list (for records table).
  const overdue = withDeadline.filter((p) => getDeadline(p)! < pmTodayStart);

  // Window-sensitive schedule float: % of tracked projects NOT newly slipped
  // in the past <windowDays>. 7D → ~98%, 90D → ~73%.
  const recentlySlipped = withDeadline.filter((p) => {
    const d = getDeadline(p)!;
    return d < pmTodayStart && d >= pmWindowCutoff;
  });
  const scheduleFloatScore =
    withDeadline.length === 0
      ? null
      : Math.round(((withDeadline.length - recentlySlipped.length) / withDeadline.length) * 100);

  // Prospective on-time: % of due-soon projects already at ≥80% complete.
  // Uses dueSoon pool; falls back to all active if none due in the window.
  const pmProgressPool = dueSoon.length > 0 ? dueSoon : activePmm;
  const pmProgressUsesFallback = dueSoon.length === 0;
  const pmOnTrackCount = pmProgressPool.filter(
    (p) => (Number(p?.PctComplete) || 0) >= 80,
  ).length;
  const pmOnTimeScore =
    pmProgressPool.length > 0
      ? Math.round((pmOnTrackCount / pmProgressPool.length) * 100)
      : null;

  // PM budget health: scoped to projects due in the window (dueSoon).
  // As the window grows, more projects come into scope — making this window-sensitive.
  const pmBudgetPool = dueSoon.filter(
    (p) => Number(p?.ForecastedProjectCost) > 0 && Number(p?.LaborContractAmount) > 0,
  );
  const pmOnBudget = pmBudgetPool.filter(
    (p) => Number(p?.ForecastedProjectCost) <= Number(p?.LaborContractAmount),
  );
  // Fall back to all active if no projects are due in the window
  const pmBudgetPoolFallback = activePmm.filter(
    (p) => Number(p?.ForecastedProjectCost) > 0 && Number(p?.LaborContractAmount) > 0,
  );
  const pmOnBudgetFallback = pmBudgetPoolFallback.filter(
    (p) => Number(p?.ForecastedProjectCost) <= Number(p?.LaborContractAmount),
  );
  const pmBudgetUsesFallback = pmBudgetPool.length === 0;
  const pmBudgetEffectivePool = pmBudgetUsesFallback ? pmBudgetPoolFallback : pmBudgetPool;
  const pmBudgetEffectiveOnBudget = pmBudgetUsesFallback ? pmOnBudgetFallback : pmOnBudget;
  const pmBudgetScore =
    pmBudgetEffectivePool.length > 0
      ? Math.round((pmBudgetEffectiveOnBudget.length / pmBudgetEffectivePool.length) * 100)
      : null;

  // Milestone Readiness: % of all deadline-tracked active projects that still
  // have a future deadline (haven't yet slipped past their target date).
  // Score = on-track count / total tracked × 100.
  const milestoneOnTrackProjects = withDeadline.filter(
    (p) => getDeadline(p)! >= pmTodayStart,
  );
  const milestoneOnTrackCount = milestoneOnTrackProjects.length;
  const milestoneCompletedNotClosed = activePmm.filter(
    (p) => Number(p?.PctComplete ?? 0) >= 100,
  ).length;
  const milestoneReadinessScore: number | null =
    withDeadline.length > 0
      ? Math.round((milestoneOnTrackCount / withDeadline.length) * 100)
      : null;
  const milestoneReadinessRecords: ActionDetail = withDeadline.length > 0
    ? {
        title: `Milestone Readiness · ${milestoneOnTrackCount} future deadline${milestoneOnTrackCount === 1 ? "" : "s"}`,
        subtitle: `${milestoneOnTrackCount} on track · ${overdue.length} delayed · ${milestoneCompletedNotClosed} completed but not yet closed`,
        columns: [
          { key: "project", label: "Project" },
          { key: "targetDate", label: "End Date", align: "right" as const },
          { key: "daysOut", label: "Days Out", align: "right" as const, note: "Calendar days from today" },
          { key: "status", label: "Status", align: "right" as const },
        ],
        rows: withDeadline
          .slice()
          .sort((a, b) => {
            const da = getDeadline(a)!.getTime();
            const db = getDeadline(b)!.getTime();
            const todayMs = pmTodayStart.getTime();
            const aOn = da >= todayMs;
            const bOn = db >= todayMs;
            // On-track first (soonest deadline first), then delayed (most recent slip first)
            if (aOn !== bOn) return aOn ? -1 : 1;
            return aOn ? da - db : db - da;
          })
          .slice(0, MAX_DETAIL_ROWS)
          .map((p) => {
            const d = getDeadline(p)!;
            const daysOut = Math.round((d.getTime() - pmTodayStart.getTime()) / 86400000);
            return {
              _ticket: ticketOf(p),
              project: getProjectTitle(p),
              targetDate: fmtDate(effEndStr(p)),
              daysOut: daysOut >= 0 ? `${daysOut}d` : `\u2212${Math.abs(daysOut)}d`,
              status: daysOut >= 0 ? "On Track" : "Delayed",
            };
          }),
        emptyText: "No deadline-tracked projects.",
      }
    : null;

  // Delivery Readiness: % of deadline-tracked active projects that have
  // started execution. A project is "started" if:
  //   1. ActualStartDate is explicitly recorded, OR
  //   2. its EFFECTIVE start (first phase start when a schedule exists, else
  //      TargetStartDate) is in the past — kick-off has already passed.
  // Score = started / total-tracked × 100.
  const deliveryStarted = withDeadline.filter((p) => effStarted(p, pmTodayStart));
  const deliveryNotStarted = withDeadline.length - deliveryStarted.length;
  const deliveryReadinessScore: number | null =
    withDeadline.length > 0
      ? Math.round((deliveryStarted.length / withDeadline.length) * 100)
      : null;
  const deliveryReadinessRecords: ActionDetail = withDeadline.length > 0
    ? {
        title: `All deadline-tracked projects · ${withDeadline.length} total`,
        subtitle: `${deliveryStarted.length} started · ${deliveryNotStarted} not yet started · ${withDeadline.length} total`,
        columns: [
          { key: "project", label: "Project" },
          { key: "startDate", label: "Start Date", align: "right" as const },
          { key: "targetDate", label: "End Date", align: "right" as const },
          { key: "daysOut", label: "Days Out", align: "right" as const, note: "Calendar days from today" },
          { key: "status", label: "Status", align: "right" as const },
        ],
        rows: withDeadline
          .slice()
          .sort((a, b) => {
            // Started first (same effective-start logic as deliveryStarted),
            // then not-started; within each group sort by end date asc.
            const aS = effStarted(a, pmTodayStart);
            const bS = effStarted(b, pmTodayStart);
            if (aS !== bS) return aS ? -1 : 1;
            return getDeadline(a)!.getTime() - getDeadline(b)!.getTime();
          })
          .slice(0, MAX_DETAIL_ROWS)
          .map((p) => {
            const d = getDeadline(p)!;
            const daysOut = Math.round((d.getTime() - pmTodayStart.getTime()) / 86400000);
            const hasActual = !!p?.ActualStartDate;
            const started = effStarted(p, pmTodayStart);
            return {
              _ticket: ticketOf(p),
              project: getProjectTitle(p),
              startDate: fmtDate(effStartStr(p) ?? p?.ActualStartDate) ?? "—",
              targetDate: fmtDate(effEndStr(p)),
              daysOut: daysOut >= 0 ? `${daysOut}d` : `\u2212${Math.abs(daysOut)}d`,
              status: hasActual ? "Started" : started ? "Underway" : "Not Started",
            };
          }),
        emptyText: "No deadline-tracked projects.",
      }
    : null;

  // Budget Coverage: % of active projects/opps with cost data that are within
  // their contracted budget. All-time scope (not window-filtered).
  // Pool = activePmm + openOpm — whichever has ForecastedProjectCost filled in.
  // "Budget ceiling" = LaborContractAmount when set, else ContractValue/ApproxContractValue.
  // ForecastedProjectCost is a TOTAL project cost estimate — it must be compared
  // to the total contract value (ApproxContractValue / ContractValue), NOT to
  // LaborContractAmount which is only the labor sub-portion. Using the labor
  // amount as the ceiling makes every project look over budget.
  const budgetCeilingOf = (p: any): number => {
    if (Number(p?.ApproxContractValue) > 0) return Number(p.ApproxContractValue);
    if (Number(p?.ContractValue) > 0) return Number(p.ContractValue);
    if (Number(p?.ContractedAmount) > 0) return Number(p.ContractedAmount);
    return Number(p?.LaborContractAmount ?? 0);
  };
  const budgetForecastOf = (p: any): number =>
    Number(p?.ForecastedProjectCost ?? 0);
  const budgetTitleOf = (p: any): string =>
    String(p?.Title ?? p?.ProjectTitle ?? p?.Name ?? p?.TicketId ?? "—");
  const openOpm = opm.filter((o) => !isOpmClosed(o));
  const budgetCandidates = [
    ...activePmm.map((p) => ({ ...p, _src: "PMM" })),
    ...openOpm.map((o) => ({ ...o, _src: "OPM" })),
  ];
  const budgetCoveragePool = budgetCandidates.filter(
    (p) => budgetForecastOf(p) > 0 && budgetCeilingOf(p) > 0,
  );
  const budgetCoverageOnBudget = budgetCoveragePool.filter(
    (p) => budgetForecastOf(p) <= budgetCeilingOf(p),
  );
  const budgetCoverageOverBudget = budgetCoveragePool.length - budgetCoverageOnBudget.length;
  const budgetCoverageScore: number | null =
    budgetCoveragePool.length > 0
      ? Math.round((budgetCoverageOnBudget.length / budgetCoveragePool.length) * 100)
      : null;
  const budgetCoverageRecords: ActionDetail = budgetCoveragePool.length > 0
    ? {
        title: `Budget coverage · ${budgetCoveragePool.length} with cost data`,
        subtitle: `${budgetCoverageOnBudget.length} within budget · ${budgetCoverageOverBudget} over budget · ${budgetCoveragePool.length} records`,
        columns: [
          { key: "project", label: "Project" },
          { key: "contract", label: "Budget", align: "right" as const },
          { key: "forecast", label: "Forecast", align: "right" as const },
          { key: "status", label: "Status", align: "right" as const },
        ],
        rows: budgetCoveragePool
          .slice()
          .sort((a, b) => {
            const ra = budgetForecastOf(a) / Math.max(1, budgetCeilingOf(a));
            const rb = budgetForecastOf(b) / Math.max(1, budgetCeilingOf(b));
            return rb - ra;
          })
          .slice(0, MAX_DETAIL_ROWS)
          .map((p) => {
            const ceiling = budgetCeilingOf(p);
            const forecast = budgetForecastOf(p);
            return {
              _ticket: ticketOf(p),
              project: budgetTitleOf(p),
              contract: fmtMoney(ceiling),
              forecast: fmtMoney(forecast),
              status: forecast > ceiling ? "Over Budget" : "Within Budget",
            };
          }),
        emptyText: "No budget data on file.",
      }
    : null;

  // Schedule Health: % of ALL active projects that are not yet overdue.
  // Denominator = activePmm (every active project, regardless of deadline).
  // "Not overdue" = no deadline set OR deadline still in the future.
  // Score = (activePmm.length − overdue.length) / activePmm.length × 100.
  const scheduleHealthNotOverdueCount = activePmm.length - overdue.length;
  const scheduleHealthScore: number | null =
    activePmm.length > 0
      ? Math.round((scheduleHealthNotOverdueCount / activePmm.length) * 100)
      : null;
  const scheduleHealthRecords: ActionDetail = overdue.length > 0
    ? {
        title: `Overdue active projects · ${overdue.length} past target completion`,
        subtitle: `${overdue.length} of ${activePmm.length} active projects past target completion`,
        columns: [
          { key: "project", label: "Project" },
          { key: "target", label: "End Date", align: "right" as const },
          { key: "value", label: "Value", align: "right" as const },
        ],
        rows: overdue
          .slice()
          .sort((a, b) => getDeadline(a)!.getTime() - getDeadline(b)!.getTime())
          .slice(0, MAX_DETAIL_ROWS)
          .map((p) => ({
            _ticket: ticketOf(p),
            project: getProjectTitle(p),
            target: fmtDate(effEndStr(p)),
            value: fmtMoney(getValue(p)),
          })),
        emptyText: "No overdue active projects.",
      }
    : null;

  // Firm primitive (Executive): active backlog share.
  const totalPmmCount = activePmm.length + closedPmm.length;
  const backlogScore =
    totalPmmCount > 0
      ? Math.round(clamp((activePmm.length / totalPmmCount) * 100, 0, 100))
      : null;

  // Record tables backing the role-specific live sub-drivers (clickable).
  const roleLoadRecords: ActionDetail = {
    title: "Role load · concurrent demand by role",
    subtitle: `${overloadRoleCount} of ${totalRoleCount} role${totalRoleCount === 1 ? "" : "s"} over 1.0 FTE `,
    columns: [
      { key: "role", label: "Role" },
      { key: "count", label: "Reqs", align: "right", note: "Number of open role requests that haven't been filled with a person yet" },
      { key: "fte", label: "FTE total", align: "right", note: "Total demand converted to full-time people — 1.0 FTE = one person working a full week" },
    ],
    rows: roleLoadEntries
      .slice()
      .sort((a, b) => b.sum - a.sum)
      .map((r) => ({
        role: r.role,
        count: r.count,
        fte: `~${(r.sum / 100).toFixed(1)} FTE`,
      })),
    emptyText: `No resource demand recorded.`,
  };
  const deadlineRecords: ActionDetail = {
    title: `Milestones · ${dueSoon.length} project${dueSoon.length === 1 ? "" : "s"} due`,
    subtitle: `${dueSoon.length} of ${withDeadline.length} deadline-tracked projects due`,
    columns: [
      { key: "title", label: "Project" },
      { key: "deadline", label: "End Date", align: "right" },
      { key: "daysOut", label: "Days Out", align: "right", note: "Calendar days from today" },
    ],
    rows: dueSoon
      .slice()
      .sort((a, b) => getDeadline(a)!.getTime() - getDeadline(b)!.getTime())
      .slice(0, MAX_DETAIL_ROWS)
      .map((p) => {
        const d = getDeadline(p)!;
        const daysOut = Math.round((d.getTime() - pmTodayStart.getTime()) / 86400000);
        return {
          _ticket: ticketOf(p),
          title: getProjectTitle(p),
          deadline: fmtDate(effEndStr(p)),
          daysOut: `${daysOut}d`,
        };
      }),
    emptyText: `No active project deadlines.`,
  };
  const nearTermRecords: ActionDetail = {
    title: `Near-term schedule · projects due`,
    subtitle: `${pmBandOnTrack.length} of ${pmBandProjects.length} in the tracked band still on schedule`,
    columns: [
      { key: "title", label: "Project" },
      { key: "deadline", label: "End Date", align: "right" },
      { key: "status", label: "Status", align: "right" },
    ],
    rows: pmBandProjects
      .slice()
      .sort((a, b) => getDeadline(a)!.getTime() - getDeadline(b)!.getTime())
      .slice(0, MAX_DETAIL_ROWS)
      .map((p) => {
        const d = getDeadline(p)!;
        const onTrack = d >= pmTodayStart;
        return {
          _ticket: ticketOf(p),
          title: getProjectTitle(p),
          deadline: fmtDate(effEndStr(p)),
          status: onTrack ? "On track" : "Overdue",
        };
      }),
    emptyText: `No projects with deadlines in the tracked band.`,
  };
  const overdueRecords: ActionDetail = {
    title: "Schedule float · overdue active projects",
    subtitle: `${overdue.length} of ${withDeadline.length} active project${withDeadline.length === 1 ? "" : "s"} past target completion`,
    columns: [
      { key: "title", label: "Project" },
      { key: "deadline", label: "End Date", align: "right" },
      { key: "value", label: "Value", align: "right" },
    ],
    rows: overdue
      .slice()
      .sort((a, b) => getValue(b) - getValue(a))
      .map((p) => ({
        _ticket: ticketOf(p),
        title: getProjectTitle(p),
        deadline: fmtDate(effEndStr(p)),
        value: fmtMoney(getValue(p)),
      })),
    emptyText: "No overdue active projects.",
  };
  const backlogRecords: ActionDetail = {
    title: "Active backlog · projects in flight",
    subtitle: `${activePmm.length} active of ${totalPmmCount} total projects`,
    columns: [
      { key: "title", label: "Project" },
      { key: "client", label: "Client" },
      { key: "value", label: "Value", align: "right" },
    ],
    rows: activePmm
      .slice()
      .sort((a, b) => getValue(b) - getValue(a))
      .map((p) => ({
        _ticket: ticketOf(p),
        title: getProjectTitle(p),
        client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
        value: fmtMoney(getValue(p)),
      })),
    emptyText: "No active projects on file.",
  };
  const onTimeRecords: ActionDetail = {
    title: `Delivery progress · projects due ${winNatProse}`,
    subtitle: `${pmOnTrackCount} of ${pmProgressPool.length} project${pmProgressPool.length === 1 ? "" : "s"} at ≥80% complete${pmProgressUsesFallback ? " (all active — none due in window)" : ""}`,
    columns: [
      { key: "title", label: "Project" },
      { key: "pct", label: "% Done", align: "right", note: "Completed tasks ÷ total scope — updated as work is marked done in RM ONE" },
      { key: "deadline", label: "End Date", align: "right" },
    ],
    rows: pmProgressPool
      .slice()
      .sort((a, b) => (Number(b?.PctComplete) || 0) - (Number(a?.PctComplete) || 0))
      .slice(0, MAX_DETAIL_ROWS)
      .map((p) => ({
        _ticket: ticketOf(p),
        title: getProjectTitle(p),
        pct: `${Math.round(Number(p?.PctComplete) || 0)}%`,
        deadline: fmtDate(effEndStr(p)),
      })),
    emptyText: "No project completion data available.",
  };
  const budgetRecords: ActionDetail = {
    title: pmBudgetUsesFallback ? "Budget health · all active projects" : `Budget health · projects due`,
    subtitle: `${pmBudgetEffectiveOnBudget.length} of ${pmBudgetEffectivePool.length} project${pmBudgetEffectivePool.length === 1 ? "" : "s"} within labor contract value`,
    columns: [
      { key: "title", label: "Project" },
      { key: "contract", label: "Contract", align: "right" },
      { key: "forecast", label: "Forecast", align: "right" },
    ],
    rows: pmBudgetEffectivePool
      .slice()
      .sort((a, b) => {
        const ra = Number(a.ForecastedProjectCost) / Math.max(1, Number(a.LaborContractAmount));
        const rb = Number(b.ForecastedProjectCost) / Math.max(1, Number(b.LaborContractAmount));
        return rb - ra; // worst ratio first
      })
      .slice(0, MAX_DETAIL_ROWS)
      .map((p) => ({
        _ticket: ticketOf(p),
        title: getProjectTitle(p),
        contract: fmtMoney(Number(p.LaborContractAmount)),
        forecast: fmtMoney(Number(p.ForecastedProjectCost)),
      })),
    emptyText: "No budget data on file.",
  };

  // Pipeline coverage — CEO/CFO "Firm Health" metric, pixel-matched to the
  // provided drill-down mock. Formula: Active Book ÷ Total Pipeline × 100,
  // where Active Book is the value of all currently-active PMM projects
  // (work already booked/signed) and Total Pipeline is the value of every
  // open OPM opportunity on file. Live-only — no fallback numbers.
  // openOpm already declared above for budget coverage pool.
  const pipelineActiveBook = pmmActiveValue;
  const pipelineTotalPipeline = openOpm.reduce((s, o) => s + getOpmValue(o), 0);
  const pipelineCoveragePct = pipelineTotalPipeline > 0
    ? Math.round(clamp((pipelineActiveBook / pipelineTotalPipeline) * 100, 0, 999))
    : 0;
  const pipelineSub: SubDriver = {
    label: "Pipeline coverage",
    value: pipelineCoveragePct,
    available: openOpm.length > 0 || activePmm.length > 0,
    raw: `${fmtMoney(pipelineActiveBook)} of ${fmtMoney(pipelineTotalPipeline)} booked · ${pipelineCoveragePct}% covered`,
    windowLabel: "all-time",
    formulaDetail: {
      currentReading: `${fmtMoney(pipelineActiveBook)} of ${fmtMoney(pipelineTotalPipeline)} total pipeline already booked · ${pipelineCoveragePct}% covered`,
      howCalculated: `What share of the potential work currently being pursued has already turned into signed, active work. Both sides are all-time, firm-wide totals, so this reading is stable and doesn't move just because you change the time window. There's no fixed target since we don't track a sales quota, but if the active book ever exceeds the pipeline, that's an early warning to submit more proposals or improve win rates before existing work runs out.`,
      formula: `Active Project Book (PMM) ÷ Open Opportunity Pipeline (OPM) × 100 = ${fmtMoney(pipelineActiveBook)} ÷ ${fmtMoney(pipelineTotalPipeline)} × 100 = ${pipelineCoveragePct}%`,
      dataSource: "PMM (active book) + OPM (pipeline)",
      impact: `${fmtMoney(pipelineActiveBook)} of ${fmtMoney(pipelineTotalPipeline)} total pipeline already booked · ${pipelineCoveragePct}% covered. This is simply the share of the firm's total pipeline of bids and proposals that has already converted into active, signed work — there's no fixed target since RM ONE has no sales-quota field. Watch for this approaching 100%, which would mean the active book is catching up to the entire known pipeline.`,
      tableTitle: `OPEN PIPELINE (OPM) · ${openOpm.length} OPPORTUNIT${openOpm.length === 1 ? "Y" : "IES"} · TOTAL ${fmtMoney(pipelineTotalPipeline)}`,
      secondaryTable: {
        title: `ACTIVE PROJECT BOOK (PMM) · ${activePmm.length} PROJECT${activePmm.length === 1 ? "" : "S"} · TOTAL ${fmtMoney(pipelineActiveBook)}`,
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
    },
    records: {
      title: "Pipeline coverage · all open opportunities",
      subtitle: `${openOpm.length} open opportunit${openOpm.length === 1 ? "y" : "ies"} · ${fmtMoney(pipelineTotalPipeline)} total pipeline vs ${fmtMoney(pipelineActiveBook)} active book`,
      columns: [
        { key: "title",  label: "Opportunity" },
        { key: "client", label: "Client" },
        { key: "stage",  label: "Stage" },
        { key: "value",  label: "Value", align: "right" },
      ],
      rows: coverageRecords.map((o) => ({
        _ticket: ticketOf(o),
        title:  getProjectTitle(o),
        client: String(o?.CRMCompanyLookupName ?? o?.ClientName ?? o?.CompanyName ?? "—"),
        stage:  String(o?.CRMProjectStatusChoice ?? o?.Status ?? "—"),
        value:  fmtMoney(getOpmValue(o)),
      })),
      emptyText: "No opportunities in the pipeline.",
    },
  };

  // ── CFO financial sub-driver computations (window-scoped) ─────────────────
  // All five CFO metrics are scoped to the selected time window so switching
  // 7D / 30D / 60D / 90D produces visible change.
  //
  // PMM-based metrics (Labor margin, Cost coverage) use projects whose
  // effective end date falls within the window; fall back to all active
  // projects when no completions are scheduled in the window (e.g. 7D).
  //
  // Alloc-based metrics (Hours on plan, Labor completion, Alloc on plan)
  // scope to resources assigned to at least one window project via their
  // allProjectIds list; fall back to full headcount when nothing matches.
  const cfoPool = projectsClosingInWindow.length > 0 ? projectsClosingInWindow : activePmm;

  // Labor margin: aggregate gross margin across window-scoped projects with
  // contract data — profit ÷ contract value over pool TOTALS, matching the
  // formula card exactly. laborMarginPct is the real (unclamped) margin; the
  // score clamps to 0-100 only so the gauge can render it.
  const lmPool = cfoPool.filter((p) => Number(p?.LaborContractAmount) > 0);
  const lmTotalCV = lmPool.reduce((s, p) => s + getValue(p), 0);
  const lmTotalLaborCost = lmPool.reduce((s, p) => s + Number(p?.LaborContractAmount ?? 0), 0);
  const lmTotalProfit = lmTotalCV - lmTotalLaborCost;
  const laborMarginPct = lmTotalCV > 0 ? Math.round((lmTotalProfit / lmTotalCV) * 100) : 0;
  const laborMarginScore: number | null = lmPool.length > 0
    ? clamp(laborMarginPct, 0, 100)
    : null;

  // Cost coverage: Remaining Revenue ÷ ETC (FutureCost).
  // Pool = projects with LaborRevenue > 0 AND FutureCost > 0 (both fields must be present).
  // Falls back to at-risk % when no financial data is available.
  const atRiskRe2 = /at[\s-]?risk|on[\s-]?hold|critical|over.?run/i;
  const cfoAtRisk = cfoPool.filter((p) =>
    atRiskRe2.test(String(p?.CRMProjectStatusChoice ?? p?.Status ?? "")),
  );
  const costCoveragePool = cfoPool.filter(
    (p) => Number(p?.LaborRevenue ?? 0) > 0 && Number(p?.FutureCost ?? 0) > 0,
  );
  const hasCoverageData = costCoveragePool.length > 0;
  const totalLaborRevenue = costCoveragePool.reduce((s, p) => s + Number(p?.LaborRevenue ?? 0), 0);
  const totalActualCostCC = costCoveragePool.reduce((s, p) => s + Number(p?.ActualCost  ?? 0), 0);
  const totalFutureCostCC = costCoveragePool.reduce((s, p) => s + Number(p?.FutureCost  ?? 0), 0);
  const remainingRevenue  = totalLaborRevenue - totalActualCostCC;
  const costCoverageRatio = totalFutureCostCC > 0 ? remainingRevenue / totalFutureCostCC : 0;
  // Gauge score (0-100): ratio ≥ 3× = 100; linear below; at-risk fallback.
  const costCoverageScore: number | null = cfoPool.length > 0
    ? hasCoverageData
      ? clamp(Math.round((costCoverageRatio / 3) * 100), 0, 100)
      : Math.round(clamp(((cfoPool.length - cfoAtRisk.length) / cfoPool.length) * 100, 0, 100))
    : null;
  const fmtRatio = (r: number) => `${r.toFixed(2)}×`;

  // Scope alloc metrics to resources whose allProjectIds overlaps the window
  // project pool. allProjectIds holds numeric PMM TicketIds as strings.
  const cfoWindowTicketIds = new Set(
    cfoPool.map((p) => String(p?.TicketId ?? "")).filter(Boolean),
  );
  const windowAllocList = cfoWindowTicketIds.size > 0
    ? allAllocResources.filter((r) =>
        (r as unknown as { allProjectIds?: string[] })?.allProjectIds
          ?.some((id) => cfoWindowTicketIds.has(String(id))),
      )
    : [];
  const allocResList = windowAllocList.length > 0 ? windowAllocList : allAllocResources;

  // Hours on plan: share of window staff in the healthy utilization band
  // (Settings thresholds: underAllocatedPct–overCapacityPct).
  const hoursOnPlanScore: number | null = allocResList.length > 0
    ? Math.round(
        (allocResList.filter((r) => {
          const pct = Number(r?.currentPct ?? 0);
          return pct >= hiRules.underAllocatedPct && pct < hiRules.overCapacityPct;
        }).length /
          allocResList.length) *
          100,
      )
    : null;

  // ── Project-level hours data (upstream PMM fields when available) ────────────
  // RM ONE upstream records may carry ContractHours, ActualHrs, FutureHrs.
  // Declared HERE (before hasLaborHoursData) to avoid TDZ errors — these
  // variables are also referenced in the Hours on Plan formulaDetail below.
  const totalContractHrs = cfoPool.reduce((s, p) => s + Number(p?.ContractHours ?? 0), 0);
  const totalActualHrs   = cfoPool.reduce((s, p) => s + Number(p?.ActualHrs   ?? 0), 0);
  const totalFutureHrs   = cfoPool.reduce((s, p) => s + Number(p?.FutureHrs   ?? 0), 0);
  const totalForecastHrs = totalActualHrs + totalFutureHrs;
  const headroomHrs      = totalContractHrs - totalForecastHrs;
  const hasHoursData     = totalContractHrs > 0;
  const forecastCovPct   = hasHoursData
    ? Math.round((totalForecastHrs / totalContractHrs) * 100) : null;
  const allocGrowthPct   = hasHoursData
    ? Math.round(((totalForecastHrs - totalContractHrs) / totalContractHrs) * 100) : null;
  const hoursProjectPool = hasHoursData
    ? cfoPool.filter(p => Number(p?.ContractHours ?? 0) > 0 || Number(p?.ActualHrs ?? 0) > 0)
    : [];

  // Labor completion: prefer hours-based (ActualHrs ÷ ForecastHrs) when PMM
  // financial fields are present; fall back to staff engagement % otherwise.
  const hasLaborHoursData  = totalForecastHrs > 0;
  const laborProjectPool   = hasLaborHoursData
    ? cfoPool.filter(p => Number(p?.ActualHrs ?? 0) > 0 || Number(p?.FutureHrs ?? 0) > 0)
    : [];
  const laborCompletionHoursScore = hasLaborHoursData
    ? clamp(Math.round((totalActualHrs / totalForecastHrs) * 100), 0, 100)
    : null;
  const laborCompletionScore: number | null = hasLaborHoursData
    ? laborCompletionHoursScore
    : allocResList.length > 0
      ? Math.round(
          clamp(
            (allocResList.filter((r) => Number(r?.currentPct ?? 0) > 0).length /
              allocResList.length) * 100,
            0, 100,
          ),
        )
      : null;

  // Alloc on plan: share of window staff in the healthy "on-plan" band
  // (Settings thresholds: underAllocatedPct–overCapacityPct).
  const allocOnPlanScore: number | null = allocResList.length > 0
    ? Math.round(
        (allocResList.filter((r) => {
          const pct = Number(r?.currentPct ?? 0);
          return pct >= hiRules.underAllocatedPct && pct < hiRules.overCapacityPct;
        }).length /
          allocResList.length) *
          100,
      )
    : null;
  // Mean allocation % across all actively-engaged staff — used as the primary
  // display number for "Alloc on plan" so the header, badge and formula all agree.
  const allocAvgPct: number = allocResList.length > 0
    ? Math.round(
        allocResList.reduce((s, r) => s + Math.round(Number(r?.currentPct ?? 0)), 0) /
        allocResList.length,
      )
    : 0;

  // ── CFO detail-drawer records ──────────────────────────────────────────────
  // Each sub-driver carries an ActionDetail table so the CFO click-through
  // shows the underlying projects / staff rather than a self-referential row.
  const cfoWindowLabel2 =
    projectsClosingInWindow.length > 0 ? `` : "all active";
  const atRiskRe = /at[\s-]?risk|on[\s-]?hold|critical|over.?run/i;

  const laborMarginRecords: ActionDetail = laborMarginScore != null
    ? {
        title: `Labor margin · ${lmPool.length} project${lmPool.length === 1 ? "" : "s"} · ${cfoWindowLabel2}`,
        subtitle: `${laborMarginPct}% combined gross margin across contracts on file`,
        columns: [
          { key: "ticket",   label: "Ticket" },
          { key: "project",  label: "Project" },
          { key: "revenue",  label: "Revenue",       align: "right" },
          { key: "cost",     label: "Est. Total Cost", align: "right", note: "Projected total labor cost to deliver the project" },
          { key: "margin",   label: "Margin",        align: "right", note: "Revenue minus cost — e.g. $1M contract, $700K cost = 30% margin" },
        ],
        rows: lmPool
          .slice()
          .sort((a, b) => getValue(b) - getValue(a)) // highest revenue first
          .map((p) => {
            const cv = getValue(p);
            const lca = Number(p?.LaborContractAmount);
            const margin = cv > 0 ? Math.round(((cv - lca) / cv) * 100) : 0;
            return {
              _ticket: ticketOf(p),
              ticket:  ticketOf(p),
              project: getProjectTitle(p),
              revenue: fmtMoney(cv),
              cost:    fmtMoney(lca),
              margin:  `${margin}%`,
            };
          }),
        emptyText: "No labor contract data on file.",
      }
    : null;

  const hoursInBandCount = allocResList.filter((r) => {
    const p = Number(r?.currentPct ?? 0);
    return p >= hiRules.underAllocatedPct && p < hiRules.overCapacityPct;
  }).length;

  // ── Proxy hours from allocation % (used when PMM hours fields are absent) ────
  // Derive forecast vs capacity hours from currentPct × work-week hrs × window weeks.
  // Every tenant has allocation data, so this always produces real hours.
  const allocWeeks       = windowDays / 7;
  const hrsPerWeek       = hiRules.workWeekHours || 40;
  const allocCapacityHrs = allocResList.length * hrsPerWeek * allocWeeks;
  const allocForecastHrs = allocResList.reduce(
    (s, r) => s + (Number(r?.currentPct ?? 0) / 100) * hrsPerWeek * allocWeeks, 0,
  );
  const allocBenchHrs    = allocCapacityHrs - allocForecastHrs;
  const allocUtilPct     = allocCapacityHrs > 0
    ? Math.round((allocForecastHrs / allocCapacityHrs) * 100) : 0;
  // Per-person entries for the sortable TOP STAFF block.
  const allocStaffProjects = allocResList.map((r) => {
    const pct = Number(r?.currentPct ?? 0);
    const cap = hrsPerWeek * allocWeeks;
    const fcs = (pct / 100) * cap;
    return {
      label: String(r?.name ?? "").trim() || "Name not recorded",
      values: {
        capacity: { raw: cap, str: fmtHrs(cap) },
        forecast: { raw: fcs, str: fmtHrs(fcs) },
        bench:    { raw: cap - fcs, str: fmtHrs(cap - fcs) },
      },
    };
  });

  const hoursOnPlanRecords: ActionDetail = hoursOnPlanScore != null
    ? hasHoursData
      ? {
          title: `Hours on plan · ${hoursProjectPool.length} project${hoursProjectPool.length === 1 ? "" : "s"} · ${cfoWindowLabel2}`,
          subtitle: `${forecastCovPct ?? 0}% of contracted hours scheduled · ${fmtHrs(totalForecastHrs)} of ${fmtHrs(totalContractHrs)}`,
          columns: [
            { key: "ticket",   label: "Ticket" },
            { key: "project",  label: "Project" },
            { key: "contract", label: "Contract Hrs", align: "right" as const, note: "Total hours agreed with the client in the signed contract scope" },
            { key: "forecast", label: "Forecast Hrs", align: "right" as const, note: "Projected total hours to finish — based on work recorded plus remaining planned hours" },
          ],
          rows: hoursProjectPool
            .slice()
            .sort((a, b) => Number(b?.ContractHours ?? 0) - Number(a?.ContractHours ?? 0))
            .map((p) => ({
              _ticket: ticketOf(p),
              ticket:  ticketOf(p),
              project: getProjectTitle(p),
              contract: fmtHrs(Number(p?.ContractHours ?? 0)),
              forecast: fmtHrs(Number(p?.ActualHrs ?? 0) + Number(p?.FutureHrs ?? 0)),
            })),
          emptyText: "No project hours data on file.",
        }
      : {
          title: `Staff hours · ${allocResList.length} staff · ${cfoWindowLabel2}`,
          subtitle: `${fmtHrs(allocForecastHrs)} forecast of ${fmtHrs(allocCapacityHrs)} capacity · ${allocUtilPct}% utilization`,
          columns: [
            { key: "name",     label: "Name" },
            { key: "capacity", label: "Capacity",     align: "right" as const, note: "Total available working hours in this period — based on headcount and working days" },
            { key: "forecast", label: "Forecast Hrs", align: "right" as const, note: "Projected total hours to finish — based on work recorded plus remaining planned hours" },
            { key: "util",     label: "Utilization",  align: "right" as const, note: `Planned hours ÷ available capacity — 100% = fully booked, ${hiRules.overCapacityPct}%+ = overloaded` },
          ],
          rows: allocResList
            .slice()
            .sort((a, b) => Number(b?.currentPct ?? 0) - Number(a?.currentPct ?? 0))
            .slice(0, MAX_DETAIL_ROWS)
            .map((r) => {
              const pct = Math.round(Number(r?.currentPct ?? 0));
              const cap = hrsPerWeek * allocWeeks;
              const fcs = (pct / 100) * cap;
              return {
                name:     String(r?.name ?? "—"),
                capacity: fmtHrs(cap),
                forecast: fmtHrs(fcs),
                util:     `${pct}%`,
              };
            }),
          emptyText: "No staffing data on file.",
        }
    : null;

  const engagedCount = allocResList.filter((r) => Number(r?.currentPct ?? 0) > 0).length;
  const benchListCount = allocResList.length - engagedCount;
  const laborCompletionRecords: ActionDetail = laborCompletionScore != null
    ? hasLaborHoursData
      ? {
          title: `Labor completion · ${laborProjectPool.length} project${laborProjectPool.length === 1 ? "" : "s"} · ${cfoWindowLabel2}`,
          subtitle: `${fmtHrs(totalActualHrs)} actual of ${fmtHrs(totalForecastHrs)} forecast · ${fmtHrs(totalFutureHrs)} remaining`,
          columns: [
            { key: "ticket",   label: "Ticket" },
            { key: "project",  label: "Project" },
            { key: "actual",   label: "Actual Hrs",   align: "right" as const, note: "Hours already recorded by the team in RM ONE" },
            { key: "forecast", label: "Forecast Hrs", align: "right" as const, note: "Projected total hours to finish — based on work recorded plus remaining planned hours" },
          ],
          rows: laborProjectPool
            .slice()
            .sort((a, b) => Number(b?.ActualHrs ?? 0) + Number(b?.FutureHrs ?? 0)
                          - (Number(a?.ActualHrs ?? 0) + Number(a?.FutureHrs ?? 0)))
            .map((p) => ({
              _ticket:  ticketOf(p),
              ticket:   ticketOf(p),
              project:  getProjectTitle(p),
              actual:   fmtHrs(Number(p?.ActualHrs ?? 0)),
              forecast: fmtHrs(Number(p?.ActualHrs ?? 0) + Number(p?.FutureHrs ?? 0)),
            })),
          emptyText: "No project hours data on file.",
        }
      : {
          title: `Staff engagement · ${allocResList.length} headcount · ${cfoWindowLabel2}`,
          subtitle: `${engagedCount} engaged · ${benchListCount} on bench (0% utilization)`,
          columns: [
            { key: "name",   label: "Name" },
            { key: "role",   label: "Role" },
            { key: "actual", label: "Forecast Hrs", align: "right" as const, note: "Projected total hours to finish — based on work recorded plus remaining planned hours" },
            { key: "status", label: "Status",       align: "right" as const },
          ],
          rows: allocResList
            .slice()
            .sort((a, b) => Number(b?.currentPct ?? 0) - Number(a?.currentPct ?? 0))
            .slice(0, MAX_DETAIL_ROWS)
            .map((r) => {
              const pct = Math.round(Number(r?.currentPct ?? 0));
              const fcs = (pct / 100) * hrsPerWeek * allocWeeks;
              return {
                name:   String(r?.name ?? "—"),
                role:   String((r as any)?.role ?? (r as any)?.roleName ?? "—"),
                actual: fmtHrs(fcs),
                status: pct === 0 ? "Bench" : "Engaged",
              };
            }),
          emptyText: "No staffing data on file.",
        }
    : null;

  const costCoverageRecords: ActionDetail = costCoverageScore != null
    ? hasCoverageData
      ? {
          title: `Cost coverage · ${costCoveragePool.length} project${costCoveragePool.length === 1 ? "" : "s"} · ${cfoWindowLabel2}`,
          subtitle: `${fmtMoney(remainingRevenue)} remaining revenue vs ${fmtMoney(totalFutureCostCC)} ETC · ${fmtRatio(costCoverageRatio)} coverage`,
          columns: [
            { key: "ticket",   label: "Ticket" },
            { key: "project",  label: "Project" },
            { key: "revenue",  label: "Revenue",  align: "right" },
            { key: "etc",      label: "ETC",      align: "right", note: "Estimated cost to finish remaining work — based on planned hours × billing rates" },
            { key: "coverage", label: "Coverage", align: "right", note: "Remaining revenue ÷ cost to finish — above 1.0x = revenue covers cost, below = at risk" },
          ],
          rows: costCoveragePool
            .slice()
            .sort((a, b) => {
              const ra = Number(a?.LaborRevenue ?? 0) / Math.max(Number(a?.FutureCost ?? 1), 1);
              const rb = Number(b?.LaborRevenue ?? 0) / Math.max(Number(b?.FutureCost ?? 1), 1);
              return ra - rb; // ascending: lowest coverage (most at-risk) first
            })
            .slice(0, MAX_DETAIL_ROWS)
            .map((p) => {
              const rev = Number(p?.LaborRevenue ?? 0);
              const etc = Number(p?.FutureCost   ?? 0);
              const ratio = etc > 0 ? (rev - Number(p?.ActualCost ?? 0)) / etc : 0;
              return {
                _ticket:  ticketOf(p),
                ticket:   ticketOf(p),
                project:  getProjectTitle(p),
                revenue:  fmtMoney(rev),
                etc:      fmtMoney(etc),
                coverage: fmtRatio(ratio),
              };
            }),
          emptyText: "No projects with both labor revenue and ETC on file.",
        }
      : {
          title: `Project health · ${cfoPool.length} project${cfoPool.length === 1 ? "" : "s"} · ${cfoWindowLabel2}`,
          subtitle: `${cfoPool.length - cfoAtRisk.length} healthy · ${cfoAtRisk.length} at-risk / on-hold`,
          columns: [
            { key: "project", label: "Project" },
            { key: "status",  label: "Status" },
            { key: "due",     label: "Due Date", align: "right" },
            { key: "value",   label: "Value",    align: "right" },
          ],
          rows: cfoPool
            .slice()
            .sort((a, b) => {
              const ra = atRiskRe2.test(String(a?.CRMProjectStatusChoice ?? a?.Status ?? "")) ? 0 : 1;
              const rb = atRiskRe2.test(String(b?.CRMProjectStatusChoice ?? b?.Status ?? "")) ? 0 : 1;
              return ra !== rb ? ra - rb : getValue(b) - getValue(a);
            })
            .slice(0, MAX_DETAIL_ROWS)
            .map((p) => ({
              _ticket: ticketOf(p),
              project: getProjectTitle(p),
              status:  String(p?.CRMProjectStatusChoice ?? p?.Status ?? "—"),
              due:     fmtDate(effEndStr(p)),
              value:   fmtMoney(getValue(p)),
            })),
          emptyText: "No active projects.",
        }
    : null;

  const allocOnBandCount = allocResList.filter((r) => {
    const p = Number(r?.currentPct ?? 0);
    return p >= hiRules.underAllocatedPct && p < hiRules.overCapacityPct;
  }).length;
  const allocOnPlanRecords: ActionDetail = allocOnPlanScore != null
    ? {
        title: `Allocation plan · ${allocResList.length} staff · ${cfoWindowLabel2}`,
        subtitle: `${allocOnBandCount} of ${allocResList.length} in the ${hiRules.underAllocatedPct}–${hiRules.overCapacityPct}% target band`,
        columns: [
          { key: "name", label: "Name" },
          { key: "bu", label: "Business Unit" },
          { key: "util", label: "Utilization", align: "right", note: `Hours assigned ÷ working capacity — 100% = fully booked, ${hiRules.overCapacityPct}%+ = overloaded` },
          { key: "status", label: "Status", align: "right" },
        ],
        rows: allocResList
          .slice()
          .sort((a, b) => {
            const pa = Number(a?.currentPct ?? 0);
            const pb = Number(b?.currentPct ?? 0);
            const ba = pa >= hiRules.overCapacityPct ? 0 : pa < hiRules.underAllocatedPct ? 1 : 2;
            const bb = pb >= hiRules.overCapacityPct ? 0 : pb < hiRules.underAllocatedPct ? 1 : 2;
            return ba !== bb ? ba - bb : pb - pa;
          })
          .slice(0, MAX_DETAIL_ROWS)
          .map((r) => {
            const pct = Math.round(Number(r?.currentPct ?? 0));
            return {
              name: String(r?.name ?? "—"),
              bu: String((r as any)?.businessUnit ?? (r as any)?.roleName ?? "—"),
              util: `${pct}%`,
              status: pct >= hiRules.overCapacityPct ? "Over" : pct < hiRules.underAllocatedPct ? "Under" : "On plan",
            };
          }),
        emptyText: "No staffing data on file.",
      }
    : null;

  let subDrivers: SubDriver[];
  let healthLabel: string;
  switch (role) {
    case "CFO":
      healthLabel = "Financial Health";
      subDrivers = [
        pipelineSub,
        {
          label: "Labor margin",
          value: laborMarginScore ?? 0,
          available: laborMarginScore != null,
          raw: laborMarginScore != null
            ? `${laborMarginPct}% gross margin · ${lmPool.length} project${lmPool.length === 1 ? "" : "s"} with contract data`
            : "Not available yet",
          windowLabel: laborMarginScore != null ? windowShort : undefined,
          tone: (laborMarginScore ?? 0) >= 25 ? "good" : "warn",
          records: laborMarginRecords ?? undefined,
          formulaDetail: laborMarginScore != null ? (() => {
            // Same hoisted aggregates that produce laborMarginScore — the badge,
            // formula chain, and gauge all read from one computation.
            const totalCV = lmTotalCV;
            const totalLaborCost = lmTotalLaborCost;
            const totalProfit = lmTotalProfit;
            const marginPct = laborMarginPct;
            const returnPer1 = totalLaborCost > 0 ? (totalCV / totalLaborCost).toFixed(2) : "—";
            const laborCostRatioPct = totalCV > 0 ? Math.round((totalLaborCost / totalCV) * 100) : 0;
            return {
              eyebrow: "FINANCIAL HEALTH · LIVE CALCULATION",
              scoreLabel: "margin",
              scoreFormatted: `${laborMarginPct}%`,
              currentReading: `${lmPool.length} active project${lmPool.length === 1 ? "" : "s"} with contracted labor revenue and estimated final cost on file`,
              howCalculated: `Of every dollar clients pay us on active projects, this shows how much we expect to keep as profit once the project is finished, after covering the full estimated cost to deliver it. At 55%, we keep $0.55 of every dollar. Below 40%, projects risk not covering the firm's overhead — they may end up losing money. If this looks low, check which projects are the biggest drag and confirm any extra work has an approved change order so it can be billed.`,
              formula: `Profit ÷ Contract value = (${fmtMoney(totalCV)} − ${fmtMoney(totalLaborCost)}) ÷ ${fmtMoney(totalCV)} = ${marginPct}%`,
              dataSource: "LEM (Financial)",
              liveData: {
                title: `LIVE DATA · ${lmPool.length} PROJECT${lmPool.length === 1 ? "" : "S"}`,
                rows: [
                  {
                    label: "What clients are paying us (contract value) ↓",
                    value: fmtMoney(totalCV),
                    sortKey: "revenue",
                    sortTitle: "WHAT CLIENTS ARE PAYING US (CONTRACT VALUE)",
                    sortTotal: fmtMoney(totalCV),
                  },
                  {
                    label: "What we expect it to cost us in total ↓",
                    value: fmtMoney(totalLaborCost),
                    sortKey: "cost",
                    sortTitle: "WHAT WE EXPECT IT TO COST US IN TOTAL",
                    sortTotal: fmtMoney(totalLaborCost),
                  },
                  {
                    label: "What we keep as profit ↓",
                    value: fmtMoney(totalProfit),
                    sortKey: "profit",
                    sortTitle: "WHAT WE KEEP AS PROFIT",
                    sortTotal: fmtMoney(totalProfit),
                  },
                  { label: "Profit as a % of what clients pay us",        value: `${marginPct}%` },
                  { label: "Return per $1 spent",                         value: `$${returnPer1}` },
                  { label: "% of contract value allocated to labor cost", value: `${laborCostRatioPct}%` },
                ],
              },
              projects: lmPool.map((p) => {
                const cv  = getValue(p);
                const lca = Number(p?.LaborContractAmount ?? 0);
                const pft = cv - lca;
                return {
                  label: `${ticketOf(p)} · ${getProjectTitle(p)}`,
                  values: {
                    revenue: { raw: cv,  str: fmtMoney(cv) },
                    cost:    { raw: lca, str: fmtMoney(lca) },
                    profit:  { raw: pft, str: fmtMoney(pft) },
                  },
                };
              }),
              impact: `Across ${lmPool.length} active project${lmPool.length === 1 ? "" : "s"}, we're on track to keep ${fmtMoney(totalProfit)} of the ${fmtMoney(totalCV)} clients are paying us — that's a ${marginPct}% profit margin${marginPct >= 55 ? ", above our 55% target" : marginPct >= 40 ? ", approaching our 55% target" : " — below our 55% target, which means projects may not be covering overhead"}. For every $1 we spend, we bring in $${returnPer1}. ${laborCostRatioPct}% of the contract value has been allocated to labor costs.`,
              tableTitle: `LABOR MARGIN · ACTIVE PROJECTS`,
            };
          })() : undefined,
        },
        {
          label: "Hours on plan",
          value: hoursOnPlanScore ?? 0,
          available: hoursOnPlanScore != null,
          raw: hoursOnPlanScore != null
            ? `${hoursOnPlanScore}% of staff in ${hiRules.underAllocatedPct}–${hiRules.overCapacityPct}% utilization band · ${hoursInBandCount} of ${allocResList.length} people`
            : "Not available yet",
          windowLabel: hoursOnPlanScore != null ? windowShort : undefined,
          tone: (hoursOnPlanScore ?? 0) >= 60 ? "good" : "warn",
          records: hoursOnPlanRecords ?? undefined,
          formulaDetail: hoursOnPlanScore != null ? (() => {
            if (hasHoursData) {
              // ── Hours-based view (when PMM carries ContractHours / ActualHrs / FutureHrs) ──
              return {
                eyebrow: "FINANCIAL HEALTH · LIVE CALCULATION",
                scoreLabel: "score",
                currentReading: `${hoursInBandCount} of ${allocResList.length} staff (${hoursOnPlanScore}%) inside the healthy ${hiRules.underAllocatedPct}–${hiRules.overCapacityPct}% utilization band · ${hoursProjectPool.length} active PMM project${hoursProjectPool.length === 1 ? "" : "s"} with contracted and forecasted hours on file`,
                howCalculated: [
                  `The score is the share of staff on window projects whose booked utilization sits inside the healthy band (${hiRules.underAllocatedPct}–${hiRules.overCapacityPct}%). The contracted-hours figures below are the project-side context for that reading.`,
                  ``,
                  `PMM (Project Management Module) is where all active delivery projects live — it holds the contract, the schedule, and the planned hours for each project. LEM (Labour & Engagement Module) is the source for actual hours already spent (ActualHrs) and remaining hours still planned (FutureHrs). Together, PMM + LEM tell us how much of the contracted scope has a real plan behind it.`,
                  ``,
                  `Contract Hours (Baseline) — this is what the client is paying for, measured in hours of effort. This is the firm's commitment.`,
                  `Forecast Hours (Actual + Remaining) — how many hours have actually been logged or are still planned. This is what the firm currently expects to deliver.`,
                  `Headroom / (Overrun) — the gap between what's contracted and what's forecast. Positive = still room in the contract. Negative = we're forecasting more work than was contracted (scope creep).`,
                  ``,
                  `Below 100% means some contracted scope has no plan behind it yet — the work hasn't been scheduled. Above 100% means forecast hours exceed contracted hours, which is a scope risk that needs a change order to bill the extra work.`,
                ].join("\n"),
                formula: `Staff in ${hiRules.underAllocatedPct}–${hiRules.overCapacityPct}% band ÷ Staff on window projects × 100 = ${hoursInBandCount} ÷ ${allocResList.length} × 100 = ${hoursOnPlanScore}%`,
                dataSource: "PMM · LEM (Financial)",
                liveData: {
                  title: `LIVE DATA · ${hoursProjectPool.length} PROJECT${hoursProjectPool.length === 1 ? "" : "S"} · PMM · LEM`,
                  rows: [
                    {
                      label: `Contract Hours (Baseline) ↓  ·  PMM · CONTRACTHOURS`,
                      value: fmtHrs(totalContractHrs),
                      sortKey: "contract",
                      sortTitle: "CONTRACT HOURS (BASELINE)",
                      sortTotal: fmtHrs(totalContractHrs),
                    },
                    {
                      label: `Forecast Hours (Actual + Remaining) ↓  ·  PMM · ACTUALHRS + FUTUREHRS`,
                      value: fmtHrs(totalForecastHrs),
                      highlight: true,
                      sortKey: "forecast",
                      sortTitle: "FORECAST HOURS (ACTUAL + REMAINING)",
                      sortTotal: fmtHrs(totalForecastHrs),
                    },
                    {
                      label: `Headroom / (Overrun) ↓  ·  DERIVED`,
                      value: fmtHrs(headroomHrs),
                      sortKey: "headroom",
                      sortTitle: "HEADROOM / (OVERRUN)",
                      sortTotal: fmtHrs(headroomHrs),
                    },
                    {
                      label: `Forecast Coverage % (Forecast ÷ Contract)  ·  DERIVED`,
                      value: forecastCovPct != null ? `${forecastCovPct}%` : "—",
                    },
                    {
                      label: `Allocation Growth %  ·  DERIVED`,
                      value: allocGrowthPct != null ? `${allocGrowthPct}%` : "—",
                    },
                  ],
                },
                projects: hoursProjectPool.map((p) => {
                  const cHrs = Number(p?.ContractHours ?? 0);
                  const fHrs = Number(p?.ActualHrs ?? 0) + Number(p?.FutureHrs ?? 0);
                  const hHrs = cHrs - fHrs;
                  return {
                    label: `${ticketOf(p)} · ${getProjectTitle(p)}`,
                    values: {
                      contract: { raw: cHrs,  str: fmtHrs(cHrs) },
                      forecast: { raw: fHrs,  str: fmtHrs(fHrs) },
                      headroom: { raw: hHrs,  str: fmtHrs(hHrs) },
                    },
                  };
                }),
                impact: `${hoursInBandCount} of ${allocResList.length} staff (${hoursOnPlanScore}%) are booked inside the healthy utilization band. On the project side: ${forecastCovPct}% of the contracted hours (${fmtHrs(totalContractHrs)}) have been scheduled/forecast so far (${fmtHrs(totalForecastHrs)}) — ${fmtHrs(Math.max(0, headroomHrs))} hrs of contracted hours still not planned. Allocation Growth is ${allocGrowthPct}%.`,
                tableTitle: `HOURS ON PLAN · ACTIVE PROJECTS`,
              };
            } else {
              // ── Proxy-hours fallback (derive from allocation % × 40 hrs/wk × window) ──
              // Every tenant has allocation data, so we always show real hours here.
              const windowLabel = `${Math.round(allocWeeks * 10) / 10}-wk window`;
              return {
                eyebrow: "FINANCIAL HEALTH · LIVE CALCULATION",
                scoreLabel: "score",
                currentReading: `${hoursInBandCount} of ${allocResList.length} staff (${hoursOnPlanScore}%) inside the healthy ${hiRules.underAllocatedPct}–${hiRules.overCapacityPct}% utilization band · ${fmtHrs(allocForecastHrs)} of ${fmtHrs(allocCapacityHrs)} capacity forecast across the ${windowLabel}`,
                howCalculated: [
                  `The score is the share of tracked staff whose booked utilization sits inside the healthy band (${hiRules.underAllocatedPct}–${hiRules.overCapacityPct}%). The capacity-hours figures below are the workforce-side context for that reading.`,
                  ``,
                  `PMM (Project Management Module) holds the active delivery projects — scope, schedule, and ownership. LEM (Labour & Engagement Module) holds Resource Allocations: the percentage of each person's working week committed to a project. Together they let us compute how many hours of workforce capacity are actually on plan.`,
                  ``,
                  `Capacity Hours — the total available hours if every tracked staff member works a full ${hrsPerWeek}-hour week for the ${windowLabel}: ${allocResList.length} staff × ${hrsPerWeek} hrs/wk × ${Math.round(allocWeeks * 10) / 10} wks = ${fmtHrs(allocCapacityHrs)}.`,
                  `Forecast Hours — hours actually committed to projects, derived from each person's allocation %: if someone is at 75%, they contribute 0.75 × ${hrsPerWeek} hrs/wk × ${Math.round(allocWeeks * 10) / 10} wks.`,
                  `Available / Idle Hours — the gap between capacity and what's been planned. This is the firm's undeployed labour cost for the period.`,
                  ``,
                  `A score of ${hoursOnPlanScore}% means ${hoursInBandCount} of ${allocResList.length} tracked staff are booked inside the healthy band. Separately, workforce utilization (forecast ÷ capacity) is ${allocUtilPct}% — the rest of the capacity either has no allocation behind it yet, or staff are over-committed.`,
                ].join("\n"),
                formula: `Staff in ${hiRules.underAllocatedPct}–${hiRules.overCapacityPct}% band ÷ Tracked staff × 100 = ${hoursInBandCount} ÷ ${allocResList.length} × 100 = ${hoursOnPlanScore}%`,
                dataSource: "LEM · RESOURCE ALLOC",
                liveData: {
                  title: `LIVE DATA · ${allocResList.length} STAFF · LEM · RESOURCE ALLOC`,
                  rows: [
                    {
                      label: `Capacity Hours (${allocResList.length} staff × ${hrsPerWeek} hrs/wk × ${Math.round(allocWeeks * 10) / 10} wks) ↓  ·  RESOURCE ALLOC`,
                      value: fmtHrs(allocCapacityHrs),
                      sortKey: "capacity",
                      sortTitle: "CAPACITY HOURS",
                      sortTotal: fmtHrs(allocCapacityHrs),
                    },
                    {
                      label: `Forecast Hours (Planned Allocations) ↓  ·  LEM · RESOURCE ALLOC`,
                      value: fmtHrs(allocForecastHrs),
                      highlight: true,
                      sortKey: "forecast",
                      sortTitle: "FORECAST HOURS (PLANNED)",
                      sortTotal: fmtHrs(allocForecastHrs),
                    },
                    {
                      label: `Available / Idle Hours ↓  ·  DERIVED`,
                      value: fmtHrs(allocBenchHrs),
                      sortKey: "bench",
                      sortTitle: "AVAILABLE / IDLE HOURS",
                      sortTotal: fmtHrs(allocBenchHrs),
                    },
                    {
                      label: `Workforce Utilization %  ·  DERIVED`,
                      value: `${allocUtilPct}%`,
                    },
                  ],
                },
                projects: allocStaffProjects,
                impact: [
                  `${hoursInBandCount} of ${allocResList.length} staff (${hoursOnPlanScore}%) are booked inside the healthy ${hiRules.underAllocatedPct}–${hiRules.overCapacityPct}% band.`,
                  `Capacity — ${fmtHrs(allocCapacityHrs)} — ${allocResList.length} staff at ${hrsPerWeek} hrs/wk × ${Math.round(allocWeeks * 10) / 10} wks`,
                  `Forecast Hours — ${fmtHrs(allocForecastHrs)} — ${allocUtilPct}% of capacity currently on plan`,
                  `Available / Idle — ${fmtHrs(allocBenchHrs)} — ${100 - allocUtilPct}% of labour capacity not yet allocated`,
                ].join("\n"),
                tableTitle: `HOURS ON PLAN · ACTIVE STAFF`,
              };
            }
          })() : undefined,
        },
        {
          label: "Labor completion",
          value: laborCompletionScore ?? 0,
          available: laborCompletionScore != null,
          raw: laborCompletionScore != null
            ? hasLaborHoursData
              ? `${fmtHrs(totalActualHrs)} of ${fmtHrs(totalForecastHrs)} forecasted labor hours complete, across ${laborProjectPool.length} project${laborProjectPool.length === 1 ? "" : "s"}`
              : `${engagedCount} of ${allocResList.length} staff engaged · ${benchListCount} on bench`
            : "Not available yet",
          windowLabel: laborCompletionScore != null ? windowShort : undefined,
          tone: (laborCompletionScore ?? 0) >= 70 ? "good" : "warn",
          records: laborCompletionRecords ?? undefined,
          formulaDetail: laborCompletionScore != null ? (() => {
            if (hasLaborHoursData) {
              const completionPct = laborCompletionHoursScore ?? 0;
              const cycleStage = completionPct < 20 ? "Early-cycle — normal. Monitor delivery velocity as projects ramp."
                : completionPct < 50 ? "Mid-cycle — delivery is underway. Watch for scope additions."
                : completionPct < 80 ? "Mature phase — most contracted work is now in progress or complete."
                : "Late-cycle — most projects are near the finish line. Verify remaining-hours estimates are accurate.";
              return {
                eyebrow: "FINANCIAL HEALTH · LIVE CALCULATION",
                scoreLabel: "score",
                currentReading: `${fmtHrs(totalActualHrs)} of ${fmtHrs(totalForecastHrs)} forecasted labor hours complete, across ${laborProjectPool.length} project${laborProjectPool.length === 1 ? "" : "s"}`,
                howCalculated: [
                  `Shows how much of the planned project work hours have already been completed. At 80%+, most projects are near the finish line — make sure estimated remaining hours are accurate, as underestimating remaining work at this stage is a common cause of cost overruns at project close. Below 20% is normal early in a project lifecycle. A score that stays flat over time may indicate teams are stalled or project progress is not being recorded.`,
                  ``,
                  `Actual Hours Worked (ActualHrs) — hours already spent and logged on the project. This comes directly from PMM project records.`,
                  `Total Forecast Hours — the full planned scope: what's been done plus what remains (ActualHrs + FutureHrs).`,
                  `Remaining Hours / ETC — Estimate to Complete. The hours still needed to finish all active project work.`,
                ].join("\n"),
                formula: `Actual ÷ Forecast × 100 = ${fmtHrs(totalActualHrs)} ÷ ${fmtHrs(totalForecastHrs)} × 100 = ${completionPct}%`,
                dataSource: "PMM · LEM (Financial)",
                liveData: {
                  title: `LIVE DATA · ${laborProjectPool.length} PROJECT${laborProjectPool.length === 1 ? "" : "S"} · PMM · LEM`,
                  subtitle: "PMM delivery projects only (OPM pipeline excluded) — hours from LEM (Financial)",
                  rows: [
                    {
                      label: `Actual Hours Worked  ·  PMM · ACTUALHRS`,
                      value: fmtHrs(totalActualHrs),
                      sortKey: "actual",
                      sortTitle: "ACTUAL HOURS WORKED",
                      sortTotal: fmtHrs(totalActualHrs),
                    },
                    {
                      label: `Total Forecast Hours  ·  PMM · ACTUALHRS + FUTUREHRS`,
                      value: fmtHrs(totalForecastHrs),
                      highlight: true,
                      sortKey: "forecast",
                      sortTitle: "TOTAL FORECAST HOURS",
                      sortTotal: fmtHrs(totalForecastHrs),
                    },
                    {
                      label: `Remaining Hours (ETC)  ·  PMM · FUTUREHRS`,
                      value: fmtHrs(totalFutureHrs),
                      sortKey: "remaining",
                      sortTitle: "REMAINING HOURS (ETC)",
                      sortTotal: fmtHrs(totalFutureHrs),
                    },
                  ],
                },
                projects: laborProjectPool.map((p) => {
                  const act = Number(p?.ActualHrs ?? 0);
                  const rem = Number(p?.FutureHrs ?? 0);
                  const fcs = act + rem;
                  return {
                    label: `${ticketOf(p)} · ${getProjectTitle(p)}`,
                    values: {
                      actual:    { raw: act, str: fmtHrs(act) },
                      forecast:  { raw: fcs, str: fmtHrs(fcs) },
                      remaining: { raw: rem, str: fmtHrs(rem) },
                    },
                  };
                }),
                impact: `Across ${laborProjectPool.length} active project${laborProjectPool.length === 1 ? "" : "s"}, RM ONE has completed ${fmtHrs(totalActualHrs)} of ${fmtHrs(totalForecastHrs)} forecasted labor hours (${completionPct}%). ${fmtHrs(totalFutureHrs)} remain in the plan. ${cycleStage}`,
                tableTitle: "LABOR COMPLETION · ACTIVE PROJECTS",
              };
            } else {
              // ── Proxy fallback: engagement-based when no hours data ──
              const completionPct = laborCompletionScore ?? 0;
              return {
                eyebrow: "FINANCIAL HEALTH · LIVE CALCULATION",
                scoreLabel: "score",
                currentReading: `${engagedCount} of ${allocResList.length} staff currently engaged on active PMM projects`,
                howCalculated: [
                  `Shows how much of the active workforce is currently deployed on project work. When project-level hours data (ActualHrs / FutureHrs) is not yet available from PMM, this uses staff engagement as a proxy: a person is "engaged" if their allocation percentage is above 0%.`,
                  ``,
                  `This is a leading indicator — a fully engaged team doesn't guarantee progress is being recorded, but a low engagement rate (many people on bench) is a clear signal that work is not yet mobilised.`,
                  ``,
                  `When PMM project hours fields become populated (ActualHrs, FutureHrs), this metric will automatically switch to the richer Actual ÷ Forecast calculation.`,
                ].join("\n"),
                formula: `Engaged staff ÷ Total staff × 100 = ${engagedCount} ÷ ${allocResList.length} × 100 = ${completionPct}%`,
                dataSource: "LEM · RESOURCE ALLOC",
                liveData: {
                  title: `LIVE DATA · ${allocResList.length} STAFF · LEM · RESOURCE ALLOC`,
                  rows: [
                    {
                      label: `Forecast Hours (Engaged Staff × Allocation %) ↓  ·  LEM · RESOURCE ALLOC`,
                      value: fmtHrs(allocForecastHrs),
                      highlight: true,
                      sortKey: "forecast",
                      sortTitle: "FORECAST HOURS (PLANNED)",
                      sortTotal: fmtHrs(allocForecastHrs),
                    },
                    {
                      label: `Capacity Hours (Total Headcount) ↓  ·  RESOURCE ALLOC`,
                      value: fmtHrs(allocCapacityHrs),
                      sortKey: "capacity",
                      sortTitle: "CAPACITY HOURS",
                      sortTotal: fmtHrs(allocCapacityHrs),
                    },
                    {
                      label: `Workforce Engagement %  ·  DERIVED`,
                      value: `${completionPct}%`,
                    },
                  ],
                },
                projects: allocStaffProjects,
                impact: [
                  `Engaged — ${engagedCount} staff — ${completionPct}% of the active workforce deployed`,
                  `Bench — ${benchListCount} staff — not yet assigned to active project work`,
                ].join("\n"),
                tableTitle: "LABOR COMPLETION · ACTIVE STAFF",
              };
            }
          })() : undefined,
        },
        {
          label: "Cost coverage",
          value: costCoverageScore ?? 0,
          available: costCoverageScore != null,
          raw: costCoverageScore != null
            ? hasCoverageData
              ? `Remaining revenue is ${fmtRatio(costCoverageRatio)} remaining planned cost across ${costCoveragePool.length} project${costCoveragePool.length === 1 ? "" : "s"} with revenue and cost on file`
              : `${cfoPool.length - cfoAtRisk.length} of ${cfoPool.length} projects healthy · ${cfoAtRisk.length} at-risk`
            : "Not available yet",
          windowLabel: costCoverageScore != null ? windowShort : undefined,
          tone: (costCoverageScore ?? 0) >= 80 ? "good" : "warn",
          records: costCoverageRecords ?? undefined,
          formulaDetail: costCoverageScore != null ? (() => {
            if (hasCoverageData) {
              const ratioStr = fmtRatio(costCoverageRatio);
              const healthNote = costCoverageRatio >= 2.0
                ? "strong remaining financial capacity across the portfolio."
                : costCoverageRatio >= 1.2
                  ? "comfortable financial headroom across the portfolio."
                  : costCoverageRatio >= 1.0
                    ? "thin margins — revenue barely covers remaining planned cost."
                    : "cost overrun risk — remaining planned cost exceeds remaining revenue. Review project scope or pending change orders immediately.";
              return {
                eyebrow: "FINANCIAL HEALTH · LIVE CALCULATION",
                scoreLabel: "coverage",
                scoreFormatted: ratioStr,
                currentReading: `Remaining revenue is ${ratioStr} remaining planned cost across ${costCoveragePool.length} project${costCoveragePool.length === 1 ? "" : "s"} with revenue and cost on file`,
                howCalculated: [
                  `This measures whether the remaining contract value is enough to cover the remaining planned cost to finish the work. A ratio above 1.2 means there's comfortable financial headroom — for every dollar of planned remaining cost, there's $1.20+ of remaining contract to cover it. Below 1.0 means the firm expects to spend more finishing the work than the contract will pay for — those projects will produce a loss unless a change order is approved or costs are cut immediately. Only projects with both a labor revenue figure and remaining planned cost (ETC) on file in RM ONE are included — projects missing either value are excluded from this calculation.`,
                ].join("\n"),
                formula: `Cost Coverage = Remaining Revenue ÷ ETC = ${fmtMoney(remainingRevenue)} ÷ ${fmtMoney(totalFutureCostCC)} = ${ratioStr} coverage → gauge score = ${ratioStr} ÷ 3.00× (capped at 100) = ${costCoverageScore}%`,
                dataSource: "PMM · LEM (Financial)",
                liveData: {
                  title: `LIVE DATA · ${costCoveragePool.length} PROJECT${costCoveragePool.length === 1 ? "" : "S"}  LEM (FINANCIAL)`,
                  subtitle: "Projects with labor revenue and remaining planned cost (ETC) on file",
                  rows: [
                    {
                      label: `Contract Value (Labor Revenue)  ·  PMM · LABORREVENUE`,
                      value: fmtMoney(totalLaborRevenue),
                      sortKey: "revenue",
                      sortTitle: "CONTRACT VALUE (LABOR REVENUE)",
                      sortTotal: fmtMoney(totalLaborRevenue),
                    },
                    {
                      label: `Actual Cost to Date  ·  PMM · ACTUALCOST`,
                      value: fmtMoney(totalActualCostCC),
                    },
                    {
                      label: `Remaining Revenue  ·  DERIVED`,
                      value: fmtMoney(remainingRevenue),
                    },
                    {
                      label: `ETC (Remaining Planned Cost)  ·  PMM · FUTURECOST`,
                      value: fmtMoney(totalFutureCostCC),
                      sortKey: "etc",
                      sortTitle: "ETC (REMAINING PLANNED COST)",
                      sortTotal: fmtMoney(totalFutureCostCC),
                    },
                    {
                      label: `Cost Coverage (Remaining Rev ÷ ETC)  ·  DERIVED`,
                      value: ratioStr,
                      highlight: true,
                      sortKey: "coverage",
                      sortTitle: "COST COVERAGE RATIO",
                      sortTotal: ratioStr,
                    },
                    {
                      label: `Gauge score (coverage ÷ 3.00×, capped at 100)  ·  DERIVED`,
                      value: `${costCoverageScore}%`,
                    },
                  ],
                },
                projects: costCoveragePool
                  .map((p) => {
                    const rev = Number(p?.LaborRevenue ?? 0);
                    const act = Number(p?.ActualCost   ?? 0);
                    const etc = Number(p?.FutureCost   ?? 0);
                    const remRev = rev - act;
                    const r = etc > 0 ? remRev / etc : 0;
                    return {
                      label: `${ticketOf(p)} · ${getProjectTitle(p)}`,
                      values: {
                        revenue:  { raw: rev, str: fmtMoney(rev) },
                        etc:      { raw: etc, str: fmtMoney(etc) },
                        // Store negative so descending sort = ascending by ratio (most at-risk first)
                        coverage: { raw: -r,  str: fmtRatio(r)  },
                      },
                    };
                  }),
                impact: `Across ${costCoveragePool.length} active project${costCoveragePool.length === 1 ? "" : "s"}, RM ONE's remaining revenue (${fmtMoney(remainingRevenue)}) is ${ratioStr} the remaining planned cost (${fmtMoney(totalFutureCostCC)}) — ${healthNote}`,
                tableTitle: "COST COVERAGE · ACTIVE PROJECTS",
              };
            } else {
              // Fallback: at-risk project health (no financial data)
              const healthyCount = cfoPool.length - cfoAtRisk.length;
              return {
                eyebrow: "FINANCIAL HEALTH · LIVE CALCULATION",
                scoreLabel: "score",
                currentReading: `${healthyCount} of ${cfoPool.length} projects are healthy · ${cfoAtRisk.length} flagged at-risk or on-hold`,
                howCalculated: [
                  `Shows what share of active projects are NOT flagged as at-risk, on-hold, critical, or over-run. This is a proxy metric for financial health — projects in those states are likely incurring cost overruns or delays that affect revenue.`,
                  ``,
                  `When PMM project financial fields (LaborRevenue, FutureCost) become populated, this metric will automatically switch to the richer Remaining Revenue ÷ ETC calculation, which directly measures whether remaining contract value covers the remaining planned cost.`,
                ].join("\n"),
                formula: `Healthy projects ÷ Total projects × 100 = ${healthyCount} ÷ ${cfoPool.length} × 100 = ${costCoverageScore}%`,
                dataSource: "PMM · PROJECT STATUS",
                impact: `${healthyCount} of ${cfoPool.length} projects are currently in a healthy status. ${cfoAtRisk.length > 0 ? `${cfoAtRisk.length} project${cfoAtRisk.length === 1 ? " is" : "s are"} flagged at-risk or on-hold — review these for cost exposure.` : "No projects are flagged at-risk."}`,
                tableTitle: "PROJECT HEALTH · ACTIVE PROJECTS",
              };
            }
          })() : undefined,
        },
        {
          label: "Alloc on plan",
          value: allocResList.length > 0 ? allocAvgPct : 0,
          available: allocOnPlanScore != null,
          raw: allocOnPlanScore != null
            ? `${allocOnPlanScore}% of staff in ${hiRules.underAllocatedPct}–${hiRules.overCapacityPct}% utilization band · ${allocOnBandCount} of ${allocResList.length} people`
            : "Not available yet",
          windowLabel: allocOnPlanScore != null ? windowShort : undefined,
          tone: (allocOnPlanScore ?? 0) >= 60 ? "good" : "warn",
          records: allocOnPlanRecords ?? undefined,
          formulaDetail: allocOnPlanScore != null ? (() => {
            const n = allocResList.length;
            const totalAllocPct = allocResList.reduce(
              (s, r) => s + Math.round(Number(r?.currentPct ?? 0)), 0,
            );
            const avgPct = allocAvgPct;
            const overCount = allocResList.filter(
              (r) => Number(r?.currentPct ?? 0) >= hiRules.overCapacityPct,
            ).length;
            const allocPeople = allocResList
              .slice()
              .sort((a, b) => Number(b?.currentPct ?? 0) - Number(a?.currentPct ?? 0))
              .map((r) => {
                const pct = Math.round(Number(r?.currentPct ?? 0));
                return {
                  label: String(r?.name ?? "—"),
                  values: {
                    pct: { raw: pct, str: `${pct}%`, highlight: pct >= hiRules.overCapacityPct },
                  },
                };
              });
            return {
              eyebrow: "FINANCIAL HEALTH · LIVE CALCULATION",
              scoreLabel: "avg alloc",
              scoreFormatted: `${avgPct}%`,
              currentReading: `${avgPct}% booked on average, across ${n} actively-engaged people`,
              howCalculated: [
                "Shows the mean booked allocation percentage across everyone actively engaged on a project right now.",
                "",
                "This is a resource-capacity reading, not a project-scope reading — it tells you how heavily the workforce is currently booked, on average.",
                "",
                `Anyone booked at ${hiRules.overCapacityPct}% or more is flagged as an overload risk.`,
              ].join("\n"),
              formula: `Average Resource Allocation = ${totalAllocPct}% total ÷ ${n} people = ${avgPct}% booked`,
              dataSource: "GetResourceAllocations",
              liveData: {
                title: `LIVE DATA · ${n} ACTIVELY-ENGAGED PEOPLE`,
                badge: "ALL PROJECTS",
                subtitle: "Org-wide snapshot — covers PMM delivery, OPM pursuits, and all active work items",
                rows: [
                  { label: "Actively-Engaged People", value: `${n}` },
                  { label: "Average Resource Allocation", value: `${avgPct}%` },
                  { label: `Booked ${hiRules.overCapacityPct}%+`, value: `${overCount}`, highlight: overCount > 0, sortKey: "pct", sortTitle: `${n}` },
                ],
              },
              projects: allocPeople,
              projectsTableTitle: "ACTIVELY-ENGAGED PEOPLE",
              tableTitle: `ALLOCATION · ${n} STAFF`,
              impact: `${avgPct}% booked on average across ${n} actively-engaged people. ${overCount > 0 ? `${overCount} ${overCount === 1 ? "person is" : "people are"} booked at ${hiRules.overCapacityPct}%+ capacity — review for overload risk.` : "No staff are currently over capacity."}`,
            };
          })() : undefined,
        },
      ];
      break;
    case "RESOURCE_MANAGER":
      healthLabel = "Capacity Health";
      subDrivers = [
        {
          label: "Bench coverage",
          value: winBenchAvailable ? winBenchScore : benchScore,
          available: winBenchAvailable || benchAvailable,
          raw: winBenchAvailable
            ? `${benchInWindowCount} of ${allAllocResources.length} unallocated ${winNatProse} (${winBenchIdlePct}% idle)`
            : benchAvailable
              ? `${benchCount} of ${benchTotal} on bench (${benchIdlePct}% idle)`
              : "Not available yet",
          windowLabel: winBenchAvailable ? windowShort : undefined,
          formulaDetail: (winBenchAvailable || benchAvailable) ? {
            eyebrow: "CAPACITY HEALTH · LIVE SIGNAL",
            currentReading: winBenchAvailable
              ? `${benchInWindowCount} of ${allAllocResources.length} resources have no active assignment ${winNatProse} (${winBenchIdlePct}% idle).`
              : `${benchCount} of ${benchTotal} resources are on the bench with no current allocation (${benchIdlePct}% idle).`,
            howCalculated: `Measures the share of the managed workforce actively engaged on at least one project or assignment in the selected window. Score = 100 − idle% so that higher always means healthier — a large idle bench drags the score down. Over-allocation is tracked separately by "Overload roles".`,
            formula: winBenchAvailable
              ? `Active Resources ÷ Total Workforce × 100 = ${resourcesActiveInWindow.length} ÷ ${allAllocResources.length} × 100 → Score = 100 − ${winBenchIdlePct}% = ${winBenchScore}%`
              : `Engaged Resources ÷ Total Workforce × 100 = ${benchTotal - benchCount} ÷ ${benchTotal} × 100 → Score = 100 − ${benchIdlePct}% = ${benchScore}%`,
            dataSource: "GetResourceAllocations · RM ONE·LIVE",
            impact: winBenchAvailable
              ? (winBenchScore >= 75
                  ? `Utilisation is strong — ${resourcesActiveInWindow.length} of ${allAllocResources.length} resources are actively engaged ${winNatProse}. Keep aligning upcoming demand with available capacity.`
                  : winBenchScore >= 50
                    ? `${benchInWindowCount} resource${benchInWindowCount === 1 ? " has" : "s have"} no active project ${winNatProse}. Review open demand positions and match bench resources to upcoming work before the window closes.`
                    : `${benchInWindowCount} of ${allAllocResources.length} resources are idle ${winNatProse} — a significant utilisation gap. Assign bench resources to active projects or open requisitions to recover billable capacity.`)
              : (benchScore >= 75
                  ? `Most of the workforce is engaged. ${benchCount} ${benchCount === 1 ? "person is" : "people are"} currently on the bench with no active allocation.`
                  : `${benchCount} of ${benchTotal} resources have no active allocation — bench time is a direct cost with no billable recovery. Prioritise matching bench resources with open demand.`),
            tableTitle: winBenchAvailable
              ? `BENCH PEOPLE · NO ACTIVE ASSIGNMENT ${winNatProse.toUpperCase()}`
              : "BENCH PEOPLE · 0% ALLOCATED RIGHT NOW",
          } : undefined,
          records: winBenchAvailable
            ? (winBenchResList.length > 0 ? {
                title: `Bench people · no active assignment ${winNatProse}`,
                subtitle: `${winBenchResList.length} of ${allAllocResources.length} resources unallocated ${winNatProse}`,
                columns: [
                  { key: "name", label: "Name" },
                  { key: "pct", label: "Current Alloc.", align: "right" as const, note: "What percentage of this person's working hours is booked right now" },
                ],
                rows: winBenchResList.slice(0, MAX_DETAIL_ROWS).map((r) => ({
                  name: String((r as any)?.name ?? "—"),
                  pct: `${Math.round(Number((r as any)?.currentPct ?? 0))}%`,
                })),
                emptyText: "All resources have active assignments in this window.",
              } : undefined)
            : (benchAvailable ? benchRecords : undefined),
        },
        {
          label: "Overload roles",
          value: winBenchAvailable ? winOverloadScore : (overloadRolesScore ?? 0),
          available: winBenchAvailable || overloadRolesScore != null,
          raw: winBenchAvailable
            ? `${winOverloadCount} of ${winActiveCount} active resources at ${hiRules.overCapacityPct}%+ ${winNatProse}`
            : overloadRolesScore != null
              ? `${overloadRoleCount}/${totalRoleCount} roles > 1.0 FTE`
              : "Not available yet",
          windowLabel: winBenchAvailable ? windowShort : (overloadRolesScore != null ? windowShort : undefined),
          formulaDetail: (winBenchAvailable || overloadRolesScore != null) ? (() => {
            const rules = getBusinessRules();
            const overloadPct = winBenchAvailable
              ? Math.round((winOverloadCount / Math.max(1, winActiveCount)) * 100)
              : Math.round((overloadRoleCount / Math.max(1, totalRoleCount)) * 100);
            const scoreVal = winBenchAvailable ? winOverloadScore : (overloadRolesScore ?? 0);
            return {
              eyebrow: "CAPACITY HEALTH · LIVE SIGNAL",
              currentReading: winBenchAvailable
                ? `${winOverloadCount} of ${winActiveCount} active resource${winOverloadCount === 1 ? " is" : "s are"} operating at or above ${rules.overCapacityPct}% allocation ${winNatProse} (${overloadPct}% overloaded).`
                : `${overloadRoleCount} of ${totalRoleCount} role${overloadRoleCount === 1 ? "" : "s"} exceed 1.0 FTE demand — these disciplines are a delivery bottleneck.`,
              howCalculated: winBenchAvailable
                ? `Counts active resources ${winNatProse} whose current allocation reaches ${rules.overCapacityPct}% or more. Each overloaded person is a delivery risk — they are spread across more work than they can sustainably cover, raising the probability of slippage, burnout, or dropped tasks.`
                : `Tracks how many job-role disciplines have aggregate demand (sum of PctAllocation across open requisitions) above 1.0 FTE. An overloaded role is a bottleneck: work that needs that skill cannot move forward without pulling someone from elsewhere or bringing in outside help.`,
              formula: winBenchAvailable
                ? `Score = 100 − (Overloaded Resources ÷ Active Resources × 120) = 100 − (${winOverloadCount} ÷ ${winActiveCount} × 120) = 100 − ${Math.round((winOverloadCount / Math.max(1, winActiveCount)) * 120)}% = ${scoreVal}%`
                : `Score = 100 − (Overloaded Roles ÷ Total Roles × 120) = 100 − (${overloadRoleCount} ÷ ${totalRoleCount} × 120) = ${scoreVal}%`,
              dataSource: "GetResourceAllocations · RM ONE·LIVE",
              impact: winBenchAvailable
                ? (winOverloadCount === 0
                    ? `No active resources are at ${rules.overCapacityPct}%+ ${winNatProse}. Workload is well-distributed across the team — capacity is available to absorb new demand.`
                    : winOverloadScore >= 75
                      ? `${winOverloadCount} resource${winOverloadCount === 1 ? " is" : "s are"} overloaded ${winNatProse}. Workload is mostly balanced — review the affected ${winOverloadCount === 1 ? "person's" : "people's"} project load and redistribute where possible.`
                      : `${winOverloadCount} of ${winActiveCount} active resources are operating above capacity ${winNatProse}. Widespread overloading increases delivery risk across the portfolio. Prioritise rebalancing project allocations or hiring to fill the gap.`)
                : (overloadRoleCount === 0
                    ? `No role disciplines are over-subscribed. Current demand is well-matched to available capacity.`
                    : `${overloadRoleCount} of ${totalRoleCount} role${overloadRoleCount === 1 ? "" : "s"} ${overloadRoleCount === 1 ? "is" : "are"} bottlenecked. Projects depending on ${overloadRoleCount === 1 ? "this discipline" : "these disciplines"} face delivery risk until capacity is added or demand is deferred.`),
              tableTitle: winBenchAvailable
                ? `OVERLOADED RESOURCES · ${rules.overCapacityPct}%+ ${winNatProse.toUpperCase()}`
                : "ROLE LOAD · CONCURRENT DEMAND BY ROLE",
            };
          })() : undefined,
          records: winBenchAvailable
            ? (overloadedInWindow.length > 0 ? {
                title: `Overloaded resources · ${hiRules.overCapacityPct}%+ allocation ${winNatProse}`,
                subtitle: `${overloadedInWindow.length} of ${winActiveCount} active resource${overloadedInWindow.length === 1 ? " is" : "s are"} at ${hiRules.overCapacityPct}%+`,
                columns: [
                  { key: "person", label: "Person" },
                  { key: "allocation", label: "Allocation", align: "right" as const, note: "How much of this person's working time is booked — 50% means half their week is assigned" },
                  { key: "projects", label: "Projects", note: "The projects driving this person's workload" },
                ],
                rows: [...overloadedInWindow]
                  .sort((a, b) => Number((b as any)?.currentPct ?? 0) - Number((a as any)?.currentPct ?? 0))
                  .slice(0, MAX_DETAIL_ROWS)
                  .map((r) => {
                    // One row per person with their real projects. _person
                    // deep-links multi-project rows to Resources → Timeline.
                    const rr = r as Record<string, unknown>;
                    const src =
                      (Array.isArray(rr.activeAllocations) && (rr.activeAllocations as unknown[]).length > 0
                        ? rr.activeAllocations
                        : rr.allAllocations) as Array<{ projectId?: unknown; projectName?: unknown }> | undefined;
                    const projList: Array<{ ticket: string; name: string; pct: number; hours: number }> = [];
                    for (const a of src ?? []) {
                      const t = String(a?.projectId ?? "").trim();
                      if (!t) continue;
                      const pct = Number((a as Record<string, unknown>)?.pct);
                      const hours = Number((a as Record<string, unknown>)?.hours);
                      const load = Number.isFinite(pct) ? pct : Number.isFinite(hours) ? hours : 0;
                      const existing = projList.find((p) => p.ticket === t);
                      if (existing) {
                        // Allocation feeds can contain one entry per week. Keep
                        // the largest entry for the project so the target is
                        // based on real allocation, not row order.
                        if (load > existing.pct) {
                          existing.pct = load;
                          existing.hours = Number.isFinite(hours) ? hours : existing.hours;
                        }
                        continue;
                      }
                      projList.push({
                        ticket: t,
                        name: String(a?.projectName ?? "").trim(),
                        pct: load,
                        hours: Number.isFinite(hours) ? hours : 0,
                      });
                    }
                    const projLabel =
                      projList.length === 0
                        ? "—"
                        : projList.length === 1
                          ? `${projList[0].ticket}${projList[0].name ? ` — ${projList[0].name}` : ""}`
                          : `${projList.length} projects: ${projList.slice(0, 2).map((p) => p.ticket).join(", ")}${projList.length > 2 ? ` +${projList.length - 2} more` : ""}`;
                    const row: Record<string, string> = {
                      person: String((r as any)?.name ?? "—"),
                      allocation: `${Math.round(Number((r as any)?.currentPct ?? 0))}%`,
                      projects: projLabel,
                      _person: String((r as any)?.name ?? ""),
                      // Display names are not unique. Carry the stable staff
                      // identity so an overload action always opens and edits
                      // the exact person represented by this alert row.
                      _personId: String((r as any)?.id ?? (r as any)?.guid ?? ""),
                    };
                    if (projList.length === 1) {
                      // Keep the existing single-project record deep link.
                      row._ticket = projList[0].ticket;
                    } else if (projList.length > 1) {
                      // Keep multi-project rows linked to the person's
                      // timeline, while giving Edit Allocation a deterministic
                      // project target instead of relying on label order.
                      const highestTicket = highestAllocationTicket(projList);
                      if (highestTicket) row._firstTicket = highestTicket;
                    }
                    return row;
                  }),
                goTo: { to: "/resources?view=Timeline", label: "Open resource timeline" },
                emptyText: "No active resources are operating above 100%.",
              } : undefined)
            : (overloadRolesScore != null ? roleLoadRecords : undefined),
        },
        {
          label: "Open positions",
          value: demands.length > 0 ? openPositionsScore : 100,
          available: demands.length > 0,
          raw: demands.length > 0
            ? `${openPositionCount} open role${openPositionCount !== 1 ? "s" : ""} needed ${winNatProse}`
            : "Not available yet",
          windowLabel: windowShort,
          formulaDetail: demands.length > 0 ? {
            eyebrow: "CAPACITY HEALTH · LIVE SIGNAL",
            scoreLabel: "count",
            scoreFormatted: String(openPositionCount),
            currentReading: `${openPositionCount} unique open position${openPositionCount === 1 ? "" : "s"} on file ${winNatProse}.`,
            howCalculated: `How many project roles the firm currently needs to fill. Each open position is a gap in a project team — the longer it stays empty, the greater the risk the project stalls. Open the drill-down to see exactly which projects and roles are outstanding.`,
            formula: `Headcount ÷ (Headcount + Open Roles) × 100 = ${openPosBaseCount} ÷ (${openPosBaseCount} + ${openPositionCount}) × 100 = ${openPositionsScore}%`,
            dataSource: "GetResourceDemandItems · RM ONE·LIVE",
            impact: openPositionCount === 0
              ? `All project roles are currently staffed. No unfilled positions across the active portfolio — capacity is fully matched to demand.`
              : openPositionsScore >= 80
                ? `${openPositionCount} open position${openPositionCount === 1 ? "" : "s"} still ${openPositionCount === 1 ? "needs" : "need"} to be filled ${winNatProse}. Most project roles have been assigned — staffing coverage across the portfolio is good.`
                : openPositionsScore >= 60
                  ? `${openPositionCount} open position${openPositionCount === 1 ? "" : "s"} create staffing gaps ${winNatProse}. Prioritise filling the most time-critical roles before projects stall.`
                  : `${openPositionCount} unfilled role${openPositionCount === 1 ? "" : "s"} is a significant staffing gap ${winNatProse}. Project delivery risk is elevated — fill the highest-priority roles immediately to protect commitments.`,
            tableTitle: `OPEN POSITIONS · ${openPositionCount} UNIQUE UNFILLED ROLE${openPositionCount === 1 ? "" : "S"} ON FILE`,
          } : undefined,
          records: openPositionsRecords,
        },
        {
          label: "Demand-data coverage",
          value: deliveryExposure,
          available: activePmm.length > 0 || demands.length > 0,
          raw: `${exposedNow} of ${activePmm.length} active with no demand data`,
          windowLabel: windowShort,
          formulaDetail: activePmm.length > 0 ? (() => {
            const total = activePmm.length;
            const withDemand = projectsWithDemand;
            const without = total - withDemand;
            return {
              eyebrow: "CAPACITY HEALTH · LIVE SIGNAL",
              currentReading: `${withDemand} of ${total} active project${total === 1 ? "" : "s"} have a staffing plan entered · ${without} have no role requirements on file.`,
              howCalculated: `How many of our active projects have a staffing plan on file. Without one, there's no advance warning when a project is about to run short of people — issues only surface when they're already urgent.`,
              formula: `Projects with Staffing Plan ÷ Active Projects × 100 = ${withDemand} ÷ ${total} × 100 = ${deliveryExposure}%`,
              dataSource: "PMM + Resource Demands",
              impact: without === 0
                ? `All ${total} active project${total === 1 ? "" : "s"} have a staffing plan on file. Demand coverage is complete — capacity can be forecast accurately across the full portfolio.`
                : deliveryExposure >= 70
                  ? `${without} of ${total} project${total === 1 ? "" : "s"} still lack a staffing plan. Most of the portfolio is covered — fill in the remaining gaps to close blind spots before they become urgent.`
                  : `Only ${withDemand} of ${total} project${withDemand === 1 ? "" : "s"} ${withDemand === 1 ? "has" : "have"} a documented staffing plan. Resource demand cannot be forecast reliably across most of the portfolio, increasing the risk of last-minute staffing decisions and delivery delays. Immediate staffing planning is recommended.`,
              tableTitle: `PROJECTS WITH STAFFING PLANS · ${withDemand} OF ${total}`,
              secondaryTable: {
                title: `PROJECTS WITHOUT STAFFING PLANS · ${without} OF ${total}`,
                columns: [
                  { key: "project", label: "Project" },
                  { key: "client",  label: "Client" },
                  { key: "due",     label: "End Date", align: "right" as const },
                  { key: "value",   label: "Value",      align: "right" as const },
                ],
                rows: activePmm
                  .filter((p) => {
                    const tid = String(p?.TicketId ?? p?.RecordCode ?? "");
                    return !tid || (!winDemandsByProject[tid] && !isStaffed(tid));
                  })
                  .sort((a, b) => getValue(b) - getValue(a))
                  .map((p: any) => ({
                  _ticket: ticketOf(p),
                  project: getProjectTitle(p),
                  client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
                  due: fmtDate(effEndStr(p)),
                  value: fmtMoney(getValue(p)),
                })),
              },
            };
          })() : undefined,
          records: cooDelivery.records,
        },
      ];
      break;
    case "PROJECT_MANAGER":
      healthLabel = "My Portfolio";
      subDrivers = [
        {
          label: "Schedule Health",
          value: scheduleHealthScore ?? 0,
          available: scheduleHealthScore != null,
          raw: scheduleHealthScore != null
            ? `${scheduleHealthNotOverdueCount} of ${activePmm.length} active projects are not overdue`
            : "Not available yet",
          records: scheduleHealthRecords ?? undefined,
          formulaDetail: scheduleHealthScore != null ? (() => {
            const overdueTickets = new Set(overdue.map((p) => ticketOf(p)));
            const notOverdue = activePmm
              .filter((p) => !overdueTickets.has(ticketOf(p)))
              .slice()
              .sort((a, b) => {
                const dA = getDeadline(a);
                const dB = getDeadline(b);
                if (dA && dB) return dA.getTime() - dB.getTime();
                if (dA) return -1;
                if (dB) return 1;
                return getValue(b) - getValue(a);
              })
              .slice(0, MAX_DETAIL_ROWS);
            return {
              eyebrow: "PORTFOLIO HEALTH · LIVE SIGNAL",
              currentReading: `${scheduleHealthNotOverdueCount} of ${activePmm.length} active projects are not overdue`,
              howCalculated: `Of every project tracked against a deadline, how many still have time before their target date. A low score means many have already run past their deadline. When that happens across multiple projects at once, it strains the team, damages client relationships, and affects the firm's reputation.`,
              formula: `Projects Not Overdue ÷ Active Projects × 100 = ${scheduleHealthNotOverdueCount} ÷ ${activePmm.length} × 100 = ${scheduleHealthScore}%`,
              dataSource: "PMM (Project Management)",
              impact: scheduleHealthScore >= 80
                ? `${scheduleHealthNotOverdueCount} of ${activePmm.length} active projects are still within their target completion date — strong schedule discipline across the portfolio.`
                : scheduleHealthScore >= 50
                  ? `More than ${100 - scheduleHealthScore}% of active projects have passed their contracted completion date. Prioritize the oldest overruns and identify which projects can recover through schedule compression or scope adjustment.`
                  : `More than half of active projects have passed their contracted completion date. When this happens across the portfolio simultaneously, it creates compounding pressure: teams are overextended, clients need individual updates, and reputation risk builds. Prioritize the oldest overruns first.`,
              tableTitle: `OVERDUE ACTIVE PROJECTS · ${overdue.length} OF ${activePmm.length}`,
              secondaryTable: notOverdue.length > 0 ? {
                title: `ON-SCHEDULE PROJECTS · ${notOverdue.length} OF ${activePmm.length}`,
                columns: [
                  { key: "project", label: "Project" },
                  { key: "target",  label: "End Date",  align: "right" as const },
                  { key: "value",   label: "Value",   align: "right" as const },
                ],
                rows: notOverdue.map((p) => ({
                  _ticket: ticketOf(p),
                  project: getProjectTitle(p),
                  target: fmtDate(effEndStr(p)) ?? "—",
                  value: fmtMoney(getValue(p)),
                })),
              } : undefined,
            };
          })() : undefined,
        },
        {
          label: "Budget Coverage",
          value: budgetCoverageScore ?? 0,
          available: budgetCoverageScore != null,
          raw: budgetCoverageScore != null
            ? `${budgetCoverageOnBudget.length} of ${budgetCoveragePool.length} active projects within labor budget · ${budgetCoverageOverBudget} over budget`
            : "Not available yet",
          records: budgetCoverageRecords ?? undefined,
          formulaDetail: budgetCoverageScore != null ? {
            eyebrow: "HEALTH METRIC · LIVE SIGNAL",
            currentReading: `${budgetCoverageOnBudget.length} of ${budgetCoveragePool.length} active projects within labor budget · ${budgetCoverageOverBudget} over budget`,
            howCalculated: `This signal feeds into the overall operational health score for your firm. Tap the AI tab to ask a detailed question about this metric and what is driving the current reading.`,
            formula: `Projects Within Labor Budget ÷ Projects with Cost Data × 100 = ${budgetCoverageOnBudget.length} ÷ ${budgetCoveragePool.length} × 100 = ${budgetCoverageScore}%`,
            dataSource: "PMM (Project Management)",
            impact: budgetCoverageScore >= 80
              ? `${budgetCoverageOnBudget.length} of ${budgetCoveragePool.length} projects with cost data are within their contracted labor budget — strong financial discipline across the portfolio.`
              : budgetCoverageScore >= 40
                ? `${budgetCoverageOnBudget.length} of ${budgetCoveragePool.length} projects with cost data are within their contracted labor budget. ${budgetCoverageOverBudget} projects are over budget — review scope, cost forecasts, or contract values.`
                : `Only ${budgetCoverageOnBudget.length} of ${budgetCoveragePool.length} projects with cost data are within their contracted labor budget. ${budgetCoverageOverBudget} projects are over budget — immediate review of scope, cost forecasts, or contract values is recommended.`,
            tableTitle: `PROJECT BUDGET COVERAGE`,
          } : undefined,
        },
        {
          label: "Delivery Readiness",
          value: deliveryReadinessScore ?? 0,
          available: deliveryReadinessScore != null,
          raw: deliveryReadinessScore != null
            ? `${deliveryStarted.length} of ${withDeadline.length} deadline-tracked projects have started execution`
            : "Not available yet",
          records: deliveryReadinessRecords ?? undefined,
          formulaDetail: deliveryReadinessScore != null ? {
            eyebrow: "MY PORTFOLIO · LIVE SIGNAL",
            currentReading: `${deliveryStarted.length} of ${withDeadline.length} deadline-tracked projects have started execution (actual start recorded or start date past)`,
            howCalculated: `Across the entire active portfolio, how many projects are far enough along to actually hit their deadline. A low score is an early warning — it means projects haven't advanced enough, and there's still time to do something about it before deadlines pass.`,
            formula: `Projects with Recorded Start ÷ All Deadline-Tracked Projects × 100 = ${deliveryStarted.length} ÷ ${withDeadline.length} × 100 = ${deliveryReadinessScore}%`,
            dataSource: "PMM (Project Management)",
            impact: deliveryReadinessScore >= 80
              ? `${deliveryStarted.length} of ${withDeadline.length} deadline-tracked projects are actively executing — strong delivery pipeline. Watch the ${deliveryNotStarted} not-yet-started projects as their end dates approach.`
              : deliveryReadinessScore >= 40
                ? `${deliveryStarted.length} of ${withDeadline.length} deadline-tracked projects are actively executing. ${deliveryNotStarted} projects haven't been formally started yet — check the drill-down to see which ones need to begin execution before their end date.`
                : `Only ${deliveryStarted.length} of ${withDeadline.length} deadline-tracked projects are actively executing. ${deliveryNotStarted} projects haven't been formally started yet — check the drill-down to see which ones need to begin execution before their end date.`,
            tableTitle: `ALL DEADLINE-TRACKED PROJECTS`,
          } : undefined,
        },
        {
          label: "Milestone Readiness",
          value: milestoneReadinessScore ?? 0,
          available: milestoneReadinessScore != null,
          raw: milestoneReadinessScore != null
            ? `${milestoneOnTrackCount} of ${withDeadline.length} tracked projects on schedule · ${overdue.length} delayed`
            : "Not available yet",
          records: milestoneReadinessRecords ?? undefined,
          formulaDetail: milestoneReadinessScore != null ? {
            eyebrow: "MY PORTFOLIO · LIVE SIGNAL",
            currentReading: `${milestoneOnTrackCount} of ${withDeadline.length} tracked milestones on track · ${overdue.length} delayed · ${milestoneCompletedNotClosed} completed but not yet closed in system`,
            howCalculated: `Across all tracked project deadlines, how many are actually on track versus at risk or already delayed. This tells you whether the team is keeping pace with its commitments across the board — not just how many commitments exist.`,
            formula: `Projects with Future Deadline ÷ All Deadline-Tracked Projects × 100 = ${milestoneOnTrackCount} ÷ ${withDeadline.length} × 100 = ${milestoneReadinessScore}%`,
            dataSource: "PMM (Project Management)",
            impact: milestoneReadinessScore >= 80
              ? `${milestoneOnTrackCount} of ${withDeadline.length} tracked projects are still within their target deadline — strong delivery discipline across the portfolio. Continue monitoring for any new slippage.`
              : milestoneReadinessScore >= 50
                ? `${overdue.length} of ${withDeadline.length} tracked projects are already past their target deadline. Conduct a triage review to identify which projects can recover and which need scope or timeline relief.`
                : `Only ${milestoneOnTrackCount} of ${withDeadline.length} tracked projects are still within their target deadline — ${overdue.length} are already past due. Immediate attention is needed to avoid further delivery delays across the portfolio.`,
            tableTitle: `MILESTONE READINESS · ${milestoneOnTrackCount} FUTURE DEADLINE${milestoneOnTrackCount === 1 ? "" : "S"}`,
          } : undefined,
        },
      ];
      break;
    case "EXECUTIVE": {
      healthLabel = "Firm Health";

      // Win rate: % of decided opportunities (Awarded or Lost/Cancelled/
      // Declined/Dead) that were successfully Awarded. Undecided pipeline
      // (Prospecting/Qualifying/Proposal/Negotiation) is excluded — only
      // opportunities that have actually been won or lost count.
      const execDecidedOpm = opm.filter((o) => {
        const s = opmStageOf(o);
        return s === "Awarded" || isOpmClosed(o);
      });
      const execAwardedOpm = execDecidedOpm.filter((o) => opmStageOf(o) === "Awarded");
      const execWinRateScore: number | null = execDecidedOpm.length > 0
        ? Math.round(clamp((execAwardedOpm.length / execDecidedOpm.length) * 100, 0, 100))
        : null;
      const execWinRateRecords: ActionDetail = execWinRateScore != null ? {
        title: `Win rate · ${execDecidedOpm.length} decided opportunit${execDecidedOpm.length === 1 ? "y" : "ies"}`,
        subtitle: `${execAwardedOpm.length} of ${execDecidedOpm.length} decided opportunities have been successfully awarded (${execWinRateScore}% win rate).`,
        columns: [
          { key: "title", label: "Opportunity" },
          { key: "outcome", label: "Outcome" },
          { key: "client", label: "Client" },
        ],
        rows: execDecidedOpm
          .slice()
          .sort((a, b) => getOpmValue(b) - getOpmValue(a))
          .map((o) => ({
            _ticket: ticketOf(o),
            title: getProjectTitle(o),
            outcome: opmStageOf(o) === "Awarded" ? "Awarded ✓" : `${opmStageOf(o) || "Lost"} ✗`,
            client: String(o?.CRMCompanyLookupName ?? o?.ClientName ?? o?.CompanyName ?? "—"),
          })),
        emptyText: "No decided opportunities on file.",
      } : null;

      // Capacity vs plan: % of staff inside the Settings utilization band for
      // the selected window. Reuses the window-projected active/overload
      // counts already computed for the RM case so the value varies with
      // the chosen window (7D ≠ 30D ≠ 60D ≠ 90D).
      //   in-band = active-in-window minus overloaded-in-window
      //   score   = in-band / total staff × 100
      const execAllocList = allAllocResources;
      const execCapAvailable = winBenchAvailable; // winBenchAvailable = allAllocResources.length > 0
      const execInBandCount = Math.max(0, winActiveCount - winOverloadCount);
      const execCapacityScore: number | null = execCapAvailable
        ? Math.round(clamp((execInBandCount / Math.max(1, execAllocList.length)) * 100, 0, 100))
        : null;
      const execCapacityRecords: ActionDetail = execCapacityScore != null ? {
        title: `Capacity vs plan · ${execAllocList.length} staff firmwide`,
        subtitle: `${execInBandCount} of ${execAllocList.length} in target band · ${winOverloadCount} over · ${execAllocList.length - winActiveCount} bench`,
        columns: [
          { key: "name", label: "Name" },
          { key: "bu", label: "Business Unit" },
          { key: "util", label: "Utilization", align: "right", note: `Hours assigned ÷ working capacity — 100% = fully booked, ${hiRules.overCapacityPct}%+ = overloaded` },
          { key: "status", label: "Status", align: "right" },
        ],
        rows: execAllocList
          .slice()
          .sort((a, b) => {
            const pa = Number(a?.currentPct ?? 0);
            const pb = Number(b?.currentPct ?? 0);
            const ba = pa >= hiRules.overCapacityPct ? 0 : pa < hiRules.underAllocatedPct ? 1 : 2;
            const bb = pb >= hiRules.overCapacityPct ? 0 : pb < hiRules.underAllocatedPct ? 1 : 2;
            return ba !== bb ? ba - bb : pb - pa;
          })
          .slice(0, MAX_DETAIL_ROWS)
          .map((r) => {
            const pct = Math.round(Number(r?.currentPct ?? 0));
            return {
              name: String(r?.name ?? "—"),
              bu: String((r as any)?.businessUnit ?? (r as any)?.roleName ?? "—"),
              util: `${pct}%`,
              status: pct >= hiRules.overCapacityPct ? "Over" : pct < hiRules.underAllocatedPct ? "Under" : "In band",
            };
          }),
        emptyText: "No staffing data on file.",
      } : null;

      // Workforce Health Score — thresholds driven by getBusinessRules() so they
      // stay in sync with the Resources page when an admin changes the knobs.
      // StaffingBalance = 100 − (bench / total × 100)
      // UtilizationStability = 100 − (overloaded / allocated × 100)
      // WorkforceHealth = round((StaffingBalance + UtilizationStability) / 2)
      const whRules = getBusinessRules();
      const whOverCapacity    = whRules.overCapacityPct;      // e.g. 110
      const whTargetUtil      = whRules.targetUtilizationPct; // e.g. 80
      const whUnderAllocated  = whRules.underAllocatedPct;    // e.g. 60

      const whTotal = allAllocResources.length;
      const whAvailable = whTotal > 0;
      // whBench = everyone at or below the under-allocated threshold (0–underAllocatedPct%).
      // This matches the Resources page "Under-used 0–X%" tier so both counts agree.
      const whBench      = allAllocResources.filter((r) => (Number(r?.currentPct ?? 0)) <= whUnderAllocated);
      const whAllocated  = allAllocResources.filter((r) => (Number(r?.currentPct ?? 0)) > 0);
      const whOverloaded = allAllocResources.filter((r) => (Number(r?.currentPct ?? 0)) >= whOverCapacity);
      const whOptimal    = allAllocResources.filter((r) => { const p = Number(r?.currentPct ?? 0); return p >= whTargetUtil && p < whOverCapacity; });
      const whActive     = allAllocResources.filter((r) => { const p = Number(r?.currentPct ?? 0); return p > whUnderAllocated && p < whTargetUtil; });
      const whUnderUsed  = allAllocResources.filter((r) => { const p = Number(r?.currentPct ?? 0); return p > 0 && p <= whUnderAllocated; });

      const whStaffingBalance     = whTotal > 0 ? Math.round(100 - (whBench.length / whTotal) * 100) : 100;
      const whUtilStability       = whAllocated.length > 0 ? Math.round(100 - (whOverloaded.length / whAllocated.length) * 100) : 100;
      const whScore: number | null = whAvailable
        ? Math.round((whStaffingBalance + whUtilStability) / 2)
        : null;

      const whTierLabel = (pct: number): string => {
        if (pct === 0)                 return "On bench";
        if (pct <= whUnderAllocated)   return "Under-used";
        if (pct < whTargetUtil)        return "Active";
        if (pct < whOverCapacity)      return "Optimal";
        return "Overloaded";
      };

      const whRecords: ActionDetail | null = whAvailable ? {
        title: `Workforce Health · Current Allocation`,
        subtitle: `${whBench.length} of ${whTotal} under-used or on bench · ${whOverloaded.length} overloaded (≥${whOverCapacity}%)`,
        columns: [
          { key: "person",     label: "Person" },
          { key: "status",     label: "Status" },
          { key: "allocation", label: "Allocation", align: "right" as const, note: "How much of this person's working time is booked — 50% means half their week is assigned" },
        ],
        rows: allAllocResources
          .slice()
          .sort((a, b) => (Number(b?.currentPct ?? 0)) - (Number(a?.currentPct ?? 0)))
          .slice(0, MAX_DETAIL_ROWS)
          .map((r) => {
            const pct = Math.round(Number(r?.currentPct ?? 0));
            return {
              person:     String(r?.name ?? "—"),
              status:     whTierLabel(pct),
              allocation: `${pct}%`,
            };
          }),
        emptyText: "No workforce data on file.",
      } : null;

      // Delivery Rate: % of deadline-tracked active projects still on schedule
      // (effective end date >= today — schedule-derived when phases exist,
      // Target fallback otherwise). Matches the Analytics-page formula.
      const drTracked = activePmm.filter((p) => effEnd(p) != null);
      const drOnSchedule = drTracked.filter((p) => effEnd(p)!.getTime() >= nowMs);
      const drNoDate = activePmm.length - drTracked.length;
      const drScore: number | null = drTracked.length > 0
        ? Math.round((drOnSchedule.length / drTracked.length) * 100)
        : null;
      const drRecords: ActionDetail | null = drScore != null ? {
        title: `Delivery Rate · ${drOnSchedule.length} of ${drTracked.length} tracked projects on schedule`,
        subtitle: `${drOnSchedule.length} of ${drTracked.length} tracked projects on schedule · ${drNoDate} active project${drNoDate === 1 ? "" : "s"} excluded (no end date on file)`,
        columns: [
          { key: "project", label: "Project" },
          { key: "deadline", label: "End Date", align: "right" as const },
          { key: "status", label: "Status", align: "right" as const },
        ],
        rows: drTracked
          .slice()
          .sort((a, b) => {
            const aMs = effEnd(a)!.getTime();
            const bMs = effEnd(b)!.getTime();
            const aOn = aMs >= nowMs;
            const bOn = bMs >= nowMs;
            if (aOn !== bOn) return aOn ? -1 : 1;
            return aMs - bMs;
          })
          .slice(0, MAX_DETAIL_ROWS)
          .map((p) => {
            const ms = effEnd(p)!.getTime();
            const onTrack = ms >= nowMs;
            return {
              _ticket: ticketOf(p),
              project: String(p?.Title ?? p?.ShortName ?? "—"),
              deadline: fmtDate(effEndStr(p)),
              status: onTrack ? "On track" : "Overdue",
            };
          }),
        emptyText: "No deadline-tracked projects on file.",
      } : null;

      subDrivers = [
        {
          label: "Win Rate",
          value: execWinRateScore ?? 0,
          available: execWinRateScore != null,
          tone: (execWinRateScore ?? 0) >= 38 ? "good" : ("warn" as const),
          windowLabel: execWinRateScore != null ? "annual" : undefined,
          raw: execWinRateScore != null
            ? `${execAwardedOpm.length} of ${execDecidedOpm.length} decided opportunit${execDecidedOpm.length === 1 ? "y" : "ies"} have been successfully awarded (${execWinRateScore}% win rate).`
            : "Not available yet",
          formulaDetail: execWinRateScore != null ? {
            currentReading: `${execAwardedOpm.length} of ${execDecidedOpm.length} decided opportunit${execDecidedOpm.length === 1 ? "y" : "ies"} have been successfully awarded (${execWinRateScore}% win rate).`,
            howCalculated: `Measures the percentage of decided opportunities that are successfully awarded. A higher win rate reflects strong proposal quality, competitive positioning, and effective bid execution.`,
            formula: `Awarded Opportunities ÷ Decided Opportunities × 100 = ${execAwardedOpm.length} ÷ ${execDecidedOpm.length} × 100 = ${execWinRateScore}%`,
            impact: `Win rate is ${execWinRateScore}%, ${execWinRateScore >= 38 ? "significantly exceeding" : "trailing"} the target of 38%. ${execWinRateScore >= 38 ? "Maintain a healthy pipeline of qualified opportunities to sustain this performance." : "Review proposal quality and competitive positioning to close the gap to target."}`,
            tableTitle: "WIN RATE · ALL DECIDED OPPORTUNITIES",
          } : undefined,
          records: execWinRateRecords ?? undefined,
        },
        {
          label: "Delivery Rate",
          value: drScore ?? 0,
          available: drScore != null,
          tone: (drScore ?? 0) >= 70 ? "good" : ("warn" as const),
          windowLabel: drScore != null ? "all-time" : undefined,
          raw: drScore != null
            ? `${drOnSchedule.length} of ${drTracked.length} tracked projects on schedule · ${drNoDate} excluded (no target date)`
            : "Not available yet",
          formulaDetail: drScore != null ? {
            currentReading: `${drOnSchedule.length} of ${drTracked.length} tracked projects on schedule · ${drNoDate} active project${drNoDate === 1 ? "" : "s"} excluded (no target date on file)`,
            howCalculated: `Measures the percentage of deadline-tracked projects that are currently on schedule. A high delivery rate reflects strong execution and consistent adherence to committed delivery dates. Check the drill-down to see which projects slipped and by how long.`,
            formula: `Projects On Schedule ÷ Tracked Projects × 100 = ${drOnSchedule.length} ÷ ${drTracked.length} × 100 = ${drScore}%`,
            impact: `${drScore}% of deadline-tracked projects are currently on schedule. ${drScore >= 70 ? "Strong delivery performance across the portfolio." : "Most projects have missed their delivery deadline — a widespread delivery issue that affects client relationships and future awards. Identify what these projects have in common — staffing gaps, scope changes, or late change orders — and address the root cause."}`,
            tableTitle: "TRACKED PROJECTS — SCHEDULE STATUS",
          } : undefined,
          records: drRecords ?? undefined,
        },
        {
          label: "Workforce Health",
          value: whScore ?? 0,
          available: whScore != null,
          tone: (whScore ?? 0) >= 75 ? "good" : ("warn" as const),
          windowLabel: whScore != null ? "live" : undefined,
          raw: whScore != null
            ? `${whBench.length} of ${whTotal} resources under-used or on bench (≤${whUnderAllocated}%), ${whOverloaded.length} of ${whAllocated.length} allocated at ≥${whOverCapacity}% (Overloaded)`
            : "Not available yet",
          formulaDetail: whScore != null ? {
            currentReading: `${whBench.length} of ${whTotal} resources are under-used or on bench (≤${whUnderAllocated}%), and ${whOverloaded.length} of ${whAllocated.length} allocated resources are at or above ${whOverCapacity}% (Overloaded).`,
            howCalculated: `Combines Staffing Balance and Utilization Stability into a single workforce health score. A healthy workforce maintains sufficient project allocation while minimising overloaded resources.`,
            formula: `(Staffing Balance + Utilization Stability) ÷ 2 = (${whStaffingBalance}% + ${whUtilStability}%) ÷ 2 = ${whScore}%`,
            impact: [
              whScore >= 75
                ? "Overall workforce health is stable."
                : whScore >= 50
                  ? "Workforce health needs attention — review bench and overload levels."
                  : "Workforce health is critical — both components require immediate action.",
              "",
              `Staffing Balance — ${whStaffingBalance}%`,
              `100 − (${whBench.length} under-used/bench ÷ ${whTotal} total workforce × 100) = 100 − ${Math.round((whBench.length / whTotal) * 100)}% = ${whStaffingBalance}%`,
              "",
              `Utilization Stability — ${whUtilStability}%`,
              `100 − (${whOverloaded.length} Overloaded ≥${whOverCapacity}% ÷ ${whAllocated.length} allocated (>0%) × 100) = 100 − ${Math.round((whOverloaded.length / Math.max(whAllocated.length, 1)) * 100)}% = ${whUtilStability}%`,
            ].join("\n"),
            tableTitle: "WORKFORCE HEALTH · CURRENT ALLOCATION",
          } : undefined,
          records: whRecords ?? undefined,
        },
        {
          label: "Open Positions",
          value: demands.length > 0 ? openPositionsScore : 100,
          available: true,
          tone: openPositionsScore >= 80 ? ("good" as const) : ("warn" as const),
          raw: `${openPositionCount} open role${openPositionCount !== 1 ? "s" : ""} across active projects`,
          records: openPositionsRecords,
          formulaDetail: {
            eyebrow: "CAPACITY HEALTH · LIVE SIGNAL",
            currentReading: `${openPositionCount} unique open position${openPositionCount === 1 ? "" : "s"} on file across active projects`,
            howCalculated: `How many project roles the firm currently needs to fill. Each open position is a gap in a project team — the longer it stays empty, the greater the risk the project stalls. Open the drill-down to see exactly which projects and roles are outstanding.`,
            formula: `Headcount ÷ (Headcount + Open Roles) × 100 = ${openPosBaseCount} ÷ (${openPosBaseCount} + ${openPositionCount}) × 100 = ${openPositionsScore}%`,
            dataSource: "PMM (Project Management)",
            impact: openPositionCount === 0
              ? `No open positions on file — all project roles are currently filled.`
              : openPositionsScore >= 80
                ? `Most project roles that need to be filled have been assigned. Good staffing coverage across the active portfolio.`
                : openPositionsScore >= 60
                  ? `${openPositionCount} open position${openPositionCount === 1 ? "" : "s"} create staffing gaps across the active portfolio. Prioritise filling the most time-critical roles before projects stall.`
                  : `${openPositionCount} unfilled role${openPositionCount === 1 ? "" : "s"} represent a significant staffing gap. Delivery risk is elevated — fill the highest-priority roles immediately to protect commitments.`,
            tableTitle: `OPEN POSITIONS · ${openPositionCount} UNIQUE UNFILLED ROLE${openPositionCount === 1 ? "" : "S"} ON FILE`,
            scoreFormatted: String(openPositionCount),
            scoreLabel: "count",
          },
        },
        {
          label: "Execution Readiness",
          value: deliveryReadinessScore ?? 0,
          available: deliveryReadinessScore != null,
          raw: deliveryReadinessScore != null
            ? `${deliveryStarted.length} of ${withDeadline.length} deadline-tracked projects are executing (actual start recorded or start date past)`
            : "Not available yet",
          records: deliveryReadinessScore != null ? {
            title: `All deadline-tracked projects · ${withDeadline.length} total`,
            subtitle: `${deliveryStarted.length} started · ${deliveryNotStarted} not yet started · ${withDeadline.length} total`,
            columns: [
              { key: "project", label: "Project" },
              { key: "startDate", label: "Start Date", align: "right" as const },
              { key: "targetDate", label: "End Date", align: "right" as const },
              { key: "status", label: "Status", align: "right" as const },
            ],
            rows: withDeadline
              .slice()
              .sort((a, b) => {
                const aS = effStarted(a, pmTodayStart), bS = effStarted(b, pmTodayStart);
                if (aS !== bS) return aS ? -1 : 1;
                return getDeadline(a)!.getTime() - getDeadline(b)!.getTime();
              })
              .slice(0, MAX_DETAIL_ROWS)
              .map((p) => {
                const isStarted = effStarted(p, pmTodayStart);
                const startLabel = p?.ActualStartDate
                  ? "Started (Actual)"
                  : isStarted
                    ? "Started (Past Start)"
                    : "Not Started";
                return {
                  _ticket: ticketOf(p),
                  project: getProjectTitle(p),
                  startDate: fmtDate(effStartStr(p) ?? p?.ActualStartDate) ?? "—",
                  targetDate: fmtDate(effEndStr(p)),
                  status: startLabel,
                };
              }),
            emptyText: "No deadline-tracked projects.",
          } : undefined,
          formulaDetail: deliveryReadinessScore != null ? {
            eyebrow: "HEALTH METRIC · LIVE SIGNAL",
            currentReading: `${deliveryStarted.length} of ${withDeadline.length} deadline-tracked projects are executing (actual start recorded or start date in the past)`,
            howCalculated: `A project counts as "started" if it has an actual start recorded, or if its start date (first phase start when a schedule exists, planned start otherwise) has already passed. Projects still waiting for their scheduled kick-off show as "Not Started". This signal feeds into the overall operational health score.`,
            formula: `Projects Started ÷ All Deadline-Tracked Projects × 100 = ${deliveryStarted.length} ÷ ${withDeadline.length} × 100 = ${deliveryReadinessScore}%`,
            dataSource: "PMM (Project Management)",
            impact: deliveryReadinessScore >= 60
              ? `${deliveryStarted.length} of ${withDeadline.length} deadline-tracked projects are executing — solid execution pipeline. Monitor the ${deliveryNotStarted} not-yet-started project${deliveryNotStarted === 1 ? "" : "s"} as their end dates approach.`
              : `Only ${deliveryStarted.length} of ${withDeadline.length} deadline-tracked projects are executing. ${deliveryNotStarted} project${deliveryNotStarted === 1 ? " has" : "s have"} a future start date and haven't kicked off yet — verify whether they are executing informally.`,
            tableTitle: `ALL DEADLINE-TRACKED PROJECTS`,
            scoreFormatted: String(deliveryStarted.length),
            scoreLabel: "count",
          } : undefined,
        },
      ];
      break;
    }
    default:
      healthLabel = "Operational Health";
      subDrivers = cooSubDrivers;
  }

  // Health = average of the sub-drivers that actually have live data. For COO
  // all four are live, so this is identical to the previous behaviour.
  const availableSubs = subDrivers.filter((d) => d.available !== false);
  const health =
    availableSubs.length > 0
      ? Math.round(availableSubs.reduce((s, d) => s + d.value, 0) / availableSubs.length)
      : 0;

  // Persona-specific status vocabulary over the same live score bands.
  const STATUS_WORDS: Record<RolePersona, [string, string, string, string]> = {
    COO: ["STRONG", "STABLE", "WATCH", "AT RISK"],
    CFO: ["STRONG", "WATCH", "EXPOSED", "CRITICAL"],
    RESOURCE_MANAGER: ["ABUNDANT", "STEADY", "TIGHT", "CRITICAL"],
    PROJECT_MANAGER: ["AHEAD", "ON TRACK", "SLIPPING", "AT RISK"],
    EXECUTIVE: ["STRONG", "STEADY", "WATCH", "AT RISK"],
  };
  // COO keeps the legacy status thresholds (85/75/60) so its badge word stays
  // byte-identical to the pre-role behaviour; other personas use 85/70/55.
  const bandCuts = role === "COO" ? [85, 75, 60] : [85, 70, 55];
  const band =
    health >= bandCuts[0]
      ? 0
      : health >= bandCuts[1]
        ? 1
        : health >= bandCuts[2]
          ? 2
          : 3;
  const statusWord = STATUS_WORDS[role][band];

  const healthDetail: ActionDetail = {
    title:
      role === "COO" ? "Operational health · breakdown" : `${healthLabel} · breakdown`,
    subtitle:
      role === "COO"
        ? `Composite score ${health}/100 · average of four sub-drivers`
        : `Composite score ${health}/100 · average of ${availableSubs.length} live sub-driver${availableSubs.length === 1 ? "" : "s"}`,
    columns: [
      { key: "label", label: "Driver" },
      { key: "value", label: "Score", align: "right", note: "Composite health score calculated from multiple factors — 0 is worst, 100 is best" },
      { key: "raw", label: "Underlying" },
    ],
    rows: subDrivers.map((d) => ({
      label: d.label,
      value: d.available === false ? "—" : d.value,
      raw: d.available === false ? "Not available yet" : (d.raw ?? "—"),
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
  if (role === "CFO") {
    const cfoExposed = activePmm
      .filter((p) => {
        const tid = String(p?.TicketId ?? p?.RecordCode ?? "");
        return !tid || (!demandsByProject[tid] && !isStaffed(tid));
      })
      .slice()
      .sort((a, b) => getValue(b) - getValue(a));
    const cfoExposedValue = cfoExposed.reduce((s, p) => s + getValue(p), 0);
    const topExposed = cfoExposed[0];
    if (cfoExposed.length > 0) {
      pinned = {
        title: `${fmtMoney(cfoExposedValue)} revenue at risk · ${cfoExposed.length} project${cfoExposed.length === 1 ? "" : "s"} with no staffing on file`,
        detail: topExposed
          ? `Highest exposure: ${getProjectTitle(topExposed)} · ${fmtMoney(getValue(topExposed))} · verify staffing before close`
          : `No staffing data on file for ${cfoExposed.length} active project${cfoExposed.length === 1 ? "" : "s"}`,
        horizon: winNatUpper,
        records: {
          title: "Projects with revenue at risk",
          subtitle: `${cfoExposed.length} active project${cfoExposed.length === 1 ? "" : "s"} · ${fmtMoney(cfoExposedValue)} total exposure`,
          columns: [
            { key: "title", label: "Project" },
            { key: "client", label: "Client" },
            { key: "value", label: "Contract Value", align: "right" },
          ],
          rows: cfoExposed.slice(0, MAX_DETAIL_ROWS).map((p) => ({
            _ticket: ticketOf(p),
            title: getProjectTitle(p),
            client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
            value: fmtMoney(getValue(p)),
          })),
        },
      };
    }
  } else if (overloaded.length > 0) {
    const top = overloaded[0];
    const proj = activePmm.find(
      (p) => String(p?.TicketId ?? p?.RecordCode ?? "") === top.tid,
    );
    const records = (demandsByProject[top.tid] || [])
      .slice()
      .sort((a, b) => (Number(b?.PctAllocation) || 0) - (Number(a?.PctAllocation) || 0));
    pinned = {
      title: `${getProjectTitle(proj)} projected at ~${(top.total / 100).toFixed(1)} FTE total demand`,
      detail: `${top.count} concurrent resource demands (avg ${top.count ? Math.round(top.total / top.count) : 0}% per req) · cascade risk inside the coming week`,
      horizon: "THIS WEEK",
      records: {
        title: `Resource allocations on ${getProjectTitle(proj)}`,
        subtitle: `${top.count} concurrent demands · avg ${top.count ? Math.round(top.total / top.count) : 0}% per req · ~${(top.total / 100).toFixed(1)} FTE total`,
        columns: [
          { key: "role", label: "Role" },
          { key: "title", label: "Demand" },
          { key: "alloc", label: "% Alloc", align: "right", note: "Hours booked on this role ÷ total working hours in the period" },
          { key: "window", label: "Window", align: "right", note: "The start and end dates for this assignment or demand" },
        ],
        rows: records.map((d) => ({
          _ticket: demandTicket(d),
          role: String(d?.Role ?? "").trim() || "Role not set yet",
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
        detail: `Largest active footprint in the portfolio · monitor near-term staffing draws`,
        horizon: "THIS WEEK",
        records: {
          title: `Active projects in ${topCity[0]}`,
          subtitle: `${topCity[1].count} active projects · sorted by contract value`,
          columns: [
            { key: "title", label: "Project" },
            { key: "client", label: "Client" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: projs.map((p) => ({
            _ticket: ticketOf(p),
            title: getProjectTitle(p),
            client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
            value: fmtMoney(getValue(p)),
          })),
        },
      };
    } else if (allocFeedOk && deliveryExposure30 < 70 && activePmm.length > 0 && role !== "COO") {
      const exposedCount = activePmm.length - projectsWithDemand30;
      const exposed = activePmm
        .filter((p) => {
          const tid = String(p?.TicketId ?? p?.RecordCode ?? "");
          return !tid || (!demandsByProject[tid] && !isStaffed(tid));
        })
        .slice()
        .sort((a, b) => getValue(b) - getValue(a));
      pinned = {
        title: `${exposedCount} active projects with no staffing data — ${winNatProse}`,
        detail: `Only ${deliveryExposure30}% of active projects have team members or staffing plans on file · likely a data gap, not confirmed under-staffing`,
        horizon: winNatUpper,
        records: {
          title: `Active projects with no staffing data on file`,
          subtitle: `${exposedCount} active projects with no team members or staffing plan on file`,
          columns: [
            { key: "title", label: "Project" },
            { key: "city", label: "City" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: exposed.map((p) => ({
            _ticket: ticketOf(p),
            title: getProjectTitle(p),
            city: getProjectCity(p) || "—",
            value: fmtMoney(getValue(p)),
          })),
        },
      };
    }
  }

  // ---- Risk feed (predictive language, real numbers) ----
  // Risk feed is portfolio-wide (all-time demand buckets) — it does NOT
  // follow the forecast-window selector, which only scopes the
  // Operational Health sub-drivers. Some rows still label a horizon
  // (`windowShortUpper`/`winNatUpper`) purely for display context.
  // exposedCount forced to 0 when the allocation feed failed — "no staffing
  // data" claims are only valid when we actually loaded the staffing data.
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

  // ---- CFO-specific financial computations ----
  // Total contract value of active projects that have NO demand data on file —
  // this is the revenue-visibility exposure expressed in dollars.
  const exposedProjectValue = exposureRecords30.reduce((s, p) => s + getValue(p), 0);
  // Dollar gap between active pipeline and the 25%-of-portfolio coverage target.
  const pipelineGap = Math.max(0, (target || 0) - winOpmValue);
  // Advanced-stage OPM: everything that is NOT early-stage (Propose / Negotiate /
  // Final) — ready to accelerate to close. Sorted high-value first.
  const advancedOpm = opm
    .filter((o) => !isOpmEarlyStage(o))
    .slice()
    .sort((a, b) => getValue(b) - getValue(a));
  const advancedOpmValue = advancedOpm.reduce((s, o) => s + getValue(o), 0);
  // Dollar value tied up in low-confidence pursuits (BD budget at risk).
  const earlyOpmValue = opm.filter(isOpmEarlyStage).reduce((s, o) => s + getValue(o), 0);
  // Client concentration: find the single largest client by active-portfolio value.
  // Projects with no client recorded are EXCLUDED from the ranking — lumping
  // them into one bucket used to fabricate an "Unknown at 100% of active
  // portfolio" concentration risk when client names were simply missing.
  // When missing clients dominate the portfolio we surface an honest
  // data-quality insight instead (see the concentration blocks below).
  const clientLabelOf = (p: any): string | null => {
    const raw = String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "").trim();
    if (!raw || /^(unknown|unassigned|n\/?a|none|null|--?)$/i.test(raw)) return null;
    return raw;
  };
  const clientValueMap: Record<string, { value: number; count: number }> = {};
  let noClientCount = 0;
  let noClientValue = 0;
  for (const p of activePmm) {
    const client = clientLabelOf(p);
    if (!client) {
      noClientCount++;
      noClientValue += getValue(p);
      continue;
    }
    if (!clientValueMap[client]) clientValueMap[client] = { value: 0, count: 0 };
    clientValueMap[client].value += getValue(p);
    clientValueMap[client].count++;
  }
  const clientEntries = Object.entries(clientValueMap).sort(
    ([, a], [, b]) => b.value - a.value,
  );
  const topClientEntry = clientEntries[0];
  // Share is measured against the WHOLE active portfolio (not just the
  // client-attributed slice) so the "% of active portfolio" claim stays true.
  const topClientShare =
    pmmActiveValue > 0 && topClientEntry
      ? Math.round((topClientEntry[1].value / pmmActiveValue) * 100)
      : 0;
  // True when so much of the portfolio has no client on file that any
  // client-concentration statement would be meaningless.
  const clientDataGap =
    noClientCount > 0 && pmmActiveValue > 0 && noClientValue > pmmActiveValue * 0.5;

  // ---- Role-aware wording for the risk feed + decision support ----
  // Same live numbers and record sets across personas; only the human-facing
  // lead text changes so each role reads in its own language. COO keeps the
  // exact original operational phrasing.
  const plural = (n: number) => (n === 1 ? "" : "s");
  const exposedRiskText = (n: number) => {
    switch (role) {
      case "RESOURCE_MANAGER":
        return `${n} project${plural(n)} with no staffing data on file`;
      case "PROJECT_MANAGER":
        return `${n} active project${plural(n)} with no staffing data`;
      case "CFO":
        return `${n} project${plural(n)} with no staffing data · revenue visibility gap`;
      case "EXECUTIVE":
        return `${n} active project${plural(n)} with no staffing data firmwide`;
      default:
        return `${n} active project${plural(n)} with no staffing data on file`;
    }
  };
  const roleShortageRiskText = (r: string, count: number) => {
    switch (role) {
      case "CFO":
        return `${r} hiring exposure · ${count} concurrent reqs`;
      case "PROJECT_MANAGER":
        return `${r} gap on your projects · ${count} concurrent reqs`;
      case "EXECUTIVE":
        return `${r} capacity shortfall · ${count} concurrent reqs`;
      default:
        return `Likely ${r} shortage · ${count} concurrent reqs forecasted`;
    }
  };
  const burnoutRiskText = (n: number) => {
    switch (role) {
      case "PROJECT_MANAGER":
        return `Overload risk on ${n} of your team${plural(n)}`;
      case "RESOURCE_MANAGER":
        return `${n} project team${plural(n)} over 1.0 FTE`;
      case "EXECUTIVE":
        return `${n} team${plural(n)} at burnout risk firmwide`;
      default:
        return `Burnout risk on ${n} project team${plural(n)}`;
    }
  };
  const openReqDecisionText = (n: number) => {
    switch (role) {
      case "CFO":
        return `Review demand coverage for ${n} project${plural(n)}`;
      case "EXECUTIVE":
        return `Review demand coverage for ${n} project${plural(n)}`;
      default:
        return `Review demand coverage for ${n} project${plural(n)}`;
    }
  };
  const hireDecisionText = (r: string, headcount: number) => {
    switch (role) {
      case "CFO":
        return `Budget ${headcount} ${r} hire${plural(headcount)} · ${winNatUpper}`;
      case "EXECUTIVE":
        return `Approve ${headcount} ${r} hire${plural(headcount)} · ${winNatUpper}`;
      default:
        return `Hire ${headcount} ${r} · ${winNatUpper}`;
    }
  };
  const rebalanceDecisionText = (n: number) => {
    switch (role) {
      case "PROJECT_MANAGER":
        return `Re-balance ${n} of your overloaded team${plural(n)}`;
      default:
        return `Re-balance ${n} overloaded project team${plural(n)}`;
    }
  };

  const risks: RiskItem[] = [];

  if (role === "CFO") {
    // ---- CFO risk feed: financial signals ranked by dollar exposure ----

    // 1. Revenue at risk — active projects with no staffing demand data
    if (exposedCount > 0) {
      risks.push({
        level: exposedProjectValue > 50_000_000 ? "CRIT" : "WARN",
        horizon: winNatUpper,
        text: `${fmtMoney(exposedProjectValue)} revenue exposure · ${exposedCount} project${plural(exposedCount)} with no staffing data`,
        detail: `No team members or staffing plan on file · ${activePmm.length} active in portfolio · revenue visibility gap`,
        records: {
          title: "Active projects with no staffing data — revenue at risk",
          subtitle: `${exposedCount} active projects · ${fmtMoney(exposedProjectValue)} total value with no staffing data on file`,
          columns: [
            { key: "title", label: "Project" },
            { key: "client", label: "Client" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: exposureRecords30.map((p) => ({
            _ticket: ticketOf(p),
            title: getProjectTitle(p),
            client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
            value: fmtMoney(getValue(p)),
          })),
        },
      });
    }

    // 2. Pipeline shortfall — replenishment score below 70% (new pipeline is
    // not keeping pace with the run-rate target / work closing out).
    if (propCoverage < 70) {
      risks.push({
        level: propCoverage < 50 ? "CRIT" : "WARN",
        horizon: winNatUpper,
        text: `Pipeline replenishment ${propCoverage}% · ${fmtMoney(pipelineGap)} short of run-rate target`,
        detail: `${fmtMoney(winOpmValue)} active pipeline vs ${fmtMoney(target || 0)} target · increase qualified pursuits to close gap`,
        records: {
          title: "Pipeline opportunities in window",
          subtitle: `${winOpm.length} open opportunit${winOpm.length === 1 ? "y" : "ies"} · ${fmtMoney(winOpmValue)} vs ${fmtMoney(target || 0)} target`,
          columns: [
            { key: "title", label: "Opportunity" },
            { key: "client", label: "Client" },
            { key: "stage", label: "Stage" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: coverageRecords.map((o) => ({
            _ticket: ticketOf(o),
            title: getProjectTitle(o),
            client: String(o?.CRMCompanyLookupName ?? o?.ClientName ?? o?.CompanyName ?? "—"),
            stage: String(o?.CRMProjectStatusChoice ?? o?.Status ?? "—"),
            value: fmtMoney(getValue(o)),
          })),
        },
      });
    }

    // 3. BD budget drain — value locked in low-confidence early-stage pursuits
    if (earlyOpmCount > 0) {
      const earlyOpms = opm
        .filter(isOpmEarlyStage)
        .slice()
        .sort((a, b) => getValue(b) - getValue(a));
      risks.push({
        level: "WARN",
        horizon: winNatUpper,
        text: `${fmtMoney(earlyOpmValue)} in low-confidence pursuits · ${earlyOpmCount} at Identify/Qualify`,
        detail: `BD capacity consumed by early-stage pursuits with low win probability · consider deferring`,
        records: {
          title: "Low-confidence pursuits — BD spend at risk",
          subtitle: `${earlyOpmCount} early-stage opportunit${earlyOpmCount === 1 ? "y" : "ies"} · ${fmtMoney(earlyOpmValue)} total value`,
          columns: [
            { key: "title", label: "Opportunity" },
            { key: "client", label: "Client" },
            { key: "stage", label: "Stage" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: earlyOpms.map((o) => ({
            _ticket: ticketOf(o),
            title: getProjectTitle(o),
            client: String(o?.CRMCompanyLookupName ?? o?.ClientName ?? o?.CompanyName ?? "—"),
            stage: String(o?.CRMProjectStatusChoice ?? o?.Status ?? "—"),
            value: fmtMoney(getValue(o)),
          })),
        },
      });
    }

    // 4. Client concentration — single client > 25% of active portfolio.
    // Only fires with a REAL client name; when most projects have no client
    // recorded we surface a data-quality note instead of a fabricated risk.
    if (topClientEntry && topClientShare > 25 && !clientDataGap) {
      const clientProjects = activePmm
        .filter((p) => clientLabelOf(p) === topClientEntry[0])
        .slice()
        .sort((a, b) => getValue(b) - getValue(a));
      risks.push({
        level: topClientShare > 40 ? "CRIT" : "WARN",
        kind: "concentration",
        horizon: winNatUpper,
        text: `${topClientEntry[0]} makes up ${topClientShare}% of active work · heavy reliance on one client`,
        detail: `${topClientEntry[1].count} active project${topClientEntry[1].count === 1 ? "" : "s"} · ${fmtMoney(topClientEntry[1].value)} value · if this client pauses, a large share of revenue pauses with them`,
        records: {
          title: `Work tied to one client: ${topClientEntry[0]}`,
          subtitle: `${topClientEntry[1].count} active project${topClientEntry[1].count === 1 ? "" : "s"} · ${fmtMoney(topClientEntry[1].value)} (${topClientShare}% of ${fmtMoney(pmmActiveValue)} in active projects)`,
          columns: [
            { key: "title", label: "Project" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: clientProjects.map((p) => ({
            _ticket: ticketOf(p),
            title: getProjectTitle(p),
            value: fmtMoney(getValue(p)),
          })),
        },
      });
    } else if (clientDataGap) {
      risks.push({
        level: "INSIGHT",
        kind: "data-quality",
        horizon: winNatUpper,
        text: `${noClientCount} active project${noClientCount === 1 ? " is" : "s are"} missing a client name`,
        detail: `${fmtMoney(noClientValue)} of active work has no client recorded — adding clients unlocks revenue-by-client insight`,
        records: {
          title: "Projects missing a client name",
          subtitle: `${noClientCount} active project${noClientCount === 1 ? "" : "s"} · ${fmtMoney(noClientValue)} combined value · add a client on each project record`,
          columns: [
            { key: "title", label: "Project" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: activePmm
            .filter((p) => !clientLabelOf(p))
            .slice()
            .sort((a, b) => getValue(b) - getValue(a))
            .slice(0, MAX_DETAIL_ROWS)
            .map((p) => ({
              _ticket: ticketOf(p),
              title: getProjectTitle(p),
              value: fmtMoney(getValue(p)),
            })),
        },
      });
    }

    // Fallback insight when no financial risks are flagged
    if (risks.length === 0) {
      risks.push({
        level: "INSIGHT",
        horizon: winNatUpper,
        text: `Financial posture nominal · ${fmtMoney(pmmActiveValue)} active portfolio · ${propCoverage}% pipeline replenishment`,
        detail: `No critical financial risks detected — ${winNatProse}`,
        records: {
          title: "Pipeline opportunities",
          subtitle: `${opm.length} opportunit${opm.length === 1 ? "y" : "ies"} · ${fmtMoney(opmValue)} total`,
          columns: [
            { key: "title", label: "Opportunity" },
            { key: "client", label: "Client" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: coverageRecords.map((o) => ({
            _ticket: ticketOf(o),
            title: getProjectTitle(o),
            client: String(o?.CRMCompanyLookupName ?? o?.ClientName ?? o?.CompanyName ?? "—"),
            value: fmtMoney(getValue(o)),
          })),
        },
      });
    }
  } else if (role === "COO") {
    // ---- COO risk feed: C-suite operational signals ordered by urgency ----

    // Window-filtered pipeline slices so signals 3 and 6 respect the day selector.
    // Undated OPMs are excluded from winAdvancedOpm — without a close date we
    // can't say they're "near-close in X days", so they shouldn't pad the count.
    const winAdvancedOpm = opm
      .filter((o) => !isOpmEarlyStage(o))
      .filter((o) => {
        const d = effEnd(o);
        if (!d) return false; // undated = cannot determine window proximity
        return d.getTime() <= windowEndMs;
      })
      .sort((a, b) => getValue(b) - getValue(a));
    const winAdvancedOpmValue = winAdvancedOpm.reduce((s, o) => s + getValue(o), 0);

    // projectsClosingInWindow + closingValue computed at shared level above (line ~390).
    // OPMs with an explicit date landing inside the window (for the pipeline count).
    const opmInWindow = opm.filter((o) => {
      const d = effEnd(o);
      if (!d) return false;
      const ms = d.getTime();
      return (isAllTime || ms >= nowMs) && ms <= windowEndMs;
    });

    // 1. Burnout / overload (most urgent — team health & delivery risk)
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
        horizon: winNatUpper,
        text: `${stretchedProjects} project team${stretchedProjects === 1 ? "" : "s"} over capacity · delivery risk`,
        detail: `Total demand > 1.0 FTE · rebalance or add headcount before the upcoming peak`,
        records: {
          title: "Overloaded project teams",
          subtitle: `${stretchedProjects} team${stretchedProjects === 1 ? "" : "s"} with total demand > 1.0 FTE · sorted by load`,
          columns: [
            { key: "title", label: "Project" },
            { key: "count", label: "Demands", align: "right", note: "Number of open role requests that haven't been filled with a person yet" },
            { key: "alloc", label: "Avg / FTE total", align: "right", note: "Average % needed per request · total headcount those requests add up to" },
          ],
          rows: stretched.map((x) => {
            const proj = activePmm.find(
              (p) => String(p?.TicketId ?? p?.RecordCode ?? "") === x.tid,
            );
            const avg = x.count ? Math.round(x.sum / x.count) : 0;
            return {
              _ticket: x.tid,
              title: getProjectTitle(proj) || x.tid,
              count: x.count,
              alloc: `avg ${avg}% · ~${(x.sum / 100).toFixed(1)} FTE`,
            };
          }),
        },
      });
    }

    // 2. Top role demand shortfall (hiring signal)
    if (topRole && topRole.count >= 2) {
      const roleDemands = (demandsByRole[topRole.role] || [])
        .slice()
        .sort((a, b) => (Number(b?.PctAllocation) || 0) - (Number(a?.PctAllocation) || 0));
      const fteNeeded = (topRole.sum / 100).toFixed(1);
      const avgPct = Math.round(topRole.sum / topRole.count);
      risks.push({
        level: topRole.sum > 300 ? "CRIT" : "WARN",
        horizon: winNatUpper,
        text: `${topRole.role} capacity gap · ${topRole.count} concurrent reqs · ~${fteNeeded} FTE`,
        detail: `${topRole.count} reqs · avg ${avgPct}% · ~${fteNeeded} FTE total · approve headcount or reallocate`,
        records: {
          title: `${topRole.role} demand — capacity gap`,
          subtitle: `${topRole.count} demand record${topRole.count === 1 ? "" : "s"} · avg ${avgPct}% per req · ~${fteNeeded} FTE total needed`,
          columns: [
            { key: "title", label: "Demand / Project" },
            { key: "alloc", label: "% Alloc", align: "right", note: "Hours booked on this role ÷ total working hours in the period" },
            { key: "window", label: "Window", align: "right", note: "The start and end dates for this assignment or demand" },
          ],
          rows: roleDemands.map((d) => {
            const raId = demandRaId(d);
            // Keep these exact demand identifiers on the otherwise compact
            // project row. The alert panel does not display them, but uses them
            // when "Add Team Member" is chosen to prefill the right role and
            // retire this specific open position rather than guessing later.
            return {
              _ticket: demandTicket(d),
              ...(raId !== null ? { _raId: raId } : {}),
              // Role ONLY — d.Title is the demand row's PROJECT title in this
              // file (see demandProjectName), never a safe role fallback.
              role: String(d?.Role ?? "").trim(),
              title: demandProjectName(d),
              alloc: `${Math.round(Number(d?.PctAllocation) || 0)}%`,
              window: fmtRange(d?.AllocationStartDate, d?.AllocationEndDate),
            };
          }),
        },
      });
    }

    // 3. Delivery horizon — projects completing within the selected window.
    // PMM effective end dates are reliably populated so this count genuinely
    // changes between 7D / 30D / 60D / 90D, giving the window selector real teeth.
    if (projectsClosingInWindow.length > 0) {
      const urgency = projectsClosingInWindow.length >= 5 ? "CRIT"
        : projectsClosingInWindow.length >= 2 ? "WARN" : "INSIGHT";
      risks.push({
        level: urgency,
        horizon: winNatUpper,
        text: `${projectsClosingInWindow.length} project${plural(projectsClosingInWindow.length)} closing · ${fmtMoney(closingValue)} · closeout readiness`,
        detail: `Projects with target completion ${winNatProse} · ensure billing closeout, final deliverables, and staff redeployment are planned`,
        records: {
          title: `Projects completing `,
          subtitle: `${projectsClosingInWindow.length} project${plural(projectsClosingInWindow.length)} · ${fmtMoney(closingValue)} total · sorted by target completion date`,
          columns: [
            { key: "title", label: "Project" },
            { key: "client", label: "Client" },
            { key: "due", label: "End Date", align: "right" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: projectsClosingInWindow.slice(0, MAX_DETAIL_ROWS).map((p) => ({
            _ticket: ticketOf(p),
            title: getProjectTitle(p),
            client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
            due: fmtDate(effEndStr(p)),
            value: fmtMoney(getValue(p)),
          })),
        },
      });
    }

    // 4. Near-close pipeline → delivery capacity pressure (window-filtered)
    if (winAdvancedOpm.length > 0) {
      risks.push({
        level: "WARN",
        horizon: winNatUpper,
        text: `${winAdvancedOpm.length} pursuit${winAdvancedOpm.length === 1 ? "" : "s"} near close  · ${fmtMoney(winAdvancedOpmValue)} · delivery team readiness needed`,
        detail: `Advanced-stage opportunities closing with · ensure delivery capacity is ready before contract award`,
        records: {
          title: "Near-close pursuits — delivery readiness required",
          subtitle: `${winAdvancedOpm.length} opportunit${winAdvancedOpm.length === 1 ? "y" : "ies"} in Propose/Negotiate/Final stages · ${fmtMoney(winAdvancedOpmValue)} · `,
          columns: [
            { key: "title", label: "Opportunity" },
            { key: "client", label: "Client" },
            { key: "stage", label: "Stage" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: winAdvancedOpm.slice(0, MAX_DETAIL_ROWS).map((o) => ({
            _ticket: ticketOf(o),
            title: getProjectTitle(o),
            client: String(o?.CRMCompanyLookupName ?? o?.ClientName ?? o?.CompanyName ?? "—"),
            stage: String(o?.CRMProjectStatusChoice ?? o?.Status ?? "—"),
            value: fmtMoney(getValue(o)),
          })),
        },
      });
    }

    // 4. Demand-data coverage gap — window-scoped (closing projects only).
    // Count and list change across 7D/30D/60D/90D as projectsClosingInWindow changes.
    if (cooUntrackedClosing > 0) {
      const untrackedClosingProjects = cooClosingNoStaffing;
      risks.push({
        level: "WARN",
        horizon: winNatUpper,
        text: `Staffing blind spot · ${cooUntrackedClosing} of ${projectsClosingInWindow.length} closing project${plural(projectsClosingInWindow.length)} missing staffing data`,
        detail: `No team members or staffing plan for ${cooUntrackedClosing} project${plural(cooUntrackedClosing)} closing · staff redeployment cannot be planned`,
        records: {
          title: `Closing projects with no staffing data — `,
          subtitle: `${cooUntrackedClosing} of ${projectsClosingInWindow.length} projects closing have no team members or staffing plan on file`,
          columns: [
            { key: "title", label: "Project" },
            { key: "client", label: "Client" },
            { key: "due", label: "End Date", align: "right" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: untrackedClosingProjects.slice(0, MAX_DETAIL_ROWS).map((p) => ({
            _ticket: ticketOf(p),
            title: getProjectTitle(p),
            client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
            due: fmtDate(effEndStr(p)),
            value: fmtMoney(getValue(p)),
          })),
        },
      });
    }

    // Always-on INSIGHT: client concentration (≥15% portfolio share).
    // Only with a REAL client name — when most projects have no client on
    // file, show an honest data-quality note instead.
    if (topClientEntry && topClientShare >= 15 && !clientDataGap) {
      const clientProjects = activePmm
        .filter((p) => clientLabelOf(p) === topClientEntry[0])
        .slice()
        .sort((a, b) => getValue(b) - getValue(a));
      risks.push({
        level: topClientShare >= 40 ? "WARN" : "INSIGHT",
        kind: "concentration",
        horizon: winNatUpper,
        text: `${topClientEntry[0]} · ${topClientShare}% of active work · ${topClientEntry[1].count} project${plural(topClientEntry[1].count)}`,
        detail: `${fmtMoney(topClientEntry[1].value)} value rides on this one client · worth keeping an eye on`,
        records: {
          title: `Work tied to one client: ${topClientEntry[0]}`,
          subtitle: `${topClientEntry[1].count} active project${plural(topClientEntry[1].count)} · ${fmtMoney(topClientEntry[1].value)} (${topClientShare}% of ${fmtMoney(pmmActiveValue)} in active projects)`,
          columns: [
            { key: "title", label: "Project" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: clientProjects.slice(0, MAX_DETAIL_ROWS).map((p) => ({
            _ticket: ticketOf(p),
            title: getProjectTitle(p),
            value: fmtMoney(getValue(p)),
          })),
        },
      });
    } else if (clientDataGap) {
      risks.push({
        level: "INSIGHT",
        kind: "data-quality",
        horizon: winNatUpper,
        text: `${noClientCount} active project${noClientCount === 1 ? " is" : "s are"} missing a client name`,
        detail: `${fmtMoney(noClientValue)} of active work has no client recorded — adding clients unlocks revenue-by-client insight`,
        records: {
          title: "Projects missing a client name",
          subtitle: `${noClientCount} active project${noClientCount === 1 ? "" : "s"} · ${fmtMoney(noClientValue)} combined value · add a client on each project record`,
          columns: [
            { key: "title", label: "Project" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: activePmm
            .filter((p) => !clientLabelOf(p))
            .slice()
            .sort((a, b) => getValue(b) - getValue(a))
            .slice(0, MAX_DETAIL_ROWS)
            .map((p) => ({
              _ticket: ticketOf(p),
              title: getProjectTitle(p),
              value: fmtMoney(getValue(p)),
            })),
        },
      });
    }

    // Always-on INSIGHT: pipeline forward-look (window-aware — uses winOpmValue)
    if (opm.length > 0) {
      risks.push({
        level: "INSIGHT",
        horizon: winNatUpper,
        text: `Pipeline ${fmtMoney(winOpmValue)} weighted  · ${opmInWindow.length} pursuit${plural(opmInWindow.length)} closing · ${propCoverage}% replenishment score`,
        detail: `${opmInWindow.length} pursuit${plural(opmInWindow.length)} with close dates  · ${opm.length} total in pipeline · ${earlyOpmCount} early-stage`,
        records: {
          title: "Pipeline opportunities",
          subtitle: `${opm.length} opportunit${opm.length === 1 ? "y" : "ies"} total · ${fmtMoney(winOpmValue)} weighted  · ${propCoverage}% replenishment score`,
          columns: [
            { key: "title", label: "Opportunity" },
            { key: "client", label: "Client" },
            { key: "stage", label: "Stage" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: coverageRecords.slice(0, MAX_DETAIL_ROWS).map((o) => ({
            _ticket: ticketOf(o),
            title: getProjectTitle(o),
            client: String(o?.CRMCompanyLookupName ?? o?.ClientName ?? o?.CompanyName ?? "—"),
            stage: String(o?.CRMProjectStatusChoice ?? o?.Status ?? "—"),
            value: fmtMoney(getValue(o)),
          })),
        },
      });
    }

    // Fallback when no data at all
    if (risks.length === 0) {
      risks.push({
        level: "INSIGHT",
        horizon: winNatUpper,
        text: `Operational posture healthy · ${activePmm.length} active project${plural(activePmm.length)} · staffing balanced`,
        detail: `No critical operational risks detected — ${winNatProse}`,
        records: {
          title: "Active portfolio",
          subtitle: `${activePmm.length} active project${plural(activePmm.length)}`,
          columns: [
            { key: "title", label: "Project" },
            { key: "client", label: "Client" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: activePmm.slice(0, MAX_DETAIL_ROWS).map((p) => ({
            _ticket: ticketOf(p),
            title: getProjectTitle(p),
            client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
            value: fmtMoney(getValue(p)),
          })),
        },
      });
    }
  } else {
    // ---- Operational risk feed (RM / PM / EXEC) ----
    if (exposedCount > 0) {
      risks.push({
        level: exposedCount >= 5 ? "CRIT" : "WARN",
        horizon: winNatUpper,
        text: exposedRiskText(exposedCount),
        detail: `No team members or staffing plan on file · ${activePmm.length} active in portfolio`,
        records: {
          title: "Active projects with no staffing data on file",
          subtitle: `${exposedCount} active projects with no team members or staffing plan on file`,
          columns: [
            { key: "title", label: "Project" },
            { key: "client", label: "Client" },
            { key: "city", label: "City" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: exposureRecords30.map((p) => ({
            _ticket: ticketOf(p),
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
        horizon: winNatUpper,
        text: roleShortageRiskText(topRole.role, topRole.count),
        detail: `${topRole.count} reqs · avg ${avgPct}% per req · ~${fteNeeded} FTE total across portfolio · typical hire close ~45 days`,
        records: {
          title: `${topRole.role} demand · forecasted shortage`,
          subtitle: `${topRole.count} demand record${topRole.count === 1 ? "" : "s"} · avg ${avgPct}% per req · ~${fteNeeded} FTE total needed`,
          columns: [
            { key: "title", label: "Demand / Project" },
            { key: "alloc", label: "% Alloc", align: "right", note: "Hours booked on this role ÷ total working hours in the period" },
            { key: "window", label: "Window", align: "right", note: "The start and end dates for this assignment or demand" },
          ],
          rows: roleDemands.map((d) => {
            const raId = demandRaId(d);
            // Same contract as the operational-risk builder above: carry the
            // exact demand identifiers so "Add Team Member" retires THIS
            // open position on save instead of re-matching by role later.
            return {
              _ticket: demandTicket(d),
              ...(raId !== null ? { _raId: raId } : {}),
              // Role ONLY — d.Title is the demand row's PROJECT title in this
              // file (see demandProjectName), never a safe role fallback.
              role: String(d?.Role ?? "").trim(),
              title: demandProjectName(d),
              alloc: `${Math.round(Number(d?.PctAllocation) || 0)}%`,
              window: fmtRange(d?.AllocationStartDate, d?.AllocationEndDate),
            };
          }),
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
        horizon: winNatUpper,
        text: burnoutRiskText(stretchedProjects),
        detail: `Total demand > 1.0 FTE on these teams · forecast peak ${winNatProse}`,
        records: {
          title: "Project teams at burnout risk",
          subtitle: `${stretchedProjects} team${stretchedProjects === 1 ? "" : "s"} with total demand > 1.0 FTE`,
          columns: [
            { key: "title", label: "Project" },
            { key: "count", label: "Demands", align: "right", note: "Number of open role requests that haven't been filled with a person yet" },
            { key: "alloc", label: "Avg / FTE total", align: "right", note: "Average % needed per request · total headcount those requests add up to" },
          ],
          rows: stretched.map((x) => {
            const proj = activePmm.find(
              (p) => String(p?.TicketId ?? p?.RecordCode ?? "") === x.tid,
            );
            const avg = x.count ? Math.round(x.sum / x.count) : 0;
            return {
              _ticket: x.tid,
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
        horizon: winNatUpper,
        text: `Pipeline coverage at ${fmtMoney(opmValue)} across ${opm.length} opportunit${opm.length === 1 ? "y" : "ies"}`,
        detail: `Forward-looking; no critical risks detected — ${winNatProse}`,
        records: {
          title: "Pipeline opportunities",
          subtitle: `${opm.length} opportunities · ${fmtMoney(opmValue)} total`,
          columns: [
            { key: "title", label: "Opportunity" },
            { key: "client", label: "Client" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: coverageRecords.map((o) => ({
            _ticket: ticketOf(o),
            title: getProjectTitle(o),
            client: String(o?.CRMCompanyLookupName ?? o?.ClientName ?? o?.CompanyName ?? "—"),
            value: fmtMoney(getValue(o)),
          })),
        },
      });
    }
  }

  // Always cap at four for scan speed (CFO gets one extra for the extra signals).
  // Wider cap: the home feed pins the top critical separately, so more
  // distinct live risks are needed to keep the feed informative.
  const trimmedRisks = role === "CFO" ? risks.slice(0, 6) : risks.slice(0, 5);

  // ---- Universal staffing-urgency alert (EVERY persona) ----
  // A position = one (TicketId, Role) pair; "overdue" = its earliest
  // start date is already past; everything else is "upcoming". No day
  // cutoff (user mandate): every unfilled position shows, most urgent
  // first — urgency framing stays, the N-day limit is gone.
  // Added OUTSIDE the per-persona cap above so it can never be trimmed
  // away — an unfilled position past its start date matters to every
  // persona, and the Alerts page must always agree with the Resources page.
  {
    // Date-only strings must parse LOCAL (same rule as DemandOverview's
    // parseLocal) or US timezones shift today-boundary positions between
    // the overdue and soon buckets and the two pages disagree by ±1.
    const parseLocalMs = (v: unknown): number | null => {
      if (!v) return null;
      const str = String(v);
      const s = /^\d{4}-\d{2}-\d{2}$/.test(str) ? `${str}T00:00:00` : str;
      const t = new Date(s).getTime();
      return isNaN(t) ? null : t;
    };
    const rawRows = Array.isArray(rawDemands) ? rawDemands : [];
    const earliestByPos = new Map<string, { earliest: number | null; rep: any }>();
    for (const d of rawRows) {
      if (!d) continue;
      const roleName = String(d.Role ?? "").trim() || "Unspecified";
      const pk = `${String(d.TicketId ?? "")}||${roleName}`;
      const s = parseLocalMs(d.AllocationStartDate);
      const cur = earliestByPos.get(pk);
      if (!cur) earliestByPos.set(pk, { earliest: s, rep: d });
      else if (s !== null && (cur.earliest === null || s < cur.earliest)) {
        cur.earliest = s;
        cur.rep = d;
      }
    }
    const nowUrgMs = Date.now();
    const overduePos: Array<{ days: number; rep: any }> = [];
    const soonPos: Array<{ days: number; rep: any }> = [];
    for (const { earliest, rep } of earliestByPos.values()) {
      if (earliest === null) continue;
      const days = Math.round((earliest - nowUrgMs) / 86400000);
      if (days < 0) overduePos.push({ days, rep });
      else soonPos.push({ days, rep });
    }
    if (overduePos.length + soonPos.length > 0) {
      overduePos.sort((a, b) => a.days - b.days);
      soonPos.sort((a, b) => a.days - b.days);
      const fmtStart = (rep: any) => {
        const ms = parseLocalMs(rep?.AllocationStartDate);
        return ms === null
          ? "—"
          : new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      };
      const urgentRows = [...overduePos, ...soonPos].slice(0, MAX_DETAIL_ROWS).map(({ days, rep }) => ({
        _ticket: String(rep?.TicketId ?? ""),
        title: demandProjectName(rep),
        role: String(rep?.Role ?? "").trim() || "Unspecified",
        start: fmtStart(rep),
        status:
          days < 0
            ? `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`
            : days === 0
              ? "starts today"
              : `starts in ${days} day${days === 1 ? "" : "s"}`,
      }));
      const parts: string[] = [];
      if (overduePos.length > 0) parts.push(`${overduePos.length} overdue`);
      if (soonPos.length > 0) parts.push(`${soonPos.length} upcoming`);
      const totalUrgent = overduePos.length + soonPos.length;
      trimmedRisks.unshift({
        level: overduePos.length > 0 ? "CRIT" : "WARN",
        horizon: "ALL DATES",
        text: `${totalUrgent} unfilled position${plural(totalUrgent)} need${totalUrgent === 1 ? "s" : ""} urgent action · ${parts.join(" · ")}`,
        detail: `Open demand positions with no assigned person — every unfilled role across all dates, most urgent first`,
        records: {
          title: "Unfilled positions needing urgent action",
          subtitle: `${overduePos.length} past start date · ${soonPos.length} upcoming · one row per project × role`,
          columns: [
            { key: "title", label: "Project" },
            { key: "role", label: "Role" },
            { key: "start", label: "Start", align: "right" },
            { key: "status", label: "Status", align: "right" },
          ],
          rows: urgentRows,
          goTo: { to: "/resources?view=Demand", label: "Review open demands" },
        },
      });
    }
  }

  // ---- Decision support: real, actionable, derived from the data ----
  const decisions: Decision[] = [];
  let n = 1;

  if (role === "CFO") {
    // ---- CFO decision support: ranked by financial impact ----

    // 1. PRIORITIZE — cover revenue exposure on highest-value projects
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
        category: "PRIORITIZE",
        text: `Cover ${fmtMoney(exposedProjectValue)} exposure · ${exposedCount} unstaffed project${plural(exposedCount)}`,
        cta: "Review",
        tone: "green",
        detail: {
          title: "Active projects with no demand coverage — sorted by value",
          subtitle: `${exposedCount} projects with no staffing demand · ${fmtMoney(exposedProjectValue)} revenue at risk`,
          columns: [
            { key: "title", label: "Project" },
            { key: "client", label: "Client" },
            { key: "city", label: "City" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: exposedProjects.map((p) => ({
            _ticket: ticketOf(p),
            title: getProjectTitle(p),
            client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
            city: getProjectCity(p) || "—",
            value: fmtMoney(getValue(p)),
          })),
          emptyText: "No untracked projects in the current dataset.",
        },
      });
    }

    // 2. ACCELERATE — push near-close (advanced-stage) opportunities over the line
    if (advancedOpm.length > 0) {
      decisions.push({
        num: n++,
        category: "ACCELERATE",
        text: `Accelerate ${advancedOpm.length} near-close pursuit${plural(advancedOpm.length)} · ${fmtMoney(advancedOpmValue)}`,
        cta: "Review",
        tone: "green",
        detail: {
          title: "Advanced-stage opportunities — ready to close",
          subtitle: `${advancedOpm.length} opportunit${advancedOpm.length === 1 ? "y" : "ies"} in Propose/Negotiate/Final stages · ${fmtMoney(advancedOpmValue)} total value`,
          columns: [
            { key: "title", label: "Opportunity" },
            { key: "client", label: "Client" },
            { key: "stage", label: "Stage" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: advancedOpm.slice(0, MAX_DETAIL_ROWS).map((o) => ({
            _ticket: ticketOf(o),
            title: getProjectTitle(o),
            client: String(o?.CRMCompanyLookupName ?? o?.ClientName ?? o?.CompanyName ?? "—"),
            stage: String(o?.CRMProjectStatusChoice ?? o?.Status ?? "—"),
            value: fmtMoney(getValue(o)),
          })),
          emptyText: "No advanced-stage opportunities in the pipeline.",
        },
      });
    }

    // 3. DEFER — free up BD budget by cutting low-confidence pursuits
    if (earlyOpmCount > 0) {
      const earlyOpms = opm
        .filter(isOpmEarlyStage)
        .slice()
        .sort((a, b) => getValue(b) - getValue(a));
      decisions.push({
        num: n++,
        category: "DEFER",
        text: `Defer ${Math.min(3, earlyOpmCount)} low-confidence pursuit${earlyOpmCount === 1 ? "" : "s"} · free up BD budget`,
        cta: "Defer",
        tone: "orange",
        detail: {
          title: "Low-confidence pursuits to defer",
          subtitle: `${earlyOpmCount} early-stage opportunit${earlyOpmCount === 1 ? "y" : "ies"} · ${fmtMoney(earlyOpmValue)} · Identify/Qualify/ROM`,
          columns: [
            { key: "title", label: "Opportunity" },
            { key: "client", label: "Client" },
            { key: "stage", label: "Stage" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: earlyOpms.map((o) => ({
            _ticket: ticketOf(o),
            title: getProjectTitle(o),
            client: String(o?.CRMCompanyLookupName ?? o?.ClientName ?? o?.CompanyName ?? "—"),
            stage: String(o?.CRMProjectStatusChoice ?? o?.Status ?? "—"),
            value: fmtMoney(getValue(o)),
          })),
          emptyText: "No early-stage pursuits.",
        },
      });
    }

    // 4. BUDGET — approve headcount to close top role gap
    if (topRole && topRole.count >= 2) {
      const headcount = Math.max(1, Math.ceil(topRole.sum / 100) - 1);
      const roleDemands = (demandsByRole[topRole.role] || [])
        .slice()
        .sort((a, b) => (Number(b?.PctAllocation) || 0) - (Number(a?.PctAllocation) || 0));
      decisions.push({
        num: n++,
        category: "BUDGET",
        text: `Budget ${headcount} ${topRole.role} hire${plural(headcount)} · close 45D`,
        cta: "Budget",
        tone: "orange",
        detail: {
          title: `${topRole.role} demand across the portfolio`,
          subtitle: `${topRole.count} concurrent demands · ~${(topRole.sum / 100).toFixed(1)} FTE total · ${headcount} hire${plural(headcount)} to close gap`,
          columns: [
            { key: "title", label: "Demand / Project" },
            { key: "alloc", label: "% Alloc", align: "right", note: "Hours booked on this role ÷ total working hours in the period" },
            { key: "window", label: "Window", align: "right", note: "The start and end dates for this assignment or demand" },
          ],
          rows: roleDemands.map((d) => {
            const raId = demandRaId(d);
            // Same contract as the operational-risk builder above: carry the
            // exact demand identifiers so "Add Team Member" retires THIS
            // open position on save instead of re-matching by role later.
            return {
              _ticket: demandTicket(d),
              ...(raId !== null ? { _raId: raId } : {}),
              // Role ONLY — d.Title is the demand row's PROJECT title in this
              // file (see demandProjectName), never a safe role fallback.
              role: String(d?.Role ?? "").trim(),
              title: demandProjectName(d),
              alloc: `${Math.round(Number(d?.PctAllocation) || 0)}%`,
              window: fmtRange(d?.AllocationStartDate, d?.AllocationEndDate),
            };
          }),
          emptyText: "No active demands recorded for this role.",
        },
      });
    }

    if (decisions.length === 0) {
      decisions.push({
        num: n++,
        category: "CONFIRM",
        text: "Financial posture nominal · no actions required",
        cta: "Confirm",
        tone: "green",
        detail: null,
      });
    }
  } else if (role === "COO") {
    // ---- COO decision support: operational capacity leadership ----

    // 1. REBALANCE — address overloaded teams immediately (highest urgency)
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
        text: `Rebalance ${stretchedProjects} overloaded team${stretchedProjects === 1 ? "" : "s"} · prevent delivery risk`,
        cta: "Apply",
        tone: "green",
        detail: {
          title: "Overloaded project teams — rebalance capacity",
          subtitle: `${stretchedProjects} project${stretchedProjects === 1 ? "" : "s"} with total demand > 1.0 FTE · sorted by load`,
          columns: [
            { key: "title", label: "Project" },
            { key: "count", label: "Demands", align: "right", note: "Number of open role requests that haven't been filled with a person yet" },
            { key: "alloc", label: "Avg / FTE total", align: "right", note: "Average % needed per request · total headcount those requests add up to" },
          ],
          rows: stretched.map((x) => {
            const proj = activePmm.find(
              (p) => String(p?.TicketId ?? p?.RecordCode ?? "") === x.tid,
            );
            const avg = x.count ? Math.round(x.sum / x.count) : 0;
            return {
              _ticket: x.tid,
              title: getProjectTitle(proj) || x.tid,
              count: x.count,
              alloc: `avg ${avg}% · ~${(x.sum / 100).toFixed(1)} FTE`,
            };
          }),
          emptyText: "No overloaded teams detected.",
        },
      });
    }

    // 2. STAFF — approve headcount for top role gap
    if (topRole && topRole.count >= 2) {
      const headcount = Math.max(1, Math.ceil(topRole.sum / 100) - 1);
      const roleDemands = (demandsByRole[topRole.role] || [])
        .slice()
        .sort((a, b) => (Number(b?.PctAllocation) || 0) - (Number(a?.PctAllocation) || 0));
      decisions.push({
        num: n++,
        category: "STAFF",
        text: `Approve ${headcount} ${topRole.role} hire${plural(headcount)} · close within 45D`,
        cta: "Approve",
        tone: "green",
        detail: {
          title: `${topRole.role} demand across the portfolio`,
          subtitle: `${topRole.count} concurrent demands · ~${(topRole.sum / 100).toFixed(1)} FTE total · ${headcount} hire${plural(headcount)} to close gap`,
          columns: [
            { key: "title", label: "Demand / Project" },
            { key: "alloc", label: "% Alloc", align: "right", note: "Hours booked on this role ÷ total working hours in the period" },
            { key: "window", label: "Window", align: "right", note: "The start and end dates for this assignment or demand" },
          ],
          rows: roleDemands.map((d) => {
            const raId = demandRaId(d);
            // Same contract as the operational-risk builder above: carry the
            // exact demand identifiers so "Add Team Member" retires THIS
            // open position on save instead of re-matching by role later.
            return {
              _ticket: demandTicket(d),
              ...(raId !== null ? { _raId: raId } : {}),
              // Role ONLY — d.Title is the demand row's PROJECT title in this
              // file (see demandProjectName), never a safe role fallback.
              role: String(d?.Role ?? "").trim(),
              title: demandProjectName(d),
              alloc: `${Math.round(Number(d?.PctAllocation) || 0)}%`,
              window: fmtRange(d?.AllocationStartDate, d?.AllocationEndDate),
            };
          }),
          emptyText: "No active demands recorded for this role.",
        },
      });
    }

    // 3. ACCELERATE — near-close pursuits need delivery team readiness
    if (advancedOpm.length > 0) {
      decisions.push({
        num: n++,
        category: "ACCELERATE",
        text: `Ready delivery teams for ${advancedOpm.length} near-close pursuit${plural(advancedOpm.length)} · ${fmtMoney(advancedOpmValue)}`,
        cta: "Review",
        tone: "green",
        detail: {
          title: "Near-close pursuits — delivery readiness",
          subtitle: `${advancedOpm.length} opportunit${advancedOpm.length === 1 ? "y" : "ies"} in Propose/Negotiate/Final · ${fmtMoney(advancedOpmValue)} total value`,
          columns: [
            { key: "title", label: "Opportunity" },
            { key: "client", label: "Client" },
            { key: "stage", label: "Stage" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: advancedOpm.slice(0, MAX_DETAIL_ROWS).map((o) => ({
            _ticket: ticketOf(o),
            title: getProjectTitle(o),
            client: String(o?.CRMCompanyLookupName ?? o?.ClientName ?? o?.CompanyName ?? "—"),
            stage: String(o?.CRMProjectStatusChoice ?? o?.Status ?? "—"),
            value: fmtMoney(getValue(o)),
          })),
          emptyText: "No advanced-stage opportunities in the pipeline.",
        },
      });
    }

    // 4. REVIEW — demand data quality for closing projects (window-scoped).
    // List and count change with 7D/30D/60D/90D selector.
    if (cooUntrackedClosing > 0) {
      const untrackedClosingProjects = cooClosingNoStaffing;
      decisions.push({
        num: n++,
        category: "REVIEW",
        text: `Add staffing data to ${cooUntrackedClosing} closing project${plural(cooUntrackedClosing)}  · enable redeployment planning`,
        cta: "Review",
        tone: "orange",
        detail: {
          title: `Closing projects missing staffing data — `,
          subtitle: `${cooUntrackedClosing} of ${projectsClosingInWindow.length} projects closing have no team members or staffing plan on file · sorted by target end date`,
          columns: [
            { key: "title", label: "Project" },
            { key: "client", label: "Client" },
            { key: "due", label: "End Date", align: "right" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: untrackedClosingProjects.map((p) => ({
            _ticket: ticketOf(p),
            title: getProjectTitle(p),
            client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
            due: fmtDate(effEndStr(p)),
            value: fmtMoney(getValue(p)),
          })),
          emptyText: "All closing projects have demand data on file.",
        },
      });
    }

    if (decisions.length === 0) {
      decisions.push({
        num: n++,
        category: "CONFIRM",
        text: "Operational posture healthy · no actions required",
        cta: "Confirm",
        tone: "green",
        detail: null,
      });
    }
  } else {
    // ---- Operational decision support (RM / PM / EXEC) ----
    // Projects closing WITHIN the selected window with no demand data.
    // This is the most urgent review — delivery is imminent and no staff plan exists.
    // The count genuinely changes per window (7D/30D/60D/90D) because
    // projectsClosingInWindow filters by the effective end date vs the horizon.
    const closingInWindowUntracked = projectsClosingInWindow.filter((p) => {
      const tid = String(p?.TicketId ?? p?.RecordCode ?? "");
      return !tid || (!winDemandsByProject[tid] && !isStaffed(tid));
    });

    if (exposedCount > 0) {
      // DEDUPE: the unstaffed-projects story already leads the risk feed
      // (CRIT/WARN at exposedCount, usually the Pinned Critical card).
      // Repeating it here as a RESOLVE/REVIEW decision told the same story
      // twice with two different counts (all unstaffed vs. only those with a
      // target end date) — skip it and let the risk card own the story.
    } else if (closingInWindowUntracked.length > 0) {
      // Rare: all-time coverage looks fine but projects ending within the
      // horizon have no windowed staffing plan — surface it since no risk
      // card is telling this story.
      decisions.push({
        num: n++,
        category: "RESOLVE",
        text: `Resolve staffing for ${closingInWindowUntracked.length} project${plural(closingInWindowUntracked.length)} closing ${winNatProse}`,
        cta: "Review",
        tone: "green",
        detail: {
          title: `Projects closing ${winNatProse} with no staffing data`,
          subtitle: `${closingInWindowUntracked.length} of ${projectsClosingInWindow.length} project${plural(projectsClosingInWindow.length)} completing  · redeployment plan needed before close`,
          columns: [
            { key: "title", label: "Project" },
            { key: "client", label: "Client" },
            { key: "due", label: "End Date", align: "right" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: closingInWindowUntracked.map((p) => ({
            _ticket: ticketOf(p),
            title: getProjectTitle(p),
            client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
            due: fmtDate(effEndStr(p)),
            value: fmtMoney(getValue(p)),
          })),
          emptyText: `All projects closing ${winNatProse} have demand data on file.`,
        },
      });
    } else {
      decisions.push({
        num: n++,
        category: "REVIEW",
        text: projectsClosingInWindow.length > 0
          ? `All ${projectsClosingInWindow.length} project${plural(projectsClosingInWindow.length)} closing ${winNatProse} are staffed`
          : `No projects closing ${winNatProse} · demand coverage on track`,
        cta: "Review",
        tone: "green",
        detail: null,
      });
    }

    // Overdue projects — real re-baseline work whenever any active project
    // is already past its target completion date.
    if (overdue.length > 0) {
      const overdueSorted = overdue
        .slice()
        .sort(
          (a, b) =>
            (getDeadline(a)?.getTime() ?? Infinity) -
            (getDeadline(b)?.getTime() ?? Infinity),
        );
      decisions.push({
        num: n++,
        category: "RESOLVE",
        text: `Re-baseline ${overdue.length} project${plural(overdue.length)} past target completion`,
        cta: "Review",
        tone: "orange",
        detail: {
          title: "Active projects past target completion",
          subtitle: `${overdue.length} of ${activePmm.length} active project${plural(activePmm.length)} past their target end date · re-baseline or close out`,
          columns: [
            { key: "title", label: "Project" },
            { key: "client", label: "Client" },
            { key: "due", label: "End Date", align: "right" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: overdueSorted.map((p) => ({
            _ticket: ticketOf(p),
            title: getProjectTitle(p),
            client: String(p?.CRMCompanyLookupName ?? p?.ClientName ?? p?.CompanyName ?? "—"),
            due: fmtDate(effEndStr(p)),
            value: fmtMoney(getValue(p)),
          })),
          emptyText: "No overdue active projects.",
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
        text: hireDecisionText(topRole.role, Math.max(1, Math.ceil(topRole.sum / 100) - 1)),
        cta: "Hire",
        tone: "green",
        detail: {
          title: `${topRole.role} demand across the portfolio`,
          subtitle: `${topRole.count} concurrent demands · avg ${topRole.count ? Math.round(topRole.sum / topRole.count) : 0}% per req · ~${(topRole.sum / 100).toFixed(1)} FTE total`,
          columns: [
            { key: "title", label: "Demand / Project" },
            { key: "alloc", label: "% Alloc", align: "right", note: "Hours booked on this role ÷ total working hours in the period" },
            { key: "window", label: "Window", align: "right", note: "The start and end dates for this assignment or demand" },
          ],
          rows: roleDemands.map((d) => {
            const raId = demandRaId(d);
            // Same contract as the operational-risk builder above: carry the
            // exact demand identifiers so "Add Team Member" retires THIS
            // open position on save instead of re-matching by role later.
            return {
              _ticket: demandTicket(d),
              ...(raId !== null ? { _raId: raId } : {}),
              // Role ONLY — d.Title is the demand row's PROJECT title in this
              // file (see demandProjectName), never a safe role fallback.
              role: String(d?.Role ?? "").trim(),
              title: demandProjectName(d),
              alloc: `${Math.round(Number(d?.PctAllocation) || 0)}%`,
              window: fmtRange(d?.AllocationStartDate, d?.AllocationEndDate),
            };
          }),
          emptyText: "No active demands recorded for this role.",
        },
      });
    } else {
      // No single role above threshold — but if any demand is open at all,
      // show the real demand book by role instead of an "all clear" filler.
      const roleGroups = Object.entries(demandsByRole)
        .map(([roleName, arr]) => ({
          role: roleName,
          count: arr.length,
          fte: arr.reduce((s, d) => s + (Number(d?.PctAllocation) || 0), 0) / 100,
        }))
        .filter((g) => g.count > 0)
        .sort((a, b) => b.count - a.count);
      const totalOpen = roleGroups.reduce((s, g) => s + g.count, 0);
      if (totalOpen > 0) {
        decisions.push({
          num: n++,
          category: "HIRE",
          text: `Fill ${totalOpen} open demand position${plural(totalOpen)} across ${roleGroups.length} role${plural(roleGroups.length)}`,
          cta: "Review",
          tone: "green",
          detail: {
            title: "Open demand positions by role",
            subtitle: `${totalOpen} open position${plural(totalOpen)} · ${roleGroups.length} role${plural(roleGroups.length)} requested across the portfolio`,
            columns: [
              { key: "role", label: "Role" },
              { key: "count", label: "Open demands", align: "right", note: "Role requests not yet filled with a person" },
              { key: "fte", label: "~FTE", align: "right", note: "Total % allocation requested ÷ 100" },
            ],
            rows: roleGroups.map((g) => {
              // A role with exactly ONE open demand identifies a single
              // position — carry its exact ids so "Add Team Member" can fill
              // it directly. Multi-demand roles stay id-less; the quick
              // action then routes to the demand book instead of guessing.
              const arr = demandsByRole[g.role] ?? [];
              const only = arr.length === 1 ? arr[0] : null;
              const raId = only ? demandRaId(only) : null;
              const ticket = only ? demandTicket(only) : "";
              return {
                ...(ticket ? { _ticket: ticket } : {}),
                ...(raId !== null ? { _raId: raId } : {}),
                ...(only ? { title: demandProjectName(only) } : {}),
                role: g.role,
                count: g.count,
                fte: `~${g.fte.toFixed(1)}`,
              };
            }),
            emptyText: "No open demand positions.",
            goTo: { to: "/resources?view=Demand", label: "Review open demands" },
          },
        });
      } else {
        decisions.push({
          num: n++,
          category: "HIRE",
          text: `No role gaps above threshold · ${winNatUpper}`,
          cta: "Review",
          tone: "green",
          detail: null,
        });
      }
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
        text: rebalanceDecisionText(stretchedProjects),
        cta: "Apply",
        tone: "green",
        detail: {
          title: `Overloaded project teams`,
          subtitle: `${stretchedProjects} project${stretchedProjects === 1 ? "" : "s"} with total demand > 1.0 FTE`,
          columns: [
            { key: "title", label: "Project" },
            { key: "count", label: "Demands", align: "right", note: "Number of open role requests that haven't been filled with a person yet" },
            { key: "alloc", label: "Avg / FTE total", align: "right", note: "Average % needed per request · total headcount those requests add up to" },
          ],
          rows: stretched.map((x) => {
            const proj = activePmm.find(
              (p) => String(p?.TicketId ?? p?.RecordCode ?? "") === x.tid,
            );
            const avg = x.count ? Math.round(x.sum / x.count) : 0;
            return {
              _ticket: x.tid,
              title: getProjectTitle(proj) || x.tid,
              count: x.count,
              alloc: `avg ${avg}% · ~${(x.sum / 100).toFixed(1)} FTE`,
            };
          }),
          emptyText: "No overloaded teams detected.",
        },
      });
    } else {
      decisions.push({
        num: n++,
        category: "REBALANCE",
        text: `No overloaded teams detected · ${winNatUpper}`,
        cta: "Review",
        tone: "green",
        detail: null,
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
        text: `Defer ${Math.min(3, earlyOpmCount)} low-confidence pursuit${earlyOpmCount === 1 ? "" : "s"} · ${winNatUpper}`,
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
            _ticket: ticketOf(o),
            title: getProjectTitle(o),
            client: String(o?.CRMCompanyLookupName ?? o?.ClientName ?? o?.CompanyName ?? "—"),
            stage: String(o?.CRMProjectStatusChoice ?? o?.Status ?? "—"),
            value: fmtMoney(getValue(o)),
          })),
          emptyText: "No early-stage pursuits.",
        },
      });
    } else if (openOpm.length > 0) {
      // No early-stage pursuits to defer — surface the live pipeline book
      // (top OPEN pursuits by value) instead of an "all clear" filler.
      // Uses openOpm/getOpmValue so the numbers agree with the Pipeline
      // Coverage KPI on the same page.
      const topOpps = openOpm
        .slice()
        .sort((a, b) => getOpmValue(b) - getOpmValue(a))
        .slice(0, MAX_DETAIL_ROWS);
      const pipelineValue = openOpm.reduce((s, o) => s + getOpmValue(o), 0);
      decisions.push({
        num: n++,
        category: "ADVANCE",
        text: `Advance ${openOpm.length} active pursuit${plural(openOpm.length)} · ${fmtMoney(pipelineValue)} in pipeline`,
        cta: "Review",
        tone: "green",
        detail: {
          title: "Active pipeline pursuits by value",
          subtitle: `${openOpm.length} open opportunit${openOpm.length === 1 ? "y" : "ies"} · ${fmtMoney(pipelineValue)} total pipeline value`,
          columns: [
            { key: "title", label: "Opportunity" },
            { key: "client", label: "Client" },
            { key: "stage", label: "Stage" },
            { key: "value", label: "Value", align: "right" },
          ],
          rows: topOpps.map((o) => ({
            _ticket: ticketOf(o),
            title: getProjectTitle(o),
            client: String(o?.CRMCompanyLookupName ?? o?.ClientName ?? o?.CompanyName ?? "—"),
            stage: opmStageOf(o) || "—",
            value: fmtMoney(getOpmValue(o)),
          })),
          emptyText: "No open opportunities in the pipeline.",
        },
      });
    } else {
      decisions.push({
        num: n++,
        category: "DEFER",
        text: `Pipeline stage mix healthy · no early-stage pursuits`,
        cta: "Review",
        tone: "green",
        detail: null,
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
            _ticket: ticketOf(l),
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
  }
  // "All clear" placeholder rows (detail: null — "No role gaps above
  // threshold", "No overloaded teams detected", "Pipeline stage mix
  // healthy", "posture nominal" etc.) are noise, not actions: when there
  // is nothing to act on, show nothing. Renumber so the visible actions
  // stay 1..N after the placeholders drop out.
  const trimmedDecisions = decisions
    .filter((d) => d.detail !== null)
    .slice(0, 4)
    .map((d, i) => ({ ...d, num: i + 1 }));

  // Live-signal pill: total observable drivers = sub-drivers + risks + decisions
  const signalCount =
    subDrivers.length + trimmedRisks.length + trimmedDecisions.length;

  return {
    health,
    healthLabel,
    statusWord,
    role,
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
