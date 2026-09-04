/**
 * Regression tests for the Stage Rules "Set rules" drawer fixes:
 *  1. Rule field pickers exclude the module's STATUS field (it IS the stage —
 *     circular), but must NOT over-filter: a custom field labeled "Stage" is
 *     legitimate (e.g. a construction phase text column).
 *  2. StagePermRule.othersMode round-trips through coercion: "normal" is kept,
 *     absent/junk defaults to "viewOnly" (legacy behavior for old saved docs).
 *  3. Mixed-case user GUIDs survive coercion verbatim (server lowercases on
 *     save; the UI must tolerate either case — display layer compares
 *     case-insensitively).
 */
import { ruleFieldsFor, isStatusFieldOption, allFieldsFor, type StageRuleModule } from "../stageRules";
import { coerceStagePermRules } from "../permissions";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓  ${name}`);
  } else {
    failures++;
    console.error(`  ✗  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\nA) ruleFieldsFor excludes the module's canonical status column");
const STATUS_KEYS: Record<StageRuleModule, string> = {
  PMM: "crmprojectstatuschoice",
  OPM: "crmopportunitystatuschoice",
  LEM: "leadstatus",
};
for (const m of ["PMM", "OPM", "LEM"] as StageRuleModule[]) {
  const opts = ruleFieldsFor(m);
  const leaked = opts.filter(o => o.value.trim().toLowerCase() === STATUS_KEYS[m]);
  check(`${m}: no option with value ${STATUS_KEYS[m]}`, leaked.length === 0,
    `leaked: ${leaked.map(o => `${o.value}(${o.label})`).join(", ")}`);
  // The filter must remove only status-ish entries, never gut the list.
  const all = allFieldsFor(m);
  check(`${m}: at most 2 options removed vs allFieldsFor`, all.length - opts.length >= 1 && all.length - opts.length <= 2,
    `all=${all.length} rule=${opts.length}`);
}

console.log("\nB) isStatusFieldOption is narrow — custom \"Stage\" fields survive");
check("custom field labeled \"Stage\" is NOT excluded",
  !isStatusFieldOption("PMM", { value: "xf:Stage", label: "Stage" }));
check("custom field labeled \"Stage step\" is NOT excluded",
  !isStatusFieldOption("PMM", { value: "StageStep", label: "Stage step" }));
check("canonical OPM key excluded regardless of label",
  isStatusFieldOption("OPM", { value: "CRMOpportunityStatusChoice", label: "Whatever" }));
check("canonical key match is case/space tolerant",
  isStatusFieldOption("LEM", { value: "  LeadStatus ", label: "x" }));
check("extras entry labeled exactly \"Status\" excluded",
  isStatusFieldOption("PMM", { value: "xf:SomeCol", label: "Status" }));
check("extras entry labeled \"Status / Stage\" excluded",
  isStatusFieldOption("OPM", { value: "xf:Other", label: "Status / Stage" }));
check("PMM status key is NOT excluded under LEM (module-scoped)",
  !isStatusFieldOption("LEM", { value: "CRMProjectStatusChoice", label: "Project Status" }));

console.log("\nC) coerceStagePermRules: othersMode round-trip");
const base = {
  module: "OPM", stage: "New",
  actionUserIds: ["9C15C536-AC5D-4F86-B7E8-AB0A6E029EF9"],
  actionGroupIds: [], editorUserIds: [], editorGroupIds: [],
};
const [rNormal] = coerceStagePermRules([{ ...base, othersMode: "normal" }]);
check("\"normal\" survives", rNormal?.othersMode === "normal", JSON.stringify(rNormal));
const [rLegacy] = coerceStagePermRules([{ ...base }]);
check("absent → \"viewOnly\" (legacy docs stay locked-down)", rLegacy?.othersMode === "viewOnly", JSON.stringify(rLegacy));
const [rJunk] = coerceStagePermRules([{ ...base, othersMode: "banana" }]);
check("junk → \"viewOnly\" (fail closed)", rJunk?.othersMode === "viewOnly", JSON.stringify(rJunk));

console.log("\nD) mixed-case GUIDs survive coercion verbatim");
const [rCase] = coerceStagePermRules([{
  ...base,
  actionUserIds: ["9c15c536-ac5d-4f86-b7e8-ab0a6e029ef9"],
  editorUserIds: ["9C15C536-AC5D-4F86-B7E8-AB0A6E029EF9"],
}]);
check("lowercase id kept as-is", rCase?.actionUserIds[0] === "9c15c536-ac5d-4f86-b7e8-ab0a6e029ef9", JSON.stringify(rCase?.actionUserIds));
check("uppercase id kept as-is", rCase?.editorUserIds[0] === "9C15C536-AC5D-4F86-B7E8-AB0A6E029EF9", JSON.stringify(rCase?.editorUserIds));

console.log("\nE) catalog coverage — Client Contact + Project/Service Type reach the rule pickers");
// Curated entries must survive allFieldsFor's extras-dedupe (curated wins;
// only EXTRA entries are filtered). A regression here silently drops fields
// from the mandatory / can't-change / skip pickers.
const has = (m: StageRuleModule, val: string) =>
  ruleFieldsFor(m).some(o => o.value.toLowerCase() === val.toLowerCase());
for (const m of ["PMM", "OPM", "LEM"] as StageRuleModule[]) {
  check(`${m}: ProjectType pickable`, has(m, "ProjectType"));
  check(`${m}: ServiceType pickable`, has(m, "ServiceType"));
}
check("OPM: OwnerName (Client Contact) pickable", has("OPM", "OwnerName"));
check("PMM: OwnerName (Client contact, via extras) pickable", has("PMM", "OwnerName"));
check("LEM: ContactName (Client Contact) pickable", has("LEM", "ContactName"));
check("LEM: OwnerName NOT offered (leads store contact in ContactName)", !has("LEM", "OwnerName"));

console.log("");
if (failures > 0) {
  console.error(`stageRuleFields tests: ${failures} FAILED`);
  process.exit(1);
}
console.log("stageRuleFields tests: PASS");
