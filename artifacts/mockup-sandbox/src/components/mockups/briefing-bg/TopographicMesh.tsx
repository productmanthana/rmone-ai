import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bell,
  Briefcase,
  Calendar,
  Clock,
  Cloud,
  CloudRain,
  DollarSign,
  FileText,
  HardHat,
  MapPin,
  Shield,
  Sparkles,
  Sun,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

const BRAND = {
  bg: "#1B2B38",
  bgDeeper: "#0F1A24",
  green: "#6BA539",
  greenLight: "#A9C23F",
  slate: "#1B2B38",
  slateRaised: "#22384A",
  border: "rgba(169,194,63,0.18)",
  innerHi: "rgba(169,194,63,0.35)",
  text: "#E7EEF2",
  muted: "rgba(231,238,242,0.6)",
  dim: "rgba(231,238,242,0.4)",
};

function CornerTick({
  pos,
  label,
}: {
  pos: "tl" | "tr" | "bl" | "br";
  label: string;
}) {
  const base: React.CSSProperties = {
    position: "absolute",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 9,
    letterSpacing: "0.14em",
    color: "rgba(169,194,63,0.55)",
    pointerEvents: "none",
  };
  const map: Record<string, React.CSSProperties> = {
    tl: { top: 10, left: 12 },
    tr: { top: 10, right: 12 },
    bl: { bottom: 10, left: 12 },
    br: { bottom: 10, right: 12 },
  };
  return <div style={{ ...base, ...map[pos] }}>{label}</div>;
}

