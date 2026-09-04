import { createPortal } from "react-dom";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BarChart3, CalendarDays, ExternalLink, X } from "lucide-react";
import type { ResourceWeekAllocations } from "@/lib/api";
import { getPastEditRulesFor } from "@/lib/businessRules";
import { saveMemberWeeklyHours } from "@/lib/saveMemberWeeklyHours";
import {
  findWeeklyHoursViolation,
  weeklyHoursViolationMessage,
} from "@/lib/weeklyHoursValidation";
import { Z } from "@/lib/zLayers";

const PROJECT_COLORS = [
  { fill: "#5B9E96", text: "#FFFFFF" },
  { fill: "#5C8FB7", text: "#FFFFFF" },
  { fill: "#756BB1", text: "#FFFFFF" },
  { fill: "#B7794A", text: "#FFFFFF" },
  { fill: "#548B70", text: "#FFFFFF" },
  { fill: "#B36C7A", text: "#FFFFFF" },
  { fill: "#4E97A7", text: "#FFFFFF" },
  { fill: "#8C7A57", text: "#FFFFFF" },
];

type ProjectRow = {
  id: string;
  name: string;
  hours: number[];
  /** Whether any allocation contributing to a given week is locked. */
  locked: boolean[];
  total: number;
};

/** Key uniquely identifying a single editable project/week cell. */
function cellKey(projectId: string, week: string): string {
  return `${projectId}::${week}`;
}

