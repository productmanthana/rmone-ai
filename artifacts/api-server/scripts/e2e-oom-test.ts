/**
 * End-to-end OOM fix verification.
 *
 * Auth: signRdsToken superadmin (mirrors profile-run.ts / test-import-guard.ts).
 * Throwaway tenant: oomtest-<epoch-seconds> — unique per run, never conflicts.
 *
 * Run: cd artifacts/api-server && node_modules/.bin/tsx scripts/e2e-oom-test.ts
 */
import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { signRdsToken } from "../src/lib/rds-auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "../../..");
const BASE      = "http://localhost:8080";

// Unique per run so we never collide with a stuck job from a prior run.
const TENANT = `oomtest-${Math.floor(Date.now() / 1000)}`;

// Superadmin JWT — must match ROOT_SUPERADMIN_ACCOUNTS in rds-auth.ts
const TOKEN = signRdsToken({
  sub:         "oom-e2e-test",
  tenant:      "rmone",
  username:    "sanjeev@rmone.com",
  role:        "admin",
  accessLevel: "admin",
});
const AUTH = `Bearer ${TOKEN}`;

// ── HTTP helpers ──────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function api(method: string, urlPath: string, body?: object) {
  const payload = body ? JSON.stringify(body) : undefined;
  const r = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      Authorization:   AUTH,
      "Content-Type":  "application/json",
      ...(payload ? { "Content-Length": String(Buffer.byteLength(payload)) } : {}),
    },
    body: payload,
  });
  let json: any = null;
  try { json = await r.json(); } catch { /* */ }
  return { status: r.status, json };
}

async function upload(urlPath: string, filePath: string, fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const bytes    = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  form.append("file", new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }), fileName);
  const r = await fetch(`${BASE}${urlPath}`, {
    method:  "POST",
    headers: { Authorization: AUTH },
    body:    form,
  });
  let json: any = null;
  try { json = await r.json(); } catch { /* */ }
  return { status: r.status, json };
}

// ── VmHWM via /proc ───────────────────────────────────────────────────────────
function workerPids(): number[] {
  try {
    return fs.readdirSync("/proc")
      .filter(d => /^\d+$/.test(d))
      .flatMap(pid => {
        try {
          const cmd = fs.readFileSync(`/proc/${pid}/cmdline`).toString().replace(/\0/g, " ");
          return (cmd.includes("tsx") && cmd.includes("src/index.ts")) ? [Number(pid)] : [];
        } catch { return []; }
      });
  } catch { return []; }
}

function vmHwmKb(pid: number): number {
  try {
    const m = fs.readFileSync(`/proc/${pid}/status`).toString().match(/VmHWM:\s*(\d+)/);
    return m ? Number(m[1]) : 0;
  } catch { return 0; }
}

function rss() {
  const pids = workerPids();
  let sum = 0, max = 0;
  for (const p of pids) { const kb = vmHwmKb(p); sum += kb; if (kb > max) max = kb; }
  return { pids, sumMb: Math.round(sum / 1024), maxMb: Math.round(max / 1024) };
}

// Delta of sumMb from a baseline snapshot — correct metric for per-import cost.
function deltaMb(peakSum: number, baselineSum: number) { return Math.max(0, peakSum - baselineSum); }

// ── Status poll — uses /status/:id path param ────────────────────────────────
async function pollDone(
  uploadId: string, tag: string, ms = 720_000,
): Promise<{ status: string; inserted: number; errors: number; sec: number; peakMb: number }> {
  const deadline = Date.now() + ms;
  let lastLine = ""; let peakMb = 0;
  while (Date.now() < deadline) {
    await sleep(5_000);
    const r   = await api("GET", `/api/onboarding/status/${uploadId}`);
    const st  = String(r.json?.status ?? "?");
    const pct = r.json?.progress?.pct ?? "";
    const ph  = String(r.json?.progress?.phase ?? "").slice(0, 60);
    const cur = rss();
    if (cur.sumMb > peakMb) peakMb = cur.sumMb;
    const line = `[${tag}] ${st.padEnd(9)} ${String(pct).padStart(3)}% | ${ph.padEnd(60)} | peak=${cur.sumMb} MB`;
    if (line !== lastLine) { process.stdout.write(`\r  ${line}  `); lastLine = line; }
    if (["success", "partial", "failed", "cancelled"].includes(st)) {
      process.stdout.write("\n");
      return {
        status:   st,
        inserted: r.json?.totalInserted ?? 0,
        errors:   r.json?.totalErrors   ?? 0,
        sec:      Math.round((ms - (deadline - Date.now())) / 1000),
        peakMb,
      };
    }
  }
  process.stdout.write("\n");
  return { status: "TIMEOUT", inserted: 0, errors: 0, sec: ms / 1000, peakMb };
}

