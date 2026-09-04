import { resolveTenantId } from "../src/lib/pipeline.js";
import sql from "mssql";

const label = "Alston AI";
const tid = resolveTenantId(label);
console.log(`tenant="${label}" tid=${tid}`);

const url = process.env.APP_DATABASE_URL!;
const u = new URL(url);
const pool = await sql.connect({
  server: u.hostname, port: u.port ? parseInt(u.port) : 1433,
  database: u.pathname.replace(/^\//, ""),
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true, requestTimeout: 60_000 },
});

const r = await pool.request().query(`
  SELECT ra.ID, ra.Title AS Role,
    CASE WHEN ra.ResourceUser IS NULL THEN 'OPEN' ELSE ra.ResourceUser END AS Who,
    (SELECT SUM(rw.PctAllocation) FROM dbo.ResourceWorkItems rw
     WHERE rw.ResourceAllocationId = ra.ID AND (rw.Deleted IS NULL OR rw.Deleted=0)) AS TotalHours,
    (SELECT SUM(rw.AllocationHour) FROM dbo.ResourceWorkItems rw
     WHERE rw.ResourceAllocationId = ra.ID AND (rw.Deleted IS NULL OR rw.Deleted=0)) AS AllocHours,
    (SELECT COUNT(*) FROM dbo.ResourceWorkItems rw
     WHERE rw.ResourceAllocationId = ra.ID AND (rw.Deleted IS NULL OR rw.Deleted=0)) AS Weeks
  FROM dbo.ResourceAllocation ra
  WHERE ra.TicketId IN ('PMM-26-000008','PMM-26-00008')
    AND ra.TenantID = '${tid}'
    AND (ra.Deleted IS NULL OR ra.Deleted=0)
  ORDER BY ra.Title, ra.ID
`);

if (r.recordset.length === 0) {
  // Check what columns we have
  const sample = await pool.request().query(`SELECT TOP 1 * FROM dbo.ResourceAllocation WHERE TenantID='${tid}'`);
  if (sample.recordset.length) console.log("Cols:", Object.keys(sample.recordset[0]).join(", "));
  else console.log("No rows at all for this tenant");
} else {
  const byRole: Record<string, {pct: number, alloc: number}> = {};
  for (const row of r.recordset) {
    const role = String(row.Role ?? "—");
    const pct = Number(row.TotalHours ?? 0);
    const alloc = Number(row.AllocHours ?? 0);
    console.log(`RA ${row.ID}: "${role}" | ${row.Who} | PctAlloc=${pct}h AllocHour=${alloc}h | ${row.Weeks}wks`);
    byRole[role] = { pct: (byRole[role]?.pct ?? 0) + pct, alloc: (byRole[role]?.alloc ?? 0) + alloc };
  }
  console.log("\n--- Totals per role ---");
  for (const [role, v] of Object.entries(byRole).sort())
    console.log(`  "${role}": PctAlloc=${v.pct}h  AllocHour=${v.alloc}h`);
  console.log("\nExpected from Excel: Asst Supt=940h, PM=900h (47 and 45 weeks, 20h/wk)");
}

await pool.close();
process.exit(0);
