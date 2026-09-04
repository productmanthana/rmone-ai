// ─────────────────────────────────────────────────────────────────────────────
// PhaseCardsStrip — phase schedule cards for the "schedule-no-grid" display
// mode.
//
// Standalone on purpose: TeamScheduleGrid's overviewOnly cards return null
// when the team is empty/loading, but this mode must show the schedule even
// on a project with zero members. Dates need only /task-data, so this fetches
// exactly that (same parse pattern as TeamGantt).
//
// Editing: managers/admins (canEdit) can change each phase's start/end dates
// inline. The save path mirrors ScheduleTableWidget exactly — the FULL task
// array is POSTed via updateProjectSchedule with only the edited row's dates
// changed, lifecycleId resolved lazily (task-data header → project details).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState } from "react";
import { Check, Calendar, Pencil, Loader2, X } from "lucide-react";
import DateField from "@/components/DateField";
import {
  getTaskData, getTaskDataWithLifecycle, getProjectDetails,
  updateProjectSchedule, bustCache,
} from "@/lib/api";
import { notifyScheduleChanged } from "@/lib/chatBridge";
import { fmtPct } from "@/lib/utils";

const C = {
  text: "var(--rm-text)",
  muted: "var(--rm-text-muted)",
  faint: "var(--rm-text-faint)",
  border: "var(--rm-panel-border)",
  soft: "var(--rm-panel-soft)",
  panel: "var(--rm-panel)",
  green: "var(--rm-green, #6BA539)",
  red: "#E03C3C",
};

// Same palette as TeamScheduleGrid's phase cards — the strips must look alike.
const PHASE_COLORS = [
  "#38BDF8", "#818CF8", "#34D399", "#FB923C", "#A78BFA",
  "#F472B6", "#FBBF24", "#2DD4BF", "#84CC16", "#F87171",
];
const phaseColor = (idx: number) => PHASE_COLORS[idx % PHASE_COLORS.length];

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function parseISODate(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || s.startsWith("0001") || s.startsWith("1900")) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

function fmtShortDate(v: unknown): string {
  const d = parseISODate(v);
  if (!d) return "";
  return `${d.getDate()} ${MONTH_ABBR[d.getMonth()]} '${String(d.getFullYear()).slice(-2)}`;
}

/** "YYYY-MM-DD" day part, blank for sentinel/invalid dates. */
function dayOf(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s || s.startsWith("0001") || s.startsWith("1900")) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : "";
}

// Same shape ScheduleTableWidget POSTs — the server replaces the whole
// schedule, so every row must round-trip its existing fields.
interface RawTask {
  ID: number;
  Title: string;
  StartDate: string;
  DueDate: string;
  Status?: string;
  PercentComplete?: number;
  ItemOrder?: number;
  AssignedTo?: string;
  StageStep?: number;
}

// Duplicated from ScheduleTableWidget (module-local there) — resolves the
// lifecycle id from a project-details payload in any of its shapes.
function extractLifecycleId(proj: unknown): string {
  if (!proj || typeof proj !== "object") return "";
  const p = proj as any;
  const candidates: any[] = [p?.Data ?? p, p];
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const direct = c.ProjectLifeCycleLookup ?? c.ProjectLifecycleID ?? c.ProjectLifecycleId;
    if (direct !== undefined && direct !== null && String(direct) !== "") return String(direct);
    if (Array.isArray(c.Fields)) {
      const f = c.Fields.find((x: any) => x?.FieldName === "ProjectLifeCycleLookup" || x?.FieldName === "ProjectLifecycleID");
      if (f && f.Value !== undefined && f.Value !== null && String(f.Value) !== "") return String(f.Value);
    }
  }
  return "";
}

interface PhaseEntry {
  title: string;
  start: string;
  due: string;
  pct: number;
  order: number;
  /** Index into the raw task array (for building the save payload). */
  ri: number;
  /** Only rows with a real DB id can be edited (save round-trips by ID). */
  editable: boolean;
}

