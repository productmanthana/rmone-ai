// InlineAddMemberRow — Excel-style "add a row" strip that sits directly under
// the Team weekly-hours grid. Collapsed it is a single "+ Add member" line;
// expanded it becomes a compact field strip (Business Unit → Division →
// Department → Title → Role → Person, plus dates when the project has no
// phase schedule). All cascade logic, duplicate guards and the submit path are
// shared with AddTeamMemberModal via useAssignMemberCascade — this component
// is presentation only.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X, Check, Search, ChevronDown, Loader2 } from "lucide-react";
import { getBusinessRules } from "@/lib/businessRules";
import { getDisplayModeForRecord, useProjectViewModeVersion } from "@/lib/projectViewMode";
import { ScheduleWindowTip } from "@/components/ScheduleWindowTip";
import DateField from "@/components/DateField";
import { BuMismatchPopup } from "@/components/BuMismatchPopup";
import type { OpenRole } from "@/lib/api";
import {
  useAssignMemberCascade,
  type ExistingAllocationRef,
  type Picker,
} from "@/hooks/useAssignMemberCascade";
import { Z } from "@/lib/zLayers";

const C = {
  panel:  "var(--rm-panel)",
  soft:   "var(--rm-panel-soft)",
  border: "var(--rm-panel-border)",
  text:   "var(--rm-text)",
  muted:  "var(--rm-text-muted)",
  faint:  "var(--rm-text-faint)",
  green:  "var(--rm-green)",
};

export interface InlineAddMemberRowProps {
  projectId: string;
  /** Record module ("PMM" / "OPM" / "LEM") — used to resolve the record's
   *  display mode (per-record overrides included) for the schedule-window
   *  rule. Omitted → project-module fallback, same as the modal. */
  module?: string | null;
  projectName: string;
  projectStartDate: string;
  projectEndDate: string;
  /** Pass ONLY when the project has a phase schedule (same contract as the modal). */
  scheduleStart?: string;
  scheduleEnd?: string;
  existingAllocations: ExistingAllocationRef[];
  onAssigned: (personName: string, optimistic?: { id: string; role: string; bu: string; title: string; startDate: string; endDate: string; pct: number; hours?: number }) => void;
  /** Show Start/End date inputs (projectDisplayMode === "no-schedule"). */
  showDates?: boolean;
  /** "strip" (default) = self-contained collapsed/expanded strip.
   *  "gridRow" = always-open row whose org fields align 1:1 under the weekly
   *  grid's frozen columns; the PARENT owns open/close via onCancel. */
  variant?: "strip" | "gridRow";
  /** Frozen-column layout of the weekly grid (ordered keys + pixel widths).
   *  Required for variant="gridRow" so each field lands under its column. */
  gridCols?: { key: string; w: number }[];
  /** gridRow only: called when the user closes the row (X / Esc / submit). */
  onCancel?: () => void;
  /** Pre-select a person (e.g. picked from the toolbar member search). The
   *  cascade seeds Person + Title; the user still picks Division / Role. */
  prefillPersonId?: string;
  prefillPersonName?: string;
  prefillTitle?: string;
  /** Open positions on this project — shown as one-click suggestion chips. */
  openRoles?: OpenRole[];
}

