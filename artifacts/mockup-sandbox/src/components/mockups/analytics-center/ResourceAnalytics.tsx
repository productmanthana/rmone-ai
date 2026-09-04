import "./_group.css";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from "recharts";

const weeklyHours = [
  { wk: "W36", alloc: 19800, cap: 22400 }, { wk: "W37", alloc: 20150, cap: 22400 },
  { wk: "W38", alloc: 20900, cap: 22600 }, { wk: "W39", alloc: 21200, cap: 22600 },
  { wk: "W40", alloc: 20650, cap: 22600 }, { wk: "W41", alloc: 21480, cap: 22800 },
  { wk: "W42", alloc: 21910, cap: 22800 }, { wk: "W43", alloc: 21340, cap: 22800 },
  { wk: "W44", alloc: 20780, cap: 23000 }, { wk: "W45", alloc: 21620, cap: 23000 },
  { wk: "W46", alloc: 22040, cap: 23000 }, { wk: "W47", alloc: 21870, cap: 23000 },
];

const phaseHours = [
  { phase: "Construction", hrs: 412500 }, { phase: "Design", hrs: 268400 },
  { phase: "CM Services", hrs: 187200 }, { phase: "Pre-Construction", hrs: 96800 },
  { phase: "Closeout", hrs: 61300 }, { phase: "Proposal", hrs: 38900 },
];

const topRoles = [
  { role: "Project Manager", hrs: 148200, pct: 92 },
  { role: "Resident Engineer", hrs: 121600, pct: 88 },
  { role: "Field Inspector", hrs: 117900, pct: 95 },
  { role: "Sr. Structural Engineer", hrs: 84400, pct: 81 },
  { role: "Scheduler", hrs: 52300, pct: 76 },
  { role: "Estimator", hrs: 41800, pct: 69 },
];

const topPeople = [
  { name: "M. Delgado", role: "Resident Engineer", hrs: 2184, projects: 3 },
  { name: "S. Okafor", role: "Project Manager", hrs: 2126, projects: 4 },
  { name: "J. Castellano", role: "Field Inspector", hrs: 2098, projects: 2 },
  { name: "A. Lindqvist", role: "Sr. Structural Eng.", hrs: 2075, projects: 3 },
  { name: "R. Nakamura", role: "Scheduler", hrs: 2041, projects: 5 },
  { name: "T. Boyle", role: "Project Manager", hrs: 2012, projects: 3 },
];

const conflicts = [
  { name: "K. Marchetti", detail: "142% booked · W46–W48", sev: "high" },
  { name: "D. Whitfield", detail: "128% booked · W45–W47", sev: "high" },
  { name: "L. Serrano", detail: "115% booked · W47", sev: "med" },
  { name: "P. Adeyemi", detail: "111% booked · W46", sev: "med" },
  { name: "C. Han", detail: "106% booked · W48", sev: "low" },
];

const coverageTrend = [78, 80, 81, 83, 82, 84, 85, 87, 86, 87, 88, 87].map((v, i) => ({ i, v }));

const tipStyle = {
  background: "#1B2A36",
  border: "1px solid rgba(107,165,57,0.35)",
  borderRadius: 10,
  color: "var(--rm-text)",
  fontSize: 12,
  boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
};

const maxPhase = phaseHours[0].hrs;

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

function Callout({ label, value, sub, accent = "var(--rm-green-ink)", pct }: { label: string; value: string; sub: string; accent?: string; pct?: number }) {
  return (
    <div className="relative rounded-xl px-4 py-3 overflow-hidden" style={{ background: "rgba(15,25,34,0.5)", border: "1px solid rgba(255,255,255,0.09)" }}>
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: "linear-gradient(180deg, #8EC94A, rgba(107,165,57,0.1))" }} />
      <div className="text-[9px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "rgba(255,255,255,0.55)" }}>{label}</div>
      <div className="text-[26px] font-extrabold tabular-nums leading-tight mt-1" style={{ color: accent, textShadow: "0 0 18px rgba(107,165,57,0.3)" }}>{value}</div>
      {pct !== undefined && (
        <div className="mt-1.5 h-[3px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg, rgba(107,165,57,0.5), #8EC94A)", boxShadow: "0 0 8px rgba(107,165,57,0.6)" }} />
        </div>
      )}
      <div className="text-[10px] mt-1.5" style={{ color: "var(--rm-text-faint)" }}>{sub}</div>
    </div>
  );
}

