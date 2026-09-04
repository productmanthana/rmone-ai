/**
 * Regression tests: matchMemberAlloc always picks the RIGHT person row.
 *
 * Covers the three cooperating causes of the ghost-member bug:
 *  A) Same display name, different GUIDs → GUID match always wins
 *  B) GUID compare is case-insensitive (server may return upper-case GUIDs)
 *  C) Name fallback still works when id columns hold display names (non-GUID)
 *  D) Name fallback still works when id columns are empty / missing
 *  E) Synthesised row returned when no allocation row exists at all
 */

import assert from "node:assert/strict";
import {
  buildWeeklyAllocations,
  matchMemberAlloc,
  type AllocationsResponse,
  type AllocationRow,
} from "../phaseHours.js";

// ─── tiny test runner (mirrors the project's existing pattern) ────────────────
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

// ─── shared test data ─────────────────────────────────────────────────────────
const GUID_A = "aaaaaaaa-0000-0000-0000-000000000001";
const GUID_B = "bbbbbbbb-0000-0000-0000-000000000002";
const PROJECT = "PMM-001";

function makeRow(override: Partial<AllocationRow> = {}): AllocationRow {
  return {
    ID: 1,
    ProjectID: PROJECT,
    AssignedTo: GUID_A,
    AssignedToName: "Matthew Johnson",
    PctAllocation: 40,
    ...override,
  };
}

function makeData(existing: AllocationRow[], newAllocs: AllocationRow[] = []): AllocationsResponse {
  return { ExistingAllocations: existing, NewAllocations: newAllocs };
}

// ─── A) Duplicate-name accounts → GUID match beats name match ────────────────
console.log("\nA) Duplicate-name accounts — GUID match wins outright");

test("returns the row whose GUID matches, ignoring the same-named row", () => {
  const rowA = makeRow({ AssignedTo: GUID_A, AssignedToName: "Matthew Johnson" });
  const rowB = makeRow({ AssignedTo: GUID_B, AssignedToName: "Matthew Johnson", ID: 2 });
  const data = makeData([rowA, rowB]);

  // Asking for person B — must get rowB, not rowA (which would be first name match)
  const result = matchMemberAlloc(data, { name: "Matthew Johnson", resourceId: GUID_B }, PROJECT);
  assert.ok(result !== null, "should find a row");
  assert.equal(
    String(result.AssignedTo ?? "").toLowerCase(),
    GUID_B.toLowerCase(),
    "GUID-B row must be returned, not the first name-matched GUID-A row",
  );
});

test("id-match scan covers ALL rows before any name-matching starts", () => {
  // rowA is listed first, rowB second — name-first would return rowA immediately.
  const rowA = makeRow({ AssignedTo: GUID_A, AssignedToName: "Taylor Smith" });
  const rowB = makeRow({ AssignedTo: GUID_B, AssignedToName: "Taylor Smith", ID: 2 });
  const data = makeData([rowA, rowB]);

  const result = matchMemberAlloc(data, { name: "Taylor Smith", resourceId: GUID_B }, PROJECT);
  assert.equal(String(result?.AssignedTo ?? "").toLowerCase(), GUID_B.toLowerCase());
});

test("a row with a DIFFERENT GUID is never returned via name match (GUID-shape guard)", () => {
  // Only rowA exists; person prop asks for GUID_B — must NOT return rowA via name.
  const rowA = makeRow({ AssignedTo: GUID_A, AssignedToName: "Jordan Lee" });
  const data = makeData([rowA]);

  const result = matchMemberAlloc(data, { name: "Jordan Lee", resourceId: GUID_B }, PROJECT);
  // Result should be a synthesised stub (ID:0), not rowA
  assert.ok(result !== null, "should still return something (synthesised row)");
  assert.equal(
    result!.ID,
    0,
    "should be the synthesised fallback row (ID=0), not the wrong-GUID row",
  );
});

// ─── B) GUID comparison is case-insensitive ───────────────────────────────────
console.log("\nB) GUID comparison is case-insensitive");

test("GUID in row is uppercase — still matches lowercase resourceId", () => {
  const rowA = makeRow({ AssignedTo: GUID_A.toUpperCase() });
  const data = makeData([rowA]);

  const result = matchMemberAlloc(data, { name: "Matthew Johnson", resourceId: GUID_A.toLowerCase() }, PROJECT);
  assert.ok(result !== null);
  assert.equal(result!.ID, rowA.ID);
});

