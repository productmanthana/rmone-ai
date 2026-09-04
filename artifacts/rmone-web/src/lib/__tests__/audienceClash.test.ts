/**
 * Regression tests: audience-overlap scanner (findAudienceClashes).
 *
 * Background: schedule phase sets and workflow stage sets resolve by
 * first-match-wins over ordered audience entries. A person sitting in two
 * audiences (directly, or through a group) silently got the higher-priority
 * list — e.g. a user picked on the Default list who was ALSO a member of a
 * group on exception "test3" got test3's phases with no warning. The scanner
 * feeds the pre-save conflict popup.
 *
 * Covers:
 *  A) the reported bug — direct pick vs group membership → one person clash
 *  B) the same group in two audiences → ONE group row, members not repeated
 *  C) person in two different groups → person row naming both groups
 *  D) "everyone" / legacy "except" audiences never participate
 *  E) priority (not array position) decides the winner
 *  F) shared-group suppression — person rows folded into the group row
 *  G) roster missing → readable id fallback, no throw
 *  H) disjoint audiences → no clashes
 */
import assert from "node:assert/strict";
import { findAudienceClashes, type ClashAudience } from "../audienceClash.js";

const groups = [
  { id: "G1", name: "Sample test", memberIds: ["U-VYAAS", "u-admin"], color: "#123456" },
  { id: "g2", name: "Estimators", memberIds: ["u-vyaas"], color: "#654321" },
];
const people = [
  { value: "u-vyaas", label: "vyaas" },
  { value: "u-admin", label: "Test Admin" },
];
const E = (
  key: string, label: string, groupIds: string[], priority: number,
  applyMode?: "everyone" | "except" | "groups",
): ClashAudience => ({ key, label, groupIds, priority, applyMode: applyMode ?? "groups" });

// A) direct pick on the default list + group membership on an exception.
{
  const clashes = findAudienceClashes([
    E("test3", "test3", ["G1"], 0),
    E("__default_scope__", "Default list", ["user:U-Vyaas"], 1),
  ], groups, people);
  assert.equal(clashes.length, 1, "A: exactly one clash");
  const c = clashes[0];
  assert.equal(c.subjectKind, "person");
  assert.equal(c.subjectName, "vyaas");
  assert.equal(c.winner.key, "test3", "A: exception wins (checked first)");
  assert.equal(c.loser.key, "__default_scope__");
  assert.equal(c.winnerViaName, "Sample test", "A: covered via the group");
  assert.equal(c.loserViaName, null, "A: picked directly");
  assert.equal(c.loserViaId, "user:U-Vyaas", "A: removal id preserved verbatim");
}

// B) same group on both sides (case drift) → one GROUP row only.
{
  const clashes = findAudienceClashes([
    E("a", "A", ["G1"], 0),
    E("b", "B", ["g1"], 1),
  ], groups, people);
  assert.equal(clashes.length, 1, "B: single row");
  assert.equal(clashes[0].subjectKind, "group");
  assert.equal(clashes[0].subjectName, "Sample test");
  assert.equal(clashes[0].winner.key, "a");
}

// C) one person reachable through two DIFFERENT groups.
{
  const clashes = findAudienceClashes([
    E("a", "A", ["G1"], 0),
    E("b", "B", ["g2"], 1),
  ], groups, people);
  assert.equal(clashes.length, 1, "C: only the shared member clashes");
  const c = clashes[0];
  assert.equal(c.subjectKind, "person");
  assert.equal(c.subjectName, "vyaas");
  assert.equal(c.winnerViaName, "Sample test");
  assert.equal(c.loserViaName, "Estimators");
}

// D) "everyone" and legacy "except" audiences never participate.
{
  const clashes = findAudienceClashes([
    E("a", "A", [], 0, "everyone"),
    E("b", "B", ["G1"], 1),
    E("c", "C", ["G1"], 2, "except"),
  ], groups, people);
  assert.equal(clashes.length, 0, "D: no scoped pair to compare");
}

// E) priority decides the winner regardless of array position.
{
  const clashes = findAudienceClashes([
    E("late", "Late", ["G1"], 5),
    E("early", "Early", ["user:u-vyaas"], 0),
  ], groups, people);
  assert.equal(clashes.length, 1);
  assert.equal(clashes[0].winner.key, "early", "E: lower priority number wins");
  assert.equal(clashes[0].loser.key, "late");
}

// F) entry lists a group AND one of its members directly; the other side has
//    the same group → only the group row (person row suppressed).
{
  const clashes = findAudienceClashes([
    E("a", "A", ["G1", "user:u-vyaas"], 0),
    E("b", "B", ["G1"], 1),
  ], groups, people);
  assert.equal(clashes.length, 1, "F: person folded into the shared-group row");
  assert.equal(clashes[0].subjectKind, "group");
}

// G) roster unavailable → readable fallback, no throw.
{
  const clashes = findAudienceClashes([
    E("a", "A", ["G1"], 0),
    E("b", "B", ["user:u-vyaas"], 1),
  ], groups, null);
  assert.equal(clashes.length, 1);
  assert.equal(clashes[0].subjectName, "u-vyaas", "G: raw id shown when short");
}

// H) disjoint audiences → nothing to report.
{
  const clashes = findAudienceClashes([
    E("a", "A", ["g2"], 0),
    E("b", "B", ["user:u-admin"], 1),
  ], groups, people);
  assert.equal(clashes.length, 0);
}

console.log("audienceClash tests: PASS");
