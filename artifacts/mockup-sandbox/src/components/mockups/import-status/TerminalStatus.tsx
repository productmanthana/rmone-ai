import { useState, useEffect, useRef } from "react";

const LINES = [
  "> Connecting to core2 database…",
  "> Authenticating tenant [TEST7]…",
  "✓ Schema validated (47 tables)",
  "> Parsing Excel: file1_single_tab_all_pmm.xlsx",
  "✓ 18 records detected across 2 modules",
  "> Mapping columns → Projects (12 fields)",
  "✓ Projects: 8 rows queued",
  "> Mapping columns → Opportunities (9 fields)",
  "✓ Opportunities: 10 rows queued",
  "> Running pipeline stage 1/5: AspNetUsers…",
  "  [████████████████████] 100% (8 rows)",
  "> Running pipeline stage 2/5: CRMCompany…",
  "  [████████████████    ] 80%  (6 rows)",
  "> Running pipeline stage 3/5: PMMProjects…",
  "  [████████            ] 40%  (3 rows)",
  "> Verifying relationships…",
  "  ⚡ All foreign-key constraints resolved",
];

const MODULES_UPLOADED = [
  { key: "PMM", label: "Projects", count: 8, color: "#22c55e" },
  { key: "OPM", label: "Opportunities", count: 10, color: "#86efac" },
];

export function TerminalStatus() {
  const [visibleLines, setVisibleLines] = useState<string[]>([]);
  const [cursor, setCursor] = useState(true);
  const [pct, setPct] = useState(12);
  const lineRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  // Stream lines in
  useEffect(() => {
    if (lineRef.current >= LINES.length) return;
    const delay = LINES[lineRef.current].startsWith("  [") ? 180 : 480 + Math.random() * 320;
    const t = setTimeout(() => {
      const line = LINES[lineRef.current];
      setVisibleLines(prev => [...prev, line]);
      lineRef.current++;
      setPct(p => Math.min(93, p + (100 / LINES.length)));
    }, delay);
    return () => clearTimeout(t);
  }, [visibleLines]);

  // Cursor blink
  useEffect(() => {
    const t = setInterval(() => setCursor(c => !c), 530);
    return () => clearInterval(t);
  }, []);

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleLines]);

  const barFilled = Math.round(pct / 5);
  const bar = "█".repeat(barFilled) + "░".repeat(20 - barFilled);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0e0a",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "32px 16px",
      fontFamily: "'Courier New', Courier, monospace",
    }}>
      <div style={{ width: "100%", maxWidth: 700 }}>

        {/* Window chrome */}
        <div style={{
          background: "#161b16", border: "1px solid #1f2d1f",
          borderRadius: 10, overflow: "hidden",
          boxShadow: "0 0 60px rgba(34,197,94,0.08), 0 24px 48px rgba(0,0,0,0.8)",
        }}>
          {/* Title bar */}
          <div style={{
            background: "#1a221a", borderBottom: "1px solid #1f2d1f",
            padding: "10px 16px", display: "flex", alignItems: "center", gap: 8,
          }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
            <span style={{ color: "#2d6a2d", fontSize: 12, marginLeft: 8 }}>
              rmone — import-pipeline — TEST7
            </span>
            <span style={{ marginLeft: "auto", color: "#1e4d1e", fontSize: 11 }}>bash</span>
          </div>

          {/* Terminal body */}
          <div style={{
            padding: "20px 24px",
            height: 380,
            overflowY: "auto",
            background: "#0a0e0a",
          }}>
            {/* Header */}
            <div style={{ color: "#22c55e", marginBottom: 16, lineHeight: 1.6 }}>
              <div style={{ fontSize: 13, opacity: 0.5 }}>RMOne Import Engine v2.4.1</div>
              <div style={{ color: "#16a34a", fontSize: 11, opacity: 0.5 }}>──────────────────────────────</div>
            </div>

            {/* Streamed lines */}
            {visibleLines.map((line, i) => {
              const isSuccess = line.startsWith("✓");
              const isProgress = line.startsWith("  [");
              const isWarning = line.startsWith("  ⚡");
              return (
                <div key={i} style={{
                  fontSize: 13, lineHeight: 1.7,
                  color: isSuccess ? "#4ade80"
                    : isProgress ? "#16a34a"
                    : isWarning ? "#fbbf24"
                    : "#86efac",
                  opacity: isProgress ? 0.75 : 1,
                  animation: "line-in 0.15s ease",
                }}>
                  {line}
                </div>
              );
            })}

            {/* Cursor */}
            {lineRef.current < LINES.length && (
              <span style={{
                display: "inline-block", width: 8, height: 16,
                background: cursor ? "#22c55e" : "transparent",
                verticalAlign: "text-bottom", marginTop: 4,
                transition: "background 0.1s",
              }} />
            )}
            <div ref={endRef} />
          </div>

          {/* Progress footer */}
          <div style={{
            background: "#0f160f", borderTop: "1px solid #1a2d1a",
            padding: "14px 24px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ color: "#22c55e", fontSize: 12, fontWeight: 600 }}>IMPORT PROGRESS</span>
              <span style={{ color: "#4ade80", fontSize: 12 }}>{Math.round(pct)}%</span>
            </div>
            <div style={{ color: "#15803d", fontSize: 13, letterSpacing: "0.05em", marginBottom: 10 }}>
              [{bar}] {Math.round(pct)}%
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              {MODULES_UPLOADED.map(m => (
                <span key={m.key} style={{
                  color: m.color, fontSize: 11,
                  background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.15)",
                  borderRadius: 4, padding: "2px 8px",
                }}>
                  ✓ {m.label} ({m.count} rows)
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Footer note */}
        <div style={{ textAlign: "center", marginTop: 16, color: "#1a4d1a", fontSize: 12 }}>
          process running in background · safe to close · check status at /onboarding/history
        </div>
      </div>
      <style>{`
        @keyframes line-in {
          from { opacity: 0; transform: translateX(-4px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
