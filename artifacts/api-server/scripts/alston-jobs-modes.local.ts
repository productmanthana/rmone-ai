// All Alston AI onboarding jobs with mode + file + per-step user counts.
import { getMssqlPool } from "@workspace/db";
import mssql from "mssql";
async function main() {
  const pool = await getMssqlPool();
  const r = await pool.request().query(`
    SELECT id, tenant_id, file_name, status, created_at,
           LEFT(CAST(result_json AS NVARCHAR(MAX)), 0) AS _skip,
           CAST(request_json AS NVARCHAR(MAX)) AS req,
           CAST(result_json AS NVARCHAR(MAX)) AS resj
    FROM dbo.rmone_onboarding_jobs
    WHERE LOWER(tenant_id) LIKE '%alston%'
    ORDER BY created_at ASC`);
  for (const row of r.recordset) {
    let mode = "?"; let users = "";
    try { const q = JSON.parse(row.req ?? "{}"); mode = q.importMode ?? q.mode ?? "?"; } catch {}
    try {
      const j = JSON.parse(row.resj ?? "{}");
      const steps = j.steps ?? j.result?.steps ?? [];
      const u = (Array.isArray(steps) ? steps : []).filter((s: any) => /AspNetUsers|user/i.test(s.table ?? s.name ?? ""));
      users = u.map((s: any) => `${s.table ?? s.name}: ins=${s.rowsInserted ?? s.inserted ?? 0} upd=${s.rowsUpdated ?? s.updated ?? 0} del=${s.rowsDeleted ?? s.deleted ?? 0} deact=${s.rowsDeactivated ?? "?"}`).join(" | ");
    } catch {}
    console.log(`${String(row.created_at).slice(0,24)}  ${row.status}  mode=${mode}  ${row.file_name}\n    ${users}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
