/**
 * Learned column mappings for the Data Cleaning engine.
 *
 * The import grid saves every user-confirmed column alias into the shared
 * rmone_synonym_mappings table (alias → onboarding canonical field, scoped by
 * the SIMPLIFIED onboarding tab: "team" | "clients" | "assignments"). That
 * vocabulary is NOT the cleaning template's — this module translates it:
 *   tab_type          → candidate cleaning modules
 *   canonical_field   → template column label (curated map below)
 * Untranslatable entries are ignored. The loader FAILS OPEN — on any DB error
 * cleaning proceeds without learned mappings.
 */
import { getAllSynonymMappings, upsertSynonymMapping } from "@workspace/db";
import { TEMPLATE_COLS, normKey, type ModuleId } from "./template.js";

export interface LearnedTarget { module: ModuleId; target: string }

const TAB_TO_MODULES: Record<string, ModuleId[]> = {
  team:        ["team"],
  clients:     ["projects", "opportunities", "leads"],
  assignments: ["assignments"],
};

/** Onboarding canonical field → cleaning template label, per module. */
const CANON_TO_LABEL: Partial<Record<ModuleId, Record<string, string>>> = {
  team: {
    FullName: "Full Name", UserName: "Full Name",
    Email: "Login Email",
    CRMBusinessUnitChoice: "Business Unit",
    Division: "Division", Department: "Department",
    Role: "Role", JobTitle: "Job Title", JobProfile: "Job Title",
    UserRole: "Access Level",
    StartDate: "Start Date",
    EmployeeType: "Employee Type", PhoneNumber: "Phone Number",
    EmployeeId: "Employee ID", Skills: "Skills", ExperienceTags: "Experience Tags",
  },
  projects: {
    ProjectTitle: "Project Title", ProjectName: "Project Title", Project: "Project Title",
    TicketId: "Project ID", ProjectId: "Project ID", ERPJobID: "Project ID",
    CompanyName: "Company Name", ContactName: "Contact Name",
    MarketSector: "Market Sector", SectorChoice: "Market Sector",
    ProjectType: "Project Type", ServiceType: "Service Type",
    Category: "Category", RequestCategory: "Category",
    CRMBusinessUnitChoice: "Business Unit", Division: "Division", Department: "Department",
    Status: "Status", ShortName: "Short Name",
    StartDate: "Start Date", TargetStartDate: "Start Date",
    EndDate: "End Date", TargetCompletionDate: "End Date", DesiredCompletionDate: "End Date",
    ActualStartDate: "Actual Start", ActualCompletionDate: "Actual End",
    ConstStartDate: "Construction Start", EstimatedConstructionStart: "Construction Start",
    CloseoutDate: "Closeout Date",
    ContractValue: "Contract Value", LaborContractAmount: "Labor Budget",
    GrossMargin: "Gross Margin",
    ContractType: "Contract Type", OwnerContractTypeChoice: "Contract Type",
    ContractedAmount: "Contracted Amount", ProposalAmount: "Proposal Amount",
    BidAmount: "Bid Amount", ChangeOrders: "Change Orders",
    ApprovedChangeOrders: "Approved Change Orders", Retainage: "Retainage",
    Contingency: "Contingency", TotalCost: "Total Project Cost",
    NextMilestone: "Next Milestone", Description: "Description",
    Note: "Notes", Comment: "Notes",
    StreetAddress1: "Street Address", City: "City", StateLookup: "State", Office: "Office",
  },
  opportunities: {
    ProjectTitle: "Opportunity Title", ProjectName: "Opportunity Title",
    TicketId: "Opportunity ID",
    CompanyName: "Company Name", ContactName: "Contact Name",
    ChanceOfSuccessChoice: "Chance of Success",
    MarketSector: "Market Sector", SectorChoice: "Market Sector",
    CRMBusinessUnitChoice: "Business Unit", Division: "Division", Department: "Department",
    TargetStartDate: "Target Start", StartDate: "Target Start",
    TargetCompletionDate: "Target End", EndDate: "Target End",
    ActualStartDate: "Actual Start", ActualCompletionDate: "Actual End",
    AwardedorLossDate: "Award / Loss Date",
    ApproxContractValue: "Approx Contract Value", ContractValue: "Approx Contract Value",
    LaborContractAmount: "Labor Contract Amount",
    GrossMargin: "Gross Margin",
    ContractType: "Contract Type", Description: "Description",
    Note: "Notes", Comment: "Notes", Status: "Status", Office: "Office",
    StageStep: "Stage",
  },
  leads: {
    ProjectTitle: "Lead Name", ProjectName: "Lead Name",
    TicketId: "Lead ID",
    CompanyName: "Company Name", ContactName: "Contact Name",
    MarketSector: "Market Sector",
    CRMBusinessUnitChoice: "Business Unit", Division: "Division", Department: "Department",
    BidDueDate: "Bid Due Date",
    StartDate: "Forecast Start", EndDate: "Forecast End",
    ContractValue: "Est. Contract Value", ApproxContractValue: "Est. Contract Value",
    Status: "Status", Description: "Description", Note: "Notes",
  },
  assignments: {
    ProjectTitle: "Project", ProjectName: "Project", Project: "Project",
    TicketId: "Project ID", ProjectId: "Project ID",
    FullName: "Name", UserName: "Name",
    Email: "Email",
    AllocationStartDate: "Start Date", StartDate: "Start Date",
    AllocationEndDate: "End Date", EndDate: "End Date",
    AllocationHour: "Total Hours",
    AllocationType: "Type",
    Role: "Role", JobTitle: "Job Title",
    CRMBusinessUnitChoice: "Business Unit", Division: "Division", Department: "Department",
    BillingRate: "Billing Rate", EmpLaborRate: "Labor Rate", EmpCostRate: "Cost Rate",
    UserRole: "Access Level",
  },
};

