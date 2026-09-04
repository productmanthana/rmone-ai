import { getPool } from "../lib/db.js";
async function main() {
  const pool = await getPool();
  for (const table of ["PMM", "Opportunity"]) {
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
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
