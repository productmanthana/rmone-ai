import { liveTaskDataQuery } from "./scheduleWindow";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API_SERVER_PATH = "/api/rmone";

/* ─── Client-side cache: memory (fast) + AsyncStorage disk (survives restarts) */
interface CacheEntry<T> { data: T; fetchedAt: number; promise?: Promise<T> }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _cache = new Map<string, CacheEntry<any>>();
const CLIENT_CACHE_TTL   = 5  * 60 * 1000; // 5 min fresh window
const DISK_CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 h — disk entries are stale but usable
const DISK_PREFIX = "rmone_cache_v1:";

/** Write to AsyncStorage in the background (never blocks callers) */
function diskWrite(key: string, data: unknown, fetchedAt: number): void {
  AsyncStorage.setItem(DISK_PREFIX + key, JSON.stringify({ data, fetchedAt })).catch(() => {});
}

/** Try to load a disk-persisted entry. Returns undefined if missing/expired/corrupt. */
async function diskRead<T>(key: string): Promise<CacheEntry<T> | undefined> {
  try {
    const raw = await AsyncStorage.getItem(DISK_PREFIX + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { data: T; fetchedAt: number };
    if (Date.now() - parsed.fetchedAt > DISK_CACHE_MAX_AGE) return undefined;
    return { data: parsed.data, fetchedAt: parsed.fetchedAt };
  } catch {
    return undefined;
  }
}

let _diskWarmed = false;
export async function warmDiskCache(): Promise<void> {
  if (_diskWarmed) return;
  _diskWarmed = true;
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter(k => k.startsWith(DISK_PREFIX));
    if (cacheKeys.length === 0) return;
    const pairs = await AsyncStorage.multiGet(cacheKeys);
    const now = Date.now();
    let loaded = 0;
    for (const [storageKey, raw] of pairs) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { data: unknown; fetchedAt: number };
        if (now - parsed.fetchedAt > DISK_CACHE_MAX_AGE) continue;
        const memKey = storageKey.slice(DISK_PREFIX.length);
        if (!_cache.has(memKey)) {
          _cache.set(memKey, { data: parsed.data, fetchedAt: parsed.fetchedAt });
          loaded++;
        }
      } catch { /* skip corrupt entries */ }
    }
    console.log(`[cache] Warmed ${loaded} entries from disk`);
  } catch (e) {
    console.warn("[cache] warmDiskCache error:", e);
  }
}

// Single source of truth for the module-records cache key version. Bump this
// whenever the server-side record schema changes (it invalidates stale disk
// cache). v4 = RDS records backfill CRMCompanyLookupName from the CRMCompany
// join server-side. v5 = slimmed LIST payloads (api-server
// lib/records-list-slim.ts): empty values omitted, identical alias twins
// (CompanyName/ShortName/BusinessUnitName) deduped, long note fields
// truncated to a preview cap. All readers (isCacheFresh / peekModuleRecords)
// and the writer (getModuleRecords) share this constant so the prefixes
// can't drift.
const MODULE_CACHE_PREFIX = "module:v5";

export function isCacheFresh(module: string): boolean {
  const now = Date.now();
  for (const [k, v] of _cache.entries()) {
    if (k.startsWith(`${MODULE_CACHE_PREFIX}:${module}:`) && v.data && v.fetchedAt > 0 && now - v.fetchedAt < CLIENT_CACHE_TTL) return true;
  }
  return false;
}

export function isResourceCacheFresh(): boolean {
  const now = Date.now();
  for (const [k, v] of _cache.entries()) {
    if (k.startsWith("resource-allocations:") && v.data && v.fetchedAt > 0 && now - v.fetchedAt < CLIENT_CACHE_TTL) return true;
  }
  return false;
}

/**
 * Stale-while-revalidate cache with disk persistence.
 * - Memory fresh  (< 5 min): return instantly.
 * - Memory stale / disk hit : return stale immediately, revalidate in background.
 * - No cache at all         : try disk, then blocking fetch.
 */
function cached<T>(
  key: string,
  fetcher: () => Promise<T>,
  onUpdate?: (fresh: T) => void
): Promise<T> {
  const entry = _cache.get(key) as CacheEntry<T> | undefined;
  const now = Date.now();

  if (entry && now - entry.fetchedAt < CLIENT_CACHE_TTL) {
    return Promise.resolve(entry.data);
  }

  if (entry) {
    // Placeholder (inflight) — return the shared in-flight promise so caller waits
    if (entry.fetchedAt === 0 && entry.promise) return entry.promise;
    // Stale memory — return stale immediately, revalidate in background
    if (!entry.promise) {
      const p: Promise<T> = fetcher().then(fresh => {
        const next: CacheEntry<T> = { data: fresh, fetchedAt: Date.now() };
        _cache.set(key, next);
        diskWrite(key, fresh, next.fetchedAt);
        if (onUpdate) onUpdate(fresh);
        return fresh;
      }).catch(() => entry.data).finally(() => {
        const cur = _cache.get(key) as CacheEntry<T> | undefined;
        if (cur) cur.promise = undefined;
      });
      entry.promise = p;
    }
    return Promise.resolve(entry.data);
  }

  const genAtStart = _bustGeneration;
  const inflight: Promise<T> = diskRead<T>(key).then(disk => {
    if (disk && _bustGeneration === genAtStart) {
      const seeded: CacheEntry<T> = { ...disk };
      _cache.set(key, seeded);
      const bg: Promise<T> = fetcher().then(fresh => {
        const next: CacheEntry<T> = { data: fresh, fetchedAt: Date.now() };
        _cache.set(key, next);
        diskWrite(key, fresh, next.fetchedAt);
        if (onUpdate) onUpdate(fresh);
        return fresh;
      }).catch(() => disk.data).finally(() => {
        const cur = _cache.get(key) as CacheEntry<T> | undefined;
        if (cur) cur.promise = undefined;
      });
      seeded.promise = bg;
      return disk.data;
    }
    return fetcher().then(data => {
      const next: CacheEntry<T> = { data, fetchedAt: Date.now() };
      _cache.set(key, next);
      diskWrite(key, data, next.fetchedAt);
      return data;
    });
  }).catch(err => {
    _cache.delete(key);
    throw err;
  });
  _cache.set(key, { data: undefined as unknown as T, fetchedAt: 0, promise: inflight });
  return inflight;
}

let _bustGeneration = 0;
const _bustListeners = new Set<() => void>();
export function onCacheBust(fn: () => void): () => void {
  _bustListeners.add(fn);
  return () => { _bustListeners.delete(fn); };
}
export function getCacheBustGeneration() { return _bustGeneration; }

/** Force-clear one or all cache entries (e.g. after pull-to-refresh) */
export function bustCache(key?: string) {
  if (key) {
    _cache.delete(key);
    AsyncStorage.removeItem(DISK_PREFIX + key).catch(() => {});
  } else {
    _cache.clear();
    AsyncStorage.getAllKeys().then(keys => {
      const mine = keys.filter(k => k.startsWith(DISK_PREFIX));
      if (mine.length) AsyncStorage.multiRemove(mine).catch(() => {});
    }).catch(() => {});
  }
  _bustGeneration++;
  for (const fn of _bustListeners) { try { fn(); } catch {} }
}

export function bustCacheByPrefix(prefix: string) {
  for (const k of _cache.keys()) {
    if (k.startsWith(prefix)) _cache.delete(k);
  }
  AsyncStorage.getAllKeys().then(keys => {
    const mine = keys.filter(k => k.startsWith(DISK_PREFIX + prefix));
    if (mine.length) AsyncStorage.multiRemove(mine).catch(() => {});
  }).catch(() => {});
}

/** Synchronous cache peek — returns stale data if available, undefined otherwise */
export function peekModuleRecords(module: string): ModuleRecordsResponse | undefined {
  for (const [k, v] of _cache.entries()) {
    if (k.startsWith(`${MODULE_CACHE_PREFIX}:${module}:`) && v.data) return v.data as ModuleRecordsResponse;
  }
  return undefined;
}

export function peekResourceAllocations(): ResourceAllocationsResponse | undefined {
  for (const [k, v] of _cache.entries()) {
    if (k.startsWith("resource-allocations:") && v.data) return v.data as ResourceAllocationsResponse;
  }
  return undefined;
}

export function peekUtilization(startDate: string, endDate: string, mode: string): AllocationUtilizationResponse | undefined {
  const key = `util:v8:${startDate}:${endDate}:${mode}`;
  const entry = _cache.get(key);
  return entry?.data as AllocationUtilizationResponse | undefined;
}

export function getApiBase(): string {
  // Preferred: explicit, fully-qualified API base URL. EAS production builds
  // pointed at an on-prem VM should set this to e.g. https://rmone.acme.com:5000
  // so the mobile app talks to the merged single-process backend.
  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
  if (explicit) return explicit.replace(/\/+$/, "");
  // Development / legacy fallback: bare domain that gets https:// prepended.
  const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
  if (domain) return `https://${domain}`;
  return "http://localhost:8080";
}

const API_TIMEOUT = 45_000;

