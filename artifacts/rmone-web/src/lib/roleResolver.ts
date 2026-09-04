// Maps the upstream `userRoles` string to one of five home personas and
// applies the role-switcher override the user has stored in localStorage.
//
// Both the web and mobile apps must use the same priority order and the
// same translation keys so the home variant is identical for the same
// account on both surfaces. If you change the order or the keys here,
// update artifacts/rmone-mobile/lib/roleResolver.ts at the same time.

export type RolePersona =
  | "COO"
  | "CFO"
  | "RESOURCE_MANAGER"
  | "PROJECT_MANAGER"
  | "EXECUTIVE";

export const ROLE_PERSONAS: RolePersona[] = [
  "COO",
  "CFO",
  "EXECUTIVE",
  "RESOURCE_MANAGER",
  "PROJECT_MANAGER",
];

// Multi-role priority order (highest first). A user whose roles match
// several entries gets the highest-priority match.
const PRIORITY: RolePersona[] = [
  "COO",
  "CFO",
  "EXECUTIVE",
  "RESOURCE_MANAGER",
  "PROJECT_MANAGER",
];

// Substring → persona translation. Lowercase, partial matches.
const TRANSLATIONS: Array<{ match: string; persona: RolePersona }> = [
  { match: "coo", persona: "COO" },
  { match: "chief operating", persona: "COO" },
  { match: "operations officer", persona: "COO" },
  { match: "operations manager", persona: "COO" },

  { match: "cfo", persona: "CFO" },
  { match: "chief financial", persona: "CFO" },
  { match: "finance officer", persona: "CFO" },
  { match: "finance manager", persona: "CFO" },
  { match: "controller", persona: "CFO" },

  { match: "ceo", persona: "EXECUTIVE" },
  { match: "executive", persona: "EXECUTIVE" },
  { match: "president", persona: "EXECUTIVE" },
  { match: "principal", persona: "EXECUTIVE" },
  { match: "managing director", persona: "EXECUTIVE" },
  { match: "partner", persona: "EXECUTIVE" },
  { match: "owner", persona: "EXECUTIVE" },

  { match: "resource manager", persona: "RESOURCE_MANAGER" },
  { match: "resource mgr", persona: "RESOURCE_MANAGER" },
  { match: "staffing", persona: "RESOURCE_MANAGER" },
  { match: "people manager", persona: "RESOURCE_MANAGER" },
  { match: "talent", persona: "RESOURCE_MANAGER" },
  { match: "hr", persona: "RESOURCE_MANAGER" },

  { match: "project manager", persona: "PROJECT_MANAGER" },
  { match: "project mgr", persona: "PROJECT_MANAGER" },
  { match: "pm", persona: "PROJECT_MANAGER" },
  { match: "program manager", persona: "PROJECT_MANAGER" },
  { match: "delivery", persona: "PROJECT_MANAGER" },
  { match: "estimator", persona: "PROJECT_MANAGER" },
  { match: "designer", persona: "PROJECT_MANAGER" },
];

// Selectable job titles for the in-app "Job title" switcher. Each title maps
// to one of the five home personas that actually drive the Daily Briefing and
// Home page content. The label is what the user sees and what we display; the
// persona is the engine that reorders/curates what those pages show.
export interface JobTitleOption {
  label: string;
  persona: RolePersona;
}

export const JOB_TITLES: JobTitleOption[] = [
  { label: "Chief Executive Officer (CEO)", persona: "EXECUTIVE" },
  { label: "Chief Operating Officer (COO)", persona: "COO" },
  { label: "Chief Financial Officer (CFO)", persona: "CFO" },
  { label: "Executive", persona: "EXECUTIVE" },
  { label: "Project Manager (PM)", persona: "PROJECT_MANAGER" },
  { label: "Resource Manager", persona: "RESOURCE_MANAGER" },
];

// Resolve a chosen/free-form job-title label to a persona. Prefers an exact
// match in JOB_TITLES, then falls back to the substring translator so custom
// titles still land on a sensible persona.
export function personaForJobTitle(label: string | undefined | null): RolePersona | null {
  if (!label || !String(label).trim()) return null;
  const lower = String(label).trim().toLowerCase();
  const exact = JOB_TITLES.find((t) => t.label.toLowerCase() === lower);
  if (exact) return exact.persona;
  return resolveRoleFromString(label);
}

export function resolveRoleFromString(userRoles: string | undefined | null): RolePersona {
  if (!userRoles) return "PROJECT_MANAGER";
  const lower = String(userRoles).toLowerCase();
  const matched = new Set<RolePersona>();
  for (const t of TRANSLATIONS) {
    if (lower.includes(t.match)) matched.add(t.persona);
  }
  if (matched.size === 0) return "PROJECT_MANAGER";
  for (const p of PRIORITY) if (matched.has(p)) return p;
  return "PROJECT_MANAGER";
}

const OVERRIDE_KEY_PREFIX = "rmone:roleOverride:";

// Persona/job-title overrides used to be keyed by username alone. Since the
// same admin email can be reused across separate companies (tenants), two
// different companies signed in as the same email on one browser would read
// and write each other's persona override. Fold the tenant into the key too,
// with a best-effort fallback when no tenant is known yet (pre-login).
function currentTenantTag(): string {
  try {
    if (typeof window === "undefined") return "_anon";
    const tenant = window.localStorage.getItem("rmone_tenant");
    if (tenant) return tenant.toLowerCase();
  } catch {
    // ignore
  }
  return "_anon";
}

function overrideKey(username: string | undefined | null): string {
  return `${OVERRIDE_KEY_PREFIX}${currentTenantTag()}:${username ?? "_anon"}`;
}

