import { useState } from "react";

export function V4StepWizard() {
  const [showModules, setShowModules] = useState(true);
  const steps = ["Choose module", "Upload file", "Review data", "Confirm import"];
  const modules = [
    { icon: "🗂", name: "Projects", desc: "Projects + team assignments", done: true, count: 42 },
    { icon: "👥", name: "Staff / Team", desc: "People, roles & departments", done: true, count: 18 },
    { icon: "💼", name: "Opportunities", desc: "Opportunities + teams", done: false, count: 0 },
    { icon: "🔖", name: "Leads", desc: "Early-stage inquiries", done: false, count: 0 },
    { icon: "💲", name: "Billing Rates", desc: "Role billing & cost rates", done: false, count: 0 },
  ];
  const cols = ["Ticket ID", "Project Title", "Status", "Sector", "Division", "Target End", "Contract Value"];
  const rows = [
    ["PMM-001", "City Hall Renovation", "Active", "Construction", "Civil", "12/2025", "$4,200,000"],
    ["PMM-002", "Metro Bridge Upgrade", "In Progress", "Infrastructure", "Bridges", "03/2026", "$8,750,000"],
    ["PMM-003", "Riverside Park Dev", "Planning", "Civil", "Parks", "06/2026", "$2,100,000"],
    ["PMM-004", "Airport Terminal B", "Active", "Commercial", "Terminal", "09/2025", "$15,600,000"],
    ["PMM-005", "Harbor District", "On Hold", "Mixed-Use", "Urban Dev", "01/2027", "$6,300,000"],
    ["PMM-006", "Highway 9 Expansion", "Active", "Infrastructure", "Roads", "11/2025", "$9,800,000"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "Inter, sans-serif", background: "#f5f7fa" }}>
      {/* Header */}
      <div style={{ background: "#1b2b38", padding: "16px 32px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#6ba539", letterSpacing: "0.1em", textTransform: "uppercase" }}>Import Data</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginTop: 2 }}>Upload your company data</div>

        {/* Progress steps */}
        <div style={{ display: "flex", alignItems: "center", gap: 0, marginTop: 20 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                  background: i === 2 ? "#6ba539" : i < 2 ? "rgba(107,165,57,0.25)" : "rgba(255,255,255,0.1)",
                  border: i === 2 ? "2px solid #6ba539" : i < 2 ? "2px solid rgba(107,165,57,0.4)" : "2px solid rgba(255,255,255,0.15)",
                  fontSize: 11, fontWeight: 700, color: i <= 2 ? "#6ba539" : "rgba(255,255,255,0.3)",
                }}>
                  {i < 2 ? "✓" : i + 1}
                </div>
                <span style={{ fontSize: 10, color: i === 2 ? "#fff" : "rgba(255,255,255,0.4)", fontWeight: i === 2 ? 600 : 400, whiteSpace: "nowrap" }}>{s}</span>
              </div>
              {i < steps.length - 1 && (
                <div style={{ width: 80, height: 1, background: i < 2 ? "rgba(107,165,57,0.4)" : "rgba(255,255,255,0.1)", margin: "0 8px", marginTop: -16 }} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden", padding: 20, gap: 16 }}>

        {/* Left: module list — collapsible */}
        {showModules && (
          <div style={{ width: 220, display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Modules</span>
              <button
                onClick={() => setShowModules(false)}
                title="Hide modules panel"
                style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", borderRadius: 4, color: "#94a3b8", fontSize: 14, lineHeight: 1 }}
              >
                ◀
              </button>
            </div>
            {modules.map((m, i) => (
              <div key={i} style={{
                borderRadius: 8, border: i === 0 ? "2px solid #6ba539" : "1px solid #e2e8f0",
                background: i === 0 ? "#f0f9ea" : "#fff", padding: "10px 12px", cursor: "pointer",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{m.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>{m.name}</div>
                    <div style={{ fontSize: 10, color: m.done ? "#6ba539" : "#94a3b8" }}>
                      {m.done ? `✓ ${m.count} records` : "Not uploaded"}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Right: review grid */}
        <div style={{ flex: 1, background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Grid toolbar */}
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10, background: "#f8fafc" }}>
            {/* Toggle button — shown here when panel is hidden */}
            {!showModules && (
              <button
                onClick={() => setShowModules(true)}
                title="Show modules panel"
                style={{
                  padding: "5px 10px", fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: "pointer",
                  background: "#f1f5f9", border: "1px solid #e2e8f0", color: "#64748b",
                  display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
                }}
              >
                ▶ <span>Modules</span>
              </button>
            )}
            <span style={{ fontSize: 14, fontWeight: 700, color: "#1b2b38" }}>Review: Projects</span>
            <span style={{ fontSize: 11, color: "#6ba539", background: "#f0f9ea", padding: "2px 8px", borderRadius: 8, fontWeight: 600 }}>42 rows · 7 columns recognised</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: "#64748b" }}>projects_data.xlsx</span>
            <button style={{ padding: "5px 12px", fontSize: 11, fontWeight: 700, borderRadius: 5, border: "none", background: "#6ba539", color: "#fff", cursor: "pointer" }}>↑ Replace file</button>
          </div>

          {/* Column mapping row */}
          <div style={{ background: "#fffbeb", borderBottom: "1px solid #fde68a", padding: "6px 16px", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#92400e" }}>COLUMN MAP</span>
            {["Ticket ID→Ticket ID", "Project Title→Title", "Status→Status", "Sector→Sector"].map((m, i) => (
              <span key={i} style={{ fontSize: 10, background: "#fef3c7", color: "#78350f", borderRadius: 4, padding: "2px 6px" }}>{m}</span>
            ))}
            <span style={{ fontSize: 10, color: "#92400e" }}>+3 more matched</span>
          </div>

          {/* Data grid */}
          <div style={{ flex: 1, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#1b2b38", position: "sticky", top: 0 }}>
                  <th style={{ width: 36, padding: "8px 4px", color: "rgba(255,255,255,0.3)", fontSize: 10, textAlign: "center", borderRight: "1px solid rgba(255,255,255,0.08)" }}>#</th>
                  {cols.map((c, i) => (
                    <th key={i} style={{ padding: "8px 12px", textAlign: "left", color: "#a9c23f", fontWeight: 700, fontSize: 11, borderRight: "1px solid rgba(255,255,255,0.08)", whiteSpace: "nowrap" }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 0 ? "#fff" : "#f8fafc" }}>
                    <td style={{ padding: "7px 4px", borderBottom: "1px solid #f1f5f9", borderRight: "1px solid #e2e8f0", textAlign: "center", color: "#94a3b8", fontSize: 10 }}>{ri + 1}</td>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{
                        padding: "7px 12px", borderBottom: "1px solid #f1f5f9", borderRight: "1px solid #e2e8f0",
                        color: ci === 2 ? (cell === "Active" ? "#16a34a" : cell === "On Hold" ? "#d97706" : "#2563eb") : "#374151",
                        fontWeight: ci === 0 ? 700 : 400, fontSize: 12,
                      }}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ padding: "10px 16px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "flex-end", gap: 10, background: "#f8fafc" }}>
            <button style={{ padding: "7px 20px", fontSize: 12, borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", cursor: "pointer" }}>← Back</button>
            <button style={{ padding: "7px 24px", fontSize: 12, fontWeight: 700, borderRadius: 6, border: "none", background: "#6ba539", color: "#fff", cursor: "pointer" }}>Confirm & Import →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
