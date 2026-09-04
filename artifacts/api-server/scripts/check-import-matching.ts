/**
 * Import-matching regression check (task: catch strict-keys regressions
 * automatically before customers hit them).
 *
 * Two silent-regression classes this guards against permanently:
 *   1) Sheet expansion dropping identity columns (expandClientsSheet's
 *      whitelist once discarded CompanyId, silently downgrading company
 *      linking to name-based for ALL simplified/grid uploads).
 *   2) Gate helpers reading raw template headers while rows arrive with
 *      canonicalized keys (an email-only assignment row was wrongly blocked).
 *
 * What it does:
 *   - Spawns its OWN api-server instance on a private port (never touches the
 *     dev workflow server — restarting that during a live import is forbidden).
 *   - Generates small fixture XLSX files (raw-format sheets for Projects,
 *     Opportunities, Leads, Staff, Assignments, Schedule, Companies; plus a
 *     grid-format simplified workbook with wizard-style columnMappings).
 *   - Uploads each through POST /api/onboarding/upload + /run and polls
 *     /status, in create AND update modes, against DISPOSABLE tenants with
 *     unique per-run labels.
 *   - Asserts: valid files import cleanly; missing record ID / unknown
 *     Company ID / missing email BLOCK with failureReason "strict_keys" and
 *     zero writes; create mode stays tolerant (no strict_keys gate).
 *   - Wipes both disposable tenants (core2 rows by GUID + app-DB rmone_*
 *     rows by label) whether or not assertions passed.
 *
 * Runs as the `import-matching` check workflow:
 *   pnpm --filter @workspace/api-server run check:import-matching
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import ExcelJS from "exceljs";
import { v5 as uuidv5 } from "uuid";
import { signRdsToken } from "../src/lib/rds-auth.js";
import { getPool } from "../src/lib/db.js";
import { getMssqlPool, addImportReviewItems, listImportReview, resolveImportReviewItem } from "@workspace/db";
import { autoResolveAnsweredReviewItems } from "../src/lib/pipeline.js";
import { CLONE_CONFIG_TABLES } from "../src/onboarding/roles.js";
import sql from "mssql";

// Same tenant-label → GUID namespace the onboarding pipeline uses
// (see onboarding-tenant-guid: tid = uuidv5(label)).
const TENANT_NS = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const RUN_TAG = Date.now().toString(36);
const TENANT_MAIN = `Import Check ${RUN_TAG}`;
const TENANT_TOLERANT = `Import Check Tol ${RUN_TAG}`;
const CORE_DB = process.env.CLIENT_DB_NAME ?? "core2";

// Private port so the check never talks to (or requires) the dev workflow server.
const PORT = 18000 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = signRdsToken({
  // Root superadmin identity (rmone home tenant) — required so the upload
  // route lets the script target the disposable tenants by name.
  sub: "import-matching-check",
  tenant: "rmone",
  username: "sanjeev@rmone.com",
  role: "admin",
  accessLevel: "admin",
});
const AUTH = { Authorization: `Bearer ${TOKEN}` };

const FIX_DIR = "/tmp/import-matching-check";

// ── tiny assertion collector ─────────────────────────────────────────────────
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

// ── fixture generation ───────────────────────────────────────────────────────
type SheetSpec = { name: string; headers: string[]; rows: Array<Array<string | number>> };

async function writeWorkbook(file: string, sheets: SheetSpec[]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.addRow(s.headers);
    for (const r of s.rows) ws.addRow(r);
  }
  const out = path.join(FIX_DIR, file);
  await wb.xlsx.writeFile(out);
  return out;
}

const COMPANY_ID = "COM-26-000901";
const PROJECT_ID = "PRJ-26-0001";
const OPP_ID = "OPP-26-0001";
const LEAD_ID = "LED-26-0001";
const EMAIL_1 = "casey@importcheck.test";
const EMAIL_2 = "riley@importcheck.test";

/** Raw-format workbook: one tab per table, canonical/template headers.
 *  The Assignments tab intentionally carries an EMAIL-ONLY row (no name
 *  column at all) — regression class 2: that row must never be blocked. */