test("GUID in row is lowercase — still matches uppercase resourceId", () => {
  const rowA = makeRow({ AssignedTo: GUID_A.toLowerCase() });
  const data = makeData([rowA]);

  const result = matchMemberAlloc(data, { name: "Matthew Johnson", resourceId: GUID_A.toUpperCase() }, PROJECT);
  assert.ok(result !== null);
  assert.equal(result!.ID, rowA.ID);
});

test("mixed-case GUID in row matches its own mixed-case resourceId", () => {
  const mixed = "AAAAAAAA-0000-0000-0000-000000000001";
  const rowA = makeRow({ AssignedTo: mixed });
  const data = makeData([rowA]);

  const result = matchMemberAlloc(data, { name: "Matthew Johnson", resourceId: mixed.toLowerCase() }, PROJECT);
  assert.ok(result !== null);
  assert.equal(result!.ID, rowA.ID);
});

// ─── C) Name fallback when id columns hold display names (not GUIDs) ─────────
console.log("\nC) Name fallback — id columns hold display names (non-GUID)");

test("matches by AssignedToName when AssignedTo is a display string", () => {
  // Some older tenants stored the display name in AssignedTo instead of a GUID
  const row = makeRow({ AssignedTo: "Matthew Johnson", AssignedToName: "Matthew Johnson" });
  const data = makeData([row]);

  // person prop has an empty resourceId — should still match by name
  const result = matchMemberAlloc(data, { name: "Matthew Johnson", resourceId: "" }, PROJECT);
  assert.ok(result !== null);
  assert.equal(result!.ID, row.ID);
});

test("GUID-shape guard is inactive when the row-side id is not a GUID", () => {
  // Row has a non-GUID id; person has a real GUID. The guard must NOT fire
  // (it only blocks when BOTH sides are GUID-shaped but differ).
  const row = makeRow({ AssignedTo: "display-name-id", AssignedToName: "Sam Rivera" });
  const data = makeData([row]);

  const result = matchMemberAlloc(data, { name: "Sam Rivera", resourceId: GUID_A }, PROJECT);
  // Should match by name even though person.resourceId differs from row AssignedTo
  assert.ok(result !== null);
  assert.equal(result!.ID, row.ID);
});

test("matches via FirstName+LastName columns when AssignedToName is blank", () => {
  const row = makeRow({ AssignedTo: "display-only", AssignedToName: "", FirstName: "Alex", LastName: "Chen" });
  const data = makeData([row]);

  const result = matchMemberAlloc(data, { name: "Alex Chen", resourceId: "" }, PROJECT);
  assert.ok(result !== null);
  assert.equal(result!.ID, row.ID);
});

test("matches via ResourceName column", () => {
  const row: AllocationRow = {
    ID: 99,
    ProjectID: PROJECT,
    AssignedTo: "",
    ResourceName: "Casey Park",
    PctAllocation: 20,
  };
  const data = makeData([row]);

  const result = matchMemberAlloc(data, { name: "Casey Park", resourceId: "" }, PROJECT);
  assert.ok(result !== null);
  assert.equal(result!.ID, 99);
});

// ─── D) Name fallback when id columns are empty / missing ────────────────────
console.log("\nD) Name fallback — id columns empty or absent");

test("matches by AssignedToName when all id fields are empty strings", () => {
  const row: AllocationRow = {
    ID: 5,
    ProjectID: PROJECT,
    AssignedTo: "",
    ResourceId: "",
    AssignedToName: "Morgan Blake",
  };
  const data = makeData([row]);

  const result = matchMemberAlloc(data, { name: "Morgan Blake", resourceId: "" }, PROJECT);
  assert.ok(result !== null);
  assert.equal(result!.ID, 5);
});

test("partial name (first+last word) still matches multi-word names", () => {
  // The two-word guard: normWords[0] === fullWords[0] && last === last
  const row = makeRow({ AssignedTo: "", AssignedToName: "Jean-Marie Dupont" });
  const data = makeData([row]);

  const result = matchMemberAlloc(data, { name: "Jean-Marie Dupont", resourceId: "" }, PROJECT);
  assert.ok(result !== null);
  assert.equal(result!.ID, row.ID);
});

// ─── E) Synthesised row when no match exists at all ──────────────────────────
console.log("\nE) Synthesised fallback row");

