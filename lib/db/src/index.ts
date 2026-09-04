import { getMssqlPool, mssql } from "./mssql-pool.js";
import { bootstrapDatabase } from "./bootstrap.js";
export { getMssqlPool, resetMssqlPool, closeMssqlPool, mssql } from "./mssql-pool.js";
export {
  masterCredentialsConfigured,
  getMasterCredentials,
  applyMasterCredentials,
  isLoginFailure,
  refreshMasterCredentialsAfterLoginFailure,
} from "./master-credentials.js";
export { bootstrapDatabase, markAppDbBootstrapped } from "./bootstrap.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function b(v: unknown): boolean { return v === true || (v as number) === 1; }
function jParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
function jStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
function inList(ids: string[], prefix = "id"): { clause: string; inputs: Record<string, string> } {
  const clause = ids.map((_, i) => `@${prefix}${i}`).join(", ");
  const inputs: Record<string, string> = {};
  ids.forEach((id, i) => { inputs[`${prefix}${i}`] = id; });
  return { clause, inputs };
}

async function req() {
  await bootstrapDatabase();
  const p = await getMssqlPool();
  return new mssql.Request(p);
}

async function withTransaction<T>(fn: (rq: mssql.Request) => Promise<T>): Promise<T> {
  await bootstrapDatabase();
  const pool = await getMssqlPool();
  const tx = new mssql.Transaction(pool);
  await tx.begin();
  const rq = new mssql.Request(tx);
  try {
    const result = await fn(rq);
    await tx.commit();
    return result;
  } catch (e) {
    try { await tx.rollback(); } catch {}
    throw e;
  }
}
export { withTransaction };

// ── Types ──────────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  tenantId: string;
  username: string;
  name: string;
  email: string | null;
  passwordHash: string | null;
  role: string | null;
  roleId: string | null;
  departmentId: string | null;
  divisionId: string | null;
  jobTitleId: string | null;
  title: string | null;
  businessUnit: string | null;
  managerUserId: string | null;
  isManager: boolean;
  isSiteAdmin: boolean;
  accessLevel: string | null;
  startDate: Date | null;
  endDate: Date | null;
  enabled: boolean;
  deleted: boolean;
  employeeType: string | null;
  phoneNumber: string | null;
  employeeId: string | null;
  office: string | null;
  jobProfile: string | null;
  /** null = legacy/imported account (treated as verified); false = created in-app,
   *  hasn't set their own password via the invite link yet; true = confirmed. */
  emailConfirmed: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}
export type InsertUser = Partial<Omit<UserRow, "createdAt" | "updatedAt" | "emailConfirmed">> &
  Pick<UserRow, "id" | "tenantId" | "username" | "name"> & {
    createdAt?: Date;
    updatedAt?: Date;
    emailConfirmed?: boolean | null;
  };

function mapUser(r: Record<string, unknown>): UserRow {
  return {
    id:            String(r.id ?? ""),
    tenantId:      String(r.tenant_id ?? ""),
    username:      String(r.username ?? ""),
    name:          String(r.name ?? ""),
    email:         (r.email as string | null) ?? null,
    passwordHash:  (r.password_hash as string | null) ?? null,
    role:          (r.role as string | null) ?? null,
    roleId:        (r.role_id as string | null) ?? null,
    departmentId:  (r.department_id as string | null) ?? null,
    divisionId:    (r.division_id as string | null) ?? null,
    jobTitleId:    (r.job_title_id as string | null) ?? null,
    title:         (r.title as string | null) ?? null,
    businessUnit:  (r.business_unit as string | null) ?? null,
    managerUserId: (r.manager_user_id as string | null) ?? null,
    isManager:     b(r.is_manager),
    isSiteAdmin:   b(r.is_site_admin),
    accessLevel:   (r.access_level as string | null) ?? null,
    startDate:     r.start_date instanceof Date ? r.start_date : null,
    endDate:       r.end_date instanceof Date ? r.end_date : null,
    enabled:       b(r.enabled),
    deleted:       b(r.deleted),
    employeeType:  (r.employee_type as string | null) ?? null,
    phoneNumber:   (r.phone_number as string | null) ?? null,
    employeeId:    (r.employee_id as string | null) ?? null,
    office:        (r.office as string | null) ?? null,
    jobProfile:    (r.job_profile as string | null) ?? null,
    emailConfirmed: r.email_confirmed == null ? null : b(r.email_confirmed),
    createdAt:     r.created_at instanceof Date ? r.created_at : new Date(),
    updatedAt:     r.updated_at instanceof Date ? r.updated_at : new Date(),
  };
}

// ── USERS ──────────────────────────────────────────────────────────────────

export async function getUsersByTenant(tid: string): Promise<UserRow[]> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tid);
  const res = await r.query("SELECT * FROM dbo.rmone_users WHERE tenant_id=@tid");
  return res.recordset.map(mapUser);
}

export async function getActiveUsersByTenant(tid: string): Promise<UserRow[]> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tid);
  const res = await r.query("SELECT * FROM dbo.rmone_users WHERE tenant_id=@tid AND deleted=0");
  return res.recordset.map(mapUser);
}

export async function getEnabledUsersByTenant(tid: string): Promise<UserRow[]> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tid);
  const res = await r.query("SELECT * FROM dbo.rmone_users WHERE tenant_id=@tid AND deleted=0 AND enabled=1");
  return res.recordset.map(mapUser);
}

// Replace-mode import cascade: soft-delete import-created users that are no
// longer part of the tenant's current dataset. A user is pruned ONLY when ALL
// of these hold (fail-safe — any live reference keeps the account):
//   1. not a site admin (protects logins incl. the uploading admin),
//   2. NOT named in the current file's roster (keepKeys = every email/username
//      the file carries — the file's own people must NEVER be pruned, even
//      bench staff with zero allocations),
//   3. no live core2 AspNetUsers row with the same email/username,
//   4. no live ResourceWorkItems row on a live PMM/Opportunity/Lead ticket,
//   5. no live ResourceAllocation row whose effective ticket (linked RWI's
//      WorkItem first, else ra.TicketId — same precedence as the read paths)
//      is a live PMM/Opportunity/Lead record.
// Candidates are fetched first and filtered in JS against keepKeys, then
// soft-deleted by id in batches (keeps SQL parameter counts bounded).
// Cross-catalog core2 references work because the app DB and core2 live on the
// same SQL Server instance (APP_DATABASE_URL).
export async function softDeleteStaleImportedUsers(
  tid: string,
  keepKeys: Set<string>,
): Promise<number> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tid);
  const cand = await r.query(`
    SELECT u.id, u.email, u.username
    FROM dbo.rmone_users u
    WHERE u.tenant_id=@tid AND u.deleted=0
      AND (u.is_site_admin=0 OR u.is_site_admin IS NULL)
      AND NOT EXISTS (SELECT 1 FROM core2.dbo.AspNetUsers a
                      WHERE a.TenantID=@tid AND (a.Deleted=0 OR a.Deleted IS NULL)
                        AND (LOWER(a.Email)=LOWER(u.email) OR LOWER(a.UserName)=LOWER(u.username)))
      AND NOT EXISTS (SELECT 1 FROM core2.dbo.ResourceWorkItems w
                      WHERE w.TenantID=@tid AND (w.Deleted=0 OR w.Deleted IS NULL)
                        AND LOWER(w.ResourceUser)=LOWER(u.id)
                        AND (EXISTS (SELECT 1 FROM core2.dbo.PMM p WHERE p.TenantID=@tid AND p.TicketId=w.WorkItem AND (p.Deleted=0 OR p.Deleted IS NULL))
                          OR EXISTS (SELECT 1 FROM core2.dbo.Opportunity o WHERE o.TenantID=@tid AND o.TicketId=w.WorkItem AND (o.Deleted=0 OR o.Deleted IS NULL))
                          OR EXISTS (SELECT 1 FROM core2.dbo.Lead ld WHERE ld.TenantID=@tid AND ld.TicketId=w.WorkItem AND (ld.Deleted=0 OR ld.Deleted IS NULL))))
      AND NOT EXISTS (SELECT 1 FROM core2.dbo.ResourceAllocation ra
                      LEFT JOIN core2.dbo.ResourceWorkItems w2 ON w2.ID = ra.ResourceWorkItemLookup
                      CROSS APPLY (SELECT COALESCE(NULLIF(LTRIM(RTRIM(w2.WorkItem)),''), NULLIF(LTRIM(RTRIM(ra.TicketId)),'')) AS tk) t
                      WHERE ra.TenantID=@tid AND (ra.Deleted=0 OR ra.Deleted IS NULL)
                        AND LOWER(ra.ResourceUser)=LOWER(u.id)
                        AND (t.tk IS NULL
                          OR EXISTS (SELECT 1 FROM core2.dbo.PMM p2 WHERE p2.TenantID=@tid AND p2.TicketId=t.tk AND (p2.Deleted=0 OR p2.Deleted IS NULL))
                          OR EXISTS (SELECT 1 FROM core2.dbo.Opportunity o2 WHERE o2.TenantID=@tid AND o2.TicketId=t.tk AND (o2.Deleted=0 OR o2.Deleted IS NULL))
                          OR EXISTS (SELECT 1 FROM core2.dbo.Lead ld2 WHERE ld2.TenantID=@tid AND ld2.TicketId=t.tk AND (ld2.Deleted=0 OR ld2.Deleted IS NULL))))`);
  const stale = ((cand.recordset ?? []) as { id: string; email: string | null; username: string | null }[])
    .filter((u) =>
      !keepKeys.has((u.email ?? "").trim().toLowerCase()) &&
      !keepKeys.has((u.username ?? "").trim().toLowerCase()));
  let total = 0;
  for (let i = 0; i < stale.length; i += 100) {
    const chunk = stale.slice(i, i + 100);
    const ur = await req();
    ur.input("tid", mssql.NVarChar, tid);
    const inList = chunk.map((u, j) => { ur.input(`u${j}`, mssql.NVarChar, u.id); return `@u${j}`; }).join(",");
    const res = await ur.query(`
      UPDATE dbo.rmone_users SET deleted=1, enabled=0, updated_at=SYSUTCDATETIME()
      WHERE tenant_id=@tid AND deleted=0 AND (is_site_admin=0 OR is_site_admin IS NULL) AND id IN (${inList})`);
    total += res.rowsAffected?.[0] ?? 0;
  }
  return total;
}

export async function findUserForLogin(tid: string, username: string): Promise<UserRow | null> {
  const r = await req();
  const low = username.toLowerCase();
  r.input("tid",  mssql.NVarChar, tid);
  r.input("un",   mssql.NVarChar, username);
  r.input("low",  mssql.NVarChar, low);
  const res = await r.query(
    `SELECT TOP 1 * FROM dbo.rmone_users
     WHERE tenant_id=@tid AND deleted=0
       AND (username=@un OR username=@low OR email=@un OR email=@low)`,
  );
  return res.recordset[0] ? mapUser(res.recordset[0]) : null;
}

export async function getUserByTenantAndId(tid: string, id: string): Promise<UserRow | null> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tid);
  r.input("id",  mssql.NVarChar, id);
  const res = await r.query("SELECT TOP 1 * FROM dbo.rmone_users WHERE tenant_id=@tid AND id=@id");
  return res.recordset[0] ? mapUser(res.recordset[0]) : null;
}

export async function getUserByTenantAndUsername(tid: string, username: string): Promise<UserRow | null> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tid);
  r.input("un",  mssql.NVarChar, username.toLowerCase());
  const res = await r.query("SELECT TOP 1 * FROM dbo.rmone_users WHERE tenant_id=@tid AND username=@un");
  return res.recordset[0] ? mapUser(res.recordset[0]) : null;
}

export async function getUserByUsername(username: string): Promise<UserRow | null> {
  const r = await req();
  r.input("un", mssql.NVarChar, username.toLowerCase());
  const res = await r.query("SELECT TOP 1 * FROM dbo.rmone_users WHERE username=@un");
  return res.recordset[0] ? mapUser(res.recordset[0]) : null;
}

export async function getUsersByTenantAndIds(tid: string, ids: string[]): Promise<UserRow[]> {
  if (!ids.length) return [];
  const r = await req();
  r.input("tid", mssql.NVarChar, tid);
  const { clause, inputs } = inList(ids);
  Object.entries(inputs).forEach(([k, v]) => r.input(k, mssql.NVarChar, v));
  const res = await r.query(`SELECT * FROM dbo.rmone_users WHERE tenant_id=@tid AND id IN (${clause})`);
  return res.recordset.map(mapUser);
}

export async function getUsersByIds(ids: string[]): Promise<UserRow[]> {
  if (!ids.length) return [];
  const chunks: UserRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const r = await req();
    const { clause, inputs } = inList(chunk);
    Object.entries(inputs).forEach(([k, v]) => r.input(k, mssql.NVarChar, v));
    const res = await r.query(`SELECT * FROM dbo.rmone_users WHERE id IN (${clause})`);
    chunks.push(...res.recordset.map(mapUser));
  }
  return chunks;
}

export async function getUsersByTenantAndUsernames(tid: string, usernames: string[]): Promise<UserRow[]> {
  if (!usernames.length) return [];
  const r = await req();
  r.input("tid", mssql.NVarChar, tid);
  const { clause, inputs } = inList(usernames, "un");
  Object.entries(inputs).forEach(([k, v]) => r.input(k, mssql.NVarChar, v));
  const res = await r.query(`SELECT * FROM dbo.rmone_users WHERE tenant_id=@tid AND username IN (${clause})`);
  return res.recordset.map(mapUser);
}

export async function getUsersByNamesOrUsernames(
  tid: string, names: string[], usernames: string[],
): Promise<UserRow[]> {
  if (!names.length && !usernames.length) return [];
  const r = await req();
  r.input("tid", mssql.NVarChar, tid);
  const parts: string[] = [];
  if (usernames.length) {
    const { clause, inputs } = inList(usernames, "un");
    Object.entries(inputs).forEach(([k, v]) => r.input(k, mssql.NVarChar, v));
    parts.push(`username IN (${clause})`);
  }
  if (names.length) {
    const { clause, inputs } = inList(names, "nm");
    Object.entries(inputs).forEach(([k, v]) => r.input(k, mssql.NVarChar, v));
    parts.push(`name IN (${clause})`);
  }
  const res = await r.query(
    `SELECT * FROM dbo.rmone_users WHERE tenant_id=@tid AND deleted=0 AND (${parts.join(" OR ")})`
  );
  return res.recordset.map(mapUser);
}

export async function getUserJobTitleIdsByIds(tid: string, ids: string[]): Promise<{ jobTitleId: string | null }[]> {
  if (!ids.length) return [];
  const r = await req();
  r.input("tid", mssql.NVarChar, tid);
  const { clause, inputs } = inList(ids);
  Object.entries(inputs).forEach(([k, v]) => r.input(k, mssql.NVarChar, v));
  const res = await r.query(`SELECT job_title_id FROM dbo.rmone_users WHERE tenant_id=@tid AND id IN (${clause})`);
  return res.recordset.map((row: Record<string, unknown>) => ({ jobTitleId: (row.job_title_id as string | null) ?? null }));
}

export async function insertUser(data: InsertUser): Promise<void> {
  const r = await req();
  r.input("id",            mssql.NVarChar, data.id);
  r.input("tid",           mssql.NVarChar, data.tenantId);
  r.input("username",      mssql.NVarChar, data.username);
  r.input("name",          mssql.NVarChar, data.name);
  r.input("email",         mssql.NVarChar, data.email ?? null);
  r.input("ph",            mssql.NVarChar, data.passwordHash ?? null);
  r.input("role",          mssql.NVarChar, data.role ?? null);
  r.input("roleId",        mssql.NVarChar, data.roleId ?? null);
  r.input("deptId",        mssql.NVarChar, data.departmentId ?? null);
  r.input("divId",         mssql.NVarChar, data.divisionId ?? null);
  r.input("jtId",          mssql.NVarChar, data.jobTitleId ?? null);
  r.input("title",         mssql.NVarChar, data.title ?? null);
  r.input("bu",            mssql.NVarChar, data.businessUnit ?? null);
  r.input("mgrId",         mssql.NVarChar, data.managerUserId ?? null);
  r.input("isManager",     mssql.Bit, data.isManager ? 1 : 0);
  r.input("isSiteAdmin",   mssql.Bit, data.isSiteAdmin ? 1 : 0);
  r.input("accessLevel",   mssql.NVarChar, data.accessLevel ?? null);
  r.input("startDate",     mssql.DateTime2, data.startDate ?? null);
  r.input("endDate",       mssql.DateTime2, data.endDate ?? null);
  r.input("enabled",       mssql.Bit, data.enabled !== false ? 1 : 0);
  r.input("deleted",       mssql.Bit, data.deleted ? 1 : 0);
  r.input("empType",       mssql.NVarChar, data.employeeType ?? null);
  r.input("phone",         mssql.NVarChar, data.phoneNumber ?? null);
  r.input("empId",         mssql.NVarChar, data.employeeId ?? null);
  r.input("office",        mssql.NVarChar, data.office ?? null);
  r.input("jobProfile",    mssql.NVarChar, data.jobProfile ?? null);
  r.input("emailConf",     mssql.Bit, data.emailConfirmed == null ? null : (data.emailConfirmed ? 1 : 0));
  // created_at: honor an explicit value (e.g. staff import "Created On" column);
  // defaults to now, matching the column's DB-default behavior. INSERT-only —
  // updateUser/updateUsersBulk never touch created_at.
  r.input("createdAt",     mssql.DateTime2, data.createdAt ?? new Date());
  await r.query(`
    INSERT INTO dbo.rmone_users (
      id,tenant_id,username,name,email,password_hash,role,role_id,department_id,division_id,
      job_title_id,title,business_unit,manager_user_id,is_manager,is_site_admin,access_level,
      start_date,end_date,enabled,deleted,employee_type,phone_number,employee_id,office,job_profile,
      email_confirmed,created_at
    ) VALUES (
      @id,@tid,@username,@name,@email,@ph,@role,@roleId,@deptId,@divId,
      @jtId,@title,@bu,@mgrId,@isManager,@isSiteAdmin,@accessLevel,
      @startDate,@endDate,@enabled,@deleted,@empType,@phone,@empId,@office,@jobProfile,
      @emailConf,@createdAt
    )
  `);
}

function bindUserPatch(r: mssql.Request, patch: Partial<UserRow>): string[] {
  const sets: string[] = [];
  if ("username"      in patch) { r.input("p_username",     mssql.NVarChar, patch.username ?? null);     sets.push("username=@p_username"); }
  if ("name"          in patch) { r.input("p_name",         mssql.NVarChar, patch.name ?? null);         sets.push("name=@p_name"); }
  if ("email"         in patch) { r.input("p_email",        mssql.NVarChar, patch.email ?? null);        sets.push("email=@p_email"); }
  if ("passwordHash"  in patch) { r.input("p_ph",           mssql.NVarChar, patch.passwordHash ?? null); sets.push("password_hash=@p_ph"); }
  if ("role"          in patch) { r.input("p_role",         mssql.NVarChar, patch.role ?? null);         sets.push("role=@p_role"); }
  if ("roleId"        in patch) { r.input("p_roleId",       mssql.NVarChar, patch.roleId ?? null);       sets.push("role_id=@p_roleId"); }
  if ("departmentId"  in patch) { r.input("p_deptId",       mssql.NVarChar, patch.departmentId ?? null); sets.push("department_id=@p_deptId"); }
  if ("divisionId"    in patch) { r.input("p_divId",        mssql.NVarChar, patch.divisionId ?? null);   sets.push("division_id=@p_divId"); }
  if ("jobTitleId"    in patch) { r.input("p_jtId",         mssql.NVarChar, patch.jobTitleId ?? null);   sets.push("job_title_id=@p_jtId"); }
  if ("title"         in patch) { r.input("p_title",        mssql.NVarChar, patch.title ?? null);        sets.push("title=@p_title"); }
  if ("businessUnit"  in patch) { r.input("p_bu",           mssql.NVarChar, patch.businessUnit ?? null); sets.push("business_unit=@p_bu"); }
  if ("managerUserId" in patch) { r.input("p_mgrId",        mssql.NVarChar, patch.managerUserId??null);  sets.push("manager_user_id=@p_mgrId"); }
  if ("isManager"     in patch) { r.input("p_isManager",    mssql.Bit, patch.isManager ? 1 : 0);         sets.push("is_manager=@p_isManager"); }
  if ("isSiteAdmin"   in patch) { r.input("p_isSiteAdmin",  mssql.Bit, patch.isSiteAdmin ? 1 : 0);       sets.push("is_site_admin=@p_isSiteAdmin"); }
  if ("accessLevel"   in patch) { r.input("p_al",           mssql.NVarChar, patch.accessLevel ?? null);  sets.push("access_level=@p_al"); }
  if ("startDate"     in patch) { r.input("p_start",        mssql.DateTime2, patch.startDate ?? null);   sets.push("start_date=@p_start"); }
  if ("endDate"       in patch) { r.input("p_end",          mssql.DateTime2, patch.endDate ?? null);     sets.push("end_date=@p_end"); }
  if ("enabled"       in patch) { r.input("p_enabled",      mssql.Bit, patch.enabled ? 1 : 0);           sets.push("enabled=@p_enabled"); }
  if ("deleted"       in patch) { r.input("p_deleted",      mssql.Bit, patch.deleted ? 1 : 0);           sets.push("deleted=@p_deleted"); }
  if ("employeeType"  in patch) { r.input("p_empType",      mssql.NVarChar, patch.employeeType ?? null); sets.push("employee_type=@p_empType"); }
  if ("phoneNumber"   in patch) { r.input("p_phone",        mssql.NVarChar, patch.phoneNumber ?? null);  sets.push("phone_number=@p_phone"); }
  if ("employeeId"    in patch) { r.input("p_empId",        mssql.NVarChar, patch.employeeId ?? null);   sets.push("employee_id=@p_empId"); }
  if ("office"        in patch) { r.input("p_office",       mssql.NVarChar, patch.office ?? null);       sets.push("office=@p_office"); }
  if ("jobProfile"    in patch) { r.input("p_jobProfile",   mssql.NVarChar, patch.jobProfile ?? null);   sets.push("job_profile=@p_jobProfile"); }
  if ("emailConfirmed" in patch) { r.input("p_emailConf",   mssql.Bit, patch.emailConfirmed == null ? null : (patch.emailConfirmed ? 1 : 0)); sets.push("email_confirmed=@p_emailConf"); }
  return sets;
}

export async function updateUser(tid: string, id: string, patch: Partial<UserRow>): Promise<number> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tid);
  r.input("id",  mssql.NVarChar, id);
  const sets = bindUserPatch(r, patch);
  if (!sets.length) return 0;
  sets.push("updated_at=GETUTCDATE()");
  const result = await r.query(`UPDATE dbo.rmone_users SET ${sets.join(",")} WHERE tenant_id=@tid AND id=@id`);
  return result?.rowsAffected?.[0] ?? 0;
}

/** Atomic staff write: the lock, update, and persisted readback share one tx. */
export async function updateUserWithSnapshots(
  tid: string,
  id: string,
  patch: Partial<UserRow>,
): Promise<{ before: UserRow; after: UserRow } | null> {
  return withTransaction(async (r) => {
    r.input("tid", mssql.NVarChar, tid);
    r.input("id", mssql.NVarChar, id);
    const beforeResult = await r.query(`
      SELECT TOP 1 * FROM dbo.rmone_users WITH (UPDLOCK, HOLDLOCK)
      WHERE tenant_id=@tid AND id=@id AND deleted=0
    `);
    const beforeRaw = beforeResult.recordset[0] as Record<string, unknown> | undefined;
    if (!beforeRaw) return null;
    const sets = bindUserPatch(r, patch);
    if (sets.length > 0) {
      sets.push("updated_at=GETUTCDATE()");
      const updateResult = await r.query(`
        UPDATE dbo.rmone_users SET ${sets.join(",")}
        WHERE tenant_id=@tid AND id=@id AND deleted=0
      `);
      if ((updateResult.rowsAffected?.[0] ?? 0) !== 1) return null;
    }
    const afterResult = await r.query(`
      SELECT TOP 1 * FROM dbo.rmone_users
      WHERE tenant_id=@tid AND id=@id AND deleted=0
    `);
    const afterRaw = afterResult.recordset[0] as Record<string, unknown> | undefined;
    if (!afterRaw) throw new Error("Staff update final state could not be read inside its transaction.");
    return { before: mapUser(beforeRaw), after: mapUser(afterRaw) };
  });
}

