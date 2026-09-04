import { useMemo, useRef, useState } from "react";
import { Check, GripVertical, Lock, Save } from "lucide-react";
import "./_group.css";

type Mode = "everyone" | "hidden" | "groups" | "roles";
type Surface = "vertical" | "horizontal";
type NavItem = { id: string; label: string; sub?: string; neverHide?: boolean; adminOnly?: boolean; editorOnly?: boolean; surface?: Surface };
type Row = { mode: Mode; groups: string[]; roles: string[] };

const items: NavItem[] = [
  { id: "home", label: "Home", neverHide: true },
  { id: "ai", label: "AI" }, { id: "quickActions", label: "Quick Actions", surface: "horizontal" },
  { id: "manager", label: "Manager", surface: "horizontal" }, { id: "people", label: "People", sub: "Resources" },
  { id: "crm", label: "CRM", sub: "Contacts & Companies" }, { id: "leads", label: "Leads & Opportunities" },
  { id: "projects", label: "Projects", sub: "Pipeline & Active" }, { id: "forecast", label: "Forecast" },
  { id: "reports", label: "Reports" }, { id: "analytics", label: "Analytics", editorOnly: true },
  { id: "analyticsCenter", label: "Analytics Center" }, { id: "archive", label: "Archive", sub: "Closed Records" },
  { id: "alerts", label: "Alerts" }, { id: "import", label: "Import" },
  { id: "settings", label: "Settings", sub: "Admin", adminOnly: true }, { id: "usageAnalytics", label: "Usage Analytics" },
  { id: "system", label: "System", adminOnly: true },
];
const groups = ["Leadership", "Project Managers", "Delivery Team", "Sales & Business Development", "North America"];
const roleIds = ["admin", "manager", "user", "custom:finance"];
const roleNames: Record<string, string> = { admin: "Admin", manager: "Manager", user: "User", "custom:finance": "Finance" };
const roleItems = new Set(["manager", "reports", "analyticsCenter", "usageAnalytics"]);
const initialRows = (): Record<string, Row> => Object.fromEntries(items.map((item) => [
  item.id,
  roleItems.has(item.id)
    ? { mode: "roles", groups: [], roles: item.id === "usageAnalytics" ? ["admin"] : ["admin", "manager", "custom:finance"] }
    : { mode: "everyone", groups: [], roles: [] },
]));

const h = (name: string) => {
  const [token, alpha] = name.split(" / ");
  return alpha ? `hsl(var(--${token}) / ${alpha})` : `hsl(var(--${token}))`;
};

