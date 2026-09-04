/**
 * Regression tests: open-slot auto-consume matcher (task: confirm auto-filled
 * open roles never retire the wrong slot).
 *
 * findAutoConsumeOpenSlotRds soft-deletes demand rows best-effort and
 * invisibly — a matching bug would silently destroy tracked demand. The pure
 * decision function `matchAutoConsumeOpenSlot` (lib/openSlotAutoConsume.ts)
 * is extracted from that provider function and tested here without a DB:
 *
 *  A) overlap boundaries (inclusive; start == slot end still matches)
 *  B) non-overlap → no action
 *  C) missing/invalid dates on EITHER side → no action (fail closed)
 *  D) role matched via TypeName only (any provided name counts)
 *  E) "(2)" duplicate-suffix slot matching
 *  F) multiple overlapping same-role slots → earliest-start, exactly ONE
 *  G) route-level static analysis: /assign-resource's explicit
 *     ConsumeOpenSlotRaIds path and multi-allocation saves BYPASS auto-consume
 *  H) provider static analysis: findAutoConsumeOpenSlotRds delegates to this
 *     tested matcher
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  matchAutoConsumeOpenSlot,
  normalizeRoleName,
  parseDateStrict,
  type OpenSlotCandidate,
} from "../openSlotAutoConsume.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routeSrc = readFileSync(path.resolve(__dirname, "../../routes/rmone-proxy.ts"), "utf8");
const providerSrc = readFileSync(path.resolve(__dirname, "../rds-provider.ts"), "utf8");

// ─── tiny test runner (same pattern as saveWeeklyHoursGuard.test.ts) ─────────
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

function slot(over: Partial<OpenSlotCandidate> & { raIds?: number[] }): OpenSlotCandidate {
  return {
    role: "Project Manager",
    startDate: "2026-01-05",
    endDate: "2026-03-27",
    raIds: [101, 102],
    ...over,
  };
}

// ─── A) Overlap boundaries ────────────────────────────────────────────────────
console.log("\nA) Overlap boundaries (inclusive)");

test("assignment start == slot end → still overlaps (exact boundary)", () => {
  const s = slot({ endDate: "2026-03-27" });
  const m = matchAutoConsumeOpenSlot([s], ["Project Manager"], "2026-03-27", "2026-06-30");
  assert.ok(m, "exact-boundary overlap (start == slot end) must match");
  assert.deepEqual(m!.raIds, [101, 102]);
});

test("assignment end == slot start → still overlaps (other boundary)", () => {
  const s = slot({ startDate: "2026-01-05" });
  const m = matchAutoConsumeOpenSlot([s], ["Project Manager"], "2025-11-01", "2026-01-05");
  assert.ok(m, "exact-boundary overlap (end == slot start) must match");
});

test("assignment fully inside the slot window → overlaps", () => {
  const m = matchAutoConsumeOpenSlot([slot({})], ["Project Manager"], "2026-02-01", "2026-02-28");
  assert.ok(m);
});

test("slot fully inside the assignment window → overlaps", () => {
  const m = matchAutoConsumeOpenSlot([slot({})], ["Project Manager"], "2025-12-01", "2026-12-31");
  assert.ok(m);
});

// ─── B) Non-overlap → no action ──────────────────────────────────────────────
console.log("\nB) Non-overlap → no action");

test("assignment starts the day after the slot ends → NO match", () => {
  const m = matchAutoConsumeOpenSlot([slot({ endDate: "2026-03-27" })], ["Project Manager"], "2026-03-28", "2026-06-30");
  assert.equal(m, null, "a same-role member added for a LATER period must not retire the slot");
});

test("assignment ends the day before the slot starts → NO match", () => {
  const m = matchAutoConsumeOpenSlot([slot({ startDate: "2026-01-05" })], ["Project Manager"], "2025-10-01", "2026-01-04");
  assert.equal(m, null);
});

// ─── C) Missing / invalid dates → no action (fail closed) ────────────────────
console.log("\nC) Missing/invalid dates on either side → no action");

test("assignment start missing → NO match", () => {
  const m = matchAutoConsumeOpenSlot([slot({})], ["Project Manager"], undefined, "2026-06-30");
  assert.equal(m, null, "overlap is MANDATORY — a missing assignment start must fail closed");
});

test("assignment end missing → NO match", () => {
  const m = matchAutoConsumeOpenSlot([slot({})], ["Project Manager"], "2026-02-01", undefined);
  assert.equal(m, null);
});

test("both assignment dates missing → NO match even with a same-role slot", () => {
  const m = matchAutoConsumeOpenSlot([slot({})], ["Project Manager"]);
  assert.equal(m, null);
});

test("assignment dates unparseable → NO match", () => {
  const m = matchAutoConsumeOpenSlot([slot({})], ["Project Manager"], "not-a-date", "also-junk");
  assert.equal(m, null);
});

test("slot start missing → that slot ineligible", () => {
  const m = matchAutoConsumeOpenSlot([slot({ startDate: null })], ["Project Manager"], "2026-02-01", "2026-02-28");
  assert.equal(m, null);
});

test("slot end missing → that slot ineligible", () => {
  const m = matchAutoConsumeOpenSlot([slot({ endDate: "" })], ["Project Manager"], "2026-02-01", "2026-02-28");
  assert.equal(m, null);
});

test("slot dates unparseable → that slot ineligible", () => {
  const m = matchAutoConsumeOpenSlot([slot({ startDate: "??", endDate: "??" })], ["Project Manager"], "2026-02-01", "2026-02-28");
  assert.equal(m, null);
});

test("normalized-invalid calendar date (2026-02-30) on the assignment → NO match", () => {
  // new Date("2026-02-30") silently normalizes to Mar 2 — the strict parser
  // must reject it instead of inventing a valid overlap window.
  const m = matchAutoConsumeOpenSlot([slot({})], ["Project Manager"], "2026-02-30", "2026-03-15");
  assert.equal(m, null, "impossible calendar dates must fail closed, never normalize");
});

test("normalized-invalid calendar date on the slot side → that slot ineligible", () => {
  const m = matchAutoConsumeOpenSlot(
    [slot({ startDate: "2026-02-30", endDate: "2026-06-30" })],
    ["Project Manager"], "2026-03-01", "2026-03-31",
  );
  assert.equal(m, null);
});

test('malformed-but-Date-accepted string ("2026-01-05junk") → NO match', () => {
  const m = matchAutoConsumeOpenSlot([slot({})], ["Project Manager"], "2026-01-05junk", "2026-06-30");
  assert.equal(m, null, "trailing junk must not be accepted as a date");
});

test('date with trailing junk after a space ("2026-01-05 junk") → NO match', () => {
  const m = matchAutoConsumeOpenSlot([slot({})], ["Project Manager"], "2026-01-05 junk", "2026-06-30");
  assert.equal(m, null);
});

test("reversed assignment range (start after end) → NO match", () => {
  const m = matchAutoConsumeOpenSlot([slot({})], ["Project Manager"], "2026-03-15", "2026-02-01");
  assert.equal(m, null, "a reversed assignment window is invalid input — fail closed");
});

test("reversed slot range → that slot ineligible, valid sibling still matches", () => {
  const reversed = slot({ startDate: "2026-06-30", endDate: "2026-01-05", raIds: [910] });
  const valid = slot({ raIds: [911] });
  const m = matchAutoConsumeOpenSlot([reversed, valid], ["Project Manager"], "2026-02-01", "2026-02-28");
  assert.ok(m);
  assert.deepEqual(m!.raIds, [911], "the reversed-range slot must never be picked");
});

test("parseDateStrict: accepts real dates/datetimes, rejects garbage", () => {
  assert.ok(Number.isFinite(parseDateStrict("2026-01-05")));
  assert.ok(Number.isFinite(parseDateStrict("2026-01-05T00:00:00.000Z")));
  assert.ok(Number.isFinite(parseDateStrict(new Date("2026-01-05")))); // mssql driver returns Date objects
  assert.ok(Number.isNaN(parseDateStrict("2026-02-30")), "Feb 30 must be NaN");
  assert.ok(Number.isNaN(parseDateStrict("2026-13-01")), "month 13 must be NaN");
  assert.ok(Number.isNaN(parseDateStrict("2026-01-05junk")));
  assert.ok(Number.isNaN(parseDateStrict("2026-01-05T25:00")), "hour 25 must be NaN");
  assert.ok(Number.isNaN(parseDateStrict("")));
  assert.ok(Number.isNaN(parseDateStrict(null)));
  assert.ok(Number.isNaN(parseDateStrict(new Date("invalid"))));
});

test("slot dates as Date objects (mssql driver shape) still match", () => {
  const s = slot({ startDate: new Date("2026-01-05") as unknown as string, endDate: new Date("2026-03-27") as unknown as string });
  const m = matchAutoConsumeOpenSlot([s], ["Project Manager"], "2026-02-01", "2026-02-28");
  assert.ok(m, "Date instances from the DB driver must be accepted");
});

test("dateless slot is skipped but a dated overlapping sibling still matches", () => {
  const dateless = slot({ startDate: null, endDate: null, raIds: [900] });
  const dated = slot({ raIds: [901] });
  const m = matchAutoConsumeOpenSlot([dateless, dated], ["Project Manager"], "2026-02-01", "2026-02-28");
  assert.ok(m);
  assert.deepEqual(m!.raIds, [901], "must pick the dated slot, never the dateless one");
});

// ─── D) Role matching: TypeName vs Title vs JobTitleName ────────────────────
console.log("\nD) Role match via any provided name (TypeName-only case)");

test("role matched via TypeName only (Title/JobTitleName diverge)", () => {
  // The route passes [TypeName, Title, JobTitleName]. Here only the TypeName
  // ("Structural Engineer") matches the slot's role — the person's job title
  // is something else entirely.
  const s = slot({ role: "Structural Engineer" });
  const m = matchAutoConsumeOpenSlot(
    [s],
    ["Structural Engineer", "Senior Associate", "Engineer III"],
    "2026-02-01", "2026-02-28",
  );
  assert.ok(m, "TypeName alone must be enough to match the slot's role");
});

test("no provided name matches the slot role → NO match", () => {
  const s = slot({ role: "Structural Engineer" });
  const m = matchAutoConsumeOpenSlot([s], ["Architect", "Designer"], "2026-02-01", "2026-02-28");
  assert.equal(m, null);
});

test("role match is case-insensitive and trims whitespace", () => {
  const s = slot({ role: "Structural Engineer" });
  const m = matchAutoConsumeOpenSlot([s], ["  sTRUCTURAL engineer  "], "2026-02-01", "2026-02-28");
  assert.ok(m);
});

test("empty/blank role names → NO match, never a wildcard", () => {
  const m = matchAutoConsumeOpenSlot([slot({})], ["", "   "], "2026-02-01", "2026-02-28");
  assert.equal(m, null, "blank names must not match every slot");
});

test("slot with empty raIds is never returned", () => {
  const m = matchAutoConsumeOpenSlot([slot({ raIds: [] })], ["Project Manager"], "2026-02-01", "2026-02-28");
  assert.equal(m, null, "a slot with no backing RA rows must be ignored");
});

// ─── E) "(N)" duplicate-suffix slots ─────────────────────────────────────────
console.log('\nE) "(2)" duplicate-suffix slot matching');

test('slot named "Project Manager (2)" matches role "Project Manager"', () => {
  const s = slot({ role: "Project Manager (2)", raIds: [201] });
  const m = matchAutoConsumeOpenSlot([s], ["Project Manager"], "2026-02-01", "2026-02-28");
  assert.ok(m, 'the "(N)" duplicate suffix must be ignored when matching');
  assert.deepEqual(m!.raIds, [201]);
});

test("normalizeRoleName strips only a TRAILING (N) suffix", () => {
  assert.equal(normalizeRoleName("Project Manager (2)"), "project manager");
  assert.equal(normalizeRoleName("Project Manager (12)"), "project manager");
  // A parenthetical that is not a bare number is part of the role name.
  assert.equal(normalizeRoleName("Manager (Interim)"), "manager (interim)");
  // Mid-string numbers stay.
  assert.equal(normalizeRoleName("Level (2) Engineer"), "level (2) engineer");
});

test('role name provided WITH a suffix also matches an unsuffixed slot', () => {
  const s = slot({ role: "Project Manager" });
  const m = matchAutoConsumeOpenSlot([s], ["Project Manager (2)"], "2026-02-01", "2026-02-28");
  assert.ok(m, "normalization applies to both sides");
});

// ─── F) Multiple overlapping slots → earliest start, exactly one ─────────────
console.log("\nF) Multiple overlapping same-role slots → earliest-start single retirement");

test("two overlapping slots → the earlier-starting one is retired", () => {
  const later = slot({ startDate: "2026-02-01", endDate: "2026-05-29", raIds: [302] });
  const earlier = slot({ startDate: "2026-01-05", endDate: "2026-04-24", raIds: [301] });
  const m = matchAutoConsumeOpenSlot([later, earlier], ["Project Manager"], "2026-02-15", "2026-03-15");
  assert.ok(m);
  assert.deepEqual(m!.raIds, [301], "must retire the earliest-starting (most overdue) slot");
});

test("three overlapping slots (incl. a (2) duplicate) → still exactly one, earliest", () => {
  const a = slot({ role: "Project Manager",     startDate: "2026-03-01", endDate: "2026-06-30", raIds: [401] });
  const b = slot({ role: "Project Manager (2)", startDate: "2026-01-05", endDate: "2026-06-30", raIds: [402] });
  const c = slot({ role: "Project Manager (3)", startDate: "2026-02-01", endDate: "2026-06-30", raIds: [403] });
  const m = matchAutoConsumeOpenSlot([a, b, c], ["Project Manager"], "2026-03-10", "2026-04-10");
  assert.ok(m);
  assert.deepEqual(m!.raIds, [402], "earliest start wins across suffixed duplicates too");
});

test("the returned value is ONE slot's raIds — never a union of several slots", () => {
  const a = slot({ startDate: "2026-01-05", raIds: [501, 502] });
  const b = slot({ role: "Project Manager (2)", startDate: "2026-01-12", raIds: [503, 504] });
  const m = matchAutoConsumeOpenSlot([a, b], ["Project Manager"], "2026-02-01", "2026-02-28");
  assert.ok(m);
  assert.deepEqual(m!.raIds, [501, 502]);
  for (const id of [503, 504]) {
    assert.ok(!m!.raIds.includes(id), `raIds must not contain ${id} from the other slot`);
  }
});

test("only the NON-overlapping earlier slot exists → the later overlapping one is picked", () => {
  // Earliest-start preference applies only among OVERLAPPING slots.
  const past = slot({ startDate: "2025-01-01", endDate: "2025-06-30", raIds: [601] });
  const current = slot({ role: "Project Manager (2)", startDate: "2026-02-01", endDate: "2026-06-30", raIds: [602] });
  const m = matchAutoConsumeOpenSlot([past, current], ["Project Manager"], "2026-03-01", "2026-03-31");
  assert.ok(m);
  assert.deepEqual(m!.raIds, [602], "a non-overlapping slot must never win on start date alone");
});

test("input slot order does not change the result", () => {
  const a = slot({ startDate: "2026-01-05", raIds: [701] });
  const b = slot({ role: "Project Manager (2)", startDate: "2026-02-01", raIds: [702] });
  const m1 = matchAutoConsumeOpenSlot([a, b], ["Project Manager"], "2026-02-15", "2026-03-15");
  const m2 = matchAutoConsumeOpenSlot([b, a], ["Project Manager"], "2026-02-15", "2026-03-15");
  assert.deepEqual(m1!.raIds, m2!.raIds);
  assert.deepEqual(m1!.raIds, [701]);
});

// ─── G) Route-level static analysis: /assign-resource bypass rules ──────────
console.log("\nG) /assign-resource — explicit-IDs path and multi-allocation saves bypass auto-consume");

// Extract the /assign-resource handler body.
const routeStart = routeSrc.indexOf('router.post("/assign-resource"');
assert.ok(routeStart !== -1, "/assign-resource route not found in rmone-proxy.ts");
const routeEnd = routeSrc.indexOf('router.post("', routeStart + 10);
const assignRoute = routeSrc.slice(routeStart, routeEnd === -1 ? undefined : routeEnd);

test("explicit ConsumeOpenSlotRaIds path exists and guards on a NON-EMPTY id list", () => {
  assert.ok(
    /if\s*\(\s*Array\.isArray\(payload\.ConsumeOpenSlotRaIds\)\s*&&\s*payload\.ConsumeOpenSlotRaIds\.length\s*>\s*0\s*\)/.test(assignRoute),
    "the explicit path must gate on Array.isArray(...) && length > 0",
  );
});

test("auto-consume runs ONLY in the else-branch of the explicit-IDs check (bypass when IDs given)", () => {
  // The auto-consume call must live in an `else if` chained to the explicit
  // ConsumeOpenSlotRaIds branch, so a save that carries explicit slot IDs
  // NEVER also runs the fuzzy matcher.
  assert.ok(
    /\}\s*else\s+if\s*\(\s*!payload\.RequireOpenSlotSelection\s*&&\s*payload\.Allocations\.length\s*===\s*1\s*\)\s*\{/.test(assignRoute),
    "auto-consume must be an explicit-selection-safe else-if chained to the IDs path",
  );
  const explicitIdx = assignRoute.indexOf("payload.ConsumeOpenSlotRaIds");
  const autoIdx = assignRoute.indexOf("findAutoConsumeOpenSlotRds");
  assert.ok(explicitIdx !== -1 && autoIdx !== -1 && explicitIdx < autoIdx,
    "findAutoConsumeOpenSlotRds must appear after (inside the else of) the explicit-IDs branch");
});

test("multi-allocation saves bypass auto-consume (length === 1 gate)", () => {
  // The gate is strict equality to 1 — a save adding several people must not
  // guess which of them fills the slot.
  const gate = assignRoute.match(/else\s+if\s*\(\s*!payload\.RequireOpenSlotSelection\s*&&\s*payload\.Allocations\.length\s*===\s*1\s*\)/);
  assert.ok(gate, "auto-consume must be gated on no explicit-selection requirement and payload.Allocations.length === 1");
  // And findAutoConsumeOpenSlotRds is only called inside that gated block.
  const gateIdx = assignRoute.indexOf(gate![0]);
  const autoIdx = assignRoute.indexOf("findAutoConsumeOpenSlotRds");
  assert.ok(autoIdx > gateIdx, "matcher call must live inside the length===1 block");
  assert.equal(
    assignRoute.split("findAutoConsumeOpenSlotRds").length - 1, 1,
    "findAutoConsumeOpenSlotRds must be called exactly once in the route",
  );
});

test("auto-consume path CONSUMES (soft-delete), never transfers", () => {
  const gateIdx = assignRoute.indexOf("!payload.RequireOpenSlotSelection && payload.Allocations.length === 1");
  const block = assignRoute.slice(gateIdx);
  assert.ok(block.includes("consumeOpenSlotsRds"), "auto path must call consumeOpenSlotsRds");
  assert.ok(!block.includes("transferOpenSlotsRds"),
    "auto path must NOT transfer demand rows (would double-count the member's own hours)");
});

test("auto-consume is best-effort: wrapped in try/catch so a failure never fails the assignment", () => {
  const gateIdx = assignRoute.indexOf("!payload.RequireOpenSlotSelection && payload.Allocations.length === 1");
  const autoIdx = assignRoute.indexOf("findAutoConsumeOpenSlotRds");
  const between = assignRoute.slice(gateIdx, autoIdx);
  assert.ok(/try\s*\{/.test(between), "matcher call must be inside a try block");
  const after = assignRoute.slice(autoIdx, autoIdx + 2000);
  assert.ok(/catch\s*\(/.test(after), "with a catch that logs instead of failing the save");
});

test("route passes TypeName, Title AND JobTitleName as candidate role names", () => {
  assert.ok(
    /\[\s*a\.TypeName\s*,\s*a\.Title\s*,\s*a\.JobTitleName\s*\]/.test(assignRoute),
    "all three name fields must be offered to the matcher (TypeName carries the selected role)",
  );
});

test("an explicitly-required duplicate-slot choice suppresses heuristic auto-consume", () => {
  assert.match(
    assignRoute,
    /else\s+if\s*\(\s*!payload\.RequireOpenSlotSelection\s*&&\s*payload\.Allocations\.length\s*===\s*1\s*\)/,
    "the server must not guess an open slot when the client says an operator selection is required",
  );
});

// ─── H) Provider delegates to tested pure matching logic ─────────────────────
// Post-merge (#347 + #349): the DB wrapper delegates the destructive matching
// decision to pickAutoConsumeWindow (lib/openSlotMatch — window-level, unique-
// match-only, unit-tested) and uses this module's strict helpers
// (normalizeRoleName + parseDateStrict) for role and date handling.
console.log("\nH) findAutoConsumeOpenSlotRds delegates to tested pure matching logic");

test("provider function delegates to pickAutoConsumeWindow (no duplicate inline logic)", () => {
  const fnStart = providerSrc.indexOf("export async function findAutoConsumeOpenSlotRds(");
  assert.ok(fnStart !== -1, "findAutoConsumeOpenSlotRds not found in rds-provider.ts");
  const after = providerSrc.slice(fnStart + 1);
  const nextFn = after.search(/\nexport\s+(async\s+)?function\s|\nasync\s+function\s|\nfunction\s/);
  const fnSrc = nextFn === -1 ? after : after.slice(0, nextFn);
  assert.ok(fnSrc.includes("pickAutoConsumeWindow("),
    "the DB wrapper must delegate matching to the tested pure window matcher");
  assert.ok(fnSrc.includes("parseDateStrict("),
    "the wrapper must gate the member's dates through parseDateStrict, never bare new Date()");
  assert.ok(fnSrc.includes("normalizeRoleName"),
    "the wrapper must normalize roles via normalizeRoleName");
  assert.ok(!/localeCompare/.test(fnSrc),
    "no inline sort/matching logic should remain in the wrapper");
});

test("provider imports the strict helpers and the window matcher", () => {
  assert.ok(
    /import\s*\{[^}]*parseDateStrict[^}]*\}\s*from\s*["']\.\/openSlotAutoConsume\.js["']/.test(providerSrc),
    "rds-provider.ts must import parseDateStrict from ./openSlotAutoConsume.js",
  );
  assert.ok(
    /import\s*\{\s*pickAutoConsumeWindow\s*\}\s*from\s*["']\.\/openSlotMatch\.js["']/.test(providerSrc),
    "rds-provider.ts must import pickAutoConsumeWindow from ./openSlotMatch.js",
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