export async function updateUsersByIds(tid: string, ids: string[], patch: Partial<UserRow>): Promise<void> {
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const sets: string[] = [];
    const r = await req();
    r.input("tid", mssql.NVarChar, tid);
    const { clause, inputs } = inList(chunk);
    Object.entries(inputs).forEach(([k, v]) => r.input(k, mssql.NVarChar, v));
    if ("title"      in patch) { r.input("p_title", mssql.NVarChar, patch.title ?? null); sets.push("title=@p_title"); }
    if ("jobTitleId" in patch) { r.input("p_jtId",  mssql.NVarChar, patch.jobTitleId ?? null); sets.push("job_title_id=@p_jtId"); }
    if ("divisionId" in patch) { r.input("p_divId", mssql.NVarChar, patch.divisionId ?? null); sets.push("division_id=@p_divId"); }
    if ("office"     in patch) { r.input("p_office", mssql.NVarChar, patch.office ?? null); sets.push("office=@p_office"); }
    if ("accessLevel" in patch) { r.input("p_al",   mssql.NVarChar, patch.accessLevel ?? null); sets.push("access_level=@p_al"); }
    if ("deleted"    in patch) { r.input("p_del",   mssql.Bit, patch.deleted ? 1 : 0); sets.push("deleted=@p_del"); }
    if ("enabled"    in patch) { r.input("p_en",    mssql.Bit, patch.enabled ? 1 : 0); sets.push("enabled=@p_en"); }
    if (!sets.length) return;
    sets.push("updated_at=GETUTCDATE()");
    await r.query(`UPDATE dbo.rmone_users SET ${sets.join(",")} WHERE tenant_id=@tid AND id IN (${clause})`);
  }
}

export interface UserOfficeSnapshot {
  id: string;
  beforeOffice: string | null;
  afterOffice: string | null;
}

/** Atomic bulk office write for audit-sensitive callers. */
export async function updateUserOfficesWithSnapshots(
  tid: string,
  ids: string[],
  office: string | null,
): Promise<UserOfficeSnapshot[]> {
  if (!ids.length) return [];
  return withTransaction(async (r) => {
    r.input("tid", mssql.NVarChar, tid);
    r.input("office", mssql.NVarChar, office);
    const { clause, inputs } = inList(ids);
    Object.entries(inputs).forEach(([k, v]) => r.input(k, mssql.NVarChar, v));
    const out = await r.query(`
      SELECT id, office FROM dbo.rmone_users WITH (UPDLOCK, HOLDLOCK)
        WHERE tenant_id=@tid AND deleted=0 AND id IN (${clause}) ORDER BY id;
      UPDATE dbo.rmone_users SET office=@office, updated_at=GETUTCDATE()
        WHERE tenant_id=@tid AND deleted=0 AND id IN (${clause});
      SELECT id, office FROM dbo.rmone_users
        WHERE tenant_id=@tid AND deleted=0 AND id IN (${clause}) ORDER BY id;
    `);
    const sets = (out.recordsets ?? []) as Record<string, unknown>[][];
    const before = new Map((sets[0] ?? []).map((row) => [String(row.id), row.office == null ? null : String(row.office)]));
    return (sets[1] ?? []).map((row) => ({
      id: String(row.id),
      beforeOffice: before.get(String(row.id)) ?? null,
      afterOffice: row.office == null ? null : String(row.office),
    }));
  });
}

// Bulk INSERT for the import pipeline: one multi-row VALUES statement per chunk
// (27 columns → 70 rows keeps us safely under SQL Server's 2100-param cap).
// Mirrors insertUser() column-for-column. Throws on chunk failure — callers are
// expected to fall back to per-row insertUser() so individual row errors can
// still be reported against their original spreadsheet row.
export async function insertUsersBulk(users: InsertUser[]): Promise<void> {
  if (!users.length) return;
  const COLS =
    "id,tenant_id,username,name,email,password_hash,role,role_id,department_id,division_id," +
    "job_title_id,title,business_unit,manager_user_id,is_manager,is_site_admin,access_level," +
    "start_date,end_date,enabled,deleted,employee_type,phone_number,employee_id,office,job_profile," +
    "email_confirmed,created_at";
  const CHUNK = 70; // 28 params/row × 70 = 1960 < 2100
  for (let i = 0; i < users.length; i += CHUNK) {
    const chunk = users.slice(i, i + CHUNK);
    const r = await req();
    const tuples: string[] = [];
    chunk.forEach((data, ri) => {
      const p = (n: string) => `u${ri}_${n}`;
      r.input(p("id"),         mssql.NVarChar, data.id);
      r.input(p("tid"),        mssql.NVarChar, data.tenantId);
      r.input(p("username"),   mssql.NVarChar, data.username);
      r.input(p("name"),       mssql.NVarChar, data.name);
      r.input(p("email"),      mssql.NVarChar, data.email ?? null);
      r.input(p("ph"),         mssql.NVarChar, data.passwordHash ?? null);
      r.input(p("role"),       mssql.NVarChar, data.role ?? null);
      r.input(p("roleId"),     mssql.NVarChar, data.roleId ?? null);
      r.input(p("deptId"),     mssql.NVarChar, data.departmentId ?? null);
      r.input(p("divId"),      mssql.NVarChar, data.divisionId ?? null);
      r.input(p("jtId"),       mssql.NVarChar, data.jobTitleId ?? null);
      r.input(p("title"),      mssql.NVarChar, data.title ?? null);
      r.input(p("bu"),         mssql.NVarChar, data.businessUnit ?? null);
      r.input(p("mgrId"),      mssql.NVarChar, data.managerUserId ?? null);
      r.input(p("isMgr"),      mssql.Bit, data.isManager ? 1 : 0);
      r.input(p("isAdm"),      mssql.Bit, data.isSiteAdmin ? 1 : 0);
      r.input(p("acl"),        mssql.NVarChar, data.accessLevel ?? null);
      r.input(p("sd"),         mssql.DateTime2, data.startDate ?? null);
      r.input(p("ed"),         mssql.DateTime2, data.endDate ?? null);
      r.input(p("en"),         mssql.Bit, data.enabled !== false ? 1 : 0);
      r.input(p("del"),        mssql.Bit, data.deleted ? 1 : 0);
      r.input(p("empType"),    mssql.NVarChar, data.employeeType ?? null);
      r.input(p("phone"),      mssql.NVarChar, data.phoneNumber ?? null);
      r.input(p("empId"),      mssql.NVarChar, data.employeeId ?? null);
      r.input(p("office"),     mssql.NVarChar, data.office ?? null);
      r.input(p("jobProf"),    mssql.NVarChar, data.jobProfile ?? null);
      r.input(p("emailConf"),  mssql.Bit, data.emailConfirmed == null ? null : (data.emailConfirmed ? 1 : 0));
      r.input(p("createdAt"),  mssql.DateTime2, data.createdAt ?? new Date());
      tuples.push(`(@${p("id")},@${p("tid")},@${p("username")},@${p("name")},@${p("email")},@${p("ph")},@${p("role")},@${p("roleId")},@${p("deptId")},@${p("divId")},@${p("jtId")},@${p("title")},@${p("bu")},@${p("mgrId")},@${p("isMgr")},@${p("isAdm")},@${p("acl")},@${p("sd")},@${p("ed")},@${p("en")},@${p("del")},@${p("empType")},@${p("phone")},@${p("empId")},@${p("office")},@${p("jobProf")},@${p("emailConf")},@${p("createdAt")})`);
    });
    await r.query(`INSERT INTO dbo.rmone_users (${COLS}) VALUES ${tuples.join(",")}`);
  }
}

// Bulk UPDATE for the import pipeline: concatenates one UPDATE statement per row
// into a single round trip, preserving updateUser()'s exact per-field semantics
// (a key present in the patch is written — including explicit NULLs; absent keys
// are untouched). Batches are flushed before the 2100-param cap. Throws on batch
// failure — callers fall back to per-row updateUser().
export async function updateUsersBulk(
  tid: string,
  updates: Array<{ id: string; patch: Partial<UserRow> }>,
): Promise<void> {
  if (!updates.length) return;
  const PARAM_BUDGET = 1800;
  let r = await req();
  let stmts: string[] = [];
  let params = 1; // @tid
  r.input("tid", mssql.NVarChar, tid);
  const flush = async () => {
    if (!stmts.length) return;
    await r.query(stmts.join("\n"));
    r = await req();
    r.input("tid", mssql.NVarChar, tid);
    stmts = [];
    params = 1;
  };
  for (let i = 0; i < updates.length; i++) {
    const { id, patch } = updates[i];
    const p = (n: string) => `u${i}_${n}`;
    const sets: string[] = [];
    let rowParams = 1; // id
    const addS = (key: keyof UserRow, col: string, short: string, type: any, val: unknown) => {
      if (key in patch) { r.input(p(short), type, val); sets.push(`${col}=@${p(short)}`); rowParams++; }
    };
    // Row might not fit in the current batch — flush first so inputs land on the
    // fresh request. Worst case a row has ~25 params, well under the budget.
    if (params + 30 > PARAM_BUDGET) await flush();
    addS("username",      "username",        "un",     mssql.NVarChar, patch.username ?? null);
    addS("name",          "name",            "nm",     mssql.NVarChar, patch.name ?? null);
    addS("email",         "email",           "em",     mssql.NVarChar, patch.email ?? null);
    addS("passwordHash",  "password_hash",   "ph",     mssql.NVarChar, patch.passwordHash ?? null);
    addS("role",          "role",            "role",   mssql.NVarChar, patch.role ?? null);
    addS("roleId",        "role_id",         "roleId", mssql.NVarChar, patch.roleId ?? null);
    addS("departmentId",  "department_id",   "deptId", mssql.NVarChar, patch.departmentId ?? null);
    addS("divisionId",    "division_id",     "divId",  mssql.NVarChar, patch.divisionId ?? null);
    addS("jobTitleId",    "job_title_id",    "jtId",   mssql.NVarChar, patch.jobTitleId ?? null);
    addS("title",         "title",           "ti",     mssql.NVarChar, patch.title ?? null);
    addS("businessUnit",  "business_unit",   "bu",     mssql.NVarChar, patch.businessUnit ?? null);
    addS("managerUserId", "manager_user_id", "mgr",    mssql.NVarChar, patch.managerUserId ?? null);
    addS("isManager",     "is_manager",      "isMgr",  mssql.Bit, patch.isManager ? 1 : 0);
    addS("isSiteAdmin",   "is_site_admin",   "isAdm",  mssql.Bit, patch.isSiteAdmin ? 1 : 0);
    addS("accessLevel",   "access_level",    "acl",    mssql.NVarChar, patch.accessLevel ?? null);
    addS("startDate",     "start_date",      "sd",     mssql.DateTime2, patch.startDate ?? null);
    addS("endDate",       "end_date",        "ed",     mssql.DateTime2, patch.endDate ?? null);
    addS("enabled",       "enabled",         "en",     mssql.Bit, patch.enabled ? 1 : 0);
    addS("deleted",       "deleted",         "del",    mssql.Bit, patch.deleted ? 1 : 0);
    addS("employeeType",  "employee_type",   "et",     mssql.NVarChar, patch.employeeType ?? null);
    addS("phoneNumber",   "phone_number",    "pn",     mssql.NVarChar, patch.phoneNumber ?? null);
    addS("employeeId",    "employee_id",     "eid",    mssql.NVarChar, patch.employeeId ?? null);
    addS("office",        "office",          "of",     mssql.NVarChar, patch.office ?? null);
    addS("jobProfile",    "job_profile",     "jp",     mssql.NVarChar, patch.jobProfile ?? null);
    addS("emailConfirmed","email_confirmed", "ec",     mssql.Bit, patch.emailConfirmed == null ? null : (patch.emailConfirmed ? 1 : 0));
    if (!sets.length) continue;
    sets.push("updated_at=GETUTCDATE()");
    r.input(p("id"), mssql.NVarChar, id);
    stmts.push(`UPDATE dbo.rmone_users SET ${sets.join(",")} WHERE tenant_id=@tid AND id=@${p("id")};`);
    params += rowParams;
  }
  await flush();
}

// ── CARD INSIGHTS CACHE ────────────────────────────────────────────────────

export interface InsightRow {
  cacheKey: string;
  kind: string;
  recordId: string;
  fieldsHash: string;
  severity: string;
  text: string;
  expiresAt: Date;
  createdAt: Date;
}

function mapInsight(r: Record<string, unknown>): InsightRow {
  return {
    cacheKey:   String(r.cache_key ?? ""),
    kind:       String(r.kind ?? ""),
    recordId:   String(r.record_id ?? ""),
    fieldsHash: String(r.fields_hash ?? ""),
    severity:   String(r.severity ?? ""),
    text:       String(r.text ?? ""),
    expiresAt:  r.expires_at instanceof Date ? r.expires_at : new Date(String(r.expires_at)),
    createdAt:  r.created_at instanceof Date ? r.created_at : new Date(),
  };
}

export async function getInsightRows(keys: string[], graceCutoff: Date): Promise<InsightRow[]> {
  if (!keys.length) return [];
  const r = await req();
  r.input("cutoff", mssql.DateTime2, graceCutoff);
  const { clause, inputs } = inList(keys);
  Object.entries(inputs).forEach(([k, v]) => r.input(k, mssql.NVarChar, v));
  const res = await r.query(
    `SELECT * FROM dbo.rmone_card_insights_cache WHERE cache_key IN (${clause}) AND expires_at>=@cutoff`,
  );
  return res.recordset.map(mapInsight);
}

export async function upsertInsightRows(rows: { cacheKey: string; kind: string; recordId: string; fieldsHash: string; severity: string; text: string; expiresAt: Date }[]): Promise<void> {
  for (const row of rows) {
    const r = await req();
    r.input("ck",  mssql.NVarChar, row.cacheKey);
    r.input("knd", mssql.NVarChar, row.kind);
    r.input("rid", mssql.NVarChar, row.recordId);
    r.input("fh",  mssql.NVarChar, row.fieldsHash);
    r.input("sev", mssql.NVarChar, row.severity);
    r.input("txt", mssql.NVarChar, row.text);
    r.input("exp", mssql.DateTime2, row.expiresAt);
    await r.query(`
      MERGE dbo.rmone_card_insights_cache AS T
      USING (SELECT @ck AS ck) AS S ON T.cache_key=S.ck
      WHEN MATCHED THEN UPDATE SET kind=@knd,record_id=@rid,fields_hash=@fh,severity=@sev,text=@txt,expires_at=@exp
      WHEN NOT MATCHED THEN INSERT (cache_key,kind,record_id,fields_hash,severity,text,expires_at)
        VALUES (@ck,@knd,@rid,@fh,@sev,@txt,@exp);
    `);
  }
}

export async function deleteInsightsByRecord(kind: string, recordId: string): Promise<string[]> {
  const r = await req();
  r.input("knd", mssql.NVarChar, kind);
  r.input("rid", mssql.NVarChar, recordId);
  const res = await r.query(
    "DELETE FROM dbo.rmone_card_insights_cache OUTPUT DELETED.cache_key WHERE kind=@knd AND record_id=@rid",
  );
  return res.recordset.map((row: Record<string, unknown>) => String(row.cache_key));
}

export async function deleteInsightsByKind(kind: string): Promise<string[]> {
  const r = await req();
  r.input("knd", mssql.NVarChar, kind);
  const res = await r.query(
    "DELETE FROM dbo.rmone_card_insights_cache OUTPUT DELETED.cache_key WHERE kind=@knd",
  );
  return res.recordset.map((row: Record<string, unknown>) => String(row.cache_key));
}

export async function pruneExpiredInsights(before: Date): Promise<number> {
  const r = await req();
  r.input("now", mssql.DateTime2, before);
  const res = await r.query(
    "DELETE FROM dbo.rmone_card_insights_cache OUTPUT DELETED.cache_key WHERE expires_at<@now",
  );
  return res.recordset.length;
}

// ── FORECAST SNAPSHOTS ─────────────────────────────────────────────────────

export interface ForecastSnapshot {
  id: number;
  tenant: string;
  snapshotDate: Date;
  pipelineCount: number;
  backlogCount: number;
  openDemandCount: number;
  benchCount: number;
  overAllocatedCount: number;
  revenuePipeline: number | null;
  revenueBacklog: number | null;
  utilizationPct: number | null;
  createdAt: Date;
}

function mapForecast(r: Record<string, unknown>): ForecastSnapshot {
  return {
    id:                Number(r.id ?? 0),
    tenant:            String(r.tenant ?? ""),
    snapshotDate:      r.snapshot_date instanceof Date ? r.snapshot_date : new Date(String(r.snapshot_date)),
    pipelineCount:     Number(r.pipeline_count ?? 0),
    backlogCount:      Number(r.backlog_count ?? 0),
    openDemandCount:   Number(r.open_demand_count ?? 0),
    benchCount:        Number(r.bench_count ?? 0),
    overAllocatedCount:Number(r.over_allocated_count ?? 0),
    revenuePipeline:   r.revenue_pipeline != null ? Number(r.revenue_pipeline) : null,
    revenueBacklog:    r.revenue_backlog != null ? Number(r.revenue_backlog) : null,
    utilizationPct:    r.utilization_pct != null ? Number(r.utilization_pct) : null,
    createdAt:         r.created_at instanceof Date ? r.created_at : new Date(),
  };
}

export async function getForecastSnapshot(tenant: string, date: Date): Promise<ForecastSnapshot | null> {
  const r = await req();
  r.input("tenant", mssql.NVarChar, tenant);
  r.input("date",   mssql.DateTime2, date);
  const res = await r.query(
    "SELECT TOP 1 * FROM dbo.rmone_forecast_snapshots WHERE tenant=@tenant AND snapshot_date=@date",
  );
  return res.recordset[0] ? mapForecast(res.recordset[0]) : null;
}

export async function upsertForecastSnapshot(data: Omit<ForecastSnapshot, "id" | "createdAt">): Promise<ForecastSnapshot> {
  const r = await req();
  r.input("tenant", mssql.NVarChar, data.tenant);
  r.input("date",   mssql.DateTime2, data.snapshotDate);
  r.input("pc",     mssql.Int, data.pipelineCount);
  r.input("bc",     mssql.Int, data.backlogCount);
  r.input("odc",    mssql.Int, data.openDemandCount);
  r.input("bnc",    mssql.Int, data.benchCount);
  r.input("oac",    mssql.Int, data.overAllocatedCount);
  r.input("rp",     mssql.Decimal, data.revenuePipeline ?? null);
  r.input("rb",     mssql.Decimal, data.revenueBacklog ?? null);
  r.input("up",     mssql.Decimal, data.utilizationPct ?? null);
  const res = await r.query(`
    MERGE dbo.rmone_forecast_snapshots AS T
    USING (SELECT @tenant AS t, @date AS d) AS S ON T.tenant=S.t AND T.snapshot_date=S.d
    WHEN MATCHED THEN UPDATE SET pipeline_count=@pc,backlog_count=@bc,open_demand_count=@odc,
      bench_count=@bnc,over_allocated_count=@oac,revenue_pipeline=@rp,revenue_backlog=@rb,utilization_pct=@up
    WHEN NOT MATCHED THEN INSERT (tenant,snapshot_date,pipeline_count,backlog_count,open_demand_count,
      bench_count,over_allocated_count,revenue_pipeline,revenue_backlog,utilization_pct)
      VALUES (@tenant,@date,@pc,@bc,@odc,@bnc,@oac,@rp,@rb,@up)
    OUTPUT INSERTED.*;
  `);
  return mapForecast(res.recordset[0]);
}

export async function getForecastHistory(tenant: string, since: Date): Promise<ForecastSnapshot[]> {
  const r = await req();
  r.input("tenant", mssql.NVarChar, tenant);
  r.input("since",  mssql.DateTime2, since);
  const res = await r.query(
    "SELECT * FROM dbo.rmone_forecast_snapshots WHERE tenant=@tenant AND snapshot_date>=@since ORDER BY snapshot_date ASC",
  );
  return res.recordset.map(mapForecast);
}

// ── AI ESCALATIONS ─────────────────────────────────────────────────────────

