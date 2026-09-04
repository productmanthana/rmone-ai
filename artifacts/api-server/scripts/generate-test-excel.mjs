import ExcelJS from "exceljs";
import { writeFileSync } from "fs";

const wb = new ExcelJS.Workbook();
wb.creator = "RMOne Auto-Onboarding";
wb.created = new Date();

// ── helpers ──────────────────────────────────────────────────────────────────
function addSheet(name, columns, rows) {
  const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: "FF1E3A5F" } } });

  // Header row — bold, dark blue bg, white text
  ws.addRow(columns.map(c => c.header));
  const hdr = ws.getRow(1);
  hdr.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
  });
  hdr.height = 22;

  // Hint row — italic, light grey
  ws.addRow(columns.map(c => c.hint ?? ""));
  const hint = ws.getRow(2);
  hint.eachCell(cell => {
    cell.font = { italic: true, color: { argb: "FF888888" }, size: 9 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
  });
  hint.height = 16;

  // Data rows
  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.eachCell(cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 === 0 ? "FFFFFFFF" : "FFF0F4FA" } };
      cell.font = { size: 10 };
      cell.alignment = { vertical: "middle" };
    });
    row.height = 18;
  });

  // Column widths
  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width ?? 20;
  });

  return ws;
}

// ── 1. DIVISIONS ─────────────────────────────────────────────────────────────
addSheet("Divisions", [
  { header: "Title",             hint: "★ Required — division/business unit name", width: 30 },
  { header: "CompanyIdLookup",   hint: "Optional — parent company DB ID",          width: 18 },
  { header: "DivisionIDLookup",  hint: "Optional — parent division DB ID",         width: 20 },
], [
  ["Infrastructure",  null, null],
  ["Buildings",       null, null],
  ["Transportation",  null, null],
  ["Corporate",       null, null],
]);

// ── 2. DEPARTMENTS ───────────────────────────────────────────────────────────
addSheet("Departments", [
  { header: "Title",              hint: "★ Required — department name",          width: 28 },
  { header: "Division",           hint: "Division name (must exist in Divisions tab)", width: 22 },
  { header: "DepartmentDivision", hint: "Optional — text label",                width: 22 },
  { header: "FunctionalName",     hint: "Optional — functional area name",      width: 22 },
  { header: "FunctionId",         hint: "Optional — numeric function ID",       width: 16 },
], [
  ["Project Management",  "Infrastructure",  "Infra-PM",   "PM Function",   null],
  ["Engineering",         "Infrastructure",  "Infra-Eng",  "Eng Function",  null],
  ["Finance",             "Corporate",       "Corp-Fin",   "Finance",       null],
  ["HR",                  "Corporate",       "Corp-HR",    "HR Function",   null],
  ["Business Development","Buildings",       "Bldg-BD",    "BD Function",   null],
]);

// ── 3. ROLES ─────────────────────────────────────────────────────────────────
addSheet("Roles", [
  { header: "Name",         hint: "★ Required — role/title name",        width: 28 },
  { header: "BillingRate",  hint: "Hourly billing rate (USD)",            width: 16 },
  { header: "EmpLaborRate", hint: "Employee labor rate (internal cost)",  width: 18 },
  { header: "EmpCostRate",  hint: "Employee cost rate (total cost)",      width: 18 },
], [
  ["Project Manager",     150, 80,  95 ],
  ["Senior Engineer",     180, 95,  115],
  ["Junior Engineer",     120, 60,  72 ],
  ["Business Analyst",    135, 70,  85 ],
  ["Finance Manager",     145, 85,  100],
  ["HR Specialist",       110, 55,  65 ],
  ["Director",            200, 120, 145],
]);

// ── 4. JOB TITLES ────────────────────────────────────────────────────────────
addSheet("Job Titles", [
  { header: "Title",            hint: "★ Required — job title name",         width: 30 },
  { header: "Department",       hint: "Department name (must exist in Departments tab)", width: 24 },
], [
  ["Senior Project Manager",   "Project Management"],
  ["Project Manager",          "Project Management"],
  ["Lead Engineer",            "Engineering"],
  ["Engineer II",              "Engineering"],
  ["Engineer I",               "Engineering"],
  ["Financial Analyst",        "Finance"],
  ["HR Manager",               "HR"],
  ["BD Manager",               "Business Development"],
]);

