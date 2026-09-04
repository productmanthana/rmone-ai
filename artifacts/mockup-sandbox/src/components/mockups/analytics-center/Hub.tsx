import "./_group.css";
import {
  Briefcase,
  DollarSign,
  FolderKanban,
  Users,
  Layers,
  Gauge as GaugeIcon,
  Armchair,
  UserSearch,
  Activity,
  Lock,
  ShieldCheck,
  ChevronRight,
  Building2,
} from "lucide-react";

/* ---------------------------------- data ---------------------------------- */

const staffBars = [
  { d: "Eng", v: 412 }, { d: "CM", v: 388 }, { d: "Env", v: 176 },
  { d: "Arch", v: 121 }, { d: "Ops", v: 94 }, { d: "Corp", v: 87 },
];

const utilBars = [
  { d: "Eng", v: 88 }, { d: "CM", v: 92 }, { d: "Env", v: 79 },
  { d: "Arch", v: 84 }, { d: "Ops", v: 71 }, { d: "Corp", v: 63 },
];

const benchTrend = [
  { w: "W14", v: 52 }, { w: "W15", v: 49 }, { w: "W16", v: 46 },
  { w: "W17", v: 44 }, { w: "W18", v: 41 }, { w: "W19", v: 38 },
];

const openPie = [
  { name: "Engineers", value: 24, color: "#8EC94A" },
  { name: "PM/CM", value: 17, color: "#6B99BB" },
  { name: "Inspectors", value: 12, color: "#F0A842" },
  { name: "Other", value: 9, color: "#C4D44A" },
];

const usageTrend = [
  { w: "W14", v: 96 }, { w: "W15", v: 103 }, { w: "W16", v: 109 },
  { w: "W17", v: 112 }, { w: "W18", v: 118 }, { w: "W19", v: 121 },
];

const execTrend = [
  { m: "Nov", v: 128 }, { m: "Dec", v: 131 }, { m: "Jan", v: 135 },
  { m: "Feb", v: 139 }, { m: "Mar", v: 142 }, { m: "Apr", v: 148 },
];

const finTrend = [
  { m: "Nov", v: 10.9 }, { m: "Dec", v: 11.4 }, { m: "Jan", v: 11.8 },
  { m: "Feb", v: 12.1 }, { m: "Mar", v: 12.6 }, { m: "Apr", v: 12.9 },
];

const projBars = [
  { s: "Plan", v: 34 }, { s: "Active", v: 118 }, { s: "Close", v: 22 },
  { s: "Hold", v: 9 }, { s: "Done", v: 61 },
];

const resTrend = [
  { w: "W14", v: 41.2 }, { w: "W15", v: 42.8 }, { w: "W16", v: 43.1 },
  { w: "W17", v: 44.6 }, { w: "W18", v: 43.9 }, { w: "W19", v: 45.3 },
];

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

function DeltaChip({ text, tone = "good" }: { text: string; tone?: "good" | "warn" | "bad" }) {
  const c = tone === "good" ? "var(--rm-health-good)" : tone === "warn" ? "var(--rm-health-warn)" : "var(--rm-health-bad)";
  const bg = tone === "good" ? "rgba(132,204,22,0.12)" : tone === "warn" ? "rgba(251,146,60,0.12)" : "rgba(248,113,113,0.12)";
  const bd = tone === "good" ? "rgba(132,204,22,0.3)" : tone === "warn" ? "rgba(251,146,60,0.3)" : "rgba(248,113,113,0.3)";
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-md text-[10px] font-semibold tabular-nums whitespace-nowrap"
      style={{ color: c, background: bg, border: `1px solid ${bd}` }}
    >
      <svg width="7" height="7" viewBox="0 0 8 8">{tone === "good"
        ? <path d="M4 0 L8 8 L0 8 Z" fill={c} />
        : <path d="M4 8 L0 0 L8 0 Z" fill={c} />}</svg>
      {text}
    </span>
  );
}

