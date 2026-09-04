import { useEffect, useState, useRef } from "react";
import { motion, useMotionValue, useTransform, useScroll, useSpring, animate, AnimatePresence } from "framer-motion";
import { ChevronLeft, MoreVertical, Building2, AlertTriangle, ChevronUp, Calendar, DollarSign, Activity, Users, Sparkles } from "lucide-react";
import { RadialBarChart, RadialBar, PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, ResponsiveContainer } from "recharts";

const C = {
  bg: "#F5F9F0",
  card: "#FFFFFF",
  brand: "#8DC63F",
  brandDark: "#6BA02B",
  ink: "#1B3035",
  muted: "#8A9E8A",
  border: "#E2EAD8",
  amber: "#E07A35",
  cream: "#FAFCF6",
};

// ─── 3D Tilt Card with shine sweep on hover ───
function TiltCard({ children, className = "", style = {}, intensity = 10 }: { children: React.ReactNode; className?: string; style?: React.CSSProperties; intensity?: number }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useTransform(y, [-50, 50], [intensity, -intensity]), { stiffness: 200, damping: 20 });
  const rotateY = useSpring(useTransform(x, [-50, 50], [-intensity, intensity]), { stiffness: 200, damping: 20 });
  const shineX = useTransform(x, [-50, 50], ["0%", "100%"]);
  const shineY = useTransform(y, [-50, 50], ["0%", "100%"]);
  const [hover, setHover] = useState(false);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    x.set(e.clientX - rect.left - rect.width / 2);
    y.set(e.clientY - rect.top - rect.height / 2);
  };
  const reset = () => { x.set(0); y.set(0); setHover(false); };

  return (
    <motion.div
      onMouseMove={handleMove}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={reset}
      style={{ rotateX, rotateY, transformStyle: "preserve-3d", transformPerspective: 900, ...style }}
      className={`relative ${className}`}
    >
      {children}
      {/* Shine overlay that follows cursor */}
      <motion.div
        className="absolute inset-0 rounded-[inherit] pointer-events-none overflow-hidden"
        style={{ opacity: hover ? 1 : 0, transition: "opacity 0.2s" }}
      >
        <motion.div
          className="absolute -inset-full"
          style={{
            background: `radial-gradient(circle 200px at ${shineX} ${shineY}, rgba(141,198,63,0.25), transparent 60%)`,
          }}
        />
      </motion.div>
    </motion.div>
  );
}

// ─── Animated number that counts up with blur-in ───
function CountUp({ to, duration = 1.4, suffix = "", className = "", style = {} }: { to: number; duration?: number; suffix?: string; className?: string; style?: React.CSSProperties }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    const controls = animate(0, to, { duration, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setVal(v) });
    return () => controls.stop();
  }, [to, duration]);
  return (
    <motion.span
      initial={{ filter: "blur(8px)", opacity: 0 }}
      animate={{ filter: "blur(0px)", opacity: 1 }}
      transition={{ duration: 0.8 }}
      className={className}
      style={style}
    >
      {Math.round(val)}{suffix}
    </motion.span>
  );
}

