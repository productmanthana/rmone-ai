/**
 * RM ONE web API helper. Mirrors the mobile app's lib/api.ts surface, but uses
 * fetch + localStorage instead of AsyncStorage. All requests hit the shared
 * Express proxy at /api/rmone/* (artifacts/api-server) which already handles
 * the OAuth2 password grant and forwards Bearer tokens upstream.
 */

import { queryClient } from "./queryClient";
import { memSeed } from "./memSeed";
import { bustProjectDetailCache } from "./projectDetailCache";
import { notifyDataChanged, registerSyncBustHandler } from "./dataSync";

const API = "/api/rmone";
const TOKEN_KEY = "rmone_token";
const USERNAME_KEY = "rmone_username";
const TENANT_KEY = "rmone_tenant";
const USER_ROLES_KEY = "rmone_userRoles";
const USER_ID_KEY = "rmone_userId";
const CANEDIT_KEY = "rmone_canEdit";
const ISADMIN_KEY = "rmone_isAdmin";

// The signed-in user's job title ("Chief Financial Officer", …) is persisted
// under a key scoped BY CONSTRUCTION to tenant + username, so two different
// people (or the same email across two companies) sharing one browser can
// NEVER read each other's stored title. The legacy global USER_ROLES_KEY is
// kept only for cleanup — it is never read.
function userRolesScopedKey(tenant: string, username: string): string {
  return `rmone_userRoles:${tenant.trim().toLowerCase()}:${username.trim().toLowerCase()}`;
}

function setStoredUserRoles(tenant: string, username: string, roles: string | null): void {
  try {
    const key = userRolesScopedKey(tenant, username);
    if (roles && roles.trim()) localStorage.setItem(key, roles.trim());
    else localStorage.removeItem(key);
  } catch { /* storage unavailable */ }
}

function getStoredUserRoles(tenant: string, username: string): string | undefined {
  try {
    const v = localStorage.getItem(userRolesScopedKey(tenant, username));
    return v && v.trim() ? v : undefined;
  } catch { return undefined; }
}

// core2 RDS queries can take 30-60s on a COLD connection pool — the pool is
// warmed lazily per tenant on first request after login (see
// startup-warmer), so the very first "Hours by Phase" / project-allocations
// fetch right after signing in is the slowest one a user will ever see. 45s
// was cutting that close enough that a legitimately-slow-but-succeeding cold
// start could get aborted client-side and show "Couldn't load phase hours"
// even though the server would have answered a few seconds later.
const TIMEOUT_MS = 90_000;

interface CacheEntry<T> { data: T; fetchedAt: number; promise?: Promise<T> }
const _cache = new Map<string, CacheEntry<unknown>>();
// Explicit fresh reads normally evict the regular cache before fetching. Keep
// a separate short-lived registry so two components mounted together after one
// save (Project Detail + Team Schedule Grid) share that one authoritative read
// instead of issuing duplicate cache-bypassing requests.
const freshProjectTeamInFlight = new Map<string, Promise<ProjectTeamResponse>>();
const TTL = 5 * 60 * 1000;
// Max age for persisted cache entries that survive across browser
// sessions. Anything older than this is treated as missing on
// hydration so we don't paint the dashboard with day-old numbers.
const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000; // 24h

// localStorage persistence of APP DATA is fully disabled — customer
// requirement: zero app/customer data in browser storage. All data caches now
// live in memory only (see lib/memSeed.ts), so the browser quota can never
// fill up and block the critical login-token write again. The startup purge
// below removes every data entry any PREVIOUS build ever persisted, so
// existing customers get their browser storage freed automatically on the
// first visit after this deploy.
const PURGEABLE_CACHE_PREFIXES = [
  "rmone:cache:",        // legacy persisted cached() entries
  "rmone:pd:",           // project-detail snapshot cache (any version)
  "rmone:fc-src:",       // Forecast source cache (any version)
  "rmone:home-overlay:", // home overlay SWR seed (any version)
  "rmone:v1:",           // per-project team/roster seeds (unbounded!)
  "rmone:cardInsight:",  // AI card-insight cache
];
// Prefix legacy persisted cached() entries were stored under. Persistence is
// disabled (memory-only), but bustCache still sweeps these legacy keys so any
// pre-migration entries left in a customer's browser get purged.
const SS_PREFIX = "rmone:cache:";
function persistStore(): Storage | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; }
  catch { return null; }
}
(function purgeStaleLocalStorage() {
  try {
    const store = persistStore();
    if (!store) return;
    const toRemove: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && PURGEABLE_CACHE_PREFIXES.some(p => k.startsWith(p))) toRemove.push(k);
    }
    toRemove.forEach(k => { try { store.removeItem(k); } catch { /* ignore */ } });
    if (toRemove.length > 0) console.log(`[storage] purged ${toRemove.length} legacy persisted cache entries — app data now lives in memory only`);
  } catch { /* ignore */ }
})();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function hydrateFromSession() { /* no-op — persistence disabled */ }
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function persistToSession(_key: string, _data: unknown, _fetchedAt: number) { /* no-op */ }

/** Synchronous peek: returns cached data (even if stale) without
 *  triggering a fetch. Used by pages to skip the loading spinner when
 *  any prior data exists. */
export function peekCached<T>(key: string): T | null {
  hydrateFromSession();
  const hit = _cache.get(key) as CacheEntry<T> | undefined;
  return hit?.data ?? null;
}

function fetchWithTimeout(url: string, init: RequestInit = {}, ms = TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token
    ? { Authorization: `Bearer ${token}`, "X-RMOne-Client": "web" }
    : { "X-RMOne-Client": "web" };
}

/** Read the last fully-live Daily Briefing saved by the API. The server
 * derives the tenant/user scope from the verified token; role/window are only
 * selectors within that scope. */
export async function getSavedDailyBriefing(
  role: string,
  window: string,
): Promise<{ data: unknown; savedAt: string | null } | null> {
  try {
    const qs = `?role=${encodeURIComponent(role)}&window=${encodeURIComponent(window)}`;
    const res = await fetchWithTimeout(`${API}/daily-briefing-cache${qs}`, {
      headers: authHeaders(),
    }, 15_000);
    if (!res.ok) return null;
    const body = await res.json();
    if (!body?.available || !body.data) return null;
    return { data: body.data, savedAt: typeof body.savedAt === "string" ? body.savedAt : null };
  } catch {
    return null;
  }
}

/** Persist a fully-live Daily Briefing without delaying the visible result. */
export async function saveDailyBriefing(
  role: string,
  window: string,
  data: unknown,
): Promise<boolean> {
  try {
    const qs = `?role=${encodeURIComponent(role)}&window=${encodeURIComponent(window)}`;
    const res = await fetchWithTimeout(`${API}/daily-briefing-cache${qs}`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    }, 15_000);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Headers required by /api/alerts/* — adds tenant + user GUID so the
 * server can scope forecast snapshots, AI escalations, and exec-
 * approval matching to the right (tenant, user). Missing values just
 * yield empty headers; the server handles that gracefully.
 */
/** The signed-in user's own GUID (written at login by /profile), lowercased.
 *  Empty string when unknown — callers must treat that as "no user match". */
export function getMyUserGuid(): string {
  try { return (localStorage.getItem(USER_ID_KEY) ?? "").trim().toLowerCase(); } catch { return ""; }
}

function alertsHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  const tenant = localStorage.getItem(TENANT_KEY);
  const userGuid = localStorage.getItem(USER_ID_KEY);
  const out: Record<string, string> = {};
  if (token) out["Authorization"] = `Bearer ${token}`;
  if (tenant) out["x-rmone-tenant"] = tenant;
  if (userGuid) out["x-rmone-user-guid"] = userGuid;
  return out;
}

/** Backend-derived alert rows (forecast diffs, exec approvals, AI
 *  escalations). Returns empty list on any failure. */
export interface BackendAlertRow {
  alertKey: string;
  tone: "high" | "med" | "info";
  title: string;
  sub?: string;
  source: "forecast-shift" | "exec-approval" | "ai-escalation" | "unresolved";
  // Optional per-record detail table attached by the backend (ai-escalation
  // rows). Structurally compatible with ActionDetail — the drill-down panel
  // renders one row per affected record with its real name.
  records?: {
    title: string;
    subtitle?: string;
    columns: Array<{ key: string; label: string; align?: "left" | "right" }>;
    rows: Array<Record<string, string>>;
  };
}
export async function getAlertsFeed(): Promise<{ rows: BackendAlertRow[]; generatedAt: number }> {
  // Cached: the home overlay refetches this on every role/window re-run
  // during login — without the cache each re-run paid a full 1-4s network
  // round-trip, stretching the post-login splash. The shared TTL cache
  // dedupes concurrent calls and is busted on login/logout like all other
  // cached data, so tenant isolation is preserved. Failures are NOT cached
  // (thrown → cache entry dropped → next call retries).
  try {
    return await cached("alerts-feed:all", async () => {
      const res = await fetchWithTimeout("/api/alerts/feed", { headers: alertsHeaders() });
      if (!res.ok) throw new Error(`alerts feed ${res.status}`);
      return (await res.json()) as { rows: BackendAlertRow[]; generatedAt: number };
    });
  } catch {
    return { rows: [], generatedAt: 0 };
  }
}

// ── CFO Financial Health ─────────────────────────────────────────

export interface CFOFinancialHealth {
  pipelineCoverage:  number;
  laborMargin:       number;
  hoursOnPlan:       number;
  laborCompletion:   number;
  costCoverage:      number;
  allocOnPlan:       number;
  detail?: {
    pipelineValue:      number;
    backlogValue:       number;
    coverageTarget:     number;
    laborRowCount:      number;
    totalPmmProjects:   number;
    totalOpmPursuits:   number;
    atRiskCount:        number;
    totalResources:     number;
    benchCount:         number;
    overAllocatedCount: number;
    healthyCount:       number;
  };
}

/* ── Analytics Center → Financial page: server-computed planned-labor
 *    metrics (allocation plans × rates). See api-server
 *    lib/financial-analytics.ts for the math + honesty rules. ── */
export type FinBasisKey = "all" | "t12m" | "fytd" | "runrate";
export interface FinMonthly { ym: string; plannedHours: number; billDollars: number; costDollars: number }
export interface FinDivisionRow { division: string; plannedHours: number; assignedHours: number; billDollars: number }
export interface FinBURow { bu: string; plannedHours: number; assignedHours: number; billDollars: number }
export interface FinDeptRow { department: string; plannedHours: number; assignedHours: number; billDollars: number }
export interface FinProjectRow { ticket: string; plannedHours: number; assignedHours: number; billDollars: number; jobCost: number; nonJobCost: number }
/** Exact allocation-level project contribution to one org-unit figure. */
export interface FinOrgProjectRow extends FinProjectRow {
  aggregateOf?: number;
}
/** Bounded project evidence behind one division, BU, or department row. */
export interface FinOrgProjectGroup {
  org: string;
  rows: FinOrgProjectRow[];
  rowsTruncated: number;
}
/** Project-level evidence for one month point on the financial charts. */
export interface FinMonthlyProjectRow extends FinProjectRow {
  ym: string;
  totalInternalCost: number;
  /** Explicit remainder line when one month has more projects than its drill cap. */
  aggregateOf?: number;
}
export interface FinReconRow {
  ticket: string;
  person: string;
  allocationId: string;
  allocationStart: string;
  allocationEnd: string;
  nonChargeable: boolean;
  billRate: number;
  costRate: number;
  plannedHours: number;
  chargeableHours: number;
  planClientBilling: number;
  jobCost: number;
  ncCost: number;
  totalInternalCost: number;
  windowStart: string;
  windowEnd: string;
  /** Present on the ONE trailing row that aggregates every allocation group
   *  beyond the server's row cap, so listed rows still sum to basis totals. */
  aggregateOf?: number;
}
export interface FinReconMeta {
  basisKey: FinBasisKey;
  rows: FinReconRow[];
  rowsTruncated: number;
  sumPlannedHours: number;
  sumChargeableHours: number;
  sumPlanClientBilling: number;
  sumJobCost: number;
  sumNcCost: number;
  sumTotalInternalCost: number;
}
export interface FinBasis {
  key: FinBasisKey;
  windowStart: string;
  windowEnd: string;
  factor: number;
  plannedHours: number;
  assignedHours: number;
  demandHours: number;
  assignedBillDollars: number;
  plannedBillDollars: number;
  jobChargeableCost: number;
  nonJobChargeableCost: number;
  unratedBillHours: number;
  unratedCostHours: number;
  annualized: {
    plannedHours: number;
    assignedHours: number;
    assignedBillDollars: number;
    jobChargeableCost: number;
    nonJobChargeableCost: number;
  };
  monthly: FinMonthly[];
  /** Present for the default Overall basis, which powers the month charts. */
  monthlyByProject?: FinMonthlyProjectRow[];
  byDivision: FinDivisionRow[];
  /** Allocation-level BU / Department groupings (same math as byDivision).
   *  Optional: older cached payloads predate them — consumers must treat
   *  absence as "not available", never fabricate rows from another dimension. */
  byBusinessUnit?: FinBURow[];
  byDepartment?: FinDeptRow[];
  /** Exact allocation-level project evidence behind each org group. Optional
   * for cached payload compatibility; no exact evidence means no org drill. */
  byDivisionByProject?: FinOrgProjectGroup[];
  byBusinessUnitByProject?: FinOrgProjectGroup[];
  byDepartmentByProject?: FinOrgProjectGroup[];
  byProject: FinProjectRow[];
  projectRowsTruncated: number;
  recon: FinReconMeta;
}
export type FinancialAnalytics =
  | {
      available: true;
      stale: boolean;
      generatedAt: string;
      workWeekHours: number;
      rowCount: number;
      skippedRows: number;
      bases: Record<FinBasisKey, FinBasis>;
    }
  | { available: false; reason: string; restricted?: boolean };

/* ── Usage analytics (#482) — admin-gated telemetry aggregates ── */

export type UsageTenantOutcomes = {
  /** Avg allocation_update tx per active user per week. null if no active users. */
  allocEditsPerUserWeek: number | null;
  allocEditsTotal: number;
  /** Avg distinct modules visited by consistent users (every/most weeks). null if none. */
  avgModulesConsistent: number | null;
  /** Avg distinct modules visited by occasional users. null if none. */
  avgModulesOccasional: number | null;
  consistentUsers: number;
  occasionalUsers: number;
  /** Individual users in the consistent (regular login) group — for drill-down. */
  consistentMembers?: { username: string; role: string; modules: number; moduleNames: string[]; weeksLoggedIn: number; logins: number; visits: number }[];
  /** Individual users in the occasional (infrequent login) group — for drill-down. */
  occasionalMembers?: { username: string; role: string; modules: number; moduleNames: string[]; weeksLoggedIn: number; logins: number; visits: number }[];
  /** ISO week-start strings (YYYY-MM-DD) that had ≥1 data import.
   *  The client unions these across tenants rather than summing counts,
   *  to avoid undercounting when different tenants import on different weeks. */
  importWeeks: string[];
  totalWeeks: number;
  /** Weekly allocation edit rate (edits/WAU) for sparklines.
   *  null rate = no WAU that week — a genuine gap, not a zero. */
  weeklyAllocEdits?: { week: string; rate: number | null }[];
  /** Weekly distinct module count across all users, for sparklines.
   *  null = no page visits that week (genuine gap). */
  weeklyDistinctModules?: { week: string; distinctModules: number | null }[];
};

export type UsageTenant = {
  tenant: string;
  enabledUsers: number;
  managers: number;
  /** Enabled-user count keyed by normalised role label (e.g. "Admin", "Manager", "User"). */
  roleCounts?: Record<string, number>;
  activeUsers: number;
  logins: number;
  pageVisits: number;
  humanTx: number;
  humanEvents: number;
  systemEvents: number;
  weekly: { week: string; activity: number; wau: number }[];
  features: { name: string; visits: number }[];
  txByType: { type: string; human: number; system: number }[];
  loginBands: { every: number; most: number; occasional: number };
  outcomes: UsageTenantOutcomes;
  activeUserRows: { _person: string; user: string; role: string; logins: number; visits: number; tx: number; weeksActive: number }[];
  activeUserTotal: number;
  neverActiveRows: { _person: string; user: string; username: string; role: string }[];
  neverActiveTotal: number;
  /** Full uncapped list of lowercased-trimmed display names of enabled users
   *  who WERE active in the selected window — used by the org-adoption chart
   *  instead of the capped neverActiveRows so percentages are accurate. */
  activeUserNames?: string[];
  /** Per-(user, page, day) page visit detail rows, sorted newest first.
   *  `at` is present and contains a full ISO datetime for today's un-rolled
   *  raw events; absent for historical rolled rows (date-only). */
  pageVisitRows?: { feature: string; context: string; user: string; role: string; day: string; at?: string; cnt: number }[];
  /** Total (user, page, day) rows before the ROW_CAP slice. */
  pageVisitTotal?: number;
  /** Per-(user, day) login detail rows, sorted newest first.
   *  `at` carries a full ISO datetime for today's un-rolled raw events. */
  loginDetailRows?: { user: string; role: string; day: string; at?: string; cnt: number }[];
  /** Total (user, day) login rows before the ROW_CAP slice. */
  loginDetailTotal?: number;
  /** Per-(user, tx-type, day, record) transaction detail rows, sorted newest first.
   *  `at` carries a full ISO datetime for today's un-rolled raw events. */
  txDetailRows?: { feature: string; context: string; user: string; role: string; day: string; at?: string; cnt: number }[];
  /** Total (user, tx-type, day) tx rows before the ROW_CAP slice. */
  txDetailTotal?: number;
};

export type UsageAnalytics =
  | {
      available: true;
      scope: "tenant" | "all";
      weeks: number;
      windowStart: string;
      windowEnd: string;
      weekStarts: string[];
      collectingSince: string | null;
      generatedAt: string;
      tenants: UsageTenant[];
    }
  | { available: false; reason: string; restricted?: boolean };

/** null = request failed (network/server) — distinct from a clean
 *  { available: false } answer. The page shows "couldn't load", never zeros.
 *  start/end = YYYY-MM-DD inclusive date range. Omit both for all-time data.
 *  bust = force a cluster-wide server recompute (the page's Refresh button)
 *  instead of accepting the server's stale-while-revalidate cache.
 *  details = include capped event rows for an open drill drawer; initial
 *  dashboard requests deliberately omit those rows to keep cold loads fast. */
export async function getUsageAnalytics(opts?: { start?: string; end?: string; bust?: boolean; details?: boolean }): Promise<UsageAnalytics | null> {
  try {
    const params = new URLSearchParams();
    if (opts?.start) params.set("start", opts.start);
    if (opts?.end)   params.set("end",   opts.end);
    if (opts?.bust)  params.set("bust",  "1");
    if (opts?.details) params.set("details", "1");
    const qs = params.toString() ? `?${params.toString()}` : "";
    const res = await fetchWithTimeout(`${API}/usage-analytics${qs}`, { headers: authHeaders() }, 60_000);
    if (res.status === 403) {
      return { available: false, restricted: true, reason: "Usage analytics is limited to admins." };
    }
    if (!res.ok) return null;
    return (await res.json()) as UsageAnalytics;
  } catch {
    return null;
  }
}

/** A single allocation-save event from the edit log endpoint. */
export interface AllocEditRow {
  at: string;               // ISO 8601 timestamp of the save
  username: string;
  role: string | null;
  tenant: string;
  projectId: string;        // numeric ID stored in context
  projectTicketId: string | null;  // e.g. "OPM-25-000023"
  projectTitle: string | null;
  cellsSaved: number;       // number of week-cells written in that save batch
  /** Total hours across all affected weeks before the save (null = legacy event, not recorded). */
  hoursBefore: number | null;
  /** Total hours across all affected weeks after the save (null = legacy event, not recorded). */
  hoursAfter: number | null;
}

/** Per-edit allocation event log. Omit opts for all-time data.
 *  Returns null on network/server failure. */
export async function getUsageAllocEdits(opts?: { start?: string; end?: string }): Promise<{ rows: AllocEditRow[]; total: number } | null> {
  try {
    const params = new URLSearchParams();
    if (opts?.start) params.set("start", opts.start);
    if (opts?.end)   params.set("end",   opts.end);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const res = await fetchWithTimeout(`${API}/usage-analytics/alloc-edits${qs}`, { headers: authHeaders() }, 30_000);
    if (!res.ok) return null;
    return (await res.json()) as { rows: AllocEditRow[]; total: number };
  } catch {
    return null;
  }
}

/** Fire-and-forget SPA page-visit beacon. Never throws, never awaited —
 *  navigation must not depend on telemetry in any way. */
export function sendUsageBeacon(feature: string, context?: string): void {
  try {
    void fetch(`${API}/usage-beacon`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ feature, context: context ?? "" }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Value-free UI events accepted by the audit interaction endpoint.  Labels,
 * selected values, search terms, and record titles must never be sent here. */
export type AuditInteractionType = "view" | "open" | "close" | "navigate" | "filter" | "search" | "export";
export type AuditInteractionEntityType =
  | "project" | "opportunity" | "lead" | "company" | "contact" | "staff"
  | "resource" | "allocation" | "configuration" | "dashboard" | "report"
  | "audit-trail" | "list" | "record";

/**
 * Fire-and-forget, value-free interaction audit event. The API stamps the
 * authenticated actor and rejects any fields outside this small vocabulary.
 * Interaction recording is intentionally never allowed to affect the UI.
 */
export function recordAuditInteraction(
  interactionType: AuditInteractionType,
  entityType?: AuditInteractionEntityType,
): void {
  try {
    void fetch(`${API}/audit-interaction`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ interactionType, entityType: entityType ?? null }),
    }).catch(() => {});
  } catch {
    /* Audit telemetry is non-critical. */
  }
}

/** null = request failed (network/server) — distinct from a clean
 *  { available: false } "this data source doesn't support it" answer. */
export async function getFinancialAnalytics(): Promise<FinancialAnalytics | null> {
  try {
    // Cold tenant-wide compute can take a while on big tenants — generous timeout.
    const res = await fetchWithTimeout("/api/analytics/financial", { headers: authHeaders() }, 60_000);
    if (res.status === 403) {
      return { available: false, restricted: true, reason: "Your access level doesn't include financial data." };
    }
    if (!res.ok) return null;
    return (await res.json()) as FinancialAnalytics;
  } catch {
    return null;
  }
}

/* ── Recruitment Analytics (Analytics Center → Recruitment) ──────────────
 * Per-role capacity variance = available hours − required hours over the
 * selected period. Server math lives in api-server lib/recruitment-analytics. */
export type RecruitWeekPoint = { weekStart: string; available: number; required: number; variance: number };
export type RecruitRoleRow = {
  role: string;
  people: number;
  openPositions: number;
  available: number;
  required: number;
  staffedHours: number;
  demandHours: number;
  variance: number;
  weekly: RecruitWeekPoint[];
};
export type RecruitmentAnalytics =
  | {
      available: true;
      generatedAt: string;
      periodStart: string;
      periodEnd: string;
      weekStarts: string[];
      workWeekHours: number;
      workingDays: number;
      holidaysInPeriod: string[];
      roles: RecruitRoleRow[];
      weeklyTotals: RecruitWeekPoint[];
      totals: {
        available: number; required: number; variance: number;
        shortageHours: number; surplusHours: number;
        rolesShort: number; rolesSurplus: number; rolesMatched: number;
        people: number; openPositions: number;
      };
    }
  | { available: false; reason?: string };

/** null = request failed (network/server) — distinct from a clean
 *  { available: false } "this data source doesn't support it" answer. */
