const BG = "#0B1623";
const CARD = "#0F1E2D";
const BORDER = "rgba(255,255,255,0.08)";
const MUTED = "rgba(255,255,255,0.45)";
const TEXT = "#E2E8F0";
const GREEN = "#8EC94A";
const BLUE = "#38BDF8";
const VIOLET = "#A78BFA";

// Human transactions vs system — with per-type breakdown
const human = [
  { name: "Opened Record",      count: 5,  color: BLUE   },
  { name: "Allocation Update",  count: 1,  color: VIOLET },
];
const system = [
  { name: "Import Pipeline",    count: 47, color: "rgba(255,255,255,0.18)" },
  { name: "Scheduled Jobs",     count: 12, color: "rgba(255,255,255,0.18)" },
];
const allRows = [...human, ...system];
const maxCount = Math.max(...allRows.map(r => r.count));

// Summary numbers
const totalHuman  = human.reduce((a, r) => a + r.count, 0);
const totalSystem = system.reduce((a, r) => a + r.count, 0);
const total = totalHuman + totalSystem;
const humanPct = total > 0 ? Math.round((totalHuman / total) * 100) : 0;

export default function TransactionsByTypeCard() {
  return (
    <div style={{ background: BG, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ width: 460, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 14px", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, letterSpacing: "-0.01em" }}>Transactions by Type</div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>
            What people actually do — human counts, with automated volume shown separately.
          </div>
        </div>

        {/* Human vs System summary bar */}
        <div style={{ padding: "16px 24px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 6, color: MUTED }}>
            <span>{totalHuman} human · {totalSystem} system</span>
            <b style={{ color: humanPct > 50 ? GREEN : "#F0A842" }}>{humanPct}% human</b>
          </div>
          <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.07)" }}>
            <div style={{ width: `${humanPct}%`, background: GREEN, transition: "width 0.3s" }} />
            <div style={{ width: `${100 - humanPct}%`, background: VIOLET, opacity: 0.5 }} />
          </div>
        </div>

        {/* Section: Human */}
        <div style={{ padding: "4px 24px 0" }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: GREEN, marginBottom: 6 }}>Human Actions</div>
          {human.map(r => (
            <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: TEXT, fontWeight: 500, marginBottom: 3 }}>{r.name}</div>
                <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 3, width: `${Math.max(2, Math.round((r.count / maxCount) * 100))}%`, background: r.color }} />
                </div>
              </div>
              <span style={{ fontWeight: 800, fontSize: 13, color: r.color, minWidth: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.count}</span>
            </div>
          ))}
        </div>

        {/* Section: System */}
        <div style={{ padding: "4px 24px 0" }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: MUTED, marginBottom: 6 }}>System / Automated</div>
          {system.map(r => (
            <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 500, marginBottom: 3 }}>{r.name}</div>
                <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 3, width: `${Math.max(2, Math.round((r.count / maxCount) * 100))}%`, background: r.color }} />
                </div>
              </div>
              <span style={{ fontWeight: 800, fontSize: 13, color: MUTED, minWidth: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.count}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ borderTop: `1px solid ${BORDER}`, padding: "12px 24px", display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: GREEN, letterSpacing: "0.05em" }}>VIEW DATA · {allRows.length} ROWS</span>
          <span style={{ flex: 1 }} />
          {["PDF", "Excel"].map(f => (
            <button key={f} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, background: "rgba(255,255,255,0.06)", border: `1px solid ${BORDER}`, color: MUTED, cursor: "pointer" }}>{f}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