// ── 5. TEAM MEMBERS ──────────────────────────────────────────────────────────
addSheet("Team Members", [
  { header: "UserName",       hint: "★ Required — login email/username",            width: 28 },
  { header: "Name",           hint: "★ Required — full name",                       width: 24 },
  { header: "Email",          hint: "Email address (defaults to UserName if blank)", width: 28 },
  { header: "Password",       hint: "Initial password (hashed before storing)",     width: 20 },
  { header: "UserRole",       hint: "Admin / Manager / User",                       width: 16 },
  { header: "Role",           hint: "Role name (from Roles tab)",                   width: 24 },
  { header: "Department",     hint: "Department name (from Departments tab)",        width: 24 },
  { header: "Division",       hint: "Division name (from Divisions tab)",            width: 22 },
  { header: "JobTitle",       hint: "Job title (from Job Titles tab)",              width: 26 },
  { header: "Manager",        hint: "Manager's UserName (must appear above them)",  width: 28 },
  { header: "UGITStartDate",  hint: "Start date (YYYY-MM-DD)",                     width: 16 },
  { header: "UGITEndDate",    hint: "End date if applicable (YYYY-MM-DD)",          width: 16 },
  { header: "IsManager",      hint: "1 = is a manager, 0 = not",                   width: 14 },
  { header: "JobProfile",     hint: "Bio or profile text (optional)",               width: 24 },
], [
  ["alice.smith@acme.com",   "Alice Smith",   "alice.smith@acme.com",   "Welcome@123", "Admin",   "Director",          "Project Management", "Infrastructure",  "Senior Project Manager", null,                    "2022-01-10", null,         1, "Lead PM overseeing all projects"],
  ["bob.jones@acme.com",     "Bob Jones",     "bob.jones@acme.com",     "Welcome@123", "Manager", "Project Manager",   "Project Management", "Infrastructure",  "Project Manager",        "alice.smith@acme.com",  "2022-03-15", null,         1, "PM for Infrastructure projects"],
  ["carol.white@acme.com",   "Carol White",   "carol.white@acme.com",   "Welcome@123", "User",    "Senior Engineer",   "Engineering",        "Infrastructure",  "Lead Engineer",           "bob.jones@acme.com",    "2023-01-05", null,         0, null],
  ["david.brown@acme.com",   "David Brown",   "david.brown@acme.com",   "Welcome@123", "User",    "Junior Engineer",   "Engineering",        "Infrastructure",  "Engineer II",             "carol.white@acme.com",  "2023-06-01", null,         0, null],
  ["eve.davis@acme.com",     "Eve Davis",     "eve.davis@acme.com",     "Welcome@123", "User",    "Business Analyst",  "Project Management", "Buildings",       "BD Manager",              "alice.smith@acme.com",  "2022-08-20", null,         0, null],
  ["frank.miller@acme.com",  "Frank Miller",  "frank.miller@acme.com",  "Welcome@123", "User",    "Finance Manager",   "Finance",            "Corporate",       "Financial Analyst",       "alice.smith@acme.com",  "2021-05-10", null,         1, null],
  ["grace.wilson@acme.com",  "Grace Wilson",  "grace.wilson@acme.com",  "Welcome@123", "User",    "HR Specialist",     "HR",                 "Corporate",       "HR Manager",              "alice.smith@acme.com",  "2020-11-01", null,         0, null],
]);