export interface AiEscalation {
  id: number;
  tenant: string;
  role: string | null;
  userGuid: string | null;
  severity: string;
  title: string;
  summary: string;
  payload: Record<string, unknown> | null;
  status: string;
  generatedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

function mapEscalation(r: Record<string, unknown>): AiEscalation {
  return {
    id:          Number(r.id ?? 0),
    tenant:      String(r.tenant ?? ""),
    role:        (r.role as string | null) ?? null,
    userGuid:    (r.user_guid as string | null) ?? null,
    severity:    String(r.severity ?? ""),
    title:       String(r.title ?? ""),
    summary:     String(r.summary ?? ""),
    payload:     jParse<Record<string, unknown>>(r.payload as string | null, null as unknown as Record<string, unknown>),
    status:      String(r.status ?? "open"),
    generatedAt: r.generated_at instanceof Date ? r.generated_at : null,
    expiresAt:   r.expires_at instanceof Date ? r.expires_at : null,
    createdAt:   r.created_at instanceof Date ? r.created_at : new Date(),
  };
}

export async function getAiEscalations(tenant: string, since: Date): Promise<AiEscalation[]> {
  const r = await req();
  r.input("tenant", mssql.NVarChar, tenant);
  r.input("since",  mssql.DateTime2, since);
  const res = await r.query(
    "SELECT * FROM dbo.rmone_ai_escalations WHERE tenant=@tenant AND generated_at>=@since ORDER BY generated_at DESC",
  );
  return res.recordset.map(mapEscalation);
}

/** Delete a tenant's escalation cards generated on/after `since` (UTC day
 *  start). Used by the intraday freshness gate: when allocation data changes
 *  materially after today's cards were written, the stale cards are retired
 *  so the next feed request regenerates them from live data. */
export async function deleteAiEscalationsSince(tenant: string, since: Date): Promise<number> {
  const r = await req();
  r.input("tenant", mssql.NVarChar, tenant);
  r.input("since",  mssql.DateTime2, since);
  const res = await r.query(
    "DELETE FROM dbo.rmone_ai_escalations WHERE tenant=@tenant AND generated_at>=@since",
  );
  return res.rowsAffected?.[0] ?? 0;
}

export async function insertAiEscalation(data: Omit<AiEscalation, "id" | "createdAt">): Promise<AiEscalation> {
  const r = await req();
  r.input("tenant",  mssql.NVarChar, data.tenant);
  r.input("role",    mssql.NVarChar, data.role ?? null);
  r.input("uguid",   mssql.NVarChar, data.userGuid ?? null);
  r.input("sev",     mssql.NVarChar, data.severity);
  r.input("title",   mssql.NVarChar, data.title);
  r.input("summary", mssql.NVarChar, data.summary);
  r.input("payload", mssql.NVarChar, jStr(data.payload));
  r.input("status",  mssql.NVarChar, data.status ?? "open");
  r.input("genAt",   mssql.DateTime2, data.generatedAt ?? null);
  r.input("expAt",   mssql.DateTime2, data.expiresAt ?? null);
  const res = await r.query(`
    INSERT INTO dbo.rmone_ai_escalations (tenant,role,user_guid,severity,title,summary,payload,status,generated_at,expires_at)
    OUTPUT INSERTED.*
    VALUES (@tenant,@role,@uguid,@sev,@title,@summary,@payload,@status,@genAt,@expAt)
  `);
  return mapEscalation(res.recordset[0]);
}

export interface ReplaceAiEscalationsResult {
  /** false = another worker holds the per-tenant replacement lock right now */
  acquired: boolean;
  /** true = rows at least as fresh as this regeneration already exist (kept) */
  superseded: boolean;
  rows: AiEscalation[];
}

/** Atomically replace a tenant's escalation cards generated on/after `since`
 *  with `rows`, serialized cluster-wide by a per-tenant applock so concurrent
 *  feed reads on different workers can neither insert duplicate card sets nor
 *  delete a sibling's freshly generated set. Non-blocking (@LockTimeout=0):
 *  when the lock is busy callers get {acquired:false} and keep serving what
 *  they already have. After acquiring, any existing row stamped at/after
 *  `regenStart` means a sibling replaced the set with data at least as fresh
 *  as this caller's source read — those rows win and are returned with
 *  superseded:true; deleting them would resurrect older data. */
export async function replaceAiEscalationsAtomic(
  tenant: string,
  since: Date,
  regenStart: Date,
  rows: Array<Omit<AiEscalation, "id" | "createdAt">>,
): Promise<ReplaceAiEscalationsResult> {
  await bootstrapDatabase();
  const pool = await getMssqlPool();
  const tx = new mssql.Transaction(pool);
  await tx.begin();
  let settled = false;
  try {
    const lockRq = new mssql.Request(tx);
    lockRq.input("lockRes", mssql.NVarChar, `rmone_ai_esc:${tenant.trim().toLowerCase()}`);
    const lockRes = await lockRq.query(
      "DECLARE @rc int; EXEC @rc = sp_getapplock @Resource=@lockRes, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=0; SELECT @rc AS rc;",
    );
    const rc = Number(lockRes.recordset?.[0]?.rc ?? -999);
    if (rc < 0) {
      await tx.rollback();
      settled = true;
      return { acquired: false, superseded: false, rows: [] };
    }
    const checkRq = new mssql.Request(tx);
    checkRq.input("tenant", mssql.NVarChar, tenant);
    checkRq.input("since", mssql.DateTime2, since);
    const existing = await checkRq.query(
      "SELECT * FROM dbo.rmone_ai_escalations WHERE tenant=@tenant AND generated_at>=@since ORDER BY generated_at DESC",
    );
    const current = (existing.recordset ?? []).map(mapEscalation);
    if (current.some((r) => r.generatedAt && r.generatedAt.getTime() >= regenStart.getTime())) {
      await tx.rollback(); // releases the applock; nothing was written
      settled = true;
      return { acquired: true, superseded: true, rows: current };
    }
    const delRq = new mssql.Request(tx);
    delRq.input("tenant", mssql.NVarChar, tenant);
    delRq.input("since", mssql.DateTime2, since);
    await delRq.query("DELETE FROM dbo.rmone_ai_escalations WHERE tenant=@tenant AND generated_at>=@since");
    const inserted: AiEscalation[] = [];
    for (const data of rows) {
      const r = new mssql.Request(tx);
      r.input("tenant",  mssql.NVarChar, data.tenant);
      r.input("role",    mssql.NVarChar, data.role ?? null);
      r.input("uguid",   mssql.NVarChar, data.userGuid ?? null);
      r.input("sev",     mssql.NVarChar, data.severity);
      r.input("title",   mssql.NVarChar, data.title);
      r.input("summary", mssql.NVarChar, data.summary);
      r.input("payload", mssql.NVarChar, jStr(data.payload));
      r.input("status",  mssql.NVarChar, data.status ?? "open");
      r.input("genAt",   mssql.DateTime2, data.generatedAt ?? null);
      r.input("expAt",   mssql.DateTime2, data.expiresAt ?? null);
      const res = await r.query(`
        INSERT INTO dbo.rmone_ai_escalations (tenant,role,user_guid,severity,title,summary,payload,status,generated_at,expires_at)
        OUTPUT INSERTED.*
        VALUES (@tenant,@role,@uguid,@sev,@title,@summary,@payload,@status,@genAt,@expAt)
      `);
      inserted.push(mapEscalation(res.recordset[0]));
    }
    await tx.commit();
    settled = true;
    return { acquired: true, superseded: false, rows: inserted };
  } catch (e) {
    if (!settled) {
      try { await tx.rollback(); } catch { /* transaction/connection already gone */ }
    }
    throw e;
  }
}

export async function updateAiEscalation(id: number, patch: Partial<Pick<AiEscalation, "status" | "summary">>): Promise<void> {
  const sets: string[] = [];
  const r = await req();
  r.input("id", mssql.Int, id);
  if ("status"  in patch) { r.input("p_status",  mssql.NVarChar, patch.status ?? null);  sets.push("status=@p_status"); }
  if ("summary" in patch) { r.input("p_summary", mssql.NVarChar, patch.summary ?? null); sets.push("summary=@p_summary"); }
  if (!sets.length) return;
  await r.query(`UPDATE dbo.rmone_ai_escalations SET ${sets.join(",")} WHERE id=@id`);
}

// ── ALERT STATE ────────────────────────────────────────────────────────────

export interface AlertStateRow {
  id: number;
  tenant: string;
  userGuid: string;
  alertKey: string;
  status: string;
  snoozedUntil: Date | null;
  note: string | null;
  updatedAt: Date;
  createdAt: Date;
}

function mapAlertState(r: Record<string, unknown>): AlertStateRow {
  return {
    id:           Number(r.id ?? 0),
    tenant:       String(r.tenant ?? ""),
    userGuid:     String(r.user_guid ?? ""),
    alertKey:     String(r.alert_key ?? ""),
    status:       String(r.status ?? ""),
    snoozedUntil: r.snoozed_until instanceof Date ? r.snoozed_until : null,
    note:         (r.note as string | null) ?? null,
    updatedAt:    r.updated_at instanceof Date ? r.updated_at : new Date(),
    createdAt:    r.created_at instanceof Date ? r.created_at : new Date(),
  };
}

export async function getAlertStatesByUser(tenant: string, userGuid: string): Promise<AlertStateRow[]> {
  const r = await req();
  r.input("tenant",   mssql.NVarChar, tenant);
  r.input("userGuid", mssql.NVarChar, userGuid);
  const res = await r.query(
    "SELECT * FROM dbo.rmone_alert_state WHERE tenant=@tenant AND user_guid=@userGuid",
  );
  return res.recordset.map(mapAlertState);
}

export async function upsertAlertState(data: {
  tenant: string; userGuid: string; alertKey: string;
  status: string; snoozedUntil?: Date | null; note?: string | null;
}): Promise<AlertStateRow> {
  const r = await req();
  r.input("tenant",   mssql.NVarChar, data.tenant);
  r.input("uguid",    mssql.NVarChar, data.userGuid);
  r.input("key",      mssql.NVarChar, data.alertKey);
  r.input("status",   mssql.NVarChar, data.status);
  r.input("snoozed",  mssql.DateTime2, data.snoozedUntil ?? null);
  r.input("note",     mssql.NVarChar, data.note ?? null);
  const res = await r.query(`
    MERGE dbo.rmone_alert_state AS T
    USING (SELECT @tenant AS t, @uguid AS ug, @key AS k) AS S
      ON T.tenant=S.t AND T.user_guid=S.ug AND T.alert_key=S.k
    WHEN MATCHED THEN UPDATE SET status=@status,snoozed_until=@snoozed,note=@note,updated_at=GETUTCDATE()
    WHEN NOT MATCHED THEN INSERT (tenant,user_guid,alert_key,status,snoozed_until,note)
      VALUES (@tenant,@uguid,@key,@status,@snoozed,@note)
    OUTPUT INSERTED.*;
  `);
  return mapAlertState(res.recordset[0]);
}

// ── DECISION ACKS ──────────────────────────────────────────────────────────

export interface DecisionAckRow {
  id: number;
  tenant: string | null;
  username: string;
  kind: string;
  refId: string;
  label: string;
  note: string | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

function mapDecisionAck(r: Record<string, unknown>): DecisionAckRow {
  return {
    id:        Number(r.id ?? 0),
    tenant:    (r.tenant as string | null) ?? null,
    username:  String(r.username ?? ""),
    kind:      String(r.kind ?? ""),
    refId:     String(r.ref_id ?? ""),
    label:     String(r.label ?? ""),
    note:      (r.note as string | null) ?? null,
    payload:   jParse<Record<string, unknown>>(r.payload as string | null, null as unknown as Record<string, unknown>),
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(),
  };
}

export async function insertDecisionAck(data: {
  tenant: string | null; username: string; kind: string;
  refId: string; label: string; note: string | null; payload: Record<string, unknown>;
}): Promise<{ id: number; createdAt: Date }> {
  const r = await req();
  r.input("tenant",  mssql.NVarChar, data.tenant ?? null);
  r.input("user",    mssql.NVarChar, data.username);
  r.input("kind",    mssql.NVarChar, data.kind);
  r.input("refId",   mssql.NVarChar, data.refId);
  r.input("label",   mssql.NVarChar, data.label);
  r.input("note",    mssql.NVarChar, data.note ?? null);
  r.input("payload", mssql.NVarChar, JSON.stringify(data.payload ?? {}));
  const res = await r.query(`
    INSERT INTO dbo.rmone_decision_acks (tenant,username,kind,ref_id,label,note,payload)
    OUTPUT INSERTED.id, INSERTED.created_at
    VALUES (@tenant,@user,@kind,@refId,@label,@note,@payload)
  `);
  const row = res.recordset[0] as { id: number; created_at: Date };
  return { id: row.id, createdAt: row.created_at };
}

export async function getDecisionAcks(username: string, kind?: string, limit = 50): Promise<DecisionAckRow[]> {
  const r = await req();
  r.input("user",  mssql.NVarChar, username);
  r.input("limit", mssql.Int, Math.max(1, Math.min(200, limit)));
  let where = "username=@user";
  if (kind) { r.input("kind", mssql.NVarChar, kind); where += " AND kind=@kind"; }
  const res = await r.query(
    `SELECT TOP (@limit) * FROM dbo.rmone_decision_acks WHERE ${where} ORDER BY created_at DESC`,
  );
  return res.recordset.map(mapDecisionAck);
}

// ── ONBOARDING JOBS ────────────────────────────────────────────────────────

export interface OnboardingJobRow {
  uploadId: string;
  tenantId: string;
  fileName: string;
  s3Key: string | null;
  status: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  totalInserted: number | null;
  totalErrors: number | null;
  importMode: string | null;
  fileData: string | null;
  errorDetail: string | null;
  summary: string | null;
  columnMapping: string | null;
  result: string | null;
  sheets: string | null;
  /** Upload-card intent stamped by the import page (/upload, /run) — persisted
   *  so the /active cross-worker DB fallback badges the same modules as the
   *  owner worker. */
  forcedTabType: string | null;
  forcedRecordType: string | null;
}

function mapJob(r: Record<string, unknown>): OnboardingJobRow {
  return {
    uploadId:      String(r.upload_id ?? ""),
    tenantId:      String(r.tenant_id ?? ""),
    fileName:      String(r.file_name ?? ""),
    s3Key:         (r.s3_key as string | null) ?? null,
    status:        String(r.status ?? "pending"),
    createdBy:     (r.created_by as string | null) ?? null,
    createdAt:     r.created_at instanceof Date ? r.created_at : new Date(),
    updatedAt:     r.updated_at instanceof Date ? r.updated_at : new Date(),
    totalInserted: r.total_inserted != null ? Number(r.total_inserted) : null,
    totalErrors:   r.total_errors != null ? Number(r.total_errors) : null,
    importMode:    (r.import_mode as string | null) ?? null,
    fileData:      (r.file_data as string | null) ?? null,
    errorDetail:   (r.error_detail as string | null) ?? null,
    summary:       (r.summary as string | null) ?? null,
    columnMapping: (r.column_mapping as string | null) ?? null,
    result:        (r.result as string | null) ?? null,
    sheets:        (r.sheets as string | null) ?? null,
    forcedTabType:    (r.forced_tab_type as string | null) ?? null,
    forcedRecordType: (r.forced_record_type as string | null) ?? null,
  };
}

export async function getAllOnboardingJobs(): Promise<OnboardingJobRow[]> {
  const r = await req();
  const res = await r.query("SELECT * FROM dbo.rmone_onboarding_jobs WITH (NOLOCK) ORDER BY created_at DESC");
  return res.recordset.map(mapJob);
}

// Lightweight variant used by the /history list page — excludes the
// file_data column (raw Excel blob) which can be several MB per row and
// makes the query take 60-90 s over a slow RDS link even for a handful of
// jobs.  Every column except file_data is returned; callers that need the
// actual file bytes should use getOnboardingJob() for the specific row.
export async function getAllOnboardingJobsMeta(): Promise<OnboardingJobRow[]> {
  const r = await req();
  const res = await r.query(`
    SELECT upload_id, tenant_id, file_name, s3_key, status, created_by,
           created_at, updated_at, total_inserted, total_errors, import_mode,
           error_detail, summary, column_mapping, result, sheets,
           forced_tab_type, forced_record_type
    FROM   dbo.rmone_onboarding_jobs WITH (NOLOCK)
    ORDER  BY created_at DESC
  `);
  return res.recordset.map(r2 => ({ ...mapJob(r2), fileData: null }));
}

// Newest-N variant for the startup warm ONLY: result/sheets JSON can be
// hundreds of KB per big import, and the warm keeps just the newest 500 rows
// anyway — without a SQL-side cap every worker pays for the ENTIRE history at
// each boot as runs accumulate. Callers that reason over full history
// (conflict checks, rollback prior-import detection, tenant deletion,
// /history fallback) must keep using getAllOnboardingJobsMeta().
export async function getRecentOnboardingJobsMeta(limit = 500): Promise<OnboardingJobRow[]> {
  const n = Math.max(1, Math.min(2000, Math.floor(limit)));
  const r = await req();
  const res = await r.query(`
    SELECT TOP ${n} upload_id, tenant_id, file_name, s3_key, status, created_by,
           created_at, updated_at, total_inserted, total_errors, import_mode,
           error_detail, summary, column_mapping, result, sheets,
           forced_tab_type, forced_record_type
    FROM   dbo.rmone_onboarding_jobs WITH (NOLOCK)
    ORDER  BY created_at DESC
  `);
  return res.recordset.map(r2 => ({ ...mapJob(r2), fileData: null }));
}

// Slimmest possible history query — the Upload History list only needs the
// scalar columns plus a *count* of warnings, never the result/sheets/
// column_mapping JSON blobs (each can be MBs for a big import; multiplied by
// every run ever made, the "meta" query above still ships tens of MB and makes
// the history page crawl). The warnings count is computed SQL-side via
// OPENJSON so only a single integer crosses the wire per row.
// OPENJSON needs DB compatibility level >= 130 — callers must be prepared to
// fall back to getAllOnboardingJobsMeta() if this query errors.
export type OnboardingHistorySlimRow = {
  uploadId: string; tenantId: string; fileName: string; status: string;
  createdBy: string | null; createdAt: Date;
  totalInserted: number | null; totalErrors: number | null;
  importMode: string | null; warningsCount: number;
};
const _mapHistorySlimRow = (x: any): OnboardingHistorySlimRow => ({
  uploadId:      x.upload_id,
  tenantId:      x.tenant_id,
  fileName:      x.file_name,
  status:        x.status,
  createdBy:     x.created_by ?? null,
  createdAt:     x.created_at,
  totalInserted: x.total_inserted ?? null,
  totalErrors:   x.total_errors ?? null,
  importMode:    x.import_mode ?? null,
  warningsCount: Number(x.warnings_count ?? 0),
});

const _HISTORY_SLIM_BASE_COLS = `
  upload_id, tenant_id, file_name, status, created_by, created_at,
  total_inserted, total_errors, import_mode`;

// Per-row warnings count parsed from the result JSON. OPENJSON must parse the
// ENTIRE result document per row, so this is only affordable on small row sets
// (one tenant's runs). Measured on the live DB: 116 rows / 43 MB of result
// JSON = ~50 s for the all-tenants scan, which is why the global query below
// must NOT use this expression.
const _HISTORY_SLIM_WARNINGS_COL = `
  CASE WHEN result IS NULL OR ISJSON(result) = 0 THEN 0
       ELSE (SELECT COUNT(*) FROM OPENJSON(result, '$.warnings')) END AS warnings_count`;

/** All tenants — superadmin full-history view only.
 *
 *  warnings_count is deliberately returned as 0 here: parsing every tenant's
 *  result JSON took ~50 s on the live DB (43 MB of LOBs), which blew past the
 *  web client's 20 s abort and made the superadmin history page fail outright.
 *  Every surface that actually displays per-run warning badges fetches through
 *  the single-tenant variant below, which keeps the accurate count. TOP (1000)
 *  makes the documented row cap real so the query stays bounded as history
 *  grows. */
export async function getOnboardingHistorySlim(): Promise<OnboardingHistorySlimRow[]> {
  const r = await req();
  const res = await r.query(`
    SELECT TOP (1000) ${_HISTORY_SLIM_BASE_COLS},
           CAST(0 AS INT) AS warnings_count
    FROM   dbo.rmone_onboarding_jobs WITH (NOLOCK)
    ORDER  BY created_at DESC
  `);
  return res.recordset.map(_mapHistorySlimRow);
}

/** Single-tenant variant — pushes the WHERE into SQL so only that tenant's
 *  rows are read and OPENJSON runs on a small result set instead of the whole
 *  table. Use this for every non-superadmin request (or superadmin scoped to
 *  one company) — typically 10-50 rows vs thousands for the unfiltered query. */
export async function getOnboardingHistorySlimByTenant(
  tenantId: string,
): Promise<OnboardingHistorySlimRow[]> {
  const r = await req();
  // Jobs store the human company LABEL ("Acme Construction") while callers may
  // hold the normalized login-tenant key ("acme_construction"). Match exactly
  // first (index/seek-friendly), then fall back to the same normalization the
  // API layer uses (lowercase, spaces→underscores) so both forms find the
  // company's rows. The table is small and the warnings expression only runs
  // on matching rows, so the normalized scan is cheap.
  const norm = tenantId.trim().replace(/\s+/g, "_").toLowerCase();
  r.input("tid", mssql.NVarChar, tenantId);
  r.input("tidNorm", mssql.NVarChar, norm);
  const res = await r.query(`
    SELECT ${_HISTORY_SLIM_BASE_COLS},
           ${_HISTORY_SLIM_WARNINGS_COL}
    FROM   dbo.rmone_onboarding_jobs WITH (NOLOCK)
    WHERE  tenant_id = @tid
       OR  LOWER(REPLACE(LTRIM(RTRIM(tenant_id)), ' ', '_')) = @tidNorm
    ORDER  BY created_at DESC
  `);
  return res.recordset.map(_mapHistorySlimRow);
}

// Meta-only fetch of jobs still pending/running — the cross-worker fallback for
// the /active poll. A job started on the OTHER cluster worker is invisible in
// this worker's in-memory map, so without a DB check the "import running"
// banner flickers on/off as polls alternate between workers. Excludes the
// file_data blob so the poll stays cheap; normally returns 0-2 rows.
export async function getRunningOnboardingJobsMeta(): Promise<OnboardingJobRow[]> {
  const r = await req();
  const res = await r.query(`
    SELECT upload_id, tenant_id, file_name, s3_key, status, created_by,
           created_at, updated_at, total_inserted, total_errors, import_mode,
           error_detail, summary, column_mapping, result, sheets,
           forced_tab_type, forced_record_type
    FROM   dbo.rmone_onboarding_jobs WITH (NOLOCK)
    WHERE  status IN ('pending','running')
    ORDER  BY created_at DESC
  `);
  return res.recordset.map(r2 => ({ ...mapJob(r2), fileData: null }));
}

// Conditionally fail a job ONLY while it is still pending/running — the
// ghost sweeps use this so a pipeline that finishes between their staleness
// scan and this UPDATE keeps its real terminal status (the WHERE clause
// makes the flip a no-op instead of stomping success/partial/cancelled).
// Returns true when the row was actually flipped.
export async function failOnboardingJobIfActive(uploadId: string, errorDetail: string): Promise<boolean> {
  const r = await req();
  r.input("id",  mssql.NVarChar, uploadId);
  r.input("err", mssql.NVarChar, errorDetail);
  const res = await r.query(
    `UPDATE dbo.rmone_onboarding_jobs
     SET status='failed', error_detail=@err, updated_at=GETUTCDATE()
     WHERE upload_id=@id AND status IN ('pending','running')`,
  );
  return (res.rowsAffected?.[0] ?? 0) > 0;
}

// Fetch ONLY the raw uploaded-file bytes for one onboarding job, decoded to
// binary ON the SQL Server. file_data is base64 text in an NVARCHAR(MAX)
// column, so selecting it as text ships ~2.7x the real file size over the
// wire (UTF-16 base64: a 55 MB upload = ~155 MB of TDS traffic, ~23 s on the
// remote link). Decoding to VARBINARY(MAX) server-side sends only the true
// bytes (~30% faster) and skips the Node-side Buffer.from(base64) pass over
// a 77-million-char string. Returns null when the job or its file is absent.
export async function getOnboardingJobFileBin(uploadId: string): Promise<Buffer | null> {
  const r = await req();
  r.input("id", mssql.NVarChar, uploadId);
  const res = await r.query(`
    SELECT CAST(N'' AS XML).value('xs:base64Binary(sql:column("j.file_data"))', 'VARBINARY(MAX)') AS fileBin
    FROM dbo.rmone_onboarding_jobs j
    WHERE j.upload_id = @id
  `);
  const bin: Buffer | null = res.recordset[0]?.fileBin ?? null;
  return bin && bin.length > 0 ? bin : null;
}

export async function getOnboardingJob(uploadId: string): Promise<OnboardingJobRow | null> {
  const r = await req();
  r.input("id", mssql.NVarChar, uploadId);
  const res = await r.query("SELECT TOP 1 * FROM dbo.rmone_onboarding_jobs WHERE upload_id=@id");
  return res.recordset[0] ? mapJob(res.recordset[0]) : null;
}

// Single-job variant of getAllOnboardingJobsMeta: everything except the
// file_data blob (raw Excel upload, potentially tens of MB base64).  Used by
// hot paths like the status-poll DB fallback where the file bytes are never
// needed and fetching them would make every poll pay the slow-blob cost.
export async function getOnboardingJobMeta(uploadId: string): Promise<OnboardingJobRow | null> {
  const r = await req();
  r.input("id", mssql.NVarChar, uploadId);
  const res = await r.query(`
    SELECT TOP 1 upload_id, tenant_id, file_name, s3_key, status, created_by,
           created_at, updated_at, total_inserted, total_errors, import_mode,
           error_detail, summary, column_mapping, result, sheets,
           forced_tab_type, forced_record_type
    FROM   dbo.rmone_onboarding_jobs
    WHERE  upload_id=@id
  `);
  return res.recordset[0] ? { ...mapJob(res.recordset[0]), fileData: null } : null;
}

export async function upsertOnboardingJob(data: Partial<OnboardingJobRow> & { uploadId: string; tenantId: string; fileName: string }): Promise<boolean> {
  const r = await req();
  r.input("uid",  mssql.NVarChar, data.uploadId);
  r.input("tid",  mssql.NVarChar, data.tenantId);
  r.input("fn",   mssql.NVarChar, data.fileName);
  r.input("s3",   mssql.NVarChar, data.s3Key ?? null);
  r.input("st",   mssql.NVarChar, data.status ?? "pending");
  r.input("cb",   mssql.NVarChar, data.createdBy ?? null);
  r.input("ti",   mssql.Int, data.totalInserted ?? null);
  r.input("te",   mssql.Int, data.totalErrors ?? null);
  r.input("mode", mssql.NVarChar, data.importMode ?? null);
  r.input("fd",   mssql.NVarChar, data.fileData ?? null);
  r.input("err",  mssql.NVarChar, data.errorDetail ?? null);
  r.input("sum",  mssql.NVarChar, data.summary ?? null);
  r.input("cm",   mssql.NVarChar, data.columnMapping ?? null);
  r.input("res",  mssql.NVarChar, data.result ?? null);
  r.input("sh",   mssql.NVarChar, data.sheets ?? null);
  r.input("ftt",  mssql.NVarChar, data.forcedTabType ?? null);
  r.input("frt",  mssql.NVarChar, data.forcedRecordType ?? null);
  // CAS fence: once a row is terminal (success/failed/cancelled) the ONLY
  // update this upsert may perform is one that keeps the SAME status (e.g.
  // enriching a cancelled row's result message after rollback). Any write that
  // would TRANSITION a terminal status — a zombie pipeline's late "success", a
  // sibling's late "failed" over a user's "cancelled" — is silently refused
  // and reported via the return value so the caller can converge on DB truth.
  const res = await r.query(`
    MERGE dbo.rmone_onboarding_jobs AS T
    USING (SELECT @uid AS u) AS S ON T.upload_id=S.u
    WHEN MATCHED AND (T.status IN ('pending','running') OR T.status=@st)
      THEN UPDATE SET tenant_id=@tid,file_name=@fn,s3_key=@s3,status=@st,
      total_inserted=@ti,total_errors=@te,import_mode=@mode,
      file_data=COALESCE(@fd,file_data),
      error_detail=@err,summary=@sum,column_mapping=@cm,result=@res,sheets=@sh,
      forced_tab_type=COALESCE(@ftt,forced_tab_type),forced_record_type=COALESCE(@frt,forced_record_type),
      updated_at=GETUTCDATE()
    WHEN NOT MATCHED THEN INSERT (upload_id,tenant_id,file_name,s3_key,status,created_by,
      total_inserted,total_errors,import_mode,file_data,error_detail,summary,column_mapping,result,sheets,forced_tab_type,forced_record_type)
      VALUES (@uid,@tid,@fn,@s3,@st,@cb,@ti,@te,@mode,@fd,@err,@sum,@cm,@res,@sh,@ftt,@frt);
  `);
  return (res.rowsAffected?.[0] ?? 0) > 0;
}

export async function updateOnboardingJob(uploadId: string, patch: Partial<Pick<OnboardingJobRow,
  "status" | "totalInserted" | "totalErrors" | "errorDetail" | "summary" | "columnMapping" | "importMode" | "fileName"
>>): Promise<void> {
  const sets: string[] = ["updated_at=GETUTCDATE()"];
  const r = await req();
  r.input("uid", mssql.NVarChar, uploadId);
  if ("status"        in patch) { r.input("p_st",  mssql.NVarChar, patch.status ?? null);        sets.push("status=@p_st"); }
  if ("totalInserted" in patch) { r.input("p_ti",  mssql.Int, patch.totalInserted ?? null);       sets.push("total_inserted=@p_ti"); }
  if ("totalErrors"   in patch) { r.input("p_te",  mssql.Int, patch.totalErrors ?? null);         sets.push("total_errors=@p_te"); }
  if ("errorDetail"   in patch) { r.input("p_err", mssql.NVarChar, patch.errorDetail ?? null);    sets.push("error_detail=@p_err"); }
  if ("summary"       in patch) { r.input("p_sum", mssql.NVarChar, patch.summary ?? null);        sets.push("summary=@p_sum"); }
  if ("columnMapping" in patch) { r.input("p_cm",  mssql.NVarChar, patch.columnMapping ?? null);  sets.push("column_mapping=@p_cm"); }
  if ("importMode"    in patch) { r.input("p_im",  mssql.NVarChar, patch.importMode ?? null);     sets.push("import_mode=@p_im"); }
  if ("fileName"      in patch) { r.input("p_fn",  mssql.NVarChar, patch.fileName ?? null);       sets.push("file_name=@p_fn"); }
  await r.query(`UPDATE dbo.rmone_onboarding_jobs SET ${sets.join(",")} WHERE upload_id=@uid`);
}

export async function deleteOnboardingJobsBatch(uploadIds: string[]): Promise<void> {
  if (!uploadIds.length) return;
  for (let i = 0; i < uploadIds.length; i += 200) {
    const chunk = uploadIds.slice(i, i + 200);
    const r = await req();
    const { clause, inputs } = inList(chunk, "j");
    Object.entries(inputs).forEach(([k, v]) => r.input(k, mssql.NVarChar, v));
    await r.query(`DELETE FROM dbo.rmone_onboarding_jobs WHERE upload_id IN (${clause})`);
  }
}

// Boot-time orphan reconcile. CRITICAL: this must NEVER blanket-fail every
// "running" row — in production the API runs as multiple autoscale instances,
// and a NEW instance booting mid-import used to mark the live run (owned by a
// sibling instance) as failed. The owner's next status write flipped it back,
// so users saw a false "Import failed: session disconnected" flicker — and
// cancel/delete acting on the falsely-failed row could roll back data under a
// live pipeline. The pipeline heartbeats updated_at every ~60s, so only rows
// whose last write is older than the threshold are genuinely orphaned.
//
// "pending" rows are included with the same staleness gate: a worker killed
// (e.g. OOM during a deploy) between /run and the pending→running promotion
// strands the row in "pending" forever — no heartbeat ever starts, the boot
// warm skips it, and GET /active keeps surfacing it to the tenant. The
// GET /active sweep already fails stale pending rows with this exact window
// (getRunningOnboardingJobsMeta returns both statuses), so this only makes
// boot behave the same when nobody is polling. A user legitimately parked on
// the mapping screen is unaffected within the window, and past it the /active
// sweep would have failed the row anyway.
/**
 * Count imports currently running against the shared RDS instance, across ALL
 * environments (dev + prod share this jobs table). "Running" rows with a
 * fresh heartbeat (updated_at bumped every 60s by the owning process) are
 * live; anything staler is a dead owner. Used to give live imports pool
 * priority — background warm sweeps skip while this is > 0.
 */
export async function countActiveOnboardingImports(freshMinutes = 3): Promise<number> {
  const mins = Math.max(1, Math.floor(Number(freshMinutes) || 3));
  const r = await req();
  const res = await r.query(
    `SELECT COUNT(*) AS n FROM dbo.rmone_onboarding_jobs WITH (NOLOCK)
     WHERE status='running' AND updated_at > DATEADD(minute, -${mins}, GETUTCDATE())`,
  );
  return Number(res.recordset[0]?.n ?? 0);
}

export async function resetAllRunningOnboardingJobs(errorMessage: string, staleMinutes = 15): Promise<number> {
  const r = await req();
  r.input("msg", mssql.NVarChar, JSON.stringify({ error: errorMessage }));
  r.input("mins", mssql.Int, staleMinutes);
  const res = await r.query(
    `UPDATE dbo.rmone_onboarding_jobs SET status='failed',result=@msg,updated_at=GETUTCDATE()
     WHERE status IN ('running','pending')
       AND COALESCE(updated_at, created_at) < DATEADD(minute, -@mins, GETUTCDATE())`,
  );
  return res.rowsAffected?.[0] ?? 0;
}

// ── Owner-scoped job lifecycle ───────────────────────────────────────────────
// Each cluster worker is forked with a unique OWNER_TOKEN; /run stamps it on
// the job row when the pipeline starts. When a worker dies, the primary hands
// the dead worker's token to ONE surviving worker, which fails ONLY that
// token's jobs — never a live run owned by another process or instance.
// (The old approach — a global short-staleness sweep on any worker death —
// falsely failed LIVE imports whose best-effort heartbeat lapsed under the
// same memory duress that killed the sibling worker, leaving the still-running
// pipeline behind as a zombie writer.)
export async function stampOnboardingJobOwner(uploadId: string, ownerToken: string): Promise<void> {
  const r = await req();
  r.input("uid", mssql.NVarChar, uploadId);
  r.input("tok", mssql.NVarChar, ownerToken);
  await r.query("UPDATE dbo.rmone_onboarding_jobs SET owner_token=@tok, updated_at=GETUTCDATE() WHERE upload_id=@uid");
}

export async function failOnboardingJobsByOwner(ownerToken: string, errorMessage: string): Promise<number> {
  const r = await req();
  r.input("tok", mssql.NVarChar, ownerToken);
  r.input("msg", mssql.NVarChar, JSON.stringify({ error: errorMessage }));
  const res = await r.query(
    `UPDATE dbo.rmone_onboarding_jobs SET status='failed',result=@msg,updated_at=GETUTCDATE()
     WHERE status IN ('running','pending') AND owner_token=@tok`,
  );
  return res.rowsAffected?.[0] ?? 0;
}

// Crash-reconcile candidates: the dead worker's recent terminal CREATE-mode
// jobs. A worker can die BETWEEN cancel/failure detection and its rollback,
// stranding partial rows behind a terminal row the fence rightly protects.
// Only tenants with NO live run qualify — a newer import may legitimately
// own the tenant's data by now.
export interface CrashReconcileCandidate {
  uploadId: string;
  status: string;
  tenantId: string;
  importMode: string | null;
}
export async function getCrashReconcileCandidates(ownerToken: string): Promise<CrashReconcileCandidate[]> {
  const r = await req();
  r.input("tok", mssql.NVarChar, ownerToken);
  const res = await r.query(
    `SELECT upload_id, status, tenant_id, import_mode
     FROM dbo.rmone_onboarding_jobs j
     WHERE owner_token=@tok AND status IN ('failed','cancelled') AND import_mode='create'
       AND updated_at > DATEADD(hour, -6, GETUTCDATE())
       AND NOT EXISTS (SELECT 1 FROM dbo.rmone_onboarding_jobs j2
                       WHERE j2.tenant_id=j.tenant_id AND j2.status IN ('running','pending'))`,
  );
  return res.recordset.map((x: Record<string, unknown>) => ({
    uploadId:   String(x["upload_id"]),
    status:     String(x["status"]),
    tenantId:   String(x["tenant_id"]),
    importMode: (x["import_mode"] as string | null) ?? null,
  }));
}

// CAS-safe result enrichment: rewrites ONLY the message of a row still in the
// expected terminal status (never the status itself). Used after a post-crash
// rollback so the user sees what happened to the partial rows.
export async function updateOnboardingJobResultIfStatus(
  uploadId: string, expectedStatus: string, result: unknown,
): Promise<boolean> {
  const r = await req();
  r.input("uid", mssql.NVarChar, uploadId);
  r.input("st",  mssql.NVarChar, expectedStatus);
  r.input("msg", mssql.NVarChar, JSON.stringify(result));
  const res = await r.query(
    `UPDATE dbo.rmone_onboarding_jobs SET result=@msg, updated_at=GETUTCDATE()
     WHERE upload_id=@uid AND status=@st`,
  );
  return (res.rowsAffected?.[0] ?? 0) > 0;
}

// Authoritative live-run probe for DESTRUCTIVE decisions (rollback gating).
// Deliberately a plain locking read — never NOLOCK — and callers must treat
// a thrown error as "assume a live run exists" (fail closed).
export async function hasActiveOnboardingRun(tenantLabel: string, excludeUploadId?: string): Promise<boolean> {
  const r = await req();
  r.input("t",   mssql.NVarChar, tenantLabel.trim().toLowerCase());
  r.input("own", mssql.NVarChar, excludeUploadId ?? "");
  const res = await r.query(
    `SELECT COUNT(*) AS n FROM dbo.rmone_onboarding_jobs
     WHERE status IN ('running','pending') AND upload_id <> @own
       AND LOWER(LTRIM(RTRIM(tenant_id))) = @t`,
  );
  return Number(res.recordset?.[0]?.n ?? 0) > 0;
}

// Tenant-exclusive import/rollback lease via sp_getapplock. The lock is
// Transaction-owned on a dedicated pinned connection, so release() simply
// rolls the (otherwise empty) transaction back. Used to serialize tenant-wide
// rollbacks against each other AND against a starting import's first writes:
// * rollback paths acquire it around (live-run check + tombstone writes);
// * runPipeline bounce-acquires it before its first tenant write, so a
//   mid-flight rollback finishes before fresh rows exist to tombstone, and
//   the run's own running row (persisted earlier) makes later rollbacks skip.
// Returns null when the lock cannot be acquired in time — callers fail closed.
export interface TenantImportLease { release: () => Promise<void>; }
export async function acquireTenantImportLease(
  tenantLabel: string, timeoutMs = 15_000,
): Promise<TenantImportLease | null> {
  await bootstrapDatabase();
  const pool = await getMssqlPool();
  const tx = new mssql.Transaction(pool);
  await tx.begin();
  try {
    const rq = new mssql.Request(tx);
    rq.input("res", mssql.NVarChar, `rmone-import:${tenantLabel.trim().toLowerCase()}`);
    rq.input("t",   mssql.Int, timeoutMs);
    const r = await rq.query(
      `DECLARE @rc int;
       EXEC @rc = sp_getapplock @Resource=@res, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=@t;
       SELECT @rc AS rc;`,
    );
    const rc = Number(r.recordset?.[0]?.rc ?? -999);
    if (rc < 0) {
      await tx.rollback().catch(() => {});
      return null;
    }
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        await tx.rollback().catch(() => {});
      },
    };
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

// Tiny single-row status probe — used by the run-side heartbeat to notice when
// another process flipped this job failed/cancelled, so the owning pipeline
// can abort at its next checkpoint instead of running on as a zombie.
export async function getOnboardingJobDbStatus(uploadId: string): Promise<string | null> {
  const r = await req();
  r.input("uid", mssql.NVarChar, uploadId);
  const res = await r.query("SELECT status FROM dbo.rmone_onboarding_jobs WITH (NOLOCK) WHERE upload_id=@uid");
  return (res.recordset[0]?.status as string | undefined) ?? null;
}

// Cross-process cancel: flip the DB row to "cancelled" so the OWNING pipeline
// (which polls the status every ~60s) aborts at its next checkpoint. Guarded
// to running/pending so it can never demote a terminal status.
export async function cancelOnboardingJobInDb(uploadId: string, message: string): Promise<boolean> {
  const r = await req();
  r.input("uid", mssql.NVarChar, uploadId);
  r.input("msg", mssql.NVarChar, JSON.stringify({ fatalError: message }));
  const res = await r.query(
    `UPDATE dbo.rmone_onboarding_jobs SET status='cancelled',result=@msg,updated_at=GETUTCDATE()
     WHERE upload_id=@uid AND status IN ('running','pending')`,
  );
  return (res.rowsAffected?.[0] ?? 0) > 0;
}

// Conditional pending→running promotion. Used by /run to make the DB reflect
// "running" even while the initial multi-MB file-blob INSERT is still in
// flight (that INSERT may have captured status="pending" before /run flipped
// it). The WHERE guard means this can only ever promote a pending row — it
// can never demote a terminal (success/failed/cancelled) status, so retrying
// it is safe in every interleaving with the per-upload persist chain.
export async function promotePendingOnboardingJob(
  uploadId: string,
  opts?: { reviveGhostMessages?: string[] },
): Promise<boolean> {
  const r = await req();
  r.input("uid", mssql.NVarChar, uploadId);
  // reviveGhostMessages: /run passes the ghost-sweep auto-cancel texts for a
  // run it OWNS — a row the sweep flipped to 'failed' can be legitimately
  // revived by a late "Run" click, and without lifting it here the DB row
  // would stay failed for the whole run (letting other workers admit a
  // second concurrent import for the tenant). The error_detail equality is
  // the provenance guard (code-review catch): ONLY sweep-expired rows are
  // revivable — a genuine pipeline failure persists its own error_detail,
  // so the detached promotion retry racing terminal finalization can never
  // flip a real failure back to running. 'cancelled' (a real user decision)
  // and terminal success states are never lifted.
  let failedClause = "";
  (opts?.reviveGhostMessages ?? []).forEach((m, i) => {
    r.input(`g${i}`, mssql.NVarChar, m);
    failedClause += `${i === 0 ? "" : " OR "}error_detail=@g${i}`;
  });
  const where = failedClause
    ? `(status='pending' OR (status='failed' AND (${failedClause})))`
    : "status='pending'";
  const res = await r.query(
    `UPDATE dbo.rmone_onboarding_jobs SET status='running',updated_at=GETUTCDATE() WHERE upload_id=@uid AND ${where}`,
  );
  return (res.rowsAffected?.[0] ?? 0) > 0;
}


// ── UPLOAD CHUNKS ──────────────────────────────────────────────────────────
// Chunked large-file uploads. The hosting edge caps any single HTTP request
// at ~32MB in production, so big files are sent as sequential ~20MB pieces
// and reassembled server-side. Chunks live in SQL Server (NOT local disk or
// memory) because the API runs as multiple cluster workers across multiple
// autoscale instances — consecutive chunk requests can land anywhere.
// owner_key binds a session to the uploading user+tenant so nobody can
// complete (or poison) someone else's upload session.

export async function insertUploadChunk(sessionId: string, seq: number, ownerKey: string, data: Buffer): Promise<void> {
  const r = await req();
  r.input("sid", mssql.NVarChar, sessionId);
  r.input("seq", mssql.Int, seq);
  r.input("own", mssql.NVarChar, ownerKey);
  r.input("d",   mssql.VarBinary(mssql.MAX), data);
  // MERGE (upsert) so a client-side retry of the same chunk is harmless.
  // The owner check on MATCHED prevents overwriting another user's chunk if
  // two sessions ever collide on the same id.
  await r.query(`
    MERGE dbo.rmone_upload_chunks AS T
    USING (SELECT @sid AS s, @seq AS q) AS S ON T.session_id=S.s AND T.seq=S.q
    WHEN MATCHED AND T.owner_key=@own THEN UPDATE SET data=@d, created_at=GETUTCDATE()
    WHEN NOT MATCHED THEN INSERT (session_id, seq, owner_key, data) VALUES (@sid, @seq, @own, @d);
  `);
}

// Reassemble a session's chunks in order. Returns null when no chunks exist
// for this session+owner. buffer is null when the sequence has gaps (e.g. a
// missing piece) — callers compare count with the expected total for the
// user-facing error.
export async function assembleUploadChunks(sessionId: string, ownerKey: string): Promise<{ buffer: Buffer | null; count: number } | null> {
  const r = await req();
  r.input("sid", mssql.NVarChar, sessionId);
  r.input("own", mssql.NVarChar, ownerKey);
  const res = await r.query(`
    SELECT seq, data FROM dbo.rmone_upload_chunks
    WHERE session_id=@sid AND owner_key=@own
    ORDER BY seq ASC
  `);
  const rows = res.recordset as Array<{ seq: number; data: Buffer }>;
  if (!rows.length) return null;
  const contiguous = rows.every((row, i) => row.seq === i);
  return {
    count: rows.length,
    buffer: contiguous ? Buffer.concat(rows.map(row => row.data)) : null,
  };
}

export async function deleteUploadChunks(sessionId: string): Promise<void> {
  const r = await req();
  r.input("sid", mssql.NVarChar, sessionId);
  await r.query("DELETE FROM dbo.rmone_upload_chunks WHERE session_id=@sid");
}

// Total bytes currently stored for a session (owner-scoped). Used to enforce
// a running per-session cap at chunk-insert time so an authenticated user
// cannot park unbounded data in the chunk table across many pieces.
export async function sumUploadChunkBytes(sessionId: string, ownerKey: string): Promise<number> {
  const r = await req();
  r.input("sid", mssql.NVarChar, sessionId);
  r.input("own", mssql.NVarChar, ownerKey);
  const res = await r.query(`
    SELECT COALESCE(SUM(CAST(DATALENGTH(data) AS BIGINT)), 0) AS total
    FROM dbo.rmone_upload_chunks
    WHERE session_id=@sid AND owner_key=@own
  `);
  return Number(res.recordset[0]?.total ?? 0);
}

// Abandoned sessions (browser closed mid-upload) are swept opportunistically
// whenever a new chunked upload completes. 2h is far beyond any real upload.
export async function deleteStaleUploadChunks(): Promise<void> {
  const r = await req();
  await r.query("DELETE FROM dbo.rmone_upload_chunks WHERE created_at < DATEADD(hour, -2, GETUTCDATE())");
}

// ── ONBOARDING TEMPLATES ───────────────────────────────────────────────────

export interface OnboardingTemplateRow {
  id: number;
  tenantKey: string;
  tenantLabel: string;
  name: string | null;
  mapping: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

function mapTemplate(r: Record<string, unknown>): OnboardingTemplateRow {
  return {
    id:          Number(r.id ?? 0),
    tenantKey:   String(r.tenant_key ?? ""),
    tenantLabel: String(r.tenant_label ?? ""),
    name:        (r.name as string | null) ?? null,
    mapping:     jParse<Record<string, unknown>>(r.mapping as string, {}),
    createdAt:   r.created_at instanceof Date ? r.created_at : new Date(),
    updatedAt:   r.updated_at instanceof Date ? r.updated_at : new Date(),
  };
}

export async function getOnboardingTemplates(tenantKey: string): Promise<OnboardingTemplateRow[]> {
  const r = await req();
  r.input("tk", mssql.NVarChar, tenantKey);
  const res = await r.query("SELECT * FROM dbo.rmone_onboarding_templates WHERE tenant_key=@tk");
  return res.recordset.map(mapTemplate);
}

export async function upsertOnboardingTemplate(data: { tenantKey: string; tenantLabel: string; name?: string | null; mapping: Record<string, unknown> }): Promise<void> {
  const r = await req();
  r.input("tk",   mssql.NVarChar, data.tenantKey);
  r.input("tl",   mssql.NVarChar, data.tenantLabel);
  r.input("name", mssql.NVarChar, data.name ?? null);
  r.input("map",  mssql.NVarChar, JSON.stringify(data.mapping));
  await r.query(`
    MERGE dbo.rmone_onboarding_templates AS T
    USING (SELECT @tk AS k) AS S ON T.tenant_key=S.k
    WHEN MATCHED THEN UPDATE SET tenant_label=@tl,name=@name,mapping=@map,updated_at=GETUTCDATE()
    WHEN NOT MATCHED THEN INSERT (tenant_key,tenant_label,name,mapping) VALUES (@tk,@tl,@name,@map);
  `);
}

// ── ONBOARDING EXTRA FIELDS ────────────────────────────────────────────────

export interface OnboardingExtraFieldRow {
  id: number;
  tenantKey: string;
  tenantLabel: string;
  entityType: string;
  naturalKey: string;
  recordLabel: string;
  fieldName: string;
  value: string | null;
  sheetName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapExtraField(r: Record<string, unknown>): OnboardingExtraFieldRow {
  return {
    id:          Number(r.id ?? 0),
    tenantKey:   String(r.tenant_key ?? ""),
    tenantLabel: String(r.tenant_label ?? ""),
    entityType:  String(r.entity_type ?? ""),
    naturalKey:  String(r.natural_key ?? ""),
    recordLabel: String(r.record_label ?? ""),
    fieldName:   String(r.field_name ?? ""),
    value:       (r.value as string | null) ?? null,
    sheetName:   (r.sheet_name as string | null) ?? null,
    createdAt:   r.created_at instanceof Date ? r.created_at : new Date(),
    updatedAt:   r.updated_at instanceof Date ? r.updated_at : new Date(),
  };
}

export async function getOnboardingExtraFields(tenantKey: string): Promise<OnboardingExtraFieldRow[]> {
  const r = await req();
  r.input("tk", mssql.NVarChar, tenantKey);
  const res = await r.query("SELECT * FROM dbo.rmone_onboarding_extra_fields WHERE tenant_key=@tk ORDER BY entity_type,natural_key,field_name");
  return res.recordset.map(mapExtraField);
}

export async function upsertOnboardingExtraFieldsBatch(rows: Omit<OnboardingExtraFieldRow, "id" | "createdAt" | "updatedAt">[]): Promise<void> {
  for (const row of rows) {
    const r = await req();
    r.input("tk",  mssql.NVarChar, row.tenantKey);
    r.input("tl",  mssql.NVarChar, row.tenantLabel);
    r.input("et",  mssql.NVarChar, row.entityType);
    r.input("nk",  mssql.NVarChar, row.naturalKey);
    r.input("rl",  mssql.NVarChar, row.recordLabel);
    r.input("fn",  mssql.NVarChar, row.fieldName);
    r.input("val", mssql.NVarChar, row.value ?? null);
    r.input("sn",  mssql.NVarChar, row.sheetName ?? null);
    await r.query(`
      MERGE dbo.rmone_onboarding_extra_fields AS T
      USING (SELECT @tk AS tk,@et AS et,@nk AS nk,@fn AS fn) AS S
        ON T.tenant_key=S.tk AND T.entity_type=S.et AND T.natural_key=S.nk AND T.field_name=S.fn
      WHEN MATCHED THEN UPDATE SET tenant_label=@tl,record_label=@rl,value=@val,sheet_name=@sn,updated_at=GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (tenant_key,tenant_label,entity_type,natural_key,record_label,field_name,value,sheet_name)
        VALUES (@tk,@tl,@et,@nk,@rl,@fn,@val,@sn);
    `);
  }
}

export async function updateOnboardingExtraField(
  tenantKey: string, entityType: string, naturalKey: string, fieldName: string, value: string | null,
): Promise<OnboardingExtraFieldRow | null> {
  const r = await req();
  r.input("tk",  mssql.NVarChar, tenantKey);
  r.input("et",  mssql.NVarChar, entityType);
  r.input("nk",  mssql.NVarChar, naturalKey);
  r.input("fn",  mssql.NVarChar, fieldName);
  r.input("val", mssql.NVarChar, value ?? null);
  const res = await r.query(`
    UPDATE dbo.rmone_onboarding_extra_fields
    SET value=@val,updated_at=GETUTCDATE()
    OUTPUT INSERTED.*
    WHERE tenant_key=@tk AND entity_type=@et AND natural_key=@nk AND field_name=@fn
  `);
  return res.recordset[0] ? mapExtraField(res.recordset[0]) : null;
}

export async function deleteOnboardingExtraField(
  tenantKey: string, entityType: string, naturalKey: string, fieldName: string,
): Promise<void> {
  const r = await req();
  r.input("tk", mssql.NVarChar, tenantKey);
  r.input("et", mssql.NVarChar, entityType);
  r.input("nk", mssql.NVarChar, naturalKey);
  r.input("fn", mssql.NVarChar, fieldName);
  await r.query(
    "DELETE FROM dbo.rmone_onboarding_extra_fields WHERE tenant_key=@tk AND entity_type=@et AND natural_key=@nk AND field_name=@fn",
  );
}

// ── ONBOARDING DEFAULT SETTINGS ────────────────────────────────────────────

export interface OnboardingDefaultSettingsRow {
  id: number;
  scope: string;
  label: string | null;
  settings: Record<string, unknown>;
  /** Raw stored JSON text — CAS token for updateOnboardingSettingsGuarded. */
  settingsRaw?: string;
  createdAt: Date;
  updatedAt: Date;
}

function mapSettings(r: Record<string, unknown>): OnboardingDefaultSettingsRow {
  return {
    id:        Number(r.id ?? 0),
    scope:     String(r.scope ?? ""),
    label:     (r.label as string | null) ?? null,
    settings:  jParse<Record<string, unknown>>(r.settings as string, {}),
    settingsRaw: typeof r.settings === "string" ? r.settings : "{}",
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(),
    updatedAt: r.updated_at instanceof Date ? r.updated_at : new Date(),
  };
}

export async function getOnboardingSettings(scope: string): Promise<OnboardingDefaultSettingsRow | null> {
  const r = await req();
  r.input("scope", mssql.NVarChar, scope);
  const res = await r.query("SELECT TOP 1 * FROM dbo.rmone_onboarding_default_settings WHERE scope=@scope");
  return res.recordset[0] ? mapSettings(res.recordset[0]) : null;
}

export async function upsertOnboardingSettings(data: { scope: string; label?: string | null; settings: Record<string, unknown> }): Promise<void> {
  const r = await req();
  r.input("scope",  mssql.NVarChar, data.scope);
  r.input("label",  mssql.NVarChar, data.label ?? null);
  r.input("setts",  mssql.NVarChar, JSON.stringify(data.settings));
  await r.query(`
    MERGE dbo.rmone_onboarding_default_settings AS T
    USING (SELECT @scope AS s) AS S ON T.scope=S.s
    WHEN MATCHED THEN UPDATE SET label=@label,settings=@setts,updated_at=GETUTCDATE()
    WHEN NOT MATCHED THEN INSERT (scope,label,settings) VALUES (@scope,@label,@setts);
  `);
}

/** Atomic settings write for audit-sensitive callers. The row/range lock keeps
 * the returned before and after JSON tied to this exact mutation, even when two
 * admins save the same document concurrently. */
export async function upsertOnboardingSettingsWithSnapshots(data: {
  scope: string;
  label?: string | null;
  settings: Record<string, unknown>;
}): Promise<{ before: Record<string, unknown> | null; after: Record<string, unknown> }> {
  return withTransaction(async (r) => {
    r.input("scope", mssql.NVarChar, data.scope);
    r.input("label", mssql.NVarChar, data.label ?? null);
    r.input("setts", mssql.NVarChar, JSON.stringify(data.settings));
    const out = await r.query(`
      DECLARE @before NVARCHAR(MAX) = NULL;
      SELECT @before=settings
        FROM dbo.rmone_onboarding_default_settings WITH (UPDLOCK, HOLDLOCK)
        WHERE scope=@scope;
      MERGE dbo.rmone_onboarding_default_settings WITH (HOLDLOCK) AS T
      USING (SELECT @scope AS s) AS S ON T.scope=S.s
      WHEN MATCHED THEN UPDATE SET label=@label,settings=@setts,updated_at=GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (scope,label,settings) VALUES (@scope,@label,@setts);
      SELECT @before AS beforeJson, settings AS afterJson
        FROM dbo.rmone_onboarding_default_settings
        WHERE scope=@scope;
    `);
    const row = (out.recordset?.[0] ?? {}) as Record<string, unknown>;
    return {
      before: row.beforeJson == null ? null : jParse<Record<string, unknown>>(String(row.beforeJson), {}),
      after: jParse<Record<string, unknown>>(String(row.afterJson ?? "{}"), {}),
    };
  });
}

/** Compare-and-swap variant of upsertOnboardingSettings. Applies ONLY when the
 *  stored row still carries exactly the JSON text the caller read (or is still
 *  absent, when expectedSettingsRaw is null). Returns false when a concurrent
 *  writer got there first, so the caller can re-read, re-check its guards and
 *  retry — the import pipeline's display-mode auto-select uses this so a
 *  simultaneous admin Settings save can never be clobbered by a stale read.
 *  Binary collation makes the comparison byte-exact (the default CI collation
 *  would treat two JSON blobs differing only in letter case as equal). The
 *  updated_at CAS alternative is a trap here: GETUTCDATE() is DATETIME
 *  converted into a DATETIME2 column, whose .0033333-style tails don't
 *  round-trip through a millisecond JS Date. */
export async function updateOnboardingSettingsGuarded(data: {
  scope: string;
  label?: string | null;
  settings: Record<string, unknown>;
  /** settingsRaw from the row the caller read, or null when no row existed. */
  expectedSettingsRaw: string | null;
}): Promise<boolean> {
  const r = await req();
  r.input("scope", mssql.NVarChar, data.scope);
  r.input("label", mssql.NVarChar, data.label ?? null);
  r.input("setts", mssql.NVarChar, JSON.stringify(data.settings));
  if (data.expectedSettingsRaw === null) {
    const res = await r.query(`
      INSERT INTO dbo.rmone_onboarding_default_settings (scope,label,settings)
      SELECT @scope,@label,@setts
      WHERE NOT EXISTS (SELECT 1 FROM dbo.rmone_onboarding_default_settings WHERE scope=@scope);
    `);
    return (res.rowsAffected[0] ?? 0) > 0;
  }
  r.input("expected", mssql.NVarChar, data.expectedSettingsRaw);
  const res = await r.query(`
    UPDATE dbo.rmone_onboarding_default_settings
       SET label=@label, settings=@setts, updated_at=GETUTCDATE()
     WHERE scope=@scope
       AND settings COLLATE Latin1_General_BIN2 = @expected COLLATE Latin1_General_BIN2;
  `);
  return (res.rowsAffected[0] ?? 0) > 0;
}

/** Remove a settings row entirely (e.g. a per-record stage-rules override
 *  being reset to the company-wide document). Returns true when a row was
 *  actually deleted, false when the scope had no row. */
export async function deleteOnboardingSettings(scope: string): Promise<boolean> {
  const r = await req();
  r.input("scope", mssql.NVarChar, scope);
  const res = await r.query("DELETE FROM dbo.rmone_onboarding_default_settings WHERE scope=@scope");
  return (res.rowsAffected[0] ?? 0) > 0;
}

export async function deleteOnboardingSettingsWithSnapshots(
  scope: string,
): Promise<{ deleted: boolean; before: Record<string, unknown> | null; after: null }> {
  return withTransaction(async (r) => {
    r.input("scope", mssql.NVarChar, scope);
    const out = await r.query(`
      DECLARE @before NVARCHAR(MAX) = NULL;
      SELECT @before=settings
        FROM dbo.rmone_onboarding_default_settings WITH (UPDLOCK, HOLDLOCK)
        WHERE scope=@scope;
      DELETE FROM dbo.rmone_onboarding_default_settings WHERE scope=@scope;
      SELECT @before AS beforeJson, @@ROWCOUNT AS deleted;
    `);
    const row = (out.recordset?.[0] ?? {}) as Record<string, unknown>;
    return {
      deleted: Number(row.deleted ?? 0) > 0,
      before: row.beforeJson == null ? null : jParse<Record<string, unknown>>(String(row.beforeJson), {}),
      after: null,
    };
  });
}

/** Return all settings rows whose scope begins with the given prefix.
 *  Underscores and percent signs in the prefix are escaped so literal
 *  characters in normalised tenant names (spaces → _) don't act as LIKE
 *  wildcards and match unintended rows. */
export async function getOnboardingSettingsByPrefix(scopePrefix: string): Promise<OnboardingDefaultSettingsRow[]> {
  const r = await req();
  // SQL Server bracket-escape: [_] = literal _, [%] = literal %.
  const escaped = scopePrefix.replace(/[%_\[]/g, "[$&]");
  r.input("prefix", mssql.NVarChar, escaped + "%");
  const res = await r.query(
    "SELECT * FROM dbo.rmone_onboarding_default_settings WHERE scope LIKE @prefix ORDER BY updated_at DESC",
  );
  return res.recordset.map(mapSettings);
}

// ── ONBOARDING ASSUMED FIELDS ──────────────────────────────────────────────

export interface OnboardingAssumedFieldRow {
  id: number;
  tenantKey: string;
  tenantLabel: string;
  entityType: string;
  naturalKey: string;
  recordLabel: string;
  fieldName: string;
  value: string | null;
  confidence: string;
  sheetName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapAssumedField(r: Record<string, unknown>): OnboardingAssumedFieldRow {
  return {
    id:          Number(r.id ?? 0),
    tenantKey:   String(r.tenant_key ?? ""),
    tenantLabel: String(r.tenant_label ?? ""),
    entityType:  String(r.entity_type ?? ""),
    naturalKey:  String(r.natural_key ?? ""),
    recordLabel: String(r.record_label ?? ""),
    fieldName:   String(r.field_name ?? ""),
    value:       (r.value as string | null) ?? null,
    confidence:  String(r.confidence ?? "system_defaulted"),
    sheetName:   (r.sheet_name as string | null) ?? null,
    createdAt:   r.created_at instanceof Date ? r.created_at : new Date(),
    updatedAt:   r.updated_at instanceof Date ? r.updated_at : new Date(),
  };
}

export async function getOnboardingAssumedFields(tenantKey: string): Promise<OnboardingAssumedFieldRow[]> {
  const r = await req();
  r.input("tk", mssql.NVarChar, tenantKey);
  const res = await r.query("SELECT * FROM dbo.rmone_onboarding_assumed_fields WHERE tenant_key=@tk ORDER BY entity_type,natural_key,field_name");
  return res.recordset.map(mapAssumedField);
}

export async function getOnboardingAssumedFieldsFiltered(tenantKey: string, opts?: {
  entityType?: string; naturalKey?: string; fieldName?: string;
}): Promise<OnboardingAssumedFieldRow[]> {
  const r = await req();
  r.input("tk", mssql.NVarChar, tenantKey);
  let where = "tenant_key=@tk";
  if (opts?.entityType) { r.input("et", mssql.NVarChar, opts.entityType); where += " AND entity_type=@et"; }
  if (opts?.naturalKey) { r.input("nk", mssql.NVarChar, opts.naturalKey); where += " AND natural_key=@nk"; }
  if (opts?.fieldName)  { r.input("fn", mssql.NVarChar, opts.fieldName);  where += " AND field_name=@fn"; }
  const res = await r.query(`SELECT * FROM dbo.rmone_onboarding_assumed_fields WHERE ${where} ORDER BY entity_type,natural_key,field_name`);
  return res.recordset.map(mapAssumedField);
}

export async function upsertOnboardingAssumedFieldsBatch(rows: Omit<OnboardingAssumedFieldRow, "id" | "createdAt" | "updatedAt">[]): Promise<void> {
  for (const row of rows) {
    const r = await req();
    r.input("tk",  mssql.NVarChar, row.tenantKey);
    r.input("tl",  mssql.NVarChar, row.tenantLabel);
    r.input("et",  mssql.NVarChar, row.entityType);
    r.input("nk",  mssql.NVarChar, row.naturalKey);
    r.input("rl",  mssql.NVarChar, row.recordLabel);
    r.input("fn",  mssql.NVarChar, row.fieldName);
    r.input("val", mssql.NVarChar, row.value ?? null);
    r.input("con", mssql.NVarChar, row.confidence ?? "system_defaulted");
    r.input("sn",  mssql.NVarChar, row.sheetName ?? null);
    await r.query(`
      MERGE dbo.rmone_onboarding_assumed_fields AS T
      USING (SELECT @tk AS tk,@et AS et,@nk AS nk,@fn AS fn) AS S
        ON T.tenant_key=S.tk AND T.entity_type=S.et AND T.natural_key=S.nk AND T.field_name=S.fn
      WHEN MATCHED THEN UPDATE SET tenant_label=@tl,record_label=@rl,value=@val,confidence=@con,sheet_name=@sn,updated_at=GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (tenant_key,tenant_label,entity_type,natural_key,record_label,field_name,value,confidence,sheet_name)
        VALUES (@tk,@tl,@et,@nk,@rl,@fn,@val,@con,@sn);
    `);
  }
}

export async function deleteOnboardingAssumedFieldsByIds(ids: number[]): Promise<void> {
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const r = await req();
    const { clause, inputs } = inList(chunk.map(String));
    Object.entries(inputs).forEach(([k, v]) => r.input(k, mssql.Int, Number(v)));
    await r.query(`DELETE FROM dbo.rmone_onboarding_assumed_fields WHERE id IN (${clause})`);
  }
}

// ── ONBOARDING ASSUMED HISTORY ─────────────────────────────────────────────

export interface OnboardingAssumedHistoryRow {
  id: number;
  tenantKey: string;
  tenantLabel: string;
  entityType: string;
  naturalKey: string;
  recordLabel: string;
  fieldName: string;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  oldConfidence: string | null;
  newConfidence: string | null;
  sheetName: string | null;
  actor: string | null;
  createdAt: Date;
}

function mapAssumedHistory(r: Record<string, unknown>): OnboardingAssumedHistoryRow {
  return {
    id:            Number(r.id ?? 0),
    tenantKey:     String(r.tenant_key ?? ""),
    tenantLabel:   String(r.tenant_label ?? ""),
    entityType:    String(r.entity_type ?? ""),
    naturalKey:    String(r.natural_key ?? ""),
    recordLabel:   String(r.record_label ?? ""),
    fieldName:     String(r.field_name ?? ""),
    action:        String(r.action ?? ""),
    oldValue:      (r.old_value as string | null) ?? null,
    newValue:      (r.new_value as string | null) ?? null,
    oldConfidence: (r.old_confidence as string | null) ?? null,
    newConfidence: (r.new_confidence as string | null) ?? null,
    sheetName:     (r.sheet_name as string | null) ?? null,
    actor:         (r.actor as string | null) ?? null,
    createdAt:     r.created_at instanceof Date ? r.created_at : new Date(),
  };
}

export async function insertOnboardingAssumedHistoryBatch(rows: Omit<OnboardingAssumedHistoryRow, "id" | "createdAt">[]): Promise<void> {
  for (const row of rows) {
    const r = await req();
    r.input("tk",  mssql.NVarChar, row.tenantKey);
    r.input("tl",  mssql.NVarChar, row.tenantLabel);
    r.input("et",  mssql.NVarChar, row.entityType);
    r.input("nk",  mssql.NVarChar, row.naturalKey);
    r.input("rl",  mssql.NVarChar, row.recordLabel);
    r.input("fn",  mssql.NVarChar, row.fieldName);
    r.input("act", mssql.NVarChar, row.action);
    r.input("ov",  mssql.NVarChar, row.oldValue ?? null);
    r.input("nv",  mssql.NVarChar, row.newValue ?? null);
    r.input("oc",  mssql.NVarChar, row.oldConfidence ?? null);
    r.input("nc",  mssql.NVarChar, row.newConfidence ?? null);
    r.input("sn",  mssql.NVarChar, row.sheetName ?? null);
    r.input("actor", mssql.NVarChar, row.actor ?? null);
    await r.query(`
      INSERT INTO dbo.rmone_onboarding_assumed_history
        (tenant_key,tenant_label,entity_type,natural_key,record_label,field_name,action,old_value,new_value,old_confidence,new_confidence,sheet_name,actor)
      VALUES (@tk,@tl,@et,@nk,@rl,@fn,@act,@ov,@nv,@oc,@nc,@sn,@actor)
    `);
  }
}

export async function getOnboardingAssumedHistory(tenantKey: string, opts?: {
  entityType?: string; naturalKey?: string; fieldName?: string; limit?: number;
}): Promise<OnboardingAssumedHistoryRow[]> {
  const r = await req();
  r.input("tk", mssql.NVarChar, tenantKey);
  const limit = opts?.limit ?? 500;
  r.input("lim", mssql.Int, limit);
  let where = "tenant_key=@tk";
  if (opts?.entityType) { r.input("et", mssql.NVarChar, opts.entityType); where += " AND entity_type=@et"; }
  if (opts?.naturalKey) { r.input("nk", mssql.NVarChar, opts.naturalKey); where += " AND natural_key=@nk"; }
  if (opts?.fieldName)  { r.input("fn", mssql.NVarChar, opts.fieldName);  where += " AND field_name=@fn"; }
  const res = await r.query(
    `SELECT TOP (@lim) * FROM dbo.rmone_onboarding_assumed_history WHERE ${where} ORDER BY created_at DESC`,
  );
  return res.recordset.map(mapAssumedHistory);
}

// ── SKILL CATALOG ──────────────────────────────────────────────────────────

export interface SkillCatalogRow {
  id: number;
  tenantId: string;
  name: string;
  category: string | null;
  createdAt: Date;
}

function mapSkill(r: Record<string, unknown>): SkillCatalogRow {
  return {
    id:        Number(r.id ?? 0),
    tenantId:  String(r.tenant_id ?? ""),
    name:      String(r.name ?? ""),
    category:  (r.category as string | null) ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(),
  };
}

export async function getSkillCatalog(tenantId: string): Promise<SkillCatalogRow[]> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tenantId);
  const res = await r.query("SELECT * FROM dbo.rmone_skill_catalog WHERE tenant_id=@tid ORDER BY name");
  return res.recordset.map(mapSkill);
}

export async function insertSkillIfNotExists(tenantId: string, name: string): Promise<number> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("name", mssql.NVarChar, name);
  const existing = await r.query("SELECT TOP 1 id FROM dbo.rmone_skill_catalog WHERE tenant_id=@tid AND name=@name");
  if (existing.recordset[0]) return Number(existing.recordset[0].id);
  const r2 = await req();
  r2.input("tid",  mssql.NVarChar, tenantId);
  r2.input("name", mssql.NVarChar, name);
  const ins = await r2.query("INSERT INTO dbo.rmone_skill_catalog (tenant_id,name) OUTPUT INSERTED.id VALUES (@tid,@name)");
  return Number(ins.recordset[0].id);
}

// Bulk version of insertSkillIfNotExists for the import pipeline: ONE chunked
// SELECT for existing names + ONE chunked multi-row INSERT for the missing ones.
// Returns a map of name(lowercased) → catalog id. Name matching relies on the
// same case-insensitive SQL collation as the per-row function.
export async function ensureSkillsBulk(tenantId: string, names: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = new Map<string, string>(); // lower → original
  for (const n of names) { const t = n.trim(); if (t && !uniq.has(t.toLowerCase())) uniq.set(t.toLowerCase(), t); }
  if (!uniq.size) return out;
  const all = [...uniq.values()];
  const CHUNK = 500;
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    const r = await req();
    r.input("tid", mssql.NVarChar, tenantId);
    const { clause, inputs } = inList(chunk, "nm");
    Object.entries(inputs).forEach(([k, v]) => r.input(k, mssql.NVarChar, v));
    const res = await r.query(`SELECT id, name FROM dbo.rmone_skill_catalog WHERE tenant_id=@tid AND name IN (${clause})`);
    for (const row of res.recordset) out.set(String(row.name).toLowerCase(), Number(row.id));
  }
  const missing = all.filter(n => !out.has(n.toLowerCase()));
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    const r = await req();
    r.input("tid", mssql.NVarChar, tenantId);
    const tuples = chunk.map((n, ri) => { r.input(`n${ri}`, mssql.NVarChar, n); return `(@tid,@n${ri})`; });
    const ins = await r.query(
      `INSERT INTO dbo.rmone_skill_catalog (tenant_id,name) OUTPUT INSERTED.id, INSERTED.name VALUES ${tuples.join(",")}`,
    );
    for (const row of ins.recordset) out.set(String(row.name).toLowerCase(), Number(row.id));
  }
  return out;
}

