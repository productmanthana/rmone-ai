import "./_group.css";
import {
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip,
  ComposedChart, Line, Area, ReferenceLine,
} from "recharts";

const divisions = [
  { div: "Construction Mgmt", util: 91.4, target: 88, people: 168 },
  { div: "Engineering", util: 86.7, target: 85, people: 124 },
  { div: "Program Mgmt", util: 84.2, target: 85, people: 96 },
  { div: "Architecture", util: 79.8, target: 82, people: 58 },
  { div: "Environmental", util: 76.3, target: 80, people: 47 },
  { div: "Technology Svcs", util: 71.5, target: 78, people: 38 },
  { div: "Corporate / SG&A", util: 42.1, target: 45, people: 30 },
];

const monthly = [
  { m: "Dec", actual: 80.1, target: 84 }, { m: "Jan", actual: 79.4, target: 84 },
  { m: "Feb", actual: 81.2, target: 84 }, { m: "Mar", actual: 82.6, target: 84 },
  { m: "Apr", actual: 83.1, target: 84 }, { m: "May", actual: 84.0, target: 84 },
  { m: "Jun", actual: 84.8, target: 84 }, { m: "Jul", actual: 83.9, target: 84 },
  { m: "Aug", actual: 84.5, target: 84 }, { m: "Sep", actual: 85.2, target: 84 },
  { m: "Oct", actual: 85.9, target: 84 }, { m: "Nov", actual: 85.3, target: 84 },
];

const bands = [
  { band: "Over 110% — over-allocated", count: 17, color: "var(--rm-health-bad)", pct: 3.0 },
  { band: "100–110% — fully booked", count: 74, color: "var(--rm-ink-orange)", pct: 13.2 },
  { band: "85–100% — in target band", count: 293, color: "var(--rm-health-good)", pct: 52.2 },
  { band: "60–85% — below target", count: 130, color: "var(--rm-brand-lime)", pct: 23.2 },
  { band: "Under 60% — under-allocated", count: 47, color: "var(--rm-accent-blue)", pct: 8.4 },
];

const heatList = [
  { name: "K. Marchetti", div: "Construction Mgmt", util: 142, weeks: "W46–W48" },
  { name: "D. Whitfield", div: "Engineering", util: 128, weeks: "W45–W47" },
  { name: "L. Serrano", div: "Construction Mgmt", util: 115, weeks: "W47" },
  { name: "P. Adeyemi", div: "Program Mgmt", util: 111, weeks: "W46" },
  { name: "V. Kowalski", div: "Environmental", util: 38, weeks: "8 wks running" },
  { name: "N. Fontaine", div: "Technology Svcs", util: 34, weeks: "6 wks running" },
  { name: "G. Ramachandran", div: "Architecture", util: 29, weeks: "11 wks running" },
];

const tipStyle = {
  background: "#1B2A36",
  border: "1px solid rgba(107,165,57,0.35)",
  borderRadius: 10,
  color: "var(--rm-text)",
  fontSize: 12,
  boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
};

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

