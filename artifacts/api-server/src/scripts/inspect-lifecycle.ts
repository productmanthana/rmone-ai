import { getPool } from "../lib/db.js";
async function main() {
  const pool = await getPool();

  // What columns are in the lifecycle config tables?
  for (const table of ["Config_ModuleLifeCycles", "Config_ProjectLifeCycleStages"]) {
    const r = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE FROM core2.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='${table}' ORDER BY ORDINAL_POSITION
    `);
    console.log(`\n── ${table} columns ──`);
    r.recordset.forEach((c: any) => console.log(`  ${c.COLUMN_NAME.padEnd(30)} ${c.DATA_TYPE}`));
  }

  // Sample the lifecycle definitions (OPM = Opportunity)
  const lc = await pool.request().query(`
    SELECT TOP 20 * FROM core2.dbo.Config_ModuleLifeCycles ORDER BY ID
  `);
  console.log("\n── Config_ModuleLifeCycles (sample) ──");
  lc.recordset.forEach((r: any) => console.log(JSON.stringify(r)));

  // Sample the stage definitions
  const stages = await pool.request().query(`
    SELECT TOP 30 * FROM core2.dbo.Config_ProjectLifeCycleStages ORDER BY ID
  `);
  console.log("\n── Config_ProjectLifeCycleStages (sample) ──");
  stages.recordset.forEach((r: any) => console.log(JSON.stringify(r)));

  // Also check PMMTasks for OPM tickets — does it link to Opportunity?
  const opmTasks = await pool.request().query(`
    SELECT TOP 5 pt.ID, pt.PMMIdLookup, pt.Title, pt.StartDate, pt.DueDate
    FROM core2.dbo.PMMTasks pt
    WHERE pt.Deleted=0 OR pt.Deleted IS NULL
    ORDER BY pt.ID DESC
  `);
  console.log("\n── PMMTasks sample rows ──");
  opmTasks.recordset.forEach((r: any) => console.log(JSON.stringify(r)));

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
