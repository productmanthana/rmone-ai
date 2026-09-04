/**
 * Executive Forecast export — wording + content contract.
 *
 * The client's requirement: the exported file must carry the exact on-page
 * column wording, BOTH unit families (Hours and Cost ($)) regardless of the
 * page's unit toggle, the "As of" week, and the rows in the page's current
 * filtered + sorted order. The disclosure chips (substituted /
 * reconstructed) ride along with their exact on-page wording.
 */

import { strict as assert } from "node:assert";
import {
  buildExecForecastCsvText, EXEC_FORECAST_EXPORT_COLUMNS,
  type ExecForecastExportRow,
} from "../exportExecForecast";
import type { AfOverviewProject } from "../api";

/* ── fixtures ─────────────────────────────────────────────────────────── */

function proj(overrides: Partial<AfOverviewProject> & { ticket: string }): AfOverviewProject {
  return {
    weekMonday: "2026-08-24",
    actualHoursTd: 0, forecastRemainingHours: 0, forecastTotalHours: 0, forecastHoursTd: 0,
    actualCostTd: 0, forecastRemainingCost: 0, forecastTotalCost: 0, forecastCostTd: 0,
    actualBillTd: 0, forecastRemainingBill: 0, forecastTotalBill: 0, forecastBillTd: 0,
    hoursVariance: 0, costVariance: 0, billVariance: 0,
    substitutedHours: 0, unratedActualHours: 0,
    final: false, backfilled: false, computedAt: null,
    ...overrides,
  };
}

const rowA: ExecForecastExportRow = {
  project: proj({
    ticket: "PMM-101",
    actualHoursTd: 120.5, forecastRemainingHours: 79.5, forecastTotalHours: 200, forecastHoursTd: 130,
    actualCostTd: 10000.257, forecastRemainingCost: 4999.75, forecastTotalCost: 15000.007, forecastCostTd: 11000,
    hoursVariance: 9.5, costVariance: 999.743,
    substitutedHours: 3, backfilled: true,
  }),
  title: 'Harbor "North", Phase 2',
};

const rowB: ExecForecastExportRow = {
  project: proj({ ticket: "OPM-7", weekMonday: "2026-08-17" }),
  title: "",
};

/* ── header wording: exact on-page column names, both unit families ───── */

assert.deepEqual(
  EXEC_FORECAST_EXPORT_COLUMNS.map((c) => c.header),
  [
    "Project",
    "Title",
    "Actual to Date — Hours",
    "Actual to Date — Cost ($)",
    "Remaining Forecast — Hours",
    "Remaining Forecast — Cost ($)",
    "Forecast at Completion — Hours",
    "Forecast at Completion — Cost ($)",
    "Hours Variance",
    "Cost Variance",
    "% Used — Hours",
    "% Used — Cost ($)",
    "As of",
    "Flags",
  ],
  "export headers must use the exact on-page wording with both unit families and the As of column",
);

/* ── CSV content ──────────────────────────────────────────────────────── */

const csv = buildExecForecastCsvText([rowA, rowB]);
const lines = csv.split("\n");

assert.equal(lines.length, 3, "header + one line per row");

assert.equal(
  lines[0],
  '"Project","Title","Actual to Date — Hours","Actual to Date — Cost ($)","Remaining Forecast — Hours",'
  + '"Remaining Forecast — Cost ($)","Forecast at Completion — Hours","Forecast at Completion — Cost ($)",'
  + '"Hours Variance","Cost Variance","% Used — Hours","% Used — Cost ($)","As of","Flags"',
  "CSV header row",
);

/* Row A: quote escaping, round2 numbers, % used in both families,
 * both disclosure chips with exact on-page wording. */
assert.equal(
  lines[1],
  '"PMM-101","Harbor ""North"", Phase 2",120.5,10000.26,79.5,4999.75,200,15000.01,9.5,999.74,60.25,66.67,'
  + '"2026-08-24","substituted, reconstructed"',
  "row A values (hours AND dollars, rounded, escaped, flagged)",
);