export function getRoleOverride(username: string | undefined | null): RolePersona | null {
  try {
    if (typeof window === "undefined") return null;
    const v = window.localStorage.getItem(overrideKey(username));
    if (v && (ROLE_PERSONAS as string[]).includes(v)) return v as RolePersona;
  } catch {
    // ignore
  }
  return null;
}

export function setRoleOverride(username: string | undefined | null, role: RolePersona | null) {
  try {
    if (typeof window === "undefined") return;
    const key = overrideKey(username);
    if (role === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, role);
    // Notify any subscribers (avatar menu / home / alerts) that the override changed.
    window.dispatchEvent(new CustomEvent("rmone:roleOverrideChanged"));
  } catch {
    // ignore
  }
}

const JOBTITLE_KEY_PREFIX = "rmone:jobTitleOverride:";

function jobTitleKey(username: string | undefined | null): string {
  return `${JOBTITLE_KEY_PREFIX}${currentTenantTag()}:${username ?? "_anon"}`;
}

export function getJobTitleOverride(username: string | undefined | null): string | null {
  try {
    if (typeof window === "undefined") return null;
    const v = window.localStorage.getItem(jobTitleKey(username));
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

export function setJobTitleOverride(
  username: string | undefined | null,
  label: string | null,
) {
  try {
    if (typeof window === "undefined") return;
    const key = jobTitleKey(username);
    if (label === null || !label.trim()) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, label);
    // Reuse the existing event so Home / Daily Briefing / avatar menu refresh.
    window.dispatchEvent(new CustomEvent("rmone:roleOverrideChanged"));
  } catch {
    // ignore
  }
}

export function resolveActiveRole(
  userRoles: string | undefined | null,
  username: string | undefined | null,
): RolePersona {
  const jobTitle = getJobTitleOverride(username);
  if (jobTitle) {
    const persona = personaForJobTitle(jobTitle);
    if (persona) return persona;
  }
  return getRoleOverride(username) ?? resolveRoleFromString(userRoles);
}

// Root superadmin accounts — always granted portal access even if the DB is
// unreachable. Additional accounts are stored in the superadmin_accounts table
// and detected via the /api/superadmin/check endpoint below.
const ROOT_SUPERADMIN_ACCOUNTS = [
  "drsampathkumarpatil@gmail.com",
  "sanjk0604@gmail.com",
  "sanjeev@rmone.com",
];

// In-memory cache so we only call /check once per session per user.
let _superadminCheckCache: { username: string; ok: boolean; expiresAt: number } | null = null;

const RMONE_TENANT = "rmone";

// True when the username is on the hardcoded ROOT superadmin allowlist —
// regardless of which tenant they're logged into. Used for tenant-scoped
// power actions (e.g. record deletion) that root operators may perform inside
// a client company. The server re-checks the same allowlist on every call, so
// this gate is display-only.
export function isRootAccount(username: string | undefined | null): boolean {
  if (!username) return false;
  return ROOT_SUPERADMIN_ACCOUNTS.includes(String(username).trim().toLowerCase());
}

export function isSuperAdmin(username: string | undefined | null, tenant: string | undefined | null): boolean {
  if (!username) return false;
  // Superadmin portal is ONLY accessible when logged in as the internal rmone tenant.
  // `tenant` is REQUIRED (not defaulted) so callers can never accidentally skip this
  // check by omitting the argument — a root-list email logged into a client tenant
  // must NOT get cross-tenant superadmin powers.
  if (String(tenant ?? "").trim().toLowerCase() !== RMONE_TENANT) return false;
  const u = String(username).trim().toLowerCase();
  if (ROOT_SUPERADMIN_ACCOUNTS.includes(u)) return true;
  // For DB-added accounts: trust the cached API result if available.
  if (_superadminCheckCache && _superadminCheckCache.username === u && _superadminCheckCache.expiresAt > Date.now()) {
    return _superadminCheckCache.ok;
  }
  return false;
}

// Call once after login to warm the cache for DB-added superadmins.
// The result is cached for 5 minutes.
export async function checkSuperAdminApi(username: string, token: string): Promise<boolean> {
  const u = String(username).trim().toLowerCase();
  if (ROOT_SUPERADMIN_ACCOUNTS.includes(u)) return true;
  try {
    const res = await fetch("/api/superadmin/check", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const ok = res.ok;
    _superadminCheckCache = { username: u, ok, expiresAt: Date.now() + 5 * 60_000 };
    return ok;
  } catch {
    return false;
  }
}

export function clearSuperAdminCache() { _superadminCheckCache = null; }

export function rolePersonaShort(role: RolePersona): string {
  switch (role) {
    case "COO": return "COO";
    case "CFO": return "CFO";
    case "RESOURCE_MANAGER": return "Resource Mgr";
    case "PROJECT_MANAGER": return "Project Mgr";
    case "EXECUTIVE": return "Executive";
  }
}

export function rolePersonaBadge(role: RolePersona): string {
  switch (role) {
    case "COO": return "COO";
    case "CFO": return "CFO";
    case "RESOURCE_MANAGER": return "RESOURCE MGR";
    case "PROJECT_MANAGER": return "PROJECT MGR";
    case "EXECUTIVE": return "EXECUTIVE";
  }
}

export function rolePersonaFullName(role: RolePersona): string {
  switch (role) {
    case "COO": return "Chief Operating Officer";
    case "CFO": return "Chief Financial Officer";
    case "RESOURCE_MANAGER": return "Resource Manager";
    case "PROJECT_MANAGER": return "Project Manager";
    case "EXECUTIVE": return "Executive";
  }
}
