import { useState } from "react";

const G = "#6BA539";
const BORDER = "#e5e7eb";
const BG = "#f8f9fa";
const PANEL = "#ffffff";
const TEXT = "#111827";
const MUTED = "#6b7280";
const FAINT = "#9ca3af";

const steps = [
  {
    id:"projects", title:"Projects & Opportunities", icon:"📋", color:"#6BA539",
    desc:"Set defaults that apply to every project and pipeline opportunity your team creates.",
    fields:[
      { label:"Default project status", type:"select", value:"Active", options:["Active","Pipeline","Closed"], hint:"The initial status when a project is created." },
      { label:"Default project type", type:"select", value:"General", options:["General","Construction","Engineering","Consulting"], hint:"Can always be overridden per project." },
      { label:"Default lifecycle phases", type:"tags", value:["Preconstruction","Construction","Closeout"], color:"#6BA539" },
      { label:"Assumed project length (months)", type:"number", value:"6", hint:"Used when a project has no end date set." },
      { label:"Default opportunity stage", type:"select", value:"Pending Assignment", options:["Pending Assignment","Proposal Development","Contract Negotiations"] },
      { label:"Default forecast window (days)", type:"number", value:"90", hint:"For opportunities or leads with no close date." },
    ]
  },
  {
    id:"schedule", title:"Schedule", icon:"📅", color:"#3b82f6",
    desc:"Configure how schedules display across the app and how historical hours are handled.",
    fields:[
      { label:"Project display mode", type:"select", value:"Full (phases + weekly hours)", options:["Full (phases + weekly hours)","No schedule (weekly hours only)","No schedule, no hours"] },
      { label:"Non-working days", type:"days", value:["Sat","Sun"] },
      { label:"Hours in a full week", type:"number", value:"40", hint:"The denominator for 100% allocation." },
      { label:"Allow past date editing", type:"toggle", value:true },
      { label:"Past edit limit (weeks)", type:"number", value:"4", hint:"How many weeks back users can modify hours." },
    ]
  },
  {
    id:"staff", title:"Staff & Resources", icon:"👥", color:"#f59e0b",
    desc:"Define the allocation thresholds and risk windows that govern staff health alerts.",
    fields:[
      { label:"Over-capacity flag (%)", type:"number", value:"100", hint:"Red — staff above this are over-allocated." },
      { label:"Optimal band start (%)", type:"number", value:"75", hint:"Green — sweet-spot lower bound." },
      { label:"Under-allocated flag (%)", type:"number", value:"50", hint:"Amber — staff below this need more work." },
      { label:"Concentration risk threshold (%)", type:"number", value:"80", hint:"Alert when one project dominates a person's time." },
      { label:"Demand urgency window (days)", type:"number", value:"14", hint:"Unfilled role becomes URGENT within this many days." },
    ]
  },
  {
    id:"forecast", title:"Forecast", icon:"📈", color:"#8b5cf6",
    desc:"Set how far ahead the Forecast page looks and what pipeline coverage is considered healthy.",
    fields:[
      { label:"Forecast window (weeks)", type:"number", value:"12", hint:"How far ahead demand vs capacity is calculated." },
      { label:"Pipeline coverage target (%)", type:"number", value:"150", hint:"Healthy ratio of pipeline value to active portfolio value." },
    ]
  },
];

