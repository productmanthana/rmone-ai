/**
 * Web-side Title vs JobTitle re-route harness (CI gate).
 * Run: npx tsx scripts/check-title-reroute-web.ts
 *
 * The import grid's column matching lives INSIDE a React component
 * (../rmone-web/src/components/InlineDataGrid.tsx), so it cannot be imported
 * directly (JSX, browser-only APIs). Following the established harness
 * pattern, this script extracts the REAL matcher source — everything from
 * `const SKIP` down through the data-driven bare-"Title" re-route — plus the
 * ASG_COLS column defs into a temp module, then runs fixtures against it:
 *   1. IDENTITY — every ASG_COLS label maps to its own key (collision guard).
 *   2. HEADER ARM — bare "Title" beside a real "Job Title" header re-routes
 *      to asg_project (LOSER_FALLBACK in buildNoDupMappings).
 *   3. DATA ARM — only-"Title" files re-route when the same value repeats on
 *      every row of each project; stay on Job Title otherwise.
 * Server twin: reRouteAssignmentsBareTitle (src/lib/pipeline.ts), covered by
 * scripts/check-synonym-mapping.ts §d. Keep the two rule sets in lockstep.
 *
 * Exit code 0 = all good; 1 = extraction drift or a fixture failure.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const componentPath = join(here, "../../rmone-web/src/components/InlineDataGrid.tsx");
const src = readFileSync(componentPath, "utf8");

// ── Extraction ──────────────────────────────────────────────────────────────
// Slices are anchored on stable declarations. If one goes missing the script
// fails loudly ("extraction drift") rather than silently testing nothing.
function sliceBetween(startRe: RegExp, endRe: RegExp, label: string): string {
  const s = src.search(startRe);
  if (s < 0) throw new Error(`extraction drift: start marker not found for ${label} (${startRe})`);
  const rest = src.slice(s);
  const e = rest.search(endRe);
  if (e < 0) throw new Error(`extraction drift: end marker not found for ${label} (${endRe})`);
  return rest.slice(0, e);
}

// ASG_COLS array literal (self-contained object literals).
const asgCols = sliceBetween(/^const ASG_COLS: ColDef\[\] = \[/m, /^\];/m, "ASG_COLS") + "];\n";
// The whole matcher region: SYNONYMS → buildNoDupMappings → the re-route
// pair. Ends right before collectSamples (the first function after them).
const matchers = sliceBetween(/^const SKIP = /m, /^\/\/ First few distinct non-blank values/m, "matcher region");

const prelude = `/* AUTO-EXTRACTED from InlineDataGrid.tsx by check-title-reroute-web.ts — do not edit */
type ColDef = { key: string; label: string; w?: number; type?: string; opts?: string[] };
type Row = Record<string, string>;
`;
const epilogue = `
export { SKIP, norm, autoMapToColDef, buildNoDupMappings, reRouteBareTitleByData, titleValuesConstantPerProject, ASG_COLS };
`;
const modPath = join(mkdtempSync(join(tmpdir(), "title-reroute-")), "matchers-extracted.ts");
writeFileSync(modPath, prelude + asgCols + "\n" + matchers + epilogue);

let failures = 0;
const fail = (msg: string) => { failures++; console.error("FAIL  " + msg); };

const m = await import(pathToFileURL(modPath).href);
const COLS = m.ASG_COLS as Array<{ key: string; label: string }>;

// Mirrors the component call site: data-bearing headers claim first, then the
// data-driven re-route post-processes the mappings.
function mapWithData(headers: string[], rows: Record<string, string>[]): Record<string, string> {
  const dataHeaders = new Set(headers.filter(h => rows.some(r => String(r[h] ?? "").trim() !== "")));
  const mappings = m.buildNoDupMappings(headers, COLS, (h: string) => dataHeaders.has(h)) as Record<string, string>;
  m.reRouteBareTitleByData(mappings, COLS, rows);
  return mappings;
}

// ── 1. Identity suite: every template label claims its own column ───────────
for (const col of COLS) {
  const got = (m.buildNoDupMappings([col.label], COLS) as Record<string, string>)[col.label];
  if (got !== col.key) fail(`identity: label "${col.label}" mapped to ${got} — expected ${col.key}`);
}

// ── 2/3. Re-route fixtures (lockstep with check-synonym-mapping.ts §d) ──────
const check = (label: string, headers: string[], rows: Record<string, string>[], wantTitleKey: string) => {
  const got = mapWithData(headers, rows)["Title"];
  if (got !== wantTitleKey) fail(`${label}: "Title" → ${got} — expected ${wantTitleKey}`);
};

// HEADER ARM: "Job Title" label-claims the job-title column; bare "Title"
// loses and re-routes to the project column (existing LOSER_FALLBACK).
check("header arm: Title beside Job Title", ["Project ID", "Name", "Title", "Job Title"], [
  { "Project ID": "P1", "Name": "A", "Title": "H Mart", "Job Title": "Engineer" },
  { "Project ID": "P1", "Name": "B", "Title": "H Mart", "Job Title": "PM" },
], "asg_project");

// DATA ARM: only-"Title" file, constant per project, names differ across.
check("data arm: constant per project", ["Project ID", "Name", "Title"], [
  { "Project ID": "PMM-26-000008", "Name": "A", "Title": "H Mart" },
  { "Project ID": "PMM-26-000008", "Name": "B", "Title": "H Mart" },
  { "Project ID": "PMM-26-000009", "Name": "C", "Title": "Tower A" },
  { "Project ID": "PMM-26-000009", "Name": "D", "Title": "Tower A" },
], "asg_project");

// DATA ARM: single-project file (the original "H Mart" shape).
check("data arm: single project constant", ["Project ID", "Name", "Title"], [
  { "Project ID": "PMM-26-000008", "Name": "A", "Title": "H Mart" },
  { "Project ID": "PMM-26-000008", "Name": "B", "Title": "H Mart" },
  { "Project ID": "PMM-26-000008", "Name": "C", "Title": "H Mart" },
], "asg_project");

// Varies within a project → per-person job title; must NOT re-route.
check("data arm: varies within project", ["Project ID", "Name", "Title"], [
  { "Project ID": "P1", "Name": "A", "Title": "Engineer" },
  { "Project ID": "P1", "Name": "B", "Title": "PM" },
], "asg_jobTitle");

// Same single value across ALL projects → company-wide job title.
check("data arm: same value on every project", ["Project ID", "Name", "Title"], [
  { "Project ID": "P1", "Name": "A", "Title": "Engineer" },
  { "Project ID": "P1", "Name": "B", "Title": "Engineer" },
  { "Project ID": "P2", "Name": "C", "Title": "Engineer" },
  { "Project ID": "P2", "Name": "D", "Title": "Engineer" },
], "asg_jobTitle");

// Id-ish "Ticket ID" header also maps to asg_projectId → grouping works
// (parity with the server's "Ticket ID grouping" fixture).
check("data arm: Ticket ID grouping", ["Ticket ID", "Name", "Title"], [
  { "Ticket ID": "PMM-26-000008", "Name": "A", "Title": "H Mart" },
  { "Ticket ID": "PMM-26-000008", "Name": "B", "Title": "H Mart" },
], "asg_project");

// A project-name column is already mapped → never steal asg_project.
check("guard: project name column present", ["Project ID", "Project", "Name", "Title"], [
  { "Project ID": "P1", "Project": "Tower A", "Name": "A", "Title": "H Mart" },
  { "Project ID": "P1", "Project": "Tower A", "Name": "B", "Title": "H Mart" },
], "asg_jobTitle");

// No project-id column → nothing to group by.
check("guard: no project id column", ["Name", "Title"], [
  { "Name": "A", "Title": "H Mart" },
  { "Name": "B", "Title": "H Mart" },
], "asg_jobTitle");

// One row per project → no repeat evidence.
check("guard: one row per project", ["Project ID", "Name", "Title"], [
  { "Project ID": "P1", "Name": "A", "Title": "H Mart" },
  { "Project ID": "P2", "Name": "B", "Title": "Tower A" },
], "asg_jobTitle");

// Orphan promotion: a weaker job-title synonym ("Designation") that lost to
// bare "Title" claims the freed Job Title column after the data re-route.
{
  const mp = mapWithData(["Project ID", "Name", "Title", "Designation"], [
    { "Project ID": "P1", "Name": "A", "Title": "H Mart", "Designation": "Engineer" },
    { "Project ID": "P1", "Name": "B", "Title": "H Mart", "Designation": "PM" },
  ]);
  if (mp["Title"] !== "asg_project") fail(`orphan promotion: "Title" → ${mp["Title"]} — expected asg_project`);
  if (mp["Designation"] !== "asg_jobTitle") fail(`orphan promotion: "Designation" → ${mp["Designation"]} — expected asg_jobTitle`);
}

if (failures) {
  console.error(`\ntitle-reroute web check: ${failures} failure(s).`);
  process.exit(1);
}
console.log("title-reroute web check: OK (identity + header arm + data arm)");
process.exit(0);