export default function ResourceAnalytics() {
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
                Analytics Center <span className="mx-1">/</span> <span style={{ color: "var(--rm-green-ink)" }}>Resource Analytics</span>
              </div>
              <h1 className="text-[20px] font-extrabold leading-tight tracking-tight">Resource Mission Control</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-full font-medium" style={{ background: "var(--rm-green-soft)", color: "var(--rm-green-ink)", border: "1px solid rgba(107,165,57,0.4)" }}>Tenant: LiRo</span>
            <span className="px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--rm-panel-border)", color: "var(--rm-text-muted)" }}>Trailing 12 weeks · Sep 2 – Nov 24, 2025</span>
          </div>
        </div>

        {/* HERO: capacity vs demand */}
        <Glass className="overflow-hidden mb-4" style={{ minHeight: 300 }}>
          <div className="absolute rounded-2xl overflow-hidden" style={{ left: 0, right: 0, bottom: 0, height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyHours} margin={{ top: 12, right: 0, bottom: 18, left: 0 }}>
                <defs>
                  <linearGradient id="raHeroFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8EC94A" stopOpacity={0.55} />
                    <stop offset="60%" stopColor="#6BA539" stopOpacity={0.16} />
                    <stop offset="100%" stopColor="#6BA539" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="raHeroStroke" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#38BDF8" />
                    <stop offset="55%" stopColor="#8EC94A" />
                    <stop offset="100%" stopColor="#C4D44A" />
                  </linearGradient>
                </defs>
                <YAxis domain={[18000, 24000]} hide />
                <Tooltip contentStyle={tipStyle} formatter={(v: number, n: string) => [v.toLocaleString() + " hrs", n]} labelStyle={{ color: "rgba(255,255,255,0.6)" }} />
                <Area dataKey="cap" name="Capacity" type="monotone" stroke="#6B99BB" strokeDasharray="5 5" strokeWidth={1.8} fill="none" dot={false} isAnimationActive={false} />
                <Area dataKey="alloc" name="Allocated" type="monotone" stroke="url(#raHeroStroke)" strokeWidth={3} fill="url(#raHeroFill)" dot={false}
                  style={{ filter: "drop-shadow(0 0 8px rgba(142,201,74,0.65))" }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="relative px-6 pt-5 pb-4 flex flex-col" style={{ minHeight: 300 }}>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.18em", color: "var(--rm-green-ink)" }}>Team Hours: Booked vs Available</span>
              <DeltaChip text="+9 pts coverage / 12 wk" />
            </div>
            <div className="flex items-baseline gap-4 mt-1">
              <span className="font-extrabold tabular-nums leading-none" style={{
                fontSize: 68, letterSpacing: "-0.03em",
                background: "linear-gradient(180deg, #FFFFFF 30%, #A8D672 100%)",
                WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
                filter: "drop-shadow(0 0 28px rgba(107,165,57,0.35))",
              }}>87.2%</span>
              <div className="text-[11px] leading-snug" style={{ color: "var(--rm-text-muted)" }}>
                of contracted hours are staffed with a named person<br />
                1.08M of 1.24M contracted hrs · solid line = booked, dashed line = available capacity
              </div>
            </div>
            <div className="text-[11px] mt-2 font-medium" style={{ color: "rgba(255,255,255,0.75)" }}>
              Plain English: for every 10 hours we sold, about 8.7 already have someone assigned. Target is 9 in 10 (90%).
            </div>
            <div className="mt-auto flex items-end justify-between text-[10px] tabular-nums" style={{ color: "rgba(255,255,255,0.45)" }}>
              {weeklyHours.map((d) => <span key={d.wk}>{d.wk}</span>)}
            </div>
          </div>
        </Glass>

        {/* Callout band */}
        <div className="grid grid-cols-5 gap-4 mb-4">
          <Callout label="Staffing Coverage" value="87.2%" sub="1.08M of 1.24M contracted hrs have a person" pct={87} />
          <Callout label="Hours Planned (12 mo)" value="1.08M" sub="$84.2M of planned labor" accent="#fff" pct={87} />
          <Callout label="Typical Week" value="21.2K" sub="hrs booked per week · last 12 weeks" accent="#fff" pct={92} />
          <Callout label="People With Work" value="514" sub="of 561 active staff have assignments" accent="#fff" pct={91.6} />
          <Callout label="Double-Bookings" value="17" sub="people booked past 100% · 5 over 110%" accent="var(--rm-ink-orange)" pct={30} />
        </div>

        <div className="grid grid-cols-12 gap-4">
          {/* Hours by phase — ranked list */}
          <Glass className="col-span-4 px-5 py-4">
            <SectionLabel right="TTM allocated">Where the Hours Go</SectionLabel>
            <div className="text-[11px] mb-3" style={{ color: "var(--rm-text-faint)" }}>Booked hours by project phase — most of our time is on active construction.</div>
            <div className="space-y-2.5">
              {phaseHours.map((p, i) => (
                <div key={p.phase}>
                  <div className="flex justify-between items-baseline text-[11px] mb-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold tabular-nums w-3.5 h-3.5 rounded-[4px] flex items-center justify-center"
                        style={{ background: i === 0 ? "var(--rm-green)" : "rgba(255,255,255,0.1)", color: i === 0 ? "#16240a" : "rgba(255,255,255,0.6)" }}>{i + 1}</span>
                      <span style={{ color: "var(--rm-text-muted)" }}>{p.phase}</span>
                    </span>
                    <span className="font-bold tabular-nums">{(p.hrs / 1000).toFixed(1)}K hrs</span>
                  </div>
                  <div className="h-[6px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div className="h-full rounded-full" style={{
                      width: `${(p.hrs / maxPhase) * 100}%`,
                      background: "linear-gradient(90deg, rgba(107,165,57,0.45), #8EC94A)",
                      boxShadow: "0 0 8px rgba(107,165,57,0.55)",
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </Glass>

          {/* Top roles */}
          <Glass className="col-span-4 px-5 py-4">
            <SectionLabel right="hrs · coverage %">Busiest Roles</SectionLabel>
            <div className="text-[11px] mb-3" style={{ color: "var(--rm-text-faint)" }}>How fully each role is staffed against contracted demand.</div>
            <div className="space-y-2.5">
              {topRoles.map((r) => (
                <div key={r.role}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span style={{ color: "var(--rm-text-muted)" }}>{r.role}</span>
                    <span className="tabular-nums font-bold">{(r.hrs / 1000).toFixed(1)}K <span className="font-medium" style={{ color: "var(--rm-text-faint)" }}>· {r.pct}%</span></span>
                  </div>
                  <div className="h-[6px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div className="h-full rounded-full" style={{
                      width: `${r.pct}%`,
                      background: r.pct >= 90 ? "linear-gradient(90deg, rgba(132,204,22,0.5), #84cc16)" : r.pct >= 75 ? "linear-gradient(90deg, rgba(107,165,57,0.45), #8EC94A)" : "linear-gradient(90deg, rgba(251,146,60,0.4), #FB923C)",
                      boxShadow: "0 0 8px rgba(107,165,57,0.45)",
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </Glass>

          {/* Top people + conflicts */}
          <div className="col-span-4 flex flex-col gap-4">
            <Glass className="px-5 py-4">
              <SectionLabel right="TTM hrs">Most Booked People</SectionLabel>
              <div className="space-y-1.5">
                {topPeople.map((p, i) => (
                  <div key={p.name} className="flex items-center justify-between text-[11.5px] rounded-lg px-2.5 py-1.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <span className="flex items-center gap-2">
                      <span className="text-[9px] font-bold tabular-nums w-3.5 h-3.5 rounded-[4px] flex items-center justify-center"
                        style={{ background: i === 0 ? "var(--rm-green)" : "rgba(255,255,255,0.1)", color: i === 0 ? "#16240a" : "rgba(255,255,255,0.6)" }}>{i + 1}</span>
                      <span className="font-medium">{p.name}</span>
                      <span style={{ color: "var(--rm-text-faint)" }}>{p.role}</span>
                    </span>
                    <span className="tabular-nums"><span className="font-bold" style={{ color: "var(--rm-green-ink)" }}>{p.hrs.toLocaleString()}</span><span style={{ color: "var(--rm-text-faint)" }}> hrs · {p.projects} proj</span></span>
                  </div>
                ))}
              </div>
            </Glass>
            <Glass className="px-5 py-4">
              <SectionLabel right="17 total · top 5">Double-Booked People</SectionLabel>
              <div className="text-[11px] mb-2" style={{ color: "var(--rm-text-faint)" }}>Booked for more hours than they have — needs rebalancing.</div>
              <div className="space-y-1.5">
                {conflicts.map((c) => (
                  <div key={c.name} className="flex items-center justify-between text-[11.5px] rounded-lg px-2.5 py-1.5" style={{ background: "rgba(15,25,34,0.5)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <span className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full" style={{
                        background: c.sev === "high" ? "var(--rm-health-bad)" : c.sev === "med" ? "var(--rm-health-warn)" : "rgba(255,255,255,0.4)",
                        boxShadow: c.sev === "high" ? "0 0 6px rgba(248,113,113,0.9)" : undefined,
                      }} />
                      <span className="font-medium">{c.name}</span>
                    </span>
                    <span className="tabular-nums" style={{ color: c.sev === "high" ? "var(--rm-health-bad)" : c.sev === "med" ? "var(--rm-health-warn)" : "var(--rm-text-muted)" }}>{c.detail}</span>
                  </div>
                ))}
              </div>
            </Glass>
          </div>
        </div>

        {/* coverage trend micro-strip keeps the data without a chart */}
        <div className="mt-4 rounded-xl overflow-hidden flex items-center" style={{ background: "rgba(15,25,34,0.55)", border: "1px solid rgba(255,255,255,0.09)" }}>
          <div className="px-3 py-1.5 text-[9px] font-bold uppercase shrink-0" style={{ letterSpacing: "0.16em", color: "#16240a", background: "linear-gradient(140deg, #8EC94A, #6BA539)" }}>Coverage Climb</div>
          <div className="flex items-center gap-4 px-4 py-1.5 overflow-hidden whitespace-nowrap text-[11px]">
            <span style={{ color: "var(--rm-text-faint)" }}>% of sold hours staffed, week by week:</span>
            {coverageTrend.map((c, i) => (
              <span key={c.i} className="tabular-nums font-semibold" style={{ color: i === coverageTrend.length - 1 ? "var(--rm-green-ink)" : "rgba(255,255,255,0.7)" }}>{c.v}%</span>
            ))}
            <span style={{ color: "var(--rm-text-faint)" }}>· +9 pts vs 12 weeks ago · target 90%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
