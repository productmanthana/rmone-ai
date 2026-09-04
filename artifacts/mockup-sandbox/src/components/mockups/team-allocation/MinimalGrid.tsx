import { useMemo, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  CheckCircle2,
  UserRound,
} from "lucide-react";

type Mode = "person" | "position";

type Week = {
  label: string;
  code: string;
  capacity: number;
  existing: number;
};

const weeks: Week[] = [
  { label: "Aug 24", code: "W35", capacity: 40, existing: 28 },
  { label: "Aug 31", code: "W36", capacity: 40, existing: 34 },
  { label: "Sep 07", code: "W37", capacity: 40, existing: 16 },
  { label: "Sep 14", code: "W38", capacity: 40, existing: 40 },
  { label: "Sep 21", code: "W39", capacity: 40, existing: 20 },
  { label: "Sep 28", code: "W40", capacity: 40, existing: 8 },
  { label: "Oct 05", code: "W41", capacity: 40, existing: 0 },
];

const colors = {
  ink: "#173246",
  muted: "#708692",
  line: "#D9E5E9",
  canvas: "#F2F6F7",
  paper: "#FBFDFC",
  blue: "#5B8CA9",
  blueSoft: "#E6F0F4",
  green: "#5D8D49",
  greenSoft: "#EEF7E9",
  amber: "#A4772B",
  red: "#A85F4D",
};

const buttonStyle: CSSProperties = {
  border: `1px solid ${colors.line}`,
  borderRadius: 8,
  background: colors.paper,
  color: colors.ink,
  cursor: "pointer",
  font: "inherit",
};

function Field({
  label,
  value,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: string;
  icon: typeof UserRound;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} style={{ ...buttonStyle, display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", textAlign: "left", minWidth: 0 }}>
      <Icon size={15} color={colors.blue} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", color: colors.muted, fontSize: 9, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase" }}>{label}</span>
        <span style={{ display: "block", overflow: "hidden", marginTop: 3, textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 800 }}>{value}</span>
      </span>
      <ChevronDown size={14} color={colors.muted} />
    </button>
  );
}