function Field({ f, color }: { f: any; color: string }) {
  if (f.type === "select") return (
    <div>
      <label style={{ fontSize:13, fontWeight:500, color:TEXT, display:"block", marginBottom:6 }}>{f.label}</label>
      <div style={{ position:"relative" }}>
        <select style={{ width:"100%", padding:"10px 32px 10px 14px", border:`1px solid ${BORDER}`, borderRadius:9, fontSize:13, color:TEXT, background:"#fff", appearance:"none", cursor:"pointer" }}>
          {(f.options??[]).map((o:string) => <option key={o}>{o}</option>)}
        </select>
        <span style={{ position:"absolute", right:11, top:"50%", transform:"translateY(-50%)", color:FAINT, pointerEvents:"none", fontSize:11 }}>▾</span>
      </div>
      {f.hint && <p style={{ fontSize:11, color:MUTED, margin:"5px 0 0" }}>{f.hint}</p>}
    </div>
  );
  if (f.type === "number") return (
    <div>
      <label style={{ fontSize:13, fontWeight:500, color:TEXT, display:"block", marginBottom:6 }}>{f.label}</label>
      <input type="number" defaultValue={f.value} style={{ width:120, padding:"10px 12px", border:`1px solid ${BORDER}`, borderRadius:9, fontSize:14, fontWeight:600, color:TEXT, background:"#fff" }} />
      {f.hint && <p style={{ fontSize:11, color:MUTED, margin:"5px 0 0" }}>{f.hint}</p>}
    </div>
  );
  if (f.type === "toggle") return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"4px 0" }}>
      <div>
        <label style={{ fontSize:13, fontWeight:500, color:TEXT }}>{f.label}</label>
        {f.hint && <p style={{ fontSize:11, color:MUTED, margin:"3px 0 0" }}>{f.hint}</p>}
      </div>
      <div style={{ width:46, height:26, borderRadius:13, background:f.value ? color : "#d1d5db", position:"relative", cursor:"pointer", flexShrink:0 }}>
        <div style={{ position:"absolute", width:22, height:22, borderRadius:11, background:"#fff", top:2, left:f.value ? 22 : 2, boxShadow:"0 1px 4px rgba(0,0,0,.2)" }} />
      </div>
    </div>
  );
  if (f.type === "tags") return (
    <div>
      <label style={{ fontSize:13, fontWeight:500, color:TEXT, display:"block", marginBottom:6 }}>{f.label}</label>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, padding:"8px 14px", border:`1px solid ${BORDER}`, borderRadius:9, background:"#fafafa", minHeight:44, alignItems:"center" }}>
        {(f.value as string[]).map((t:string) => (
          <span key={t} style={{ display:"flex", alignItems:"center", gap:4, padding:"2px 10px", borderRadius:20, background:`${f.color}15`, border:`1px solid ${f.color}40`, fontSize:12, color:f.color, fontWeight:500 }}>
            {t} <span style={{ opacity:.5, cursor:"pointer" }}>×</span>
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
        <label style={{ fontSize:13, fontWeight:500, color:TEXT, display:"block", marginBottom:8 }}>{f.label}</label>
        <div style={{ display:"flex", gap:7 }}>
          {days.map(d => {
            const off = (f.value as string[]).includes(d);
            return <div key={d} style={{ width:42, height:42, borderRadius:9, border:`1px solid ${off?"#ef444450":BORDER}`, background: off ? "#fef2f2" : "#fafafa", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:600, color: off ? "#ef4444" : TEXT, cursor:"pointer" }}>{d}</div>;
          })}
        </div>
        <p style={{ fontSize:11, color:MUTED, margin:"6px 0 0" }}>Click to mark a day as non-working.</p>
      </div>
    );
  }
  return null;
}

