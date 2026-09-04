/**
 * Regression tests: ID typo-fixing keeps working when the ID list loads late.
 *
 * Covers:
 *  A) normalizeTicketRef — separator/case stripping
 *  B) ticketRefIndex build — exact + canon maps, collision removal
 *  C) canonTicketRef — "pmm 26 020" → "PMM-26-020", pass-through when unknown/ambiguous
 *  D) dbCellErr — fail-open (null) when list unavailable; red-flag when known-empty
 *  E) dbRefCheck — null when list unavailable; correct has() when list arrives
 *  F) finishSubmit choke-point — IDs written before list loaded are corrected at submit
 *  G) scanAllIssues block 5 — dbRefs orphan flagging vs. null (fail-open) vs. empty (strict)
 *  H) Continue safety-net excludes dbRefs — "Include" on unknown ID never re-loops
 */

import assert from "node:assert/strict";
import {
  normalizeTicketRef,
  scanAllIssues,
  type DbRefCheck,
  type TabDef,
  type Row,
} from "../importValidation.js";

// ─────────────────────────────────────────────────────────────────────────────
// Replication of the InlineDataGrid utility logic (pure, no React deps).
// Mirrors InlineDataGrid.tsx lines 2206-2268 exactly.
// ─────────────────────────────────────────────────────────────────────────────

function buildTicketRefIndex(existingTicketIds: string[] | null, isStandaloneRefCard: boolean) {
  if (!existingTicketIds || !isStandaloneRefCard) return null;
  const exact = new Set<string>();
  const canon = new Map<string, string>();
  const collided = new Set<string>();
  for (const raw of existingTicketIds) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    exact.add(id.toLowerCase());
    const k = normalizeTicketRef(id);
    if (!k) continue;
    const prev = canon.get(k);
    if (prev !== undefined && prev !== id) collided.add(k);
    else canon.set(k, id);
  }
  for (const k of collided) canon.delete(k); // ambiguous → exact-match-only
  return { exact, canon };
}

function makeCanonTicketRef(ticketRefIndex: ReturnType<typeof buildTicketRefIndex>) {
  return (v: string): string => {
    if (!ticketRefIndex) return v;
    const t = v.trim();
    if (!t) return v;
    return ticketRefIndex.canon.get(normalizeTicketRef(t)) ?? v;
  };
}

function makeDbCellErr(
  ticketRefIndex: ReturnType<typeof buildTicketRefIndex>,
  isTicketRefCol: (key: string) => boolean,
) {
  return (colKey: string | undefined, val: string): string | null => {
    if (!colKey || !ticketRefIndex || !isTicketRefCol(colKey)) return null;
    const t = (val ?? "").trim();
    if (!t) return null;
    if (ticketRefIndex.exact.has(t.toLowerCase())) return null;
    if (ticketRefIndex.canon.has(normalizeTicketRef(t))) return null;
    return `"${t}" doesn't match any existing Project or Opportunity — check the ID, or import that record first`;
  };
}

function makeDbRefCheck(ticketRefIndex: ReturnType<typeof buildTicketRefIndex>): DbRefCheck | null {
  if (!ticketRefIndex) return null;
  return {
    has: (raw: string) => {
      const t = (raw ?? "").trim();
      if (!t) return true;
      return ticketRefIndex.exact.has(t.toLowerCase()) || ticketRefIndex.canon.has(normalizeTicketRef(t));
    },
  };
}

