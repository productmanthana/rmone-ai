import { useMemo, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Layers3,
  UserRound,
} from "lucide-react";

type Mode = "person" | "position";

type Week = {
  label: string;
  week: string;
  capacity: number;
  existing: number;
  planned: number;
};

const weeks: Week[] = [
  { label: "Aug 24", week: "W35", capacity: 40, existing: 28, planned: 8 },
  { label: "Aug 31", week: "W36", capacity: 40, existing: 34, planned: 4 },
  { label: "Sep 07", week: "W37", capacity: 40, existing: 16, planned: 12 },
  { label: "Sep 14", week: "W38", capacity: 40, existing: 40, planned: 0 },
  { label: "Sep 21", week: "W39", capacity: 40, existing: 20, planned: 8 },
  { label: "Sep 28", week: "W40", capacity: 40, existing: 8, planned: 16 },
  { label: "Oct 05", week: "W41", capacity: 40, existing: 0, planned: 16 },
];

const colors = {
  ink: "#183A46",
  muted: "#6C8790",
  line: "#D9E7E7",
  pale: "#F4F9F8",
  mint: "#DDF1E4",
  teal: "#2C817B",
  coral: "#C36856",
  amber: "#A8792C",
};

function Choice({
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
    <button type="button" onClick={onClick} style={styles.choice}>
      <span style={styles.choiceLabel}><Icon size={13} />{label}</span>
      <strong>{value}</strong>
      <ChevronDown size={15} color={colors.muted} />
    </button>
  );
}

