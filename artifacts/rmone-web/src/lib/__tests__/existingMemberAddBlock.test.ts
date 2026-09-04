import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hookSource = readFileSync(
  new URL("../../hooks/useAssignMemberCascade.ts", import.meta.url),
  "utf8",
);
const modalSource = readFileSync(
  new URL("../../components/AddTeamMemberModal.tsx", import.meta.url),
  "utf8",
);

const existingTargetStart = hookSource.indexOf("const existingDirectAllocation =");
assert.notEqual(existingTargetStart, -1, "existing assignment target must be resolved");
const existingTarget = hookSource.slice(existingTargetStart, existingTargetStart + 900);
assert.match(
  existingTarget,
  /existingAllocations\.find\(\(allocation\) => norm\(allocation\.personId\) === norm\(personId\)\)/,
  "the planner must resolve an existing assignment GUID-first",
);

const existingSaveStart = hookSource.indexOf("if (hasDirectWeeklyPlan && alreadyOnProjectForDirectPlan)");
assert.notEqual(existingSaveStart, -1, "existing-member weekly edit path must exist");
// Window sized to cover the instant-save block (close-first + queued
// background write) while still proving the dates UPDATE precedes the hours
// write inside this branch.
const existingSave = hookSource.slice(existingSaveStart, existingSaveStart + 1800);
assert.match(
  existingSave,
  /persistExistingDirectAssignmentWindow\(\)[\s\S]*?persistDirectWeeklyHours\(\)/,
  "the existing assignment window and hours must be updated without inserting a member",
);
assert.match(
  hookSource,
  /Positive persisted ID[\s\S]*?UPDATE the[\s\S]*?ID: existingId/,
  "assignment date edits must carry the positive persisted row ID",
);
assert.match(
  modalSource,
  /isEditingExistingPlan=\{isEditingExistingPlan\}/,
  "the shared planner must visibly switch into existing-assignment edit mode",
);

console.log("existing-member-add-block: existing members edit in place and cannot be re-added");