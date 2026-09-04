import assert from "node:assert/strict";
import {
  audienceIdMatches,
  navRoleRuleHides,
  needsLiveAudienceSet,
  sanitizeNavVisibility,
  sanitizeStagePerms,
  type NavItemRule,
  type UserGroup,
} from "../access-control";

const roleRule = (...roleIds: string[]): NavItemRule => ({
  mode: "roles",
  groupIds: [],
  roleIds,
});

// Untouched-company defaults no longer depend on access levels.
assert.equal(navRoleRuleHides("manager", undefined, "user", false), false);
assert.equal(navRoleRuleHides("reports", undefined, "admin", true), false);
assert.equal(navRoleRuleHides("reports", undefined, "manager", true), false);
assert.equal(navRoleRuleHides("reports", undefined, "user", false), false);
assert.equal(navRoleRuleHides("analyticscenter", undefined, "custom:editor", true), false);
assert.equal(navRoleRuleHides("analyticscenter", undefined, "custom:viewer", false), false);
assert.equal(navRoleRuleHides("usageanalytics", undefined, "admin", true), false);
assert.equal(navRoleRuleHides("usageanalytics", undefined, "manager", true), false);

// Legacy access-level rules are treated as Everyone.
assert.equal(navRoleRuleHides("usageanalytics", roleRule("manager", "custom:ops"), "manager", true), false);
assert.equal(navRoleRuleHides("usageanalytics", roleRule("manager", "custom:ops"), "custom:ops", false), false);
assert.equal(navRoleRuleHides("usageanalytics", roleRule("manager", "custom:ops"), "admin", true), false);
assert.equal(navRoleRuleHides("reports", { mode: "everyone", groupIds: [], roleIds: [] }, "user", false), false);
assert.equal(navRoleRuleHides("manager", { mode: "hidden", groupIds: [], roleIds: [] }, "admin", true), true);

const saved = sanitizeNavVisibility({
  items: {
    reports: { mode: "roles", roleIds: ["ADMIN", "custom:ops", "custom:bad_id", "bogus"] },
    manager: { mode: "everyone" },
    home: { mode: "everyone" },
  },
});
assert.equal(saved.items.reports, undefined);
assert.equal(saved.items.manager, undefined);
assert.equal(saved.items.home, undefined);

// ── "Only these groups" keeps LIVE sentinels (org units + roles) ────────────
// The sanitizer must not prune sentinel ids: they are not real groups, they
// are resolved live server-side. Lowercased + deduped like every stored id;
// ids longer than the 64-char storage cap are truncated (not dropped) — a
// role sentinel ("role:" + GUID = 41 chars) always fits untouched.
const savedGroups = sanitizeNavVisibility({
  items: {
    reports: {
      mode: "groups",
      groupIds: ["G1", "ROLE:ABC-123", "role:abc-123", "ORG:BU:7"],
    },
  },
});
const reportsRule = savedGroups.items.reports;
assert.ok(reportsRule, "groups-mode rule with sentinel ids must survive sanitize");
assert.equal(reportsRule?.mode, "groups");
assert.deepEqual(reportsRule?.groupIds, ["g1", "role:abc-123", "org:bu:7"]);

// ── needsLiveAudienceSet: org OR role triggers the live-set load ────────────
assert.equal(needsLiveAudienceSet([]), false);
assert.equal(needsLiveAudienceSet(["g1", "g2"]), false);
assert.equal(needsLiveAudienceSet(["g1", "org:bu:7"]), true);
assert.equal(needsLiveAudienceSet(["org:dept:9"]), true);
assert.equal(needsLiveAudienceSet(["role:abc"]), true);
assert.equal(needsLiveAudienceSet(["ROLE:ABC"]), true); // case-insensitive
assert.equal(needsLiveAudienceSet(["user:u1"]), false); // user sentinels are not live-resolved

// ── audienceIdMatches: one membership predicate for groups + sentinels ──────
const g1: UserGroup = { id: "g1", name: "Estimating", memberIds: ["u1"], color: "#123456" };
const byId = new Map<string, UserGroup>([["g1", g1]]);
assert.equal(audienceIdMatches(["g1"], "u1", byId, null), true);            // real group member
assert.equal(audienceIdMatches(["g1"], "u2", byId, null), false);           // not a member
assert.equal(audienceIdMatches(["role:r1"], "u1", byId, new Set(["role:r1"])), true);   // live role
assert.equal(audienceIdMatches(["ROLE:R1"], "u1", byId, new Set(["role:r1"])), true);   // gid normalized
assert.equal(audienceIdMatches(["role:r1"], "u1", byId, new Set(["role:r2"])), false);  // different role
assert.equal(audienceIdMatches(["role:r1"], "u1", byId, null), false);      // live set not loaded → no match
assert.equal(audienceIdMatches(["org:bu:7"], "u1", byId, new Set(["org:bu:7"])), true); // live org unit
assert.equal(audienceIdMatches([], "u1", byId, new Set(["role:r1"])), false);
assert.equal(audienceIdMatches(["g1", "role:r1"], "u2", byId, new Set(["role:r1"])), true); // either matches

// ── Stage-permission sanitizer: "Who can edit" (rule 5) contract ────────────
// The drawer writes editor-tier ids — people GUIDs, group ids, and live
// org:/role: sentinels — with othersMode "viewOnly". The sanitizer must keep
// sentinels (they resolve live at evaluation time, same predicate as above),
// lowercase + dedupe ids, round-trip othersMode ("normal" survives, junk
// coerces to "viewOnly"), keep first rule per (module, stage), and drop
// unknown modules.
const permsDoc = sanitizeStagePerms({
  rules: [
    {
      module: "pmm",
      stage: "Preconstruction",
      actionUserIds: [],
      actionGroupIds: [],
      editorUserIds: ["USER-GUID-1", "user-guid-1"],
      editorGroupIds: ["G1", "ROLE:ABC-123", "org:bu:7"],
      othersMode: "viewOnly",
    },
    { module: "OPM", stage: "Qualification", editorGroupIds: ["role:r9"], othersMode: "normal" },
    { module: "opm", stage: "qualification", editorGroupIds: ["dupe-loses"], othersMode: "bogus" },
    { module: "BAD", stage: "X", editorGroupIds: ["g"] },
  ],
});
assert.equal(permsDoc.rules.length, 2);
const [pmmRule, opmRule] = permsDoc.rules;
assert.equal(pmmRule.module, "PMM");
assert.deepEqual(pmmRule.editorUserIds, ["user-guid-1"]);
assert.deepEqual(pmmRule.editorGroupIds, ["g1", "role:abc-123", "org:bu:7"]);
assert.equal(pmmRule.othersMode, "viewOnly");
assert.equal(opmRule.module, "OPM");
assert.deepEqual(opmRule.editorGroupIds, ["role:r9"]); // first rule wins the (module, stage) slot
assert.equal(opmRule.othersMode, "normal");
// Editor-tier sentinels trigger the live-audience load exactly like nav rules.
assert.equal(needsLiveAudienceSet(pmmRule.editorGroupIds), true);
assert.equal(needsLiveAudienceSet(opmRule.editorGroupIds), true);
assert.equal(needsLiveAudienceSet(["plain-group"]), false);

console.log("nav role visibility checks passed");
