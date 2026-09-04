// @ts-nocheck -- design mockup, excluded from strict typecheck
import React, { useState, useMemo, useRef, useEffect, ReactNode } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown, ChevronLeft, ChevronRight, Inbox, Sparkles, X, Target, DollarSign, Clock, Building2, TrendingUp, AlertCircle, FileText, CheckCircle2 } from "lucide-react";

// --- Theme ---
const T = {
  panel: "#ffffff",
  bg: "#f8fafc",
  border: "#e2e8f0",
  text: "#0f172a",
  muted: "#64748b",
  faint: "#cbd5e1",
  green: "#6BA539",
  greenLight: "#A9C23F",
  greenBg: "rgba(107, 165, 57, 0.1)",
  orange: "#f59e0b",
  red: "#ef4444",
};

// --- Mock Data ---
type RecordStatus = "Open" | "Active" | "Closed";

interface ProjectRecord {
  id: string;
  name: string;
  status: RecordStatus;
  value: number; // in millions
}

interface Company {
  id: string;
  name: string;
  records: ProjectRecord[];
}

const mockCompanies: Company[] = [
  {
    id: "COM-101",
    name: "Turner Construction",
    records: [
      { id: "PMM-22-00598", name: "JFK Terminal 4 Redevelopment", status: "Active", value: 1200 },
      { id: "PMM-23-01021", name: "NYU Langone Medical Center", status: "Active", value: 850 },
      { id: "PMM-24-00104", name: "Hudson Yards Phase 2", status: "Open", value: 450 },
      { id: "PMM-21-00832", name: "Columbia University Dorm", status: "Closed", value: 120 },
    ],
  },
  {
    id: "COM-102",
    name: "Skanska USA",
    records: [
      { id: "PMM-23-00401", name: "LaGuardia Central Terminal", status: "Active", value: 950 },
      { id: "PMM-24-00056", name: "Moynihan Train Hall Expansion", status: "Open", value: 300 },
      { id: "PMM-22-00912", name: "Brooklyn Bridge Park Reno", status: "Closed", value: 65 },
    ],
  },
  {
    id: "COM-103",
    name: "NYC DDC",
    records: [
      { id: "PMM-23-00822", name: "East River Coastal Resiliency", status: "Active", value: 1450 },
      { id: "PMM-24-00219", name: "Queens Public Library", status: "Open", value: 180 },
      { id: "PMM-23-00331", name: "Staten Island Courthouse", status: "Active", value: 210 },
      { id: "PMM-21-00455", name: "Bronx Animal Shelter", status: "Closed", value: 85 },
      { id: "PMM-24-00501", name: "Manhattan Firehouse 22", status: "Open", value: 45 },
    ],
  },
  {
    id: "COM-104",
    name: "Port Authority NY/NJ",
    records: [
      { id: "PMM-22-00112", name: "Newark AirTrain Replacement", status: "Active", value: 2050 },
      { id: "PMM-24-00099", name: "GWB Rehabilitation", status: "Open", value: 550 },
    ],
  },
  {
    id: "COM-105",
    name: "Gilbane",
    records: [
      { id: "PMM-23-00671", name: "WTC Site 5 Tower", status: "Active", value: 1100 },
      { id: "PMM-21-00222", name: "Pace University Science Bldg", status: "Closed", value: 175 },
      { id: "PMM-24-00310", name: "Kings County Hospital Wing", status: "Open", value: 240 },
    ],
  },
  {
    id: "COM-106",
    name: "AECOM",
    records: [
      { id: "PMM-22-00788", name: "Gateway Program Tunnel", status: "Active", value: 3500 },
      { id: "PMM-24-00411", name: "Penn Station Access", status: "Open", value: 1200 },
      { id: "PMM-20-00101", name: "Second Avenue Subway Ph 1", status: "Closed", value: 4400 },
      { id: "PMM-23-00155", name: "Metro-North Resiliency", status: "Active", value: 320 },
    ],
  },
  {
    id: "COM-107",
    name: "Hensel Phelps",
    records: [
      { id: "PMM-23-00502", name: "Bellevue Hospital Upgrade", status: "Active", value: 410 },
      { id: "PMM-22-00305", name: "CUNY Tech Hub", status: "Closed", value: 195 },
    ],
  },
  {
    id: "COM-108",
    name: "Suffolk",
    records: [
      { id: "PMM-24-00111", name: "Boston Seaport Tower", status: "Open", value: 650 },
      { id: "PMM-23-00922", name: "UMass Science Center", status: "Active", value: 380 },
      { id: "PMM-21-00644", name: "Logan Airport Terminal E", status: "Closed", value: 890 },
      { id: "PMM-24-00801", name: "Fenway Tech Campus", status: "Open", value: 420 },
    ],
  },
];

