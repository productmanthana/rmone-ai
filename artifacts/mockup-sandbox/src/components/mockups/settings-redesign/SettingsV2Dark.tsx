import { useState } from "react";

const G = "#6BA539";
const BG = "#0f1117";
const SURFACE = "#1a1d27";
const CARD = "#21253a";
const BORDER = "#2e3350";
const TEXT = "#f0f2ff";
const MUTED = "#7b82a8";
const FAINT = "#3d4260";

const categories = [
  {
    id: "projects", label: "Projects & Opps", icon: "📋", color: "#6BA539",
    sections: [
      { id: "proj-defaults", title: "Project Defaults", desc: "Status, type and lifecycle defaults for every new project",
        fields: [
          { label: "Default project status", type: "select", value: "Active", options: ["Active","Pipeline","Closed"] },
          { label: "Default project type", type: "select", value: "General", options: ["General","Construction","Engineering","Consulting"] },
          { label: "Default lifecycle phases", type: "tags", value: ["Preconstruction","Construction","Closeout"], color: "#6BA539" },
          { label: "Assumed project length (months)", type: "number", value: "6", hint: "Used when a project has no end date." },
        ],
      },
      { id: "opp-defaults", title: "Opportunity Defaults", desc: "Stage sets and pipeline probability weighting",
        fields: [
          { label: "Default opportunity stage", type: "select", value: "Pending Assignment", options: ["Pending Assignment","Proposal Development","Contract Negotiations"] },
          { label: "Opportunity stage set", type: "tags", value: ["Pending","Proposal","Negotiations","Awarded","Lost"], color: "#6BA539" },
        ],
      },
      { id: "dates", title: "Dates & Horizon", desc: "Rules for missing dates and forecast windows",
        fields: [
          { label: "When a start date is missing", type: "select", value: "Start this Monday", options: ["Start this Monday","Start today","Start next Monday"] },
          { label: "Default forecast window (days)", type: "number", value: "90", hint: "For opportunities/leads with no close date." },
        ],
      },
    ],
  },
  {
    id: "schedule", label: "Schedule", icon: "📅", color: "#3b82f6",
    sections: [
      { id: "sched-display", title: "Display Mode", desc: "What schedule elements appear across the app",
        fields: [{ label: "Project display mode", type: "select", value: "Full (phases + weekly hours)", options: ["Full (phases + weekly hours)","No schedule (weekly hours only)","No schedule, no hours"] }],
      },
      { id: "sched-editing", title: "Past Date Editing", desc: "How far back users may modify hours",
        fields: [
          { label: "Allow past date editing", type: "toggle", value: true },
          { label: "Past edit limit (weeks)", type: "number", value: "4", hint: "How many weeks back users can modify hours." },
        ],
      },
      { id: "sched-week", title: "Working Week", desc: "Non-working days and weekly capacity",
        fields: [
          { label: "Non-working days", type: "days", value: ["Sat","Sun"] },
          { label: "Hours in a full week", type: "number", value: "40" },
        ],
      },
    ],
  },
  {
    id: "staff", label: "Staff & Resources", icon: "👥", color: "#f59e0b",
    sections: [
      { id: "staff-util", title: "Utilisation Thresholds", desc: "% bands that colour-code staff allocation",
        fields: [
          { label: "Over-capacity flag (%)", type: "number", value: "100", hint: "Red — staff above this are over-allocated." },
          { label: "Optimal band start (%)", type: "number", value: "75", hint: "Green — sweet-spot lower bound." },
          { label: "Under-allocated flag (%)", type: "number", value: "50", hint: "Amber — staff below this need more work." },
        ],
      },
      { id: "staff-risk", title: "Demand & Risk", desc: "Thresholds that trigger risk alerts",
        fields: [
          { label: "Concentration risk threshold (%)", type: "number", value: "80" },
          { label: "Demand urgency window (days)", type: "number", value: "14" },
        ],
      },
    ],
  },
  {
    id: "forecast", label: "Forecast", icon: "📈", color: "#8b5cf6",
    sections: [
      { id: "forecast-main", title: "Forecast Settings", desc: "Lookahead window and pipeline health targets",
        fields: [
          { label: "Forecast window (weeks)", type: "number", value: "12" },
          { label: "Pipeline coverage target (%)", type: "number", value: "150" },
        ],
      },
    ],
  },
];

