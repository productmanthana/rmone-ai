/**
 * check:same-job — locks the "same job?" title-match qualification rules.
 *
 * A title hit only counts as the SAME job when no comparable secondary field
 * (client / business unit / division / leads) disagrees; blank on either side
 * casts NO vote. These rules live in TWO places that must stay in lockstep:
 *   - web:    rmone-web/src/lib/sameJob.ts  (converted-opp detection, verify
 *             notice, create-page duplicate guard)
 *   - server: api-server/src/lib/same-job.ts (create-record duplicate-title
 *             gate — possibly-same rejects, different-job needs confirmation)
 *
 * Run: pnpm --filter @workspace/api-server run check:same-job
 */
import {
  normJobField,
  sameJobFields,
  scoreSameJobRaw,
  pickBestSameJobMatch,
} from "../../rmone-web/src/lib/sameJob.js";
import { classifyDuplicateTitle } from "../src/lib/same-job.js";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ""}`);
}

// ── normJobField ────────────────────────────────────────────────────────────
console.log("normJobField");
check("trims + lowercases", normJobField("  ACME Corp ") === "acme corp");
check("null/undefined → empty", normJobField(null) === "" && normJobField(undefined) === "");

// ── sameJobFields (web, mapped objects) ─────────────────────────────────────
console.log("sameJobFields");
check("all fields agree → same job",
  sameJobFields({ client: "Acme", bu: "East", division: "12" },
                { client: "acme", bu: "EAST ", division: "12" }));
check("conflicting client → different job",
  !sameJobFields({ client: "Acme", bu: "East" }, { client: "Globex", bu: "East" }));
check("conflicting division alone → different job",
  !sameJobFields({ client: "Acme", division: "12" }, { client: "Acme", division: "13" }));
check("blank on one side casts no vote → same job",
  sameJobFields({ client: "", bu: "", division: "" }, { client: "Acme", bu: "East", division: "12" }));
check("both entirely blank → same job (uncertain defaults to match)",
  sameJobFields({}, {}));
check("one agreeing + one blank pair → same job",
  sameJobFields({ client: "Acme", bu: "" }, { client: "Acme", bu: "East" }));

// ── scoreSameJobRaw (web, raw core2 rows) ───────────────────────────────────
console.log("scoreSameJobRaw");
const LEAD_FIELDS = ["ProjectManagerUser", "BusinessLeadUser"];
const opp = {
  client: "acme corp", bu: "east", division: "12",
  leads: new Set(["guid-1", "jane doe"]),
};

const agree = scoreSameJobRaw(opp, {
  CRMCompanyLookupName: "ACME Corp", CRMBusinessUnitChoice: "East",
  DivisionName: "12", ProjectManagerUser: "Jane Doe; Bob",
}, LEAD_FIELDS);
check("agreeing row → 4 same, 0 diff", agree.same.length === 4 && agree.diff.length === 0, agree);

const conflict = scoreSameJobRaw(opp, {
  CompanyName: "Globex", CRMBusinessUnitChoice: "East", DivisionLookup: "13",
}, LEAD_FIELDS);
check("client+division conflict, bu agrees",
  conflict.diff.includes("client") && conflict.diff.includes("division") &&
  conflict.same.length === 1 && conflict.same[0] === "business unit", conflict);

const blankRow = scoreSameJobRaw(opp, {}, LEAD_FIELDS);
check("all-blank row → nothing comparable (uncertain)",
  blankRow.same.length === 0 && blankRow.diff.length === 0, blankRow);

const noOppLeads = scoreSameJobRaw({ ...opp, leads: new Set<string>() },
  { CRMCompanyLookupName: "ACME Corp", ProjectManagerUser: "Someone Else" }, LEAD_FIELDS);
check("no leads on opp side → leads cast no vote",
  !noOppLeads.diff.includes("leads") && !noOppLeads.same.includes("leads"), noOppLeads);

const leadMiss = scoreSameJobRaw(opp,
  { ProjectManagerUser: "Someone Else" }, LEAD_FIELDS);
check("row leads present but none overlap → leads vote different",
  leadMiss.diff.includes("leads"), leadMiss);

const leadGuid = scoreSameJobRaw(opp, { BusinessLeadUser: "GUID-1" }, LEAD_FIELDS);
check("lead matches by GUID (case-insensitive)", leadGuid.same.includes("leads"), leadGuid);

const unlistedField = scoreSameJobRaw(opp, { SomeOtherUser: "Jane Doe" }, LEAD_FIELDS);
check("only configured *User fields are scanned",
  !unlistedField.same.includes("leads") && !unlistedField.diff.includes("leads"), unlistedField);

// ── pickBestSameJobMatch ────────────────────────────────────────────────────
console.log("pickBestSameJobMatch");
const best = pickBestSameJobMatch([
  { id: "PRJ-01", same: ["client"], diff: ["division"] },
  { id: "PRJ-02", same: ["client", "division"], diff: [] },
  { id: "PRJ-03", same: [], diff: [] },
]);
check("picks the agreeing candidate over a conflicting one", best?.id === "PRJ-02", best);
const tie = pickBestSameJobMatch([
  { id: "A", same: [], diff: [] },
  { id: "B", same: ["client"], diff: [] },
]);
check("tie on conflicts → most agreements wins", tie?.id === "B", tie);
check("blank ids skipped → null when none valid",
  pickBestSameJobMatch([{ id: "", same: ["client"], diff: [] }]) === null);
check("empty list → null", pickBestSameJobMatch([]) === null);

// ── classifyDuplicateTitle (server gate) ────────────────────────────────────
console.log("classifyDuplicateTitle");
const incoming = { client: "77", bu: "East", division: "12" };

check("no rows → null (no duplicate)", classifyDuplicateTitle([], incoming) === null);

const same1 = classifyDuplicateTitle(
  [{ ticketId: "PRJ-10", client: "77", bu: "east ", division: "12" }], incoming);
check("agreeing row → possibly-same (hard reject)",
  same1?.kind === "possibly-same" && same1.ticketId === "PRJ-10", same1);

const sparse = classifyDuplicateTitle(
  [{ ticketId: "PRJ-11", client: "", bu: "", division: "" }], incoming);
check("all-blank row → possibly-same (uncertain must NOT slip through)",
  sparse?.kind === "possibly-same", sparse);

const diff1 = classifyDuplicateTitle(
  [{ ticketId: "PRJ-12", client: "99", bu: "East", division: "12" }], incoming);
check("client conflicts → different-job with that field reported",
  diff1?.kind === "different-job" && diff1.ticketId === "PRJ-12" &&
  diff1.conflictFields.length === 1 && diff1.conflictFields[0] === "client", diff1);

const mixed = classifyDuplicateTitle([
  { ticketId: "PRJ-13", client: "99", bu: "West", division: "13" }, // conflicts
  { ticketId: "PRJ-14", client: "77", bu: "", division: "" },       // agrees
], incoming);
check("ONE agreeing row among conflicts → possibly-same wins",
  mixed?.kind === "possibly-same" && mixed.ticketId === "PRJ-14", mixed);

const allConflict = classifyDuplicateTitle([
  { ticketId: "PRJ-15", client: "99", bu: "West", division: "12" },
  { ticketId: "PRJ-16", client: "88", bu: "East", division: "13" },
], incoming);
check("EVERY row conflicts → different-job (confirmable), first conflict reported",
  allConflict?.kind === "different-job" && allConflict.ticketId === "PRJ-15" &&
  allConflict.conflictFields.join(",") === "client,business unit", allConflict);

const blankIncoming = classifyDuplicateTitle(
  [{ ticketId: "PRJ-17", client: "99", bu: "West", division: "13" }],
  { client: "", bu: "", division: "" });
check("blank incoming side → nothing comparable → possibly-same",
  blankIncoming?.kind === "possibly-same", blankIncoming);

// ── lockstep: server verdict mirrors web voting on equivalent inputs ────────
console.log("web/server lockstep");
const pairs: Array<[{ client: string; bu: string; division: string }, { client: string; bu: string; division: string }]> = [
  [{ client: "Acme", bu: "East", division: "1" }, { client: "Acme", bu: "East", division: "1" }],
  [{ client: "Acme", bu: "East", division: "1" }, { client: "Globex", bu: "East", division: "1" }],
  [{ client: "", bu: "", division: "" }, { client: "Acme", bu: "West", division: "9" }],
  [{ client: "Acme", bu: "", division: "2" }, { client: "acme ", bu: "East", division: "3" }],
];
for (const [a, b] of pairs) {
  const web = sameJobFields(a, b);
  const server = classifyDuplicateTitle([{ ticketId: "T", ...b }], a);
  const serverSame = server?.kind === "possibly-same";
  check(`lockstep ${JSON.stringify(a)} vs ${JSON.stringify(b)}`, web === serverSame,
    { web, server: server?.kind });
}

if (failures > 0) {
  console.error(`\ncheck-same-job: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\ncheck-same-job: all checks passed");
