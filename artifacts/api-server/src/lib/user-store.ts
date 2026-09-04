// ─────────────────────────────────────────────────────────────────────────────
// Single write path for app identity.
//
// Canonical identity lives in SQL Server dbo.rmone_users (via @workspace/db).
// Legacy tenants ALSO have a core2.dbo.AspNetUsers row that old fallback reads
// still consult, so lifecycle/flag changes (access level, enabled, deleted)
// are best-effort MIRRORED there. Before this module every route carried its
// own copy of that mirror SQL — one missed copy and the two stores drift.
//
// Rules:
//   • Every route that CREATES or UPDATES a single app user goes through
//     createAppUser / updateAppUser — never @workspace/db insertUser /
//     updateUser directly.
//   • Creates are NOT mirrored: new accounts exist only in rmone_users
//     (legacy reads treat "absent from AspNetUsers" as "app-managed").
//   • The mirror payload is EXPLICIT. The helper never derives legacy values
//     from the canonical patch, because the semantics differ — e.g. custom
//     access-level markers ("custom:<id>") have no legacy representation and
//     must leave the legacy columns untouched.
//   • Bulk org-field patches (updateUsersByIds / the import pipeline's bulk
//     writers) stay canonical-only by design and keep using @workspace/db.
// ─────────────────────────────────────────────────────────────────────────────
import { insertUser, updateUser, type InsertUser, type UserRow } from "@workspace/db";
import { getPool, sql } from "./db.js";

/** Create the canonical rmone_users row (no legacy mirror — see header). */
export async function createAppUser(data: InsertUser): Promise<void> {
  await insertUser(data);
}

/** What the legacy core2.dbo.AspNetUsers row should say after this update. */
export interface LegacyMirror {
  /** → UserRoleIdLookup: canonical "Admin" | "Manager" | "User", or null to clear. */
  accessLevel?: string | null;
  /** → IsSiteAdmin */
  isSiteAdmin?: boolean;
  /** → Enabled */
  enabled?: boolean;
  /** → Deleted */
  deleted?: boolean;
  /** Restrict the mirror UPDATE to non-deleted legacy rows (role changes use this). */
  onlyIfNotDeleted?: boolean;
}

export interface UpdateAppUserResult {
  /** Canonical rows touched. A zero means the requested user was not found. */
  canonicalRows: number;
  /** Rows the legacy mirror touched — null when no mirror ran or it failed.
   *  Advisory only: the canonical write is the source of truth and THROWS on
   *  real failures; mirror misses (legacy row absent) are normal for tenants
   *  created after the migration. */
  legacyRows: number | null;
}

export interface UpdateAppUserOptions {
  /** Return after the canonical write and finish the optional legacy mirror in
   * the background. Safe for status changes because rmone_users is authoritative. */
  mirrorAsync?: boolean;
}

async function mirrorAppUser(
  tid: string,
  userGuid: string,
  mirror: LegacyMirror,
): Promise<number | null> {
  try {
    const sets: string[] = [];
    const pool = await getPool();
    const r = pool.request()
      .input("tid", sql.NVarChar, tid)
      .input("id",  sql.NVarChar, userGuid);
    if ("accessLevel" in mirror) { r.input("acl", sql.NVarChar, mirror.accessLevel ?? null); sets.push("UserRoleIdLookup=@acl"); }
    if ("isSiteAdmin" in mirror) { r.input("siteAdmin", sql.Bit, mirror.isSiteAdmin ? 1 : 0); sets.push("IsSiteAdmin=@siteAdmin"); }
    if ("enabled"     in mirror) { r.input("en",  sql.Bit, mirror.enabled ? 1 : 0);           sets.push("Enabled=@en"); }
    if ("deleted"     in mirror) { r.input("del", sql.Bit, mirror.deleted ? 1 : 0);           sets.push("Deleted=@del"); }
    if (!sets.length) return null;
    const guard = mirror.onlyIfNotDeleted ? " AND (Deleted=0 OR Deleted IS NULL)" : "";
    const res = await r.query(`UPDATE core2.dbo.AspNetUsers SET ${sets.join(", ")} WHERE Id=@id AND TenantID=@tid${guard}`);
    return res?.rowsAffected?.[0] ?? 0;
  } catch {
    // Legacy mirror is optional — never fail the canonical write over it.
    return null;
  }
}

export async function updateAppUser(
  tid: string,
  userGuid: string,
  patch: Partial<UserRow>,
  mirror?: LegacyMirror,
  options?: UpdateAppUserOptions,
): Promise<UpdateAppUserResult> {
  // Canonical write FIRST — a failure here must fail the caller loudly.
  const canonicalRows = await updateUser(tid, userGuid, patch);
  if (!mirror) return { canonicalRows, legacyRows: null };
  if (options?.mirrorAsync) {
    void mirrorAppUser(tid, userGuid, mirror);
    return { canonicalRows, legacyRows: null };
  }
  return { canonicalRows, legacyRows: await mirrorAppUser(tid, userGuid, mirror) };
}
