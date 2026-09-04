import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Briefcase,
  Calendar,
  Clock,
  Cloud,
  CloudRain,
  DollarSign,
  FileQuestion,
  HardHat,
  Lightbulb,
  Radio,
  ShieldCheck,
  Sun,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";

const C = {
  bg: "#0F1A24",
  bgDeep: "#0A1218",
  panel: "rgba(15, 28, 38, 0.72)",
  green: "#6BA539",
  greenLight: "#A9C23F",
  cyan: "#5FD4C9",
  amber: "#E8B547",
  red: "#F87171",
  text: "#E6F0E8",
  muted: "rgba(193, 215, 200, 0.55)",
  dim: "rgba(193, 215, 200, 0.35)",
  stroke: "rgba(107, 165, 57, 0.35)",
  strokeSoft: "rgba(107, 165, 57, 0.18)",
};

const MONO = "ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace";

function CornerTicks({ color = C.green }: { color?: string }) {
  const s = 10;
  const t = 1.25;
  const style: React.CSSProperties = {
    position: "absolute",
    width: s,
    height: s,
    borderColor: color,
    pointerEvents: "none",
  };
  return (
    <>
      <span style={{ ...style, top: -1, left: -1, borderTop: `${t}px solid ${color}`, borderLeft: `${t}px solid ${color}` }} />
      <span style={{ ...style, top: -1, right: -1, borderTop: `${t}px solid ${color}`, borderRight: `${t}px solid ${color}` }} />
      <span style={{ ...style, bottom: -1, left: -1, borderBottom: `${t}px solid ${color}`, borderLeft: `${t}px solid ${color}` }} />
      <span style={{ ...style, bottom: -1, right: -1, borderBottom: `${t}px solid ${color}`, borderRight: `${t}px solid ${color}` }} />
    </>
  );
}