export async function getRecruitmentAnalytics(start: string, end: string): Promise<RecruitmentAnalytics | null> {
  try {
    const qs = `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    const res = await fetchWithTimeout(`/api/analytics/recruitment?${qs}`, { headers: authHeaders() }, 60_000);
    if (!res.ok) return null;
    return (await res.json()) as RecruitmentAnalytics;
  } catch {
    return null;
  }
}

/** Six live financial KPI scores for the CFO home dashboard. */
export async function getCFOFinancialHealth(): Promise<CFOFinancialHealth | null> {
  try {
    const res = await fetchWithTimeout("/api/cfo/financial-health", { headers: alertsHeaders() });
    if (!res.ok) return null;
    return (await res.json()) as CFOFinancialHealth;
  } catch {
    return null;
  }
}

async function handleResponse(res: Response) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error("Request failed.") as Error & {
      status?: number; apiUnavailable?: boolean; friendlyMessage?: string;
    };
    err.status = res.status;
    // Extract a human-readable message from JSON error bodies so catch sites
    // can show a readable message instead of the raw `400: {"error":"…"}` blob.
    let parsedJson = false;
    try {
      const parsed = JSON.parse(text) as { apiUnavailable?: boolean; message?: string; error?: string; error_description?: string };
      parsedJson = true;
      if (res.status === 503 && parsed?.apiUnavailable) {
        err.apiUnavailable = true;
        err.friendlyMessage = parsed.message ||
          "Our APIs are currently under development. Please try again shortly.";
      } else if (typeof parsed?.error_description === "string" && parsed.error_description.trim()) {
        // OAuth-style bodies ({error:"read_only", error_description:"…"}) —
        // the human text lives in error_description, not the machine code.
        err.friendlyMessage = parsed.error_description;
      } else if (typeof parsed?.error === "string" && parsed.error.trim()) {
        err.friendlyMessage = parsed.error;
      } else if (typeof parsed?.message === "string" && parsed.message.trim()) {
        err.friendlyMessage = parsed.message;
      }
    } catch {/* non-JSON body — keep the raw message */}
    if (err.friendlyMessage) {
      // The human-facing message must never include the machine-readable JSON
      // envelope. Callers consistently render Error.message in banners/toasts.
      err.message = err.friendlyMessage;
    } else if (parsedJson) {
      // Do not leak an unrecognised JSON response into the UI.
      err.message = `Request failed (${res.status}).`;
    } else if (text.trim()) {
      err.message = `${res.status}: ${text.trim()}`;
    } else {
      err.message = `Request failed (${res.status}).`;
    }
    throw err;
  }
  return res.json();
}

// Short-lived in-memory cache. RDS-backed reads (project detail, team,
// allocations, task/phase data) can take a long time on a cold connection
// pool (30-60s first hit, memory: rds-connection-layer), so re-fetching the
// SAME key on every card mount / re-render was the main cause of "Hours by
// Phase" and "Project Team" feeling slow every time they're opened. A short
// TTL keeps repeat reads (e.g. expanding several team-member cards, which
// all call getFullProjectAllocations/getTaskData for the same project)
// instant, while `bustCache()` — already called on login/logout AND after
// every write (updateProject, updateProjectSchedule, updateHoursAllocation,
// etc.) — guarantees a tenant switch or a save always forces a fresh fetch.
// In-flight requests are de-duped via `promise` so concurrently-mounting
// cards (e.g. several team members expanding at once) share ONE network
// call instead of firing one each.
async function cached<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const hit = _cache.get(key) as CacheEntry<T> | undefined;
  const now = Date.now();
  if (hit) {
    if (hit.promise) return hit.promise;
    if (now - hit.fetchedAt < TTL) return hit.data;
  }
  const promise = factory();
  const entry: CacheEntry<T> = { data: hit?.data as T, fetchedAt: now, promise };
  _cache.set(key, entry);
  try {
    const data = await promise;
    // Write-after-bust guard: only cache the result if OUR in-flight entry is
    // still the live one. If bustCache() ran while this fetch was in flight
    // (e.g. a save completed mid-fetch), the entry was deleted/replaced and
    // this result is pre-write data — return it to the caller that started
    // the fetch, but never let it repopulate the cache as "fresh".
    if (_cache.get(key) === entry) {
      _cache.set(key, { data, fetchedAt: Date.now() });
    }
    return data;
  } catch (e) {
    if (_cache.get(key) === entry) _cache.delete(key);
    throw e;
  }
}

export function bustCache(prefix?: string) {
  // Forced project-team reads are deliberately shared only until the next
  // cache invalidation. A login/logout full bust, or a second rate/allocation
  // save for this project, must never adopt an older session/write's promise.
  if (!prefix) {
    freshProjectTeamInFlight.clear();
  } else {
    for (const key of freshProjectTeamInFlight.keys()) {
      if (key.startsWith(prefix) || prefix.startsWith(key)) freshProjectTeamInFlight.delete(key);
    }
  }
  const store = persistStore();
  if (!prefix) {
    _cache.clear();
    // The in-memory seed store (project team/detail snapshots, forecast
    // sources, add-member rosters) is keyed by record id WITHOUT a tenant
    // tag. A tenant/user switch in the same SPA runtime (login without a
    // page reload) would otherwise instant-render the PREVIOUS tenant's
    // data wherever ids collide. Full bust = auth boundary → wipe it all.
    memSeed.clear();
    try {
      if (store) {
        const toDel: string[] = [];
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k && k.startsWith(SS_PREFIX)) toDel.push(k);
        }
        toDel.forEach((k) => store.removeItem(k));
      }
    } catch { /* ignore */ }
    // One-time sweep: InlineDataGrid used to persist uploaded staff/project
    // rows under an UN-scoped `rmone-grid-<cardId>` localStorage key (no
    // tenant in it), so a different company logging into the same browser
    // could see the previous company's staff/project data. The grid now
    // writes tenant-scoped keys (`rmone-grid-<tenant>-<cardId>`), but any
    // legacy un-scoped entries left over from before this fix must be purged
    // here too, or they'd keep leaking on tenants that haven't imported yet.
    try {
      // Legacy un-scoped keys were exactly `rmone-grid-<cardId>` (no tenant
      // segment); remove the known bare card ids so they can never resurface.
      for (const bare of ["projects", "opportunities", "team", "leads", "companies"]) {
        localStorage.removeItem(`rmone-grid-${bare}`);
      }
    } catch { /* ignore */ }
    // Same class of bug: several other localStorage caches (onboarding
    // import tracking, AI card insights, the daily-briefing delta snapshot,
    // inbox read-state) were also un-scoped by tenant, so a company signed
    // in on the same browser could see another company's cached import
    // status / AI insights / briefing metrics. Purge the legacy bare keys
    // and any tenant-prefixed variants left over from before those fixes.
    try {
      localStorage.removeItem("rmone_active_import");
      localStorage.removeItem("rmone_import_result");
      // Legacy bare (un-tenanted) daily-briefing snapshot / inbox read-ids
      // keys — the tenant-scoped variants keep the `_<tenant>` suffix, so the
      // bare base key is only ever the leftover un-scoped one.
      localStorage.removeItem("rmone_daily_briefing_snapshot_v2");
      localStorage.removeItem("rmone_inbox_read_ids_v1");
      // Legacy bare keys from the same un-scoped-key leak class (now written
      // tenant-scoped): alert dismissals, project hold notes, onboarding
      // mapping profiles and "not applicable" gap picks. Purge the bare
      // leftovers so values saved before the scoping fix can't resurface
      // for a different company on the same browser.
      localStorage.removeItem("rmone:dismissed_alerts");
      localStorage.removeItem("rmone:holdInfo");
      localStorage.removeItem("rmone_mapping_profiles");
      localStorage.removeItem("rmone_na_gaps");
      // Legacy card-insight keys (before tenant-scoping) were
      // `rmone:cardInsight:v2:<kind>:<key>` / `rmone:cardInsight:last:<kind>:<id>`
      // i.e. the segment right after the prefix IS the kind, not a tenant tag.
      const kinds = ["project", "opportunity", "lead", "staff", "demand"];
      const toDel: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        for (const base of ["rmone:cardInsight:v2:", "rmone:cardInsight:last:"]) {
          if (k.startsWith(base) && kinds.some((kind) => k.startsWith(`${base}${kind}:`))) {
            toDel.push(k);
          }
        }
      }
      toDel.forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent("rmone:bustCache")); } catch { /* ignore */ }
    return;
  }
  for (const k of [..._cache.keys()]) if (k.startsWith(prefix)) _cache.delete(k);
  try {
    if (store) {
      const toDel: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && k.startsWith(SS_PREFIX + prefix)) toDel.push(k);
      }
      toDel.forEach((k) => store.removeItem(k));
    }
  } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent("rmone:bustCache")); } catch { /* ignore */ }
}

/** Alias of `bustCache(prefix)` matching the mobile app's API surface so the
 *  shared Daily Briefing composer can call the same name on both clients. */
export function bustCacheByPrefix(prefix: string) {
  bustCache(prefix);
}

/** One-stop client-side sync signal after ANY allocation/staff write.
 *  1. rmone:allocationChanged event — pages listening while mounted refetch now.
 *  2. rmone:allocationTs marker — pages compare it on next mount/view switch.
 *  3. React Query invalidation — the Resources page (Staff cards) and Timeline
 *     queries refetch whether they're currently mounted or not. The matching
 *     _cache prefixes MUST already be busted by the caller so those refetches
 *     go to the network instead of re-reading the stale local cache. */
// One-shot ForceFresh flags. After any staff/allocation write, the NEXT
// roster + Timeline fetches add fresh=1 so the server bypasses AND rebuilds
// its per-worker caches. Closes the cross-worker race where the instant
// post-save refetch lands on a cluster worker whose cache-bust IPC hasn't
// arrived yet — that worker would serve the pre-write snapshot and the
// client would re-cache it for minutes ("my edit didn't save"). Same race
// getFullProjectAllocations already solves with its opts.fresh path.
let _allocFreshOnce = false;
let _utilFreshOnce = false;
// Shared response-order state for the canonical allocation API. A save busts
// the caches and starts a fresh read, but it cannot cancel a GET already in
// flight. Every caller (Home, Resources, Forecast, Quick Actions) must
// converge on that newer read instead of letting the older caller paint its
// pre-save snapshot after the fact.
let resourceAllocationsReadGeneration = 0;
let latestResourceAllocationsRead: Promise<ResourceAllocationsResponse> | null = null;
const allocationUtilizationReadState = new Map<string, {
  generation: number;
  latest: Promise<unknown[]> | null;
}>();
export function markAllocationRefetchFresh() {
  _allocFreshOnce = true;
  _utilFreshOnce = true;
}

export function notifyAllocationChanged() {
  // Thin alias onto the unified data-sync bus (lib/dataSync.ts) — kept
  // because dozens of write paths and page effects call this name. The bus
  // runs the bust handler registered below synchronously, then emits BOTH
  // the new rmone:dataChanged event and the legacy rmone:allocationChanged
  // event + rmone:allocationTs marker, with burst coalescing (a run of rapid
  // saves triggers a leading and one trailing cross-page refresh, not N).
  notifyDataChanged(["allocation", "demand"]);
}

// The cache-bust half of the data-sync bus. Runs synchronously on EVERY
// notifyDataChanged call, BEFORE any listener refetch — so those refetches
// hit the network instead of re-reading a stale fetch-layer / React Query
// cache entry.
registerSyncBustHandler((scopes) => {
  const touchesRoster = scopes.has("allocation") || scopes.has("team") || scopes.has("staff");
  if (touchesRoster) {
    // Arm the one-shot fresh flags FIRST — the invalidateQueries below
    // triggers immediate refetches on mounted pages, and those must already
    // see fresh=true so a sibling server worker whose async cache-bust IPC
    // hasn't landed yet is bypassed.
    markAllocationRefetchFresh();
    bustCache("resource-allocations:");
  }
  // Demand rows (open positions) live in the same ResourceAllocation table, so
  // any allocation/team write can change demand too (adding an open position,
  // or an assignment consuming one). Bust the fetch-layer cache FIRST, then
  // invalidate — otherwise the React Query refetch is served the stale 5-min
  // cached payload and the Demand tab keeps showing the pre-write list.
  bustCache("resource-demands");
  // The alerts feed derives from allocations + demand + record statuses —
  // every scope can change it. Busting here is what lets the Home overlay
  // and the Alerts page refetch the POST-write feed immediately instead of
  // re-serving the cached pre-write rows.
  bustCache("alerts-feed:");
  try {
    if (touchesRoster) {
      void queryClient.invalidateQueries({ queryKey: ["resource-allocations"] });
      void queryClient.invalidateQueries({ queryKey: ["util"] });
    }
    void queryClient.invalidateQueries({ queryKey: ["resource-demands"] });
    // Quick Actions hub queries (details / team / assign-prep) all key under
    // the "quick-actions" prefix — invalidate so an open hub converges too.
    void queryClient.invalidateQueries({ queryKey: ["quick-actions"] });
  } catch { /* query client unavailable */ }
});

/**
 * Signals that a direct weekly-hours save has been re-read and matched against
 * server truth. Unlike notifyAllocationChanged(), this deliberately does not
 * update localStorage or invalidate queries: it is an in-tab confirmation for
 * views that should settle their derived figures only after verification.
 */
export function notifyAllocationConfirmed(projectId: string) {
  try {
    window.dispatchEvent(
      new CustomEvent("rmone:allocationConfirmed", { detail: { projectId } }),
    );
  } catch { /* SSR */ }
}

/**
 * Synchronously read a cached value WITHOUT starting a new request.
 * Returns the data if present (fresh or stale) — callers can use this to
 * seed initial component state so they never flash a loading spinner when
 * the data was already fetched by a sibling/parent component.
 * Returns undefined when the key is absent or currently in-flight with no
 * prior data to show.
 */
export function peekCache<T>(key: string): T | undefined {
  const hit = _cache.get(key) as CacheEntry<T> | undefined;
  if (!hit) return undefined;
  // In-flight with stale data → return the stale data (SWR behaviour)
  if (hit.data !== undefined) return hit.data;
  return undefined;
}

/** Rescales existing weekly allocations that are still at the system default
 *  (uniform hours across the whole assignment span, never manually edited)
 *  onto the CURRENT "Hours in a full week" business rule. Manual per-week
 *  overrides are left untouched — see reapplyDefaultHoursRds server-side. */
export async function reapplyDefaultHours(prevFullWeekHours?: number, tenantId?: string): Promise<{ ok: true; groupsRescaled: number; rowsUpdated: number; fullWeekHours: number }> {
  const res = await fetchWithTimeout(`${API}/admin/reapply-default-hours`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(prevFullWeekHours && prevFullWeekHours > 0 ? { prevFullWeekHours } : {}),
      ...(tenantId ? { tenantId } : {}),
    }),
  });
  const result = await handleResponse(res) as { ok: true; groupsRescaled: number; rowsUpdated: number; fullWeekHours: number };
  // Broadcast so any open project-detail page (this tab OR another tab)
  // force-refreshes its "Hours by Phase" tables immediately, the same way
  // rmone:billingRatesChanged does for cost figures — without this, a user
  // has to manually reload the project page to see the new default hours.
  bustCache();
  try { window.dispatchEvent(new CustomEvent("rmone:hoursSettingsChanged")); } catch { /* SSR/non-browser */ }
  try { localStorage.setItem("rmone:hoursSettingsTs", String(Date.now())); } catch { /* storage unavailable */ }
  return result;
}

/* ── localStorage quota recovery ──────────────────────────────────
 * App-data caches no longer persist to localStorage at all (memory-only —
 * see the startup purge + PURGEABLE_CACHE_PREFIXES near the top of this
 * file). This recovery path remains as a belt-and-braces guard: if a
 * customer's browser storage is full for ANY reason (old entries from a
 * previous build, other keys), the critical session writes at login
 * purge re-fetchable leftovers and retry instead of throwing — a full
 * quota once locked users out entirely (server granted the token, the
 * browser couldn't store it). */

// Session/preference keys that must survive any quota eviction.
const QUOTA_PROTECTED_KEYS = new Set<string>([
  TOKEN_KEY, USERNAME_KEY, TENANT_KEY, USER_ID_KEY, CANEDIT_KEY, ISADMIN_KEY,
  "rmone-web:theme",
]);

function removeKeysByPrefix(prefixes: string[]): number {
  let removed = 0;
  try {
    const store = persistStore();
    if (!store) return 0;
    const toDel: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && prefixes.some((p) => k.startsWith(p))) toDel.push(k);
    }
    for (const k of toDel) { store.removeItem(k); removed++; }
  } catch { /* ignore */ }
  return removed;
}

/** Write a CRITICAL key, evicting re-fetchable caches if the quota is full.
 *  Tier 1: purge known derived-cache prefixes.
 *  Tier 2: evict remaining non-protected keys, largest first (import-grid
 *          work `rmone-grid-*` is spared here — it can hold un-imported
 *          user uploads).
 *  Tier 3: import-grid keys as the absolute last resort.
 *  Throws only if the write STILL fails after everything purgeable is gone —
 *  a silent no-op here would "succeed" the login with no stored session. */
function setItemWithQuotaRecovery(key: string, value: string): void {
  const store = persistStore();
  if (!store) return;
  try { store.setItem(key, value); return; } catch { /* quota exceeded */ }
  const n = removeKeysByPrefix(PURGEABLE_CACHE_PREFIXES);
  console.warn(`[storage] quota full writing ${key} — purged ${n} cache entries, retrying`);
  try { store.setItem(key, value); return; } catch { /* still full */ }
  try {
    const candidates: { k: string; len: number }[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k || QUOTA_PROTECTED_KEYS.has(k) || k.startsWith("rmone-grid")) continue;
      candidates.push({ k, len: (store.getItem(k) || "").length });
    }
    candidates.sort((a, b) => b.len - a.len);
    for (const c of candidates) {
      store.removeItem(c.k);
      try { store.setItem(key, value); return; } catch { /* keep evicting */ }
    }
  } catch { /* ignore */ }
  try {
    for (let i = store.length - 1; i >= 0; i--) {
      const k = store.key(i);
      if (!k || !k.startsWith("rmone-grid")) continue;
      store.removeItem(k);
      try { store.setItem(key, value); return; } catch { /* keep evicting */ }
    }
  } catch { /* ignore */ }
  throw new Error("Browser storage is full and could not be freed — please clear this site's data and retry.");
}

/* ─────────────────  AUTH  ───────────────── */

export async function login(tenant: string, username: string, password: string) {
  const params = new URLSearchParams({ grant_type: "password", username, password, tenant });
  const res = await fetchWithTimeout(`${API}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await handleResponse(res) as Record<string, unknown>;
  const token = String(data.access_token ?? "");
  if (!token) throw new Error("No access token returned");
  // Drop any data cached under a PREVIOUS session before establishing the new
  // one. Cache keys are not tenant-scoped, and a user can switch tenants/users
  // without an explicit logout — without this, the prior tenant's cached
  // records (in-memory + the persisted `rmone:cache:*` localStorage entries)
  // would leak into the new session and show the wrong tenant's data. Mirrors
  // the bustCache() in logout(); critical for tenant data isolation.
  bustCache();
  try { sessionStorage.removeItem("rmone_onboarding_draft"); } catch {}
  // Critical session writes — quota-recovering (see setItemWithQuotaRecovery):
  // on a full localStorage these purge re-fetchable caches instead of throwing,
  // which previously locked users out with a bogus "could not reach server".
  setItemWithQuotaRecovery(TOKEN_KEY, token);
  setItemWithQuotaRecovery(USERNAME_KEY, username);
  setItemWithQuotaRecovery(TENANT_KEY, tenant);
  // Drop the PREVIOUS session's user GUID immediately. Sign-in no longer waits
  // for the /profile fetch (which is what writes USER_ID_KEY), so without this
  // a re-login as a different user would briefly send the prior user's GUID
  // in alertsHeaders() until the background profile lands.
  try { localStorage.removeItem(USER_ID_KEY); } catch { /* noop */ }
  // Persist read-only gating immediately from the login response so a reload
  // doesn't transiently render edit controls for an explicit "User" while the
  // background /profile fetch is still in flight. Only an explicit boolean is
  // stored; absence = grandfathered (editable) and we leave the key unset.
  if (typeof data.CanEdit === "boolean") setItemWithQuotaRecovery(CANEDIT_KEY, data.CanEdit ? "1" : "0");
  // Persist Admin flag so Configuration/System nav is shown/hidden immediately
  // without waiting for the background /profile refresh.
  const loginAcl = typeof data.AccessLevel === "string" ? String(data.AccessLevel).trim().toLowerCase() : null;
  if (loginAcl !== null && loginAcl !== "unset") setItemWithQuotaRecovery(ISADMIN_KEY, loginAcl === "admin" ? "1" : "0");
  // Persist the job title from the LOGIN response itself (tenant+user-scoped)
  // so the home role badge/persona is correct from the very first render —
  // no dependency on the follow-up /profile fetch. When the response carries
  // no title, clear any previous value for THIS user so nothing stale shows.
  setStoredUserRoles(tenant, username, typeof data.UserRoles === "string" ? data.UserRoles : null);
  // Drop the legacy non-scoped key so it can never leak across accounts.
  try { localStorage.removeItem(USER_ROLES_KEY); } catch { /* noop */ }
  // Let session-scoped singletons (e.g. the live business-rules thresholds)
  // re-resolve for the newly signed-in company.
  if (typeof window !== "undefined") window.dispatchEvent(new Event("rmone:authChanged"));
  // Warm the in-memory cache for the user's most recently-visited projects
  // 2 s after login so the page shell renders first, then background fetches
  // run silently. By the time the user navigates to a project, server + client
  // caches are already hot → <2 s open instead of 40 s cold start.
  setTimeout(() => { prefetchRecentProjects().catch(() => {}); }, 2000);
  return data;
}

const RECENT_PROJECTS_MAX = 5;

/** Record that the user opened a project (stored as ordered list of IDs, newest first). */
export function recordRecentProject(projectId: string): void {
  try {
    const tenant = localStorage.getItem(TENANT_KEY) ?? "x";
    const key = `rmone:recentProjects:${tenant}`;
    const existing: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
    const deduped = [projectId, ...existing.filter((id) => id !== projectId)].slice(0, RECENT_PROJECTS_MAX);
    localStorage.setItem(key, JSON.stringify(deduped));
  } catch { /* storage unavailable */ }
}

/** Silently warm team + schedule caches for the last N visited projects,
 *  plus org lookups (BU / Division / Department) which are needed by the
 *  project-detail dropdowns on every page visit.
 *  Runs fire-and-forget after login so by the time the user navigates to a
 *  project the MSSQL pool is warm and caches are hot → instant dropdowns. */
async function prefetchRecentProjects(): Promise<void> {
  try {
    // Kick off the three org-structure lookups immediately — they're shared
    // across all projects so we only need one fetch for the whole session.
    // These are the dropdowns that previously caused the "spinning" BU/Div/Dept.
    getDivisions().catch(() => {});
    getDepartments().catch(() => {});
    getBusinessUnits().catch(() => {});

    const tenant = localStorage.getItem(TENANT_KEY) ?? "x";
    const ids: string[] = JSON.parse(localStorage.getItem(`rmone:recentProjects:${tenant}`) ?? "[]");
    if (ids.length === 0) return;
    // Stagger per-project fetches 800 ms apart so we don't hammer the DB
    for (const id of ids) {
      getProjectTeam(id).catch(() => {});
      await new Promise<void>((r) => setTimeout(r, 400));
      getTaskData(id, "0").catch(() => {});
      await new Promise<void>((r) => setTimeout(r, 400));
    }
  } catch { /* ignore */ }
}

// ── Hover prefetch ────────────────────────────────────────────────────────────
// Warm EVERYTHING the project-detail opening overlay waits on, on sustained
// card/row hover (120 ms): detail → phase schedule → team → allocations →
// tenant resource list. All five land in the client `cached()` layer (5-min
// TTL, in-flight shared), so a click moments later resolves the detail page's
// own calls instantly — the processing overlay closes as soon as it fades in.
// Strictly bounded: ONE project at a time, requests SEQUENTIAL (the historic
// DB-pool saturation came from fanning the 7-join team query across a whole
// list in parallel — a single-project chain is safe), once per project per
// session, pointer devices only. The hot-projects re-warm registry is only
// fed by the detail route, and that call passes prefetch=1, so hovering never
// pollutes the hot list.
const _hoverPrefetched = new Set<string>();
let _hoverPrefetchInFlight = false;
let _hoverTimer: ReturnType<typeof setTimeout> | null = null;

export function hoverPrefetchProject(projectId: string): void {
  if (!projectId || _hoverPrefetched.has(projectId)) return;
  if (typeof window === "undefined") return;
  if (window.matchMedia && !window.matchMedia("(pointer: fine)").matches) return; // touch devices: no hover intent
  if (_hoverTimer) clearTimeout(_hoverTimer);
  _hoverTimer = setTimeout(() => {
    _hoverTimer = null;
    if (_hoverPrefetched.has(projectId) || _hoverPrefetchInFlight) return;
    _hoverPrefetched.add(projectId);
    _hoverPrefetchInFlight = true;
    getProjectDetails(projectId, { prefetch: true })
      // Chained one-after-another so at most ONE request is in flight:
      // phase schedule, then team, then per-project allocations. Together
      // these are the exact per-project calls the opening overlay's Phase 2
      // waits on, so a hover-then-click open settles near-instantly.
      .then(() => getTaskData(projectId, "0"))
      .then(() => getProjectTeam(projectId))
      .then((teamRes) => {
        // A transient-empty team fetched at hover time must NOT feed the
        // real page open — the page (and its 1.5s retry) would read the
        // same cached empty and wrongly settle on "No Team Assigned".
        // Bust immediately so the open always refetches an empty team.
        if (!teamRes?.team?.length) bustCache(`project:team:${projectId}`);
        return getProjectAllocations(projectId);
      })
      .catch(() => { /* best-effort warm */ })
      .finally(() => {
        // Release the lock BEFORE the tenant-wide resource list warm: on
        // large tenants that org-wide call can run for tens of seconds, and
        // holding the lock through it starved every subsequent row hover —
        // the user browsing a list got NO prefetch for any other project
        // until it finished. It's a single shared (in-flight-deduped,
        // 5-min-cached) request, so firing it outside the lock adds at most
        // one concurrent request alongside the next project's chain.
        _hoverPrefetchInFlight = false;
        getResourceAllocations().catch(() => { /* best-effort warm */ });
      });
  }, 120);
}

/** Cancel a pending hover prefetch (mouse left before 120 ms of intent). */
export function cancelHoverPrefetch(): void {
  if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
}

export async function logout() {
  try { await fetchWithTimeout(`${API}/logout`, { method: "POST", headers: authHeaders() }); }
  catch {/* ignore */}
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USERNAME_KEY);
  localStorage.removeItem(TENANT_KEY);
  localStorage.removeItem(USER_ROLES_KEY);
  localStorage.removeItem(USER_ID_KEY);
  localStorage.removeItem(CANEDIT_KEY);
  localStorage.removeItem(ISADMIN_KEY);
  bustCache();
  try { sessionStorage.removeItem("rmone_onboarding_draft"); } catch {}
  // Revert session-scoped singletons (e.g. live business rules) to the global
  // defaults now that no company is signed in.
  if (typeof window !== "undefined") window.dispatchEvent(new Event("rmone:authChanged"));
}

export function getStoredUser(): { username: string; tenant: string; token: string; canEdit?: boolean; isAdmin?: boolean; userRoles?: string } | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const username = localStorage.getItem(USERNAME_KEY);
  const tenant = localStorage.getItem(TENANT_KEY);
  if (!token || !username || !tenant) return null;
  const ce = localStorage.getItem(CANEDIT_KEY);
  const canEdit = ce == null ? undefined : ce === "1";
  // Only treat a stored "1" as a definitive true; "0" becomes undefined so the
  // background profile fetch is the authority on non-admin (avoids stale "0"
  // from an old login blocking the nav before the profile re-checks the DB).
  const ia = localStorage.getItem(ISADMIN_KEY);
  const isAdmin = ia === "1" ? true : undefined;
  // Hydrate the job title from the tenant+user-scoped store so a page reload
  // renders the correct role badge/persona immediately (previously the title
  // was blank until the background /profile fetch landed, so the home briefly
  // — or, if that fetch failed, permanently — fell back to "Project Mgr").
  const userRoles = getStoredUserRoles(tenant, username);
  return { token, username, tenant, canEdit, isAdmin, userRoles };
}