export function Current() {
  const [rows, setRows] = useState(initialRows);
  const [order, setOrder] = useState(items.map((item) => item.id));
  const [labels, setLabels] = useState<Record<string, string>>({ people: "Team" });
  const [surfaces, setSurfaces] = useState<Record<string, Surface>>(() => Object.fromEntries(items.map((item) => [item.id, item.surface ?? "vertical"])));
  const [saved, setSaved] = useState(() => JSON.stringify({ rows: initialRows(), order: items.map((item) => item.id), labels: { people: "Team" }, surfaces: Object.fromEntries(items.map((item) => [item.id, item.surface ?? "vertical"])) }));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const dragged = useRef<string | null>(null);
  const dirty = useMemo(() => JSON.stringify({ rows, order, labels, surfaces }) !== saved, [rows, order, labels, surfaces, saved]);
  const update = (id: string, patch: Partial<Row>) => setRows((old) => ({ ...old, [id]: { ...old[id], ...patch } }));
  const toggle = (id: string, key: "groups" | "roles", value: string) => {
    const values = rows[id][key];
    update(id, { [key]: values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value] } as Partial<Row>);
  };
  const save = () => {
    setSaving(true);
    window.setTimeout(() => {
      setSaved(JSON.stringify({ rows, order, labels, surfaces }));
      setSaving(false);
      setNotice("Menu saved — people will see the updated menu on their next page change.");
    }, 500);
  };
  const drop = (target: string) => {
    const source = dragged.current;
    dragged.current = null;
    if (!source || source === target) return;
    setOrder((old) => {
      const next = [...old]; const from = next.indexOf(source); const to = next.indexOf(target);
      next.splice(from, 1); next.splice(to, 0, source); return next;
    });
  };

  return <main className="navigation-settings-current min-h-screen" style={{ padding: "32px", minHeight: "100vh" }}>
    <section style={{ maxWidth: 1120, margin: "0 auto" }}>
      <header style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Navigation</h2>
        <p style={{ fontSize: 13, color: h("muted-foreground"), margin: "6px 0 0", lineHeight: 1.6, maxWidth: 640 }}>
          Choose which menu items your team see, place each item in the vertical sidebar or horizontal top bar, drag to reorder them, and optionally give any item a custom display name. Home always stays visible, and admins always keep Import, Settings and System.
        </p>
      </header>
      <div style={{ overflow: "hidden", background: h("card"), border: `1px solid ${h("border")}`, borderRadius: 12 }}>
        {order.map((id, index) => {
          const item = items.find((entry) => entry.id === id)!;
          const row = rows[id]; const locked = Boolean(item.neverHide || item.adminOnly);
          const modes: { value: Mode; label: string }[] = roleItems.has(id)
            ? [{ value: "everyone", label: "Everyone" }, { value: "hidden", label: "Hidden" }, { value: "roles", label: "Only these access levels" }]
            : [{ value: "everyone", label: "Everyone" }, { value: "hidden", label: "Hidden" }, { value: "groups", label: "Only these groups" }];
          return <div key={id} draggable onDragStart={() => { dragged.current = id; }} onDragOver={(event) => event.preventDefault()} onDrop={() => drop(id)}
            style={{ padding: "13px 16px", borderTop: index ? `1px solid ${h("border")}` : "none", opacity: locked ? .75 : 1, display: "flex", flexDirection: "column", gap: 10, userSelect: "none" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <span title="Drag to reorder" style={{ display: "inline-flex", color: h("muted-foreground"), opacity: .5, cursor: "grab", paddingTop: 2 }}><GripVertical size={14} /></span>
              <div style={{ minWidth: 180, flex: "1 1 180px", display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{item.label}{item.sub && <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 400, color: h("muted-foreground") }}>({item.sub})</span>}</span>
                {!locked && <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <input aria-label={`Custom name for ${item.label}`} value={labels[id] ?? ""} onChange={(event) => setLabels((old) => ({ ...old, [id]: event.target.value }))}
                    placeholder={`Custom name (default: "${item.label}")`} maxLength={60}
                    style={{ width: "100%", maxWidth: 260, padding: "4px 8px", border: `1px solid ${h("border")}`, borderRadius: 6, outline: "none", background: h("background"), color: h("foreground"), fontSize: 12 }} />
                  {labels[id] && <span style={{ color: h("primary"), fontSize: 11.5, whiteSpace: "nowrap" }}>Shows as "{labels[id]}"</span>}
                </div>}
                {item.editorOnly && !locked && <span style={{ fontSize: 11.5, color: h("muted-foreground") }}>Read-only accounts never see this item.</span>}
              </div>
              {locked ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", border: `1px solid ${h("border")}`, borderRadius: 999, fontSize: 12, color: h("muted-foreground") }}><Lock size={12} />{item.neverHide ? "Always visible — hidden pages send people here" : "Admin screen — only admins see it, and it can't be hidden from them"}</span>
                : <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "1 1 560px", minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 11.5, color: h("muted-foreground") }}>Place in</span><Segment options={[["vertical", "Vertical"], ["horizontal", "Horizontal"]]} value={surfaces[id]} onChange={(value) => setSurfaces((old) => ({ ...old, [id]: value as Surface }))} /></div>
                    <Segment options={modes.map((mode) => [mode.value, mode.label])} value={row.mode} destructive="hidden" onChange={(value) => update(id, { mode: value as Mode })} />
                  </div>
                  {row.mode === "groups" && <div role="list" style={{ display: "flex", overflowX: "auto", gap: 6, padding: "2px 2px 7px" }}>{groups.map((group) => <Pill key={group} label={group} on={row.groups.includes(group)} onClick={() => toggle(id, "groups", group)} />)}</div>}
                  {row.mode === "roles" && <div role="list" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{roleIds.map((role) => <Pill key={role} label={roleNames[role]} on={row.roles.includes(role)} onClick={() => toggle(id, "roles", role)} />)}</div>}
                </div>}
            </div>
          </div>;
        })}
      </div>
      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="button" disabled={!dirty || saving} onClick={save} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "none", borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: dirty && !saving ? "pointer" : "default", background: dirty && !saving ? h("primary") : h("muted"), color: dirty && !saving ? h("primary-foreground") : h("muted-foreground") }}>
          {saving ? <span style={{ width: 14, height: 14, border: "2px solid currentColor", borderRightColor: "transparent", borderRadius: "50%", animation: "navigation-settings-spin 1s linear infinite" }} /> : <Save size={14} />}{saving ? "Saving…" : "Save menu"}
        </button>
        {dirty && !saving && <span style={{ fontSize: 12.5, color: h("muted-foreground") }}>Unsaved changes</span>}
        {notice && !dirty && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: h("primary") }}><Check size={14} />{notice}</span>}
      </div>
      <p style={{ maxWidth: 640, marginTop: 14, fontSize: 12, lineHeight: 1.6, color: h("muted-foreground") }}>Tip: drag the grip handle <GripVertical size={11} style={{ verticalAlign: "middle", opacity: .55 }} /> to reorder items. Type a custom name in the text field to rename an item in the sidebar only — page titles stay the same. Visibility rules apply to admins too, except the locked admin screens.</p>
    </section>
  </main>;
}

function Segment({ options, value, onChange, destructive }: { options: string[][]; value: string; onChange: (value: string) => void; destructive?: string }) {
  return <div role="group" style={{ display: "inline-flex", overflow: "hidden", border: `1px solid ${h("border")}`, borderRadius: 9 }}>{options.map(([id, label]) => {
    const active = value === id; const danger = id === destructive;
    return <button key={id} type="button" aria-pressed={active} onClick={() => onChange(id)} style={{ border: "none", padding: "6px 10px", background: active ? h(`${danger ? "destructive" : "primary"} / 0.12`) : "transparent", color: active ? h(danger ? "destructive" : "primary") : h("muted-foreground"), fontSize: 12, fontWeight: active ? 650 : 400, cursor: "pointer" }}>{label}</button>;
  })}</div>;
}

function Pill({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} style={{ flex: "0 0 auto", padding: "4px 11px", border: `1px solid ${on ? h("primary") : h("border")}`, borderRadius: 999, background: on ? h("primary / 0.10") : h("card"), color: on ? h("primary") : h("muted-foreground"), fontSize: 12.5, fontWeight: on ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap" }}>{label}</button>;
}