function Field({ field }: { field: any }) {
  if (field.type === "select") return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      <label style={{ fontSize:12, fontWeight:500, color: MUTED, textTransform:"uppercase" as const, letterSpacing:.5 }}>{field.label}</label>
      <div style={{ position:"relative" }}>
        <select style={{ width:"100%", padding:"9px 32px 9px 12px", border:`1px solid ${BORDER}`, borderRadius:8, fontSize:13, color:TEXT, background:SURFACE, appearance:"none", cursor:"pointer" }}>
          {(field.options??[]).map((o:string) => <option key={o}>{o}</option>)}
        </select>
        <span style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", color:MUTED, pointerEvents:"none", fontSize:11 }}>▾</span>
      </div>
      {field.hint && <p style={{ fontSize:11, color:FAINT, margin:0 }}>{field.hint}</p>}
    </div>
  );
  if (field.type === "number") return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      <label style={{ fontSize:12, fontWeight:500, color:MUTED, textTransform:"uppercase" as const, letterSpacing:.5 }}>{field.label}</label>
      <input type="number" defaultValue={field.value} style={{ width:120, padding:"9px 12px", border:`1px solid ${BORDER}`, borderRadius:8, fontSize:13, color:TEXT, background:SURFACE }} />
      {field.hint && <p style={{ fontSize:11, color:FAINT, margin:0 }}>{field.hint}</p>}
    </div>
  );
  if (field.type === "toggle") return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <label style={{ fontSize:13, color:TEXT }}>{field.label}</label>
      <div style={{ width:44, height:24, borderRadius:12, background: field.value ? G : FAINT, position:"relative", cursor:"pointer" }}>
        <div style={{ position:"absolute", width:20, height:20, borderRadius:10, background:"#fff", top:2, left: field.value ? 22 : 2 }} />
      </div>
    </div>
  );
  if (field.type === "tags") return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      <label style={{ fontSize:12, fontWeight:500, color:MUTED, textTransform:"uppercase" as const, letterSpacing:.5 }}>{field.label}</label>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, padding:"8px 12px", border:`1px solid ${BORDER}`, borderRadius:8, background:BG, minHeight:40, alignItems:"center" }}>
        {(field.value as string[]).map((t:string) => (
          <span key={t} style={{ display:"flex", alignItems:"center", gap:4, padding:"2px 10px", borderRadius:20, background:`${field.color}20`, border:`1px solid ${field.color}50`, fontSize:12, color:field.color, fontWeight:500 }}>
            {t}<span style={{ opacity:.5, fontSize:11 }}>×</span>
          </span>
        ))}
        <span style={{ fontSize:12, color:FAINT, cursor:"pointer" }}>+ Add</span>
      </div>
    </div>
  );
  if (field.type === "days") {
    const days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    return (
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        <label style={{ fontSize:12, fontWeight:500, color:MUTED, textTransform:"uppercase" as const, letterSpacing:.5 }}>{field.label}</label>
        <div style={{ display:"flex", gap:6 }}>
          {days.map(d => {
            const off = (field.value as string[]).includes(d);
            return <div key={d} style={{ width:40, height:40, borderRadius:8, border:`1px solid ${off ? "#ef444450" : BORDER}`, background: off ? "#ef444415" : BG, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:600, color: off ? "#ef4444" : MUTED, cursor:"pointer" }}>{d}</div>;
          })}
        </div>
      </div>
    );
  }
  return null;
}

