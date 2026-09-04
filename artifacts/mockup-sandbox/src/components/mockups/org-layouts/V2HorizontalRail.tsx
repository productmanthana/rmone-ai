import { useState } from "react";

const ORG_DATA = [
  {
    bu: "Buildings",
    color: "#6366f1",
    bg: "#eef2ff",
    divisions: [
      { name: "Commercial", depts: ["Business Dev", "Estimating", "Controls"] },
      { name: "Residential", depts: ["Design", "Construction Mgmt"] },
    ],
  },
  {
    bu: "Commercial BU",
    color: "#10b981",
    bg: "#ecfdf5",
    divisions: [
      { name: "Northeast", depts: ["Architecture", "Civil Eng.", "MEP"] },
      { name: "Southeast", depts: ["Interior Design", "Structural"] },
    ],
  },
  {
    bu: "Education",
    color: "#f59e0b",
    bg: "#fffbeb",
    divisions: [
      { name: "West Division", depts: ["K-12 Projects", "Higher Ed"] },
      { name: "Central Div.", depts: ["Curriculum", "Facilities"] },
    ],
  },
  {
    bu: "Healthcare",
    color: "#ec4899",
    bg: "#fdf2f8",
    divisions: [
      { name: "Mid-Atlantic", depts: ["Medical Fac.", "Research Labs"] },
      { name: "Southern Div.", depts: ["Clinics", "Rehabilitation"] },
    ],
  },
  {
    bu: "Infrastructure",
    color: "#3b82f6",
    bg: "#eff6ff",
    divisions: [
      { name: "Pacific Div.", depts: ["Transportation", "Utilities"] },
      { name: "Mountain Div.", depts: ["Energy", "Water Resources"] },
    ],
  },
];

function TreeLine({ color }: { color: string }) {
  return <div style={{ width: 1.5, background: color + "40", height: 20, marginLeft: 7 }} />;
}

function OrgCard({ item, active, onClick }: { item: typeof ORG_DATA[0]; active: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        minWidth: 220, width: 220, background: "#fff", borderRadius: 14,
        border: `2px solid ${active ? item.color : "#e5e7eb"}`,
        boxShadow: active ? `0 4px 20px ${item.color}25` : "0 1px 4px rgba(0,0,0,0.06)",
        cursor: "pointer", transition: "all 0.18s", flexShrink: 0, overflow: "hidden",
      }}
    >
      {/* BU header */}
      <div style={{ background: item.bg, padding: "14px 16px", borderBottom: `1px solid ${item.color}20` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.color }} />
          <span style={{ fontWeight: 700, fontSize: 13, color: "#1a1a2e" }}>{item.bu}</span>
        </div>
        <div style={{ fontSize: 10, color: item.color, fontWeight: 600, letterSpacing: 0.5, marginTop: 4, marginLeft: 18 }}>BUSINESS UNIT</div>
      </div>

      {/* Tree body */}
      <div style={{ padding: "12px 14px" }}>
        {item.divisions.map(div => (
          <div key={div.name} style={{ marginBottom: 10 }}>
            <TreeLine color={item.color} />
            <div style={{ background: "#f0fdf4", border: "1px solid #10b98125", borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: "#065f46", marginLeft: 0 }}>
              ◈ {div.name}
            </div>
            {div.depts.map(dept => (
              <div key={dept} style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3, marginLeft: 12 }}>
                <div style={{ width: 12, height: 1.5, background: "#e5e7eb" }} />
                <div style={{ fontSize: 10.5, color: "#6b7280", background: "#fafafa", border: "1px solid #f3f4f6", borderRadius: 4, padding: "3px 7px" }}>
                  {dept}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Footer stats */}
      <div style={{ borderTop: "1px solid #f3f4f6", padding: "8px 14px", display: "flex", gap: 12 }}>
        <span style={{ fontSize: 10, color: "#9ca3af" }}>
          <span style={{ fontWeight: 700, color: "#374151" }}>{item.divisions.length}</span> divs
        </span>
        <span style={{ fontSize: 10, color: "#9ca3af" }}>
          <span style={{ fontWeight: 700, color: "#374151" }}>{item.divisions.reduce((s,d)=>s+d.depts.length,0)}</span> depts
        </span>
      </div>
    </div>
  );
}

export function V2HorizontalRail() {
  const [active, setActive] = useState(0);
  const item = ORG_DATA[active];

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
<div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>Organization</div>
        <button style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Add New BU Structure</button>
      </div>

      {/* Horizontal scrolling rail */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "20px 28px" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", letterSpacing: 0.5, marginBottom: 14 }}>ALL BUSINESS UNITS — Click to explore</div>
        <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
          {ORG_DATA.map((o, i) => (
            <OrgCard key={o.bu} item={o} active={active === i} onClick={() => setActive(i)} />
          ))}
        </div>
      </div>

      {/* Expanded detail panel */}
      <div style={{ flex: 1, padding: "24px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 14, height: 14, borderRadius: "50%", background: item.color }} />
          <span style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>{item.bu}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: item.color, background: item.bg, border: `1px solid ${item.color}30`, borderRadius: 20, padding: "2px 10px", letterSpacing: 0.5 }}>BUSINESS UNIT</span>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {item.divisions.map(div => (
            <div key={div.name} style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 12, padding: "16px 20px", minWidth: 200, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: "#10b981" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#065f46" }}>{div.name}</span>
                <span style={{ fontSize: 9, color: "#10b981", fontWeight: 600, letterSpacing: 0.5 }}>DIVISION</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {div.depts.map(dept => (
                  <div key={dept} style={{ background: "#fffbeb", border: "1px solid #f59e0b20", borderRadius: 6, padding: "5px 10px", fontSize: 12, color: "#78350f", fontWeight: 500 }}>
                    {dept}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
