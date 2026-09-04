import { getMssqlPool } from "@workspace/db";
async function main() {
  const pool = await getMssqlPool();
  const c = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='rmone_onboarding_jobs' ORDER BY ORDINAL_POSITION`);
  console.log(c.recordset.map((r: any) => `${r.COLUMN_NAME}(${r.DATA_TYPE})`).join(", "));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
