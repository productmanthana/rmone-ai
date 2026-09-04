import { useState } from "react";

const G = "#6BA539";
const BORDER = "#e5e7eb";
const BG = "#ffffff";
const TEXT = "#111827";
const MUTED = "#6b7280";
const FAINT = "#d1d5db";
const HOVER = "#f9fafb";

const allSettings = [
  { id:"proj-status",  group:"Projects", subgroup:"Defaults", label:"Default project status",           type:"select", value:"Active",              options:["Active","Pipeline","Closed"],                                       color:"#6BA539", icon:"🎯" },
  { id:"proj-type",    group:"Projects", subgroup:"Defaults", label:"Default project type",             type:"select", value:"General",             options:["General","Construction","Engineering","Consulting"],                 color:"#6BA539", icon:"🏗" },
  { id:"proj-len",     group:"Projects", subgroup:"Defaults", label:"Assumed project length",           type:"number", value:"6",    unit:"months",  hint:"Used when a project has no end date.",                                  color:"#6BA539", icon:"📏" },
  { id:"lifecycle",    group:"Projects", subgroup:"Lifecycle",label:"Default lifecycle phases",         type:"tags",   value:["Preconstruction","Construction","Closeout"],                                                       color:"#6BA539", icon:"🔄" },
  { id:"opp-stage",    group:"Projects", subgroup:"Pipeline", label:"Default opportunity stage",        type:"select", value:"Pending Assignment",   options:["Pending Assignment","Proposal Development","Contract Negotiations"],color:"#6BA539", icon:"🏆" },
  { id:"opp-stages",   group:"Projects", subgroup:"Pipeline", label:"Opportunity stage set",            type:"tags",   value:["Pending","Proposal","Negotiations","Awarded","Lost"],                                             color:"#6BA539", icon:"📊" },
  { id:"fcast-days",   group:"Projects", subgroup:"Pipeline", label:"Default forecast window",          type:"number", value:"90",   unit:"days",     hint:"For opportunities with no close date.",                                color:"#6BA539", icon:"🗓" },
  { id:"start-miss",   group:"Projects", subgroup:"Dates",    label:"When a start date is missing",     type:"select", value:"Start this Monday",    options:["Start this Monday","Start today","Start next Monday"],             color:"#6BA539", icon:"📅" },
  { id:"disp-mode",    group:"Schedule", subgroup:"Display",  label:"Project display mode",             type:"select", value:"Full (phases + weekly hours)", options:["Full (phases + weekly hours)","No schedule (weekly hours only)","No schedule, no hours"], color:"#3b82f6", icon:"📺" },
  { id:"nonwork-days", group:"Schedule", subgroup:"Capacity", label:"Non-working days",                 type:"days",   value:["Sat","Sun"],                                                                                       color:"#3b82f6", icon:"🛑" },
  { id:"week-hrs",     group:"Schedule", subgroup:"Capacity", label:"Hours in a full week",             type:"number", value:"40",   unit:"hrs",      hint:"The denominator for 100% allocation.",                                color:"#3b82f6", icon:"⏱" },
  { id:"past-edit",    group:"Schedule", subgroup:"History",  label:"Allow past date editing",          type:"toggle", value:true,                                                                                                color:"#3b82f6", icon:"⏮" },
  { id:"past-limit",   group:"Schedule", subgroup:"History",  label:"Past edit limit",                  type:"number", value:"4",    unit:"weeks",    hint:"How many weeks back users can modify hours.",                         color:"#3b82f6", icon:"🔒" },
  { id:"over-cap",     group:"Staff",    subgroup:"Thresholds",label:"Over-capacity flag",              type:"number", value:"100",  unit:"%",        hint:"Red — above this is over-allocated.",                                 color:"#f59e0b", icon:"🔴" },
  { id:"optimal-lo",   group:"Staff",    subgroup:"Thresholds",label:"Optimal band start",              type:"number", value:"75",   unit:"%",        hint:"Green — healthy lower bound.",                                        color:"#f59e0b", icon:"🟢" },
  { id:"under-alloc",  group:"Staff",    subgroup:"Thresholds",label:"Under-allocated flag",            type:"number", value:"50",   unit:"%",        hint:"Amber — needs more work.",                                            color:"#f59e0b", icon:"🟡" },
  { id:"conc-risk",    group:"Staff",    subgroup:"Risk",      label:"Concentration risk threshold",    type:"number", value:"80",   unit:"%",                                                                                   color:"#f59e0b", icon:"⚠️" },
  { id:"demand-urg",   group:"Staff",    subgroup:"Risk",      label:"Demand urgency window",           type:"number", value:"14",   unit:"days",                                                                                color:"#f59e0b", icon:"🚨" },
  { id:"fcast-weeks",  group:"Forecast", subgroup:"Lookahead","label":"Forecast window",               type:"number", value:"12",   unit:"weeks",                                                                               color:"#8b5cf6", icon:"📈" },
  { id:"pipe-cover",   group:"Forecast", subgroup:"Targets",   label:"Pipeline coverage target",       type:"number", value:"150",  unit:"%",        hint:"Healthy pipeline-to-portfolio ratio.",                                color:"#8b5cf6", icon:"🎯" },
] as const;

