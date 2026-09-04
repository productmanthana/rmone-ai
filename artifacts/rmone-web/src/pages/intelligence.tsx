import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, ArrowRight, FileText, FileSpreadsheet, Loader2,
  TrendingUp, Users, FolderOpen, BarChart3, Briefcase,
  CheckCircle2, AlertTriangle, AlertCircle, Zap, Building2, Download, X,
  ChevronsRight,
} from "lucide-react";
import {
  peekReportModel, loadReportModel, fmtMoney, fmtDateShort, type ReportModel,
} from "@/lib/reportData";
import { REPORT_TITLES, type ReportKey } from "@/lib/exportPdf";
import { PALETTE, SERIES } from "@/components/charts/ExecCharts";
import { Z } from "@/lib/zLayers";

/* ─────────────────────────────────────────────────────────────
 * Reports — the executive report center. Live operational
 * briefing (real data only) plus five board-ready reports, each
 * downloadable as PDF (with charts) or Excel (full data).
 * ──────────────────────────────────────────────────────────── */

const G = PALETTE.green;
const BL = PALETTE.blue;
const OR = PALETTE.orange;
const AM = PALETTE.amber;
const PU = PALETTE.purple;
const TE = PALETTE.teal;

/* ── executive insight engine (proven narrative logic) ── */
type InsightStatus = "healthy" | "warning" | "critical";
type AIInsight = {
  status: InsightStatus; statusLabel: string; headline: string; action: string;
  stats: { value: string; label: string }[];
  gauge: { pct: number | null; label: string };
};

const fmtCount = (n: number) => n.toLocaleString("en-US");

function computeInsight(domain: "pipeline" | "workforce" | "project" | "financial", m: ReportModel): AIInsight {
  if (domain === "pipeline") {
    const wr = m.winRate;
    const bidVal = m.pipelineValue > 0 ? fmtMoney(m.pipelineValue) : null;
    const status: InsightStatus = wr !== null && wr < 30 ? "critical" : m.activeBids < 3 ? "warning" : "healthy";
    return {
      status,
      statusLabel: status === "healthy" ? "Active Pipeline" : status === "warning" ? "Low Activity" : "Win Rate Risk",
      headline: `${m.activeBids} active bid${m.activeBids !== 1 ? "s" : ""}${bidVal ? ` worth ${bidVal}` : ""} · ${m.leadCount} early-stage lead${m.leadCount !== 1 ? "s" : ""}${wr !== null ? ` · winning ${wr}% of decided bids` : ""}.`,
      action: m.activeBids > 0
        ? `Update decision dates and next-action owners on all ${m.activeBids} active bid${m.activeBids !== 1 ? "s" : ""}.`
        : "Start logging new leads and bids to give leadership pipeline visibility.",
      stats: [
        { value: fmtCount(m.activeBids), label: "open proposals" },
        ...(m.pipelineValue > 0 ? [{ value: fmtMoney(m.pipelineValue), label: "proposal value" }] : []),
        { value: fmtCount(m.leadCount), label: "leads" },
      ],
      gauge: { pct: wr, label: "% won" },
    };
  }
  if (domain === "workforce") {
    const status: InsightStatus = m.openDemands > m.totalStaff * 0.3 ? "critical"
      : m.overAllocCount > 5 || m.openDemands > 20 ? "warning" : "healthy";
    return {
      status,
      statusLabel: status === "healthy" ? "Balanced Team" : status === "warning" ? "Staffing Gaps" : "Capacity Risk",
      headline: `${m.totalStaff} staff · ${m.benchCount} available · ${m.overAllocCount} overloaded · ${m.openDemands} unfilled position${m.openDemands !== 1 ? "s" : ""}.`,
      action: m.openDemands > 0
        ? `Match ${Math.min(m.openDemands, m.benchCount)} of your ${m.benchCount} available staff to the ${m.openDemands} unfilled position${m.openDemands !== 1 ? "s" : ""}.`
        : m.overAllocCount > 0
          ? `Rebalance workload for the ${m.overAllocCount} overloaded team member${m.overAllocCount !== 1 ? "s" : ""}.`
          : "Review upcoming project starts and pre-assign available staff.",
      stats: [
        { value: fmtCount(m.totalStaff), label: "staff" },
        { value: fmtCount(m.benchCount), label: "available" },
        { value: fmtCount(m.openDemands), label: "open roles" },
      ],
      gauge: { pct: m.deployedRate, label: "assigned" },
    };
  }
  if (domain === "project") {
    const overdueRate = m.activeProjects > 0 ? Math.round((m.overdueCount / m.activeProjects) * 100) : 0;
    const status: InsightStatus = overdueRate > 50 ? "critical"
      : overdueRate > 25 || m.noDateCount > m.activeProjects * 0.3 ? "warning" : "healthy";
    return {
      status,
      statusLabel: status === "healthy" ? "On Track" : status === "warning" ? "Schedule Risk" : "Portfolio Risk",
      headline: `${m.activeProjects} active project${m.activeProjects !== 1 ? "s" : ""} · ${m.onTimeRate ?? 0}% on schedule · ${m.overdueCount} overdue · ${m.noDateCount} without end dates.`,
      action: m.noDateCount > 0
        ? `Set end dates on the ${m.noDateCount} undated project${m.noDateCount !== 1 ? "s" : ""}, then review the top overdue ones.`
        : m.overdueCount > 0
          ? `Hold a recovery review on the ${m.overdueCount} overdue project${m.overdueCount !== 1 ? "s" : ""}.`
          : "Maintain momentum: confirm milestone dates are current across all active projects.",
      stats: [
        { value: fmtCount(m.activeProjects), label: "active" },
        { value: fmtCount(m.overdueCount), label: "overdue" },
        { value: fmtCount(m.noDateCount), label: "no end date" },
      ],
      gauge: { pct: m.onTimeRate, label: "on time" },
    };
  }
  const overBudget = m.totalForecastCost > m.backlogValue && m.backlogValue > 0;
  const status: InsightStatus = overBudget ? "critical" : m.marginRiskCount > 5 ? "warning" : "healthy";
  return {
    status,
    statusLabel: status === "healthy" ? "Financials Solid" : status === "warning" ? "Margin Pressure" : "Budget Risk",
    headline: `${fmtMoney(m.backlogValue)} contracted backlog · ${m.totalForecastCost > 0 ? fmtMoney(m.totalForecastCost) + " labor forecast" : "no labor forecast on file"} · ${m.marginRiskCount} margin-risk project${m.marginRiskCount !== 1 ? "s" : ""}.`,
    action: overBudget
      ? "Audit the largest-cost projects for scope creep — forecast is running above contract value."
      : m.marginRiskCount > 0
        ? `Review the ${m.marginRiskCount} overdue project${m.marginRiskCount !== 1 ? "s" : ""} carrying contract value before month-end.`
        : "Ensure all active projects have forecast costs entered to maintain financial visibility.",
    stats: [
      { value: fmtMoney(m.backlogValue), label: "contracted work" },
      { value: fmtMoney(m.totalForecastCost), label: "est. labour cost" },
      { value: fmtCount(m.marginRiskCount), label: "cost risk" },
    ],
    gauge: {
      pct: m.backlogValue > 0 && m.totalForecastCost > 0
        ? Math.round((m.totalForecastCost / m.backlogValue) * 100)
        : null,
      label: "cost ratio",
    },
  };
}

