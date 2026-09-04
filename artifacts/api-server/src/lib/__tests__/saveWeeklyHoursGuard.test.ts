/**
 * Regression tests: saveWeeklyHoursRds team-membership guard.
 *
 * The ghost-member bug's server-side cause: a stale payload for a person who
 * was just removed from a project auto-created a new RWI row, resurrecting
 * them as a ghost. The fix (rds-provider.ts ~saveWeeklyHoursRds) probes BOTH
 * ResourceWorkItems AND ResourceAllocation before creating anything:
 *
 *   has RWI row           → proceed normally (existing team member)
 *   no RWI, but has RA    → heal: create a minimal RWI (RA-only legacy member)
 *   no RWI, no RA         → refuse with NOT_ON_TEAM, create NO row
 *
 * This file tests the pure decision function `resolveWeeklyHoursMembership`
 * extracted from that same logic, so a future refactor that accidentally removes
 * either branch will be caught without needing a live database.
 *
 * Wiring: the function is exported from rds-provider.ts alongside the full
 * implementation and lives at the same decision point (see the `if (rwiId == null)`
 * block in saveWeeklyHoursRds). Tests here cover all three code paths plus the
 * NOT_ON_TEAM error-throw condition that fires when every person in the payload
 * was refused.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  resolveWeeklyHoursMembership,
  buildNotOnTeamError,
  parseNotOnTeamMessage,
  canonicalizeWeeklyHoursRow,
  canonicalMondayWeekWindow,
  validateCanonicalWeeklyHoursRow,
  resolvePastWeekPolicy,
  isWeekLockedByPolicy,
  buildLockedPastWeekError,
  buildPolicyUnavailableError,
  resolvePastWeekRulesOrThrow,
} from "../saveWeeklyHoursGuard.js";
import { getBusinessRulesForTenantStrict } from "../business-rules.js";
import type { OnboardingDefaults } from "../onboarding-defaults.js";
import {
  buildResourceWeekBuckets,
  type RawAllocRow,
} from "../rds-provider.js";

// ─── Load rds-provider.ts source for SQL static-analysis checks ───────────────
// Resolve relative to this test file so the path works regardless of cwd.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rdsProviderSrc = readFileSync(
  path.resolve(__dirname, "../rds-provider.ts"),
  "utf8",
);

/**
 * Extract the text of saveWeeklyHoursRds from the source file.
 * We look for the function signature and capture everything up to the next
 * top-level `export async function` / `export function` / `async function`
 * so we don't scan unrelated code.
 */
function extractSaveWeeklyHoursRds(src: string): string {
  const start = src.indexOf("async function saveWeeklyHoursRds(");
  if (start === -1) throw new Error("saveWeeklyHoursRds not found in rds-provider.ts");
  // Find the next top-level exported async/sync function after the start.
  // A top-level function starts at column 0 with "export " or "async " etc.
  const after = src.slice(start + 1);
  const nextFn = after.search(/\nexport\s+(async\s+)?function\s|\nasync\s+function\s|\nfunction\s/);
  return nextFn === -1 ? after : after.slice(0, nextFn);
}

// ─── tiny test runner ─────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${(e as Error).message}`);
    failed++;
  }
}

// ─── A) Core membership decision ─────────────────────────────────────────────
console.log("\nA) resolveWeeklyHoursMembership — three-way decision");

test("active RWI row → proceed (existing team member)", () => {
  const decision = resolveWeeklyHoursMembership({ rwiRowCount: 1, raRowCount: 0 });
  assert.equal(decision, "proceed");
});

test("RWI with multiple rows still returns proceed", () => {
  const decision = resolveWeeklyHoursMembership({ rwiRowCount: 3, raRowCount: 2 });
  assert.equal(decision, "proceed");
});

test("no RWI but has active RA → heal (RA-only legacy member)", () => {
  const decision = resolveWeeklyHoursMembership({ rwiRowCount: 0, raRowCount: 1 });
  assert.equal(decision, "heal_ra_only");
});

test("no RWI but multiple RA rows → heal", () => {
  const decision = resolveWeeklyHoursMembership({ rwiRowCount: 0, raRowCount: 5 });
  assert.equal(decision, "heal_ra_only");
});

test("no RWI and no RA → refuse (ghost / stale payload for removed member)", () => {
  const decision = resolveWeeklyHoursMembership({ rwiRowCount: 0, raRowCount: 0 });
  assert.equal(decision, "not_on_team");
});

test("RWI row count takes precedence over RA: RWI=1 RA=0 → proceed (not heal)", () => {
  assert.equal(
    resolveWeeklyHoursMembership({ rwiRowCount: 1, raRowCount: 0 }),
    "proceed",
    "rwiRowCount>0 must short-circuit before raRowCount is inspected",
  );
});

// ─── B) NOT_ON_TEAM error message ─────────────────────────────────────────────
console.log("\nB) buildNotOnTeamError — error thrown when all persons refused");

test("buildNotOnTeamError returns an Error with NOT_ON_TEAM prefix", () => {
  const err = buildNotOnTeamError();
  assert.ok(err instanceof Error);
  assert.ok(
    err.message.startsWith("NOT_ON_TEAM"),
    `error message should start with NOT_ON_TEAM, got: ${err.message}`,
  );
});

test("error message contains user-facing instruction to refresh", () => {
  const err = buildNotOnTeamError();
  assert.ok(
    err.message.toLowerCase().includes("refresh"),
    `error message should contain a 'refresh' instruction, got: ${err.message}`,
  );
});

test("error message mentions 'hours were not saved'", () => {
  const err = buildNotOnTeamError();
  assert.ok(
    err.message.includes("hours were not saved"),
    `error message should include 'hours were not saved', got: ${err.message}`,
  );
});

// ─── C) parseNotOnTeamMessage — client-side friendly message parser ───────────
console.log("\nC) parseNotOnTeamMessage — client-side NOT_ON_TEAM detection");

test("returns null for an unrelated error message", () => {
  assert.equal(parseNotOnTeamMessage("Network error: connection refused"), null);
});

test("returns null for an empty string", () => {
  assert.equal(parseNotOnTeamMessage(""), null);
});

test("returns a friendly string when the prefix is present verbatim", () => {
  const raw = buildNotOnTeamError().message;
  const result = parseNotOnTeamMessage(raw);
  assert.ok(typeof result === "string" && result.length > 0,
    "should return a non-empty friendly message");
});

test("friendly message does not contain the internal NOT_ON_TEAM sentinel", () => {
  const raw = buildNotOnTeamError().message;
  const result = parseNotOnTeamMessage(raw)!;
  assert.ok(!result.includes("NOT_ON_TEAM"),
    "user-facing message must not expose the internal sentinel");
});

test("friendly message mentions session or another session", () => {
  const raw = buildNotOnTeamError().message;
  const result = parseNotOnTeamMessage(raw)!;
  assert.ok(result.toLowerCase().includes("session"),
    "friendly message should explain the stale-tab / another-session scenario");
});

test("friendly message tells the user to refresh", () => {
  const raw = buildNotOnTeamError().message;
  const result = parseNotOnTeamMessage(raw)!;
  assert.ok(result.toLowerCase().includes("refresh"),
    "friendly message should instruct the user to refresh");
});

test("detects NOT_ON_TEAM embedded inside a JSON/HTTP wrapper", () => {
  const wrapped = `502: {"error":"NOT_ON_TEAM: that person no longer has an assignment"}`;
  const result = parseNotOnTeamMessage(wrapped);
  assert.ok(typeof result === "string" && result.length > 0,
    "should detect NOT_ON_TEAM even when embedded in an HTTP error wrapper");
});

// ─── D) No auto-create for removed members (invariant documentation) ──────────
console.log("\nD) NOT_ON_TEAM invariant — ghost-guard semantics");

test("removed member (no RWI, no RA) is refused, not healed", () => {
  // A member removed from the project has no active RWI or RA.
  // A stale tab submitting hours for them MUST see 'not_on_team', not 'heal'.
  const removedMember = resolveWeeklyHoursMembership({ rwiRowCount: 0, raRowCount: 0 });
  assert.equal(removedMember, "not_on_team", "removed member must be refused");
  assert.notEqual(removedMember, "heal_ra_only", "must NOT create a new RWI for a removed member");
  assert.notEqual(removedMember, "proceed", "must NOT proceed for a removed member");
});

