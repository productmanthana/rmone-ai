/**
 * ProjectDatesWidget — light-theme web port of the mobile widget at
 * artifacts/rmone-mobile/app/(tabs)/chat.tsx ProjectDatesWidget (~line 2701).
 *
 * Edits Target Start / Target Completion dates for a project. If the project
 * already has a phase schedule, ONLY the read-only Actual Start/Completion
 * dates are shown (derived from the schedule's true bounds). Otherwise the
 * editable Target rows are shown.
 */
import React from "react";
import { Calendar, Edit2, Lock, Loader2, Save, X, Check } from "lucide-react";
import DateField from "@/components/DateField";
import {
  getProjectDetails, getTaskData, smartUpdate, bustCache,
} from "@/lib/api";

const C = {
  green: "#6BA539",
  greenSoft: "#E8F2D9",
  text: "var(--rm-text)",
  textMuted: "var(--rm-text-muted)",
  border: "var(--rm-panel-border)",
  borderSoft: "var(--rm-panel-border)",
  bg: "var(--rm-panel)",
  bgSoft: "var(--rm-panel-soft)",
  red: "#E03C3C",
  redSoft: "#FDECEC",
};

const PROJECT_DATE_FIELDS = [
  { key: "TargetStartDate", label: "Target Start" },
  { key: "TargetCompletionDate", label: "Target Completion" },
  { key: "ActualStartDate", label: "Schedule Start" },
  { key: "ActualCompletionDate", label: "Schedule End" },
] as const;

type FieldKey = typeof PROJECT_DATE_FIELDS[number]["key"];

