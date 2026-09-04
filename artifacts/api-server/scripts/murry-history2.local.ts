import { getMssqlPool } from "@workspace/db";
import mssql from "mssql";
async function main() {
  const app = await getMssqlPool();
  const tid = "22897300-acd1-5876-bfba-ae8b794cedd0";

  // What columns does rmone_users actually have?
  const cols = await new mssql.Request(app).query(`
    SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('dbo.rmone_users') ORDER BY column_id
  `);
  console.log("[rmone_users columns]:", cols.recordset.map((c: any) => c.name).join(", "));

  // Mike's full row (all cols except password_hash)
  const u = await new mssql.Request(app).input("tid", mssql.NVarChar, tid).query(`
    SELECT id, name, email, username, enabled, deleted, role, access_level, updated_at, created_at
    FROM dbo.rmone_users
    WHERE tenant_id=@tid AND (name LIKE '%murr%' OR email LIKE 'fake10%')
  `);
  console.log("\n[Mike's row]:", JSON.stringify(u.recordset, null, 2));

  // All Alston AI uploads — who uploaded when
  const jobs = await new mssql.Request(app).input("tid", mssql.NVarChar, "Alston AI").query(`
    SELECT upload_id, file_name, status, import_mode, created_by, created_at, total_inserted, total_errors
    FROM dbo.rmone_onboarding_jobs
    WHERE tenant_id=@tid
    ORDER BY created_at ASC
  `);
  console.log(`\n[All Alston AI uploads] ${jobs.recordset.length} total:`);
  for (const r of jobs.recordset) console.log("  " + JSON.stringify(r));

  // Audit-like tables
  const audits = await new mssql.Request(app).query(`
    SELECT name FROM sys.tables WHERE name LIKE '%audit%' OR name LIKE '%log%' OR name LIKE '%history%' ORDER BY name
  `);
  console.log("\n[audit-like tables]:", audits.recordset.map((t: any) => t.name).join(", ") || "(none)");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e?.message ?? e); process.exit(1); });
