import { useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  GripVertical,
  Info,
  LockKeyhole,
  Menu,
  Pencil,
  Save,
  Sparkles,
  Users,
  X,
} from "lucide-react";

type Visibility = "everyone" | "hidden" | "groups" | "roles";
type Surface = "vertical" | "horizontal";
type Item = {
  id: string;
  label: string;
  description: string;
  defaultSurface?: Surface;
  locked?: string;
  roleBased?: boolean;
};

const items: Item[] = [
  { id: "quick", label: "Quick Actions", description: "Shortcuts for everyday work", defaultSurface: "horizontal" },
  { id: "manager", label: "Manager", description: "Your team's pulse and priorities", defaultSurface: "horizontal", roleBased: true },
  { id: "projects", label: "Projects", description: "Pipeline and active work" },
  { id: "reports", label: "Reports", description: "Saved reports and snapshots", roleBased: true },
  { id: "analytics", label: "Analytics Center", description: "Trends across the workspace", roleBased: true },
  { id: "usage", label: "Usage Analytics", description: "How your team uses RM ONE", roleBased: true },
  { id: "resources", label: "Resources", description: "People, contacts, and companies" },
  { id: "settings", label: "Admin settings", description: "Workspace configuration", locked: "Admins always see this" },
];

const groups = ["Leadership", "Project Managers", "Delivery Team", "North America"];
const roles = ["Admin", "Manager", "User", "Finance"];
const initialVisibility: Record<string, Visibility> = {
  quick: "everyone", manager: "roles", projects: "everyone", reports: "roles",
  analytics: "roles", usage: "roles", resources: "groups", settings: "everyone",
};
const initialSelections: Record<string, string[]> = {
  manager: ["Admin", "Manager"], reports: ["Admin", "Manager", "Finance"], analytics: ["Admin", "Manager"],
  usage: ["Admin"], resources: ["Leadership", "Project Managers", "Delivery Team"],
};

