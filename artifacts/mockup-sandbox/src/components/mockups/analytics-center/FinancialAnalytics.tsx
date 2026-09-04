import "./_group.css";
import { useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

/* ---------------------------------- data ---------------------------------- */

const backlogBySector = [
  { sector: "Transportation", v: 46.8 },
  { sector: "K-12 / Higher Ed", v: 31.2 },
  { sector: "Healthcare", v: 24.5 },
  { sector: "Water / Environment", v: 19.7 },
  { sector: "Public Buildings", v: 15.4 },
  { sector: "Energy", v: 10.6 },
];

const contractedVsAllocatedHrs = [
  { div: "Construction Mgmt", contracted: 412, allocated: 371 },
  { div: "Engineering", contracted: 386, allocated: 348 },
  { div: "Environmental", contracted: 176, allocated: 149 },
  { div: "Architecture", contracted: 141, allocated: 118 },
  { div: "Program Mgmt", contracted: 125, allocated: 94 },
];

const monthlyTrend = [
  { m: "May", contracted: 7.6, allocated: 6.4, jobCost: 5.5, nonJob: 0.94 },
  { m: "Jun", contracted: 7.8, allocated: 6.6, jobCost: 5.6, nonJob: 0.96 },
  { m: "Jul", contracted: 7.9, allocated: 6.8, jobCost: 5.8, nonJob: 1.01 },
  { m: "Aug", contracted: 8.0, allocated: 6.9, jobCost: 5.9, nonJob: 1.03 },
  { m: "Sep", contracted: 8.1, allocated: 7.0, jobCost: 6.0, nonJob: 1.02 },
  { m: "Oct", contracted: 8.2, allocated: 7.0, jobCost: 6.0, nonJob: 1.04 },
  { m: "Nov", contracted: 8.1, allocated: 7.1, jobCost: 6.1, nonJob: 1.05 },
  { m: "Dec", contracted: 8.0, allocated: 6.9, jobCost: 5.9, nonJob: 1.08 },
  { m: "Jan", contracted: 8.2, allocated: 7.1, jobCost: 6.0, nonJob: 1.02 },
  { m: "Feb", contracted: 8.3, allocated: 7.2, jobCost: 6.1, nonJob: 1.01 },
  { m: "Mar", contracted: 8.4, allocated: 7.3, jobCost: 6.2, nonJob: 1.03 },
  { m: "Apr", contracted: 8.5, allocated: 7.4, jobCost: 6.3, nonJob: 1.06 },
];

const nonJobBreakdown = [
  { cat: "Overhead / Admin", v: 5.4 },
  { cat: "Business Development", v: 2.8 },
  { cat: "Training & PD", v: 1.7 },
  { cat: "Internal Initiatives", v: 1.4 },
  { cat: "Bench / Unassigned", v: 1.0 },
];

const backlogTrend = [
  { m: "May", v: 131 }, { m: "Jun", v: 133 }, { m: "Jul", v: 136 },
  { m: "Aug", v: 138 }, { m: "Sep", v: 139 }, { m: "Oct", v: 141 },
  { m: "Nov", v: 142 }, { m: "Dec", v: 143 }, { m: "Jan", v: 144 },
  { m: "Feb", v: 145 }, { m: "Mar", v: 147 }, { m: "Apr", v: 148.2 },
];

const bases = ["Trailing 12 months", "Fiscal YTD", "Run-rate"] as const;

const tipStyle = {
  background: "#1B2A36",
  border: "1px solid rgba(107,165,57,0.35)",
  borderRadius: 10,
  color: "var(--rm-text)",
  fontSize: 12,
  boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
};

/* -------------------------------- primitives ------------------------------- */

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

function PlannedTag() {
  return (
    <span
      className="rounded-full px-1.5 py-px text-[9px] font-bold uppercase"
      style={{ letterSpacing: "0.08em", background: "rgba(240,168,66,0.16)", color: "#F0A842", border: "1px solid rgba(240,168,66,0.4)" }}
    >
      Planned
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
  const valSweep = (sweep * pct) / 100;
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} style={{ overflow: "visible" }}>
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={8} strokeLinecap="round" />
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${valSweep > 180 ? 1 : 0} 1 ${tx} ${ty}`} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 6px rgba(107,165,57,0.6))" }} />
        <circle cx={tx} cy={ty} r={5} fill="#fff" style={{ filter: "drop-shadow(0 0 6px rgba(255,255,255,0.9))" }} />
        <text x={cx} y={cy - 2} textAnchor="middle" fill="#fff" fontSize={size > 110 ? 24 : 20} fontWeight={800} style={{ fontVariantNumeric: "tabular-nums" }}>{value}</text>
        <text x={cx} y={cy + 16} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize={9} style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}>{sub}</text>
      </svg>
      <div className="text-[10px] font-semibold uppercase mt-1 text-center" style={{ letterSpacing: "0.12em", color: "rgba(255,255,255,0.7)" }}>{label}</div>
    </div>
  );
}

/* ----------------------------------- page ---------------------------------- */

export default function FinancialAnalytics() {
  const [basis, setBasis] = useState<(typeof bases)[number]>("Trailing 12 months");

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
                Analytics Center <span className="mx-1">/</span> <span style={{ color: "var(--rm-green-ink)" }}>Financial Analytics</span>
                <span className="ml-2 px-2 py-0.5 rounded-full text-[10px]" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--rm-panel-border)", color: "var(--rm-text-muted)" }}>Financial access</span>
              </div>
              <h1 className="text-[20px] font-extrabold leading-tight tracking-tight">Financial Health — Annualized</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-full font-medium" style={{ background: "var(--rm-green-soft)", color: "var(--rm-green-ink)", border: "1px solid rgba(107,165,57,0.4)" }}>Tenant: LiRo</span>
            <span className="px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--rm-panel-border)", color: "var(--rm-text-muted)" }}>May 2024 – Apr 2025</span>
            {/* Annualization basis selector */}
            <div className="flex items-center rounded-lg p-1" style={{ background: "rgba(15,25,34,0.55)", border: "1px solid rgba(255,255,255,0.1)" }}>
              {bases.map((b) => (
                <button
                  key={b}
                  onClick={() => setBasis(b)}
                  className="rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors"
                  style={
                    basis === b
                      ? { background: "linear-gradient(140deg, #8EC94A, #6BA539)", color: "#16240a", boxShadow: "0 0 14px rgba(107,165,57,0.5)", fontWeight: 700 }
                      : { color: "var(--rm-text-muted)" }
                  }
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Notes strip */}
        <div
          className="mb-4 flex items-center gap-3 rounded-xl px-4 py-2 text-[11px]"
          style={{ background: "rgba(240,168,66,0.08)", border: "1px solid rgba(240,168,66,0.3)", color: "var(--rm-text-muted)" }}
        >
          <PlannedTag />
          <span>
            Basis: <span className="font-semibold" style={{ color: "var(--rm-text)" }}>{basis}</span> — pending client confirmation.
            All costs are <span className="font-semibold" style={{ color: "#F0A842" }}>Planned</span> (allocations × cost rates); no timesheet actuals exist yet.
          </span>
        </div>

        {/* HERO: the client's 5 metrics as large varied stat cards */}
        <div className="grid grid-cols-12 gap-4 mb-4">
          {/* Metric 1 — accent-gradient hero card with backlog spark behind */}
          <div className="relative rounded-2xl overflow-hidden px-5 pt-4 pb-3 flex flex-col" style={{
            gridColumn: "span 4 / span 4", minHeight: 176,
            background: "linear-gradient(150deg, rgba(107,165,57,0.32), rgba(37,55,70,0.7) 70%)",
            border: "1px solid rgba(142,201,74,0.5)",
            boxShadow: "0 18px 44px rgba(0,0,0,0.4), 0 0 40px rgba(107,165,57,0.18) inset",
          }}>
            <div className="absolute left-0 right-0 bottom-0" style={{ height: 84 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={backlogTrend} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="finHeroFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8EC94A" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#6BA539" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis domain={[125, 155]} hide />
                  <Tooltip contentStyle={tipStyle} formatter={(v: number) => [`$${v}M`, "Backlog"]} />
                  <Area dataKey="v" stroke="#C4D44A" strokeWidth={2.5} fill="url(#finHeroFill)" dot={false}
                    style={{ filter: "drop-shadow(0 0 8px rgba(196,212,74,0.6))" }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="relative">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.16em", color: "var(--rm-green-ink)" }}>01 · Contract Revenue (Backlog)</span>
              </div>
              <div className="font-extrabold tabular-nums leading-none mt-1" style={{
                fontSize: 58, letterSpacing: "-0.03em",
                background: "linear-gradient(180deg, #FFFFFF 30%, #A8D672 100%)",
                WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
                filter: "drop-shadow(0 0 24px rgba(107,165,57,0.4))",
              }}>$148.2M</div>
              <div className="text-[10.5px] mt-1.5" style={{ color: "rgba(255,255,255,0.75)" }}>
                Total value of approved contracts · 244 records
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>12-month climb: May $131M → Apr $148.2M</div>
            </div>
          </div>

          {/* Metrics 2 & 3 — glass stat cards with inline coverage bar */}
          <div className="grid grid-rows-2 gap-4" style={{ gridColumn: "span 4 / span 4" }}>
            <Glass className="px-4 py-3 flex flex-col justify-center">
              <div className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "rgba(255,255,255,0.6)" }}>02 · Total Contracted Labor</div>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-[32px] font-extrabold tabular-nums leading-none" style={{ textShadow: "0 0 22px rgba(107,165,57,0.3)" }}>1.24M hrs</span>
                <span className="text-[16px] font-bold tabular-nums" style={{ color: "var(--rm-green-ink)" }}>$96.5M</span>
              </div>
              <div className="text-[10px] mt-1" style={{ color: "var(--rm-text-faint)" }}>Hours and dollars we are contracted to deliver</div>
            </Glass>
            <Glass className="px-4 py-3 flex flex-col justify-center">
              <div className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "rgba(255,255,255,0.6)" }}>03 · Total Allocated Labor</div>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-[32px] font-extrabold tabular-nums leading-none" style={{ textShadow: "0 0 22px rgba(56,189,248,0.3)" }}>1.08M hrs</span>
                <span className="text-[16px] font-bold tabular-nums" style={{ color: "var(--rm-accent-blue)" }}>$84.2M</span>
              </div>
              <div className="mt-1.5 h-[4px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="h-full rounded-full" style={{ width: "87%", background: "linear-gradient(90deg, rgba(56,189,248,0.5), #38BDF8)", boxShadow: "0 0 8px rgba(56,189,248,0.6)" }} />
              </div>
              <div className="text-[10px] mt-1" style={{ color: "var(--rm-text-faint)" }}>87% of contracted work is already assigned to people</div>
            </Glass>
          </div>

          {/* Metrics 4 & 5 — gauge card for the cost split */}
          <Glass className="px-4 py-3" style={{ gridColumn: "span 4 / span 4" }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "rgba(255,255,255,0.6)" }}>04–05 · Planned Cost Split</span>
              <PlannedTag />
            </div>
            <div className="flex items-center gap-3 mt-1">
              <Gauge pct={85.4} label="Job Chargeable" value="85.4%" sub="of cost base" size={116} />
              <div className="flex-1 space-y-2.5">
                <div>
                  <div className="text-[9.5px] uppercase" style={{ letterSpacing: "0.1em", color: "var(--rm-text-faint)" }}>04 · Job Chargeable Cost</div>
                  <div className="text-[24px] font-extrabold tabular-nums leading-none" style={{ color: "#8EC94A", textShadow: "0 0 18px rgba(142,201,74,0.35)" }}>$71.9M</div>
                </div>
                <div>
                  <div className="text-[9.5px] uppercase" style={{ letterSpacing: "0.1em", color: "var(--rm-text-faint)" }}>05 · Non-Job Chargeable Cost</div>
                  <div className="text-[24px] font-extrabold tabular-nums leading-none" style={{ color: "#F0A842", textShadow: "0 0 18px rgba(240,168,66,0.3)" }}>$12.3M</div>
                  <div className="text-[10px] mt-0.5 tabular-nums" style={{ color: "var(--rm-text-faint)" }}>14.6% of planned cost base</div>
                </div>
              </div>
            </div>
            <div className="text-[10px] mt-1" style={{ color: "var(--rm-text-faint)" }}>
              Plain English: $85 of every $100 in planned cost goes to billable project work.
            </div>
          </Glass>
        </div>

        {/* THE one supporting trend chart + supporting lists */}
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Glass className="col-span-6 px-5 py-4 flex flex-col">
            <SectionLabel right="$M per month · costs are Planned">Monthly Trend — Contracted, Allocated & Planned Costs</SectionLabel>
            <div className="text-[10.5px] mb-1" style={{ color: "var(--rm-text-faint)" }}>Takeaway: contracted and allocated dollars climb steadily; costs track in step.</div>
            <div className="flex-1 min-h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyTrend} margin={{ top: 4, right: 0, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="finNonJob" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F0A842" stopOpacity={1} />
                      <stop offset="100%" stopColor="#F0A842" stopOpacity={0.35} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="m" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} formatter={(v: number) => [`$${v}M`]} />
                  <Legend wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.65)" }} />
                  <Bar dataKey="nonJob" name="Non-Job Cost (Planned)" fill="url(#finNonJob)" radius={[3, 3, 0, 0]} barSize={9} isAnimationActive={false} />
                  <Line type="monotone" dataKey="contracted" name="Contracted $" stroke="#6B99BB" strokeWidth={2.4} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="allocated" name="Allocated $" stroke="#8EC94A" strokeWidth={2.4} dot={false}
                    style={{ filter: "drop-shadow(0 0 6px rgba(142,201,74,0.5))" }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="jobCost" name="Job Cost (Planned)" stroke="#C4D44A" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Glass>

          {/* Backlog by sector — ranked list with inline bars */}
          <Glass className="col-span-3 px-5 py-4">
            <SectionLabel right="$M · approved">Backlog by Sector</SectionLabel>
            <div className="space-y-2.5">
              {backlogBySector.map((s, i) => (
                <div key={s.sector}>
                  <div className="flex justify-between items-baseline text-[11px] mb-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold tabular-nums w-3.5 h-3.5 rounded-[4px] flex items-center justify-center"
                        style={{ background: i === 0 ? "var(--rm-green)" : "rgba(255,255,255,0.1)", color: i === 0 ? "#16240a" : "rgba(255,255,255,0.6)" }}>{i + 1}</span>
                      <span style={{ color: "var(--rm-text-muted)" }}>{s.sector}</span>
                    </span>
                    <span className="font-bold tabular-nums">${s.v}M</span>
                  </div>
                  <div className="h-[6px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div className="h-full rounded-full" style={{
                      width: `${(s.v / 46.8) * 100}%`,
                      background: "linear-gradient(90deg, rgba(107,165,57,0.45), #8EC94A)",
                      boxShadow: "0 0 8px rgba(107,165,57,0.55)",
                    }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[10px] mt-3" style={{ color: "var(--rm-text-faint)" }}>Transportation carries the biggest book of signed work.</div>
          </Glass>

          {/* Contracted vs allocated hours — paired stat rows */}
          <Glass className="col-span-3 px-5 py-4">
            <SectionLabel right="K hrs · annualized">Contracted vs Allocated Hours</SectionLabel>
            <div className="space-y-2.5">
              {contractedVsAllocatedHrs.map((d) => {
                const pct = (d.allocated / d.contracted) * 100;
                return (
                  <div key={d.div}>
                    <div className="flex justify-between items-baseline text-[11px] mb-1">
                      <span style={{ color: "var(--rm-text-muted)" }}>{d.div}</span>
                      <span className="tabular-nums">
                        <span style={{ color: "#6B99BB" }}>{d.contracted}K</span>
                        <span style={{ color: "var(--rm-text-faint)" }}> → </span>
                        <span className="font-bold" style={{ color: "#8EC94A" }}>{d.allocated}K</span>
                      </span>
                    </div>
                    <div className="h-[6px] rounded-full overflow-hidden relative" style={{ background: "rgba(107,153,187,0.25)" }}>
                      <div className="h-full rounded-full" style={{
                        width: `${pct}%`,
                        background: "linear-gradient(90deg, rgba(107,165,57,0.45), #8EC94A)",
                        boxShadow: "0 0 8px rgba(107,165,57,0.5)",
                      }} />
                    </div>
                    <div className="text-[9.5px] mt-0.5 tabular-nums" style={{ color: "var(--rm-text-faint)" }}>{pct.toFixed(0)}% of contracted hours staffed</div>
                  </div>
                );
              })}
            </div>
          </Glass>
        </div>

        {/* Non-job breakdown + coverage callouts */}
        <div className="grid grid-cols-12 gap-4">
          <Glass className="col-span-4 px-5 py-4">
            <SectionLabel right={<PlannedTag />}>Non-Job Chargeable Breakdown</SectionLabel>
            <div className="text-[10.5px] mb-2.5" style={{ color: "var(--rm-text-faint)" }}>Where the $12.3M of non-billable planned cost goes.</div>
            <div className="space-y-2.5">
              {nonJobBreakdown.map((e) => (
                <div key={e.cat}>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span style={{ color: "var(--rm-text-muted)" }}>{e.cat}</span>
                    <span className="font-bold tabular-nums">${e.v}M</span>
                  </div>
                  <div className="h-[6px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div className="h-full rounded-full" style={{
                      width: `${(e.v / 5.4) * 100}%`,
                      background: "linear-gradient(90deg, rgba(240,168,66,0.45), #F0A842)",
                      boxShadow: "0 0 8px rgba(240,168,66,0.5)",
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </Glass>

          <div className="col-span-8 grid grid-cols-2 gap-4">
            {[
              { label: "Allocation Coverage (Dollars)", value: "87.3%", sub: "$84.2M of $96.5M contracted dollars already assigned", pct: 87.3 },
              { label: "Allocation Coverage (Hours)", value: "87.1%", sub: "1.08M of 1.24M contracted hours already staffed", pct: 87.1 },
              { label: "Avg Planned Cost Rate", value: "$77.96/hr", sub: "blended across 1,278 staff", pct: 78 },
              { label: "Non-Job Cost Ratio", value: "14.6%", sub: "inside the 12–16% target band (Planned)", pct: 60 },
            ].map((s) => (
              <div key={s.label} className="relative rounded-xl px-4 py-3 overflow-hidden flex flex-col justify-center"
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
        </div>
      </div>
    </div>
  );
}