// Onboarding import-tracking keys must be tenant-scoped: an uploadId or
// cached result from one company must never surface (via the background
// ImportCompletionWatcher / projects page poller) while browsing a
// different company signed in with the same browser/session.
// Exported: also used for per-tenant UI preferences (e.g. custom stage
// ordering in the Override Stage modal) so they never leak across logins
// to a different company on the same browser.
export function tenantScopedKey(base: string): string {
  const tenant = localStorage.getItem(TENANT_KEY);
  return tenant ? `${base}_${tenant.toLowerCase()}` : base;
}

export function activeImportKey(): string {
  return tenantScopedKey("rmone_active_import");
}

export function importResultKey(): string {
  return tenantScopedKey("rmone_import_result");
}

// Per-tab flag: set while the import wizard's in-page "Processing" step is
// showing a live run — tells the App-level completion watcher to stay quiet
// (that step is the acknowledging surface and busts caches itself).
// sessionStorage on purpose: another tab SHOULD still get the popup.
export const IN_WIZARD_RUN_FLAG = "rmone_in_wizard_run";

export async function getUserProfile(userName: string) {
  const res = await fetchWithTimeout(`${API}/profile?UserName=${encodeURIComponent(userName)}`,
    { headers: authHeaders() });
  const data = await handleResponse(res) as Record<string, unknown>;
  // Refresh the tenant+user-scoped title store with the authoritative profile
  // value. Always overwrite (never keep a stale value when the server now
  // says the title is empty) — but ONLY when the profile we fetched belongs
  // to the currently signed-in user. An in-flight background fetch for user A
  // that resolves after user B logs in (same tab) must not write A's title
  // under B's scoped key.
  try {
    const tenant = localStorage.getItem(TENANT_KEY);
    const username = localStorage.getItem(USERNAME_KEY);
    const sameUser = !!username && username.trim().toLowerCase() === userName.trim().toLowerCase();
    if (tenant && sameUser && typeof data.UserRoles === "string") {
      setStoredUserRoles(tenant, username!, data.UserRoles);
    }
    // Session-flag writes are guarded by the SAME same-user check as the title
    // above: profile fetches run in the background now, so a slow response for
    // user A resolving after user B signed in (same tab) must never overwrite
    // B's userId/canEdit/isAdmin flags with A's.
    if (sameUser) {
      if (data.UserId) setItemWithQuotaRecovery(USER_ID_KEY, String(data.UserId));
      if (typeof data.CanEdit === "boolean") setItemWithQuotaRecovery(CANEDIT_KEY, data.CanEdit ? "1" : "0");
      const profileAcl = typeof data.AccessLevel === "string" ? String(data.AccessLevel).trim().toLowerCase() : null;
      if (profileAcl !== null && profileAcl !== "unset") setItemWithQuotaRecovery(ISADMIN_KEY, profileAcl === "admin" ? "1" : "0");
    }
  } catch { /* storage unavailable */ }
  return data;
}

/* ─────────────────  PROJECTS  ───────────────── */

export async function getProjectList(userName?: string): Promise<string[]> {
  // Cached: fetched by the home overlay for the PROJECT_MANAGER persona on
  // every overlay re-run during login (1-4s uncached in the browser). The
  // shared TTL cache dedupes concurrent calls; busted on login/logout.
  // Failures are NOT cached — thrown → entry dropped → next call retries.
  try {
    return await cached(`project-list:${userName ?? "all"}`, async () => {
      const url = userName
        ? `${API}/projects?UserName=${encodeURIComponent(userName)}`
        : `${API}/projects`;
      const res = await fetchWithTimeout(url, { headers: authHeaders() });
      if (!res.ok) throw new Error(`projects ${res.status}`);
      const data = await res.json() as Record<string, unknown>;
      const arr = Array.isArray(data.projects) ? data.projects as Record<string, unknown>[] : [];
      return arr
        .map(p => String(p.TicketId ?? p.Code ?? p.ProjectCode ?? p.RecordCode ?? p.ProjectId ?? p.Id ?? ""))
        .filter(Boolean);
    });
  } catch { return []; }
}

// One-shot ForceFresh for the project-detail record (same pattern as
// markAllocationRefetchFresh above). Armed right after a record-field save
// (e.g. Target date edit) so the NEXT real getProjectDetails call bypasses
// both the client cache and the serving worker's cache via fresh=1 —
// closing the race where the instant post-save refetch lands on a cluster
// worker whose bust IPC hasn't arrived yet.
let _projectDetailFreshOnce = false;
const _projectDetailFreshIds = new Set<string>();
/** Arm a one-shot fresh read for project details. With a projectId the flag
 *  is scoped to that record only — a fetch for a DIFFERENT record can't
 *  spend it. Without an id it stays global (legacy behavior). */
export function markProjectDetailRefetchFresh(projectId?: string) {
  if (projectId) _projectDetailFreshIds.add(projectId);
  else _projectDetailFreshOnce = true;
}

export async function getProjectDetails(
  projectId: string,
  opts?: { prefetch?: boolean; fresh?: boolean; module?: "PMM" | "OPM" | "LEM" },
) {
  // Hover prefetches never consume the one-shot flag — it must survive
  // until the real post-save refetch fires. A record-scoped arm is consumed
  // only by its own record; the global arm is left for its original caller.
  const scoped = _projectDetailFreshIds.has(projectId);
  const fresh = (opts?.fresh || scoped || _projectDetailFreshOnce) && !opts?.prefetch;
  if (fresh) {
    // An explicit caller-owned fresh read (opts.fresh) must NOT consume the
    // shared one-shot arm — that arm belongs to whoever set it (e.g. the
    // record page's post-save refetch) and starving it would hand that
    // caller a stale cache copy.
    if (!opts?.fresh) {
      if (scoped) _projectDetailFreshIds.delete(projectId);
      else _projectDetailFreshOnce = false;
    }
    bustCache(`project:details:${projectId}:${opts?.module ?? "auto"}`);
  }
  return cached(`project:details:${projectId}:${opts?.module ?? "auto"}`, async () => {
    // prefetch=1 tells the server this is a hover warm, NOT a real open — it
    // fills the server cache but must not enroll the project in the
    // hot-projects re-warm registry.
    const params = new URLSearchParams();
    if (opts?.prefetch) params.set("prefetch", "1");
    else if (fresh) params.set("fresh", "1");
    if (opts?.module) params.set("module", opts.module);
    const url = `${API}/project/${projectId}${params.size ? `?${params}` : ""}`;
    const res = await fetchWithTimeout(url, { headers: authHeaders() });
    return handleResponse(res);
  });
}

export async function getCompanyProjects(companyName: string, companyId?: string) {
  let url = `${API}/company-projects?name=${encodeURIComponent(companyName)}`;
  if (companyId) url += `&companyId=${encodeURIComponent(companyId)}`;
  const res = await fetchWithTimeout(url, { headers: authHeaders() });
  return handleResponse(res);
}

export async function getCompanyContacts(companyId: string, companyName?: string) {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", companyId);
  if (companyName) params.set("companyName", companyName);
  const res = await fetchWithTimeout(
    `${API}/company-contacts?${params.toString()}`,
    { headers: authHeaders() });
  return handleResponse(res);
}

export type ContactSlim = {
  id: string; name: string; title: string; email: string; phone: string; companyName?: string;
};
export type CompanySlim = { id: number; ticketId: string | null; title: string };

export async function getCompaniesList(): Promise<CompanySlim[]> {
  return cached("companies-list", async () => {
    const res = await fetchWithTimeout(`${API}/companies-list`, { headers: authHeaders() });
    const j = await handleResponse(res) as { data?: CompanySlim[] };
    return Array.isArray(j?.data) ? j.data : [];
  });
}

// Create ONE company. Does NOT throw on duplicate name/ID — the server's 409
// carries the existing row so callers can offer "use existing" instead of a
// dead end. Network/5xx failures reject like every other helper.
export async function createCompany(payload: {
  title: string; ticketId?: string;
  // Friendly optional keys — the server maps these to live CRMCompany columns
  // (phone→Telephone, email→EmailAddress, …). Raw column-name bags are NOT
  // accepted server-side; don't add a `fields` passthrough back.
  phone?: string; email?: string; website?: string; city?: string; state?: string;
  // Full New-Company form (Aug 2026).
  shortName?: string; address?: string; address2?: string; zip?: string;
  fax?: string; description?: string; assignedTo?: string;
  relationshipType?: string; businessType?: string; secondaryBusinessType?: string;
  // Primary contact: contactId = existing CRMContact (linked to the new
  // company); contactName alone = create a fresh contact row.
  contactId?: string; contactName?: string; contactTitle?: string; contactEmail?: string;
}): Promise<
  | { ok: true; company: CompanySlim; contactWarning?: string | null }
  | { ok: false; code?: string; error: string; existing?: CompanySlim | null }
> {
  const res = await fetchWithTimeout(`${API}/companies`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  const j = await res.json().catch(() => ({} as Record<string, unknown>)) as {
    Status?: boolean; company?: CompanySlim; code?: string; error?: string; existing?: CompanySlim | null;
    contactWarning?: string | null;
  };
  if (res.ok && j?.Status && j.company) {
    bustCache("companies-list");
    bustCache("module:COM");
    return { ok: true, company: j.company, contactWarning: j.contactWarning ?? null };
  }
  return { ok: false, code: j?.code, error: j?.error || `Could not create the company (${res.status}).`, existing: j?.existing ?? null };
}

// Backfill COM-… IDs for legacy rows missing one. Fail-quiet by design: the
// Companies tab fires it on first visit each session; viewers get a 4xx from
// the server's read-only gate and simply see no change.
export async function ensureCompanyIds(): Promise<{ minted: number; total: number } | null> {
  try {
    const res = await fetchWithTimeout(`${API}/companies/ensure-ids`, {
      method: "POST", headers: authHeaders(),
    });
    if (!res.ok) return null;
    const j = await res.json().catch(() => ({} as Record<string, unknown>)) as { minted?: number; total?: number };
    const minted = Number(j?.minted) || 0;
    if (minted > 0) bustCache("companies-list");
    return { minted, total: Number(j?.total) || 0 };
  } catch { return null; }
}

export async function updateProject(payload: Record<string, unknown>) {
  const res = await fetchWithTimeout(`${API}/project`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await handleResponse(res);
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (d.Status === false) {
      const msgs = Array.isArray(d.ErrorMessages) && (d.ErrorMessages as string[]).length > 0
        ? (d.ErrorMessages as string[]).join("; ")
        : "RM ONE rejected the update";
      throw new Error(msgs);
    }
  }
  bustCache("project:");
  bustCache("projects:");
  bustCache("module:");
  return data;
}

export async function smartUpdate(
  recordId: string,
  fields: { FieldName: string; Value: string; IsExcluded: boolean }[]
) {
  const res = await fetchWithTimeout(`${API}/smart-update`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ RecordId: recordId, Fields: fields }),
  });
  const data = await handleResponse(res);
  // Field-level edit could touch any project field (status, probability,
  // dates, contract value, …). Drop every per-project cache so the
  // detail / dashboard refetch on next open.
  bustCache("project:");
  bustCache("projects:");
  bustCache("module:");
  // ProjectDatesWidget and the opportunity schedule editor use smartUpdate.
  // Their ActualCompletionDate/close-out writes change report period placement
  // just as surely as the standard detail-page updateFields path does.
  const failed = data && typeof data === "object"
    && ((data as { ok?: unknown }).ok === false || (data as { Status?: unknown }).Status === false);
  if (!failed) {
    notifyLifecycleForReportWrite(recordId, fields);
    // Same cross-page broadcast as updateFields — smartUpdate is the other
    // record field write path (schedule widgets, opp schedule editor).
    notifyDataChanged(["record"], { recordIds: [recordId] });
  }
  return data;
}

/**
 * Superadmin-only: delete a record (project / opportunity / lead) plus its
 * team assignments and schedule. The server enforces the root-superadmin
 * allowlist — normal admins get a 403. Throws on failure.
 */
export async function deleteRecord(
  recordId: string,
  module: "PMM" | "OPM" | "LEM"
): Promise<void> {
  const res = await fetchWithTimeout(`${API}/delete-record`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ticketId: recordId, module }),
  });
  await handleResponse(res);
  bustCache("project:");
  bustCache("projects:");
  bustCache("module:");
}

export interface DeletedRecord {
  id: number;
  ticketId: string;
  title: string;
  module: "PMM" | "OPM" | "LEM";
  deletedAt: string | null; // ISO-8601 or null for pre-migration deletes
}

/**
 * Superadmin-only: list recently soft-deleted records for the tenant (or a
 * specific tenant when the rmone superadmin passes tenantId). Returns up to
 * 500 rows, newest-first; pre-migration rows (no timestamp) follow.
 */
