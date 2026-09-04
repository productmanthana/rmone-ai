import { useState } from "react";

export function B3DropFocus() {
  const [active, setActive] = useState<"pick" | "grid">("grid");
  const modules = ["Projects", "Staff / Team", "Opportunities", "Leads", "Billing Rates"];
  const [selMod, setSelMod] = useState(0);
  const cols = ["Ticket ID", "Project Title", "Status", "Sector", "Division", "Contract Value"];
  const rows = [
    ["PMM-001", "City Hall Renovation", "Active", "Construction", "Civil Works", "$4,200,000"],
    ["PMM-002", "Metro Bridge Upgrade", "In Progress", "Infrastructure", "Transport", "$8,750,000"],
    ["PMM-003", "Riverside Park Dev", "Planning", "Civil", "Public Works", "$2,100,000"],
    ["PMM-004", "Airport Terminal B", "Active", "Commercial", "Aviation", "$15,600,000"],
    ["PMM-005", "Harbor District", "On Hold", "Mixed-Use", "Development", "$6,300,000"],
    ["PMM-006", "Highway 9 Expansion", "Active", "Infrastructure", "Transport", "$9,800,000"],
  ];

  return (
    <div style={{ height: "100vh", background: "#fff", display: "flex", flexDirection: "column", fontFamily: "Inter, sans-serif" }}>
      {/* Minimal top bar */}
      <div style={{ height: 52, display: "flex", alignItems: "center", padding: "0 28px", borderBottom: "1px solid #f1f5f9", gap: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: "#1b2b38" }}>RM<span style={{ color: "#6ba539" }}>ONE</span></span>
        <span style={{ color: "#e2e8f0", fontSize: 18 }}>·</span>
        <span style={{ fontSize: 13, color: "#94a3b8" }}>Import Data</span>
        <div style={{ flex: 1 }} />
        {/* Module pill selector */}
        <div style={{ display: "flex", gap: 4, background: "#f8fafc", borderRadius: 8, padding: 3, border: "1px solid #e2e8f0" }}>
          {modules.map((m, i) => (
            <button key={i} onClick={() => setSelMod(i)} style={{
              padding: "4px 10px", fontSize: 11, fontWeight: 600, borderRadius: 6, border: "none", cursor: "pointer",
              background: selMod === i ? "#1b2b38" : "transparent",
              color: selMod === i ? "#fff" : "#64748b",
            }}>{m.split(" ")[0]}</button>
          ))}
        </div>
      </div>

      {active === "pick" ? (
        /* Upload screen */
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(ellipse at center, #f0f9ea 0%, #fff 70%)" }}>
          <div style={{ textAlign: "center", maxWidth: 520 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#6ba539", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Projects</div>
            <div style={{
              border: "2px dashed #a3c87c", borderRadius: 20, padding: "60px 40px",
              background: "rgba(107,165,57,0.04)", cursor: "pointer",
            }} onClick={() => setActive("grid")}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📂</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#1b2b38", marginBottom: 8 }}>Drop your Excel file here</div>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 24 }}>or click to browse — .xlsx or .csv</div>
              <button style={{ padding: "10px 32px", fontSize: 13, fontWeight: 700, borderRadius: 8, background: "#6ba539", color: "#fff", border: "none", cursor: "pointer" }}>↑ Choose file</button>
            </div>
            <button style={{ marginTop: 16, padding: "7px 20px", fontSize: 12, borderRadius: 7, background: "transparent", color: "#94a3b8", border: "1px solid #e2e8f0", cursor: "pointer" }}>↓ Download template instead</button>
          </div>
        </div>
      ) : (
        /* Grid screen — slides in after upload */
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Status bar */}
          <div style={{ padding: "10px 28px", background: "#f0f9ea", borderBottom: "2px solid #6ba539", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1b2b38" }}>✓ projects_data.xlsx uploaded</span>
            <span style={{ fontSize: 11, color: "#6ba539", fontWeight: 600 }}>42 rows · 6 columns recognised · 0 errors</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setActive("pick")} style={{ padding: "5px 14px", fontSize: 11, borderRadius: 6, background: "transparent", color: "#64748b", border: "1px solid #d1d5db", cursor: "pointer" }}>↑ Replace file</button>
            <button style={{ padding: "5px 18px", fontSize: 11, fontWeight: 700, borderRadius: 6, background: "#6ba539", color: "#fff", border: "none", cursor: "pointer" }}>Confirm & Import →</button>
          </div>

          {/* Column map hint */}
          <div style={{ padding: "7px 28px", background: "#fffbeb", borderBottom: "1px solid #fde68a", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#92400e" }}>MAPPED:</span>
            {["Ticket ID", "Project Title", "Status", "Sector", "Division", "Contract Value"].map((c, i) => (
              <span key={i} style={{ fontSize: 10, background: "#fef3c7", color: "#78350f", borderRadius: 4, padding: "2px 7px", fontWeight: 600 }}>{c}</span>
            ))}
          </div>

          {/* Data grid */}
          <div style={{ flex: 1, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#1b2b38", position: "sticky", top: 0 }}>
                  <th style={{ width: 40, padding: "9px 6px", color: "rgba(255,255,255,0.25)", fontSize: 10, textAlign: "center", borderRight: "1px solid rgba(255,255,255,0.08)" }}>#</th>
                  {cols.map((c, i) => (
                    <th key={i} style={{ padding: "9px 18px", textAlign: "left", color: "#a9c23f", fontWeight: 700, fontSize: 11, borderRight: "1px solid rgba(255,255,255,0.08)", whiteSpace: "nowrap" }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 0 ? "#fff" : "#f8fafc" }}>
                    <td style={{ padding: "9px 6px", textAlign: "center", color: "#94a3b8", fontSize: 10, borderRight: "1px solid #f1f5f9", borderBottom: "1px solid #f1f5f9" }}>{ri + 1}</td>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{
                        padding: "9px 18px", borderBottom: "1px solid #f1f5f9", borderRight: "1px solid #f1f5f9",
                        color: ci === 2 ? (cell === "Active" ? "#16a34a" : cell === "On Hold" ? "#d97706" : "#2563eb") : "#374151",
                        fontWeight: ci === 0 ? 700 : 400,
                      }}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
