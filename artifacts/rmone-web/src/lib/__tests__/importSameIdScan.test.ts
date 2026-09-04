/**
 * Regression tests: same-ID clash detection in scanAllIssues (kind "sameId").
 *
 * Background: a client file carried two DIFFERENT rows with the same
 * Project ID (PMM-26-000011) and the import wizard sailed straight to Apply
 * mode — only full-row EXACT copies were ever flagged. These tests pin the
 * new block 3b: different rows sharing one identity ID must each be flagged
 * on main tabs, while child tabs (Assignments/Schedule) may repeat IDs.
 *
 * Covers:
 *  A) two different rows, same ID → BOTH flagged sameId, reasons cross-reference
 *  B) exact copy pair → duplicate only, no sameId
 *  C) exact copy + a differing third row → duplicate on the copy, sameId on the others
 *  D) normalization — separator/case drift clashes; team emails lowercase
 *  E) child tabs repeating a Project ID are never flagged sameId
 *  F) skipDuplicates mode still excludes exact copies from the sameId group
 *  G) blank IDs never group (missingId owns that case)
 *  H) punctuation-only IDs (normalize to "") still clash via raw-form fallback
 */

import assert from "node:assert/strict";
import { scanAllIssues, type TabDef, type Row } from "../importValidation.js";

const projectsTab: TabDef = {
  id: "main", label: "Projects", sheetName: "Projects",
  cols: [
    { key: "projectId", label: "Project ID", w: 120 },
    { key: "title", label: "Project Title", w: 200 },
    { key: "actionUser", label: "Action User", w: 120 },
  ],
};
const teamTab: TabDef = {
  id: "main", label: "Team", sheetName: "Team",
  cols: [
    { key: "st_email", label: "Login Email", w: 160 },
    { key: "st_name", label: "Name", w: 160 },
  ],
};
const asgTab: TabDef = {
  id: "assignments", label: "Team Assignments", sheetName: "Team Assignments",
  cols: [
    { key: "asg_projectId", label: "Project / Opp ID", w: 120 },
    { key: "asg_person", label: "Person", w: 160 },
  ],
};

const row = (projectId: string, title: string, actionUser = ""): Row => ({ projectId, title, actionUser });

// A) The reported bug, verbatim shape: same ID, one differing cell.
{
  const rows = [
    row("PMM-26-000011", "NJ RealCold East Hanover", "rm2"),
    row("PMM-26-000011", "NJ RealCold East Hanover", "PMO; Chris Kiziak"),
  ];
  const issues = scanAllIssues("projects", [{ tab: projectsTab, rows }], true, { rowNumOffset: 2 });
  const same = issues.filter(i => i.kind === "sameId");
  assert.equal(same.length, 2, "both differing rows must be flagged");
  assert.deepEqual(same.map(i => i.rowIdx).sort(), [0, 1]);
  assert.ok(same[0].reason.includes("row 3"), "row 2's reason points at row 3");
  assert.ok(same[1].reason.includes("row 2"), "row 3's reason points at row 2");
  assert.equal(same[0].colKey, "projectId");
  assert.equal(issues.filter(i => i.kind === "duplicate").length, 0, "not exact copies");
}

// B) Exact copies stay in the existing duplicate flow — no sameId double-flag.
{
  const rows = [
    row("PMM-26-000011", "NJ RealCold East Hanover", "rm2"),
    row("PMM-26-000011", "NJ RealCold East Hanover", "rm2"),
  ];
  const issues = scanAllIssues("projects", [{ tab: projectsTab, rows }], true, { rowNumOffset: 2 });
  assert.equal(issues.filter(i => i.kind === "duplicate").length, 1, "later copy flagged");
  assert.equal(issues.filter(i => i.kind === "sameId").length, 0, "no sameId on exact pair");
}

