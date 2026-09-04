// ── AddTeamMemberModal ───────────────────────────────────────────────────────
// Modal shell around the shared assign-member cascade. All cascade logic
// (roster loading, BU→Division→Dept→Title→Role→Person, duplicate guards,
// submit + post-save hours bookkeeping) lives in useAssignMemberCascade so the
// inline add row under the weekly grid shares the exact same engine.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Search, Check, ChevronDown, UserPlus, UserCog, Loader2, BriefcaseBusiness, CalendarDays, AlertTriangle } from "lucide-react";
import {
  getBusinessRules,
  getPastWeekEditStateFor,
  useBusinessRulesVersion,
} from "@/lib/businessRules";
import { ScheduleWindowTip } from "@/components/ScheduleWindowTip";
import DateField from "@/components/DateField";
import { getDisplayModeForRecord, useProjectViewModeVersion } from "@/lib/projectViewMode";
import { BuMismatchPopup } from "@/components/BuMismatchPopup";
import {
  getTaskData,
  getResourceWeekAllocations,
  type OpenRole,
  type ResourceWeekAllocations,
  type ResourceWeekAllocRow,
} from "@/lib/api";
import {
  useAssignMemberCascade,
  type ExistingAllocationRef,
  type OptimisticAssignedMember,
} from "@/hooks/useAssignMemberCascade";
import { Z } from "@/lib/zLayers";
import { maxAssignmentHours } from "@/lib/utilGrid";
import {
  derivePlannerSchedule,
  enumeratePlannerScheduleWeeks,
  enumerateWeekMondays,
  parseScheduleDate,
  toISODate,
  type PlannerSchedule,
} from "@/lib/phaseHours";
import {
  TeamAllocationPlanner,
  type AllocationWeek,
} from "@/components/TeamAllocationPlanner";
import { ExistingWorkTimelineModal } from "@/components/ExistingWorkTimelineModal";
import {
  canDismissTeamAllocation,
  type TeamAllocationDismissPath,
} from "@/lib/teamAllocationDismiss";
import {
  findWeeklyHoursViolation,
  weeklyHoursViolationMessage,
} from "@/lib/weeklyHoursValidation";
import { fmtHours } from "@/lib/utils";

export type { ExistingAllocationRef };

const C = {
  bg: "#FFFFFF",
  bgDeep: "#FFFFFF",
  card: "#F5F8FA",
  border: "#D5DEE5",
  borderSoft: "#E8EDF2",
  green: "#6BA539",
  orange: "#E87722",
  text: "#253746",
  muted: "#6B7E8A",
  surface: "#F5F8FA",
};

