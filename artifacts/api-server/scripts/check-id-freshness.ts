/**
 * Record-ID freshness regression check (task: confirm the create pages
 * suggest a brand-new ID right after a teammate's conversion).
 *
 * The "Project ID already taken" fix relies on a multi-layer freshness chain:
 *   client module-cache bust + one-shot ?fresh=1 latch
 *     (getModuleRecordsFresh / markModuleRecordsFresh in rmone-web lib/api.ts)
 *   → server GET /records/:module with fresh=1 drops the serving worker's
 *     cached copy BEFORE reading (bustRdsRecordsLocal in rmone-proxy.ts).
 * A regression in ANY layer silently reintroduces stale next-ID suggestions.
 * This check pins the SERVER half end-to-end: after user A creates a record,
 * a fresh=1 fetch by user B (a different session, same tenant) MUST include
 * the new record — so an ID suggestion computed from that list is N+1, never
 * a re-issue of the just-taken ID.
 *
 * What it does (pattern: scripts/check-import-matching.ts):
 *   - Spawns its OWN api-server on a private port with WORKERS=1 (never
 *     touches the dev workflow server; one worker = one consistent memory).
 *   - Seeds a DISPOSABLE tenant (unique label per run) via a create-mode
 *     onboarding upload: one project, one opportunity, two staff logins.
 *   - For BOTH PMM and OPM:
 *       1. session B warms the worker's /records cache with a PLAIN fetch;
 *       2. session A creates a new record via POST /new-record;
 *       3. session B fetches /records/:module?fresh=1 and the check ASSERTS
 *          the new TicketId is present (⇒ suggestion would be N+1);
 *       4. a PLAIN (non-fresh) fetch is deliberately NOT asserted fresh —
 *          see the "stale-allowed" note inline. Do not "fix" that.
 *   - Wipes the disposable tenant afterwards, pass or fail.
 *
 * Runs as the `id-freshness` check workflow:
 *   pnpm --filter @workspace/api-server run check:id-freshness
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import ExcelJS from "exceljs";
import { v5 as uuidv5 } from "uuid";
import { signRdsToken } from "../src/lib/rds-auth.js";
import { getPool } from "../src/lib/db.js";
import { getMssqlPool } from "@workspace/db";
import { CLONE_CONFIG_TABLES } from "../src/onboarding/roles.js";

// Same tenant-label → GUID namespace the onboarding pipeline uses
// (see onboarding-tenant-guid: tid = uuidv5(label)).
const TENANT_NS = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const RUN_TAG = Date.now().toString(36);
const TENANT = `ID Fresh Check ${RUN_TAG}`;
const CORE_DB = process.env.CLIENT_DB_NAME ?? "core2";

// Private port so the check never talks to (or requires) the dev workflow server.
const PORT = 19000 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;

// Root-superadmin token (rmone home tenant) — used ONLY for the onboarding
// seed upload, which targets the disposable tenant by name.
const SUPER_TOKEN = signRdsToken({
  sub: "id-freshness-check",
  tenant: "rmone",
  username: "sanjeev@rmone.com",
  role: "admin",
  accessLevel: "admin",
});
const SUPER_AUTH = { Authorization: `Bearer ${SUPER_TOKEN}` };

// Two DISTINCT tenant-scoped sessions — "user A converts/creates, user B's
// create page must immediately see the new record". Both users are seeded by
// the Staff sheet below, so their rmone_users rows really exist (the live-ACL
// gate on /new-record verifies the DB row, not just the JWT).
const EMAIL_A = "casey@idfreshcheck.test";
const EMAIL_B = "riley@idfreshcheck.test";
function sessionToken(email: string): string {
  return signRdsToken({ sub: `idfresh-${email}`, tenant: TENANT, username: email, role: "user", accessLevel: "admin" });
}

const FIX_DIR = "/tmp/id-freshness-check";

// ── tiny assertion collector ─────────────────────────────────────────────────
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

// ── seed fixture ─────────────────────────────────────────────────────────────
const COMPANY_ID = "COM-26-000901";
const PROJECT_ID = "PRJ-26-0001";
const OPP_ID = "OPP-26-0001";

async function buildSeed(): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const sheets: Array<{ name: string; headers: string[]; rows: Array<Array<string | number>> }> = [
    { name: "Companies", headers: ["Title", "Company ID"], rows: [["ID Fresh Client Co", COMPANY_ID]] },
    {
      name: "Projects",
      headers: ["Title", "Project ID", "Company ID", "Start Date", "End Date", "Status"],
      rows: [["Seed Project Alpha", PROJECT_ID, COMPANY_ID, "2026-01-05", "2026-06-26", "Active"]],
    },
    {
      name: "Opportunities",
      headers: ["Title", "Opportunity ID", "Company ID", "Start Date", "End Date"],
      rows: [["Seed Pursuit Alpha", OPP_ID, COMPANY_ID, "2026-03-02", "2026-09-25"]],
    },
    {
      name: "Staff",
      headers: ["Full Name", "Login Email", "Role", "Job Title"],
      rows: [
        ["Casey Fresh", EMAIL_A, "Manager", "Project Manager"],
        ["Riley Fresh", EMAIL_B, "Manager", "Project Manager"],
      ],
    },
  ];
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.addRow(s.headers);
    for (const r of s.rows) ws.addRow(r);
  }
  const out = path.join(FIX_DIR, "seed.xlsx");
  await wb.xlsx.writeFile(out);
  return out;
}

// ── throwaway server ─────────────────────────────────────────────────────────
let serverProc: ChildProcess | null = null;

async function startServer(): Promise<void> {
  console.log(`Starting throwaway api-server on port ${PORT}…`);
  serverProc = spawn("npx", ["tsx", "./src/index.ts"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    // WORKERS=1: one worker = one consistent in-memory cache. This also makes
    // the check DETERMINISTIC for the fresh=1 layer — the create and the
    // fetch hit the SAME worker, so a fresh=1 regression can't be masked by
    // "the other worker happened to have no cache yet".
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", WORKERS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // own process group → kill primary + workers together
  });
  const log = fs.createWriteStream("/tmp/id-freshness-check-server.log");
  serverProc.stdout?.pipe(log);
  serverProc.stderr?.pipe(log);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/healthz`);
      if (r.ok) { console.log("Server is up."); return; }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`api-server never became healthy on port ${PORT} (see /tmp/id-freshness-check-server.log)`);
}

function stopServer(): void {
  if (!serverProc?.pid) return;
  try { process.kill(-serverProc.pid, "SIGTERM"); } catch { /* already gone */ }
  serverProc = null;
}

