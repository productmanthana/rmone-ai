/**
 * Generates two large test XLSX files to exercise OOM fixes:
 *  - assignments-65k.xlsx  : single "Assignments" sheet, 64,587 lump-sum rows
 *  - combined-67k.xlsx     : three sheets (Projects ~3k, Staff ~2k, Assignments ~62k)
 * Uses ExcelJS streaming WorkbookWriter to avoid materialising all rows in RAM.
 * Dates are ISO strings ("YYYY-MM-DD") to avoid the sheetjs serial-date drift trap.
 */
import ExcelJS from "exceljs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../..");  // workspace root

const PROJECTS = 500;
const STAFF    = 300;

// Generate a stable set of project + person names
const projects = Array.from({ length: PROJECTS }, (_, i) => ({
  id:    `TST-24-${String(i + 1).padStart(6, "0")}`,
  title: `Test Project ${i + 1}`,
  start: "2024-01-01",
  end:   "2026-12-31",
  status: "Active",
  type:  "Project",
}));

const roles = ["Project Manager", "Engineer", "Analyst", "Coordinator", "Designer"];
const people = Array.from({ length: STAFF }, (_, i) => ({
  name:  `Person ${i + 1}`,
  email: `person${i + 1}@testco.com`,
  role:  roles[i % roles.length],
  title: roles[i % roles.length],
}));

// Each person assigned to ceil(ROWS/STAFF/PROJECTS) projects with lump-sum spans
// Target ~64,587 assignment rows = STAFF * PROJECTS * ~0.43
const TARGET_ASSIGN = 64_587;
let assignRows = [];
outer: for (const project of projects) {
  for (const person of people) {
    assignRows.push({
      ProjectTitle: project.title,
      TicketId:     project.id,
      TeamMember:   person.name,
      Email:        person.email,
      Role:         person.role,
      Title:        person.title,
      StartDate:    project.start,
      EndDate:      project.end,
      Allocation:   "100",
    });
    if (assignRows.length >= TARGET_ASSIGN) break outer;
  }
}

console.log(`Generating ${assignRows.length} assignment rows across ${PROJECTS} projects…`);

// ── 1. assignments-65k.xlsx ──────────────────────────────────────────────────
{
  const outPath = path.join(OUT, "assignments-65k.xlsx");
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: outPath, useStyles: false });
  const ws = wb.addWorksheet("Assignments");
  const headers = Object.keys(assignRows[0]);
  ws.addRow(headers).commit();
  for (const row of assignRows) {
    ws.addRow(headers.map(h => row[h])).commit();
  }
  await ws.commit();
  await wb.commit();
  console.log(`  ✓ written: ${outPath} (${assignRows.length} data rows)`);
}

// ── 2. combined-67k.xlsx ─────────────────────────────────────────────────────
{
  const outPath = path.join(OUT, "combined-67k.xlsx");
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: outPath, useStyles: false });

  // Projects sheet
  const wsP = wb.addWorksheet("Projects");
  const pHeaders = ["Title", "TicketId", "StartDate", "EndDate", "Status", "Type"];
  wsP.addRow(pHeaders).commit();
  for (const p of projects) wsP.addRow([p.title, p.id, p.start, p.end, p.status, p.type]).commit();
  await wsP.commit();
  console.log(`  Projects sheet: ${projects.length} rows`);

  // Staff sheet
  const wsS = wb.addWorksheet("Staff");
  const sHeaders = ["Full Name", "Email", "Role", "Title"];
  wsS.addRow(sHeaders).commit();
  for (const p of people) wsS.addRow([p.name, p.email, p.role, p.title]).commit();
  await wsS.commit();
  console.log(`  Staff sheet: ${people.length} rows`);

  // Assignments sheet — pad to ~62k to hit ~67k total
  const TARGET_ASSIGN_COMBINED = 62_000;
  let count = 0;
  const wsA = wb.addWorksheet("Assignments");
  const aHeaders = Object.keys(assignRows[0]);
  wsA.addRow(aHeaders).commit();
  for (let pass = 0; count < TARGET_ASSIGN_COMBINED; pass++) {
    for (const row of assignRows) {
      wsA.addRow(aHeaders.map(h => row[h])).commit();
      count++;
      if (count >= TARGET_ASSIGN_COMBINED) break;
    }
  }
  await wsA.commit();
  console.log(`  Assignments sheet: ${count} rows`);

  await wb.commit();
  const total = projects.length + people.length + count;
  console.log(`  ✓ written: ${outPath} (~${total} data rows total)`);
}

console.log("Done.");
