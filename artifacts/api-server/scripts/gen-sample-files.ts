import ExcelJS from "exceljs";
import path from "node:path";
import fs from "node:fs";

const OUT = path.resolve(process.cwd(), "../../.local/sample-onboarding-files");
fs.mkdirSync(OUT, { recursive: true });

async function save(wb: ExcelJS.Workbook, name: string) {
  const p = path.join(OUT, name);
  await wb.xlsx.writeFile(p);
  console.log("wrote", p);
}

// ── File A ── arbitrary tab names + a title banner row above the headers ──────
async function fileA() {
  const wb = new ExcelJS.Workbook();

  const s1 = wb.addWorksheet("Sheet1");
  s1.addRow(["Acme Architects — Staff Directory (confidential)"]);
  s1.addRow([]);
  s1.addRow(["Full Name", "Email", "Business Unit", "Department", "Role", "Job Title", "Billing Rate", "Manager?"]);
  s1.addRow(["Amelia Stone", "amelia@acme-arch.com", "Buildings", "Architecture", "Principal", "Senior Principal", 240, "Yes"]);
  s1.addRow(["Ken Ito", "ken@acme-arch.com", "Buildings", "Interiors", "Designer", "Interior Designer", 150, "No"]);

  const s2 = wb.addWorksheet("Tab2");
  s2.addRow(["Pipeline & Active Work"]);
  s2.addRow(["Company Name", "Contact", "Market Sector", "Project Title", "Type", "Contract Value", "Chance of Success"]);
  s2.addRow(["Harbor Development", "Dana Cole", "Commercial", "Marina Redevelopment", "Opportunity", 1800000, "60%"]);
  s2.addRow(["Summit Co", "Raj Patel", "Healthcare", "Summit Clinic Fitout", "Project", 950000, "Won"]);

  const s3 = wb.addWorksheet("Staffing");
  s3.addRow(["Resource", "Project", "Allocation %", "Total Hours"]);
  s3.addRow(["Amelia Stone", "Summit Clinic Fitout", "50%", 320]);
  s3.addRow(["Ken Ito", "Summit Clinic Fitout", "75%", 480]);

  await save(wb, "sample-A-arbitrary-tabs.xlsx");
}

// ── File B ── headers sit BELOW merged title + spacer rows; synonym columns ───
async function fileB() {
  const wb = new ExcelJS.Workbook();

  const s1 = wb.addWorksheet("Employees");
  s1.mergeCells("A1:F1");
  s1.getCell("A1").value = "BridgeWorks Engineering — People Export 2026";
  s1.addRow([]);
  s1.addRow(["Please keep one person per row. Email must be unique."]);
  s1.addRow(["Name", "Work Email", "Division", "Team", "Position", "Hourly Rate"]);
  s1.addRow(["Maria Gomez", "maria@bridgeworks.io", "Infrastructure", "Bridges", "Lead Engineer", 200]);
  s1.addRow(["Tom Becker", "tom@bridgeworks.io", "Infrastructure", "Roads", "Engineer", 130]);

  const s2 = wb.addWorksheet("Opportunities List");
  s2.mergeCells("A1:E1");
  s2.getCell("A1").value = "Sales pipeline — Q2";
  s2.addRow([]);
  s2.addRow(["Client", "Contact Person", "Sector", "Job Name", "Estimated Value"]);
  s2.addRow(["Harbor Dev", "Dana Cole", "Commercial", "North Marina", 1800000]);
  s2.addRow(["Summit Co", "Raj Patel", "Healthcare", "Clinic Fitout", 950000]);

  const s3 = wb.addWorksheet("Resource Plan");
  s3.addRow(["Plan generated automatically — do not edit headers"]);
  s3.addRow(["Team Member", "Project", "% Allocation", "Hours", "Allocation Type"]);
  s3.addRow(["Maria Gomez", "Clinic Fitout", "60%", 384, "Billable"]);

  await save(wb, "sample-B-headers-below-banner.xlsx");
}

// ── File C ── friendly names, synonym columns, NO assignments tab ─────────────
async function fileC() {
  const wb = new ExcelJS.Workbook();

  const s1 = wb.addWorksheet("Your Team");
  s1.addRow(["Person", "Email Address", "Business Unit", "Group", "Job Role", "Title", "Bill Rate", "Is Manager"]);
  s1.addRow(["Lena Park", "lena@northstar.co", "Operations", "Field", "Foreman", "Site Foreman", 110, "Yes"]);
  s1.addRow(["Owen Diaz", "owen@northstar.co", "Operations", "Office", "Coordinator", "Project Coordinator", 95, "No"]);

  const s2 = wb.addWorksheet("Clients & Projects");
  s2.addRow(["Company", "Sector", "Project Name", "Project Type"]);
  s2.addRow(["NorthStar Holdings", "Industrial", "HQ Build-Out", "Project"]);
  s2.addRow(["Vertex Group", "Retail", "Warehouse Expansion", "Project"]);

  await save(wb, "sample-C-friendly-names.xlsx");
}

await fileA();
await fileB();
await fileC();
console.log("done");
