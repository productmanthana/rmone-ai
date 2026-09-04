/**
 * Regression tests: mobile findPersonRow always picks the RIGHT allocation row.
 *
 * Mirrors the web matchMemberAlloc.test.ts scenarios so the same three ghost-
 * member bug causes are covered on mobile:
 *  A) Same display name, different GUIDs → GUID match always wins
 *  B) GUID compare is case-insensitive (server may return upper-case GUIDs)
 *  C) Name fallback still works when id columns hold display names (non-GUID)
 *  D) Name fallback still works when id columns are empty / missing
 */

import assert from "node:assert/strict";
import { findPersonRow, type AllocRow } from "../matchMemberAlloc.js";

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

// ─── shared GUIDs ─────────────────────────────────────────────────────────────
const GUID_A = "aaaaaaaa-0000-0000-0000-000000000001";
const GUID_B = "bbbbbbbb-0000-0000-0000-000000000002";

function row(overrides: Partial<AllocRow> = {}): AllocRow {
  return {
    AssignedTo: GUID_A,
    AssignedToName: "Matthew Johnson",
    ...overrides,
  };
}

// ─── A) Duplicate-name accounts — GUID match wins ────────────────────────────
console.log("\nA) Duplicate-name accounts — GUID match wins outright");

test("returns the row whose GUID matches, skipping the same-named wrong row", () => {
  const rowA = row({ AssignedTo: GUID_A, AssignedToName: "Matthew Johnson" });
  const rowB = row({ AssignedTo: GUID_B, AssignedToName: "Matthew Johnson" });
  const result = findPersonRow([rowA, rowB], { name: "Matthew Johnson", resourceId: GUID_B });
  assert.ok(result !== undefined, "a row should be found");
  assert.equal(
    String(result!.AssignedTo ?? "").toLowerCase(),
    GUID_B.toLowerCase(),
    "GUID-B row must be returned",
  );
});

test("id-match is checked across ALL rows before name-matching starts", () => {
  const rowA = row({ AssignedTo: GUID_A, AssignedToName: "Taylor Smith" });
  const rowB = row({ AssignedTo: GUID_B, AssignedToName: "Taylor Smith" });
  const result = findPersonRow([rowA, rowB], { name: "Taylor Smith", resourceId: GUID_B });
  assert.equal(String(result?.AssignedTo ?? "").toLowerCase(), GUID_B.toLowerCase());
});

test("GUID-shape guard blocks name-matching a wrong-GUID row (no result → undefined)", () => {
  // Only rowA exists; person needs GUID_B — must NOT return rowA via name.
  const rowA = row({ AssignedTo: GUID_A, AssignedToName: "Jordan Lee" });
  const result = findPersonRow([rowA], { name: "Jordan Lee", resourceId: GUID_B });
  assert.equal(result, undefined, "should return undefined — not the wrong-GUID row");
});

// ─── B) GUID comparison is case-insensitive ───────────────────────────────────
console.log("\nB) GUID comparison is case-insensitive");

test("uppercase row GUID matches lowercase resourceId", () => {
  const rowA = row({ AssignedTo: GUID_A.toUpperCase() });
  const result = findPersonRow([rowA], { name: "Matthew Johnson", resourceId: GUID_A.toLowerCase() });
  assert.ok(result !== undefined);
  assert.equal(String(result!.AssignedTo).toUpperCase(), GUID_A.toUpperCase());
});

test("lowercase row GUID matches uppercase resourceId", () => {
  const rowA = row({ AssignedTo: GUID_A.toLowerCase() });
  const result = findPersonRow([rowA], { name: "Matthew Johnson", resourceId: GUID_A.toUpperCase() });
  assert.ok(result !== undefined);
});

// ─── C) Name fallback — id columns hold display names (non-GUID) ─────────────
console.log("\nC) Name fallback — id columns hold display names (non-GUID)");

test("matches by AssignedToName when AssignedTo is a display string, not a GUID", () => {
  const rowA = row({ AssignedTo: "Matthew Johnson", AssignedToName: "Matthew Johnson" });
  const result = findPersonRow([rowA], { name: "Matthew Johnson", resourceId: "" });
  assert.ok(result !== undefined);
});

