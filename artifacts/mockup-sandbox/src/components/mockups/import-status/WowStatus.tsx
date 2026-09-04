// @ts-nocheck -- design mockup, excluded from strict typecheck
import { useState, useEffect, useRef } from "react";

const QUOTES = [
  "Aligning your people, projects, and pipeline…",
  "Turning spreadsheets into a single source of truth.",
  "Mapping every team member to the right role.",
  "Great resource planning starts with clean data.",
  "Connecting allocations to the work that matters.",
  "Building your command centre, one record at a time.",
  "Visibility today, smarter decisions tomorrow.",
];

const MODULES = [
  { label: "Projects", color: "#3b82f6", bg: "rgba(59,130,246,0.15)", uploaded: true },
  { label: "Opportunities", color: "#8b5cf6", bg: "rgba(139,92,246,0.15)", uploaded: true },
  { label: "Staff / Team", color: "#10b981", bg: "rgba(16,185,129,0.15)", uploaded: false },
  { label: "Assignments", color: "#f59e0b", bg: "rgba(245,158,11,0.15)", uploaded: false },
];

const STAGES = [
  { label: "People & Roles",  sublabel: "Staff, divisions, job titles", color: "#3b82f6" },
  { label: "Clients",          sublabel: "Companies, contacts",          color: "#8b5cf6" },
  { label: "Projects",         sublabel: "PMM records, pipeline",        color: "#10b981" },
  { label: "Allocations",      sublabel: "Assignments, schedules",       color: "#f59e0b" },
  { label: "RMOne DB",         sublabel: "Syncing to cloud",             color: "#06b6d4" },
];

function RadialProgress({ pct, isRunning }: { pct: number; isRunning: boolean }) {
  const r = 80;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const step = () => {
      setDisplay(prev => {
        if (prev >= pct) return pct;
        return Math.min(pct, prev + Math.max(0.5, (pct - prev) * 0.06));
      });
    };
    const t = setInterval(step, 16);
    return () => clearInterval(t);
  }, [pct]);

  return (
    <div className="relative flex items-center justify-center" style={{ width: 220, height: 220 }}>
      {/* Outer glow ring */}
      <div style={{
        position: "absolute", inset: -12,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(59,130,246,0.18) 0%, transparent 70%)",
        animation: isRunning ? "pulse-ring 2.4s ease-in-out infinite" : "none",
      }} />

      <svg width={220} height={220} style={{ position: "absolute", transform: "rotate(-90deg)" }}>
        {/* Track */}
        <circle cx={110} cy={110} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={14} />
        {/* Glow effect — same arc, slightly thicker and blurred */}
        <circle
          cx={110} cy={110} r={r} fill="none"
          stroke="url(#progress-glow)" strokeWidth={18}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ filter: "blur(6px)", transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)", opacity: 0.5 }}
        />
        {/* Main arc */}
        <circle
          cx={110} cy={110} r={r} fill="none"
          stroke="url(#progress-gradient)" strokeWidth={14}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)" }}
        />
        <defs>
          <linearGradient id="progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="50%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
          <linearGradient id="progress-glow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
      </svg>

      {/* Center content */}
      <div style={{ position: "relative", textAlign: "center" }}>
        <div style={{
          fontSize: 42, fontWeight: 800, lineHeight: 1,
          background: "linear-gradient(135deg, #e2e8f0, #94a3b8)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          letterSpacing: "-2px",
        }}>
          {Math.round(display)}%
        </div>
        {isRunning && (
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%", background: "#3b82f6",
              animation: "dot-bounce 1.2s 0s ease-in-out infinite",
            }} />
            <div style={{
              width: 6, height: 6, borderRadius: "50%", background: "#8b5cf6",
              animation: "dot-bounce 1.2s 0.2s ease-in-out infinite",
            }} />
            <div style={{
              width: 6, height: 6, borderRadius: "50%", background: "#06b6d4",
              animation: "dot-bounce 1.2s 0.4s ease-in-out infinite",
            }} />
          </div>
        )}
      </div>
    </div>
  );
}

