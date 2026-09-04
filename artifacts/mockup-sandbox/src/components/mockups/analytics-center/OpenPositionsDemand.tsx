import "./_group.css";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

const byRole = [
  { role: "Project Manager", positions: 14, hrs: 5460 },
  { role: "Resident Engineer", positions: 11, hrs: 4290 },
  { role: "Construction Inspector", positions: 9, hrs: 3510 },
  { role: "Scheduler (P6)", positions: 6, hrs: 2340 },
  { role: "Estimator", positions: 5, hrs: 1950 },
  { role: "CAD / BIM Specialist", positions: 4, hrs: 1360 },
  { role: "Safety Manager", positions: 3, hrs: 1170 },
  { role: "Project Controls Analyst", positions: 3, hrs: 1080 },
];

const byDivision = [
  { name: "Construction Mgmt", value: 19, color: "#6BA539" },
  { name: "Engineering", value: 12, color: "#38BDF8" },
  { name: "Program Mgmt", value: 9, color: "#A78BFA" },
  { name: "Architecture", value: 6, color: "#F0A842" },
  { name: "Environmental", value: 5, color: "#C4D44A" },
  { name: "Corporate", value: 4, color: "#6B99BB" },
];

const aging = [
  { bucket: "0-2 wks", positions: 12, color: "#84CC16" },
  { bucket: "2-4 wks", positions: 15, color: "#A8D672" },
  { bucket: "4-8 wks", positions: 14, color: "#FB923C" },
  { bucket: "8-12 wks", positions: 8, color: "#F87171" },
  { bucket: "12+ wks", positions: 6, color: "#DC2626" },
];

const demandSupply = [
  { wk: "Nov 25", demand: 46200, supply: 41800 },
  { wk: "Dec 2", demand: 47100, supply: 41900 },
  { wk: "Dec 9", demand: 47900, supply: 42100 },
  { wk: "Dec 16", demand: 46800, supply: 41400 },
  { wk: "Dec 23", demand: 42300, supply: 38600 },
  { wk: "Dec 30", demand: 41900, supply: 38200 },
  { wk: "Jan 6", demand: 49400, supply: 42600 },
  { wk: "Jan 13", demand: 50800, supply: 42900 },
  { wk: "Jan 20", demand: 51600, supply: 43100 },
  { wk: "Jan 27", demand: 52400, supply: 43300 },
  { wk: "Feb 3", demand: 53100, supply: 43500 },
  { wk: "Feb 10", demand: 53800, supply: 43600 },
];

const affectedProjects = [
  { project: "MTA East Side Access — CM Phase 3", division: "Construction Mgmt", open: 6, hrs: 2340, weeks: 9, urgency: "critical" },
  { project: "JFK Terminal 6 Redevelopment", division: "Program Mgmt", open: 5, hrs: 1980, weeks: 7, urgency: "critical" },
  { project: "SCA School Modernization Bundle 14", division: "Construction Mgmt", open: 4, hrs: 1520, weeks: 5, urgency: "high" },
  { project: "NYCDEP Croton Filtration Upgrades", division: "Engineering", open: 4, hrs: 1440, weeks: 11, urgency: "critical" },
  { project: "Gateway Hudson Tunnel — Inspection", division: "Engineering", open: 3, hrs: 1180, weeks: 4, urgency: "high" },
  { project: "NJ Transit Portal Bridge North", division: "Program Mgmt", open: 3, hrs: 1090, weeks: 6, urgency: "high" },
  { project: "LGA Central Terminal Closeout", division: "Construction Mgmt", open: 2, hrs: 760, weeks: 3, urgency: "med" },
  { project: "Battery Park Resilience Design", division: "Architecture", open: 2, hrs: 680, weeks: 8, urgency: "med" },
];

const hiringPriority = [
  { role: "Resident Engineer", why: "4 positions open 8+ weeks; ESA Phase 3 and Croton both blocked", act: "Hire now" },
  { role: "Project Manager", why: "Largest gap by hours; JFK T6 ramps +3 PMs in January", act: "Hire now" },
  { role: "Construction Inspector", why: "Seasonal ramp Feb; internal bench covers only 2 of 9", act: "Next 30 days" },
  { role: "Scheduler (P6)", why: "2 of 6 coverable by GEI transfer; rest external", act: "Next 30 days" },
];

