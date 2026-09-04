import { getPool, sql } from "../src/lib/db.js";
import { v5 as uuidv5 } from "uuid";

const NS = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const label = process.argv[2] ?? "test105";
const tid = /^[0-9a-f-]{36}$/i.test(label) ? label : uuidv5(label.toLowerCase(), NS);
console.log(`Tenant: ${label} → ${tid}`);

async function run() {
  const pool = await getPool();

  const r = await pool.request().input("tid", sql.NVarChar, tid).query(`
    SELECT TOP 10 u.Name, u.Title, u.DepartmentLookup, u.GlobalRoleID, u.JobTitleLookup,
           u.Designation, u.CurrentJobTitle,
           jt.Title AS ResolvedJobTitle,
           ro.Name AS ResolvedRole,
           dep.Title AS ResolvedDept
    FROM core2.dbo.AspNetUsers u
    LEFT JOIN core2.dbo.JobTitle jt ON CAST(jt.ID AS NVARCHAR(50)) = CAST(u.JobTitleLookup AS NVARCHAR(50))
    LEFT JOIN core2.dbo.Roles ro ON CAST(ro.Id AS NVARCHAR(50)) = CAST(u.GlobalRoleID AS NVARCHAR(50))
    LEFT JOIN core2.dbo.Department dep ON dep.ID = TRY_CAST(u.DepartmentLookup AS BIGINT)
    WHERE u.TenantID=@tid AND (u.Deleted=0 OR u.Deleted IS NULL) AND u.Enabled=1
    ORDER BY u.Name
  `);
  for (const row of r.recordset) { console.log(JSON.stringify(row)); }
}
run().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