export async function listDeletedRecords(opts?: {
  tenantId?: string;
  days?: number;
  module?: "PMM" | "OPM" | "LEM";
}): Promise<DeletedRecord[]> {
  const params = new URLSearchParams();
  if (opts?.tenantId) params.set("tenantId", opts.tenantId);
  if (opts?.days)     params.set("days", String(opts.days));
  if (opts?.module)   params.set("module", opts.module);
  const qs = params.toString();
  const res = await fetchWithTimeout(`${API}/deleted-records${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  const data = (await handleResponse(res)) as { Status: boolean; rows: DeletedRecord[] };
  return data.rows ?? [];
}

/**
 * Superadmin-only: restore a soft-deleted record (by integer row ID) plus its
 * team assignments. Schedule (PMMTasks) cannot be restored — they were hard-deleted.
 * Returns the ticketId of the restored record. Throws on conflict or failure.
 */
export async function restoreRecord(
  rowId: number,
  module: "PMM" | "OPM" | "LEM",
  tenant?: string,
): Promise<{ ticketId: string; title: string; allocations: number; workItems: number }> {
  const res = await fetchWithTimeout(`${API}/restore-record`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ rowId, module, ...(tenant ? { tenant } : {}) }),
  });
  const data = (await handleResponse(res)) as {
    Status: boolean;
    ticketId: string;
    title: string;
    restored: { allocations: number; workItems: number; scheduleRestored: boolean };
  };
  bustCache("project:");
  bustCache("projects:");
  bustCache("module:");
  return {
    ticketId: data.ticketId,
    title: data.title,
    allocations: data.restored?.allocations ?? 0,
    workItems: data.restored?.workItems ?? 0,
  };
}

/**
 * General per-field project update. Persists for both upstream-RM ONE tenants
 * and onboarded RDS/core2 tenants. Returns { ok, error? }.
 */
export async function updateFields(
  recordId: string,
  fields: { FieldName: string; Value: string }[],
  options?: { lifecycleModules?: LifecycleModule[] },
): Promise<{ ok: boolean; updated?: string[]; error?: string; landedStage?: string }> {
  const res = await fetchWithTimeout(`${API}/update-fields`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ RecordId: recordId, Fields: fields }),
  });
  const data = (await handleResponse(res)) as { ok: boolean; updated?: string[]; error?: string; landedStage?: string };
  bustCache("project:");
  bustCache("projects:");
  bustCache("module:");
  // A STATUS edit moves the record between the Active and Closed/Archive
  // lists, so the module list queries must refetch even when their page is
  // UNMOUNTED right now (the detail page's "moduleFieldSaved" event only
  // reaches mounted listeners, and the React Query staleTime is 10 minutes —
  // navigating back would otherwise show the record in its OLD bucket).
  // invalidateQueries marks the cached lists stale so the next mount
  // refetches; the fresh latch makes that refetch bypass any sibling server
  // worker whose async cache-bust hasn't landed yet.
  // landedStage: the server moved the record's stage ITSELF (skip-rule
  // redirect or auto-advance), so a payload with NO status field can still
  // change the record's stage/bucket — arm the same freshness path.
  if (data.ok) {
    notifyLifecycleForReportWrite(recordId, fields, options?.lifecycleModules, !!data.landedStage);
    // Status / field edits reshape the Home overlay (risk feed, decision
    // support), the Alerts page and Quick Actions — broadcast on the unified
    // bus so every mounted page refetches instead of waiting for a manual
    // browser refresh. recordIds lets record-scoped listeners (an open
    // Project Detail) skip refreshes for OTHER records.
    notifyDataChanged(["record"], { recordIds: [recordId] });
  }
  return data;
}

// FieldNames that carry a record's status across the three modules (PMM /
// OPM / LEM) — mirrors the server's fieldKind "status" candidates.
const STATUS_FIELD_RE = /^(status|leadstatus|projectstatus|crmprojectstatuschoice|crmopportunitystatuschoice)$/i;
const REPORT_LIFECYCLE_DATE_FIELD_RE = /^(closeoutdate|closeddate|actualcompletiondate|awardedorlossdate)$/i;

/** Fields whose saved value changes lifecycle counts or period placement in Reports. */
export function isLifecycleReportField(fieldName: string): boolean {
  return STATUS_FIELD_RE.test(fieldName) || REPORT_LIFECYCLE_DATE_FIELD_RE.test(fieldName);
}

/**
 * Shared post-write bridge for every API write path. A status/date that
 * changes Pipeline Review membership or period placement must refresh both
 * the module list and report model; callers can supply both modules for a
 * source-and-destination conversion.
 */
function notifyLifecycleForReportWrite(
  recordId: string,
  fields: readonly { FieldName: string }[],
  lifecycleModules?: readonly LifecycleModule[],
  force = false,
): void {
  if (!force && !fields.some((field) => isLifecycleReportField(field.FieldName))) return;
  const inferredModule = moduleFromRecordId(recordId);
  notifyLifecycleChanged(
    lifecycleModules?.length
      ? lifecycleModules
      : inferredModule ? [inferredModule] : ALL_LIFECYCLE_MODULES,
  );
}

// One-shot "read through to the DB" latches, armed by updateFields after a
// STATUS write. The list caches (client `module:` + per-worker server records
// cache) are busted on save, but the server bust is an async IPC broadcast —
// an instant refetch can land on a sibling worker BEFORE its bust arrives and
// re-cache a pre-save snapshot for minutes. ?fresh=1 makes the FIRST post-save
// read race-proof (same pattern as the resource-allocations refetch).
const _moduleFreshOnce = new Set<string>();
export function markModuleRecordsFresh(mods: string[] = ["PMM", "OPM", "LEM"]): void {
  for (const m of mods) _moduleFreshOnce.add(m);
}

export type LifecycleModule = "PMM" | "OPM" | "LEM";
export const LIFECYCLE_CHANGED_EVENT = "rmone:lifecycleChanged";

type LifecycleRefreshSignal = {
  id: string;
  tenant: string;
  modules: LifecycleModule[];
  at: number;
};

const ALL_LIFECYCLE_MODULES: LifecycleModule[] = ["PMM", "OPM", "LEM"];
const LIFECYCLE_CHANNEL_NAME = "rmone:lifecycle-refresh";
const LIFECYCLE_STORAGE_PREFIX = "rmone:lifecycle-refresh:";
const seenLifecycleSignals = new Set<string>();
let lifecycleChannel: BroadcastChannel | null = null;

function normalizeLifecycleModules(modules?: readonly string[]): LifecycleModule[] {
  const out = new Set<LifecycleModule>();
  for (const raw of modules ?? ALL_LIFECYCLE_MODULES) {
    const moduleName = String(raw ?? "").trim().toUpperCase();
    if (moduleName === "PMM" || moduleName === "OPM" || moduleName === "LEM") out.add(moduleName);
  }
  return out.size > 0 ? [...out] : [...ALL_LIFECYCLE_MODULES];
}

function currentLifecycleTenant(): string {
  try { return (localStorage.getItem(TENANT_KEY) ?? "").trim().toLowerCase(); }
  catch { return ""; }
}

function moduleFromRecordId(recordId: string): LifecycleModule | null {
  const match = String(recordId ?? "").trim().match(/^(PMM|OPM|LEM)(?:[-_\s]|$)/i);
  const moduleName = match?.[1]?.toUpperCase();
  return moduleName === "PMM" || moduleName === "OPM" || moduleName === "LEM" ? moduleName : null;
}

function applyLifecycleRefresh(modules: LifecycleModule[], at = Date.now()): void {
  // Ordering is deliberate: React Query refetches eventually call
  // getModuleRecords(), whose separate five-minute custom cache must already
  // be empty. The one-shot fresh latch also forces the first affected module
  // read to bypass a sibling worker's pre-write cache entry.
  for (const moduleName of modules) bustCache(`module:${moduleName}`);
  bustCache("status-history");
  markModuleRecordsFresh(modules);
  for (const moduleName of modules) {
    void queryClient.invalidateQueries({ queryKey: [moduleName.toLowerCase()] });
  }
  try {
    window.dispatchEvent(new CustomEvent(LIFECYCLE_CHANGED_EVENT, {
      detail: { modules: [...modules], at },
    }));
  } catch { /* browser event APIs unavailable */ }
}

function receiveLifecycleSignal(signal: LifecycleRefreshSignal): void {
  if (!signal || typeof signal.id !== "string" || seenLifecycleSignals.has(signal.id)) return;
  if (!signal.tenant || signal.tenant !== currentLifecycleTenant()) return;
  seenLifecycleSignals.add(signal.id);
  setTimeout(() => seenLifecycleSignals.delete(signal.id), 60_000);
  applyLifecycleRefresh(normalizeLifecycleModules(signal.modules), signal.at);
}

if (typeof window !== "undefined") {
  let channelReady = false;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      lifecycleChannel = new BroadcastChannel(LIFECYCLE_CHANNEL_NAME);
      lifecycleChannel.addEventListener("message", (event: MessageEvent<LifecycleRefreshSignal>) => {
        receiveLifecycleSignal(event.data);
      });
      channelReady = true;
    }
  } catch {
    lifecycleChannel = null;
  }
  if (!channelReady) {
    window.addEventListener("storage", (event: StorageEvent) => {
      if (!event.key?.startsWith(LIFECYCLE_STORAGE_PREFIX) || !event.newValue) return;
      try { receiveLifecycleSignal(JSON.parse(event.newValue) as LifecycleRefreshSignal); }
      catch { /* malformed/legacy marker */ }
    });
  }
}

/**
 * Canonical post-write refresh for lead/opportunity/project lifecycle changes.
 * It refreshes this tab immediately and sends only tenant-scoped event metadata
 * (never record data) to other open RM ONE tabs.
 */
export function notifyLifecycleChanged(modules?: readonly LifecycleModule[]): void {
  const normalized = normalizeLifecycleModules(modules);
  const tenant = currentLifecycleTenant();
  applyLifecycleRefresh(normalized);
  if (!tenant) return;

  const signal: LifecycleRefreshSignal = {
    id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    tenant,
    modules: normalized,
    at: Date.now(),
  };

  try {
    if (lifecycleChannel) {
      lifecycleChannel.postMessage(signal);
      return;
    }
    // Fallback is a transient coordination marker, not a data cache. Removing
    // it immediately leaves no lifecycle/customer record data at rest.
    const key = `${LIFECYCLE_STORAGE_PREFIX}${encodeURIComponent(tenant)}`;
    localStorage.setItem(key, JSON.stringify(signal));
    localStorage.removeItem(key);
  } catch { /* cross-tab notification is best-effort */ }
}

/** Distinct option values for an editable dropdown field (status | sector). */
export async function getFieldOptions(
  field: "status" | "sector" | "projecttype" | "servicetype" | "requestcategory" | "city" | "state" | "office",
  module?: "OPM" | "PMM" | "LEM",
  opts?: { force?: boolean },
): Promise<string[]> {
  const key = `field-options:${field}${module ? `:${module}` : ""}`;
  // `force` drops the client cache AND tells the server to bust its 5-min cache,
  // so a Refresh click always reflects the latest onboarding stage-set changes.
  if (opts?.force) bustCache(key);
  return cached(key, async () => {
    const params = new URLSearchParams();
    if (module) params.set("module", module);
    if (opts?.force) params.set("bust", "1");
    const qs = params.toString() ? `?${params}` : "";
    const res = await fetchWithTimeout(`${API}/field-options/${field}${qs}`, { headers: authHeaders() });
    const data = (await handleResponse(res)) as { options?: string[] };
    return Array.isArray(data.options) ? data.options : [];
  });
}

/* ─────────────────  MODULE RECORDS (PMM/OPM/LEM/COM/CON)  ───────────────── */

export interface ModuleRecord { [key: string]: unknown }
export interface ModuleRecordsResponse { total: number; data: ModuleRecord[] }

export async function getModuleRecords(
  module: "PMM" | "OPM" | "LEM" | "COM" | "CON",
): Promise<ModuleRecordsResponse> {
  const key = `module:${module}`;
  return cached(key, async () => {
    // Consume the one-shot fresh latch only when a network fetch actually
    // fires (a client-cache hit must not burn it).
    const fresh = _moduleFreshOnce.delete(module);
    const res = await fetchWithTimeout(`${API}/records/${module}${fresh ? "?fresh=1" : ""}`, { headers: authHeaders() });
    return handleResponse(res) as Promise<ModuleRecordsResponse>;
  });
}

/**
 * Force a GENUINELY fresh module-record read: busts the client `module:<m>`
 * cache AND arms the one-shot fresh latch so the network fetch carries
 * `?fresh=1` (server bypasses + rebuilds its per-worker cache). Used by the
 * create/conversion wizards so the auto-suggested next ID and the duplicate
 * guard can never be computed from a list that predates a record another
 * user (or another worker) just created. Plain getModuleRecords + staleTime:0
 * is NOT enough — cached() returns the warm client copy, and even a network
 * fetch without fresh=1 can be served a sibling worker's stale 5-min cache.
 */
export async function getModuleRecordsFresh(
  module: "PMM" | "OPM" | "LEM" | "COM" | "CON",
): Promise<ModuleRecordsResponse> {
  markModuleRecordsFresh([module]);
  bustCache(`module:${module}`);
  return getModuleRecords(module);
}

/* ─────────────────  RESOURCE / ALLOCATION  ───────────────── */

export interface ActiveAllocationProxy {
  projectId: string;
  projectName?: string;
  module?: "PMM" | "OPM" | "LEM";
  pct: number;
  hours?: number;
  startDate: string;
  endDate: string;
}
export interface LiveResourceProxy {
  id: string; name: string; username: string; role: string;
  businessUnit?: string; divisionName?: string; roleName?: string; departmentName?: string;
  startDate?: string; endDate?: string;
  billingRate?: number | null; laborRate?: number | null; costRate?: number | null;
  divisionId?: string; departmentId?: string; roleId?: string; jobTitleId?: string;
  accessLevel?: string | null;
  /** GUID of the tenant this person belongs to. Included so the Edit Staff
   *  modal can always fetch catalogs (divisions, departments, roles, job
   *  titles) for the RIGHT company even when a superadmin is logged in as
   *  the "rmone" home tenant and viewing another company's Resources page. */
  tenantId?: string;
  /** Staff city (HR directory) — optional; used as an Office fallback in the
   *  Forecast pivots when AspNetUsers.Office/DeskLocation is blank. */
  city?: string | null;
  currentPct: number; totalProjects: number;
  allProjectIds: string[]; activeProjects: string[];
  activeAllocations: ActiveAllocationProxy[];
  allAllocations?: ActiveAllocationProxy[];
  lastActiveDate: string | null;
  employeeType?: string | null;
  phoneNumber?: string | null;
  employeeId?: string | null;
  /** false = person was added in-app and hasn't verified their email (set their
   *  own password via the invite link) yet. Missing/true = verified. */
  emailVerified?: boolean;
  /** false when the person's account has been disabled by an administrator. */
  enabled?: boolean;
}
export interface ResourceAllocationsResponse {
  total: number;
  bench: number;
  underUtil: number;
  healthy: number;
  overAllocated: number;
  resources: LiveResourceProxy[];
  projectNameMap?: Record<string, string>;
  projectModuleMap?: Record<string, "PMM" | "OPM" | "LEM">;
  userGuidToName?: Record<string, string>;
}

/** Live (never cached) org/access snapshot of one staff member. The Edit
 *  Staff modal re-seeds from this on open so a long-open tab's stale roster
 *  copy can never present empty or outdated dropdown values.
 *  Pass tenantId (GUID) when calling as a superadmin so the server looks up
 *  the person in the right company rather than the superadmin's home tenant. */
export async function getStaffCore(guid: string, tenantId?: string): Promise<Record<string, string>> {
  const suffix = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
  const res = await fetchWithTimeout(`${API}/staff/${encodeURIComponent(guid)}/core${suffix}`, { headers: authHeaders() }, 10_000);
  return handleResponse(res) as Promise<Record<string, string>>;
}

export async function getResourceAllocations(): Promise<ResourceAllocationsResponse> {
  // Consume the one-shot ForceFresh flag armed by staff/allocation writes:
  // drop the local cache entry and ask the server to bypass its per-worker
  // caches so this refetch always returns the post-write roster.
  const fresh = _allocFreshOnce;
  _allocFreshOnce = false;
  if (fresh) {
    resourceAllocationsReadGeneration += 1;
    _cache.delete("resource-allocations:all");
  }
  const readGeneration = resourceAllocationsReadGeneration;
  // Key MUST contain the ":" segment — every invalidation site calls
  // bustCache("resource-allocations:") which is a startsWith match, so a
  // bare "resource-allocations" key would never be busted after a save.
  const read = (async (): Promise<ResourceAllocationsResponse> => {
    let data: ResourceAllocationsResponse;
    try {
      data = await cached("resource-allocations:all", async () => {
        const res = await fetchWithTimeout(`${API}/resource-allocations${fresh ? "?fresh=1" : ""}`, { headers: authHeaders() });
        return handleResponse(res) as Promise<ResourceAllocationsResponse>;
      });
    } catch (e) {
      // The one-shot flag was spent on a fetch that never completed — re-arm it
      // so the retry still bypasses the server's per-worker caches.
      if (fresh) _allocFreshOnce = true;
      throw e;
    }
    // A degraded payload (_degraded: the backend survived a partial DB failure
    // and served a names-only roster at 0%) must NEVER sit in this module cache
    // for the full TTL. React Query polls every 30s specifically to heal from
    // degraded data — but that poll goes through cached(), so a warm degraded
    // entry would keep answering the poll without ever reaching the server.
    // That was the "21 staff / all 0%" freeze that only a hard page refresh
    // (which clears this in-memory cache) could fix.
    if ((data as { _degraded?: unknown } | null)?._degraded) {
      _cache.delete("resource-allocations:all");
    }
    return data;
  })();

  let orderedRead!: Promise<ResourceAllocationsResponse>;
  orderedRead = read.then(async (data): Promise<ResourceAllocationsResponse> => {
    if (
      readGeneration !== resourceAllocationsReadGeneration &&
      latestResourceAllocationsRead &&
      latestResourceAllocationsRead !== orderedRead
    ) {
      return latestResourceAllocationsRead;
    }
    return data;
  });
  if (fresh) latestResourceAllocationsRead = orderedRead;
  return orderedRead;
}

export interface DemandItem {
  /** Backing ResourceAllocation ID for this open demand row (RDS tenants).
   * Passed through Home alert rows so a selected fill can consume the exact
   * position without relying on role/title matching. */
  RaId?: number;
  TicketId: string; Title: string; Role: string;
  PctAllocation: number;
  AllocationStartDate: string; AllocationEndDate: string;
  SoftAllocation: boolean; NonChargeable: boolean; IsLocked: boolean;
  ApproxContractValue: number;
  TargetStartDate: string | null; TargetCompletionDate: string | null;
  ActualStartDate: string | null; ActualCompletionDate: string | null;
  CloseDate: string | null;
}
export interface ResourceDemandsResponse { total: number; data: DemandItem[] }

export async function getResourceDemands(): Promise<ResourceDemandsResponse> {
  return cached("resource-demands", async () => {
    const res = await fetchWithTimeout(`${API}/resource-demands`, { headers: authHeaders() });
    return handleResponse(res) as Promise<ResourceDemandsResponse>;
  });
}

/* ─────────────  STATUS-CHANGE HISTORY (Reports)  ─────────────
 * GET /api/rmone/status-history → tenant-scoped ledger of status/stage
 * changes (RMOneStatusHistory), written by every status write path (picker
 * edits, schedule auto-advance, imports). `since` = the tenant's earliest
 * recorded change so the Reports pages can tell whether history fully covers
 * a chosen period (only then do the "all time" honesty notes disappear).
 */
export interface StatusChangeItem {
  module: "PMM" | "OPM" | "LEM";
  ticketId: string;
  oldStatus: string | null;
  newStatus: string | null;
  changedAt: string;      // ISO UTC
  changedBy: string | null;
  source: string;         // user | auto | import
}
/* ─────────────  RESOURCE MASTER LIST (June 2026)  ─────────────
 * GET /api/rmone/resource-master → directory of ALL tenant resources with
 * Office (DeskLocation), Department, Capacity (EmployeeType), JobTitle and
 * Email. Used by the Forecast page to enrich the Office/Role pivot labels.
 */
export interface ResourceMasterRow {
  id: string;
  name: string;
  office: string | null;
  department: string | null;
  capacity: string | null;
  jobTitle: string | null;
  email: string | null;
}

export async function getResourceMaster(): Promise<ResourceMasterRow[]> {
  return cached("resource-master", async () => {
    const res = await fetchWithTimeout(`${API}/resource-master`, { headers: authHeaders() });
    const rows = await handleResponse(res) as ResourceMasterRow[];
    return Array.isArray(rows) ? rows : [];
  }) as Promise<ResourceMasterRow[]>;
}

// ── Manager-staff filter (Staff tab Resources page) ───────────────────────────

export interface ManagerEntry {
  id: string;
  name: string;
  /** Unique direct reports + managed-project teammates shown after selection. */
  teamMemberCount?: number;
}

/** Returns relationship managers; Manager-page mode also includes leadership titles for count labels. */
export async function getManagersList(includeLeadershipTitles = false): Promise<ManagerEntry[]> {
  const mode = includeLeadershipTitles ? "leadership" : "relationships";
  return cached(`managers-list:${mode}`, async () => {
    const params = new URLSearchParams({ list: "1" });
    if (includeLeadershipTitles) params.set("includeLeadershipTitles", "1");
    const res = await fetchWithTimeout(`${API}/manager-staff?${params.toString()}`, { headers: authHeaders() });
    const d = await handleResponse(res) as { managers: ManagerEntry[] };
    return Array.isArray(d?.managers) ? d.managers : [];
  }) as Promise<ManagerEntry[]>;
}

export interface ManagerStaffResponse {
  direct: { id: string }[];
  projectTeam: { id: string; ticketId: string }[];
  managedProjects: {
    ticketId: string;
    title: string;
    leadRole: string;
    /** Project-specific team IDs used by the project-first manager chart. */
    teamMemberIds?: string[];
  }[];
  /** true when the project-team resource-allocation query failed; the UI should
   *  show a warning rather than treat an empty project-team as authoritative. */
  projectTeamError?: boolean;
}

/** Returns the two groups of staff under a given manager (direct + project team). */
export async function getManagerStaff(managerId: string): Promise<ManagerStaffResponse> {
  const res = await fetchWithTimeout(`${API}/manager-staff?managerId=${encodeURIComponent(managerId)}`, { headers: authHeaders() });
  return handleResponse(res) as Promise<ManagerStaffResponse>;
}

// ── Lead/Team hierarchy (Resources page → Manager view) ──────────────────────

export interface LeadDirectoryEntry {
  id: string;
  name: string;
  title: string;
  /** Raw *User field names this person appears in (e.g. "VicePresidentUser"). */
  fields: string[];
  recordCount: number;
}

export interface LeadTeamLead { id: string | null; name: string; field: string }
export interface LeadTeamMember { id: string; name: string; role: string; title: string }
export interface LeadTeamRecord {
  ticketId: string;
  title: string;
  module: "PMM" | "OPM";
  leads: LeadTeamLead[];
  team: LeadTeamMember[];
  /** Hierarchy mode: true = person holds a lead field on this record (whole
   *  team ranks under them); false = plain membership (rank-based only). */
  selfIsLead?: boolean;
}
export interface LeadTeamContext {
  person: { id: string; name: string; title: string };
  isLead: boolean;
  records: LeadTeamRecord[];
  /** Hierarchy mode only: imported Manager/Supervisor direct reports. */
  direct?: { id: string; name: string; title: string }[];
  /** true = team query failed — empty teams are NOT authoritative, warn. */
  teamError: boolean;
  /** true = record list hit the server cap; some records omitted. */
  truncated: boolean;
  /** true = one module's lead scan failed — the record list may be missing an
   *  entire module, and isLead:false is NOT authoritative. */
  partial: boolean;
  /** Hierarchy mode: member-record lookup failed — records may be missing;
   *  never read the list as complete when true. */
  membershipError?: boolean;
}

/** Everyone holding a lead (key-personnel) role on any project/opportunity. */
export async function getLeadsDirectory(): Promise<{ leads: LeadDirectoryEntry[]; partial: boolean }> {
  const res = await fetchWithTimeout(`${API}/lead-team-context?list=1`, { headers: authHeaders() });
  const d = await handleResponse(res) as { leads: LeadDirectoryEntry[]; partial?: boolean };
  return { leads: Array.isArray(d?.leads) ? d.leads : [], partial: d?.partial === true };
}

/** Full lead + team structure for one person across all their records. */
export async function getLeadTeamContext(personId: string): Promise<LeadTeamContext> {
  const res = await fetchWithTimeout(`${API}/lead-team-context?personId=${encodeURIComponent(personId)}`, { headers: authHeaders() });
  return handleResponse(res) as Promise<LeadTeamContext>;
}

/** Manager-tab hierarchy: lead records + records the person is a plain team
 *  member of (with per-record team rosters + roles) + direct reports. */
export async function getManagerHierarchy(personId: string): Promise<LeadTeamContext> {
  const res = await fetchWithTimeout(
    `${API}/lead-team-context?personId=${encodeURIComponent(personId)}&hierarchy=1`,
    { headers: authHeaders() },
  );
  return handleResponse(res) as Promise<LeadTeamContext>;
}

export interface AllocationUtilizationResponse {
  [resourceUser: string]: unknown;
}

export async function getAllocationUtilization(opts: {
  startDate: string; endDate: string;
  mode?: "Daily" | "Weekly" | "Monthly";
  showActuals?: boolean; onlyNCO?: boolean; department?: string;
  includeClosedProject?: boolean; includeSoftAllocations?: boolean;
}): Promise<unknown[]> {
  const p = new URLSearchParams({
    startDate: opts.startDate, endDate: opts.endDate,
    mode: opts.mode ?? "Weekly",
  });
  if (opts.showActuals) p.append("showActuals", "true");
  if (opts.onlyNCO) p.append("onlyNCO", "true");
  if (opts.includeClosedProject) p.append("includeClosedProject", "true");
  if (opts.includeSoftAllocations) p.append("includeSoftAllocations", "true");
  if (opts.department) p.append("department", opts.department);
  const readKey = p.toString();
  const state = allocationUtilizationReadState.get(readKey) ?? { generation: 0, latest: null };
  allocationUtilizationReadState.set(readKey, state);
  // One-shot ForceFresh after staff/allocation writes — see
  // markAllocationRefetchFresh: the post-save Timeline refetch must bypass
  // the server's per-worker caches or it can re-cache pre-write data.
  const fresh = _utilFreshOnce;
  _utilFreshOnce = false;
  if (fresh) state.generation += 1;
  const readGeneration = state.generation;
  if (fresh) p.append("fresh", "1");
  const read = (async (): Promise<unknown[]> => {
    try {
      const res = await fetchWithTimeout(`${API}/allocation-utilization?${p.toString()}`,
        { headers: authHeaders() });
      return await (handleResponse(res) as Promise<unknown[]>);
    } catch (e) {
      // Failed fresh fetch — re-arm the one-shot flag for the retry.
      if (fresh) _utilFreshOnce = true;
      throw e;
    }
  })();
  let orderedRead!: Promise<unknown[]>;
  orderedRead = read.then(async (data): Promise<unknown[]> => {
    if (readGeneration !== state.generation && state.latest && state.latest !== orderedRead) {
      return state.latest;
    }
    return data;
  });
  if (fresh) state.latest = orderedRead;
  return orderedRead;
}

export async function getBenchResources(opts: {
  startDate: string; endDate: string;
  mode?: "Daily" | "Weekly" | "Monthly"; department?: string;
}): Promise<unknown[]> {
  const p = new URLSearchParams({
    startDate: opts.startDate, endDate: opts.endDate,
    mode: opts.mode ?? "Weekly",
  });
  if (opts.department) p.append("department", opts.department);
  const res = await fetchWithTimeout(`${API}/bench-resources?${p.toString()}`,
    { headers: authHeaders() });
  return handleResponse(res) as Promise<unknown[]>;
}

export async function getProjectAllocations(projectID: string) {
  return cached(`project:allocations:${projectID}`, async () => {
    const res = await fetchWithTimeout(`${API}/allocations?projectID=${encodeURIComponent(projectID)}`,
      { headers: authHeaders() });
    return handleResponse(res);
  });
}

export async function getFullProjectAllocations(projectId: string, opts?: { fresh?: boolean }) {
  // Cached: this is called once per expanded team-member card (PhaseBreakdown)
  // for the SAME project, so without caching every card expansion re-issued a
  // full RDS round trip. bustCache("resource-allocations:") + bustCache() are
  // already called after every hours save, so the cache never serves stale
  // data past an edit.
  //
  // opts.fresh — used by post-save refetches: busts the local cache entry AND
  // sends ForceFresh to the server so its per-worker cache is bypassed too
  // (an instant refetch can otherwise hit a cluster worker whose cache-bust
  // IPC hasn't arrived yet and re-cache a pre-save snapshot for minutes).
  const key = `project-allocations-full:${projectId}`;
  if (opts?.fresh) bustCache(key);
  const result = await cached(key, async () => {
    const today = new Date().toISOString().split("T")[0];
    const res = await fetchWithTimeout(`${API}/project-allocations`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        ProjectID: projectId,
        TemplateID: null,
        ETCFromDate: today,
        CurrentDate: today,
        IncludePast: true,
        ...(opts?.fresh ? { ForceFresh: true } : {}),
      }),
    });
    return handleResponse(res) as Promise<Record<string, unknown>>;
  });
  // Don't let an empty result sit in cache — a cold DB/Postgres pool on first
  // load can return [] before the real query lands. Busting the key means
  // the next expansion issues a fresh fetch instead of serving stale empty
  // data for the full 5-minute TTL.
  const existing = (result as any)?.ExistingAllocations;
  if (!Array.isArray(existing) || existing.length === 0) {
    bustCache(key);
  }
  return result;
}

// Remove a team member from a project/opportunity/lead. Soft-deletes every
// allocation + work-item row for the person on the record (server-side,
// admin/manager only — the server 403s view-only users).
export async function removeTeamMember(projectId: string, resourceUser: string) {
  // 45s cap (not the global 90s): removal is one focused server tx — if the
  // upstream DB is browned out, fail fast so the confirm popup can't sit in
  // "Removing…" for a minute and a half.
  const res = await fetchWithTimeout(`${API}/remove-team-member`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ProjectID: projectId, ResourceUser: resourceUser }),
  }, 45_000);
  const data = await handleResponse(res) as { Status?: boolean; raRemoved?: number; rwiRemoved?: number };
  // Bust the local caches the team surfaces read so the immediate refetch
  // can't serve a pre-removal snapshot.
  bustCache(`project-allocations-full:${projectId}`);
  bustCache("resource-allocations:");
  // Removal was the one team write that never broadcast — Home overlays,
  // the Alerts page and Demand kept showing the removed member until a
  // manual browser refresh. Publish on the unified bus like every other
  // membership write.
  notifyDataChanged(["allocation", "team"]);
  return data;
}

// Change resource: replace who does the REMAINING work on an assignment.
// History stays with the outgoing member — everything from next Monday onward
// moves to the person in Allocations[0].AssignedTo. Server-gated on the
// manage-staff capability, same as removals.
export async function changeTeamResource(payload: {
  ProjectID: string;
  FromResourceUser: string;
  Allocations: Record<string, unknown>[];
  // Record-resolved schedule-window flag, same contract as assignResource —
  // the hand-over runs through the identical server-side assign gates.
  // Tighten-only server-side: `true` enforces, `false`/omitted defer to the
  // server's own module-aware resolution.
  ScheduleWindowEnabled?: boolean;
}) {
  // 90s cap: the hand-over is one server transaction, but it can touch many
  // weekly rows on long assignments — give it more room than a removal.
  const res = await fetchWithTimeout(`${API}/change-team-resource`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 90_000);
  const data = await handleResponse(res) as {
    Status?: boolean; ok?: boolean; error?: string; Message?: string;
    cutover?: string; moved?: number; split?: number; truncated?: number;
    dropped?: number; synthesized?: number; oldMemberRemoved?: boolean;
    targetEndExtended?: string;
  };
  // Bust the local caches the team surfaces read so the immediate refetch
  // can't serve a pre-handover snapshot.
  bustCache(`project-allocations-full:${payload.ProjectID}`);
  bustCache("resource-allocations:");
  // Hand-over changes two people's workloads — broadcast so every mounted
  // page (Home, Alerts, Resources, Demand) refetches without a reload.
  notifyDataChanged(["allocation", "team"]);
  return data;
}

// Remove an OPEN (unfilled) position from a record. Soft-deletes the still-
// open demand rows by RA id — the server only touches rows that are still
// open (nobody assigned) and requires the manage-staff capability.
export async function removeOpenPosition(projectId: string, raIds: number[]) {
  const res = await fetchWithTimeout(`${API}/remove-open-position`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ProjectID: projectId, raIds }),
  }, 45_000);
  // Retry safety: if a previous attempt timed out client-side but landed on
  // the server, the slots are already gone and a retry gets 409 not_open.
  // That end state is exactly what the user asked for — surface it as
  // success (alreadyGone) instead of a scary failure alert.
  if (res.status === 409) {
    const body = await res.clone().json().catch(() => null) as { error?: string } | null;
    if (body?.error === "not_open") {
      bustCache(`project-allocations-full:${projectId}`);
      bustCache("resource-allocations:");
      // The slots really are gone server-side — sync pages just like the
      // normal success path below.
      notifyDataChanged(["allocation", "team", "demand"]);
      return { Status: true, removed: 0, alreadyGone: true };
    }
  }
  const data = await handleResponse(res) as { Status?: boolean; removed?: number; alreadyGone?: boolean };
  // Same local busts as removeTeamMember — open rows ride the project-team
  // payload and share caches with the allocation surfaces.
  bustCache(`project-allocations-full:${projectId}`);
  bustCache("resource-allocations:");
  // A removed open position must drop off the Demand tab, Home risk feed and
  // Alerts page immediately — broadcast on the unified bus.
  notifyDataChanged(["allocation", "team", "demand"]);
  return data;
}

export interface WeeklyHourEntry { week: string; hours: number }
export interface ProjectTeamMember {
  name: string; role: string; bu: string; memberBu?: string; title: string; dept?: string;
  /** Employee type from the staff profile ("Part-Time", "As Needed", …) — drives name color coding. */
  employeeType?: string;
  eacHrs: number; etcHrs: number; costRate: number; billingRate?: number; laborRate?: number; eacCost: number; etcCost: number;
  ncHrs: number; ncCost: number;
  pctAllocation: number; startDate: string; endDate: string;
  resourceId?: string;
  rwiId?: number | null;
  weeklyHours: WeeklyHourEntry[];
  /** Per-assignment-period detail (imports can assign the same person several
   *  periods at different %). The no-grid team table shows one row per period
   *  when a member has 2+. */
  slices?: { startDate: string; endDate: string; pct: number; hours: number; rwiId?: number | null }[];
  /** Allocation flags (OR across the member's allocation rows). Shown on the
   *  team card only when set; isLocked freezes the member against imports,
   *  schedule moves, and weekly-hours edits until unlocked. */
  softAllocation?: boolean;
  nonChargeable?: boolean;
  isLocked?: boolean;
  /** ra.CostRate written at "Mark NC" time — the explicit $/hr override for
   *  this member's non-chargeable cost. 0/absent = no override (falls back to
   *  the role's configured EmpCostRate). */
  ncRate?: number;
  /** Account state, included on team projections so inactive people remain identifiable. */
  enabled?: boolean;
  /** Owning tenant, required for account-management writes by a superadmin. */
  tenantId?: string;
}
export interface OpenRole {
  role: string; title: string; bu: string;
  eacHrs: number; etcHrs: number; pct: number;
  startDate: string; endDate: string;
  groupId: string; typeGuid: string;
  allocationId: number;
  // ResourceAllocation row IDs backing this open slot (RDS tenants). Passed
  // back on assign so the server consumes the demand rows the fill satisfies.
  raIds?: number[];
}
export interface ProjectTeamResponse {
  team: ProjectTeamMember[];
  openRoles: OpenRole[];
}
export async function getProjectTeam(projectID: string, fresh = false, lowPriority = false): Promise<ProjectTeamResponse> {
  // fresh=true — post-save refetch: bust the local entry AND tell the server
  // to bypass its per-worker cache (fresh=1), so an instant refetch can never
  // be served a pre-save snapshot by a cluster worker whose cache-bust IPC
  // hasn't landed yet.
  // lowPriority=true — list-page count/prefetch fan-outs (one call per visible
  // row) send bulk=1 so the server runs their cache-miss DB queries through a
  // small concurrency gate. Without it a big project list fires hundreds of
  // simultaneous 7-join queries that hog the shared DB pool and starve the
  // interactive detail-page team/schedule fetches (stuck "Loading team…").
  const key = `project:team:${projectID}`;
  const fetchTeam = () => cached(key, async () => {
    const res = await fetchWithTimeout(`${API}/project-team?projectID=${encodeURIComponent(projectID)}${fresh ? "&fresh=1" : ""}${lowPriority ? "&bulk=1" : ""}`,
      { headers: authHeaders() });
    const data = await handleResponse(res) as { team?: ProjectTeamMember[]; openRoles?: OpenRole[] };
    return { team: data?.team ?? [], openRoles: data?.openRoles ?? [] };
  });
  let result: ProjectTeamResponse;
  if (fresh) {
    const inFlight = freshProjectTeamInFlight.get(key);
    if (inFlight) {
      result = await inFlight;
    } else {
      bustCache(key);
      const request = fetchTeam();
      freshProjectTeamInFlight.set(key, request);
      void request.then(() => {
        if (freshProjectTeamInFlight.get(key) === request) freshProjectTeamInFlight.delete(key);
      }, () => {
        if (freshProjectTeamInFlight.get(key) === request) freshProjectTeamInFlight.delete(key);
      });
      result = await request;
    }
  } else {
    result = await fetchTeam();
  }
  // Empty results get a short cache window (30 s) rather than an immediate
  // bust.  This means:
  //   • The UI retry logic (max 1 fast-empty retry) still uses fresh data
  //     because the retry fires within 1.5 s — before the 30 s window expires.
  //   • Re-opening the same project within 30 s (e.g. back → forward) uses
  //     the cached empty result instead of re-spinning the server query.
  //   • After 30 s the cache is cleared so a member added via another tab/
  //     device shows up on the next full page load.
  if (!result.team || result.team.length === 0) {
    setTimeout(() => bustCache(key), 30_000);
  }
  return result;
}

export interface BulkAssignmentRow {
  project: string; ticketId: string; name: string; email: string; role: string; jobTitle: string; bu: string;
  minStart: string; maxEnd: string; totalHours: number;
}
export async function getBulkTeamAssignments(): Promise<BulkAssignmentRow[]> {
  return cached("bulk:team-assignments", async () => {
    const res = await fetchWithTimeout(`${API}/bulk-team-assignments`, { headers: authHeaders() });
    const data = await handleResponse(res) as { data?: BulkAssignmentRow[] };
    return data?.data ?? [];
  });
}

export interface BulkScheduleRow {
  project: string; ticketId: string; phaseName: string; phaseOrder: number;
  startDate: string; endDate: string; pctComplete: number;
}
export async function getBulkSchedule(): Promise<BulkScheduleRow[]> {
  return cached("bulk:schedule", async () => {
    const res = await fetchWithTimeout(`${API}/bulk-schedule`, { headers: authHeaders() });
    const data = await handleResponse(res) as { data?: BulkScheduleRow[] };
    return data?.data ?? [];
  });
}

export interface ActiveAllocation {
  projectId: string; projectName: string; pct: number; startDate: string; endDate: string;
}
export interface LiveResource {
  id: string; name: string; username: string; role: string;
  currentPct: number; totalProjects: number; allProjectIds: string[];
  activeProjects: string[]; activeAllocations: ActiveAllocation[];
  lastActiveDate: string | null;
}

export async function getTaskData(
  ticketID: string,
  baseLineID: string = "0",
  stageCount?: number,
  opts?: { fresh?: boolean },
) {
  const sc = stageCount && stageCount > 0 ? stageCount : 0;
  const key = `project:tasks:${ticketID}:${baseLineID}:${sc}`;
  const fetchTasks = async () => {
    let url = `${API}/task-data?ticketID=${encodeURIComponent(ticketID)}&baseLineID=${encodeURIComponent(baseLineID)}`;
    if (sc > 0) url += `&stageCount=${sc}`;
    if (opts?.fresh) url += "&fresh=1";
    const res = await fetchWithTimeout(url, { headers: authHeaders() });
    return handleResponse(res);
  };
  if (opts?.fresh) {
    bustCache(key);
    return fetchTasks();
  }
  return cached(key, fetchTasks);
}

export async function updateProjectSchedule(payload: {
  TicketID: string;
  ProjectLifecycleID: string;
  ProjectScheduleExists: boolean;
  TargetStartDate: string;
  TargetCompletionDate: string;
  ActualStartDate?: string;
  ActualCompletionDate?: string;
  BidDueDate?: string;
  Tasks: unknown[] | null;
}) {
  const res = await fetchWithTimeout(`${API}/schedule`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await handleResponse(res) as Record<string, unknown>;
  if (data && data.Status === false) {
    const msg = data.ErrorMessages || data.Message || data.error || "Schedule update rejected by server";
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  if (data && typeof data.raw === "string" && data.raw.toLowerCase().includes("error")) {
    throw new Error(data.raw);
  }
  // Schedule changed → invalidate every per-project cache so the
  // detail page re-fetches details / tasks on next open.
  bustCache("project:");
  return data;
}

export async function getProjectDivisionRoles(ticketID: string, opts?: { fresh?: boolean }) {
  const key = `project:divisionRoles:${ticketID}`;
  // fresh (post-save reload): drop the local cache entry so cached() actually
  // refetches, and send fresh=1 so the server bypasses ITS per-worker cache
  // too. Without both, the BU section redisplayed the pre-save list.
  if (opts?.fresh) _cache.delete(key);
  return cached(key, async () => {
    const res = await fetchWithTimeout(
      `${API}/project-division-roles?ticketID=${encodeURIComponent(ticketID)}${opts?.fresh ? "&fresh=1" : ""}`,
      { headers: authHeaders() });
    return handleResponse(res);
  });
}

/** Per-BU roles editor (Business Units table): PM / Executive / Contact names
 *  and supporting-BU contract values. divisionKey = division id, or
 *  "name:<lower>" for text-fallback rows (the server sends DivisionKey). */
export async function updateProjectDivisionRoles(
  ticketID: string,
  divisionKey: string,
  patch: { pm?: string; exec?: string; contact?: string; contractValue?: number },
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetchWithTimeout(`${API}/project-division-roles/update`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ticketID, divisionKey, patch }),
  });
  const data = (await handleResponse(res)) as { ok: boolean; error?: string };
  // A primary-row contract value writes the RECORD's contract value → the
  // details card and grids must not keep the stale number.
  _cache.delete(`project:divisionRoles:${ticketID}`);
  if (patch.contractValue !== undefined) {
    bustCache("project:");
    bustCache("projects:");
    bustCache("module:");
  }
  return data;
}

export async function getBillingRates(projectID: string, divisionIds: string = "0") {
  return cached(`project:billingRates:${projectID}:${divisionIds}`, async () => {
    const res = await fetchWithTimeout(
      `${API}/billing-rates?projectID=${encodeURIComponent(projectID)}&divisionIds=${encodeURIComponent(divisionIds)}`,
      { headers: authHeaders() });
    return handleResponse(res);
  });
}

export async function updateHoursAllocation(body: {
  ProjectID: string;
  OverrideAllocations?: boolean;
  IsAllocationSplitted?: boolean;
  IsMiscellaneousAllocation?: boolean;
  CalledFrom?: string;
  TaskId?: number;
  Allocations: Record<string, unknown>[];
}) {
  const res = await fetchWithTimeout(`${API}/hours-allocation`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      OverrideAllocations: false,
      IsAllocationSplitted: false,
      IsMiscellaneousAllocation: false,
      CalledFrom: "WeeklyTeamTab",
      TaskId: 0,
      ...body,
    }),
  });
  const data = await handleResponse(res);
  // Scoped invalidation: a weekly-hours save only changes THIS project's
  // allocation data. The old broad bustCache("project:") dropped every
  // cached project's details/team/tasks app-wide, forcing a wave of
  // refetches that made the app feel slow right after every save. Keep
  // resource-allocations: global (person-centric views span projects).
  bustCache("project:allocations:" + body.ProjectID);
  bustCache("project:team:" + body.ProjectID);
  bustCache("project:details:" + body.ProjectID);
  bustCache("project-allocations-full:" + body.ProjectID);
  bustCache("resource-allocations:");
  notifyAllocationChanged();
  // The server refuses to save hours for anyone with no active assignment on
  // the record (it used to silently CREATE one, resurrecting just-removed
  // members from stale payloads). A fully-refused save already comes back as
  // an error; a partial refusal (multi-person payload) returns 200 with
  // skippedNotOnTeam — surface it as a hard error so no caller reports a
  // partial save as success.
  const skipped = (data as { skippedNotOnTeam?: string[] } | null)?.skippedNotOnTeam;
  if (Array.isArray(skipped) && skipped.length > 0) {
    throw new Error(
      "Some hours were not saved — the following people no longer have an assignment on this record: "
      + skipped.join(", ") + ". Refresh the page and try again.",
    );
  }
  return data;
}

// Set or clear ONE allocation flag for a member on one project:
// "soft" = SoftAllocation, "nc" = NonChargeable, "locked" = IsLocked.
// Server gate: admins/managers or a custom level with manage-staff.
// costRate ($/hr) is only used when flag="nc" and value=true — written to
// ra.CostRate so the Financial analytics shows a dollar figure immediately.
export async function setAllocationFlag(
  projectId: string, resourceGuid: string,
  flag: "soft" | "nc" | "locked", value: boolean,
  costRate?: number,
) {
  const body: Record<string, unknown> = { ProjectID: projectId, ResourceGuid: resourceGuid, Flag: flag, Value: value };
  if (flag === "nc" && costRate != null && isFinite(costRate) && costRate >= 0) body.CostRate = costRate;
  const res = await fetchWithTimeout(`${API}/allocation-flag`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await handleResponse(res);
  // Same scoped invalidation set as a weekly-hours save — every surface that
  // renders this project's allocation rows drops its cached copy.
  bustCache("project:allocations:" + projectId);
  bustCache("project:team:" + projectId);
  bustCache("project:details:" + projectId);
  bustCache("project-allocations-full:" + projectId);
  bustCache("resource-allocations:");
  notifyAllocationChanged();
  return data;
}

// Lock or unlock a member's allocation on one project (IsLocked flag).
// Locked allocations are frozen against automatic changes — imports skip
// them, schedule moves leave them in place, weekly-hours saves reject.
// Server gate: admins/managers or a custom level with manage-staff.
export async function setAllocationLock(projectId: string, resourceGuid: string, locked: boolean) {
  const res = await fetchWithTimeout(`${API}/allocation-lock`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ProjectID: projectId, ResourceGuid: resourceGuid, IsLocked: locked }),
  });
  const data = await handleResponse(res);
  // Same scoped invalidation set as a weekly-hours save — every surface that
  // renders this project's allocation rows drops its cached copy.
  bustCache("project:allocations:" + projectId);
  bustCache("project:team:" + projectId);
  bustCache("project:details:" + projectId);
  bustCache("project-allocations-full:" + projectId);
  bustCache("resource-allocations:");
  notifyAllocationChanged();
  return data;
}

// Create an open position (unfilled headcount slot) on a project or
// opportunity. Server inserts a ResourceUser-NULL ResourceAllocation row that
// surfaces on the team card, Demand tab and projects grid.
export async function addOpenPosition(payload: {
  ProjectID: string;
  Role: string;
  JobTitleId?: number;
  StartDate?: string;
  EndDate?: string;
  TotalHours?: number;
}): Promise<{ Status?: boolean; ID?: number; error?: string }> {
  const res = await fetchWithTimeout(`${API}/open-position`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 30000);
  const data = await handleResponse(res) as { Status?: boolean; ID?: number; error?: string };
  bustCache(`project:team:${payload.ProjectID}`);
  bustCache("resource-demands");
  // New open position = new demand row on the team card, Demand tab and the
  // Home/Alerts risk surfaces — broadcast membership + demand scopes.
  notifyDataChanged(["allocation", "team", "demand"]);
  return data;
}

/** Bulk-copy a full team onto a brand-new project (Opp→Project conversion).
 *  One HTTP call → two SQL round-trips server-side instead of one call per
 *  member. The destination project must have no existing team. */
export async function bulkCopyTeam(payload: {
  destProjectId: string;
  members: Array<{
    resourceId: string; name: string;
    role?: string | null; title?: string | null; bu?: string | null;
    startDate?: string | null; endDate?: string | null;
    hours?: number; divisionId?: string | null;
  }>;
  defaultStart?: string;
  defaultEnd?: string;
}): Promise<{ ok: true; written: number; failed: string[] } | { ok: false; error: string }> {
  const res = await fetchWithTimeout(`${API}/bulk-copy-team`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json() as { ok: boolean; written?: number; failed?: string[]; error?: string };
  if (!res.ok) throw new Error(data.error || `bulk-copy-team failed (${res.status})`);
  bustCache("project:");
  bustCache("project-allocations-full:");
  notifyDataChanged(["allocation", "team", "demand"]);
  return data as { ok: true; written: number; failed: string[] };
}

export async function assignResource(payload: {
  ProjectID: string; Allocations: Record<string, unknown>[];
  // When the assignment fills an open position, the RA demand-row IDs to
  // consume (soft-delete) server-side after the assignment saves.
  ConsumeOpenSlotRaIds?: number[];
  // Quick Actions duplicate-role guard: the server must not best-effort match
  // an open slot when an explicit selection was required but not made.
  RequireOpenSlotSelection?: boolean;
  // Record-aware callers pass their resolved "member dates must stay within
  // the phase-schedule window" flag (per-record display-mode overrides live
  // in client storage, so the server can't see them). Omit when the caller
  // has no record context — the server then falls back to the tenant's
  // display mode for the record's module. Tighten-only server-side: `true`
  // enforces, `false` cannot disable the server-derived gate (a per-device
  // layout preference must not change what data the tenant accepts).
  ScheduleWindowEnabled?: boolean;
}): Promise<string> {
  const res = await fetchWithTimeout(`${API}/assign-resource`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const txt = await res.text();
  if (!res.ok && !txt.toLowerCase().includes("allocationoutofbounds")) {
    throw new Error(`(${res.status}) ${txt.slice(0, 200)}`);
  }
  bustCache("project:");
  bustCache("project-allocations-full:");
  // Membership changed (and possibly consumed an open slot) — broadcast the
  // full scope set so Home, Alerts, Demand, Resources and Project Detail all
  // refetch immediately whether they're mounted now or opened next.
  notifyDataChanged(["allocation", "team", "demand"]);
  return txt;
}

/* ─────────────────  PEOPLE / SEARCH  ───────────────── */

/** Org-wide people directory entry (for email recipient autocomplete).
 * Field names match exactly what the api-server `/people-search` route emits
 * (lowercase) so the recipient picker can render avatar / project-count chips
 * the same way the mobile app does. */
export interface PeopleSearchEntry {
  name: string;
  email: string;
  source: "user" | "contact";
  title?: string;
  company?: string;
  projectCount?: number;
  guid?: string;
  [key: string]: unknown;
}
export async function searchPeople(q: string, limit = 25): Promise<PeopleSearchEntry[]> {
  try {
    const res = await fetchWithTimeout(
      `${API}/people-search?q=${encodeURIComponent(q || "")}&limit=${limit}`,
      { headers: authHeaders() });
    if (!res.ok) return [];
    const raw = await res.json() as { results?: any[] };
    const arr = Array.isArray(raw?.results) ? raw.results : [];
    return arr
      .map((r: any): PeopleSearchEntry => ({
        name: String(r.name ?? ""),
        email: String(r.email ?? ""),
        source: r.source === "user" ? "user" : "contact",
        title: r.title ? String(r.title) : undefined,
        company: r.company ? String(r.company) : undefined,
        projectCount: typeof r.projectCount === "number" ? r.projectCount : undefined,
        guid: r.guid ? String(r.guid) : undefined,
      }))
      .filter((e) => e.name && e.email);
  } catch (e) {
    console.warn("[api] searchPeople failed:", String(e));
    return [];
  }
}

/** Same as getTaskData but also surfaces the X-Lifecycle-Id response header.
 * Used by the email-draft editor to expand [SCHEDULE_TABLE:projectId] tags
 * into inline markdown tables before sending. */
export async function getTaskDataWithLifecycle(ticketID: string, baseLineID: string = "0") {
  const url = `${API}/task-data?ticketID=${encodeURIComponent(ticketID)}&baseLineID=${encodeURIComponent(baseLineID)}`;
  const res = await fetchWithTimeout(url, { headers: authHeaders() });
  const lifecycleId = res.headers.get("X-Lifecycle-Id") ?? "";
  const data = await handleResponse(res);
  return { data, lifecycleId };
}

export interface PersonProjectEntry {
  TicketId: string; Title: string; Role?: string; PctAllocation?: number;
  StartDate?: string; EndDate?: string; [key: string]: unknown;
}
export async function getPersonProjects(opts: { email?: string; guid?: string }) {
  const p = new URLSearchParams();
  if (opts.email) p.append("email", opts.email);
  if (opts.guid) p.append("guid", opts.guid);
  const res = await fetchWithTimeout(`${API}/people-projects?${p.toString()}`,
    { headers: authHeaders() });
  return handleResponse(res) as Promise<{ ok: boolean; projects: PersonProjectEntry[]; error?: string }>;
}

/* ─────────────────  CHAT (LLM)  ───────────────── */

// Server emits SSE events: each is `data: {json}\n\n`. The JSON payload is
// one of several shapes — text deltas, sidecar structured data (roster,
// oppTable, pmmTable, personProfile), or control events (error, done).
export interface RosterPerson { n: string; p: number; t: number; r?: string; }
export interface OppRow { opmId: string; pmmId: string; name: string; value: string; city: string; status?: string; }
export interface PmmRow { id: string; name: string; value: string; city: string; status: string; }
export interface PersonProfile {
  name: string;
  status: string;
  avgPct: number;
  periodRange: string;
  mode: string;
  weeks: { period: string; pct: number; hours?: number }[];
  projects?: { projectId: string; projectName: string; pct: number; role: string; startDate: string; endDate: string; isCurrent: boolean }[];
  jobTitle?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactCompany?: string;
}

export type ChatStreamEvent =
  | { type: "content"; text: string }
  | { type: "token"; text: string }
  | { type: "roster"; data: RosterPerson[] }
  | { type: "oppTable"; data: { title: string; rows: OppRow[]; summary: string } }
  | { type: "oppTable2"; data: { title: string; rows: OppRow[]; summary: string } }
  | { type: "pmmTable"; data: { title: string; rows: PmmRow[]; summary: string } }
  | { type: "personProfile"; data: PersonProfile }
  | { type: "cacheBust"; projectId?: string }
  | { type: "status"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

export async function chatStream(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
  onEvent: (e: ChatStreamEvent) => void,
  signal?: AbortSignal,
  /**
   * Optional payload extras for full mobile parity. The mobile chat sends a
   * friendly `displayName` (DisplayName/FullName/FirstName from the profile),
   * a per-session `hiddenContext` block (used to attach email-thread context
   * to a reply turn — see `[THREAD_CONTEXT_START]` / `[REPLY_INSTRUCTIONS]`
   * blocks in mobile chat.tsx), and optional `imageAttachments`. The server
   * already accepts all three (artifacts/api-server/src/routes/chat.ts:7871).
   * Web only currently uses `displayName`; the other two are wired so future
   * web email-reply flows can drop straight in.
   */
  extras?: {
    displayName?: string;
    hiddenContext?: string;
    imageAttachments?: Array<{ filename: string; dataUrl: string }>;
    /** Snapshot of what the user is currently looking at on the home
     *  dashboard — the active role, time window, sub-driver tile values,
     *  risk feed and recommended actions. Forwarded to api-server so the
     *  LLM can ground answers in the exact rows the user sees. */
    dashboardContext?: string;
  },
): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY) ?? "";
  const username = localStorage.getItem(USERNAME_KEY) ?? "";
  const displayName = (extras?.displayName ?? "").trim() || username;
  const body: Record<string, unknown> = { messages, token, username, displayName };
  if (extras?.hiddenContext) body.hiddenContext = extras.hiddenContext;
  if (extras?.imageAttachments && extras.imageAttachments.length > 0) {
    body.imageAttachments = extras.imageAttachments;
  }
  if (extras?.dashboardContext) body.dashboardContext = extras.dashboardContext;
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  if (signal instanceof AbortSignal) {
    init.signal = signal;
  }
  const t0 = Date.now();
  console.log("[chatStream] POST /api/chat/message …", { msgs: messages.length });

  // Transparent retry for transient edge/proxy rejections that happen BEFORE
  // any SSE bytes flow. In production we occasionally see the deployment
  // proxy return a generic HTML "403 Forbidden" page (or 502/503/504) on the
  // initial POST — usually when the autoscale instance is cold or the edge
  // briefly mis-routes a long-running streaming request. The api-server
  // itself never emits 403 for /api/chat/message, so any 403 here is safe to
  // retry. Retry up to 2 times with backoff. Skip retry if the user aborted.
  const TRANSIENT = new Set([403, 502, 503, 504]);
  let res!: Response;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      res = await fetch(`/api/chat/message`, init);
    } catch (fetchErr) {
      // fetch() itself threw (TypeError: "Failed to fetch" / "network error"):
      // no Response was obtained, so the request almost certainly never reached
      // the server — same transient class as the 403/502/503/504 retries below,
      // and safe to retry without risking duplicate server-side actions.
      if (signal?.aborted) throw fetchErr;
      if (attempt >= 2) {
        console.warn("[chatStream] network failure after retries:", fetchErr);
        throw new Error("Couldn't reach the server — please check your connection and try again.");
      }
      attempt += 1;
      const retryDelay = 400 * attempt; // 400ms, then 800ms
      console.warn(`[chatStream] fetch threw (${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}) — retrying in ${retryDelay}ms (attempt ${attempt}/2)`);
      await new Promise((r) => setTimeout(r, retryDelay));
      continue;
    }
    console.log("[chatStream] response status", res.status, "in", Date.now() - t0, "ms", attempt > 0 ? `(retry ${attempt})` : "");
    if (res.ok || !TRANSIENT.has(res.status) || attempt >= 2) break;
    if (signal?.aborted) break;
    attempt += 1;
    const delay = 400 * attempt; // 400ms, then 800ms
    console.warn(`[chatStream] transient ${res.status} — retrying in ${delay}ms (attempt ${attempt}/2)`);
    try { await res.body?.cancel(); } catch { /* noop */ }
    await new Promise((r) => setTimeout(r, delay));
  }

  if (res.status === 401) {
    await res.body?.cancel().catch(() => {});
    throw Object.assign(new Error("Your session has expired. Please log in again."), { code: "SESSION_EXPIRED" });
  }
  if (!res.ok || !res.body) {
    throw new Error(`Chat request failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedAnyBytes = false;
  let receivedAnyEvent = false;
  let lastByteAt = Date.now();
  let lastEventAt = Date.now();
  let firstByteLogged = false;

  // Two-tier watchdog:
  //   • If NO bytes at all for 15s → workspace iframe is buffering the SSE
  //     stream (server heartbeats don't even reach us). Surface the
  //     "open in new tab" hint right away.
  //   • If bytes are flowing (heartbeats every 5s) but NO real `data:` event
  //     for 60s → genuine server stall (e.g. upstream LLM/tool hang).
  const NO_BYTES_STALL_MS = 15_000;
  const NO_EVENT_STALL_MS = 60_000;
  const stallTimer = setInterval(() => {
    const sinceByte = Date.now() - lastByteAt;
    const sinceEvent = Date.now() - lastEventAt;
    const noBytes = !receivedAnyBytes && sinceByte > NO_BYTES_STALL_MS;
    const noEvent = receivedAnyBytes && sinceEvent > NO_EVENT_STALL_MS;
    if (noBytes || noEvent) {
      clearInterval(stallTimer);
      console.warn("[chatStream] stalled", { sinceByte, sinceEvent, receivedAnyBytes, receivedAnyEvent });
      try { reader.cancel(); } catch { /* noop */ }
      onEvent({
        type: "error",
        message: noBytes
          ? "The reply is being generated but the workspace preview is buffering the stream. Click the “Open in new tab” icon in the chat header to view the live response."
          : "The response stalled. Please try again.",
      });
    }
  }, 3_000);

  const emit = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.error) { onEvent({ type: "error", message: String(parsed.error) }); return; }
      if (parsed.done) { onEvent({ type: "done" }); return; }
      if (parsed.cache_bust) { onEvent({ type: "cacheBust", projectId: typeof parsed.project_id === "string" ? parsed.project_id : undefined }); return; }
      if (parsed.roster) { onEvent({ type: "roster", data: parsed.roster as RosterPerson[] }); return; }
      if (parsed.oppTable) { onEvent({ type: "oppTable", data: parsed.oppTable as { title: string; rows: OppRow[]; summary: string } }); return; }
      if (parsed.oppTable2) { onEvent({ type: "oppTable2", data: parsed.oppTable2 as { title: string; rows: OppRow[]; summary: string } }); return; }
      if (parsed.pmmTable) { onEvent({ type: "pmmTable", data: parsed.pmmTable as { title: string; rows: PmmRow[]; summary: string } }); return; }
      if (parsed.personProfile) { onEvent({ type: "personProfile", data: parsed.personProfile as PersonProfile }); return; }
      if (typeof parsed.status === "string") { onEvent({ type: "status", text: parsed.status }); return; }
      if (typeof parsed.token === "string" && parsed.token) {
        onEvent({ type: "token", text: parsed.token });
      }
      if (typeof parsed.content === "string" && parsed.content) {
        onEvent({ type: "content", text: parsed.content });
      }
    } catch {
      // ignore unparseable lines (heartbeats, etc.)
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedAnyBytes = true;
      lastByteAt = Date.now();
      if (!firstByteLogged) {
        firstByteLogged = true;
        console.log("[chatStream] first byte after", Date.now() - t0, "ms (", value?.byteLength ?? 0, "bytes )");
      }
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by blank lines
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const evt = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        // Each event may have multiple lines; we only consume `data:` lines
        let sawData = false;
        for (const line of evt.split("\n")) {
          if (line.startsWith("data: ")) { sawData = true; emit(line.slice(6).trim()); }
          else if (line.startsWith("data:")) { sawData = true; emit(line.slice(5).trim()); }
        }
        if (sawData) {
          receivedAnyEvent = true;
          lastEventAt = Date.now();
        }
      }
    }
    // flush any final buffered event
    if (buffer.trim()) {
      for (const line of buffer.split("\n")) {
        if (line.startsWith("data: ")) emit(line.slice(6).trim());
        else if (line.startsWith("data:")) emit(line.slice(5).trim());
      }
    }
  } catch (readErr) {
    // The SSE connection died mid-stream (proxy drop, instance recycle,
    // network blip). Do NOT auto-retry here — the server may already be
    // executing side-effectful tools (assign person, send email); surface a
    // friendly error and let the user decide whether to resend.
    if (signal?.aborted) throw readErr;
    console.warn("[chatStream] stream read failed:", readErr);
    throw new Error("The connection dropped while the reply was streaming — please try again.");
  } finally {
    clearInterval(stallTimer);
    console.log("[chatStream] finished in", Date.now() - t0, "ms; events:", receivedAnyEvent, "bytes:", receivedAnyBytes);
  }
}

