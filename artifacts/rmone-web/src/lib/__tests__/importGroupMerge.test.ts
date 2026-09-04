/**
 * Regression tests: group members added during a projects/opportunities
 * import can NEVER overwrite existing group membership.
 *
 * Covers (pure logic in lib/importGroupMerge.ts, wired 1:1 into
 * InlineDataGrid's resolveRecordGroups / confirmRecordGroups):
 *  A) mergeGroupMembers is ADD-only — no member ever removed, existing IDs
 *     preserved verbatim; dedupe is case-insensitive; changed flag honest.
 *  B) resolveRecordGroupTokens — known groups pass, tokens matching a staff
 *     member are PEOPLE (never new-group candidates), ambiguous names drop,
 *     only a cell's FIRST token can name a NEW group, row personnel columns
 *     feed membership of every group the row names.
 *  C) cleanGroupCellValue drops person/unknown tokens + duplicates, keeps
 *     canonical casing.
 *  D) buildNewGroups never mutates the fresh list, skips names that appeared
 *     meanwhile, avoids taken ids, seeds members + defaultAccessLevel.
 */

import assert from "node:assert/strict";
import {
  mergeGroupMembers, resolveRecordGroupTokens, cleanGroupCellValue,
  buildUserNameMap, buildNewGroups, type GroupLike,
} from "../importGroupMerge.js";

const grp = (id: string, name: string, memberIds: string[] = []): GroupLike => ({ id, name, memberIds });
const mem = (entries: [string, string[]][]) =>
  new Map(entries.map(([k, v]) => [k, new Set(v)] as const));

// ── A) mergeGroupMembers: ADD-only contract ─────────────────────────────────
{
  // Adds new members, keeps every existing member verbatim (order + casing).
  const groups = [grp("g1", "PMO", ["GUID-A", "guid-b"]), grp("g2", "Directors", ["guid-c"])];
  const { merged, changed } = mergeGroupMembers(groups, mem([["pmo", ["guid-x"]]]));
  assert.equal(changed, true);
  assert.deepEqual(merged[0].memberIds, ["GUID-A", "guid-b", "guid-x"], "existing members preserved verbatim, new appended");
  assert.equal(merged[1], groups[1], "untouched group is the SAME object");
  // Original input never mutated.
  assert.deepEqual(groups[0].memberIds, ["GUID-A", "guid-b"]);
}
{
  // Dedupe is case-insensitive: an already-present member (any casing) is a no-op.
  const groups = [grp("g1", "PMO", ["GUID-A"])];
  const { merged, changed } = mergeGroupMembers(groups, mem([["pmo", ["guid-a"]]]));
  assert.equal(changed, false, "re-adding an existing member must not report a change");
  assert.equal(merged[0], groups[0]);
  assert.deepEqual(merged[0].memberIds, ["GUID-A"]);
}
{
  // Group-name lookup trims + lowercases; members map for an unknown group is ignored.
  const groups = [grp("g1", "  PMO  ", ["a"])];
  const { merged, changed } = mergeGroupMembers(groups, mem([["pmo", ["b"]], ["ghost", ["z"]]]));
  assert.equal(changed, true);
  assert.deepEqual(merged[0].memberIds, ["a", "b"]);
}
{
  // Empty members map → nothing changes, no member ever removed.
  const groups = [grp("g1", "PMO", ["a", "b"])];
  const { merged, changed } = mergeGroupMembers(groups, new Map());
  assert.equal(changed, false);
  assert.deepEqual(merged[0].memberIds, ["a", "b"], "ADD-only: nobody is ever removed");
}

