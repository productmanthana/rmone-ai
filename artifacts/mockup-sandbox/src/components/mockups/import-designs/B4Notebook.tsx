import { useState } from "react";

export function B4Notebook() {
  const [expanded, setExpanded] = useState<number | null>(0);

  const cells = [
    {
      num: 1, name: "Projects", icon: "🗂", status: "done", count: 42, file: "projects_data.xlsx", date: "7/4/2026 11:30",
      cols: ["Ticket ID", "Project Title", "Status", "Sector", "Contract Value"],
      rows: [
        ["PMM-001", "City Hall Renovation", "Active", "Construction", "$4,200,000"],
        ["PMM-002", "Metro Bridge Upgrade", "In Progress", "Infrastructure", "$8,750,000"],
        ["PMM-003", "Riverside Park Dev", "Planning", "Civil", "$2,100,000"],
        ["PMM-004", "Airport Terminal B", "Active", "Commercial", "$15,600,000"],
        ["PMM-005", "Harbor District", "On Hold", "Mixed-Use", "$6,300,000"],
      ],
    },
    {
      num: 2, name: "Staff / Team", icon: "👥", status: "done", count: 18, file: "staff_roster.xlsx", date: "7/4/2026 11:35",
      cols: ["Name", "Email", "Job Title", "Division", "Dept"],
      rows: [
        ["John Carter", "jcarter@co.com", "Project Manager", "Infrastructure", "Civil"],
        ["Sara Kim", "sara@co.com", "Sr. Engineer", "Transport", "Bridges"],
        ["Mike Ross", "mross@co.com", "Analyst", "Development", "Urban"],
      ],
    },
    { num: 3, name: "Opportunities", icon: "💼", status: "empty", count: 0, file: null, date: null, cols: [], rows: [] },
    { num: 4, name: "Leads", icon: "🔖", status: "empty", count: 0, file: null, date: null, cols: [], rows: [] },
    { num: 5, name: "Billing Rates", icon: "💲", status: "empty", count: 0, file: null, date: null, cols: [], rows: [] },
  ];

  return (
    <div style={{ height: "100vh", background: "#fafafa", display: "flex", fontFamily: "'Inter', 'Menlo', monospace" }}>
      {/* Left gutter — notebook line numbers */}
      <div style={{ width: 52, background: "#f1f5f9", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", paddingTop: 60 }}>
        {cells.map((c) => (
          <div key={c.num} onClick={() => setExpanded(expanded === c.num - 1 ? null : c.num - 1)} style={{
            padding: "18px 0", textAlign: "center", cursor: "pointer",
            borderBottom: "1px solid #e2e8f0",
          }}>
            <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace", fontWeight: 600 }}>[{c.num}]</div>
            <div style={{ fontSize: 8, color: c.status === "done" ? "#6ba539" : "#d1d5db", marginTop: 4 }}>●</div>
          </div>
        ))}
      </div>

      {/* Main notebook */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Toolbar */}
        <div style={{ height: 48, background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", padding: "0 20px", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: "#1b2b38" }}>RM<span style={{ color: "#6ba539" }}>ONE</span></span>
          <span style={{ color: "#e2e8f0" }}>·</span>
          <span style={{ fontSize: 12, color: "#64748b", fontFamily: "monospace" }}>import_data.xlsx</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "#6ba539", fontWeight: 600 }}>2 / 5 cells loaded</span>
        </div>

        {/* Cells */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          {cells.map((cell, idx) => (
            <div key={idx} style={{
              borderRadius: 10, border: "1px solid " + (idx === expanded ? "#6ba539" : "#e2e8f0"),
              background: "#fff", overflow: "hidden",
              boxShadow: idx === expanded ? "0 4px 20px rgba(107,165,57,0.1)" : "none",
            }}>
              {/* Cell header — always visible */}
              <div onClick={() => setExpanded(expanded === idx ? null : idx)} style={{
                padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                background: idx === expanded ? "#f0f9ea" : "#fff",
                borderBottom: idx === expanded ? "1px solid #d1fae5" : "none",
              }}>
                <span style={{ fontSize: 16 }}>{cell.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#1b2b38", flex: 1 }}>{cell.name}</span>
                {cell.status === "done" ? (
                  <>
                    <span style={{ fontSize: 10, color: "#6ba539", background: "#f0f9ea", padding: "2px 8px", borderRadius: 8, fontWeight: 700, border: "1px solid #a7f3d0" }}>✓ {cell.count} rows</span>
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>{cell.file} · {cell.date}</span>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>Empty — not yet uploaded</span>
                    <button onClick={e => e.stopPropagation()} style={{ padding: "4px 14px", fontSize: 10, fontWeight: 700, borderRadius: 5, background: "#6ba539", color: "#fff", border: "none", cursor: "pointer" }}>↑ Upload</button>
                    <button onClick={e => e.stopPropagation()} style={{ padding: "4px 10px", fontSize: 10, borderRadius: 5, background: "transparent", color: "#94a3b8", border: "1px solid #e2e8f0", cursor: "pointer" }}>↓ Template</button>
                  </>
                )}
                <span style={{ fontSize: 14, color: "#94a3b8", marginLeft: 4 }}>{idx === expanded ? "▲" : "▼"}</span>
              </div>

              {/* Expanded grid */}
              {idx === expanded && cell.status === "done" && (
                <div style={{ overflow: "auto", maxHeight: 280 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: "#1b2b38", position: "sticky", top: 0 }}>
                        <th style={{ width: 32, padding: "7px 4px", color: "rgba(255,255,255,0.25)", fontSize: 9, textAlign: "center", fontFamily: "monospace", borderRight: "1px solid rgba(255,255,255,0.08)" }}>#</th>
                        {cell.cols.map((c, i) => (
                          <th key={i} style={{ padding: "7px 14px", textAlign: "left", color: "#a9c23f", fontWeight: 700, fontSize: 10, borderRight: "1px solid rgba(255,255,255,0.08)", whiteSpace: "nowrap" }}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cell.rows.map((row, ri) => (
                        <tr key={ri} style={{ background: ri % 2 === 0 ? "#fff" : "#f8fafc" }}>
                          <td style={{ padding: "6px 4px", textAlign: "center", color: "#94a3b8", fontSize: 9, fontFamily: "monospace", borderRight: "1px solid #f1f5f9", borderBottom: "1px solid #f1f5f9" }}>{ri + 1}</td>
                          {row.map((cell2, ci) => (
                            <td key={ci} style={{
                              padding: "6px 14px", borderBottom: "1px solid #f1f5f9", borderRight: "1px solid #f1f5f9",
                              color: ci === 2 ? (cell2 === "Active" ? "#16a34a" : cell2 === "On Hold" ? "#d97706" : "#2563eb") : "#374151",
                              fontWeight: ci === 0 ? 700 : 400, whiteSpace: "nowrap",
                            }}>{cell2}</td>
                          ))}
                        </tr>
                      ))}
                      <tr style={{ background: "#f8fafc" }}>
                        <td colSpan={cell.cols.length + 1} style={{ padding: "8px 14px", fontSize: 10, color: "#94a3b8", textAlign: "center", borderTop: "1px solid #e2e8f0" }}>
                          +{cell.count - cell.rows.length} more rows · <span style={{ color: "#6ba539", cursor: "pointer" }}>Confirm & Import →</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
