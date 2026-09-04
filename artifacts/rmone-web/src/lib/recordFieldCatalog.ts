/**
 * Record-page field catalog — the shared knowledge of which raw record fields
 * the Project / Opportunity / Lead detail page surfaces automatically, which
 * belong to the Budget & Costs card, and which must never render.
 *
 * Lives in lib/ (moved out of pages/project-detail.tsx) so Settings → Display
 * Defaults can offer the SAME "shown by default vs optional" split when an
 * admin configures the company record-page defaults without opening a record.
 * project-detail.tsx imports everything from here — keep it the single source.
 */

// Construction-industry financial fields that already exist on the core2 PMM/OPM
// records and are fetched into rawFields by the API. They are surfaced first-class
// in the Project Details card (conditionally — only when the record carries a real
// value) and skipped from the "Customize fields" panel so they never double-render.
export const CONSTRUCTION_FINANCIAL_FIELDS: Array<{ key: string; label: string; kind: "money" | "text" | "sqft" | "pct" }> = [
  { key: "ContractType",           label: "Contract Type",           kind: "text"  },
  { key: "OwnerContractTypeChoice",label: "Owner Contract Type",     kind: "text"  },
  { key: "TotalCost",              label: "Total Cost",              kind: "money" },
  { key: "ProjectCost",            label: "Project Cost",            kind: "money" },
  // ForecastedProjectCost is rendered explicitly in Budget & Costs (always
  // visible / editable like NonOperatingCost) — omit here to avoid a duplicate.
  { key: "AcquisitionCost",        label: "Acquisition Cost",        kind: "money" },
  { key: "ActualProjectCost",      label: "Actual Cost to Date",     kind: "money" },
  { key: "ActualAcquisitionCost",  label: "Actual Acquisition Cost", kind: "money" },
  { key: "ContractedAmount",       label: "Contracted Amount",       kind: "money" },
  { key: "ProposalAmount",         label: "Proposal Amount",         kind: "money" },
  { key: "BidAmount",              label: "Bid Amount",              kind: "money" },
  { key: "Contingency",            label: "Contingency",             kind: "money" },
  { key: "EstProjectSpend",        label: "Estimated Spend",         kind: "money" },
  { key: "EstProjectSpendComment", label: "Spend Note",              kind: "text"  },
  { key: "ApprovedChangeOrders",   label: "Approved Change Orders",  kind: "money" },
  { key: "ChangeOrders",           label: "Change Orders",           kind: "money" },
  { key: "LiquidatedDamages",      label: "Liquidated Damages",      kind: "money" },
  { key: "ApprovedRFEAmount",      label: "Approved RFE Amount",     kind: "money" },
  { key: "ApprovedRFEType",        label: "RFE Type",                kind: "text"  },
  { key: "RetailSqftNum",          label: "Retail Sq Ft",            kind: "sqft"  },
  { key: "UsableSqFtNum",          label: "Usable Sq Ft",            kind: "sqft"  },
  { key: "FeePct",                 label: "Fee %",                   kind: "pct"   },
  { key: "ProjectPhasePctComplete",label: "Phase % Complete",        kind: "pct"   },
  { key: "GrossMargin",            label: "Target Gross Margin",     kind: "money" },
  // NonOperatingCost is rendered explicitly above (always visible / editable,
  // not hidden when blank like the fields in this generic list) — omit here
  // to avoid a duplicate render.
];

// Auto-displayed date fields pulled from rawFields (construction lifecycle dates).
// Rendered conditionally — only when the record carries a real date value.
export const CONSTRUCTION_DATE_FIELDS: Array<{ key: string; label: string }> = [
  { key: "TargetStartDate",            label: "Target Start" },
  { key: "TargetCompletionDate",       label: "Target End" },
  { key: "ActualStartDate",            label: "Schedule Start" },
  { key: "ActualCompletionDate",       label: "Schedule End" },
  { key: "ProposalPhaseDueDate",       label: "Proposal Due Date" },
  { key: "BidDueDate",                 label: "Bid Due Date" },
  { key: "PreconStartDate",            label: "Precon Start" },
  { key: "PreconEndDate",              label: "Precon End" },
  { key: "ConstStartDate",             label: "Construction Start" },
  { key: "EstimatedConstructionStart", label: "Est. Construction Start" },
  { key: "EstimatedConstructionEnd",   label: "Est. Construction End" },
  { key: "SubstantialCompletion",      label: "Substantial Completion" },
  { key: "CloseoutDate",               label: "Closeout Date" },
  { key: "CloseoutStartDate",          label: "Closeout Start" },
  { key: "ClosedDate",                 label: "Closed Date" },
  { key: "CloseDate",                  label: "Close Date" },
  { key: "NextMilestoneDate",          label: "Next Milestone Date" },
  { key: "InterviewDate",              label: "Interview Date" },
  { key: "AwardedorLossDate",          label: "Awarded / Loss Date" },
  { key: "DesiredCompletionDate",      label: "Desired Completion" },
];

