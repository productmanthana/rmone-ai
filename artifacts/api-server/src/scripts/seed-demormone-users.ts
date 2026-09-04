// Seed login users for the Demormone tenant directly on the prod AWS SQL Server.
// Mirrors src/scripts/seed-liro-users.ts (insertUser into dbo.rmone_users) with
// a known password instead of the scrambled-hash + invite flow, per client request.
// Run: SEED_USER_PASSWORD='...' npx tsx src/scripts/seed-demormone-users.ts
import crypto from "node:crypto";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import mssql from "mssql";
import { insertUser } from "@workspace/db";

const TENANT_NAMESPACE = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const TID = uuidv5("demormone", TENANT_NAMESPACE);
// Never hardcode the password in the repo — pass it at run time:
//   SEED_USER_PASSWORD='...' npx tsx src/scripts/seed-demormone-users.ts
const PASSWORD = process.env.SEED_USER_PASSWORD || "";
if (!PASSWORD) { console.error("Set SEED_USER_PASSWORD env var before running."); process.exit(1); }

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

interface SeedUser { username: string; role: string; email: string; access: "admin" | "manager" | "user" }
const USERS: SeedUser[] = [
  { username: "AlexCarter92",  role: "CEO",               email: "ceo@demormone.com",      access: "admin" },
  { username: "MorganBlake",   role: "CFO",               email: "cfo@demormone.com",      access: "admin" },
  { username: "RileyStone",    role: "COO",               email: "coo@demormone.com",      access: "admin" },
  { username: "SilverHawk76",  role: "Project Manager",   email: "pm@demormone.com",       access: "manager" },
  { username: "EthanCole01",   role: "Resource Manager",  email: "rm@demormone.com",       access: "manager" },
  { username: "OliviaReed02",  role: "Project Executive", email: "pe@demormone.com",       access: "manager" },
  { username: "testuser",      role: "User",              email: "testuser@demormone.com", access: "user" },
];

function dbConfig(database: string): mssql.config {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error("No DB URL env var");
  const u = new URL(url);
  return {
    server: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 1433,
    database,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true, connectTimeout: 15_000, requestTimeout: 30_000 },
    pool: { max: 1, min: 0, idleTimeoutMillis: 5_000 },
  };
}

async function main() {
  console.log("Demormone tenant id:", TID);

  // Duplicate guard: skip any username/email already present on this tenant.
  const app = await new mssql.ConnectionPool(dbConfig("rmoneapp")).connect();
  const existingR = await app.request().input("tid", mssql.NVarChar, TID)
    .query("SELECT username, email FROM dbo.rmone_users WHERE tenant_id=@tid AND (deleted IS NULL OR deleted=0)");
  const existing = new Set<string>();
  for (const r of existingR.recordset) {
    if (r.username) existing.add(String(r.username).toLowerCase());
    if (r.email)    existing.add(String(r.email).toLowerCase());
  }
  await app.close();

  // Tenant role catalogue (Roles.Id = GUID) and job titles for org linkage.
  const core2 = await new mssql.ConnectionPool(dbConfig("core2")).connect();
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

  let created = 0, skipped = 0;
  for (const u of USERS) {
    if (existing.has(u.username.toLowerCase()) || existing.has(u.email.toLowerCase())) {
      console.log(`SKIP ${u.username} (${u.email}) — already exists on tenant`);
      skipped++;
      continue;
    }
    const roleGuid = roleByName.get(u.role.toLowerCase()) ?? null;
    const jt = jtByTitle.get(u.role.toLowerCase()) ?? null;
    const deptId = jt?.deptId ?? null;
    const divId = deptId != null ? (divByDept.get(deptId) ?? null) : null;
    const userGuid = uuidv4().toLowerCase();

    await insertUser({
      id:           userGuid,
      tenantId:     TID,
      username:     u.username.toLowerCase(),
      name:         u.username,
      email:        u.email,
      passwordHash: hashPassword(PASSWORD),
      role:         u.role,
      roleId:       roleGuid,
      departmentId: deptId != null ? String(deptId) : null,
      divisionId:   divId  != null ? String(divId)  : null,
      jobTitleId:   jt     != null ? String(jt.id)  : null,
      accessLevel:  u.access,
      isSiteAdmin:  u.access === "admin",
      isManager:    u.access === "manager",
      title:        u.role === "User" ? null : u.role,
      startDate:    new Date(),
      enabled:      true,
      deleted:      false,
      emailConfirmed: true,
    });
    created++;
    console.log(`created ${u.username} (${u.email}) role=${u.role} access=${u.access} roleGuid=${roleGuid ?? "-"} jobTitleId=${jt?.id ?? "-"} dept=${deptId ?? "-"} div=${divId ?? "-"} id=${userGuid}`);
  }
  console.log(`done — ${created} created, ${skipped} skipped for tenant 'demormone'`);
  process.exit(0);
}

main().catch((e) => { console.error("FAILED:", e.message ?? e); process.exit(1); });
