import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  canUseQuickAction,
  canViewQuickTeam,
  quickActionLockReason,
  quickActionEligibleTypes,
  groupQuickSearchResults,
  mapQuickCompany,
  mapQuickModuleRecord,
  mapQuickStaff,
  quickActionFieldName,
  quickActionIdsForType,
  quickActionPath,
  quickActionRefreshTargets,
  quickProjectTeamPath,
} from "../quickActions";

const project = mapQuickModuleRecord({
  TicketId: "PMM-26-42",
  Title: "Airport Expansion",
  CRMCompanyLookupName: "Northwind",
  CRMProjectStatusChoice: "Construction",
}, "PMM");
const opportunity = mapQuickModuleRecord({
  RecordId: "CUSTOM-OPP-7",
  ShortName: "Lab fit-out",
  ModuleStepLookup: "Pursuit",
}, "OPM");
const lead = mapQuickModuleRecord({
  Id: "LD-9",
  Title: "Campus enquiry",
}, "LEM");
const company = mapQuickCompany({ id: 17, ticketId: "COM-17", title: "Northwind" });
const staff = mapQuickStaff({
  source: "user",
  name: "Avery Stone",
  email: "avery@example.invalid",
  title: "Project Manager",
});

assert.equal(project.id, "PMM-26-42");
assert.equal(project.status, "Construction");
assert.equal(opportunity.id, "CUSTOM-OPP-7");
assert.equal(opportunity.status, "Pursuit");
assert.equal(lead.status, "Open");
assert.ok(staff);

const grouped = groupQuickSearchResults(
  [project, opportunity, lead, company, staff!],
  "north",
);
assert.deepEqual(grouped.PMM.map((item) => item.id), ["PMM-26-42"]);
assert.deepEqual(grouped.COM.map((item) => item.id), ["COM-17"]);
assert.equal(grouped.STAFF.length, 0);

