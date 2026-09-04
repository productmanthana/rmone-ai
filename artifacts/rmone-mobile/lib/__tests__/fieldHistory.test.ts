/**
 * Regression coverage for mobile financial value history:
 * - the protected API response is preserved on success
 * - denied/unavailable requests stay distinguishable from an empty history
 * - only financial editors see PMM, Opportunity, and Lead history affordances
 * - the native presentation keeps source labels, local time, blank values, and
 *   exact/compact currency formatting intact
 */

import assert from "node:assert/strict";
import { getRecordFieldHistory } from "../api.js";
import {
  canShowFinancialHistory,
  FIELD_HISTORY_LABELS,
  formatHistoryDate,
  formatHistoryValue,
  historyActor,
  historySourceBadge,
} from "../fieldHistory.js";
import { canOpenRecordEditModal } from "../recordPermissions.js";

let passed = 0;
let failed = 0;
let testQueue = Promise.resolve();

/** Tests are queued so output remains deterministic and easy to scan in CI. */
function test(name: string, fn: () => void | Promise<void>): void {
  testQueue = testQueue.then(async () => {
    try {
      await fn();
      console.log(`  ✓  ${name}`);
      passed++;
    } catch (error: unknown) {
      console.error(`  ✗  ${name}`);
      console.error(`     ${(error as Error).message}`);
      failed++;
    }
  });
}

const historyRows = [{
  fieldName: "ContractValue",
  oldValue: null,
  newValue: "1250000",
  changedAt: "2026-01-01T01:30:00.000Z",
  changedBy: "A. Editor",
  source: "user",
}];

async function withFetch(
  responseOrError: Response | Error,
  assertion: (response: unknown) => void,
): Promise<void> {
  const result = await getRecordFieldHistory("PMM/quoted record", {
    base: "https://mobile.test",
    headers: { Authorization: "Bearer test-token" },
    fetcher: async () => {
      if (responseOrError instanceof Error) throw responseOrError;
      return responseOrError;
    },
  });
  assertion(result);
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

console.log("\nA) Protected API response contract");
test("returns successful history rows and encodes the record query", async () => {
  let requestedUrl = "";
  let requestedHeaders: HeadersInit | undefined;
  const result = await getRecordFieldHistory("PMM/quoted record", {
    base: "https://mobile.test",
    headers: { Authorization: "Bearer test-token" },
    fetcher: async (url, options) => {
      requestedUrl = url;
      requestedHeaders = options?.headers;
      return response(200, { rows: historyRows, truncated: true });
    },
  });
  assert.deepEqual(result, { rows: historyRows, truncated: true });
  assert.match(requestedUrl, /\/api\/rmone\/record-field-history\?record=PMM%2Fquoted%20record/);
  assert.deepEqual(requestedHeaders, { Authorization: "Bearer test-token" });
});

test("returns null for a denied response instead of an empty history", async () => {
  await withFetch(response(403, { error: "Financial history access denied" }), (result) => {
    assert.equal(result, null);
  });
});

test("returns null for an unavailable response instead of an empty history", async () => {
  await withFetch(response(503, { apiUnavailable: true }), (result) => {
    assert.equal(result, null);
  });
});

test("returns null for a network failure instead of an empty history", async () => {
  await withFetch(new Error("network unavailable"), (result) => {
    assert.equal(result, null);
  });
});

console.log("\nB) Financial-editor affordance gates");
for (const module of ["PMM", "OPM", "LEM"]) {
  test(`${module} record details expose history only to financial editors`, () => {
    assert.equal(canShowFinancialHistory(module, true), true);
    assert.equal(canShowFinancialHistory(module, false), false);
  });
}

test("non-financial record modules do not expose financial history affordances", () => {
  assert.equal(canShowFinancialHistory("COM", true), false);
  assert.equal(canShowFinancialHistory("CON", true), false);
});

test("financial-only record access still opens financial editors", () => {
  const financialOnly = { canEditData: false, canEditFinancials: true };
  assert.equal(canOpenRecordEditModal("ContractValue", financialOnly), true);
  assert.equal(canOpenRecordEditModal("LaborContractAmount", financialOnly), true);
  assert.equal(canOpenRecordEditModal("SectorChoice", financialOnly), false);
  assert.equal(canOpenRecordEditModal("CRMProjectStatusChoice", financialOnly), false);
});

console.log("\nC) History presentation");
test("keeps canonical labels for contract and labor values", () => {
  assert.equal(FIELD_HISTORY_LABELS.ContractValue, "Contract Value");
  assert.equal(FIELD_HISTORY_LABELS.LaborContractAmount, "Labor Contract");
});

test("shows import and automatic source badges and fallback actors", () => {
  assert.equal(historySourceBadge("import"), "File import");
  assert.equal(historyActor(null, "import"), "File import");
  assert.equal(historySourceBadge("auto"), "System (automatic)");
  assert.equal(historyActor(null, "auto"), "System (automatic)");
  assert.equal(historySourceBadge("user"), null);
  assert.equal(historyActor("A. Editor", "user"), "A. Editor");
  assert.equal(historyActor(null, "user"), "Unknown user");
});

test("renders blank values and exact sub-billion dollar values", () => {
  assert.equal(formatHistoryValue(null), "blank");
  assert.equal(formatHistoryValue(""), "blank");
  assert.equal(formatHistoryValue("1250000"), "$1,250,000");
  assert.equal(formatHistoryValue("1234.567"), "$1,234.57");
});

test("renders billion-plus values with the shared compact dollar tiers", () => {
  assert.equal(formatHistoryValue("1000000000"), "$1B");
  assert.equal(formatHistoryValue("1250000000"), "$1.3B");
  assert.equal(formatHistoryValue("2200000000000000000"), "$2.2Qi");
  assert.equal(formatHistoryValue("-1250000000"), "-$1.3B");
});

test("formats timestamps in the device-local time zone", () => {
  const local = formatHistoryDate("2026-01-01T01:30:00.000Z");
  assert.match(local, /Dec 31, 2025/);
  assert.match(local, /8:30 PM/);
});

void testQueue.then(() => {
  console.log(`\n${"─".repeat(60)}`);
  if (failed === 0) {
    console.log(`✓ All ${passed} tests passed.`);
  } else {
    console.log(`${passed} passed, ${failed} FAILED.`);
    process.exit(1);
  }
});