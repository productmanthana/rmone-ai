/**
 * Company access control — admin-configured, tenant-wide (#87):
 *
 *  1. USER GROUPS: named sets of user ids ("Estimating Team"). Groups exist so
 *     per-stage permissions can point at a team instead of listing people.
 *
 *  2. CUSTOM ACCESS LEVELS: admin-defined capability bundles assigned to a
 *     user the same way the built-in admin/manager/user levels are. Stored on
 *     the users row as "custom:<id>" (access_level is NVARCHAR(20), so ids are
 *     capped at 13 chars — enforced by the sanitizer below). Built-in levels
 *     and grandfathered (unset) accounts are NEVER routed through this module:
 *     callers first check isCustomAcl() and fall back to today's behavior.
 *     A custom level that has been deleted fails CLOSED to view-only.
 *
 *  3. PER-STAGE PERMISSIONS: for a (module, stage) pair, admins may name
 *     ACTION users/groups (may advance the stage AND edit data) and DATA
 *     EDITORS (may edit data but not advance). A stage with no rule behaves
 *     exactly as today. A rule applies to admins too — same stance as stage
 *     rules (#86): admins fix the rule in Settings, they don't bypass it.
 *
 * Storage: one settings row per doc in the onboarding settings table
 * (scopes "usergroups:<tenant>", "accesslevels:<tenant>", "stageperms:<tenant>"
 * — same pattern as "stagerules:<tenant>"). Each doc is cached 60s per worker
 * with stale-if-error; saves broadcast an IPC bust (fn "accessControl").
 *
 * The web mirrors none of the evaluation logic — it asks the server via
 * GET /api/rmone/my-capabilities and GET /api/rmone/record-permissions/:id,
 * so enforcement and display can never drift apart.
 */
import { getOnboardingSettings, upsertOnboardingSettings } from "@workspace/db";
import type { StageRuleModule } from "./stage-rules.js";
import { STAGE_RULE_MODULES } from "./stage-rules.js";
// Role sentinels ("role:<roleGuid>") ride the same groupIds lists and the
// same live resolver as org sentinels — see role-audience.ts for the
// name-bridge semantics. Re-exported so audience consumers can import every
// sentinel helper from this module.
import { isRoleAudienceId } from "./role-audience.js";
export { isRoleAudienceId };

// ── Types ────────────────────────────────────────────────────────────────────

export interface Caps {
  editData: boolean;        // may change record fields, allocations, schedules
  advanceStages: boolean;   // may change a record's stage/status
  editFinancials: boolean;  // may change contract values & other financial fields
  manageStaff: boolean;     // may add/edit staff and their assignments
  manageSettings: boolean;  // may change company-wide settings
  importPage: boolean;      // may see/use the Import page (admins always may)
}

export const ALL_CAPS: Caps = { editData: true, advanceStages: true, editFinancials: true, manageStaff: true, manageSettings: true, importPage: true };
export const NO_CAPS: Caps = { editData: false, advanceStages: false, editFinancials: false, manageStaff: false, manageSettings: false, importPage: false };
export const MANAGER_DEFAULT_CAPS: Caps = {
  editData: true, advanceStages: true, editFinancials: true, manageStaff: true,
  manageSettings: false, importPage: false,
};

export interface UserGroup {
  id: string; name: string; memberIds: string[]; color: string;
  /** Level NAME (built-in or custom) this group suggests for its members —
   *  picked when the group is created from a projects/opps import; staff
   *  imports fill empty Access Level cells from it. Optional. */
  defaultAccessLevel?: string;
}
export interface UserGroupsDoc { groups: UserGroup[] }

/**
 * Preset palette for group colors — auto-assigned when a group has none.
 * Keep in lockstep with GROUP_COLOR_PALETTE in rmone-web/src/lib/permissions.ts
 * (the client previews the same first-unused assignment before save).
 */
export const GROUP_COLOR_PALETTE = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#84cc16", "#06b6d4", "#a855f7",
  "#e11d48", "#3b82f6", "#22c55e", "#d97706",
];

export interface AccessLevelDef { id: string; name: string; caps: Caps }

/** Admin-defined overrides for the built-in Manager and User levels.
 *  Manager caps default to editData+advanceStages+editFinancials+manageStaff;
 *  User defaults to all-false (view-only). Admins can widen or narrow either.
 *  Admin itself is never overrideable — it always has full access. */
export interface BuiltinLevelOverrides {
  manager?: Partial<Caps>;
  user?: Partial<Caps>;
}

/** "admin" = import page only visible to admins (default/original behavior).
 *  "manager" = admins + managers (managers see it by default).
 *  "all" = anyone who can edit. */
export type ImportAccess = "admin" | "manager" | "all";

export interface AccessLevelsDoc {
  levels: AccessLevelDef[];
  builtinOverrides?: BuiltinLevelOverrides;
  importAccess?: ImportAccess;
}

export interface StagePermRule {
  module: StageRuleModule;
  /** Stage name, matched case-insensitively against the record's current stage. */
  stage: string;
  actionUserIds: string[];
  actionGroupIds: string[];
  editorUserIds: string[];
  editorGroupIds: string[];
  /** What everyone NOT listed can do. "viewOnly" (legacy default) = unlisted
   *  users are read-only at this stage; "normal" = the rule only grants the
   *  listed people their tier and everyone else falls back to their regular
   *  access level. Both sanitizers (this one and the web coerce) must
   *  round-trip this field — a dropped optional here silently reverts the
   *  admin's choice on the next save. */
  othersMode?: "viewOnly" | "normal";
}
export interface StagePermsDoc { rules: StagePermRule[] }

