/**
 * "Adoption across the organization" — WOW-factor dual-axis combo chart.
 * Columns = enabled staff (left axis) with active staff overlay.
 * Line = adoption rate % (right axis) with glowing dots and floating labels.
 * Tab switcher cycles Division / Business Unit / Department.
 */
import "./_group.css";
import { useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  LabelList,
} from "recharts";

/* ── Design tokens ── */
const BG       = "#0B1623";
const PANEL    = "linear-gradient(160deg,rgba(30,52,74,0.65) 0%,rgba(18,32,46,0.80) 100%)";
const BORDER   = "rgba(107,165,57,0.22)";
const TEXT     = "#E2EDF5";
const MUTED    = "rgba(255,255,255,0.45)";
const GREEN    = "#6BA539";
const GREEN_LT = "#8EC94A";
const LIME     = "#D4FF40";
const STEEL    = "#2E4D6E";
const TICK     = { fontSize: 10, fill: "rgba(255,255,255,0.45)" } as const;

/* ── Data ── */
const divisionData = [
  { name: "Const. Mgt",    enabled: 307, active: 117, rate: 38 },
  { name: "Civil & Str.",  enabled: 51,  active: 24,  rate: 47 },
  { name: "MEP",           enabled: 49,  active: 18,  rate: 37 },
  { name: "Architecture",  enabled: 49,  active: 19,  rate: 39 },
  { name: "Cold Storage",  enabled: 19,  active: 8,   rate: 42 },
  { name: "Unassigned",    enabled: 7,   active: 3,   rate: 43 },
  { name: "NewCo Constr.", enabled: 6,   active: 0,   rate: 0  },
  { name: "Telecom",       enabled: 2,   active: 1,   rate: 50 },
];

const buData = [
  { name: "Const. Mgt",    enabled: 307, active: 117, rate: 38 },
  { name: "Civil & Str.",  enabled: 51,  active: 24,  rate: 47 },
  { name: "MEP",           enabled: 49,  active: 18,  rate: 37 },
  { name: "Architecture",  enabled: 49,  active: 19,  rate: 39 },
  { name: "NewCo Constr.", enabled: 25,  active: 8,   rate: 32 },
  { name: "Cold Storage",  enabled: 7,   active: 3,   rate: 43 },
  { name: "Telecom",       enabled: 2,   active: 1,   rate: 50 },
  { name: "Virtual Design",enabled: 2,   active: 2,   rate: 100},
];

const deptData = [
  { name: "Unassigned",    enabled: 415, active: 166, rate: 40 },
  { name: "New York City", enabled: 55,  active: 18,  rate: 33 },
  { name: "Cold Storage",  enabled: 5,   active: 3,   rate: 60 },
  { name: "Mineola Field", enabled: 4,   active: 2,   rate: 50 },
  { name: "Houston",       enabled: 3,   active: 1,   rate: 33 },
  { name: "New Jersey",    enabled: 3,   active: 2,   rate: 67 },
  { name: "Dallas",        enabled: 3,   active: 1,   rate: 33 },
  { name: "Atlanta",       enabled: 2,   active: 0,   rate: 0  },
];

const TABS = [
  { key: "div", label: "Division",       count: 8,  data: divisionData },
  { key: "bu",  label: "Business Unit",  count: 9,  data: buData       },
  { key: "dep", label: "Department",     count: 11, data: deptData      },
] as const;

/* ── Custom dot with glow ── */
function GlowDot(props: any) {
  const { cx, cy, value } = props;
  if (value === 0) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={9} fill="#0B1623" stroke={LIME} strokeWidth={2}
        style={{ filter: `drop-shadow(0 0 6px ${LIME})` }} />
      <circle cx={cx} cy={cy} r={3} fill={LIME} />
    </g>
  );
}

/* ── Rate label above the dot (Line labels use x/y of the point directly) ── */
function RateLabel(props: any) {
  const { x, y, value } = props;
  const cx = Number(x), cy = Number(y);
  if (!value || isNaN(cx) || isNaN(cy)) return null;
  return (
    <text x={cx} y={cy - 16} textAnchor="middle"
      fontSize={9} fontWeight={700} fill={LIME}
      style={{ filter: `drop-shadow(0 0 4px ${LIME}88)` }}>
      {value}%
    </text>
  );
}

/* ── Count label atop enabled bar ── */
function EnabledLabel(props: any) {
  const { x, y, width, value } = props;
  const cx = Number(x) + Number(width) / 2;
  if (!value || isNaN(cx)) return null;
  return (
    <text x={cx} y={Number(y) - 5} textAnchor="middle"
      fontSize={9} fontWeight={700} fill="rgba(255,255,255,0.65)">
      {Number(value).toLocaleString()}
    </text>
  );
}

const TIP_STYLE = {
  background: "#132030",
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  color: TEXT,
  fontSize: 11,
  boxShadow: "0 14px 36px rgba(0,0,0,0.55)",
  padding: "10px 14px",
};

