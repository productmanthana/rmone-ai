/**
 * Synonym-map safety checks (CI gate). Run: npx tsx scripts/check-synonym-mapping.ts
 *
 * Guards two silent failure modes when the synonym dictionary grows:
 *  1. Normalized-key collisions: two DIFFERENT raw spellings in SYNONYM_MAP (or
 *     a tab override) that normalize (via the real normSynKey) to the same key
 *     but point at DIFFERENT canonical targets. Raw duplicates are a TS1117
 *     compile error, but normalized duplicates silently let the later entry win.
 *  2. Misrouting: a new global alias leaking through onto the team/assignments
 *     tab (globals apply to every tab unless an override/template/canonical
 *     claims the key). Fixture header sets with intentionally ambiguous headers
 *     assert the expected canonical field per tab.
 *
 * Exit code 0 = all good; 1 = at least one collision or misroute.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SYNONYM_MAP,
  TAB_SYNONYM_OVERRIDES,
  normSynKey,
  analyzeSimplifiedColumns,
  expandSimplifiedSheets,
  reRouteAssignmentsBareTitle,
  resolveSimplifiedTab,
  mapScheduleHeader,
} from "../src/lib/pipeline.js";

const here = dirname(fileURLToPath(import.meta.url));

let failures = 0;
const fail = (msg: string) => { failures++; console.error("FAIL  " + msg); };

// ── (a) Normalized-key collision guard ───────────────────────────────────────
function checkCollisions(label: string, map: Record<string, string>) {
  const seen = new Map<string, { raw: string; target: string }>();
  for (const [raw, target] of Object.entries(map)) {
    const nk = normSynKey(raw);
    const prev = seen.get(nk);
    if (prev && prev.target !== target) {
      fail(
        `${label}: normalized-key collision "${nk}" — ` +
        `"${prev.raw}" → ${prev.target} vs "${raw}" → ${target} (later silently wins)`,
      );
    }
    if (!prev) seen.set(nk, { raw, target });
  }
}

checkCollisions("SYNONYM_MAP", SYNONYM_MAP);
for (const [tab, map] of Object.entries(TAB_SYNONYM_OVERRIDES))
  checkCollisions(`TAB_SYNONYM_OVERRIDES.${tab}`, map);

// ── (b) Per-tab fixture routing ──────────────────────────────────────────────
// expected: canonical field, or null = must stay UNMAPPED (Extra column).
type Tab = "team" | "clients" | "assignments";
const FIXTURES: Record<Tab, Record<string, string | null>> = {
  team: {
    "Start Date": "StartDate",
    "End Date": "EndDate",
    "Due Date": "EndDate",
    "Title": "JobTitle",          // person title, NOT ProjectTitle
    "Working Title": null,         // ambiguous — deliberately unmapped
    "Team Member": "UserName",
    "Name": "FullName",
    "Email": "Email",
    "Work Email": "UserName",      // team override: person login email
    "Rate": "BillingRate",
    "Labor Cost": null,            // ambiguous cost word — deliberately unmapped
    "Notes": "ProjectSummaryNote",
  },
  clients: {
    "Start Date": "StartDate",
    "End Date": "EndDate",
    "Due Date": "EndDate",
    "Deadline": "EndDate",
    "Title": "ProjectTitle",       // project title, NOT JobTitle
    "Project": "Project",
    "Notes": "ProjectSummaryNote",
    "Budget": "ContractValue",     // budget family → ContractValue
    "Labor Cost": null,
    "Allocation %": "PctAllocation",
    // Key personnel + creation date + phase→status routing (Aug 2026):
    // client headers imported via the Projects / Opportunities cards.
    "Business Lead": "BusinessLeadUser",
    "Business Unit Lead": "BusinessLeadUser",
    "BU Lead": "BusinessLeadUser",
    "Project Manager": "ProjectManagerUser",
    "Sr Project Manager": "SeniorProjectManagerUser",
    "Phase": "Status",
    "Created On": "Created",
    "Created": "Created",
    "Action Users": "StageActionUsersUser",
  },
  assignments: {
    // Generic date words MUST route to allocation dates here, never project dates
    "Start Date": "AllocationStartDate",
    "End Date": "AllocationEndDate",
    "Due Date": "AllocationEndDate",
    "Deadline": "AllocationEndDate",
    "Team Member": "Resource",     // NOT UserName on assignments
    "Allocation %": "PctAllocation",
    // Hour columns are HOURS, never percent — "AllocationHour" (the core2
    // column name clients export verbatim) must route to AllocationHour;
    // landing it in PctAllocation would turn 20h into 20% (= 8h weeks).
    "AllocationHour": "AllocationHour",
    "Allocation Hours": "AllocationHour",
    "allocationhour": "AllocationHour",   // compact lowercase (normSynKey no-op)
    "allocation_hour": "AllocationHour",  // underscore spelling
    "Total Hours": "AllocationHour",
    "Project": "Project",
    "Title": "JobTitle",
    "Labor Cost": null,
  },
};

for (const [tab, expectations] of Object.entries(FIXTURES) as [Tab, Record<string, string | null>][]) {
  const headers = Object.keys(expectations);
  const results = analyzeSimplifiedColumns(tab, headers);
  for (const r of results) {
    const expected = expectations[r.col];
    if ((r.canonical ?? null) !== expected) {
      fail(
        `fixture[${tab}] header "${r.col}" mapped to ${r.canonical ?? "null (unmapped)"} — ` +
        `expected ${expected ?? "null (must stay an Extra column)"}`,
      );
    }
  }
}

// ── (c) Duplicate-column tie-break fixtures (Header Dictionary §3) ──────────
// Contested-header workbooks run end-to-end through expandSimplifiedSheets:
// when two uploaded columns map to the same canonical field, the qualified /
// dictionary-preferred column must win — and blank cells in the winner column
// must fall back to the loser's value on a per-row basis. Single-column
// (uncontested) sheets must pass through unchanged (regression guard).
{
  const mk = (sheetName: string, rows: Record<string, string | null>[]) =>
    ({ sheetName, columns: Object.keys(rows[0]!), rows });

  const expanded = expandSimplifiedSheets([
    // TEAM: "Full Name" (header IS the field) beats bare "Name".
    mk("Staff", [
      { "Full Name": "Alice Winner", "Name": "Alice Loser", "Email": "alice@x.com", "Role": "PM" },
      { "Full Name": "", "Name": "Bob Fallback", "Email": "bob@x.com", "Role": "Eng" },
    ]),
    // CLIENTS: "Project Title" (exact) beats qualified alias "Site Name".
    mk("Projects", [
      { "Project Title": "Tower A", "Site Name": "Site Alpha", "Company Name": "Acme", "Contract Value": "100" },
      { "Project Title": "", "Site Name": "Site Beta", "Company Name": "Acme", "Contract Value": "200" },
    ]),
    // ASSIGNMENTS: "Project Name" (shares a token with Project) beats "Engagement".
    mk("Staffing", [
      { "Team Member": "alice@x.com", "Project Name": "Tower A", "Engagement": "Eng Loser", "Allocation %": "50" },
      { "Team Member": "bob@x.com", "Project Name": "", "Engagement": "Tower B", "Allocation %": "25" },
    ]),
    // SINGLE-COLUMN regression guard: no contested headers — values verbatim.
    mk("Solo Staffing", [
      { "Team Member": "carol@x.com", "Project Name": "Tower C", "Allocation %": "10" },
    ]),
  ]);

  const sheet = (name: string) => expanded.find(s => s.sheetName === name);
  const expectCell = (sheetName: string, rowIdx: number, key: string, want: string | null, label: string) => {
    const s = sheet(sheetName);
    const got = s?.rows?.[rowIdx]?.[key] ?? null;
    if ((got === "" ? null : got) !== want)
      fail(`tiebreak[${label}]: ${sheetName}[${rowIdx}].${key} = ${JSON.stringify(got)} — expected ${JSON.stringify(want)}`);
  };

  // TEAM winners (expandTeamSheet emits "Team Members" with Name from FullName)
  expectCell("Team Members", 0, "Name", "Alice Winner", "team qualified wins");
  expectCell("Team Members", 1, "Name", "Bob Fallback", "team blank-winner falls back");

  // CLIENTS winners (expandClientsSheet emits "Projects" with Title)
  expectCell("Projects", 0, "Title", "Tower A", "clients exact wins over Site Name");
  expectCell("Projects", 1, "Title", "Site Beta", "clients blank-winner falls back");
  // Loser value must never create a phantom project.
  const projTitles = (sheet("Projects")?.rows ?? []).map(r => r.Title);
  if (projTitles.includes("Site Alpha"))
    fail(`tiebreak[clients]: loser column value "Site Alpha" leaked into Projects titles ${JSON.stringify(projTitles)}`);

  // ASSIGNMENTS winners (normalized rows pass through as "Resource Assignments")
  expectCell("Resource Assignments", 0, "Project", "Tower A", "asg qualified wins");
  expectCell("Resource Assignments", 1, "Project", "Tower B", "asg blank-winner falls back");
  expectCell("Resource Assignments", 0, "Resource", "alice@x.com", "asg resource mapped");
  expectCell("Resource Assignments", 0, "PctAllocation", "50", "asg pct mapped");

  // Single-column regression: uncontested sheet behaves exactly as before.
  const solo = expanded.filter(s => s.sheetName === "Resource Assignments")
    .flatMap(s => s.rows).find(r => r.Resource === "carol@x.com");
  if (!solo || solo.Project !== "Tower C" || solo.PctAllocation !== "10")
    fail(`tiebreak[single-column]: uncontested sheet changed — got ${JSON.stringify(solo ?? null)}`);
}

// ── (d) Bare-"Title" → ProjectTitle re-route (header arm + data arm) ─────────
// reRouteAssignmentsBareTitle runs on assignments sheets BEFORE the rank
// contest. HEADER ARM: a real job-title column beside bare "Title" proves the
// "Title" column is the project name. DATA ARM (only-"Title" files): the same
// value repeating on every row of each project proves it too — a per-person
// job title would vary within a project. The web grid mirrors both arms
// (InlineDataGrid LOSER_FALLBACK + reRouteBareTitleByData) — the web side is
// covered by scripts/check-title-reroute-web.ts; keep fixtures in lockstep.
{
  type RR = Parameters<typeof reRouteAssignmentsBareTitle>[0];
  const rr = (rows: Record<string, string>[]) => reRouteAssignmentsBareTitle(rows as unknown as RR);
  const expectReroute = (label: string, rows: Record<string, string>[], want: boolean) => {
    const out = rr(rows);
    const got = out.some(r => "ProjectTitle" in r);
    if (got !== want) { fail(`title-reroute[${label}]: rerouted=${got} — expected ${want}`); return; }
    if (want) {
      const bad = out.find((r, i) => ("Title" in r) || r.ProjectTitle !== rows[i]!["Title"]);
      if (bad) fail(`title-reroute[${label}]: values not moved verbatim — ${JSON.stringify(bad)}`);
    }
  };

  // HEADER ARM: real job-title column present → re-route regardless of data.
  expectReroute("header: Title beside Job Title", [
    { "Project ID": "PMM-26-000008", "Team Member": "a@x.com", "Title": "H Mart", "Job Title": "Engineer" },
    { "Project ID": "PMM-26-000008", "Team Member": "b@x.com", "Title": "H Mart", "Job Title": "PM" },
  ], true);

  // DATA ARM: only-"Title" file; same value on every row of each project.
  expectReroute("data: constant per project", [
    { "Project ID": "PMM-26-000008", "Team Member": "a@x.com", "Title": "H Mart" },
    { "Project ID": "PMM-26-000008", "Team Member": "b@x.com", "Title": "H Mart" },
    { "Project ID": "PMM-26-000009", "Team Member": "c@x.com", "Title": "Tower A" },
    { "Project ID": "PMM-26-000009", "Team Member": "d@x.com", "Title": "Tower A" },
  ], true);

  // DATA ARM: single-project file (the original "H Mart" shape).
  expectReroute("data: single project constant", [
    { "Project ID": "PMM-26-000008", "Team Member": "a@x.com", "Title": "H Mart" },
    { "Project ID": "PMM-26-000008", "Team Member": "b@x.com", "Title": "H Mart" },
    { "Project ID": "PMM-26-000008", "Team Member": "c@x.com", "Title": "H Mart" },
  ], true);

  // Varies within a project → per-person job title; must NOT re-route.
  expectReroute("data: varies within project", [
    { "Project ID": "P1", "Team Member": "a@x.com", "Title": "Engineer" },
    { "Project ID": "P1", "Team Member": "b@x.com", "Title": "PM" },
  ], false);

  // Same single value across ALL projects → company-wide job title.
  expectReroute("data: same value on every project", [
    { "Project ID": "P1", "Team Member": "a@x.com", "Title": "Engineer" },
    { "Project ID": "P1", "Team Member": "b@x.com", "Title": "Engineer" },
    { "Project ID": "P2", "Team Member": "c@x.com", "Title": "Engineer" },
    { "Project ID": "P2", "Team Member": "d@x.com", "Title": "Engineer" },
  ], false);

  // A ProjectTitle-resolving column already exists → never steal it.
  expectReroute("guard: Project Title column present", [
    { "Project ID": "P1", "Project Title": "H Mart", "Title": "Engineer" },
    { "Project ID": "P1", "Project Title": "H Mart", "Title": "Engineer" },
  ], false);

  // A name-style project column already holds the name → data arm stays off
  // even when titles are constant (lockstep with the web's
  // "project name already mapped" guard).
  expectReroute("guard: Project name column present", [
    { "Project": "Tower A", "Team Member": "a@x.com", "Title": "Engineer" },
    { "Project": "Tower A", "Team Member": "b@x.com", "Title": "Engineer" },
  ], false);

  // Id-ish header routed to the ambiguous "Project" canonical ("Ticket ID")
  // still counts as a grouping key — only NAME-ish ones disable the arm.
  expectReroute("data: Ticket ID grouping", [
    { "Ticket ID": "PMM-26-000008", "Team Member": "a@x.com", "Title": "H Mart" },
    { "Ticket ID": "PMM-26-000008", "Team Member": "b@x.com", "Title": "H Mart" },
  ], true);

  // No project-identity column → nothing to group by.
  expectReroute("guard: no project column", [
    { "Team Member": "a@x.com", "Title": "H Mart" },
    { "Team Member": "b@x.com", "Title": "H Mart" },
  ], false);

  // One row per project → no repeat evidence.
  expectReroute("guard: one row per project", [
    { "Project ID": "P1", "Team Member": "a@x.com", "Title": "H Mart" },
    { "Project ID": "P2", "Team Member": "b@x.com", "Title": "Tower A" },
  ], false);

  // End-to-end: data arm through expandSimplifiedSheets — normalized
  // assignments rows must carry ProjectTitle, and never as JobTitle.
  const e2e = expandSimplifiedSheets([{
    sheetName: "Staffing",
    columns: ["Team Member", "Project ID", "Title", "Allocation %"],
    rows: [
      { "Team Member": "alice@x.com", "Project ID": "PMM-26-000008", "Title": "H Mart", "Allocation %": "50" },
      { "Team Member": "bob@x.com",   "Project ID": "PMM-26-000008", "Title": "H Mart", "Allocation %": "25" },
    ],
  }]);
  const asg = e2e.find(s => s.sheetName === "Resource Assignments");
  const r0 = asg?.rows?.[0] as Record<string, unknown> | undefined;
  if (!r0 || r0.ProjectTitle !== "H Mart")
    fail(`title-reroute[e2e]: expected ProjectTitle "H Mart" on normalized row — got ${JSON.stringify(r0 ?? null)}`);
  if (r0 && String(r0.JobTitle ?? "") === "H Mart")
    fail(`title-reroute[e2e]: "H Mart" leaked into JobTitle`);
}

// ── (e) Web-grid label parity (assignments card) ─────────────────────────────
// The import grid re-exports its data as an XLSX whose headers are the grid's
// column LABELS (exportXlsx: out[col.label] = row[col.key]), then the server
// re-derives ALL column mapping from those headers — the client's matcher is
// never consulted (/run sends columnMappings: {}). So any grid label missing
// from the server dictionary is silently dropped server-side even though the
// grid displayed it perfectly. Aug 2026 incident: "Project / Opp ID" was the
// grid's own ID-column label yet unknown to the server, so the exported ID
// column was ignored, rows fell back to linking by project TITLE, and a
// same-named PMM record beat the intended OPM one. This section extracts the
// REAL labels from InlineDataGrid.tsx and asserts each one resolves through
// the server's assignments analyzer — a future label rename fails here
// instead of silently mislinking client data.
{
  const webPath = join(here, "../../rmone-web/src/components/InlineDataGrid.tsx");
  let webSrc = "";
  try { webSrc = readFileSync(webPath, "utf8"); } catch {
    fail(`web-parity: cannot read ${webPath} (component moved? update this check)`);
  }
  if (webSrc) {
    const m = /const ASG_COLS: ColDef\[\] = \[([\s\S]*?)^\];/m.exec(webSrc);
    if (!m) fail("web-parity: ASG_COLS block not found in InlineDataGrid.tsx (renamed? update this check)");
    const defs = [...(m?.[1] ?? "").matchAll(/key:\s*"(asg_[A-Za-z0-9]+)"\s*,\s*label:\s*"([^"]+)"/g)]
      .map(x => ({ key: x[1]!, label: x[2]! }));
    if (defs.length < 5) fail(`web-parity: only ${defs.length} ASG_COLS defs extracted — extraction regex stale?`);
    // Columns the grid exports but the server deliberately leaves unmapped
    // (extra-fields lane). Adding a key here must be a conscious decision —
    // it means that column's data never reaches core2 allocation fields.
    const ALLOW_UNMAPPED = new Set<string>([]);
    const results = analyzeSimplifiedColumns("assignments", defs.map(d => d.label));
    const canonicalByLabel = new Map(results.map(r => [r.col, r.canonical ?? null]));
    for (const d of defs) {
      const canon = canonicalByLabel.get(d.label) ?? null;
      if (canon == null && !ALLOW_UNMAPPED.has(d.key)) {
        fail(
          `web-parity: grid label "${d.label}" (${d.key}) is UNKNOWN to the server's assignments ` +
          `mapping — the exported column would be silently dropped`,
        );
      }
    }
    // The two linking columns must land on EXACTLY the right fields — a wrong
    // (but non-null) destination is just as silent as an unmapped one.
    const expectExact = (key: string, want: string[]) => {
      const d = defs.find(x => x.key === key);
      if (!d) { fail(`web-parity: expected grid col ${key} not found in ASG_COLS`); return; }
      const canon = canonicalByLabel.get(d.label) ?? null;
      if (!canon || !want.includes(canon)) {
        fail(`web-parity: grid label "${d.label}" (${key}) resolves to ${canon ?? "null"} — expected ${want.join(" | ")}`);
      }
    };
    expectExact("asg_projectId", ["TicketId"]);
    expectExact("asg_project", ["Project", "ProjectTitle"]);
  }
}

// ── (e2) Web-grid label parity (schedule card) ───────────────────────────────
// Same incident class as (e), but for the Schedule tab: insertScheduleBatch
// maps headers through its OWN dictionary (mapScheduleHeader), separate from
// SYNONYM_MAP. Aug 2026: the grid's "Project / Opp ID" label was missing from
// that dictionary, so update-mode (strict ID keys — titles never link)
// schedule imports skipped every row and told the user no Project Titles
// existed in a file full of them. Every schedule grid label must resolve —
// and the linking columns must land exactly right.
{
  const webPath = join(here, "../../rmone-web/src/components/InlineDataGrid.tsx");
  let webSrc = "";
  try { webSrc = readFileSync(webPath, "utf8"); } catch {
    fail(`sched-parity: cannot read ${webPath} (component moved? update this check)`);
  }
  if (webSrc) {
    const m = /const SCHEDULE_COLS: ColDef\[\] = \[([\s\S]*?)^\];/m.exec(webSrc);
    if (!m) fail("sched-parity: SCHEDULE_COLS block not found in InlineDataGrid.tsx (renamed? update this check)");
    const defs = [...(m?.[1] ?? "").matchAll(/key:\s*"(sch_[A-Za-z0-9]+)"\s*,\s*label:\s*"([^"]+)"/g)]
      .map(x => ({ key: x[1]!, label: x[2]! }));
    if (defs.length < 5) fail(`sched-parity: only ${defs.length} SCHEDULE_COLS defs extracted — extraction regex stale?`);
    for (const d of defs) {
      if (mapScheduleHeader(d.label) == null) {
        fail(
          `sched-parity: schedule grid label "${d.label}" (${d.key}) is UNKNOWN to mapScheduleHeader — ` +
          `the exported column would be silently ignored (for ID columns, strict-mode rows all skip)`,
        );
      }
    }
    const expectSched = (key: string, want: string) => {
      const d = defs.find(x => x.key === key);
      if (!d) { fail(`sched-parity: expected grid col ${key} not found in SCHEDULE_COLS`); return; }
      const canon = mapScheduleHeader(d.label);
      if (canon !== want) fail(`sched-parity: schedule grid label "${d.label}" (${key}) maps to ${canon ?? "null"} — expected ${want}`);
    };
    expectSched("sch_projectId", "__projid");
    expectSched("sch_project",   "__proj");
    expectSched("sch_phaseName", "__phase");
    // Downloadable template headers must keep working too.
    for (const [tpl, want] of [
      ["Project ID", "__projid"], ["Ticket ID", "__projid"], ["Project / Opp ID", "__projid"],
      ["Project Title", "__proj"], ["Title", "__proj"], ["Phase Name", "__phase"],
    ] as const) {
      if (mapScheduleHeader(tpl) !== want) {
        fail(`sched-parity: template header "${tpl}" maps to ${mapScheduleHeader(tpl) ?? "null"} — expected ${want}`);
      }
    }
    // Deliberate NON-aliases: a generic "Record ID" on a schedule export
    // plausibly identifies the phase/task row itself, not the parent
    // project — mapping it to __projid would silently beat the real ID
    // column. This must stay unmapped (review decision, Aug 2026).
    if (mapScheduleHeader("Record ID") !== null) {
      fail(`sched-parity: "Record ID" must NOT map (got ${mapScheduleHeader("Record ID")}) — ambiguous parent-vs-row identifier`);
    }
  }
}

// ── (f) Web-grid explicit mapping table parity (all cards) ───────────────────
// The grid now SENDS its header→field map with every submission
// (rmone-web/src/lib/importServerFields.ts, forwarded to /preflight and /run
// with mappingsSource:"grid") and the server applies it verbatim. That table
// must therefore stay a bit-exact mirror of what the server's own resolvers
// decide for the grid's labels. This section re-derives everything from the
// REAL pipeline and fails on drift in EITHER direction:
//   • a table entry the analyzer disagrees with (wrong destination pinned)
//   • a resolvable grid label missing from the table (silently unpinned)
//   • two labels pinned to one canonical (pre-renaming both would collapse
//     two columns into one row key — one value clobbers the other)
//   • a pinned canonical that doesn't re-resolve to itself (rename would
//     break downstream analysis)
//   • routing drift: raw labels no longer content-score to the declared tab,
//     or the RENAMED headers score to a DIFFERENT tab. Renamed → null is
//     allowed: canonical headers can look like a raw DB export and skip
//     content scoring — the pages pin the job's forcedTabType whenever they
//     send grid mappings, which is the documented fallback for exactly this.
{
  const gridPath  = join(here, "../../rmone-web/src/components/InlineDataGrid.tsx");
  const tablePath = join(here, "../../rmone-web/src/lib/importServerFields.ts");
  let gridSrc = "", tableSrc = "";
  try { gridSrc = readFileSync(gridPath, "utf8"); } catch {
    fail(`grid-table: cannot read ${gridPath} (component moved? update this check)`);
  }
  try { tableSrc = readFileSync(tablePath, "utf8"); } catch {
    fail(`grid-table: cannot read ${tablePath} (lib moved? update this check)`);
  }
  if (gridSrc && tableSrc) {
    // Sheet name → grid column-array constant (lockstep with getTabsForCard).
    const SHEET_TO_ARRAY: Record<string, string> = {
      "Projects":         "PROJECT_COLS",
      "Schedule":         "SCHEDULE_COLS",
      "Staff":            "STAFF_COLS",
      "Team Assignments": "ASG_COLS",
      "Opportunities":    "OPP_COLS",
      "Leads":            "LEADS_COLS",
      "Companies":        "COMPANIES_COLS",
    };
    // Labels that DO resolve server-side but are deliberately NOT pinned:
    // same-destination pairs (both mean Status). Pre-renaming both would
    // collapse two columns into one row key with one value clobbering the
    // other; the pipeline's rank-based duplicate-column winner handles them
    // correctly at expansion time instead.
    const RESOLVED_BUT_UNPINNED: Record<string, Set<string>> = {
      "Opportunities": new Set(["Stage", "Status"]),
      "Leads":         new Set(["Stage", "Status"]),
    };

    const labelsOf = (arrName: string): string[] | null => {
      const m = new RegExp(`const ${arrName}: ColDef\\[\\] = \\[([\\s\\S]*?)^\\];`, "m").exec(gridSrc);
      if (!m) return null;
      return [...m[1]!.matchAll(/key:\s*"([A-Za-z0-9_]+)"\s*,\s*label:\s*"([^"]+)"/g)].map(x => x[2]!);
    };

    // Parse SERVER_FIELD_BY_SHEET — sheet blocks contain no nested braces.
    const tblM = /export const SERVER_FIELD_BY_SHEET[^=]*=\s*\{([\s\S]*?)\n\};/.exec(tableSrc);
    const tabM = /export const SHEET_SERVER_TAB[^=]*=\s*\{([^}]*)\}/.exec(tableSrc);
    if (!tblM) fail("grid-table: SERVER_FIELD_BY_SHEET not found in importServerFields.ts");
    if (!tabM) fail("grid-table: SHEET_SERVER_TAB not found in importServerFields.ts");
    const table = new Map<string, Map<string, string>>();
    for (const bm of (tblM?.[1] ?? "").matchAll(/"([^"]+)":\s*\{([^}]*)\},/g)) {
      const entries = new Map<string, string>();
      for (const em of bm[2]!.matchAll(/"([^"]+)":\s*"([^"]+)",/g)) entries.set(em[1]!, em[2]!);
      table.set(bm[1]!, entries);
    }
    const declaredTabs = new Map<string, "team" | "clients">();
    for (const tm of (tabM?.[1] ?? "").matchAll(/"([^"]+)":\s*"(team|clients)"/g))
      declaredTabs.set(tm[1]!, tm[2] as "team" | "clients");
    if (table.size < 5) fail(`grid-table: only ${table.size} sheet blocks parsed — table format changed? update this check`);

    // Exact sheet set: every grid card except Schedule MUST stay pinned.
    // Without this, deleting a sheet from both exports would pass silently
    // and that card would fall back to server-side re-guessing — the exact
    // incident class this table exists to prevent.
    const EXPECTED_PINNED_SHEETS = ["Projects", "Staff", "Team Assignments", "Opportunities", "Leads", "Companies"];
    for (const s of EXPECTED_PINNED_SHEETS)
      if (!table.has(s))
        fail(`grid-table: sheet "${s}" missing from SERVER_FIELD_BY_SHEET — every grid card except Schedule must stay pinned`);

    // Table + tab declarations must cover the same sheets, all known.
    for (const s of table.keys()) {
      if (!SHEET_TO_ARRAY[s]) fail(`grid-table: table sheet "${s}" is not a known grid sheet (typo? new card? update SHEET_TO_ARRAY)`);
      if (!declaredTabs.has(s)) fail(`grid-table: sheet "${s}" has mappings but no SHEET_SERVER_TAB entry`);
    }
    for (const s of declaredTabs.keys())
      if (!table.has(s)) fail(`grid-table: SHEET_SERVER_TAB declares "${s}" but the table has no mappings for it`);

    // Schedule is deliberately absent: it never routes through the simplified
    // tabs (own importer, own header handling). If that ever changes, decide
    // whether it joins the table rather than silently inheriting behavior.
    if (table.has("Schedule")) fail("grid-table: Schedule must NOT be in the table (schedule sheets bypass simplified routing)");
    {
      const schedLabels = labelsOf("SCHEDULE_COLS");
      if (!schedLabels) fail("grid-table: SCHEDULE_COLS not found in InlineDataGrid.tsx");
      else {
        const schedTab = resolveSimplifiedTab({ sheetName: "Schedule", columns: schedLabels, rows: [] } as any);
        if (schedTab !== null)
          fail(`grid-table: Schedule sheet now resolves to tab "${schedTab}" — it was skipped by design; revisit the table exclusion`);
      }
    }

    for (const [sheetName, entries] of table) {
      const arrName = SHEET_TO_ARRAY[sheetName];
      if (!arrName) continue; // already failed above
      const labels = labelsOf(arrName);
      if (!labels || labels.length < 5) {
        fail(`grid-table: ${arrName} not extracted from InlineDataGrid.tsx (renamed? regex stale?)`);
        continue;
      }
      const declared = declaredTabs.get(sheetName);
      if (!declared) continue; // already failed above

      // 1. Raw labels must content-score to the declared tab (today's routing).
      const rawTab = resolveSimplifiedTab({ sheetName, columns: labels, rows: [] } as any);
      if (rawTab !== declared)
        fail(`grid-table: "${sheetName}" raw labels route to ${rawTab ?? "null"} — SHEET_SERVER_TAB says ${declared}`);

      const analysis = analyzeSimplifiedColumns(declared, labels);
      const canonOf = new Map(analysis.map(r => [r.col, r.canonical ?? null]));
      const unpinned = RESOLVED_BUT_UNPINNED[sheetName] ?? new Set<string>();

      // 2. Every table entry matches the analyzer exactly, on a label the grid still exports.
      for (const [label, canon] of entries) {
        if (!labels.includes(label)) {
          fail(`grid-table: "${sheetName}" pins "${label}" but the grid no longer exports that label`);
          continue;
        }
        const got = canonOf.get(label) ?? null;
        if (got !== canon)
          fail(`grid-table: "${sheetName}"."${label}" pinned to ${canon} but the server resolves it to ${got ?? "null"}`);
      }
      // 3. Reverse: every label the server resolves must be pinned (or listed as deliberately unpinned).
      for (const label of labels) {
        const got = canonOf.get(label) ?? null;
        if (got != null && !entries.has(label) && !unpinned.has(label))
          fail(`grid-table: "${sheetName}"."${label}" resolves to ${got} but is missing from the table — new/renamed grid column? regenerate the entry`);
      }
      // 3b. The unpinned allowlist must stay honest.
      for (const label of unpinned) {
        if (entries.has(label)) fail(`grid-table: "${sheetName}"."${label}" is in RESOLVED_BUT_UNPINNED but ALSO pinned in the table`);
        if ((canonOf.get(label) ?? null) == null)
          fail(`grid-table: "${sheetName}"."${label}" is in RESOLVED_BUT_UNPINNED but no longer resolves — stale allowlist entry`);
      }
      // 4. No two pinned labels may share a canonical (rename clobber).
      const byCanon = new Map<string, string>();
      for (const [label, canon] of entries) {
        const prev = byCanon.get(canon);
        if (prev) fail(`grid-table: "${sheetName}" pins BOTH "${prev}" and "${label}" to ${canon} — renames would clobber one column's values`);
        else byCanon.set(canon, label);
      }
      // 5. Idempotence + routing of the RENAMED header set (what /run analyzes
      //    after applying the grid's mappings).
      const renamed = labels.map(l => entries.get(l) ?? l);
      // 4b. The FULL post-rename header set must stay unique — a pinned
      // destination can also collide with an UNPINNED raw header that keeps
      // its name (same row-key clobber as two pinned labels, different route).
      const renamedSeen = new Map<string, string>();
      renamed.forEach((h, i) => {
        const prev = renamedSeen.get(h);
        if (prev !== undefined)
          fail(`grid-table: "${sheetName}" post-rename header "${h}" appears twice (from "${prev}" and "${labels[i]}") — one column's values would clobber the other`);
        else renamedSeen.set(h, labels[i]!);
      });
      const reCanon = new Map(analyzeSimplifiedColumns(declared, renamed).map(r => [r.col, r.canonical ?? null]));
      for (const [label, canon] of entries) {
        if (!labels.includes(label)) continue;
        const got = reCanon.get(canon) ?? null;
        if (got !== canon)
          fail(`grid-table: "${sheetName}" canonical ${canon} does not re-resolve to itself after rename (got ${got ?? "null"})`);
      }
      const renamedTab = resolveSimplifiedTab({ sheetName, columns: renamed, rows: [] } as any);
      if (renamedTab !== null && renamedTab !== declared)
        fail(`grid-table: "${sheetName}" renamed headers route to ${renamedTab} (declared ${declared}) — mappings would change the processing path`);
    }
  }
}

if (failures) {
  console.error(`\nsynonym-map check: ${failures} failure(s).`);
  process.exit(1);
}
console.log("synonym-map check: OK (collisions + per-tab routing + tie-breaks + Title re-route + web label parity + grid mapping table)");
process.exit(0);
