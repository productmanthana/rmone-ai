// Seed 8 demo login accounts for the test20 tenant (4 admin, 4 manager).
// Mirrors seed-liro-users.ts but targets test20 with a fixed demo password.
// Run: npx tsx src/scripts/seed-test20-users.ts
// The script is idempotent — it skips users whose email already exists.
import crypto from "node:crypto";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import mssql from "mssql";
import { insertUser, getActiveUsersByTenant } from "@workspace/db";

const TENANT_NAMESPACE = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const TID = uuidv5("test20", TENANT_NAMESPACE);
const PASSWORD = "RMOne@Test1";

// ASP.NET Identity v2 PBKDF2 (same as lib/pipeline.ts hashPassword)
function hashPassword(plaintext: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(plaintext, salt, 1000, 32, "sha1");
  const buf = Buffer.alloc(49);
  buf[0] = 0x00;
  salt.copy(buf, 1);
  hash.copy(buf, 17);
  return buf.toString("base64");
}

interface SeedUser { name: string; email: string; role: string; access: "admin" | "manager" }
const USERS: SeedUser[] = [
  // 4 admins
  { name: "Alex Rivera",    email: "alex.rivera@test20.local",    role: "Chief Executive Officer",  access: "admin"   },
  { name: "Morgan Chen",    email: "morgan.chen@test20.local",    role: "Chief Financial Officer",  access: "admin"   },
  { name: "Jordan Park",    email: "jordan.park@test20.local",    role: "Chief Operating Officer",  access: "admin"   },
  { name: "Taylor Brooks",  email: "taylor.brooks@test20.local",  role: "Executive",                access: "admin"   },
  // 4 managers
  { name: "Casey Walsh",    email: "casey.walsh@test20.local",    role: "Project Manager",          access: "manager" },
  { name: "Riley Nguyen",   email: "riley.nguyen@test20.local",   role: "Resource Manager",         access: "manager" },
  { name: "Quinn Torres",   email: "quinn.torres@test20.local",   role: "Project Manager",          access: "manager" },
  { name: "Avery Kim",      email: "avery.kim@test20.local",      role: "Resource Manager",         access: "manager" },
];

function core2Config(): mssql.config {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error("No DB URL env var");
  const u = new URL(url);
  return {
    server: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 1433,
    database: "core2",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true, connectTimeout: 15_000, requestTimeout: 30_000 },
    pool: { max: 1, min: 0, idleTimeoutMillis: 5_000 },
  };
}

async function main() {
  console.log(`test20 tenant id: ${TID}`);
  const core2 = await new mssql.ConnectionPool(core2Config()).connect();

  // Fetch existing role catalogue + job titles for org linkage.
  const rolesR = await core2.request().input("tid", mssql.NVarChar, TID)
    .query("SELECT Id, Name FROM dbo.Roles WHERE TenantID=@tid");
  const roleByName = new Map<string, string>();
  for (const r of rolesR.recordset) {
    const k = String(r.Name ?? "").trim().toLowerCase();
    if (k && !roleByName.has(k)) roleByName.set(k, String(r.Id));
  }

  const jtR = await core2.request().input("tid", mssql.NVarChar, TID)
    .query("SELECT ID, Title, DepartmentId FROM dbo.JobTitle WHERE TenantID=@tid");
  const jtByTitle = new Map<string, { id: number; deptId: number | null }>();
  for (const r of jtR.recordset) {
    const k = String(r.Title ?? "").trim().toLowerCase();
    if (k && !jtByTitle.has(k)) jtByTitle.set(k, { id: Number(r.ID), deptId: r.DepartmentId != null ? Number(r.DepartmentId) : null });
  }

  const deptR = await core2.request().input("tid", mssql.NVarChar, TID)
    .query("SELECT ID, DivisionIdLookup FROM dbo.Department WHERE TenantID=@tid");
  const divByDept = new Map<number, number | null>();
  for (const r of deptR.recordset) divByDept.set(Number(r.ID), r.DivisionIdLookup != null ? Number(r.DivisionIdLookup) : null);

  await core2.close();

  // Check existing users to skip duplicates.
  const existing = await getActiveUsersByTenant(TID);
  const existingEmails = new Set(existing.map((u: any) => (u.email || u.username || "").toLowerCase()));

  let created = 0;
  let skipped = 0;
  for (const u of USERS) {
    if (existingEmails.has(u.email.toLowerCase())) {
      console.log(`skip   ${u.email} (already exists)`);
      skipped++;
      continue;
    }
    const roleKey = u.role.toLowerCase();
    const roleGuid = roleByName.get(roleKey) ?? null;
    const jt = jtByTitle.get(roleKey) ?? null;
    const deptId = jt?.deptId ?? null;
    const divId = deptId != null ? (divByDept.get(deptId) ?? null) : null;
    const userGuid = uuidv4().toLowerCase();

    await insertUser({
      id:             userGuid,
      tenantId:       TID,
      username:       u.email,
      name:           u.name,
      email:          u.email,
      passwordHash:   hashPassword(PASSWORD),
      role:           u.role,
      roleId:         roleGuid,
      departmentId:   deptId != null ? String(deptId) : null,
      divisionId:     divId  != null ? String(divId)  : null,
      jobTitleId:     jt     != null ? String(jt.id)  : null,
      accessLevel:    u.access,
      isSiteAdmin:    u.access === "admin",
      isManager:      u.access === "manager",
      title:          u.role,
      startDate:      new Date(),
      enabled:        true,
      deleted:        false,
      emailConfirmed: true,
    });
    console.log(`created ${u.name} <${u.email}> [${u.access}] roleGuid=${roleGuid ?? "-"} jtId=${jt?.id ?? "-"}`);
    created++;
  }
  console.log(`\ndone — ${created} created, ${skipped} skipped`);
  process.exit(0);
}

main().catch((e) => { console.error("FAILED:", e.message ?? e); process.exit(1); });