test("legacy RA-only member is healed, not refused", () => {
  // A member that exists only in ResourceAllocation (older import pattern
  // with no corresponding RWI row) must be healed — this is the legitimate
  // path that creates a new RWI to repair the missing linkage.
  const legacyMember = resolveWeeklyHoursMembership({ rwiRowCount: 0, raRowCount: 1 });
  assert.equal(legacyMember, "heal_ra_only", "RA-only legacy member must be healed");
  assert.notEqual(legacyMember, "not_on_team", "RA-only member must NOT be refused");
});

test("active team member (has RWI) is never subjected to the RA probe decision", () => {
  // rwiRowCount=1 must short-circuit: even with raRowCount=0 we proceed.
  // This test documents the invariant that RWI presence is the primary check.
  const activeMember = resolveWeeklyHoursMembership({ rwiRowCount: 1, raRowCount: 0 });
  assert.equal(activeMember, "proceed");
});

// ─── E) Recycled ticket ID / soft-deleted generation scoping ─────────────────
//
// RM ONE recycles ticket IDs across soft-deleted generations (superadmin-record-
// delete memory note). A project can be soft-deleted (Deleted=1) and a NEW
// project can be created with the same ticket ID. The ghost-member guard's RWI
// and RA probes MUST filter to Deleted=0 rows only — otherwise a row from the
// OLD generation would satisfy the probe and hours would be written against the
// wrong generation.
//
// The SQL in saveWeeklyHoursRds enforces this with:
//   AND (Deleted = 0 OR Deleted IS NULL)
// on BOTH the RWI probe and the RA probe.
//
// These tests document the decision-function contract that the SQL upholds: the
// row counts passed to resolveWeeklyHoursMembership MUST reflect only ACTIVE
// (non-deleted) rows. A soft-deleted row from a prior generation contributes 0
// to rwiRowCount and 0 to raRowCount.
console.log("\nE) Recycled ticket ID — soft-deleted generation scoping");

test("prior-generation RWI soft-deleted → rwiRowCount=0 → not_on_team (no active assignment)", () => {
  // Scenario: ticket ID was soft-deleted (Deleted=1 RWI from old generation).
  // The SQL probe returns 0 rows because of AND (Deleted = 0 OR Deleted IS NULL).
  // The new generation has no rows yet, so both counts are 0 → must refuse.
  const decision = resolveWeeklyHoursMembership({ rwiRowCount: 0, raRowCount: 0 });
  assert.equal(
    decision,
    "not_on_team",
    "soft-deleted prior-generation RWI must NOT satisfy the membership probe",
  );
});

test("prior-generation RA soft-deleted → raRowCount=0 → not_on_team (no active RA)", () => {
  // Scenario: ticket ID recycled; person has a Deleted=1 RA from old generation.
  // The RA probe returns 0 active rows → not_on_team.
  const decision = resolveWeeklyHoursMembership({ rwiRowCount: 0, raRowCount: 0 });
  assert.equal(
    decision,
    "not_on_team",
    "soft-deleted prior-generation RA must NOT satisfy the RA-only heal probe",
  );
});

test("new generation with active RWI proceeds regardless of prior-generation state", () => {
  // Scenario: ticket ID was recycled; the NEW project already has this person on
  // the team (rwiRowCount=1 from the current, Deleted=0 RWI). Hours save proceeds.
  const decision = resolveWeeklyHoursMembership({ rwiRowCount: 1, raRowCount: 0 });
  assert.equal(decision, "proceed");
});

test("new generation with active RA but no RWI heals (not refused)", () => {
  // Scenario: recycled ticket; person was imported into the new generation via RA
  // but has no RWI yet. Active RA row (Deleted=0) → heal path, not refusal.
  const decision = resolveWeeklyHoursMembership({ rwiRowCount: 0, raRowCount: 1 });
  assert.equal(decision, "heal_ra_only");
});

test("both probes returning 0 always means not_on_team (documents Deleted=0 SQL contract)", () => {
  // This is the key invariant: IF the SQL in saveWeeklyHoursRds correctly
  // filters Deleted=0 on both probes, THEN a person with ONLY soft-deleted rows
  // (from any generation) will always produce counts of {0, 0} → not_on_team.
  // Any accidental removal of the Deleted=0 filter would let stale rows in,
  // inflate rwiRowCount or raRowCount above 0, and produce "proceed" or
  // "heal_ra_only" instead — writing hours to the wrong generation.
  const decision = resolveWeeklyHoursMembership({ rwiRowCount: 0, raRowCount: 0 });
  assert.equal(
    decision,
    "not_on_team",
    "zero active rows from either probe must always produce not_on_team",
  );
  assert.notEqual(decision, "proceed",      "must not proceed with no active rows");
  assert.notEqual(decision, "heal_ra_only", "must not heal with no active rows");
});

// ─── F) SQL static-analysis: Deleted=0 predicates in saveWeeklyHoursRds ───────
//
// These tests extract the actual SQL strings from rds-provider.ts and assert
// both the RWI probe and the RA probe include `AND (Deleted = 0 OR Deleted IS
// NULL)`. Removing or weakening either predicate will fail these tests —
// documenting that a soft-deleted prior-generation row MUST NOT satisfy the
// probe, even if it shares the same (tid, personId, ticketId) triple.
console.log("\nF) SQL static-analysis — Deleted=0 scoping in saveWeeklyHoursRds");

const fnSrc = (() => {
  try { return extractSaveWeeklyHoursRds(rdsProviderSrc); }
  catch (e) { return null; }
})();

test("saveWeeklyHoursRds exists in rds-provider.ts", () => {
  assert.ok(fnSrc !== null, "Could not extract saveWeeklyHoursRds from rds-provider.ts");
});

test("RWI membership probe includes AND (Deleted = 0 OR Deleted IS NULL)", () => {
  assert.ok(fnSrc, "saveWeeklyHoursRds source not available — see preceding test");
  // The RWI probe selects from ResourceWorkItems. Capture the block before the
  // rwiId assignment to scope the assertion to that specific query.
  const rwiBlock = fnSrc!.slice(0, fnSrc!.indexOf("let rwiId:"));
  const hasDeletedFilter =
    /ResourceWorkItems[\s\S]{0,400}AND\s*\(\s*Deleted\s*=\s*0\s+OR\s+Deleted\s+IS\s+NULL\s*\)/i.test(rwiBlock);
  assert.ok(
    hasDeletedFilter,
    "RWI probe in saveWeeklyHoursRds must include AND (Deleted = 0 OR Deleted IS NULL) " +
    "to exclude soft-deleted prior-generation rows from satisfying the membership check",
  );
});

test("RA membership probe includes AND (Deleted = 0 OR Deleted IS NULL)", () => {
  assert.ok(fnSrc, "saveWeeklyHoursRds source not available — see preceding test");
  // The RA probe is inside the `if (rwiId == null)` block. Find it by looking
  // for the raProbe query that follows "if (rwiId == null)".
  const raBlockStart = fnSrc!.indexOf("if (rwiId == null)");
  assert.ok(raBlockStart !== -1, "Could not find 'if (rwiId == null)' block in saveWeeklyHoursRds");
  const raBlock = fnSrc!.slice(raBlockStart, raBlockStart + 1200);
  const hasDeletedFilter =
    /ResourceAllocation[\s\S]{0,400}AND\s*\(\s*Deleted\s*=\s*0\s+OR\s+Deleted\s+IS\s+NULL\s*\)/i.test(raBlock);
  assert.ok(
    hasDeletedFilter,
    "RA probe in saveWeeklyHoursRds must include AND (Deleted = 0 OR Deleted IS NULL) " +
    "to exclude soft-deleted prior-generation RA rows from triggering the heal path",
  );
});

