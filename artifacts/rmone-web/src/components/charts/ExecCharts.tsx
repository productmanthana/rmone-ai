/* ─────────────────────────────────────────────────────────────
 * ExecCharts.tsx — flat, executive-grade chart kit shared by the
 * Reports and Analytics pages. Professional dashboard language:
 * generous whitespace, uppercase micro-labels, tabular numerals,
 * subtle borders, one brand accent. No emojis, no 3D effects.
 * ──────────────────────────────────────────────────────────── */
import React from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  ResponsiveContainer, Tooltip,
} from "recharts";

/* brand palette (literal hex — also used by chart fills) */
export const PALETTE = {
  green: "#6BA539",
  greenLight: "#A9C23F",
  blue: "#3B82F6",
  orange: "#F97316",
  amber: "#F59E0B",
  purple: "#A855F7",
  teal: "#14B8A6",
  rose: "#F43F5E",
  slate: "#94A3B8",
};
export const SERIES: string[] = [
  PALETTE.green, PALETTE.blue, PALETTE.amber, PALETTE.purple,
  PALETTE.teal, PALETTE.orange, PALETTE.greenLight, PALETTE.rose, PALETTE.slate,
];

const NUM_FONT: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

const clickable: React.CSSProperties = {
  cursor: "pointer",
  transition: "background-color 0.12s",
};