// Auto-displayed qualitative/text fields from rawFields (construction terms).
// Keys here must NOT also appear in CONSTRUCTION_FINANCIAL_FIELDS (double-render).
export const CONSTRUCTION_TEXT_FIELDS: Array<{ key: string; label: string }> = [
  { key: "NextActivity",                  label: "Next Activity" },
  { key: "NextMilestone",                 label: "Next Milestone" },
  { key: "ApprovedRFE",                   label: "Approved RFE" },
  { key: "ProjectRank",                   label: "Project Rank" },
  { key: "MarketSector",                  label: "Market Sector" },
  { key: "RetainageChoice",               label: "Retainage Terms" },
  { key: "Retainage",                     label: "Retainage" },
  { key: "SubContractorMarkUp",           label: "Subcontractor Markup" },
  { key: "GeneralConditionsDelay",        label: "General Conditions Delay" },
  { key: "Bond",                          label: "Bond" },
  { key: "PaymentAndPerformanceBonds",    label: "Payment & Performance Bonds" },
  { key: "GLInsurance",                   label: "General Liability Insurance" },
  { key: "Insurance",                     label: "Insurance" },
  { key: "BuilderRisk",                   label: "Builder's Risk" },
  { key: "SubcontractorDefaultInsurance", label: "Subcontractor Default Insurance" },
  { key: "LienWaiver",                    label: "Lien Waiver" },
  { key: "Warranties",                    label: "Warranties" },
  { key: "CertifyingAgency",              label: "Certifying Agency" },
  { key: "DiverseCertificationChoice",    label: "Diverse Certification" },
  { key: "HasPreconstructionContract",    label: "Preconstruction Contract" },
  { key: "HasPreconContract",             label: "Precon Contract" },
  { key: "EstimatedConstructionDuration", label: "Est. Construction Duration" },
  { key: "PreconDuration",                label: "Precon Duration" },
  { key: "ProjectCostNote",               label: "Project Cost Note" },
  // ProjectType and ServiceType are intentionally omitted here — PMM renders
  // them as header Chips and OPM renders them as explicit DetailCells, so
  // including them here would cause a duplicate card.
  { key: "ProjectTag",                    label: "Project Tag" },
  // RequestCategory is explicitly rendered in EVERY ModuleSpecificDetails
  // branch (OPM/LEM as "Project Category", PMM as "Request Category" to match
  // the stage-rules wording) — omit here to prevent duplicate cells.
  { key: "Category",                      label: "Category" },
  { key: "StudioChoice",                  label: "Studio" },
  // ERPJobID/ERPJobIDNC are rendered explicitly in the OPM detail card — skip here to avoid duplicates
  // ProjectId is rendered as a dedicated FIRST cell in the Project Details card — omit here to avoid duplication.
  { key: "UsableSqFt",                    label: "Usable Sq Ft (Description)" },
  { key: "MasterAgreementLookup",         label: "Master Agreement" },
  { key: "StateLookup",                   label: "State" },
  { key: "PriorityLookup",               label: "Priority" },
  { key: "StreetAddress1",                label: "Street Address" },
  { key: "Description",                   label: "Description" },
  { key: "Note",                          label: "Note" },
  { key: "Comment",                       label: "Comment" },
  { key: "WorkDescription",               label: "Work Description" },
  { key: "ServicesDescription",           label: "Services Description" },
  { key: "ClientAskDescription",          label: "Client Ask" },
  { key: "AnalysisDetails",               label: "Analysis Details" },
  { key: "ContractNotes",                 label: "Contract Notes" },
  { key: "ProjectSummaryNote",            label: "Project Summary" },
  // OwnerName is handled explicitly in each module section — omit here to avoid duplication.
];

// Keys from CONSTRUCTION_TEXT_FIELDS that live in the dedicated
// "Notes & Description" section — skip them in Project Details to avoid duplication.
export const NOTES_FIELD_KEYS = new Set([
  "Description", "Note", "Comment", "WorkDescription", "ServicesDescription",
  "ClientAskDescription", "AnalysisDetails", "ContractNotes", "ProjectSummaryNote",
]);

// Keys from CONSTRUCTION_TEXT_FIELDS that belong in the "Budget & Costs" section
// (finance-adjacent contract/insurance/bond terms). Skipped in Project Details.
export const BUDGET_TEXT_FIELD_KEYS = new Set([
  "RetainageChoice", "Retainage", "SubContractorMarkUp", "GeneralConditionsDelay",
  "Bond", "PaymentAndPerformanceBonds", "GLInsurance", "Insurance", "BuilderRisk",
  "SubcontractorDefaultInsurance", "LienWaiver", "Warranties",
  "CertifyingAgency", "DiverseCertificationChoice",
  "HasPreconstructionContract", "HasPreconContract",
  "EstimatedConstructionDuration", "PreconDuration", "ProjectCostNote",
]);

