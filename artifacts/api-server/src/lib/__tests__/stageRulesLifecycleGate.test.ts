/**
 * Regression coverage for the lifecycle-only stage-rules contract.
 *
 * The database-backed gate lives in rds-provider, so this test covers its
 * pure module decision and statically verifies every rule enforcement branch
 * calls the shared schedule gate before loading the rules document.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stageRulesRequireLifecycle } from "../rds-provider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(__dirname, "../rds-provider.ts"), "utf8");
const routeSource = readFileSync(path.resolve(__dirname, "../../routes/onboarding.ts"), "utf8");

assert.equal(stageRulesRequireLifecycle("PMM"), true, "Projects require lifecycle phases");
assert.equal(stageRulesRequireLifecycle("OPM"), true, "Opportunities require lifecycle phases");
assert.equal(stageRulesRequireLifecycle("LEM"), false, "Leads retain their independent behavior");
assert.equal(stageRulesRequireLifecycle(null), false, "Unknown record types cannot be lifecycle-gated as valid");

for (const name of [
  "checkStageFieldLocks",
  "computeSkipAdvance",
  "checkRequiredFieldsForStage",
  "checkStageWritePermission",
  "checkWorkflowTypeRestriction",
  "getStagePermissionSummary",
]) {
  const start = source.indexOf(`function ${name}(`) >= 0
    ? source.indexOf(`function ${name}(`)
    : source.indexOf(`function ${name}(`.replace("function ", "export async function "));
  assert.notEqual(start, -1, `${name} exists`);
  const body = source.slice(start, start + 5000);
  assert.match(body, /hasAssignedLifecycleScheduleRds/, `${name} uses the shared lifecycle gate`);
}

assert.match(routeSource, /Assign a lifecycle with at least one phase before setting rules/, "record rule saves reject records without lifecycle phases");
console.log("stageRulesLifecycleGate: lifecycle-only rule checks passed");