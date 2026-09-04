import { getPool } from "../src/lib/db.js";
async function main() {
  const pool = await getPool();
  const r = await pool.request().query(
    `SELECT upload_id, status, tenant_id, LEFT(CAST(result AS NVARCHAR(MAX)), 1800) AS res
     FROM rmoneapp.dbo.rmone_onboarding_jobs WHERE tenant_id LIKE 'stresstest-%-0807' ORDER BY created_at DESC`);
  for (const row of r.recordset) console.log(JSON.stringify(row));
  process.exit(0);
}
main().catch(e => { console.error("FATAL", String(e?.message || e).slice(0,300)); process.exit(1); });
