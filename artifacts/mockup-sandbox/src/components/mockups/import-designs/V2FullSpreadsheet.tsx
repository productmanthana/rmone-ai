export function V2FullSpreadsheet() {
  const tabs = ["Projects", "Staff / Team", "Opportunities", "Leads", "Billing Rates"];
  const cols = ["A · Ticket ID", "B · Project Title", "C · Status", "D · Sector", "E · BU / Division", "F · Target Start", "G · Target End", "H · Contract Value"];
  const rows = [
    ["PMM-001", "City Hall Renovation", "Active", "Construction", "Infrastructure / Civil", "01/2024", "12/2025", "$4,200,000"],
    ["PMM-002", "Metro Bridge Upgrade", "In Progress", "Infrastructure", "Transport / Bridges", "03/2024", "03/2026", "$8,750,000"],
    ["PMM-003", "Riverside Park Dev", "Planning", "Civil", "Public Works / Parks", "06/2025", "06/2026", "$2,100,000"],
    ["PMM-004", "Airport Terminal B", "Active", "Commercial", "Aviation / Terminal", "11/2023", "09/2025", "$15,600,000"],
    ["PMM-005", "Harbor District", "On Hold", "Mixed-Use", "Development / Urban", "09/2025", "01/2027", "$6,300,000"],
    ["PMM-006", "Highway 9 Expansion", "Active", "Infrastructure", "Transport / Roads", "02/2024", "11/2025", "$9,800,000"],
    ["PMM-007", "School District Reno", "Planning", "Education", "Public / Education", "01/2026", "04/2026", "$3,450,000"],
    ["PMM-008", "Convention Center", "Active", "Commercial", "Development / Comm.", "05/2023", "07/2025", "$22,100,000"],
    ["PMM-009", "Water Treatment Plant", "Planning", "Utilities", "Infrastructure / Water", "07/2026", "12/2027", "$11,200,000"],
    ["PMM-010", "Transit Hub Central", "Active", "Transport", "Transport / Rail", "10/2023", "05/2026", "$18,900,000"],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "Inter, sans-serif", background: "#fff" }}>
      {/* Top bar */}
      <div style={{ height: 50, background: "#1b2b38", display: "flex", alignItems: "center", padding: "0 20px", gap: 16, flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>RM<span style={{ color: "#6ba539" }}>ONE</span></span>
        <span style={{ color: "rgba(255,255,255,0.2)" }}>|</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#d0dae5" }}>Import Data</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "#8a9bb0" }}>company: test10 &nbsp;·&nbsp; last upload: 7/4/2026 11:30 AM &nbsp;·&nbsp;</span>
        <span style={{ fontSize: 11, color: "#6ba539" }}>✓ success</span>
      </div>

      {/* Module tabs */}
      <div style={{ display: "flex", borderBottom: "2px solid #e2e8f0", background: "#f8fafc", padding: "0 20px", flexShrink: 0 }}>
        {tabs.map((t, i) => (
          <div key={i} style={{
            padding: "10px 18px", fontSize: 13, fontWeight: i === 0 ? 700 : 400,
            color: i === 0 ? "#6ba539" : "#64748b", borderBottom: i === 0 ? "2px solid #6ba539" : "2px solid transparent",
            marginBottom: -2, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
          }}>
            {t}
            {i < 2 && <span style={{ fontSize: 10, background: i === 0 ? "#6ba539" : "#e2e8f0", color: i === 0 ? "#fff" : "#64748b", borderRadius: 8, padding: "1px 6px", fontWeight: 700 }}>{i === 0 ? "42" : "18"}</span>}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 2 }}>
          <button style={{ padding: "5px 12px", fontSize: 12, borderRadius: 5, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", cursor: "pointer" }}>↓ Template</button>
          <button style={{ padding: "5px 14px", fontSize: 12, fontWeight: 700, borderRadius: 5, border: "none", background: "#6ba539", color: "#fff", cursor: "pointer" }}>↑ Upload</button>
        </div>
      </div>

      {/* Spreadsheet */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, width: "max-content", minWidth: "100%" }}>
          <thead>
            <tr style={{ background: "#1b2b38", position: "sticky", top: 0, zIndex: 10 }}>
              <th style={{ width: 40, padding: "9px 6px", borderRight: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: 600, textAlign: "center", fontFamily: "monospace" }}>ROW</th>
              {cols.map((c, i) => (
                <th key={i} style={{
                  padding: "9px 16px", borderRight: "1px solid rgba(255,255,255,0.08)", textAlign: "left",
                  color: "#a9c23f", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", letterSpacing: "0.02em",
                }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 === 0 ? "#fff" : "#f8fafc" }}>
                <td style={{ padding: "7px 6px", borderBottom: "1px solid #f1f5f9", borderRight: "1px solid #e2e8f0", textAlign: "center", color: "#94a3b8", fontSize: 10, fontFamily: "monospace" }}>{ri + 1}</td>
                {row.map((cell, ci) => (
                  <td key={ci} style={{
                    padding: "7px 16px", borderBottom: "1px solid #f1f5f9", borderRight: "1px solid #e2e8f0",
                    color: ci === 2 ? (cell === "Active" ? "#16a34a" : cell === "On Hold" ? "#d97706" : cell === "In Progress" ? "#2563eb" : "#6366f1") : "#374151",
                    fontWeight: ci === 0 ? 700 : 400, fontFamily: ci === 0 ? "monospace" : "inherit",
                    fontSize: 12, whiteSpace: "nowrap",
                  }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer status */}
      <div style={{ height: 32, background: "#1b2b38", display: "flex", alignItems: "center", padding: "0 20px", gap: 20, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: "#5a6d7c" }}>42 rows · 8 columns mapped · 0 errors</span>
        <div style={{ flex: 1 }} />
        <button style={{ padding: "3px 14px", fontSize: 11, fontWeight: 700, borderRadius: 4, border: "none", background: "#6ba539", color: "#fff", cursor: "pointer" }}>Confirm & Import →</button>
      </div>
    </div>
  );
}