// ── B) resolveRecordGroupTokens ──────────────────────────────────────────────
const canon = new Map([["pmo", "PMO"], ["directors", "Directors"]]);
const users = buildUserNameMap([
  { Id: "GUID-MITCH", Name: "Mitch Spencer" },
  { id: "guid-jane", name: "Jane  Doe" },       // normalized whitespace
  { Id: "guid-amb1", Name: "Alex Gray" },
  { Id: "guid-amb2", Name: "alex gray" },       // two different people → ambiguous
]);
{
  assert.equal(users.get("mitch spencer"), "guid-mitch");
  assert.equal(users.get("jane doe"), "guid-jane");
  assert.equal(users.get("alex gray"), null, "two people sharing a name → ambiguous null");
}
{
  // "PMO; Mitch Spencer" → group + member; person tokens never new groups.
  const { unknown, members } = resolveRecordGroupTokens(
    [{ projGroups: "PMO; Mitch Spencer" }], "projGroups", canon, users, [],
  );
  assert.equal(unknown.size, 0);
  assert.deepEqual([...members.get("pmo")!], ["guid-mitch"]);
}
{
  // A staff-member name in FIRST position is still a person, never a new group.
  const { unknown, members } = resolveRecordGroupTokens(
    [{ projGroups: "Mitch Spencer; PMO" }], "projGroups", canon, users, [],
  );
  assert.equal(unknown.size, 0, "person name must never become a new-group candidate");
  assert.deepEqual([...members.get("pmo")!], ["guid-mitch"]);
}
{
  // Ambiguous names drop — never guessed as member NOR as new group.
  const { unknown, members } = resolveRecordGroupTokens(
    [{ projGroups: "PMO; Alex Gray" }], "projGroups", canon, users, [],
  );
  assert.equal(unknown.size, 0);
  assert.equal(members.size, 0, "ambiguous name dropped, no membership guessed");
}
{
  // Only a cell's FIRST token can name a NEW group; later unknowns drop.
  const { unknown } = resolveRecordGroupTokens(
    [{ projGroups: "Ops Team; Mystery Token" }], "projGroups", canon, users, [],
  );
  assert.deepEqual([...unknown.keys()], ["ops team"]);
  assert.equal(unknown.get("ops team")!.count, 1);
  // …but once a token IS a candidate, later cells count it anywhere.
  const second = resolveRecordGroupTokens(
    [{ projGroups: "Ops Team" }, { projGroups: "PMO, Ops Team" }], "projGroups", canon, users, [],
  );
  assert.equal(second.unknown.get("ops team")!.count, 2);
}
{
  // Row personnel columns feed membership of every group the row names.
  const { members } = resolveRecordGroupTokens(
    [{ projGroups: "pmo, directors", projectManager: "Jane Doe", businessLead: "Alex Gray; Mitch Spencer" }],
    "projGroups", canon, users, ["projectManager", "businessLead"],
  );
  assert.deepEqual([...members.get("pmo")!].sort(), ["guid-jane", "guid-mitch"]);
  assert.deepEqual([...members.get("directors")!].sort(), ["guid-jane", "guid-mitch"]);
}
{
  // Blank cells / no groups on a row → no membership, no candidates.
  const { unknown, members } = resolveRecordGroupTokens(
    [{ projGroups: "" }, { projGroups: null }, { projectManager: "Jane Doe" }],
    "projGroups", canon, users, ["projectManager"],
  );
  assert.equal(unknown.size, 0);
  assert.equal(members.size, 0);
}

// ── C) cleanGroupCellValue ───────────────────────────────────────────────────
{
  assert.equal(cleanGroupCellValue("pmo; Mitch Spencer, PMO ; directors", canon), "PMO; Directors");
  assert.equal(cleanGroupCellValue("Nobody Known", canon), "");
}

// ── D) buildNewGroups ────────────────────────────────────────────────────────
{
  const fresh = [grp("grp-100", "PMO", ["a"])];
  const freshSnapshot = JSON.stringify(fresh);
  const additions = buildNewGroups(
    fresh,
    [{ name: "Ops Team" }, { name: "PMO" }],           // PMO appeared meanwhile → skipped
    { "ops team": "Manager" },
    mem([["ops team", ["guid-jane"]]]),
    100,                                                // collides with grp-100 → must skip forward
  );
  assert.equal(JSON.stringify(fresh), freshSnapshot, "buildNewGroups must NEVER touch existing groups");
  assert.equal(additions.length, 1, "existing-name candidate skipped");
  assert.equal(additions[0].name, "Ops Team");
  assert.notEqual(additions[0].id, "grp-100", "taken id avoided");
  assert.deepEqual(additions[0].memberIds, ["guid-jane"], "new group born with its cell members");
  assert.equal(additions[0].defaultAccessLevel, "Manager");
  // No pick → no defaultAccessLevel key.
  const noPick = buildNewGroups([], [{ name: "X" }], {}, new Map(), 1);
  assert.equal("defaultAccessLevel" in noPick[0], false);
}

console.log("importGroupMerge.test.ts: all assertions passed");