// ── Cluster log helpers ───────────────────────────────────────────────────────
function latestApiLog(): string {
  try {
    const f = fs.readdirSync("/tmp/logs")
      .filter(n => n.includes("api-server") && n.endsWith(".log"))
      .map(n => ({ n, t: fs.statSync(`/tmp/logs/${n}`).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0];
    if (f) return fs.readFileSync(`/tmp/logs/${f.n}`, "utf8");
  } catch { /* */ }
  return "";
}

function respawnLines(log: string): string[] {
  return log.split("\n").filter(l =>
    l.includes("[cluster]") && (l.includes("died") || l.includes("restarting") || l.includes("SIGKILL")));
}

// ── Move fixtures ─────────────────────────────────────────────────────────────
function moveFixtures() {
  const dst = path.join(__dirname, "fixtures");
  fs.mkdirSync(dst, { recursive: true });
  for (const name of ["assignments-65k.xlsx", "combined-67k.xlsx"]) {
    const src = path.join(WORKSPACE, name);
    if (fs.existsSync(src)) {
      fs.renameSync(src, path.join(dst, name));
      console.log(`  moved ${name} → scripts/fixtures/`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { console.log(`  ✅  ${label}`); pass++; }
  else { console.error(`  ❌  ${label}${detail ? " — " + detail : ""}`); fail++; }
}

async function runImport(
  filePath: string, tag: string,
  extraFields: Record<string, string>, importMode: string,
): Promise<{ uploadId?: string; status: string; inserted: number; errors: number; sec: number; peakMb: number }> {
  const before = rss();
  console.log(`  VmHWM before ${tag}: sumMb=${before.sumMb} maxMb=${before.maxMb}`);

  // Upload
  const up = await upload(`/api/onboarding/upload`, filePath, { tenantId: TENANT, ...extraFields });
  if (up.status !== 200) {
    console.error(`  upload → ${up.status}: ${JSON.stringify(up.json).slice(0, 300)}`);
    return { status: "upload_failed", inserted: 0, errors: 0, sec: 0, peakMb: 0 };
  }
  const uploadId: string = up.json.uploadId;
  console.log(`  uploadId: ${uploadId}`);
  if (up.json?.sheets) {
    for (const sh of up.json.sheets) console.log(`    sheet="${sh.sheetName}" totalRows=${sh.totalRows}`);
  }

  // Verify DB row exists immediately (Change 4)
  const dbChk = await api("GET", `/api/onboarding/status/${uploadId}`);
  ok(`${tag}: DB row exists immediately after /upload (Change 4)`,
    dbChk.status === 200 && !!dbChk.json?.status,
    `http=${dbChk.status} body=${JSON.stringify(dbChk.json).slice(0, 100)}`);

  // Run
  const run = await api("POST", "/api/onboarding/run", { uploadId, tenantId: TENANT, importMode });
  if (run.status !== 200) {
    console.error(`  run → ${run.status}: ${JSON.stringify(run.json).slice(0, 300)}`);
    return { uploadId, status: "run_failed", inserted: 0, errors: 0, sec: 0, peakMb: 0 };
  }

  // Poll
  const res = await pollDone(uploadId, tag);
  const after = rss();
  console.log(
    `  VmHWM after ${tag}: sumMb=${after.sumMb} maxMb=${after.maxMb}` +
    `  (peak during poll=${res.peakMb} MB, Δ=+${after.sumMb - before.sumMb} MB)`,
  );
  console.log(`  → status=${res.status} inserted=${res.inserted} errors=${res.errors} elapsed=${res.sec}s`);
  return { uploadId, ...res };
}

async function main() {
  console.log(`\n  Tenant: ${TENANT}`);

  // Baseline
  const logBefore  = latestApiLog();
  const baseRespawn = new Set(respawnLines(logBefore));
  const startPids  = new Set(workerPids());
  const baseRss    = rss();
  console.log(`  Worker PIDs: ${[...startPids].join(", ")}`);
  console.log(`  Baseline VmHWM: sumMb=${baseRss.sumMb} maxMb=${baseRss.maxMb}\n`);

  // ══ 1. Small-file sanity (3-row Staff) ══════════════════════════════════════
  console.log("══ 1. Small-file sanity (3-row Staff) ══════════════════════");
  const smallPath = `/tmp/oom-small-${Date.now()}.xlsx`;
  {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new (ExcelJS as any).stream.xlsx.WorkbookWriter({ filename: smallPath, useStyles: false });
    const ws = wb.addWorksheet("Staff");
    for (const row of [
      ["Full Name", "Email", "Role"],
      ["Alice OomTest", `alice+${TENANT}@oomtest.internal`, "Engineer"],
      ["Bob OomTest",   `bob+${TENANT}@oomtest.internal`,   "Manager"],
    ]) (ws as any).addRow(row).commit();
    await (ws as any).commit();
    await wb.commit();
  }
  const smallBase = rss();
  const small = await runImport(smallPath, "small", {}, "create");
  const smallDelta = deltaMb(small.peakMb, smallBase.sumMb);
  ok("small: success or partial",          ["success", "partial"].includes(small.status), `status=${small.status}`);
  ok("small: rows inserted > 0",           small.inserted > 0,  `inserted=${small.inserted}`);
  ok("small: heap delta < 300 MB (6 wkr)", smallDelta < 300,    `delta=${smallDelta} MB`);

  // ══ 2. combined-67k.xlsx (3-tab: Projects + Staff + Assignments) ════════════
  console.log("\n══ 2. combined-67k.xlsx (~62k assignments, 3 tabs) ════════");
  const combinedSrc = [
    path.join(WORKSPACE, "combined-67k.xlsx"),
    path.join(__dirname, "fixtures", "combined-67k.xlsx"),
  ].find(p => fs.existsSync(p));
  ok("combined-67k file found", !!combinedSrc, "generate it with scripts/gen-test-imports.mjs first");

  if (combinedSrc) {
    const combinedBase = rss();
    const c = await runImport(combinedSrc, "combined-67k", {}, "add");
    const combinedDelta = deltaMb(c.peakMb, combinedBase.sumMb);
    ok("combined-67k: no crash/timeout",          !["TIMEOUT", "upload_failed", "run_failed"].includes(c.status), `status=${c.status}`);
    ok("combined-67k: success or partial",         ["success", "partial"].includes(c.status), `status=${c.status}`);
    ok("combined-67k: inserted > 0",              c.inserted > 0,    `inserted=${c.inserted}`);
    ok("combined-67k: heap delta < 1200 MB",      combinedDelta < 1200, `delta=${combinedDelta} MB (6 workers)`);
  }

  // ══ 3. assignments-65k.xlsx (64,587 rows, single tab) ══════════════════════
  console.log("\n══ 3. assignments-65k.xlsx (64,587 rows) ══════════════════");
  const assignSrc = [
    path.join(WORKSPACE, "assignments-65k.xlsx"),
    path.join(__dirname, "fixtures", "assignments-65k.xlsx"),
  ].find(p => fs.existsSync(p));
  ok("assignments-65k file found", !!assignSrc, "generate it with scripts/gen-test-imports.mjs first");

  if (assignSrc) {
    const a = await runImport(assignSrc, "assign-65k", { forcedTabType: "assignments" }, "add");
    ok("assign-65k: no crash/timeout",         !["TIMEOUT", "upload_failed", "run_failed"].includes(a.status), `status=${a.status}`);
    ok("assign-65k: terminal (success/partial/failed)", ["success", "partial", "failed"].includes(a.status), `status=${a.status}`);
    ok("assign-65k: peak RSS < 1536 MB",       a.peakMb < 1536, `peakMb=${a.peakMb} MB`);
  }

  // ══ 4. Corrupt file → 400 + audit trace (Change 4 DB-trace check) ══════════
  console.log("\n══ 4. Corrupt file → 400 (parse-fail path) ════════════════");
  const corruptPath = "/tmp/oom-corrupt.xlsx";
  fs.writeFileSync(corruptPath, "definitely not xlsx");
  const corruptUp = await upload("/api/onboarding/upload", corruptPath, { tenantId: TENANT });
  ok("corrupt: /upload returns 400",   corruptUp.status === 400, `status=${corruptUp.status}`);
  ok("corrupt: error message present", !!corruptUp.json?.error,  JSON.stringify(corruptUp.json).slice(0, 120));
  console.log(`  error: ${String(corruptUp.json?.error).slice(0, 120)}`);

  // ══ 5. Cluster stability ════════════════════════════════════════════════════
  console.log("\n══ 5. Cluster stability ════════════════════════════════════");
  const logAfter    = latestApiLog();
  const newRespawns = respawnLines(logAfter).filter(l => !baseRespawn.has(l));
  const endPids     = new Set(workerPids());
  const newPids     = [...endPids].filter(p => !startPids.has(p));
  ok("no worker respawn/SIGKILL",      newRespawns.length === 0, newRespawns.slice(0, 3).join(" | "));
  ok("PID set unchanged (no restart)", newPids.length     === 0, `new: ${newPids.join(",")}`);
  if (newRespawns.length) newRespawns.forEach(l => console.error(`  respawn: ${l}`));
  const finalRss = rss();
  console.log(`  Final VmHWM: sumMb=${finalRss.sumMb}  maxMb=${finalRss.maxMb}`);
  console.log(`  End PIDs:    ${[...endPids].join(", ")}`);

  // ══ Cleanup ══════════════════════════════════════════════════════════════════
  console.log("\n══ Cleanup ═════════════════════════════════════════════════");
  moveFixtures();

  // ══ Summary ══════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Tenant used: ${TENANT}`);
  console.log(`  PASS ${pass}   FAIL ${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error("\nFATAL:", e); process.exit(1); });
