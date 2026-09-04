/**
 * Live-audience sentinels — org units AND job roles as live audiences.
 *
 * Anywhere a rule or picker stores user-group ids, it may also store a live
 * sentinel id:
 *   - org units: "org:bu:<id>", "org:div:<id>", "org:dept:<id>"
 *   - job roles: "role:<roleGuid>"
 * (all lowercase). The SERVER resolves membership live — org units from the
 * tenant's org chart, roles from each user's displayed role name (the server
 * name bridge matches EVERY Roles row sharing the same normalized name, so
 * duplicate same-named catalog rows all count). People who join or leave a
 * unit or change role are covered automatically — unlike real groups, there
 * is no member list to maintain. /my-capabilities returns the viewer's own
 * sentinels inside groupIds, so every client-side membership check works
 * unchanged.
 *
 * This module fetches the tenant's org units + roles and shapes them as
 * pseudo UserGroups for the existing pickers. Pseudo-groups are DISPLAY-only:
 * never save them into the user-groups doc.
 */
import { getBusinessUnits, getDivisions, getDepartments, getRolesByBU } from "@/lib/api";
import type { UserGroup } from "@/lib/permissions";

export const ORG_AUDIENCE_RE = /^org:(bu|div|dept):/i;
export function isOrgAudienceId(id: unknown): boolean {
  return ORG_AUDIENCE_RE.test(String(id ?? "").trim());
}

/** Role sentinels — lockstep with the server's role-audience.ts. */
export const ROLE_AUDIENCE_RE = /^role:/i;
export function isRoleAudienceId(id: unknown): boolean {
  return ROLE_AUDIENCE_RE.test(String(id ?? "").trim());
}

// Fixed neutral colors per kind — deliberately outside GROUP_COLOR_PALETTE so
// live-audience chips read as "org unit"/"role", not as one of the tenant's
// colored groups. Roles get a warm taupe, distinct from the slate org tones.
const ORG_COLORS = { bu: "#475569", div: "#64748b", dept: "#94a3b8" } as const;
const ROLE_COLOR = "#a1887f";

/** The tenant's org units + job roles shaped as pseudo user-groups for
 *  audience pickers. Returns [] on any failure — pickers then simply offer
 *  real groups only. */
export async function fetchOrgAudienceGroups(tenantId?: string): Promise<UserGroup[]> {
  try {
    const [bus, divs, deps, roles] = await Promise.all([
      getBusinessUnits(tenantId).catch(() => [] as unknown[]),
      getDivisions(tenantId).catch(() => []),
      getDepartments(tenantId).catch(() => [] as unknown[]),
      // Roles are a flat tenant catalog — the BU argument is required by the
      // endpoint but ignored, so a fixed placeholder doubles as cache key.
      getRolesByBU("all", tenantId).catch(() => []),
    ]);
    const out: UserGroup[] = [];
    const seen = new Set<string>();
    const push = (kind: "bu" | "div" | "dept", id: unknown, label: string) => {
      const key = String(id ?? "").trim().toLowerCase();
      if (!key || !label.trim()) return;
      const sid = `org:${kind}:${key}`;
      if (seen.has(sid)) return;
      seen.add(sid);
      out.push({ id: sid, name: label.trim(), memberIds: [], color: ORG_COLORS[kind] });
    };
    for (const b of bus as { ID?: unknown; Title?: unknown }[]) {
      push("bu", b?.ID, `BU: ${String(b?.Title ?? "").trim()}`);
    }
    // Division display name follows the app convention: ShortName preferred.
    const divNameById = new Map<string, string>();
    for (const d of divs) {
      const nm = String(d?.ShortName ?? "").trim() || String(d?.Title ?? "").trim();
      divNameById.set(String(d?.ID ?? "").trim(), nm);
      push("div", d?.ID, `Division: ${nm}`);
    }
    // Same dept name can legitimately exist under different divisions — the
    // "(division)" suffix disambiguates them in the picker.
    for (const d of deps as { ID?: unknown; Title?: unknown; DivisionIdLookup?: unknown }[]) {
      const divNm = divNameById.get(String(d?.DivisionIdLookup ?? "").trim()) ?? "";
      push("dept", d?.ID, `Dept: ${String(d?.Title ?? "").trim()}${divNm ? ` (${divNm})` : ""}`);
    }
    // Roles: ONE picker entry per distinct role NAME. Tenants legitimately
    // carry duplicate same-named Roles rows; the server's name bridge makes
    // ANY twin GUID match everyone displaying that role name, so the picker
    // stores the sorted-first GUID (deterministic across loads).
    const roleIdsByName = new Map<string, { label: string; ids: string[] }>();
    for (const r of roles as { id?: unknown; name?: unknown }[]) {
      const label = String(r?.name ?? "").trim();
      const key = label.replace(/\s+/g, " ").toLowerCase();
      const id = String(r?.id ?? "").trim().toLowerCase();
      if (!key || !id) continue;
      const cur = roleIdsByName.get(key);
      if (cur) cur.ids.push(id);
      else roleIdsByName.set(key, { label, ids: [id] });
    }
    for (const { label, ids } of [...roleIdsByName.values()].sort((a, b) => a.label.localeCompare(b.label))) {
      const sid = `role:${[...ids].sort()[0]}`;
      if (seen.has(sid)) continue;
      seen.add(sid);
      out.push({ id: sid, name: `Role: ${label}`, memberIds: [], color: ROLE_COLOR });
    }
    return out;
  } catch {
    return [];
  }
}
