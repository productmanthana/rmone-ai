const BG = "#0B1623";
const CARD = "#0F1E2D";
const BORDER = "rgba(255,255,255,0.08)";
const MUTED = "rgba(255,255,255,0.45)";
const TEXT = "#E2E8F0";
const GREEN = "#8EC94A";
const VIOLET = "#A78BFA";

const rows = [
  { name: "Construction Mgt",   count: 307, adoption: 38 },
  { name: "Civil & Structural", count: 51,  adoption: 47 },
  { name: "MEP",                count: 49,  adoption: 37 },
  { name: "Architecture",       count: 49,  adoption: 39 },
  { name: "NewCo Construction", count: 25,  adoption: 32 },
  { name: "Cold Storage",       count: 7,   adoption: 43 },
  { name: "Telecom",            count: 2,   adoption: 50 },
  { name: "Virtual Design",     count: 2,   adoption: 100 },
];
const maxCount = Math.max(...rows.map(r => r.count));
const SHOW = 7;

export default function UsageBUCard() {
  return (
    <div style={{ background: BG, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ width: 460, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 14px", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, letterSpacing: "-0.01em" }}>Usage by Business Unit</div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>Staff adoption rate by BU — {rows.length} business units</div>
        </div>

        {/* Rows */}
        <div style={{ padding: "12px 0" }}>
          {rows.slice(0, SHOW).map((r) => {
            const barW = Math.max(2, Math.round((r.count / maxCount) * 100));
            const adoptColor = r.adoption >= 40 ? GREEN : r.adoption >= 20 ? "#F0A842" : "#F87171";
            return (
              <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 24px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, color: TEXT, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                  <div style={{ marginTop: 4, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 3, width: `${barW}%`, background: VIOLET }} />
                  </div>
                </div>
                <div style={{ textAlign: "right", minWidth: 60, fontSize: 12 }}>
                  <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: TEXT }}>{r.count.toLocaleString()}</span>
                  <span style={{ marginLeft: 6, fontSize: 10.5, color: adoptColor, fontWeight: 700 }}>{r.adoption}%</span>
                </div>
              </div>
            );
          })}
          {rows.length > SHOW && (
            <div style={{ padding: "6px 24px", fontSize: 10.5, color: MUTED }}>+{rows.length - SHOW} more — click "View data"</div>
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: `1px solid ${BORDER}`, padding: "12px 24px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: GREEN, letterSpacing: "0.05em" }}>VIEW DATA · {rows.length} ROWS</span>
          <span style={{ flex: 1 }} />
          {["PDF", "Excel"].map(f => (
            <button key={f} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, background: "rgba(255,255,255,0.06)", border: `1px solid ${BORDER}`, color: MUTED, cursor: "pointer" }}>{f}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