type PriorityKey = "demand" | "overdue" | "noDate" | "overloaded" | "bids" | "overBudget" | "concentration";
type PriorityItem = {
  severity: number; color: string; icon: React.ElementType;
  metric: string; metricLabel: string; text: string; detail: PriorityKey;
};
function computePriorities(m: ReportModel): PriorityItem[] {
  const items: PriorityItem[] = [];
  if (m.openDemands > 0)
    items.push({ severity: 3, color: OR, icon: AlertCircle, metric: fmtCount(m.openDemands), metricLabel: `unfilled role${m.openDemands !== 1 ? "s" : ""}`, detail: "demand", text: `Assign available staff today to prevent project delays.` });
  if (m.overdueCount > 0)
    items.push({ severity: 2, color: OR, icon: AlertTriangle, metric: fmtCount(m.overdueCount), metricLabel: `overdue project${m.overdueCount !== 1 ? "s" : ""}`, detail: "overdue", text: `Recovery plans needed — schedule PM review calls this week.` });
  if (m.noDateCount > 0)
    items.push({ severity: 2, color: AM, icon: AlertTriangle, metric: fmtCount(m.noDateCount), metricLabel: `project${m.noDateCount !== 1 ? "s" : ""} without a finish date`, detail: "noDate", text: `Add finish dates so schedule risk stays visible.` });
  if (m.overAllocCount > 0)
    items.push({ severity: 1, color: AM, icon: AlertTriangle, metric: fmtCount(m.overAllocCount), metricLabel: `over-scheduled team member${m.overAllocCount !== 1 ? "s" : ""}`, detail: "overloaded", text: `Redistribute hours before burnout affects quality.` });
  if (m.activeBids > 0)
    items.push({ severity: 1, color: G, icon: TrendingUp, metric: fmtCount(m.activeBids), metricLabel: `open proposal${m.activeBids !== 1 ? "s" : ""}${m.pipelineValue > 0 ? ` · ${fmtMoney(m.pipelineValue)}` : ""}`, detail: "bids", text: `Confirm next steps and decision dates with BDs.` });
  if (m.totalForecastCost > m.backlogValue && m.backlogValue > 0)
    items.push({ severity: 3, color: OR, icon: AlertCircle, metric: fmtMoney(m.totalForecastCost), metricLabel: "labour cost over contract", detail: "overBudget", text: `Audit project budgets for scope creep — estimated cost exceeds contract value.` });
  const top = m.clientConcentration[0];
  if (top && top.share >= 30)
    items.push({ severity: 2, color: AM, icon: AlertTriangle, metric: `${top.share}%`, metricLabel: `contracted work with ${top.label}`, detail: "concentration", text: `Too much work with one client — worth planning for more variety.` });
  return items.sort((a, b) => b.severity - a.severity).slice(0, 4);
}

const URGENCY: Record<number, { label: string; color: string }> = {
  3: { label: "Act now", color: OR },
  2: { label: "This week", color: AM },
  1: { label: "Monitor", color: G },
};

/* ── status badge ── */
function StatusBadge({ status }: { status: InsightStatus }) {
  const cfg = {
    healthy: { color: G, label: "Healthy", Icon: CheckCircle2 },
    warning: { color: AM, label: "Attention", Icon: AlertTriangle },
    critical: { color: OR, label: "Critical", Icon: AlertCircle },
  }[status];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 8px", borderRadius: 20, flexShrink: 0,
      background: cfg.color + "16", border: `1px solid ${cfg.color}38`,
      fontSize: 10, fontWeight: 700, color: cfg.color,
    }}>
      <cfg.Icon size={10} />
      {cfg.label}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Mini visualization kit — compact, real-data-only charts that
 * give each report card a live visual identity. Every component
 * renders nothing when its data is empty (no fabricated values).
 * ──────────────────────────────────────────────────────────── */
const NUMS: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

/* circular firm-health gauge (header) */
function RingGauge({ value, color, size = 68 }: { value: number; color: string; size?: number }) {
  const sw = 6.5;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, value / 100));
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--rm-panel-border)" strokeWidth={sw} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          style={{ transition: "stroke-dasharray 0.9s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <span style={{ fontSize: 19, fontWeight: 900, color, lineHeight: 1, ...NUMS }}>{value}</span>
        <span style={{ fontSize: 7.5, fontWeight: 700, color: "var(--rm-text-faint)", letterSpacing: "0.06em" }}>/100</span>
      </div>
    </div>
  );
}

/* tiny per-row ring gauge (operational status rows) */
function MiniRing({ pct, label, color, size = 40 }: { pct: number | null; label: string; color: string; size?: number }) {
  const sw = 4.5;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const frac = pct == null ? 0 : Math.max(0, Math.min(1, pct / 100));
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, flexShrink: 0, width: 56 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--rm-panel-border)" strokeWidth={sw} />
          {pct != null && (
            <circle
              cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={color} strokeWidth={sw} strokeLinecap="round"
              strokeDasharray={`${c * frac} ${c}`}
              style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.22,1,0.36,1)" }}
            />
          )}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <span style={{ fontSize: pct != null && pct >= 100 ? 9 : 10.5, fontWeight: 850, color: pct != null ? "var(--rm-text)" : "var(--rm-text-faint)", ...NUMS }}>
            {pct != null ? `${pct}%` : "—"}
          </span>
        </div>
      </div>
      <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--rm-text-faint)", whiteSpace: "nowrap" }}>
        {label}
      </span>
    </div>
  );
}

