import { useEffect, useState } from "react";
import { useTheme } from "@/lib/theme";
import { Z } from "@/lib/zLayers";

const PENDING_KEY = "rmone:cmdcentre:pending";
// With server-side cache warming the dashboard data is usually ready in
// well under a second, so the splash's minimum hold is now the dominant
// cost of login — keep it short and snappy.
const MIN_HOLD_MS = 1200;
// Hard ceiling on the splash. 8s (down from 20s): if the overlay is not
// ready by then the dashboard renders with its own inline loading states —
// stranding the user on a full-screen splash reads as a hung app.
const MAX_HOLD_MS = 8000;
const STEP_INTERVAL_MS = 300;

// Readiness signal:
// markHomeOverlayReady() — called from RoleHome when the home intelligence
// overlay (scores, risks, actions) finishes loading. This is the ONLY gate
// the splash waits for: the "/" route renders RoleHome directly, so the
// overlay IS the dashboard.
//
// markCommandCentreDataReady() used to be a second required gate, fired by
// the legacy pages/home.tsx pipeline — but that page is deprecated and no
// longer routed, so the signal never fired and every login sat on the
// splash until the MAX_HOLD_MS cap. It is kept only for the legacy
// page's import; it must never be a required condition again.
let cmdCentreDataReady = false;
const cmdCentreReadyListeners = new Set<() => void>();

let homeOverlayReady = false;
const homeOverlayListeners = new Set<() => void>();

// ── Splash timing diagnostics ────────────────────────────────────
// armedAt is set by armCommandCentreSplash() (login success) so every
// stage of the post-login sequence can be measured against a single
// zero point. Logged with the "[splash]" prefix — grep the browser
// console for a complete timeline of where the wait actually goes.
let splashArmedAt = 0;
export function splashElapsed(): number {
  return splashArmedAt > 0 ? Date.now() - splashArmedAt : -1;
}

export function markCommandCentreDataReady() {
  if (cmdCentreDataReady) return;
  cmdCentreDataReady = true;
  console.log(`[splash] pipeline data ready at +${splashElapsed()}ms`);
  cmdCentreReadyListeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  cmdCentreReadyListeners.clear();
}

/** Called by RoleHome once the home intelligence overlay finishes loading
 *  (whether it returned live data or not). This is the second gate the
 *  post-login splash waits for before fading out. */
export function markHomeOverlayReady() {
  if (homeOverlayReady) return;
  homeOverlayReady = true;
  console.log(`[splash] home overlay ready at +${splashElapsed()}ms`);
  homeOverlayListeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  homeOverlayListeners.clear();
}

function subscribeHomeOverlayReady(fn: () => void): () => void {
  if (homeOverlayReady) { fn(); return () => {}; }
  homeOverlayListeners.add(fn);
  return () => { homeOverlayListeners.delete(fn); };
}

const Colors = {
  bg: "#0F1A24",
  bgDeep: "#0A1219",
  green: "#6BA539",
  greenLight: "#A9C23F",
  greenGlow: "rgba(107,165,57,0.55)",
  white: "#FFFFFF",
  textMuted: "rgba(255,255,255,0.55)",
  textFaint: "rgba(255,255,255,0.30)",
  border: "rgba(255,255,255,0.10)",
};

const STEPS = [
  "Authenticating session",
  "Connecting to RM ONE upstream",
  "Syncing project pipeline",
  "Loading staffing demands",
  "Calculating health scores",
  "Activating AI agents",
  "Command Center ready",
];

/**
 * Mark that the next mount of <CommandCentreLoader /> should play the
 * post-login splash. Called from the login page right after signIn()
 * succeeds — the loader itself reads & clears the flag on mount so it
 * only fires once per actual login (not on tab switches or refreshes).
 */
export function armCommandCentreSplash() {
  // Reset BOTH ready flags so a previous login's signals can't dismiss
  // this fresh splash before both the pipeline AND the overlay settle.
  cmdCentreDataReady = false;
  homeOverlayReady = false;
  splashArmedAt = Date.now();
  console.log("[splash] armed (login success) — t=0");
  try { sessionStorage.setItem(PENDING_KEY, String(splashArmedAt)); } catch { /* noop */ }
}

