import { useState } from "react";

const ORG_DATA = [
  {
    bu: "Buildings",
    icon: "🏛",
    color: "#6366f1",
    bg: "#eef2ff",
    tagBg: "#c7d2fe",
    divisions: ["Commercial", "Residential", "Renovation"],
    deptCount: 8,
    roleCount: 24,
    tree: [
      { label: "Commercial", depth: 1, children: ["Business Dev", "Estimating"] },
      { label: "Residential", depth: 1, children: ["Design", "Const. Mgmt"] },
    ],
  },
  {
    bu: "Commercial BU",
    icon: "🏢",
    color: "#10b981",
    bg: "#ecfdf5",
    tagBg: "#a7f3d0",
    divisions: ["Northeast", "Southeast", "Midwest"],
    deptCount: 9,
    roleCount: 31,
    tree: [
      { label: "Northeast", depth: 1, children: ["Architecture", "Civil Eng", "MEP"] },
      { label: "Southeast", depth: 1, children: ["Interior Design"] },
    ],
  },
  {
    bu: "Education",
    icon: "🎓",
    color: "#f59e0b",
    bg: "#fffbeb",
    tagBg: "#fde68a",
    divisions: ["West Division", "Central Division"],
    deptCount: 5,
    roleCount: 16,
    tree: [
      { label: "West Division", depth: 1, children: ["K-12 Projects", "Higher Ed"] },
      { label: "Central Div.", depth: 1, children: ["Curriculum"] },
    ],
  },
  {
    bu: "Healthcare",
    icon: "🏥",
    color: "#ec4899",
    bg: "#fdf2f8",
    tagBg: "#fbcfe8",
    divisions: ["Mid-Atlantic", "Southern"],
    deptCount: 4,
    roleCount: 12,
    tree: [
      { label: "Mid-Atlantic", depth: 1, children: ["Medical Fac.", "Research Labs"] },
    ],
  },
  {
    bu: "Infrastructure",
    icon: "🔧",
    color: "#3b82f6",
    bg: "#eff6ff",
    tagBg: "#bfdbfe",
    divisions: ["Pacific Division", "Mountain Division"],
    deptCount: 6,
    roleCount: 19,
    tree: [
      { label: "Pacific Div.", depth: 1, children: ["Transportation", "Utilities"] },
      { label: "Mountain Div.", depth: 1, children: ["Energy", "Water Res."] },
    ],
  },
];

function MiniTree({ item }: { item: typeof ORG_DATA[0] }) {
  return (
    <div style={{ fontSize: 10.5, color: "#374151", lineHeight: 1.6 }}>
      {item.tree.map(node => (
        <div key={node.label}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: "#10b98170" }} />
            <span style={{ fontWeight: 600, color: "#065f46", fontSize: 10 }}>{node.label}</span>
          </div>
          {node.children.map(child => (
            <div key={child} style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 14, marginBottom: 2 }}>
              <div style={{ width: 12, height: 1, background: "#d1d5db" }} />
              <span style={{ color: "#78350f", fontSize: 9.5 }}>{child}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function V4GridCards() {
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
<div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>Organization</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            {ORG_DATA.length} Business Units
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input placeholder="Search structures..." style={{ border: "1.5px solid #e5e7eb", borderRadius: 8, padding: "7px 14px", fontSize: 13, outline: "none", width: 200 }} />
          <button style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Add New BU</button>
        </div>
      </div>

      {/* Summary ribbon */}
      <div style={{ background: "#fff", borderBottom: "1px solid #f3f4f6", padding: "10px 28px", display: "flex", gap: 24 }}>
        {[
          { label: "Business Units", val: ORG_DATA.length, color: "#6366f1" },
          { label: "Total Divisions", val: ORG_DATA.reduce((s,d)=>s+d.divisions.length,0), color: "#10b981" },
          { label: "Total Departments", val: ORG_DATA.reduce((s,d)=>s+d.deptCount,0), color: "#f59e0b" },
          { label: "Total Roles", val: ORG_DATA.reduce((s,d)=>s+d.roleCount,0), color: "#8b5cf6" },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color }}>{val}</span>
            <span style={{ fontSize: 11, color: "#6b7280" }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div style={{ padding: "24px 28px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {ORG_DATA.map((item, i) => (
          <div
            key={item.bu}
            onClick={() => setSelected(selected === i ? null : i)}
            style={{
              background: "#fff", borderRadius: 14,
              border: `2px solid ${selected === i ? item.color : "#e5e7eb"}`,
              boxShadow: selected === i ? `0 4px 20px ${item.color}25` : "0 1px 4px rgba(0,0,0,0.06)",
              cursor: "pointer", transition: "all 0.18s", overflow: "hidden",
            }}
          >
            {/* Card header */}
            <div style={{ background: item.bg, padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: 10, borderBottom: `1px solid ${item.color}15` }}>
              <div style={{ fontSize: 28, lineHeight: 1 }}>{item.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>{item.bu}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                  {item.divisions.slice(0, 2).map(d => (
                    <span key={d} style={{ background: "#fff", border: `1px solid ${item.color}30`, borderRadius: 20, padding: "1px 8px", fontSize: 9.5, color: item.color, fontWeight: 600 }}>{d}</span>
                  ))}
                  {item.divisions.length > 2 && (
                    <span style={{ background: "#f3f4f6", borderRadius: 20, padding: "1px 8px", fontSize: 9.5, color: "#6b7280" }}>+{item.divisions.length - 2}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Mini tree preview */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
              <MiniTree item={item} />
            </div>

            {/* Stats row */}
            <div style={{ padding: "10px 16px", display: "flex", gap: 16 }}>
              {[
                { label: "Divisions", val: item.divisions.length, color: "#10b981" },
                { label: "Depts", val: item.deptCount, color: "#f59e0b" },
                { label: "Roles", val: item.roleCount, color: "#8b5cf6" },
              ].map(s => (
                <div key={s.label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.val}</div>
                  <div style={{ fontSize: 9.5, color: "#9ca3af" }}>{s.label}</div>
                </div>
              ))}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
                <button style={{ fontSize: 11, color: item.color, background: item.bg, border: `1px solid ${item.color}30`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>
                  Manage →
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