export const EMPTY_GROUPS: UserGroupsDoc = { groups: [] };
export const EMPTY_LEVELS: AccessLevelsDoc = { levels: [] };
export const EMPTY_STAGE_PERMS: StagePermsDoc = { rules: [] };

// ── Custom access-level marker ("custom:<id>" in the access_level column) ────

export const CUSTOM_ACL_PREFIX = "custom:";
// access_level is NVARCHAR(20): "custom:" (7) + id (≤13) must fit.
export const LEVEL_ID_RE = /^[a-z0-9][a-z0-9-]{0,12}$/;
const GROUP_ID_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;

export function isCustomAcl(acl: string | null | undefined): boolean {
  return String(acl ?? "").trim().toLowerCase().startsWith(CUSTOM_ACL_PREFIX);
}

/** "custom:estim1" → "estim1"; null when not a well-formed custom marker. */
export function customLevelId(acl: string | null | undefined): string | null {
  const s = String(acl ?? "").trim().toLowerCase();
  if (!s.startsWith(CUSTOM_ACL_PREFIX)) return null;
  const id = s.slice(CUSTOM_ACL_PREFIX.length);
  return LEVEL_ID_RE.test(id) ? id : null;
}

// ── Sanitizers (shape-guard raw settings from DB or a PUT body) ─────────────

const MAX_GROUPS = 100;
const MAX_LEVELS = 50;
const MAX_STAGE_RULES = 200;
const MAX_MEMBERS = 1000;
const MAX_NAME = 80;

function cleanStr(v: unknown, max = MAX_NAME): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Lowercased, deduped id list (user GUIDs / group ids). */
function cleanIdList(v: unknown, max = MAX_MEMBERS): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    const s = cleanStr(item, 64).toLowerCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/;

/** Valid "#rrggbb" lowercased, else null (bad colors fall back to auto-assign). */
function cleanColor(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return HEX_COLOR_RE.test(s) ? s : null;
}

export function sanitizeUserGroups(raw: unknown): UserGroupsDoc {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const parsed: Array<{ id: string; name: string; memberIds: string[]; color: string | null; defaultAccessLevel: string }> = [];
  const seenIds = new Set<string>();
  if (Array.isArray(o.groups)) {
    for (const g of o.groups) {
      if (!g || typeof g !== "object") continue;
      const gg = g as Record<string, unknown>;
      const id = cleanStr(gg.id, 24).toLowerCase();
      const name = cleanStr(gg.name);
      if (!id || !name || !GROUP_ID_RE.test(id) || seenIds.has(id)) continue;
      seenIds.add(id);
      parsed.push({ id, name, memberIds: cleanIdList(gg.memberIds), color: cleanColor(gg.color), defaultAccessLevel: cleanStr(gg.defaultAccessLevel) });
      if (parsed.length >= MAX_GROUPS) break;
    }
  }
  // Auto-assign colors: explicit colors win; colorless groups take the first
  // palette color nobody uses yet, in list order. Deterministic on doc order,
  // so legacy docs (saved before colors existed) render stable colors on every
  // GET even before their next save persists them. Keep in lockstep with
  // groupColorMap() in rmone-web/src/lib/permissions.ts.
  const used = new Set<string>(parsed.map(g => g.color).filter((c): c is string => c !== null));
  const groups: UserGroup[] = parsed.map((g, i) => {
    const dal = g.defaultAccessLevel ? { defaultAccessLevel: g.defaultAccessLevel } : {};
    if (g.color) return { id: g.id, name: g.name, memberIds: g.memberIds, color: g.color, ...dal };
    const pick = GROUP_COLOR_PALETTE.find(p => !used.has(p)) ?? GROUP_COLOR_PALETTE[i % GROUP_COLOR_PALETTE.length];
    used.add(pick);
    return { id: g.id, name: g.name, memberIds: g.memberIds, color: pick, ...dal };
  });
  return { groups };
}

