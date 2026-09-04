// @ts-nocheck -- design mockup, excluded from strict typecheck
import { ChevronRight, MapPin } from "lucide-react";
import { BRAND, PROJECTS, KPIS, valueColor, barColor, useSection } from "./_data";

function MicroKpi({ k }: { k: typeof KPIS[number] }) {
  return (
    <div style={{ backgroundColor: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 8,
      padding: "6px 8px", display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: "#1B2B38", fontWeight: 600, whiteSpace: "nowrap",
          overflow: "hidden", textOverflow: "ellipsis" }}>{k.label}</div>
        <div style={{ height: 3, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.08)", marginTop: 3, overflow: "hidden" }}>
          <div style={{ width: `${k.value}%`, height: "100%", backgroundColor: barColor(k.value) }} />
        </div>
      </div>
      <span style={{ fontSize: 13, fontWeight: 800, color: valueColor(k.value), tabularNums: true }}>{k.value}</span>
    </div>
  );
}

function DenseRow({ p }: { p: typeof PROJECTS[number] }) {
  const healthC = valueColor(p.health);
  return (
    <div style={{
      backgroundColor: "#fff", color: BRAND.cardText, borderRadius: 10,
      padding: "8px 12px", border: "1px solid #E8EDF2", display: "flex",
      alignItems: "center", gap: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04)", cursor: "pointer",
    }}>
      <div style={{ width: 36, height: 36, borderRadius: 999, border: `2px solid ${healthC}`,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        backgroundColor: healthC + "12" }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: healthC }}>{p.health}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, flexWrap: "wrap" }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: p.phaseColor, letterSpacing: 0.5,
            padding: "1px 6px", borderRadius: 4, backgroundColor: p.phaseColor + "18" }}>{p.phase.toUpperCase()}</span>
          <span style={{ fontSize: 10, color: BRAND.cardMuted, display: "inline-flex", alignItems: "center", gap: 3 }}>
            <MapPin size={8} />{p.city}
          </span>
          <span style={{ fontSize: 10, color: BRAND.cardMuted }}>· {p.id}</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {p.name}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{p.value}</div>
        <div style={{ fontSize: 9, color: "#2F6E1F", fontWeight: 700, letterSpacing: 0.5 }}>
          {p.staffing.count} staff · {p.staffing.fte} FTE
        </div>
      </div>
      <ChevronRight size={16} color={BRAND.cardMuted} style={{ flexShrink: 0 }} />
    </div>
  );
}

export function V3Dense() {
  const section = useSection();
  return (
    <div style={{ minHeight: "100vh", backgroundColor: BRAND.bgDeep, padding: 20, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ color: "#fff", fontSize: 11, fontWeight: 700, letterSpacing: 1, opacity: 0.6, marginBottom: 8 }}>
        V3 — DENSE INFO TABLE
      </div>
      <div style={{ color: BRAND.greenLight, fontSize: 12, marginBottom: 14 }}>
        Cards collapse into single-row tiles. Health gauge + phase badge + name + value + staffing read like a table row, so 3× more fits per screen.
      </div>

      {section !== "projects" && (
        <>
          <div style={{ color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: 1.5, opacity: 0.55, marginBottom: 6 }}>
            HOME · MICRO KPIs
          </div>
          <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", marginBottom: 18 }}>
            {KPIS.map((k) => <MicroKpi key={k.label} k={k} />)}
          </div>
        </>
      )}

      {section !== "home" && (
        <>
          <div style={{ color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: 1.5, opacity: 0.55, marginBottom: 6 }}>
            PROJECTS · DENSE LIST
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...PROJECTS, ...PROJECTS.slice(0, 2)].map((p, i) => <DenseRow key={i} p={p} />)}
          </div>
        </>
      )}
    </div>
  );
}