test("neither probe can match a soft-deleted row: Deleted=1 rows are invisible to both queries", () => {
  // Composite invariant: BOTH probes must have the predicate. If either is
  // missing, a recycled ticket ID's old generation could satisfy that probe.
  assert.ok(fnSrc, "saveWeeklyHoursRds source not available — see preceding test");
  const rwiBlock = fnSrc!.slice(0, fnSrc!.indexOf("let rwiId:"));
  const raBlockStart = fnSrc!.indexOf("if (rwiId == null)");
  const raBlock = fnSrc!.slice(raBlockStart, raBlockStart + 1200);
  const rwiOk = /ResourceWorkItems[\s\S]{0,400}AND\s*\(\s*Deleted\s*=\s*0\s+OR\s+Deleted\s+IS\s+NULL\s*\)/i.test(rwiBlock);
  const raOk  = /ResourceAllocation[\s\S]{0,400}AND\s*\(\s*Deleted\s*=\s*0\s+OR\s+Deleted\s+IS\s+NULL\s*\)/i.test(raBlock);
  assert.ok(rwiOk && raOk,
    `Both probes must filter Deleted=0. RWI probe ok=${rwiOk}, RA probe ok=${raOk}`,
  );
});

// ─── G) Legacy total cannot override an explicit weekly value ─────────────────
console.log("\nG) Weekly-hours canonicalization — stale legacy totals");

test("explicit 4h weekly value replaces a stale 602h legacy total", () => {
  const row = canonicalizeWeeklyHoursRow({
    AssignedTo: "person-a",
    AllocationHour: 4,
    PctAllocation: 602,
  });
  assert.equal(row.AllocationHour, 4);
  assert.equal(row.PctAllocation, 4);
});

test("explicit zero remains authoritative and clears a stale 602h total", () => {
  const row = canonicalizeWeeklyHoursRow({
    AssignedTo: "person-a",
    AllocationHour: 0,
    PctAllocation: 602,
  });
  assert.equal(row.AllocationHour, 0);
  assert.equal(row.PctAllocation, 0);
});

test("decimal weekly hours are mirrored exactly", () => {
  const row = canonicalizeWeeklyHoursRow({
    AllocationHour: 12.5,
    PctAllocation: 999,
  });
  assert.equal(row.AllocationHour, 12.5);
  assert.equal(row.PctAllocation, 12.5);
});

test("string weekly hours from an older JSON client are normalized numerically", () => {
  const row = canonicalizeWeeklyHoursRow({
    AllocationHour: "7.25",
    PctAllocation: "602",
  });
  assert.equal(row.AllocationHour, 7.25);
  assert.equal(row.PctAllocation, 7.25);
});

test("legacy-only payloads still fall back to PctAllocation", () => {
  const row = canonicalizeWeeklyHoursRow({ PctAllocation: 16 });
  assert.equal(row.AllocationHour, 16);
  assert.equal(row.PctAllocation, 16);
});

test("blank AllocationHour uses the legacy fallback instead of erasing it", () => {
  const row = canonicalizeWeeklyHoursRow({
    AllocationHour: " ",
    PctAllocation: 10,
  });
  assert.equal(row.AllocationHour, 10);
  assert.equal(row.PctAllocation, 10);
});

test("out-of-range explicit hours remain out of range for the integrity gate", () => {
  const row = canonicalizeWeeklyHoursRow({
    AllocationHour: 169,
    PctAllocation: 4,
  });
  assert.equal(row.AllocationHour, 169);
  assert.equal(row.PctAllocation, 169);
});

test("negative explicit hours remain negative for the integrity gate", () => {
  const row = canonicalizeWeeklyHoursRow({
    AllocationHour: -1,
    PctAllocation: 4,
  });
  assert.equal(row.AllocationHour, -1);
  assert.equal(row.PctAllocation, -1);
});

test("non-numeric explicit hours are rejected instead of becoming a clear", () => {
  assert.throws(
    () => canonicalizeWeeklyHoursRow({
      AllocationHour: "not-a-number",
      PctAllocation: 602,
    }),
    /INVALID_WEEKLY_HOURS/,
  );
});

test("non-finite explicit hours are rejected", () => {
  assert.throws(
    () => canonicalizeWeeklyHoursRow({
      AllocationHour: Number.POSITIVE_INFINITY,
      PctAllocation: 4,
    }),
    /INVALID_WEEKLY_HOURS/,
  );
});

test("boolean hours are rejected instead of coercing true to 1", () => {
  assert.throws(
    () => canonicalizeWeeklyHoursRow({
      AllocationHour: true,
      PctAllocation: 602,
    }),
    /INVALID_WEEKLY_HOURS/,
  );
});

test("array hours are rejected instead of coercing an empty array to 0", () => {
  assert.throws(
    () => canonicalizeWeeklyHoursRow({
      AllocationHour: [],
      PctAllocation: 602,
    }),
    /INVALID_WEEKLY_HOURS/,
  );
});

test("blank legacy fallback hours are rejected", () => {
  assert.throws(
    () => canonicalizeWeeklyHoursRow({ PctAllocation: " " }),
    /INVALID_WEEKLY_HOURS/,
  );
});

test("positive hours accept a normal seven-day ISO week", () => {
  const row = canonicalizeWeeklyHoursRow({
    AllocationHour: 4,
    PctAllocation: 602,
    AllocationStartDate: "2026-03-02T00:00:00",
    AllocationEndDate: "2026-03-08T00:00:00",
  });
  assert.doesNotThrow(() => validateCanonicalWeeklyHoursRow(row));
});

test("positive hours accept a clipped one-day final bucket", () => {
  const row = canonicalizeWeeklyHoursRow({
    AllocationHour: 4,
    PctAllocation: 602,
    AllocationStartDate: "2026-03-02T00:00:00",
    AllocationEndDate: "2026-03-02T00:00:00",
  });
  assert.doesNotThrow(() => validateCanonicalWeeklyHoursRow(row));
});

test("positive hours reject an impossible calendar date", () => {
  const row = canonicalizeWeeklyHoursRow({
    AllocationHour: 4,
    PctAllocation: 602,
    AllocationStartDate: "2026-02-31T00:00:00",
    AllocationEndDate: "2026-03-06T00:00:00",
  });
  assert.throws(
    () => validateCanonicalWeeklyHoursRow(row),
    /INVALID_WEEKLY_DATE/,
  );
});

test("positive hours reject a malformed ISO timestamp suffix", () => {
  const row = canonicalizeWeeklyHoursRow({
    AllocationHour: 4,
    PctAllocation: 602,
    AllocationStartDate: "2026-03-02Tbad",
    AllocationEndDate: "2026-03-08Tbad",
  });
  assert.throws(
    () => validateCanonicalWeeklyHoursRow(row),
    /INVALID_WEEKLY_DATE/,
  );
});

test("valid ISO timestamps are normalized to the verified calendar days", () => {
  const row = canonicalizeWeeklyHoursRow({
    AllocationHour: 4,
    PctAllocation: 602,
    AllocationStartDate: "2026-03-02T23:15:30.000+05:30",
    AllocationEndDate: "2026-03-08T01:00:00Z",
  });
  const validated = validateCanonicalWeeklyHoursRow(row);
  assert.equal(validated.AllocationStartDate, "2026-03-02T00:00:00");
  assert.equal(validated.AllocationEndDate, "2026-03-08T00:00:00");
});

test("a legacy Wed-to-Tue weekly row snaps to the Monday it crosses", () => {
  assert.deepEqual(
    canonicalMondayWeekWindow("2026-07-01", "2026-07-07"),
    { startYmd: "2026-07-06", endYmd: "2026-07-12" },
  );
  const row = canonicalizeWeeklyHoursRow({
    AllocationHour: 120,
    PctAllocation: 120,
    AllocationStartDate: "2026-07-01T00:00:00",
    AllocationEndDate: "2026-07-07T00:00:00",
  });
  const validated = validateCanonicalWeeklyHoursRow(row);
  assert.equal(validated.AllocationStartDate, "2026-07-06T00:00:00");
  assert.equal(validated.AllocationEndDate, "2026-07-12T00:00:00");
});

