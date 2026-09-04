import { Info, Users, MapPin, Calendar, DollarSign } from "lucide-react";
import { BRAND, PROJECTS, KPIS, valueColor, barColor, useSection } from "./_data";

function KpiPair({ a, b }: { a: typeof KPIS[number]; b: typeof KPIS[number] }) {
  const renderHalf = (k: typeof KPIS[number]) => (
    <div style={{ flex: 1, padding: "6px 10px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "#1B2B38", fontWeight: 600 }}>{k.label}</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: valueColor(k.value) }}>{k.value}</span>
      </div>
      <div style={{ height: 4, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.08)", marginTop: 3, overflow: "hidden" }}>
        <div style={{ width: `${k.value}%`, height: "100%", backgroundColor: barColor(k.value) }} />
      </div>
    </div>
  );
  return (
    <div style={{ display: "flex", backgroundColor: "#fff", border: "1px solid rgba(0,0,0,0.08)",
      borderRadius: 10, overflow: "hidden" }}>
      {renderHalf(a)}
      <div style={{ width: 1, backgroundColor: "rgba(0,0,0,0.08)" }} />
      {renderHalf(b)}
    </div>
  );
}

function SplitCard({ p }: { p: typeof PROJECTS[number] }) {
  const healthC = valueColor(p.health);
  return (
    <div style={{
      backgroundColor: BRAND.cardWhite, color: BRAND.cardText,
      borderRadius: 14, border: "1px solid #E8EDF2", boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      display: "grid", gridTemplateColumns: "1.4fr 1fr", overflow: "hidden", cursor: "pointer",
    }}>
      <div style={{ padding: "12px 14px", borderRight: "1px solid #F1F4F7" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 10px", borderRadius: 999,
            backgroundColor: p.phaseColor + "18", border: `1px solid ${p.phaseColor}50` }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: p.phaseColor }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: p.phaseColor }}>{p.phase}</span>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4, color: BRAND.cardMuted, fontSize: 11 }}>
            <MapPin size={9} /><span>{p.city}</span>
          </div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{p.name}</div>
        <div style={{ fontSize: 11, color: BRAND.cardMuted, marginTop: 2, marginBottom: 8 }}>{p.id}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={{ flex: 1, padding: "7px 0", borderRadius: 8, backgroundColor: BRAND.green, color: "#fff",
            fontSize: 11, fontWeight: 700, border: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
            <Info size={11} /> Details
          </button>
          <button style={{ flex: 1, padding: "7px 0", borderRadius: 8, backgroundColor: "transparent",
            color: BRAND.green, border: `1px solid ${BRAND.green}60`,
            fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
            <Users size={11} /> Team
          </button>
        </div>
      </div>
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, backgroundColor: "#FAFBFC" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ width: 44, height: 44, borderRadius: 999, border: `3px solid ${healthC}`,
            display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: healthC + "12" }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: healthC }}>{p.health}</span>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: BRAND.cardMuted, fontWeight: 700, letterSpacing: 1 }}>CONTRACT</div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{p.value}</div>
          </div>
        </div>
        <div style={{ fontSize: 10, color: BRAND.cardMuted, display: "flex", alignItems: "center", gap: 4 }}>
          <Calendar size={10} /> {p.actualRange ?? p.targetRange}
        </div>
        <div style={{ fontSize: 11, color: "#2F6E1F", fontWeight: 700 }}>
          {p.staffing.count} reqs · avg {p.staffing.avg}% · ~{p.staffing.fte} FTE
        </div>
      </div>
    </div>
  );
}

export function V4Split() {
  const section = useSection();
  const pairs: [typeof KPIS[number], typeof KPIS[number]][] = [];
  for (let i = 0; i < KPIS.length; i += 2) pairs.push([KPIS[i], KPIS[i + 1]]);
  return (
    <div style={{ minHeight: "100vh", backgroundColor: BRAND.bgDeep, padding: 20, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ color: "#fff", fontSize: 11, fontWeight: 700, letterSpacing: 1, opacity: 0.6, marginBottom: 8 }}>
        V4 — SPLIT-PANE CARDS
      </div>
      <div style={{ color: BRAND.greenLight, fontSize: 12, marginBottom: 14 }}>
        Each card uses its width — left pane carries identity & actions, right pane carries metrics. Wider screens fill with substance, not whitespace.
      </div>

      {section !== "projects" && (
        <>
          <div style={{ color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: 1.5, opacity: 0.55, marginBottom: 6 }}>
            HOME · KPI PAIRS
          </div>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", marginBottom: 18 }}>
            {pairs.map(([a, b]) => <KpiPair key={a.label} a={a} b={b} />)}
          </div>
        </>
      )}

      {section !== "home" && (
        <>
          <div style={{ color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: 1.5, opacity: 0.55, marginBottom: 6 }}>
            PROJECTS · SPLIT CARDS
          </div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(440px, 1fr))" }}>
            {PROJECTS.map((p) => <SplitCard key={p.id} p={p} />)}
          </div>
        </>
      )}
    </div>
  );
}
