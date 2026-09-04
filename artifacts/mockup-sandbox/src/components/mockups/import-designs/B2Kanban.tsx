export function B2Kanban() {
  const modules = [
    {
      name: "Projects", icon: "🗂", stage: "done", count: 42, file: "projects_data.xlsx", date: "7/4/2026",
      rows: [
        ["PMM-001", "City Hall Renovation", "Active", "$4,200,000"],
        ["PMM-002", "Metro Bridge", "In Progress", "$8,750,000"],
        ["PMM-003", "Riverside Park", "Planning", "$2,100,000"],
      ],
    },
    {
      name: "Staff / Team", icon: "👥", stage: "done", count: 18, file: "staff_roster.xlsx", date: "7/4/2026",
      rows: [
        ["John Carter", "Project Manager", "Infrastructure", "85%"],
        ["Sara Kim", "Engineer", "Transport", "60%"],
        ["Mike Ross", "Analyst", "Civil", "40%"],
      ],
    },
    { name: "Opportunities", icon: "💼", stage: "empty", count: 0, file: null, date: null, rows: [] },
    { name: "Leads",         icon: "🔖", stage: "empty", count: 0, file: null, date: null, rows: [] },
    { name: "Billing Rates", icon: "💲", stage: "empty", count: 0, file: null, date: null, rows: [] },
  ];

  return (
    <div style={{ height: "100vh", background: "#f0f2f5", display: "flex", flexDirection: "column", fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#1b2b38", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>RM<span style={{ color: "#6ba539" }}>ONE</span></span>
        <span style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>Import Pipeline</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 12 }}>
          {[{ l: "Not started", c: 3, col: "#94a3b8" }, { l: "Loaded", c: 2, col: "#6ba539" }].map((s, i) => (
            <span key={i} style={{ fontSize: 12, color: s.col, fontWeight: 600 }}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: s.col, marginRight: 5 }} />
              {s.c} {s.l}
            </span>
          ))}
        </div>
      </div>

      {/* Kanban board */}
      <div style={{ flex: 1, display: "flex", gap: 12, padding: "16px", overflow: "hidden" }}>
        {modules.map((m, i) => (
          <div key={i} style={{
            flex: 1, display: "flex", flexDirection: "column", minWidth: 0,
            background: "#fff", borderRadius: 12,
            border: m.stage === "done" ? "2px solid #6ba539" : "1px solid #e2e8f0",
            overflow: "hidden",
            boxShadow: m.stage === "done" ? "0 4px 20px rgba(107,165,57,0.12)" : "0 1px 6px rgba(0,0,0,0.05)",
          }}>
            {/* Column header */}
            <div style={{
              padding: "12px 14px",
              background: m.stage === "done" ? "linear-gradient(135deg, #1b2b38 0%, #243b4a 100%)" : "#f8fafc",
              borderBottom: "1px solid " + (m.stage === "done" ? "rgba(107,165,57,0.3)" : "#e2e8f0"),
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 18 }}>{m.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: m.stage === "done" ? "#fff" : "#374151" }}>{m.name}</span>
              </div>
              {m.stage === "done" ? (
                <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "#6ba539", fontWeight: 700 }}>✓ {m.count} records</span>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>· {m.date}</span>
                </div>
              ) : (
                <div style={{ marginTop: 6 }}>
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>No data yet</span>
                </div>
              )}
            </div>

            {/* Content */}
            {m.stage === "done" ? (
              <div style={{ flex: 1, overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {(i === 0 ? ["Ticket", "Title", "Status", "Value"] : ["Name", "Role", "Division", "Alloc"]).map((c, ci) => (
                        <th key={ci} style={{ padding: "6px 8px", textAlign: "left", fontWeight: 700, color: "#6ba539", fontSize: 10, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {m.rows.map((row, ri) => (
                      <tr key={ri} style={{ background: ri % 2 === 0 ? "#fff" : "#f8fafc" }}>
                        {row.map((cell, ci) => (
                          <td key={ci} style={{ padding: "6px 8px", borderBottom: "1px solid #f1f5f9", fontSize: 10, color: "#374151", fontWeight: ci === 0 ? 700 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 80 }}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: "8px", textAlign: "center" }}>
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>+{m.count - 3} more rows</span>
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20, gap: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{m.icon}</div>
                <p style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", margin: 0 }}>No data uploaded yet</p>
                <button style={{ padding: "7px 18px", fontSize: 11, fontWeight: 700, borderRadius: 7, background: "#6ba539", color: "#fff", border: "none", cursor: "pointer" }}>↑ Upload</button>
                <button style={{ padding: "5px 14px", fontSize: 10, borderRadius: 6, background: "transparent", color: "#94a3b8", border: "1px solid #e2e8f0", cursor: "pointer" }}>↓ Template</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
