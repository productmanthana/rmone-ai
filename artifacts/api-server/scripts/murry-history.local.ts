import { getMssqlPool } from "@workspace/db";
import mssql from "mssql";
import { getPool, sql } from "../src/lib/db.js";
async function main() {
  const app = await getMssqlPool();
  const core = await getPool();
  const tid = "22897300-acd1-5876-bfba-ae8b794cedd0";

  // 1) When was Mike's rmone_users row last updated, and by whom?
  const u = await new mssql.Request(app).input("tid", mssql.NVarChar, tid).query(`
    SELECT id, name, email, username, enabled, deleted, updated_at, created_at, updated_by, created_by
    FROM dbo.rmone_users
    WHERE tenant_id=@tid AND (name LIKE '%murr%' OR email LIKE 'fake10%')
  `);
  console.log("\n[rmone_users] Mike's row:");
  for (const r of u.recordset) console.log("  " + JSON.stringify(r));

  // 2) Is there an audit log table?
  const audits = await new mssql.Request(app).query(`
    SELECT name FROM sys.tables WHERE name LIKE '%audit%' OR name LIKE '%log%' OR name LIKE '%history%'
  `);
  console.log("\n[app-db audit-like tables]:", audits.recordset.map((t: any) => t.name).join(", ") || "(none)");

  // 3) Onboarding job history for Alston AI — who uploaded, when, what mode
  const jobs = await new mssql.Request(app).input("tid", mssql.NVarChar, "Alston AI").query(`
    SELECT upload_id, tenant_id, file_name, status, import_mode, created_by, created_at, updated_at, total_inserted, total_errors
    FROM dbo.rmone_onboarding_jobs
    WHERE tenant_id=@tid
    ORDER BY created_at DESC
  `);
  console.log(`\n[rmone_onboarding_jobs] Alston AI uploads (${jobs.recordset.length} total):`);
  for (const r of jobs.recordset) console.log("  " + JSON.stringify(r));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e?.message ?? e); process.exit(1); });