const _logBuf: string[] = [];
let _logTimer: ReturnType<typeof setTimeout> | null = null;
export function debugLog(msg: string) {
  console.warn(msg);
  _logBuf.push(msg);
  if (!_logTimer) {
    _logTimer = setTimeout(() => {
      _logTimer = null;
      const batch = _logBuf.splice(0);
      const base = getApiBase();
      fetch(`${base}/api/rmone/debug-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      }).catch(() => {});
    }, 200);
  }
}

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fetchWithTimeout(url: string, opts?: RequestInit, timeoutMs = API_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function getToken(): Promise<string | null> {
  const token = await AsyncStorage.getItem("rmone_token");
  if (!token) console.warn("[auth] getToken returned null — user may not be logged in");
  return token;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return token
    ? { Authorization: `Bearer ${token}`, "X-RMOne-Client": "mobile" }
    : { "X-RMOne-Client": "mobile" };
}

/**
 * Record a non-sensitive interaction without affecting the calling screen.
 *
 * This deliberately accepts a route template rather than record data: audit
 * telemetry must not include field values, query parameters, or credentials.
 * Failure (including an unavailable API while offline) is intentionally
 * ignored, since analytics must never block navigation or user work.
 */
export type AuditScreen =
  | "home" | "alerts" | "chat" | "daily-briefing" | "forecast" | "login"
  | "profile" | "projects" | "project-create" | "project-detail" | "rate-card"
  | "resources" | "rfp" | "screenshot" | "superadmin";

export type AuditInteractionType =
  | "view" | "open" | "close" | "navigate" | "filter" | "search" | "export" | "action";

export type AuditInteractionEntityType =
  | "project" | "opportunity" | "lead" | "company" | "contact" | "staff"
  | "resource" | "allocation" | "configuration" | "dashboard" | "report"
  | "audit-trail" | "list" | "record";

export type AuditInteractionTarget =
  | { screen: AuditScreen; entityType?: never; entityId?: never }
  | { screen?: never; entityType: AuditInteractionEntityType; entityId?: string };

const AUDIT_ENTITY_ID = /^[a-z0-9][a-z0-9._:-]{0,199}$/i;

function emitAuditInteraction(interactionType: AuditInteractionType, target: AuditInteractionTarget): void {
  void (async () => {
    try {
      if ("entityId" in target && target.entityId != null && !AUDIT_ENTITY_ID.test(target.entityId)) return;
      const headers = await authHeaders();
      const body = "screen" in target
        ? { interactionType, screen: target.screen }
        : {
            interactionType,
            entityType: target.entityType,
            ...(target.entityId ? { entityId: target.entityId } : {}),
          };
      await fetchWithTimeout(
        `${getApiBase()}${API_SERVER_PATH}/audit-interaction`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        10_000,
      );
    } catch {
      // Deliberately fire-and-forget. Audit telemetry is non-critical.
    }
  })();
}

export const auditView = (screen: AuditScreen): void =>
  emitAuditInteraction("view", { screen });
export const auditOpen = (target: AuditInteractionTarget): void =>
  emitAuditInteraction("open", target);
export const auditClose = (target: AuditInteractionTarget): void =>
  emitAuditInteraction("close", target);
export const auditFilter = (target: AuditInteractionTarget): void =>
  emitAuditInteraction("filter", target);
export const auditSearch = (target: AuditInteractionTarget): void =>
  emitAuditInteraction("search", target);
export const auditExport = (target: AuditInteractionTarget): void =>
  emitAuditInteraction("export", target);
export const auditAction = (target: AuditInteractionTarget): void =>
  emitAuditInteraction("action", target);

export type AuditOutcome = "success" | "failed" | "denied" | "partial" | "cancelled";
export interface AuditTrailItem {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  actorType: string;
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
  outcome?: AuditOutcome;
  action?: string;
  source?: string;
  search?: string;
  start?: string;
  end?: string;
  before?: string;
  limit?: number;
}): Promise<{ rows: AuditTrailItem[]; nextCursor: string | null; retentionPolicy: "indefinite" }> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") query.set(key, String(value));
  });
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${getApiBase()}${API_SERVER_PATH}/audit-trail?${query}`, { headers });
  if (!res.ok) throw new Error(`Audit trail request failed (${res.status})`);
  const data = await res.json() as { rows?: AuditTrailItem[]; nextCursor?: string | null; retentionPolicy?: "indefinite" };
  return { rows: Array.isArray(data.rows) ? data.rows : [], nextCursor: data.nextCursor ?? null, retentionPolicy: data.retentionPolicy ?? "indefinite" };
}

export async function getAuditHealth(): Promise<AuditHealth | null> {
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${getApiBase()}${API_SERVER_PATH}/audit-health`, { headers });
  if (res.status === 403) return null;
  if (!res.ok) throw new Error(`Audit health request failed (${res.status})`);
  return await res.json() as AuditHealth;
}
export interface FieldChangeItem {
  fieldName: string;
  /** Canonical decimal strings, or null when the value was blank. */
  oldValue: string | null;
  newValue: string | null;
  /** ISO UTC timestamp. */
  changedAt: string;
  /** Username of the editor; null for imports/system writes. */
  changedBy: string | null;
  changedById?: string | null;
  source: "user" | "auto" | "import" | string;
}

export interface FieldHistoryResponse {
  rows: FieldChangeItem[];
  truncated?: boolean;
}

interface FieldHistoryRequestOverrides {
  base: string;
  headers: Record<string, string>;
  fetcher: (url: string, options?: RequestInit) => Promise<Response>;
}

/** Deliberately uncached: the history sheet opens with the latest changes. */
export async function getRecordFieldHistory(
  recordId: string,
  overrides?: FieldHistoryRequestOverrides,
): Promise<FieldHistoryResponse | null> {
  try {
    const base = overrides?.base ?? getApiBase();
    const headers = overrides?.headers ?? await authHeaders();
    const url = `${base}${API_SERVER_PATH}/record-field-history?record=${encodeURIComponent(recordId)}`;
    const res = overrides
      ? await overrides.fetcher(url, { headers })
      : await fetchWithTimeout(url, { headers });
    return await handleResponse(res) as FieldHistoryResponse;
  } catch {
    // Keep the mobile surface honest: a denied or unavailable history request
    // must not look like an empty audit trail.
    return null;
  }
}

/** Headers required by /api/alerts/* — adds tenant + user GUID. */
async function alertsHeaders(): Promise<Record<string, string>> {
  const [token, tenant, userGuid] = await Promise.all([
    AsyncStorage.getItem("rmone_token"),
    AsyncStorage.getItem("rmone_tenant"),
    AsyncStorage.getItem("rmone_userId"),
  ]);
  const out: Record<string, string> = {};
  if (token) out["Authorization"] = `Bearer ${token}`;
  if (tenant) out["x-rmone-tenant"] = tenant;
  if (userGuid) out["x-rmone-user-guid"] = userGuid;
  return out;
}

/** Backend-derived alert rows (forecast diffs, exec approvals, AI
 *  escalations). Mirrors web `getAlertsFeed`. */
export interface BackendAlertRow {
  alertKey: string;
  tone: "high" | "med" | "info";
  title: string;
  sub?: string;
  source: "forecast-shift" | "exec-approval" | "ai-escalation" | "unresolved";
}
export async function getAlertsFeed(): Promise<{ rows: BackendAlertRow[]; generatedAt: number }> {
  try {
    const headers = await alertsHeaders();
    const base = getApiBase();
    const res = await fetchWithTimeout(`${base}/api/alerts/feed`, { headers });
    if (!res.ok) return { rows: [], generatedAt: 0 };
    return (await res.json()) as { rows: BackendAlertRow[]; generatedAt: number };
  } catch {
    return { rows: [], generatedAt: 0 };
  }
}

export async function setAlertState(opts: {
  alertKey: string;
  status: "resolved" | "dismissed" | "snoozed" | "open";
  snoozedUntil?: string | null;
  note?: string | null;
}): Promise<boolean> {
  try {
    const headers = await alertsHeaders();
    const base = getApiBase();
    const res = await fetchWithTimeout(`${base}/api/alerts/state`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function handleResponse(res: Response) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`${res.status}: ${text}`) as Error & { status?: number; apiUnavailable?: boolean; friendlyMessage?: string };
    err.status = res.status;
    // Parse JSON error bodies so callers can surface a human-readable message
    // instead of the raw "403: {…}" blob. Mirrors the web API layer's contract:
    //   • 503 + apiUnavailable → friendly "APIs under development" message
    //   • any non-2xx + error_description → OAuth-style friendly text
    //   • any non-2xx + error / message → use whichever is present
    // The stage-rules gate returns 403 + { error: "<human text>", code: "…",
    // error_description: "<human text>" } — this extracts that for the caller.
    try {
      const parsed = JSON.parse(text) as {
        apiUnavailable?: boolean; message?: string;
        error?: string; error_description?: string;
      };
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
    } catch { /* non-JSON body — keep the raw message */ }
    throw err;
  }
  return res.json();
}

export async function login(tenant: string, username: string, password: string) {
  const base = getApiBase();
  const params = new URLSearchParams({ grant_type: "password", username, password, tenant });
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  return handleResponse(res);
}

export async function getUserProfile(userName: string) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/profile?UserName=${encodeURIComponent(userName)}`, { headers });
  return handleResponse(res);
}

export interface MyCapabilities {
  editData: boolean;
  advanceStages: boolean;
  editFinancials: boolean;
  manageStaff: boolean;
  manageSettings: boolean;
  importPage: boolean;
}

export const NO_CAPABILITIES: MyCapabilities = {
  editData: false,
  advanceStages: false,
  editFinancials: false,
  manageStaff: false,
  manageSettings: false,
  importPage: false,
};

export async function getMyCapabilities(): Promise<MyCapabilities | null> {
  try {
    const base = getApiBase();
    const headers = await authHeaders();
    const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/my-capabilities`, { headers });
    if (!res.ok) return null;
    // Response shape: { acl, caps: { editData, editFinancials, … }, groupIds, … }
    const data = await res.json() as { caps?: Partial<MyCapabilities> } | null;
    const caps = data?.caps;
    if (!caps) return null;
    // The absence of an individual value must never grant it. This also makes
    // partially deployed capability responses safe while tenants upgrade.
    return {
      editData: caps.editData === true,
      advanceStages: caps.advanceStages === true,
      editFinancials: caps.editFinancials === true,
      manageStaff: caps.manageStaff === true,
      manageSettings: caps.manageSettings === true,
      importPage: caps.importPage === true,
    };
  } catch {
    return null;
  }
}

/* ── Per-record permissions (server-evaluated; short-lived screen state) ── */

export interface RecordPermissions {
  canEditData: boolean;
  canAdvanceStage: boolean;
  canEditFinancials: boolean;
  reason: string | null;
  degraded?: boolean;
}

/**
 * Fetch the server's current edit verdict for one record.
 *
 * This must use the RM ONE proxy prefix rather than a bare /api path. The
 * endpoint combines access-level capabilities with the current stage's
 * "who can edit" rule; mobile only displays/consumes that verdict.
 */
export async function getRecordPermissions(recordId: string): Promise<RecordPermissions> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(
    `${base}${API_SERVER_PATH}/record-permissions/${encodeURIComponent(recordId.trim())}`,
    { headers },
  );
  const body = await handleResponse(res) as Partial<RecordPermissions>;
  return {
    canEditData: body.canEditData === true,
    canAdvanceStage: body.canAdvanceStage === true,
    canEditFinancials: body.canEditFinancials === true,
    reason: typeof body.reason === "string" && body.reason.trim() ? body.reason : null,
    degraded: body.degraded === true,
  };
}

export async function getProjectList(userName?: string): Promise<string[]> {
  try {
    const base = getApiBase();
    const headers = await authHeaders();
    const url = userName
      ? `${base}${API_SERVER_PATH}/projects?UserName=${encodeURIComponent(userName)}`
      : `${base}${API_SERVER_PATH}/projects`;
    console.log(`[getProjectList] GET ${url}`);
    const res = await fetchWithTimeout(url, { headers });
    console.log(`[getProjectList] status=${res.status}`);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn(`[getProjectList] non-ok body: ${txt.slice(0, 200)}`);
      return [];
    }
    const data = (await res.json()) as Record<string, unknown>;
    const arr = Array.isArray(data.projects) ? data.projects as Record<string, unknown>[] : [];
    console.log(`[getProjectList] received ${arr.length} entries; sample keys: ${arr[0] ? Object.keys(arr[0]).join(",") : "(empty)"}`);
    return arr
      .map(p => String(p.TicketId ?? p.Code ?? p.ProjectCode ?? p.RecordCode ?? p.ProjectId ?? p.Id ?? ""))
      .filter(Boolean);
  } catch (e) {
    console.warn(`[getProjectList] error: ${String(e)}`);
    return [];
  }
}

export async function getProjectDetails(projectId: string, onUpdate?: (d: any) => void) {
  const base = getApiBase();
  const hdrs = await authHeaders();
  const key = `project-detail:${projectId}:${(hdrs.Authorization ?? "").slice(-16)}`;
  return cached(key, async () => {
    const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/project/${projectId}`, { headers: hdrs });
    return handleResponse(res);
  }, onUpdate);
}