// ── RESOURCE SKILLS ────────────────────────────────────────────────────────

export interface ResourceSkillRow {
  id: number;
  tenantId: string;
  resourceGuid: string;
  skillId: number | null;
  skillName: string;
  category: string | null;
  proficiency: number | null;
  yearsExperience: number | null;
  lastUsedYear: number | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function mapResourceSkill(r: Record<string, unknown>): ResourceSkillRow {
  return {
    id:              Number(r.id ?? 0),
    tenantId:        String(r.tenant_id ?? ""),
    resourceGuid:    String(r.resource_guid ?? ""),
    skillId:         r.skill_id != null ? Number(r.skill_id) : null,
    skillName:       String(r.skill_name ?? ""),
    category:        (r.category as string | null) ?? null,
    proficiency:     r.proficiency != null ? Number(r.proficiency) : null,
    yearsExperience: r.years_experience != null ? Number(r.years_experience) : null,
    lastUsedYear:    r.last_used_year != null ? Number(r.last_used_year) : null,
    isPrimary:       b(r.is_primary),
    createdAt:       r.created_at instanceof Date ? r.created_at : new Date(),
    updatedAt:       r.updated_at instanceof Date ? r.updated_at : new Date(),
  };
}

export async function getResourceSkillsByGuid(tenantId: string, guid: string): Promise<ResourceSkillRow[]> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, guid);
  const res = await r.query(
    "SELECT * FROM dbo.rmone_resource_skills WHERE tenant_id=@tid AND resource_guid=@guid ORDER BY is_primary DESC,proficiency DESC",
  );
  return res.recordset.map(mapResourceSkill);
}

