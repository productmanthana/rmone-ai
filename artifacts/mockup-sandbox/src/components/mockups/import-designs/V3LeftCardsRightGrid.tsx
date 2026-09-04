export function V3LeftCardsRightGrid() {
  const modules = [
    { icon: "🗂", name: "Projects", count: 42, lastUpload: "7/4/2026", ok: true },
    { icon: "👥", name: "Staff / Team", count: 18, lastUpload: "7/4/2026", ok: true },
    { icon: "💼", name: "Opportunities", count: 0, lastUpload: null, ok: false },
    { icon: "🔖", name: "Leads", count: 0, lastUpload: null, ok: false },
    { icon: "💲", name: "Billing Rates", count: 0, lastUpload: null, ok: false },
  ];
  const cols = ["Ticket ID", "Project Title", "Status", "Sector", "Target End", "Contract Value", "BU"];
  const rows = [
    ["PMM-001", "City Hall Renovation", "Active", "Construction", "12/2025", "$4,200,000", "Infrastructure"],
    ["PMM-002", "Metro Bridge Upgrade", "In Progress", "Infrastructure", "03/2026", "$8,750,000", "Transport"],
    ["PMM-003", "Riverside Park Dev", "Planning", "Civil", "06/2026", "$2,100,000", "Public Works"],
    ["PMM-004", "Airport Terminal B", "Active", "Commercial", "09/2025", "$15,600,000", "Aviation"],
    ["PMM-005", "Harbor District", "On Hold", "Mixed-Use", "01/2027", "$6,300,000", "Development"],
    ["PMM-006", "Highway 9 Expansion", "Active", "Infrastructure", "11/2025", "$9,800,000", "Transport"],
    ["PMM-007", "School District Reno", "Planning", "Education", "04/2026", "$3,450,000", "Public"],
    ["PMM-008", "Convention Center", "Active", "Commercial", "07/2025", "$22,100,000", "Development"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "Inter, sans-serif", background: "#f5f7fa" }}>
      {/* Header */}
      <div style={{ height: 56, background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", padding: "0 24px", gap: 12 }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: "#1b2b38" }}>Import Data</span>
        <span style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>— upload your Excel files module by module</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#64748b" }}>company: <b>test10</b></span>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left: module cards */}
        <div style={{ width: 260, background: "#fff", borderRight: "1px solid #e2e8f0", overflowY: "auto", padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Modules</div>
          {modules.map((m, i) => (
            <div key={i} onClick={() => {}} style={{
              borderRadius: 10, border: i === 0 ? "2px solid #6ba539" : "1px solid #e2e8f0",
              background: i === 0 ? "#f0f9ea" : "#fff",
              padding: "12px 14px", marginBottom: 8, cursor: "pointer",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>{m.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: i === 0 ? "#1b2b38" : "#374151" }}>{m.name}</div>
                  <div style={{ fontSize: 11, color: m.ok ? "#6ba539" : "#94a3b8", marginTop: 1 }}>
                    {m.ok ? `✓ ${m.count} records · ${m.lastUpload}` : "No data yet"}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button style={{ flex: 1, padding: "4px 0", fontSize: 11, borderRadius: 5, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", cursor: "pointer" }}>↓ Template</button>
                <button style={{ flex: 1, padding: "4px 0", fontSize: 11, fontWeight: 700, borderRadius: 5, border: "none", background: i === 0 ? "#6ba539" : "#f1f5f9", color: i === 0 ? "#fff" : "#64748b", cursor: "pointer" }}>↑ Upload</button>
              </div>
            </div>
          ))}
        </div>

        {/* Right: data grid */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "12px 20px", background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#1b2b38" }}>Projects</span>
            <span style={{ fontSize: 12, color: "#6ba539", background: "#f0f9ea", padding: "2px 10px", borderRadius: 10, fontWeight: 600 }}>42 records</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: "#94a3b8" }}>projects_data.xlsx · 7/4/2026 11:30 AM</span>
            <button style={{ padding: "5px 12px", fontSize: 12, fontWeight: 700, borderRadius: 6, border: "none", background: "#6ba539", color: "#fff", cursor: "pointer" }}>↑ Upload</button>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", position: "sticky", top: 0 }}>
                  <th style={{ width: 36, padding: "8px 4px", borderBottom: "2px solid #6ba539", borderRight: "1px solid #e2e8f0", color: "#94a3b8", fontSize: 10, textAlign: "center" }}>#</th>
                  {cols.map((c, i) => (
                    <th key={i} style={{ padding: "8px 14px", borderBottom: "2px solid #6ba539", borderRight: "1px solid #e2e8f0", textAlign: "left", color: "#374151", fontWeight: 700, whiteSpace: "nowrap", fontSize: 12 }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 0 ? "#fff" : "#fafbfc", cursor: "pointer" }}>
                    <td style={{ padding: "8px 4px", borderBottom: "1px solid #f1f5f9", borderRight: "1px solid #e2e8f0", textAlign: "center", color: "#94a3b8", fontSize: 10 }}>{ri + 1}</td>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{
                        padding: "8px 14px", borderBottom: "1px solid #f1f5f9", borderRight: "1px solid #e2e8f0",
                        color: ci === 2 ? (cell === "Active" ? "#16a34a" : cell === "On Hold" ? "#d97706" : cell === "In Progress" ? "#2563eb" : "#6366f1") : "#374151",
                        fontWeight: ci === 0 ? 700 : 400, whiteSpace: "nowrap",
                      }}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
