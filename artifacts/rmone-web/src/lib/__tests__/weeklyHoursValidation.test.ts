import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  findWeeklyHoursViolation,
  parseWeeklyHoursDraft,
  weeklyHoursViolationMessage,
} from "../weeklyHoursValidation.js";
import { buildDirectWeeklyAllocations } from "../phaseHours.js";

function violation(entries: Array<readonly [string, unknown]>) {
  return findWeeklyHoursViolation(entries);
}

assert.equal(violation([["2026-03-02", 168]]), null);
assert.equal(violation([["2026-03-02", 0]]), null);
assert.equal(parseWeeklyHoursDraft(""), null, "blank input must not become a zero-hour save");
assert.equal(parseWeeklyHoursDraft("   "), null, "whitespace input must not become a zero-hour save");
assert.equal(parseWeeklyHoursDraft("0"), 0, "an explicit zero may clear a weekly allocation");
assert.equal(parseWeeklyHoursDraft(" 12.5 "), 12.5);
assert.equal(parseWeeklyHoursDraft("hours"), null);

const over = violation([["2026-03-02", 168.25]]);
assert.deepEqual(over, {
  week: "2026-03-02",
  hours: 168.25,
  reason: "over_limit",
});
assert.match(weeklyHoursViolationMessage(over!), /maximum is 168 hours per week/i);
assert.match(weeklyHoursViolationMessage(over!), /Nothing has been saved/i);

const negative = violation([["2026-03-02", -1]]);
assert.equal(negative?.reason, "negative");

const invalid = violation([["2026-03-02", "169"]]);
assert.equal(invalid?.reason, "not_a_number");

const bypassPayload = buildDirectWeeklyAllocations(
  { personId: "person-1", personName: "Test Person", role: "Designer" },
  [{ week: "2026-03-02", hours: 169 }],
);
assert.equal(
  bypassPayload[0]?.AllocationHour,
  169,
  "the payload builder must preserve an invalid value for the server to reject",
);
assert.equal(bypassPayload[0]?.PctAllocation, 169);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hookSource = readFileSync(
  path.resolve(__dirname, "../../hooks/useAssignMemberCascade.ts"),
  "utf8",
);
const submitStart = hookSource.indexOf("async function submit()");
const submitEnd = hookSource.indexOf("// ── CHANGE-RESOURCE mode", submitStart);
const submitSource = hookSource.slice(submitStart, submitEnd);
const preflightAt = submitSource.indexOf("if (hasDirectWeeklyPlan && directWeeklyViolation)");
const assignmentWriteAt = hookSource.indexOf("await assignResource(", submitStart);
assert.ok(preflightAt >= 0, "submit must contain a weekly-limit preflight");
assert.ok(
  assignmentWriteAt >= 0 && submitStart + preflightAt < assignmentWriteAt,
  "weekly-limit preflight must run before creating or updating the assignment",
);

const plannerSource = readFileSync(
  path.resolve(__dirname, "../../components/TeamAllocationPlanner.tsx"),
  "utf8",
);
assert.doesNotMatch(
  plannerSource,
  /Math\.min\(168,\s*parsed\)/,
  "the input must show an over-limit value rather than silently clamping it to 168",
);
assert.match(plannerSource, /maximum 168h\/week/);
assert.match(
  hookSource,
  /friendlySaveError\(weeklyError\)/,
  "initial-add failures must display the server's friendly weekly-hours message",
);

console.log("weeklyHoursValidation: all assertions passed");