import React, { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Edit2, Trash2, Users, Building2, Layers, Briefcase, GraduationCap } from "lucide-react";

/* ── Sample data ──────────────────────────────────────────────────────── */
const SAMPLE_ORG = {
  company: "Greenfield Infrastructure Partners",
  businessUnits: [
    {
      id: "bu1", name: "Engineering", color: "#6366f1",
      divisions: [
        {
          id: "div1", name: "Civil",
          departments: [
            { id: "dep1", name: "Site Works",   roles: ["Site Engineer", "Surveyor", "Inspector"] },
            { id: "dep2", name: "Geotechnical", roles: ["Geotech Engineer", "Lab Tech"] },
          ],
        },
        {
          id: "div2", name: "Structural",
          departments: [
            { id: "dep3", name: "Design",    roles: ["Structural Engineer", "BIM Coordinator"] },
            { id: "dep4", name: "Analysis",  roles: ["FEA Analyst"] },
          ],
        },
      ],
    },
    {
      id: "bu2", name: "Construction", color: "#10b981",
      divisions: [
        {
          id: "div3", name: "MEP",
          departments: [
            { id: "dep5", name: "Mechanical", roles: ["Mechanical Eng.", "HVAC Tech"] },
            { id: "dep6", name: "Electrical", roles: ["Electrical Eng.", "Estimator"] },
          ],
        },
        {
          id: "div4", name: "Fitout",
          departments: [
            { id: "dep7", name: "Interior",    roles: ["Interior Designer", "FF&E Coord."] },
          ],
        },
      ],
    },
    {
      id: "bu3", name: "Corporate Services", color: "#f59e0b",
      divisions: [
        {
          id: "div5", name: "Finance",
          departments: [
            { id: "dep8", name: "Accounting", roles: ["Financial Controller", "AP/AR"] },
          ],
        },
        {
          id: "div6", name: "HR",
          departments: [
            { id: "dep9", name: "Talent",      roles: ["HR Manager", "Recruiter"] },
          ],
        },
      ],
    },
  ],
};

/* ── Connector SVG between two elements ───────────────────────────────── */
function VConnector({ color = "#4b5563" }: { color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", height: 20 }}>
      <div style={{ width: 2, height: "100%", background: color }} />
    </div>
  );
}

function HLine({ count, color = "#4b5563" }: { count: number; color?: string }) {
  if (count <= 1) return <VConnector color={color} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
      <div style={{ width: 2, height: 16, background: color }} />
      <div style={{ width: "calc(100% - 32px)", height: 2, background: color }} />
    </div>
  );
}

