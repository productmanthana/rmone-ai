import "./_group.css";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

const benchTrend = [
  { m: "Dec", count: 52 }, { m: "Jan", count: 58 }, { m: "Feb", count: 55 },
  { m: "Mar", count: 49 }, { m: "Apr", count: 46 }, { m: "May", count: 44 },
  { m: "Jun", count: 41 }, { m: "Jul", count: 45 }, { m: "Aug", count: 43 },
  { m: "Sep", count: 40 }, { m: "Oct", count: 38 }, { m: "Nov", count: 36 },
];

const benchByRole = [
  { role: "Field Inspector", n: 8 }, { role: "CAD Technician", n: 6 },
  { role: "Project Engineer", n: 5 }, { role: "Estimator", n: 4 },
  { role: "Scheduler", n: 4 }, { role: "Env. Scientist", n: 3 },
  { role: "Admin / Support", n: 3 }, { role: "Other", n: 3 },
];

const benchByDiv = [
  { name: "Construction Mgmt", value: 11, fill: "#8EC94A" },
  { name: "Engineering", value: 8, fill: "#6B99BB" },
  { name: "Environmental", value: 6, fill: "#C4D44A" },
  { name: "Architecture", value: 5, fill: "#F0A842" },
  { name: "Program Mgmt", value: 4, fill: "#A78BFA" },
  { name: "Technology Svcs", value: 2, fill: "#38BDF8" },
];

const rolloffs = [
  { name: "E. Vasquez", role: "Resident Engineer", project: "MTA East Side Access CM-014", date: "Dec 5", hrs: 40 },
  { name: "H. Osei", role: "Field Inspector", project: "SCA PS 118 Queens Renovation", date: "Dec 8", hrs: 40 },
  { name: "B. Kowalczyk", role: "Scheduler", project: "LGA Terminal B Roadways", date: "Dec 12", hrs: 32 },
  { name: "M. Tran", role: "Project Engineer", project: "NYCHA Red Hook Houses Phase 2", date: "Dec 15", hrs: 40 },
  { name: "F. Delacroix", role: "Estimator", project: "DDC Coney Island Streetscape", date: "Dec 19", hrs: 24 },
  { name: "S. Iyer", role: "CAD Technician", project: "Gateway Tunnel Support Svcs", date: "Dec 19", hrs: 40 },
];

const candidates = [
  { name: "R. Castellanos", role: "Field Inspector", onBench: "6 wks", match: "SCA PS 118 Queens — Inspector demand W49", fit: 94 },
  { name: "J. Whitmore", role: "Project Engineer", onBench: "4 wks", match: "MTA ESA CM-014 — PE backfill W50", fit: 88 },
  { name: "A. Njoku", role: "Estimator", onBench: "9 wks", match: "DDC Streetscape — bid support W49", fit: 83 },
  { name: "L. Fitzgerald", role: "Scheduler", onBench: "3 wks", match: "LGA Roadways — P6 update cycle", fit: 79 },
  { name: "D. Marino", role: "CAD Technician", onBench: "11 wks", match: "Gateway Tunnel — drawing set W51", fit: 72 },
];

const tipStyle = {
  background: "#1B2A36",
  border: "1px solid rgba(107,165,57,0.35)",
  borderRadius: 10,
  color: "var(--rm-text)",
  fontSize: 12,
  boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
};

const maxRole = benchByRole[0].n;
const totalDiv = 36;

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

