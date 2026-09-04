import ExcelJS from "exceljs";

const wb = new ExcelJS.Workbook();
wb.creator = "RMOne Onboarding";
wb.created = new Date();

const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6BA539" } };
const HEAD_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };

function addSheet(name, columns, rows, hints) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.header, width: c.width }));
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell, col) => {
    cell.fill = HEAD_FILL;
    cell.font = HEAD_FONT;
    cell.alignment = { vertical: "middle", horizontal: "left" };
    const hint = hints?.[columns[col - 1].header];
    if (hint) cell.note = hint;
  });
  headerRow.height = 22;
  rows.forEach((r) => ws.addRow(r));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
}

// ---------------- Tab 1: Your Team ----------------
const teamCols = [
  { header: "Division", width: 22 },
  { header: "Department", width: 22 },
  { header: "Role", width: 22 },
  { header: "Billing Rate", width: 14 },
  { header: "Labor Rate", width: 13 },
  { header: "Cost Rate", width: 12 },
  { header: "Job Title", width: 22 },
  { header: "Job Profile", width: 26 },
  { header: "Login Email", width: 28 },
  { header: "Full Name", width: 22 },
  { header: "Email", width: 28 },
  { header: "Password", width: 16 },
  { header: "Access Level", width: 13 },
  { header: "Manager", width: 28 },
  { header: "Start Date", width: 13 },
  { header: "End Date", width: 13 },
  { header: "Is Manager", width: 11 },
];
const teamHints = {
  Division: "Required. Your company business unit / division.",
  Department: "Required. Department within the division.",
  Role: "Required. Billable role.",
  "Login Email": "Required. Used as the login + referenced from the Assignments tab.",
  "Full Name": "Required. Display name.",
  Manager: "This person's manager — must be a Login Email that appears ABOVE them in this list.",
  "Access Level": "Admin / Manager / User",
  "Is Manager": "1 = yes, 0 = no",
  "Start Date": "YYYY-MM-DD",
  "End Date": "YYYY-MM-DD (blank = permanent staff)",
};
const team = [
  ["Infrastructure", "Engineering", "Director", 320, 180, 240, "Engineering Director", "Leads the infrastructure engineering group", "olivia.bennett@harborhealth.com", "Olivia Bennett", "olivia.bennett@harborhealth.com", "Welcome@123", "Admin", "", "2024-01-15", "", 1],
  ["Infrastructure", "Engineering", "Senior Engineer", 220, 120, 165, "Lead Engineer", "Senior structural lead", "marcus.lee@harborhealth.com", "Marcus Lee", "marcus.lee@harborhealth.com", "Welcome@123", "Manager", "olivia.bennett@harborhealth.com", "2024-02-01", "", 1],
  ["Infrastructure", "Engineering", "Engineer", 165, 95, 130, "Project Engineer", "Civil project engineer", "priya.nair@harborhealth.com", "Priya Nair", "priya.nair@harborhealth.com", "Welcome@123", "User", "marcus.lee@harborhealth.com", "2024-03-10", "", 0],
  ["Design", "Architecture", "Senior Designer", 210, 115, 160, "Lead Architect", "Healthcare facility design lead", "david.kim@harborhealth.com", "David Kim", "david.kim@harborhealth.com", "Welcome@123", "Manager", "olivia.bennett@harborhealth.com", "2024-01-20", "", 1],
  ["Design", "Architecture", "Designer", 150, 85, 120, "Designer", "Interior + space planning", "sara.lopez@harborhealth.com", "Sara Lopez", "sara.lopez@harborhealth.com", "Welcome@123", "User", "david.kim@harborhealth.com", "2024-04-05", "", 0],
  ["Project Management", "Delivery", "Project Manager", 240, 130, 180, "Senior PM", "Runs health-system delivery", "james.carter@harborhealth.com", "James Carter", "james.carter@harborhealth.com", "Welcome@123", "Manager", "olivia.bennett@harborhealth.com", "2024-02-12", "", 1],
];

