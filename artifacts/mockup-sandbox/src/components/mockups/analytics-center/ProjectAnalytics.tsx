import "./_group.css";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  AreaChart, Area,
} from "recharts";

const byStatus = [
  { s: "Pursuit", n: 68, c: "var(--rm-accent-blue)" },
  { s: "Awarded", n: 31, c: "var(--rm-brand-lime)" },
  { s: "Active", n: 214, c: "var(--rm-green)" },
  { s: "On Hold", n: 23, c: "var(--rm-ink-orange)" },
  { s: "Closing", n: 17, c: "var(--rm-ink-violet)" },
  { s: "Closed 12mo", n: 96, c: "rgba(255,255,255,0.35)" },
];
const bySectorFixed = [
  { sector: "Transportation", n: 71 },
  { sector: "Education", n: 48 },
  { sector: "Healthcare", n: 34 },
  { sector: "Water / Wastewater", n: 29 },
  { sector: "Public Buildings", n: 26 },
  { sector: "Energy & Utilities", n: 18 },
  { sector: "Housing", n: 14 },
  { sector: "Aviation", n: 9 },
];
const byDivision = [
  { div: "Construction Mgmt", n: 62 },
  { div: "Engineering", n: 47 },
  { div: "Program Mgmt", n: 38 },
  { div: "Environmental", n: 27 },
  { div: "Architecture", n: 21 },
  { div: "Technology", n: 12 },
  { div: "Surveying", n: 7 },
];
const cycleTime = [
  { m: "Sep", d: 412 }, { m: "Oct", d: 398 }, { m: "Nov", d: 405 },
  { m: "Dec", d: 387 }, { m: "Jan", d: 371 }, { m: "Feb", d: 364 },
];
const scheduleHealth = [
  { label: "On Schedule", n: 171, pct: 79.9, c: "var(--rm-health-good)" },
  { label: "At Risk", n: 31, pct: 14.5, c: "var(--rm-health-warn)" },
  { label: "Behind", n: 12, pct: 5.6, c: "var(--rm-health-bad)" },
];
const overdue = [
  { name: "MTA Penn Station Access — Phase 2 CM", div: "Construction Mgmt", pm: "R. Delgado", days: 47, milestone: "Substantial Completion" },
  { name: "SCA PS 118 Queens Modernization", div: "Program Mgmt", pm: "K. Whitfield", days: 33, milestone: "Design Review Signoff" },
  { name: "NYCDEP Newtown Creek Digester Upgrade", div: "Engineering", pm: "A. Osei", days: 28, milestone: "60% Submittal" },
  { name: "Port Authority T4 Roadway Improvements", div: "Construction Mgmt", pm: "M. Caruso", days: 21, milestone: "Punch List Close-out" },
  { name: "SUNY Stony Brook Lab Renovation", div: "Architecture", pm: "J. Lindqvist", days: 17, milestone: "CD Package Issue" },
  { name: "LIRR Jamaica Capacity Improvements", div: "Program Mgmt", pm: "T. Nakamura", days: 12, milestone: "Schedule Rebaseline" },
  { name: "OGS Albany Campus Utilities Study", div: "Engineering", pm: "S. Boateng", days: 8, milestone: "Draft Report" },
];

const tipStyle = {
  background: "#1B2A36",
  border: "1px solid rgba(107,165,57,0.35)",
  borderRadius: 10,
  color: "var(--rm-text)",
  fontSize: 12,
  boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
};

/* ---------- Mission Control primitives ---------- */

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

