import { getPool } from "../src/lib/db.js";
async function main() {
  const t0 = Date.now();
  const pool = await getPool();
  const r = await pool.request().query("SELECT COUNT(*) n FROM rmoneapp.dbo.rmone_onboarding_jobs WHERE tenant_id LIKE 'stresstest-%-0806'");
  console.log("probe ok in", Date.now() - t0, "ms — 0806 job rows:", r.recordset[0].n);
  process.exit(0);
}
main().catch(e => { console.error("PROBE FAIL", String(e?.message || e).slice(0, 200)); process.exit(1); });
