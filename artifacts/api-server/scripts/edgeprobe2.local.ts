// Post-run facts: job results (incl. validation step + held counts), review queue, DB state.
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
  const jobs = (hist.jobs ?? hist.items ?? hist ?? []);
  for (const jb of (Array.isArray(jobs) ? jobs : [])) {
    console.log(`JOB ${jb.fileName ?? jb.file_name} status=${jb.status} mode=${jb.importMode ?? jb.import_mode}`);
    const r = jb.result ?? {};
    console.log("  result keys:", Object.keys(r).join(","));
    for (const s of (r.steps ?? [])) {
      console.log(`  step "${s.name ?? s.step}": keys=${Object.keys(s).join(",")} | ${JSON.stringify(s).slice(0, 360)}`);
    }
    if (r.needsAttention) console.log("  needsAttention:", JSON.stringify(r.needsAttention).slice(0, 400));
  }
  const core2 = await getPool();
  const ra = await core2.request().query(`SELECT TOP 6 * FROM core2.dbo.ResourceAllocation WHERE TenantID='${TID}'`);
  const raRows = ra.recordset ?? [];
  if (raRows.length) console.log("RA cols:", Object.keys(raRows[0]).join(","));
  console.log("RA:", JSON.stringify(raRows.map((r: any) => ({ tk: r.TicketId, user: r.ResourceUser, role: r.RoleLookup ?? r.Role ?? null, hrs: r.PctAllocation ?? r.AllocationHour ?? null })) ));
  const rwi = await core2.request().query(`SELECT TOP 8 TicketId, ResourceUser FROM core2.dbo.ResourceWorkItems WHERE TenantID='${TID}'`);
  console.log("RWI:", JSON.stringify(rwi.recordset));
  const app = await getMssqlPool();
  const users = await app.request().query(`SELECT name, email, title, enabled FROM dbo.rmone_users WHERE tenant_id='${TID}' ORDER BY name`);
  console.log("USERS:", JSON.stringify(users.recordset));
}
main().then(() => process.exit(0)).catch(e => { console.error("PROBE2_FAIL", e?.message ?? e); process.exit(1); });