function formatOpenRoleDate(value: string): string {
  const ymd = value.slice(0, 10);
  if (!ymd) return "Date not set";
  const date = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? ymd
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function AddTeamMemberModal({
  open, onClose, projectId, projectName, projectStartDate, projectEndDate,
  scheduleStart, scheduleEnd,
  existingAllocations, onAssigned,
  prefillBuShort, prefillDivisionId, prefillMemberBu, prefillRole, prefillTitle, prefillDept, prefillStartDate, prefillEndDate, prefillPct, prefillAllocationId, prefillTypeGuid, prefillGroupId,
  prefillPersonId, prefillPersonName, seedPersonId, showHoursField, personOnly, prefillHours, consumeRaIds, inferredConsumeRaIds,
  openRoles, requireOpenRoleSelection, forceDates, changeFrom, periodScope,
  onSetupSchedule, onOpenProject, displayMode, module,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  projectStartDate: string;
  projectEndDate: string;
  /** Phase-schedule window — pass ONLY when the project has a phase schedule.
   *  When set, member dates are clamped to [scheduleStart, scheduleEnd]
   *  (client rule; the backend enforces the same bound). Blank = no schedule,
   *  dates are free and the record's Target End auto-extends to cover them. */
  scheduleStart?: string;
  scheduleEnd?: string;
  existingAllocations: ExistingAllocationRef[];
  onAssigned: (personName: string, optimistic?: OptimisticAssignedMember) => void;
  prefillBuShort?: string;
  prefillDivisionId?: string;
  prefillMemberBu?: string;
  prefillRole?: string;
  prefillTitle?: string;
  prefillDept?: string;
  prefillStartDate?: string;
  prefillEndDate?: string;
  prefillPct?: number;
  prefillAllocationId?: number;
  prefillTypeGuid?: string;
  prefillGroupId?: string;
  // Open-position fill: the RA demand-row IDs this assignment consumes.
  consumeRaIds?: number[];
  /** These IDs were inferred from a Quick Actions shortcut, not selected by
   * the operator. The hook drops them whenever the assignment changes. */
  inferredConsumeRaIds?: boolean;
  prefillPersonId?: string;
  prefillPersonName?: string;
  /** ADD-mode person seed (e.g. picked from the grid toolbar search):
   *  pre-selects the person + auto-fills/locks their org, WITHOUT switching
   *  the modal into Edit Assignment mode. */
  seedPersonId?: string;
  /** Show a direct "Total Hours" input (no phase schedule grid available). */
  showHoursField?: boolean;
  /** Add a person as a team relationship only. This deliberately has no
   * role/title editing, dates, hours, planner, or weekly allocation writes. */
  personOnly?: boolean;
  /** Current total hours for the member being edited — seeds the Total Hours input. */
  prefillHours?: number;
  /** Open positions on this project — shown as one-click suggestion chips
   *  at the top of the add flow. */
  openRoles?: OpenRole[];
  /** Quick Actions sets this when duplicate role/title slots exist. The operator
   * must choose a detailed slot card before saving so no heuristic can retire
   * a different demand row. */
  requireOpenRoleSelection?: boolean;
  /** Always show the Start/End date inputs regardless of the tenant display
   *  mode — used for leads, which never have a phase schedule to follow. */
  forceDates?: boolean;
  /** CHANGE-RESOURCE mode: the outgoing member being replaced. The picked
   *  person takes over every allocation week from next Monday onward; hours
   *  already worked stay with the outgoing member. Dates/hours inputs are
   *  hidden — the server owns the cutover. */
  changeFrom?: { personId: string; name: string };
  /** PERIOD-SCOPED edit: the pencil was clicked on one period row of a
   *  multi-period assignment — dates/hours inputs describe THAT period only
   *  and Save leaves the member's other periods untouched (see the cascade
   *  hook for the save semantics). All dates YMD. */
  periodScope?: {
    periodStart: string; periodEnd: string; periodHours: number;
    assignStart?: string; assignEnd?: string; assignHours?: number;
    /** The edited period's own assignment row (RWI). When known, an hours
     *  edit replaces THAT assignment's rows wholesale (server-side), and
     *  same-RWI phantom periods no longer block the save as "overlaps". */
    rwiId?: number | null;
    /** The member's OTHER period windows — new dates may not overlap them
     *  (except same-RWI periods being merged away by a replace-all save). */
    otherPeriods?: { start: string; end: string; rwiId?: number | null }[];
  };
  /** Opens this project's Schedule editor when phase timing is required for
   * the schedule-enabled allocation workspace. */
  onSetupSchedule?: () => void;
  /** Opens a project record from the allocation workspace's current workload. */
  onOpenProject?: (projectId: string) => void;
  /** Resolved record display mode (including per-record overrides). */
  displayMode?: ReturnType<typeof getBusinessRules>["projectDisplayMode"];
  /** Record module ("PMM" / "OPM" / "LEM") — lets the modal resolve the
   *  record's display mode itself (per-record override + module-aware tenant
   *  fallback) when the host doesn't pass a pre-resolved `displayMode`. */
  module?: string | null;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // Re-render if the effective tenant display settings finish loading while
  // this workspace is open; schedule/no-schedule gating must not remain stuck
  // on the built-in default for this dialog's lifetime.
  useBusinessRulesVersion();
  // Re-resolve if a per-record display-mode override changes while open.
  useProjectViewModeVersion();
  // Record-resolved display mode: an explicit host resolution wins, otherwise
  // resolve per record (override + module-aware tenant fallback). Without a
  // module there is nothing trustworthy to resolve against: the LAYOUT keeps
  // the legacy project-mode fallback below, but the schedule-window flag must
  // then stay undefined so the SERVER's module-aware resolution governs the
  // save — a fabricated `true` (tenant PROJECT mode blindly applied to an
  // OPM/LEM record) would wrongly TIGHTEN the server gate, and a fabricated
  // `false` is ignored server-side anyway (the flag can never loosen).
  const recordResolvedMode = displayMode
    ?? (module != null && projectId ? getDisplayModeForRecord(projectId, module) : null);
  const dmMode = recordResolvedMode ?? getBusinessRules().projectDisplayMode;
  const usesDirectRangeEntry =
    dmMode === "schedule-no-grid" ||
    dmMode === "no-schedule-no-grid" ||
    !!(showHoursField && forceDates);
  // A person-only add and direct date-range allocation mode use the compact
  // form. The weekly planner remains the default whenever direct hours are not
  // enabled, so weekly-grid settings keep the existing editor unchanged.
  const isAllocationWorkspace = !prefillPersonId && !changeFrom && !periodScope
    && !personOnly && !usesDirectRangeEntry;
  const [plannedWeeklyHours, setPlannedWeeklyHours] = useState<Record<string, number>>({});
  const [workload, setWorkload] = useState<ResourceWeekAllocations | null>(null);
  const [workloadState, setWorkloadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [workloadError, setWorkloadError] = useState<string | null>(null);
  const [workloadRetry, setWorkloadRetry] = useState(0);
  const [drillWeek, setDrillWeek] = useState<string | null>(null);
  const [showExistingSummary, setShowExistingSummary] = useState(false);
  const [planReady, setPlanReady] = useState(false);
  const [plannerSchedule, setPlannerSchedule] = useState<PlannerSchedule>({
    state: "disabled", phases: [], missingDateCount: 0,
  });
  const [scheduleRetry, setScheduleRetry] = useState(0);
  const workloadSeqRef = useRef(0);
  const plannedForPersonRef = useRef("");
  const editedWeekIdsRef = useRef<Set<string>>(new Set());

  // Date inputs are shown in "no-schedule" and both "no weekly grid" display
  // modes ("no-schedule-no-grid" / "schedule-no-grid") — free-form start/end
  // dates. In "full" mode dates follow the phase schedule, and in
  // "no-schedule-no-hours" dates are meaningless to the user. In the hidden
  // cases the hook's fallbacks keep submitting the existing/seeded dates
  // unchanged — hiding the inputs never changes what gets saved. Project
  // Detail passes the record-aware mode (incl. per-record overrides); legacy
  // callers keep their project-level fallback. Only the two schedule modes
  // read the phase schedule — no-schedule variants keep their free-form
  // planner window. Change-resource always hides dates (the server owns the
  // cutover: next Monday, mirroring the outgoing member's remaining span).
  const scheduleEnabled = dmMode === "full" || dmMode === "schedule-no-grid";
  const hideDates = personOnly || changeFrom ? true : forceDates ? false
    : dmMode !== "no-schedule" && dmMode !== "no-schedule-no-grid" && dmMode !== "schedule-no-grid";

  // Live phase schedule — the authoritative window source (matches Edit
  // Allocation). Runs for EVERY schedule-enabled variant, compact included:
  // the host's scheduleStart/scheduleEnd props can be stale — e.g. the
  // schedule was created or reshaped after the record payload loaded — and
  // stale/empty props used to let member dates land outside a real schedule.
  useEffect(() => {
    let cancelled = false;
    if (!open || !scheduleEnabled) {
      setPlannerSchedule({ state: "disabled", phases: [], missingDateCount: 0 });
      return () => { cancelled = true; };
    }
    setPlannerSchedule({ state: "loading", phases: [], missingDateCount: 0 });
    void getTaskData(projectId, "0")
      .then((raw) => {
        if (cancelled) return;
        setPlannerSchedule(derivePlannerSchedule(raw));
      })
      .catch(() => {
        if (!cancelled) {
          setPlannerSchedule({ state: "error", phases: [], missingDateCount: 0 });
        }
      });
    return () => { cancelled = true; };
  }, [open, scheduleEnabled, projectId, scheduleRetry]);

  const plannerScheduleState = scheduleEnabled && plannerSchedule.state === "disabled"
    ? "loading"
    : plannerSchedule.state;
  const scheduleWindow = useMemo(() => {
    if (!scheduleEnabled || plannerScheduleState !== "ready" || plannerSchedule.phases.length === 0) {
      return { start: "", end: "" };
    }
    return {
      start: plannerSchedule.phases.reduce((earliest, phase) => phase.start < earliest ? phase.start : earliest, plannerSchedule.phases[0].start),
      end: plannerSchedule.phases.reduce((latest, phase) => phase.end > latest ? phase.end : latest, plannerSchedule.phases[0].end),
    };
  }, [scheduleEnabled, plannerScheduleState, plannerSchedule.phases]);
  // Once the live fetch SETTLES it outranks the host props: "ready" supplies
  // the real dated window, while "no-lifecycle"/"no-dates" mean there is
  // genuinely no dated schedule — stale props must not keep enforcing a
  // window that no longer exists (or claim none where one now does). While
  // loading, or after a fetch error, the props remain the best available
  // guess (fail-safe: never LOOSER than what the host knew).
  const liveScheduleKnown = scheduleEnabled &&
    (plannerScheduleState === "ready" || plannerScheduleState === "no-lifecycle" || plannerScheduleState === "no-dates");
  const effScheduleStart = liveScheduleKnown ? scheduleWindow.start : scheduleStart;
  const effScheduleEnd = liveScheduleKnown ? scheduleWindow.end : scheduleEnd;

  const cascade = useAssignMemberCascade({
    active: open, onClose, projectId, projectName, projectStartDate, projectEndDate,
    scheduleStart: effScheduleStart, scheduleEnd: effScheduleEnd,
    // Only a RECORD-resolved answer may override the server's module-aware
    // fallback; hosts without record context leave this undefined.
    scheduleWindowEnabled: recordResolvedMode != null ? scheduleEnabled : undefined,
    existingAllocations, onAssigned,
    prefillBuShort, prefillDivisionId, prefillMemberBu, prefillRole, prefillTitle, prefillDept,
    prefillStartDate, prefillEndDate, prefillPct, prefillAllocationId, prefillTypeGuid, prefillGroupId,
    prefillPersonId, prefillPersonName, seedPersonId, showHoursField, personOnly, prefillHours,
    plannedWeeklyHours: isAllocationWorkspace ? plannedWeeklyHours : undefined,
    consumeRaIds, inferredConsumeRaIds,
    openRoles, requireOpenRoleSelection, changeFrom, periodScope,
  });
  const {
    loading, submitting, error, setError,
    buEntities, businessUnit, bus, bu, deptName, filteredDepartments,
    role, title, personId, personName,
    startDate, setStartDate, endDate, setEndDate,
    lumpHours, setLumpHours,
    picker, setPicker, search, setSearch,
    showAllPeople, setShowAllPeople,
    displayPeople, filteredPeople, usingOfficialPeople, selectedPerson: selectedPersonInfo,
    relatedPeopleCount, peopleCount,
    dupeOnSubmit, canSubmit,
    hasScheduleWindow, schedStartYmd, schedEndYmd, schedWindowLabel,
    suggestions, pickedSuggestion, applySuggestion, openRoleSelectionRequired,
    orgLocked, unlockOrg, availLoading,
    buMismatch, addingBu, buMismatchError, addBuToProject, dismissBuMismatch, projectBuLabels,
    submit, pickerData, pickerTitle, applyPick, assignmentSaved,
  } = cascade;
  const [directAllocationMode, setDirectAllocationMode] = useState<"hours" | "percentage">("hours");
  const [directPercent, setDirectPercent] = useState("");
  const dismissState = { isAllocationWorkspace, submitting, assignmentSaved };
  const dismissLocked = !canDismissTeamAllocation(dismissState, "cancel");
  const requestDismiss = (
    path: TeamAllocationDismissPath,
    action: () => void = onClose,
  ) => {
    if (canDismissTeamAllocation(dismissState, path)) action();
  };

  useEffect(() => {
    if (!open) return;
    setPlannedWeeklyHours({});
    setWorkload(null);
    setWorkloadState("idle");
    setWorkloadError(null);
    setWorkloadRetry(0);
    setDrillWeek(null);
    setShowExistingSummary(false);
    setPlanReady(false);
    setScheduleRetry(0);
    setDirectAllocationMode("hours");
    setDirectPercent("");
    plannedForPersonRef.current = "";
    editedWeekIdsRef.current.clear();
  }, [open, projectId]);

  // Focus the close button when opening
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  // Lock body scroll + Esc handler while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (picker) { setPicker(null); setSearch(""); }
      else requestDismiss("escape");
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, picker, onClose, setPicker, setSearch, isAllocationWorkspace, submitting, assignmentSaved]);

  // When dates are hidden but a schedule window exists, clamp any seeded date
  // that drifted OUTSIDE the window (e.g. the schedule was shortened after a
  // member was assigned). Without this, the submit-time window validation
  // would block role/title edits with an error about dates the user can no
  // longer see or change.
  useEffect(() => {
    if (!open || !hideDates || !hasScheduleWindow) return;
    if (schedStartYmd && startDate && startDate.slice(0, 10) < schedStartYmd) setStartDate(schedStartYmd);
    if (schedEndYmd && endDate && endDate.slice(0, 10) > schedEndYmd) setEndDate(schedEndYmd);
  }, [open, hideDates, hasScheduleWindow, schedStartYmd, schedEndYmd, startDate, endDate, setStartDate, setEndDate]);

  // Quick Actions and other lightweight callers may know only the record's
  // Target dates when this modal opens. Once the authoritative phase schedule
  // arrives, keep the hidden assignment dates inside that same window. This
  // prevents an obsolete Target End (for example, 2027-02-05) from being sent
  // after the schedule has been shortened (for example, to 2026-12-31).
  useEffect(() => {
    // HIDDEN dates only: silently keep them inside the live window so role/
    // title edits can't be blocked by dates the user cannot see. VISIBLE date
    // inputs are never rewritten behind the user's back — the out-of-window
    // warning + disabled save handle those honestly instead (product rule:
    // change the schedule first, then the member dates).
    if (!open || !hideDates || !scheduleEnabled || plannerScheduleState !== "ready") return;
    let clamped = false;
    if (scheduleWindow.start && (!startDate || startDate.slice(0, 10) < scheduleWindow.start)) {
      setStartDate(scheduleWindow.start);
      clamped = true;
    }
    if (scheduleWindow.end && (!endDate || endDate.slice(0, 10) > scheduleWindow.end)) {
      setEndDate(scheduleWindow.end);
      clamped = true;
    }
    if (clamped) setError(null);
  }, [
    open,
    hideDates,
    scheduleEnabled,
    plannerScheduleState,
    scheduleWindow.start,
    scheduleWindow.end,
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    setError,
  ]);
  // Schedule-enabled planners are intentionally phase-bounded. Do not fall
  // back to Target dates while schedule data is loading or incomplete: that
  // would show a misleading editable window the Schedule tab does not own.
  const effectiveStart = (scheduleEnabled
    ? scheduleWindow.start
    : startDate || prefillStartDate || projectStartDate || "").slice(0, 10);
  const effectiveEnd = (scheduleEnabled
    ? scheduleWindow.end
    : endDate || prefillEndDate || projectEndDate || "").slice(0, 10);
  const weekMondays = useMemo(() => {
    if (scheduleEnabled) {
      return plannerScheduleState === "ready"
        ? enumeratePlannerScheduleWeeks(plannerSchedule.phases)
        : [];
    }
    const start = parseScheduleDate(effectiveStart);
    const end = parseScheduleDate(effectiveEnd);
    if (!start || !end || start > end) return [];
    return enumerateWeekMondays(start, end);
  }, [scheduleEnabled, plannerScheduleState, plannerSchedule.phases, effectiveStart, effectiveEnd]);
  const weekSignature = weekMondays.map(toISODate).join("|");

  // A person change starts a new plan. Any hours typed for the previous person
  // must not become the new person's default.
  useEffect(() => {
    if (!open || !isAllocationWorkspace) return;
    const key = personId.trim().toLowerCase();
    if (key === plannedForPersonRef.current) return;
    plannedForPersonRef.current = key;
    editedWeekIdsRef.current.clear();
    setPlanReady(false);
    setPlannedWeeklyHours({});
  }, [open, isAllocationWorkspace, personId]);

  // Keep typed hours for weeks that remain in the selected date window, add
  // new weeks at zero, and drop weeks that moved outside the assignment span.
  // Open-slot assigns deliberately do NOT spread the position's total across
  // the weeks (owner choice, Aug 2026): a small total over a long schedule
  // produced meaningless per-week dust (0.06h) in every cell. Weeks start at
  // zero; the position's required total shows as a label instead.
  useEffect(() => {
    if (!open || !isAllocationWorkspace) return;
    const ids = weekSignature ? weekSignature.split("|") : [];
    setPlannedWeeklyHours((prev) => {
      const next = Object.fromEntries(ids.map((id) => [id, prev[id] ?? 0]));
      const same = Object.keys(prev).length === ids.length && ids.every((id) => prev[id] === next[id]);
      return same ? prev : next;
    });
  }, [open, isAllocationWorkspace, weekSignature]);

  const queryStart = weekMondays[0] ? toISODate(weekMondays[0]) : "";
  const queryEnd = useMemo(() => {
    const last = weekMondays[weekMondays.length - 1];
    if (!last) return "";
    const sunday = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 6);
    return toISODate(sunday);
  }, [weekSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  // One authoritative tenant-scoped request supplies every week total and the
  // per-week project drill-down. Sequence-gating prevents a late response for
  // the previous person/date range from overwriting the current selection.
  useEffect(() => {
    const seq = ++workloadSeqRef.current;
    setDrillWeek(null);
    if (!open || !isAllocationWorkspace || !personId || !queryStart || !queryEnd) {
      setWorkload(null);
      setWorkloadState("idle");
      setWorkloadError(null);
      return;
    }
    setWorkload(null);
    setWorkloadState("loading");
    setWorkloadError(null);
    getResourceWeekAllocations(personId, queryStart, queryEnd)
      .then((data) => {
        if (seq !== workloadSeqRef.current) return;
        setWorkload(data);
        setWorkloadState("ready");
      })
      .catch((err) => {
        if (seq !== workloadSeqRef.current) return;
        setWorkload(null);
        setWorkloadState("error");
        setWorkloadError(err instanceof Error ? err.message : "Could not load this person's workload.");
      });
  }, [open, isAllocationWorkspace, personId, queryStart, queryEnd, workloadRetry]);

  const sameTicket = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const selectedPersonAlreadyOnProject = !!personId && existingAllocations.some(
    (item) => item.personId.trim().toLowerCase() === personId.trim().toLowerCase(),
  );
  // Existing means every hour the person already has booked in the selected
  // period, including their hours on THIS project. For a new person, the green
  // row is a proposed allocation; for an existing member it becomes the direct
  // editor for those saved current-project hours.
  const existingWorkRows = useMemo(() => workload?.weeks ?? [], [workload]);
  const hasCurrentProjectPlan = useMemo(
    () => existingWorkRows.some((row) => sameTicket(row.projectId, projectId)),
    [existingWorkRows, projectId],
  );
  const capacity = workload?.fullWeekHours || getBusinessRules().workWeekHours || 40;
  const plannerWeeks: AllocationWeek[] = useMemo(
    () => weekMondays.map((date) => {
      const id = toISODate(date);
      const booked = existingWorkRows
        .filter((row) => row.weekStart === id)
        .reduce((sum, row) => sum + (Number(row.hours) || 0), 0);
      const currentProjectHours = existingWorkRows
        .filter((row) => row.weekStart === id && sameTicket(row.projectId, projectId))
        .reduce((sum, row) => sum + (Number(row.hours) || 0), 0);
      return {
        id,
        label: date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
        date: date.toLocaleDateString(undefined, { year: "numeric" }),
        capacity,
        booked: Math.round(booked * 100) / 100,
        currentProjectHours: Math.round(currentProjectHours * 100) / 100,
        planned: plannedWeeklyHours[id] ?? 0,
      };
    }),
    [weekSignature, existingWorkRows, capacity, plannedWeeklyHours], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Normal direct adds start with the selected person's available weekly
  // capacity. A manager can still overwrite any individual week, including
  // setting it to zero. This runs only after real workload data arrives.
  useEffect(() => {
    if (!open || !isAllocationWorkspace || !personId || workloadState !== "ready") return;
    setPlannedWeeklyHours((prev) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const week of plannerWeeks) {
        const fallback = Math.max(0, Math.round((week.capacity - week.booked) * 100) / 100);
        const value = editedWeekIdsRef.current.has(week.id)
          ? (prev[week.id] ?? 0)
          // Selecting a current member turns the workspace into a weekly edit:
          // show their saved project hours in the green row, not a fake
          // available-capacity proposal. Weeks with no saved project row begin
          // at zero so a manager may explicitly add hours to that week.
          : (selectedPersonAlreadyOnProject || hasCurrentProjectPlan)
            ? week.currentProjectHours
            : fallback;
        next[week.id] = value;
        if (prev[week.id] !== value) changed = true;
      }
      return changed || Object.keys(prev).length !== plannerWeeks.length ? next : prev;
    });
    setPlanReady(true);
  }, [open, isAllocationWorkspace, personId, workloadState, plannerWeeks, selectedPersonAlreadyOnProject, hasCurrentProjectPlan]);
  // The role picker intentionally allows an override after a person is chosen.
  // That override can filter the person out of the role-matched picker list,
  // so retain their roster details for the planner header as well.
  const selectedPerson = displayPeople.find((person) => person.id === personId) ?? selectedPersonInfo;
  const projectDatesLabel = effectiveStart && effectiveEnd
    ? `${cascade.fmtNice(effectiveStart)} – ${cascade.fmtNice(effectiveEnd)}`
    : "Project dates unavailable";
  const directStart = (startDate || prefillStartDate || projectStartDate || "").slice(0, 10);
  const directEnd = (endDate || prefillEndDate || projectEndDate || "").slice(0, 10);
  // Out-of-window check for the VISIBLE date fields — same fallback chain the
  // save path uses, so the warning always matches what a save would send.
  const windowStartBefore = !personOnly && !hideDates && hasScheduleWindow &&
    !!(schedStartYmd && directStart && directStart < schedStartYmd);
  const windowEndAfter = !personOnly && !hideDates && hasScheduleWindow &&
    !!(schedEndYmd && directEnd && directEnd > schedEndYmd);
  const dateWindowIssue = windowStartBefore || windowEndAfter;
  // Blocks the compact Add/Save button while dates sit outside the schedule.
  const compactSubmitOk = canSubmit && !dateWindowIssue;
  const directWeekCount = useMemo(() => {
    const start = parseScheduleDate(directStart);
    const end = parseScheduleDate(directEnd);
    if (!start || !end || start > end) return 0;
    return enumerateWeekMondays(start, end).length;
  }, [directStart, directEnd]);
  const directWeeklyCapacity = getBusinessRules().workWeekHours || 40;
  const directRangeCapacity = directWeekCount * directWeeklyCapacity;
  const enteredDirectHours = Number(lumpHours);
  const directAllocationPercent = directRangeCapacity > 0 && Number.isFinite(enteredDirectHours)
    ? (Math.max(0, enteredDirectHours) / directRangeCapacity) * 100
    : null;
  const formatDirectNumber = (value: number) => {
    if (!Number.isFinite(value)) return "";
    return String(Math.round((value + Number.EPSILON) * 100) / 100);
  };
  const selectDirectAllocationMode = (mode: "hours" | "percentage") => {
    setDirectAllocationMode(mode);
    if (mode === "percentage") {
      setDirectPercent(directAllocationPercent == null ? "" : formatDirectNumber(directAllocationPercent));
    }
  };
  // Percentage means the average weekly allocation across this date range.
  // Convert it to the raw total hours expected by the existing save contract.
  useEffect(() => {
    if (!showHoursField || directAllocationMode !== "percentage") return;
    if (!directPercent.trim()) {
      if (lumpHours !== "") setLumpHours("");
      return;
    }
    const percent = Number(directPercent);
    if (!Number.isFinite(percent) || directRangeCapacity <= 0) return;
    const nextHours = formatDirectNumber((Math.max(0, percent) / 100) * directRangeCapacity);
    if (nextHours !== lumpHours) setLumpHours(nextHours);
  }, [showHoursField, directAllocationMode, directPercent, directRangeCapacity, lumpHours, setLumpHours]);
  const businessUnitLabel = buEntities.find((item) => item.id === businessUnit)?.label || "—";
  const divisionLabel = bus.find((item) => item.id === bu)?.label || "—";
  const existingTeamCount = new Set(existingAllocations.map((item) => item.personId).filter(Boolean)).size;
  const isEditingExistingPlan = selectedPersonAlreadyOnProject || hasCurrentProjectPlan;
  // The drill matches the EXISTING cells: other-project work only. This
  // project's saved hours already live in the green editable row, so listing
  // them here again would double-present the same hours.
  const drillRows = drillWeek
    ? existingWorkRows
        .filter((row) => row.weekStart === drillWeek && !sameTicket(row.projectId, projectId))
        .sort((a, b) => b.hours - a.hours)
    : [];
  const weeklyHoursViolation = findWeeklyHoursViolation(
    plannerWeeks.map((week) => [week.id, week.planned] as const),
  );
  const weeklyHoursError = weeklyHoursViolation
    ? weeklyHoursViolationMessage(weeklyHoursViolation)
    : null;
  const plannerCanSubmit =
    canSubmit &&
    workloadState === "ready" &&
    planReady &&
    plannerWeeks.length > 0 &&
    !weeklyHoursViolation;

  if (!open) return null;

  return (
    <div onClick={() => requestDismiss("backdrop")} style={{
      position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.78)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: Z.MODAL_CHILD, padding: 20,
    }}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-member-title"
        style={{
          backgroundColor: isAllocationWorkspace ? "var(--rm-bg)" : C.bgDeep, color: C.text,
          borderRadius: 16,
          width: isAllocationWorkspace ? "min(1460px, 98vw)" : "min(560px, 100%)",
           maxHeight: "94vh",
          display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
        }}>
        {!isAllocationWorkspace ? (
        <div style={{
          display: "flex", alignItems: "center", padding: 16,
          borderBottom: `1px solid ${C.border}`, gap: 10,
        }}>
          {changeFrom ? <UserCog size={18} color={C.orange} /> : <UserPlus size={18} color={C.green} />}
          <div id="add-member-title" style={{ flex: 1, fontWeight: 700, fontSize: 16 }}>
            {changeFrom ? "Change Resource" : prefillPersonId ? (periodScope ? "Edit Assignment Period" : "Edit Assignment") : personOnly ? "Add Person" : "Add Team Member"}
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close add member"
            style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4, color: C.muted }}>
            <X size={20} />
          </button>
        </div>
        ) : null}

        {loading && !isAllocationWorkspace ? (
          <div style={{ padding: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <Loader2 size={24} color={C.green} className="animate-spin" />
            <div style={{ color: C.muted, fontSize: 12 }}>Loading roles & roster…</div>
          </div>
        ) : isAllocationWorkspace ? (
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <TeamAllocationPlanner
              projectName={projectName}
              projectNumber={projectId}
              roleName={loading ? "Loading roles…" : role || "Select a role"}
              onRoleClick={dismissLocked ? undefined : () => setPicker("role")}
              personName={loading ? "Loading roster…" : personName || "Select assigned person"}
              personSubtitle={selectedPerson
                ? [selectedPerson.role || selectedPerson.title, selectedPerson.email || selectedPerson.username].filter(Boolean).join(" · ")
                : loading ? "Preparing available staff" : role ? "Matched to the selected role and organization" : "Select a person first to auto-fill their role"}
              onPersonClick={dismissLocked ? undefined : () => setPicker("person")}
              isLoadingRoster={loading}
              showExistingColumn={!!role || !!personId}
              hasSelectedPerson={!!personId}
               isEditingExistingPlan={isEditingExistingPlan}
              openSlotHoursTotal={Number(prefillPct) > 0 ? Number(prefillPct) : undefined}
              contextData={{
                bu: getBusinessRules().showBusinessUnit ? businessUnitLabel : "Hidden by settings",
                division: getBusinessRules().showDivision ? divisionLabel : "Hidden by settings",
                department: getBusinessRules().showDepartment ? (deptName || "—") : "Hidden by settings",
              }}
              projectDates={projectDatesLabel}
              editableDates={!hideDates ? {
                start: startDate,
                end: endDate,
                min: hasScheduleWindow ? (schedStartYmd || undefined) : undefined,
                max: hasScheduleWindow ? (schedEndYmd || undefined) : undefined,
                onStartChange: setStartDate,
                onEndChange: setEndDate,
              } : undefined}
              existingTeamCount={existingTeamCount}
              weeks={plannerWeeks}
              onPlannedHoursChange={(index, hours) => {
                const week = plannerWeeks[index];
                if (!week) return;
                const pastEditState = getPastWeekEditStateFor(week.id, projectId);
                if (pastEditState.locked) {
                  setError(pastEditState.reason);
                  return;
                }
                 // Any prior local/server validation message describes the old
                 // draft. Clear it while the corrected plan is re-evaluated.
                 setError(null);
                editedWeekIdsRef.current.add(week.id);
                setPlannedWeeklyHours((prev) => ({
                  ...prev,
                   [week.id]: hours,
                }));
              }}
              onExistingWorkClick={!dismissLocked && personId && workloadState === "ready"
                ? (week) => setDrillWeek(week.id)
                : undefined}
              onExistingSummaryClick={!dismissLocked && personId && workloadState === "ready"
                ? () => setShowExistingSummary(true)
                : undefined}
              isLoadingWorkload={workloadState === "loading"}
              workloadError={workloadState === "error" ? workloadError || true : null}
              workloadReady={workloadState === "ready"}
              onRetryWorkload={() => setWorkloadRetry((value) => value + 1)}
              onCancel={() => requestDismiss("cancel")}
              onSubmit={submit}
              isSubmitting={submitting}
              canSubmit={plannerCanSubmit}
              selectionLocked={dismissLocked}
              cancelDisabled={dismissLocked}
              onClose={() => requestDismiss("cancel")}
              closeDisabled={dismissLocked}
              closeButtonRef={closeRef}
               scheduleState={plannerScheduleState}
               schedulePhases={plannerSchedule.phases}
               scheduleMissingDateCount={plannerSchedule.missingDateCount}
               onRetrySchedule={() => setScheduleRetry((value) => value + 1)}
               onSetupSchedule={onSetupSchedule ? () => requestDismiss("cancel", () => {
                 onClose();
                 onSetupSchedule();
               }) : undefined}
               onOpenProject={onOpenProject ? () => requestDismiss("cancel", () => onOpenProject(projectId)) : undefined}
                errorMessage={weeklyHoursError || error || (dupeOnSubmit
                  ? `${personName || "This person"} is already assigned to this project. Refresh the team, select them again here, and edit their saved weekly hours in this workspace.`
                : null)}
            />
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16, paddingBottom: 20 }}>
            <div style={{ color: C.muted, fontSize: 11, marginBottom: 6 }}>
              {personOnly ? "Lead" : "Project"}: {projectName}
            </div>
            {changeFrom ? (
              <div style={{
                marginBottom: 14, padding: "10px 12px", borderRadius: 8,
                backgroundColor: C.orange + "12", border: `1px solid ${C.orange}40`,
                fontSize: 11.5, color: C.text, lineHeight: 1.5,
              }}>
                Replacing <strong>{changeFrom.name}</strong>. Hours already worked
                (up to and including this week) stay with {changeFrom.name.split(" ")[0]} —
                everything from <strong>next Monday</strong> onward moves to the person
                you pick. This change is recorded in the audit log with your login
                and a timestamp.
              </div>
            ) : !prefillPersonId && !usesDirectRangeEntry && (
              <div style={{
                marginBottom: 14, padding: "8px 10px", borderRadius: 8,
                backgroundColor: C.green + "12", border: `1px solid ${C.green}30`,
                fontSize: 11, color: C.text, lineHeight: 1.4,
              }}>
                {personOnly
                  ? "This adds the person to the lead team only. No hours, dates, or schedule will be created."
                  : showHoursField
                  ? "Set the member's start and end dates, then enter either total hours or an allocation percentage."
                  : "After adding, you'll be prompted to enter weekly hours per phase."}
              </div>
            )}

            {personOnly ? (
              <>
                <div style={{
                  marginBottom: 14, padding: "8px 10px", borderRadius: 8,
                  backgroundColor: C.green + "12", border: `1px solid ${C.green}30`,
                  fontSize: 11.5, color: C.text, lineHeight: 1.45,
                }}>
                  Add {personName || "this person"} to this lead's team. Their staff profile remains unchanged.
                </div>
                <Field label="Person *" value={personName} onPress={() => setPicker("person")} />
              </>
            ) : prefillPersonId ? (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: C.text, marginBottom: 6, fontWeight: 700, letterSpacing: 0.2 }}>
                  Team Member
                </div>
                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "12px 14px", borderRadius: 10,
                  border: `1.5px solid ${C.green}`, backgroundColor: C.green + "10",
                  boxShadow: `inset 3px 0 0 ${C.green}`,
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                    backgroundColor: C.green + "30",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700, color: C.green,
                  }}>
                    {(prefillPersonName || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: C.text }}>
                    {prefillPersonName}
                  </div>
                </div>
              </div>
            ) : null}

            {prefillPersonId ? (
              /* ── Edit mode: keep the compact org-first form ── */
              <>
                {buEntities.length > 0 && getBusinessRules().showBusinessUnit && (
                  <Field label="Business Unit" value={buEntities.find((b) => b.id === businessUnit)?.label || ""}
                    onPress={() => setPicker("businessUnit")} />
                )}
                {getBusinessRules().showDivision && getBusinessRules().showDepartment && filteredDepartments.length > 0 ? (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 12,
                  }}>
                    <Field label="Division *" value={bus.find((b) => b.id === bu)?.label || ""}
                      onPress={() => setPicker("bu")} />
                    <Field label="Department" value={deptName}
                      onPress={() => (bu || !getBusinessRules().showDivision) ? setPicker("department") : setError("Pick a Division first.")} />
                  </div>
                ) : (
                  <>
                    {getBusinessRules().showDivision && (
                      <Field label="Division *" value={bus.find((b) => b.id === bu)?.label || ""}
                        onPress={() => setPicker("bu")} />
                    )}
                    {filteredDepartments.length > 0 && getBusinessRules().showDepartment && (
                      <Field label="Department" value={deptName}
                        onPress={() => (bu || !getBusinessRules().showDivision) ? setPicker("department") : setError("Pick a Division first.")} />
                    )}
                  </>
                )}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 12,
                }}>
                  <Field label="Title" value={title}
                    onPress={() => (bu || !getBusinessRules().showDivision) ? setPicker("title") : setError("Pick a Division first.")} />
                  <Field label="Role *" value={role}
                    onPress={() => title ? setPicker("role") : setError("Pick a Title before choosing the Role.")} />
                </div>
              </>
            ) : (
              /* ── Add mode: role-first. Open-position chips → Role → Title →
                 Person; the org section auto-fills + locks from the person's
                 staff profile once someone is picked. ── */
              <>
                {!usesDirectRangeEntry && <div style={{
                  marginBottom: 14, padding: "8px 10px", borderRadius: 8,
                  backgroundColor: "rgba(192,57,43,0.08)",
                  border: "1px solid rgba(192,57,43,0.35)",
                  fontSize: 11.5, fontWeight: 700, color: "#C0392B", lineHeight: 1.45,
                }}>
                   Please select Role and Person — Title, Business Unit, Division
                   and Department will be filled in automatically.
                </div>}
                {!changeFrom && suggestions.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: "grid", gap: 5 }}>
                      {suggestions.map((s, i) => {
                        const sel = i === pickedSuggestion;
                        const main = s.role || s.title;
                        const extra = s.title && s.role && s.title.toLowerCase() !== s.role.toLowerCase() ? s.title : "";
                        const dates = s.startDate || s.endDate
                          ? `${formatOpenRoleDate(s.startDate)} – ${formatOpenRoleDate(s.endDate)}`
                          : "Dates not set";
                        const hours = s.eacHrs > 0
                          ? `${fmtHours(s.eacHrs)} planned hours`
                          : s.pct > 0
                            ? `${s.pct}% planned capacity`
                            : "Hours not set";
                        const org = s.bu ? `Organization: ${s.bu}` : `Project: ${projectName}`;
                        return (
                          <button key={`${main}-${i}`} type="button" onClick={() => applySuggestion(i)} data-testid={`open-role-choice-${i}`} style={{
                            width: "100%", minWidth: 0, padding: "7px 10px", borderRadius: 8, fontSize: 11.5, textAlign: "left",
                            display: "block", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
                            cursor: "pointer",
                            border: `1px solid ${sel ? C.green : C.border}`,
                            backgroundColor: sel ? C.green + "18" : "#FFFFFF",
                            color: sel ? C.green : C.text,
                          }}
                          title={`${main}${extra ? ` · ${extra}` : ""} · ${dates} · ${hours} · ${org}`}>
                            <span style={{ fontWeight: 700 }}>
                              {main}{extra ? ` · ${extra}` : ""}
                            </span>
                            <span style={{ color: sel ? C.green : C.muted, fontWeight: 500 }}>
                              {" · "}{dates} · {hours} · {org}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {openRoleSelectionRequired ? (
                      <div data-testid="open-role-selection-required" style={{
                        marginTop: 6, padding: "7px 10px", borderRadius: 8,
                        backgroundColor: C.orange + "12", border: `1px solid ${C.orange}55`,
                        color: C.text, fontSize: 11, fontWeight: 600, lineHeight: 1.45,
                      }}>
                        More than one identical open role is available. Choose the specific dates, hours, and organization to fill before saving.
                      </div>
                    ) : null}
                  </div>
                )}
                <Field label="Role *" value={role}
                  onPress={() => setPicker("role")} />
                <Field label="Assigned To *" value={personName}
                  onPress={() => setPicker("person")} />
                {personId ? (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, color: C.text, marginBottom: 6, fontWeight: 700, letterSpacing: 0.2 }}>
                      Assignment details
                    </div>
                    <div style={{
                      display: "flex", alignItems: "center",
                      padding: "10px 14px", borderRadius: 10,
                      border: `1.5px solid ${C.green}`, backgroundColor: C.green + "10",
                      boxShadow: `inset 3px 0 0 ${C.green}`,
                    }}>
                      <div style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "7px 18px" }}>
                        {([
                          ["Title", title],
                          ...(buEntities.length > 0 && getBusinessRules().showBusinessUnit
                            ? [["Business Unit", buEntities.find((b) => b.id === businessUnit)?.label || ""]]
                            : []),
                          ...(getBusinessRules().showDivision
                            ? [["Division", bus.find((b) => b.id === bu)?.label || ""]]
                            : []),
                          ...(getBusinessRules().showDepartment
                            ? [["Department", deptName]]
                            : []),
                        ] as [string, string][]).map(([lbl, val]) => (
                          <div key={lbl} style={{ minWidth: 0 }}>
                            <div style={{
                              fontSize: 9, fontWeight: 700,
                              color: C.muted, letterSpacing: 0.4, textTransform: "uppercase",
                            }}>
                              {lbl}
                            </div>
                            <div style={{
                              minWidth: 0, marginTop: 2, fontSize: 12.5, fontWeight: 600,
                              color: val ? C.text : C.muted,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {val || "—"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                      Filled automatically from {personName || "the selected person"}'s staff profile.
                    </div>
                  </div>
                ) : null}
              </>
            )}

            {!personOnly && !hideDates && (
            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              {(["Start Date", "End Date"] as const).map((lbl) => {
                const isStart = lbl === "Start Date";
                const val = isStart ? startDate : endDate;
                const setter = isStart ? setStartDate : setEndDate;
                const filled = !!val;
                return (
                  <div key={lbl} style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: C.text, marginBottom: 6, fontWeight: 700, letterSpacing: 0.2 }}>
                      {lbl}
                    </div>
                    <ScheduleWindowTip active={hasScheduleWindow} windowLabel={schedWindowLabel}>
                      <DateField
                        value={val}
                        min={hasScheduleWindow ? (schedStartYmd || undefined) : undefined}
                        max={hasScheduleWindow ? (schedEndYmd || undefined) : undefined}
                        clampTyped={false}
                        outOfRangeNotice={hasScheduleWindow
                          ? `This record's schedule runs ${schedWindowLabel}, so this date can't be picked. Please edit the schedule first, then come back.`
                          : undefined}
                        onChange={setter}
                        style={{
                          padding: "13px 14px", borderRadius: 10, fontSize: 14,
                          fontWeight: filled ? 600 : 500,
                          color: filled ? C.text : "#4A5C6A",
                          backgroundColor: "#FFFFFF",
                          border: `1.5px solid ${filled ? C.green : "#9AAAB5"}`,
                          boxShadow: filled ? `inset 3px 0 0 ${C.green}` : "none",
                        }}
                      />
                    </ScheduleWindowTip>
                  </div>
                );
              })}
            </div>
            )}
            {periodScope && (
              <div style={{ fontSize: 11, color: C.muted, marginTop: -8, marginBottom: 14 }}>
                You're editing one assignment period — the member's other periods keep their dates and hours.
              </div>
            )}
            {!personOnly && !hideDates && hasScheduleWindow && !dateWindowIssue && (
              <div style={{ fontSize: 11, color: C.muted, marginTop: -8, marginBottom: 14 }}>
                This project has a phase schedule — member dates must stay within {schedWindowLabel}.
              </div>
            )}
            {!personOnly && !hideDates && dateWindowIssue && (
              <div role="alert" style={{
                marginTop: -6, marginBottom: 14, padding: "10px 12px", borderRadius: 10,
                backgroundColor: "#FEF3C7", border: "1px solid #F59E0B",
                display: "flex", gap: 9, alignItems: "flex-start",
              }}>
                <AlertTriangle size={15} color="#B45309" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#92400E" }}>
                    {windowStartBefore && windowEndAfter
                      ? "Both dates fall outside the schedule"
                      : windowStartBefore
                        ? "Start date is before the schedule starts"
                        : "End date is after the schedule ends"}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#92400E", marginTop: 3, lineHeight: 1.5 }}>
                    This record's schedule runs {schedWindowLabel}, so member dates must stay
                    inside it. Need this allocation anyway? Change the schedule first, then
                    come back and add the member.
                  </div>
                  {onSetupSchedule ? (
                    <button
                      type="button"
                      onClick={() => requestDismiss("cancel", () => { onClose(); onSetupSchedule(); })}
                      style={{
                        marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6,
                        border: "1px solid #F59E0B", background: "#FFF", color: "#92400E",
                        borderRadius: 8, padding: "6px 11px", fontSize: 11.5, fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      <CalendarDays size={13} />
                      Open the schedule to change it
                    </button>
                  ) : null}
                </div>
              </div>
            )}
            {!personOnly && hideDates && hasScheduleWindow && (
              <div style={{ fontSize: 11, color: C.muted, marginTop: -4, marginBottom: 14 }}>
                Member dates follow the project's phase schedule ({schedWindowLabel}).
              </div>
            )}

            {!personOnly && showHoursField && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: C.text, marginBottom: 6, fontWeight: 700, letterSpacing: 0.2 }}>
                  {periodScope ? "Allocation — This Period" : "Allocation for this date range"}
                </div>
                <div style={{
                  display: "inline-flex", padding: 3, gap: 3, marginBottom: 8,
                  borderRadius: 9, backgroundColor: C.surface, border: `1px solid ${C.border}`,
                }}>
                  {([
                    ["hours", "Enter hours"],
                    ["percentage", "Enter %"],
                  ] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={directAllocationMode === mode}
                      onClick={() => selectDirectAllocationMode(mode)}
                      style={{
                        border: "none", borderRadius: 7, padding: "6px 10px",
                        backgroundColor: directAllocationMode === mode ? C.green : "transparent",
                        color: directAllocationMode === mode ? "#FFF" : C.muted,
                        fontSize: 11, fontWeight: 700, cursor: "pointer",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  min="0"
                  placeholder={directAllocationMode === "hours" ? "Total hours" : "Allocation %"}
                  value={directAllocationMode === "hours" ? lumpHours : directPercent}
                  onChange={(e) => {
                    const next = e.target.value.trim();
                    const valid = directAllocationMode === "hours"
                      ? /^\d{0,7}(?:\.\d{0,2})?$/.test(next)
                      : /^\d{0,3}(?:\.\d{0,2})?$/.test(next);
                    if (!valid) return;
                    if (directAllocationMode === "hours") setLumpHours(next);
                    else setDirectPercent(next);
                  }}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "13px 14px", borderRadius: 10, fontSize: 14,
                    fontWeight: (directAllocationMode === "hours" ? lumpHours : directPercent) !== "" ? 600 : 500,
                    color: C.text,
                    backgroundColor: "#FFFFFF",
                    border: `1.5px solid ${(directAllocationMode === "hours" ? lumpHours : directPercent) !== "" ? C.green : "#9AAAB5"}`,
                    boxShadow: (directAllocationMode === "hours" ? lumpHours : directPercent) !== "" ? `inset 3px 0 0 ${C.green}` : "none",
                    outline: "none",
                  }}
                />
                {(() => {
                  // Live physical-ceiling check: total hours can never exceed
                  // 24h × span days (mirrors the server gate).
                  const hrs = Number(lumpHours) || 0;
                  const { cap, days } = maxAssignmentHours(directStart, directEnd);
                  if (lumpHours !== "" && hrs > cap) return (
                    <div style={{ fontSize: 11, color: "#D97706", marginTop: 4, fontWeight: 600 }}>
                      That's more than {cap}h — the most these dates can hold (24 hours × {days} day{days === 1 ? "" : "s"}).
                    </div>
                  );
                  const totalLabel = lumpHours === "" ? "—" : `${formatDirectNumber(Math.max(0, hrs))}h`;
                  const percentLabel = directAllocationPercent == null ? "—" : `${formatDirectNumber(directAllocationPercent)}%`;
                  return (
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.45 }}>
                      {periodScope
                        ? "This period only — the member's other periods keep their own hours."
                        : directWeekCount > 0
                          ? `${totalLabel} total · ${percentLabel} average allocation across ${directWeekCount} week${directWeekCount === 1 ? "" : "s"} (${directWeeklyCapacity}h/week capacity).`
                          : "Select a valid date range to calculate the total hours and percentage."}
                    </div>
                  );
                })()}
              </div>
            )}

            {dupeOnSubmit ? (
              <div style={{
                marginTop: 6, padding: 10, borderRadius: 8,
                backgroundColor: C.orange + "20", border: `1px solid ${C.orange}60`,
              }}>
                <div style={{ color: C.orange, fontSize: 11, fontWeight: 600 }}>
                  {personOnly
                    ? "This person is already on this lead team."
                    : "This person is already on the team with the same Division, Role, and Title. Pick a different role or title to add another assignment."}
                </div>
              </div>
            ) : null}

            {error ? (
              <div style={{
                marginTop: 10, padding: 10, borderRadius: 8,
                backgroundColor: "#F8717120", border: `1px solid #F8717160`,
              }}>
                <div style={{ color: "#F87171", fontSize: 11, fontWeight: 600 }}>{error}</div>
              </div>
            ) : null}

            <button
              disabled={!compactSubmitOk && !submitting}
              onClick={submit}
              style={{
                marginTop: 20, width: "100%",
                backgroundColor: (compactSubmitOk || submitting) ? C.green : C.border,
                color: (compactSubmitOk || submitting) ? "#FFF" : C.muted,
                border: "none", borderRadius: 10,
                padding: "13px 14px", fontSize: 14, fontWeight: 700,
                cursor: submitting ? "wait" : compactSubmitOk ? "pointer" : "not-allowed",
                opacity: submitting ? 0.85 : 1,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              {submitting
                ? (changeFrom ? "Changing…" : prefillPersonId ? "Saving…" : "Adding…")
                : (changeFrom ? "Change Resource" : prefillPersonId ? "Save Changes" : personOnly ? "Add Person" : "Add to Team")}
            </button>
            {!canSubmit && !submitting && !assignmentSaved && !personOnly && !role && (
              <div style={{
                marginTop: 8, color: C.orange, fontSize: 11, fontWeight: 600,
                textAlign: "center",
              }}>
                Select a Role to enable Save Changes.
              </div>
            )}
          </div>
        )}

        {/* BU-mismatch popup — picked person's home BU is not on the project */}
        {!personOnly && buMismatch ? (
          <BuMismatchPopup
            personName={buMismatch.personName}
            buLabel={buMismatch.divisionLabel}
            projectBuLabels={projectBuLabels}
            adding={addingBu}
            error={buMismatchError}
            onAdd={addBuToProject}
            onCancel={dismissBuMismatch}
          />
        ) : null}

        {/* Picker overlay */}
        {picker ? (
          <div onClick={() => { setPicker(null); setSearch(""); }} style={{
            position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.8)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: Z.MODAL_CHILD_2, padding: 16,
          }}>
            <div onClick={(e) => e.stopPropagation()} style={{
              backgroundColor: C.bgDeep, borderRadius: 14, maxHeight: "75vh",
              width: "min(440px, 100%)", border: `1px solid ${C.border}`,
              display: "flex", flexDirection: "column", overflow: "hidden",
            }}>
              <div style={{
                display: "flex", alignItems: "center", padding: 14,
                borderBottom: `1px solid ${C.border}`,
              }}>
                <div style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{pickerTitle()}</div>
                <button onClick={() => { setPicker(null); setSearch(""); }} aria-label="Close picker"
                  style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4, color: C.muted }}>
                  <X size={18} />
                </button>
              </div>
              {(picker === "person" || pickerData().length > 8) && (
                <div style={{
                  display: "flex", alignItems: "center", margin: 12, marginBottom: 0,
                  padding: "0 10px", backgroundColor: C.surface,
                  borderRadius: 8, border: `1px solid ${C.borderSoft}`,
                }}>
                  <Search size={14} color={C.muted} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search…"
                    autoFocus
                    style={{
                      flex: 1, padding: 10, fontSize: 12, color: C.text,
                      backgroundColor: "transparent", border: "none", outline: "none",
                    }}
                  />
                </div>
              )}
              {picker === "person" && availLoading && (
                <div style={{ margin: "8px 12px 0", fontSize: 11, color: C.muted }}>
                  Checking availability…
                </div>
              )}
              {picker === "person" && usingOfficialPeople && (
                <div style={{
                  display: "flex", alignItems: "center",
                  margin: "8px 12px 0", padding: "6px 10px",
                  backgroundColor: C.green + "10",
                  borderRadius: 6, fontSize: 11, color: C.muted,
                }}>
                  <span>{displayPeople.length} matched to "{title || role}"</span>
                </div>
              )}
              {picker === "person" && !usingOfficialPeople && (role || title) && (
                relatedPeopleCount === 0 && !showAllPeople ? (
                  /* Nothing matches the chosen Role/Title: say so explicitly
                     instead of silently flipping to the full staff list. */
                  <div style={{
                    margin: "8px 12px 0", padding: "8px 10px",
                    backgroundColor: C.orange + "15", border: `1px solid ${C.orange}50`,
                    borderRadius: 6, fontSize: 11, color: C.text,
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>
                      No one in your staff list matches "{role || title}".
                    </div>
                    <button
                      onClick={() => setShowAllPeople(true)}
                      style={{
                        background: "transparent", border: `1px solid ${C.borderSoft}`,
                        borderRadius: 6, padding: "3px 10px", cursor: "pointer",
                        fontSize: 11, fontWeight: 600, color: C.green,
                      }}
                    >Show all {peopleCount} people</button>
                  </div>
                ) : (
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    margin: "8px 12px 0", padding: "6px 10px",
                    backgroundColor: showAllPeople ? "transparent" : C.green + "10",
                    borderRadius: 6, fontSize: 11, color: C.muted,
                  }}>
                    <span>
                      {showAllPeople
                        ? `Showing all ${filteredPeople.length} people`
                        : `${filteredPeople.length} matching "${role || title}"`}
                    </span>
                    <button
                      onClick={() => setShowAllPeople(!showAllPeople)}
                      style={{
                        background: "transparent", border: `1px solid ${C.borderSoft}`,
                        borderRadius: 6, padding: "3px 10px", cursor: "pointer",
                        fontSize: 11, fontWeight: 600, color: C.green,
                      }}
                    >{showAllPeople ? "Show Related" : "Show All"}</button>
                  </div>
                )
              )}
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                {pickerData()
                  .filter((d) => {
                    if (!search) return true;
                    const q = search.toLowerCase();
                    return d.label.toLowerCase().includes(q) || (d.sub && d.sub.toLowerCase().includes(q));
                  })
                  .map((item) => (
                    <button
                      key={item.id}
                      onClick={() => applyPick(item.id, item.label)}
                      style={{
                        width: "100%", textAlign: "left",
                        padding: 14, borderBottom: `1px solid ${C.borderSoft}`,
                        backgroundColor: "transparent", border: "none",
                        borderTop: "none", borderLeft: "none", borderRight: "none",
                        cursor: "pointer", color: C.text,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = C.green + "20")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ flex: 1, color: C.text, fontWeight: 600, fontSize: 13 }}>
                          {item.label}
                        </div>
                        {item.availLabel ? (() => {
                          const toneColor = item.availTone === "free" ? C.green : item.availTone === "tight" ? C.orange : "#C2410C";
                          return (
                            <div style={{
                              color: toneColor, fontSize: 10, fontWeight: 600,
                              backgroundColor: toneColor + "18", padding: "3px 8px",
                              borderRadius: 6, whiteSpace: "nowrap",
                            }}>{item.availLabel}</div>
                          );
                        })() : null}
                        {item.alreadyOnTeam ? (
                          <div style={{
                            color: "#E85D4A", fontSize: 10, fontWeight: 600,
                            backgroundColor: "#E85D4A22", padding: "3px 8px", borderRadius: 6,
                          }}>{item.teamHours ? `On team · ${Math.round(item.teamHours)}h` : "Already on team"}</div>
                        ) : null}
                      </div>
                      {item.sub ? (
                        <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{item.sub}</div>
                      ) : null}
                      {item.workloadLabel ? (
                        <div style={{ color: C.muted, fontSize: 10, fontWeight: 600, marginTop: 3 }}>
                          {item.workloadLabel}
                        </div>
                      ) : null}
                    </button>
                  ))}
                {pickerData().filter((d) => { if (!search) return true; const q2 = search.toLowerCase(); return d.label.toLowerCase().includes(q2) || (d.sub && d.sub.toLowerCase().includes(q2)); }).length === 0 && (
                  <div style={{ padding: 24, textAlign: "center", color: C.muted, fontSize: 12 }}>No options</div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {drillWeek ? (
          <ExistingWorkPopup
            week={drillWeek}
            personName={personName}
            rows={drillRows}
            onClose={() => setDrillWeek(null)}
          />
        ) : null}
        {showExistingSummary ? (
          <ExistingWorkTimelineModal
            personName={personName}
            personId={personId}
            personRole={role}
            workload={workload}
            weekStarts={plannerWeeks.map((week) => week.id)}
            canEdit={!dismissLocked}
            onClose={() => setShowExistingSummary(false)}
            onOpenProject={onOpenProject ? (selectedProjectId) => {
              setShowExistingSummary(false);
              requestDismiss("cancel", () => onOpenProject(selectedProjectId));
            } : undefined}
            onSaved={() => setWorkloadRetry((value) => value + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, value, onPress, disabled }: {
  label: string; value: string; onPress: () => void; disabled?: boolean;
}) {
  // Labels are always dark so the form is readable before any field is
  // filled. Filled fields additionally get a green border + accent stripe
  // so the selected Role / Title stand out.
  const filled = !!value;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontSize: 12,
        color: C.text,
        marginBottom: 6, fontWeight: 700, letterSpacing: 0.2,
      }}>{label}</div>
      <button
        onClick={onPress}
        disabled={disabled}
        style={{
          display: "flex", alignItems: "center", width: "100%",
          padding: 14, backgroundColor: "#FFFFFF",
          borderRadius: 10,
          border: `1.5px solid ${disabled ? C.borderSoft : (filled ? C.green : "#9AAAB5")}`,
          boxShadow: filled ? `inset 3px 0 0 ${C.green}` : "none",
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
          color: C.text,
        }}
      >
        <div style={{
          flex: 1, fontSize: 14,
          fontWeight: filled ? 600 : 500,
          color: filled ? C.text : "#4A5C6A", textAlign: "left",
        }}>
          {value || "Tap to select"}
        </div>
        <ChevronDown size={16} color={filled ? C.green : C.text} />
      </button>
    </div>
  );
}

function ExistingWorkPopup({
  week,
  personName,
  rows,
  onClose,
}: {
  week?: string;
  personName: string;
  rows: ResourceWeekAllocRow[];
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const isSummary = !week;
  const weekDate = week ? parseScheduleDate(week) : null;
  const weekLabel = weekDate
    ? weekDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : week;
  const total = Math.round(rows.reduce((sum, row) => sum + row.hours, 0) * 100) / 100;

  useEffect(() => {
    if (typeof document === "undefined") return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        closeButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: Z.TOP_POPOVER,
        background: "rgba(15,25,35,0.68)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="existing-work-title"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(560px, 100%)",
          maxHeight: "78vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          borderRadius: 16,
          border: "1px solid var(--rm-panel-border)",
          background: "var(--rm-panel)",
          color: "var(--rm-text)",
          boxShadow: "0 26px 80px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 18px",
          borderBottom: "1px solid var(--rm-panel-border)",
        }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "var(--rm-panel-soft)",
            display: "grid",
            placeItems: "center",
            color: "var(--rm-brand-navy)",
          }}>
            <BriefcaseBusiness size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="existing-work-title" style={{ fontSize: 15, fontWeight: 800 }}>
               {isSummary ? "Existing workload" : "Existing work"}
            </div>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              marginTop: 3,
              color: "var(--rm-text-muted)",
              fontSize: 11,
            }}>
              <CalendarDays size={12} />
               {isSummary ? `${personName} · project totals, highest assigned hours first` : `${personName} · week of ${weekLabel}`}
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close existing work details"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--rm-text-muted)",
              padding: 5,
              cursor: "pointer",
            }}
          >
            <X size={19} />
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: 14 }}>
          {rows.length === 0 ? (
            <div style={{
              padding: "34px 18px",
              textAlign: "center",
              color: "var(--rm-text-muted)",
              fontSize: 12,
            }}>
               {isSummary ? "No existing hours are booked for this date range." : "No existing hours are booked for this week."}
            </div>
          ) : rows.map((row) => (
            <div
              key={`${row.projectId}-${row.weekStart}`}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: 14,
                alignItems: "center",
                padding: "12px 10px",
                borderBottom: "1px solid var(--rm-panel-border)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 12.5,
                  fontWeight: 750,
                }}>
                  {row.projectName || row.projectId}
                </div>
                <div style={{ marginTop: 3, color: "var(--rm-text-muted)", fontSize: 10.5 }}>
                  {row.projectId}
                  {row.isLocked ? " · Locked" : ""}
                  {row.isSoftAllocation ? " · Soft allocation" : ""}
                  {row.isNonChargeable ? " · Non-chargeable" : ""}
                </div>
              </div>
              <div style={{
                borderRadius: 8,
                background: "var(--rm-panel-soft)",
                padding: "7px 10px",
                fontSize: 13,
                fontWeight: 850,
                fontVariantNumeric: "tabular-nums",
              }}>
                {fmtHours(row.hours)}h
              </div>
            </div>
          ))}
        </div>

        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 18px",
          borderTop: "1px solid var(--rm-panel-border)",
          background: "var(--rm-panel-soft)",
          fontSize: 12,
          fontWeight: 800,
        }}>
          <span>Total existing work</span>
          <span>{fmtHours(total)}h</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
