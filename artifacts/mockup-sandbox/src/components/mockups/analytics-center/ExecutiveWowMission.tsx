import "./_group.css";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, PieChart, Pie, Cell, LineChart, Line, LabelList,
} from "recharts";

/* ============ DATA (identical to ExecutiveAnalytics) ============ */
const backlogTrend = [
  { m: "Mar", v: 128.4 }, { m: "Apr", v: 131.2 }, { m: "May", v: 129.8 },
  { m: "Jun", v: 134.6 }, { m: "Jul", v: 138.1 }, { m: "Aug", v: 136.9 },
  { m: "Sep", v: 141.3 }, { m: "Oct", v: 143.0 }, { m: "Nov", v: 144.8 },
  { m: "Dec", v: 145.2 }, { m: "Jan", v: 146.7 }, { m: "Feb", v: 148.2 },
];
const pipelineTrend = [
  { m: "Sep", v: 51.2 }, { m: "Oct", v: 55.8 }, { m: "Nov", v: 58.4 },
  { m: "Dec", v: 54.1 }, { m: "Jan", v: 61.7 }, { m: "Feb", v: 63.4 },
];
const recordsByStatus = [
  { status: "Active", count: 214, color: "var(--rm-green)" },
  { status: "Pursuit", count: 68, color: "var(--rm-accent-blue)" },
  { status: "On Hold", count: 23, color: "var(--rm-ink-orange)" },
  { status: "Pending Close", count: 17, color: "var(--rm-ink-violet)" },
  { status: "Closed (12mo)", count: 96, color: "rgba(255,255,255,0.35)" },
];
const projectsByDivision = [
  { div: "Construction Mgmt", count: 62 },
  { div: "Engineering", count: 47 },
  { div: "Program Mgmt", count: 38 },
  { div: "Environmental", count: 27 },
  { div: "Architecture", count: 21 },
  { div: "Technology", count: 12 },
  { div: "Surveying", count: 7 },
];
const winRateTrend = [
  { q: "Q1 24", v: 34 }, { q: "Q2 24", v: 38 }, { q: "Q3 24", v: 41 },
  { q: "Q4 24", v: 39 }, { q: "Q1 25", v: 43 },
];
const funnelSteps = [
  { label: "Leads Created", count: 312, pct: 100, color: "#6B99BB", sub: "All new leads entered" },
  { label: "Converted to Opp", count: 187, pct: 59.9, color: "#38BDF8", sub: "59.9% lead-to-opp rate" },
  { label: "Proposal Submitted", count: 134, pct: 43.0, color: "#C4D44A", sub: "71.7% of opps reached proposal" },
  { label: "Awarded (Project)", count: 81, pct: 26.0, color: "#8EC94A", sub: "60.4% close rate · 43.1% TTM win rate" },
];
const funnelByQuarter = [
  { q: "Q2 24", leads: 72, opps: 41, proposals: 29, awarded: 16 },
  { q: "Q3 24", leads: 78, opps: 47, proposals: 34, awarded: 20 },
  { q: "Q4 24", leads: 81, opps: 49, proposals: 36, awarded: 21 },
  { q: "Q1 25", leads: 81, opps: 50, proposals: 35, awarded: 24 },
];
const avgCycleDays = [
  { label: "Lead → Opp", days: 18, color: "var(--rm-brand-navy)" },
  { label: "Opp → Proposal", days: 34, color: "var(--rm-accent-blue)" },
  { label: "Proposal → Award", days: 47, color: "var(--rm-green)" },
];
const topConvertingDivisions = [
  { div: "Construction Mgmt", leads: 94, awarded: 29, rate: 30.9 },
  { div: "Engineering", leads: 78, awarded: 22, rate: 28.2 },
  { div: "Program Mgmt", leads: 61, awarded: 14, rate: 23.0 },
  { div: "Environmental", leads: 44, awarded: 10, rate: 22.7 },
  { div: "Architecture", leads: 35, awarded: 6, rate: 17.1 },
];
const health = [
  { label: "On Schedule", value: 171, pct: 79.9, color: "var(--rm-health-good)" },
  { label: "At Risk", value: 31, pct: 14.5, color: "var(--rm-health-warn)" },
  { label: "Behind", value: 12, pct: 5.6, color: "var(--rm-health-bad)" },
];
const staffSpark = [
  { w: 1, v: 1408 }, { w: 2, v: 1414 }, { w: 3, v: 1421 }, { w: 4, v: 1419 },
  { w: 5, v: 1427 }, { w: 6, v: 1433 }, { w: 7, v: 1438 }, { w: 8, v: 1442 },
];
const topDivisions = [
  { name: "Construction Management", backlog: 54.6, staff: 512, health: "good" },
  { name: "Engineering", backlog: 38.2, staff: 361, health: "good" },
  { name: "Program Management", backlog: 27.4, staff: 248, health: "warn" },
  { name: "Environmental Services", backlog: 15.1, staff: 164, health: "warn" },
  { name: "Architecture", backlog: 9.3, staff: 108, health: "warn" },
  { name: "Technology Solutions", backlog: 3.6, staff: 49, health: "bad" },
];
const activeSpark = [{ v: 198 }, { v: 202 }, { v: 205 }, { v: 203 }, { v: 209 }, { v: 214 }];

