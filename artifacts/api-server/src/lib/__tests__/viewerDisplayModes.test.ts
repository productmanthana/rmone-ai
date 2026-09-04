/**
 * resolveViewerDisplayModes — server-side mirror of the web's client-side
 * audience resolution for display modes. The mobile schedule-window write
 * gate asks the server for the VIEWER-resolved mode instead of trusting the
 * tenant base value, so these semantics must match rmone-web
 * lib/businessRules.ts (computeRules, display-mode slice) exactly.
 * Runs in the check:audience-rules chain.
 */
import assert from "node:assert/strict";
import {
  BUILTIN_ONBOARDING_DEFAULTS, buildViewerMemberships, resolveViewerDisplayModes, type OnboardingDefaults,
} from "../onboarding-defaults.js";

function eff(overrides: Partial<OnboardingDefaults>): OnboardingDefaults {
  return { ...BUILTIN_ONBOARDING_DEFAULTS, ...overrides };
}

// 1) No exception rows, no legacy audience → tenant base values for everyone,
//    including viewers with unknown memberships.
{
  const e = eff({ projectDisplayMode: "no-schedule", oppDisplayMode: "schedule-no-grid" });
  assert.deepEqual(resolveViewerDisplayModes(e, ["g1"]), { projectDisplayMode: "no-schedule", oppDisplayMode: "schedule-no-grid" });
  assert.deepEqual(resolveViewerDisplayModes(e, null), { projectDisplayMode: "no-schedule", oppDisplayMode: "schedule-no-grid" });
  assert.deepEqual(resolveViewerDisplayModes(e, []), { projectDisplayMode: "no-schedule", oppDisplayMode: "schedule-no-grid" });
}

// 2) Exception rows: the FIRST row (saved order) matching the viewer wins —
//    over the base AND over later rows; ids match case-insensitively.
{
  const e = eff({
    projectDisplayMode: "full",
    projDisplayRules: JSON.stringify([
      { ids: ["team-a"], value: "no-schedule" },
      { ids: ["team-a", "team-b"], value: "schedule-no-grid" },
    ]),
  });
  assert.equal(resolveViewerDisplayModes(e, ["TEAM-A"]).projectDisplayMode, "no-schedule", "first match wins; case-insensitive");
  assert.equal(resolveViewerDisplayModes(e, ["Team-B"]).projectDisplayMode, "schedule-no-grid", "later row when the first misses");
  assert.equal(resolveViewerDisplayModes(e, ["team-z"]).projectDisplayMode, "full", "no match → base");
  assert.equal(resolveViewerDisplayModes(e, null).projectDisplayMode, "full", "unknown memberships → base");
}

// 3) org:/user: sentinels are plain membership ids in the same set.
{
  const e = eff({
    oppDisplayMode: "full",
    oppDisplayRules: JSON.stringify([{ ids: ["org:div:d-9", "user:u-1"], value: "no-schedule-no-grid" }]),
  });
  assert.equal(resolveViewerDisplayModes(e, ["org:div:D-9"]).oppDisplayMode, "no-schedule-no-grid", "org sentinel matches");
  assert.equal(resolveViewerDisplayModes(e, ["USER:U-1"]).oppDisplayMode, "no-schedule-no-grid", "user sentinel matches");
  assert.equal(resolveViewerDisplayModes(e, ["org:div:other"]).oppDisplayMode, "full");
}

// 4) Non-empty exception rows IGNORE the legacy ApplyMode/GroupIds pair.
{
  const e = eff({
    projectDisplayMode: "no-schedule",
    projDisplayRules: JSON.stringify([{ ids: ["team-a"], value: "schedule-no-grid" }]),
    projDisplayApplyMode: "groups",
    projDisplayGroupIds: "team-z",
  });
  // Viewer is OUTSIDE the legacy audience — but rules exist, so no built-in
  // fallback: the base stands for non-matching viewers.
  assert.equal(resolveViewerDisplayModes(e, ["other"]).projectDisplayMode, "no-schedule");
  assert.equal(resolveViewerDisplayModes(e, ["team-a"]).projectDisplayMode, "schedule-no-grid");
}

// 5) Legacy audience fallback (no exception rows): a viewer outside a
//    "groups" audience — or inside an "except" one — gets the BUILT-IN
//    default; unknown memberships keep the tenant value.
{
  const e = eff({ projectDisplayMode: "no-schedule", projDisplayApplyMode: "groups", projDisplayGroupIds: "team-a, team-b" });
  assert.equal(resolveViewerDisplayModes(e, ["team-b"]).projectDisplayMode, "no-schedule", "inside groups audience → tenant value");
  assert.equal(resolveViewerDisplayModes(e, ["team-z"]).projectDisplayMode, BUILTIN_ONBOARDING_DEFAULTS.projectDisplayMode, "outside groups audience → built-in default");
  assert.equal(resolveViewerDisplayModes(e, null).projectDisplayMode, "no-schedule", "unknown memberships → tenant value");
  const ex = eff({ oppDisplayMode: "no-schedule-no-hours", oppDisplayApplyMode: "except", oppDisplayGroupIds: "team-a" });
  assert.equal(resolveViewerDisplayModes(ex, ["Team-A"]).oppDisplayMode, BUILTIN_ONBOARDING_DEFAULTS.oppDisplayMode, "except member → built-in default");
  assert.equal(resolveViewerDisplayModes(ex, ["team-b"]).oppDisplayMode, "no-schedule-no-hours", "non-member keeps tenant value");
}

// 6) Garbage degrades safely: malformed rules JSON → base; invalid stored
//    base mode → built-in default.
{
  const e = eff({ projectDisplayMode: "schedule-no-grid", projDisplayRules: "{not json" });
  assert.equal(resolveViewerDisplayModes(e, ["x"]).projectDisplayMode, "schedule-no-grid");
  const bad = eff({ projectDisplayMode: "bogus-mode" as OnboardingDefaults["projectDisplayMode"] });
  assert.equal(resolveViewerDisplayModes(bad, ["x"]).projectDisplayMode, BUILTIN_ONBOARDING_DEFAULTS.projectDisplayMode);
}

// 7) Membership assembly is tri-state on the org chain: unresolved (null)
//    must THROW — never flatten to "no org memberships", which would
//    resolve the WRONG mode for except/org-sentinel rules at a write gate
//    that treats the answer as authoritative.
{
  assert.throws(() => buildViewerMemberships("u-1", ["g1"], "user:u-1", null), /unresolved/,
    "unresolved org chain fails loud");
  assert.deepEqual(buildViewerMemberships("u-1", ["g1"], "user:u-1", new Set(["org:div:d-9"])),
    ["g1", "user:u-1", "org:div:d-9"]);
  assert.deepEqual(buildViewerMemberships("u-1", [], "user:u-1", new Set()),
    ["user:u-1"], "resolved-but-empty org chain is a valid answer");
  assert.equal(buildViewerMemberships("", ["g1"], "user:", new Set()), null,
    "unknown viewer → null memberships (base values)");
}

console.log("✓ viewer display-mode resolution mirrors web audience semantics (rule order, legacy audience fallback, sentinels, case, tri-state org membership)");