export async function getCompanyProjects(companyName: string, companyId?: string) {
  const base = getApiBase();
  const headers = await authHeaders();
  let url = `${base}${API_SERVER_PATH}/company-projects?name=${encodeURIComponent(companyName)}`;
  if (companyId) url += `&companyId=${encodeURIComponent(companyId)}`;
  const res = await fetchWithTimeout(url, { headers });
  return handleResponse(res);
}

export async function getCompanyContacts(companyId: string) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/company-contacts?companyId=${encodeURIComponent(companyId)}`, { headers });
  return handleResponse(res);
}

export async function updateProject(payload: Record<string, unknown>) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/project`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await handleResponse(res);
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (d.Status === false) {
      const msgs =
        Array.isArray(d.ErrorMessages) && (d.ErrorMessages as string[]).length > 0
          ? (d.ErrorMessages as string[]).join("; ")
          : "RM ONE rejected the update";
      throw new Error(msgs);
    }
  }
  return data;
}

export async function smartUpdate(
  recordId: string,
  fields: { FieldName: string; Value: string; IsExcluded: boolean }[]
) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/smart-update`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ RecordId: recordId, Fields: fields }),
  });
  const data = (await handleResponse(res)) as Record<string, unknown>;
  if (data.ok === false) {
    throw new Error(String(data.error ?? "RM ONE rejected the update"));
  }
  return data;
}

/**
 * General per-field project update. Persists for both upstream-RM ONE tenants
 * and onboarded RDS/core2 tenants. Returns { ok, error? }.
 */
export async function updateFields(
  recordId: string,
  fields: { FieldName: string; Value: string }[]
): Promise<{ ok: boolean; updated?: string[]; error?: string }> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/update-fields`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ RecordId: recordId, Fields: fields }),
  });
  try {
    return (await handleResponse(res)) as { ok: boolean; updated?: string[]; error?: string };
  } catch (e) {
    // Non-2xx responses throw with a parsed friendlyMessage (e.g. the 403
    // from the server's stage-rules gate when required fields are missing or
    // the mover isn't in the allowed list) — surface that instead of the raw
    // "403: {json}" blob. Mirrors the web API layer's re-throw contract.
    const fm = (e as { friendlyMessage?: string } | null)?.friendlyMessage;
    throw fm ? new Error(fm) : e;
  }
}

/** Fetch the server-stored per-record stage config (Override Status
 *  customizations). Returns null when none is saved yet — the caller keeps
 *  its AsyncStorage copy. Mirrors the web api.ts getStageCfg contract. */
export async function getStageCfg(recordId: string, field: string): Promise<object | null> {
  try {
    const base = getApiBase();
    const headers = await authHeaders();
    const res = await fetchWithTimeout(
      // Stage-cfg lives at /api/stage-cfg (own router), NOT under the
      // /api/rmone proxy path — must match the web's STAGE_CFG_BASE.
      `${base}/api/stage-cfg/${encodeURIComponent(field)}/${encodeURIComponent(recordId)}`,
      { headers },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { ok: boolean; cfg: object | null };
    return data.cfg ?? null;
  } catch {
    return null; // offline or server error — AsyncStorage copy stays authoritative locally
  }
}

/** Persist a per-record stage config to the server so every device sees it.
 *  Fire-and-forget: AsyncStorage is the optimistic write-through cache. */
export async function saveStageCfgRemote(recordId: string, field: string, cfg: object): Promise<void> {
  try {
    const base = getApiBase();
    const headers = await authHeaders();
    await fetchWithTimeout(
      // Same /api/stage-cfg router as the web client (not /api/rmone).
      `${base}/api/stage-cfg/${encodeURIComponent(field)}/${encodeURIComponent(recordId)}`,
      {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ cfg }),
      },
    );
  } catch {
    /* fire-and-forget: ignore network errors, next save retries */
  }
}

/** Distinct option values for an editable dropdown field (status | sector). */
export async function getFieldOptions(field: "status" | "sector"): Promise<string[]> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/field-options/${field}`, { headers });
  const data = (await handleResponse(res)) as { options?: string[] };
  return Array.isArray(data.options) ? data.options : [];
}

export async function updateHoursAllocation(body: {
  ProjectID: string;
  OverrideAllocations: boolean;
  IsAllocationSplitted: boolean;
  IsMiscellaneousAllocation: boolean;
  CalledFrom: string;
  TaskId: number;
  Allocations: Record<string, unknown>[];
}) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/hours-allocation`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await handleResponse(res)) as Record<string, unknown>;
  if (data.Status === false || data.status === false) {
    const msgs = (data as any).ErrorMessages ?? (data as any).error ?? "Server rejected the allocation update";
    throw new Error(typeof msgs === "string" ? msgs : JSON.stringify(msgs));
  }
  if ((data as any).raw === "Error" || (data as any).raw === "error") {
    throw new Error("RM ONE rejected the allocation update. The member may not have a valid assignment record.");
  }
  return data;
}

