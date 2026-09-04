// check:lead-hierarchy-model — guards the Manager-view hierarchy builder
// Unit test: buildLeadHierarchyModel (pure client lib) — synthetic fixtures
// covering the exact interaction cases from the user's spec.
import { buildLeadHierarchyModel } from "../src/lib/leadTeamHierarchy";
import type { LeadTeamContext } from "../src/lib/api";

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  if (!cond) { failures++; console.log(`✗ ${label}`, extra ?? ""); }
  else console.log(`✓ ${label}`);
}

const RAJ = "aaaaaaaa-0000-0000-0000-000000000001";
const ANITA = "aaaaaaaa-0000-0000-0000-000000000002";
const JOHN = "aaaaaaaa-0000-0000-0000-000000000003";
const DAVID = "aaaaaaaa-0000-0000-0000-000000000004";
const W = (n: number) => `bbbbbbbb-0000-0000-0000-00000000000${n}`;

// ── Case 1: VP Raj leads 2 records, 4 team members each, 1 overlap ──────────
const rajCtx: LeadTeamContext = {
  person: { id: RAJ, name: "Raj Kumar", title: "Vice President" },
  isLead: true,
  teamError: false,
  truncated: false, partial: false,
  records: [
    {
      ticketId: "PRJ-26-001", title: "Tower A", module: "PMM",
      leads: [
        { id: RAJ, name: "Raj Kumar", field: "VicePresidentUser" },
        { id: ANITA, name: "Anita Sharma", field: "SeniorProjectManagerUser" },
        { id: JOHN, name: "John Lee", field: "ProjectManagerUser" },
        { id: null, name: "Old Consultant", field: "OwnerUser" }, // legacy name-only
      ],
      team: [
        { id: W(1), name: "Worker One", role: "Engineer", title: "Engineer I" },
        { id: W(2), name: "Worker Two", role: "Designer", title: "Designer" },
        { id: W(3), name: "Worker Three", role: "Analyst", title: "Analyst" },
        { id: JOHN, name: "John Lee", role: "Project Manager", title: "PM" }, // lead also allocated
      ],
    },
    {
      ticketId: "OPP-26-002", title: "Bridge Bid", module: "OPM",
      leads: [
        { id: RAJ, name: "Raj Kumar", field: "VicePresidentUser" },
        { id: ANITA, name: "Anita Sharma", field: "ProjectManagerUser" }, // lower role on this one
      ],
      team: [
        { id: W(2), name: "Worker Two", role: "Designer", title: "Designer" }, // cross-record repeat
        { id: W(4), name: "Worker Four", role: "Estimator", title: "Estimator" },
        { id: W(5), name: "Worker Five", role: "Engineer", title: "Engineer II" },
        { id: W(6), name: "Worker Six", role: "Surveyor", title: "Surveyor" },
      ],
    },
  ],
};
const m1 = buildLeadHierarchyModel(rajCtx);
check("Raj: selected is Raj tier 1", m1.selected.name === "Raj Kumar" && m1.selected.tier === 1, m1.selected);
check("Raj: totalRecords 2", m1.totalRecords === 2);
// unique team members: W1..W6 minus John (folded into lead) = 6
check("Raj: 6 unique team members (overlap deduped, John folded)", m1.totalTeamMembers === 6, m1.totalTeamMembers);
const anitaNode = m1.tiers.flatMap(t => t.people).find(p => p.name === "Anita Sharma");
check("Raj: Anita at MIN tier 3 (SrPM beats PM)", anitaNode?.tier === 3, anitaNode?.tier);
check("Raj: Anita carries 2 record chips", anitaNode?.records.length === 2, anitaNode?.records);
const johnNode = m1.tiers.flatMap(t => t.people).find(p => p.name === "John Lee");
check("Raj: John is a lead node (tier 4), not duplicated in team", !!johnNode && johnNode.tier === 4);
const nameOnly = m1.tiers.flatMap(t => t.people).find(p => p.name === "Old Consultant");
check("Raj: name-only token present, id null (tier 2 Owner)", !!nameOnly && nameOnly.id === null && nameOnly.tier === 2, nameOnly?.tier);
const w2InGroups = m1.teamGroups.filter(g => g.members.some(mm => mm.name === "Worker Two"));
check("Raj: Worker Two appears in BOTH record groups (context retained)", w2InGroups.length === 2, w2InGroups.length);
const w2Node = w2InGroups[0]?.members.find(mm => mm.name === "Worker Two");
check("Raj: Worker Two node carries 2 record refs", w2Node?.records.length === 2, w2Node?.records);
// totalPeople: Raj + Anita + John + name-only + 6 workers = 10
check("Raj: totalPeople 10", m1.totalPeople === 10, m1.totalPeople);
check("Raj: bands sorted ascending tier", m1.tiers.every((t, i, a) => i === 0 || a[i - 1].tier < t.tier));

