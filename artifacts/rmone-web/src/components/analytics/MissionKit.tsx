/* ─────────────────────────────────────────────────────────────
 * MissionKit — visual primitives for the Analytics Center's
 * "Mission Control" style (chosen by the client).
 *
 * All components are now THEME-AWARE: dark mode keeps the
 * original deep-navy world; light mode flips to clean white
 * surfaces with darker ink. Call useMC() in any component to
 * get the palette that matches the active app theme.
 * ──────────────────────────────────────────────────────────── */
import React from "react";
import { useTheme } from "@/lib/theme";
import type { Tone } from "@/lib/analyticsCenter";

/* ── palettes ─────────────────────────────────────────────── */

/** Dark-mode (original) Mission Control palette. */
export const MC = {
  bg: "#253746",
  panel: "#2E4557",
  panelSoft: "#345066",
  border: "rgba(255,255,255,0.14)",
  text: "#FFFFFF",
  muted: "rgba(255,255,255,0.65)",
  faint: "rgba(255,255,255,0.50)",
  green: "#6BA539",
  greenInk: "#A8D672",
  greenBright: "#8EC94A",
  blue: "#38BDF8",
  navy: "#6B99BB",
  lime: "#C4D44A",
  orange: "#F0A842",
  violet: "#A78BFA",
  good: "#84CC16",
  warn: "#FB923C",
  bad: "#F87171",
} as const;

/** Light-mode Mission Control palette — same brand identity, white surfaces. */
export const MC_LIGHT = {
  bg: "#F0F2F5",
  panel: "#FFFFFF",
  panelSoft: "#F5F6F8",
  border: "rgba(15,25,35,0.10)",
  text: "#0F1923",
  muted: "rgba(15,25,35,0.62)",
  faint: "rgba(15,25,35,0.40)",
  green: "#6BA539",
  greenInk: "#4A7A27",
  greenBright: "#5C9230",
  blue: "#0284C7",
  navy: "#33404C",
  lime: "#6B7B1A",
  orange: "#C05621",
  violet: "#6D28D9",
  good: "#3F6212",
  warn: "#9A3412",
  bad: "#991B1B",
} as const;

/** Returns the right palette for the active app theme. */
export function useMC() {
  const { mode } = useTheme();
  return mode === "light" ? MC_LIGHT : MC;
}

export function toneColor(t: Tone, palette: typeof MC | typeof MC_LIGHT = MC): string {
  return t === "good" ? palette.good : t === "warn" ? palette.warn : palette.bad;
}

