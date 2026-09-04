// ── Grid → server explicit column handoff ────────────────────────────────────
// The import grid re-exports its data as an XLSX whose headers are the grid's
// column LABELS. Historically /run was called with columnMappings: {} and the
// server re-derived every column's meaning from its synonym dictionaries — a
// second guess that could disagree with what the grid displayed (Aug 2026:
// "Project / Opp ID" was unknown server-side, the ID column was silently
// dropped, and 325 assignment rows linked to the wrong record by title).
//
// This table is the grid's authoritative statement of what each of its own
// columns means, keyed exactly the way the server's /run remap expects:
//   { sheetName: { exported header → server canonical field } }
// It was GENERATED from the server's own resolvers (resolveSimplifiedTab +
// analyzeSimplifiedColumns) — every entry is the same destination the server
// already picks today, just pinned explicitly so dictionary drift can never
// re-route grid submissions. The api-server "synonym-map" check re-derives
// this table on every run and fails on any mismatch (section f of
// scripts/check-synonym-mapping.ts) — DO NOT hand-edit values here without
// running that check.
//
// Deliberately ABSENT (kept on the server's legacy resolution path):
//  • "Schedule" sheets — they never route through the simplified tabs; the
//    schedule importer has its own header handling.
//  • Labels the server cannot resolve today (e.g. Staff "Created On",
//    Leads "Lead ID") — inventing a destination here would claim support the
//    write path doesn't have. The parity check lists these explicitly.
//  • Same-destination pairs (Leads/Opportunities "Stage" + "Status" both mean
//    Status): pre-renaming both would collapse two columns into one row key
//    and one value would clobber the other. The pipeline's rank-based
//    duplicate-column winner handles these correctly at expansion time.

export const SERVER_FIELD_BY_SHEET: Record<string, Record<string, string>> = {
  "Projects": {
    "Project ID": "ProjectId",
    "Project Title": "ProjectTitle",
    "Company Name": "CompanyName",
    "Company ID": "CompanyId",
    "Contact Name": "OwnerName",
    "Owner's Rep": "OwnersRepresentative",
    "Business Lead": "BusinessLeadUser",
    "Project Manager": "ProjectManagerUser",
    "Sr Project Manager": "SeniorProjectManagerUser",
    "Short Name": "ShortName",
    "Market Sector": "MarketSector",
    "Project Type": "ProjectType",
    "Service Type": "ServiceType",
    "Category": "Category",
    "Business Unit": "CRMBusinessUnitChoice",
    "Division": "Division",
    "Department": "Department",
    "Status": "Status",
    "Target Start Date": "TargetStartDate",
    "Target End Date": "TargetCompletionDate",
    "Closeout Date": "CloseoutDate",
    "Created On": "Created",
    "Contract Value": "ContractValue",
    "Labor Budget": "LaborContractAmount",
    "Gross Margin": "GrossMargin",
    "Contract Type": "ContractType",
    "Contracted Amount": "ContractedAmount",
    "Proposal Amount": "ProposalAmount",
    "Bid Amount": "BidAmount",
    "Change Orders": "ChangeOrders",
    "Approved Change Orders": "ApprovedChangeOrders",
    "Retainage": "Retainage",
    "Fee %": "FeePct",
    "Contingency": "Contingency",
    "Non-Operating Cost": "NonOperatingCost",
    "Total Project Cost": "ProjectCost",
    "% Complete": "ProjectPhasePctComplete",
    "Priority": "PriorityLookup",
    "Next Milestone": "NextMilestone",
    "Next Milestone Date": "NextMilestoneDate",
    "Description": "Description",
    "Notes": "ProjectSummaryNote",
    "Street Address": "StreetAddress1",
    "City": "City",
    "State": "StateLookup",
    "Office": "Office",
    "From Opportunity": "LinkedOpportunity",
    "Bid Due Date": "BidDueDate",
    "Retainage Percent": "RetainageChoice",
    "Actual Project Cost": "ActualProjectCost",
    "Forecasted Project Cost": "ForecastedProjectCost",
    "Groups": "Groups",
  },
  "Staff": {
    "Full Name": "FullName",
    "Login Email": "UserName",
    "Phone Number": "PhoneNumber",
    "Business Unit": "CRMBusinessUnitChoice",
    "Division": "Division",
    "Department": "Department",
    "Role": "Role",
    "Job Title": "JobTitle",
    "Manager": "Manager",
    "Access Level": "UserRole",
    "Start Date": "StartDate",
    "End Date": "EndDate",
    "Employee Type": "EmployeeType",
    "Employee ID": "EmployeeId",
    "Skills": "Skills",
    "Experience Tags": "ExperienceTags",
    "Groups": "Groups",
  },
  "Team Assignments": {
    "Project / Opp ID": "TicketId",
    "Project": "Project",
    "Name": "FullName",
    "Email": "Email",
    "Employee ID": "EmployeeId",
    "Start Date": "StartDate",
    "End Date": "EndDate",
    "Total Hours": "AllocationHour",
    "Allocation %": "PctAllocation",
    "Type": "AllocationType",
    "Role": "Role",
    "Job Title": "JobTitle",
    "Business Unit": "CRMBusinessUnitChoice",
    "Division": "Division",
    "Department": "Department",
    "Billing Rate": "BillingRate",
    "Labor Rate": "EmpLaborRate",
    "Cost Rate": "EmpCostRate",
    "Billed Hours": "BilledHours",
    "Soft Allocation": "SoftAllocation",
    "Non Chargeable": "NonChargeable",
    "Is Locked": "IsLocked",
    "Access Level": "UserRole",
  },
  "Opportunities": {
    "Opportunity ID": "ERPJobID",
    "Opportunity Title": "ProjectTitle",
    "Project Category": "RequestCategory",
    "Company Name": "CompanyName",
    "Company ID": "CompanyId",
    "Contact Name": "OwnerName",
    "Business Lead": "BusinessLeadUser",
    "Project Manager": "ProjectManagerUser",
    "Sr Project Manager": "SeniorProjectManagerUser",
    "Chance of Success": "ChanceOfSuccessChoice",
    "% Complete": "ProjectPhasePctComplete",
    "Market Sector": "MarketSector",
    "Business Unit": "CRMBusinessUnitChoice",
    "Division": "Division",
    "Department": "Department",
    "Target Start": "TargetStartDate",
    "Target End": "TargetCompletionDate",
    "Created On": "Created",
    "Approx Contract Value": "ApproxContractValue",
    "Forecasted Project Cost": "ForecastedProjectCost",
    "Labor Contract Amount": "LaborContractAmount",
    "Non-Operating Cost": "NonOperatingCost",
    "Gross Margin": "GrossMargin",
    "Contract Type": "ContractType",
    "Description": "Description",
    "Notes": "ProjectSummaryNote",
    "Point of Contact": "PointOfContact",
    "Office": "Office",
    "Groups": "Groups",
    "Access Level": "UserRole",
  },
  "Leads": {
    "Lead Name": "ProjectTitle",
    "Company Name": "CompanyName",
    "Company ID": "CompanyId",
    "Contact Name": "OwnerName",
    "Market Sector": "MarketSector",
    "Project Category": "RequestCategory",
    "Business Unit": "CRMBusinessUnitChoice",
    "Division": "Division",
    "Department": "Department",
    "Office": "Office",
    "Address": "StreetAddress1",
    "City": "City",
    "State": "StateLookup",
    "Target Start": "TargetStartDate",
    "Target End": "TargetCompletionDate",
    "Created On": "Created",
    "Description": "Description",
    "Notes": "ProjectSummaryNote",
  },
  "Companies": {
    "Company Name": "CompanyName",
    "Company ID": "CompanyId",
    "Abbreviated Name": "ShortName",
    "Relationship Type": "RelationshipType",
    "Business Type": "BusinessType",
    "Secondary Business Type": "SecondaryBusinessType",
    "Industry": "MarketSector",
    "CRM Health": "CRMHealth",
    "Contact Name": "OwnerName",
    "Phone": "PhoneNumber",
    "Fax": "Fax",
    "Address": "StreetAddress1",
    "Street 2": "StreetAddress2",
    "City": "City",
    "State": "StateLookup",
    "Zip": "Zip",
    "Assigned To": "OwnerUser",
    "Client Rep": "ClientRep",
    "Division": "Division",
    "Description": "Description",
    "Created On": "Created",
  },
};