/* ── section card ── */
export function SectionCard({
  title, subtitle, right, children, minHeight,
}: {
  title: string; subtitle?: string; right?: React.ReactNode;
  children: React.ReactNode; minHeight?: number;
}) {
  return (
    <div style={{
      background: "var(--rm-panel)",
      border: "1px solid var(--rm-panel-border)",
      borderRadius: 16, padding: "18px 20px",
      display: "flex", flexDirection: "column", gap: 14,
      minHeight,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{
            fontSize: 12.5, fontWeight: 800, color: "var(--rm-text)",
            letterSpacing: "-0.01em",
          }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 11, color: "var(--rm-text-muted)", marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
        {right}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

/* ── KPI stat tile ── */
export function KpiStat({
  label, value, sub, accent, tone, onClick,
}: {
  label: string; value: string; sub?: string;
  accent?: string;
  tone?: "good" | "warn" | "bad" | null;
  onClick?: () => void;
}) {
  const toneColor = tone === "good" ? PALETTE.green : tone === "warn" ? PALETTE.amber : tone === "bad" ? PALETTE.orange : null;
  return (
    <div
      onClick={onClick}
      title={onClick ? `See ${label} breakdown` : undefined}
      style={{
        background: "var(--rm-panel)",
        border: "1px solid var(--rm-panel-border)",
        borderRadius: 14, padding: "14px 16px",
        display: "flex", flexDirection: "column", gap: 5,
        position: "relative", overflow: "hidden", minWidth: 0,
        ...(onClick ? clickable : {}),
      }}
      onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--rm-panel-hover)"; }}
      onMouseLeave={e => { if (onClick) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--rm-panel)"; }}
    >
      {accent && (
        <span style={{ position: "absolute", left: 0, top: 10, bottom: 10, width: 3, borderRadius: 2, background: accent }} />
      )}
      <div style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "var(--rm-text-faint)",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        /* reserve room for the absolutely-positioned "DETAILS →" badge so
           long labels ellipsize instead of running underneath it */
        paddingRight: onClick ? 54 : 0,
      }}>{label}</div>
      <div style={{
        fontSize: 24, fontWeight: 850, lineHeight: 1,
        color: toneColor ?? "var(--rm-text)", letterSpacing: "-0.02em", ...NUM_FONT,
      }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 10.5, color: "var(--rm-text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
      )}
      {onClick && (
        <div style={{ position: "absolute", right: 8, top: 8, fontSize: 9, color: "var(--rm-text-faint)", fontWeight: 600, letterSpacing: 0.5 }}>DETAILS →</div>
      )}
    </div>
  );
}

/* ── horizontal bar list (ranked composition) ── */
export function HBarList({
  rows, color, valueFmt, emptyText, onRowClick,
}: {
  rows: { label: string; value: number; sub?: string; key?: string }[];
  color?: string;
  valueFmt: (v: number) => string;
  emptyText?: string;
  onRowClick?: (label: string, row: { label: string; value: number; sub?: string; key?: string }) => void;
}) {
  if (!rows.length) return <EmptyNote text={emptyText ?? "No data available."} />;
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {rows.map((r, i) => (
        <div
          key={`${r.label}-${i}`}
          onClick={() => onRowClick?.(r.label, r)}
          style={{
            borderRadius: 8, padding: "4px 6px", margin: "0 -6px",
            ...(onRowClick ? clickable : {}),
          }}
          onMouseEnter={e => { if (onRowClick) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--rm-panel-soft)"; }}
          onMouseLeave={e => { if (onRowClick) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
          title={onRowClick ? `See ${r.label} details` : undefined}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3, gap: 10 }}>
            <span style={{
              fontSize: 11.5, fontWeight: 600, color: "var(--rm-text)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{r.label}</span>
            <span style={{ fontSize: 11.5, fontWeight: 750, color: "var(--rm-text)", flexShrink: 0, ...NUM_FONT }}>
              {valueFmt(r.value)}
              {r.sub && <span style={{ fontWeight: 500, color: "var(--rm-text-muted)", marginLeft: 6 }}>{r.sub}</span>}
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "var(--rm-panel-border)", overflow: "hidden" }}>
            <div style={{
              width: `${Math.max((r.value / max) * 100, 1.5)}%`, height: "100%", borderRadius: 3,
              background: color ?? SERIES[i % SERIES.length],
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── donut with legend ── */
export function DonutChart({
  slices, centerLabel, centerSub, size = 168, onSliceClick,
}: {
  slices: { label: string; value: number; color?: string }[];
  centerLabel: string; centerSub?: string; size?: number;
  onSliceClick?: (label: string) => void;
}) {
  const data = slices.filter(s => s.value > 0);
  if (!data.length) return <EmptyNote text="No data available." />;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <PieChart width={size} height={size}>
          <Pie
            data={data} dataKey="value" nameKey="label"
            cx={size / 2 - 5} cy={size / 2 - 5}
            innerRadius={size * 0.335} outerRadius={size * 0.47}
            strokeWidth={2} stroke="var(--rm-panel)"
            startAngle={90} endAngle={-270} paddingAngle={1}
            style={{ cursor: onSliceClick ? "pointer" : "default" }}
            onClick={(entry: any) => { if (onSliceClick && entry?.name) onSliceClick(entry.name); }}
          >
            {data.map((s, i) => <Cell key={i} fill={s.color ?? SERIES[i % SERIES.length]} />)}
          </Pie>
        </PieChart>
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", pointerEvents: "none",
        }}>
          <span style={{ fontSize: size >= 160 ? 19 : 15, fontWeight: 850, color: "var(--rm-text)", letterSpacing: "-0.02em", ...NUM_FONT }}>{centerLabel}</span>
          {centerSub && <span style={{ fontSize: 9.5, color: "var(--rm-text-muted)", marginTop: 1 }}>{centerSub}</span>}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1, minWidth: 150 }}>
        {data.map((s, i) => (
          <div
            key={i}
            onClick={() => onSliceClick?.(s.label)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              borderRadius: 6, padding: "3px 5px", margin: "0 -5px",
              ...(onSliceClick ? clickable : {}),
            }}
            onMouseEnter={e => { if (onSliceClick) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--rm-panel-soft)"; }}
            onMouseLeave={e => { if (onSliceClick) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
            title={onSliceClick ? `See ${s.label} breakdown` : undefined}
          >
            <span style={{ width: 9, height: 9, borderRadius: 3, flexShrink: 0, background: s.color ?? SERIES[i % SERIES.length] }} />
            <span style={{
              fontSize: 11.5, color: "var(--rm-text)", flex: 1,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{s.label}</span>
            <span style={{ fontSize: 11.5, fontWeight: 750, color: "var(--rm-text)", ...NUM_FONT }}>
              {Math.round((s.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── funnel (stage progression) ── */
export function FunnelBars({
  stages, valueFmt, onRowClick,
}: {
  stages: { label: string; count: number; value: number }[];
  valueFmt: (v: number) => string;
  onRowClick?: (label: string) => void;
}) {
  if (!stages.length) return <EmptyNote text="No pipeline data." />;
  const maxCount = Math.max(...stages.map(s => s.count), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {stages.map((s, i) => {
        const widthPct = Math.max((s.count / maxCount) * 100, 4);
        const color = SERIES[i % SERIES.length];
        return (
          <div
            key={s.label}
            onClick={() => onRowClick?.(s.label)}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              borderRadius: 8, padding: "3px 4px", margin: "0 -4px",
              ...(onRowClick ? clickable : {}),
            }}
            onMouseEnter={e => { if (onRowClick) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--rm-panel-soft)"; }}
            onMouseLeave={e => { if (onRowClick) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
            title={onRowClick ? `See ${s.label} records` : undefined}
          >
            <div style={{ width: 92, flexShrink: 0, textAlign: "right" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--rm-text)" }}>{s.label}</div>
              <div style={{ fontSize: 10, color: "var(--rm-text-muted)", ...NUM_FONT }}>{valueFmt(s.value)}</div>
            </div>
            <div style={{ flex: 1, height: 26, borderRadius: 6, background: "var(--rm-panel-border)", overflow: "hidden" }}>
              <div style={{
                width: `${widthPct}%`, height: "100%", borderRadius: 6,
                background: `linear-gradient(90deg, ${color}CC, ${color})`,
                display: "flex", alignItems: "center", justifyContent: "flex-end",
                paddingRight: 8, minWidth: 30,
              }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: "#FFFFFF", ...NUM_FONT }}>{s.count}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── vertical column chart (distribution) ── */
export function ColumnChart({
  data, color, height = 190, countFmt, onBarClick,
}: {
  data: { label: string; count: number }[];
  color?: string; height?: number;
  countFmt?: (v: number) => string;
  onBarClick?: (label: string) => void;
}) {
  if (!data.length || data.every(d => d.count === 0)) return <EmptyNote text="No data available." />;
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 18, right: 4, left: 4, bottom: 0 }}
          barCategoryGap="28%"
          style={{ cursor: onBarClick ? "pointer" : "default" }}
          onClick={(state: any) => {
            if (onBarClick && state?.activeLabel) onBarClick(state.activeLabel);
          }}
        >
          <XAxis
            dataKey="label" axisLine={false} tickLine={false}
            tick={{ fontSize: 10.5, fill: "var(--rm-text-muted)" }} interval={0}
          />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: "var(--rm-panel-border)", opacity: 0.35 }}
            contentStyle={{
              background: "var(--rm-panel)", border: "1px solid var(--rm-panel-border)",
              borderRadius: 10, fontSize: 11.5, color: "var(--rm-text)",
            }}
            formatter={(v: any) => [countFmt ? countFmt(Number(v)) : String(v), ""]}
            labelStyle={{ color: "var(--rm-text-muted)", fontWeight: 700 }}
            separator=""
          />
          <Bar
            dataKey="count" radius={[5, 5, 0, 0]} fill={color ?? PALETTE.green}
            label={{ position: "top", fontSize: 11, fontWeight: 750, fill: "var(--rm-text)" }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── grouped won/lost bars per category ── */
export function WinLossBars({
  rows, onRowClick,
}: {
  rows: { sector: string; won: number; lost: number }[];
  onRowClick?: (sector: string, outcome: "won" | "lost") => void;
}) {
  if (!rows.length) return <EmptyNote text="No decided bids yet — win/loss analysis appears once bids close." />;
  const max = Math.max(...rows.map(r => Math.max(r.won, r.lost)), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {rows.map(r => (
        <div key={r.sector}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, gap: 10 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--rm-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sector}</span>
            <span style={{ fontSize: 10.5, color: "var(--rm-text-muted)", flexShrink: 0, ...NUM_FONT, display: "flex", gap: 8 }}>
              <span
                onClick={() => onRowClick?.(r.sector, "won")}
                style={{ color: PALETTE.green, fontWeight: 750, ...(onRowClick && r.won > 0 ? { cursor: "pointer", textDecoration: "underline" } : {}) }}
                title={onRowClick && r.won > 0 ? `See ${r.won} won bids in ${r.sector}` : undefined}
              >{r.won} won</span>
              <span style={{ color: "var(--rm-text-faint)" }}>·</span>
              <span
                onClick={() => onRowClick?.(r.sector, "lost")}
                style={{ color: PALETTE.orange, fontWeight: 750, ...(onRowClick && r.lost > 0 ? { cursor: "pointer", textDecoration: "underline" } : {}) }}
                title={onRowClick && r.lost > 0 ? `See ${r.lost} lost bids in ${r.sector}` : undefined}
              >{r.lost} lost</span>
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div
              style={{ height: 5, borderRadius: 3, background: "var(--rm-panel-border)", overflow: "hidden", cursor: onRowClick && r.won > 0 ? "pointer" : "default" }}
              onClick={() => { if (r.won > 0) onRowClick?.(r.sector, "won"); }}
              title={onRowClick && r.won > 0 ? `See won bids in ${r.sector}` : undefined}
            >
              <div style={{ width: `${(r.won / max) * 100}%`, height: "100%", borderRadius: 3, background: PALETTE.green }} />
            </div>
            <div
              style={{ height: 5, borderRadius: 3, background: "var(--rm-panel-border)", overflow: "hidden", cursor: onRowClick && r.lost > 0 ? "pointer" : "default" }}
              onClick={() => { if (r.lost > 0) onRowClick?.(r.sector, "lost"); }}
              title={onRowClick && r.lost > 0 ? `See lost bids in ${r.sector}` : undefined}
            >
              <div style={{ width: `${(r.lost / max) * 100}%`, height: "100%", borderRadius: 3, background: PALETTE.orange }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── shared empty state ── */
export function EmptyNote({ text }: { text: string }) {
  return (
    <div style={{
      padding: "22px 14px", textAlign: "center",
      fontSize: 11.5, color: "var(--rm-text-muted)",
      background: "var(--rm-panel-soft)", borderRadius: 10,
      border: "1px dashed var(--rm-panel-border)",
    }}>{text}</div>
  );
}
