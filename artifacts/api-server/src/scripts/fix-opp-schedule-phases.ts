// One-off repair: opportunities whose schedule was auto-seeded with PROJECT
// phases before the module-scoped seeding fix (new-record auto-lifecycle used
// defaultPhases/projectPhaseSets for BOTH modules). Replaces those schedules
// with the tenant's schedulable OPPORTUNITY path stages — but ONLY for pure,
// untouched seeds:
//   • the record is an Opportunity (core2.dbo.Opportunity row)
//   • its ordered phase titles exactly match a PROJECT phase signature
//     (defaultPhases or any projectPhaseSets set)
//   • no phase has a real start/end date, a status beyond "Not Started",
//     or any percent complete — i.e. nobody worked on the schedule.
// Anything else is left untouched. Dry-run by default.
//
// Usage:
//   pnpm --filter @workspace/api-server exec tsx src/scripts/fix-opp-schedule-phases.ts <tenantLabel> [--apply] [--sig "A, B, C"]...
//
// --sig adds an extra known PROJECT-phase signature (comma-separated, repeatable)
// for tenants whose defaultPhases setting changed after the bad seeds were made
// (the historic list is not derivable from current settings).
//
// NOTE: run against the live api-server DB; after --apply, restart the
// api-server so its task-data / lifecycles caches drop the old rows.
import { v5 as uuidv5 } from "uuid";
import sql from "mssql";
import { getPool } from "../lib/db.js";
import { loadEffectiveDefaults } from "../lib/onboarding-settings-store.js";
import { parseProjectPhaseSets } from "../lib/onboarding-defaults.js";
import { isOutcomeStageName } from "../lib/stage-rules.js";
import { findOrCreateLifecycleForPhasesRds, createScheduleRds } from "../lib/rds-provider.js";

const TENANT_NAMESPACE = "5d8f1e6a-2c3b-4d7e-9a1f-0b2c3d4e5f6a";
const label = process.argv[2];
const apply = process.argv.includes("--apply");
const extraSigs: string[][] = [];
for (let i = 3; i < process.argv.length; i++) {
  if (process.argv[i] === "--sig" && process.argv[i + 1]) {
    const phases = process.argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean);
    if (phases.length) extraSigs.push(phases);
  }
}
if (!label || label.startsWith("--")) { console.error('usage: tsx fix-opp-schedule-phases.ts <tenantLabel> [--apply] [--sig "A, B, C"]...'); process.exit(1); }
const tid = uuidv5(label.toLowerCase(), TENANT_NAMESPACE);

const key = (arr: string[]) => arr.map((s) => s.trim().toLowerCase()).join("\u0001");

// Real date = anything after the 1901 sentinel window used by the schedule code.
function hasRealDate(v: unknown): boolean {
  if (v == null || v === "" || v === false) return false;
  const d = new Date(String(v));
  return !Number.isNaN(d.getTime()) && d.getTime() > new Date("1901-01-02T00:00:00Z").getTime();
}

type TaskRow = Record<string, unknown>;
const rowTitle = (r: TaskRow) => String(r.Title ?? "").trim();
const rowStep = (r: TaskRow) => Number(r.StageStep ?? 0) || Number(r.ItemOrder ?? 0) || Number(r.ID ?? 0) || 0;