function Card({
  children,
  className = "",
  style,
  ticks,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  ticks?: { tl?: string; tr?: string; bl?: string; br?: string };
}) {
  return (
    <div
      className={`relative rounded-lg ${className}`}
      style={{
        background:
          "linear-gradient(180deg, rgba(34,56,74,0.92) 0%, rgba(27,43,56,0.92) 100%)",
        border: `1px solid ${BRAND.border}`,
        boxShadow:
          "inset 0 0 0 1px rgba(169,194,63,0.06), 0 2px 0 rgba(0,0,0,0.25), 0 12px 30px rgba(0,0,0,0.35)",
        backdropFilter: "blur(2px)",
        ...style,
      }}
    >
      {ticks?.tl && <CornerTick pos="tl" label={ticks.tl} />}
      {ticks?.tr && <CornerTick pos="tr" label={ticks.tr} />}
      {ticks?.bl && <CornerTick pos="bl" label={ticks.bl} />}
      {ticks?.br && <CornerTick pos="br" label={ticks.br} />}
      {children}
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  right,
}: {
  eyebrow: string;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-3">
      <div>
        <div
          className="text-[10px] font-semibold"
          style={{
            color: BRAND.greenLight,
            letterSpacing: "0.22em",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          {eyebrow}
        </div>
        <div
          className="text-[15px] font-semibold mt-0.5"
          style={{ color: BRAND.text, letterSpacing: "0.02em" }}
        >
          {title}
        </div>
      </div>
      {right}
    </div>
  );
}

function StatTile({
  Icon,
  label,
  value,
  delta,
  deltaTone = "neutral",
  tick,
}: {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  label: string;
  value: string;
  delta: string;
  deltaTone?: "good" | "bad" | "neutral";
  tick: string;
}) {
  const deltaColor =
    deltaTone === "good"
      ? BRAND.greenLight
      : deltaTone === "bad"
        ? "#F4A261"
        : BRAND.muted;
  return (
    <div
      className="relative rounded-md p-3"
      style={{
        background: "rgba(15,26,36,0.55)",
        border: `1px solid ${BRAND.border}`,
        boxShadow: "inset 0 0 0 1px rgba(169,194,63,0.05)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 6,
          right: 8,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 8,
          color: "rgba(169,194,63,0.45)",
          letterSpacing: "0.12em",
        }}
      >
        {tick}
      </div>
      <div className="flex items-center gap-2 mb-2">
        <span
          className="inline-flex items-center justify-center rounded"
          style={{
            width: 22,
            height: 22,
            background: "rgba(107,165,57,0.15)",
            border: "1px solid rgba(169,194,63,0.30)",
          }}
        >
          <Icon size={12} color={BRAND.greenLight} strokeWidth={2} />
        </span>
        <div
          className="text-[10px] font-semibold uppercase"
          style={{ color: BRAND.muted, letterSpacing: "0.14em" }}
        >
          {label}
        </div>
      </div>
      <div
        className="text-[26px] font-semibold leading-none"
        style={{ color: BRAND.text, letterSpacing: "-0.01em" }}
      >
        {value}
      </div>
      <div
        className="text-[11px] mt-1.5 flex items-center gap-1"
        style={{ color: deltaColor }}
      >
        {deltaTone === "good" && <TrendingUp size={11} />}
        {deltaTone === "bad" && <TrendingDown size={11} />}
        <span>{delta}</span>
      </div>
    </div>
  );
}

function PriorityRow({
  title,
  project,
  due,
  level,
}: {
  title: string;
  project: string;
  due: string;
  level: "high" | "medium";
}) {
  const isHigh = level === "high";
  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-md"
      style={{
        background: "rgba(15,26,36,0.55)",
        border: `1px solid ${BRAND.border}`,
      }}
    >
      <span
        className="inline-flex items-center justify-center rounded"
        style={{
          width: 28,
          height: 28,
          background: isHigh
            ? "rgba(244,162,97,0.15)"
            : "rgba(169,194,63,0.12)",
          border: `1px solid ${isHigh ? "rgba(244,162,97,0.40)" : "rgba(169,194,63,0.30)"}`,
        }}
      >
        <AlertTriangle
          size={14}
          color={isHigh ? "#F4A261" : BRAND.greenLight}
          strokeWidth={2}
        />
      </span>
      <div className="flex-1 min-w-0">
        <div
          className="text-[13px] font-medium truncate"
          style={{ color: BRAND.text }}
        >
          {title}
        </div>
        <div
          className="text-[11px] mt-0.5 flex items-center gap-1.5"
          style={{ color: BRAND.muted }}
        >
          <MapPin size={10} />
          <span>{project}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span
          className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
          style={{
            color: isHigh ? "#F4A261" : BRAND.greenLight,
            border: `1px solid ${isHigh ? "rgba(244,162,97,0.45)" : "rgba(169,194,63,0.40)"}`,
            letterSpacing: "0.12em",
          }}
        >
          {level}
        </span>
        <span className="text-[10px]" style={{ color: BRAND.dim }}>
          {due}
        </span>
      </div>
    </div>
  );
}

function ScheduleItem({
  time,
  title,
  project,
  isFirst,
  isLast,
}: {
  time: string;
  title: string;
  project: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div
        className="flex flex-col items-center"
        style={{ width: 56, flexShrink: 0 }}
      >
        <div
          className="text-[11px] font-semibold"
          style={{
            color: BRAND.greenLight,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: "0.04em",
          }}
        >
          {time}
        </div>
        <div className="flex-1 flex flex-col items-center mt-1">
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: BRAND.greenLight,
              boxShadow: "0 0 0 3px rgba(169,194,63,0.15)",
            }}
          />
          {!isLast && (
            <span
              style={{
                flex: 1,
                width: 1,
                marginTop: 2,
                background:
                  "linear-gradient(180deg, rgba(169,194,63,0.45), rgba(169,194,63,0.05))",
              }}
            />
          )}
        </div>
      </div>
      <div className={`flex-1 ${isFirst ? "" : "pt-0"} pb-4`}>
        <div
          className="text-[13px] font-medium"
          style={{ color: BRAND.text }}
        >
          {title}
        </div>
        <div
          className="text-[11px] mt-0.5"
          style={{ color: BRAND.muted }}
        >
          {project}
        </div>
      </div>
    </div>
  );
}

