import { getPool } from "../src/lib/db.js";
async function main() {
  const pool = await getPool();
  const tid = "820cf51f-2e42-5998-ade4-f8d05ce88a91";
  const r = await pool.request().query(`
    SELECT TOP 5 TicketId, (SELECT COUNT(*) FROM core2.dbo.ResourceAllocation ra WHERE ra.TenantID=p.TenantID AND ra.TicketId=p.TicketId AND (ra.Deleted=0 OR ra.Deleted IS NULL)) AS raRows
    FROM core2.dbo.PMM p WHERE p.TenantID='${tid}' AND (p.Deleted=0 OR p.Deleted IS NULL) ORDER BY p.ID DESC`);
  for (const row of r.recordset) console.log(`${row.TicketId}  raRows=${row.raRows}`);
  const big = await pool.request().query(`
    SELECT TOP 3 ra.TicketId, COUNT(*) AS raRows FROM core2.dbo.ResourceAllocation ra
    WHERE ra.TenantID='${tid}' AND (ra.Deleted=0 OR ra.Deleted IS NULL) GROUP BY ra.TicketId ORDER BY COUNT(*) DESC`);
  console.log("── biggest-team projects:");
  for (const row of big.recordset) console.log(`${row.TicketId}  raRows=${row.raRows}`);
  process.exit(0);
}
main().catch(e => { console.error("FATAL", String(e?.message || e).slice(0,200)); process.exit(1); });
