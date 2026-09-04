/**
 * Company ACCESS CONTROL (client side) — user groups, custom access levels,
 * and per-stage permissions (#87), plus the signed-in user's server-resolved
 * capabilities.
 *
 * The SERVER enforces everything fail-closed on every write path; this module
 * only fetches the server's answers so the UI can disable controls up front
 * and explain why in plain language. Shapes mirror
 * api-server/src/lib/access-control.ts — keep in lockstep.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { authHeaders, getStoredUser } from "./api";
import { setBusinessRulesViewerGroups } from "./businessRules";
import type { StageRuleModule } from "./stageRules";
import { canonicalNavId, type NavSurface } from "./navCatalog";

const ONB = "/api/onboarding";
const RMONE = "/api/rmone";

/* ── Shapes (server mirrors) ────────────────────────────────────────────── */

export interface Caps {
  editData: boolean;
  advanceStages: boolean;
  editFinancials: boolean;
  manageStaff: boolean;
  manageSettings: boolean;
  /** May see/use the Import page in the sidebar (admins always may). */
  importPage: boolean;
}

export interface UserGroup {
  id: string; name: string; memberIds: string[]; color?: string;
  /** Level NAME for this group's members — set on the User Groups settings
   *  page (applied to members on save) or picked when the group is created
   *  from a projects/opps import popup; staff imports fill empty levels from it. */
  defaultAccessLevel?: string;
}
export interface AccessLevelDef { id: string; name: string; caps: Caps }

/**
 * Preset palette for group colors — keep in lockstep with the server's
 * GROUP_COLOR_PALETTE in api-server/src/lib/access-control.ts (the server
 * auto-assigns from this palette on save for groups without a color).
 */
export const GROUP_COLOR_PALETTE = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#84cc16", "#06b6d4", "#a855f7",
  "#e11d48", "#3b82f6", "#22c55e", "#d97706",
];

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/;

const normColor = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return HEX_COLOR_RE.test(s) ? s : null;
};

/**
 * Group id → display color. Explicit colors win; colorless groups (drafts or
 * docs saved before colors existed) get the first unused palette color in
 * list order — the SAME rule the server applies on save, so the color you
 * preview is the color that persists.
 */
export function groupColorMap(groups: UserGroup[]): Map<string, string> {
  const used = new Set<string>();
  for (const g of groups) {
    const c = normColor(g.color);
    if (c) used.add(c);
  }
  const out = new Map<string, string>();
  groups.forEach((g, i) => {
    let c = normColor(g.color);
    if (!c) {
      c = GROUP_COLOR_PALETTE.find(p => !used.has(p)) ?? GROUP_COLOR_PALETTE[i % GROUP_COLOR_PALETTE.length];
      used.add(c);
    }
    out.set(g.id, c);
  });
  return out;
}

export interface StagePermRule {
  module: StageRuleModule;
  stage: string;
  actionUserIds: string[];
  actionGroupIds: string[];
  editorUserIds: string[];
  editorGroupIds: string[];
  /** What everyone NOT listed can do at this stage. "viewOnly" (the legacy
   *  behavior and the default for docs saved before this field existed) locks
   *  unlisted users to read-only; "normal" means the rule only grants the
   *  listed people their tier — everyone else keeps their regular access. */
  othersMode?: "viewOnly" | "normal";
}

export const NO_CAPS: Caps = { editData: false, advanceStages: false, editFinancials: false, manageStaff: false, manageSettings: false, importPage: false };
export const ALL_CAPS: Caps = { editData: true, advanceStages: true, editFinancials: true, manageStaff: true, manageSettings: true, importPage: true };

/** Capability display metadata — the ONE list every surface renders from
 *  (Settings → Access Levels cards, the import group-popup's mini form). */
export const CAP_ROWS: { key: keyof Caps; label: string; hint: string }[] = [
  { key: "editData", label: "Edit data", hint: "Non-financial record fields: details, dates, schedules, notes and lead details. Staffing changes use “Manage staff”." },
  { key: "advanceStages", label: "Move stages", hint: "Move a record to another stage / status (also needs \u201CEdit data\u201D)" },
  { key: "editFinancials", label: "Edit financials", hint: "ONLY money fields: contract values, budgets, costs, rates — works without \u201CEdit data\u201D" },
  { key: "manageStaff", label: "Manage staff", hint: "Add or edit staff, team members, open positions, assignments and allocations" },
  { key: "manageSettings", label: "Company settings", hint: "Change company-wide settings like these" },
  { key: "importPage", label: "Import page", hint: "See and use the Import page in the sidebar to bring in Excel/CSV data (also needs \u201CEdit data\u201D)" },
];

