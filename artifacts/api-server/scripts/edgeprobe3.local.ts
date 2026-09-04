import { signRdsToken } from "../src/lib/rds-auth.js";
import { getPool } from "../src/lib/db.js";
import { getMssqlPool } from "@workspace/db";
const TENANT = "Edge Test Co";
const TID = "ff4d9cc1-cb29-5700-90a7-baff1001d647";
const BASE = `http://127.0.0.1:${process.env.PORT || "8080"}/api/onboarding`;
const tok = signRdsToken({ sub: "edge-e2e", tenant: TENANT, username: "__edge_e2e__", role: "", accessLevel: "admin" });
const H = { Authorization: `Bearer ${tok}` };
async function j(r: Response) { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 300) }; } }
async function main() {
  const hist = await j(await fetch(`${BASE}/history`, { headers: H }));
  const jobs = (hist.jobs ?? hist.items ?? []);
  for (const jb of jobs) {
    const id = jb.uploadId ?? jb.upload_id;
    const st = await j(await fetch(`${BASE}/status/${id}`, { headers: H }));
    const r = st.result ?? {};
    console.log(`\n=== ${jb.fileName ?? jb.file_name} (${st.status}) resultKeys=${Object.keys(r).join(",")}`);
    for (const s of (r.steps ?? [])) console.log("  STEP:", JSON.stringify(s).slice(0, 500));
    for (const k of Object.keys(r)) if (!["steps"].includes(k)) console.log(`  ${k}:`, JSON.stringify((r as any)[k]).slice(0, 400));
  }
  const core2 = await getPool();
  const rwi = await core2.request().query(`SELECT TOP 8 * FROM core2.dbo.ResourceWorkItems WHERE TenantID='${TID}'`);
  const w = rwi.recordset ?? [];
  console.log("\nRWI count:", w.length, w.length ? "cols=" + Object.keys(w[0]).join(",").slice(0, 300) : "");
  for (const r0 of w) console.log("  RWI:", JSON.stringify({ user: r0.ResourceUser, pmm: r0.PMMIdLookup ?? r0.TicketIdLookup ?? r0.WorkItem ?? null, start: r0.StartDate ?? null }).slice(0, 200));
  const app = await getMssqlPool();
  const users = await app.request().query(`SELECT name, email, title FROM dbo.rmone_users WHERE tenant_id='${TID}' ORDER BY name`);
  console.log("\nUSERS:", JSON.stringify(users.recordset));
}
main().then(() => process.exit(0)).catch(e => { console.error("PROBE3_FAIL", e?.message ?? e); process.exit(1); });
