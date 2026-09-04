import { useState } from "react";

const ORG_DATA = [
  {
    bu: "Buildings",
    icon: "🏛",
    color: "#6366f1",
    bg: "#eef2ff",
    divisions: [
      {
        name: "Commercial", id: "com",
        depts: [
          { name: "Business Development", roles: ["BD Manager", "Proposal Writer", "BD Associate"], jobTitles: ["Director of BD", "Senior BD Manager"] },
          { name: "Estimating", roles: ["Chief Estimator", "Cost Analyst", "Junior Estimator"], jobTitles: ["Chief Estimator", "Sr. Cost Analyst"] },
          { name: "Project Controls", roles: ["Scheduler", "Controls Engineer"], jobTitles: ["Planning Director", "Senior Scheduler"] },
        ],
      },
      {
        name: "Residential", id: "res",
        depts: [
          { name: "Design", roles: ["Lead Architect", "Designer", "Drafter"], jobTitles: ["Principal Architect", "Senior Designer"] },
          { name: "Construction Mgmt", roles: ["PM", "Site Supervisor", "Field Eng"], jobTitles: ["Project Director", "Senior PM"] },
        ],
      },
    ],
  },
  {
    bu: "Commercial BU",
    icon: "🏢",
    color: "#10b981",
    bg: "#ecfdf5",
    divisions: [
      {
        name: "Northeast Division", id: "ne",
        depts: [
          { name: "Architecture", roles: ["Principal Arch.", "Senior Arch.", "Intern Arch."], jobTitles: ["VP Architecture", "Senior Architect"] },
          { name: "Civil Engineering", roles: ["Civil Engineer", "Survey Tech", "GIS Analyst"], jobTitles: ["Director of Civil", "Sr. Civil Engineer"] },
          { name: "MEP", roles: ["MEP Engineer", "Coordinator", "Commissioning"], jobTitles: ["MEP Director", "Sr. MEP Engineer"] },
        ],
      },
      {
        name: "Southeast Division", id: "se",
        depts: [
          { name: "Interior Design", roles: ["Interior Designer", "FF&E Specialist"], jobTitles: ["Principal Designer", "Senior ID"] },
          { name: "Structural", roles: ["Structural Engineer", "Steel Detailer"], jobTitles: ["Structural Director", "Sr. Structural Eng."] },
        ],
      },
    ],
  },
  {
    bu: "Education",
    icon: "🎓",
    color: "#f59e0b",
    bg: "#fffbeb",
    divisions: [
      {
        name: "West Division", id: "west",
        depts: [
          { name: "K-12 Projects", roles: ["K12 PM", "Educational Planner"], jobTitles: ["K12 Program Director", "Sr. K12 PM"] },
          { name: "Higher Education", roles: ["Campus Designer", "Project Eng."], jobTitles: ["Higher Ed Director", "Sr. Campus Architect"] },
        ],
      },
    ],
  },
  {
    bu: "Healthcare",
    icon: "🏥",
    color: "#ec4899",
    bg: "#fdf2f8",
    divisions: [
      {
        name: "Mid-Atlantic", id: "ma",
        depts: [
          { name: "Medical Facilities", roles: ["Healthcare PM", "Clinical Planner"], jobTitles: ["Healthcare Director", "Sr. Clinical PM"] },
          { name: "Research Labs", roles: ["Lab Designer", "Safety Engineer"], jobTitles: ["Research Director", "Lab Design Lead"] },
        ],
      },
    ],
  },
  {
    bu: "Infrastructure",
    icon: "🔧",
    color: "#3b82f6",
    bg: "#eff6ff",
    divisions: [
      {
        name: "Pacific Division", id: "pac",
        depts: [
          { name: "Transportation", roles: ["Traffic Engineer", "Road Designer"], jobTitles: ["Transportation Director", "Sr. Traffic Eng."] },
          { name: "Utilities", roles: ["Utility Planner", "Pipeline Eng."], jobTitles: ["Utilities Director", "Sr. Pipeline Eng."] },
        ],
      },
    ],
  },
];

