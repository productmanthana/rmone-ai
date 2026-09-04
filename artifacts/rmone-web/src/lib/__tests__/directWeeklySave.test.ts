/**
 * Regression coverage for the fast Team Allocation workspace save path.
 *
 * The direct payload must contain the selected person's full week plan without
 * first fetching the project's full allocation matrix. In particular, zero
 * rows must remain present so an existing member's weekly plan can be cleared.
 */

import assert from "node:assert/strict";
import { buildDirectWeeklyAllocations } from "../phaseHours.js";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${(error as Error).message}`);
    failed++;
  }
}

const PERSON_ID = "aaaaaaaa-0000-0000-0000-000000000001";

console.log("\nA) Direct weekly payload formation");

test("writes canonical identity, role, week dates, and raw-hour mirrors", () => {
  const rows = buildDirectWeeklyAllocations(
    { personId: PERSON_ID, personName: "Alex Chen", role: "Project Manager" },
    [
      { week: "2026-03-02", hours: 12.5 },
      { week: "2026-03-09", hours: 8 },
    ],
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    AssignedTo: PERSON_ID,
    AssignedToName: "Alex Chen",
    TypeName: "Project Manager",
    RoleName: "Project Manager",
    AllocationStartDate: "2026-03-02T00:00:00",
    AllocationEndDate: "2026-03-08T00:00:00",
    PctAllocation: 12.5,
    AllocationHour: 12.5,
    isChanged: true,
  });
  assert.equal(rows[1].AllocationStartDate, "2026-03-09T00:00:00");
  assert.equal(rows[1].AllocationEndDate, "2026-03-15T00:00:00");
  assert.equal(rows[1].PctAllocation, 8);
  assert.equal(rows[1].AllocationHour, 8);
});

console.log("\nB) All-zero plan clear");

test("keeps every zero-hour week so the server clears an existing member's plan", () => {
  const rows = buildDirectWeeklyAllocations(
    { personId: PERSON_ID, personName: "Alex Chen", role: "Project Manager" },
    [
      { week: "2026-03-02", hours: 0 },
      { week: "2026-03-09", hours: 0 },
    ],
  );

  assert.equal(rows.length, 2, "clear payload must not collapse to an empty array");
  for (const row of rows) {
    assert.equal(row.AssignedTo, PERSON_ID);
    assert.equal(row.AllocationHour, 0);
    assert.equal(row.PctAllocation, 0);
  }
});

if (failed > 0) {
  console.error(`\n${failed} direct weekly save test(s) failed.`);
  process.exit(1);
}
console.log(`\n✓ All ${passed} direct weekly save tests passed.`);