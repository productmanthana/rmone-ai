const ExcelJS = require('/home/runner/workspace/artifacts/rmone-web/node_modules/exceljs/excel.js');

const wb = new ExcelJS.Workbook();
wb.creator = "RM ONE";
wb.created = new Date();

const HEADER_FILL = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF4F46E5" } };
const ALT_FILL    = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFEEF0FF" } };
const WHITE = { argb:"FFFFFFFF" };

function styleHeader(row) {
  row.height = 22;
  row.eachCell(cell => {
    cell.font      = { bold:true, color:WHITE, size:10, name:"Calibri" };
    cell.fill      = HEADER_FILL;
    cell.border    = { bottom:{ style:"thin", color:{ argb:"FF3730A3" } } };
    cell.alignment = { vertical:"middle", horizontal:"left" };
  });
}
function styleData(row, idx) {
  if (idx % 2 === 1) {
    row.eachCell({ includeEmpty:true }, cell => {
      cell.fill = ALT_FILL;
      cell.font = { size:10, name:"Calibri" };
      cell.alignment = { vertical:"middle", horizontal:"left" };
    });
  } else {
    row.eachCell({ includeEmpty:true }, cell => {
      cell.font = { size:10, name:"Calibri" };
      cell.alignment = { vertical:"middle", horizontal:"left" };
    });
  }
}

// ── 5 opportunity rows ────────────────────────────────────────────────────
const oppRows = [
  ["Harbor District Mixed-Use Development",  "Construction Projects (CPR)", "Harbor Realty Group",         "Mike Torres",   "",            "Proposal",    60,  "Real Estate",  "Buildings",         "Commercial",     "Development", "2025-08-15", "2025-09-01", "2025-09-20", "2026-01-01", "2027-06-30", "", 31500000, 22000000,  9500000,  850000, 30, "GMP",       "James Okafor",    "Active", "San Diego",      "Mixed-use tower: retail podium, 200 residential units, structured parking, rooftop amenity.", ""],
  ["Regional Airport Concourse Expansion",   "Construction Projects (CPR)", "Metro Airport Authority",     "Lisa Park",     "",            "Negotiation", 80,  "Aviation",     "Civil & Transit",   "Infrastructure", "Airside",     "2025-07-01", "2025-07-20", "2025-08-10", "2025-10-01", "2027-03-31", "", 67000000, 50000000, 24000000, 1750000, 25, "Cost-Plus", "Priya Sharma",    "Active", "San Francisco",  "Expansion of Concourse D with 12 new gate hold rooms, consolidated security, and retail.",       "FAA coordination required."],
  ["University Science Complex",             "Service Projects (CNS)",      "State University Foundation", "Dr. Maria Lee", "",            "Proposal",    55,  "Education",    "Buildings",         "Education",      "Higher Ed",   "2025-10-31", "2025-11-15", "2025-12-01", "2026-06-01", "2028-12-31", "", 52000000, 38000000, 15000000, 1200000, 27, "Fixed",     "Elena Rodriguez", "Active", "San Francisco",  "New 4-building science complex: wet labs, imaging suite, vivarium, 200-seat lecture hall.",     "BSL-2 containment required."],
  ["Riverside Data Center Campus",           "Construction Projects (CPR)", "CloudCore Inc.",              "Alan Brent",    "CPR-DC-001",  "Prospecting", 35,  "Technology",   "Civil & Transit",   "Infrastructure", "MEP",         "2026-01-15", "",           "2026-02-01", "2026-09-01", "2028-06-30", "", 89000000, 65000000, 28000000, 2500000, 28, "GMP",       "Tom Williams",    "Active", "Phoenix",        "Two-phase hyperscale data center: 40 MW Phase 1 shell and core, Phase 2 shell only.",           "Fast-track preferred."],
  ["Downtown Medical Office Tower",          "Service Projects (CNS)",      "HealthFirst Properties",      "Karen Novak",   "CNS-MOB-007", "Qualifying",  45,  "Healthcare",   "Healthcare Studio", "Healthcare",     "Medical",     "2025-11-30", "2025-12-10", "2026-01-15", "2026-08-01", "2028-03-31", "", 44500000, 33000000, 13500000,  990000, 26, "Fixed",     "Sarah Mitchell",  "Active", "Los Angeles",    "18-story medical office tower with imaging floor, ambulatory surgery center, below-grade parking.", ""],
];