test("returns synthesised stub (ID=0) when ExistingAllocations is empty", () => {
  const data = makeData([]);
  const result = matchMemberAlloc(data, { name: "Nobody Here", resourceId: GUID_A }, PROJECT);
  assert.ok(result !== null);
  assert.equal(result!.ID, 0);
  assert.equal(result!.AssignedTo, GUID_A, "stub carries the resourceId from the person prop");
  assert.equal(result!.AssignedToName, "Nobody Here");
});

test("returns null when rawData is null", () => {
  const result = matchMemberAlloc(null, { name: "Anyone", resourceId: GUID_A }, PROJECT);
  assert.equal(result, null);
});

test("NewAllocations row is also searched (id match)", () => {
  const row = makeRow({ AssignedTo: GUID_B, ID: 77 });
  const data: AllocationsResponse = { ExistingAllocations: [], NewAllocations: [row] };
  const result = matchMemberAlloc(data, { name: "Matthew Johnson", resourceId: GUID_B }, PROJECT);
  assert.ok(result !== null);
  // NewAllocations match wraps the row with Percentage:0, IsModified:true
  assert.equal(result!.AssignedTo, GUID_B);
});

// ─── F) Weekly write contract — old totals cannot override a week ─────────────
console.log("\nF) Weekly write contract — old totals cannot override a week");

test("uses the edited weekly hours for PctAllocation, not a legacy assignment total", () => {
  const legacyMember = makeRow({ PctAllocation: 602 });
  const rows = buildWeeklyAllocations([{
    phaseName: "Proposal",
    stageStep: 1,
    color: "#6BA539",
    weeks: [{ key: "24-Mar-25", hours: 4 }],
  }], legacyMember);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].AllocationHour, 4);
  assert.equal(
    rows[0].PctAllocation,
    4,
    "a stale 602h assignment total must never be sent as the weekly percentage mirror",
  );
});

// ─── F) Data-loading + hours-display round-trip (duplicate-name scenario) ──────
//
// matchMemberAlloc is the GUID-first identity resolver used by the web hours
// editor before pre-populating cells. The tests below simulate the round-trip:
//
//   1. ExistingAllocations contains two rows sharing a display name but
//      carrying different GUIDs (real RM ONE scenario: two "Alex Morgan" accounts).
//   2. matchMemberAlloc is called with a specific resourceId (person.resourceId).
//   3. Hours are read from the matched row only.
//
// This confirms the web editor shows the RIGHT person's hours, never the
// same-named other account's, and is symmetric — either account can be edited.
console.log("\nF) Data-loading + hours-display round-trip (duplicate-name scenario)");

/** Simulate how the web hours editor resolves ONE person's hours for a week.
 *  matchMemberAlloc picks the GUID-matched row; we then read the week key from
 *  it — exactly as the phase-hours grid does after matching. */
function webEditorHoursForWeek(
  data: AllocationsResponse,
  person: { name: string; resourceId?: string },
  weekKey: string,
): number {
  const row = matchMemberAlloc(data, person, PROJECT);
  if (!row) return 0;
  const v = Number((row as Record<string, unknown>)[weekKey] ?? 0);
  return isNaN(v) ? 0 : v;
}

/** Sum hours across multiple week keys for the matched row. */
function webEditorHoursMultiWeek(
  data: AllocationsResponse,
  person: { name: string; resourceId?: string },
  weekKeys: string[],
): number {
  const row = matchMemberAlloc(data, person, PROJECT);
  if (!row) return 0;
  return weekKeys.reduce((sum, wk) => {
    const v = Number((row as Record<string, unknown>)[wk] ?? 0);
    return sum + (isNaN(v) ? 0 : v);
  }, 0);
}

test("hours pre-populate from the GUID-matched row, not the same-named wrong row", () => {
  // Person A (GUID_A): 20 h in week "07-Jul-26"
  // Person B (GUID_B, same display name): 40 h in week "07-Jul-26"
  // When editing person B the editor must show 40 h, not 20 h.
  const WK = "07-Jul-26";
  const rowA: AllocationRow = {
    ID: 1, ProjectID: PROJECT,
    AssignedTo: GUID_A, AssignedToName: "Alex Morgan",
    [WK]: 20,
  };
  const rowB: AllocationRow = {
    ID: 2, ProjectID: PROJECT,
    AssignedTo: GUID_B, AssignedToName: "Alex Morgan",
    [WK]: 40,
  };
  const data = makeData([rowA, rowB]);

  const hoursForB = webEditorHoursForWeek(data, { name: "Alex Morgan", resourceId: GUID_B }, WK);
  assert.equal(hoursForB, 40, "person B should see 40 h (their own row), not 20 h from person A");
});