test("a short row containing no Monday stays in its containing Monday week", () => {
  assert.deepEqual(
    canonicalMondayWeekWindow("2026-07-01", "2026-07-03"),
    { startYmd: "2026-06-29", endYmd: "2026-07-05" },
  );
});

test("positive hours reject an eight-day span", () => {
  const row = canonicalizeWeeklyHoursRow({
    AllocationHour: 4,
    PctAllocation: 602,
    AllocationStartDate: "2026-03-02T00:00:00",
    AllocationEndDate: "2026-03-09T00:00:00",
  });
  assert.throws(
    () => validateCanonicalWeeklyHoursRow(row),
    /INVALID_WEEKLY_DATE/,
  );
});

test("zero-hour legacy clear may omit dates", () => {
  const row = canonicalizeWeeklyHoursRow({
    AllocationHour: 0,
    PctAllocation: 602,
  });
  assert.doesNotThrow(() => validateCanonicalWeeklyHoursRow(row));
});

test("saveWeeklyHoursRds canonicalizes each row before validation and persistence", () => {
  assert.ok(fnSrc, "saveWeeklyHoursRds source not available");
  assert.match(
    fnSrc!,
    /arr\.push\(canonicalizeWeeklyHoursRow\(a\)\)/,
    "the live save path must canonicalize every accepted payload row",
  );
  const canonicalizeAt = fnSrc!.indexOf("arr.push(canonicalizeWeeklyHoursRow(a))");
  const validationAt = fnSrc!.indexOf("validateCanonicalWeeklyHoursRow(rows[i])");
  const transactionAt = fnSrc!.indexOf("await tx.begin()");
  assert.ok(
    canonicalizeAt >= 0 && validationAt > canonicalizeAt,
    "canonicalization must happen before the hours integrity gate",
  );
  assert.ok(
    transactionAt > validationAt,
    "every row must be validated before the replacement transaction begins",
  );
});