/* Bench % gauge */
function BenchGauge() {
  const size = 220;
  const r = size / 2 - 16;
  const cx = size / 2, cy = size / 2;
  const start = 135, sweep = 270;
  const pct = 6.4;
  const gaugePct = Math.min((pct / 15) * 100, 100); // scale: 15% bench = full arc
  const toAng = (p: number) => ((start + (sweep * p) / 100) * Math.PI) / 180;
  const a0 = toAng(0), a1 = toAng(100), av = toAng(gaugePct);
  const pt = (a: number, rad: number) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  const [sx, sy] = pt(a0, r); const [ex, ey] = pt(a1, r); const [tx, ty] = pt(av, r);
  return (
    <svg width={size} height={size} style={{ overflow: "visible" }}>
      <path d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={11} strokeLinecap="round" />
      <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${gaugePct > 66.7 ? 1 : 0} 1 ${tx} ${ty}`} fill="none" stroke="#8EC94A" strokeWidth={11} strokeLinecap="round"
        style={{ filter: "drop-shadow(0 0 8px rgba(142,201,74,0.7))" }} />
      <circle cx={tx} cy={ty} r={6} fill="#fff" style={{ filter: "drop-shadow(0 0 7px rgba(255,255,255,0.9))" }} />
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize={44} fontWeight={800} fill="#fff" style={{ fontVariantNumeric: "tabular-nums", filter: "drop-shadow(0 0 18px rgba(107,165,57,0.5))" }}>6.4%</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize={10} fill="rgba(255,255,255,0.6)" style={{ letterSpacing: "0.14em", textTransform: "uppercase" }}>Of Staff On Bench</text>
      <text x={cx} y={cy + 30} textAnchor="middle" fontSize={9.5} fill="rgba(255,255,255,0.45)">36 of 561 active staff</text>
    </svg>
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

export default function BenchAnalytics() {
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
                Analytics Center <span className="mx-1">/</span> <span style={{ color: "var(--rm-green-ink)" }}>Bench Analytics</span>
              </div>
              <h1 className="text-[20px] font-extrabold leading-tight tracking-tight">Bench Mission Control</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-full font-medium" style={{ background: "var(--rm-green-soft)", color: "var(--rm-green-ink)", border: "1px solid rgba(107,165,57,0.4)" }}>Tenant: LiRo</span>
            <span className="px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--rm-panel-border)", color: "var(--rm-text-muted)" }}>As of Nov 24, 2025 · 12-month trend</span>
          </div>
        </div>

        {/* HERO: gauge + who is free next + trend */}
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Glass className="col-span-4 px-6 py-4 flex flex-col items-center">
            <div className="w-full"><SectionLabel right="fully unallocated">The One Number</SectionLabel></div>
            <BenchGauge />
            <div className="flex items-center gap-2 mt-1">
              <DeltaChip text="-16 people vs Dec 2024" />
              <DeltaChip text="down from 52" />
            </div>
            <div className="text-[11px] mt-3 pt-2 w-full font-medium" style={{ color: "rgba(255,255,255,0.75)", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              Plain English: 36 people have no project work right now — the fewest in a year. Avg wait on the bench is 5.8 weeks (median 4.0, max 14).
            </div>
          </Glass>

          <Glass className="col-span-8 px-5 py-4 flex flex-col">
            <SectionLabel right="bench people matched to open demand · 14 matches at fit ≥70%">Who Is Free Next — Best Redeployment Matches</SectionLabel>
            <div className="space-y-2 flex-1">
              {candidates.map((c, i) => (
                <div key={c.name} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: "rgba(15,25,34,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <span className="text-[9px] font-bold tabular-nums w-4 h-4 rounded-[5px] flex items-center justify-center shrink-0"
                    style={{ background: i === 0 ? "var(--rm-green)" : "rgba(255,255,255,0.1)", color: i === 0 ? "#16240a" : "rgba(255,255,255,0.6)" }}>{i + 1}</span>
                  <div className="w-[176px] shrink-0">
                    <div className="text-[12px] font-semibold">{c.name}</div>
                    <div className="text-[10.5px]" style={{ color: "var(--rm-text-faint)" }}>{c.role} · free for {c.onBench}</div>
                  </div>
                  <div className="flex-1 text-[11.5px]" style={{ color: "var(--rm-text-muted)" }}>{c.match}</div>
                  <div className="w-[110px] shrink-0">
                    <div className="flex justify-between text-[10px] mb-1">
                      <span style={{ color: "var(--rm-text-faint)" }}>match fit</span>
                      <span className="tabular-nums font-bold" style={{ color: c.fit >= 85 ? "var(--rm-green-ink)" : "#fff" }}>{c.fit}%</span>
                    </div>
                    <div className="h-[5px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                      <div className="h-full rounded-full" style={{
                        width: `${c.fit}%`,
                        background: c.fit >= 85 ? "linear-gradient(90deg, rgba(107,165,57,0.5), #8EC94A)" : "linear-gradient(90deg, rgba(107,153,187,0.5), #6B99BB)",
                        boxShadow: c.fit >= 85 ? "0 0 8px rgba(107,165,57,0.6)" : undefined,
                      }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[10.5px] mt-2" style={{ color: "var(--rm-text-faint)" }}>Fit = role, availability window and past project overlap. 14 total matches at 70%+ — top 5 shown.</div>
          </Glass>
        </div>

        {/* Stat callouts */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          {[
            { label: "Avg Time On Bench", value: "5.8 wks", sub: "median 4.0 wks · max 14 wks", accent: "#fff", pct: 41 },
            { label: "Coming Off Projects Soon", value: "23", sub: "roll-offs in next 4 weeks · 864 hrs/wk returning", accent: "var(--rm-ink-orange)", pct: 58 },
            { label: "Redeployment Matches", value: "14", sub: "bench-to-demand fit at 70% or better", accent: "var(--rm-green-ink)", pct: 39 },
            { label: "12-Month Change", value: "-16", sub: "bench shrank from 52 (Dec 2024) to 36 (Nov 2025)", accent: "var(--rm-health-good)", pct: 69 },
          ].map((s) => (
            <div key={s.label} className="relative rounded-xl px-4 py-3 overflow-hidden" style={{ background: "rgba(15,25,34,0.5)", border: "1px solid rgba(255,255,255,0.09)" }}>
              <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: "linear-gradient(180deg, #8EC94A, rgba(107,165,57,0.1))" }} />
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "rgba(255,255,255,0.55)" }}>{s.label}</span>
                <span className="text-[24px] font-extrabold tabular-nums leading-none" style={{ color: s.accent, textShadow: "0 0 18px rgba(107,165,57,0.3)" }}>{s.value}</span>
              </div>
              <div className="mt-2 h-[3px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: "linear-gradient(90deg, rgba(107,165,57,0.5), #8EC94A)", boxShadow: "0 0 8px rgba(107,165,57,0.6)" }} />
              </div>
              <div className="text-[10px] mt-1.5" style={{ color: "var(--rm-text-faint)" }}>{s.sub}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-12 gap-4 mb-4">
          {/* Trend chart — the ONE chart */}
          <Glass className="col-span-6 px-5 py-4 flex flex-col">
            <SectionLabel right="people fully unallocated · monthly">Bench Is Shrinking</SectionLabel>
            <div className="flex-1 min-h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={benchTrend} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                  <defs>
                    <linearGradient id="baHero" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8EC94A" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#6BA539" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="baStroke" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#38BDF8" />
                      <stop offset="55%" stopColor="#8EC94A" />
                      <stop offset="100%" stopColor="#C4D44A" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="m" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[30, 62]} tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} formatter={(v: number) => [v + " people", "On bench"]} />
                  <Area type="monotone" dataKey="count" stroke="url(#baStroke)" strokeWidth={2.5} fill="url(#baHero)"
                    style={{ filter: "drop-shadow(0 0 7px rgba(142,201,74,0.6))" }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[11px] mt-1" style={{ color: "var(--rm-text-faint)" }}>Peak 58 in January → 36 today. Watch December: 23 roll-offs land within 4 weeks.</div>
          </Glass>

          {/* Bench by role — ranked list */}
          <Glass className="col-span-3 px-5 py-4">
            <SectionLabel right="36 people">Bench by Role</SectionLabel>
            <div className="space-y-2.5">
              {benchByRole.map((r, i) => (
                <div key={r.role}>
                  <div className="flex justify-between items-baseline text-[11px] mb-1">
                    <span style={{ color: "var(--rm-text-muted)" }}>{r.role}</span>
                    <span className="font-bold tabular-nums">{r.n}</span>
                  </div>
                  <div className="h-[5px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div className="h-full rounded-full" style={{
                      width: `${(r.n / maxRole) * 100}%`,
                      background: i < 2 ? "linear-gradient(90deg, rgba(240,168,66,0.5), #F0A842)" : "linear-gradient(90deg, rgba(107,153,187,0.5), #6B99BB)",
                      boxShadow: i < 2 ? "0 0 8px rgba(240,168,66,0.5)" : undefined,
                    }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[10px] mt-2.5" style={{ color: "var(--rm-text-faint)" }}>Orange = biggest concentrations.</div>
          </Glass>

          {/* Bench by division — segmented strip */}
          <Glass className="col-span-3 px-5 py-4">
            <SectionLabel right="share of 36">Bench by Division</SectionLabel>
            <div className="flex h-[14px] rounded-full overflow-hidden mb-3" style={{ background: "rgba(255,255,255,0.06)" }}>
              {benchByDiv.map((d) => (
                <div key={d.name} style={{ width: `${(d.value / totalDiv) * 100}%`, background: d.fill, minWidth: 6 }} />
              ))}
            </div>
            <div className="space-y-2">
              {benchByDiv.map((d) => (
                <div key={d.name} className="flex items-center justify-between text-[11.5px]">
                  <span className="flex items-center gap-1.5" style={{ color: "var(--rm-text-muted)" }}>
                    <span className="w-2 h-2 rounded-sm inline-block" style={{ background: d.fill, boxShadow: `0 0 5px ${d.fill}66` }} />{d.name}
                  </span>
                  <span className="font-bold tabular-nums">{d.value}</span>
                </div>
              ))}
            </div>
          </Glass>
        </div>

        {/* Roll-offs */}
        <Glass className="px-5 py-4">
          <SectionLabel right="next 4 weeks · 23 total, first 6 shown">Coming Off Projects Soon</SectionLabel>
          <div className="text-[11px] mb-3" style={{ color: "var(--rm-text-faint)" }}>These people finish their current project soon — line up their next assignment now to keep the bench small.</div>
          <div className="grid grid-cols-3 gap-3">
            {rolloffs.map((r) => (
              <div key={r.name} className="rounded-xl px-3.5 py-2.5" style={{ background: "rgba(15,25,34,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold">{r.name}</span>
                  <span className="text-[11px] font-bold tabular-nums px-1.5 py-[1px] rounded-md" style={{ color: "var(--rm-ink-orange)", background: "rgba(240,168,66,0.12)", border: "1px solid rgba(240,168,66,0.3)" }}>{r.date}</span>
                </div>
                <div className="text-[10.5px] mt-0.5" style={{ color: "var(--rm-text-faint)" }}>{r.role} · {r.hrs} hrs/wk returning</div>
                <div className="text-[11px] mt-1" style={{ color: "var(--rm-text-muted)" }}>{r.project}</div>
              </div>
            ))}
          </div>
        </Glass>
      </div>
    </div>
  );
}