export function sanitizeAccessLevels(raw: unknown): AccessLevelsDoc {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // Legacy import page dropdown ("admin"/"manager"/"all") — kept only so old
  // docs keep behaving until their first save: when a caps object predates the
  // per-level importPage flag (key absent), the flag is DERIVED from this.
  const rawIA = String(o.importAccess ?? "").toLowerCase();
  const importAccess: ImportAccess = rawIA === "manager" ? "manager" : rawIA === "all" ? "all" : "admin";

  const levels: AccessLevelDef[] = [];
  const seenIds = new Set<string>();
  if (Array.isArray(o.levels)) {
    for (const l of o.levels) {
      if (!l || typeof l !== "object") continue;
      const ll = l as Record<string, unknown>;
      const id = cleanStr(ll.id, 13).toLowerCase();
      const name = cleanStr(ll.name);
      if (!id || !name || !LEVEL_ID_RE.test(id) || seenIds.has(id)) continue;
      seenIds.add(id);
      const c = (ll.caps && typeof ll.caps === "object" ? ll.caps : {}) as Record<string, unknown>;
      levels.push({
        id,
        name,
        caps: {
          editData: c.editData === true,
          advanceStages: c.advanceStages === true,
          editFinancials: c.editFinancials === true,
          manageStaff: c.manageStaff === true,
          manageSettings: c.manageSettings === true,
          // Legacy docs (pre-importPage): custom levels effectively always
          // saw the Import page (the old canImport field was simply absent
          // for them and the web treated missing as allowed). Preserve that
          // for levels that can actually edit; view-only levels fail closed.
          importPage: typeof c.importPage === "boolean"
            ? c.importPage
            : c.editData === true,
        },
      });
      if (levels.length >= MAX_LEVELS) break;
    }
  }
  // Builtin overrides — Manager and User caps only; Admin is always ALL_CAPS.
  const ovRaw = (o.builtinOverrides && typeof o.builtinOverrides === "object"
    ? o.builtinOverrides : {}) as Record<string, unknown>;
  const cleanPartialCaps = (v: unknown): Partial<Caps> | undefined => {
    if (!v || typeof v !== "object") return undefined;
    const c = v as Record<string, unknown>;
    const out: Partial<Caps> = {};
    for (const k of ["editData","advanceStages","editFinancials","manageStaff","manageSettings","importPage"] as const) {
      if (typeof c[k] === "boolean") out[k] = c[k] as boolean;
    }
    return Object.keys(out).length ? out : undefined;
  };
  const builtinOverrides: BuiltinLevelOverrides = {};
  const mgr = cleanPartialCaps(ovRaw.manager);
  const usr = cleanPartialCaps(ovRaw.user);
  if (mgr) builtinOverrides.manager = mgr;
  if (usr) builtinOverrides.user = usr;

  // Legacy dropdown → per-level flags for the built-ins, only where the saved
  // override doesn't already carry an explicit importPage decision.
  if (importAccess !== "admin" && builtinOverrides.manager?.importPage === undefined) {
    builtinOverrides.manager = { ...(builtinOverrides.manager ?? {}), importPage: true };
  }
  if (importAccess === "all" && builtinOverrides.user?.importPage === undefined
      && builtinOverrides.user?.editData === true) {
    builtinOverrides.user = { ...builtinOverrides.user, importPage: true };
  }

  return { levels, builtinOverrides, importAccess };
}

export function sanitizeStagePerms(raw: unknown): StagePermsDoc {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rules: StagePermRule[] = [];
  const seen = new Set<string>();
  if (Array.isArray(o.rules)) {
    for (const r of o.rules) {
      if (!r || typeof r !== "object") continue;
      const rr = r as Record<string, unknown>;
      const module = cleanStr(rr.module, 8).toUpperCase();
      const stage = cleanStr(rr.stage, 200);
      if (!stage || !(STAGE_RULE_MODULES as string[]).includes(module)) continue;
      const key = `${module}|${stage.toLowerCase()}`;
      if (seen.has(key)) continue; // one rule per (module, stage) — first wins
      seen.add(key);
      const rule: StagePermRule = {
        module: module as StageRuleModule,
        stage,
        actionUserIds: cleanIdList(rr.actionUserIds),
        actionGroupIds: cleanIdList(rr.actionGroupIds, 100),
        editorUserIds: cleanIdList(rr.editorUserIds),
        editorGroupIds: cleanIdList(rr.editorGroupIds, 100),
        othersMode: rr.othersMode === "normal" ? "normal" : "viewOnly",
      };
      // A rule with NO assignments at all would lock everyone out of the stage
      // with no way to satisfy it accidentally — keep it (that's an explicit
      // admin decision, e.g. "freeze this stage"), but only when the admin
      // really saved arrays (all four lists exist on the object).
      rules.push(rule);
      if (rules.length >= MAX_STAGE_RULES) break;
    }
  }
  return { rules };
}

// ── Per-tenant cached loaders (60s TTL, stale-if-error, single-flight) ──────
// Mirrors getStageRulesForTenant in rds-provider.ts: only a COLD miss throws,
// so enforcement fails closed exactly when we have never seen the policy.

export const USER_GROUPS_SCOPE_PREFIX = "usergroups:";
export const ACCESS_LEVELS_SCOPE_PREFIX = "accesslevels:";
export const STAGE_PERMS_SCOPE_PREFIX = "stageperms:";

// MUST mirror normTenant in routes/onboarding.ts — both key the same settings rows.
function normAcTenant(t: string): string {
  return t.trim().replace(/\s+/g, "_").toLowerCase();
}

const AC_TTL_MS = 60_000;

