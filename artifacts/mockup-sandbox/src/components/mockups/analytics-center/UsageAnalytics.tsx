import "./_group.css";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

const LIRO = "#6BA539";
const LIRO_INK = "#A8D672";
const GEI = "#38BDF8";

const weeklyTrend = [
  { wk: "Jun 15", liro: 2945, gei: 2444 },
  { wk: "Jun 22", liro: 3192, gei: 2117 },
  { wk: "Jun 29", liro: 5341, gei: 1818 },
  { wk: "Jul 6", liro: 2851, gei: 1532 },
  { wk: "Jul 13", liro: 1749, gei: 1821 },
];

const wauByWeek = [
  { wk: "Jun 15", liro: 41, gei: 61 },
  { wk: "Jun 22", liro: 39, gei: 70 },
  { wk: "Jun 29", liro: 40, gei: 62 },
  { wk: "Jul 6", liro: 43, gei: 64 },
  { wk: "Jul 13", liro: 33, gei: 64 },
];

const features = [
  { name: "ManagerViewGantt", liro: 521, gei: 3472 },
  { name: "WeeklyTeamTab", liro: 1514, gei: 56 },
  { name: "PMMProjects", liro: 1512, gei: 17 },
  { name: "RMM", liro: 986, gei: 132 },
  { name: "UserInfo", liro: 148, gei: 479 },
  { name: "UserEntryPage", liro: 445, gei: 114 },
];

const leastUsed = [
  { name: "Opportunity", liro: 0, gei: 11 },
  { name: "PMM", liro: 0, gei: 3 },
];

const txByType = [
  { type: "Allocation Update", liro: 5271, gei: 3794 },
  { type: "Allocation Data Sync", liro: 2207, gei: 1436 },
  { type: "Opened Record", liro: 1127, gei: 120 },
  { type: "Project Save", liro: 1152, gei: 80 },
  { type: "Work Item Created", liro: 224, gei: 18 },
];

const portfolio = [
  { status: "Active", liro: 623, gei: 0 },
  { status: "Closed", liro: 71, gei: 1091 },
  { status: "Not Set", liro: 110, gei: 8469 },
];

const training = [
  { who: "GEI", detail: "1,764 enabled users never active in window", signal: "0 sessions · 5 wks", sev: "high" },
  { who: "LiRo", detail: "477 enabled users with no observed activity", signal: "0 sessions · 5 wks", sev: "high" },
  { who: "GEI managers", detail: "430 enabled managers with low feature breadth", signal: "narrow usage", sev: "med" },
];

const loginBands = [
  { band: "Every week (5/5)", liro: 26, gei: 48 },
  { band: "Most weeks (3-4)", liro: 14, gei: 31 },
  { band: "Occasional (1-2)", liro: 13, gei: 28 },
];

const fmt = (n: number) => n.toLocaleString("en-US");

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
    <div className="flex items-baseline justify-between mb-2.5 gap-3">
      <div className="flex items-center gap-2">
        <span className="inline-block w-1 h-3 rounded-full" style={{ background: "var(--rm-green)", boxShadow: "0 0 8px rgba(107,165,57,0.8)" }} />
        <span className="text-[10px] font-semibold uppercase" style={{ letterSpacing: "0.14em", color: "rgba(255,255,255,0.75)" }}>{children}</span>
      </div>
      {right && <span className="text-[10px] text-right" style={{ color: "var(--rm-text-faint)" }}>{right}</span>}
    </div>
  );
}

