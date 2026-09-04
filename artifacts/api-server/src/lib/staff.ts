// ─────────────────────────────────────────────────────────────────────────────
// Create a brand-new staff member (rmone_users) for an RDS tenant.
//
// Mirrors the onboarding pipeline's AspNetUsers insert (uuidv4 Id, schema-drift
// safe via execInsert, scrambled password) but for a single person created from
// the Resources "Add Staff" UI. The account is Enabled=1 so it shows up on the
// Resources page immediately (at 0% / bench), but its password is scrambled so it
// cannot be logged into until the person sets their own via an invite link.
//
// Lives in its own module (not rds-provider) to avoid a circular import:
// pipeline.ts imports rds-provider.ts, so rds-provider must not import pipeline.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { getPool, sql } from "./db.js";
import { hashPassword } from "./pipeline.js";
import { ensureStaffExtraColumns } from "./rds-provider.js";
import { getActiveUsersByTenant } from "@workspace/db";
import { createAppUser } from "./user-store.js";

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateStaffInput {
  name: string;
  email: string;
  divisionId?: string | null; // CompanyDivisions.ID → DivisionLookup
  departmentId?: string | null; // Department.ID → DepartmentLookup
  jobTitleId?: string | null; // JobTitle.ID → JobTitleLookup
  roleId?: string | null; // Roles.Id (GUID) → GlobalRoleID
  roleName?: string | null; // Roles.Name → UserRole
  accessLevel?: string | null; // Admin | Manager | User | (blank → grandfathered)
  // When set (admin enabled "Fill a default rate when missing" + a number), a
  // chosen role that currently has NO billing rate gets this rate filled in, so a
  // manually-added person is consistent with import-time rate defaulting.
  defaultBillingRate?: number | null;
  employeeType?: string | null; // Full-Time | Part-Time | As Needed | Temporary | SCA Contingency Staff
  phoneNumber?: string | null;  // Direct / work phone number
  employeeId?: string | null;   // Badge / HR / payroll ID
  title?: string | null;        // AspNetUsers.Title — free-text job title displayed in the grid
}

export class StaffConflictError extends Error {
  readonly code = "DUPLICATE";
  constructor(msg: string) { super(msg); this.name = "StaffConflictError"; }
}