export async function getResourceSkillsByNames(tenantId: string, names: string[]): Promise<ResourceSkillRow[]> {
  if (!names.length) return [];
  const r = await req();
  r.input("tid", mssql.NVarChar, tenantId);
  const { clause, inputs } = inList(names, "nm");
  Object.entries(inputs).forEach(([k, v]) => r.input(k, mssql.NVarChar, v));
  const res = await r.query(
    `SELECT * FROM dbo.rmone_resource_skills WHERE tenant_id=@tid AND skill_name IN (${clause})`,
  );
  return res.recordset.map(mapResourceSkill);
}

export async function getResourceSkillsByTenant(tenantId: string): Promise<ResourceSkillRow[]> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tenantId);
  const res = await r.query("SELECT * FROM dbo.rmone_resource_skills WHERE tenant_id=@tid");
  return res.recordset.map(mapResourceSkill);
}

export async function insertResourceSkill(data: Omit<ResourceSkillRow, "id" | "createdAt" | "updatedAt">): Promise<ResourceSkillRow> {
  const r = await req();
  r.input("tid",   mssql.NVarChar, data.tenantId);
  r.input("guid",  mssql.NVarChar, data.resourceGuid);
  r.input("sid",   mssql.Int, data.skillId ?? null);
  r.input("name",  mssql.NVarChar, data.skillName);
  r.input("cat",   mssql.NVarChar, data.category ?? null);
  r.input("prof",  mssql.Int, data.proficiency ?? null);
  r.input("yexp",  mssql.Decimal, data.yearsExperience ?? null);
  r.input("luy",   mssql.Int, data.lastUsedYear ?? null);
  r.input("prim",  mssql.Bit, data.isPrimary ? 1 : 0);
  const res = await r.query(`
    MERGE dbo.rmone_resource_skills AS T
    USING (SELECT @tid AS tid, @guid AS g, @name AS n) AS S
      ON T.tenant_id=S.tid AND T.resource_guid=S.g AND T.skill_name=S.n
    WHEN MATCHED THEN UPDATE SET skill_id=@sid,category=@cat,proficiency=@prof,years_experience=@yexp,last_used_year=@luy,is_primary=@prim,updated_at=GETUTCDATE()
    WHEN NOT MATCHED THEN INSERT (tenant_id,resource_guid,skill_id,skill_name,category,proficiency,years_experience,last_used_year,is_primary)
      VALUES (@tid,@guid,@sid,@name,@cat,@prof,@yexp,@luy,@prim)
    OUTPUT INSERTED.*;
  `);
  return mapResourceSkill(res.recordset[0]);
}

// Bulk import-path version of insertResourceSkill: chunked MERGE ... USING (VALUES ...).
// Mirrors the pipeline's per-row call exactly, i.e. the extra attribute columns
// (category/proficiency/years/last-used/primary) are reset to their defaults on
// match, just as insertResourceSkill does when called with nulls. Duplicate
// (guid, skill) pairs are deduped — MERGE rejects duplicate source rows.
export async function bulkImportResourceSkills(
  tenantId: string,
  links: Array<{ resourceGuid: string; skillId: number | null; skillName: string }>,
): Promise<void> {
  const seen = new Map<string, { resourceGuid: string; skillId: number | null; skillName: string }>();
  for (const l of links) {
    const name = l.skillName.trim();
    if (!name || !l.resourceGuid) continue;
    seen.set(`${l.resourceGuid.toLowerCase()}|${name.toLowerCase()}`, { ...l, skillName: name });
  }
  const all = [...seen.values()];
  if (!all.length) return;
  const CHUNK = 400; // 3 params/row + @tid
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    const r = await req();
    r.input("tid", mssql.NVarChar, tenantId);
    const tuples = chunk.map((l, ri) => {
      r.input(`g${ri}`, mssql.NVarChar, l.resourceGuid);
      r.input(`s${ri}`, mssql.Int, l.skillId ?? null);
      r.input(`n${ri}`, mssql.NVarChar, l.skillName);
      return `(@g${ri},@s${ri},@n${ri})`;
    });
    await r.query(`
      MERGE dbo.rmone_resource_skills AS T
      USING (VALUES ${tuples.join(",")}) AS S(g,sid,n)
        ON T.tenant_id=@tid AND T.resource_guid=S.g AND T.skill_name=S.n
      WHEN MATCHED THEN UPDATE SET skill_id=S.sid,category=NULL,proficiency=NULL,years_experience=NULL,last_used_year=NULL,is_primary=0,updated_at=GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT (tenant_id,resource_guid,skill_id,skill_name,category,proficiency,years_experience,last_used_year,is_primary)
        VALUES (@tid,S.g,S.sid,S.n,NULL,NULL,NULL,NULL,0);
    `);
  }
}

export async function deleteResourceSkill(tenantId: string, guid: string, id: number): Promise<void> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, guid);
  r.input("id",   mssql.Int, id);
  await r.query("DELETE FROM dbo.rmone_resource_skills WHERE tenant_id=@tid AND resource_guid=@guid AND id=@id");
}

// ── RESOURCE PROFILE ───────────────────────────────────────────────────────

