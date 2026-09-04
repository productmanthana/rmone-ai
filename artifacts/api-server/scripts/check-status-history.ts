/**
 * Status-history HTTP-contract check (Reports coverage honesty).
 *
 * Guards the server→client truncation contract permanently:
 * GET /api/rmone/status-history must return `truncated` alongside
 * `rows` and `since`. If `truncated` were dropped (or defaulted false)
 * from a capped response, the Reports pages would assess coverage from
 * the tenant-wide earliest change and present incomplete per-period
 * conversion counts as complete — exactly the dishonesty the ledger
 * exists to prevent (the web-side fail-closed logic is guarded by
 * check:reports-honesty; this check guards the wire contract feeding it).
 *
 * What it does:
 *   - Spawns its OWN api-server on a private port (WORKERS=1; never touches
 *     the dev workflow server).
 *   - Inserts 3 ledger rows for a DISPOSABLE tenant directly via
 *     recordStatusChanges.
 *   - GET /status-history?limit=2 → 200, rows.length === 2 (newest-first),
 *     truncated === true, since === the tenant's EARLIEST change (which is
 *     NOT in the returned rows — the exact case the client must fail closed
 *     on).
 *   - GET /status-history (no limit) → all 3 rows, truncated === false.
 *   - Unauthenticated GET → 401.
 *   - Deletes the disposable tenant's ledger rows whether or not assertions
 *     passed.
 *
 * Run: pnpm --filter @workspace/api-server run check:status-history
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { signRdsToken } from "../src/lib/rds-auth.js";
import { getPool } from "../src/lib/db.js";
import { ensureStatusHistoryTable } from "../src/lib/statusHistory.js";
import sql from "mssql";

const RUN_TAG = Date.now().toString(36);
const TENANT_LABEL = `Status Hist Check ${RUN_TAG}`;

const PORT = 19000 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = signRdsToken({
  sub: "status-history-check",
  tenant: TENANT_LABEL,
  username: "check@rmone.local",
  role: "admin",
  accessLevel: "admin",
});
const AUTH = { Authorization: `Bearer ${TOKEN}` };
// signRdsToken derives tid from the tenant label — recover it from the JWT
// payload so inserts and cleanup hit the same tenant the route will read.
const TID = (JSON.parse(Buffer.from(TOKEN.split(".")[1]!, "base64url").toString()) as { tid: string }).tid;

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

let serverProc: ChildProcess | null = null;
async function startServer(): Promise<void> {
  console.log(`Starting throwaway api-server on port ${PORT}…`);
  serverProc = spawn("npx", ["tsx", "./src/index.ts"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", WORKERS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const log = fs.createWriteStream("/tmp/status-history-check-server.log");
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
  throw new Error(`api-server never became healthy on port ${PORT} (see /tmp/status-history-check-server.log)`);
}
function stopServer(): void {
  if (!serverProc?.pid) return;
  try { process.kill(-serverProc.pid, "SIGTERM"); } catch { /* already gone */ }
  serverProc = null;
}

async function cleanup(): Promise<void> {
  try {
    const pool = await getPool();
    await pool.request().input("tid", sql.VarChar, TID)
      .query(`DELETE FROM core2.dbo.RMOneStatusHistory WHERE [TenantID] = @tid`);
    await pool.request().input("tid", sql.NVarChar, TID)
      .query(`DELETE FROM core2.dbo.CRMStatusLedger WHERE [TenantID] = @tid`);
    console.log("Cleaned up disposable tenant ledger rows.");
  } catch (e) {
    console.warn(`cleanup failed (harmless orphan rows for disposable tenant ${TID}): ${String(e).slice(0, 200)}`);
  }
}