export function WeeklyCards() {
  const [mode, setMode] = useState<Mode>("person");
  const [hours, setHours] = useState(() => weeks.map((week) => week.planned));
  const [saved, setSaved] = useState(false);

  const total = useMemo(() => hours.reduce((sum, hour) => sum + hour, 0), [hours]);
  const warningCount = useMemo(
    () => weeks.filter((week, index) => week.existing + hours[index] > week.capacity).length,
    [hours],
  );

  const updateHours = (index: number, raw: string) => {
    if (raw === "") {
      setHours((current) => current.map((hour, i) => i === index ? 0 : hour));
      setSaved(false);
      return;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      setHours((current) => current.map((hour, i) => i === index ? Math.max(0, Math.min(80, parsed)) : hour));
      setSaved(false);
    }
  };

  const reset = () => {
    setHours(weeks.map((week) => week.planned));
    setSaved(false);
  };

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.header}>
          <div>
            <div style={styles.kicker}>Project team <span style={styles.slash}>/</span> weekly plan</div>
            <h1 style={styles.title}>Add capacity to Riverside Office</h1>
            <p style={styles.subtitle}>A week-by-week view of real availability. Make the call once, then move quickly.</p>
          </div>
          <div style={styles.projectBadge}>
            <Layers3 size={16} color={colors.teal} />
            <span><b>Riverside Office</b><small>PMM-26-00492</small></span>
          </div>
        </header>

        <section style={styles.identity}>
          <div style={styles.identityIntro}>
            <div style={styles.step}>01</div>
            <div>
              <h2>Who are you adding?</h2>
              <p>Only role and assignment are needed to begin.</p>
            </div>
          </div>
          <div style={styles.toggle}>
            <button type="button" onClick={() => setMode("person")} style={{ ...styles.toggleButton, ...(mode === "person" ? styles.toggleActive : {}) }}>
              <UserRound size={14} /> Assigned person
            </button>
            <button type="button" onClick={() => setMode("position")} style={{ ...styles.toggleButton, ...(mode === "position" ? styles.toggleActive : {}) }}>
              <BriefcaseBusiness size={14} /> Open position
            </button>
          </div>
          <div style={styles.choices}>
            <Choice label="Role" value="Project Manager" icon={BriefcaseBusiness} onClick={() => undefined} />
            <Choice
              label={mode === "person" ? "Assigned person" : "Open position"}
              value={mode === "person" ? "John Smith" : "Project Manager · 1 slot"}
              icon={mode === "person" ? UserRound : BriefcaseBusiness}
              onClick={() => setMode(mode === "person" ? "position" : "person")}
            />
            <div style={styles.derived}>
              <Check size={15} color={colors.teal} />
              <span><b>Riverside Office</b><small>{mode === "person" ? "John’s organization context" : "Role default context"}</small></span>
            </div>
          </div>
        </section>

        <section style={styles.planning}>
          <div style={styles.planningTop}>
            <div style={styles.identityIntro}>
              <div style={{ ...styles.step, background: colors.mint, color: colors.teal }}>02</div>
              <div>
                <h2>Shape the weekly story</h2>
                <p>Enter hours directly. Cards flag a week when this project pushes beyond capacity.</p>
              </div>
            </div>
            <div style={styles.summary}>
              <span style={warningCount ? styles.warningText : styles.goodText}>
                {warningCount ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
                {warningCount ? `${warningCount} week${warningCount > 1 ? "s" : ""} over capacity` : "Within capacity"}
              </span>
              <span style={styles.total}><b>{total}h</b> this project</span>
            </div>
          </div>

          <div style={styles.legend}>
            <span><i style={{ background: "#73A9B2" }} /> Capacity</span>
            <span><i style={{ background: "#BCD1D1" }} /> Existing work</span>
            <span><i style={{ background: colors.teal }} /> This project</span>
            <span style={styles.scrollHint}><Clock3 size={13} /> Scroll to see later weeks</span>
          </div>

          <div style={styles.cardScroller}>
            <div style={styles.cards}>
              {weeks.map((week, index) => {
                const projectTotal = week.existing + hours[index];
                const over = projectTotal > week.capacity;
                const available = Math.max(0, week.capacity - projectTotal);
                return (
                  <article key={week.label} style={{ ...styles.card, ...(over ? styles.cardOver : {}) }}>
                    <div style={styles.cardHeader}>
                      <div><b>{week.label}</b><small>{week.week}</small></div>
                      <span style={{ ...styles.state, ...(over ? styles.stateOver : {}) }}>
                        {over ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                        {over ? "Review" : "Available"}
                      </span>
                    </div>
                    <div style={styles.signal}>
                      <span>Capacity</span><strong>{week.capacity}h</strong>
                    </div>
                    <div style={styles.signal}>
                      <span>Existing work</span><strong>{week.existing}h</strong>
                    </div>
                    <div style={{ ...styles.projectSignal, ...(over ? styles.projectOver : {}) }}>
                      <div style={styles.projectLabel}><span>This project</span><small>type hours</small></div>
                      <div style={styles.inputWrap}>
                        <input aria-label={`This project hours for ${week.label}`} type="number" min="0" max="80" value={hours[index] || ""} onChange={(event) => updateHours(index, event.target.value)} />
                        <span>h</span>
                      </div>
                      <div style={{ ...styles.cardNote, color: over ? colors.coral : colors.teal }}>
                        {over ? `${Math.abs(week.capacity - projectTotal)}h over capacity` : `${available}h still available`}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <div style={styles.footer}>
            <div style={warningCount ? styles.warningText : styles.goodText}>
              {warningCount ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
              {warningCount ? "You can still add them, but review the highlighted weeks." : "Hours can be adjusted after adding the team member."}
            </div>
            <div style={styles.actions}>
              <button type="button" onClick={reset} style={styles.cancel}>Reset hours</button>
              <button type="button" onClick={() => setSaved(true)} style={styles.primary}>
                {saved ? "Added to team" : "Add to team"} <span>→</span>
              </button>
            </div>
          </div>
        </section>

        <div style={styles.meta}><CalendarDays size={14} /> Aug 24 – Oct 11, 2026 <span>·</span> Organization context is derived automatically</div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: "100vh", background: "#EDF5F3", color: colors.ink, fontFamily: "'DM Sans', 'Avenir Next', sans-serif", padding: "34px 28px 40px" },
  shell: { maxWidth: 1240, margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, marginBottom: 25 },
  kicker: { color: colors.teal, fontSize: 10, fontWeight: 800, letterSpacing: "0.17em", textTransform: "uppercase" },
  slash: { color: "#A4C8C4", padding: "0 6px" },
  title: { margin: "10px 0 7px", fontFamily: "'Manrope', 'Avenir Next', sans-serif", fontSize: 31, lineHeight: 1.08, letterSpacing: "-0.045em", fontWeight: 800 },
  subtitle: { margin: 0, color: colors.muted, fontSize: 13 },
  projectBadge: { display: "flex", alignItems: "center", gap: 10, border: `1px solid ${colors.line}`, borderRadius: 12, background: "#F9FCFB", padding: "11px 14px", minWidth: 195 },
  "projectBadge span": { display: "grid", gap: 3, fontSize: 12 },
  "projectBadge small": { color: colors.muted, fontSize: 10, fontWeight: 600 },
  identity: { border: `1px solid ${colors.line}`, borderRadius: 17, background: "#FBFDFC", padding: "20px 22px 21px", boxShadow: "0 14px 35px rgba(50,94,91,0.07)" },
  identityIntro: { display: "flex", alignItems: "center", gap: 11 },
  step: { display: "grid", placeItems: "center", width: 31, height: 31, borderRadius: 10, background: "#E6F0F1", color: colors.teal, fontSize: 11, fontWeight: 900 },
  "identity h2": { margin: 0, fontSize: 16, letterSpacing: "-0.02em" },
  "identity p": { margin: "4px 0 0", color: colors.muted, fontSize: 11 },
  toggle: { display: "flex", gap: 3, padding: 3, marginLeft: "auto", marginTop: -31, width: "fit-content", borderRadius: 9, background: "#EEF5F3" },
  toggleButton: { display: "inline-flex", alignItems: "center", gap: 7, border: 0, borderRadius: 7, background: "transparent", color: colors.muted, padding: "8px 11px", fontSize: 11, fontWeight: 800, cursor: "pointer" },
  toggleActive: { background: "#FFFFFF", color: colors.ink, boxShadow: "0 2px 7px rgba(40,82,80,0.11)" },
  choices: { display: "grid", gridTemplateColumns: "minmax(210px, .7fr) minmax(270px, 1fr) minmax(220px, .8fr)", gap: 12, marginTop: 17 },
  choice: { display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 9, border: `1px solid ${colors.line}`, borderRadius: 10, background: "#FFFFFF", color: colors.ink, padding: "10px 12px", textAlign: "left", cursor: "pointer" },
  choiceLabel: { gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 5, color: colors.muted, fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" },
  "choice strong": { fontSize: 12, whiteSpace: "nowrap" },
  derived: { display: "flex", alignItems: "center", gap: 9, borderRadius: 10, background: "#F0F7F4", padding: "11px 13px" },
  "derived span": { display: "grid", gap: 3, fontSize: 12 },
  "derived small": { color: colors.muted, fontSize: 10 },
  planning: { marginTop: 16, border: `1px solid ${colors.line}`, borderRadius: 17, background: "#FBFDFC", padding: "22px 22px 18px", boxShadow: "0 14px 35px rgba(50,94,91,0.07)" },
  planningTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, flexWrap: "wrap" },
  summary: { display: "flex", alignItems: "center", gap: 16, fontSize: 11, fontWeight: 800 },
  goodText: { display: "inline-flex", alignItems: "center", gap: 6, color: colors.teal, fontSize: 11, fontWeight: 800 },
  warningText: { display: "inline-flex", alignItems: "center", gap: 6, color: colors.coral, fontSize: 11, fontWeight: 800 },
  total: { color: colors.muted, borderLeft: `1px solid ${colors.line}`, paddingLeft: 16 },
  "total b": { color: colors.ink, fontSize: 16 },
  legend: { display: "flex", alignItems: "center", gap: 17, margin: "23px 0 11px", color: colors.muted, fontSize: 10, fontWeight: 800 },
  "legend span": { display: "inline-flex", alignItems: "center", gap: 6 },
  "legend i": { display: "inline-block", width: 7, height: 7, borderRadius: "50%" },
  scrollHint: { marginLeft: "auto", fontWeight: 600, color: "#91A6A6" },
  cardScroller: { overflowX: "auto", paddingBottom: 5, marginRight: -5 },
  cards: { display: "flex", gap: 10, minWidth: 1020 },
  card: { flex: "1 0 136px", minHeight: 270, border: `1px solid ${colors.line}`, borderRadius: 13, background: "#FFFFFF", overflow: "hidden", transition: "transform 160ms ease" },
  cardOver: { borderColor: "#E6B9A9", background: "#FFFBF9" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6, borderBottom: `1px solid ${colors.line}`, padding: "13px 12px 11px" },
  "cardHeader div": { display: "grid", gap: 3 },
  "cardHeader b": { fontSize: 13 },
  "cardHeader small": { color: colors.muted, fontSize: 9, fontWeight: 800, letterSpacing: "0.1em" },
  state: { display: "inline-flex", alignItems: "center", gap: 3, borderRadius: 99, background: "#EAF6ED", color: colors.teal, padding: "4px 6px", fontSize: 8, fontWeight: 900 },
  stateOver: { background: "#FFF0EC", color: colors.coral },
  signal: { display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid #EDF3F1`, padding: "12px" },
  "signal span": { color: colors.muted, fontSize: 10, fontWeight: 700 },
  "signal strong": { fontSize: 12 },
  projectSignal: { margin: 10, border: "1px solid #BBDDC8", borderRadius: 9, background: "#F1FAF3", padding: "10px 9px 9px" },
  projectOver: { borderColor: "#E4B2A3", background: "#FFF3EF" },
  projectLabel: { display: "flex", justifyContent: "space-between", alignItems: "baseline", color: "#37755F", fontSize: 10, fontWeight: 900 },
  "projectLabel small": { color: "#78A08A", fontSize: 8, fontWeight: 700 },
  inputWrap: { display: "flex", alignItems: "center", marginTop: 8, border: "1px solid #A9CEB8", borderRadius: 7, background: "#FFFFFF", paddingRight: 8 },
  "inputWrap input": { width: "100%", border: 0, outline: 0, background: "transparent", color: colors.ink, padding: "7px 6px", fontSize: 16, fontWeight: 900, textAlign: "center" },
  "inputWrap span": { color: colors.muted, fontSize: 10, fontWeight: 800 },
  cardNote: { marginTop: 7, textAlign: "center", fontSize: 9, fontWeight: 800 },
  footer: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 18, paddingTop: 16, borderTop: `1px solid ${colors.line}` },
  actions: { display: "flex", gap: 9 },
  cancel: { border: `1px solid ${colors.line}`, borderRadius: 8, background: "#FFFFFF", color: colors.muted, padding: "10px 14px", fontSize: 11, fontWeight: 800, cursor: "pointer" },
  primary: { display: "inline-flex", alignItems: "center", gap: 10, border: 0, borderRadius: 8, background: colors.teal, color: "#FFFFFF", padding: "11px 16px", fontSize: 11, fontWeight: 800, cursor: "pointer", boxShadow: "0 6px 14px rgba(44,129,123,0.22)" },
  meta: { display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 15, color: "#85A09E", fontSize: 10, fontWeight: 700 },
};