// ── seed upload (create mode) ────────────────────────────────────────────────
async function j(r: Response): Promise<any> {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 400) }; }
}

async function seedTenant(file: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const fd = new FormData();
    fd.append("tenantId", TENANT);
    fd.append(
      "file",
      new Blob([fs.readFileSync(file)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      path.basename(file),
    );
    const up = await j(await fetch(`${BASE}/api/onboarding/upload`, { method: "POST", headers: SUPER_AUTH, body: fd }));
    if (up.code === "IMPORT_IN_PROGRESS") {
      if (attempt >= 20) throw new Error("IMPORT_IN_PROGRESS never cleared for seed upload");
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    if (!up.uploadId) throw new Error(`seed upload failed: ${JSON.stringify(up).slice(0, 500)}`);
    const run = await j(await fetch(`${BASE}/api/onboarding/run`, {
      method: "POST",
      headers: { ...SUPER_AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId: up.uploadId, tenantId: TENANT, importMode: "create" }),
    }));
    if (run.code === "IMPORT_IN_PROGRESS") {
      if (attempt >= 20) throw new Error("IMPORT_IN_PROGRESS never cleared for seed run");
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    if (run.error) throw new Error(`seed run failed: ${JSON.stringify(run).slice(0, 500)}`);
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      // /status returns a FLAT payload (no nested result object).
      const st = await j(await fetch(`${BASE}/api/onboarding/status/${up.uploadId}`, { headers: SUPER_AUTH }));
      const s: string = st.status ?? st.job?.status;
      if (s && !["pending", "running"].includes(s)) {
        if (s !== "success" && s !== "partial") {
          throw new Error(`seed import ended ${s}: failureReason=${st.failureReason ?? "-"} fatal=${st.fatalError ?? "-"}`);
        }
        console.log(`Seed import ${s} (inserted=${st.totalInserted ?? "?"}).`);
        return;
      }
    }
    throw new Error("timed out waiting for seed import");
  }
}

// ── records fetch helpers ────────────────────────────────────────────────────
interface RecordsPayload { Status?: boolean; total?: number; data?: Array<Record<string, unknown>> }

async function fetchRecords(module: "PMM" | "OPM", token: string, fresh: boolean): Promise<RecordsPayload> {
  const url = `${BASE}/api/rmone/records/${module}${fresh ? "?fresh=1" : ""}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as RecordsPayload;
}

function ticketIds(p: RecordsPayload): Set<string> {
  return new Set((p.data ?? []).map((r) => String(r.TicketId ?? "").trim()).filter(Boolean));
}

// Next-ID suggestion, mirroring what the create pages do: scan the record
// list for IDs shaped <PREFIX>-<yy>-<seq> and return max(seq)+1 with the same
// prefix/width. This is exactly why the fetch feeding it must be fresh.
function suggestNextId(ids: Set<string>, fallbackPrefix: string): string {
  let bestPrefix = fallbackPrefix;
  let bestNum = 0;
  let width = 4;
  for (const id of ids) {
    const m = /^([A-Z]{2,4}-\d{2})-(\d{2,8})$/.exec(id);
    if (!m) continue;
    const n = parseInt(m[2], 10);
    if (n > bestNum) { bestNum = n; bestPrefix = m[1]; width = m[2].length; }
  }
  return `${bestPrefix}-${String(bestNum + 1).padStart(width, "0")}`;
}

async function createRecord(module: "PMM" | "OPM", token: string, title: string, ticketId: string): Promise<string> {
  const res = await j(await fetch(`${BASE}/api/rmone/new-record`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    // The create pages send an explicit ID (their computed suggestion) —
    // /new-record never auto-mints (custom-ticket-id contract).
    body: JSON.stringify({ ModuleName: module, Fields: [
      { FieldName: "Title", Value: title },
      { FieldName: "TicketId", Value: ticketId },
    ] }),
  }));
  const id = String(res?.Data?.TicketId ?? res?.Data?.ID ?? "").trim() || ticketId;
  if (res?.Status === false) {
    throw new Error(`create ${module} record failed: ${JSON.stringify(res).slice(0, 500)}`);
  }
  return id;
}

// ── per-module scenario ──────────────────────────────────────────────────────
async function runModule(module: "PMM" | "OPM", tokenA: string, tokenB: string): Promise<void> {
  console.log(`\n== ${module}: teammate-create → fresh suggestion`);

  // 1) Session B warms THIS worker's /records cache — the exact state a
  //    create page is in right before someone else's conversion lands.
  const baseline = await fetchRecords(module, tokenB, false);
  const baseIds = ticketIds(baseline);
  check(`${module}: baseline plain fetch returns data`, (baseline.data?.length ?? 0) > 0,
    `total=${baseline.total} dataLen=${baseline.data?.length}`);

  // 2) Session A creates record N (the "teammate's conversion") using the ID
  //    its own create page would suggest.
  const suggestedForA = suggestNextId(baseIds, module === "PMM" ? "PRJ-26" : "OPP-26");
  const newId = await createRecord(module, tokenA, `Fresh Check ${module} ${RUN_TAG}`, suggestedForA);
  console.log(`  session A created ${module} record ${newId}`);
  check(`${module}: created TicketId not already in baseline`, !baseIds.has(newId), `id=${newId}`);

  // 3) STALE-ALLOWED CONTRAST (deliberately NOT a hard assertion): a PLAIN
  //    (non-fresh) fetch is ALLOWED to serve the pre-create snapshot — that
  //    5-minute per-worker cache is what keeps home/list pages fast, and the
  //    create pages opt out of it explicitly with the one-shot fresh=1 latch.
  //    Do NOT "fix" this by making plain reads always fresh (that would
  //    reintroduce the cold-read cost everywhere), and do NOT assert
  //    staleness either (single-worker same-process busts often make even
  //    the plain read fresh — both outcomes are legal here).
  const plain = await fetchRecords(module, tokenB, false);
  console.log(`  plain (non-fresh) fetch ${ticketIds(plain).has(newId) ? "already sees" : "does NOT yet see"} ${newId} — either is acceptable by design`);

  // 4) THE contract: a fresh=1 fetch by a DIFFERENT session must include the
  //    new record, so an ID suggestion computed from it is N+1 — never a
  //    re-issue of the just-taken ID.
  const fresh = await fetchRecords(module, tokenB, true);
  const freshIds = ticketIds(fresh);
  check(`${module}: fresh=1 fetch includes the new record`,
    freshIds.has(newId),
    `id=${newId} total=${fresh.total} dataLen=${fresh.data?.length}`);
  const suggestedForB = suggestNextId(freshIds, module === "PMM" ? "PRJ-26" : "OPP-26");
  check(`${module}: session B's suggestion advances past the just-taken ID (N+1)`,
    suggestedForB !== newId && !freshIds.has(suggestedForB),
    `suggested=${suggestedForB} taken=${newId}`);
}

