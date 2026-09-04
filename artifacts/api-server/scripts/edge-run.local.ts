// Drives the full edge-case e2e against a fresh synthetic tenant:
//   1) upload + run /tmp/edge-seed.xlsx   (create — brand-new tenant)
//   2) upload + run /tmp/edge-cases.xlsx  (update — the edge matrix)
//   3) dump review queue + DB spot-checks proving every case's outcome
// Read-only against every other tenant; writes only under the edge tenant GUID.
// v2: fresh tenant name, explicit columnMappings for the Assignments sheet
// (the web wizard always sends these; the bare API call must too), and
// column-name-safe DB spot checks.
import * as fs from "node:fs";
import { signRdsToken } from "../src/lib/rds-auth.js";
import { getPool } from "../src/lib/db.js";
import { getMssqlPool } from "@workspace/db";

const TENANT = "Edge Test Co 3";
const OLD_TIDS = [ // prior runs' tenants — exclude from GUID discovery
  "ff4d9cc1-cb29-5700-90a7-baff1001d647",
  "58f66e0b-288c-591a-9c76-2854113722f1",
];
const BASE = `http://127.0.0.1:${process.env.PORT || "8080"}/api/onboarding`;
const tok = signRdsToken({ sub: "edge-e2e", tenant: TENANT, username: "__edge_e2e__", role: "", accessLevel: "admin" });
const H = { Authorization: `Bearer ${tok}` };

// Friendly template headers → canonical pipeline field keys (what the web
// upload wizard's grid sends with every run).
const COLUMN_MAPPINGS = {
  "Assignments": {
    "Project": "Project",
    "Name": "FullName",
    "Email": "UserName",
    "Start Date": "AllocationStartDate",
    "End Date": "AllocationEndDate",
    "Total Hours": "AllocationHour",
    "Type": "AllocationType",
  },
};

async function j(r: Response) { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 400) }; } }

async function uploadAndRun(file: string, importMode: "create" | "update") {
  const buf = fs.readFileSync(file);
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), file.split("/").pop()!);
  const up = await j(await fetch(`${BASE}/upload`, { method: "POST", headers: H, body: fd }));
  if (!up.uploadId) { console.error("UPLOAD_FAIL", JSON.stringify(up).slice(0, 600)); process.exit(1); }
  const run = await j(await fetch(`${BASE}/run`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId: up.uploadId, importMode, columnMappings: COLUMN_MAPPINGS }),
  }));
  if (run.error) { console.error("RUN_FAIL", JSON.stringify(run).slice(0, 600)); process.exit(1); }
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const st = await j(await fetch(`${BASE}/status/${up.uploadId}`, { headers: H }));
    const s = st.status ?? st.job?.status;
    if (i % 10 === 0) console.log(`  [${file.split("/").pop()}] ${s} ${(st.progress?.phase ?? "")}`);
    if (s && !["pending", "running"].includes(s)) {
      const result = st.result ?? st.job?.result ?? {};
      console.log(`DONE ${file.split("/").pop()} status=${s} totalErrors=${result.totalErrors ?? 0}`);
      for (const x of (result.steps ?? [])) {
        console.log(`    step ${x.table ?? x.name ?? x.step}: ins=${x.rowsInserted ?? x.inserted ?? 0} upd=${x.rowsUpdated ?? 0} skip=${x.rowsSkipped ?? 0} attn=${x.rowsNeedsAttention ?? 0} err=${(x.errors?.length ?? x.errors) || 0}`);
        for (const e of (Array.isArray(x.errors) ? x.errors.slice(0, 4) : [])) console.log(`       err: ${e.message ?? JSON.stringify(e).slice(0, 140)}`);
      }
      return { uploadId: up.uploadId, status: s, result };
    }
  }
  console.error("TIMEOUT waiting for", file); process.exit(1);
}

async function main() {
  let seed: { status: string } = { status: "skipped" };
  if (!process.env.SKIP_SEED) {
    console.log("== 1) seed (create)");
    seed = await uploadAndRun("/tmp/edge-seed.xlsx", "create");
  }
  console.log("== 2) edge matrix (update)");
  const edge = await uploadAndRun("/tmp/edge-cases.xlsx", "update");

  console.log("== 3) review queue");
  const rev = await j(await fetch(`${BASE}/review`, { headers: H }));
  const items = rev.items ?? [];
  console.log(`openCount=${rev.openCount ?? items.length}`);
  for (const it of items) {
    console.log(`  [${it.status ?? "open"}] kind=${it.kind} label="${it.displayLabel ?? ""}" rows=${it.rowCount ?? "?"}`);
    console.log(`     reason: ${(it.reason ?? "").slice(0, 220)}`);
    console.log(`     suggests: ${JSON.stringify((it.suggestions ?? []).map((c: any) => `${c.label}${c.detail ? ` <${c.detail}>` : ""}`)).slice(0, 200)}`);
  }

  console.log("== 4) DB spot checks");
  const core2 = await getPool();
  const g = await core2.request().query(
    `SELECT DISTINCT TenantID FROM core2.dbo.PMM WHERE Title='Riverside Tower' AND TenantID NOT IN (${OLD_TIDS.map(t => `'${t}'`).join(",")})`);
  const tid = g.recordset?.[0]?.TenantID;
  console.log("edge tenant GUID:", tid);
  if (!tid) { console.error("E2E_FAIL no fresh tenant found"); process.exit(1); }
  const pmm = await core2.request().query(`SELECT TicketId, Title, Status FROM core2.dbo.PMM WHERE TenantID='${tid}' AND (Deleted IS NULL OR Deleted=0) ORDER BY Title`);
  console.log("PROJECTS:", JSON.stringify(pmm.recordset));
  const ra = await core2.request().query(`SELECT TOP 8 * FROM core2.dbo.ResourceAllocation WHERE TenantID='${tid}'`);
  const raRows = (ra.recordset ?? []) as Record<string, unknown>[];
  console.log(`RA rows: ${raRows.length}`);
  for (const r of raRows) {
    const slim: Record<string, unknown> = {};
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (v != null && v !== "" && !(v instanceof Date && String(k).toLowerCase().includes("created"))) slim[k] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
    }
    console.log("   RA:", JSON.stringify(slim).slice(0, 300));
  }
  const rwi = await core2.request().query(`SELECT TOP 8 * FROM core2.dbo.ResourceWorkItems WHERE TenantID='${tid}'`);
  const wRows = (rwi.recordset ?? []) as Record<string, unknown>[];
  console.log(`RWI rows: ${wRows.length}${wRows.length ? " cols=" + Object.keys(wRows[0]).slice(0, 14).join(",") : ""}`);
  const app = await getMssqlPool();
  const users = await app.request().query(`SELECT name, email, title, enabled FROM dbo.rmone_users WHERE tenant_id='${tid}' ORDER BY name`);
  console.log("USERS:", JSON.stringify(users.recordset));
  console.log("SUMMARY seed=", seed.status, "edge=", edge.status);
}
main().then(() => process.exit(0)).catch(e => { console.error("E2E_FAIL", e); process.exit(1); });