/* Row B: zero FAC → % Used not computable → blank (on-page "—"); no flags. */
assert.equal(
  lines[2],
  '"OPM-7",,0,0,0,0,0,0,0,0,,,"2026-08-17",',
  "row B: blank title, blank % Used when FAC is 0, no flags",
);

/* ── row order is preserved exactly as the page passes it ─────────────── */

const reversed = buildExecForecastCsvText([rowB, rowA]).split("\n");
assert.ok(reversed[1].startsWith('"OPM-7"'), "first passed row exports first");
assert.ok(reversed[2].startsWith('"PMM-101"'), "second passed row exports second");

/* ── flags follow the on-page chip logic (> 0 hours, backfilled) ──────── */

const subOnly = buildExecForecastCsvText([
  { project: proj({ ticket: "PMM-2", substitutedHours: 0.5 }), title: "" },
]).split("\n")[1];
assert.ok(subOnly.endsWith(',"substituted"'), "substituted chip appears alone when only substituted");

const backOnly = buildExecForecastCsvText([
  { project: proj({ ticket: "PMM-3", backfilled: true }), title: "" },
]).split("\n")[1];
assert.ok(backOnly.endsWith(',"reconstructed"'), "reconstructed chip appears alone when only backfilled");

/* ── % Used mirrors the page's shared clamped math (execPctUsed) ──────
 * A project burned past its forecast shows 100% on the page; the export
 * must say the same, in BOTH unit families, or the file contradicts the
 * screen it came from. */

const burned = buildExecForecastCsvText([
  {
    project: proj({
      ticket: "PMM-5",
      actualHoursTd: 250, forecastTotalHours: 200,
      actualCostTd: 30000, forecastTotalCost: 20000,
    }),
    title: "",
  },
]).split("\n")[1];
assert.ok(burned.includes(",100,100,"), `% Used clamps at 100 like the page, got ${burned}`);

/* ── formula-injection hardening: untrusted text cells are inert ──────── */

const hostile = [
  '=HYPERLINK("http://evil.example","open")',
  "+1+2",
  "-2+3",
  "@SUM(A1:A9)",
  "\tcmd",
  "\rcmd",
];
for (const title of hostile) {
  const line = buildExecForecastCsvText([
    { project: proj({ ticket: "PMM-9" }), title },
  ]).split("\n")[1];
  const titleCell = line.split(",")[1];
  assert.ok(
    titleCell.startsWith(`"'`),
    `hostile title ${JSON.stringify(title)} must be neutralized with a leading apostrophe, got ${titleCell}`,
  );
}

/* Hostile TICKET is neutralized too (first cell of the line). */
const hostileTicket = buildExecForecastCsvText([
  { project: proj({ ticket: "=1+1" }), title: "" },
]).split("\n")[1];
assert.ok(hostileTicket.startsWith(`"'=1+1"`), "hostile ticket must be neutralized");

/* Benign text is NOT altered — no stray apostrophes on normal values. */
const benign = buildExecForecastCsvText([
  { project: proj({ ticket: "PMM-101" }), title: "Harbor Phase 2" },
]).split("\n")[1];
assert.ok(benign.startsWith('"PMM-101","Harbor Phase 2"'), "benign text cells stay verbatim");

/* Negative NUMBERS are numeric cells, never apostrophe-prefixed — pasting
 * into a workbook must keep unfavorable variances as real numbers. */
const negative = buildExecForecastCsvText([
  { project: proj({ ticket: "PMM-4", hoursVariance: -4.25, costVariance: -1200.5 }), title: "" },
]).split("\n")[1];
assert.ok(negative.includes(",-4.25,-1200.5,"), `negative variances stay raw numbers, got ${negative}`);
assert.ok(!negative.includes("'-"), "numeric cells are never apostrophe-prefixed");

console.log("execForecastExport.test.ts — all assertions passed");