function PipelineNode({
  stage, idx, activeIdx, isLast,
}: { stage: typeof STAGES[0]; idx: number; activeIdx: number; isLast: boolean }) {
  const isDone   = idx < activeIdx;
  const isActive = idx === activeIdx;

  return (
    <div style={{ display: "flex", alignItems: "center", flex: isLast ? "none" : 1 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        {/* Node circle */}
        <div style={{
          width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
          border: `2px solid ${isDone ? "rgba(16,185,129,0.5)" : isActive ? stage.color : "rgba(255,255,255,0.08)"}`,
          background: isDone
            ? "rgba(16,185,129,0.12)"
            : isActive
              ? `${stage.color}22`
              : "rgba(255,255,255,0.03)",
          boxShadow: isActive ? `0 0 20px ${stage.color}55, 0 0 40px ${stage.color}22` : "none",
          transition: "all 0.5s ease",
          position: "relative",
          animation: isActive ? "node-pulse 2s ease-in-out infinite" : "none",
        }}>
          {isDone ? (
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <span style={{
              fontSize: 18,
              opacity: isActive ? 1 : 0.25,
            }}>
              {idx === 0 ? "👥" : idx === 1 ? "🏢" : idx === 2 ? "📁" : idx === 3 ? "📅" : "☁️"}
            </span>
          )}
          {isActive && (
            <div style={{
              position: "absolute", inset: -6, borderRadius: "50%",
              border: `1.5px solid ${stage.color}`,
              opacity: 0.4,
              animation: "ring-expand 1.8s ease-out infinite",
            }} />
          )}
        </div>
        {/* Labels */}
        <div style={{ textAlign: "center", maxWidth: 80 }}>
          <div style={{
            fontSize: 11, fontWeight: 600,
            color: isDone ? "#10b981" : isActive ? stage.color : "rgba(255,255,255,0.25)",
            letterSpacing: "0.02em",
            transition: "color 0.4s",
          }}>{stage.label}</div>
          {isActive && (
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 2, lineHeight: 1.3 }}>
              {stage.sublabel}
            </div>
          )}
        </div>
      </div>

      {/* Connector */}
      {!isLast && (
        <div style={{
          flex: 1, height: 2, margin: "-24px 6px 0",
          background: idx < activeIdx
            ? "linear-gradient(90deg,rgba(16,185,129,0.5),rgba(16,185,129,0.2))"
            : "rgba(255,255,255,0.06)",
          position: "relative",
          overflow: "hidden",
          borderRadius: 2,
        }}>
          {idx === activeIdx - 1 && (
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(90deg,transparent,rgba(59,130,246,0.8),transparent)",
              animation: "pipe-flow 1.4s linear infinite",
            }} />
          )}
        </div>
      )}
    </div>
  );
}