/* Inline SVG spark (no charts on this page — micro-treatment only) */
function Spark({ points, color = "#8EC94A", w = 96, h = 30 }: { points: number[]; color?: string; w?: number; h?: number }) {
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const coords = points.map((p, i) => [i * step, h - 3 - ((p - min) / span) * (h - 8)] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L ${w} ${h} L 0 ${h} Z`;
  const gid = `sp-${color.replace(/\W/g, "")}-${points[0]}`;
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.4} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.8} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r={2.6} fill="#fff" style={{ filter: "drop-shadow(0 0 4px rgba(255,255,255,0.9))" }} />
    </svg>
  );
}

/* Mini radial arc gauge (inline SVG) */
function MiniGauge({ pct, color = "var(--rm-green)", size = 62, label }: { pct: number; color?: string; size?: number; label: string }) {
  const r = size / 2 - 7;
  const cx = size / 2, cy = size / 2;
  const start = 135, sweep = 270;
  const a0 = (start * Math.PI) / 180;
  const a1 = ((start + sweep) * Math.PI) / 180;
  const av = ((start + (sweep * pct) / 100) * Math.PI) / 180;
  const pt = (ang: number) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  const [sx, sy] = pt(a0); const [ex, ey] = pt(a1); const [tx, ty] = pt(av);
  const largeVal = (sweep * pct) / 100 > 180 ? 1 : 0;
  return (
    <svg width={size} height={size} style={{ overflow: "visible" }}>
      <path d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={5} strokeLinecap="round" />
      <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${largeVal} 1 ${tx} ${ty}`} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
        style={{ filter: "drop-shadow(0 0 5px rgba(107,165,57,0.7))" }} />
      <circle cx={tx} cy={ty} r={3.2} fill="#fff" style={{ filter: "drop-shadow(0 0 4px rgba(255,255,255,0.9))" }} />
      <text x={cx} y={cy + 4} textAnchor="middle" fill="#fff" fontSize={12} fontWeight={800} style={{ fontVariantNumeric: "tabular-nums" }}>{label}</text>
    </svg>
  );
}

function Tile({
  icon: Icon,
  title,
  badge,
  badgeIcon: BadgeIcon,
  hero,
  heroUnit,
  takeaway,
  sub,
  delta,
  deltaTone = "good",
  children,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  badge?: string;
  badgeIcon?: React.ComponentType<{ size?: number }>;
  hero: string;
  heroUnit?: string;
  takeaway: string;
  sub: string;
  delta?: string;
  deltaTone?: "good" | "warn" | "bad";
  children?: React.ReactNode;
}) {
  return (
    <Glass className="group flex flex-col p-5 cursor-pointer">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ background: "var(--rm-green-soft)", boxShadow: "0 0 14px rgba(107,165,57,0.25)" }}>
            <Icon size={16} style={{ color: "var(--rm-green-ink)" }} />
          </div>
          <div className="text-[13px] font-bold tracking-wide">{title}</div>
        </div>
        <div className="flex items-center gap-2">
          {badge && (
            <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ background: "rgba(255,255,255,0.07)", color: "var(--rm-text-muted)", border: "1px solid var(--rm-panel-border)" }}>
              {BadgeIcon && <BadgeIcon size={10} />}
              {badge}
            </span>
          )}
          <ChevronRight size={15} className="opacity-30 transition-opacity group-hover:opacity-80" />
        </div>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-[32px] font-extrabold leading-none tracking-tight tabular-nums"
          style={{ textShadow: "0 0 26px rgba(107,165,57,0.35)" }}>
          {hero}
        </span>
        {heroUnit && <span className="text-[12px] font-medium" style={{ color: "var(--rm-text-muted)" }}>{heroUnit}</span>}
        {delta && <span className="ml-auto"><DeltaChip text={delta} tone={deltaTone} /></span>}
      </div>
      <div className="mt-1.5 text-[11.5px] font-medium leading-snug" style={{ color: "rgba(255,255,255,0.78)" }}>
        {takeaway}
      </div>
      <div className="mt-0.5 text-[10.5px]" style={{ color: "var(--rm-text-faint)" }}>{sub}</div>

      {children && <div className="mt-3">{children}</div>}
    </Glass>
  );
}

