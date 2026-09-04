// Regression cases for @workspace/role-match — the shared abbreviation-aware
// matcher behind every role-search surface (web demand tab, demand drill-down,
// mobile demand search, server people-search title matching). Run via the
// api-server `test` script. Recall-biased search-filter semantics: legacy
// substring hits must keep matching, abbreviations must match BOTH directions
// (query "PM" ⇒ role "Project Manager"; query "project manager" ⇒ role "PM"),
// and clearly-unrelated roles must NOT match short queries.
import assert from "node:assert/strict";
import { normalizeRoleText, roleEquivalence, roleQueryMatcher, rolesEquivalent, roleTextMatches } from "@workspace/role-match";

const yes: Array<[string, string]> = [
  // legacy substring behavior preserved
  ["manager", "Project Manager"],
  ["project", "Senior Project Manager"],
  // abbreviation query → full role
  ["pm", "Project Manager"],
  ["pm", "Senior Project Manager"],
  ["pm", "Assistant Project Manager"],
  ["PMs", "Project Manager"], // plural query folds
  ["apm", "Assistant Project Manager"],
  ["px", "Project Executive"],
  ["pe", "Project Engineer"],
  ["cm", "Construction Manager"],
  ["supt", "Superintendent"],
  ["super", "Superintendent"],
  ["gs", "General Superintendent"],
  ["gf", "General Foreman"],
  ["vp", "Vice President of Operations"],
  ["ceo", "Chief Executive Officer (CEO)"],
  ["qa/qc", "QA/QC Manager"],
  ["mep", "Mechanical, Electrical & Plumbing Coordinator"],
  ["bim", "BIM Manager"],
  ["est", "Senior Estimator"],
  ["sched", "Scheduler"],
  ["coord", "Project Coordinator"],
  ["hr", "Human Resources Manager"],
  // compound abbreviations
  ["sr pm", "Senior Project Manager"],
  ["srpm", "Senior Project Manager"],
  ["vp pm", "VP of Project Management"],
  // full query → abbreviated role (stored shortcuts)
  ["project manager", "PM"],
  ["project manager", "Sr PM"],
  ["senior project manager", "Sr PM"],
  ["superintendent", "Supt."],
  ["vice president", "VP"],
  ["project engineer", "PE"],
  ["quality control", "QC Inspector"],
  ["estimator", "Est."],
  // word prefixes + plurals
  ["proj man", "Project Manager"],
  ["managers", "Construction Manager"],
  ["engineer", "Structural Engineers"],
];

const no: Array<[string, string]> = [
  ["pm", "Estimator"],
  ["pm", "Superintendent"],
  ["ceo", "Project Engineer"],
  ["electrician", "Project Manager"],
  ["sr pm", "Project Manager"], // seniority in the query must be honored
  ["cfo", "Chief Executive Officer"],
  ["pm", ""],
  ["pm", null as unknown as string],
];

let n = 0;
for (const [q, r] of yes) {
  assert.equal(roleTextMatches(q, r), true, `expected MATCH: ${JSON.stringify(q)} vs ${JSON.stringify(r)}`);
  n++;
}
for (const [q, r] of no) {
  assert.equal(roleTextMatches(q, r), false, `expected NO match: ${JSON.stringify(q)} vs ${JSON.stringify(r)}`);
  n++;
}

// blank query matches everything (surfaces guard it, but keep the contract)
assert.equal(roleTextMatches("", "anything"), true);
assert.equal(roleTextMatches("   ", "anything"), true);
n += 2;

// matcher factory precomputes per query and is reusable across rows
const m = roleQueryMatcher("pm");
assert.deepEqual(
  ["Project Manager", "Sr PM", "Estimator", "Assistant Project Manager"].filter((r) => m(r)),
  ["Project Manager", "Sr PM", "Assistant Project Manager"],
);
n++;

// normalization: punctuation/case fold
assert.equal(normalizeRoleText("  QA/QC — Manager (Sr.) "), "qa qc manager sr");
n++;