const ws1 = wb.addWorksheet("Opportunities", { views:[{ state:"frozen", ySplit:1 }] });
ws1.columns = [
  { header:"Opportunity Title",        width:38 }, { header:"Project Category",         width:28 },
  { header:"Company Name",             width:28 }, { header:"Contact Name",             width:20 },
  { header:"ERP Job ID",               width:16 }, { header:"Stage",                    width:16 },
  { header:"Chance of Success (%)",    width:20 }, { header:"Market Sector",            width:20 },
  { header:"Business Unit",            width:22 }, { header:"Division",                 width:22 },
  { header:"Department",               width:18 }, { header:"Bid Due Date",             width:14 },
  { header:"Interview Date",           width:14 }, { header:"Proposal Phase Due",       width:18 },
  { header:"Forecast Start",           width:14 }, { header:"Forecast End",             width:14 },
  { header:"Award / Loss Date",        width:16 }, { header:"Approx Contract Value",    width:22 },
  { header:"Forecasted Project Cost",  width:22 }, { header:"Labor Contract Amount",    width:22 },
  { header:"Non-Operating Cost",       width:20 }, { header:"Gross Margin (%)",         width:16 },
  { header:"Contract Type",            width:14 }, { header:"Point of Contact",         width:20 },
  { header:"Status",                   width:12 }, { header:"Office",                   width:16 },
  { header:"Description",              width:50 }, { header:"Notes",                    width:30 },
];
styleHeader(ws1.getRow(1));
oppRows.forEach((r, i) => { const row = ws1.addRow(r); styleData(row, i); });

// data validations for Opp sheet
for (let r = 2; r <= 6; r++) {
  ws1.getCell(`B${r}`).dataValidation = { type:"list", allowBlank:true, formulae:['"Service Projects (CNS),Construction Projects (CPR)"'], showErrorMessage:true, error:"Select from list.", errorTitle:"Invalid value" };
  ws1.getCell(`F${r}`).dataValidation = { type:"list", allowBlank:true, formulae:['"Prospecting,Qualifying,Proposal,Negotiation,Awarded,Lost"'], showErrorMessage:true };
  ws1.getCell(`W${r}`).dataValidation = { type:"list", allowBlank:true, formulae:['"Fixed,T&M,GMP,Cost-Plus"'], showErrorMessage:true };
  ws1.getCell(`Z${r}`).dataValidation = { type:"list", allowBlank:true, formulae:['"Active,On Hold,Closed"'], showErrorMessage:true };
}

// ── Team Assignments ──────────────────────────────────────────────────────
const asgRows = [
  ["Harbor District Mixed-Use Development",  "James Okafor",    "james.okafor@rmone.com",    "2026-01-01", "2027-06-30", 3120, "Soft", "Senior Architect",    "Lead Architect", "Buildings",         "Commercial",     "Design",     185, 35, "Manager"],
  ["Regional Airport Concourse Expansion",   "Priya Sharma",    "priya.sharma@rmone.com",    "2025-10-01", "2027-03-31", 3900, "Soft", "Structural Engineer", "Engineer II",    "Civil & Transit",   "Infrastructure", "Structural", 155, 50, "Manager"],
  ["University Science Complex",             "Elena Rodriguez", "elena.rodriguez@rmone.com", "2026-06-01", "2028-12-31", 4400, "Soft", "Principal",           "Principal",      "Buildings",         "Education",      "Design",     225, 40, "Manager"],
  ["Riverside Data Center Campus",           "Tom Williams",    "tom.williams@rmone.com",    "2026-09-01", "2028-06-30", 2800, "Soft", "Project Manager",     "PM",             "Civil & Transit",   "Infrastructure", "MEP",        200, 60, "Admin"],
  ["Downtown Medical Office Tower",          "Sarah Mitchell",  "sarah.mitchell@rmone.com",  "2026-08-01", "2028-03-31", 3200, "Soft", "Project Manager",     "Senior PM",      "Healthcare Studio", "Healthcare",     "Medical",    200, 45, "Admin"],
];

