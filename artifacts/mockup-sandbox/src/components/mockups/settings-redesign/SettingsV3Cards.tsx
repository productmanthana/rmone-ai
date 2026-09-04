import { useState } from "react";

const G = "#6BA539";
const G_LIGHT = "#f0f7ea";
const BORDER = "#e5e7eb";
const BG = "#f4f6f9";
const PANEL = "#ffffff";
const TEXT = "#111827";
const MUTED = "#6b7280";
const FAINT = "#9ca3af";

const settingCards = [
  { id:"proj-status",   cat:"projects", catColor:"#6BA539", icon:"🎯", title:"Default Project Status", desc:"Status applied to every new project", type:"select",  value:"Active",            options:["Active","Pipeline","Closed"] },
  { id:"proj-type",     cat:"projects", catColor:"#6BA539", icon:"🏗", title:"Default Project Type",   desc:"Work category for new records",       type:"select",  value:"General",           options:["General","Construction","Engineering","Consulting"] },
  { id:"lifecycle",     cat:"projects", catColor:"#6BA539", icon:"🔄", title:"Lifecycle Phases",        desc:"Default phase set on new projects",   type:"tags",    value:["Preconstruction","Construction","Closeout"] },
  { id:"proj-len",      cat:"projects", catColor:"#6BA539", icon:"📏", title:"Assumed Project Length",  desc:"Months used when no end date is set", type:"number",  value:"6",    unit:"months" },
  { id:"opp-stage",     cat:"projects", catColor:"#6BA539", icon:"🏆", title:"Default Opp Stage",       desc:"Opening stage for new opportunities", type:"select",  value:"Pending Assignment",options:["Pending Assignment","Proposal Development","Contract Negotiations"] },
  { id:"forecast-win",  cat:"projects", catColor:"#6BA539", icon:"🗓", title:"Forecast Window",         desc:"Days ahead for open opportunities",   type:"number",  value:"90",   unit:"days" },
  { id:"disp-mode",     cat:"schedule", catColor:"#3b82f6", icon:"📅", title:"Schedule Display Mode",   desc:"What schedule data shows in the app", type:"select",  value:"Full (phases + weekly hours)", options:["Full (phases + weekly hours)","No schedule (weekly hours only)","No schedule, no hours"] },
  { id:"past-edit",     cat:"schedule", catColor:"#3b82f6", icon:"⏮", title:"Past Date Editing",        desc:"Allow users to edit historical hours", type:"toggle", value:true },
  { id:"past-limit",    cat:"schedule", catColor:"#3b82f6", icon:"🔒", title:"Edit Limit",              desc:"How many weeks back is editable",     type:"number",  value:"4",    unit:"weeks" },
  { id:"nonwork-days",  cat:"schedule", catColor:"#3b82f6", icon:"🛑", title:"Non-working Days",        desc:"Days excluded from capacity",         type:"days",    value:["Sat","Sun"] },
  { id:"week-hrs",      cat:"schedule", catColor:"#3b82f6", icon:"⏱", title:"Hours per Full Week",     desc:"Denominator for 100% allocation",     type:"number",  value:"40",   unit:"hrs" },
  { id:"over-cap",      cat:"staff",    catColor:"#f59e0b", icon:"🔴", title:"Over-capacity Flag",      desc:"Red band starts at this % utilisation",type:"number", value:"100",  unit:"%" },
  { id:"optimal-band",  cat:"staff",    catColor:"#f59e0b", icon:"🟢", title:"Optimal Band",            desc:"Green — healthy lower bound",         type:"number",  value:"75",   unit:"%" },
  { id:"under-alloc",   cat:"staff",    catColor:"#f59e0b", icon:"🟡", title:"Under-allocated Flag",    desc:"Amber — needs more work below this",  type:"number",  value:"50",   unit:"%" },
  { id:"conc-risk",     cat:"staff",    catColor:"#f59e0b", icon:"⚠️", title:"Concentration Risk",      desc:"Alert when project dominates a person",type:"number", value:"80",   unit:"%" },
  { id:"demand-urg",    cat:"staff",    catColor:"#f59e0b", icon:"🚨", title:"Demand Urgency Window",   desc:"Unfilled role becomes urgent within", type:"number",  value:"14",   unit:"days" },
  { id:"fcast-weeks",   cat:"forecast", catColor:"#8b5cf6", icon:"📈", title:"Forecast Window",         desc:"How far ahead the forecast calculates",type:"number", value:"12",   unit:"weeks" },
  { id:"pipe-cover",    cat:"forecast", catColor:"#8b5cf6", icon:"🎯", title:"Pipeline Coverage Target",desc:"Healthy pipeline-to-portfolio ratio",  type:"number",  value:"150",  unit:"%" },
];

