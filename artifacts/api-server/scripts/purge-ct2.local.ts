import { getPool } from "../src/lib/db.js";

const TID = "4f11586c-ffeb-5fbf-abae-fb19fd7cc51f";
const UPLOAD = "6dbd087c-314a-484a-9aae-c69df997f4f6";
const LABEL = "canceltest5-0807";
const EMAIL = "loadtest@canceltest5-0807.example";

async function main() {
  const pool = await getPool();
  const st = await pool.request().query(
    `SELECT upload_id, status, tenant_id FROM rmoneapp.dbo.rmone_onboarding_jobs WHERE upload_id='${UPLOAD}' OR tenant_id='${LABEL}'`);
  console.log("job rows (fence check — expect status 'cancelled'):", JSON.stringify(st.recordset));
  const d1 = await pool.request().query(
    `DELETE FROM rmoneapp.dbo.rmone_onboarding_jobs WHERE upload_id='${UPLOAD}' OR tenant_id='${LABEL}'`);
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