test("GUID-shape guard inactive when row-side id is not a GUID", () => {
  const rowA = row({ AssignedTo: "some-display-key", AssignedToName: "Sam Rivera" });
  const result = findPersonRow([rowA], { name: "Sam Rivera", resourceId: GUID_A });
  assert.ok(result !== undefined, "should match by name when row side is not GUID-shaped");
});

test("matches via FirstName+LastName when AssignedToName is blank", () => {
  const rowA: AllocRow = {
    AssignedTo: "display-only",
    AssignedToName: "",
    FirstName: "Alex",
    LastName: "Chen",
  };
  const result = findPersonRow([rowA], { name: "Alex Chen", resourceId: "" });
  assert.ok(result !== undefined);
  assert.equal(result!.FirstName, "Alex");
});

test("matches via ResourceName column", () => {
  const rowA: AllocRow = { AssignedTo: "", ResourceName: "Casey Park" };
  const result = findPersonRow([rowA], { name: "Casey Park", resourceId: "" });
  assert.ok(result !== undefined);
  assert.equal(result!.ResourceName, "Casey Park");
});

// ─── D) Name fallback — id columns empty or absent ───────────────────────────
console.log("\nD) Name fallback — id columns empty or absent");

test("matches when all id fields are empty strings", () => {
  const rowA: AllocRow = {
    AssignedTo: "",
    ResourceId: "",
    AssignedToName: "Morgan Blake",
  };
  const result = findPersonRow([rowA], { name: "Morgan Blake", resourceId: "" });
  assert.ok(result !== undefined);
});

test("returns undefined for an empty rows array (no crash)", () => {
  const result = findPersonRow([], { name: "Nobody", resourceId: GUID_A });
  assert.equal(result, undefined);
});

test("partial-name match (first+last word) works for multi-word names", () => {
  const rowA = row({ AssignedTo: "", AssignedToName: "Jean-Marie Dupont" });
  const result = findPersonRow([rowA], { name: "Jean-Marie Dupont", resourceId: "" });
  assert.ok(result !== undefined);
});

// ─── E) Data-loading + hours-display round-trip (simulates EditAllocationModal useEffect) ─────
//
// EditAllocationModal useEffect filters ExistingAllocations / NewAllocations with:
//   const matchFn = (r: any) => !!findPersonRow([r], person);
//   const memberRows = [...naList.filter(matchFn), ...eaList.filter(matchFn)];
// Then hours for each week key are summed across memberRows:
//   hours += Number(row[wk] ?? 0)
//
// The tests below prove that when two rows share a display name but carry
// different GUIDs, only the row whose GUID matches person.resourceId contributes
// hours — the wrong-GUID row is filtered out before hours are summed.
console.log("\nE) Data-loading + hours-display round-trip (duplicate-name scenario)");

/** Simulate the useEffect matchFn + memberRows filter from EditAllocationModal */
function simulateMemberRows(
  allRows: AllocRow[],
  person: { name: string; resourceId?: string | null },
): AllocRow[] {
  const matchFn = (r: AllocRow) => !!findPersonRow([r], person);
  return allRows.filter(matchFn);
}

/** Sum hours for a specific week key across the matched member rows (mirrors the useEffect loop) */
function sumWeekHours(memberRows: AllocRow[], wk: string): number {
  let hours = 0;
  for (const row of memberRows) {
    const v = Number((row as Record<string, unknown>)[wk] ?? 0);
    if (!isNaN(v)) hours += v;
  }
  return hours;
}

