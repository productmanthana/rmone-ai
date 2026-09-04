/**
 * Regression tests for the skip-rule value-dropdown logic (task #222 fix):
 *
 *  A. Registry coverage — every field in SKIP_FIELD_SUGGESTIONS that the
 *     admin can pick as a condition (except WorkflowTypeName, whose options
 *     come from the workflow-type list, not a data fetch) has a loader in
 *     SKIP_VALUE_LOADERS.  A missing entry silently keeps the free-text
 *     <input> even after the user selects the field.
 *
 *  B. Loader fires on field change — after ensureSkipVals(field) is called,
 *     the cache is populated and skipValsFor(field) returns the values so
 *     the rendering branch picks <select> over <input>.
 *
 *  C. Already-saved rules populate on mount — given existing stageSkips
 *     entries the pre-load effect calls ensureSkipVals for every field in
 *     those rules; the value picker shows a <select> once the loader resolves.
 *
 *  D. Idempotency — calling ensureSkipVals twice for the same field fires
 *     the loader only once (the cache guards against double-fetch).
 *
 *  E. Unknown fields (no loader) — skipValsFor returns [] and ensureSkipVals
 *     is a no-op, so the fallback free-text <input> is shown (correct).
 *
 *  F. Field with loader that returns values — the sorted, de-duped results
 *     are cached and skipValsFor delivers them in sorted order.
 */