/* Large schedule-health arc gauge (hero device for this page) */
function HeroGauge({ pct, value, sub, size = 190 }: { pct: number; value: string; sub: string; size?: number }) {
  const r = size / 2 - 16;
  const cx = size / 2, cy = size / 2;
  const start = 135, sweep = 270;
  const a = ((start + (sweep * pct) / 100) * Math.PI) / 180;
  const a0 = (start * Math.PI) / 180;
  const a1 = ((start + sweep) * Math.PI) / 180;
  const pt = (ang: number) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  const [sx, sy] = pt(a0); const [ex, ey] = pt(a1); const [tx, ty] = pt(a);
  const largeVal = (sweep * pct) / 100 > 180 ? 1 : 0;
  return (
    <svg width={size} height={size} style={{ overflow: "visible" }}>
      <path d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={12} strokeLinecap="round" />
      <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${largeVal} 1 ${tx} ${ty}`} fill="none" stroke="var(--rm-health-good)" strokeWidth={12} strokeLinecap="round"
        style={{ filter: "drop-shadow(0 0 10px rgba(132,204,22,0.65))" }} />
      <circle cx={tx} cy={ty} r={6} fill="#fff" style={{ filter: "drop-shadow(0 0 7px rgba(255,255,255,0.9))" }} />
      <text x={cx} y={cy - 4} textAnchor="middle" fill="#fff" fontSize={38} fontWeight={800} style={{ fontVariantNumeric: "tabular-nums" }}>{value}</text>
      <text x={cx} y={cy + 20} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize={10} style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}>{sub}</text>
    </svg>
  );
}

const thStyle: React.CSSProperties = { fontWeight: 600, fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.5)", paddingBottom: 8 };

export default function ProjectAnalytics() {
  const maxDiv = 62;
  const maxStatus = 214;
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
                Analytics Center <span className="mx-1">/</span> <span style={{ color: "var(--rm-green-ink)" }}>Project Analytics</span>
              </div>
              <h1 className="text-[20px] font-extrabold leading-tight tracking-tight">Project Portfolio Health</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-full font-medium" style={{ background: "var(--rm-green-soft)", color: "var(--rm-green-ink)", border: "1px solid rgba(107,165,57,0.4)" }}>Tenant: LiRo</span>
            <span className="px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--rm-panel-border)", color: "var(--rm-text-muted)" }}>Fiscal YTD · Jul 1, 2024 – Feb 28, 2025</span>
          </div>
        </div>

        {/* HERO: schedule health gauge + plain-English + status breakdown */}
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Glass className="px-6 py-5 flex items-center gap-8" style={{ gridColumn: "span 7 / span 7" }}>
            <div className="flex flex-col items-center shrink-0">
              <HeroGauge pct={79.9} value="79.9%" sub="on schedule" />
              <div className="text-[10px] font-semibold uppercase mt-1" style={{ letterSpacing: "0.12em", color: "rgba(255,255,255,0.7)" }}>Schedule Health</div>
            </div>
            <div className="flex-1">
              <div className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.18em", color: "var(--rm-green-ink)" }}>Plain English</div>
              <div className="text-[17px] font-semibold leading-snug mt-1" style={{ color: "rgba(255,255,255,0.92)" }}>
                171 of our 214 active projects are running on time. 31 need watching, and 12 are behind — mostly in Program Mgmt.
              </div>
              <div className="space-y-2.5 mt-4">
                {scheduleHealth.map((h) => (
                  <div key={h.label}>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span style={{ color: "var(--rm-text-muted)" }}>{h.label}</span>
                      <span className="font-bold tabular-nums">{h.n} · {h.pct}%</span>
                    </div>
                    <div className="h-[6px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                      <div className="h-full rounded-full" style={{ width: `${h.pct}%`, background: h.c, boxShadow: `0 0 8px ${h.label === "On Schedule" ? "rgba(132,204,22,0.6)" : h.label === "At Risk" ? "rgba(251,146,60,0.55)" : "rgba(248,113,113,0.55)"}` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-[10.5px] mt-3" style={{ color: "var(--rm-text-faint)" }}>
                At-risk count down from 38 last month. Behind-schedule projects concentrated in Program Mgmt (7).
              </div>
            </div>
          </Glass>

          {/* Status as ranked list with inline bars */}
          <Glass className="px-5 py-4" style={{ gridColumn: "span 5 / span 5" }}>
            <SectionLabel right="449 records">Projects by Status / Stage</SectionLabel>
            <div className="space-y-[9px] mt-1">
              {byStatus.map((d) => (
                <div key={d.s}>
                  <div className="flex justify-between items-baseline text-[11px] mb-[3px]">
                    <span className="flex items-center gap-1.5" style={{ color: "var(--rm-text-muted)" }}>
                      <span className="w-2 h-2 rounded-sm inline-block" style={{ background: d.c, boxShadow: "0 0 6px rgba(255,255,255,0.15)" }} />{d.s}
                    </span>
                    <span className="font-bold tabular-nums">{d.n}</span>
                  </div>
                  <div className="h-[6px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div className="h-full rounded-full" style={{ width: `${(d.n / maxStatus) * 100}%`, background: d.c, opacity: 0.9 }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[10.5px] mt-3" style={{ color: "var(--rm-text-faint)" }}>
              "Status" is where a project sits in its life: chasing the work (Pursuit), doing the work (Active), or wrapping up (Closing).
            </div>
          </Glass>
        </div>

        {/* KPI ticker strip */}
        <div className="mb-4 rounded-xl overflow-hidden flex items-center" style={{ background: "rgba(15,25,34,0.55)", border: "1px solid rgba(255,255,255,0.09)" }}>
          <div className="px-3 py-1.5 text-[9px] font-bold uppercase shrink-0" style={{ letterSpacing: "0.16em", color: "#16240a", background: "linear-gradient(140deg, #8EC94A, #6BA539)" }}>Portfolio Pulse</div>
          <div className="flex items-center gap-7 px-4 py-1.5 overflow-hidden whitespace-nowrap">
            {[
              { l: "Total Records", v: "449", s: "all statuses" },
              { l: "Active Projects", v: "214", s: "+9 QoQ" },
              { l: "Avg Cycle Time", v: "364 days", s: "created to closed · -48d YoY" },
              { l: "On Schedule", v: "79.9%", s: "171 of 214 active" },
              { l: "Overdue Milestones", v: "12", s: "7 in Program Mgmt" },
            ].map((k) => (
              <span key={k.l} className="flex items-center gap-1.5 text-[11px] shrink-0">
                <span style={{ color: "var(--rm-text-faint)" }}>{k.l}</span>
                <span className="font-bold tabular-nums" style={{ color: "#fff" }}>{k.v}</span>
                <span style={{ color: "var(--rm-text-faint)", fontSize: 10 }}>{k.s}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Charts row: sector bars + cycle time trend + division ranked list */}
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Glass className="px-5 py-4 flex flex-col" style={{ gridColumn: "span 4 / span 4" }}>
            <SectionLabel right="top 8 sectors · active only">Where the Work Is — By Sector</SectionLabel>
            <div className="flex-1 min-h-[210px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bySectorFixed} layout="vertical" margin={{ top: 0, right: 26, bottom: 0, left: 4 }}>
                  <defs>
                    <linearGradient id="sectorBar" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="rgba(56,189,248,0.5)" />
                      <stop offset="100%" stopColor="#38BDF8" />
                    </linearGradient>
                  </defs>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="sector" width={112} tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
                  <Bar dataKey="n" fill="url(#sectorBar)" radius={[0, 4, 4, 0]} barSize={11} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Glass>

          <Glass className="px-5 py-4 flex flex-col" style={{ gridColumn: "span 4 / span 4" }}>
            <SectionLabel right="avg days, created to closed">Projects Are Finishing Faster</SectionLabel>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-[30px] font-extrabold tabular-nums leading-none" style={{ color: "var(--rm-green-ink)", textShadow: "0 0 18px rgba(107,165,57,0.35)" }}>364</span>
              <span className="text-[11px]" style={{ color: "var(--rm-text-muted)" }}>days average · down 48 days vs last year</span>
            </div>
            <div className="flex-1 min-h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cycleTime} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="cycleFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#C4D44A" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#C4D44A" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="m" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[340, 430]} tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} formatter={(v: number) => [`${v} days`, "Cycle time"]} />
                  <Area dataKey="d" stroke="var(--rm-brand-lime)" strokeWidth={2.5} fill="url(#cycleFill)"
                    style={{ filter: "drop-shadow(0 0 7px rgba(196,212,74,0.6))" }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Glass>

          <Glass className="px-5 py-4" style={{ gridColumn: "span 4 / span 4" }}>
            <SectionLabel right="active only">Active Projects by Division</SectionLabel>
            <div className="space-y-[9px] mt-1">
              {byDivision.map((d, i) => (
                <div key={d.div}>
                  <div className="flex justify-between items-baseline text-[11px] mb-[3px]">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold tabular-nums w-3.5 h-3.5 rounded-[4px] flex items-center justify-center"
                        style={{ background: i === 0 ? "var(--rm-green)" : "rgba(255,255,255,0.1)", color: i === 0 ? "#16240a" : "rgba(255,255,255,0.6)" }}>{i + 1}</span>
                      <span style={{ color: "var(--rm-text-muted)" }}>{d.div}</span>
                    </span>
                    <span className="font-bold tabular-nums">{d.n}</span>
                  </div>
                  <div className="h-[5px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div className="h-full rounded-full" style={{
                      width: `${(d.n / maxDiv) * 100}%`,
                      background: "linear-gradient(90deg, rgba(107,165,57,0.45), #8EC94A)",
                      boxShadow: "0 0 8px rgba(107,165,57,0.55)",
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </Glass>
        </div>

        {/* Overdue milestones glass table */}
        <Glass className="px-5 py-4">
          <SectionLabel right="7 projects · sorted by days overdue">Overdue Milestones — Needs Attention</SectionLabel>
          <table className="w-full" style={{ fontSize: 11.5, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: "left" }}>Project</th>
                <th style={{ ...thStyle, textAlign: "left" }}>Milestone</th>
                <th style={{ ...thStyle, textAlign: "left" }}>Division</th>
                <th style={{ ...thStyle, textAlign: "left" }}>PM</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Overdue</th>
              </tr>
            </thead>
            <tbody>
              {overdue.map((o) => (
                <tr key={o.name} style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  <td style={{ padding: "7px 10px 7px 0", fontWeight: 600 }}>{o.name}</td>
                  <td style={{ color: "var(--rm-text-muted)", paddingRight: 10 }}>{o.milestone}</td>
                  <td style={{ color: "var(--rm-text-muted)", paddingRight: 10 }}>{o.div}</td>
                  <td style={{ color: "var(--rm-text-muted)", paddingRight: 10 }}>{o.pm}</td>
                  <td style={{ textAlign: "right" }}>
                    <span className="px-2 py-[2px] rounded-md font-bold tabular-nums text-[11px]" style={{
                      background: o.days > 30 ? "rgba(248,113,113,0.16)" : "rgba(251,146,60,0.16)",
                      color: o.days > 30 ? "var(--rm-health-bad)" : "var(--rm-health-warn)",
                      border: o.days > 30 ? "1px solid rgba(248,113,113,0.3)" : "1px solid rgba(251,146,60,0.3)",
                    }}>{o.days}d</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10.5px] mt-2.5" style={{ color: "var(--rm-text-faint)" }}>
            A milestone is a promised delivery date on a project. These seven have slipped past that date and need a recovery plan.
          </div>
        </Glass>
      </div>
    </div>
  );
}
