// Read-only diagnostic: verify the Alston AI edge-case test upload landed.
//  1) Projects PMM-26-0001..0004 (BP USF Plainfield, H Martt, ZZ Edge Test, blank-title)
//  2) Team on PMM-26-0003 (Chris Kiziak + Phil Noblet expected)
//  3) Jim Kelly — must NOT be assigned anywhere; should be held in review
//  4) rmone_import_review "needs attention" rows for the tenant
import { getPool } from "../src/lib/db.js";
import { getMssqlPool } from "@workspace/db";
import mssql from "mssql";
import { v5 as uuidv5 } from "uuid";

const NS = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const label = "alston ai";
const tid = uuidv5(label, NS);

async function run() {
  const appPool = await getMssqlPool();
  const corePool = await getPool();
  console.log(`Tenant "${label}" → ${tid}\n`);

  // 1) Projects
  const p = await corePool.request().input("tid", mssql.VarChar, tid).query(`
    SELECT TicketId, Title, Deleted FROM core2.dbo.PMM
    WHERE TenantID=@tid AND (TicketId LIKE 'PMM-26-000_' OR Title IN ('BP USF Plainfield','H Martt','ZZ Edge Test Project'))
    ORDER BY TicketId
  `);
  console.log(`[PMM] short-ID / edge-test projects: ${p.recordset.length}`);
  for (const r of p.recordset) console.log("  " + JSON.stringify(r));

  // 2) Assignments on PMM-26-0003 (RA) + RWI
  const ra = await corePool.request().input("tid", mssql.VarChar, tid).query(`
    SELECT TOP 20 * FROM core2.dbo.ResourceAllocation
    WHERE TenantID=@tid AND TicketId IN ('PMM-26-0003','PMM-26-0001','PMM-26-000023')
  `);
  console.log(`\n[RA] rows on PMM-26-0003/0001/000023: ${ra.recordset.length}`);
  for (const r of ra.recordset) {
    const slim: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) if (v !== null && v !== false && v !== 0) slim[k] = typeof v === "string" && v.length > 80 ? v.slice(0,80)+"…" : v;
    console.log("  " + JSON.stringify(slim));
  }

  const rwi = await corePool.request().input("tid", mssql.VarChar, tid).query(`
    SELECT PMMIdLookup, ResourceUser, COUNT(*) AS wk
    FROM core2.dbo.ResourceWorkItems
    WHERE TenantID=@tid AND PMMIdLookup IN ('PMM-26-0003','PMM-26-0001')
    GROUP BY PMMIdLookup, ResourceUser
  `);
  console.log(`\n[RWI] weekly containers on PMM-26-0003/0001: ${rwi.recordset.length}`);
  for (const r of rwi.recordset) console.log("  " + JSON.stringify(r));

  // Resolve names for the GUIDs seen above
  const users = await new mssql.Request(appPool).input("tid", mssql.NVarChar, tid).query(`
    SELECT id, name, email FROM dbo.rmone_users
    WHERE tenant_id=@tid AND (name LIKE '%Kiziak%' OR name LIKE '%Noblet%' OR name LIKE '%Kelly%' OR name LIKE '%Murry%' OR name LIKE '%Martt%')
  `);
  console.log(`\n[rmone_users] edge-case people: ${users.recordset.length}`);
  for (const r of users.recordset) console.log("  " + JSON.stringify(r));

  // 3+4) Needs-attention review rows
  const rev = await new mssql.Request(appPool).input("tid", mssql.NVarChar, tid).query(`
    SELECT TOP 20 * FROM dbo.rmone_import_review
    WHERE tenant_id=@tid ORDER BY created_at DESC
  `);
  console.log(`\n[rmone_import_review] latest rows: ${rev.recordset.length}`);
  for (const r of rev.recordset) {
    const slim: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      slim[k] = typeof v === "string" && v.length > 220 ? v.slice(0, 220) + "…" : v;
    }
    console.log("  " + JSON.stringify(slim));
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
