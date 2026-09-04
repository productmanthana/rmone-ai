import React, { useEffect, useState } from "react";

const BG = "#0F1A24";
const GREEN = "#6BA539";
const GREEN_LIGHT = "#A9C23F";
const GREEN_GLOW = "rgba(107,165,57,0.55)";
const TEXT_MUTED = "rgba(255,255,255,0.55)";
const TEXT_FAINT = "rgba(255,255,255,0.30)";
const BORDER = "rgba(255,255,255,0.10)";

const STAGES = [
  "Verifying authentication",
  "Connecting to RM ONE",
  "Loading project pipeline",
  "Fetching staffing demands",
  "Building analytics",
  "Preparing your dashboard",
];

export function HomeSkeleton({
  title = "Loading your dashboard",
  subtitle,
  testId = "home-skeleton",
  ariaLabel = "Dashboard loading in progress",
}: {
  title?: string;
  subtitle?: string;
  testId?: string;
  ariaLabel?: string;
} = {}) {
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (STAGES.length <= 1) return;
    const id = window.setInterval(() => {
      setActiveIdx((i) => (i < STAGES.length - 1 ? i + 1 : i));
    }, 1200);
    return () => window.clearInterval(id);
  }, []);

  const visibleStages = STAGES.slice(Math.max(0, activeIdx - 2), activeIdx + 1);

  return (
    <div
      className="min-h-full w-full flex items-center justify-center"
      style={{ backgroundColor: BG, color: "#FFFFFF", minHeight: "100vh" }}
      data-testid={testId}
    >
      <style>{`
        @keyframes hs-mini-pulse {
          0%   { transform: scale(0.6); opacity: 0; }
          20%  { opacity: 0.6; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes hs-core-breath {
          0%, 100% { transform: scale(1);    box-shadow: 0 0 18px ${GREEN_GLOW}; }
          50%      { transform: scale(1.08); box-shadow: 0 0 30px ${GREEN_GLOW}; }
        }
        @keyframes hs-bar-sweep {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(260%); }
        }
        @keyframes hs-step-in {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes hs-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        role="status"
        aria-label={ariaLabel}
        style={{
          minWidth: 300,
          maxWidth: 360,
          padding: "22px 22px 18px",
          borderRadius: 16,
          backgroundColor: "rgba(255,255,255,0.035)",
          border: `1px solid rgba(107,165,57,0.28)`,
          boxShadow: "0 20px 60px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(107,165,57,0.06) inset",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "flex-start",
          gap: 16,
          animation: "hs-fade-in 0.3s ease-out",
        }}
      >
        {/* Pulsing RM core */}
        <div style={{ position: "relative", width: 48, height: 48, flexShrink: 0 }}>
          {[0, 0.65, 1.3].map((delay, i) => (
            <div
              key={i}
              aria-hidden
              style={{
                position: "absolute", inset: 0, borderRadius: "50%",
                border: `1.5px solid ${GREEN}`,
                animation: `hs-mini-pulse 2.2s ease-out ${delay}s infinite`,
                pointerEvents: "none",
              }}
            />
          ))}
          <div
            style={{
              position: "absolute", top: "50%", left: "50%",
              width: 34, height: 34, marginLeft: -17, marginTop: -17,
              borderRadius: "50%", backgroundColor: GREEN,
              border: `1.5px solid ${GREEN_LIGHT}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontWeight: 800, fontSize: 11, letterSpacing: 0.3,
              fontFamily: "Inter, system-ui, sans-serif",
              animation: "hs-core-breath 2.2s ease-in-out infinite",
            }}
          >
            RM
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title + subtitle */}
          <div style={{
            fontSize: 13.5, fontWeight: 700, color: "#fff",
            letterSpacing: "-0.01em", marginBottom: subtitle ? 2 : 10,
          }}>
            {title}
          </div>
          {subtitle && (
            <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 10 }}>{subtitle}</div>
          )}

          {/* Animated step list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 12 }}>
            {visibleStages.map((label, i, arr) => {
              const isCurrent = i === arr.length - 1;
              const isDone = !isCurrent;
              return (
                <div
                  key={`${activeIdx}-${i}`}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    fontSize: 11.5,
                    color: isCurrent ? "#fff" : TEXT_FAINT,
                    fontWeight: isCurrent ? 600 : 400,
                    animation: isCurrent ? "hs-step-in 0.3s ease-out" : undefined,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 13, height: 13, borderRadius: "50%", flexShrink: 0,
                      backgroundColor: isDone ? GREEN : "transparent",
                      border: `1.5px solid ${isCurrent ? GREEN : "rgba(107,165,57,0.35)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#fff", fontSize: 8, fontWeight: 800,
                    }}
                  >
                    {isDone ? "✓" : ""}
                  </span>
                  {label}
                </div>
              );
            })}
          </div>

          {/* Sweeping progress bar */}
          <div style={{
            position: "relative", width: "100%", height: 3, borderRadius: 2,
            backgroundColor: "rgba(255,255,255,0.07)", overflow: "hidden",
          }}>
            <div style={{
              position: "absolute", top: 0, left: 0, height: "100%", width: "38%",
              background: `linear-gradient(90deg, transparent, ${GREEN}, ${GREEN_LIGHT}, transparent)`,
              animation: "hs-bar-sweep 1.5s ease-in-out infinite",
            }} />
          </div>

          {/* Security badge */}
          <div style={{
            marginTop: 8, display: "inline-flex", alignItems: "center", gap: 4,
            fontSize: 9.5, fontWeight: 600, letterSpacing: "0.06em",
            color: "rgba(107,165,57,0.65)", textTransform: "uppercase",
          }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" opacity="0.7"/>
              <path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
            </svg>
            256-bit encrypted · secure connection
          </div>
        </div>
      </div>
    </div>
  );
}
