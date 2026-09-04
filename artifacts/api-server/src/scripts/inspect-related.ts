import { getPool } from "../lib/db.js";
async function main() {
  const pool = await getPool();

  // First check which tables exist
  const exists = await pool.request().query(`
    SELECT TABLE_NAME FROM core2.INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA='dbo'
    AND TABLE_NAME IN (
      'Lead','BusinessUnit','PMMTasks','objProjectLifeCycle',
      'ProjectLifeCycle','ResourceWorkItems','ResourceAllocation',
      'PMMPhase','PMMSchedule','TaskSchedule','PMMProjectLifeCycle'
    )
    ORDER BY TABLE_NAME
  `);
  console.log("\n── Tables found ──");
  exists.recordset.forEach((r: any) => console.log(" ", r.TABLE_NAME));

  const tables = exists.recordset.map((r: any) => r.TABLE_NAME as string);

  for (const table of tables) {
    const r = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM core2.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='${table}'
      ORDER BY ORDINAL_POSITION
    `);
    console.log(`\n══ ${table} ══`);
    r.recordset.forEach((c: any) => {
      const len = c.CHARACTER_MAXIMUM_LENGTH ? `(${c.CHARACTER_MAXIMUM_LENGTH})` : "";
      console.log(`  ${c.COLUMN_NAME.padEnd(35)} ${c.DATA_TYPE}${len}  null=${c.IS_NULLABLE}`);
    });
  }

  // Also check Lead table specifically (may have different name)
  const leadCheck = await pool.request().query(`
    SELECT TABLE_NAME FROM core2.INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME LIKE '%Lead%'
    ORDER BY TABLE_NAME
  `);
  console.log("\n── Tables matching *Lead* ──");
  leadCheck.recordset.forEach((r: any) => console.log(" ", r.TABLE_NAME));

  // And phase/schedule related
  const schedCheck = await pool.request().query(`
    SELECT TABLE_NAME FROM core2.INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA='dbo' AND (
      TABLE_NAME LIKE '%Phase%' OR TABLE_NAME LIKE '%Schedule%'
      OR TABLE_NAME LIKE '%PMM%' OR TABLE_NAME LIKE '%Life%'
    )
    ORDER BY TABLE_NAME
  `);
  console.log("\n── Tables matching Phase/Schedule/PMM/Life ──");
  schedCheck.recordset.forEach((r: any) => console.log(" ", r.TABLE_NAME));

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
