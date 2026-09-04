import type {
  CompanySlim,
  ModuleRecord,
  PeopleSearchEntry,
  ProjectTeamMember,
} from "./api";
import type { RecordPermissions } from "./permissions";
import type { ExistingAllocationRef } from "@/hooks/useAssignMemberCascade";

export type QuickLifecycleType = "PMM" | "OPM" | "LEM";
export type QuickRecordType = QuickLifecycleType | "COM" | "STAFF";

export interface QuickSearchItem {
  id: string;
  type: QuickRecordType;
  title: string;
  client?: string;
  status?: string;
  email?: string;
  role?: string;
  projectCount?: number;
  raw?: Record<string, unknown>;
}

export type QuickSearchGroups = Record<QuickRecordType, QuickSearchItem[]>;

export type QuickActionId =
  | "team"
  | "position"
  | "allocation"
  | "status"
  | "notes"
  | "endings"
  | "leads"
  | "open";

/** The same *User column → role-label mapping as the Project Leads card on
 *  the record detail page, exported so Quick Actions can reuse it for LEM
 *  records without duplicating the list.  Only a semantically relevant subset
 *  is included here; the full catalogue lives in project-detail.tsx. */
/** Canonical role ↔ record-column catalogue for lead (key personnel) pickers.
 *  ONE list for Quick Actions AND the record page (project-detail aliases it as
 *  KP_FIELD_ROLES) — kept in lockstep with KEY_PERSONNEL_USER_COLS on the
 *  api-server, which lazily adds any missing column on the target table. */
export const KP_LEAD_ROLES: { field: string; role: string }[] = [
  { field: "ProjectLeadUser",          role: "Project Lead" },
  { field: "ProjectManagerUser",       role: "Project Manager" },
  { field: "SeniorProjectManagerUser", role: "Senior Project Manager" },
  { field: "BusinessLeadUser",         role: "Business Lead" },
  { field: "OwnerUser",                role: "Owner" },
  { field: "LeadEstimatorUser",        role: "Lead Estimator" },
  { field: "ProgramManagerUser",       role: "Program Manager" },
  { field: "EstimatorUser",            role: "Estimator" },
  { field: "SeniorEstimatorUser",      role: "Senior Estimator" },
  { field: "SeniorMEPManagerUser",     role: "Senior MEP Manager" },
  { field: "LeadSuperintendentUser",   role: "Lead Superintendent" },
  { field: "SuperintendentUser",       role: "Superintendent" },
  { field: "SeniorSuperintendentUser", role: "Senior Superintendent" },
  { field: "SponsorsUser",             role: "Sponsor" },
  { field: "StakeHoldersUser",         role: "Stakeholder" },
  { field: "PointOfContact",           role: "Primary Contact" },
  // Executive leadership (AEC industry standard: the executive sponsor on a
  // project is a key contact, not just a team member).
  { field: "PresidentUser",               role: "President" },
  { field: "ExecutiveVicePresidentUser",  role: "Executive Vice President" },
  { field: "SeniorVicePresidentUser",     role: "Senior Vice President" },
  { field: "VicePresidentUser",           role: "Vice President" },
  { field: "ProjectExecutiveUser",        role: "Project Executive" },
  { field: "PrincipalUser",               role: "Principal" },
  { field: "AssociateVicePresidentUser",  role: "Associate Vice President" },
];

export type QuickRefreshTarget = "details" | "module" | "team";

const EMPTY_GROUPS = (): QuickSearchGroups => ({
  PMM: [],
  OPM: [],
  LEM: [],
  COM: [],
  STAFF: [],
});

