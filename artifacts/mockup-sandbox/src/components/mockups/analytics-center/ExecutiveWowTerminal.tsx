import "./_group.css";
import {
  ResponsiveContainer, AreaChart, Area, ComposedChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, LineChart, Line, ReferenceLine, BarChart,
} from "recharts";

/* ================= DATA (identical numbers) ================= */
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
const winRateTrend = [
  { q: "Q1 24", v: 34 }, { q: "Q2 24", v: 38 }, { q: "Q3 24", v: 41 },
  { q: "Q4 24", v: 39 }, { q: "Q1 25", v: 43 },
];
const funnelSteps = [
  { label: "Leads Created", count: 312, pct: 100, adv: "59.9%" },
  { label: "Converted to Opp", count: 187, pct: 59.9, adv: "71.7%" },
  { label: "Proposal Submitted", count: 134, pct: 43.0, adv: "60.4%" },
  { label: "Awarded (Project)", count: 81, pct: 26.0, adv: "" },
];
const funnelByQuarter = [
  { q: "Q2 24", leads: 72, opps: 41, proposals: 29, awarded: 16 },
  { q: "Q3 24", leads: 78, opps: 47, proposals: 34, awarded: 20 },
  { q: "Q4 24", leads: 81, opps: 49, proposals: 36, awarded: 21 },
  { q: "Q1 25", leads: 81, opps: 50, proposals: 35, awarded: 24 },
];
const avgCycleDays = [
  { label: "Lead → Opp", days: 18 },
  { label: "Opp → Proposal", days: 34 },
  { label: "Proposal → Award", days: 47 },
];
const health = [
  { label: "On Schedule", value: 171, pct: 79.9, color: "var(--rm-health-good)" },
  { label: "At Risk", value: 31, pct: 14.5, color: "var(--rm-health-warn)" },
  { label: "Behind", value: 12, pct: 5.6, color: "var(--rm-health-bad)" },
];
const staffSpark = [
  { v: 1408 }, { v: 1414 }, { v: 1421 }, { v: 1419 },
  { v: 1427 }, { v: 1433 }, { v: 1438 }, { v: 1442 },
];
// Division master table (scorecard + projects by division + conversion merged)
const divisions = [
  { name: "Construction Mgmt", backlog: 54.6, staff: 512, projects: 62, health: "good", winRate: 30.9, awarded: 29, leads: 94, delta: +2.1, spark: [49.8, 50.9, 51.6, 52.4, 53.1, 54.6] },
  { name: "Engineering", backlog: 38.2, staff: 361, projects: 47, health: "good", winRate: 28.2, awarded: 22, leads: 78, delta: +1.4, spark: [35.4, 36.1, 36.8, 37.0, 37.6, 38.2] },
  { name: "Program Mgmt", backlog: 27.4, staff: 248, projects: 38, health: "warn", winRate: 23.0, awarded: 14, leads: 61, delta: -0.6, spark: [28.9, 28.4, 28.0, 27.7, 27.5, 27.4] },
  { name: "Environmental", backlog: 15.1, staff: 164, projects: 27, health: "good", winRate: 22.7, awarded: 10, leads: 44, delta: +0.8, spark: [13.6, 13.9, 14.2, 14.6, 14.9, 15.1] },
  { name: "Architecture", backlog: 9.3, staff: 108, projects: 21, health: "warn", winRate: 17.1, awarded: 6, leads: 35, delta: +0.2, spark: [8.8, 8.9, 9.0, 9.1, 9.2, 9.3] },
  { name: "Technology", backlog: 3.6, staff: 49, projects: 12, health: "bad", winRate: 14.8, awarded: 3, leads: 20, delta: -0.4, spark: [4.2, 4.0, 3.9, 3.8, 3.7, 3.6] },
  { name: "Surveying", backlog: 1.8, staff: 22, projects: 7, health: "good", winRate: 19.2, awarded: 2, leads: 10, delta: +0.1, spark: [1.6, 1.6, 1.7, 1.7, 1.8, 1.8] },
];
const coverage = [
  { k: "PIPELINE COVERAGE", v: "1.8×", sub: "vs capacity · 6 mo", trend: [1.5, 1.6, 1.55, 1.7, 1.75, 1.8] },
  { k: "BOOK-TO-BILL TTM", v: "1.12", sub: "awards vs burn", trend: [1.04, 1.06, 1.09, 1.07, 1.1, 1.12] },
  { k: "BACKLOG COVERAGE", v: "9.6 mo", sub: "at current burn", trend: [8.9, 9.0, 9.2, 9.3, 9.5, 9.6] },
  { k: "FORECAST ACCURACY", v: "91.2%", sub: "target >90%", trend: [88.1, 89.0, 89.6, 90.2, 90.7, 91.2] },
];