/* ─────────────────  CARD AI INSIGHTS  ───────────────── */

export type InsightSeverity = "red" | "amber" | "green";
export type InsightKind = "project" | "opportunity" | "lead" | "staff" | "demand";
export interface CardInsight { severity: InsightSeverity; text: string }

const INSIGHT_TIMEOUT_MS = 90_000;
// Smaller chunks → multiple parallel requests, each finishing well under
// the timeout; the cache fills incrementally so partial failures still
// progress the UI.
export const INSIGHT_MAX_PER_REQUEST = 12;

/** Fetch a single chunk's worth of insights. Caller owns chunking & merging. */
export async function fetchCardInsightsChunk(
  kind: InsightKind,
  records: { id: string; fields: Record<string, unknown> }[],
): Promise<Record<string, CardInsight>> {
  if (records.length === 0) return {};
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), INSIGHT_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/insights/card-insights`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ kind, records }),
      signal: ctrl.signal,
    });
    if (!res.ok) return {};
    const data = await res.json() as { insights?: Record<string, CardInsight> };
    return data.insights ?? {};
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────  INBOX  ───────────────── */

export interface InboxMessage {
  id: string;
  threadId?: string;
  subject: string;
  from: { name?: string; address: string };
  preview: string;
  receivedAt: string;
  isRead?: boolean;
  hasAttachments?: boolean;
}

export async function getInboxMessages(): Promise<InboxMessage[]> {
  const res = await fetchWithTimeout(`/api/agent-inbox/messages`, { headers: authHeaders() });
  if (!res.ok) return [];
  const data = await res.json() as { messages?: InboxMessage[] };
  return data.messages ?? [];
}

/* ─────────────────  SUPPORT LOOKUPS  ───────────────── */

export async function getDivisions(tenantId?: string) {
  // Tenant-scoped key: superadmins can fetch other tenants' org lists — a
  // shared key would serve the previous tenant's divisions after a switch.
  return cached(tenantId ? `divisions:t:${tenantId}` : "divisions", async () => {
    const url = tenantId ? `${API}/divisions?tenantId=${encodeURIComponent(tenantId)}` : `${API}/divisions`;
    const res = await fetchWithTimeout(url, { headers: authHeaders() }, 15_000);
    return handleResponse(res) as Promise<{ ID: number; Title: string; ShortName: string | null; BusinessUnitIdLookup?: string | null }[]>;
  });
}

export async function getUsers() {
  return cached("users", async () => {
    const res = await fetchWithTimeout(`${API}/users`, { headers: authHeaders() });
    // Server also sends email/username (people pickers use them to
    // disambiguate duplicate display names; the actuals-import pre-check
    // matches on them the same way the server-side importer does).
    return handleResponse(res) as Promise<{ id: string; name: string; email?: string; username?: string; enabled?: boolean }[]>;
  });
}

export async function getUserList() {
  return cached("user-list", async () => {
    const res = await fetchWithTimeout(`${API}/user-list`, { headers: authHeaders() });
    return handleResponse(res) as Promise<Record<string, unknown>[]>;
  });
}

export interface DuplicateNameGroup {
  name: string;
  accounts: { id: string; name: string; email: string; username: string }[];
}

/** Returns groups of enabled accounts that share the same login identity.
 *  Different accounts with the same display name are valid and are not
 *  returned; email is canonical and username is the legacy fallback. */
export async function getDuplicateStaffNames(): Promise<DuplicateNameGroup[]> {
  const res = await fetchWithTimeout(`${API}/duplicate-staff-names`, { headers: authHeaders() });
  return handleResponse(res) as Promise<DuplicateNameGroup[]>;
}

/* ── Client-official assignment cascade: BU → Role → Title → Person ── */

export type AssignRole = { id: string; name: string };
export type AssignTitle = { id: string; name: string; department?: string; departmentId?: string };
export type AssignResource = { id: string; name: string; title: string };

/**
 * Build title picker options. Distinct JobTitle records are kept separate (two
 * "Architect" titles in different departments stay as two options), and when a
 * name is duplicated we disambiguate it with the department, e.g.
 * "Architect — Commercial" / "Architect — Residential".
 */
export function buildTitleOptions(titles: AssignTitle[]): { id: string; name: string; label: string }[] {
  const counts = new Map<string, number>();
  for (const t of titles) {
    const n = (t.name || "").trim().toLowerCase();
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const out: { id: string; name: string; label: string }[] = [];
  for (const t of titles) {
    const n = (t.name || "").trim();
    const id = String(t.id || "").trim();
    if (!n || !id || seen.has(id)) continue;
    seen.add(id);
    const dup = (counts.get(n.toLowerCase()) ?? 0) > 1;
    const dept = (t.department || "").trim();
    out.push({ id, name: n, label: dup && dept ? `${n} — ${dept}` : n });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

/** Roles for a chosen Business Unit (DivisionIdLookup). */
export async function getRolesByBU(divisionIdLookup: string, tenantId?: string) {
  // tenantId: superadmin viewing another company (Edit Staff modal) — must be
  // part of the cache key or one company's roles would be served to another.
  return cached(`assign:roles:${divisionIdLookup}${tenantId ? `:${tenantId}` : ""}`, async () => {
    const tenantSuffix = tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : "";
    const res = await fetchWithTimeout(
      `${API}/assign/roles-by-bu?divisionIdLookup=${encodeURIComponent(divisionIdLookup)}${tenantSuffix}`,
      { headers: authHeaders() });
    return handleResponse(res) as Promise<AssignRole[]>;
  });
}

/** Job Titles for a chosen Division + Role, optionally scoped to a specific Department. */
export async function getJobTitlesByRole(divisionIdLookup: string, roleLookup?: string, departmentId?: string) {
  const roleSuffix = roleLookup ? `:${roleLookup}` : "";
  const deptSuffix = departmentId ? `:${departmentId}` : "";
  return cached(`assign:titles:${divisionIdLookup}${roleSuffix}${deptSuffix}`, async () => {
    const roleParam = roleLookup ? `&roleLookup=${encodeURIComponent(roleLookup)}` : "";
    const deptParam = departmentId ? `&departmentId=${encodeURIComponent(departmentId)}` : "";
    const res = await fetchWithTimeout(
      `${API}/assign/job-titles?divisionIdLookup=${encodeURIComponent(divisionIdLookup)}${roleParam}${deptParam}`,
      { headers: authHeaders() });
    return handleResponse(res) as Promise<AssignTitle[]>;
  });
}

export interface PersonOrgDefaults {
  found: boolean;
  personId?: string;
  businessUnit?: string;
  divisionName?: string;
  divisionId?: string;
  departmentName?: string;
  departmentId?: string;
  roleName?: string;
  roleId?: string;
  titleName?: string;
  jobTitleId?: string;
}

/**
 * Existing Business Unit / Division / Role / Title for a person who already
 * has an established staff record — used to PREFILL (and lock) the
 * Assignment Setup card so the client doesn't re-pick org placement for
 * someone already on staff. Returns { found: false } for brand-new people.
 */
export async function getPersonOrgDefaults(name: string): Promise<PersonOrgDefaults> {
  const res = await fetchWithTimeout(
    `${API}/assign/person-org?name=${encodeURIComponent(name)}`,
    { headers: authHeaders() });
  return handleResponse(res) as Promise<PersonOrgDefaults>;
}

/** Add a new role to the tenant catalogue. Returns the created (or existing) role. */
export async function createRole(name: string): Promise<AssignRole> {
  const res = await fetchWithTimeout(`${API}/assign/roles`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await handleResponse(res) as AssignRole;
  bustCache("assign:roles");
  // A new role also appears on the Billing Rates screen, so its list cache
  // must refresh on next load (createRole is idempotent — returns an existing
  // role unchanged, in which case this bust is simply a no-op).
  bustCache("role-billing-rates-v2");
  return data;
}

/** Add a new job title to the tenant catalogue, optionally scoped to a department. */
export async function createJobTitle(title: string, departmentId?: string, roleId?: string): Promise<{ id: string; name: string }> {
  const res = await fetchWithTimeout(`${API}/assign/job-titles`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ title, departmentId, roleId }),
  });
  const data = await handleResponse(res) as { id: string; name: string };
  bustCache("job-titles");
  // Job-title pickers (Add Staff / Edit Staff / assignment flows) cache under
  // "assign:titles:*" — bust those too or a newly created title stays missing
  // from the pickers until the 5-minute TTL expires.
  bustCache("assign:titles");
  return data;
}

/** People (resources) for a chosen Job Title. */
export async function getResourcesByJobTitle(jobTitleLookup: string) {
  return cached(`assign:resources:${jobTitleLookup}`, async () => {
    const res = await fetchWithTimeout(
      `${API}/assign/resources?jobTitleLookup=${encodeURIComponent(jobTitleLookup)}`,
      { headers: authHeaders() });
    return handleResponse(res) as Promise<AssignResource[]>;
  });
}

/* ── Billing rates: per-role client rate. Company-wide default lives on
 * core2.dbo.Roles.BillingRate; a per-department override lives on
 * core2.dbo.RoleBillingRateByDept. When a department is selected the screen
 * edits that department's override and `defaultRate` carries the company-wide
 * fallback for display. Rates include those auto-filled by the onboarding
 * default-rate setting. ── */
export type RoleBillingRate = { id: string; name: string; billingRate: number | null; defaultRate?: number | null; laborRate?: number | null; defaultLaborRate?: number | null; costRate?: number | null; defaultCostRate?: number | null };
export type BillingRatesPayload = { rates: RoleBillingRate[]; hasDeptRates: boolean };

// IN-MEMORY seed for the COMPANY-WIDE role rates so the Budget & Costs
// section renders financials instantly on revisit (record→record nav, section
// remounts) instead of waiting for the network round-trip. Deliberately NOT
// persisted to localStorage — customer financial data must never live in
// browser storage (zero-browser-storage requirement; see the startup purge
// above). A full page reload starts cold, which is fine: the server-side SWR
// cache answers the fetch in a few ms. Keyed by tenant-scoped key BY
// CONSTRUCTION so a tenant switch on the same browser never shows another
// company's rates. Only non-empty payloads are ever seeded (a failure- or
// empty-response must never become a seed), and every rate write clears it so
// a stale seed can't outlive a save.
const roleRatesSeedMem = new Map<string, BillingRatesPayload>();

function roleRatesSeedKey(): string {
  return tenantScopedKey("rmone:roleRatesSeed:v1");
}

/** Synchronous in-memory seed for company-wide role rates (may be stale —
 *  callers must still fetch and silently reconcile). Null when absent. */
export function getRoleBillingRatesSeed(): BillingRatesPayload | null {
  const p = roleRatesSeedMem.get(roleRatesSeedKey());
  if (!p || !Array.isArray(p.rates) || p.rates.length === 0) return null;
  return p;
}

function persistRoleRatesSeed(p: BillingRatesPayload): void {
  // Never seed an empty rates list — an outage or a brand-new tenant must
  // not plant a seed that suppresses the real loading state later.
  if (!p || !Array.isArray(p.rates) || p.rates.length === 0) return;
  roleRatesSeedMem.set(roleRatesSeedKey(), p);
}

function clearRoleRatesSeed(): void {
  roleRatesSeedMem.delete(roleRatesSeedKey());
}

/** All roles with their client billing rate (null = not set). Pass a
 *  departmentId to load that department's per-role overrides instead of the
 *  company-wide default. Returns rates + hasDeptRates flag (false = this
 *  tenant has no per-dept table; show company-wide only). */
export async function getRoleBillingRates(departmentId?: string): Promise<BillingRatesPayload> {
  const dep = (departmentId ?? "").trim();
  const key = dep ? `role-billing-rates-v2:dept:${dep}` : "role-billing-rates-v2";
  return cached(key, async () => {
    const url = dep
      ? `${API}/role-billing-rates?departmentId=${encodeURIComponent(dep)}`
      : `${API}/role-billing-rates`;
    const res = await fetchWithTimeout(url, { headers: authHeaders() });
    const payload = await (handleResponse(res) as Promise<BillingRatesPayload>);
    // Refresh the persisted seed on every successful COMPANY-WIDE fetch so the
    // next Budget & Costs mount renders financials without waiting.
    if (!dep) persistRoleRatesSeed(payload);
    return payload;
  });
}

/** Set (or clear, with null) a single role's billing rate. Pass a departmentId
 *  to set that department's override instead of the company-wide default. */
export async function saveRoleBillingRate(roleId: string, billingRate: number | null, departmentId?: string): Promise<{ ok: boolean }> {
  const dep = (departmentId ?? "").trim();
  const res = await fetchWithTimeout(`${API}/role-billing-rate`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(dep ? { roleId, billingRate, departmentId: dep } : { roleId, billingRate }),
  });
  const data = await handleResponse(res) as { ok: boolean };
  bustCache("role-billing-rates-v2");
  clearRoleRatesSeed();
  // Team-member EAC/ETC cost is derived from these role rates server-side and
  // cached under project:* / projects:*, so clear those too or the cards keep
  // showing the old cost until the 5-min TTL expires.
  bustCache("project:");
  bustCache("projects:");
  // Broadcast to any already-mounted page (same tab) and other tabs via
  // localStorage so they silently re-fetch without needing a manual reload.
  try { window.dispatchEvent(new CustomEvent("rmone:billingRatesChanged")); } catch { /* SSR/non-browser */ }
  try { localStorage.setItem("rmone:ratesTs", String(Date.now())); } catch { /* storage unavailable */ }
  return data;
}

/** Set (or clear) dept-specific labor/cost/billing rates for a role+department. */
export async function saveRoleRatesByDept(
  roleId: string,
  departmentId: string,
  fields: { laborRate?: number | null; costRate?: number | null; billingRate?: number | null },
): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`${API}/role-rates-by-dept`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ roleId, departmentId, ...fields }),
  });
  const data = await handleResponse(res) as { ok: boolean };
  bustCache("role-billing-rates-v2");
  clearRoleRatesSeed();
  bustCache("project:");
  bustCache("projects:");
  try { window.dispatchEvent(new CustomEvent("rmone:billingRatesChanged")); } catch { /* SSR */ }
  try { localStorage.setItem("rmone:ratesTs", String(Date.now())); } catch { /* storage */ }
  return data;
}

/** Set (or clear) a role's Labor Rate and/or Cost Rate. */
export async function saveRoleRates(roleId: string, fields: { laborRate?: number | null; costRate?: number | null }): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`${API}/role-rates`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ roleId, ...fields }),
  });
  const data = await handleResponse(res) as { ok: boolean };
  bustCache("role-billing-rates-v2");
  clearRoleRatesSeed();
  // Labor/cost rates feed project financial cards (cached under project:* /
  // projects:*) — clear those and broadcast, exactly like saveRoleBillingRate
  // and saveRoleRatesByDept, so already-mounted pages silently re-fetch.
  bustCache("project:");
  bustCache("projects:");
  try { window.dispatchEvent(new CustomEvent("rmone:billingRatesChanged")); } catch { /* SSR */ }
  try { localStorage.setItem("rmone:ratesTs", String(Date.now())); } catch { /* storage */ }
  return data;
}

/** Delete a role from the tenant catalogue (cascades all billing rate overrides). */
export async function deleteRole(roleId: string): Promise<{ ok: boolean; deleted: boolean }> {
  const res = await fetchWithTimeout(`${API}/roles/${encodeURIComponent(roleId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const data = await handleResponse(res) as { ok: boolean; deleted: boolean };
  bustCache("assign:roles");
  bustCache("role-billing-rates-v2");
  clearRoleRatesSeed();
  bustCache("project:");
  bustCache("projects:");
  return data;
}

export async function getDepartments(tenantId?: string) {
  // Tenant-scoped key — see getDivisions.
  return cached(tenantId ? `departments:t:${tenantId}` : "departments", async () => {
    const url = tenantId ? `${API}/departments?tenantId=${encodeURIComponent(tenantId)}` : `${API}/departments`;
    const res = await fetchWithTimeout(url, { headers: authHeaders() }, 15_000);
    const data = await (handleResponse(res) as Promise<unknown[]>);
    // Case-insensitive dedup: collapse rows with the same (name + divisionId) pair.
    // Same name is valid under different divisions so we must NOT deduplicate by name alone.
    // Sort uppercase-first so the better-cased entry wins when casing differs.
    const seen = new Set<string>();
    return [...data]
      .sort((a: unknown, b: unknown) => {
        const na = String((a as Record<string,unknown>)?.Title ?? (a as Record<string,unknown>)?.Name ?? "");
        const nb = String((b as Record<string,unknown>)?.Title ?? (b as Record<string,unknown>)?.Name ?? "");
        const aUp = na.charCodeAt(0) < 97; const bUp = nb.charCodeAt(0) < 97;
        return aUp !== bUp ? (aUp ? -1 : 1) : 0;
      })
      .filter((d: unknown) => {
        const row = d as Record<string,unknown>;
        const name = String(row?.Title ?? row?.Name ?? "").trim().toLowerCase();
        const divId = String(row?.DivisionIdLookup ?? "");
        const key = name + "|" + divId;
        if (!name || seen.has(key)) return false;
        seen.add(key); return true;
      });
  });
}

/** The tenant's standalone Business Units (a separate entity from divisions). */
export async function getBusinessUnits(tenantId?: string) {
  // Tenant-scoped key — see getDivisions.
  return cached(tenantId ? `business-units:t:${tenantId}` : "business-units", async () => {
    const url = tenantId ? `${API}/business-units-list?tenantId=${encodeURIComponent(tenantId)}` : `${API}/business-units-list`;
    const res = await fetchWithTimeout(url, { headers: authHeaders() }, 15_000);
    return handleResponse(res) as Promise<unknown[]>;
  });
}

// ── Onboarding "defaults" settings (Settings tab) ──
// Previously a raw fetch with no caching, so re-opening the Settings tab
// always waited on a fresh network round-trip even seconds after the last
// visit. Now routed through the shared `cached()` layer (5min TTL, in-flight
// de-dupe) so repeat opens within the TTL paint instantly; `peekCached` lets
// the page seed its form synchronously from any prior fetch (this session)
// before the background refresh resolves.
const ONBOARDING_API = "/api/onboarding";
export function onboardingSettingsCacheKey(tenantId?: string) {
  return `onboarding-settings:${tenantId ? tenantId.trim().toLowerCase() : "__global__"}`;
}
export async function getOnboardingSettings<T = unknown>(tenantId?: string): Promise<T> {
  return cached(onboardingSettingsCacheKey(tenantId), async () => {
    const qs = tenantId?.trim() ? `?tenantId=${encodeURIComponent(tenantId.trim())}` : "";
    const res = await fetchWithTimeout(`${ONBOARDING_API}/settings${qs}`, { headers: authHeaders() });
    return handleResponse(res) as Promise<T>;
  });
}

/* ── Create org entities (RDS tenants). Divisions, Business Units and Departments
 *    are independent entities — each create only refreshes its own list cache.
 *    All three are idempotent server-side. ── */

/** Add a new division, linked to its parent business unit. Returns the created
 *  (or existing, re-linked) division. */
export async function createDivision(name: string, businessUnitId?: string): Promise<{ id: string; name: string }> {
  const bu = (businessUnitId ?? "").trim();
  const res = await fetchWithTimeout(`${API}/divisions`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(bu ? { name, businessUnitId: bu } : { name }),
  });
  const data = await handleResponse(res) as { id: string; name: string };
  bustCache("divisions");
  return data;
}