async function buildRawValid(): Promise<string> {
  return writeWorkbook("raw-valid.xlsx", [
    { name: "Companies", headers: ["Title", "Company ID"], rows: [["Import Check Client Co", COMPANY_ID]] },
    {
      name: "Projects",
      headers: ["Title", "Project ID", "Company ID", "Start Date", "End Date", "Status"],
      rows: [["Harbor Bridge Retrofit", PROJECT_ID, COMPANY_ID, "2026-01-05", "2026-06-26", "Active"]],
    },
    {
      name: "Opportunities",
      headers: ["Title", "Opportunity ID", "Company ID", "Start Date", "End Date"],
      rows: [["Downtown Tower Pursuit", OPP_ID, COMPANY_ID, "2026-03-02", "2026-09-25"]],
    },
    {
      name: "Leads",
      headers: ["Title", "Lead ID", "Company ID"],
      rows: [["Airport Expansion Lead", LEAD_ID, COMPANY_ID]],
    },
    {
      name: "Staff",
      headers: ["Full Name", "Login Email", "Role", "Job Title"],
      rows: [
        ["Casey Import", EMAIL_1, "Engineer", "Engineer"],
        ["Riley Import", EMAIL_2, "Manager", "Project Manager"],
      ],
    },
    {
      // Name + Email: create mode's tolerant ladder classifies a row with a
      // BLANK name as an open position (and then wants role/dates/hours), so
      // the raw seed row carries both. Email-only rows are pinned separately
      // in update mode (raw + grid), where the strict-keys gate must accept them.
      name: "Assignments",
      headers: ["Project ID", "Name", "Email", "Start Date", "End Date", "Total Hours"],
      rows: [[PROJECT_ID, "Casey Import", EMAIL_1, "2026-01-05", "2026-02-27", 160]],
    },
    {
      name: "Schedule",
      headers: ["Project ID", "Phase Name", "Start Date", "End Date"],
      rows: [
        [PROJECT_ID, "Design", "2026-01-05", "2026-02-27"],
        [PROJECT_ID, "Construction", "2026-03-02", "2026-06-26"],
      ],
    },
  ]);
}

/** Raw-format Assignments-only workbook whose single row identifies the
 *  person by EMAIL ONLY (no name column anywhere) — regression class 2:
 *  update mode must import it, never block it. */
async function buildRawEmailOnlyAssignment(): Promise<string> {
  return writeWorkbook("raw-email-only-assignment.xlsx", [
    {
      name: "Assignments",
      headers: ["Project ID", "Email", "Start Date", "End Date", "Total Hours"],
      rows: [[PROJECT_ID, EMAIL_1, "2026-04-06", "2026-05-01", 40]],
    },
  ]);
}

/** Grid-format (simplified) workbook — what the upload wizard's grid sends.
 *  "Clients & Projects" carries Company ID + Project ID columns: regression
 *  class 1 (expansion must PRESERVE identity columns, or update mode blocks). */
async function buildGridValid(): Promise<string> {
  return writeWorkbook("grid-valid.xlsx", [
    {
      name: "Your Team",
      headers: ["Full Name", "Email", "Role", "Job Title"],
      rows: [
        ["Casey Import", EMAIL_1, "Engineer", "Engineer"],
        ["Riley Import", EMAIL_2, "Manager", "Project Manager"],
      ],
    },
    {
      name: "Clients & Projects",
      headers: ["Type", "Company Name", "Company ID", "Project Title", "Project ID", "Start Date", "End Date", "Status"],
      rows: [
        ["Project", "Import Check Client Co", COMPANY_ID, "Harbor Bridge Retrofit", PROJECT_ID, "2026-01-05", "2026-06-26", "Active"],
        ["Opportunity", "Import Check Client Co", COMPANY_ID, "Downtown Tower Pursuit", OPP_ID, "2026-03-02", "2026-09-25", ""],
      ],
    },
    {
      // Email-only person reference (Name column present but BLANK) — the
      // canonicalized-keys gate regression: must import, never block.
      name: "Assignments",
      headers: ["Project", "Project ID", "Name", "Email", "Start Date", "End Date", "Total Hours", "Type"],
      rows: [["Harbor Bridge Retrofit", PROJECT_ID, "", EMAIL_1, "2026-03-02", "2026-03-27", 80, ""]],
    },
  ]);
}

