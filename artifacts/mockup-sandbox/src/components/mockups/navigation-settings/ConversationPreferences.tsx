import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, GripVertical, Info, Lock, Save, SlidersHorizontal } from "lucide-react";

type Mode = "everyone" | "hidden" | "groups" | "roles";
type Surface = "vertical" | "horizontal";
type Item = { id: string; label: string; detail?: string; locked?: string; roleOnly?: boolean; defaultSurface?: Surface };
type Rule = { mode: Mode; groups: string[]; roles: string[] };

const items: Item[] = [
  { id: "quick", label: "Quick Actions", detail: "Shortcuts your team uses most", defaultSurface: "horizontal" },
  { id: "manager", label: "Manager", detail: "Your team’s daily view", defaultSurface: "horizontal" },
  { id: "projects", label: "Projects", detail: "Pipeline & active work" },
  { id: "reports", label: "Reports", detail: "Saved views and exports", roleOnly: true },
  { id: "analytics", label: "Analytics Center", detail: "Company-wide patterns", roleOnly: true },
  { id: "usage", label: "Usage Analytics", detail: "Workspace adoption", roleOnly: true },
  { id: "resources", label: "Resources", detail: "People, contacts & companies" },
  { id: "settings", label: "Admin settings", detail: "Workspace controls", locked: "Admins always have access" },
];
const groups = ["Leadership", "Project Managers", "Delivery Team", "Sales & Business Development"];
const roles = ["Admin", "Manager", "User", "Finance"];

const initialRules = (): Record<string, Rule> => Object.fromEntries(items.map((item) => [
  item.id,
  item.roleOnly
    ? { mode: "roles", groups: [], roles: ["Admin", "Manager", "Finance"] }
    : { mode: "everyone", groups: [], roles: [] },
]));

