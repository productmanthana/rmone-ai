/** Custom (user-defined) lead roles.
 *
 * Predefined lead roles live in real *User columns on PMM/Opportunity/Lead
 * (KP_FIELD_ROLES ↔ KEY_PERSONNEL_USER_COLS on the api-server). A role the
 * user types themselves can't mint a new column on the shared multi-tenant
 * tables, so ALL custom roles live in ONE JSON column instead:
 *
 *   CustomLeadsJson = { "<Role Label>": ["Display Name", …], … }
 *
 * Names are stored exactly as typed (display names, never GUIDs). The
 * api-server lazily ALTERs the column in ensureKeyPersonnelColumns, so the
 * first save on an old tenant self-heals the schema.
 */
export const CUSTOM_LEADS_FIELD = "CustomLeadsJson";

/** KeyPersonnel entries for custom roles carry field = `custom:<Role Label>`
 *  so add/remove flows can tell them apart from real *User columns. */
export const CUSTOM_ROLE_PREFIX = "custom:";

export type CustomLeadMap = Record<string, string[]>;

export function parseCustomLeads(raw: unknown): CustomLeadMap {
  if (raw == null || raw === "") return {};
  try {
    const o = JSON.parse(String(raw)) as unknown;
    if (o && typeof o === "object" && !Array.isArray(o)) {
      const out: CustomLeadMap = {};
      for (const [role, v] of Object.entries(o as Record<string, unknown>)) {
        const label = String(role).trim();
        if (!label) continue;
        const names = Array.isArray(v) ? v.map((n) => String(n).trim()).filter(Boolean) : [];
        if (names.length) out[label] = names;
      }
      return out;
    }
  } catch { /* corrupted JSON — treat as empty; the next write rebuilds it */ }
  return {};
}

/** Flat list of { role, name } entries, stable order (role insertion order). */
export function listCustomLeads(raw: unknown): { role: string; name: string }[] {
  const out: { role: string; name: string }[] = [];
  const map = parseCustomLeads(raw);
  for (const [role, names] of Object.entries(map)) {
    for (const name of names) out.push({ role, name });
  }
  return out;
}

/** Names already listed under `role` (case-insensitive label match). */
export function customLeadNamesForRole(raw: unknown, role: string): string[] {
  const map = parseCustomLeads(raw);
  const key = Object.keys(map).find((k) => k.toLowerCase() === role.trim().toLowerCase());
  return key ? map[key] : [];
}

/** Append `name` under `role`. Returns the new JSON string, or null when that
 *  person is already on the role (case-insensitive). Role labels also match
 *  case-insensitively so "design lead" and "Design Lead" never fork. */
export function addCustomLead(raw: unknown, role: string, name: string): string | null {
  const map = parseCustomLeads(raw);
  const label = role.trim();
  const nm = name.trim();
  const key = Object.keys(map).find((k) => k.toLowerCase() === label.toLowerCase()) ?? label;
  const names = map[key] ?? [];
  if (names.some((n) => n.toLowerCase() === nm.toLowerCase())) return null;
  map[key] = [...names, nm];
  return JSON.stringify(map);
}

/** Remove ONE name from `role` (case-insensitive); drops the role when its
 *  last person is removed. Returns the new JSON string. */
export function removeCustomLead(raw: unknown, role: string, name: string): string {
  const map = parseCustomLeads(raw);
  const key = Object.keys(map).find((k) => k.toLowerCase() === role.trim().toLowerCase());
  if (key) {
    const rest = (map[key] ?? []).filter((n) => n.toLowerCase() !== name.trim().toLowerCase());
    if (rest.length) map[key] = rest; else delete map[key];
  }
  return JSON.stringify(map);
}
