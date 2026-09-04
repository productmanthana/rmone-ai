/**
 * Staffing Templates — Settings surface for allocation templates.
 *
 * Templates are saved role mixes ("Bridge Design Team: 1 PM @ 25%, 2 Engineers
 * @ 100%…") that project teams apply from the Team tab. This page lets admins
 * manage the library outside any one project: see what's in each template,
 * rename, edit the role mix, build new ones, and delete stale ones.
 *
 * Uses the SAME backend as the project-side modal (/api/allocation-templates),
 * so changes here show up immediately in the project "Apply template" list.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Pencil, Trash2, X, Check, Layers } from "lucide-react";
import {
  getAllocTemplates, createAllocTemplate, updateAllocTemplate, deleteAllocTemplate,
  getRoleBillingRates,
} from "@/lib/api";
import type { AllocTemplate, AllocTemplateSlot } from "@/lib/api";
import { ROLE_CATALOG } from "@/lib/roleCatalog";
import { getSeed, setSeed } from "@/lib/settingsSeed";
import { useToast } from "@/hooks/use-toast";

type DraftSlot = { roleName: string; defaultPct: number };

const PANEL: React.CSSProperties = {
  border: "1px solid hsl(var(--border))", borderRadius: 12,
  background: "hsl(var(--card))", padding: 16,
};

export default function StaffingTemplatesSettings() {
  const { toast } = useToast();
  // Instant render: boot from the session seed (settings hub pre-warms it)
  // and revalidate in the background — no "Loading templates…" on revisits.
  const [templates, setTemplates] = useState<AllocTemplate[] | null>(
    () => getSeed<AllocTemplate[]>("staffingTemplates:own") ?? null,
  );
  const [loadErr, setLoadErr] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<number | "new" | null>(null);

  // Editing state: either an existing template id or "new".
  const [editId, setEditId] = useState<number | "new" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftSlots, setDraftSlots] = useState<DraftSlot[]>([]);
  const [draftErr, setDraftErr] = useState("");

  // Stale-response guard: a reload resolving after a newer reload (e.g. the
  // mount revalidate racing a post-save reload) must not apply.
  const loadSeqRef = useRef(0);
  const reload = async (background = false) => {
    const seq = ++loadSeqRef.current;
    try {
      if (!background) setLoadErr(false);
      const list = await getAllocTemplates();
      if (seq !== loadSeqRef.current) return; // superseded
      setSeed("staffingTemplates:own", list);
      setTemplates(list);
    } catch {
      if (seq !== loadSeqRef.current) return; // superseded
      // Background refresh failure: keep showing the seeded list (stale-if-error).
      if (!background) {
        setLoadErr(true);
        setTemplates(prev => prev ?? []);
      }
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only revalidate
  useEffect(() => { void reload(templates !== null); }, []);
  useEffect(() => {
    // Role suggestions mirror the Billing Rates picker: the tenant's own
    // roles plus the built-in catalogue (best-effort — free typing still works).
    getRoleBillingRates()
      .then(p => setRoles((p.rates ?? []).map((r: any) => String(r.roleName ?? r.name ?? "")).filter(Boolean)))
      .catch(() => {});
  }, []);

  const roleOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of [...roles, ...ROLE_CATALOG]) { const k = r.trim(); if (k && !seen.has(k.toLowerCase())) { seen.add(k.toLowerCase()); out.push(k); } }
    return out.sort((a, b) => a.localeCompare(b));
  }, [roles]);

  const startEdit = (t: AllocTemplate | null) => {
    setDraftErr("");
    if (t) {
      setEditId(t.id);
      setDraftName(t.name);
      setDraftSlots(t.slots.map(s => ({ roleName: s.roleName ?? "", defaultPct: s.defaultPct })));
    } else {
      setEditId("new");
      setDraftName("");
      setDraftSlots([{ roleName: "", defaultPct: 100 }]);
    }
  };

  const saveDraft = async () => {
    const name = draftName.trim();
    const slots = draftSlots
      .map(s => ({ ...s, roleName: s.roleName.trim() }))
      .filter(s => s.roleName);
    if (!name) { setDraftErr("Give the template a name."); return; }
    if (!slots.length) { setDraftErr("Add at least one role."); return; }
    if (slots.some(s => !(s.defaultPct > 0) || s.defaultPct > 200)) {
      setDraftErr("Each role needs an allocation between 1% and 200%."); return;
    }
    const payload: Omit<AllocTemplateSlot, "id">[] = slots.map((s, i) => ({
      buName: null, divisionName: null, deptName: null,
      roleName: s.roleName, jobTitleName: null, defaultPct: s.defaultPct, sortOrder: i, resourceId: null,
    }));
    setBusyId(editId);
    try {
      const res = editId === "new"
        ? await createAllocTemplate(name, payload)
        : await updateAllocTemplate(editId as number, name, payload);
      if (!res.ok) throw new Error("save failed");
      setEditId(null);
      await reload();
      toast({ title: editId === "new" ? "Template created" : "Template updated" });
    } catch {
      setDraftErr("Couldn't save the template. Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (t: AllocTemplate) => {
    if (!window.confirm(`Delete the template "${t.name}"? Teams already staffed from it are not affected.`)) return;
    setBusyId(t.id);
    try {
      const res = await deleteAllocTemplate(t.id);
      if (!res.ok) throw new Error("delete failed");
      await reload();
      toast({ title: "Template deleted" });
    } catch {
      toast({ title: "Couldn't delete the template", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const editorCard = (
    <div style={{ ...PANEL, borderColor: "#14b8a640" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Layers size={15} style={{ color: "#14b8a6" }} />
        <span style={{ fontSize: 14, fontWeight: 700 }}>
          {editId === "new" ? "New template" : "Edit template"}
        </span>
      </div>
      <input
        value={draftName}
        onChange={e => setDraftName(e.target.value)}
        placeholder="Template name (e.g. Bridge Design Team)"
        maxLength={120}
        style={{
          width: "100%", padding: "8px 10px", borderRadius: 8, fontSize: 13,
          border: "1px solid hsl(var(--border))", background: "transparent",
          color: "hsl(var(--foreground))", marginBottom: 10,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {draftSlots.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              list="tmpl-role-options"
              value={s.roleName}
              onChange={e => setDraftSlots(prev => prev.map((p, j) => j === i ? { ...p, roleName: e.target.value } : p))}
              placeholder="Role (e.g. Project Manager)"
              style={{
                flex: 1, padding: "7px 10px", borderRadius: 8, fontSize: 13,
                border: "1px solid hsl(var(--border))", background: "transparent",
                color: "hsl(var(--foreground))",
              }}
            />
            <input
              type="number" min={1} max={200}
              value={s.defaultPct}
              onChange={e => setDraftSlots(prev => prev.map((p, j) => j === i ? { ...p, defaultPct: Number(e.target.value) } : p))}
              style={{
                width: 72, padding: "7px 8px", borderRadius: 8, fontSize: 13,
                border: "1px solid hsl(var(--border))", background: "transparent",
                color: "hsl(var(--foreground))",
              }}
            />
            <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>%</span>
            <button
              type="button" title="Remove role"
              onClick={() => setDraftSlots(prev => prev.filter((_, j) => j !== i))}
              style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", padding: 4 }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <datalist id="tmpl-role-options">
        {roleOptions.map(r => <option key={r} value={r} />)}
      </datalist>
      <button
        type="button"
        onClick={() => setDraftSlots(prev => [...prev, { roleName: "", defaultPct: 100 }])}
        style={{
          marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6,
          background: "none", border: "1px dashed hsl(var(--border))", borderRadius: 8,
          padding: "6px 10px", cursor: "pointer", fontSize: 12.5, color: "hsl(var(--muted-foreground))",
        }}
      >
        <Plus size={13} /> Add role
      </button>
      {draftErr && <p style={{ fontSize: 12, color: "#dc2626", marginTop: 8, marginBottom: 0 }}>{draftErr}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          type="button" onClick={saveDraft} disabled={busyId !== null}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "#14b8a6", color: "#fff", border: "none", borderRadius: 8,
            padding: "7px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600,
          }}
        >
          {busyId === editId ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {editId === "new" ? "Create template" : "Save changes"}
        </button>
        <button
          type="button" onClick={() => setEditId(null)}
          style={{
            background: "none", border: "1px solid hsl(var(--border))", borderRadius: 8,
            padding: "7px 14px", cursor: "pointer", fontSize: 13, color: "hsl(var(--foreground))",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "hsl(var(--foreground))" }}>Staffing Templates</h2>
        <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", marginTop: 4, marginBottom: 0 }}>
          Saved role mixes your team can apply when staffing a project (Team tab → Apply template).
          Deleting a template never changes teams that already used it.
        </p>
      </div>

      {loadErr && (
        <p style={{ fontSize: 12.5, color: "#dc2626" }}>
          Couldn't load the templates just now — <button type="button" onClick={() => void reload()} style={{ background: "none", border: "none", color: "#dc2626", textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: 12.5 }}>try again</button>.
        </p>
      )}

      {templates === null ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
          <Loader2 size={14} className="animate-spin" /> Loading templates…
        </div>
      ) : (
        <>
          {editId === "new" ? editorCard : (
            <button
              type="button" onClick={() => startEdit(null)}
              style={{
                alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6,
                background: "none", border: "1px dashed #14b8a680", borderRadius: 8,
                padding: "8px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#14b8a6",
              }}
            >
              <Plus size={14} /> New template
            </button>
          )}

          {templates.length === 0 && editId !== "new" && (
            <div style={{ ...PANEL, textAlign: "center", padding: 28 }}>
              <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", margin: 0 }}>
                No templates yet. Create one here, or save a project's current team as a template from its Team tab.
              </p>
            </div>
          )}

          {templates.map(t => editId === t.id ? <div key={t.id}>{editorCard}</div> : (
            <div key={t.id} style={PANEL}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Layers size={15} style={{ color: "#14b8a6", flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "hsl(var(--foreground))" }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
                    {t.slots.length} role{t.slots.length === 1 ? "" : "s"}
                    {t.createdBy ? ` · created by ${t.createdBy}` : ""}
                  </div>
                </div>
                <button type="button" title="Edit" onClick={() => startEdit(t)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", padding: 6 }}>
                  <Pencil size={14} />
                </button>
                <button type="button" title="Delete" onClick={() => void remove(t)} disabled={busyId === t.id}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", padding: 6 }}>
                  {busyId === t.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              </div>
              {t.slots.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {t.slots.map(s => (
                    <span key={s.id} style={{
                      fontSize: 12, padding: "3px 10px", borderRadius: 999,
                      border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))",
                    }}>
                      {s.roleName}{s.jobTitleName ? ` · ${s.jobTitleName}` : ""} · {s.defaultPct}%
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