/* Radial gauge (SVG arc, glow tip) */
function Gauge({ pct, label, value, sub, color = "var(--rm-green)", size = 150 }: {
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
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={9} strokeLinecap="round" />
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${valSweep > 180 ? 1 : 0} 1 ${tx} ${ty}`} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 8px rgba(240,168,66,0.6))" }} />
        <circle cx={tx} cy={ty} r={5.5} fill="#fff" style={{ filter: "drop-shadow(0 0 6px rgba(255,255,255,0.9))" }} />
        <text x={cx} y={cy - 2} textAnchor="middle" fill="#fff" fontSize={30} fontWeight={800} style={{ fontVariantNumeric: "tabular-nums" }}>{value}</text>
        <text x={cx} y={cy + 18} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize={9} style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}>{sub}</text>
      </svg>
      <div className="text-[10px] font-semibold uppercase mt-1 text-center" style={{ letterSpacing: "0.12em", color: "rgba(255,255,255,0.7)" }}>{label}</div>
    </div>
  );
}

function TenantTabs() {
  const tabs = ["All Tenants", "LiRo", "GEI"];
  return (
    <div className="inline-flex items-center rounded-lg p-1 gap-0.5" style={{ background: "rgba(15,25,34,0.55)", border: "1px solid rgba(255,255,255,0.1)" }}>
      {tabs.map((t, i) => (
        <span
          key={t}
          className="rounded-md px-4 py-1.5 text-[11.5px] cursor-pointer"
          style={
            i === 0
              ? { background: "linear-gradient(140deg, #8EC94A, #6BA539)", color: "#16240a", fontWeight: 700, boxShadow: "0 0 14px rgba(107,165,57,0.5)" }
              : { color: "var(--rm-text-muted)", fontWeight: 500 }
          }
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function PairedBars({ rows, max }: { rows: { name: string; liro: number; gei: number }[]; max: number }) {
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2 text-[11px]">
          <div className="w-[122px] truncate" style={{ color: "var(--rm-text-muted)" }}>{r.name}</div>
          <div className="flex-1 flex flex-col gap-[3px]">
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-[6px] rounded-full" style={{ background: "rgba(255,255,255,0.07)" }}>
                <div className="h-full rounded-full" style={{
                  width: `${Math.max((r.liro / max) * 100, r.liro > 0 ? 1.5 : 0)}%`,
                  background: "linear-gradient(90deg, rgba(107,165,57,0.5), #8EC94A)",
                  boxShadow: r.liro > 0 ? "0 0 6px rgba(107,165,57,0.5)" : "none",
                }} />
              </div>
              <div className="w-[44px] text-right font-bold tabular-nums" style={{ color: r.liro === 0 ? "var(--rm-ink-red)" : "var(--rm-text)" }}>{fmt(r.liro)}</div>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-[6px] rounded-full" style={{ background: "rgba(255,255,255,0.07)" }}>
                <div className="h-full rounded-full" style={{
                  width: `${Math.max((r.gei / max) * 100, r.gei > 0 ? 1.5 : 0)}%`,
                  background: "linear-gradient(90deg, rgba(56,189,248,0.5), #38BDF8)",
                  boxShadow: r.gei > 0 ? "0 0 6px rgba(56,189,248,0.5)" : "none",
                }} />
              </div>
              <div className="w-[44px] text-right font-bold tabular-nums" style={{ color: r.gei === 0 ? "var(--rm-ink-red)" : "var(--rm-text)" }}>{fmt(r.gei)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatRow({ label, value, split }: { label: string; value: string; split: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl px-4 py-2.5" style={{ background: "rgba(15,25,34,0.5)", border: "1px solid rgba(255,255,255,0.09)" }}>
      <span className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.12em", color: "rgba(255,255,255,0.55)" }}>{label}</span>
      <span className="text-right">
        <span className="text-[20px] font-extrabold tabular-nums leading-none block" style={{ textShadow: "0 0 18px rgba(107,165,57,0.25)" }}>{value}</span>
        <span className="text-[10px] tabular-nums" style={{ color: "var(--rm-text-faint)" }}>{split}</span>
      </span>
    </div>
  );
}

/* ----------------------------------- page ---------------------------------- */

export default function UsageAnalytics() {
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
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-[13px] font-extrabold"
              style={{ background: "linear-gradient(140deg, #8EC94A, #6BA539)", color: "#16240a", boxShadow: "0 0 24px rgba(107,165,57,0.5)" }}>RM</div>
            <div>
              <div className="text-[11px]" style={{ color: "var(--rm-text-faint)" }}>
                Analytics Center <span className="mx-1">/</span> <span style={{ color: "var(--rm-green-ink)" }}>Usage Analytics</span>
              </div>
              <h1 className="text-[20px] font-extrabold leading-tight tracking-tight">Cross-Tenant Usage & Adoption</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-full font-semibold" style={{ background: "rgba(167,139,250,0.15)", border: "1px solid rgba(167,139,250,0.4)", color: "var(--rm-ink-violet)" }}>Admin only</span>
            <span className="px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--rm-panel-border)", color: "var(--rm-text-muted)" }}>
              Observation window: <b style={{ color: "var(--rm-text)" }}>Jun 15 – Jul 16, 2026 · 5 weeks</b>
            </span>
          </div>
        </div>

        {/* HERO: adoption gauge + tenant tabs + big stat rows */}
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Glass className="px-6 py-4" style={{ gridColumn: "span 5 / span 5" }}>
            <div className="flex items-center justify-between mb-2">
              <TenantTabs />
              <div className="flex gap-3 text-[11px]" style={{ color: "var(--rm-text-muted)" }}>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: LIRO, boxShadow: "0 0 6px rgba(107,165,57,0.6)" }} />LiRo</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: GEI, boxShadow: "0 0 6px rgba(56,189,248,0.6)" }} />GEI</span>
              </div>
            </div>
            <div className="flex items-center gap-5">
              <Gauge pct={6.7} label="Observed Adoption" value="6.7%" sub="160 of 2,401" color="#F0A842" size={158} />
              <div className="flex-1 space-y-2">
                <div className="text-[12px] leading-snug" style={{ color: "var(--rm-text-muted)" }}>
                  Plain English: only <b style={{ color: "#fff" }}>160 of 2,401</b> enabled people actually used the platform in the 5-week window.
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg px-3 py-2" style={{ background: "rgba(107,165,57,0.1)", border: "1px solid rgba(107,165,57,0.35)" }}>
                    <div className="text-[9px] uppercase font-bold" style={{ letterSpacing: "0.1em", color: LIRO_INK }}>LiRo adoption</div>
                    <div className="text-[22px] font-extrabold tabular-nums leading-tight">10.0%</div>
                    <div className="text-[10px] tabular-nums" style={{ color: "var(--rm-text-faint)" }}>53 of 530 enabled</div>
                  </div>
                  <div className="rounded-lg px-3 py-2" style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.3)" }}>
                    <div className="text-[9px] uppercase font-bold" style={{ letterSpacing: "0.1em", color: GEI }}>GEI adoption</div>
                    <div className="text-[22px] font-extrabold tabular-nums leading-tight">5.7%</div>
                    <div className="text-[10px] tabular-nums" style={{ color: "var(--rm-text-faint)" }}>107 of 1,871 enabled</div>
                  </div>
                </div>
              </div>
            </div>
          </Glass>

          <div className="grid grid-cols-2 gap-3" style={{ gridColumn: "span 7 / span 7" }}>
            <StatRow label="Enabled users" value="2,401" split="LiRo 530 · GEI 1,871" />
            <StatRow label="Managers" value="465" split="LiRo 35 · GEI 430" />
            <StatRow label="Active users" value="160" split="LiRo 53 · GEI 107" />
            <StatRow label="Human transactions" value="15,429" split="LiRo 9,981 · GEI 5,448" />
            <StatRow label="Page visits" value="10,381" split="LiRo 6,097 · GEI 4,284" />
            <StatRow label="Total projects" value="10,364" split="LiRo 804 · GEI 9,560" />
          </div>
        </div>

        {/* Chart 1: weekly trend + WAU as list + login frequency */}
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Glass className="col-span-6 px-5 py-4 flex flex-col">
            <SectionLabel right="human users · system and admin accounts excluded">Weekly Activity Trend — LiRo vs GEI</SectionLabel>
            <div className="flex-1 min-h-[190px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyTrend} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="wk" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.65)" }} />
                  <Line type="monotone" dataKey="liro" name="LiRo" stroke={LIRO_INK} strokeWidth={2.6} dot={{ r: 3, fill: LIRO_INK }}
                    style={{ filter: "drop-shadow(0 0 6px rgba(168,214,114,0.5))" }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="gei" name="GEI" stroke={GEI} strokeWidth={2.6} dot={{ r: 3, fill: GEI }}
                    style={{ filter: "drop-shadow(0 0 6px rgba(56,189,248,0.5))" }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[10.5px] mt-1.5" style={{ color: "var(--rm-text-faint)" }}>Week of Jul 13 is partial (4 days)</div>
          </Glass>

          <Glass className="col-span-3 px-5 py-4">
            <SectionLabel right="unique humans / week">Weekly Active Users</SectionLabel>
            <div className="space-y-2">
              {wauByWeek.map((w) => (
                <div key={w.wk} className="flex items-center gap-2 text-[11px]">
                  <span className="w-[46px]" style={{ color: "var(--rm-text-muted)" }}>{w.wk}</span>
                  <div className="flex-1 flex h-[9px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div style={{ width: `${(w.liro / 113) * 100}%`, background: LIRO, boxShadow: "0 0 6px rgba(107,165,57,0.5)" }} />
                    <div style={{ width: `${(w.gei / 113) * 100}%`, background: GEI }} />
                  </div>
                  <span className="w-[52px] text-right font-bold tabular-nums">{w.liro} · {w.gei}</span>
                </div>
              ))}
            </div>
            <div className="text-[10.5px] mt-3 leading-relaxed" style={{ color: "var(--rm-text-faint)" }}>
              GEI WAU is steady (61–70) but small vs 1,871 enabled; LiRo dips to 33 in the partial week.
            </div>
          </Glass>

          <Glass className="col-span-3 px-5 py-4 flex flex-col">
            <SectionLabel right="5-week window">Login Frequency</SectionLabel>
            <div className="space-y-3">
              {loginBands.map((r) => (
                <div key={r.band}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span style={{ color: "var(--rm-text-muted)" }}>{r.band}</span>
                    <span className="font-bold tabular-nums">{r.liro + r.gei}</span>
                  </div>
                  <div className="flex h-[7px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div style={{ width: `${(r.liro / 79) * 100}%`, background: LIRO, boxShadow: "0 0 6px rgba(107,165,57,0.5)" }} />
                    <div style={{ width: `${(r.gei / 79) * 100}%`, background: GEI }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[10.5px] mt-auto pt-3 leading-relaxed" style={{ color: "var(--rm-text-faint)" }}>
              Of 160 active users in the window; 2,241 enabled users showed no logins at all.
            </div>
          </Glass>
        </div>

        {/* Chart 2 (paired bars): features + least used + transactions */}
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Glass className="col-span-5 px-5 py-4">
            <SectionLabel right="page visits · LiRo vs GEI">Most Used Features</SectionLabel>
            <PairedBars rows={features} max={3472} />
          </Glass>

          <Glass className="col-span-3 px-5 py-4 flex flex-col">
            <SectionLabel right="zeros shown honestly">Least Used Features</SectionLabel>
            <div className="space-y-2">
              {leastUsed.map((m) => (
                <div key={m.name} className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.25)" }}>
                  <span className="text-[11.5px] font-semibold" style={{ color: "var(--rm-text-muted)" }}>{m.name}</span>
                  <span className="text-[11px] tabular-nums">
                    <span className="font-bold" style={{ color: m.liro === 0 ? "var(--rm-ink-red)" : "var(--rm-text)" }}>LiRo {m.liro}</span>
                    <span style={{ color: "var(--rm-text-faint)" }}> · </span>
                    <span className="font-bold" style={{ color: m.gei === 0 ? "var(--rm-ink-red)" : "var(--rm-text)" }}>GEI {m.gei}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="text-[10.5px] mt-3 leading-relaxed" style={{ color: "var(--rm-text-faint)" }}>
              Opportunity and PMM have zero LiRo usage in the window — candidates for enablement or retirement.
            </div>
          </Glass>

          <Glass className="col-span-4 px-5 py-4">
            <SectionLabel right="human-initiated · LiRo vs GEI">Transactions by Type</SectionLabel>
            <PairedBars rows={txByType.map((t) => ({ name: t.type, liro: t.liro, gei: t.gei }))} max={5271} />
          </Glass>
        </div>

        {/* Row 3: human vs system + portfolio status + training */}
        <div className="grid grid-cols-12 gap-4 mb-4">
          <Glass className="col-span-4 px-5 py-4 flex flex-col">
            <SectionLabel right="all recorded events">Human vs System / Automated</SectionLabel>
            {[
              { tenant: "LiRo", human: 17015, system: 937, note: "937 system · 17,015 human" },
              { tenant: "GEI", human: 8021, system: 8021, note: "8,021 system · ~8,021 human" },
            ].map((r, i) => {
              const total = r.human + r.system;
              const humanPct = Math.round((r.human / total) * 100);
              return (
                <div key={r.tenant} className="mb-3">
                  <div className="flex justify-between text-[11.5px] mb-1">
                    <b>{r.tenant}</b>
                    <span style={{ color: "var(--rm-text-muted)" }}>
                      {r.note} · <b style={{ color: humanPct > 80 ? "var(--rm-green-ink)" : "var(--rm-ink-orange)" }}>{humanPct}% human</b>
                    </span>
                  </div>
                  <div className="flex h-[10px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div style={{ width: `${humanPct}%`, background: i === 0 ? LIRO : GEI, boxShadow: `0 0 8px ${i === 0 ? "rgba(107,165,57,0.5)" : "rgba(56,189,248,0.5)"}` }} />
                    <div style={{ width: `${100 - humanPct}%`, background: "var(--rm-ink-violet)" }} />
                  </div>
                </div>
              );
            })}
            <div className="mt-auto rounded-lg px-3 py-2 text-[11.5px] leading-relaxed" style={{ background: "rgba(251,146,60,0.10)", border: "1px solid rgba(251,146,60,0.35)", color: "var(--rm-text-muted)" }}>
              <b style={{ color: "var(--rm-ink-orange)" }}>Key insight:</b> Nearly half of GEI activity is automated/system — human adoption is the gap.
            </div>
          </Glass>

          <Glass className="col-span-4 px-5 py-4 flex flex-col">
            <SectionLabel right="10,364 total projects">Portfolio Status by Tenant</SectionLabel>
            <div className="space-y-2.5">
              {portfolio.map((p) => (
                <div key={p.status}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span style={{ color: "var(--rm-text-muted)" }}>{p.status}</span>
                    <span className="tabular-nums">
                      <b style={{ color: p.liro === 0 ? "var(--rm-ink-red)" : LIRO_INK }}>LiRo {fmt(p.liro)}</b>
                      <span style={{ color: "var(--rm-text-faint)" }}> · </span>
                      <b style={{ color: p.gei === 0 ? "var(--rm-ink-red)" : GEI }}>GEI {fmt(p.gei)}</b>
                    </span>
                  </div>
                  <div className="flex flex-col gap-[3px]">
                    <div className="h-[6px] rounded-full" style={{ background: "rgba(255,255,255,0.07)" }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max((p.liro / 8469) * 100, p.liro > 0 ? 1.5 : 0)}%`, background: LIRO, boxShadow: p.liro > 0 ? "0 0 6px rgba(107,165,57,0.5)" : "none" }} />
                    </div>
                    <div className="h-[6px] rounded-full" style={{ background: "rgba(255,255,255,0.07)" }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max((p.gei / 8469) * 100, p.gei > 0 ? 1.5 : 0)}%`, background: GEI, boxShadow: p.gei > 0 ? "0 0 6px rgba(56,189,248,0.5)" : "none" }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-1 text-[10.5px] mt-3 tabular-nums" style={{ color: "var(--rm-text-muted)" }}>
              <div>LiRo: Active 623 · Closed 71 · Not Set 110</div>
              <div>GEI: Active 0 · Closed 1,091 · Not Set 8,469</div>
            </div>
            <div className="mt-auto rounded-lg px-3 py-2 text-[11.5px] leading-relaxed" style={{ background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--rm-text-muted)" }}>
              <b style={{ color: "var(--rm-ink-red)" }}>Data-quality signal:</b> GEI has 8,469 projects with no status set — 89% of its portfolio.
            </div>
          </Glass>

          <Glass className="col-span-4 px-5 py-4">
            <SectionLabel right="from observed 5-week window">Needs Onboarding Attention</SectionLabel>
            <div className="flex flex-col gap-2.5">
              {training.map((t) => (
                <div key={t.detail} className="rounded-xl px-3 py-2.5" style={{ background: "rgba(15,25,34,0.5)", border: "1px solid rgba(255,255,255,0.09)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <b className="text-[11.5px]">{t.who}</b>
                    <span className="text-[9.5px] font-bold uppercase px-2 py-px rounded-full" style={{
                      letterSpacing: "0.05em",
                      color: t.sev === "high" ? "var(--rm-ink-red)" : "var(--rm-ink-orange)",
                      background: t.sev === "high" ? "rgba(248,113,113,0.12)" : "rgba(251,146,60,0.12)",
                      border: t.sev === "high" ? "1px solid rgba(248,113,113,0.35)" : "1px solid rgba(251,146,60,0.35)",
                    }}>{t.sev}</span>
                  </div>
                  <div className="text-[11px] leading-relaxed" style={{ color: "var(--rm-text-muted)" }}>{t.detail}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--rm-text-faint)" }}>{t.signal}</div>
                </div>
              ))}
            </div>
          </Glass>
        </div>

        {/* Phase 2 teaser strip */}
        <div className="flex items-center gap-4 flex-wrap rounded-xl px-4 py-3" style={{
          border: "1px dashed rgba(107,165,57,0.5)",
          background: "linear-gradient(160deg, rgba(107,165,57,0.10), rgba(30,46,60,0.5))",
        }}>
          <span className="text-[10px] font-bold uppercase px-2.5 py-1 rounded-full whitespace-nowrap" style={{
            letterSpacing: "0.08em", color: "var(--rm-green-ink)",
            background: "var(--rm-green-soft)", border: "1px solid rgba(107,165,57,0.4)",
          }}>Usage → Outcomes · Phase 2</span>
          <div className="text-[12px] flex-1 leading-relaxed" style={{ color: "var(--rm-text-muted)", minWidth: 320 }}>
            Correlate usage with operational results: <b style={{ color: "var(--rm-text)" }}>allocation edits → faster staffing</b>,{" "}
            <b style={{ color: "var(--rm-text)" }}>Gantt views → fewer status meetings</b>,{" "}
            <b style={{ color: "var(--rm-text)" }}>status hygiene → cleaner portfolio data</b>. Requires 2+ quarters of usage history.
          </div>
          <span className="text-[10.5px] whitespace-nowrap" style={{ color: "var(--rm-text-faint)" }}>Design placeholder — not yet measured</span>
        </div>
      </div>
    </div>
  );
}