type Setting = typeof allSettings[number];

const groupColors: Record<string, string> = { Projects:"#6BA539", Schedule:"#3b82f6", Staff:"#f59e0b", Forecast:"#8b5cf6" };
const groupIcons:  Record<string, string> = { Projects:"📋",       Schedule:"📅",      Staff:"👥",       Forecast:"📈" };

function InlineField({ s }: { s: Setting }) {
  const [editing, setEditing] = useState(false);

  if (s.type === "toggle") return (
    <div style={{ width:44, height:24, borderRadius:12, background:(s.value as boolean) ? s.color : FAINT, position:"relative", cursor:"pointer", flexShrink:0 }}>
      <div style={{ position:"absolute", width:20, height:20, borderRadius:10, background:"#fff", top:2, left:(s.value as boolean) ? 22 : 2, boxShadow:"0 1px 3px rgba(0,0,0,.2)" }} />
    </div>
  );

  if (s.type === "number") return (
    <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
      {editing
        ? <input autoFocus type="number" defaultValue={s.value as string} onBlur={() => setEditing(false)}
            style={{ width:70, padding:"4px 8px", border:`1.5px solid ${s.color}`, borderRadius:6, fontSize:13, fontWeight:600, color:TEXT, outline:"none" }} />
        : <button onClick={() => setEditing(true)}
            style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 12px", background:`${s.color}12`, border:`1px solid ${s.color}40`, borderRadius:6, cursor:"pointer", fontSize:13, fontWeight:700, color:s.color }}>
            {s.value as string}{(s as any).unit ? <span style={{ fontWeight:400, fontSize:11, color:MUTED }}>{(s as any).unit}</span> : null}
          </button>
      }
    </div>
  );

  if (s.type === "select") return (
    <div style={{ position:"relative", flexShrink:0 }}>
      <select style={{ padding:"5px 26px 5px 10px", border:`1px solid ${BORDER}`, borderRadius:6, fontSize:12, color:TEXT, background:"#fff", appearance:"none", cursor:"pointer", maxWidth:200 }}>
        {(s.options as readonly string[]).map(o => <option key={o}>{o}</option>)}
      </select>
      <span style={{ position:"absolute", right:7, top:"50%", transform:"translateY(-50%)", color:FAINT, pointerEvents:"none", fontSize:10 }}>▾</span>
    </div>
  );

  if (s.type === "tags") return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:4, maxWidth:300 }}>
      {(s.value as readonly string[]).slice(0,3).map(t => (
        <span key={t} style={{ padding:"2px 8px", borderRadius:12, background:`${s.color}12`, border:`1px solid ${s.color}30`, fontSize:11, color:s.color, fontWeight:500 }}>{t}</span>
      ))}
      {(s.value as readonly string[]).length > 3 && <span style={{ fontSize:11, color:MUTED }}>+{(s.value as readonly string[]).length - 3}</span>}
    </div>
  );

  if (s.type === "days") return (
    <div style={{ display:"flex", gap:4 }}>
      {["M","T","W","T","F","S","S"].map((d,i) => {
        const full = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i];
        const off = (s.value as readonly string[]).includes(full);
        return <div key={i} style={{ width:26, height:26, borderRadius:6, border:`1px solid ${off ? "#ef444450" : BORDER}`, background: off ? "#fef2f2" : "#fafafa", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:600, color: off ? "#ef4444" : MUTED }}>{d}</div>;
      })}
    </div>
  );

  return null;
}

