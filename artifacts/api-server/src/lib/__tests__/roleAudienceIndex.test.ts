import assert from "node:assert/strict";
import {
  ROLE_AUDIENCE_PREFIX,
  buildRoleAudienceIndex,
  isRoleAudienceId,
  normRoleName,
  roleAudienceId,
} from "../role-audience";

// ── normRoleName: trim, collapse inner whitespace, lowercase ────────────────
assert.equal(normRoleName("  Project   Manager  "), "project manager");
assert.equal(normRoleName("Estimator"), "estimator");
assert.equal(normRoleName(null), "");
assert.equal(normRoleName(undefined), "");
assert.equal(normRoleName(42), "42");

// ── sentinel shape helpers ──────────────────────────────────────────────────
assert.equal(ROLE_AUDIENCE_PREFIX, "role:");
assert.equal(isRoleAudienceId("role:abc"), true);
assert.equal(isRoleAudienceId(" ROLE:ABC "), true); // trimmed + case-insensitive
assert.equal(isRoleAudienceId("org:bu:1"), false);
assert.equal(isRoleAudienceId("user:u1"), false);
assert.equal(isRoleAudienceId(""), false);
assert.equal(isRoleAudienceId(null), false);
assert.equal(roleAudienceId(" ABC-DEF "), "role:abc-def");

// ── name bridge: duplicate same-named rows ALL emit, deduped + sorted ───────
const idx = buildRoleAudienceIndex([
  { id: "B2", name: "Project Manager" },
  { id: "a1", name: "  project   MANAGER " }, // same name, different spacing/case
  { id: "a1", name: "Project Manager" },      // exact duplicate row
  { id: "C3", name: "Estimator" },
  { id: "", name: "Ghost" },                  // blank id skipped
  { id: "D4", name: "   " },                  // blank name skipped
]);
assert.deepEqual(idx.get("project manager"), ["role:a1", "role:b2"]);
assert.deepEqual(idx.get("estimator"), ["role:c3"]);
assert.equal(idx.get("ghost"), undefined);
assert.equal(idx.size, 2);

// Deterministic output regardless of SQL row order.
const idx2 = buildRoleAudienceIndex([
  { id: "a1", name: "Project Manager" },
  { id: "B2", name: "project manager" },
]);
assert.deepEqual(idx2.get("project manager"), idx.get("project manager"));

// Defensive inputs.
assert.equal(buildRoleAudienceIndex(null).size, 0);
assert.equal(buildRoleAudienceIndex(undefined).size, 0);
assert.equal(buildRoleAudienceIndex([]).size, 0);

console.log("role-audience index checks passed");