/** Normalize a raw /task-data response into round-trippable task rows. */
function mapRawTasks(res: unknown): RawTask[] {
  const raw = Array.isArray(res) ? (res as Record<string, unknown>[]) : [];
  return raw.map((p) => ({
    ID: Number(p.ID ?? 0),
    Title: String(p.Title ?? p.Alias ?? "").trim(),
    StartDate: String(p.StartDate ?? ""),
    DueDate: String(p.DueDate ?? p.EndDate ?? ""),
    Status: p.Status != null ? String(p.Status) : undefined,
    PercentComplete: Number(p.PercentComplete ?? 0) || 0,
    ItemOrder: Number(p.ItemOrder ?? p.StageStep ?? 0) || 0,
    AssignedTo: p.AssignedTo != null ? String(p.AssignedTo) : "",
    StageStep: Number(p.StageStep ?? p.ItemOrder ?? 0) || 0,
  }));
}

function buildPhases(tasks: RawTask[]): PhaseEntry[] {
  return tasks
    .map((t, ri) => ({
      title: t.Title,
      start: t.StartDate,
      due: t.DueDate,
      pct: Math.min(100, Math.max(0, Math.round(t.PercentComplete ?? 0))),
      order: t.ItemOrder ?? 0,
      ri,
      editable: typeof t.ID === "number" && t.ID > 0,
    }))
    .filter((p) => p.title)
    .sort((a, b) => a.order - b.order);
}

/** Phase date window + the strip's color for that phase — exported so other
    components (SimpleTeamTable's date chips) can color dates by the SAME
    palette in the SAME order as the cards above the table. */
export interface PhaseWindow { title: string; startMs: number; endMs: number; color: string }

/** Loads the record's phases and returns them as colored date windows.
    Reuses the cached /task-data call (`project:tasks:` key), so when the
    phase-card strip is already on screen this costs no extra request.
    Returns [] while loading, on failure, or when there is no schedule. */
export function usePhaseWindows(projectId?: string, refreshToken?: number): PhaseWindow[] {
  const [wins, setWins] = useState<PhaseWindow[]>([]);
  React.useEffect(() => {
    if (!projectId) { setWins([]); return; }
    let cancelled = false;
    void getTaskData(projectId, "0")
      .then((res) => {
        if (cancelled) return;
        const phases = buildPhases(mapRawTasks(res));
        // Any parsed date before 2000 is sentinel junk ("0001", "1900", or
        // other placeholder years) — treat it as absent so the window is
        // ignored and chips fall back instead of snapping to a bogus phase.
        const validMs = (d: Date | null): number =>
          d && d.getFullYear() >= 2000 ? d.getTime() : NaN;
        setWins(phases.map((p, i) => {
          const s = validMs(parseISODate(p.start)), e = validMs(parseISODate(p.due));
          return {
            title: p.title,
            startMs: s,
            // End of the due day, so a date ON the due day still counts as inside.
            endMs: isNaN(e) ? NaN : e + 86_399_999,
            color: phaseColor(i),
          };
        }));
      })
      .catch(() => { if (!cancelled) setWins([]); });
    return () => { cancelled = true; };
  }, [projectId, refreshToken]);
  return wins;
}

