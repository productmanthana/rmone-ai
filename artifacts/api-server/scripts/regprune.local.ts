import { getPool } from "../src/lib/db.js";
async function main() {
  const pool = await getPool();
  const r = await pool.request().query(
    "DELETE FROM rmoneapp.dbo.rmone_active_tenants WHERE tenant_label LIKE 'oomtest-%' OR tenant_label LIKE 'wipetest-%' OR tenant_label LIKE 'canceltest-%' OR tenant_label LIKE 'stresstest-%'"
  );
  console.log("registry junk rows deleted:", r.rowsAffected?.[0] ?? 0);
  process.exit(0);
}
main().catch(e => { console.error("FATAL", String(e?.message || e).slice(0,200)); process.exit(1); });
