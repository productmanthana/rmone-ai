export function V5Dashboard() {
  const modules = [
    { icon: "🗂", name: "Projects", desc: "Projects + team assignments", count: 42, status: "success", file: "projects_data.xlsx", date: "7/4/2026" },
    { icon: "👥", name: "Staff / Team", desc: "People, roles & departments", count: 18, status: "success", file: "staff_roster.xlsx", date: "7/4/2026" },
    { icon: "💼", name: "Opportunities", desc: "Opportunities + team", count: 0, status: "idle", file: null, date: null },
    { icon: "🔖", name: "Leads", desc: "Early-stage inquiries", count: 0, status: "idle", file: null, date: null },
    { icon: "💲", name: "Billing Rates", desc: "Role billing & cost rates", count: 0, status: "idle", file: null, date: null },
  ];
  const cols = ["Ticket ID", "Project Title", "Status", "Division", "BU", "Target End", "Contract Value"];
  const rows = [
    ["PMM-001", "City Hall Renovation", "Active", "Civil", "Infrastructure", "12/2025", "$4,200,000"],
    ["PMM-002", "Metro Bridge Upgrade", "In Progress", "Bridges", "Transport", "03/2026", "$8,750,000"],
    ["PMM-003", "Riverside Park Dev", "Planning", "Parks", "Public Works", "06/2026", "$2,100,000"],
    ["PMM-004", "Airport Terminal B", "Active", "Terminal", "Aviation", "09/2025", "$15,600,000"],
    ["PMM-005", "Harbor District", "On Hold", "Urban Dev", "Development", "01/2027", "$6,300,000"],
    ["PMM-006", "Highway 9 Expansion", "Active", "Roads", "Transport", "11/2025", "$9,800,000"],
    ["PMM-007", "School District Reno", "Planning", "Education", "Public", "04/2026", "$3,450,000"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "Inter, sans-serif", background: "#f5f7fa" }}>
      {/* Header */}
      <div style={{ background: "#1b2b38", padding: "20px 28px 0" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6ba539", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Import Data</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>test10</div>
            <div style={{ fontSize: 12, color: "#8a9bb0", marginTop: 2 }}>Your data, ready to import — choose a module and upload an Excel file</div>
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 4 }}>
            {[{ label: "Total records", val: "60" }, { label: "Modules loaded", val: "2 / 5" }, { label: "Last upload", val: "7/4/2026" }].map((s, i) => (
              <div key={i} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>{s.val}</div>
                <div style={{ fontSize: 10, color: "#5a6d7c", textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
        {/* Subtle divider */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.06)", marginTop: 16 }} />
      </div>

      {/* Module card row */}
      <div style={{ padding: "16px 28px", display: "flex", gap: 12, flexShrink: 0, overflowX: "auto" }}>
        {modules.map((m, i) => (
          <div key={i} style={{
            flex: "0 0 200px", borderRadius: 10,
            background: "#fff", border: i === 0 ? "2px solid #6ba539" : "1px solid #e2e8f0",
            padding: "14px 16px", cursor: "pointer",
            boxShadow: i === 0 ? "0 2px 12px rgba(107,165,57,0.15)" : "0 1px 4px rgba(0,0,0,0.04)",
          }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{m.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1b2b38" }}>{m.name}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{m.desc}</div>
            <div style={{ marginTop: 8 }}>
              {m.status === "success" ? (
                <span style={{ fontSize: 11, color: "#6ba539", fontWeight: 600 }}>✓ {m.count} records</span>
              ) : (
                <span style={{ fontSize: 11, color: "#94a3b8" }}>No data yet</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button style={{ flex: 1, padding: "4px 0", fontSize: 10, borderRadius: 4, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#64748b", cursor: "pointer", fontWeight: 600 }}>↓ Template</button>
              <button style={{ flex: 1, padding: "4px 0", fontSize: 10, fontWeight: 700, borderRadius: 4, border: "none", background: i === 0 ? "#6ba539" : "#f1f5f9", color: i === 0 ? "#fff" : "#94a3b8", cursor: "pointer" }}>↑ Upload</button>
            </div>
          </div>
        ))}
      </div>

      {/* Inline data grid — "active" module expanded */}
      <div style={{ flex: 1, margin: "0 28px 20px", background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10, background: "#f8fafc" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#1b2b38" }}>🗂 Projects — data preview</span>
          <span style={{ fontSize: 11, color: "#6ba539", background: "#f0f9ea", padding: "1px 8px", borderRadius: 8, fontWeight: 600 }}>42 rows</span>
          <span style={{ fontSize: 11, color: "#64748b" }}>projects_data.xlsx · 7/4/2026 11:30 AM</span>
          <div style={{ flex: 1 }} />
          <button style={{ padding: "4px 10px", fontSize: 11, borderRadius: 5, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", cursor: "pointer" }}>↓ Export</button>
          <button style={{ padding: "4px 12px", fontSize: 11, fontWeight: 700, borderRadius: 5, border: "none", background: "#6ba539", color: "#fff", cursor: "pointer" }}>↑ Upload new</button>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f1f5f9", position: "sticky", top: 0 }}>
                <th style={{ width: 36, padding: "7px 4px", borderBottom: "2px solid #6ba539", borderRight: "1px solid #e2e8f0", color: "#94a3b8", fontSize: 10, textAlign: "center" }}>#</th>
                {cols.map((c, i) => (
                  <th key={i} style={{ padding: "7px 14px", borderBottom: "2px solid #6ba539", borderRight: "1px solid #e2e8f0", textAlign: "left", color: "#374151", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={{ background: ri % 2 === 0 ? "#fff" : "#f8fafc" }}>
                  <td style={{ padding: "7px 4px", borderBottom: "1px solid #f1f5f9", borderRight: "1px solid #e2e8f0", textAlign: "center", color: "#94a3b8", fontSize: 10 }}>{ri + 1}</td>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{
                      padding: "7px 14px", borderBottom: "1px solid #f1f5f9", borderRight: "1px solid #e2e8f0",
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
  );
}
