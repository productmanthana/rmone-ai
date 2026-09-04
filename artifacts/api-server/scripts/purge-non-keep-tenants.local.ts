/**
 * Task 478 — one-off superadmin bulk purge: delete ALL tenant data from core2
 * + the app DB (rmoneapp) for every tenant EXCEPT the 9 keep tenants (plus the
 * protected golden-template tenant).
 *
 * Contract (deny-list, never NOT-IN):
 *   • Discover DISTINCT TenantIDs across ALL core2 tables with a TenantID
 *     column (batched UNION), subtract keep GUIDs + template GUID + non-GUID
 *     values → explicit DELETE list. Every DELETE targets that explicit list.
 *   • Dry-run by default. `--execute PURGE-NON-KEEP-TENANTS` runs for real.
 *   • Abort gates: all 9 keep labels must resolve to GUIDs found in the DB;
 *     zero keep∩delete overlap; refuse while an onboarding import is active.
 *   • Snapshot first (NDJSON.gz → S3), per-table >50k-row skip markers
 *     (mssql materialises recordsets — the 5-7M-row stress RA slices OOM).
 *   • Group-wise chunked deletes: DELETE TOP(500000) … WHERE TenantID IN
 *     (delete set) until rowsAffected=0, multi-pass FK convergence.
 *     VarChar semantics via inline validated literals (never NVarChar params).
 *   • Beyond TenantID: RMOneInviteTokens (TenantKey/TenantLabel), app-DB
 *     tenant-ish columns matched against GUIDs + labels + norm forms.
 *   • Honest completion: final batched recount of every table that had
 *     delete-side rows; recount failure = NOT clean.
 *
 * Resumable: deletes are idempotent; snapshot completion is recorded in a
 * marker file so re-runs (after a shell timeout) skip straight to deleting.
 *
 * Usage (from artifacts/api-server):
 *   tsx scripts/purge-non-keep-tenants.local.ts                # dry-run report
 *   tsx scripts/purge-non-keep-tenants.local.ts --execute PURGE-NON-KEEP-TENANTS
 *   tsx scripts/purge-non-keep-tenants.local.ts --verify       # recount only
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createGzip } from "node:zlib";
import { finished } from "node:stream/promises";
import { v5 as uuidv5 } from "uuid";
import { getPool } from "../src/lib/db.js";

// ── Constants ───────────────────────────────────────────────────────────────
const TENANT_NAMESPACE = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a"; // = pipeline.ts
const TEMPLATE_TENANT_ID = "fcec991c-0b1c-4e41-8200-92c20ea3f536"; // golden clone source — NEVER deletable
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONFIRM_STRING = "PURGE-NON-KEEP-TENANTS";
const SNAPSHOT_MAX_TABLE_ROWS = 50_000;
const SNAPSHOT_MAX_BYTES = 250_000_000;
const DELETE_BATCH = 500_000;
const APP_DELETE_BATCH = 20_000;
// Graceful-exit budget: the shell tool caps a call at 300 s; stop issuing new
// statements after this much elapsed time and tell the operator to re-run.
const TIME_BUDGET_MS = Number(process.env.PURGE_BUDGET_MS) || 240_000;
const MARKER = "/tmp/purge478-state.json";

// Keep tenants: label → expected GUID (from the task plan, verified on plan day).
// The script re-derives each GUID via uuidv5 and ASSERTS it matches — a drift
// between plan and code aborts before anything runs.
const KEEP: ReadonlyArray<{ label: string; guid: string }> = [
  { label: "Alston AI",  guid: "22897300-acd1-5876-bfba-ae8b794cedd0" },
  { label: "testa",      guid: "15bfa454-55a1-5c8a-b0b5-a4faab0e6ccb" },
  { label: "testb",      guid: "f156f7ff-338d-51c1-8014-aca99e264b61" },
  { label: "test21",     guid: "95f49c6a-b98b-5ffb-99d1-f777bb86b66b" },
  { label: "Liro",       guid: "820cf51f-2e42-5998-ade4-f8d05ce88a91" },
  { label: "test20",     guid: "5c03084c-7413-5a56-9fa2-bc401f8a5650" },
  { label: "demormone",  guid: "b7a5d30d-46e9-55c5-8fec-23c844512e0b" },
  { label: "Liro_Poc",   guid: "7e15f346-fee0-5e43-84e3-3e10ddc57647" },
  { label: "testrmone",  guid: "07160b5c-7a8f-5e55-84ce-7499c981cb87" },
];

// Fingerprint of the keep configuration. Stored in the resume marker so a
// marker written under a different keep list/template can never be resumed.
const KEEP_FINGERPRINT = createHash("sha256")
  .update(JSON.stringify({ v: 1, keep: KEEP.map(k => k.guid.toLowerCase()).sort(), template: TEMPLATE_TENANT_ID.toLowerCase() }))
  .digest("hex");

// Children-first ordering hint (mirrors /tenant/delete) so FK convergence is fast.
const CHILD_FIRST = [
  "tickethours", "resourcetimesheet", "resourceallocation", "resourceworkitems",
  "moduletasks", "pmmtasks", "pmm", "opportunity", "lead", "crmcontact", "crmcompany",
];

const t0 = Date.now();
const log = (m: string) => console.log(`[purge478 +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const outOfBudget = () => Date.now() - t0 > TIME_BUDGET_MS;

function resolveTenantId(raw: string): string {
  const v = (raw ?? "").trim();
  return /^[0-9a-fA-F-]{36}$/.test(v) ? v : uuidv5(v.toLowerCase(), TENANT_NAMESPACE);
}
function normTenant(t: string): string { // same as onboarding.ts
  return t.trim().replace(/\s+/g, "_").toLowerCase();
}
const bq = (s: string) => `[${String(s).replace(/\]/g, "]]")}]`;
const lit = (s: string) => `'${String(s).replace(/'/g, "''")}'`;

type State = {
  snapshotKey?: string;
  snapshotDone?: boolean;
  keepBaseline?: Record<string, Record<string, number>>;
  // Pinned at snapshot time: the EXACT target set the snapshot covers. A
  // resumed run may only delete this set — never a re-discovered superset.
  keepFingerprint?: string;
  deleteGuids?: string[];
  appCandidates?: string[];
};
const loadState = (): State => { try { return JSON.parse(fs.readFileSync(MARKER, "utf8")); } catch { return {}; } };
const saveState = (s: State) => fs.writeFileSync(MARKER, JSON.stringify(s, null, 2));

async function main() {
  const args = process.argv.slice(2);
  const execute = args[0] === "--execute";
  const verifyOnly = args[0] === "--verify";
  if (execute && args[1] !== CONFIRM_STRING) {
    console.error(`REFUSED: --execute requires the confirmation string ${CONFIRM_STRING}`);
    process.exit(2);
  }

  // Gate 0: keep-label → GUID derivation must match the plan's verified GUIDs.
  const keepGuids = new Set<string>();
  for (const k of KEEP) {
    const derived = resolveTenantId(k.label).toLowerCase();
    if (derived !== k.guid.toLowerCase()) {
      console.error(`ABORT: keep label "${k.label}" derives ${derived}, plan says ${k.guid}`);
      process.exit(2);
    }
    keepGuids.add(k.guid.toLowerCase());
  }
  keepGuids.add(TEMPLATE_TENANT_ID.toLowerCase()); // hard-exclude template

  const pool = await getPool();
  log("pool ready");

  // ── Discover all core2 tables with a TenantID column ──────────────────────
  const colsR = await pool.request().query(`
    SELECT c.TABLE_SCHEMA s, c.TABLE_NAME t FROM core2.INFORMATION_SCHEMA.COLUMNS c
    JOIN core2.INFORMATION_SCHEMA.TABLES tb
      ON tb.TABLE_SCHEMA=c.TABLE_SCHEMA AND tb.TABLE_NAME=c.TABLE_NAME AND tb.TABLE_TYPE='BASE TABLE'
    WHERE LOWER(c.COLUMN_NAME)='tenantid'`);
  const schemaByTable = new Map<string, string>();
  const nameByLower = new Map<string, string>();
  for (const r of (colsR.recordset ?? []) as any[]) {
    schemaByTable.set(String(r.t).toLowerCase(), String(r.s));
    nameByLower.set(String(r.t).toLowerCase(), String(r.t));
  }
  const core2Tables = [...nameByLower.keys()].sort((a, b) => {
    const ia = CHILD_FIRST.indexOf(a), ib = CHILD_FIRST.indexOf(b);
    return (ia === -1 ? CHILD_FIRST.length : ia) - (ib === -1 ? CHILD_FIRST.length : ib) || a.localeCompare(b);
  });
  const fqOf = (lt: string) => `[core2].${bq(schemaByTable.get(lt)!)}.${bq(nameByLower.get(lt)!)}`;
  log(`core2 discovery: ${core2Tables.length} tables with TenantID`);

  // ── Discover DISTINCT TenantIDs across ALL those tables (batched UNION) ───
  const allTenants = new Set<string>();
  const nonGuidValues = new Set<string>();
  for (let i = 0; i < core2Tables.length; i += 40) {
    const chunk = core2Tables.slice(i, i + 40);
    const q = chunk.map(lt =>
      `SELECT DISTINCT TenantID v FROM ${fqOf(lt)} WHERE TenantID IS NOT NULL AND TenantID <> ''`
    ).join("\nUNION\n");
    const r = await pool.request().query(q);
    for (const row of (r.recordset ?? []) as any[]) {
      const v = String(row.v).trim();
      if (!v) continue;
      if (GUID_RE.test(v)) allTenants.add(v.toLowerCase());
      else nonGuidValues.add(v);
    }
  }
  log(`tenant discovery: ${allTenants.size} distinct GUID tenants, ${nonGuidValues.size} non-GUID values (excluded)`);

  // ── Build the explicit delete list (deny-list semantics) ──────────────────
  let deleteGuids = [...allTenants].filter(g => !keepGuids.has(g)).sort();
  const keepPresent = KEEP.filter(k => allTenants.has(k.guid.toLowerCase()));

  // Gate 1: every keep tenant must be found in the DB.
  if (keepPresent.length !== KEEP.length) {
    const missing = KEEP.filter(k => !allTenants.has(k.guid.toLowerCase())).map(k => k.label);
    console.error(`ABORT: keep tenant(s) not found in DB: ${missing.join(", ")}`);
    process.exit(2);
  }
  // Gate 2: zero overlap (structural given the filter, but assert anyway).
  for (const g of deleteGuids) {
    if (keepGuids.has(g)) { console.error(`ABORT: overlap keep∩delete: ${g}`); process.exit(2); }
    if (!GUID_RE.test(g)) { console.error(`ABORT: non-GUID in delete list: ${g}`); process.exit(2); }
  }
  let delInList = deleteGuids.map(lit).join(",");
  if (!deleteGuids.length) { log("Nothing to delete — delete list is empty."); process.exit(0); }

  // ── App DB: locate the catalog that owns rmone_users ──────────────────────
  let appDb = "rmoneapp";
  try {
    const dbs = await pool.request().query(`SELECT name FROM sys.databases WHERE database_id > 4`);
    for (const d of (dbs.recordset ?? []) as any[]) {
      const nm = String(d.name);
      if (nm.toLowerCase() === "core2") continue;
      try {
        const probe = await pool.request().query(
          `SELECT COUNT(*) n FROM ${bq(nm)}.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='rmone_users'`);
        if ((probe.recordset[0]?.n ?? 0) > 0) { appDb = nm; break; }
      } catch { /* no access — skip */ }
    }
  } catch { /* fall back to conventional name */ }
  const appFq = (t: string) => `${bq(appDb)}.[dbo].${bq(t)}`;
  log(`app catalog: ${appDb}`);

  // ── Labels for delete tenants (report + app-DB/invite candidate strings) ──
  // rmone_onboarding_jobs.tenant_id stores the LABEL (raw or normalized).
  const labelByGuid = new Map<string, string>();
  const deleteLabelSet = new Set<string>(); // lowercased label spellings that map to delete tenants
  const keepStrings = new Set<string>([...keepGuids]);
  for (const k of KEEP) {
    keepStrings.add(k.label.toLowerCase());
    keepStrings.add(normTenant(k.label));
    keepStrings.add(k.label.replace(/_/g, " ").toLowerCase()); // spaced spelling of an underscored label
  }
  keepStrings.add("rmone");
  // A candidate string is keep-tainted if ANY spelling/derivation maps to a keep tenant.
  const keepTainted = (s: string) =>
    keepStrings.has(s) ||
    keepStrings.has(normTenant(s)) ||
    keepGuids.has(resolveTenantId(s).toLowerCase()) ||
    keepGuids.has(resolveTenantId(s.replace(/_/g, " ")).toLowerCase());
  try {
    const r = await pool.request().query(
      `SELECT DISTINCT tenant_id v FROM ${appFq("rmone_onboarding_jobs")} WHERE tenant_id IS NOT NULL AND tenant_id <> ''`);
    for (const row of (r.recordset ?? []) as any[]) {
      const raw = String(row.v).trim();
      if (!raw) continue;
      const variants = [raw, raw.replace(/_/g, " ")];
      for (const v of variants) {
        const g = resolveTenantId(v).toLowerCase();
        if (keepGuids.has(g)) break; // keep tenant's label — never a candidate
        if (allTenants.has(g) && !keepGuids.has(g)) {
          if (!labelByGuid.has(g)) labelByGuid.set(g, raw);
          deleteLabelSet.add(raw.toLowerCase());
          deleteLabelSet.add(normTenant(raw));
          break;
        }
      }
      // Jobs rows whose label doesn't resolve to ANY discovered tenant belong
      // to tenants with zero core2 rows (pure history cards). Those are still
      // delete-side unless they resolve to a keep tenant.
      const g0 = resolveTenantId(raw).toLowerCase();
      if (!allTenants.has(g0) && !keepTainted(raw)) {
        // Pure history-card tenant: zero core2 rows, only app-DB rows.
        deleteLabelSet.add(raw.toLowerCase());
        deleteLabelSet.add(normTenant(raw));
      }
    }
  } catch (e: any) { log(`WARN: could not read onboarding jobs labels: ${e?.message}`); }
  // Safety: no keep-tainted string may ever appear in the candidate set.
  let appCandidates = [...new Set([...deleteGuids, ...deleteLabelSet])].filter(s => !keepTainted(s));
  let appCandList = appCandidates.map(lit).join(",");
  log(`app candidates: ${appCandidates.length} strings (${deleteGuids.length} GUIDs + ${deleteLabelSet.size} label forms)`);

  // ── Per-table delete-side counts (core2), batched UNION ALL ───────────────
  const tableCounts: Record<string, number> = {};
  for (let i = 0; i < core2Tables.length; i += 50) {
    const chunk = core2Tables.slice(i, i + 50);
    const q = chunk.map((lt, j) =>
      `SELECT ${i + j} i, COUNT(*) n FROM ${fqOf(lt)} WHERE TenantID IN (${delInList})`
    ).join("\nUNION ALL\n");
    const r = await pool.request().query(q);
    for (const row of (r.recordset ?? []) as any[]) {
      const n = Number(row.n) || 0;
      if (n > 0) tableCounts[core2Tables[row.i]] = n;
    }
  }
  const core2WithRows = core2Tables.filter(lt => tableCounts[lt]);
  const core2Total = Object.values(tableCounts).reduce((a, b) => a + b, 0);
  log(`core2 delete-side: ${core2Total} rows across ${core2WithRows.length} tables`);

  // ── App DB tenant-ish columns + delete-side counts ─────────────────────────
  const appColsR = await pool.request().query(`
    SELECT c.TABLE_NAME t, c.COLUMN_NAME c FROM ${bq(appDb)}.INFORMATION_SCHEMA.COLUMNS c
    JOIN ${bq(appDb)}.INFORMATION_SCHEMA.TABLES tb
      ON tb.TABLE_SCHEMA=c.TABLE_SCHEMA AND tb.TABLE_NAME=c.TABLE_NAME AND tb.TABLE_TYPE='BASE TABLE'
    WHERE c.TABLE_SCHEMA='dbo'
      AND LOWER(c.COLUMN_NAME) IN ('tenant_id','tenantid','tenant_key','tenant_guid','tenant')`);
  const appTenantCols = new Map<string, string[]>();
  for (const r of (appColsR.recordset ?? []) as any[]) {
    const t = String(r.t);
    const list = appTenantCols.get(t) ?? [];
    list.push(String(r.c));
    appTenantCols.set(t, list);
  }
  const appWhere = (cols: string[]) =>
    cols.map(c => `LOWER(LTRIM(RTRIM(CAST(${bq(c)} AS nvarchar(200))))) IN (${appCandList})`).join(" OR ");
  const appCounts: Record<string, number> = {};
  {
    const appList = [...appTenantCols.entries()];
    for (let i = 0; i < appList.length; i += 30) {
      const chunk = appList.slice(i, i + 30);
      const q = chunk.map(([t, cols], j) => `SELECT ${i + j} i, COUNT(*) n FROM ${appFq(t)} WHERE ${appWhere(cols)}`).join("\nUNION ALL\n");
      const r = await pool.request().query(q);
      for (const row of (r.recordset ?? []) as any[]) {
        if (row.n > 0) appCounts[appList[row.i][0]] = Number(row.n);
      }
    }
  }
  const appTotal = Object.values(appCounts).reduce((a, b) => a + b, 0);

  // Invite tokens (TenantKey/TenantLabel — no TenantID column).
  let inviteRows = 0;
  try {
    const r = await pool.request().query(`
      SELECT COUNT(*) n FROM core2.dbo.RMOneInviteTokens
      WHERE LOWER(LTRIM(RTRIM(TenantKey))) IN (${appCandList}) OR LOWER(LTRIM(RTRIM(TenantLabel))) IN (${appCandList})`);
    inviteRows = Number(r.recordset[0]?.n ?? 0);
  } catch { /* table may not exist */ }
  log(`app delete-side: ${appTotal} rows across ${Object.keys(appCounts).length} tables; invites: ${inviteRows}`);

  // ── Per-tenant totals (report) via GROUP BY over tables with rows ─────────
  const perTenant = new Map<string, number>();
  {
    const withRows = core2WithRows;
    for (let i = 0; i < withRows.length; i += 15) {
      const chunk = withRows.slice(i, i + 15);
      const q = chunk.map(lt =>
        `SELECT LOWER(TenantID) g, COUNT(*) n FROM ${fqOf(lt)} WHERE TenantID IN (${delInList}) GROUP BY TenantID`
      ).join("\nUNION ALL\n");
      const r = await pool.request().query(q);
      for (const row of (r.recordset ?? []) as any[]) {
        const g = String(row.g);
        perTenant.set(g, (perTenant.get(g) ?? 0) + (Number(row.n) || 0));
      }
    }
  }

  // ── Keep-tenant baseline (spot-check tables) ───────────────────────────────
  const KEEP_CHECK_TABLES = ["pmm", "opportunity", "resourceallocation", "resourceworkitems", "aspnetusers", "tickethours", "moduletasks", "crmcompany", "crmcontact", "lead"]
    .filter(lt => nameByLower.has(lt));
  const keepCounts = async (): Promise<Record<string, Record<string, number>>> => {
    const out: Record<string, Record<string, number>> = {};
    for (const k of KEEP) {
      const q = KEEP_CHECK_TABLES.map((lt, j) =>
        `SELECT ${j} i, COUNT(*) n FROM ${fqOf(lt)} WHERE TenantID = ${lit(k.guid)}`).join("\nUNION ALL\n");
      const r = await pool.request().query(q);
      const m: Record<string, number> = {};
      for (const row of (r.recordset ?? []) as any[]) m[KEEP_CHECK_TABLES[row.i]] = Number(row.n) || 0;
      out[k.label] = m;
    }
    return out;
  };

  // ── REPORT ─────────────────────────────────────────────────────────────────
  console.log("\n================ PURGE REPORT ================");
  console.log(`KEEP (${KEEP.length} + template):`);
  for (const k of KEEP) console.log(`  KEEP  ${k.guid}  ${k.label}`);
  console.log(`  KEEP  ${TEMPLATE_TENANT_ID}  (golden template — protected)`);
  console.log(`\nDELETE (${deleteGuids.length} tenants, ${core2Total} core2 rows + ${appTotal} app rows + ${inviteRows} invites):`);
  const sorted = deleteGuids.slice().sort((a, b) => (perTenant.get(b) ?? 0) - (perTenant.get(a) ?? 0));
  for (const g of sorted) {
    console.log(`  DEL   ${g}  rows=${(perTenant.get(g) ?? 0).toString().padStart(9)}  ${labelByGuid.get(g) ?? "(unlabeled)"}`);
  }
  if (nonGuidValues.size) console.log(`\nNon-GUID TenantID values EXCLUDED (never deleted): ${[...nonGuidValues].slice(0, 20).join(", ")}${nonGuidValues.size > 20 ? " …" : ""}`);
  console.log(`\nTop core2 tables by delete-side rows:`);
  for (const [lt, n] of Object.entries(tableCounts).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${nameByLower.get(lt)}: ${n}`);
  }
  console.log(`App tables with delete-side rows: ${Object.entries(appCounts).map(([t, n]) => `${t}=${n}`).join(", ") || "(none)"}`);
  console.log("==============================================\n");

  // ── Verify-only mode ───────────────────────────────────────────────────────
  if (verifyOnly) {
    if (core2Total === 0 && appTotal === 0 && inviteRows === 0) {
      log("VERIFY: CLEAN — zero delete-side rows remain anywhere.");
    } else {
      log(`VERIFY: NOT CLEAN — survivors: core2=${core2Total} app=${appTotal} invites=${inviteRows}`);
      process.exit(1);
    }
    process.exit(0);
  }
  if (!execute) {
    log(`DRY RUN complete. Nothing was written. To execute: --execute ${CONFIRM_STRING}`);
    process.exit(0);
  }

  // ── Gate 3: refuse while an onboarding import is active ───────────────────
  {
    const r = await pool.request().query(`
      SELECT COUNT(*) n FROM ${appFq("rmone_onboarding_jobs")} WITH (NOLOCK)
      WHERE (status='running' AND updated_at > DATEADD(minute,-5,GETUTCDATE()))
         OR (status='pending' AND updated_at > DATEADD(minute,-15,GETUTCDATE()))`);
    const n = Number(r.recordset[0]?.n ?? 0);
    if (n > 0) { console.error(`ABORT: ${n} active/pending onboarding import(s) — try again later.`); process.exit(2); }
  }
  log("gate: no active imports");

  const state = loadState();

  // ── Resume integrity: a snapshot-complete marker pins the EXACT target set ──
  // The snapshot only covers the tenants discovered when it was taken. A
  // resumed run may therefore only delete that recorded set — tenants that
  // appeared afterwards are NOT covered by the snapshot and are EXCLUDED
  // (finish this run, then delete the marker and start a fresh run — with a
  // fresh snapshot — to purge them). A marker without the pinned set or with
  // a different keep-config fingerprint cannot be trusted: refuse, don't guess.
  if (state.snapshotDone) {
    if (state.keepFingerprint !== KEEP_FINGERPRINT
        || !Array.isArray(state.deleteGuids) || !Array.isArray(state.appCandidates)) {
      console.error(`ABORT: resume marker ${MARKER} lacks a pinned target set or was written for a different keep config.`);
      console.error(`No rows were deleted. Delete the marker file to start a FRESH run (new snapshot + baseline).`);
      process.exit(2);
    }
    const pinned = new Set(state.deleteGuids.map(g => String(g).toLowerCase())
      .filter(g => GUID_RE.test(g) && !keepGuids.has(g)));
    const notCovered = deleteGuids.filter(g => !pinned.has(g));
    if (notCovered.length) {
      console.error(`WARNING: ${notCovered.length} tenant(s) appeared AFTER the snapshot was taken — NOT covered by it, EXCLUDED from this resumed run:`);
      for (const g of notCovered) console.error(`  NOT-COVERED  ${g}  ${labelByGuid.get(g) ?? "(unlabeled)"}`);
      console.error(`To purge them too: finish this run, then delete ${MARKER} and re-run (fresh snapshot).`);
    }
    deleteGuids = deleteGuids.filter(g => pinned.has(g));
    delInList = deleteGuids.length ? deleteGuids.map(lit).join(",") : "NULL"; // IN (NULL) matches nothing
    appCandidates = state.appCandidates.map(s => String(s).toLowerCase()).filter(s => s && !keepTainted(s));
    appCandList = appCandidates.length ? appCandidates.map(lit).join(",") : "NULL";
    log(`resume: pinned target set from marker = ${deleteGuids.length} tenants, ${appCandidates.length} app candidates`);
  } else if (state.keepFingerprint && state.keepFingerprint !== KEEP_FINGERPRINT) {
    console.error(`ABORT: marker ${MARKER} was written for a different keep config — delete it to start fresh.`);
    process.exit(2);
  }

  if (!state.keepBaseline) {
    state.keepBaseline = await keepCounts();
    state.keepFingerprint = KEEP_FINGERPRINT;
    saveState(state);
    log("keep-tenant baseline captured");
  }

  // ── Snapshot first (once — marker-file resumable) ──────────────────────────
  if (!state.snapshotDone) {
    const { uploadFile } = await import("../src/lib/storage.js");
    const snapshotKey = `tenant-purge/task478/${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson.gz`;
    const gz = createGzip({ level: 6 });
    const chunks: Buffer[] = [];
    gz.on("data", (c: Buffer) => chunks.push(c));
    const write = (s: string) => new Promise<void>((ok, bad) => { gz.write(s, e => (e ? bad(e) : ok())); });
    let bytes = 0, truncated = false;
    await write(JSON.stringify({
      v: 1, kind: "tenant-purge-snapshot", task: 478, takenAt: new Date().toISOString(),
      keep: KEEP, template: TEMPLATE_TENANT_ID, deleteGuids, labels: Object.fromEntries(labelByGuid),
      core2Counts: Object.fromEntries(Object.entries(tableCounts).map(([lt, n]) => [nameByLower.get(lt), n])),
      appCounts, inviteRows,
    }) + "\n");
    const streamRows = async (db: string, label: string, rows: any[]) => {
      for (let i = 0; i < rows.length && !truncated; i += 500) {
        const payload = rows.slice(i, i + 500).map(rw => JSON.stringify({ db, t: label, r: rw }) + "\n").join("");
        bytes += payload.length;
        if (bytes > SNAPSHOT_MAX_BYTES) { truncated = true; break; }
        await write(payload);
      }
    };
    for (const lt of core2WithRows) {
      const label = nameByLower.get(lt)!;
      const n = tableCounts[lt];
      if (truncated) break;
      if (n > SNAPSHOT_MAX_TABLE_ROWS) {
        await write(JSON.stringify({ kind: "table_skipped", db: "core2", t: label, rows: n, reason: "too_large" }) + "\n");
        continue;
      }
      const rowsR = await pool.request().query(`SELECT * FROM ${fqOf(lt)} WHERE TenantID IN (${delInList})`);
      await streamRows("core2", label, rowsR.recordset ?? []);
    }
    if (inviteRows > 0 && !truncated) {
      try {
        const rowsR = await pool.request().query(`
          SELECT * FROM core2.dbo.RMOneInviteTokens
          WHERE LOWER(LTRIM(RTRIM(TenantKey))) IN (${appCandList}) OR LOWER(LTRIM(RTRIM(TenantLabel))) IN (${appCandList})`);
        await streamRows("core2", "RMOneInviteTokens", rowsR.recordset ?? []);
      } catch { /* absent */ }
    }
    // App tables: exclude MAX-typed (LOB) columns — onboarding job rows carry
    // base64 file blobs that would OOM the recordset (they are test uploads).
    for (const [t, cols] of appTenantCols) {
      const n = appCounts[t] ?? 0;
      if (!n || truncated) continue;
      if (n > SNAPSHOT_MAX_TABLE_ROWS) {
        await write(JSON.stringify({ kind: "table_skipped", db: "app", t, rows: n, reason: "too_large" }) + "\n");
        continue;
      }
      const colR = await pool.request().query(`
        SELECT COLUMN_NAME c, CHARACTER_MAXIMUM_LENGTH ml FROM ${bq(appDb)}.INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME=${lit(t)}`);
      const allCols = (colR.recordset ?? []) as any[];
      const slim = allCols.filter(c => Number(c.ml) !== -1).map(c => bq(String(c.c)));
      const lob = allCols.filter(c => Number(c.ml) === -1).map(c => String(c.c));
      if (lob.length) await write(JSON.stringify({ kind: "lob_columns_excluded", db: "app", t, cols: lob }) + "\n");
      const sel = slim.length ? slim.join(",") : "*";
      const rowsR = await pool.request().query(`SELECT ${sel} FROM ${appFq(t)} WHERE ${appWhere(cols)}`);
      await streamRows("app", t, rowsR.recordset ?? []);
    }
    if (truncated) await write(JSON.stringify({ kind: "truncated", reason: "snapshot_too_large", bytesWritten: bytes }) + "\n");
    gz.end();
    await finished(gz);
    await uploadFile(snapshotKey, Buffer.concat(chunks), "application/gzip");
    state.snapshotKey = snapshotKey;
    state.snapshotDone = true;
    // Pin the exact target set this snapshot covers — resumed runs may only
    // delete these tenants/candidates, never a re-discovered superset.
    state.keepFingerprint = KEEP_FINGERPRINT;
    state.deleteGuids = deleteGuids;
    state.appCandidates = appCandidates;
    saveState(state);
    log(`snapshot uploaded: s3 key=${snapshotKey} (${Buffer.concat(chunks).length} gz bytes, ${bytes} raw${truncated ? ", TRUNCATED" : ""})`);
  } else {
    log(`snapshot already done: ${state.snapshotKey} — resuming deletes`);
  }

  // ── Core2 group-wise chunked deletes, multi-pass FK convergence ────────────
  let totalDeleted = 0, pass = 0, deletedThisPass = 1, budgetHit = false;
  const fkBlocked: string[] = [];
  while (deletedThisPass > 0 && pass < 12 && !budgetHit) {
    pass++;
    deletedThisPass = 0;
    fkBlocked.length = 0;
    for (const lt of core2WithRows) {
      if (outOfBudget()) { budgetHit = true; break; }
      try {
        for (;;) {
          const r = await pool.request().query(
            `DELETE TOP (${DELETE_BATCH}) FROM ${fqOf(lt)} WHERE TenantID IN (${delInList})`);
          const n = r.rowsAffected[0] || 0;
          totalDeleted += n;
          deletedThisPass += n;
          if (n > 0) log(`  ${nameByLower.get(lt)}: -${n} (pass ${pass})`);
          if (n < DELETE_BATCH) break;
          if (outOfBudget()) { budgetHit = true; break; }
        }
      } catch (e: any) {
        fkBlocked.push(`${nameByLower.get(lt)}:${String(e?.number ?? e?.message).slice(0, 40)}`);
      }
      if (budgetHit) break;
    }
    log(`core2 pass ${pass}: ${deletedThisPass} rows (total ${totalDeleted})${fkBlocked.length ? ` blocked: ${fkBlocked.join(", ")}` : ""}`);
  }
  if (budgetHit) {
    log(`TIME BUDGET REACHED after ${totalDeleted} core2 rows deleted — RE-RUN the same command to continue (idempotent).`);
    process.exit(3);
  }

  // ── Invite tokens ──────────────────────────────────────────────────────────
  let invitesDeleted = 0;
  try {
    const r = await pool.request().query(`
      DELETE FROM core2.dbo.RMOneInviteTokens
      WHERE LOWER(LTRIM(RTRIM(TenantKey))) IN (${appCandList}) OR LOWER(LTRIM(RTRIM(TenantLabel))) IN (${appCandList})`);
    invitesDeleted = r.rowsAffected[0] || 0;
  } catch { /* absent */ }

  // ── App DB sweep (users, jobs, aliases, review, provenance, registry) ─────
  let appDeleted = 0;
  const appBlocked: string[] = [];
  for (let p = 0; p < 4; p++) {
    appBlocked.length = 0;
    let progressed = false;
    for (const [t, cols] of appTenantCols) {
      if (!appCounts[t]) continue;
      try {
        for (;;) {
          const r = await pool.request().query(
            `DELETE TOP (${APP_DELETE_BATCH}) FROM ${appFq(t)} WHERE ${appWhere(cols)}`);
          const n = r.rowsAffected[0] || 0;
          appDeleted += n;
          if (n > 0) { progressed = true; log(`  app.${t}: -${n}`); }
          if (n < APP_DELETE_BATCH) break;
        }
      } catch (e: any) { appBlocked.push(`${t}:${String(e?.number ?? e?.message).slice(0, 40)}`); }
    }
    if (!appBlocked.length || !progressed) break;
  }

  // ── Honest verification: batched recount of everything that had rows ──────
  let remaining = -1, appRemaining = -1, invitesRemaining = -1;
  const survivors: string[] = [];
  try {
    remaining = 0;
    for (let i = 0; i < core2WithRows.length; i += 50) {
      const chunk = core2WithRows.slice(i, i + 50);
      const q = chunk.map((lt, j) => `SELECT ${i + j} i, COUNT(*) n FROM ${fqOf(lt)} WHERE TenantID IN (${delInList})`).join("\nUNION ALL\n");
      const r = await pool.request().query(q);
      for (const row of (r.recordset ?? []) as any[]) {
        const n = Number(row.n) || 0;
        remaining += n;
        if (n > 0) survivors.push(`core2.${nameByLower.get(core2WithRows[row.i])}=${n}`);
      }
    }
  } catch (e: any) { remaining = -1; log(`recount FAILED: ${e?.message}`); }
  try {
    appRemaining = 0;
    const appHad = [...appTenantCols.entries()].filter(([t]) => appCounts[t]);
    if (appHad.length) {
      const q = appHad.map(([t, cols], j) => `SELECT ${j} i, COUNT(*) n FROM ${appFq(t)} WHERE ${appWhere(cols)}`).join("\nUNION ALL\n");
      const r = await pool.request().query(q);
      for (const row of (r.recordset ?? []) as any[]) {
        const n = Number(row.n) || 0;
        appRemaining += n;
        if (n > 0) survivors.push(`app.${appHad[row.i][0]}=${n}`);
      }
    }
  } catch (e: any) { appRemaining = -1; log(`app recount FAILED: ${e?.message}`); }
  try {
    const r = await pool.request().query(`
      SELECT COUNT(*) n FROM core2.dbo.RMOneInviteTokens
      WHERE LOWER(LTRIM(RTRIM(TenantKey))) IN (${appCandList}) OR LOWER(LTRIM(RTRIM(TenantLabel))) IN (${appCandList})`);
    invitesRemaining = Number(r.recordset[0]?.n ?? -1);
  } catch { invitesRemaining = inviteRows > 0 ? -1 : 0; }

  // ── Keep-tenant after-check ────────────────────────────────────────────────
  const after = await keepCounts();
  let keepIntact = true;
  for (const k of KEEP) {
    const b = state.keepBaseline?.[k.label] ?? {};
    const a = after[k.label] ?? {};
    for (const lt of KEEP_CHECK_TABLES) {
      if ((b[lt] ?? 0) !== (a[lt] ?? 0)) {
        keepIntact = false;
        console.error(`KEEP DRIFT: ${k.label}.${nameByLower.get(lt)} was ${b[lt] ?? 0}, now ${a[lt] ?? 0}`);
      }
    }
  }

  const clean = remaining === 0 && appRemaining === 0 && invitesRemaining === 0;
  console.log("\n================ PURGE RESULT ================");
  console.log(`core2 deleted: ${totalDeleted} | app deleted: ${appDeleted} | invites deleted: ${invitesDeleted}`);
  console.log(`survivors: core2=${remaining} app=${appRemaining} invites=${invitesRemaining}`);
  if (survivors.length) console.log(`  ${survivors.join("\n  ")}`);
  console.log(`keep tenants intact: ${keepIntact ? "YES (all spot-check counts match baseline)" : "NO — SEE DRIFT ABOVE"}`);
  console.log(`snapshot: ${state.snapshotKey}`);
  console.log(clean && keepIntact ? "VERDICT: CLEAN" : "VERDICT: PARTIAL / NOT VERIFIED — see above");
  console.log("==============================================");
  process.exit(clean && keepIntact ? 0 : 1);
}

main().catch(e => { console.error("FATAL", String(e?.stack ?? e).slice(0, 800)); process.exit(1); });
