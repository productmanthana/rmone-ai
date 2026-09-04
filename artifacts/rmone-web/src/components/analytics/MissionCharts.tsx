/* ─────────────────────────────────────────────────────────────
 * MissionCharts — hardened recharts wrappers for the Analytics
 * Center pages (Mission Control style). Built so labels can
 * NEVER overlap or collide:
 *   - X ticks: minTickGap + preserveStartEnd, no rotation
 *   - legends live OUTSIDE the plot area (caption row)
 *   - tooltips float above everything (high zIndex wrapper)
 *   - minimum heights keep bars/areas readable
 * The hub itself draws no recharts (style rule: no charts on the
 * hub) — these are for the section pages built on top of it.
 * ──────────────────────────────────────────────────────────── */
import React from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, LabelList,
  PieChart, Pie,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { MC, MC_LIGHT, useMC } from "@/components/analytics/MissionKit";
import { useTheme } from "@/lib/theme";

const TOOLTIP_WRAPPER: React.CSSProperties = { zIndex: 5000, outline: "none" };

/** Caption row rendered OUTSIDE the plot — use instead of an in-plot legend. */
export function ChartCaption({ items }: { items: { label: string; color: string }[] }) {
  const mc = useMC();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 6, fontSize: 10, color: mc.faint }}>
      {items.map((i) => (
        <span key={i.label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: i.color, display: "inline-block" }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Glowing gradient area chart (trend over a REAL series). */
export function MissionArea({ data, xKey, yKey, color = MC.greenBright, height = 220, yFmt, onPointClick }: {
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  color?: string;
  height?: number;
  yFmt?: (v: number) => string;
  onPointClick?: (row: Record<string, unknown>) => void;
}) {
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const tickFill = isDark ? "rgba(255,255,255,0.5)" : "rgba(15,25,35,0.5)";
  const gridStroke = isDark ? "rgba(255,255,255,0.06)" : "rgba(15,25,35,0.07)";
  const axisStroke = isDark ? "rgba(255,255,255,0.12)" : "rgba(15,25,35,0.15)";
  const cursorStroke = isDark ? "rgba(255,255,255,0.2)" : "rgba(15,25,35,0.15)";
  const TICK = { fontSize: 10, fill: tickFill } as const;
  const TOOLTIP_CONTENT: React.CSSProperties = isDark
    ? { background: "#1C2B38", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 10, fontSize: 11, color: "#fff", boxShadow: "0 12px 30px rgba(0,0,0,0.45)" }
    : { background: "#ffffff", border: "1px solid rgba(15,25,35,0.12)", borderRadius: 10, fontSize: 11, color: "#1a2e12", boxShadow: "0 8px 24px rgba(15,25,35,0.12)" };

  const gid = `ma-${yKey}-${color.replace(/\W/g, "")}`;
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, height)}>
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
        onClick={(s: any, evt?: any) => {
          if (onPointClick && s?.activePayload?.[0]?.payload) {
            // Handled here — don't let the click bubble to a clickable card
            // wrapper, which would overwrite the drill with the full card.
            evt?.stopPropagation?.();
            onPointClick(s.activePayload[0].payload);
          }
        }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={gridStroke} vertical={false} />
        <XAxis dataKey={xKey} tick={TICK} tickLine={false} axisLine={{ stroke: axisStroke }}
          minTickGap={28} interval="preserveStartEnd" />
        <YAxis tick={TICK} tickLine={false} axisLine={false} width={48}
          tickFormatter={(v: number) => (yFmt ? yFmt(v) : String(v))} />
        <Tooltip wrapperStyle={TOOLTIP_WRAPPER} contentStyle={TOOLTIP_CONTENT}
          formatter={(v: any) => (yFmt ? yFmt(Number(v)) : v)} cursor={{ stroke: cursorStroke }} />
        <Area type="monotone" dataKey={yKey} stroke={color} strokeWidth={2}
          fill={`url(#${gid})`} style={{ filter: `drop-shadow(0 0 6px ${color}88)` }}
          activeDot={{ r: 4, style: { cursor: onPointClick ? "pointer" : "default" } }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Rounded column chart; bars clickable when onBarClick is given. */
export function MissionColumns({ data, xKey, yKey, color = MC.navy, colors, height = 220, yFmt, onBarClick }: {
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  color?: string;
  /** optional per-bar colors (index-aligned with data) */
  colors?: string[];
  height?: number;
  yFmt?: (v: number) => string;
  onBarClick?: (row: Record<string, unknown>) => void;
}) {
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const tickFill = isDark ? "rgba(255,255,255,0.5)" : "rgba(15,25,35,0.5)";
  const gridStroke = isDark ? "rgba(255,255,255,0.06)" : "rgba(15,25,35,0.07)";
  const axisStroke = isDark ? "rgba(255,255,255,0.12)" : "rgba(15,25,35,0.15)";
  const TICK = { fontSize: 10, fill: tickFill } as const;
  const TOOLTIP_CONTENT: React.CSSProperties = isDark
    ? { background: "#1C2B38", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 10, fontSize: 11, color: "#fff", boxShadow: "0 12px 30px rgba(0,0,0,0.45)" }
    : { background: "#ffffff", border: "1px solid rgba(15,25,35,0.12)", borderRadius: 10, fontSize: 11, color: "#1a2e12", boxShadow: "0 8px 24px rgba(15,25,35,0.12)" };

  return (
    <ResponsiveContainer width="100%" height={Math.max(160, height)}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
        style={{ cursor: onBarClick ? "pointer" : "default" }}
        onClick={(e: any, evt?: any) => {
          if (onBarClick && e?.activePayload?.[0]?.payload) {
            // Bar clicks are fully handled here — stop the DOM event so it
            // never bubbles to a clickable CardShell, which would replace the
            // filtered drawer with the full unfiltered card.
            evt?.stopPropagation?.();
            const row = e.activePayload[0].payload as Record<string, unknown>;
            if (Number(row[yKey] ?? 0) === 0) return; // no data behind an empty bar
            onBarClick(row);
          }
        }}
      >
        <CartesianGrid stroke={gridStroke} vertical={false} />
        <XAxis dataKey={xKey} tick={TICK} tickLine={false} axisLine={{ stroke: axisStroke }}
          minTickGap={16} interval="preserveStartEnd" />
        <YAxis tick={TICK} tickLine={false} axisLine={false} width={48}
          tickFormatter={(v: number) => (yFmt ? yFmt(v) : String(v))} />
        <Tooltip wrapperStyle={TOOLTIP_WRAPPER} contentStyle={TOOLTIP_CONTENT}
          formatter={(v: any) => (yFmt ? yFmt(Number(v)) : v)} cursor={{ fill: isDark ? "rgba(255,255,255,0.05)" : "rgba(15,25,35,0.05)" }} />
        <Bar dataKey={yKey} radius={[5, 5, 0, 0]} maxBarSize={44}>
          {data.map((_, i) => (
            <Cell key={i} fill={colors?.[i] ?? color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Multi-series line chart — one crisp line per series (tenant, cohort, etc).
 *  Uses a LEGEND ROW below the chart, never an in-plot legend. */
export function MissionMultiLine({ data, xKey, series, height = 220, yFmt }: {
  data: Record<string, unknown>[];
  xKey: string;
  series: { key: string; label: string; color: string }[];
  height?: number;
  yFmt?: (v: number) => string;
}) {
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const tickFill  = isDark ? "rgba(255,255,255,0.5)" : "rgba(15,25,35,0.5)";
  const gridStroke = isDark ? "rgba(255,255,255,0.06)" : "rgba(15,25,35,0.07)";
  const axisStroke = isDark ? "rgba(255,255,255,0.12)" : "rgba(15,25,35,0.15)";
  const cursorStroke = isDark ? "rgba(255,255,255,0.2)" : "rgba(15,25,35,0.15)";
  const TICK = { fontSize: 10, fill: tickFill } as const;
  const TOOLTIP_CONTENT: React.CSSProperties = isDark
    ? { background: "#1C2B38", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 10, fontSize: 11, color: "#fff", boxShadow: "0 12px 30px rgba(0,0,0,0.45)" }
    : { background: "#ffffff", border: "1px solid rgba(15,25,35,0.12)", borderRadius: 10, fontSize: 11, color: "#1a2e12", boxShadow: "0 8px 24px rgba(15,25,35,0.12)" };

  return (
    <ResponsiveContainer width="100%" height={Math.max(160, height)}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={gridStroke} vertical={false} />
        <XAxis dataKey={xKey} tick={TICK} tickLine={false} axisLine={{ stroke: axisStroke }}
          minTickGap={28} interval="preserveStartEnd" />
        <YAxis tick={TICK} tickLine={false} axisLine={false} width={48}
          tickFormatter={(v: number) => (yFmt ? yFmt(v) : String(v))} />
        <Tooltip wrapperStyle={TOOLTIP_WRAPPER} contentStyle={TOOLTIP_CONTENT}
          formatter={(v: any, name: any) => [yFmt ? yFmt(Number(v)) : v, name]}
          cursor={{ stroke: cursorStroke }} />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
            stroke={s.color} strokeWidth={2.5} dot={false} connectNulls
            activeDot={{ r: 4 }}
            style={{ filter: `drop-shadow(0 0 5px ${s.color}88)` }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Large radial arc gauge with a caption line (hero device for % pages). */
export function ArcGauge({ pct, size = 180, color = MC.greenBright, label, caption }: {
  pct: number; size?: number; color?: string; label: string; caption?: string;
}) {
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const mc = isDark ? MC : MC_LIGHT;

  const clamped = Math.max(0, Math.min(100, pct));
  const stroke = Math.max(8, size / 16);
  const r = size / 2 - stroke - 4;
  const cx = size / 2, cy = size / 2;
  const start = 135, sweep = 270;
  const a0 = (start * Math.PI) / 180;
  const a1 = ((start + sweep) * Math.PI) / 180;
  const av = ((start + (sweep * clamped) / 100) * Math.PI) / 180;
  const pt = (ang: number) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  const [sx, sy] = pt(a0); const [ex, ey] = pt(a1); const [tx, ty] = pt(av);
  const largeVal = (sweep * clamped) / 100 > 180 ? 1 : 0;

  const trackColor = isDark ? "rgba(255,255,255,0.09)" : "rgba(15,25,35,0.12)";
  const dotFill = isDark ? "#fff" : mc.greenInk;
  const labelFill = mc.text;
  const captionFill = mc.muted;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width={size} height={size} style={{ overflow: "visible" }}>
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`} fill="none" stroke={trackColor} strokeWidth={stroke} strokeLinecap="round" />
        {clamped > 0 && (
          <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${largeVal} 1 ${tx} ${ty}`} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 8px ${color}99)` }} />
        )}
        <circle cx={tx} cy={ty} r={stroke / 2 + 1} fill={dotFill} style={{ filter: isDark ? "drop-shadow(0 0 5px rgba(255,255,255,0.9))" : "none" }} />
        <text x={cx} y={cy + 2} textAnchor="middle" fill={labelFill} fontSize={size / 5.4} fontWeight={800}
          style={{ fontVariantNumeric: "tabular-nums" }}>{label}</text>
        {caption && (
          <text x={cx} y={cy + size / 5.4} textAnchor="middle" fill={captionFill} fontSize={Math.max(9, size / 16)}>
            {caption}
          </text>
        )}
      </svg>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * ExpandableBars — MissionHorizBars plus an inline expand toggle.
 * Collapsed it shows the top `initial` rows; the amber
 * "+ N more — click to see all" line expands the SAME chart in
 * place to every row (no popup). Used by every truncated ranked
 * list across the Analytics Center so the pattern is identical.
 * Safe inside a DrillZone: the toggle stops propagation.
 * ──────────────────────────────────────────────────────────── */
export function ExpandableBars({ rows, initial = 8, color = "#6B99BB", noun = "items", onBarClick }: {
  rows: { label: string; v: number; text?: string; filterValue?: string }[];
  /** Rows shown while collapsed (the current card design's top-N). */
  initial?: number;
  color?: string;
  /** Plural noun for the toggle line, e.g. "roles", "divisions". */
  noun?: string;
  /** Called with the clicked row's data. Zero-arg callbacks also accepted. */
  onBarClick?: (row: { label: string; v: number; text?: string; filterValue?: string }) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const hidden = rows.length - initial;
  const shown = expanded ? rows : rows.slice(0, initial);
  const toggle = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    setExpanded(x => !x);
  };
  return (
    <div>
      <MissionHorizBars
        rows={shown}
        color={color}
        maxRows={expanded ? Math.max(rows.length, 1) : initial}
        onBarClick={onBarClick}
      />
      {hidden > 0 && (
        <div
          role="button"
          tabIndex={0}
          onClick={toggle}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(e); } }}
          style={{
            marginTop: 8, display: "inline-flex", alignItems: "center", gap: 5,
            fontSize: 11.5, fontWeight: 700, color: "#F0A842",
            cursor: "pointer", userSelect: "none", padding: "4px 0",
          }}
        >
          {expanded
            ? `Show top ${Math.min(initial, rows.length)} only`
            : `+ ${hidden} more ${noun} — click to see all`}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * MissionHorizBars — gradient horizontal bar chart.
 * Replaces MiniBars in card contexts with a proper recharts chart.
 * Auto-sizes height from row count. Value labels sit to the right
 * of each bar end. Long labels are truncated with an ellipsis.
 * ──────────────────────────────────────────────────────────── */
export function MissionHorizBars({ rows, color = "#6B99BB", stretch = false, onBarClick, maxRows = 12 }: {
  rows: { label: string; v: number; text?: string; filterValue?: string }[];
  color?: string;
  /** When true the chart fills the parent flex-container height instead of using a fixed row-count height. */
  stretch?: boolean;
  /** Called with the clicked row's data. Zero-arg callbacks also accepted. */
  onBarClick?: (row: { label: string; v: number; text?: string; filterValue?: string }) => void;
  /** Hard cap on rendered rows (default 12). ExpandableBars raises this when expanded. */
  maxRows?: number;
}) {
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const tickFill = isDark ? "rgba(255,255,255,0.50)" : "rgba(15,25,35,0.55)";
  const gridStroke = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)";
  const TOOLTIP_CONTENT: React.CSSProperties = isDark
    ? { background: "#1C2B38", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 10, fontSize: 11, color: "#fff", boxShadow: "0 12px 30px rgba(0,0,0,0.45)" }
    : { background: "#ffffff", border: "1px solid rgba(15,25,35,0.12)", borderRadius: 10, fontSize: 11, color: "#1a2e12", boxShadow: "0 8px 24px rgba(15,25,35,0.12)" };

  const displayed = rows.slice(0, maxRows);
  if (displayed.length === 0) {
    return <div style={{ fontSize: 10.5, color: isDark ? "rgba(255,255,255,0.40)" : "rgba(15,25,35,0.40)", padding: "12px 0" }}>No data yet.</div>;
  }

  const maxChars = Math.max(...displayed.map(r => r.label.length), 4);
  const labelWidth = Math.max(60, Math.min(150, maxChars * 6.2));
  const height = Math.max(80, displayed.length * 34 + 16);
  const gradId = `mhbGrad${color.replace(/\W/g, "")}`;

  return (
    <div style={stretch ? { flex: 1, minHeight: height } : { height }}>
      <ResponsiveContainer width="100%" height={stretch ? "100%" : height}>
        <BarChart data={displayed} layout="vertical"
          margin={{ top: 4, right: 66, bottom: 4, left: 4 }} barCategoryGap="26%">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={1} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10, fill: tickFill }} tickLine={false} axisLine={false}
            tickFormatter={(v: number) =>
              displayed.some(r => r.v >= 10000)
                ? `${(v / 1000).toFixed(0)}k`
                : displayed.some(r => r.v >= 1000)
                ? `${(v / 1000).toFixed(1)}k`
                : String(Math.round(v))
            } />
          <YAxis dataKey="label" type="category" tick={{ fontSize: 10, fill: tickFill }}
            tickLine={false} axisLine={false} width={labelWidth}
            tickFormatter={(v: string) => v.length > 20 ? v.slice(0, 19) + "…" : v} />
          <Tooltip
            wrapperStyle={TOOLTIP_WRAPPER}
            contentStyle={TOOLTIP_CONTENT}
            labelStyle={{ color: isDark ? "#FFFFFF" : "#1a2e12", fontWeight: 700 }}
            itemStyle={{ color: isDark ? "#FFFFFF" : "#1a2e12" }}
            cursor={{ fill: isDark ? "rgba(255,255,255,0.07)" : "rgba(15,25,35,0.05)" }}
            formatter={(v: number, _: string, p: any) =>
              [p.payload?.text ?? v.toLocaleString("en-US"), ""]
            }
          />
          <Bar dataKey="v" fill={`url(#${gradId})`} radius={[0, 6, 6, 0]}
            maxBarSize={22} isAnimationActive={false}
            style={{ cursor: onBarClick ? "pointer" : "default" }}
            onClick={(...args: any[]) => {
              const entry = args[0];
              if (!onBarClick || !entry?.payload) return; // no handler — let the card's own click behavior apply
              // Recharts passes the DOM event as a trailing arg — stop it so a
              // handled bar click never bubbles to a clickable card wrapper,
              // which would overwrite the filtered drawer with the full card.
              for (const a of args) if (a && typeof a.stopPropagation === "function") { a.stopPropagation(); break; }
              onBarClick(entry.payload as { label: string; v: number; text?: string });
            }}>
            <LabelList content={(props: any) => {
              const row = displayed[props.index as number];
              const bx = Number(props.x) + Number(props.width) + 7;
              const by = Number(props.y) + Number(props.height) / 2 + 4;
              if (!row || isNaN(bx) || isNaN(by)) return null;
              const display = row.text ?? row.v.toLocaleString("en-US");
              return (
                <text x={bx} y={by} fontSize={10} fontWeight={700} fill={color}
                  style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
                  {display}
                </text>
              );
            }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * MissionDonut — PieChart donut with a side legend.
 * Replaces SegmentBar in card contexts. Shows the total in the
 * ring centre and exact counts in the legend. Zero-value segments
 * are excluded from the pie but shown as 0 in the legend.
 * When onSegmentClick is given every legend row and pie slice is
 * clickable — clicking drills to the population behind that
 * segment. The click stops propagation so a parent card wrapper
 * never hijacks the filtered drill.
 * ──────────────────────────────────────────────────────────── */
export function MissionDonut({ segments, total, centerLabel, onSegmentClick }: {
  segments: { label: string; v: number; color: string }[];
  total: number;
  centerLabel?: string;
  /** When provided, legend rows and pie slices become clickable drill targets. */
  onSegmentClick?: (seg: { label: string; v: number; color: string }) => void;
}) {
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const centerFill = isDark ? "#fff" : "rgba(15,25,35,0.90)";
  const legendFaint = isDark ? "rgba(255,255,255,0.58)" : "rgba(15,25,35,0.58)";
  const legendVal = isDark ? "#fff" : "rgba(15,25,35,0.90)";
  const emptyColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(15,25,35,0.08)";
  const hoverBg = isDark ? "rgba(255,255,255,0.07)" : "rgba(15,25,35,0.06)";

  const pieData = segments.filter(s => s.v > 0);
  const displayData = pieData.length > 0 ? pieData : [{ label: "—", v: 1, color: emptyColor }];
  const D = 120;

  const handlePieClick = (data: any, _index: number, e?: React.SyntheticEvent) => {
    if (!onSegmentClick || !data) return;
    const seg = segments.find(s => s.label === data.label);
    if (!seg || seg.v === 0) return;
    e?.stopPropagation?.();
    onSegmentClick(seg);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
      {/* ring */}
      <div style={{ position: "relative", width: D, height: D, flexShrink: 0 }}>
        <PieChart width={D} height={D}>
          <Pie data={displayData} cx={D / 2 - 4} cy={D / 2 - 4}
            innerRadius={30} outerRadius={50}
            startAngle={90} endAngle={-270} dataKey="v" stroke="none"
            isAnimationActive={false} paddingAngle={displayData.length > 1 ? 2 : 0}
            style={{ cursor: onSegmentClick ? "pointer" : "default" }}
            onClick={handlePieClick as any}>
            {displayData.map((s, i) => <Cell key={i} fill={s.color} />)}
          </Pie>
        </PieChart>
        <div style={{
          position: "absolute", top: "50%", left: "48%",
          transform: "translate(-50%,-50%)", textAlign: "center", pointerEvents: "none",
        }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: centerFill, lineHeight: 1 }}>
            {centerLabel ?? total.toLocaleString("en-US")}
          </div>
          {!centerLabel && (
            <div style={{ fontSize: 8, color: legendFaint, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              total
            </div>
          )}
        </div>
      </div>
      {/* legend */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minWidth: 130 }}>
        {segments.map(s => (
          <div
            key={s.label}
            role={onSegmentClick && s.v > 0 ? "button" : undefined}
            tabIndex={onSegmentClick && s.v > 0 ? 0 : undefined}
            title={onSegmentClick && s.v > 0 ? `See ${s.label} records` : undefined}
            onClick={onSegmentClick && s.v > 0 ? (e) => { e.stopPropagation(); onSegmentClick(s); } : undefined}
            onKeyDown={onSegmentClick && s.v > 0 ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onSegmentClick(s); } } : undefined}
            style={{
              display: "flex", alignItems: "center", gap: 9,
              padding: onSegmentClick && s.v > 0 ? "3px 6px" : undefined,
              margin: onSegmentClick && s.v > 0 ? "0 -6px" : undefined,
              borderRadius: onSegmentClick && s.v > 0 ? 7 : undefined,
              cursor: onSegmentClick && s.v > 0 ? "zoom-in" : "default",
            }}
            onMouseEnter={onSegmentClick && s.v > 0 ? (e) => { (e.currentTarget as HTMLDivElement).style.background = hoverBg; } : undefined}
            onMouseLeave={onSegmentClick && s.v > 0 ? (e) => { (e.currentTarget as HTMLDivElement).style.background = ""; } : undefined}
          >
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: legendFaint, flex: 1, lineHeight: 1.2 }}>{s.label}</span>
            <b style={{ fontSize: 15, fontVariantNumeric: "tabular-nums", color: legendVal }}>
              {s.v.toLocaleString("en-US")}
            </b>
          </div>
        ))}
      </div>
    </div>
  );
}