export async function createStaffRds(tid: string, input: CreateStaffInput): Promise<{ userGuid: string; filledRoleRate?: { roleName: string; rate: number } | null }> {
  const name = (input.name ?? "").trim();
  const email = (input.email ?? "").trim();
  if (!name) throw new Error("Name is required");
  if (!email.includes("@")) throw new Error("A valid email address is required");

  const pool = await getPool();

  // Reject duplicates by login name OR email within this tenant.
  const emailLow = email.toLowerCase();
  const activeUsers = await getActiveUsersByTenant(tid);
  if (activeUsers.some(u =>
    (u.username || "").toLowerCase() === emailLow ||
    (u.email || "").toLowerCase() === emailLow
  )) throw new StaffConflictError("A staff member with that email already exists.");

  const toBigInt = (v?: string | null): number | null => {
    if (v == null || String(v).trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  let divId = toBigInt(input.divisionId);
  let deptId = toBigInt(input.departmentId);
  const jtId = toBigInt(input.jobTitleId);

  // Keep the org chain consistent: derive department from the chosen job title
  // when not explicitly set, then division from the department.
  if (deptId == null && jtId != null) {
    try {
      const r = await pool.request().input("tid", sql.NVarChar, tid).input("jt", sql.BigInt, jtId)
        .query(`SELECT TOP 1 DepartmentId FROM core2.dbo.JobTitle WHERE TenantID=@tid AND ID=@jt`);
      const d = r.recordset[0]?.DepartmentId;
      if (d != null) deptId = Number(d);
    } catch { /* best effort */ }
  }
  if (divId == null && deptId != null) {
    try {
      const r = await pool.request().input("tid", sql.NVarChar, tid).input("d", sql.BigInt, deptId)
        .query(`SELECT TOP 1 DivisionIdLookup FROM core2.dbo.Department WHERE TenantID=@tid AND ID=@d`);
      const dv = r.recordset[0]?.DivisionIdLookup;
      if (dv != null) divId = Number(dv);
    } catch { /* best effort */ }
  }

  // Denormalized title: login personas (Home page / Daily Briefing) read
  // rmone_users.title directly — they never join core2 JobTitle — so a person
  // created with only a jobTitleId would show the right title in the grid but
  // never get the matching persona at login. Resolve the catalog name when no
  // free-text title was supplied. Best effort: failure never blocks creation.
  let titleText: string | null = (input.title ?? "").trim() || null;
  if (!titleText && jtId != null) {
    try {
      const r = await pool.request().input("tid", sql.NVarChar, tid).input("jt", sql.BigInt, jtId)
        .query(`SELECT TOP 1 Title FROM core2.dbo.JobTitle WHERE TenantID=@tid AND ID=@jt`);
      const t = String(r.recordset[0]?.Title ?? "").trim();
      if (t) titleText = t;
    } catch { /* best effort */ }
  }

  const roleName = (input.roleName ?? "").trim() || "User";
  const roleGuid = input.roleId && GUID_RE.test(String(input.roleId).trim()) ? String(input.roleId).trim() : null;

  // Built-ins normalize; a custom level marker ("custom:<id>", #87) passes
  // through verbatim so Add Staff can assign admin-defined levels too. Anything
  // else stays null (grandfathered).
  const normAcl = (raw?: string | null): string | null => {
    const s = String(raw ?? "").trim().toLowerCase();
    if (s === "admin" || s === "manager" || s === "user") return s;
    if (s.startsWith("custom:")) return s;
    return null;
  };
  const accessLevel = normAcl(input.accessLevel);
  const isSiteAdmin = accessLevel === "admin";

  // ensureStaffExtraColumns is now a no-op (fields live in Postgres users).
  await ensureStaffExtraColumns();

  const userGuid = uuidv4().toLowerCase();
  const scrambled = hashPassword(crypto.randomBytes(24).toString("hex"));
  const str = (v?: string | null): string | null => (v ?? "").trim() || null;

  // Insert into SQL Server users table.
  await createAppUser({
    id:           userGuid,
    tenantId:     tid,
    username:     email,
    name,
    email,
    passwordHash: scrambled,
    role:         roleName,
    roleId:       roleGuid ?? null,
    departmentId: deptId != null ? String(deptId) : null,
    divisionId:   divId   != null ? String(divId)  : null,
    jobTitleId:   jtId    != null ? String(jtId)   : null,
    accessLevel:  accessLevel ?? null,
    isSiteAdmin,
    isManager:    accessLevel === "manager",
    title:        titleText,
    employeeType: str(input.employeeType),
    phoneNumber:  str(input.phoneNumber),
    employeeId:   str(input.employeeId),
    startDate:    new Date(),
    enabled:      true,
    deleted:      false,
    // Created in-app with a scrambled password — the person hasn't verified
    // their email / set their own password yet. Flips true on invite accept.
    emailConfirmed: false,
  });

  // Fill the chosen role's billing rate when it has none and an admin enabled a
  // default rate. The rate lives on the Roles row (not the person), mirroring the
  // import pipeline — so a manually-added person whose role had no rate now gets
  // the same treatment. Only fills when blank/NULL; never overwrites a real rate.
  let filledRoleRate: { roleName: string; rate: number } | null = null;
  const defaultRate = input.defaultBillingRate;
  if (roleGuid && defaultRate != null && Number.isFinite(defaultRate)) {
    try {
      const cur = await pool.request()
        .input("tid", sql.NVarChar, tid)
        .input("rid", sql.NVarChar, roleGuid)
        .query("SELECT TOP 1 BillingRate FROM core2.dbo.Roles WHERE TenantID=@tid AND Id=@rid");
      const hasRate = cur.recordset.length > 0 && cur.recordset[0].BillingRate != null;
      if (cur.recordset.length > 0 && !hasRate) {
        await pool.request()
          .input("tid", sql.NVarChar, tid)
          .input("rid", sql.NVarChar, roleGuid)
          .input("rate", sql.Float, defaultRate)
          .query("UPDATE core2.dbo.Roles SET BillingRate=@rate WHERE TenantID=@tid AND Id=@rid AND BillingRate IS NULL");
        filledRoleRate = { roleName, rate: defaultRate };
      }
    } catch { /* best effort — staff creation already succeeded */ }
  }

  return { userGuid, filledRoleRate };
}
