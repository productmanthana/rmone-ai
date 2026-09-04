// Builds the edge-case test workbooks:
//  1) /tmp/edge-seed.xlsx    — baseline data for the synthetic "Edge Test Co"
//  2) /tmp/edge-cases.xlsx   — edge matrix uploaded on top of the seed
//  3) ../../test-files/RM-ONE-Edge-Case-Test-Alston.xlsx — user-facing copy
//     tailored to LIVE Alston AI data (real names/titles for near-miss rows).
import ExcelJS from "exceljs";
import * as path from "node:path";
import * as fs from "node:fs";

type Row = Record<string, string | number | null>;
async function writeWb(file: string, sheets: { name: string; headers: string[]; rows: Row[] }[]) {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.addRow(s.headers);
    ws.getRow(1).font = { bold: true };
    for (const r of s.rows) ws.addRow(s.headers.map(h => r[h] ?? null));
    s.headers.forEach((h, i) => { ws.getColumn(i + 1).width = Math.max(16, h.length + 6); });
  }
  await wb.xlsx.writeFile(file);
  console.log("wrote", file);
}

const TEAM_H = ["Full Name", "Login Email", "Division", "Department", "Role", "Job Title", "Access Level"];
const PROJ_H = ["Project Title", "Company Name", "Status", "Start Date", "End Date", "Contract Value"];
const ASGN_H = ["Project", "Name", "Email", "Start Date", "End Date", "Total Hours", "Type"];