// --- Utilities ---
function fmtM(v: number): string {
  if (v == null || isNaN(v)) return "—";
  if (v === 0) return "$0";
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}B`;
  return `$${v.toFixed(0)}M`;
}

function IdPill({ id }: { id: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "4px 10px", borderRadius: 8,
      background: `linear-gradient(135deg, ${T.green}, #578a2e)`,
      color: "#fff", fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
      whiteSpace: "nowrap", boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
    }}>
      {id}
    </span>
  );
}

function CountBadge({ count, type, onClick }: { count: number; type: string; onClick?: () => void }) {
  let bg = "#f1f5f9";
  let col = "#64748b";
  let border = "#cbd5e1";
  
  if (count > 0) {
    if (type === "Open") { bg = "#eff6ff"; col = "#3b82f6"; border = "#bfdbfe"; }
    else if (type === "Active") { bg = "#f0fdf4"; col = "#16a34a"; border = "#bbf7d0"; }
    else if (type === "Total") { bg = "#f8fafc"; col = "#0f172a"; border = "#e2e8f0"; }
  }

  return (
    <button
      onClick={(e) => {
        if (onClick) {
          e.stopPropagation();
          onClick();
        }
      }}
      disabled={count === 0}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minWidth: 28, height: 24, padding: "0 8px", borderRadius: 12,
        backgroundColor: bg, border: `1px solid ${border}`, color: col,
        fontSize: 12, fontWeight: 700,
        cursor: count > 0 && onClick ? "pointer" : "default",
        transition: "all 0.15s",
        opacity: count === 0 ? 0.5 : 1,
      }}
      className={count > 0 && onClick ? "hover-badge" : ""}
    >
      {count}
    </button>
  );
}