// Forward horizon: projected role gap at 3/6/9 months + typical external hiring lead time
const roleOutlook = [
  { role: "Project Manager",        lead: "10 wks", m3: -5, m6: -8, m9: -11 },
  { role: "Resident Engineer",      lead: "12 wks", m3: -4, m6: -6, m9: -7 },
  { role: "Construction Inspector", lead: "6 wks",  m3: -2, m6: -7, m9: -9 },
  { role: "Scheduler (P6)",         lead: "8 wks",  m3: -2, m6: -3, m9: -3 },
  { role: "Estimator",              lead: "9 wks",  m3: -1, m6: -2, m9: -4 },
  { role: "CAD / BIM Specialist",   lead: "5 wks",  m3: 0,  m6: -1, m9: -2 },
];

// What-if: 4 pursuits pending award in the next 2 quarters
const winScenarios = [
  { label: "Win 1 of 4", detail: "SCA Bundle 15 only", gap: "+4 roles", severity: "warn" },
  { label: "Win 2 of 4", detail: "+ NYCHA Sandy Recovery", gap: "+9 roles", severity: "warn" },
  { label: "Win 3 of 4", detail: "+ Penn Station Access", gap: "+15 roles", severity: "bad" },
  { label: "Win all 4", detail: "+ BQE Central", gap: "+22 roles", severity: "bad" },
];

const tipStyle = {
  background: "#1B2A36",
  border: "1px solid rgba(107,165,57,0.35)",
  borderRadius: 10,
  color: "var(--rm-text)",
  fontSize: 12,
  boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
};

const fmt = (n: number) => n.toLocaleString("en-US");

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