const catMeta: Record<string, { label:string; icon:string; color:string }> = {
  projects:  { label:"Projects & Opps", icon:"📋", color:"#6BA539" },
  schedule:  { label:"Schedule",         icon:"📅", color:"#3b82f6" },
  staff:     { label:"Staff & Resources",icon:"👥", color:"#f59e0b" },
  forecast:  { label:"Forecast",         icon:"📈", color:"#8b5cf6" },
};

function SettingCard({ card, active, onActivate }: { card:typeof settingCards[0]; active:boolean; onActivate:()=>void }) {
  const color = card.catColor;
  return (
    <div onClick={onActivate} style={{
      background:PANEL, border:`1.5px solid ${active ? color : BORDER}`,
      borderRadius:14, padding:"18px 20px", cursor:"pointer", transition:"all .15s",
      boxShadow: active ? `0 0 0 3px ${color}18` : "0 1px 3px rgba(0,0,0,.06)",
      display:"flex", flexDirection:"column", gap:12,
    }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
        <div style={{ width:40, height:40, borderRadius:10, background:`${color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>{card.icon}</div>
        {active && <div style={{ width:8, height:8, borderRadius:4, background:color, marginTop:4 }} />}
      </div>
      <div>
        <div style={{ fontSize:13, fontWeight:600, color: active ? color : TEXT, marginBottom:3 }}>{card.title}</div>
        <div style={{ fontSize:11, color:MUTED, lineHeight:1.5 }}>{card.desc}</div>
      </div>
      {/* Value preview */}
      <div style={{ background:BG, borderRadius:8, padding:"7px 12px", fontSize:12, color:MUTED, fontWeight:500 }}>
        {card.type==="toggle" ? (card.value ? "✓ Enabled" : "✗ Disabled")
         : card.type==="tags" ? (card.value as string[]).slice(0,2).join(", ") + ((card.value as string[]).length > 2 ? " …" : "")
         : card.type==="days" ? (card.value as string[]).join(", ") + " off"
         : `${card.value}${(card as any).unit ? " " + (card as any).unit : ""}`}
      </div>
    </div>
  );
}

function EditPanel({ card }: { card: typeof settingCards[0] }) {
  const color = card.catColor;
  return (
    <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:16, padding:"28px 28px 24px", position:"sticky", top:0 }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
        <div style={{ width:40, height:40, borderRadius:10, background:`${color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>{card.icon}</div>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:TEXT }}>{card.title}</div>
          <div style={{ fontSize:12, color:MUTED }}>{card.desc}</div>
        </div>
      </div>
      <div style={{ borderTop:`1px solid ${BORDER}`, paddingTop:20, display:"flex", flexDirection:"column", gap:16 }}>
        {card.type === "select" && (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <label style={{ fontSize:12, fontWeight:600, color:MUTED, textTransform:"uppercase" as const, letterSpacing:.5 }}>Value</label>
            <div style={{ position:"relative" }}>
              <select style={{ width:"100%", padding:"10px 32px 10px 12px", border:`1px solid ${BORDER}`, borderRadius:8, fontSize:13, color:TEXT, background:"#fff", appearance:"none", cursor:"pointer" }}>
                {(card.options??[]).map(o => <option key={o}>{o}</option>)}
              </select>
              <span style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", color:FAINT, pointerEvents:"none" }}>▾</span>
            </div>
          </div>
        )}
        {card.type === "number" && (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <label style={{ fontSize:12, fontWeight:600, color:MUTED, textTransform:"uppercase" as const, letterSpacing:.5 }}>Value {(card as any).unit && `(${(card as any).unit})`}</label>
            <input type="number" defaultValue={card.value as string} style={{ width:120, padding:"10px 12px", border:`1px solid ${BORDER}`, borderRadius:8, fontSize:14, fontWeight:600, color:TEXT, background:"#fff" }} />
          </div>
        )}
        {card.type === "toggle" && (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontSize:13, color:TEXT }}>Enabled</span>
            <div style={{ width:44, height:24, borderRadius:12, background: card.value ? color : "#d1d5db", position:"relative", cursor:"pointer" }}>
              <div style={{ position:"absolute", width:20, height:20, borderRadius:10, background:"#fff", top:2, left: card.value ? 22 : 2 }} />
            </div>
          </div>
        )}
        {card.type === "tags" && (
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, padding:"8px 12px", border:`1px solid ${BORDER}`, borderRadius:8, background:"#fafafa", minHeight:44 }}>
            {(card.value as string[]).map(t => (
              <span key={t} style={{ display:"flex", alignItems:"center", gap:4, padding:"2px 10px", borderRadius:20, background:`${color}15`, border:`1px solid ${color}40`, fontSize:12, color, fontWeight:500 }}>
                {t} <span style={{ opacity:.5 }}>×</span>
              </span>
            ))}
            <span style={{ fontSize:12, color:FAINT, cursor:"pointer" }}>+ Add</span>
          </div>
        )}
        {card.type === "days" && (
          <div style={{ display:"flex", gap:6 }}>
            {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => {
              const off = (card.value as string[]).includes(d);
              return <div key={d} style={{ width:40, height:40, borderRadius:8, border:`1px solid ${off ? "#ef444460" : BORDER}`, background: off ? "#fef2f2" : "#fafafa", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:600, color: off ? "#ef4444" : TEXT }}>{d}</div>;
            })}
          </div>
        )}
      </div>
      <div style={{ marginTop:24 }}>
        <button style={{ width:"100%", padding:"10px 0", borderRadius:10, border:"none", background:color, color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>Save Changes</button>
      </div>
    </div>
  );
}

