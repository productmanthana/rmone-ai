import { getPool } from "../src/lib/db.js";
async function main() {
  const pool = await getPool();
  const r = await pool.request().query("SELECT tenant_label, CONVERT(varchar(19), last_active_at, 126) AS at FROM rmoneapp.dbo.rmone_active_tenants ORDER BY last_active_at DESC");
  for (const row of r.recordset) console.log(`${String(row.at)}  ${String(row.tenant_label)}`);
  process.exit(0);
}
main().catch(e => { console.error("FATAL", String(e?.message || e).slice(0,200)); process.exit(1); });
