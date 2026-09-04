import assert from "node:assert/strict";
import {
  findAfSnapshotIntegrityIssues,
  type AfSnapshotIntegrityRow,
} from "../actuals-forecast-integrity.js";

const valid: AfSnapshotIntegrityRow = {
  tenant_id: "tenant-1",
  ticket_id: "PRJ-1",
  week_monday: "2026-08-03",
  actual_hours_td: 2,
  forecast_remaining_hours: 8,
  forecast_total_hours: 10,
  forecast_hours_td: 4,
  hours_variance: 2,
  actual_cost_td: 100,
  forecast_remaining_cost: 400,
  forecast_total_cost: 500,
  forecast_cost_td: 250,
  cost_variance: 150,
  actual_bill_td: 200,
  forecast_remaining_bill: 800,
  forecast_total_bill: 1000,
  forecast_bill_td: 500,
  bill_variance: 300,
};

assert.deepEqual(findAfSnapshotIntegrityIssues([valid]), []);

// A delta exactly at epsilon is accepted; a larger delta is not.
assert.deepEqual(
  findAfSnapshotIntegrityIssues([
    { ...valid, forecast_total_hours: 10.01 },
  ]),
  [],
);
const overEpsilon = findAfSnapshotIntegrityIssues([
  { ...valid, forecast_total_hours: 10.011 },
]);
assert.equal(overEpsilon.length, 1);
assert.deepEqual(overEpsilon[0]?.metrics[0]?.violations, ["total_identity"]);

// All three families are checked independently, and one row reports all
// affected families rather than hiding later violations behind the first one.
const allFamilies = findAfSnapshotIntegrityIssues([
  {
    ...valid,
    forecast_total_hours: 11,
    forecast_cost_td: 260,
    forecast_remaining_bill: -1,
  },
]);
assert.equal(allFamilies.length, 1);
assert.deepEqual(
  allFamilies[0]?.metrics.map((metric) => [metric.metric, metric.violations]),
  [
    ["hours", ["total_identity"]],
    ["cost", ["variance_identity"]],
    ["bill", ["total_identity", "negative_remaining"]],
  ],
);

// Non-finite values are reported rather than silently coerced to zero.
const nonFinite = findAfSnapshotIntegrityIssues([
  { ...valid, actual_cost_td: "not-a-number" },
]);
assert.deepEqual(nonFinite[0]?.metrics[0]?.violations, ["non_finite"]);
const missingValue = findAfSnapshotIntegrityIssues([
  { ...valid, actual_cost_td: null },
]);
assert.deepEqual(missingValue[0]?.metrics[0]?.violations, ["non_finite"]);

assert.throws(
  () => findAfSnapshotIntegrityIssues([valid], -0.01),
  /finite non-negative/,
);

console.log("actualsForecastIntegrity.test.ts: all assertions passed");