export function MinimalGrid() {
  const [mode, setMode] = useState<Mode>("person");
  const [hours, setHours] = useState([8, 4, 12, 0, 8, 16, 16]);
  const [added, setAdded] = useState(false);
  const total = useMemo(() => hours.reduce((sum, value) => sum + value, 0), [hours]);
  const remaining = weeks.map((week, index) => week.capacity - week.existing - hours[index]);
  const hasWarning = remaining.some(value => value < 0);

  const setWeekHours = (index: number, raw: string) => {
    const next = raw === "" ? 0 : Math.max(0, Number(raw) || 0);
    setHours(current => current.map((value, itemIndex) => itemIndex === index ? next : value));
    setAdded(false);
  };

  return (
    <div style={{ minHeight: "100dvh", boxSizing: "border-box", padding: "30px 28px 38px", background: colors.canvas, color: colors.ink, fontFamily: "'DM Sans', 'Avenir Next', system-ui, sans-serif" }}>
      <style>{`
        .minimal-grid-shell { max-width: 1224px; margin: 0 auto; }
        .minimal-grid-card { border: 1px solid ${colors.line}; border-radius: 14px; overflow: hidden; background: ${colors.paper}; box-shadow: 0 16px 40px rgba(37,72,86,.09); }
        .minimal-grid-table { min-width: 850px; }
        .minimal-grid-cell { border-left: 1px solid #E3ECEF; }
        .minimal-grid-hours { width: 100%; box-sizing: border-box; border: 1px solid #BBD1B0; border-radius: 7px; outline: none; background: #F8FCF5; color: ${colors.ink}; padding: 9px 3px; text-align: center; font: 800 13px 'DM Sans', sans-serif; }
        .minimal-grid-hours:focus { border-color: ${colors.green}; box-shadow: 0 0 0 3px rgba(93,141,73,.13); }
        @media (max-width: 700px) {
          .minimal-grid-page { padding: 18px 14px 28px !important; }
          .minimal-grid-heading { font-size: 25px !important; }
          .minimal-grid-controls { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <div className="minimal-grid-shell minimal-grid-page">
        <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap", marginBottom: 22 }}>
          <div>
            <div style={{ color: colors.blue, fontSize: 10, fontWeight: 900, letterSpacing: ".18em", textTransform: "uppercase" }}>Riverside Office / project team</div>
            <h1 className="minimal-grid-heading" style={{ margin: "8px 0 6px", fontSize: 30, lineHeight: 1.08, letterSpacing: "-.045em" }}>Add team capacity</h1>
            <p style={{ margin: 0, color: colors.muted, fontSize: 13 }}>Choose a role, set a weekly rhythm, and keep the real capacity in view.</p>
          </div>
          <div style={{ color: colors.muted, fontSize: 11, fontWeight: 700 }}>PMM-26-00492 <span style={{ margin: "0 7px", color: "#B6C7CD" }}>/</span> Aug 24 – Oct 11, 2026</div>
        </header>

        <section className="minimal-grid-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", borderBottom: `1px solid ${colors.line}`, padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              <div style={{ display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: 10, background: colors.blueSoft, color: colors.blue }}>
                {mode === "person" ? <UserRound size={19} /> : <BriefcaseBusiness size={19} />}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 15, fontWeight: 900 }}>{mode === "person" ? "John Smith" : "Project Manager · Open position"}</div>
                <div style={{ marginTop: 3, color: colors.muted, fontSize: 11 }}>{mode === "person" ? "Project Manager · Telecom" : "Project Manager · 1 slot available"}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 3, border: `1px solid ${colors.line}`, borderRadius: 9, padding: 3, background: "#F3F7F8" }}>
              {(["person", "position"] as Mode[]).map(option => (
                <button key={option} type="button" onClick={() => { setMode(option); setAdded(false); }} style={{ ...buttonStyle, border: 0, borderRadius: 6, padding: "7px 10px", background: mode === option ? colors.paper : "transparent", color: mode === option ? colors.ink : colors.muted, boxShadow: mode === option ? "0 2px 5px rgba(35,65,76,.09)" : "none", fontSize: 10, fontWeight: 900 }}>
                  {option === "person" ? "Assigned person" : "Open position"}
                </button>
              ))}
            </div>
          </div>

          <div className="minimal-grid-controls" style={{ display: "grid", gridTemplateColumns: "minmax(170px, .7fr) minmax(220px, 1fr) minmax(210px, 1.25fr)", gap: 10, padding: "14px 20px", background: "#F7FAFA" }}>
            <Field label="Role" value="Project Manager" icon={BriefcaseBusiness} onClick={() => undefined} />
            <Field label={mode === "person" ? "Assigned person" : "Open position"} value={mode === "person" ? "John Smith" : "Project Manager · Open position"} icon={mode === "person" ? UserRound : BriefcaseBusiness} onClick={() => undefined} />
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 11px", color: colors.muted, fontSize: 10, lineHeight: 1.35 }}>
              <Check size={15} color={colors.green} />
              <span>Organization context is derived from the selection.</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", padding: "20px 20px 14px" }}>
            <div>
              <div style={{ color: colors.muted, fontSize: 10, fontWeight: 900, letterSpacing: ".13em", textTransform: "uppercase" }}>Weekly allocation</div>
              <div style={{ marginTop: 5, fontSize: 19, fontWeight: 900, letterSpacing: "-.025em" }}>How much time should {mode === "person" ? "John" : "this position"} hold?</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ border: `1px solid ${hasWarning ? "#E5C8B6" : "#C6DDBB"}`, borderRadius: 999, padding: "6px 10px", background: hasWarning ? "#FFF6F1" : colors.greenSoft, color: hasWarning ? colors.red : colors.green, fontSize: 10, fontWeight: 900 }}>
                {hasWarning ? <AlertTriangle size={12} style={{ verticalAlign: "middle", marginRight: 5 }} /> : <CheckCircle2 size={12} style={{ verticalAlign: "middle", marginRight: 5 }} />}
                {hasWarning ? "Over capacity" : "Within capacity"}
              </span>
              <span style={{ color: colors.ink, fontSize: 13, fontWeight: 900 }}>{total}h total</span>
            </div>
          </div>

          <div style={{ overflowX: "auto", padding: "0 20px 20px" }}>
            <div className="minimal-grid-table" style={{ border: `1px solid ${colors.line}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "148px repeat(7, minmax(100px, 1fr))", background: "#F3F7F8", borderBottom: `1px solid ${colors.line}` }}>
                <div style={{ padding: "12px", color: colors.muted, fontSize: 10, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase" }}>Week of</div>
                {weeks.map(week => <div key={week.code} className="minimal-grid-cell" style={{ padding: "10px 5px", textAlign: "center" }}><div style={{ fontSize: 11, fontWeight: 900 }}>{week.label}</div><div style={{ marginTop: 3, color: "#94A7AF", fontSize: 9, fontWeight: 700 }}>{week.code}</div></div>)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "148px repeat(7, minmax(100px, 1fr))", borderBottom: `1px solid ${colors.line}` }}>
                <div style={{ padding: "16px 12px", color: colors.muted, fontSize: 11, fontWeight: 900 }}>Capacity</div>
                {weeks.map(week => <div key={week.code} className="minimal-grid-cell" style={{ padding: "16px 5px", color: colors.muted, textAlign: "center", fontSize: 13, fontWeight: 900 }}>{week.capacity}h</div>)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "148px repeat(7, minmax(100px, 1fr))", borderBottom: `1px solid ${colors.line}` }}>
                <div style={{ padding: "16px 12px", color: colors.muted, fontSize: 11, fontWeight: 900 }}>Existing work</div>
                {weeks.map(week => <div key={week.code} className="minimal-grid-cell" style={{ padding: "13px 9px", textAlign: "center" }}><div style={{ height: 5, borderRadius: 99, background: "#E2EAED" }}><div style={{ width: `${week.existing / week.capacity * 100}%`, height: "100%", borderRadius: 99, background: week.existing === week.capacity ? "#CF8B72" : colors.blue }} /></div><div style={{ marginTop: 7, color: colors.muted, fontSize: 12, fontWeight: 900 }}>{week.existing}h</div></div>)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "148px repeat(7, minmax(100px, 1fr))", background: colors.greenSoft }}>
                <div style={{ padding: "15px 12px", color: colors.green, fontSize: 11, fontWeight: 900 }}>This project</div>
                {weeks.map((week, index) => <div key={week.code} className="minimal-grid-cell" style={{ padding: "10px 8px 8px", borderColor: "#D6E6CF" }}><input className="minimal-grid-hours" aria-label={`This project hours for ${week.label}`} type="number" min="0" value={hours[index]} onChange={event => setWeekHours(index, event.target.value)} /><div style={{ marginTop: 5, color: remaining[index] < 0 ? colors.red : colors.green, textAlign: "center", fontSize: 9, fontWeight: 900 }}>{remaining[index] < 0 ? `${Math.abs(remaining[index])}h over` : `${remaining[index]}h left`}</div></div>)}
              </div>
            </div>
          </div>

          <footer style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", borderTop: `1px solid ${colors.line}`, padding: "14px 20px", background: "#F7FAFA" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, color: hasWarning ? colors.red : colors.green, fontSize: 11, fontWeight: 800 }}>
              {hasWarning ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
              {hasWarning ? "Review the weeks over capacity before adding." : "Remaining capacity is calculated from existing work."}
            </div>
            <div style={{ display: "flex", gap: 9 }}>
              <button type="button" onClick={() => { setHours([8, 4, 12, 0, 8, 16, 16]); setAdded(false); }} style={{ ...buttonStyle, padding: "10px 14px", color: colors.muted, fontSize: 11, fontWeight: 900 }}>Reset</button>
              <button type="button" onClick={() => setAdded(true)} style={{ border: 0, borderRadius: 8, padding: "10px 15px", background: added ? colors.blue : colors.green, color: "#F8FCFA", cursor: "pointer", fontSize: 11, fontWeight: 900 }}>{added ? "Added to team" : "Add to team"}</button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}