// ─── Floating particles backdrop ───
function FloatingParticles() {
  const particles = Array.from({ length: 14 });
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((_, i) => {
        const left = (i * 37) % 100;
        const size = 2 + (i % 3);
        const delay = i * 0.4;
        const duration = 6 + (i % 4);
        return (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${left}%`,
              top: `${(i * 53) % 100}%`,
              width: size,
              height: size,
              background: i % 2 === 0 ? C.brand : C.brandDark,
              opacity: 0.18,
            }}
            animate={{
              y: [0, -30, 0],
              opacity: [0.1, 0.3, 0.1],
              scale: [1, 1.4, 1],
            }}
            transition={{ duration, repeat: Infinity, delay, ease: "easeInOut" }}
          />
        );
      })}
    </div>
  );
}

// ─── Sweeping radial health gauge with orbiting rings ───
function HealthGauge({ score }: { score: number }) {
  const data = [{ name: "Health", value: score, fill: C.brand }];
  return (
    <div className="relative" style={{ width: 180, height: 180, transformStyle: "preserve-3d" }}>
      {/* Outer rotating decorative ring */}
      <motion.div
        className="absolute inset-0 rounded-full pointer-events-none"
        animate={{ rotate: 360 }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
        style={{
          border: `1px dashed ${C.brand}40`,
          transform: "translateZ(-10px) scale(1.08)",
        }}
      />
      {/* Inner counter-rotating ring */}
      <motion.div
        className="absolute inset-2 rounded-full pointer-events-none"
        animate={{ rotate: -360 }}
        transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
        style={{
          border: `1px dotted ${C.brandDark}30`,
        }}
      />
      {/* Glow halo */}
      <motion.div
        className="absolute inset-0 rounded-full pointer-events-none"
        animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        style={{
          background: `radial-gradient(circle, ${C.brand}30, transparent 65%)`,
          filter: "blur(12px)",
          transform: "translateZ(-20px)",
        }}
      />
      <motion.div
        initial={{ scale: 0.85, rotateY: -25, opacity: 0 }}
        animate={{ scale: 1, rotateY: 0, opacity: 1 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        style={{ transformStyle: "preserve-3d" }}
      >
        <ResponsiveContainer width={180} height={180}>
          <RadialBarChart innerRadius="78%" outerRadius="100%" data={data} startAngle={90} endAngle={90 - (360 * score) / 100}>
            <defs>
              <linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={C.brand} />
                <stop offset="100%" stopColor={C.brandDark} />
              </linearGradient>
            </defs>
            <RadialBar background={{ fill: C.border }} dataKey="value" cornerRadius={20} fill="url(#gauge-grad)" isAnimationActive animationDuration={1600} />
          </RadialBarChart>
        </ResponsiveContainer>
      </motion.div>
      <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ transform: "translateZ(30px)" }}>
        <CountUp to={score} className="text-[44px] font-bold leading-none" style={{ color: C.ink }} />
        <div className="text-[10px] uppercase tracking-[0.2em] mt-1" style={{ color: C.muted }}>Healthy</div>
      </div>
    </div>
  );
}

// ─── Animated progress bar ───
function FillBar({ pct, color = C.brand, delay = 0 }: { pct: number; color?: string; delay?: number }) {
  return (
    <div className="h-1.5 rounded-full overflow-hidden relative" style={{ background: C.border }}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 1.2, delay, ease: [0.16, 1, 0.3, 1] }}
        style={{ background: `linear-gradient(90deg, ${color}, ${color === C.brand ? C.brandDark : color})` }}
        className="h-full rounded-full relative overflow-hidden"
      >
        {/* Shimmer sweep */}
        <motion.div
          className="absolute inset-0"
          animate={{ x: ["-100%", "200%"] }}
          transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 1.5, ease: "easeInOut", delay: delay + 1.2 }}
          style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)" }}
        />
      </motion.div>
    </div>
  );
}

// ─── Section card wrapper ───
function Section({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, rotateX: -10 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
      style={{ transformStyle: "preserve-3d", transformPerspective: 1000 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const teamMembers = [
  { name: "Sarah Chen", role: "Senior PM", pct: 80, init: "SC" },
  { name: "Marcus Reid", role: "Lead Architect", pct: 100, init: "MR" },
  { name: "Priya Patel", role: "MEP Coordinator", pct: 60, init: "PP" },
  { name: "James O'Brien", role: "Cost Estimator", pct: 40, init: "JO" },
];

const disciplineData = [
  { name: "Architecture", value: 40, fill: C.brand },
  { name: "MEP", value: 25, fill: C.brandDark },
  { name: "Structural", value: 20, fill: "#A8D66E" },
  { name: "Cost", value: 15, fill: C.amber },
];

const burnData = [
  { m: "Apr", target: 200, actual: 180 },
  { m: "May", target: 420, actual: 410 },
  { m: "Jun", target: 680, actual: 720 },
  { m: "Jul", target: 920, actual: 980 },
  { m: "Aug", target: 1180, actual: 1240 },
  { m: "Sep", target: 1400, actual: 1480 },
  { m: "Oct", target: 1600, actual: 1620 },
];

const phases = [
  { name: "Pre-Schematic", pct: 100, status: "done" as const },
  { name: "Schematic", pct: 55, status: "active" as const },
  { name: "Design Dev", pct: 0, status: "next" as const },
  { name: "Construction Docs", pct: 0, status: "next" as const },
  { name: "Bid", pct: 0, status: "next" as const },
];

export function Cinematic3D() {
  const [scheduleOpen, setScheduleOpen] = useState(true);
  const [teamOpen, setTeamOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: scrollRef });
  const heroParallax = useTransform(scrollY, [0, 300], [0, -50]);
  const heroOpacity = useTransform(scrollY, [0, 200], [1, 0.5]);
  const heroScale = useTransform(scrollY, [0, 300], [1, 0.92]);
  const heroRotate = useTransform(scrollY, [0, 300], [0, -3]);

  return (
    <div
      className="w-[390px] h-[900px] overflow-hidden mx-auto relative font-sans"
      style={{ background: C.bg, color: C.ink }}
    >
      {/* Floating particles backdrop across whole screen */}
      <FloatingParticles />

      {/* Top brand bar */}
      <div className="absolute top-0 left-0 right-0 h-[3px] z-30" style={{ background: `linear-gradient(90deg, ${C.brand}, ${C.brandDark})` }} />

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-20 flex items-center gap-3 px-4 pt-8 pb-3"
        style={{ background: C.card, borderBottom: `1px solid ${C.border}` }}
      >
        <motion.button whileTap={{ scale: 0.9 }} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
          <ChevronLeft size={16} color={C.muted} />
        </motion.button>
        <div className="flex-1 flex items-center justify-center gap-2">
          <motion.span
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="text-[10px] font-bold tracking-[0.18em]"
            style={{ color: C.brand }}
          >● PRE-SCHEMATIC</motion.span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded text-white" style={{ background: C.ink }}>PMM</span>
        </div>
        <motion.button whileTap={{ scale: 0.9 }} className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
          <MoreVertical size={16} color={C.muted} />
        </motion.button>
      </motion.div>

      {/* Scrollable content */}
      <div ref={scrollRef} className="absolute inset-0 pt-[60px] pb-[72px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        <div className="px-4 py-3 space-y-3">

          {/* Hero project card with mesh gradient + 3D tilt + parallax */}
          <motion.div style={{ y: heroParallax, opacity: heroOpacity, scale: heroScale, rotateX: heroRotate, transformStyle: "preserve-3d", transformPerspective: 1200 }}>
            <TiltCard intensity={14} className="rounded-2xl p-5 relative overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: "0 24px 50px -20px rgba(27,48,53,0.18), 0 4px 12px -4px rgba(27,48,53,0.05)" }}>
              {/* Mesh gradient orbs — 3 layered animated blobs */}
              <motion.div
                animate={{ x: [0, 20, 0], y: [0, -15, 0], scale: [1, 1.2, 1] }}
                transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                className="absolute -top-10 -right-10 w-40 h-40 rounded-full pointer-events-none"
                style={{ background: `radial-gradient(circle, ${C.brand}, transparent 70%)`, opacity: 0.35, filter: "blur(20px)", transform: "translateZ(-40px)" }}
              />
              <motion.div
                animate={{ x: [0, -15, 0], y: [0, 20, 0], scale: [1, 1.15, 1] }}
                transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                className="absolute -bottom-12 -left-8 w-36 h-36 rounded-full pointer-events-none"
                style={{ background: `radial-gradient(circle, ${C.brandDark}, transparent 70%)`, opacity: 0.22, filter: "blur(24px)", transform: "translateZ(-50px)" }}
              />
              <motion.div
                animate={{ x: [0, 12, 0], y: [0, 8, 0] }}
                transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 2 }}
                className="absolute top-12 right-8 w-20 h-20 rounded-full pointer-events-none"
                style={{ background: `radial-gradient(circle, ${C.amber}, transparent 70%)`, opacity: 0.18, filter: "blur(18px)", transform: "translateZ(-30px)" }}
              />

              {/* Sparkle accent */}
              <motion.div
                animate={{ rotate: [0, 360], scale: [1, 1.2, 1] }}
                transition={{ rotate: { duration: 12, repeat: Infinity, ease: "linear" }, scale: { duration: 3, repeat: Infinity, ease: "easeInOut" } }}
                className="absolute top-3 right-3"
                style={{ transform: "translateZ(40px)" }}
              >
                <Sparkles size={14} color={C.brand} />
              </motion.div>

              <div style={{ transform: "translateZ(25px)" }}>
                <h1 className="text-[18px] font-bold leading-tight pr-8" style={{ color: C.ink }}>
                  CHSLI/CRCD — South Bay Cardio PET Reno
                </h1>
                <p className="text-[11px] mt-1" style={{ color: C.muted }}>PMM-25-000165 · PMM</p>
                <motion.div
                  whileHover={{ scale: 1.02, x: 2 }}
                  className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg cursor-pointer"
                  style={{ background: C.bg, border: `1px solid ${C.border}`, transform: "translateZ(15px)" }}
                >
                  <Building2 size={14} color={C.brand} />
                  <span className="text-[12px] font-medium" style={{ color: C.ink }}>Catholic Health Services of Long Island</span>
                </motion.div>
              </div>
            </TiltCard>
          </motion.div>

          {/* Hero stat strip — Team + Health with floating numbers */}
          <Section delay={0.15} className="grid grid-cols-2 gap-3">
            <TiltCard intensity={12} className="rounded-xl p-3 relative overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: "0 10px 24px -10px rgba(27,48,53,0.1)" }}>
              <motion.div
                animate={{ y: [0, -4, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="absolute -right-2 -bottom-2 w-16 h-16 rounded-full"
                style={{ background: `radial-gradient(circle, ${C.brand}25, transparent 70%)`, transform: "translateZ(-20px)" }}
              />
              <div className="flex items-center gap-2" style={{ transform: "translateZ(10px)" }}>
                <Users size={14} color={C.brand} />
                <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: C.muted }}>Team</span>
              </div>
              <div className="flex items-end gap-1 mt-1" style={{ transform: "translateZ(20px)" }}>
                <CountUp to={13} className="text-[28px] font-bold leading-none" style={{ color: C.ink }} />
                <span className="text-[10px] mb-1" style={{ color: C.muted }}>members</span>
              </div>
              <p className="text-[10px] mt-0.5" style={{ color: C.muted }}>6% avg utilization</p>
            </TiltCard>
            <TiltCard intensity={12} className="rounded-xl p-3 relative overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: "0 10px 24px -10px rgba(27,48,53,0.1)" }}>
              <motion.div
                animate={{ y: [0, -4, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                className="absolute -right-2 -bottom-2 w-16 h-16 rounded-full"
                style={{ background: `radial-gradient(circle, ${C.brand}25, transparent 70%)`, transform: "translateZ(-20px)" }}
              />
              <div className="flex items-center gap-2" style={{ transform: "translateZ(10px)" }}>
                <Activity size={14} color={C.brand} />
                <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: C.muted }}>Health</span>
              </div>
              <div className="flex items-end gap-1 mt-1" style={{ transform: "translateZ(20px)" }}>
                <CountUp to={80} suffix="%" className="text-[28px] font-bold leading-none" style={{ color: C.brand }} />
              </div>
              <p className="text-[10px] mt-0.5" style={{ color: C.muted }}>Healthy</p>
            </TiltCard>
          </Section>

          {/* Project Health gauge with orbiting rings */}
          <Section delay={0.3}>
            <TiltCard intensity={10} className="rounded-xl p-4 relative overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: "0 14px 34px -14px rgba(27,48,53,0.12)" }}>
              <div className="flex items-center justify-between mb-2" style={{ transform: "translateZ(15px)" }}>
                <div className="flex items-center gap-2">
                  <Activity size={14} color={C.brand} />
                  <span className="text-[12px] font-bold" style={{ color: C.ink }}>Project Health</span>
                </div>
                <motion.span
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="text-[9px] font-bold px-2 py-1 rounded-full"
                  style={{ background: `${C.brand}22`, color: C.brandDark }}
                >HEALTHY</motion.span>
              </div>
              <div className="flex items-center gap-3">
                <HealthGauge score={80} />
                <div className="flex-1 space-y-2" style={{ transform: "translateZ(10px)" }}>
                  <motion.div
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 1, duration: 0.5 }}
                    whileHover={{ x: 2 }}
                    className="flex items-start gap-2 p-2 rounded-lg"
                    style={{ background: `${C.amber}10`, border: `1px solid ${C.amber}40` }}
                  >
                    <AlertTriangle size={12} color={C.amber} className="mt-0.5 flex-shrink-0" />
                    <span className="text-[10px] leading-tight" style={{ color: C.ink }}>Target completion date passed</span>
                  </motion.div>
                </div>
              </div>
            </TiltCard>
          </Section>

          {/* Schedule with 3D phase ribbons */}
          <Section delay={0.45}>
            <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: "0 10px 24px -10px rgba(27,48,53,0.1)" }}>
              <button onClick={() => setScheduleOpen(!scheduleOpen)} className="w-full flex items-center justify-between p-3">
                <div className="flex items-center gap-2">
                  <Calendar size={14} color={C.brand} />
                  <span className="text-[12px] font-bold" style={{ color: C.ink }}>Project Schedule</span>
                </div>
                <motion.div animate={{ rotate: scheduleOpen ? 0 : 180 }} transition={{ type: "spring", stiffness: 200 }}>
                  <ChevronUp size={14} color={C.muted} />
                </motion.div>
              </button>
              <AnimatePresence initial={false}>
                {scheduleOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-3 space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <motion.div whileHover={{ y: -2, boxShadow: `0 6px 14px -4px ${C.brand}30` }} className="p-2 rounded-lg cursor-pointer" style={{ background: C.bg }}>
                          <div style={{ color: C.muted }}>Target</div>
                          <div className="font-semibold mt-0.5" style={{ color: C.ink }}>Mar 12, 25 → Aug 30, 26</div>
                        </motion.div>
                        <motion.div whileHover={{ y: -2, boxShadow: `0 6px 14px -4px ${C.brand}30` }} className="p-2 rounded-lg cursor-pointer" style={{ background: C.bg }}>
                          <div style={{ color: C.muted }}>Actual</div>
                          <div className="font-semibold mt-0.5" style={{ color: C.ink }}>Apr 02, 25 → —</div>
                        </motion.div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-semibold" style={{ color: C.muted }}>OVERALL PROGRESS</span>
                          <span className="text-[10px] font-bold" style={{ color: C.brand }}>
                            <CountUp to={42} suffix="%" /> · 15/36 mo
                          </span>
                        </div>
                        <FillBar pct={42} delay={0.6} />
                      </div>

                      {/* 3D phase steps with depth */}
                      <div className="space-y-2 pt-1" style={{ perspective: 800 }}>
                        {phases.map((p, i) => (
                          <motion.div
                            key={p.name}
                            initial={{ opacity: 0, x: -10, rotateY: -8 }}
                            animate={{ opacity: 1, x: 0, rotateY: 0 }}
                            transition={{ delay: 0.7 + i * 0.08, duration: 0.5 }}
                            whileHover={{ x: 3 }}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5">
                                <motion.span
                                  animate={p.status === "active" ? { scale: [1, 1.4, 1], opacity: [1, 0.6, 1] } : {}}
                                  transition={{ duration: 1.5, repeat: Infinity }}
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ background: p.status === "done" ? C.brandDark : p.status === "active" ? C.brand : C.border }}
                                />
                                <span className="text-[10px] font-medium" style={{ color: p.status === "next" ? C.muted : C.ink }}>{p.name}</span>
                              </div>
                              <span className="text-[9px]" style={{ color: C.muted }}>{p.pct}%</span>
                            </div>
                            <FillBar pct={p.pct} color={p.status === "active" ? C.brand : p.status === "done" ? C.brandDark : C.border} delay={0.9 + i * 0.1} />
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </Section>

          {/* Team */}
          <Section delay={0.6}>
            <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: "0 10px 24px -10px rgba(27,48,53,0.1)" }}>
              <button onClick={() => setTeamOpen(!teamOpen)} className="w-full flex items-center justify-between p-3">
                <div className="flex items-center gap-2">
                  <Users size={14} color={C.brand} />
                  <span className="text-[12px] font-bold" style={{ color: C.ink }}>Project Team</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: C.bg, color: C.muted }}>13</span>
                </div>
                <motion.div animate={{ rotate: teamOpen ? 0 : 180 }} transition={{ type: "spring", stiffness: 200 }}>
                  <ChevronUp size={14} color={C.muted} />
                </motion.div>
              </button>
              <AnimatePresence initial={false}>
                {teamOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-3 grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[9px] font-semibold uppercase tracking-wider mb-1" style={{ color: C.muted }}>By Discipline</div>
                        <div className="relative">
                          <ResponsiveContainer width="100%" height={120}>
                            <PieChart>
                              <Pie data={disciplineData} dataKey="value" innerRadius={28} outerRadius={48} paddingAngle={3} animationDuration={1400} animationBegin={400}>
                                {disciplineData.map((d, i) => <Cell key={i} fill={d.fill} stroke="none" />)}
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>
                          {/* Center pulse */}
                          <motion.div
                            animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0.7, 0.4] }}
                            transition={{ duration: 2.5, repeat: Infinity }}
                            className="absolute top-1/2 left-1/2 w-3 h-3 rounded-full -translate-x-1/2 -translate-y-1/2"
                            style={{ background: C.brand }}
                          />
                        </div>
                        <div className="space-y-0.5 -mt-2">
                          {disciplineData.map((d, i) => (
                            <motion.div
                              key={d.name}
                              initial={{ opacity: 0, x: -5 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.9 + i * 0.06 }}
                              className="flex items-center gap-1.5 text-[9px]"
                            >
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: d.fill }} />
                              <span style={{ color: C.ink }}>{d.name}</span>
                              <span className="ml-auto" style={{ color: C.muted }}>{d.value}%</span>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {teamMembers.map((m, i) => (
                          <motion.div
                            key={m.name}
                            initial={{ opacity: 0, x: 20, rotateY: 10 }}
                            animate={{ opacity: 1, x: 0, rotateY: 0 }}
                            transition={{ delay: 0.8 + i * 0.08, duration: 0.5 }}
                            whileHover={{ x: 3, scale: 1.02 }}
                            className="flex items-center gap-2 cursor-pointer"
                            style={{ transformStyle: "preserve-3d" }}
                          >
                            <div className="relative" style={{ transformStyle: "preserve-3d" }}>
                              {m.pct === 100 && (
                                <motion.div
                                  animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
                                  transition={{ duration: 2, repeat: Infinity }}
                                  className="absolute inset-0 rounded-full"
                                  style={{ background: C.brand }}
                                />
                              )}
                              <div className="relative w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow-md" style={{ background: `linear-gradient(135deg, ${C.brand}, ${C.brandDark})` }}>{m.init}</div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[10px] font-semibold truncate" style={{ color: C.ink }}>{m.name}</div>
                              <div className="text-[9px] truncate" style={{ color: C.muted }}>{m.role}</div>
                            </div>
                            <span className="text-[10px] font-bold" style={{ color: m.pct === 100 ? C.brandDark : C.ink }}>{m.pct}%</span>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </Section>

          {/* Business Units chips with magnetic hover */}
          <Section delay={0.75}>
            <div className="rounded-xl p-3" style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: "0 10px 24px -10px rgba(27,48,53,0.1)" }}>
              <div className="flex items-center gap-2 mb-2">
                <Building2 size={14} color={C.brand} />
                <span className="text-[12px] font-bold" style={{ color: C.ink }}>Business Units</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { name: "MEP", pct: 50, lead: true },
                  { name: "Architecture", pct: 30 },
                  { name: "Structural", pct: 20 },
                ].map((bu, i) => (
                  <motion.div
                    key={bu.name}
                    initial={{ opacity: 0, scale: 0.7, rotateZ: -5 }}
                    animate={{ opacity: 1, scale: 1, rotateZ: 0 }}
                    transition={{ delay: 0.9 + i * 0.1, type: "spring", stiffness: 150 }}
                    whileHover={{ y: -3, scale: 1.05, boxShadow: `0 8px 16px -4px ${C.brand}50` }}
                    whileTap={{ scale: 0.95 }}
                    className="px-2.5 py-1 rounded-full text-[10px] font-semibold flex items-center gap-1.5 cursor-pointer"
                    style={{ background: bu.lead ? C.brand : C.bg, color: bu.lead ? "white" : C.ink, border: `1px solid ${bu.lead ? C.brand : C.border}` }}
                  >
                    {bu.lead && (
                      <motion.span
                        animate={{ rotate: [0, 360] }}
                        transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                        className="text-[8px]"
                      >★</motion.span>
                    )}
                    {bu.name}
                    <span className="opacity-70">{bu.pct}%</span>
                  </motion.div>
                ))}
              </div>
            </div>
          </Section>

          {/* Budget */}
          <Section delay={0.9}>
            <TiltCard intensity={10} className="rounded-xl p-3" style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: "0 14px 34px -14px rgba(27,48,53,0.12)" }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <DollarSign size={14} color={C.brand} />
                  <span className="text-[12px] font-bold" style={{ color: C.ink }}>Budget Burn</span>
                </div>
                <span className="text-[10px] font-bold" style={{ color: C.brand }}>$1.6M / $4.2M</span>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-2 text-center">
                {[
                  { label: "VALUE", val: "$4.2M", color: C.ink },
                  { label: "EAC", val: "$3.8M", color: C.ink },
                  { label: "SPENT", val: "$1.6M", color: C.brandDark },
                ].map((s, i) => (
                  <motion.div
                    key={s.label}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.0 + i * 0.08 }}
                    whileHover={{ y: -2, boxShadow: `0 6px 14px -4px ${C.brand}30` }}
                    className="p-1.5 rounded-lg cursor-pointer"
                    style={{ background: C.bg, transform: `translateZ(${10 + i * 4}px)` }}
                  >
                    <div className="text-[9px]" style={{ color: C.muted }}>{s.label}</div>
                    <div className="text-[12px] font-bold" style={{ color: s.color }}>{s.val}</div>
                  </motion.div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={90}>
                <AreaChart data={burnData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="burn-actual" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.brand} stopOpacity={0.55} />
                      <stop offset="100%" stopColor={C.brand} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="burn-target" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.muted} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={C.muted} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="m" axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: C.muted }} />
                  <YAxis hide />
                  <Area type="monotone" dataKey="target" stroke={C.muted} strokeWidth={1} strokeDasharray="3 3" fill="url(#burn-target)" />
                  <Area type="monotone" dataKey="actual" stroke={C.brand} strokeWidth={2} fill="url(#burn-actual)" />
                </AreaChart>
              </ResponsiveContainer>
            </TiltCard>
          </Section>

          <div className="h-4" />
        </div>
      </div>

      {/* Bottom tab bar */}
      <div className="absolute bottom-0 left-0 right-0 px-6 py-3 flex justify-between items-center z-30" style={{ background: C.card, borderTop: `1px solid ${C.border}`, boxShadow: "0 -8px 20px rgba(0,0,0,0.04)" }}>
        {["Home", "Inbox", "Projects", "Team", "RFP"].map((label, i) => (
          <motion.button
            key={label}
            whileTap={{ scale: 0.85 }}
            whileHover={{ y: -2 }}
            className="flex flex-col items-center gap-0.5 text-[9px] font-medium"
            style={{ color: i === 2 ? C.brand : C.muted }}
          >
            <div className="w-5 h-5 rounded" style={{ background: i === 2 ? `${C.brand}25` : "transparent" }} />
            {label}
          </motion.button>
        ))}
      </div>
    </div>
  );
}
