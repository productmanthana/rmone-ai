import ExcelJS from "exceljs";

const wb = new ExcelJS.Workbook();
wb.creator = "RMOne Auto-Onboarding";
wb.created = new Date();

const NAVY  = "FF1E3A5F";
const WHITE = "FFFFFFFF";
const HINT  = "FF888888";
const ALT   = "FFF0F4FA";

function build(tabName, cols, rows) {
  const ws = wb.addWorksheet(tabName);

  // Row 1 — hints
  ws.addRow(cols.map(c => c.hint));
  ws.lastRow.height = 16;
  ws.lastRow.eachCell(cell => {
    cell.font  = { italic: true, color: { argb: HINT }, size: 9 };
    cell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
    cell.alignment = { horizontal: "center" };
  });

  // Row 2 — headers
  ws.addRow(cols.map(c => c.header));
  ws.lastRow.height = 22;
  ws.lastRow.eachCell(cell => {
    cell.font      = { bold: true, color: { argb: WHITE }, size: 11 };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });

  // Data rows
  rows.forEach((r, i) => {
    ws.addRow(r);
    ws.lastRow.height = 18;
    ws.lastRow.eachCell({ includeEmpty: true }, cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 === 0 ? "FFFFFFFF" : ALT } };
      cell.font = { size: 10 };
      cell.alignment = { vertical: "middle" };
    });
  });

  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width ?? 20; });
}

// ── Tab 1: Your Team ──────────────────────────────────────────────────────────
build("Your Team", [
  { header: "Division",     hint: "★ Division / BU name",                       width: 22 },
  { header: "Department",   hint: "★ Department name",                           width: 24 },
  { header: "Role",         hint: "★ Billable role",                             width: 22 },
  { header: "Billing Rate", hint: "Hourly billing rate",                         width: 15 },
  { header: "Labor Rate",   hint: "Employee labor rate",                         width: 14 },
  { header: "Cost Rate",    hint: "Employee cost rate",                          width: 13 },
  { header: "Job Title",    hint: "Job title (linked to dept)",                  width: 24 },
  { header: "Username",     hint: "★ Login email",                               width: 28 },
  { header: "Full Name",    hint: "★ Display name",                              width: 22 },
  { header: "Email",        hint: "Email (defaults to Username)",                width: 28 },
  { header: "Password",     hint: "Initial password",                            width: 16 },
  { header: "Access Level", hint: "Admin / Manager / User",                      width: 14 },
  { header: "Manager",      hint: "Manager's Username (above them in this list)",width: 28 },
  { header: "Start Date",   hint: "YYYY-MM-DD",                                  width: 14 },
  { header: "Is Manager",   hint: "1 = yes, 0 = no",                            width: 12 },
], [
  ["Infrastructure", "Project Management", "Director",         200, 120, 145, "Senior PM",       "alice@acme.com",  "Alice Smith",  "alice@acme.com",  "Welcome@123", "Admin",   "",                "2022-01-10", 1],
  ["Infrastructure", "Project Management", "Project Manager",  150,  80,  95, "Project Manager", "bob@acme.com",    "Bob Jones",    "bob@acme.com",    "Welcome@123", "Manager", "alice@acme.com",  "2022-03-15", 1],
  ["Infrastructure", "Engineering",        "Senior Engineer",  180,  95, 115, "Lead Engineer",   "carol@acme.com",  "Carol White",  "carol@acme.com",  "Welcome@123", "User",    "bob@acme.com",    "2023-01-05", 0],
  ["Infrastructure", "Engineering",        "Junior Engineer",  120,  60,  72, "Engineer II",     "david@acme.com",  "David Brown",  "david@acme.com",  "Welcome@123", "User",    "carol@acme.com",  "2023-06-01", 0],
  ["Buildings",      "Project Management", "Business Analyst", 135,  70,  85, "BD Manager",      "eve@acme.com",    "Eve Davis",    "eve@acme.com",    "Welcome@123", "User",    "alice@acme.com",  "2022-08-20", 0],
  ["Corporate",      "Finance",            "Finance Manager",  145,  85, 100, "Financial Analyst","frank@acme.com", "Frank Miller", "frank@acme.com",  "Welcome@123", "User",    "alice@acme.com",  "2021-05-10", 1],
  ["Corporate",      "HR",                 "HR Specialist",    110,  55,  65, "HR Manager",      "grace@acme.com",  "Grace Wilson", "grace@acme.com",  "Welcome@123", "User",    "alice@acme.com",  "2020-11-01", 0],
]);

