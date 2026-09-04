/**
 * ScheduleTableWidget — light-theme web port of the mobile widget at
 * artifacts/rmone-mobile/app/(tabs)/chat.tsx ScheduleTableWidget (~line 2878).
 *
 * Interactive per-phase editor. Loads phases via getTaskDataWithLifecycle,
 * lets the user tap a phase to edit start/end/length, then saves the entire
 * task array via updateProjectSchedule (only the edited row's dates change —
 * every other phase keeps its current dates).
 */
import React from "react";
import DateField from "@/components/DateField";
import {
  Calendar, Edit2, ChevronUp, ArrowRight, Loader2, Save,
  Minus, Plus,
} from "lucide-react";
import {
  getTaskDataWithLifecycle, getProjectDetails, updateProjectSchedule, bustCache,
} from "@/lib/api";

const C = {
  green: "#6BA539",
  greenSoft: "#E8F2D9",
  greenInk: "#3D6B1E",
  text: "var(--rm-text)",
  textMuted: "var(--rm-text-muted)",
  border: "var(--rm-panel-border)",
  borderSoft: "var(--rm-panel-border)",
  bg: "var(--rm-panel)",
  bgSoft: "var(--rm-panel-soft)",
  red: "#E03C3C",
};

const SCHED_PHASE_COLORS = [
  "#6BA539", "#E87722", "#3B82F6", "#8E5BD9",
  "#16A6B0", "#A9C23F", "#F59E0B", "#E03C3C",
  "#6BA539", "#E87722", "#3B82F6", "#8E5BD9",
];

interface SchedTask {
  ID: number;
  Title: string;
  StartDate: string;
  DueDate: string;
  Status?: string;
  PercentComplete?: number;
  ItemOrder?: number;
  TicketId?: string;
  AssignedTo?: string;
  isSelected?: boolean;
  StageStep?: number;
}

const daysToWeeks = (d: number) => d > 0 ? Math.ceil(d / 7) : 0;
const weeksToDays = (w: number) => w * 7;
const calcDays = (s: string, e: string) => {
  if (!s || !e) return 0;
  const sd = new Date(s).getTime(), ed = new Date(e).getTime();
  if (isNaN(sd) || isNaN(ed)) return 0;
  return Math.max(0, Math.ceil((ed - sd) / 86400000));
};
const addDaysStr = (d: string, n: number) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10); };
const fmtD = (d: string) => {
  if (!d) return "—";
  const dateOnly = String(d).split("T")[0];
  if (dateOnly === "0001-01-01" || dateOnly.startsWith("0001-")) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime()) || dt.getFullYear() < 1900) return "—";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

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