export function firstQuickString(...values: unknown[]): string {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

export function isQuickLifecycleType(type: QuickRecordType): type is QuickLifecycleType {
  return type === "PMM" || type === "OPM" || type === "LEM";
}

export function canViewQuickTeam(type: QuickRecordType): type is "PMM" | "OPM" {
  return type === "PMM" || type === "OPM";
}

export function mapQuickModuleRecord(
  record: ModuleRecord,
  module: QuickLifecycleType,
): QuickSearchItem {
  const raw = record as Record<string, unknown>;
  const id = firstQuickString(raw.TicketId, raw.RecordId, raw.Id);
  const title = firstQuickString(raw.Title, raw.ShortName, raw.TicketId, id);
  const client = firstQuickString(
    raw.CRMCompanyLookupName,
    raw.CompanyName,
    raw.CRMCompanyNameChoice,
    raw.ClientName,
    raw.Company,
    raw.Client,
  );

  let status = "";
  if (module === "PMM") {
    status = firstQuickString(
      raw.CRMProjectStatusChoice,
      raw.Status,
      raw.Closed === true ? "Closed" : "Open",
    );
  } else if (module === "OPM") {
    status = firstQuickString(
      raw.CRMOpportunityStatusChoice,
      raw.Status,
      raw.ModuleStepLookup,
      "Stage not set",
    );
  } else {
    status = firstQuickString(raw.LeadStatus, raw.Status, "Open");
  }

  return { id, type: module, title, client, status, raw };
}

export function mapQuickCompany(company: CompanySlim): QuickSearchItem {
  return {
    id: firstQuickString(company.ticketId, company.id),
    type: "COM",
    title: firstQuickString(company.title, company.ticketId, company.id),
    raw: {
      id: company.id,
      ticketId: company.ticketId,
      title: company.title,
    },
  };
}

export function mapQuickStaff(person: PeopleSearchEntry): QuickSearchItem | null {
  if (person.source !== "user") return null;
  const title = firstQuickString(person.name);
  const id = firstQuickString(person.guid, person.email, title);
  if (!title || !id) return null;
  return {
    id,
    type: "STAFF",
    title,
    email: firstQuickString(person.email),
    role: firstQuickString(person.title),
    client: firstQuickString(person.company),
    projectCount: typeof person.projectCount === "number" ? person.projectCount : undefined,
    raw: person as Record<string, unknown>,
  };
}

export function groupQuickSearchResults(
  items: readonly QuickSearchItem[],
  query: string,
  perGroupLimit = 5,
): QuickSearchGroups {
  const normalized = query.trim().toLowerCase();
  const groups = EMPTY_GROUPS();
  if (normalized.length < 2) return groups;

  for (const item of items) {
    const haystack = [
      item.id,
      item.title,
      item.client,
      item.status,
      item.email,
      item.role,
    ].join("\n").toLowerCase();
    if (!haystack.includes(normalized)) continue;
    if (groups[item.type].length < perGroupLimit) groups[item.type].push(item);
  }
  return groups;
}

export function quickActionIdsForType(type: QuickRecordType): QuickActionId[] {
  if (type === "PMM") return ["team", "position", "allocation", "status", "notes", "endings", "open"];
  if (type === "OPM") return ["team", "position", "allocation", "status", "notes", "endings", "open"];
  if (type === "LEM") return ["leads", "status", "notes", "endings", "open"];
  return ["open"];
}

/** Record types where a given action exists at all — drives the landing's
    "start from an action" cards: after picking an action the search results
    only offer records that can actually run it. */
export function quickActionEligibleTypes(action: QuickActionId): QuickLifecycleType[] {
  const lifecycle: QuickLifecycleType[] = ["PMM", "OPM", "LEM"];
  return lifecycle.filter((type) => quickActionIdsForType(type).includes(action));
}

export function quickActionPath(item: QuickSearchItem): string {
  if (item.type === "STAFF") {
    // Include the resource GUID so the Resources page can open the profile
    // modal directly instead of just pre-filtering the search list.
    // The GUID lives in item.id for STAFF items.
    return `/resources?view=Staff&openProfile=${encodeURIComponent(item.id)}`;
  }
  if (item.type === "COM") return "/projects?view=Companies";
  return `/project/${encodeURIComponent(item.id)}`;
}

export function quickProjectTeamPath(projectId: string, module: "PMM" | "OPM"): string {
  return `/project/${encodeURIComponent(projectId)}?section=team&module=${module}`;
}

export function quickActionFieldName(
  type: QuickLifecycleType,
  action: "status" | "note" | "description",
  fields: Record<string, unknown>,
): string {
  if (action === "description") return "Description";
  if (action === "status") {
    if (type === "PMM") return "CRMProjectStatusChoice";
    if (type === "OPM") return "CRMOpportunityStatusChoice";
    return "LeadStatus";
  }

  if (type === "PMM") {
    if (firstQuickString(fields.ProjectSummaryNote)) return "ProjectSummaryNote";
    if (firstQuickString(fields.Comment)) return "Comment";
    return "Note";
  }
  if (type === "OPM") {
    if (firstQuickString(fields.Note)) return "Note";
    if (firstQuickString(fields.Comment)) return "Comment";
    return "Note";
  }
  if (firstQuickString(fields.Comment)) return "Comment";
  if (firstQuickString(fields.Note)) return "Note";
  return "Comment";
}

export function canUseQuickAction(
  type: QuickRecordType,
  action: QuickActionId,
  permissions: RecordPermissions | undefined,
  canManageStaff: boolean,
): boolean {
  if (action === "open") return true;
  if (!isQuickLifecycleType(type) || !permissions) return false;
  if (action === "team" || action === "position" || action === "allocation") {
    // Manage staff is standalone: a built-in User may be granted staffing
    // without Edit data. The staff routes enforce this same independent cap.
    return type !== "LEM" && canManageStaff;
  }
  if (action === "status") {
    return permissions.canEditData && permissions.canAdvanceStage;
  }
  if (action === "endings") {
    // PMM gets lost + cancel (no conversion — projects are the final destination).
    // OPM and LEM additionally get the advance/convert option.
    return (type === "PMM" || type === "OPM" || type === "LEM") && permissions.canEditData && permissions.canAdvanceStage;
  }
  if (action === "leads") {
    // LEM only: add/view key personnel (*User fields) from the roster.
    return type === "LEM" && permissions.canEditData;
  }
  return permissions.canEditData;
}

/**
 * Why a locked card is locked — in words that name the SPECIFIC setting.
 * One blanket message previously covered every card, which read as a bug
 * when only one capability (say manage-staff) was missing. Order mirrors
 * canUseQuickAction: a server-side editData lock (view-only level or a
 * stage rule) genuinely covers every card and keeps the server's reason;
 * otherwise the card's own capability produces a card-specific explanation.
 * null = not locked, or permissions still unknown.
 */
export function quickActionLockReason(
  type: QuickRecordType,
  action: QuickActionId,
  permissions: RecordPermissions | undefined,
  canManageStaff: boolean,
): string | null {
  if (!permissions || action === "open") return null;
  if (canUseQuickAction(type, action, permissions, canManageStaff)) return null;
  if ((action === "team" || action === "position" || action === "allocation") && !canManageStaff) {
    return "Your access level doesn't include staffing changes (team members, open positions and allocations).";
  }
  if (!permissions.canEditData) {
    return permissions.reason || "Your access level is view-only.";
  }
  if ((action === "status" || action === "endings") && !permissions.canAdvanceStage) {
    return permissions.reason || "Your access level doesn't allow moving records to a different stage.";
  }
  return permissions.reason || "Changes to this record are limited by your access level.";
}

export function quickActionRefreshTargets(
  type: QuickRecordType,
  action: QuickActionId,
): QuickRefreshTarget[] {
  if (!isQuickLifecycleType(type) || action === "open") return [];
  return action === "team" || action === "position" || action === "allocation"
    ? ["details", "module", "team"]
    : ["details", "module"];
}

export function quickExistingAllocations(
  team: readonly ProjectTeamMember[],
): ExistingAllocationRef[] {
  return team.map((member) => ({
    personId: member.resourceId || "",
    bu: member.bu || "",
    role: member.role || "",
    title: member.title || "",
    hours: member.eacHrs || 0,
    allocationId: member.rwiId ?? undefined,
    startDate: member.startDate,
    endDate: member.endDate,
  }));
}