// ── Tab 2: Clients & Projects ─────────────────────────────────────────────────
build("Clients & Projects", [
  { header: "Type",           hint: "Project or Opportunity",                               width: 14 },
  { header: "Company Name",   hint: "★ Client company name",                               width: 30 },
  { header: "Contacts",       hint: "Contact person(s) — separate with ; (semicolon)",     width: 36 },
  { header: "Market Sector",  hint: "e.g. Transportation, Construction",                   width: 22 },
  { header: "Project Title",  hint: "★ Project or opportunity name",                       width: 34 },
  { header: "Job ID",         hint: "Internal ERP/job reference",                          width: 14 },
  { header: "Contract Value", hint: "Total value in dollars",                              width: 16 },
  { header: "Contract Type",  hint: "Fixed / T&M / Cost-Plus",                            width: 14 },
  { header: "Status",         hint: "Active / On Hold / Closed",                          width: 14 },
  { header: "Division",       hint: "Your internal division managing this",                width: 22 },
  { header: "Department",     hint: "Your internal department",                            width: 22 },
  { header: "Start Date",     hint: "YYYY-MM-DD",                                         width: 14 },
  { header: "End Date",       hint: "YYYY-MM-DD",                                         width: 14 },
], [
  // Projects
  ["Project",     "Metro Transit Authority", "John Metro; Sarah Metro", "Transportation", "Downtown Transit Expansion",    "ERP-1001", 4500000,  "T&M",       "Active", "Infrastructure", "Project Management", "2026-02-01", "2027-08-31"],
  ["Project",     "Skyline Developers",       "Sarah Skyline",           "Construction",  "Skyline Tower Phase 2",         "ERP-1002", 8200000,  "Fixed",     "Active", "Buildings",      "Project Management", "2026-03-15", "2028-12-31"],
  ["Project",     "Harbor Bridge Corp",       "Mike Harbor; Lisa Harbor","Infrastructure","Harbor Bridge Inspection",      "ERP-1003", 1200000,  "T&M",       "Active", "Infrastructure", "Engineering",        "2026-01-10", "2026-12-31"],
  ["Project",     "City School District",     "Tom School",              "Education",     "School Facility Assessment",    "ERP-1004",  350000,  "Cost-Plus", "Active", "Buildings",      "Project Management", "2026-04-01", "2026-10-31"],
  // Opportunities
  ["Opportunity", "Skyline Developers",       "Sarah Skyline",           "Construction",  "Waterfront Redevelopment Bid",  "OPP-2001", 12000000, "",          "Active", "Buildings",      "Project Management", "2026-09-01", "2029-06-30"],
  ["Opportunity", "Metro Transit Authority",  "John Metro",              "Transportation","Airport Terminal Expansion",    "OPP-2002",  6500000, "",          "Active", "Infrastructure", "Engineering",        "2026-12-01", "2028-12-31"],
]);

// ── Tab 3: Assignments ────────────────────────────────────────────────────────
build("Assignments", [
  { header: "Project",       hint: "★ Project title from Clients & Projects tab (or ticket ID)", width: 34 },
  { header: "Team Member",   hint: "★ Username (email) from Your Team tab",                      width: 28 },
  { header: "Start Date",    hint: "YYYY-MM-DD",                                                 width: 14 },
  { header: "End Date",      hint: "YYYY-MM-DD",                                                 width: 14 },
  { header: "Allocation %",  hint: "0–100 (100 = full-time)",                                    width: 14 },
  { header: "Billing Rate",  hint: "Override hourly rate (blank = use role rate)",               width: 16 },
  { header: "Type",          hint: "Hard (confirmed) or Soft (tentative)",                       width: 14 },
  { header: "Total Hours",   hint: "Planned hours for this assignment",                          width: 14 },
], [
  ["Downtown Transit Expansion",  "alice@acme.com",  "2026-02-01", "2027-08-31",  50,  "",  "Hard", 800 ],
  ["Downtown Transit Expansion",  "bob@acme.com",    "2026-02-01", "2027-08-31", 100,  "",  "Hard", 1600],
  ["Downtown Transit Expansion",  "carol@acme.com",  "2026-02-01", "2027-08-31", 100,  "",  "Hard", 1600],
  ["Downtown Transit Expansion",  "david@acme.com",  "2026-04-01", "2027-08-31", 100,  "",  "Hard", 1200],
  ["Skyline Tower Phase 2",       "bob@acme.com",    "2026-03-15", "2028-12-31",  50, 150,  "Hard", 2400],
  ["Skyline Tower Phase 2",       "carol@acme.com",  "2026-03-15", "2028-12-31", 100, 180,  "Hard", 4800],
  ["Harbor Bridge Inspection",    "carol@acme.com",  "2026-01-10", "2026-12-31",  50,  "",  "Hard",  800],
  ["Harbor Bridge Inspection",    "david@acme.com",  "2026-01-10", "2026-12-31", 100,  "",  "Hard", 1600],
  ["School Facility Assessment",  "eve@acme.com",    "2026-04-01", "2026-10-31", 100, 135,  "Hard",  640],
]);

// ── Save ───────────────────────────────────────────────────────────────────────
const out = "/home/runner/workspace/docs/RMOne_Simplified_Test_Data.xlsx";
await wb.xlsx.writeFile(out);
console.log("✅ Written:", out);
