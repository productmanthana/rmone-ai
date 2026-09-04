/**
 * Generates 3 test Excel files for the onboarding import pipeline:
 *   test-single-tab.xlsx   — ALL columns in one combined tab
 *   test-multi-tab.xlsx    — Full multi-tab template with rich data
 *   test-different.xlsx    — Synonym-heavy alternative layout (different names)
 */
import ExcelJS from "./node_modules/exceljs/dist/es5/exceljs.nodejs.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../..");   // → /home/runner/workspace

// ─── Colour palette ──────────────────────────────────────────────────────────
const BLUE   = { argb: "FF1565C0" };
const TEAL   = { argb: "FF00695C" };
const PURPLE = { argb: "FF6A1B9A" };
const AMBER  = { argb: "FFF57F17" };
const GREEN  = { argb: "FF2E7D32" };
const WHITE  = { argb: "FFFFFFFF" };
const LGREY  = { argb: "FFF5F5F5" };

function headerStyle(fgColor) {
  return {
    font:      { bold: true, color: WHITE, size: 11 },
    fill:      { type: "pattern", pattern: "solid", fgColor },
    alignment: { horizontal: "center", vertical: "middle", wrapText: true },
    border:    { bottom: { style: "thin", color: { argb: "FFBDBDBD" } } },
  };
}

function addSheet(wb, name, columns, rows, color) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width ?? 20 }));
  ws.getRow(1).eachCell(cell => Object.assign(cell, headerStyle(color)));
  ws.getRow(1).height = 32;
  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.eachCell(cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: i % 2 === 0 ? LGREY : WHITE };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    row.height = 20;
  });
  // hint row at bottom (grey italic)
  const hint = ws.addRow({});
  hint.getCell(1).value = "↑ Delete these sample rows before uploading. Column headers MUST stay.";
  hint.getCell(1).font = { italic: true, color: { argb: "FF9E9E9E" }, size: 10 };
  return ws;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILE 1 — single-tab.xlsx — ALL columns in one combined "All Data" tab