import { SKIP_FIELD_SUGGESTIONS, SKIP_VALUE_LOADERS, makeSkipValCache, loadSkipValueOpts } from "../skipValueLoaders";
import type { StageSkipRule } from "../stageRules";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓  ${name}`);
  } else {
    failures++;
    console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── A: Registry coverage ──────────────────────────────────────────────────────
console.log("\nA) Every SKIP_FIELD_SUGGESTIONS entry (except WorkflowTypeName) has a loader");

// WorkflowTypeName intentionally has NO loader — its options come from the
// admin's own workflow-type list.  All other suggestions MUST have a loader or
// selecting the field leaves a free-text <input> even after task #222's fix.
const FIELDS_WITHOUT_LOADER = new Set(["WorkflowTypeName"]);
for (const { value, label } of SKIP_FIELD_SUGGESTIONS) {
  if (FIELDS_WITHOUT_LOADER.has(value)) {
    check(
      `${label} (${value}) intentionally has no loader`,
      !SKIP_VALUE_LOADERS[value],
      "WorkflowTypeName should NOT be in SKIP_VALUE_LOADERS",
    );
  } else {
    check(
      `${label} (${value}) has a loader`,
      typeof SKIP_VALUE_LOADERS[value] === "function",
      `SKIP_VALUE_LOADERS["${value}"] is ${typeof SKIP_VALUE_LOADERS[value]}`,
    );
  }
}

// ── B: Loader fires on field change (select appears after resolve) ────────────
console.log("\nB) After ensureSkipVals resolves, skipValsFor returns values → <select> branch");

{
  const fakeLoaders: Record<string, () => Promise<string[]>> = {
    SectorChoice: async () => ["Commercial", "Federal", "Industrial"],
    CRMBusinessUnitChoice: async () => ["Buildings", "Transportation"],
  };
  const { ensureSkipVals, skipValsFor } = makeSkipValCache(fakeLoaders);

  // Before loading: free-text <input> branch (skipValsFor returns [])
  check(
    "before load, skipValsFor returns [] → <input> shown",
    skipValsFor("SectorChoice").length === 0,
  );

  // Trigger load and wait
  await new Promise<void>(resolve => ensureSkipVals("SectorChoice", resolve));

  // After loading: <select> branch
  const vals = skipValsFor("SectorChoice");
  check(
    "after load, skipValsFor returns non-empty array → <select> shown",
    vals.length > 0,
    `got: ${JSON.stringify(vals)}`,
  );
  check(
    "returned values are sorted",
    JSON.stringify(vals) === JSON.stringify([...vals].sort()),
    JSON.stringify(vals),
  );
  check(
    "values match loader output",
    vals.includes("Commercial") && vals.includes("Federal") && vals.includes("Industrial"),
    JSON.stringify(vals),
  );
}

// ── C: Already-saved rules populate on mount ─────────────────────────────────
console.log("\nC) Pre-load from saved stageSkips (page reload path)");

{
  // Simulate what the component's pre-load useEffect does:
  //   const fieldsNeeded = new Set(rules.stageSkips.map(r => r.field));
  //   fieldsNeeded.forEach(ensureSkipVals);
  const savedRules: StageSkipRule[] = [
    { module: "PMM", field: "SectorChoice",          value: "Federal",      skipStages: ["Contract Negotiations"] },
    { module: "OPM", field: "CRMBusinessUnitChoice", value: "Buildings",    skipStages: ["Proposal Development"] },
    // WorkflowTypeName has no loader — must not cause an error
    { module: "PMM", field: "WorkflowTypeName",       value: "Standard",    skipStages: ["Pending Assignment"] },
  ];

  const loadCounts: Record<string, number> = {};
  const fakeLoaders: Record<string, () => Promise<string[]>> = {
    SectorChoice: async () => { loadCounts["SectorChoice"] = (loadCounts["SectorChoice"] ?? 0) + 1; return ["Commercial", "Federal"]; },
    CRMBusinessUnitChoice: async () => { loadCounts["CRMBusinessUnitChoice"] = (loadCounts["CRMBusinessUnitChoice"] ?? 0) + 1; return ["Buildings", "Transportation"]; },
  };
  const { ensureSkipVals, skipValsFor } = makeSkipValCache(fakeLoaders);

  // Simulate the pre-load effect
  const fieldsNeeded = new Set(savedRules.map(r => r.field));
  const loadDone = Promise.all(
    [...fieldsNeeded].map(f => new Promise<void>(resolve => ensureSkipVals(f, resolve))),
  );
  await loadDone;

  check(
    "SectorChoice loaded from saved rule → <select> on reload",
    skipValsFor("SectorChoice").length > 0,
    JSON.stringify(skipValsFor("SectorChoice")),
  );
  check(
    "CRMBusinessUnitChoice loaded from saved rule → <select> on reload",
    skipValsFor("CRMBusinessUnitChoice").length > 0,
    JSON.stringify(skipValsFor("CRMBusinessUnitChoice")),
  );
  check(
    "WorkflowTypeName (no loader) → skipValsFor still returns [] → no error",
    skipValsFor("WorkflowTypeName").length === 0,
  );
}

// ── D: Idempotency — loader fires only once ───────────────────────────────────
console.log("\nD) ensureSkipVals is idempotent — loader fires only once per field");

{
  let callCount = 0;
  const fakeLoaders: Record<string, () => Promise<string[]>> = {
    ProjectType: async () => { callCount++; return ["Design-Build", "Design-Bid-Build"]; },
  };
  const { ensureSkipVals, skipValsFor } = makeSkipValCache(fakeLoaders);

  await new Promise<void>(resolve => ensureSkipVals("ProjectType", resolve));
  // Call again after already cached
  ensureSkipVals("ProjectType");
  ensureSkipVals("ProjectType");

  check(
    "loader called exactly once despite multiple ensureSkipVals calls",
    callCount === 1,
    `loader was called ${callCount} times`,
  );
  check(
    "skipValsFor still returns values after redundant calls",
    skipValsFor("ProjectType").length > 0,
  );
}

// ── E: Unknown field (no loader) — free-text fallback ────────────────────────
console.log("\nE) Fields without a loader stay as free-text <input>");

{
  const { ensureSkipVals, skipValsFor } = makeSkipValCache({});
  // ensureSkipVals must not throw for an unknown field
  ensureSkipVals("SomeCustomField");
  check(
    "skipValsFor returns [] for field with no loader",
    skipValsFor("SomeCustomField").length === 0,
  );
  check(
    "skipValsFor returns [] for empty string",
    skipValsFor("").length === 0,
  );
}

// ── F: Values are filtered (no blanks) and sorted ────────────────────────────
console.log("\nF) Loader results are filtered (blanks removed) and sorted");

{
  const fakeLoaders: Record<string, () => Promise<string[]>> = {
    ServiceType: async () => ["  ", "General", "", "Consulting", "Engineering"],
  };
  const { ensureSkipVals, skipValsFor } = makeSkipValCache(fakeLoaders);
  await new Promise<void>(resolve => ensureSkipVals("ServiceType", resolve));
  const vals = skipValsFor("ServiceType");
  check(
    "blank/whitespace entries are removed",
    !vals.some(v => v.trim() === ""),
    JSON.stringify(vals),
  );
  check(
    "remaining values are sorted alphabetically",
    JSON.stringify(vals) === JSON.stringify([...vals].sort()),
    JSON.stringify(vals),
  );
  check(
    "non-blank values are present",
    vals.includes("Consulting") && vals.includes("Engineering") && vals.includes("General"),
    JSON.stringify(vals),
  );
}

// ── G: SkipsCard outer skipValueOpts — existing stageSkips populate on mount ──
// Tests the real `loadSkipValueOpts` helper extracted from the SkipsCard
// useEffect in StageRulesSettings.tsx.  The component calls this function and
// applies the result; a regression in the helper would immediately break the
// dropdown rendering in the component.
console.log("\nG) SkipsCard outer skipValueOpts (loadSkipValueOpts) — saved stageSkips populate on mount");

{
  const savedSkips: StageSkipRule[] = [
    { module: "PMM", field: "SectorChoice",          value: "Federal",   skipStages: ["Contract Negotiations"] },
    { module: "OPM", field: "CRMBusinessUnitChoice", value: "Buildings", skipStages: ["Proposal Development"] },
    // WorkflowTypeName intentionally has no loader
    { module: "PMM", field: "WorkflowTypeName",       value: "Standard", skipStages: ["Pending Assignment"] },
  ];

  const fakeLoaders: Record<string, () => Promise<string[]>> = {
    SectorChoice:          async () => ["Commercial", "Federal", "State & Local"],
    CRMBusinessUnitChoice: async () => ["Buildings", "Transportation"],
  };

  // --- G1: own-company admin (tenantId === undefined) — loaders fire ---
  const g1 = await loadSkipValueOpts(savedSkips, undefined, {}, fakeLoaders);

  check(
    "G1: SectorChoice opts loaded → <select> branch selected",
    Array.isArray(g1["SectorChoice"]) && g1["SectorChoice"].length > 0,
    JSON.stringify(g1["SectorChoice"]),
  );
  check(
    "G1: CRMBusinessUnitChoice opts loaded → <select> branch selected",
    Array.isArray(g1["CRMBusinessUnitChoice"]) && g1["CRMBusinessUnitChoice"].length > 0,
    JSON.stringify(g1["CRMBusinessUnitChoice"]),
  );
  check(
    "G1: WorkflowTypeName (no loader) stays absent → free-text <input> branch",
    g1["WorkflowTypeName"] === undefined,
    JSON.stringify(g1["WorkflowTypeName"]),
  );

  // --- G2: already-populated entries are not overwritten (second effect run) ---
  const alreadyPopulated: Record<string, string[]> = { SectorChoice: ["Pre-existing"] };
  const g2 = await loadSkipValueOpts(savedSkips, undefined, alreadyPopulated, fakeLoaders);

  check(
    "G2: already-populated SectorChoice is not overwritten by the effect",
    JSON.stringify(g2["SectorChoice"]) === JSON.stringify(["Pre-existing"]),
    JSON.stringify(g2["SectorChoice"]),
  );
  check(
    "G2: CRMBusinessUnitChoice (not yet populated) is loaded normally",
    Array.isArray(g2["CRMBusinessUnitChoice"]) && g2["CRMBusinessUnitChoice"].length > 0,
    JSON.stringify(g2["CRMBusinessUnitChoice"]),
  );

  // --- G3: loader failure leaves field absent (free-text fallback, not an empty <select>) ---
  const failingLoaders: Record<string, () => Promise<string[]>> = {
    SectorChoice: async () => { throw new Error("network error"); },
  };
  const singleSkip: StageSkipRule[] = [
    { module: "PMM", field: "SectorChoice", value: "Federal", skipStages: ["Contract Negotiations"] },
  ];
  const g3 = await loadSkipValueOpts(singleSkip, undefined, {}, failingLoaders);

  check(
    "G3: loader failure → SectorChoice absent → free-text <input> as fallback",
    g3["SectorChoice"] === undefined,
    JSON.stringify(g3["SectorChoice"]),
  );

  // --- G4: only fields present in stageSkips are loaded (no spurious fetches) ---
  const fetchedFields: string[] = [];
  const trackingLoaders: Record<string, () => Promise<string[]>> = {
    SectorChoice:          async () => { fetchedFields.push("SectorChoice"); return ["Commercial"]; },
    CRMBusinessUnitChoice: async () => { fetchedFields.push("CRMBusinessUnitChoice"); return ["Buildings"]; },
    ProjectType:           async () => { fetchedFields.push("ProjectType"); return ["Design-Build"]; },
  };
  const partialSkips: StageSkipRule[] = [
    { module: "PMM", field: "SectorChoice", value: "Federal", skipStages: ["Contract Negotiations"] },
  ];
  await loadSkipValueOpts(partialSkips, undefined, {}, trackingLoaders);

  check(
    "G4: only the field referenced in stageSkips is fetched (ProjectType not fetched)",
    fetchedFields.length === 1 && fetchedFields[0] === "SectorChoice",
    `fetched: ${JSON.stringify(fetchedFields)}`,
  );
}

// ── H: Cross-tenant guard — tenantId !== undefined prevents loading ────────────
// When a superadmin edits ANOTHER company (tenantId is a string) or has no
// company selected (tenantId is null), loadSkipValueOpts returns currentOpts
// unchanged and no loaders are invoked — the free-text <input> is kept
// intentionally (values from the wrong tenant would be misleading).
console.log("\nH) Cross-tenant guard — tenantId !== undefined keeps free-text (loadSkipValueOpts)");

{
  const skips: StageSkipRule[] = [
    { module: "PMM", field: "SectorChoice", value: "Federal", skipStages: ["Contract Negotiations"] },
  ];

  let h1LoaderCalled = false;
  const h1Loaders: Record<string, () => Promise<string[]>> = {
    SectorChoice: async () => { h1LoaderCalled = true; return ["Commercial", "Federal"]; },
  };

  // H1: superadmin editing another company (tenantId = string) — returns currentOpts unchanged
  const h1 = await loadSkipValueOpts(skips, "tenant-abc", {}, h1Loaders);
  check(
    "H1: tenantId = string → loader NOT invoked",
    !h1LoaderCalled,
    `loaderCalled: ${h1LoaderCalled}`,
  );
  check(
    "H1: tenantId = string → currentOpts returned unchanged",
    Object.keys(h1).length === 0,
    JSON.stringify(h1),
  );

  // H2: superadmin, no company selected (tenantId = null) — returns currentOpts unchanged
  let h2LoaderCalled = false;
  const h2Loaders: Record<string, () => Promise<string[]>> = {
    SectorChoice: async () => { h2LoaderCalled = true; return ["Commercial"]; },
  };
  const h2 = await loadSkipValueOpts(skips, null, {}, h2Loaders);
  check(
    "H2: tenantId = null → loader NOT invoked",
    !h2LoaderCalled,
    `loaderCalled: ${h2LoaderCalled}`,
  );
  check(
    "H2: tenantId = null → currentOpts returned unchanged",
    Object.keys(h2).length === 0,
    JSON.stringify(h2),
  );

  // H3: own-company admin (tenantId = undefined) — loaders DO run
  let h3LoaderCalled = false;
  const h3Loaders: Record<string, () => Promise<string[]>> = {
    SectorChoice: async () => { h3LoaderCalled = true; return ["Commercial", "Federal"]; },
  };
  const h3 = await loadSkipValueOpts(skips, undefined, {}, h3Loaders);
  check(
    "H3: tenantId = undefined (own company) → loader IS invoked",
    h3LoaderCalled,
    `loaderCalled: ${h3LoaderCalled}`,
  );
  check(
    "H3: tenantId = undefined → opts populated",
    Array.isArray(h3["SectorChoice"]) && h3["SectorChoice"].length > 0,
    JSON.stringify(h3["SectorChoice"]),
  );
}

console.log("");
if (failures > 0) {
  console.error(`skipValueLoaders tests: ${failures} FAILED`);
  process.exit(1);
}
console.log("skipValueLoaders tests: PASS");
