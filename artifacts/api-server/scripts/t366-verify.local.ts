// Task #366 verification: renamed company + same Company ID must UPDATE, not duplicate.
import { getPool } from "../src/lib/db.js";
import { insertCompaniesBatch, type SheetData, type StepResult } from "../src/lib/pipeline.js";
import sql from "mssql";

const TID = "t366-verify-tenant-scratch";

function mkStep(): StepResult {
  return { step: 1, table: "CRMCompany", rowsAttempted: 0, rowsInserted: 0, rowsSkipped: 0, errors: [] };
}
function mkMaps(): Record<string, Map<string, any>> {
  return { companies: new Map(), divisions: new Map() };
}
async function dump(pool: sql.ConnectionPool) {
  const r = await pool.request().input("tid", sql.NVarChar, TID)
    .query("SELECT ID, Title, TicketId, City, Deleted FROM core2.dbo.CRMCompany WHERE TenantID=@tid ORDER BY ID");
  console.log(r.recordset);
  return r.recordset;
}
async function run(pool: sql.ConnectionPool, mode: "update", rows: any[], cols: string[]) {
  const sheet: SheetData = { sheetName: "Companies", columns: cols, rows };
  const step = mkStep();
  const warnings: string[] = [];
  await insertCompaniesBatch(pool, TID, sheet, mkMaps(), step, mode, undefined, warnings);
  console.log("step:", { ins: step.rowsInserted, upd: step.rowsUpdated, skip: step.rowsSkipped, errs: step.errors });
  if (warnings.length) console.log("warnings:", warnings);
}

async function main() {
  const pool = await getPool();
  // clean slate
  await pool.request().input("tid", sql.NVarChar, TID).query("DELETE FROM core2.dbo.CRMCompany WHERE TenantID=@tid");

  console.log("— 1) update-mode import creates two new companies (one with ID, one without)");
  await run(pool, "update", [
    { Title: "Acme Corp", "Company ID": "COM-26-000101", City: "Boston" },
    { Title: "NoId Co", City: "Denver" },
  ], ["Title", "Company ID", "City"]);
  const s1 = await dump(pool);

  console.log("— 2) re-import: renamed 'Acme Corp' → 'Acme Construction', SAME Company ID → must UPDATE in place");
  await run(pool, "update", [
    { Title: "Acme Construction", "Company ID": "COM-26-000101", City: "Cambridge" },
  ], ["Title", "Company ID", "City"]);
  const s2 = await dump(pool);

  console.log("— 3) no-ID row keeps name matching: 'NoId Co' updates by name, brand-new name inserts");
  await run(pool, "update", [
    { Title: "NoId Co", City: "Aurora" },
    { Title: "Fresh Co", City: "Tulsa" },
  ], ["Title", "City"]);
  const s3 = await dump(pool);

  const acme = s3.filter((r: any) => /acme/i.test(r.Title));
  const ok =
    s1.length === 2 &&
    s2.length === 2 && acme.length === 1 && acme[0].Title === "Acme Construction" &&
    acme[0].TicketId === "COM-26-000101" && acme[0].City === "Cambridge" &&
    acme[0].ID === s1.find((r: any) => /acme/i.test(r.Title))!.ID &&
    s3.length === 3 &&
    s3.find((r: any) => r.Title === "NoId Co")?.City === "Aurora";
  console.log(ok ? "PASS ✅ — ID-matched rename updated in place, no duplicates" : "FAIL ❌");

  // cleanup
  await pool.request().input("tid", sql.NVarChar, TID).query("DELETE FROM core2.dbo.CRMCompany WHERE TenantID=@tid");
  process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