// Wizard-style grid mappings for the Assignments tab (friendly header →
// canonical pipeline field), mirroring what the web upload grid sends.
const GRID_MAPPINGS = {
  Assignments: {
    "Project": "Project",
    "Project ID": "TicketId",
    "Name": "FullName",
    "Email": "UserName",
    "Start Date": "AllocationStartDate",
    "End Date": "AllocationEndDate",
    "Total Hours": "AllocationHour",
    "Type": "AllocationType",
  },
} as const;

async function buildBadFixtures(): Promise<Record<string, string>> {
  return {
    missingRecordId: await writeWorkbook("bad-missing-record-id.xlsx", [
      { name: "Projects", headers: ["Title", "Company ID"], rows: [["No ID Project", COMPANY_ID]] },
    ]),
    unknownCompanyId: await writeWorkbook("bad-unknown-company.xlsx", [
      {
        name: "Projects",
        headers: ["Title", "Project ID", "Company ID"],
        rows: [["Ghost Co Project", "PRJ-26-0002", "COM-26-999999"]],
      },
    ]),
    staffNoEmail: await writeWorkbook("bad-staff-no-email.xlsx", [
      { name: "Staff", headers: ["Full Name", "Role"], rows: [["No Email Person", "Engineer"]] },
    ]),
    assignmentNameOnly: await writeWorkbook("bad-assignment-name-only.xlsx", [
      {
        name: "Assignments",
        headers: ["Project ID", "Team Member", "Start Date", "End Date", "Total Hours"],
        rows: [[PROJECT_ID, "Casey Import", "2026-01-05", "2026-01-30", 40]],
      },
    ]),
    // Schedule tab whose rows reference the project by TITLE only — the
    // strict-keys PMMTasks branch must block the whole upload and point at
    // the exact rows (fine-grained message coverage lives in
    // check-strict-schedule-gate.ts; this proves the end-to-end wiring:
    // failureReason strict_keys + zero writes through the real gate).
    scheduleTitleOnly: await writeWorkbook("bad-schedule-title-only.xlsx", [
      {
        name: "Schedule",
        headers: ["Project Title", "Phase Name", "Start Date", "End Date"],
        rows: [
          ["Harbor Bridge Retrofit", "Design", "2026-01-05", "2026-02-27"],
          ["Harbor Bridge Retrofit", "Construction", "2026-03-02", "2026-06-26"],
        ],
      },
    ]),
    // Schedule-shaped sheet under a MAPPED name ("Tasks" resolves to
    // ModuleTasks in SHEET_TABLE_MAP): insertScheduleBatch consumes it via
    // isScheduleTab (column content), so the strict gate must too — the
    // routing collision that originally made the schedule branch dead code.
    scheduleMappedName: await writeWorkbook("bad-schedule-mapped-name.xlsx", [
      {
        name: "Tasks",
        headers: ["Project Title", "Phase Name", "Start Date", "End Date"],
        rows: [["Harbor Bridge Retrofit", "Design", "2026-01-05", "2026-02-27"]],
      },
    ]),
    // Schedule tab with an ID column pointing at a nonexistent record.
    scheduleUnknownId: await writeWorkbook("bad-schedule-unknown-id.xlsx", [
      {
        name: "Schedule",
        headers: ["Project ID", "Phase Name", "Start Date", "End Date"],
        rows: [["PMM-26-999999", "Design", "2026-01-05", "2026-02-27"]],
      },
    ]),
  };
}

/** Update-mode file whose Projects row carries a NEW valid-shaped Company ID
 *  plus a company name matching nothing — the pipeline must create the
 *  company automatically (verbatim ID), link the row, and disclose it. */
async function buildAutoCompany(): Promise<string> {
  return writeWorkbook("auto-company.xlsx", [
    {
      name: "Projects",
      headers: ["Title", "Project ID", "Company ID", "Company Name"],
      rows: [["Auto Co Project", "PRJ-26-0003", "COM-26-000777", "Autolink Client Co"]],
    },
  ]);
}

/** Staff sheet carrying Company ID/Name columns — a person's employer is NOT
 *  a client company: the upload must import cleanly, create NO company, and
 *  raise NO company question (auto-create is record-sheet-only). */
async function buildStaffCompanyCols(): Promise<string> {
  return writeWorkbook("staff-company-cols.xlsx", [
    {
      name: "Staff",
      headers: ["Full Name", "Login Email", "Role", "Job Title", "Company ID", "Company Name"],
      rows: [["Casey Import", EMAIL_1, "Engineer", "Engineer", "COM-26-000888", "Phantom Employer Co"]],
    },
  ]);
}

