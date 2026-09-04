import { strict as assert } from "node:assert";
import { fmtHours, fmtNumber, fmtPct } from "../utils";

assert.equal(fmtNumber(2626.9999999999999), "2,627");
assert.equal(fmtHours(6267.3300000000043), "6,267.33");
assert.equal(fmtHours(40.5), "40.5");
assert.equal(fmtPct(99.99999999999999), "100%");
assert.equal(fmtNumber("not-a-number"), "—");

console.log("numberFormat: display values stay finite and cap at two decimals");