import { compactUsd } from "../lib/money";
import React, { useId, useMemo, useState } from "react";
import { fmtPct } from "@/lib/utils";
import { PieChart, BarChart3, Target, MapPin, TrendingUp, Info, AlertTriangle } from "lucide-react";

const TEXT       = "var(--rm-text)";
const TEXT_MUTED = "var(--rm-text-muted)";
const TEXT_FAINT = "var(--rm-text-faint)";
const SUBTLE_BG  = "rgba(128,128,128,0.07)";
const SUBTLE_BD  = "rgba(128,128,128,0.12)";

const sanitizeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

export const GLOW_COLORS = {
  green: { from: "#6BA539", to: "#A9C23F", dim: "#6BA53920", glow: "#6BA53960" },
  orange: { from: "#E87722", to: "#FF9425", dim: "#E8772220", glow: "#E8772260" },
  blue: { from: "#6B7FF0", to: "#8BA4FF", dim: "#6B7FF020", glow: "#6B7FF060" },
  red: { from: "#E03C3C", to: "#FF6B6B", dim: "#E03C3C20", glow: "#E03C3C60" },
  purple: { from: "#9B6BF0", to: "#B68AFF", dim: "#9B6BF020", glow: "#9B6BF060" },
  yellow: { from: "#F5B731", to: "#FFD666", dim: "#F5B73120", glow: "#F5B73160" },
};

function fmtM(v: number) {
  if (v >= 1e9) return compactUsd(v);
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}

export interface DashboardData {
  totalActiveVal: number;
  totalOpmVal: number;
  totalLemVal: number;
  activeCount: number;
  opmCount: number;
  lemCount: number;
  topSectors: [string, { won: number; lost: number; activeCount: number; activeVal: number }][];
  topCities: [string, { count: number; val: number }][];
  maxCityVal: number;
  topOpmStatuses: [string, number][];
  maxOpmCount: number;
  valueRanges: { label: string; min: number; max: number; count: number }[];
  maxValCount: number;
  pivotLabel: string;
  pivotVal: [string, { count: number; val: number }][];
  totalPivotVal: number;
}

function GlassCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        backgroundColor: "var(--rm-panel)",
        borderRadius: 20,
        padding: 18,
        border: "1px solid var(--rm-panel-border)",
        boxShadow: "0 8px 16px rgba(0,0,0,0.3)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({ icon: Icon, color, title }: { icon: React.ComponentType<{ size?: number; color?: string }>; color: string; title: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          backgroundColor: color + "18",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `1px solid ${color}30`,
        }}
      >
        <Icon size={15} color={color} />
      </div>
      <div style={{ fontWeight: 700, fontSize: 15, color: TEXT }}>{title}</div>
    </div>
  );
}