export function FriendlyGuided() {
  const [order, setOrder] = useState(items.map((item) => item.id));
  const [visibility, setVisibility] = useState(initialVisibility);
  const [selections, setSelections] = useState(initialSelections);
  const [surfaces, setSurfaces] = useState<Record<string, Surface>>(
    Object.fromEntries(items.map((item) => [item.id, item.defaultSurface ?? "vertical"])),
  );
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>("quick");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const dragged = useRef<string | null>(null);
  const snapshot = useMemo(() => JSON.stringify({ order, visibility, selections, surfaces, labels }), [order, visibility, selections, surfaces, labels]);
  const [lastSaved, setLastSaved] = useState(snapshot);
  const dirty = snapshot !== lastSaved;

  const itemById = (id: string) => items.find((item) => item.id === id)!;
  const toggleSelection = (id: string, value: string) => {
    setSelections((current) => {
      const values = current[id] ?? [];
      return { ...current, [id]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value] };
    });
  };
  const drop = (target: string) => {
    const source = dragged.current;
    dragged.current = null;
    if (!source || source === target) return;
    setOrder((current) => {
      const next = [...current];
      next.splice(next.indexOf(source), 1);
      next.splice(next.indexOf(target), 0, source);
      return next;
    });
  };
  const save = () => {
    setSaving(true);
    window.setTimeout(() => {
      setLastSaved(snapshot);
      setSaving(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 3500);
    }, 550);
  };
  const move = (id: string, direction: "up" | "down") => {
    setOrder((current) => {
      const next = [...current];
      const index = next.indexOf(id);
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= next.length) return next;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  return (
    <main className="friendly-guided min-h-screen">
      <style>{`
        .friendly-guided{--ink:#26333a;--muted:#6d7b78;--line:#dfe7df;--paper:#fbfcf8;--mint:#e7f1e8;--sage:#447b65;--deep:#244f4c;--peach:#f6e8d9;box-sizing:border-box;background:#f3f6ef;color:var(--ink);font-family:"DM Sans","Plus Jakarta Sans",system-ui,sans-serif;min-height:100vh}
        .friendly-guided *{box-sizing:border-box}.fg-shell{max-width:1240px;margin:0 auto;padding:28px 32px 42px}
        .fg-top{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:27px}.fg-brand{display:flex;align-items:center;gap:11px;font-weight:750;letter-spacing:-.02em}.fg-mark{height:30px;width:30px;display:grid;place-items:center;border-radius:9px;background:var(--deep);color:#f6d9ae;font-size:15px}.fg-breadcrumb{color:var(--muted);font-size:12px;margin-left:17px;padding-left:17px;border-left:1px solid var(--line)}
        .fg-status{display:flex;align-items:center;gap:9px;color:var(--muted);font-size:12px}.fg-dot{width:7px;height:7px;border-radius:50%;background:#98bba1}.fg-heading{max-width:730px;margin-bottom:28px}.fg-kicker{font-size:12px;color:var(--sage);font-weight:750;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px}.fg-heading h1{font-family:Georgia,serif;font-weight:500;font-size:clamp(30px,4vw,45px);line-height:1.03;letter-spacing:-.045em;margin:0 0 12px}.fg-heading p{color:var(--muted);font-size:14px;line-height:1.65;margin:0;max-width:625px}
        .fg-layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:22px;align-items:start}.fg-card{background:var(--paper);border:1px solid var(--line);border-radius:18px;box-shadow:0 10px 35px rgba(40,64,56,.06)}.fg-steps{padding:19px 20px 22px}.fg-stephead{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.fg-stephead strong{font-size:14px}.fg-count{color:var(--muted);font-size:12px}.fg-row{border:1px solid var(--line);border-radius:13px;margin-top:10px;background:#fff;transition:transform .2s ease,box-shadow .2s ease}.fg-row.is-open{box-shadow:0 6px 18px rgba(59,91,76,.08)}.fg-rowhead{display:flex;align-items:center;gap:10px;padding:14px 14px;cursor:pointer}.fg-grip{color:#aab8b0;cursor:grab;display:flex}.fg-rowtitle{font-size:13px;font-weight:700;flex:1}.fg-rowdesc{font-size:11px;color:var(--muted);margin-top:3px}.fg-chip{font-size:10px;padding:4px 8px;border-radius:999px;background:var(--mint);color:var(--deep);font-weight:700;white-space:nowrap}.fg-lock{font-size:10px;color:var(--muted);display:flex;align-items:center;gap:5px;white-space:nowrap}.fg-chevron{color:#81918a;transition:transform .2s ease}.fg-chevron.open{transform:rotate(180deg)}
        .fg-detail{padding:0 16px 16px 43px;border-top:1px solid #edf1ec}.fg-question{font-size:12px;font-weight:700;margin:15px 0 8px;color:#35453f}.fg-segments{display:flex;flex-wrap:wrap;gap:6px}.fg-segment{border:1px solid var(--line);background:#fafcf9;color:var(--muted);border-radius:8px;padding:7px 10px;font-size:11px;cursor:pointer}.fg-segment.active{background:var(--mint);border-color:#9cc3a5;color:var(--deep);font-weight:700}.fg-segment.danger.active{background:#f9e9e3;border-color:#e8bba6;color:#99513d}.fg-subtle{font-size:11px;color:var(--muted);line-height:1.45;margin:9px 0 0}.fg-pills{display:flex;gap:6px;flex-wrap:wrap}.fg-pill{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 10px;font-size:11px;color:var(--muted);cursor:pointer}.fg-pill.active{background:#edf5ea;border-color:#9cc3a5;color:var(--deep);font-weight:700}.fg-input{margin-top:15px;display:flex;align-items:center;gap:8px}.fg-input label{font-size:11px;color:var(--muted);white-space:nowrap}.fg-input input{width:100%;border:1px solid var(--line);background:#fbfcfa;border-radius:8px;padding:8px 10px;font-size:12px;color:var(--ink);outline:none}.fg-input input:focus{border-color:#83ab8e;box-shadow:0 0 0 3px rgba(131,171,142,.16)}
        .fg-surface{display:flex;align-items:center;gap:8px;margin-top:13px}.fg-surface span{font-size:11px;color:var(--muted)}.fg-toggle{display:flex;background:#f1f5f0;border-radius:8px;padding:3px}.fg-toggle button{border:0;background:transparent;padding:6px 10px;border-radius:6px;color:var(--muted);font-size:11px;cursor:pointer}.fg-toggle button.active{background:#fff;color:var(--deep);font-weight:700;box-shadow:0 1px 4px rgba(40,70,55,.1)}
        .fg-preview{padding:17px;position:sticky;top:18px}.fg-previewtop{display:flex;justify-content:space-between;align-items:center;margin-bottom:13px}.fg-previewtop strong{font-size:13px}.fg-live{font-size:10px;color:var(--sage);font-weight:700;display:flex;align-items:center;gap:5px}.fg-live:before{content:"";width:6px;height:6px;background:#7faf89;border-radius:50%}.fg-note{font-size:11px;line-height:1.5;color:var(--muted);background:#f8f1e7;border-radius:10px;padding:10px 11px;margin-bottom:14px}.fg-window{border:1px solid #d7e1d7;border-radius:12px;background:#fff;overflow:hidden}.fg-windowbar{background:#315957;color:#eaf4e8;padding:12px 13px;font-weight:700;font-size:12px;display:flex;justify-content:space-between}.fg-windowbody{display:flex;min-height:304px}.fg-side{width:111px;background:#edf4ed;padding:12px 8px}.fg-side small{font-size:9px;color:#7b9183;text-transform:uppercase;letter-spacing:.09em;display:block;margin:0 5px 8px}.fg-nav{display:flex;align-items:center;gap:6px;padding:7px 6px;border-radius:7px;font-size:10px;color:#64766b;margin:2px 0}.fg-nav.active{background:#d4e7d3;color:#285b4e;font-weight:700}.fg-nav.horizontal{display:none}.fg-main{padding:17px 13px;flex:1}.fg-main .eyebrow{font-size:9px;text-transform:uppercase;color:#89a194;letter-spacing:.1em}.fg-main h3{font-family:Georgia,serif;font-weight:500;font-size:22px;margin:7px 0 17px}.fg-placeholder{height:9px;background:#edf2ec;border-radius:5px;margin:8px 0;width:82%}.fg-placeholder.short{width:54%}.fg-horizontal{border-top:1px solid #dce8dc;padding:8px 10px;display:flex;gap:3px;background:#f7faf6}.fg-horizontal .fg-nav{display:flex;font-size:9px;padding:5px 6px}.fg-footer{display:flex;align-items:center;gap:12px;margin-top:16px}.fg-save{border:0;background:var(--deep);color:#fff;border-radius:9px;padding:10px 16px;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:7px}.fg-save:disabled{background:#b9c8bc;cursor:default}.fg-undo{border:0;background:transparent;color:var(--muted);font-size:11px;cursor:pointer}.fg-saved{color:var(--sage);font-size:11px;display:flex;align-items:center;gap:5px}.fg-tip{display:flex;gap:8px;align-items:flex-start;color:var(--muted);font-size:11px;line-height:1.5;margin:17px 4px 0}.fg-tip svg{flex:0 0 auto;color:#92ad99}.fg-reorder{display:flex;gap:2px}.fg-reorder button{border:0;background:transparent;color:#9aa9a0;padding:3px;cursor:pointer}.fg-reorder button:disabled{opacity:.25}
        @media(max-width:850px){.fg-layout{grid-template-columns:1fr}.fg-preview{position:static;order:-1}.fg-windowbody{min-height:220px}.fg-side{width:135px}}@media(max-width:560px){.fg-shell{padding:20px 14px 30px}.fg-top{margin-bottom:22px}.fg-breadcrumb{display:none}.fg-heading h1{font-size:34px}.fg-layout{gap:14px}.fg-detail{padding-left:16px}.fg-lock{display:none}.fg-rowhead{padding:12px}.fg-preview{padding:13px}.fg-footer{flex-wrap:wrap}}
      `}</style>
      <div className="fg-shell">
        <header className="fg-top">
          <div className="fg-brand"><span className="fg-mark">R</span><span>RM ONE</span><span className="fg-breadcrumb">Workspace settings / Navigation</span></div>
          <div className="fg-status"><span className="fg-dot" />Private workspace <span style={{ color: "#b2beb5" }}>•</span> Northstar Group</div>
        </header>
        <section className="fg-heading">
          <div className="fg-kicker">Make it feel like your team</div>
          <h1>Set up your team’s navigation</h1>
          <p>Answer a few small questions about what people should see. You can always come back and adjust this as your workspace grows.</p>
        </section>
        <div className="fg-layout">
          <section>
            <div className="fg-card fg-steps">
              <div className="fg-stephead"><strong>1. Choose what belongs in the menu</strong><span className="fg-count">{order.length} items · drag to arrange</span></div>
              {order.map((id, index) => {
                const item = itemById(id);
                const isOpen = open === id;
                const mode = visibility[id];
                const choices: { value: Visibility; label: string }[] = item.roleBased
                  ? [{ value: "everyone", label: "Everyone" }, { value: "hidden", label: "Hidden" }, { value: "roles", label: "Selected access levels" }]
                  : [{ value: "everyone", label: "Everyone" }, { value: "hidden", label: "Hidden" }, { value: "groups", label: "Selected user groups" }];
                return (
                  <div className={`fg-row ${isOpen ? "is-open" : ""}`} key={id} draggable onDragStart={() => { dragged.current = id; }} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(id)}>
                    <div className="fg-rowhead" onClick={() => setOpen(isOpen ? null : id)}>
                      <span className="fg-grip" title="Drag to reorder"><GripVertical size={16} /></span>
                      <div className="fg-rowtitle"><div>{labels[id] || item.label}</div><div className="fg-rowdesc">{item.description}</div></div>
                      {surfaces[id] === "horizontal" && <span className="fg-chip">Top bar</span>}
                      {item.locked && <span className="fg-lock"><LockKeyhole size={12} /> Locked</span>}
                      {!item.locked && <div className="fg-reorder"><button aria-label="Move up" disabled={index === 0} onClick={(e) => { e.stopPropagation(); move(id, "up"); }}><ArrowUp size={13} /></button><button aria-label="Move down" disabled={index === order.length - 1} onClick={(e) => { e.stopPropagation(); move(id, "down"); }}><ArrowDown size={13} /></button></div>}
                      <ChevronDown className={`fg-chevron ${isOpen ? "open" : ""}`} size={16} />
                    </div>
                    {isOpen && <div className="fg-detail">
                      {item.locked ? <p className="fg-subtle"><LockKeyhole size={13} style={{ verticalAlign: "middle", marginRight: 5 }} />{item.locked}. This keeps workspace controls safe for the people who manage them.</p> : <>
                        <div className="fg-question">Who should see this item?</div>
                        <div className="fg-segments">{choices.map((choice) => <button key={choice.value} className={`fg-segment ${choice.value === mode ? "active" : ""} ${choice.value === "hidden" ? "danger" : ""}`} onClick={() => setVisibility({ ...visibility, [id]: choice.value })}>{choice.value === "everyone" && <Users size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />}{choice.label}</button>)}</div>
                        {mode === "groups" && <div className="fg-pills" style={{ marginTop: 9 }}>{groups.map((group) => <button key={group} className={`fg-pill ${(selections[id] ?? []).includes(group) ? "active" : ""}`} onClick={() => toggleSelection(id, group)}>{group}</button>)}</div>}
                        {mode === "roles" && <div className="fg-pills" style={{ marginTop: 9 }}>{roles.map((role) => <button key={role} className={`fg-pill ${(selections[id] ?? []).includes(role) ? "active" : ""}`} onClick={() => toggleSelection(id, role)}>{role}</button>)}</div>}
                        {mode === "hidden" && <p className="fg-subtle">This item will stay out of the menu for everyone. Existing links still work.</p>}
                        <div className="fg-surface"><span>Place in</span><div className="fg-toggle"><button className={surfaces[id] === "vertical" ? "active" : ""} onClick={() => setSurfaces({ ...surfaces, [id]: "vertical" })}><Menu size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />Sidebar</button><button className={surfaces[id] === "horizontal" ? "active" : ""} onClick={() => setSurfaces({ ...surfaces, [id]: "horizontal" })}>Top bar</button></div></div>
                        <div className="fg-input"><Pencil size={13} color="#8ba092" /><label htmlFor={`label-${id}`}>Menu label</label><input id={`label-${id}`} value={labels[id] ?? ""} placeholder={item.label} maxLength={40} onChange={(e) => setLabels({ ...labels, [id]: e.target.value })} /></div>
                      </>}
                    </div>}
                  </div>
                );
              })}
              <div className="fg-footer">
                <button className="fg-save" disabled={!dirty || saving} onClick={save}>{saving ? <span>Saving…</span> : <><Save size={14} />Save navigation</>}</button>
                {dirty && !saving && <span style={{ color: "#a66a45", fontSize: 11 }}>You have unsaved changes</span>}
                {saved && !dirty && <span className="fg-saved"><Check size={14} />Saved. Your team will see this next time they navigate.</span>}
              </div>
            </div>
            <div className="fg-tip"><Info size={15} /><span>Tip: use the drag handle or the arrow buttons to change the order. Renaming only changes the menu label — page titles and links stay the same.</span></div>
          </section>
          <aside className="fg-card fg-preview">
            <div className="fg-previewtop"><strong>What teammates will see</strong><span className="fg-live">Live preview</span></div>
            <div className="fg-note"><Sparkles size={13} style={{ verticalAlign: "middle", marginRight: 5, color: "#b27a4e" }} />Quick Actions and Manager stay easy to reach in the top bar.</div>
            <div className="fg-window">
              <div className="fg-windowbar"><span>RM ONE</span><span style={{ fontSize: 10, opacity: .7 }}>Taylor · Delivery Team</span></div>
              <div className="fg-windowbody"><nav className="fg-side"><small>Workspace</small>{order.map((id) => { const item = itemById(id); if (visibility[id] === "hidden" || surfaces[id] === "horizontal" || (visibility[id] === "groups" && !(selections[id] ?? []).includes("Delivery Team")) || (visibility[id] === "roles" && !(selections[id] ?? []).includes("User"))) return null; return <div className={`fg-nav ${id === "projects" ? "active" : ""}`} key={id}><span style={{ width: 5, height: 5, borderRadius: 2, background: id === "projects" ? "#4b816d" : "#adc1b0" }} />{labels[id] || item.label}</div>; })}</nav><div className="fg-main"><div className="eyebrow">Good morning, Taylor</div><h3>Projects</h3><div className="fg-placeholder" /><div className="fg-placeholder short" /><div className="fg-placeholder" /></div></div>
              <div className="fg-horizontal">{order.map((id) => { const item = itemById(id); if (surfaces[id] !== "horizontal" || visibility[id] === "hidden") return null; return <div className="fg-nav horizontal" key={id}>{labels[id] || item.label}</div>; })}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 13, color: "#84958a", fontSize: 10 }}><span><Users size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />Delivery Team view</span><span>{order.filter((id) => visibility[id] !== "hidden").length} visible items</span></div>
          </aside>
        </div>
      </div>
    </main>
  );
}