/* ── glass panel ────────────────────────────────────────────── */
export function Glass({ children, style = {}, onClick, className, role, tabIndex, onKeyDown }: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  onClick?: () => void;
  className?: string;
  role?: string;
  tabIndex?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  const { mode } = useTheme();
  const isDark = mode !== "light";
  return (
    <div
      className={className}
      onClick={onClick}
      role={role}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      style={{
        position: "relative",
        borderRadius: 18,
        background: isDark
          ? "linear-gradient(160deg, rgba(62,92,117,0.42) 0%, rgba(37,55,70,0.55) 55%, rgba(30,46,60,0.65) 100%)"
          : "#FFFFFF",
        border: isDark
          ? "1px solid rgba(255,255,255,0.10)"
          : "1px solid rgba(15,25,35,0.10)",
        boxShadow: isDark
          ? "0 18px 44px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.08)"
          : "0 2px 20px rgba(15,25,35,0.07)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ── tone indicators ─────────────────────────────────────────── */
export function ToneDot({ tone }: { tone: Tone }) {
  const mc = useMC();
  const c = toneColor(tone, mc);
  return (
    <span style={{
      display: "inline-block", width: 6, height: 6, borderRadius: "50%",
      background: c, boxShadow: `0 0 6px ${c}`, flexShrink: 0,
    }} />
  );
}

export function ToneChip({ text, tone }: { text: string; tone: Tone }) {
  const mc = useMC();
  const c = toneColor(tone, mc);
  const bg = tone === "good" ? "rgba(132,204,22,0.12)" : tone === "warn" ? "rgba(251,146,60,0.12)" : "rgba(248,113,113,0.12)";
  const bd = tone === "good" ? "rgba(132,204,22,0.3)" : tone === "warn" ? "rgba(251,146,60,0.3)" : "rgba(248,113,113,0.3)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "1px 7px", borderRadius: 6, fontSize: 10, fontWeight: 600,
      whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
      color: c, background: bg, border: `1px solid ${bd}`,
    }}>
      <ToneDot tone={tone} />
      {text}
    </span>
  );
}

/* ── inline SVG spark ──────────────────────────────────────────
 *  Requires ≥2 points; callers must never feed fabricated history. */
export function Spark({ points, color = MC.greenBright, w = 96, h = 30 }: {
  points: number[]; color?: string; w?: number; h?: number;
}) {
  const { mode } = useTheme();
  const dotFill = mode === "light" ? "#253746" : "#fff";
  if (points.length < 2) return null;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const coords = points.map((p, i) => [i * step, h - 3 - ((p - min) / span) * (h - 8)] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L ${w} ${h} L 0 ${h} Z`;
  const gid = `mksp-${color.replace(/\W/g, "")}-${points.length}-${Math.round(points[0])}`;
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.4} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.8} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r={2.6} fill={dotFill}
        style={{ filter: mode === "light" ? "drop-shadow(0 0 3px rgba(0,0,0,0.25))" : "drop-shadow(0 0 4px rgba(255,255,255,0.9))" }} />
    </svg>
  );
}

/* ── mini radial arc gauge ──────────────────────────────────── */
export function MiniGauge({ pct, color = MC.green, size = 62, label }: {
  pct: number; color?: string; size?: number; label: string;
}) {
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const trackColor = isDark ? "rgba(255,255,255,0.09)" : "rgba(15,25,35,0.12)";
  const textFill = isDark ? "#fff" : "#0F1923";
  const dotFill = isDark ? "#fff" : "#0F1923";

  const clamped = Math.max(0, Math.min(100, pct));
  const r = size / 2 - 7;
  const cx = size / 2, cy = size / 2;
  const start = 135, sweep = 270;
  const a0 = (start * Math.PI) / 180;
  const a1 = ((start + sweep) * Math.PI) / 180;
  const av = ((start + (sweep * clamped) / 100) * Math.PI) / 180;
  const pt = (ang: number) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  const [sx, sy] = pt(a0); const [ex, ey] = pt(a1); const [tx, ty] = pt(av);
  const largeVal = (sweep * clamped) / 100 > 180 ? 1 : 0;
  return (
    <svg width={size} height={size} style={{ overflow: "visible" }}>
      <path d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`} fill="none" stroke={trackColor} strokeWidth={5} strokeLinecap="round" />
      {clamped > 0 && (
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${largeVal} 1 ${tx} ${ty}`} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 5px rgba(107,165,57,0.7))" }} />
      )}
      <circle cx={tx} cy={ty} r={3.2} fill={dotFill}
        style={{ filter: isDark ? "drop-shadow(0 0 4px rgba(255,255,255,0.9))" : "drop-shadow(0 0 3px rgba(0,0,0,0.25))" }} />
      <text x={cx} y={cy + 4} textAnchor="middle" fill={textFill} fontSize={12} fontWeight={800}
        style={{ fontVariantNumeric: "tabular-nums" }}>{label}</text>
    </svg>
  );
}

/* ── ranked mini list with inline bars ─────────────────────── */
export function MiniBars({ rows, max, color = MC.navy, suffix = "", onDrill }: {
  rows: { label: string; v: number; text?: string }[];
  max: number; color?: string; suffix?: string;
  /** When provided, each bar row becomes a clickable button that fires this. */
  onDrill?: () => void;
}) {
  const mc = useMC();
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const trackBg = isDark ? "rgba(255,255,255,0.07)" : "rgba(15,25,35,0.07)";
  const valueFg = isDark ? "rgba(255,255,255,0.8)" : mc.text;
  const hoverBg = isDark ? "rgba(255,255,255,0.06)" : "rgba(15,25,35,0.05)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {rows.map((r) => (
        <div
          key={r.label}
          role={onDrill ? "button" : undefined}
          tabIndex={onDrill ? 0 : undefined}
          title={onDrill ? `See data for ${r.label}` : undefined}
          onClick={onDrill}
          onKeyDown={onDrill ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDrill(); } } : undefined}
          style={{
            display: "flex", alignItems: "center", gap: 8, fontSize: 10,
            padding: "3px 5px", borderRadius: 6, margin: "0 -5px",
            cursor: onDrill ? "zoom-in" : undefined,
            transition: "background 0.12s",
          }}
          onMouseEnter={onDrill ? (e) => { (e.currentTarget as HTMLDivElement).style.background = hoverBg; } : undefined}
          onMouseLeave={onDrill ? (e) => { (e.currentTarget as HTMLDivElement).style.background = ""; } : undefined}
        >
          <span style={{
            width: 72, flexShrink: 0, color: mc.faint, whiteSpace: "nowrap",
            overflow: "hidden", textOverflow: "ellipsis",
          }} title={r.label}>{r.label}</span>
          <div style={{ flex: 1, height: 5, borderRadius: 999, overflow: "hidden", background: trackBg }}>
            <div style={{
              height: "100%", borderRadius: 999,
              width: `${Math.max(2, (r.v / Math.max(1, max)) * 100)}%`,
              background: `linear-gradient(90deg, ${color}66, ${color})`,
            }} />
          </div>
          <span style={{
            minWidth: 40, textAlign: "right", fontWeight: 700,
            fontVariantNumeric: "tabular-nums", color: valueFg,
          }}>{r.text ?? `${r.v.toLocaleString("en-US")}${suffix}`}</span>
        </div>
      ))}
      {rows.length === 0 && <div style={{ fontSize: 10.5, color: mc.faint }}>No data yet.</div>}
    </div>
  );
}

/* ── mini sparkline with gap support ───────────────────────────
 *  null entries are genuine gaps (line breaks, not bridged zeros).
 *  Requires ≥2 non-null points to render. */
export function MiniSparkline({
  points, labels = [], color = MC.greenBright, w = 120, h = 36,
}: {
  points: (number | null)[];
  labels?: string[];
  color?: string;
  w?: number;
  h?: number;
}) {
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const dotFill = isDark ? "#fff" : "#253746";
  const labelFill = isDark ? "rgba(255,255,255,0.28)" : "rgba(15,25,35,0.35)";

  const nonNull = points.filter((p): p is number => p !== null);
  if (nonNull.length < 2) return null;

  const min = Math.min(...nonNull);
  const max = Math.max(...nonNull);
  const span = max - min || 1;
  const padT = 4, padB = 6;
  const usableH = h - padT - padB;
  const step = w / Math.max(1, points.length - 1);

  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const v = points[i];
    const x = i * step;
    if (v === null) {
      if (current.length > 0) { segments.push(current); current = []; }
    } else {
      current.push({ x, y: padT + usableH - ((v - min) / span) * usableH });
    }
  }
  if (current.length > 0) segments.push(current);

  const gid = `msp-${color.replace(/\W/g, "")}-${points.length}-${Math.round(nonNull[0])}`;
  const lastSeg = segments[segments.length - 1];
  const lastPt = lastSeg?.[lastSeg.length - 1];

  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {segments.map((seg, si) => {
        if (seg.length < 2) return null;
        const d = seg.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
        const area = `${d} L ${seg[seg.length - 1].x.toFixed(1)} ${h} L ${seg[0].x.toFixed(1)} ${h} Z`;
        return (
          <g key={si}>
            <path d={area} fill={`url(#${gid})`} />
            <path d={d} fill="none" stroke={color} strokeWidth={1.6}
              style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
          </g>
        );
      })}
      {lastPt && (
        <circle cx={lastPt.x} cy={lastPt.y} r={2.4} fill={dotFill}
          style={{ filter: isDark ? "drop-shadow(0 0 4px rgba(255,255,255,0.9))" : "drop-shadow(0 0 3px rgba(0,0,0,0.2))" }} />
      )}
      {labels.length === points.length && points.length <= 8 && labels.map((lb, i) => {
        if (points[i] === null) return null;
        return (
          <text key={i} x={(i * step).toFixed(1)} y={h} textAnchor="middle"
            fill={labelFill} fontSize={7}>
            {lb}
          </text>
        );
      })}
    </svg>
  );
}

