/**
 * Regression tests: the staff-import server-side group merge can NEVER
 * remove existing group members (mirrors the web-side contract in
 * rmone-web/src/lib/importGroupMerge.ts, tested the same way).
 *
 * Covers (pure logic in lib/importGroupMerge.ts, wired 1:1 into pipeline.ts
 * applyImportedUserGroups):
 *  A) mergeImportedGroupAssigns is ADD-only — no member ever removed,
 *     existing IDs preserved verbatim (order + casing); dedupe is
 *     case-insensitive; inputs never mutated.
 *  B) Group-name matching is case-insensitive / whitespace-collapsed;
 *     unknown names create NEW groups seeded with their members.
 *  C) Caps: 100-group and 1000-member limits skip work with warnings but
 *     never drop existing data.
 *  D) mintGroupId slugs names and avoids every taken id.
 */

import assert from "node:assert/strict";
import {
  mergeImportedGroupAssigns, mintGroupId, MAX_GROUPS, MAX_GROUP_MEMBERS,
  type ServerGroupLike,
} from "../importGroupMerge.js";

const grp = (id: string, name: string, memberIds: string[] = []): ServerGroupLike =>
  ({ id, name, memberIds, color: "" });

// ── A) ADD-only contract ─────────────────────────────────────────────────────
{
  // Adds new members; every existing member preserved verbatim (order + casing).
  const groups = [grp("pmo", "PMO", ["GUID-A", "guid-b"]), grp("dir", "Directors", ["guid-c"])];
  const res = mergeImportedGroupAssigns(groups, new Map([["GUID-X", "PMO"]]));
  assert.equal(res.added, 1);
  assert.equal(res.created, 0);
  assert.deepEqual(res.groups[0].memberIds, ["GUID-A", "guid-b", "guid-x"], "existing preserved verbatim, new appended lowercased");
  assert.equal(res.groups[1], groups[1], "untouched group is the SAME object");
  // Inputs never mutated.
  assert.deepEqual(groups[0].memberIds, ["GUID-A", "guid-b"], "caller's group object never mutated");
}
{
  // Case-insensitive dedupe: re-adding an existing member (any casing) is a no-op.
  const groups = [grp("pmo", "PMO", ["GUID-A"])];
  const res = mergeImportedGroupAssigns(groups, new Map([["guid-a", "pmo"]]));
  assert.equal(res.added, 0);
  assert.equal(res.groups[0], groups[0], "no-op leaves the SAME object");
  assert.deepEqual(res.groups[0].memberIds, ["GUID-A"]);
}
{
  // Empty assigns → nothing changes, nobody removed.
  const groups = [grp("pmo", "PMO", ["a", "b"])];
  const res = mergeImportedGroupAssigns(groups, new Map());
  assert.equal(res.added + res.created, 0);
  assert.deepEqual(res.groups[0].memberIds, ["a", "b"], "ADD-only: nobody is ever removed");
}
{
  // Blank GUIDs and blank name tokens drop; "; ," separators both split.
  const groups = [grp("pmo", "PMO", []), grp("dir", "Directors", [])];
  const res = mergeImportedGroupAssigns(groups, new Map([
    ["", "PMO"],
    ["guid-a", " PMO ;; , Directors ,"],
  ]));
  assert.equal(res.added, 2);
  assert.deepEqual(res.groups[0].memberIds, ["guid-a"]);
  assert.deepEqual(res.groups[1].memberIds, ["guid-a"]);
}
{
  // Multi-user stash appends ("prev;next" chaining from stashImportedGroups).
  const groups = [grp("pmo", "PMO", ["old-1"])];
  const res = mergeImportedGroupAssigns(groups, new Map([["guid-a", "PMO;PMO"]]));
  assert.equal(res.added, 1, "same user+group twice in one run adds once");
  assert.deepEqual(res.groups[0].memberIds, ["old-1", "guid-a"]);
}

// ── B) Name matching + new groups ────────────────────────────────────────────
{
  // Existing group matched case-insensitively / whitespace-collapsed — no dup group.
  const groups = [grp("pmo", "  PMO  ", ["a"])];
  const res = mergeImportedGroupAssigns(groups, new Map([["guid-b", "pmo"]]));
  assert.equal(res.created, 0);
  assert.equal(res.groups.length, 1);
  assert.deepEqual(res.groups[0].memberIds, ["a", "guid-b"]);
  assert.equal(res.groups[0].name, "  PMO  ", "existing group's name untouched");
}
{
  // Unknown name → NEW group born with its members; name kept (trimmed,
  // whitespace-collapsed, 80-char cap), color empty for the sanitizer.
  const res = mergeImportedGroupAssigns([grp("pmo", "PMO")], new Map([
    ["guid-a", "Field  Ops"],
    ["GUID-B", "field ops"],
  ]));
  assert.equal(res.created, 1);
  assert.equal(res.groups.length, 2);
  const ng = res.groups[1];
  assert.equal(ng.name, "Field Ops");
  assert.equal(ng.color, "");
  assert.equal(ng.id, "field-ops");
  assert.deepEqual(ng.memberIds, ["guid-a", "guid-b"]);
}

// ── C) Caps skip with warnings, never drop existing data ────────────────────
{
  const groups = Array.from({ length: MAX_GROUPS }, (_, i) => grp(`g${i}`, `Group ${i}`));
  const res = mergeImportedGroupAssigns(groups, new Map([["guid-a", "Brand New; Group 3"]]));
  assert.equal(res.created, 0, "group cap blocks new groups");
  assert.equal(res.added, 1, "existing group still gains the member");
  assert.equal(res.groups.length, MAX_GROUPS);
  assert.ok(res.warnings.some(w => w.includes('"Brand New"')), "cap skip is loud");
}
{
  const full = grp("big", "Big", Array.from({ length: MAX_GROUP_MEMBERS }, (_, i) => `m${i}`));
  const res = mergeImportedGroupAssigns([full], new Map([["guid-new", "Big"]]));
  assert.equal(res.added, 0);
  assert.equal(res.groups[0], full, "member-capped group untouched");
  assert.equal(res.groups[0].memberIds.length, MAX_GROUP_MEMBERS, "nobody removed to make room");
  assert.ok(res.warnings.some(w => w.includes("guid-new")));
}

// ── D) mintGroupId ───────────────────────────────────────────────────────────
{
  const taken = new Set(["field-ops"]);
  assert.equal(mintGroupId("Field Ops!", taken), "field-ops-2", "collision → -2 suffix");
  assert.equal(mintGroupId("Field Ops", taken), "field-ops-3", "next collision → -3");
  assert.ok(taken.has("field-ops-2") && taken.has("field-ops-3"), "minted ids join takenIds");
  assert.equal(mintGroupId("!!!", new Set()), "g", "non-alnum names get a 'g' prefix");
  const long = mintGroupId("A".repeat(60), new Set());
  assert.ok(long.length <= 24, "id capped at 24 chars");
}

console.log("importGroupMerge.test.ts: all assertions passed");
