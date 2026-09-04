import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, Clock, ExternalLink, Lock, Search, UserPlus, Users, X } from "lucide-react";
import { PhaseCardsStrip } from "@/components/PhaseCardsStrip";
import { SimpleTeamTable } from "@/components/SimpleTeamTable";
import { TeamGantt } from "@/components/TeamGantt";
import { TeamScheduleGrid } from "@/components/TeamScheduleGrid";
import { TeamViewModePicker, type TeamViewModePickerHandle } from "@/components/TeamViewModePicker";
import type { ExistingAllocationRef } from "@/hooks/useAssignMemberCascade";
import type { OpenRole, ProjectTeamMember } from "@/lib/api";
import { loadBusinessRules } from "@/lib/businessRules";
import { getDisplayModeForRecord, useProjectViewModeVersion } from "@/lib/projectViewMode";
import { Z } from "@/lib/zLayers";
import type { Allocation } from "@/pages/project-detail";

interface QuickActionsTeamModalProps {
  open: boolean;
  projectId: string;
  projectName: string;
  module: "PMM" | "OPM";
  projectStartDate: string;
  projectEndDate: string;
  team: ProjectTeamMember[];
  openRoles: OpenRole[];
  existingAllocations: ExistingAllocationRef[];
  canEdit: boolean;
  canManageStaff: boolean;
  /** Phase-schedule bounds (when a schedule exists) — forwarded so the grid
      applies the same date rules as the Project Detail schedule tab. */
  scheduleStart?: string;
  scheduleEnd?: string;
  onClose: () => void;
  onOpenProject: () => void;
  onReload: () => void;
  /** Opens the host's Add Team Member popup. `seed` carries the person picked
      from the grid's toolbar "Search & add member…" box so the popup opens
      with them pre-selected — identical to the Project Detail schedule tab. */
  onAddMember: (seed?: { personId: string; personName: string; title: string }) => void;
  /** Gate for the grid's toolbar (Add member button + member search) and the
      optimistic insert after an add — mirrors what project-detail passes. */
  onMemberAdded?: (
    personName: string,
    optimistic?: { id: string; role: string; bu: string; title: string; startDate: string; endDate: string; pct: number; hours?: number },
  ) => void;
  onAddOpenPosition: () => void;
  onToggleFlag?: (m: ProjectTeamMember, flag: "soft" | "nc" | "locked", value: boolean, costRate?: number) => Promise<boolean>;
  /** Manage-staff removal paths — the grid hosts the shared audit-log confirm
      popup itself; presence of the handler is the UI gate (same as the
      Project Detail team surfaces). */
  onRemoveMember?: (m: ProjectTeamMember) => Promise<void> | void;
  onRemoveOpenPosition?: (r: OpenRole) => Promise<void> | void;
  /** Pencil click in the no-grid / summary tables — opens the host's Edit
      Assignment popup (same one Project Detail uses). `period` scopes the
      edit to one row of a multi-period assignment. */
  onEditMember?: (a: Allocation, period?: { startDate: string; endDate: string; hours: number; rwiId?: number | null }) => void;
}

const V = {
  text: "var(--rm-text)",
  muted: "var(--rm-text-muted)",
  border: "var(--rm-panel-border)",
  green: "var(--rm-green, #6BA539)",
};

/**
 * The Quick Actions team view mirrors the Project Detail team card exactly:
 * the tenant/per-record display mode (Settings → "Visible sections") decides
 * whether the weekly-hours TeamScheduleGrid, the no-grid table/Gantt pair, or
 * the summary-only table renders — with the same Team View / Gantt / Table
 * switchers and per-record layout picker.
 */