/** Find-or-create the hidden "bridge" division used when the Division tier is
 *  hidden (showDivision=false). With a businessUnitId the bridge mirrors that
 *  BU's name; without one a single tenant-wide bridge is used. Idempotent. */
export async function ensureBridgeDivision(businessUnitId?: string, fallbackName?: string): Promise<{ id: string; name: string; isBridge: true }> {
  const bu = (businessUnitId ?? "").trim();
  const fb = (fallbackName ?? "").trim();
  const res = await fetchWithTimeout(`${API}/divisions/ensure-bridge`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ...(bu ? { businessUnitId: bu } : {}), ...(fb ? { fallbackName: fb } : {}) }),
  });
  const data = await handleResponse(res) as { id: string; name: string; isBridge: true };
  bustCache("divisions");
  return data;
}

/** Add a new business unit (a separate core2.dbo.BusinessUnit row). */
export async function createBusinessUnit(name: string): Promise<{ id: string; name: string }> {
  const res = await fetchWithTimeout(`${API}/business-units`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await handleResponse(res) as { id: string; name: string };
  bustCache("business-units");
  return data;
}

/** Add a new department, optionally linked to a division. */
export async function createDepartment(name: string, divisionId?: string): Promise<{ id: string; name: string }> {
  const res = await fetchWithTimeout(`${API}/departments`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(divisionId ? { name, divisionId } : { name }),
  });
  const data = await handleResponse(res) as { id: string; name: string };
  bustCache("departments");
  return data;
}

/* ── Rename / re-link / delete org entities ── */

export async function renameDivision(id: string, name: string): Promise<void> {
  const res = await fetchWithTimeout(`${API}/divisions/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await handleResponse(res);
  bustCache("divisions");
  bustProjectDetailCache();
}

export async function relinkDivision(id: string, businessUnitId: string | null): Promise<void> {
  const res = await fetchWithTimeout(`${API}/divisions/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ businessUnitId: businessUnitId ?? "" }),
  });
  await handleResponse(res);
  bustCache("divisions");
  bustProjectDetailCache();
}

/** Update a division's name and/or parent BU in a single round-trip. */
export async function updateDivision(id: string, name: string, businessUnitId: string | null | undefined): Promise<void> {
  const body: Record<string, unknown> = { name };
  if (businessUnitId !== undefined) body.businessUnitId = businessUnitId ?? "";
  const res = await fetchWithTimeout(`${API}/divisions/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await handleResponse(res);
  bustCache("divisions");
  bustProjectDetailCache();
}

export async function deleteDivision(id: string, title?: string): Promise<void> {
  const qs = title ? `?title=${encodeURIComponent(title)}` : "";
  const res = await fetchWithTimeout(`${API}/divisions/${encodeURIComponent(id)}${qs}`, {
    method: "DELETE", headers: authHeaders(),
  });
  const data = await handleResponse(res) as { deleted?: boolean } | null;
  if (data && data.deleted === false)
    throw new Error("Division not found — it may already be deleted. Refresh to see the latest.");
  bustCache("divisions");
  bustProjectDetailCache();
}

export async function renameBusinessUnit(id: string, name: string): Promise<void> {
  const res = await fetchWithTimeout(`${API}/business-units/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await handleResponse(res);
  bustCache("business-units");
  bustProjectDetailCache();
}

export async function deleteBusinessUnit(id: string, title?: string): Promise<void> {
  const qs = title ? `?title=${encodeURIComponent(title)}` : "";
  const res = await fetchWithTimeout(`${API}/business-units/${encodeURIComponent(id)}${qs}`, {
    method: "DELETE", headers: authHeaders(),
  });
  const data = await handleResponse(res) as { deleted?: boolean } | null;
  if (data && data.deleted === false)
    throw new Error("Business unit not found — it may already be deleted. Refresh to see the latest.");
  bustCache("business-units");
  bustProjectDetailCache();
}

export async function renameDepartment(id: string, name: string): Promise<void> {
  const res = await fetchWithTimeout(`${API}/departments/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await handleResponse(res);
  bustCache("departments");
  bustProjectDetailCache();
}

export async function relinkDepartment(id: string, divisionId: string | null): Promise<void> {
  const res = await fetchWithTimeout(`${API}/departments/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ divisionId: divisionId ?? "" }),
  });
  await handleResponse(res);
  bustCache("departments");
  bustProjectDetailCache();
}