function KPICard({
  label,
  value,
  count,
  gradient,
}: {
  label: string;
  value: string;
  count: string;
  gradient: { from: string; to: string };
}) {
  const id = `kpi-${label.replace(/\s+/g, "-")}`;
  return (
    <div style={{ flex: 1 }}>
      <div
        style={{
          borderRadius: 16,
          overflow: "hidden",
          border: `1px solid ${gradient.from}25`,
          position: "relative",
        }}
      >
        <svg width="100%" height="100" style={{ position: "absolute", inset: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={gradient.from} stopOpacity="0.15" />
              <stop offset="1" stopColor={gradient.to} stopOpacity="0.03" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="100%" height="100" fill={`url(#${id})`} />
        </svg>
        <div style={{ padding: 14, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 9,
              color: gradient.from,
              letterSpacing: 1,
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            {label}
          </div>
          <div style={{ fontWeight: 700, fontSize: 26, color: TEXT, lineHeight: 1 }}>{value}</div>
          <div style={{ fontWeight: 400, fontSize: 11, color: TEXT_FAINT, marginTop: 4 }}>
            {count}
          </div>
        </div>
      </div>
    </div>
  );
}

function DonutChart3D({
  segments,
  size = 160,
  strokeWidth = 18,
  centerLabel,
  centerValue,
  selectedIndex,
  onSelect,
}: {
  segments: { value: number; color: string; label: string }[];
  size?: number;
  strokeWidth?: number;
  centerLabel: string;
  centerValue: string;
  selectedIndex?: number | null;
  onSelect?: (i: number | null) => void;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  let accumulated = 0;
  const uid = sanitizeId(useId());

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative", width: size, height: size }}>
      <svg width={size} height={size}>
        <defs>
          {segments.map((seg, i) => (
            <linearGradient key={i} id={`donut-g-${uid}-${i}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={seg.color} stopOpacity="1" />
              <stop offset="1" stopColor={seg.color} stopOpacity="0.6" />
            </linearGradient>
          ))}
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={SUBTLE_BG}
          strokeWidth={strokeWidth}
        />
        {segments.map((seg, i) => {
          const pct = seg.value / total;
          const dash = pct * circumference;
          const gap = circumference - dash;
          const offset = -accumulated * circumference + circumference * 0.25;
          accumulated += pct;
          const isSelected = selectedIndex === i;
          return (
            <g key={i} style={{ cursor: onSelect ? "pointer" : "default" }} onClick={() => onSelect && onSelect(isSelected ? null : i)}>
              {isSelected && (
                <circle
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={strokeWidth + 8}
                  strokeDasharray={`${dash} ${gap}`}
                  strokeDashoffset={offset}
                  strokeLinecap="round"
                  opacity={0.25}
                />
              )}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={`url(#donut-g-${uid}-${i})`}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={offset}
                strokeLinecap="round"
                opacity={selectedIndex != null && !isSelected ? 0.3 : 1}
              />
            </g>
          );
        })}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius - strokeWidth / 2 - 2}
          fill="none"
          stroke={SUBTLE_BD}
          strokeWidth={1}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          textAlign: "center",
        }}
      >
        {selectedIndex != null && selectedIndex < segments.length ? (
          <>
            <div style={{ fontWeight: 700, fontSize: 16, color: segments[selectedIndex].color }}>
              {Math.round((segments[selectedIndex].value / total) * 100)}%
            </div>
            <div
              style={{
                fontWeight: 600,
                fontSize: 10,
                color: TEXT_MUTED,
                marginTop: 2,
                maxWidth: size * 0.6,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {segments[selectedIndex].label}
            </div>
            <div style={{ fontWeight: 400, fontSize: 10, color: TEXT_FAINT, marginTop: 1 }}>
              {fmtM(segments[selectedIndex].value)}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontWeight: 700, fontSize: 22, color: TEXT }}>{centerValue}</div>
            <div style={{ fontWeight: 400, fontSize: 10, color: TEXT_FAINT, marginTop: 2 }}>
              {centerLabel}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Bar3D({
  height,
  maxHeight,
  width,
  colorFrom,
  colorTo,
  label,
  value,
  index,
  selected,
  empty,
  onClick,
}: {
  height: number;
  maxHeight: number;
  width: number;
  colorFrom: string;
  colorTo: string;
  label: string;
  value: string;
  index: number;
  selected?: boolean;
  empty?: boolean;
  onClick?: () => void;
}) {
  const barH = Math.max(height, 6);
  const depth = 10;
  const svgH = maxHeight + depth + 24;

  const x0 = 2;
  const y0 = svgH - barH - 2;
  const bw = width - depth - 4;
  const uid = sanitizeId(useId());

  const frontPath = `M${x0},${y0} L${x0},${svgH - 2} L${x0 + bw},${svgH - 2} L${x0 + bw},${y0} Z`;
  const topPath = `M${x0},${y0} L${x0 + depth},${y0 - depth} L${x0 + bw + depth},${y0 - depth} L${x0 + bw},${y0} Z`;
  const sidePath = `M${x0 + bw},${y0} L${x0 + bw + depth},${y0 - depth} L${x0 + bw + depth},${svgH - 2 - depth} L${x0 + bw},${svgH - 2} Z`;

  const ghostY = svgH - 6;
  const ghostPath = `M${x0},${ghostY} L${x0},${svgH - 2} L${x0 + bw},${svgH - 2} L${x0 + bw},${ghostY} Z`;

  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: empty ? "default" : "pointer",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: 18,
          color: empty ? TEXT_FAINT : selected ? TEXT : colorFrom,
          marginBottom: 4,
          textAlign: "center",
        }}
      >
        {value}
      </div>
      <svg width={width} height={svgH}>
        {empty ? (
          <>
            <path d={ghostPath} fill={SUBTLE_BG} />
            <path
              d={`M${x0},${ghostY} L${x0 + depth},${ghostY - depth} L${x0 + bw + depth},${ghostY - depth} L${x0 + bw},${ghostY} Z`}
              fill={SUBTLE_BG}
            />
            <path d={ghostPath} fill="none" stroke={SUBTLE_BD} strokeWidth={1} strokeDasharray="3 2" />
          </>
        ) : (
          <>
            <defs>
              <linearGradient id={`bar3d-f-${uid}-${index}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={colorFrom} stopOpacity="1" />
                <stop offset="1" stopColor={colorTo} stopOpacity={selected ? "0.9" : "0.7"} />
              </linearGradient>
              <linearGradient id={`bar3d-t-${uid}-${index}`} x1="0" y1="1" x2="1" y2="0">
                <stop offset="0" stopColor={colorFrom} stopOpacity="0.9" />
                <stop offset="1" stopColor={colorTo} stopOpacity="1" />
              </linearGradient>
              <linearGradient id={`bar3d-s-${uid}-${index}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor={colorFrom} stopOpacity="0.5" />
                <stop offset="1" stopColor={colorTo} stopOpacity="0.3" />
              </linearGradient>
            </defs>
            <path d={frontPath} fill={`url(#bar3d-f-${uid}-${index})`} opacity={selected ? 1 : 0.85} />
            <path d={topPath} fill={`url(#bar3d-t-${uid}-${index})`} opacity={selected ? 1 : 0.85} />
            <path d={sidePath} fill={`url(#bar3d-s-${uid}-${index})`} opacity={selected ? 1 : 0.85} />
            {selected && (
              <rect x={x0 - 1} y={y0 - 1} width={bw + 2} height={barH + 3} rx={2} fill="none" stroke={colorFrom} strokeWidth={1.5} opacity={0.6} />
            )}
          </>
        )}
      </svg>
      <div style={{ fontWeight: 400, fontSize: 11, color: empty ? TEXT_FAINT : selected ? TEXT : TEXT_FAINT, marginTop: 4, textAlign: "center" }}>
        {label}
      </div>
    </button>
  );
}

function GlowBar({ pct, color, height = 10 }: { pct: number; color: string; height?: number }) {
  return (
    <div
      style={{
        height,
        borderRadius: height / 2,
        backgroundColor: SUBTLE_BG,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.max(pct, 2)}%`,
          height: "100%",
          borderRadius: height / 2,
          backgroundColor: color,
          boxShadow: `0 0 6px ${color}99`,
        }}
      />
    </div>
  );
}

function WinLossBar3D({ wonPct, width, index }: { wonPct: number; width: number; index: number }) {
  const h = 14;
  const d = 4;
  const svgW = width;
  const svgH = h + d + 2;
  const wonW = (wonPct / 100) * (svgW - d);
  const lostW = svgW - d - wonW;

  return (
    <svg width={svgW} height={svgH}>
      <defs>
        <linearGradient id={`wl-won-${index}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={GLOW_COLORS.green.from} stopOpacity="1" />
          <stop offset="1" stopColor={GLOW_COLORS.green.to} stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id={`wl-lost-${index}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={GLOW_COLORS.red.from} stopOpacity="0.4" />
          <stop offset="1" stopColor={GLOW_COLORS.red.to} stopOpacity="0.25" />
        </linearGradient>
      </defs>
      {wonW > 0 && (
        <>
          <rect x="0" y={d} width={wonW} height={h} rx={4} fill={`url(#wl-won-${index})`} />
          <path
            d={`M0,${d} L${d},0 L${Math.min(wonW + d, svgW)},0 L${wonW},${d} Z`}
            fill={GLOW_COLORS.green.to}
            opacity={0.7}
          />
        </>
      )}
      {lostW > 0 && (
        <rect x={wonW} y={d} width={lostW} height={h} rx={wonW > 0 ? 0 : 4} fill={`url(#wl-lost-${index})`} />
      )}
    </svg>
  );
}

function MarketBar3D({ pct, color, index, width }: { pct: number; color: string; index: number; width: number }) {
  const h = 10;
  const d = 4;
  const svgH = h + d + 2;
  const barW = Math.max((pct / 100) * (width - d), 4);

  return (
    <svg width={width} height={svgH}>
      <defs>
        <linearGradient id={`mkt-${index}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={color} stopOpacity="1" />
          <stop offset="1" stopColor={color} stopOpacity="0.5" />
        </linearGradient>
      </defs>
      <rect x="0" y={d} width={barW} height={h} rx={3} fill={`url(#mkt-${index})`} />
      <path d={`M0,${d} L${d},0 L${barW + d},0 L${barW},${d} Z`} fill={color} opacity={0.5} />
      <path d={`M${barW},${d} L${barW + d},0 L${barW + d},${h} L${barW},${h + d} Z`} fill={color} opacity={0.3} />
    </svg>
  );
}

const BAR_COLORS = [
  GLOW_COLORS.green.from,
  GLOW_COLORS.orange.from,
  GLOW_COLORS.blue.from,
  GLOW_COLORS.yellow.from,
  GLOW_COLORS.purple.from,
  GLOW_COLORS.red.from,
  "#C97040",
  "#8899AA",
];

export default function AnalyticsDashboard({ data }: { data: DashboardData }) {
  const {
    totalActiveVal,
    totalOpmVal,
    totalLemVal,
    activeCount: dActiveCount,
    opmCount,
    lemCount,
    topSectors,
    topCities,
    maxCityVal,
    topOpmStatuses,
    maxOpmCount,
    valueRanges,
    maxValCount,
    pivotLabel,
    pivotVal,
    totalPivotVal,
  } = data;

  const [selectedDonutSector, setSelectedDonutSector] = useState<number | null>(null);
  const [selectedBar, setSelectedBar] = useState<number | null>(null);
  const [selectedWinSector, setSelectedWinSector] = useState<number | null>(null);
  const [selectedCity, setSelectedCity] = useState<number | null>(null);
  const [selectedOpmDonut, setSelectedOpmDonut] = useState<number | null>(null);

  const hasRealWinLossSectors = topSectors.some((s) => {
    const d = s[1];
    return d.won + d.lost > 0 && s[0].toLowerCase() !== "other";
  });
  const hasRealCities = topCities.some(([c]) => c && c !== "Unknown" && c.toLowerCase() !== "unknown");

  const chartW = 320;
  const concentrationRisk =
    pivotVal.length > 1 && Math.round((pivotVal[0][1].val / totalPivotVal) * 100) >= 40;

  const opmDonutSegments = useMemo(
    () =>
      topOpmStatuses.map(([status, count]) => {
        const statusColor =
          status === "Awarded"
            ? GLOW_COLORS.green.from
            : status === "Lost"
            ? GLOW_COLORS.red.from
            : status === "In Progress"
            ? GLOW_COLORS.orange.from
            : status === "Cancelled"
            ? "#8899AA"
            : status === "Declined"
            ? "#C97040"
            : GLOW_COLORS.blue.from;
        return { value: count, color: statusColor, label: status };
      }),
    [topOpmStatuses],
  );
  const opmTotal = topOpmStatuses.reduce((s, [, c]) => s + c, 0);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        position: "relative",
        background: "var(--rm-bg)",
        padding: 16,
        borderRadius: 24,
      }}
    >
      {/* KPI ROW */}
      <div style={{ display: "flex", flexDirection: "row", gap: 12 }}>
        <KPICard label="Open PMM" value={fmtM(totalActiveVal)} count={`${dActiveCount} projects`} gradient={GLOW_COLORS.green} />
        <KPICard label="OPM Pipeline" value={fmtM(totalOpmVal)} count={`${opmCount} opps`} gradient={GLOW_COLORS.orange} />
        <KPICard label="LEM Leads" value={fmtM(totalLemVal)} count={`${lemCount} leads`} gradient={GLOW_COLORS.blue} />
      </div>

      {/* Concentration */}
      <GlassCard>
        <CardHeader icon={PieChart} color={GLOW_COLORS.green.from} title={`${pivotLabel} Concentration`} />
        {pivotVal.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              padding: 8,
              backgroundColor: SUBTLE_BG,
              borderRadius: 10,
              border: `1px solid ${SUBTLE_BD}`,
            }}
          >
            <Info size={12} color={TEXT_FAINT} />
            <div style={{ fontSize: 11, color: TEXT_MUTED, flex: 1 }}>
              No grouping fields filled on active projects yet.
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
              <DonutChart3D
                size={160}
                strokeWidth={22}
                centerValue={fmtM(totalActiveVal)}
                centerLabel="Open Value"
                selectedIndex={selectedDonutSector}
                onSelect={setSelectedDonutSector}
                segments={pivotVal.slice(0, 6).map(([label, d], i) => ({
                  value: d.val,
                  color: BAR_COLORS[i % BAR_COLORS.length],
                  label,
                }))}
              />
              <div style={{ flex: 1, marginLeft: 16, display: "flex", flexDirection: "column", gap: 6 }}>
                {pivotVal.slice(0, 6).map(([name, d], i) => {
                  const pct = Math.round((d.val / totalPivotVal) * 100);
                  const isSelected = selectedDonutSector === i;
                  return (
                    <button
                      key={name}
                      onClick={() => setSelectedDonutSector(isSelected ? null : i)}
                      style={{
                        background: isSelected ? BAR_COLORS[i % BAR_COLORS.length] + "20" : "transparent",
                        border: "none",
                        padding: "4px 6px",
                        borderRadius: 6,
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        textAlign: "left",
                        width: "100%",
                      }}
                    >
                      <div
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: 5,
                          backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                          flexShrink: 0,
                        }}
                      />
                      <div
                        style={{
                          fontWeight: isSelected ? 600 : 400,
                          fontSize: 11,
                          lineHeight: "16px",
                          color: isSelected ? TEXT : TEXT_MUTED,
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {name}
                        <span
                          style={{
                            marginLeft: 6,
                            fontWeight: 700,
                            fontSize: 11,
                            color: isSelected ? BAR_COLORS[i % BAR_COLORS.length] : TEXT,
                          }}
                        >
                          {fmtPct(pct)}
                        </span>
                        {isSelected && (
                          <span style={{ marginLeft: 5, fontSize: 10, color: TEXT_FAINT, fontWeight: 400 }}>
                            · {fmtM(d.val)} · {d.count}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            {concentrationRisk && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 12,
                  padding: 8,
                  backgroundColor: GLOW_COLORS.orange.dim,
                  borderRadius: 10,
                  border: `1px solid ${GLOW_COLORS.orange.from}25`,
                }}
              >
                <AlertTriangle size={12} color={GLOW_COLORS.orange.from} />
                <div style={{ fontWeight: 600, fontSize: 11, color: GLOW_COLORS.orange.from, flex: 1 }}>
                  Concentration risk: {pivotVal[0][0]} is{" "}
                  {Math.round((pivotVal[0][1].val / totalPivotVal) * 100)}% of open value
                </div>
              </div>
            )}
            <div style={{ fontSize: 10, color: TEXT_FAINT, marginTop: 8, textAlign: "center" }}>
              Grouped by {pivotLabel.toLowerCase()} · {pivotVal.length} bucket
              {pivotVal.length === 1 ? "" : "s"}
            </div>
          </>
        )}
      </GlassCard>

      {/* Value Distribution */}
      <GlassCard>
        <CardHeader icon={BarChart3} color={GLOW_COLORS.orange.from} title="Value Distribution (PMM)" />
        <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: -4, marginBottom: 10, paddingLeft: 6 }}>
          Number of projects by deal size
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${valueRanges.length}, minmax(0, 1fr))`,
            alignItems: "end",
            gap: 8,
            paddingLeft: 4,
            paddingRight: 4,
          }}
        >
          {valueRanges.map((r, i) => {
            const barH = r.count > 0 ? Math.max((r.count / maxValCount) * 100, 14) : 4;
            const colors = [GLOW_COLORS.orange, GLOW_COLORS.yellow, GLOW_COLORS.green, GLOW_COLORS.blue, GLOW_COLORS.purple];
            const c = colors[i % colors.length];
            return (
              <Bar3D
                key={r.label}
                height={barH}
                maxHeight={100}
                width={70}
                colorFrom={c.from}
                colorTo={c.to}
                label={r.label}
                value={String(r.count)}
                index={i}
                selected={selectedBar === i}
                empty={r.count === 0}
                onClick={r.count === 0 ? undefined : () => setSelectedBar(selectedBar === i ? null : i)}
              />
            );
          })}
        </div>
      </GlassCard>

      {/* Win Rate by Sector (only when real data) */}
      {hasRealWinLossSectors && (
        <GlassCard>
          <CardHeader icon={Target} color={GLOW_COLORS.green.from} title="Win Rate by Sector" />
          {topSectors.map(([sector, d], i) => {
            const total = d.won + d.lost;
            const rate = total > 0 ? Math.round((d.won / total) * 100) : 0;
            const isSelected = selectedWinSector === i;
            return (
              <button
                key={sector}
                onClick={() => setSelectedWinSector(isSelected ? null : i)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  marginBottom: 12,
                  padding: "4px 6px",
                  borderRadius: 8,
                  background: isSelected ? "rgba(107,165,57,0.12)" : "transparent",
                  border: isSelected ? `1px solid ${GLOW_COLORS.green.from}30` : "1px solid transparent",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                  <div
                    style={{
                      fontWeight: isSelected ? 600 : 400,
                      fontSize: 12,
                      color: isSelected ? TEXT : TEXT_MUTED,
                      flex: 1,
                      marginRight: 8,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {sector.length > 36 ? sector.slice(0, 36) + "…" : sector}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 12, color: TEXT }}>
                    {total > 0 ? `${rate}% (${d.won}W/${d.lost}L)` : `${d.activeCount} active`}
                  </div>
                </div>
                {total > 0 ? (
                  <WinLossBar3D wonPct={rate} width={chartW} index={i} />
                ) : (
                  <GlowBar pct={Math.min((d.activeCount / 20) * 100, 100)} color={GLOW_COLORS.green.from + "60"} />
                )}
              </button>
            );
          })}
        </GlassCard>
      )}

      {/* Top Markets */}
      {hasRealCities && (
        <GlassCard>
          <CardHeader icon={MapPin} color={GLOW_COLORS.blue.from} title="Top Markets (Active Value)" />
          {topCities
            .filter(([c]) => c && c !== "Unknown" && c.toLowerCase() !== "unknown")
            .map(([city, d], i) => {
              const pct = (d.val / maxCityVal) * 100;
              const isSelected = selectedCity === i;
              return (
                <button
                  key={city}
                  onClick={() => setSelectedCity(isSelected ? null : i)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    marginBottom: 10,
                    padding: "4px 6px",
                    borderRadius: 8,
                    background: isSelected ? "rgba(107,127,240,0.12)" : "transparent",
                    border: isSelected ? `1px solid ${GLOW_COLORS.blue.from}30` : "1px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                    <div
                      style={{
                        fontWeight: isSelected ? 600 : 400,
                        fontSize: 12,
                        color: isSelected ? TEXT : TEXT_MUTED,
                        flex: 1,
                        marginRight: 8,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {city.length > 30 ? city.slice(0, 30) + "…" : city}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 12, color: TEXT }}>
                      {fmtM(d.val)} · {d.count} proj
                    </div>
                  </div>
                  <MarketBar3D pct={pct} color={GLOW_COLORS.blue.from} index={i} width={chartW} />
                </button>
              );
            })}
        </GlassCard>
      )}

      {/* OPM Pipeline by Status */}
      {topOpmStatuses.length > 0 && (
        <GlassCard>
          <CardHeader icon={TrendingUp} color={GLOW_COLORS.orange.from} title="OPM Pipeline by Status" />
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
            <DonutChart3D
              size={140}
              strokeWidth={18}
              centerValue={String(opmTotal)}
              centerLabel="Total Opps"
              selectedIndex={selectedOpmDonut}
              onSelect={setSelectedOpmDonut}
              segments={opmDonutSegments}
            />
            <div style={{ flex: 1, marginLeft: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              {topOpmStatuses.map(([status, count], i) => {
                const statusColor = opmDonutSegments[i].color;
                const pct = Math.round((count / maxOpmCount) * 100);
                const isSelected = selectedOpmDonut === i;
                return (
                  <button
                    key={status}
                    onClick={() => setSelectedOpmDonut(isSelected ? null : i)}
                    style={{
                      background: isSelected ? statusColor + "20" : "transparent",
                      border: "none",
                      padding: "3px 6px",
                      borderRadius: 6,
                      cursor: "pointer",
                      width: "100%",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }} />
                        <div
                          style={{
                            fontWeight: isSelected ? 600 : 400,
                            fontSize: 11,
                            color: isSelected ? TEXT : TEXT_MUTED,
                          }}
                        >
                          {status || "Other"}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 11, color: isSelected ? statusColor : TEXT }}>
                        {count}
                        {isSelected && opmTotal > 0 && ` (${Math.round((count / opmTotal) * 100)}%)`}
                      </div>
                    </div>
                    <GlowBar pct={pct} color={statusColor} height={6} />
                  </button>
                );
              })}
            </div>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