// ── 6. CLIENT COMPANIES ──────────────────────────────────────────────────────
addSheet("Client Companies", [
  { header: "Title",                    hint: "★ Required — company name",            width: 30 },
  { header: "ClientRep",                hint: "Internal client rep name",             width: 22 },
  { header: "ClientMarketSector",       hint: "Market sector (e.g. Construction)",    width: 24 },
  { header: "CRMHealth",                hint: "Green / Yellow / Red",                 width: 14 },
  { header: "Division",                 hint: "Our division that manages this client",width: 22 },
  { header: "ClientRepDivisionLookup",  hint: "Optional — rep's division DB ID",      width: 24 },
], [
  ["Metro Transit Authority",   "Alice Smith",  "Transportation",  "Green",  "Transportation", null],
  ["Skyline Developers",        "Bob Jones",    "Construction",    "Green",  "Buildings",      null],
  ["Harbor Bridge Corp",        "Bob Jones",    "Infrastructure",  "Yellow", "Infrastructure", null],
  ["City School District",      "Eve Davis",    "Education",       "Green",  "Buildings",      null],
]);

// ── 7. CLIENT CONTACTS ───────────────────────────────────────────────────────
addSheet("Client Contacts", [
  { header: "PointOfContact",    hint: "★ Required — contact person's name",      width: 28 },
  { header: "Company",           hint: "Company name (from Client Companies tab)", width: 30 },
], [
  ["John Metro",       "Metro Transit Authority"],
  ["Sarah Skyline",    "Skyline Developers"],
  ["Mike Harbor",      "Harbor Bridge Corp"],
  ["Lisa Harbor",      "Harbor Bridge Corp"],
  ["Tom School",       "City School District"],
]);

// ── 8. PROJECTS ──────────────────────────────────────────────────────────────
addSheet("Projects", [
  { header: "Title",                hint: "★ Required — project name",                  width: 34 },
  { header: "ERPJobID",             hint: "ERP / external job ID",                      width: 16 },
  { header: "ContractValue",        hint: "Total contract value (USD)",                 width: 18 },
  { header: "ApproxContractValue",  hint: "Approximate value if not yet finalized",     width: 22 },
  { header: "ContractLimit",        hint: "Not-to-exceed limit",                        width: 16 },
  { header: "ContractType",         hint: "Fixed / T&M / Cost-Plus",                   width: 16 },
  { header: "StatusChoice",         hint: "Active / On Hold / Closed",                 width: 14 },
  { header: "SectorChoice",         hint: "Market sector",                              width: 18 },
  { header: "ChanceOfSuccessChoice",hint: "High / Medium / Low",                       width: 22 },
  { header: "Division",             hint: "Division name (from Divisions tab)",         width: 22 },
  { header: "Department",           hint: "Department name (from Departments tab)",     width: 24 },
  { header: "Company",              hint: "Client company (from Client Companies tab)", width: 30 },
  { header: "CRMContactLookup",     hint: "Contact name or ID",                        width: 20 },
  { header: "TargetStartDate",      hint: "YYYY-MM-DD",                                width: 16 },
  { header: "TargetCompletionDate", hint: "YYYY-MM-DD",                                width: 22 },
], [
  ["Downtown Transit Expansion",     "ERP-1001", 4500000, 4000000, 5000000, "T&M",        "Active",   "Transportation", "High",   "Transportation", "Project Management", "Metro Transit Authority", "John Metro",   "2026-02-01", "2027-08-31"],
  ["Skyline Tower Phase 2",          "ERP-1002", 8200000, 7500000, 9000000, "Fixed",       "Active",   "Construction",   "High",   "Buildings",      "Engineering",        "Skyline Developers",      "Sarah Skyline","2026-03-15", "2028-12-31"],
  ["Harbor Bridge Inspection",       "ERP-1003", 1200000, 1000000, 1500000, "T&M",        "Active",   "Infrastructure", "Medium", "Infrastructure", "Engineering",        "Harbor Bridge Corp",       "Mike Harbor",  "2026-01-10", "2026-12-31"],
  ["School Facility Assessment",     "ERP-1004",  350000,  300000,  400000, "Cost-Plus",  "Active",   "Education",      "High",   "Buildings",      "Project Management", "City School District",    "Tom School",   "2026-04-01", "2026-10-31"],
]);

