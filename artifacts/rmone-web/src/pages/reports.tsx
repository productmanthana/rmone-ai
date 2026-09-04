/* ─────────────────────────────────────────────────────────────
 * Reports — lifecycle report hub + module report pages.
 *
 * Hub (this file) matches the RM ONE editorial report design:
 *   sticky meta header · period segment · dark hero lifecycle SVG ·
 *   KPI rail · chart grid (stages / decided / divisions / closeout) ·
 *   Intelligence Hub tile.
 *
 * Module sub-pages keep the existing Mission-Control card layout.
 * ──────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Redirect, useLocation } from "wouter";
import { ArrowLeft, AlertTriangle, ArrowRight, Info, X, ExternalLink, FileSpreadsheet, FileText } from "lucide-react";
import type { ReportModel, OppRow } from "@/lib/reportData";
import { fmtMoney, fmtDateShort } from "@/lib/reportData";
import { int, filterCardByField, fmtCell, type CardModel, type CardColumn, type SectionId } from "@/lib/analyticsCenter";
import {
  MODULE_BUILDERS, REPORT_TITLES, buildReportsHubStats, buildHubHonestyNotes, getPeriodRange,
  getClosedProjectsInPeriod, getReportPeriodMetricCards, withReportCardMetrics,
  type ModuleReport, type ReportCardMetric, type ReportChart, type ReportModuleId, type PeriodRange,
} from "@/lib/reportsCenter";
import {
  MissionWorld, CardShell, StatCard, DrillNumber, useReportModel, LoadingBlock, ErrorBlock,
} from "@/components/analytics/MissionWorld";
import { useMC, Glass } from "@/components/analytics/MissionKit";
import { MissionColumns, MissionHorizBars, MissionDonut } from "@/components/analytics/MissionCharts";
import { DataDrawer } from "@/components/analytics/DataDrawer";
import { ReportAnalyticsCards } from "@/components/analytics/ReportAnalyticsCards";
import { PeriodPicker, DEFAULT_PERIOD, type PeriodState } from "@/components/analytics/PeriodPicker";
import { useTheme } from "@/lib/theme";
import type { OrgDim } from "@/lib/analyticsCenter";
import { fetchStatusLedger, LIFECYCLE_CHANGED_EVENT, type LedgerFeed } from "@/lib/api";
import type { ReportModuleId as _RMID } from "@/lib/reportsCenter";
import { ModuleHeader } from "@/components/layout/ModuleHeader";

/* modules that have ledger coverage */
const LEDGER_MODULE: Partial<Record<_RMID, string>> = { leads: "LEM", opportunities: "OPM" };

