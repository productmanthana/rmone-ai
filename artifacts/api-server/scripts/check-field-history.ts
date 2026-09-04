/**
 * Contract-value field-history ledger unit check (#724).
 *
 * Guards the pure invariants the RMOneFieldHistory ledger depends on —
 * the parts that, if silently broken, would either flood the trail with
 * phantom rows or hide real changes:
 *
 *   1. normalizeMoneyValue mirrors the updateRecordFieldsRds numeric
 *      binding EXACTLY ($ , whitespace stripped; blank/junk → null;
 *      Decimal(18,2) rounding; trailing zeros trimmed) — the write
 *      capture, the pre-UPDATE old-value read, and the import snapshot
 *      all normalize through it, so echo detection compares like with
 *      like. If it drifted from the binding, every save would look like
 *      a change (or none would).
 *   2. isEchoValueChange: an unchanged save is NEVER recorded, and
 *      blank → 0 IS a change (blank and $0 are different facts).
 *   3. diffFieldSnapshots (import snapshot+diff): new records' initial
 *      values are NOT changes; unchanged values produce no rows; real
 *      changes carry old → new with source "import"; deleted-before
 *      records produce nothing.
 *
 * Run: pnpm --filter @workspace/api-server run check:field-history
 */
import {
  normalizeMoneyValue,
  isEchoValueChange,
  diffFieldSnapshots,
  isLedgeredValueColumn,
  LEDGERED_VALUE_COLUMNS,
  type FieldSnapshot,
} from "../src/lib/fieldHistory.js";