/* ── segmented status bar with legend ──────────────────────── */
export function SegmentBar({ total, segments }: {
  total: number;
  segments: { label: string; v: number; color: string }[];
}) {
  const mc = useMC();
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const trackBg = isDark ? "rgba(255,255,255,0.07)" : "rgba(15,25,35,0.07)";
  const valueFg = isDark ? "rgba(255,255,255,0.8)" : mc.text;
  const shown = segments.filter(s => s.v > 0);
  return (
    <div>
      <div style={{ height: 10, borderRadius: 999, overflow: "hidden", display: "flex", background: trackBg }}>
        {shown.map((s) => (
          <div key={s.label} style={{ width: `${(s.v / Math.max(1, total)) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginTop: 6, fontSize: 9.5, fontVariantNumeric: "tabular-nums" }}>
        {segments.map((s) => (
          <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: mc.faint }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: s.color, display: "inline-block" }} />
            {s.label} <b style={{ color: valueFg }}>{s.v.toLocaleString("en-US")}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── paired big numbers ─────────────────────────────────────── */
export function PairGrid({ pairs }: { pairs: { label: string; value: string; color?: string }[] }) {
  const mc = useMC();
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const innerBg = isDark ? "rgba(255,255,255,0.04)" : "rgba(15,25,35,0.04)";
  const innerBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(15,25,35,0.09)";
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(2, Math.max(1, pairs.length))}, 1fr)`, gap: 8 }}>
      {pairs.map((p) => (
        <div key={p.label} style={{
          borderRadius: 10, padding: "8px 12px",
          background: innerBg, border: `1px solid ${innerBorder}`,
        }}>
          <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: mc.faint }}>{p.label}</div>
          <div style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: p.color ?? mc.text }}>{p.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ── labelled count chips ───────────────────────────────────── */
export function ChipGrid({ items }: { items: { label: string; v: string }[] }) {
  const mc = useMC();
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const innerBg = isDark ? "rgba(255,255,255,0.04)" : "rgba(15,25,35,0.04)";
  const innerBorder = isDark ? "rgba(107,165,57,0.27)" : "rgba(107,165,57,0.22)";
  const valueFg = isDark ? "#fff" : mc.text;
  if (items.length === 0) return <div style={{ fontSize: 10.5, color: mc.faint }}>Nothing open right now.</div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      {items.map((e) => (
        <span key={e.label} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderRadius: 10, padding: "6px 10px", fontSize: 10,
          background: innerBg, border: `1px solid ${innerBorder}`,
        }}>
          <span style={{ color: mc.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={e.label}>{e.label}</span>
          <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: valueFg, marginLeft: 8 }}>{e.v}</span>
        </span>
      ))}
    </div>
  );
}