// C) Mixed: A + exact copy B + differing C — copy keeps its duplicate flag,
//    A and C get the sameId clash.
{
  const rows = [
    row("PMM-26-000011", "NJ RealCold East Hanover", "rm2"),
    row("PMM-26-000011", "NJ RealCold East Hanover", "rm2"),
    row("PMM-26-000011", "NJ RealCold East Hanover", "PMO"),
  ];
  const issues = scanAllIssues("projects", [{ tab: projectsTab, rows }], true, { rowNumOffset: 2 });
  const dup = issues.filter(i => i.kind === "duplicate");
  const same = issues.filter(i => i.kind === "sameId");
  assert.deepEqual(dup.map(i => i.rowIdx), [1]);
  assert.deepEqual(same.map(i => i.rowIdx).sort(), [0, 2]);
}

// D) Normalization: separator/case drift clashes; distinct IDs don't.
{
  const rows = [
    row("pmm 26 000011", "A"),
    row("PMM-26-000011", "B"),
    row("PMM-26-000012", "C"),
  ];
  const issues = scanAllIssues("projects", [{ tab: projectsTab, rows }], true, { rowNumOffset: 2 });
  const same = issues.filter(i => i.kind === "sameId");
  assert.deepEqual(same.map(i => i.rowIdx).sort(), [0, 1], "drifted forms of one ID clash; 000012 is clean");

  const teamRows: Row[] = [
    { st_email: "Chris@Acme.com", st_name: "Chris K" },
    { st_email: "chris@acme.com", st_name: "Chris Kiziak" },
  ];
  const teamIssues = scanAllIssues("team", [{ tab: teamTab, rows: teamRows }], true, { rowNumOffset: 2 });
  assert.equal(teamIssues.filter(i => i.kind === "sameId").length, 2, "emails compare lowercased");
}

// E) Child tabs repeat Project IDs legitimately — never sameId.
{
  const rows: Row[] = [
    { asg_projectId: "PMM-26-000011", asg_person: "Alice" },
    { asg_projectId: "PMM-26-000011", asg_person: "Bob" },
  ];
  const issues = scanAllIssues("assignments", [{ tab: asgTab, rows }], true, { rowNumOffset: 2 });
  assert.equal(issues.filter(i => i.kind === "sameId").length, 0, "assignments may repeat IDs");
}

// F) skipDuplicates (Continue-time safety net): duplicate flags suppressed,
//    but exact copies are STILL excluded from the sameId group.
{
  const rows = [
    row("PMM-26-000011", "NJ RealCold East Hanover", "rm2"),
    row("PMM-26-000011", "NJ RealCold East Hanover", "rm2"),
    row("PMM-26-000011", "NJ RealCold East Hanover", "PMO"),
  ];
  const issues = scanAllIssues("projects", [{ tab: projectsTab, rows }], true, { skipDuplicates: true, rowNumOffset: 2 });
  assert.equal(issues.filter(i => i.kind === "duplicate").length, 0, "duplicate flags suppressed");
  assert.deepEqual(issues.filter(i => i.kind === "sameId").map(i => i.rowIdx).sort(), [0, 2]);
}

// G) Blank IDs group with nothing — missingId owns them.
{
  const rows = [
    row("", "Project A"),
    row("", "Project B"),
  ];
  const issues = scanAllIssues("projects", [{ tab: projectsTab, rows }], true, { rowNumOffset: 2 });
  assert.equal(issues.filter(i => i.kind === "sameId").length, 0);
  assert.equal(issues.filter(i => i.kind === "missingId").length, 2, "blank IDs stay a missingId problem");
}

// H) Punctuation-only IDs normalize to empty — must STILL clash on raw form
//    (the server writes TicketId verbatim, so "###" twice overwrites too).
{
  const rows = [
    row("###", "Project A"),
    row("###", "Project B"),
  ];
  const issues = scanAllIssues("projects", [{ tab: projectsTab, rows }], true, { rowNumOffset: 2 });
  assert.equal(issues.filter(i => i.kind === "sameId").length, 2, "raw-form fallback groups punctuation-only IDs");
  // Different punctuation-only IDs stay distinct — no false positive.
  const distinct = scanAllIssues(
    "projects", [{ tab: projectsTab, rows: [row("###", "A"), row("--", "B")] }], true, { rowNumOffset: 2 },
  );
  assert.equal(distinct.filter(i => i.kind === "sameId").length, 0);
}

console.log("importSameIdScan.test.ts: all assertions passed");