export function PhaseCardsStrip({ projectId, refreshToken, canEdit = false }: {
  projectId: string;
  /** Bump to refetch after the schedule is edited (same convention as TeamGantt). */
  refreshToken?: number;
  /** Managers/admins can edit phase dates inline. */
  canEdit?: boolean;
}) {
  const [phases, setPhases] = useState<PhaseEntry[]>([]);
  const [rawTasks, setRawTasks] = useState<RawTask[]>([]);
  const [lcId, setLcId] = useState("");
  const [editingRi, setEditingRi] = useState<number | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  React.useEffect(() => {
    if (!projectId) { setPhases([]); setRawTasks([]); return; }
    let cancelled = false;
    void getTaskData(projectId, "0")
      .then((res) => {
        if (cancelled) return;
        const tasks = mapRawTasks(res);
        setRawTasks(tasks);
        setPhases(buildPhases(tasks));
        // Edit target may have vanished after a background refetch.
        setEditingRi((cur) => (cur !== null && !tasks[cur] ? null : cur));
      })
      .catch(() => { if (!cancelled) { setPhases([]); setRawTasks([]); } });
    return () => { cancelled = true; };
  }, [projectId, refreshToken]);

  const startEdit = (p: PhaseEntry) => {
    setErr("");
    setEditingRi(p.ri);
    setEditStart(dayOf(p.start));
    setEditEnd(dayOf(p.due));
  };
  const cancelEdit = () => { setEditingRi(null); setEditStart(""); setEditEnd(""); setErr(""); };

  const saveEdit = async () => {
    if (editingRi === null || saving) return;
    const edited = rawTasks[editingRi];
    if (!edited || !(edited.ID > 0)) { cancelEdit(); return; }
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(editStart) || !dateRe.test(editEnd)) { setErr("Both dates are required"); return; }
    if (editEnd < editStart) { setErr("End date must be on or after start"); return; }

    try {
      setSaving(true);
      setErr("");

      // The server replaces the WHOLE schedule with what we send, so build the
      // payload from a FRESH snapshot (never the cached one — another tab or
      // user may have edited other phases since we loaded). This fetch also
      // yields the lifecycle id in one round trip.
      let lc = lcId;
      let source = rawTasks;
      try {
        bustCache(`project:tasks:${projectId}`);
        const { data, lifecycleId } = await getTaskDataWithLifecycle(projectId);
        if (lifecycleId) lc = lifecycleId;
        const fresh = mapRawTasks(data);
        if (fresh.some((t) => t.ID === edited.ID)) source = fresh;
      } catch {
        // Network hiccup — fall back to the snapshot we rendered from.
      }
      if (!lc) {
        try {
          const proj = await getProjectDetails(projectId);
          lc = extractLifecycleId(proj);
        } catch {}
      }
      if (!lc) {
        setErr("No lifecycle assigned — assign one in the Schedule section first.");
        setSaving(false);
        return;
      }
      setLcId(lc);

      // Full task array with ONLY the edited row's dates changed — matched by
      // database ID, never by position (a refetch may have reordered rows).
      const built = source
        .filter((t) => typeof t.ID === "number" && t.ID > 0)
        .map((t) => ({
          ID: t.ID,
          Title: t.Title,
          StartDate: t.ID === edited.ID ? editStart : dayOf(t.StartDate) || t.StartDate,
          DueDate: t.ID === edited.ID ? editEnd : dayOf(t.DueDate) || t.DueDate,
          Status: t.Status || "Not Started",
          PercentComplete: t.PercentComplete ?? 0,
          ItemOrder: t.ItemOrder,
          TicketId: projectId,
          AssignedTo: t.AssignedTo || "",
          isSelected: true,
          StageStep: t.StageStep ?? t.ItemOrder,
        }));

      await updateProjectSchedule({
        TicketID: projectId,
        ProjectLifecycleID: lc,
        ProjectScheduleExists: true,
        TargetStartDate: "0001-01-01T00:00:00",
        TargetCompletionDate: "0001-01-01T00:00:00",
        Tasks: built as unknown as Record<string, unknown>[],
      });

      // Optimistic local update from the snapshot we just saved, then the
      // standard bust + notify ordering so other schedule listeners revalidate.
      const updated = source.map((t) => t.ID === edited.ID ? { ...t, StartDate: editStart, DueDate: editEnd } : t);
      setRawTasks(updated);
      setPhases(buildPhases(updated));
      cancelEdit();
      bustCache();
      notifyScheduleChanged();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not save dates.");
    } finally {
      setSaving(false);
    }
  };

  if (phases.length === 0) return null;

  return (
    <div className="rm-dark-scroll" style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6, marginBottom: 12 }}>
      {phases.map((p, pi) => {
        const color = phaseColor(pi);
        const startTxt = fmtShortDate(p.start);
        const dueTxt = fmtShortDate(p.due);
        const dates = [startTxt, dueTxt].filter(Boolean).join(" – ");
        const isEditing = editingRi === p.ri;
        const isHovered = hoveredIdx === pi;
        const showPencil = canEdit && p.editable && !isEditing;

        return (
          <div
            key={pi}
            onMouseEnter={() => setHoveredIdx(pi)}
            onMouseLeave={() => setHoveredIdx(null)}
            style={{
              minWidth: isEditing ? 250 : 148,
              maxWidth: isEditing ? 280 : 220,
              flexShrink: 0,
              padding: "10px 12px",
              borderRadius: 10,
              border: `1px solid ${isEditing ? color : C.border}`,
              borderLeft: `3px solid ${color}`,
              backgroundColor: isEditing ? C.panel : C.soft,
              position: "relative",
              transition: "min-width 0.15s, border-color 0.15s",
              boxShadow: isEditing ? "var(--rm-shadow)" : "none",
            }}
          >
            {/* Header row: phase label + % / done check + edit pencil */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <span style={{ fontSize: 9, color, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6 }}>
                Phase {pi + 1}
              </span>
              <span style={{ flex: 1 }} />
              {p.pct >= 100 ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 800, color }}>
                  <Check size={10} /> DONE
                </span>
              ) : p.pct > 0 ? (
                <span style={{ fontSize: 9, fontWeight: 700, color: C.muted, fontVariantNumeric: "tabular-nums" }}>{fmtPct(p.pct)}</span>
              ) : null}
              {showPencil && (
                <button
                  type="button"
                  title={`Edit ${p.title} dates`}
                  onClick={() => startEdit(p)}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, padding: 0, borderRadius: 5,
                    border: "none", cursor: "pointer",
                    background: isHovered ? `${"var(--rm-panel-hover)"}` : "transparent",
                    color: isHovered ? C.text : C.faint,
                    transition: "color 0.12s, background 0.12s",
                    flexShrink: 0,
                  }}
                >
                  <Pencil size={11} />
                </button>
              )}
            </div>

            {/* Title */}
            <div
              style={{
                fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4, lineHeight: 1.3,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}
              title={p.title}
            >
              {p.title}
            </div>

            {isEditing ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: 0.4, width: 32, flexShrink: 0 }}>Start</span>
                  <DateField value={editStart} onChange={setEditStart} compact aria-label={`${p.title} start date`} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: 0.4, width: 32, flexShrink: 0 }}>End</span>
                  <DateField value={editEnd} onChange={setEditEnd} min={editStart || undefined} compact aria-label={`${p.title} end date`} />
                </div>
                {err && <div style={{ fontSize: 10, color: C.red, fontWeight: 600 }}>{err}</div>}
                <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveEdit()}
                    style={{
                      flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
                      padding: "5px 8px", borderRadius: 7, border: "none",
                      background: C.green, color: "#FFF", fontSize: 11, fontWeight: 700,
                      cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1,
                    }}
                  >
                    {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={cancelEdit}
                    title="Cancel"
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      padding: "5px 9px", borderRadius: 7,
                      border: `1px solid ${C.border}`, background: "transparent",
                      color: C.muted, fontSize: 11, fontWeight: 700, cursor: "pointer",
                    }}
                  >
                    <X size={11} />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: C.muted, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  <Calendar size={10} style={{ flexShrink: 0, opacity: 0.7 }} />
                  {dates || <span style={{ color: C.faint, fontStyle: "italic" }}>No dates set</span>}
                </div>
                <div style={{ height: 4, backgroundColor: C.border, borderRadius: 2, marginTop: 7, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${p.pct}%`, backgroundColor: color, transition: "width 0.3s", borderRadius: 2 }} />
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
