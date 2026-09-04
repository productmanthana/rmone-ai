/**
 * LifecyclePickerWidget — light-theme web port of the mobile widget at
 * artifacts/rmone-mobile/app/(tabs)/chat.tsx LifecyclePickerWidget (~line 2426).
 *
 * Filters lifecycle templates by project type (OPM vs PMM/regular). Shows a
 * "Schedule already assigned" confirmation panel when the project already has
 * dated phases, otherwise renders the template picker with live phase preview
 * and createSchedule on submit.
 */
import React from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import DateField from "@/components/DateField";
import {
  getLifecycles, getTaskData, createSchedule, bustCache,
} from "@/lib/api";
import { useAuth } from "@/lib/useAuth";

const C = {
  green: "#6BA539",
  greenSoft: "#E8F2D9",
  greenDark: "#3D6B1E",
  text: "var(--rm-text)",
  textMuted: "var(--rm-text-muted)",
  border: "var(--rm-panel-border)",
  borderSoft: "var(--rm-panel-border)",
  bg: "var(--rm-panel)",
  bgSoft: "var(--rm-panel-soft)",
  red: "#E03C3C",
  redSoft: "#FDECEC",
};

const SCHED_PHASE_COLORS = [
  "#6BA539", "#E87722", "#3B82F6", "#8E5BD9",
  "#16A6B0", "#A9C23F", "#F59E0B", "#E03C3C",
  "#6BA539", "#E87722", "#3B82F6", "#8E5BD9",
];

interface LcStage { Name?: string; StageStep?: number; }
interface LcItem { ID: number | string; Title?: string; Name?: string; Stages?: LcStage[]; }

const addDays = (d: string, n: number) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10); };
const fmtDate = (d: string) => { const dt = new Date(d); return dt.toISOString().slice(0, 10); };
const fmtH = (d: string) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

interface Props { projectId: string; onSend: (msg: string) => void; }

