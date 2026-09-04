import "./_group.css";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, LineChart, Line,
} from "recharts";

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
  { label: "Leads Created", count: 312, pct: 100, color: "var(--rm-brand-navy)", sub: "All new leads entered" },
  { label: "Converted to Opp", count: 187, pct: 59.9, color: "var(--rm-accent-blue)", sub: "59.9% lead-to-opp" },
  { label: "Proposal Submitted", count: 134, pct: 43.0, color: "var(--rm-brand-lime)", sub: "71.7% of opps" },
  { label: "Awarded (Project)", count: 81, pct: 26.0, color: "var(--rm-green)", sub: "60.4% close rate" },
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
const activeSpark = [{ v: 198 }, { v: 202 }, { v: 205 }, { v: 203 }, { v: 209 }, { v: 214 }];
const topDivisions = [
  { name: "Construction Management", backlog: 54.6, staff: 512, health: "good" },
  { name: "Engineering", backlog: 38.2, staff: 361, health: "good" },
  { name: "Program Management", backlog: 27.4, staff: 248, health: "warn" },
  { name: "Environmental Services", backlog: 15.1, staff: 164, health: "good" },
  { name: "Architecture", backlog: 9.3, staff: 108, health: "warn" },
  { name: "Technology Solutions", backlog: 3.6, staff: 49, health: "bad" },
];

const tipStyle = {
  background: "var(--rm-panel-soft)",
  border: "1px solid var(--rm-panel-border)",
  borderRadius: 10,
  color: "var(--rm-text)",
  fontSize: 12,
};

const tileBase: React.CSSProperties = {
  background: "linear-gradient(160deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.012) 55%), var(--rm-panel)",
  border: "1px solid var(--rm-panel-border)",
  borderRadius: 16,
  boxShadow: "var(--rm-shadow), inset 0 1px 0 rgba(255,255,255,0.08)",
  transition: "transform .18s ease, box-shadow .18s ease",
};

function Tile({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`relative overflow-hidden flex flex-col ${className}`}
      style={{ ...tileBase, ...style }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 14px 34px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.1)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = tileBase.boxShadow as string; }}
    >
      {children}
    </div>
  );
}

function Label({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: dark ? "rgba(12,24,10,0.72)" : "var(--rm-text-faint)" }}>
      {children}
    </div>
  );
}

function Pill({ children, tone = "good" }: { children: React.ReactNode; tone?: "good" | "bad" | "neutral" | "ink" }) {
  const map = {
    good: { bg: "rgba(132,204,22,0.16)", color: "#B7E36B", border: "rgba(132,204,22,0.35)" },
    bad: { bg: "rgba(248,113,113,0.14)", color: "#FCA5A5", border: "rgba(248,113,113,0.35)" },
    neutral: { bg: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)", border: "rgba(255,255,255,0.16)" },
    ink: { bg: "rgba(12,24,10,0.22)", color: "#F4FCE8", border: "rgba(12,24,10,0.3)" },
  }[tone];
  return (
    <span className="inline-flex items-center px-2 py-[3px] rounded-full text-[10px] font-semibold tabular-nums" style={{ background: map.bg, color: map.color, border: `1px solid ${map.border}` }}>
      {children}
    </span>
  );
}

function Ring({ pct, size = 92, stroke = 9, color = "var(--rm-green)", label, sub }: { pct: number; size?: number; stroke?: number; color?: string; label: string; sub?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[17px] font-bold tabular-nums leading-none">{label}</div>
        {sub && <div className="text-[9px] mt-0.5" style={{ color: "var(--rm-text-faint)" }}>{sub}</div>}
      </div>
    </div>
  );
}

