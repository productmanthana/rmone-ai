const BG = "#0B1623";
const CARD = "#0F1E2D";
const BORDER = "rgba(255,255,255,0.08)";
const MUTED = "rgba(255,255,255,0.45)";
const TEXT = "#E2E8F0";
const GREEN = "#8EC94A";
const BLUE = "#38BDF8";

// Per-tenant data matching the reference screenshot
const features = [
  { name: "Manager View",  liro: 521,  gei: 3472 },
  { name: "Weekly Team",   liro: 56,   gei: 1514 },
  { name: "Projects",      liro: 17,   gei: 1512 },
  { name: "Resource Mgmt", liro: 132,  gei: 986  },
  { name: "AnalyticsCenter",liro: 114,  gei: 0   },
  { name: "Home",          liro: 26,   gei: 26   },
  { name: "DataImport",    liro: 5,    gei: 0    },
  { name: "Forecast",      liro: 3,    gei: 0    },
];

export default function MostUsedFeaturesCard() {
  const maxVal = Math.max(...features.flatMap(f => [f.liro, f.gei]));

  return (
    <div style={{ background: BG, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ width: 460, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 14px", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, letterSpacing: "-0.01em" }}>Most Used Features</div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>Human page visits during the observation period</div>
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 10, marginTop: 2 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: MUTED }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: GREEN, display: "inline-block" }} /> Liro
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: MUTED }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: BLUE, display: "inline-block" }} /> GEI
              </span>
            </div>
          </div>
        </div>

        {/* Feature rows */}
        <div style={{ padding: "10px 0" }}>
          {features.map((f) => (
            <div key={f.name} style={{ padding: "6px 24px" }}>
              <div style={{ fontSize: 11.5, color: TEXT, fontWeight: 600, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {f.name}
              </div>
              {/* Liro bar */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <div style={{ flex: 1, height: 7, borderRadius: 3, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 3, width: `${Math.max(1, Math.round((f.liro / maxVal) * 100))}%`, background: GREEN }} />
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: GREEN, minWidth: 36, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{f.liro.toLocaleString()}</span>
              </div>
              {/* GEI bar */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ flex: 1, height: 7, borderRadius: 3, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 3, width: `${Math.max(f.gei > 0 ? 1 : 0, Math.round((f.gei / maxVal) * 100))}%`, background: BLUE }} />
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: BLUE, minWidth: 36, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{f.gei.toLocaleString()}</span>
              </div>
            </div>
          ))}
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