// ---------------- Tab 2: Clients & Projects ----------------
const clientCols = [
  { header: "Type", width: 13 },
  { header: "Company Name", width: 30 },
  { header: "Contacts", width: 30 },
  { header: "Client Rep", width: 20 },
  { header: "CRM Health", width: 13 },
  { header: "Market Sector", width: 20 },
  { header: "Project Title", width: 34 },
  { header: "Job ID", width: 14 },
  { header: "Project Type", width: 18 },
  { header: "Service Type", width: 18 },
  { header: "Contract Value", width: 16 },
  { header: "Contract Type", width: 14 },
  { header: "Chance of Success", width: 18 },
  { header: "Status", width: 12 },
  { header: "Division", width: 20 },
  { header: "Department", width: 20 },
  { header: "Start Date", width: 13 },
  { header: "End Date", width: 13 },
];
const clientHints = {
  Type: "Project or Opportunity",
  "Company Name": "Required. Client company name.",
  "Project Title": "Required. This exact title is referenced from the Assignments tab.",
  "Chance of Success": "Win % for Opportunities only — leave blank for Projects.",
  Status: "Active / On Hold / Closed",
  "Start Date": "YYYY-MM-DD",
  "End Date": "YYYY-MM-DD",
};
const clients = [
  ["Project", "Harbor Health System", "Dr. Alan Pierce; Megan Ruiz", "James Carter", "Good", "Healthcare", "Harbor Health System - Phase 1 Delivery", "HH-1001", "Construction", "Engineering", 4200000, "GMP", "", "Active", "Infrastructure", "Engineering", "2026-02-01", "2027-02-28"],
  ["Project", "Harbor Health System", "Dr. Alan Pierce", "James Carter", "Good", "Healthcare", "Harbor Health - Imaging Wing Fit-out", "HH-1002", "Renovation", "Architecture", 1350000, "Fixed", "", "Active", "Design", "Architecture", "2026-04-01", "2026-12-15"],
  ["Opportunity", "Riverside Medical Group", "Karen White", "James Carter", "Fair", "Healthcare", "Riverside Outpatient Clinic - Design Build", "RV-2001", "Design", "Architecture", 2750000, "T&M", 65, "Active", "Design", "Architecture", "2026-06-01", "2027-05-30"],
];

// ---------------- Tab 3: Assignments ----------------
const assignCols = [
  { header: "Project", width: 36 },
  { header: "Team Member", width: 30 },
  { header: "Start Date", width: 13 },
  { header: "End Date", width: 13 },
  { header: "Allocation %", width: 13 },
  { header: "Total Hours", width: 13 },
  { header: "Type", width: 12 },
  { header: "Billing Rate", width: 14 },
];
const assignHints = {
  Project: "Required. Must match a Project Title from the Clients & Projects tab (or a known ticket ID).",
  "Team Member": "Required. Must match a Login Email from the Your Team tab.",
  "Allocation %": "0–100 (100 = full-time).",
  "Total Hours": "Planned total hours for this assignment.",
  Type: "Hard (confirmed) or Soft (tentative).",
  "Billing Rate": "Optional override — leave blank to use the role default.",
};
const assignments = [
  ["Harbor Health System - Phase 1 Delivery", "marcus.lee@harborhealth.com", "2026-02-01", "2027-02-28", 50, 1040, "Hard", ""],
  ["Harbor Health System - Phase 1 Delivery", "priya.nair@harborhealth.com", "2026-02-01", "2026-12-31", 100, 1760, "Hard", ""],
  ["Harbor Health System - Phase 1 Delivery", "james.carter@harborhealth.com", "2026-02-01", "2027-02-28", 25, 520, "Hard", ""],
  ["Harbor Health - Imaging Wing Fit-out", "david.kim@harborhealth.com", "2026-04-01", "2026-12-15", 40, 600, "Hard", ""],
  ["Harbor Health - Imaging Wing Fit-out", "sara.lopez@harborhealth.com", "2026-04-01", "2026-12-15", 60, 900, "Soft", ""],
  ["Riverside Outpatient Clinic - Design Build", "david.kim@harborhealth.com", "2026-06-01", "2027-05-30", 20, 400, "Soft", ""],
];

addSheet("Your Team", teamCols, team, teamHints);
addSheet("Clients & Projects", clientCols, clients, clientHints);
addSheet("Assignments", assignCols, assignments, assignHints);

const out = process.argv[2] || "RMOne_Onboarding_Sample.xlsx";
await wb.xlsx.writeFile(out);
console.log("Wrote", out);