// Union of every key we surface automatically — excluded from the "Customize
// fields" panel and its custom render so a key never appears twice.
export const AUTO_SHOWN_KEYS = new Set<string>([
  ...CONSTRUCTION_FINANCIAL_FIELDS.map((f) => f.key),
  ...CONSTRUCTION_DATE_FIELDS.map((f) => f.key),
  ...CONSTRUCTION_TEXT_FIELDS.map((f) => f.key),
  // Keys shown via dedicated cells (project.bu, laborValue, contract values, etc.)
  "CRMBusinessUnitChoice", "LaborContractAmount",
  "ApproxContractValue", "ContractValue", "ContractLimit",
  "ForecastedProjectCost", "NonOperatingCost",
  "ShortName", "PctComplete", "CRMCompanyLookupName",
  // Company — shown as dedicated "Company" cell; hide raw lookup ID and resolved copy
  "CompanyName", "CRMCompanyLookup",
  // Division/Dept — shown as dedicated cells; hide raw IDs and resolved names
  "DivisionLookup", "DivisionName",
  "DepartmentLookup", "DepartmentName", "Department",
  // Location fields — shown as dedicated Street Address / City / State cells
  "StreetAddress1", "City", "StateLookup",
  // BU name text — shown via dedicated Business Unit cell
  "BusinessUnitName",
  // Owner name — shown via a dedicated text field in CONSTRUCTION_TEXT_FIELDS
  "OwnerName",
  // Office / branch location — shown via dedicated Office cell
  "Office",
  // OPM ModuleSpecificDetails explicit cells — all variants that may appear
  // in rawFields for each field so the Customize panel never lists them as
  // optional (they are always shown in the OPM section).
  "CRMOpportunityStatusChoice", "Stage", "StageChoice",
  "RequestCategory",
  "ProjectType", "ProjectTypeChoice", "CRMProjectTypeChoice",
  "ServiceType", "ServiceTypeChoice", "ServiceTypeText",
  "SuccessChance", "ChanceofSuccessChoice", "ChanceOfSuccessChoice",
  "BidDate", "BidDueDate",
  "CMICProjectNumber", "CMICNumber", "CMIC",
  "ERPJobID", "ERPJobIDNC",
  "ProjectId",
  "StudioChoice",
  "ActualProjectCost", "ActualAcquisitionCost", "AcquisitionCost",
  "RetailSqftNum",
  "Contingency",
  "Created", "CreationDate",
  // Sector — shown via dedicated Sector cell
  "SectorChoice", "Sector",
  // PMM ModuleSpecificDetails explicit cells
  "CMIC_ES_Number", "CMICESNumber",
  "ProjectExec", "ProjectExecutive", "ProjectExecutiveUser",
  "RiskScore", "ProjectScore",
  // LEM ModuleSpecificDetails explicit cells
  "Urgency", "UrgencyChoice", "LeadPriority", "Priority", "LeadPriorityChoice",
  "Score", "LeadScore",
  "NetRentableSqFt", "NetRentableSF", "SquareFeet", "SQFT",
  "ContactLookup", "CRMContactLookup", "Contact", "ContactName",
  "EstimatedStartDate", "EstStartDate",
]);

// Field keys that must NEVER surface as a DetailCell or in the Customize
// panel. TicketId is the record's routing ID — already shown as the dedicated
// "Project ID" first cell (via ProjectId with a project.id fallback), so a
// pinned "Ticket" cell would always be a duplicate. Raw `Title` (and its PMM
// import alias `ProjectTitle`) is the record's NAME: the locked name grid
// column and the record page header already show it, so offering it as an
// addable field would always render it twice (user request, Aug 2026).
export const SUPPRESSED_FIELD_KEYS = new Set<string>([
  "Ticket", "TicketId", "TicketID",
  "Title", "ProjectTitle",
]);

// Identity fields do not belong in Budget & Costs. They can exist in older
// saved budget-pin lists, so keep them separate from the Project Details
// suppression list and clean them when the budget settings are read.
export const BUDGET_SUPPRESSED_FIELD_KEYS = new Set<string>([
  "Ticket", "TicketId", "TicketID",
  "Title",
  "Module", "ModuleName",
]);

// Budget & Costs card — keys it renders automatically (manual-entry money
// cells + generic financial list + contract/insurance/bond text fields).
// Used by the Budget card's own Customize panel to list its hideable fields.
export const BUDGET_AUTO_KEYS = new Set<string>([
  "ApproxContractValue", "LaborContractAmount", "ForecastedProjectCost", "NonOperatingCost",
  ...CONSTRUCTION_FINANCIAL_FIELDS.map((f) => f.key),
  ...BUDGET_TEXT_FIELD_KEYS,
]);

/** "CRMBusinessUnitChoice" → "Business Unit"-style humanized field name. */
export function humanizeFieldKey(k: string): string {
  const stripped = k.replace(/(Choice|Lookup|User|Id|ID)$/g, "").replace(/^CRM/, "");
  return stripped.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim();
}