test("resource and team read paths canonicalize malformed weekly windows", () => {
  assert.match(
    rdsProviderSrc,
    /displayWeek\s*=\s*hr\s*>\s*0[\s\S]{0,250}canonicalMondayWeekWindow\(rawStartDay,\s*rawEndDay\)/,
    "Resources allocation rows must expose one canonical Monday week",
  );
  assert.match(
    rdsProviderSrc,
    /isNarrowSpan\s*=[\s\S]{0,200}<=\s*8\s*\*\s*86_400_000/,
    "Project Team narrow/broad split must use the engine's ≤8-elapsed-days rule",
  );
  assert.match(
    rdsProviderSrc,
    /if\s*\(isNarrowSpan\)\s*\{[\s\S]{0,400}canonicalMondayWeekWindow\(startDate,\s*endDate\)/,
    "Project Team weeklyHours must use the same canonical Monday identity",
  );

  // Verify the behavior through the exported pure engine instead of assuming
  // that its local variable names or statement ordering stay unchanged. This
  // Wed→Tue legacy row crosses Monday 2025-06-23 and must land wholly in that
  // canonical bucket, never in the start date's Monday bucket.
  const legacyWedToTue: RawAllocRow = {
    id: 701,
    projectId: "P1",
    projectName: "Test Project",
    startMs: Date.UTC(2025, 5, 18),
    endMs: Date.UTC(2025, 5, 24),
    hours: 27.5,
    pct: 0,
    isLocked: false,
    isNonChargeable: false,
    isSoftAllocation: false,
  };
  const buckets = buildResourceWeekBuckets(
    [legacyWedToTue],
    40,
    "2025-06-16",
    "2025-06-29",
  );
  assert.equal(
    buckets.get("P1|2025-06-23")?.hours,
    27.5,
    "resource-week engine must place the full narrow row in its canonical Monday bucket",
  );
  assert.equal(
    buckets.get("P1|2025-06-16"),
    undefined,
    "resource-week engine must not split a Wed→Tue row into the start week's bucket",
  );
});

test("weekly replacement neutralizes broad container hours before inserting weekly rows", () => {
  assert.ok(fnSrc, "saveWeeklyHoursRds source not available");
  const filterAt = fnSrc!.indexOf("const hourFilter");
  const neutralizeAt = fnSrc!.indexOf("const broadValuePredicates");
  const clearAt = fnSrc!.indexOf("const clearReq", neutralizeAt);
  const insertAt = fnSrc!.indexOf("const raRows", clearAt);
  assert.ok(
    filterAt >= 0 && neutralizeAt > filterAt && clearAt > neutralizeAt && insertAt > clearAt,
    "broad container hours must be neutralized before old weekly rows are cleared and replacements are inserted",
  );
  const replacementBlock = fnSrc!.slice(neutralizeAt, insertAt);
  assert.match(
    replacementBlock,
    /AllocationHour = 0[\s\S]*?PctAllocation = 0[\s\S]*?DATEDIFF\(day, AllocationStartDate, ISNULL\(AllocationEndDate, AllocationStartDate\)\) >= 30/,
    "positive broad rows keep their dates but lose their additive hour values",
  );
  assert.match(
    replacementBlock,
    /const clearReq[\s\S]*?\$\{hourFilter\}/,
    "the destructive replacement clear remains limited to narrow weekly rows",
  );
});

test("weekly replacement covers every RWI row for the same person and project", () => {
  assert.ok(fnSrc, "saveWeeklyHoursRds source not available");
  assert.match(
    fnSrc!,
    /ResourceWorkItemLookup IN \(\s*SELECT ID FROM core2\.dbo\.ResourceWorkItems\s*WHERE TenantID = @tid AND ResourceUser = @p AND WorkItem = @pid/,
    "replacement must remove legacy hours linked to an older duplicate RWI, not only the newest @rwi",
  );
  assert.match(
    fnSrc!,
    /const clearWhere[\s\S]*?allPersonProjectRwiScope/,
    "the all-RWI identity scope must be used by the destructive weekly replacement",
  );
});

// ─── H) resolvePastWeekPolicy — PMM vs OPM selection ────────────────────────
console.log("\nH) resolvePastWeekPolicy — PMM vs OPM settings selection");

const baseDefaults = {
  allowPastDateEdit: false,
  pastEditLimitWeeks: null,
  oppAllowPastDateEdit: true,
  oppPastEditLimitWeeks: 4,
};

test("isOPM=false selects PMM settings (allowPastDateEdit / pastEditLimitWeeks)", () => {
  const policy = resolvePastWeekPolicy(baseDefaults, false);
  assert.equal(policy.allow, false);
  assert.equal(policy.limitWeeks, null);
});

test("isOPM=true selects OPM settings (oppAllowPastDateEdit / oppPastEditLimitWeeks)", () => {
  const policy = resolvePastWeekPolicy(baseDefaults, true);
  assert.equal(policy.allow, true);
  assert.equal(policy.limitWeeks, 4);
});

test("PMM allow=true with limitWeeks=8 is returned correctly", () => {
  const policy = resolvePastWeekPolicy(
    { ...baseDefaults, allowPastDateEdit: true, pastEditLimitWeeks: 8 },
    false,
  );
  assert.equal(policy.allow, true);
  assert.equal(policy.limitWeeks, 8);
});

test("OPM allow=false with no limit is returned correctly", () => {
  const policy = resolvePastWeekPolicy(
    { ...baseDefaults, oppAllowPastDateEdit: false, oppPastEditLimitWeeks: null },
    true,
  );
  assert.equal(policy.allow, false);
  assert.equal(policy.limitWeeks, null);
});

// ─── I) isWeekLockedByPolicy — boundary cases ────────────────────────────────
console.log("\nI) isWeekLockedByPolicy — boundary conditions");

// Reference date: Wednesday 2026-07-22 (UTC). Monday of this week = 2026-07-20.
const REF_DATE_STR = "2026-07-22T12:00:00.000Z";
const REF_UTC = new Date(REF_DATE_STR).getTime();

// The Monday of the current week.
const CURRENT_MONDAY = "2026-07-20";
// Exactly 1 week back.
const ONE_WEEK_BACK = "2026-07-13";
// Exactly 2 weeks back.
const TWO_WEEKS_BACK = "2026-07-06";
// Exactly 3 weeks back.
const THREE_WEEKS_BACK = "2026-06-29";
// A future Monday.
const NEXT_MONDAY = "2026-07-27";

// Policy: past editing fully disabled.
const DISABLED_POLICY = { allow: false, limitWeeks: null };
// Policy: past editing enabled, cap = 2 weeks.
const LIMITED_2W_POLICY = { allow: true, limitWeeks: 2 };
// Policy: past editing unlimited.
const UNLIMITED_POLICY = { allow: true, limitWeeks: null };

test("disabled policy: current week is NOT locked", () => {
  assert.equal(isWeekLockedByPolicy(CURRENT_MONDAY, DISABLED_POLICY, REF_UTC), false);
});

test("disabled policy: future week is NOT locked", () => {
  assert.equal(isWeekLockedByPolicy(NEXT_MONDAY, DISABLED_POLICY, REF_UTC), false);
});

test("disabled policy: one week back IS locked", () => {
  assert.equal(isWeekLockedByPolicy(ONE_WEEK_BACK, DISABLED_POLICY, REF_UTC), true);
});

test("disabled policy: three weeks back IS locked", () => {
  assert.equal(isWeekLockedByPolicy(THREE_WEEKS_BACK, DISABLED_POLICY, REF_UTC), true);
});

test("unlimited policy: nothing is ever locked (past editing unrestricted)", () => {
  assert.equal(isWeekLockedByPolicy(THREE_WEEKS_BACK, UNLIMITED_POLICY, REF_UTC), false);
  assert.equal(isWeekLockedByPolicy(ONE_WEEK_BACK, UNLIMITED_POLICY, REF_UTC), false);
  assert.equal(isWeekLockedByPolicy("2000-01-03", UNLIMITED_POLICY, REF_UTC), false);
});

test("2-week cap: current week is NOT locked", () => {
  assert.equal(isWeekLockedByPolicy(CURRENT_MONDAY, LIMITED_2W_POLICY, REF_UTC), false);
});

test("2-week cap: one week back is NOT locked (within limit)", () => {
  assert.equal(isWeekLockedByPolicy(ONE_WEEK_BACK, LIMITED_2W_POLICY, REF_UTC), false);
});

test("2-week cap: exactly at limit (two weeks back) is NOT locked", () => {
  // weeksBack === limitWeeks is allowed (limit is inclusive)
  assert.equal(isWeekLockedByPolicy(TWO_WEEKS_BACK, LIMITED_2W_POLICY, REF_UTC), false);
});

test("2-week cap: three weeks back IS locked (exceeds limit)", () => {
  assert.equal(isWeekLockedByPolicy(THREE_WEEKS_BACK, LIMITED_2W_POLICY, REF_UTC), true);
});

test("2-week cap: a future Monday is NOT locked", () => {
  assert.equal(isWeekLockedByPolicy(NEXT_MONDAY, LIMITED_2W_POLICY, REF_UTC), false);
});

test("malformed date is treated as not-locked (downstream validation handles it)", () => {
  assert.equal(isWeekLockedByPolicy("not-a-date", DISABLED_POLICY, REF_UTC), false);
  assert.equal(isWeekLockedByPolicy("", DISABLED_POLICY, REF_UTC), false);
});

// ── Timezone-boundary tests ────────────────────────────────────────────────
// The server guard must not produce false positives for users whose local time
// has not yet crossed into Monday while UTC already has. isWeekLockedByPolicy
// uses UTC-12 as its reference to prevent this for any real-world timezone.
//
// Scenario: Sunday 22:00 US Pacific (UTC-8) = Monday 06:00 UTC.
// The Pacific user's "current Monday" is still the PREVIOUS Monday.
// Their browser client correctly identifies it as unlocked; the server must agree.

// Monday 06:00 UTC on 2026-07-20 = Sunday 22:00 UTC-8 (US Pacific)
const PACIFIC_SUNDAY_EVENING_UTC = new Date("2026-07-20T06:00:00.000Z").getTime();
// The Pacific user's "current Monday" (what their browser computes)
const PACIFIC_CURRENT_MONDAY = "2026-07-13";
// The week before their current Monday
const PACIFIC_ONE_WEEK_BACK = "2026-07-06";

test("Sunday-evening US-Pacific: current-week save is not rejected (no timezone false positive)", () => {
  // UTC approach would compute current Monday = 2026-07-20 and lock 2026-07-13
  // as "one week back" under a disabled policy — a false positive for Pacific users.
  // UTC-12 approach computes current Monday = 2026-07-13 (Pacific user's Monday).
  assert.equal(
    isWeekLockedByPolicy(PACIFIC_CURRENT_MONDAY, DISABLED_POLICY, PACIFIC_SUNDAY_EVENING_UTC),
    false,
    "the prior Monday must not be locked when UTC crossed into Monday but the client is still in Sunday local time",
  );
});

test("Sunday-evening US-Pacific: the week BEFORE current is still locked", () => {
  // Even with the UTC-12 tolerance, 2026-07-06 is two Mondays ago from
  // the Pacific user's perspective → locked under disabled policy.
  assert.equal(
    isWeekLockedByPolicy(PACIFIC_ONE_WEEK_BACK, DISABLED_POLICY, PACIFIC_SUNDAY_EVENING_UTC),
    true,
    "weeks genuinely in the past (before the UTC-12 current Monday) must still be locked",
  );
});

test("Sunday-evening US-Pacific: 2-week cap still unlocks Pacific current and one-prior week", () => {
  // Current Monday (2026-07-13) → not locked (current week)
  assert.equal(
    isWeekLockedByPolicy(PACIFIC_CURRENT_MONDAY, LIMITED_2W_POLICY, PACIFIC_SUNDAY_EVENING_UTC),
    false,
    "current Pacific Monday must not be locked with 2-week cap",
  );
  // One week before Pacific current (2026-07-06) → ageWeeks=1, limit=2 → not locked
  assert.equal(
    isWeekLockedByPolicy(PACIFIC_ONE_WEEK_BACK, LIMITED_2W_POLICY, PACIFIC_SUNDAY_EVENING_UTC),
    false,
    "one week before Pacific current Monday must be editable under 2-week cap",
  );
  // Three weeks before Pacific current (2026-06-22) → ageWeeks=3, limit=2 → locked
  assert.equal(
    isWeekLockedByPolicy("2026-06-22", LIMITED_2W_POLICY, PACIFIC_SUNDAY_EVENING_UTC),
    true,
    "three weeks before Pacific current Monday must be locked under 2-week cap",
  );
});

// ─── J) buildLockedPastWeekError — error shape ───────────────────────────────
console.log("\nJ) buildLockedPastWeekError — error prefix and week identification");

test("buildLockedPastWeekError returns an Error with LOCKED_PAST_WEEK prefix", () => {
  const err = buildLockedPastWeekError("2026-07-06");
  assert.ok(err instanceof Error);
  assert.ok(
    err.message.startsWith("LOCKED_PAST_WEEK"),
    `message should start with LOCKED_PAST_WEEK, got: ${err.message}`,
  );
});

test("buildLockedPastWeekError message includes the week date", () => {
  const err = buildLockedPastWeekError("2026-07-06");
  assert.ok(
    err.message.includes("2026-07-06"),
    `message should include the week date, got: ${err.message}`,
  );
});

test("buildLockedPastWeekError message mentions 'unchanged' to document round-trip allowance", () => {
  const err = buildLockedPastWeekError("2026-07-06");
  assert.ok(
    err.message.toLowerCase().includes("unchanged"),
    `message should mention unchanged round-trips are allowed, got: ${err.message}`,
  );
});

// ─── J2) buildPolicyUnavailableError — fail-closed policy read ───────────────
console.log("\nJ2) buildPolicyUnavailableError — fail-closed error shape");

test("buildPolicyUnavailableError returns an Error with PAST_WEEK_POLICY_UNAVAILABLE prefix", () => {
  const err = buildPolicyUnavailableError(new Error("db down"));
  assert.ok(err instanceof Error);
  assert.ok(
    err.message.startsWith("PAST_WEEK_POLICY_UNAVAILABLE"),
    `message should start with PAST_WEEK_POLICY_UNAVAILABLE, got: ${err.message}`,
  );
});

test("buildPolicyUnavailableError message says hours were not saved and asks for retry", () => {
  const err = buildPolicyUnavailableError("cache miss");
  const lower = err.message.toLowerCase();
  assert.ok(lower.includes("not saved"), "message must state hours were not saved");
  assert.ok(lower.includes("retry"), "message must invite a retry (503 semantics)");
});

test("buildPolicyUnavailableError includes a truncated cause and tolerates nullish causes", () => {
  const err = buildPolicyUnavailableError(new Error("x".repeat(500)));
  assert.ok(err.message.length < 500, "cause must be truncated to keep the message bounded");
  const nullErr = buildPolicyUnavailableError(null);
  assert.ok(nullErr.message.includes("unknown"), "nullish cause becomes 'unknown'");
});

// ─── J3) Fail-closed policy read — EXECUTABLE regression tests ───────────────
// The reviewer-identified hole: the plain getBusinessRulesForTenant accessor
// catches loadEffectiveDefaults failures internally and returns permissive
// BUILTIN_ONBOARDING_DEFAULTS, so a route-level .catch never fires and a
// configured lock is silently skipped during a cold-cache Settings outage.
// These tests execute the REAL strict accessor and resolver (no source scan).
console.log("\nJ3) Fail-closed policy read — executable (cache miss + rejected Settings load)");

// Unique tenant labels guarantee a cache MISS in the shared business-rules
// cache, so the injected loader is always consulted.
const uniqueTenant = (suffix: string) =>
  `__t605-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// 1) Cache miss + settings store down → the STRICT accessor rejects.
const strictMissOutcome = await getBusinessRulesForTenantStrict(uniqueTenant("miss"), {
  load: () => Promise.reject(new Error("settings store unreachable")),
}).then(
  (rules) => ({ resolved: rules as unknown, rejected: null as unknown }),
  (err) => ({ resolved: null as unknown, rejected: err as unknown }),
);

test("strict accessor: cache miss + rejected Settings load PROPAGATES (no permissive fallback)", () => {
  assert.ok(
    strictMissOutcome.rejected,
    "getBusinessRulesForTenantStrict must reject when the load fails on a cache miss",
  );
  assert.match(String(strictMissOutcome.rejected), /settings store unreachable/);
  assert.equal(strictMissOutcome.resolved, null);
});

// 2) Known-good cached policy IS an intentional supported read: a successful
// load populates the shared cache; a follow-up read within the TTL succeeds
// even while the store is down. The cache is only ever set on success, so a
// hit can never be a permissive fallback.
const goodTenant = uniqueTenant("good");
const KNOWN_GOOD_RULES = { allowPastDateEdit: false } as unknown as OnboardingDefaults;
const firstStrictRead = await getBusinessRulesForTenantStrict(goodTenant, {
  load: () => Promise.resolve(KNOWN_GOOD_RULES),
});
const cachedStrictOutcome = await getBusinessRulesForTenantStrict(goodTenant, {
  load: () => Promise.reject(new Error("store down AFTER good load")),
}).then(
  (rules) => ({ resolved: rules as unknown, rejected: null as unknown }),
  (err) => ({ resolved: null as unknown, rejected: err as unknown }),
);

test("strict accessor: fresh cache hit serves the known-good policy (cache set only on success)", () => {
  assert.equal(firstStrictRead, KNOWN_GOOD_RULES);
  assert.equal(
    cachedStrictOutcome.rejected,
    null,
    "a fresh known-good cache entry must be served without consulting the failing loader",
  );
  assert.equal(cachedStrictOutcome.resolved, KNOWN_GOOD_RULES);
});

// 3) resolvePastWeekRulesOrThrow wraps loader failures with the 503 prefix.
const resolverOutcome = await resolvePastWeekRulesOrThrow(() =>
  Promise.reject(new Error("raw loader failure")),
).then(
  () => null as unknown,
  (err) => err as unknown,
);

test("resolvePastWeekRulesOrThrow converts loader failures into PAST_WEEK_POLICY_UNAVAILABLE", () => {
  assert.ok(resolverOutcome instanceof Error);
  assert.ok(String(resolverOutcome).includes("PAST_WEEK_POLICY_UNAVAILABLE"));
  assert.ok(
    String(resolverOutcome).includes("raw loader failure"),
    "original cause preserved (truncated) for diagnostics",
  );
});

// 4) Route-shaped harness: the exact enforcement sequence — strict resolve
// FIRST, save only afterwards; the catch maps the prefix to HTTP 503 exactly
// as rmone-proxy.ts does. Proves the save is never called on a cold-cache
// Settings outage.
let harnessSaveCalled = false;
const harnessRes = { status: 0, body: null as { error: string } | null };
try {
  await resolvePastWeekRulesOrThrow(() =>
    getBusinessRulesForTenantStrict(uniqueTenant("harness"), {
      load: () => Promise.reject(new Error("cold cache + settings outage")),
    }),
  );
  harnessSaveCalled = true; // stands in for saveWeeklyHoursRds
  harnessRes.status = 200;
} catch (e) {
  if (String(e).includes("PAST_WEEK_POLICY_UNAVAILABLE")) {
    harnessRes.status = 503;
    harnessRes.body = { error: "policy_unavailable" };
  } else {
    harnessRes.status = 502;
  }
}

test("cache miss + rejected Settings load → 503 policy_unavailable and the save is NEVER called", () => {
  assert.equal(
    harnessSaveCalled,
    false,
    "saveWeeklyHoursRds must not run when the tenant policy cannot be resolved",
  );
  assert.equal(harnessRes.status, 503);
  assert.deepEqual(harnessRes.body, { error: "policy_unavailable" });
});

// ─── K) Static analysis — route enforcement ──────────────────────────────────
//
// Asserts that the /hours-allocation route in rmone-proxy.ts contains the
// server-side LOCKED_PAST_WEEK enforcement so a future refactor cannot
// accidentally remove the guard without failing this test.
console.log("\nK) Static analysis — LOCKED_PAST_WEEK enforcement in rmone-proxy.ts");

const __dirnamePolicyTest = path.dirname(fileURLToPath(import.meta.url));
const proxyRoutesSrc = (() => {
  try {
    return readFileSync(
      path.resolve(__dirnamePolicyTest, "../../routes/rmone-proxy.ts"),
      "utf8",
    );
  } catch {
    return null;
  }
})();

test("rmone-proxy.ts is readable for static analysis", () => {
  assert.ok(proxyRoutesSrc !== null, "Could not read rmone-proxy.ts for static analysis");
});

test("route imports resolvePastWeekPolicy from saveWeeklyHoursGuard", () => {
  assert.ok(proxyRoutesSrc, "rmone-proxy.ts not available — see preceding test");
  assert.match(
    proxyRoutesSrc!,
    /resolvePastWeekPolicy/,
    "rmone-proxy.ts must import and use resolvePastWeekPolicy",
  );
});

test("route imports isWeekLockedByPolicy from saveWeeklyHoursGuard", () => {
  assert.ok(proxyRoutesSrc, "rmone-proxy.ts not available — see preceding test");
  assert.match(
    proxyRoutesSrc!,
    /isWeekLockedByPolicy/,
    "rmone-proxy.ts must import and use isWeekLockedByPolicy",
  );
});

// The past-week enforcement region: from the enforcement banner comment to the
// saveWeeklyHoursRds call that follows it. Scoped so assertions about the
// policy read cannot be satisfied (or violated) by unrelated routes that
// legitimately use built-in defaults elsewhere in the file.
const pastWeekEnforcementRegion = (() => {
  if (!proxyRoutesSrc) return null;
  const start = proxyRoutesSrc.indexOf("Past-week policy enforcement");
  if (start < 0) return null;
  const end = proxyRoutesSrc.indexOf("saveWeeklyHoursRds(", start);
  return end > start
    ? proxyRoutesSrc.slice(start, end)
    : proxyRoutesSrc.slice(start, start + 20000);
})();

test("policy read FAILS CLOSED: enforcement region has no BUILTIN_ONBOARDING_DEFAULTS fallback", () => {
  assert.ok(
    pastWeekEnforcementRegion,
    "could not locate the past-week enforcement region in rmone-proxy.ts",
  );
  // A .catch(() => BUILTIN_ONBOARDING_DEFAULTS) here would let a tenant's
  // configured lock be bypassed whenever the Settings read fails — the exact
  // fail-open hole this guard exists to close.
  assert.ok(
    !pastWeekEnforcementRegion!.includes("BUILTIN_ONBOARDING_DEFAULTS"),
    "the past-week policy read must NOT fall back to permissive built-in defaults on failure",
  );
  assert.ok(
    pastWeekEnforcementRegion!.includes("getBusinessRulesForTenantStrict"),
    "the enforcement region must resolve policy via the STRICT accessor (propagates load failures)",
  );
  assert.ok(
    !/getBusinessRulesForTenant(?!Strict)/.test(pastWeekEnforcementRegion!),
    "the permissive fallback accessor must not be used for past-week enforcement",
  );
  assert.ok(
    pastWeekEnforcementRegion!.includes("resolvePastWeekRulesOrThrow"),
    "the strict read must be wrapped so failures become PAST_WEEK_POLICY_UNAVAILABLE before the save",
  );
});

test("route maps PAST_WEEK_POLICY_UNAVAILABLE to HTTP 503 policy_unavailable", () => {
  assert.ok(proxyRoutesSrc, "rmone-proxy.ts not available — see preceding test");
  assert.match(
    proxyRoutesSrc!,
    /PAST_WEEK_POLICY_UNAVAILABLE[\s\S]{0,600}?status\(503\)[\s\S]{0,200}?policy_unavailable/,
    "policy-read failures must surface as a structured 503 policy_unavailable response",
  );
});

test("route imports getBusinessRulesForTenant for tenant-aware policy resolution", () => {
  assert.ok(proxyRoutesSrc, "rmone-proxy.ts not available — see preceding test");
  assert.match(
    proxyRoutesSrc!,
    /getBusinessRulesForTenant/,
    "rmone-proxy.ts must call getBusinessRulesForTenant to resolve per-tenant policy",
  );
});

test("route checks OPM prefix to select correct policy (PMM vs OPM settings)", () => {
  assert.ok(proxyRoutesSrc, "rmone-proxy.ts not available — see preceding test");
  assert.match(
    proxyRoutesSrc!,
    /startsWith\(["']OPM["']\)/i,
    "route must detect OPM prefix to select the OPM past-edit policy",
  );
});

test("route DB probe fetches ALL existing rows (no week-date filter) to catch omitted locked weeks", () => {
  assert.ok(proxyRoutesSrc, "rmone-proxy.ts not available — see preceding test");
  // The enforcement block fetches ALL existing narrow weekly rows for each
  // submitted person — not filtered to specific submitted weeks. This is
  // essential because saveWeeklyHoursRds is a full-replacement save: a payload
  // that OMITS a locked week silently deletes it.
  const deletedAt = proxyRoutesSrc!.indexOf("Deleted = 0 OR Deleted IS NULL");
  const lockedAt  = proxyRoutesSrc!.indexOf("LOCKED_PAST_WEEK");
  assert.ok(deletedAt !== -1, "route DB probe must include Deleted=0 predicate");
  assert.ok(lockedAt  !== -1, "route must handle LOCKED_PAST_WEEK errors");
  assert.ok(deletedAt < lockedAt,
    "the Deleted=0 DB probe must appear before the LOCKED_PAST_WEEK error handler");
  const blockStart = proxyRoutesSrc!.indexOf("Past-week policy enforcement");
  const blockEnd   = proxyRoutesSrc!.indexOf("End past-week policy enforcement");
  assert.ok(blockStart !== -1 && blockEnd !== -1, "enforcement block markers not found");
  const block = proxyRoutesSrc!.slice(blockStart, blockEnd);
  assert.ok(!block.includes("IN (${wkParams})"),
    "enforcement probe must not filter to submitted weeks only — omitted locked rows must also be discovered");
});

test("route probe uses RWI subquery scope to cover legacy RWI-only rows", () => {
  assert.ok(proxyRoutesSrc, "rmone-proxy.ts not available — see preceding test");
  // Legacy RA rows can have ResourceWorkItemLookup set but no ResourceUser/TicketId.
  // A probe using only TicketId+ResourceUser would miss these rows, letting the
  // save path delete them silently when the payload omits the locked week.
  // The probe must include the same RWI-subquery scope as saveWeeklyHoursRds.
  const blockStart = proxyRoutesSrc!.indexOf("Past-week policy enforcement");
  const blockEnd   = proxyRoutesSrc!.indexOf("End past-week policy enforcement");
  const block = proxyRoutesSrc!.slice(blockStart, blockEnd);
  assert.match(
    block,
    /ResourceWorkItemLookup IN \(\s*SELECT ID FROM core2\.dbo\.ResourceWorkItems/,
    "enforcement probe must include the RWI subquery to cover legacy RWI-only rows",
  );
});

test("route canonicalizes existing row dates via canonicalMondayWeekWindow in JS before aggregating", () => {
  assert.ok(proxyRoutesSrc, "rmone-proxy.ts not available — see preceding test");
  // Pre-grouping by AllocationStartDate in SQL would produce a Wed key for a
  // Wed→Tue legacy row, which would never match the Mon key used by submitted
  // rows — causing a false 423 for an unchanged round-trip. The probe fetches
  // raw startYmd/endYmd and applies canonicalMondayWeekWindow in JS.
  const blockStart = proxyRoutesSrc!.indexOf("Past-week policy enforcement");
  const blockEnd   = proxyRoutesSrc!.indexOf("End past-week policy enforcement");
  const block = proxyRoutesSrc!.slice(blockStart, blockEnd);
  assert.match(block, /canonicalMondayWeekWindow\(s,\s*e\)/,
    "enforcement probe must apply canonicalMondayWeekWindow to each existing row's dates");
  assert.match(block, /startYmd[\s\S]{0,200}endYmd/,
    "probe must fetch both start and end dates per row so canonicalization can normalise them");
});

test("route uses union of existing+submitted weeks so new locked additions are caught", () => {
  assert.ok(proxyRoutesSrc, "rmone-proxy.ts not available — see preceding test");
  assert.match(proxyRoutesSrc!,
    /existingByWeek\.keys\(\)[\s\S]{0,200}submittedWeeks\.keys\(\)/,
    "the enforcement loop must iterate the union of existingByWeek and submittedWeeks keys");
});

test("route registers every valid person before date parsing so dateless zero-hour clears are probed", () => {
  assert.ok(proxyRoutesSrc, "rmone-proxy.ts not available — see preceding test");
  // A zero-hour clear row with no start date (e.g. { AssignedTo, AllocationHour: 0 })
  // passes validation but produces no canonical week. If the person is only added
  // to policyPersonIds after a successful week derivation, they are silently skipped
  // and saveWeeklyHoursRds can delete their locked existing rows without a check.
  // Verify the person is registered unconditionally, before the try/catch block.
  const blockStart = proxyRoutesSrc!.indexOf("Past-week policy enforcement");
  const blockEnd   = proxyRoutesSrc!.indexOf("End past-week policy enforcement");
  const block = proxyRoutesSrc!.slice(blockStart, blockEnd);
  // The unconditional registration comment is the clearest static marker.
  assert.match(
    block,
    /Register the person unconditionally/,
    "enforcement block must register each person unconditionally before date parsing",
  );
  // And the push to policyPersonIds must precede the try block.
  const pushAt = block.indexOf("policyPersonIds.push(personId)");
  const tryAt  = block.indexOf("try {");
  assert.ok(pushAt !== -1, "policyPersonIds.push must be present");
  assert.ok(tryAt  !== -1, "try block must be present");
  assert.ok(pushAt < tryAt,
    "policyPersonIds.push must come before the try block so dateless rows still register the person");
});

test("route compares existing vs submitted hours before rejecting (handles omissions as 0h)", () => {
  assert.ok(proxyRoutesSrc, "rmone-proxy.ts not available — see preceding test");
  assert.match(proxyRoutesSrc!, /existingByWeek\.get\(weekYmd\)\s*\?\?\s*0/,
    "missing existing rows must default to 0h (catches new additions to locked weeks)");
  assert.match(proxyRoutesSrc!, /submittedWeeks\.get\(weekYmd\)\s*\?\?\s*0/,
    "omitted locked weeks must default to 0h submitted (treats omissions as deletions)");
  assert.match(proxyRoutesSrc!,
    /existingHours[\s\S]{0,400}submittedHours|submittedHours[\s\S]{0,400}existingHours/,
    "route must compare existing DB hours with submitted hours before blocking");
});

// ─── L) Canonical Monday aggregation — behavioral tests ──────────────────────
//
// The enforcement block applies canonicalMondayWeekWindow to each existing RA
// row's start+end dates before aggregating. These tests verify the aggregation
// semantics that the route relies on, using only the exported pure functions.
//
// They prove that a Wed→Tue legacy row and a Mon→Sun submitted row for the
// same calendar week share the same canonical Monday key, so an unchanged
// round-trip is allowed and a changed/omitted value is caught.
console.log("\nL) Canonical Monday aggregation — behavioral tests");

/** Simulates the route's existing-row aggregation: apply canonicalMondayWeekWindow
 *  to each row's raw dates, then sum hours per canonical Monday. */
function aggregateExistingRows(
  rows: { startYmd: string; endYmd: string; hours: number }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const w = canonicalMondayWeekWindow(row.startYmd, row.endYmd);
    if (!w) continue;
    map.set(w.startYmd, (map.get(w.startYmd) ?? 0) + row.hours);
  }
  return map;
}

test("Wed→Tue legacy row maps to the same canonical Monday as a Mon→Sun submitted row", () => {
  // 2026-07-01 (Wed) → 2026-07-07 (Tue): canonical Monday = 2026-07-06
  const existing = aggregateExistingRows([{ startYmd: "2026-07-01", endYmd: "2026-07-07", hours: 40 }]);
  assert.equal(existing.get("2026-07-06"), 40,
    "Wed→Tue row must map to canonical Monday 2026-07-06");
  assert.equal(existing.has("2026-07-01"), false,
    "Wed key must not appear after canonicalization");
});

test("Wed→Tue locked row round-trips unchanged: same canonical key, same hours", () => {
  // Existing stored as Wed→Tue; submitted payload uses Mon→Sun.
  // After canonicalization both map to "2026-07-06" with 40h → allowed.
  const existing = aggregateExistingRows([{ startYmd: "2026-07-01", endYmd: "2026-07-07", hours: 40 }]);
  const submittedWeeks = new Map([["2026-07-06", 40]]);
  const weekYmd = "2026-07-06";
  const existingHours  = existing.get(weekYmd) ?? 0;
  const submittedHours = submittedWeeks.get(weekYmd) ?? 0;
  assert.equal(Math.round(existingHours * 100), Math.round(submittedHours * 100),
    "40h Wed→Tue existing must compare equal to 40h Mon→Sun submitted (same canonical Monday)");
});

test("Wed→Tue locked row omitted from payload is detected as a change after canonicalization", () => {
  // Payload does not include the week → submittedHours = 0.
  // existingHours=40 ≠ submittedHours=0 → mismatch → must throw.
  const existing = aggregateExistingRows([{ startYmd: "2026-07-01", endYmd: "2026-07-07", hours: 40 }]);
  const submittedWeeks = new Map<string, number>(); // empty
  const weekYmd = "2026-07-06";
  const existingHours  = existing.get(weekYmd) ?? 0;
  const submittedHours = submittedWeeks.get(weekYmd) ?? 0;
  assert.notEqual(Math.round(existingHours * 100), Math.round(submittedHours * 100),
    "omitting a locked Wed→Tue row must produce a mismatch (40h existing vs 0h omitted)");
});

test("new positive hours submitted for a locked week with no existing row are caught", () => {
  // No existing row for "2026-07-06"; payload submits 40h for that locked Monday.
  // existingHours=0 ≠ submittedHours=40 → must be rejected.
  const existing = aggregateExistingRows([]); // nothing stored
  const submittedWeeks = new Map([["2026-07-06", 40]]);
  const weekYmd = "2026-07-06";
  const existingHours  = existing.get(weekYmd) ?? 0;
  const submittedHours = submittedWeeks.get(weekYmd) ?? 0;
  assert.notEqual(Math.round(existingHours * 100), Math.round(submittedHours * 100),
    "new 40h for a locked past week with no existing row must produce a mismatch");
});

test("two rows in different canonical weeks aggregate independently", () => {
  const existing = aggregateExistingRows([
    { startYmd: "2026-07-01", endYmd: "2026-07-07", hours: 40 }, // canonical Mon 2026-07-06
    { startYmd: "2026-07-13", endYmd: "2026-07-19", hours: 20 }, // canonical Mon 2026-07-13
  ]);
  assert.equal(existing.get("2026-07-06"), 40);
  assert.equal(existing.get("2026-07-13"), 20);
  assert.equal(existing.size, 2);
});

test("two existing rows in the same canonical week (e.g. duplicate RWI) are summed", () => {
  // Both rows fall in the week of 2026-07-06; their hours must be summed before
  // comparison so a submitted 60h round-trips correctly against two stored 30h rows.
  const existing = aggregateExistingRows([
    { startYmd: "2026-07-06", endYmd: "2026-07-12", hours: 30 },
    { startYmd: "2026-07-01", endYmd: "2026-07-07", hours: 30 }, // Wed→Tue, same canonical Mon
  ]);
  assert.equal(existing.get("2026-07-06"), 60,
    "two rows in the same canonical week must be summed to 60h");
});

test("dateless zero-hour clear row: person registered → empty submitted map → existing locked row caught", () => {
  // A payload row like { AssignedTo: "guid", AllocationHour: 0 } has no start date.
  // validateCanonicalWeeklyHoursRow accepts it (zero rows may omit dates), so
  // canonicalMondayWeekWindow is never called and no week is added to the map.
  // The person must still be registered in policyPersonIds so the DB probe runs.
  // Their submitted map is empty, so the union check sees:
  //   existingHours=40 (locked week) vs submittedHours=0 (missing) → mismatch → 423.

  // Simulate: person is registered but submitted map is empty (no weeks parsed).
  const submittedWeeks = new Map<string, number>(); // empty — no date derived

  // Simulate: DB probe finds a locked existing 40h row for that person.
  const existing = aggregateExistingRows([{ startYmd: "2026-07-06", endYmd: "2026-07-12", hours: 40 }]);

  // Union of existing + submitted keys: only "2026-07-06" from existing.
  const allWeeks = new Set([...existing.keys(), ...submittedWeeks.keys()]);
  assert.equal(allWeeks.size, 1);
  assert.ok(allWeeks.has("2026-07-06"));

  // The check must find a mismatch: 40h existing vs 0h submitted (absent from payload).
  const weekYmd = "2026-07-06";
  const existingHours  = existing.get(weekYmd) ?? 0;
  const submittedHours = submittedWeeks.get(weekYmd) ?? 0;
  assert.notEqual(Math.round(existingHours * 100), Math.round(submittedHours * 100),
    "a dateless clear row that would delete a locked 40h row must produce a mismatch → 423");
});

test("route returns HTTP 423 for LOCKED_PAST_WEEK (same class as allocation_locked)", () => {
  assert.ok(proxyRoutesSrc, "rmone-proxy.ts not available — see preceding test");
  assert.match(
    proxyRoutesSrc!,
    /LOCKED_PAST_WEEK[\s\S]{0,400}status\(423\)/,
    "LOCKED_PAST_WEEK errors must produce a 423 response",
  );
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
if (failed === 0) {
  console.log(`✓ All ${passed} tests passed.`);
} else {
  console.log(`${passed} passed, ${failed} FAILED.`);
  process.exit(1);
}