const tipStyle = {
  background: "#1B2A36",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 4,
  color: "#fff",
  fontSize: 11,
  padding: "6px 8px",
};

const mono: React.CSSProperties = { fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum"', letterSpacing: "0.01em" };

/* ================= atoms ================= */
function Spark({ data, color = "var(--rm-green)", w = 64, h = 18 }: { data: number[]; color?: string; w?: number; h?: number }) {
  const min = Math.min(...data), max = Math.max(...data), rng = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 2 - ((v - min) / rng) * (h - 4)}`).join(" ");
  return (
    <svg width={w} height={h} className="block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={w} cy={h - 2 - ((data[data.length - 1] - min) / rng) * (h - 4)} r="1.8" fill={color} />
    </svg>
  );
}

function heatColor(t: number) {
  // 0 bad → 1 good
  if (t >= 0.75) return "rgba(107,165,57,0.85)";
  if (t >= 0.55) return "rgba(107,165,57,0.45)";
  if (t >= 0.4) return "rgba(196,212,74,0.35)";
  if (t >= 0.25) return "rgba(251,146,60,0.45)";
  return "rgba(248,113,113,0.55)";
}

function SectionHead({ label, right }: { label: string; right?: string }) {
  return (
    <div className="flex items-center justify-between px-2.5 py-[5px]" style={{ borderBottom: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)" }}>
      <span className="text-[10px] font-bold tracking-[0.14em] uppercase" style={{ color: "var(--rm-green-ink)" }}>{label}</span>
      {right && <span className="text-[9.5px] uppercase tracking-wider" style={{ color: "var(--rm-text-faint)" }}>{right}</span>}
    </div>
  );
}

function Cellblock({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col ${className}`} style={{ background: "linear-gradient(180deg, rgba(46,69,87,0.72), rgba(37,55,70,0.9))", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 6 }}>
      {children}
    </div>
  );
}

const axisTick = { fill: "rgba(255,255,255,0.45)", fontSize: 9.5 };

