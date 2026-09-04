import assert from "node:assert/strict";
import {
  getCrossBuPromptMode,
  shouldAutoContinueAfterBuAdd,
  shouldFilterPeopleByOrganization,
} from "../crossBuConfirmation";

// A weekly allocation workspace begins with the project's BU as context, but
// must still offer staff from another BU so Add to Team can ask for consent.
assert.equal(shouldFilterPeopleByOrganization(true), false);
assert.equal(shouldFilterPeopleByOrganization(false), true);

// Selecting an off-project-BU person only records a pending mismatch. The
// confirmation appears after Add to Team, and clearing the selection removes
// it entirely without any project update.
assert.equal(getCrossBuPromptMode(true, false), "pending");
assert.equal(getCrossBuPromptMode(true, true), "open");
assert.equal(getCrossBuPromptMode(false, false), "none");

// After the popup's "Add" succeeds, the add flow continues on its own — the
// user already clicked Add to Team to open the popup. The continuation waits
// for the mismatch to fully clear and never fires while a write is running,
// and it never fires unless armed by a successful BU add.
assert.equal(shouldAutoContinueAfterBuAdd(true, false, false, false), true);
assert.equal(shouldAutoContinueAfterBuAdd(false, false, false, false), false); // Cancel / failed write
assert.equal(shouldAutoContinueAfterBuAdd(true, true, false, false), false);  // mismatch still set
assert.equal(shouldAutoContinueAfterBuAdd(true, false, true, false), false);  // popup still open
assert.equal(shouldAutoContinueAfterBuAdd(true, false, false, true), false);  // BU write / submit running

console.log("cross-BU confirmation checks passed");