export async function getFullProjectAllocations(projectId: string) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/project-allocations`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ ProjectID: projectId, TemplateID: null, ETCFromDate: localDateStr(new Date()), CurrentDate: localDateStr(new Date()), IncludePast: true }),
  });
  return (await handleResponse(res)) as Record<string, unknown>;
}

export interface ActiveAllocation {
  projectId: string;
  pct: number;
  startDate: string;
  endDate: string;
}

export interface LiveResource {
  id: string;
  name: string;
  username: string;
  role: string;
  /** False when the staff account has been deactivated. */
  enabled?: boolean;
  /** Owning tenant, supplied where a cross-tenant roster needs it. */
  tenantId?: string;
  /** Employee type from the staff profile ("Part-Time", "As Needed", …) — drives name color coding. */
  employeeType?: string;
  currentPct: number;
  totalProjects: number;
  allProjectIds: string[];
  activeProjects: string[];
  activeAllocations: ActiveAllocation[];
  lastActiveDate: string | null;
  email?: string;
}

export interface ResourceAllocationsResponse {
  total: number;
  bench: number;
  underUtil: number;
  healthy: number;
  overAllocated: number;
  resources: LiveResource[];
  projectNameMap?: Record<string, string>;
  userGuidToName?: Record<string, string>;
}

export async function getResourceAllocations(onUpdate?: (d: ResourceAllocationsResponse) => void): Promise<ResourceAllocationsResponse> {
  const base = getApiBase();
  const hdrs = await authHeaders();
  const key = `resource-allocations:${(hdrs.Authorization ?? "").slice(-16)}`;
  return cached(key, async () => {
    console.log("[api] Fetching resource-allocations…");
    const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/resource-allocations`, { headers: hdrs });
    const data = await handleResponse(res) as ResourceAllocationsResponse;
    console.log(`[api] resource-allocations → ${data?.resources?.length ?? 0} resources`);
    return data;
  }, onUpdate);
}

/** Reactivate a disabled staff account. The API enforces manageStaff server-side. */
export async function setOnboardingMemberActive(
  tenantId: string,
  userGuid: string,
  active: boolean,
): Promise<{ ok: boolean; userGuid: string; enabled: boolean }> {
  const base = getApiBase();
  const hdrs = await authHeaders();
  const res = await fetchWithTimeout(`${base}/api/onboarding/members/active`, {
    method: "POST",
    headers: { ...hdrs, "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId, userGuid, active }),
  });
  return (await handleResponse(res)) as { ok: boolean; userGuid: string; enabled: boolean };
}

export interface DemandItem {
  TicketId: string;
  Title: string;
  Role: string;
  PctAllocation: number;
  AllocationStartDate: string;
  AllocationEndDate: string;
  SoftAllocation: boolean;
  NonChargeable: boolean;
  IsLocked: boolean;
  ApproxContractValue: number;
  TargetStartDate: string | null;
  TargetCompletionDate: string | null;
  ActualStartDate: string | null;
  ActualCompletionDate: string | null;
  CloseDate: string | null;
}

export interface ResourceDemandsResponse {
  total: number;
  data: DemandItem[];
}

export async function getResourceDemands(onUpdate?: (d: ResourceDemandsResponse) => void): Promise<ResourceDemandsResponse> {
  const base = getApiBase();
  const hdrs = await authHeaders();
  const key = `resource-demands:${(hdrs.Authorization ?? "").slice(-16)}`;
  return cached(key, async () => {
    const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/resource-demands`, { headers: hdrs });
    return handleResponse(res) as Promise<ResourceDemandsResponse>;
  }, onUpdate);
}

export interface ResourceMasterRow {
  id: string;
  name: string;
  email?: string | null;
  office?: string | null;
  department?: string | null;
  capacity?: string | null;
  jobTitle?: string | null;
}

export async function getResourceMaster(): Promise<ResourceMasterRow[]> {
  const base = getApiBase();
  const hdrs = await authHeaders();
  return cached("resource-master", async () => {
    const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/resource-master`, { headers: hdrs });
    if (!res.ok) { console.warn("[getResourceMaster] HTTP", res.status); return []; }
    const json = await res.json() as unknown;
    return Array.isArray(json) ? json : ((json as any)?.data ?? []);
  }) as Promise<ResourceMasterRow[]>;
}

/** Fetch the tenant's configured work-week hours (Settings → workWeekHours).
 *  Falls back to 40 when the setting is missing or the request fails.
 *  Mirrors the web businessRules fetchEffectiveSettings → effective.workWeekHours. */
export async function getWorkWeekHours(): Promise<number> {
  return (await getMobileBusinessRules()).workWeekHours;
}

/** Tenant display-mode values for project/opportunity schedule surfaces —
 *  mirrors the web businessRules DisplayMode union. */
export type DisplayMode = "full" | "no-schedule" | "no-schedule-no-hours" | "no-schedule-no-grid" | "schedule-no-grid";

export interface MobileBusinessRules {
  workWeekHours: number;
  /** % at/below which (and > 0) a person is under-allocated. Default 60. */
  underAllocatedPct: number;
  /** % above which a person is over-capacity. Default 110. */
  overCapacityPct: number;
  /** % sweet-spot target utilization. Default 80. */
  targetUtilizationPct: number;
}

/** Fetch all capacity-threshold business rules from the settings endpoint.
 *  Falls back to sensible defaults when the setting is missing or the request fails.
 *  Mirrors the web getBusinessRules() / fetchEffectiveSettings flow. */
export async function getMobileBusinessRules(): Promise<MobileBusinessRules> {
  const base = getApiBase();
  const [headers, tenant] = await Promise.all([authHeaders(), AsyncStorage.getItem("rmone_tenant")]);
  // v2: key bumped when this payload's shape changed during schedule-window
  // work, so stale old-shape disk-cache entries can't serve for a TTL cycle.
  // NOTE: display modes are deliberately NOT part of this cached payload —
  // write gates need the VIEWER-resolved, uncached read below
  // (getEffectiveDisplayModes), never a 5-minute-stale tenant base value.
  const key = `mobile-business-rules-v2:${tenant ?? "global"}`;
  return cached(key, async () => {
    const fallback: MobileBusinessRules = { workWeekHours: 40, underAllocatedPct: 60, overCapacityPct: 110, targetUtilizationPct: 80 };
    try {
      const url = tenant
        ? `${base}/api/onboarding/settings?tenantId=${encodeURIComponent(tenant)}`
        : `${base}/api/onboarding/settings`;
      const res = await fetchWithTimeout(url, { headers });
      if (!res.ok) return fallback;
      const data = (await res.json()) as { effective?: Record<string, unknown> } | null;
      const eff = data?.effective ?? {};
      const num = (k: string, fallback: number) => {
        const v = eff[k];
        const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
        return Number.isFinite(n) && n > 0 ? n : fallback;
      };
      return {
        workWeekHours:       num("workWeekHours",       40),
        underAllocatedPct:   num("underAllocatedPct",   60),
        overCapacityPct:     num("overCapacityPct",     110),
        targetUtilizationPct: num("targetUtilizationPct", 80),
      };
    } catch {
      return fallback;
    }
  }) as Promise<MobileBusinessRules>;
}

export interface EffectiveDisplayModes {
  projectDisplayMode: DisplayMode;
  oppDisplayMode: DisplayMode;
}

const isDisplayMode = (v: unknown): v is DisplayMode =>
  v === "full" || v === "no-schedule" || v === "no-schedule-no-hours" ||
  v === "no-schedule-no-grid" || v === "schedule-no-grid";

/** The signed-in viewer's RESOLVED display modes — tenant base values plus
 *  the audience/exception rules the web resolves client-side, resolved
 *  SERVER-side for this user. Deliberately UNCACHED: this is read at write
 *  decisions (schedule-window clamping), where a minutes-stale mode must not
 *  gate a save. THROWS on failure or a malformed payload — callers must
 *  treat "mode unknown" explicitly (window unknown → no clamp; the server's
 *  own assign gate is the backstop) instead of silently assuming a mode.
 *  The web's per-record overrides live in web localStorage and remain
 *  invisible to mobile. */