/** Update a department's name and/or parent division in a single round-trip. */
export async function updateDepartment(id: string, name: string, divisionId: string | null | undefined): Promise<void> {
  const body: Record<string, unknown> = { name };
  if (divisionId !== undefined) body.divisionId = divisionId ?? "";
  const res = await fetchWithTimeout(`${API}/departments/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await handleResponse(res);
  bustCache("departments");
  bustProjectDetailCache();
}

export async function deleteDepartment(id: string, title?: string, divId?: string): Promise<void> {
  const params = new URLSearchParams();
  if (title) params.set("title", title);
  if (divId) params.set("divId", divId);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetchWithTimeout(`${API}/departments/${encodeURIComponent(id)}${qs}`, {
    method: "DELETE", headers: authHeaders(),
  });
  const data = await handleResponse(res) as { deleted?: boolean } | null;
  if (data && data.deleted === false)
    throw new Error("Department not found — it may already be deleted. Refresh to see the latest.");
  bustCache("departments");
  bustProjectDetailCache();
}

export async function cleanupOrganization(): Promise<{ deleted: { departments: number; divisions: number; businessUnits: number } }> {
  const res = await fetchWithTimeout(`${API}/organization/cleanup`, {
    method: "POST", headers: authHeaders(),
  });
  return handleResponse(res);
}

export interface OrgUploadRow {
  business_unit?: string;
  division?: string;
  department?: string;
  role?: string;
  job_title?: string;
}

export interface OrgConflict {
  divName: string;
  divLower: string;
  busInFile: string[];
}

export interface OrgUploadResult {
  Status: boolean;
  counts: { bus: number; divs: number; depts: number; roles: number; jobTitles: number };
  errors: string[];
  needsDisambiguation?: boolean;
  conflicts?: OrgConflict[];
}

export async function bulkUploadOrg(
  rows: OrgUploadRow[],
  divisionHints?: Record<string, string>,
  fileName?: string,
): Promise<OrgUploadResult> {
  const res = await fetchWithTimeout(`${API}/organization/bulk-upload`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ rows, divisionHints, fileName }),
  });
  return handleResponse(res);
}

/* ── Org entity provenance — which file/action introduced each BU/Division/Department ── */

export type OrgEntityType = "bu" | "division" | "department" | "job_title";

export interface OrgProvenanceEntry {
  entityType: OrgEntityType;
  entityName: string;
  source: string; // "import" | "manual" | "org-upload" | "traced"
  fileName: string | null;
  uploadId: string | null;
  createdBy: string | null;
  createdAt: string | null;
}

export async function getOrgProvenance(tenantId?: string | null): Promise<OrgProvenanceEntry[]> {
  const url = tenantId
    ? `${API}/org/provenance?tenantId=${encodeURIComponent(tenantId)}`
    : `${API}/org/provenance`;
  const res = await fetchWithTimeout(url, { headers: authHeaders() }, 15_000);
  const data = await (handleResponse(res) as Promise<{ rows?: OrgProvenanceEntry[] }>);
  return data?.rows ?? [];
}

export interface OrgTraceResult {
  found: boolean;
  fileName: string | null;
  uploadId: string | null;
  uploadedAt: string | null;
  uploadedBy: string | null;
  matches: Array<{ sheet: string; column: string; rows: number }>;
  scannedFiles: number;
  skippedFiles: number;
  /** true only when every stored file was fully scanned — a definitive "not found" */
  complete: boolean;
}

/** Scan the tenant's stored import files for the entity name (oldest first).
 *  A hit is persisted server-side as source "traced", so the answer shows
 *  permanently without re-scanning. Bounded server-side; generous timeout. */
export async function traceOrgEntity(
  name: string,
  entityType: OrgEntityType,
  tenantId?: string | null,
): Promise<OrgTraceResult> {
  const res = await fetchWithTimeout(`${API}/org/trace`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name, entityType, ...(tenantId ? { tenantId } : {}) }),
  }, 60_000);
  return handleResponse(res);
}

/* ── Create a brand-new staff member (RDS tenants) ── */

export interface CreateStaffPayload {
  name: string;
  email: string;
  divisionId?: string;
  departmentId?: string;
  jobTitleId?: string;
  roleId?: string;
  roleName?: string;
  // "Admin" | "Manager" | "User" | "" | "custom:<id>" (admin-defined levels
  // from Settings → Access Levels; the server's normAcl accepts the marker).
  accessLevel?: string;
  sendInvite?: boolean;
  /** When set, creates the staff member on this tenant (superadmin override). */
  tenantId?: string;
  employeeType?: string;
  phoneNumber?: string;
  employeeId?: string;
}
export interface CreateStaffResult {
  ok: boolean;
  userGuid: string;
  invite?: { ok: boolean; emailed: boolean; link?: string; message?: string };
}
export async function createStaff(payload: CreateStaffPayload): Promise<CreateStaffResult> {
  const res = await fetchWithTimeout(`${API}/create-staff`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    // Surface the server's plain-language reason (e.g. a duplicate email)
    // instead of the raw "409: {json}" that handleResponse would throw.
    const text = await res.text().catch(() => "");
    let msg = "";
    try { msg = (JSON.parse(text) as { error?: string })?.error ?? ""; } catch { /* not json */ }
    const err = new Error(msg || `Could not create staff member (${res.status}).`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as CreateStaffResult;
  // The new person must appear on the very next roster fetch. Bust the module
  // cache and arm the one-shot fresh flags — but do NOT fire the full
  // notifyAllocationChanged here: bulk upload calls createStaff once per row,
  // and a per-row invalidate would trigger a refetch storm. The caller
  // refetches once when its batch completes and picks the flags up then.
  bustCache("resource-allocations:");
  markAllocationRefetchFresh();
  return data;
}

// ─── User Skills ─────────────────────────────────────────────────────────────
export async function getUserSkills(guid: string): Promise<{ id: number; skillName: string; proficiency: number | null; isPrimary: boolean }[]> {
  const tenant = localStorage.getItem(TENANT_KEY) ?? "";
  const res = await fetchWithTimeout(`/api/resources/${encodeURIComponent(guid)}/skills`, {
    headers: { ...authHeaders(), ...(tenant ? { "x-rmone-tenant": tenant } : {}) },
  });
  return handleResponse(res) as Promise<{ id: number; skillName: string; proficiency: number | null; isPrimary: boolean }[]>;
}

export async function addUserSkill(guid: string, skillName: string): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`/api/resources/${encodeURIComponent(guid)}/skills`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name: skillName }),
  });
  return handleResponse(res) as Promise<{ ok: boolean }>;
}

export async function deleteUserSkill(guid: string, id: number): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`/api/resources/${encodeURIComponent(guid)}/skills/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse(res) as Promise<{ ok: boolean }>;
}

// ─── User Experience Tags ─────────────────────────────────────────────────────
export async function getUserExperienceTags(guid: string): Promise<{ id: number; tagName: string }[]> {
  const tenant = localStorage.getItem(TENANT_KEY) ?? "";
  const res = await fetchWithTimeout(`/api/resources/${encodeURIComponent(guid)}/experience-tags`, {
    headers: { ...authHeaders(), ...(tenant ? { "x-rmone-tenant": tenant } : {}) },
  });
  return handleResponse(res) as Promise<{ id: number; tagName: string }[]>;
}

export async function addUserExperienceTag(guid: string, tagName: string): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`/api/resources/${encodeURIComponent(guid)}/experience-tags`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ tagName }),
  });
  return handleResponse(res) as Promise<{ ok: boolean }>;
}

export async function deleteUserExperienceTag(guid: string, id: number): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`/api/resources/${encodeURIComponent(guid)}/experience-tags/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse(res) as Promise<{ ok: boolean }>;
}

// Update a staff member's Business Unit / Department / Role / Job Title in place.
// Busts the resource-allocations cache so the Staff card reflects the change.
export async function updateStaffExtra(
  guid: string,
  // tenantId: superadmin editing another company's person — the server writes
  // into that company (guarded server-side; ignored for non-superadmins).
  payload: { employeeType?: string | null; phoneNumber?: string | null; name?: string; username?: string; tenantId?: string },
  // silent: skip the bust+notify. Used when the caller fires SEVERAL staff
  // writes together (EditStaffModal saves assignment + extra in parallel) —
  // notifying after the FIRST write triggers a roster refetch that races the
  // second write and can capture a pre-write snapshot. The caller must bust
  // + notify itself once ALL writes have completed.
  opts?: { silent?: boolean },
): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`${API}/staff/${encodeURIComponent(guid)}/extra`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!opts?.silent) {
    bustCache("resource-allocations:");
    notifyAllocationChanged();
  }
  return handleResponse(res) as Promise<{ ok: boolean }>;
}

export async function updateStaffAssignment(
  guid: string,
  // tenantId: superadmin editing another company's person — the server writes
  // into that company (guarded server-side; ignored for non-superadmins).
  payload: { divisionId?: string; departmentId?: string; roleId?: string; jobTitleId?: string; roleName?: string; accessLevel?: string; tenantId?: string },
  // silent: see updateStaffExtra — skip bust+notify so multi-write savers can
  // signal ONCE after every write has landed.
  opts?: { silent?: boolean },
): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`${API}/staff/${encodeURIComponent(guid)}/assignment`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = "";
    try { msg = (JSON.parse(text) as { error?: string })?.error ?? ""; } catch { /* not json */ }
    throw new Error(msg || `Could not update staff member (${res.status}).`);
  }
  if (!opts?.silent) {
    bustCache("resource-allocations:");
    notifyAllocationChanged();
  }
  return (await res.json()) as { ok: boolean };
}

/** Poke every surface that renders the lifecycle-template list (the record
 *  page's "Pick a lifecycle template" picker, the schedule card's Manage
 *  popup). Busts the client cache, notifies same-tab listeners, and ticks a
 *  localStorage timestamp so OTHER tabs refresh too (same pattern as
 *  rmone:ratesTs). Call after ANY write that creates/renames/rewrites
 *  templates — including Settings saves of named phase/stage sets, which sync
 *  into templates server-side. */
export function notifyLifecyclesChanged() {
  bustCache("lifecycles");
  try { localStorage.setItem("rmone:lifecyclesTs", String(Date.now())); } catch { /* storage unavailable */ }
  try { window.dispatchEvent(new Event("rmone:lifecyclesChanged")); } catch { /* non-browser */ }
}

export async function getLifecycles(module?: "PMM" | "OPM") {
  // Module-scoped: the schedule pickers must only offer templates for their
  // own module (projects ≠ opportunities). The cache key includes the module
  // so bustCache("lifecycles") prefix-busts every variant.
  const qs = module ? `?module=${module}` : "";
  return cached(`lifecycles${qs}`, async () => {
    const res = await fetchWithTimeout(`${API}/lifecycles${qs}`, { headers: authHeaders() });
    return handleResponse(res) as Promise<unknown[]>;
  });
}

export async function createLifecycle(payload: { Name: string; Stages: string[]; Module?: string }) {
  const res = await fetchWithTimeout(`${API}/lifecycles`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await handleResponse(res);
  notifyLifecyclesChanged();
  return data;
}

export async function updateLifecycle(id: string | number, payload: { Name: string; Stages: string[] }) {
  const res = await fetchWithTimeout(`${API}/lifecycles/${id}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await handleResponse(res);
  notifyLifecyclesChanged();
  return data;
}

export async function deleteLifecycle(id: string | number) {
  const res = await fetchWithTimeout(`${API}/lifecycles/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const data = await handleResponse(res);
  notifyLifecyclesChanged();
  return data;
}

export async function getProjectTemplates() {
  return cached("project-templates", async () => {
    const res = await fetchWithTimeout(`${API}/project-templates`, { headers: authHeaders() });
    return handleResponse(res) as Promise<unknown[]>;
  });
}

export async function createSchedule(payload: Record<string, unknown>) {
  const res = await fetchWithTimeout(`${API}/schedule`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await handleResponse(res);
  // First-time schedule assignment must invalidate the empty-state
  // cache so the Project Schedule card shows the new phases on next open.
  bustCache("project:");
  return data;
}

export async function createRecord(moduleName: string, fields: { FieldName: string; Value: string }[]) {
  const res = await fetchWithTimeout(`${API}/new-record`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ModuleName: moduleName, Fields: fields }),
  });
  const data = await handleResponse(res);
  // A new record changes module lists, the Home overlay and Quick Actions
  // pickers on every mounted page — broadcast on the unified bus.
  notifyDataChanged(["record"]);
  return data;
}

/* ─────────────  JOB TITLES & COST RATES (May 2026)  ─────────────
 * Tenant-wide catalogue + per-(Department × JobTitle) cost rate. The
 * catalogue powers the Title dropdown in Add-Team-Member; the upsert
 * powers the Rate Card admin screen and any inline "Set rate" pencil
 * on the project Budget panel. See proxy comments for the full schema.
 */
export interface JobTitleRow {
  ID: number;
  Title: string;
  JobTitleName: string;
  ShortName?: string;
  RoleName?: string;
  RoleId?: string;
  DepartmentId?: number | string;
  JobType?: "Billable" | "Overhead" | string;
  Deleted?: boolean;
  LowRevenueCapacity?: number;
  HighRevenueCapacity?: number;
  LowProjectCapacity?: number;
  HighProjectCapacity?: number;
  ResourceLevelTolerance?: number;
}

export async function getJobTitles(tenantId?: string): Promise<JobTitleRow[]> {
  return cached("job-titles", async () => {
    const url = tenantId ? `${API}/job-titles?tenantId=${encodeURIComponent(tenantId)}` : `${API}/job-titles`;
    const res = await fetchWithTimeout(url, { headers: authHeaders() });
    const rows = await handleResponse(res) as JobTitleRow[];
    return Array.isArray(rows) ? rows.filter(r => !r.Deleted) : [];
  }) as Promise<JobTitleRow[]>;
}

export async function saveJobTitleCostRate(payload: {
  Id?: number;
  JobTitleId: number;
  EmpCostRate: number;
  DepartmentId: number;
  Deleted?: boolean;
}): Promise<{ success?: boolean; message?: string }> {
  const res = await fetchWithTimeout(`${API}/job-title-cost-rate`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      Id: payload.Id ?? 0,
      JobTitleId: payload.JobTitleId,
      EmpCostRate: payload.EmpCostRate,
      DepartmentId: payload.DepartmentId,
      Deleted: payload.Deleted ?? false,
    }),
  });
  // Bust the rate-card cache so the screen reflects the new value
  // immediately on next read.
  bustCacheByPrefix("job-title");
  return handleResponse(res) as Promise<{ success?: boolean; message?: string }>;
}

// Download the pre-filled Rate Card Excel workbook.
// Triggers a browser file-save automatically.
export async function downloadRateCard(): Promise<void> {
  const res = await fetchWithTimeout(`${API}/rate-card/download`, { headers: authHeaders() }, 30_000);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Download failed" }));
    throw new Error((err as any).error ?? "Download failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "rmone_rate_card.xlsx";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

// Clear every cache that carries role/rate data so the Rate Card page,
// role/title pickers and project financial cards refetch fresh data instead
// of serving the 5-minute TTL entry. Shared by every rate-writing path.
function bustRateCardCaches(): void {
  bustCache("job-titles");
  bustCache("assign:titles");
  bustCache("assign:roles");
  bustCache("role-billing-rates-v2");
  bustCache("project:");
  bustCache("projects:");
  try { window.dispatchEvent(new CustomEvent("rmone:billingRatesChanged")); } catch { /* SSR/non-browser */ }
  try { localStorage.setItem("rmone:ratesTs", String(Date.now())); } catch { /* storage unavailable */ }
}

// Upload a filled-in Rate Card Excel and bulk-save all rate changes.
export async function importRateCard(file: File): Promise<{ saved: number; created: number; skipped: number; errors: string[] }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetchWithTimeout(`${API}/rate-card/import`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  }, 60_000);
  const data = (await handleResponse(res)) as { saved: number; created: number; skipped: number; errors: string[] };
  bustRateCardCaches();
  return data;
}

// One classified row from the rate-card preview. `existing` holds what is
// currently stored at the SAME scope (dept override or company-wide default);
// status "conflict" = same role + same scope but a different rate.
export interface RateCardPreviewRow {
  idx: number;
  roleName: string;
  roleId: string;
  deptId: string;
  deptName: string;
  scope: string;
  isNewRole: boolean;
  incoming: { billing: number | null; labor: number | null; cost: number | null };
  existing: { billing: number | null; labor: number | null; cost: number | null } | null;
  status: "new" | "unchanged" | "conflict";
  conflictFields: ("billing" | "labor" | "cost")[];
}

export interface RateCardPreview {
  preview: true;
  rows: RateCardPreviewRow[];
  skipped: number;
  newRoles: string[];
  warnings: string[];
  errors: string[];
}

// Phase 1 of the reviewed upload: parse + classify WITHOUT writing anything.
// Nothing is saved and no roles are created, so cancelling is a clean no-op.
export async function previewRateCard(file: File): Promise<RateCardPreview> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("mode", "preview");
  const res = await fetchWithTimeout(`${API}/rate-card/import`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  }, 60_000);
  return (await handleResponse(res)) as RateCardPreview;
}

// Phase 2: write the rows the user approved in the review popup.
export async function applyRateCard(
  rows: { roleName: string; roleId: string; deptId: string; deptName: string; billing: number | null; labor: number | null; cost: number | null }[],
): Promise<{ saved: number; created: number; errors: string[] }> {
  const res = await fetchWithTimeout(`${API}/rate-card/apply`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  }, 60_000);
  const data = (await handleResponse(res)) as { saved: number; created: number; errors: string[] };
  bustRateCardCaches();
  return data;
}

/* ─────────────  TALENT / RESOURCE ENRICHMENT (May 2026)  ─────────────
 * People lookup + the additive resource-enrichment store (resumes, skills,
 * certifications, education, work history, project portfolio). The lookup
 * route lives under /api/rmone; the enrichment + storage routes live under
 * /api/resources and /api/storage respectively. All require the bearer
 * token via authHeaders(); the server scopes everything to the tenant.
 */

export interface PeopleSearchResult {
  name: string;
  email: string;
  source: string;
  title?: string;
  company?: string;
  guid?: string;
}

export async function peopleSearch(q: string, limit = 25): Promise<PeopleSearchResult[]> {
  const res = await fetchWithTimeout(
    `${API}/people-search?q=${encodeURIComponent(q)}&limit=${limit}`,
    { headers: authHeaders() });
  const data = (await handleResponse(res)) as { results?: PeopleSearchResult[] };
  return Array.isArray(data.results) ? data.results : [];
}

export interface ResourceProfile {
  headline?: string | null;
  bio?: string | null;
  location?: string | null;
  yearsExperience?: string | number | null;
  availableFrom?: string | null;
  preferredRoles?: string | null;
  linkedinUrl?: string | null;
}
export interface ResourceSkill {
  id: number;
  skillName: string;
  category?: string | null;
  proficiency?: number | null;
  yearsExperience?: string | number | null;
  lastUsedYear?: number | null;
  isPrimary?: boolean;
}
export interface ResourceCertification {
  id: number;
  name: string;
  issuer?: string | null;
  credentialId?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  attachmentPath?: string | null;
}
export interface ResourceEducation {
  id: number;
  institution: string;
  degree?: string | null;
  fieldOfStudy?: string | null;
  startYear?: number | null;
  endYear?: number | null;
  grade?: string | null;
}
export interface ResourceWorkHistory {
  id: number;
  company: string;
  title?: string | null;
  location?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  isCurrent?: boolean;
  description?: string | null;
}
export interface ResourcePortfolioProject {
  id: number;
  name: string;
  role?: string | null;
  client?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
  skillsUsed?: string[];
}
export interface ResourceResume {
  id: number;
  objectPath: string;
  fileName: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  summary?: string | null;
  isPrimary?: boolean;
  uploadedAt?: string | null;
}
export interface ResourceProfileBundle {
  ok: boolean;
  resourceGuid: string;
  name: string | null;
  email: string | null;
  profile: ResourceProfile | null;
  skills: ResourceSkill[];
  certifications: ResourceCertification[];
  education: ResourceEducation[];
  workHistory: ResourceWorkHistory[];
  projects: ResourcePortfolioProject[];
  resumes: ResourceResume[];
}

export async function getResourceProfile(guid: string): Promise<ResourceProfileBundle> {
  const res = await fetchWithTimeout(
    `/api/resources/${encodeURIComponent(guid)}`, { headers: authHeaders() });
  return handleResponse(res) as Promise<ResourceProfileBundle>;
}

export async function updateResourceProfile(
  guid: string,
  body: {
    headline?: string;
    bio?: string;
    location?: string;
    yearsExperience?: string | number;
    availableFrom?: string;
    preferredRoles?: string;
    linkedinUrl?: string;
  },
): Promise<{ ok: boolean; data?: ResourceProfile }> {
  const res = await fetchWithTimeout(
    `/api/resources/${encodeURIComponent(guid)}/profile`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return handleResponse(res) as Promise<{ ok: boolean; data?: ResourceProfile }>;
}

export async function addResourceSkill(
  guid: string,
  body: {
    skillName: string;
    category?: string;
    proficiency?: number;
    yearsExperience?: number;
    lastUsedYear?: number;
    isPrimary?: boolean;
  },
): Promise<{ ok: boolean; data?: ResourceSkill }> {
  const res = await fetchWithTimeout(
    `/api/resources/${encodeURIComponent(guid)}/skills`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return handleResponse(res) as Promise<{ ok: boolean; data?: ResourceSkill }>;
}

export async function deleteResourceSkill(guid: string, id: number): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(
    `/api/resources/${encodeURIComponent(guid)}/skills/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
  return handleResponse(res) as Promise<{ ok: boolean }>;
}

export async function addResourceCertification(
  guid: string,
  body: {
    name: string;
    issuer?: string;
    credentialId?: string;
    issueDate?: string;
    expiryDate?: string;
    attachmentPath?: string;
  },
): Promise<{ ok: boolean; data?: ResourceCertification }> {
  const res = await fetchWithTimeout(
    `/api/resources/${encodeURIComponent(guid)}/certifications`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return handleResponse(res) as Promise<{ ok: boolean; data?: ResourceCertification }>;
}

export async function deleteResourceCertification(guid: string, id: number): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(
    `/api/resources/${encodeURIComponent(guid)}/certifications/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
  return handleResponse(res) as Promise<{ ok: boolean }>;
}

export async function addResourceEducation(
  guid: string,
  body: {
    institution: string;
    degree?: string;
    fieldOfStudy?: string;
    startYear?: number;
    endYear?: number;
    grade?: string;
  },
): Promise<{ ok: boolean; data?: ResourceEducation }> {
  const res = await fetchWithTimeout(
    `/api/resources/${encodeURIComponent(guid)}/education`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return handleResponse(res) as Promise<{ ok: boolean; data?: ResourceEducation }>;
}

export async function deleteResourceEducation(guid: string, id: number): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(
    `/api/resources/${encodeURIComponent(guid)}/education/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
  return handleResponse(res) as Promise<{ ok: boolean }>;
}

export async function addResourceWorkHistory(
  guid: string,
  body: {
    company: string;
    title?: string;
    location?: string;
    startDate?: string;
    endDate?: string;
    isCurrent?: boolean;
    description?: string;
  },
): Promise<{ ok: boolean; data?: ResourceWorkHistory }> {
  const res = await fetchWithTimeout(
    `/api/resources/${encodeURIComponent(guid)}/work-history`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return handleResponse(res) as Promise<{ ok: boolean; data?: ResourceWorkHistory }>;
}

export async function deleteResourceWorkHistory(guid: string, id: number): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(
    `/api/resources/${encodeURIComponent(guid)}/work-history/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
  return handleResponse(res) as Promise<{ ok: boolean }>;
}

export async function addResourcePortfolioProject(
  guid: string,
  body: {
    name: string;
    role?: string;
    client?: string;
    startDate?: string;
    endDate?: string;
    description?: string;
    skillsUsed?: string[];
  },
): Promise<{ ok: boolean; data?: ResourcePortfolioProject }> {
  const res = await fetchWithTimeout(
    `/api/resources/${encodeURIComponent(guid)}/projects`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return handleResponse(res) as Promise<{ ok: boolean; data?: ResourcePortfolioProject }>;
}

export async function deleteResourcePortfolioProject(guid: string, id: number): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(
    `/api/resources/${encodeURIComponent(guid)}/projects/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
  return handleResponse(res) as Promise<{ ok: boolean }>;
}

export async function addResourceResume(
  guid: string,
  body: {
    objectPath: string;
    fileName: string;
    contentType?: string;
    sizeBytes?: number;
    summary?: string;
    isPrimary?: boolean;
  },
): Promise<{ ok: boolean; data?: ResourceResume }> {
  const res = await fetchWithTimeout(
    `/api/resources/${encodeURIComponent(guid)}/resumes`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return handleResponse(res) as Promise<{ ok: boolean; data?: ResourceResume }>;
}

export async function deleteResourceResume(guid: string, id: number): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(
    `/api/resources/${encodeURIComponent(guid)}/resumes/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
  return handleResponse(res) as Promise<{ ok: boolean }>;
}

export interface SkillSearchResult {
  resourceGuid: string;
  name: string | null;
  email: string | null;
  skillName: string;
  proficiency: number | null;
  yearsExperience: string | number | null;
  lastUsedYear: number | null;
}

export async function searchResourcesBySkill(skill: string, minLevel = 1): Promise<SkillSearchResult[]> {
  const res = await fetchWithTimeout(
    `/api/resources/search?skill=${encodeURIComponent(skill)}&minLevel=${minLevel}`,
    { headers: authHeaders() });
  const data = (await handleResponse(res)) as { data?: SkillSearchResult[] };
  return Array.isArray(data.data) ? data.data : [];
}

export interface SkillCatalogEntry { id: number; name: string; category: string | null }

export async function getSkillCatalog(): Promise<SkillCatalogEntry[]> {
  const res = await fetchWithTimeout(`/api/resources/skill-catalog`, { headers: authHeaders() });
  const data = (await handleResponse(res)) as { data?: SkillCatalogEntry[] };
  return Array.isArray(data.data) ? data.data : [];
}

/* Resume FILE upload — two-step presigned flow (no uppy). Request a signed
 * URL, PUT the raw bytes straight to S3 (NO auth header on the PUT), then
 * register the metadata via addResourceResume(). */
export interface UploadUrlResponse { uploadURL: string; objectPath: string }

export async function requestUploadUrl(
  name: string, size: number, contentType: string,
): Promise<UploadUrlResponse> {
  const res = await fetchWithTimeout(`/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name, size, contentType }),
  });
  return handleResponse(res) as Promise<UploadUrlResponse>;
}

export async function uploadFileToSignedUrl(uploadURL: string, file: File): Promise<void> {
  const res = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload failed: ${res.status} ${text}`);
  }
}

/** Build the in-app serve URL for a stored object path (begins with /objects/). */
export function resourceFileUrl(objectPath: string): string {
  return `/api/storage${objectPath}`;
}

export interface ProvisionTenantInput {
  companyName: string;
  adminName: string;
  adminEmail: string;
  sendInvite: boolean;
  website?: string;
  phone?: string;
  companyEmail?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  industry?: string;
  ownershipType?: string;
  licenseNumber?: string;
}

export async function checkTenantAvailability(tenantId: string): Promise<{
  available: boolean;
  conflict?: { status: string; fileName?: string; createdAt?: string; uploadId?: string };
}> {
  const res = await fetchWithTimeout(
    `/api/onboarding/check-tenant?tenantId=${encodeURIComponent(tenantId)}`,
    { headers: authHeaders() },
  );
  return handleResponse(res);
}

export async function provisionTenant(input: ProvisionTenantInput): Promise<{
  ok: boolean; tenantId: string; tenantGuid: string; adminGuid: string;
  inviteSent: boolean; inviteMessage: string;
}> {
  const res = await fetchWithTimeout(`${API}/provision-tenant`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse(res);
}

export interface CompanyProfileFields {
  companyName?: string;
  website?: string;
  phone?: string;
  companyEmail?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  industry?: string;
  ownershipType?: string;
  licenseNumber?: string;
}

export async function getCompanyProfile(tenantId: string): Promise<{ tenantId: string; profile: CompanyProfileFields }> {
  const res = await fetchWithTimeout(`/api/superadmin/company-profile/${encodeURIComponent(tenantId)}`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function updateCompanyProfile(tenantId: string, fields: CompanyProfileFields): Promise<{ ok: boolean; tenantId: string }> {
  const res = await fetchWithTimeout(`/api/superadmin/company-profile/${encodeURIComponent(tenantId)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  return handleResponse(res);
}

export async function prefetchAll(): Promise<void> {
  await Promise.allSettled([
    getModuleRecords("PMM"),
    getModuleRecords("OPM"),
    getResourceDemands(),
    getResourceAllocations(),
  ]);
}

/* ─────────────────  ALLOCATION TEMPLATES  ───────────────── */

export interface AllocTemplateSlot {
  id: number;
  buName: string | null;
  divisionName: string | null;
  deptName: string | null;
  roleName: string | null;
  jobTitleName: string | null;
  defaultPct: number;
  sortOrder: number;
  resourceId: string | null;
}

export interface AllocTemplate {
  id: number;
  name: string;
  createdBy: string | null;
  createdAt: string;
  slots: AllocTemplateSlot[];
}

const TEMPLATES_BASE = `/api/allocation-templates`;

export const ALLOC_TEMPLATES_CACHE_KEY = "alloc-templates";

export async function getAllocTemplates(): Promise<AllocTemplate[]> {
  return cached(ALLOC_TEMPLATES_CACHE_KEY, async () => {
    const res = await fetchWithTimeout(TEMPLATES_BASE, { headers: authHeaders() });
    // Throw on failure instead of returning [] — cached() drops the entry on
    // throw so the next open retries, rather than pinning a bogus empty
    // template list ("No templates yet.") for the rest of the session.
    if (!res.ok) throw new Error(`allocation-templates ${res.status}`);
    return res.json() as Promise<AllocTemplate[]>;
  });
}

export async function createAllocTemplate(
  name: string,
  slots: Omit<AllocTemplateSlot, "id">[],
): Promise<{ ok: boolean; id?: number; templates?: AllocTemplate[] }> {
  const res = await fetchWithTimeout(TEMPLATES_BASE, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name, slots }),
  });
  bustCache(ALLOC_TEMPLATES_CACHE_KEY);
  return res.json() as Promise<{ ok: boolean; id?: number; templates?: AllocTemplate[] }>;
}