async function main(): Promise<void> {
  // Seed 3 changes with distinct explicit timestamps (oldest first) — direct
  // insert so ChangedAt is controlled (the write helpers stamp GETUTCDATE).
  await ensureStatusHistoryTable();
  const pool = await getPool();
  const base = Date.now() - 3 * 86_400_000;
  for (const i of [0, 1, 2]) {
    await pool.request()
      .input("tid", sql.VarChar, TID)
      .input("ticket", sql.VarChar, `CHK-${i}`)
      .input("at", sql.DateTime2, new Date(base + i * 86_400_000))
      .query(`
        INSERT INTO core2.dbo.RMOneStatusHistory
          ([TenantID],[Module],[TicketId],[OldStatus],[NewStatus],[ChangedAt],[Source])
        VALUES (@tid,'LEM',@ticket,N'Active',N'Converted',@at,'user')`);
  }
  console.log("  ✓ seeded 3 ledger rows");

  await startServer();

  const unauth = await fetch(`${BASE}/api/rmone/status-history`);
  check("unauthenticated → 401", unauth.status === 401, `got ${unauth.status}`);

  const capped = await fetch(`${BASE}/api/rmone/status-history?limit=2`, { headers: AUTH });
  check("capped: HTTP 200", capped.status === 200, `got ${capped.status}`);
  const cb = (await capped.json()) as { rows: any[]; since: string | null; truncated?: boolean };
  check("capped: rows.length === 2 (newest-first)", Array.isArray(cb.rows) && cb.rows.length === 2);
  check("capped: truncated === true on the wire", cb.truncated === true, `got ${JSON.stringify(cb.truncated)}`);
  check("capped: since is the EARLIEST change (older than every returned row)",
    !!cb.since && cb.rows.every((r) => new Date(r.changedAt).getTime() > new Date(cb.since!).getTime()),
    `since=${cb.since} rows=${cb.rows?.map((r) => r.changedAt).join(",")}`);

  const full = await fetch(`${BASE}/api/rmone/status-history`, { headers: AUTH });
  const fb = (await full.json()) as { rows: any[]; since: string | null; truncated?: boolean };
  check("uncapped: all 3 rows returned", Array.isArray(fb.rows) && fb.rows.length === 3, `got ${fb.rows?.length}`);
  check("uncapped: truncated === false on the wire", fb.truncated === false, `got ${JSON.stringify(fb.truncated)}`);

  /* ── CRMStatusLedger feed (/status-ledger) — same truncation contract.
   * The Reports pages fetch this per period; a capped response must say so
   * on the wire or the web would claim complete per-period counts. ── */
  const pool2 = await getPool();
  // Verify the PRODUCTION provisioning path first: an authed read against a
  // possibly-absent table must lazily create it and return an honest empty
  // feed (rows [], truncated false, since null for a fresh tenant) — never 502.
  const crmFresh = await fetch(`${BASE}/api/rmone/status-ledger?module=LEM`, { headers: AUTH });
  check("CRM ledger: read auto-provisions the table (no 502 when absent)", crmFresh.status === 200, `got ${crmFresh.status}`);
  const cfr = (await crmFresh.json()) as { rows: any[]; truncated?: boolean; since?: string | null };
  check("CRM ledger fresh tenant: empty rows + truncated false + since null",
    Array.isArray(cfr.rows) && cfr.rows.length === 0 && cfr.truncated === false && cfr.since === null,
    JSON.stringify(cfr));
  for (const i of [0, 1, 2]) {
    await pool2.request()
      .input("tid", sql.NVarChar, TID)
      .input("ticket", sql.VarChar, `CRM-${i}`)
      .input("at", sql.DateTime2, new Date(base + i * 86_400_000))
      .query(`
        INSERT INTO core2.dbo.CRMStatusLedger
          (TenantID, TicketId, Module, OldStatus, NewStatus, ChangedAt)
        VALUES (@tid, @ticket, 'LEM', N'Active', N'Converted', @at)`);
  }
  console.log("  ✓ seeded 3 CRM ledger rows");

  const crmUnauth = await fetch(`${BASE}/api/rmone/status-ledger`);
  check("CRM ledger: unauthenticated → 401", crmUnauth.status === 401, `got ${crmUnauth.status}`);

  const crmCapped = await fetch(`${BASE}/api/rmone/status-ledger?module=LEM&limit=2`, { headers: AUTH });
  check("CRM ledger capped: HTTP 200", crmCapped.status === 200, `got ${crmCapped.status}`);
  const cc = (await crmCapped.json()) as { rows: any[]; truncated?: boolean; since?: string | null };
  check("CRM ledger capped: rows.length === 2", Array.isArray(cc.rows) && cc.rows.length === 2, `got ${cc.rows?.length}`);
  check("CRM ledger capped: truncated === true on the wire", cc.truncated === true, `got ${JSON.stringify(cc.truncated)}`);
  check("CRM ledger: since = tenant recording-start watermark (oldest row, not in capped set)",
    typeof cc.since === "string" && cc.rows.every((r) => new Date(r.changedAt).getTime() >= new Date(cc.since!).getTime()),
    `since=${cc.since}`);

  const crmFull = await fetch(`${BASE}/api/rmone/status-ledger?module=LEM`, { headers: AUTH });
  const cf = (await crmFull.json()) as { rows: any[]; truncated?: boolean; since?: string | null };
  check("CRM ledger uncapped: all 3 rows returned", Array.isArray(cf.rows) && cf.rows.length === 3, `got ${cf.rows?.length}`);
  check("CRM ledger uncapped: truncated === false on the wire", cf.truncated === false, `got ${JSON.stringify(cf.truncated)}`);
}

main()
  .catch((e) => { failures.push("unhandled error"); console.error(e); })
  .finally(async () => {
    stopServer();
    await cleanup();
    if (failures.length) {
      console.error(`\ncheck-status-history: ${failures.length} failure(s): ${failures.join("; ")}`);
      process.exit(1);
    }
    console.log("\ncheck-status-history: all assertions passed");
    process.exit(0);
  });