export async function getEffectiveDisplayModes(): Promise<EffectiveDisplayModes> {
  const base = getApiBase();
  const hdrs = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/effective-display-modes`, { headers: hdrs });
  const data = (await handleResponse(res)) as { projectDisplayMode?: unknown; oppDisplayMode?: unknown } | null;
  const proj = data?.projectDisplayMode;
  const opp = data?.oppDisplayMode;
  if (!isDisplayMode(proj) || !isDisplayMode(opp)) throw new Error("effective-display-modes: malformed payload");
  return { projectDisplayMode: proj, oppDisplayMode: opp };
}

/** Effective display mode governing a record's schedule surfaces — OPM/LEM
 *  (and "LD" custom-prefix leads) follow the opportunity-side mode,
 *  everything else the project-side one. Uncached + throwing, like
 *  getEffectiveDisplayModes. */
export async function getEffectiveDisplayModeFor(module?: string | null): Promise<DisplayMode> {
  const modes = await getEffectiveDisplayModes();
  const m = String(module ?? "").trim().toUpperCase();
  return m === "OPM" || m === "LEM" || m === "LD" ? modes.oppDisplayMode : modes.projectDisplayMode;
}

export async function prefetchAll(): Promise<void> {
  console.log("[prefetch] Starting prefetchAll…");
  getResourceDemands().catch(e => console.warn("[prefetch] demands failed:", String(e)));
  getModuleRecords("PMM").catch(e => console.warn("[prefetch] PMM failed:", String(e)));
  getModuleRecords("OPM").catch(e => console.warn("[prefetch] OPM failed:", String(e)));
  getModuleRecords("LEM").catch(e => console.warn("[prefetch] LEM failed:", String(e)));
  getModuleRecords("COM").catch(e => console.warn("[prefetch] COM failed:", String(e)));
  getResourceAllocations().catch(e => console.warn("[prefetch] allocations failed:", String(e)));
  getModuleRecords("CON").catch(e => console.warn("[prefetch] CON failed:", String(e)));
}

export interface ModuleRecord {
  TicketId?: string;
  Title?: string;
  ShortName?: string;
  CRMProjectStatusChoice?: string;
  CRMOpportunityStatusChoice?: string;
  LeadStatus?: string;
  City?: string;
  ApproxContractValue?: number | null;
  TargetStartDate?: string | null;
  TargetCompletionDate?: string | null;
  ActualStartDate?: string | null;
  ActualCompletionDate?: string | null;
  CloseDate?: string | null;
  NumAllocations?: number | null;
  CRMBusinessUnitChoice?: string | null;
  SectorChoice?: string | null;
  BidDueDate?: string | null;
  SuccessChance?: number | null;
  ChanceOfSuccessChoice?: string | null;
  /** Resource group GUID — used by FindResourceBasedOnGroupNew to match skills */
  GroupID?: string | null;
  Status?: string | null;
  Closed?: boolean | null;
  ModuleStepLookup?: string | null;
  StageActionUsersUser?: string | null;
}

export interface ModuleRecordsResponse {
  Status: boolean;
  total: number;
  data: ModuleRecord[];
}

export async function getModuleRecords(module: "PMM" | "OPM" | "LEM" | "COM" | "CON", onUpdate?: (d: ModuleRecordsResponse) => void): Promise<ModuleRecordsResponse> {
  const base = getApiBase();
  const hdrs = await authHeaders();
  // Schema version lives in MODULE_CACHE_PREFIX (see its comment) — bumping it
  // invalidates stale disk cache so users get fresh data without pull-to-refresh.
  const key = `${MODULE_CACHE_PREFIX}:${module}:${(hdrs.Authorization ?? "").slice(-16)}`;
  return cached(key, async () => {
    const url = `${base}${API_SERVER_PATH}/records/${module}`;
    console.log(`[api] Fetching ${module} from ${url.slice(0, 60)}…`);
    const res = await fetchWithTimeout(url, { headers: hdrs });
    const data = await handleResponse(res) as ModuleRecordsResponse;
    console.log(`[api] ${module} → ${(data?.data ?? []).length} records`);
    return data;
  }, onUpdate);
}

export async function getProjectAllocations(projectID: string, onUpdate?: (d: any) => void) {
  const base = getApiBase();
  const hdrs = await authHeaders();
  const key = `project-alloc:${projectID}:${(hdrs.Authorization ?? "").slice(-16)}`;
  return cached(key, async () => {
    const res = await fetchWithTimeout(
      `${base}${API_SERVER_PATH}/allocations?projectID=${encodeURIComponent(projectID)}`,
      { headers: hdrs }
    );
    return handleResponse(res);
  }, onUpdate);
}

export interface WeeklyHourEntry { week: string; hours: number }
export interface ProjectTeamMember {
  name: string; role: string; bu: string; title: string;
  /** False when the underlying staff account is disabled. */
  enabled?: boolean;
  tenantId?: string;
  /** Employee type from the staff profile ("Part-Time", "As Needed", …) — drives name color coding. */
  employeeType?: string;
  eacHrs: number; etcHrs: number; costRate: number; eacCost: number; etcCost: number;
  ncHrs: number; ncCost: number;
  pctAllocation: number; startDate: string; endDate: string;
  resourceId?: string;
  /** Container allocation row ID (RWI) — lets the add flow's duplicate merge
   *  submit an EDIT of the existing assignment instead of a second row. */
  rwiId?: number | null;
  email?: string;
  weeklyHours: WeeklyHourEntry[];
  /** Allocation flags (OR across the member's allocation rows) — mirrors web:
   *  soft = tentative booking, nc = hours don't bill, locked = frozen. */
  softAllocation?: boolean;
  nonChargeable?: boolean;
  isLocked?: boolean;
}
export interface OpenRole {
  role: string; title: string; bu: string;
  eacHrs: number; etcHrs: number; pct: number;
  startDate: string; endDate: string;
  groupId: string; typeGuid: string;
  allocationId: number;
}
export interface ProjectTeamResponse {
  team: ProjectTeamMember[];
  openRoles: OpenRole[];
}
export async function getProjectTeam(projectID: string, onUpdate?: (d: ProjectTeamResponse) => void): Promise<ProjectTeamResponse> {
  const base = getApiBase();
  const hdrs = await authHeaders();
  const key = `project-team:${projectID}:${(hdrs.Authorization ?? "").slice(-16)}`;
  return cached(key, async () => {
    const res = await fetchWithTimeout(
      `${base}${API_SERVER_PATH}/project-team?projectID=${encodeURIComponent(projectID)}`,
      { headers: hdrs }
    );
    const data = await handleResponse(res) as { team?: ProjectTeamMember[]; openRoles?: OpenRole[] };
    return { team: data?.team ?? [], openRoles: data?.openRoles ?? [] };
  }, onUpdate);
}

/* ─── Timeline built from live allocation data ────────────────────────────── */
export interface WeekSlot { period: string; pct: number; hours: number; available: number; status: "Under" | "Good" | "Over" }
export interface UtilizationPerson { name: string; userId: string; weeks: WeekSlot[] }
export interface AllocationUtilizationResponse { periods: string[]; resources: UtilizationPerson[] }

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function weekLabel(d: Date): string {
  const m = MONTH_ABBR[d.getMonth()];
  const day = String(d.getDate()).padStart(2, "0");
  const yr  = String(d.getFullYear()).slice(2);
  return `${m}-${day}-${yr}`;
}

function mondayOf(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export async function buildUtilizationFromAllocations(): Promise<AllocationUtilizationResponse> {
  const data = await getResourceAllocations();

  // Find the date range across ALL allocations
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const r of data.resources) {
    for (const a of r.activeAllocations) {
      const s = new Date(a.startDate).getTime();
      const e = new Date(a.endDate).getTime();
      if (isFinite(s)) minMs = Math.min(minMs, s);
      if (isFinite(e)) maxMs = Math.max(maxMs, e);
    }
  }

  // Fallback: if no allocations found, use last 6 months → next 3 months
  if (!isFinite(minMs) || !isFinite(maxMs)) {
    const now = new Date();
    minMs = new Date(now.getFullYear(), now.getMonth() - 6, 1).getTime();
    maxMs = new Date(now.getFullYear(), now.getMonth() + 3, 0).getTime();
  }

  // Build weekly slots from the Monday of minMs → last week ≤ maxMs
  const weeks: Date[] = [];
  let cursor = mondayOf(new Date(minMs));
  const end = new Date(maxMs);
  while (cursor <= end) {
    weeks.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  const periods = weeks.map(w => weekLabel(w));

  // For each resource, compute % per week
  const resources: UtilizationPerson[] = data.resources
    .map(r => {
      const weekSlots: WeekSlot[] = weeks.map((wStart, i) => {
        const wEnd = wStart.getTime() + 6 * 86400000; // end of week (Sun)
        let pct = 0;
        for (const a of r.activeAllocations) {
          const aS = new Date(a.startDate).getTime();
          const aE = new Date(a.endDate).getTime();
          if (aS <= wEnd && aE >= wStart.getTime()) pct += a.pct;
        }
        const status: "Under" | "Good" | "Over" = pct > 100 ? "Over" : pct >= 75 ? "Good" : "Under";
        return { period: periods[i], pct, hours: 0, available: 0, status };
      });
      return { name: r.name, userId: r.username, weeks: weekSlots };
    })
    .filter(r => r.name)
    .sort((a, b) => {
      const sumA = a.weeks.reduce((s, w) => s + w.pct, 0);
      const sumB = b.weeks.reduce((s, w) => s + w.pct, 0);
      if (sumB !== sumA) return sumB - sumA;
      return a.name.localeCompare(b.name);
    });

  return { periods, resources };
}

/* ─── Allocation Utilization (via RM ONE API — fallback) ─────────────────────── */
function parseWeekCell(cell: string): { pct: number; hours: number; available: number; status: "Under" | "Good" | "Over" } {
  // Handle encoded format: "P:30#H:12#C:1#F:0.3#A:70#S:Under"
  if (cell.includes(":")) {
    const map: Record<string, string> = {};
    for (const part of cell.split("#")) {
      const i = part.indexOf(":");
      if (i > -1) map[part.slice(0, i)] = part.slice(i + 1);
    }
    const s = map.S ?? "";
    const pct = parseFloat(map.P ?? "0") || 0;
    // Use the H: field from RM ONE directly (the actual hours the user entered).
    // Do NOT derive hours from the % field — that double-counts when RM ONE
    // also has a base assignment %, producing inflated values like 15.2h
    // instead of the 5h the user actually saved.
    const hours = parseFloat(map.H ?? "0") || 0;
    return {
      pct,
      hours,
      available: parseFloat(map.A ?? "0") || 0,
      status: s === "Over" ? "Over" : s === "Good" ? "Good" : pct >= 75 ? "Good" : "Under",
    };
  }
  // Handle plain number format: "65" or "65.5"
  const pct = parseFloat(cell) || 0;
  const status: "Under" | "Good" | "Over" = pct > 100 ? "Over" : pct >= 75 ? "Good" : "Under";
  return { pct, hours: 0, available: 0, status };
}

export interface UtilFilterOptions {
  includeClosedProject?: boolean;
  includeSoftAllocations?: boolean;
  onlyNCO?: boolean;
  showActuals?: boolean;
}

export async function getAllocationUtilization(
  startDate?: string,
  endDate?: string,
  mode = "Weekly",
  forceRefresh = false,
  onUpdate?: (d: AllocationUtilizationResponse) => void,
  filters?: UtilFilterOptions,
): Promise<AllocationUtilizationResponse> {
  const base = getApiBase();
  const hdrs = await authHeaders();
  const now = new Date();
  const sd = startDate ?? localDateStr(new Date(now.getFullYear(), now.getMonth() - 6, 1));
  const ed = endDate   ?? localDateStr(new Date(now.getFullYear(), now.getMonth() + 3, 0));
  const fSuffix = `${filters?.includeSoftAllocations ? ":soft" : ""}${filters?.onlyNCO ? ":nco" : ""}${filters?.showActuals ? ":act" : ""}`;
  const key = `util:v8:${sd}:${ed}:${mode}${fSuffix}`;
  if (forceRefresh) bustCache(key);
  return cached(key, async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 130_000);
    const params = new URLSearchParams({
      startDate: sd, endDate: ed, mode,
      includeAll: "true",
      includeClosedProject: String(filters?.includeClosedProject ?? true),
      includeSoftAllocations: String(filters?.includeSoftAllocations ?? false),
      onlyNCO: String(filters?.onlyNCO ?? false),
      showActuals: String(filters?.showActuals ?? false),
    });
    const res = await fetch(
      `${base}${API_SERVER_PATH}/allocation-utilization?${params}`,
      { headers: hdrs, signal: ctrl.signal }
    ).finally(() => clearTimeout(timer));
    const raw = (await handleResponse(res)) as Record<string, unknown>[];
    if (!Array.isArray(raw)) return { periods: [], resources: [] };
    const weekKeys = Object.keys(raw[0] ?? {}).filter(k => /[A-Z][a-z]{2}-\d{2}-\d{2}/.test(k));
    const resources: UtilizationPerson[] = raw
      .map(r => ({
        name: String(r.ResourceUser ?? ""),
        userId: String(r.Id ?? r.ResourceUserAllocated ?? ""),
        weeks: weekKeys.map(wk => {
          const raw_val = r[wk];
          if (raw_val === null || raw_val === undefined) {
            return { period: wk, pct: 0, hours: 0, available: 0, status: "Under" as const };
          }
          return { period: wk, ...parseWeekCell(String(raw_val)) };
        }),
      }))
      .filter(r => r.name)
      .sort((a, b) => {
        const sumA = a.weeks.reduce((s, w) => s + w.pct, 0);
        const sumB = b.weeks.reduce((s, w) => s + w.pct, 0);
        if (sumB !== sumA) return sumB - sumA;
        return a.name.localeCompare(b.name);
      });

    return { periods: weekKeys, resources };
  }, onUpdate);
}

/* ─── Bench Resources ───────────────────────────────────────────────────── */
export interface BenchPerson {
  name: string;
  userId: string;
  itemOrder: number;
  projectCapacity: number;
  revenueCapacity: string;
  averageUtil: number;
  averageChargeableUtil: number;
  weeks: { period: string; pct: number; hours: number; available: number; status: "Over" | "Good" | "Under" }[];
}

export interface BenchResourcesResponse {
  periods: string[];
  resources: BenchPerson[];
}

export async function getBenchResources(
  startDate?: string,
  endDate?: string,
  mode = "Weekly",
  department = "",
  forceRefresh = false,
): Promise<BenchResourcesResponse> {
  const base = getApiBase();
  const hdrs = await authHeaders();
  const now = new Date();
  const sd = startDate ?? localDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
  const ed = endDate   ?? localDateStr(new Date(now.getFullYear(), now.getMonth() + 3, 0));
  const key = `bench:v1:${sd}:${ed}:${mode}:${department}`;
  if (forceRefresh) bustCache(key);
  return cached(key, async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 130_000);
    const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/bench-resources`, {
      method: "POST",
      headers: { ...hdrs, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: sd, endDate: ed, mode, department }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    const raw = (await handleResponse(res)) as Record<string, unknown>[];
    if (!Array.isArray(raw)) return { periods: [], resources: [] };
    const weekKeys = Object.keys(raw[0] ?? {}).filter(k => /[A-Z][a-z]{2}-\d{2}-\d{2}/.test(k));
    const resources: BenchPerson[] = raw
      .map(r => ({
        name: String(r.ResourceUser ?? ""),
        userId: String(r.Id ?? r.ResourceUserAllocated ?? ""),
        itemOrder: Number(r.ItemOrder ?? 0),
        projectCapacity: Number(r.ProjectCapacity ?? 0),
        revenueCapacity: String(r.RevenueCapacity ?? "0"),
        averageUtil: Number(r.AverageUtil ?? 0),
        averageChargeableUtil: Number(r.AverageChargeableUtil ?? 0),
        weeks: weekKeys.map(wk => {
          const raw_val = r[wk];
          if (raw_val === null || raw_val === undefined) {
            return { period: wk, pct: 0, hours: 0, available: 0, status: "Under" as const };
          }
          return { period: wk, ...parseWeekCell(String(raw_val)) };
        }),
      }))
      .filter(r => r.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    return { periods: weekKeys, resources };
  });
}

