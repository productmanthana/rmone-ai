import "./_group.css";
import {
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip,
  ComposedChart, Bar, Line, AreaChart, Area,
} from "recharts";

const byBU = [
  { bu: "LiRo Engineers", n: 486 },
  { bu: "LiRo Program & CM", n: 512 },
  { bu: "LiRo Architecture", n: 118 },
  { bu: "LiRo-Hill JV", n: 164 },
  { bu: "GEI Shared Services", n: 96 },
  { bu: "Corporate", n: 66 },
];
const byDivision = [
  { div: "Construction Mgmt", n: 512 },
  { div: "Engineering", n: 361 },
  { div: "Program Mgmt", n: 248 },
  { div: "Environmental", n: 164 },
  { div: "Architecture", n: 108 },
  { div: "Technology", n: 49 },
];
const rolesMix = [
  { role: "Field / Inspection", n: 402, c: "var(--rm-green)" },
  { role: "Engineering", n: 361, c: "var(--rm-accent-blue)" },
  { role: "Project Mgmt", n: 296, c: "var(--rm-brand-lime)" },
  { role: "Design / Arch", n: 148, c: "var(--rm-ink-violet)" },
  { role: "Admin / Support", n: 129, c: "var(--rm-brand-orange)" },
  { role: "Executive / Ops", n: 106, c: "rgba(255,255,255,0.4)" },
];
const employmentTypes = [
  { t: "Full-time", n: 1218, pct: 84.5, c: "var(--rm-green)" },
  { t: "Part-time", n: 74, pct: 5.1, c: "var(--rm-accent-blue)" },
  { t: "Contract / 1099", n: 118, pct: 8.2, c: "var(--rm-brand-orange)" },
  { t: "Per-diem", n: 32, pct: 2.2, c: "var(--rm-ink-violet)" },
];
const joinersLeavers = [
  { m: "Sep", j: 18, l: 11, net: 1391 },
  { m: "Oct", j: 22, l: 14, net: 1399 },
  { m: "Nov", j: 15, l: 9, net: 1405 },
  { m: "Dec", j: 9, l: 13, net: 1401 },
  { m: "Jan", j: 27, l: 8, net: 1420 },
  { m: "Feb", j: 31, l: 9, net: 1442 },
];
const topTitles = [
  { title: "Resident Engineer", n: 118 },
  { title: "Construction Inspector", n: 104 },
  { title: "Project Manager", n: 96 },
  { title: "Senior Civil Engineer", n: 71 },
  { title: "Office Engineer", n: 63 },
  { title: "Scheduler (P6)", n: 44 },
  { title: "Project Architect", n: 38 },
  { title: "Estimator", n: 31 },
];
const byDepartment = [
  { dept: "Transportation CM", n: 233 },
  { dept: "Buildings CM", n: 187 },
  { dept: "Civil / Site", n: 142 },
  { dept: "MEP Engineering", n: 118 },
  { dept: "Structures", n: 101 },
  { dept: "Environmental Compliance", n: 92 },
  { dept: "K-12 Program Services", n: 88 },
  { dept: "Water Resources", n: 72 },
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

function RankedList({ data, max, labelKey, valueKey }: { data: any[]; max: number; labelKey: string; valueKey: string }) {
  return (
    <div className="space-y-[8px] mt-1">
      {data.map((d, i) => (
        <div key={d[labelKey]}>
          <div className="flex justify-between items-baseline text-[11px] mb-[3px]">
            <span className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold tabular-nums w-3.5 h-3.5 rounded-[4px] flex items-center justify-center"
                style={{ background: i === 0 ? "var(--rm-green)" : "rgba(255,255,255,0.1)", color: i === 0 ? "#16240a" : "rgba(255,255,255,0.6)" }}>{i + 1}</span>
              <span style={{ color: "var(--rm-text-muted)" }}>{d[labelKey]}</span>
            </span>
            <span className="font-bold tabular-nums">{d[valueKey].toLocaleString()}</span>
          </div>
          <div className="h-[5px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
            <div className="h-full rounded-full" style={{
              width: `${(d[valueKey] / max) * 100}%`,
              background: "linear-gradient(90deg, rgba(107,165,57,0.45), #8EC94A)",
              boxShadow: "0 0 8px rgba(107,165,57,0.55)",
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function StaffAnalytics() {
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
                Analytics Center <span className="mx-1">/</span> <span style={{ color: "var(--rm-green-ink)" }}>Staff Analytics</span>
              </div>
              <h1 className="text-[20px] font-extrabold leading-tight tracking-tight">Workforce Composition</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-full font-medium" style={{ background: "var(--rm-green-soft)", color: "var(--rm-green-ink)", border: "1px solid rgba(107,165,57,0.4)" }}>Tenant: LiRo</span>
            <span className="px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--rm-panel-border)", color: "var(--rm-text-muted)" }}>Last 6 months · as of Feb 28, 2025</span>
          </div>
        </div>

        {/* HERO: big headcount numeral with glowing spark */}
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Glass className="overflow-hidden" style={{ minHeight: 240, gridColumn: "span 8 / span 8" }}>
            <div className="absolute rounded-2xl overflow-hidden" style={{ left: 0, right: 0, bottom: 0, height: 150 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={joinersLeavers} margin={{ top: 12, right: 0, bottom: 16, left: 0 }}>
                  <defs>
                    <linearGradient id="staffHeroFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8EC94A" stopOpacity={0.55} />
                      <stop offset="60%" stopColor="#6BA539" stopOpacity={0.16} />
                      <stop offset="100%" stopColor="#6BA539" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="staffHeroStroke" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#38BDF8" />
                      <stop offset="55%" stopColor="#8EC94A" />
                      <stop offset="100%" stopColor="#C4D44A" />
                    </linearGradient>
                  </defs>
                  <YAxis domain={[1380, 1450]} hide />
                  <Tooltip contentStyle={tipStyle} formatter={(v: number) => [v.toLocaleString(), "Headcount"]} labelStyle={{ color: "rgba(255,255,255,0.6)" }} />
                  <Area dataKey="net" stroke="url(#staffHeroStroke)" strokeWidth={3} fill="url(#staffHeroFill)" dot={false}
                    style={{ filter: "drop-shadow(0 0 8px rgba(142,201,74,0.65))" }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="relative px-6 pt-5 pb-4 flex flex-col h-full">
              <div className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.18em", color: "var(--rm-green-ink)" }}>People on Staff Today</div>
              <div className="flex items-baseline gap-4 mt-1">
                <span className="font-extrabold tabular-nums leading-none" style={{
                  fontSize: 72, letterSpacing: "-0.03em",
                  background: "linear-gradient(180deg, #FFFFFF 30%, #A8D672 100%)",
                  WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
                  filter: "drop-shadow(0 0 28px rgba(107,165,57,0.35))",
                }}>1,442</span>
                <div className="text-[11px] leading-snug" style={{ color: "var(--rm-text-muted)" }}>
                  total headcount · grew by 51 people in 6 months<br />Sep 1,391 → Feb 1,442
                </div>
              </div>
              <div className="mt-auto flex items-end justify-between text-[10px] tabular-nums" style={{ color: "rgba(255,255,255,0.45)" }}>
                {joinersLeavers.map((d) => <span key={d.m}>{d.m}</span>)}
              </div>
            </div>
          </Glass>

          {/* Stat cards */}
          <div className="grid grid-rows-4 gap-3" style={{ gridColumn: "span 4 / span 4" }}>
            {[
              { l: "Full-time Share", v: "84.5%", s: "1,218 employees" },
              { l: "Joiners (6 mo)", v: "122", s: "31 in February alone" },
              { l: "Leavers (6 mo)", v: "64", s: "4.4% annualized attrition — that's low" },
              { l: "Distinct Titles", v: "187", s: "top: Resident Engineer (118)" },
            ].map((k) => (
              <div key={k.l} className="relative rounded-xl px-4 py-2.5 overflow-hidden flex items-center justify-between"
                style={{ background: "rgba(15,25,34,0.5)", border: "1px solid rgba(255,255,255,0.09)" }}>
                <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: "linear-gradient(180deg, #8EC94A, rgba(107,165,57,0.1))" }} />
                <div>
                  <div className="text-[9px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "rgba(255,255,255,0.55)" }}>{k.l}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--rm-text-faint)" }}>{k.s}</div>
                </div>
                <span className="text-[26px] font-extrabold tabular-nums leading-none" style={{ color: "var(--rm-green-ink)", textShadow: "0 0 18px rgba(107,165,57,0.35)" }}>{k.v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Org distribution as ranked lists */}
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Glass className="px-5 py-4" style={{ gridColumn: "span 4 / span 4" }}>
            <SectionLabel right="1,442 total">Headcount by Business Unit</SectionLabel>
            <RankedList data={[...byBU].sort((a, b) => b.n - a.n)} max={512} labelKey="bu" valueKey="n" />
          </Glass>
          <Glass className="px-5 py-4" style={{ gridColumn: "span 4 / span 4" }}>
            <SectionLabel right="active staff">Headcount by Division</SectionLabel>
            <RankedList data={byDivision} max={512} labelKey="div" valueKey="n" />
          </Glass>
          <Glass className="px-5 py-4" style={{ gridColumn: "span 4 / span 4" }}>
            <SectionLabel right="by function family">Roles Mix — What People Do</SectionLabel>
            <div className="space-y-[8px] mt-1">
              {rolesMix.map((d) => (
                <div key={d.role}>
                  <div className="flex justify-between items-baseline text-[11px] mb-[3px]">
                    <span className="flex items-center gap-1.5" style={{ color: "var(--rm-text-muted)" }}>
                      <span className="w-2 h-2 rounded-sm inline-block" style={{ background: d.c, boxShadow: "0 0 6px rgba(255,255,255,0.15)" }} />{d.role}
                    </span>
                    <span className="font-bold tabular-nums">{d.n}</span>
                  </div>
                  <div className="h-[5px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div className="h-full rounded-full" style={{ width: `${(d.n / 402) * 100}%`, background: d.c, opacity: 0.9 }} />
                  </div>
                </div>
              ))}
            </div>
          </Glass>
        </div>

        {/* Bottom band: joiners/leavers chart + employment types + titles + departments */}
        <div className="grid grid-cols-12 gap-4">
          <Glass className="px-5 py-4 flex flex-col" style={{ gridColumn: "span 4 / span 4" }}>
            <SectionLabel right="monthly · line = total headcount">People Joining vs Leaving</SectionLabel>
            <div className="flex-1 min-h-[195px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={joinersLeavers} margin={{ top: 6, right: -14, bottom: 0, left: -22 }}>
                  <defs>
                    <linearGradient id="jBar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8EC94A" stopOpacity={1} />
                      <stop offset="100%" stopColor="#8EC94A" stopOpacity={0.35} />
                    </linearGradient>
                    <linearGradient id="lBar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F87171" stopOpacity={1} />
                      <stop offset="100%" stopColor="#F87171" stopOpacity={0.35} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="m" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="bars" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="line" orientation="right" domain={[1380, 1450]} tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar yAxisId="bars" dataKey="j" name="Joiners" fill="url(#jBar)" radius={[3, 3, 0, 0]} barSize={10} isAnimationActive={false} />
                  <Bar yAxisId="bars" dataKey="l" name="Leavers" fill="url(#lBar)" radius={[3, 3, 0, 0]} barSize={10} isAnimationActive={false} />
                  <Line yAxisId="line" dataKey="net" name="Headcount" stroke="var(--rm-green-ink)" strokeWidth={2} dot={false}
                    style={{ filter: "drop-shadow(0 0 6px rgba(168,214,114,0.6))" }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-3 mt-1.5">
              {[["Joiners", "#8EC94A"], ["Leavers", "#F87171"], ["Headcount", "var(--rm-green-ink)"]].map(([l, c]) => (
                <span key={l} className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--rm-text-muted)" }}>
                  <span className="w-2 h-2 rounded-sm inline-block" style={{ background: c }} />{l}
                </span>
              ))}
            </div>
          </Glass>

          <Glass className="px-5 py-4" style={{ gridColumn: "span 3 / span 3" }}>
            <SectionLabel right="1,442 people">Employment Types</SectionLabel>
            <div className="space-y-3 mt-1">
              {employmentTypes.map((e) => (
                <div key={e.t}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span style={{ color: "var(--rm-text-muted)" }}>{e.t}</span>
                    <span className="font-bold tabular-nums">{e.n} · {e.pct}%</span>
                  </div>
                  <div className="h-[6px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                    <div className="h-full rounded-full" style={{ width: `${e.pct}%`, background: e.c, boxShadow: "0 0 8px rgba(255,255,255,0.12)" }} />
                  </div>
                </div>
              ))}
              <div className="pt-2 text-[10.5px] leading-relaxed" style={{ color: "var(--rm-text-faint)", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                Contract share up 1.3 pts since Sep — driven by inspection surges on MTA and SCA programs.
              </div>
            </div>
          </Glass>

          <Glass className="px-5 py-4" style={{ gridColumn: "span 2 / span 2" }}>
            <SectionLabel right="top 8 of 187">Top Titles</SectionLabel>
            <div className="space-y-1.5 mt-0.5">
              {topTitles.map((t) => (
                <div key={t.title} className="flex items-center justify-between text-[11px]" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 3 }}>
                  <span style={{ color: "var(--rm-text-muted)" }}>{t.title}</span>
                  <span className="font-bold tabular-nums" style={{ color: "var(--rm-green-ink)" }}>{t.n}</span>
                </div>
              ))}
            </div>
          </Glass>

          <Glass className="px-5 py-4" style={{ gridColumn: "span 3 / span 3" }}>
            <SectionLabel right="top 8">Headcount by Department</SectionLabel>
            <RankedList data={byDepartment} max={233} labelKey="dept" valueKey="n" />
          </Glass>
        </div>
      </div>
    </div>
  );
}