const fmtD = (d: string) => {
  if (!d || d.startsWith("0001")) return "not set";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "not set";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const toIso = (d: string) => (d && !d.startsWith("0001") ? d.split("T")[0] : "");

export function ProjectDatesWidget({ projectId }: { projectId: string }) {
  const [dates, setDates] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [editingKey, setEditingKey] = React.useState<FieldKey | null>(null);
  const [editValue, setEditValue] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [hasSchedule, setHasSchedule] = React.useState(false);
  const [err, setErr] = React.useState("");

  const reload = React.useCallback(async () => {
    try {
      setLoading(true);
      bustCache(`project:${projectId}`);
      const [data, taskRaw] = await Promise.all([
        getProjectDetails(projectId) as Promise<Record<string, unknown>>,
        getTaskData(projectId).catch(() => null),
      ]);
      const dataField = (data as any)?.Data;
      const flat = Array.isArray(dataField) ? dataField[0] : (dataField ?? (data as any)?.record ?? data);
      const rec: Record<string, unknown> = {};
      if (flat && Array.isArray((flat as any).Fields)) {
        for (const ff of (flat as any).Fields as { FieldName: string; Value: unknown }[]) {
          if (ff.FieldName) rec[ff.FieldName] = ff.Value ?? "";
        }
      } else if (flat) {
        Object.assign(rec, flat as Record<string, unknown>);
      }
      const next: Record<string, string> = {};
      for (const f of PROJECT_DATE_FIELDS) next[f.key] = String(rec[f.key] ?? "");

      const tasks: any[] = Array.isArray(taskRaw)
        ? (taskRaw as any[])
        : ((taskRaw as any)?.Data ?? (taskRaw as any)?.data ?? []);
      const dated = (Array.isArray(tasks) ? tasks : []).filter(t => {
        const s = String(t?.StartDate ?? "").slice(0, 10);
        const e = String(t?.DueDate ?? t?.EndDate ?? "").slice(0, 10);
        return s && e && s !== "0001-01-01" && e !== "0001-01-01";
      });
      if (dated.length > 0) {
        const byStep = [...dated].sort(
          (a, b) => (Number(a?.StageStep ?? a?.ItemOrder ?? 0)) - (Number(b?.StageStep ?? b?.ItemOrder ?? 0)),
        );
        const firstStart = String(byStep[0].StartDate ?? "").split("T")[0];
        const lastRow = byStep[byStep.length - 1];
        const lastEnd = String(lastRow.DueDate ?? lastRow.EndDate ?? "").split("T")[0];
        if (firstStart) next.ActualStartDate = `${firstStart}T00:00:00`;
        if (lastEnd) next.ActualCompletionDate = `${lastEnd}T00:00:00`;
      }
      setHasSchedule(dated.length > 0);
      setDates(next);
    } catch { setHasSchedule(false); setDates({}); }
    finally { setLoading(false); }
  }, [projectId]);

  React.useEffect(() => { reload(); }, [reload]);

  const startEdit = (key: FieldKey) => { setEditingKey(key); setEditValue(toIso(dates[key] ?? "")); setErr(""); };
  const cancel = () => { setEditingKey(null); setEditValue(""); setErr(""); };

  const save = async () => {
    if (!editingKey) return;
    if (editValue && !/^\d{4}-\d{2}-\d{2}$/.test(editValue)) {
      setErr("Use YYYY-MM-DD format.");
      return;
    }
    setSaving(true);
    try {
      await smartUpdate(projectId, [{ FieldName: editingKey, Value: editValue, IsExcluded: false }]);
      setDates(prev => ({ ...prev, [editingKey]: editValue ? `${editValue}T00:00:00` : "" }));
      cancel();
      bustCache(`project:${projectId}`);
    } catch (e: any) {
      setErr(e?.message || "Could not update date.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 0" }}>
      <Loader2 size={18} color={C.green} className="animate-spin" />
      <span style={{ color: C.textMuted, fontSize: 11, marginTop: 6 }}>Loading project dates…</span>
    </div>
  );

  const visibleFields = hasSchedule
    ? PROJECT_DATE_FIELDS.filter(f => f.key === "ActualStartDate" || f.key === "ActualCompletionDate")
    : PROJECT_DATE_FIELDS.filter(f => f.key === "TargetStartDate" || f.key === "TargetCompletionDate");

  return (
    <div style={{
      marginTop: 8, borderRadius: 12, overflow: "hidden",
      background: C.bg, border: `1px solid ${C.border}`,
    }}>
      <div style={{
        padding: "10px 14px", borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 8, background: C.bgSoft,
      }}>
        <Calendar size={14} color={C.green} />
        <div style={{ flex: 1 }}>
          <div style={{ color: C.text, fontWeight: 700, fontSize: 13 }}>Project Dates</div>
          <div style={{ color: C.textMuted, fontSize: 10, marginTop: 1 }}>
            {hasSchedule ? "Schedule dates (read-only)" : "Tap any date to edit"}
          </div>
        </div>
      </div>

      {visibleFields.map((f, idx) => {
        const isEditing = editingKey === f.key;
        const cur = dates[f.key] ?? "";
        const readOnly = f.key === "ActualStartDate" || f.key === "ActualCompletionDate";

        return (
          <div key={f.key} style={{
            padding: "10px 14px",
            borderTop: idx === 0 ? "none" : `1px solid ${C.borderSoft}`,
          }}>
            {isEditing && !readOnly ? (
              <div>
                <div style={{ color: C.textMuted, fontWeight: 500, fontSize: 11, marginBottom: 6 }}>{f.label}</div>
                <DateField
                  value={editValue}
                  onChange={(v) => { setEditValue(v); setErr(""); }}
                  style={{
                    padding: "9px 10px", fontSize: 13,
                    border: `1px solid ${err ? C.red : C.border}`, borderRadius: 8,
                    background: C.bg, color: C.text,
                  }}
                />
                {err ? (
                  <div style={{ color: C.red, fontSize: 11, marginTop: 6 }}>{err}</div>
                ) : null}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button onClick={save} disabled={saving} style={{
                    flex: 1, background: C.green, color: "#fff", border: "none",
                    borderRadius: 8, padding: 9, fontWeight: 600, fontSize: 12,
                    cursor: saving ? "default" : "pointer", display: "flex",
                    justifyContent: "center", alignItems: "center", gap: 6,
                  }}>
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button onClick={cancel} disabled={saving} style={{
                    background: C.bgSoft, color: C.textMuted, border: `1px solid ${C.border}`,
                    borderRadius: 8, padding: "9px 14px", fontWeight: 500, fontSize: 12, cursor: "pointer",
                  }}>Cancel</button>
                </div>
              </div>
            ) : readOnly ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.textMuted, fontWeight: 500, fontSize: 11 }}>{f.label}</div>
                  <div style={{ color: C.text, fontWeight: 600, fontSize: 13, marginTop: 2 }}>{fmtD(cur)}</div>
                </div>
                <Lock size={12} color="#A8B3BC" />
              </div>
            ) : (
              <button onClick={() => startEdit(f.key)} style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "transparent", border: "none", padding: 0, cursor: "pointer",
                textAlign: "left",
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.textMuted, fontWeight: 500, fontSize: 11 }}>{f.label}</div>
                  <div style={{ color: C.text, fontWeight: 600, fontSize: 13, marginTop: 2 }}>{fmtD(cur)}</div>
                </div>
                <Edit2 size={14} color={C.textMuted} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
