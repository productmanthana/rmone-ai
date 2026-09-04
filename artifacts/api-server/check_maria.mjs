import sql from "mssql";
const u = new URL(process.env.APP_DATABASE_URL);
const cfg = {
  server: u.hostname, port: u.port ? parseInt(u.port,10):1433,
  database: u.pathname.replace(/^\//,"")||"master",
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  options: { encrypt:true, trustServerCertificate:true, enableArithAbort:true, connectTimeout:15000, requestTimeout:60000 },
};

async function run() {
  const pool = await new sql.ConnectionPool(cfg).connect();
  
  const userRes = await pool.request().query("SELECT * FROM core2.dbo.AspNetUsers WHERE Name = 'Maria Vasquez'");
  const userIds = userRes.recordset.map(r => r.Id);

  for (const uid of userIds) {
    const rwiRes = await pool.request().input('uid', uid).query("SELECT * FROM core2.dbo.ResourceWorkItems WHERE ResourceUser = @uid");
    for (const rwi of rwiRes.recordset) {
        // If Title is like "Schematic Design" OR WorkItem references a PMM with that title
        let isMatch = false;
        if (rwi.Title && rwi.Title.includes('Schematic Design')) isMatch = true;
        
        if (rwi.WorkItemType === 'PMM') {
           const pmmRes = await pool.request().input('id', rwi.WorkItem).query("SELECT * FROM core2.dbo.PMM WHERE ID = @id");
           const pmm = pmmRes.recordset[0];
           if (pmm && ( (pmm.Title && pmm.Title.includes('Schematic Design')) || (pmm.ProjectName && pmm.ProjectName.includes('Schematic Design')) )) {
             isMatch = true;
           }
        }
        
        if (isMatch) {
            console.log("\n--- MATCH FOUND ---");
            console.log("Maria ID: " + uid);
            console.log("RWI: " + JSON.stringify(rwi, null, 2));
            const raRes = await pool.request().input('uid', uid).input('rwi', rwi.ID).query("SELECT * FROM core2.dbo.ResourceAllocation WHERE ResourceUser = @uid AND ResourceWorkItemLookup = @rwi");
            console.log("RA Rows: " + JSON.stringify(raRes.recordset, null, 2));
        }
    }
  }

  await pool.close();
}

run().catch(console.error);