// --- Drill-down Popup ---
function DrillDownPopup({ 
  company, bucket, records, onClose, anchorRect 
}: { 
  company: string; bucket: string; records: ProjectRecord[]; onClose: () => void; anchorRect: DOMRect | null 
}) {
  if (!anchorRect) return null;

  return (
    <>
      <div 
        style={{ position: "fixed", inset: 0, zIndex: 100 }} 
        onClick={onClose} 
      />
      <div 
        style={{
          position: "fixed", zIndex: 101,
          top: Math.min(anchorRect.bottom + 8, window.innerHeight - 300),
          left: Math.max(16, Math.min(anchorRect.left - 100, window.innerWidth - 350)),
          width: 320, maxHeight: 300,
          backgroundColor: T.panel,
          borderRadius: 12,
          border: `1px solid ${T.border}`,
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          animation: "popupIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
        }}
      >
        <div style={{
          padding: "12px 16px", borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          backgroundColor: "#f8fafc"
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>
              {company}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginTop: 2 }}>
              {bucket} Records ({records.length})
            </div>
          </div>
          <button 
            onClick={onClose}
            style={{ 
              background: "transparent", border: "none", cursor: "pointer", 
              color: T.muted, padding: 4, borderRadius: 6 
            }}
            className="hover-bg"
          >
            <X size={16} />
          </button>
        </div>
        <div style={{ overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {records.map(r => (
            <div key={r.id} style={{ 
              padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`,
              display: "flex", alignItems: "center", gap: 12
            }}>
              <div><IdPill id={r.id} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.name}
                </div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2, display: "flex", gap: 8 }}>
                  <span>{r.status}</span>
                  <span>•</span>
                  <span style={{ fontWeight: 600, color: T.green }}>{fmtM(r.value)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// --- Intel Popup ---
function IntelPopup({ 
  company, onClose, anchorRect 
}: { 
  company: Company; onClose: () => void; anchorRect: DOMRect | null 
}) {
  if (!anchorRect) return null;

  // Compute insights
  const totalValue = company.records.reduce((sum, r) => sum + r.value, 0);
  const avgSize = company.records.length ? totalValue / company.records.length : 0;
  const largest = [...company.records].sort((a, b) => b.value - a.value)[0];
  const activeCount = company.records.filter(r => r.status === "Active").length;
  const totalCount = company.records.length;
  
  // Dummy total portfolio size for share %
  const allCompaniesTotal = mockCompanies.reduce((sum, c) => sum + c.records.reduce((s, r) => s + r.value, 0), 0);
  const portfolioShare = totalValue / allCompaniesTotal;

  return (
    <>
      <div 
        style={{ position: "fixed", inset: 0, zIndex: 100 }} 
        onClick={onClose} 
      />
      <div 
        style={{
          position: "fixed", zIndex: 101,
          top: Math.min(anchorRect.top, window.innerHeight - 450),
          left: Math.min(anchorRect.right + 12, window.innerWidth - 380),
          width: 360,
          backgroundColor: T.panel,
          borderRadius: 16,
          border: `1px solid ${T.border}`,
          boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          animation: "popupIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
        }}
      >
        <div style={{
          padding: "16px 20px", borderBottom: `1px solid ${T.border}`,
          background: "linear-gradient(to right, #f8fafc, #ffffff)",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between"
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <Sparkles size={14} color={T.green} fill={T.greenBg} />
              <span style={{ fontSize: 11, fontWeight: 700, color: T.green, textTransform: "uppercase", letterSpacing: 0.5 }}>
                AI Analysis
              </span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>
              {company.name}
            </div>
          </div>
          <button 
            onClick={onClose}
            style={{ 
              background: "transparent", border: "none", cursor: "pointer", 
              color: T.muted, padding: 4, borderRadius: 6, marginTop: -4, marginRight: -4
            }}
            className="hover-bg"
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: "20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
            <div style={{ padding: 12, backgroundColor: T.bg, borderRadius: 10, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, color: T.muted, fontWeight: 600, marginBottom: 4 }}>Portfolio Share</div>
              <div style={{ fontSize: 18, color: T.text, fontWeight: 800 }}>{(portfolioShare * 100).toFixed(1)}%</div>
            </div>
            <div style={{ padding: 12, backgroundColor: T.bg, borderRadius: 10, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, color: T.muted, fontWeight: 600, marginBottom: 4 }}>Avg Project Size</div>
              <div style={{ fontSize: 18, color: T.text, fontWeight: 800 }}>{fmtM(avgSize)}</div>
            </div>
            <div style={{ gridColumn: "span 2", padding: 12, backgroundColor: T.bg, borderRadius: 10, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, color: T.muted, fontWeight: 600, marginBottom: 4 }}>Largest Project</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 14, color: T.text, fontWeight: 600 }}>{largest?.name || "None"}</div>
                <div style={{ fontSize: 14, color: T.green, fontWeight: 700 }}>{largest ? fmtM(largest.value) : "—"}</div>
              </div>
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${T.border}`, margin: "0 -20px", padding: "20px 20px 0" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.text, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
              Management Perspective
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ 
                  width: 28, height: 28, borderRadius: 8, backgroundColor: "#eff6ff", 
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                }}>
                  <Target size={14} color="#3b82f6" />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Strategy</div>
                  <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.4, marginTop: 2 }}>
                    High concentration of value in {activeCount} active projects. Opportunity to pivot {totalCount - activeCount} pipeline items to active status.
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ 
                  width: 28, height: 28, borderRadius: 8, backgroundColor: "#f0fdf4", 
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                }}>
                  <DollarSign size={14} color="#16a34a" />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Financials</div>
                  <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.4, marginTop: 2 }}>
                    Stable exposure with {fmtM(totalValue)} total contract value. Focus on margin protection for the {largest?.name} project.
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ 
                  width: 28, height: 28, borderRadius: 8, backgroundColor: "#fef3c7", 
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                }}>
                  <TrendingUp size={14} color="#d97706" />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Delivery</div>
                  <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.4, marginTop: 2 }}>
                    Consistent throughput. Ensure adequate resourcing for the transition of Open records to Active phase over the next quarter.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// --- Data Grid Component ---