async function main() {
  console.log(`tenant=${label} tid=${tid} mode=${apply ? "APPLY" : "dry-run"}`);
  const defaults = await loadEffectiveDefaults(label);

  const pmmSigs = new Set<string>();
  const defPhases = String(defaults.defaultPhases ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (defPhases.length) pmmSigs.add(key(defPhases));
  for (const set of parseProjectPhaseSets(defaults.projectPhaseSets)) {
    if (set.phases?.length) pmmSigs.add(key(set.phases));
  }
  for (const phases of extraSigs) {
    pmmSigs.add(key(phases));
    console.log(`extra signature (operator-provided): [${phases.join(" | ")}]`);
  }
  const oppAll = String(defaults.defaultOpportunityStages ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const oppPath = oppAll.filter((s) => !isOutcomeStageName(s));
  console.log(`project-phase signatures: ${pmmSigs.size} (default: [${defPhases.join(" | ")}])`);
  console.log(`opp stages: [${oppAll.join(" | ")}] → schedulable path: [${oppPath.join(" | ")}]`);
  if (pmmSigs.size === 0) { console.log("No project phase signatures — nothing can be classified. Aborting."); return; }
  if (oppPath.length === 0) { console.log("No schedulable opp path stages — nothing to seed. Aborting."); return; }

  const pool = await getPool();
  // Live PMMTasks columns (mirrors getTaskDataRds's tolerant column handling).
  const colsRes = await pool.request().query(
    `SELECT c.name FROM core2.sys.columns c JOIN core2.sys.tables t ON t.object_id=c.object_id WHERE t.name='PMMTasks'`);
  const tcols = new Set(((colsRes.recordset ?? []) as { name?: unknown }[]).map((r) => String(r.name ?? "").toLowerCase()));
  if (tcols.size === 0) { console.error("core2.dbo.PMMTasks not found — aborting."); process.exit(1); }
  const want = ["ID", "Title", "StartDate", "DueDate", "Status", "PercentComplete", "ItemOrder", "StageStep", "TicketId"];
  const sel = want.filter((c) => tcols.has(c.toLowerCase())).map((c) => `t.[${c}]`).join(", ");
  const delClause = tcols.has("deleted") ? "AND (t.[Deleted]=0 OR t.[Deleted] IS NULL)" : "";

  // One set-based scan: all task rows belonging to this tenant's opportunities.
  const taskRes = await pool.request().input("tid", sql.NVarChar, tid).query(
    `SELECT ${sel}
     FROM core2.dbo.PMMTasks t
     WHERE t.[TenantID]=@tid ${delClause}
       AND t.[TicketId] IN (SELECT o.[TicketId] FROM core2.dbo.Opportunity o
                            WHERE o.[TenantID]=@tid AND (o.[Deleted]=0 OR o.[Deleted] IS NULL)
                              AND o.[TicketId] IS NOT NULL AND LTRIM(RTRIM(o.[TicketId])) <> '')`);
  const byTicket = new Map<string, TaskRow[]>();
  for (const r of (taskRes.recordset ?? []) as TaskRow[]) {
    const ticket = String(r.TicketId ?? "").trim();
    if (!ticket) continue;
    if (!byTicket.has(ticket)) byTicket.set(ticket, []);
    byTicket.get(ticket)!.push(r);
  }
  console.log(`opportunities with schedule task rows: ${byTicket.size} (${taskRes.recordset?.length ?? 0} rows)`);
  if (byTicket.size === 0) return;

  const wrong: string[] = [];
  const skipped: Record<string, number> = { "custom-phases": 0, "has-progress": 0 };
  for (const [ticket, rows] of byTicket) {
    const ordered = [...rows].sort((a, b) => rowStep(a) - rowStep(b)).map(rowTitle).filter(Boolean);
    if (!pmmSigs.has(key(ordered))) {
      skipped["custom-phases"]++;
      console.log(`  skip (own phases) ${ticket}: [${ordered.join(" | ")}]`);
      continue;
    }
    const untouched = rows.every((r) => {
      const status = String(r.Status ?? "").trim().toLowerCase();
      const pct = Number(r.PercentComplete ?? 0) || 0;
      return !hasRealDate(r.StartDate) && !hasRealDate(r.DueDate)
        && (status === "" || status === "not started") && pct === 0;
    });
    if (!untouched) {
      skipped["has-progress"]++;
      console.log(`  skip (has dates/progress) ${ticket}: [${ordered.join(" | ")}]`);
      continue;
    }
    wrong.push(ticket);
    console.log(`  WRONG-SEED ${ticket}: [${ordered.join(" | ")}]`);
  }
  console.log(`\nwrong-seeded (untouched) opportunities: ${wrong.length}; skipped: ${JSON.stringify(skipped)}`);
  if (wrong.length === 0) return;

  if (!apply) { console.log("Dry-run — re-run with --apply to replace these schedules."); return; }

  const lcId = await findOrCreateLifecycleForPhasesRds(tid, oppPath, "OPM");
  if (!lcId) { console.error("Could not find/create the OPM lifecycle template — aborting."); process.exit(1); }
  console.log(`OPM lifecycle template id=${lcId} [${oppPath.join(" | ")}]`);
  const tasks = oppPath.map((title, i) => ({ Title: title, StageStep: i + 1, ItemOrder: i + 1, Status: "Not Started", PercentComplete: 0 }));
  let ok = 0, fail = 0;
  for (const ticket of wrong) {
    try {
      const r = await createScheduleRds(tid, ticket, String(lcId), tasks);
      if (r.ok) { ok++; console.log(`  fixed ${ticket} (${r.count} phases)`); }
      else { fail++; console.warn(`  FAILED ${ticket}: ${r.error ?? "unknown"}`); }
    } catch (e) {
      fail++; console.warn(`  FAILED ${ticket}: ${String(e).slice(0, 160)}`);
    }
  }
  console.log(`\ndone: fixed=${ok} failed=${fail}. Restart the api-server to drop stale task/lifecycle caches.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