export function V5Sidebar() {
  const [activeBU, setActiveBU] = useState(0);
  const [activeDiv, setActiveDiv] = useState<string>(ORG_DATA[0].divisions[0].id);
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set(["Business Development"]));

  const bu = ORG_DATA[activeBU];
  const div = bu.divisions.find(d => d.id === activeDiv) ?? bu.divisions[0];

  const handleBUClick = (i: number) => {
    setActiveBU(i);
    setActiveDiv(ORG_DATA[i].divisions[0].id);
    setExpandedDepts(new Set());
  };

  const toggleDept = (name: string) => {
    setExpandedDepts(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", display: "flex", flexDirection: "column" }}>
      {/* Top header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
<div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>Organization</div>
        <button style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>+ Add BU Structure</button>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left sidebar — Business Units */}
        <div style={{ width: 200, background: "#fff", borderRight: "1px solid #e5e7eb", flexShrink: 0, overflowY: "auto" }}>
          <div style={{ padding: "12px 14px 6px", fontSize: 10, fontWeight: 600, color: "#9ca3af", letterSpacing: 0.6 }}>BUSINESS UNITS</div>
          {ORG_DATA.map((item, i) => (
            <button
              key={item.bu}
              onClick={() => handleBUClick(i)}
              style={{
                width: "100%", textAlign: "left", padding: "9px 14px", display: "flex", alignItems: "center", gap: 8,
                border: "none", background: activeBU === i ? item.bg : "transparent",
                borderLeft: activeBU === i ? `3px solid ${item.color}` : "3px solid transparent",
                cursor: "pointer", transition: "all 0.12s",
              }}
            >
              <span style={{ fontSize: 14 }}>{item.icon}</span>
              <span style={{ fontSize: 12, fontWeight: activeBU === i ? 700 : 500, color: activeBU === i ? item.color : "#374151" }}>{item.bu}</span>
            </button>
          ))}

          {/* Divisions list for selected BU */}
          <div style={{ padding: "12px 14px 6px", fontSize: 10, fontWeight: 600, color: "#9ca3af", letterSpacing: 0.6, marginTop: 8, borderTop: "1px solid #f3f4f6" }}>DIVISIONS</div>
          {bu.divisions.map(div => (
            <button
              key={div.id}
              onClick={() => setActiveDiv(div.id)}
              style={{
                width: "100%", textAlign: "left", padding: "8px 14px 8px 18px", display: "flex", alignItems: "center", gap: 6,
                border: "none", background: activeDiv === div.id ? "#f0fdf4" : "transparent",
                borderLeft: activeDiv === div.id ? "3px solid #10b981" : "3px solid transparent",
                cursor: "pointer",
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: 1.5, background: "#10b981", opacity: activeDiv === div.id ? 1 : 0.4 }} />
              <span style={{ fontSize: 11.5, fontWeight: activeDiv === div.id ? 700 : 500, color: activeDiv === div.id ? "#065f46" : "#6b7280" }}>{div.name}</span>
            </button>
          ))}
        </div>

        {/* Main content area */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {/* Breadcrumb */}
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
            <span>{bu.icon}</span>
            <span style={{ color: bu.color, fontWeight: 600 }}>{bu.bu}</span>
            <span>›</span>
            <span style={{ color: "#065f46", fontWeight: 600 }}>{div.name}</span>
          </div>

          {/* Division banner */}
          <div style={{ background: "#f0fdf4", border: "1.5px solid #a7f3d0", borderRadius: 12, padding: "14px 20px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2.5, background: "#10b981" }} />
              <span style={{ fontWeight: 700, fontSize: 16, color: "#065f46" }}>{div.name}</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: "#10b981", letterSpacing: 0.5, background: "#d1fae5", padding: "2px 8px", borderRadius: 20 }}>DIVISION</span>
            </div>
            <span style={{ fontSize: 12, color: "#6b7280" }}>{div.depts.length} Departments</span>
          </div>

          {/* Departments */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {div.depts.map(dept => {
              const expanded = expandedDepts.has(dept.name);
              return (
                <div key={dept.name} style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
                  <button
                    onClick={() => toggleDept(dept.name)}
                    style={{ width: "100%", padding: "11px 16px", display: "flex", alignItems: "center", gap: 10, border: "none", background: "#fffbeb", cursor: "pointer", textAlign: "left" }}
                  >
                    <span style={{ fontSize: 10, color: "#9ca3af" }}>{expanded ? "▼" : "▶"}</span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "#78350f" }}>{dept.name}</span>
                    <span style={{ fontSize: 9.5, color: "#6b7280", marginLeft: "auto" }}>{dept.roles.length} roles · {dept.jobTitles.length} job titles</span>
                  </button>
                  {expanded && (
                    <div style={{ padding: "12px 16px 14px", display: "flex", gap: 16 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "#8b5cf6", letterSpacing: 0.5, marginBottom: 6 }}>ROLES</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {dept.roles.map(r => (
                            <div key={r} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#374151", background: "#f5f3ff", borderRadius: 6, padding: "4px 8px" }}>
                              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#8b5cf6" }} /> {r}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "#ef4444", letterSpacing: 0.5, marginBottom: 6 }}>JOB TITLES</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {dept.jobTitles.map(jt => (
                            <div key={jt} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#374151", background: "#fef2f2", borderRadius: 6, padding: "4px 8px" }}>
                              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#ef4444" }} /> {jt}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
