import { useState, useEffect } from "react";

const METRICS = [
  { label: "Records Processed", value: "11", total: "18", color: "#f59e0b" },
  { label: "Tables Updated", value: "3", total: "7", color: "#10b981" },
  { label: "Elapsed Time", value: "1m 24s", total: null, color: "#3b82f6" },
  { label: "Errors Found", value: "0", total: null, color: "#22c55e" },
];

const STAGES = [
  { label: "AspNetUsers",      status: "done",    rows: 8 },
  { label: "CRMCompany",       status: "done",    rows: 3 },
  { label: "PMMProjects",      status: "running", rows: 8 },
  { label: "ResourceWorkItems",status: "pending", rows: 18 },
  { label: "ResourceAlloc.",   status: "pending", rows: 18 },
  { label: "Lead",             status: "pending", rows: 0 },
  { label: "Sync & Verify",    status: "pending", rows: null },
];

const LOGS = [
  { t: "08:14:03", msg: "Schema validated — 47 columns matched", ok: true },
  { t: "08:14:05", msg: "AspNetUsers: 8 rows → inserted", ok: true },
  { t: "08:14:08", msg: "CRMCompany: 3 rows → inserted", ok: true },
  { t: "08:14:12", msg: "PMMProjects: processing…", ok: null },
];

const MODULES_UPLOADED = [
  { label: "Projects", color: "#f59e0b" },
  { label: "Opportunities", color: "#3b82f6" },
];

