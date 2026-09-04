/**
 * Role-audience sentinels ("role:<roleGuid>") — tenant Roles as live audiences.
 *
 * Anywhere a rule stores user-group ids (nav visibility "groups" mode,
 * stage-rule audiences, skip-rule exempts, group bulk-add), it may also store
 * a role sentinel id. Like the org sentinels ("org:bu/div/dept:<id>"), these
 * ride the SAME groupIds lists — there is no separate "roles" rule mode (the
 * legacy mode:"roles" nav rules were access-level based and stay retired).
 *
 * Membership resolves LIVE from the staff-org map: a user belongs to
 * "role:<guid>" when their rmone_users.role NAME (the text shown on staff
 * cards) equals that Roles row's current Name, normalized. Matching is by
 * NAME, not stored role_id, because tenants legitimately carry duplicate
 * same-named Roles rows (imports) while user rows denormalize the name — the
 * bridge emits EVERY same-named GUID, so whichever twin an admin picked in
 * the picker still matches everyone displaying that role name. Strict
 * normalized equality only (no fuzzy/`role-match` search semantics here).
 */

export const ROLE_AUDIENCE_PREFIX = "role:";
export const ROLE_AUDIENCE_RE = /^role:/i;

export function isRoleAudienceId(id: unknown): boolean {
  return ROLE_AUDIENCE_RE.test(String(id ?? "").trim());
}

/** "ABC123…" → "role:abc123…" (sentinel ids are stored lowercase). */
export function roleAudienceId(roleGuid: string): string {
  return ROLE_AUDIENCE_PREFIX + String(roleGuid ?? "").trim().toLowerCase();
}

/** Normalized role-name key: trim, collapse inner whitespace, lowercase. */
export function normRoleName(name: unknown): string {
  return String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Build the name bridge: normalized role name → every "role:<guid>" sentinel
 * sharing that name. Blank names/ids are skipped; output arrays are deduped
 * and sorted so the emitted membership is deterministic regardless of SQL
 * row order.
 */
export function buildRoleAudienceIndex(
  rows: Array<{ id?: unknown; name?: unknown }> | null | undefined,
): Map<string, string[]> {
  const byName = new Map<string, Set<string>>();
  for (const r of rows ?? []) {
    const key = normRoleName(r?.name);
    const id = String(r?.id ?? "").trim().toLowerCase();
    if (!key || !id) continue;
    let set = byName.get(key);
    if (!set) byName.set(key, (set = new Set()));
    set.add(ROLE_AUDIENCE_PREFIX + id);
  }
  const out = new Map<string, string[]>();
  for (const [k, set] of byName) out.set(k, [...set].sort());
  return out;
}
