import { getPool } from "../src/lib/db.js";
const TID = "4f11586c-ffeb-5fbf-abae-fb19fd7cc51f";
async function main() {
  const pool = await getPool();
  const tables = ["PMM","CRMCompany","ResourceWorkItems","ResourceAllocation","PMMTasks",
                  "Opportunity","Lead","CRMContact","AspNetUsers","Roles","JobTitle","CompanyDivisions","Department"];
  for (const t of tables) {
    try {
      const r = await pool.request().query(
        `SELECT SUM(CASE WHEN Deleted=1 THEN 0 ELSE 1 END) AS live, COUNT(*) AS total
         FROM core2.dbo.[${t}] WHERE TenantID='${TID}'`);
      const { live, total } = r.recordset[0];
      if (total > 0 || t === "PMM" || t === "CRMCompany") console.log(`${t}: live=${live ?? 0} total=${total}`);
    } catch (e: any) { console.log(`${t}: skipped (${String(e?.message || e).slice(0, 60)})`); }
  }
  process.exit(0);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