async function main() {
  // ── 1) Seed: known-good baseline ─────────────────────────────────────────
  await writeWb("/tmp/edge-seed.xlsx", [
    { name: "Your Team", headers: TEAM_H, rows: [
      { "Full Name": "John Smith",         "Login Email": "john.smith@edgetestco.com",  Division: "Buildings", Department: "Engineering",  Role: "Project Manager",  "Job Title": "Project Manager",  "Access Level": "User" },
      { "Full Name": "Sarah Connor",       "Login Email": "sarah.connor@edgetestco.com",Division: "Buildings", Department: "Field Ops",    Role: "Superintendent",   "Job Title": "Superintendent",   "Access Level": "User" },
      { "Full Name": "Jane Doe",           "Login Email": "jane.doe@edgetestco.com",    Division: "Buildings", Department: "Engineering",  Role: "Project Engineer", "Job Title": "Project Engineer", "Access Level": "User" },
      { "Full Name": "Christopher Milton", "Login Email": "chris.milton@edgetestco.com",Division: "Buildings", Department: "Engineering",  Role: "Estimator",        "Job Title": "Estimator",        "Access Level": "User" },
      { "Full Name": "Christoper Milton",  "Login Email": "c.milton2@edgetestco.com",   Division: "Buildings", Department: "Field Ops",    Role: "Foreman",          "Job Title": "Foreman",          "Access Level": "User" },
    ]},
    { name: "Clients & Projects", headers: PROJ_H, rows: [
      { "Project Title": "Riverside Tower",       "Company Name": "Edge Client LLC",  Status: "Active",  "Start Date": "2026-01-05", "End Date": "2026-12-18", "Contract Value": 1000000 },
      { "Project Title": "Harbor Bridge Retrofit","Company Name": "Edge Client LLC",  Status: "Active",  "Start Date": "2026-02-02", "End Date": "2026-10-30", "Contract Value": 750000 },
      { "Project Title": "Mercy Hospital Wing",   "Company Name": "Mercy Health",     Status: "On Hold", "Start Date": "2026-03-02", "End Date": "2027-03-26", "Contract Value": 2400000 },
    ]},
    { name: "Assignments", headers: ASGN_H, rows: [
      { Project: "Riverside Tower", Name: "John Smith", Email: "john.smith@edgetestco.com", "Start Date": "2026-01-05", "End Date": "2026-06-26", "Total Hours": 400, Type: "Hard" },
    ]},
  ]);

  // ── 2) Edge matrix on top of the seed ────────────────────────────────────
  await writeWb("/tmp/edge-cases.xlsx", [
    { name: "Your Team", headers: TEAM_H, rows: [
      // T-EXACT: exact person (same email) — silent update (job title changes)
      { "Full Name": "John Smith",       "Login Email": "john.smith@edgetestco.com", Division: "Buildings", Department: "Engineering", Role: "Project Manager", "Job Title": "Senior Project Manager", "Access Level": "User" },
      // T-NEAR: near-miss name, unknown email — should be HELD, never guessed
      { "Full Name": "Jon Smith",        "Login Email": "jon.smith@edgetestco.com",  Division: "Buildings", Department: "Engineering", Role: "Project Manager", "Job Title": "Project Manager", "Access Level": "User" },
      // T-SAMENAME: identical name, DIFFERENT email — different person → new
      { "Full Name": "John Smith",       "Login Email": "john.smith2@edgetestco.com",Division: "Buildings", Department: "Field Ops",   Role: "Foreman",          "Job Title": "Foreman", "Access Level": "User" },
      // T-AMBIG: no email, name close to TWO existing Miltons — ambiguous → held
      { "Full Name": "Christofer Milton","Login Email": null,                        Division: "Buildings", Department: "Engineering", Role: "Estimator",        "Job Title": "Estimator", "Access Level": "User" },
      // T-BLANK: required name missing — held by pre-upload validation
      { "Full Name": null,               "Login Email": "blank.name@edgetestco.com", Division: "Buildings", Department: "Engineering", Role: "Estimator",        "Job Title": "Estimator", "Access Level": "User" },
    ]},
    { name: "Clients & Projects", headers: PROJ_H, rows: [
      // P-EXACT: exact title — silent update (status changes Active → On Hold)
      { "Project Title": "Riverside Tower", "Company Name": "Edge Client LLC", Status: "On Hold", "Start Date": "2026-01-05", "End Date": "2026-12-18", "Contract Value": 1000000 },
      // P-NEAR: typo'd title, no ID — held for review, never guessed
      { "Project Title": "Riverside Towr",  "Company Name": "Edge Client LLC", Status: "Active",  "Start Date": "2026-01-05", "End Date": "2026-12-18", "Contract Value": 1000000 },
      // P-NEW: brand-new title — inserted
      { "Project Title": "Skyline Depot",   "Company Name": "Edge Client LLC", Status: "Active",  "Start Date": "2026-09-01", "End Date": "2027-06-25", "Contract Value": 500000 },
      // P-BLANK: required title missing — held by pre-upload validation
      { "Project Title": null,              "Company Name": "Edge Client LLC", Status: "Active",  "Start Date": "2026-09-01", "End Date": "2027-06-25", "Contract Value": 100000 },
    ]},
    { name: "Assignments", headers: ASGN_H, rows: [
      // A-FWD: assignment onto a project that is NEW in this same file — legal
      { Project: "Skyline Depot",  Name: "Jane Doe",    Email: "jane.doe@edgetestco.com", "Start Date": "2026-09-07", "End Date": "2026-12-25", "Total Hours": 160, Type: "Hard" },
      // A-NEARPERSON: typo'd person, no email — held
      { Project: "Riverside Tower", Name: "Sara Connor", Email: null,                     "Start Date": "2026-09-07", "End Date": "2026-12-25", "Total Hours": 80,  Type: "Soft" },
      // A-UNKNOWNPROJ: project that exists nowhere — held
      { Project: "Atlantis Mall",   Name: "John Smith",  Email: "john.smith@edgetestco.com", "Start Date": "2026-09-07", "End Date": "2026-12-25", "Total Hours": 40, Type: "Soft" },
    ]},
  ]);

  // ── 3) User-facing Alston AI file (same patterns, live data) ─────────────
  const outDir = "/home/runner/workspace/test-files";
  fs.mkdirSync(outDir, { recursive: true });
  await writeWb(path.join(outDir, "RM-ONE-Edge-Case-Test-Alston.xlsx"), [
    { name: "Your Team", headers: TEAM_H, rows: [
      // exact person (same email) — silent update, no visible change
      { "Full Name": "Mike Murry",  "Login Email": "fake10@rmone.com", Role: "Project Manager", "Job Title": "Project Manager" },
      // near-miss spelling of Mike Murry, no email — should appear in Needs attention
      { "Full Name": "Mike Murrey", "Login Email": null,               Role: "Project Manager", "Job Title": "Project Manager" },
      // same name as existing Gopu Pillai but DIFFERENT email — new separate person
      { "Full Name": "Gopu Pillai", "Login Email": "gopu.edgetest@rmone-test.com", Role: "Project Manager", "Job Title": "Project Manager" },
      // blank required name — held by pre-upload validation with a clear error
      { "Full Name": null,          "Login Email": "edge.blank@rmone-test.com",    Role: "Estimator", "Job Title": "Estimator" },
    ]},
    { name: "Clients & Projects", headers: PROJ_H, rows: [
      // exact existing project, all values unchanged — proves updates do no damage
      { "Project Title": "BP USF Plainfield",   "Company Name": null, Status: "Construction" },
      // typo of existing "H Mart" — held for review, never guessed
      { "Project Title": "H Martt",             "Company Name": null, Status: "Preconstruction" },
      // clearly-labelled brand-new test project — inserted
      { "Project Title": "ZZ Edge Test Project","Company Name": "Edge Test Client", Status: "Active", "Start Date": "2026-09-01", "End Date": "2027-03-26", "Contract Value": 123456 },
      // blank required title — held by pre-upload validation
      { "Project Title": null,                  "Company Name": "Edge Test Client", Status: "Active" },
    ]},
    { name: "Assignments", headers: ASGN_H, rows: [
      // valid assignment onto the new TEST project only — real projects untouched
      { Project: "ZZ Edge Test Project", Name: "Chris Kiziak", Email: "fake12@rmone.com", "Start Date": "2026-09-07", "End Date": "2026-11-27", "Total Hours": 120, Type: "Soft" },
      // typo'd person (Phil Noblett), no email — held
      { Project: "ZZ Edge Test Project", Name: "Phil Noblet",  Email: null, "Start Date": "2026-09-07", "End Date": "2026-11-27", "Total Hours": 80, Type: "Soft" },
      // unknown project — held
      { Project: "Nonexistent Project XYZ", Name: "Jim Kelly", Email: "fake14@rmone.com", "Start Date": "2026-09-07", "End Date": "2026-11-27", "Total Hours": 40, Type: "Soft" },
    ]},
  ]);
}
main().then(() => process.exit(0)).catch(e => { console.error("BUILD_FAIL", e); process.exit(1); });
