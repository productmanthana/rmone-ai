import ExcelJS from "exceljs";

const wb = new ExcelJS.Workbook();
wb.creator = "RMOne";
wb.created = new Date();

const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6BA539" } };
const HEAD_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };

const ws = wb.addWorksheet("Project Team", { views: [{ state: "frozen", ySplit: 1 }] });

const cols = [
  { header: "Project", width: 38, hint: "Required. The project name (or its Job ID / ticket). Must match an existing project." },
  { header: "Team Member", width: 26, hint: "Required. Full name OR login email of the person to add to the project." },
  { header: "Business Unit", width: 20, hint: "Required. The BU / division this person works under on this project (e.g. Infrastructure)." },
  { header: "Role", width: 20, hint: "Required. Their billable role on this project (e.g. Senior Engineer)." },
  { header: "Job Title", width: 22, hint: "Required. Their job title (e.g. Lead Engineer)." },
  { header: "Allocation Start Date", width: 18, hint: "YYYY-MM-DD — when this person starts on the project." },
  { header: "Allocation End Date", width: 18, hint: "YYYY-MM-DD — when this person rolls off the project." },
  { header: "Allocation %", width: 13, hint: "0–100. How much of their time is on this project (100 = full-time)." },
  { header: "Total Hours", width: 12, hint: "Optional. Planned total hours for the whole assignment." },
  { header: "Type", width: 12, hint: "Hard (confirmed) or Soft (tentative)." },
];

ws.columns = cols.map((c) => ({ header: c.header, key: c.header, width: c.width }));
const headerRow = ws.getRow(1);
headerRow.height = 22;
headerRow.eachCell((cell, i) => {
  cell.fill = HEAD_FILL;
  cell.font = HEAD_FONT;
  cell.alignment = { vertical: "middle", horizontal: "left" };
  cell.note = cols[i - 1].hint;
});

const rows = [
  ["Harbor Health System - Phase 1 Delivery", "marcus.lee@harborhealth.com", "Infrastructure", "Senior Engineer", "Lead Engineer", "2026-08-01", "2026-12-01", 50, 350, "Hard"],
  ["Harbor Health System - Phase 1 Delivery", "priya.nair@harborhealth.com", "Infrastructure", "Engineer", "Project Engineer", "2026-08-01", "2026-12-01", 100, 700, "Hard"],
  ["Harbor Health System - Phase 1 Delivery", "david.kim@harborhealth.com", "Design", "Senior Designer", "Lead Architect", "2026-08-01", "2026-10-15", 25, 175, "Soft"],
  ["Harbor Health System - Phase 1 Delivery", "sara.lopez@harborhealth.com", "Design", "Designer", "Designer", "2026-09-01", "2026-12-01", 60, 420, "Soft"],
];
rows.forEach((r) => ws.addRow(r));
ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

const out = process.argv[2] || "RMOne_Project_Team_Upload.xlsx";
await wb.xlsx.writeFile(out);
console.log("Wrote", out);