export function ConversationPreferences() {
  const [order, setOrder] = useState(items.map((item) => item.id));
  const [rules, setRules] = useState(initialRules);
  const [surfaces, setSurfaces] = useState<Record<string, Surface>>(() => Object.fromEntries(items.map((item) => [item.id, item.defaultSurface ?? "vertical"])));
  const [names, setNames] = useState<Record<string, string>>({ resources: "Team" });
  const [saved, setSaved] = useState(() => JSON.stringify({ order: items.map((item) => item.id), rules: initialRules(), surfaces: Object.fromEntries(items.map((item) => [item.id, item.defaultSurface ?? "vertical"])), names: { resources: "Team" } }));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const dragged = useRef<string | null>(null);
  const current = useMemo(() => JSON.stringify({ order, rules, surfaces, names }), [order, rules, surfaces, names]);
  const dirty = current !== saved;
  const updateRule = (id: string, patch: Partial<Rule>) => setRules((old) => ({ ...old, [id]: { ...old[id], ...patch } }));
  const toggle = (id: string, key: "groups" | "roles", value: string) => {
    const values = rules[id][key];
    updateRule(id, { [key]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value] } as Partial<Rule>);
  };
  const move = (id: string, delta: number) => setOrder((old) => {
    const next = [...old]; const from = next.indexOf(id); const to = Math.max(0, Math.min(next.length - 1, from + delta));
    next.splice(from, 1); next.splice(to, 0, id); return next;
  });
  const save = () => {
    setSaving(true);
    window.setTimeout(() => { setSaved(current); setSaving(false); setNotice("Saved. Your team will see these choices the next time they change pages."); }, 500);
  };
  const modeLabel = (rule: Rule) => rule.mode === "everyone" ? "everyone" : rule.mode === "hidden" ? "no one" : rule.mode === "groups" ? `${rule.groups.length || 0} selected groups` : `${rule.roles.length || 0} access levels`;

  return (
    <main className="conversation-page">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap');
        .conversation-page{min-height:100vh;background:#f4f0e9;color:#273b3b;font-family:'DM Sans',sans-serif;padding:28px clamp(18px,4vw,64px) 56px}
        .conversation-page *{box-sizing:border-box}.shell{max-width:1180px;margin:auto}
        .topbar{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #d7d8cd;padding-bottom:18px}
        .brand{display:flex;align-items:center;gap:11px;font-weight:700;letter-spacing:-.02em}.brandmark{width:28px;height:28px;background:#b7d36b;border-radius:8px;display:grid;place-items:center;color:#28423c;font-size:13px}
        .crumb{font-size:12px;color:#6f7e79;margin:0 0 4px}.workspace{font-size:13px;font-weight:600}.help{border:1px solid #cfd5c8;background:transparent;border-radius:20px;padding:8px 13px;color:#48605a;font-size:12px}
        .intro{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(310px,.92fr);gap:64px;padding:56px 0 36px;align-items:end}
        h1{font:600 clamp(34px,4.6vw,58px)/1.02 'Fraunces',serif;letter-spacing:-.045em;margin:0;color:#294744}.intro p{font-size:15px;line-height:1.7;color:#65726e;max-width:550px;margin:18px 0 0}
        .summary{border-left:3px solid #b7d36b;padding:8px 0 8px 19px;color:#3f5a55;font-size:14px;line-height:1.65}.summary strong{display:block;color:#294744;margin-bottom:4px}
        .content{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr);gap:24px;align-items:start}
        .panel{background:#fbfaf6;border:1px solid #d8dcd2;border-radius:18px;box-shadow:0 12px 30px rgba(48,69,61,.06)}.panel-head{padding:21px 24px 16px;border-bottom:1px solid #e1e4db}.eyebrow{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#8b948e;font-weight:700}.panel-head h2{font-size:18px;margin:6px 0 4px;letter-spacing:-.02em}.panel-head p{margin:0;color:#718079;font-size:12px;line-height:1.5}
        .row{padding:20px 24px;border-bottom:1px solid #e5e7df;display:grid;grid-template-columns:22px minmax(150px,.75fr) minmax(260px,1.25fr);gap:14px;align-items:start}.row:last-child{border-bottom:0}.grip{color:#a5b0a6;cursor:grab;margin-top:4px}.item-title{font-size:14px;font-weight:700;color:#324d49}.item-detail{font-size:11px;color:#87918b;margin-top:4px;line-height:1.4}.lock-note{display:flex;gap:7px;margin-top:9px;color:#7a847e;font-size:11px;line-height:1.4}.lock-note svg{flex:none}
        .controls{display:flex;flex-direction:column;gap:11px}.prompt{font-size:12px;color:#65756d;line-height:1.45}.prompt b{color:#3b514d}.selectline{display:flex;flex-wrap:wrap;gap:7px}.choice{border:1px solid #d4dcd1;background:#f8f8f3;color:#63716b;border-radius:9px;padding:7px 9px;font-size:11px;cursor:pointer}.choice.active{background:#dfeabf;border-color:#aec76d;color:#304b3f;font-weight:700}.choice.danger.active{background:#f1dfd2;border-color:#d7ad8f;color:#89513b}.surface{display:flex;gap:6px;align-items:center;font-size:11px;color:#7b8881}.surface button{border:0;background:transparent;color:#7d8982;cursor:pointer;padding:2px}.surface button.active{color:#3e6256;font-weight:700;text-decoration:underline;text-underline-offset:3px}
        .pills{display:flex;flex-wrap:wrap;gap:6px}.pill{border:1px solid #d6ded3;border-radius:999px;background:#fafaf6;color:#718079;padding:5px 9px;font-size:11px;cursor:pointer}.pill.on{background:#edf3dc;border-color:#b7d36b;color:#466048;font-weight:600}
        .rename{border:0;border-bottom:1px solid #cbd4c8;background:transparent;width:100%;font-size:12px;padding:5px 0;color:#304b46;outline:none}.rename:focus{border-color:#789d78}.rename::placeholder{color:#a0aaa3}
        .preview{position:sticky;top:20px;padding:22px}.preview-top{display:flex;justify-content:space-between;align-items:start;margin-bottom:21px}.preview h2{font:600 25px 'Fraunces',serif;margin:5px 0 0}.live{font-size:10px;color:#597250;background:#e6efd1;padding:5px 8px;border-radius:99px;font-weight:700}.menu{border:1px solid #d9ded4;border-radius:13px;padding:11px;background:#f5f6f0}.menu-label{font-size:10px;text-transform:uppercase;letter-spacing:.13em;color:#99a39b;margin:3px 9px 9px}.menu-item{display:flex;align-items:center;gap:9px;padding:10px 9px;border-radius:8px;color:#47625b;font-size:12px}.menu-item.active{background:#dfeabf;color:#2c4d42;font-weight:700}.dot{width:5px;height:5px;background:#9aae83;border-radius:50%}.bar{margin:17px 0 8px;font-size:10px;color:#8d9890;text-transform:uppercase;letter-spacing:.12em}.h-items{display:flex;gap:7px;flex-wrap:wrap}.h-item{border:1px solid #d8dfd3;padding:7px 8px;border-radius:8px;font-size:11px;color:#557069;background:#fafaf7}.preview-note{font-size:11px;line-height:1.6;color:#7c8981;margin:17px 2px 0}.footer{display:flex;align-items:center;gap:14px;margin-top:22px}.save{border:0;border-radius:10px;background:#365f55;color:#f8f7ef;padding:11px 17px;font-weight:700;font-size:12px;cursor:pointer;display:flex;gap:8px;align-items:center}.save:disabled{background:#c5cec2;color:#718078;cursor:default}.status{font-size:12px;color:#76837c}.status.saved{color:#4e7455}
        @media(max-width:850px){.intro,.content{grid-template-columns:1fr;gap:24px}.preview{position:static}.row{grid-template-columns:20px 1fr}.controls{grid-column:2}.intro{padding-top:36px}}@media(max-width:520px){.conversation-page{padding:20px 14px 40px}.topbar .help{display:none}.row{padding:17px 14px}.panel-head{padding:18px 14px}.intro{padding-bottom:26px}.preview{padding:17px}}
      `}</style>
      <div className="shell">
        <div className="topbar"><div className="brand"><span className="brandmark">RM</span><span>RM ONE</span><span style={{ color: "#9aa39d", fontWeight: 400 }}>/ Workspace settings</span></div><button className="help" type="button" onClick={() => setNotice("Navigation changes apply per workspace, not globally.")}>How this works</button></div>
        <section className="intro"><div><p className="crumb">Workspace / Navigation</p><h1>Let’s make the menu feel right for your team.</h1><p>There is no perfect menu for every company. Tell us where each destination should live, who it is for, and what your team should call it.</p></div><div className="summary"><strong>A quick read of your current plan</strong>Quick Actions and Manager are in the top bar for fast access. Reports, Analytics Center, and Usage Analytics are reserved for selected access levels. You can change any choice below.</div></section>
        <div className="content">
          <section className="panel"><div className="panel-head"><span className="eyebrow">Your team’s menu</span><h2>How should this destination show up?</h2><p>Move a row with its handle. Changes stay private until you save.</p></div>
            {order.map((id, index) => { const item = items.find((x) => x.id === id)!; const rule = rules[id]; const locked = Boolean(item.locked); const modes: [Mode,string][] = item.roleOnly ? [["everyone","Everyone"],["hidden","Hidden"],["roles","Selected access levels"]] : [["everyone","Everyone"],["hidden","Hidden"],["groups","Selected groups"]]; return <div className="row" key={id} draggable={!locked} onDragStart={() => { dragged.current = id; }} onDragOver={(e) => e.preventDefault()} onDrop={() => { const source = dragged.current; if(source && source !== id) { setOrder((old) => { const next=[...old]; const from=next.indexOf(source); const to=next.indexOf(id); next.splice(from,1); next.splice(to,0,source); return next; }); } }}>
              <div className="grip" title="Drag to reorder"><GripVertical size={17}/></div><div><div className="item-title">{item.label}</div><div className="item-detail">{item.detail}</div>{locked && <div className="lock-note"><Lock size={13}/><span>{item.locked}; it cannot be hidden from them.</span></div>} {!locked && <><input className="rename" aria-label={`Rename ${item.label}`} value={names[id] ?? ""} placeholder={`Call it something else (default: ${item.label})`} onChange={(e) => setNames((old) => ({...old,[id]:e.target.value}))}/><div style={{display:"flex",gap:6,marginTop:8}}><button className="choice" type="button" onClick={() => move(id,-1)} disabled={index===0} aria-label="Move up"><ArrowUp size={12}/></button><button className="choice" type="button" onClick={() => move(id,1)} disabled={index===order.length-1} aria-label="Move down"><ArrowDown size={12}/></button></div></>}</div>
              <div className="controls">{locked ? <div className="prompt"><b>Who should see it?</b><br/>Admins, always. Other people will not see this destination.</div> : <><div className="prompt"><b>Who should see {names[id] || "this"}?</b> Right now: <b>{modeLabel(rule)}</b>.</div><div className="selectline">{modes.map(([value,label]) => <button key={value} type="button" className={`choice ${value==="hidden"?"danger":""} ${rule.mode===value?"active":""}`} onClick={() => updateRule(id,{mode:value})}>{label}</button>)}</div>{rule.mode==="groups" && <div className="pills">{groups.map((g) => <button type="button" className={`pill ${rule.groups.includes(g)?"on":""}`} key={g} onClick={() => toggle(id,"groups",g)}>{g}</button>)}</div>}{rule.mode==="roles" && <div className="pills">{roles.map((r) => <button type="button" className={`pill ${rule.roles.includes(r)?"on":""}`} key={r} onClick={() => toggle(id,"roles",r)}>{r}</button>)}</div>}<div className="surface"><span>Where should it live?</span><button type="button" className={surfaces[id]==="vertical"?"active":""} onClick={() => setSurfaces((old)=>({...old,[id]:"vertical"}))}>Sidebar</button><span>or</span><button type="button" className={surfaces[id]==="horizontal"?"active":""} onClick={() => setSurfaces((old)=>({...old,[id]:"horizontal"}))}>Top bar</button></div></>}</div>
            </div>})}
          </section>
          <aside className="panel preview"><div className="preview-top"><div><span className="eyebrow">What people will see</span><h2>Team menu</h2></div><span className="live">PREVIEW</span></div><div className="menu"><div className="menu-label">Sidebar</div>{order.filter((id) => surfaces[id] === "vertical" && rules[id].mode !== "hidden").map((id) => <div className={`menu-item ${id==="projects"?"active":""}`} key={id}><span className="dot"/>{names[id] || items.find((x)=>x.id===id)?.label}</div>)}<div className="bar">Top bar</div><div className="h-items">{order.filter((id) => surfaces[id] === "horizontal" && rules[id].mode !== "hidden").map((id) => <span className="h-item" key={id}>{names[id] || items.find((x)=>x.id===id)?.label}</span>)}</div></div><p className="preview-note"><Info size={13} style={{verticalAlign:"-2px",marginRight:5}}/>This is a sample for the Delivery Team. People may see fewer destinations if their group or access level is not included.</p></aside>
        </div>
        <div className="footer"><button className="save" type="button" disabled={!dirty || saving} onClick={save}>{saving ? <SlidersHorizontal size={14}/> : <Save size={14}/>} {saving ? "Saving changes…" : "Save navigation"}</button>{dirty && !saving && <span className="status">You have unsaved changes</span>}{notice && !dirty && <span className="status saved"><Check size={14} style={{verticalAlign:"-3px",marginRight:5}}/>{notice}</span>}</div>
      </div>
    </main>
  );
}