export interface ResourceProfileRow {
  id: number;
  tenantId: string;
  resourceGuid: string;
  headline: string | null;
  bio: string | null;
  location: string | null;
  yearsExperience: number | null;
  availableFrom: Date | null;
  preferredRoles: string[] | null;
  linkedinUrl: string | null;
  billingRate: number | null;
  laborRate: number | null;
  costRate: number | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapProfile(r: Record<string, unknown>): ResourceProfileRow {
  return {
    id:              Number(r.id ?? 0),
    tenantId:        String(r.tenant_id ?? ""),
    resourceGuid:    String(r.resource_guid ?? ""),
    headline:        (r.headline as string | null) ?? null,
    bio:             (r.bio as string | null) ?? null,
    location:        (r.location as string | null) ?? null,
    yearsExperience: r.years_experience != null ? Number(r.years_experience) : null,
    availableFrom:   r.available_from instanceof Date ? r.available_from : null,
    preferredRoles:  jParse<string[]>(r.preferred_roles as string | null, null as unknown as string[]),
    linkedinUrl:     (r.linkedin_url as string | null) ?? null,
    billingRate:     r.billing_rate != null ? Number(r.billing_rate) : null,
    laborRate:       r.labor_rate != null ? Number(r.labor_rate) : null,
    costRate:        r.cost_rate != null ? Number(r.cost_rate) : null,
    createdAt:       r.created_at instanceof Date ? r.created_at : new Date(),
    updatedAt:       r.updated_at instanceof Date ? r.updated_at : new Date(),
  };
}

export async function getResourceProfile(tenantId: string, guid: string): Promise<ResourceProfileRow | null> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, guid);
  const res = await r.query(
    "SELECT TOP 1 * FROM dbo.rmone_resource_profile WHERE tenant_id=@tid AND resource_guid=@guid",
  );
  return res.recordset[0] ? mapProfile(res.recordset[0]) : null;
}

export async function upsertResourceProfile(data: Omit<ResourceProfileRow, "id" | "createdAt" | "updatedAt">): Promise<ResourceProfileRow> {
  const r = await req();
  r.input("tid",   mssql.NVarChar, data.tenantId);
  r.input("guid",  mssql.NVarChar, data.resourceGuid);
  r.input("hl",    mssql.NVarChar, data.headline ?? null);
  r.input("bio",   mssql.NVarChar, data.bio ?? null);
  r.input("loc",   mssql.NVarChar, data.location ?? null);
  r.input("yexp",  mssql.Decimal, data.yearsExperience ?? null);
  r.input("avail", mssql.Date, data.availableFrom ?? null);
  r.input("roles", mssql.NVarChar, jStr(data.preferredRoles));
  r.input("li",    mssql.NVarChar, data.linkedinUrl ?? null);
  r.input("br",    mssql.Decimal, data.billingRate ?? null);
  r.input("lr",    mssql.Decimal, data.laborRate ?? null);
  r.input("cr",    mssql.Decimal, data.costRate ?? null);
  const res = await r.query(`
    MERGE dbo.rmone_resource_profile AS T
    USING (SELECT @tid AS tid, @guid AS g) AS S ON T.tenant_id=S.tid AND T.resource_guid=S.g
    WHEN MATCHED THEN UPDATE SET headline=@hl,bio=@bio,location=@loc,years_experience=@yexp,
      available_from=@avail,preferred_roles=@roles,linkedin_url=@li,billing_rate=@br,labor_rate=@lr,cost_rate=@cr,updated_at=GETUTCDATE()
    WHEN NOT MATCHED THEN INSERT (tenant_id,resource_guid,headline,bio,location,years_experience,available_from,preferred_roles,linkedin_url,billing_rate,labor_rate,cost_rate)
      VALUES (@tid,@guid,@hl,@bio,@loc,@yexp,@avail,@roles,@li,@br,@lr,@cr)
    OUTPUT INSERTED.*;
  `);
  return mapProfile(res.recordset[0]);
}

// ── RESOURCE CERTIFICATIONS ────────────────────────────────────────────────

export interface ResourceCertificationRow {
  id: number;
  tenantId: string;
  resourceGuid: string;
  name: string;
  issuer: string | null;
  credentialId: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  attachmentPath: string | null;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function mapCert(r: Record<string, unknown>): ResourceCertificationRow {
  const toDateStr = (v: unknown): string | null => {
    if (!v) return null;
    if (v instanceof Date) return v.toISOString().split("T")[0];
    return String(v);
  };
  return {
    id:             Number(r.id ?? 0),
    tenantId:       String(r.tenant_id ?? ""),
    resourceGuid:   String(r.resource_guid ?? ""),
    name:           String(r.name ?? ""),
    issuer:         (r.issuer as string | null) ?? null,
    credentialId:   (r.credential_id as string | null) ?? null,
    issueDate:      toDateStr(r.issue_date),
    expiryDate:     toDateStr(r.expiry_date),
    attachmentPath: (r.attachment_path as string | null) ?? null,
    isVerified:     b(r.is_verified),
    createdAt:      r.created_at instanceof Date ? r.created_at : new Date(),
    updatedAt:      r.updated_at instanceof Date ? r.updated_at : new Date(),
  };
}

export async function getResourceCertifications(tenantId: string, guid: string): Promise<ResourceCertificationRow[]> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, guid);
  const res = await r.query(
    "SELECT * FROM dbo.rmone_resource_certifications WHERE tenant_id=@tid AND resource_guid=@guid ORDER BY issue_date DESC",
  );
  return res.recordset.map(mapCert);
}

export async function insertResourceCertification(data: Omit<ResourceCertificationRow, "id" | "createdAt" | "updatedAt">): Promise<ResourceCertificationRow> {
  const r = await req();
  r.input("tid",   mssql.NVarChar, data.tenantId);
  r.input("guid",  mssql.NVarChar, data.resourceGuid);
  r.input("name",  mssql.NVarChar, data.name);
  r.input("iss",   mssql.NVarChar, data.issuer ?? null);
  r.input("cid",   mssql.NVarChar, data.credentialId ?? null);
  r.input("idate", mssql.Date, data.issueDate ? new Date(data.issueDate) : null);
  r.input("edate", mssql.Date, data.expiryDate ? new Date(data.expiryDate) : null);
  r.input("apath", mssql.NVarChar, data.attachmentPath ?? null);
  r.input("ver",   mssql.Bit, data.isVerified ? 1 : 0);
  const res = await r.query(`
    INSERT INTO dbo.rmone_resource_certifications (tenant_id,resource_guid,name,issuer,credential_id,issue_date,expiry_date,attachment_path,is_verified)
    OUTPUT INSERTED.*
    VALUES (@tid,@guid,@name,@iss,@cid,@idate,@edate,@apath,@ver)
  `);
  return mapCert(res.recordset[0]);
}

export async function deleteResourceCertification(tenantId: string, guid: string, id: number): Promise<void> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, guid);
  r.input("id",   mssql.Int, id);
  await r.query("DELETE FROM dbo.rmone_resource_certifications WHERE tenant_id=@tid AND resource_guid=@guid AND id=@id");
}

// ── RESOURCE EDUCATION ─────────────────────────────────────────────────────

export interface ResourceEducationRow {
  id: number;
  tenantId: string;
  resourceGuid: string;
  institution: string;
  degree: string | null;
  fieldOfStudy: string | null;
  startYear: number | null;
  endYear: number | null;
  isCurrent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function mapEdu(r: Record<string, unknown>): ResourceEducationRow {
  return {
    id:           Number(r.id ?? 0),
    tenantId:     String(r.tenant_id ?? ""),
    resourceGuid: String(r.resource_guid ?? ""),
    institution:  String(r.institution ?? ""),
    degree:       (r.degree as string | null) ?? null,
    fieldOfStudy: (r.field_of_study as string | null) ?? null,
    startYear:    r.start_year != null ? Number(r.start_year) : null,
    endYear:      r.end_year != null ? Number(r.end_year) : null,
    isCurrent:    b(r.is_current),
    createdAt:    r.created_at instanceof Date ? r.created_at : new Date(),
    updatedAt:    r.updated_at instanceof Date ? r.updated_at : new Date(),
  };
}

export async function getResourceEducation(tenantId: string, guid: string): Promise<ResourceEducationRow[]> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, guid);
  const res = await r.query(
    "SELECT * FROM dbo.rmone_resource_education WHERE tenant_id=@tid AND resource_guid=@guid ORDER BY end_year DESC",
  );
  return res.recordset.map(mapEdu);
}

export async function insertResourceEducation(data: Omit<ResourceEducationRow, "id" | "createdAt" | "updatedAt">): Promise<ResourceEducationRow> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, data.tenantId);
  r.input("guid", mssql.NVarChar, data.resourceGuid);
  r.input("inst", mssql.NVarChar, data.institution);
  r.input("deg",  mssql.NVarChar, data.degree ?? null);
  r.input("fos",  mssql.NVarChar, data.fieldOfStudy ?? null);
  r.input("sy",   mssql.Int, data.startYear ?? null);
  r.input("ey",   mssql.Int, data.endYear ?? null);
  r.input("cur",  mssql.Bit, data.isCurrent ? 1 : 0);
  const res = await r.query(`
    INSERT INTO dbo.rmone_resource_education (tenant_id,resource_guid,institution,degree,field_of_study,start_year,end_year,is_current)
    OUTPUT INSERTED.*
    VALUES (@tid,@guid,@inst,@deg,@fos,@sy,@ey,@cur)
  `);
  return mapEdu(res.recordset[0]);
}

export async function deleteResourceEducation(tenantId: string, guid: string, id: number): Promise<void> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, guid);
  r.input("id",   mssql.Int, id);
  await r.query("DELETE FROM dbo.rmone_resource_education WHERE tenant_id=@tid AND resource_guid=@guid AND id=@id");
}

// ── RESOURCE WORK HISTORY ──────────────────────────────────────────────────

export interface ResourceWorkHistoryRow {
  id: number;
  tenantId: string;
  resourceGuid: string;
  company: string;
  title: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapWH(r: Record<string, unknown>): ResourceWorkHistoryRow {
  const ds = (v: unknown): string | null => {
    if (!v) return null;
    if (v instanceof Date) return v.toISOString().split("T")[0];
    return String(v);
  };
  return {
    id:           Number(r.id ?? 0),
    tenantId:     String(r.tenant_id ?? ""),
    resourceGuid: String(r.resource_guid ?? ""),
    company:      String(r.company ?? ""),
    title:        (r.title as string | null) ?? null,
    location:     (r.location as string | null) ?? null,
    startDate:    ds(r.start_date),
    endDate:      ds(r.end_date),
    isCurrent:    b(r.is_current),
    description:  (r.description as string | null) ?? null,
    createdAt:    r.created_at instanceof Date ? r.created_at : new Date(),
    updatedAt:    r.updated_at instanceof Date ? r.updated_at : new Date(),
  };
}

export async function getResourceWorkHistory(tenantId: string, guid: string): Promise<ResourceWorkHistoryRow[]> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, guid);
  const res = await r.query(
    "SELECT * FROM dbo.rmone_resource_work_history WHERE tenant_id=@tid AND resource_guid=@guid ORDER BY start_date DESC",
  );
  return res.recordset.map(mapWH);
}

export async function insertResourceWorkHistory(data: Omit<ResourceWorkHistoryRow, "id" | "createdAt" | "updatedAt">): Promise<ResourceWorkHistoryRow> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, data.tenantId);
  r.input("guid", mssql.NVarChar, data.resourceGuid);
  r.input("co",   mssql.NVarChar, data.company);
  r.input("tit",  mssql.NVarChar, data.title ?? null);
  r.input("loc",  mssql.NVarChar, data.location ?? null);
  r.input("sd",   mssql.Date, data.startDate ? new Date(data.startDate) : null);
  r.input("ed",   mssql.Date, data.endDate ? new Date(data.endDate) : null);
  r.input("cur",  mssql.Bit, data.isCurrent ? 1 : 0);
  r.input("desc", mssql.NVarChar, data.description ?? null);
  const res = await r.query(`
    INSERT INTO dbo.rmone_resource_work_history (tenant_id,resource_guid,company,title,location,start_date,end_date,is_current,description)
    OUTPUT INSERTED.*
    VALUES (@tid,@guid,@co,@tit,@loc,@sd,@ed,@cur,@desc)
  `);
  return mapWH(res.recordset[0]);
}

export async function deleteResourceWorkHistory(tenantId: string, guid: string, id: number): Promise<void> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, guid);
  r.input("id",   mssql.Int, id);
  await r.query("DELETE FROM dbo.rmone_resource_work_history WHERE tenant_id=@tid AND resource_guid=@guid AND id=@id");
}

// ── RESOURCE PROJECTS ──────────────────────────────────────────────────────

export interface ResourceProjectRow {
  id: number;
  tenantId: string;
  resourceGuid: string;
  projectName: string;
  role: string | null;
  client: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapRProj(r: Record<string, unknown>): ResourceProjectRow {
  const ds = (v: unknown): string | null => {
    if (!v) return null;
    if (v instanceof Date) return v.toISOString().split("T")[0];
    return String(v);
  };
  return {
    id:           Number(r.id ?? 0),
    tenantId:     String(r.tenant_id ?? ""),
    resourceGuid: String(r.resource_guid ?? ""),
    projectName:  String(r.project_name ?? ""),
    role:         (r.role as string | null) ?? null,
    client:       (r.client as string | null) ?? null,
    startDate:    ds(r.start_date),
    endDate:      ds(r.end_date),
    isCurrent:    b(r.is_current),
    description:  (r.description as string | null) ?? null,
    createdAt:    r.created_at instanceof Date ? r.created_at : new Date(),
    updatedAt:    r.updated_at instanceof Date ? r.updated_at : new Date(),
  };
}

export async function getResourceProjects(tenantId: string, guid: string): Promise<ResourceProjectRow[]> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, guid);
  const res = await r.query(
    "SELECT * FROM dbo.rmone_resource_projects WHERE tenant_id=@tid AND resource_guid=@guid ORDER BY start_date DESC",
  );
  return res.recordset.map(mapRProj);
}

export async function insertResourceProject(data: Omit<ResourceProjectRow, "id" | "createdAt" | "updatedAt">): Promise<ResourceProjectRow> {
  const r = await req();
  r.input("tid",   mssql.NVarChar, data.tenantId);
  r.input("guid",  mssql.NVarChar, data.resourceGuid);
  r.input("pname", mssql.NVarChar, data.projectName);
  r.input("role",  mssql.NVarChar, data.role ?? null);
  r.input("cli",   mssql.NVarChar, data.client ?? null);
  r.input("sd",    mssql.Date, data.startDate ? new Date(data.startDate) : null);
  r.input("ed",    mssql.Date, data.endDate ? new Date(data.endDate) : null);
  r.input("cur",   mssql.Bit, data.isCurrent ? 1 : 0);
  r.input("desc",  mssql.NVarChar, data.description ?? null);
  const res = await r.query(`
    INSERT INTO dbo.rmone_resource_projects (tenant_id,resource_guid,project_name,role,client,start_date,end_date,is_current,description)
    OUTPUT INSERTED.*
    VALUES (@tid,@guid,@pname,@role,@cli,@sd,@ed,@cur,@desc)
  `);
  return mapRProj(res.recordset[0]);
}

export async function deleteResourceProject(tenantId: string, guid: string, id: number): Promise<void> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, guid);
  r.input("id",   mssql.Int, id);
  await r.query("DELETE FROM dbo.rmone_resource_projects WHERE tenant_id=@tid AND resource_guid=@guid AND id=@id");
}

// ── RESOURCE RESUMES ───────────────────────────────────────────────────────

export interface ResourceResumeRow {
  id: number;
  tenantId: string;
  resourceGuid: string;
  objectPath: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  summary: string | null;
  isPrimary: boolean;
  uploadedAt: Date;
}

function mapResume(r: Record<string, unknown>): ResourceResumeRow {
  return {
    id:           Number(r.id ?? 0),
    tenantId:     String(r.tenant_id ?? ""),
    resourceGuid: String(r.resource_guid ?? ""),
    objectPath:   String(r.object_path ?? ""),
    fileName:     String(r.file_name ?? ""),
    contentType:  (r.content_type as string | null) ?? null,
    sizeBytes:    r.size_bytes != null ? Number(r.size_bytes) : null,
    summary:      (r.summary as string | null) ?? null,
    isPrimary:    b(r.is_primary),
    uploadedAt:   r.uploaded_at instanceof Date ? r.uploaded_at : new Date(),
  };
}

export async function getResourceResumes(tenantId: string, guid: string): Promise<ResourceResumeRow[]> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, guid);
  const res = await r.query(
    "SELECT * FROM dbo.rmone_resource_resumes WHERE tenant_id=@tid AND resource_guid=@guid ORDER BY is_primary DESC,uploaded_at DESC",
  );
  return res.recordset.map(mapResume);
}

export async function insertResourceResume(data: Omit<ResourceResumeRow, "id" | "uploadedAt">): Promise<ResourceResumeRow> {
  const r = await req();
  r.input("tid",   mssql.NVarChar, data.tenantId);
  r.input("guid",  mssql.NVarChar, data.resourceGuid);
  r.input("path",  mssql.NVarChar, data.objectPath);
  r.input("fn",    mssql.NVarChar, data.fileName);
  r.input("ct",    mssql.NVarChar, data.contentType ?? null);
  r.input("sz",    mssql.Int, data.sizeBytes ?? null);
  r.input("sum",   mssql.NVarChar, data.summary ?? null);
  r.input("prim",  mssql.Bit, data.isPrimary ? 1 : 0);
  const res = await r.query(`
    INSERT INTO dbo.rmone_resource_resumes (tenant_id,resource_guid,object_path,file_name,content_type,size_bytes,summary,is_primary)
    OUTPUT INSERTED.*
    VALUES (@tid,@guid,@path,@fn,@ct,@sz,@sum,@prim)
  `);
  return mapResume(res.recordset[0]);
}

export async function deleteResourceResume(tenantId: string, guid: string, id: number): Promise<void> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, guid);
  r.input("id",   mssql.Int, id);
  await r.query("DELETE FROM dbo.rmone_resource_resumes WHERE tenant_id=@tid AND resource_guid=@guid AND id=@id");
}

export async function clearPrimaryResumes(tenantId: string, guid: string): Promise<void> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, guid);
  await r.query("UPDATE dbo.rmone_resource_resumes SET is_primary=0 WHERE tenant_id=@tid AND resource_guid=@guid");
}

export async function checkResumeOwnership(tenantId: string, objectPath: string): Promise<boolean> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("path", mssql.NVarChar, objectPath);
  const res = await r.query(
    "SELECT TOP 1 id FROM dbo.rmone_resource_resumes WHERE tenant_id=@tid AND object_path=@path",
  );
  return res.recordset.length > 0;
}

// ── EXPERIENCE TAG CATALOG ─────────────────────────────────────────────────

export interface ExperienceTagCatalogRow {
  id: number;
  tenantId: string;
  name: string;
  category: string | null;
  createdAt: Date;
}

function mapTagCatalog(r: Record<string, unknown>): ExperienceTagCatalogRow {
  return {
    id:        Number(r.id ?? 0),
    tenantId:  String(r.tenant_id ?? ""),
    name:      String(r.name ?? ""),
    category:  (r.category as string | null) ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(),
  };
}

export async function getExperienceTagCatalog(tenantId: string): Promise<ExperienceTagCatalogRow[]> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tenantId);
  const res = await r.query("SELECT * FROM dbo.rmone_experience_tag_catalog WHERE tenant_id=@tid ORDER BY name");
  return res.recordset.map(mapTagCatalog);
}

export async function insertExperienceTagIfNotExists(tenantId: string, name: string): Promise<number> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("name", mssql.NVarChar, name);
  const existing = await r.query("SELECT TOP 1 id FROM dbo.rmone_experience_tag_catalog WHERE tenant_id=@tid AND name=@name");
  if (existing.recordset[0]) return Number(existing.recordset[0].id);
  const r2 = await req();
  r2.input("tid",  mssql.NVarChar, tenantId);
  r2.input("name", mssql.NVarChar, name);
  const ins = await r2.query("INSERT INTO dbo.rmone_experience_tag_catalog (tenant_id,name) OUTPUT INSERTED.id VALUES (@tid,@name)");
  return Number(ins.recordset[0].id);
}

// Bulk version of insertExperienceTagIfNotExists (import pipeline): one chunked
// SELECT + one chunked multi-row INSERT for missing names.
export async function ensureExperienceTagsBulk(tenantId: string, names: string[]): Promise<void> {
  const uniq = new Map<string, string>();
  for (const n of names) { const t = n.trim(); if (t && !uniq.has(t.toLowerCase())) uniq.set(t.toLowerCase(), t); }
  if (!uniq.size) return;
  const all = [...uniq.values()];
  const existing = new Set<string>();
  const CHUNK = 500;
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    const r = await req();
    r.input("tid", mssql.NVarChar, tenantId);
    const { clause, inputs } = inList(chunk, "nm");
    Object.entries(inputs).forEach(([k, v]) => r.input(k, mssql.NVarChar, v));
    const res = await r.query(`SELECT name FROM dbo.rmone_experience_tag_catalog WHERE tenant_id=@tid AND name IN (${clause})`);
    for (const row of res.recordset) existing.add(String(row.name).toLowerCase());
  }
  const missing = all.filter(n => !existing.has(n.toLowerCase()));
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    const r = await req();
    r.input("tid", mssql.NVarChar, tenantId);
    const tuples = chunk.map((n, ri) => { r.input(`n${ri}`, mssql.NVarChar, n); return `(@tid,@n${ri})`; });
    await r.query(`INSERT INTO dbo.rmone_experience_tag_catalog (tenant_id,name) VALUES ${tuples.join(",")}`);
  }
}

// ── USER EXPERIENCE TAGS ───────────────────────────────────────────────────

export interface UserExperienceTagRow {
  id: number;
  tenantId: string;
  resourceGuid: string;
  tagName: string;
  createdAt: Date;
}

function mapUET(r: Record<string, unknown>): UserExperienceTagRow {
  return {
    id:           Number(r.id ?? 0),
    tenantId:     String(r.tenant_id ?? ""),
    resourceGuid: String(r.resource_guid ?? ""),
    tagName:      String(r.tag_name ?? ""),
    createdAt:    r.created_at instanceof Date ? r.created_at : new Date(),
  };
}

export async function getUserExperienceTags(tenantId: string): Promise<UserExperienceTagRow[]> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tenantId);
  const res = await r.query("SELECT * FROM dbo.rmone_user_experience_tags WHERE tenant_id=@tid");
  return res.recordset.map(mapUET);
}

export async function insertUserExperienceTag(data: { tenantId: string; resourceGuid: string; tagName: string }): Promise<void> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, data.tenantId);
  r.input("guid", mssql.NVarChar, data.resourceGuid);
  r.input("tag",  mssql.NVarChar, data.tagName);
  await r.query(`
    IF NOT EXISTS (SELECT 1 FROM dbo.rmone_user_experience_tags WHERE tenant_id=@tid AND resource_guid=@guid AND tag_name=@tag)
      INSERT INTO dbo.rmone_user_experience_tags (tenant_id,resource_guid,tag_name) VALUES (@tid,@guid,@tag)
  `);
}

// Bulk version of insertUserExperienceTag (import pipeline): chunked
// INSERT ... SELECT FROM (VALUES ...) with a NOT EXISTS guard. Duplicate
// (guid, tag) pairs are deduped in-memory first — NOT EXISTS only checks table
// state as of statement start, so in-batch duplicates would both insert.
export async function insertUserExperienceTagsBulk(
  tenantId: string,
  links: Array<{ resourceGuid: string; tagName: string }>,
): Promise<void> {
  const seen = new Map<string, { resourceGuid: string; tagName: string }>();
  for (const l of links) {
    const t = l.tagName.trim();
    if (!t || !l.resourceGuid) continue;
    seen.set(`${l.resourceGuid.toLowerCase()}|${t.toLowerCase()}`, { resourceGuid: l.resourceGuid, tagName: t });
  }
  const all = [...seen.values()];
  if (!all.length) return;
  const CHUNK = 600; // 2 params/row + @tid
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    const r = await req();
    r.input("tid", mssql.NVarChar, tenantId);
    const tuples = chunk.map((l, ri) => {
      r.input(`g${ri}`, mssql.NVarChar, l.resourceGuid);
      r.input(`t${ri}`, mssql.NVarChar, l.tagName);
      return `(@g${ri},@t${ri})`;
    });
    await r.query(`
      INSERT INTO dbo.rmone_user_experience_tags (tenant_id,resource_guid,tag_name)
      SELECT @tid, V.g, V.t FROM (VALUES ${tuples.join(",")}) AS V(g,t)
      WHERE NOT EXISTS (
        SELECT 1 FROM dbo.rmone_user_experience_tags E
        WHERE E.tenant_id=@tid AND E.resource_guid=V.g AND E.tag_name=V.t
      );
    `);
  }
}

export async function getUserExperienceTagsByGuid(tenantId: string, guid: string): Promise<UserExperienceTagRow[]> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, guid.toLowerCase());
  const res = await r.query("SELECT * FROM dbo.rmone_user_experience_tags WHERE tenant_id=@tid AND resource_guid=@guid ORDER BY tag_name");
  return res.recordset.map(mapUET);
}

