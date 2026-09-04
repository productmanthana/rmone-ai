import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  Calendar,
  ExternalLink,
  FileText,
  Flag,
  Loader2,
  Mail,
  Pencil,
  Search,
  SlidersHorizontal,
  Target,
  ThumbsDown,
  UserCircle,
  UserPlus,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { ModuleHeader } from "@/components/layout/ModuleHeader";
import {
  getCompaniesList,
  getFieldOptions,
  getStageCfg,
  getModuleRecords,
  getModuleRecordsFresh,
  getProjectDetails,
  getProjectTeam,
  hoverPrefetchProject,
  getResourceAllocations,
  getResourceWeekAllocations,
  getTaskData,
  getUserList,
  getUserSkills,
  getUserExperienceTags,
  markProjectDetailRefetchFresh,
  saveStageCfg,
  searchPeople,
  setAllocationFlag,
  notifyAllocationChanged,
  removeOpenPosition,
  removeTeamMember,
  peekCached,
  tenantScopedKey,
  updateFields,
  type LiveResourceProxy,
  type OpenRole,
  type ProjectTeamMember,
  type ProjectTeamResponse,
  type ResourceWeekAllocations,
} from "@/lib/api";
import {
  getMyCapabilities,
  getMyCapabilitiesChecked,
  getRecordPermissions,
} from "@/lib/permissions";
import { writeConvertSeed } from "@/lib/convertSeed";
import { getBusinessRules } from "@/lib/businessRules";
import { getDisplayModeForRecord } from "@/lib/projectViewMode";
import type { Allocation } from "@/pages/project-detail";
import { Z } from "@/lib/zLayers";
import { EditStaffModal } from "@/components/EditStaffModal";
import { ExistingWorkTimelineModal } from "@/components/ExistingWorkTimelineModal";
import { AuditTrailCard } from "@/components/AuditTrailCard";
import {
  canUseQuickAction,
  canViewQuickTeam,
  firstQuickString,
  groupQuickSearchResults,
  isQuickLifecycleType,
  KP_LEAD_ROLES,
  mapQuickCompany,
  mapQuickModuleRecord,
  mapQuickStaff,
  quickActionEligibleTypes,
  quickActionFieldName,
  quickActionIdsForType,
  quickActionLockReason,
  quickActionPath,
  quickActionRefreshTargets,
  quickExistingAllocations,
  quickProjectTeamPath,
  type QuickActionId,
  type QuickLifecycleType,
  type QuickRecordType,
  type QuickSearchItem,
} from "@/lib/quickActions";
import { CUSTOM_LEADS_FIELD, addCustomLead, customLeadNamesForRole } from "@/lib/customLeads";

/** Sentinel value for the "Add your own role…" entry in the Lead Role picker. */
const QA_CUSTOM_ROLE = "__custom_role__";
import { useDebounce } from "@/lib/useDebounce";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AddTeamMemberModal } from "@/components/AddTeamMemberModal";
import { AddOpenPositionModal } from "@/components/AddOpenPositionModal";

import { QuickActionsTeamModal } from "@/components/QuickActionsTeamModal";
import type { OptimisticAssignedMember } from "@/hooks/useAssignMemberCascade";
import { useToast } from "@/hooks/use-toast";
import { resolvePhaseColor } from "@/lib/phaseColors";
import { isClosedishStatus, isLostishStatus } from "@/lib/closedish";
import { currentPhaseOf, loadProjectPhaseMap, type ProjectPhaseMap } from "@/lib/projectPhases";
import { derivePlannerSchedule } from "@/lib/phaseHours";
import {
  applyOptimisticProjectTeamMember,
  refreshProjectTeamCache,
} from "@/lib/teamCache";
import {
  readProjectSnapshot,
  writeProjectSnapshot,
} from "@/lib/projectDetailCache";
import {
  applyStageCfgToOptions,
  currentSchedulePhase,
  ensureCustomStatusInStageCfg,
  futureSchedulePhase,
  isConfiguredCustomStatus,
  parseStageCfg,
  schedulePhaseNames,
  schedulePhaseStartDays,
  type StageCfg,
} from "@/lib/stageStatus";
import { manualStatusWins } from "@/lib/manualStatusLatch";
import { QuickActionsFlowLanding } from "@/components/QuickActionsFlowLanding";

const GROUP_ORDER: QuickRecordType[] = ["PMM", "OPM", "LEM", "COM", "STAFF"];

const GROUP_LABELS: Record<QuickRecordType, string> = {
  PMM: "Projects",
  OPM: "Opportunities",
  LEM: "Leads",
  COM: "Companies",
  STAFF: "Staff",
};

const TYPE_LABELS: Record<QuickRecordType, string> = {
  PMM: "Project",
  OPM: "Opportunity",
  LEM: "Lead",
  COM: "Company",
  STAFF: "Staff",
};

const TYPE_STYLES: Record<QuickRecordType, CSSProperties> = {
  PMM: { color: "#4D7F2A", background: "rgba(107,165,57,0.14)", borderColor: "rgba(107,165,57,0.28)" },
  OPM: { color: "#2879A8", background: "rgba(56,189,248,0.12)", borderColor: "rgba(56,189,248,0.25)" },
  LEM: { color: "#7C5CB4", background: "rgba(167,139,250,0.12)", borderColor: "rgba(167,139,250,0.25)" },
  COM: { color: "#B75B18", background: "rgba(232,119,34,0.12)", borderColor: "rgba(232,119,34,0.25)" },
  STAFF: { color: "var(--rm-text-muted)", background: "var(--rm-panel-soft)", borderColor: "var(--rm-panel-border)" },
};

function asFieldBag(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

// /project/:id responds with an { Status: boolean, Data: record } envelope.
// The boolean success flag collides with the record's own "Status" FIELD —
// merging the raw envelope over the search row clobbers e.g. Status:"Lost"
// with Status:true, making a terminal record look open (the card then falls
// back to the schedule-derived phase). Always unwrap Data before merging.
function asRecordFieldBag(value: unknown): Record<string, unknown> {
  const bag = asFieldBag(value);
  if (typeof bag["Status"] === "boolean" && "Data" in bag) return asFieldBag(bag["Data"]);
  return bag;
}

function patchQuickProjectSnapshotStatus(
  recordId: string,
  fieldName: string,
  status: string,
) {
  const snapshot = readProjectSnapshot<{
    project?: {
      status?: string;
      phase?: string;
      rawFields?: Record<string, unknown>;
      [key: string]: unknown;
    };
    openRoles?: unknown[];
  }>(recordId);
  if (!snapshot?.project) return;
  writeProjectSnapshot(recordId, {
    ...snapshot,
    project: {
      ...snapshot.project,
      status,
      phase: status,
      rawFields: {
        ...asFieldBag(snapshot.project.rawFields),
        [fieldName]: status,
      },
    },
  });
}

function normalizeOpenRoleLabel(label?: string): string {
  return String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s*\(\d+\)$/, "")
    .replace(/\s+/g, " ");
}

function hasDuplicateOpenRoleChoices(openRoles: readonly OpenRole[]): boolean {
  // Match the same way quick-fill itself does: either role OR title can
  // identify a slot. Two "Engineer" rows with different job-title labels are
  // still ambiguous to that matcher and therefore require a deliberate pick.
  const seenRoleLabels = new Set<string>();
  const seenTitleLabels = new Set<string>();
  for (const slot of openRoles) {
    if ((slot.raIds?.length ?? 0) === 0) continue;
    const role = normalizeOpenRoleLabel(slot.role);
    const title = normalizeOpenRoleLabel(slot.title);
    if ((role && seenRoleLabels.has(role)) || (title && seenTitleLabels.has(title))) return true;
    if (role) seenRoleLabels.add(role);
    if (title) seenTitleLabels.add(title);
  }
  return false;
}

// A Quick Actions staff assignment starts with a person and record, not a
// particular demand-row click. Passing every open role's RA IDs would therefore
// let one assignment consume unrelated positions. The fresh team read gives us
// an explicit consume path whenever there is one backed slot, or one slot that
// exactly matches the selected staff member's role. Duplicate-suffixed names
// (for example, "Coordinator (2)") normalize to the same role, so they stay
// ambiguous until the operator chooses one of the detailed slot cards.
function openSlotRaIdsForQuickFill(
  openRoles: readonly OpenRole[],
  staffRole?: string,
): number[] | undefined {
  const backedSlots = openRoles.filter((role) => (role.raIds?.length ?? 0) > 0);
  if (openRoles.length === 1 && backedSlots.length === 1) return backedSlots[0].raIds;

  const normalizedStaffRole = normalizeOpenRoleLabel(staffRole);
  if (!normalizedStaffRole) return undefined;
  const matchingSlots = backedSlots.filter((slot) =>
    [slot.role, slot.title].some(
      (label) => normalizeOpenRoleLabel(label) === normalizedStaffRole,
    ),
  );
  return matchingSlots.length === 1 ? matchingSlots[0].raIds : undefined;
}

// Landing/search cards show the schedule's date-derived phase for PMM/OPM
// records — EXCEPT when the stored status is the record's truth: a terminal
// status (Lost/Cancelled/…) or a manually latched one (a human chose it
// on/after the last-started phase began — see lib/manualStatusLatch). Masking
// a latched manual choice made "Change status" look like it silently failed.
function withSchedulePhaseStatus(
  item: QuickSearchItem,
  record: Record<string, unknown>,
  phaseMap: ProjectPhaseMap | undefined,
): QuickSearchItem {
  if (isClosedishStatus(item.status)) return item;
  const phases = phaseMap?.get(item.id);
  if (item.status && manualStatusWins(record.StatusManualDate, (phases ?? []).map((p) => p.startDay))) {
    return item;
  }
  return { ...item, status: currentPhaseOf(phases)?.name || item.status };
}

function TypeBadge({ item }: { item: QuickSearchItem }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg border px-2.5 py-1 font-sans text-[10px] font-bold tracking-wider"
      style={TYPE_STYLES[item.type]}
    >
      {TYPE_LABELS[item.type]}
    </span>
  );
}