const tipStyle = {
  background: "#1B2A36",
  border: "1px solid rgba(107,165,57,0.35)",
  borderRadius: 10,
  color: "var(--rm-text)",
  fontSize: 12,
  boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
};

/* ============ PRIMITIVES ============ */

function Glass({ children, className = "", style = {} }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`relative rounded-2xl ${className}`}
      style={{
        background: "linear-gradient(160deg, rgba(62,92,117,0.42) 0%, rgba(37,55,70,0.55) 55%, rgba(30,46,60,0.65) 100%)",
        border: "1px solid transparent",
        backgroundClip: "padding-box",
        boxShadow: "0 18px 44px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.08)",
        ...style,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          padding: 1,
          background: "linear-gradient(135deg, rgba(107,165,57,0.55), rgba(107,165,57,0.06) 34%, rgba(56,189,248,0.12) 72%, rgba(255,255,255,0.04))",
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
        }}
      />
      {children}
    </div>
  );
}

function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between mb-2.5">
      <div className="flex items-center gap-2">
        <span className="inline-block w-1 h-3 rounded-full" style={{ background: "var(--rm-green)", boxShadow: "0 0 8px rgba(107,165,57,0.8)" }} />
        <span className="text-[10px] font-semibold uppercase" style={{ letterSpacing: "0.14em", color: "rgba(255,255,255,0.75)" }}>{children}</span>
      </div>
      {right && <span className="text-[10px]" style={{ color: "var(--rm-text-faint)" }}>{right}</span>}
    </div>
  );
}

function DeltaChip({ text, good = true }: { text: string; good?: boolean }) {
  const c = good ? "var(--rm-health-good)" : "var(--rm-health-warn)";
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-md text-[10px] font-semibold tabular-nums"
      style={{ color: c, background: good ? "rgba(132,204,22,0.12)" : "rgba(251,146,60,0.12)", border: `1px solid ${good ? "rgba(132,204,22,0.3)" : "rgba(251,146,60,0.3)"}` }}
    >
      <svg width="7" height="7" viewBox="0 0 8 8">{good
        ? <path d="M4 0 L8 8 L0 8 Z" fill={c} />
        : <path d="M4 8 L0 0 L8 0 Z" fill={c} />}</svg>
      {text}
    </span>
  );
}