// ── Case 2: mid-level Anita selected — higher lead Raj visible above ────────
const anitaCtx: LeadTeamContext = {
  person: { id: ANITA, name: "Anita Sharma", title: "Senior PM" },
  isLead: true, teamError: false, truncated: false, partial: false,
  records: [rajCtx.records[0]], // she leads Tower A (SrPM)
};
const m2 = buildLeadHierarchyModel(anitaCtx);
check("Anita: selected tier 3", m2.selected.tier === 3, m2.selected.tier);
const rajAbove = m2.tiers.find(t => t.tier === 1)?.people.some(p => p.name === "Raj Kumar");
check("Anita: Raj (higher) appears in tier-1 band", rajAbove === true);
const johnBelow = m2.tiers.find(t => t.tier === 4)?.people.some(p => p.name === "John Lee");
check("Anita: John (lower) appears in tier-4 band", johnBelow === true);

// ── Case 3: worker David — no expansion ─────────────────────────────────────
const davidCtx: LeadTeamContext = {
  person: { id: DAVID, name: "David Chen", title: "Engineer" },
  isLead: false, teamError: false, truncated: false, partial: false, records: [],
};
const m3 = buildLeadHierarchyModel(davidCtx);
check("David: only himself", m3.totalPeople === 1 && m3.tiers.length === 0 && m3.teamGroups.length === 0);
check("David: selected node has his name/title, tier 6", m3.selected.name === "David Chen" && m3.selected.tier === 6);

// ── Case 4: record with leads but zero team rows ─────────────────────────────
const bareCtx: LeadTeamContext = {
  person: { id: RAJ, name: "Raj Kumar", title: "" },
  isLead: true, teamError: false, truncated: false, partial: false,
  records: [{
    ticketId: "PRJ-26-009", title: "Empty Job", module: "PMM",
    leads: [{ id: RAJ, name: "Raj Kumar", field: "VicePresidentUser" }],
    team: [],
  }],
};
const m4 = buildLeadHierarchyModel(bareCtx);
check("Bare record: group still listed (leads present, 0 members)", m4.teamGroups.length === 1 && m4.teamGroups[0].members.length === 0);

// ── Case 5: duplicate lead entries same person+field across parse quirks ────
const dupCtx: LeadTeamContext = {
  person: { id: RAJ, name: "Raj Kumar", title: "" },
  isLead: true, teamError: false, truncated: false, partial: false,
  records: [{
    ticketId: "PRJ-26-010", title: "Dup Job", module: "PMM",
    leads: [
      { id: RAJ, name: "Raj Kumar", field: "VicePresidentUser" },
      { id: ANITA, name: "Anita Sharma", field: "ProjectManagerUser" },
      { id: ANITA, name: "Anita Sharma", field: "ProjectLeadUser" }, // two fields, same person
    ],
    team: [],
  }],
};
const m5 = buildLeadHierarchyModel(dupCtx);
const anita5 = m5.tiers.flatMap(t => t.people).filter(p => p.name === "Anita Sharma");
check("Dup fields: Anita is ONE node with 2 role chips", anita5.length === 1 && anita5[0].roles.length === 2, anita5[0]?.roles);

// ── Case 6: custom lead roles (CustomLeadsJson → field "custom:<Label>") ────
const customCtx: LeadTeamContext = {
  person: { id: RAJ, name: "Raj Kumar", title: "Vice President" },
  isLead: true, teamError: false, truncated: false, partial: false,
  records: [{
    ticketId: "PRJ-26-050", title: "Custom Roles Job", module: "PMM",
    leads: [
      { id: RAJ, name: "Raj Kumar", field: "VicePresidentUser" },
      { id: W(5), name: "Ken Custom", field: "custom:QA Lead" },
      { id: null, name: "Maya Legacy", field: "custom:Design Lead" }, // unresolved name
    ],
    team: [],
  }],
};
const m6 = buildLeadHierarchyModel(customCtx);
const ken = m6.tiers.flatMap(t => t.people).find(p => p.name === "Ken Custom");
const maya = m6.tiers.flatMap(t => t.people).find(p => p.name === "Maya Legacy");
check("Custom role: lands in tier 5 with prefix-stripped label",
  !!ken && ken.tier === 5 && ken.roles[0]?.role === "QA Lead", ken?.roles);
check("Custom role: resolved GUID kept, unresolved stays name-only (id null)",
  ken?.id === W(5) && maya?.id === null, { ken: ken?.id, maya: maya?.id });
check("Custom role: record chip carries the custom label",
  ken?.records[0]?.role === "QA Lead", ken?.records);

console.log(failures === 0 ? "\nALL MODEL TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