test("hours pre-populate from the GUID-matched row, not the same-named wrong row", () => {
  // Person A (GUID_A): 20 h in week "07-Jul-26"
  // Person B (GUID_B, same display name): 40 h in week "07-Jul-26"
  // When editing person B, the modal must show 40 h, not 20 h.
  const WK = "07-Jul-26";
  const rowA: AllocRow = {
    AssignedTo: GUID_A,
    AssignedToName: "Alex Morgan",
    [WK]: 20,
  };
  const rowB: AllocRow = {
    AssignedTo: GUID_B,
    AssignedToName: "Alex Morgan",
    [WK]: 40,
  };

  const personB = { name: "Alex Morgan", resourceId: GUID_B };
  const memberRows = simulateMemberRows([rowA, rowB], personB);

  assert.equal(memberRows.length, 1, "exactly one row should survive the filter");
  assert.equal(
    String(memberRows[0].AssignedTo ?? "").toLowerCase(),
    GUID_B.toLowerCase(),
    "the surviving row must belong to GUID_B",
  );
  assert.equal(sumWeekHours(memberRows, WK), 40, "displayed hours must come from the GUID_B row (40 h)");
});

test("wrong-GUID same-named row is excluded from the member-rows filter", () => {
  // Confirm the wrong row contributes zero hours
  const WK = "07-Jul-26";
  const rowA: AllocRow = {
    AssignedTo: GUID_A,
    AssignedToName: "Alex Morgan",
    [WK]: 20,
  };
  const personB = { name: "Alex Morgan", resourceId: GUID_B };
  const memberRows = simulateMemberRows([rowA], personB);

  assert.equal(memberRows.length, 0, "GUID_A row must be excluded when searching for GUID_B person");
  assert.equal(sumWeekHours(memberRows, WK), 0, "no hours should bleed through from the wrong-GUID row");
});

test("hours sum correctly across multiple weeks for the correct person only", () => {
  // Three weeks; rowA (wrong GUID) has hours in all three.
  // rowB (correct GUID) has its own distinct values.  Only rowB's values should appear.
  const rowA: AllocRow = {
    AssignedTo: GUID_A,
    AssignedToName: "Riley Chen",
    "07-Jul-26": 8,
    "14-Jul-26": 8,
    "21-Jul-26": 8,
  };
  const rowB: AllocRow = {
    AssignedTo: GUID_B,
    AssignedToName: "Riley Chen",
    "07-Jul-26": 16,
    "14-Jul-26": 32,
    "21-Jul-26": 0,
  };

  const personB = { name: "Riley Chen", resourceId: GUID_B };
  const memberRows = simulateMemberRows([rowA, rowB], personB);

  assert.equal(memberRows.length, 1);
  assert.equal(sumWeekHours(memberRows, "07-Jul-26"), 16);
  assert.equal(sumWeekHours(memberRows, "14-Jul-26"), 32);
  assert.equal(sumWeekHours(memberRows, "21-Jul-26"), 0);
});

test("data-loading picks GUID_A row correctly when editing person A (not B)", () => {
  // Symmetry check: the filter works whichever account is being edited.
  const WK = "07-Jul-26";
  const rowA: AllocRow = {
    AssignedTo: GUID_A,
    AssignedToName: "Alex Morgan",
    [WK]: 20,
  };
  const rowB: AllocRow = {
    AssignedTo: GUID_B,
    AssignedToName: "Alex Morgan",
    [WK]: 40,
  };

  const personA = { name: "Alex Morgan", resourceId: GUID_A };
  const memberRows = simulateMemberRows([rowA, rowB], personA);

  assert.equal(memberRows.length, 1);
  assert.equal(String(memberRows[0].AssignedTo ?? "").toLowerCase(), GUID_A.toLowerCase());
  assert.equal(sumWeekHours(memberRows, WK), 20, "person A should see 20 h, not 40 h from person B");
});

test("data-loading falls back to name match when no GUID is provided (no ghost-filter regression)", () => {
  // When resourceId is empty the name-match path should still work.
  const WK = "07-Jul-26";
  const rowA: AllocRow = {
    AssignedTo: "display-key-only",   // not GUID-shaped
    AssignedToName: "Drew Kim",
    [WK]: 24,
  };

  const person = { name: "Drew Kim", resourceId: "" };
  const memberRows = simulateMemberRows([rowA], person);

  assert.equal(memberRows.length, 1);
  assert.equal(sumWeekHours(memberRows, WK), 24);
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
if (failed === 0) {
  console.log(`✓ All ${passed} tests passed.`);
} else {
  console.log(`${passed} passed, ${failed} FAILED.`);
  process.exit(1);
}
