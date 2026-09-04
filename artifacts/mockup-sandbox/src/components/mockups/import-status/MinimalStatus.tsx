import { useState, useEffect } from "react";

const STAGES = [
  { label: "People", icon: "👥", done: true },
  { label: "Companies", icon: "🏢", done: true },
  { label: "Projects", icon: "📁", active: true },
  { label: "Assignments", icon: "📅", done: false },
  { label: "Sync", icon: "☁️", done: false },
];

const MODULES = [
  { label: "Projects", n: 8, color: "#6366f1" },
  { label: "Opportunities", n: 10, color: "#8b5cf6" },
];

const QUOTES = [
  "Turning spreadsheets into a single source of truth.",
  "Building your command centre, one record at a time.",
  "Aligning your people, projects, and pipeline.",
  "Visibility today, smarter decisions tomorrow.",
];

export function MinimalStatus() {
  const [pct, setPct] = useState(38);
  const [quoteIdx, setQuoteIdx] = useState(0);
  const [displayPct, setDisplayPct] = useState(38);

  useEffect(() => {
    const t = setInterval(() => {
      setPct(p => Math.min(93, p + Math.random() * 0.8));
    }, 700);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const step = setInterval(() => {
      setDisplayPct(p => {
        if (Math.abs(p - pct) < 0.5) return pct;
        return p + (pct - p) * 0.08;
      });
    }, 16);
    return () => clearInterval(step);
  }, [pct]);

  useEffect(() => {
    const t = setInterval(() => setQuoteIdx(i => (i + 1) % QUOTES.length), 4500);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #f8faff 0%, #f0f4ff 50%, #faf5ff 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "32px 16px",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 560 }}>

        {/* Back */}
        <div style={{ marginBottom: 28 }}>
          <button style={{
            display: "flex", alignItems: "center", gap: 6,
            color: "#94a3b8", background: "none", border: "none",
            cursor: "pointer", fontSize: 13, padding: "4px 0",
          }}>
            ← Back
          </button>
        </div>

        {/* Card */}
        <div style={{
          background: "#ffffff",
          borderRadius: 20,
          boxShadow: "0 2px 4px rgba(0,0,0,0.03), 0 12px 40px rgba(99,102,241,0.08), 0 0 0 1px rgba(99,102,241,0.06)",
          overflow: "hidden",
        }}>

          {/* Top color bar */}
          <div style={{
            height: 3,
            background: `linear-gradient(90deg, #6366f1 ${displayPct}%, #e2e8f0 ${displayPct}%)`,
            transition: "background 0.6s ease",
          }} />

          <div style={{ padding: "36px 40px" }}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 32 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%", background: "#6366f1",
                    animation: "blink 1.4s ease-in-out infinite",
                  }} />
                  <span style={{ fontSize: 12, color: "#6366f1", fontWeight: 600, letterSpacing: "0.06em" }}>
                    IMPORTING
                  </span>
                </div>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.4px" }}>
                  file1_single_tab_all_pmm.xlsx
                </h2>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#94a3b8" }}>
                  Tenant: TEST7 · 18 records total
                </p>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 180 }}>
                {MODULES.map(m => (
                  <span key={m.label} style={{
                    padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                    color: "#fff", background: m.color,
                  }}>
                    {m.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Big % */}
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{
                fontSize: 72, fontWeight: 800, color: "#0f172a",
                lineHeight: 1, letterSpacing: "-4px",
                fontVariantNumeric: "tabular-nums",
              }}>
                {Math.round(displayPct)}
                <span style={{ fontSize: 32, fontWeight: 600, color: "#94a3b8", letterSpacing: "-1px" }}>%</span>
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>
                {QUOTES[quoteIdx]}
              </p>
            </div>

            {/* Progress track */}
            <div style={{
              height: 8, background: "#f1f5f9", borderRadius: 99, overflow: "hidden", marginBottom: 28,
            }}>
              <div style={{
                height: "100%", width: `${displayPct}%`,
                background: "linear-gradient(90deg, #6366f1, #8b5cf6)",
                borderRadius: 99, transition: "width 0.5s ease",
                position: "relative", overflow: "hidden",
              }}>
                <div style={{
                  position: "absolute", inset: 0,
                  background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)",
                  backgroundSize: "200px 100%",
                  animation: "shim 1.6s linear infinite",
                }} />
              </div>
            </div>

            {/* Stage pills */}
            <div style={{
              display: "flex", justifyContent: "space-between", marginBottom: 28,
              position: "relative",
            }}>
              {/* Connector line */}
              <div style={{
                position: "absolute", top: 16, left: 16, right: 16, height: 2,
                background: "#f1f5f9", zIndex: 0,
              }} />
              {STAGES.map((s, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, zIndex: 1 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: s.done ? "#6366f1" : s.active ? "#f0f4ff" : "#f8faff",
                    border: s.done ? "none" : s.active ? "2px solid #6366f1" : "2px solid #e2e8f0",
                    fontSize: 14,
                    boxShadow: s.active ? "0 0 0 4px rgba(99,102,241,0.12)" : "none",
                    transition: "all 0.3s",
                  }}>
                    {s.done ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <span style={{ opacity: s.active ? 1 : 0.3 }}>{s.icon}</span>
                    )}
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: "0.02em",
                    color: s.done ? "#6366f1" : s.active ? "#0f172a" : "#cbd5e1",
                  }}>{s.label}</span>
                </div>
              ))}
            </div>

            {/* Module breakdown */}
            <div style={{
              background: "#f8faff", borderRadius: 12, padding: "16px 20px",
              display: "flex", gap: 16,
            }}>
              {MODULES.map(m => (
                <div key={m.label} style={{
                  flex: 1, background: "#fff", borderRadius: 10,
                  padding: "12px 16px", border: "1px solid #e2e8f0",
                }}>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4, fontWeight: 500 }}>{m.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: m.color }}>{m.n}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>records queued</div>
                </div>
              ))}
              <div style={{
                flex: 1, background: "#fff", borderRadius: 10,
                padding: "12px 16px", border: "1px solid #e2e8f0",
              }}>
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4, fontWeight: 500 }}>Est. time</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#0f172a" }}>~2m</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>remaining</div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: "14px 40px", background: "#fafafa", borderTop: "1px solid #f1f5f9",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ color: "#94a3b8", fontSize: 12 }}>
              ☁️ Running server-side — safe to close this tab
            </span>
            <button style={{
              padding: "6px 16px", borderRadius: 8, fontSize: 12,
              border: "1px solid #fecaca", background: "#fff5f5",
              color: "#ef4444", cursor: "pointer", fontWeight: 500,
            }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
        @keyframes shim {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}