function ForecastCell({
  day,
  temp,
  Icon,
}: {
  day: string;
  temp: string;
  Icon: React.ComponentType<{ size?: number; color?: string }>;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 rounded-md"
      style={{
        background: "rgba(15,26,36,0.55)",
        border: `1px solid ${BRAND.border}`,
        padding: "10px 4px",
      }}
    >
      <div
        className="text-[10px] font-semibold uppercase"
        style={{ color: BRAND.muted, letterSpacing: "0.14em" }}
      >
        {day}
      </div>
      <Icon size={16} color={BRAND.greenLight} />
      <div
        className="text-[14px] font-semibold"
        style={{ color: BRAND.text }}
      >
        {temp}
      </div>
    </div>
  );
}

export function TopographicMesh() {
  return (
    <div
      className="min-h-screen w-full relative overflow-hidden"
      style={{
        background: BRAND.bgDeeper,
        color: BRAND.text,
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
      }}
    >
      <style>{`
        @keyframes topo-drift {
          0%   { transform: translate3d(0, 0, 0); }
          50%  { transform: translate3d(-30px, -18px, 0); }
          100% { transform: translate3d(0, 0, 0); }
        }
        @keyframes topo-drift-slow {
          0%   { transform: translate3d(0, 0, 0) scale(1); }
          50%  { transform: translate3d(20px, 12px, 0) scale(1.02); }
          100% { transform: translate3d(0, 0, 0) scale(1); }
        }
        @keyframes conic-pulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 0.8; }
        }
        .topo-layer-a { animation: topo-drift 38s ease-in-out infinite; }
        .topo-layer-b { animation: topo-drift-slow 64s ease-in-out infinite; }
        .conic-sweep { animation: conic-pulse 14s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .topo-layer-a, .topo-layer-b, .conic-sweep { animation: none !important; }
        }
      `}</style>

      {/* ── Backdrop layers ── */}
      <div
        className="conic-sweep"
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "conic-gradient(from 220deg at 100% 0%, rgba(107,165,57,0.18) 0deg, rgba(107,165,57,0.08) 45deg, transparent 110deg, transparent 360deg)",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(900px 600px at 92% -8%, rgba(169,194,63,0.10), transparent 60%), radial-gradient(700px 500px at 0% 100%, rgba(107,165,57,0.07), transparent 65%)",
          pointerEvents: "none",
        }}
      />

      {/* SVG topographic contours */}
      <svg
        aria-hidden
        className="topo-layer-a"
        style={{
          position: "absolute",
          inset: "-10% -10%",
          width: "120%",
          height: "120%",
          pointerEvents: "none",
          opacity: 0.55,
        }}
        viewBox="0 0 1200 900"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <radialGradient id="topoFadeA" cx="60%" cy="40%" r="70%">
            <stop offset="0%" stopColor="#A9C23F" stopOpacity="0.55" />
            <stop offset="60%" stopColor="#6BA539" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#6BA539" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g fill="none" stroke="url(#topoFadeA)" strokeWidth="1">
          {Array.from({ length: 18 }).map((_, i) => {
            const r = 70 + i * 38;
            return (
              <ellipse
                key={i}
                cx="780"
                cy="320"
                rx={r}
                ry={r * 0.62}
                transform={`rotate(${-12 + i * 0.6} 780 320)`}
              />
            );
          })}
        </g>
        <g fill="none" stroke="rgba(169,194,63,0.18)" strokeWidth="1">
          {Array.from({ length: 14 }).map((_, i) => {
            const r = 60 + i * 44;
            return (
              <ellipse
                key={i}
                cx="220"
                cy="700"
                rx={r * 0.9}
                ry={r * 0.55}
                transform={`rotate(${20 - i * 0.8} 220 700)`}
              />
            );
          })}
        </g>
      </svg>

      <svg
        aria-hidden
        className="topo-layer-b"
        style={{
          position: "absolute",
          inset: "-15% -15%",
          width: "130%",
          height: "130%",
          pointerEvents: "none",
          opacity: 0.35,
          mixBlendMode: "screen",
        }}
        viewBox="0 0 1200 900"
        preserveAspectRatio="xMidYMid slice"
      >
        <g fill="none" stroke="rgba(169,194,63,0.22)" strokeWidth="0.8">
          {Array.from({ length: 22 }).map((_, i) => {
            const r = 30 + i * 30;
            const cx = 480 + Math.sin(i * 0.7) * 60;
            const cy = 480 + Math.cos(i * 0.5) * 40;
            return (
              <path
                key={i}
                d={`M ${cx - r} ${cy}
                    C ${cx - r} ${cy - r * 0.7}, ${cx + r * 0.4} ${cy - r * 0.9}, ${cx + r} ${cy}
                    C ${cx + r} ${cy + r * 0.7}, ${cx - r * 0.4} ${cy + r * 0.95}, ${cx - r} ${cy} Z`}
              />
            );
          })}
        </g>
      </svg>

      {/* Vignette */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(120% 90% at 50% 40%, transparent 50%, rgba(15,26,36,0.85) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Page-level corner ticks */}
      <CornerTick pos="tl" label="N 47°36′12″ · W 122°19′44″" />
      <CornerTick pos="tr" label="GRID 10 · ZONE A" />
      <CornerTick pos="bl" label="ELEV 124 ft" />
      <CornerTick pos="br" label="SCALE 1:2400" />

      {/* ── Content ── */}
      <div
        className="relative mx-auto px-6 py-8"
        style={{ maxWidth: 1040 }}
      >
        {/* Header */}
        <header className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-2">
              <div
                className="inline-flex items-center justify-center rounded-sm"
                style={{
                  width: 22,
                  height: 22,
                  background: BRAND.green,
                  boxShadow: "0 0 0 1px rgba(169,194,63,0.5)",
                }}
              >
                <HardHat size={13} color="#0F1A24" strokeWidth={2.5} />
              </div>
              <div
                className="text-[12px] font-bold tracking-[0.3em]"
                style={{ color: BRAND.text }}
              >
                RMONE
              </div>
              <div
                className="text-[10px] font-semibold tracking-[0.28em] ml-2"
                style={{ color: BRAND.greenLight }}
              >
                · DAILY BRIEFING
              </div>
            </div>
            <h1
              className="mt-4 text-[38px] font-semibold leading-[1.05]"
              style={{ color: BRAND.text, letterSpacing: "-0.02em" }}
            >
              Good morning, Marcus
            </h1>
            <div
              className="mt-1 text-[13px]"
              style={{
                color: BRAND.muted,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                letterSpacing: "0.06em",
              }}
            >
              MONDAY · MAY 11, 2026
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px]"
              style={{
                color: BRAND.text,
                background: "rgba(34,56,74,0.7)",
                border: `1px solid ${BRAND.border}`,
              }}
            >
              <Briefcase size={12} color={BRAND.greenLight} />
              <span style={{ color: BRAND.text }}>12</span>
              <span style={{ color: BRAND.muted }}>active projects</span>
            </div>
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px]"
              style={{
                color: BRAND.text,
                background: "rgba(244,162,97,0.10)",
                border: "1px solid rgba(244,162,97,0.40)",
              }}
            >
              <Bell size={12} color="#F4A261" />
              <span style={{ color: "#F4A261", fontWeight: 600 }}>3</span>
              <span style={{ color: BRAND.muted }}>alerts</span>
            </div>
          </div>
        </header>

        {/* Section 1 — Snapshot */}
        <section className="mb-6">
          <Card
            className="p-5"
            ticks={{ tl: "S.01", br: "07:42 PT" }}
          >
            <SectionHeader eyebrow="SECTOR · 01" title="Today's Snapshot" />
            <div className="grid grid-cols-4 gap-3">
              <StatTile
                Icon={Briefcase}
                label="Active Projects"
                value="12"
                delta="+2 vs last week"
                deltaTone="good"
                tick="01"
              />
              <StatTile
                Icon={FileText}
                label="Open RFIs"
                value="7"
                delta="-3 today"
                deltaTone="good"
                tick="02"
              />
              <StatTile
                Icon={Shield}
                label="Safety Incidents"
                value="0"
                delta="14 days clean"
                deltaTone="good"
                tick="03"
              />
              <StatTile
                Icon={DollarSign}
                label="Budget Variance"
                value="-2.4%"
                delta="favorable"
                deltaTone="good"
                tick="04"
              />
            </div>
          </Card>
        </section>

        {/* Section 2 + 3 row */}
        <section className="grid grid-cols-2 gap-5 mb-6">
          <Card className="p-5" ticks={{ tl: "S.02", br: "3 ITEMS" }}>
            <SectionHeader
              eyebrow="SECTOR · 02"
              title="Priority Items"
              right={
                <span
                  className="text-[10px]"
                  style={{
                    color: BRAND.dim,
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                    letterSpacing: "0.14em",
                  }}
                >
                  TRIAGE
                </span>
              }
            />
            <div className="space-y-2.5">
              <PriorityRow
                title="Tower B — concrete pour delayed"
                project="Riverside Towers"
                due="due today"
                level="high"
              />
              <PriorityRow
                title="RFI #248 awaiting response"
                project="Atrium West"
                due="due tomorrow"
                level="medium"
              />
              <PriorityRow
                title="Safety walk overdue — Site C"
                project="Lakeside Logistics"
                due="2 days overdue"
                level="medium"
              />
            </div>
          </Card>

          <Card className="p-5" ticks={{ tl: "S.03", br: "PT · UTC-7" }}>
            <SectionHeader
              eyebrow="SECTOR · 03"
              title="Today's Schedule"
              right={
                <Calendar size={14} color={BRAND.greenLight} />
              }
            />
            <div>
              <ScheduleItem
                time="09:00"
                title="OAC meeting"
                project="Riverside Towers"
                isFirst
                isLast={false}
              />
              <ScheduleItem
                time="11:30"
                title="Concrete sub walkthrough"
                project="Atrium West"
                isFirst={false}
                isLast={false}
              />
              <ScheduleItem
                time="14:00"
                title="Owner update call"
                project="Lakeside Logistics"
                isFirst={false}
                isLast={false}
              />
              <ScheduleItem
                time="16:30"
                title="Weekly safety review"
                project="All projects"
                isFirst={false}
                isLast
              />
            </div>
          </Card>
        </section>

        {/* Section 4 — Forecast */}
        <section>
          <Card className="p-5" ticks={{ tl: "S.04", br: "METEO · STN-12" }}>
            <SectionHeader
              eyebrow="SECTOR · 04"
              title="7-Day Forecast"
              right={
                <span
                  className="inline-flex items-center gap-1 text-[11px]"
                  style={{ color: BRAND.muted }}
                >
                  <Clock size={11} /> updated 06:30
                </span>
              }
            />
            <div className="grid grid-cols-7 gap-2">
              <ForecastCell day="MON" temp="68°" Icon={Sun} />
              <ForecastCell day="TUE" temp="71°" Icon={Sun} />
              <ForecastCell day="WED" temp="65°" Icon={CloudRain} />
              <ForecastCell day="THU" temp="60°" Icon={CloudRain} />
              <ForecastCell day="FRI" temp="72°" Icon={Cloud} />
              <ForecastCell day="SAT" temp="78°" Icon={Sun} />
              <ForecastCell day="SUN" temp="80°" Icon={Sun} />
            </div>
          </Card>
        </section>

        {/* Footer ledger */}
        <div
          className="mt-6 flex items-center justify-between text-[10px]"
          style={{
            color: BRAND.dim,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: "0.18em",
          }}
        >
          <div className="flex items-center gap-2">
            <Activity size={11} color={BRAND.greenLight} />
            <span>SURVEY · LIVE</span>
          </div>
          <div>SHEET 01 / 04 · REV 2026.05.11</div>
        </div>
      </div>
    </div>
  );
}

export default TopographicMesh;