export default function AdoptionComboChart() {
  const [activeTab, setActiveTab] = useState<"div" | "bu" | "dep">("bu");
  const tab = TABS.find(t => t.key === activeTab)!;
  const zeroed = tab.data.filter(d => d.enabled === 0).length;
  const maxEnabled = Math.max(...tab.data.map(d => d.enabled));

  return (
    <div className="rmone-analytics" style={{ background: BG, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{
        width: 760, borderRadius: 20, overflow: "hidden",
        background: PANEL, border: `1px solid ${BORDER}`,
        boxShadow: "0 24px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}>
        {/* ── Header ── */}
        <div style={{ padding: "24px 28px 16px" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: "-0.02em", marginBottom: 4 }}>
Adoption across the organization
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5, maxWidth: 560 }}>
            Columns are staff counts on the left axis. The line is adoption rate on the right axis,
            so a tall column under a low line is a large group that hasn't started.
          </div>

          {/* ── Tab pills ── */}
          <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
            {TABS.map(t => {
              const active = t.key === activeTab;
              return (
                <button key={t.key} onClick={() => setActiveTab(t.key as any)} style={{
                  padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: active ? 700 : 500,
                  background: active ? "rgba(107,165,57,0.15)" : "transparent",
                  border: `1px solid ${active ? GREEN : "rgba(255,255,255,0.15)"}`,
                  color: active ? GREEN_LT : MUTED,
                  cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
                  transition: "all 0.12s",
                }}>
                  {t.label}
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 99,
                    background: active ? "rgba(107,165,57,0.25)" : "rgba(255,255,255,0.08)",
                    color: active ? GREEN_LT : MUTED,
                  }}>{t.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Chart ── */}
        <div style={{ padding: "0 12px" }}>
          {/* axis labels */}
          <div style={{ display: "flex", justifyContent: "space-between", paddingLeft: 52, paddingRight: 28, marginBottom: -4 }}>
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: MUTED }}>STAFF</span>
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: MUTED }}>RATE</span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={tab.data} margin={{ top: 28, right: 30, bottom: 8, left: 0 }}
              barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="name" tick={TICK} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.1)" }} />
              <YAxis yAxisId="staff" orientation="left" tick={TICK} tickLine={false} axisLine={false}
                domain={[0, Math.ceil(maxEnabled * 1.18 / 50) * 50]}
                tickFormatter={v => v === 0 ? "0" : v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} width={40} />
              <YAxis yAxisId="rate" orientation="right" tick={TICK} tickLine={false} axisLine={false}
                domain={[0, 100]} tickFormatter={v => `${v}%`} width={34} />
              <Tooltip
                contentStyle={TIP_STYLE}
                formatter={(value: number, name: string) =>
                  name === "rate" ? [`${value}%`, "Adoption rate"] :
                  name === "active" ? [value.toLocaleString(), "Active staff"] :
                  [value.toLocaleString(), "Enabled staff"]
                }
              />

              {/* Enabled staff bars (dark steel) */}
              <Bar yAxisId="staff" dataKey="enabled" barSize={22} radius={[4,4,0,0]}>
                {tab.data.map((_, i) => <Cell key={i} fill={STEEL} />)}
                <LabelList content={<EnabledLabel />} />
              </Bar>

              {/* Active staff bars (green) */}
              <Bar yAxisId="staff" dataKey="active" barSize={22} radius={[4,4,0,0]}>
                {tab.data.map((_, i) => <Cell key={i} fill={GREEN} />)}
              </Bar>

              {/* Adoption rate line (lime, glowing) */}
              <Line yAxisId="rate" type="monotone" dataKey="rate"
                stroke={LIME} strokeWidth={2.5}
                dot={<GlowDot />} activeDot={{ r: 6, fill: LIME }}
                style={{ filter: `drop-shadow(0 0 5px ${LIME}66)` }}>
                <LabelList content={<RateLabel />} />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* ── Legend ── */}
        <div style={{ padding: "4px 28px 12px", display: "flex", alignItems: "center", gap: 20 }}>
          {[
            { color: STEEL,    label: "Enabled staff",  solid: true  },
            { color: GREEN,    label: "Active staff",   solid: true  },
            { color: LIME,     label: "Adoption rate",  solid: false },
          ].map(({ color, label, solid }) => (
            <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11, color: MUTED }}>
              {solid ? (
                <span style={{ width: 12, height: 12, borderRadius: 3, background: color, display: "inline-block" }} />
              ) : (
                <span style={{ position: "relative", width: 16, height: 16, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ position: "absolute", width: 16, height: 2, background: color, borderRadius: 1 }} />
                  <span style={{ width: 10, height: 10, borderRadius: "50%", border: `2px solid ${color}`, background: BG, zIndex: 1 }} />
                </span>
              )}
              {label}
            </span>
          ))}
        </div>

        {/* ── Footer ── */}
        <div style={{
          borderTop: `1px solid rgba(255,255,255,0.07)`,
          padding: "14px 28px",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{ flex: 1, fontSize: 11, color: MUTED }}>
            {zeroed > 0
              ? `${zeroed} of ${tab.count} ${tab.label.toLowerCase()}s have no enabled staff and are not charted`
              : `All ${tab.count} ${tab.label.toLowerCase()}s are charted`}
          </span>
          {["Export PDF", "Export Excel"].map(lbl => (
            <button key={lbl} style={{
              padding: "7px 16px", borderRadius: 8, fontSize: 11, fontWeight: 600,
              background: "rgba(107,165,57,0.10)", border: `1px solid ${BORDER}`,
              color: GREEN_LT, cursor: "pointer",
            }}>{lbl}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
