import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ASSIGNMENT_DATE_RANGE_MESSAGE,
  assignmentDateRangeError,
} from "../assignment-date-range.js";

assert.equal(
  assignmentDateRangeError("2031-11-30", "2031-11-26"),
  ASSIGNMENT_DATE_RANGE_MESSAGE,
  "the server boundary rejects a bypassed client with a reversed date range",
);
assert.equal(
  assignmentDateRangeError("2031-11-26", "2031-11-26"),
  null,
  "same-day ranges remain legal",
);
assert.equal(assignmentDateRangeError("2031-11-25", "2031-11-26"), null);

const providerSource = readFileSync(
  new URL("../rds-provider.ts", import.meta.url),
  "utf8",
);
const providerStart = providerSource.indexOf("export async function assignResourceRds");
const providerGuardAt = providerSource.indexOf("assignmentDateRangeError(", providerStart);
const poolAt = providerSource.indexOf("const pool = await getPool()", providerStart);
assert.ok(providerGuardAt >= providerStart, "assignResourceRds must enforce the server-side date-order guard");
assert.ok(
  poolAt >= 0 && providerGuardAt < poolAt,
  "the API must reject reversed dates before opening the write path",
);

console.log("assignmentDateRange: all assertions passed");