/**
 * Financial / contract-value field names — display-only mirror of the server's
 * lib/financial-fields.ts (the single source of truth; keep in lockstep).
 * Fields in this set are governed by the editFinancials capability; everything
 * else by editData.
 */
export const FINANCIAL_FIELD_NAMES = new Set(
  [
    // Core contract, revenue, and rate values.
    "ApproxContractValue", "ContractValue", "ContractedAmount", "ProjectValue", "EstimatedValue",
    "EstimatedRevenue", "TotalValue", "RevenueAmount", "OpportunityValue",
    "ForecastedProjectCost", "LaborContractAmount", "LaborBudget", "ContractLimit", "Fee",
    "GrossMargin", "FeePct", "BillingRate", "Rate", "Cost", "Budget",
    // Construction budget and signed-contract values. These can appear as
    // first-class cards or as user-pinned custom fields, but must receive the
    // same financial capability check in either presentation.
    "NonOperatingCost", "TotalCost", "ProjectCost", "AcquisitionCost",
    "ActualProjectCost", "ActualAcquisitionCost", "EstProjectSpend",
    "ProposalAmount", "BidAmount", "Contingency", "ApprovedChangeOrders",
    "ChangeOrders", "LiquidatedDamages", "ApprovedRFEAmount", "Retainage",
  ].map((s) => s.toLowerCase()),
);

export function isFinancialFieldName(name: string | null | undefined): boolean {
  return !!name && FINANCIAL_FIELD_NAMES.has(String(name).trim().toLowerCase());
}

export const CUSTOM_ACL_PREFIX = "custom:";
/** users.access_level is NVARCHAR(20) — "custom:" + id must fit. */
export const LEVEL_ID_RE = /^[a-z0-9][a-z0-9-]{0,12}$/;

export function isCustomAcl(acl: string | null | undefined): boolean {
  return String(acl ?? "").trim().toLowerCase().startsWith(CUSTOM_ACL_PREFIX);
}

/** Derive a level id from its display name — ≤13 chars, [a-z0-9-]. */
export function levelIdFromName(name: string, taken: Set<string>): string {
  let base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 13).replace(/-+$/g, "");
  if (!base || !LEVEL_ID_RE.test(base)) base = "level";
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const cand = `${base.slice(0, 13 - String(n).length - 1)}-${n}`.replace(/--+/g, "-");
    if (LEVEL_ID_RE.test(cand) && !taken.has(cand)) return cand;
  }
  return `lvl-${Date.now() % 100000}`;
}

/* ── Small fetch helpers (settings docs; admin-gated writes) ────────────── */

async function jsonOrThrow(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
  }
  return body;
}

const coerceCaps = (v: unknown): Caps => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    editData: o.editData === true,
    advanceStages: o.advanceStages === true,
    editFinancials: o.editFinancials === true,
    manageStaff: o.manageStaff === true,
    manageSettings: o.manageSettings === true,
    importPage: o.importPage === true,
  };
};
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean) : [];

export function coerceGroups(v: unknown): UserGroup[] {
  if (!Array.isArray(v)) return [];
  const out: UserGroup[] = [];
  for (const g of v) {
    const o = (g && typeof g === "object" ? g : {}) as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!id || !name) continue;
    const color = normColor(o.color);
    const dal = typeof o.defaultAccessLevel === "string" ? o.defaultAccessLevel.trim() : "";
    out.push({ id, name, memberIds: strList(o.memberIds), ...(color ? { color } : {}), ...(dal ? { defaultAccessLevel: dal } : {}) });
  }
  return out;
}

export function coerceLevels(v: unknown): AccessLevelDef[] {
  if (!Array.isArray(v)) return [];
  const out: AccessLevelDef[] = [];
  for (const l of v) {
    const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim().toLowerCase() : "";
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!id || !name || !LEVEL_ID_RE.test(id)) continue;
    out.push({ id, name, caps: coerceCaps(o.caps) });
  }
  return out;
}

export function coerceStagePermRules(v: unknown): StagePermRule[] {
  if (!Array.isArray(v)) return [];
  const out: StagePermRule[] = [];
  for (const r of v) {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const module = String(o.module ?? "").trim().toUpperCase();
    const stage = typeof o.stage === "string" ? o.stage.trim() : "";
    if (!["PMM", "OPM", "LEM"].includes(module) || !stage) continue;
    out.push({
      module: module as StageRuleModule,
      stage,
      actionUserIds: strList(o.actionUserIds),
      actionGroupIds: strList(o.actionGroupIds),
      editorUserIds: strList(o.editorUserIds),
      editorGroupIds: strList(o.editorGroupIds),
      othersMode: o.othersMode === "normal" ? "normal" : "viewOnly",
    });
  }
  return out;
}