export function LifecyclePickerWidget({ projectId, onSend }: Props) {
  const [lcs, setLcs] = React.useState<LcItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<string>("");
  const [startDate, setStartDate] = React.useState<string>(new Date().toISOString().slice(0, 10));
  const [phaseLen, setPhaseLen] = React.useState<string>("2");
  const [saving, setSaving] = React.useState(false);
  const [assigned, setAssigned] = React.useState(false);
  const [existingPhases, setExistingPhases] = React.useState<{ count: number; firstStart: string; lastEnd: string } | null>(null);
  const [err, setErr] = React.useState("");
  const { user } = useAuth();
  const isOpm = projectId.startsWith("OPM");

  React.useEffect(() => {
    (async () => {
      try {
        const [data, taskRaw] = await Promise.all([
          getLifecycles(),
          getTaskData(projectId).catch(() => null),
        ]);
        const arr = (Array.isArray(data) ? data : []) as LcItem[];
        const filtered = isOpm
          ? arr.filter(l => /opm|opportunity/i.test(String(l.Title ?? l.Name ?? "")))
          : arr.filter(l => !/opm|opportunity/i.test(String(l.Title ?? l.Name ?? "")));
        const list = filtered.length > 0 ? filtered : arr;
        setLcs(list);
        if (list.length > 0) setSelected(String(list[0].ID));

        const tasksArr: any[] = Array.isArray(taskRaw)
          ? (taskRaw as any[])
          : ((taskRaw as any)?.Data ?? (taskRaw as any)?.data ?? []);
        if (Array.isArray(tasksArr) && tasksArr.length > 0) {
          const dated = tasksArr.filter(t => {
            const s = String(t.StartDate ?? "").slice(0, 10);
            const e = String(t.DueDate ?? t.EndDate ?? "").slice(0, 10);
            return s && e && s !== "0001-01-01" && e !== "0001-01-01";
          });
          if (dated.length > 0) {
            const byStart = [...dated].sort(
              (a, b) => new Date(String(a.StartDate)).getTime() - new Date(String(b.StartDate)).getTime(),
            );
            const byEnd = [...dated].sort(
              (a, b) => new Date(String(a.DueDate ?? a.EndDate)).getTime() - new Date(String(b.DueDate ?? b.EndDate)).getTime(),
            );
            const firstStart = String(byStart[0]?.StartDate ?? "").slice(0, 10);
            const lastEnd = String(byEnd[byEnd.length - 1]?.DueDate ?? byEnd[byEnd.length - 1]?.EndDate ?? "").slice(0, 10);
            setExistingPhases({ count: tasksArr.length, firstStart, lastEnd });
          } else {
            setExistingPhases({ count: tasksArr.length, firstStart: "", lastEnd: "" });
          }
        }
      } catch { setLcs([]); }
      finally { setLoading(false); }
    })();
  }, [projectId, isOpm]);

  // Live refresh: Settings saves of named phase/stage sets and template
  // create/rename/delete anywhere in the app fire notifyLifecyclesChanged()
  // (same-tab window event; other tabs via the rmone:lifecyclesTs localStorage
  // tick). Re-pull the list so an already-open chat picker offers the
  // new/edited templates — keeping the user's selection when it survived and
  // resetting it if the selected template was deleted.
  const reloadList = React.useCallback(async () => {
    // Same brief pause as the record page's reloadLifecycles: the server-side
    // IPC bust needs a moment to reach every worker, or one of them can still
    // serve the previous list.
    await new Promise<void>((r) => setTimeout(r, 200));
    try {
      const data = await getLifecycles();
      const arr = (Array.isArray(data) ? data : []) as LcItem[];
      const filtered = isOpm
        ? arr.filter(l => /opm|opportunity/i.test(String(l.Title ?? l.Name ?? "")))
        : arr.filter(l => !/opm|opportunity/i.test(String(l.Title ?? l.Name ?? "")));
      const list = filtered.length > 0 ? filtered : arr;
      setLcs(list);
      setSelected(prev => (prev && list.some(l => String(l.ID) === prev)) ? prev : (list.length > 0 ? String(list[0].ID) : ""));
    } catch { /* keep the current list — a failed refresh must never blank an open picker */ }
  }, [isOpm]);
  React.useEffect(() => {
    const onChanged = () => { void reloadList(); };
    const onStorage = (e: StorageEvent) => { if (e.key === "rmone:lifecyclesTs") onChanged(); };
    window.addEventListener("rmone:lifecyclesChanged", onChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("rmone:lifecyclesChanged", onChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, [reloadList]);

  const handleAssign = async () => {
    if (!selected) { setErr("Please choose a lifecycle template."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) { setErr("Start date must be YYYY-MM-DD."); return; }
    const wks = Math.max(1, parseInt(phaseLen) || 2);
    const lc = lcs.find(l => String(l.ID) === selected);
    if (!lc) { setErr("Lifecycle not found."); return; }
    const stages = ((lc.Stages ?? []) as any[])
      .map((s: any, i: number) => ({ ...s, Name: String(s?.Name ?? `Phase ${i + 1}`), StageStep: Number(s?.StageStep ?? i + 1) }))
      .sort((a, b) => a.StageStep - b.StageStep);
    if (stages.length === 0) { setErr("Selected template has no stages."); return; }

    setErr("");
    const tasks: any[] = [];
    let cursor = fmtDate(startDate);
    if (isOpm) {
      const propEnd = addDays(cursor, 13);
      tasks.push({ ID: 0, Title: "Proposal", StartDate: cursor, DueDate: propEnd, Status: "Not Started", PercentComplete: 0, ItemOrder: 0, TicketId: projectId, AssignedTo: user?.userId ?? "", isSelected: true, StageStep: 0 });
      cursor = addDays(propEnd, 1);
    }
    const filteredStages = isOpm ? stages.filter(s => s.Name !== "Project Complete") : stages;
    filteredStages.forEach((s, i) => {
      const end = addDays(cursor, wks * 7 - 1);
      const safeName = String(s?.Name ?? `Phase ${i + 1}`);
      tasks.push({
        ID: -(i + 1),
        Title: isOpm ? `Phase ${i + 1}${safeName.includes("Closeout") ? " - Closeout" : ""}` : safeName,
        StartDate: cursor, DueDate: end, Status: "Not Started", PercentComplete: 0,
        ItemOrder: isOpm ? i + 1 : s.StageStep,
        TicketId: projectId, AssignedTo: user?.userId ?? "",
        isSelected: true, StageStep: isOpm ? i + 1 : s.StageStep,
      });
      cursor = addDays(end, 1);
    });

    setSaving(true);
    try {
      await createSchedule({
        TicketID: projectId,
        ProjectLifecycleID: String(selected),
        ProjectScheduleExists: false,
        TargetStartDate: "0001-01-01T00:00:00",
        TargetCompletionDate: "0001-01-01T00:00:00",
        Tasks: tasks,
      });
      bustCache(`task-data-${projectId}`);
      bustCache(`project:${projectId}`);
      setAssigned(true);
      // After a short pause (so the user sees the "Assigned" confirmation),
      // auto-trigger the hours editor for whoever was in the prior WEEKLY_ALLOC
      // context. The server detects this sentinel, scans history, and emits
      // [WEEKLY_ALLOC:person|projectId|name] directly — no LLM round-trip.
      setTimeout(() => onSend(`__lifecycle_assigned__:${projectId}`), 900);
    } catch (e: any) {
      setErr(e?.message || "Could not assign schedule.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div style={{
      background: C.bgSoft, borderRadius: 12, padding: 14, margin: "8px 0",
      border: `1px solid ${C.border}`,
    }}>
      <span style={{ color: C.textMuted, fontSize: 12 }}>Loading lifecycle templates…</span>
    </div>
  );

  if (lcs.length === 0) return (
    <div style={{
      background: C.bgSoft, borderRadius: 12, padding: 14, margin: "8px 0",
      border: `1px solid ${C.border}`,
    }}>
      <span style={{ color: C.textMuted, fontSize: 12 }}>No lifecycle templates available.</span>
    </div>
  );

  if (existingPhases) {
    return (
      <div style={{
        background: C.bg, borderRadius: 12, padding: 14, margin: "8px 0",
        border: `1px solid ${C.green}60`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <CheckCircle2 size={18} color={C.green} />
          <span style={{ color: C.green, fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>SCHEDULE ALREADY ASSIGNED</span>
        </div>
        <div style={{ color: C.text, fontSize: 13, marginBottom: 4 }}>
          {projectId} already has a phase schedule with {existingPhases.count} {existingPhases.count === 1 ? "phase" : "phases"}.
        </div>
        <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 12 }}>
          {fmtH(existingPhases.firstStart)} → {fmtH(existingPhases.lastEnd)}
        </div>
        <button
          onClick={() => onSend(`show schedule for ${projectId}`)}
          style={{
            width: "100%", background: C.green, color: "#fff", border: "none",
            borderRadius: 8, padding: 10, fontWeight: 700, fontSize: 13, cursor: "pointer",
          }}
        >View / Edit Schedule</button>
        <button
          onClick={() => setExistingPhases(null)}
          style={{
            width: "100%", background: "transparent", border: "none",
            marginTop: 8, padding: 6, color: C.textMuted, fontSize: 11, cursor: "pointer",
          }}
        >Replace with a different template…</button>
      </div>
    );
  }

  const lc = lcs.find(l => String(l.ID) === selected);
  const rawStages = (lc?.Stages ?? []).slice();
  const stages = rawStages
    .map((s: any, i: number) => ({ ...s, Name: String(s?.Name ?? ""), StageStep: Number(s?.StageStep ?? i + 1) }))
    .sort((a, b) => a.StageStep - b.StageStep);
  const filteredStages = isOpm ? stages.filter(s => s.Name !== "Project Complete") : stages;
  const wks = Math.max(1, parseInt(phaseLen) || 2);
  let cursor = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : new Date().toISOString().slice(0, 10);
  const preview: { name: string; start: string; end: string }[] = [];
  if (isOpm) {
    const propEnd = addDays(cursor, 13);
    preview.push({ name: "Proposal", start: cursor, end: propEnd });
    cursor = addDays(propEnd, 1);
  }
  filteredStages.forEach((s, i) => {
    const end = addDays(cursor, wks * 7 - 1);
    const safeName = String(s?.Name ?? `Phase ${i + 1}`);
    const name = isOpm ? `Phase ${i + 1}${safeName.includes("Closeout") ? " - Closeout" : ""}` : safeName;
    preview.push({ name, start: cursor, end });
    cursor = addDays(end, 1);
  });
  const fmt = (d: string) => { const dt = new Date(d); return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };

  return (
    <div style={{
      background: C.bg, borderRadius: 12, padding: 14, margin: "8px 0",
      border: `1px solid ${C.border}`,
    }}>
      <div style={{ color: C.textMuted, fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>
        ASSIGN LIFECYCLE TEMPLATE
      </div>
      <div style={{ color: C.text, fontSize: 12, marginBottom: 10 }}>
        This {isOpm ? "opportunity" : "project"} has no phase schedule yet. Pick a template below:
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        {lcs.map(item => {
          const id = String(item.ID);
          const label = String(item.Title ?? item.Name ?? `LC ${item.ID}`);
          const stageCount = Array.isArray(item.Stages) ? item.Stages.length : 0;
          const isSel = selected === id;
          return (
            <button key={id} onClick={() => setSelected(id)}
              style={{
                background: isSel ? C.green : C.bgSoft,
                color: isSel ? "#fff" : C.text,
                border: `1px solid ${isSel ? C.green : C.border}`,
                borderRadius: 8, padding: "8px 12px",
                fontWeight: 600, fontSize: 12, cursor: "pointer",
                textAlign: "left",
              }}>
              <div>{label}</div>
              {stageCount > 0 && <div style={{ color: isSel ? "#fff" : C.textMuted, fontSize: 10, marginTop: 2, fontWeight: 400 }}>{stageCount} phases</div>}
            </button>
          );
        })}
      </div>

      {lc && filteredStages.length > 0 && (
        <div style={{
          background: C.bgSoft, borderRadius: 8, padding: 10, marginBottom: 12,
          border: `1px solid ${C.borderSoft}`,
        }}>
          <div style={{ color: C.textMuted, fontWeight: 700, fontSize: 10, letterSpacing: 1, marginBottom: 8 }}>
            {preview.length} PHASES PREVIEW
          </div>
          {preview.map((p, i) => {
            const color = SCHED_PHASE_COLORS[i % SCHED_PHASE_COLORS.length];
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", padding: "4px 0", gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: color, display: "inline-block", flexShrink: 0 }} />
                <span style={{ flex: 1, color: C.text, fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {i + 1}. {p.name}
                </span>
                <span style={{ color: C.textMuted, fontSize: 10 }}>{fmt(p.start)} → {fmt(p.end)}</span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 2 }}>
          <label style={{ color: C.textMuted, fontSize: 10, marginBottom: 4, display: "block" }}>START DATE</label>
          <DateField
            value={startDate} onChange={setStartDate}
            style={{
              padding: "9px 10px", fontSize: 14, border: `1px solid ${C.border}`,
              borderRadius: 8, background: C.bg, color: C.text,
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ color: C.textMuted, fontSize: 10, marginBottom: 4, display: "block" }}>WKS / PHASE</label>
          <input
            type="number" value={phaseLen} onChange={(e) => setPhaseLen(e.target.value.slice(0, 2))} min={1} max={99}
            style={{
              width: "100%", padding: "9px 10px", fontSize: 14, border: `1px solid ${C.border}`,
              borderRadius: 8, background: C.bg, color: C.text, boxSizing: "border-box", outline: "none",
            }}
          />
        </div>
      </div>

      {err ? (
        <div style={{
          background: C.redSoft, border: `1px solid ${C.red}`, borderRadius: 8,
          padding: "8px 12px", color: C.red, fontWeight: 600, fontSize: 12, marginBottom: 10,
        }}>{err}</div>
      ) : null}

      <button
        onClick={handleAssign}
        disabled={saving || assigned}
        style={{
          width: "100%", padding: 12, borderRadius: 8, border: "none",
          background: saving ? C.bgSoft : assigned ? C.greenDark : C.green,
          color: assigned || !saving ? "#fff" : C.textMuted,
          fontWeight: 700, fontSize: 13,
          cursor: (saving || assigned) ? "default" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}
      >
        {saving && <Loader2 size={14} className="animate-spin" />}
        {assigned && <CheckCircle2 size={14} color="#fff" />}
        {saving ? "Assigning…" : assigned ? "Assigned" : "Assign Schedule"}
      </button>
    </div>
  );
}
