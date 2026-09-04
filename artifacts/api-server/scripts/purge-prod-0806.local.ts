import { getPool } from "../src/lib/db.js";

const TID = "4350e245-3789-5a12-80c5-809e3d3b1d24";
const EMAIL = "loadtest@stresstest-a-0806.example";

async function main() {
  const pool = await getPool();
  const st = await pool.request().query(
    `SELECT upload_id, status, tenant_id FROM rmoneapp.dbo.rmone_onboarding_jobs WHERE tenant_id LIKE 'stresstest-%-0806'`);
  console.log("0806 job rows found:", JSON.stringify(st.recordset));
  const d1 = await pool.request().query(
    `DELETE FROM rmoneapp.dbo.rmone_onboarding_jobs WHERE tenant_id LIKE 'stresstest-%-0806'`);
  console.log("job rows deleted:", d1.rowsAffected[0]);
  const d2 = await pool.request().query(
    `DELETE FROM rmoneapp.dbo.rmone_users WHERE email='${EMAIL}' OR username='${EMAIL}'`);
  console.log("app users deleted:", d2.rowsAffected[0]);
  const tables = ["PMM","CRMCompany","ResourceWorkItems","ResourceAllocation","PMMTasks",
                  "Opportunity","Lead","CRMContact","AspNetUsers","RMOneInviteTokens"];
  for (const t of tables) {
    try {
      const c = await pool.request().query(`SELECT COUNT(*) n FROM core2.dbo.[${t}] WHERE TenantID='${TID}'`);
      const d = await pool.request().query(`DELETE FROM core2.dbo.[${t}] WHERE TenantID='${TID}'`);
      console.log(`${t}: had ${c.recordset[0].n}, deleted ${d.rowsAffected[0]}`);
    } catch (e: any) {
      console.log(`${t}: skipped (${String(e?.message || e).slice(0, 90)})`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