export function QuickActionsTeamModal({
  open,
  projectId,
  projectName,
  module,
  projectStartDate,
  projectEndDate,
  team,
  openRoles,
  existingAllocations,
  canEdit,
  canManageStaff,
  scheduleStart,
  scheduleEnd,
  onClose,
  onOpenProject,
  onReload,
  onAddMember,
  onMemberAdded,
  onAddOpenPosition,
  onToggleFlag,
  onRemoveMember,
  onRemoveOpenPosition,
  onEditMember,
}: QuickActionsTeamModalProps) {
  // Re-render when the per-record layout picker changes the mode.
  useProjectViewModeVersion();

  // Settings can change between visits — refresh the business rules when the
  // popup opens so the display mode matches what Settings shows right now
  // (project-detail does the same on mount).
  const [, setRulesTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadBusinessRules()
      .catch(() => null)
      .then(() => { if (alive) setRulesTick((t) => t + 1); });
    return () => { alive = false; };
  }, [open]);

  const [teamViewTab, setTeamViewTab] = useState<"list" | "schedule">("schedule");
  const [noGridView, setNoGridView] = useState<"table" | "gantt">("table");
  const layoutPickerRef = useRef<TeamViewModePickerHandle>(null);
  const [teamSearch, setTeamSearch] = useState("");

  const displayMode = getDisplayModeForRecord(projectId, module);
  const noGridMode = displayMode === "no-schedule-no-grid" || displayMode === "schedule-no-grid";
  const summaryOnlyMode = displayMode === "no-schedule-no-hours";
  // A layout selection should show the table right away, even when this
  // popup was reopened after the project had previously been left on Gantt.
  useEffect(() => {
    if (noGridMode) setNoGridView("table");
  }, [noGridMode]);

  // The table/Gantt views take the Project Detail `Allocation` shape — build
  // it from the team payload the same way project-detail does.
  const allocations = useMemo<Allocation[]>(() => team.map((tm) => ({
    name: tm.name,
    role: tm.role || "",
    title: tm.title || "",
    dept: tm.dept ?? "",
    pct: tm.pctAllocation ?? 0,
    startDate: tm.startDate,
    endDate: tm.endDate,
    eacHrs: tm.eacHrs ?? 0,
    etcHrs: tm.etcHrs ?? 0,
    costRate: tm.costRate ?? 0,
    laborRate: tm.laborRate ?? 0,
    eacCost: tm.eacCost ?? 0,
    etcCost: tm.etcCost ?? 0,
    ncHrs: tm.ncHrs ?? 0,
    ncCost: tm.ncCost ?? 0,
    ncRate: tm.ncRate ?? 0,
    hasWeeklyHours: (tm.weeklyHours?.length ?? 0) > 0 || (tm.eacHrs ?? 0) > 0 || (tm.etcHrs ?? 0) > 0,
    weeklyHours: tm.weeklyHours ?? [],
    bu: tm.bu ?? "",
    divisionId: (tm as { divisionId?: string }).divisionId ?? "",
    memberBu: tm.memberBu ?? "",
    email: "",
    resourceId: tm.resourceId ?? "",
    rwiId: tm.rwiId ?? undefined,
    employeeType: tm.employeeType ?? "",
    softAllocation: tm.softAllocation === true,
    nonChargeable: tm.nonChargeable === true,
    isLocked: tm.isLocked === true,
    slices: tm.slices,
    weekHrsBasis: (tm as { weekHrsBasis?: number }).weekHrsBasis,
  })), [team]);

  if (!open) return null;

  // The host's handlers take the raw team-payload member — map the table's
  // Allocation back to it. GUID match runs as its own pass FIRST so a
  // same-named earlier row can never shadow the real person (duplicate-name
  // identity rule); the name fallback only applies when no GUID matches.
  const findMember = (ref: { name: string; resourceId?: string }): ProjectTeamMember | undefined => {
    if (ref.resourceId) {
      const byGuid = team.find((tm) => tm.resourceId === ref.resourceId);
      if (byGuid) return byGuid;
    }
    return team.find((tm) => tm.name === ref.name);
  };

  const handleRemoveAlloc = onRemoveMember
    ? async (a: Allocation) => { const tm = findMember(a); if (tm) await onRemoveMember(tm); }
    : undefined;
  const handleToggleLock = onToggleFlag
    ? async (m: { name: string; resourceId?: string }, locked: boolean) => {
        const tm = findMember(m);
        return tm ? onToggleFlag(tm, "locked", locked) : false;
      }
    : undefined;
  const handleToggleFlagRef = onToggleFlag
    ? async (m: { name: string; resourceId?: string }, flag: "soft" | "nc" | "locked", value: boolean) => {
        const tm = findMember(m);
        return tm ? onToggleFlag(tm, flag, value) : false;
      }
    : undefined;

  const searchBox = (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 10,
      backgroundColor: "var(--rm-panel-soft)", borderRadius: 10, border: `1px solid ${V.border}`,
    }}>
      <Search size={14} color={V.muted} />
      <input
        type="text" placeholder="Search team member..." value={teamSearch}
        onChange={(e) => setTeamSearch(e.target.value)}
        style={{ flex: 1, background: "transparent", border: "none", color: V.text, fontSize: 13, outline: "none" }}
      />
      {teamSearch.length > 0 && (
        <button onClick={() => setTeamSearch("")} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
          <X size={14} color={V.muted} />
        </button>
      )}
    </div>
  );

  const addMemberButton = canManageStaff ? (
    <button type="button" style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      padding: "8px 14px", backgroundColor: V.green, color: "#FFF", border: "none",
      borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer",
    }} onClick={() => onAddMember()}>
      <UserPlus size={12} /> Add Member
    </button>
  ) : (
    <div style={{
      display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
      backgroundColor: "var(--rm-panel-soft)", borderRadius: 8, border: `1px solid ${V.border}`,
      fontSize: 11, color: V.muted, fontWeight: 600,
    }}>
      <Lock size={11} color={V.muted} /> View only
    </div>
  );

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Project team for ${projectName}`}
      className="fixed inset-0 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-6"
      style={{ zIndex: Z.MODAL }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="flex max-h-[min(92vh,980px)] w-full max-w-[1480px] flex-col overflow-hidden rounded-2xl border border-[var(--rm-panel-border)] bg-[var(--rm-panel)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--rm-panel-border)] bg-[var(--rm-bg)] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--rm-text-faint)]">
              Project team
            </p>
            <h2 className="mt-1 truncate text-lg font-bold">{projectName}</h2>
            <p className="mt-1 text-xs text-[var(--rm-text-muted)]">
              {team.length} assigned · {openRoles.length} open position{openRoles.length === 1 ? "" : "s"}
              {!canManageStaff && " · Staffing view only"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onOpenProject}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--rm-green)]/40 bg-[var(--rm-green)]/10 px-3 py-2 text-xs font-bold text-[var(--rm-green)] transition hover:bg-[var(--rm-green)]/20"
              data-testid="quick-actions-open-project"
            >
              Open project
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close project team"
              className="rounded-lg border border-[var(--rm-panel-border)] bg-[var(--rm-panel)] p-2 text-[var(--rm-text-muted)] transition hover:text-[var(--rm-text)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-5">
          {/* ── No-grid modes: Add Member + layout picker + Table/Gantt toggle ── */}
          {noGridMode && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
              {addMemberButton}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TeamViewModePicker ref={layoutPickerRef} key={projectId} recordId={projectId} module={module} variant="pill" />
                <div style={{ display: "flex", gap: 2, backgroundColor: "var(--rm-panel-soft)", borderRadius: 8, padding: 3, border: `1px solid ${V.border}` }}>
                  {([
                    { key: "table" as const, label: "Table View", Icon: Users },
                    { key: "gantt" as const, label: "Gantt View", Icon: Calendar },
                  ] as const).map(({ key, label, Icon }) => {
                    const active = noGridView === key;
                    return (
                      <button
                        type="button"
                        key={key}
                        title={active && key === "table" ? "Table View is selected — open layout options" : `Show ${label}`}
                        aria-pressed={active}
                        onClick={() => {
                          setNoGridView(key);
                          if (active && key === "table") layoutPickerRef.current?.open();
                        }}
                        style={{
                        display: "flex", alignItems: "center", gap: 5,
                        padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                        fontSize: 11, fontWeight: 600,
                        backgroundColor: active ? V.green : "transparent",
                        color: active ? "#FFF" : V.muted,
                        transition: "background 0.15s, color 0.15s",
                        whiteSpace: "nowrap",
                      }}>
                        <Icon size={11} /> {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── Summary-only mode: Add Member + layout picker ── */}
          {summaryOnlyMode && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
              {addMemberButton}
              <TeamViewModePicker key={projectId} recordId={projectId} module={module} variant="pill" />
            </div>
          )}

          {/* ── Normal modes: Team View / Gantt View tab switcher. Add Member
              stays available on the Gantt tab (the grid tab has its own
              toolbar) — same as Project Detail. ── */}
          {!noGridMode && !summaryOnlyMode && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
              <div>{teamViewTab === "list" ? addMemberButton : null}</div>
              <div style={{ display: "flex", gap: 2, backgroundColor: "var(--rm-panel-soft)", borderRadius: 8, padding: 3, border: `1px solid ${V.border}` }}>
                <TeamViewModePicker
                  key={projectId}
                  recordId={projectId}
                  module={module}
                  variant="tab"
                  tabLabel="Team View"
                  TabIcon={displayMode === "no-schedule" ? Clock : Calendar}
                  tabActive={teamViewTab === "schedule"}
                  onTabSelect={() => setTeamViewTab("schedule")}
                />
                <button onClick={() => setTeamViewTab("list")} style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                  fontSize: 11, fontWeight: 600,
                  backgroundColor: teamViewTab === "list" ? V.green : "transparent",
                  color: teamViewTab === "list" ? "#FFF" : V.muted,
                  transition: "background 0.15s, color 0.15s",
                  whiteSpace: "nowrap",
                }}>
                  <Users size={11} /> Gantt View
                </button>
              </div>
            </div>
          )}

          {/* ── No-grid Table view ── */}
          {noGridMode && noGridView === "table" && (<>
            {searchBox}
            {displayMode === "schedule-no-grid" && (
              <PhaseCardsStrip projectId={projectId} canEdit={canEdit} />
            )}
            <SimpleTeamTable
              allocations={allocations}
              searchQuery={teamSearch}
              module={module}
              projectId={displayMode === "schedule-no-grid" ? projectId : undefined}
              canEdit={canManageStaff}
              onEditMember={canManageStaff ? onEditMember : undefined}
              onRemoveMember={handleRemoveAlloc}
              canUnlock={canManageStaff}
              onToggleLock={handleToggleLock}
            />
          </>)}

          {/* ── No-grid Gantt view ── */}
          {noGridMode && noGridView === "gantt" && (<>
            {searchBox}
            {displayMode === "schedule-no-grid" && (
              <PhaseCardsStrip projectId={projectId} canEdit={canEdit} />
            )}
            <TeamGantt
              allocations={allocations}
              searchQuery={teamSearch}
              openRoles={openRoles}
              projectId={projectId}
              module={module}
              scheduleStart={scheduleStart || ""}
              scheduleEnd={scheduleEnd || ""}
              hideHours={false}
              hideSchedule={displayMode === "no-schedule-no-grid"}
              canEdit={canManageStaff}
              onRemoveMember={handleRemoveAlloc}
              canUnlock={canManageStaff}
              onToggleLock={handleToggleLock}
              onToggleFlag={handleToggleFlagRef}
              onRemoveOpenPosition={onRemoveOpenPosition}
              onReload={onReload}
            />
          </>)}

          {/* ── Summary Only: names + roles table, no dates/hours, no Gantt ── */}
          {summaryOnlyMode && (<>
            {searchBox}
            <SimpleTeamTable
              allocations={allocations}
              searchQuery={teamSearch}
              hideDates
              hideHours
              module={module}
              canEdit={canManageStaff}
              onEditMember={canManageStaff ? onEditMember : undefined}
              onRemoveMember={handleRemoveAlloc}
              canUnlock={canManageStaff}
              onToggleLock={handleToggleLock}
            />
          </>)}

          {/* ── Normal modes: Gantt view (list tab) ── */}
          {!noGridMode && !summaryOnlyMode && teamViewTab === "list" && (<>
            {searchBox}
            {/* Phase overview cards (read-only) above the Gantt — same as Project Detail */}
            <TeamScheduleGrid
              overviewOnly
              modalScrollOwner
              projectId={projectId}
              forceFreshTeam
              module={module}
              canEdit={false}
              hideSchedule={displayMode === "no-schedule"}
            />
            <TeamGantt
              allocations={allocations}
              searchQuery={teamSearch}
              openRoles={openRoles}
              projectId={projectId}
              module={module}
              scheduleStart={scheduleStart || ""}
              scheduleEnd={scheduleEnd || ""}
              hideHours={false}
              hideSchedule={displayMode === "no-schedule"}
              canEdit={canManageStaff}
              onRemoveMember={handleRemoveAlloc}
              canUnlock={canManageStaff}
              onToggleLock={handleToggleLock}
              onToggleFlag={handleToggleFlagRef}
              onRemoveOpenPosition={onRemoveOpenPosition}
              onReload={onReload}
            />
          </>)}

          {/* ── Normal modes: weekly-hours schedule grid (Team View tab) ── */}
          {!noGridMode && !summaryOnlyMode && teamViewTab === "schedule" && (
            <TeamScheduleGrid
              modalScrollOwner
              projectId={projectId}
              forceFreshTeam
              module={module}
              canEdit={canManageStaff}
              canUnlock={canManageStaff}
              hideSchedule={displayMode === "no-schedule"}
              projectName={projectName}
              projectStartDate={projectStartDate}
              projectEndDate={projectEndDate}
              scheduleStart={scheduleStart}
              scheduleEnd={scheduleEnd}
              existingAllocations={existingAllocations}
              openRoles={openRoles}
              onAddMember={canManageStaff ? onAddMember : undefined}
              onMemberAdded={canManageStaff ? onMemberAdded : undefined}
              onAddOpenPosition={canManageStaff ? onAddOpenPosition : undefined}
              onReload={onReload}
              onToggleFlag={onToggleFlag}
              onRemoveMember={onRemoveMember}
              onRemoveOpenPosition={onRemoveOpenPosition}
            />
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