export function SettingsV2Dark() {
  const [active, setActive] = useState("projects");
  const [openSec, setOpenSec] = useState<string|null>("proj-defaults");
  const cat = categories.find(c => c.id === active)!;

  return (
    <div style={{ display:"flex", height:"100vh", background:BG, fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color:TEXT, overflow:"hidden" }}>
      {/* Sidebar */}
      <aside style={{ width:220, flexShrink:0, background:SURFACE, borderRight:`1px solid ${BORDER}`, display:"flex", flexDirection:"column" }}>
        <div style={{ padding:"22px 18px 16px", borderBottom:`1px solid ${BORDER}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
            <div style={{ width:30, height:30, borderRadius:8, background:G, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 }}>⚙</div>
            <div>
              <div style={{ fontSize:14, fontWeight:700 }}>Settings</div>
              <div style={{ fontSize:11, color:MUTED }}>RM ONE</div>
            </div>
          </div>
        </div>
        <nav style={{ flex:1, padding:"14px 10px" }}>
          <div style={{ fontSize:10, fontWeight:700, color:FAINT, textTransform:"uppercase" as const, letterSpacing:1, padding:"0 8px 10px" }}>Configuration</div>
          {categories.map(c => (
            <button key={c.id} onClick={() => setActive(c.id)}
              style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"9px 10px", borderRadius:8, border:"none", cursor:"pointer", background: active===c.id ? `${c.color}18` : "transparent", marginBottom:2, textAlign:"left" as const }}>
              <div style={{ width:28, height:28, borderRadius:7, background: active===c.id ? `${c.color}25` : FAINT+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>{c.icon}</div>
              <span style={{ fontSize:13, fontWeight: active===c.id ? 600 : 400, color: active===c.id ? c.color : MUTED }}>{c.label}</span>
              {active===c.id && <span style={{ marginLeft:"auto", width:6, height:6, borderRadius:3, background:c.color }} />}
            </button>
          ))}
        </nav>
        <div style={{ padding:"12px 12px", borderTop:`1px solid ${BORDER}` }}>
          <button style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"8px 10px", borderRadius:8, border:`1px solid ${BORDER}`, background:"transparent", cursor:"pointer", color:MUTED, fontSize:12 }}>↩ Reset to defaults</button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex:1, overflowY:"auto", padding:"32px 40px" }}>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:32 }}>
          <div style={{ width:44, height:44, borderRadius:12, background:`${cat.color}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>{cat.icon}</div>
          <div>
            <h1 style={{ fontSize:20, fontWeight:700, margin:0, color:TEXT }}>{cat.label}</h1>
            <p style={{ fontSize:12, color:MUTED, margin:0, marginTop:2 }}>{cat.sections.length} configuration sections</p>
          </div>
        </div>

        {/* Sections */}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {cat.sections.map(sec => {
            const open = openSec === sec.id;
            return (
              <div key={sec.id} style={{ background:CARD, border:`1px solid ${open ? `${cat.color}40` : BORDER}`, borderRadius:14, overflow:"hidden", transition:"border-color .2s" }}>
                <button onClick={() => setOpenSec(open ? null : sec.id)}
                  style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 22px", background: open ? `${cat.color}08` : "transparent", border:"none", cursor:"pointer", textAlign:"left" as const, borderBottom: open ? `1px solid ${cat.color}20` : "none" }}>
                  <div>
                    <div style={{ fontSize:14, fontWeight:600, color: open ? cat.color : TEXT }}>{sec.title}</div>
                    <div style={{ fontSize:12, color:MUTED, marginTop:2 }}>{sec.desc}</div>
                  </div>
                  <div style={{ width:26, height:26, borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center", background: open ? `${cat.color}20` : FAINT+"30", color: open ? cat.color : MUTED, fontSize:12, transition:"all .2s", transform: open ? "rotate(180deg)" : "none" }}>▾</div>
                </button>
                {open && (
                  <div style={{ padding:"22px 22px 24px", display:"flex", flexDirection:"column", gap:20 }}>
                    {sec.fields.map((f:any) => <Field key={f.label} field={f} />)}
                    <div style={{ display:"flex", justifyContent:"flex-end", paddingTop:4 }}>
                      <button style={{ padding:"8px 24px", borderRadius:8, border:"none", background:cat.color, color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer" }}>Save</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ height:60 }} />
      </main>
    </div>
  );
}
