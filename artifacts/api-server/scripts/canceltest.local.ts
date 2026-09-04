// Throwaway dev test: external cancel (DB flip) aborts a running import mid-run.
import * as fs from "node:fs";
import sql from "mssql";
import { v5 as uuidv5 } from "uuid";
import { signRdsToken } from "../src/lib/rds-auth.js";
import { getPool } from "../src/lib/db.js";

const BASE = "http://localhost:8080/api";
const LABEL = "canceltest5-0807";
const FILE = "/tmp/stress/stresstest-a-0807.xlsx";
const STATE_F = "/tmp/canceltest.json";
const J = "rmoneapp.dbo.rmone_onboarding_jobs";

const st = (): any => (fs.existsSync(STATE_F) ? JSON.parse(fs.readFileSync(STATE_F, "utf8")) : {});
const save = (s: any) => fs.writeFileSync(STATE_F, JSON.stringify(s));
const tid = (): string => {
  const src = fs.readFileSync(new URL("../src/lib/pipeline.ts", import.meta.url), "utf8");
  const m = src.match(/TENANT_NAMESPACE\s*=\s*"([0-9a-fA-F-]{36})"/);
  if (!m) throw new Error("TENANT_NAMESPACE not found");
  return uuidv5(LABEL.toLowerCase(), m[1]);
};
const token = signRdsToken({ sub: `cancel-${LABEL}`, tenant: LABEL, username: `loadtest@${LABEL}.example`, role: "admin", accessLevel: "admin" });
async function api(path: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
  let json: any = null; try { json = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, json };
}

async function main() {
  const phase = process.argv[2];
  if (phase === "start") {
    const buf = fs.readFileSync(FILE);
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${LABEL}.xlsx`);
    const up = await api("/onboarding/upload", { method: "POST", body: fd });
    if (up.status !== 200 || !up.json?.uploadId) { console.log(`UPLOAD FAILED ${up.status} ${JSON.stringify(up.json).slice(0, 300)}`); process.exit(1); }
    const uploadId = up.json.uploadId as string;
    const run = await api("/onboarding/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, importMode: "create" }) });
    if (run.status >= 300) { console.log(`RUN FAILED ${run.status} ${JSON.stringify(run.json).slice(0, 300)}`); process.exit(1); }
    save({ uploadId, startedAt: Date.now() });
    console.log(`started uploadId=${uploadId} tid=${tid()}`);
  } else if (phase === "runonly") {
    const s = st();
    const run = await api("/onboarding/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId: s.uploadId, importMode: "create" }) });
    if (run.status >= 300) { console.log(`RUN FAILED ${run.status} ${JSON.stringify(run.json).slice(0, 300)}`); process.exit(1); }
    s.startedAt = Date.now(); save(s);
    console.log(`run kicked for ${s.uploadId}`);
  } else if (phase === "watch") {
    const budget = (Number(process.argv[3]) || 180) * 1000;
    const mode = process.argv[4] || "terminal";
    const s = st(); const t0 = Date.now();
    for (;;) {
      const r = await api(`/onboarding/status/${s.uploadId}`);
      const j = r.json || {};
      const pct = j.progress?.pct ?? "";
      const ph = j.progress?.phase ?? j.progress?.stage ?? "";
      console.log(`${new Date().toISOString().slice(11, 19)} status=${j.status} pct=${pct} phase=${String(ph).slice(0, 70)}`);
      if (["success", "failed", "cancelled", "error"].includes(String(j.status))) {
        s.terminalAt = Date.now(); s.finalStatus = j.status; save(s);
        if (s.flippedAt) console.log(`flip→terminal: ${((s.terminalAt - s.flippedAt) / 1000).toFixed(0)}s`);
        console.log(`TERMINAL ${j.status}`);
        process.exit(mode === "terminal" ? (j.status === "cancelled" ? 0 : 2) : 2);
      }
      if (mode === "pipeline" && j.status === "running" && /Registering client|Loading your data|Importing/i.test(String(ph))) {
        console.log("PIPELINE RUNNING — ready to flip"); process.exit(0);
      }
      if (Date.now() - t0 > budget) { console.log("(budget reached)"); process.exit(3); }
      await new Promise(r2 => setTimeout(r2, 8000));
    }
  } else if (phase === "flip") {
    const s = st();
    const pool = await getPool();
    const r = pool.request();
    r.input("uid", sql.NVarChar, s.uploadId);
    r.input("msg", sql.NVarChar, JSON.stringify({ fatalError: "Import cancelled by user" }));
    const res = await r.query(`UPDATE ${J} SET status='cancelled', result=@msg, updated_at=GETUTCDATE() WHERE upload_id=@uid AND status IN ('running','pending')`);
    s.flippedAt = Date.now(); save(s);
    console.log(`flipped rows=${res.rowsAffected?.[0] ?? 0}`);
    process.exit((res.rowsAffected?.[0] ?? 0) > 0 ? 0 : 1);
  } else if (phase === "verify") {
    const s = st();
    const pool = await getPool();
    const row = await pool.request().input("uid", sql.NVarChar, s.uploadId)
      .query(`SELECT status, CAST(result AS NVARCHAR(300)) AS result, owner_token FROM ${J} WHERE upload_id=@uid`);
    console.log("job row:", JSON.stringify(row.recordset[0]));
    const T = tid(); console.log("tid:", T);
    for (const t of ["PMM", "Opportunity", "Lead", "AspNetUsers", "ResourceAllocation", "ResourceWorkItems", "CRMCompany"]) {
      try {
        const c = await pool.request().input("tid", sql.NVarChar, T).query(`SELECT COUNT(*) n FROM core2.dbo.[${t}] WHERE TenantID=@tid`);
        console.log(`core2 ${t}: ${c.recordset[0].n}`);
      } catch (e: any) { console.log(`core2 ${t}: ERR ${e.number}`); }
    }
    const dbStatus = row.recordset[0]?.status;
    const pass = dbStatus === "cancelled" && s.finalStatus === "cancelled";
    console.log(pass ? "PASS: DB row stayed cancelled and job went cancelled in-app" : `CHECK: db=${dbStatus} mem=${s.finalStatus}`);
    process.exit(pass ? 0 : 2);
  } else if (phase === "cleanup") {
    const pool = await getPool();
    const jr = await pool.request().query(`DELETE FROM ${J} WHERE tenant_id='${LABEL}'`);
    const cols = await pool.request().query(`SELECT COLUMN_NAME c FROM rmoneapp.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='rmone_users'`);
    const names = new Set((cols.recordset as any[]).map(r => String(r.c).toLowerCase()));
    const preds = ["email", "username", "user_name"].filter(c => names.has(c)).map(c => `${c} LIKE '%@${LABEL}.example'`);
    let users = 0;
    if (preds.length) {
      const ur = await pool.request().query(`DELETE FROM rmoneapp.dbo.rmone_users WHERE ${preds.join(" OR ")}`);
      users = ur.rowsAffected?.[0] ?? 0;
    }
    console.log(`cleanup: jobs=${jr.rowsAffected?.[0] ?? 0} users=${users}; core2 purge: tsx scripts/delete-tenant.ts ${tid()}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