/* Radial gauge (SVG arc, glow tip) */
function Gauge({ pct, label, value, sub, color = "var(--rm-green)", size = 128 }: {
  pct: number; label: string; value: string; sub: string; color?: string; size?: number;
}) {
  const r = size / 2 - 12;
  const cx = size / 2, cy = size / 2;
  const start = 135, sweep = 270;
  const a = ((start + (sweep * pct) / 100) * Math.PI) / 180;
  const a0 = (start * Math.PI) / 180;
  const a1 = ((start + sweep) * Math.PI) / 180;
  const pt = (ang: number) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  const [sx, sy] = pt(a0); const [ex, ey] = pt(a1); const [tx, ty] = pt(a);
  const largeBg = sweep > 180 ? 1 : 0;
  const valSweep = (sweep * pct) / 100;
  const largeVal = valSweep > 180 ? 1 : 0;
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} style={{ overflow: "visible" }}>
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${largeBg} 1 ${ex} ${ey}`} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={8} strokeLinecap="round" />
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${largeVal} 1 ${tx} ${ty}`} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${color === "var(--rm-green)" ? "rgba(107,165,57,0.7)" : "rgba(56,189,248,0.6)"})` }} />
        <circle cx={tx} cy={ty} r={5} fill="#fff" style={{ filter: "drop-shadow(0 0 6px rgba(255,255,255,0.9))" }} />
        <text x={cx} y={cy - 2} textAnchor="middle" fill="#fff" fontSize={size > 110 ? 24 : 20} fontWeight={800} style={{ fontVariantNumeric: "tabular-nums" }}>{value}</text>
        <text x={cx} y={cy + 16} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize={9} style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}>{sub}</text>
      </svg>
      <div className="text-[10px] font-semibold uppercase mt-1 text-center" style={{ letterSpacing: "0.12em", color: "rgba(255,255,255,0.7)" }}>{label}</div>
    </div>
  );
}

function KpiCard({ label, value, delta, good = true, spark, accent = "var(--rm-green)" }: {
  label: string; value: string; delta: string; good?: boolean; spark: { v: number }[]; accent?: string;
}) {
  return (
    <Glass className="px-4 py-3 flex flex-col justify-between overflow-hidden">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase" style={{ letterSpacing: "0.13em", color: "rgba(255,255,255,0.6)" }}>{label}</span>
        <DeltaChip text={delta} good={good} />
      </div>
      <div className="flex items-end justify-between gap-2 mt-2">
        <span className="text-[30px] font-extrabold leading-none tabular-nums" style={{ color: "#fff", textShadow: "0 0 24px rgba(107,165,57,0.25)" }}>{value}</span>
        <div className="w-24 h-10">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`kpi-${label.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accent} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area dataKey="v" stroke={accent} strokeWidth={1.6} fill={`url(#kpi-${label.replace(/\W/g, "")})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Glass>
  );
}

/* ============ PAGE ============ */
export default function ExecutiveWowMission() {
  const arrowUp = (c: string) => (
    <svg width="8" height="8" viewBox="0 0 8 8" className="inline-block"><path d="M4 0 L8 8 L0 8 Z" fill={c} /></svg>
  );
  const tickerItems = [
    ...topDivisions.map((d) => ({ label: d.name, val: `$${d.backlog}M`, delta: d.health === "good" ? "+" : d.health === "warn" ? "±" : "−", good: d.health === "good" })),
    { label: "Book-to-Bill", val: "1.12", delta: "+", good: true },
    { label: "Backlog Coverage", val: "9.6 mo", delta: "+", good: true },
    { label: "Behind Schedule", val: "12", delta: "−", good: false },
  ];
  return (
    <div className="rmone-analytics min-h-screen relative overflow-hidden" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* ambient background */}
      <div className="pointer-events-none absolute inset-0" style={{
        background:
          "radial-gradient(1100px 480px at 22% -8%, rgba(107,165,57,0.14), transparent 60%)," +
          "radial-gradient(900px 500px at 92% 8%, rgba(56,189,248,0.08), transparent 55%)," +
          "radial-gradient(1200px 800px at 50% 118%, rgba(20,30,40,0.9), transparent 70%)",
      }} />
      <div className="pointer-events-none absolute inset-0 opacity-[0.35]" style={{
        backgroundImage: "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
        backgroundSize: "44px 44px",
        maskImage: "radial-gradient(900px 520px at 50% 0%, #000 30%, transparent 100%)",
        WebkitMaskImage: "radial-gradient(900px 520px at 50% 0%, #000 30%, transparent 100%)",
      }} />

      <div className="relative p-6 max-w-[1440px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-[13px] font-extrabold"
              style={{ background: "linear-gradient(140deg, #8EC94A, #6BA539)", color: "#16240a", boxShadow: "0 0 24px rgba(107,165,57,0.5)" }}>RM</div>
            <div>
              <div className="text-[11px]" style={{ color: "var(--rm-text-faint)" }}>
                Analytics Center <span className="mx-1">/</span> <span style={{ color: "var(--rm-green-ink)" }}>Executive Analytics</span>
              </div>
              <h1 className="text-[20px] font-extrabold leading-tight tracking-tight">Portfolio Mission Control</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-full font-medium" style={{ background: "var(--rm-green-soft)", color: "var(--rm-green-ink)", border: "1px solid rgba(107,165,57,0.4)" }}>Tenant: LiRo</span>
            <span className="px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--rm-panel-border)", color: "var(--rm-text-muted)" }}>Trailing 12 months · as of Feb 28, 2025</span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium" style={{ background: "rgba(132,204,22,0.1)", border: "1px solid rgba(132,204,22,0.3)", color: "var(--rm-health-good)" }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--rm-health-good)", boxShadow: "0 0 6px rgba(132,204,22,0.9)" }} />LIVE
            </span>
          </div>
        </div>

        {/* Ticker strip */}
        <div className="mb-4 rounded-xl overflow-hidden flex items-center" style={{ background: "rgba(15,25,34,0.55)", border: "1px solid rgba(255,255,255,0.09)" }}>
          <div className="px-3 py-1.5 text-[9px] font-bold uppercase shrink-0" style={{ letterSpacing: "0.16em", color: "#16240a", background: "linear-gradient(140deg, #8EC94A, #6BA539)" }}>Division Backlog</div>
          <div className="flex items-center gap-6 px-4 py-1.5 overflow-hidden whitespace-nowrap">
            {tickerItems.map((t) => (
              <span key={t.label} className="flex items-center gap-1.5 text-[11px] shrink-0">
                <span style={{ color: "var(--rm-text-faint)" }}>{t.label}</span>
                <span className="font-bold tabular-nums" style={{ color: "#fff" }}>{t.val}</span>
                {t.delta !== "±" && arrowUp(t.good ? "var(--rm-health-good)" : "var(--rm-health-bad)")}
              </span>
            ))}
          </div>
        </div>

        {/* HERO: backlog + gauges */}
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Glass className="overflow-hidden" style={{ minHeight: 280, gridColumn: "span 8 / span 8" }}>
            <div className="absolute rounded-2xl overflow-hidden" style={{ left: 0, right: 0, bottom: 0, height: 190 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={backlogTrend} margin={{ top: 14, right: 0, bottom: 18, left: 0 }}>
                  <defs>
                    <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8EC94A" stopOpacity={0.55} />
                      <stop offset="60%" stopColor="#6BA539" stopOpacity={0.16} />
                      <stop offset="100%" stopColor="#6BA539" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="heroStroke" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#38BDF8" />
                      <stop offset="55%" stopColor="#8EC94A" />
                      <stop offset="100%" stopColor="#C4D44A" />
                    </linearGradient>
                  </defs>
                  <YAxis domain={[124, 152]} hide />
                  <Tooltip contentStyle={tipStyle} formatter={(v: number) => [`$${v}M`, "Backlog"]} labelStyle={{ color: "rgba(255,255,255,0.6)" }} />
                  <Area dataKey="v" stroke="url(#heroStroke)" strokeWidth={3} fill="url(#heroFill)" dot={false}
                    style={{ filter: "drop-shadow(0 0 8px rgba(142,201,74,0.65))" }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="relative px-6 pt-5 pb-4 flex flex-col h-full">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.18em", color: "var(--rm-green-ink)" }}>Contract Backlog</span>
                <DeltaChip text="+3.2% MoM" />
                <DeltaChip text="+$19.8M vs Mar" />
              </div>
              <div className="flex items-baseline gap-4 mt-1">
                <span className="font-extrabold tabular-nums leading-none" style={{
                  fontSize: 74, letterSpacing: "-0.03em",
                  background: "linear-gradient(180deg, #FFFFFF 30%, #A8D672 100%)",
                  WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
                  filter: "drop-shadow(0 0 28px rgba(107,165,57,0.35))",
                }}>$148.2M</span>
                <div className="text-[11px] leading-snug" style={{ color: "var(--rm-text-muted)" }}>
                  approved contract value<br />12-month climb · Mar $128.4M → Feb $148.2M
                </div>
              </div>
              <div className="mt-auto flex items-end justify-between text-[10px] tabular-nums" style={{ color: "rgba(255,255,255,0.45)" }}>
                {backlogTrend.map((d) => <span key={d.m}>{d.m}</span>)}
              </div>
            </div>
          </Glass>

          <Glass className="px-5 py-4" style={{ gridColumn: "span 4 / span 4" }}>
            <SectionLabel right="TTM">Command Gauges</SectionLabel>
            <div className="flex items-start justify-around mt-1">
              <Gauge pct={43.1} label="Win Rate" value="43.1%" sub="+2.4 pts QoQ" color="var(--rm-green)" size={126} />
              <Gauge pct={91.2} label="Forecast Acc." value="91.2%" sub="target >90%" color="var(--rm-accent-blue)" size={126} />
            </div>
            <div className="flex items-center justify-center mt-1">
              <Gauge pct={79.9} label="Schedule Health" value="79.9%" sub="171 of 214 on track" color="var(--rm-health-good)" size={118} />
            </div>
          </Glass>
        </div>

        {/* KPI band */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          <KpiCard label="Active Projects" value="214" delta="+9 QoQ" spark={activeSpark} />
          <KpiCard label="Weighted Pipeline" value="$28.9M" delta="46% wtd" spark={pipelineTrend} accent="var(--rm-accent-blue)" />
          <KpiCard label="Gross Pipeline" value="$63.4M" delta="+$12.2M" spark={pipelineTrend} accent="var(--rm-brand-lime)" />
          <KpiCard label="Staff Deployed" value="1,442" delta="+34 / 8 wk" spark={staffSpark} />
        </div>

        {/* Coverage strip */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          {[
            { label: "Pipeline Capacity Coverage", value: "1.8×", sub: "weighted pipeline vs available capacity · next 6 mo", pct: 90 },
            { label: "Book-to-Bill (TTM)", value: "1.12", sub: "new awards vs revenue burned", pct: 74 },
            { label: "Backlog Coverage", value: "9.6 mo", sub: "backlog at current burn rate", pct: 80 },
            { label: "Forecast Accuracy", value: "91.2%", sub: "planned vs landed revenue · target >90%", pct: 91 },
          ].map((s) => (
            <div key={s.label} className="relative rounded-xl px-4 py-3 overflow-hidden"
              style={{ background: "rgba(15,25,34,0.5)", border: "1px solid rgba(255,255,255,0.09)" }}>
              <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: "linear-gradient(180deg, #8EC94A, rgba(107,165,57,0.1))" }} />
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "rgba(255,255,255,0.55)" }}>{s.label}</span>
                <span className="text-[24px] font-extrabold tabular-nums leading-none" style={{ color: "var(--rm-green-ink)", textShadow: "0 0 18px rgba(107,165,57,0.35)" }}>{s.value}</span>
              </div>
              <div className="mt-2 h-[3px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: "linear-gradient(90deg, rgba(107,165,57,0.5), #8EC94A)", boxShadow: "0 0 8px rgba(107,165,57,0.6)" }} />
              </div>
              <div className="text-[10px] mt-1.5" style={{ color: "var(--rm-text-faint)" }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Funnel + trend + divisions */}
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Glass className="col-span-5 px-5 py-4">
            <SectionLabel right="leads → opps → proposals → awarded · TTM">Pipeline Conversion Funnel</SectionLabel>
            <div className="flex flex-col gap-1.5">
              {funnelSteps.map((s, i) => (
                <div key={s.label}>
                  <div className="flex items-center gap-3">
                    <div className="w-[104px] text-[10px] uppercase leading-tight" style={{ letterSpacing: "0.06em", color: "var(--rm-text-muted)" }}>{s.label}</div>
                    <div className="flex-1 h-[30px] relative flex items-center justify-center" style={{ perspective: 200 }}>
                      <div className="h-full rounded-[6px] flex items-center justify-center gap-2 text-[11px] font-bold tabular-nums"
                        style={{
                          width: `${Math.max(s.pct, 24)}%`,
                          backgroundImage: `linear-gradient(90deg, ${s.color}cc, ${s.color})`,
                          color: i < 2 ? "#0c1620" : "#16240a",
                          boxShadow: i === 3 ? "0 0 20px rgba(107,165,57,0.5)" : "0 4px 14px rgba(0,0,0,0.3)",
                        }}>
                        {s.count.toLocaleString()} <span className="font-medium opacity-80">({s.pct}%)</span>
                      </div>
                    </div>
                    <div className="w-[52px] text-right text-[10px] tabular-nums font-semibold" style={{ color: i < funnelSteps.length - 1 ? "var(--rm-accent-blue)" : "var(--rm-green-ink)" }}>
                      {i < funnelSteps.length - 1 ? `▼ ${((funnelSteps[i + 1].count / s.count) * 100).toFixed(1)}%` : "WON"}
                    </div>
                  </div>
                  <div className="text-[9.5px] text-center mt-0.5 mb-0.5" style={{ color: "var(--rm-text-faint)" }}>{s.sub}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              {avgCycleDays.map((c) => (
                <div key={c.label} className="rounded-lg px-2 py-1.5 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="text-[9px] uppercase" style={{ letterSpacing: "0.06em", color: "var(--rm-text-faint)" }}>{c.label}</div>
                  <div className="text-[16px] font-extrabold tabular-nums" style={{ color: c.color }}>{c.days}<span className="text-[10px] font-semibold ml-0.5" style={{ color: "var(--rm-text-muted)" }}>days</span></div>
                </div>
              ))}
            </div>
          </Glass>

          <Glass className="col-span-4 px-5 py-4 flex flex-col">
            <SectionLabel right="count by stage per quarter">Quarterly Funnel Trend</SectionLabel>
            <div className="flex-1 min-h-[210px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelByQuarter} margin={{ top: 6, right: 4, bottom: 0, left: -26 }} barGap={2}>
                  <defs>
                    {[["gNavy", "#6B99BB"], ["gBlue", "#38BDF8"], ["gLime", "#C4D44A"], ["gGreen", "#8EC94A"]].map(([id, c]) => (
                      <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={c} stopOpacity={1} />
                        <stop offset="100%" stopColor={c} stopOpacity={0.35} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="q" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="leads" name="Leads" fill="url(#gNavy)" radius={[4, 4, 0, 0]} barSize={10} isAnimationActive={false} />
                  <Bar dataKey="opps" name="Opps" fill="url(#gBlue)" radius={[4, 4, 0, 0]} barSize={10} isAnimationActive={false} />
                  <Bar dataKey="proposals" name="Proposals" fill="url(#gLime)" radius={[4, 4, 0, 0]} barSize={10} isAnimationActive={false} />
                  <Bar dataKey="awarded" name="Awarded" fill="url(#gGreen)" radius={[4, 4, 0, 0]} barSize={10} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-3 mt-2 flex-wrap">
              {[["Leads", "#6B99BB"], ["Opps", "#38BDF8"], ["Proposals", "#C4D44A"], ["Awarded", "#8EC94A"]].map(([l, c]) => (
                <span key={l} className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--rm-text-muted)" }}>
                  <span className="w-2 h-2 rounded-sm inline-block" style={{ background: c, boxShadow: `0 0 6px ${c}66` }} />{l}
                </span>
              ))}
            </div>
          </Glass>

          <Glass className="col-span-3 px-5 py-4">
            <SectionLabel right="leads vs awarded">Division Conversion</SectionLabel>
            <div className="space-y-2.5">
              {topConvertingDivisions.map((d, i) => (
                <div key={d.div}>
                  <div className="flex justify-between items-baseline text-[11px] mb-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold tabular-nums w-3.5 h-3.5 rounded-[4px] flex items-center justify-center"
                        style={{ background: i === 0 ? "var(--rm-green)" : "rgba(255,255,255,0.1)", color: i === 0 ? "#16240a" : "rgba(255,255,255,0.6)" }}>{i + 1}</span>
                      <span style={{ color: "var(--rm-text-muted)" }}>{d.div}</span>
                    </span>
                    <span className="font-bold tabular-nums">{d.rate}%</span>
                  </div>
                  <div className="h-[6px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div className="h-full rounded-full" style={{
                      width: `${d.rate * 2.8}%`,
                      background: "linear-gradient(90deg, rgba(107,165,57,0.45), #8EC94A)",
                      boxShadow: "0 0 8px rgba(107,165,57,0.55)",
                    }} />
                  </div>
                  <div className="text-[9.5px] mt-0.5 tabular-nums" style={{ color: "var(--rm-text-faint)" }}>{d.awarded} awarded / {d.leads} leads</div>
                </div>
              ))}
            </div>
          </Glass>
        </div>

        {/* Bottom band */}
        <div className="grid grid-cols-12 gap-4">
          <Glass className="col-span-3 px-5 py-4">
            <SectionLabel right="418 total records">Records by Status</SectionLabel>
            <div className="relative w-[150px] h-[150px] mx-auto">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={recordsByStatus} dataKey="count" innerRadius={52} outerRadius={70} paddingAngle={3} cornerRadius={4} stroke="none" isAnimationActive={false}>
                    {recordsByStatus.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={tipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[26px] font-extrabold tabular-nums leading-none" style={{ textShadow: "0 0 18px rgba(107,165,57,0.4)" }}>418</span>
                <span className="text-[9px] uppercase mt-0.5" style={{ letterSpacing: "0.12em", color: "var(--rm-text-faint)" }}>records</span>
              </div>
            </div>
            <div className="space-y-1.5 mt-2">
              {recordsByStatus.map((d) => (
                <div key={d.status} className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5" style={{ color: "var(--rm-text-muted)" }}>
                    <span className="w-2 h-2 rounded-sm inline-block" style={{ background: d.color, boxShadow: `0 0 5px ${typeof d.color === "string" && d.color.startsWith("var") ? "rgba(255,255,255,0.2)" : d.color}` }} />{d.status}
                  </span>
                  <span className="font-bold tabular-nums">{d.count}</span>
                </div>
              ))}
            </div>
          </Glass>

          <Glass className="col-span-3 px-5 py-4 flex flex-col">
            <SectionLabel right="active only">Projects by Division</SectionLabel>
            <div className="flex-1 min-h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={projectsByDivision} layout="vertical" margin={{ top: 0, right: 26, bottom: 0, left: 4 }}>
                  <defs>
                    <linearGradient id="divBar" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="rgba(107,165,57,0.55)" />
                      <stop offset="100%" stopColor="#8EC94A" />
                    </linearGradient>
                  </defs>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="div" width={108} tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 9.5 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="count" fill="url(#divBar)" radius={[0, 5, 5, 0]} barSize={13} isAnimationActive={false}>
                    <LabelList dataKey="count" position="right" style={{ fill: "#A8D672", fontSize: 10, fontWeight: 700 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Glass>

          <Glass className="col-span-3 px-5 py-4 flex flex-col">
            <SectionLabel right="% of decided pursuits">Win Rate Trend</SectionLabel>
            <div className="flex-1 min-h-[150px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={winRateTrend} margin={{ top: 10, right: 8, bottom: 0, left: -24 }}>
                  <defs>
                    <filter id="lineGlow" x="-40%" y="-40%" width="180%" height="180%">
                      <feGaussianBlur stdDeviation="3.5" result="b" />
                      <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="q" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[30, 46]} tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} formatter={(v: number) => [`${v}%`, "Win rate"]} />
                  <Line dataKey="v" stroke="var(--rm-accent-blue)" strokeWidth={2.5} filter="url(#lineGlow)"
                    dot={{ r: 3.5, fill: "#0f1922", stroke: "var(--rm-accent-blue)", strokeWidth: 2 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 rounded-lg px-3 py-2 flex items-center justify-between" style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.25)" }}>
              <span className="text-[10px] uppercase" style={{ letterSpacing: "0.1em", color: "rgba(255,255,255,0.6)" }}>Current TTM</span>
              <span className="text-[18px] font-extrabold tabular-nums" style={{ color: "var(--rm-accent-blue)" }}>43.1%</span>
            </div>
          </Glass>

          <Glass className="col-span-3 px-5 py-4">
            <SectionLabel right="214 active projects">Schedule Health</SectionLabel>
            {/* segmented bar */}
            <div className="h-[10px] rounded-full overflow-hidden flex mb-3" style={{ background: "rgba(255,255,255,0.07)" }}>
              {health.map((h) => (
                <div key={h.label} style={{ width: `${h.pct}%`, background: h.color, boxShadow: `0 0 8px ${h.label === "On Schedule" ? "rgba(132,204,22,0.5)" : "transparent"}` }} />
              ))}
            </div>
            <div className="space-y-2">
              {health.map((h) => (
                <div key={h.label} className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5" style={{ color: "var(--rm-text-muted)" }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: h.color, boxShadow: `0 0 6px ${h.color === "var(--rm-health-good)" ? "rgba(132,204,22,0.8)" : "rgba(0,0,0,0)"}` }} />{h.label}
                  </span>
                  <span className="font-bold tabular-nums">{h.value} <span style={{ color: "var(--rm-text-faint)", fontWeight: 500 }}>· {h.pct}%</span></span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-2 text-[10.5px] leading-relaxed" style={{ color: "var(--rm-text-faint)", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              12 projects flagged behind schedule — 7 in Program Mgmt, 3 in Technology, 2 in Architecture.
            </div>
          </Glass>
        </div>

        {/* Division scorecard */}
        <Glass className="mt-4 px-5 py-4">
          <SectionLabel right="backlog $M · deployed staff · health">Division Scorecard</SectionLabel>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
            {topDivisions.map((d) => {
              const hc = d.health === "good" ? "var(--rm-health-good)" : d.health === "warn" ? "var(--rm-health-warn)" : "var(--rm-health-bad)";
              const share = (d.backlog / 54.6) * 100;
              return (
                <div key={d.name} className="rounded-xl px-3 py-3 relative overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-semibold leading-tight pr-1" style={{ color: "rgba(255,255,255,0.75)" }}>{d.name}</span>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: hc, boxShadow: `0 0 7px ${hc}` }} />
                  </div>
                  <div className="text-[22px] font-extrabold tabular-nums leading-none" style={{ color: "var(--rm-green-ink)" }}>${d.backlog}M</div>
                  <div className="text-[10px] mt-1 tabular-nums" style={{ color: "var(--rm-text-faint)" }}>{d.staff} staff deployed</div>
                  <div className="mt-2 h-[3px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                    <div className="h-full rounded-full" style={{ width: `${share}%`, background: "linear-gradient(90deg, rgba(107,165,57,0.5), #8EC94A)" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Glass>
      </div>
    </div>
  );
}