const qsFor = (tenantId?: string) => (tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "");

/** The phases/statuses that actually came in with the tenant's imported data
 *  (live server scan) — pinned as the "Existing from import" entry in the
 *  Manage stage/phase set dialogs. Read-only display data; never cached
 *  (dialogs open rarely and tenant isolation stays trivial). */
export interface ImportedDefaults {
  phases: { project: string[]; opp: string[] };
  stages: { PMM: string[]; OPM: string[]; LEM: string[] };
}

export async function fetchImportedDefaults(tenantId?: string): Promise<ImportedDefaults> {
  const body = await jsonOrThrow(await fetch(`${ONB}/imported-defaults${qsFor(tenantId)}`, { headers: authHeaders() }));
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
  const p = (body.phases ?? {}) as Record<string, unknown>;
  const s = (body.stages ?? {}) as Record<string, unknown>;
  return {
    phases: { project: arr(p.project), opp: arr(p.opp) },
    stages: { PMM: arr(s.PMM), OPM: arr(s.OPM), LEM: arr(s.LEM) },
  };
}

export async function fetchUserGroups(tenantId?: string): Promise<UserGroup[]> {
  const body = await jsonOrThrow(await fetch(`${ONB}/user-groups${qsFor(tenantId)}`, { headers: authHeaders() }));
  return coerceGroups(body.groups);
}

export async function saveUserGroups(groups: UserGroup[], tenantId?: string): Promise<UserGroup[]> {
  const payload: Record<string, unknown> = { groups };
  if (tenantId) payload.tenantId = tenantId;
  const body = await jsonOrThrow(await fetch(`${ONB}/user-groups`, {
    method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }));
  bustPermissionCaches();
  // Sibling tabs pick groups from their own state (Stage Rules "applies to",
  // "Who can act") — broadcast so a newly created group appears immediately.
  notifyPermissionsChanged();
  return coerceGroups(body.groups);
}

const coercePartialCaps = (v: unknown): Partial<Caps> => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: Partial<Caps> = {};
  for (const k of ["editData","advanceStages","editFinancials","manageStaff","manageSettings","importPage"] as const) {
    if (typeof o[k] === "boolean") out[k] = o[k] as boolean;
  }
  return out;
};

const coerceAccessLevelsDoc = (body: Record<string, unknown>): AccessLevelsDoc => {
  const levels = coerceLevels(body.levels);
  const rawOv = (body.builtinOverrides && typeof body.builtinOverrides === "object"
    ? body.builtinOverrides : {}) as Record<string, unknown>;
  const builtinOverrides: BuiltinLevelOverrides = {};
  if (rawOv.manager) builtinOverrides.manager = coercePartialCaps(rawOv.manager);
  if (rawOv.user) builtinOverrides.user = coercePartialCaps(rawOv.user);
  const rawIA = String(body.importAccess ?? "").toLowerCase();
  const importAccess: ImportAccess = rawIA === "manager" ? "manager" : rawIA === "all" ? "all" : "admin";
  return { levels, builtinOverrides, importAccess };
};

export async function fetchAccessLevels(tenantId?: string): Promise<AccessLevelDef[]> {
  const body = await jsonOrThrow(await fetch(`${ONB}/access-levels${qsFor(tenantId)}`, { headers: authHeaders() }));
  return coerceLevels(body.levels);
}

export async function fetchAccessLevelsDoc(tenantId?: string): Promise<AccessLevelsDoc> {
  const body = await jsonOrThrow(await fetch(`${ONB}/access-levels${qsFor(tenantId)}`, { headers: authHeaders() }));
  return coerceAccessLevelsDoc(body);
}

export async function saveAccessLevels(levels: AccessLevelDef[], tenantId?: string): Promise<AccessLevelDef[]> {
  const payload: Record<string, unknown> = { levels };
  if (tenantId) payload.tenantId = tenantId;
  const body = await jsonOrThrow(await fetch(`${ONB}/access-levels`, {
    method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }));
  notifyPermissionsChanged();
  return coerceLevels(body.levels);
}

export async function saveAccessLevelsDoc(doc: AccessLevelsDoc, tenantId?: string): Promise<AccessLevelsDoc> {
  const payload: Record<string, unknown> = { ...doc };
  if (tenantId) payload.tenantId = tenantId;
  const body = await jsonOrThrow(await fetch(`${ONB}/access-levels`, {
    method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }));
  // Level capabilities changed — every open page gating on them (this tab AND
  // sibling tabs) must re-read, not wait for a manual refresh.
  notifyPermissionsChanged();
  return coerceAccessLevelsDoc(body);
}

