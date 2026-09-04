import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Z } from "@/lib/zLayers";

const BRAND = {
  bg: "#1B2B38",
  bgDeeper: "#0F1A24",
  green: "#6BA539",
  greenBg: "var(--rm-green)",
  greenLight: "#A9C23F",
  greenDeep: "#4A7A23",
  white: "#FFFFFF",
};

const SESSION_KEY = "rmone:splash:shownAt:v2";
const REPLAY_AFTER_MS = 30 * 60 * 1000;

function shouldPlaySplash(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.location.search.includes("nosplash=1")) return false;
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return true;
    const last = Number(raw);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last > REPLAY_AFTER_MS;
  } catch {
    return true;
  }
}

function markSplashShown() {
  try {
    sessionStorage.setItem(SESSION_KEY, String(Date.now()));
  } catch {
  }
}

export function SplashScreen({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  const [show, setShow] = useState<boolean>(() => shouldPlaySplash());

  useEffect(() => {
    if (!show) return;
    const duration = reduceMotion ? 600 : 1700;
    const t = window.setTimeout(() => {
      markSplashShown();
      setShow(false);
    }, duration);
    return () => window.clearTimeout(t);
  }, [show, reduceMotion]);

  return (
    <>
      {children}
      <SplashOverlay
        show={show}
        reduceMotion={!!reduceMotion}
        testId="splash-screen"
      />
    </>
  );
}

/** Standalone overlay that plays the same animated RM ONE splash as the
 *  app-level <SplashScreen>. Use when you want the intro to play on a
 *  per-page mount (e.g. Daily Briefing) without touching the session-based
 *  app-wide splash logic. */
export function SplashOverlay({
  show,
  reduceMotion = false,
  testId = "splash-overlay",
  label = "Loading RM ONE",
  tagline,
}: {
  show: boolean;
  reduceMotion?: boolean;
  testId?: string;
  label?: string;
  tagline?: string;
}) {
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key={testId}
          role="status"
          aria-live="polite"
          aria-label={label}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.55, ease: "easeInOut" } }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: Z.SPLASH,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `radial-gradient(circle at 50% 45%, ${BRAND.bg} 0%, ${BRAND.bgDeeper} 70%)`,
            overflow: "hidden",
          }}
          data-testid={testId}
        >
          <SplashGridBg />
          {reduceMotion ? null : <SplashOrbits />}
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { scale: 0.92, opacity: 0, y: 8 }}
            animate={reduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 18,
            }}
          >
            <SplashWordmark />
            <SplashTagline tagline={tagline} />
            <SplashLoaderBar />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function SplashWordmark() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.55, duration: 0.5, ease: "easeOut" }}
      style={{
        width: 280,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <img
        src={`${import.meta.env.BASE_URL}rm-one-logo.png`}
        alt="RM ONE"
        style={{
          width: "100%",
          height: "auto",
          display: "block",
          // The supplied wordmark carries dark matte pixels around the mark.
          // Screen blending removes that matte without changing the splash
          // backdrop, rings, or any surrounding layout.
          mixBlendMode: "screen",
        }}
      />
    </motion.div>
  );
}

function SplashTagline({ tagline }: { tagline?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.85, duration: 0.5 }}
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 4,
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.55)",
      }}
    >
      {tagline ?? "Operational Intelligence"}
    </motion.div>
  );
}

function SplashLoaderBar() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1.0, duration: 0.3 }}
      style={{
        position: "relative",
        marginTop: 12,
        width: 160,
        height: 3,
        borderRadius: 2,
        backgroundColor: "rgba(255,255,255,0.08)",
        overflow: "hidden",
      }}
    >
      <motion.div
        initial={{ x: "-100%" }}
        animate={{ x: "100%" }}
        transition={{ duration: 1.1, ease: "easeInOut", repeat: Infinity }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: "100%",
          width: "60%",
          background: `linear-gradient(90deg, transparent, ${BRAND.green}, ${BRAND.greenLight}, transparent)`,
        }}
      />
    </motion.div>
  );
}

function SplashGridBg() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `
          linear-gradient(to right, rgba(107,165,57,0.05) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(107,165,57,0.05) 1px, transparent 1px)
        `,
        backgroundSize: "44px 44px",
        maskImage: "radial-gradient(circle at 50% 50%, black 0%, transparent 70%)",
        WebkitMaskImage: "radial-gradient(circle at 50% 50%, black 0%, transparent 70%)",
        pointerEvents: "none",
      }}
    />
  );
}

function SplashOrbits() {
  const orbits = [
    { size: 320, dur: 18, dir: 1, opacity: 0.12 },
    { size: 460, dur: 26, dir: -1, opacity: 0.08 },
    { size: 600, dur: 34, dir: 1, opacity: 0.05 },
  ];
  return (
    <>
      {orbits.map((o, i) => (
        <motion.div
          key={i}
          initial={{ rotate: 0, opacity: 0 }}
          animate={{ rotate: 360 * o.dir, opacity: o.opacity }}
          transition={{
            rotate: { duration: o.dur, ease: "linear", repeat: Infinity },
            opacity: { duration: 0.8, delay: 0.2 + i * 0.1 },
          }}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: o.size,
            height: o.size,
            marginLeft: -o.size / 2,
            marginTop: -o.size / 2,
            borderRadius: "50%",
            border: `1px solid ${BRAND.green}`,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -4,
              left: "50%",
              width: 8,
              height: 8,
              marginLeft: -4,
              borderRadius: "50%",
              backgroundColor: BRAND.greenLight,
              boxShadow: `0 0 12px ${BRAND.greenLight}`,
            }}
          />
        </motion.div>
      ))}
    </>
  );
}