/** Create-mode file with NO record IDs / company IDs anywhere — first-time
 *  onboarding must stay tolerant (no strict_keys gate on a fresh tenant). */
async function buildTolerantCreate(): Promise<string> {
  return writeWorkbook("tolerant-create.xlsx", [
    {
      name: "Projects",
      headers: ["Title", "Company Name", "Start Date", "End Date"],
      rows: [["Tolerant Project", "Tolerant Client Co", "2026-02-02", "2026-08-28"]],
    },
  ]);
}

// ── server lifecycle ─────────────────────────────────────────────────────────
let serverProc: ChildProcess | null = null;

async function startServer(): Promise<void> {
  console.log(`Starting throwaway api-server on port ${PORT}…`);
  serverProc = spawn("npx", ["tsx", "./src/index.ts"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    // WORKERS=1: with multiple cluster workers, a sibling worker's in-memory
    // "pending" copy of a finished upload keeps 409ing (IMPORT_IN_PROGRESS)
    // subsequent uploads for minutes. One worker = one consistent memory.
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", WORKERS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // own process group → we can kill primary + workers together
  });
  const log = fs.createWriteStream("/tmp/import-matching-check-server.log");
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
  throw new Error(`api-server never became healthy on port ${PORT} (see /tmp/import-matching-check-server.log)`);
}

function stopServer(): void {
  if (!serverProc?.pid) return;
  try { process.kill(-serverProc.pid, "SIGTERM"); } catch { /* already gone */ }
  serverProc = null;
}

// ── upload + run + poll ──────────────────────────────────────────────────────
async function j(r: Response): Promise<any> {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 400) }; }
}

interface RunOutcome { status: string; result: any }

async function uploadAndRun(
  file: string,
  tenant: string,
  importMode: "create" | "update",
  extra?: { columnMappings?: unknown; mappingsSource?: string },
): Promise<RunOutcome> {
  // The previous run's job row can briefly stay "running" in the DB after the
  // in-memory status already reported success — retry through that window.
  for (let attempt = 0; ; attempt++) {
    const r = await uploadAndRunOnce(file, tenant, importMode, extra);
    if (r !== "in_progress") return r;
    if (attempt >= 20) throw new Error(`IMPORT_IN_PROGRESS never cleared for ${path.basename(file)}`);
    await new Promise((res) => setTimeout(res, 3000));
  }
}

async function uploadAndRunOnce(
  file: string,
  tenant: string,
  importMode: "create" | "update",
  extra?: { columnMappings?: unknown; mappingsSource?: string },
): Promise<RunOutcome | "in_progress"> {
  const fd = new FormData();
  fd.append("tenantId", tenant);
  fd.append(
    "file",
    new Blob([fs.readFileSync(file)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    path.basename(file),
  );
  const up = await j(await fetch(`${BASE}/api/onboarding/upload`, { method: "POST", headers: AUTH, body: fd }));
  if (up.code === "IMPORT_IN_PROGRESS") return "in_progress";
  if (!up.uploadId) throw new Error(`upload failed for ${file}: ${JSON.stringify(up).slice(0, 500)}`);
  const run = await j(await fetch(`${BASE}/api/onboarding/run`, {
    method: "POST",
    headers: { ...AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId: up.uploadId, tenantId: tenant, importMode, ...(extra ?? {}) }),
  }));
  if (run.code === "IMPORT_IN_PROGRESS") return "in_progress";
  if (run.error) throw new Error(`run failed for ${file}: ${JSON.stringify(run).slice(0, 500)}`);
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await j(await fetch(`${BASE}/api/onboarding/status/${up.uploadId}`, { headers: AUTH }));
    const s: string = st.status ?? st.job?.status;
    if (s && !["pending", "running"].includes(s)) {
      // GET /status returns a FLAT shape (no nested result): failureReason,
      // errors (step+top merged), steps, totalInserted/totalErrors, fatalError.
      return {
        status: s,
        result: {
          failureReason: st.failureReason ?? null,
          fatalError: st.fatalError ?? null,
          totalInserted: st.totalInserted ?? 0,
          totalErrors: st.totalErrors ?? 0,
          errors: st.errors ?? [],
          steps: st.steps ?? [],
          warnings: st.warnings ?? [],
        },
      };
    }
  }
  throw new Error(`timed out waiting for ${path.basename(file)} (${importMode})`);
}