/**
 * Create brand-new custom levels (import group-popup path). The access-levels
 * PUT is a WHOLE-DOC upsert, so this fetches the full doc first — builtin
 * overrides and importAccess must be preserved or they'd be silently wiped.
 * Names matching a built-in or an existing level (case-insensitive) are
 * skipped, so mixed lists are safe. Each entry carries the capability ticks
 * chosen in the popup; entries without caps start view-style (editData only)
 * — admins refine caps in Settings later. Returns the saved custom levels.
 */
export async function createCustomAccessLevels(
  entries: Array<{ name: string; caps?: Caps }>,
  tenantId?: string,
): Promise<AccessLevelDef[]> {
  const doc = await fetchAccessLevelsDoc(tenantId);
  const existing = new Set([
    "admin", "manager", "user",
    ...doc.levels.map((l) => l.name.trim().toLowerCase()),
  ]);
  const taken = new Set(doc.levels.map((l) => l.id));
  const levels = [...doc.levels];
  for (const entry of entries) {
    const name = entry.name.trim().slice(0, 80); // server caps names at 80 chars
    if (!name || existing.has(name.toLowerCase())) continue;
    const id = levelIdFromName(name, taken);
    taken.add(id);
    existing.add(name.toLowerCase());
    levels.push({
      id,
      name,
      caps: entry.caps ? coerceCaps(entry.caps) : { ...NO_CAPS, editData: true },
    });
  }
  if (levels.length === doc.levels.length) return doc.levels; // nothing new
  return (await saveAccessLevelsDoc({ ...doc, levels }, tenantId)).levels;
}

export async function fetchStagePermissions(tenantId?: string): Promise<StagePermRule[]> {
  const body = await jsonOrThrow(await fetch(`${ONB}/stage-permissions${qsFor(tenantId)}`, { headers: authHeaders() }));
  return coerceStagePermRules(body.rules);
}

export async function saveStagePermissions(rules: StagePermRule[], tenantId?: string): Promise<StagePermRule[]> {
  const payload: Record<string, unknown> = { rules };
  if (tenantId) payload.tenantId = tenantId;
  const body = await jsonOrThrow(await fetch(`${ONB}/stage-permissions`, {
    method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }));
  // Same as saveAccessLevels — sync every open page, including sibling tabs.
  notifyPermissionsChanged();
  return coerceStagePermRules(body.rules);
}

/* ── My capabilities (server-resolved; cached) ──────────────────────────── */

export type ImportAccess = "admin" | "manager" | "all";

export interface BuiltinLevelOverrides {
  manager?: Partial<Caps>;
  user?: Partial<Caps>;
}

export interface AccessLevelsDoc {
  levels: AccessLevelDef[];
  builtinOverrides?: BuiltinLevelOverrides;
  importAccess?: ImportAccess;
}

export interface MyCapabilities {
  acl: string;
  source: "builtin" | "custom";
  levelName: string | null;
  caps: Caps;
  /** Whether the user may access the Import page (admin-controlled). */
  canImport: boolean;
  /** Whether the user may access the Settings page (admin-controlled via manageSettings cap). */
  canSettings: boolean;
  /** Present when the user changed their OWN level and may revert it themselves. */
  selfRevert?: { to: string; label: string } | null;
  /** User-group ids this user belongs to — filters group-restricted workflow
   *  types client-side (#121). Display-only; the server re-checks on write. */
  groupIds: string[];
}

// Optimistic default while loading / on fetch failure: the server still
// enforces, so the worst case of assuming "may edit" is a clear error toast.
// groupIds stays EMPTY optimistically — restricted options hide until the
// real memberships arrive (safer than briefly offering a choice the server
// would 403).
export const OPTIMISTIC_CAPS: MyCapabilities = { acl: "unset", source: "builtin", levelName: null, caps: ALL_CAPS, canImport: true, canSettings: true, groupIds: [] };

let myCaps: MyCapabilities | null = null;
let myCapsAt = 0;
let myCapsInflight: Promise<MyCapabilities> | null = null;
const MY_CAPS_TTL = 60_000;
// Every permission-cache bust advances this generation. Requests capture the
// current value when they start and may publish into caches only if it still
// matches when they finish. This prevents a slow pre-bust denial from
// repopulating the cache after a live Admin/profile refresh.
let permissionCacheGeneration = 0;