function parseYmd(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatHours(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function colorForProject(projectId: string) {
  let hash = 0;
  for (const char of projectId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
}

/** Monday-key of the current week, matching the YYYY-MM-DD week format. */
function currentWeekKey(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // shift to Monday
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

/** Column tone from total hours vs capacity — used for the header badge and
 *  the full-column background tint so the over/good/under signal is visible
 *  at a glance across the whole week. Returns null when the week has no hours. */
function weekTone(total: number, capacity: number): {
  color: string;    // text / bar fill
  colBg: string;    // very-light column tint
} | null {
  if (total === 0 || capacity === 0) return null;
  const ratio = total / capacity;
  if (ratio > 1)    return { color: "#D97706", colBg: "rgba(251,191,36,0.08)" };  // over  → amber
  if (ratio >= 0.75) return { color: "#6BA539", colBg: "rgba(107,165,57,0.08)" }; // good  → green
  return             { color: "#E0414F", colBg: "rgba(224,65,79,0.08)" };          // under → red
}

/**
 * Project timeline for the selected person's existing workload. It consumes
 * the same week-by-project source used by the allocation planner, so every
 * displayed hour agrees with the Existing cells.
 *
 * When {@link canEdit} is set and a cell is neither locked nor blocked by the
 * project module's past-edit rules, that exact person+project+week cell can be
 * clicked into an inline numeric input and saved one week at a time through
 * saveMemberWeeklyHours (which merges the change onto fresh server truth and
 * respects the shared write queue / lock / verify pipeline). The aggregate
 * rows (weekly capacity, total booked, per-project total) stay read-only and
 * recompute from confirmed local overrides.
 *
 * Saves are OPTIMISTIC: the new value is applied to local state immediately so
 * the UI snaps without any loading delay. The API call runs in the background;
 * if it fails the override is reverted and the editor reopens with the original
 * draft so the user can retry.
 */
export function ExistingWorkTimelineModal({
  personName,
  personId,
  personRole,
  workload,
  weekStarts,
  canEdit = false,
  /** Use the Resources person-timeline visual treatment when launched from an
   *  over-allocation alert, while retaining the compact planner treatment for
   *  assignment flows that already use this component. */
  variant = "standard",
  onClose,
  onOpenProject,
  onSaved,
}: {
  personName: string;
  personId: string;
  personRole: string;
  workload: ResourceWeekAllocations | null;
  weekStarts: string[];
  canEdit?: boolean;
  variant?: "standard" | "resource";
  onClose: () => void;
  /** Opens one of the project records represented in the workload rows. */
  onOpenProject?: (projectId: string) => void;
  /** Fired after a confirmed one-week save so the caller can refresh workload. */
  onSaved?: () => void;
}) {
  const resourceStyle = variant === "resource";
  const workloadWeeks = workload?.weeks ?? [];
  const fullWeekHours = workload?.fullWeekHours ?? 0;
  const weeks = useMemo(() => {
    const real = Array.from(
      new Set(weekStarts.length > 0 ? weekStarts : workloadWeeks.map((row) => row.weekStart)),
    ).sort();
    if (real.length > 0) return real;
    // Membership-only workload: every assignment is zero-hour (or dated outside
    // the fetched window), so there are no bucket weeks to size the grid from.
    // Synthesize a 12-week planning window starting at the current week's
    // Monday — otherwise the seeded project rows render with zero columns and
    // there is no "+" cell to give a brand-new assignment its first hours.
    // UTC date arithmetic on the local calendar date keeps Mondays DST-safe.
    if (!workload || (workload.projects?.length ?? 0) === 0) return real;
    const now = new Date();
    const monday = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    return Array.from({ length: 12 }, (_, i) => {
      const w = new Date(monday);
      w.setUTCDate(w.getUTCDate() + i * 7);
      return w.toISOString().slice(0, 10);
    });
  }, [weekStarts, workloadWeeks, workload]);

  // Local per-cell overrides, applied OPTIMISTICALLY on save attempt.
  // Keyed by projectId::week so a project total and the aggregate rows can
  // recompute from optimistic truth without a full workload refetch.
  // On API failure the key is deleted so the old value is restored.
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  // The cell currently open for inline editing (null when none).
  const [editingCell, setEditingCell] = useState<string | null>(null);
  // Draft text for the open editor (kept verbatim so >168 stays visible).
  const [draft, setDraft] = useState("");
  // Per-cell friendly error (validation or save failure).
  const [cellError, setCellError] = useState<{ key: string; message: string } | null>(null);
  // Guards against Enter + blur firing the same commit twice.
  const committedRef = useRef(false);

  const { byProject, existingProjectIds } = useMemo(() => {
    const weekIndex = new Map(weeks.map((week, index) => [week, index]));
    const map = new Map<string, ProjectRow>();
    const ids = new Set<string>();
    for (const allocation of workloadWeeks) {
      ids.add(allocation.projectId);
      const index = weekIndex.get(allocation.weekStart);
      if (index === undefined) continue;
      const prior = map.get(allocation.projectId);
      const project = prior ?? {
        id: allocation.projectId,
        name: allocation.projectName || allocation.projectId,
        hours: Array.from({ length: weeks.length }, () => 0),
        locked: Array.from({ length: weeks.length }, () => false),
        total: 0,
      };
      project.hours[index] += allocation.hours;
      if (allocation.isLocked) project.locked[index] = true;
      if (!prior) map.set(project.id, project);
    }
    // Zero-hour assignments: the engine's `projects` list carries EVERY live
    // assignment, including ones whose rows are all zero (those produce no
    // `weeks` buckets). Seed an all-zero row so the project still shows up
    // and its weeks render as plannable "+" cells.
    for (const proj of workload?.projects ?? []) {
      if (!proj.projectId || map.has(proj.projectId)) continue;
      ids.add(proj.projectId);
      map.set(proj.projectId, {
        id: proj.projectId,
        name: proj.projectName || proj.projectId,
        hours: Array.from({ length: weeks.length }, () => 0),
        locked: Array.from({ length: weeks.length }, () => false),
        total: 0,
      });
    }
    return { byProject: map, existingProjectIds: ids };
  }, [weeks, workloadWeeks, workload?.projects]);

  // Effective hours per cell: confirmed override wins over server value.
  const hoursFor = useCallback(
    (projectId: string, week: string, index: number): number => {
      const key = cellKey(projectId, week);
      if (key in overrides) return overrides[key];
      return byProject.get(projectId)?.hours[index] ?? 0;
    },
    [overrides, byProject],
  );

  // Projects that have ANY hours in range (after overrides). Every project
  // that exists in the workload data is kept so zero weeks within its range
  // stay clickable, but a project that is all-zero everywhere is hidden.
  const projects = useMemo(() => {
    const rows = Array.from(byProject.values()).map((project) => {
      const hours = weeks.map((week, index) => hoursFor(project.id, week, index));
      const total = hours.reduce((sum, value) => sum + value, 0);
      return { ...project, hours, total };
    });
    return rows
      .filter((project) => project.total > 0 || existingProjectIds.has(project.id))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [byProject, weeks, hoursFor, existingProjectIds]);

  const weeklyTotals = useMemo(
    () => weeks.map((_, index) => projects.reduce((sum, project) => sum + project.hours[index], 0)),
    [weeks, projects],
  );
  const totalHours = weeklyTotals.reduce((sum, hours) => sum + hours, 0);
  const firstBookedWeekIndex = weeklyTotals.findIndex((hours) => hours > 0);

  // Pre-compute per-column tone so the same value drives header, capacity bar,
  // AND each project cell's background — all three surfaces update together.
  const colTones = useMemo(
    () => weeks.map((_, index) => weekTone(weeklyTotals[index], fullWeekHours)),
    [weeks, weeklyTotals, fullWeekHours],
  );

  const nowWeekKey = useMemo(() => currentWeekKey(), []);
  const nowWeekMs = useMemo(() => parseYmd(nowWeekKey).getTime(), [nowWeekKey]);

  // A cell is editable when the caller allows edits, the contributing
  // allocation is not locked, and the project module's past-edit rules permit
  // changing that week. Rules are module-scoped (OPM/LEM vs project).
  const canEditCell = useCallback(
    (projectId: string, week: string, index: number): boolean => {
      if (!canEdit || !personId) return false;
      if (byProject.get(projectId)?.locked[index]) return false;
      const { allowPastDateEdit, pastEditLimitWeeks } = getPastEditRulesFor(projectId.split("-")[0]);
      const age = Math.round((nowWeekMs - parseYmd(week).getTime()) / (7 * 24 * 60 * 60 * 1000));
      const lockedByPast = age > 0 && (!allowPastDateEdit || (pastEditLimitWeeks !== null && age > pastEditLimitWeeks));
      return !lockedByPast;
    },
    [canEdit, personId, byProject, nowWeekMs],
  );

  const timelineScrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (firstBookedWeekIndex < 0) return;
    const scrollContainer = timelineScrollRef.current;
    if (!scrollContainer) return;
    // Keep the frozen Project column visible and place the first real workload
    // week immediately beside it. The browser clamps this for short ranges.
    scrollContainer.scrollLeft = Math.max(0, 252 + firstBookedWeekIndex * 92 - 4);
  }, [firstBookedWeekIndex, weeks.length]);

  const rangeStart = weeks[0] ? parseYmd(weeks[0]) : null;
  const rangeEnd = weeks.at(-1) ? parseYmd(weeks.at(-1)!) : null;
  const rangeLabel = rangeStart && rangeEnd
    ? `${rangeStart.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} – ${rangeEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : "Selected project dates";
  const timelineWidth = `${252 + Math.max(weeks.length, 1) * 92}px`;
  const initials = personName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "—";

  const openEditor = useCallback(
    (projectId: string, week: string, index: number) => {
      if (!canEditCell(projectId, week, index)) return;
      const key = cellKey(projectId, week);
      committedRef.current = false;
      setCellError(null);
      setEditingCell(key);
      setDraft(String(hoursFor(projectId, week, index)));
    },
    [canEditCell, hoursFor],
  );

  const cancelEditor = useCallback(() => {
    setEditingCell(null);
    setDraft("");
    setCellError(null);
  }, []);

  const commitEditor = useCallback(
    (projectId: string, week: string) => {
      if (committedRef.current) return;
      committedRef.current = true;

      const key = cellKey(projectId, week);
      const raw = draft.trim();
      const value = raw === "" ? 0 : Number(raw);

      // Validate BEFORE saving. >168 (or NaN/negative) surfaces a persistent
      // red inline error and never saves or clamps.
      const violation = findWeeklyHoursViolation([[week, value]]);
      if (violation) {
        setCellError({ key, message: weeklyHoursViolationMessage(violation) });
        // Keep the editor open so the invalid value stays visible/correctable.
        committedRef.current = false;
        return;
      }

      // No-op: closing an editor with an unchanged value shouldn't hit the API.
      const currentIndex = weeks.indexOf(week);
      const prevValue = hoursFor(projectId, week, currentIndex);
      if (value === prevValue) {
        cancelEditor();
        return;
      }

      // ── OPTIMISTIC: close the editor and reflect the new value immediately ──
      // The user sees the result without any loading delay. The save runs in
      // the background; on failure we revert the override and reopen the editor
      // with the old draft so the user can retry without losing their input.
      setOverrides((prev) => ({ ...prev, [key]: value }));
      setEditingCell(null);
      setDraft("");
      setCellError(null);

      saveMemberWeeklyHours({
        projectId,
        memberId: personId,
        memberName: personName,
        memberRole: personRole,
        weekPatch: { week, hours: value },
      }).then(() => {
        onSaved?.();
      }).catch((err: unknown) => {
        // Revert the optimistic override so the old server value is restored,
        // then reopen the editor so the user can see and correct the failure.
        setOverrides((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        committedRef.current = false;
        setCellError({
          key,
          message: err instanceof Error ? err.message : "Could not save this week's hours. Please try again.",
        });
        setEditingCell(key);
        setDraft(String(value));
      });
    },
    [draft, weeks, hoursFor, cancelEditor, personId, personName, personRole, onSaved],
  );

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: Z.MODAL_CHILD_2,
        background: "rgba(15, 25, 35, 0.62)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${personName}'s project weekly hours`}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(1120px, 100%)", maxHeight: "88vh", display: "flex",
          flexDirection: "column", overflow: "hidden", borderRadius: 14,
          background: "#FFFFFF", color: "#253746", boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 12, padding: "15px 18px",
          borderBottom: "1px solid #E2E8F0", background: "#F8FAFC", flexShrink: 0,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: resourceStyle ? "50%" : 11,
            background: resourceStyle ? "#EE7B19" : "#E7F2D8",
            color: resourceStyle ? "#FFFFFF" : "#5A8E2C",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, fontSize: 12,
          }}>
            {resourceStyle ? initials : <BarChart3 size={19} />}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>
              {resourceStyle ? personName : "Project weekly hours"}
            </div>
            <div style={{ marginTop: 2, fontSize: 12, color: "#64748B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {resourceStyle
                ? `${personRole || "Staff"} · All Projects · ${projects.length} project${projects.length === 1 ? "" : "s"} · full history`
                : `${personName} · ${projects.length} project${projects.length === 1 ? "" : "s"} · ${rangeLabel}`}
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 8,
              border: "1px solid #E2E8F0", background: "#FFFFFF", padding: "5px 8px",
              color: "#64748B", fontSize: 11, fontWeight: 700,
            }}>
              <CalendarDays size={13} /> {resourceStyle ? rangeLabel : `${formatHours(totalHours)}h booked`}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close existing workload timeline"
              style={{
                width: 30, height: 30, border: "1px solid #E2E8F0", borderRadius: 8,
                background: "#FFFFFF", color: "#64748B", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {resourceStyle && (
          <div style={{
            display: "flex", alignItems: "center", gap: 14, padding: "9px 18px",
            borderBottom: "1px solid #E2E8F0", background: "#FFFFFF",
            color: "#64748B", fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
          }}>
            <span>UTILIZATION</span>
            {[
              ["Under", "#FF5757"],
              ["Good", "#6BA639"],
              ["Over", "#F9AB33"],
            ].map(([label, color]) => (
              <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 5, letterSpacing: 0, textTransform: "none" }}>
                <i style={{ width: 15, height: 15, borderRadius: 3, background: color, display: "inline-block" }} />
                {label}
              </span>
            ))}
          </div>
        )}

        {canEdit ? (
          <div style={{
            padding: "8px 18px", borderBottom: "1px solid #E2E8F0", background: "#FFFFFF",
            fontSize: 11, color: "#64748B",
          }}>
              Edit a project's week directly here. Totals and capacity stay read-only; locked weeks and weeks outside the past-edit window cannot be changed.
          </div>
        ) : null}

        {/* No horizontal padding: the frozen PROJECT column must sit flush with
            the scrollport's left edge — any left padding creates a gap where
            horizontally-scrolled week cells peek through beside the sticky
            column. Vertical padding stays. */}
        <div ref={timelineScrollRef} style={{ overflow: "auto", padding: resourceStyle ? "12px 0 18px" : "16px 0 18px" }}>
          {resourceStyle && (
            <div style={{ padding: "0 18px 9px", color: "#475569", fontSize: 12, fontWeight: 800 }}>
              Projects
              <span style={{ marginLeft: 8, color: "#94A3B8", fontWeight: 600, fontSize: 10 }}>
                Weekly hours by project · click a week to edit
              </span>
            </div>
          )}
          {projects.length === 0 ? (
            <div style={{
              padding: 30, textAlign: "center", borderRadius: 10, background: "#F8FAFC",
              color: "#64748B", fontSize: 13,
            }}>
              No existing project hours are booked in this date range.
            </div>
          ) : (
            <div style={{ minWidth: timelineWidth, border: "1px solid #E2E8F0", borderRadius: 10 }}>
              <div style={{ position: "sticky", top: 0, zIndex: 10, background: "#FFFFFF" }}>
                {/* ── Column header row ── */}
                <div style={{ display: "grid", gridTemplateColumns: `252px repeat(${Math.max(weeks.length, 1)}, 92px)`, background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                  <div style={{ position: "sticky", left: 0, zIndex: 12, padding: "10px 12px", background: "#F8FAFC", borderRight: "1px solid #E2E8F0", fontSize: 10, fontWeight: 800, letterSpacing: 0.7, color: "#64748B" }}>
                    PROJECT
                  </div>
                  {weeks.map((week, index) => {
                    const date = parseYmd(week);
                    const tone = colTones[index];
                    return (
                      <div key={week} style={{ padding: "8px 5px", borderLeft: "1px solid #E2E8F0", textAlign: "center", background: tone?.colBg }}>
                        <div style={{ fontSize: 10, color: "#334155", fontWeight: 800 }}>{date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                        <div style={{ marginTop: 2, fontSize: 9, color: tone?.color ?? "#64748B", fontWeight: 700 }}>
                          {formatHours(weeklyTotals[index])}h total
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ── Weekly capacity bar row ── */}
                <div style={{ display: "grid", gridTemplateColumns: `252px repeat(${Math.max(weeks.length, 1)}, 92px)`, borderBottom: "1px solid #E2E8F0", background: "#FFFFFF" }}>
                  <div style={{ position: "sticky", left: 0, zIndex: 12, padding: "9px 12px", background: "#FFFFFF", borderRight: "1px solid #E2E8F0" }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "#64748B", letterSpacing: 0.7 }}>WEEKLY CAPACITY</div>
                    <div style={{ marginTop: 2, fontSize: 10, color: "#94A3B8" }}>Booked across all projects</div>
                  </div>
                  {weeks.map((week, index) => {
                    const hours = weeklyTotals[index];
                    const ratio = fullWeekHours > 0 ? hours / fullWeekHours : 0;
                    const tone = colTones[index];
                    const barColor = tone?.color ?? "#64748B";
                    return (
                      <div key={week} title={`${formatHours(hours)}h booked of ${fullWeekHours}h capacity`} style={{ minHeight: 54, padding: "8px 7px", borderLeft: "1px solid #F1F5F9", display: "flex", flexDirection: "column", justifyContent: "center", background: tone?.colBg }}>
                        <div style={{ height: 8, overflow: "hidden", borderRadius: 4, background: "#E8EEF3" }}>
                          <div style={{ width: `${Math.min(ratio, 1) * 100}%`, height: "100%", background: barColor }} />
                        </div>
                        <div style={{ marginTop: 5, textAlign: "center", color: barColor, fontSize: 11, fontWeight: 800 }}>{formatHours(hours)}h</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {projects.map((project) => {
                const color = colorForProject(project.id);
                return (
                  <div key={project.id} style={{ display: "grid", gridTemplateColumns: `252px repeat(${Math.max(weeks.length, 1)}, 92px)`, minHeight: 61, borderBottom: "1px solid #F1F5F9" }}>
                    <div style={{ position: "sticky", left: 0, zIndex: 2, padding: "9px 12px", background: "#FFFFFF", borderRight: "1px solid #E2E8F0", display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <div style={{ width: 8, height: 8, flexShrink: 0, borderRadius: 2, background: color.fill }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: "#94A3B8", fontSize: 9.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{project.id}</div>
                        <div style={{ marginTop: 1, color: "#253746", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{project.name}</div>
                        <div style={{ marginTop: 2, color: "#64748B", fontSize: 10 }}>{formatHours(project.total)}h in this range</div>
                        {onOpenProject ? (
                          <button
                            type="button"
                            data-testid={`existing-work-open-project-${project.id}`}
                            onClick={() => onOpenProject(project.id)}
                            title={`Open ${project.name}`}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6,
                              border: "none", background: "transparent", padding: 0, color: "#4D7F25",
                              fontSize: 10, fontWeight: 800, cursor: "pointer",
                            }}
                          >
                            Open project <ExternalLink size={11} aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {weeks.map((week, index) => {
                      const hours = project.hours[index];
                      const before = project.hours[index - 1] ?? 0;
                      const after = project.hours[index + 1] ?? 0;
                      const active = hours > 0;
                      const key = cellKey(project.id, week);
                      const editable = canEditCell(project.id, week, index);
                      const isEditing = editingCell === key;
                      const errorHere = cellError?.key === key ? cellError.message : null;
                      const weekLabel = parseYmd(week).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                      const tone = colTones[index];

                      if (isEditing) {
                        return (
                          <div key={week} style={{ padding: "8px 4px", borderLeft: "1px solid #F8FAFC", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, position: "relative", background: tone?.colBg }}>
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              autoFocus
                              value={draft}
                              onChange={(e) => {
                                setDraft(e.target.value);
                                if (cellError?.key === key) setCellError(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitEditor(project.id, week);
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  // Prevent the blur handler from re-committing.
                                  committedRef.current = true;
                                  cancelEditor();
                                }
                              }}
                              onBlur={() => { commitEditor(project.id, week); }}
                              aria-label={`Hours for ${project.name}, week of ${weekLabel}`}
                              style={{
                                width: "100%", height: 30, textAlign: "center", fontSize: 12, fontWeight: 700,
                                border: `1.5px solid ${errorHere ? "#DC2626" : "#5C8FB7"}`, borderRadius: 8,
                                color: errorHere ? "#DC2626" : "#253746", background: "#FFFFFF", outline: "none",
                                boxSizing: "border-box",
                              }}
                            />
                            {errorHere ? (
                              <div style={{ fontSize: 9, lineHeight: 1.2, color: "#DC2626", fontWeight: 700, textAlign: "center" }}>
                                {errorHere}
                              </div>
                            ) : null}
                          </div>
                        );
                      }

                      return (
                        <div key={week} style={{ padding: "12px 1px", borderLeft: "1px solid #F8FAFC", display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "center", gap: 2, background: tone?.colBg }}>
                          {active ? (
                            <div
                              role={editable ? "button" : undefined}
                              tabIndex={editable ? 0 : undefined}
                              onClick={editable ? () => openEditor(project.id, week, index) : undefined}
                              onKeyDown={editable ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  openEditor(project.id, week, index);
                                }
                              } : undefined}
                              title={editable
                                ? `Edit ${project.name} · week of ${weekLabel} · ${formatHours(hours)}h`
                                : `${project.name} · week of ${weekLabel} · ${formatHours(hours)}h`}
                              style={{
                                width: "100%", height: 30, display: "flex", alignItems: "center", justifyContent: "center",
                                background: color.fill, color: color.text, fontSize: 11, fontWeight: 800,
                                borderRadius: `${before > 0 ? 0 : 9}px ${after > 0 ? 0 : 9}px ${after > 0 ? 0 : 9}px ${before > 0 ? 0 : 9}px`,
                                boxShadow: "0 1px 3px rgba(0,0,0,0.14)",
                                cursor: editable ? "pointer" : "default",
                                outline: "none",
                              }}
                            >
                              {formatHours(hours)}h
                            </div>
                          ) : editable ? (
                            <button
                              type="button"
                              onClick={() => openEditor(project.id, week, index)}
                              title={`Add hours · ${project.name} · week of ${weekLabel}`}
                              aria-label={`Add hours for ${project.name}, week of ${weekLabel}`}
                              style={{
                                width: "100%", height: 30, display: "flex", alignItems: "center", justifyContent: "center",
                                background: "transparent", color: "#CBD5E1", fontSize: 12, fontWeight: 700,
                                border: "1px dashed #CBD5E1", borderRadius: 9, cursor: "pointer",
                              }}
                            >
                              +
                            </button>
                          ) : null}
                          {errorHere ? (
                            <div style={{ fontSize: 9, lineHeight: 1.2, color: "#DC2626", fontWeight: 700, textAlign: "center" }}>
                              {errorHere}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", padding: "11px 18px", borderTop: "1px solid #E2E8F0", background: "#F8FAFC" }}>
          <button type="button" onClick={onClose} style={{ border: "1px solid #D5DEE5", borderRadius: 8, background: "#FFFFFF", color: "#64748B", padding: "7px 18px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