const ws2 = wb.addWorksheet("Team Assignments", { views:[{ state:"frozen", ySplit:1 }] });
ws2.columns = [
  { header:"Opportunity Title",  width:38 }, { header:"Team Member Name",  width:22 },
  { header:"Email",              width:32 }, { header:"Start Date",        width:14 },
  { header:"End Date",           width:14 }, { header:"Total Hours",       width:14 },
  { header:"Assignment Type",    width:16 }, { header:"Role",              width:26 },
  { header:"Job Title",          width:24 }, { header:"Business Unit",     width:22 },
  { header:"Division",           width:22 }, { header:"Department",        width:18 },
  { header:"Billing Rate",       width:14 }, { header:"Allocation %",      width:14 },
  { header:"Access Level",       width:14 },
];
styleHeader(ws2.getRow(1));
asgRows.forEach((r, i) => { const row = ws2.addRow(r); styleData(row, i); });
for (let r = 2; r <= 6; r++) {
  ws2.getCell(`G${r}`).dataValidation = { type:"list", allowBlank:true, formulae:['"Hard,Soft"'], showErrorMessage:true };
  ws2.getCell(`O${r}`).dataValidation = { type:"list", allowBlank:true, formulae:['"Admin,Manager,User"'], showErrorMessage:true };
}

// ── Schedule ──────────────────────────────────────────────────────────────
const schRows = [
  ["Harbor District Mixed-Use Development",  "Schematic Design",          1, "2026-01-01", "2026-06-30", 180, "Yes", 0,  "Subject to contract award; coastal entitlement required"],
  ["Regional Airport Concourse Expansion",   "Design Development",         1, "2025-10-01", "2026-06-30", 273, "Yes", 0,  "FAA Part 77 airspace review concurrent with DD"],
  ["University Science Complex",             "Pre-Design & Programming",   1, "2026-06-01", "2026-12-31", 213, "Yes", 0,  "Lab programming with department heads; BSL-2 containment required"],
  ["Riverside Data Center Campus",           "Site Assessment & Concept",  1, "2026-09-01", "2027-03-31", 212, "Yes", 0,  "Utility capacity study and grid interconnect assessment"],
  ["Downtown Medical Office Tower",          "Concept Design",             1, "2026-08-01", "2027-01-31", 183, "Yes", 0,  "Certificate of Need filing with state health dept by Oct 2026"],
];

const ws3 = wb.addWorksheet("Schedule", { views:[{ state:"frozen", ySplit:1 }] });
ws3.columns = [
  { header:"Opportunity Title", width:38 }, { header:"Phase Name",       width:30 },
  { header:"Phase Order",       width:14 }, { header:"Start Date",       width:14 },
  { header:"End Date",          width:14 }, { header:"Duration (days)",  width:16 },
  { header:"Milestone",         width:12 }, { header:"% Complete",       width:14 },
  { header:"Notes",             width:50 },
];
styleHeader(ws3.getRow(1));
schRows.forEach((r, i) => { const row = ws3.addRow(r); styleData(row, i); });
for (let r = 2; r <= 6; r++) {
  ws3.getCell(`G${r}`).dataValidation = { type:"list", allowBlank:true, formulae:['"Yes,No"'], showErrorMessage:true };
}

const outPath = "/home/runner/workspace/artifacts/rmone-web/public/opportunities_sample.xlsx";
wb.xlsx.writeFile(outPath).then(() => console.log("Written:", outPath)).catch(e => console.error(e));