const ALL_TABS = Object.keys(TAB_TO_MODULES);

/** Cleaning module → onboarding tab scope for the shared synonym store. */
const MODULE_TO_TAB: Record<ModuleId, string | null> = {
  team: "team",
  projects: "clients", opportunities: "clients", leads: "clients",
  assignments: "assignments",
  schedule: null,   // no onboarding vocabulary for these two —
  companies: null,  // learnCleaningMapping silently skips them
};

/**
 * Persist a user-confirmed cleaning mapping into the shared synonym store so
 * BOTH the import grid and future cleaning runs recognise the alias. Only
 * possible when the template label reverse-maps to an onboarding canonical
 * field (curated CANON_TO_LABEL above); anything else is skipped. Fail-open:
 * a store error must never break the re-clean that triggered it.
 */
export async function learnCleaningMapping(
  alias: string, module: ModuleId, target: string, createdBy?: string,
): Promise<void> {
  try {
    const tab = MODULE_TO_TAB[module];
    if (!tab) return;
    const table = CANON_TO_LABEL[module];
    if (!table) return;
    // First canonical listed for a label is the primary one.
    const canonical = Object.entries(table).find(([, label]) => label === target)?.[0];
    if (!canonical) return;
    const a = String(alias).trim();
    if (a.length < 3) return;
    await upsertSynonymMapping({
      alias: a, canonicalField: canonical, tabType: tab,
      createdBy: createdBy ?? "data-cleaning",
    });
  } catch (e) {
    console.warn("[data-cleaning] learn mapping skipped:",
      e instanceof Error ? e.message : String(e));
  }
}

/**
 * Load learned alias → template-target candidates.
 * Key = normKey(alias). Fail-open: empty map on error.
 */
export async function loadLearnedMappings(): Promise<Map<string, LearnedTarget[]>> {
  const out = new Map<string, LearnedTarget[]>();
  try {
    const rows = await getAllSynonymMappings();
    for (const r of rows) {
      const key = normKey(r.alias);
      if (!key || key.length < 3) continue;
      const tabs = r.tabType && TAB_TO_MODULES[r.tabType] ? [r.tabType] : ALL_TABS;
      for (const tab of tabs) {
        for (const mod of TAB_TO_MODULES[tab]!) {
          const label = CANON_TO_LABEL[mod]?.[r.canonicalField];
          if (!label) continue;
          if (!TEMPLATE_COLS[mod].some(c => c.label === label)) continue;
          const list = out.get(key) ?? [];
          if (!list.some(t => t.module === mod && t.target === label)) {
            list.push({ module: mod, target: label });
            out.set(key, list);
          }
        }
      }
    }
  } catch (e) {
    console.warn("[data-cleaning] learned-mapping load skipped:",
      e instanceof Error ? e.message : String(e));
  }
  return out;
}
