import { getPool } from "../src/lib/db.js";
async function main() {
  const pool = await getPool();
  for (let i = 0; i < 8; i++) {
    const t0 = Date.now();
    await pool.request().query("SELECT 1 AS x");
    const t1 = Date.now();
    await pool.request().query("SELECT TOP 5 ID FROM core2.dbo.PMM WHERE TenantID='820cf51f-2e42-5998-ade4-f8d05ce88a91' AND (Deleted=0 OR Deleted IS NULL) ORDER BY ID DESC");
    console.log(`round ${i}: SELECT1=${t1 - t0}ms  smallRead=${Date.now() - t1}ms`);
    await new Promise(r => setTimeout(r, 3000));
  }
  process.exit(0);
}
main().catch(e => { console.error("FATAL", String(e?.message || e).slice(0,200)); process.exit(1); });
