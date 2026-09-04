import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  canDismissTeamAllocation,
  type TeamAllocationDismissPath,
} from "../teamAllocationDismiss.js";

const paths: TeamAllocationDismissPath[] = [
  "cancel",
  "backdrop",
  "escape",
];

for (const dismissPath of paths) {
  assert.equal(
    canDismissTeamAllocation({
      isAllocationWorkspace: true,
      submitting: true,
      assignmentSaved: false,
    }, dismissPath),
    false,
    `${dismissPath} must be blocked while either save is in flight`,
  );
  assert.equal(
    canDismissTeamAllocation({
      isAllocationWorkspace: true,
      submitting: false,
      assignmentSaved: true,
    }, dismissPath),
    false,
    `${dismissPath} must be blocked after assignment save until weekly hours succeed`,
  );
  assert.equal(
    canDismissTeamAllocation({
      isAllocationWorkspace: true,
      submitting: false,
      assignmentSaved: false,
    }, dismissPath),
    true,
    `${dismissPath} should work before saving starts`,
  );
}

// Interaction regression: the core assignment completed, the weekly-hours
// request failed, and the user tries every way out of the workspace. None may
// reach the close action and leave the zero-hour assignment behind.
const afterWeeklySaveFailure = {
  isAllocationWorkspace: true,
  submitting: false,
  assignmentSaved: true,
};
let abandonedActions = 0;
for (const dismissPath of paths) {
  if (canDismissTeamAllocation(afterWeeklySaveFailure, dismissPath)) {
    abandonedActions += 1;
  }
}
assert.equal(
  abandonedActions,
  0,
  "weekly-save failure must not allow any close action",
);

// Legacy edit/change/period modals retain their existing dismissal behavior.
assert.equal(
  canDismissTeamAllocation({
    isAllocationWorkspace: false,
    submitting: true,
    assignmentSaved: true,
  }, "cancel"),
  true,
);

// Guard against a future UI refactor accidentally bypassing the shared policy.
const here = path.dirname(fileURLToPath(import.meta.url));
const modalSource = readFileSync(
  path.resolve(here, "../../components/AddTeamMemberModal.tsx"),
  "utf8",
);
for (const dismissPath of paths) {
  assert.match(
    modalSource,
    new RegExp(`requestDismiss\\(\"${dismissPath}\"`),
    `AddTeamMemberModal must route ${dismissPath} through requestDismiss`,
  );
}

console.log("teamAllocationDismiss: all dismissal paths stay locked until weekly hours succeed");