export function SettingsV3Cards() {
  const [activeCat, setActiveCat] = useState("projects");
  const [activeCard, setActiveCard] = useState<string>("proj-status");
  const filtered = settingCards.filter(c => c.cat === activeCat);
  const selected = settingCards.find(c => c.id === activeCard) ?? filtered[0];

  return (
    <div style={{ display:"flex", height:"100vh", background:BG, fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", overflow:"hidden" }}>
      {/* Top nav */}
      <div style={{ position:"absolute", top:0, left:0, right:0, height:56, background:PANEL, borderBottom:`1px solid ${BORDER}`, display:"flex", alignItems:"center", padding:"0 24px", gap:4, zIndex:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginRight:24 }}>
          <div style={{ width:28, height:28, borderRadius:8, background:G, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>⚙</div>
          <span style={{ fontSize:14, fontWeight:700, color:TEXT }}>Settings</span>
        </div>
        {Object.entries(catMeta).map(([id, m]) => (
          <button key={id} onClick={() => { setActiveCat(id); setActiveCard(settingCards.find(c=>c.cat===id)?.id ?? ""); }}
            style={{ display:"flex", alignItems:"center", gap:7, padding:"7px 14px", borderRadius:8, border:"none", cursor:"pointer",
              background: activeCat===id ? `${m.color}14` : "transparent", color: activeCat===id ? m.color : MUTED,
              fontSize:13, fontWeight: activeCat===id ? 600 : 400 }}>
            <span>{m.icon}</span>{m.label}
          </button>
        ))}
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
          <button style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 12px", borderRadius:8, border:`1px solid ${BORDER}`, background:"#fafafa", cursor:"pointer", fontSize:12, color:MUTED }}>↩ Reset</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display:"flex", flex:1, paddingTop:56, overflow:"hidden" }}>
        {/* Card grid */}
        <div style={{ flex:1, overflowY:"auto", padding:"24px 24px" }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:14 }}>
            {filtered.map(card => (
              <SettingCard key={card.id} card={card} active={activeCard === card.id} onActivate={() => setActiveCard(card.id)} />
            ))}
          </div>
          <div style={{ height:40 }} />
        </div>
        {/* Edit panel */}
        <div style={{ width:340, flexShrink:0, borderLeft:`1px solid ${BORDER}`, overflowY:"auto", padding:"24px 20px" }}>
          {selected && <EditPanel card={selected} />}
        </div>
      </div>
    </div>
  );
}
