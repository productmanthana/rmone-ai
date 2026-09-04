import assert from "node:assert/strict";
import { analyzeLegacyAssignmentPeriods } from "../legacy-assignment-periods.js";

const twoSlices = analyzeLegacyAssignmentPeriods({
  assignmentIds: [10, 11],
  locked: false,
  rows: [
    { id: 1, rwiId: 10, start: "2026-01-05", end: "2026-01-11", hours: 20 },
    { id: 2, rwiId: 11, start: "2026-01-12", end: "2026-01-18", hours: 30 },
  ],
});
assert.equal(twoSlices.mergeable, true, "separate imported periods should merge safely");
assert.equal(twoSlices.canonicalRwiId, 11);
assert.equal(twoSlices.mergedHours, 50, "weekly hours must survive consolidation");

const idempotent = analyzeLegacyAssignmentPeriods({
  assignmentIds: [10, 11],
  locked: false,
  rows: [
    { id: 1, rwiId: 10, start: "2026-01-05", end: "2026-01-11", hours: 20 },
    { id: 2, rwiId: 11, start: "2026-01-05", end: "2026-01-11", hours: 20 },
  ],
});
assert.equal(idempotent.mergeable, true, "an exact re-upload copy is safe to de-duplicate");
assert.deepEqual(idempotent.duplicateAllocationIds, [1]);
assert.equal(idempotent.mergedHours, 20, "exact duplicate hours must not be counted twice");

const conflict = analyzeLegacyAssignmentPeriods({
  assignmentIds: [10, 11],
  locked: false,
  rows: [
    { id: 1, rwiId: 10, start: "2026-01-05", end: "2026-01-11", hours: 20 },
    { id: 2, rwiId: 11, start: "2026-01-05", end: "2026-01-11", hours: 30 },
  ],
});
assert.equal(conflict.mergeable, false, "conflicting hours must be surfaced, not guessed");
assert.equal(conflict.conflicts[0]?.kind, "overlapping_hours");

const locked = analyzeLegacyAssignmentPeriods({
  assignmentIds: [10, 11],
  locked: true,
  rows: [],
});
assert.equal(locked.mergeable, false, "locked assignments are never auto-consolidated");
assert.equal(locked.conflicts[0]?.kind, "locked");

console.log("legacyAssignmentPeriods tests passed");