export async function deleteUserExperienceTag(tenantId: string, guid: string, id: number): Promise<void> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, guid);
  r.input("id",   mssql.Int, id);
  await r.query("DELETE FROM dbo.rmone_user_experience_tags WHERE tenant_id=@tid AND resource_guid=@guid AND id=@id");
}

// ── SYNONYM MAPPINGS ───────────────────────────────────────────────────────

export interface SynonymMappingRow {
  id: number;
  alias: string;
  canonicalField: string;
  tabType: string | null;
  isBuiltin: boolean;
  hitCount: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapSynonym(r: Record<string, unknown>): SynonymMappingRow {
  return {
    id:             Number(r.id ?? 0),
    alias:          String(r.alias ?? ""),
    canonicalField: String(r.canonical_field ?? ""),
    tabType:        (r.tab_type as string | null) ?? null,
    isBuiltin:      b(r.is_builtin),
    hitCount:       Number(r.hit_count ?? 1),
    createdBy:      (r.created_by as string | null) ?? null,
    createdAt:      r.created_at instanceof Date ? r.created_at : new Date(),
    updatedAt:      r.updated_at instanceof Date ? r.updated_at : new Date(),
  };
}

export async function getAllSynonymMappings(): Promise<SynonymMappingRow[]> {
  const r = await req();
  const res = await r.query("SELECT * FROM dbo.rmone_synonym_mappings ORDER BY alias");
  return res.recordset.map(mapSynonym);
}

export async function getSynonymMappingById(id: number): Promise<SynonymMappingRow | null> {
  const r = await req();
  r.input("id", mssql.Int, id);
  const res = await r.query("SELECT TOP 1 * FROM dbo.rmone_synonym_mappings WHERE id=@id");
  return res.recordset[0] ? mapSynonym(res.recordset[0]) : null;
}

export async function upsertSynonymMapping(data: {
  alias: string; canonicalField: string; tabType?: string | null;
  isBuiltin?: boolean; hitCount?: number; createdBy?: string | null;
}): Promise<SynonymMappingRow> {
  const r = await req();
  r.input("alias", mssql.NVarChar, data.alias);
  r.input("cf",    mssql.NVarChar, data.canonicalField);
  r.input("tt",    mssql.NVarChar, data.tabType ?? null);
  r.input("bui",   mssql.Bit, data.isBuiltin ? 1 : 0);
  r.input("hc",    mssql.Int, data.hitCount ?? 1);
  r.input("cb",    mssql.NVarChar, data.createdBy ?? null);
  const res = await r.query(`
    MERGE dbo.rmone_synonym_mappings AS T
    USING (SELECT @alias AS a, ISNULL(@tt,'') AS tt) AS S
      ON T.alias=S.a AND ISNULL(T.tab_type,'')=S.tt AND T.is_builtin=0
    WHEN MATCHED THEN UPDATE SET canonical_field=@cf,hit_count=hit_count+1,updated_at=GETUTCDATE()
    WHEN NOT MATCHED THEN INSERT (alias,canonical_field,tab_type,is_builtin,hit_count,created_by)
      VALUES (@alias,@cf,@tt,@bui,@hc,@cb)
    OUTPUT INSERTED.*;
  `);
  return mapSynonym(res.recordset[0]);
}

export async function updateSynonymMapping(id: number, patch: Partial<Pick<SynonymMappingRow,
  "alias" | "canonicalField" | "tabType" | "isBuiltin" | "hitCount"
>>): Promise<SynonymMappingRow | null> {
  const sets: string[] = ["updated_at=GETUTCDATE()"];
  const r = await req();
  r.input("id", mssql.Int, id);
  if ("alias"          in patch) { r.input("p_alias", mssql.NVarChar, patch.alias ?? null);         sets.push("alias=@p_alias"); }
  if ("canonicalField" in patch) { r.input("p_cf",    mssql.NVarChar, patch.canonicalField ?? null); sets.push("canonical_field=@p_cf"); }
  if ("tabType"        in patch) { r.input("p_tt",    mssql.NVarChar, patch.tabType ?? null);        sets.push("tab_type=@p_tt"); }
  if ("isBuiltin"      in patch) { r.input("p_bui",   mssql.Bit, patch.isBuiltin ? 1 : 0);           sets.push("is_builtin=@p_bui"); }
  if ("hitCount"       in patch) { r.input("p_hc",    mssql.Int, patch.hitCount ?? 0);               sets.push("hit_count=@p_hc"); }
  const res = await r.query(
    `UPDATE dbo.rmone_synonym_mappings SET ${sets.join(",")} OUTPUT INSERTED.* WHERE id=@id`,
  );
  return res.recordset[0] ? mapSynonym(res.recordset[0]) : null;
}

export async function deleteSynonymMapping(id: number): Promise<void> {
  const r = await req();
  r.input("id", mssql.Int, id);
  await r.query("DELETE FROM dbo.rmone_synonym_mappings WHERE id=@id");
}

// ── SUPERADMIN ACCOUNTS ────────────────────────────────────────────────────

export interface SuperadminAccountRow {
  email: string;
  addedBy: string | null;
  addedAt: Date;
}

function mapSuperadmin(r: Record<string, unknown>): SuperadminAccountRow {
  return {
    email:   String(r.email ?? ""),
    addedBy: (r.added_by as string | null) ?? null,
    addedAt: r.added_at instanceof Date ? r.added_at : new Date(),
  };
}

export async function getSuperadminEmails(): Promise<{ email: string }[]> {
  const r = await req();
  const res = await r.query("SELECT email FROM dbo.rmone_superadmin_accounts");
  return res.recordset.map((row: Record<string, unknown>) => ({ email: String(row.email) }));
}

export async function getAllSuperadminAccounts(): Promise<SuperadminAccountRow[]> {
  const r = await req();
  const res = await r.query("SELECT * FROM dbo.rmone_superadmin_accounts ORDER BY added_at DESC");
  return res.recordset.map(mapSuperadmin);
}

export async function insertSuperadminAccount(email: string, addedBy: string | null): Promise<void> {
  const r = await req();
  r.input("email",   mssql.NVarChar, email);
  r.input("addedBy", mssql.NVarChar, addedBy ?? null);
  await r.query(`
    IF NOT EXISTS (SELECT 1 FROM dbo.rmone_superadmin_accounts WHERE email=@email)
      INSERT INTO dbo.rmone_superadmin_accounts (email,added_by) VALUES (@email,@addedBy)
  `);
}

export async function deleteSuperadminAccount(email: string): Promise<void> {
  const r = await req();
  r.input("email", mssql.NVarChar, email);
  await r.query("DELETE FROM dbo.rmone_superadmin_accounts WHERE email=@email");
}

// ── TENANT STATUS ──────────────────────────────────────────────────────────

export interface TenantStatusRow {
  tenantId: string;
  isActive: boolean;
  note: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

function mapTenantStatus(r: Record<string, unknown>): TenantStatusRow {
  return {
    tenantId:  String(r.tenant_id ?? ""),
    isActive:  b(r.is_active),
    note:      (r.note as string | null) ?? null,
    updatedAt: r.updated_at instanceof Date ? r.updated_at : new Date(),
    updatedBy: (r.updated_by as string | null) ?? null,
  };
}

export async function getTenantStatus(tenantId: string): Promise<TenantStatusRow | null> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tenantId);
  const res = await r.query("SELECT TOP 1 * FROM dbo.rmone_tenant_status WHERE tenant_id=@tid");
  return res.recordset[0] ? mapTenantStatus(res.recordset[0]) : null;
}

export async function getTenantStatuses(tenantIds: string[]): Promise<TenantStatusRow[]> {
  if (!tenantIds.length) return [];
  const r = await req();
  const { clause, inputs } = inList(tenantIds);
  Object.entries(inputs).forEach(([k, v]) => r.input(k, mssql.NVarChar, v));
  const res = await r.query(`SELECT * FROM dbo.rmone_tenant_status WHERE tenant_id IN (${clause})`);
  return res.recordset.map(mapTenantStatus);
}

export async function deleteTenantStatus(tenantId: string): Promise<void> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tenantId);
  await r.query("DELETE FROM dbo.rmone_tenant_status WHERE tenant_id=@tid");
}

export async function upsertTenantStatus(data: TenantStatusRow): Promise<void> {
  const r = await req();
  r.input("tid", mssql.NVarChar, data.tenantId);
  r.input("act", mssql.Bit, data.isActive ? 1 : 0);
  r.input("note", mssql.NVarChar, data.note ?? null);
  r.input("upd",  mssql.NVarChar, data.updatedBy ?? null);
  await r.query(`
    MERGE dbo.rmone_tenant_status AS T
    USING (SELECT @tid AS tid) AS S ON T.tenant_id=S.tid
    WHEN MATCHED THEN UPDATE SET is_active=@act,note=@note,updated_by=@upd,updated_at=GETUTCDATE()
    WHEN NOT MATCHED THEN INSERT (tenant_id,is_active,note,updated_by) VALUES (@tid,@act,@note,@upd);
  `);
}

// ── ACTIVE TENANT REGISTRY (home-cache warming; survives restarts/deploys) ──

export interface ActiveTenantRow {
  tenantId: string;
  tenantLabel: string;
  lastActiveAt: number; // epoch ms
  /** JSON array of recently-opened project IDs (hot-projects re-warm set),
   *  e.g. `[{"id":"PMM-00012","at":1721500000000}]`. Null when unknown. */
  hotProjectsJson?: string | null;
}

export async function getActiveTenantRegistry(): Promise<ActiveTenantRow[]> {
  const r = await req();
  const res = await r.query("SELECT tenant_id, tenant_label, last_active_at, hot_projects FROM dbo.rmone_active_tenants");
  return res.recordset.map((row: Record<string, unknown>) => ({
    tenantId:     String(row.tenant_id ?? ""),
    tenantLabel:  String(row.tenant_label ?? ""),
    lastActiveAt: row.last_active_at instanceof Date ? row.last_active_at.getTime() : 0,
    hotProjectsJson: row.hot_projects == null ? null : String(row.hot_projects),
  }));
}

/** Upsert registry rows. last_active_at only ever moves FORWARD so a stale
 *  worker snapshot can never rewind a fresher login recorded by another
 *  worker or instance. hot_projects is only overwritten when the snapshot
 *  actually carries one (COALESCE) so a caller without hot data can't wipe it. */
export async function upsertActiveTenantRegistry(rows: ActiveTenantRow[]): Promise<void> {
  for (const row of rows) {
    if (!row.tenantId || !row.tenantLabel) continue;
    const r = await req();
    r.input("tid",   mssql.NVarChar, row.tenantId);
    r.input("label", mssql.NVarChar, row.tenantLabel);
    r.input("at",    mssql.DateTime2, new Date(row.lastActiveAt));
    r.input("hot",   mssql.NVarChar(mssql.MAX), row.hotProjectsJson ?? null);
    await r.query(`
      MERGE dbo.rmone_active_tenants AS T
      USING (SELECT @tid AS tid) AS S ON T.tenant_id=S.tid
      WHEN MATCHED THEN UPDATE SET
        tenant_label=@label,
        last_active_at=CASE WHEN @at > T.last_active_at THEN @at ELSE T.last_active_at END,
        hot_projects=COALESCE(@hot, T.hot_projects)
      WHEN NOT MATCHED THEN INSERT (tenant_id,tenant_label,last_active_at,hot_projects) VALUES (@tid,@label,@at,@hot);
    `);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat sessions — cross-device persistent chat history
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatSessionRow {
  sessionId: string;
  title: string;
  messages: string;
  lastActivity: number;
  createdAt: Date;
}

export async function getChatSessions(tenant: string, username: string): Promise<ChatSessionRow[]> {
  const r = await req();
  r.input("tenant",   mssql.NVarChar, tenant.toLowerCase());
  r.input("username", mssql.NVarChar, username.toLowerCase());
  const res = await r.query<{ session_id: string; title: string; messages: string; last_activity: number; created_at: Date }>(
    `SELECT session_id, title, messages, last_activity, created_at
     FROM dbo.rmone_chat_sessions
     WHERE tenant=@tenant AND username=@username
     ORDER BY last_activity DESC`,
  );
  return res.recordset.map(row => ({
    sessionId: row.session_id,
    title: row.title,
    messages: row.messages,
    lastActivity: Number(row.last_activity),
    createdAt: row.created_at,
  }));
}

export async function upsertChatSession(
  tenant: string,
  username: string,
  session: { sessionId: string; title: string; messages: string; lastActivity: number },
): Promise<void> {
  const r = await req();
  r.input("tenant",        mssql.NVarChar, tenant.toLowerCase());
  r.input("username",      mssql.NVarChar, username.toLowerCase());
  r.input("session_id",    mssql.NVarChar, session.sessionId);
  r.input("title",         mssql.NVarChar, session.title.slice(0, 500));
  r.input("messages",      mssql.NVarChar(mssql.MAX), session.messages);
  r.input("last_activity", mssql.BigInt,   session.lastActivity);
  await r.query(`
    MERGE dbo.rmone_chat_sessions AS T
    USING (SELECT @tenant AS tenant, @username AS username, @session_id AS session_id) AS S
      ON T.tenant=S.tenant AND T.username=S.username AND T.session_id=S.session_id
    WHEN MATCHED THEN
      UPDATE SET title=@title, messages=@messages, last_activity=@last_activity
    WHEN NOT MATCHED THEN
      INSERT (tenant, username, session_id, title, messages, last_activity)
      VALUES (@tenant, @username, @session_id, @title, @messages, @last_activity);
  `);
}

export async function deleteChatSession(tenant: string, username: string, sessionId: string): Promise<void> {
  const r = await req();
  r.input("tenant",     mssql.NVarChar, tenant.toLowerCase());
  r.input("username",   mssql.NVarChar, username.toLowerCase());
  r.input("session_id", mssql.NVarChar, sessionId);
  await r.query(
    `DELETE FROM dbo.rmone_chat_sessions WHERE tenant=@tenant AND username=@username AND session_id=@session_id`,
  );
}

export async function pruneOldChatSessions(tenant: string, username: string, keepCount = 20): Promise<void> {
  const r = await req();
  r.input("tenant",   mssql.NVarChar, tenant.toLowerCase());
  r.input("username", mssql.NVarChar, username.toLowerCase());
  r.input("keep",     mssql.Int,      keepCount);
  await r.query(`
    DELETE FROM dbo.rmone_chat_sessions
    WHERE tenant=@tenant AND username=@username
      AND session_id NOT IN (
        SELECT TOP (@keep) session_id
        FROM dbo.rmone_chat_sessions
        WHERE tenant=@tenant AND username=@username
        ORDER BY last_activity DESC
      )
  `);
}

// ── ALLOCATION TEMPLATES ────────────────────────────────────────────────────

export interface AllocationTemplateSlot {
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

export interface AllocationTemplate {
  id: number;
  tenantId: string;
  name: string;
  createdBy: string | null;
  createdAt: Date;
  slots: AllocationTemplateSlot[];
}

function mapTemplateSlot(r: Record<string, unknown>): AllocationTemplateSlot {
  return {
    id:           Number(r.id ?? 0),
    buName:       (r.bu_name as string | null) ?? null,
    divisionName: (r.division_name as string | null) ?? null,
    deptName:     (r.dept_name as string | null) ?? null,
    roleName:     (r.role_name as string | null) ?? null,
    jobTitleName: (r.job_title_name as string | null) ?? null,
    defaultPct:   Number(r.default_pct ?? 100),
    sortOrder:    Number(r.sort_order ?? 0),
    resourceId:   (r.resource_id as string | null) ?? null,
  };
}

export async function getAllocationTemplates(tenantId: string): Promise<AllocationTemplate[]> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tenantId);
  const tRes = await r.query(
    `SELECT * FROM dbo.rmone_allocation_templates WHERE tenant_id=@tid ORDER BY created_at DESC`,
  );
  if (tRes.recordset.length === 0) return [];
  const r2 = await req();
  r2.input("tid", mssql.NVarChar, tenantId);
  const sRes = await r2.query(
    `SELECT s.* FROM dbo.rmone_allocation_template_slots s
     JOIN dbo.rmone_allocation_templates t ON t.id = s.template_id
     WHERE t.tenant_id=@tid ORDER BY s.template_id, s.sort_order`,
  );
  const slotsByTemplate = new Map<number, AllocationTemplateSlot[]>();
  for (const row of sRes.recordset as Record<string, unknown>[]) {
    const tid2 = Number((row as any).template_id);
    if (!slotsByTemplate.has(tid2)) slotsByTemplate.set(tid2, []);
    slotsByTemplate.get(tid2)!.push(mapTemplateSlot(row));
  }
  return tRes.recordset.map((t: any) => ({
    id:        Number(t.id),
    tenantId:  String(t.tenant_id ?? ""),
    name:      String(t.name ?? ""),
    createdBy: (t.created_by as string | null) ?? null,
    createdAt: t.created_at instanceof Date ? t.created_at : new Date(),
    slots:     slotsByTemplate.get(Number(t.id)) ?? [],
  }));
}

export async function createAllocationTemplate(
  tenantId: string,
  name: string,
  createdBy: string,
  slots: Omit<AllocationTemplateSlot, "id">[],
): Promise<number> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("name", mssql.NVarChar, name);
  r.input("by",   mssql.NVarChar, createdBy);
  const ins = await r.query(
    `INSERT INTO dbo.rmone_allocation_templates (tenant_id, name, created_by)
     OUTPUT INSERTED.id VALUES (@tid, @name, @by)`,
  );
  const templateId = Number(ins.recordset[0].id);
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const r2 = await req();
    r2.input("tid",   mssql.Int,      templateId);
    r2.input("bu",    mssql.NVarChar, s.buName ?? null);
    r2.input("div",   mssql.NVarChar, s.divisionName ?? null);
    r2.input("dept",  mssql.NVarChar, s.deptName ?? null);
    r2.input("role",  mssql.NVarChar, s.roleName ?? null);
    r2.input("title", mssql.NVarChar, s.jobTitleName ?? null);
    r2.input("pct",   mssql.Int,      s.defaultPct ?? 100);
    r2.input("ord",   mssql.Int,      i);
    r2.input("rid",   mssql.NVarChar, (s as AllocationTemplateSlot).resourceId ?? null);
    await r2.query(
      `INSERT INTO dbo.rmone_allocation_template_slots
       (template_id, bu_name, division_name, dept_name, role_name, job_title_name, default_pct, sort_order, resource_id)
       VALUES (@tid, @bu, @div, @dept, @role, @title, @pct, @ord, @rid)`,
    );
  }
  return templateId;
}

export async function updateAllocationTemplate(
  tenantId: string,
  id: number,
  name: string,
  slots: Omit<AllocationTemplateSlot, "id">[],
): Promise<void> {
  const rn = await req();
  rn.input("tid",  mssql.NVarChar, tenantId);
  rn.input("id",   mssql.Int,      id);
  rn.input("name", mssql.NVarChar, name);
  await rn.query(`UPDATE dbo.rmone_allocation_templates SET name=@name WHERE id=@id AND tenant_id=@tid`);
  const rd = await req();
  rd.input("id", mssql.Int, id);
  await rd.query(`DELETE FROM dbo.rmone_allocation_template_slots WHERE template_id=@id`);
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const r2 = await req();
    r2.input("tid",   mssql.Int,      id);
    r2.input("bu",    mssql.NVarChar, s.buName ?? null);
    r2.input("div",   mssql.NVarChar, s.divisionName ?? null);
    r2.input("dept",  mssql.NVarChar, s.deptName ?? null);
    r2.input("role",  mssql.NVarChar, s.roleName ?? null);
    r2.input("title", mssql.NVarChar, s.jobTitleName ?? null);
    r2.input("pct",   mssql.Int,      s.defaultPct ?? 100);
    r2.input("ord",   mssql.Int,      i);
    r2.input("rid",   mssql.NVarChar, (s as AllocationTemplateSlot).resourceId ?? null);
    await r2.query(
      `INSERT INTO dbo.rmone_allocation_template_slots
       (template_id, bu_name, division_name, dept_name, role_name, job_title_name, default_pct, sort_order, resource_id)
       VALUES (@tid, @bu, @div, @dept, @role, @title, @pct, @ord, @rid)`,
    );
  }
}

export async function deleteAllocationTemplate(tenantId: string, id: number): Promise<void> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tenantId);
  r.input("id",  mssql.Int,     id);
  await r.query(`DELETE FROM dbo.rmone_allocation_template_slots WHERE template_id=@id`);
  await r.query(`DELETE FROM dbo.rmone_allocation_templates WHERE id=@id AND tenant_id=@tid`);
}

// ── RESOURCE AVAILABILITY (leave / partial availability windows) ────────────
// Each row is a date window during which a person is unavailable (0%) or
// partially available (1-99%). 100% windows are pointless and rejected at the
// route layer. Keyed like the other enrichment tables: tenant tid + AspNetUsers
// GUID. Dates are DATE-only (no time component).

export interface ResourceAvailabilityRow {
  id: number;
  tenantId: string;
  resourceGuid: string;
  startDate: string;        // "YYYY-MM-DD"
  endDate: string;          // "YYYY-MM-DD"
  availabilityPct: number;  // 0 = fully out, 50 = half-time, etc.
  reason: string | null;
  leaveType: string | null; // e.g. "PTO", "Vacation", "Jury Duty" — see LEAVE_TYPES
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Canonical leave-type values shared by DB, API, and UI. */
export const LEAVE_TYPES = {
  timeOff: [
    "Bereavement Leave",
    "Executive PTO",
    "Jury Duty",
    "Military Leave",
    "PTO",
    "PTO - Regular PT",
    "PTO HR",
    "Unpaid Time Off",
    "Vacation - Union",
    "Vacation - Union 15 Days",
  ],
  other: ["Admin", "Training"],
} as const;

function dateOnly(v: unknown): string {
  if (v instanceof Date) {
    // DATE columns come back as UTC-midnight Date objects — format via UTC
    // getters so the calendar day never shifts with server timezone.
    const y = v.getUTCFullYear(), m = String(v.getUTCMonth() + 1).padStart(2, "0"), d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v ?? "").slice(0, 10);
}

function mapResourceAvailability(r: Record<string, unknown>): ResourceAvailabilityRow {
  return {
    id:              Number(r.id ?? 0),
    tenantId:        String(r.tenant_id ?? ""),
    resourceGuid:    String(r.resource_guid ?? ""),
    startDate:       dateOnly(r.start_date),
    endDate:         dateOnly(r.end_date),
    availabilityPct: Number(r.availability_pct ?? 0),
    reason:          (r.reason as string | null) ?? null,
    leaveType:       (r.leave_type as string | null) ?? null,
    createdBy:       (r.created_by as string | null) ?? null,
    createdAt:       r.created_at instanceof Date ? r.created_at : new Date(),
    updatedAt:       r.updated_at instanceof Date ? r.updated_at : new Date(),
  };
}

/**
 * Idempotent: adds the leave_type column to rmone_resource_availability if it
 * doesn't exist yet. Called once on server startup via resources.ts.
 */
export async function ensureLeaveTypeColumn(): Promise<void> {
  const r = await req();
  await r.query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.rmone_resource_availability')
        AND name = 'leave_type'
    )
      ALTER TABLE dbo.rmone_resource_availability
        ADD leave_type NVARCHAR(100) NULL;
  `);
  // One window per (tenant, person, start, end): dedupe any legacy duplicate
  // rows (keep the oldest id), then back the invariant with a unique index so
  // concurrent POSTs can never stack the same dates twice.
  const r2 = await req();
  await r2.query(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_res_avail_dates_uniq_idx')
    BEGIN
      DELETE d FROM dbo.rmone_resource_availability d
      WHERE EXISTS (
        SELECT 1 FROM dbo.rmone_resource_availability k
        WHERE k.tenant_id=d.tenant_id AND k.resource_guid=d.resource_guid
          AND k.start_date=d.start_date AND k.end_date=d.end_date AND k.id < d.id);
      CREATE UNIQUE INDEX rmone_res_avail_dates_uniq_idx
        ON dbo.rmone_resource_availability(tenant_id, resource_guid, start_date, end_date);
    END
  `);
}

export async function getResourceAvailabilityByGuid(tenantId: string, guid: string): Promise<ResourceAvailabilityRow[]> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, guid);
  const res = await r.query(
    "SELECT * FROM dbo.rmone_resource_availability WHERE tenant_id=@tid AND resource_guid=@guid ORDER BY start_date",
  );
  return res.recordset.map(mapResourceAvailability);
}

export async function getResourceAvailabilityByTenant(tenantId: string): Promise<ResourceAvailabilityRow[]> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tenantId);
  const res = await r.query(
    "SELECT * FROM dbo.rmone_resource_availability WHERE tenant_id=@tid ORDER BY resource_guid, start_date",
  );
  return res.recordset.map(mapResourceAvailability);
}

