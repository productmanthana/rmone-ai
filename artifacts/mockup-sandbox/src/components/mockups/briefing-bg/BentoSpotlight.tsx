import {
  Briefcase,
  FileQuestion,
  ShieldCheck,
  TrendingDown,
  AlertTriangle,
  AlertCircle,
  Sparkles,
  Clock,
  Calendar,
  Sun,
  CloudRain,
  Cloud,
  Bell,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
} from "lucide-react";

const BRAND = {
  bg: "#F4F1EC",
  bgWarm: "#EFEBE3",
  ink: "#1B2B38",
  inkSoft: "#2C3E4D",
  muted: "#6B7785",
  mutedDim: "#9AA3AD",
  green: "#6BA539",
  greenLight: "#A9C23F",
  greenDeep: "#4A7A23",
  white: "#FFFFFF",
  hairline: "rgba(27,43,56,0.08)",
  hairlineSoft: "rgba(27,43,56,0.05)",
  amber: "#D97706",
  red: "#DC2626",
};

function Chip({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "high" | "med" | "good";
}) {
  const styles: Record<string, React.CSSProperties> = {
    default: { background: BRAND.white, color: BRAND.inkSoft, border: `1px solid ${BRAND.hairline}` },
    high: { background: "#FEE2E2", color: "#991B1B", border: "1px solid rgba(220,38,38,0.25)" },
    med: { background: "#FEF3C7", color: "#92400E", border: "1px solid rgba(217,119,6,0.25)" },
    good: { background: "rgba(107,165,57,0.14)", color: BRAND.greenDeep, border: "1px solid rgba(107,165,57,0.30)" },
  };
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-bold tracking-[0.06em] uppercase"
      style={styles[tone]}
    >
      {children}
    </span>
  );
}