/* Big hero gauge with benchmark band arcs */
function BenchmarkGauge() {
  const size = 300;
  const cx = size / 2, cy = size / 2;
  const start = 135, sweep = 270;
  const toAng = (pctVal: number) => ((start + (sweep * pctVal) / 100) * Math.PI) / 180;
  const arc = (r: number, fromPct: number, toPct: number) => {
    const a0 = toAng(fromPct), a1 = toAng(toPct);
    const large = ((toPct - fromPct) * sweep) / 100 > 180 ? 1 : 0;
    return `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`;
  };
  const rMain = 118, rBench = 100, rTech = 86;
  const val = 85.3;
  const tip = toAng(val);
  return (
    <svg width={size} height={size} style={{ overflow: "visible" }}>
      {/* main track */}
      <path d={arc(rMain, 0, 100)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={12} strokeLinecap="round" />
      {/* value arc */}
      <path d={arc(rMain, 0, val)} fill="none" stroke="#8EC94A" strokeWidth={12} strokeLinecap="round"
        style={{ filter: "drop-shadow(0 0 10px rgba(142,201,74,0.7))" }} />
      <circle cx={cx + rMain * Math.cos(tip)} cy={cy + rMain * Math.sin(tip)} r={7} fill="#fff" style={{ filter: "drop-shadow(0 0 8px rgba(255,255,255,0.9))" }} />
      {/* benchmark band: all-staff 60-65 + median 61 */}
      <path d={arc(rBench, 0, 100)} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={7} strokeLinecap="round" />
      <path d={arc(rBench, 60, 65)} fill="none" stroke="#38BDF8" strokeWidth={7} strokeLinecap="round" style={{ filter: "drop-shadow(0 0 6px rgba(56,189,248,0.6))" }} />
      <circle cx={cx + rBench * Math.cos(toAng(61))} cy={cy + rBench * Math.sin(toAng(61))} r={4.5} fill="#38BDF8" style={{ filter: "drop-shadow(0 0 6px rgba(56,189,248,0.9))" }} />
      {/* technical band 75-90 */}
      <path d={arc(rTech, 0, 100)} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={7} strokeLinecap="round" />
      <path d={arc(rTech, 75, 90)} fill="none" stroke="#C4D44A" strokeWidth={7} strokeLinecap="round" style={{ filter: "drop-shadow(0 0 6px rgba(196,212,74,0.5))" }} />
      {/* center */}
      <text x={cx} y={cy - 14} textAnchor="middle" fontSize={52} fontWeight={800} fill="#fff" style={{ fontVariantNumeric: "tabular-nums", filter: "drop-shadow(0 0 20px rgba(107,165,57,0.5))" }}>85.3%</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize={10} fill="rgba(255,255,255,0.6)" style={{ letterSpacing: "0.14em", textTransform: "uppercase" }}>Company Utilization</text>
      <text x={cx} y={cy + 26} textAnchor="middle" fontSize={9.5} fill="rgba(255,255,255,0.45)">planned basis · target 84%</text>
    </svg>
  );
}

export default function UtilizationAnalytics() {
  const maxUtil = 100;
  return (
    <div className="rmone-analytics min-h-screen relative overflow-hidden" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
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
                Analytics Center <span className="mx-1">/</span> <span style={{ color: "var(--rm-green-ink)" }}>Utilization Analytics</span>
              </div>
              <h1 className="text-[20px] font-extrabold leading-tight tracking-tight">Utilization Mission Control</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-full font-medium" style={{ background: "var(--rm-green-soft)", color: "var(--rm-green-ink)", border: "1px solid rgba(107,165,57,0.4)" }}>Tenant: LiRo</span>
            <span className="px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--rm-panel-border)", color: "var(--rm-text-muted)" }}>Trailing 12 months · Dec 2024 – Nov 2025</span>
          </div>
        </div>

        {/* HERO: gauge + benchmarks + trend */}
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Glass className="col-span-5 px-6 py-4 flex flex-col items-center">
            <div className="w-full"><SectionLabel right="vs industry benchmarks">The One Number</SectionLabel></div>
            <BenchmarkGauge />
            <div className="w-full space-y-1.5 mt-1">
              <div className="flex items-center justify-between text-[10.5px]">
                <span className="flex items-center gap-1.5" style={{ color: "var(--rm-text-muted)" }}>
                  <span className="w-2.5 h-1 rounded-full inline-block" style={{ background: "#8EC94A", boxShadow: "0 0 6px rgba(142,201,74,0.7)" }} />LiRo — all staff, planned utilization
                </span>
                <span className="font-bold tabular-nums">85.3%</span>
              </div>
              <div className="flex items-center justify-between text-[10.5px]">
                <span className="flex items-center gap-1.5" style={{ color: "var(--rm-text-muted)" }}>
                  <span className="w-2.5 h-1 rounded-full inline-block" style={{ background: "#38BDF8", boxShadow: "0 0 6px rgba(56,189,248,0.6)" }} />A&amp;E industry — all-staff typical band (median ~61%)
                </span>
                <span className="font-bold tabular-nums">60–65%</span>
              </div>
              <div className="flex items-center justify-between text-[10.5px]">
                <span className="flex items-center gap-1.5" style={{ color: "var(--rm-text-muted)" }}>
                  <span className="w-2.5 h-1 rounded-full inline-block" style={{ background: "#C4D44A", boxShadow: "0 0 6px rgba(196,212,74,0.5)" }} />A&amp;E industry — technical / billable staff band
                </span>
                <span className="font-bold tabular-nums">75–90%</span>
              </div>
            </div>
            <div className="text-[11px] mt-3 pt-2 w-full font-medium" style={{ color: "rgba(255,255,255,0.75)", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              Plain English: our people spend 85% of their time on planned project work — well above the industry all-staff median (~61%) and inside the healthy 75–90% band for technical firms.
            </div>
          </Glass>

          <div className="col-span-7 flex flex-col gap-4">
            <Glass className="px-5 py-4 flex-1 flex flex-col">
              <SectionLabel right="actual vs 84% target · monthly">12-Month Climb</SectionLabel>
              <div className="flex-1 min-h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="uaHero" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8EC94A" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#6BA539" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="m" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[74, 90]} tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                    <Tooltip contentStyle={tipStyle} formatter={(v: number) => v + "%"} />
                    <ReferenceLine y={84} stroke="#F0A842" strokeDasharray="5 4" label={{ value: "target 84%", fill: "#F0A842", fontSize: 10, position: "insideTopRight" }} />
                    <Area type="monotone" dataKey="actual" name="Actual" stroke="#8EC94A" strokeWidth={2.5} fill="url(#uaHero)"
                      style={{ filter: "drop-shadow(0 0 6px rgba(142,201,74,0.55))" }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="actual" stroke="#8EC94A" strokeWidth={0} dot={{ r: 2.5, fill: "#8EC94A" }} legendType="none" isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="text-[11px] mt-1" style={{ color: "var(--rm-text-faint)" }}>Up from 80.1% last December — above target for six of the last seven months.</div>
            </Glass>

            {/* Stat callouts */}
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: "In the Sweet Spot", value: "293", sub: "52.2% of 561 staff at 85–100%", accent: "var(--rm-green-ink)", pct: 52.2 },
                { label: "Overloaded (>110%)", value: "17", sub: "3.0% of staff · needs rebalancing", accent: "var(--rm-health-bad)", pct: 12 },
                { label: "Under-Used (<60%)", value: "47", sub: "8.4% of staff · redeploy watch", accent: "var(--rm-accent-blue)", pct: 20 },
                { label: "Divisions Above Target", value: "3 of 7", sub: "Construction Mgmt leads at 91.4%", accent: "#fff", pct: 43 },
              ].map((s) => (
                <div key={s.label} className="relative rounded-xl px-3.5 py-3 overflow-hidden" style={{ background: "rgba(15,25,34,0.5)", border: "1px solid rgba(255,255,255,0.09)" }}>
                  <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: "linear-gradient(180deg, #8EC94A, rgba(107,165,57,0.1))" }} />
                  <div className="text-[9px] font-bold uppercase" style={{ letterSpacing: "0.12em", color: "rgba(255,255,255,0.55)" }}>{s.label}</div>
                  <div className="text-[24px] font-extrabold tabular-nums leading-tight mt-0.5" style={{ color: s.accent, textShadow: "0 0 16px rgba(107,165,57,0.25)" }}>{s.value}</div>
                  <div className="mt-1.5 h-[3px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                    <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: "linear-gradient(90deg, rgba(107,165,57,0.5), #8EC94A)", boxShadow: "0 0 8px rgba(107,165,57,0.6)" }} />
                  </div>
                  <div className="text-[9.5px] mt-1" style={{ color: "var(--rm-text-faint)" }}>{s.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          {/* Bands as segmented strip + list */}
          <Glass className="col-span-4 px-5 py-4">
            <SectionLabel right="561 staff">How Busy Is Everyone</SectionLabel>
            <div className="flex h-[14px] rounded-full overflow-hidden mb-3" style={{ background: "rgba(255,255,255,0.06)" }}>
              {bands.map((b) => (
                <div key={b.band} style={{ width: `${b.pct}%`, background: b.color, minWidth: 6 }} />
              ))}
            </div>
            <div className="space-y-2.5">
              {bands.map((b) => (
                <div key={b.band} className="flex items-center justify-between text-[11.5px]">
                  <span className="flex items-center gap-1.5" style={{ color: "var(--rm-text-muted)" }}>
                    <span className="w-2 h-2 rounded-sm inline-block" style={{ background: b.color }} />{b.band}
                  </span>
                  <span className="font-bold tabular-nums">{b.count} <span className="font-medium" style={{ color: "var(--rm-text-faint)" }}>· {b.pct}%</span></span>
                </div>
              ))}
            </div>
            <div className="text-[10.5px] mt-3 pt-2" style={{ color: "var(--rm-text-faint)", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              "Booked %" = planned hours vs a normal work week. Over 100% means double-booked.
            </div>
          </Glass>

          {/* Division ranked list */}
          <Glass className="col-span-4 px-5 py-4">
            <SectionLabel right="actual vs target">Division Scoreboard</SectionLabel>
            <div className="space-y-2.5">
              {divisions.map((d, i) => {
                const c = d.util >= d.target ? "#8EC94A" : d.util >= d.target - 4 ? "#F0A842" : "#F87171";
                return (
                  <div key={d.div}>
                    <div className="flex justify-between items-baseline text-[11px] mb-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[9px] font-bold tabular-nums w-3.5 h-3.5 rounded-[4px] flex items-center justify-center"
                          style={{ background: i === 0 ? "var(--rm-green)" : "rgba(255,255,255,0.1)", color: i === 0 ? "#16240a" : "rgba(255,255,255,0.6)" }}>{i + 1}</span>
                        <span style={{ color: "var(--rm-text-muted)" }}>{d.div}</span>
                        <span style={{ color: "var(--rm-text-faint)" }}>· {d.people} ppl</span>
                      </span>
                      <span className="font-bold tabular-nums" style={{ color: c }}>{d.util}%<span className="font-medium ml-1" style={{ color: "var(--rm-text-faint)" }}>/ {d.target}%</span></span>
                    </div>
                    <div className="relative h-[6px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                      <div className="h-full rounded-full" style={{ width: `${(d.util / maxUtil) * 100}%`, background: `linear-gradient(90deg, ${c}55, ${c})`, boxShadow: `0 0 8px ${c}77` }} />
                      <div className="absolute top-[-2px] bottom-[-2px] w-[2px] rounded" style={{ left: `${d.target}%`, background: "rgba(255,255,255,0.6)" }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-3 text-[10px] mt-3" style={{ color: "var(--rm-text-faint)" }}>
              <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "#8EC94A" }} />at/above target</span>
              <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "#F0A842" }} />within 4 pts</span>
              <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "#F87171" }} />below target</span>
            </div>
          </Glass>

          {/* Heat list */}
          <Glass className="col-span-4 px-5 py-4">
            <SectionLabel right="over- & under-allocated">People To Watch</SectionLabel>
            <div className="space-y-1.5">
              {heatList.map((p) => {
                const over = p.util > 100;
                const c = over ? "var(--rm-health-bad)" : "var(--rm-accent-blue)";
                return (
                  <div key={p.name} className="flex items-center justify-between text-[11.5px] rounded-lg px-2.5 py-1.5" style={{ background: "rgba(15,25,34,0.5)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <span className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${over ? "rgba(248,113,113,0.9)" : "rgba(56,189,248,0.8)"}` }} />
                      <span className="font-medium">{p.name}</span>
                      <span style={{ color: "var(--rm-text-faint)" }}>{p.div}</span>
                    </span>
                    <span className="tabular-nums"><span className="font-bold" style={{ color: c }}>{p.util}%</span><span style={{ color: "var(--rm-text-faint)" }}> · {p.weeks}</span></span>
                  </div>
                );
              })}
            </div>
            <div className="text-[10.5px] mt-3 pt-2" style={{ color: "var(--rm-text-faint)", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              Utilization is planned (allocations ÷ capacity) — no timesheet actuals.
            </div>
          </Glass>
        </div>
      </div>
    </div>
  );
}
