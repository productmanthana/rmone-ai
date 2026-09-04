/**
 * Regression coverage for the read-only cross-tenant allocation integrity scan.
 *
 * In addition to impossible hours and zero-hour legacy rows, the nightly scan
 * must detect the exact stale-total conflict that once blocked a valid weekly
 * replacement: AllocationHour=4 with PctAllocation=602.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classifyAllocationJunkValues } from "../allocation-integrity-scan.js";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${(error as Error).message}`);
    failed++;
  }
}

console.log("\nA) Allocation integrity signatures");

test("valid 4h week paired with stale 602h total is S3", () => {
  assert.equal(classifyAllocationJunkValues({
    assigned: true,
    allocationHour: 4,
    pctAllocation: 602,
    physicalCap: 168,
    inclusiveSpanDays: 7,
  }), "S3");
});

test("explicit zero paired with stale 602h total remains S1", () => {
  assert.equal(classifyAllocationJunkValues({
    assigned: true,
    allocationHour: 0,
    pctAllocation: 602,
    physicalCap: 168,
    inclusiveSpanDays: 7,
  }), "S1");
});

test("physically impossible weekly hours remain S2", () => {
  assert.equal(classifyAllocationJunkValues({
    assigned: true,
    allocationHour: 169,
    pctAllocation: 169,
    physicalCap: 168,
    inclusiveSpanDays: 7,
  }), "S2");
});

test("matching valid weekly fields are not findings", () => {
  assert.equal(classifyAllocationJunkValues({
    assigned: true,
    allocationHour: 4,
    pctAllocation: 4,
    physicalCap: 168,
    inclusiveSpanDays: 7,
  }), null);
});

test("open-demand rows are never flagged", () => {
  assert.equal(classifyAllocationJunkValues({
    assigned: false,
    allocationHour: 4,
    pctAllocation: 602,
    physicalCap: 168,
    inclusiveSpanDays: 7,
  }), null);
});

test("long assignment containers are not mislabeled as weekly S3 rows", () => {
  assert.equal(classifyAllocationJunkValues({
    assigned: true,
    allocationHour: 4,
    pctAllocation: 602,
    physicalCap: 720,
    inclusiveSpanDays: 30,
  }), null);
});

console.log("\nB) Nightly SQL wiring");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scanSource = readFileSync(
  path.resolve(__dirname, "../allocation-integrity-scan.ts"),
  "utf8",
);

test("row query includes the positive-hour stale-total signature", () => {
  const matches = scanSource.match(/hrs\s*>\s*0\s+AND\s+hrs\s*<=\s*168\s+AND\s+pct\s*>\s*168/gi) ?? [];
  assert.ok(
    matches.length >= 3,
    "S3 must appear in classification, row filtering, and exact per-tenant counting",
  );
});

test("S3 SQL is limited to real one-through-seven-day rows", () => {
  const matches = scanSource.match(/DATEDIFF\(day,\s*s,\s*e\)\s+BETWEEN\s+0\s+AND\s+6/gi) ?? [];
  assert.ok(
    matches.length >= 3,
    "S3 classification and both count filters must exclude long containers",
  );
});

test("S3 is parsed into the public finding result", () => {
  assert.match(scanSource, /String\(row\.signature\)\s*===\s*"S3"/);
});

if (failed > 0) {
  console.error(`\n${failed} allocation integrity scan test(s) failed.`);
  process.exit(1);
}
console.log(`\n✓ All ${passed} allocation integrity scan tests passed.`);