export default function CurrentGrid() {
  const [drillDown, setDrillDown] = useState<{ company: string; bucket: string; records: ProjectRecord[]; anchorRect: DOMRect } | null>(null);
  const [intel, setIntel] = useState<{ company: Company; anchorRect: DOMRect } | null>(null);

  const handleCountClick = (e: React.MouseEvent, company: Company, bucket: string, records: ProjectRecord[]) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDrillDown({ company: company.name, bucket, records, anchorRect: rect });
  };

  const handleIntelClick = (e: React.MouseEvent, company: Company) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setIntel({ company, anchorRect: rect });
  };

  return (
    <div style={{ 
      minHeight: "100vh", backgroundColor: T.bg, padding: "40px", fontFamily: "system-ui, -apple-system, sans-serif" 
    }}>
      <style>{`
        * { box-sizing: border-box; }
        .hover-badge:hover { transform: translateY(-1px); filter: brightness(0.95); }
        .hover-badge:active { transform: translateY(0); }
        .hover-bg:hover { background-color: rgba(0,0,0,0.05) !important; }
        .dg-row { transition: background-color 0.15s; }
        .dg-row:hover { background-color: rgba(107, 165, 57, 0.04) !important; }
        @keyframes popupIn {
          from { opacity: 0; transform: scale(0.95) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .ai-affordance { opacity: 0; transition: opacity 0.2s; }
        .dg-row:hover .ai-affordance { opacity: 1; }
      `}</style>

      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        
        <div style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: T.text, letterSpacing: -0.5 }}>
              Companies
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 14, color: T.muted }}>
              Client portfolios and aggregate project data.
            </p>
          </div>
        </div>

        <div style={{
          backgroundColor: T.panel,
          borderRadius: 14,
          border: `1px solid ${T.border}`,
          boxShadow: "0 4px 18px rgba(0,0,0,0.05)",
          overflow: "hidden"
        }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 800, color: T.muted, textTransform: "uppercase", letterSpacing: 0.8, borderBottom: `2px solid ${T.border}`, width: "30%" }}>
                  Company Name
                </th>
                <th style={{ padding: "12px 16px", textAlign: "center", fontSize: 11, fontWeight: 800, color: T.muted, textTransform: "uppercase", letterSpacing: 0.8, borderBottom: `2px solid ${T.border}`, width: "12%" }}>
                  Total
                </th>
                <th style={{ padding: "12px 16px", textAlign: "center", fontSize: 11, fontWeight: 800, color: T.muted, textTransform: "uppercase", letterSpacing: 0.8, borderBottom: `2px solid ${T.border}`, width: "12%" }}>
                  Open
                </th>
                <th style={{ padding: "12px 16px", textAlign: "center", fontSize: 11, fontWeight: 800, color: T.muted, textTransform: "uppercase", letterSpacing: 0.8, borderBottom: `2px solid ${T.border}`, width: "12%" }}>
                  Active
                </th>
                <th style={{ padding: "12px 16px", textAlign: "center", fontSize: 11, fontWeight: 800, color: T.muted, textTransform: "uppercase", letterSpacing: 0.8, borderBottom: `2px solid ${T.border}`, width: "12%" }}>
                  Closed
                </th>
                <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 11, fontWeight: 800, color: T.muted, textTransform: "uppercase", letterSpacing: 0.8, borderBottom: `2px solid ${T.border}`, width: "16%" }}>
                  Total Value
                </th>
                <th style={{ padding: "12px 16px", textAlign: "center", fontSize: 11, fontWeight: 800, color: T.muted, textTransform: "uppercase", letterSpacing: 0.8, borderBottom: `2px solid ${T.border}`, width: "6%" }}>
                  
                </th>
              </tr>
            </thead>
            <tbody>
              {mockCompanies.map((c, i) => {
                const total = c.records.length;
                const open = c.records.filter(r => r.status === "Open");
                const active = c.records.filter(r => r.status === "Active");
                const closed = c.records.filter(r => r.status === "Closed");
                const val = c.records.reduce((sum, r) => sum + r.value, 0);

                return (
                  <tr key={c.id} className="dg-row" style={{ backgroundColor: i % 2 === 1 ? "#fafafa" : "transparent" }}>
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}` }}>
                      <button 
                        onClick={(e) => handleIntelClick(e, c)}
                        style={{ 
                          background: "none", border: "none", padding: 0, 
                          fontSize: 14, fontWeight: 700, color: T.text, 
                          cursor: "pointer", display: "flex", alignItems: "center", gap: 8 
                        }}
                      >
                        <Building2 size={16} color={T.muted} />
                        {c.name}
                      </button>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "center", borderBottom: `1px solid ${T.border}` }}>
                      <CountBadge count={total} type="Total" onClick={(e) => handleCountClick(e as any, c, "Total", c.records)} />
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "center", borderBottom: `1px solid ${T.border}` }}>
                      <CountBadge count={open.length} type="Open" onClick={(e) => handleCountClick(e as any, c, "Open", open)} />
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "center", borderBottom: `1px solid ${T.border}` }}>
                      <CountBadge count={active.length} type="Active" onClick={(e) => handleCountClick(e as any, c, "Active", active)} />
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "center", borderBottom: `1px solid ${T.border}` }}>
                      <CountBadge count={closed.length} type="Closed" onClick={(e) => handleCountClick(e as any, c, "Closed", closed)} />
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right", borderBottom: `1px solid ${T.border}` }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{fmtM(val)}</span>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "center", borderBottom: `1px solid ${T.border}` }}>
                      <button 
                        className="ai-affordance hover-bg"
                        onClick={(e) => handleIntelClick(e, c)}
                        style={{ 
                          background: "none", border: "none", padding: 6, borderRadius: 6,
                          cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center"
                        }}
                        title="AI Analysis"
                      >
                        <Sparkles size={16} color={T.green} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ padding: "10px 16px", backgroundColor: T.panel, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: T.muted, fontWeight: 600 }}>
              Page 1 of 1 <span style={{ color: T.faint }}>(8 items)</span>
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              <button disabled style={{ width: 26, height: 26, borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.faint, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <ChevronLeft size={14} />
              </button>
              <button style={{ width: 26, height: 26, borderRadius: 6, border: `1px solid ${T.green}`, background: T.green, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                1
              </button>
              <button disabled style={{ width: 26, height: 26, borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.faint, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

      </div>

      {drillDown && (
        <DrillDownPopup 
          company={drillDown.company} 
          bucket={drillDown.bucket} 
          records={drillDown.records} 
          anchorRect={drillDown.anchorRect}
          onClose={() => setDrillDown(null)} 
        />
      )}

      {intel && (
        <IntelPopup 
          company={intel.company}
          anchorRect={intel.anchorRect}
          onClose={() => setIntel(null)}
        />
      )}

    </div>
  );
}