// ── 9. OPPORTUNITIES ─────────────────────────────────────────────────────────
addSheet("Opportunities", [
  { header: "Title",                hint: "★ Required — opportunity name",             width: 34 },
  { header: "ERPJobID",             hint: "ERP / external reference ID",               width: 16 },
  { header: "ContractValue",        hint: "Estimated contract value (USD)",            width: 18 },
  { header: "StatusChoice",         hint: "Active / Proposal / Closed",               width: 14 },
  { header: "Division",             hint: "Division name (from Divisions tab)",        width: 22 },
  { header: "Department",           hint: "Department name",                           width: 24 },
  { header: "Company",              hint: "Client company (from Client Companies tab)",width: 30 },
  { header: "TargetStartDate",      hint: "YYYY-MM-DD",                               width: 16 },
  { header: "TargetCompletionDate", hint: "YYYY-MM-DD",                               width: 22 },
], [
  ["Waterfront Redevelopment Bid",   "OPP-2001", 12000000, "Active",   "Buildings",      "Business Development", "Skyline Developers",       "2026-09-01", "2029-06-30"],
  ["Airport Terminal Expansion",     "OPP-2002",  6500000, "Proposal", "Transportation", "Business Development", "Metro Transit Authority",  "2026-12-01", "2028-12-31"],
  ["Bridge Rehabilitation RFP",      "OPP-2003",  2800000, "Active",   "Infrastructure", "Engineering",          "Harbor Bridge Corp",       "2026-07-01", "2027-07-01"],
]);

// ── 10. RESOURCE ASSIGNMENTS ─────────────────────────────────────────────────
addSheet("Resource Assignments", [
  { header: "TicketId",            hint: "★ Required — project ticket ID (from Projects tab or auto-generated)", width: 20 },
  { header: "Resource",            hint: "★ Required — team member email/username",     width: 28 },
  { header: "AllocationStartDate", hint: "YYYY-MM-DD",                                  width: 22 },
  { header: "AllocationEndDate",   hint: "YYYY-MM-DD",                                  width: 20 },
  { header: "PctAllocation",       hint: "Percentage (0-100, default 100)",              width: 16 },
  { header: "BillingRate",         hint: "Hourly billing rate override",                 width: 16 },
  { header: "EmpLaborRate",        hint: "Employee labor rate",                          width: 16 },
  { header: "EmpCostRate",         hint: "Employee cost rate",                           width: 14 },
  { header: "AllocationHour",      hint: "Total planned hours",                          width: 16 },
  { header: "BilledHours",         hint: "Hours already billed",                         width: 14 },
  { header: "AllocationType",      hint: "Hard / Soft (default: Hard)",                  width: 16 },
  { header: "SoftAllocation",      hint: "1 = soft booking, 0 = hard",                  width: 16 },
  { header: "ActualStartDate",     hint: "Actual start if different from plan",          width: 18 },
  { header: "ActualEndDate",       hint: "Actual end if different from plan",            width: 16 },
], [
  // Note: TicketIds are auto-generated as PMM-26-000001 etc. in order of insertion
  // For testing, use the actual ticket IDs after first import, or leave blank to use sequence
  ["PMM-26-000001", "alice.smith@acme.com",  "2026-02-01", "2027-08-31", 50,  150, 80,  95,  800,  0, "Hard", 0, null, null],
  ["PMM-26-000001", "bob.jones@acme.com",    "2026-02-01", "2027-08-31", 100, 150, 80,  95,  1600, 0, "Hard", 0, null, null],
  ["PMM-26-000001", "carol.white@acme.com",  "2026-02-01", "2027-08-31", 100, 180, 95,  115, 1600, 0, "Hard", 0, null, null],
  ["PMM-26-000001", "david.brown@acme.com",  "2026-04-01", "2027-08-31", 100, 120, 60,  72,  1200, 0, "Hard", 0, null, null],
  ["PMM-26-000002", "bob.jones@acme.com",    "2026-03-15", "2028-12-31", 50,  150, 80,  95,  2400, 0, "Hard", 0, null, null],
  ["PMM-26-000002", "carol.white@acme.com",  "2026-03-15", "2028-12-31", 100, 180, 95,  115, 4800, 0, "Hard", 0, null, null],
  ["PMM-26-000003", "carol.white@acme.com",  "2026-01-10", "2026-12-31", 50,  180, 95,  115, 800,  0, "Hard", 0, null, null],
  ["PMM-26-000003", "david.brown@acme.com",  "2026-01-10", "2026-12-31", 100, 120, 60,  72,  1600, 0, "Hard", 0, null, null],
  ["PMM-26-000004", "eve.davis@acme.com",    "2026-04-01", "2026-10-31", 100, 135, 70,  85,  640,  0, "Hard", 0, null, null],
]);