export async function getMyCapabilities(options?: { fresh?: boolean }): Promise<MyCapabilities> {
  const now = Date.now();
  if (!options?.fresh && myCaps && now - myCapsAt < MY_CAPS_TTL) return myCaps;
  if (myCapsInflight) return myCapsInflight;
  const requestGeneration = permissionCacheGeneration;
  let request!: Promise<MyCapabilities>;
  request = (async () => {
    try {
      const body = await jsonOrThrow(await fetch(`${RMONE}/my-capabilities`, { headers: authHeaders() }));
      const sr = body.selfRevert as { to?: unknown; label?: unknown } | null | undefined;
      const next: MyCapabilities = {
        acl: typeof body.acl === "string" ? body.acl : "unset",
        source: body.source === "custom" ? "custom" : "builtin",
        levelName: typeof body.levelName === "string" ? body.levelName : null,
        caps: coerceCaps(body.caps),
        canImport: body.canImport !== false,
        canSettings: body.canSettings !== false,
        selfRevert: sr && typeof sr === "object" && typeof sr.to === "string"
          ? { to: sr.to, label: typeof sr.label === "string" && sr.label ? sr.label : "your previous level" }
          : null,
        groupIds: Array.isArray(body.groupIds)
          ? (body.groupIds as unknown[]).filter((x): x is string => typeof x === "string")
          : [],
      };
      // A TTL-expired refetch (e.g. on tab focus) that comes back DIFFERENT
      // means an admin changed this user's level or its capabilities while
      // this tab sat idle — drop per-record verdicts too and re-render every
      // subscribed component. Fresh-after-bust fetches (myCaps === null)
      // already bumped at bust time, so no double render there.
      // The active session/access level changed while this request was in
      // flight. Its answer belongs to the old generation: return it only to
      // the old caller, never publish it for subsequent reads.
      if (requestGeneration !== permissionCacheGeneration) return next;
      const prevJson = myCaps ? JSON.stringify(myCaps) : null;
      myCaps = next;
      myCapsAt = Date.now();
      // Business rules resolve group-scoped "applies to" audiences (schedule
      // display, past editing, working-week calendar) against these
      // memberships — keep them in sync.
      setBusinessRulesViewerGroups(next.groupIds);
      if (prevJson !== null && prevJson !== JSON.stringify(next)) {
        recPermCache.clear();
        bumpPermsVersion();
      }
      return next;
    } catch {
      // Never cache a failure — return optimistic, retry on next call.
      return myCaps ?? OPTIMISTIC_CAPS;
    } finally {
      // A cache bust can detach this request and start a newer one. The old
      // request must never clear the newer request's single-flight handle.
      if (myCapsInflight === request) myCapsInflight = null;
    }
  })();
  myCapsInflight = request;
  return request;
}

/** Strict variant for fail-CLOSED gates (e.g. the Configuration page): returns
 *  capabilities from the server (or the last real fetch), or null when the
 *  server could not be reached and nothing real is cached — NEVER the
 *  optimistic fallback, which would open an admin-gated page on a network
 *  blip. getMyCapabilities' failure path returns the OPTIMISTIC_CAPS object
 *  itself (by reference) only when there is no cached real answer, so an
 *  identity check distinguishes "optimistic because failed" from real data. */
export async function getMyCapabilitiesChecked(): Promise<MyCapabilities | null> {
  const got = await getMyCapabilities();
  return got === OPTIMISTIC_CAPS ? null : got;
}

/* ── Per-record permissions (server-evaluated; short cache) ─────────────── */

export interface RecordPermissions {
  canEditData: boolean;
  canAdvanceStage: boolean;
  /** Financial fields have their own capability — may differ from canEditData in BOTH directions. */
  canEditFinancials: boolean;
  reason: string | null;
  degraded?: boolean;
}

export const OPEN_RECORD_PERMS: RecordPermissions = { canEditData: true, canAdvanceStage: true, canEditFinancials: true, reason: null };

const recPermCache = new Map<string, { value: RecordPermissions; at: number; inflight?: Promise<RecordPermissions> }>();
const REC_PERM_TTL = 30_000;

function recordPermissionCacheKey(recordId: string): string {
  const session = getStoredUser();
  const tenant = (session?.tenant ?? "signed-out").trim().toLowerCase();
  const username = (session?.username ?? "anonymous").trim().toLowerCase();
  return `${tenant}|${username}|${recordId.trim().toUpperCase()}`;
}

