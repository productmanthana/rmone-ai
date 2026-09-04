import { getPool } from "../src/lib/db.js";
const pool = await getPool();
const r = await pool.request().query(`
  SELECT TicketId, Title, Status, TenantID, Deleted
  FROM core2.dbo.PMM WHERE TicketId = 'PRJ-9202' AND Deleted = 0
`);
console.log(JSON.stringify(r.recordset, null, 2));
// Does PMM even have a CRMProjectStatusChoice column?
const c = await pool.request().query(`
  SELECT name FROM core2.sys.columns
  WHERE object_id = OBJECT_ID('core2.dbo.PMM') AND name LIKE '%Status%'
`);
console.log("status-ish cols:", c.recordset.map((x: any) => x.name).join(", "));
process.exit(0);
