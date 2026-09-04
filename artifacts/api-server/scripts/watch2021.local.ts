import { getPool } from "../src/lib/db.js";
async function main() {
  const pool = await getPool();
  const cols = (await pool.request().query(
    `SELECT COLUMN_NAME c, CHARACTER_MAXIMUM_LENGTH l FROM rmoneapp.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='rmone_onboarding_jobs'`
  )).recordset as any[];
  const slim = cols.filter(r => r.l !== -1).map(r => `[${r.c}]`).join(", ");
  console.log("columns:", cols.map(r => r.c + (r.l === -1 ? "(LOB)" : "")).join(","));
  const q = `SELECT TOP 12 ${slim} FROM rmoneapp.dbo.rmone_onboarding_jobs WITH (NOLOCK)
             WHERE tenant_id LIKE '%test2%' ORDER BY ${cols.some(r => r.c === 'created_at') ? '[created_at]' : '[upload_id]'} DESC`;
  const rows = (await pool.request().query(q)).recordset;
  const now = (await pool.request().query(`SELECT SYSUTCDATETIME() t`)).recordset[0].t;
  console.log("serverUtcNow:", now);
  for (const r of rows) console.log(JSON.stringify(r));
  process.exit(0);
}
main().catch(e => { console.error("ERR", e.message); process.exit(1); });
