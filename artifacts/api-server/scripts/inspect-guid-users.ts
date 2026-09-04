import { getPool, sql } from "../src/lib/db.js";

async function run() {
  const pool = await getPool();

  // 1. Find RWI rows whose ResourceUser starts with the GUIDs from the screenshots
  const r1 = await pool.request().query(`
    SELECT TOP 20 rwi.ID, rwi.TenantID, rwi.WorkItem, CAST(rwi.ResourceUser AS NVARCHAR(50)) AS ResourceUser,
           rwi.Title, rwi.StartDate, rwi.EndDate, rwi.Deleted,
           rwi.JobTitleLookup, rwi.DivisionLookup
    FROM core2.dbo.ResourceWorkItems rwi WITH (NOLOCK)
    WHERE CAST(rwi.ResourceUser AS NVARCHAR(50)) LIKE '25FB43B2%'
       OR CAST(rwi.ResourceUser AS NVARCHAR(50)) LIKE '7D3CC38B%'
  `);
  console.log("=== RWI rows matching screenshot GUIDs ===");
  for (const row of r1.recordset) console.log(JSON.stringify(row));

  // 2. Do these GUIDs exist in AspNetUsers?
  const r2 = await pool.request().query(`
    SELECT Id, TenantID, Name, UserName, Title, Deleted, Enabled
    FROM core2.dbo.AspNetUsers WITH (NOLOCK)
    WHERE Id LIKE '25FB43B2%' OR Id LIKE '7D3CC38B%'
  `);
  console.log("=== AspNetUsers matches ===");
  for (const row of r2.recordset) console.log(JSON.stringify(row));

  // 3. Do they exist in rmone_users (app user DB)?
  const r3 = await pool.request().query(`
    SELECT id, tenant_id, name, username, title
    FROM rmoneapp.dbo.rmone_users WITH (NOLOCK)
    WHERE id LIKE '25fb43b2%' OR id LIKE '7d3cc38b%'
  `);
  console.log("=== rmone_users matches ===");
  for (const row of r3.recordset) console.log(JSON.stringify(row));

  // 4. Which project is PMM-26-001 / which tenant?
  const r4 = await pool.request().query(`
    SELECT TOP 5 ID, TenantID, TicketId, Title
    FROM core2.dbo.PMM WITH (NOLOCK)
    WHERE TicketId = 'PMM-26-001' OR Title LIKE 'Midtown East Tower%'
  `);
  console.log("=== PMM-26-001 project rows ===");
  for (const row of r4.recordset) console.log(JSON.stringify(row));

  // 5. All RWI rows for that project (per tenant found above)
  for (const p of r4.recordset) {
    const rr = await pool.request()
      .input("tid", sql.NVarChar, p.TenantID)
      .input("pid", sql.NVarChar, p.TicketId)
      .query(`
        SELECT rwi.ID, CAST(rwi.ResourceUser AS NVARCHAR(50)) AS ResourceUser, rwi.Title AS RoleTitle,
               rwi.Deleted, u.Name AS UName, u.UserName AS ULogin
        FROM core2.dbo.ResourceWorkItems rwi WITH (NOLOCK)
        LEFT JOIN core2.dbo.AspNetUsers u WITH (NOLOCK) ON u.Id = CAST(rwi.ResourceUser AS NVARCHAR(50))
        WHERE rwi.TenantID=@tid AND rwi.WorkItem=@pid`);
    console.log(`=== RWI rows for ${p.TicketId} (tenant ${p.TenantID}) ===`);
    for (const row of rr.recordset) console.log(JSON.stringify(row));
  }
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