export function SettingsV6Wizard() {
  const [stepIdx, setStepIdx] = useState(0);
  const [done, setDone] = useState<Set<string>>(new Set());
  const step = steps[stepIdx];
  const isLast = stepIdx === steps.length - 1;

  const complete = () => {
    setDone(prev => new Set([...prev, step.id]));
    if (!isLast) setStepIdx(i => i + 1);
  };

  return (
    <div style={{ display:"flex", height:"100vh", background:BG, fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", overflow:"hidden" }}>

      {/* Left stepper */}
      <aside style={{ width:260, flexShrink:0, background:PANEL, borderRight:`1px solid ${BORDER}`, display:"flex", flexDirection:"column", padding:"28px 20px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:32 }}>
          <div style={{ width:30, height:30, borderRadius:8, background:G, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 }}>⚙</div>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:TEXT }}>Settings</div>
            <div style={{ fontSize:11, color:MUTED }}>Company configuration</div>
          </div>
        </div>

        <div style={{ fontSize:11, fontWeight:700, color:FAINT, textTransform:"uppercase" as const, letterSpacing:.8, marginBottom:14 }}>Setup Steps</div>

        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
          {steps.map((s, i) => {
            const isDone = done.has(s.id);
            const isActive = i === stepIdx;
            return (
              <button key={s.id} onClick={() => setStepIdx(i)}
                style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 14px", borderRadius:10, border:"none", cursor:"pointer", textAlign:"left" as const,
                  background: isActive ? `${s.color}12` : "transparent", transition:"background .15s" }}>
                {/* Step indicator */}
                <div style={{ width:30, height:30, borderRadius:10, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize: isDone ? 14 : 13,
                  background: isDone ? s.color : isActive ? `${s.color}20` : "#f3f4f6",
                  color: isDone ? "#fff" : isActive ? s.color : FAINT,
                  border: isActive && !isDone ? `1.5px solid ${s.color}` : "none",
                  fontWeight: 700 }}>
                  {isDone ? "✓" : i + 1}
                </div>
                <div>
                  <div style={{ fontSize:13, fontWeight: isActive ? 600 : 400, color: isActive ? s.color : isDone ? MUTED : TEXT }}>{s.title}</div>
                  <div style={{ fontSize:11, color:FAINT, marginTop:1 }}>{s.fields.length} settings</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Progress */}
        <div style={{ marginTop:"auto", paddingTop:20 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
            <span style={{ fontSize:11, color:MUTED }}>Progress</span>
            <span style={{ fontSize:11, color:MUTED }}>{done.size}/{steps.length} sections saved</span>
          </div>
          <div style={{ height:6, borderRadius:3, background:"#f3f4f6", overflow:"hidden" }}>
            <div style={{ height:"100%", borderRadius:3, background:G, width:`${(done.size/steps.length)*100}%`, transition:"width .4s" }} />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex:1, overflowY:"auto", padding:"40px 52px" }}>
        {/* Step header */}
        <div style={{ marginBottom:32 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
            <span style={{ fontSize:11, fontWeight:600, color:step.color, textTransform:"uppercase" as const, letterSpacing:.8 }}>Step {stepIdx + 1} of {steps.length}</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:8 }}>
            <div style={{ width:48, height:48, borderRadius:14, background:`${step.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>{step.icon}</div>
            <div>
              <h1 style={{ fontSize:22, fontWeight:800, color:TEXT, margin:0 }}>{step.title}</h1>
              <p style={{ fontSize:13, color:MUTED, margin:"4px 0 0" }}>{step.desc}</p>
            </div>
          </div>
          {/* Step progress dots */}
          <div style={{ display:"flex", gap:6, marginTop:16 }}>
            {steps.map((s, i) => (
              <div key={s.id} style={{ width: i===stepIdx ? 24 : 8, height:8, borderRadius:4, background: done.has(s.id) ? s.color : i===stepIdx ? step.color : "#e5e7eb", transition:"all .3s", cursor:"pointer" }} onClick={() => setStepIdx(i)} />
            ))}
          </div>
        </div>

        {/* Fields */}
        <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:16, padding:"28px 32px", display:"flex", flexDirection:"column", gap:24, maxWidth:640 }}>
          {step.fields.map((f:any) => <Field key={f.label} f={f} color={step.color} />)}

          {/* Nav buttons */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:8, borderTop:`1px solid ${BORDER}` }}>
            <button onClick={() => stepIdx > 0 && setStepIdx(i => i - 1)}
              style={{ padding:"9px 20px", borderRadius:9, border:`1px solid ${BORDER}`, background:"transparent", fontSize:13, color: stepIdx===0 ? FAINT : MUTED, cursor: stepIdx===0 ? "default" : "pointer", opacity: stepIdx===0 ? .4 : 1 }}
              disabled={stepIdx === 0}>
              ← Back
            </button>
            <button onClick={complete}
              style={{ padding:"10px 28px", borderRadius:9, border:"none", background:step.color, color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:8 }}>
              {isLast ? "Finish setup ✓" : `Save & continue →`}
            </button>
          </div>
        </div>
        <div style={{ height:60 }} />
      </main>
    </div>
  );
}