export default function ExecutiveWowBento() {
  return (
    <div className="rmone-analytics min-h-screen" style={{ background: "radial-gradient(1200px 500px at 20% -10%, rgba(107,165,57,0.10), transparent 60%), radial-gradient(900px 420px at 90% 0%, rgba(56,189,248,0.07), transparent 55%), var(--rm-bg)" }}>
      <div className="mx-auto px-8 py-6" style={{ maxWidth: 1440 }}>
        {/* Header */}
        <div className="flex items-end justify-between mb-5">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[14px] font-extrabold" style={{ background: "linear-gradient(135deg, #8EC94A, #4E7F26)", color: "#12200a", boxShadow: "0 6px 18px rgba(107,165,57,0.35)" }}>RM</div>
            <div>
              <div className="text-[11px]" style={{ color: "var(--rm-text-faint)" }}>Analytics Center <span className="mx-1">/</span> <span style={{ color: "var(--rm-green-ink)" }}>Executive Analytics</span></div>
              <h1 className="text-[26px] font-extrabold leading-tight" style={{ letterSpacing: "-0.02em" }}>Portfolio at a Glance</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <Pill tone="good">Tenant: LiRo</Pill>
            <span className="px-2.5 py-1 rounded-full" style={{ background: "var(--rm-panel-soft)", border: "1px solid var(--rm-panel-border)", color: "var(--rm-text-muted)" }}>Trailing 12 months · as of Feb 28, 2025</span>
          </div>
        </div>

        {/* ===== BENTO GRID ===== */}
        <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(12, 1fr)", gridAutoRows: "minmax(128px, auto)", gridAutoFlow: "row dense" }}>

          {/* HERO ACCENT — Weighted Pipeline 2x2 */}
          <Tile className="col-span-4 p-6" style={{ gridRow: "span 2", background: "linear-gradient(150deg, #7FB947 0%, #5C9330 42%, #2C5340 78%, #22394A 100%)", border: "1px solid rgba(255,255,255,0.22)" }}>
            <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(400px 200px at 100% 0%, rgba(255,255,255,0.16), transparent 60%)" }} />
            <Label dark>Weighted Pipeline</Label>
            <div className="mt-2 text-[56px] font-extrabold leading-none tabular-nums" style={{ color: "#FCFFF6", letterSpacing: "-0.035em", textShadow: "0 2px 12px rgba(12,24,10,0.25)" }}>$28.9M</div>
            <div className="mt-2 flex items-center gap-2">
              <Pill tone="ink">$63.4M gross</Pill>
              <Pill tone="ink">46% weighted</Pill>
            </div>
            <div className="mt-auto pt-3 text-[10px] font-medium" style={{ color: "rgba(244,252,232,0.78)" }}>Gross pipeline Sep → Feb · +23.8% over 6 mo</div>
            <div className="-mx-6 -mb-6 mt-1" style={{ height: 110 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={pipelineTrend} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
                  <Tooltip contentStyle={tipStyle} formatter={(v: number) => [`$${v}M`, "Gross pipeline"]} labelFormatter={(l) => l} />
                  <Area dataKey="v" stroke="rgba(255,255,255,0.95)" strokeWidth={2.5} fill="rgba(12,24,10,0.22)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Tile>

          {/* Backlog hero 2x2 with full-bleed chart */}
          <Tile className="col-span-5 p-6" style={{ gridRow: "span 2" }}>
            <div className="flex items-start justify-between">
              <div>
                <Label>Contract Backlog</Label>
                <div className="mt-1.5 text-[48px] font-extrabold leading-none tabular-nums" style={{ color: "var(--rm-green-ink)", letterSpacing: "-0.03em" }}>$148.2M</div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <Pill tone="good">+3.2% MoM</Pill>
                <Pill tone="neutral">9.6 mo coverage</Pill>
              </div>
            </div>
            <div className="mt-3 -mx-6 -mb-6 flex-1" style={{ minHeight: 140 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={backlogTrend} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="bkg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8EC94A" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#8EC94A" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="m" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9 }} axisLine={false} tickLine={false} interval={1} />
                  <Tooltip contentStyle={tipStyle} formatter={(v: number) => [`$${v}M`, "Backlog"]} />
                  <Area dataKey="v" stroke="#A8D672" strokeWidth={2.5} fill="url(#bkg)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Tile>

          {/* 1x1 stat: Active Projects */}
          <Tile className="col-span-3 p-5 justify-between" style={{ minHeight: 128 }}>
            <div className="flex items-start justify-between">
              <Label>Active Projects</Label>
              <Pill tone="good">+9 QoQ</Pill>
            </div>
            <div className="flex items-end justify-between gap-2">
              <div className="text-[44px] font-extrabold leading-none tabular-nums" style={{ letterSpacing: "-0.03em" }}>214</div>
              <div className="w-24 h-10">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={activeSpark} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                    <Area dataKey="v" stroke="var(--rm-green)" strokeWidth={2} fill="var(--rm-green-soft)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Tile>

          {/* 1x1 stat: Staff */}
          <Tile className="col-span-3 p-5 justify-between" style={{ minHeight: 128 }}>
            <div className="flex items-start justify-between">
              <Label>Staff Deployed</Label>
              <Pill tone="good">+34 / 8 wk</Pill>
            </div>
            <div className="flex items-end justify-between gap-2">
              <div className="text-[44px] font-extrabold leading-none tabular-nums" style={{ letterSpacing: "-0.03em" }}>1,442</div>
              <div className="w-24 h-10">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={staffSpark} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                    <Area dataKey="v" stroke="var(--rm-accent-blue)" strokeWidth={2} fill="rgba(56,189,248,0.14)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Tile>

          {/* ACCENT 2 — Book-to-bill + coverage rings row */}
          <Tile className="col-span-3 p-5 justify-between" style={{ background: "linear-gradient(155deg, #6BA539 0%, #47772A 55%, #274A3E 100%)", border: "1px solid rgba(255,255,255,0.2)", minHeight: 128 }}>
            <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(260px 130px at 100% 0%, rgba(255,255,255,0.14), transparent 60%)" }} />
            <Label dark>Book-to-Bill · TTM</Label>
            <div className="flex items-end justify-between">
              <div className="text-[44px] font-extrabold leading-none tabular-nums" style={{ color: "#FCFFF6", letterSpacing: "-0.03em" }}>1.12</div>
              <div className="text-right text-[10px] font-medium leading-snug" style={{ color: "rgba(244,252,232,0.8)" }}>new awards vs<br />revenue burned</div>
            </div>
          </Tile>

          {/* Win rate 1x1 with line */}
          <Tile className="col-span-3 p-5 justify-between" style={{ minHeight: 128 }}>
            <div className="flex items-start justify-between">
              <Label>Win Rate · TTM</Label>
              <Pill tone="good">+2.4 pts QoQ</Pill>
            </div>
            <div className="flex items-end justify-between gap-2">
              <div className="text-[44px] font-extrabold leading-none tabular-nums" style={{ color: "var(--rm-green-ink)", letterSpacing: "-0.03em" }}>43.1%</div>
              <div className="w-24 h-10">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={winRateTrend} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
                    <Line dataKey="v" stroke="var(--rm-accent-blue)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Tile>

          {/* Coverage rings — 2 tiles */}
          <Tile className="col-span-3 p-4 flex-row items-center gap-4" style={{ minHeight: 128, flexDirection: "row" }}>
            <Ring pct={90} label="1.8×" sub="coverage" color="var(--rm-green)" />
            <div>
              <Label>Pipeline Capacity Coverage</Label>
              <div className="text-[11px] mt-1 leading-snug" style={{ color: "var(--rm-text-muted)" }}>weighted pipeline vs available capacity · next 6 mo</div>
              <div className="mt-1.5"><Pill tone="good">healthy</Pill></div>
            </div>
          </Tile>
          <Tile className="col-span-3 p-4 flex-row items-center gap-4" style={{ minHeight: 128, flexDirection: "row" }}>
            <Ring pct={91.2} label="91.2%" sub="accuracy" color="var(--rm-accent-blue)" />
            <div>
              <Label>Forecast Accuracy</Label>
              <div className="text-[11px] mt-1 leading-snug" style={{ color: "var(--rm-text-muted)" }}>planned vs landed revenue · target &gt;90%</div>
              <div className="mt-1.5"><Pill tone="good">above target</Pill></div>
            </div>
          </Tile>

          {/* Funnel — chunky segmented bar, 2x1 wide */}
          <Tile className="col-span-7 p-6">
            <div className="flex items-baseline justify-between mb-4">
              <div>
                <Label>Pipeline Conversion Funnel</Label>
                <div className="text-[15px] font-bold mt-0.5">Leads → Opps → Proposals → Awarded</div>
              </div>
              <span className="text-[11px]" style={{ color: "var(--rm-text-faint)" }}>trailing 12 months · 43.1% TTM win rate</span>
            </div>
            {/* Segmented bar */}
            <div className="flex w-full h-[54px] rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
              {funnelSteps.map((s, i) => {
                const shortLabels = ["Leads", "Opps", "Proposals", "Awarded"];
                const share = i === funnelSteps.length - 1 ? s.count : s.count - funnelSteps[i + 1].count;
                return (
                  <div key={s.label} className="flex flex-col justify-center px-3" style={{ flexGrow: share, flexBasis: 0, minWidth: 96, background: s.color, color: i < 2 ? "#fff" : "#16240a", borderLeft: i > 0 ? "1px solid rgba(0,0,0,0.18)" : "none" }}>
                    <div className="text-[16px] font-extrabold tabular-nums leading-none">{s.count}</div>
                    <div className="text-[9px] font-semibold uppercase tracking-wide mt-0.5 opacity-80 whitespace-nowrap">{shortLabels[i]}</div>
                  </div>
                );
              })}
            </div>
            {/* Stage detail row */}
            <div className="grid grid-cols-4 gap-3 mt-3">
              {funnelSteps.map((s, i) => (
                <div key={s.label} className="rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold tabular-nums">{s.pct}%</span>
                    {i < 3 && <span style={{ color: "var(--rm-text-faint)" }}>→ {((funnelSteps[i + 1].count / s.count) * 100).toFixed(1)}%</span>}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--rm-text-muted)" }}>{s.sub}</div>
                </div>
              ))}
            </div>
            {/* Cycle time */}
            <div className="flex items-center gap-4 mt-4 pt-3" style={{ borderTop: "1px solid var(--rm-panel-border)" }}>
              <Label>Avg Cycle</Label>
              {avgCycleDays.map((c) => (
                <div key={c.label} className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: c.color }} />
                  <span style={{ color: "var(--rm-text-muted)" }}>{c.label}</span>
                  <span className="font-bold tabular-nums">{c.days}d</span>
                </div>
              ))}
              <span className="ml-auto text-[11px] font-semibold tabular-nums" style={{ color: "var(--rm-green-ink)" }}>99 days lead → award</span>
            </div>
          </Tile>

          {/* Quarterly funnel trend */}
          <Tile className="col-span-5 p-6">
            <div className="flex items-baseline justify-between mb-1">
              <div>
                <Label>Quarterly Funnel Trend</Label>
                <div className="text-[15px] font-bold mt-0.5">Stage counts per quarter</div>
              </div>
              <div className="flex gap-2.5">
                {[["Leads", "var(--rm-brand-navy)"], ["Opps", "var(--rm-accent-blue)"], ["Prop.", "var(--rm-brand-lime)"], ["Won", "var(--rm-green)"]].map(([l, c]) => (
                  <span key={l} className="flex items-center gap-1 text-[10px]" style={{ color: "var(--rm-text-faint)" }}>
                    <span className="w-2 h-2 rounded-sm inline-block" style={{ background: c }} />{l}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex-1" style={{ minHeight: 165 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelByQuarter} margin={{ top: 10, right: 4, bottom: 0, left: -24 }} barGap={3}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="q" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
                  <Bar dataKey="leads" name="Leads" fill="var(--rm-brand-navy)" radius={[4, 4, 0, 0]} barSize={11} isAnimationActive={false} />
                  <Bar dataKey="opps" name="Opps" fill="var(--rm-accent-blue)" radius={[4, 4, 0, 0]} barSize={11} isAnimationActive={false} />
                  <Bar dataKey="proposals" name="Proposals" fill="var(--rm-brand-lime)" radius={[4, 4, 0, 0]} barSize={11} isAnimationActive={false} />
                  <Bar dataKey="awarded" name="Awarded" fill="var(--rm-green)" radius={[4, 4, 0, 0]} barSize={11} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[10px] mt-1" style={{ color: "var(--rm-text-faint)" }}>Awards up 50% since Q2 24 (16 → 24) on flat lead volume — conversion quality improving.</div>
          </Tile>

          {/* Division scorecard — dense mini table 2x1 */}
          <Tile className="col-span-7 p-6">
            <div className="flex items-baseline justify-between mb-3">
              <div>
                <Label>Division Scorecard</Label>
                <div className="text-[15px] font-bold mt-0.5">Backlog · staff · health</div>
              </div>
              <span className="text-[11px]" style={{ color: "var(--rm-text-faint)" }}>$148.2M total backlog</span>
            </div>
            <div className="space-y-2.5">
              {topDivisions.map((d) => (
                <div key={d.name} className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.health === "good" ? "var(--rm-health-good)" : d.health === "warn" ? "var(--rm-health-warn)" : "var(--rm-health-bad)" }} />
                  <span className="text-[12px] w-[168px] shrink-0 truncate" style={{ color: "var(--rm-text)" }}>{d.name}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div className="h-full rounded-full" style={{ width: `${(d.backlog / 54.6) * 100}%`, background: "linear-gradient(90deg, #4E7F26, #8EC94A)" }} />
                  </div>
                  <span className="text-[12px] font-bold tabular-nums w-[56px] text-right shrink-0" style={{ color: "var(--rm-green-ink)" }}>${d.backlog}M</span>
                  <span className="text-[11px] tabular-nums w-[52px] text-right shrink-0" style={{ color: "var(--rm-text-muted)" }}>{d.staff} ppl</span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-2.5 flex gap-4 text-[10px]" style={{ borderTop: "1px solid var(--rm-panel-border)", color: "var(--rm-text-faint)" }}>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "var(--rm-health-good)" }} /> healthy</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "var(--rm-health-warn)" }} /> watch</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "var(--rm-health-bad)" }} /> intervene</span>
            </div>
          </Tile>

          {/* Records by status — segmented bar + list */}
          <Tile className="col-span-3 p-5">
            <div className="flex items-baseline justify-between mb-2">
              <Label>Records by Status</Label>
              <span className="text-[11px] font-bold tabular-nums">418</span>
            </div>
            <div className="flex w-full h-3 rounded-full overflow-hidden mb-3">
              {recordsByStatus.map((d) => (
                <div key={d.status} style={{ width: `${(d.count / 418) * 100}%`, background: d.color }} />
              ))}
            </div>
            <div className="space-y-1.5 flex-1">
              {recordsByStatus.map((d) => (
                <div key={d.status} className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5" style={{ color: "var(--rm-text-muted)" }}>
                    <span className="w-2 h-2 rounded-sm inline-block" style={{ background: d.color }} />{d.status}
                  </span>
                  <span className="font-semibold tabular-nums">{d.count} <span style={{ color: "var(--rm-text-faint)", fontWeight: 400 }}>· {((d.count / 418) * 100).toFixed(1)}%</span></span>
                </div>
              ))}
            </div>
          </Tile>

          {/* Schedule health */}
          <Tile className="col-span-4 p-5">
            <div className="flex items-baseline justify-between mb-2">
              <Label>Schedule Health</Label>
              <span className="text-[11px]" style={{ color: "var(--rm-text-faint)" }}>214 active projects</span>
            </div>
            <div className="flex items-center gap-4 mb-3">
              <Ring pct={79.9} size={78} stroke={8} label="79.9%" sub="on track" color="var(--rm-health-good)" />
              <div className="flex-1 space-y-2">
                {health.map((h) => (
                  <div key={h.label}>
                    <div className="flex justify-between text-[11px] mb-0.5">
                      <span style={{ color: "var(--rm-text-muted)" }}>{h.label}</span>
                      <span className="font-semibold tabular-nums">{h.value} · {h.pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                      <div className="h-full rounded-full" style={{ width: `${h.pct}%`, background: h.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="text-[11px] leading-relaxed pt-2" style={{ color: "var(--rm-text-faint)", borderTop: "1px solid var(--rm-panel-border)" }}>
              12 projects behind schedule — 7 Program Mgmt · 3 Technology · 2 Architecture.
            </div>
          </Tile>

          {/* Conversion by division */}
          <Tile className="col-span-5 p-5">
            <div className="flex items-baseline justify-between mb-3">
              <Label>Division Conversion · Leads → Awarded</Label>
              <span className="text-[11px]" style={{ color: "var(--rm-text-faint)" }}>TTM</span>
            </div>
            <div className="space-y-2.5 flex-1">
              {topConvertingDivisions.map((d, i) => (
                <div key={d.div} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold tabular-nums w-4 shrink-0" style={{ color: i === 0 ? "var(--rm-green-ink)" : "var(--rm-text-faint)" }}>#{i + 1}</span>
                  <span className="text-[12px] w-[130px] shrink-0 truncate" style={{ color: "var(--rm-text)" }}>{d.div}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div className="h-full rounded-full" style={{ width: `${d.rate * 2.6}%`, background: i === 0 ? "linear-gradient(90deg, #4E7F26, #A8D672)" : "var(--rm-green)", opacity: i === 0 ? 1 : 0.75 }} />
                  </div>
                  <span className="text-[12px] font-bold tabular-nums w-[46px] text-right shrink-0">{d.rate}%</span>
                  <span className="text-[10px] tabular-nums w-[46px] text-right shrink-0" style={{ color: "var(--rm-text-faint)" }}>{d.awarded}/{d.leads}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-2.5 text-[10px]" style={{ borderTop: "1px solid var(--rm-panel-border)", color: "var(--rm-text-faint)" }}>
              Construction Mgmt converts 1.8× better than Architecture — pursuit rigor gap.
            </div>
          </Tile>

          {/* Projects by division mini bars */}
          <Tile className="col-span-3 p-5">
            <div className="flex items-baseline justify-between mb-2">
              <Label>Projects by Division</Label>
              <span className="text-[11px]" style={{ color: "var(--rm-text-faint)" }}>active</span>
            </div>
            <div className="space-y-[7px] flex-1">
              {projectsByDivision.map((d) => (
                <div key={d.div} className="flex items-center gap-2">
                  <span className="text-[10px] w-[92px] shrink-0 truncate" style={{ color: "var(--rm-text-muted)" }}>{d.div}</span>
                  <div className="flex-1 h-[10px] rounded overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div className="h-full rounded" style={{ width: `${(d.count / 62) * 100}%`, background: "var(--rm-green)" }} />
                  </div>
                  <span className="text-[11px] font-semibold tabular-nums w-6 text-right">{d.count}</span>
                </div>
              ))}
            </div>
          </Tile>
        </div>
      </div>
    </div>
  );
}
