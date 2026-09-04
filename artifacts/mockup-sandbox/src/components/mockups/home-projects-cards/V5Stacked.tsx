import { MapPin, ChevronRight } from "lucide-react";
import { BRAND, PROJECTS, KPIS, valueColor, barColor, useSection } from "./_data";

function KpiChip({ k }: { k: typeof KPIS[number] }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      backgroundColor: "#fff", border: "1px solid rgba(0,0,0,0.08)",
      borderRadius: 999, padding: "6px 12px",
      boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
    }}>
      <span style={{ fontSize: 10, color: "#1B2B38", fontWeight: 600 }}>{k.label}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color: valueColor(k.value) }}>
        {k.value}
      </span>
      <span style={{ width: 28, height: 4, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.08)", overflow: "hidden", display: "inline-block" }}>
        <span style={{ display: "block", width: `${k.value}%`, height: "100%", backgroundColor: barColor(k.value) }} />
      </span>
    </div>
  );
}

function MiniCard({ p }: { p: typeof PROJECTS[number] }) {
  const healthC = valueColor(p.health);
  return (
    <div style={{
      width: 280, backgroundColor: "#fff", color: BRAND.cardText,
      borderRadius: 12, padding: "10px 12px", border: "1px solid #E8EDF2",
      boxShadow: "0 1px 3px rgba(0,0,0,0.08)", cursor: "pointer", flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ width: 32, height: 32, borderRadius: 999, border: `2px solid ${healthC}`,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          backgroundColor: healthC + "12" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: healthC }}>{p.health}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: p.phaseColor, letterSpacing: 0.5,
            textTransform: "uppercase" }}>{p.phase}</div>
          <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.25, whiteSpace: "nowrap",
            overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: BRAND.cardMuted, marginBottom: 6 }}>
        <MapPin size={9} /><span>{p.city}</span><span>·</span><span>{p.id}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingTop: 6, borderTop: "1px solid #F1F4F7" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{p.value}</div>
          <div style={{ fontSize: 9, color: "#2F6E1F", fontWeight: 700 }}>
            {p.staffing.count} staff · {p.staffing.fte} FTE
          </div>
        </div>
        <ChevronRight size={18} color={BRAND.green} />
      </div>
    </div>
  );
}

export function V5Stacked() {
  const section = useSection();
  const all = [...PROJECTS, ...PROJECTS, ...PROJECTS.slice(0, 1)];
  return (
    <div style={{ minHeight: "100vh", backgroundColor: BRAND.bgDeep, padding: 20, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ color: "#fff", fontSize: 11, fontWeight: 700, letterSpacing: 1, opacity: 0.6, marginBottom: 8 }}>
        V5 — CHIPS + MINI CARDS
      </div>
      <div style={{ color: BRAND.greenLight, fontSize: 12, marginBottom: 14 }}>
        KPIs become inline chips (no fake stretching). Projects become 280px mini cards in a wrap-grid — width never matters.
      </div>

      {section !== "projects" && (
        <>
          <div style={{ color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: 1.5, opacity: 0.55, marginBottom: 6 }}>
            HOME · KPI CHIPS
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
            {KPIS.map((k) => <KpiChip key={k.label} k={k} />)}
          </div>
        </>
      )}

      {section !== "home" && (
        <>
          <div style={{ color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: 1.5, opacity: 0.55, marginBottom: 6 }}>
            PROJECTS · MINI WRAP-GRID
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {all.map((p, i) => <MiniCard key={i} p={p} />)}
          </div>
        </>
      )}
    </div>
  );
}