const failures: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  check(name, Object.is(got, want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

console.log("normalizeMoneyValue — canonical money form");
eq("strips $ and commas", normalizeMoneyValue("$1,500,000"), "1500000");
eq("strips inner whitespace", normalizeMoneyValue(" 1 500 000 "), "1500000");
eq("keeps meaningful decimals", normalizeMoneyValue("1500000.50"), "1500000.5");
eq("rounds to 2dp like Decimal(18,2)", normalizeMoneyValue("100.456"), "100.46");
eq("trims .00", normalizeMoneyValue("100.00"), "100");
eq("blank → null", normalizeMoneyValue(""), null);
eq("whitespace-only → null", normalizeMoneyValue("   "), null);
eq("null → null", normalizeMoneyValue(null), null);
eq("undefined → null", normalizeMoneyValue(undefined), null);
eq("junk → null", normalizeMoneyValue("abc"), null);
eq("zero stays zero (≠ blank)", normalizeMoneyValue("0"), "0");
eq("negative kept", normalizeMoneyValue("-250.10"), "-250.1");
eq("number input accepted", normalizeMoneyValue(326000), "326000");
// The DB holds quintillion-scale junk — toFixed would return exponential
// notation at ≥1e21, so huge magnitudes fall back to String(n).
eq("huge magnitude safe", normalizeMoneyValue(1e18), String(1e18));

console.log("isEchoValueChange — unchanged saves are never recorded");
check("same value, different formatting = echo", isEchoValueChange("1500000", "$1,500,000"));
check("trailing-zero variants = echo", isEchoValueChange("100", "100.00"));
check("null vs null = echo", isEchoValueChange(null, null));
check("null vs blank-string = echo", isEchoValueChange(null, ""));
check("real change is NOT echo", !isEchoValueChange("1500000", "150000"));
check("blank → 0 is a CHANGE", !isEchoValueChange(null, "0"));
check("0 → blank is a CHANGE", !isEchoValueChange("0", null));

console.log("diffFieldSnapshots — import snapshot+diff contract");
const before: FieldSnapshot = new Map([
  ["PMM|pmm-001|ContractValue", "1500000"],
  ["PMM|pmm-001|LaborContractAmount", null],
  ["PMM|pmm-001|ForecastedProjectCost", "900000"],
  ["PMM|pmm-001|NonOperatingCost", "12500"],
  ["OPM|opm-002|ApproxContractValue", "80000"],
  ["LEM|lem-003|ContractValue", "500"],           // record deleted by import
]);
const after: FieldSnapshot = new Map([
  ["PMM|pmm-001|ContractValue", "150000"],         // changed
  ["PMM|pmm-001|LaborContractAmount", null],       // unchanged (both null)
  ["PMM|pmm-001|ForecastedProjectCost", "900000"], // unchanged
  ["PMM|pmm-001|NonOperatingCost", "10000"],      // changed
  ["OPM|opm-002|ApproxContractValue", "80000"],    // unchanged
  ["PMM|pmm-999|ContractValue", "42000"],          // NEW record → not a change
]);
const changes = diffFieldSnapshots("tenant-1", before, after);
eq("exactly two change rows", changes.length, 2);
const c = changes[0];
check("change row shape", !!c
  && c.module === "PMM"
  && c.ticketId === "PMM-001"          // ticket restored to upper case
  && c.fieldName === "ContractValue"
  && c.oldValue === "1500000"
  && c.newValue === "150000"
  && c.source === "import"
  && c.tenantId === "tenant-1",
  JSON.stringify(c));
const costChange = changes.find((x) => x.fieldName === "NonOperatingCost");
check("Budget-card cost change row shape", !!costChange
  && costChange.oldValue === "12500"
  && costChange.newValue === "10000"
  && costChange.source === "import",
  JSON.stringify(costChange));
const cleared = diffFieldSnapshots("t", new Map([["LEM|x|ContractValue", "10"]]), new Map([["LEM|x|ContractValue", null]]));
check("value cleared → row with null newValue", cleared.length === 1 && cleared[0].newValue === null && cleared[0].oldValue === "10");

console.log("ledgered columns");
check("all six landing columns ledgered",
  ([
    "ContractValue", "ApproxContractValue", "ProjectValue", "LaborContractAmount",
    "ForecastedProjectCost", "NonOperatingCost",
  ] as const)
    .every((col) => (LEDGERED_VALUE_COLUMNS as readonly string[]).includes(col) && isLedgeredValueColumn(col)));
check("case-insensitive column match", isLedgeredValueColumn("contractvalue"));
check("non-financial column NOT ledgered", !isLedgeredValueColumn("Status") && !isLedgeredValueColumn("Title"));

console.log("actor wiring — every user-attributed ledger write carries username");
// Regression guard for the "Unknown user" class of bug: a save path that
// builds an inline actor ({ userId, ... }) for updateRecordFieldsRds — or for
// a wrapper that funnels into it (updateProjectDivisionRolesRds) — MUST also
// thread `username`, or its RMOneFieldHistory rows land with changedBy=null
// and the trail shows "Unknown user". autoStatus-only calls (no userId) are
// exempt by design: they are recorded as source "auto" / "System (automatic)".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const SCAN_FILES = [
  "../src/routes/rmone-proxy.ts",
  "../src/routes/decision.ts",
  "../src/routes/chat.ts",
  "../src/lib/rds-provider.ts",
];
const LEDGER_CALLS = ["updateRecordFieldsRds(", "updateProjectDivisionRolesRds("];
function callSpans(src: string, needle: string): { at: number; text: string }[] {
  const spans: { at: number; text: string }[] = [];
  let i = src.indexOf(needle);
  while (i !== -1) {
    let depth = 0;
    let j = i + needle.length - 1; // index of the opening "("
    for (; j < src.length; j++) {
      const ch = src[j];
      if (ch === "(") depth++;
      else if (ch === ")") { depth--; if (depth === 0) break; }
    }
    spans.push({ at: i, text: src.slice(i, j + 1) });
    i = src.indexOf(needle, i + needle.length);
  }
  return spans;
}
for (const rel of SCAN_FILES) {
  const file = path.join(here, rel);
  const src = readFileSync(file, "utf8");
  for (const needle of LEDGER_CALLS) {
    for (const span of callSpans(src, needle)) {
      // Function DEFINITIONS have the name preceded by "function "; skip them.
      const before = src.slice(Math.max(0, span.at - 20), span.at);
      if (/function\s+$/.test(before)) continue;
      if (!span.text.includes("userId")) continue; // auto/no-actor call — exempt
      const line = src.slice(0, span.at).split("\n").length;
      check(
        `${rel.replace("../src/", "")}:${line} ${needle.slice(0, -1)} actor carries username`,
        span.text.includes("username"),
        `inline actor with userId but NO username — ledger rows would show "Unknown user"`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} field-history check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll field-history checks passed.");