// ═══════════════════════════════════════════════════════════════════════════════
async function buildSingleTab() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RM ONE Onboarding Test";

  // Combine Team + Clients + Assignments columns all in one sheet.
  // The pipeline's content-scoring will detect the dominant table type.
  // We use the TEAM columns first (the sheet name "Your Team" is in SIMPLIFIED_TEAM_NAMES
  // so tab name alone would route it, but we deliberately use "All Data" to test content detection).
  const cols = [
    // ── TEAM ─────────────────────────────────────────────
    { header: "Business Unit",          key: "CRMBusinessUnitChoice",      width: 22 },
    { header: "Division",               key: "Division",                   width: 22 },
    { header: "Department",             key: "Department",                  width: 22 },
    { header: "Role",                   key: "Role",                       width: 22 },
    { header: "Billing Rate",           key: "BillingRate",                width: 14 },
    { header: "Labor Rate",             key: "EmpLaborRate",               width: 14 },
    { header: "Cost Rate",              key: "EmpCostRate",                width: 14 },
    { header: "Job Title",              key: "JobTitle",                   width: 22 },
    { header: "Job Profile",            key: "JobProfile",                 width: 28 },
    { header: "Login Email",            key: "UserName",                   width: 28 },
    { header: "Full Name",              key: "FullName",                   width: 22 },
    { header: "First Name",             key: "FirstName",                  width: 18 },
    { header: "Last Name",              key: "LastName",                   width: 18 },
    { header: "Email",                  key: "Email",                      width: 28 },
    { header: "Password",               key: "Password",                   width: 16 },
    { header: "Access Level",           key: "UserRole",                   width: 14 },
    { header: "Manager",                key: "Manager",                    width: 28 },
    { header: "Start Date",             key: "StartDate",                  width: 14 },
    { header: "End Date",               key: "EndDate",                    width: 14 },
    { header: "Is Manager",             key: "IsManager",                  width: 12 },
    // ── CLIENTS / PROJECTS ────────────────────────────────
    { header: "Type",                   key: "Type",                       width: 14 },
    { header: "Company Name",           key: "CompanyName",                width: 30 },
    { header: "Contacts",               key: "ContactName",                width: 30 },
    { header: "Client Rep",             key: "ClientRep",                  width: 22 },
    { header: "CRM Health",             key: "CRMHealth",                  width: 14 },
    { header: "Market Sector",          key: "MarketSector",               width: 22 },
    { header: "Project Title",          key: "ProjectTitle",               width: 34 },
    { header: "Job ID",                 key: "ERPJobID",                   width: 16 },
    { header: "Project Type",           key: "ProjectType",                width: 20 },
    { header: "Service Type",           key: "ServiceType",                width: 20 },
    { header: "Request Category",       key: "RequestCategory",            width: 20 },
    { header: "Category",               key: "Category",                   width: 18 },
    { header: "Project Tag",            key: "ProjectTag",                 width: 18 },
    { header: "Contract Value",         key: "ContractValue",              width: 18 },
    { header: "Contract Limit",         key: "ContractLimit",              width: 18 },
    { header: "Gross Margin",           key: "GrossMargin",                width: 16 },
    { header: "Contract Type",          key: "ContractType",               width: 16 },
    { header: "Chance of Success",      key: "ChanceOfSuccessChoice",      width: 22 },
    { header: "Status",                 key: "Status",                     width: 14 },
    { header: "Project Start Date",     key: "ProjectStartDate",           width: 16 },
    { header: "Project End Date",       key: "ProjectEndDate",             width: 16 },
    { header: "Proposal Due Date",      key: "ProposalPhaseDueDate",       width: 20 },
    { header: "Precon Start",           key: "PreconStartDate",            width: 16 },
    { header: "Precon End",             key: "PreconEndDate",              width: 16 },
    { header: "Construction Start",     key: "ConstStartDate",             width: 20 },
    { header: "Est. Constr. Start",     key: "EstimatedConstructionStart", width: 20 },
    { header: "Est. Constr. End",       key: "EstimatedConstructionEnd",   width: 20 },
    { header: "Closeout Date",          key: "CloseoutDate",               width: 16 },
    { header: "Closeout Start",         key: "CloseoutStartDate",          width: 16 },
    { header: "Closed Date",            key: "ClosedDate",                 width: 16 },
    { header: "Approx Value",           key: "ApproxContractValue",        width: 18 },
    { header: "Labor Budget",           key: "LaborContractAmount",        width: 18 },
    { header: "Sector",                 key: "SectorChoice",               width: 18 },
    { header: "Primary Contact",        key: "PointOfContact",             width: 24 },
    { header: "Project Lead",           key: "ProjectLeadUser",            width: 28 },
    { header: "Project Manager",        key: "ProjectManagerUser",         width: 28 },
    { header: "Senior Project Manager", key: "SeniorProjectManagerUser",   width: 28 },
    { header: "Business Lead",          key: "BusinessLeadUser",           width: 28 },
    { header: "Owner",                  key: "OwnerUser",                  width: 28 },
    { header: "Lead Estimator",         key: "LeadEstimatorUser",          width: 28 },
    { header: "Lead Superintendent",    key: "LeadSuperintendentUser",     width: 28 },
    { header: "Estimator",              key: "EstimatorUser",              width: 28 },
    { header: "Bid Due Date",           key: "BidDueDate",                 width: 16 },
    { header: "Interview Date",         key: "InterviewDate",              width: 16 },
    { header: "Opportunity Stage",      key: "CRMOpportunityStatusChoice", width: 22 },
    // ── ASSIGNMENTS ───────────────────────────────────────
    { header: "Assign Project",         key: "AssignProject",              width: 34 },
    { header: "Team Member",            key: "Resource",                   width: 28 },
    { header: "Assign Start",           key: "AllocationStartDate",        width: 14 },
    { header: "Assign End",             key: "AllocationEndDate",          width: 14 },
    { header: "Allocation %",           key: "PctAllocation",              width: 14 },
    { header: "Total Hours",            key: "AllocationHour",             width: 14 },
    { header: "Assign Type",            key: "AllocationType",             width: 14 },
    { header: "Assign Role",            key: "AssignRole",                 width: 22 },
    { header: "Assign Job Title",       key: "AssignJobTitle",             width: 22 },
    { header: "Assign Division",        key: "AssignDivision",             width: 22 },
    { header: "Assign Department",      key: "AssignDepartment",           width: 22 },
    { header: "Assign Billing Rate",    key: "AssignBillingRate",          width: 16 },
    { header: "Actual Start",           key: "ActualStartDate",            width: 14 },
    { header: "Actual End",             key: "ActualEndDate",              width: 14 },
    { header: "Actual Hours",           key: "ActualHour",                 width: 14 },
    { header: "Billed Hours",           key: "BilledHours",                width: 14 },
  ];

  const rows = [
    // Row 1 — team member + their project assignment in same row
    {
      CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Civil Engineering",
      Role: "Principal Engineer", BillingRate: "210", EmpLaborRate: "110", EmpCostRate: "135",
      JobTitle: "Principal Engineer", JobProfile: "Leads major infrastructure projects",
      UserName: "david.chen@riverside.com", FullName: "David Chen", FirstName: "David", LastName: "Chen",
      Email: "david.chen@riverside.com", Password: "Welcome@2026!", UserRole: "Admin",
      Manager: "", StartDate: "2018-03-01", EndDate: "", IsManager: "1",
      // project columns blank for this team-only row
      Type: "", CompanyName: "", ContactName: "", ClientRep: "", CRMHealth: "", MarketSector: "",
      ProjectTitle: "", ERPJobID: "", ProjectType: "", ServiceType: "", ContractValue: "", Status: "",
      // assignment columns blank
      AssignProject: "", Resource: "", AllocationStartDate: "", AllocationEndDate: "",
    },
    // Row 2 — another team member
    {
      CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Project Management",
      Role: "Project Manager", BillingRate: "175", EmpLaborRate: "90", EmpCostRate: "110",
      JobTitle: "Senior PM", JobProfile: "AEC project delivery specialist",
      UserName: "sarah.park@riverside.com", FullName: "Sarah Park", FirstName: "Sarah", LastName: "Park",
      Email: "sarah.park@riverside.com", Password: "Welcome@2026!", UserRole: "Manager",
      Manager: "david.chen@riverside.com", StartDate: "2020-07-15", EndDate: "", IsManager: "1",
      Type: "", CompanyName: "", ContactName: "", ClientRep: "", CRMHealth: "", MarketSector: "",
      ProjectTitle: "", ERPJobID: "", Status: "",
      AssignProject: "", Resource: "",
    },
    // Row 3 — team member
    {
      CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Civil Engineering",
      Role: "Senior Engineer", BillingRate: "155", EmpLaborRate: "78", EmpCostRate: "95",
      JobTitle: "Senior Civil Engineer", JobProfile: "",
      UserName: "marcus.reed@riverside.com", FullName: "Marcus Reed", FirstName: "Marcus", LastName: "Reed",
      Email: "marcus.reed@riverside.com", Password: "Welcome@2026!", UserRole: "User",
      Manager: "sarah.park@riverside.com", StartDate: "2021-11-01", EndDate: "", IsManager: "0",
    },
    // Row 4 — team member
    {
      CRMBusinessUnitChoice: "Buildings BU", Division: "Buildings", Department: "Architecture",
      Role: "Architect", BillingRate: "165", EmpLaborRate: "85", EmpCostRate: "105",
      JobTitle: "Licensed Architect", JobProfile: "Urban mixed-use design",
      UserName: "lisa.wang@riverside.com", FullName: "Lisa Wang", FirstName: "Lisa", LastName: "Wang",
      Email: "lisa.wang@riverside.com", Password: "Welcome@2026!", UserRole: "Manager",
      Manager: "david.chen@riverside.com", StartDate: "2019-04-01", EndDate: "", IsManager: "0",
    },
    // Row 5 — team member (estimator)
    {
      CRMBusinessUnitChoice: "Buildings BU", Division: "Buildings", Department: "Preconstruction",
      Role: "Estimator", BillingRate: "145", EmpLaborRate: "72", EmpCostRate: "88",
      JobTitle: "Senior Estimator", JobProfile: "",
      UserName: "james.torres@riverside.com", FullName: "James Torres", FirstName: "James", LastName: "Torres",
      Email: "james.torres@riverside.com", Password: "Welcome@2026!", UserRole: "User",
      Manager: "david.chen@riverside.com", StartDate: "2022-09-12", EndDate: "", IsManager: "0",
    },
    // Row 6 — project row
    {
      Type: "Project", CompanyName: "Metro City Department of Transportation", ContactName: "Helen Cho; Robert Marsh",
      ClientRep: "david.chen@riverside.com", CRMHealth: "Good", MarketSector: "Transportation",
      ProjectTitle: "City Center Bridge Retrofit", ERPJobID: "RVS-1001",
      ProjectType: "Design-Build", ServiceType: "Structural Engineering", RequestCategory: "", Category: "Capital",
      ProjectTag: "bridge; retrofit", ContractValue: "6200000", ContractLimit: "6500000",
      GrossMargin: "34", ContractType: "T&M", ChanceOfSuccessChoice: "", Status: "Active",
      CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Civil Engineering",
      ProjectStartDate: "2025-08-01", ProjectEndDate: "2027-06-30",
      ProposalPhaseDueDate: "", PreconStartDate: "2025-08-01", PreconEndDate: "2026-01-31",
      ConstStartDate: "2026-02-01", EstimatedConstructionStart: "2026-02-01", EstimatedConstructionEnd: "2027-05-31",
      CloseoutDate: "2027-06-30", CloseoutStartDate: "2027-04-01", ClosedDate: "",
      ApproxContractValue: "6000000", LaborContractAmount: "4200000", SectorChoice: "Transportation",
      PointOfContact: "Helen Cho", ProjectLeadUser: "david.chen@riverside.com",
      ProjectManagerUser: "sarah.park@riverside.com", SeniorProjectManagerUser: "david.chen@riverside.com",
      BusinessLeadUser: "david.chen@riverside.com", OwnerUser: "david.chen@riverside.com",
      LeadEstimatorUser: "", LeadSuperintendentUser: "", EstimatorUser: "",
      BidDueDate: "", InterviewDate: "", CRMOpportunityStatusChoice: "",
    },
    // Row 7 — project row
    {
      Type: "Project", CompanyName: "Pacific Development Group", ContactName: "Monica Silver",
      ClientRep: "lisa.wang@riverside.com", CRMHealth: "Good", MarketSector: "Construction",
      ProjectTitle: "Harbor View Tower", ERPJobID: "RVS-1002",
      ProjectType: "Construction", ServiceType: "Architecture", RequestCategory: "", Category: "Commercial",
      ProjectTag: "high-rise; mixed-use", ContractValue: "14500000", ContractLimit: "",
      GrossMargin: "29", ContractType: "Fixed", ChanceOfSuccessChoice: "", Status: "Active",
      CRMBusinessUnitChoice: "Buildings BU", Division: "Buildings", Department: "Architecture",
      ProjectStartDate: "2024-11-01", ProjectEndDate: "2028-03-31",
      ProposalPhaseDueDate: "", PreconStartDate: "2024-11-01", PreconEndDate: "2025-06-30",
      ConstStartDate: "2025-07-01", EstimatedConstructionStart: "2025-07-01", EstimatedConstructionEnd: "2027-12-31",
      CloseoutDate: "2028-03-31", CloseoutStartDate: "2028-01-01", ClosedDate: "",
      ApproxContractValue: "15000000", LaborContractAmount: "9800000", SectorChoice: "Construction",
      PointOfContact: "Monica Silver", ProjectLeadUser: "lisa.wang@riverside.com",
      ProjectManagerUser: "sarah.park@riverside.com", SeniorProjectManagerUser: "david.chen@riverside.com",
      BusinessLeadUser: "lisa.wang@riverside.com", OwnerUser: "lisa.wang@riverside.com",
      LeadEstimatorUser: "james.torres@riverside.com", LeadSuperintendentUser: "", EstimatorUser: "james.torres@riverside.com",
      BidDueDate: "", InterviewDate: "", CRMOpportunityStatusChoice: "",
    },
    // Row 8 — opportunity
    {
      Type: "Opportunity", CompanyName: "Bay Area Regional Transit", ContactName: "Tom Nguyen; Diana Reyes",
      ClientRep: "david.chen@riverside.com", CRMHealth: "Fair", MarketSector: "Transportation",
      ProjectTitle: "Regional Transit Hub Expansion", ERPJobID: "OPP-3001",
      ProjectType: "Design", ServiceType: "Civil Engineering", RequestCategory: "", Category: "",
      ProjectTag: "transit; hub", ContractValue: "22000000", ContractLimit: "",
      GrossMargin: "38", ContractType: "", ChanceOfSuccessChoice: "70", Status: "Active",
      CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Civil Engineering",
      ProjectStartDate: "2026-10-01", ProjectEndDate: "2030-12-31",
      ProposalPhaseDueDate: "2026-07-30", PreconStartDate: "", PreconEndDate: "",
      ConstStartDate: "", EstimatedConstructionStart: "2027-06-01", EstimatedConstructionEnd: "2030-06-30",
      CloseoutDate: "", CloseoutStartDate: "", ClosedDate: "",
      ApproxContractValue: "22000000", LaborContractAmount: "15000000", SectorChoice: "Transportation",
      PointOfContact: "Tom Nguyen", ProjectLeadUser: "david.chen@riverside.com",
      ProjectManagerUser: "david.chen@riverside.com", SeniorProjectManagerUser: "david.chen@riverside.com",
      BusinessLeadUser: "david.chen@riverside.com", OwnerUser: "david.chen@riverside.com",
      LeadEstimatorUser: "james.torres@riverside.com", LeadSuperintendentUser: "", EstimatorUser: "james.torres@riverside.com",
      BidDueDate: "2026-07-15", InterviewDate: "2026-07-22", CRMOpportunityStatusChoice: "Proposal",
    },
    // Row 9 — assignment row
    {
      AssignProject: "City Center Bridge Retrofit", Resource: "david.chen@riverside.com",
      AllocationStartDate: "2025-08-01", AllocationEndDate: "2027-06-30",
      PctAllocation: "100", AllocationHour: "3200", AllocationType: "Hard",
      AssignRole: "Principal Engineer", AssignJobTitle: "Principal Engineer",
      AssignDivision: "Infrastructure", AssignDepartment: "Civil Engineering",
      AssignBillingRate: "210", ActualStartDate: "2025-08-01", ActualEndDate: "", ActualHour: "", BilledHours: "",
    },
    // Row 10 — assignment row
    {
      AssignProject: "City Center Bridge Retrofit", Resource: "sarah.park@riverside.com",
      AllocationStartDate: "2025-08-01", AllocationEndDate: "2027-06-30",
      PctAllocation: "80", AllocationHour: "2560", AllocationType: "Hard",
      AssignRole: "Project Manager", AssignJobTitle: "Senior PM",
      AssignDivision: "Infrastructure", AssignDepartment: "Project Management",
      AssignBillingRate: "175", ActualStartDate: "2025-08-01", ActualEndDate: "", ActualHour: "", BilledHours: "",
    },
    // Row 11 — assignment row
    {
      AssignProject: "Harbor View Tower", Resource: "sarah.park@riverside.com",
      AllocationStartDate: "2024-11-01", AllocationEndDate: "2028-03-31",
      PctAllocation: "50", AllocationHour: "3000", AllocationType: "Hard",
      AssignRole: "Project Manager", AssignJobTitle: "Senior PM",
      AssignDivision: "Buildings", AssignDepartment: "Architecture",
      AssignBillingRate: "175", ActualStartDate: "2024-11-01", ActualEndDate: "2026-12-31", ActualHour: "1850", BilledHours: "1780",
    },
    // Row 12 — assignment row
    {
      AssignProject: "Harbor View Tower", Resource: "lisa.wang@riverside.com",
      AllocationStartDate: "2024-11-01", AllocationEndDate: "2028-03-31",
      PctAllocation: "100", AllocationHour: "6000", AllocationType: "Hard",
      AssignRole: "Architect", AssignJobTitle: "Licensed Architect",
      AssignDivision: "Buildings", AssignDepartment: "Architecture",
      AssignBillingRate: "165", ActualStartDate: "2024-11-01", ActualEndDate: "", ActualHour: "", BilledHours: "",
    },
    // Row 13 — assignment row
    {
      AssignProject: "City Center Bridge Retrofit", Resource: "marcus.reed@riverside.com",
      AllocationStartDate: "2025-08-01", AllocationEndDate: "2027-06-30",
      PctAllocation: "60", AllocationHour: "1920", AllocationType: "Hard",
      AssignRole: "Senior Engineer", AssignJobTitle: "Senior Civil Engineer",
      AssignDivision: "Infrastructure", AssignDepartment: "Civil Engineering",
      AssignBillingRate: "155", ActualStartDate: "2025-08-01", ActualEndDate: "", ActualHour: "", BilledHours: "",
    },
  ];

  addSheet(wb, "All Data", cols, rows, BLUE);
  await wb.xlsx.writeFile(path.join(OUT, "test-single-tab.xlsx"));
  console.log("✅  test-single-tab.xlsx");
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILE 2 — multi-tab.xlsx — Full structured multi-tab template
// ═══════════════════════════════════════════════════════════════════════════════
async function buildMultiTab() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RM ONE Onboarding Test";

  // TAB 1: Your Team
  addSheet(wb, "Your Team", [
    { header: "Business Unit",         key: "CRMBusinessUnitChoice", width: 22 },
    { header: "Division",              key: "Division",              width: 22 },
    { header: "Department",            key: "Department",             width: 22 },
    { header: "Role",                  key: "Role",                  width: 22 },
    { header: "Billing Rate",          key: "BillingRate",           width: 14 },
    { header: "Labor Rate",            key: "EmpLaborRate",          width: 14 },
    { header: "Cost Rate",             key: "EmpCostRate",           width: 13 },
    { header: "Job Title",             key: "JobTitle",              width: 22 },
    { header: "Job Profile",           key: "JobProfile",            width: 28 },
    { header: "Login Email",           key: "UserName",              width: 28 },
    { header: "Full Name",             key: "FullName",              width: 22 },
    { header: "First Name",            key: "FirstName",             width: 18 },
    { header: "Last Name",             key: "LastName",              width: 18 },
    { header: "Email",                 key: "Email",                 width: 28 },
    { header: "Password",              key: "Password",              width: 16 },
    { header: "Access Level",          key: "UserRole",              width: 14 },
    { header: "Manager",               key: "Manager",               width: 28 },
    { header: "Start Date",            key: "StartDate",             width: 14 },
    { header: "End Date",              key: "EndDate",               width: 14 },
    { header: "Is Manager",            key: "IsManager",             width: 12 },
  ], [
    { CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Civil Engineering",   Role: "Principal Engineer", BillingRate: "210", EmpLaborRate: "110", EmpCostRate: "135", JobTitle: "Principal Engineer",    JobProfile: "Leads major infrastructure projects",    UserName: "david.chen@riverside.com",   FullName: "David Chen",   FirstName: "David",  LastName: "Chen",   Email: "david.chen@riverside.com",   Password: "Welcome@2026!", UserRole: "Admin",   Manager: "",                             StartDate: "2018-03-01", EndDate: "",           IsManager: "1" },
    { CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Project Management", Role: "Project Manager",    BillingRate: "175", EmpLaborRate: "90",  EmpCostRate: "110", JobTitle: "Senior PM",             JobProfile: "AEC project delivery specialist",        UserName: "sarah.park@riverside.com",   FullName: "Sarah Park",   FirstName: "Sarah",  LastName: "Park",   Email: "sarah.park@riverside.com",   Password: "Welcome@2026!", UserRole: "Manager", Manager: "david.chen@riverside.com",     StartDate: "2020-07-15", EndDate: "",           IsManager: "1" },
    { CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Civil Engineering",   Role: "Senior Engineer",    BillingRate: "155", EmpLaborRate: "78",  EmpCostRate: "95",  JobTitle: "Senior Civil Engineer", JobProfile: "",                                       UserName: "marcus.reed@riverside.com",  FullName: "Marcus Reed",  FirstName: "Marcus", LastName: "Reed",   Email: "marcus.reed@riverside.com",  Password: "Welcome@2026!", UserRole: "User",    Manager: "sarah.park@riverside.com",     StartDate: "2021-11-01", EndDate: "",           IsManager: "0" },
    { CRMBusinessUnitChoice: "Buildings BU",      Division: "Buildings",      Department: "Architecture",        Role: "Architect",          BillingRate: "165", EmpLaborRate: "85",  EmpCostRate: "105", JobTitle: "Licensed Architect",    JobProfile: "Urban mixed-use design",                 UserName: "lisa.wang@riverside.com",    FullName: "Lisa Wang",    FirstName: "Lisa",   LastName: "Wang",   Email: "lisa.wang@riverside.com",    Password: "Welcome@2026!", UserRole: "Manager", Manager: "david.chen@riverside.com",     StartDate: "2019-04-01", EndDate: "",           IsManager: "0" },
    { CRMBusinessUnitChoice: "Buildings BU",      Division: "Buildings",      Department: "Preconstruction",     Role: "Estimator",          BillingRate: "145", EmpLaborRate: "72",  EmpCostRate: "88",  JobTitle: "Senior Estimator",      JobProfile: "",                                       UserName: "james.torres@riverside.com", FullName: "James Torres", FirstName: "James",  LastName: "Torres", Email: "james.torres@riverside.com", Password: "Welcome@2026!", UserRole: "User",    Manager: "david.chen@riverside.com",     StartDate: "2022-09-12", EndDate: "",           IsManager: "0" },
    { CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Civil Engineering",   Role: "Junior Engineer",    BillingRate: "115", EmpLaborRate: "58",  EmpCostRate: "70",  JobTitle: "Engineer I",            JobProfile: "",                                       UserName: "priya.sharma@riverside.com", FullName: "Priya Sharma", FirstName: "Priya",  LastName: "Sharma", Email: "priya.sharma@riverside.com", Password: "Welcome@2026!", UserRole: "User",    Manager: "marcus.reed@riverside.com",    StartDate: "2024-01-08", EndDate: "",           IsManager: "0" },
    { CRMBusinessUnitChoice: "Buildings BU",      Division: "Buildings",      Department: "Architecture",        Role: "Junior Architect",   BillingRate: "120", EmpLaborRate: "60",  EmpCostRate: "73",  JobTitle: "Architect I",           JobProfile: "",                                       UserName: "ryan.okoye@riverside.com",   FullName: "Ryan Okoye",   FirstName: "Ryan",   LastName: "Okoye",  Email: "ryan.okoye@riverside.com",   Password: "Welcome@2026!", UserRole: "User",    Manager: "lisa.wang@riverside.com",      StartDate: "2023-05-22", EndDate: "",           IsManager: "0" },
    { CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Environmental",       Role: "Environmental Consultant", BillingRate: "140", EmpLaborRate: "70", EmpCostRate: "85", JobTitle: "Environmental Specialist", JobProfile: "NEPA compliance expert",          UserName: "claire.fox@riverside.com",   FullName: "Claire Fox",   FirstName: "Claire", LastName: "Fox",    Email: "claire.fox@riverside.com",   Password: "Welcome@2026!", UserRole: "User",    Manager: "sarah.park@riverside.com",     StartDate: "2023-02-14", EndDate: "",           IsManager: "0" },
  ], TEAL);

  // TAB 2: Clients & Projects
  addSheet(wb, "Clients & Projects", [
    { header: "Type",                   key: "Type",                       width: 14 },
    { header: "Company Name",           key: "CompanyName",                width: 32 },
    { header: "Contacts",               key: "ContactName",                width: 34 },
    { header: "Client Rep",             key: "ClientRep",                  width: 26 },
    { header: "CRM Health",             key: "CRMHealth",                  width: 14 },
    { header: "Market Sector",          key: "MarketSector",               width: 22 },
    { header: "Project Title",          key: "ProjectTitle",               width: 38 },
    { header: "Job ID",                 key: "ERPJobID",                   width: 14 },
    { header: "Project Type",           key: "ProjectType",                width: 18 },
    { header: "Service Type",           key: "ServiceType",                width: 18 },
    { header: "Request Category",       key: "RequestCategory",            width: 20 },
    { header: "Category",               key: "Category",                   width: 16 },
    { header: "Project Tag",            key: "ProjectTag",                 width: 18 },
    { header: "Contract Value",         key: "ContractValue",              width: 16 },
    { header: "Contract Limit",         key: "ContractLimit",              width: 16 },
    { header: "Gross Margin",           key: "GrossMargin",                width: 14 },
    { header: "Contract Type",          key: "ContractType",               width: 14 },
    { header: "Chance of Success",      key: "ChanceOfSuccessChoice",      width: 20 },
    { header: "Status",                 key: "Status",                     width: 12 },
    { header: "Business Unit",          key: "CRMBusinessUnitChoice",      width: 22 },
    { header: "Division",               key: "Division",                   width: 20 },
    { header: "Department",             key: "Department",                  width: 22 },
    { header: "Start Date",             key: "StartDate",                  width: 14 },
    { header: "End Date",               key: "EndDate",                    width: 14 },
    { header: "Proposal Due Date",      key: "ProposalPhaseDueDate",       width: 18 },
    { header: "Precon Start",           key: "PreconStartDate",            width: 14 },
    { header: "Precon End",             key: "PreconEndDate",              width: 14 },
    { header: "Construction Start",     key: "ConstStartDate",             width: 18 },
    { header: "Est. Constr. Start",     key: "EstimatedConstructionStart", width: 18 },
    { header: "Est. Constr. End",       key: "EstimatedConstructionEnd",   width: 18 },
    { header: "Closeout Date",          key: "CloseoutDate",               width: 14 },
    { header: "Closeout Start",         key: "CloseoutStartDate",          width: 14 },
    { header: "Closed Date",            key: "ClosedDate",                 width: 14 },
    { header: "Approx Value",           key: "ApproxContractValue",        width: 16 },
    { header: "Labor Budget",           key: "LaborContractAmount",        width: 16 },
    { header: "Sector",                 key: "SectorChoice",               width: 18 },
    { header: "Primary Contact",        key: "PointOfContact",             width: 24 },
    { header: "Project Lead",           key: "ProjectLeadUser",            width: 28 },
    { header: "Project Manager",        key: "ProjectManagerUser",         width: 28 },
    { header: "Senior Project Manager", key: "SeniorProjectManagerUser",   width: 28 },
    { header: "Business Lead",          key: "BusinessLeadUser",           width: 28 },
    { header: "Owner",                  key: "OwnerUser",                  width: 28 },
    { header: "Lead Estimator",         key: "LeadEstimatorUser",          width: 28 },
    { header: "Lead Superintendent",    key: "LeadSuperintendentUser",     width: 28 },
    { header: "Estimator",              key: "EstimatorUser",              width: 28 },
    { header: "Bid Due Date",           key: "BidDueDate",                 width: 14 },
    { header: "Interview Date",         key: "InterviewDate",              width: 14 },
    { header: "Opportunity Stage",      key: "CRMOpportunityStatusChoice", width: 20 },
  ], [
    { Type: "Project",     CompanyName: "Metro City Dept of Transportation", ContactName: "Helen Cho; Robert Marsh",     ClientRep: "david.chen@riverside.com",   CRMHealth: "Good", MarketSector: "Transportation", ProjectTitle: "City Center Bridge Retrofit",    ERPJobID: "RVS-1001", ProjectType: "Design-Build",  ServiceType: "Structural Engineering", RequestCategory: "Capital",       Category: "Public Infrastructure", ProjectTag: "bridge;retrofit",   ContractValue: "6200000",  ContractLimit: "6500000",   GrossMargin: "34", ContractType: "T&M",   ChanceOfSuccessChoice: "",   Status: "Active",   CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Civil Engineering",   StartDate: "2025-08-01", EndDate: "2027-06-30", ProposalPhaseDueDate: "",         PreconStartDate: "2025-08-01", PreconEndDate: "2026-01-31",  ConstStartDate: "2026-02-01", EstimatedConstructionStart: "2026-02-01", EstimatedConstructionEnd: "2027-05-31", CloseoutDate: "2027-06-30", CloseoutStartDate: "2027-04-01", ClosedDate: "",           ApproxContractValue: "6000000",  LaborContractAmount: "4200000", SectorChoice: "Transportation",  PointOfContact: "Helen Cho",     ProjectLeadUser: "david.chen@riverside.com",   ProjectManagerUser: "sarah.park@riverside.com",   SeniorProjectManagerUser: "david.chen@riverside.com", BusinessLeadUser: "david.chen@riverside.com", OwnerUser: "david.chen@riverside.com",  LeadEstimatorUser: "",                        LeadSuperintendentUser: "",   EstimatorUser: "",                        BidDueDate: "",           InterviewDate: "",           CRMOpportunityStatusChoice: "" },
    { Type: "Project",     CompanyName: "Pacific Development Group",         ContactName: "Monica Silver",               ClientRep: "lisa.wang@riverside.com",    CRMHealth: "Good", MarketSector: "Construction",   ProjectTitle: "Harbor View Tower",             ERPJobID: "RVS-1002", ProjectType: "Construction",  ServiceType: "Architecture",           RequestCategory: "Commercial",    Category: "Mixed Use",             ProjectTag: "high-rise",         ContractValue: "14500000", ContractLimit: "",          GrossMargin: "29", ContractType: "Fixed", ChanceOfSuccessChoice: "",   Status: "Active",   CRMBusinessUnitChoice: "Buildings BU",      Division: "Buildings",      Department: "Architecture",        StartDate: "2024-11-01", EndDate: "2028-03-31", ProposalPhaseDueDate: "",         PreconStartDate: "2024-11-01", PreconEndDate: "2025-06-30",  ConstStartDate: "2025-07-01", EstimatedConstructionStart: "2025-07-01", EstimatedConstructionEnd: "2027-12-31", CloseoutDate: "2028-03-31", CloseoutStartDate: "2028-01-01", ClosedDate: "",           ApproxContractValue: "15000000", LaborContractAmount: "9800000", SectorChoice: "Construction",    PointOfContact: "Monica Silver", ProjectLeadUser: "lisa.wang@riverside.com",    ProjectManagerUser: "sarah.park@riverside.com",   SeniorProjectManagerUser: "david.chen@riverside.com", BusinessLeadUser: "lisa.wang@riverside.com",  OwnerUser: "lisa.wang@riverside.com",   LeadEstimatorUser: "james.torres@riverside.com", LeadSuperintendentUser: "",   EstimatorUser: "james.torres@riverside.com", BidDueDate: "",           InterviewDate: "",           CRMOpportunityStatusChoice: "" },
    { Type: "Project",     CompanyName: "Northgate School District",         ContactName: "Patricia Kim; Alan Doss",     ClientRep: "sarah.park@riverside.com",   CRMHealth: "Good", MarketSector: "Education",      ProjectTitle: "Northgate K-12 Campus Renovation",ERPJobID: "RVS-1003", ProjectType: "Renovation",    ServiceType: "Architecture",           RequestCategory: "Education",     Category: "Public",                ProjectTag: "school;k12",        ContractValue: "4100000",  ContractLimit: "4250000",   GrossMargin: "31", ContractType: "Fixed", ChanceOfSuccessChoice: "",   Status: "Active",   CRMBusinessUnitChoice: "Buildings BU",      Division: "Buildings",      Department: "Architecture",        StartDate: "2026-01-15", EndDate: "2027-08-31", ProposalPhaseDueDate: "",         PreconStartDate: "2026-01-15", PreconEndDate: "2026-05-31",  ConstStartDate: "2026-06-01", EstimatedConstructionStart: "2026-06-01", EstimatedConstructionEnd: "2027-07-31", CloseoutDate: "2027-08-31", CloseoutStartDate: "2027-07-01", ClosedDate: "",           ApproxContractValue: "4000000",  LaborContractAmount: "2900000", SectorChoice: "Education",       PointOfContact: "Patricia Kim",  ProjectLeadUser: "lisa.wang@riverside.com",    ProjectManagerUser: "lisa.wang@riverside.com",    SeniorProjectManagerUser: "david.chen@riverside.com", BusinessLeadUser: "david.chen@riverside.com", OwnerUser: "sarah.park@riverside.com",  LeadEstimatorUser: "james.torres@riverside.com", LeadSuperintendentUser: "",   EstimatorUser: "james.torres@riverside.com", BidDueDate: "",           InterviewDate: "",           CRMOpportunityStatusChoice: "" },
    { Type: "Opportunity", CompanyName: "Bay Area Regional Transit",         ContactName: "Tom Nguyen; Diana Reyes",     ClientRep: "david.chen@riverside.com",   CRMHealth: "Fair", MarketSector: "Transportation", ProjectTitle: "Regional Transit Hub Expansion", ERPJobID: "OPP-3001", ProjectType: "Design",        ServiceType: "Civil Engineering",      RequestCategory: "",              Category: "",                      ProjectTag: "transit;hub",       ContractValue: "22000000", ContractLimit: "",          GrossMargin: "38", ContractType: "",      ChanceOfSuccessChoice: "70", Status: "Active",   CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Civil Engineering",   StartDate: "2026-10-01", EndDate: "2030-12-31", ProposalPhaseDueDate: "2026-07-30", PreconStartDate: "",          PreconEndDate: "",            ConstStartDate: "",           EstimatedConstructionStart: "2027-06-01", EstimatedConstructionEnd: "2030-06-30", CloseoutDate: "",           CloseoutStartDate: "",          ClosedDate: "",           ApproxContractValue: "22000000", LaborContractAmount: "15000000",SectorChoice: "Transportation",  PointOfContact: "Tom Nguyen",    ProjectLeadUser: "david.chen@riverside.com",   ProjectManagerUser: "david.chen@riverside.com",   SeniorProjectManagerUser: "david.chen@riverside.com", BusinessLeadUser: "david.chen@riverside.com", OwnerUser: "david.chen@riverside.com",  LeadEstimatorUser: "james.torres@riverside.com", LeadSuperintendentUser: "",   EstimatorUser: "james.torres@riverside.com", BidDueDate: "2026-07-15", InterviewDate: "2026-07-22", CRMOpportunityStatusChoice: "Proposal" },
    { Type: "Opportunity", CompanyName: "Coastal Housing Authority",         ContactName: "Sandra Brooks",               ClientRep: "lisa.wang@riverside.com",    CRMHealth: "Poor", MarketSector: "Housing",        ProjectTitle: "Affordable Housing Complex — Phase 3", ERPJobID: "OPP-3002", ProjectType: "Design-Build", ServiceType: "Architecture",           RequestCategory: "",              Category: "Affordable Housing",    ProjectTag: "housing;phase3",    ContractValue: "9500000",  ContractLimit: "",          GrossMargin: "33", ContractType: "",      ChanceOfSuccessChoice: "45", Status: "Active",   CRMBusinessUnitChoice: "Buildings BU",      Division: "Buildings",      Department: "Architecture",        StartDate: "2027-01-01", EndDate: "2029-06-30", ProposalPhaseDueDate: "2026-10-15", PreconStartDate: "",          PreconEndDate: "",            ConstStartDate: "",           EstimatedConstructionStart: "2027-06-01", EstimatedConstructionEnd: "2029-03-31", CloseoutDate: "",           CloseoutStartDate: "",          ClosedDate: "",           ApproxContractValue: "9000000",  LaborContractAmount: "6500000", SectorChoice: "Housing",         PointOfContact: "Sandra Brooks", ProjectLeadUser: "lisa.wang@riverside.com",    ProjectManagerUser: "lisa.wang@riverside.com",    SeniorProjectManagerUser: "david.chen@riverside.com", BusinessLeadUser: "lisa.wang@riverside.com",  OwnerUser: "lisa.wang@riverside.com",   LeadEstimatorUser: "james.torres@riverside.com", LeadSuperintendentUser: "",   EstimatorUser: "james.torres@riverside.com", BidDueDate: "2026-10-01", InterviewDate: "2026-10-08", CRMOpportunityStatusChoice: "Qualification" },
    { Type: "Lead",        CompanyName: "Greenfield Municipal Airport",       ContactName: "Frank Webber",               ClientRep: "david.chen@riverside.com",   CRMHealth: "Good", MarketSector: "Aviation",       ProjectTitle: "Airport Terminal Modernisation",ERPJobID: "LEM-4001", ProjectType: "Design",        ServiceType: "Architecture",           RequestCategory: "",              Category: "",                      ProjectTag: "airport;terminal",  ContractValue: "35000000", ContractLimit: "",          GrossMargin: "42", ContractType: "",      ChanceOfSuccessChoice: "30", Status: "Active",   CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Civil Engineering",   StartDate: "2027-06-01", EndDate: "2031-12-31", ProposalPhaseDueDate: "2027-02-28", PreconStartDate: "",          PreconEndDate: "",            ConstStartDate: "",           EstimatedConstructionStart: "",           EstimatedConstructionEnd: "",           CloseoutDate: "",           CloseoutStartDate: "",          ClosedDate: "",           ApproxContractValue: "35000000", LaborContractAmount: "",        SectorChoice: "Aviation",        PointOfContact: "Frank Webber",  ProjectLeadUser: "david.chen@riverside.com",   ProjectManagerUser: "",                           SeniorProjectManagerUser: "",                         BusinessLeadUser: "david.chen@riverside.com", OwnerUser: "david.chen@riverside.com",  LeadEstimatorUser: "james.torres@riverside.com", LeadSuperintendentUser: "",   EstimatorUser: "",                        BidDueDate: "2027-02-15", InterviewDate: "",           CRMOpportunityStatusChoice: "Prospecting" },
  ], GREEN);

  // TAB 3: Assignments
  addSheet(wb, "Assignments", [
    { header: "Project",              key: "Project",             width: 38 },
    { header: "Team Member",          key: "Resource",            width: 28 },
    { header: "Start Date",           key: "AllocationStartDate", width: 14 },
    { header: "End Date",             key: "AllocationEndDate",   width: 14 },
    { header: "Allocation %",         key: "PctAllocation",       width: 14 },
    { header: "Total Hours",          key: "AllocationHour",      width: 14 },
    { header: "Type",                 key: "AllocationType",      width: 12 },
    { header: "Role",                 key: "Role",                width: 24 },
    { header: "Job Title",            key: "JobTitle",            width: 24 },
    { header: "Division",             key: "Division",            width: 22 },
    { header: "Department",           key: "Department",           width: 22 },
    { header: "Billing Rate",         key: "BillingRate",         width: 14 },
    { header: "Labor Rate",           key: "EmpLaborRate",        width: 14 },
    { header: "Cost Rate",            key: "EmpCostRate",         width: 14 },
    { header: "Actual Start",         key: "ActualStartDate",     width: 14 },
    { header: "Actual End",           key: "ActualEndDate",       width: 14 },
    { header: "Actual Hours",         key: "ActualHour",          width: 14 },
    { header: "Billed Hours",         key: "BilledHours",         width: 14 },
  ], [
    { Project: "City Center Bridge Retrofit",     Resource: "david.chen@riverside.com",   AllocationStartDate: "2025-08-01", AllocationEndDate: "2027-06-30", PctAllocation: "100", AllocationHour: "3200", AllocationType: "Hard", Role: "Principal Engineer",        JobTitle: "Principal Engineer",    Division: "Infrastructure", Department: "Civil Engineering",   BillingRate: "210", EmpLaborRate: "110", EmpCostRate: "135", ActualStartDate: "2025-08-01", ActualEndDate: "",           ActualHour: "",    BilledHours: "" },
    { Project: "City Center Bridge Retrofit",     Resource: "sarah.park@riverside.com",   AllocationStartDate: "2025-08-01", AllocationEndDate: "2027-06-30", PctAllocation: "80",  AllocationHour: "2560", AllocationType: "Hard", Role: "Project Manager",           JobTitle: "Senior PM",             Division: "Infrastructure", Department: "Project Management",  BillingRate: "175", EmpLaborRate: "90",  EmpCostRate: "110", ActualStartDate: "2025-08-01", ActualEndDate: "",           ActualHour: "",    BilledHours: "" },
    { Project: "City Center Bridge Retrofit",     Resource: "marcus.reed@riverside.com",  AllocationStartDate: "2025-08-01", AllocationEndDate: "2027-06-30", PctAllocation: "60",  AllocationHour: "1920", AllocationType: "Hard", Role: "Senior Engineer",           JobTitle: "Senior Civil Engineer", Division: "Infrastructure", Department: "Civil Engineering",   BillingRate: "155", EmpLaborRate: "78",  EmpCostRate: "95",  ActualStartDate: "2025-08-01", ActualEndDate: "",           ActualHour: "",    BilledHours: "" },
    { Project: "City Center Bridge Retrofit",     Resource: "claire.fox@riverside.com",   AllocationStartDate: "2025-09-01", AllocationEndDate: "2026-06-30", PctAllocation: "40",  AllocationHour: "640",  AllocationType: "Soft", Role: "Environmental Consultant",  JobTitle: "Environmental Specialist", Division: "Infrastructure", Department: "Environmental",   BillingRate: "140", EmpLaborRate: "70",  EmpCostRate: "85",  ActualStartDate: "",           ActualEndDate: "",           ActualHour: "",    BilledHours: "" },
    { Project: "Harbor View Tower",               Resource: "lisa.wang@riverside.com",    AllocationStartDate: "2024-11-01", AllocationEndDate: "2028-03-31", PctAllocation: "100", AllocationHour: "6000", AllocationType: "Hard", Role: "Architect",                 JobTitle: "Licensed Architect",    Division: "Buildings",      Department: "Architecture",        BillingRate: "165", EmpLaborRate: "85",  EmpCostRate: "105", ActualStartDate: "2024-11-01", ActualEndDate: "",           ActualHour: "",    BilledHours: "" },
    { Project: "Harbor View Tower",               Resource: "sarah.park@riverside.com",   AllocationStartDate: "2024-11-01", AllocationEndDate: "2028-03-31", PctAllocation: "50",  AllocationHour: "3000", AllocationType: "Hard", Role: "Project Manager",           JobTitle: "Senior PM",             Division: "Buildings",      Department: "Architecture",        BillingRate: "175", EmpLaborRate: "90",  EmpCostRate: "110", ActualStartDate: "2024-11-01", ActualEndDate: "2026-12-31", ActualHour: "1850", BilledHours: "1780" },
    { Project: "Harbor View Tower",               Resource: "ryan.okoye@riverside.com",   AllocationStartDate: "2024-11-01", AllocationEndDate: "2028-03-31", PctAllocation: "100", AllocationHour: "6000", AllocationType: "Hard", Role: "Junior Architect",          JobTitle: "Architect I",           Division: "Buildings",      Department: "Architecture",        BillingRate: "120", EmpLaborRate: "60",  EmpCostRate: "73",  ActualStartDate: "2024-11-01", ActualEndDate: "",           ActualHour: "",    BilledHours: "" },
    { Project: "Harbor View Tower",               Resource: "james.torres@riverside.com", AllocationStartDate: "2024-11-01", AllocationEndDate: "2025-06-30", PctAllocation: "100", AllocationHour: "1200", AllocationType: "Hard", Role: "Estimator",                 JobTitle: "Senior Estimator",      Division: "Buildings",      Department: "Preconstruction",     BillingRate: "145", EmpLaborRate: "72",  EmpCostRate: "88",  ActualStartDate: "2024-11-01", ActualEndDate: "2025-06-30", ActualHour: "1180", BilledHours: "1150" },
    { Project: "Northgate K-12 Campus Renovation",Resource: "lisa.wang@riverside.com",    AllocationStartDate: "2026-01-15", AllocationEndDate: "2027-08-31", PctAllocation: "80",  AllocationHour: "2400", AllocationType: "Hard", Role: "Architect",                 JobTitle: "Licensed Architect",    Division: "Buildings",      Department: "Architecture",        BillingRate: "165", EmpLaborRate: "85",  EmpCostRate: "105", ActualStartDate: "",           ActualEndDate: "",           ActualHour: "",    BilledHours: "" },
    { Project: "Northgate K-12 Campus Renovation",Resource: "ryan.okoye@riverside.com",   AllocationStartDate: "2026-01-15", AllocationEndDate: "2027-08-31", PctAllocation: "80",  AllocationHour: "2400", AllocationType: "Hard", Role: "Junior Architect",          JobTitle: "Architect I",           Division: "Buildings",      Department: "Architecture",        BillingRate: "120", EmpLaborRate: "60",  EmpCostRate: "73",  ActualStartDate: "",           ActualEndDate: "",           ActualHour: "",    BilledHours: "" },
    { Project: "Northgate K-12 Campus Renovation",Resource: "priya.sharma@riverside.com", AllocationStartDate: "2026-01-15", AllocationEndDate: "2027-08-31", PctAllocation: "60",  AllocationHour: "1800", AllocationType: "Soft", Role: "Junior Engineer",           JobTitle: "Engineer I",            Division: "Infrastructure", Department: "Civil Engineering",   BillingRate: "115", EmpLaborRate: "58",  EmpCostRate: "70",  ActualStartDate: "",           ActualEndDate: "",           ActualHour: "",    BilledHours: "" },
  ], PURPLE);

  // TAB 4: Open Positions (Demand)
  addSheet(wb, "Open Positions", [
    { header: "Division",     key: "Division",            width: 24 },
    { header: "Department",   key: "Department",           width: 24 },
    { header: "Role",         key: "Role",                width: 26 },
    { header: "Project",      key: "Project",             width: 38 },
    { header: "Start Date",   key: "AllocationStartDate", width: 14 },
    { header: "End Date",     key: "AllocationEndDate",   width: 14 },
    { header: "Allocation %", key: "PctAllocation",       width: 14 },
    { header: "Total Hours",  key: "AllocationHour",      width: 14 },
  ], [
    { Division: "Infrastructure", Department: "Civil Engineering",   Role: "Senior Civil Engineer",    Project: "City Center Bridge Retrofit",    AllocationStartDate: "2026-02-01", AllocationEndDate: "2027-06-30", PctAllocation: "100", AllocationHour: "" },
    { Division: "Infrastructure", Department: "Civil Engineering",   Role: "Junior Engineer",           Project: "Regional Transit Hub Expansion", AllocationStartDate: "2026-10-01", AllocationEndDate: "2029-12-31", PctAllocation: "100", AllocationHour: "" },
    { Division: "Infrastructure", Department: "Environmental",       Role: "Environmental Consultant",  Project: "Regional Transit Hub Expansion", AllocationStartDate: "2026-10-01", AllocationEndDate: "2028-06-30", PctAllocation: "60",  AllocationHour: "" },
    { Division: "Buildings",      Department: "Preconstruction",     Role: "Estimator",                 Project: "Affordable Housing Complex — Phase 3", AllocationStartDate: "2026-09-01", AllocationEndDate: "2027-03-31", PctAllocation: "100", AllocationHour: "1040" },
    { Division: "Buildings",      Department: "Architecture",        Role: "Architect",                 Project: "",                               AllocationStartDate: "2027-01-01", AllocationEndDate: "2027-12-31", PctAllocation: "100", AllocationHour: "" },
  ], AMBER);

  // TAB 5: Tasks
  addSheet(wb, "Tasks", [
    { header: "Project",       key: "Project",    width: 38 },
    { header: "Task Title",    key: "Title",      width: 34 },
    { header: "Description",   key: "Description",width: 40 },
    { header: "Stage",         key: "StageStep",  width: 18 },
    { header: "Due Date",      key: "DueDate",    width: 14 },
    { header: "Assigned To",   key: "AssignedTo", width: 28 },
    { header: "Status",        key: "Status",     width: 14 },
  ], [
    { Project: "City Center Bridge Retrofit",       Title: "Structural assessment report",        Description: "Complete full structural condition assessment", StageStep: "Design",        DueDate: "2025-11-30", AssignedTo: "marcus.reed@riverside.com",  Status: "In Progress" },
    { Project: "City Center Bridge Retrofit",       Title: "NEPA environmental clearance",        Description: "File for NEPA environmental clearance",        StageStep: "Pre-Design",    DueDate: "2025-10-15", AssignedTo: "claire.fox@riverside.com",   Status: "Completed" },
    { Project: "Harbor View Tower",                 Title: "Building permit submission",          Description: "Submit full permit package to city",           StageStep: "Permitting",    DueDate: "2025-09-30", AssignedTo: "lisa.wang@riverside.com",    Status: "In Progress" },
    { Project: "Northgate K-12 Campus Renovation",  Title: "Schematic design presentation",      Description: "Present SD package to school board",           StageStep: "Schematic Design",DueDate: "2026-03-01",AssignedTo: "lisa.wang@riverside.com",   Status: "Not Started" },
    { Project: "Regional Transit Hub Expansion",    Title: "Proposal narrative draft",            Description: "First draft of technical proposal",            StageStep: "Pursuit",       DueDate: "2026-06-30", AssignedTo: "david.chen@riverside.com",   Status: "Not Started" },
  ], BLUE);

  // TAB 6: Logged Hours
  addSheet(wb, "Logged Hours", [
    { header: "Project",       key: "Project",    width: 38 },
    { header: "Team Member",   key: "Resource",   width: 28 },
    { header: "Date",          key: "LogDate",    width: 14 },
    { header: "Hours",         key: "Hours",      width: 12 },
  ], [
    { Project: "City Center Bridge Retrofit",   Resource: "marcus.reed@riverside.com",  LogDate: "2025-09-01", Hours: "8" },
    { Project: "City Center Bridge Retrofit",   Resource: "marcus.reed@riverside.com",  LogDate: "2025-09-02", Hours: "8" },
    { Project: "City Center Bridge Retrofit",   Resource: "claire.fox@riverside.com",   LogDate: "2025-09-01", Hours: "6" },
    { Project: "Harbor View Tower",             Resource: "lisa.wang@riverside.com",    LogDate: "2025-09-01", Hours: "8" },
    { Project: "Harbor View Tower",             Resource: "ryan.okoye@riverside.com",   LogDate: "2025-09-01", Hours: "8" },
    { Project: "Harbor View Tower",             Resource: "james.torres@riverside.com", LogDate: "2025-09-01", Hours: "8" },
    { Project: "Harbor View Tower",             Resource: "james.torres@riverside.com", LogDate: "2025-09-02", Hours: "7.5" },
    { Project: "City Center Bridge Retrofit",   Resource: "sarah.park@riverside.com",   LogDate: "2025-09-01", Hours: "6.5" },
  ], TEAL);

  // TAB 7: Timesheets
  addSheet(wb, "Timesheets", [
    { header: "Team Member",   key: "Resource",       width: 28 },
    { header: "Week Start",    key: "WeekStartDate",  width: 14 },
    { header: "Total Hours",   key: "TotalHours",     width: 14 },
    { header: "Status",        key: "Status",         width: 14 },
  ], [
    { Resource: "david.chen@riverside.com",   WeekStartDate: "2025-09-01", TotalHours: "40", Status: "Approved" },
    { Resource: "sarah.park@riverside.com",   WeekStartDate: "2025-09-01", TotalHours: "38", Status: "Approved" },
    { Resource: "marcus.reed@riverside.com",  WeekStartDate: "2025-09-01", TotalHours: "40", Status: "Submitted" },
    { Resource: "lisa.wang@riverside.com",    WeekStartDate: "2025-09-01", TotalHours: "40", Status: "Approved" },
    { Resource: "claire.fox@riverside.com",   WeekStartDate: "2025-09-01", TotalHours: "24", Status: "Submitted" },
    { Resource: "ryan.okoye@riverside.com",   WeekStartDate: "2025-09-01", TotalHours: "40", Status: "Approved" },
    { Resource: "james.torres@riverside.com", WeekStartDate: "2025-09-01", TotalHours: "39.5", Status: "Approved" },
  ], PURPLE);

  // TAB 8: Service Requests
  addSheet(wb, "Service Requests", [
    { header: "Title",         key: "Title",       width: 34 },
    { header: "Description",   key: "Description", width: 40 },
    { header: "Status",        key: "Status",      width: 14 },
    { header: "Priority",      key: "Priority",    width: 14 },
    { header: "Assigned To",   key: "AssignedTo",  width: 28 },
    { header: "Created Date",  key: "CreatedDate", width: 16 },
  ], [
    { Title: "Update bridge load rating drawings",   Description: "Revised load rating drawings per DOT review comments", Status: "Open",       Priority: "High",   AssignedTo: "marcus.reed@riverside.com",  CreatedDate: "2025-09-10" },
    { Title: "Revise tower floor plan — level 14",   Description: "Client requested office layout change on floor 14",    Status: "In Progress",Priority: "Medium", AssignedTo: "ryan.okoye@riverside.com",   CreatedDate: "2025-09-05" },
    { Title: "NEPA supplemental documentation",      Description: "Supplemental materials requested by FHWA reviewer",    Status: "Open",       Priority: "High",   AssignedTo: "claire.fox@riverside.com",   CreatedDate: "2025-09-12" },
  ], AMBER);

  // TAB 9: Action Requests
  addSheet(wb, "Action Requests", [
    { header: "Title",         key: "Title",        width: 34 },
    { header: "Request Type",  key: "RequestType",  width: 20 },
    { header: "Status",        key: "Status",       width: 14 },
    { header: "Requested By",  key: "RequestedBy",  width: 28 },
    { header: "Created Date",  key: "CreatedDate",  width: 16 },
  ], [
    { Title: "Change order — additional pier inspection",  RequestType: "Change Order",  Status: "Approved",  RequestedBy: "david.chen@riverside.com",  CreatedDate: "2025-09-08" },
    { Title: "Fee amendment — scope addition floor 15–20", RequestType: "Fee Amendment", Status: "Pending",   RequestedBy: "lisa.wang@riverside.com",   CreatedDate: "2025-09-14" },
  ], GREEN);

  // TAB 10: Portfolio
  addSheet(wb, "Portfolio", [
    { header: "Initiative",    key: "Title",           width: 34 },
    { header: "Company",       key: "CompanyName",     width: 30 },
    { header: "Status",        key: "Status",          width: 14 },
    { header: "Start Date",    key: "TargetStartDate", width: 14 },
    { header: "End Date",      key: "TargetEndDate",   width: 14 },
  ], [
    { Title: "Public Infrastructure Renewal Programme", CompanyName: "Metro City Dept of Transportation", Status: "Active", TargetStartDate: "2025-01-01", TargetEndDate: "2028-12-31" },
    { Title: "Sustainable Urban Development",           CompanyName: "Pacific Development Group",         Status: "Active", TargetStartDate: "2024-06-01", TargetEndDate: "2029-06-30" },
  ], BLUE);

  await wb.xlsx.writeFile(path.join(OUT, "test-multi-tab.xlsx"));
  console.log("✅  test-multi-tab.xlsx");
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILE 3 — test-different.xlsx — All different tab names & column names
//           (tests synonym matching + content-scoring + tab-name detection)
// ═══════════════════════════════════════════════════════════════════════════════
async function buildDifferentFormat() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RM ONE Onboarding Test";

  // TAB: "Staff Roster" → synonym → team
  // Columns use alternate names that should map via the synonym map
  addSheet(wb, "Staff Roster", [
    { header: "Team / Division",       key: "Division",     width: 22 },  // → Division
    { header: "Program Group",         key: "Department",    width: 22 },  // → Department
    { header: "Position",              key: "Role",         width: 22 },  // → Role (via "position" synonym)
    { header: "Billing $/hr",          key: "BillingRate",  width: 14 },  // → BillingRate (via "billing rate")
    { header: "Pay Rate",              key: "EmpLaborRate", width: 14 },  // → EmpLaborRate
    { header: "Loaded Cost",           key: "EmpCostRate",  width: 14 },  // → EmpCostRate (via "cost rate")
    { header: "Job Classification",    key: "JobTitle",     width: 22 },  // → JobTitle
    { header: "Work Email",            key: "UserName",     width: 28 },  // → UserName (via "work email")
    { header: "Display Name",          key: "FullName",     width: 22 },  // → Name (via "display name")
    { header: "Given Name",            key: "FirstName",    width: 18 },  // → FirstName
    { header: "Surname",               key: "LastName",     width: 18 },  // → LastName
    { header: "Contact Email",         key: "Email",        width: 28 },  // → Email
    { header: "Temp Password",         key: "Password",     width: 16 },  // → Password
    { header: "System Role",           key: "UserRole",     width: 14 },  // → UserRole (via "access level")
    { header: "Reports To",            key: "Manager",      width: 28 },  // → ManagerUser (via "reports to")
    { header: "Hire Date",             key: "StartDate",    width: 14 },  // → UGITStartDate
    { header: "Exit Date",             key: "EndDate",      width: 14 },  // → UGITEndDate
    { header: "Manages Others",        key: "IsManager",    width: 14 },  // → IsManager
  ], [
    { Division: "Infrastructure", Department: "Civil",          Role: "Principal Engineer",   BillingRate: "210", EmpLaborRate: "110", EmpCostRate: "135", JobTitle: "Principal Engineer",    UserName: "d.chen@rpe.com",   FullName: "David Chen",   FirstName: "David",  LastName: "Chen",   Email: "d.chen@rpe.com",   Password: "Temp!2026", UserRole: "Admin",   Manager: "",                  StartDate: "2018-03-01", EndDate: "",           IsManager: "1" },
    { Division: "Infrastructure", Department: "Project Mgmt",   Role: "Project Manager",      BillingRate: "175", EmpLaborRate: "90",  EmpCostRate: "110", JobTitle: "Senior PM",            UserName: "s.park@rpe.com",   FullName: "Sarah Park",   FirstName: "Sarah",  LastName: "Park",   Email: "s.park@rpe.com",   Password: "Temp!2026", UserRole: "Manager", Manager: "d.chen@rpe.com",    StartDate: "2020-07-15", EndDate: "",           IsManager: "1" },
    { Division: "Infrastructure", Department: "Civil",          Role: "Senior Engineer",      BillingRate: "155", EmpLaborRate: "78",  EmpCostRate: "95",  JobTitle: "Senior Civil Eng.",     UserName: "m.reed@rpe.com",   FullName: "Marcus Reed",  FirstName: "Marcus", LastName: "Reed",   Email: "m.reed@rpe.com",   Password: "Temp!2026", UserRole: "User",    Manager: "s.park@rpe.com",    StartDate: "2021-11-01", EndDate: "",           IsManager: "0" },
    { Division: "Buildings",      Department: "Architecture",   Role: "Architect",            BillingRate: "165", EmpLaborRate: "85",  EmpCostRate: "105", JobTitle: "Licensed Architect",    UserName: "l.wang@rpe.com",   FullName: "Lisa Wang",    FirstName: "Lisa",   LastName: "Wang",   Email: "l.wang@rpe.com",   Password: "Temp!2026", UserRole: "Manager", Manager: "d.chen@rpe.com",    StartDate: "2019-04-01", EndDate: "",           IsManager: "0" },
    { Division: "Buildings",      Department: "Preconstruction",Role: "Estimator",            BillingRate: "145", EmpLaborRate: "72",  EmpCostRate: "88",  JobTitle: "Senior Estimator",      UserName: "j.torres@rpe.com", FullName: "James Torres", FirstName: "James",  LastName: "Torres", Email: "j.torres@rpe.com", Password: "Temp!2026", UserRole: "User",    Manager: "d.chen@rpe.com",    StartDate: "2022-09-12", EndDate: "",           IsManager: "0" },
    { Division: "Infrastructure", Department: "Environmental",  Role: "Environmental Consult",BillingRate: "140", EmpLaborRate: "70",  EmpCostRate: "85",  JobTitle: "Env. Specialist",       UserName: "c.fox@rpe.com",    FullName: "Claire Fox",   FirstName: "Claire", LastName: "Fox",    Email: "c.fox@rpe.com",    Password: "Temp!2026", UserRole: "User",    Manager: "s.park@rpe.com",    StartDate: "2023-02-14", EndDate: "",           IsManager: "0" },
  ], TEAL);

  // TAB: "Jobs & Leads" → resolveSimplifiedTab → content detection → PMM/Opportunity
  // Columns use entirely different names — tests synonym map thoroughly
  addSheet(wb, "Jobs & Leads", [
    { header: "Record Type",           key: "Type",                       width: 14 },  // → Type (Project/Opportunity/Lead)
    { header: "Client Organization",   key: "CompanyName",                width: 32 },  // → CompanyName
    { header: "Key Contacts",          key: "ContactName",                width: 34 },  // → ContactName
    { header: "Account Rep",           key: "ClientRep",                  width: 26 },  // → ClientRep
    { header: "Relationship Health",   key: "CRMHealth",                  width: 18 },  // → CRMHealth
    { header: "Industry",              key: "MarketSector",               width: 22 },  // → MarketSector
    { header: "Job Name",              key: "ProjectTitle",               width: 38 },  // → Title (via "job name")
    { header: "Job Number",            key: "ERPJobID",                   width: 14 },  // → ERPJobID
    { header: "Delivery Method",       key: "ProjectType",                width: 18 },  // → ProjectType
    { header: "Discipline",            key: "ServiceType",                width: 18 },  // → ServiceType
    { header: "Fee ($)",               key: "ContractValue",              width: 16 },  // → ContractValue
    { header: "GMP",                   key: "ContractLimit",              width: 16 },  // → ContractLimit
    { header: "Margin %",              key: "GrossMargin",                width: 14 },  // → GrossMargin
    { header: "Fee Type",              key: "ContractType",               width: 14 },  // → ContractType
    { header: "Win Prob %",            key: "ChanceOfSuccessChoice",      width: 16 },  // → ChanceOfSuccessChoice
    { header: "Stage",                 key: "Status",                     width: 14 },  // → Status
    { header: "BU",                    key: "CRMBusinessUnitChoice",      width: 20 },  // → CRMBusinessUnitChoice
    { header: "Team",                  key: "Division",                   width: 20 },  // → Division
    { header: "Program",               key: "Department",                  width: 20 },  // → Department
    { header: "Notice to Proceed",     key: "StartDate",                  width: 16 },  // → StartDate
    { header: "Substantial Completion",key: "EndDate",                    width: 20 },  // → EndDate
    { header: "Bid Date",              key: "ProposalPhaseDueDate",       width: 14 },  // → ProposalPhaseDueDate
    { header: "Constr. NTP",           key: "ConstStartDate",             width: 14 },  // → ConstStartDate
    { header: "Constr. Complete",      key: "EstimatedConstructionEnd",   width: 18 },  // → EstimatedConstructionEnd
    { header: "Approx Budget",         key: "ApproxContractValue",        width: 16 },  // → ApproxContractValue
    { header: "Labor Portion",         key: "LaborContractAmount",        width: 16 },  // → LaborContractAmount
    { header: "Market Niche",          key: "SectorChoice",               width: 18 },  // → SectorChoice
    { header: "Client Contact",        key: "PointOfContact",             width: 24 },  // → PointOfContact
    { header: "Lead",                  key: "ProjectLeadUser",            width: 28 },  // → ProjectLeadUser
    { header: "PM",                    key: "ProjectManagerUser",         width: 28 },  // → ProjectManagerUser (via "pm")
    { header: "Sr PM",                 key: "SeniorProjectManagerUser",   width: 28 },  // → SeniorProjectManagerUser
    { header: "BD Lead",               key: "BusinessLeadUser",           width: 28 },  // → BusinessLeadUser (via "business lead")
    { header: "Lead Estimator",        key: "LeadEstimatorUser",          width: 28 },  // → LeadEstimatorUser
    { header: "Superintendent",        key: "LeadSuperintendentUser",     width: 28 },  // → LeadSuperintendentUser (via "superintendent")
    { header: "Estimator",             key: "EstimatorUser",              width: 28 },  // → EstimatorUser
    { header: "Proposal Due",          key: "BidDueDate",                 width: 14 },  // → BidDueDate
    { header: "Opp Status",            key: "CRMOpportunityStatusChoice", width: 18 },  // → CRMOpportunityStatusChoice
  ], [
    { Type: "Project",     CompanyName: "Metro City Dept of Transportation", ContactName: "Helen Cho; Robert Marsh",  ClientRep: "d.chen@rpe.com", CRMHealth: "Good", MarketSector: "Transportation", ProjectTitle: "City Center Bridge Retrofit",        ERPJobID: "RVS-1001", ProjectType: "Design-Build",  ServiceType: "Structural",   ContractValue: "6200000",  ContractLimit: "6500000",   GrossMargin: "34", ContractType: "T&M",   ChanceOfSuccessChoice: "",   Status: "Active", CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Civil",          StartDate: "2025-08-01", EndDate: "2027-06-30", ProposalPhaseDueDate: "",         ConstStartDate: "2026-02-01", EstimatedConstructionEnd: "2027-05-31", ApproxContractValue: "6000000",  LaborContractAmount: "4200000", SectorChoice: "Transportation", PointOfContact: "Helen Cho",    ProjectLeadUser: "d.chen@rpe.com",   ProjectManagerUser: "s.park@rpe.com",   SeniorProjectManagerUser: "d.chen@rpe.com", BusinessLeadUser: "d.chen@rpe.com",  LeadEstimatorUser: "",             LeadSuperintendentUser: "",   EstimatorUser: "",            BidDueDate: "",           CRMOpportunityStatusChoice: "" },
    { Type: "Project",     CompanyName: "Pacific Development Group",         ContactName: "Monica Silver",            ClientRep: "l.wang@rpe.com", CRMHealth: "Good", MarketSector: "Construction",   ProjectTitle: "Harbor View Tower",                  ERPJobID: "RVS-1002", ProjectType: "Construction",  ServiceType: "Architecture", ContractValue: "14500000", ContractLimit: "",          GrossMargin: "29", ContractType: "Fixed", ChanceOfSuccessChoice: "",   Status: "Active", CRMBusinessUnitChoice: "Buildings BU",      Division: "Buildings",      Department: "Architecture",   StartDate: "2024-11-01", EndDate: "2028-03-31", ProposalPhaseDueDate: "",         ConstStartDate: "2025-07-01", EstimatedConstructionEnd: "2027-12-31", ApproxContractValue: "15000000", LaborContractAmount: "9800000", SectorChoice: "Construction",   PointOfContact: "Monica Silver",ProjectLeadUser: "l.wang@rpe.com",   ProjectManagerUser: "s.park@rpe.com",   SeniorProjectManagerUser: "d.chen@rpe.com", BusinessLeadUser: "l.wang@rpe.com",  LeadEstimatorUser: "j.torres@rpe.com", LeadSuperintendentUser: "",  EstimatorUser: "j.torres@rpe.com", BidDueDate: "",           CRMOpportunityStatusChoice: "" },
    { Type: "Opportunity", CompanyName: "Bay Area Regional Transit",         ContactName: "Tom Nguyen; Diana Reyes",  ClientRep: "d.chen@rpe.com", CRMHealth: "Fair", MarketSector: "Transportation", ProjectTitle: "Regional Transit Hub Expansion",      ERPJobID: "OPP-3001", ProjectType: "Design",        ServiceType: "Civil Eng.",   ContractValue: "22000000", ContractLimit: "",          GrossMargin: "38", ContractType: "",      ChanceOfSuccessChoice: "70", Status: "Active", CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Civil",          StartDate: "2026-10-01", EndDate: "2030-12-31", ProposalPhaseDueDate: "2026-07-30", ConstStartDate: "",           EstimatedConstructionEnd: "2030-06-30", ApproxContractValue: "22000000", LaborContractAmount: "15000000",SectorChoice: "Transportation", PointOfContact: "Tom Nguyen",   ProjectLeadUser: "d.chen@rpe.com",   ProjectManagerUser: "d.chen@rpe.com",   SeniorProjectManagerUser: "d.chen@rpe.com", BusinessLeadUser: "d.chen@rpe.com",  LeadEstimatorUser: "j.torres@rpe.com", LeadSuperintendentUser: "",  EstimatorUser: "j.torres@rpe.com", BidDueDate: "2026-07-15", CRMOpportunityStatusChoice: "Proposal" },
    { Type: "Opportunity", CompanyName: "Coastal Housing Authority",         ContactName: "Sandra Brooks",            ClientRep: "l.wang@rpe.com", CRMHealth: "Poor", MarketSector: "Housing",        ProjectTitle: "Affordable Housing Complex — Phase 3", ERPJobID: "OPP-3002", ProjectType: "Design-Build",  ServiceType: "Architecture", ContractValue: "9500000",  ContractLimit: "",          GrossMargin: "33", ContractType: "",      ChanceOfSuccessChoice: "45", Status: "Active", CRMBusinessUnitChoice: "Buildings BU",      Division: "Buildings",      Department: "Architecture",   StartDate: "2027-01-01", EndDate: "2029-06-30", ProposalPhaseDueDate: "2026-10-15", ConstStartDate: "",           EstimatedConstructionEnd: "2029-03-31", ApproxContractValue: "9000000",  LaborContractAmount: "6500000", SectorChoice: "Housing",        PointOfContact: "Sandra Brooks",ProjectLeadUser: "l.wang@rpe.com",   ProjectManagerUser: "l.wang@rpe.com",   SeniorProjectManagerUser: "d.chen@rpe.com", BusinessLeadUser: "l.wang@rpe.com",  LeadEstimatorUser: "j.torres@rpe.com", LeadSuperintendentUser: "",  EstimatorUser: "j.torres@rpe.com", BidDueDate: "2026-10-01", CRMOpportunityStatusChoice: "Qualification" },
    { Type: "Lead",        CompanyName: "Greenfield Municipal Airport",       ContactName: "Frank Webber",             ClientRep: "d.chen@rpe.com", CRMHealth: "Good", MarketSector: "Aviation",       ProjectTitle: "Airport Terminal Modernisation",      ERPJobID: "LEM-4001", ProjectType: "Design",        ServiceType: "Architecture", ContractValue: "35000000", ContractLimit: "",          GrossMargin: "42", ContractType: "",      ChanceOfSuccessChoice: "30", Status: "Active", CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Civil",          StartDate: "2027-06-01", EndDate: "2031-12-31", ProposalPhaseDueDate: "2027-02-28", ConstStartDate: "",           EstimatedConstructionEnd: "",           ApproxContractValue: "35000000", LaborContractAmount: "",        SectorChoice: "Aviation",       PointOfContact: "Frank Webber", ProjectLeadUser: "d.chen@rpe.com",   ProjectManagerUser: "",                 SeniorProjectManagerUser: "",               BusinessLeadUser: "d.chen@rpe.com",  LeadEstimatorUser: "j.torres@rpe.com", LeadSuperintendentUser: "",  EstimatorUser: "",                 BidDueDate: "2027-02-15", CRMOpportunityStatusChoice: "Prospecting" },
  ], GREEN);

  // TAB: "Resource Loading" → resolveSimplifiedTab → content detection → ResourceWorkItems/ResourceAllocation
  addSheet(wb, "Resource Loading", [
    { header: "Job Name",          key: "Project",             width: 38 },  // → Project
    { header: "Person (Email)",    key: "Resource",            width: 28 },  // → Resource
    { header: "From",              key: "AllocationStartDate", width: 14 },  // → AllocationStartDate
    { header: "Until",             key: "AllocationEndDate",   width: 14 },  // → AllocationEndDate
    { header: "Load %",            key: "PctAllocation",       width: 12 },  // → PctAllocation
    { header: "Planned Hrs",       key: "AllocationHour",      width: 14 },  // → AllocationHour
    { header: "Commitment",        key: "AllocationType",      width: 14 },  // → AllocationType (Hard/Soft)
    { header: "Seniority",         key: "Role",                width: 24 },  // → Role
    { header: "Grade",             key: "JobTitle",            width: 24 },  // → JobTitle
    { header: "Practice",          key: "Division",            width: 22 },  // → Division
    { header: "Sub-Group",         key: "Department",           width: 22 },  // → Department
    { header: "Actual From",       key: "ActualStartDate",     width: 14 },  // → ActualStartDate
    { header: "Actual Until",      key: "ActualEndDate",       width: 14 },  // → ActualEndDate
    { header: "Hrs Delivered",     key: "ActualHour",          width: 14 },  // → ActualHour
    { header: "Hrs Invoiced",      key: "BilledHours",         width: 14 },  // → BilledHours
  ], [
    { Project: "City Center Bridge Retrofit",     Resource: "d.chen@rpe.com",   AllocationStartDate: "2025-08-01", AllocationEndDate: "2027-06-30", PctAllocation: "100", AllocationHour: "3200", AllocationType: "Hard", Role: "Principal Engineer",        JobTitle: "Principal Engineer",    Division: "Infrastructure", Department: "Civil",          ActualStartDate: "2025-08-01", ActualEndDate: "",           ActualHour: "",    BilledHours: "" },
    { Project: "City Center Bridge Retrofit",     Resource: "s.park@rpe.com",   AllocationStartDate: "2025-08-01", AllocationEndDate: "2027-06-30", PctAllocation: "80",  AllocationHour: "2560", AllocationType: "Hard", Role: "Project Manager",           JobTitle: "Senior PM",             Division: "Infrastructure", Department: "Project Mgmt",   ActualStartDate: "2025-08-01", ActualEndDate: "",           ActualHour: "",    BilledHours: "" },
    { Project: "City Center Bridge Retrofit",     Resource: "m.reed@rpe.com",   AllocationStartDate: "2025-08-01", AllocationEndDate: "2027-06-30", PctAllocation: "60",  AllocationHour: "1920", AllocationType: "Hard", Role: "Senior Engineer",           JobTitle: "Senior Civil Eng.",     Division: "Infrastructure", Department: "Civil",          ActualStartDate: "2025-08-01", ActualEndDate: "",           ActualHour: "",    BilledHours: "" },
    { Project: "Harbor View Tower",               Resource: "l.wang@rpe.com",   AllocationStartDate: "2024-11-01", AllocationEndDate: "2028-03-31", PctAllocation: "100", AllocationHour: "6000", AllocationType: "Hard", Role: "Architect",                 JobTitle: "Licensed Architect",    Division: "Buildings",      Department: "Architecture",   ActualStartDate: "2024-11-01", ActualEndDate: "",           ActualHour: "",    BilledHours: "" },
    { Project: "Harbor View Tower",               Resource: "s.park@rpe.com",   AllocationStartDate: "2024-11-01", AllocationEndDate: "2028-03-31", PctAllocation: "50",  AllocationHour: "3000", AllocationType: "Hard", Role: "Project Manager",           JobTitle: "Senior PM",             Division: "Buildings",      Department: "Architecture",   ActualStartDate: "2024-11-01", ActualEndDate: "2026-12-31", ActualHour: "1850", BilledHours: "1780" },
    { Project: "Harbor View Tower",               Resource: "j.torres@rpe.com", AllocationStartDate: "2024-11-01", AllocationEndDate: "2025-06-30", PctAllocation: "100", AllocationHour: "1200", AllocationType: "Hard", Role: "Estimator",                 JobTitle: "Senior Estimator",      Division: "Buildings",      Department: "Preconstruction",ActualStartDate: "2024-11-01", ActualEndDate: "2025-06-30", ActualHour: "1180", BilledHours: "1150" },
    { Project: "City Center Bridge Retrofit",     Resource: "c.fox@rpe.com",    AllocationStartDate: "2025-09-01", AllocationEndDate: "2026-06-30", PctAllocation: "40",  AllocationHour: "640",  AllocationType: "Soft", Role: "Environmental Consult",     JobTitle: "Env. Specialist",       Division: "Infrastructure", Department: "Environmental",  ActualStartDate: "",           ActualEndDate: "",           ActualHour: "",    BilledHours: "" },
  ], PURPLE);

  // TAB: "Headcount Needed" → pipeline synonym → ResourceAllocation (demand / no-resource rows)
  addSheet(wb, "Headcount Needed", [
    { header: "Practice",      key: "Division",            width: 24 },  // → Division
    { header: "Sub-Group",     key: "Department",           width: 24 },  // → Department
    { header: "Position Needed",key: "Role",               width: 26 },  // → Role
    { header: "Job Name",      key: "Project",             width: 38 },  // → Project
    { header: "Need From",     key: "AllocationStartDate", width: 14 },  // → AllocationStartDate
    { header: "Need Until",    key: "AllocationEndDate",   width: 14 },  // → AllocationEndDate
    { header: "FTE %",         key: "PctAllocation",       width: 12 },  // → PctAllocation
  ], [
    { Division: "Infrastructure", Department: "Civil",           Role: "Senior Civil Engineer",     Project: "City Center Bridge Retrofit",    AllocationStartDate: "2026-02-01", AllocationEndDate: "2027-06-30", PctAllocation: "100" },
    { Division: "Infrastructure", Department: "Civil",           Role: "Junior Engineer",           Project: "Regional Transit Hub Expansion", AllocationStartDate: "2026-10-01", AllocationEndDate: "2029-12-31", PctAllocation: "100" },
    { Division: "Infrastructure", Department: "Environmental",   Role: "Environmental Consultant",  Project: "Regional Transit Hub Expansion", AllocationStartDate: "2026-10-01", AllocationEndDate: "2028-06-30", PctAllocation: "60"  },
    { Division: "Buildings",      Department: "Preconstruction", Role: "Estimator",                 Project: "Harbor View Tower",              AllocationStartDate: "2026-01-01", AllocationEndDate: "2027-06-30", PctAllocation: "100" },
    { Division: "Buildings",      Department: "Architecture",    Role: "Licensed Architect",        Project: "",                               AllocationStartDate: "2027-01-01", AllocationEndDate: "2027-12-31", PctAllocation: "100" },
  ], AMBER);

  // TAB: "Work Log" → synonym for TicketHours (logged hours)
  addSheet(wb, "Work Log", [
    { header: "Project",     key: "Project",  width: 38 },  // → Project (TicketId via title lookup)
    { header: "Employee",    key: "Resource", width: 28 },  // → ResourceID
    { header: "Date",        key: "LogDate",  width: 14 },  // → LogDate
    { header: "Hrs",         key: "Hours",    width: 10 },  // → Hours
  ], [
    { Project: "City Center Bridge Retrofit",   Resource: "m.reed@rpe.com",   LogDate: "2025-09-01", Hours: "8"   },
    { Project: "City Center Bridge Retrofit",   Resource: "m.reed@rpe.com",   LogDate: "2025-09-02", Hours: "8"   },
    { Project: "City Center Bridge Retrofit",   Resource: "c.fox@rpe.com",    LogDate: "2025-09-01", Hours: "6"   },
    { Project: "Harbor View Tower",             Resource: "l.wang@rpe.com",   LogDate: "2025-09-01", Hours: "8"   },
    { Project: "Harbor View Tower",             Resource: "j.torres@rpe.com", LogDate: "2025-09-01", Hours: "8"   },
    { Project: "Harbor View Tower",             Resource: "j.torres@rpe.com", LogDate: "2025-09-02", Hours: "7.5" },
  ], TEAL);

  await wb.xlsx.writeFile(path.join(OUT, "test-different.xlsx"));
  console.log("✅  test-different.xlsx");
}

// Run all three
Promise.all([buildSingleTab(), buildMultiTab(), buildDifferentFormat()])
  .then(() => console.log("\n🎉  All 3 test files generated!"))
  .catch(err => { console.error(err); process.exit(1); });
