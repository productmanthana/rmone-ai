import { useState } from "react";

const G = "#6BA539";
const BORDER = "#e5e7eb";
const BG = "#f8f9fa";
const PANEL = "#ffffff";
const TEXT = "#111827";
const MUTED = "#6b7280";
const FAINT = "#9ca3af";

const tabs = [
  {
    id:"projects", label:"Projects & Opps", icon:"📋", color:"#6BA539",
    groups: [
      {
        title:"Project Defaults", color:"#6BA539",
        items:[
          { label:"Default project status", type:"select", value:"Active", options:["Active","Pipeline","Closed"] },
          { label:"Default project type", type:"select", value:"General", options:["General","Construction","Engineering","Consulting"] },
          { label:"Assumed project length (months)", type:"number", value:"6", hint:"Used when a project has no end date." },
        ]
      },
      {
        title:"Lifecycle", color:"#6BA539",
        items:[
          { label:"Default lifecycle phases", type:"tags", value:["Preconstruction","Construction","Closeout"], color:"#6BA539" },
          { label:"When a start date is missing", type:"select", value:"Start this Monday", options:["Start this Monday","Start today","Start next Monday"] },
        ]
      },
      {
        title:"Opportunity Pipeline", color:"#6BA539",
        items:[
          { label:"Default opportunity stage", type:"select", value:"Pending Assignment", options:["Pending Assignment","Proposal Development","Contract Negotiations"] },
          { label:"Opportunity stage set", type:"tags", value:["Pending","Proposal","Negotiations","Awarded","Lost"], color:"#6BA539" },
          { label:"Default forecast window (days)", type:"number", value:"90", hint:"For opportunities/leads with no close date." },
        ]
      }
    ]
  },
  {
    id:"schedule", label:"Schedule", icon:"📅", color:"#3b82f6",
    groups:[
      {
        title:"Display", color:"#3b82f6",
        items:[
          { label:"Project display mode", type:"select", value:"Full (phases + weekly hours)", options:["Full (phases + weekly hours)","No schedule (weekly hours only)","No schedule, no hours"] },
        ]
      },
      {
        title:"Working Week", color:"#3b82f6",
        items:[
          { label:"Non-working days", type:"days", value:["Sat","Sun"] },
          { label:"Hours in a full week", type:"number", value:"40", hint:"Denominator for 100% allocation." },
        ]
      },
      {
        title:"History Editing", color:"#3b82f6",
        items:[
          { label:"Allow past date editing", type:"toggle", value:true },
          { label:"Past edit limit (weeks)", type:"number", value:"4", hint:"How many weeks back users can modify hours." },
        ]
      }
    ]
  },
  {
    id:"staff", label:"Staff", icon:"👥", color:"#f59e0b",
    groups:[
      {
        title:"Utilisation Bands", color:"#f59e0b",
        items:[
          { label:"Over-capacity flag (%)", type:"number", value:"100", hint:"Red — over-allocated above this." },
          { label:"Optimal band start (%)", type:"number", value:"75", hint:"Green — healthy lower bound." },
          { label:"Under-allocated flag (%)", type:"number", value:"50", hint:"Amber — needs more work." },
        ]
      },
      {
        title:"Risk & Demand", color:"#f59e0b",
        items:[
          { label:"Concentration risk threshold (%)", type:"number", value:"80" },
          { label:"Demand urgency window (days)", type:"number", value:"14" },
        ]
      }
    ]
  },
  {
    id:"forecast", label:"Forecast", icon:"📈", color:"#8b5cf6",
    groups:[
      {
        title:"Forecast Settings", color:"#8b5cf6",
        items:[
          { label:"Forecast window (weeks)", type:"number", value:"12" },
          { label:"Pipeline coverage target (%)", type:"number", value:"150" },
        ]
      }
    ]
  }
];

