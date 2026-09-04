// Guards the alias-resolution financial classification (security).
//
// updateRecordFieldsRds resolves submitted field names through fieldKind():
// ANY name containing "value" writes the ContractValue column, "approx" →
// ApproxContractValue, "labor" → LaborContractAmount, "nonoperating" →
// NonOperatingCost. Gates keyed on the exact FINANCIAL_FIELD_NAMES set alone
// can therefore be bypassed with an alias that still writes — and, via the
// audit trail's OldValue capture, DISCLOSES — financial data.
//
// This check fails when:
//   1. isFinancialFieldName stops classifying the alias forms,
//   2. a route gate regresses to the raw exact-name set,
//   3. audit read-time redaction loses its alias-aware branch, or
//   4. provider audit entries stop canonicalizing financial column names.
import { readFileSync } from "node:fs";
import { isFinancialFieldName, splitFinancialFields } from "../src/lib/financial-fields.js";

let failed = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { failed++; console.error(`  FAIL ${msg}`); }
};

// 1) Aliases that fieldKind() resolves to financial columns classify financial.
for (const alias of [
  "value", "Value", "TheValue", "approx", "Approx Value", "labor", "LaborTotal",
  "NonOperating", "non-operating cost", "ForecastedProjectCost",
  "ContractValue", "ApproxContractValue", "LaborContractAmount",
]) {
  ok(isFinancialFieldName(alias), `financial: "${alias}"`);
}

// 2) Names that resolve to NON-financial columns stay non-financial —
//    fieldKind precedence: "StatusValue" is a STATUS field, not ContractValue.
for (const name of ["State", "City", "Office", "Status", "StatusValue", "SectorValue", "ProjectType", "Department", "Division", "Title"]) {
  ok(!isFinancialFieldName(name), `non-financial: "${name}"`);
}

// 3) splitFinancialFields carries the alias classification into write gates.
const split = splitFinancialFields([{ FieldName: "value" }, { FieldName: "State" }]);
ok(split.hasFinancial && split.hasNonFinancial, "splitFinancialFields sees alias 'value' as financial");

// 4) Route gates must not regress to the raw exact-name set.
const proxy = readFileSync(new URL("../src/routes/rmone-proxy.ts", import.meta.url), "utf8");
ok(!/FINANCIAL_FIELD_NAMES\.has\(/.test(proxy), "rmone-proxy classifies via isFinancialFieldName, not the raw exact-name set");

// 5) Audit read-time redaction keeps the alias-aware branch (legacy rows
//    stored under client aliases must still redact).
const audit = readFileSync(new URL("../src/lib/auditTrail.ts", import.meta.url), "utf8");
ok(/isFinancialFieldName/.test(audit), "auditTrail read-time redaction is alias-aware");

// 6) Provider audit entries store canonical financial column names.
const provider = readFileSync(new URL("../src/lib/rds-provider.ts", import.meta.url), "utf8");
ok(/isFinancialFieldName\(col\)/.test(provider), "provider audit entries canonicalize financial column names");

if (failed) {
  console.error(`check-financial-alias: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("check-financial-alias: all assertions passed");
