import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Layers3,
  UserRound,
} from "lucide-react";

type Mode = "person" | "position";

type Week = {
  label: string;
  code: string;
  capacity: number;
  existing: number;
  initial: number;
};

const weeks: Week[] = [
  { label: "Aug 24", code: "W35", capacity: 40, existing: 28, initial: 8 },
  { label: "Aug 31", code: "W36", capacity: 40, existing: 34, initial: 4 },
  { label: "Sep 07", code: "W37", capacity: 40, existing: 16, initial: 12 },
  { label: "Sep 14", code: "W38", capacity: 40, existing: 40, initial: 0 },
  { label: "Sep 21", code: "W39", capacity: 40, existing: 20, initial: 8 },
  { label: "Sep 28", code: "W40", capacity: 40, existing: 8, initial: 16 },
  { label: "Oct 05", code: "W41", capacity: 40, existing: 0, initial: 16 },
];

const colors = {
  ink: "#173246",
  muted: "#6E8490",
  line: "#DCE7EA",
  page: "#F2F6F5",
  pale: "#F8FBFA",
  teal: "#2D7780",
  tealSoft: "#E1F0EF",
  amber: "#B47832",
  amberSoft: "#FFF3DF",
  coral: "#B45F4F",
  green: "#4D885F",
  greenSoft: "#EAF5E9",
};

function TinyPill({ children, tone = "neutral" }: { children: string; tone?: "neutral" | "good" | "warn" }) {
  const palette = tone === "good"
    ? { bg: colors.greenSoft, fg: colors.green, border: "#CBE4CB" }
    : tone === "warn"
      ? { bg: colors.amberSoft, fg: colors.amber, border: "#EED6A9" }
      : { bg: "#EDF3F3", fg: colors.muted, border: "#D8E5E6" };
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, border: `1px solid ${palette.border}`, borderRadius: 999, padding: "5px 8px", background: palette.bg, color: palette.fg, fontSize: 10, fontWeight: 800, whiteSpace: "nowrap" }}>{tone === "warn" ? <AlertTriangle size={11} /> : tone === "good" ? <CheckCircle2 size={11} /> : <Clock3 size={11} />}{children}</span>;
}

