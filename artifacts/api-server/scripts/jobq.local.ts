import { getPool } from "../src/lib/db.js";
const TID = "20ce292b-950e-5749-9712-f44b2248378c";
async function snap(pool: any, tag: string) {
  const out: string[] = [tag];
  for (const t of ["PMM", "ResourceAllocation", "ResourceWorkItems", "AspNetUsers", "CRMCompany"]) {
    const r = await pool.request().query(`SELECT COUNT(*) n FROM core2.dbo.[${t}] WITH (NOLOCK) WHERE TenantID='${TID}'`);
    out.push(`${t}=${r.recordset[0].n}`);
  }
  const j = await pool.request().query(`SELECT status FROM rmoneapp.dbo.rmone_onboarding_jobs WITH (NOLOCK) WHERE upload_id='76ab9b5c-6b2d-4be3-a46b-1b04ed618bd2'`);
  out.push(`jobStatus=${j.recordset[0]?.status}`);
  console.log(out.join(" "));
}
async function main() {
  const pool = await getPool();
  await snap(pool, "T0:");
  await new Promise(r => setTimeout(r, 25000));
  await snap(pool, "T+25s:");
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
