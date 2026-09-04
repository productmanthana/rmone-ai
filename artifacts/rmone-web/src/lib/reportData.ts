/* ─────────────────────────────────────────────────────────────
 * reportData.ts — single source of truth for the executive
 * Reports (/intelligence) and Analytics (/analytics) pages AND
 * the PDF / Excel export engine. Aggregates live PMM / OPM / LEM
 * records + workforce allocations + demand + CFO health into one
 * normalized ReportModel. Real data only — no fabricated numbers.
 * ──────────────────────────────────────────────────────────── */
import { compactUsd } from "./money";
import {
  getModuleRecords,
  getResourceAllocations,
  getResourceDemands,
  getCFOFinancialHealth,
  getStatusHistory,
  peekCached,
  type CFOFinancialHealth,
  type StatusChangeItem,
  type StatusHistoryResponse,
} from "@/lib/api";

export type { StatusChangeItem };
import { effStart, effEnd } from "@/lib/projectDates";

/* ── field helpers (proven mappings from projects.tsx / dashboardData.ts) ── */
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanLabel(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s === "0" || s === "None" || s.toLowerCase() === "null") return null;
  if (GUID_RE.test(s)) return null;
  return s;
}

function isoOrNull(v: unknown): string | null {
  if (!v) return null;
  const s = String(v);
  if (s.startsWith("0001") || s.startsWith("1900-01-01")) return null;
  const d = new Date(s);
  if (isNaN(d.getTime()) || d.getFullYear() < 1950) return null;
  return d.toISOString();
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** PMM portfolio value: contract value first, then labor / forecast fallbacks. */
function pmmValue(p: any): number {
  return num(p?.ApproxContractValue) || num(p?.LaborContractAmount) || num(p?.ForecastedProjectCost);
}
/** OPM pursuit value (user direction May 2026): forecast cost first. */
function opmValue(o: any): number {
  return num(o?.ForecastedProjectCost) || num(o?.ApproxContractValue) || num(o?.LaborContractAmount);
}
function lemValue(l: any): number {
  return num(l?.ApproxContractValue) || num(l?.ForecastedProjectCost) || num(l?.LaborContractAmount);
}

function getClient(a: any): string | null {
  return (
    cleanLabel(a?.CRMCompanyLookupName) || cleanLabel(a?.CompanyName) ||
    cleanLabel(a?.CRMCompanyNameChoice) || cleanLabel(a?.ClientName) ||
    cleanLabel(a?.Company) || cleanLabel(a?.Client)
  );
}
function getSector(a: any): string {
  const candidates = [a?.SectorChoice, a?.Sector, a?.SectorName, a?.MarketSector, a?.IndustryChoice, a?.Industry];
  for (const c of candidates) {
    const s = cleanLabel(c);
    if (s) return s;
  }
  return "Other";
}
/* Division / Business Unit / Department are SEPARATE canonical dimensions.
 * Each getter reads ONLY its own columns — a Division must never show a
 * Business Unit's label (and vice versa), or same-named units in different
 * dimensions silently merge unrelated records. Missing = null (Unassigned). */
function getDivision(a: any): string | null {
  return (
    cleanLabel(a?.DivisionLookupName) || cleanLabel(a?.DivisionName) ||
    // Legacy rows sometimes store the division TITLE in the lookup column;
    // bare-number lookup IDs are junk, not names (numeric-name rule).
    (() => { const s = cleanLabel(a?.DivisionLookup); return s && !/^\d+$/.test(s) ? s : null; })()
  );
}
function getBusinessUnit(a: any): string | null {
  return cleanLabel(a?.BusinessUnitName) || cleanLabel(a?.CRMBusinessUnitChoice) || null;
}
function getDepartment(a: any): string | null {
  return cleanLabel(a?.DepartmentName) || cleanLabel(a?.DepartmentLookupName) || null;
}
/** Stable org IDs deliberately bypass cleanLabel: a valid identity can be a
 * GUID, while cleanLabel treats GUIDs as non-display text. */
function getStableOrgId(...values: unknown[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const id = String(value).trim();
    if (id && id !== "0" && id.toLowerCase() !== "null") return id;
  }
  return null;
}
function getDivisionId(a: any): string | null {
  const lookup = a?.DivisionLookup;
  return getStableOrgId(
    a?.DivisionId, a?.DivisionID, a?.DivisionIdLookup, a?.DivisionLookupId,
    typeof lookup === "number" || /^\d+$/.test(String(lookup ?? "")) ? lookup : null,
  );
}
function getBusinessUnitId(a: any): string | null {
  return getStableOrgId(
    a?.BusinessUnitId, a?.BusinessUnitID, a?.BusinessUnitIdLookup,
    a?.BusinessUnitLookupId, a?.CRMBusinessUnitId,
  );
}
function getDepartmentId(a: any): string | null {
  const lookup = a?.DepartmentLookup;
  return getStableOrgId(
    a?.DepartmentId, a?.DepartmentID, a?.DepartmentIdLookup, a?.DepartmentLookupId,
    typeof lookup === "number" || /^\d+$/.test(String(lookup ?? "")) ? lookup : null,
  );
}
function getCity(a: any): string | null {
  return cleanLabel(a?.City) || cleanLabel(a?.ProjectCity) || cleanLabel(a?.Location);
}
/* Owner display: *User columns hold comma lists of GUIDs OR display names —
 * take the first non-GUID token (GUID_RE above) so a GUID never shows on a report. */
function firstNameToken(v: unknown): string | null {
  const s = cleanLabel(v);
  if (!s) return null;
  for (const tok of s.split(",").map(t => t.trim())) {
    if (tok && !GUID_RE.test(tok)) return tok;
  }
  return null;
}
function getOwner(a: any): string | null {
  return (
    firstNameToken(a?.OwnerName) || firstNameToken(a?.ProjectManagerUser) ||
    firstNameToken(a?.ProjectLeadUser) || firstNameToken(a?.BusinessLeadUser)
  );
}
function isClosed(a: any): boolean { return a?.Closed === true; }
function isWonStage(stage: string): boolean {
  const s = stage.toLowerCase();
  return s.includes("award") || s.includes("won");
}
/** Opp stamped "Closed – Won" by the convert-to-project flow (dash style
 *  varies across data sources, so match on the words, not the exact bytes). */
function isConvertedStage(stage: string): boolean {
  const s = stage.toLowerCase();
  return s.includes("closed") && s.includes("won");
}

/* ── normalized row types (feed UI tables + Excel/PDF exports) ── */
export type ProjectRow = {
  id: string; name: string; client: string | null; sector: string;
  city: string | null; division: string | null; businessUnit: string | null; status: string;
  divisionId?: string | null; businessUnitId?: string | null; departmentId?: string | null;
  value: number; laborContract: number; forecastCost: number;
  targetStart: string | null; targetEnd: string | null;
  overdue: boolean; daysOverdue: number | null; noDate: boolean;
  /* Report-page fields (additive — older fixtures may omit them; consumers
   * must tolerate undefined and render "—", never a fabricated value). */
  created?: string | null; owner?: string | null;
  closeoutDate?: string | null; closedDate?: string | null;
  /** Canonical department label (additive — see note above). */
  department?: string | null;
};
export type OppRow = {
  id: string; name: string; client: string | null; sector: string;
  city: string | null; division: string | null; stage: string;
  divisionId?: string | null; businessUnitId?: string | null; departmentId?: string | null;
  value: number; probability: number | null; weighted: number;
  bidDate: string | null; daysToBid: number | null;
  closed: boolean; won: boolean;
  /* Report-page fields (additive — see ProjectRow note). */
  created?: string | null; owner?: string | null;
  /** AwardedorLossDate — when the bid was decided (often unrecorded). */
  decidedDate?: string | null;
  /* Canonical org labels (additive — see ProjectRow note). */
  businessUnit?: string | null;
  department?: string | null;
};
export type LeadRow = {
  id: string; name: string; client: string | null; sector: string;
  city: string | null; status: string; value: number;
  /* Report-page fields (additive — see ProjectRow note). */
  created?: string | null; owner?: string | null; division?: string | null;
  /** For "Converted" leads: what the lead became — "Opportunity", "Project", or undefined. */
  convertedTo?: string;
  /* Canonical org labels (additive — see ProjectRow note). */
  businessUnit?: string | null;
  department?: string | null;
  divisionId?: string | null; businessUnitId?: string | null; departmentId?: string | null;
};
/** One allocation entry carried on a StaffRow. Field names match the
 *  alloc-math AllocEntryLike shape so builders can feed these straight
 *  into allocEntryHrsPerWeek() — the one choke point that decides
 *  whether an entry means hours or a % of the work week. */
export type StaffAlloc = {
  projectId: string;
  projectName?: string;
  pct: number;
  hours?: number;
  /** Date-only strings ("2026-03-02") kept raw — parse with parseLocalDay. */
  startDate?: string;
  endDate?: string;
};
export type StaffRow = {
  id: string; name: string; role: string | null; division: string | null;
  divisionId?: string | null; businessUnitId?: string | null; departmentId?: string | null;
  utilization: number; activeProjects: number;
  /** Distinct projects across the person's full allocation history. */
  totalProjects?: number;
  band: "Available" | "Light" | "Normal" | "Full" | "Overloaded";
  /* Optional org/HR fields (additive — older cached models and the honesty
   * check's minimal fixtures may not carry them; consumers must tolerate
   * undefined and render "—", never a fabricated value). */
  businessUnit?: string | null;
  department?: string | null;
  employmentType?: string | null;
  city?: string | null;
  /** Allocation entries (all known, incl. future) for windowed hours math. */
  allocations?: StaffAlloc[];
};
export type DemandRow = {
  ticket: string; project: string; role: string; pct: number;
  start: string | null; end: string | null; soft: boolean;
};

export type NamedValue = { label: string; value: number; count: number; key?: string };
export type SectorWinLoss = { sector: string; won: number; lost: number; wonValue: number; lostValue: number };

/* lifecycle conversions: leads that became opportunities, opps that became projects */
export type ConversionStats = {
  leadsTotal: number;            // every lead on record (open + closed + converted)
  leadsConverted: number;
  leadsConvertedValue: number;   // Σ estimated value of converted leads
  leadConversionRate: number | null;   // % of all leads that became opportunities
  oppsTotal: number;             // every opportunity on record
  oppsConverted: number;
  oppsConvertedValue: number;    // Σ contract value moved into delivery
  oppConversionRate: number | null;    // % of all opps that became projects
  convertedLeads: LeadRow[];
  convertedOpps: OppRow[];
};

export type ReportModel = {
  generatedAt: string;

  /* headline KPIs */
  backlogValue: number;          // active PMM total value
  activeProjects: number;
  pipelineValue: number;         // open OPM total value
  weightedPipeline: number;      // Σ value × probability
  activeBids: number;
  leadCount: number; leadValue: number;
  wonCount: number; lostCount: number;
  wonValue: number; lostValue: number;
  winRate: number | null;        // % of decided bids won
  totalStaff: number; benchCount: number; overAllocCount: number; healthyCount: number;
  deployedRate: number | null;   // % staff with active assignments
  openDemands: number;
  overdueCount: number; onScheduleCount: number; noDateCount: number;
  onTimeRate: number | null;
  totalForecastCost: number;     // Σ LaborContractAmount (forecast spend proxy)
  marginRiskCount: number;       // overdue AND carrying value
  avgProjectValue: number;

  /* optional CFO health (null-safe) */
  cfo: CFOFinancialHealth | null;

  /* chart buckets */
  funnel: { label: string; count: number; value: number }[];
  winLossBySector: SectorWinLoss[];
  /** Which upstream sources actually loaded. Absent = legacy caller, assume ok.
   *  Consumers must render metrics from a false source as unknown ("—"),
   *  never as zero — an outage is not a fact. */
  sources?: { records: boolean; staffing: boolean; demands: boolean; cfo: boolean };
  backlogByDivision: NamedValue[];
  backlogByBU: NamedValue[];
  /** Active contract value by canonical Department (additive — older cached
   *  models may omit it; consumers must tolerate undefined). */
  backlogByDepartment?: NamedValue[];
  backlogBySector: NamedValue[];
  clientConcentration: (NamedValue & { share: number })[];
  cityExposure: NamedValue[];
  valueRanges: { label: string; count: number }[];
  opmByStage: NamedValue[];
  utilizationBands: { label: string; count: number }[];
  scheduleHealth: { onSchedule: number; overdue: number; noDate: number };

  /* lifecycle conversion tracking */
  conversion: ConversionStats;

  /* full normalized tables */
  projects: ProjectRow[];        // active only, sorted by value desc
  closedProjects: ProjectRow[];
  opps: OppRow[];                // open pursuits, sorted by value desc
  decidedOpps: OppRow[];         // won + lost
  leads: LeadRow[];
  /* Report pages: EVERY record incl. closed/converted (additive — older
   * cached models may omit them; fall back to the filtered lists). */
  allOpps?: OppRow[];
  allLeads?: LeadRow[];
  staff: StaffRow[];
  demands: DemandRow[];

  /* Status-change ledger (RMOneStatusHistory) — real recorded status/stage
   * transitions written by every write path. null = not loaded (older cache
   * or endpoint failed): consumers keep the all-time fallback + honesty
   * notes. statusHistorySince = the tenant's earliest recorded change, so a
   * period fully inside coverage can drop the "all time" notes honestly. */
  statusHistory?: StatusChangeItem[] | null;
  statusHistorySince?: string | null;
  /* True when the server capped the returned rows (newest-first): the window
   * is only complete back to the OLDEST returned row, so coverage must be
   * assessed from that row, never from statusHistorySince. */
  statusHistoryTruncated?: boolean;
};

/* ── row builders ── */
function buildProjectRow(p: any, now: number): ProjectRow {
  // Effective end (phase-schedule last end when a schedule exists, Target
  // fallback otherwise) with legacy TargetEndDate as a last resort.
  const end = effEnd(p)?.toISOString() ?? isoOrNull(p?.TargetEndDate);
  const overdue = !!end && new Date(end).getTime() < now;
  return {
    id: String(p?.TicketId ?? ""),
    name: String(p?.Title ?? p?.ShortName ?? p?.TicketId ?? ""),
    client: getClient(p),
    sector: getSector(p),
    city: getCity(p),
    division: getDivision(p),
    businessUnit: getBusinessUnit(p),
    department: getDepartment(p),
    divisionId: getDivisionId(p),
    businessUnitId: getBusinessUnitId(p),
    departmentId: getDepartmentId(p),
    status: cleanLabel(p?.CRMProjectStatusChoice) || cleanLabel(p?.Status) || (isClosed(p) ? "Closed" : "Open"),
    value: pmmValue(p),
    laborContract: num(p?.LaborContractAmount),
    forecastCost: num(p?.ForecastedProjectCost),
    targetStart: effStart(p)?.toISOString() ?? null,
    targetEnd: end,
    overdue,
    daysOverdue: overdue && end ? Math.floor((now - new Date(end).getTime()) / 86400000) : null,
    noDate: !end,
    created: isoOrNull(p?.Created),
    owner: getOwner(p),
    closeoutDate: isoOrNull(p?.CloseoutDate),
    closedDate: isoOrNull(p?.ClosedDate) || isoOrNull(p?.ActualCompletionDate),
  };
}

function buildOppRow(o: any, now: number): OppRow {
  const stage = cleanLabel(o?.CRMOpportunityStatusChoice) || cleanLabel(o?.Status) || cleanLabel(o?.ModuleStepLookup) || "Stage not set";
  const rawProb = o?.ChanceOfSuccessChoice ?? o?.SuccessChance;
  const prob = rawProb != null && String(rawProb).trim() !== ""
    ? (parseFloat(String(rawProb).replace(/%/g, "")) || 0)
    : null;
  const value = opmValue(o);
  const bid = isoOrNull(o?.BidDueDate);
  const closed = isClosed(o) || isConvertedStage(stage) || ["awarded", "lost", "cancelled", "declined", "dead"].includes(stage.toLowerCase());
  return {
    id: String(o?.TicketId ?? ""),
    name: String(o?.Title ?? o?.ShortName ?? o?.TicketId ?? ""),
    client: getClient(o),
    sector: getSector(o),
    city: getCity(o),
    division: getDivision(o),
    businessUnit: getBusinessUnit(o),
    department: getDepartment(o),
    divisionId: getDivisionId(o),
    businessUnitId: getBusinessUnitId(o),
    departmentId: getDepartmentId(o),
    stage,
    value,
    probability: prob,
    weighted: prob != null ? value * (prob / 100) : value,
    bidDate: bid,
    daysToBid: bid ? Math.ceil((new Date(bid).getTime() - now) / 86400000) : null,
    closed,
    won: isWonStage(stage),
    created: isoOrNull(o?.Created),
    owner: getOwner(o),
    decidedDate: isoOrNull(o?.AwardedorLossDate),
  };
}

const LEM_CLOSED = new Set(["lost", "cancelled", "declined", "dead", "closed", "awarded", "converted"]);
function buildLeadRow(l: any): LeadRow {
  return {
    id: String(l?.TicketId ?? ""),
    name: String(l?.Title ?? l?.ShortName ?? l?.TicketId ?? ""),
    client: getClient(l),
    sector: getSector(l),
    city: getCity(l),
    status: cleanLabel(l?.LeadStatus) || cleanLabel(l?.Status) || "Open",
    value: lemValue(l),
    created: isoOrNull(l?.Created),
    owner: getOwner(l),
    division: getDivision(l),
    businessUnit: getBusinessUnit(l),
    department: getDepartment(l),
    divisionId: getDivisionId(l),
    businessUnitId: getBusinessUnitId(l),
    departmentId: getDepartmentId(l),
  };
}

function utilBand(pct: number): StaffRow["band"] {
  if (pct <= 0) return "Available";
  if (pct <= 50) return "Light";
  if (pct <= 85) return "Normal";
  if (pct <= 100) return "Full";
  return "Overloaded";
}

/* ── the aggregator ── */
export function buildReportModel(raw: {
  pmm: any[]; opm: any[]; lem: any[];
  resources: any[]; demands: any[];
  cfo: CFOFinancialHealth | null;
}): ReportModel | null {
  const { pmm, opm, lem, resources, demands, cfo } = raw;
  if (!pmm.length && !opm.length && !lem.length && !resources.length) return null;
  const now = Date.now();

  /* projects */
  const allProjects = pmm.filter(p => p && typeof p === "object").map(p => ({ row: buildProjectRow(p, now), closed: isClosed(p) }));
  const projects = allProjects.filter(x => !x.closed).map(x => x.row).sort((a, b) => b.value - a.value);
  const closedProjects = allProjects.filter(x => x.closed).map(x => x.row).sort((a, b) => b.value - a.value);

  const backlogValue = projects.reduce((s, p) => s + p.value, 0);
  const totalForecastCost = projects.reduce((s, p) => s + p.laborContract, 0);
  const overdueList = projects.filter(p => p.overdue);
  const noDateList = projects.filter(p => p.noDate);
  const onScheduleList = projects.filter(p => !p.noDate && !p.overdue);
  const marginRiskCount = overdueList.filter(p => p.value > 0).length;

  /* opportunities */
  const allOpps = opm.filter(o => o && typeof o === "object").map(o => buildOppRow(o, now));
  const opps = allOpps.filter(o => !o.closed).sort((a, b) => b.value - a.value);
  const decidedOpps = allOpps.filter(o => o.closed && (o.won || o.stage.toLowerCase().includes("lost")));
  const wonList = decidedOpps.filter(o => o.won);
  const lostList = decidedOpps.filter(o => !o.won);
  const pipelineValue = opps.reduce((s, o) => s + o.value, 0);
  const weightedPipeline = opps.reduce((s, o) => s + o.weighted, 0);
  const winRate = decidedOpps.length > 0 ? Math.round((wonList.length / decidedOpps.length) * 100) : null;

  /* leads */
  const allLeadRows = lem.filter(l => l && typeof l === "object").map(buildLeadRow);

  /* For converted leads, determine what each became: look for an OPM or PMM record with
     the same normalized title (conversion flows pre-fill the title from the lead). */
  {
    const normT = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const projTitles = new Set(allProjects.map(p => normT(p.row.name)));
    const oppTitles  = new Set(allOpps.map(o => normT(o.name)));
    for (const l of allLeadRows) {
      if (l.status.trim().toLowerCase() === "converted") {
        const t = normT(l.name);
        // Projects are the furthest conversion (lead → opp → project); prefer that label.
        if (projTitles.has(t))     l.convertedTo = "Project";
        else if (oppTitles.has(t)) l.convertedTo = "Opportunity";
      }
    }
  }

  const leads = lem
    .filter(l => l && typeof l === "object" && l.Closed !== true)
    .map(buildLeadRow)
    .filter(l => !LEM_CLOSED.has(l.status.toLowerCase()))
    .sort((a, b) => b.value - a.value);
  const leadValue = leads.reduce((s, l) => s + l.value, 0);

  /* lifecycle conversions — a lead stamped "Converted" became an opportunity;
     an opp stamped "Closed – Won" became a project (both are system-set
     sentinels written by the convert flows). */
  const convertedLeads = allLeadRows
    .filter(l => l.status.trim().toLowerCase() === "converted")
    .sort((a, b) => b.value - a.value);
  const convertedOpps = allOpps
    .filter(o => isConvertedStage(o.stage))
    .sort((a, b) => b.value - a.value);
  const conversion: ConversionStats = {
    leadsTotal: allLeadRows.length,
    leadsConverted: convertedLeads.length,
    leadsConvertedValue: convertedLeads.reduce((s, l) => s + l.value, 0),
    leadConversionRate: allLeadRows.length > 0 ? Math.round((convertedLeads.length / allLeadRows.length) * 100) : null,
    oppsTotal: allOpps.length,
    oppsConverted: convertedOpps.length,
    oppsConvertedValue: convertedOpps.reduce((s, o) => s + o.value, 0),
    oppConversionRate: allOpps.length > 0 ? Math.round((convertedOpps.length / allOpps.length) * 100) : null,
    convertedLeads,
    convertedOpps,
  };

  /* workforce */
  const _nowMs = Date.now();
  const staff: StaffRow[] = resources.filter(r => r && typeof r === "object").map((r: any) => {
    const pct = Number(r.currentPct ?? 0);
    /* allAllocations (incl. past + future) preferred for windowed math;
     * activeAllocations is the fallback older payloads carry. */
    const allocSrc: any[] = Array.isArray(r.allAllocations) && r.allAllocations.length > 0
      ? r.allAllocations
      : Array.isArray(r.activeAllocations) ? r.activeAllocations : [];
    /* Count distinct projects with at least one allocation that hasn't ended yet
     * (current or upcoming). This matches the staff card's non-full-history view
     * and avoids two bugs in r.activeProjects: (1) it is not deduplicated —
     * multiple allocation rows for one project inflate the count; (2) it is
     * today-only so future-starting allocations are missed entirely. */
    const currentProjectIds = new Set(
      allocSrc
        .filter((a: any) => !a?.endDate || new Date(String(a.endDate)).getTime() + 86_399_999 >= _nowMs)
        .map((a: any) => String(a?.projectId ?? ""))
        .filter(Boolean),
    );
    const activeProjectCount = currentProjectIds.size > 0
      ? currentProjectIds.size
      : Number(r.totalProjects ?? (Array.isArray(r.activeProjects)
          ? new Set((r.activeProjects as unknown[]).map(String).filter(Boolean)).size
          : 0));
    const allProjectIds = new Set(
      allocSrc
        .map((a: any) => String(a?.projectId ?? ""))
        .filter(Boolean),
    );
    const reportedTotalProjects = Number(r.totalProjects);
    const totalProjectCount = Math.max(
      allProjectIds.size,
      activeProjectCount,
      Number.isFinite(reportedTotalProjects) && reportedTotalProjects >= 0
        ? Math.round(reportedTotalProjects)
        : 0,
    );
    return {
      id: String(r.id ?? ""),
      name: String(r.name ?? r.username ?? ""),
      role: cleanLabel(r.roleName) || cleanLabel(r.role),
      // Canonical division ONLY — a Business Unit label must never stand in
      // for a missing Division (same-name units would merge across dimensions).
      division: cleanLabel(r.divisionName) || null,
      divisionId: getStableOrgId(r.divisionId, r.divisionID, r.divisionIdLookup),
      utilization: Number.isFinite(pct) ? Math.round(pct) : 0,
      activeProjects: activeProjectCount,
      totalProjects: totalProjectCount,
      band: utilBand(Number.isFinite(pct) ? pct : 0),
      businessUnit: cleanLabel(r.businessUnit) || null,
      businessUnitId: getStableOrgId(r.businessUnitId, r.businessUnitID, r.businessUnitIdLookup),
      department: cleanLabel(r.departmentName) || null,
      departmentId: getStableOrgId(r.departmentId, r.departmentID, r.departmentIdLookup),
      employmentType: cleanLabel(r.employeeType) || null,
      city: cleanLabel(r.city) || null,
      allocations: allocSrc.map((a: any) => ({
        projectId: String(a?.projectId ?? ""),
        ...(a?.projectName ? { projectName: String(a.projectName) } : {}),
        pct: num(a?.pct),
        ...(a?.hours != null && Number(a.hours) > 0 ? { hours: Number(a.hours) } : {}),
        ...(a?.startDate ? { startDate: String(a.startDate) } : {}),
        ...(a?.endDate ? { endDate: String(a.endDate) } : {}),
      })),
    };
  }).sort((a, b) => b.utilization - a.utilization);
  const benchCount = staff.filter(s => s.band === "Available").length;
  const overAllocCount = staff.filter(s => s.band === "Overloaded").length;
  const healthyCount = staff.length - benchCount - overAllocCount;
  const deployedRate = staff.length > 0 ? Math.round(((staff.length - benchCount) / staff.length) * 100) : null;

  /* demand: dedupe weekly rows into unique (project, role) positions —
     the same rule the Resources page uses for its "open positions" count.
     Raw rows are one-per-week, so counting them inflates the number. */
  const demandMap = new Map<string, DemandRow>();
  for (const d of demands) {
    if (!d || typeof d !== "object") continue;
    const ticket = String((d as any).TicketId ?? "");
    const role = cleanLabel((d as any).Role) || "Unspecified role";
    const key = `${ticket}||${role}`;
    const start = isoOrNull((d as any).AllocationStartDate);
    const end = isoOrNull((d as any).AllocationEndDate);
    const pct = num((d as any).PctAllocation);
    const soft = (d as any).SoftAllocation === true;
    const ex = demandMap.get(key);
    if (!ex) {
      demandMap.set(key, {
        ticket, project: String((d as any).Title ?? ticket), role,
        pct, start, end, soft,
      });
    } else {
      if (start && (!ex.start || start < ex.start)) ex.start = start;
      if (end && (!ex.end || end > ex.end)) ex.end = end;
      ex.pct = Math.max(ex.pct, pct);
      if (soft) ex.soft = true;
    }
  }
  const demandRows: DemandRow[] = [...demandMap.values()];

  /* buckets */
  const addTo = (m: Map<string, { value: number; count: number }>, key: string | null, v: number) => {
    if (!key) return;
    const cur = m.get(key) ?? { value: 0, count: 0 };
    cur.value += v; cur.count += 1;
    m.set(key, cur);
  };
  const topOf = (m: Map<string, { value: number; count: number }>, n: number): NamedValue[] =>
    [...m.entries()].map(([label, d]) => ({ label, ...d }))
      .sort((a, b) => b.value - a.value).slice(0, n);
  const addOrgTo = (
    m: Map<string, { label: string; value: number; count: number }>,
    label: string | null | undefined,
    id: string | null | undefined,
    value: number,
  ) => {
    if (!label) return;
    const key = id ? `id:${id}` : `name:${label}`;
    const current = m.get(key) ?? { label, value: 0, count: 0 };
    current.value += value;
    current.count++;
    m.set(key, current);
  };
  const topOfOrg = (
    m: Map<string, { label: string; value: number; count: number }>,
    n: number,
  ): NamedValue[] => {
    const labelKeys = new Map<string, string[]>();
    for (const [key, group] of m) {
      const keys = labelKeys.get(group.label) ?? [];
      keys.push(key);
      labelKeys.set(group.label, keys);
    }
    for (const keys of labelKeys.values()) keys.sort((a, b) => a.localeCompare(b));
    return [...m.entries()].map(([key, group]) => {
      const matches = labelKeys.get(group.label) ?? [];
      const index = matches.indexOf(key);
      return {
        key,
        label: matches.length > 1 ? `${group.label} (${index + 1})` : group.label,
        value: group.value,
        count: group.count,
      };
    }).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)).slice(0, n);
  };

  const divMap = new Map<string, { label: string; value: number; count: number }>();
  const buMap  = new Map<string, { label: string; value: number; count: number }>();
  const deptMap = new Map<string, { label: string; value: number; count: number }>();
  const secMap = new Map<string, { value: number; count: number }>();
  const cliMap = new Map<string, { value: number; count: number }>();
  const cityMap = new Map<string, { value: number; count: number }>();
  for (const p of projects) {
    addOrgTo(divMap, p.division, p.divisionId, p.value);
    addOrgTo(buMap, p.businessUnit, p.businessUnitId, p.value);
    addOrgTo(deptMap, p.department, p.departmentId, p.value);
    addTo(secMap, p.sector, p.value);
    addTo(cliMap, p.client, p.value);
    addTo(cityMap, p.city, p.value);
  }

  const valueRanges = [
    { label: "<$1M", min: 0, max: 1e6, count: 0 },
    { label: "$1–5M", min: 1e6, max: 5e6, count: 0 },
    { label: "$5–15M", min: 5e6, max: 15e6, count: 0 },
    { label: "$15–50M", min: 15e6, max: 50e6, count: 0 },
    { label: "$50M+", min: 50e6, max: Infinity, count: 0 },
  ];
  for (const p of projects) {
    for (const r of valueRanges) { if (p.value >= r.min && p.value < r.max) { r.count++; break; } }
  }

  const wlMap = new Map<string, SectorWinLoss>();
  for (const o of decidedOpps) {
    const cur = wlMap.get(o.sector) ?? { sector: o.sector, won: 0, lost: 0, wonValue: 0, lostValue: 0 };
    if (o.won) { cur.won++; cur.wonValue += o.value; } else { cur.lost++; cur.lostValue += o.value; }
    wlMap.set(o.sector, cur);
  }
  const winLossBySector = [...wlMap.values()]
    .sort((a, b) => (b.won + b.lost) - (a.won + a.lost)).slice(0, 8);

  const stageMap = new Map<string, { value: number; count: number }>();
  for (const o of opps) addTo(stageMap, o.stage, o.value);
  const opmByStage = topOf(stageMap, 8);

  const clientTop = topOf(cliMap, 10);
  const clientConcentration = clientTop.map(c => ({
    ...c,
    share: backlogValue > 0 ? Math.round((c.value / backlogValue) * 100) : 0,
  }));

  const utilizationBands = (["Available", "Light", "Normal", "Full", "Overloaded"] as const)
    .map(label => ({ label, count: staff.filter(s => s.band === label).length }));

  return {
    generatedAt: new Date().toISOString(),
    backlogValue,
    activeProjects: projects.length,
    pipelineValue,
    weightedPipeline,
    activeBids: opps.length,
    leadCount: leads.length,
    leadValue,
    wonCount: wonList.length,
    lostCount: lostList.length,
    wonValue: wonList.reduce((s, o) => s + o.value, 0),
    lostValue: lostList.reduce((s, o) => s + o.value, 0),
    winRate,
    totalStaff: staff.length,
    benchCount,
    overAllocCount,
    healthyCount,
    deployedRate,
    openDemands: demandRows.length,
    overdueCount: overdueList.length,
    onScheduleCount: onScheduleList.length,
    noDateCount: noDateList.length,
    onTimeRate: projects.length > 0 ? Math.round((onScheduleList.length / projects.length) * 100) : null,
    totalForecastCost,
    marginRiskCount,
    avgProjectValue: projects.length > 0 ? backlogValue / projects.length : 0,
    cfo,
    funnel: [
      { label: "Leads", count: leads.length, value: leadValue },
      { label: "Active Bids", count: opps.length, value: pipelineValue },
      { label: "Awarded (YTD)", count: wonList.length, value: wonList.reduce((s, o) => s + o.value, 0) },
    ],
    winLossBySector,
    backlogByDivision: topOfOrg(divMap, 8),
    backlogByBU: topOfOrg(buMap, 8),
    backlogByDepartment: topOfOrg(deptMap, 8),
    backlogBySector: topOf(secMap, 8),
    clientConcentration,
    cityExposure: topOf(cityMap, 8),
    valueRanges: valueRanges.map(({ label, count }) => ({ label, count })),
    opmByStage,
    utilizationBands,
    scheduleHealth: { onSchedule: onScheduleList.length, overdue: overdueList.length, noDate: noDateList.length },
    conversion,
    projects,
    closedProjects,
    opps,
    decidedOpps,
    leads,
    allOpps,
    allLeads: allLeadRows,
    staff,
    demands: demandRows,
  };
}