/* Ranked mini list with inline bars */
function MiniBars({ rows, max, color = "#6B99BB", suffix = "" }: { rows: { label: string; v: number }[]; max: number; color?: string; suffix?: string }) {
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-[10px]">
          <span className="w-9 shrink-0" style={{ color: "var(--rm-text-faint)" }}>{r.label}</span>
          <div className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
            <div className="h-full rounded-full" style={{ width: `${(r.v / max) * 100}%`, background: `linear-gradient(90deg, ${color}66, ${color})` }} />
          </div>
          <span className="w-8 text-right font-bold tabular-nums" style={{ color: "rgba(255,255,255,0.8)" }}>{r.v}{suffix}</span>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------- page ---------------------------------- */

export default function Hub() {
  const ticker = [
    { label: "Backlog", val: "$148.2M", tone: "good" as const },
    { label: "Active Projects", val: "118", tone: "good" as const },
    { label: "Staff Deployed", val: "1,278", tone: "good" as const },
    { label: "Utilization", val: "84.6%", tone: "warn" as const },
    { label: "Bench", val: "38", tone: "good" as const },
    { label: "Open Positions", val: "62", tone: "bad" as const },
    { label: "Adoption", val: "6.7%", tone: "warn" as const },
    { label: "Conflicts", val: "14", tone: "warn" as const },
  ];
  const arrow = (tone: "good" | "warn" | "bad") => {
    const c = tone === "good" ? "var(--rm-health-good)" : tone === "warn" ? "var(--rm-health-warn)" : "var(--rm-health-bad)";
    return (
      <svg width="7" height="7" viewBox="0 0 8 8" className="inline-block">
        {tone === "good" ? <path d="M4 0 L8 8 L0 8 Z" fill={c} /> : <path d="M4 8 L0 0 L8 0 Z" fill={c} />}
      </svg>
    );
  };

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

      <div className="relative mx-auto max-w-[1400px] px-8 py-6">
        {/* Header */}
        <div className="flex items-end justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[14px] font-extrabold"
              style={{ background: "linear-gradient(140deg, #8EC94A, #6BA539)", color: "#16240a", boxShadow: "0 0 24px rgba(107,165,57,0.5)" }}>RM</div>
            <div>
              <div className="text-[10px] font-semibold uppercase" style={{ letterSpacing: "0.18em", color: "var(--rm-text-faint)" }}>
                RM ONE · Operational Intelligence
              </div>
              <h1 className="mt-0.5 text-[26px] font-extrabold tracking-tight leading-tight">Analytics Center</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full font-medium"
              style={{ background: "var(--rm-green-soft)", color: "var(--rm-green-ink)", border: "1px solid rgba(107,165,57,0.4)" }}>
              <Building2 size={12} /> LiRo <span style={{ color: "var(--rm-text-faint)" }}>· superadmin can switch to GEI</span>
            </span>
            <span className="px-2.5 py-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--rm-panel-border)", color: "var(--rm-text-muted)" }}>
              Trailing 12 months · refreshed 8 min ago
            </span>
            <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full font-medium"
              style={{ background: "rgba(132,204,22,0.1)", border: "1px solid rgba(132,204,22,0.3)", color: "var(--rm-health-good)" }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--rm-health-good)", boxShadow: "0 0 6px rgba(132,204,22,0.9)" }} />LIVE
            </span>
          </div>
        </div>

        {/* Status ticker */}
        <div className="mt-4 rounded-xl overflow-hidden flex items-center" style={{ background: "rgba(15,25,34,0.55)", border: "1px solid rgba(255,255,255,0.09)" }}>
          <div className="px-3 py-1.5 text-[9px] font-bold uppercase shrink-0"
            style={{ letterSpacing: "0.16em", color: "#16240a", background: "linear-gradient(140deg, #8EC94A, #6BA539)" }}>Firm Status</div>
          <div className="flex items-center gap-6 px-4 py-1.5 overflow-hidden whitespace-nowrap">
            {ticker.map((t) => (
              <span key={t.label} className="flex items-center gap-1.5 text-[11px] shrink-0">
                <span style={{ color: "var(--rm-text-faint)" }}>{t.label}</span>
                <span className="font-bold tabular-nums" style={{ color: "#fff" }}>{t.val}</span>
                {arrow(t.tone)}
              </span>
            ))}
          </div>
        </div>

        {/* Headline stat band */}
        <Glass className="mt-4 px-7 py-5 flex items-center justify-between overflow-hidden">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.18em", color: "var(--rm-green-ink)" }}>Signed Work In The Bank</span>
              <DeltaChip text="+4.2% MoM" />
            </div>
            <div className="flex items-baseline gap-4 mt-1">
              <span className="font-extrabold tabular-nums leading-none" style={{
                fontSize: 64, letterSpacing: "-0.03em",
                background: "linear-gradient(180deg, #FFFFFF 30%, #A8D672 100%)",
                WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
                filter: "drop-shadow(0 0 28px rgba(107,165,57,0.35))",
              }}>$148.2M</span>
              <div className="text-[11.5px] leading-snug" style={{ color: "var(--rm-text-muted)" }}>
                total value of approved contracts.<br />Enough signed work to keep the whole firm busy for months.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-8 pr-2">
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase" style={{ letterSpacing: "0.14em", color: "var(--rm-text-faint)" }}>6-month climb</div>
              <div className="mt-1"><Spark points={execTrend.map((d) => d.v)} w={150} h={44} /></div>
              <div className="text-[9.5px] mt-1 tabular-nums" style={{ color: "var(--rm-text-faint)" }}>Nov $128M → Apr $148M</div>
            </div>
            <div className="hidden xl:block h-16 w-px" style={{ background: "rgba(255,255,255,0.1)" }} />
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase" style={{ letterSpacing: "0.14em", color: "var(--rm-text-faint)" }}>Nine live dashboards</div>
              <div className="text-[13px] mt-1 font-medium" style={{ color: "rgba(255,255,255,0.75)" }}>Everything about the firm, one glance.</div>
              <div className="text-[10px] mt-0.5" style={{ color: "var(--rm-text-faint)" }}>Updated hourly · pick a tile below</div>
            </div>
          </div>
        </Glass>

        {/* Tile grid — each tile a different micro-treatment */}
        <div className="mt-5 grid grid-cols-3 gap-5">
          {/* Executive — glowing spark */}
          <Tile icon={Briefcase} title="Executive" hero="$148.2M" delta="+4.2% MoM"
            takeaway="The order book keeps growing — six straight months up."
            sub="Backlog · 118 active projects · 1,278 staff deployed">
            <div className="flex items-end justify-between">
              <Spark points={execTrend.map((d) => d.v)} w={190} h={44} />
              <div className="text-right text-[9.5px] tabular-nums" style={{ color: "var(--rm-text-faint)" }}>Nov → Apr</div>
            </div>
          </Tile>

          {/* Financial — big paired numbers, no visual */}
          <Tile icon={DollarSign} title="Financial" badge="Financial access" badgeIcon={Lock} hero="$96.5M" delta="+2.6% MoM"
            takeaway="87 cents of every contracted labor dollar is already assigned to someone."
            sub={`Contracted labor · monthly run: ${finTrend[0].m} $${finTrend[0].v}M → ${finTrend[finTrend.length - 1].m} $${finTrend[finTrend.length - 1].v}M`}>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="text-[9px] uppercase" style={{ letterSpacing: "0.1em", color: "var(--rm-text-faint)" }}>Allocated</div>
                <div className="text-[18px] font-extrabold tabular-nums" style={{ color: "var(--rm-green-ink)" }}>$84.2M</div>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="text-[9px] uppercase" style={{ letterSpacing: "0.1em", color: "var(--rm-text-faint)" }}>Coverage</div>
                <div className="text-[18px] font-extrabold tabular-nums" style={{ color: "#F0A842" }}>87%</div>
              </div>
            </div>
          </Tile>

          {/* Project — segmented status bar */}
          <Tile icon={FolderKanban} title="Project" hero="244" heroUnit="projects" delta="9 on hold" deltaTone="warn"
            takeaway="Most projects are moving; a dozen are running late."
            sub="118 active · 12 overdue · median cycle 14.3 mo">
            <div>
              <div className="h-[10px] rounded-full overflow-hidden flex" style={{ background: "rgba(255,255,255,0.07)" }}>
                {projBars.map((p, i) => (
                  <div key={p.s} style={{
                    width: `${(p.v / 244) * 100}%`,
                    background: i === 1 ? "#8EC94A" : ["#6B99BB", "", "#C4D44A", "#F0A842", "rgba(255,255,255,0.3)"][i],
                    boxShadow: i === 1 ? "0 0 8px rgba(142,201,74,0.6)" : "none",
                  }} />
                ))}
              </div>
              <div className="flex justify-between mt-1.5 text-[9.5px] tabular-nums" style={{ color: "var(--rm-text-faint)" }}>
                {projBars.map((p) => <span key={p.s}>{p.s} {p.v}</span>)}
              </div>
            </div>
          </Tile>

          {/* Staff — ranked mini bars */}
          <Tile icon={Users} title="Staff" hero="1,278" heroUnit="headcount" delta="+18 net QTD"
            takeaway="Headcount is growing, led by Engineering and Construction."
            sub="6 business units · 41 titles · 92% full-time">
            <MiniBars rows={staffBars.map((s) => ({ label: s.d, v: s.v }))} max={412} color="#6B99BB" />
          </Tile>

          {/* Resource — spark in blue */}
          <Tile icon={Layers} title="Resource" hero="45.3K" heroUnit="hrs/wk allocated" delta="+1.4K WoW"
            takeaway="More hours are being planned onto projects every week."
            sub="1.08M hrs allocated · 87% coverage · 14 conflicts">
            <div className="flex items-end justify-between">
              <Spark points={resTrend.map((d) => d.v)} color="#38BDF8" w={190} h={40} />
              <div className="text-right text-[9.5px] tabular-nums" style={{ color: "var(--rm-text-faint)" }}>W14 → W19</div>
            </div>
          </Tile>

          {/* Utilization — mini gauge + division dots */}
          <Tile icon={GaugeIcon} title="Utilization" hero="84.6%" delta="-0.4 pt vs target" deltaTone="warn"
            takeaway="Just under the 85% target — Ops and Corp have room to give."
            sub="Company-wide vs 85% target · 43 over · 96 under">
            <div className="flex items-center gap-4">
              <MiniGauge pct={84.6} label="84.6" size={64} />
              <div className="flex-1 grid grid-cols-3 gap-x-2 gap-y-1 text-[10px] tabular-nums">
                {utilBars.map((u) => (
                  <span key={u.d} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full"
                      style={{ background: u.v >= 85 ? "#84CC16" : u.v >= 75 ? "#F0A842" : "#F87171" }} />
                    <span style={{ color: "var(--rm-text-faint)" }}>{u.d}</span>
                    <span className="font-bold" style={{ color: "rgba(255,255,255,0.8)" }}>{u.v}%</span>
                  </span>
                ))}
              </div>
            </div>
          </Tile>

          {/* Bench — descending step chips */}
          <Tile icon={Armchair} title="Bench" hero="38" heroUnit="people" delta="-14 in 6 wks"
            takeaway="The bench is shrinking — people are getting placed faster."
            sub="Avg 3.1 wks on bench · 22 roll-offs next 4 wks">
            <div className="flex items-end gap-1.5">
              {benchTrend.map((b, i) => (
                <div key={b.w} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full rounded-t-[4px]" style={{
                    height: 8 + (b.v - 38) * 1.6,
                    background: i === benchTrend.length - 1 ? "linear-gradient(180deg, #A78BFA, rgba(167,139,250,0.4))" : "rgba(167,139,250,0.28)",
                    boxShadow: i === benchTrend.length - 1 ? "0 0 10px rgba(167,139,250,0.5)" : "none",
                  }} />
                  <span className="text-[8.5px] tabular-nums" style={{ color: "var(--rm-text-faint)" }}>{b.v}</span>
                </div>
              ))}
            </div>
          </Tile>

          {/* Open Positions — role count chips */}
          <Tile icon={UserSearch} title="Open Positions & Demand" hero="62" heroUnit="unfilled roles" delta="9 urgent" deltaTone="bad"
            takeaway="62 seats need filling — engineers are the biggest gap."
            sub="118.4K unstaffed hrs · 17 open >60 days">
            <div className="grid grid-cols-2 gap-1.5">
              {openPie.map((e) => (
                <span key={e.name} className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[10px]"
                  style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${e.color}44` }}>
                  <span className="flex items-center gap-1.5" style={{ color: "var(--rm-text-muted)" }}>
                    <span className="h-2 w-2 rounded-sm" style={{ background: e.color, boxShadow: `0 0 5px ${e.color}88` }} />
                    {e.name}
                  </span>
                  <span className="font-extrabold tabular-nums" style={{ color: "#fff" }}>{e.value}</span>
                </span>
              ))}
            </div>
          </Tile>

          {/* Usage — WAU dot trail + delta */}
          <Tile icon={Activity} title="Usage Analytics" badge="Admin" badgeIcon={ShieldCheck} hero="6.7%" heroUnit="adoption" delta="160 of 2,401 active"
            takeaway="Only 160 of 2,401 enabled people use the platform — big onboarding opportunity."
            sub="LiRo 10.0% · GEI 5.7% · 5-week window">
            <div className="flex items-center justify-between">
              {usageTrend.map((u, i) => (
                <div key={u.w} className="flex flex-col items-center gap-1">
                  <span className="rounded-full" style={{
                    width: 8 + i * 1.6, height: 8 + i * 1.6,
                    background: i === usageTrend.length - 1 ? "#8EC94A" : "rgba(142,201,74,0.35)",
                    boxShadow: i === usageTrend.length - 1 ? "0 0 10px rgba(142,201,74,0.7)" : "none",
                  }} />
                  <span className="text-[8.5px] tabular-nums" style={{ color: "var(--rm-text-faint)" }}>{u.v}</span>
                </div>
              ))}
            </div>
          </Tile>
        </div>

        <div className="mt-5 flex items-center justify-between text-[11px]" style={{ color: "var(--rm-text-faint)" }}>
          <span>Data sources: allocations, demand plan, contract registry, platform audit log · Costs shown are planned (allocations × cost rates)</span>
          <span>RM ONE Analytics Center · LiRo tenant · v2.4</span>
        </div>
      </div>
    </div>
  );
}