/* Urgency ring: how many open positions are past escalation */
function UrgencyRing({ pct, value, sub, size = 148 }: { pct: number; value: string; sub: string; size?: number }) {
  const r = size / 2 - 12;
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
      <path d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={9} strokeLinecap="round" />
      <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${largeVal} 1 ${tx} ${ty}`} fill="none" stroke="#FB923C" strokeWidth={9} strokeLinecap="round"
        style={{ filter: "drop-shadow(0 0 8px rgba(251,146,60,0.7))" }} />
      <circle cx={tx} cy={ty} r={5} fill="#fff" style={{ filter: "drop-shadow(0 0 6px rgba(255,255,255,0.9))" }} />
      <text x={cx} y={cy - 2} textAnchor="middle" fill="#fff" fontSize={26} fontWeight={800} style={{ fontVariantNumeric: "tabular-nums" }}>{value}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize={9} style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}>{sub}</text>
    </svg>
  );
}

const thStyle: React.CSSProperties = { fontWeight: 600, fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.5)", paddingBottom: 8 };

export default function OpenPositionsDemand() {
  return (
    <div className="rmone-analytics min-h-screen relative overflow-hidden" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* ambient background */}
      <div className="pointer-events-none absolute inset-0" style={{
        background:
          "radial-gradient(1100px 480px at 22% -8%, rgba(251,146,60,0.10), transparent 60%)," +
          "radial-gradient(900px 500px at 92% 8%, rgba(107,165,57,0.10), transparent 55%)," +
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
                Analytics Center <span className="mx-1">/</span> <span style={{ color: "var(--rm-green-ink)" }}>Open Positions & Demand</span>
              </div>
              <h1 className="text-[20px] font-extrabold leading-tight tracking-tight">Who do we need to hire — and how urgently</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-full font-medium" style={{ background: "var(--rm-green-soft)", color: "var(--rm-green-ink)", border: "1px solid rgba(107,165,57,0.4)" }}>Tenant: LiRo</span>
            <span className="px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--rm-panel-border)", color: "var(--rm-text-muted)" }}>Next 12 weeks · as of Nov 22</span>
            <span className="px-2.5 py-1 rounded-full font-medium" style={{ background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.35)", color: "var(--rm-ink-orange)" }}>Demand-based · no ATS data</span>
          </div>
        </div>

        {/* HERO: big callout + urgency ring + role gap list */}
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Glass className="px-6 py-5 flex items-center gap-8" style={{ gridColumn: "span 8 / span 8" }}>
            <div className="flex-1">
              <div className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.18em", color: "var(--rm-ink-orange)" }}>Hiring Gap — Plain English</div>
              <div className="flex items-baseline gap-3 mt-1 flex-wrap">
                <span className="font-extrabold tabular-nums leading-none" style={{
                  fontSize: 68, letterSpacing: "-0.03em",
                  background: "linear-gradient(180deg, #FFFFFF 30%, #FDBA74 100%)",
                  WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
                  filter: "drop-shadow(0 0 28px rgba(251,146,60,0.3))",
                }}>55</span>
                <span className="text-[16px] font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>open positions</span>
                <span className="text-[16px]" style={{ color: "var(--rm-text-faint)" }}>·</span>
                <span className="text-[26px] font-extrabold tabular-nums" style={{ color: "var(--rm-ink-red)", textShadow: "0 0 18px rgba(248,113,113,0.35)" }}>≈$1.64M</span>
                <span className="text-[13px]" style={{ color: "var(--rm-text-muted)" }}>of planned labor at risk over the next 12 weeks</span>
              </div>
              <div className="text-[12px] mt-2 leading-relaxed" style={{ color: "var(--rm-text-muted)" }}>
                An open position is project work with no person assigned to do it. 21,130 hours are currently unstaffed;
                9 positions can be filled from our own bench — the rest likely need outside hires.
              </div>
              <div className="flex gap-3 mt-3 flex-wrap">
                {[
                  { l: "Unstaffed hours (12 wks)", v: "21,130", c: "var(--rm-ink-red)" },
                  { l: "Median time open", v: "4.6 wks", c: "#fff", s: "target ≤ 3 weeks" },
                  { l: "Coverable from bench", v: "9", c: "var(--rm-green-ink)", s: "matching role + availability" },
                ].map((k) => (
                  <div key={k.l} className="rounded-xl px-3.5 py-2" style={{ background: "rgba(15,25,34,0.5)", border: "1px solid rgba(255,255,255,0.09)" }}>
                    <div className="text-[9px] font-bold uppercase" style={{ letterSpacing: "0.12em", color: "rgba(255,255,255,0.5)" }}>{k.l}</div>
                    <div className="text-[20px] font-extrabold tabular-nums leading-tight" style={{ color: k.c }}>{k.v}</div>
                    {k.s && <div className="text-[9.5px]" style={{ color: "var(--rm-text-faint)" }}>{k.s}</div>}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col items-center shrink-0">
              <UrgencyRing pct={25} value="14" sub="aged 8+ wks" />
              <div className="text-[10px] font-semibold uppercase mt-1 text-center" style={{ letterSpacing: "0.12em", color: "rgba(255,255,255,0.7)" }}>Past escalation</div>
              <div className="text-[10px] text-center" style={{ color: "var(--rm-text-faint)" }}>25% of open positions</div>
            </div>
          </Glass>

          {/* Roles ranked list with inline bars (replaces role bar chart) */}
          <Glass className="px-5 py-4" style={{ gridColumn: "span 4 / span 4" }}>
            <SectionLabel right="positions · unstaffed hrs">Open Positions by Role</SectionLabel>
            <div className="space-y-[7px]">
              {byRole.map((r, i) => (
                <div key={r.role}>
                  <div className="flex justify-between items-baseline text-[11px] mb-[3px]">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold tabular-nums w-3.5 h-3.5 rounded-[4px] flex items-center justify-center"
                        style={{ background: i === 0 ? "var(--rm-green)" : "rgba(255,255,255,0.1)", color: i === 0 ? "#16240a" : "rgba(255,255,255,0.6)" }}>{i + 1}</span>
                      <span style={{ color: "var(--rm-text-muted)" }}>{r.role}</span>
                    </span>
                    <span className="font-bold tabular-nums">{r.positions} <span className="font-medium text-[10px]" style={{ color: "var(--rm-text-faint)" }}>· {fmt(r.hrs)} h</span></span>
                  </div>
                  <div className="h-[5px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div className="h-full rounded-full" style={{
                      width: `${(r.positions / 14) * 100}%`,
                      background: "linear-gradient(90deg, rgba(107,165,57,0.45), #8EC94A)",
                      boxShadow: "0 0 8px rgba(107,165,57,0.55)",
                    }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[10px] mt-2" style={{ color: "var(--rm-text-faint)" }}>
              PM + Resident Engineer together account for 46% of all unstaffed hours
            </div>
          </Glass>
        </div>

        {/* Division ticker + aging strip */}
        <div className="mb-4 rounded-xl overflow-hidden flex items-center" style={{ background: "rgba(15,25,34,0.55)", border: "1px solid rgba(255,255,255,0.09)" }}>
          <div className="px-3 py-1.5 text-[9px] font-bold uppercase shrink-0" style={{ letterSpacing: "0.16em", color: "#16240a", background: "linear-gradient(140deg, #8EC94A, #6BA539)" }}>Where the 55 sit</div>
          <div className="flex items-center gap-6 px-4 py-1.5 overflow-hidden whitespace-nowrap flex-1">
            {byDivision.map((d) => (
              <span key={d.name} className="flex items-center gap-1.5 text-[11px] shrink-0">
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: d.color, boxShadow: `0 0 6px ${d.color}66` }} />
                <span style={{ color: "var(--rm-text-faint)" }}>{d.name}</span>
                <span className="font-bold tabular-nums" style={{ color: "#fff" }}>{d.value}</span>
              </span>
            ))}
          </div>
          <div className="px-4 py-1.5 flex items-center gap-3 shrink-0" style={{ borderLeft: "1px solid rgba(255,255,255,0.09)" }}>
            <span className="text-[9px] font-bold uppercase" style={{ letterSpacing: "0.12em", color: "rgba(255,255,255,0.5)" }}>How long open</span>
            {aging.map((a) => (
              <span key={a.bucket} className="flex items-center gap-1 text-[11px]">
                <span style={{ color: "var(--rm-text-faint)" }}>{a.bucket}</span>
                <span className="font-bold tabular-nums" style={{ color: a.color }}>{a.positions}</span>
              </span>
            ))}
          </div>
        </div>

        {/* THE chart: demand vs supply + hiring priority */}
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Glass className="px-5 py-4" style={{ gridColumn: "span 8 / span 8" }}>
            <SectionLabel right="next 12 weeks · the gap between the lines is what we must hire for">Work Needed vs People Available — Hours per Week</SectionLabel>
            <div style={{ height: 220 }}>
              <ResponsiveContainer>
                <LineChart data={demandSupply} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="wk" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} axisLine={false} tickLine={false} domain={[35000, 56000]} tickFormatter={(v) => `${Math.round(v / 1000)}K`} />
                  <Tooltip contentStyle={tipStyle} formatter={(v: number) => fmt(v)} />
                  <Line type="monotone" dataKey="demand" name="Work needed (hrs)" stroke="#FB923C" strokeWidth={2.5} dot={false}
                    style={{ filter: "drop-shadow(0 0 6px rgba(251,146,60,0.6))" }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="supply" name="People available (hrs)" stroke="#8EC94A" strokeWidth={2.5} dot={false}
                    style={{ filter: "drop-shadow(0 0 6px rgba(142,201,74,0.6))" }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-5 text-[11px] mt-2 items-center" style={{ color: "var(--rm-text-muted)" }}>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-[3px] rounded" style={{ background: "#FB923C", boxShadow: "0 0 6px rgba(251,146,60,0.7)" }} />Work needed</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-[3px] rounded" style={{ background: "#8EC94A", boxShadow: "0 0 6px rgba(142,201,74,0.7)" }} />People available</span>
              <span className="ml-auto" style={{ color: "var(--rm-ink-orange)" }}>Gap widens to <b>10,200 hrs/wk</b> by mid-February as JFK T6 and inspection season ramp</span>
            </div>
          </Glass>

          <Glass className="px-5 py-4" style={{ gridColumn: "span 4 / span 4", background: "linear-gradient(160deg, rgba(107,165,57,0.10), rgba(37,55,70,0.55))" }}>
            <SectionLabel right="ranked">Hiring Priority — What to Do</SectionLabel>
            <div className="flex flex-col gap-3 mt-1">
              {hiringPriority.map((h, i) => (
                <div key={h.role} className="flex gap-2.5 items-start rounded-xl px-3 py-2.5" style={{ background: "rgba(15,25,34,0.45)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="w-[20px] h-[20px] rounded-md text-[11px] font-extrabold flex items-center justify-center shrink-0 mt-[1px] tabular-nums"
                    style={{
                      background: i < 2 ? "rgba(248,113,113,0.16)" : "rgba(251,146,60,0.14)",
                      color: i < 2 ? "var(--rm-ink-red)" : "var(--rm-ink-orange)",
                      boxShadow: i < 2 ? "0 0 10px rgba(248,113,113,0.3)" : "none",
                    }}>{i + 1}</div>
                  <div className="text-[11.5px] leading-snug">
                    <b>{h.role}</b>{" "}
                    <span className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.06em", color: i < 2 ? "var(--rm-ink-red)" : "var(--rm-ink-orange)" }}>· {h.act}</span>
                    <div className="text-[10.5px] mt-0.5" style={{ color: "var(--rm-text-muted)" }}>{h.why}</div>
                  </div>
                </div>
              ))}
            </div>
          </Glass>
        </div>

        {/* Outlook table + win scenarios (tables, restyled as glass) */}
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Glass className="px-5 py-4" style={{ gridColumn: "span 7 / span 7" }}>
            <SectionLabel right="projected gap (positions) vs external hiring lead time">Role Shortage Outlook — 3 / 6 / 9 Months</SectionLabel>
            <table className="w-full tabular-nums" style={{ fontSize: 11.5, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: "left" }}>Role</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Hiring lead time</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>3 mo</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>6 mo</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>9 mo</th>
                </tr>
              </thead>
              <tbody>
                {roleOutlook.map((r) => {
                  const cell = (v: number, key: string) => (
                    <td key={key} style={{ textAlign: "right", padding: "7px 0 7px 12px" }}>
                      <span className="px-2 py-[2px] rounded-md font-bold" style={{
                        color: v <= -5 ? "var(--rm-ink-red)" : v < 0 ? "var(--rm-ink-orange)" : "var(--rm-green-ink)",
                        background: v <= -5 ? "rgba(248,113,113,0.12)" : v < 0 ? "rgba(251,146,60,0.10)" : "var(--rm-green-soft)",
                      }}>{v === 0 ? "0" : v}</span>
                    </td>
                  );
                  return (
                    <tr key={r.role} style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                      <td style={{ padding: "7px 8px 7px 0", fontWeight: 600 }}>{r.role}</td>
                      <td style={{ textAlign: "right", color: "var(--rm-text-muted)" }}>{r.lead}</td>
                      {cell(r.m3, "m3")}{cell(r.m6, "m6")}{cell(r.m9, "m9")}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="text-[10.5px] mt-2.5" style={{ color: "var(--rm-text-faint)" }}>
              Gap = confirmed demand + weighted pipeline demand − current supply. Resident Engineer lead time (12 wks) exceeds the 3-month gap window — recruiting must start now.
            </div>
          </Glass>

          <Glass className="px-5 py-4" style={{ gridColumn: "span 5 / span 5" }}>
            <SectionLabel right="added role demand if awarded">Win Scenarios — 4 Pursuits Pending</SectionLabel>
            <div className="flex flex-col gap-2.5 mt-1">
              {winScenarios.map((s) => (
                <div key={s.label} className="flex items-center gap-3 rounded-xl px-3.5 py-2.5"
                  style={{ background: "rgba(15,25,34,0.5)", border: `1px solid ${s.severity === "bad" ? "rgba(248,113,113,0.25)" : "rgba(251,146,60,0.2)"}` }}>
                  <div className="text-[12px] font-bold min-w-[78px]">{s.label}</div>
                  <div className="text-[11px] flex-1" style={{ color: "var(--rm-text-muted)" }}>{s.detail}</div>
                  <div className="text-[15px] font-extrabold tabular-nums" style={{
                    color: s.severity === "bad" ? "var(--rm-ink-red)" : "var(--rm-ink-orange)",
                    textShadow: s.severity === "bad" ? "0 0 14px rgba(248,113,113,0.4)" : "0 0 14px rgba(251,146,60,0.35)",
                  }}>{s.gap}</div>
                </div>
              ))}
            </div>
            <div className="text-[10.5px] mt-2.5" style={{ color: "var(--rm-text-faint)" }}>
              Weighted pipeline demand is already included in the 3/6/9-month outlook at win probability; scenarios show the unweighted swing.
            </div>
          </Glass>
        </div>

        {/* Most affected projects (glass table) */}
        <Glass className="px-5 py-4">
          <SectionLabel right="ranked by unstaffed hours · next 12 weeks">Most Affected Projects</SectionLabel>
          <table className="w-full" style={{ fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: "left" }}>Project</th>
                <th style={{ ...thStyle, textAlign: "left" }}>Division</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Open positions</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Unstaffed hrs</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Oldest gap</th>
                <th style={{ ...thStyle, textAlign: "left", paddingLeft: 24 }}>Gap share</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Urgency</th>
              </tr>
            </thead>
            <tbody>
              {affectedProjects.map((p) => (
                <tr key={p.project} style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  <td style={{ padding: "8px 8px 8px 0", fontWeight: 600 }}>{p.project}</td>
                  <td style={{ color: "var(--rm-text-muted)" }}>{p.division}</td>
                  <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>{p.open}</td>
                  <td className="tabular-nums" style={{ textAlign: "right", color: "var(--rm-text-muted)" }}>{fmt(p.hrs)}</td>
                  <td className="tabular-nums" style={{ textAlign: "right", color: p.weeks >= 8 ? "var(--rm-ink-red)" : "var(--rm-text-muted)" }}>{p.weeks} wks</td>
                  <td style={{ paddingLeft: 24, width: 170 }}>
                    <div style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3 }}>
                      <div style={{
                        width: `${(p.hrs / 2340) * 100}%`, height: "100%", borderRadius: 3,
                        background: p.urgency === "critical" ? "var(--rm-ink-red)" : p.urgency === "high" ? "var(--rm-ink-orange)" : "var(--rm-green)",
                        boxShadow: p.urgency === "critical" ? "0 0 8px rgba(248,113,113,0.5)" : p.urgency === "high" ? "0 0 8px rgba(251,146,60,0.45)" : "0 0 8px rgba(107,165,57,0.45)",
                      }} />
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 9px", borderRadius: 999, textTransform: "uppercase", letterSpacing: "0.05em",
                      color: p.urgency === "critical" ? "var(--rm-ink-red)" : p.urgency === "high" ? "var(--rm-ink-orange)" : "var(--rm-green-ink)",
                      background: p.urgency === "critical" ? "rgba(248,113,113,0.12)" : p.urgency === "high" ? "rgba(251,146,60,0.12)" : "var(--rm-green-soft)",
                      border: p.urgency === "critical" ? "1px solid rgba(248,113,113,0.3)" : p.urgency === "high" ? "1px solid rgba(251,146,60,0.3)" : "1px solid rgba(107,165,57,0.3)",
                    }}>{p.urgency}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10.5px] mt-2.5" style={{ color: "var(--rm-text-faint)" }}>
            Open position = demand row with no person assigned. Sourced from allocations, not an applicant tracking system — no recruiting pipeline data exists yet.
          </div>
        </Glass>
      </div>
    </div>
  );
}