// ── outcome assertions ───────────────────────────────────────────────────────
function expectOk(label: string, o: RunOutcome) {
  const errs = (o.result?.errors ?? []) as Array<{ message?: string }>;
  check(
    `${label}: imports cleanly`,
    (o.status === "success" || o.status === "partial") && (o.result?.totalErrors ?? 0) === 0 && !o.result?.failureReason,
    `status=${o.status} failureReason=${o.result?.failureReason ?? "-"} totalErrors=${o.result?.totalErrors} firstErr=${errs[0]?.message?.slice(0, 200) ?? "-"}`,
  );
}

function expectStrictBlock(label: string, o: RunOutcome, expectColumnWord: string) {
  const errs = (o.result?.errors ?? []) as Array<{ column?: string; message?: string }>;
  check(
    `${label}: blocked with failureReason=strict_keys`,
    o.status === "failed" && o.result?.failureReason === "strict_keys",
    `status=${o.status} failureReason=${o.result?.failureReason ?? "-"} result=${JSON.stringify(o.result ?? {}).slice(0, 800)}`,
  );
  check(
    `${label}: zero writes`,
    (o.result?.totalInserted ?? 0) === 0,
    `totalInserted=${o.result?.totalInserted}`,
  );
  check(
    `${label}: row error names "${expectColumnWord}"`,
    errs.some((e) => `${e.column ?? ""} ${e.message ?? ""}`.toLowerCase().includes(expectColumnWord.toLowerCase())),
    `errors=${JSON.stringify(errs.slice(0, 2)).slice(0, 300)}`,
  );
}