function useModuleLedger(moduleId: string, r: PeriodRange): LedgerFeed | null {
  const [ledger, setLedger] = useState<LedgerFeed | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const mod = LEDGER_MODULE[moduleId as _RMID] ?? null;
  useEffect(() => {
    if (!mod) return undefined;
    const onLifecycleChanged = (event: Event) => {
      const modules = (event as CustomEvent<{ modules?: string[] }>).detail?.modules;
      if (!Array.isArray(modules) || modules.includes(mod)) {
        setRefreshVersion((version) => version + 1);
      }
    };
    window.addEventListener(LIFECYCLE_CHANGED_EVENT, onLifecycleChanged);
    return () => window.removeEventListener(LIFECYCLE_CHANGED_EVENT, onLifecycleChanged);
  }, [mod]);
  useEffect(() => {
    if (!mod) { setLedger(null); return; }
    let cancelled = false;
    setLedger(null);
    fetchStatusLedger(mod, r.start.toISOString(), r.end.toISOString())
      .then(feed => { if (!cancelled) setLedger(feed); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mod, r.start.getTime(), r.end.getTime(), refreshVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  return ledger;
}

/* ── shared period state ── */
function usePeriod(): [PeriodState, (v: PeriodState) => void, PeriodRange] {
  const [period, setPeriod] = useState<PeriodState>(() => {
    try {
      const raw = sessionStorage.getItem("reports:period");
      if (raw) return { ...DEFAULT_PERIOD, ...JSON.parse(raw) } as PeriodState;
    } catch { /* fall through */ }
    return DEFAULT_PERIOD;
  });
  const set = (v: PeriodState) => {
    setPeriod(v);
    try { sessionStorage.setItem("reports:period", JSON.stringify(v)); } catch { /* non-fatal */ }
  };
  const range = useMemo(
    () => getPeriodRange(period.kind, period.customStart, period.customEnd),
    [period.kind, period.customStart, period.customEnd],
  );
  return [period, set, range];
}

/* ── svg helpers ── */
function sparkPath(values: number[], w: number, h: number): string {
  const max = Math.max(...values, 1);
  const step = w / Math.max(1, values.length - 1);
  return values.map((v, i) =>
    `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - (v / max) * (h - 3) - 1.5).toFixed(1)}`
  ).join(" ");
}

/* ── lifecycle section SVG (the dark hero chart) ── */
function LifecycleSvg({ stages, greenBright, onStageClick, isDark }: {
  stages: { k: string; v: number; rate: string | null }[];
  greenBright: string;
  onStageClick?: (k: string) => void;
  isDark: boolean;
}) {
  const W = 1200;
  const hasData = stages.some(stage => stage.v > 0);
  const H = hasData ? 390 : 250;
  const DATUM = hasData ? 290 : 150;
  const annotationY = hasData ? 346 : 206;
  const MAX_V = Math.max(1, ...stages.map(s => s.v));
  // Use the full chart width. The SVG already renders edge-to-edge inside
  // the lifecycle card; these coordinates are the remaining visual inset.
  const xs = [48, 416, 784, 1152];

  function hOf(v: number) { return 24 + 196 * Math.sqrt(v / MAX_V); }
  const tops = stages.map(s => DATUM - hOf(s.v));

  // build bezier area path
  let d = `M${xs[0]},${DATUM} L${xs[0]},${tops[0].toFixed(1)}`;
  for (let i = 0; i < 3; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2;
    d += ` C${cx},${tops[i].toFixed(1)} ${cx},${tops[i + 1].toFixed(1)} ${xs[i + 1]},${tops[i + 1].toFixed(1)}`;
  }
  d += ` L${xs[3]},${DATUM} Z`;

  const textFill = isDark ? "#F2F6F1" : "#0D1512";
  const mutedFill = isDark ? "#9FB0A5" : "#5A6B60";
  const dimFill = isDark ? "#6F8076" : "#748276";
  const gridLine = "rgba(220,227,218,.06)";
  const annotBg = "#0D1512";
  const annotText = "#E8C56A";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", marginTop: 4 }}>
      <defs>
        <linearGradient id="rp-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={greenBright} stopOpacity="0.28" />
          <stop offset="100%" stopColor={greenBright} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* grid dots */}
      {[...Array(hasData ? 10 : 6)].map((_, ri) =>
        [...Array(24)].map((__, ci) => (
          <circle key={`${ri}-${ci}`} cx={34 + ci * 49} cy={30 + ri * 28} r={1} fill={gridLine} />
        ))
      )}

      {/* area + line */}
      <path d={d} fill="url(#rp-fill)" />
      <path d={d} fill="none" stroke={greenBright} strokeWidth={1.8} strokeLinejoin="round" />

      {/* datum line + hatch */}
      <line x1={32} y1={DATUM} x2={1168} y2={DATUM} stroke="rgba(220,227,218,.35)" strokeWidth={1} />
      {[...Array(50)].map((_, i) => {
        const x = 34 + i * 23;
        return <line key={i} x1={x} y1={DATUM + 1} x2={x - 10} y2={DATUM + 13} stroke="rgba(220,227,218,.12)" strokeWidth={1} />;
      })}

      {/* stations */}
      {stages.map((s, i) => {
        const x = xs[i];
        const top = tops[i];
        const clickable = !!onStageClick && s.v > 0;
        return (
          <g
            key={s.k}
            onClick={clickable ? () => onStageClick!(s.k) : undefined}
            style={{ cursor: clickable ? "pointer" : "default" }}
          >
            {/* transparent hit area behind the number so the whole label+number zone is tappable */}
            {clickable && <rect x={x - 54} y={top - 52} width={108} height={60} fill="transparent" />}
            <rect x={x - 8} y={top} width={16} height={DATUM - top} fill="rgba(220,227,218,.09)" stroke="rgba(220,227,218,.22)" strokeWidth={1} />
            <line x1={x - 14} y1={top} x2={x + 14} y2={top} stroke={greenBright} strokeWidth={2} />
            <text x={x} y={top - 28} textAnchor="middle" fill={textFill} fontSize={36} fontWeight={600} fontFamily="system-ui, sans-serif"
              style={{ textDecoration: clickable ? "underline" : undefined, textDecorationColor: mutedFill }}>
              {s.v}
            </text>
            <text x={x} y={top - 10} textAnchor="middle" fill={mutedFill} fontSize={10} fontFamily="'IBM Plex Mono', monospace" letterSpacing={1.4}>
              {s.k.toUpperCase()}
            </text>
          </g>
        );
      })}

      {/* dimension annotations */}
      {stages.slice(1).map((s, i) => {
        if (!s.rate) return null;
        const a = xs[i], b = xs[i + 1], y = annotationY;
        const mid = (a + b) / 2;
        const w = s.rate.length * 6.2 + 18;
        return (
          <g key={i}>
            <line x1={a} y1={DATUM + 14} x2={a} y2={y + 5} stroke="#3D4E44" strokeWidth={1} />
            <line x1={b} y1={DATUM + 14} x2={b} y2={y + 5} stroke="#3D4E44" strokeWidth={1} />
            <line x1={a} y1={y} x2={b} y2={y} stroke="#3D4E44" strokeWidth={1} />
            <path d={`M${a + 1},${y} l9,-3.5 v7 z`} fill="#3D4E44" />
            <path d={`M${b - 1},${y} l-9,-3.5 v7 z`} fill="#3D4E44" />
            <rect x={mid - w / 2} y={y - 10} width={w} height={20} fill={annotBg} />
            <text x={mid} y={y + 4} textAnchor="middle" fill={annotText} fontSize={9.5} fontWeight={600} fontFamily="'IBM Plex Mono', monospace" letterSpacing={1.4}>
              {s.rate.toUpperCase()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── open bids by stage SVG ── */
function StageBars({ stages, green, muted, text, border, onBarClick }: {
  stages: { label: string; count: number }[];
  green: string; muted: string; text: string; border: string;
  onBarClick?: (label: string) => void;
}) {
  const rowH = 34;
  const top = 8;
  const left = 148;
  const right = 560;
  const max = Math.max(1, ...stages.map(s => s.count));
  const H = top + stages.length * rowH + 4;

  return (
    <svg viewBox={`0 0 600 ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {stages.map((s, i) => {
        const y = top + i * rowH;
        const barW = (right - left) * (s.count / max);
        const clickable = !!onBarClick && s.count > 0;
        return (
          <g
            key={s.label}
            onClick={clickable ? () => onBarClick!(s.label) : undefined}
            style={{ cursor: clickable ? "pointer" : "default" }}
          >
            {/* invisible hit area covering the full row */}
            {clickable && <rect x={0} y={y - 2} width={600} height={rowH} fill="transparent" />}
            <text x={left - 12} y={y + 15} textAnchor="end" fill={text} fontSize={12.5} fontFamily="system-ui, sans-serif">{s.label}</text>
            <rect x={left} y={y} width={right - left} height={20} fill={border} rx={1} />
            <rect x={left} y={y} width={barW} height={20} fill={green} rx={1} />
            <text x={left + barW + 10} y={y + 15} fill={text} fontSize={14} fontFamily="system-ui, sans-serif" fontWeight={600}>{s.count}</text>
            <line x1={left} y1={y + 33} x2={right} y2={y + 33} stroke={border} strokeWidth={1} />
          </g>
        );
      })}
    </svg>
  );
}

/* ── decided bids (bidirectional columns) SVG ── */
function DecidedChart({ buckets, green, lost: lostColor, muted, border, onBarClick }: {
  buckets: { l: string; w: number; x: number }[];
  green: string; lost: string; muted: string; border: string;
  onBarClick?: (month: string) => void;
}) {
  const W = 420;
  const H = 220;
  const mid = 110;
  const left = 24;
  const right = W - 24;
  if (buckets.length === 0) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        <text x={W / 2} y={H / 2} textAnchor="middle" fill={muted} fontSize={12} fontFamily="'IBM Plex Mono', monospace">
          No decisions in period
        </text>
      </svg>
    );
  }
  const max = Math.max(1, ...buckets.map(b => Math.max(b.w, b.x)));
  const slot = (right - left) / buckets.length;
  const bw = Math.min(32, slot * 0.52);
  const unit = 74 / max;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <line x1={left - 4} y1={mid} x2={right} y2={mid} stroke={border} strokeWidth={1} />
      {buckets.map((b, i) => {
        const cx = left + slot * i + slot / 2;
        const clickable = !!onBarClick && (b.w > 0 || b.x > 0);
        return (
          <g
            key={b.l}
            onClick={clickable ? () => onBarClick!(b.l) : undefined}
            style={{ cursor: clickable ? "pointer" : "default" }}
          >
            {/* invisible hit area covering the whole column slot */}
            {clickable && <rect x={cx - slot / 2} y={0} width={slot} height={H} fill="transparent" />}
            {b.w > 0 && (
              <>
                <rect x={cx - bw / 2} y={mid - b.w * unit} width={bw} height={b.w * unit} fill={green} rx={1} />
                <text x={cx} y={mid - b.w * unit - 7} textAnchor="middle" fill={green} fontSize={12} fontWeight={600} fontFamily="system-ui, sans-serif">{b.w}</text>
              </>
            )}
            {b.x > 0 && (
              <>
                <rect x={cx - bw / 2} y={mid} width={bw} height={b.x * unit} fill={lostColor} rx={1} />
                <text x={cx} y={mid + b.x * unit + 16} textAnchor="middle" fill={muted} fontSize={12} fontFamily="system-ui, sans-serif">{b.x}</text>
              </>
            )}
            <text x={cx} y={H - 14} textAnchor="middle" fill={muted} fontSize={9.5} fontFamily="'IBM Plex Mono', monospace" letterSpacing={1.2}>{b.l.toUpperCase()}</text>
          </g>
        );
      })}
      <text x={left - 4} y={22} fill={green} fontSize={9.5} fontFamily="'IBM Plex Mono', monospace" letterSpacing={1.2}>WON</text>
      <text x={left - 4} y={H - 36} fill={muted} fontSize={9.5} fontFamily="'IBM Plex Mono', monospace" letterSpacing={1.2}>LOST</text>
    </svg>
  );
}

/* ── popup listing the won/lost bids for a clicked month ── */
type BidPopupState = { month: string; won: OppRow[]; lost: OppRow[] };

function BidMonthPopup({ state, onClose, onNavigate, T, MONO }: {
  state: BidPopupState;
  onClose: () => void;
  onNavigate: (ticket: string) => void;
  T: Record<string, string>;
  MONO: string;
}) {
  const panel = (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 5000,
        display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
      }}
    >
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }}
      />
      {/* drawer — must use a solid opaque colour; T.cardBg is semi-transparent
           and bleeds to white when rendered in a portal with no parent bg */}
      <div
        style={{
          position: "relative", zIndex: 1,
          width: "min(480px, 96vw)", height: "100dvh",
          background: T.surface, borderLeft: `1px solid ${T.border}`,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "18px 22px", borderBottom: `1px solid ${T.border}`, flexShrink: 0,
        }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: T.green, marginBottom: 4 }}>
              Decided Bids
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>{state.month}</div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
              {state.won.length} won · {state.lost.length} lost
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: T.muted, padding: 6 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>
          {state.won.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: T.green, marginBottom: 10 }}>
                ✓ Won ({state.won.length})
              </div>
              {state.won.map(o => (
                <div
                  key={o.id}
                  role="button" tabIndex={0}
                  onClick={() => onNavigate(o.id)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavigate(o.id); } }}
                  style={{
                    padding: "11px 14px", borderRadius: 6, marginBottom: 8,
                    background: T.surface, border: `1px solid ${T.border}`,
                    cursor: "pointer", transition: "border-color 0.15s",
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = T.text; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = T.border; }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 4, lineHeight: 1.4 }}>{o.name}</div>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                      {o.value > 0 && (
                        <span style={{ fontFamily: MONO, fontSize: 10, color: T.green }}>{fmtMoney(o.value)}</span>
                      )}
                      {o.stage && (
                        <span style={{ fontSize: 11, color: T.muted }}>{o.stage}</span>
                      )}
                      {o.decidedDate && (
                        <span style={{ fontSize: 11, color: T.muted }}>{fmtDateShort(o.decidedDate)}</span>
                      )}
                    </div>
                  </div>
                  <span style={{ color: T.muted, fontSize: 14, flexShrink: 0 }}>→</span>
                </div>
              ))}
            </div>
          )}
          {state.lost.length > 0 && (
            <div>
              <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: T.muted, marginBottom: 10 }}>
                ✗ Lost ({state.lost.length})
              </div>
              {state.lost.map(o => (
                <div
                  key={o.id}
                  role="button" tabIndex={0}
                  onClick={() => onNavigate(o.id)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavigate(o.id); } }}
                  style={{
                    padding: "11px 14px", borderRadius: 6, marginBottom: 8,
                    background: T.surface, border: `1px solid ${T.border}`,
                    cursor: "pointer", transition: "border-color 0.15s",
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = T.text; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = T.border; }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 4, lineHeight: 1.4 }}>{o.name}</div>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                      {o.value > 0 && (
                        <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted }}>{fmtMoney(o.value)}</span>
                      )}
                      {o.stage && (
                        <span style={{ fontSize: 11, color: T.muted }}>{o.stage}</span>
                      )}
                      {o.decidedDate && (
                        <span style={{ fontSize: 11, color: T.muted }}>{fmtDateShort(o.decidedDate)}</span>
                      )}
                    </div>
                  </div>
                  <span style={{ color: T.muted, fontSize: 14, flexShrink: 0 }}>→</span>
                </div>
              ))}
            </div>
          )}
          {state.won.length === 0 && state.lost.length === 0 && (
            <div style={{ textAlign: "center", color: T.muted, fontSize: 13, paddingTop: 40 }}>No bids recorded for this month.</div>
          )}
        </div>
      </div>
    </div>
  );
  return createPortal(panel, document.body);
}

/* ── unit / treemap squares for divisions ── */
function DivisionUnits({ divisions, colors }: {
  divisions: { label: string; count: number }[];
  colors: string[];
}) {
  const size = 22;
  const gap = 7;
  const perRow = 13;
  const x0 = 4;
  const y0 = 8;
  let idx = 0;
  const squares: { x: number; y: number; color: string; label: string }[] = [];
  divisions.forEach((dv, di) => {
    const color = colors[di % colors.length];
    for (let k = 0; k < dv.count; k++, idx++) {
      const r = Math.floor(idx / perRow);
      const c = idx % perRow;
      squares.push({ x: x0 + c * (size + gap), y: y0 + r * (size + gap), color, label: dv.label });
    }
  });
  const rows = Math.ceil(idx / perRow);
  const svgH = y0 + rows * (size + gap) + 8;
  return (
    <svg viewBox={`0 0 ${x0 + perRow * (size + gap)} ${svgH}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {squares.map((sq, i) => (
        <rect key={i} x={sq.x} y={sq.y} width={size} height={size} rx={2} fill={sq.color}>
          <title>{sq.label}</title>
        </rect>
      ))}
    </svg>
  );
}

/* ── close-out timeline SVG ── */
function CloseoutTimeline({ projects, green, border, text, muted }: {
  projects: { n: string; d: number }[];
  green: string; border: string; text: string; muted: string;
}) {
  const left = 30;
  const right = 400;
  const axis = 80;
  const span = 120;
  const W = 440;
  const H = axis + 70;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <line x1={left} y1={axis} x2={right} y2={axis} stroke={border} strokeWidth={1} />
      {[0, 30, 60, 90, 120].map(d => {
        const x = left + (right - left) * (d / span);
        return (
          <g key={d}>
            <line x1={x} y1={axis} x2={x} y2={axis + 7} stroke={border} strokeWidth={1} />
            <text x={x} y={axis + 22} textAnchor="middle" fill={muted} fontSize={9.5} fontFamily="'IBM Plex Mono', monospace" letterSpacing={1.2}>
              {d === 0 ? "TODAY" : `+${d}D`}
            </text>
          </g>
        );
      })}
      {projects.map((p, i) => {
        const x = left + (right - left) * (Math.min(p.d, 120) / span);
        const y = axis - 20 - i * 30;
        return (
          <g key={i}>
            <line x1={x} y1={axis} x2={x} y2={y} stroke={green} strokeWidth={1} strokeDasharray="2 3" />
            <circle cx={x} cy={axis} r={4.5} fill={green} />
            <text x={x - 8} y={y + 4} textAnchor="end" fill={text} fontSize={11.5} fontFamily="system-ui, sans-serif">{p.n}</text>
            <text x={x + 8} y={y + 4} fill={muted} fontSize={10} fontFamily="'IBM Plex Mono', monospace">{p.d}D</text>
          </g>
        );
      })}
      {projects.length === 0 && (
        <text x={(left + right) / 2} y={axis - 14} textAnchor="middle" fill={green} fontSize={9.5} fontFamily="'IBM Plex Mono', monospace" letterSpacing={1.2}>
          NO PROJECTS WITH CLOSE-OUT DATES
        </text>
      )}
    </svg>
  );
}

/* ── module popup (opens when a KPI rail card is clicked) ── */
function ModulePopup({ moduleId, m, range, orgDim, onClose }: {
  moduleId: ReportModuleId | null;
  m: ReportModel | null;
  range: PeriodRange;
  orgDim: OrgDim;
  onClose: () => void;
}) {
  const MC = useMC();
  const isDark = MC.text === "#FFFFFF";
  const ledger = useModuleLedger(moduleId ?? "", range);
  const [innerDrawer, setInnerDrawer] = useState<CardModel | null>(null);

  /* close on Escape */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!moduleId || !m) return null;
  const recordsOk = !m.sources || m.sources.records;
  // build the report even if ledger is still loading — charts will render with what's available
  const report = MODULE_BUILDERS[moduleId](m, range, new Date(), ledger ?? undefined, orgDim);

  const MONO = "'IBM Plex Mono', ui-monospace, monospace";
  const surface = isDark ? "#152219" : "#FFFFFF";
  const border  = isDark ? "#1F2C25" : "#CBD2C7";
  const textCol = isDark ? "#DCE3DA" : "#0D1512";
  const mutedCol = isDark ? "#93A398" : "#5A6B60";
  const faintCol = isDark ? "#6F8076" : "#93A398";
  const green   = isDark ? "#48925C" : "#2F6B3F";

  const panel = (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 8000,
          background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)",
        }}
      />
      {/* drawer panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 8001,
        width: "min(820px, 92vw)",
        background: isDark ? "#0D1512" : "#E8EBE4",
        borderLeft: `1px solid ${border}`,
        display: "flex", flexDirection: "column",
        overflowY: "auto",
      }}>
        {/* panel header */}
        <div style={{
          padding: "18px 24px",
          borderBottom: `1px solid ${border}`,
          display: "flex", alignItems: "center", gap: 12,
          position: "sticky", top: 0, zIndex: 1,
          background: isDark ? "#0D1512" : "#E8EBE4",
        }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: mutedCol }}>
              Reports
            </div>
            <div style={{ fontFamily: "system-ui,'Segoe UI',sans-serif", fontSize: 19, fontWeight: 600, letterSpacing: "-0.01em", color: textCol, marginTop: 1 }}>
              {REPORT_TITLES[moduleId]} Report
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {/* link to full module page */}
            <Link
              href={`/reports/${moduleId}`}
              onClick={onClose}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase",
                color: green, textDecoration: "none",
                border: `1px solid ${green}44`, borderRadius: 3, padding: "6px 10px",
              }}
            >
              Full report <ExternalLink size={11} />
            </Link>
            <button
              onClick={onClose}
              style={{
                width: 32, height: 32, borderRadius: "50%",
                border: `1px solid ${border}`, background: "transparent",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                color: mutedCol,
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* panel body */}
        <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* hero */}
          <div style={{
            background: surface, border: `1px solid ${border}`, borderRadius: 4, padding: "20px 24px",
          }}>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: green }}>
              {report.hero.label}
            </div>
            <div style={{
              fontFamily: "system-ui,'Segoe UI',sans-serif",
              fontSize: 42, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1,
              color: textCol, margin: "8px 0 0",
            }}>
              {report.hero.value}
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: mutedCol, margin: "10px 0 0", maxWidth: 640 }}>
              {report.hero.explain}
            </p>
          </div>

          {/* KPI grid */}
          {report.kpis.length > 0 && (
            <div style={{
              display: "grid", gap: 10,
              gridTemplateColumns: `repeat(${Math.min(report.kpis.length, 4)}, 1fr)`,
            }}>
              {report.kpis.map(k => (
                <div key={k.label} style={{
                  background: surface, border: `1px solid ${border}`, borderRadius: 4, padding: "14px 16px",
                }}>
                  <div style={{ fontFamily: "system-ui,'Segoe UI',sans-serif", fontSize: 24, fontWeight: 600, color: textCol, letterSpacing: "-0.01em" }}>
                    {k.value}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase", color: faintCol, marginTop: 5 }}>
                    {k.label}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* close-out watch timeline — always visible for the closeout module */}
          {moduleId === "closeout" && (() => {
            const nowMs = Date.now();
            const timelineProjects = m.projects
              .filter(p => p.closeoutDate)
              .map(p => ({ n: p.name, d: Math.round((new Date(p.closeoutDate!).getTime() - nowMs) / 86400000) }))
              .filter(p => p.d >= 0 && p.d <= 120)
              .slice(0, 6);
            const withDate = m.projects.filter(p => p.closeoutDate).length;
            const past = m.projects.filter(p => p.closeoutDate && new Date(p.closeoutDate).getTime() <= nowMs).length;
            return (
              <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: 4, padding: "18px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontFamily: "system-ui,'Segoe UI',sans-serif", fontSize: 14, fontWeight: 600, color: textCol, letterSpacing: "-0.01em" }}>
                    Close-out watch
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.16em", textTransform: "uppercase", color: faintCol, border: `1px solid ${border}`, borderRadius: 2, padding: "3px 7px" }}>
                    Snapshot
                  </span>
                </div>
                <p style={{ fontSize: 12, color: mutedCol, margin: "0 0 12px" }}>
                  Projects with a close-out date on the calendar, plotted against the next 120 days.
                </p>
                <CloseoutTimeline projects={timelineProjects} green={green} border={border} text={textCol} muted={mutedCol} />
                {past === 0 && (
                  <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: green, marginTop: 8 }}>
                    Nothing past its close-out date
                  </div>
                )}
                <div style={{ display: "flex", gap: 24, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${border}` }}>
                  <div>
                    <div style={{ fontFamily: "system-ui,'Segoe UI',sans-serif", fontSize: 22, fontWeight: 600, color: textCol }}>{withDate}</div>
                    <div style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase", color: faintCol, marginTop: 3 }}>With close-out date</div>
                  </div>
                  <div>
                    <div style={{ fontFamily: "system-ui,'Segoe UI',sans-serif", fontSize: 22, fontWeight: 600, color: past > 0 ? "#D97706" : textCol }}>{past}</div>
                    <div style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase", color: faintCol, marginTop: 3 }}>Past date, still open</div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* first two charts */}
          {report.charts.slice(0, 2).map(chart => (
            <div key={chart.title} style={{
              background: surface, border: `1px solid ${border}`, borderRadius: 4, padding: "18px 20px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <span style={{ fontFamily: "system-ui,'Segoe UI',sans-serif", fontSize: 14, fontWeight: 600, color: textCol, letterSpacing: "-0.01em" }}>
                  {chart.title}
                </span>
              </div>
              {chart.takeaway && (
                <p style={{ fontSize: 12, color: mutedCol, margin: "0 0 14px" }}>{chart.takeaway}</p>
              )}
              <ChartViz chart={chart} onDrill={setInnerDrawer} />
            </div>
          ))}

          {/* honesty notes */}
          {report.notes.length > 0 && (
            <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: 4, padding: "12px 16px" }}>
              {report.notes.map(n => (
                <div key={n} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11, color: faintCol, padding: "2px 0", lineHeight: 1.6 }}>
                  <Info size={12} style={{ flexShrink: 0, marginTop: 2 }} />
                  {n}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* drill drawer inside popup */}
      <DataDrawer card={innerDrawer} onClose={() => setInnerDrawer(null)} />
    </>
  );
  return createPortal(panel, document.body);
}

/* ═══════════════════ hub ═══════════════════ */
export default function ReportsHubPage() {
  const MC = useMC();
  const { m, loading, error } = useReportModel();
  const [period, setPeriod, range] = usePeriod();
  const [, navigate] = useLocation();
  const [stageDrawer, setStageDrawer] = useState<CardModel | null>(null);
  const [bidPopup, setBidPopup] = useState<BidPopupState | null>(null);
  const [hubExportBusy, setHubExportBusy] = useState<Record<string, "pdf" | "xlsx" | null>>({});
  const orgDim: OrgDim = "division";

  const exportHubCard = async (
    moduleId: ReportModuleId,
    kind: "pdf" | "xlsx",
    name: string,
    visibleMetrics: ReportCardMetric[],
  ) => {
    if (!m) return;
    setHubExportBusy(s => ({ ...s, [moduleId]: kind }));
    try {
      const baseReport = MODULE_BUILDERS[moduleId](m, range, new Date(), undefined, orgDim);
      const supplemental = getReportPeriodMetricCards(baseReport, visibleMetrics);
      const report = withReportCardMetrics(baseReport, visibleMetrics);
      if (kind === "xlsx") {
        await exportReportExcel(report, name, supplemental.map(section => ({ name: section.label, card: section.card })));
      } else {
        const { exportCardPdf } = await import("@/lib/exportCard");
        if (report.hero.card) await exportCardPdf(report.hero.card, undefined, supplemental);
      }
    } finally {
      setHubExportBusy(s => ({ ...s, [moduleId]: null }));
    }
  };
  const isDark = MC.text === "#FFFFFF";

  /* ── design tokens (editorial palette) ── */
  const T = isDark ? {
    pageBg: "#0D1512",
    surface: "#152219",
    border: "#1F2C25",
    borderSoft: "#1A2820",
    text: "#DCE3DA",
    muted: "#93A398",
    faint: "#6F8076",
    green: "#48925C",
    greenBright: "#7FD79B",
    hv: "#EBB63C",
     heroBg: "#2E4557",
    heroText: "#F2F6F1",
    lostBar: "#2E3D35",
    cardBg: "rgba(255,255,255,0.04)",
    tagPeriodBg: "rgba(235,182,60,0.12)",
    tagPeriodBorder: "#5A4B1F",
    tagPeriodText: "#EBB63C",
  } : {
    pageBg: "#E8EBE4",
    surface: "#FFFFFF",
    border: "#CBD2C7",
    borderSoft: "#E0E5DC",
    text: "#0D1512",
    muted: "#5A6B60",
    faint: "#93A398",
    green: "#2F6B3F",
    greenBright: "#7FD79B",
    hv: "#EBB63C",
     heroBg: "#F2F5F0",
     heroText: "#0D1512",
    lostBar: "#C3CCC5",
    cardBg: "#FFFFFF",
    tagPeriodBg: "#FBF4E2",
    tagPeriodBorder: "#D6C79A",
    tagPeriodText: "#8A6F22",
  };

  const MONO = "'IBM Plex Mono', ui-monospace, 'Cascadia Mono', monospace";

  const recordsOk = !m?.sources || m.sources.records;

  /* lifecycle counts — all-time (used for conversion rates only) */
  const allLeadsLen = m ? (m.allLeads ?? m.leads).length : 0;
  const allOppsLen = m ? (m.allOpps ?? [...m.opps, ...m.decidedOpps]).length : 0;
  const allProjLen = m ? m.projects.length + m.closedProjects.length : 0;
  const closedLen = m ? m.closedProjects.length : 0;
  void allLeadsLen; void allOppsLen; // kept for conversion rate context
  const projectCloseoutRate = allProjLen > 0
    ? Math.round((closedLen / allProjLen) * 100)
    : null;

  /* period label */
  const fmtD = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const periodLabel = `${fmtD(range.start)} – ${fmtD(range.end)}, ${range.end.getFullYear()}`;

  /* period-filtered KPIs */
  const newLeadsPeriod = useMemo(() => {
    if (!m) return 0;
    return (m.allLeads ?? m.leads).filter(l => l.created && new Date(l.created) >= range.start && new Date(l.created) <= range.end).length;
  }, [m, range.start.getTime(), range.end.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const wonPeriod = useMemo(() => {
    if (!m) return 0;
    return m.decidedOpps.filter(o => o.won && o.decidedDate && new Date(o.decidedDate) >= range.start && new Date(o.decidedDate) <= range.end).length;
  }, [m, range.start.getTime(), range.end.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const newProjPeriod = useMemo(() => {
    if (!m) return 0;
    return m.projects.filter(p => p.created && new Date(p.created) >= range.start && new Date(p.created) <= range.end).length;
  }, [m, range.start.getTime(), range.end.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const periodClosedProjects = useMemo(() => {
    if (!m) return null;
    return getClosedProjectsInPeriod(m, range);
  }, [m, range.start.getTime(), range.end.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const closedPeriod = periodClosedProjects?.projects.length ?? 0;

  const newOppsPeriod = useMemo(() => {
    if (!m) return 0;
    return [...m.opps, ...m.decidedOpps].filter(o => o.created && new Date(o.created) >= range.start && new Date(o.created) <= range.end).length;
  }, [m, range.start.getTime(), range.end.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  /* hub-level period/history coverage honesty notes — computed from the
   * shared buildHubHonestyNotes() pure function (same honesty contract as
   * the per-module reports). Never fabricates per-period numbers or dates. */
  const hubHonestyNotes = useMemo(
    () => (m && recordsOk ? buildHubHonestyNotes(m, range) : []),
    [m, recordsOk, range.start.getTime(), range.end.getTime()], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* lifecycle funnel — counts scoped to the active period */
  const LIFECYCLE = m && recordsOk ? [
    { k: "Leads",         v: newLeadsPeriod, rate: null },
    { k: "Opportunities", v: newOppsPeriod,  rate: m.conversion.leadConversionRate != null ? `${m.conversion.leadConversionRate}% of leads convert` : null },
    { k: "Projects",      v: newProjPeriod,  rate: m.conversion.oppConversionRate  != null ? `${m.conversion.oppConversionRate}% of bids won` : null },
    { k: "Closed out",    v: closedPeriod,   rate: projectCloseoutRate != null ? `${projectCloseoutRate}% of projects closed out` : null },
  ] : null;
  /* lifecycle stage drill-down cards — shown when user clicks a number */
  const lifecycleCards = useMemo((): Record<string, CardModel> => {
    if (!m) return {};
    const inRange = (d?: string | null) => !!d && new Date(d) >= range.start && new Date(d) <= range.end;

    const leads = (m.allLeads ?? m.leads).filter(l => inRange(l.created));
    const opps  = [...m.opps, ...m.decidedOpps].filter(o => inRange(o.created));
    const projs = m.projects.filter(p => inRange(p.created));
    const closed = periodClosedProjects?.projects ?? [];

    const leadCols: CardColumn[] = [
      { key: "name",    label: "Lead",     width: 30 },
      { key: "status",  label: "Status",   width: 16 },
      { key: "value",   label: "Value",    width: 14, align: "right", kind: "money" },
      { key: "created", label: "Created",  width: 16, kind: "date" },
    ];
    const oppCols: CardColumn[] = [
      { key: "name",    label: "Pursuit",  width: 30 },
      { key: "stage",   label: "Stage",    width: 18 },
      { key: "client",  label: "Client",   width: 20 },
      { key: "value",   label: "Value",    width: 14, align: "right", kind: "money" },
    ];
    const projCols: CardColumn[] = [
      { key: "name",      label: "Project",  width: 30 },
      { key: "status",    label: "Status",   width: 16 },
      { key: "division",  label: "Division", width: 18 },
      { key: "value",     label: "Value",    width: 14, align: "right", kind: "money" },
    ];
    const closedCols: CardColumn[] = [
      { key: "name",       label: "Project",    width: 30 },
      { key: "status",     label: "Status",     width: 16 },
      { key: "division",   label: "Division",   width: 18 },
      { key: "closedDate", label: "Closed",     width: 16, kind: "date" },
    ];

    return {
      "Leads": {
        id: "leads" as SectionId,
        title: `New Leads · ${periodLabel}`,
        takeaway: leads.length ? `${leads.length} lead${leads.length !== 1 ? "s" : ""} created in the period.` : "No leads created in this period.",
        stats: [], columns: leadCols,
        rows: leads.map(l => ({ name: l.name, status: l.status, value: l.value, created: l.created ?? null, _ticket: l.id })),
      },
      "Opportunities": {
        id: "opportunities" as SectionId,
        title: `New Opportunities · ${periodLabel}`,
        takeaway: opps.length ? `${opps.length} pursuit${opps.length !== 1 ? "s" : ""} created in the period.` : "No pursuits created in this period.",
        stats: [], columns: oppCols,
        rows: opps.map(o => ({ name: o.name, stage: o.stage || "—", client: o.client ?? "—", value: o.value, _ticket: o.id })),
      },
      "Projects": {
        id: "projects" as SectionId,
        title: `New Projects · ${periodLabel}`,
        takeaway: projs.length ? `${projs.length} project${projs.length !== 1 ? "s" : ""} created in the period.` : "No projects created in this period.",
        stats: [], columns: projCols,
        rows: projs.map(p => ({ name: p.name, status: p.status, division: p.division ?? "—", value: p.value, _ticket: p.id })),
      },
      "Closed out": {
        id: "closeout" as SectionId,
        title: `Closed Out · ${periodLabel}`,
        takeaway: closed.length ? `${closed.length} project${closed.length !== 1 ? "s" : ""} closed in the period.` : "No projects closed in this period.",
        stats: [], columns: closedCols,
        rows: closed.map(p => ({
          name: p.name,
          status: p.status,
          division: p.division ?? "—",
          closedDate: periodClosedProjects?.closedAtById.get(p.id.toLowerCase()) ?? p.closedDate ?? null,
          _ticket: p.id,
        })),
      },
    };
  }, [m, periodClosedProjects, range.start.getTime(), range.end.getTime(), periodLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  /* decided bids buckets (by month, within period) */
  const decidedBuckets = useMemo(() => {
    if (!m) return [] as { l: string; w: number; x: number }[];
    const decided = m.decidedOpps.filter(o => o.decidedDate && new Date(o.decidedDate) >= range.start && new Date(o.decidedDate) <= range.end);
    const groups = new Map<string, { won: number; lost: number }>();
    for (const o of decided) {
      if (!o.decidedDate) continue;
      const key = new Date(o.decidedDate).toLocaleDateString("en-US", { month: "short" });
      const g = groups.get(key) ?? { won: 0, lost: 0 };
      if (o.won) g.won++; else g.lost++;
      groups.set(key, g);
    }
    return Array.from(groups.entries()).map(([l, v]) => ({ l, w: v.won, x: v.lost }));
  }, [m, range.start.getTime(), range.end.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalWon = decidedBuckets.reduce((s, b) => s + b.w, 0);
  const totalLost = decidedBuckets.reduce((s, b) => s + b.x, 0);
  const decidedTotal = totalWon + totalLost;
  const winRate = decidedTotal > 0 ? Math.round(totalWon / decidedTotal * 100) : null;

  /* close-out watch */
  const now = new Date();
  const closeoutProjects = useMemo(() => {
    if (!m) return [] as { n: string; d: number }[];
    return m.projects
      .filter(p => p.closeoutDate)
      .map(p => ({ n: p.name, d: Math.round((new Date(p.closeoutDate!).getTime() - now.getTime()) / 86400000) }))
      .filter(p => p.d >= 0 && p.d <= 120)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
  }, [m]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeoutMetricCards = useMemo(() => {
    const withDate = (m?.projects ?? []).filter(p => p.closeoutDate);
    const past = withDate.filter(p => new Date(p.closeoutDate!).getTime() < Date.now());
    const columns: CardColumn[] = [
      { key: "name",         label: "Project",        width: 32 },
      { key: "status",       label: "Status",         width: 18 },
      { key: "division",     label: "Division",       width: 18 },
      { key: "closeoutDate", label: "Close-Out Date", width: 16, kind: "date" },
    ];
    const rows = (projects: typeof withDate) => projects.map(p => ({
      name: p.name,
      status: p.status || "—",
      division: p.division ?? "—",
      closeoutDate: p.closeoutDate ?? null,
      _ticket: p.id,
    }));

    return {
      withDate: {
        id: "closeout" as SectionId,
        title: "Close-out Watch — Projects With a Close-out Date",
        takeaway: withDate.length
          ? `${withDate.length} active project${withDate.length === 1 ? "" : "s"} with a close-out date on record.`
          : "No active projects have a close-out date on record.",
        stats: [{ label: "Active Projects", value: int(withDate.length) }],
        columns,
        rows: rows(withDate),
      },
      past: {
        id: "closeout" as SectionId,
        title: "Close-out Watch — Past Date, Still Open",
        takeaway: past.length
          ? `${past.length} active project${past.length === 1 ? "" : "s"} already past the recorded close-out date.`
          : "No active projects are past their recorded close-out date.",
        stats: [{ label: "Active Projects", value: int(past.length) }],
        columns,
        rows: rows(past),
      },
    };
  }, [m]);
  const closeoutWithDate = closeoutMetricCards.withDate.rows.length;
  const closeoutPast = closeoutMetricCards.past.rows.length;

  /* division shades */
  const DIV_COLORS = isDark
    ? ["#1F4A2C", "#2F6B3F", "#4E9C63", "#8FC9A2", "#B5DBC4", "#D2EEE0"]
    : ["#1F4A2C", "#2F6B3F", "#4E9C63", "#8FC9A2", "#B5DBC4", "#D2EEE0"];

  const divData = m?.backlogByDivision.slice(0, 6) ?? [];
  const stageData = (m?.opmByStage ?? []).slice(0, 6).map(s => ({ label: s.label, count: s.count }));
  const stageMax = Math.max(1, ...stageData.map(s => s.count));
  const stageInEstimating = stageData.find(s => s.label.toLowerCase().includes("estimat"))?.count ?? 0;

  /* stage drill-down card — all open opps, drillable by stage */
  const stageCard: CardModel | null = useMemo(() => {
    if (!m || !m.opps.length) return null;
    const columns: CardColumn[] = [
      { key: "name",   label: "Pursuit",  width: 32 },
      { key: "stage",  label: "Stage",    width: 20 },
      { key: "client", label: "Client",   width: 20 },
      { key: "value",  label: "Value",    width: 14, align: "right", kind: "money" },
    ];
    return {
      id: "pipeline" as SectionId,
      title: "Open Bids by Stage",
      takeaway: `${m.opps.length} open pursuit${m.opps.length !== 1 ? "s" : ""} across all stages.`,
      stats: [],
      columns,
      rows: m.opps.map(o => ({
        name: o.name,
        stage: o.stage || "—",
        client: o.client ?? "—",
        value: o.value,
        _ticket: o.id,
      })),
    };
  }, [m]);

  /* The rail's two numbers represent different record populations. Keep an
   * explicit card for each one so a click on "3 Active" never falls through
   * to a general module preview containing unrelated rows. */
  const hubMetricCards = useMemo(() => {
    if (!m) return null;
    const inRange = (date?: string | null) => !!date && new Date(date) >= range.start && new Date(date) <= range.end;
    const leadColumns: CardColumn[] = [
      { key: "name", label: "Lead", width: 30 },
      { key: "status", label: "Status", width: 18 },
      { key: "client", label: "Client", width: 20 },
      { key: "value", label: "Value", width: 14, align: "right", kind: "money" },
    ];
    const oppColumns: CardColumn[] = [
      { key: "name", label: "Pursuit", width: 30 },
      { key: "stage", label: "Stage", width: 18 },
      { key: "client", label: "Client", width: 20 },
      { key: "value", label: "Value", width: 14, align: "right", kind: "money" },
    ];
    const projectColumns: CardColumn[] = [
      { key: "name", label: "Project", width: 30 },
      { key: "status", label: "Status", width: 18 },
      { key: "division", label: "Division", width: 18 },
      { key: "value", label: "Value", width: 14, align: "right", kind: "money" },
    ];
    const activeLeads = m.leads.map(lead => ({
      name: lead.name, status: lead.status || "—", client: lead.client ?? "—", value: lead.value, _ticket: lead.id,
    }));
    const openBids = m.opps.map(opp => ({
      name: opp.name, stage: opp.stage || "—", client: opp.client ?? "—", value: opp.value, _ticket: opp.id,
    }));
    const wonInPeriod = m.decidedOpps.filter(opp => opp.won && inRange(opp.decidedDate)).map(opp => ({
      name: opp.name, stage: opp.stage || "—", client: opp.client ?? "—", value: opp.value, _ticket: opp.id,
    }));
    const activeProjects = m.projects.map(project => ({
      name: project.name, status: project.status || "—", division: project.division ?? "—", value: project.value, _ticket: project.id,
    }));

    return {
      activeLeads: {
        id: "leads" as SectionId,
        title: "Active Leads",
        takeaway: activeLeads.length ? `${activeLeads.length} active lead${activeLeads.length === 1 ? "" : "s"} right now.` : "No active leads right now.",
        stats: [], columns: leadColumns, rows: activeLeads,
      },
      newLeads: lifecycleCards.Leads,
      openBids: {
        id: "opportunities" as SectionId,
        title: "Open Bids",
        takeaway: openBids.length ? `${openBids.length} live pursuit${openBids.length === 1 ? "" : "s"} right now.` : "No open bids right now.",
        stats: [], columns: oppColumns, rows: openBids,
      },
      wonInPeriod: {
        id: "opportunities" as SectionId,
        title: `Bids Won · ${periodLabel}`,
        takeaway: wonInPeriod.length ? `${wonInPeriod.length} bid${wonInPeriod.length === 1 ? "" : "s"} won in the selected period.` : "No bids were won in the selected period.",
        stats: [], columns: oppColumns, rows: wonInPeriod,
      },
      activeProjects: {
        id: "projects" as SectionId,
        title: "Active Projects",
        takeaway: activeProjects.length ? `${activeProjects.length} active project${activeProjects.length === 1 ? "" : "s"} right now.` : "No active projects right now.",
        stats: [], columns: projectColumns, rows: activeProjects,
      },
      newProjects: lifecycleCards.Projects,
      withCloseoutDate: closeoutMetricCards.withDate,
      closedInPeriod: lifecycleCards["Closed out"],
    } satisfies Record<string, CardModel>;
  }, [m, lifecycleCards, closeoutMetricCards, range.start.getTime(), range.end.getTime(), periodLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStageBarClick = (label: string) => {
    if (!stageCard) return;
    const filtered = filterCardByField(stageCard, "stage", label);
    setStageDrawer(filtered);
  };

  /* sparklines: use monthly opmByStage proportions as decorative series */
  const makeSparkSeries = (seed: number) =>
    [0.6, 0.8, 0.5, 0.9, 0.7, 1.0, 0.75].map((v, i) => Math.max(0, Math.round(seed * v * (0.8 + ((i + seed) % 3) * 0.15))));

  const PERIOD_TABS: { key: PeriodState["kind"]; label: string }[] = [
    { key: "week", label: "This Week" },
    { key: "month", label: "This Month" },
    { key: "quarter", label: "This Quarter" },
    { key: "ytd", label: "Year to Date" },
    { key: "custom", label: "Custom" },
  ];

  const KPI_RAIL = m && recordsOk && hubMetricCards ? [
    {
      name: "Leads", moduleId: "leads" as ReportModuleId,
      desc: "New leads, the active lead book, statuses, age and conversion into opportunities.",
      snapLabel: "Active", snapVal: hubMetricCards.activeLeads.rows.length,
      perLabel: "New in period", perVal: hubMetricCards.newLeads.rows.length,
      snapCard: hubMetricCards.activeLeads, perCard: hubMetricCards.newLeads,
      spark: makeSparkSeries(Math.max(1, (m.allLeads ?? m.leads).length)),
    },
    {
      name: "Opportunities", moduleId: "opportunities" as ReportModuleId,
      desc: "New pursuits, the open pipeline by stage and division, and bids won or lost.",
      snapLabel: "Open bids", snapVal: hubMetricCards.openBids.rows.length,
      perLabel: "Won in period", perVal: hubMetricCards.wonInPeriod.rows.length,
      snapCard: hubMetricCards.openBids, perCard: hubMetricCards.wonInPeriod,
      spark: makeSparkSeries(Math.max(1, m.activeBids)),
    },
    {
      name: "Projects", moduleId: "projects" as ReportModuleId,
      desc: "New projects, the active portfolio by status and division, and work starting or finishing.",
      snapLabel: "Active", snapVal: hubMetricCards.activeProjects.rows.length,
      perLabel: "New in period", perVal: hubMetricCards.newProjects.rows.length,
      snapCard: hubMetricCards.activeProjects, perCard: hubMetricCards.newProjects,
      spark: makeSparkSeries(Math.max(1, m.activeProjects)),
    },
    {
      name: "Close Out", moduleId: "closeout" as ReportModuleId,
      desc: "Projects heading into close-out, past their close-out date, and fully closed.",
      snapLabel: "With close-out date", snapVal: hubMetricCards.withCloseoutDate.rows.length,
      perLabel: "Closed in period", perVal: hubMetricCards.closedInPeriod.rows.length,
      snapCard: hubMetricCards.withCloseoutDate, perCard: hubMetricCards.closedInPeriod,
      spark: makeSparkSeries(Math.max(1, closeoutWithDate)),
    },
  ] : null;

  /* ── card style helpers ── */
  const card: React.CSSProperties = {
    background: T.cardBg,
    border: `1px solid ${T.border}`,
    borderRadius: 4,
    padding: "18px 20px 20px",
    display: "flex",
    flexDirection: "column",
  };
  const tag = (variant?: "period"): React.CSSProperties => ({
    fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.16em", textTransform: "uppercase",
    padding: "3px 7px", borderRadius: 2,
    border: `1px solid ${variant === "period" ? T.tagPeriodBorder : T.border}`,
    color: variant === "period" ? T.tagPeriodText : T.muted,
    background: variant === "period" ? T.tagPeriodBg : "transparent",
    marginLeft: "auto", flexShrink: 0,
  });
  const statInline: React.CSSProperties = {
    display: "flex", gap: 26, marginTop: "auto",
    paddingTop: 14, borderTop: `1px solid ${T.borderSoft}`,
  };

  return (
    <MissionWorld>
      <ModuleHeader
        title="Reports"
        section="Operational Intelligence"
        context={periodLabel}
        icon={FileText}
        style={{ marginBottom: 14 }}
      />
      {/* ── period segment bar ── */}
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center",
        gap: 12, padding: "6px 0 16px",
      }}>
        {/* segment control — pill style matching app nav tabs */}
        <div style={{
          display: "inline-flex",
          background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
          borderRadius: 999, padding: 4, gap: 2,
        }}>
          {PERIOD_TABS.map(tab => {
            const active = period.kind === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setPeriod({ ...period, kind: tab.key as PeriodState["kind"] })}
                style={{
                  fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase",
                  border: 0,
                  background: active ? T.green : "transparent",
                  color: active ? "#FFFFFF" : T.muted,
                  padding: "6px 14px", borderRadius: 999, cursor: "pointer",
                  fontWeight: active ? 700 : 500,
                  transition: "background 0.15s, color 0.15s",
                  boxShadow: active ? `0 2px 8px ${T.green}55` : "none",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        {/* range note */}
        <span style={{ fontFamily: MONO, fontSize: 11, color: T.muted, letterSpacing: "0.04em" }}>
          {periodLabel}
        </span>
        {/* custom date pickers */}
        {period.kind === "custom" && (
          <PeriodPicker value={period} onChange={setPeriod} />
        )}
        {/* Intelligence Hub link — right edge, filled accent pill */}
        <Link
          href="/intelligence"
          style={{
            marginLeft: "auto",
            display: "inline-flex", alignItems: "center", gap: 8,
            fontFamily: MONO, fontSize: 10, letterSpacing: "0.13em", textTransform: "uppercase",
            color: isDark ? "#0D1512" : "#FFFFFF",
            textDecoration: "none",
            background: `linear-gradient(135deg, ${T.green}, ${T.greenBright})`,
            borderRadius: 3, padding: "7px 14px",
            boxShadow: `0 0 12px ${T.green}55`,
            transition: "box-shadow 0.2s, opacity 0.15s",
            flexShrink: 0, fontWeight: 600,
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLAnchorElement).style.boxShadow = `0 0 20px ${T.green}88`;
            (e.currentTarget as HTMLAnchorElement).style.opacity = "0.92";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLAnchorElement).style.boxShadow = `0 0 12px ${T.green}55`;
            (e.currentTarget as HTMLAnchorElement).style.opacity = "1";
          }}
        >
          Intelligence Hub <ArrowRight size={11} />
        </Link>
      </div>

      {loading && !m && <LoadingBlock />}
      {!loading && !m && <ErrorBlock text={error || "No report data is available right now."} />}
      {m && !recordsOk && (
        <ErrorBlock text="Lifecycle records didn't load, so the report numbers can't be shown. Refresh to try again." />
      )}

      {m && (
        <>
          {/* ── KPI rail — ABOVE the lifecycle diagram ── */}
          {KPI_RAIL && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 14, marginTop: 0,
            }}>
              {KPI_RAIL.map(c => {
                const busy = hubExportBusy[c.moduleId];
                const exportBtnStyle: React.CSSProperties = {
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase",
                  padding: "4px 9px", borderRadius: 3, cursor: "pointer",
                  border: `1px solid ${T.border}`, background: "transparent", color: T.muted,
                  transition: "border-color 0.15s, color 0.15s", flexShrink: 0,
                };
                return (
                  <div
                    key={c.name}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open the full ${c.name} report`}
                    onClick={() => navigate(`/reports/${c.moduleId}`)}
                    onKeyDown={e => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(`/reports/${c.moduleId}`);
                      }
                    }}
                    style={{
                      ...card,
                      cursor: "pointer",
                      transition: "border-color 0.18s, transform 0.18s",
                      gap: 10, textAlign: "left",
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = T.text;
                      (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = T.border;
                      (e.currentTarget as HTMLDivElement).style.transform = "none";
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontFamily: "system-ui,'Segoe UI',sans-serif", fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em", color: T.text }}>
                        {c.name}
                      </span>
                      <span style={{ marginLeft: "auto", color: T.muted, fontSize: 14 }}>→</span>
                    </div>
                    <p style={{ fontSize: 12, color: T.muted, lineHeight: 1.45, margin: 0, minHeight: 36 }}>{c.desc}</p>
                    <div style={{ display: "flex", gap: 20, alignItems: "flex-end" }}>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Show the ${c.snapVal} ${c.snapLabel.toLowerCase()} records`}
                        title={`Show ${c.snapLabel.toLowerCase()} records`}
                        onClick={e => { e.stopPropagation(); setStageDrawer(c.snapCard); }}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setStageDrawer(c.snapCard); } }}
                        style={{ cursor: "zoom-in", borderRadius: 3 }}
                      >
                        <span style={{ fontFamily: "system-ui,'Segoe UI',sans-serif", fontSize: 28, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.02em", color: T.text, display: "block" }}>
                          {c.snapVal}
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase", color: T.muted, display: "block", marginTop: 4 }}>
                          {c.snapLabel}
                        </span>
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Show the ${c.perVal} ${c.perLabel.toLowerCase()} records`}
                        title={`Show ${c.perLabel.toLowerCase()} records`}
                        onClick={e => { e.stopPropagation(); setStageDrawer(c.perCard); }}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setStageDrawer(c.perCard); } }}
                        style={{ cursor: "zoom-in", borderRadius: 3 }}
                      >
                        <span style={{ fontFamily: "system-ui,'Segoe UI',sans-serif", fontSize: c.perVal === 0 ? 18 : 28, fontWeight: c.perVal === 0 ? 500 : 600, lineHeight: c.perVal === 0 ? 1.25 : 1, letterSpacing: "-0.02em", color: T.text, display: "block" }}>
                          {c.perVal}
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase", color: T.muted, display: "block", marginTop: 4 }}>
                          {c.perLabel}
                        </span>
                      </span>
                      <svg style={{ marginLeft: "auto", opacity: 0.9 }} width={70} height={26} viewBox="0 0 70 26" aria-hidden="true">
                        <path d={sparkPath(c.spark, 70, 26)} fill="none" stroke={T.green} strokeWidth={1.5} strokeLinejoin="round" />
                      </svg>
                    </div>
                    {/* export buttons — stop propagation so card nav doesn't fire */}
                    <div
                      style={{ display: "flex", gap: 6, paddingTop: 10, borderTop: `1px solid ${T.borderSoft}`, marginTop: 2 }}
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        style={exportBtnStyle}
                        disabled={!!busy}
                        onClick={() => exportHubCard(c.moduleId, "pdf", c.name, [
                          { label: c.snapLabel, value: c.snapVal },
                          { label: c.perLabel, value: c.perVal },
                        ])}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = T.text; (e.currentTarget as HTMLElement).style.borderColor = T.text; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = T.muted; (e.currentTarget as HTMLElement).style.borderColor = T.border; }}
                      >
                        <FileText size={10} />
                        {busy === "pdf" ? "…" : "PDF"}
                      </button>
                      <button
                        style={exportBtnStyle}
                        disabled={!!busy}
                        onClick={() => exportHubCard(c.moduleId, "xlsx", c.name, [
                          { label: c.snapLabel, value: c.snapVal },
                          { label: c.perLabel, value: c.perVal },
                        ])}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = T.text; (e.currentTarget as HTMLElement).style.borderColor = T.text; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = T.muted; (e.currentTarget as HTMLElement).style.borderColor = T.border; }}
                      >
                        <FileSpreadsheet size={10} />
                        {busy === "xlsx" ? "…" : "Excel"}
                      </button>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Open the full ${c.name} report`}
                        style={{ ...exportBtnStyle, marginLeft: "auto", color: T.text, borderColor: T.text }}
                        onClick={() => navigate(`/reports/${c.moduleId}`)}
                        onKeyDown={e => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            navigate(`/reports/${c.moduleId}`);
                          }
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = T.borderSoft; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                      >
                        Full report
                        <ArrowRight size={10} />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── hero: lifecycle section ── */}
          <section style={{
            background: T.heroBg,
            borderRadius: 5,
            border: "1px solid rgba(255,255,255,0.14)",
            padding: 0,
             color: T.heroText,
            position: "relative",
            overflow: "hidden",
            marginTop: 14,
          }}>
            {/* padded header — period picker sits above the title */}
            <div style={{ padding: "22px 28px 8px" }}>
              {/* eyebrow + inline period picker on the same row */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                flexWrap: "wrap", gap: 10, marginBottom: 10,
              }}>
                <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.22em", textTransform: "uppercase", color: T.greenBright, opacity: 0.85 }}>
                  Lifecycle Section
                </div>
                 <PeriodPicker value={period} onChange={setPeriod} dark={isDark} />
              </div>
              <h1 style={{
                fontFamily: "system-ui,'Segoe UI',sans-serif",
                fontWeight: 600, fontSize: "clamp(22px, 3vw, 32px)",
                letterSpacing: "-0.02em", margin: "0 0 6px", color: T.heroText, lineHeight: 1.1,
              }}>
                Where the work stands, end to end
              </h1>
               <p style={{ fontSize: 13, color: T.muted, maxWidth: "60ch", margin: 0 }}>
                Records created in the selected period, sectioned by lifecycle stage. Column height is volume; the profile line is how work moves between stages.
              </p>
            </div>

            {/* SVG — no horizontal padding so it fills the card edge to edge */}
            {LIFECYCLE && (
              <LifecycleSvg
                stages={LIFECYCLE}
                greenBright={T.greenBright}
                isDark={isDark}
                onStageClick={k => {
                  const card = lifecycleCards[k];
                  if (card) setStageDrawer(card);
                }}
              />
            )}

          </section>

          {/* ── hub-level honesty notes ── */}
          {hubHonestyNotes.length > 0 && (
            <div style={{
              background: T.cardBg, border: `1px solid ${T.border}`,
              borderRadius: 4, padding: "10px 16px", marginTop: 10,
              display: "flex", flexDirection: "column", gap: 3,
            }}>
              {hubHonestyNotes.map(n => (
                <div key={n} style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11, color: T.faint, lineHeight: 1.55 }}>
                  <Info size={11} style={{ flexShrink: 0, marginTop: 2 }} />
                  {n}
                </div>
              ))}
            </div>
          )}

          {/* ── chart grid ── */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(12, 1fr)",
            gap: 14, marginTop: 14,
          }}>
            {/* ── open bids by stage — full width ── */}
            {stageData.length > 0 && (
              <section style={{
                gridColumn: "span 7",
                background: T.cardBg,
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                padding: "22px 24px 20px",
                display: "flex", flexDirection: "column",
              }}>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: T.green, marginBottom: 5 }}>
                    Opportunities · Snapshot
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <h2 style={{ fontFamily: "system-ui,'Segoe UI',sans-serif", fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", margin: 0, color: T.text }}>
                      Open bids by stage
                    </h2>
                  </div>
                  <p style={{ fontSize: 12, color: T.muted, margin: "4px 0 0", lineHeight: 1.5 }}>
                    Where the <strong style={{ color: T.text, fontWeight: 600 }}>{m.activeBids}</strong> live pursuits are sitting right now.
                    {stageInEstimating > 0 && <> · Estimating is the widest step.</>}
                  </p>
                </div>

                <StageBars
                  stages={stageData}
                  green={T.green}
                  muted={T.muted}
                  text={T.text}
                  border={isDark ? "rgba(220,227,218,.1)" : "#EFF2ED"}
                  onBarClick={stageCard ? handleStageBarClick : undefined}
                />

                <div style={{
                  display: "flex", gap: 28, marginTop: "auto",
                  paddingTop: 16, borderTop: `1px solid ${T.borderSoft}`,
                }}>
                  {[
                    { v: m.activeBids, l: "Open bids" },
                    ...(stageInEstimating > 0 ? [{ v: stageInEstimating, l: "In estimating" }] : []),
                    { v: m.winRate != null ? `${m.winRate}%` : "—", l: "All-time win rate" },
                  ].map(s => (
                    <div key={s.l}>
                      <span style={{ fontFamily: "system-ui,'Segoe UI',sans-serif", fontSize: 22, fontWeight: 700, color: T.text, letterSpacing: "-0.02em", display: "block", lineHeight: 1 }}>{s.v}</span>
                      <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase", color: T.muted, display: "block", marginTop: 4 }}>{s.l}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── close-out watch — right of open bids when stage data exists ── */}
            <section style={{
              gridColumn: stageData.length > 0 ? "span 5" : "span 12",
              background: T.cardBg,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              padding: "22px 24px 20px",
              display: "flex", flexDirection: "column",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: T.green, marginBottom: 5 }}>
                    Projects · Snapshot
                  </div>
                  <h2 style={{ fontFamily: "system-ui,'Segoe UI',sans-serif", fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", margin: 0, color: T.text }}>
                    Close-out watch
                  </h2>
                  <p style={{ fontSize: 12, color: T.muted, margin: "4px 0 0", lineHeight: 1.5 }}>
                    Projects with a close-out date on the calendar, plotted against the next 120 days.
                  </p>
                </div>
                <span style={{
                  fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.16em", textTransform: "uppercase",
                  color: T.muted, border: `1px solid ${T.border}`, borderRadius: 2, padding: "3px 8px", flexShrink: 0,
                }}>
                  All time
                </span>
              </div>

              <CloseoutTimeline
                projects={closeoutProjects}
                green={T.green}
                border={isDark ? "rgba(220,227,218,.12)" : "#DDE3D9"}
                text={T.text}
                muted={T.muted}
              />

              {closeoutPast === 0 && (
                <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: T.green, marginTop: 6 }}>
                  Nothing past its close-out date
                </div>
              )}

              <div style={{
                display: "flex", gap: 28, marginTop: 14,
                paddingTop: 14, borderTop: `1px solid ${T.borderSoft}`,
              }}>
                {[
                  { key: "withDate" as const, v: closeoutWithDate, l: "With close-out date" },
                  { key: "past" as const,     v: closeoutPast,     l: "Past date, still open", warn: closeoutPast > 0 },
                ].map(s => (
                  <button
                    key={s.l}
                    type="button"
                    onClick={() => setStageDrawer(closeoutMetricCards[s.key])}
                    aria-label={`Show ${s.l.toLowerCase()} projects (${s.v})`}
                    style={{
                      appearance: "none", border: 0, padding: 0, margin: 0, background: "transparent",
                      textAlign: "left", cursor: "pointer", color: "inherit", borderRadius: 3,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = "0.72"; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
                  >
                    <span style={{ fontFamily: "system-ui,'Segoe UI',sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", display: "block", lineHeight: 1, color: ("warn" in s && s.warn) ? "#D97706" : T.text }}>{s.v}</span>
                    <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase", color: T.muted, display: "block", marginTop: 4 }}>{s.l}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* ── decided bids — 5 cols (or full width when no stage data) ── */}
            <section style={{
              gridColumn: stageData.length > 0 ? "span 5" : "span 12",
              background: T.cardBg,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              padding: "22px 24px 20px",
              display: "flex", flexDirection: "column",
            }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: T.green, marginBottom: 5 }}>
                  Opportunities · {periodLabel}
                </div>
                <h2 style={{ fontFamily: "system-ui,'Segoe UI',sans-serif", fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", margin: 0, color: T.text }}>
                  Decided bids
                </h2>
                <p style={{ fontSize: 12, color: T.muted, margin: "4px 0 0", lineHeight: 1.5 }}>
                  {decidedTotal > 0
                    ? <>Won above the line, lost below. <strong style={{ color: T.text, fontWeight: 600 }}>{decidedTotal}</strong> bid{decidedTotal === 1 ? "" : "s"} decided.</>
                    : "No bids were decided in this period."}
                </p>
              </div>

              <DecidedChart
                buckets={decidedBuckets}
                green={T.green}
                lost={T.lostBar}
                muted={T.muted}
                border={T.border}
                onBarClick={month => {
                  if (!m) return;
                  const bids = m.decidedOpps.filter(o =>
                    o.decidedDate &&
                    new Date(o.decidedDate) >= range.start &&
                    new Date(o.decidedDate) <= range.end &&
                    new Date(o.decidedDate).toLocaleDateString("en-US", { month: "short" }) === month
                  );
                  setBidPopup({ month, won: bids.filter(o => o.won), lost: bids.filter(o => !o.won) });
                }}
              />

              <div style={{
                display: "flex", gap: 28, marginTop: "auto",
                paddingTop: 16, borderTop: `1px solid ${T.borderSoft}`,
              }}>
                {[
                  { v: totalWon, l: "Won", accent: T.green },
                  { v: totalLost, l: "Lost", accent: T.muted },
                  ...(winRate != null ? [{ v: `${winRate}%`, l: "Win rate", accent: T.text }] : []),
                ].map(s => (
                  <div key={s.l}>
                    <span style={{ fontFamily: "system-ui,'Segoe UI',sans-serif", fontSize: 22, fontWeight: 700, color: s.accent, letterSpacing: "-0.02em", display: "block", lineHeight: 1 }}>{s.v}</span>
                    <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase", color: T.muted, display: "block", marginTop: 4 }}>{s.l}</span>
                  </div>
                ))}
              </div>
            </section>

          </div>
        </>
      )}

      {/* ── stage drill drawer (portal) ── */}
      {stageDrawer && createPortal(
        <DataDrawer card={stageDrawer} onClose={() => setStageDrawer(null)} />,
        document.body
      )}

      {/* ── decided bids month popup ── */}
      {bidPopup && (
        <BidMonthPopup
          state={bidPopup}
          onClose={() => setBidPopup(null)}
          onNavigate={ticket => { setBidPopup(null); navigate(`/project/${encodeURIComponent(ticket)}`); }}
          T={T}
          MONO={MONO}
        />
      )}
    </MissionWorld>
  );
}

/* ══════════════════ module page (unchanged) ══════════════════ */

function ReportsHeader({ title, backTo, m, error, right }: {
  title: string;
  backTo?: { href: string; label: string };
  m: ReportModel | null;
  error: string | null;
  right?: React.ReactNode;
}) {
  const mc = useMC();
  const sourcesOk = !m?.sources || m.sources.records;
  return (
    <ModuleHeader
      title={title}
      section="Reports"
      icon={FileText}
      backTo={backTo}
      actions={right}
      status={m && !error && sourcesOk ? (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px",
              borderRadius: 999, fontSize: 11, fontWeight: 500,
              background: "rgba(132,204,22,0.1)", border: "1px solid rgba(132,204,22,0.3)", color: mc.good,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: mc.good, boxShadow: "0 0 6px rgba(132,204,22,0.9)" }} />
              Live · as of {new Date(m.generatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
      ) : m && (error || !sourcesOk) ? (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px",
              borderRadius: 999, fontSize: 11, fontWeight: 500,
              background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.35)", color: mc.warn,
            }}>
              <AlertTriangle size={12} />
              {error ? "Couldn't refresh — showing earlier numbers" : "Partial data — some sources didn't load"}
            </span>
      ) : undefined}
      style={{ marginBottom: 16, color: mc.text }}
    />
  );
}

const CHART_MIN = 380;

function ChartViz({ chart, onDrill }: { chart: ReportChart; onDrill: (card: CardModel) => void }) {
  const click = (chart.filterField && chart.card)
    ? (label: string) => {
        const filtered = filterCardByField(chart.card!, chart.filterField as string, label);
        if (filtered) onDrill(filtered);
      }
    : undefined;
  const viz = chart.viz;
  if (viz.kind === "columns") {
    return (
      <MissionColumns
        data={viz.data}
        xKey="x"
        yKey="y"
        color={viz.color}
        yFmt={v => int(v)}
        {...(click ? { onBarClick: (row: Record<string, unknown>) => {
          if (Number(row.y ?? 0) === 0) return; // no data behind an empty bar
          click(String(row.x ?? ""));
        }} : {})}
      />
    );
  }
  if (viz.kind === "donut") {
    /* MissionDonut now supports slice + legend clicks directly (with
     * stopPropagation so the clickable CardShell never overwrites the
     * filtered drawer) — no separate pill buttons needed. */
    return (
      <MissionDonut
        segments={viz.segments}
        total={viz.total}
        centerLabel={viz.centerLabel}
        {...(click ? { onSegmentClick: (seg: { label: string }) => click(seg.label) } : {})}
      />
    );
  }
  return (
    <MissionHorizBars
      rows={viz.rows}
      color={viz.color}
      {...(click ? { onBarClick: (row: { label: string; filterValue?: string }) => click(row.filterValue ?? row.label) } : {})}
    />
  );
}

/* ── export helpers ──────────────────────────────────────────────────────── */
async function exportReportExcel(
  report: ModuleReport,
  title: string,
  extraCards: { name: string; card: CardModel }[] = [],
  chartCards: { name: string; card: CardModel }[] = report.charts.map(chart => ({ name: chart.title, card: chart.card })),
) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "RM ONE";
  wb.created = new Date();

  // Summary tab — hero KPI + all stat cards
  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ width: 36 }, { width: 22 }];
  sum.addRow([report.hero.label, report.hero.value]);
  sum.getRow(1).font = { bold: true, size: 13 };
  sum.addRow([]);
  for (const k of report.kpis) sum.addRow([k.label, k.value]);

  // One data tab per card that has rows (hero card first, then chart cards)
  const allCards: { name: string; card: CardModel }[] = [];
  if (report.hero.card) allCards.push({ name: "Data", card: report.hero.card });
  const seen = new Set<string>(["Data"]);
  for (const extra of extraCards) {
    const base = extra.name.slice(0, 28);
    let name = base; let n = 2;
    while (seen.has(name)) { name = `${base} ${n++}`; }
    seen.add(name);
    allCards.push({ name, card: extra.card });
  }
  for (const chart of chartCards) {
    const base = chart.name.slice(0, 28);
    let name = base; let n = 2;
    while (seen.has(name)) { name = `${base} ${n++}`; }
    seen.add(name);
    allCards.push({ name, card: chart.card });
  }
  for (const { name, card } of allCards) {
    const ws = wb.addWorksheet(name);
    ws.columns = card.columns.map(c => ({ header: c.label, key: c.key, width: c.width ?? 18 }));
    ws.getRow(1).font = { bold: true };
    for (const row of card.rows) {
      ws.addRow(card.columns.reduce<Record<string, string>>((acc, c) => {
        acc[c.key] = fmtCell(row[c.key], c);
        return acc;
      }, {}));
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })),
    download: `${title.toLowerCase().replace(/[\s/]+/g, "-")}-report.xlsx`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ReportModulePage({ module }: { module: string }) {
  const MC = useMC();
  const { m, loading, error } = useReportModel();
  const [drawer, setDrawer] = useState<CardModel | null>(null);
  const [period, setPeriod, range] = usePeriod();
  const orgDim: OrgDim = "division";

  const id = module as ReportModuleId;
  if (!(id in MODULE_BUILDERS)) return <Redirect to="/reports" />;

  const ledger = useModuleLedger(id, range);
  const recordsOk = !m?.sources || m.sources.records;
  const reportNow = new Date();
  const report: ModuleReport | null = m && recordsOk
    ? MODULE_BUILDERS[id](m, range, reportNow, ledger ?? undefined, orgDim)
    : null;
  const visibleCharts = report
    ? (id === "closeout" ? report.charts : report.charts.filter(chart => chart.wide))
    : [];

  return (
    <MissionWorld>
      <ReportsHeader
        title={`${REPORT_TITLES[id]} Report`}
        backTo={{ href: "/reports", label: "Reports" }}
        m={m}
        error={error}
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <PeriodPicker value={period} onChange={setPeriod} />
          </div>
        }
      />

      {loading && !m && <LoadingBlock />}
      {!loading && !m && <ErrorBlock text={error || "No report data is available right now."} />}
      {m && !recordsOk && (
        <ErrorBlock text="Lifecycle records didn't load, so this report can't be shown. Refresh to try again." />
      )}

      {report && (
        <>
          <Glass style={{ marginTop: 16, padding: "22px 28px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: MC.greenInk }}>
              {report.hero.label}
            </div>
            <div style={{ marginTop: 6 }}>
              {report.hero.card
                ? <DrillNumber value={report.hero.value} card={report.hero.card} onDrill={setDrawer} size={40} />
                : <span style={{ fontSize: 40, fontWeight: 800, color: MC.text }}>{report.hero.value}</span>}
            </div>
            <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600, lineHeight: 1.55, maxWidth: 720, color: MC.muted }}>
              {report.hero.explain}
            </div>
          </Glass>

          <div style={{ marginTop: 16, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            {report.kpis.map(k => (
              <StatCard key={k.label} label={k.label} value={k.value} card={k.card} onDrill={setDrawer} />
            ))}
          </div>

          <div style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: `repeat(auto-fit, minmax(${CHART_MIN}px, 1fr))` }}>
            {visibleCharts.map(chart => (
              <CardShell
                key={chart.title}
                title={chart.title}
                takeaway={chart.takeaway}
                card={chart.card}
                onDrill={setDrawer}
                style={chart.wide ? { gridColumn: "1 / -1" } : undefined}
              >
                <ChartViz chart={chart} onDrill={setDrawer} />
              </CardShell>
            ))}
          </div>

          {id !== "closeout" && m && (
            <ReportAnalyticsCards
              module={id}
              model={m}
              range={range}
              orgDim={orgDim}
              period={period}
              onPeriodChange={setPeriod}
              onDrill={setDrawer}
            />
          )}

          {report.notes.length > 0 && (
            <Glass style={{ marginTop: 16, padding: "14px 20px" }}>
              {report.notes.map(n => (
                <div key={n} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11.5, lineHeight: 1.55, color: MC.muted, padding: "3px 0" }}>
                  <Info size={13} style={{ flexShrink: 0, marginTop: 2, color: MC.warn }} />
                  {n}
                </div>
              ))}
            </Glass>
          )}

        </>
      )}

      <DataDrawer card={drawer} onClose={() => setDrawer(null)} />
    </MissionWorld>
  );
}