function Panel({
  title,
  code,
  status,
  children,
  accent = C.green,
}: {
  title: string;
  code: string;
  status?: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <section
      className="hud-panel relative"
      style={{
        background: C.panel,
        border: `1px solid ${C.stroke}`,
        clipPath:
          "polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)",
        boxShadow: `inset 0 0 30px rgba(107,165,57,0.08), inset 0 0 0 1px rgba(107,165,57,0.04)`,
        padding: "14px 16px 16px",
      }}
    >
      <CornerTicks color={accent} />
      <header className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            style={{
              fontFamily: MONO,
              fontSize: 9.5,
              color: accent,
              letterSpacing: "0.18em",
            }}
          >
            {code}
          </span>
          <span style={{ width: 1, height: 10, background: C.strokeSoft }} />
          <h3
            style={{
              fontSize: 11,
              letterSpacing: "0.22em",
              color: C.text,
              fontWeight: 600,
            }}
          >
            {title}
          </h3>
        </div>
        {status && (
          <span
            className="flex items-center gap-1.5"
            style={{ fontFamily: MONO, fontSize: 9.5, color: C.muted, letterSpacing: "0.12em" }}
          >
            <span
              className="hud-dot"
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: accent,
                boxShadow: `0 0 8px ${accent}`,
              }}
            />
            {status}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

function Stat({
  Icon,
  label,
  value,
  delta,
  deltaTone,
  unit,
}: {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  label: string;
  value: string;
  delta: string;
  deltaTone: "up" | "down" | "neutral" | "good";
  unit?: string;
}) {
  const toneColor =
    deltaTone === "up" || deltaTone === "good"
      ? C.greenLight
      : deltaTone === "down"
      ? C.cyan
      : C.muted;
  const TrendIcon =
    deltaTone === "up" ? TrendingUp : deltaTone === "down" ? TrendingDown : Activity;
  return (
    <div
      className="relative"
      style={{
        background: "rgba(7, 14, 20, 0.6)",
        border: `1px solid ${C.strokeSoft}`,
        padding: "12px 12px 14px",
        clipPath: "polygon(8px 0, 100% 0, 100% 100%, 0 100%, 0 8px)",
      }}
    >
      <CornerTicks color={C.strokeSoft} />
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5" style={{ color: C.muted }}>
          <Icon size={12} strokeWidth={1.6} />
          <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.16em" }}>
            {label}
          </span>
        </div>
        <span style={{ fontFamily: MONO, fontSize: 8.5, color: C.dim }}>NOMINAL</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          style={{
            fontFamily: MONO,
            fontSize: 30,
            fontWeight: 500,
            color: C.text,
            lineHeight: 1,
            textShadow: `0 0 18px rgba(169,194,63,0.18)`,
          }}
        >
          {value}
        </span>
        {unit && (
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>{unit}</span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-1" style={{ color: toneColor }}>
        <TrendIcon size={11} strokeWidth={1.8} />
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.04em" }}>
          {delta}
        </span>
      </div>
    </div>
  );
}

function PriorityRow({
  level,
  title,
  project,
  due,
  code,
}: {
  level: "HIGH" | "MED";
  title: string;
  project: string;
  due: string;
  code: string;
}) {
  const color = level === "HIGH" ? C.red : C.amber;
  return (
    <div
      className="relative grid items-center gap-3 py-2.5 px-3"
      style={{
        gridTemplateColumns: "auto 1fr auto",
        borderTop: `1px dashed ${C.strokeSoft}`,
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          style={{
            width: 3,
            height: 28,
            background: color,
            boxShadow: `0 0 10px ${color}`,
          }}
        />
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9.5,
            color,
            letterSpacing: "0.14em",
            border: `1px solid ${color}55`,
            padding: "2px 6px",
            background: `${color}12`,
          }}
        >
          {level}
        </span>
      </div>
      <div className="min-w-0">
        <div
          style={{
            color: C.text,
            fontSize: 13.5,
            fontWeight: 500,
            letterSpacing: "0.01em",
          }}
          className="truncate"
        >
          {title}
        </div>
        <div
          className="flex items-center gap-2 mt-0.5"
          style={{ fontFamily: MONO, fontSize: 10, color: C.muted, letterSpacing: "0.06em" }}
        >
          <span>{code}</span>
          <span style={{ color: C.dim }}>·</span>
          <span>{project}</span>
        </div>
      </div>
      <div
        className="text-right"
        style={{ fontFamily: MONO, fontSize: 10.5, color: C.cyan, letterSpacing: "0.08em" }}
      >
        {due}
      </div>
    </div>
  );
}

function ScheduleRow({
  time,
  title,
  project,
  Icon,
}: {
  time: string;
  title: string;
  project: string;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
}) {
  return (
    <div
      className="grid items-center gap-3 py-2 px-1"
      style={{ gridTemplateColumns: "70px 22px 1fr" }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 13,
          color: C.greenLight,
          letterSpacing: "0.06em",
        }}
      >
        {time}
      </span>
      <span
        style={{
          width: 22,
          height: 22,
          border: `1px solid ${C.strokeSoft}`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: C.cyan,
        }}
      >
        <Icon size={12} strokeWidth={1.6} />
      </span>
      <div className="min-w-0">
        <div style={{ color: C.text, fontSize: 13, fontWeight: 500 }} className="truncate">
          {title}
        </div>
        <div
          style={{ fontFamily: MONO, fontSize: 10, color: C.muted, letterSpacing: "0.06em" }}
        >
          {project}
        </div>
      </div>
    </div>
  );
}

function WeatherCell({
  day,
  temp,
  Icon,
  highlight,
}: {
  day: string;
  temp: number;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  highlight?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center justify-between py-2.5 px-1"
      style={{
        background: "rgba(7, 14, 20, 0.55)",
        border: `1px solid ${highlight ? C.stroke : C.strokeSoft}`,
        clipPath: "polygon(6px 0, 100% 0, 100% 100%, 0 100%, 0 6px)",
        minHeight: 76,
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 9.5,
          color: highlight ? C.greenLight : C.muted,
          letterSpacing: "0.16em",
        }}
      >
        {day}
      </span>
      <Icon size={18} strokeWidth={1.6} color={highlight ? C.greenLight : C.cyan} />
      <span
        style={{
          fontFamily: MONO,
          fontSize: 13,
          color: C.text,
          fontWeight: 500,
        }}
      >
        {temp}°
      </span>
    </div>
  );
}

function GutterTicks({ side }: { side: "left" | "right" }) {
  const items = Array.from({ length: 14 });
  return (
    <div
      className="hidden lg:flex flex-col items-center gap-2 absolute top-24"
      style={{
        [side]: 8,
        bottom: 12,
        width: 56,
        fontFamily: MONO,
        fontSize: 8.5,
        color: C.dim,
        letterSpacing: "0.12em",
      }}
    >
      {items.map((_, i) => {
        const v = (1024 + i * 37) % 999;
        const tag = side === "left" ? `T-${String(i).padStart(2, "0")}` : `Σ${String(v).padStart(3, "0")}`;
        return (
          <div key={i} className="flex items-center gap-1.5 w-full">
            {side === "left" && (
              <span style={{ width: 6, height: 1, background: C.strokeSoft }} />
            )}
            <span style={{ flex: 1, textAlign: side === "left" ? "left" : "right" }}>
              {tag}
            </span>
            {side === "right" && (
              <span style={{ width: 6, height: 1, background: C.strokeSoft }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function CockpitHUD() {
  return (
    <div
      className="min-h-screen w-full relative"
      style={{
        background: C.bg,
        color: C.text,
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <style>{`
        @keyframes hud-sweep {
          0% { transform: translateY(-30%); }
          100% { transform: translateY(130%); }
        }
        @keyframes hud-blink {
          0%, 60% { opacity: 1; }
          70%, 100% { opacity: 0.35; }
        }
        @keyframes hud-pulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
        .hud-sweep {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(180deg, transparent 0%, rgba(107,165,57,0.06) 50%, transparent 100%);
          height: 40%;
          animation: hud-sweep 9s linear infinite;
          mix-blend-mode: screen;
        }
        .hud-dot { animation: hud-pulse 2.6s ease-in-out infinite; }
        .hud-blink { animation: hud-blink 1.6s steps(2, end) infinite; }
        @media (prefers-reduced-motion: reduce) {
          .hud-sweep, .hud-dot, .hud-blink { animation: none !important; }
        }
      `}</style>

      {/* Layer 1: radial vignette */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 50% -10%, rgba(107,165,57,0.10), transparent 60%), radial-gradient(ellipse at 50% 120%, rgba(95,212,201,0.06), transparent 55%), linear-gradient(180deg, ${C.bg} 0%, ${C.bgDeep} 100%)`,
        }}
      />

      {/* Layer 2: HUD grid */}
      <svg
        aria-hidden
        className="absolute inset-0 pointer-events-none w-full h-full"
        style={{ opacity: 0.55 }}
      >
        <defs>
          <pattern id="hud-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path
              d="M 48 0 L 0 0 0 48"
              fill="none"
              stroke="rgba(107,165,57,0.07)"
              strokeWidth="0.5"
            />
          </pattern>
          <pattern id="hud-grid-fine" width="12" height="12" patternUnits="userSpaceOnUse">
            <path
              d="M 12 0 L 0 0 0 12"
              fill="none"
              stroke="rgba(107,165,57,0.035)"
              strokeWidth="0.4"
            />
          </pattern>
          <pattern id="hud-scan" width="3" height="3" patternUnits="userSpaceOnUse">
            <rect width="3" height="1" fill="rgba(255,255,255,0.012)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hud-grid-fine)" />
        <rect width="100%" height="100%" fill="url(#hud-grid)" />
        <rect width="100%" height="100%" fill="url(#hud-scan)" />
      </svg>

      {/* Layer 3: crosshair lines */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(to right, transparent 49.95%, rgba(107,165,57,0.06) 50%, transparent 50.05%), linear-gradient(to bottom, transparent calc(72px - 0.5px), rgba(107,165,57,0.10) 72px, transparent calc(72px + 0.5px))`,
        }}
      />

      {/* Layer 4: scanline sweep */}
      <div className="hud-sweep" />

      {/* Gutter telemetry */}
      <GutterTicks side="left" />
      <GutterTicks side="right" />

      {/* Content */}
      <div className="relative mx-auto px-5 py-7" style={{ maxWidth: 1060 }}>
        {/* HUD top bar */}
        <div
          className="flex items-center justify-between mb-5"
          style={{
            fontFamily: MONO,
            fontSize: 9.5,
            color: C.muted,
            letterSpacing: "0.22em",
            borderBottom: `1px solid ${C.strokeSoft}`,
            paddingBottom: 8,
          }}
        >
          <div className="flex items-center gap-3">
            <span style={{ color: C.greenLight }}>● LINK</span>
            <span>UPLINK 24.6 KB/S</span>
            <span className="hud-blink">SYNC OK</span>
          </div>
          <div className="flex items-center gap-3">
            <span>FRAME 04812</span>
            <span>LAT 34.05N · LON 118.24W</span>
            <span style={{ color: C.cyan }}>STATUS · NOMINAL</span>
          </div>
        </div>

        {/* Header */}
        <header className="flex items-end justify-between gap-6 mb-7">
          <div>
            <div
              className="flex items-center gap-2.5 mb-2"
              style={{ fontFamily: MONO, letterSpacing: "0.22em", fontSize: 10, color: C.muted }}
            >
              <span
                style={{
                  color: C.greenLight,
                  fontWeight: 700,
                  border: `1px solid ${C.stroke}`,
                  padding: "2px 6px",
                  background: "rgba(107,165,57,0.06)",
                }}
              >
                RMONE
              </span>
              <span style={{ color: C.dim }}>//</span>
              <span>DAILY BRIEFING · OPS-01</span>
            </div>
            <h1
              style={{
                fontSize: 36,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: C.text,
                lineHeight: 1.05,
                textShadow: `0 0 24px rgba(107,165,57,0.12)`,
              }}
            >
              Good morning, <span style={{ color: C.greenLight }}>Marcus</span>
            </h1>
            <div
              className="mt-2 flex items-center gap-3"
              style={{ fontFamily: MONO, fontSize: 11, color: C.muted, letterSpacing: "0.10em" }}
            >
              <Clock size={12} strokeWidth={1.6} />
              <span>MONDAY · MAY 11, 2026</span>
              <span style={{ color: C.dim }}>·</span>
              <span style={{ color: C.cyan }}>06:42 PT</span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <span
              className="flex items-center gap-1.5"
              style={{
                fontFamily: MONO,
                fontSize: 10,
                color: C.greenLight,
                letterSpacing: "0.12em",
                border: `1px solid ${C.stroke}`,
                background: "rgba(107,165,57,0.06)",
                padding: "5px 9px",
              }}
            >
              <Briefcase size={12} strokeWidth={1.7} />
              12 ACTIVE PROJECTS
            </span>
            <span
              className="flex items-center gap-1.5"
              style={{
                fontFamily: MONO,
                fontSize: 10,
                color: C.amber,
                letterSpacing: "0.12em",
                border: `1px solid ${C.amber}55`,
                background: `${C.amber}10`,
                padding: "5px 9px",
              }}
            >
              <AlertTriangle size={12} strokeWidth={1.7} />
              3 ALERTS
            </span>
          </div>
        </header>

        {/* Section 1: Snapshot */}
        <div className="mb-5">
          <Panel title="TODAY'S SNAPSHOT" code="SEC-01" status="LIVE">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat
                Icon={Briefcase}
                label="ACTIVE PROJECTS"
                value="12"
                delta="+2 vs last week"
                deltaTone="up"
              />
              <Stat
                Icon={FileQuestion}
                label="OPEN RFIs"
                value="7"
                delta="-3 today"
                deltaTone="down"
              />
              <Stat
                Icon={ShieldCheck}
                label="SAFETY INCIDENTS"
                value="0"
                delta="14 days clean"
                deltaTone="good"
              />
              <Stat
                Icon={DollarSign}
                label="BUDGET VARIANCE"
                value="-2.4"
                unit="%"
                delta="favorable"
                deltaTone="good"
              />
            </div>
          </Panel>
        </div>

        {/* Two-column: priorities + schedule */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 mb-5">
          <div className="lg:col-span-3">
            <Panel title="PRIORITY ITEMS" code="SEC-02" status="3 OPEN" accent={C.amber}>
              <div className="-mx-1">
                <PriorityRow
                  level="HIGH"
                  code="PRI-001"
                  title="Tower B — concrete pour delayed"
                  project="Riverside Towers"
                  due="DUE TODAY"
                />
                <PriorityRow
                  level="MED"
                  code="PRI-002"
                  title="RFI #248 awaiting response"
                  project="Atrium West"
                  due="DUE +1D"
                />
                <PriorityRow
                  level="MED"
                  code="PRI-003"
                  title="Safety walk overdue — Site C"
                  project="Lakeside Logistics"
                  due="-2D OVERDUE"
                />
              </div>
            </Panel>
          </div>
          <div className="lg:col-span-2">
            <Panel title="TODAY'S SCHEDULE" code="SEC-03" status="04 EVT">
              <div className="divide-y" style={{ borderColor: C.strokeSoft }}>
                <ScheduleRow
                  time="09:00"
                  title="OAC meeting"
                  project="Riverside Towers"
                  Icon={Users}
                />
                <ScheduleRow
                  time="11:30"
                  title="Concrete sub walkthrough"
                  project="Atrium West"
                  Icon={HardHat}
                />
                <ScheduleRow
                  time="14:00"
                  title="Owner update call"
                  project="Lakeside Logistics"
                  Icon={Radio}
                />
                <ScheduleRow
                  time="16:30"
                  title="Weekly safety review"
                  project="All sites"
                  Icon={ShieldCheck}
                />
              </div>
            </Panel>
          </div>
        </div>

        {/* Section 4: Forecast */}
        <Panel title="7-DAY FORECAST" code="SEC-04" status="WX FEED" accent={C.cyan}>
          <div className="grid grid-cols-7 gap-2">
            <WeatherCell day="MON" temp={68} Icon={Sun} highlight />
            <WeatherCell day="TUE" temp={71} Icon={Sun} />
            <WeatherCell day="WED" temp={65} Icon={CloudRain} />
            <WeatherCell day="THU" temp={60} Icon={CloudRain} />
            <WeatherCell day="FRI" temp={72} Icon={Cloud} />
            <WeatherCell day="SAT" temp={78} Icon={Sun} />
            <WeatherCell day="SUN" temp={80} Icon={Sun} />
          </div>
        </Panel>

        {/* Footer telemetry */}
        <div
          className="mt-6 pt-3 flex items-center justify-between"
          style={{
            fontFamily: MONO,
            fontSize: 9.5,
            color: C.dim,
            letterSpacing: "0.18em",
            borderTop: `1px solid ${C.strokeSoft}`,
          }}
        >
          <div className="flex items-center gap-3">
            <Target size={11} strokeWidth={1.6} />
            <span>OPS-01 · CHANNEL A · v2.04.1</span>
          </div>
          <div>END OF FRAME ▮</div>
        </div>
      </div>
    </div>
  );
}

export default CockpitHUD;