function Metric({ label, value, detail, color = colors.ink }: { label: string; value: string; detail?: string; color?: string }) {
  return <div style={{ display: "grid", gap: 5 }}><div style={{ color: colors.muted, fontSize: 10, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase" }}>{label}</div><div style={{ color, fontSize: 22, fontWeight: 850, letterSpacing: "-.04em" }}>{value}</div>{detail && <div style={{ color: colors.muted, fontSize: 11 }}>{detail}</div>}</div>;
}

export function FocusWeekTimeline() {
  const [mode, setMode] = useState<Mode>("person");
  const [active, setActive] = useState(0);
  const [hours, setHours] = useState(() => weeks.map(week => week.initial));
  const week = weeks[active];
  const remaining = week.capacity - week.existing;
  const afterProject = remaining - hours[active];
  const total = useMemo(() => hours.reduce((sum, value) => sum + value, 0), [hours]);
  const warning = afterProject < 0;

  const setActiveHours = (value: string) => {
    const numeric = Math.max(0, Number(value) || 0);
    setHours(previous => previous.map((current, index) => index === active ? numeric : current));
  };

  return (
    <div style={{ minHeight: "100vh", background: colors.page, color: colors.ink, fontFamily: "'DM Sans', 'Avenir Next', sans-serif", padding: "28px clamp(16px, 4vw, 58px)" }}>
      <style>{`
        * { box-sizing: border-box; }
        button, input { font: inherit; }
        button { cursor: pointer; }
        .focus-week-card { transition: transform .2s ease, box-shadow .2s ease; }
        .focus-week-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(31,73,80,.09); }
        .timeline-scroll { overflow-x: auto; padding: 3px 2px 12px; }
        .timeline-track { min-width: 680px; }
        @media (max-width: 720px) {
          .topline, .header-row, .action-row { align-items: flex-start !important; flex-direction: column !important; }
          .selector-grid, .summary-grid { grid-template-columns: 1fr !important; }
          .metric-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .active-panel { padding: 20px !important; }
        }
      `}</style>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div className="topline" style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <div style={{ color: colors.teal, fontSize: 10, fontWeight: 900, letterSpacing: ".18em", textTransform: "uppercase" }}>Riverside Office · project staffing</div>
            <h1 style={{ margin: "9px 0 7px", fontSize: "clamp(27px, 4vw, 38px)", lineHeight: 1.05, letterSpacing: "-.055em", fontWeight: 850 }}>Add to the project team</h1>
            <p style={{ margin: 0, color: colors.muted, fontSize: 13 }}>Review one week at a time. Your full horizon stays in view.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${colors.line}`, borderRadius: 10, background: "#F8FCFB", padding: "10px 12px", color: colors.ink, fontSize: 11, fontWeight: 800 }}><Layers3 size={14} color={colors.teal} /> PMM-26-00492</div>
        </div>

        <section style={{ border: `1px solid ${colors.line}`, borderRadius: 18, background: "#FBFDFC", boxShadow: "0 18px 45px rgba(42,78,83,.10)", overflow: "hidden" }}>
          <div style={{ padding: "20px 24px 22px", borderBottom: `1px solid ${colors.line}` }}>
            <div className="header-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18 }}>
              <div>
                <div style={{ color: colors.muted, fontSize: 10, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase" }}>Staffing assignment</div>
                <div style={{ marginTop: 6, fontSize: 18, fontWeight: 850, letterSpacing: "-.03em" }}>Who should be planned?</div>
              </div>
              <div style={{ display: "flex", gap: 3, padding: 3, border: `1px solid ${colors.line}`, borderRadius: 10, background: "#F1F6F5" }}>
                {([["person", "Assigned person", UserRound], ["position", "Open position", BriefcaseBusiness]] as const).map(([key, label, Icon]) => <button key={key} type="button" onClick={() => setMode(key)} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: 0, borderRadius: 7, padding: "9px 11px", background: mode === key ? "#FFFFFF" : "transparent", color: mode === key ? colors.ink : colors.muted, boxShadow: mode === key ? "0 2px 7px rgba(30,70,75,.1)" : "none", fontSize: 11, fontWeight: 800 }}><Icon size={14} />{label}</button>)}
              </div>
            </div>
            <div className="selector-grid" style={{ display: "grid", gridTemplateColumns: "minmax(190px, .7fr) minmax(230px, 1fr) 1fr", gap: 12, marginTop: 17 }}>
              <div style={{ border: `1px solid ${colors.line}`, borderRadius: 10, background: "#FFFFFF", padding: "11px 13px" }}><div style={{ color: colors.muted, fontSize: 10, fontWeight: 900, letterSpacing: ".09em", textTransform: "uppercase" }}>Role</div><div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 13, fontWeight: 800 }}>Project Manager <ChevronDown size={15} color={colors.muted} /></div></div>
              <div style={{ border: `1px solid ${colors.line}`, borderRadius: 10, background: "#FFFFFF", padding: "11px 13px" }}><div style={{ color: colors.muted, fontSize: 10, fontWeight: 900, letterSpacing: ".09em", textTransform: "uppercase" }}>{mode === "person" ? "Assigned person" : "Open position"}</div><div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 13, fontWeight: 800 }}>{mode === "person" ? "John Smith" : "Project Manager · Open"} <ChevronDown size={15} color={colors.muted} /></div></div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, borderRadius: 10, background: colors.tealSoft, padding: "10px 13px", color: "#35666C", fontSize: 11, fontWeight: 700 }}><Check size={17} /><span>Telecom · Project Management<br /><small style={{ color: "#6E9292", fontWeight: 600 }}>Organization context is derived</small></span></div>
            </div>
          </div>

          <div style={{ padding: "24px 24px 27px" }}>
            <div className="header-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 18 }}>
              <div><div style={{ color: colors.teal, fontSize: 10, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase" }}>Weekly focus</div><h2 style={{ margin: "7px 0 5px", fontSize: 21, letterSpacing: "-.04em" }}>Choose a week to edit</h2><p style={{ margin: 0, color: colors.muted, fontSize: 12 }}>Capacity and existing work remain visible in every checkpoint.</p></div>
              <TinyPill tone={warning ? "warn" : "good"}>{warning ? "Capacity warning" : "Within capacity"}</TinyPill>
            </div>

            <div className="timeline-scroll" style={{ marginTop: 22 }}>
              <div className="timeline-track" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 9 }}>
                {weeks.map((item, index) => {
                  const free = item.capacity - item.existing;
                  const itemWarning = hours[index] > free;
                  return <button className="focus-week-card" key={item.code} type="button" onClick={() => setActive(index)} aria-pressed={active === index} style={{ position: "relative", minHeight: 111, border: active === index ? `2px solid ${colors.teal}` : `1px solid ${colors.line}`, borderRadius: 12, background: active === index ? "#F1F9F8" : "#FFFFFF", padding: "12px 11px", textAlign: "left", boxShadow: active === index ? "0 7px 18px rgba(45,119,128,.13)" : "none" }}>
                    {active === index && <span style={{ position: "absolute", top: -7, left: 12, borderRadius: 4, background: colors.teal, color: "#fff", padding: "3px 6px", fontSize: 8, fontWeight: 900, letterSpacing: ".08em" }}>EDITING</span>}
                    <div style={{ color: colors.ink, fontSize: 12, fontWeight: 850 }}>{item.label}</div><div style={{ marginTop: 2, color: colors.muted, fontSize: 9, fontWeight: 800 }}>{item.code}</div>
                    <div style={{ height: 5, marginTop: 15, overflow: "hidden", borderRadius: 99, background: "#E7EEEE" }}><div style={{ width: `${Math.min(100, item.existing / item.capacity * 100)}%`, height: "100%", borderRadius: 99, background: item.existing === item.capacity ? colors.coral : colors.teal }} /></div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 9, color: colors.muted, fontSize: 10, fontWeight: 800 }}><span>{item.existing}h existing</span><span style={{ color: itemWarning ? colors.coral : colors.green }}>{hours[index]}h new</span></div>
                  </button>;
                })}
              </div>
            </div>

            <div className="active-panel" style={{ marginTop: 15, border: `1px solid ${warning ? "#E9C6B8" : "#B9D8D5"}`, borderRadius: 15, background: warning ? "#FFF9F6" : "#F5FBFA", padding: 24 }}>
              <div className="header-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}><button type="button" aria-label="Previous week" onClick={() => setActive(Math.max(0, active - 1))} disabled={active === 0} style={{ display: "grid", placeItems: "center", width: 30, height: 30, border: `1px solid ${colors.line}`, borderRadius: 8, background: "#fff", color: active === 0 ? "#B8C6C8" : colors.ink }}><ChevronLeft size={16} /></button><div><div style={{ color: colors.teal, fontSize: 10, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase" }}>Active week · {week.code}</div><div style={{ marginTop: 4, fontSize: 22, fontWeight: 850, letterSpacing: "-.04em" }}>Week of {week.label}</div></div><button type="button" aria-label="Next week" onClick={() => setActive(Math.min(weeks.length - 1, active + 1))} disabled={active === weeks.length - 1} style={{ display: "grid", placeItems: "center", width: 30, height: 30, border: `1px solid ${colors.line}`, borderRadius: 8, background: "#fff", color: active === weeks.length - 1 ? "#B8C6C8" : colors.ink }}><ChevronRight size={16} /></button></div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, color: colors.muted, fontSize: 11, fontWeight: 700 }}><CalendarDays size={14} /> Aug 24 – Oct 11, 2026</div>
              </div>
              <div className="metric-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 23 }}>
                <div style={{ borderRadius: 10, background: "#FFFFFF", padding: "15px 16px" }}><Metric label="Capacity" value={`${week.capacity}h`} detail="weekly maximum" /></div>
                <div style={{ borderRadius: 10, background: "#FFFFFF", padding: "15px 16px" }}><Metric label="Existing work" value={`${week.existing}h`} detail={`${remaining}h remaining`} color={week.existing === week.capacity ? colors.coral : colors.ink} /></div>
                <div style={{ border: `1px solid ${warning ? "#E1B5A4" : "#B8D8B8"}`, borderRadius: 10, background: warning ? "#FFF1EA" : colors.greenSoft, padding: "15px 16px" }}><Metric label="This project" value={`${hours[active]}h`} detail={warning ? `${Math.abs(afterProject)}h over capacity` : `${afterProject}h left after planning`} color={warning ? colors.coral : colors.green} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 18, marginTop: 17, borderTop: `1px solid ${warning ? "#F0DAD1" : "#D8EAE7"}`, paddingTop: 17 }}>
                <div><div style={{ color: colors.green, fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase" }}>This project · direct entry</div><div style={{ marginTop: 5, color: colors.muted, fontSize: 11 }}>How many hours should {mode === "person" ? "John Smith" : "this position"} work this week?</div></div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><input aria-label={`This project hours for ${week.label}`} value={hours[active]} onChange={event => setActiveHours(event.target.value)} style={{ width: 84, border: `2px solid ${warning ? colors.coral : colors.green}`, borderRadius: 9, background: "#FFFFFF", color: colors.ink, padding: "11px 10px", textAlign: "center", fontSize: 18, fontWeight: 850, outline: "none" }} /><span style={{ color: colors.muted, fontSize: 12, fontWeight: 800 }}>hours</span></div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 17, color: warning ? colors.coral : colors.green, fontSize: 11, fontWeight: 750 }}>{warning ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}{warning ? "This plan exceeds real remaining capacity. You can still add it, but review the warning." : "This plan fits the person’s available capacity."}</div>
            </div>

            <div className="action-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginTop: 21 }}>
              <div style={{ color: colors.muted, fontSize: 11 }}>Across all weeks: <strong style={{ color: colors.ink }}>{total}h planned</strong></div>
              <div style={{ display: "flex", gap: 9 }}><button type="button" onClick={() => setHours(weeks.map(weekItem => weekItem.initial))} style={{ border: `1px solid ${colors.line}`, borderRadius: 9, background: "#fff", color: colors.muted, padding: "11px 15px", fontSize: 12, fontWeight: 800 }}>Reset hours</button><button type="button" onClick={() => window.alert("Team member added to Riverside Office.")} style={{ display: "inline-flex", alignItems: "center", gap: 8, border: 0, borderRadius: 9, background: colors.teal, color: "#fff", padding: "12px 17px", fontSize: 12, fontWeight: 850, boxShadow: "0 6px 14px rgba(45,119,128,.2)" }}>Add to team <ArrowRight size={15} /></button></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}