/* ================= page ================= */
export default function ExecutiveWowTerminal() {
  const healthScore = (h: string) => (h === "good" ? 1 : h === "warn" ? 0.45 : 0.1);
  const maxBacklog = 54.6;
  return (
    <div className="rmone-analytics min-h-screen" style={{ background: "radial-gradient(1200px 500px at 55% -180px, rgba(107,165,57,0.10), transparent 60%), var(--rm-bg)", padding: "12px 14px 18px" }}>
      {/* ===== terminal header bar ===== */}
      <div className="flex items-center justify-between mb-2 px-3 py-2 rounded-md" style={{ background: "rgba(0,0,0,0.28)", border: "1px solid rgba(255,255,255,0.12)" }}>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded flex items-center justify-center text-[12px] font-black" style={{ background: "var(--rm-green)", color: "#16240a" }}>RM</div>
          <div className="flex items-baseline gap-2.5">
            <span className="text-[15px] font-extrabold tracking-tight">EXECUTIVE TERMINAL</span>
            <span className="text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--rm-text-faint)" }}>Analytics Center / Executive Analytics</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[10px]" style={mono}>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "var(--rm-green)", boxShadow: "0 0 6px var(--rm-green)" }} /> <span style={{ color: "var(--rm-green-ink)" }}>LIVE · TENANT LIRO</span></span>
          <span style={{ color: "var(--rm-text-muted)" }}>TTM · AS OF 28 FEB 2025</span>
          <span style={{ color: "var(--rm-text-faint)" }}>418 RECORDS · 7 DIVISIONS</span>
        </div>
      </div>

      {/* ===== ticker KPI strip ===== */}
      <div className="grid grid-cols-5 mb-2 rounded-md overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
        {[
          { l: "ACTIVE PROJECTS", v: "214", d: "+9 QoQ", good: true, sp: [198, 202, 205, 203, 209, 214] },
          { l: "WEIGHTED PIPELINE", v: "$28.9M", d: "$63.4M gross · 46% wtd", good: true, sp: pipelineTrend.map(p => p.v) },
          { l: "WIN RATE TTM", v: "43.1%", d: "+2.4 pts QoQ", good: true, sp: winRateTrend.map(p => p.v) },
          { l: "CONTRACT BACKLOG", v: "$148.2M", d: "+3.2% MoM", good: true, sp: backlogTrend.map(p => p.v) },
          { l: "STAFF DEPLOYED", v: "1,442", d: "+34 in 8 wks", good: true, sp: staffSpark.map(p => p.v) },
        ].map((k, i) => (
          <div key={k.l} className="px-3 py-2 flex flex-col gap-0.5" style={{ background: i % 2 ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.18)", borderLeft: i ? "1px solid rgba(255,255,255,0.10)" : "none" }}>
            <div className="text-[9px] font-semibold tracking-[0.13em]" style={{ color: "var(--rm-text-faint)" }}>{k.l}</div>
            <div className="flex items-end justify-between gap-2">
              <span className="text-[21px] font-extrabold leading-none" style={{ ...mono, color: "var(--rm-green-ink)" }}>{k.v}</span>
              <Spark data={k.sp} />
            </div>
            <div className="text-[9.5px] font-medium" style={{ ...mono, color: "var(--rm-health-good)" }}>{k.d}</div>
          </div>
        ))}
      </div>

      {/* ===== main terminal grid ===== */}
      <div className="grid gap-2" style={{ gridTemplateColumns: "440px 1fr 300px" }}>
        {/* ---------- LEFT RAIL: division command table + heatmap ---------- */}
        <div className="flex flex-col gap-2">
          <Cellblock>
            <SectionHead label="Division Rank · Backlog Command" right="$148.2M total" />
            <table className="w-full text-[11px]" style={mono}>
              <thead>
                <tr className="text-[8.5px] uppercase tracking-[0.12em]" style={{ color: "var(--rm-text-faint)" }}>
                  <th className="text-left font-semibold px-2.5 py-1">#</th>
                  <th className="text-left font-semibold py-1">Division</th>
                  <th className="text-right font-semibold py-1">Bklg $M</th>
                  <th className="text-left font-semibold pl-2 py-1 w-[72px]"></th>
                  <th className="text-right font-semibold py-1">Δ MoM</th>
                  <th className="text-right font-semibold py-1">Staff</th>
                  <th className="text-right font-semibold py-1">Proj</th>
                  <th className="text-center font-semibold px-2 py-1">6M</th>
                </tr>
              </thead>
              <tbody>
                {divisions.map((d, i) => (
                  <tr key={d.name} className="transition-colors hover:bg-white/[0.06] cursor-default" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                    <td className="px-2.5 py-[5px] text-[10px]" style={{ color: "var(--rm-text-faint)" }}>{String(i + 1).padStart(2, "0")}</td>
                    <td className="py-[5px] font-medium" style={{ fontFamily: "Inter" }}>{d.name}</td>
                    <td className="py-[5px] text-right font-bold" style={{ color: "var(--rm-green-ink)" }}>{d.backlog.toFixed(1)}</td>
                    <td className="pl-2 py-[5px]">
                      <div className="h-[6px] rounded-sm" style={{ width: `${(d.backlog / maxBacklog) * 100}%`, minWidth: 3, background: "linear-gradient(90deg, rgba(107,165,57,0.55), var(--rm-green))" }} />
                    </td>
                    <td className="py-[5px] text-right font-semibold" style={{ color: d.delta >= 0 ? "var(--rm-health-good)" : "var(--rm-health-bad)", background: d.delta >= 0 ? "rgba(132,204,22,0.07)" : "rgba(248,113,113,0.10)" }}>
                      {d.delta >= 0 ? "+" : ""}{d.delta.toFixed(1)}
                    </td>
                    <td className="py-[5px] text-right" style={{ color: "var(--rm-text-muted)" }}>{d.staff}</td>
                    <td className="py-[5px] text-right" style={{ color: "var(--rm-text-muted)" }}>{d.projects}</td>
                    <td className="px-2 py-[5px]"><Spark data={d.spark} w={46} h={14} color={d.delta >= 0 ? "var(--rm-green)" : "var(--rm-health-bad)"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Cellblock>

          {/* Heatmap */}
          <Cellblock>
            <SectionHead label="Division × Metric Heatmap" right="scaled within column" />
            <div className="px-2.5 py-2">
              <div className="grid text-[9px] uppercase tracking-wider mb-1" style={{ gridTemplateColumns: "130px repeat(4, 1fr)", color: "var(--rm-text-faint)" }}>
                <span></span><span className="text-center">Backlog</span><span className="text-center">Staff</span><span className="text-center">Health</span><span className="text-center">Win %</span>
              </div>
              {divisions.map((d) => (
                <div key={d.name} className="grid items-center gap-[3px] mb-[3px]" style={{ gridTemplateColumns: "130px repeat(4, 1fr)" }}>
                  <span className="text-[10.5px] truncate pr-1" style={{ color: "var(--rm-text-muted)" }}>{d.name}</span>
                  {[d.backlog / 54.6, d.staff / 512, healthScore(d.health), d.winRate / 30.9].map((t, j) => (
                    <div key={j} className="h-[20px] rounded-[3px] flex items-center justify-center text-[9.5px] font-bold" style={{ ...mono, background: heatColor(t), color: t >= 0.55 ? "#16240a" : "rgba(255,255,255,0.9)" }}>
                      {j === 0 ? d.backlog.toFixed(1) : j === 1 ? d.staff : j === 2 ? (d.health === "good" ? "OK" : d.health === "warn" ? "RISK" : "BEHIND") : d.winRate.toFixed(1)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Cellblock>

          {/* Cycle time */}
          <Cellblock>
            <SectionHead label="Cycle Time · Avg Days" right="99d lead → award" />
            <div className="px-2.5 py-2 flex flex-col gap-1.5">
              {avgCycleDays.map((c) => (
                <div key={c.label} className="flex items-center gap-2 text-[10.5px]" style={mono}>
                  <span className="w-[118px]" style={{ color: "var(--rm-text-muted)", fontFamily: "Inter" }}>{c.label}</span>
                  <div className="flex-1 h-[8px] rounded-sm overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div className="h-full rounded-sm" style={{ width: `${(c.days / 47) * 100}%`, background: "linear-gradient(90deg, var(--rm-accent-blue), var(--rm-green))" }} />
                  </div>
                  <span className="w-9 text-right font-bold" style={{ color: "var(--rm-green-ink)" }}>{c.days}d</span>
                </div>
              ))}
            </div>
          </Cellblock>

          {/* Signal feed */}
          <Cellblock className="flex-1">
            <SectionHead label="Desk Signals" right="auto-generated" />
            <div className="px-2.5 py-1.5 flex flex-col">
              {[
                { t: "09:41", tone: "var(--rm-health-good)", tag: "BKLG", msg: "Contract backlog printed new high $148.2M (+3.2% MoM); 12th month above FY plan trajectory." },
                { t: "09:41", tone: "var(--rm-health-good)", tag: "WIN", msg: "TTM win rate 43.1% — 5th consecutive quarter above the 40% target band." },
                { t: "09:40", tone: "var(--rm-health-warn)", tag: "DIV", msg: "Program Mgmt backlog slipped -$0.6M MoM; 7 of 12 behind-schedule projects sit in this division." },
                { t: "09:40", tone: "var(--rm-health-bad)", tag: "RISK", msg: "Technology Solutions flagged BEHIND — backlog down 4 straight months to $3.6M." },
                { t: "09:39", tone: "var(--rm-accent-blue)", tag: "PIPE", msg: "Gross pipeline $63.4M (weighted $28.9M · 46%); Q1 25 awards hit a 4-quarter high of 24." },
                { t: "09:39", tone: "var(--rm-health-good)", tag: "FCST", msg: "Forecast accuracy 91.2% — above the 90% target for a third consecutive month." },
              ].map((s, i) => (
                <div key={i} className="flex gap-2 py-[5px] text-[10px] leading-snug" style={{ borderTop: i ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                  <span style={{ ...mono, color: "var(--rm-text-faint)" }}>{s.t}</span>
                  <span className="px-1 rounded-sm h-fit text-[8.5px] font-bold tracking-wider" style={{ background: "rgba(255,255,255,0.07)", color: s.tone }}>{s.tag}</span>
                  <span style={{ color: "var(--rm-text-muted)" }}>{s.msg}</span>
                </div>
              ))}
            </div>
          </Cellblock>
        </div>

        {/* ---------- CENTER: small multiples ---------- */}
        <div className="flex flex-col gap-2">
          <Cellblock>
            <SectionHead label="Contract Backlog · $M" right="TTM · +$19.8M over 12 mo" />
            <div className="px-1 pt-2 relative">
              <span className="absolute right-3 top-2 text-[10px] font-bold z-10 px-1.5 py-0.5 rounded" style={{ ...mono, color: "#16240a", background: "var(--rm-green-ink)" }}>PEAK 148.2</span>
              <ResponsiveContainer width="100%" height={188}>
                <AreaChart data={backlogTrend} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="wtBk" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--rm-green)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="var(--rm-green)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="m" tick={axisTick} axisLine={false} tickLine={false} />
                  <YAxis domain={[124, 152]} tick={axisTick} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} formatter={(v: number) => [`$${v}M`, "Backlog"]} />
                  <ReferenceLine y={140} stroke="rgba(255,255,255,0.22)" strokeDasharray="4 4" label={{ value: "FY plan 140", fill: "rgba(255,255,255,0.5)", fontSize: 9, position: "insideBottomLeft" }} />
                  <Area dataKey="v" stroke="var(--rm-green)" strokeWidth={2} fill="url(#wtBk)" isAnimationActive={false} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Cellblock>

          <Cellblock>
            <SectionHead label="Win Rate · % Decided Pursuits" right="43.1% TTM · +2.4 pts QoQ" />
            <div className="px-1 pt-2">
              <ResponsiveContainer width="100%" height={158}>
                <LineChart data={winRateTrend} margin={{ top: 8, right: 10, bottom: 0, left: -20 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="q" tick={axisTick} axisLine={false} tickLine={false} />
                  <YAxis domain={[30, 46]} tick={axisTick} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} formatter={(v: number) => [`${v}%`, "Win rate"]} />
                  <ReferenceLine y={40} stroke="rgba(56,189,248,0.35)" strokeDasharray="4 4" label={{ value: "target 40%", fill: "rgba(56,189,248,0.7)", fontSize: 9, position: "insideTopLeft" }} />
                  <Line dataKey="v" stroke="var(--rm-accent-blue)" strokeWidth={2} dot={{ r: 2.6, fill: "var(--rm-accent-blue)", strokeWidth: 0 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Cellblock>

          <Cellblock>
            <SectionHead label="Quarterly Funnel Trend" right="leads / opps / proposals / awarded" />
            <div className="px-1 pt-2">
              <ResponsiveContainer width="100%" height={158}>
                <ComposedChart data={funnelByQuarter} margin={{ top: 4, right: 10, bottom: 0, left: -22 }} barGap={1}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="q" tick={axisTick} axisLine={false} tickLine={false} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="leads" name="Leads" fill="var(--rm-brand-navy)" radius={[2, 2, 0, 0]} barSize={18} isAnimationActive={false} />
                  <Bar dataKey="opps" name="Opps" fill="var(--rm-accent-blue)" radius={[2, 2, 0, 0]} barSize={18} isAnimationActive={false} />
                  <Bar dataKey="proposals" name="Proposals" fill="var(--rm-brand-lime)" radius={[2, 2, 0, 0]} barSize={18} isAnimationActive={false} />
                  <Bar dataKey="awarded" name="Awarded" fill="var(--rm-green)" radius={[2, 2, 0, 0]} barSize={18} isAnimationActive={false} />
                  <Line dataKey="awarded" name="Awarded trend" stroke="var(--rm-green-ink)" strokeWidth={1.4} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-3 px-2.5 pb-1.5">
              {[["Leads", "var(--rm-brand-navy)"], ["Opps", "var(--rm-accent-blue)"], ["Proposals", "var(--rm-brand-lime)"], ["Awarded", "var(--rm-green)"]].map(([l, c]) => (
                <span key={l} className="flex items-center gap-1 text-[9px] uppercase tracking-wider" style={{ color: "var(--rm-text-faint)" }}>
                  <span className="w-1.5 h-1.5 rounded-[2px] inline-block" style={{ background: c }} />{l}
                </span>
              ))}
            </div>
          </Cellblock>

          <Cellblock>
            <SectionHead label="Weighted Pipeline · $M" right="$28.9M weighted · $63.4M gross" />
            <div className="px-1 pt-2">
              <ResponsiveContainer width="100%" height={122}>
                <BarChart data={pipelineTrend} margin={{ top: 4, right: 10, bottom: 0, left: -22 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="m" tick={axisTick} axisLine={false} tickLine={false} />
                  <YAxis domain={[45, 68]} tick={axisTick} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} formatter={(v: number) => [`$${v}M`, "Gross pipeline"]} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="v" fill="rgba(56,189,248,0.55)" radius={[3, 3, 0, 0]} barSize={26} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Cellblock>
        </div>

        {/* ---------- RIGHT RAIL: stat stack ---------- */}
        <div className="flex flex-col gap-2">
          {/* Coverage */}
          <Cellblock>
            <SectionHead label="Coverage Ratios" />
            <div>
              {coverage.map((c, i) => (
                <div key={c.k} className="flex items-center justify-between px-2.5 py-[7px] hover:bg-white/[0.05] transition-colors" style={{ borderTop: i ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
                  <div>
                    <div className="text-[9px] font-semibold tracking-[0.12em]" style={{ color: "var(--rm-text-faint)" }}>{c.k}</div>
                    <div className="text-[9px]" style={{ color: "var(--rm-text-faint)" }}>{c.sub}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Spark data={c.trend} w={40} h={14} />
                    <span className="text-[17px] font-extrabold" style={{ ...mono, color: "var(--rm-green-ink)" }}>{c.v}</span>
                  </div>
                </div>
              ))}
            </div>
          </Cellblock>

          {/* Funnel compressed */}
          <Cellblock>
            <SectionHead label="Conversion Funnel · TTM" right="26.0% end-to-end" />
            <div className="px-2.5 py-2">
              {funnelSteps.map((s, i) => (
                <div key={s.label} className="mb-[7px] last:mb-0">
                  <div className="flex items-center justify-between text-[10px] mb-[3px]">
                    <span style={{ color: "var(--rm-text-muted)" }}>{s.label}</span>
                    <span className="font-bold" style={mono}>
                      {s.count}
                      <span className="ml-1 px-1 py-[1px] rounded-sm text-[8.5px] font-bold" style={{ background: i === 3 ? "var(--rm-green)" : "rgba(255,255,255,0.10)", color: i === 3 ? "#16240a" : "var(--rm-text-muted)" }}>{s.pct}%</span>
                    </span>
                  </div>
                  <div className="h-[7px] rounded-sm overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div className="h-full rounded-sm" style={{ width: `${s.pct}%`, background: i === 3 ? "var(--rm-green)" : i === 2 ? "var(--rm-brand-lime)" : i === 1 ? "var(--rm-accent-blue)" : "var(--rm-brand-navy)" }} />
                  </div>
                  {s.adv && <div className="text-[8.5px] mt-[2px]" style={{ ...mono, color: "var(--rm-text-faint)" }}>→ {s.adv} advance</div>}
                </div>
              ))}
              <div className="mt-1.5 pt-1.5 text-[9.5px]" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", color: "var(--rm-text-faint)" }}>
                60.4% close rate · <span style={{ color: "var(--rm-green-ink)", fontWeight: 700 }}>43.1% TTM win rate</span>
              </div>
            </div>
          </Cellblock>

          {/* Records by status — single stacked bar */}
          <Cellblock>
            <SectionHead label="Records by Status" right="418 total" />
            <div className="px-2.5 py-2">
              <div className="flex h-[14px] rounded-sm overflow-hidden mb-2" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                {recordsByStatus.map((d) => (
                  <div key={d.status} style={{ width: `${(d.count / 418) * 100}%`, background: d.color }} title={`${d.status}: ${d.count}`} />
                ))}
              </div>
              {recordsByStatus.map((d) => (
                <div key={d.status} className="flex items-center justify-between text-[10px] py-[2.5px]">
                  <span className="flex items-center gap-1.5" style={{ color: "var(--rm-text-muted)" }}>
                    <span className="w-1.5 h-1.5 rounded-[2px] inline-block" style={{ background: d.color }} />{d.status}
                  </span>
                  <span className="flex items-baseline" style={mono}>
                    <span className="font-bold w-8 text-right">{d.count}</span>
                    <span className="w-11 text-right" style={{ color: "var(--rm-text-faint)" }}>{((d.count / 418) * 100).toFixed(1)}%</span>
                  </span>
                </div>
              ))}
            </div>
          </Cellblock>

          {/* Schedule health */}
          <Cellblock>
            <SectionHead label="Schedule Health" right="214 active" />
            <div className="px-2.5 py-2">
              <div className="flex h-[14px] rounded-sm overflow-hidden mb-2" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                {health.map((h) => <div key={h.label} style={{ width: `${h.pct}%`, background: h.color }} />)}
              </div>
              {health.map((h) => (
                <div key={h.label} className="flex items-center justify-between text-[10px] py-[2.5px]">
                  <span className="flex items-center gap-1.5" style={{ color: "var(--rm-text-muted)" }}>
                    <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: h.color }} />{h.label}
                  </span>
                  <span className="flex items-baseline" style={mono}><span className="font-bold w-8 text-right">{h.value}</span><span className="w-11 text-right" style={{ color: "var(--rm-text-faint)" }}>{h.pct}%</span></span>
                </div>
              ))}
              <div className="mt-1.5 pt-1.5 text-[9.5px] leading-relaxed" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", color: "var(--rm-text-faint)" }}>
                12 behind — <span style={{ color: "var(--rm-health-warn)" }}>7 Program Mgmt</span>, 3 Technology, 2 Architecture
              </div>
            </div>
          </Cellblock>

          {/* Division conversion mini-rank */}
          <Cellblock>
            <SectionHead label="Conversion Rank" right="awarded / leads" />
            <div className="px-2.5 py-1.5">
              {divisions.slice(0, 5).map((d, i) => (
                <div key={d.name} className="flex items-center gap-2 py-[3.5px] text-[10px]" style={{ borderTop: i ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                  <span className="w-4 text-[9px]" style={{ ...mono, color: "var(--rm-text-faint)" }}>{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex-1 truncate" style={{ color: "var(--rm-text-muted)" }}>{d.name}</span>
                  <span style={{ ...mono, color: "var(--rm-text-faint)" }}>{d.awarded}/{d.leads}</span>
                  <span className="w-11 text-right font-bold" style={{ ...mono, color: heatColor(d.winRate / 30.9).includes("113") ? "var(--rm-health-bad)" : "var(--rm-green-ink)" }}>{d.winRate.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </Cellblock>
        </div>
      </div>

      {/* footer statusline */}
      <div className="flex items-center justify-between mt-2 px-3 py-1.5 rounded-md text-[9.5px]" style={{ ...mono, background: "rgba(0,0,0,0.28)", border: "1px solid rgba(255,255,255,0.10)", color: "var(--rm-text-faint)" }}>
        <span>RM ONE · OPERATIONAL INTELLIGENCE · EXECUTIVE TERMINAL v2</span>
        <span>SRC: PORTFOLIO LEDGER · REFRESH 15 MIN · ALL FIGURES TTM UNLESS NOTED</span>
      </div>
    </div>
  );
}
