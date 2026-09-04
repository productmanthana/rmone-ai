import { useState } from "react";

const ORG_DATA = [
  {
    bu: "Buildings",
    icon: "🏛",
    color: "#6366f1",
    bg: "#eef2ff",
    divisions: [
      { name: "Commercial", departments: [
        { name: "Business Development", roles: ["BD Manager", "Proposal Writer"] },
        { name: "Estimating", roles: ["Chief Estimator", "Cost Analyst"] },
        { name: "Project Controls", roles: ["Scheduler", "Controls Eng"] },
      ]},
      { name: "Residential", departments: [
        { name: "Design", roles: ["Lead Architect", "Designer"] },
        { name: "Construction Mgmt", roles: ["PM", "Site Supervisor"] },
      ]},
    ],
  },
  {
    bu: "Commercial BU",
    icon: "🏢",
    color: "#10b981",
    bg: "#ecfdf5",
    divisions: [
      { name: "Northeast Division", departments: [
        { name: "Architecture", roles: ["Principal Architect", "Senior Architect"] },
        { name: "Civil Engineering", roles: ["Civil Engineer", "Survey Tech"] },
        { name: "MEP", roles: ["MEP Engineer", "Coordinator"] },
      ]},
      { name: "Southeast Division", departments: [
        { name: "Interior Design", roles: ["Interior Designer", "FF&E Specialist"] },
        { name: "Structural", roles: ["Structural Engineer"] },
      ]},
    ],
  },
  {
    bu: "Education",
    icon: "🎓",
    color: "#f59e0b",
    bg: "#fffbeb",
    divisions: [
      { name: "West Division", departments: [
        { name: "K-12 Projects", roles: ["K12 PM", "Educational Planner"] },
        { name: "Higher Education", roles: ["Campus Designer", "Project Eng"] },
      ]},
    ],
  },
  {
    bu: "Healthcare",
    icon: "🏥",
    color: "#ec4899",
    bg: "#fdf2f8",
    divisions: [
      { name: "Mid-Atlantic", departments: [
        { name: "Medical Facilities", roles: ["Healthcare PM", "Clinical Planner"] },
        { name: "Research Labs", roles: ["Lab Designer", "Safety Eng"] },
      ]},
    ],
  },
  {
    bu: "Infrastructure",
    icon: "🔧",
    color: "#3b82f6",
    bg: "#eff6ff",
    divisions: [
      { name: "Pacific Division", departments: [
        { name: "Transportation", roles: ["Traffic Eng", "Road Designer"] },
        { name: "Utilities", roles: ["Utility Planner", "Pipeline Eng"] },
      ]},
    ],
  },
];

function TreeConnector({ last }: { last?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: 20, flexShrink: 0 }}>
      <div style={{ width: 1.5, height: 18, background: "#d1d5db" }} />
      {!last && <div style={{ width: 1.5, flex: 1, background: "#d1d5db" }} />}
    </div>
  );
}

export function V3TabSwitcher() {
  const [activeTab, setActiveTab] = useState(0);
  const item = ORG_DATA[activeTab];

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
<div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>Organization</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button style={{ background: "transparent", color: "#6b7280", border: "1.5px solid #e5e7eb", borderRadius: 8, padding: "7px 14px", fontSize: 13, cursor: "pointer" }}>Template</button>
          <button style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Add BU</button>
        </div>
      </div>

      {/* BU Tabs */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 28px", display: "flex", gap: 0, overflowX: "auto" }}>
        {ORG_DATA.map((o, i) => (
          <button
            key={o.bu}
            onClick={() => setActiveTab(i)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "14px 20px",
              border: "none", borderBottom: i === activeTab ? `2.5px solid ${o.color}` : "2.5px solid transparent",
              background: "transparent", cursor: "pointer", fontWeight: i === activeTab ? 700 : 500,
              fontSize: 13, color: i === activeTab ? o.color : "#6b7280", whiteSpace: "nowrap",
              transition: "all 0.15s",
            }}
          >
            <span>{o.icon}</span>
            {o.bu}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: "28px", overflowY: "auto" }}>
        {/* BU header */}
        <div style={{ background: item.bg, border: `1.5px solid ${item.color}30`, borderRadius: 14, padding: "18px 24px", marginBottom: 24, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 36 }}>{item.icon}</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>{item.bu}</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3 }}>
              {item.divisions.length} Division{item.divisions.length !== 1 ? "s" : ""} · {item.divisions.reduce((s,d)=>s+d.departments.length,0)} Departments
            </div>
          </div>
          <span style={{ marginLeft: "auto", background: item.color, color: "#fff", borderRadius: 20, padding: "4px 14px", fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>BUSINESS UNIT</span>
        </div>

        {/* Divisions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {item.divisions.map(div => (
            <div key={div.name} style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
              {/* Division header */}
              <div style={{ background: "#f0fdf4", borderBottom: "1px solid #d1fae5", padding: "12px 20px", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: "#10b981" }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: "#065f46" }}>{div.name}</span>
                <span style={{ fontSize: 10, color: "#10b981", fontWeight: 600, letterSpacing: 0.5, marginLeft: 4 }}>DIVISION</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "#6b7280" }}>{div.departments.length} departments</span>
              </div>

              {/* Departments + roles */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "16px 20px" }}>
                {div.departments.map(dept => (
                  <div key={dept.name} style={{ minWidth: 180, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#78350f", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10 }}>▪</span>{dept.name}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {dept.roles.map(role => (
                        <div key={role} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#6b7280" }}>
                          <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#8b5cf6", flexShrink: 0 }} />
                          {role}
                        </div>
                      ))}
                    </div>
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
