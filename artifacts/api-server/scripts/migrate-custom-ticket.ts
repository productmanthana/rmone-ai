// One-off: rename a record's auto-generated TicketId to its custom ERPJobID
// (e.g. PMM-0874 → test-001) and clear the now-duplicated ERPJobID field.
// Usage: tsx scripts/migrate-custom-ticket.ts <oldTicket> <newTicket> [--apply]
import { getPool, sql } from "../src/lib/db.js";

const oldTicket = process.argv[2];
const newTicket = process.argv[3];
const apply = process.argv.includes("--apply");
if (!oldTicket || !newTicket) { console.error("usage: <oldTicket> <newTicket> [--apply]"); process.exit(1); }

async function run() {
  const pool = await getPool();

  const rec = await pool.request()
    .input("t", sql.NVarChar, oldTicket)
    .query(`SELECT TenantID, TicketId, Title, ERPJobID FROM core2.dbo.PMM
            WHERE TicketId=@t AND (Deleted=0 OR Deleted IS NULL)`);
  console.log("PMM rows:", JSON.stringify(rec.recordset));
  if (rec.recordset.length !== 1) { console.error("expected exactly 1 PMM row — aborting"); process.exit(1); }
  const tid = String(rec.recordset[0].TenantID);

  // Conflict check: new ticket must not already exist in PMM or Opportunity for this tenant.
  for (const tbl of ["PMM", "Opportunity"]) {
    const c = await pool.request()
      .input("tid", sql.NVarChar, tid).input("nt", sql.NVarChar, newTicket.toLowerCase())
      .query(`SELECT COUNT(*) AS n FROM core2.dbo.[${tbl}] WHERE TenantID=@tid AND LOWER(LTRIM(RTRIM(TicketId)))=@nt`);
    console.log(`${tbl} rows already using "${newTicket}":`, c.recordset[0].n);
    if (Number(c.recordset[0].n) > 0) { console.error("conflict — aborting"); process.exit(1); }
  }

  // Reference counts on the old ticket.
  const refs: [string, string][] = [
    ["ResourceAllocation", "TicketId"],
    ["ResourceWorkItems", "WorkItem"],
    ["PMMTasks", "TicketId"],
  ];
  for (const [tbl, col] of refs) {
    const c = await pool.request()
      .input("tid", sql.NVarChar, tid).input("t", sql.NVarChar, oldTicket)
      .query(`SELECT COUNT(*) AS n FROM core2.dbo.[${tbl}] WHERE TenantID=@tid AND [${col}]=@t`);
    console.log(`${tbl}.${col} refs:`, c.recordset[0].n);
  }

  if (!apply) { console.log("DRY RUN — pass --apply to migrate"); return; }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const u1 = await new sql.Request(tx)
      .input("tid", sql.NVarChar, tid).input("t", sql.NVarChar, oldTicket).input("nt", sql.NVarChar, newTicket)
      .query(`UPDATE core2.dbo.PMM SET TicketId=@nt, ERPJobID=NULL WHERE TenantID=@tid AND TicketId=@t`);
    console.log("PMM updated:", u1.rowsAffected[0]);
    for (const [tbl, col] of refs) {
      const u = await new sql.Request(tx)
        .input("tid", sql.NVarChar, tid).input("t", sql.NVarChar, oldTicket).input("nt", sql.NVarChar, newTicket)
        .query(`UPDATE core2.dbo.[${tbl}] SET [${col}]=@nt WHERE TenantID=@tid AND [${col}]=@t`);
      console.log(`${tbl}.${col} updated:`, u.rowsAffected[0]);
    }
    await tx.commit();
    console.log("MIGRATED", oldTicket, "→", newTicket);
  } catch (e) {
    try { await tx.rollback(); } catch { /* noop */ }
    throw e;
  }
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