export function peekBenchResources(startDate: string, endDate: string, mode: string, department = ""): BenchResourcesResponse | undefined {
  const key = `bench:v1:${startDate}:${endDate}:${mode}:${department}`;
  const entry = _cache.get(key);
  return entry?.data as BenchResourcesResponse | undefined;
}

/* ─── People search (org-wide, for email recipient autocomplete) ───────── */
export interface PeopleSearchEntry {
  name: string;
  email: string;
  source: "user" | "contact";
  title?: string;
  company?: string;
  projectCount?: number;
}
export async function searchPeople(q: string, limit = 25): Promise<PeopleSearchEntry[]> {
  const base = getApiBase();
  const hdrs = await authHeaders();
  const qs = new URLSearchParams({ q: q || "", limit: String(limit) }).toString();
  const url = `${base}/api/rmone/people-search?${qs}`;
  try {
    const res = await fetchWithTimeout(url, { headers: hdrs });
    if (!res.ok) return [];
    const raw = await res.json();
    const arr = Array.isArray(raw?.results) ? raw.results : [];
    return arr.map((r: any) => ({
      name: String(r.name ?? ""),
      email: String(r.email ?? ""),
      source: r.source === "user" ? "user" : "contact",
      title: r.title ? String(r.title) : undefined,
      company: r.company ? String(r.company) : undefined,
      projectCount: typeof r.projectCount === "number" ? r.projectCount : undefined,
    })).filter((e: PeopleSearchEntry) => e.name && e.email);
  } catch (e) {
    console.warn("[api] searchPeople failed:", String(e));
    return [];
  }
}

export interface PersonProjectEntry { id: string; title: string; module: "PMM" | "OPM" | "LEM" }
export async function getPersonProjects(opts: { email?: string; guid?: string }): Promise<{ ok: boolean; projects: PersonProjectEntry[]; error?: string }> {
  const base = getApiBase();
  const hdrs = await authHeaders();
  const qs = new URLSearchParams();
  if (opts.guid) qs.set("guid", opts.guid);
  if (opts.email) qs.set("email", opts.email);
  const url = `${base}/api/rmone/people-projects?${qs.toString()}`;
  try {
    const res = await fetchWithTimeout(url, { headers: hdrs });
    const raw = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, projects: [], error: String(raw?.error || res.statusText) };
    const arr = Array.isArray(raw?.projects) ? raw.projects : [];
    return { ok: true, projects: arr.map((p: any) => ({ id: String(p.id ?? ""), title: String(p.title ?? ""), module: (p.module === "PMM" || p.module === "OPM" || p.module === "LEM") ? p.module : "PMM" })) };
  } catch (e) {
    return { ok: false, projects: [], error: String(e) };
  }
}