// ── disposable-tenant cleanup (same pass-loop approach as delete-tenant.ts) ──
async function wipeTenant(label: string): Promise<void> {
  console.log("\nCleaning up disposable tenant…");
  const allTids = [...new Set([uuidv5(label.toLowerCase(), TENANT_NS), uuidv5(label, TENANT_NS)])];
  try {
    const pool = await getPool();
    const cols = await pool.request().query(`
      SELECT TABLE_SCHEMA s, TABLE_NAME t FROM ${CORE_DB}.INFORMATION_SCHEMA.COLUMNS
      WHERE LOWER(COLUMN_NAME)='tenantid'`);
    const has = new Map<string, string>(cols.recordset.map((r: any) => [r.t.toLowerCase(), r.s]));
    const fqs = CLONE_CONFIG_TABLES.filter((t) => has.has(t.toLowerCase()))
      .map((t) => `[${CORE_DB}].[${has.get(t.toLowerCase())}].[${t}]`);
    const pred = allTids.map((g) => `TenantID='${g}'`).join(" OR ");
    let remaining = 1;
    for (let pass = 0; pass < 8 && remaining > 0; pass++) {
      let deleted = 0;
      for (const fq of fqs) {
        try {
          const r = await pool.request().query(`DELETE FROM ${fq} WHERE ${pred}`);
          deleted += r.rowsAffected[0] || 0;
        } catch { /* FK order — retried next pass */ }
      }
      const rc = await pool.request().query(fqs.map((fq) => `SELECT COUNT(*) n FROM ${fq} WHERE ${pred}`).join("\nUNION ALL\n"));
      remaining = (rc.recordset as any[]).reduce((a, x) => a + x.n, 0);
      if (deleted === 0 && remaining > 0) break;
    }
    console.log(remaining === 0 ? "  core2: clean" : `  core2: WARNING — ${remaining} rows survived`);
  } catch (e: any) {
    console.warn(`  core2 cleanup failed: ${e?.message ?? e}`);
  }
  try {
    const app = await getMssqlPool();
    const tables = await app.request().query(`
      SELECT c.TABLE_NAME t, c.COLUMN_NAME col FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_SCHEMA='dbo' AND c.TABLE_NAME LIKE 'rmone[_]%'
        AND LOWER(c.COLUMN_NAME) IN ('tenant_id','tenantid')`);
    const keys = [...new Set([label, label.toLowerCase(), ...allTids])];
    const inList = keys.map((k) => `'${k.replace(/'/g, "''")}'`).join(",");
    for (const r of tables.recordset as Array<{ t: string; col: string }>) {
      try { await app.request().query(`DELETE FROM dbo.[${r.t}] WHERE [${r.col}] IN (${inList})`); } catch { /* best effort */ }
    }
    console.log("  app DB: clean");
  } catch (e: any) {
    console.warn(`  app DB cleanup failed: ${e?.message ?? e}`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(FIX_DIR, { recursive: true });
  const seed = await buildSeed();
  console.log(`Fixture written to ${seed}`);

  await startServer();
  try {
    console.log(`\n== seed create-mode tenant → "${TENANT}"`);
    await seedTenant(seed);

    const tokenA = sessionToken(EMAIL_A);
    const tokenB = sessionToken(EMAIL_B);

    await runModule("PMM", tokenA, tokenB);
    await runModule("OPM", tokenA, tokenB);
  } finally {
    stopServer();
    await wipeTenant(TENANT);
  }

  if (failures.length) {
    console.error(`\n✗ id-freshness check FAILED (${failures.length}): ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("\n✓ id-freshness check passed");
  process.exit(0);
}

main().catch((e) => {
  console.error("CHECK_FAIL", e);
  stopServer();
  process.exit(1);
});
