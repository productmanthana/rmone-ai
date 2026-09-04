import { getMssqlPool, mssql } from "@workspace/db";

async function main() {
  const pool = await getMssqlPool();
  const check = await pool.request().query(`
    SELECT COLUMN_NAME, TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME IN ('rmone_usage_events','rmone_usage_daily') AND COLUMN_NAME = 'context'
  `);
  console.log("existing context cols:", JSON.stringify(check.recordset));
  const tables = (check.recordset as { COLUMN_NAME: string; TABLE_NAME: string }[]).map((r) => r.TABLE_NAME);
  if (!tables.includes("rmone_usage_events")) {
    await pool.request().query("ALTER TABLE dbo.rmone_usage_events ADD context NVARCHAR(200) NULL");
    console.log("Added context to rmone_usage_events");
  }
  if (!tables.includes("rmone_usage_daily")) {
    await pool.request().query("ALTER TABLE dbo.rmone_usage_daily ADD context NVARCHAR(200) NULL");
    console.log("Added context to rmone_usage_daily");
  }
  console.log("done");
  process.exit(0);
}

void main().catch((e) => { console.error(e); process.exit(1); });