// Which server tab each grid sheet is processed under TODAY (verified by the
// synonym-map parity check against the server's own content scoring of the
// raw labels). Sent as /run tabTypeOverrides so the server's per-sheet
// analysis never has to re-guess, and used to derive the upload-level
// forcedTabType pin below.
export const SHEET_SERVER_TAB: Record<string, "team" | "clients"> = {
  "Projects": "clients",
  "Opportunities": "clients",
  "Leads": "clients",
  "Companies": "clients",
  "Staff": "team",
  "Team Assignments": "team",
};

/** Build the per-sheet header→server-field map for a grid submission.
 *  Only sheets and labels the table covers are included — anything else keeps
 *  the server's existing resolution path. */
export function buildGridColumnMappings(
  sheets: Array<{ sheetName: string; cols: Array<{ label: string }> }>,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const s of sheets) {
    const table = SERVER_FIELD_BY_SHEET[s.sheetName];
    if (!table) continue;
    const m: Record<string, string> = {};
    for (const c of s.cols) {
      const dest = table[c.label];
      if (dest) m[c.label] = dest;
    }
    if (Object.keys(m).length > 0) out[s.sheetName] = m;
  }
  return out;
}

/** Per-sheet tab overrides for /run — the grid's own statement of what each
 *  sheet is, so server-side analysis of any remaining unmapped columns runs
 *  against the right tab's dictionary. */
export function buildTabTypeOverrides(
  mappings: Record<string, Record<string, string>>,
): Record<string, "team" | "clients"> {
  const out: Record<string, "team" | "clients"> = {};
  for (const sheetName of Object.keys(mappings)) {
    const tab = SHEET_SERVER_TAB[sheetName];
    if (tab) out[sheetName] = tab;
  }
  return out;
}

/** Upload-level tab pin for grid submissions. After the explicit renames the
 *  headers are canonical DB column names, which makes the server's
 *  "standard DB dump" guard skip content routing for some sheets — the job's
 *  forcedTabType is the documented fallback that keeps them on the simplified
 *  path. The main sheet decides: record-type sheets pin "clients", pure
 *  staffing submissions pin "team". (Team Assignments / Schedule sheets never
 *  need the fallback — assignments content-score as "team" even renamed, and
 *  schedule sheets are detected by their own column signals.) */
export function deriveForcedTabType(
  mappings: Record<string, Record<string, string>>,
): "team" | "clients" | null {
  const sheets = Object.keys(mappings);
  if (sheets.some(s => SHEET_SERVER_TAB[s] === "clients")) return "clients";
  if (sheets.some(s => SHEET_SERVER_TAB[s] === "team")) return "team";
  return null;
}