export async function getRecordPermissions(
  recordId: string,
  opts?: { fresh?: boolean },
): Promise<RecordPermissions> {
  if (!recordId.trim()) return OPEN_RECORD_PERMS;
  // A record id is not globally unique across tenants, and two accounts in
  // one browser can have different stage/access verdicts for the same record.
  // Scope the cache by the live session so a previous user's denial can never
  // be reused after an account or tenant switch.
  const key = recordPermissionCacheKey(recordId);
  const hit = recPermCache.get(key);
  const now = Date.now();
  if (!opts?.fresh && hit && hit.value && now - hit.at < REC_PERM_TTL) return hit.value;
  if (hit?.inflight) return hit.inflight;
  const requestGeneration = permissionCacheGeneration;
  let inflight!: Promise<RecordPermissions>;
  inflight = (async () => {
    try {
      const body = await jsonOrThrow(await fetch(`${RMONE}/record-permissions/${encodeURIComponent(recordId.trim())}`, { headers: authHeaders() }));
      const value: RecordPermissions = {
        canEditData: body.canEditData !== false,
        canAdvanceStage: body.canAdvanceStage !== false,
        // Older server responses omit it — fall back to canEditData (previous behavior).
        canEditFinancials: typeof body.canEditFinancials === "boolean" ? body.canEditFinancials : body.canEditData !== false,
        reason: typeof body.reason === "string" && body.reason.trim() !== "" ? body.reason : null,
        degraded: body.degraded === true,
      };
      const active = recPermCache.get(key);
      if (requestGeneration === permissionCacheGeneration && active?.inflight === inflight) {
        recPermCache.set(key, { value, at: Date.now() });
      }
      return value;
    } catch {
      // Never let an old failed request delete a newer generation's entry.
      if (recPermCache.get(key)?.inflight === inflight) recPermCache.delete(key);
      return OPEN_RECORD_PERMS;  // optimistic — server still enforces
    }
  })();
  recPermCache.set(key, { value: hit?.value ?? OPEN_RECORD_PERMS, at: hit?.at ?? 0, inflight });
  return inflight;
}

export function bustRecordPermissions(recordId?: string): void {
  if (recordId) recPermCache.delete(recordPermissionCacheKey(recordId));
  else recPermCache.clear();
}

/* ── Self-service access-level revert (self-lockout escape hatch) ───────── */

/**
 * Revert MY access level to what it was before I changed it myself. The server
 * only honors this when the last change to this account's level was made BY
 * this account (an admin-made change stays admin-only). Throws with the
 * server's plain-language error otherwise.
 */
export async function revertMyAccessLevel(): Promise<{ ok: boolean; accessLevel: string }> {
  const r = await fetch(`${ONB}/my-access-level/revert`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body?.ok !== true) {
    throw new Error(typeof body?.error === "string" && body.error ? body.error : "Could not change your access level back.");
  }
  return { ok: true, accessLevel: String(body.accessLevel ?? "unset") };
}

/* ── Navigation visibility (#88, #90) ───────────────────────────────────── */

export interface NavItemRule {
  mode: "everyone" | "hidden" | "groups" | "roles";
  groupIds: string[];
  roleIds: string[];
}

/** Full nav-visibility doc returned by fetchNavVisibility (and sent on save). */
export interface NavVisibilityData {
  items: Record<string, NavItemRule>;
  /** Ordered list of nav item ids — absent means use the catalog default order. */
  order: string[];
  /** Custom display labels keyed by nav item id. */
  labels: Record<string, string>;
  /** Per-item vertical-sidebar or horizontal-top-bar placement. */
  surfaces: Record<string, NavSurface>;
}

/** What getMyNavigation resolves to (server-resolved, per-user). */
export interface MyNavigation {
  hidden: string[];
  order: string[];
  labels: Record<string, string>;
  surfaces: Record<string, NavSurface>;
}

export function coerceNavItems(v: unknown): Record<string, NavItemRule> {
  const src = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: Record<string, NavItemRule> = {};
  for (const [k, val] of Object.entries(src)) {
    const id = canonicalNavId(k);
    if (!id || !val || typeof val !== "object") continue;
    const o = val as Record<string, unknown>;
    const mode =
      o.mode === "everyone" ? "everyone" as const
      : o.mode === "hidden" ? "hidden" as const
      : o.mode === "groups" ? "groups" as const
      : o.mode === "roles" ? "roles" as const
      : null;
    if (!mode) continue;
    out[id] = { mode, groupIds: strList(o.groupIds), roleIds: strList(o.roleIds) };
  }
  return out;
}

function coerceNavSurfaces(v: unknown): Record<string, NavSurface> {
  const src = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: Record<string, NavSurface> = {};
  for (const [k, value] of Object.entries(src)) {
    const id = canonicalNavId(k);
    if (!id || (value !== "vertical" && value !== "horizontal")) continue;
    out[id] = value;
  }
  return out;
}