function consumePending(): boolean {
  try {
    const v = sessionStorage.getItem(PENDING_KEY);
    if (!v) return false;
    sessionStorage.removeItem(PENDING_KEY);
    // Recover the armed timestamp across the login→home navigation (module
    // state survives an SPA route change, but a full page load would reset
    // it — the sessionStorage value is the durable copy).
    const ts = Number(v);
    if (Number.isFinite(ts) && ts > 0) {
      if (splashArmedAt === 0) splashArmedAt = ts;
      console.log(`[splash] loader mounted at +${Date.now() - ts}ms after login`);
    }
    return true;
  } catch {
    return false;
  }
}

export function CommandCentreLoader() {
  const [show, setShow] = useState<boolean>(() => consumePending());
  const [stepIdx, setStepIdx] = useState(0);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    if (!show) return;
    let mounted = true;
    let fadeId: ReturnType<typeof setTimeout> | null = null;
    let dismissId: ReturnType<typeof setTimeout> | null = null;
    const start = Date.now();

    // Tick through the steps. The last step ("ready") sticks until we fade
    // out — and we now hold ON the last step until the dashboard's data
    // ready signal fires (or MAX_HOLD_MS elapses).
    const tickId = setInterval(() => {
      if (!mounted) return;
      setStepIdx((i) => {
        // Pause one step before the end ("Activating AI agents") until
        // the overlay is ready, then advance to "Command Center ready".
        if (i >= STEPS.length - 2 && !homeOverlayReady) return STEPS.length - 2;
        return Math.min(STEPS.length - 1, i + 1);
      });
    }, STEP_INTERVAL_MS);

    function beginFade() {
      if (!mounted) return;
      console.log(
        `[splash] fading out at +${splashElapsed()}ms (held ${Date.now() - start}ms; dataReady=${cmdCentreDataReady} overlayReady=${homeOverlayReady})`,
      );
      // Snap to the final "ready" step right before the fade so the
      // checklist shows everything completed.
      setStepIdx(STEPS.length - 1);
      setFadingOut(true);
      // Track the nested fade-out timer so unmount during the 600ms fade
      // (e.g. logout, route boundary tear-down) doesn't fire a late
      // setState on an unmounted component.
      fadeId = setTimeout(() => {
        if (!mounted) return;
        setShow(false);
      }, 600);
    }

    function scheduleDismiss() {
      if (!mounted || dismissId !== null) return;
      const elapsed = Date.now() - start;
      const wait = Math.max(0, MIN_HOLD_MS - elapsed);
      dismissId = setTimeout(beginFade, wait);
    }

    // Hard cap: never strand the user on the splash if backend is slow
    // or the ready signal never fires (offline / failed request).
    const capId = setTimeout(() => {
      if (!mounted || dismissId !== null) return;
      dismissId = setTimeout(beginFade, 0);
    }, MAX_HOLD_MS);

    // The overlay signal is the ONLY required gate. The old second gate
    // (cmdCentreDataReady from the deprecated pages/home.tsx) never fires
    // on the current "/" route, and requiring it stranded every login on
    // the splash for the full MAX_HOLD_MS cap.
    function trySchedule() {
      if (homeOverlayReady) scheduleDismiss();
    }
    const unsub = subscribeHomeOverlayReady(trySchedule);

    return () => {
      mounted = false;
      clearInterval(tickId);
      clearTimeout(capId);
      if (dismissId) clearTimeout(dismissId);
      if (fadeId) clearTimeout(fadeId);
      unsub();
    };
  }, [show]);

  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="RM ONE Command Center initializing"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: Z.SPLASH,
        // Fully opaque backdrop: the app is busy loading/re-rendering behind
        // this splash, and a translucent+blurred backdrop let every one of
        // those repaints flash through as distracting blinking. Solid colour
        // hides all of that churn (and skips the costly backdrop blur).
        background: "#0A1118",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: fadingOut ? 0 : 1,
        transition: "opacity 0.55s ease-in-out",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes cmd-pulse-out {
          0%   { transform: scale(0.45); opacity: 0.0; }
          15%  { opacity: 0.55; }
          70%  { opacity: 0.18; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes cmd-core-breath {
          0%, 100% { transform: scale(1);    box-shadow: 0 0 50px ${Colors.greenGlow}; }
          50%      { transform: scale(1.08); box-shadow: 0 0 90px ${Colors.greenGlow}; }
        }
        @keyframes cmd-orbit {
          from { transform: translate(-50%, -50%) rotate(0deg); }
          to   { transform: translate(-50%, -50%) rotate(360deg); }
        }
        @keyframes cmd-grid-shift {
          0%   { background-position: 0 0; }
          100% { background-position: 44px 44px; }
        }
        @keyframes cmd-step-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes cmd-bar-sweep {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>

      {/* Animated grid background */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            linear-gradient(to right, rgba(107,165,57,0.06) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(107,165,57,0.06) 1px, transparent 1px)
          `,
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(circle at 50% 45%, black 0%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(circle at 50% 45%, black 0%, transparent 70%)",
          animation: "cmd-grid-shift 6s linear infinite",
          pointerEvents: "none",
        }}
      />

      {/* Counter-rotating orbit rings (give the "AI agents working" feel) */}
      {[
        { size: 320, dur: 14 },
        { size: 460, dur: 22 },
        { size: 600, dur: 30 },
      ].map((o, i) => (
        <div
          key={i}
          aria-hidden
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: o.size,
            height: o.size,
            borderRadius: "50%",
            border: `1px solid rgba(107,165,57,${0.18 - i * 0.04})`,
            animation: `cmd-orbit ${o.dur}s linear infinite ${i % 2 === 0 ? "" : "reverse"}`,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -4, left: "50%", marginLeft: -4,
              width: 8, height: 8, borderRadius: "50%",
              backgroundColor: Colors.greenLight,
              boxShadow: `0 0 12px ${Colors.greenLight}`,
            }}
          />
        </div>
      ))}

      {/* Pulse ring stack — three expanding rings continuously, like the
          System Health page hero, plus a steady inner core. */}
      <div style={{ position: "relative", width: 220, height: 220, marginBottom: 28 }}>
        {[0, 0.6, 1.2].map((delay, i) => (
          <div
            key={i}
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              border: `2px solid ${Colors.green}`,
              animation: `cmd-pulse-out 2.4s ease-out ${delay}s infinite`,
              pointerEvents: "none",
            }}
          />
        ))}
        {/* Supplied RM ONE wordmark with breathing animation */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 180,
            height: 48,
            marginLeft: -90,
            marginTop: -24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: "cmd-core-breath 2.4s ease-in-out infinite",
          }}
        >
          <img
            src={`${import.meta.env.BASE_URL}rm-one-logo.png`}
            alt="RM ONE"
            style={{
              width: 158,
              height: "auto",
              display: "block",
              // Remove the dark matte baked into the supplied wordmark while
              // leaving the existing loader background unchanged.
              mixBlendMode: "screen",
            }}
          />
        </div>
      </div>

      <div
        style={{
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 4,
          textTransform: "uppercase",
          color: Colors.textMuted,
          marginBottom: 26,
        }}
      >
        AI Agents · Command Center
      </div>

      {/* Step ticker — shows progress through synthetic startup steps.
          FIXED height (3 rows + padding): with minHeight the box grew as
          rows 2 and 3 appeared, pushing the progress bar and caption down
          mid-animation — part of the "shaking" feel. */}
      <div
        style={{
          height: 102,
          overflow: "hidden",
          width: 320,
          maxWidth: "85vw",
          padding: "14px 18px",
          borderRadius: 14,
          backgroundColor: "rgba(255,255,255,0.03)",
          border: `1px solid ${Colors.border}`,
        }}
      >
        {STEPS.slice(Math.max(0, stepIdx - 2), stepIdx + 1).map((label, i, arr) => {
          const isCurrent = i === arr.length - 1;
          const isLast = stepIdx === STEPS.length - 1 && isCurrent;
          return (
            <div
              // Key by the step LABEL (stable identity): keying by stepIdx
              // remounted every visible row on each tick, replaying the
              // slide-in animation on all three rows at once — a constant
              // visual "shake". With stable keys only the NEW row animates.
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "5px 0",
                fontSize: 12.5,
                color: isCurrent ? Colors.white : Colors.textFaint,
                fontWeight: isCurrent ? 600 : 500,
                animation: "cmd-step-in 0.35s ease-out",
              }}
            >
              {isCurrent && !isLast ? (
                <span
                  aria-hidden
                  style={{
                    width: 14, height: 14, borderRadius: "50%",
                    border: `2px solid ${Colors.green}`,
                    borderTopColor: "transparent",
                    animation: "cmd-orbit 0.8s linear infinite",
                    flexShrink: 0,
                  }}
                />
              ) : (
                <span
                  aria-hidden
                  style={{
                    width: 14, height: 14, borderRadius: "50%",
                    backgroundColor: isCurrent ? Colors.green : "transparent",
                    border: `1.5px solid ${isCurrent ? Colors.greenLight : "rgba(107,165,57,0.4)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: Colors.white, fontSize: 9, fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {!isCurrent || isLast ? "✓" : ""}
                </span>
              )}
              <span style={{ flex: 1 }}>{label}</span>
            </div>
          );
        })}
      </div>

      {/* Sweeping progress bar */}
      <div
        style={{
          marginTop: 22,
          width: 220,
          height: 3,
          borderRadius: 2,
          backgroundColor: "rgba(255,255,255,0.06)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            height: "100%",
            width: "50%",
            background: `linear-gradient(90deg, transparent, ${Colors.green}, ${Colors.greenLight}, transparent)`,
            animation: "cmd-bar-sweep 1.4s ease-in-out infinite",
          }}
        />
      </div>

      <div
        style={{
          marginTop: 14,
          fontSize: 10,
          letterSpacing: 2,
          color: Colors.textFaint,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        FETCHING REAL-TIME DATA
      </div>
    </div>
  );
}

