import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  Layers3,
  Lock,
  Plus,
  UserRound,
  UsersRound,
  Loader2,
  RefreshCcw,
  X,
} from "lucide-react";
import {
  parseScheduleDate,
  type PlannerSchedulePhase,
  type PlannerScheduleState,
} from "@/lib/phaseHours";
import {
  getBusinessRules,
  getPastWeekEditStateFor,
  PAST_WEEK_LOCKED_REASON,
  useBusinessRulesVersion,
} from "@/lib/businessRules";
import DateField from "@/components/DateField";

function formatHours(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return rounded.toFixed(2).replace(/\.?0+$/, "");
}

export interface AllocationWeek {
  id: string;
  label: string;
  date: string;
  capacity: number;
  booked: number;
  /** Already-booked hours for this project. They stay in Existing Workload,
   * but are excluded once when checking the edited project row's capacity. */
  currentProjectHours: number;
  planned: number;
}

export interface AllocationContextData {
  bu: string;
  division: string;
  department: string;
}

export interface TeamAllocationPlannerProps {
  projectName: string;
  projectNumber: string;

  roleName: string;
  onRoleClick?: () => void;

  personName: string;
  personSubtitle?: string;
  onPersonClick?: () => void;
  isLoadingRoster?: boolean;
  /** Show the frozen Existing Workload column once a role or person exists. */
  showExistingColumn?: boolean;
  hasSelectedPerson?: boolean;
  /** The selected person already has weekly hours on this project. */
  isEditingExistingPlan?: boolean;
  /** Total hours the open position being assigned calls for. Weeks start at
   *  zero (never spread as per-week dust); this total shows as a label so the
   *  manager knows what to plan toward. */
  openSlotHoursTotal?: number;
  /** Authoritative project phase timing, loaded only in schedule-enabled modes. */
  scheduleState?: PlannerScheduleState;
  schedulePhases?: PlannerSchedulePhase[];
  scheduleMissingDateCount?: number;
  onRetrySchedule?: () => void;
  onSetupSchedule?: () => void;
  /** Leaves the allocation workspace for the current project's record page. */
  onOpenProject?: () => void;

  contextData: AllocationContextData;
  projectDates: string;
  editableDates?: {
    start: string;
    end: string;
    min?: string;
    max?: string;
    onStartChange: (value: string) => void;
    onEndChange: (value: string) => void;
  };
  existingTeamCount: number;

  weeks: AllocationWeek[];
  onPlannedHoursChange: (index: number, hours: number) => void;
  onExistingWorkClick?: (week: AllocationWeek, index: number) => void;
  onExistingSummaryClick?: () => void;

  isLoadingWorkload?: boolean;
  workloadError?: Error | string | boolean | null;
  workloadReady?: boolean;
  onRetryWorkload?: () => void;

  onCancel?: () => void;
  onSubmit?: () => void;
  isSubmitting?: boolean;
  canSubmit?: boolean;
  selectionLocked?: boolean;
  cancelDisabled?: boolean;
  onClose?: () => void;
  closeDisabled?: boolean;
  closeButtonRef?: React.Ref<HTMLButtonElement>;
  errorMessage?: string | null;
}

function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "good" | "warn" | "neutral" }) {
  const styles = {
    good: "bg-[var(--rm-panel)] border-[var(--rm-green-soft)] text-[var(--rm-green-ink)]",
    warn: "bg-[var(--rm-panel)] border-[rgba(251,146,60,0.3)] text-[var(--rm-ink-orange)]",
    neutral: "bg-[var(--rm-panel)] border-[var(--rm-panel-border)] text-[var(--rm-text)]",
  };
  
  return (
    <span className={`inline-flex items-center gap-1.5 border rounded-full px-2.5 py-1 text-[10px] font-extrabold whitespace-nowrap ${styles[tone]}`}>
      {tone === "good" ? <CheckCircle2 size={12} /> : tone === "warn" ? <AlertTriangle size={12} /> : <Clock3 size={12} />}
      {children}
    </span>
  );
}