function BentoTile({
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
      className={`rounded-3xl bg-white ${className}`}
      style={{
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.9) inset, 0 1px 2px rgba(27,43,56,0.04), 0 8px 24px rgba(27,43,56,0.06), 0 24px 48px -16px rgba(27,43,56,0.10)",
        border: `1px solid ${BRAND.hairlineSoft}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function StatRow({
  icon: Icon,
  label,
  value,
  delta,
  deltaTone,
}: {
  icon: any;
  label: string;
  value: string;
  delta: string;
  deltaTone: "up" | "down" | "flat";
}) {
  const DeltaIcon = deltaTone === "up" ? ArrowUpRight : deltaTone === "down" ? ArrowDownRight : ArrowUpRight;
  return (
    <div
      className="flex flex-col gap-2 p-4 rounded-2xl"
      style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.18)" }}
    >
      <div className="flex items-center justify-between">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: "rgba(255,255,255,0.16)" }}
        >
          <Icon size={18} color="#fff" strokeWidth={2.2} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-[0.10em] text-white/70">{label}</span>
      </div>
      <div className="text-white text-[40px] leading-none font-black tracking-tight" style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div className="flex items-center gap-1 text-white/85 text-[11.5px] font-semibold">
        <DeltaIcon size={12} strokeWidth={2.5} />
        <span>{delta}</span>
      </div>
    </div>
  );
}

export function BentoSpotlight() {
  const forecast = [
    { d: "Mon", t: 68, Icon: Sun },
    { d: "Tue", t: 71, Icon: Sun },
    { d: "Wed", t: 65, Icon: CloudRain },
    { d: "Thu", t: 60, Icon: CloudRain },
    { d: "Fri", t: 72, Icon: Cloud },
    { d: "Sat", t: 78, Icon: Sun },
    { d: "Sun", t: 80, Icon: Sun },
  ];

  return (
    <div
      className="min-h-screen w-full relative overflow-hidden"
      style={{
        background: BRAND.bg,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "SF Pro Display", "Inter", "Helvetica Neue", Arial, sans-serif',
        color: BRAND.ink,
      }}
    >
      <style>{`
        @keyframes bsGlowPulse {
          0%, 100% { opacity: 0.85; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 1; transform: translate(-50%, -50%) scale(1.06); }
        }
        @keyframes bsGrainShift {
          0% { transform: translate(0,0); }
          100% { transform: translate(-40px,-40px); }
        }
        .bs-glow { animation: bsGlowPulse 8s ease-in-out infinite; }
        .bs-grain { animation: bsGrainShift 24s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .bs-glow, .bs-grain { animation: none !important; }
        }
      `}</style>

      {/* Warm paper backdrop with soft warm vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, #FBF7F0 0%, #F4F1EC 45%, #ECE7DD 100%)",
        }}
      />

      {/* Subtle grain via SVG noise */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.35] bs-grain"
        style={{
          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.10  0 0 0 0 0.16  0 0 0 0 0.21  0 0 0 0.05 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`,
          mixBlendMode: "multiply",
        }}
      />

      {/* The big radial GREEN spotlight glow behind the hero tile */}
      <div
        className="absolute pointer-events-none bs-glow"
        style={{
          left: "50%",
          top: "470px",
          width: "1100px",
          height: "1100px",
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(closest-side, rgba(169,194,63,0.45) 0%, rgba(107,165,57,0.32) 30%, rgba(107,165,57,0.10) 60%, rgba(107,165,57,0) 75%)",
          filter: "blur(8px)",
        }}
      />

      {/* Faint dotted bento grid (very subtle) */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.5]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(27,43,56,0.06) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage:
            "radial-gradient(ellipse at 50% 30%, rgba(0,0,0,0.6), rgba(0,0,0,0) 70%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at 50% 30%, rgba(0,0,0,0.6), rgba(0,0,0,0) 70%)",
        }}
      />

      <div className="relative max-w-[1080px] mx-auto px-6 md:px-8 py-10">
        {/* HEADER */}
        <header className="flex items-start justify-between gap-6 mb-10">
          <div>
            <div className="flex items-center gap-3 mb-5">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-white text-[13px] tracking-tight"
                style={{
                  background: `linear-gradient(135deg, ${BRAND.green}, ${BRAND.greenDeep})`,
                  boxShadow: "0 4px 12px rgba(107,165,57,0.35)",
                }}
              >
                R1
              </div>
              <div className="flex flex-col">
                <span className="text-[14px] font-black tracking-[0.16em]" style={{ color: BRAND.ink }}>
                  RMONE
                </span>
                <span className="text-[10px] font-bold tracking-[0.22em]" style={{ color: BRAND.muted }}>
                  DAILY BRIEFING
                </span>
              </div>
            </div>
            <h1
              className="text-[52px] leading-[1.02] font-black tracking-[-0.025em]"
              style={{ color: BRAND.ink }}
            >
              Good morning, <span style={{ color: BRAND.greenDeep }}>Marcus</span>
            </h1>
            <p className="mt-3 text-[15px] font-medium" style={{ color: BRAND.muted }}>
              Monday, May 11, 2026
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 pt-2">
            <Chip tone="default">
              <Briefcase size={11} strokeWidth={2.5} />
              12 active projects
            </Chip>
            <Chip tone="med">
              <Bell size={11} strokeWidth={2.5} />
              3 alerts
            </Chip>
          </div>
        </header>

        {/* TODAY'S SNAPSHOT — the GREEN SPOTLIGHT tile */}
        <section className="mb-6">
          <BentoTile
            className="relative overflow-hidden"
            style={{
              background: `linear-gradient(135deg, ${BRAND.green} 0%, ${BRAND.greenDeep} 100%)`,
              border: "1px solid rgba(255,255,255,0.10)",
              boxShadow:
                "0 1px 0 rgba(255,255,255,0.20) inset, 0 12px 32px rgba(74,122,35,0.30), 0 32px 64px -20px rgba(74,122,35,0.40)",
            }}
          >
            {/* glossy highlight */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "radial-gradient(80% 60% at 20% 0%, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 60%)",
              }}
            />
            <div className="relative p-7">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-black uppercase tracking-[0.20em] px-2.5 py-1 rounded-full"
                    style={{ background: "rgba(255,255,255,0.16)", color: "#fff" }}
                  >
                    Today's snapshot
                  </span>
                </div>
                <span className="text-white/70 text-[11px] font-semibold">
                  Updated 6:42 am · PT
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatRow
                  icon={Briefcase}
                  label="Active Projects"
                  value="12"
                  delta="+2 vs last week"
                  deltaTone="up"
                />
                <StatRow
                  icon={FileQuestion}
                  label="Open RFIs"
                  value="7"
                  delta="-3 today"
                  deltaTone="down"
                />
                <StatRow
                  icon={ShieldCheck}
                  label="Safety Incidents"
                  value="0"
                  delta="14 days clean"
                  deltaTone="flat"
                />
                <StatRow
                  icon={TrendingDown}
                  label="Budget Variance"
                  value="-2.4%"
                  delta="favorable"
                  deltaTone="down"
                />
              </div>
            </div>
          </BentoTile>
        </section>

        {/* PRIORITY + SCHEDULE — bento grid */}
        <section className="grid grid-cols-1 md:grid-cols-5 gap-5 mb-6">
          {/* PRIORITY ITEMS */}
          <BentoTile className="md:col-span-3 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[13px] font-black uppercase tracking-[0.14em]" style={{ color: BRAND.ink }}>
                Priority items
              </h2>
              <span className="text-[11px] font-semibold" style={{ color: BRAND.muted }}>
                3 needing attention
              </span>
            </div>
            <ul className="flex flex-col gap-2.5">
              {[
                {
                  title: "Tower B — concrete pour delayed",
                  project: "Riverside Towers",
                  due: "Due today",
                  tone: "high" as const,
                  level: "High",
                },
                {
                  title: "RFI #248 awaiting response",
                  project: "Atrium West",
                  due: "Due tomorrow",
                  tone: "med" as const,
                  level: "Medium",
                },
                {
                  title: "Safety walk overdue — Site C",
                  project: "Lakeside Logistics",
                  due: "2 days overdue",
                  tone: "med" as const,
                  level: "Medium",
                },
              ].map((item, i) => (
                <li
                  key={i}
                  className="flex items-center gap-4 p-4 rounded-2xl group cursor-pointer transition-colors"
                  style={{
                    background: "#FAFAF7",
                    border: `1px solid ${BRAND.hairlineSoft}`,
                  }}
                >
                  <div
                    className="w-1 self-stretch rounded-full"
                    style={{
                      background:
                        item.tone === "high"
                          ? BRAND.red
                          : BRAND.amber,
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Chip tone={item.tone}>
                        {item.tone === "high" ? <AlertTriangle size={10} strokeWidth={2.6} /> : null}
                        {item.level}
                      </Chip>
                      <span className="text-[11.5px] font-semibold" style={{ color: BRAND.muted }}>
                        {item.project}
                      </span>
                    </div>
                    <div
                      className="text-[15px] font-bold leading-snug"
                      style={{ color: BRAND.ink }}
                    >
                      {item.title}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className="text-[11px] font-bold"
                      style={{
                        color: item.due.includes("overdue")
                          ? BRAND.red
                          : item.due === "Due today"
                          ? BRAND.amber
                          : BRAND.muted,
                      }}
                    >
                      {item.due}
                    </span>
                    <ChevronRight size={16} color={BRAND.mutedDim} />
                  </div>
                </li>
              ))}
            </ul>
          </BentoTile>

          {/* TODAY'S SCHEDULE */}
          <BentoTile className="md:col-span-2 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[13px] font-black uppercase tracking-[0.14em]" style={{ color: BRAND.ink }}>
                Today's schedule
              </h2>
              <Calendar size={15} color={BRAND.muted} />
            </div>
            <ol className="relative">
              <span
                className="absolute left-[34px] top-2 bottom-2 w-px"
                style={{ background: BRAND.hairline }}
              />
              {[
                { time: "09:00", title: "OAC meeting", project: "Riverside Towers", live: true },
                { time: "11:30", title: "Concrete sub walkthrough", project: "Atrium West" },
                { time: "14:00", title: "Owner update call", project: "Lakeside Logistics" },
                { time: "16:30", title: "Weekly safety review", project: "" },
              ].map((it, i) => (
                <li key={i} className="flex items-start gap-3 py-2.5">
                  <div
                    className="text-[11px] font-black tabular-nums w-[42px] pt-1"
                    style={{ color: BRAND.inkSoft }}
                  >
                    {it.time}
                  </div>
                  <div
                    className="relative w-3 h-3 mt-1.5 rounded-full flex-shrink-0"
                    style={{
                      background: it.live ? BRAND.green : BRAND.white,
                      border: `2px solid ${it.live ? BRAND.greenDeep : BRAND.hairline}`,
                      boxShadow: it.live
                        ? "0 0 0 4px rgba(107,165,57,0.20)"
                        : "none",
                    }}
                  />
                  <div className="flex-1 min-w-0 pl-1">
                    <div className="text-[13.5px] font-bold leading-tight" style={{ color: BRAND.ink }}>
                      {it.title}
                    </div>
                    {it.project ? (
                      <div className="text-[11.5px] mt-0.5 font-medium" style={{ color: BRAND.muted }}>
                        {it.project}
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </BentoTile>
        </section>

        {/* FORECAST */}
        <section>
          <BentoTile className="p-5">
            <div className="flex items-center justify-between mb-4 px-1">
              <h2 className="text-[13px] font-black uppercase tracking-[0.14em]" style={{ color: BRAND.ink }}>
                7-day forecast
              </h2>
              <span className="text-[11px] font-semibold" style={{ color: BRAND.muted }}>
                Site avg · °F
              </span>
            </div>
            <div className="grid grid-cols-7 gap-2">
              {forecast.map(({ d, t, Icon }, i) => {
                const wet = Icon === CloudRain;
                return (
                  <div
                    key={i}
                    className="flex flex-col items-center gap-1.5 py-3 px-1 rounded-2xl"
                    style={{
                      background: wet ? "rgba(59,130,246,0.06)" : "#FAFAF7",
                      border: `1px solid ${BRAND.hairlineSoft}`,
                    }}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-[0.10em]" style={{ color: BRAND.muted }}>
                      {d}
                    </span>
                    <Icon
                      size={20}
                      color={wet ? "#3B82F6" : Icon === Cloud ? BRAND.muted : BRAND.amber}
                      strokeWidth={2.2}
                    />
                    <span
                      className="text-[18px] font-black tabular-nums leading-none"
                      style={{ color: BRAND.ink }}
                    >
                      {t}°
                    </span>
                  </div>
                );
              })}
            </div>
          </BentoTile>
        </section>

        <footer className="mt-10 mb-2 flex items-center justify-between text-[10.5px] font-bold uppercase tracking-[0.16em]" style={{ color: BRAND.mutedDim }}>
          <div className="flex items-center gap-2">
            <Clock size={11} />
            Synced 6:42 am PT
          </div>
          <div>RMONE · Bento Spotlight</div>
        </footer>
      </div>
    </div>
  );
}

export default BentoSpotlight;