export function ControlRoomStatus() {
  const [pct, setPct] = useState(42);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setPct(p => Math.min(93, p + Math.random() * 0.7));
      setTick(i => i + 1);
    }, 900);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0d1117",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "28px 16px",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 860 }}>

        {/* Top bar */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 20,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button style={{
              color: "#4b5563", background: "none", border: "none",
              cursor: "pointer", fontSize: 13,
            }}>← Back</button>
            <div style={{ width: 1, height: 16, background: "#21262d" }} />
            <span style={{ color: "#8b949e", fontSize: 13 }}>
              Import · file1_single_tab_all_pmm.xlsx
            </span>
            <div style={{ display: "flex", gap: 5 }}>
              {MODULES_UPLOADED.map(m => (
                <span key={m.label} style={{
                  padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                  color: m.color, background: `${m.color}18`,
                  border: `1px solid ${m.color}30`,
                }}>
                  {m.label}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%", background: "#f59e0b",
              animation: "blink-dot 1s ease-in-out infinite",
            }} />
            <span style={{ color: "#8b949e", fontSize: 12, fontWeight: 500 }}>RUNNING</span>
            <span style={{ color: "#4b5563", fontSize: 12, marginLeft: 4 }}>TEST7</span>
          </div>
        </div>

        {/* Progress bar + % */}
        <div style={{
          background: "#161b22", border: "1px solid #21262d", borderRadius: 10,
          padding: "16px 20px", marginBottom: 16,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ color: "#8b949e", fontSize: 12 }}>Overall progress</span>
            <span style={{ color: "#f0f6fc", fontSize: 12, fontWeight: 600 }}>{Math.round(pct)}%</span>
          </div>
          <div style={{ height: 6, background: "#21262d", borderRadius: 99, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${pct}%`,
              background: "linear-gradient(90deg,#f59e0b,#fbbf24)",
              borderRadius: 99, transition: "width 0.7s ease",
              position: "relative", overflow: "hidden",
            }}>
              <div style={{
                position: "absolute", inset: 0,
                background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)",
                backgroundSize: "150px 100%",
                animation: "sweep 1.4s linear infinite",
              }} />
            </div>
          </div>
        </div>

        {/* Main grid: metrics + pipeline */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>

          {/* Metric cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {METRICS.map(m => (
              <div key={m.label} style={{
                background: "#161b22", border: "1px solid #21262d", borderRadius: 10,
                padding: "14px 16px",
              }}>
                <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 6, letterSpacing: "0.03em" }}>
                  {m.label}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                  <span style={{ fontSize: 26, fontWeight: 700, color: m.color }}>{m.value}</span>
                  {m.total && (
                    <span style={{ fontSize: 14, color: "#4b5563", fontWeight: 500 }}>/{m.total}</span>
                  )}
                </div>
                {m.total && (
                  <div style={{ marginTop: 8, height: 3, background: "#21262d", borderRadius: 99 }}>
                    <div style={{
                      height: "100%", width: `${(parseInt(m.value) / parseInt(m.total)) * 100}%`,
                      background: m.color, borderRadius: 99, opacity: 0.7,
                    }} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pipeline stage list */}
          <div style={{
            background: "#161b22", border: "1px solid #21262d", borderRadius: 10, overflow: "hidden",
          }}>
            <div style={{
              padding: "10px 16px", borderBottom: "1px solid #21262d",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: 11, color: "#8b949e", letterSpacing: "0.06em", fontWeight: 600 }}>PIPELINE STAGES</span>
            </div>
            {STAGES.map((s, i) => (
              <div key={i} style={{
                padding: "9px 16px",
                borderBottom: i < STAGES.length - 1 ? "1px solid #161b22" : "none",
                display: "flex", alignItems: "center", gap: 10,
                background: s.status === "running" ? "rgba(245,158,11,0.04)" : "transparent",
              }}>
                {/* Status icon */}
                {s.status === "done" ? (
                  <div style={{
                    width: 16, height: 16, borderRadius: "50%", background: "#22c55e22",
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>
                    <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                ) : s.status === "running" ? (
                  <div style={{
                    width: 16, height: 16, borderRadius: "50%",
                    border: "2px solid #f59e0b",
                    borderTopColor: "transparent",
                    animation: "spin 0.8s linear infinite",
                    flexShrink: 0,
                  }} />
                ) : (
                  <div style={{
                    width: 16, height: 16, borderRadius: "50%",
                    border: "2px solid #21262d", flexShrink: 0,
                  }} />
                )}
                <span style={{
                  fontSize: 12, flex: 1, fontFamily: "'Courier New', monospace",
                  color: s.status === "done" ? "#8b949e" : s.status === "running" ? "#f0f6fc" : "#4b5563",
                }}>
                  {s.label}
                </span>
                {s.rows != null && (
                  <span style={{ fontSize: 11, color: "#4b5563" }}>{s.rows} rows</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Live log */}
        <div style={{
          background: "#0d1117", border: "1px solid #21262d", borderRadius: 10,
          overflow: "hidden",
        }}>
          <div style={{
            padding: "10px 16px", borderBottom: "1px solid #21262d",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%", background: "#22c55e",
              animation: "blink-dot 1s ease-in-out infinite",
            }} />
            <span style={{ fontSize: 11, color: "#8b949e", letterSpacing: "0.06em", fontWeight: 600 }}>LIVE LOG</span>
          </div>
          <div style={{ padding: "8px 0", fontFamily: "'Courier New', monospace", fontSize: 12 }}>
            {LOGS.map((l, i) => (
              <div key={i} style={{
                padding: "4px 16px", display: "flex", gap: 12, alignItems: "center",
              }}>
                <span style={{ color: "#4b5563", flexShrink: 0 }}>{l.t}</span>
                <span style={{
                  color: l.ok === true ? "#22c55e" : l.ok === false ? "#f87171" : "#f59e0b",
                }}>{l.msg}</span>
              </div>
            ))}
            <div style={{ padding: "4px 16px", display: "flex", gap: 12 }}>
              <span style={{ color: "#4b5563" }}>08:15:{(27 + tick) % 60 < 10 ? "0" : ""}{(27 + tick) % 60}</span>
              <span style={{ color: "#f59e0b" }}>
                PMMProjects: processing row {Math.min(8, Math.floor(3 + tick / 3))}/8…
              </span>
            </div>
          </div>
        </div>

        {/* Bottom actions */}
        <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 20 }}>
          <button style={{
            padding: "8px 20px", borderRadius: 8, fontSize: 13,
            border: "1px solid #21262d", background: "#161b22",
            color: "#8b949e", cursor: "pointer",
          }}>
            ☁️ This runs in background
          </button>
          <button style={{
            padding: "8px 20px", borderRadius: 8, fontSize: 13,
            border: "1px solid #30363d", background: "rgba(248,113,113,0.08)",
            color: "#f87171", cursor: "pointer",
          }}>
            Cancel Import
          </button>
        </div>
      </div>
      <style>{`
        @keyframes blink-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.25; }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes sweep {
          0% { background-position: -150px 0; }
          100% { background-position: 400px 0; }
        }
      `}</style>
    </div>
  );
}
