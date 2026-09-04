/**
 * Unit tests for the unassigned-placeholder division restore logic (CI gate).
 * Run: npx tsx scripts/check-unassigned-placeholder-div.ts
 *
 * These tests exercise the two pure helper functions extracted from the pipeline
 * org pre-pass:
 *
 *   isUnassignedPlaceholderDivName(name, tenantLabel)
 *     – decides which division names trigger the probe query.
 *
 *   resolveUnassignedPlaceholderDivAction(found)
 *     – given the DB probe result, returns whether to use-live / restore /
 *       create-new without touching real SQL.
 *
 * Scenarios covered (per code-review requirements):
 *   1. Soft-deleted "Unassigned" row → action = "restore", id preserved
 *   2. Live "Unassigned" row → action = "use-live", id preserved
 *   3. No row at all → action = "create-new" (new placeholder created as before)
 *   4. BU with multiple live divisions, no matching "Unassigned" placeholder
 *      → name not an unassigned pattern → no interference (isUnassignedPlaceholderDivName = false)
 *   5. Custom tenant unassigned label (not literally "Unassigned") → matched correctly
 *   6. Whitespace / case variations → treated as matching
 */

import assert from "node:assert/strict";
import {
  isUnassignedPlaceholderDivName,
  resolveUnassignedPlaceholderDivAction,
} from "../src/lib/pipeline.js";

let passed = 0;
let failed = 0;

function test(label: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓  ${label}`);
  } catch (e: unknown) {
    failed++;
    console.error(`  ✗  ${label}`);
    console.error(`     ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// isUnassignedPlaceholderDivName
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nisUnassignedPlaceholderDivName");

test("literal 'Unassigned' matches with default label", () => {
  assert.equal(isUnassignedPlaceholderDivName("Unassigned", "Unassigned"), true);
});

test("case-insensitive: 'unassigned' matches", () => {
  assert.equal(isUnassignedPlaceholderDivName("unassigned", "Unassigned"), true);
});

test("case-insensitive: 'UNASSIGNED' matches", () => {
  assert.equal(isUnassignedPlaceholderDivName("UNASSIGNED", "Unassigned"), true);
});

test("custom tenant label matches when name equals label", () => {
  // Tenant with unassignedLabel = "Not Assigned"
  assert.equal(isUnassignedPlaceholderDivName("Not Assigned", "Not Assigned"), true);
});

test("custom tenant label matches case-insensitively", () => {
  assert.equal(isUnassignedPlaceholderDivName("not assigned", "Not Assigned"), true);
});

test("literal 'Unassigned' still matches even when custom label differs", () => {
  // "Unassigned" is always treated as a placeholder regardless of custom label.
  assert.equal(isUnassignedPlaceholderDivName("Unassigned", "Not Assigned"), true);
});

test("a real division name does NOT match — no interference", () => {
  // BU has divisions "Architecture" and "Engineering"; neither is the placeholder.
  assert.equal(isUnassignedPlaceholderDivName("Architecture", "Unassigned"), false);
  assert.equal(isUnassignedPlaceholderDivName("Engineering",  "Unassigned"), false);
});

test("renamed placeholder ('cold s') does NOT match — not treated as placeholder", () => {
  // User renamed "Unassigned" → "cold s". "cold s" is a real division name now.
  // The pipeline must NOT reuse it via BU-linked heuristics — it should create a
  // fresh placeholder if the old-named row is gone, rather than silently alias it.
  assert.equal(isUnassignedPlaceholderDivName("cold s", "Unassigned"), false);
});

test("blank name returns false", () => {
  assert.equal(isUnassignedPlaceholderDivName("", "Unassigned"), false);
});

test("blank tenantLabel defaults to 'Unassigned'", () => {
  assert.equal(isUnassignedPlaceholderDivName("Unassigned", ""), true);
  assert.equal(isUnassignedPlaceholderDivName("Architecture", ""), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveUnassignedPlaceholderDivAction
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nresolveUnassignedPlaceholderDivAction");

// Scenario 1: soft-deleted row (primary fix for the testa incident)
test("soft-deleted row → action='restore', id preserved", () => {
  const result = resolveUnassignedPlaceholderDivAction({ id: 1523, deleted: true });
  assert.equal(result.action, "restore");
  assert.equal(result.id, 1523);
});

// Scenario 2: live row already exists
test("live row → action='use-live', id preserved", () => {
  const result = resolveUnassignedPlaceholderDivAction({ id: 42, deleted: false });
  assert.equal(result.action, "use-live");
  assert.equal(result.id, 42);
});

// Scenario 3: no row at all → let ensureManyByTitle create a fresh one
test("no row (null) → action='create-new'", () => {
  const result = resolveUnassignedPlaceholderDivAction(null);
  assert.equal(result.action, "create-new");
  assert.equal(result.id, undefined);
});

// Scenario 4: BU with multiple live divisions, none named "Unassigned"
// The name check (isUnassignedPlaceholderDivName) filters those out before
// resolveUnassignedPlaceholderDivAction is ever called — tested here to confirm
// the guard composes correctly.
test("BU with multiple divisions: 'Architecture' name never reaches resolver", () => {
  // isUnassignedPlaceholderDivName returns false for "Architecture", so the
  // resolver would never be called. We confirm "Architecture" is not a pattern.
  const isPattern = isUnassignedPlaceholderDivName("Architecture", "Unassigned");
  assert.equal(isPattern, false,
    "'Architecture' must not be treated as a placeholder, which would silently " +
    "reroute unassigned rows to an arbitrary real division");
});

// Defensive: same-id live row wins when both live and deleted exist (order-by
// makes the live row come first; we get a single live row back from the query).
test("live row wins when found row has deleted=false (even if others exist)", () => {
  // The SQL ORDER BY returns the live row first; resolver only sees one row.
  const result = resolveUnassignedPlaceholderDivAction({ id: 1526, deleted: false });
  assert.equal(result.action, "use-live");
  assert.equal(result.id, 1526);
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
if (failed === 0) {
  console.log(`✓ All ${passed} tests passed.`);
} else {
  console.log(`${passed} passed, ${failed} FAILED.`);
  process.exit(1);
}
