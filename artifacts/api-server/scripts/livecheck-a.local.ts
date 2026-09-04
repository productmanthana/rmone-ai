import * as fs from "node:fs";
import { v5 as uuidv5 } from "uuid";
import { getPool } from "../src/lib/db.js";
async function main() {
  const src = fs.readFileSync("src/lib/pipeline.ts", "utf8");
  const ns = src.match(/TENANT_NAMESPACE\s*=\s*["']([0-9a-fA-F-]{36})["']/)?.[1];
  if (!ns) { console.error("namespace not found"); process.exit(1); }
  const tid = uuidv5("stresstest-a-0807".toLowerCase(), ns);
  console.log("tid:", tid);
  const pool = await getPool();
  for (const t of ["PMM","CRMCompany","Roles","JobTitle","CompanyDivisions","Department","AspNetUsers","ResourceAllocation","ResourceWorkItems"]) {
    try {
      const r = await pool.request().query(
        `SELECT SUM(CASE WHEN Deleted = 0 OR Deleted IS NULL THEN 1 ELSE 0 END) AS live, COUNT(*) AS total
         FROM core2.dbo.[${t}] WHERE TenantID='${tid}'`);
      console.log(`${t}: live=${r.recordset[0].live ?? 0} total=${r.recordset[0].total}`);
    } catch (e: any) { console.log(`${t}: err ${String(e?.message || e).slice(0, 80)}`); }
  }
  process.exit(0);
}
main().catch(e => { console.error("FATAL", String(e?.message || e).slice(0,200)); process.exit(1); });
