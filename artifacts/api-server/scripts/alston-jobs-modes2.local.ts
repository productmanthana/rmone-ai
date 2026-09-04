// Alston AI job history: mode + file + user-step outcomes, oldest first.
import { getMssqlPool } from "@workspace/db";
async function main() {
  const pool = await getMssqlPool();
  const r = await pool.request().query(`
    SELECT upload_id, tenant_id, file_name, status, import_mode, created_at,
           CAST(result AS NVARCHAR(MAX)) AS resj, CAST(summary AS NVARCHAR(MAX)) AS summ
    FROM dbo.rmone_onboarding_jobs
    WHERE LOWER(tenant_id) LIKE '%alston%'
    ORDER BY created_at ASC`);
  for (const row of r.recordset) {
    let users = "";
    try {
      const j = JSON.parse(row.resj ?? "{}");
      const steps = j.steps ?? j.result?.steps ?? [];
      users = (Array.isArray(steps) ? steps : [])
        .filter((s: any) => /user/i.test(String(s.table ?? s.name ?? "")))
        .map((s: any) => JSON.stringify(s)).join(" | ");
      if (!users && row.summ) users = String(row.summ).slice(0, 160);
    } catch { users = String(row.summ ?? "").slice(0, 160); }
    console.log(`${String(row.created_at).slice(0,24)}  ${row.status}  mode=${row.import_mode}  ${row.file_name}`);
    if (users) console.log(`    ${users.slice(0, 400)}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
