// Read-only probe: current Alston AI projects + people for edge-case file design.
import { getPool } from "../src/lib/db.js";
import { getMssqlPool } from "@workspace/db";
const TID = "22897300-acd1-5876-bfba-ae8b794cedd0";
function pick(r: any, ...names: string[]) { for (const n of names) if (r[n] !== undefined && r[n] !== null) return r[n]; return null; }
async function main() {
  const core2 = await getPool();
  const pr = await core2.request().query(`SELECT TOP 12 TicketId, Title, Status FROM core2.dbo.PMM WHERE TenantID='${TID}' AND (Deleted IS NULL OR Deleted=0) ORDER BY ID DESC`);
  console.log("PROJECTS=" + JSON.stringify(pr.recordset));
  const opp = await core2.request().query(`SELECT TOP 5 TicketId, Title FROM core2.dbo.Opportunity WHERE TenantID='${TID}' AND (Deleted IS NULL OR Deleted=0) ORDER BY ID DESC`);
  console.log("OPPS=" + JSON.stringify(opp.recordset));
  const app = await getMssqlPool();
  const ur = await app.request().query(`SELECT TOP 15 * FROM dbo.rmone_users WHERE tenant_id='${TID}'`);
  const rows = ur.recordset ?? [];
  if (rows.length) console.log("USER_KEYS=" + JSON.stringify(Object.keys(rows[0])));
  console.log("USERS=" + JSON.stringify(rows.map((r: any) => ({
    name: pick(r, "name", "full_name", "display_name") ?? `${pick(r, "first_name", "FirstName") ?? ""} ${pick(r, "last_name", "LastName") ?? ""}`.trim(),
    email: pick(r, "email", "Email", "user_email"),
    title: pick(r, "title", "job_title"),
    enabled: pick(r, "enabled", "Enabled"),
  }))));
}
main().then(() => process.exit(0)).catch(e => { console.error("PROBE_FAIL", e?.message ?? e); process.exit(1); });
