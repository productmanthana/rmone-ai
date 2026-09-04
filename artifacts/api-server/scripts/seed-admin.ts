/**
 * One-shot admin seed: create (or repair) an admin user in any RDS tenant.
 * Usage: tsx scripts/seed-admin.ts <tenant> <email> <password>
 */
import crypto from "node:crypto";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import { getPool, sql } from "../src/lib/db.js";

const TENANT_NAMESPACE = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const GUID_RE = /^[0-9a-fA-F-]{36}$/;

function resolveTenantId(raw: string): string {
  const v = raw.trim();
  return GUID_RE.test(v) ? v : uuidv5(v.toLowerCase(), TENANT_NAMESPACE);
}

function hashPassword(plaintext: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(plaintext, salt, 1000, 32, "sha1");
  const buf = Buffer.alloc(1 + 16 + 32);
  buf[0] = 0x00;
  salt.copy(buf, 1);
  hash.copy(buf, 17);
  return buf.toString("base64");
}

const [, , tenant, email, password] = process.argv;
if (!tenant || !email || !password) {
  console.error("Usage: tsx scripts/seed-admin.ts <tenant> <email> <password>");
  process.exit(1);
}

const tid = resolveTenantId(tenant);
console.log(`Tenant: ${tenant} → TenantID: ${tid}`);

const pool = await getPool();

const existing = await pool.request()
  .input("tid", sql.NVarChar, tid)
  .input("uname", sql.NVarChar, email)
  .query(`SELECT TOP 1 Id, UserName, PasswordHash, Enabled, IsSiteAdmin
          FROM core2.dbo.AspNetUsers
          WHERE TenantID=@tid AND UserName=@uname AND (Deleted=0 OR Deleted IS NULL)`);

const pwHash = hashPassword(password);

if (existing.recordset.length === 0) {
  const userGuid = uuidv4();
  await pool.request()
    .input("id",     sql.NVarChar, userGuid)
    .input("tid",    sql.NVarChar, tid)
    .input("uname",  sql.NVarChar, email)
    .input("name",   sql.NVarChar, email.split("@")[0])
    .input("pw",     sql.NVarChar, pwHash)
    .input("email",  sql.NVarChar, email)
    .input("stamp",  sql.NVarChar, uuidv4())
    .query(`INSERT INTO core2.dbo.AspNetUsers
      (Id, TenantID, UserName, Name, Email, PasswordHash,
       Enabled, IsSiteAdmin, IsDefaultAdmin, Deleted,
       EmailConfirmed, PhoneNumberConfirmed, TwoFactorEnabled,
       LockoutEnabled, AccessFailedCount, SecurityStamp)
      VALUES (@id, @tid, @uname, @name, @email, @pw,
              1, 1, 1, 0,
              1, 0, 0,
              0, 0, @stamp)`);
  console.log(`✓ Created new admin user ${email} in tenant '${tenant}' (guid=${userGuid})`);
} else {
  const row = existing.recordset[0];
  await pool.request()
    .input("tid",  sql.NVarChar, tid)
    .input("uname", sql.NVarChar, email)
    .input("pw",   sql.NVarChar, pwHash)
    .query(`UPDATE core2.dbo.AspNetUsers
            SET PasswordHash=@pw, Enabled=1, IsSiteAdmin=1, IsDefaultAdmin=1, Deleted=0
            WHERE TenantID=@tid AND UserName=@uname`);
  console.log(`✓ Updated existing user ${email} in tenant '${tenant}' (id=${row.Id}) — password reset, IsSiteAdmin=1`);
}

process.exit(0);