/* ── loading ── */

/** Synchronous best-effort build from the shared session cache (instant paint). */
export function peekReportModel(): ReportModel | null {
  const pmm = peekCached<{ data: any[] }>("module:PMM")?.data;
  const opm = peekCached<{ data: any[] }>("module:OPM")?.data;
  const lem = peekCached<{ data: any[] }>("module:LEM")?.data;
  const allocs = peekCached<{ resources: any[] }>("resource-allocations:all")?.resources;
  const demands = peekCached<{ data: any[] }>("resource-demands")?.data;
  const hist = peekCached<StatusHistoryResponse>("status-history");
  if (!pmm && !opm && !lem) return null;
  const model = buildReportModel({
    pmm: pmm ?? [], opm: opm ?? [], lem: lem ?? [],
    resources: allocs ?? [], demands: demands ?? [], cfo: null,
  });
  if (!model) return null;
  model.sources = {
    records: !!pmm && !!opm && !!lem,
    staffing: allocs != null,
    demands: demands != null,
    cfo: false,
  };
  model.statusHistory = hist?.rows ?? null;
  model.statusHistorySince = hist?.since ?? null;
  model.statusHistoryTruncated = hist?.truncated ?? false;
  return model;
}

/** Full async load (each source fails soft so one outage never blanks the page). */
export async function loadReportModel(): Promise<ReportModel | null> {
  const [pmmR, opmR, lemR, allocR, demR, cfoR, histR] = await Promise.allSettled([
    getModuleRecords("PMM"),
    getModuleRecords("OPM"),
    getModuleRecords("LEM"),
    getResourceAllocations(),
    getResourceDemands(),
    getCFOFinancialHealth(),
    getStatusHistory(),
  ]);
  const val = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);
  const model = buildReportModel({
    pmm: (val(pmmR) as any)?.data ?? [],
    opm: (val(opmR) as any)?.data ?? [],
    lem: (val(lemR) as any)?.data ?? [],
    resources: (val(allocR) as any)?.resources ?? [],
    demands: (val(demR) as any)?.data ?? [],
    cfo: (val(cfoR) as CFOFinancialHealth | null) ?? null,
  });
  if (!model) return null;
  model.sources = {
    records: pmmR.status === "fulfilled" && opmR.status === "fulfilled" && lemR.status === "fulfilled",
    staffing: allocR.status === "fulfilled",
    demands: demR.status === "fulfilled",
    cfo: cfoR.status === "fulfilled",
  };
  const hist = val(histR) as StatusHistoryResponse | null;
  model.statusHistory = hist?.rows ?? null;
  model.statusHistorySince = hist?.since ?? null;
  model.statusHistoryTruncated = hist?.truncated ?? false;
  return model;
}

/* ── shared formatting (UI + exports) ── */
export function fmtMoney(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (n >= 1e9) return compactUsd(n);
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}
export function fmtMoneyFull(n: number): string {
  return n > 0 ? `$${Math.round(n).toLocaleString("en-US")}` : "—";
}
export function fmtDateShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