/** Mirrors finishSubmit's belt-and-braces snap (InlineDataGrid.tsx lines 4319-4332). */
function applyFinishSubmitSnap(
  data: { cols: { key: string }[]; rows: Row[] }[],
  ticketRefIndex: ReturnType<typeof buildTicketRefIndex>,
  isTicketRefCol: (key: string) => boolean,
  canonTicketRef: (v: string) => string,
) {
  if (!ticketRefIndex) return data;
  return data.map(d => {
    const refKey = d.cols.find(c => isTicketRefCol(c.key))?.key;
    if (!refKey) return d;
    return {
      ...d,
      rows: d.rows.map(r => {
        const cur = r[refKey] ?? "";
        const cv = canonTicketRef(cur);
        return cv === cur ? r : { ...r, [refKey]: cv };
      }),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared test data
// ─────────────────────────────────────────────────────────────────────────────

const REAL_IDS = ["PMM-26-020", "PMM-100", "OPM-001", "PMM-999"];

const ASG_TAB: TabDef = {
  id: "assignments",
  label: "Team Assignments",
  sheetName: "Team Assignments",
  cols: [
    { key: "asg_projectId", label: "Project / Opp ID", w: 140 },
    { key: "asg_name",      label: "Name",             w: 160 },
  ],
};

const isTicketRefColForAsg = (key: string | undefined): boolean =>
  key === "asg_projectId" || key === "sch_projectId";

// ─────────────────────────────────────────────────────────────────────────────
// Test runner
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// A) normalizeTicketRef
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nA) normalizeTicketRef");

test("uppercases and strips hyphens", () => {
  assert.equal(normalizeTicketRef("PMM-26-020"), "PMM26020");
});
test("strips spaces and lowercases", () => {
  assert.equal(normalizeTicketRef("pmm 26 020"), "PMM26020");
});
test("strips mixed separators", () => {
  assert.equal(normalizeTicketRef("pmm-26 020"), "PMM26020");
});
test("strips dots and slashes", () => {
  assert.equal(normalizeTicketRef("PMM.26/020"), "PMM26020");
});
test("empty string returns empty", () => {
  assert.equal(normalizeTicketRef(""), "");
});
test("normalizes OPM prefix correctly", () => {
  assert.equal(normalizeTicketRef("opm 001"), "OPM001");
});

// ─────────────────────────────────────────────────────────────────────────────
// B) ticketRefIndex build
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nB) ticketRefIndex build");

test("returns null when existingTicketIds is null (list not yet loaded)", () => {
  const idx = buildTicketRefIndex(null, true);
  assert.equal(idx, null);
});

test("returns null for non-standalone cards even with IDs", () => {
  const idx = buildTicketRefIndex(REAL_IDS, false);
  assert.equal(idx, null);
});

test("builds exact set (lowercase)", () => {
  const idx = buildTicketRefIndex(REAL_IDS, true)!;
  assert.ok(idx.exact.has("pmm-26-020"));
  assert.ok(idx.exact.has("pmm-100"));
});

test("builds canon map for unambiguous IDs", () => {
  const idx = buildTicketRefIndex(REAL_IDS, true)!;
  assert.equal(idx.canon.get("PMM26020"), "PMM-26-020");
  assert.equal(idx.canon.get("PMM100"),   "PMM-100");
});

test("removes ambiguous canon keys when two IDs normalize identically", () => {
  // "PMM-26-020" and "PMM26020" (no separators) → same normalized key
  const ids = ["PMM-26-020", "PMM26020"];
  const idx = buildTicketRefIndex(ids, true)!;
  // Both are in exact (case-insensitive distinct values)
  assert.ok(idx.exact.has("pmm-26-020"));
  assert.ok(idx.exact.has("pmm26020"));
  // The normalized key collided → removed from canon
  assert.equal(idx.canon.has("PMM26020"), false, "ambiguous canon key must be removed");
});

test("skips blank/empty IDs without error", () => {
  const ids = ["PMM-001", "", "  ", "OPM-002"];
  const idx = buildTicketRefIndex(ids, true)!;
  assert.equal(idx.exact.size, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// C) canonTicketRef — correction at all cell-write sites
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nC) canonTicketRef");

const idxLoaded   = buildTicketRefIndex(REAL_IDS, true)!;
const canonLoaded = makeCanonTicketRef(idxLoaded);
const canonNull   = makeCanonTicketRef(null);  // list not yet loaded

test("corrects separator/case drift to DB canonical form", () => {
  assert.equal(canonLoaded("pmm 26 020"), "PMM-26-020");
});
test("corrects hyphen-variant to canonical", () => {
  assert.equal(canonLoaded("pmm-26-020"), "PMM-26-020");  // exact match → identity
});
test("passes through unknown IDs unchanged (never guesses)", () => {
  assert.equal(canonLoaded("PMM-9999"), "PMM-9999");
});
test("returns original value when list is unavailable (null index)", () => {
  assert.equal(canonNull("pmm 26 020"), "pmm 26 020");
});
test("empty value returned as-is", () => {
  assert.equal(canonLoaded(""), "");
  assert.equal(canonNull(""), "");
});

// C2: list arrives late — values typed before load are corrected afterwards
test("corrects a stale pre-load value once index arrives", () => {
  // Simulate: user types "pmm 26 020" while list is null → pass-through
  const beforeLoad = canonNull("pmm 26 020");
  assert.equal(beforeLoad, "pmm 26 020"); // list wasn't ready, can't correct yet

  // List arrives → canonLoaded now has the index
  const afterLoad = canonLoaded("pmm 26 020");
  assert.equal(afterLoad, "PMM-26-020");  // immediately corrects
});

// ─────────────────────────────────────────────────────────────────────────────
// D) dbCellErr — as-you-type red flags
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nD) dbCellErr");

const dbCellErrLoaded = makeDbCellErr(idxLoaded, isTicketRefColForAsg);
const dbCellErrNull   = makeDbCellErr(null,       isTicketRefColForAsg);

test("returns null when ticketRefIndex is null (fail-open)", () => {
  assert.equal(dbCellErrNull("asg_projectId", "TOTALLY-UNKNOWN"), null);
});
test("returns null for non-ticket-ref columns even with a bad value", () => {
  assert.equal(dbCellErrLoaded("asg_name", "TOTALLY-UNKNOWN"), null);
});
test("returns null for exact match", () => {
  assert.equal(dbCellErrLoaded("asg_projectId", "PMM-26-020"), null);
});
test("returns null for case-variant of exact match", () => {
  assert.equal(dbCellErrLoaded("asg_projectId", "pmm-26-020"), null);
});
test("returns null for separator-drift that resolves via canon map", () => {
  assert.equal(dbCellErrLoaded("asg_projectId", "pmm 26 020"), null);
});
test("returns error string for genuinely unknown ID", () => {
  const err = dbCellErrLoaded("asg_projectId", "PMM-9999");
  assert.ok(err !== null && err.includes("PMM-9999"), `expected error, got: ${err}`);
});
test("returns null for blank value", () => {
  assert.equal(dbCellErrLoaded("asg_projectId", ""), null);
  assert.equal(dbCellErrLoaded("asg_projectId", "  "), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// E) dbRefCheck — handed to submit-time scan and review grid
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nE) dbRefCheck");

test("is null when ID list is unavailable", () => {
  assert.equal(makeDbRefCheck(null), null);
});

const checkLoaded = makeDbRefCheck(idxLoaded)!;

test("has() returns true for exact match", () => {
  assert.ok(checkLoaded.has("PMM-26-020"));
});
test("has() returns true for case-insensitive exact match", () => {
  assert.ok(checkLoaded.has("pmm-26-020"));
});
test("has() returns true for separator-drift resolved via canon", () => {
  assert.ok(checkLoaded.has("pmm 26 020"));
  assert.ok(checkLoaded.has("PMM26020"));
});
test("has() returns false for unknown ID", () => {
  assert.ok(!checkLoaded.has("PMM-9999"));
});
test("has() returns true for blank (blank cells are not flagged)", () => {
  assert.ok(checkLoaded.has(""));
  assert.ok(checkLoaded.has("   "));
});

// F) Empty list ≠ null: everything populated IS flagged (strict mode)
const checkEmpty = makeDbRefCheck(buildTicketRefIndex([], true))!;

test("empty ID list → has() returns false for any non-blank ID (strict)", () => {
  assert.ok(!checkEmpty.has("PMM-001"),  "any ID flagged when list is empty");
  assert.ok(!checkEmpty.has("OPM-001"), "any ID flagged when list is empty");
});
test("empty ID list → has() returns true for blank (blank never flagged)", () => {
  assert.ok(checkEmpty.has(""));
});

// ─────────────────────────────────────────────────────────────────────────────
// F) finishSubmit choke-point — corrects stale values written before list loaded
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nF) finishSubmit choke-point (belt-and-braces snap)");

const canonFn = makeCanonTicketRef(idxLoaded);

test("corrects separator-drift IDs at submit even when typed before list loaded", () => {
  // Simulates a cell written when ticketRefIndex was null (user typed "pmm 26 020")
  const staleData = [{
    cols: [{ key: "asg_projectId" }, { key: "asg_name" }],
    rows: [
      { asg_projectId: "pmm 26 020", asg_name: "Alice" },
      { asg_projectId: "PMM-100",    asg_name: "Bob" },
    ],
  }];
  const snapped = applyFinishSubmitSnap(staleData, idxLoaded, isTicketRefColForAsg, canonFn);
  assert.equal(snapped[0].rows[0]["asg_projectId"], "PMM-26-020", "stale value corrected at submit");
  assert.equal(snapped[0].rows[1]["asg_projectId"], "PMM-100",   "already-correct value unchanged");
});

test("no-op when ticketRefIndex is null (list never loaded)", () => {
  const data = [{
    cols: [{ key: "asg_projectId" }],
    rows: [{ asg_projectId: "pmm 26 020" }],
  }];
  const snapped = applyFinishSubmitSnap(data, null, isTicketRefColForAsg, canonNull);
  assert.equal(snapped[0].rows[0]["asg_projectId"], "pmm 26 020", "pass-through when list null");
});

test("unknown IDs pass through unchanged (not guessed)", () => {
  const data = [{
    cols: [{ key: "asg_projectId" }],
    rows: [{ asg_projectId: "PMM-9999" }],
  }];
  const snapped = applyFinishSubmitSnap(data, idxLoaded, isTicketRefColForAsg, canonFn);
  assert.equal(snapped[0].rows[0]["asg_projectId"], "PMM-9999");
});

// ─────────────────────────────────────────────────────────────────────────────
// G) scanAllIssues block 5 — dbRefs orphan flagging
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nG) scanAllIssues — dbRefs orphan flagging");

const asgRows: Row[] = [
  { asg_projectId: "PMM-26-020", asg_name: "Alice" }, // known → clean
  { asg_projectId: "pmm 26 020", asg_name: "Bob"   }, // drift but valid → clean (checkLoaded.has resolves it)
  { asg_projectId: "PMM-9999",   asg_name: "Carol"  }, // unknown → orphan
];

test("null dbRefs → no orphan issues (fail-open)", () => {
  const issues = scanAllIssues(
    "assignments",
    [{ tab: ASG_TAB, rows: asgRows }],
    true,
    { dbRefs: null },
  );
  const orphans = issues.filter(i => i.kind === "orphan");
  assert.equal(orphans.length, 0, "null dbRefs must produce zero orphan issues");
});

test("loaded dbRefs → only the genuinely unknown ID is flagged", () => {
  const issues = scanAllIssues(
    "assignments",
    [{ tab: ASG_TAB, rows: asgRows }],
    true,
    { dbRefs: checkLoaded },
  );
  const orphans = issues.filter(i => i.kind === "orphan");
  assert.equal(orphans.length, 1, "exactly one orphan issue");
  assert.ok(orphans[0].reason.includes("PMM-9999"), `wrong ID in reason: ${orphans[0].reason}`);
});

test("separator-drift ID that resolves via canon is NOT flagged as orphan", () => {
  const issues = scanAllIssues(
    "assignments",
    [{ tab: ASG_TAB, rows: [{ asg_projectId: "pmm 26 020", asg_name: "Bob" }] }],
    true,
    { dbRefs: checkLoaded },
  );
  const orphans = issues.filter(i => i.kind === "orphan");
  assert.equal(orphans.length, 0, "resolved drift must not be flagged as orphan");
});

test("empty dbRefs list → every populated ID flagged as orphan (strict)", () => {
  const issues = scanAllIssues(
    "assignments",
    [{ tab: ASG_TAB, rows: asgRows }],
    true,
    { dbRefs: checkEmpty },
  );
  const orphans = issues.filter(i => i.kind === "orphan");
  assert.equal(orphans.length, 3, "all rows flagged when ID list is empty");
});

// ─────────────────────────────────────────────────────────────────────────────
// H) Continue safety-net excludes dbRefs — "Include" on unknown ID never re-loops
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nH) Continue safety-net — 'Include' on unknown ID never re-loops");

// The ImportReviewGrid Continue handler (line 438) calls scanAllIssues with
// { skipDuplicates: true } but WITHOUT dbRefs. So even after the user clicks
// "Include" for a DB-unknown ID, the safety-net scan won't re-flag it as an
// orphan and loop forever.

test("safety-net scan with no dbRefs does not re-flag a DB-unknown ID as orphan", () => {
  // Scenario: user clicked "Include" for PMM-9999 → it passes through to the
  // safety-net scan. The safety net MUST NOT orphan it again.
  const includedRows: Row[] = [
    { asg_projectId: "PMM-9999", asg_name: "Carol" }, // user included despite unknown
  ];
  const issues = scanAllIssues(
    "assignments",
    [{ tab: ASG_TAB, rows: includedRows }],
    true,
    { skipDuplicates: true }, // ← no dbRefs, exactly what ImportReviewGrid passes
  );
  const orphans = issues.filter(i => i.kind === "orphan");
  assert.equal(orphans.length, 0,
    "safety-net must not re-flag DB-unknown IDs — that would cause an infinite loop");
});

test("safety-net scan still catches genuinely orphaned child rows (cross-tab)", () => {
  // On a multi-tab upload the safety-net DOES catch child rows whose PARENT
  // was skipped (cross-tab orphan check still runs — it just uses the main
  // tab's rows, not the DB).  This test confirms only dbRefs is excluded.
  const projectTab: TabDef = {
    id: "main", label: "Projects", sheetName: "Projects",
    cols: [{ key: "projectId", label: "Project ID", w: 130 }, { key: "projectTitle", label: "Title", w: 220 }],
  };
  const asgTab: TabDef = { ...ASG_TAB };
  const tabsData = [
    { tab: projectTab, rows: [{ projectId: "PMM-001", projectTitle: "Bridge" }] },
    { tab: asgTab,     rows: [{ asg_projectId: "PMM-001", asg_name: "Alice" },
                               { asg_projectId: "PMM-MISSING", asg_name: "Bob" }] },
  ];
  const issues = scanAllIssues("projects", tabsData, false, { skipDuplicates: true });
  const orphans = issues.filter(i => i.kind === "orphan");
  assert.equal(orphans.length, 1, "cross-tab orphan still caught in safety-net");
  assert.ok(orphans[0].reason.includes("PMM-MISSING"));
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
