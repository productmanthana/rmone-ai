import { useState } from "react";

const BU_COLOR = "#6366f1";
const DIV_COLOR = "#10b981";
const DEPT_COLOR = "#f59e0b";
const ROLE_COLOR = "#8b5cf6";
const JT_COLOR = "#ef4444";

const ORG_DATA = [
  {
    bu: "Buildings",
    color: "#eef2ff",
    border: "#6366f1",
    divisions: [
      { name: "Commercial", depts: ["Business Development", "Estimating", "Project Controls"] },
      { name: "Residential",  depts: ["Design", "Construction Management"] },
    ],
  },
  {
    bu: "Commercial BU",
    color: "#ecfdf5",
    border: "#10b981",
    divisions: [
      { name: "Northeast Division", depts: ["Architecture", "Civil Engineering", "MEP"] },
      { name: "Southeast Division", depts: ["Interior Design", "Structural"] },
    ],
  },
  {
    bu: "Education Division",
    color: "#fffbeb",
    border: "#f59e0b",
    divisions: [
      { name: "West Division", depts: ["K-12 Projects", "Higher Education"] },
      { name: "Central Division", depts: ["Curriculum Design", "Facilities"] },
    ],
  },
  {
    bu: "Healthcare",
    color: "#fdf2f8",
    border: "#ec4899",
    divisions: [
      { name: "Mid-Atlantic Division", depts: ["Medical Facilities", "Research Labs"] },
    ],
  },
  {
    bu: "Infrastructure",
    color: "#eff6ff",
    border: "#3b82f6",
    divisions: [
      { name: "Pacific Division", depts: ["Transportation", "Utilities"] },
      { name: "Mountain Division", depts: ["Energy", "Water Resources"] },
    ],
  },
];

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function NodeBadge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{ background: bg, color, border: `1px solid ${color}30`, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 600, letterSpacing: 0.3 }}>
      {label}
    </span>
  );
}

function BUPanel({ item, defaultOpen }: { item: typeof ORG_DATA[0]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const totalDepts = item.divisions.reduce((s, d) => s + d.depts.length, 0);

  return (
    <div style={{ border: `1.5px solid ${item.border}40`, borderRadius: 12, overflow: "hidden", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", background: open ? item.color : "#fff", border: "none", cursor: "pointer", transition: "background 0.2s", textAlign: "left" }}
      >
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.border, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#1a1a2e" }}>{item.bu}</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 1 }}>
            {item.divisions.length} Division{item.divisions.length !== 1 ? "s" : ""} · {totalDepts} Department{totalDepts !== 1 ? "s" : ""}
          </div>
        </div>
        <NodeBadge label="BUSINESS UNIT" color={item.border} bg={item.color} />
        <span style={{ color: "#9ca3af", marginLeft: 4 }}><ChevronIcon open={open} /></span>
      </button>

      {open && (
        <div style={{ padding: "0 18px 16px 18px", borderTop: `1px solid ${item.border}20` }}>
          {item.divisions.map(div => (
            <div key={div.name} style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ width: 2, height: 32, background: "#10b98140", borderRadius: 4, marginLeft: 4 }} />
                <div style={{ background: "#ecfdf5", border: "1px solid #10b98130", borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, color: "#065f46", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11 }}>◈</span> {div.name}
                  <span style={{ fontSize: 10, fontWeight: 500, color: "#6b7280", marginLeft: 4 }}>DIVISION</span>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginLeft: 26 }}>
                {div.depts.map(dept => (
                  <div key={dept} style={{ background: "#fffbeb", border: "1px solid #f59e0b30", borderRadius: 20, padding: "4px 12px", fontSize: 12, color: "#92400e", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 10 }}>▪</span> {dept}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function V1Accordion() {
  const [search, setSearch] = useState("");
  const filtered = ORG_DATA.filter(d =>
    d.bu.toLowerCase().includes(search.toLowerCase()) ||
    d.divisions.some(v => v.name.toLowerCase().includes(search.toLowerCase()) || v.depts.some(dept => dept.toLowerCase().includes(search.toLowerCase())))
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
<div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>Organization</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            {ORG_DATA.length} Business Units · {ORG_DATA.reduce((s,d)=>s+d.divisions.length,0)} Divisions
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ border: "1.5px solid #e5e7eb", borderRadius: 8, padding: "7px 14px", fontSize: 13, outline: "none", width: 200 }}
          />
          <button style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Add New BU Structure</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ padding: "12px 28px", display: "flex", gap: 20, background: "#fff", borderBottom: "1px solid #f3f4f6" }}>
        {[["Business Unit", BU_COLOR], ["Division", DIV_COLOR], ["Department", DEPT_COLOR]].map(([label, color]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#6b7280" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: color as string }} />
            {label}
          </div>
        ))}
      </div>

      {/* Accordion list */}
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 28px", display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map((item, i) => (
          <BUPanel key={item.bu} item={item} defaultOpen={i === 0} />
        ))}
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: "60px 0", fontSize: 14 }}>No results match "{search}"</div>
        )}
      </div>
    </div>
  );
}
