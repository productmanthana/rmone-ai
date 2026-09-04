export function V1SplitPanel() {
  const modules = [
    { name: "Projects", sub: "Projects + team assignments", count: 42, status: "success" },
    { name: "Staff / Team", sub: "People, roles & departments", count: 18, status: "success" },
    { name: "Opportunities", sub: "Opportunities + team", count: 0, status: "idle" },
    { name: "Leads", sub: "Early-stage inquiries", count: 0, status: "idle" },
    { name: "Billing Rates", sub: "Role billing & cost rates", count: 0, status: "idle" },
  ];
  const rows = [
    ["PMM-001", "City Hall Renovation", "Active", "Construction", "12/2025", "$4,200,000"],
    ["PMM-002", "Metro Bridge Upgrade", "In Progress", "Infrastructure", "03/2026", "$8,750,000"],
    ["PMM-003", "Riverside Park Dev", "Planning", "Civil", "06/2026", "$2,100,000"],
    ["PMM-004", "Airport Terminal B", "Active", "Commercial", "09/2025", "$15,600,000"],
    ["PMM-005", "Harbor District", "On Hold", "Mixed-Use", "01/2027", "$6,300,000"],
    ["PMM-006", "Highway 9 Expansion", "Active", "Infrastructure", "11/2025", "$9,800,000"],
    ["PMM-007", "School District Reno", "Planning", "Education", "04/2026", "$3,450,000"],
    ["PMM-008", "Convention Center", "Active", "Commercial", "07/2025", "$22,100,000"],
  ];
  const cols = ["Ticket ID", "Project Title", "Status", "Sector", "Target End", "Contract Value"];
  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "Inter, sans-serif", background: "#f5f7fa" }}>
      {/* Left sidebar */}
      <div style={{ width: 300, background: "#1b2b38", display: "flex", flexDirection: "column", padding: "24px 0" }}>
        <div style={{ padding: "0 20px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6ba539", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Import Data</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>Select a module</div>
          <div style={{ fontSize: 12, color: "#8a9bb0", marginTop: 4 }}>Upload data for each area of your business</div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px" }}>
          {modules.map((m, i) => (
            <div key={i} style={{
              borderRadius: 8, padding: "12px 14px", marginBottom: 6, cursor: "pointer",
              background: i === 0 ? "rgba(107,165,57,0.18)" : "rgba(255,255,255,0.04)",
              border: i === 0 ? "1px solid rgba(107,165,57,0.4)" : "1px solid rgba(255,255,255,0.06)",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: i === 0 ? "#6ba539" : "#d0dae5" }}>{m.name}</span>
                {m.status === "success" && (
                  <span style={{ fontSize: 10, background: "rgba(107,165,57,0.2)", color: "#6ba539", borderRadius: 10, padding: "2px 8px", fontWeight: 600 }}>
                    {m.count} records
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "#5a6d7c", marginTop: 2 }}>{m.sub}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button style={{ flex: 1, padding: "5px 0", fontSize: 11, fontWeight: 600, borderRadius: 5, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#8a9bb0", cursor: "pointer" }}>
                  Template
                </button>
                <button style={{ flex: 1, padding: "5px 0", fontSize: 11, fontWeight: 700, borderRadius: 5, border: "none", background: i === 0 ? "#6ba539" : "rgba(255,255,255,0.08)", color: i === 0 ? "#fff" : "#8a9bb0", cursor: "pointer" }}>
                  ↑ Upload
                </button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: "12px 20px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 11, color: "#5a6d7c" }}>Last upload: projects_data.xlsx</div>
          <div style={{ fontSize: 11, color: "#6ba539" }}>✓ Success · 7/4/2026, 11:30 AM</div>
        </div>
      </div>

      {/* Main grid area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Toolbar */}
        <div style={{ height: 52, background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", padding: "0 20px", gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#1b2b38" }}>Projects</span>
          <span style={{ fontSize: 12, color: "#94a3b8", background: "#f1f5f9", padding: "2px 10px", borderRadius: 12 }}>42 rows</span>
          <div style={{ flex: 1 }} />
          <button style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", cursor: "pointer" }}>Filter</button>
          <button style={{ padding: "6px 14px", fontSize: 12, fontWeight: 700, borderRadius: 6, border: "none", background: "#6ba539", color: "#fff", cursor: "pointer" }}>↑ Upload new file</button>
        </div>

        {/* Spreadsheet grid */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", position: "sticky", top: 0, zIndex: 10 }}>
                <th style={{ width: 36, padding: "8px 6px", borderBottom: "2px solid #e2e8f0", borderRight: "1px solid #e2e8f0", color: "#94a3b8", fontSize: 11, fontWeight: 600, textAlign: "center" }}>#</th>
                {cols.map((c, i) => (
                  <th key={i} style={{ padding: "8px 14px", borderBottom: "2px solid #e2e8f0", borderRight: "1px solid #e2e8f0", textAlign: "left", fontWeight: 700, color: "#374151", whiteSpace: "nowrap" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={{ background: ri % 2 === 0 ? "#fff" : "#f8fafc" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#eff6ff")}
                  onMouseLeave={e => (e.currentTarget.style.background = ri % 2 === 0 ? "#fff" : "#f8fafc")}>
                  <td style={{ padding: "7px 6px", borderBottom: "1px solid #f1f5f9", borderRight: "1px solid #e2e8f0", textAlign: "center", color: "#94a3b8", fontSize: 11 }}>{ri + 1}</td>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ padding: "7px 14px", borderBottom: "1px solid #f1f5f9", borderRight: "1px solid #e2e8f0", color: ci === 2 ? (cell === "Active" ? "#16a34a" : cell === "On Hold" ? "#d97706" : "#6366f1") : "#374151", fontWeight: ci === 0 ? 600 : 400 }}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
