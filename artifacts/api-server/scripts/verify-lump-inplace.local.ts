// Task #672 verification: a repeated "Total Hours" save on a short assignment
// must update the existing lump row IN PLACE — no new RA row, no stacking.
// Re-saves the same 62h on PMM-25-000194 / RWI 271923 (test20) via the dev API
// and compares the RA row set before/after.
import sql from "mssql";
import { getPool } from "../src/lib/db.js";
import { signRdsToken } from "../src/lib/rds-auth.js";

const TID = "5c03084c-7413-5a56-9fa2-bc401f8a5650";
const TENANT = "test20";
const RWI = 271923;
const PROJECT = "PMM-25-000194";
const PORT = process.env.PORT || "8080";

const pool = await getPool();

const rows = async () => {
  const r = await pool.request()
    .input("tid", sql.VarChar, TID)
    .input("rwi", sql.BigInt, RWI)
    .query(`SELECT ID, AllocationHour, Deleted, AllocationStartDate, AllocationEndDate
            FROM core2.dbo.ResourceAllocation
            WHERE TenantID = @tid AND ResourceWorkItemLookup = @rwi
            ORDER BY ID`);
  return r.recordset as { ID: number; AllocationHour: number; Deleted: boolean; AllocationStartDate: Date; AllocationEndDate: Date }[];
};

const rwiRes = await pool.request()
  .input("tid", sql.VarChar, TID)
  .input("rwi", sql.BigInt, RWI)
  .query(`SELECT ResourceUser, Title, StartDate, EndDate FROM core2.dbo.ResourceWorkItems WHERE TenantID = @tid AND ID = @rwi`);
const rwi = rwiRes.recordset[0];
console.log(`RWI: person=${rwi.ResourceUser} title="${rwi.Title}" span=${rwi.StartDate?.toISOString()?.slice(0,10)}..${rwi.EndDate?.toISOString()?.slice(0,10)}`);

const before = await rows();
console.log("BEFORE:", before.map(r => `${r.ID}:${r.AllocationHour}h${r.Deleted ? "(del)" : ""}`).join(" "));

const token = signRdsToken({ sub: "verify-672", tenant: TENANT, username: "vyaasaiagent@gmail.com", role: "admin", accessLevel: "admin" });
const resp = await fetch(`http://127.0.0.1:${PORT}/api/rmone/assign-resource`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    ProjectID: PROJECT,
    Allocations: [{
      ID: RWI,
      AssignedTo: rwi.ResourceUser,
      Title: rwi.Title,
      JobTitleName: rwi.Title,
      AllocationStartDate: rwi.StartDate?.toISOString(),
      AllocationEndDate: rwi.EndDate?.toISOString(),
      AllocationHour: 62,
      PctAllocation: 62,
    }],
  }),
});
console.log(`POST /assign-resource → ${resp.status}: ${(await resp.text()).slice(0, 200)}`);

const after = await rows();
console.log("AFTER: ", after.map(r => `${r.ID}:${r.AllocationHour}h${r.Deleted ? "(del)" : ""}`).join(" "));

const newRows = after.filter(a => !before.some(b => b.ID === a.ID));
const activeLumps = after.filter(r => !r.Deleted && Number(r.AllocationHour) > 0
  && r.AllocationStartDate?.getTime() === rwi.StartDate?.getTime()
  && r.AllocationEndDate?.getTime() === rwi.EndDate?.getTime());
const pass = newRows.length === 0 && activeLumps.length === 1 && Number(activeLumps[0].AllocationHour) === 62;
console.log(`new rows created: ${newRows.length} (expect 0); active lump rows: ${activeLumps.length} (expect 1 @62h)`);
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
