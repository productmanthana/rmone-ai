import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bell,
  Briefcase,
  Calendar,
  Cloud,
  CloudRain,
  DollarSign,
  FileText,
  HardHat,
  Layers,
  Shield,
  Sun,
} from "lucide-react";

const BRAND = {
  bg: "#1B2B38",
  bgDeeper: "#0F1A24",
  green: "#6BA539",
  greenLight: "#A9C23F",
};

function Chip({
  children,
  icon: Icon,
}: {
  children: React.ReactNode;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium tracking-wide"
      style={{
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "rgba(255,255,255,0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {Icon ? <Icon size={12} className="opacity-80" /> : null}
      {children}
    </span>
  );
}

function GlassCard({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%)",
        border: "1px solid rgba(255,255,255,0.10)",
        backdropFilter: "blur(24px) saturate(140%)",
        WebkitBackdropFilter: "blur(24px) saturate(140%)",
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.08) inset, 0 24px 60px -20px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  delta,
  tone = "neutral",
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  delta: string;
  tone?: "good" | "neutral" | "bad";
}) {
  const deltaColor =
    tone === "good"
      ? BRAND.greenLight
      : tone === "bad"
      ? "#F4A8A8"
      : "rgba(255,255,255,0.55)";
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-2"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.55)" }}>
        <Icon size={13} />
        {label}
      </div>
      <div
        className="text-[32px] leading-none font-light text-white"
        style={{ fontFamily: '"Cormorant Garamond", Georgia, serif', letterSpacing: "-0.01em" }}
      >
        {value}
      </div>
      <div className="text-[11px]" style={{ color: deltaColor }}>
        {delta}
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
  const color = isHigh ? "#F4A8A8" : "#F2C879";
  const bg = isHigh ? "rgba(248,113,113,0.12)" : "rgba(232,180,80,0.12)";
  const border = isHigh ? "rgba(248,113,113,0.30)" : "rgba(232,180,80,0.28)";
  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <div
        className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
        style={{ background: bg, border: `1px solid ${border}`, color }}
      >
        {isHigh ? <AlertCircle size={16} /> : <AlertTriangle size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] text-white truncate">{title}</div>
        <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>
          {project}
        </div>
      </div>
      <span
        className="text-[10px] uppercase tracking-[0.1em] px-2 py-1 rounded-md font-semibold"
        style={{ background: bg, color, border: `1px solid ${border}` }}
      >
        {level}
      </span>
      <div className="text-[11px] w-24 text-right" style={{ color: "rgba(255,255,255,0.6)" }}>
        {due}
      </div>
    </div>
  );
}

function ScheduleItem({ time, title, project }: { time: string; title: string; project: string }) {
  return (
    <div className="flex items-start gap-4 py-3 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
      <div
        className="text-[13px] tabular-nums w-14 pt-0.5"
        style={{
          color: BRAND.greenLight,
          fontFamily: '"Cormorant Garamond", Georgia, serif',
          fontWeight: 500,
          letterSpacing: "0.02em",
        }}
      >
        {time}
      </div>
      <div className="flex-1">
        <div className="text-[13.5px] text-white">{title}</div>
        <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>
          {project}
        </div>
      </div>
    </div>
  );
}

function WeatherCell({
  day,
  temp,
  icon: Icon,
  rainy,
}: {
  day: string;
  temp: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  rainy?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center gap-1.5 py-3 rounded-xl flex-1"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.5)" }}>
        {day}
      </div>
      <Icon size={18} style={{ color: rainy ? "#9CC4E4" : BRAND.greenLight, opacity: 0.9 }} />
      <div className="text-[14px] text-white tabular-nums">{temp}</div>
    </div>
  );
}

