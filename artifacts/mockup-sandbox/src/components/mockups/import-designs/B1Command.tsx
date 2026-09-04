export function B1Command() {
  const modules = [
    { key: "P", name: "Projects", desc: "Projects + team assignments", count: 42, ok: true },
    { key: "S", name: "Staff / Team", desc: "People, roles & departments", count: 18, ok: true },
    { key: "O", name: "Opportunities", desc: "Opportunities + team", count: 0, ok: false },
    { key: "L", name: "Leads", desc: "Early-stage inquiries", count: 0, ok: false },
    { key: "B", name: "Billing Rates", desc: "Role billing & cost rates", count: 0, ok: false },
  ];
  const cols = ["Ticket ID", "Project Title", "Status", "Sector", "Division", "Contract Value"];
  const rows = [
    ["PMM-001", "City Hall Renovation", "Active", "Construction", "Civil Works", "$4,200,000"],
    ["PMM-002", "Metro Bridge Upgrade", "In Progress", "Infrastructure", "Transport", "$8,750,000"],
    ["PMM-003", "Riverside Park Dev", "Planning", "Civil", "Public Works", "$2,100,000"],
    ["PMM-004", "Airport Terminal B", "Active", "Commercial", "Aviation", "$15,600,000"],
    ["PMM-005", "Harbor District", "On Hold", "Mixed-Use", "Development", "$6,300,000"],
    ["PMM-006", "Highway 9 Expansion", "Active", "Infrastructure", "Transport", "$9,800,000"],
    ["PMM-007", "School District Reno", "Planning", "Education", "Public", "$3,450,000"],
  ];

  return (
    <div style={{ height: "100vh", background: "#0d1117", display: "flex", flexDirection: "column", fontFamily: "'Inter', monospace" }}>
      {/* Top bar */}
      <div style={{ padding: "14px 28px", display: "flex", alignItems: "center", gap: 14, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>RM<span style={{ color: "#6ba539" }}>ONE</span></span>
        <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 18 }}>/</span>
        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>import</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 5, background: "rgba(107,165,57,0.12)", color: "#6ba539", fontWeight: 600, border: "1px solid rgba(107,165,57,0.25)" }}>
          test10 · 2 of 5 modules loaded
        </span>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left command list */}
        <div style={{ width: 320, borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column" }}>
          {/* Search input */}
          <div style={{ padding: "16px 16px 8px" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px",
            }}>
              <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>⌘</span>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", flex: 1 }}>Select a module…</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", padding: "1px 5px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 3 }}>↵</span>
            </div>
          </div>
          <div style={{ padding: "4px 8px 8px", fontSize: 10, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", letterSpacing: "0.1em", paddingLeft: 16 }}>Modules</div>

          {modules.map((m, i) => (
            <div key={i} style={{
              margin: "2px 8px", padding: "10px 12px", borderRadius: 8, cursor: "pointer",
              background: i === 0 ? "rgba(107,165,57,0.12)" : "transparent",
              border: i === 0 ? "1px solid rgba(107,165,57,0.25)" : "1px solid transparent",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 6, background: i === 0 ? "#6ba539" : "rgba(255,255,255,0.06)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 800, color: i === 0 ? "#fff" : "rgba(255,255,255,0.3)",
                flexShrink: 0,
              }}>{m.key}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: i === 0 ? "#fff" : "rgba(255,255,255,0.6)" }}>{m.name}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.desc}</div>
              </div>
              {m.ok
                ? <span style={{ fontSize: 10, color: "#6ba539", fontWeight: 700, flexShrink: 0 }}>{m.count}</span>
                : <span style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", flexShrink: 0 }}>—</span>
              }
            </div>
          ))}

          <div style={{ flex: 1 }} />
          <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <button style={{
              width: "100%", padding: "9px 0", fontSize: 12, fontWeight: 700, borderRadius: 7,
              background: "#6ba539", color: "#fff", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
              <span>↑</span> Upload Excel for Projects
            </button>
            <button style={{ width: "100%", marginTop: 6, padding: "7px 0", fontSize: 11, borderRadius: 7, background: "transparent", color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer" }}>
              ↓ Download template
            </button>
          </div>
        </div>

        {/* Right: live grid */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Projects</span>
            <span style={{ fontSize: 11, color: "#6ba539", background: "rgba(107,165,57,0.12)", padding: "2px 10px", borderRadius: 10, fontWeight: 600, border: "1px solid rgba(107,165,57,0.2)" }}>42 rows</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>projects_data.xlsx · 7/4/2026</span>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#161b22", position: "sticky", top: 0 }}>
                  <th style={{ width: 36, padding: "9px 6px", color: "rgba(255,255,255,0.2)", fontSize: 10, textAlign: "center", borderRight: "1px solid rgba(255,255,255,0.05)", fontFamily: "monospace" }}>#</th>
                  {cols.map((c, i) => (
                    <th key={i} style={{ padding: "9px 16px", textAlign: "left", color: "#6ba539", fontWeight: 700, fontSize: 11, borderRight: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "8px 6px", textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 10, fontFamily: "monospace", borderRight: "1px solid rgba(255,255,255,0.05)" }}>{ri + 1}</td>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{
                        padding: "8px 16px", borderRight: "1px solid rgba(255,255,255,0.05)",
                        color: ci === 2
                          ? (cell === "Active" ? "#4ade80" : cell === "On Hold" ? "#fbbf24" : cell === "In Progress" ? "#60a5fa" : "#a78bfa")
                          : ci === 0 ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.55)",
                        fontWeight: ci === 0 ? 700 : 400, fontFamily: ci === 0 ? "monospace" : "inherit",
                      }}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "8px 20px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>42 rows · 6 cols · 0 errors</span>
            <div style={{ flex: 1 }} />
            <button style={{ padding: "6px 18px", fontSize: 11, fontWeight: 700, borderRadius: 6, background: "#6ba539", color: "#fff", border: "none", cursor: "pointer" }}>Confirm & Import →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