export function SettingsV5Minimal() {
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState<string|null>(null);
  const groups = [...new Set(allSettings.map(s => s.group))];

  const filtered = allSettings.filter(s => {
    const q = search.toLowerCase();
    const matchesSearch = !q || s.label.toLowerCase().includes(q) || s.subgroup.toLowerCase().includes(q);
    const matchesGroup = !activeGroup || s.group === activeGroup;
    return matchesSearch && matchesGroup;
  });

  const grouped: Record<string, Record<string, typeof filtered>> = {};
  for (const s of filtered) {
    if (!grouped[s.group]) grouped[s.group] = {};
    if (!grouped[s.group][s.subgroup]) grouped[s.group][s.subgroup] = [];
    grouped[s.group][s.subgroup].push(s);
  }

  return (
    <div style={{ display:"flex", height:"100vh", background:BG, fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", overflow:"hidden" }}>
      {/* Left rail */}
      <aside style={{ width:200, flexShrink:0, borderRight:`1px solid ${BORDER}`, display:"flex", flexDirection:"column", padding:"20px 14px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:20 }}>
          <div style={{ width:26, height:26, borderRadius:7, background:G, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13 }}>⚙</div>
          <span style={{ fontSize:14, fontWeight:700, color:TEXT }}>Settings</span>
        </div>
        <button onClick={() => setActiveGroup(null)}
          style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:7, border:"none", cursor:"pointer", background: !activeGroup ? "#f3f4f6" : "transparent", marginBottom:4, textAlign:"left" as const }}>
          <span style={{ fontSize:13, color:!activeGroup ? TEXT : MUTED, fontWeight:!activeGroup ? 600 : 400 }}>All Settings</span>
          <span style={{ marginLeft:"auto", fontSize:11, color:MUTED }}>{allSettings.length}</span>
        </button>
        <div style={{ width:"100%", height:1, background:BORDER, margin:"8px 0" }} />
        {groups.map(g => (
          <button key={g} onClick={() => setActiveGroup(g)}
            style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:7, border:"none", cursor:"pointer", background: activeGroup===g ? `${groupColors[g]}10` : "transparent", marginBottom:2, textAlign:"left" as const }}>
            <span style={{ fontSize:14 }}>{groupIcons[g]}</span>
            <span style={{ fontSize:13, color: activeGroup===g ? groupColors[g] : MUTED, fontWeight: activeGroup===g ? 600 : 400 }}>{g}</span>
            <span style={{ marginLeft:"auto", fontSize:11, color:MUTED }}>{allSettings.filter(s=>s.group===g).length}</span>
          </button>
        ))}
        <div style={{ marginTop:"auto", paddingTop:16 }}>
          <button style={{ width:"100%", padding:"7px 10px", borderRadius:7, border:`1px solid ${BORDER}`, background:"transparent", fontSize:12, color:MUTED, cursor:"pointer" }}>↩ Reset</button>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {/* Search bar */}
        <div style={{ padding:"16px 24px", borderBottom:`1px solid ${BORDER}`, background:BG }}>
          <div style={{ position:"relative", maxWidth:480 }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:FAINT, fontSize:14 }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search settings by name or category…"
              style={{ width:"100%", padding:"9px 12px 9px 38px", border:`1px solid ${BORDER}`, borderRadius:10, fontSize:13, color:TEXT, background:"#f9fafb", outline:"none", boxSizing:"border-box" as const }} />
            {search && <button onClick={() => setSearch("")} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:FAINT, fontSize:16 }}>×</button>}
          </div>
        </div>

        {/* Settings list */}
        <div style={{ flex:1, overflowY:"auto" }}>
          {Object.entries(grouped).map(([group, subgroups]) => (
            <div key={group}>
              {/* Group header */}
              <div style={{ padding:"16px 24px 8px", display:"flex", alignItems:"center", gap:10, position:"sticky", top:0, background:BG, zIndex:1, borderBottom:`1px solid ${BORDER}` }}>
                <span style={{ fontSize:15 }}>{groupIcons[group]}</span>
                <span style={{ fontSize:12, fontWeight:700, color:groupColors[group], textTransform:"uppercase" as const, letterSpacing:.8 }}>{group}</span>
                <div style={{ flex:1, height:1, background:`${groupColors[group]}25`, marginLeft:4 }} />
              </div>
              {Object.entries(subgroups).map(([sub, items]) => (
                <div key={sub}>
                  {/* Subgroup label */}
                  <div style={{ padding:"10px 24px 6px 48px", fontSize:11, fontWeight:600, color:FAINT, textTransform:"uppercase" as const, letterSpacing:.6 }}>{sub}</div>
                  {items.map((s, i) => (
                    <div key={s.id} style={{ display:"flex", alignItems:"center", padding:"12px 24px 12px 48px", borderTop: i > 0 ? `1px solid ${BORDER}` : "none",
                      transition:"background .1s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = HOVER)}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <div style={{ flex:1, minWidth:0, marginRight:24 }}>
                        <div style={{ fontSize:13, fontWeight:500, color:TEXT }}>{s.label}</div>
                        {(s as any).hint && <div style={{ fontSize:11, color:FAINT, marginTop:1 }}>{(s as any).hint}</div>}
                      </div>
                      <InlineField s={s} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding:"60px 24px", textAlign:"center" as const, color:FAINT }}>
              <div style={{ fontSize:32, marginBottom:12 }}>🔍</div>
              <div style={{ fontSize:14 }}>No settings match "{search}"</div>
            </div>
          )}
          <div style={{ height:40 }} />
        </div>
      </div>
    </div>
  );
}