// ── 11. INSTRUCTIONS ─────────────────────────────────────────────────────────
const ws = wb.addWorksheet("📋 Instructions", { properties: { tabColor: { argb: "FF2E7D32" } } });
const instructions = [
  ["RMOne Auto-Onboarding — Excel Import Guide"],
  [""],
  ["HOW TO USE THIS FILE"],
  ["1. Fill in each tab with your client data"],
  ["2. Tabs must be filled in ORDER (Divisions → Departments → … → Resource Assignments)"],
  ["3. Columns marked ★ Required must have a value — others are optional"],
  ["4. Name references (Division, Department, Company etc.) must exactly match the names in the earlier tab"],
  ["5. Dates must be in YYYY-MM-DD format"],
  ["6. Resource Assignments use the auto-generated ticket IDs (PMM-26-000001, OPM-26-000001 etc.)"],
  ["   You can leave TicketId blank ONLY if there is exactly one project, otherwise specify the ID"],
  [""],
  ["TAB ORDER & PURPOSE"],
  ["Tab",              "DB Table",                 "Key Columns"],
  ["Divisions",        "CompanyDivisions",          "Title"],
  ["Departments",      "Department",                "Title, Division"],
  ["Roles",            "Roles",                     "Name, BillingRate, EmpLaborRate, EmpCostRate"],
  ["Job Titles",       "Jobtitle",                  "Title, Department"],
  ["Team Members",     "AspNetUsers",               "UserName, Name, Password, Role, Department"],
  ["Client Companies", "CRMCompany",                "Title"],
  ["Client Contacts",  "CRMContact",                "PointOfContact, Company"],
  ["Projects",         "PMM",                       "Title, ContractValue, StatusChoice"],
  ["Opportunities",    "Opportunity",               "Title, ContractValue, StatusChoice"],
  ["Resource Assignments","ResourceAllocation",     "TicketId, Resource, AllocationStartDate"],
  [""],
  ["AUTO-GENERATED — DO NOT ADD THESE COLUMNS"],
  ["TenantID — stamped from the company name you enter at import"],
  ["ID — auto-incremented by SQL Server"],
  ["PasswordHash — hashed from your Password column"],
  ["TicketId — auto-generated as PMM-26-000001, OPM-26-000001 etc."],
  ["Created / Modified — SQL Server default timestamps"],
];
instructions.forEach((r, i) => {
  const row = ws.addRow(r);
  if (i === 0) {
    row.getCell(1).font = { bold: true, size: 14, color: { argb: "FF1E3A5F" } };
  } else if (["HOW TO USE THIS FILE","TAB ORDER & PURPOSE","AUTO-GENERATED — DO NOT ADD THESE COLUMNS"].includes(r[0])) {
    row.getCell(1).font = { bold: true, size: 11, color: { argb: "FF2E7D32" } };
  } else if (r[0] === "Tab") {
    r.forEach((_, ci) => {
      const cell = row.getCell(ci + 1);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    });
  }
});
ws.getColumn(1).width = 28;
ws.getColumn(2).width = 28;
ws.getColumn(3).width = 50;

// ── Save ─────────────────────────────────────────────────────────────────────
const outPath = "/home/runner/workspace/docs/RMOne_Onboarding_Test_Data.xlsx";
await wb.xlsx.writeFile(outPath);
console.log("✅  Excel file written to:", outPath);
