import { getPool, sql } from "./src/lib/db.js";
async function main() {
  const pool = await getPool();
  const res = await pool.request().query(`
    SELECT u.Name, u.Email, ra.AllocationHour, ra.PctAllocation, ra.AllocationStartDate, ra.AllocationEndDate, ra.TicketId
    FROM core2.dbo.ResourceAllocation ra
    JOIN core2.dbo.AspNetUsers u ON ra.ResourceUser = u.Id
    WHERE ra.TicketId = 'PMM-26-000001'
    ORDER BY u.Name, ra.AllocationStartDate
  `);
  console.log(JSON.stringify(res.recordset.slice(0,20), null, 2));
  console.log("total rows:", res.recordset.length);
}
main().catch(e => { console.error(e); process.exit(1); });