export function ScheduleTableWidget({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = React.useState<SchedTask[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editingIdx, setEditingIdx] = React.useState<number | null>(null);
  const [editStart, setEditStart] = React.useState("");
  const [editEnd, setEditEnd] = React.useState("");
  const [editWeeks, setEditWeeks] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [projectLcId, setProjectLcId] = React.useState<string>("");
  const [err, setErr] = React.useState("");

  const reloadTasks = React.useCallback(async () => {
    try {
      setLoading(true);
      bustCache(`task-data-${projectId}`);
      const { data: raw, lifecycleId } = await getTaskDataWithLifecycle(projectId);
      if (lifecycleId) {
        setProjectLcId(lifecycleId);
      } else {
        try {
          const proj = await getProjectDetails(projectId);
          const lc = extractLifecycleId(proj);
          if (lc) setProjectLcId(lc);
        } catch {}
      }
      const arr: SchedTask[] = Array.isArray(raw) ? raw : (raw as any)?.Data ?? (raw as any)?.data ?? [];
      const sorted = [...arr].sort((a: any, b: any) => {
        const ap = (a.Title || "").toLowerCase().includes("proposal") ? 1 : 0;
        const bp = (b.Title || "").toLowerCase().includes("proposal") ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return 0;
      });
      setTasks(sorted);
    } catch { setTasks([]); }
    finally { setLoading(false); }
  }, [projectId]);

  React.useEffect(() => { reloadTasks(); }, [reloadTasks]);

  const startEdit = (idx: number) => {
    const t = tasks[idx];
    setEditingIdx(idx);
    const s = t.StartDate ? t.StartDate.split("T")[0] : "";
    const e = t.DueDate ? t.DueDate.split("T")[0] : "";
    setEditStart(s);
    setEditEnd(e);
    setEditWeeks(String(daysToWeeks(calcDays(s, e))));
    setErr("");
  };
  const cancelEdit = () => {
    setEditingIdx(null);
    setEditStart(""); setEditEnd(""); setEditWeeks(""); setErr("");
  };

  const handleStartChange = (v: string) => {
    setEditStart(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && /^\d{4}-\d{2}-\d{2}$/.test(editEnd)) setEditWeeks(String(daysToWeeks(calcDays(v, editEnd))));
  };
  const handleEndChange = (v: string) => {
    setEditEnd(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && /^\d{4}-\d{2}-\d{2}$/.test(editStart)) setEditWeeks(String(daysToWeeks(calcDays(editStart, v))));
  };
  const handleWeeksChange = (v: string) => {
    setEditWeeks(v);
    const w = parseInt(v);
    if (!isNaN(w) && w > 0 && /^\d{4}-\d{2}-\d{2}$/.test(editStart)) setEditEnd(addDaysStr(editStart, weeksToDays(w)));
  };

  const saveEdit = async () => {
    if (editingIdx === null) return;
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(editStart) || !dateRe.test(editEnd)) { setErr("Dates must be in YYYY-MM-DD format"); return; }
    if (new Date(editEnd) < new Date(editStart)) { setErr("End date must be on or after start date"); return; }

    const built: SchedTask[] = [];
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if (!(typeof t.ID === "number" && t.ID > 0)) continue;
      const oS = (t.StartDate ?? "").split("T")[0];
      const oE = (t.DueDate ?? "").split("T")[0];
      const start = i === editingIdx ? editStart : oS;
      const end = i === editingIdx ? editEnd : oE;
      built.push({
        ID: t.ID,
        Title: t.Title,
        StartDate: start,
        DueDate: end,
        Status: t.Status || "Not Started",
        PercentComplete: t.PercentComplete ?? 0,
        ItemOrder: t.ItemOrder,
        TicketId: projectId,
        AssignedTo: t.AssignedTo || "",
        isSelected: true,
        StageStep: t.StageStep ?? t.ItemOrder,
      });
    }

    try {
      setSaving(true);
      let lcId = projectLcId;
      if (!lcId) {
        try {
          bustCache(`task-data-${projectId}`);
          const { lifecycleId } = await getTaskDataWithLifecycle(projectId);
          if (lifecycleId) { lcId = lifecycleId; setProjectLcId(lifecycleId); }
        } catch {}
      }
      if (!lcId) {
        try {
          bustCache(`project:${projectId}`);
          const proj = await getProjectDetails(projectId);
          const lc = extractLifecycleId(proj);
          if (lc) { lcId = lc; setProjectLcId(lc); }
        } catch {}
      }
      if (!lcId) {
        setErr("This project has no lifecycle template assigned. Pick one first, then edit dates.");
        setSaving(false);
        return;
      }
      await updateProjectSchedule({
        TicketID: projectId,
        ProjectLifecycleID: lcId,
        ProjectScheduleExists: true,
        TargetStartDate: "0001-01-01T00:00:00",
        TargetCompletionDate: "0001-01-01T00:00:00",
        Tasks: built as unknown as Record<string, unknown>[],
      });
      setTasks(built);
      cancelEdit();
      bustCache();
    } catch (e: any) {
      setErr(e?.message || "Could not save schedule.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 0" }}>
      <Loader2 size={18} color={C.green} className="animate-spin" />
      <span style={{ color: C.textMuted, fontSize: 11, marginTop: 8 }}>Loading schedule…</span>
    </div>
  );

  if (tasks.length === 0) return (
    <div style={{
      padding: 14, background: C.bgSoft, borderRadius: 12, marginTop: 6,
      border: `1px solid ${C.border}`,
    }}>
      <span style={{ color: C.textMuted, fontSize: 12 }}>No schedule phases found for {projectId}.</span>
    </div>
  );

  return (
    <div style={{
      marginTop: 12, borderRadius: 12, overflow: "hidden",
      background: C.bg, border: `1px solid ${C.border}`,
      boxShadow: "0 4px 20px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.05)",
      animation: "chat-fade-in-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
    }}>
      <div style={{
        padding: "14px 18px", borderBottom: `1px solid ${C.border}`,
        background: `linear-gradient(180deg, ${C.bgSoft} 0%, transparent 100%)`,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: `${C.green}20`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Calendar size={16} color={C.green} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: C.text, fontWeight: 700, fontSize: 14, letterSpacing: -0.2 }}>Schedule Phases</div>
          <div style={{ color: C.textMuted, fontSize: 11, marginTop: 2, fontWeight: 500 }}>Tap any phase to edit · {tasks.length} phases</div>
        </div>
      </div>

      {tasks.map((task, idx) => {
        const isEditing = editingIdx === idx;
        const days = calcDays(task.StartDate, task.DueDate);
        const color = SCHED_PHASE_COLORS[idx % SCHED_PHASE_COLORS.length];
        const isProjectComplete = (task.Title || "").trim().toLowerCase() === "project complete";

        return (
          <div key={task.ID ?? idx} style={{
            transition: "background-color 0.2s ease",
            background: isEditing ? "rgba(107,165,57,0.04)" : "transparent",
            borderBottom: idx < tasks.length - 1 ? `1px solid ${C.borderSoft}` : "none",
          }}>
            <button
              onClick={() => { if (isProjectComplete) return; isEditing ? cancelEdit() : startEdit(idx); }}
              disabled={isProjectComplete}
              style={{
                width: "100%", textAlign: "left",
                padding: "12px 18px", border: "none", cursor: isProjectComplete ? "default" : "pointer",
                background: "transparent", outline: "none",
                display: "block",
              }}
              onMouseEnter={(e) => { if (!isProjectComplete && !isEditing) e.currentTarget.style.background = "var(--rm-panel-hover)"; }}
              onMouseLeave={(e) => { if (!isProjectComplete && !isEditing) e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: "50%", background: `linear-gradient(135deg, ${color}22, ${color}11)`,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  border: `1px solid ${color}33`,
                }}>
                  <span style={{ fontWeight: 800, fontSize: 10, color }}>{idx + 1}</span>
                </div>
                <span style={{ fontWeight: 600, fontSize: 13, color: C.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {task.Title}
                </span>
                <div style={{ background: `linear-gradient(180deg, ${color}15, ${color}05)`, border: `1px solid ${color}25`, padding: "4px 10px", borderRadius: 12, flexShrink: 0, boxShadow: "0 2px 4px rgba(0,0,0,0.02)" }}>
                  <span style={{ fontWeight: 700, fontSize: 11, color }}>{days > 0 ? daysToWeeks(days) : "0"}w</span>
                </div>
                {!isProjectComplete && (
                  <div style={{ width: 20, display: "flex", justifyContent: "flex-end" }}>
                    {isEditing ? <ChevronUp size={14} color={C.textMuted} /> : <Edit2 size={14} color={C.textMuted} style={{ opacity: 0.7 }} />}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", marginTop: 6, marginLeft: 34, gap: 6 }}>
                <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 500 }}>{fmtD(task.StartDate)}</span>
                <ArrowRight size={10} color="rgba(150,150,150,0.3)" />
                <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 500 }}>{fmtD(task.DueDate)}</span>
              </div>
            </button>

            {isEditing && (
              <div style={{
                padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10,
                background: "rgba(107,165,57,0.04)", borderBottom: `1px solid ${C.borderSoft}`,
              }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ color: C.textMuted, fontWeight: 600, fontSize: 10, letterSpacing: 0.5, display: "block", marginBottom: 4 }}>
                      START DATE
                    </label>
                    <DateField
                      value={editStart} onChange={handleStartChange}
                      style={{
                        padding: "8px 10px", fontSize: 13, border: `1px solid ${C.border}`,
                        borderRadius: 8, background: C.bg, color: C.text,
                      }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ color: C.textMuted, fontWeight: 600, fontSize: 10, letterSpacing: 0.5, display: "block", marginBottom: 4 }}>
                      END DATE
                    </label>
                    <DateField
                      value={editEnd} onChange={handleEndChange}
                      style={{
                        padding: "8px 10px", fontSize: 13, border: `1px solid ${C.border}`,
                        borderRadius: 8, background: C.bg, color: C.text,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ color: C.textMuted, fontWeight: 600, fontSize: 10, letterSpacing: 0.5, display: "block", marginBottom: 4 }}>
                    LENGTH (WEEKS)
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      onClick={() => { const w = Math.max(1, (parseInt(editWeeks) || 1) - 1); handleWeeksChange(String(w)); }}
                      style={{
                        width: 36, height: 36, borderRadius: 10, background: C.bgSoft,
                        border: `1px solid ${C.border}`, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    ><Minus size={16} color={C.textMuted} /></button>
                    <div style={{
                      flex: 1, background: C.bg, borderRadius: 10, padding: "8px 0",
                      border: `1px solid ${C.border}`, textAlign: "center",
                    }}>
                      <span style={{ fontWeight: 700, fontSize: 16, color: C.text }}>{editWeeks}</span>
                    </div>
                    <button
                      onClick={() => { const w = (parseInt(editWeeks) || 0) + 1; handleWeeksChange(String(w)); }}
                      style={{
                        width: 36, height: 36, borderRadius: 10, background: C.bgSoft,
                        border: `1px solid ${C.border}`, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    ><Plus size={16} color={C.textMuted} /></button>
                  </div>
                </div>

                {err ? (
                  <div style={{ color: C.red, fontSize: 11 }}>{err}</div>
                ) : null}

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={cancelEdit}
                    disabled={saving}
                    style={{
                      flex: 1, padding: 11, borderRadius: 10, background: C.bgSoft,
                      color: C.textMuted, fontWeight: 600, fontSize: 13,
                      border: `1px solid ${C.border}`, cursor: "pointer",
                    }}
                  >Cancel</button>
                  <button
                    onClick={saveEdit}
                    disabled={saving || !editStart || !editEnd}
                    style={{
                      flex: 1, padding: 11, borderRadius: 10,
                      background: saving ? C.greenSoft : C.green,
                      color: saving ? C.green : "#fff", fontWeight: 700, fontSize: 13,
                      border: "none",
                      opacity: (!editStart || !editEnd) ? 0.4 : 1,
                      cursor: saving ? "default" : "pointer",
                      display: "flex", justifyContent: "center", alignItems: "center", gap: 6,
                    }}
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