export async function updateAllocTemplate(
  id: number,
  name: string,
  slots: Omit<AllocTemplateSlot, "id">[],
): Promise<{ ok: boolean; templates?: AllocTemplate[] }> {
  const res = await fetchWithTimeout(`${TEMPLATES_BASE}/${id}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name, slots }),
  });
  bustCache(ALLOC_TEMPLATES_CACHE_KEY);
  return res.json() as Promise<{ ok: boolean; templates?: AllocTemplate[] }>;
}

export async function deleteAllocTemplate(
  id: number,
): Promise<{ ok: boolean; templates?: AllocTemplate[] }> {
  const res = await fetchWithTimeout(`${TEMPLATES_BASE}/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  bustCache(ALLOC_TEMPLATES_CACHE_KEY);
  return res.json() as Promise<{ ok: boolean; templates?: AllocTemplate[] }>;
}

/* ── Office list management (Settings → Organization) ─────────────────────
 * The curated office master list lives in one settings doc per tenant;
 * staff keep the office name denormalized, so the read merges curated names
 * with in-use names + staff counts. Writes are admin-gated server-side. */

export interface OfficeInfo { name: string; staffCount: number; curated: boolean }

export async function getOffices(tenantId?: string | null): Promise<OfficeInfo[]> {
  const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
  const res = await fetchWithTimeout(`/api/onboarding/offices${qs}`, { headers: authHeaders() });
  const data = (await handleResponse(res)) as { offices?: OfficeInfo[] };
  return Array.isArray(data.offices) ? data.offices : [];
}

export async function addOffice(name: string, tenantId?: string | null): Promise<void> {
  const res = await fetchWithTimeout(`/api/onboarding/offices`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name, ...(tenantId ? { tenantId } : {}) }),
  });
  await handleResponse(res);
}

export async function renameOffice(from: string, to: string, tenantId?: string | null): Promise<{ staffUpdated?: number }> {
  const res = await fetchWithTimeout(`/api/onboarding/offices`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, ...(tenantId ? { tenantId } : {}) }),
  });
  return (await handleResponse(res)) as { staffUpdated?: number };
}

export async function deleteOffice(name: string, tenantId?: string | null): Promise<void> {
  const res = await fetchWithTimeout(`/api/onboarding/offices`, {
    method: "DELETE",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name, ...(tenantId ? { tenantId } : {}) }),
  });
  await handleResponse(res);
}

/** One row per active staff member, with their current office (null = none). */
export interface OfficeStaffMember { id: string; name: string; office: string | null; title: string | null }

export async function getOfficeStaff(tenantId?: string | null): Promise<OfficeStaffMember[]> {
  const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
  const res = await fetchWithTimeout(`/api/onboarding/offices/staff${qs}`, { headers: authHeaders() });
  const data = (await handleResponse(res)) as { staff?: OfficeStaffMember[] };
  return Array.isArray(data.staff) ? data.staff : [];
}

/** Set (or clear, office=null) the office for a batch of staff members. */
export async function assignOfficeStaff(office: string | null, userIds: string[], tenantId?: string | null): Promise<{ updated?: number }> {
  const res = await fetchWithTimeout(`/api/onboarding/offices/assign`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ office, userIds, ...(tenantId ? { tenantId } : {}) }),
  });
  return (await handleResponse(res)) as { updated?: number };
}

/* ── Billable classifications (per-role) ──────────────────────────────────
 * Role id → "billable" | "nonbillable"; roles without an entry are
 * unclassified. Stored in one settings doc per tenant; writes admin-gated. */

export type RoleClassification = "billable" | "nonbillable";

export async function getRoleClassifications(tenantId?: string | null): Promise<Record<string, RoleClassification>> {
  const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
  const res = await fetchWithTimeout(`/api/onboarding/role-classifications${qs}`, { headers: authHeaders() });
  const data = (await handleResponse(res)) as { classifications?: Record<string, RoleClassification> };
  return data.classifications ?? {};
}

export async function saveRoleClassifications(
  classifications: Record<string, RoleClassification>,
  tenantId?: string | null,
): Promise<void> {
  const res = await fetchWithTimeout(`/api/onboarding/role-classifications`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ classifications, ...(tenantId ? { tenantId } : {}) }),
  });
  await handleResponse(res);
}

/* ── Leave / partial availability windows ─────────────────────────────────
 * A window marks a person fully out (0%) or partially available (1-99%)
 * between two dates. Stored per (tenant, person GUID) alongside the other
 * resource-enrichment data. */

export interface ResourceAvailabilityWindow {
  id: number;
  resourceGuid: string;
  startDate: string;        // "YYYY-MM-DD"
  endDate: string;          // "YYYY-MM-DD"
  availabilityPct: number;  // 0 = fully out
  reason?: string | null;
  leaveType?: string | null; // e.g. "PTO", "Vacation", "Jury Duty"
}

/** Cache-key for a single person's availability windows. Busted on every write. */
function availGuidKey(guid: string) { return `resource-availability:${String(guid).toLowerCase()}`; }

export async function getResourceAvailability(guid: string, tenantId?: string): Promise<ResourceAvailabilityWindow[]> {
  // Cached per guid — re-opening the same person's popup within the TTL window
  // is instant (no round-trip). Busted by add / update / delete below so a save
  // always returns fresh data on the very next popup open.
  return cached(availGuidKey(guid), async () => {
    const q = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
    const res = await fetchWithTimeout(
      `/api/resources/${encodeURIComponent(guid)}/availability${q}`, { headers: authHeaders() });
    const data = (await handleResponse(res)) as { data?: ResourceAvailabilityWindow[] };
    return Array.isArray(data.data) ? data.data : [];
  });
}

export const AVAILABILITY_ALL_CACHE_KEY = "resource-availability-all";

export async function getAllResourceAvailability(): Promise<ResourceAvailabilityWindow[]> {
  return cached(AVAILABILITY_ALL_CACHE_KEY, async () => {
    const res = await fetchWithTimeout(`/api/resources/availability-all`, { headers: authHeaders() });
    // Throw on failure so cached() drops the entry and the next read retries
    // (never pin a failure-empty list for the session).
    if (!res.ok) throw new Error(`availability-all ${res.status}`);
    const data = (await res.json()) as { data?: ResourceAvailabilityWindow[] };
    return Array.isArray(data.data) ? data.data : [];
  });
}

export async function addResourceAvailability(
  guid: string,
  body: { startDate: string; endDate: string; availabilityPct: number; reason?: string | null; leaveType?: string | null },
  tenantId?: string,
): Promise<ResourceAvailabilityWindow> {
  const res = await fetchWithTimeout(
    `/api/resources/${encodeURIComponent(guid)}/availability`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...(tenantId ? { tenantId } : {}) }),
    });
  bustCache(AVAILABILITY_ALL_CACHE_KEY);
  bustCache(availGuidKey(guid));
  const data = (await handleResponse(res)) as { data: ResourceAvailabilityWindow };
  return data.data;
}

export async function updateResourceAvailabilityWindow(
  guid: string,
  id: number,
  body: { startDate: string; endDate: string; availabilityPct: number; reason?: string | null; leaveType?: string | null },
): Promise<ResourceAvailabilityWindow> {
  const res = await fetchWithTimeout(
    `/api/resources/${encodeURIComponent(guid)}/availability/${id}`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  bustCache(AVAILABILITY_ALL_CACHE_KEY);
  bustCache(availGuidKey(guid));
  const data = (await handleResponse(res)) as { data: ResourceAvailabilityWindow };
  return data.data;
}

export async function deleteResourceAvailabilityWindow(guid: string, id: number, tenantId?: string): Promise<void> {
  const q = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
  const res = await fetchWithTimeout(
    `/api/resources/${encodeURIComponent(guid)}/availability/${id}${q}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
  bustCache(AVAILABILITY_ALL_CACHE_KEY);
  bustCache(availGuidKey(guid));
  await handleResponse(res);
}

const STAGE_CFG_BASE = `/api/stage-cfg`;

/** Fetch the stored stage config for a record + field from the server.
 *  Returns null when none is saved yet (caller falls back to localStorage). */
export async function getStageCfg(
  recordId: string,
  field: string,
  options?: { strict?: boolean },
): Promise<object | null> {
  try {
    const res = await fetchWithTimeout(
      `${STAGE_CFG_BASE}/${encodeURIComponent(field)}/${encodeURIComponent(recordId)}`,
      { headers: authHeaders() },
    );
    if (!res.ok) {
      if (options?.strict) throw new Error(`Could not load status configuration (${res.status})`);
      return null;
    }
    const data = (await res.json()) as { ok: boolean; cfg: object | null };
    if (!data.ok && options?.strict) throw new Error("Could not load status configuration");
    return data.cfg ?? null;
  } catch (error) {
    if (options?.strict) throw error;
    return null; // offline or server error — client keeps localStorage copy
  }
}

/** Persist a stage config for a record + field to the server.
 *  Fire-and-forget: localStorage is the optimistic primary write-through cache. */
export async function saveStageCfg(
  recordId: string,
  field: string,
  cfg: object,
  options?: { strict?: boolean },
): Promise<void> {
  try {
    const res = await fetchWithTimeout(
      `${STAGE_CFG_BASE}/${encodeURIComponent(field)}/${encodeURIComponent(recordId)}`,
      {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ cfg }),
      },
    );
    if (!res.ok) throw new Error(`Could not save status configuration (${res.status})`);
  } catch (error) {
    if (options?.strict) throw error;
    /* fire-and-forget: localStorage is the primary store; ignore network errors */
  }
}

/* ── Status ledger (CRMStatusLedger) ───────────────────────────────────── */
export type LedgerEntry = {
  ticketId: string;
  module: string;
  oldStatus: string | null;
  newStatus: string;
  changedAt: string; // ISO UTC
  changedBy: string | null;
};

/**
 * Fetch status-change ledger rows for a module within a UTC time window.
 * `truncated` = the server row cap was hit, so the window is NOT fully
 * covered and callers must not claim complete per-period counts.
 * Returns null on any error so Reports degrade gracefully to all-time fallbacks.
 */
export type LedgerFeed = { rows: LedgerEntry[]; truncated: boolean; since: string | null };
export async function fetchStatusLedger(
  module: string,
  since: string,
  until: string,
): Promise<LedgerFeed | null> {
  try {
    const params = new URLSearchParams({ module, since, until });
    const res = await fetchWithTimeout(`${API}/status-ledger?${params}`, { headers: authHeaders() });
    if (!res.ok) return null;
    const data = (await res.json()) as { rows?: LedgerEntry[]; truncated?: boolean; since?: string | null };
    if (!Array.isArray(data.rows)) return null;
    return { rows: data.rows, truncated: data.truncated === true, since: typeof data.since === "string" ? data.since : null };
  } catch {
    return null;
  }
}

export async function getAllContacts(): Promise<ContactSlim[]> {
  const res = await fetchWithTimeout(`${API}/company-contacts?all=1`, { headers: authHeaders() });
  const j = await handleResponse(res) as { data?: ContactSlim[] };
  return Array.isArray(j?.data) ? j.data : [];
}

export interface StatusHistoryResponse { rows: StatusChangeItem[]; since: string | null; truncated?: boolean }

export async function getStatusHistory(): Promise<StatusHistoryResponse> {
  return cached("status-history", async () => {
    const res = await fetchWithTimeout(`${API}/status-history`, { headers: authHeaders() });
    return handleResponse(res) as Promise<StatusHistoryResponse>;
  });
}

export interface FieldChangeItem {
  fieldName: string;
  /** Canonical decimal strings (e.g. "1500000"), null = blank */
  oldValue: string | null;
  newValue: string | null;
  /** ISO UTC timestamp */
  changedAt: string;
  /** Username of the editor; null for imports/system writes */
  changedBy: string | null;
  changedById?: string | null;
  source: "user" | "auto" | "import" | string;
}

export type AuditOutcome = "success" | "failed" | "denied" | "partial" | "cancelled";
export type AuditAccountStatus =
  | "secured" | "invite_pending" | "deactivated" | "removed" | "system" | "unknown";

export interface AuditTrailItem {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  actorType: string;
  accountStatus: AuditAccountStatus;
  action: string;
  outcome: AuditOutcome;
  entityType: string | null;
  entityId: string | null;
  entityName: string | null;
  source: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  changes: unknown;
  failureReason: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface AuditTrailResponse {
  rows: AuditTrailItem[];
  nextCursor: string | null;
  truncated: boolean;
  sensitiveDetailsIncluded: boolean;
  /** True only when the viewer can see IP/user-agent/request details. */
  networkDetailsIncluded?: boolean;
  retentionPolicy: "indefinite";
}

export interface AuditHealth {
  writeFailures: number;
  lastWriteFailureAt: string | null;
  lastWriteSuccessAt: string | null;
  durableFailureCount: number;
}

export async function getAuditTrail(params: {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  actorEmail?: string;
  subjectId?: string;
  subjectEmail?: string;
  outcome?: AuditOutcome;
  action?: string;
  source?: string;
  search?: string;
  start?: string;
  end?: string;
  before?: string;
  limit?: number;
  eventKind?: "interaction" | "change";
}): Promise<AuditTrailResponse> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") query.set(key, String(value));
  }
  const res = await fetchWithTimeout(`${API}/audit-trail?${query}`, { headers: authHeaders() });
  return handleResponse(res) as Promise<AuditTrailResponse>;
}

export interface AuditEmailResponse {
  ok: boolean;
  message: string;
  messageId?: string;
  error?: string;
}

export async function sendAuditEmail(params: {
  to: string[];
  subject: string;
  body: string;
}): Promise<AuditEmailResponse> {
  const res = await fetchWithTimeout(`${API}/audit-email`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return handleResponse(res) as Promise<AuditEmailResponse>;
}

export async function getAuditHealth(): Promise<AuditHealth | null> {
  const res = await fetchWithTimeout(`${API}/audit-health`, { headers: authHeaders() });
  if (res.status === 403) return null;
  const data = await handleResponse(res) as AuditHealth & { ok?: boolean };
  return data;
}

// ── Resource weekly workload ──────────────────────────────────────────────────
// Mirrors the ResourceWeekAllocations shape produced by getResourceWeekAllocationsRds
// in rds-provider.ts. Each entry in `weeks` represents one project's exact
// person-hours for one Monday-aligned week.

export interface ResourceWeekAllocRow {
  /** Project ticket ID */
  projectId: string;
  /** Display name of the project */
  projectName: string;
  /** Monday of the week — YYYY-MM-DD (UTC) */
  weekStart: string;
  /** Sunday of the week — YYYY-MM-DD (UTC) */
  weekEnd: string;
  /** Total hours for this project in this week */
  hours: number;
  /** hours / fullWeekHours × 100, rounded to 2 decimal places */
  pct: number;
  /** ResourceAllocation row IDs that contributed to this bucket */
  allocationIds: number[];
  isLocked: boolean;
  isNonChargeable: boolean;
  isSoftAllocation: boolean;
}

export interface ResourceWeekAllocations {
  resourceId: string;
  /** Range start as supplied (YYYY-MM-DD) */
  start: string;
  /** Range end as supplied (YYYY-MM-DD) */
  end: string;
  /** Tenant's "hours in a full week" setting (default 40) */
  fullWeekHours: number;
  weeks: ResourceWeekAllocRow[];
  /**
   * Every live project the person is assigned to — INCLUDING projects whose
   * allocation rows are all zero hours (they never appear in `weeks`, which
   * only carries hours>0 buckets). Optional because older server builds
   * omit it; consumers must tolerate its absence.
   */
  projects?: { projectId: string; projectName: string }[];
}

/**
 * Fetch tenant-scoped weekly workload for a single resource.
 *
 * @param resourceId  GUID of the resource
 * @param start       Range start, YYYY-MM-DD (Monday-aligned recommended)
 * @param end         Range end,   YYYY-MM-DD
 *
 * Throws on any non-2xx response (including 400 / 401 / 502) so the caller
 * receives an honest error rather than a silently empty result.
 */
export async function getResourceWeekAllocations(
  resourceId: string,
  start: string,
  end: string,
): Promise<ResourceWeekAllocations> {
  const params = new URLSearchParams({ resourceId, start, end });
  const res = await fetchWithTimeout(`${API}/resource-week-allocations?${params}`, {
    headers: authHeaders(),
  });
  return handleResponse(res) as Promise<ResourceWeekAllocations>;
}

export interface FieldHistoryResponse { rows: FieldChangeItem[]; truncated?: boolean }

/** Deliberately uncached — fetched when the history popup opens so a change
 *  saved seconds ago is already in the trail. Returns null on any failure. */
export async function getRecordFieldHistory(recordId: string): Promise<FieldHistoryResponse | null> {
  try {
    const res = await fetchWithTimeout(`${API}/record-field-history?record=${encodeURIComponent(recordId)}`, { headers: authHeaders() });
    return await handleResponse(res) as FieldHistoryResponse;
  } catch {
    return null;
  }
}

/* ── Actuals vs Forecast (financial graphs & reports) ────────────────────
 * Weekly point-in-time snapshots computed server-side (api-server
 * lib/actuals-forecast.ts). Frozen history is stored, never recomputed from
 * today's plan. Variance = forecast TD − actual TD, POSITIVE = favorable. */

export interface AfFlagsInfo {
  useImportedActuals: boolean;
  usePlannedAsActualFallback: boolean;
}

export interface AfWeekRow {
  weekMonday: string; // ISO date, UTC Monday
  actualHoursTd: number;
  forecastRemainingHours: number;
  forecastTotalHours: number; // EAC hours = actual TD + remaining
  forecastHoursTd: number;    // plan TD (variance input)
  actualCostTd: number;
  forecastRemainingCost: number;
  forecastTotalCost: number;
  forecastCostTd: number;
  actualBillTd: number;
  forecastRemainingBill: number;
  forecastTotalBill: number;
  forecastBillTd: number;
  hoursVariance: number; // forecast TD − actual TD (positive = favorable)
  costVariance: number;
  billVariance: number;
  substitutedHours: number;   // cumulative TD (planned-as-actual fallback)
  unratedActualHours: number; // cumulative TD hours priced at $0
  /** An imported actual-hours row exists for this project/week. Explicit
   * imported zero is covered; absence is not a numeric zero. */
  actualsCovered: boolean;
  final: boolean;
  backfilled: boolean;
  computedAt: string | null;
}

export interface AfOverviewProject extends AfWeekRow { ticket: string }

export type AfOverview =
  | { available: true; currentWeek: string; flags: AfFlagsInfo; building?: boolean; projects: AfOverviewProject[] }
  | { available: false; restricted?: boolean; reason?: string };

export interface AfDetailRow {
  weekMonday: string;
  person: string;      // GUID lowercase, "" = open (unstaffed) demand
  personName: string;
  roleName: string;
  division: string;
  actualHours: number;   actualCost: number;   actualBill: number;
  forecastHours: number; forecastCost: number; forecastBill: number;
  remainingHours: number; remainingCost: number; remainingBill: number;
  substituted: boolean;
  rateApproximated: boolean;
  missingDivision: boolean;
  /** An imported actual-hours row exists for this person/project/week. */
  actualsCovered: boolean;
  /** Current account status of this forecast person. */
  enabled?: boolean;
  tenantId?: string;
}

/** Re-enable an account from any staffing surface. The server remains the
 * authority for the manage-staff permission; callers must also hide this
 * operation unless their resolved capability permits it. */
export async function reactivateMember(userGuid: string, tenantId?: string): Promise<void> {
  const targetTenant = tenantId?.trim() || getStoredUser()?.tenant?.trim() || "";
  const res = await fetchWithTimeout("/api/onboarding/members/active", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ userGuid, ...(targetTenant ? { tenantId: targetTenant } : {}), active: true }),
  });
  await handleResponse(res);
  // Account state affects roster, every project-team projection and forecast
  // person display. The sync bus busts their fetch/query caches before mounted
  // consumers refetch, including sibling tabs.
  notifyDataChanged(["staff", "team", "allocation"]);
}

export interface AfMilestone { title: string; startDate: string | null; dueDate: string | null }

export type AfProjectData =
  | {
      available: true;
      ticket: string;
      currentWeek: string;
      flags: AfFlagsInfo;
      weeks: AfWeekRow[];
      detail: AfDetailRow[];
      milestones: AfMilestone[];
    }
  | { available: false; restricted?: boolean; reason?: string };

/** null = request failed (network/server) — distinct from a clean
 *  { available: false } "this data source doesn't support it" answer. */
export async function getAfOverview(): Promise<AfOverview | null> {
  try {
    const res = await fetchWithTimeout("/api/actuals-forecast/overview", { headers: authHeaders() }, 60_000);
    if (res.status === 403) {
      return { available: false, restricted: true, reason: "Your access level doesn't include financial data." };
    }
    if (!res.ok) return null;
    return (await res.json()) as AfOverview;
  } catch {
    return null;
  }
}

export async function getAfProject(ticket: string): Promise<AfProjectData | null> {
  try {
    const res = await fetchWithTimeout(
      `/api/actuals-forecast/project/${encodeURIComponent(ticket)}`,
      { headers: authHeaders() },
      60_000,
    );
    if (res.status === 403) {
      return { available: false, restricted: true, reason: "Your access level doesn't include financial data." };
    }
    if (!res.ok) return null;
    return (await res.json()) as AfProjectData;
  } catch {
    return null;
  }
}

export interface AfImportBatchRow {
  id: number;
  filename: string;
  uploadedBy: string;
  rowsTotal: number | null;
  rowsOk: number | null;
  rowsException: number | null;
  status: string;
  createdAt: string | null;
  completedAt: string | null;
}

export interface AfImportExceptionRow {
  id: number;
  reason: string;
  detail: string;
  row: unknown;
  createdAt: string | null;
}

export interface AfImportRowInput {
  /** Identifier the server matches on — the Email cell when the file has
   *  one (unique), otherwise the Name/username/ID cell. */
  employee: string;
  ticket: string;
  week: string; // ISO date (snapped to UTC Monday server-side)
  hours: number;
  role?: string;
  division?: string;
  /** Original Email / Name cells, kept for the client pre-check and the
   *  preview; the server reads `employee`. */
  email?: string;
  name?: string;
}

/* Import calls THROW on failure — the import page must fail loudly, never
 * pretend a chunk was accepted (see the import-submit rule elsewhere). */

export async function beginActualsImport(filename: string): Promise<number> {
  const res = await fetchWithTimeout("/api/actuals-forecast/imports", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ filename }),
  }, 60_000);
  const data = await handleResponse(res) as { batchId?: number };
  const id = Number(data?.batchId);
  if (!Number.isFinite(id) || id <= 0) throw new Error("Server did not return a batch id.");
  return id;
}

export async function sendActualsImportRows(
  batchId: number,
  rows: AfImportRowInput[],
): Promise<{ accepted: number; exceptions: number }> {
  const res = await fetchWithTimeout(`/api/actuals-forecast/imports/${batchId}/rows`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ rows }),
  }, 120_000);
  const data = await handleResponse(res) as { accepted?: number; exceptions?: number };
  return { accepted: Number(data?.accepted ?? 0), exceptions: Number(data?.exceptions ?? 0) };
}

export async function commitActualsImport(
  batchId: number,
  rowsTotal: number,
): Promise<{ tickets: number }> {
  // Commit reruns snapshots for every affected project — can be slow.
  const res = await fetchWithTimeout(`/api/actuals-forecast/imports/${batchId}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ rowsTotal }),
  }, 300_000);
  const data = await handleResponse(res) as { tickets?: number };
  return { tickets: Number(data?.tickets ?? 0) };
}

/** Abort a failed upload — the server wipes the batch's rows + exceptions so
 * nothing half-uploaded lingers. Loud-throw like the other import calls. */
export async function abortActualsImport(batchId: number): Promise<void> {
  const res = await fetchWithTimeout(`/api/actuals-forecast/imports/${batchId}/abort`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({}),
  }, 60_000);
  await handleResponse(res);
}

export async function listActualsImports(): Promise<AfImportBatchRow[]> {
  const res = await fetchWithTimeout("/api/actuals-forecast/imports", { headers: authHeaders() });
  const data = await handleResponse(res) as { batches?: AfImportBatchRow[] };
  return Array.isArray(data?.batches) ? data.batches : [];
}

export async function listActualsImportExceptions(batchId: number): Promise<AfImportExceptionRow[]> {
  const res = await fetchWithTimeout(`/api/actuals-forecast/imports/${batchId}/exceptions`, { headers: authHeaders() });
  const data = await handleResponse(res) as { exceptions?: AfImportExceptionRow[] };
  return Array.isArray(data?.exceptions) ? data.exceptions : [];
}

/** Admin: recompute snapshot history (optionally one project / from a week). */
export async function rebuildAfSnapshots(opts?: { ticket?: string; fromWeek?: string }): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout("/api/actuals-forecast/rebuild", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(opts ?? {}),
  }, 300_000);
  return await handleResponse(res) as Record<string, unknown>;
}