/* ─── Resource Skills & Availability ─────────────────────────────────────── */
export interface SkillsResource {
  id: string; name: string; jobTitle: string; roleName: string;
  currentPct: number; projectCount: number; complexity: number;
  projects?: string[];
}

export async function getAvailableRoster(projectId?: string): Promise<SkillsResource[]> {
  const base = getApiBase();
  const hdrs = await authHeaders();
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const url = `${base}/api/chat/roster${qs}`;
  console.log(`[api] getAvailableRoster url=${url.slice(0, 80)}…`);
  const res = await fetchWithTimeout(url, { headers: hdrs });
  console.log(`[api] getAvailableRoster status=${res.status}`);
  if (!res.ok) {
    console.warn(`[api] getAvailableRoster failed: ${res.status}`);
    return [];
  }
  const raw = await res.json();
  console.log(`[api] getAvailableRoster response isArray=${Array.isArray(raw)} length=${Array.isArray(raw) ? raw.length : typeof raw}`);
  if (!Array.isArray(raw)) {
    console.warn(`[api] getAvailableRoster response not array:`, JSON.stringify(raw).slice(0, 200));
    return [];
  }
  return raw.map(r => ({
    id: String(r.id ?? ""),
    name: String(r.name ?? ""),
    jobTitle: String(r.jobTitle ?? ""),
    roleName: String(r.jobTitle ?? ""),
    currentPct: Number(r.currentPct ?? 0),
    projectCount: Number(r.projectCount ?? 0),
    complexity: 0,
    projects: Array.isArray(r.projects) ? (r.projects as string[]) : [],
  }));
}

export async function getGroupIdForProject(projectId: string): Promise<string> {
  try {
    const base = getApiBase();
    const headers = await authHeaders();
    const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/project/${projectId}`, { headers });
    if (!res.ok) return "";
    const data = await res.json() as Record<string, unknown>;
    return String(data.GroupID ?? data.groupID ?? "");
  } catch {
    return "";
  }
}

export async function getResourceSkillsAvailability(
  projectId: string,
  startDate: string,
  endDate: string,
  groupId = "00000000-0000-0000-0000-000000000000",
): Promise<SkillsResource[]> {
  const base = getApiBase();
  const hdrs = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/resource-skills-availability`, {
    method: "POST",
    headers: { ...hdrs, "Content-Type": "application/json" },
    body: JSON.stringify({
      ProjectID: projectId,
      GroupID: groupId,
      AllocationStartDate: startDate,
      AllocationEndDate: endDate,
      ResourceAvailability: "AllResource",
      Complexity: false,
      ProjectVolume: false,
      ProjectCount: false,
      Type: "",
      PctAllocation: 100,
      RequestTypes: false,
      ModuleIncludes: false,
      JobTitles: null,
      departments: 0,
      SelectedUserID: null,
      isAllocationView: false,
      Customer: false,
      CompanyLookup: null,
      Sector: false,
      IsRequestFromSummaryView: false,
      SectorName: null,
      SelectedTags: [],
      PctAllocationCloseOut: 0,
      PctAllocationConst: 0,
      DivisionId: null,
      DepartmentId: null,
      FunctionId: null,
      ResourceManager: null,
      SelectedCertifications: null,
      Allocations: [{ StartDate: startDate, EndDate: endDate, WeekWiseAllocations: null, ResourceSkills: [] }],
    }),
  });
  if (!res.ok) return [];
  const raw = (await res.json()) as Record<string, unknown>[];
  if (!Array.isArray(raw)) return [];
  return raw.map(r => ({
    id: String(r.AssignedTo ?? ""),
    name: String(r.AssignedToName ?? ""),
    jobTitle: String(r.JobTitle ?? r.RoleName ?? ""),
    roleName: String(r.RoleName ?? r.JobTitle ?? ""),
    currentPct: Number(r.TotalPctAllocation ?? 0),
    projectCount: Number(r.ProjectCount ?? 0),
    complexity: Number(r.HighestComplexity ?? 0),
  })).filter(r => r.name);
}

export async function createRecord(moduleName: string, fields: { FieldName: string; Value: string }[]) {
  const base = getApiBase();
  const headers = await authHeaders();
  const body = [{ FieldName: "Module", Value: moduleName }, ...fields];
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/new-record`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

export async function getBusinessUnits() {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/business-units`, { headers });
  return handleResponse(res);
}

export async function updateBusinessUnit(payload: Record<string, unknown>) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/business-unit`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function renameBusinessUnit(id: string, name: string): Promise<void> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/business-units/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await handleResponse(res);
  bustCacheByPrefix("business-units");
  bustCacheByPrefix("project-detail:");
}

export async function getLifecycles() {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/lifecycles`, { headers });
  return handleResponse(res);
}

export async function createLifecycle(payload: { Name: string; Stages: string[]; Module?: string }) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/lifecycles`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function updateLifecycle(id: string | number, payload: { Name: string; Stages: string[] }) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/lifecycles/${id}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function createSchedule(payload: Record<string, unknown>) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/schedule`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function getProjectAllocationsWeekly(payload: Record<string, unknown>) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/project-allocations`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function getWorkItem(payload: Record<string, unknown>) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/work-item`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function getWeeklyResources(payload: Record<string, unknown>) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/weekly-resources`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function allocateHours(payload: Record<string, unknown>) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/hours-allocation`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function assignResource(payload: { ProjectID: string; Allocations: Record<string, unknown>[] }) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/assign-resource`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const txt = await res.text();
  if (!res.ok && !txt.toLowerCase().includes("allocationoutofbounds")) {
    throw new Error(`(${res.status}) ${txt.slice(0, 200)}`);
  }
  return txt;
}

export async function getDivisions(): Promise<{ ID: number; Title: string; ShortName: string | null }[]> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/divisions`, { headers });
  return handleResponse(res) as any;
}

export async function renameDivision(id: string, name: string): Promise<void> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/divisions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await handleResponse(res);
  bustCacheByPrefix("divisions");
  bustCacheByPrefix("project-detail:");
}

export async function getUsers(): Promise<{ id: string; name: string }[]> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/users`, { headers });
  return handleResponse(res) as any;
}

export async function createBusinessUnits(payload: {
  TicketID: string;
  ProjectDivisionRoles: Record<string, unknown>[];
}) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/business-unit`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function uploadAttachment(payload: {
  TicketId: string;
  FileName: string;
  FileContent: string;
  ContentType: string;
}) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/attachments`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function getTaskData(ticketID: string, baseLineID: string = "0", stageCount?: number, onUpdate?: (d: any) => void) {
  const base = getApiBase();
  const hdrs = await authHeaders();
  const key = `task-data:${ticketID}:${baseLineID}:${(hdrs.Authorization ?? "").slice(-16)}`;
  return cached(key, async () => {
    let url = `${base}${API_SERVER_PATH}/task-data?ticketID=${encodeURIComponent(ticketID)}&baseLineID=${encodeURIComponent(baseLineID)}`;
    if (stageCount && stageCount > 0) url += `&stageCount=${stageCount}`;
    const res = await fetchWithTimeout(url, { headers: hdrs });
    return handleResponse(res);
  }, onUpdate);
}

/**
 * Same as getTaskData but also returns the project's active lifecycle template
 * ID exposed via the X-Lifecycle-Id response header. Use this when the caller
 * needs to issue a follow-up updateProjectSchedule and must include the
 * correct ProjectLifecycleID (otherwise the project silently flips templates).
 */
export async function getTaskDataWithLifecycle(ticketID: string, baseLineID: string = "0") {
  const base = getApiBase();
  const headers = await authHeaders();
  const url = `${base}${API_SERVER_PATH}/task-data?ticketID=${encodeURIComponent(ticketID)}&baseLineID=${encodeURIComponent(baseLineID)}`;
  const res = await fetchWithTimeout(url, { headers });
  const lifecycleId = res.headers.get("X-Lifecycle-Id") ?? "";
  const data = await handleResponse(res);
  return { data, lifecycleId };
}

/** LIVE task-data read for schedule-window WRITE decisions. Rides
 *  liveTaskDataQuery (fresh=1) so the SERVER bypasses its task-data cache
 *  instead of serving a fresh/stale-grace copy — a schedule another user
 *  just changed must govern this save. Never wrapped in cached(), and
 *  failures propagate: the caller treats "window unknown" as no-clamp. */
export async function getLiveTaskData(ticketID: string): Promise<unknown> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/task-data?${liveTaskDataQuery(ticketID)}`, { headers });
  return handleResponse(res);
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
  Tasks: any[] | null;
}) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/schedule`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await handleResponse(res);
  if (data && data.Status === false) {
    const msg = data.ErrorMessages || data.Message || data.error || "Schedule update rejected by server";
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  if (data && typeof data.raw === "string" && data.raw.toLowerCase().includes("error")) {
    throw new Error(data.raw);
  }
  return data;
}

export async function getProjectDivisionRoles(ticketID: string) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/project-division-roles?ticketID=${encodeURIComponent(ticketID)}`, { headers });
  return handleResponse(res);
}