export async function fetchNavVisibility(tenantId?: string): Promise<NavVisibilityData> {
  const body = await jsonOrThrow(await fetch(`${ONB}/nav-visibility${qsFor(tenantId)}`, { headers: authHeaders() }));
  const order = Array.isArray(body.order)
    ? (body.order as unknown[]).map(canonicalNavId).filter(Boolean)
    : [];
  const labelsRaw = (body.labels && typeof body.labels === "object" ? body.labels : {}) as Record<string, unknown>;
  const labels: Record<string, string> = {};
  for (const [k, v] of Object.entries(labelsRaw)) {
    if (k && typeof v === "string" && v.trim()) labels[canonicalNavId(k)] = v.trim();
  }
  return { items: coerceNavItems(body.items), order, labels, surfaces: coerceNavSurfaces(body.surfaces) };
}

export async function saveNavVisibility(
  data: NavVisibilityData, tenantId?: string,
): Promise<NavVisibilityData> {
  const payload: Record<string, unknown> = {
    items: data.items,
    order: data.order,
    labels: data.labels,
    surfaces: data.surfaces,
  };
  if (tenantId) payload.tenantId = tenantId;
  const body = await jsonOrThrow(await fetch(`${ONB}/nav-visibility`, {
    method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }));
  bustPermissionCaches();
  // Any mounted Shell (this tab) rebuilds its sidebar right away.
  try { window.dispatchEvent(new CustomEvent("rmone:navChanged")); } catch { /* SSR */ }
  const order = Array.isArray(body.order)
    ? (body.order as unknown[]).map(canonicalNavId).filter(Boolean)
    : [];
  const labelsRaw = (body.labels && typeof body.labels === "object" ? body.labels : {}) as Record<string, unknown>;
  const labels: Record<string, string> = {};
  for (const [k, v] of Object.entries(labelsRaw)) {
    if (k && typeof v === "string" && v.trim()) labels[canonicalNavId(k)] = v.trim();
  }
  return { items: coerceNavItems(body.items), order, labels, surfaces: coerceNavSurfaces(body.surfaces) };
}

/* ── My navigation — per-user resolved menu config ───────────────────────────
 * Server-resolved (groups + admin protection applied there). Fails OPEN to the
 * full menu: nav hiding is display config — page data stays behind the server's
 * #87 gates regardless of what the menu shows. */

const EMPTY_MY_NAV: MyNavigation = { hidden: [], order: [], labels: {}, surfaces: {} };

let myNav: MyNavigation | null = null;
let myNavAt = 0;
let myNavInflight: Promise<MyNavigation> | null = null;
let myNavGeneration = 0;
const MY_NAV_TTL = 60_000;

export async function getMyNavigation(opts?: { fresh?: boolean }): Promise<MyNavigation> {
  const now = Date.now();
  if (!opts?.fresh) {
    if (myNav && now - myNavAt < MY_NAV_TTL) return myNav;
    if (myNavInflight) return myNavInflight;
  }
  const requestGeneration = myNavGeneration;
  let inflight!: Promise<MyNavigation>;
  inflight = (async () => {
    try {
      const body = await jsonOrThrow(await fetch(`${RMONE}/my-navigation`, { headers: authHeaders() }));
      const hidden = Array.isArray(body.hidden)
        ? (body.hidden as unknown[]).map(canonicalNavId).filter(Boolean)
        : [];
      const order = Array.isArray(body.order)
        ? (body.order as unknown[]).map(canonicalNavId).filter(Boolean)
        : [];
      const labelsRaw = (body.labels && typeof body.labels === "object" ? body.labels : {}) as Record<string, unknown>;
      const labels: Record<string, string> = {};
      for (const [k, v] of Object.entries(labelsRaw)) {
        if (k && typeof v === "string" && v.trim()) labels[canonicalNavId(k)] = v.trim();
      }
      const result: MyNavigation = {
        hidden,
        order,
        labels,
        surfaces: coerceNavSurfaces(body.surfaces),
      };
      if (requestGeneration === myNavGeneration && myNavInflight === inflight) {
        myNav = result;
        myNavAt = Date.now();
      }
      return result;
    } catch {
      return myNav ?? EMPTY_MY_NAV; // never cache a failure; show the full menu meanwhile
    } finally {
      if (myNavInflight === inflight) myNavInflight = null;
    }
  })();
  myNavInflight = inflight;
  return inflight;
}

