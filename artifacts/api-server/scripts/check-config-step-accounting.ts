// Focused assertion for #390: configuration/seed step accounting.
//
// Guards the pipeline invariant that setup/seed writes (Tenant, AdminSeed,
// PortalConfig, Config_* seeds) accumulate into result.configInserted and are
// flagged isConfig — NEVER into totalInserted, which counts only data rows
// from the uploaded file. A regression here makes a 0-data-row import report
// "N records inserted" from internal seed writes.
//
// Run: pnpm --filter @workspace/api-server run check:config-steps
import { pushConfigStep, type PipelineResult, type StepResult } from "../src/lib/pipeline.js";
// The web UI's data-vs-setup classifier (pure module, no React imports) — the
// EXACT logic TerminalStatusCard uses to compute "data rows imported".
import { isConfigStep, sumDataRows, sumSetupRows, sumUpdatedRows } from "../../rmone-web/src/lib/importSteps.js";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); return; }
  failures++;
  console.error(`  ✗ ${msg}`);
}

function freshResult(): PipelineResult {
  return { uploadId: "t", tenantId: "t", status: "success", steps: [], errors: [], totalInserted: 0, totalErrors: 0 };
}
function mkStep(table: string, rowsInserted: number, errs = 0): StepResult {
  return {
    step: 0, table, rowsAttempted: 1, rowsInserted, rowsSkipped: 0,
    errors: Array.from({ length: errs }, () => ({ table, rowIndex: -1, message: "x" })),
  };
}

console.log("[check-config-steps] zero-data-row create run: tenant/admin/config seeds");
{
  // Simulate the seed sequence of a create-mode run with ZERO uploaded data rows:
  // Tenant(1) + AdminSeed(1) + PortalConfig(3 clone tables) + lifecycle(1) +
  // opp stages(1) + 4 config variables.
  const r = freshResult();
  for (const [table, n] of [
    ["Tenant", 1], ["AdminSeed", 1], ["PortalConfig", 3],
    ["Config_ModuleLifeCycles", 1], ["Config_Module_ModuleStages (OPM)", 1],
    ["Config_ConfigurationVariable", 4],
  ] as Array<[string, number]>) {
    pushConfigStep(r, mkStep(table, n));
  }
  assert(r.totalInserted === 0, `totalInserted stays 0 (data rows only) — got ${r.totalInserted}`);
  assert(r.configInserted === 11, `configInserted accumulates every seed write (11) — got ${r.configInserted}`);
  assert(r.steps.length === 6, `all 6 seed steps recorded — got ${r.steps.length}`);
  assert(r.steps.every(s => s.isConfig === true), "every seed step is flagged isConfig");
  assert(r.totalErrors === 0 && r.errors.length === 0, "pushConfigStep never touches error accounting (callers own it)");
}

console.log("[check-config-steps] skipped/failed seed steps");
{
  const r = freshResult();
  pushConfigStep(r, mkStep("AdminSeed", 0));          // already-active admin (skip)
  pushConfigStep(r, mkStep("PortalConfig", 0, 1));    // failed clone
  assert(r.configInserted === 0, `skips/failures add 0 to configInserted — got ${r.configInserted}`);
  assert(r.totalInserted === 0, "totalInserted untouched");
  assert(r.steps.length === 2 && r.steps.every(s => s.isConfig), "steps still recorded + flagged");
}

console.log("[check-config-steps] UI classifier: uploaded Config_ConfigurationVariable is DATA, seed steps are setup");
{
  // An uploaded configuration sheet produces an ordinary data step named
  // Config_ConfigurationVariable WITHOUT isConfig — it must count as data
  // rows, never be hidden behind the "setup entries" label (review regression).
  const uploadedConfig = { table: "Config_ConfigurationVariable", rowsInserted: 7 };
  assert(!isConfigStep(uploadedConfig), "uploaded Config_ConfigurationVariable step (no isConfig) classifies as DATA");
  const seededConfig = { table: "Config_ConfigurationVariable", rowsInserted: 4, isConfig: true };
  assert(isConfigStep(seededConfig), "seeded Config_ConfigurationVariable step (isConfig) classifies as setup");
  // Legacy fallback (pre-isConfig jobs): only the seed-only step names.
  assert(isConfigStep({ table: "Tenant", rowsInserted: 1 }), "legacy Tenant step classifies as setup");
  assert(isConfigStep({ table: "PortalConfig", rowsInserted: 3 }), "legacy PortalConfig step classifies as setup");
  assert(isConfigStep({ table: "Config_Module_ModuleStages (OPM)", rowsInserted: 1 }), "legacy OPM stage seed classifies as setup");
  const steps = [uploadedConfig, seededConfig, { table: "PMM", rowsInserted: 10 }, { table: "AdminSeed", rowsInserted: 1, isConfig: true }];
  assert(sumDataRows(steps) === 17, `sumDataRows counts uploaded config + PMM (17) — got ${sumDataRows(steps)}`);
  assert(sumSetupRows(steps) === 5, `sumSetupRows counts only flagged/seed steps (5) — got ${sumSetupRows(steps)}`);
}

console.log("[check-config-steps] update-only run: 0 inserts + N updates is real data work, never 'no data'");
{
  // Update-mode import: every uploaded row matched an existing record →
  // rowsInserted 0, rowsUpdated > 0, plus the usual seed steps. The UI's
  // zero-data determination (dataRows === 0 && updatedRows === 0) must NOT
  // flag this run as "setup entries only".
  const steps = [
    { table: "AspNetUsers", rowsInserted: 0, rowsUpdated: 12 },
    { table: "PMM", rowsInserted: 0, rowsUpdated: 5 },
    { table: "Config_ConfigurationVariable", rowsInserted: 0, rowsUpdated: 0, isConfig: true },
  ];
  const dataRows = sumDataRows(steps);
  const updated  = sumUpdatedRows(steps);
  assert(dataRows === 0, `update-only run has 0 NEW data rows — got ${dataRows}`);
  assert(updated === 17, `sumUpdatedRows counts in-place updates on data steps (17) — got ${updated}`);
  assert(!(dataRows === 0 && updated === 0), "zero-data predicate (data===0 && updated===0) is FALSE for an update-only run");
  // Config steps never contribute updates to the data-work determination.
  assert(sumUpdatedRows([{ table: "PortalConfig", rowsInserted: 0, rowsUpdated: 3, isConfig: true }]) === 0,
    "updates on config steps don't count as data work");
}

if (failures > 0) {
  console.error(`\n[check-config-steps] FAILED — ${failures} assertion(s)`);
  process.exit(1);
}
console.log("\n[check-config-steps] OK");
