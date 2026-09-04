/* Generates two test workbooks for the "Missing Data Management" spec.
   File 1: deliberately-blank fields -> exercises onboarding defaults.
   File 2: same records with the blanks now filled -> tests assumed->validated auto-replace. */
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");

const OUT_DIR = path.resolve(__dirname, "../../../attached_assets/missing-data-tests");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Exact header strings the onboarding importer recognizes (simplified template).
const TEAM = ["Division","Department","Role","Billing Rate","Labor Rate","Cost Rate","Job Title","Job Profile","Login Email","Full Name","Email","Password","Access Level","Manager","Start Date","End Date","Is Manager"];
const CLIENTS = ["Type","Company Name","Contacts","Client Rep","CRM Health","Market Sector","Project Title","Job ID","Project Type","Service Type","Request Category","Category","Project Tag","Contract Value","Contract Limit","Gross Margin","Contract Type","Chance of Success","Status","Division","Department","Start Date","End Date","Proposal Due Date","Precon Start","Precon End","Construction Start","Est. Constr. Start","Est. Constr. End","Closeout Date"];
const ASSIGN = ["Project","Team Member","Start Date","End Date","Allocation %","Total Hours","Type","Billing Rate","Labor Rate","Cost Rate"];

function styleHeader(row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
    c.alignment = { vertical: "middle" };
  });
}
function addSheet(wb, name, headers, rows) {
  const ws = wb.addWorksheet(name);
  styleHeader(ws.addRow(headers));
  rows.forEach((r) => ws.addRow(headers.map((h) => r[h] ?? "")));
  headers.forEach((h, i) => { ws.getColumn(i + 1).width = Math.max(h.length + 4, 16); });
  return ws;
}

/* ============== FILE 1 — blanks on purpose ============== */
{
  const wb = new ExcelJS.Workbook();

  // Your Team: one fully-specified manager (so assignments resolve) + one row with
  // Division/Department/Role/Job Title/Start Date BLANK on purpose.
  addSheet(wb, "Your Team", TEAM, [
    { "Division": "Infrastructure", "Department": "Engineering", "Role": "Project Manager",
      "Job Title": "Project Manager", "Login Email": "manager@acme.com", "Full Name": "Pat Manager",
      "Access Level": "Manager", "Start Date": "2024-01-08", "Is Manager": "1" },
    // BLANK: Division, Department, Role, Job Title, Start Date, Is Manager  -> defaults should fill these
    { "Login Email": "newhire@acme.com", "Full Name": "Sam Newhire" },
  ]);

  // Clients & Projects: a Project with BLANK Type/Status/Project Type/Division/dates
  // (-> General type, Unassigned division, 3-month duration, Monday start, phases)
  // and an Opportunity with BLANK stage/Status (-> Pending Assignment).
  addSheet(wb, "Clients & Projects", CLIENTS, [
    { "Company Name": "Northwind Realty", "Project Title": "Riverside Office Fit-Out",
      "Market Sector": "Construction" },                       // Type/Status/dates/division all blank
    { "Type": "Opportunity", "Company Name": "Globex Corp",
      "Project Title": "Globex HQ Pursuit" },                  // stage/Status blank -> Pending Assignment
  ]);

  // Assignments: a person assigned with BLANK Allocation % and BLANK Total Hours
  // (-> allocation initializes at 0%).
  addSheet(wb, "Assignments", ASSIGN, [
    { "Project": "Riverside Office Fit-Out", "Team Member": "newhire@acme.com" }, // % + hours blank -> 0%
  ]);

  wb.xlsx.writeFile(path.join(OUT_DIR, "01_missing_data_blanks.xlsx"));
}

/* ============== FILE 2 — corrected (blanks now filled) ============== */
{
  const wb = new ExcelJS.Workbook();
  addSheet(wb, "Your Team", TEAM, [
    { "Division": "Infrastructure", "Department": "Engineering", "Role": "Project Manager",
      "Job Title": "Project Manager", "Login Email": "manager@acme.com", "Full Name": "Pat Manager",
      "Access Level": "Manager", "Start Date": "2024-01-08", "Is Manager": "1" },
    // SAME person, now WITH the real values -> assumed flags should clear (auto-replace)
    { "Division": "Buildings", "Department": "Design", "Role": "Senior Architect",
      "Job Title": "Senior Architect", "Login Email": "newhire@acme.com", "Full Name": "Sam Newhire",
      "Access Level": "User", "Manager": "manager@acme.com", "Start Date": "2026-05-01", "Is Manager": "0" },
  ]);
  addSheet(wb, "Clients & Projects", CLIENTS, [
    { "Type": "Project", "Company Name": "Northwind Realty", "Project Title": "Riverside Office Fit-Out",
      "Market Sector": "Construction", "Project Type": "Renovation", "Status": "Active",
      "Division": "Buildings", "Department": "Design",
      "Start Date": "2026-06-01", "End Date": "2027-02-28" },
    { "Type": "Opportunity", "Company Name": "Globex Corp", "Project Title": "Globex HQ Pursuit",
      "Status": "Proposal Development" },
  ]);
  addSheet(wb, "Assignments", ASSIGN, [
    { "Project": "Riverside Office Fit-Out", "Team Member": "newhire@acme.com",
      "Start Date": "2026-06-01", "End Date": "2027-02-28", "Allocation %": "75", "Total Hours": "1200",
      "Type": "Hard" },
  ]);
  wb.xlsx.writeFile(path.join(OUT_DIR, "02_missing_data_corrected.xlsx"));
}

console.log("wrote files to", OUT_DIR);