export default function QuickActionsPage() {
  const [, navigate] = useLocation();
  const directStaffAssignment = useMemo(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get("assignStaff") !== "1") return null;
    const id = params.get("staffId")?.trim() ?? "";
    const title = params.get("staffName")?.trim() ?? "";
    if (!id || !title) return null;
    const action = params.get("staffAction")?.trim() ?? "";
    const target: StaffActionId = (
      action === "OPM" || action === "LEM" || action === "allocation" || action === "audit"
        ? action
        : "PMM"
    );
    return {
      item: {
        id,
        type: "STAFF" as const,
        title,
        email: params.get("staffEmail")?.trim() || undefined,
        role: params.get("staffRole")?.trim() || undefined,
      },
      target,
    };
  }, []);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 250);
  const [selectedItem, setSelectedItem] = useState<QuickSearchItem | null>(directStaffAssignment?.item ?? null);
  const [landingType, setLandingType] = useState<QuickRecordType | null>(null);
  // Landing "start from an action" card: while set, search results narrow to
  // records that support the action, and picking one opens the hub with that
  // action already running.
  const [pendingAction, setPendingAction] = useState<QuickActionId | null>(null);
  const [hubAction, setHubAction] = useState<QuickActionId | null>(null);
  const [hubStaffTarget] = useState<StaffActionId | null>(directStaffAssignment?.target ?? null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Short staleTime: edits made on the record pages should show up in the
  // search results within seconds, not after a 5-minute cache window.
  const pmm = useQuery({
    queryKey: ["pmm"],
    queryFn: () => getModuleRecords("PMM"),
    staleTime: 30_000,
  });
  const opm = useQuery({
    queryKey: ["opm"],
    queryFn: () => getModuleRecords("OPM"),
    staleTime: 30_000,
  });
  const lem = useQuery({
    queryKey: ["lem"],
    queryFn: () => getModuleRecords("LEM"),
    staleTime: 30_000,
  });
  const companies = useQuery({
    queryKey: ["companies-list"],
    queryFn: getCompaniesList,
    staleTime: 300_000,
  });
  const staff = useQuery({
    queryKey: ["quick-actions", "staff", debouncedQuery],
    queryFn: () => searchPeople(debouncedQuery, 30),
    enabled: debouncedQuery.trim().length >= 2,
    staleTime: 60_000,
  });
  const schedulePhaseMap = useQuery({
    queryKey: ["bulk-schedule", "quick-actions-status"],
    queryFn: loadProjectPhaseMap,
    staleTime: 300_000,
  });

  const recordItems = useMemo<QuickSearchItem[]>(() => [
    ...(pmm.data?.data ?? []).map((record) => withSchedulePhaseStatus(mapQuickModuleRecord(record, "PMM"), record, schedulePhaseMap.data)),
    ...(opm.data?.data ?? []).map((record) => withSchedulePhaseStatus(mapQuickModuleRecord(record, "OPM"), record, schedulePhaseMap.data)),
    ...(lem.data?.data ?? []).map((record) => mapQuickModuleRecord(record, "LEM")),
    ...(companies.data ?? []).map(mapQuickCompany),
  ].filter((item) => item.id && item.title), [pmm.data, opm.data, lem.data, companies.data, schedulePhaseMap.data]);

  const staffItems = useMemo(
    () => (staff.data ?? []).map(mapQuickStaff).filter((item): item is QuickSearchItem => item !== null),
    [staff.data],
  );

  const groupedResults = useMemo(
    () => groupQuickSearchResults([...recordItems, ...staffItems], debouncedQuery),
    [recordItems, staffItems, debouncedQuery],
  );

  const visibleGroups = useMemo(() => {
    // Never filter search results by pendingAction's eligible types — the
    // search bar shows all record types regardless of which action chip is
    // active. The action is applied after the user picks a record (selectItem
    // checks whether the chosen type actually supports the action).
    if (!landingType) return groupedResults;
    return GROUP_ORDER.reduce((groups, type) => {
      groups[type] = type === landingType ? groupedResults[type] : [];
      return groups;
    }, {} as Record<QuickRecordType, QuickSearchItem[]>);
  }, [groupedResults, landingType]);

  const hasSearchResults = GROUP_ORDER.some((type) => visibleGroups[type].length > 0);
  const searchOpen = query.trim().length >= 2;
  const searchLoading = searchOpen && (
    pmm.isLoading || opm.isLoading || lem.isLoading || companies.isLoading || staff.isFetching
  );

  const selectItem = (item: QuickSearchItem) => {
    setHubAction(
      pendingAction
        && isQuickLifecycleType(item.type)
        && quickActionIdsForType(item.type).includes(pendingAction)
        ? pendingAction
        : null,
    );
    setSelectedItem(item);
    setQuery("");
    setLandingType(null);
    setPendingAction(null);
  };
  // The project-detail prefetch is intentionally single-file and sequential
  // inside api.ts. A sustained hover gives Quick Actions the same fast first
  // open without starting a fan-out for every result in the search list.
  const prefetchSearchResult = (item: QuickSearchItem) => {
    if (item.type === "PMM" || item.type === "OPM") hoverPrefetchProject(item.id);
  };

  const chooseLandingType = (type: QuickRecordType) => {
    setLandingType((current) => current === type ? null : type);
    setPendingAction(null);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const choosePendingAction = (action: QuickActionId) => {
    setPendingAction((current) => (current === action ? null : action));
    setLandingType(null);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const resultsPanel = searchOpen && (
    <div
      className="absolute inset-x-0 top-[calc(100%+12px)] z-40 max-h-[500px] overflow-y-auto rounded-2xl border border-[var(--rm-panel-border)] bg-[var(--rm-panel)] shadow-2xl backdrop-blur-xl bg-opacity-95"
      data-testid="quick-actions-results"
    >
      {!hasSearchResults && !searchLoading ? (
        <div className="px-6 py-12 text-center">
          <div className="font-semibold text-lg">No matches found</div>
          <div className="mt-2 text-[14px] text-[var(--rm-text-muted)]">
            Try a record ID, company name, or staff member.
          </div>
        </div>
      ) : (
        GROUP_ORDER.map((type) => {
          const items = visibleGroups[type];
          if (items.length === 0) return null;
          return (
            <section key={type}>
              <div className="sticky top-0 z-10 border-y border-[var(--rm-panel-border)] bg-[var(--rm-panel)]/90 backdrop-blur-sm px-5 py-2.5 font-sans text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--rm-text-faint)] first:border-t-0">
                {GROUP_LABELS[type]}
              </div>
              {items.map((item) => (
                <button
                  type="button"
                  key={`${item.type}:${item.id}`}
                  onClick={() => selectItem(item)}
                  onMouseEnter={() => prefetchSearchResult(item)}
                  className="flex w-full items-center gap-4 border-b border-[var(--rm-panel-border)] px-5 py-3.5 text-left transition-colors last:border-b-0 hover:bg-[var(--rm-panel-soft)] focus:bg-[var(--rm-panel-soft)] outline-none"
                  data-testid={`quick-result-${item.type}-${item.id}`}
                >
                  <TypeBadge item={item} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold">{item.title}</div>
                    <div className="mt-1 truncate font-sans text-[11px] text-[var(--rm-text-muted)]">
                      {item.type === "STAFF"
                        ? firstQuickString(item.role, item.email)
                        : [item.id, item.client].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`block text-[12px] font-medium ${item.type !== "STAFF" && isLostishStatus(item.status) ? "font-bold text-red-600" : "text-[var(--rm-text-muted)]"}`}>
                      {item.type === "STAFF"
                        ? (item.projectCount === undefined ? "" : `${item.projectCount} projects`)
                        : item.status}
                    </span>
                  </div>
                </button>
              ))}
            </section>
          );
        })
      )}
    </div>
  );

  // The landing state is a purpose-built command canvas. Once a record is
  // selected, preserve the compact search and its existing action hub below.
  if (!selectedItem) {
    return (
      <main
        className="min-h-full"
        style={{ color: "var(--rm-text)" }}
      >
        <ModuleHeader
          title="Quick Actions"
          section="Operational Intelligence"
          context="Search once, then take the next useful action"
          icon={Zap}
          sticky
        />
        <QuickActionsFlowLanding
          query={query}
          onQueryChange={(event) => setQuery(event.target.value)}
          onClear={() => { setQuery(""); setLandingType(null); setPendingAction(null); }}
          searchLoading={searchLoading}
          inputRef={searchInputRef}
          results={resultsPanel}
        />
      </main>
    );
  }

  return (
    <main
      className="min-h-full px-4 pb-20 pt-8 sm:px-7 lg:px-10"
      style={{ background: "var(--rm-bg)", color: "var(--rm-text)" }}
    >
      <div className="mx-auto max-w-[1100px]">
        <ModuleHeader
          title="Quick Actions"
          section="Operational Intelligence"
          context={`${TYPE_LABELS[selectedItem.type]} selected`}
          icon={Zap}
          style={{ marginBottom: 20, paddingLeft: 0, paddingRight: 0, background: "transparent" }}
        />
        <div className="relative z-50 max-w-md transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]">
          <div className="flex h-14 items-center gap-3 rounded-2xl border-2 border-[var(--rm-panel-border)] bg-[var(--rm-bg)] px-4 shadow-sm transition-all focus-within:border-[var(--rm-green)] focus-within:shadow-[0_0_0_4px_var(--rm-green-soft)]">
            {searchLoading
              ? <Loader2 className="h-6 w-6 animate-spin text-[var(--rm-green)]" />
              : <Search className="h-6 w-6 text-[var(--rm-text-muted)]" />}
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => { setLandingType(null); setQuery(event.target.value); }}
              placeholder="Search by name, ID, client, or person..."
              autoComplete="off"
              aria-label="Search records and staff"
              className="min-w-0 flex-1 bg-transparent text-[16px] text-[var(--rm-text)] outline-none placeholder:text-[var(--rm-text-faint)] transition-all"
              data-testid="quick-actions-search"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(""); setLandingType(null); }}
                aria-label="Clear search"
                className="rounded-full p-1.5 text-[var(--rm-text-muted)] hover:bg-[var(--rm-panel-soft)] hover:text-[var(--rm-text)] transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>

          {searchOpen && (
            <div
              className="absolute inset-x-0 top-[calc(100%+12px)] z-40 max-h-[500px] overflow-y-auto rounded-2xl border border-[var(--rm-panel-border)] bg-[var(--rm-panel)] shadow-2xl backdrop-blur-xl bg-opacity-95"
              data-testid="quick-actions-results"
            >
              {!hasSearchResults && !searchLoading ? (
                <div className="px-6 py-12 text-center">
                  <div className="font-semibold text-lg">No matches found</div>
                  <div className="mt-2 text-[14px] text-[var(--rm-text-muted)]">
                    Try a record ID, company name, or staff member.
                  </div>
                </div>
              ) : (
                GROUP_ORDER.map((type) => {
                  const items = groupedResults[type];
                  if (items.length === 0) return null;
                  return (
                    <section key={type}>
                      <div className="sticky top-0 z-10 border-y border-[var(--rm-panel-border)] bg-[var(--rm-panel)]/90 backdrop-blur-sm px-5 py-2.5 font-sans text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--rm-text-faint)] first:border-t-0">
                        {GROUP_LABELS[type]}
                      </div>
                      {items.map((item) => (
                        <button
                          type="button"
                          key={`${item.type}:${item.id}`}
                          onClick={() => selectItem(item)}
                          onMouseEnter={() => prefetchSearchResult(item)}
                          className="flex w-full items-center gap-4 border-b border-[var(--rm-panel-border)] px-5 py-3.5 text-left transition-colors last:border-b-0 hover:bg-[var(--rm-panel-soft)] focus:bg-[var(--rm-panel-soft)] outline-none"
                          data-testid={`quick-result-${item.type}-${item.id}`}
                        >
                          <TypeBadge item={item} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[15px] font-semibold">{item.title}</div>
                            <div className="mt-1 truncate font-sans text-[11px] text-[var(--rm-text-muted)]">
                              {item.type === "STAFF"
                                ? firstQuickString(item.role, item.email)
                                : [item.id, item.client].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className={`block text-[12px] font-medium ${item.type !== "STAFF" && isLostishStatus(item.status) ? "font-bold text-red-600" : "text-[var(--rm-text-muted)]"}`}>
                              {item.type === "STAFF"
                                ? (item.projectCount === undefined ? "" : `${item.projectCount} projects`)
                                : item.status}
                            </span>
                          </div>
                        </button>
                      ))}
                    </section>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="relative mt-8 min-h-[400px]">
          <ActionHub
            key={`${selectedItem.type}:${selectedItem.id}`}
            item={selectedItem}
            initialAction={hubAction}
            initialStaffTarget={hubStaffTarget}
            onClose={() => { setSelectedItem(null); setHubAction(null); }}
            onNavigate={navigate}
          />
        </div>
      </div>
    </main>
  );
}

interface ActionMeta {
  label: string;
  sub: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  soft: string;
}

interface QuickActionFlowGeometry {
  width: number;
  height: number;
  source: { x: number; y: number };
  paths: Array<{ action: string; d: string; primary: boolean }>;
}

/** Measures the connector geometry between the sticky source card and the
 *  action-node buttons. Re-measures on resize, element size changes, AND
 *  scroll — the source card is sticky, so its on-screen position (and thus
 *  every connector path) changes while the page scrolls. */
function useQuickActionFlow(actions: readonly string[], deps: unknown[]) {
  const flowRootRef = useRef<HTMLDivElement>(null);
  const sourceCardRef = useRef<HTMLDivElement>(null);
  const actionNodeRefs = useRef<Record<string, HTMLElement | null>>({});
  const [flowGeometry, setFlowGeometry] = useState<QuickActionFlowGeometry | null>(null);
  const actionKey = actions.join("|");

  useEffect(() => {
    const measure = () => {
      const root = flowRootRef.current;
      const card = sourceCardRef.current;
      if (!root || !card) return;

      const rootBox = root.getBoundingClientRect();
      const cardBox = card.getBoundingClientRect();
      const source = {
        x: cardBox.right - rootBox.left,
        y: cardBox.top - rootBox.top + cardBox.height / 2,
      };
      const paths = actions.flatMap((action, index) => {
        const node = actionNodeRefs.current[action];
        if (!node) return [];
        const nodeBox = node.getBoundingClientRect();
        const target = {
          x: nodeBox.left - rootBox.left - 2,
          y: nodeBox.top - rootBox.top + nodeBox.height / 2,
        };
        const bend = Math.max(18, Math.min(52, (target.x - source.x) * 0.45));
        return [{
          action,
          d: `M ${source.x} ${source.y} C ${source.x + bend} ${source.y}, ${target.x - bend} ${target.y}, ${target.x} ${target.y}`,
          primary: index === 0,
        }];
      });
      if (paths.length !== actions.length) return;
      setFlowGeometry({
        width: root.clientWidth,
        height: root.clientHeight,
        source,
        paths,
      });
    };

    const frame = requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(measure);
    if (flowRootRef.current) observer?.observe(flowRootRef.current);
    if (sourceCardRef.current) observer?.observe(sourceCardRef.current);
    Object.values(actionNodeRefs.current).forEach((node) => {
      if (node) observer?.observe(node);
    });
    window.addEventListener("resize", measure);
    // Capture-phase so scrolls of inner scroll containers re-measure too.
    window.addEventListener("scroll", measure, { passive: true, capture: true });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, { capture: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionKey, ...deps]);

  return { flowRootRef, sourceCardRef, actionNodeRefs, flowGeometry };
}

function ActionFlowSvg({
  geometry,
  pathPrefix,
  colors,
}: {
  geometry: QuickActionFlowGeometry | null;
  pathPrefix: string;
  colors: Record<string, string>;
}) {
  const filterId = `${pathPrefix}-soft-glow`;
  const pathId = (action: string) => `${pathPrefix}-path-${action}`;
  const resolvedColor = (action: string) => {
    const color = colors[action] ?? "#9ba09a";
    return color.startsWith("var(") ? "#9ba09a" : color;
  };

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-0 overflow-visible"
      width={geometry?.width ?? 0}
      height={geometry?.height ?? 0}
      viewBox={`0 0 ${geometry?.width ?? 0} ${geometry?.height ?? 0}`}
      aria-hidden="true"
      fill="none"
    >
      <defs>
        <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      {geometry && (
        <>
          {geometry.paths.map(({ action, d, primary }) => {
            const color = resolvedColor(action);
            return (
              <g key={action}>
                <path
                  d={d}
                  stroke={color}
                  strokeWidth={primary ? 28 : 24}
                  strokeLinecap="round"
                  opacity={0.1}
                  filter={`url(#${filterId})`}
                />
                <path
                  id={pathId(action)}
                  d={d}
                  stroke={color}
                  strokeWidth={primary ? 2 : 1.5}
                  strokeLinecap="round"
                  opacity={primary ? 0.72 : 0.48}
                />
              </g>
            );
          })}

          <circle
            cx={geometry.source.x}
            cy={geometry.source.y}
            r="13"
            fill="none"
            stroke="var(--rm-green)"
            strokeWidth="1.25"
            opacity="0.35"
          >
            <animate attributeName="r" values="9;15;9" dur="3.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.45;0.1;0.45" dur="3.8s" repeatCount="indefinite" />
          </circle>
          <circle cx={geometry.source.x} cy={geometry.source.y} r="6.5" fill="var(--rm-green)" />
          <circle cx={geometry.source.x} cy={geometry.source.y} r="2.25" fill="var(--rm-panel)" />

          {geometry.paths.map(({ action }, index) => (
            <circle key={`dot-${action}`} r="4" fill={resolvedColor(action)} opacity="0">
              <animate
                attributeName="opacity"
                values="0;0;1;1;0"
                dur="4s"
                begin={`${index * 0.65}s`}
                repeatCount="indefinite"
              />
              <animateMotion dur="4s" begin={`${index * 0.65}s`} repeatCount="indefinite">
                <mpath href={`#${pathId(action)}`} />
              </animateMotion>
            </circle>
          ))}
        </>
      )}
    </svg>
  );
}

interface QuickLifecycleStatusData {
  current: string;
  tasks: unknown;
  cfg: StageCfg;
  phases: string[];
  baseOptions: string[];
  options: string[];
}

function ActionHub({
  item,
  initialAction,
  initialStaffTarget,
  onClose,
  onNavigate,
}: {
  item: QuickSearchItem;
  /** Set when the user started from a landing action card — the hub opens
      with this action already running (once permissions confirm it). */
  initialAction?: QuickActionId | null;
   /** Opens an existing staff action from another page. */
  initialStaffTarget?: StaffActionId | null;
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const module = isQuickLifecycleType(item.type) ? item.type : null;
  const [activePane, setActivePane] = useState<"status" | "notes" | "endings" | "leads" | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  // Tapping a permission-locked action opens an explainer popup instead of
  // doing nothing — the hover tooltip is invisible on touch devices.
  const [permissionPopupOpen, setPermissionPopupOpen] = useState(false);
  // Which locked card was tapped — the popup explains THAT card's reason.
  const [permissionPopupAction, setPermissionPopupAction] = useState<QuickActionId | null>(null);
  // Which terminal ending the user has picked but not yet confirmed.
  const [confirmingEnding, setConfirmingEnding] = useState<"lost" | "cancel" | "convert" | null>(null);
  // Add Lead pane state (mirrors the AddLeadModal in project-detail.tsx)
  const [leadRole, setLeadRole] = useState("");
  // "Add your own role" — sentinel dropdown value + the typed role label.
  const [leadRoleCustom, setLeadRoleCustom] = useState("");
  const [leadQuery, setLeadQuery] = useState("");
  const [leadPeople, setLeadPeople] = useState<{ id: string; name: string; title: string }[]>([]);
  const [leadSelName, setLeadSelName] = useState("");
  const [leadCustomMode, setLeadCustomMode] = useState(false);
  const [leadCustomName, setLeadCustomName] = useState("");
  const [leadErr, setLeadErr] = useState("");
  const [leadSaving, setLeadSaving] = useState(false);
  const [teamViewOpen, setTeamViewOpen] = useState(false);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [positionModalOpen, setPositionModalOpen] = useState(false);
  // A click during the short access/team preparation window is intentional:
  // carry it through the load rather than showing a false "locked" popup or
  // making the person click the same action again.
  const [queuedAction, setQueuedAction] = useState<QuickActionId | null>(null);
  // Person picked from the team grid's "Search & add member…" toolbar box —
  // pre-selects them in the Add Team Member popup (same as Project Detail).
  const [addMemberSeed, setAddMemberSeed] = useState<{ personId: string; personName: string; title: string } | null>(null);
  // Pencil click in the team view's no-grid table — opens the same Edit
  // Assignment popup Project Detail uses. `editMemberPeriod` scopes the edit
  // to one row of a multi-period assignment.
  const [editMemberAlloc, setEditMemberAlloc] = useState<Allocation | null>(null);
  const [editMemberPeriod, setEditMemberPeriod] = useState<{ startDate: string; endDate: string; hours: number; rwiId?: number | null } | null>(null);

  const [noteValue, setNoteValue] = useState("");
  const [descValue, setDescValue] = useState("");
  const [statusValue, setStatusValue] = useState("");
  const [visibleStatusOverride, setVisibleStatusOverride] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const statusMutationSeqRef = useRef(0);
  const stageCfgSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const detailsKey = ["quick-actions", "details", item.type, item.id] as const;
  const teamKey = ["quick-actions", "team", item.id] as const;
  const lifecycleStatusKey = ["quick-actions", "schedule-status", module, item.id] as const;
  const teamModule = module === "PMM" || module === "OPM" ? module : null;

  const detailsQuery = useQuery({
    queryKey: detailsKey,
    // Always a FRESH network read when the hub (re)opens — edits made on the
    // record page (status, notes, leads, team…) must show here immediately,
    // never a client-cache copy. `fresh: true` is caller-owned and never
    // consumes the shared one-shot arm other surfaces rely on.
    queryFn: async () =>
      asRecordFieldBag(await getProjectDetails(item.id, { module: module ?? undefined, fresh: true })),
    enabled: module !== null,
    refetchOnMount: "always",
  });
  const permissionsQuery = useQuery({
    queryKey: ["recordPermissions", item.id],
    // A selected record can have gained or lost a lifecycle since this tab was
    // last opened. Always ask the server again so an old short-lived browser
    // cache never leaves Quick Actions showing a schedule-rule lock.
    queryFn: () => getRecordPermissions(item.id, { fresh: true }),
    enabled: module !== null,
    refetchOnMount: "always",
  });
  const capabilitiesQuery = useQuery({
    queryKey: ["myCapabilities"],
    queryFn: () => getMyCapabilities({ fresh: true }),
    staleTime: 60_000,
    refetchOnMount: "always",
    enabled: module !== null,
  });
  // Start the expensive team query only after the very small access calls
  // settle. On a large project this avoids having a fresh 7-join team read
  // delay the answer that decides whether an action is actually available.
  const teamQuery = useQuery({
    queryKey: teamKey,
    queryFn: () => getProjectTeam(item.id, true),
    enabled: teamModule !== null && !!permissionsQuery.data && !!capabilitiesQuery.data,
    refetchOnMount: "always",
  });
  const lifecycleStatusQuery = useQuery<QuickLifecycleStatusData>({
    queryKey: lifecycleStatusKey,
    queryFn: async () => {
      const field = module === "OPM" ? "CRMOpportunityStatusChoice" : "CRMProjectStatusChoice";
      const [tasks, config] = await Promise.all([getTaskData(item.id, "0"), getStageCfg(item.id, field, { strict: true })]);
      const phases = schedulePhaseNames(tasks);
      const cfg = parseStageCfg(config);
      // CONFIRMED no lifecycle (task fetch answered empty): mirror the record
      // page and the Projects-list modal — the base list is EMPTY, so only the
      // record's own Override-cfg customs (plus typed entries) show. Never the
      // tenant-wide status pile. One record = ONE status list on every surface.
      const baseOptions = phases;
      return {
        current: currentSchedulePhase(tasks),
        tasks,
        cfg,
        phases,
        baseOptions,
        options: applyStageCfgToOptions(baseOptions, cfg, phases.length > 0),
      };
    },
    enabled: module === "PMM" || module === "OPM",
    staleTime: 60_000,
  });
  const leadStatusOptionsQuery = useQuery({
    queryKey: ["statusOptions", module],
    queryFn: () => getFieldOptions("status", module!),
    enabled: module === "LEM" && activePane === "status",
  });

  const detailFields = useMemo(
    () => ({ ...(item.raw ?? {}), ...asFieldBag(detailsQuery.data) }),
    [item.raw, detailsQuery.data],
  );
  const detailItem = module ? mapQuickModuleRecord(detailFields, module) : item;
  const storedStatus = firstQuickString(detailItem.status, item.status);
  const configuredStoredStatus = lifecycleStatusQuery.data
    && isConfiguredCustomStatus(storedStatus, lifecycleStatusQuery.data.cfg)
    ? storedStatus
    : "";
  // A terminal stored status (Lost/Cancelled/Closed…) is the record's truth —
  // it must beat the schedule's date-derived current phase, exactly like the
  // record detail page shows it.
  const endedStoredStatus = isClosedishStatus(storedStatus) ? storedStatus : "";
  // Manual latch (mirrors the server's auto-advance rule): when a human chose
  // the status on/after the last-started phase began, automation won't fight
  // them — so the DISPLAY must show their choice too, not the date-derived
  // phase. Without this, a saved status change looks like it silently failed.
  const latchedStoredStatus = storedStatus
    && lifecycleStatusQuery.data
    && manualStatusWins(detailFields.StatusManualDate, schedulePhaseStartDays(lifecycleStatusQuery.data.tasks))
    ? storedStatus
    : "";
  const currentStatus = firstQuickString(
    visibleStatusOverride,
    endedStoredStatus,
    configuredStoredStatus,
    latchedStoredStatus,
    lifecycleStatusQuery.data?.current,
    storedStatus,
  );
  const statusOptions = module === "PMM" || module === "OPM"
    ? lifecycleStatusQuery.data?.options ?? []
    : leadStatusOptionsQuery.data ?? [];
  const quickScheduleBounds = useMemo(() => {
    if (!lifecycleStatusQuery.data) return { start: "", end: "" };
    const schedule = derivePlannerSchedule(lifecycleStatusQuery.data.tasks);
    if (schedule.state !== "ready" || schedule.phases.length === 0) {
      return { start: "", end: "" };
    }
    return {
      start: schedule.phases.reduce(
        (earliest, phase) => phase.start < earliest ? phase.start : earliest,
        schedule.phases[0].start,
      ),
      end: schedule.phases.reduce(
        (latest, phase) => phase.end > latest ? phase.end : latest,
        schedule.phases[0].end,
      ),
    };
  }, [lifecycleStatusQuery.data]);
  const projectName = firstQuickString(detailItem.title, item.title, item.id);
  const clientName = firstQuickString(detailItem.client, item.client);
  const targetStart = firstQuickString(detailFields.TargetStartDate).slice(0, 10);
  const targetEnd = firstQuickString(detailFields.TargetCompletionDate).slice(0, 10);
  // PMM ticket ID whose title matches this opportunity. This intentionally
  // runs only when the endings pane opens so the hub does not add another
  // module-list request for every selected record.
  const [linkedPmmId, setLinkedPmmId] = useState<string | null>(null);
  const [conversionCheckPending, setConversionCheckPending] = useState(false);
  const conversionTitle = firstQuickString(detailItem.title, item.title);
  useEffect(() => {
    if (activePane !== "endings" || module !== "OPM" || !conversionTitle) {
      setLinkedPmmId(null);
      setConversionCheckPending(false);
      return;
    }
    const title = conversionTitle.trim().toLowerCase();
    let cancelled = false;
    const findIn = (rows: Record<string, unknown>[]) =>
      rows.find((record) => String(record.Title ?? "").trim().toLowerCase() === title);
    const applyMatch = (record: Record<string, unknown> | undefined) => {
      if (cancelled) return;
      setLinkedPmmId(record ? String(record.TicketId ?? record.ID ?? "") || null : null);
      setConversionCheckPending(false);
    };

    setLinkedPmmId(null);
    setConversionCheckPending(true);
    const peek = peekCached<{ data?: Record<string, unknown>[] }>("module:PMM");
    const cachedMatch = findIn(peek?.data ?? []);
    if (cachedMatch) {
      applyMatch(cachedMatch);
      return () => { cancelled = true; };
    }

    void getModuleRecords("PMM")
      .then((response) => applyMatch(findIn(response.data)))
      .catch(() => {
        // Do not block conversion when the advisory lookup is unavailable.
        if (!cancelled) setConversionCheckPending(false);
      });
    return () => { cancelled = true; };
  }, [activePane, conversionTitle, module]);
  const teamData: ProjectTeamResponse = teamQuery.data ?? { team: [], openRoles: [] };
  const canManageStaff = capabilitiesQuery.data?.caps.manageStaff === true;
  const accessChecksPending = !permissionsQuery.data && !permissionsQuery.isError
    || !capabilitiesQuery.data && !capabilitiesQuery.isError;
  const teamPending = teamModule !== null
    && !accessChecksPending
    && !teamQuery.data
    && (teamQuery.isLoading || teamQuery.isFetching);
  const actionNeedsTeam = (action: QuickActionId) =>
    action === "team" || action === "position" || action === "allocation";
  const actionPreparationPending = (action: QuickActionId) =>
    action !== "open" && (accessChecksPending || (actionNeedsTeam(action) && teamPending));
  const canViewTeam = teamModule !== null && canViewQuickTeam(item.type);
  const canEditTeam = canUseQuickAction(module ?? item.type, "team", permissionsQuery.data, canManageStaff);

  // Immediate team insert after an add: patch BOTH caches — the shared
  // project-team key (other surfaces) AND this hub's own team query, which is
  // what the open team view actually renders. Background refresh reconciles.
  const applyQuickTeamOptimistic = (personName: string, optimistic: OptimisticAssignedMember) => {
    applyOptimisticProjectTeamMember(queryClient, item.id, { ...optimistic, name: personName });
    queryClient.setQueryData<ProjectTeamResponse>([...teamKey], (current) => {
      if (!current) return current;
      const exists = current.team.some((m) =>
        (optimistic.id && m.resourceId === optimistic.id) || m.name === personName);
      if (exists) return current;
      const member: ProjectTeamMember = {
        name: personName,
        role: optimistic.role,
        bu: optimistic.bu,
        title: optimistic.title,
        eacHrs: optimistic.hours ?? 0,
        etcHrs: optimistic.hours ?? 0,
        costRate: 0,
        eacCost: 0,
        etcCost: 0,
        ncHrs: 0,
        ncCost: 0,
        pctAllocation: optimistic.pct,
        startDate: optimistic.startDate,
        endDate: optimistic.endDate,
        resourceId: optimistic.id || undefined,
        weeklyHours: [],
      };
      return { ...current, team: [...current.team, member] };
    });
  };

  // Landing "start from an action" card → open that action automatically once
  // permissions confirm it. One-shot per hub instance (the hub remounts per
  // record via its key). Mirrors exactly what clicking the hub card would do.
  // Status/notes only need record permissions; team/position/allocation also
  // need capabilities — but a FAILED capabilities load must not hang the
  // dispatch forever (fall through; the permission check then declines).
  const initialActionFiredRef = useRef(false);
  useEffect(() => {
    if (initialActionFiredRef.current || !initialAction || !module) return;
    if (!permissionsQuery.data) return;
    const needsCapabilities = initialAction === "team" || initialAction === "position" || initialAction === "allocation";
    if (needsCapabilities && !capabilitiesQuery.data && !capabilitiesQuery.isError) return;
    initialActionFiredRef.current = true;
    if (!canUseQuickAction(module, initialAction, permissionsQuery.data, canManageStaff)) {
      toast({
        title: "That action isn't available here",
        description: "You don't have permission for it on this record — the cards below show what you can do.",
      });
      return;
    }
    if (initialAction === "team") {
      setTeamModalOpen(true);
      refreshProjectTeamCache(queryClient, item.id);
    } else if (initialAction === "position") {
      setPositionModalOpen(true);
    } else if (initialAction === "allocation") {
      setTeamViewOpen(true);
    } else if (initialAction === "status" || initialAction === "notes" || initialAction === "endings" || initialAction === "leads") {
      setActivePane(initialAction);
    }
  }, [initialAction, module, permissionsQuery.data, capabilitiesQuery.data, capabilitiesQuery.isError, canManageStaff, item.id, queryClient]);

  useEffect(() => {
    setErrorMessage("");
    if (!module || !activePane) return;
    if (activePane === "status") {
      setStatusValue(currentStatus);
      return;
    }
    setNoteValue(firstQuickString(detailFields[quickActionFieldName(module, "note", detailFields)]));
    setDescValue(firstQuickString(detailFields[quickActionFieldName(module, "description", detailFields)]));
  }, [activePane, currentStatus, detailFields, module]);

  const refreshAfterMutation = useCallback(async (action: QuickActionId) => {
    if (!module) return;
    const targets = quickActionRefreshTargets(module, action);
    if (targets.length === 0) return;
    setRefreshing(true);
    try {
      markProjectDetailRefetchFresh(item.id);
      const [freshDetails, freshModule, freshTeam] = await Promise.all([
        getProjectDetails(item.id, { module }),
        getModuleRecordsFresh(module),
        targets.includes("team") ? getProjectTeam(item.id, true) : Promise.resolve(null),
      ]);
      queryClient.setQueryData(detailsKey, asRecordFieldBag(freshDetails));
      queryClient.setQueryData([module.toLowerCase()], freshModule);
      if (freshTeam) queryClient.setQueryData(teamKey, freshTeam);
      // The flag was consumed by the getProjectDetails call above.  Re-arm it
      // so the project-detail page also gets a fresh read the next time it
      // loads, regardless of which action triggered this refresh.
      markProjectDetailRefetchFresh(item.id);
    } finally {
      setRefreshing(false);
    }
  }, [detailsKey, item.id, module, queryClient, teamKey]);

  const reconcileStatusAfterMutation = useCallback(async (
    fieldName: string,
    expectedStatus: string,
    mutationSeq: number,
  ) => {
    if (!module) return;
    markProjectDetailRefetchFresh(item.id);
    const freshFields = asRecordFieldBag(await getProjectDetails(item.id, { module }));
    if (statusMutationSeqRef.current !== mutationSeq) return;

    const confirmedStatus = mapQuickModuleRecord(freshFields, module).status ?? "";
    const confirmed = confirmedStatus.trim().toLowerCase() === expectedStatus.trim().toLowerCase();
    // Keep the accepted write visible even when the fresh read is stale — a
    // lagging server copy must not roll the card back to the pre-save status.
    const reconciledFields = confirmed
      ? freshFields
      : { ...freshFields, [fieldName]: expectedStatus };
    queryClient.setQueryData(detailsKey, reconciledFields);
    if (confirmed) {
      setVisibleStatusOverride((current) =>
        current.trim().toLowerCase() === expectedStatus.trim().toLowerCase() ? "" : current
      );
      patchQuickProjectSnapshotStatus(item.id, fieldName, confirmedStatus);
    } else {
      // Keep the accepted write visible: server truth hasn't caught up with
      // the user's confirmed selection yet, so the snapshot keeps showing the
      // status they just saved instead of flashing the stale value back.
      patchQuickProjectSnapshotStatus(item.id, fieldName, expectedStatus);
    }
  }, [detailsKey, item.id, module, queryClient]);

  if (!module) {
    if (item.type === "STAFF") {
      return <StaffActionHub item={item} initialTarget={initialStaffTarget} onClose={onClose} onNavigate={onNavigate} />;
    }
    return (
      <div className="flex flex-col items-center gap-4 animate-in fade-in slide-in-from-bottom-8 duration-500 ease-out">
        <div className="w-full max-w-md rounded-3xl border border-[var(--rm-panel-border)] bg-[var(--rm-panel)] shadow-2xl overflow-hidden">
          <div className="p-8 border-b border-[var(--rm-panel-border)] relative">
            <div className="absolute top-0 left-0 right-0 h-1.5" style={{ backgroundColor: TYPE_STYLES[item.type].color }} />
            <div className="flex justify-between items-start mb-6">
               <TypeBadge item={item} />
               <button onClick={onClose} className="rounded-full p-2 text-[var(--rm-text-muted)] hover:bg-[var(--rm-bg)] hover:text-[var(--rm-text)] transition"><X className="h-5 w-5" /></button>
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight">{item.title}</h2>
          </div>
          <div className="p-8 bg-[var(--rm-bg)] grid gap-y-6">
            <dl className="grid grid-cols-1 gap-6">
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--rm-text-faint)]">Company ID</dt>
                <dd className="mt-1.5 text-[15px] font-medium">{item.id}</dd>
              </div>
            </dl>

            <button
               type="button"
               onClick={() => onNavigate(quickActionPath(item))}
               className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--rm-green)] px-4 py-3.5 text-[15px] font-bold text-white transition hover:brightness-95 shadow-md"
            >
               Open Company
               <ExternalLink className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="w-full max-w-md">
          <AuditTrailCard title="Audit Trail" entityType="company" entityId={item.id} />
        </div>
      </div>
    );
  }

  const actionMeta: Record<QuickActionId, ActionMeta> = {
    team: {
      label: "Add team member",
      sub: teamPending ? "Loading team…" : `${teamData.team.length} currently assigned`,
      icon: UserPlus,
      color: "#5E9637",
      soft: "rgba(107,165,57,0.15)",
    },
    position: {
      label: "Add open position",
      sub: teamPending ? "Loading team…" : `${teamData.openRoles.length} currently open`,
      icon: BriefcaseBusiness,
      color: "#2879A8",
      soft: "rgba(56,189,248,0.15)",
    },
    status: {
      label: "Change status",
      sub: currentStatus || "No status set",
      icon: Target,
      color: "#7C5CB4",
      soft: "rgba(167,139,250,0.15)",
    },
    allocation: {
      label: "Edit existing allocation",
      sub: teamPending
        ? "Loading team…"
        : teamData.team.length
        ? `Adjust hours for ${teamData.team.length} member${teamData.team.length === 1 ? "" : "s"}`
        : "No team members yet",
      icon: SlidersHorizontal,
      color: "#0E8074",
      soft: "rgba(20,184,166,0.15)",
    },
    notes: {
      label: "Notes & description",
      sub: "Edit both in one place",
      icon: FileText,
      color: "#B75B18",
      soft: "rgba(232,119,34,0.15)",
    },
    endings: {
      label: module === "PMM" ? "Close project" : "Close or convert",
      sub: module === "PMM"
        ? "Mark as lost or cancel this project"
        : module === "OPM"
          ? "Advance to project, lost, or cancel"
          : "Advance to opportunity, lost, or cancel",
      icon: Flag,
      color: "#9B3B2C",
      soft: "rgba(155,59,44,0.1)",
    },
    leads: {
      label: "Add Lead",
      sub: "Assign key personnel to this record",
      icon: UserPlus,
      color: "#B08000",
      soft: "rgba(176,128,0,0.12)",
    },
    open: {
      label: "Open full record",
      sub: "Go to the detail page",
      icon: ExternalLink,
      color: "var(--rm-text-muted)",
      soft: "var(--rm-panel-soft)",
    },
  };

  const actions = quickActionIdsForType(module);
  const flowActions = [...actions, "audit"] as const;
  const flowColors = Object.fromEntries(
    flowActions.map((action) => [action, action === "audit" ? "#5E9637" : actionMeta[action].color]),
  );
  const { flowRootRef, sourceCardRef, actionNodeRefs, flowGeometry } = useQuickActionFlow(flowActions, [
    activePane,
    clientName,
    currentStatus,
    detailsQuery.isLoading,
    item.id,
    quickScheduleBounds.end,
    quickScheduleBounds.start,
    targetEnd,
    targetStart,
    teamData.openRoles.length,
    teamData.team.length,
  ]);
  // Per-card lock reasons: each card names the SPECIFIC setting that locks it
  // (staffing → manage-staff, status/endings → stage advance, rest → the
  // server's editData reason). One blanket message previously covered every
  // card, which read as a bug when only one capability was unticked.
  const lockReasonFor = useCallback(
    (action: QuickActionId): string | undefined =>
      accessChecksPending
        ? undefined
        : quickActionLockReason(module, action, permissionsQuery.data, canManageStaff) ?? undefined,
    [accessChecksPending, module, permissionsQuery.data, canManageStaff],
  );
  const blockedReasons = useMemo(() => {
    if (accessChecksPending || !permissionsQuery.data) return [] as string[];
    const out: string[] = [];
    for (const a of actions) {
      const r = a === "open" ? null : quickActionLockReason(module, a, permissionsQuery.data, canManageStaff);
      if (r && !out.includes(r)) out.push(r);
    }
    return out;
  }, [accessChecksPending, actions, module, permissionsQuery.data, canManageStaff]);

  const chooseAction = useCallback((action: QuickActionId) => {
    setErrorMessage("");
    if (action === "open") {
      onNavigate(quickActionPath(item));
    } else if (action === "team") {
      setActivePane(null);
      setTeamModalOpen(true);
      refreshProjectTeamCache(queryClient, item.id);
    } else if (action === "position") {
      setActivePane(null);
      setPositionModalOpen(true);
    } else if (action === "allocation") {
      setActivePane(null);
      setTeamViewOpen(true);
    } else {
      if (action !== "endings") setConfirmingEnding(null);
      if (action !== "leads") { setLeadSelName(""); setLeadCustomName(""); setLeadCustomMode(false); setLeadQuery(""); setLeadErr(""); }
      setActivePane(action);
    }
  }, [item, onNavigate, queryClient]);

  useEffect(() => {
    if (!queuedAction || actionPreparationPending(queuedAction)) return;
    const flushed = queuedAction;
    setQueuedAction(null);
    if (!canUseQuickAction(module, flushed, permissionsQuery.data, canManageStaff)) {
      // Keep the popup card-specific for queued taps too — without this the
      // deferred deny falls back to the generic blanket reason.
      setPermissionPopupAction(flushed);
      setPermissionPopupOpen(true);
      return;
    }
    chooseAction(flushed);
  }, [
    canManageStaff,
    chooseAction,
    module,
    permissionsQuery.data,
    queuedAction,
    teamPending,
    capabilitiesQuery.data,
    capabilitiesQuery.isError,
  ]);

  const toggleQuickTeamFlag = useCallback(async (
    member: ProjectTeamMember,
    flag: "soft" | "nc" | "locked",
    value: boolean,
    costRate?: number,
  ): Promise<boolean> => {
    if (!member.resourceId) {
      toast({
        title: "Flag not changed",
        description: `${member.name} is not linked to a staff record.`,
        variant: "destructive",
      });
      return false;
    }
    try {
      // NC cost-rate is financial data — strip it for users without the
      // financial capability (server rejects it anyway); the flag itself is
      // a staffing action and still applies.
      let rateToSend = costRate;
      if (flag === "nc" && value && rateToSend != null) {
        try {
          const mc = await getMyCapabilitiesChecked();
          if (mc?.caps?.editFinancials !== true) rateToSend = undefined;
        } catch { rateToSend = undefined; }
      }
      await setAllocationFlag(item.id, member.resourceId, flag, value, rateToSend);
      void refreshAfterMutation("team");
      return true;
    } catch (error) {
      const label = flag === "soft" ? "soft allocation" : flag === "nc" ? "non-chargeable" : "lock";
      toast({
        title: "Flag not changed",
        description: `Couldn’t ${value ? "set" : "clear"} the ${label}: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
      });
      return false;
    }
  }, [item.id, refreshAfterMutation, toast]);

  // Pre-fetch the user roster on mount so it's ready the moment the leads
  // pane opens (no "Loading roster…" flash). Cached in state for the lifetime
  // of the component so switching panes never re-fetches. Field mapping
  // mirrors the Project Leads card in project-detail: /user-list rows carry
  // capitalized keys (Id / Name / JobProfile), not id / name / title.
  useEffect(() => {
    if (leadPeople.length > 0) return undefined;
    let alive = true;
    getUserList().then((rows) => {
      if (!alive || !Array.isArray(rows)) return;
      const seen = new Set<string>();
      const ppl: { id: string; name: string; title: string }[] = [];
      for (const u of rows as Record<string, unknown>[]) {
        const uid = String(u.Id ?? "").toLowerCase();
        const name = String(u.Name ?? "").trim();
        if (!uid || !name || u.Deleted === true) continue;
        if (/^[0-9a-f]{8}-/.test(name)) continue; // GUID-as-name placeholder rows
        if (seen.has(uid)) continue;
        seen.add(uid);
        ppl.push({ id: uid, name, title: String(u.JobProfile ?? "").trim() });
      }
      ppl.sort((a, b) => a.name.localeCompare(b.name));
      setLeadPeople(ppl);
    }).catch(() => { /* fail-open: search still works for typing */ });
    return () => { alive = false; };
  }, [leadPeople.length]);

  const saveLead = async () => {
    const name = (leadCustomMode ? leadCustomName : leadSelName).trim();
    const isCustomRole = leadRole === QA_CUSTOM_ROLE;
    const customRoleLabel = leadRoleCustom.trim();
    if (!leadRole || (isCustomRole && !customRoleLabel) || !name || !module) {
      setLeadErr(!leadRole || (isCustomRole && !customRoleLabel) ? "Choose or type a role first." : "Choose or type a person's name.");
      return;
    }
    // Custom (user-typed) roles append into the record's CustomLeadsJson
    // column (names only); predefined roles append to their *User column.
    let fieldName: string;
    let newVal: string;
    let roleLabel: string;
    if (isCustomRole) {
      roleLabel = customRoleLabel;
      const next = addCustomLead(detailFields[CUSTOM_LEADS_FIELD], roleLabel, name);
      if (next == null) {
        setLeadErr(`${name} is already listed as ${roleLabel}.`);
        return;
      }
      fieldName = CUSTOM_LEADS_FIELD;
      newVal = next;
    } else {
      roleLabel = KP_LEAD_ROLES.find((r) => r.field === leadRole)?.role ?? "Lead";
      const raw = String(detailFields[leadRole] ?? "").trim();
      // Duplicate guard: exact name match (case-insensitive)
      const existing = raw.split(/[,;]+/).map((t) => t.trim()).filter(Boolean);
      if (existing.some((t) => t.toLowerCase() === name.toLowerCase())) {
        setLeadErr(`${name} is already listed in this role.`);
        return;
      }
      newVal = raw ? `${raw.replace(/[,;\s]+$/, "")}, ${name}` : name;
      if (newVal.length > 500) {
        setLeadErr("Too many people in this role — remove someone first.");
        return;
      }
      fieldName = leadRole;
    }
    setLeadErr("");

    // ── Optimistic save ──────────────────────────────────────────────────────
    // Snapshot the current cache for rollback, then immediately apply the new
    // value so the UI feels instant. The actual API call fires in the
    // background; if it fails we revert and surface a toast.
    const prevFields = asFieldBag(queryClient.getQueryData(detailsKey));
    queryClient.setQueryData(detailsKey, { ...prevFields, [fieldName]: newVal });

    // Keep a copy of the person values so we can restore the form on failure.
    const savedName = name;
    const savedCustomMode = leadCustomMode;
    const savedCustomName = leadCustomName;
    const savedSelName = leadSelName;
    const savedRoleLabel = roleLabel;

    // Reset pickers immediately — keep the role for back-to-back adds.
    setLeadSelName("");
    setLeadCustomName("");
    setLeadCustomMode(false);
    setLeadQuery("");
    toast({ title: "Lead added", description: `${savedName} added as ${savedRoleLabel}.` });

    // Background write — revert on failure.
    updateFields(
      item.id,
      [{ FieldName: fieldName, Value: newVal }],
      { lifecycleModules: [module] },
    ).then((result) => {
      if (!result.ok) throw new Error(result.error || "Could not save.");
      void refreshAfterMutation("leads");
    }).catch((e: unknown) => {
      // Revert the optimistic patch.
      queryClient.setQueryData(detailsKey, prevFields);
      // Restore form so the user can retry.
      setLeadCustomMode(savedCustomMode);
      setLeadCustomName(savedCustomName);
      setLeadSelName(savedSelName);
      setLeadErr(e instanceof Error ? e.message : "Could not save the lead. Try again.");
      toast({
        title: "Lead not saved",
        description: e instanceof Error ? e.message : "Could not save the lead. Try again.",
        variant: "destructive",
      });
    });
  };

  const persistField = async (
    action: "status" | "notes",
    updates: { fieldName: string; value: string }[],
  ) => {
    if (updates.length === 0 || !module) return;
    const { fieldName, value } = updates[0];
    if (action === "status" && (module === "PMM" || module === "OPM")) {
      const lifecycle = lifecycleStatusQuery.data;
      if (lifecycleStatusQuery.isLoading || lifecycleStatusQuery.isError || !lifecycle) {
        const message = lifecycleStatusQuery.isError
          ? "We couldn’t verify this record’s schedule. Try again before changing its status."
          : "Checking this record’s schedule before changing status.";
        setErrorMessage(message);
        toast({ title: "Status change paused", description: message, variant: "destructive" });
        return;
      }
      const future = futureSchedulePhase(value, lifecycle.tasks, lifecycle.cfg);
      if (future) {
        const message = `${future.phase} is scheduled to start on ${new Date(`${future.startDay}T00:00:00`).toLocaleDateString()}. Change the schedule instead of moving this record ahead.`;
        setErrorMessage(message);
        toast({ title: "Status follows the schedule", description: message, variant: "destructive" });
        return;
      }
    }
    const mutationSeq = action === "status"
      ? ++statusMutationSeqRef.current
      : statusMutationSeqRef.current;
    const priorCurrentStatus = currentStatus;
    const priorVisibleStatus = visibleStatusOverride;
    const previousLifecycle = lifecycleStatusQuery.data ?? null;
    let nextStageCfg: StageCfg | null = null;
    let configChanged = false;
    if (action === "status" && (module === "PMM" || module === "OPM")) {
      const lifecycle = lifecycleStatusQuery.data!;
      if (!lifecycle.options.some((option) => option.trim().toLowerCase() === value.trim().toLowerCase())) {
        nextStageCfg = ensureCustomStatusInStageCfg(lifecycle.cfg, lifecycle.baseOptions, value);
        configChanged = JSON.stringify(nextStageCfg) !== JSON.stringify(lifecycle.cfg);
        if (!configChanged) nextStageCfg = null;
      }
    }

    if (action === "status") {
      setVisibleStatusOverride(value);
      setStatusValue(value);
      if (nextStageCfg && previousLifecycle) {
        queryClient.setQueryData(lifecycleStatusKey, {
          ...previousLifecycle,
          cfg: nextStageCfg,
          options: applyStageCfgToOptions(
            previousLifecycle.baseOptions,
            nextStageCfg,
            previousLifecycle.phases.length > 0,
          ),
        });
      }
    }

    setSubmitting(true);
    setErrorMessage("");
    try {
      const result = await updateFields(
        item.id,
        updates.map((entry) => ({ FieldName: entry.fieldName, Value: entry.value })),
        { lifecycleModules: [module] },
      );
      if (!result.ok) throw new Error(result.error || "The record could not be updated.");
      const savedEntries = updates.map((entry) => ({
        fieldName: entry.fieldName,
        value: action === "status" ? firstQuickString(result.landedStage, entry.value) : entry.value,
      }));
      const savedValue = savedEntries[0].value;

      queryClient.setQueryData(detailsKey, (previous: unknown) => {
        const next = { ...asFieldBag(previous) };
        for (const entry of savedEntries) next[entry.fieldName] = entry.value;
        // Mirror the server's manual-latch stamp so the display honors the
        // just-saved choice immediately (the refetched detail carries the
        // real StatusManualDate).
        if (action === "status") next.StatusManualDate = new Date().toISOString();
        return next;
      });

      queryClient.setQueryData([module.toLowerCase()], (previous: unknown) => {
        const box = asFieldBag(previous);
        if (!Array.isArray(box.data)) return previous;
        return {
          ...box,
          data: box.data.map((record) => {
            const fields = asFieldBag(record);
            if (mapQuickModuleRecord(fields, module).id !== item.id) return record;
            const nextFields = { ...fields };
            for (const entry of savedEntries) nextFields[entry.fieldName] = entry.value;
            if (action === "status") nextFields.StatusManualDate = new Date().toISOString();
            return nextFields;
          }),
        };
      });

      if (action === "status") {
        setVisibleStatusOverride(savedValue);
        setStatusValue(savedValue);
        patchQuickProjectSnapshotStatus(item.id, fieldName, savedValue);
      }
      if (action !== "status") setActivePane(null);
      toast({
        title: action === "status"
          ? "Status updated"
          : savedEntries.length > 1
            ? "Note & description saved"
            : savedEntries[0].fieldName === "Description" ? "Description saved" : "Note saved",
        description: action === "status" && nextStageCfg
          ? `${savedValue} is saved. Its reusable status option is syncing in the background.`
          : "The selected record was updated. Search results are syncing now.",
      });

      if (action === "status") {
        if (configChanged && nextStageCfg && previousLifecycle) {
          const cfgBaseOptions = previousLifecycle.baseOptions;
          const cfgMutationSeq = mutationSeq;
          const queuedSave = stageCfgSaveQueueRef.current
            .catch(() => undefined)
            .then(async () => {
              // Merge against a FRESHLY re-read cfg — saveStageCfg replaces
              // the whole document, so saving the hub's open-time copy would
              // wipe a custom status added on another surface (record page /
              // projects list) since the hub loaded.
              const freshCfg = parseStageCfg(await getStageCfg(item.id, fieldName, { strict: true }));
              const merged = ensureCustomStatusInStageCfg(freshCfg, cfgBaseOptions, savedValue);
              if (JSON.stringify(merged) !== JSON.stringify(freshCfg)) {
                await saveStageCfg(item.id, fieldName, merged, { strict: true });
              }
              if (statusMutationSeqRef.current !== cfgMutationSeq) return;
              const stageCfgKey = tenantScopedKey(`rmone:stageCfg:${fieldName}:${item.id}`);
              try { localStorage.setItem(stageCfgKey, JSON.stringify(merged)); } catch { /* storage unavailable */ }
              try {
                window.dispatchEvent(new CustomEvent("rmone:stageCfgChanged", { detail: { key: stageCfgKey } }));
              } catch { /* non-browser environment */ }
            });
          stageCfgSaveQueueRef.current = queuedSave.then(() => undefined, () => undefined);
          void queuedSave.catch((configError) => {
            console.warn("[quick-actions] status saved but custom option sync failed", configError);
            if (statusMutationSeqRef.current !== cfgMutationSeq) return;
            toast({
              title: "Status saved; option sync delayed",
              description: "The record status is updated, but the reusable custom option could not be saved yet.",
            });
            void lifecycleStatusQuery.refetch();
          });
        }
        void reconcileStatusAfterMutation(fieldName, savedValue, mutationSeq).catch((refreshError) => {
          console.warn("[quick-actions] saved status but detail reconciliation failed", refreshError);
        });
      } else {
        void refreshAfterMutation(action).catch((error) => {
          console.warn("[quick-actions] saved record but refresh failed", error);
          toast({
            title: "Saved; refresh delayed",
            description: "The change is visible here, but the latest server summary could not be reloaded yet.",
          });
        });
      }
    } catch (error) {
      if (action === "status" && statusMutationSeqRef.current === mutationSeq) {
        setVisibleStatusOverride(priorVisibleStatus);
        setStatusValue(priorCurrentStatus);
        if (previousLifecycle) queryClient.setQueryData(lifecycleStatusKey, previousLifecycle);
      }
      const message = error instanceof Error ? error.message : "The record could not be updated.";
      setErrorMessage(message);
      toast({ title: "Change not saved", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const noteFieldName = quickActionFieldName(module, "note", detailFields);
  const descFieldName = quickActionFieldName(module, "description", detailFields);
  const storedNote = firstQuickString(detailFields[noteFieldName]).trim();
  const storedDesc = firstQuickString(detailFields[descFieldName]).trim();
  const notesDirty = noteValue.trim() !== storedNote || descValue.trim() !== storedDesc;

  const saveNotes = () => {
    if (activePane !== "notes") return;
    const updates: { fieldName: string; value: string }[] = [];
    if (noteValue.trim() !== storedNote) updates.push({ fieldName: noteFieldName, value: noteValue.trim() });
    if (descValue.trim() !== storedDesc) updates.push({ fieldName: descFieldName, value: descValue.trim() });
    if (updates.length === 0) return;
    void persistField("notes", updates);
  };

  // Executes a confirmed terminal ending: Lost / Cancel write to the status
  // field (same API as "Change status"); Convert writes a seed and navigates.
  const executeEnding = async (kind: "lost" | "cancel" | "convert") => {
    if (!module || (module !== "PMM" && module !== "OPM" && module !== "LEM")) return;
    if (kind === "convert") {
      // PMM has no convert path — projects are the final destination.
      if (module === "PMM") return;
      writeConvertSeed(item.id, detailFields);
      const path = module === "OPM"
        ? `/project/create?fromOpp=${encodeURIComponent(item.id)}`
        : `/opportunity/create?fromLead=${encodeURIComponent(item.id)}`;
      setActivePane(null);
      setConfirmingEnding(null);
      onNavigate(path);
      return;
    }
    // PMM cancel → "Cancelled"; OPM/LEM cancel → "Closed" (matches OppLifecycleFooter)
    const statusValue = kind === "lost" ? "Lost" : module === "PMM" ? "Cancelled" : "Closed";
    const fieldName = quickActionFieldName(module, "status", detailFields);
    setSubmitting(true);
    setErrorMessage("");
    try {
      const result = await updateFields(
        item.id,
        [{ FieldName: fieldName, Value: statusValue }],
        { lifecycleModules: [module] },
      );
      if (!result.ok) throw new Error(result.error || "The record could not be updated.");
      const landed = firstQuickString(result.landedStage, statusValue);
      setVisibleStatusOverride(landed);
      queryClient.setQueryData(detailsKey, (previous: unknown) => {
        const next = { ...asFieldBag(previous) };
        next[fieldName] = landed;
        return next;
      });
      setActivePane(null);
      setConfirmingEnding(null);
      void refreshAfterMutation("status").catch((error) => {
        console.warn("[quick-actions] endings refresh failed", error);
      });
      toast({
        title: kind === "lost" ? "Marked as Lost" : "Record cancelled",
        description: `${projectName} has been updated.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The record could not be updated.";
      setErrorMessage(message);
      toast({ title: "Change not saved", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const modalMutationFinished = (
    action: "team" | "position",
    message: string,
    personName?: string,
    optimistic?: OptimisticAssignedMember,
  ) => {
    if (action === "team" && personName && optimistic) {
      applyQuickTeamOptimistic(personName, optimistic);
    }
    if (action === "team") { setTeamModalOpen(false); setAddMemberSeed(null); }
    else setPositionModalOpen(false);
    void refreshAfterMutation(action)
      .then(() => toast({ title: message, description: "The action hub now shows the latest team data." }))
      .catch((error) => {
        console.warn("[quick-actions] team mutation refresh failed", error);
        toast({
          title: message,
          description: "The change was saved, but the latest summary could not be reloaded yet.",
        });
      });
  };

  // Same removal rules as the Project Detail team surfaces: the grid hosts
  // the shared audit-log confirm popup; these handlers run ONLY the mutation
  // and refresh in the background (never hold the popup open on a slow load).
  const removeQuickTeamMember = async (member: ProjectTeamMember) => {
    if (!member.resourceId) {
      toast({
        title: "Couldn't remove member",
        description: `${member.name} has no linked person record.`,
        variant: "destructive",
      });
      return;
    }
    try {
      await removeTeamMember(item.id, member.resourceId);
      void refreshAfterMutation("team").catch((error) => {
        console.warn("[quick-actions] refresh after member removal failed", error);
      });
    } catch (error) {
      console.warn("[quick-actions] remove member failed", error);
      toast({
        title: "Couldn't remove member",
        description: `${member.name} could not be removed. Please try again.`,
        variant: "destructive",
      });
    }
  };

  const removeQuickOpenPosition = async (role: OpenRole) => {
    const ids = (role.raIds ?? []).filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) {
      toast({
        title: "Couldn't remove open position",
        description: "It has no linked demand rows. Reload the team view and try again.",
        variant: "destructive",
      });
      return;
    }
    try {
      const out = await removeOpenPosition(item.id, ids);
      // Demand rows feed the Resources page too — bust its caches as well.
      notifyAllocationChanged();
      void refreshAfterMutation("team").catch((error) => {
        console.warn("[quick-actions] refresh after open-position removal failed", error);
      });
      if (out.alreadyGone) {
        toast({
          title: "Position already gone",
          description: "It was already removed or has just been filled. The team list is refreshing.",
        });
      }
    } catch (error) {
      console.warn("[quick-actions] remove open position failed", error);
      toast({
        title: "Couldn't remove open position",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const oneYearFromToday = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

  const renderActionCard = (action: QuickActionId) => {
    const meta = actionMeta[action];
    const Icon = meta.icon;
    const preparing = actionPreparationPending(action);
    const allowed = !preparing && canUseQuickAction(module, action, permissionsQuery.data, canManageStaff);
    const blocked = !preparing && !allowed;
    const disabled = submitting || refreshing;
    const active = activePane === action;
    const highlighted = !blocked && !preparing && (active || (!activePane && action === actions[0]));
    const queued = queuedAction === action;
    const loadingLabel = accessChecksPending
      ? "Checking access…"
      : actionNeedsTeam(action) && teamPending
        ? "Loading team…"
        : meta.sub;

    return (
      <div key={action} className="relative">
        <button
          ref={(node) => {
            actionNodeRefs.current[action] = node;
          }}
          type="button"
          disabled={disabled}
          aria-disabled={blocked || disabled}
          aria-busy={preparing || undefined}
          onClick={() => {
            if (preparing) { setQueuedAction(action); return; }
            if (blocked) { setPermissionPopupAction(action); setPermissionPopupOpen(true); return; }
            chooseAction(action);
          }}
          title={preparing ? loadingLabel : blocked ? lockReasonFor(action) : undefined}
          className={`flex min-h-[62px] w-full items-center gap-3 rounded-2xl border p-3 text-left shadow-sm transition-all duration-200
            ${highlighted ? 'border-[var(--rm-green)] bg-[var(--rm-green-soft)] shadow-md' : preparing ? 'cursor-progress border-[var(--rm-panel-border)] bg-[var(--rm-panel)]' : (blocked || disabled) ? 'cursor-not-allowed border-[var(--rm-panel-border)] bg-[var(--rm-panel)] opacity-50' : 'border-[var(--rm-panel-border)] bg-[var(--rm-panel)] hover:translate-x-1 hover:border-[var(--rm-text-faint)] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[var(--rm-green-soft)]'}
          `}
          data-testid={`quick-action-${action}`}
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors"
            style={{ backgroundColor: highlighted ? meta.color : meta.soft, color: highlighted ? "#fff" : meta.color }}
          >
            <Icon className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className={`block truncate text-[15px] font-bold ${highlighted ? 'text-[var(--rm-green)]' : 'text-[var(--rm-text)]'}`}>{meta.label}</span>
            <span className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-[var(--rm-text-muted)]">
              {preparing && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--rm-green)]" />}
              {queued ? "Opening when ready…" : preparing ? loadingLabel : meta.sub}
            </span>
          </span>
        </button>
      </div>
    );
  };

  return (
    <>
      <div ref={flowRootRef} className="relative grid min-w-0 grid-cols-1 items-start justify-start gap-8 animate-in fade-in slide-in-from-bottom-6 duration-700 ease-out lg:grid-cols-[300px_minmax(0,360px)] lg:gap-12">
        <ActionFlowSvg geometry={flowGeometry} pathPrefix="qa-hub" colors={flowColors} />

        <div className="relative z-10 sticky top-10 min-w-0 w-full lg:mt-16">
          <div ref={sourceCardRef} className="rounded-3xl border border-[var(--rm-panel-border)] bg-[var(--rm-panel)] shadow-xl overflow-hidden">
            <div className="relative border-b border-[var(--rm-panel-border)] p-5">
              <div className="absolute top-0 left-0 right-0 h-1.5" style={{ backgroundColor: TYPE_STYLES[item.type].color }} />
              <div className="mb-4 flex items-start justify-between gap-4">
                <TypeBadge item={item} />
                <button type="button" onClick={onClose} aria-label="Close selected record" data-testid="quick-actions-close" className="rounded-full p-2 text-[var(--rm-text-muted)] hover:bg-[var(--rm-bg)] hover:text-[var(--rm-text)] transition"><X className="h-5 w-5" /></button>
              </div>
              <button
                type="button"
                onClick={() => onNavigate(quickActionPath(item))}
                className="group block w-full text-left focus:outline-none"
                title="Open full record"
              >
                <div className="font-sans text-[11px] font-semibold text-[var(--rm-text-faint)] tracking-wider mb-2 group-hover:text-[var(--rm-green)] transition-colors">{item.id}</div>
                <h2 className="text-xl font-extrabold tracking-tight leading-snug group-hover:text-[var(--rm-green)] transition-colors flex items-center gap-2">
                  {projectName}
                  <ExternalLink className="h-4 w-4 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
                </h2>
              </button>
            </div>

            <div className="bg-[var(--rm-bg)] p-5">
              <dl className="grid gap-y-4">
                {clientName && (
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--rm-text-faint)]">Client</dt>
                    <dd className="mt-1.5 flex items-center gap-2 text-[14px] font-medium"><Building2 className="h-4 w-4 text-[var(--rm-text-muted)]" /> {clientName}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--rm-text-faint)]">Status</dt>
                  <dd className="mt-1.5 flex items-center gap-2 text-[14px] font-medium">
                      <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: isLostishStatus(currentStatus) ? "#DC2626" : resolvePhaseColor(currentStatus).bg }} />
                     <span className={isLostishStatus(currentStatus) ? "font-bold text-red-600" : undefined}>{currentStatus || "No status set"}</span>
                  </dd>
                </div>
                {(() => {
                  {/* Schedule wins → Target fallback (same rule as lib/projectDates). */}
                  const scheduleBased = Boolean(quickScheduleBounds.start || quickScheduleBounds.end);
                  const shownStart = scheduleBased ? quickScheduleBounds.start : targetStart;
                  const shownEnd = scheduleBased ? quickScheduleBounds.end : targetEnd;
                  if (!shownStart && !shownEnd) return null;
                  return (
                    <div>
                      <dt className="text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--rm-text-faint)]">{scheduleBased ? "Schedule Dates" : "Target Dates"}</dt>
                      <dd className="mt-1.5 text-[14px] font-medium font-sans text-[var(--rm-text-muted)]" data-testid="quick-actions-record-dates">
                         {[shownStart, shownEnd].filter(Boolean).join(" → ")}
                      </dd>
                    </div>
                  );
                })()}
                {canViewTeam && (
                  <button
                    type="button"
                    onClick={() => setTeamViewOpen(true)}
                    className="block w-full text-left transition hover:opacity-75 focus:outline-none rounded"
                    title="Open project team and allocations"
                    data-testid="quick-actions-team-summary"
                  >
                    <dt className="text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--rm-text-faint)]">Team Allocation</dt>
                    <dd className="mt-1.5 text-[14px] font-medium flex justify-between items-center bg-[var(--rm-panel)] border border-[var(--rm-panel-border)] rounded-xl px-4 py-3">
                        <span className="flex items-center gap-2">
                          {teamPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--rm-green)]" />}
                          {teamPending ? "Loading team…" : `${teamData.team.length} assigned · ${teamData.openRoles.length} open`}
                        </span>
                        <span className="text-[12px] font-bold text-[var(--rm-green)]">{accessChecksPending ? "Checking…" : canEditTeam ? "Manage" : "View"} &rarr;</span>
                    </dd>
                  </button>
                )}
              </dl>
            </div>
          </div>
        </div>

        <div className="relative z-10 min-w-0 w-full max-w-[360px] py-1">
          <div className="space-y-3">
            {actions.filter((action) => action !== "open").map((action) => renderActionCard(action))}
            <AuditTrailCard
              title="Record Audit Trail"
              entityType={item.type === "PMM" ? "project" : item.type === "OPM" ? "opportunity" : item.type === "LEM" ? "lead" : item.type === "COM" ? "company" : "contact"}
              entityId={item.id}
              compact
              triggerOnly
              triggerRef={(node) => { actionNodeRefs.current.audit = node; }}
              onOpenChange={setAuditOpen}
            />
            {renderActionCard("open")}
          </div>
          {/* Visible "why are these greyed out" note — the per-button tooltip
              is hover-only, invisible on touch. Shown only when at least one
              action is blocked by permissions (not mere loading/submitting). */}
          {blockedReasons.length > 0 && (
            <p
              className="mt-3 rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-panel)] px-3 py-2 text-[12px] leading-snug text-[var(--rm-text-muted)]"
              data-testid="quick-action-permission-note"
            >
              {blockedReasons.map((r) => (
                <span key={r} className="block">{r}</span>
              ))}
            </p>
          )}
          {/* Tapping a locked action opens this explainer popup with THAT card's reason. */}
          <Dialog open={permissionPopupOpen} onOpenChange={setPermissionPopupOpen}>
            <DialogContent className="max-w-sm" data-testid="quick-action-permission-popup">
              <DialogHeader>
                <DialogTitle>This action is locked</DialogTitle>
                <DialogDescription>
                  {(permissionPopupAction ? lockReasonFor(permissionPopupAction) : undefined)
                    ?? "Changes to this record are limited by your access level."}
                </DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
        </div>

      </div>

      <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
        <DialogContent
          className="w-[min(96vw,1340px)] max-w-none gap-0 overflow-hidden p-0"
          data-testid="quick-action-record-audit-popup"
        >
          <DialogHeader className="border-b border-[var(--rm-panel-border)] bg-[var(--rm-panel)] px-6 py-4 pr-12">
            <DialogTitle>Record Audit Trail</DialogTitle>
            <DialogDescription>
              {item.id} · {projectName} — who did what, when, and whether it worked
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[calc(90vh-100px)] overflow-y-auto">
            <AuditTrailCard
              title="Record Audit Trail"
              entityType={item.type === "PMM" ? "project" : item.type === "OPM" ? "opportunity" : item.type === "LEM" ? "lead" : item.type === "COM" ? "company" : "contact"}
              entityId={item.id}
              defaultOpen
              hideHeader
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(activePane)}
        onOpenChange={(open) => {
          if (!open && !submitting) setActivePane(null);
        }}
      >
        <DialogContent className="max-w-2xl" data-testid="quick-action-pane-dialog">
          <DialogHeader>
            <DialogTitle>{activePane ? actionMeta[activePane].label : ""}</DialogTitle>
            <DialogDescription>
              {item.id} · {projectName}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto pr-1">
                           {activePane === "status" ? (
                             (module === "PMM" || module === "OPM" ? lifecycleStatusQuery.isLoading : leadStatusOptionsQuery.isLoading) ? (
                               <div className="flex min-h-[120px] items-center justify-center">
                                 <Loader2 className="h-6 w-6 animate-spin text-[var(--rm-green)]" />
                               </div>
                             ) : (module === "PMM" || module === "OPM") && lifecycleStatusQuery.isError ? (
                               <div className="rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] p-5 text-sm text-[var(--rm-text-muted)]">
                                 <p>We couldn’t verify the schedule, so no status change can be made yet.</p>
                                 <button
                                   type="button"
                                   onClick={() => void lifecycleStatusQuery.refetch()}
                                   className="mt-3 rounded-lg bg-[var(--rm-green)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-95"
                                 >
                                   Try again
                                 </button>
                               </div>
                             ) : (
                               <>
                                 {statusOptions.length ? (
                                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                      {statusOptions.map(option => {
                                         const palette = resolvePhaseColor(option);
                                         const selected = option.trim().toLowerCase() === currentStatus.trim().toLowerCase();
                                         return (
                                            <button
                                              type="button"
                                              key={option}
                                              disabled={submitting || refreshing || selected}
                                              onClick={() => {
                                                 setStatusValue(option);
                                                 void persistField("status", [{ fieldName: quickActionFieldName(module, "status", detailFields), value: option }]);
                                              }}
                                              className="flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all duration-200"
                                              style={{
                                                 borderColor: selected ? palette.bg : "var(--rm-panel-border)",
                                                 background: selected ? palette.bg : "var(--rm-bg)",
                                                 color: selected ? palette.text : "var(--rm-text)",
                                                 boxShadow: selected ? "0 4px 12px rgba(0,0,0,0.05)" : "none",
                                              }}
                                            >
                                              <span className="h-3.5 w-3.5 shrink-0 rounded-full shadow-sm" style={{ backgroundColor: selected ? palette.text : palette.bg }} />
                                              <span className="min-w-0 text-[14px] font-bold leading-snug">{option}</span>
                                              {selected && (submitting || refreshing) && <Loader2 className="ml-auto h-4 w-4 animate-spin opacity-70" />}
                                            </button>
                                         )
                                      })}
                                   </div>
                                 ) : (
                                   <div className="rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] p-5 text-sm text-[var(--rm-text-muted)]">
                                     No workflow statuses are available for this record.
                                   </div>
                                 )}

                                 <div className="mt-6 border-t border-[var(--rm-panel-border)] pt-5">
                                    <label htmlFor="quick-action-custom-status" className="text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--rm-text-faint)]">Custom Status</label>
                                    <div className="mt-3 flex gap-3">
                                       <input
                                         id="quick-action-custom-status"
                                         data-testid="quick-action-custom-status"
                                         type="text"
                                         value={statusValue}
                                         onChange={(event) => setStatusValue(event.target.value)}
                                         onKeyDown={(event) => {
                                           if (event.key === "Enter" && statusValue.trim()) {
                                             event.preventDefault();
                                             void persistField("status", [{ fieldName: quickActionFieldName(module, "status", detailFields), value: statusValue.trim() }]);
                                           }
                                         }}
                                         disabled={submitting || refreshing}
                                         placeholder="Type a custom status..."
                                         className="min-w-0 flex-1 rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] px-4 py-2.5 text-[15px] outline-none transition focus:border-[var(--rm-green)] focus:ring-2 focus:ring-[var(--rm-green-soft)]"
                                       />
                                       <button
                                         type="button"
                                         data-testid="quick-action-save-custom-status"
                                         onClick={() => void persistField("status", [{ fieldName: quickActionFieldName(module, "status", detailFields), value: statusValue.trim() }])}
                                         disabled={
                                           submitting || refreshing || !statusValue.trim() || statusValue.trim().toLowerCase() === currentStatus.trim().toLowerCase()
                                         }
                                         className="shrink-0 rounded-xl bg-[var(--rm-green)] px-5 py-2.5 text-[15px] font-bold text-white transition hover:brightness-95 disabled:opacity-50 flex items-center gap-2"
                                       >
                                          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                                          {submitting ? "Saving..." : "Save custom"}
                                       </button>
                                    </div>
                                 </div>
                               </>
                             )
                           ) : activePane === "endings" ? (
                             <div className="grid gap-3">
                               {confirmingEnding === null && (
                                 <>
                                   {/* Advance — OPM and LEM only; projects are the final destination */}
                                   {(module === "OPM" || module === "LEM") && (
                                     module === "OPM" && conversionCheckPending ? (
                                       <div
                                         data-testid="quick-action-endings-conversion-check"
                                         className="flex items-center gap-3 rounded-2xl border border-[var(--rm-panel-border)] bg-[var(--rm-panel-soft)] p-4 text-left"
                                       >
                                         <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--rm-panel)] text-[var(--rm-text-muted)]">
                                           <Loader2 className="h-5 w-5 animate-spin" />
                                         </span>
                                         <span>
                                           <span className="block text-[15px] font-bold text-[var(--rm-text)]">Checking project conversion…</span>
                                           <span className="mt-0.5 block text-[12px] text-[var(--rm-text-muted)]">
                                             Verifying whether this opportunity already has a matching project
                                           </span>
                                         </span>
                                       </div>
                                     ) : module === "OPM" && linkedPmmId ? (
                                       <div
                                         data-testid="quick-action-endings-already-converted"
                                         className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left"
                                       >
                                         <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                                           <ArrowUpRight className="h-5 w-5" />
                                         </span>
                                         <span className="min-w-0">
                                           <span className="block text-[15px] font-bold text-amber-800">
                                             Already converted <span aria-hidden="true">→</span>{" "}
                                             <a
                                               href={`/project/${encodeURIComponent(linkedPmmId)}`}
                                               data-testid="quick-action-endings-linked-project"
                                               onClick={(event) => {
                                                 event.preventDefault();
                                                 onNavigate(`/project/${encodeURIComponent(linkedPmmId)}`);
                                               }}
                                               className="underline decoration-amber-400 underline-offset-2 hover:text-amber-950"
                                             >
                                               {linkedPmmId}
                                             </a>
                                           </span>
                                           <span className="mt-0.5 block text-[12px] text-amber-800/75">
                                             This opportunity already has a project with the same name
                                           </span>
                                         </span>
                                       </div>
                                     ) : (
                                       <button
                                         type="button"
                                         data-testid="quick-action-endings-convert"
                                         onClick={() => setConfirmingEnding("convert")}
                                         disabled={submitting}
                                         className="flex items-center gap-3 rounded-2xl border border-[var(--rm-panel-border)] bg-[var(--rm-panel)] p-4 text-left transition hover:border-emerald-400 hover:bg-emerald-50 hover:shadow-md focus:outline-none disabled:opacity-50"
                                       >
                                         <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                                           <ArrowUpRight className="h-5 w-5" />
                                         </span>
                                         <span>
                                           <span className="block text-[15px] font-bold text-emerald-700">
                                             {module === "OPM" ? "Advance to Project" : "Advance to Opportunity"}
                                           </span>
                                           <span className="mt-0.5 block text-[12px] text-[var(--rm-text-muted)]">
                                             {module === "OPM"
                                               ? "Convert this opportunity into a new project"
                                               : "Convert this lead into a new opportunity"}
                                           </span>
                                         </span>
                                       </button>
                                     )
                                   )}

                                   {/* Lost + Cancel — PMM, OPM, and LEM all get these */}
                                   <button
                                     type="button"
                                     data-testid="quick-action-endings-lost"
                                     onClick={() => setConfirmingEnding("lost")}
                                     disabled={submitting}
                                     className="flex items-center gap-3 rounded-2xl border border-[var(--rm-panel-border)] bg-[var(--rm-panel)] p-4 text-left transition hover:border-red-300 hover:bg-red-50 hover:shadow-md focus:outline-none disabled:opacity-50"
                                   >
                                     <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
                                       <ThumbsDown className="h-5 w-5" />
                                     </span>
                                     <span>
                                       <span className="block text-[15px] font-bold text-red-700">Mark as Lost</span>
                                       <span className="mt-0.5 block text-[12px] text-[var(--rm-text-muted)]">Record won't be pursued further</span>
                                     </span>
                                   </button>

                                   <button
                                     type="button"
                                     data-testid="quick-action-endings-cancel"
                                     onClick={() => setConfirmingEnding("cancel")}
                                     disabled={submitting}
                                     className="flex items-center gap-3 rounded-2xl border border-[var(--rm-panel-border)] bg-[var(--rm-panel)] p-4 text-left transition hover:border-[var(--rm-text-faint)] hover:bg-[var(--rm-bg)] hover:shadow-md focus:outline-none disabled:opacity-50"
                                   >
                                     <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--rm-bg)] text-[var(--rm-text-muted)]">
                                       <XCircle className="h-5 w-5" />
                                     </span>
                                     <span>
                                       <span className="block text-[15px] font-bold text-[var(--rm-text)]">Cancel record</span>
                                       <span className="mt-0.5 block text-[12px] text-[var(--rm-text-muted)]">Close without a final outcome</span>
                                     </span>
                                   </button>
                                 </>
                               )}

                               {confirmingEnding !== null && (
                                 <div className="rounded-2xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] p-5">
                                   <p className="text-[15px] font-bold text-[var(--rm-text)]">
                                     {confirmingEnding === "convert"
                                       ? (module === "OPM" ? "Advance to Project?" : "Advance to Opportunity?")
                                       : confirmingEnding === "lost" ? "Mark this record as Lost?" : "Cancel this record?"}
                                   </p>
                                   <p className="mt-1.5 text-[13px] text-[var(--rm-text-muted)]">
                                     {confirmingEnding === "convert"
                                       ? `You'll be taken to the create form with ${projectName} pre-filled.`
                                       : confirmingEnding === "lost"
                                         ? "This sets the status to Lost. The record stays visible but closed."
                                         : "This closes the record. It stays visible in history but no longer appears in active lists."}
                                   </p>
                                   {errorMessage && (
                                     <div className="mt-3 flex items-center gap-1.5 text-[13px] text-red-600">
                                       <AlertTriangle className="h-4 w-4 shrink-0" />
                                       <span>{errorMessage}</span>
                                     </div>
                                   )}
                                   <div className="mt-5 flex gap-3">
                                     <button
                                       type="button"
                                       data-testid="quick-action-endings-confirm"
                                       onClick={() => void executeEnding(confirmingEnding)}
                                       disabled={submitting}
                                       className="rounded-xl bg-[var(--rm-text)] px-5 py-2.5 text-[15px] font-bold text-[var(--rm-panel)] transition hover:opacity-85 disabled:opacity-50 flex items-center gap-2"
                                     >
                                       {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                                       {submitting
                                         ? "Saving…"
                                         : confirmingEnding === "convert"
                                           ? (module === "OPM" ? "Go to create project" : "Go to create opportunity")
                                           : confirmingEnding === "lost" ? "Confirm · Mark as Lost" : "Confirm · Cancel record"}
                                     </button>
                                     <button
                                       type="button"
                                       onClick={() => { setConfirmingEnding(null); setErrorMessage(""); }}
                                       disabled={submitting}
                                       className="rounded-xl px-5 py-2.5 text-[15px] font-bold text-[var(--rm-text-muted)] transition hover:bg-[var(--rm-panel-soft)] hover:text-[var(--rm-text)] disabled:opacity-50"
                                     >
                                       Go back
                                     </button>
                                   </div>
                                 </div>
                               )}
                             </div>
                           ) : activePane === "leads" ? (
                             <div className="grid gap-5">
                               {/* Role picker */}
                               <div>
                                 <label htmlFor="qa-lead-role" className="text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--rm-text-faint)]">Lead Role</label>
                                 <select
                                   id="qa-lead-role"
                                   data-testid="qa-lead-role"
                                   value={leadRole}
                                   onChange={(e) => { setLeadRole(e.target.value); setLeadErr(""); }}
                                   className="mt-2 w-full rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] px-4 py-2.5 text-[14px] outline-none transition focus:border-[var(--rm-green)] focus:ring-2 focus:ring-[var(--rm-green-soft)]"
                                 >
                                   <option value="">Select a role…</option>
                                   {KP_LEAD_ROLES.map((r) => (
                                     <option key={r.field} value={r.field}>{r.role}</option>
                                   ))}
                                   <option value={QA_CUSTOM_ROLE}>＋ Add your own role…</option>
                                 </select>
                                 {leadRole === QA_CUSTOM_ROLE && (
                                   <div className="mt-2 flex flex-col gap-1.5">
                                     <input
                                       value={leadRoleCustom}
                                       onChange={(e) => { setLeadRoleCustom(e.target.value); setLeadErr(""); }}
                                       placeholder="Type the role name — e.g. Design Lead…"
                                       autoFocus
                                       data-testid="qa-lead-role-custom"
                                       className="w-full rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] px-4 py-2.5 text-[14px] outline-none transition focus:border-[var(--rm-green)] focus:ring-2 focus:ring-[var(--rm-green-soft)]"
                                     />
                                     <p className="text-[11px] text-[var(--rm-text-muted)]">Saved exactly as typed on this record's leads.</p>
                                   </div>
                                 )}
                               </div>

                               {/* Person picker — roster search or free-text */}
                               <div>
                                 <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--rm-text-faint)]">Person</label>
                                 {leadCustomMode ? (
                                   <div className="flex flex-col gap-2">
                                     <input
                                       value={leadCustomName}
                                       onChange={(e) => { setLeadCustomName(e.target.value); setLeadErr(""); }}
                                       placeholder="Type the person's full name…"
                                       autoFocus
                                       className="w-full rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] px-4 py-2.5 text-[14px] outline-none transition focus:border-[var(--rm-green)] focus:ring-2 focus:ring-[var(--rm-green-soft)]"
                                     />
                                     <p className="text-[11px] text-[var(--rm-text-muted)]">Saved exactly as typed — use for people not on the roster yet.</p>
                                     <button type="button" onClick={() => { setLeadCustomMode(false); setLeadCustomName(""); }}
                                       className="self-start text-[12px] font-semibold text-[var(--rm-green)] hover:underline">
                                       ← Choose from the roster instead
                                     </button>
                                   </div>
                                 ) : (
                                   <div className="flex flex-col gap-2">
                                     <div className="flex items-center gap-2 rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] px-4">
                                       <Search className="h-4 w-4 shrink-0 text-[var(--rm-text-muted)]" />
                                       <input
                                         value={leadQuery}
                                         onChange={(e) => { setLeadQuery(e.target.value); setLeadSelName(""); setLeadErr(""); }}
                                         placeholder="Search the roster…"
                                         className="flex-1 bg-transparent py-2.5 text-[14px] outline-none"
                                       />
                                     </div>
                                     <div className="max-h-[200px] overflow-y-auto rounded-xl border border-[var(--rm-panel-border)]">
                                       {leadPeople.length === 0 ? (
                                         <div className="px-4 py-3 text-[12px] text-[var(--rm-text-muted)]">Loading roster…</div>
                                       ) : (() => {
                                         const q = leadQuery.trim().toLowerCase();
                                         const shown = leadPeople
                                           .filter((p) => !q || p.name.toLowerCase().includes(q) || p.title.toLowerCase().includes(q))
                                           .slice(0, 20);
                                         if (shown.length === 0) return (
                                           <div className="px-4 py-3 text-[12px] text-[var(--rm-text-muted)]">No roster match — you can add them as a new person below.</div>
                                         );
                                         return shown.map((p) => {
                                           const sel = leadSelName === p.name;
                                           return (
                                             <button key={p.id} type="button"
                                               onClick={() => { setLeadSelName(sel ? "" : p.name); setLeadErr(""); }}
                                               className="flex w-full items-baseline gap-2 px-4 py-2.5 text-left transition hover:bg-[var(--rm-panel-soft)]"
                                               style={{ background: sel ? "var(--rm-green-soft)" : undefined }}>
                                               <span className="text-[14px] font-semibold text-[var(--rm-text)]">{p.name}</span>
                                               {p.title && <span className="text-[12px] text-[var(--rm-text-muted)]">{p.title}</span>}
                                             </button>
                                           );
                                         });
                                       })()}
                                     </div>
                                     <button type="button" onClick={() => { setLeadCustomMode(true); setLeadSelName(""); setLeadErr(""); }}
                                       className="self-start text-[12px] font-semibold text-[var(--rm-green)] hover:underline">
                                       + Add a new person (not on the roster)
                                     </button>
                                   </div>
                                 )}
                               </div>

                               {/* Clear confirmation of who's about to be added — the
                                   row highlight alone was easy to miss. */}
                               {(() => {
                                 const pending = (leadCustomMode ? leadCustomName : leadSelName).trim();
                                 if (!pending) return null;
                                 const roleLabel = leadRole === QA_CUSTOM_ROLE
                                   ? leadRoleCustom.trim()
                                   : (KP_LEAD_ROLES.find((r) => r.field === leadRole)?.role ?? "");
                                 return (
                                   <div data-testid="qa-lead-pending"
                                     className="flex items-center gap-2 rounded-xl border border-[var(--rm-green)] bg-[var(--rm-green-soft)] px-4 py-2.5">
                                     <UserPlus className="h-4 w-4 shrink-0 text-[var(--rm-green)]" />
                                     <span className="text-[13px] text-[var(--rm-text)]">
                                       {roleLabel
                                         ? <>Adding <b>{pending}</b> as <b>{roleLabel}</b> — hit “Add Lead” to confirm.</>
                                         : <>Adding <b>{pending}</b> — choose a role above first.</>}
                                     </span>
                                   </div>
                                 );
                               })()}

                               {/* Chips for existing people in the chosen role */}
                               {leadRole && (() => {
                                 const isCustomRole = leadRole === QA_CUSTOM_ROLE;
                                 const existing = isCustomRole
                                   ? customLeadNamesForRole(detailFields[CUSTOM_LEADS_FIELD], leadRoleCustom)
                                   : String(detailFields[leadRole] ?? "")
                                       .split(/[,;]+/).map((t) => t.trim()).filter(Boolean);
                                 if (!existing.length) return null;
                                 const roleLabel = isCustomRole
                                   ? leadRoleCustom.trim()
                                   : (KP_LEAD_ROLES.find((r) => r.field === leadRole)?.role ?? "this role");
                                 return (
                                   <div>
                                     <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--rm-text-faint)]">
                                       Currently · {roleLabel}
                                     </p>
                                     <div className="flex flex-wrap gap-1.5">
                                       {existing.map((name) => (
                                         <span key={name} className="rounded-full bg-[var(--rm-panel-soft)] px-3 py-1 text-[12px] font-medium text-[var(--rm-text)]">{name}</span>
                                       ))}
                                     </div>
                                   </div>
                                 );
                               })()}

                               {leadErr && (
                                 <div className="flex items-center gap-1.5 text-[13px] font-medium text-red-500">
                                   <AlertTriangle className="h-4 w-4 shrink-0" />{leadErr}
                                 </div>
                               )}

                               <div className="flex items-center justify-end gap-3 border-t border-[var(--rm-panel-border)] pt-4">
                                 <button type="button" onClick={() => setActivePane(null)} disabled={leadSaving}
                                   className="rounded-xl px-5 py-2.5 text-[15px] font-bold text-[var(--rm-text-muted)] transition hover:bg-[var(--rm-panel-soft)] hover:text-[var(--rm-text)]">
                                   Cancel
                                 </button>
                                 <button type="button" data-testid="qa-lead-save"
                                   onClick={() => void saveLead()}
                                   disabled={leadSaving || (!leadSelName && !leadCustomName.trim()) || !leadRole || (leadRole === QA_CUSTOM_ROLE && !leadRoleCustom.trim())}
                                   className="flex items-center gap-2 rounded-xl bg-[var(--rm-green)] px-5 py-2.5 text-[15px] font-bold text-white transition hover:brightness-95 disabled:opacity-50 shadow-sm">
                                   {leadSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                                   {leadSaving ? "Saving…" : "Add Lead"}
                                 </button>
                               </div>
                             </div>
                           ) : (
                             <>
                               <div className="grid gap-5">
                                 <div>
                                   <label htmlFor="quick-action-note" className="text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--rm-text-faint)]">Note</label>
                                   <textarea
                                     id="quick-action-note"
                                     value={noteValue}
                                     onChange={(event) => setNoteValue(event.target.value)}
                                     className="mt-2 min-h-[110px] w-full resize-y rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] p-4 text-[15px] leading-relaxed outline-none transition focus:border-[var(--rm-green)] focus:ring-2 focus:ring-[var(--rm-green-soft)]"
                                     placeholder="Add a record note..."
                                     data-testid="quick-action-note"
                                   />
                                 </div>
                                 <div>
                                   <label htmlFor="quick-action-description" className="text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--rm-text-faint)]">Description</label>
                                   <textarea
                                     id="quick-action-description"
                                     value={descValue}
                                     onChange={(event) => setDescValue(event.target.value)}
                                     className="mt-2 min-h-[110px] w-full resize-y rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] p-4 text-[15px] leading-relaxed outline-none transition focus:border-[var(--rm-green)] focus:ring-2 focus:ring-[var(--rm-green-soft)]"
                                     placeholder="Add a record description..."
                                     data-testid="quick-action-description"
                                   />
                                 </div>
                               </div>
                               <div className="mt-4 flex items-center justify-between gap-4">
                                 <div className="flex min-w-0 items-center gap-1.5 text-[14px] font-medium text-red-600 dark:text-red-400">
                                   {errorMessage && <AlertTriangle className="h-4 w-4 shrink-0" />}
                                   <span className="truncate">{errorMessage}</span>
                                 </div>
                                 <div className="flex justify-end gap-3 shrink-0">
                                    <button
                                       type="button"
                                       onClick={() => setActivePane(null)}
                                       disabled={submitting}
                                       className="rounded-xl px-5 py-2.5 text-[15px] font-bold text-[var(--rm-text-muted)] transition hover:bg-[var(--rm-panel-soft)] hover:text-[var(--rm-text)]"
                                    >
                                       Cancel
                                    </button>
                                    <button
                                       type="button"
                                       onClick={saveNotes}
                                       disabled={submitting || refreshing || !notesDirty}
                                       className="rounded-xl bg-[var(--rm-green)] px-5 py-2.5 text-[15px] font-bold text-white transition hover:brightness-95 disabled:opacity-50 flex items-center gap-2 shadow-sm"
                                       data-testid="quick-action-save-notes"
                                    >
                                       {(submitting || refreshing) ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
                                    </button>
                                 </div>
                               </div>
                             </>
                           )}
          </div>
        </DialogContent>
      </Dialog>

      {teamModule && (
        <QuickActionsTeamModal
          open={teamViewOpen}
          onClose={() => setTeamViewOpen(false)}
          projectId={item.id}
          projectName={projectName}
          module={teamModule}
          onOpenProject={() => {
            setTeamViewOpen(false);
            onNavigate(quickProjectTeamPath(item.id, teamModule));
          }}
          projectStartDate={quickScheduleBounds.start || targetStart || today}
          projectEndDate={quickScheduleBounds.end || targetEnd || oneYearFromToday}
          scheduleStart={quickScheduleBounds.start || undefined}
          scheduleEnd={quickScheduleBounds.end || undefined}
          team={teamData.team}
          openRoles={teamData.openRoles}
          existingAllocations={quickExistingAllocations(teamData.team)}
          canEdit={permissionsQuery.data?.canEditData === true}
          canManageStaff={canManageStaff}
          onReload={() => { void refreshAfterMutation("team"); }}
          onToggleFlag={canManageStaff ? toggleQuickTeamFlag : undefined}
          onAddMember={(seed) => {
            setAddMemberSeed(seed ?? null);
            setTeamModalOpen(true);
            // Fresh team read so the popup's duplicate-person check sees the
            // latest roster (same rule as the hub's own Add member card).
            refreshProjectTeamCache(queryClient, item.id);
          }}
          onMemberAdded={(personName, optimistic) => {
            // Optimistic insert so the new person appears in the open team
            // view immediately; the background refresh fills in real data.
            if (optimistic) {
              applyQuickTeamOptimistic(personName, optimistic);
            }
            void refreshAfterMutation("team").catch((error) => {
              console.warn("[quick-actions] refresh after inline add failed", error);
            });
          }}
          onRemoveMember={canManageStaff ? removeQuickTeamMember : undefined}
          onRemoveOpenPosition={canManageStaff ? removeQuickOpenPosition : undefined}
          onAddOpenPosition={() => {
            setTeamViewOpen(false);
            setPositionModalOpen(true);
          }}
          onEditMember={canEditTeam ? (alloc, period) => {
            setEditMemberAlloc(alloc);
            setEditMemberPeriod(period ?? null);
          } : undefined}
        />
      )}

      {editMemberAlloc && teamModule && (
        <AddTeamMemberModal
          open={!!editMemberAlloc}
          onClose={() => { setEditMemberAlloc(null); setEditMemberPeriod(null); }}
          projectId={item.id}
          module={teamModule}
          projectName={projectName}
          projectStartDate={quickScheduleBounds.start || targetStart || today}
          projectEndDate={quickScheduleBounds.end || targetEnd || oneYearFromToday}
          scheduleStart={quickScheduleBounds.start || undefined}
          scheduleEnd={quickScheduleBounds.end || undefined}
          existingAllocations={quickExistingAllocations(teamData.team)}
          onAssigned={() => {
            setEditMemberAlloc(null);
            setEditMemberPeriod(null);
            void refreshAfterMutation("team");
          }}
          prefillPersonId={editMemberAlloc.resourceId}
          prefillPersonName={editMemberAlloc.name}
          prefillBuShort={editMemberAlloc.bu}
          prefillDivisionId={editMemberAlloc.divisionId}
          prefillMemberBu={editMemberAlloc.memberBu}
          prefillRole={editMemberAlloc.role}
          prefillTitle={editMemberAlloc.title}
          prefillDept={editMemberAlloc.dept}
          prefillStartDate={(editMemberPeriod?.startDate ?? editMemberAlloc.startDate)?.slice(0, 10)}
          prefillEndDate={(editMemberPeriod?.endDate ?? editMemberAlloc.endDate)?.slice(0, 10)}
          prefillPct={editMemberAlloc.pct}
          prefillAllocationId={editMemberPeriod?.rwiId ?? editMemberAlloc.rwiId}
          showHoursField={(() => {
            const dm = getDisplayModeForRecord(item.id, teamModule);
            return dm === "no-schedule" || dm === "no-schedule-no-hours" ||
              dm === "no-schedule-no-grid" || dm === "schedule-no-grid";
          })()}
          prefillHours={editMemberPeriod ? editMemberPeriod.hours : editMemberAlloc.eacHrs}
          periodScope={editMemberPeriod ? (() => {
            const ps = editMemberPeriod.startDate.slice(0, 10);
            const pe = editMemberPeriod.endDate.slice(0, 10);
            // Every OTHER period window this member has — across ALL their
            // assignment rows (same person can hold two roles). The save path
            // rejects new dates that overlap any of these, since weekly rows
            // carry no per-period identity (same rule as Project Detail) —
            // except same-RWI siblings a replace-all save merges away.
            const personKey = editMemberAlloc.resourceId || editMemberAlloc.name;
            const otherPeriods: { start: string; end: string; rwiId?: number | null }[] = [];
            for (const tm of teamData.team) {
              if ((tm.resourceId || tm.name) !== personKey) continue;
              const sl = tm.slices && tm.slices.length > 0
                ? tm.slices
                : [{ startDate: tm.startDate, endDate: tm.endDate, rwiId: tm.rwiId }];
              for (const s of sl) {
                const ss = (s.startDate || "").slice(0, 10);
                const se = (s.endDate || "").slice(0, 10);
                if (!ss || !se) continue;
                if (ss === ps && se === pe) continue; // the clicked period itself
                otherPeriods.push({ start: ss, end: se, rwiId: s.rwiId ?? null });
              }
            }
            return {
              periodStart: ps,
              periodEnd: pe,
              periodHours: editMemberPeriod.hours,
              assignStart: editMemberAlloc.startDate?.slice(0, 10),
              assignEnd: editMemberAlloc.endDate?.slice(0, 10),
              assignHours: editMemberAlloc.eacHrs,
              rwiId: editMemberPeriod.rwiId ?? null,
              otherPeriods,
            };
          })() : undefined}
        />
      )}

      {teamModalOpen && (
        <AddTeamMemberModal
          key={addMemberSeed ? `seed-${addMemberSeed.personId}` : "add"}
          open={teamModalOpen}
          onClose={() => { setTeamModalOpen(false); setAddMemberSeed(null); }}
          seedPersonId={addMemberSeed?.personId}
          projectId={item.id}
          module={teamModule}
          projectName={projectName}
          projectStartDate={quickScheduleBounds.start || targetStart || today}
          projectEndDate={quickScheduleBounds.end || targetEnd || oneYearFromToday}
          scheduleStart={quickScheduleBounds.start || undefined}
          scheduleEnd={quickScheduleBounds.end || undefined}
          existingAllocations={quickExistingAllocations(teamData.team)}
          onAssigned={(personName, optimistic) =>
            modalMutationFinished(
              "team",
              optimistic?.isExisting ? "Team member hours updated" : "Team member added",
              personName,
              optimistic,
            )
          }
          onOpenProject={(targetProjectId) => {
            setTeamModalOpen(false);
            setTeamViewOpen(false);
            onNavigate(
              targetProjectId === item.id && teamModule
                ? quickProjectTeamPath(targetProjectId, teamModule)
                : `/project/${encodeURIComponent(targetProjectId)}`,
            );
          }}
          onSetupSchedule={() => {
            onNavigate(`/project/${encodeURIComponent(item.id)}#schedule-section`);
          }}
        />
      )}

      {positionModalOpen && (
        <AddOpenPositionModal
          open={positionModalOpen}
          onClose={() => setPositionModalOpen(false)}
          projectId={item.id}
          projectName={projectName}
          defaultStartDate={targetStart || today}
          defaultEndDate={targetEnd || oneYearFromToday}
          onCreated={() => modalMutationFinished("position", "Open position added")}
        />
      )}

    </>
  );
}

type StaffAssignTarget = "PMM" | "OPM" | "LEM";

const STAFF_ASSIGN_META: Record<StaffAssignTarget, {
  label: string;
  sub: string;
  noun: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  soft: string;
}> = {
  PMM: {
    label: "Add to project",
    sub: "Pick a project, plan their hours",
    noun: "project",
    icon: BriefcaseBusiness,
    color: "#4D7F2A",
    soft: "rgba(107,165,57,0.14)",
  },
  OPM: {
    label: "Add to opportunity",
    sub: "Join a pursuit team",
    noun: "opportunity",
    icon: Target,
    color: "#2879A8",
    soft: "rgba(56,189,248,0.12)",
  },
  LEM: {
    label: "Add to lead",
    sub: "Add person only — no hours or schedule",
    noun: "lead",
    icon: Zap,
    color: "#7C5CB4",
    soft: "rgba(167,139,250,0.12)",
  },
};

type StaffNodeExtra = "allocation" | "editProfile" | "audit" | "profile";
type StaffActionId = StaffAssignTarget | StaffNodeExtra;
const STAFF_NODE_ORDER: ReadonlyArray<StaffAssignTarget | StaffNodeExtra> = [
  "PMM", "OPM", "LEM", "allocation", "editProfile", "audit", "profile",
];
const STAFF_EXTRA_META: Record<StaffNodeExtra, {
  label: string; sub: string; icon: ComponentType<{ className?: string }>; color: string; soft: string;
}> = {
  allocation: {
    label: "Edit allocation",
    sub: "Adjust hours across all projects",
    icon: BarChart3,
    color: "#0E8074",
    soft: "rgba(20,184,166,0.14)",
  },
  editProfile: {
    label: "Edit profile",
    sub: "Update name, role, and access",
    icon: Pencil,
    color: "#7C5CB4",
    soft: "rgba(167,139,250,0.12)",
  },
  audit: {
    label: "Audit Trail",
    sub: "Who did what, when, and whether it worked",
    icon: Activity,
    color: "#5E9637",
    soft: "rgba(94,150,55,0.12)",
  },
  profile: {
    label: "Open profile",
    sub: "View the full staff profile",
    icon: UserCircle,
    color: "var(--rm-text-muted)",
    soft: "var(--rm-panel-soft)",
  },
};

// Ticket-ID comparison key: legacy records can carry stray spaces inside the
// ID and casing varies between sources, so membership lookups strip ALL
// whitespace and lowercase both sides (same rule as import-side normalization).
function normalizeTicketKey(id: string): string {
  return id.replace(/\s+/g, "").toLowerCase();
}

// ── QA inline Resource Profile modal ─────────────────────────────────────────
function qaStaffInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function qaFmtDate(s?: string | null): string {
  const v = (s || "").trim();
  if (!v) return "";
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function qaStatusInfo(pct: number): { label: string; color: string } {
  const r = getBusinessRules();
  if (pct >= r.overCapacityPct)      return { label: "Overloaded", color: "#F97316" };
  if (pct >= r.targetUtilizationPct) return { label: "Optimal",    color: "#22c55e" };
  if (pct >  r.underAllocatedPct)    return { label: "Partial",    color: "#86efac" };
  if (pct >  0)                       return { label: "Under-used", color: "#ef4444" };
  return                               { label: "Bench",           color: "#ef4444" };
}

function QAStaffProfileModal({
  resource, loading, onClose, onOpenFull,
}: {
  resource: LiveResourceProxy | null;
  loading: boolean;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  const cardText = "#253746";
  const cardMuted = "#6B7E8A";
  const cardSubtleBorder = "#E5EAEF";

  const [pgSkills, setPgSkills] = useState<{ id: number; skillName: string; proficiency: number | null }[]>([]);
  const [pgTags, setPgTags] = useState<{ id: number; tagName: string }[]>([]);
  useEffect(() => {
    if (!resource?.id) return;
    getUserSkills(resource.id).then(s => setPgSkills(s)).catch(() => {});
    getUserExperienceTags(resource.id).then(t => setPgTags(t)).catch(() => {});
  }, [resource?.id]);

  const status = resource ? qaStatusInfo(resource.currentPct) : null;
  const ini = resource ? qaStaffInitials(resource.name) : "?";

  const orgRows: { label: string; value: string }[] = resource ? [
    { label: "Business Unit", value: resource.businessUnit || "—" },
    { label: "Division",      value: resource.divisionName || "—" },
    { label: "Department",    value: resource.departmentName || "—" },
    { label: "Role",          value: resource.roleName || "—" },
    { label: "Job Title",     value: resource.role || "—" },
    { label: "Start Date",    value: qaFmtDate(resource.startDate) || "—" },
  ] : [];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: Z.MODAL_CHILD,
        backgroundColor: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 720,
          backgroundColor: "#fff",
          borderRadius: 20,
          maxHeight: "90vh", display: "flex", flexDirection: "column",
          boxShadow: "0 12px 36px rgba(0,0,0,0.35)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "14px 18px 12px",
          borderBottom: `1px solid ${cardSubtleBorder}`,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: cardText }}>Resource Profile</div>
            {resource && (
              <div style={{ fontSize: 12, color: cardMuted, marginTop: 2 }}>
                {resource.name}{resource.role ? ` · ${resource.role}` : ""}
              </div>
            )}
          </div>
          <button
            onClick={onOpenFull}
            title="Open on Resources page"
            style={{
              display: "flex", alignItems: "center", gap: 4,
              fontSize: 11, fontWeight: 600, color: cardMuted,
              background: "none", border: "none", cursor: "pointer",
              padding: "4px 8px", borderRadius: 8,
            }}
          >
            <ExternalLink size={12} />
            Full page
          </button>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 28, height: 28, borderRadius: 14, border: "none",
              backgroundColor: "#F0F3F6",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X size={14} color={cardMuted} />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflow: "auto", padding: "20px" }}>
          {loading && !resource && (
            <div style={{ textAlign: "center", padding: "40px 0", color: cardMuted }}>
              <Loader2 size={24} style={{ animation: "spin 1s linear infinite", margin: "0 auto 8px" }} />
              Loading profile…
            </div>
          )}
          {!loading && !resource && (
            <div style={{ textAlign: "center", padding: "40px 0", color: cardMuted }}>
              Profile not found.{" "}
              <button onClick={onOpenFull} style={{ color: "#22c55e", textDecoration: "underline", background: "none", border: "none", cursor: "pointer" }}>
                Open on Resources page
              </button>
            </div>
          )}
          {resource && (
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 24 }}>
              {/* LEFT: avatar + stats */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                {/* Initials avatar */}
                <div style={{
                  width: 72, height: 72, borderRadius: 36,
                  backgroundColor: "#E8F5E9",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 26, fontWeight: 800, color: "#22c55e",
                }}>{ini}</div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: cardText }}>{resource.name}</div>
                  {resource.role && <div style={{ fontSize: 13, color: cardMuted }}>{resource.role}</div>}
                </div>
                {resource.username && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Mail size={12} color={cardMuted} />
                    <span style={{ fontSize: 12, color: cardMuted, wordBreak: "break-all", textAlign: "center" }}>
                      {resource.username}
                    </span>
                  </div>
                )}
                {status && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: status.color }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: status.color, letterSpacing: 0.6 }}>
                      {status.label.toUpperCase()}
                    </span>
                  </div>
                )}
                {/* Stats row */}
                <div style={{ display: "flex", gap: 12, width: "100%" }}>
                  {[
                    { val: `${+resource.currentPct.toFixed(1)}%`, lbl: "Load" },
                    { val: String(resource.totalProjects), lbl: "Total Projects" },
                    { val: String(resource.activeProjects.length), lbl: "Active Now" },
                  ].map(({ val, lbl }) => (
                    <div key={lbl} style={{
                      flex: 1, textAlign: "center", padding: "8px 4px",
                      backgroundColor: "#F9FAFB", borderRadius: 10,
                      border: `1px solid ${cardSubtleBorder}`,
                    }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#22c55e" }}>{val}</div>
                      <div style={{ fontSize: 10, color: cardMuted, marginTop: 2 }}>{lbl}</div>
                    </div>
                  ))}
                </div>
                {/* Capacity bar */}
                <div style={{ width: "100%" }}>
                  <div style={{
                    height: 8, borderRadius: 4, backgroundColor: "#E5E7EB", overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%", borderRadius: 4,
                      width: `${Math.min(100, resource.currentPct)}%`,
                      backgroundColor: status?.color ?? "#22c55e",
                    }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
                    <span style={{ fontSize: 10, color: cardMuted }}>0%</span>
                    <span style={{ fontSize: 10, color: cardMuted }}>100%</span>
                  </div>
                </div>
                {/* Skills */}
                {pgSkills.length > 0 && (
                  <div style={{ width: "100%" }}>
                    <div style={{ fontSize: 10, color: cardMuted, fontWeight: 700, letterSpacing: 1.1, marginBottom: 6 }}>SKILLS</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {pgSkills.slice(0, 6).map(s => (
                        <span key={s.id} style={{
                          fontSize: 10, fontWeight: 600,
                          padding: "2px 8px", borderRadius: 999,
                          backgroundColor: "#22c55e18", color: "#22c55e",
                          border: "1px solid #22c55e30",
                        }}>{s.skillName}</span>
                      ))}
                    </div>
                  </div>
                )}
                {/* Tags */}
                {pgTags.length > 0 && (
                  <div style={{ width: "100%" }}>
                    <div style={{ fontSize: 10, color: cardMuted, fontWeight: 700, letterSpacing: 1.1, marginBottom: 6 }}>EXPERIENCE</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {pgTags.slice(0, 6).map(t => (
                        <span key={t.id} style={{
                          fontSize: 10, fontWeight: 600,
                          padding: "2px 8px", borderRadius: 999,
                          backgroundColor: "#22c55e18", color: "#22c55e",
                          border: "1px solid #22c55e30",
                        }}>{t.tagName}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT: org info + allocations */}
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
{/* Organization & Employment */}
                <div>
                  <div style={{ fontSize: 10, color: cardMuted, fontWeight: 700, letterSpacing: 1.1, marginBottom: 8 }}>
ORGANIZATION & EMPLOYMENT
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <tbody>
                      {orgRows.map(({ label, value }) => (
                        <tr key={label} style={{ borderBottom: `1px solid ${cardSubtleBorder}` }}>
                          <td style={{ padding: "8px 0", fontSize: 12, color: cardMuted, width: 110, verticalAlign: "top" }}>{label}</td>
                          <td style={{ padding: "8px 0 8px 8px", fontSize: 13, fontWeight: 600, color: cardText }}>{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Active allocations */}
                {resource.activeAllocations.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: cardMuted, fontWeight: 700, letterSpacing: 1.1, marginBottom: 8 }}>
                      ACTIVE ALLOCATIONS
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {resource.activeAllocations.slice(0, 6).map(a => {
                        const prefix = String(a.projectId ?? "").split("-")[0];
                        const prefixColor = prefix === "PMM" ? "#22c55e" : prefix === "OPM" ? "#F97316" : cardMuted;
                        return (
                          <div key={a.projectId} style={{
                            padding: "8px 12px", borderRadius: 10,
                            backgroundColor: "#F9FAFB", border: `1px solid ${cardSubtleBorder}`,
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{
                                fontSize: 9, fontWeight: 700, color: prefixColor,
                                backgroundColor: prefixColor + "18",
                                padding: "2px 6px", borderRadius: 4, letterSpacing: 0.5,
                              }}>{prefix}</span>
                              <span style={{
                                flex: 1, fontSize: 12, color: cardText, fontWeight: 600,
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              }}>{a.projectId}</span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#22c55e" }}>
                                {+a.pct.toFixed(2)}%
                              </span>
                            </div>
                            <div style={{ fontSize: 10, color: cardMuted, marginTop: 3 }}>
                              {a.startDate} → {a.endDate}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Last active */}
                {resource.lastActiveDate && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "10px 12px", borderRadius: 10,
                    backgroundColor: "#F9FAFB", border: `1px solid ${cardSubtleBorder}`,
                  }}>
                    <Calendar size={13} color={cardMuted} />
                    <span style={{ fontSize: 12, color: cardText }}>Last active: {resource.lastActiveDate}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StaffActionHub({
  item,
  initialTarget,
  onClose,
  onNavigate,
}: {
  item: QuickSearchItem;
  initialTarget?: StaffActionId | null;
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [assignTarget, setAssignTarget] = useState<StaffAssignTarget | null>(null);
  const [recordQuery, setRecordQuery] = useState("");
  const [pickedRecord, setPickedRecord] = useState<QuickSearchItem | null>(null);
  const [allocModalOpen, setAllocModalOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // Person-filtered audit trail opens in a WIDE popup — the inline column is
  // far too narrow for the full table (the Affected/record column was pushed
  // out of view behind a horizontal scroll).
  const [auditOpen, setAuditOpen] = useState(false);
  const auditDialogRef = useRef<HTMLDivElement>(null);

  const today = new Date().toISOString().slice(0, 10);
  const oneYearFromToday = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // GUID-first seed for the modal cascade; if the roster can't match it the
  // modal simply opens unseeded and the user picks the person manually.
  const staffGuid = firstQuickString(item.raw?.guid, item.id);

  const capabilitiesQuery = useQuery({
    queryKey: ["myCapabilities"],
    queryFn: () => getMyCapabilities({ fresh: true }),
    staleTime: 60_000,
    refetchOnMount: "always",
  });
  const canManageStaff = capabilitiesQuery.data?.caps.manageStaff === true;
  const permissionReason = !canManageStaff && capabilitiesQuery.data
    ? "Your access level does not allow staff changes."
    : undefined;
  // Tapping a permission-locked action opens an explainer popup instead of
  // doing nothing — the hover tooltip is invisible on touch devices.
  const [permissionPopupOpen, setPermissionPopupOpen] = useState(false);
  const openedInitialTargetRef = useRef<StaffActionId | null>(null);
  useEffect(() => {
    const isAssignment = initialTarget === "PMM" || initialTarget === "OPM" || initialTarget === "LEM";
    if (
      !initialTarget ||
      openedInitialTargetRef.current === initialTarget ||
      capabilitiesQuery.isLoading ||
      (isAssignment && !canManageStaff)
    ) return;
    openedInitialTargetRef.current = initialTarget;
    if (initialTarget === "allocation") {
      setAllocModalOpen(true);
    } else if (initialTarget === "audit") {
      setAuditOpen(true);
    } else if (initialTarget === "PMM" || initialTarget === "OPM" || initialTarget === "LEM") {
      setRecordQuery("");
      setPickedRecord(null);
      setAssignTarget(initialTarget);
    }
  }, [initialTarget, canManageStaff, capabilitiesQuery.isLoading]);

  // Workload for both "Edit allocation" modal and the inline profile view.
  const workloadQuery = useQuery<ResourceWeekAllocations>({
    queryKey: [tenantScopedKey("quick-staff-workload"), staffGuid],
    enabled: allocModalOpen && !!staffGuid,
    staleTime: 60_000,
    queryFn: () => {
      const s = new Date(); s.setFullYear(s.getFullYear() - 1);
      const e = new Date(); e.setFullYear(e.getFullYear() + 2);
      return getResourceWeekAllocations(
        staffGuid,
        s.toISOString().slice(0, 10),
        e.toISOString().slice(0, 10),
      );
    },
  });
  const workloadWeekStarts = useMemo(() => {
    const seen = new Set<string>();
    for (const row of workloadQuery.data?.weeks ?? []) if (row.weekStart) seen.add(row.weekStart);
    return [...seen].sort();
  }, [workloadQuery.data]);

  // Minimal LiveResourceProxy built from QuickSearchItem for EditStaffModal.
  const minimalResource: LiveResourceProxy = useMemo(() => ({
    id: staffGuid,
    name: item.title,
    username: item.email ?? "",
    role: item.role ?? "",
    currentPct: 0,
    totalProjects: item.projectCount ?? 0,
    allProjectIds: [],
    activeProjects: [],
    activeAllocations: [],
    lastActiveDate: null,
  }), [staffGuid, item.title, item.email, item.role, item.projectCount]);

  // Full resource data for the inline profile modal — loaded from the
  // (already-cached) allocations response so the modal appears instantly.
  const profileQuery = useQuery({
    queryKey: [tenantScopedKey("qa-staff-profile"), staffGuid],
    enabled: profileOpen && !!staffGuid,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const resp = await getResourceAllocations();
      return resp.resources.find(r =>
        r.id === staffGuid ||
        (item.email && r.username?.toLowerCase() === item.email.toLowerCase()),
      ) ?? null;
    },
  });
  const profileResource = profileQuery.data ?? null;

  const { flowRootRef, sourceCardRef, actionNodeRefs, flowGeometry } = useQuickActionFlow(
    STAFF_NODE_ORDER,
    [item.id],
  );
  useEffect(() => {
    if (!auditOpen) return;
    const priorOverflow = document.body.style.overflow;
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      const first = auditDialogRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (first ?? auditDialogRef.current)?.focus();
    }, 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setAuditOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(auditDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((node) => node.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        auditDialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = priorOverflow;
      window.setTimeout(() => (actionNodeRefs.current.audit ?? priorFocus)?.focus(), 0);
    };
  }, [auditOpen, actionNodeRefs]);
  const staffFlowColors: Record<string, string> = {
    PMM: STAFF_ASSIGN_META.PMM.color,
    OPM: STAFF_ASSIGN_META.OPM.color,
    LEM: STAFF_ASSIGN_META.LEM.color,
    allocation: STAFF_EXTRA_META.allocation.color,
    editProfile: STAFF_EXTRA_META.editProfile.color,
    audit: STAFF_EXTRA_META.audit.color,
    profile: STAFF_EXTRA_META.profile.color,
  };

  // Best-effort "already on team" hints for the picker list: one call returns
  // every allocation week row for this person; the row projectIds identify
  // records they're already assigned to. This is a HINT only — the
  // authoritative duplicate gate stays the fresh team read in prepQuery plus
  // the modal's edit-existing mode. Leads carry no allocations, so skip LEM.
  const membershipQuery = useQuery({
    queryKey: [tenantScopedKey("quick-actions-staff-memberships"), staffGuid],
    enabled: assignTarget !== null && assignTarget !== "LEM" && !!staffGuid,
    staleTime: 60_000,
    queryFn: async () => {
      const start = new Date();
      start.setFullYear(start.getFullYear() - 2);
      const end = new Date();
      end.setFullYear(end.getFullYear() + 3);
      const res = await getResourceWeekAllocations(
        staffGuid,
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
      );
      const ids = new Set<string>();
      for (const row of res.weeks ?? []) {
        if (row.projectId) ids.add(normalizeTicketKey(row.projectId));
      }
      // Zero-hour assignments are memberships too — they only appear in the
      // engine's `projects` list, never in `weeks`.
      for (const proj of res.projects ?? []) {
        if (proj.projectId) ids.add(normalizeTicketKey(proj.projectId));
      }
      return ids;
    },
  });
  const memberTicketIds = membershipQuery.data;

  // Shares the page-level list caches ("pmm"/"opm"/"lem") so opening a picker
  // is usually instant after a search already loaded the module.
  const recordsQuery = useQuery({
    queryKey: [assignTarget ? assignTarget.toLowerCase() : "quick-staff-records-idle"],
    queryFn: () => getModuleRecords(assignTarget as StaffAssignTarget),
    enabled: assignTarget !== null,
    staleTime: 300_000,
  });

  const recordMatches = useMemo(() => {
    if (!assignTarget) return [];
    const raw = (recordsQuery.data?.data ?? []) as Record<string, unknown>[];
    const rows = raw
      .map((record) => mapQuickModuleRecord(record, assignTarget))
      .filter((row) => row.id && row.title);
    const q = recordQuery.trim().toLowerCase();
    const filtered = q
      ? rows.filter((row) =>
          [row.id, row.title, row.client].some((value) => (value ?? "").toLowerCase().includes(q)))
      : rows;
    return filtered.slice(0, 25);
  }, [assignTarget, recordQuery, recordsQuery.data]);

  const pickedModule = pickedRecord ? (pickedRecord.type as StaffAssignTarget) : null;

  const prepQuery = useQuery({
    // Keyed by module AND id — TicketIds could collide across modules, and a
    // cached prep for the wrong module would open the modal in the wrong mode.
    queryKey: ["quick-actions", "staff-assign-prep", pickedModule ?? "", pickedRecord?.id ?? ""],
    enabled: pickedRecord !== null,
    staleTime: 30_000,
    queryFn: async () => {
      const record = pickedRecord as QuickSearchItem;
      const module = record.type as StaffAssignTarget;
      const [details, team, tasks] = await Promise.all([
        getProjectDetails(record.id, { module }).then(asRecordFieldBag),
        // Team read must NOT be silently caught — existingAllocations powers
        // the duplicate-member rejection in the modal — and it must be a
        // FRESH read (fresh=true busts client + server worker caches) so a
        // stale snapshot can never let a duplicate slip through.
        getProjectTeam(record.id, true),
        // Schedule bounds are optional context; a failed read must not block
        // adding someone (the server still enforces date bounds).
        module === "LEM" ? Promise.resolve(null) : getTaskData(record.id, "0").catch(() => null),
      ]);
      let bounds = { start: "", end: "" };
      if (tasks) {
        const schedule = derivePlannerSchedule(tasks);
        if (schedule.state === "ready" && schedule.phases.length > 0) {
          bounds = {
            start: schedule.phases.reduce(
              (earliest, phase) => (phase.start && phase.start < earliest ? phase.start : earliest),
              schedule.phases[0].start,
            ),
            end: schedule.phases.reduce(
              (latest, phase) => (phase.end && phase.end > latest ? phase.end : latest),
              schedule.phases[0].end,
            ),
          };
        }
      }
      return { details, team, bounds };
    },
  });

  const closeAssignFlow = useCallback(() => {
    setPickedRecord(null);
    setAssignTarget(null);
    setRecordQuery("");
  }, []);

  const targetStart = prepQuery.data
    ? firstQuickString(prepQuery.data.details.TargetStartDate).slice(0, 10)
    : "";
  const targetEnd = prepQuery.data
    ? firstQuickString(prepQuery.data.details.TargetCompletionDate).slice(0, 10)
    : "";

  const modalReady = pickedRecord !== null && prepQuery.data !== undefined;

  return (
    <>
      <div
        ref={flowRootRef}
        className="relative grid min-w-0 grid-cols-1 items-start justify-start gap-8 lg:grid-cols-[300px_minmax(0,360px)] lg:gap-12 animate-in fade-in slide-in-from-bottom-8 duration-500 ease-out"
      >
        <ActionFlowSvg geometry={flowGeometry} pathPrefix="qa-staff" colors={staffFlowColors} />

        <div className="relative z-10 sticky top-10 min-w-0 w-full lg:mt-16">
          <div ref={sourceCardRef} className="rounded-3xl border border-[var(--rm-panel-border)] bg-[var(--rm-panel)] shadow-xl overflow-hidden">
            <div className="relative border-b border-[var(--rm-panel-border)] p-5">
              <div className="absolute top-0 left-0 right-0 h-1.5" style={{ backgroundColor: TYPE_STYLES.STAFF.color }} />
              <div className="mb-4 flex items-start justify-between gap-4">
                <TypeBadge item={item} />
                <button type="button" onClick={onClose} aria-label="Close selected staff member" data-testid="quick-actions-close" className="rounded-full p-2 text-[var(--rm-text-muted)] hover:bg-[var(--rm-bg)] hover:text-[var(--rm-text)] transition"><X className="h-5 w-5" /></button>
              </div>
              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                className="group block w-full text-left focus:outline-none"
                title="View full staff profile"
              >
                <h2 className="text-xl font-extrabold tracking-tight leading-snug group-hover:text-[var(--rm-green)] transition-colors flex items-center gap-2">
                  {item.title}
                  <UserCircle className="h-4 w-4 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
                </h2>
              </button>
            </div>

            <div className="bg-[var(--rm-bg)] p-5">
              <dl className="grid gap-y-4">
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--rm-text-faint)]">Role</dt>
                  <dd className="mt-1.5 text-[14px] font-medium">{item.role || "—"}</dd>
                </div>
                {item.email && (
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--rm-text-faint)]">Email</dt>
                    <dd className="mt-1.5 text-[14px] font-medium break-all">{item.email}</dd>
                  </div>
                )}
                {item.projectCount !== undefined && (
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--rm-text-faint)]">Projects</dt>
                    <dd className="mt-1.5 text-[14px] font-medium">{item.projectCount}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </div>

        <div className="relative z-10 min-w-0 w-full max-w-[360px] py-1">
          <div className="space-y-3">
            {STAFF_NODE_ORDER.map((nodeId) => {
              const isAssign = (nodeId as string) in STAFF_ASSIGN_META;
              const isExtra  = (nodeId as string) in STAFF_EXTRA_META;
              const meta = isAssign
                ? STAFF_ASSIGN_META[nodeId as StaffAssignTarget]
                : STAFF_EXTRA_META[nodeId as StaffNodeExtra];
              const Icon = meta.icon;
              const allowed = !isAssign || canManageStaff;
              const active = isAssign && assignTarget === (nodeId as StaffAssignTarget);
              // A blocked card must LOOK locked even when it would be the
              // default-highlighted first card — grey wins over highlight.
              const highlighted = allowed && (active || (!assignTarget && nodeId === STAFF_NODE_ORDER[0]));

              return (
                <div key={nodeId} className="relative">
                  <button
                    ref={(node) => { actionNodeRefs.current[nodeId] = node; }}
                    type="button"
                    aria-disabled={!allowed}
                    onClick={() => {
                      if (!allowed) { setPermissionPopupOpen(true); return; }
                      if (nodeId === "profile") { setProfileOpen(true); return; }
                      if (nodeId === "audit") { setAuditOpen(true); return; }
                      if (nodeId === "allocation") { setAllocModalOpen(true); return; }
                      if (nodeId === "editProfile") { setEditProfileOpen(true); return; }
                      setRecordQuery("");
                      setPickedRecord(null);
                      setAssignTarget(nodeId as StaffAssignTarget);
                    }}
                    title={!allowed ? permissionReason : undefined}
                    className={`flex min-h-[62px] w-full items-center gap-3 rounded-2xl border p-3 text-left shadow-sm transition-all duration-200
                      ${highlighted ? 'border-[var(--rm-green)] bg-[var(--rm-green-soft)] shadow-md' : !allowed ? 'cursor-not-allowed border-[var(--rm-panel-border)] bg-[var(--rm-panel)] opacity-50' : 'border-[var(--rm-panel-border)] bg-[var(--rm-panel)] hover:translate-x-1 hover:border-[var(--rm-text-faint)] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[var(--rm-green-soft)]'}
                    `}
                    data-testid={`quick-action-staff-${nodeId.toLowerCase()}`}
                  >
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors"
                      style={{ backgroundColor: highlighted ? meta.color : meta.soft, color: highlighted ? "#fff" : meta.color }}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <span className={`block truncate text-[15px] font-bold ${highlighted ? 'text-[var(--rm-green)]' : 'text-[var(--rm-text)]'}`}>{meta.label}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-[var(--rm-text-muted)]">{meta.sub}</span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Person-filtered audit trail — WIDE popup, full record-page format ── */}
      {auditOpen && (
        <div
          onClick={(event) => { if (event.target === event.currentTarget) setAuditOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: Z.MODAL, background: "rgba(10,22,32,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}
        >
          <div
            ref={auditDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Audit trail for ${item.title}`}
            tabIndex={-1}
            data-testid="quick-actions-staff-audit-popup"
            style={{ width: "min(1340px, 96vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", borderRadius: 18, border: "1px solid var(--rm-panel-border)", background: "var(--rm-bg)", boxShadow: "0 24px 64px rgba(0,0,0,.35)", overflow: "hidden", outline: "none" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "1px solid var(--rm-panel-border)", background: "var(--rm-panel)" }}>
              <Activity size={20} color="var(--rm-green)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: "block", fontSize: 15, color: "var(--rm-text)" }}>Audit Trail — {item.title}</strong>
                <span style={{ display: "block", marginTop: 2, fontSize: 12, color: "var(--rm-text-muted)" }}>Everything this person did across projects, opportunities, and leads</span>
              </div>
              <button
                type="button"
                onClick={() => setAuditOpen(false)}
                aria-label="Close audit trail"
                data-testid="quick-actions-staff-audit-close"
                className="rounded-full p-2 text-[var(--rm-text-muted)] hover:bg-[var(--rm-bg)] hover:text-[var(--rm-text)] transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div style={{ overflowY: "auto" }}>
              <AuditTrailCard
                title="Audit Trail"
                subjectId={staffGuid}
                subjectEmail={item.email}
                defaultOpen
                defaultActivity="data"
                recordsOnly
                hideHeader
              />
            </div>
          </div>
        </div>
      )}

      {/* Tapping a locked staff action opens this explainer popup. */}
      <Dialog open={permissionPopupOpen} onOpenChange={setPermissionPopupOpen}>
        <DialogContent className="max-w-sm" data-testid="quick-action-staff-permission-popup">
          <DialogHeader>
            <DialogTitle>This action is locked</DialogTitle>
            <DialogDescription>
              {permissionReason ?? "Your access level does not allow staff changes."}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      {/* ── Edit allocation timeline modal ── */}
      {allocModalOpen && (
        <ExistingWorkTimelineModal
          personName={item.title}
          personId={staffGuid}
          personRole={item.role ?? ""}
          workload={workloadQuery.data ?? null}
          weekStarts={workloadWeekStarts}
          canEdit={canManageStaff}
          onClose={() => setAllocModalOpen(false)}
          onOpenProject={(projectId) => {
            setAllocModalOpen(false);
            onNavigate(`/project/${encodeURIComponent(projectId)}`);
          }}
          onSaved={() => void workloadQuery.refetch()}
        />
      )}

      {/* ── Inline Resource Profile modal ── */}
      {profileOpen && (
        <QAStaffProfileModal
          resource={profileResource}
          loading={profileQuery.isLoading}
          onClose={() => setProfileOpen(false)}
          onOpenFull={() => { setProfileOpen(false); onNavigate(quickActionPath(item)); }}
        />
      )}

      {/* ── Edit profile modal ── */}
      <EditStaffModal
        open={editProfileOpen}
        resource={minimalResource}
        onClose={() => setEditProfileOpen(false)}
        onSaved={() => {
          setEditProfileOpen(false);
          void workloadQuery.refetch();
        }}
      />


      <Dialog
        open={assignTarget !== null && !modalReady}
        onOpenChange={(open) => {
          if (!open) closeAssignFlow();
        }}
      >
        <DialogContent className="max-w-2xl" data-testid="quick-staff-picker-dialog">
          <DialogHeader>
            <DialogTitle>
              {assignTarget ? STAFF_ASSIGN_META[assignTarget].label : ""}
            </DialogTitle>
            <DialogDescription>
              {assignTarget
                ? `Pick the ${STAFF_ASSIGN_META[assignTarget].noun} for ${item.title}. Role, business unit, and division prefill from their profile — the role can be changed before saving.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            {pickedRecord ? (
              prepQuery.isError ? (
                <div className="rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] p-5 text-sm text-[var(--rm-text-muted)]">
                  <p>We couldn’t load the current team for {pickedRecord.title}, so no one can be added yet.</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void prepQuery.refetch()}
                      className="rounded-lg bg-[var(--rm-green)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-95"
                    >
                      Try again
                    </button>
                    <button
                      type="button"
                      onClick={() => setPickedRecord(null)}
                      className="rounded-lg border border-[var(--rm-panel-border)] px-4 py-2 text-sm font-bold text-[var(--rm-text)] transition hover:bg-[var(--rm-bg)]"
                    >
                      Pick another
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[120px] flex-col items-center justify-center gap-3 text-sm text-[var(--rm-text-muted)]">
                  <Loader2 className="h-6 w-6 animate-spin text-[var(--rm-green)]" />
                  <span>Preparing {pickedRecord.title}…</span>
                </div>
              )
            ) : (
              <>
                <div className="relative mb-3">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--rm-text-faint)]" />
                  <input
                    autoFocus
                    value={recordQuery}
                    onChange={(event) => setRecordQuery(event.target.value)}
                    placeholder={assignTarget ? `Search ${STAFF_ASSIGN_META[assignTarget].noun}s by name, ID, or client…` : ""}
                    className="w-full rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] py-2.5 pl-10 pr-4 text-[14px] font-medium outline-none transition focus:border-[var(--rm-green)]"
                    data-testid="quick-staff-record-search"
                  />
                </div>
                {recordsQuery.isLoading ? (
                  <div className="flex min-h-[120px] items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-[var(--rm-green)]" />
                  </div>
                ) : recordsQuery.isError ? (
                  <div className="rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] p-5 text-sm text-[var(--rm-text-muted)]">
                    <p>We couldn’t load the list. Try again.</p>
                    <button
                      type="button"
                      onClick={() => void recordsQuery.refetch()}
                      className="mt-3 rounded-lg bg-[var(--rm-green)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-95"
                    >
                      Try again
                    </button>
                  </div>
                ) : recordMatches.length === 0 ? (
                  <div className="rounded-xl border border-[var(--rm-panel-border)] bg-[var(--rm-bg)] p-5 text-sm text-[var(--rm-text-muted)]">
                    No matching {assignTarget ? STAFF_ASSIGN_META[assignTarget].noun : "record"}s found.
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {recordMatches.map((row) => {
                      const alreadyOnTeam = memberTicketIds?.has(normalizeTicketKey(row.id)) === true;
                      return (
                      <button
                        type="button"
                        key={row.id}
                        onClick={() => setPickedRecord(row)}
                        className={`flex w-full items-center gap-3 rounded-xl border bg-[var(--rm-bg)] p-3 text-left transition hover:shadow-sm ${
                          alreadyOnTeam
                            ? "border-[var(--rm-ink-red)] hover:border-[var(--rm-ink-red)]"
                            : "border-[var(--rm-panel-border)] hover:border-[var(--rm-green)]"
                        }`}
                        data-testid={`quick-staff-pick-${row.id}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-bold text-[var(--rm-text)]">{row.title}</span>
                          <span className="mt-0.5 block truncate font-sans text-[11px] text-[var(--rm-text-faint)]">
                            {row.id}{row.client ? ` · ${row.client}` : ""}
                          </span>
                        </span>
                        {alreadyOnTeam && (
                          <span
                            className="shrink-0 rounded-full border border-[var(--rm-ink-red)] bg-[rgba(220,38,38,0.08)] px-2 py-0.5 text-[10px] font-bold text-[var(--rm-ink-red)]"
                            title={`${item.title} is already on this team — picking it opens the hours editor instead of adding a duplicate.`}
                            data-testid={`quick-staff-already-${row.id}`}
                          >
                            Already on team · edits hours
                          </span>
                        )}
                        {row.status && (
                          <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-[var(--rm-text-muted)]">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: resolvePhaseColor(row.status).bg }} />
                            {row.status}
                          </span>
                        )}
                      </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {pickedRecord && prepQuery.data && (
        <AddTeamMemberModal
          open
          onClose={closeAssignFlow}
          projectId={pickedRecord.id}
          module={pickedModule}
          projectName={pickedRecord.title}
          projectStartDate={prepQuery.data.bounds.start || targetStart || today}
          projectEndDate={prepQuery.data.bounds.end || targetEnd || oneYearFromToday}
          scheduleStart={prepQuery.data.bounds.start || undefined}
          scheduleEnd={prepQuery.data.bounds.end || undefined}
          existingAllocations={quickExistingAllocations(prepQuery.data.team.team)}
          // The prep read is fresh, so a one-slot project can transfer that
          // exact demand row in the same /assign-resource save. Multi-slot
          // projects stay role-safe: the modal's suggestion chips carry the
          // selected slot's own RA IDs instead of consuming every open role.
          consumeRaIds={openSlotRaIdsForQuickFill(prepQuery.data.team.openRoles, item.role)}
          inferredConsumeRaIds
          openRoles={prepQuery.data.team.openRoles}
          requireOpenRoleSelection={hasDuplicateOpenRoleChoices(prepQuery.data.team.openRoles)}
          seedPersonId={staffGuid || undefined}
          personOnly={pickedModule === "LEM"}
          onAssigned={(personName, optimistic) => {
            const record = pickedRecord;
            closeAssignFlow();
            void queryClient.invalidateQueries({ queryKey: ["quick-actions", "team", record.id] });
            void queryClient.invalidateQueries({ queryKey: ["quick-actions", "staff-assign-prep", record.type, record.id] });
            refreshProjectTeamCache(queryClient, record.id);
            toast({
              title: optimistic?.isExisting ? "Hours updated" : `Added to ${TYPE_LABELS[record.type].toLowerCase()}`,
              description: `${personName} · ${record.title}`,
            });
          }}
          onOpenProject={(targetProjectId) => {
            closeAssignFlow();
            onNavigate(`/project/${encodeURIComponent(targetProjectId)}`);
          }}
          onSetupSchedule={() => {
            // pickedRecord is captured from this render's scope where it's
            // non-null; React state updates are batched so it's still valid
            // when this callback fires (after onClose has been called by the
            // modal's requestDismiss).
            const id = pickedRecord?.id;
            if (id) onNavigate(`/project/${encodeURIComponent(id)}#schedule-section`);
          }}
        />
      )}
    </>
  );
}