export async function insertResourceAvailability(
  data: Omit<ResourceAvailabilityRow, "id" | "createdAt" | "updatedAt">,
): Promise<ResourceAvailabilityRow> {
  const r = await req();
  r.input("tid",   mssql.NVarChar, data.tenantId);
  r.input("guid",  mssql.NVarChar, data.resourceGuid);
  r.input("sd",    mssql.Date,     data.startDate);
  r.input("ed",    mssql.Date,     data.endDate);
  r.input("pct",   mssql.Int,      data.availabilityPct);
  r.input("rsn",   mssql.NVarChar, data.reason ?? null);
  r.input("lt",    mssql.NVarChar, data.leaveType ?? null);
  r.input("by",    mssql.NVarChar, data.createdBy ?? null);
  const res = await r.query(`
    INSERT INTO dbo.rmone_resource_availability
      (tenant_id, resource_guid, start_date, end_date, availability_pct, reason, leave_type, created_by)
    OUTPUT INSERTED.*
    VALUES (@tid, @guid, @sd, @ed, @pct, @rsn, @lt, @by);
  `);
  return mapResourceAvailability(res.recordset[0]);
}

/**
 * Date-idempotent create: one window per (tenant, person, start, end). A row
 * with the same dates is UPDATED in place; otherwise a new row is inserted.
 * The unique index rmone_res_avail_dates_uniq_idx backstops concurrent
 * requests — a duplicate-key insert loses the race and converges as an update.
 */
export async function upsertResourceAvailabilityByDates(
  data: Omit<ResourceAvailabilityRow, "id" | "createdAt" | "updatedAt">,
): Promise<{ row: ResourceAvailabilityRow; deduped: boolean }> {
  const tryUpdate = async (): Promise<ResourceAvailabilityRow | null> => {
    const r = await req();
    r.input("tid",  mssql.NVarChar, data.tenantId);
    r.input("guid", mssql.NVarChar, data.resourceGuid);
    r.input("sd",   mssql.Date,     data.startDate);
    r.input("ed",   mssql.Date,     data.endDate);
    r.input("pct",  mssql.Int,      data.availabilityPct);
    r.input("rsn",  mssql.NVarChar, data.reason ?? null);
    r.input("lt",   mssql.NVarChar, data.leaveType ?? null);
    const res = await r.query(`
      UPDATE dbo.rmone_resource_availability
      SET availability_pct=@pct, reason=@rsn, leave_type=@lt, updated_at=GETUTCDATE()
      OUTPUT INSERTED.*
      WHERE tenant_id=@tid AND LOWER(resource_guid)=LOWER(@guid)
        AND start_date=@sd AND end_date=@ed;
    `);
    return res.recordset[0] ? mapResourceAvailability(res.recordset[0]) : null;
  };
  const updated = await tryUpdate();
  if (updated) return { row: updated, deduped: true };
  try {
    return { row: await insertResourceAvailability(data), deduped: false };
  } catch (e) {
    // 2601/2627 = unique-key violation: a concurrent request inserted the
    // same dates between our UPDATE miss and this INSERT — converge on update.
    const num = (e as { number?: number })?.number;
    const msg = String((e as Error)?.message ?? "");
    if (num === 2601 || num === 2627 || /duplicate key|unique index/i.test(msg)) {
      const row = await tryUpdate();
      if (row) return { row, deduped: true };
    }
    throw e;
  }
}

export async function updateResourceAvailability(
  tenantId: string,
  resourceGuid: string,
  id: number,
  patch: { startDate?: string; endDate?: string; availabilityPct?: number; reason?: string | null; leaveType?: string | null },
): Promise<ResourceAvailabilityRow | null> {
  const sets: string[] = ["updated_at=GETUTCDATE()"];
  const r = await req();
  r.input("tid", mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, resourceGuid);
  r.input("id",  mssql.Int, id);
  if (patch.startDate !== undefined)       { sets.push("start_date=@sd");        r.input("sd",  mssql.Date,     patch.startDate); }
  if (patch.endDate !== undefined)         { sets.push("end_date=@ed");          r.input("ed",  mssql.Date,     patch.endDate); }
  if (patch.availabilityPct !== undefined) { sets.push("availability_pct=@pct"); r.input("pct", mssql.Int,      patch.availabilityPct); }
  if (patch.reason !== undefined)          { sets.push("reason=@rsn");           r.input("rsn", mssql.NVarChar, patch.reason); }
  if (patch.leaveType !== undefined)       { sets.push("leave_type=@lt");        r.input("lt",  mssql.NVarChar, patch.leaveType); }
  const res = await r.query(
    `UPDATE dbo.rmone_resource_availability SET ${sets.join(",")}
     OUTPUT INSERTED.* WHERE id=@id AND tenant_id=@tid AND LOWER(resource_guid)=LOWER(@guid);`,
  );
  return res.recordset[0] ? mapResourceAvailability(res.recordset[0]) : null;
}

export async function deleteResourceAvailability(tenantId: string, resourceGuid: string, id: number): Promise<boolean> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tenantId);
  r.input("guid", mssql.NVarChar, resourceGuid);
  r.input("id",  mssql.Int, id);
  const res = await r.query(
    "DELETE FROM dbo.rmone_resource_availability WHERE id=@id AND tenant_id=@tid AND LOWER(resource_guid)=LOWER(@guid)");
  return (res.rowsAffected?.[0] ?? 0) > 0;
}

// ── OFFICES (staff directory office values) ─────────────────────────────────
// Offices are stored denormalized on rmone_users.office; the curated master
// list lives in a settings doc. These helpers report usage and propagate a
// rename across the directory.

export async function getOfficeUsage(tid: string): Promise<Array<{ office: string; count: number }>> {
  const r = await req();
  r.input("tid", mssql.NVarChar, tid);
  const res = await r.query(
    `SELECT office, COUNT(*) AS cnt FROM dbo.rmone_users
     WHERE tenant_id=@tid AND deleted=0 AND office IS NOT NULL AND LTRIM(RTRIM(office)) <> ''
     GROUP BY office`,
  );
  return res.recordset.map((row: Record<string, unknown>) => ({
    office: String(row.office ?? "").trim(),
    count: Number(row.cnt ?? 0),
  }));
}

export async function renameOfficeForTenant(tid: string, from: string, to: string): Promise<number> {
  const r = await req();
  r.input("tid",  mssql.NVarChar, tid);
  r.input("from", mssql.NVarChar, from);
  r.input("to",   mssql.NVarChar, to);
  const res = await r.query(
    `UPDATE dbo.rmone_users SET office=@to, updated_at=GETUTCDATE()
     WHERE tenant_id=@tid AND deleted=0 AND office=@from`,
  );
  return Number(res.rowsAffected?.[0] ?? 0);
}

/** Atomic rename snapshot for every affected staff row. */
export async function renameOfficeForTenantWithSnapshots(
  tid: string,
  from: string,
  to: string,
): Promise<UserOfficeSnapshot[]> {
  return withTransaction(async (r) => {
    r.input("tid", mssql.NVarChar, tid);
    r.input("from", mssql.NVarChar, from);
    r.input("to", mssql.NVarChar, to);
    const out = await r.query(`
      DECLARE @before TABLE (id NVARCHAR(450) PRIMARY KEY, office NVARCHAR(4000));
      INSERT INTO @before (id, office)
        SELECT id, office FROM dbo.rmone_users WITH (UPDLOCK, HOLDLOCK)
        WHERE tenant_id=@tid AND deleted=0 AND office=@from;
      UPDATE dbo.rmone_users SET office=@to, updated_at=GETUTCDATE()
        WHERE tenant_id=@tid AND deleted=0 AND office=@from;
      SELECT b.id, b.office AS beforeOffice, u.office AS afterOffice
        FROM @before b
        JOIN dbo.rmone_users u ON u.tenant_id=@tid AND u.id=b.id
        ORDER BY b.id;
    `);
    return (out.recordset ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      beforeOffice: row.beforeOffice == null ? null : String(row.beforeOffice),
      afterOffice: row.afterOffice == null ? null : String(row.afterOffice),
    }));
  });
}

// ── STAGE CONFIG (per-record status customizations) ─────────────────────────
// Stores the drag-order, custom statuses, removed statuses, and sub-statuses
// that users configure on the Override Status modal. Keyed per tenant +
// record + status-field so configs for different status columns never collide.

export async function getStageCfg(
  tenantId: string,
  recordId: string,
  statusField: string,
): Promise<object | null> {
  await bootstrapDatabase();
  const r = (await getMssqlPool()).request();
  r.input("tid",   mssql.NVarChar, tenantId);
  r.input("rid",   mssql.NVarChar, recordId);
  r.input("field", mssql.NVarChar, statusField);
  const res = await r.query(
    `SELECT cfg FROM dbo.rmone_stage_cfg
     WHERE tenant_id=@tid AND record_id=@rid AND status_field=@field`,
  );
  if (!res.recordset.length) return null;
  try { return JSON.parse(String(res.recordset[0].cfg ?? "null")) as object; } catch { return null; }
}

export async function saveStageCfg(
  tenantId: string,
  recordId: string,
  statusField: string,
  cfg: object,
): Promise<void> {
  await bootstrapDatabase();
  const r = (await getMssqlPool()).request();
  r.input("tid",   mssql.NVarChar, tenantId);
  r.input("rid",   mssql.NVarChar, recordId);
  r.input("field", mssql.NVarChar, statusField);
  r.input("cfg",   mssql.NVarChar, JSON.stringify(cfg));
  await r.query(`
    MERGE dbo.rmone_stage_cfg WITH (HOLDLOCK) AS t
    USING (SELECT @tid AS tid, @rid AS rid, @field AS field) AS s
      ON t.tenant_id=s.tid AND t.record_id=s.rid AND t.status_field=s.field
    WHEN MATCHED THEN
      UPDATE SET cfg=@cfg, updated_at=GETUTCDATE()
    WHEN NOT MATCHED THEN
      INSERT (tenant_id, record_id, status_field, cfg) VALUES (@tid, @rid, @field, @cfg);
  `);
}

// ── Org-entity provenance ────────────────────────────────────────────────────
// Which uploaded file (or manual action) FIRST introduced each Business Unit /
// Division / Department for a tenant. First-seen wins: recordOrgProvenance is
// insert-if-absent, so a later re-import that mentions the same names never
// overwrites the original attribution. tenant_id = the tenant GUID (same key
// core2 rows use), entity names are stored with their display casing but the
// PK is effectively case-insensitive (SQL Server default CI collation).
export interface OrgProvenanceInput {
  tenantId: string;
  entityType: "bu" | "division" | "department" | "job_title";
  entityName: string;
  source: string;            // "import" | "manual" | "org-upload" | "traced"
  fileName?: string | null;
  uploadId?: string | null;
  createdBy?: string | null;
}

export interface OrgProvenanceRow {
  entityType: string;
  entityName: string;
  source: string;
  fileName: string | null;
  uploadId: string | null;
  createdBy: string | null;
  createdAt: Date | null;
}

/** Insert-if-absent provenance rows. Returns the number actually inserted. */
export async function recordOrgProvenance(rows: OrgProvenanceInput[]): Promise<number> {
  let inserted = 0;
  for (const row of rows) {
    const name = (row.entityName ?? "").trim().slice(0, 256);
    if (!name) continue;
    try {
      const r = await req();
      r.input("tid",  mssql.NVarChar, (row.tenantId ?? "").trim().slice(0, 64));
      r.input("ty",   mssql.NVarChar, row.entityType);
      r.input("n",    mssql.NVarChar, name);
      r.input("src",  mssql.NVarChar, (row.source ?? "unknown").slice(0, 30));
      r.input("file", mssql.NVarChar, row.fileName ?? null);
      r.input("up",   mssql.NVarChar, row.uploadId ?? null);
      r.input("by",   mssql.NVarChar, row.createdBy ?? null);
      const res = await r.query(`
        INSERT INTO dbo.rmone_org_provenance (tenant_id, entity_type, entity_name, source, file_name, upload_id, created_by)
        SELECT @tid, @ty, @n, @src, @file, @up, @by
        WHERE NOT EXISTS (
          SELECT 1 FROM dbo.rmone_org_provenance
          WHERE tenant_id = @tid AND entity_type = @ty AND entity_name = @n
        )`);
      inserted += res.rowsAffected?.[0] ?? 0;
    } catch (e) {
      // Best-effort: provenance must never break the write path that records it.
      console.warn("[appdb] recordOrgProvenance warn:", String(e).slice(0, 200));
    }
  }
  return inserted;
}

export async function getOrgProvenance(tenantId: string): Promise<OrgProvenanceRow[]> {
  const r = await req();
  r.input("tid", mssql.NVarChar, (tenantId ?? "").trim().slice(0, 64));
  const res = await r.query(`
    SELECT entity_type, entity_name, source, file_name, upload_id, created_by, created_at
    FROM dbo.rmone_org_provenance WITH (NOLOCK)
    WHERE tenant_id = @tid`);
  return (res.recordset ?? []).map((row: Record<string, unknown>) => ({
    entityType: String(row.entity_type ?? ""),
    entityName: String(row.entity_name ?? ""),
    source:     String(row.source ?? ""),
    fileName:   (row.file_name as string | null) ?? null,
    uploadId:   (row.upload_id as string | null) ?? null,
    createdBy:  (row.created_by as string | null) ?? null,
    createdAt:  row.created_at instanceof Date ? row.created_at : null,
  }));
}

// ── Import identity aliases + needs-attention review queue ─────────────────
// Aliases: remembered "same person / same project?" answers, consulted by the
// import pipeline so a once-answered spelling never prompts again.
// Review items: rows an upload could not place safely; nothing is imported for
// them until an admin decides. See rmone_identity_aliases / rmone_import_review
// DDL in bootstrap.ts.

export interface IdentityAlias {
  kind: "person" | "project" | "company";
  aliasKey: string;
  targetKey: string;      // person: user GUID · project: TicketId · company: CRMCompany.ID (numeric string)
  targetLabel: string | null;
  decision: "merge" | "new";
}

export async function getIdentityAliases(
  tenantId: string, kind?: "person" | "project" | "company",
): Promise<IdentityAlias[]> {
  const rq = await req();
  rq.input("tid", tenantId);
  let q = `SELECT kind, alias_key, target_key, target_label, decision
           FROM dbo.rmone_identity_aliases WHERE tenant_id=@tid`;
  if (kind) { rq.input("kind", kind); q += ` AND kind=@kind`; }
  const r = await rq.query(q);
  return (r.recordset as Array<Record<string, unknown>>).map((row) => ({
    kind:        (row.kind as "person" | "project" | "company"),
    aliasKey:    String(row.alias_key ?? ""),
    targetKey:   String(row.target_key ?? ""),
    targetLabel: (row.target_label as string | null) ?? null,
    decision:    ((row.decision as string) === "new" ? "new" : "merge"),
  }));
}

export async function upsertIdentityAlias(a: {
  tenantId: string; kind: "person" | "project" | "company"; aliasKey: string;
  targetKey: string; targetLabel?: string | null;
  decision?: "merge" | "new"; createdBy?: string | null;
}): Promise<void> {
  const rq = await req();
  rq.input("tid",  a.tenantId);
  rq.input("kind", a.kind);
  rq.input("ak",   a.aliasKey);
  rq.input("tk",   a.targetKey);
  rq.input("tl",   a.targetLabel ?? null);
  rq.input("dec",  a.decision ?? "merge");
  rq.input("by",   a.createdBy ?? null);
  await rq.query(`MERGE dbo.rmone_identity_aliases WITH (HOLDLOCK) AS t
    USING (SELECT @tid AS tenant_id, @kind AS kind, @ak AS alias_key) AS s
      ON t.tenant_id=s.tenant_id AND t.kind=s.kind AND t.alias_key=s.alias_key
    WHEN MATCHED THEN UPDATE SET target_key=@tk, target_label=@tl, decision=@dec, created_by=@by
    WHEN NOT MATCHED THEN INSERT (tenant_id, kind, alias_key, target_key, target_label, decision, created_by)
      VALUES (@tid, @kind, @ak, @tk, @tl, @dec, @by);`);
}

export interface ImportReviewItem {
  id: number;
  tenantId: string;
  uploadId: string | null;
  kind: string;           // 'person-match' | 'project-ref' | 'project-collision'
  rowKey: string;
  displayLabel: string | null;
  reason: string | null;
  suggestions: unknown[];
  row: unknown;
  rowCount: number;
  sheetName: string | null;
  status: "open" | "resolved" | "dismissed";
  resolution: unknown | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date | null;
}

function mapImportReviewRow(row: Record<string, unknown>): ImportReviewItem {
  return {
    id:           Number(row.id),
    tenantId:     String(row.tenant_id ?? ""),
    uploadId:     (row.upload_id as string | null) ?? null,
    kind:         String(row.kind ?? ""),
    rowKey:       String(row.row_key ?? ""),
    displayLabel: (row.display_label as string | null) ?? null,
    reason:       (row.reason as string | null) ?? null,
    suggestions:  jParse<unknown[]>(row.suggestion_json as string | null, []),
    row:          jParse<unknown>(row.row_json as string | null, null),
    rowCount:     Number(row.row_count ?? 1),
    sheetName:    (row.sheet_name as string | null) ?? null,
    status:       ((row.status as string) === "resolved" ? "resolved"
                   : (row.status as string) === "dismissed" ? "dismissed" : "open"),
    resolution:   jParse<unknown>(row.resolution_json as string | null, null),
    resolvedBy:   (row.resolved_by as string | null) ?? null,
    resolvedAt:   row.resolved_at instanceof Date ? row.resolved_at : null,
    createdAt:    row.created_at instanceof Date ? row.created_at : null,
  };
}

/** Insert (or refresh) review items. One OPEN item per (tenant, kind, row_key):
 *  a re-upload that hits the same unresolved key refreshes the existing open
 *  item (row_count is SET, not summed — it reflects the latest upload). */
export async function addImportReviewItems(items: Array<{
  tenantId: string; uploadId?: string | null; kind: string; rowKey: string;
  displayLabel?: string | null; reason?: string | null;
  suggestions?: unknown; row?: unknown; rowCount?: number; sheetName?: string | null;
}>): Promise<void> {
  for (const it of items) {
    const rq = await req();
    rq.input("tid",    it.tenantId);
    rq.input("up",     it.uploadId ?? null);
    rq.input("kind",   it.kind);
    rq.input("rk",     it.rowKey);
    rq.input("dl",     it.displayLabel ?? null);
    rq.input("reason", it.reason ?? null);
    rq.input("sug",    jStr(it.suggestions ?? []));
    rq.input("row",    jStr(it.row ?? null));
    rq.input("n",      it.rowCount ?? 1);
    rq.input("sheet",  it.sheetName ?? null);
    await rq.query(`UPDATE dbo.rmone_import_review
        SET row_count=@n, upload_id=@up, display_label=@dl, reason=@reason,
            suggestion_json=@sug, row_json=@row, sheet_name=@sheet, created_at=GETUTCDATE()
      WHERE tenant_id=@tid AND kind=@kind AND row_key=@rk AND status='open';
      IF @@ROWCOUNT = 0
      INSERT INTO dbo.rmone_import_review
        (tenant_id, upload_id, kind, row_key, display_label, reason, suggestion_json, row_json, row_count, sheet_name)
      VALUES (@tid, @up, @kind, @rk, @dl, @reason, @sug, @row, @n, @sheet);`);
  }
}

export async function listImportReview(
  tenantId: string, opts?: { status?: string; uploadId?: string },
): Promise<ImportReviewItem[]> {
  const rq = await req();
  rq.input("tid", tenantId);
  let q = `SELECT * FROM dbo.rmone_import_review WHERE tenant_id=@tid`;
  if (opts?.status)   { rq.input("st", opts.status);   q += ` AND status=@st`; }
  if (opts?.uploadId) { rq.input("up", opts.uploadId); q += ` AND upload_id=@up`; }
  q += ` ORDER BY created_at DESC, id DESC`;
  const r = await rq.query(q);
  return (r.recordset as Array<Record<string, unknown>>).map(mapImportReviewRow);
}

export async function countOpenImportReview(tenantId: string): Promise<number> {
  const rq = await req();
  rq.input("tid", tenantId);
  const r = await rq.query(`SELECT COUNT(*) AS n FROM dbo.rmone_import_review WHERE tenant_id=@tid AND status='open'`);
  return Number(r.recordset[0]?.n ?? 0);
}

export async function getImportReviewItem(id: number): Promise<ImportReviewItem | null> {
  const rq = await req();
  rq.input("id", id);
  const r = await rq.query(`SELECT * FROM dbo.rmone_import_review WHERE id=@id`);
  const row = (r.recordset as Array<Record<string, unknown>>)[0];
  return row ? mapImportReviewRow(row) : null;
}

export async function resolveImportReviewItem(id: number, res: {
  status: "resolved" | "dismissed"; resolution?: unknown; resolvedBy?: string | null;
}): Promise<boolean> {
  const rq = await req();
  rq.input("id", id);
  rq.input("st", res.status);
  rq.input("rj", jStr(res.resolution ?? null));
  rq.input("by", res.resolvedBy ?? null);
  const r = await rq.query(`UPDATE dbo.rmone_import_review
      SET status=@st, resolution_json=@rj, resolved_by=@by, resolved_at=GETUTCDATE()
    WHERE id=@id AND status='open'`);
  return (r.rowsAffected?.[0] ?? 0) > 0;
}

/** Bulk-remove remembered aliases of one kind for a tenant. Used by the
 *  "start over" wipe: project aliases point at TicketIds that no longer exist
 *  after the wipe, so keeping them would silently redirect future uploads to
 *  dead records. Person aliases survive a start-over (people are kept). */
export async function deleteIdentityAliasesByKind(
  tenantId: string,
  kind: "person" | "project",
): Promise<number> {
  const rq = await req();
  rq.input("tid", tenantId);
  rq.input("k", kind);
  const r = await rq.query(
    `DELETE FROM dbo.rmone_identity_aliases WHERE tenant_id=@tid AND kind=@k`,
  );
  return r.rowsAffected?.[0] ?? 0;
}

/** Dismiss every open "needs attention" item for a tenant (start-over wipe:
 *  the records the suggestions point at are gone; re-uploading after the
 *  wipe regenerates anything still relevant). */
export async function dismissAllOpenImportReview(
  tenantId: string,
  resolvedBy?: string | null,
): Promise<number> {
  const rq = await req();
  rq.input("tid", tenantId);
  rq.input("by", resolvedBy ?? null);
  const r = await rq.query(`UPDATE dbo.rmone_import_review
      SET status='dismissed', resolution_json=N'{"action":"start-over"}', resolved_by=@by, resolved_at=GETUTCDATE()
    WHERE tenant_id=@tid AND status='open'`);
  return r.rowsAffected?.[0] ?? 0;
}

export interface CacheBusEventRow {
  id: number;
  origin: string;
  payload: string;
}

/** Delete old events (TOP-capped so the delete never holds long locks; the
 *  next purge cycle finishes any remainder). Returns rows deleted. */
export async function purgeCacheBusEvents(olderThanMinutes: number): Promise<number> {
  const r = await req();
  r.input("min", mssql.Int, Math.max(1, Math.floor(olderThanMinutes)));
  const res = await r.query(
    `DELETE TOP (5000) FROM dbo.rmone_cache_bus_events WHERE created_at < DATEADD(minute, -@min, GETUTCDATE())`,
  );
  return res.rowsAffected?.[0] ?? 0;
}

/** Publish one envelope. Fire-and-forget from the caller's perspective —
 *  a lost event only means sibling instances serve until their TTLs expire
 *  (the same backstop that exists today without any bus). */
export async function insertCacheBusEvent(origin: string, payload: string): Promise<void> {
  const r = await req();
  r.input("origin", mssql.NVarChar, origin);
  r.input("payload", mssql.NVarChar(mssql.MAX), payload);
  await r.query(`INSERT INTO dbo.rmone_cache_bus_events (origin, payload) VALUES (@origin, @payload)`);
}

/** Events from OTHER instances inside the lookback window, oldest first.
 *  `afterId` pages within one poll cycle when a burst exceeds `cap` (the
 *  window itself stays time-based between cycles). NOLOCK: never block
 *  against writers; a row skipped mid-page-split is re-read next cycle
 *  because the window overlaps and the caller dedupes by id. */
export async function fetchCacheBusEvents(
  excludeOrigin: string,
  lookbackSec: number,
  cap: number,
  afterId = 0,
): Promise<CacheBusEventRow[]> {
  const r = await req();
  r.input("origin", mssql.NVarChar, excludeOrigin);
  r.input("sec", mssql.Int, Math.max(1, Math.floor(lookbackSec)));
  r.input("after", mssql.BigInt, Math.max(0, Math.floor(afterId)));
  const capN = Math.max(1, Math.min(2000, Math.floor(cap)));
  const res = await r.query(`
    SELECT TOP (${capN}) id, origin, payload
    FROM dbo.rmone_cache_bus_events WITH (NOLOCK)
    WHERE created_at > DATEADD(second, -@sec, GETUTCDATE())
      AND origin <> @origin
      AND id > @after
    ORDER BY id ASC`);
  return res.recordset.map((row: Record<string, unknown>) => ({
    id: Number(row.id),
    origin: String(row.origin ?? ""),
    payload: String(row.payload ?? ""),
  }));
}