test("wrong-GUID same-named row contributes zero hours to the editor (excluded by GUID guard)", () => {
  // Only rowA exists; person is GUID_B — matchMemberAlloc must return a
  // synthesised stub (ID=0), so no real hours bleed through.
  const WK = "07-Jul-26";
  const rowA: AllocationRow = {
    ID: 1, ProjectID: PROJECT,
    AssignedTo: GUID_A, AssignedToName: "Alex Morgan",
    [WK]: 20,
  };
  const data = makeData([rowA]);

  const hoursForB = webEditorHoursForWeek(data, { name: "Alex Morgan", resourceId: GUID_B }, WK);
  assert.equal(hoursForB, 0, "GUID_A row must not bleed hours into the GUID_B editor");
});

test("hours sum correctly across multiple weeks for the correct person only", () => {
  // Three weeks; rowA (wrong GUID) has hours in all three.
  // rowB (correct GUID) has its own distinct values.
  const rowA: AllocationRow = {
    ID: 1, ProjectID: PROJECT,
    AssignedTo: GUID_A, AssignedToName: "Riley Chen",
    "07-Jul-26": 8,
    "14-Jul-26": 8,
    "21-Jul-26": 8,
  };
  const rowB: AllocationRow = {
    ID: 2, ProjectID: PROJECT,
    AssignedTo: GUID_B, AssignedToName: "Riley Chen",
    "07-Jul-26": 16,
    "14-Jul-26": 32,
    "21-Jul-26": 0,
  };
  const data = makeData([rowA, rowB]);
  const weeks = ["07-Jul-26", "14-Jul-26", "21-Jul-26"];

  const personB = { name: "Riley Chen", resourceId: GUID_B };
  const row = matchMemberAlloc(data, personB, PROJECT);
  assert.ok(row !== null, "a row must be found for person B");
  assert.equal(String(row!.AssignedTo ?? "").toLowerCase(), GUID_B.toLowerCase(), "matched row must belong to GUID_B");

  assert.equal(webEditorHoursForWeek(data, personB, "07-Jul-26"), 16);
  assert.equal(webEditorHoursForWeek(data, personB, "14-Jul-26"), 32);
  assert.equal(webEditorHoursForWeek(data, personB, "21-Jul-26"), 0);
  assert.equal(webEditorHoursMultiWeek(data, personB, weeks), 48, "total must be 48, not 72 (which would include person A's hours)");
});

test("data-loading picks GUID_A row correctly when editing person A (symmetry check)", () => {
  const WK = "07-Jul-26";
  const rowA: AllocationRow = {
    ID: 1, ProjectID: PROJECT,
    AssignedTo: GUID_A, AssignedToName: "Alex Morgan",
    [WK]: 20,
  };
  const rowB: AllocationRow = {
    ID: 2, ProjectID: PROJECT,
    AssignedTo: GUID_B, AssignedToName: "Alex Morgan",
    [WK]: 40,
  };
  const data = makeData([rowA, rowB]);

  const hoursForA = webEditorHoursForWeek(data, { name: "Alex Morgan", resourceId: GUID_A }, WK);
  assert.equal(hoursForA, 20, "person A should see 20 h (their own row), not 40 h from person B");
});

test("name-match path still populates hours correctly when no GUID is available (no regression)", () => {
  // When resourceId is empty the name-match path must still work.
  const WK = "07-Jul-26";
  const rowA: AllocationRow = {
    ID: 5, ProjectID: PROJECT,
    AssignedTo: "display-key-only",   // not GUID-shaped
    AssignedToName: "Drew Kim",
    [WK]: 24,
  };
  const data = makeData([rowA]);

  const hours = webEditorHoursForWeek(data, { name: "Drew Kim", resourceId: "" }, WK);
  assert.equal(hours, 24, "name-match should still surface the correct hours when GUID is absent");
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
if (failed === 0) {
  console.log(`✓ All ${passed} tests passed.`);
} else {
  console.log(`${passed} passed, ${failed} FAILED.`);
  process.exit(1);
}