export function bustPermissionCaches(): void {
  permissionCacheGeneration++;
  myCaps = null;
  myCapsAt = 0;
  // Detach old single-flight requests. Generation checks prevent their
  // eventual responses from publishing or clearing newer request handles.
  myCapsInflight = null;
  myNav = null;
  myNavAt = 0;
  myNavGeneration++;
  myNavInflight = null;
  recPermCache.clear();
  // Business-rules audience resolution is keyed to the viewer's groups.
  // Reset to "unknown" (null → tenant values apply) so a new session never
  // resolves audiences with the PREVIOUS user's group memberships; the next
  // successful getMyCapabilities() re-seeds the real groups.
  setBusinessRulesViewerGroups(null);
  bumpPermsVersion();
}

/* ── Reactive version + cross-tab sync ──────────────────────────────────── */
// Access-level/staff changes must reach already-rendered pages: components
// subscribe via usePermissionsVersion() and re-read caps/record perms when it
// bumps. Mirrors lib/stageRules.ts — each tab holds its OWN module singleton,
// so a save in the Settings tab pings sibling tabs over BroadcastChannel
// (zero-browser-storage rule: no localStorage pings), with a
// visibilitychange refetch as the no-channel fallback.

let permsVersion = 0;
const permListeners = new Set<() => void>();

function bumpPermsVersion(): void {
  permsVersion++;
  for (const l of Array.from(permListeners)) {
    try { l(); } catch { /* ignore */ }
  }
}

function subscribePerms(cb: () => void): () => void {
  permListeners.add(cb);
  return () => { permListeners.delete(cb); };
}

/** Reactive version counter — re-renders the component when permissions change. */
export function usePermissionsVersion(): number {
  return useSyncExternalStore(subscribePerms, () => permsVersion, () => permsVersion);
}

/** Reactive "can this user edit financial fields?" — fail-closed (false until
 *  the server answers), re-checked whenever permissions change. Use to hide
 *  rate/contract-value edit affordances; the server enforces regardless. */
export function useEditFinancialsCap(): boolean {
  const ver = usePermissionsVersion();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    setOk(false); // fail-closed while (re)checking — never carry a stale true
    // Checked variant: the optimistic fallback caps must never grant this.
    getMyCapabilitiesChecked()
      .then((c) => { if (alive) setOk(c?.caps?.editFinancials === true); })
      .catch(() => { if (alive) setOk(false); });
    return () => { alive = false; };
  }, [ver]);
  return ok;
}

const PERMS_SYNC_CHANNEL = "rmone:permissions-sync";

function pingPermissionSiblings(): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const ch = new BroadcastChannel(PERMS_SYNC_CHANNEL);
    ch.postMessage({ tenant: (getStoredUser()?.tenant ?? "").trim().toLowerCase() });
    ch.close();
  } catch { /* blocked/unsupported — the visibility refetch still covers it */ }
}

/**
 * Call after ANY save that changes who can do what — access-level definitions,
 * a person's assigned level, stage permissions. Busts this tab's caches
 * (bumping the version so mounted components re-read) and pings sibling tabs.
 */
export function notifyPermissionsChanged(): void {
  bustPermissionCaches();
  pingPermissionSiblings();
  // Same-tab listeners outside this module (e.g. stage rules — group
  // membership decides which group-scoped workflow a viewer gets) resync on
  // this event; the BroadcastChannel ping above only reaches SIBLING tabs.
  try { window.dispatchEvent(new Event("rmone:permissionsChanged")); } catch { /* SSR/tests */ }
  // Warm the fresh answer immediately so UI gates update without waiting for
  // the next component-triggered read.
  void getMyCapabilities();
}

// Different sign-in (or tenant switch) → none of this applies anymore.
if (typeof window !== "undefined") {
  window.addEventListener("rmone:authChanged", () => bustPermissionCaches());
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const ch = new BroadcastChannel(PERMS_SYNC_CHANNEL);
      ch.onmessage = (e: MessageEvent) => {
        const own = (getStoredUser()?.tenant ?? "").trim().toLowerCase();
        const from = typeof (e.data as { tenant?: unknown })?.tenant === "string" ? (e.data as { tenant: string }).tenant : "";
        if (!own || (from && from !== own)) return;
        bustPermissionCaches();
        void getMyCapabilities();
      };
    } catch { /* unsupported */ }
  }
  // Belt-and-braces: coming back to a backgrounded tab re-reads capabilities
  // once the TTL has lapsed; getMyCapabilities bumps the version only when the
  // answer actually changed, so this never causes gratuitous re-renders.
  document.addEventListener("visibilitychange", () => {
    // Another browser/session may have changed this user's built-in override;
    // BroadcastChannel only covers sibling tabs in this browser. Always make
    // one real request on return instead of honoring the 60s local TTL.
    if (document.visibilityState === "visible") void getMyCapabilities({ fresh: true });
  });
}
