export function B5Timeline() {
  const events = [
    { time: "11:35 AM", date: "7/4/2026", label: "Staff / Team", file: "staff_roster.xlsx", status: "success", count: 18, active: false },
    { time: "11:30 AM", date: "7/4/2026", label: "Projects", file: "projects_data.xlsx", status: "success", count: 42, active: true },
    { time: "9:14 AM", date: "7/3/2026", label: "Projects", file: "projects_v1.xlsx", status: "partial", count: 38, active: false },
    { time: "4:02 PM", date: "7/2/2026", label: "Projects", file: "projects_draft.xlsx", status: "failed", count: 0, active: false },
  ];
  const cols = ["Ticket ID", "Project Title", "Status", "Sector", "Division", "BU", "Contract Value"];
  const rows = [
    ["PMM-001", "City Hall Renovation", "Active", "Construction", "Civil Works", "Infrastructure", "$4,200,000"],
    ["PMM-002", "Metro Bridge Upgrade", "In Progress", "Infrastructure", "Transport", "Transport", "$8,750,000"],
    ["PMM-003", "Riverside Park Dev", "Planning", "Civil", "Public Works", "Public", "$2,100,000"],
    ["PMM-004", "Airport Terminal B", "Active", "Commercial", "Aviation", "Aviation", "$15,600,000"],
    ["PMM-005", "Harbor District", "On Hold", "Mixed-Use", "Urban Dev", "Development", "$6,300,000"],
    ["PMM-006", "Highway 9 Expansion", "Active", "Infrastructure", "Roads", "Transport", "$9,800,000"],
    ["PMM-007", "School District Reno", "Planning", "Education", "Public Edu.", "Public", "$3,450,000"],
  ];
  const statusColor: Record<string, string> = { success: "#16a34a", partial: "#d97706", failed: "#dc2626" };
  const statusBg:    Record<string, string> = { success: "#f0f9ea", partial: "#fff7ed", failed: "#fef2f2" };
  const statusLabel: Record<string, string> = { success: "✓ Success", partial: "⚠ Partial", failed: "✗ Failed" };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "Inter, sans-serif", background: "#f5f7fa" }}>
      {/* Top bar */}
      <div style={{ background: "#1b2b38", padding: "12px 24px", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>RM<span style={{ color: "#6ba539" }}>ONE</span></span>
        <span style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>Import History</span>
        <div style={{ flex: 1 }} />
        <button style={{ padding: "6px 16px", fontSize: 12, fontWeight: 700, borderRadius: 7, background: "#6ba539", color: "#fff", border: "none", cursor: "pointer" }}>↑ New Upload</button>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left timeline */}
        <div style={{ width: 280, background: "#fff", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "14px 16px 8px", borderBottom: "1px solid #f1f5f9" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Upload history</div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 0" }}>
            {events.map((e, i) => (
              <div key={i} style={{ position: "relative", paddingLeft: 40, paddingRight: 16, paddingBottom: 20 }}>
                {/* Timeline line */}
                {i < events.length - 1 && (
                  <div style={{ position: "absolute", left: 19, top: 20, bottom: 0, width: 2, background: "#f1f5f9" }} />
                )}
                {/* Dot */}
                <div style={{
                  position: "absolute", left: 11, top: 6,
                  width: 16, height: 16, borderRadius: "50%",
                  background: e.active ? "#6ba539" : statusBg[e.status],
                  border: "2px solid " + (e.active ? "#6ba539" : statusColor[e.status]),
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {e.active && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
                </div>

                <div style={{
                  borderRadius: 8, padding: "10px 12px",
                  background: e.active ? "#f0f9ea" : "#f8fafc",
                  border: e.active ? "2px solid #6ba539" : "1px solid #e2e8f0",
                  cursor: "pointer",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#1b2b38" }}>{e.label}</span>
                    <span style={{ fontSize: 9, color: statusColor[e.status], fontWeight: 700, background: statusBg[e.status], padding: "1px 6px", borderRadius: 5 }}>{statusLabel[e.status]}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.file}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 9, color: "#94a3b8" }}>{e.time} · {e.date}</span>
                    {e.count > 0 && <span style={{ fontSize: 9, color: statusColor[e.status], fontWeight: 600 }}>{e.count} rows</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: active upload data */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "12px 20px", background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#1b2b38" }}>Projects · projects_data.xlsx</span>
            <span style={{ fontSize: 11, color: "#6ba539", background: "#f0f9ea", padding: "2px 10px", borderRadius: 10, fontWeight: 600, border: "1px solid #a7f3d0" }}>✓ 42 rows · 7 cols</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: "#94a3b8" }}>7/4/2026 · 11:30 AM</span>
          </div>

          {/* Frozen-column spreadsheet */}
          <div style={{ flex: 1, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#1b2b38", position: "sticky", top: 0, zIndex: 5 }}>
                  <th style={{ width: 40, padding: "9px 6px", borderRight: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.25)", fontSize: 10, textAlign: "center", fontFamily: "monospace" }}>ROW</th>
                  {cols.map((c, i) => (
                    <th key={i} style={{
                      padding: "9px 16px", textAlign: "left", color: "#a9c23f", fontWeight: 700, fontSize: 11,
                      borderRight: "1px solid rgba(255,255,255,0.08)", whiteSpace: "nowrap",
                    }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 0 ? "#fff" : "#f8fafc" }}>
                    <td style={{ padding: "8px 6px", textAlign: "center", color: "#94a3b8", fontSize: 10, fontFamily: "monospace", borderRight: "1px solid #e2e8f0", borderBottom: "1px solid #f1f5f9" }}>{ri + 1}</td>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{
                        padding: "8px 16px", borderBottom: "1px solid #f1f5f9", borderRight: "1px solid #e2e8f0",
                        color: ci === 2 ? (cell === "Active" ? "#16a34a" : cell === "On Hold" ? "#d97706" : cell === "In Progress" ? "#2563eb" : "#6366f1") : "#374151",
                        fontWeight: ci === 0 ? 700 : 400, fontFamily: ci === 0 ? "monospace" : "inherit",
                        fontSize: 12, whiteSpace: "nowrap",
                      }}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Action footer */}
          <div style={{ padding: "10px 20px", borderTop: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "#64748b" }}>Showing latest successful import · 42 total rows</span>
            <div style={{ flex: 1 }} />
            <button style={{ padding: "6px 20px", fontSize: 12, fontWeight: 700, borderRadius: 6, background: "#6ba539", color: "#fff", border: "none", cursor: "pointer" }}>Confirm & Import →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
