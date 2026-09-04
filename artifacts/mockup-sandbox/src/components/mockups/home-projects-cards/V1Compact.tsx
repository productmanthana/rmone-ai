import { Info, Users, MapPin } from "lucide-react";
import { BRAND, PROJECTS, KPIS, valueColor, barColor, useSection } from "./_data";

const MAX_CARD_W = 380;

function KpiTile({ k }: { k: typeof KPIS[number] }) {
  return (
    <div style={{ backgroundColor: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 10, padding: "8px 10px", maxWidth: 240 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "#1B2B38", fontWeight: 600 }}>{k.label}</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: valueColor(k.value) }}>{k.value}</span>
      </div>
      <div style={{ height: 5, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.08)", marginTop: 4, overflow: "hidden" }}>
        <div style={{ width: `${k.value}%`, height: "100%", backgroundColor: barColor(k.value) }} />
      </div>
    </div>
  );
}

function ProjectCard({ p }: { p: typeof PROJECTS[number] }) {
  return (
    <div style={{
      maxWidth: MAX_CARD_W, backgroundColor: BRAND.cardWhite, color: BRAND.cardText,
      borderRadius: 14, padding: "10px 14px", border: "1px solid #E8EDF2",
      boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
    }}>
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
      <div style={{ fontSize: 11, color: BRAND.cardMuted, marginTop: 2, marginBottom: 6 }}>{p.id}</div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "5px 0", borderTop: "1px solid #F1F4F7" }}>
        <span style={{ fontSize: 9, color: BRAND.cardMuted, fontWeight: 700, letterSpacing: 1 }}>CONTRACT</span>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{p.value}</span>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
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
  );
}

export function V1Compact() {
  const section = useSection();
  return (
    <div style={{ minHeight: "100vh", backgroundColor: BRAND.bgDeep, padding: 20, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ color: "#fff", fontSize: 11, fontWeight: 700, letterSpacing: 1, opacity: 0.6, marginBottom: 8 }}>
        V1 — CAPPED-WIDTH COMPACT ROW
      </div>
      <div style={{ color: BRAND.greenLight, fontSize: 12, marginBottom: 14 }}>
        Cards capped at {MAX_CARD_W}px and left-aligned. Full-bleed stretching is gone; the eye reads top-to-bottom in a tight column.
      </div>

      {section !== "projects" && (
        <>
          <div style={{ color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: 1.5, opacity: 0.55, marginBottom: 6 }}>
            HOME · KPI TILES
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
            {KPIS.slice(0, 4).map((k) => <div key={k.label} style={{ flex: "1 1 220px", maxWidth: 240 }}><KpiTile k={k} /></div>)}
          </div>
        </>
      )}

      {section !== "home" && (
        <>
          <div style={{ color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: 1.5, opacity: 0.55, marginBottom: 6 }}>
            PROJECTS · LIST
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {PROJECTS.map((p) => <ProjectCard key={p.id} p={p} />)}
          </div>
        </>
      )}
    </div>
  );
}