/**
 * Compact, page-scoped processing overlay using the same RM ONE visual
 * language as the post-login splash (orbits, breathing core, sweeping
 * bar) but without the step-ticker / session-storage gating. Render it
 * conditionally inside any page that needs a "we're working on it"
 * full-bleed cover. Pure presentational — caller controls when it
 * mounts/unmounts.
 */
const DEFAULT_PROJECT_STAGES = [
  "Fetching project record",
  "Loading team allocations",
  "Pulling pricing & financials",
  "Calculating health gauge",
  "Rendering dashboard",
];

export function RmOneProcessing({
  label = "Loading…",
  sublabel = "FETCHING REAL-TIME DATA",
  stages = DEFAULT_PROJECT_STAGES,
  stageIntervalMs = 750,
  light = false,
}: { label?: string; sublabel?: string; stages?: string[]; stageIntervalMs?: number; light?: boolean }) {
  // Walk through the stages one at a time so the popup feels like
  // real work is happening (not a static spinner). Holds on the
  // last stage indefinitely if loading drags on so we never look
  // "done" while the parent is still waiting.
  const [activeIdx, setActiveIdx] = useState(0);
  const { mode } = useTheme();
  // In dark mode the "light" prop is always ignored — the popup must
  // follow the app's theme rather than forcing a white card.
  const effectiveLight = light && mode !== "dark";
  useEffect(() => {
    if (stages.length <= 1) return;
    const id = window.setInterval(() => {
      setActiveIdx((i) => (i < stages.length - 1 ? i + 1 : i));
    }, stageIntervalMs);
    return () => window.clearInterval(id);
  }, [stages.length, stageIntervalMs]);

  // Compact processing popup — replaces the previous full-viewport orbit
  // animation. Renders a small, centered card with a subtle backdrop so
  // the page is still partially visible underneath while the user waits.
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: Z.FULLSCREEN_LOADER,
        background: effectiveLight ? "rgba(248,250,252,0.72)" : "rgba(8, 14, 20, 0.55)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: "rmone-fade-in 0.2s ease-out",
      }}
    >
      <style>{`
        @keyframes rmone-mini-pulse {
          0%   { transform: scale(0.6); opacity: 0.0; }
          25%  { opacity: 0.6; }
          100% { transform: scale(1.55); opacity: 0; }
        }
        @keyframes rmone-mini-breath {
          0%, 100% { transform: scale(1);    box-shadow: 0 0 18px ${Colors.greenGlow}; }
          50%      { transform: scale(1.06); box-shadow: 0 0 28px ${Colors.greenGlow}; }
        }
        @keyframes rmone-bar-sweep {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>

      <div
        style={{
          minWidth: 280,
          maxWidth: 360,
          padding: "18px 20px 16px",
          borderRadius: 14,
          backgroundColor: effectiveLight ? "#ffffff" : "var(--rm-panel)",
          border: effectiveLight ? "1px solid rgba(107,165,57,0.22)" : "1px solid rgba(107,165,57,0.28)",
          boxShadow: effectiveLight
            ? "0 8px 32px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)"
            : "0 10px 40px rgba(0,0,0,0.55), 0 0 0 1px var(--rm-panel-border) inset",
          display: "flex",
          alignItems: "flex-start",
          gap: 14,
        }}
      >
        {/* Compact pulse + RM core */}
        <div style={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}>
          {[0, 0.7].map((delay, i) => (
            <div
              key={i}
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                border: `1.5px solid ${Colors.green}`,
                animation: `rmone-mini-pulse 1.8s ease-out ${delay}s infinite`,
                willChange: "transform",
                pointerEvents: "none",
              }}
            />
          ))}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: 32,
              height: 32,
              marginLeft: -16,
              marginTop: -16,
              borderRadius: "50%",
              backgroundColor: Colors.green,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: Colors.white,
              fontWeight: 800,
              fontSize: 11,
              letterSpacing: 0.4,
              fontFamily: "Inter, system-ui, sans-serif",
              animation: "rmone-mini-breath 1.8s ease-in-out infinite",
              border: `1.5px solid ${Colors.greenLight}`,
            }}
          >
            RM
          </div>
        </div>

        {/* Header label + step list + sweep bar */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "Inter, system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 13,
              color: effectiveLight ? "#1C2D3A" : "var(--rm-text)",
              marginBottom: 10,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {label}
          </div>

          {/* Stage checklist — each row shows a tiny status indicator
              (✓ done, animated dot for in-progress, faint dot for queued)
              followed by the stage label so the popup feels like real
              work being done rather than a blind spinner. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
            {stages.map((s, i) => {
              const done = i < activeIdx;
              const active = i === activeIdx;
              const color = done ? Colors.green : active ? Colors.greenLight : (effectiveLight ? "#C5D0D8" : "var(--rm-text-faint)");
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: 11.5,
                  fontFamily: "Inter, system-ui, sans-serif",
                  color: effectiveLight
                    ? (done ? "#6B7E8A" : active ? "#1C2D3A" : "#B0BEC8")
                    : (done ? "var(--rm-text-muted)" : active ? "var(--rm-text)" : "var(--rm-text-faint)"),
                  fontWeight: active ? 600 : 500,
                  transition: "color 0.2s",
                }}>
                  <span style={{
                    width: 12, height: 12, borderRadius: "50%",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                    backgroundColor: done ? Colors.green : "transparent",
                    border: done ? "none" : `1.5px solid ${color}`,
                    color: Colors.white, fontSize: 9, fontWeight: 800, lineHeight: 1,
                    animation: active ? "rmone-mini-breath 1.2s ease-in-out infinite" : undefined,
                  }}>
                    {done ? "✓" : ""}
                  </span>
                  <span style={{
                    overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
                  }}>{s}</span>
                </div>
              );
            })}
          </div>

          <div
            style={{
              width: "100%",
              height: 2,
              borderRadius: 2,
              backgroundColor: effectiveLight ? "rgba(0,0,0,0.07)" : "var(--rm-panel-soft)",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0, left: 0, height: "100%", width: "45%",
                background: `linear-gradient(90deg, transparent, ${Colors.green}, ${Colors.greenLight}, transparent)`,
                animation: "rmone-bar-sweep 1.4s ease-in-out infinite",
                willChange: "transform",
              }}
            />
          </div>

          {sublabel && (
            <div
              style={{
                marginTop: 8,
                fontSize: 9,
                letterSpacing: 1.6,
                color: effectiveLight ? "#9BAAB5" : "var(--rm-text-faint)",
                fontFamily: "ui-monospace, monospace",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {sublabel}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