export async function getDivisionDetails() {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/division-details`, { headers });
  return handleResponse(res);
}

export async function getUserList() {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/user-list`, { headers });
  return handleResponse(res);
}

/* ── Client-official assignment cascade: BU → Role → Title → Person ── */

export type AssignRole = { id: string; name: string };
export type AssignTitle = { id: string; name: string };
export type AssignResource = { id: string; name: string; title: string; enabled?: boolean; tenantId?: string };

/** Roles for a chosen Business Unit (DivisionIdLookup). */
export async function getRolesByBU(divisionIdLookup: string): Promise<AssignRole[]> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(
    `${base}${API_SERVER_PATH}/assign/roles-by-bu?divisionIdLookup=${encodeURIComponent(divisionIdLookup)}`,
    { headers });
  return handleResponse(res) as any;
}

/** Job Titles for a chosen Business Unit + Role. */
export async function getJobTitlesByRole(divisionIdLookup: string, roleLookup: string): Promise<AssignTitle[]> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(
    `${base}${API_SERVER_PATH}/assign/job-titles?divisionIdLookup=${encodeURIComponent(divisionIdLookup)}&roleLookup=${encodeURIComponent(roleLookup)}`,
    { headers });
  return handleResponse(res) as any;
}

/** People (resources) for a chosen Job Title. */
export async function getResourcesByJobTitle(jobTitleLookup: string): Promise<AssignResource[]> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(
    `${base}${API_SERVER_PATH}/assign/resources?jobTitleLookup=${encodeURIComponent(jobTitleLookup)}`,
    { headers });
  return handleResponse(res) as any;
}

export async function getBillingRates(projectID: string, divisionIds: string = "0") {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/billing-rates?projectID=${encodeURIComponent(projectID)}&divisionIds=${encodeURIComponent(divisionIds)}`, { headers });
  return handleResponse(res);
}

export async function getDepartments() {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/departments`, { headers });
  return handleResponse(res);
}

export async function renameDepartment(id: string, name: string): Promise<void> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/departments/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await handleResponse(res);
  bustCacheByPrefix("departments");
  bustCacheByPrefix("project-detail:");
}

export async function getProjectTemplates() {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/project-templates`, { headers });
  return handleResponse(res);
}

export async function getTemplateDetails(id: string | number) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/template-details?id=${encodeURIComponent(String(id))}`, { headers });
  return handleResponse(res);
}

export async function updateDivisionRoles(payload: { TicketID: string; ProjectDivisionRoles: any[] }) {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/update-division-roles`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function getPMMLifeCycles() {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/lifecycles`, { headers });
  return handleResponse(res);
}

/* ─────────────  JOB TITLES & COST RATES (May 2026)  ─────────────
 * GET  /api/rmone/job-titles            → tenant-wide JobTitle catalogue
 * POST /api/rmone/job-title-cost-rate   → upsert per-(Department × JobTitle)
 *                                          cost rate (EmpCostRate).
 * Mirrors the same helpers in artifacts/rmone-web/src/lib/api.ts.
 */
export interface JobTitleRow {
  ID: number;
  Title: string;
  JobTitleName: string;
  ShortName?: string;
  RoleName?: string;
  RoleId?: string;
  JobType?: "Billable" | "Overhead" | string;
  Deleted?: boolean;
}

export async function getJobTitles(): Promise<JobTitleRow[]> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/job-titles`, { headers });
  const rows = await handleResponse(res) as JobTitleRow[];
  return Array.isArray(rows) ? rows.filter(r => !r.Deleted) : [];
}

export async function saveJobTitleCostRate(payload: {
  Id?: number;
  JobTitleId: number;
  EmpCostRate: number;
  DepartmentId: number;
  Deleted?: boolean;
}): Promise<{ success?: boolean; message?: string }> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}${API_SERVER_PATH}/job-title-cost-rate`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      Id: payload.Id ?? 0,
      JobTitleId: payload.JobTitleId,
      EmpCostRate: payload.EmpCostRate,
      DepartmentId: payload.DepartmentId,
      Deleted: payload.Deleted ?? false,
    }),
  });
  return handleResponse(res) as Promise<{ success?: boolean; message?: string }>;
}

// ─── Chat streaming ──────────────────────────────────────────────────────
// Minimal SSE-line streaming client for /api/chat/message. Mirrors the
// inline impl in app/(tabs)/chat.tsx but exposed as a reusable helper so
// other screens (Resources AI-analysis popup, etc.) can stream replies
// without duplicating the parser.
export type ChatStreamEvent =
  | { type: "content"; text: string }
  | { type: "token"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

export async function chatStream(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
  onEvent: (e: ChatStreamEvent) => void,
  signal?: AbortSignal,
  extras?: { displayName?: string; username?: string },
): Promise<void> {
  const base = getApiBase();
  const token = (await AsyncStorage.getItem("rmone_token")) ?? "";
  const username = extras?.username ?? "";
  const displayName = (extras?.displayName ?? "").trim() || username;
  const payload: Record<string, unknown> = { messages, token, username, displayName };

  const res = await fetch(`${base}/api/chat/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    onEvent({ type: "error", message: `Server error ${res.status}` });
    onEvent({ type: "done" });
    return;
  }

  const processLine = (line: string): boolean => {
    if (!line.startsWith("data:")) return false;
    const data = line.slice(5).replace(/^ /, "").trim();
    if (!data) return false;
    try {
      const parsed = JSON.parse(data);
      if (parsed.done) return true;
      if (parsed.error) {
        onEvent({ type: "error", message: String(parsed.error).slice(0, 300) });
        return true;
      }
      const tok: string = parsed.token ?? "";
      if (tok) onEvent({ type: "token", text: tok });
      const delta: string = parsed.content ?? "";
      if (delta) onEvent({ type: "content", text: delta });
    } catch {
      /* ignore parse errors */
    }
    return false;
  };

  const reader = (res.body as any)?.getReader?.();
  if (!reader) {
    // React Native fetch doesn't support ReadableStream — read the full SSE body
    // and parse it line-by-line so tokens/content events fire correctly.
    const text = await res.text();
    if (text) {
      const lines = text.split("\n");
      for (const ln of lines) processLine(ln);
    }
    onEvent({ type: "done" });
    return;
  }
  const decoder = new TextDecoder();
  let lineBuffer = "";

  try {
    outer: while (true) {
      if (signal?.aborted) {
        try { (reader.cancel() as Promise<void>).catch(() => {}); } catch {}
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const ln of lines) {
        if (processLine(ln)) break outer;
      }
    }
    if (lineBuffer && !signal?.aborted) processLine(lineBuffer);
  } finally {
    onEvent({ type: "done" });
  }
}

// ── Superadmin APIs ──────────────────────────────────────────────────────────

export interface CompanyProfileFields {
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

export interface TenantSummary {
  tenantId: string;
  latestStatus: string;
  latestImportAt: string | null;
  totalInserted: number;
  totalErrors: number;
  runCount: number;
  activitySparkline: number[];
  projectCount: number;
  staffCount: number;
  oppCount: number;
  assignmentCount: number;
  readinessScore: number;
  isActive: boolean;
  displayName?: string;
}

export async function checkSuperadmin(): Promise<boolean> {
  try {
    const base = getApiBase();
    const headers = await authHeaders();
    const res = await fetchWithTimeout(`${base}/api/superadmin/check`, { headers }, 8000);
    return res.ok;
  } catch {
    return false;
  }
}

export async function getFleet(): Promise<{ tenants: TenantSummary[] }> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(`${base}/api/superadmin/fleet`, { headers }, 30000);
  return handleResponse(res);
}

export async function getSuperadminCompanyProfile(
  tenantId: string,
): Promise<{ tenantId: string; profile: CompanyProfileFields }> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(
    `${base}/api/superadmin/company-profile/${encodeURIComponent(tenantId)}`,
    { headers },
  );
  return handleResponse(res);
}

export async function updateSuperadminCompanyProfile(
  tenantId: string,
  fields: CompanyProfileFields,
): Promise<{ ok: boolean; tenantId: string }> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(
    `${base}/api/superadmin/company-profile/${encodeURIComponent(tenantId)}`,
    {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    },
  );
  return handleResponse(res);
}

export interface CompanyAdmin {
  userGuid: string;
  name: string;
  email: string;
  isDefault: boolean;
}

export async function getSuperadminCompanyAdmins(
  tenantId: string,
): Promise<{ admins: CompanyAdmin[] }> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(
    `${base}/api/superadmin/company-admins/${encodeURIComponent(tenantId)}`,
    { headers },
  );
  return handleResponse(res);
}

export async function addSuperadminCompanyAdmin(
  tenantId: string,
  name: string,
  email: string,
): Promise<{ ok: boolean; userGuid: string; name: string; email: string }> {
  const base = getApiBase();
  const headers = await authHeaders();
  const res = await fetchWithTimeout(
    `${base}/api/superadmin/company-admins/${encodeURIComponent(tenantId)}`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
    },
  );
  return handleResponse(res);
}
