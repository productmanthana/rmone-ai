import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ASSIGNMENT_DATE_RANGE_MESSAGE,
  assignmentDateRangeError,
} from "../assignmentDateRange.js";

assert.equal(
  assignmentDateRangeError("2031-11-30", "2031-11-26"),
  ASSIGNMENT_DATE_RANGE_MESSAGE,
  "a later start date must be blocked before any assignment write",
);
assert.equal(
  assignmentDateRangeError("2031-11-26", "2031-11-26"),
  null,
  "a same-day assignment is valid",
);
assert.equal(
  assignmentDateRangeError("2031-11-25", "2031-11-26"),
  null,
  "a forward range is valid",
);
assert.equal(
  assignmentDateRangeError("", "2031-11-26"),
  null,
  "incomplete drafts retain existing required-field behavior",
);

const hookSource = readFileSync(
  new URL("../../hooks/useAssignMemberCascade.ts", import.meta.url),
  "utf8",
);
const submitStart = hookSource.indexOf("async function submit()");
const dateGuardAt = hookSource.indexOf("assignmentDateRangeError(effectiveStart, effectiveEnd)", submitStart);
const firstWriteAt = hookSource.indexOf("await persistDirectWeeklyHours()", submitStart);
assert.ok(dateGuardAt >= submitStart, "the shared assignment submit must call the date-order guard");
assert.ok(
  firstWriteAt >= 0 && dateGuardAt < firstWriteAt,
  "the date-order guard must run before the retry/weekly write paths",
);

console.log("assignmentDateRange: all assertions passed");