interface CacheSlot<T> { v: T; at: number }
function makeLoader<T>(scopePrefix: string, sanitize: (raw: unknown) => T, empty: T) {
  const cache = new Map<string, CacheSlot<T>>();
  const inFlight = new Map<string, Promise<T>>();
  const get = async (tenantLabel: string): Promise<T> => {
    const key = normAcTenant(tenantLabel);
    if (!key) return empty;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < AC_TTL_MS) return hit.v;
    const running = inFlight.get(key);
    if (running) return running;
    const p = (async () => {
      try {
        const row = await getOnboardingSettings(scopePrefix + key);
        const v = sanitize(row?.settings);
        cache.set(key, { v, at: Date.now() });
        return v;
      } catch (e) {
        if (hit) {
          // Serve stale; mark fresh-ish so the next attempt retries in ~10s.
          cache.set(key, { v: hit.v, at: Date.now() - AC_TTL_MS + 10_000 });
          return hit.v;
        }
        throw e;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, p);
    return p;
  };
  const bust = () => { cache.clear(); inFlight.clear(); };
  return { get, bust };
}

const groupsLoader = makeLoader(USER_GROUPS_SCOPE_PREFIX, sanitizeUserGroups, EMPTY_GROUPS);
const levelsLoader = makeLoader(ACCESS_LEVELS_SCOPE_PREFIX, sanitizeAccessLevels, EMPTY_LEVELS);
const permsLoader = makeLoader(STAGE_PERMS_SCOPE_PREFIX, sanitizeStagePerms, EMPTY_STAGE_PERMS);

export const getUserGroupsForTenant = groupsLoader.get;
export const getAccessLevelsForTenant = levelsLoader.get;
export const getStagePermsForTenant = permsLoader.get;

/** Drop every worker-local access-control snapshot (all four docs). */
export function bustAccessControlCache(_tenantLabel?: string): void {
  groupsLoader.bust();
  levelsLoader.bust();
  permsLoader.bust();
  navLoader.bust();
  aclChangesLoader.bust();
}

// ── Capability resolution ────────────────────────────────────────────────────

/**
 * Capabilities for a CUSTOM access level, or null when the acl is a built-in
 * (admin/manager/user/unset/blank) — callers must keep today's behavior for
 * those. A custom marker whose level no longer exists (deleted, or malformed
 * id) fails CLOSED to NO_CAPS (view-only). Throws only on a cold policy-read
 * failure — callers fail closed on that too.
 */
export async function getCapsForAcl(acl: string | null | undefined, tenantLabel: string): Promise<Caps | null> {
  if (!isCustomAcl(acl)) return null;
  const id = customLevelId(acl);
  if (!id) return { ...NO_CAPS };
  const doc = await getAccessLevelsForTenant(tenantLabel);
  const level = doc.levels.find((l) => l.id === id);
  return level ? { ...level.caps } : { ...NO_CAPS };
}

export interface ResolvedAccessCaps {
  /** null preserves legacy handling for unset and unknown/grandfathered ACLs. */
  caps: Caps | null;
  /** A saved built-in override or custom definition made this decision. */
  explicit: boolean;
}

/**
 * Deterministically resolve a known level against an already-loaded policy
 * document. Keeping this pure makes the capability matrix usable by both HTTP
 * gates and regression checks without a database fixture.
 */
export function resolveAccessCapsFromDoc(
  acl: string | null | undefined,
  doc: AccessLevelsDoc,
): ResolvedAccessCaps {
  const level = String(acl ?? "").trim().toLowerCase();
  if (level === "admin" || level === "administrator") {
    return { caps: { ...ALL_CAPS }, explicit: false };
  }
  if (level === "manager") {
    const override = doc.builtinOverrides?.manager;
    return { caps: { ...MANAGER_DEFAULT_CAPS, ...(override ?? {}) }, explicit: override !== undefined };
  }
  if (level === "user") {
    const override = doc.builtinOverrides?.user;
    return { caps: { ...NO_CAPS, ...(override ?? {}) }, explicit: override !== undefined };
  }
  if (isCustomAcl(level)) {
    const id = customLevelId(level);
    const custom = id ? doc.levels.find((candidate) => candidate.id === id) : undefined;
    return { caps: custom ? { ...custom.caps } : { ...NO_CAPS }, explicit: true };
  }
  return { caps: null, explicit: false };
}

/** Resolve the authoritative built-in/custom capability bundle for an ACL. */
export async function getResolvedAccessCaps(
  acl: string | null | undefined,
  tenantLabel: string,
): Promise<ResolvedAccessCaps> {
  const level = String(acl ?? "").trim().toLowerCase();
  // Admin is unconditional and unknown/unset levels retain their existing
  // grandfathered behavior, so neither requires a policy read.
  if (level === "admin" || level === "administrator") return { caps: { ...ALL_CAPS }, explicit: false };
  if (!isCustomAcl(level) && level !== "manager" && level !== "user") {
    return { caps: null, explicit: false };
  }
  return resolveAccessCapsFromDoc(level, await getAccessLevelsForTenant(tenantLabel));
}

/** Tenant-customized capability overrides for a BUILT-IN manager/user level
 *  (the Access Levels page lets admins tick extra capabilities like "Company
 *  settings" onto the built-ins). Returns null for admin/unset (already
 *  admin-capable) and for custom acls (use getCapsForAcl). Throws when the
 *  policy doc is unreadable — callers fail closed. */
export async function getBuiltinOverrideCaps(acl: string | null | undefined, tenantLabel: string): Promise<Partial<Caps> | null> {
  const l = String(acl ?? "").trim().toLowerCase();
  if (l !== "manager" && l !== "user") return null;
  const doc = await getAccessLevelsForTenant(tenantLabel);
  return (l === "manager" ? doc.builtinOverrides?.manager : doc.builtinOverrides?.user) ?? null;
}

/** Display name of a custom level ("Estimator") or null. */
export async function getCustomLevelName(acl: string | null | undefined, tenantLabel: string): Promise<string | null> {
  if (!isCustomAcl(acl)) return null;
  const id = customLevelId(acl);
  if (!id) return null;
  try {
    const doc = await getAccessLevelsForTenant(tenantLabel);
    return doc.levels.find((l) => l.id === id)?.name ?? null;
  } catch {
    return null;
  }
}

// ── Access-level change log (self-lockout escape hatch) ─────────────────────
// Records WHO last changed each user's access level and what it was before,
// in a settings doc ("aclchanges:<tenant>"). Purpose: a user who downgraded
// their OWN level by mistake (e.g. an admin testing a custom level) may revert
// it themselves; a level set by someone else stays locked. Not a full audit
// trail — one entry per user, latest change wins.

export const ACL_CHANGES_SCOPE_PREFIX = "aclchanges:";

export interface AclChangeEntry {
  /** The access level BEFORE the change (null = unset/grandfathered). */
  prev: string | null;
  /**
   * The access level the change RESULTED IN ("unset" for cleared), normalized
   * lowercase. null = legacy/unknown. The revert route only honors an entry
   * whose `next` still equals the user's CURRENT level — this binds the entry
   * to its transition, so a later change whose own log write failed (the log
   * is best-effort) leaves a STALE entry that fails closed instead of
   * authorizing a revert past the newest change.
   */
  next: string | null;
  /** Lowercased user id of who made the change. */
  by: string;
  /** ISO timestamp of the change. */
  at: string;
}
export interface AclChangesDoc { users: Record<string, AclChangeEntry> }
export const EMPTY_ACL_CHANGES: AclChangesDoc = { users: {} };

const MAX_ACL_CHANGE_ENTRIES = 2000;

export function sanitizeAclChanges(raw: unknown): AclChangesDoc {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const src = (o.users && typeof o.users === "object" ? o.users : {}) as Record<string, unknown>;
  const users: Record<string, AclChangeEntry> = {};
  let n = 0;
  for (const [k, v] of Object.entries(src)) {
    const uid = cleanStr(k, 64).toLowerCase();
    if (!uid || !v || typeof v !== "object") continue;
    const vv = v as Record<string, unknown>;
    const prevRaw = typeof vv.prev === "string" ? vv.prev.trim().slice(0, 20).toLowerCase() : null;
    const nextRaw = typeof vv.next === "string" ? vv.next.trim().slice(0, 20).toLowerCase() : null;
    users[uid] = {
      prev: prevRaw === "" || prevRaw === null ? null : prevRaw,
      next: nextRaw === "" || nextRaw === null ? null : nextRaw,
      by: cleanStr(vv.by, 64).toLowerCase(),
      at: cleanStr(vv.at, 40),
    };
    if (++n >= MAX_ACL_CHANGE_ENTRIES) break;
  }
  return { users };
}

const aclChangesLoader = makeLoader(ACL_CHANGES_SCOPE_PREFIX, sanitizeAclChanges, EMPTY_ACL_CHANGES);

/** Latest recorded access-level change for one user, or null. */
export async function getAclChangeEntry(tenantLabel: string, userId: string | null | undefined): Promise<AclChangeEntry | null> {
  const uid = String(userId ?? "").trim().toLowerCase();
  if (!uid) return null;
  const doc = await aclChangesLoader.get(tenantLabel);
  return doc.users[uid] ?? null;
}

/**
 * Record an access-level change (read-modify-write on the settings doc).
 * Callers treat failures as non-fatal (the change itself already landed) —
 * they log and move on, so a doc hiccup never fails a staff save.
 */
export async function recordAclChange(
  tenantLabel: string,
  targetUserId: string,
  prevAcl: string | null | undefined,
  nextAcl: string | null | undefined,
  byUserId: string | null | undefined,
): Promise<void> {
  const key = normAcTenant(tenantLabel);
  const uid = String(targetUserId ?? "").trim().toLowerCase();
  const by = String(byUserId ?? "").trim().toLowerCase();
  if (!key || !uid || !by) return;
  const scope = ACL_CHANGES_SCOPE_PREFIX + key;
  const row = await getOnboardingSettings(scope);
  const doc = sanitizeAclChanges(row?.settings);
  doc.users[uid] = {
    prev: prevAcl == null || String(prevAcl).trim() === "" ? null : String(prevAcl).trim().slice(0, 20).toLowerCase(),
    // "unset" (not null) when the change CLEARED the level — null is reserved
    // for legacy/unknown, which the revert route rejects.
    next: String(nextAcl ?? "").trim().slice(0, 20).toLowerCase() || "unset",
    by,
    at: new Date().toISOString(),
  };
  // Cap the doc: keep the most recent entries when a tenant churns levels a lot.
  const entries = Object.entries(doc.users);
  if (entries.length > MAX_ACL_CHANGE_ENTRIES) {
    entries.sort((a, b) => (a[1].at < b[1].at ? 1 : -1));
    doc.users = Object.fromEntries(entries.slice(0, MAX_ACL_CHANGE_ENTRIES));
  }
  await upsertOnboardingSettings({ scope, label: tenantLabel, settings: doc as unknown as Record<string, unknown> });
  aclChangesLoader.bust();
}

/** Drop a user's change entry (after a successful self-revert — the offer goes away). */
export async function clearAclChangeEntry(tenantLabel: string, userId: string): Promise<void> {
  const key = normAcTenant(tenantLabel);
  const uid = String(userId ?? "").trim().toLowerCase();
  if (!key || !uid) return;
  const scope = ACL_CHANGES_SCOPE_PREFIX + key;
  const row = await getOnboardingSettings(scope);
  const doc = sanitizeAclChanges(row?.settings);
  if (!(uid in doc.users)) return;
  delete doc.users[uid];
  await upsertOnboardingSettings({ scope, label: tenantLabel, settings: doc as unknown as Record<string, unknown> });
  aclChangesLoader.bust();
}

// ── Per-stage permission evaluation ──────────────────────────────────────────

export interface StagePermVerdict {
  /** True when a rule exists for this (module, stage) — i.e. the stage is governed. */
  restricted: boolean;
  canAdvance: boolean;
  canEdit: boolean;
  /** The rule's stage name (for messages), when restricted. */
  ruleStage?: string;
}

export const OPEN_STAGE_VERDICT: StagePermVerdict = { restricted: false, canAdvance: true, canEdit: true };

/**
 * Evaluate the tenant's per-stage permissions for one user on one
 * (module, current stage). No rule → open (today's behavior). With a rule:
 * action users/groups may advance AND edit; data editors may edit only;
 * everyone else is view-only UNLESS the rule says othersMode "normal", in
 * which case unlisted users get the OPEN verdict and their regular access
 * level applies (verdict consumers only ever REDUCE access, so this can
 * never escalate). Group membership is resolved against the tenant's user
 * groups. Throws only on a cold policy-read failure.
 */
// ── Org-audience sentinel ids ────────────────────────────────────────────────
// Rules and pickers may target a whole Business Unit / Division / Department
// directly with a sentinel id ("org:bu:<id>", "org:div:<id>", "org:dept:<id>")
// stored wherever group ids are stored. Membership is LIVE — resolved from the
// tenant's org chart at check time, so people who join/leave an org unit are
// covered automatically. The actual resolver lives in rds-provider (it owns
// the org-chain cache); it registers itself here to avoid a circular import.
const ORG_AUDIENCE_RE = /^org:(bu|div|dept):/i;
export function isOrgAudienceId(id: unknown): boolean {
  return ORG_AUDIENCE_RE.test(String(id ?? "").trim());
}

/** True when an id list references any LIVE-resolved audience sentinel
 *  (org:bu/div/dept or role:<guid>) — callers use it to decide whether the
 *  live membership set must be fetched before matching. Every gate that
 *  lazily loads the live set MUST use this: an org-only shape check would
 *  skip the load for a rule that lists only role sentinels, and the match
 *  would silently fail for everyone. */
export function needsLiveAudienceSet(ids: string[]): boolean {
  return ids.some((id) => isOrgAudienceId(id) || isRoleAudienceId(id));
}

/** ONE membership predicate for group-or-sentinel id lists (stage rules, nav
 *  visibility): a real group matches by memberIds, a live sentinel (org unit
 *  or role) matches when the viewer's live audience set contains it. liveSet
 *  null = not loaded / unresolved — sentinels then never match (fail closed
 *  per-rule; display resolvers keep their own fail-open wrappers). */
export function audienceIdMatches(
  gids: string[],
  uid: string,
  byId: Map<string, UserGroup>,
  liveSet: Set<string> | null,
): boolean {
  return gids.some((gid) =>
    (byId.get(gid)?.memberIds.includes(uid) ?? false) ||
    (liveSet?.has(gid.trim().toLowerCase()) ?? false));
}

// ── Per-user audience sentinel ids ───────────────────────────────────────────
// "Only specific people" audiences store user sentinels ("user:<lowercased
// rmone_users id>") in the SAME lists that hold group ids and org sentinels.
// Resolution stays one code path: every membership set built for a viewer
// simply gains their own sentinel, so group / org-unit / person audiences all
// match through the identical set-membership check.
export const USER_AUDIENCE_PREFIX = "user:";
export function isUserAudienceId(id: unknown): boolean {
  return String(id ?? "").trim().toLowerCase().startsWith(USER_AUDIENCE_PREFIX);
}
/** The sentinel id for a user — ALWAYS lowercased so it matches stored lists
 *  (the rule sanitizers lowercase every audience id on save). */
export function userAudienceId(userId: string): string {
  return USER_AUDIENCE_PREFIX + String(userId ?? "").trim().toLowerCase();
}
/** Resolver returns null when org membership could NOT be resolved (DB
 *  outage) — distinct from "member of no org units" (empty set). */
type OrgAudienceResolver = (tenantLabel: string, uid: string) => Promise<Set<string> | null>;
let _orgAudienceResolver: OrgAudienceResolver | null = null;
export function registerOrgAudienceResolver(fn: OrgAudienceResolver): void {
  _orgAudienceResolver = fn;
}
/** The user's org sentinel ids (lowercase), or an EMPTY set on any failure —
 *  grants stay fail-closed (no membership → no grant) and exempt lists stay
 *  fail-closed (no membership → not exempt). Sites that evaluate "except"
 *  audiences must use orgAudienceIdsForChecked instead: there, an unknown
 *  membership must NOT look like "in no org units" (that would wrongly apply
 *  except-scoped rules to people who should have been excluded). */
export async function orgAudienceIdsFor(tenantLabel: string, userId: string | null | undefined): Promise<Set<string>> {
  return (await orgAudienceIdsForChecked(tenantLabel, userId)) ?? new Set();
}
/** Tri-state variant: Set = resolved (possibly empty), null = resolution
 *  FAILED (unknown membership). "except"-mode evaluators treat null as
 *  "cannot prove not-excluded" and skip org-dependent rules entirely. */
export async function orgAudienceIdsForChecked(tenantLabel: string, userId: string | null | undefined): Promise<Set<string> | null> {
  const uid = String(userId ?? "").trim().toLowerCase();
  if (!uid) return new Set();
  if (!_orgAudienceResolver) return null;
  try { return await _orgAudienceResolver(tenantLabel, uid); } catch { return null; }
}

export async function evaluateStagePermission(
  tenantLabel: string,
  module: StageRuleModule,
  stage: string,
  userId: string | null | undefined,
): Promise<StagePermVerdict> {
  const perms = await getStagePermsForTenant(tenantLabel);
  if (perms.rules.length === 0) return OPEN_STAGE_VERDICT;
  const stageKey = String(stage ?? "").trim().toLowerCase();
  const rule = perms.rules.find((r) => r.module === module && r.stage.trim().toLowerCase() === stageKey);
  if (!rule) return OPEN_STAGE_VERDICT;

  const uid = String(userId ?? "").trim().toLowerCase();
  let inAction = !!uid && rule.actionUserIds.includes(uid);
  let inEditor = !!uid && rule.editorUserIds.includes(uid);
  if (uid && !inAction && (rule.actionGroupIds.length > 0 || rule.editorGroupIds.length > 0)) {
    const groups = await getUserGroupsForTenant(tenantLabel);
    const byId = new Map(groups.groups.map((g) => [g.id, g]));
    // Live audience sentinels — org units ("org:bu:<id>" …) resolve from the
    // org chart, roles ("role:<guid>") from the staff-role name bridge. Both
    // arrive in ONE resolver set.
    const needLive = needsLiveAudienceSet([...rule.actionGroupIds, ...rule.editorGroupIds]);
    const liveSet = needLive ? await orgAudienceIdsFor(tenantLabel, uid) : null;
    const memberOf = (gids: string[]): boolean => audienceIdMatches(gids, uid, byId, liveSet);
    if (!inAction && rule.actionGroupIds.length > 0) inAction = memberOf(rule.actionGroupIds);
    if (!inEditor && rule.editorGroupIds.length > 0) inEditor = memberOf(rule.editorGroupIds);
  }

  // "Everyone else keeps their normal access": the rule only GRANTS the
  // listed people their tier — an unlisted user is simply not covered by it,
  // so they fall through to their regular capability checks. Legacy rules
  // (othersMode absent → sanitized to "viewOnly") keep the original stance.
  if (!inAction && !inEditor && rule.othersMode === "normal") return OPEN_STAGE_VERDICT;

  return {
    restricted: true,
    canAdvance: inAction,
    canEdit: inAction || inEditor,
    ruleStage: rule.stage,
  };
}

// ── Navigation visibility (#88) ──────────────────────────────────────────────
// Admin-configured show/hide rules for the web sidebar, per tenant. Each menu
// item id maps to a rule: "hidden" (nobody sees it) or "groups" (visible only
// to members of the listed user groups). No entry = visible to everyone —
// a tenant that never touches the section gets today's navigation unchanged.
//
// This is DISPLAY configuration, not a security boundary: every page's data
// stays behind the #87 capability/stage gates regardless of what the menu
// shows, so resolution fails OPEN (on a policy-read error users keep their
// full menu rather than losing pages they legitimately use).

export interface NavItemRule {
  mode: "everyone" | "hidden" | "groups" | "roles";
  groupIds: string[];
  roleIds: string[];
}
export interface NavVisibilityDoc {
  items: Record<string, NavItemRule>;
  /** Ordered list of nav item ids — absent means use the catalog default order. */
  order?: string[];
  /** Custom display labels keyed by nav item id — absent means use the catalog default. */
  labels?: Record<string, string>;
  /** Placement keyed by nav item id; absent means use the catalog default surface. */
  surfaces?: Record<string, "vertical" | "horizontal">;
}
export const EMPTY_NAV_VISIBILITY: NavVisibilityDoc = { items: {} };

export const NAV_VISIBILITY_SCOPE_PREFIX = "navvis:";

/** Home is the redirect target for hidden pages — hiding it would loop. */
export const NEVER_HIDEABLE_NAV_IDS = new Set(["home"]);
/** Admin screens can never be hidden FROM ADMINS (they're already invisible
 *  to everyone else via the role filter in the web shell). */
export const ADMIN_PROTECTED_NAV_IDS = new Set(["settings", "import", "system"]);
/** These pages historically had hard-coded audiences. An absent rule must keep
 * those audiences; an explicit "everyone" rule is therefore persisted. */
/** Pure visibility verdict used by the request resolver and regression checks.
 * null means the rule needs group membership resolution instead. Legacy
 * access-level rules are treated as Everyone now that navigation uses groups. */
export function navRoleRuleHides(
  _id: string,
  rule: NavItemRule | undefined,
  _acl: string,
  _canEditData: boolean,
): boolean | null {
  if (!rule) return false;
  if (rule.mode === "everyone") return false;
  if (rule.mode === "hidden") return true;
  if (rule.mode === "roles") return false;
  return null;
}

const NAV_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_NAV_ITEMS = 64;

export function sanitizeNavVisibility(raw: unknown): NavVisibilityDoc {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  // items — show/hide rules (existing)
  const src = (o.items && typeof o.items === "object" ? o.items : {}) as Record<string, unknown>;
  const items: Record<string, NavItemRule> = {};
  let n = 0;
  for (const [k, v] of Object.entries(src)) {
    const id = cleanStr(k, 32).toLowerCase();
    if (!NAV_ID_RE.test(id) || !v || typeof v !== "object") continue;
    const vv = v as Record<string, unknown>;
    const mode =
      vv.mode === "hidden" ? "hidden" as const
      : vv.mode === "groups" ? "groups" as const
      : null;
    if (!mode) continue;
    items[id] = {
      mode,
      groupIds: mode === "groups" ? cleanIdList(vv.groupIds, 100) : [],
      roleIds: [],
    };
    if (++n >= MAX_NAV_ITEMS) break;
  }

  // order — custom sort order (new)
  const order: string[] = [];
  if (Array.isArray(o.order)) {
    const seen = new Set<string>();
    for (const id of o.order) {
      const s = cleanStr(id as unknown, 32).toLowerCase();
      if (!s || !NAV_ID_RE.test(s) || seen.has(s)) continue;
      seen.add(s);
      order.push(s);
      if (order.length >= MAX_NAV_ITEMS) break;
    }
  }

  // labels — custom display names (new), max 60 chars each
  const labels: Record<string, string> = {};
  if (o.labels && typeof o.labels === "object") {
    const lsrc = o.labels as Record<string, unknown>;
    let ln = 0;
    for (const [k, v] of Object.entries(lsrc)) {
      const id = cleanStr(k, 32).toLowerCase();
      const label = cleanStr(v as unknown, 60);
      if (!id || !NAV_ID_RE.test(id) || !label) continue;
      labels[id] = label;
      if (++ln >= MAX_NAV_ITEMS) break;
    }
  }

  // surfaces — whether an item belongs in the vertical sidebar or horizontal
  // top tab bar. Unknown values are ignored so older clients remain safe.
  const surfaces: Record<string, "vertical" | "horizontal"> = {};
  if (o.surfaces && typeof o.surfaces === "object") {
    const ssrc = o.surfaces as Record<string, unknown>;
    let sn = 0;
    for (const [k, v] of Object.entries(ssrc)) {
      const id = cleanStr(k, 32).toLowerCase();
      if (!id || !NAV_ID_RE.test(id)) continue;
      if (v !== "vertical" && v !== "horizontal") continue;
      surfaces[id] = v;
      if (++sn >= MAX_NAV_ITEMS) break;
    }
  }

  return {
    items,
    ...(order.length > 0 ? { order } : {}),
    ...(Object.keys(labels).length > 0 ? { labels } : {}),
    ...(Object.keys(surfaces).length > 0 ? { surfaces } : {}),
  };
}

const navLoader = makeLoader(NAV_VISIBILITY_SCOPE_PREFIX, sanitizeNavVisibility, EMPTY_NAV_VISIBILITY);
export const getNavVisibilityForTenant = navLoader.get;

/**
 * The menu item ids HIDDEN for one user, resolved server-side (the web never
 * re-derives group membership). `isAdminUser` = built-in admin/administrator
 * or grandfathered-unset — those keep the admin-protected screens no matter
 * what the config says. Group matching uses the same lowercase rmone_users id
 * (= JWT sub) convention as stage permissions. Fails OPEN to [] — see above.
 */
export async function resolveHiddenNavIdsChecked(
  tenantLabel: string,
  userId: string | null | undefined,
  isAdminUser: boolean,
  accessLevel: string | null | undefined,
): Promise<string[]> {
  const doc = await getNavVisibilityForTenant(tenantLabel);
    const entries = new Map(Object.entries(doc.items));
    const uid = String(userId ?? "").trim().toLowerCase();
    const rawAcl = String(accessLevel ?? "").trim().toLowerCase();
    const acl = rawAcl === "administrator" || rawAcl === "unset" || !rawAcl ? "admin" : rawAcl;
    let byId: Map<string, UserGroup> | null = null;
    let orgSet: Set<string> | null = null;
    const hidden: string[] = [];
    for (const [id, rule] of entries) {
      if (NEVER_HIDEABLE_NAV_IDS.has(id)) continue;
      if (isAdminUser && ADMIN_PROTECTED_NAV_IDS.has(id)) continue;
      const roleVerdict = navRoleRuleHides(id, rule, acl, false);
      if (roleVerdict !== null) { if (roleVerdict) hidden.push(id); continue; }
      // groups mode: visible only to members of the listed groups (real
      // groups, live org-audience sentinels, or live role:<guid> sentinels).
      if (!uid || rule.groupIds.length === 0) { hidden.push(id); continue; }
      if (!byId) {
        const groups = await getUserGroupsForTenant(tenantLabel);
        byId = new Map(groups.groups.map((g) => [g.id, g]));
      }
      if (!orgSet && needsLiveAudienceSet(rule.groupIds)) {
        orgSet = await orgAudienceIdsFor(tenantLabel, uid);
      }
      const member = audienceIdMatches(rule.groupIds, uid, byId, orgSet);
      if (!member) hidden.push(id);
    }
  return hidden;
}

/** Display resolver fails open; authorization callers use the checked variant. */
export async function resolveHiddenNavIds(
  tenantLabel: string,
  userId: string | null | undefined,
  isAdminUser: boolean,
  accessLevel: string | null | undefined,
): Promise<string[]> {
  try {
    return await resolveHiddenNavIdsChecked(tenantLabel, userId, isAdminUser, accessLevel);
  } catch {
    return [];
  }
}
