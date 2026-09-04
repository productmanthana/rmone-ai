/* Standard-format test file for the "first name from last name" fallback (#6).
   The fallback fires only when a row has a Last Name but NO First Name and NO
   Full Name. Uses canonical headers so the row survives into expandTeamSheet. */
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");

const OUT_DIR = path.resolve(__dirname, "../../../attached_assets/missing-data-tests");
fs.mkdirSync(OUT_DIR, { recursive: true });

const HEADERS = ["FirstName", "LastName", "Email", "Division", "Department", "JobTitle", "Role", "UserRole", "IsManager"];

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Your Team");
const hdr = ws.addRow(HEADERS);
hdr.eachCell((c) => {
  c.font = { bold: true, color: { argb: "FFFFFFFF" } };
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
});

const rows = [
  // A normal, fully-specified manager so the sheet is a valid team import.
  { FirstName: "Pat", LastName: "Lee", Email: "manager@acme.com", Division: "Infrastructure",
    Department: "Engineering", JobTitle: "Project Manager", Role: "Project Manager",
    UserRole: "Manager", IsManager: "1" },
  // FIRST NAME BLANK, LAST NAME PRESENT, NO FULL NAME -> first name inferred from last name.
  { FirstName: "", LastName: "Carpenter", Email: "carpenter@acme.com", Division: "Infrastructure",
    Department: "Engineering", JobTitle: "Engineer", Role: "Engineer",
    UserRole: "User", IsManager: "0" },
];
rows.forEach((r) => ws.addRow(HEADERS.map((h) => r[h] ?? "")));
HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = Math.max(h.length + 4, 14); });

wb.xlsx.writeFile(path.join(OUT_DIR, "03_first_name_from_last_name.xlsx")).then(() => {
  console.log("wrote 03_first_name_from_last_name.xlsx");
});
