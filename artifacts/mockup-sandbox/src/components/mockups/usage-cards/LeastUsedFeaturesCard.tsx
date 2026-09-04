const BG = "#0B1623";
const CARD = "#0F1E2D";
const BORDER = "rgba(255,255,255,0.08)";
const MUTED = "rgba(255,255,255,0.45)";
const TEXT = "#E2E8F0";
const GREEN = "#8EC94A";
const RED = "#F87171";

const features = [
  { name: "BillingRates",     visits: 0 },
  { name: "CreateRecord",     visits: 0 },
  { name: "SystemHealth",     visits: 0 },
  { name: "IntelligenceHub",  visits: 1 },
  { name: "Alerts",           visits: 1 },
  { name: "Reports",          visits: 3 },
  { name: "Forecast",         visits: 3 },
];

export default function LeastUsedFeaturesCard() {
  return (
    <div style={{ background: BG, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ width: 460, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 14px", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, letterSpacing: "-0.01em" }}>Least Used Features</div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 3, lineHeight: 1.5 }}>
            Zeros shown honestly — these modules exist and nobody visited them in the window.
          </div>
        </div>

        {/* Feature rows */}
        <div style={{ padding: "10px 0" }}>
          {features.map((f) => {
            const isZero = f.visits === 0;
            return (
              <div key={f.name} style={{
                margin: "4px 20px",
                borderRadius: 8,
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: isZero ? "rgba(248,113,113,0.07)" : "transparent",
                border: isZero ? `1px solid rgba(248,113,113,0.18)` : `1px solid transparent`,
              }}>
                <span style={{ fontSize: 12, fontWeight: isZero ? 600 : 500, color: isZero ? "#FECACA" : TEXT }}>
                  {f.name}
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums",
                  color: isZero ? RED : MUTED,
                  background: isZero ? "rgba(248,113,113,0.12)" : "transparent",
                  border: isZero ? `1px solid rgba(248,113,113,0.25)` : "none",
                  borderRadius: 6,
                  padding: isZero ? "2px 10px" : "2px 0",
                }}>
                  {f.visits === 0 ? "0 visits" : `${f.visits} visit${f.visits !== 1 ? "s" : ""}`}
                </span>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ borderTop: `1px solid ${BORDER}`, padding: "12px 24px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: GREEN, letterSpacing: "0.05em" }}>VIEW DATA · {features.length} ROWS</span>
          <span style={{ flex: 1 }} />
          {["PDF", "Excel"].map(f => (
            <button key={f} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, background: "rgba(255,255,255,0.06)", border: `1px solid ${BORDER}`, color: MUTED, cursor: "pointer" }}>{f}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