export function InlineAddMemberRow({
  projectId, module, projectName, projectStartDate, projectEndDate,
  scheduleStart, scheduleEnd, existingAllocations, onAssigned, showDates,
  variant = "strip", gridCols, onCancel,
  prefillPersonId, prefillPersonName, prefillTitle, openRoles,
}: InlineAddMemberRowProps) {
  // Record-resolved schedule-window rule — same resolution the modal applies
  // (per-record display-mode overrides included), instead of the legacy
  // tenant-global "full"-only fallback. The row only renders on weekly-grid
  // surfaces, but a record overridden to a schedule mode on a grid tenant
  // must still bind member dates to the phase schedule — client-side here
  // AND server-side via the flag the cascade forwards with the save.
  useProjectViewModeVersion();
  const resolvedMode = getDisplayModeForRecord(projectId, module);
  const scheduleWindowEnabled = resolvedMode === "full" || resolvedMode === "schedule-no-grid";
  const isGridRow = variant === "gridRow" && Array.isArray(gridCols) && gridCols.length > 0;
  const [expanded, setExpanded] = useState(false);
  // gridRow rows are mounted only while open, so they are always "expanded".
  const isOpen = isGridRow ? true : expanded;
  const collapse = () => { if (isGridRow) onCancel?.(); else setExpanded(false); };
  // Anchor rect for the floating dropdown (fixed-position portal).
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number } | null>(null);
  // gridRow: the frozen pane the helper card (dates / errors) anchors below.
  const rowPaneRef = useRef<HTMLDivElement | null>(null);
  const [cardPos, setCardPos] = useState<{ x: number; y: number } | null>(null);

  const cascade = useAssignMemberCascade({
    active: isOpen,
    onClose: collapse,
    projectId, projectName, projectStartDate, projectEndDate,
    scheduleStart, scheduleEnd, existingAllocations, onAssigned,
    prefillPersonId, prefillPersonName, prefillTitle, openRoles,
    scheduleWindowEnabled,
  });
  const {
    loading, submitting, error, setError,
    buEntities, businessUnit, bus, bu, deptName, filteredDepartments,
    role, title, personName,
    startDate, setStartDate, endDate, setEndDate,
    picker, setPicker, search, setSearch,
    showAllPeople, setShowAllPeople,
    displayPeople, filteredPeople, usingOfficialPeople,
    relatedPeopleCount, peopleCount,
    dupeOnSubmit, canSubmit,
    hasScheduleWindow, schedStartYmd, schedEndYmd, schedWindowLabel,
    suggestions, pickedSuggestion, applySuggestion,
    orgLocked, unlockOrg, availLoading,
    buMismatch, addingBu, buMismatchError, addBuToProject, dismissBuMismatch, projectBuLabels,
    submit, pickerData, pickerTitle, applyPick,
  } = cascade;

  const rules = getBusinessRules();
  const showBuField = buEntities.length > 0 && rules.showBusinessUnit;
  // Department is gated on the business rule ONLY — not on the currently
  // filtered list (which is empty until a Division is picked, which used to
  // hide the field entirely and made Dept look "missing" from the form).
  const showDeptField = rules.showDepartment;
  // Out-of-window check for the VISIBLE date fields — same fallback chain the
  // cascade's submit guard uses, so the warning always matches what a save
  // would send. Typed dates are NOT silently clamped (clampTyped is off on
  // both fields); an out-of-window value warns and blocks Add instead.
  const effStartYmd = (startDate || projectStartDate || "").slice(0, 10);
  const effEndYmd = (endDate || projectEndDate || "").slice(0, 10);
  const dateWindowIssue = hasScheduleWindow && (
    !!(schedStartYmd && effStartYmd && effStartYmd < schedStartYmd) ||
    !!(schedEndYmd && effEndYmd && effEndYmd > schedEndYmd)
  );
  // Blocks Add while dates sit outside the schedule (mirrors the modal).
  const submitOk = canSubmit && !dateWindowIssue;

  // Esc: close the dropdown first, then collapse the whole row.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (picker) { setPicker(null); setSearch(""); setAnchor(null); }
      else collapse();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, picker, setPicker, setSearch]);

  // gridRow: keep the floating helper card glued below the frozen pane while
  // the page scrolls or resizes (fixed-position portal, like the dropdown).
  useEffect(() => {
    if (!isGridRow) return;
    const measure = () => {
      const r = rowPaneRef.current?.getBoundingClientRect();
      if (r) setCardPos({ x: r.left, y: r.bottom + 4 });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [isGridRow, error, dupeOnSubmit, showDates, loading]);

  const openPicker = (p: Exclude<Picker, null>, e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAnchor({ x: r.left, y: r.bottom + 4, w: Math.max(r.width, 250) });
    setPicker(p);
    setSearch("");
  };
  const closePicker = () => { setPicker(null); setSearch(""); setAnchor(null); };

  if (!isGridRow && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="tsg-add-member-cta"
        aria-expanded={expanded}
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          padding: "9px 12px", background: "transparent",
          border: "none", borderTop: `1px dashed ${C.border}`,
          color: C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer",
          textAlign: "left",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = String(C.green); }}
        onMouseLeave={(e) => { e.currentTarget.style.color = String(C.muted); }}
      >
        <Plus size={13} /> Add member
      </button>
    );
  }

  const fieldBtn = (label: string, value: string, required: boolean, onPress: (e: React.MouseEvent<HTMLButtonElement>) => void) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 110, flex: "1 1 130px", maxWidth: 200 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: C.faint }}>
        {label}{required ? " *" : ""}
      </div>
      <button
        onClick={onPress}
        style={{
          display: "flex", alignItems: "center", gap: 4, width: "100%",
          padding: "6px 8px", borderRadius: 7, fontSize: 12,
          fontWeight: value ? 600 : 500, textAlign: "left",
          color: value ? C.text : C.faint,
          backgroundColor: C.soft,
          border: `1px solid ${value ? C.green : C.border}`,
          cursor: "pointer",
        }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value || "Select"}
        </span>
        <ChevronDown size={12} color={value ? String(C.green) : String(C.faint)} style={{ flexShrink: 0 }} />
      </button>
    </div>
  );

  const dateInput = (label: string, value: string, set: (v: string) => void) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 120, flex: "0 1 140px" }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: C.faint }}>{label}</div>
      <ScheduleWindowTip active={hasScheduleWindow} windowLabel={schedWindowLabel}>
        <DateField
          value={value}
          min={hasScheduleWindow ? (schedStartYmd || undefined) : undefined}
          max={hasScheduleWindow ? (schedEndYmd || undefined) : undefined}
          // Typed out-of-window dates stay visible — warned + blocked via
          // dateWindowIssue, never silently snapped into the window.
          clampTyped={false}
          onChange={set}
          compact
          style={{
            padding: "5px 8px",
            borderRadius: 7, fontSize: 12, fontWeight: value ? 600 : 500,
            color: value ? C.text : C.faint, backgroundColor: C.soft,
            border: `1px solid ${value ? C.green : C.border}`,
          }}
        />
      </ScheduleWindowTip>
    </div>
  );

  // Open-position suggestion chips ("this project needs …") — one click
  // pre-fills Role/Title/dates and retargets the save to consume that slot.
  const suggestionChips = suggestions.length > 0 ? (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: C.faint }}>
        Needs
      </span>
      {suggestions.map((s, i) => {
        const sel = i === pickedSuggestion;
        const main = s.role || s.title;
        const extra = s.title && s.role && s.title.toLowerCase() !== s.role.toLowerCase() ? s.title : "";
        return (
          <button key={`${main}-${i}`} onClick={() => applySuggestion(i)} style={{
            padding: "3px 9px", borderRadius: 999, fontSize: 10, fontWeight: 600,
            cursor: "pointer",
            border: `1px solid ${sel ? C.green : C.border}`,
            backgroundColor: sel ? "rgba(107,165,57,0.14)" : "transparent",
            color: sel ? C.green : C.text,
          }}>{main}{extra ? ` · ${extra}` : ""}</button>
        );
      })}
    </div>
  ) : null;

  // Org fields lock after a person pick auto-fills them from the staff
  // profile; clicking a locked field unlocks the section AND opens the picker.
  const openOrgPicker = (p: Exclude<Picker, null>, e: React.MouseEvent<HTMLButtonElement>) => {
    if (orgLocked) unlockOrg();
    openPicker(p, e);
  };

  // BU-mismatch popup — picked person's home BU is not one of the project's
  // BUs. Portaled to <body> (zIndex above the picker dropdown), shared with
  // the modal flow via BuMismatchPopup.
  const buPopup = buMismatch ? (
    <BuMismatchPopup
      personName={buMismatch.personName}
      buLabel={buMismatch.divisionLabel}
      projectBuLabels={projectBuLabels}
      adding={addingBu}
      error={buMismatchError}
      onAdd={addBuToProject}
      onCancel={dismissBuMismatch}
    />
  ) : null;

  // Dropdown panel geometry — clamp inside the viewport; flip upward when the
  // space below the anchor is too small.
  let panel: React.ReactNode = null;
  if (picker && anchor && typeof document !== "undefined") {
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(Math.max(anchor.w, 250), vw - 16);
    const left = Math.min(anchor.x, vw - w - 8);
    const spaceBelow = vh - anchor.y - 12;
    const maxH = Math.min(340, Math.max(spaceBelow, 160));
    const top = spaceBelow >= 160 ? anchor.y : Math.max(8, anchor.y - maxH - 40);
    const rows = pickerData().filter((d) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return d.label.toLowerCase().includes(q) || (d.sub && d.sub.toLowerCase().includes(q));
    });
    panel = createPortal(
      <>
        {/* Above the gridRow helper card (zIndex 9000) so options never hide */}
        <div onClick={closePicker} style={{ position: "fixed", inset: 0, zIndex: Z.DRAWER_PICKER_BACKDROP }} />
        <div style={{
          position: "fixed", left, top, width: w, zIndex: Z.DRAWER_PICKER,
          backgroundColor: C.panel, border: `1px solid ${C.border}`,
          borderRadius: 10, boxShadow: "0 10px 34px rgba(0,0,0,0.45)",
          display: "flex", flexDirection: "column", overflow: "hidden", maxHeight: maxH,
        }}>
          <div style={{
            display: "flex", alignItems: "center", padding: "8px 10px",
            borderBottom: `1px solid ${C.border}`, gap: 6,
          }}>
            <div style={{ flex: 1, fontWeight: 700, fontSize: 11, color: C.text }}>{pickerTitle()}</div>
            <button onClick={closePicker} aria-label="Close picker"
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: 2, color: C.muted }}>
              <X size={14} />
            </button>
          </div>
          {(picker === "person" || pickerData().length > 8) && (
            <div style={{
              display: "flex", alignItems: "center", margin: 8, marginBottom: 0,
              padding: "0 8px", backgroundColor: C.soft,
              borderRadius: 7, border: `1px solid ${C.border}`,
            }}>
              <Search size={12} color={String(C.muted)} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                autoFocus
                style={{
                  flex: 1, padding: 7, fontSize: 12, color: C.text,
                  backgroundColor: "transparent", border: "none", outline: "none",
                }}
              />
            </div>
          )}
          {picker === "person" && availLoading && (
            <div style={{ margin: "6px 8px 0", fontSize: 10, color: C.muted }}>
              Checking availability…
            </div>
          )}
          {picker === "person" && usingOfficialPeople && (
            <div style={{ margin: "6px 8px 0", padding: "4px 8px", borderRadius: 6, fontSize: 10, color: C.muted, backgroundColor: "rgba(107,165,57,0.10)" }}>
              {displayPeople.length} matched to "{title || role}"
            </div>
          )}
          {picker === "person" && !usingOfficialPeople && (role || title) && (
            relatedPeopleCount === 0 && !showAllPeople ? (
              /* Nothing matches the chosen Role/Title: say so explicitly
                 instead of silently flipping to the full staff list. */
              <div style={{
                margin: "6px 8px 0", padding: "6px 8px", borderRadius: 6, fontSize: 10, color: C.text,
                backgroundColor: "rgba(232,119,34,0.12)", border: "1px solid rgba(232,119,34,0.35)",
              }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  No one in your staff list matches "{role || title}".
                </div>
                <button
                  onClick={() => setShowAllPeople(true)}
                  style={{
                    background: "transparent", border: `1px solid ${C.border}`,
                    borderRadius: 5, padding: "2px 8px", cursor: "pointer",
                    fontSize: 10, fontWeight: 600, color: C.green,
                  }}
                >Show all {peopleCount} people</button>
              </div>
            ) : (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                margin: "6px 8px 0", padding: "4px 8px", borderRadius: 6, fontSize: 10, color: C.muted,
                backgroundColor: showAllPeople ? "transparent" : "rgba(107,165,57,0.10)",
              }}>
                <span>{showAllPeople ? `Showing all ${filteredPeople.length} people` : `${filteredPeople.length} matching "${role || title}"`}</span>
                <button
                  onClick={() => setShowAllPeople(!showAllPeople)}
                  style={{
                    background: "transparent", border: `1px solid ${C.border}`,
                    borderRadius: 5, padding: "2px 8px", cursor: "pointer",
                    fontSize: 10, fontWeight: 600, color: C.green,
                  }}
                >{showAllPeople ? "Show Related" : "Show All"}</button>
              </div>
            )
          )}
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {rows.map((item) => (
              <button
                key={item.id}
                onClick={() => { applyPick(item.id, item.label); setAnchor(null); }}
                disabled={item.disabled}
                style={{
                  width: "100%", textAlign: "left", padding: "8px 10px",
                  background: "transparent", border: "none",
                  borderBottom: `1px solid ${C.border}`,
                  cursor: item.disabled ? "not-allowed" : "pointer",
                  opacity: item.disabled ? 0.55 : 1, color: C.text,
                }}
                onMouseEnter={(e) => { if (!item.disabled) e.currentTarget.style.backgroundColor = "rgba(107,165,57,0.14)"; }}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ flex: 1, fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.label}
                  </div>
                  {item.availLabel ? (() => {
                    const toneColor = item.availTone === "free" ? "#6BA539" : item.availTone === "tight" ? "#E87722" : "#C2410C";
                    return (
                      <div style={{
                        color: toneColor, fontSize: 9, fontWeight: 600, flexShrink: 0,
                        backgroundColor: `${toneColor}22`, padding: "2px 6px",
                        borderRadius: 5, whiteSpace: "nowrap",
                      }}>{item.availLabel}</div>
                    );
                  })() : null}
                  {item.alreadyOnTeam ? (
                    <div style={{
                      color: "#E85D4A", fontSize: 9, fontWeight: 600, flexShrink: 0,
                      backgroundColor: "rgba(232,93,74,0.14)", padding: "2px 6px", borderRadius: 5,
                    }}>{item.teamHours ? `On team · ${Math.round(item.teamHours)}h` : "Already on team"}</div>
                  ) : null}
                </div>
                {item.sub ? (
                  <div style={{ color: C.muted, fontSize: 10, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.sub}</div>
                ) : null}
              </button>
            ))}
            {rows.length === 0 && (
              <div style={{ padding: 18, textAlign: "center", color: C.muted, fontSize: 11 }}>No options</div>
            )}
          </div>
        </div>
      </>,
      document.body,
    );
  }

  // ── gridRow variant ────────────────────────────────────────────────────
  // Renders as one row of the weekly grid: a sticky frozen pane whose cells
  // sit EXACTLY under the grid's BU / DIVISION / DEPT / ROLE / NAME-TITLE
  // (and, in no-schedule mode, START / END date) columns. Add / Cancel live
  // in the pane's EAC-ETC-actions area so nothing floats under the week
  // columns; only overflow fields and error messages show in a small popup
  // card anchored just below the pane.
  if (isGridRow && gridCols) {
    const ACTION_KEYS = new Set(["etcHrs", "eacHrs", "etcCost", "eacCost", "act"]);
    const fieldCols = gridCols.filter((c) => !ACTION_KEYS.has(c.key));
    const actionW = Math.max(96, gridCols.filter((c) => ACTION_KEYS.has(c.key)).reduce((s, c) => s + c.w, 0));
    const FROZEN_W = gridCols.reduce((s, c) => s + c.w, 0);
    const hasCol = (k: string) => gridCols.some(c => c.key === k);
    const divLabel = bus.find((b) => b.id === bu)?.label || "";
    const buLabel = buEntities.find((b) => b.id === businessUnit)?.label || "";
    // When the grid provides START/END columns (no-schedule mode), dates are
    // picked inline in those cells — the helper card only carries overflow
    // fields and messages.
    const datesInGrid = !!showDates && hasCol("start") && hasCol("end");
    const needCard = !!error || dupeOnSubmit || dateWindowIssue || (!!showDates && !datesInGrid) ||
      (showBuField && !hasCol("bu")) || (showDeptField && !hasCol("dept")) ||
      suggestions.length > 0;

    const miniDate = (label: string, value: string, set: (v: string) => void) => (
      <ScheduleWindowTip active={hasScheduleWindow} windowLabel={schedWindowLabel} style={{ width: "100%", minWidth: 0 }}>
        <DateField
          value={value}
          // Suppress the native title tooltip when the custom schedule hint is
          // active — two stacked tooltips on hover would fight each other.
          title={hasScheduleWindow ? undefined : label}
          aria-label={label}
          min={hasScheduleWindow ? (schedStartYmd || undefined) : undefined}
          max={hasScheduleWindow ? (schedEndYmd || undefined) : undefined}
          // Same policy as the modal: typed out-of-window dates stay visible
          // and block the Add button instead of silently snapping in-window.
          clampTyped={false}
          onChange={set}
          compact
          style={{
            minWidth: 0, padding: "4px 3px",
            borderRadius: 6, fontSize: 10, fontWeight: value ? 600 : 500,
            color: value ? C.text : C.faint, backgroundColor: C.soft,
            border: `1px solid ${value ? C.green : C.border}`,
          }}
        />
      </ScheduleWindowTip>
    );

    const miniBtn = (value: string, placeholder: string, required: boolean, onPress: (e: React.MouseEvent<HTMLButtonElement>) => void) => (
      <button
        onClick={onPress}
        title={placeholder + (required ? " (required)" : "")}
        style={{
          display: "flex", alignItems: "center", gap: 3, width: "100%",
          padding: "4px 5px", borderRadius: 6, fontSize: 10,
          fontWeight: value ? 600 : 500, textAlign: "left",
          color: value ? C.text : C.faint,
          backgroundColor: C.soft,
          border: `1px solid ${value ? C.green : C.border}`,
          cursor: "pointer", minWidth: 0,
        }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value || `${placeholder}${required ? " *" : ""}`}
        </span>
        <ChevronDown size={10} color={value ? String(C.green) : String(C.faint)} style={{ flexShrink: 0 }} />
      </button>
    );

    const cellStyle = (w: number): React.CSSProperties => ({
      width: w, flexShrink: 0, padding: "5px 3px",
      borderRight: `1px solid ${C.border}`,
      display: "flex", flexDirection: "column", justifyContent: "center", gap: 4,
      minWidth: 0,
    });

    return (
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
        {/* Frozen pane — one cell per grid column, same widths, sticky left */}
        <div ref={rowPaneRef} style={{
          width: FROZEN_W, flexShrink: 0, display: "flex",
          position: "sticky", left: 0, zIndex: 2,
          backgroundColor: C.panel,
          borderRight: `1px solid ${C.border}`,
          boxShadow: `inset 0 0 0 1px ${C.green}`,
        }}>
          {fieldCols.map((c) => (
            <div key={c.key} style={cellStyle(c.w)}>
              {c.key === "bu" &&
                miniBtn(buLabel, "BU", false, (e) => openOrgPicker("businessUnit", e))}
              {c.key === "division" && rules.showDivision &&
                miniBtn(divLabel, "Division", true, (e) => openOrgPicker("bu", e))}
              {c.key === "dept" && showDeptField &&
                miniBtn(deptName, "Dept", false, (e) => { if (bu || !rules.showDivision) openOrgPicker("department", e); else setError("Pick a Division first."); })}
              {/* Role-first: Role / Title / Person open without a Division —
                  picking a person auto-fills + locks the org cells. */}
              {c.key === "role" &&
                miniBtn(role, "Role", true, (e) => openPicker("role", e))}
              {c.key === "name" && (
                <>
                  {miniBtn(personName, "Person", true, (e) => openPicker("person", e))}
                  {miniBtn(title, "Title", false, (e) => openPicker("title", e))}
                </>
              )}
              {c.key === "start" && showDates &&
                miniDate("Start Date", startDate, setStartDate)}
              {c.key === "end" && showDates &&
                miniDate("End Date", endDate, setEndDate)}
            </div>
          ))}
          {/* Add / Cancel sit in the EAC + ETC + actions area of the pane */}
          <div style={{
            width: actionW, flexShrink: 0, display: "flex",
            alignItems: "center", justifyContent: "center", gap: 4, padding: "0 3px",
          }}>
            <button
              disabled={!submitOk && !submitting}
              onClick={submit}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "5px 9px", borderRadius: 6, border: "none",
                backgroundColor: (submitOk || submitting) ? C.green : C.soft,
                color: (submitOk || submitting) ? "#FFF" : String(C.faint),
                fontSize: 10, fontWeight: 700,
                cursor: submitting ? "wait" : submitOk ? "pointer" : "not-allowed",
                flexShrink: 0,
              }}>
              {submitting ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              {submitting ? "Adding…" : "Add"}
            </button>
            {loading && <Loader2 size={11} color={String(C.muted)} className="animate-spin" style={{ flexShrink: 0 }} />}
            <button
              onClick={collapse}
              aria-label="Cancel add member"
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: 3, color: C.muted, flexShrink: 0 }}>
              <X size={13} />
            </button>
          </div>
        </div>
        {/* Week columns stay untouched — no controls under the dates */}
        <div style={{ flex: 1, minWidth: 0 }} />
        {/* Helper card — dates, overflow fields and messages in a popup */}
        {needCard && cardPos && createPortal(
          <div style={{
            position: "fixed", left: cardPos.x, top: cardPos.y, zIndex: Z.DRAWER,
            backgroundColor: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 10, boxShadow: "0 10px 26px rgba(0,0,0,0.22)",
            padding: "8px 10px", display: "flex", flexDirection: "column",
            gap: 6, maxWidth: 430,
          }}>
            {suggestionChips}
            {((showDates && !datesInGrid) || (showBuField && !hasCol("bu")) || (showDeptField && !hasCol("dept"))) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
                {showBuField && !hasCol("bu") &&
                  fieldBtn("Business Unit", buLabel, false, (e) => openOrgPicker("businessUnit", e))}
                {showDeptField && !hasCol("dept") &&
                  fieldBtn("Department", deptName, false, (e) => { if (bu || !rules.showDivision) openOrgPicker("department", e); else setError("Pick a Division first."); })}
                {showDates && !datesInGrid && dateInput("Start Date", startDate, setStartDate)}
                {showDates && !datesInGrid && dateInput("End Date", endDate, setEndDate)}
              </div>
            )}
            {dupeOnSubmit && (
              <div style={{ fontSize: 10, fontWeight: 600, color: "#E87722", maxWidth: 380 }}>
                This person is already on the team with the same Division, Role, and Title.
                Pick a different role or title to add another assignment.
              </div>
            )}
            {dateWindowIssue && (
              <div role="alert" style={{ fontSize: 10, fontWeight: 600, color: "#E87722", maxWidth: 380 }}>
                This project has a phase schedule — member dates must stay within {schedWindowLabel}.
              </div>
            )}
            {error && (
              <div style={{ fontSize: 10, fontWeight: 600, color: "#F87171", maxWidth: 380 }}>{error}</div>
            )}
          </div>,
          document.body,
        )}
        {panel}
        {buPopup}
      </div>
    );
  }

  return (
    <div style={{ borderTop: `1px dashed ${C.border}`, padding: "10px 12px 12px", backgroundColor: "var(--rm-now-bg, transparent)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <Plus size={12} color={String(C.green)} />
        <div style={{ fontSize: 11, fontWeight: 700, color: C.text }}>New team member</div>
        {loading && <Loader2 size={12} color={String(C.muted)} className="animate-spin" />}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setExpanded(false)}
          aria-label="Cancel add member"
          style={{ background: "transparent", border: "none", cursor: "pointer", padding: 2, color: C.muted }}>
          <X size={14} />
        </button>
      </div>
      {suggestionChips ? <div style={{ marginBottom: 8 }}>{suggestionChips}</div> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
        {/* Role-first order: Role / Title / Person lead; org fields follow and
            auto-fill + lock from the picked person's staff profile. */}
        {fieldBtn("Role", role, true,
          (e) => openPicker("role", e))}
        {fieldBtn("Title", title, false,
          (e) => openPicker("title", e))}
        {fieldBtn("Assigned To", personName, true,
          (e) => openPicker("person", e))}
        {showBuField && fieldBtn("Business Unit", buEntities.find((b) => b.id === businessUnit)?.label || "", false,
          (e) => openOrgPicker("businessUnit", e))}
        {rules.showDivision && fieldBtn("Division", bus.find((b) => b.id === bu)?.label || "", true,
          (e) => openOrgPicker("bu", e))}
        {showDeptField && fieldBtn("Department", deptName, false,
          (e) => { if (bu || !rules.showDivision) openOrgPicker("department", e); else setError("Pick a Division first."); })}
        {showDates && dateInput("Start Date", startDate, setStartDate)}
        {showDates && dateInput("End Date", endDate, setEndDate)}
        <button
          disabled={!submitOk && !submitting}
          onClick={submit}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "7px 14px", borderRadius: 7, border: "none",
            backgroundColor: (submitOk || submitting) ? C.green : C.soft,
            color: (submitOk || submitting) ? "#FFF" : String(C.faint),
            fontSize: 12, fontWeight: 700,
            cursor: submitting ? "wait" : submitOk ? "pointer" : "not-allowed",
            flex: "0 0 auto",
          }}>
          {submitting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {submitting ? "Adding…" : "Add"}
        </button>
      </div>
      {dupeOnSubmit && (
        <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: "#E87722" }}>
          This person is already on the team with the same Division, Role, and Title.
          Pick a different role or title to add another assignment.
        </div>
      )}
      {dateWindowIssue && (
        <div role="alert" style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: "#E87722" }}>
          This project has a phase schedule — member dates must stay within {schedWindowLabel}.
        </div>
      )}
      {error && (
        <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: "#F87171" }}>{error}</div>
      )}
      {panel}
      {buPopup}
    </div>
  );
}