export function WowStatus() {
  const [pct, setPct] = useState(6);
  const [activeIdx, setActiveIdx] = useState(2);
  const [quoteIdx, setQuoteIdx] = useState(0);
  const [phase, setPhase] = useState("Setting up portal configuration…");

  // Simulate progress
  useEffect(() => {
    const t = setInterval(() => {
      setPct(p => {
        if (p >= 93) return p;
        return Math.min(93, p + Math.random() * 1.2);
      });
    }, 800);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setQuoteIdx(i => (i + 1) % QUOTES.length);
    }, 4000);
    return () => clearInterval(t);
  }, []);

  const uploadedModules = MODULES.filter(m => m.uploaded);
  const isRunning = pct < 100;

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0f1e 0%, #0f172a 40%, #0c1022 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "32px 16px", fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <style>{`
        @keyframes pulse-ring {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.04); opacity: 0.7; }
        }
        @keyframes dot-bounce {
          0%, 100% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes ring-expand {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(1.7); opacity: 0; }
        }
        @keyframes node-pulse {
          0%, 100% { box-shadow: 0 0 20px var(--nc) 55, 0 0 40px var(--nc) 22; }
          50% { box-shadow: 0 0 30px var(--nc) 88, 0 0 60px var(--nc) 33; }
        }
        @keyframes pipe-flow {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        @keyframes fade-slide {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0% { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
      `}</style>

      <div style={{ width: "100%", maxWidth: 680 }}>

        {/* Header: Back + status badge */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <button style={{
            display: "flex", alignItems: "center", gap: 6,
            color: "rgba(255,255,255,0.45)", background: "none", border: "none",
            cursor: "pointer", fontSize: 13, padding: "4px 0",
          }}>
            ← Back to Upload
          </button>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.25)",
            borderRadius: 20, padding: "5px 14px",
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%", background: "#3b82f6",
              animation: "pulse-ring 1.5s ease-in-out infinite",
            }} />
            <span style={{ color: "#93c5fd", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em" }}>
              IMPORTING
            </span>
          </div>
        </div>

        {/* Main card */}
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 24, overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset",
        }}>

          {/* Top gradient strip */}
          <div style={{
            height: 2,
            background: "linear-gradient(90deg, #06b6d4, #3b82f6, #8b5cf6, #ec4899)",
            backgroundSize: "400px 2px",
            animation: "shimmer 3s linear infinite",
          }} />

          <div style={{ padding: "36px 40px" }}>

            {/* File info row */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 32 }}>
              <div>
                <div style={{
                  fontSize: 22, fontWeight: 700,
                  color: "rgba(255,255,255,0.9)", letterSpacing: "-0.5px",
                }}>file1_single_tab_all_pmm.xlsx</div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
                  Tenant: <span style={{ color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>TEST7</span>
                  <span style={{ margin: "0 8px", opacity: 0.3 }}>·</span>
                  18 records
                </div>
              </div>
              {/* Uploaded modules chips */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>Modules</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {uploadedModules.map(m => (
                    <span key={m.label} style={{
                      padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                      color: m.color, background: m.bg,
                      border: `1px solid ${m.color}40`,
                    }}>✓ {m.label}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Hero: radial progress + stage info */}
            <div style={{
              display: "flex", alignItems: "center", gap: 40, marginBottom: 36,
              flexWrap: "wrap",
            }}>
              {/* Radial ring */}
              <div style={{ animation: "float 6s ease-in-out infinite" }}>
                <RadialProgress pct={pct} isRunning={isRunning} />
              </div>

              {/* Right side: phase + quote */}
              <div style={{ flex: 1, minWidth: 200 }}>
                {/* Current phase */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)",
                    borderRadius: 8, padding: "6px 12px", marginBottom: 12,
                  }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: "50%", background: "#3b82f6",
                      animation: "pulse-ring 1.2s ease-in-out infinite",
                    }} />
                    <span style={{ color: "#93c5fd", fontSize: 12, fontWeight: 600 }}>
                      {phase}
                    </span>
                    <span style={{ color: "#3b82f6", fontSize: 12, fontWeight: 700 }}>
                      {Math.round(pct)}%
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div style={{
                    height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 6, overflow: "hidden",
                    position: "relative",
                  }}>
                    <div style={{
                      height: "100%", width: `${pct}%`,
                      background: "linear-gradient(90deg, #06b6d4, #3b82f6, #8b5cf6)",
                      borderRadius: 6, transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
                      position: "relative", overflow: "hidden",
                    }}>
                      <div style={{
                        position: "absolute", inset: 0,
                        background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)",
                        backgroundSize: "200px 100%",
                        animation: "shimmer 1.8s linear infinite",
                      }} />
                    </div>
                  </div>
                </div>

                {/* Rotating quote */}
                <div style={{
                  color: "rgba(255,255,255,0.45)", fontSize: 13, fontStyle: "italic", lineHeight: 1.6,
                  animation: "fade-slide 0.5s ease",
                  key: quoteIdx,
                }}>
                  "{QUOTES[quoteIdx]}"
                </div>
              </div>
            </div>

            {/* Pipeline flow */}
            <div style={{
              background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: 16, padding: "20px 24px",
            }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 20 }}>
                Import Pipeline
              </div>
              <div style={{ display: "flex", alignItems: "flex-start" }}>
                {STAGES.map((s, i) => (
                  <PipelineNode
                    key={s.label} stage={s} idx={i}
                    activeIdx={activeIdx} isLast={i === STAGES.length - 1}
                  />
                ))}
              </div>
            </div>

            {/* Footer note */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              marginTop: 20, color: "rgba(255,255,255,0.25)", fontSize: 12,
            }}>
              <span>☁️</span>
              <span>This runs on our servers — you can safely close this tab and check back anytime.</span>
            </div>
          </div>
        </div>

        {/* Cancel button */}
        <div style={{ marginTop: 20, textAlign: "center" }}>
          <button style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 20px", borderRadius: 10,
            border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.06)",
            color: "rgba(239,68,68,0.7)", fontSize: 13, cursor: "pointer",
            transition: "all 0.2s",
          }}>
            ⊘ Cancel Upload
          </button>
        </div>
      </div>
    </div>
  );
}