function SelectBox({
  icon: Icon,
  label,
  value,
  hint,
  onClick,
  disabled,
  loading,
  compact,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "h-full min-w-0" : "grid gap-2 min-w-[220px]"}>
      {!compact ? (
        <div className="text-[10px] tracking-[0.08em] font-extrabold uppercase text-[var(--rm-text-muted)] flex items-center gap-1">
          <Icon size={13} strokeWidth={2.2} />
          {label}
        </div>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={`flex w-full items-center justify-between gap-2 bg-[var(--rm-panel)] enabled:hover:bg-[var(--rm-panel-hover)] enabled:focus-visible:bg-[var(--rm-panel-hover)] transition-colors text-left font-bold disabled:opacity-60 disabled:cursor-not-allowed ${
          compact
            ? "min-h-[62px] border-0 border-l-2 border-transparent px-3 py-2 text-[11px] shadow-none enabled:hover:border-[var(--rm-brand-navy)]"
            : "rounded-lg border border-[var(--rm-panel-border)] px-3 py-2.5 text-[13px] shadow-sm"
        }`}
      >
        <span className="min-w-0 truncate">
          {value}
          {hint && <span className={`block ${compact ? "mt-1 text-[9px]" : "mt-1 text-[10px]"} font-medium text-[var(--rm-text-faint)] truncate`}>{hint}</span>}
        </span>
        {loading
          ? <Loader2 size={compact ? 14 : 15} className="shrink-0 animate-spin text-[var(--rm-brand-navy)]" />
          : <ChevronDown size={compact ? 14 : 15} className="text-[var(--rm-text-muted)] shrink-0" />}
      </button>
    </div>
  );
}

function AllocationInput({
  value,
  remainingCapacity,
  capacity,
  onChange,
  disabled,
  disabledReason,
}: {
  value: number;
  remainingCapacity: number;
  /** Full weekly capacity for this person (from workload / businessRules.workWeekHours). */
  capacity: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  disabledReason?: string | null;
}) {
  // Colour bands mirror the Timeline and Resources pages: derive total allocation
  // (other projects + this project) and classify against the same Settings thresholds.
  const br = getBusinessRules();
  const bookedOther = Math.max(0, capacity - remainingCapacity); // hours on other projects
  const totalHours  = bookedOther + value;
  const pct         = capacity > 0 ? (totalHours / capacity) * 100 : 0;

  const overWeeklyLimit = value > 168;
  const isOver     = !overWeeklyLimit && pct > br.overCapacityPct;
  const isGood     = !overWeeklyLimit && !isOver && pct >= br.targetUtilizationPct;
  const isUnder    = !overWeeklyLimit && !isOver && !isGood && value > 0;

  const [draft, setDraft] = useState(value ? formatHours(value) : "");

  useEffect(() => {
    const parsed = draft === "" ? 0 : Number(draft);
    if (!Number.isFinite(parsed) || parsed !== value) {
      setDraft(value ? formatHours(value) : "");
    }
  }, [value]); // Keep valid in-progress forms such as "12." intact.

  const remainingLabel = formatHours(remainingCapacity - value);

  return (
    <div className="relative">
      <input
        aria-label="Hours for this week"
        aria-describedby={disabledReason ? "past-week-lock-help" : undefined}
        title={disabledReason ?? undefined}
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        onChange={e => {
          const next = e.target.value.trim();
          if (!/^\d{0,3}(?:\.\d{0,2})?$/.test(next)) return;
          if (next === "") {
            setDraft("");
            onChange(0);
            return;
          }
          const parsed = Number(next);
          if (!Number.isFinite(parsed)) {
            setDraft(next);
            return;
          }
          // Do not silently turn 200 into 168. Keep the entered value visible
          // and block Save with an explicit per-week error until it is fixed.
          setDraft(next);
          onChange(parsed);
        }}
        onBlur={() => setDraft(value ? formatHours(value) : "")}
        className={`w-full box-border rounded-md px-1.5 py-2 text-center text-[13px] font-bold outline-none transition-colors border disabled:opacity-60 disabled:cursor-not-allowed ${
           "border-[var(--rm-ink-red)] bg-[rgba(248,113,113,0.08)] text-[var(--rm-ink-red)]"
        }`}
        placeholder="0"
      />
       <span className="block mt-1 text-center text-[9px] text-[var(--rm-ink-red)]">
        {overWeeklyLimit
          ? "maximum 168h/week"
          : isOver
          ? "over capacity"
          : isGood
          ? `${remainingLabel}h left`
          : isUnder
          ? "under-utilized"
          : "add hours"}
      </span>
    </div>
  );
}

function phasesForWeek(weekStart: string, phases: PlannerSchedulePhase[]): PlannerSchedulePhase[] {
  const start = parseScheduleDate(weekStart);
  if (!start) return [];
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return phases.filter((phase) => {
    const phaseStart = parseScheduleDate(phase.start);
    const phaseEnd = parseScheduleDate(phase.end);
    return !!phaseStart && !!phaseEnd && phaseStart <= end && phaseEnd >= start;
  });
}

export function TeamAllocationPlanner({
  projectName,
  projectNumber,
  roleName,
  onRoleClick,
  personName,
  personSubtitle,
  onPersonClick,
  isLoadingRoster,
  showExistingColumn = false,
  hasSelectedPerson = false,
  isEditingExistingPlan = false,
  openSlotHoursTotal,
  scheduleState = "disabled",
  schedulePhases = [],
  scheduleMissingDateCount = 0,
  onRetrySchedule,
  onSetupSchedule,
  onOpenProject,
  contextData,
  projectDates,
  editableDates,
  existingTeamCount,
  weeks,
  onPlannedHoursChange,
  onExistingWorkClick,
  onExistingSummaryClick,
  isLoadingWorkload,
  workloadError,
  workloadReady,
  onRetryWorkload,
  onCancel,
  onSubmit,
  isSubmitting,
  canSubmit = true,
  selectionLocked,
  cancelDisabled,
  onClose,
  closeDisabled,
  closeButtonRef,
  errorMessage,
}: TeamAllocationPlannerProps) {
  useBusinessRulesVersion();
  const weekEditStates = useMemo(
    () => weeks.map((week) => getPastWeekEditStateFor(week.id, projectNumber)),
    [weeks, projectNumber],
  );
  
  const totalPlanned = useMemo(() => weeks.reduce((sum, w) => sum + w.planned, 0), [weeks]);
  const hasWarning = useMemo(
    () => weeks.some((week) => week.planned > (week.capacity - (week.booked - week.currentProjectHours))),
    [weeks],
  );
  const capacitySummary = useMemo(() => {
    if (!hasSelectedPerson || !workloadReady || weeks.length === 0) return null;
    const remaining = weeks.map((week) => Math.max(0, week.capacity - (week.booked - week.currentProjectHours)));
    const min = Math.min(...remaining);
    const max = Math.max(...remaining);
    const atCapacity = weeks.some((week) => week.capacity - (week.booked - week.currentProjectHours) <= 0);
    const range = min === max ? `${formatHours(min)}h/wk` : `${formatHours(min)}–${formatHours(max)}h/wk`;
    return {
      atCapacity,
      label: atCapacity
        ? `This person is already at maximum weekly capacity · ${formatHours(min)}h left in some weeks`
        : `Remaining capacity: ${range}`,
    };
  }, [hasSelectedPerson, workloadReady, weeks]);
  const selectorsDisabled = selectionLocked || isLoadingRoster;
  const roleColumnWidth = 145;
  const personColumnWidth = 175;
  const existingColumnWidth = 88;
  const frozenColumnsWidth = roleColumnWidth + personColumnWidth + (showExistingColumn ? existingColumnWidth : 0);
  // Fixed-width grid cells keep the sticky roster area from shrinking into
  // the weekly timeline while the weekly-scroll control below mirrors only
  // the right-side week pane.
  const weekGridStyle = useMemo(
    () => ({
      gridTemplateColumns: `${roleColumnWidth}px ${personColumnWidth}px${showExistingColumn ? ` ${existingColumnWidth}px` : ""} repeat(${Math.max(weeks.length, 1)}, 96px)`,
    }),
    [weeks.length, roleColumnWidth, personColumnWidth, existingColumnWidth, showExistingColumn],
  );
  const tableMinWidth = useMemo(
    () => `${frozenColumnsWidth + Math.max(weeks.length, 1) * 96}px`,
    [weeks.length, frozenColumnsWidth],
  );
  const weeksWidth = useMemo(
    () => `${Math.max(weeks.length, 1) * 96}px`,
    [weeks.length],
  );
  const phaseCells = useMemo(
    () => weeks.map((week) => phasesForWeek(week.id, schedulePhases)),
    [weeks, schedulePhases],
  );
  const scheduleNeedsSetup = scheduleState === "no-lifecycle" || scheduleState === "no-dates";
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);
  const [timelineMaxScroll, setTimelineMaxScroll] = useState(0);
  const measureTimelineScroll = () => {
    const viewport = timelineScrollRef.current;
    if (!viewport) return;
    setTimelineScrollLeft(viewport.scrollLeft);
    setTimelineMaxScroll(Math.max(0, viewport.scrollWidth - viewport.clientWidth));
  };
  useEffect(() => {
    const viewport = timelineScrollRef.current;
    if (!viewport) return;
    measureTimelineScroll();
    const frame = requestAnimationFrame(measureTimelineScroll);
    const observer = new ResizeObserver(measureTimelineScroll);
    observer.observe(viewport);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [weeks.length, tableMinWidth, frozenColumnsWidth]);
  const plannerFocusWeekIndex = useMemo(() => {
    if (weeks.length === 0) return -1;
    const today = new Date();
    const currentMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    currentMonday.setDate(currentMonday.getDate() - ((currentMonday.getDay() + 6) % 7));
    const currentWeekId = [
      currentMonday.getFullYear(),
      String(currentMonday.getMonth() + 1).padStart(2, "0"),
      String(currentMonday.getDate()).padStart(2, "0"),
    ].join("-");
    const currentIndex = weeks.findIndex((week) => week.id === currentWeekId);
    const bookedIndices = weeks
      .map((week, index) => week.booked > 0 ? index : -1)
      .filter((index) => index >= 0);
    if (bookedIndices.length === 0) return currentIndex >= 0 ? currentIndex : 0;
    if (currentIndex < 0) return bookedIndices[0];
    return bookedIndices.reduce((nearest, index) =>
      Math.abs(index - currentIndex) < Math.abs(nearest - currentIndex) ? index : nearest
    );
  }, [weeks]);
  const plannerFocusWeekId = plannerFocusWeekIndex >= 0 ? weeks[plannerFocusWeekIndex]?.id ?? "" : "";

  // Long projects can span multiple years. Once the selected person's real
  // workload arrives, open around the booked week nearest today rather than at
  // the project's first week. That makes existing hours visible in this grid
  // (and the reduced green-row availability beside them) without requiring a
  // year of horizontal scrolling.
  useEffect(() => {
    if (!hasSelectedPerson || !workloadReady || plannerFocusWeekIndex < 0) return;
    const frame = requestAnimationFrame(() => {
      const viewport = timelineScrollRef.current;
      if (!viewport) return;
      const weekColumnWidth = 96;
       const weekCenter = frozenColumnsWidth + plannerFocusWeekIndex * weekColumnWidth + weekColumnWidth / 2;
      viewport.scrollLeft = Math.max(0, weekCenter - viewport.clientWidth / 2);
      measureTimelineScroll();
    });
    return () => cancelAnimationFrame(frame);
  }, [
    hasSelectedPerson,
    workloadReady,
    personName,
    plannerFocusWeekIndex,
    plannerFocusWeekId,
    frozenColumnsWidth,
  ]);

  return (
    <div className="w-full bg-[var(--rm-panel)] text-[var(--rm-text)] font-sans">
      <div className="max-w-[1390px] mx-auto">

        <section className="overflow-hidden">
          
          <main className="min-w-0 p-3 flex flex-col">
              {/* Compact header row: title + project badge + close */}
              <div className="flex justify-between items-center gap-3 flex-wrap mb-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="text-[14px] font-bold text-[var(--rm-text)]">
                    {isEditingExistingPlan ? `Weekly hours — ${personName}` : `Availability — ${personName}`}
                  </div>
                  {isEditingExistingPlan && (
                    <span className="text-[11px] font-semibold text-[var(--rm-ink-red)]">Already assigned — adjust and save.</span>
                  )}
                  {editableDates ? (
                    <div className="inline-flex flex-wrap items-center gap-2 text-[12px] text-[var(--rm-text-muted)]">
                      <DateField
                        aria-label="Assignment start date"
                        value={editableDates.start}
                        min={editableDates.min}
                        max={editableDates.max}
                        disabled={selectionLocked}
                        onChange={editableDates.onStartChange}
                        wrapStyle={{ width: 154 }}
                        style={{ minHeight: 38, padding: "8px 34px 8px 10px", fontSize: 13, fontWeight: 700 }}
                      />
                      <span className="font-semibold text-[var(--rm-text-faint)]">to</span>
                      <DateField
                        aria-label="Assignment end date"
                        value={editableDates.end}
                        min={editableDates.min}
                        max={editableDates.max}
                        disabled={selectionLocked}
                        onChange={editableDates.onEndChange}
                        wrapStyle={{ width: 154 }}
                        style={{ minHeight: 38, padding: "8px 34px 8px 10px", fontSize: 13, fontWeight: 700 }}
                      />
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill tone={hasWarning ? "warn" : "good"}>
                    {hasWarning ? "Capacity warning" : "Within capacity"}
                  </StatusPill>
                  <StatusPill tone="neutral">{formatHours(totalPlanned)}h planned</StatusPill>
                  {onOpenProject ? (
                    <button
                      type="button"
                      onClick={onOpenProject}
                      data-testid="allocation-planner-open-project"
                      title={`Open ${projectName}`}
                      className="flex items-center gap-1.5 border border-[var(--rm-panel-border)] rounded-[7px] bg-[var(--rm-panel-soft)] px-2 py-1.5 text-[11px] font-bold text-[var(--rm-text)] hover:bg-[var(--rm-panel-hover)] hover:text-[var(--rm-brand-navy)]"
                    >
                      <Layers3 size={12} className="text-[var(--rm-brand-navy)]" />
                      <span className="max-w-32 truncate">{projectName}</span>
                      <ExternalLink size={11} aria-hidden="true" />
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 border border-[var(--rm-panel-border)] rounded-[7px] bg-[var(--rm-panel-soft)] px-2 py-1.5 text-[11px] font-bold text-[var(--rm-text)]">
                      <Layers3 size={12} className="text-[var(--rm-brand-navy)]" />
                      <span className="max-w-32 truncate">{projectName}</span>
                    </div>
                  )}
                  <button
                    ref={closeButtonRef}
                    type="button"
                    onClick={onClose}
                    disabled={closeDisabled}
                    aria-label="Close add team member"
                    title={closeDisabled ? "Finish saving weekly hours before closing" : "Close"}
                    className="grid h-7 w-7 place-items-center rounded-[7px] border border-[var(--rm-panel-border)] bg-[var(--rm-panel-soft)] text-[var(--rm-text-muted)] enabled:hover:bg-[var(--rm-panel-hover)] enabled:hover:text-[var(--rm-text)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

                <div className="mt-4 overflow-hidden rounded-[11px] border border-[var(--rm-panel-border)] bg-[var(--rm-panel)]">
                  <div
                    ref={timelineScrollRef}
                    onScroll={(event) => {
                      const viewport = event.currentTarget;
                      setTimelineScrollLeft(viewport.scrollLeft);
                      setTimelineMaxScroll(Math.max(0, viewport.scrollWidth - viewport.clientWidth));
                    }}
                    className="overflow-x-auto rm-planner-scroll-viewport"
                  >
                   {scheduleState === "loading" ? (
                   <div className="min-h-[180px] flex flex-col items-center justify-center gap-3 text-[var(--rm-text-muted)]">
                     <Loader2 size={24} className="animate-spin text-[var(--rm-brand-navy)]" />
                     <div className="text-xs font-bold">Loading project schedule before planning hours…</div>
                   </div>
                 ) : scheduleNeedsSetup ? (
                   <div className="m-4 flex items-start gap-3 rounded-lg border border-[rgba(232,119,34,0.35)] bg-[rgba(232,119,34,0.08)] p-3 text-[var(--rm-text)]">
                     <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--rm-ink-orange)]" />
                     <div className="min-w-0">
                       <div className="text-[12px] font-extrabold">
                         {scheduleState === "no-lifecycle" ? "No phase schedule found" : "Phase dates not set"}
                       </div>
                       <div className="mt-1 text-[11px] leading-relaxed text-[var(--rm-text-muted)]">
                         {scheduleState === "no-lifecycle"
                           ? "Assign a lifecycle first to plan weekly hours against this project’s phases."
                           : "The lifecycle phases do not have usable start and end dates, so there are no schedule weeks to allocate hours into."}
                       </div>
                       {onSetupSchedule ? (
                         <button
                           type="button"
                           onClick={onSetupSchedule}
                           className="mt-2 rounded-md bg-[var(--rm-green)] px-2.5 py-1.5 text-[10px] font-extrabold text-white hover:brightness-110"
                         >
                           {scheduleState === "no-lifecycle" ? "Go to Schedule →" : "Add dates in Schedule →"}
                         </button>
                       ) : null}
                     </div>
                   </div>
                 ) : scheduleState === "error" ? (
                   <div className="min-h-[180px] flex flex-col items-center justify-center gap-3 text-[var(--rm-text-muted)]">
                     <AlertTriangle size={24} className="text-[var(--rm-ink-red)]" />
                     <div className="text-xs font-bold">Couldn’t load the project schedule.</div>
                     <button
                       type="button"
                       onClick={onRetrySchedule}
                       className="flex items-center gap-1.5 rounded-md border border-[var(--rm-panel-border)] bg-[var(--rm-panel-soft)] px-3 py-1.5 text-xs font-bold text-[var(--rm-text)] hover:bg-[var(--rm-panel-hover)]"
                     >
                       <RefreshCcw size={14} /> Retry
                     </button>
                   </div>
                 ) : isLoadingWorkload ? (
                  <div className="min-h-[180px] flex flex-col items-center justify-center gap-3 text-[var(--rm-text-muted)]">
                    <Loader2 size={24} className="animate-spin text-[var(--rm-brand-navy)]" />
                    <div className="text-xs font-bold">Loading workload data...</div>
                  </div>
                ) : workloadError ? (
                  <div className="min-h-[180px] flex flex-col items-center justify-center gap-3 text-[var(--rm-text-muted)]">
                    <AlertTriangle size={24} className="text-[var(--rm-ink-red)]" />
                    <div className="text-xs font-bold text-center px-4 max-w-sm">
                      Failed to load workload data. Please try again.
                    </div>
                    <button 
                      onClick={onRetryWorkload}
                      className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-[var(--rm-panel-soft)] hover:bg-[var(--rm-panel-hover)] border border-[var(--rm-panel-border)] rounded-md text-xs font-bold text-[var(--rm-text)] transition-colors"
                    >
                      <RefreshCcw size={14} /> Retry
                    </button>
                  </div>
                ) : weeks.length === 0 ? (
                  <div className="min-h-[180px] flex items-center justify-center text-[var(--rm-text-muted)] text-xs font-bold">
                    No weeks available in the selected project dates.
                  </div>
                ) : (
                    <div style={{ minWidth: tableMinWidth, isolation: "isolate" }}>
                     {/* Header labels stay separate from the selector/workload
                         row below, matching the compact roster grid. */}
                    <div className="grid bg-[var(--rm-panel-soft)] border-b border-[var(--rm-panel-border)]" style={weekGridStyle}>
                        <div style={{ position: "sticky", left: 0, zIndex: 30, width: roleColumnWidth, minWidth: roleColumnWidth, boxSizing: "border-box" }} className="border-r border-[var(--rm-panel-border)] bg-[var(--rm-panel-soft)] px-2.5 py-2 text-[9px] font-extrabold uppercase tracking-[0.08em] text-[var(--rm-text-muted)] flex items-center gap-1">
                          <BriefcaseBusiness size={12} /> Role
                        </div>
                        <div style={{ position: "sticky", left: roleColumnWidth, zIndex: 30, width: personColumnWidth, minWidth: personColumnWidth, boxSizing: "border-box" }} className="border-r border-[var(--rm-panel-border)] bg-[var(--rm-panel-soft)] px-2.5 py-2 text-[9px] font-extrabold uppercase tracking-[0.08em] text-[var(--rm-text-muted)] flex items-center gap-1">
                          <UserRound size={12} /> Assigned person
                        </div>
                        {showExistingColumn ? (
                          <div
                            style={{ position: "sticky", left: roleColumnWidth + personColumnWidth, zIndex: 30, width: existingColumnWidth, minWidth: existingColumnWidth, boxSizing: "border-box" }}
                            className="border-r border-[var(--rm-panel-border)] bg-[var(--rm-panel-soft)] px-2 py-1.5 text-[9px] font-extrabold uppercase tracking-[0.08em] text-[var(--rm-text-muted)] flex items-center justify-center"
                          >
                            Existing
                          </div>
                        ) : null}
                      {weeks.map(week => (
                        <div key={week.id} className="border-l border-[var(--rm-panel-border)] px-1.5 py-1.5 text-center flex flex-col justify-center">
                          <div className="text-[11px] font-bold text-[var(--rm-text)]">{week.label}</div>
                            {/* Labelled "cap" — a bare "55h" here reads as the
                                person's existing booked hours, which live in
                                the EXISTING row below instead. */}
                            <div className="mt-0.5 text-[10px] font-extrabold text-[var(--rm-text)]">{formatHours(week.capacity)}h <span className="font-bold text-[var(--rm-text-faint)]">cap</span></div>
                        </div>
                      ))}
                    </div>

                    {scheduleState === "ready" ? (
                      <div className="grid border-b border-[var(--rm-panel-border)] bg-[var(--rm-panel)]" style={weekGridStyle}>
                        <div
                          style={{
                            position: "sticky",
                            left: 0,
                            zIndex: 30,
                            width: frozenColumnsWidth,
                            minWidth: frozenColumnsWidth,
                            boxSizing: "border-box",
                            gridColumn: `1 / span ${showExistingColumn ? 3 : 2}`,
                          }}
                          className="border-r border-[var(--rm-panel-border)] bg-[var(--rm-panel)] px-3 py-1.5 flex items-center gap-1"
                        >
                          <CalendarDays size={11} className="shrink-0 text-[var(--rm-text-muted)]" />
                          <div className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-[var(--rm-text-muted)]">Schedule</div>
                        </div>
                        {phaseCells.map((phases, index) => (
                          <div
                            key={weeks[index]?.id}
                            title={phases.length
                              ? phases.map((phase) => `${phase.title}: ${phase.start} – ${phase.end}`).join("\n")
                              : "No scheduled phase this week"}
                            className="min-h-[28px] border-l border-[var(--rm-panel-border)] px-1.5 py-1"
                          >
                            {phases.length ? (
                              <div className="flex h-full flex-col justify-center gap-[3px]">
                                {phases.slice(0, 3).map((phase) => (
                                  <div
                                    key={`${phase.stageStep}-${phase.title}`}
                                    style={{ backgroundColor: phase.color }}
                                    className="h-[5px] w-full rounded-sm opacity-90"
                                  />
                                ))}
                              </div>
                            ) : (
                              <div className="flex h-full items-center justify-center text-[9px] font-bold text-[var(--rm-text-faint)]">—</div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {scheduleState === "ready" && scheduleMissingDateCount > 0 ? (
                      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-b border-[rgba(232,119,34,0.35)] bg-[rgba(232,119,34,0.08)] px-3 py-2 text-center text-[10px] font-semibold text-[var(--rm-ink-orange)]">
                        <span>{scheduleMissingDateCount} phase{scheduleMissingDateCount === 1 ? "" : "s"} without dates {scheduleMissingDateCount === 1 ? "is" : "are"} not shown in this timeline.</span>
                        {onSetupSchedule ? (
                          <button
                            type="button"
                            onClick={onSetupSchedule}
                            className="shrink-0 rounded-md border border-[rgba(232,119,34,0.45)] bg-[var(--rm-panel)] px-2.5 py-1 text-[9px] font-extrabold text-[var(--rm-ink-orange)] shadow-sm transition-colors hover:bg-[rgba(232,119,34,0.1)]"
                          >
                            Add dates in Schedule →
                          </button>
                        ) : (
                          <span>Add dates in Schedule to include {scheduleMissingDateCount === 1 ? "it" : "them"}.</span>
                        )}
                      </div>
                    ) : null}

                    <div className="grid border-b border-[var(--rm-panel-border)]" style={weekGridStyle}>
                       <div style={{ position: "sticky", left: 0, zIndex: 30, width: roleColumnWidth, minWidth: roleColumnWidth, boxSizing: "border-box" }} className="border-r border-[var(--rm-panel-border)] bg-[var(--rm-panel)]">
                         <SelectBox
                           compact
                           icon={BriefcaseBusiness}
                           label="Role"
                           value={roleName}
                           hint="Exact role match"
                           onClick={onRoleClick}
                           disabled={selectorsDisabled}
                           loading={isLoadingRoster}
                         />
                       </div>
                         <div style={{ position: "sticky", left: roleColumnWidth, zIndex: 30, width: personColumnWidth, minWidth: personColumnWidth, boxSizing: "border-box" }} className="border-r border-[var(--rm-panel-border)] bg-[var(--rm-panel)]">
                         <SelectBox
                           compact
                           icon={UserRound}
                           label="Assigned person"
                           value={personName}
                           hint={personSubtitle}
                           onClick={onPersonClick}
                           disabled={selectorsDisabled}
                           loading={isLoadingRoster}
                         />
                       </div>
                        {showExistingColumn ? (
                          <div
                             style={{ position: "sticky", left: roleColumnWidth + personColumnWidth, zIndex: 30, width: existingColumnWidth, minWidth: existingColumnWidth, boxSizing: "border-box" }}
                             className="border-r border-[var(--rm-panel-border)] bg-[var(--rm-panel)] p-1.5"
                          >
                            <button
                              type="button"
                              onClick={onExistingSummaryClick}
                              disabled={!onExistingSummaryClick || selectorsDisabled || isLoadingWorkload || !workloadReady}
                              title={
                                !hasSelectedPerson
                                  ? "Select an assigned person first"
                                  : isLoadingWorkload
                                    ? "Loading workload"
                                    : workloadError
                                      ? "Workload could not be loaded"
                                      : "View the person's workload by project and week"
                              }
                               className="flex min-h-[44px] w-full items-center justify-center rounded-md border border-[var(--rm-brand-navy)] bg-[var(--rm-panel)] px-1 py-1 text-center text-[9px] font-extrabold uppercase tracking-[0.06em] text-[var(--rm-brand-navy)] shadow-sm enabled:hover:bg-[var(--rm-panel-hover)] enabled:hover:underline disabled:cursor-not-allowed disabled:opacity-45"
                            >
                               Existing
                            </button>
                          </div>
                        ) : null}
                      {weeks.map((week, index) => (
                        // EXISTING shows OTHER work only. This project's saved
                        // hours are shown (and edited) in the green row below —
                        // displaying them here too made an at-capacity member
                        // read as double-booked ("55h existing + 55h planned").
                        <button key={week.id} type="button" onClick={() => onExistingWorkClick?.(week, index)} disabled={!onExistingWorkClick} className="border-l border-[var(--rm-panel-border)] px-2 py-2 text-center text-[11px] font-bold text-[var(--rm-text)] enabled:hover:bg-[var(--rm-panel-hover)] enabled:hover:text-[var(--rm-brand-navy)] disabled:cursor-default">{formatHours(Math.max(0, Math.round((week.booked - week.currentProjectHours) * 100) / 100))}h</button>
                      ))}
                    </div>

                    {/* Retired condensed row — retained below temporarily only
                        to avoid a broad component rewrite. */}
                    <div className="hidden grid border-b border-[var(--rm-panel-border)]" style={weekGridStyle}>
                      <div className="p-2.5 px-3">
                        <div className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-[var(--rm-text-muted)]">Availability</div>
                        <div className="mt-1 text-[9px] leading-relaxed text-[var(--rm-text-faint)]">
                          Capacity · Existing · Remaining
                        </div>
                      </div>
                      {weeks.map((week, index) => {
                        const remaining = week.capacity - week.booked - week.planned;
                        const isOver = remaining < 0;
                        
                        return (
                          <div key={week.id} className="border-l border-[var(--rm-panel-border)] p-2 text-[10px]">
                            <div className="flex items-center justify-between gap-1 text-[var(--rm-text-muted)]"><span>Cap</span><strong className="text-[var(--rm-text)]">{week.capacity}h</strong></div>
                            <button
                              type="button"
                              onClick={() => onExistingWorkClick?.(week, index)}
                              disabled={!onExistingWorkClick}
                              className="mt-1 flex w-full items-center justify-between gap-1 rounded px-0.5 text-[var(--rm-text-muted)] enabled:hover:bg-[var(--rm-panel-soft)] enabled:hover:text-[var(--rm-brand-navy)] disabled:cursor-default"
                            >
                              <span>Existing</span><strong className="text-[var(--rm-text)]">{week.booked}h</strong>
                            </button>
                            <div className={`mt-1 flex items-center justify-between gap-1 ${isOver ? "text-[var(--rm-ink-orange)]" : "text-[var(--rm-green-ink)]"}`}><span>Remaining</span><strong>{remaining}h</strong></div>
                          </div>
                        );
                      })}
                    </div>

                    {/* This Project Row (Input) */}
                    <div className="grid border-b border-[var(--rm-panel-border)] bg-[var(--rm-green-soft)]" style={weekGridStyle}>
                       <div
                         style={{
                            position: "sticky",
                           left: 0,
                            zIndex: 40,
                           width: frozenColumnsWidth,
                           minWidth: frozenColumnsWidth,
                           boxSizing: "border-box",
                            gridColumn: `1 / span ${showExistingColumn ? 3 : 2}`,
                            // --rm-green-soft is intentionally translucent.
                            // Composite it over an opaque panel so the
                            // horizontally scrolling week inputs cannot show
                            // through the frozen This Project area.
                            backgroundColor: "var(--rm-panel)",
                            backgroundImage: "linear-gradient(var(--rm-green-soft), var(--rm-green-soft))",
                            overflow: "hidden",
                         }}
                           className="border-r border-[var(--rm-panel-border)] p-2.5 px-3"
                       >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-black uppercase text-[var(--rm-green-ink)] tracking-wide">
                             {isEditingExistingPlan ? "This project" : <>This project <Plus size={12} /></>}
                          </div>
                          <div className="shrink-0 text-[10px] font-extrabold text-[var(--rm-ink-red)]">
                            {formatHours(totalPlanned)}h total
                          </div>
                        </div>
                         <div className="mt-1 text-[9px] text-[var(--rm-text-muted)]">
                           {isEditingExistingPlan
                             ? "Saved hours — edit and save"
                             : typeof openSlotHoursTotal === "number" && openSlotHoursTotal > 0
                             ? `Position calls for ${formatHours(openSlotHoursTotal)}h · prefilled from available hours`
                             : "Prefilled from available hours"}
                         </div>
                          {capacitySummary ? (
                            <div
                              className="mt-1 text-[9px] font-bold leading-snug text-[var(--rm-ink-red)]"
                            >
                              {capacitySummary.label}
                            </div>
                          ) : null}
                      </div>
                      {weeks.map((week, index) => {
                        const weekEditState = weekEditStates[index];
                        const pastLocked = !!weekEditState?.locked;
                        return (
                        <div
                          key={week.id}
                          className={`border-l border-[var(--rm-panel-border)] p-1.5 ${pastLocked ? "bg-[var(--rm-panel-soft)]" : ""}`}
                          title={pastLocked ? PAST_WEEK_LOCKED_REASON : undefined}
                        >
                          <AllocationInput
                            value={week.planned}
                            remainingCapacity={week.capacity - (week.booked - week.currentProjectHours)}
                            capacity={week.capacity}
                            onChange={val => onPlannedHoursChange(index, val)}
                            disabled={selectionLocked || pastLocked}
                            disabledReason={pastLocked ? PAST_WEEK_LOCKED_REASON : null}
                          />
                           {pastLocked ? (
                             <div className="mt-1 flex items-center justify-center gap-1 text-[9px] font-bold text-[var(--rm-text-muted)]">
                               <Lock size={9} aria-hidden="true" />
                               Locked
                             </div>
                           ) : null}
                        </div>
                        );
                      })}
                    </div>

                  </div>
                  )}
                  </div>
                  {/* The weekly navigator belongs to the date grid itself.
                      Keep it available while roster/workload data is loading,
                      otherwise the visible overflow has no way to be reached. */}
                  {weeks.length > 0 ? (
                    <div
                      className="border-t border-[var(--rm-panel-border)] bg-[var(--rm-panel)]"
                      style={{ marginLeft: frozenColumnsWidth }}
                    >
                      <input
                        type="range"
                        className="rm-weekly-scroll-control"
                        aria-label="Scroll weekly hours"
                        min={0}
                        max={Math.max(1, timelineMaxScroll)}
                        value={Math.min(timelineScrollLeft, Math.max(1, timelineMaxScroll))}
                        onChange={(event) => {
                          const next = Number(event.currentTarget.value);
                          const viewport = timelineScrollRef.current;
                          if (viewport) viewport.scrollLeft = next;
                          setTimelineScrollLeft(next);
                        }}
                        disabled={timelineMaxScroll === 0}
                      />
                    </div>
                  ) : null}
              </div>

              {selectionLocked ? (
                <div className={`mt-4 rounded-lg border px-3 py-2 text-[11px] font-bold ${
                  isSubmitting
                    ? "border-[var(--rm-panel-border)] bg-[var(--rm-panel-soft)] text-[var(--rm-text-muted)]"
                    : "border-[rgba(251,146,60,0.35)] bg-[rgba(251,146,60,0.08)] text-[var(--rm-ink-orange)]"
                }`}>
                  {isSubmitting
                    ? "Saving the assignment and weekly hours. This workspace cannot close until the save finishes."
                    : "The person is already on the team. This workspace cannot close until RM ONE saves the weekly hours."}
                </div>
              ) : null}
              {weekEditStates.some((state) => state.locked) ? (
                <div
                  id="past-week-lock-help"
                  className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--rm-panel-border)] bg-[var(--rm-panel-soft)] px-3 py-2 text-[11px] font-bold text-[var(--rm-text-muted)]"
                >
                  <Lock size={13} aria-hidden="true" />
                  {PAST_WEEK_LOCKED_REASON}
                </div>
              ) : null}
              {errorMessage ? (
                <div role="alert" className="mt-4 rounded-lg border border-[rgba(248,113,113,0.45)] bg-[rgba(248,113,113,0.10)] px-3 py-2 text-[11px] font-bold text-[var(--rm-ink-red)]">
                  {errorMessage}
                </div>
              ) : null}

              <div className="flex justify-between items-center gap-4 mt-4 flex-wrap">
                <div className={`flex items-center gap-2 text-[11px] font-bold ${hasWarning ? "text-[var(--rm-ink-orange)]" : "text-[var(--rm-green-ink)]"}`}>
                  {hasWarning ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                  {hasWarning 
                     ? "Review the weeks above capacity before saving these hours."
                     : isEditingExistingPlan
                       ? "Saved project hours can be adjusted here."
                       : "Hours can be adjusted after adding the team member."}
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    type="button" 
                    onClick={onCancel}
                    disabled={isSubmitting || cancelDisabled}
                    className="px-4 py-2.5 border border-[var(--rm-panel-border)] rounded-lg bg-transparent hover:bg-[var(--rm-panel-soft)] text-[var(--rm-text)] text-[12px] font-bold transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button 
                    type="button" 
                    onClick={onSubmit}
                    disabled={!canSubmit || isSubmitting || isLoadingWorkload || !!workloadError}
                    className="inline-flex items-center gap-2 border-0 rounded-lg bg-[var(--rm-green)] hover:brightness-110 text-white px-4 py-2.5 text-[12px] font-bold shadow-sm transition-all disabled:opacity-50"
                  >
                    {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : isEditingExistingPlan ? "Save hours" : "Add to team"}
                    {!isSubmitting && <ArrowRight size={15} />}
                  </button>
                </div>
              </div>
          </main>
        </section>

      </div>
    </div>
  );
}
