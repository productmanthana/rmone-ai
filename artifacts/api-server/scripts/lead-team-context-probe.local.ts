// Dev probe: lead-team-context (Resources → Manager view backend).
// Verifies BOTH provider functions directly AND the HTTP route:
//  1. Leads directory (list mode) — counts, partial flag, tier fields.
//  2. Rich-lead context — multi-record dedupe, per-record leads/teams,
//     name-only tokens, teamError/truncated flags.
//  3. Worker case — non-lead user returns isLead:false + zero records.
//  4. HTTP route auth gating (401 without token, 200 with).
// Local use only.
import { getUserByUsername } from "@workspace/db";
import { signRdsToken } from "../src/lib/rds-auth.js";
import { getLeadsDirectoryRds, getLeadTeamContextRds } from "../src/lib/rds-provider.js";
import { getActiveUsersByTenant } from "@workspace/db";

const PORT = process.env.PORT || "8080";

async function main() {
  const u = await getUserByUsername("agent@testrmone.com");
  if (!u) { console.log("FAIL: no agent@testrmone.com user"); process.exit(1); }
  const tid = u.tenantId;
  console.log("tenant:", tid, "agent user:", u.id);

  // 1 — directory
  const dir = await getLeadsDirectoryRds(tid);
  console.log(`DIR: leads=${dir.leads.length} partial=${dir.partial}`);
  for (const l of dir.leads.slice(0, 8)) {
    console.log(`  ${l.name} [${l.title || "-"}] records=${l.recordCount} fields=${l.fields.join(",")}`);
  }

  // 2 — richest lead context
  const rich = [...dir.leads].sort((a, b) => b.recordCount - a.recordCount)[0];
  if (rich) {
    const ctx = await getLeadTeamContextRds(tid, rich.id);
    console.log(`CTX(${rich.name}): isLead=${ctx.isLead} records=${ctx.records.length} teamError=${ctx.teamError} truncated=${ctx.truncated}`);
    let nameOnly = 0, teamTotal = 0;
    const uniqueTeam = new Set<string>();
    let crossRecordRepeats = 0;
    for (const r of ctx.records) {
      teamTotal += r.team.length;
      for (const l of r.leads) if (!l.id) nameOnly++;
      for (const m of r.team) {
        const k = m.id.toLowerCase();
        if (uniqueTeam.has(k)) crossRecordRepeats++;
        uniqueTeam.add(k);
      }
    }
    for (const r of ctx.records.slice(0, 5)) {
      console.log(`  [${r.module}] ${r.ticketId} "${r.title.slice(0, 40)}" leads=${r.leads.map(l => `${l.name}(${l.field}${l.id ? "" : ",NAME-ONLY"})`).join("|") || "-"} team=${r.team.length}`);
      for (const m of r.team.slice(0, 3)) console.log(`      team: ${m.name} role="${m.role}" title="${m.title}"`);
    }
    console.log(`  team rows total=${teamTotal} unique people=${uniqueTeam.size} cross-record repeats=${crossRecordRepeats} name-only lead tokens=${nameOnly}`);
    // sanity: selected person must appear in every record's leads
    const missing = ctx.records.filter(r => !r.leads.some(l => (l.id ?? "").toLowerCase() === rich.id.toLowerCase()));
    console.log(`  records missing selected-as-lead: ${missing.length}${missing.length ? " ← BUG (unless matched by name-token)" : " ✓"}`);
  } else {
    console.log("CTX: no leads in directory — skipping rich-lead test");
  }

  // 3 — worker case (an active user NOT in the directory)
  const leadIds = new Set(dir.leads.map(l => l.id.toLowerCase()));
  const actives = await getActiveUsersByTenant(tid);
  const worker = actives.find(a => a.enabled && !leadIds.has(a.id.toLowerCase()));
  if (worker) {
    const wc = await getLeadTeamContextRds(tid, worker.id);
    const ok = !wc.isLead && wc.records.length === 0;
    console.log(`WORKER(${worker.name}): isLead=${wc.isLead} records=${wc.records.length} person="${wc.person.name}" ${ok ? "✓" : "← BUG"}`);
  } else {
    console.log("WORKER: every active user is a lead — skipped");
  }

  // 4 — HTTP route (auth gating + parity with direct call)
  const token = signRdsToken({ sub: u.id, tenant: "testrmone", username: u.username, role: "", accessLevel: "admin" });
  const H = { Authorization: `Bearer ${token}`, "x-rmone-tenant": "testrmone", Accept: "application/json" };
  const base = `http://localhost:${PORT}/api/rmone/lead-team-context`;
  const noAuth = await fetch(`${base}?list=1`);
  console.log(`HTTP no-auth: ${noAuth.status} ${noAuth.status === 401 ? "✓" : "← expected 401"}`);
  const listRes = await fetch(`${base}?list=1`, { headers: H });
  const listBody = listRes.ok ? await listRes.json() : await listRes.text();
  console.log(`HTTP list: ${listRes.status} leads=${listRes.ok ? (listBody as { leads: unknown[] }).leads.length : listBody}`);
  if (rich) {
    const ctxRes = await fetch(`${base}?personId=${encodeURIComponent(rich.id)}`, { headers: H });
    const ctxBody = ctxRes.ok ? await ctxRes.json() as { records: unknown[]; isLead: boolean } : await ctxRes.text();
    console.log(`HTTP ctx: ${ctxRes.status} ${ctxRes.ok ? `records=${(ctxBody as { records: unknown[] }).records.length}` : ctxBody}`);
  }
  const badRes = await fetch(base, { headers: H });
  console.log(`HTTP no-param: ${badRes.status} ${badRes.status === 400 ? "✓" : "← expected 400"}`);
  // non-GUID personId must be rejected before any LIKE scan (%/_ broadening)
  const nonGuid = await fetch(`${base}?personId=${encodeURIComponent("abc%def_")}`, { headers: H });
  console.log(`HTTP non-GUID personId: ${nonGuid.status} ${nonGuid.status === 400 ? "✓" : "← expected 400"}`);

  // 5 — custom lead roles (CustomLeadsJson): temporarily grant a unique-named
  // non-lead user a custom role on one live record, verify BOTH scans and the
  // HTTP route surface it, then restore the record's original value.
  const { getPool } = await import("../src/lib/db.js");
  const sql = (await import("mssql")).default;
  const nameCount = new Map<string, number>();
  for (const a of actives) {
    const n = (a.name || a.username || "").trim().toLowerCase();
    if (n) nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
  }
  const cWorker = actives.find(a => a.enabled && !leadIds.has(a.id.toLowerCase())
    && (a.name || "").trim() && nameCount.get((a.name || "").trim().toLowerCase()) === 1);
  const pool = await getPool();
  const colChk = await pool.request().query(
    `SELECT COL_LENGTH('core2.dbo.Opportunity','CustomLeadsJson') AS L`);
  if (!cWorker) {
    console.log("CUSTOM: no unique-named non-lead active user — skipped");
  } else if (colChk.recordset?.[0]?.L == null) {
    console.log("CUSTOM: CustomLeadsJson column absent on this RDS — skipped (scan treats as none)");
  } else {
    const pick = await pool.request().input("t", sql.NVarChar, tid).query(
      `SELECT TOP 1 TicketId, CustomLeadsJson FROM core2.dbo.Opportunity
       WHERE TenantID=@t AND (Deleted IS NULL OR Deleted=0) AND TicketId IS NOT NULL AND LTRIM(RTRIM(TicketId))<>''`);
    const row = pick.recordset?.[0];
    if (!row) {
      console.log("CUSTOM: no live Opportunity record — skipped");
    } else {
      const tick = String(row.TicketId).trim();
      const orig: string | null = row.CustomLeadsJson ?? null;
      const wname = (cWorker.name || cWorker.username || "").trim();
      try {
        await pool.request()
          .input("t", sql.NVarChar, tid).input("k", sql.VarChar, tick)
          .input("j", sql.NVarChar, JSON.stringify({ "QA Lead": [wname] }))
          .query(`UPDATE core2.dbo.Opportunity SET CustomLeadsJson=@j WHERE TenantID=@t AND TicketId=@k`);
        const dir2 = await getLeadsDirectoryRds(tid);
        const de = dir2.leads.find(l => l.id.toLowerCase() === cWorker.id.toLowerCase());
        console.log(`CUSTOM dir: ${de ? `"${de.name}" fields=${de.fields.join(",")} records=${de.recordCount}` : "MISSING"} ${de?.fields.includes("custom:QA Lead") ? "✓" : "← expected custom:QA Lead ← BUG"}`);
        const cc = await getLeadTeamContextRds(tid, cWorker.id);
        const rec = cc.records.find(r => r.ticketId.toLowerCase() === tick.toLowerCase());
        const lead = rec?.leads.find(l => (l.id ?? "").toLowerCase() === cWorker.id.toLowerCase());
        console.log(`CUSTOM ctx: isLead=${cc.isLead} recordFound=${!!rec} leadEntry=${lead ? `${lead.name}(${lead.field})` : "-"} ${cc.isLead && lead?.field === "custom:QA Lead" ? "✓" : "← BUG"}`);
        const hres = await fetch(`${base}?personId=${encodeURIComponent(cWorker.id)}`, { headers: H });
        const hbody = hres.ok ? await hres.json() as { isLead: boolean; records: unknown[] } : null;
        console.log(`CUSTOM http: ${hres.status} isLead=${hbody?.isLead} records=${hbody?.records.length} ${hres.ok && hbody?.isLead ? "✓" : "← BUG"}`);
      } finally {
        await pool.request()
          .input("t", sql.NVarChar, tid).input("k", sql.VarChar, tick)
          .input("j", sql.NVarChar, orig)
          .query(`UPDATE core2.dbo.Opportunity SET CustomLeadsJson=@j WHERE TenantID=@t AND TicketId=@k`);
        console.log("CUSTOM: original CustomLeadsJson restored");
      }
    }
  }
  process.exit(0);
}
main().catch(e => { console.error("FAIL:", e); process.exit(1); });
