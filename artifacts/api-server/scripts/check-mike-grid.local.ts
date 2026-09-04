// Why is Mike Murry not in the Resources staff grid despite enabled=1?
// Check his row, dupes on username/name, and the enabled/deleted counts.
import { getMssqlPool } from "@workspace/db";
import mssql from "mssql";

const TID = "22897300-acd1-5876-bfba-ae8b794cedd0"; // Alston AI

async function main() {
  const pool = await getMssqlPool();
  const r = await pool.request().input("tid", mssql.NVarChar, TID).query(`
    SELECT id, username, name, email, enabled, deleted, title, job_title_id, updated_at
    FROM dbo.rmone_users
    WHERE tenant_id=@tid AND (LOWER(name) LIKE '%murry%' OR LOWER(username) LIKE '%fake10%' OR LOWER(email) LIKE '%fake10%')`);
  console.log("Mike rows:", JSON.stringify(r.recordset, null, 2));

  const c = await pool.request().input("tid", mssql.NVarChar, TID).query(`
    SELECT deleted, enabled, COUNT(*) AS n FROM dbo.rmone_users WHERE tenant_id=@tid GROUP BY deleted, enabled`);
  console.log("counts:", JSON.stringify(c.recordset));

  // Any OTHER row sharing his username (dedupe collapse would hide one)?
  const d = await pool.request().input("tid", mssql.NVarChar, TID).query(`
    SELECT username, COUNT(*) AS n FROM dbo.rmone_users
    WHERE tenant_id=@tid AND deleted=0 GROUP BY username HAVING COUNT(*) > 1`);
  console.log("dup usernames (deleted=0):", JSON.stringify(d.recordset));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