assert.deepEqual(
  quickActionIdsForType("PMM"),
  ["team", "position", "allocation", "status", "notes", "endings", "open"],
  "PMM must include endings (Mark as Lost / Cancel — no advance, projects are the final destination)",
);
assert.deepEqual(
  quickActionIdsForType("OPM"),
  ["team", "position", "allocation", "status", "notes", "endings", "open"],
  "OPM must include the endings card (Advance to Project / Lost / Cancel)",
);
assert.deepEqual(
  quickActionIdsForType("LEM"),
  ["leads", "status", "notes", "endings", "open"],
  "LEM must include the leads card (Add Lead) and the endings card (Advance to Opportunity / Lost / Cancel)",
);
assert.deepEqual(quickActionIdsForType("COM"), ["open"]);
assert.deepEqual(quickActionIdsForType("STAFF"), ["open"]);
assert.equal(canViewQuickTeam("PMM"), true);
assert.equal(canViewQuickTeam("OPM"), true);
assert.equal(canViewQuickTeam("LEM"), false);
assert.equal(canViewQuickTeam("COM"), false);
assert.equal(canViewQuickTeam("STAFF"), false);
assert.equal(
  quickProjectTeamPath("PMM/26 43", "PMM"),
  "/project/PMM%2F26%2043?section=team&module=PMM",
);
const teamModalSource = readFileSync(
  new URL("../../components/QuickActionsTeamModal.tsx", import.meta.url),
  "utf8",
);
const allocationPlannerSource = readFileSync(
  new URL("../../components/TeamAllocationPlanner.tsx", import.meta.url),
  "utf8",
);
const addTeamMemberSource = readFileSync(
  new URL("../../components/AddTeamMemberModal.tsx", import.meta.url),
  "utf8",
);
const existingWorkTimelineSource = readFileSync(
  new URL("../../components/ExistingWorkTimelineModal.tsx", import.meta.url),
  "utf8",
);
const teamScheduleGridSource = readFileSync(
  new URL("../../components/TeamScheduleGrid.tsx", import.meta.url),
  "utf8",
);
assert.match(
  teamScheduleGridSource,
  /overflow: modalScrollOwner \? "visible" : "hidden"/,
  "The Home team grid must let its sticky horizontal scrollbar escape the inner border wrapper",
);
assert.match(
  teamScheduleGridSource,
  /rm-grid-mirror-scroll[\s\S]*?position: "sticky" as const[\s\S]*?bottom: 0/,
  "The Home team grid must pin its horizontal scrollbar to the modal viewport",
);
const assignMemberCascadeSource = readFileSync(
  new URL("../../hooks/useAssignMemberCascade.ts", import.meta.url),
  "utf8",
);
const quickActionsPageSource = readFileSync(
  new URL("../../pages/quick-actions.tsx", import.meta.url),
  "utf8",
);
const projectDetailSource = readFileSync(
  new URL("../../pages/project-detail.tsx", import.meta.url),
  "utf8",
);
const resourcesPageSource = readFileSync(
  new URL("../../pages/resources.tsx", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  projectDetailSource,
  /const aclCanEdit = user\?\.canEdit !== false/,
  "Project Detail must not cancel a customized built-in User capability with the legacy login-time User=view-only flag",
);
assert.match(
  projectDetailSource,
  /const canEdit = settledPerms\?\.canEditData === true;[\s\S]*?const canAdvanceStage = canEdit && settledPerms\?\.canAdvanceStage === true;[\s\S]*?const canEditFinancialFields = settledPerms\?\.canEditFinancials === true;/,
  "Project Detail edit, stage and financial controls must use the live server capability bundle independently",
);
assert.match(
  projectDetailSource,
  /<SchedulePhases[\s\S]*?canEdit=\{canEdit\} isAdmin=\{user\?\.isAdmin === true\}/,
  "Schedule editing must follow Edit data while per-record rules remain strictly admin-only",
);
assert.match(
  quickActionsPageSource,
  /queryFn: \(\) => getMyCapabilities\(\{ fresh: true \}\)[\s\S]{0,100}?refetchOnMount: "always"/,
  "Quick Actions must fetch fresh built-in capability overrides when its action hub opens",
);
assert.doesNotMatch(
  resourcesPageSource,
  /canManageStaff\s*=\s*canEdit\s*&&/,
  "Manage staff must work as a standalone capability for a customized built-in User",
);
assert.match(
  resourcesPageSource,
  /getMyCapabilities\(\{ fresh: true \}\)/,
  "The Staff page must resolve fresh capability overrides",
);
assert.match(
  resourcesPageSource,
  /const canEdit = dataCapOk;\s*const canManageStaff = staffCapOk;/,
  "Edit data and Manage staff must remain independent on the Resources page",
);
assert.match(
  teamModalSource,
  /data-testid="quick-actions-open-project"[\s\S]*?onClick=\{onOpenProject\}|onClick=\{onOpenProject\}[\s\S]*?data-testid="quick-actions-open-project"/,
  "The Quick Actions Open project button must call its navigation handler",
);
assert.match(
  quickActionsPageSource,
  /onOpenProject=\{\(\) => \{[\s\S]*?onNavigate\(quickProjectTeamPath\(item\.id, teamModule\)\)/,
  "Open project must navigate to the selected record's encoded Team route",
);
assert.match(
  quickActionsPageSource,
  /data-testid="quick-action-custom-status"[\s\S]*?Type a custom status/,
  "Quick Actions must expose the same free-text custom status entry as Project Details",
);
assert.match(
  quickActionsPageSource,
  /data-testid="quick-action-save-custom-status"[\s\S]*?persistField\("status"/,
  "Quick Actions custom status entry must use the existing status save path",
);
assert.match(
  allocationPlannerSource,
  /data-testid="allocation-planner-open-project"[\s\S]*?onClick=\{onOpenProject\}|onClick=\{onOpenProject\}[\s\S]*?data-testid="allocation-planner-open-project"/,
  "The allocation workspace must expose a clear link to its current project",
);
assert.match(
  existingWorkTimelineSource,
  /data-testid=\{`existing-work-open-project-\$\{project\.id\}`\}[\s\S]*?onOpenProject\(project\.id\)/,
  "Existing workload rows must expose a direct project link when navigation is available",
);
assert.match(
  allocationPlannerSource,
  /timelineScrollRef[\s\S]*?bookedIndices[\s\S]*?viewport\.scrollLeft/,
  "The allocation workspace must focus the selected person's booked weeks instead of always opening at the project start",
);
assert.match(
  allocationPlannerSource,
  /rm-planner-scroll-viewport/,
  "The allocation workspace must hide the full-grid horizontal track",
);
assert.match(
  allocationPlannerSource,
  /marginLeft: frozenColumnsWidth[\s\S]*?rm-weekly-scroll-control/,
  "The allocation workspace must place the visible scroll control under weekly hours only",
);
// The scroll control is now a range slider: dragging the timeline updates the
// slider position (onScroll → setTimelineScrollLeft) and moving the slider
// drives the timeline viewport (onChange → viewport.scrollLeft).
assert.match(
  allocationPlannerSource,
  /onScroll=\{[\s\S]*?setTimelineScrollLeft\(viewport\.scrollLeft\)/,
  "The allocation timeline must report its scroll position to the weekly-only scroll control",
);
assert.match(
  allocationPlannerSource,
  /rm-weekly-scroll-control[\s\S]*?timelineScrollRef\.current;[\s\S]*?viewport\.scrollLeft = next/,
  "The weekly-only scroll control must stay synchronized with the allocation timeline",
);
assert.match(
  addTeamMemberSource,
  /plannerScheduleState !== "ready"[\s\S]*?setStartDate\(scheduleWindow\.start\)[\s\S]*?setEndDate\(scheduleWindow\.end\)/,
  "The allocation workspace must clamp hidden assignment dates to its authoritative phase schedule",
);
assert.match(
  quickActionsPageSource,
  /onOpenProject=\{\(targetProjectId\) => \{[\s\S]*?quickProjectTeamPath\(targetProjectId, teamModule\)[\s\S]*?`\/project\/\$\{encodeURIComponent\(targetProjectId\)\}`/,
  "Quick Actions must route the current project to Team and other workload projects to their record page",
);
assert.match(
  quickActionsPageSource,
  /scheduleStart=\{quickScheduleBounds\.start \|\| undefined\}[\s\S]*?scheduleEnd=\{quickScheduleBounds\.end \|\| undefined\}/,
  "Quick Actions must pass the authoritative phase-schedule window into the shared add-member modal",
);
assert.match(
  quickActionsPageSource,
  /applyOptimisticProjectTeamMember\(queryClient, item\.id,[\s\S]*?refreshAfterMutation\(action\)/,
  "Quick Actions must patch the shared team cache before its background reconciliation",
);
assert.match(
  teamModalSource,
  /<TeamScheduleGrid[\s\S]*?modalScrollOwner[\s\S]*?onToggleFlag=\{onToggleFlag\}/,
  "Quick Actions must pass the same flag controls into the shared Project Team grid",
);
assert.match(
  teamModalSource,
  /overflow-x-hidden overflow-y-auto/,
  "Quick Actions owns vertical scrolling and must not create a second horizontal track",
);
assert.match(
  teamScheduleGridSource,
  /modalScrollOwner \? "hidden" : "auto"/,
  "The shared grid keeps horizontal scrolling while a modal owns its vertical viewport",
);
assert.match(
  quickActionsPageSource,
  /setAllocationFlag\(item\.id, member\.resourceId, flag, value, rateToSend\)/,
  "Quick Actions flag changes must use the canonical allocation-flag save path",
);
assert.match(
  teamScheduleGridSource,
  /Before & after non-chargeable[\s\S]*?moved to NC[\s\S]*?no longer bills the client/,
  "Hovering an NC EAC cost must explain the before/after change and the hours moved to NC",
);
assert.match(
  teamScheduleGridSource,
  /if \(!s\.on && !clickable\)[\s\S]*?border: `1px dashed \$\{meta\.chipBd\}`[\s\S]*?\{inner\}/,
  "Read-only Quick Actions flags must still show all three S, NC, and lock marks",
);
assert.match(
  assignMemberCascadeSource,
  /weeklyHours: directWeeklyEntries\.map\(\(\{ week, hours \}\) => \(\{ week, hours \}\)\)/,
  "The shared add-member save must return confirmed weekly hours for immediate cross-surface cache updates",
);
assert.match(
  quickActionsPageSource,
  /personOnly=\{pickedModule === "LEM"\}/,
  "Staff → Add to lead must enter the person-only assignment path",
);
assert.doesNotMatch(
  quickActionsPageSource,
  /showHoursField=\{pickedModule === "LEM"\}|forceDates=\{pickedModule === "LEM"\}/,
  "Lead adds must not opt into the legacy hours/date form",
);
assert.match(
  addTeamMemberSource,
  /isAllocationWorkspace[\s\S]*?!personOnly[\s\S]*?plannedWeeklyHours: isAllocationWorkspace \? plannedWeeklyHours : undefined/,
  "The person-only modal must never initialize or save a weekly allocation workspace",
);
assert.match(
  addTeamMemberSource,
  /!personOnly && !hideDates[\s\S]*?!personOnly && showHoursField/,
  "The person-only modal must hide both date and total-hours controls",
);
assert.match(
  assignMemberCascadeSource,
  /\.\.\.\(!personOnly \? \{\s*AllocationStartDate:[\s\S]*?AllocationEndDate:[\s\S]*?\} : \{\}\)[\s\S]*?PctAllocation: personOnly \? 0/,
  "Person-only saves must omit date fields and retain a zero-hour team relationship",
);
assert.match(
  teamScheduleGridSource,
  /function formatWeeklyTotal[\s\S]*?Math\.round[\s\S]*?\{formatWeeklyTotal\(total\)\}/,
  "Weekly team totals must be rounded before rendering so floating-point tails cannot overlap adjacent weeks",
);

assert.equal(quickActionFieldName("PMM", "status", {}), "CRMProjectStatusChoice");
assert.equal(quickActionFieldName("OPM", "status", {}), "CRMOpportunityStatusChoice");
assert.equal(quickActionFieldName("LEM", "status", {}), "LeadStatus");
assert.equal(
  quickActionFieldName("PMM", "note", { ProjectSummaryNote: "Existing" }),
  "ProjectSummaryNote",
);
assert.equal(quickActionFieldName("PMM", "note", { Comment: "Legacy" }), "Comment");
assert.equal(quickActionFieldName("OPM", "note", {}), "Note");
assert.equal(quickActionFieldName("LEM", "note", {}), "Comment");
assert.equal(quickActionFieldName("LEM", "description", {}), "Description");

assert.equal(quickActionPath(company), "/projects?view=Companies");
// Staff deep link carries the resource GUID so the Resources page can open
// the profile modal directly (not just pre-filter the search list).
assert.equal(
  quickActionPath(staff!),
  `/resources?view=Staff&openProfile=${encodeURIComponent(staff!.id)}`,
);
assert.equal(quickActionPath(project), "/project/PMM-26-42");
assert.equal(quickActionPath(company).includes("/project/"), false);
assert.equal(quickActionPath(staff!).includes("/project/"), false);

const editable = {
  canEditData: true,
  canAdvanceStage: true,
  canEditFinancials: false,
  reason: null,
};
assert.equal(canUseQuickAction("PMM", "team", editable, true), true);
assert.equal(canUseQuickAction("PMM", "team", editable, false), false);
assert.equal(canUseQuickAction("LEM", "team", editable, true), false);
assert.equal(canUseQuickAction("PMM", "allocation", editable, true), true);
assert.equal(canUseQuickAction("PMM", "allocation", editable, false), false);
assert.equal(canUseQuickAction("LEM", "allocation", editable, true), false);
assert.equal(canUseQuickAction("OPM", "status", editable, false), true);
assert.equal(
  canUseQuickAction("OPM", "status", { ...editable, canAdvanceStage: false }, true),
  false,
);
assert.equal(canUseQuickAction("COM", "open", undefined, false), true);
// endings needs canAdvanceStage; PMM never gets it.
assert.equal(canUseQuickAction("OPM", "endings", editable, false), true);
assert.equal(canUseQuickAction("LEM", "endings", editable, false), true);
assert.equal(
  canUseQuickAction("OPM", "endings", { ...editable, canAdvanceStage: false }, false),
  false,
  "endings must be gated on canAdvanceStage just like status",
);
assert.equal(
  canUseQuickAction("PMM", "endings", editable, false),
  true,
  "PMM must show endings (Lost + Cancel — no Advance, projects are the final destination)",
);
assert.equal(
  canUseQuickAction("PMM", "endings", { ...editable, canAdvanceStage: false }, false),
  false,
  "PMM endings must be gated on canAdvanceStage",
);

// Per-card lock reasons: each locked card names the SPECIFIC setting that
// locks it — never one blanket message covering every card (client report:
// a manager missing only manage-staff saw ALL cards locked with stage copy).
assert.equal(quickActionLockReason("PMM", "team", editable, true), null);
assert.equal(
  canUseQuickAction("PMM", "team", { ...editable, canEditData: false }, true),
  true,
  "Manage staff must unlock Quick Actions staffing without also requiring Edit data",
);
assert.equal(
  canUseQuickAction("PMM", "position", { ...editable, canEditData: false }, true),
  true,
  "Manage staff alone must allow adding an open position",
);
assert.equal(
  canUseQuickAction("PMM", "allocation", { ...editable, canEditData: false }, true),
  true,
  "Manage staff alone must allow editing staffing allocations",
);
assert.equal(quickActionLockReason("PMM", "open", editable, false), null, "open is never locked");
assert.equal(quickActionLockReason("PMM", "team", undefined, false), null, "unknown perms → no reason yet");
assert.match(
  quickActionLockReason("PMM", "team", editable, false) ?? "",
  /staffing/i,
  "staffing cards blocked only by manage-staff must explain the staffing capability",
);
assert.match(quickActionLockReason("PMM", "allocation", editable, false) ?? "", /staffing/i);
assert.match(quickActionLockReason("PMM", "position", editable, false) ?? "", /staffing/i);
assert.equal(
  quickActionLockReason("PMM", "notes", editable, false),
  null,
  "notes stays open when only manage-staff is missing",
);
assert.match(
  quickActionLockReason("PMM", "status", { ...editable, canAdvanceStage: false }, true) ?? "",
  /different stage/i,
  "status locked by the stage-advance capability gets stage-advance copy",
);
assert.match(
  quickActionLockReason("OPM", "endings", { ...editable, canAdvanceStage: false }, true) ?? "",
  /different stage/i,
);
const stageLocked = {
  canEditData: false,
  canAdvanceStage: false,
  canEditFinancials: false,
  reason: 'Changes at the "Active" stage are limited to the people assigned to it.',
};
assert.equal(
  quickActionLockReason("PMM", "notes", stageLocked, true),
  stageLocked.reason,
  "a genuine server-side lock keeps the server's reason on every card",
);
assert.equal(
  quickActionLockReason("PMM", "team", stageLocked, true),
  null,
  "a stage/data lock must not cancel the standalone Manage staff capability",
);
assert.match(
  quickActionLockReason(
    "PMM",
    "notes",
    { canEditData: false, canAdvanceStage: false, canEditFinancials: false, reason: null },
    true,
  ) ?? "",
  /view-only/i,
  "an editData lock with no server reason falls back to view-only copy",
);

assert.deepEqual(
  quickActionRefreshTargets("PMM", "team"),
  ["details", "module", "team"],
);
assert.deepEqual(
  quickActionRefreshTargets("PMM", "allocation"),
  ["details", "module", "team"],
);
assert.deepEqual(
  quickActionRefreshTargets("LEM", "notes"),
  ["details", "module"],
);
assert.deepEqual(quickActionRefreshTargets("STAFF", "open"), []);

// Landing "start from an action" cards: eligible record types per action.
assert.deepEqual(quickActionEligibleTypes("team"), ["PMM", "OPM"]);
assert.deepEqual(quickActionEligibleTypes("position"), ["PMM", "OPM"]);
assert.deepEqual(quickActionEligibleTypes("allocation"), ["PMM", "OPM"]);
assert.deepEqual(quickActionEligibleTypes("status"), ["PMM", "OPM", "LEM"]);
assert.deepEqual(quickActionEligibleTypes("notes"), ["PMM", "OPM", "LEM"]);
assert.deepEqual(quickActionEligibleTypes("open"), ["PMM", "OPM", "LEM"]);
// "endings" is PMM + OPM + LEM — PMM gets Lost + Cancel (no Advance).
assert.deepEqual(
  quickActionEligibleTypes("endings"),
  ["PMM", "OPM", "LEM"],
  "endings card appears for PMM (Lost/Cancel only), OPM and LEM (also Advance)",
);

// The Quick Actions team view keeps data editing and staffing independent:
// phase cards use Edit data, while the grid toolbar/member/allocation controls
// use Manage staff. The search pick's seed still flows into the shared popup.
assert.match(
  teamModalSource,
  /<PhaseCardsStrip[\s\S]*?canEdit=\{canEdit\}/,
  "Quick Actions phase editing must continue to use Edit data",
);
assert.match(
  teamModalSource,
  /<TeamScheduleGrid[\s\S]*?canEdit=\{canManageStaff\}[\s\S]*?onMemberAdded=\{canManageStaff \? onMemberAdded : undefined\}/,
  "The Quick Actions team grid must use Manage staff for its member/allocation toolbar",
);
assert.match(
  teamModalSource,
  /onRemoveMember=\{onRemoveMember\}[\s\S]*?onRemoveOpenPosition=\{onRemoveOpenPosition\}/,
  "The Quick Actions team view must forward the manage-staff removal handlers",
);
assert.match(
  quickActionsPageSource,
  /onAddMember=\{\(seed\) => \{[\s\S]*?setAddMemberSeed\(seed \?\? null\)[\s\S]*?setTeamModalOpen\(true\)/,
  "A person picked from the grid toolbar search must seed the shared Add Team Member popup",
);
assert.match(
  quickActionsPageSource,
  /seedPersonId=\{addMemberSeed\?\.personId\}/,
  "The seeded person must pre-select in the Add Team Member popup (same duplicate rules as Project Detail)",
);
assert.match(
  quickActionsPageSource,
  /const actionPreparationPending = \(action: QuickActionId\) =>[\s\S]*?accessChecksPending[\s\S]*?teamPending/,
  "Quick Actions must keep pending access/team checks separate from a real permission lock",
);
assert.match(
  quickActionsPageSource,
  /if \(preparing\) \{ setQueuedAction\(action\); return; \}[\s\S]*?if \(blocked\) \{ setPermissionPopupAction\(action\); setPermissionPopupOpen\(true\); return; \}/,
  "A click while Quick Actions is preparing must queue before the real lock popup is considered (and the popup must know WHICH card was tapped)",
);
assert.match(
  quickActionsPageSource,
  /onMouseEnter=\{\(\) => prefetchSearchResult\(item\)\}/,
  "Project search results must warm their data on sustained hover without a broad fan-out",
);

console.log("quick-actions: all assertions passed");
