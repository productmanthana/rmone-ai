// Mobile mirror of artifacts/rmone-web/src/lib/roleResolver.ts. Both
// apps must use the same priority order and the same translation keys
// so a given account renders the same persona on both surfaces. If you
// change the order or the translation keys here, update the web mirror
// at the same time.

import AsyncStorage from "@react-native-async-storage/async-storage";

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

const PRIORITY: RolePersona[] = [
  "COO",
  "CFO",
  "EXECUTIVE",
  "RESOURCE_MANAGER",
  "PROJECT_MANAGER",
];

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

// Persona overrides used to be keyed by username alone. Since the same admin
// email can be reused across separate companies (tenants), two different
// companies signed in as the same email on one device would read/write each
// other's persona override. Fold the tenant into the key too. AsyncStorage is
// inherently async, so auth.tsx pushes the active tenant into this
// module-level cache (via setActiveTenant) whenever it changes, letting the
// synchronous getRoleOverride() stay synchronous.
let _activeTenant: string | null = null;

export function setActiveTenant(tenant: string | null | undefined) {
  _activeTenant = tenant ? tenant.toLowerCase() : null;
}

function overrideKey(username: string | undefined | null): string {
  return `${OVERRIDE_KEY_PREFIX}${_activeTenant ?? "_anon"}:${username ?? "_anon"}`;
}

// Synchronous in-memory cache so the home and profile screens can render
// the active role without waiting on AsyncStorage. Hydrated by
// loadRoleOverride() at app start (fire-and-forget) and updated whenever
// setRoleOverride() is called.
const _overrideCache: Record<string, RolePersona | null> = {};
type Listener = () => void;
const _listeners = new Set<Listener>();

export function getRoleOverride(username: string | undefined | null): RolePersona | null {
  return _overrideCache[overrideKey(username)] ?? null;
}

export async function loadRoleOverride(username: string | undefined | null): Promise<RolePersona | null> {
  try {
    const v = await AsyncStorage.getItem(overrideKey(username));
    if (v && (ROLE_PERSONAS as string[]).includes(v)) {
      _overrideCache[overrideKey(username)] = v as RolePersona;
      _listeners.forEach((fn) => fn());
      return v as RolePersona;
    }
    _overrideCache[overrideKey(username)] = null;
    _listeners.forEach((fn) => fn());
    return null;
  } catch {
    return null;
  }
}

export async function setRoleOverride(
  username: string | undefined | null,
  role: RolePersona | null,
) {
  const key = overrideKey(username);
  try {
    if (role === null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, role);
  } catch {
    // ignore write failures — keep in-memory cache in sync regardless.
  }
  _overrideCache[key] = role;
  _listeners.forEach((fn) => fn());
}

export function subscribeRoleOverride(fn: Listener): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

export function resolveActiveRole(
  userRoles: string | undefined | null,
  username: string | undefined | null,
): RolePersona {
  return getRoleOverride(username) ?? resolveRoleFromString(userRoles);
}

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
