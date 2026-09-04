import crypto from "node:crypto";
import { v5 as uuidv5, v4 as uuidv4 } from "uuid";
import mssql from "mssql";

function parseConfig(): mssql.config {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error("APP_DATABASE_URL is not set");
  const u = new URL(url);
  return {
    server:   u.hostname,
    port:     u.port ? parseInt(u.port, 10) : 1433,
    database: "rmoneapp",   // user tables always live here, not in the URL's default DB
    user:     decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true, connectTimeout: 15_000, requestTimeout: 30_000 },
    pool: { max: 1, min: 0, idleTimeoutMillis: 5_000 },
  };
}

async function main() {
  const pool = await new mssql.ConnectionPool(parseConfig()).connect();

  const NAMESPACE = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
  const tid = uuidv5("rmone", NAMESPACE);
  console.log("rmone tenant_id:", tid);

  // Check existing (include deleted=1 so we don't double-insert)
  const check = await pool.request()
    .input("tid", mssql.NVarChar, tid)
    .input("un",  mssql.NVarChar, "sanjeev@rmone.com")
    .query("SELECT TOP 1 id, enabled, deleted, password_hash FROM dbo.rmone_users WHERE tenant_id=@tid AND (username=@un OR email=@un)");

  const salt = crypto.randomBytes(16);
  const subkey = crypto.pbkdf2Sync("idealabs123", salt, 1000, 32, "sha1");
  const buf = Buffer.alloc(49);
  buf[0] = 0x00; salt.copy(buf, 1); subkey.copy(buf, 17);
  const hash = buf.toString("base64");

  if (check.recordset.length > 0) {
    const row = check.recordset[0] as { id: string; enabled: number; deleted: number; password_hash: string | null };
    console.log("User already exists:", row.id, "enabled:", row.enabled, "deleted:", row.deleted, "hasHash:", !!row.password_hash);
    // Refresh the password and ensure enabled+not-deleted
    await pool.request()
      .input("tid",  mssql.NVarChar, tid)
      .input("un",   mssql.NVarChar, "sanjeev@rmone.com")
      .input("hash", mssql.NVarChar, hash)
      .query("UPDATE dbo.rmone_users SET password_hash=@hash, enabled=1, deleted=0 WHERE tenant_id=@tid AND (username=@un OR email=@un)");
    console.log("Password hash refreshed and account re-enabled.");
  } else {
    const userId = uuidv4();
    await pool.request()
      .input("id",          mssql.NVarChar, userId)
      .input("tid",         mssql.NVarChar, tid)
      .input("username",    mssql.NVarChar, "sanjeev@rmone.com")
      .input("name",        mssql.NVarChar, "Sanjeev")
      .input("email",       mssql.NVarChar, "sanjeev@rmone.com")
      .input("hash",        mssql.NVarChar, hash)
      .input("role",        mssql.NVarChar, "Administrator")
      .input("isSiteAdmin", mssql.Bit, 1)
      .input("accessLevel", mssql.NVarChar, "admin")
      .input("enabled",     mssql.Bit, 1)
      .input("deleted",     mssql.Bit, 0)
      .query(`INSERT INTO dbo.rmone_users
        (id,tenant_id,username,name,email,password_hash,role,is_site_admin,access_level,enabled,deleted)
        VALUES
        (@id,@tid,@username,@name,@email,@hash,@role,@isSiteAdmin,@accessLevel,@enabled,@deleted)`);
    console.log("Superadmin created — id:", userId);
  }

  await pool.close();
  process.exit(0);
}

main().catch((e) => { console.error("FAILED:", e.message ?? e); process.exit(1); });