export function AuroraGlass() {
  return (
    <div
      className="min-h-screen w-full relative overflow-hidden"
      style={{
        background:
          `radial-gradient(1200px 800px at 15% 10%, #0F1A24 0%, transparent 60%),` +
          `radial-gradient(1000px 700px at 85% 100%, #1A2F3D 0%, transparent 55%),` +
          `linear-gradient(135deg, ${BRAND.bgDeeper} 0%, #15303A 40%, #2B2440 100%)`,
        color: "white",
        fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      <style>{`
        @keyframes aurora-drift-1 {
          0%, 100% { transform: translate(-10%, -10%) rotate(0deg) scale(1); opacity: 0.55; }
          50% { transform: translate(8%, 6%) rotate(15deg) scale(1.15); opacity: 0.75; }
        }
        @keyframes aurora-drift-2 {
          0%, 100% { transform: translate(5%, 5%) rotate(0deg) scale(1.1); opacity: 0.45; }
          50% { transform: translate(-12%, -4%) rotate(-12deg) scale(1); opacity: 0.65; }
        }
        @keyframes aurora-drift-3 {
          0%, 100% { transform: translate(0%, 0%) scale(1); opacity: 0.4; }
          50% { transform: translate(10%, -8%) scale(1.2); opacity: 0.6; }
        }
        .aurora-1 { animation: aurora-drift-1 28s ease-in-out infinite; }
        .aurora-2 { animation: aurora-drift-2 34s ease-in-out infinite; }
        .aurora-3 { animation: aurora-drift-3 40s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .aurora-1, .aurora-2, .aurora-3 { animation: none !important; }
        }
        .display-serif {
          font-family: "Cormorant Garamond", "Playfair Display", Georgia, serif;
          font-weight: 300;
          letter-spacing: -0.015em;
        }
      `}</style>

      {/* Aurora ribbons */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div
          className="aurora-1 absolute"
          style={{
            top: "-20%",
            left: "-10%",
            width: "70%",
            height: "70%",
            background:
              "radial-gradient(closest-side, rgba(107,165,57,0.45), rgba(107,165,57,0) 70%)",
            filter: "blur(60px)",
          }}
        />
        <div
          className="aurora-2 absolute"
          style={{
            top: "10%",
            right: "-15%",
            width: "65%",
            height: "65%",
            background:
              "radial-gradient(closest-side, rgba(120,90,180,0.45), rgba(120,90,180,0) 70%)",
            filter: "blur(70px)",
          }}
        />
        <div
          className="aurora-3 absolute"
          style={{
            bottom: "-25%",
            left: "20%",
            width: "75%",
            height: "75%",
            background:
              "radial-gradient(closest-side, rgba(60,140,170,0.40), rgba(60,140,170,0) 70%)",
            filter: "blur(80px)",
          }}
        />
        {/* subtle noise/grain via SVG */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
          <filter id="noise">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#noise)" />
        </svg>
      </div>

      <div className="relative max-w-[1040px] mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-start justify-between gap-6 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div
                className="flex items-center gap-2 px-2.5 py-1 rounded-md"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: BRAND.greenLight, boxShadow: `0 0 8px ${BRAND.greenLight}` }}
                />
                <span className="text-[11px] tracking-[0.18em] font-semibold text-white">RMONE</span>
              </div>
              <span className="text-[10px] tracking-[0.22em] font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>
                DAILY BRIEFING
              </span>
            </div>
            <h1 className="display-serif text-[44px] leading-tight text-white">
              Good morning, Marcus
            </h1>
            <div className="text-[13px] mt-1" style={{ color: "rgba(255,255,255,0.6)" }}>
              Monday, May 11, 2026
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Chip icon={Briefcase}>12 active projects</Chip>
            <Chip icon={Bell}>3 alerts</Chip>
          </div>
        </div>

        {/* Section 1 — Snapshot */}
        <GlassCard className="p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity size={14} style={{ color: BRAND.greenLight }} />
              <h2 className="text-[11px] uppercase tracking-[0.18em]" style={{ color: "rgba(255,255,255,0.7)" }}>
                Today's Snapshot
              </h2>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <StatTile icon={Layers} label="Active Projects" value="12" delta="+2 vs last week" tone="good" />
            <StatTile icon={FileText} label="Open RFIs" value="7" delta="−3 today" tone="good" />
            <StatTile icon={Shield} label="Safety Incidents" value="0" delta="14 days clean" tone="good" />
            <StatTile icon={DollarSign} label="Budget Variance" value="−2.4%" delta="favorable" tone="good" />
          </div>
        </GlassCard>

        {/* Section 2 + 3 */}
        <div className="grid grid-cols-5 gap-6 mb-6">
          <GlassCard className="p-5 col-span-3">
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle size={14} style={{ color: "#F4A8A8" }} />
              <h2 className="text-[11px] uppercase tracking-[0.18em]" style={{ color: "rgba(255,255,255,0.7)" }}>
                Priority Items
              </h2>
            </div>
            <div className="flex flex-col gap-2.5">
              <PriorityRow
                title="Tower B — concrete pour delayed"
                project="Riverside Towers"
                due="Due today"
                level="high"
              />
              <PriorityRow
                title="RFI #248 awaiting response"
                project="Atrium West"
                due="Due tomorrow"
                level="medium"
              />
              <PriorityRow
                title="Safety walk overdue — Site C"
                project="Lakeside Logistics"
                due="2 days overdue"
                level="medium"
              />
            </div>
          </GlassCard>

          <GlassCard className="p-5 col-span-2">
            <div className="flex items-center gap-2 mb-2">
              <Calendar size={14} style={{ color: BRAND.greenLight }} />
              <h2 className="text-[11px] uppercase tracking-[0.18em]" style={{ color: "rgba(255,255,255,0.7)" }}>
                Today's Schedule
              </h2>
            </div>
            <div>
              <ScheduleItem time="09:00" title="OAC meeting" project="Riverside Towers" />
              <ScheduleItem time="11:30" title="Concrete sub walkthrough" project="Atrium West" />
              <ScheduleItem time="14:00" title="Owner update call" project="Lakeside Logistics" />
              <ScheduleItem time="16:30" title="Weekly safety review" project="All sites" />
            </div>
          </GlassCard>
        </div>

        {/* Section 4 — Forecast */}
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <HardHat size={14} style={{ color: BRAND.greenLight }} />
            <h2 className="text-[11px] uppercase tracking-[0.18em]" style={{ color: "rgba(255,255,255,0.7)" }}>
              7-Day Forecast
            </h2>
          </div>
          <div className="flex gap-2">
            <WeatherCell day="Mon" temp="68°" icon={Sun} />
            <WeatherCell day="Tue" temp="71°" icon={Sun} />
            <WeatherCell day="Wed" temp="65°" icon={CloudRain} rainy />
            <WeatherCell day="Thu" temp="60°" icon={CloudRain} rainy />
            <WeatherCell day="Fri" temp="72°" icon={Cloud} />
            <WeatherCell day="Sat" temp="78°" icon={Sun} />
            <WeatherCell day="Sun" temp="80°" icon={Sun} />
          </div>
        </GlassCard>

        <div className="mt-8 text-center text-[10px] tracking-[0.2em] uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>
          AuroraGlass · Backdrop Variant
        </div>
      </div>
    </div>
  );
}

export default AuroraGlass;