// ---------------------------------------------------------------------------
// STRICT EQUIVALENCE (assign flows): same role up to abbreviation/word order,
// seniority/level modifiers are significant. Selecting "Project Manager" must
// offer "PM"/"Proj Mgr" people but NEVER "Sr PM"/"APM"/"PM II".
// ---------------------------------------------------------------------------
const eqYes: Array<[string, string]> = [
  ["PM", "Project Manager"],
  ["Project Manager", "PM"],
  ["Proj Mgr", "Project Manager"],
  ["P.M.", "Project Manager"], // dotted initials collapse
  ["Project Managers", "Project Manager"], // plural folds
  ["Manager, Project", "Project Manager"], // word order irrelevant
  ["Sr PM", "Senior Project Manager"],
  ["SPM", "Sr. Project Manager"],
  ["srpm", "Senior Project Manager"], // modifier-preserving acronym
  ["APM", "Assistant Project Manager"],
  ["Supt", "Superintendent"],
  ["VP", "Vice President"],
  ["Ops Manager", "Operations Manager"],
  ["QA/QC Manager", "Quality Assurance Quality Control Manager"],
  ["P.M.", "PM"], // dotted vs plain compact
  // POLICY: a literally abbreviated stored title is ambiguous data — it
  // matches EACH catalog expansion (hiding the person from both pickers
  // would be worse; rows show the real title). Full forms never merge —
  // see the eqNo cases below.
  ["PE", "Project Engineer"],
  ["PE", "Professional Engineer"],
  ["FM", "Field Manager"],
  ["FM", "Facilities Manager"],
  ["Sup", "Supervisor"],
  ["Sup", "Superintendent"],
];
const eqNo: Array<[string, string]> = [
  ["PM", "Senior Project Manager"],
  // aliased abbreviations are authoritative — same initials must NOT leak
  ["PM", "Program Manager"],
  ["PM", "Portfolio Manager"],
  ["DM", "Document Manager"], // dm = design manager in the catalog
  ["PE", "Plant Engineer"],
  ["CM", "Cost Manager"],
  ["Senior Project Manager", "PM"],
  ["Project Manager", "Sr PM"],
  ["PM", "APM"],
  ["PM", "Assistant Project Manager"],
  ["Project Manager", "Project Manager II"], // levels are significant
  ["Superintendent", "General Superintendent"],
  ["VP", "VP of Operations"],
  ["Design Manager", "Document Manager"], // no acronym cross-collision
  ["PM", "Construction Manager"],
  // full forms of ambiguous abbreviations are DISTINCT roles
  ["Field Manager", "Facilities Manager"],
  ["Project Engineer", "Professional Engineer"],
  ["Supervisor", "Superintendent"],
  ["Project Coordinator", "Project Controls"],
  ["", "PM"], // blank selection matches nothing
  ["PM", ""],
];
for (const [a, b] of eqYes) {
  assert.equal(rolesEquivalent(a, b), true, `expected EQUIVALENT: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  assert.equal(rolesEquivalent(b, a), true, `expected EQUIVALENT (sym): ${JSON.stringify(b)} vs ${JSON.stringify(a)}`);
  n += 2;
}
for (const [a, b] of eqNo) {
  assert.equal(rolesEquivalent(a, b), false, `expected DIFFERENT: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  assert.equal(rolesEquivalent(b, a), false, `expected DIFFERENT (sym): ${JSON.stringify(b)} vs ${JSON.stringify(a)}`);
  n += 2;
}

// factory precomputes the selected side and is reusable across candidates
const eq = roleEquivalence("Project Manager");
assert.deepEqual(
  ["PM", "Sr PM", "Proj Mgr", "Senior Project Manager", "Estimator"].filter((x) => eq(x)),
  ["PM", "Proj Mgr"],
);
n++;

console.log(`✓ roleMatch: ${n} assertions passed`);