// ── disposable-tenant cleanup ────────────────────────────────────────────────
async function wipeTenants(labels: string[]): Promise<void> {
  console.log("Cleaning up disposable tenants…");
  const tids = labels.map((l) => uuidv5(l.toLowerCase(), TENANT_NS));
  const tidsAlt = labels.map((l) => uuidv5(l, TENANT_NS)); // in case the pipeline hashes the raw label
  const allTids = [...new Set([...tids, ...tidsAlt])];
  try {
    // core2 data rows (GUID-keyed) — same pass-loop approach as delete-tenant.ts
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
    // app-DB rows (label-keyed: rmone_users, rmone_onboarding_jobs, aliases, …)
    const app = await getMssqlPool();
    const tables = await app.request().query(`
      SELECT c.TABLE_NAME t, c.COLUMN_NAME col FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_SCHEMA='dbo' AND c.TABLE_NAME LIKE 'rmone[_]%'
        AND LOWER(c.COLUMN_NAME) IN ('tenant_id','tenantid')`);
    const keys = [...new Set([...labels, ...labels.map((l) => l.toLowerCase()), ...allTids])];
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
  const [rawValid, rawEmailOnly, gridValid, bad, tolerant, autoCompany, staffCompanyCols] = await Promise.all([
    buildRawValid(), buildRawEmailOnlyAssignment(), buildGridValid(), buildBadFixtures(), buildTolerantCreate(), buildAutoCompany(), buildStaffCompanyCols(),
  ]);
  console.log(`Fixtures written to ${FIX_DIR}`);

  await startServer();
  try {
    console.log(`\n== 1) create-mode seed (raw format) → "${TENANT_MAIN}"`);
    expectOk("create raw-valid", await uploadAndRun(rawValid, TENANT_MAIN, "create"));

    console.log("\n== 2) update-mode re-import of the same raw file (matches by ID)");
    expectOk("update raw-valid", await uploadAndRun(rawValid, TENANT_MAIN, "update"));

    console.log("\n== 2b) update-mode email-only assignment (raw headers) — must not block");
    expectOk("update raw email-only assignment", await uploadAndRun(rawEmailOnly, TENANT_MAIN, "update"));

    console.log("\n== 3) update-mode grid-format upload (wizard mappings; email-only assignment row)");
    expectOk(
      "update grid-valid",
      await uploadAndRun(gridValid, TENANT_MAIN, "update", { columnMappings: GRID_MAPPINGS, mappingsSource: "grid" }),
    );

    console.log("\n== 4) update-mode strict-keys blocks (each must fail with zero writes)");
    expectStrictBlock("missing record ID", await uploadAndRun(bad.missingRecordId, TENANT_MAIN, "update"), "Project ID");
    expectStrictBlock("unknown Company ID", await uploadAndRun(bad.unknownCompanyId, TENANT_MAIN, "update"), "Company ID");
    expectStrictBlock("staff without email", await uploadAndRun(bad.staffNoEmail, TENANT_MAIN, "update"), "Login Email");
    expectStrictBlock("assignment name-only", await uploadAndRun(bad.assignmentNameOnly, TENANT_MAIN, "update"), "Email");
    const schedTitle = await uploadAndRun(bad.scheduleTitleOnly, TENANT_MAIN, "update");
    expectStrictBlock("schedule title-only rows", schedTitle, "titles are never matched");
    const schedErrs = (schedTitle.result?.errors ?? []) as Array<{ rowIndex?: number; message?: string }>;
    check(
      "schedule title-only: both content rows flagged individually (Excel rows 2 and 3)",
      [2, 3].every((n) => schedErrs.some((e) => e.rowIndex === n && (e.message ?? "").includes("Harbor Bridge Retrofit"))),
      `errors=${JSON.stringify(schedErrs.slice(0, 4)).slice(0, 400)}`,
    );
    expectStrictBlock("schedule unknown Project ID", await uploadAndRun(bad.scheduleUnknownId, TENANT_MAIN, "update"), `Project ID "PMM-26-999999"`);
    expectStrictBlock("schedule sheet under mapped name 'Tasks'", await uploadAndRun(bad.scheduleMappedName, TENANT_MAIN, "update"), "titles are never matched");

    // Compatibility: a VALID schedule using the canonical grid ID header
    // alias "Project / Opp ID" must pass the gate (not be rejected as
    // "no Project ID").
    const schedAliasOk = await writeWorkbook("good-schedule-alias-id.xlsx", [
      {
        name: "Schedule",
        headers: ["Project / Opp ID", "Phase Name", "Start Date", "End Date"],
        rows: [[PROJECT_ID, "Design", "2026-01-05", "2026-02-27"]],
      },
    ]);
    expectOk(`schedule with "Project / Opp ID" header: imports cleanly`, await uploadAndRun(schedAliasOk, TENANT_MAIN, "update"));

    console.log("\n== 4b) update-mode NEW Company ID + name — company auto-creates, rows link");
    // Task 418: pre-seed a STALE open company question about the same company
    // (as if raised by an earlier upload) — the run's auto-create must close it
    // without anyone touching the card (end-of-run auto-resolve trigger).
    const mainTid = uuidv5(TENANT_MAIN.toLowerCase(), TENANT_NS); // resolveTenantId lowercases the label
    await addImportReviewItems([{
      tenantId: mainTid, uploadId: null, kind: "company-ref",
      rowKey: "com-26-000777", displayLabel: "Autolink Client Co (COM-26-000777)",
      reason: "seeded by check", suggestions: [], row: {}, rowCount: 1, sheetName: null,
    }] as any);
    const auto = await uploadAndRun(autoCompany, TENANT_MAIN, "update");
    expectOk("new company auto-create", auto);
    const autoBlob = JSON.stringify(auto.result ?? {});
    check(
      "auto-create disclosed in run summary",
      autoBlob.includes("created automatically") && autoBlob.includes("COM-26-000777"),
      autoBlob.slice(0, 300),
    );
    {
      const stillOpen = (await listImportReview(mainTid, { status: "open" })) as any[];
      check(
        "stale company question auto-resolved by the run",
        !stillOpen.some((i) => i.kind === "company-ref" && i.rowKey === "com-26-000777"),
        `open company-ref keys: ${stillOpen.filter((i) => i.kind === "company-ref").map((i) => i.rowKey).join(", ") || "-"}`,
      );
    }

    console.log("\n== 4c) staff sheet with Company ID/Name columns — must NOT create a company");
    const staffCo = await uploadAndRun(staffCompanyCols, TENANT_MAIN, "update");
    expectOk("staff company columns: imports cleanly", staffCo);
    const staffBlob = JSON.stringify(staffCo.result ?? {});
    check(
      "no company created or asked about from a staff sheet",
      !staffBlob.includes("created automatically") && !staffBlob.includes("COM-26-000888"),
      staffBlob.slice(0, 300),
    );

    console.log(`\n== 5) create mode stays tolerant (no IDs anywhere) → "${TENANT_TOLERANT}"`);
    const tol = await uploadAndRun(tolerant, TENANT_TOLERANT, "create");
    check(
      "tolerant create: not strict_keys-blocked",
      tol.result?.failureReason !== "strict_keys" && tol.status !== "failed",
      `status=${tol.status} failureReason=${tol.result?.failureReason ?? "-"}`,
    );
    console.log("\n== 6) company-ref auto-resolve unit pass (lazy trigger; task 418)");
    // Direct regression on autoResolveAnsweredReviewItems (the function the
    // review-list, review-answer, and Companies-page triggers all call):
    // resolves by TicketId, by unambiguous name, AND by name when the file's
    // Company ID was invalid-shaped (name lives in displayLabel); ambiguous
    // names and unknown ID-only refs stay open.
    {
      const utid = uuidv5(`${TENANT_MAIN} autoresolve-unit`, TENANT_NS);
      const pool6 = await getPool();
      const mk6 = (rowKey: string, displayLabel: string) => ({
        tenantId: utid, uploadId: null, kind: "company-ref", rowKey, displayLabel,
        reason: "seeded by check", suggestions: [], row: {}, rowCount: 1, sheetName: null,
      });
      await addImportReviewItems([
        mk6("com-26-000123", "Acme Builders (COM-26-000123)"),       // resolves by TicketId
        mk6("zeta construction", "Zeta Construction"),               // name-only, unique name
        mk6("dupe co", "Dupe Co"),                                   // ambiguous name → stays open
        mk6("pmm-26-0001", "Northwind Group (PMM-26-0001)"),         // INVALID ID + name → resolves by name
        mk6("acme (west)", "Acme (West)"),                           // name-only WITH legit parens → resolves as-is
        mk6("com-26-000999", "COM-26-000999"),                       // ID-only ghost → stays open
      ] as any);
      check("unit: nothing closes before companies exist", (await autoResolveAnsweredReviewItems(utid)) === 0);
      const ins6 = (title: string, tick: string) =>
        pool6.request().input("tid", sql.NVarChar, utid).input("t", sql.NVarChar, title).input("k", sql.NVarChar, tick)
          .query(`INSERT INTO ${CORE_DB}.dbo.CRMCompany (TenantID, Title, TicketId, Deleted) VALUES (@tid, @t, @k, 0)`);
      await ins6("Acme Builders", "COM-26-000123");
      await ins6("Zeta Construction", "COM-26-000001");
      await ins6("Dupe Co", "COM-26-000002");
      await ins6("Dupe Co", "COM-26-000003");
      await ins6("Northwind Group", "COM-26-000004");
      await ins6("Acme (West)", "COM-26-000005");
      const closed6 = await autoResolveAnsweredReviewItems(utid);
      check("unit: id + unique-name + invalid-id-by-name + parenthesized-name close", closed6 === 4, `closed=${closed6}`);
      const open6 = ((await listImportReview(utid, { status: "open" })) as any[]).map((i) => i.rowKey).sort();
      check(
        "unit: ambiguous name + unknown ID-only stay open",
        JSON.stringify(open6) === JSON.stringify(["com-26-000999", "dupe co"]),
        open6.join(", "),
      );
      // cleanup: companies + review rows for the unit tenant
      await pool6.request().input("tid", sql.NVarChar, utid)
        .query(`DELETE FROM ${CORE_DB}.dbo.CRMCompany WHERE TenantID=@tid`);
      for (const it of (await listImportReview(utid, {})) as any[])
        await resolveImportReviewItem(it.id, { status: "dismissed", resolution: { action: "check-cleanup" }, resolvedBy: "import-matching-check" });
    }
  } finally {
    stopServer();
    await wipeTenants([TENANT_MAIN, TENANT_TOLERANT]);
  }

  if (failures.length) {
    console.error(`\n✗ import-matching check FAILED (${failures.length}): ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("\n✓ import-matching check passed");
  process.exit(0);
}

main().catch((e) => {
  console.error("CHECK_FAIL", e);
  stopServer();
  process.exit(1);
});
