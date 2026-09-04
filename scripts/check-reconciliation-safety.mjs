#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildReplacementSql,
  buildStageSql,
} from "./lib/reconciliation-sql.mjs";

const source = fs.readFileSync(
  new URL("./reconcile-aws-drift.mjs", import.meta.url),
  "utf8",
);
const wrapper = fs.readFileSync(
  new URL("./run-aws-reconciliation.sh", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /if \(!verifyOnly && !serverSideCopy\)[\s\S]*MIGRATION_SERVER_SIDE_COPY=true/,
  "write-mode reconciliation must fail closed unless native staging is enabled",
);
assert.doesNotMatch(
  source,
  /function replaceRows\(/,
  "the lossy client-batched replacement path must not exist",
);
assert.doesNotMatch(
  source,
  /CONVERT\(nvarchar\(60\), \$\{ref\}, 121\)/,
  "temporal values must not be converted through style-121 strings",
);
assert.match(
  source,
  /buildStageSql\(/,
  "staging must copy source columns with native SQL Server types",
);
assert.match(
  source,
  /is_disabled = 1 OR is_not_trusted = 1/,
  "replacement must verify constraint state before commit",
);
assert.match(
  wrapper,
  /MIGRATION_SERVER_SIDE_COPY="\$\{MIGRATION_SERVER_SIDE_COPY:-true\}"/,
  "the operational wrapper must default write-mode reconciliation to staging",
);

const quoteId = (name) => `[${String(name).replaceAll("]", "]]")}]`;
const temporalColumns = [
  "EmptyTableId",
  "Datetime2Value",
  "TimeValue",
  "DatetimeOffsetValue",
  "BinaryValue",
];
const stageSql = buildStageSql({
  stage: "dbo.[__stage]",
  sourceTable: "[source].[core2].[dbo].[TemporalFixture]",
  columnNames: temporalColumns,
  quoteId,
});
for (const column of temporalColumns) {
  assert.match(stageSql, new RegExp(`\\[${column}\\]`));
}
assert.doesNotMatch(
  stageSql,
  /\b(?:CONVERT|CAST)\s*\(/i,
  "datetime2, time, datetimeoffset, and binary columns must stage natively",
);

const emptyReplacementSql = buildReplacementSql({
  qTable: "[dbo].[EmptyFixture]",
  stage: "dbo.[__empty_stage]",
  columnNames: ["EmptyTableId"],
  hasIdentity: false,
  quoteId,
});
assert.ok(
  emptyReplacementSql.indexOf("WITH CHECK CHECK CONSTRAINT ALL") >
    emptyReplacementSql.indexOf("SELECT [EmptyTableId] FROM dbo.[__empty_stage]"),
  "empty-table replacement must re-enable and trust constraints unconditionally",
);

console.log(
  "Reconciliation safety check passed: native staging required, temporal values preserved, constraints verified.",
);