function Field({ f, color }: { f: any; color: string }) {
  if (f.type === "select") return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:16 }}>
      <div style={{ minWidth:0, flex:1 }}>
        <div style={{ fontSize:13, fontWeight:500, color:TEXT }}>{f.label}</div>
        {f.hint && <div style={{ fontSize:11, color:FAINT, marginTop:2 }}>{f.hint}</div>}
      </div>
      <div style={{ position:"relative", flexShrink:0 }}>
        <select style={{ padding:"7px 28px 7px 12px", border:`1px solid ${BORDER}`, borderRadius:8, fontSize:13, color:TEXT, background:"#fff", appearance:"none", cursor:"pointer", minWidth:180 }}>
          {(f.options??[]).map((o:string) => <option key={o}>{o}</option>)}
        </select>
        <span style={{ position:"absolute", right:9, top:"50%", transform:"translateY(-50%)", color:FAINT, pointerEvents:"none", fontSize:10 }}>▾</span>
      </div>
    </div>
  );
  if (f.type === "number") return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:16 }}>
      <div style={{ minWidth:0, flex:1 }}>
        <div style={{ fontSize:13, fontWeight:500, color:TEXT }}>{f.label}</div>
        {f.hint && <div style={{ fontSize:11, color:FAINT, marginTop:2 }}>{f.hint}</div>}
      </div>
      <input type="number" defaultValue={f.value} style={{ width:90, padding:"7px 10px", border:`1px solid ${BORDER}`, borderRadius:8, fontSize:13, color:TEXT, background:"#fff", flexShrink:0 }} />
    </div>
  );
  if (f.type === "toggle") return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <div style={{ fontSize:13, fontWeight:500, color:TEXT }}>{f.label}</div>
      <div style={{ width:44, height:24, borderRadius:12, background:f.value ? color : "#d1d5db", position:"relative", cursor:"pointer", flexShrink:0 }}>
        <div style={{ position:"absolute", width:20, height:20, borderRadius:10, background:"#fff", top:2, left:f.value ? 22 : 2 }} />
      </div>
    </div>
  );
  if (f.type === "tags") return (
    <div>
      <div style={{ fontSize:13, fontWeight:500, color:TEXT, marginBottom:8 }}>{f.label}</div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, padding:"8px 12px", border:`1px solid ${BORDER}`, borderRadius:8, background:"#fafafa", minHeight:40 }}>
        {(f.value as string[]).map((t:string) => (
          <span key={t} style={{ display:"flex", alignItems:"center", gap:4, padding:"2px 10px", borderRadius:20, background:`${f.color}15`, border:`1px solid ${f.color}40`, fontSize:12, color:f.color, fontWeight:500 }}>
            {t} <span style={{ opacity:.5 }}>×</span>
          </span>
        ))}
        <span style={{ fontSize:12, color:FAINT, cursor:"pointer" }}>+ Add</span>
      </div>
    </div>
  );
  if (f.type === "days") {
    const days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    return (
      <div>
        <div style={{ fontSize:13, fontWeight:500, color:TEXT, marginBottom:8 }}>{f.label}</div>
        <div style={{ display:"flex", gap:6 }}>
          {days.map(d => {
            const off = (f.value as string[]).includes(d);
            return <div key={d} style={{ width:38, height:38, borderRadius:8, border:`1px solid ${off ? "#ef444450" : BORDER}`, background: off ? "#fef2f2" : "#fafafa", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:600, color: off ? "#ef4444" : TEXT, cursor:"pointer" }}>{d}</div>;
          })}
        </div>
      </div>
    );
  }
  return null;
}

export function SettingsV4TopNav() {
  const [activeTab, setActiveTab] = useState("projects");
  const tab = tabs.find(t => t.id === activeTab)!;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", background:BG, fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", overflow:"hidden" }}>
      {/* App header */}
      <div style={{ background:PANEL, borderBottom:`1px solid ${BORDER}`, padding:"0 28px", display:"flex", alignItems:"center", gap:8, height:52, flexShrink:0 }}>
        <div style={{ width:28, height:28, borderRadius:8, background:G, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>⚙</div>
        <span style={{ fontSize:15, fontWeight:700, color:TEXT }}>Settings</span>
        <span style={{ fontSize:13, color:FAINT, marginLeft:4 }}>— Company-wide defaults</span>
        <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
          <button style={{ padding:"6px 14px", borderRadius:8, border:`1px solid ${BORDER}`, background:"#fafafa", fontSize:12, color:MUTED, cursor:"pointer" }}>↩ Reset all</button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ background:PANEL, borderBottom:`1px solid ${BORDER}`, padding:"0 24px", display:"flex", gap:2, flexShrink:0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ display:"flex", alignItems:"center", gap:7, padding:"12px 18px", border:"none", background:"transparent", cursor:"pointer", fontSize:13, fontWeight: activeTab===t.id ? 600 : 400, color: activeTab===t.id ? t.color : MUTED,
              borderBottom: activeTab===t.id ? `2px solid ${t.color}` : "2px solid transparent", marginBottom:-1 }}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* Content: 3-column group layout */}
      <div style={{ flex:1, overflowY:"auto", padding:"28px 28px" }}>
        {/* Category banner */}
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:24, padding:"14px 20px", background:PANEL, borderRadius:12, border:`1px solid ${tab.color}30` }}>
          <span style={{ fontSize:24 }}>{tab.icon}</span>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:TEXT }}>{tab.label}</div>
            <div style={{ fontSize:12, color:MUTED }}>{tab.groups.length} groups · {tab.groups.reduce((s,g)=>s+g.items.length,0)} settings</div>
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(320px, 1fr))", gap:16 }}>
          {tab.groups.map(grp => (
            <div key={grp.title} style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:14, overflow:"hidden" }}>
              {/* Group header */}
              <div style={{ padding:"14px 20px 10px", borderBottom:`1px solid ${grp.color}20`, background:`${grp.color}06` }}>
                <div style={{ fontSize:13, fontWeight:700, color:grp.color }}>{grp.title}</div>
              </div>
              {/* Fields */}
              <div style={{ padding:"16px 20px", display:"flex", flexDirection:"column", gap:16 }}>
                {grp.items.map((item:any) => <Field key={item.label} f={item} color={grp.color} />)}
              </div>
              <div style={{ padding:"0 20px 16px", display:"flex", justifyContent:"flex-end" }}>
                <button style={{ padding:"7px 18px", borderRadius:8, border:"none", background:grp.color, color:"#fff", fontSize:12, fontWeight:600, cursor:"pointer" }}>Save</button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ height:40 }} />
      </div>
    </div>
  );
}