/* ── in-page detail popup (no navigation away from Reports) ── */
function DetailModal({ accent, category, title, subtitle, onClose, children }: {
  accent: string; category: string; title: string; subtitle?: string;
  onClose: () => void; children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: Z.MODAL,
        background: "rgba(8,12,10,0.55)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(780px, 100%)", maxHeight: "86vh", overflowY: "auto",
          borderRadius: 18, background: "var(--rm-panel)",
          border: "1px solid var(--rm-panel-border)",
          boxShadow: "0 28px 70px -28px rgba(0,0,0,0.55)",
          position: "relative",
        }}
      >
        <span style={{
          position: "sticky", top: 0, display: "block", height: 3, zIndex: 2,
          background: `linear-gradient(90deg, ${accent}, ${accent}30)`,
        }} />
        <div style={{ padding: "18px 22px 22px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: accent, marginBottom: 3 }}>
                {category}
              </div>
              <div style={{ fontSize: 18, fontWeight: 850, color: "var(--rm-text)", letterSpacing: "-0.015em", lineHeight: 1.2 }}>
                {title}
              </div>
              {subtitle && (
                <div style={{ fontSize: 11.5, color: "var(--rm-text-muted)", marginTop: 4, lineHeight: 1.5 }}>
                  {subtitle}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 30, height: 30, borderRadius: 9, flexShrink: 0, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "var(--rm-panel-soft)", border: "1px solid var(--rm-panel-border)",
                color: "var(--rm-text-muted)",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--rm-text)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--rm-text-muted)"; }}
            >
              <X size={15} />
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/* generic record table for popup drill-downs */
function DataTable({ columns, rows, note, align }: {
  columns: string[]; rows: React.ReactNode[][]; note?: string;
  align?: ("left" | "right")[];
}) {
  if (!rows.length) return <VizEmpty text="No matching records right now." />;
  return (
    <div>
      <div style={{ border: "1px solid var(--rm-panel-border)", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ background: "var(--rm-panel-soft)" }}>
              {columns.map((c, i) => (
                <th key={c} style={{
                  padding: "8px 12px", textAlign: align?.[i] ?? "left",
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase",
                  color: "var(--rm-text-faint)", whiteSpace: "nowrap",
                }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} style={{ borderTop: "1px solid var(--rm-panel-border)" }}>
                {r.map((cell, ci) => (
                  <td key={ci} style={{
                    padding: "7px 12px", textAlign: align?.[ci] ?? "left",
                    color: ci === 0 ? "var(--rm-text)" : "var(--rm-text-muted)",
                    fontWeight: ci === 0 ? 650 : 500,
                    maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    ...(align?.[ci] === "right" ? NUMS : {}),
                  }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && (
        <div style={{ fontSize: 10, color: "var(--rm-text-faint)", marginTop: 7 }}>{note}</div>
      )}
    </div>
  );
}

/* labeled wrapper for a card's chart block */
function CardViz({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      borderRadius: 11, padding: "10px 12px 11px",
      background: "var(--rm-panel-soft)", border: "1px solid var(--rm-panel-border)",
    }}>
      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--rm-text-faint)", marginBottom: 8 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

/* segmented composition bar + legend (shares of a whole) */
function SegBar({ segments, fmt }: {
  segments: { label: string; value: number; color: string }[];
  fmt: (v: number) => string;
}) {
  const data = segments.filter(s => s.value > 0);
  const total = data.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return null;
  return (
    <div>
      <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", gap: 2, marginBottom: 9 }}>
        {data.map((s, i) => (
          <div key={i} title={`${s.label} · ${fmt(s.value)}`} style={{
            width: `${(s.value / total) * 100}%`, minWidth: 5,
            background: `linear-gradient(180deg, ${s.color}, ${s.color}CC)`, borderRadius: 3,
          }} />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {data.slice(0, 3).map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: 3, flexShrink: 0, background: s.color }} />
            <span style={{ fontSize: 10.5, color: "var(--rm-text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
            <span style={{ fontSize: 10.5, fontWeight: 750, color: "var(--rm-text)", flexShrink: 0, ...NUMS }}>
              {Math.round((s.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* compact funnel — stage bars with counts inside */
function MiniFunnel({ stages, fmt }: {
  stages: { label: string; count: number; value: number }[];
  fmt: (v: number) => string;
}) {
  const rows = stages.filter(s => s.count > 0).slice(0, 4);
  if (!rows.length) return null;
  const max = Math.max(...rows.map(r => r.count), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((s, i) => {
        const color = SERIES[i % SERIES.length];
        return (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 78, flexShrink: 0, fontSize: 9.5, fontWeight: 700, color: "var(--rm-text-muted)", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.label}
            </span>
            <div style={{ flex: 1, height: 17, borderRadius: 5, background: "var(--rm-panel-border)", overflow: "hidden" }}>
              <div style={{
                width: `${Math.max((s.count / max) * 100, 9)}%`, height: "100%", borderRadius: 5,
                background: `linear-gradient(90deg, ${color}B8, ${color})`,
                display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 6, minWidth: 24,
              }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: "#FFFFFF", ...NUMS }}>{s.count}</span>
              </div>
            </div>
            <span style={{ width: 46, flexShrink: 0, fontSize: 9.5, fontWeight: 700, color: "var(--rm-text-muted)", ...NUMS }}>
              {s.value > 0 ? fmt(s.value) : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* small SVG donut + legend */
function MiniDonut({ slices, center, sub, size = 92 }: {
  slices: { label: string; value: number; color: string }[];
  center: string; sub?: string; size?: number;
}) {
  const data = slices.filter(s => s.value > 0);
  const total = data.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return null;
  const sw = 11;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const segs = data.map(s => {
    const frac = s.value / total;
    const seg = { ...s, frac, offset: acc };
    acc += frac;
    return seg;
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          {segs.map((s, i) => (
            <circle
              key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={s.color} strokeWidth={sw}
              strokeDasharray={`${Math.max(c * s.frac - 2, 0.5)} ${c}`}
              strokeDashoffset={-c * s.offset}
            />
          ))}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <span style={{ fontSize: 15, fontWeight: 900, color: "var(--rm-text)", lineHeight: 1, letterSpacing: "-0.02em", ...NUMS }}>{center}</span>
          {sub && <span style={{ fontSize: 7.5, fontWeight: 700, color: "var(--rm-text-faint)", marginTop: 2, letterSpacing: "0.04em", textTransform: "uppercase" }}>{sub}</span>}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 0 }}>
        {data.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: 3, flexShrink: 0, background: s.color }} />
            <span style={{ fontSize: 10.5, color: "var(--rm-text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
            <span style={{ fontSize: 10.5, fontWeight: 750, color: "var(--rm-text)", flexShrink: 0, ...NUMS }}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* tiny column chart (distribution across bands) */
function MiniCols({ data }: { data: { label: string; count: number; color: string }[] }) {
  if (!data.length || data.every(d => d.count === 0)) return null;
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 86 }}>
      {data.map(d => (
        <div key={d.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, height: "100%", justifyContent: "flex-end", minWidth: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: "var(--rm-text)", ...NUMS }}>{d.count}</span>
          <div style={{
            width: "100%", maxWidth: 34, borderRadius: "5px 5px 2px 2px",
            height: `${Math.max((d.count / max) * 52, d.count > 0 ? 4 : 2)}px`,
            background: d.count > 0 ? `linear-gradient(180deg, ${d.color}, ${d.color}B8)` : "var(--rm-panel-border)",
          }} />
          <span style={{ fontSize: 8, fontWeight: 700, color: "var(--rm-text-faint)", textTransform: "uppercase", letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ranked horizontal share bars (concentration) */
function MiniHBars({ rows }: { rows: { label: string; pct: number; sub?: string; color: string }[] }) {
  const data = rows.filter(r => r.pct > 0);
  if (!data.length) return null;
  const max = Math.max(...data.map(r => r.pct), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {data.map((r, i) => (
        <div key={i}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3, gap: 8 }}>
            <span style={{ fontSize: 10.5, fontWeight: 650, color: "var(--rm-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--rm-text)", flexShrink: 0, ...NUMS }}>
              {r.pct}%{r.sub && <span style={{ fontWeight: 500, color: "var(--rm-text-muted)", marginLeft: 5 }}>{r.sub}</span>}
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "var(--rm-panel-border)", overflow: "hidden" }}>
            <div style={{ width: `${(r.pct / max) * 100}%`, height: "100%", borderRadius: 3, background: `linear-gradient(90deg, ${r.color}B8, ${r.color})` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* muted placeholder when a card has no chart data yet */
function VizEmpty({ text }: { text: string }) {
  return (
    <div style={{
      padding: "16px 12px", textAlign: "center", fontSize: 10.5, color: "var(--rm-text-faint)",
      background: "var(--rm-panel-soft)", borderRadius: 11, border: "1px dashed var(--rm-panel-border)",
    }}>{text}</div>
  );
}

/* ── report catalog metadata ── */
type ReportMeta = {
  key: ReportKey;
  icon: React.ElementType;
  color: string;
  category: string;
  description: string;
  stats: (m: ReportModel) => { label: string; value: string }[];
  visual: (m: ReportModel) => React.ReactNode;
};

const BAND_COLORS: Record<string, string> = {
  Available: TE, Light: BL, Normal: G, Full: AM, Overloaded: OR,
};

const REPORTS: ReportMeta[] = [
  {
    key: "executive", icon: Briefcase, color: G, category: "Leadership Summary",
    description: "The one-page story of the firm: contracted work, proposals, win rate, active projects and team — with charts and the clients leadership should know by name.",
    stats: m => [
      { label: "Contracted Work", value: fmtMoney(m.backlogValue) },
      { label: "Expected Win Value", value: fmtMoney(m.weightedPipeline) },
      { label: "% of Bids Won", value: m.winRate != null ? `${m.winRate}%` : "—" },
    ],
    visual: m => {
      const top = m.backlogBySector.slice(0, 4);
      const rest = m.backlogBySector.slice(4).reduce((s, r) => s + r.value, 0);
      const segs = [
        ...top.map((r, i) => ({ label: r.label, value: r.value, color: SERIES[i % SERIES.length] })),
        ...(rest > 0 ? [{ label: "Other", value: rest, color: PALETTE.slate }] : []),
      ];
      if (!segs.some(s => s.value > 0)) return null;
      return (
        <CardViz label="Work by Industry">
          <SegBar segments={segs} fmt={fmtMoney} />
        </CardViz>
      );
    },
  },
  {
    key: "pipeline", icon: TrendingUp, color: BL, category: "Business Growth",
    description: "Every open proposal with value, probability and bid dates, win/loss performance by sector, and the early-stage lead book.",
    stats: m => [
      { label: "Open Proposals", value: String(m.activeBids) },
      { label: "Proposal Value", value: fmtMoney(m.pipelineValue) },
      { label: "Won This Year", value: fmtMoney(m.wonValue) },
    ],
    visual: m => {
      if (!m.funnel.some(s => s.count > 0)) return null;
      return (
        <CardViz label="Sales Funnel">
          <MiniFunnel stages={m.funnel} fmt={fmtMoney} />
        </CardViz>
      );
    },
  },
  {
    key: "portfolio", icon: FolderOpen, color: PU, category: "Delivery",
    description: "The full active project register with schedule health, backlog by division, and size distribution — who is late, who is untracked, and where the value sits.",
    stats: m => [
      { label: "Active Projects", value: String(m.activeProjects) },
      { label: "On Schedule", value: m.onTimeRate != null ? `${m.onTimeRate}%` : "—" },
      { label: "Overdue", value: String(m.overdueCount) },
    ],
    visual: m => {
      const { onSchedule, overdue, noDate } = m.scheduleHealth;
      if (onSchedule + overdue + noDate === 0) return null;
      return (
        <CardViz label="Schedule Health">
          <MiniDonut
            slices={[
              { label: "On schedule", value: onSchedule, color: G },
              { label: "Overdue", value: overdue, color: OR },
              { label: "No end date", value: noDate, color: PALETTE.slate },
            ]}
            center={m.onTimeRate != null ? `${m.onTimeRate}%` : String(m.activeProjects)}
            sub={m.onTimeRate != null ? "on time" : "projects"}
          />
        </CardViz>
      );
    },
  },
  {
    key: "workforce", icon: Users, color: TE, category: "People",
    description: "How loaded the team is, who is available versus over-scheduled, and every open role that could delay a project start.",
    stats: m => [
      { label: "Staff", value: String(m.totalStaff) },
      { label: "Assigned", value: m.deployedRate != null ? `${m.deployedRate}%` : "—" },
      { label: "Open Roles", value: String(m.openDemands) },
    ],
    visual: m => {
      const BAND_DISPLAY: Record<string, string> = {
        Available: "Available", Light: "Low Usage", Normal: "Normal",
        Full: "At Capacity", Overloaded: "Over-scheduled",
      };
      const bands = m.utilizationBands.map(b => ({
        ...b, label: BAND_DISPLAY[b.label] ?? b.label, color: BAND_COLORS[b.label] ?? TE,
      }));
      if (bands.every(b => b.count === 0)) return null;
      return (
        <CardViz label="How the Team Is Loaded">
          <MiniCols data={bands} />
        </CardViz>
      );
    },
  },
  {
    key: "financial", icon: BarChart3, color: OR, category: "Finance",
    description: "Contract value versus estimated labour cost per project, which clients make up the most work, and projects carrying cost risk.",
    stats: m => [
      { label: "Contracted Work", value: fmtMoney(m.backlogValue) },
      { label: "Est. Labour Cost", value: fmtMoney(m.totalForecastCost) },
      { label: "Cost Risk", value: String(m.marginRiskCount) },
    ],
    visual: m => {
      const rows = m.clientConcentration.slice(0, 3).map((c, i) => ({
        label: c.label, pct: c.share, sub: fmtMoney(c.value),
        color: [OR, AM, PALETTE.slate][i] ?? PALETTE.slate,
      }));
      if (!rows.some(r => r.pct > 0)) return null;
      return (
        <CardViz label="Which Clients Represent the Most Work">
          <MiniHBars rows={rows} />
        </CardViz>
      );
    },
  },
  {
    key: "conversion", icon: ChevronsRight, color: AM, category: "Business Growth",
    description: "How work moves through the lifecycle — which leads became opportunities, which opportunities became projects, and the value carried at each hand-off.",
    stats: m => [
      { label: "Leads → Opps", value: String(m.conversion.leadsConverted) },
      { label: "Opps → Projects", value: String(m.conversion.oppsConverted) },
      { label: "Value of Won Work", value: fmtMoney(m.conversion.oppsConvertedValue) },
    ],
    visual: m => {
      const c = m.conversion;
      if (c.leadsConverted === 0 && c.oppsConverted === 0) return null;
      const rows = [
        { label: "Leads → Opportunities", pct: c.leadConversionRate ?? 0, sub: `${c.leadsConverted} of ${c.leadsTotal}`, color: AM },
        { label: "Opportunities → Projects", pct: c.oppConversionRate ?? 0, sub: `${c.oppsConverted} of ${c.oppsTotal}`, color: G },
      ];
      /* MiniHBars drops pct===0 rows — skip the card entirely if every rate rounds to 0% */
      if (!rows.some(r => r.pct > 0)) return null;
      return (
        <CardViz label="Conversion Rates">
          <MiniHBars rows={rows} />
        </CardViz>
      );
    },
  },
];

/* ── export state hook ── */
type ExportJob = `${"pdf" | "xlsx"}:${ReportKey | "all"}` | null;

function useExports(m: ReportModel | null) {
  const [busy, setBusy] = useState<ExportJob>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const run = async (job: Exclude<ExportJob, null>) => {
    if (!m || busy) return;
    setBusy(job);
    setErrorMsg(null);
    try {
      const [kind, key] = job.split(":") as ["pdf" | "xlsx", ReportKey | "all"];
      if (kind === "pdf") {
        const mod = await import("@/lib/exportPdf");
        if (key === "all") await mod.exportAllPdf(m);
        else await mod.exportReportPdf(m, key);
      } else {
        const mod = await import("@/lib/exportExcel");
        if (key === "all") await mod.exportAllExcel(m);
        else await mod.exportReportExcel(m, key);
      }
    } catch (e: any) {
      setErrorMsg(`Export failed: ${String(e?.message || e)}`);
    } finally {
      setBusy(null);
    }
  };
  return { busy, errorMsg, run };
}

/* ── small export button ── */
function ExportBtn({
  label, icon: Icon, onClick, loading, disabled, color,
}: {
  label: string; icon: React.ElementType; onClick: () => void;
  loading: boolean; disabled: boolean; color: string;
}) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "7px 12px", borderRadius: 9,
        background: loading ? color + "22" : "transparent",
        border: `1px solid ${color}45`,
        fontSize: 11, fontWeight: 700, color,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled && !loading ? 0.5 : 1,
        transition: "all 0.15s ease", whiteSpace: "nowrap",
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = color + "14"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = loading ? color + "22" : "transparent"; }}
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
      {label}
    </button>
  );
}

/* ── main page ── */
type ModalSpec =
  | { kind: "priority"; key: PriorityKey }
  | { kind: "domain"; key: "pipeline" | "project" | "workforce" | "financial" }
  | { kind: "report"; key: ReportKey };

export default function IntelligenceHubPage() {
  const [, setLocation] = useLocation();
  const initial = (() => { try { return peekReportModel(); } catch { return null; } })();
  const [m, setM] = useState<ReportModel | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const [modal, setModal] = useState<ModalSpec | null>(null);
  const { busy, errorMsg, run } = useExports(m);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const built = await loadReportModel();
        if (!cancelled && built) setM(built);
      } catch { /* keep whatever we have */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const insights = m ? ([
    { key: "pipeline" as const, label: "New Business", icon: TrendingUp, color: BL },
    { key: "project" as const, label: "Active Projects", icon: FolderOpen, color: PU },
    { key: "workforce" as const, label: "Team Capacity", icon: Users, color: TE },
    { key: "financial" as const, label: "Finances", icon: BarChart3, color: OR },
  ]).map(d => ({ ...d, insight: computeInsight(d.key, m) })) : [];

  const critCount = insights.filter(i => i.insight.status === "critical").length;
  const warnCount = insights.filter(i => i.insight.status === "warning").length;
  const score = m ? Math.max(0, 100 - critCount * 30 - warnCount * 12) : null;
  const scoreColor = score == null ? G : score >= 70 ? G : score >= 45 ? AM : OR;
  const priorities = m ? computePriorities(m) : [];

  /* ── popup content — every drill-down stays on this page, real data only ── */
  const renderModal = () => {
    if (!m || !modal) return null;
    const close = () => setModal(null);
    type Table = { columns: string[]; align?: ("left" | "right")[]; rows: React.ReactNode[][]; note?: string };
    const CAP = 20;
    const noteFor = (shown: number, total: number, noun: string) =>
      total > shown ? `Showing the top ${shown} of ${fmtCount(total)} ${noun}. Download the Excel report for the full list.` : undefined;
    const pctTxt = (v: number) => `${Math.round(v)}%`;

    const demandTable = (): Table => {
      const list = [...m.demands].sort((a, b) => (a.start ?? "9999") < (b.start ?? "9999") ? -1 : 1);
      return {
        columns: ["Project", "Role", "Starts", "Ends", "Load"],
        align: ["left", "left", "left", "left", "right"],
        rows: list.slice(0, CAP).map(d => [d.project, d.role, fmtDateShort(d.start), fmtDateShort(d.end), d.pct > 0 ? pctTxt(d.pct) : "—"]),
        note: noteFor(Math.min(CAP, list.length), list.length, "open positions"),
      };
    };
    const overdueTable = (): Table => {
      const list = m.projects.filter(p => p.overdue).sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0));
      return {
        columns: ["Project", "Client", "Target End", "Overdue", "Value"],
        align: ["left", "left", "left", "right", "right"],
        rows: list.slice(0, CAP).map(p => [p.name, p.client ?? "—", fmtDateShort(p.targetEnd), <span style={{ color: OR, fontWeight: 700 }}>{fmtCount(p.daysOverdue ?? 0)}d</span>, p.value > 0 ? fmtMoney(p.value) : "—"]),
        note: noteFor(Math.min(CAP, list.length), list.length, "overdue projects"),
      };
    };
    const noDateTable = (): Table => {
      const list = m.projects.filter(p => p.noDate);
      return {
        columns: ["Project", "Client", "Status", "Value"],
        align: ["left", "left", "left", "right"],
        rows: list.slice(0, CAP).map(p => [p.name, p.client ?? "—", p.status, p.value > 0 ? fmtMoney(p.value) : "—"]),
        note: noteFor(Math.min(CAP, list.length), list.length, "projects without end dates"),
      };
    };
    const staffTable = (onlyOverloaded: boolean): Table => {
      const base = onlyOverloaded ? m.staff.filter(s => s.band === "Overloaded") : m.staff;
      const list = [...base].sort((a, b) => b.utilization - a.utilization);
      return {
        columns: ["Name", "Role", "Projects", "Utilization"],
        align: ["left", "left", "right", "right"],
        rows: list.slice(0, CAP).map(s => [s.name, s.role ?? "—", fmtCount(s.activeProjects), <span style={{ color: s.band === "Overloaded" ? OR : "inherit", fontWeight: s.band === "Overloaded" ? 700 : 500 }}>{pctTxt(s.utilization)}</span>]),
        note: noteFor(Math.min(CAP, list.length), list.length, onlyOverloaded ? "overloaded staff" : "staff by utilization"),
      };
    };
    const oppTable = (): Table => ({
      columns: ["Pursuit", "Client", "Stage", "Bid Date", "Value"],
      align: ["left", "left", "left", "left", "right"],
      rows: m.opps.slice(0, CAP).map(o => [o.name, o.client ?? "—", o.stage, fmtDateShort(o.bidDate), o.value > 0 ? fmtMoney(o.value) : "—"]),
      note: noteFor(Math.min(CAP, m.opps.length), m.opps.length, "open pursuits"),
    });
    const budgetTable = (): Table => {
      const list = m.projects.filter(p => p.forecastCost > 0).sort((a, b) => (b.forecastCost - b.value) - (a.forecastCost - a.value));
      return {
        columns: ["Project", "Contract", "Est. Labour Cost", "Variance"],
        align: ["left", "right", "right", "right"],
        rows: list.slice(0, CAP).map(p => {
          const diff = p.forecastCost - p.value;
          return [p.name, p.value > 0 ? fmtMoney(p.value) : "—", fmtMoney(p.forecastCost),
            <span style={{ color: diff > 0 ? OR : G, fontWeight: 700 }}>{diff > 0 ? "+" : "−"}{fmtMoney(Math.abs(diff))}</span>];
        }),
        note: noteFor(Math.min(CAP, list.length), list.length, "projects with labor forecasts"),
      };
    };
    const concentrationTable = (): Table => ({
      columns: ["Client", "Projects", "Backlog", "Share"],
      align: ["left", "right", "right", "right"],
      rows: m.clientConcentration.map(c => [c.label, fmtCount(c.count), fmtMoney(c.value), `${c.share}%`]),
    });
    const portfolioTable = (): Table => {
      const list = [...m.projects].sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0));
      return {
        columns: ["Project", "Client", "Target End", "Schedule", "Value"],
        align: ["left", "left", "left", "left", "right"],
        rows: list.slice(0, CAP).map(p => [p.name, p.client ?? "—", fmtDateShort(p.targetEnd),
          p.overdue ? <span style={{ color: OR, fontWeight: 700 }}>{fmtCount(p.daysOverdue ?? 0)}d overdue</span>
            : p.noDate ? <span style={{ color: "var(--rm-text-faint)" }}>No end date</span>
            : <span style={{ color: G, fontWeight: 650 }}>On schedule</span>,
          p.value > 0 ? fmtMoney(p.value) : "—"]),
        note: noteFor(Math.min(CAP, list.length), list.length, "active projects"),
      };
    };
    const financialTable = (): Table => ({
      columns: ["Project", "Client", "Contract", "Est. Labour Cost"],
      align: ["left", "left", "right", "right"],
      rows: m.projects.slice(0, CAP).map(p => [p.name, p.client ?? "—", p.value > 0 ? fmtMoney(p.value) : "—", p.forecastCost > 0 ? fmtMoney(p.forecastCost) : "—"]),
      note: noteFor(Math.min(CAP, m.projects.length), m.projects.length, "active projects by value"),
    });
    const executiveTable = (): Table => ({
      columns: ["Project", "Client", "Sector", "Value"],
      align: ["left", "left", "left", "right"],
      rows: m.projects.slice(0, CAP).map(p => [p.name, p.client ?? "—", p.sector, p.value > 0 ? fmtMoney(p.value) : "—"]),
      note: noteFor(Math.min(CAP, m.projects.length), m.projects.length, "active projects by value"),
    });
    const conversionTable = (): Table => {
      const c = m.conversion;
      const total = c.oppsConverted + c.leadsConverted;
      return {
        columns: ["Record", "Client", "Converted To", "Value"],
        align: ["left", "left", "left", "right"],
        rows: [
          ...c.convertedOpps.slice(0, CAP).map(o => [
            o.name, o.client ?? "—",
            <span style={{ color: G, fontWeight: 700 }}>Project</span>,
            o.value > 0 ? fmtMoney(o.value) : "—",
          ]),
          ...c.convertedLeads.slice(0, Math.max(0, CAP - Math.min(CAP, c.convertedOpps.length))).map(l => [
            l.name, l.client ?? "—",
            <span style={{ color: AM, fontWeight: 700 }}>Opportunity</span>,
            l.value > 0 ? fmtMoney(l.value) : "—",
          ]),
        ],
        note: total > 0
          ? `${c.oppsConverted} opportunit${c.oppsConverted === 1 ? "y" : "ies"} became projects · ${c.leadsConverted} lead${c.leadsConverted === 1 ? "" : "s"} became opportunities`
          : "No conversions recorded yet — convert a lead or an opportunity and it will appear here.",
      };
    };

    if (modal.kind === "priority") {
      const spec: Record<PriorityKey, { accent: string; title: string; subtitle: string; table: Table }> = {
        demand: {
          accent: OR, title: "Unfilled Roles",
          subtitle: `${fmtCount(m.openDemands)} open role${m.openDemands !== 1 ? "s" : ""} across ${fmtCount(new Set(m.demands.map(d => d.ticket)).size)} projects, sorted by start date — the earliest starts need staff first.`,
          table: demandTable(),
        },
        overdue: {
          accent: OR, title: "Overdue Projects",
          subtitle: `${fmtCount(m.overdueCount)} active project${m.overdueCount !== 1 ? "s" : ""} past their target end date — the most overdue are listed first.`,
          table: overdueTable(),
        },
        noDate: {
          accent: AM, title: "Projects Without a Finish Date",
          subtitle: `${fmtCount(m.noDateCount)} active project${m.noDateCount !== 1 ? "s" : ""} with no target end date on file — schedule risk stays invisible until dates are set.`,
          table: noDateTable(),
        },
        overloaded: {
          accent: AM, title: "Over-Scheduled Team Members",
          subtitle: `${fmtCount(m.overAllocCount)} team member${m.overAllocCount !== 1 ? "s" : ""} running above full allocation — heaviest workloads first.`,
          table: staffTable(true),
        },
        bids: {
          accent: G, title: "Open Proposals",
          subtitle: `${fmtCount(m.activeBids)} open proposal${m.activeBids !== 1 ? "s" : ""}${m.pipelineValue > 0 ? ` worth ${fmtMoney(m.pipelineValue)}` : ""} — largest value first.`,
          table: oppTable(),
        },
        overBudget: {
          accent: OR, title: "Estimated Cost vs Contract",
          subtitle: `Estimated labour cost is running at ${fmtMoney(m.totalForecastCost)} against ${fmtMoney(m.backlogValue)} contracted — projects with the biggest gaps first.`,
          table: budgetTable(),
        },
        concentration: {
          accent: AM, title: "Client Dependency",
          subtitle: `Your largest client holds ${m.clientConcentration[0]?.share ?? 0}% of contracted work — full breakdown below.`,
          table: concentrationTable(),
        },
      };
      const s = spec[modal.key];
      return (
        <DetailModal accent={s.accent} category="Today's Priority" title={s.title} subtitle={s.subtitle} onClose={close}>
          <DataTable columns={s.table.columns} rows={s.table.rows} align={s.table.align} note={s.table.note} />
        </DetailModal>
      );
    }

    if (modal.kind === "domain") {
      const d = insights.find(x => x.key === modal.key);
      if (!d) return null;
      const ins = d.insight;
      const statusColor = { healthy: G, warning: AM, critical: OR }[ins.status];
      const table = modal.key === "pipeline" ? oppTable()
        : modal.key === "project" ? portfolioTable()
        : modal.key === "workforce" ? staffTable(false)
        : financialTable();
      return (
        <DetailModal accent={d.color} category="Business Health" title={d.label} subtitle={ins.headline} onClose={close}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{
              padding: "3px 10px", borderRadius: 999, fontSize: 9.5, fontWeight: 800,
              letterSpacing: "0.06em", textTransform: "uppercase",
              color: statusColor, background: statusColor + "16", border: `1px solid ${statusColor}35`,
            }}>
              {ins.statusLabel}
            </span>
            {ins.gauge.pct != null && (
              <span style={{ fontSize: 10.5, color: "var(--rm-text-muted)", fontWeight: 650 }}>
                {ins.gauge.pct}% {ins.gauge.label}
              </span>
            )}
          </div>
          <div style={{
            padding: "10px 14px", borderRadius: 12, marginBottom: 14,
            fontSize: 11.5, lineHeight: 1.55, color: "var(--rm-text)",
            background: `${d.color}0C`, border: `1px solid ${d.color}28`,
          }}>
            <span style={{ fontWeight: 800, color: d.color, marginRight: 6, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase" }}>Recommended</span>
            {ins.action}
          </div>
          <DataTable columns={table.columns} rows={table.rows} align={table.align} note={table.note} />
        </DetailModal>
      );
    }

    const meta = REPORTS.find(r => r.key === modal.key);
    if (!meta) return null;
    const stats = meta.stats(m);
    const viz = meta.visual(m);
    const table = modal.key === "pipeline" ? oppTable()
      : modal.key === "portfolio" ? portfolioTable()
      : modal.key === "workforce" ? staffTable(false)
      : modal.key === "financial" ? financialTable()
      : modal.key === "conversion" ? conversionTable()
      : executiveTable();
    return (
      <DetailModal accent={meta.color} category={meta.category} title={REPORT_TITLES[meta.key]} subtitle={meta.description} onClose={close}>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8,
          padding: "10px 12px", borderRadius: 11, marginBottom: 14,
          background: "var(--rm-panel-soft)", border: "1px solid var(--rm-panel-border)",
        }}>
          {stats.map(s => (
            <div key={s.label} style={{ minWidth: 0 }}>
              <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--rm-text-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 850, color: "var(--rm-text)", marginTop: 2, letterSpacing: "-0.01em", ...NUMS }}>{s.value}</div>
            </div>
          ))}
        </div>
        {viz && <div style={{ marginBottom: 14 }}>{viz}</div>}
        <DataTable columns={table.columns} rows={table.rows} align={table.align} note={table.note} />
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <ExportBtn
            label="Download PDF" icon={FileText} color={meta.color}
            onClick={() => run(`pdf:${meta.key}`)}
            loading={busy === `pdf:${meta.key}`} disabled={busy !== null}
          />
          <ExportBtn
            label="Download Excel" icon={FileSpreadsheet} color={meta.color}
            onClick={() => run(`xlsx:${meta.key}`)}
            loading={busy === `xlsx:${meta.key}`} disabled={busy !== null}
          />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 9.5, color: "var(--rm-text-faint)", alignSelf: "center" }}>
            Live data · full detail in the download
          </span>
        </div>
      </DetailModal>
    );
  };

  return (
    <div style={{ minHeight: "100vh", padding: "20px 72px 48px 24px", background: "var(--rm-bg)", color: "var(--rm-text)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>

        {/* Back link */}
        <button
          onClick={() => setLocation("/reports")}
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--rm-text-faint)", marginBottom: 14, cursor: "pointer", background: "none", border: "none", padding: 0 }}
        >
          <ArrowLeft size={12} />
          Back to Reports
        </button>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 14 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Building2 size={18} color={G} />
              <h1 style={{ fontSize: 26, fontWeight: 850, color: "var(--rm-text)", margin: 0, letterSpacing: "-0.015em" }}>Intelligence Hub</h1>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--rm-text-muted)", margin: 0 }}>
              {today} · Leads, bids, projects, and firm health — the full pipeline in one place. Download board-ready PDFs or Excel.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            {/* Firm health gauge */}
            {score != null && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <RingGauge value={score} color={scoreColor} />
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "var(--rm-text-faint)", textTransform: "uppercase" }}>Firm Health</span>
                  <span style={{ fontSize: 11, fontWeight: 750, color: scoreColor }}>
                    {score >= 70 ? "Healthy" : score >= 45 ? "Needs Attention" : "Critical"}
                  </span>
                  <span style={{ fontSize: 9.5, color: "var(--rm-text-muted)" }}>
                    {critCount > 0 ? `${critCount} critical area${critCount !== 1 ? "s" : ""}` : warnCount > 0 ? `${warnCount} area${warnCount !== 1 ? "s" : ""} to watch` : "All areas healthy"}
                  </span>
                </div>
              </div>
            )}
            {/* Export-all actions */}
            <div style={{ display: "flex", gap: 8 }}>
              <ExportBtn
                label="Full Pack · PDF" icon={FileText} color={G}
                onClick={() => run("pdf:all")}
                loading={busy === "pdf:all"} disabled={!m || busy !== null}
              />
              <ExportBtn
                label="Full Workbook · Excel" icon={FileSpreadsheet} color={G}
                onClick={() => run("xlsx:all")}
                loading={busy === "xlsx:all"} disabled={!m || busy !== null}
              />
            </div>
          </div>
        </div>

        {errorMsg && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", marginBottom: 14,
            borderRadius: 12, fontSize: 12, color: "#FFB36B",
            background: "rgba(232,119,34,0.10)", border: "1px solid rgba(232,119,34,0.35)",
          }}>
            <AlertTriangle size={14} />
            {errorMsg}
          </div>
        )}

        {loading && !m && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            padding: 80, color: "var(--rm-text-muted)",
            background: "var(--rm-panel)", borderRadius: 20, border: "1px solid var(--rm-panel-border)",
          }}>
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: G }} />
            Preparing your executive briefing…
          </div>
        )}

        {m && (
          <>
            {/* ── Operational briefing ── */}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(430px, 1fr))",
              gap: 14, marginBottom: 22,
            }}>
              {/* Today's priorities */}
              {priorities.length > 0 && (
                <div style={{
                  borderRadius: 16, padding: "16px 18px",
                  background: "var(--rm-panel)", border: "1px solid var(--rm-panel-border)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                    <Zap size={12} color={OR} />
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--rm-text-faint)" }}>
                      Today&apos;s Top Priorities
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {priorities.map((item, i) => {
                      const urg = URGENCY[item.severity] ?? URGENCY[1];
                      return (
                        <button
                          key={i}
                          onClick={() => setModal({ kind: "priority", key: item.detail })}
                          style={{
                            display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
                            padding: "9px 12px", borderRadius: 12, cursor: "pointer",
                            background: `linear-gradient(90deg, ${item.color}10, ${item.color}04 62%, transparent)`,
                            border: `1px solid ${item.color}26`, borderLeft: `3px solid ${item.color}`,
                            transition: "border-color 0.15s ease, transform 0.15s ease",
                          }}
                          onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = item.color + "60"; el.style.borderLeftColor = item.color; el.style.transform = "translateX(2px)"; }}
                          onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = item.color + "26"; el.style.borderLeftColor = item.color; el.style.transform = "none"; }}
                        >
                          <span style={{
                            width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            background: `${item.color}16`, border: `1px solid ${item.color}30`,
                          }}>
                            <item.icon size={14} color={item.color} />
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 17, fontWeight: 900, color: "var(--rm-text)", lineHeight: 1.1, letterSpacing: "-0.02em", ...NUMS }}>
                                {item.metric}
                              </span>
                              <span style={{ fontSize: 10.5, fontWeight: 750, color: item.color, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                                {item.metricLabel}
                              </span>
                            </div>
                            <div style={{ fontSize: 11, lineHeight: 1.45, color: "var(--rm-text-muted)", marginTop: 2 }}>
                              {item.text}
                            </div>
                          </div>
                          <span style={{
                            flexShrink: 0, padding: "3px 8px", borderRadius: 20,
                            fontSize: 9, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase",
                            color: urg.color, background: `${urg.color}14`, border: `1px solid ${urg.color}34`,
                          }}>
                            {urg.label}
                          </span>
                          <ArrowRight size={12} color="var(--rm-text-faint)" style={{ flexShrink: 0 }} />
                        </button>
                      );
                    })}
                  </div>
                  {/* focus mix summary */}
                  {(() => {
                    const mix = [3, 2, 1]
                      .map(s => ({ ...URGENCY[s], count: priorities.filter(p => p.severity === s).length }))
                      .filter(x => x.count > 0);
                    if (mix.length < 2) return null;
                    const total = mix.reduce((s, x) => s + x.count, 0);
                    return (
                      <div style={{ marginTop: 12, paddingTop: 11, borderTop: "1px solid var(--rm-panel-border)" }}>
                        <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", gap: 2, marginBottom: 7 }}>
                          {mix.map((x, i) => (
                            <div key={i} style={{ width: `${(x.count / total) * 100}%`, minWidth: 8, background: x.color, borderRadius: 2 }} />
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                          {mix.map((x, i) => (
                            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9.5, fontWeight: 700, color: "var(--rm-text-muted)" }}>
                              <span style={{ width: 7, height: 7, borderRadius: 2, background: x.color }} />
                              {x.label} · {x.count}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Domain status board */}
              <div style={{
                borderRadius: 16, padding: "16px 18px",
                background: "var(--rm-panel)", border: "1px solid var(--rm-panel-border)",
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--rm-text-faint)", marginBottom: 12 }}>
                  Business Health
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {insights.map(d => {
                    const statusColor = { healthy: G, warning: AM, critical: OR }[d.insight.status];
                    return (
                      <button
                        key={d.key}
                        onClick={() => setModal({ kind: "domain", key: d.key })}
                        title={d.insight.headline}
                        style={{
                          display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
                          padding: "9px 12px", borderRadius: 12, cursor: "pointer",
                          background: "var(--rm-panel-soft)", border: "1px solid var(--rm-panel-border)",
                          transition: "border-color 0.15s ease, transform 0.15s ease",
                        }}
                        onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = d.color + "55"; el.style.transform = "translateX(2px)"; }}
                        onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = "var(--rm-panel-border)"; el.style.transform = "none"; }}
                      >
                        <div style={{
                          width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: `${d.color}14`, border: `1px solid ${d.color}28`,
                        }}>
                          <d.icon size={14} color={d.color} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--rm-text)" }}>{d.label}</span>
                            <StatusBadge status={d.insight.status} />
                          </div>
                          <div style={{ display: "flex", gap: 12, marginTop: 5, flexWrap: "wrap" }}>
                            {d.insight.stats.map(s => (
                              <span key={s.label} style={{ display: "inline-flex", alignItems: "baseline", gap: 4, minWidth: 0 }}>
                                <span style={{ fontSize: 13, fontWeight: 850, color: "var(--rm-text)", letterSpacing: "-0.01em", ...NUMS }}>{s.value}</span>
                                <span style={{ fontSize: 8.5, fontWeight: 700, color: "var(--rm-text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{s.label}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                        <MiniRing pct={d.insight.gauge.pct} label={d.insight.gauge.label} color={statusColor} />
                        <ArrowRight size={12} color="var(--rm-text-faint)" style={{ flexShrink: 0 }} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ── Report catalog ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Download size={13} color={G} />
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--rm-text-faint)" }}>
                Report Library
              </span>
              <span style={{ flex: 1, height: 1, background: "var(--rm-panel-border)" }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 14 }}>
              {REPORTS.map(r => {
                const stats = r.stats(m);
                const viz = r.visual(m);
                return (
                  <div
                    key={r.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => setModal({ kind: "report", key: r.key })}
                    onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setModal({ kind: "report", key: r.key }); } }}
                    style={{
                      borderRadius: 16, padding: "20px 20px 18px",
                      background: `linear-gradient(180deg, ${r.color}09, transparent 72px), var(--rm-panel)`,
                      border: "1px solid var(--rm-panel-border)",
                      display: "flex", flexDirection: "column", gap: 12,
                      transition: "border-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease",
                      position: "relative", overflow: "hidden", cursor: "pointer",
                    }}
                    onMouseEnter={e => {
                      const el = e.currentTarget as HTMLDivElement;
                      el.style.borderColor = r.color + "50";
                      el.style.transform = "translateY(-2px)";
                      el.style.boxShadow = `0 8px 24px -14px ${r.color}66`;
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as HTMLDivElement;
                      el.style.borderColor = "var(--rm-panel-border)";
                      el.style.transform = "none";
                      el.style.boxShadow = "none";
                    }}
                  >
                    {/* Accent strip */}
                    <span style={{
                      position: "absolute", top: 0, left: 0, right: 0, height: 3,
                      background: `linear-gradient(90deg, ${r.color}, ${r.color}30)`,
                    }} />

                    {/* Header */}
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <div style={{
                        width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: `${r.color}14`, border: `1px solid ${r.color}30`,
                      }}>
                        <r.icon size={17} color={r.color} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: r.color, marginBottom: 2 }}>
                          {r.category}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--rm-text)", letterSpacing: "-0.01em", lineHeight: 1.25 }}>
                          {REPORT_TITLES[r.key]}
                        </div>
                      </div>
                    </div>

                    {/* Live chart */}
                    {viz ?? <VizEmpty text="Chart appears once this area has data." />}

                    {/* Description */}
                    <div style={{
                      fontSize: 11.5, lineHeight: 1.55, color: "var(--rm-text-muted)",
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                    }}>
                      {r.description}
                    </div>

                    {/* Key stats */}
                    <div style={{
                      display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8,
                      padding: "10px 12px", borderRadius: 11,
                      background: "var(--rm-panel-soft)", border: "1px solid var(--rm-panel-border)",
                    }}>
                      {stats.map(s => (
                        <div key={s.label} style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--rm-text-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</div>
                          <div style={{ fontSize: 15, fontWeight: 850, color: "var(--rm-text)", marginTop: 2, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{s.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Export actions */}
                    <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                      <ExportBtn
                        label="PDF" icon={FileText} color={r.color}
                        onClick={() => run(`pdf:${r.key}`)}
                        loading={busy === `pdf:${r.key}`} disabled={busy !== null}
                      />
                      <ExportBtn
                        label="Excel" icon={FileSpreadsheet} color={r.color}
                        onClick={() => run(`xlsx:${r.key}`)}
                        loading={busy === `xlsx:${r.key}`} disabled={busy !== null}
                      />
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 9.5, color: "var(--rm-text-faint)", alignSelf: "center" }}>
                        Click card to preview
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {renderModal()}
    </div>
  );
}