/* ── Node box ─────────────────────────────────────────────────────────── */
function Node({
  label, sublabel, color, icon: Icon, size = "md", onClick, selected,
}: {
  label: string; sublabel?: string; color: string; icon: React.ElementType;
  size?: "lg" | "md" | "sm" | "xs"; onClick?: () => void; selected?: boolean;
}) {
  const pad = size === "lg" ? "12px 20px" : size === "sm" ? "6px 12px" : size === "xs" ? "4px 10px" : "8px 14px";
  const iconSize = size === "lg" ? 18 : size === "sm" ? 13 : size === "xs" ? 11 : 15;
  const fontSize = size === "lg" ? 15 : size === "sm" ? 11 : size === "xs" ? 10 : 12;

  return (
    <div
      onClick={onClick}
      style={{
        padding: pad,
        borderRadius: 8,
        border: `2px solid ${selected ? color : color + "60"}`,
        background: selected ? color + "22" : "#1a1a22",
        cursor: onClick ? "pointer" : "default",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
        minWidth: size === "lg" ? 200 : size === "sm" ? 110 : size === "xs" ? 90 : 130,
        maxWidth: size === "lg" ? 260 : size === "sm" ? 140 : size === "xs" ? 120 : 160,
        boxShadow: selected ? `0 0 0 3px ${color}40` : "0 2px 8px rgba(0,0,0,0.4)",
        transition: "all 0.15s",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon size={iconSize} style={{ color, flexShrink: 0 }} />
        <span style={{ fontSize, fontWeight: 700, color: "#f1f5f9", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", maxWidth: size === "lg" ? 200 : 120 }}>{label}</span>
      </div>
      {sublabel && (
        <span style={{ fontSize: fontSize - 1, color: "#94a3b8", textAlign: "center" }}>{sublabel}</span>
      )}
    </div>
  );
}

/* ── Role pill ────────────────────────────────────────────────────────── */
function RolePill({ label, color }: { label: string; color: string }) {
  return (
    <div style={{
      padding: "3px 9px", borderRadius: 20,
      background: color + "18", border: `1px solid ${color}40`,
      fontSize: 10, color: "#cbd5e1", whiteSpace: "nowrap",
    }}>
      {label}
    </div>
  );
}

/* ── Department column ────────────────────────────────────────────────── */
function DeptColumn({ dept, color, expanded }: { dept: typeof SAMPLE_ORG.businessUnits[0]["divisions"][0]["departments"][0]; color: string; expanded: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0, flex: "0 0 auto" }}>
      <VConnector color={color + "80"} />
      <Node label={dept.name} color={color} icon={Briefcase} size="sm" />
      {expanded && (
        <>
          <VConnector color={color + "60"} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
            {dept.roles.map(r => <RolePill key={r} label={r} color={color} />)}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Division block ───────────────────────────────────────────────────── */
function DivisionBlock({ div, color, expanded, deptExpanded }: {
  div: typeof SAMPLE_ORG.businessUnits[0]["divisions"][0];
  color: string; expanded: boolean; deptExpanded: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <VConnector color={color + "80"} />
      <Node label={div.name} color={color} icon={Layers} size="md" />
      {expanded && div.departments.length > 0 && (
        <>
          {div.departments.length > 1 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
              <div style={{ width: 2, height: 14, background: color + "80" }} />
              <div style={{ position: "relative", width: "100%", display: "flex", justifyContent: "center" }}>
                <div style={{
                  position: "absolute", top: 0, left: "10%", right: "10%",
                  height: 2, background: color + "60",
                }} />
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 0 }}>
                {div.departments.map(dep => (
                  <DeptColumn key={dep.id} dept={dep} color={color} expanded={deptExpanded} />
                ))}
              </div>
            </div>
          ) : (
            div.departments.map(dep => (
              <DeptColumn key={dep.id} dept={dep} color={color} expanded={deptExpanded} />
            ))
          )}
        </>
      )}
    </div>
  );
}

/* ── Business Unit block ──────────────────────────────────────────────── */
function BUBlock({ bu, expanded, divExpanded, deptExpanded }: {
  bu: typeof SAMPLE_ORG.businessUnits[0];
  expanded: boolean; divExpanded: boolean; deptExpanded: boolean;
}) {
  const { color } = bu;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <Node label={bu.name} color={color} icon={Building2} size="md" />
      {expanded && bu.divisions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
          {bu.divisions.length > 1 ? (
            <>
              <div style={{ width: 2, height: 14, background: color + "80" }} />
              <div style={{ width: "80%", height: 2, background: color + "60" }} />
              <div style={{ display: "flex", gap: 24 }}>
                {bu.divisions.map(div => (
                  <DivisionBlock key={div.id} div={div} color={color} expanded={divExpanded} deptExpanded={deptExpanded} />
                ))}
              </div>
            </>
          ) : (
            bu.divisions.map(div => (
              <DivisionBlock key={div.id} div={div} color={color} expanded={divExpanded} deptExpanded={deptExpanded} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main chart ───────────────────────────────────────────────────────── */
export default function OrgFlowchart() {
  const [showBUs,   setShowBUs]   = useState(true);
  const [showDivs,  setShowDivs]  = useState(true);
  const [showDepts, setShowDepts] = useState(true);
  const [showRoles, setShowRoles] = useState(false);

  const levels = [
    { key: "bu",   label: "Business Units", active: showBUs,   set: setShowBUs },
    { key: "div",  label: "Divisions",      active: showDivs,  set: setShowDivs },
    { key: "dept", label: "Departments",    active: showDepts, set: setShowDepts },
    { key: "role", label: "Roles",          active: showRoles, set: setShowRoles },
  ];

  return (
    <div style={{
      width: "100%", minHeight: "100vh",
      background: "#0f0f17",
      fontFamily: "'Inter', system-ui, sans-serif",
      display: "flex", flexDirection: "column",
    }}>

      {/* Header */}
      <div style={{
        padding: "16px 24px", borderBottom: "1px solid #1e1e2e",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#13131e",
      }}>
        <div>
<div style={{ fontSize: 11, fontWeight: 700, color: "#6366f1", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2 }}>Organization</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#f1f5f9" }}>Company Structure</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Level toggles */}
          {levels.map(lv => (
            <button
              key={lv.key}
              onClick={() => lv.set(p => !p)}
              style={{
                padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                border: `1.5px solid ${lv.active ? "#6366f1" : "#2d2d3e"}`,
                background: lv.active ? "#6366f120" : "transparent",
                color: lv.active ? "#a5b4fc" : "#64748b",
                transition: "all 0.15s",
              }}
            >
              {lv.label}
            </button>
          ))}
          <div style={{ width: 1, height: 24, background: "#2d2d3e" }} />
          <button style={{
            padding: "5px 14px", borderRadius: 6, fontSize: 11, fontWeight: 700,
            background: "#6366f1", color: "#fff", border: "none", cursor: "pointer",
          }}>
            + Add BU
          </button>
        </div>
      </div>

      {/* Chart canvas — scrollable */}
      <div style={{ flex: 1, overflowX: "auto", overflowY: "auto", padding: "32px 24px 48px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "max-content" }}>

          {/* Company root */}
          <Node
            label={SAMPLE_ORG.company}
sublabel="Organization Root"
            color="#6366f1"
            icon={Building2}
            size="lg"
          />

          {/* Vertical stem down to BU row */}
          {showBUs && (
            <>
              <div style={{ width: 2, height: 24, background: "#6366f160" }} />
              {/* Horizontal bar */}
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center", width: "100%",
              }}>
                <div style={{ width: "70%", height: 2, background: "#6366f140" }} />
                {/* BU row */}
                <div style={{ display: "flex", gap: 48, marginTop: 0, alignItems: "flex-start" }}>
                  {SAMPLE_ORG.businessUnits.map(bu => (
                    <BUBlock
                      key={bu.id}
                      bu={bu}
                      expanded={showBUs}
                      divExpanded={showDivs}
                      deptExpanded={showDepts}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {!showBUs && (
            <div style={{ marginTop: 32, color: "#64748b", fontSize: 13 }}>
              Toggle levels above to expand the chart
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{
        padding: "10px 24px", borderTop: "1px solid #1e1e2e",
        display: "flex", gap: 20, alignItems: "center",
        background: "#13131e",
      }}>
        {[
          { icon: Building2, label: "Business Unit", color: "#6366f1" },
          { icon: Layers,    label: "Division",      color: "#10b981" },
          { icon: Briefcase, label: "Department",    color: "#f59e0b" },
          { icon: GraduationCap, label: "Role",      color: "#94a3b8" },
        ].map(item => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <item.icon size={13} style={{ color: item.color }} />
            <span style={{ fontSize: 11, color: "#64748b" }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
