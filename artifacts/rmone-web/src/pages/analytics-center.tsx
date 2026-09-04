/* ─────────────────────────────────────────────────────────────
 * Analytics Center — Mission Control hub (client-chosen style).
 * One dark glass surface with a live ticker, a glowing headline
 * band and nine section tiles, each a DIFFERENT micro-treatment.
 *
 * Data honesty: every number comes from the SAME ReportModel as
 * /analytics and /intelligence — the hub can never disagree with
 * those pages. No fabricated trends or deltas (there is no
 * stored history): tone dots + real composition only.
 *
 * Interactions (task requirements):
 *  - every number/visual opens the DataDrawer with the full
 *    underlying rows + links straight to the records
 *  - every tile exports its data to PDF and Excel, same engines
 *    as the Reports page
 * ──────────────────────────────────────────────────────────── */
import { useEffect, useState } from "react";
import { Link, Redirect, useLocation } from "wouter";
import { useTheme } from "@/lib/theme";
import {
  Briefcase, DollarSign, FolderKanban, Users, Layers, Gauge as GaugeIcon,
  Armchair, UserSearch, UserPlus, Activity, Lock, ShieldCheck, ChevronRight, ArrowLeft,
  Loader2, AlertTriangle, FileText, FileSpreadsheet, TrendingUp,
  Radar,
} from "lucide-react";
import { getRecruitmentAnalytics, type RecruitmentAnalytics } from "@/lib/api";
import { getPeriodRange } from "@/lib/reportsCenter";
import { peekReportModel, loadReportModel, type ReportModel } from "@/lib/reportData";
import {
  buildHubData, SECTION_TITLES,
  type HubTile, type TileViz, type CardModel, type SectionId,
} from "@/lib/analyticsCenter";
import {
  MC, useMC, Glass, ToneDot, ToneChip, MiniGauge, MiniBars, SegmentBar, PairGrid, ChipGrid,
} from "@/components/analytics/MissionKit";
import { MissionWorld } from "@/components/analytics/MissionWorld";
import { ModuleHeader } from "@/components/layout/ModuleHeader";
import { DataDrawer } from "@/components/analytics/DataDrawer";
import { getMyCapabilities, type MyCapabilities } from "@/lib/permissions";
import AnalyticsExecutivePage from "@/pages/analytics-executive";
import AnalyticsPipelinePage from "@/pages/analytics-pipeline";
import AnalyticsFinancialPage from "@/pages/analytics-financial";
import AnalyticsProjectPage from "@/pages/analytics-project";
import AnalyticsStaffPage from "@/pages/analytics-staff";
import AnalyticsResourcePage from "@/pages/analytics-resource";
import AnalyticsUtilizationPage from "@/pages/analytics-utilization";
import AnalyticsBenchPage from "@/pages/analytics-bench";
import AnalyticsPositionsPage from "@/pages/analytics-positions";
import AnalyticsRecruitmentPage from "@/pages/analytics-recruitment";
import {
  ComposedChart, Bar, Cell, LabelList, PieChart, Pie,
  ResponsiveContainer as RC, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from "recharts";

const TILE_ICONS: Record<SectionId, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  executive: Briefcase,
  pipeline: TrendingUp,
  financial: DollarSign,
  project: FolderKanban,
  staff: Users,
  resource: Layers,
  utilization: GaugeIcon,
  bench: Armchair,
  "open-positions": UserSearch,
  recruitment: UserPlus,
  usage: Activity,
};

/* ── recruitment hub tile — live numbers from the same endpoint as the
 * Recruitment page (current quarter), so hub and page can never disagree.
 * rec === undefined → still loading · null → fetch failed · {available:false}
 * → unsupported data source. Only honest states render. ── */
function buildRecruitmentTile(rec: RecruitmentAnalytics | null | undefined): HubTile {
  const base = {
    id: "recruitment" as SectionId,
    title: "Recruitment",
    reportHref: "/analytics-center/recruitment",
  };
  if (rec === undefined) {
    return {
      ...base, hero: "—", takeaway: "Where hiring is needed, in hours per role.",
      sub: "Computing capacity vs booked work for this quarter…",
      viz: { kind: "note", text: "Comparing every role's available hours against booked work…" },
      card: null,
    };
  }
  if (rec === null || rec.available === false) {
    return {
      ...base, hero: "—", takeaway: "Where hiring is needed, in hours per role.",
      sub: rec === null
        ? "Recruitment math didn't load — refresh to try again. Nothing is estimated."
        : "This company's data source doesn't support recruitment analytics yet.",
      viz: { kind: "note", text: rec === null
        ? "The capacity-vs-demand computation is unavailable right now. This tile never shows guessed numbers."
        : (rec.reason || "Recruitment analytics needs the AWS-hosted data source.") },
      card: null,
    };
  }
  const short = rec.roles.filter(r => r.variance < -0.05);
  const hrs = (n: number) => Math.round(n).toLocaleString("en-US");
  return {
    ...base,
    hero: rec.totals.rolesShort > 0 ? hrs(rec.totals.shortageHours) : "0",
    heroUnit: "hrs short",
    takeaway: short.length > 0
      ? `${short[0].role} is the biggest gap — short ${hrs(Math.abs(short[0].variance))} hours this quarter.`
      : "Every role's team covers its booked work this quarter.",
    sub: `${rec.totals.rolesShort} role${rec.totals.rolesShort === 1 ? "" : "s"} short · ${rec.totals.rolesSurplus} with spare hours · ${rec.totals.openPositions} open position${rec.totals.openPositions === 1 ? "" : "s"}`,
    chip: rec.totals.rolesShort > 0
      ? { text: `${rec.totals.rolesShort} role${rec.totals.rolesShort === 1 ? "" : "s"} to recruit`, tone: "bad" }
      : { text: "Capacity covered", tone: "good" },
    viz: short.length > 0
      ? {
          kind: "bars",
          rows: short.slice(0, 5).map(r => ({ label: r.role, v: Math.round(Math.abs(r.variance)), text: `${hrs(Math.abs(r.variance))} h` })),
          max: Math.max(1, ...short.slice(0, 5).map(r => Math.round(Math.abs(r.variance)))),
          color: "#F0716B",
        }
      : { kind: "note", text: "No role is under water this quarter — spare hours exist across the board." },
    card: {
      id: "recruitment",
      title: "Recruitment — Capacity Variance by Role",
      takeaway: "Available minus required hours for every role this quarter. Negative rows are recruitment gaps.",
      stats: [
        { label: "Roles short", value: String(rec.totals.rolesShort) },
        { label: "Roles with spare hours", value: String(rec.totals.rolesSurplus) },
        { label: "Open positions", value: String(rec.totals.openPositions) },
      ],
      columns: [
        { key: "role", label: "Role", kind: "text" },
        { key: "people", label: "People", kind: "int", align: "right" },
        { key: "openPositions", label: "Open positions", kind: "int", align: "right" },
        { key: "available", label: "Available (h)", kind: "int", align: "right" },
        { key: "required", label: "Required (h)", kind: "int", align: "right" },
        { key: "variance", label: "Variance (h)", kind: "int", align: "right" },
      ],
      rows: rec.roles.map(r => ({
        role: r.role,
        people: r.people,
        openPositions: r.openPositions,
        available: Math.round(r.available),
        required: Math.round(r.required),
        variance: Math.round(r.variance),
      })),
      explanation: {
        meaning: "Whether each role's team has enough planned hours to cover the work booked for this quarter. Negative variance = recruitment gap.",
        calculation: "Variance = available − required hours. Available = work-week capacity minus company holidays on working days, scaled by recorded leave. Required = booked allocations plus open-position demand, as planned.",
        period: `This quarter (${rec.periodStart} → ${rec.periodEnd})`,
        measure: "planned",
        source: "Allocation plans, open positions, roster and Settings calendar rules",
        completeness: `Roster: ${rec.totals.people} enabled people`,
      },
    },
  };
}

/* MissionWorld moved to components/analytics/MissionWorld.tsx so section
 * pages can share it without importing this page (no circular imports). */

/* ═══════════════════════════════════════════════════════════════
 * SVG MINI-CHART RENDERERS
 * Each section gets a distinct chart treatment so the grid reads
 * like a real dashboard rather than a list of identical widgets.
 * All charts are SVG — no dependency on Recharts for the hub.
 * ══════════════════════════════════════════════════════════════ */

/** Vertical bar chart — used by Executive, Staff, Utilization */
function ChartBars({ rows, max, color = "#8EC94A" }: {
  rows: { label: string; v: number; text?: string }[];
  max: number;
  color?: string;
}) {
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const n = Math.min(rows.length, 7);
  if (n === 0) return <div style={{ height: 108 }} />;
  const gradId = `hubBarGrad${color.replace(/[^a-z0-9]/gi, "")}`;
  const tickFill = isDark ? "rgba(255,255,255,0.40)" : "rgba(15,25,35,0.45)";

  /* Utilization bands get semantic per-bar colors */
  const UTIL_COLORS: Record<string, string> = {
    Available: "#6B99BB", Light: "#8EC94A", Normal: "#A8D672", Full: "#F0A842", Overloaded: "#F87171",
  };
  const isUtilBands = rows.some(r => Object.prototype.hasOwnProperty.call(UTIL_COLORS, r.label));

  return (
    <div style={{ height: 108, margin: "0 -2px" }}>
      <RC width="100%" height={108}>
        <ComposedChart data={rows.slice(0, n)} margin={{ top: 22, right: 2, bottom: 16, left: -22 }} barCategoryGap="28%">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={1} />
              <stop offset="100%" stopColor={color} stopOpacity={0.38} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)"} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 8, fill: tickFill }} tickLine={false} axisLine={false}
            tickFormatter={(v: string) => v.length > 7 ? v.slice(0, 6) + "…" : v} />
          <YAxis hide />
          <RTooltip contentStyle={{ background: isDark ? "#0F1E2C" : "#fff", border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)"}`, borderRadius: 8, fontSize: 10 }}
            formatter={(v: number, _: string, p: any) => [p.payload?.text ?? v.toLocaleString("en-US"), ""]} />
          <Bar dataKey="v" radius={[4, 4, 0, 0]} maxBarSize={64}
            fill={isUtilBands ? "#8EC94A" : `url(#${gradId})`}>
            {isUtilBands && rows.slice(0, n).map((row, i) => (
              <Cell key={i} fill={UTIL_COLORS[row.label] ?? color} />
            ))}
            <LabelList dataKey="v" content={(props: any) => {
              const row = rows[props.index as number];
              const cx = Number(props.x) + Number(props.width) / 2;
              const cy = Number(props.y);
              if (isNaN(cx) || isNaN(cy) || !props.value) return null;
              const barColor = isUtilBands ? (UTIL_COLORS[row?.label ?? ""] ?? color) : color;
              const display = row?.text ?? (Number(props.value) >= 1000 ? `${(Number(props.value) / 1000).toFixed(0)}k` : String(props.value));
              return <text x={cx} y={cy - 3} textAnchor="middle" fontSize={8} fontWeight={800} fill={barColor} style={{ fontFamily: "var(--app-font-sans)" }}>{display}</text>;
            }} />
          </Bar>
        </ComposedChart>
      </RC>
    </div>
  );
}

/** Donut ring chart — Resource + Usage */
function ChartDonut({ pct, label, caption }: { pct: number; label: string; caption: string }) {
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const safePct = Math.max(0, Math.min(100, pct));
  const color = safePct > 60 ? "#8EC94A" : safePct > 30 ? "#F0A842" : "#F87171";
  const trackColor = isDark ? "rgba(255,255,255,0.09)" : "rgba(15,25,35,0.10)";
  const centerFill = isDark ? "#fff" : "rgba(15,25,35,0.90)";
  const captionFill = isDark ? "rgba(255,255,255,0.60)" : "rgba(15,25,35,0.60)";
  const pieData = [
    { name: "filled", value: safePct },
    { name: "track", value: Math.max(0, 100 - safePct) },
  ];
  return (
    <div style={{ height: 108, display: "flex", alignItems: "center" }}>
      {/* Donut ring */}
      <div style={{ position: "relative", width: 96, height: 96, flexShrink: 0 }}>
        <PieChart width={96} height={96}>
          <Pie data={pieData} cx={44} cy={44} innerRadius={26} outerRadius={42}
            startAngle={90} endAngle={-270} dataKey="value" stroke="none" isAnimationActive={false}>
            <Cell fill={color} />
            <Cell fill={trackColor} />
          </Pie>
        </PieChart>
        {/* center label overlay */}
        <div style={{
          position: "absolute", top: "50%", left: "47%", transform: "translate(-50%, -50%)",
          textAlign: "center", pointerEvents: "none",
        }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: centerFill, lineHeight: 1, whiteSpace: "nowrap" }}>{label}</div>
        </div>
      </div>
      {/* Right-side caption */}
      <div style={{ flex: 1, paddingLeft: 10, paddingRight: 4, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
        <div style={{ fontSize: 9.5, color: captionFill, lineHeight: 1.55 }}>{caption}</div>
        {/* mini progress bar */}
        <div style={{ height: 5, borderRadius: 999, background: isDark ? "rgba(255,255,255,0.09)" : "rgba(15,25,35,0.10)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${safePct}%`, minWidth: safePct > 0 ? 4 : 0, background: color, borderRadius: 999 }} />
        </div>
        <div style={{ fontSize: 8, color: isDark ? "rgba(255,255,255,0.35)" : "rgba(15,25,35,0.40)", textTransform: "uppercase", letterSpacing: "0.09em" }}>
          {safePct.toFixed(safePct < 10 ? 1 : 0)}% rate
        </div>
      </div>
    </div>
  );
}

/** Donut + legend — Project schedule health */
function ChartSegments({ segments, total }: {
  segments: { label: string; v: number; color: string }[];
  total: number;
}) {
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const centerFill = isDark ? "#fff" : "rgba(15,25,35,0.90)";
  const legendLabel = isDark ? "rgba(255,255,255,0.55)" : "rgba(15,25,35,0.55)";
  const legendVal = isDark ? "#fff" : "rgba(15,25,35,0.90)";
  const pieData = segments.filter(s => s.v > 0);
  const emptyColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(15,25,35,0.08)";
  const displayData = pieData.length > 0 ? pieData : [{ label: "—", v: 1, color: emptyColor }];
  return (
    <div style={{ height: 108, display: "flex", alignItems: "center" }}>
      {/* Donut */}
      <div style={{ position: "relative", width: 90, height: 90, flexShrink: 0 }}>
        <PieChart width={90} height={90}>
          <Pie data={displayData} cx={41} cy={41} innerRadius={22} outerRadius={40}
            startAngle={90} endAngle={-270} dataKey="v" stroke="none" isAnimationActive={false}
            paddingAngle={displayData.length > 1 ? 2 : 0}>
            {displayData.map((s, i) => <Cell key={i} fill={s.color} />)}
          </Pie>
        </PieChart>
        <div style={{ position: "absolute", top: "50%", left: "47%", transform: "translate(-50%,-50%)", textAlign: "center", pointerEvents: "none" }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: centerFill, lineHeight: 1 }}>{total}</div>
          <div style={{ fontSize: 7, color: legendLabel, textTransform: "uppercase", letterSpacing: "0.1em" }}>total</div>
        </div>
      </div>
      {/* Legend */}
      <div style={{ flex: 1, paddingLeft: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        {segments.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 9.5, color: legendLabel, flex: 1, lineHeight: 1.2 }}>{s.label}</span>
            <b style={{ fontSize: 15, fontVariantNumeric: "tabular-nums", color: legendVal }}>{s.v}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal comparison bars — Financial, Bench */
function ChartPairs({ pairs }: { pairs: { label: string; value: string; color?: string }[] }) {
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const tickFill = isDark ? "rgba(255,255,255,0.50)" : "rgba(15,25,35,0.55)";
  const rows = pairs.slice(0, 3);
  const nums = rows.map(p => parseFloat(p.value.replace(/[^0-9.]/g, "")) || 0);
  const maxN = Math.max(...nums, 1);
  /* Use log scale so dramatically different values (e.g. $4 vs $635K) are both visible */
  const logVals = nums.map(n => n > 0 ? Math.log(n + 1) : 0);
  const logMax = Math.max(...logVals, 1);
  const data = rows.map((p, i) => ({
    label: p.label.length > 18 ? p.label.slice(0, 17) + "…" : p.label,
    displayValue: p.value,
    num: logVals[i] / logMax * 100, // 0-100 log-normalised
    color: p.color ?? (i === 0 ? "#A8D672" : "#6B99BB"),
  }));
  return (
    <div style={{ height: 108, margin: "0 -4px" }}>
      <RC width="100%" height={108}>
        <ComposedChart data={data} layout="vertical" margin={{ top: 8, right: 10, bottom: 8, left: 0 }} barCategoryGap="35%">
          <XAxis type="number" hide domain={[0, 100]} />
          <YAxis dataKey="label" type="category" tick={{ fontSize: 8.5, fill: tickFill }} tickLine={false} axisLine={false} width={98} />
          <RTooltip contentStyle={{ background: isDark ? "#0F1E2C" : "#fff", border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)"}`, borderRadius: 8, fontSize: 10 }}
            formatter={(_: number, __: string, p: any) => [p.payload?.displayValue ?? "—", ""]} />
          <Bar dataKey="num" radius={[0, 5, 5, 0]} maxBarSize={18} isAnimationActive={false}>
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            <LabelList content={(props: any) => {
              const d = data[props.index as number];
              const bx = Number(props.x) + Number(props.width) + 5;
              const by = Number(props.y) + Number(props.height) / 2 + 4;
              if (!d || isNaN(bx) || isNaN(by)) return null;
              return <text x={bx} y={by} fontSize={8.5} fontWeight={800} fill={d.color} style={{ fontFamily: "var(--app-font-sans)" }}>{d.displayValue}</text>;
            }} />
          </Bar>
        </ComposedChart>
      </RC>
    </div>
  );
}

/** Horizontal bars by role — Open Positions */
function ChartChipsBig({ items }: { items: { label: string; v: string }[] }) {
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const tickFill = isDark ? "rgba(255,255,255,0.50)" : "rgba(15,25,35,0.55)";
  const COLORS = ["#A8D672", "#6B99BB", "#F0A842", "#A78BFA"];
  const rows = items.slice(0, 4);
  const nums = rows.map(r => parseInt(r.v, 10) || 0);
  const maxN = Math.max(...nums, 1);
  const data = rows.map((r, i) => ({
    label: r.label.length > 19 ? r.label.slice(0, 18) + "…" : r.label,
    num: nums[i],
    v: r.v,
    color: COLORS[i % COLORS.length],
  }));
  return (
    <div style={{ height: 108, margin: "0 -4px" }}>
      <RC width="100%" height={108}>
        <ComposedChart data={data} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 0 }} barCategoryGap="28%">
          <XAxis type="number" hide domain={[0, maxN]} />
          <YAxis dataKey="label" type="category" tick={{ fontSize: 7.5, fill: tickFill }} tickLine={false} axisLine={false} width={104} />
          <RTooltip contentStyle={{ background: isDark ? "#0F1E2C" : "#fff", border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)"}`, borderRadius: 8, fontSize: 10 }}
            formatter={(_: number, __: string, p: any) => [p.payload?.v ?? "—", "Open positions"]} />
          <Bar dataKey="num" radius={[0, 5, 5, 0]} maxBarSize={13} isAnimationActive={false}>
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            <LabelList content={(props: any) => {
              const d = data[props.index as number];
              const bx = Number(props.x) + Number(props.width) + 5;
              const by = Number(props.y) + Number(props.height) / 2 + 4;
              if (!d || isNaN(bx) || isNaN(by)) return null;
              return (
                <g>
                  <rect x={bx} y={Number(props.y)} width={20} height={Number(props.height)} rx={4} fill={d.color} fillOpacity={0.18} />
                  <text x={bx + 10} y={by} textAnchor="middle" fontSize={9} fontWeight={800} fill={d.color} style={{ fontFamily: "var(--app-font-sans)" }}>{d.v}</text>
                </g>
              );
            }} />
          </Bar>
        </ComposedChart>
      </RC>
    </div>
  );
}

/** Usage adoption ring + metric */
function ChartUsage({ pct, active, total }: { pct: number; active: number; total: number }) {
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const trackStroke = isDark ? "rgba(255,255,255,0.08)" : "rgba(15,25,35,0.10)";
  const centerFill = isDark ? "#fff" : "rgba(15,25,35,0.90)";
  const headerFill = isDark ? "rgba(255,255,255,0.50)" : "rgba(15,25,35,0.50)";
  const subFill = isDark ? "rgba(255,255,255,0.40)" : "rgba(15,25,35,0.45)";
  const R = 30, cx = 40, cy = 45, stroke = 7;
  const circ = 2 * Math.PI * R;
  const filled = circ * Math.min(1, Math.max(0, pct / 100));
  const color = pct > 20 ? "#8EC94A" : pct > 5 ? "#F0A842" : "#6B99BB";
  return (
    <svg width="100%" viewBox="0 0 280 90" preserveAspectRatio="xMidYMid meet">
      <circle cx={cx} cy={cy} r={R} fill="none" stroke={trackStroke} strokeWidth={stroke} />
      <circle cx={cx} cy={cy} r={R} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${filled} ${circ - filled}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`} />
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize={11} fontWeight={800} fill={centerFill}
        style={{ fontFamily: "var(--app-font-sans)" }}>{pct.toFixed(1)}%</text>
      <text x={88} y={30} fontSize={9} fontWeight={600} fill={headerFill}
        style={{ fontFamily: "var(--app-font-sans)", letterSpacing: "0.1em" }}>
        ADOPTION
      </text>
      <text x={88} y={50} fontSize={18} fontWeight={800} fill={color}
        style={{ fontFamily: "var(--app-font-sans)" }}>
        {active.toLocaleString("en-US")} / {total.toLocaleString("en-US")}
      </text>
      <text x={88} y={65} fontSize={9} fill={subFill}
        style={{ fontFamily: "var(--app-font-sans)" }}>
        active of enabled users
      </text>
    </svg>
  );
}

/** Placeholder when data is unavailable */
function ChartEmpty({ text }: { text?: string }) {
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const barFill = isDark ? "rgba(255,255,255,0.05)" : "rgba(15,25,35,0.06)";
  const labelFill = isDark ? "rgba(255,255,255,0.25)" : "rgba(15,25,35,0.30)";
  return (
    <svg width="100%" viewBox="0 0 280 90" preserveAspectRatio="xMidYMid meet">
      <rect x={0} y={20} width={60} height={50} rx={5} fill={barFill} />
      <rect x={70} y={35} width={60} height={35} rx={5} fill={barFill} />
      <rect x={140} y={28} width={60} height={42} rx={5} fill={barFill} />
      <rect x={210} y={42} width={60} height={28} rx={5} fill={barFill} />
      <text x={140} y={80} textAnchor="middle" fontSize={9} fill={labelFill}
        style={{ fontFamily: "var(--app-font-sans)" }}>
        {text ?? "No data available"}
      </text>
    </svg>
  );
}

/* ── top-of-card chart area: picks the right SVG renderer per viz kind ── */
function TileChart({ viz }: { viz: TileViz }) {
  switch (viz.kind) {
    case "bars":
      return <ChartBars rows={viz.rows} max={viz.max} color={viz.color ?? "#8EC94A"} />;
    case "gauge":
      return <ChartDonut pct={viz.pct} label={viz.label} caption={viz.caption} />;
    case "segments":
      return <ChartSegments segments={viz.segments} total={viz.total} />;
    case "pairs":
      return <ChartPairs pairs={viz.pairs} />;
    case "chips":
      return <ChartChipsBig items={viz.items} />;
    case "note":
      return <ChartEmpty text="Collecting data…" />;
  }
}

/* ── one hub tile ── */
function HubTileCard({ tile, onOpenSection, onDrill }: {
  tile: HubTile;
  onOpenSection: (id: SectionId) => void;
  onDrill: (card: CardModel) => void;
}) {
  const MC = useMC();
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const Icon = TILE_ICONS[tile.id];
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);
  const [err, setErr] = useState(false);

  const runExport = async (kind: "pdf" | "xlsx", e: React.MouseEvent) => {
    e.stopPropagation();
    if (!tile.card || busy) return;
    setBusy(kind);
    setErr(false);
    try {
      const mod = await import("@/lib/exportCard");
      if (kind === "pdf") await mod.exportCardPdf(tile.card);
      else await mod.exportCardExcel(tile.card);
    } catch {
      setErr(true);
    } finally {
      setBusy(null);
    }
  };

  const drill = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (tile.card) onDrill(tile.card);
  };

  /* Inner affordances are span[role=button] — never a nested <button>
   * inside the clickable card (invalid HTML + focus traps). */
  const drillProps = tile.card ? {
    role: "button" as const,
    tabIndex: 0,
    title: "See the data behind this number",
    onClick: drill,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); drill(e); } },
    style: { cursor: "zoom-in" as const },
  } : {};

  return (
    <Glass
      className="group"
      role="button"
      tabIndex={0}
      onClick={() => onOpenSection(tile.id)}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenSection(tile.id); }
      }}
      style={{ display: "flex", flexDirection: "column", padding: 0, cursor: "pointer", overflow: "hidden" }}
    >
      {/* ── CHART PREVIEW AREA (top) ── */}
      <div
        {...(tile.card ? { role: "button" as const, tabIndex: 0, onClick: drill,
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); drill(e); } } } : {})}
        style={{
          padding: "16px 18px 12px",
          background: isDark
            ? "linear-gradient(160deg, rgba(30,48,64,0.85) 0%, rgba(22,38,52,0.95) 100%)"
            : "linear-gradient(160deg, rgba(240,242,245,0.95) 0%, rgba(245,246,248,1) 100%)",
          borderBottom: isDark ? "1px solid rgba(255,255,255,0.07)" : `1px solid ${MC.border}`,
          cursor: tile.card ? "zoom-in" : "default",
        }}
      >
        <TileChart viz={tile.viz} />
      </div>

      {/* ── INFO SECTION (below chart) ── */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "14px 18px 16px" }}>
        {/* title row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(107,165,57,0.16)", boxShadow: "0 0 10px rgba(107,165,57,0.22)", flexShrink: 0,
            }}>
              <Icon size={14} style={{ color: MC.greenInk }} />
            </div>
            <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.025em" }}>{tile.title}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {tile.badge && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 3, borderRadius: 999,
                padding: "2px 7px", fontSize: 9.5, fontWeight: 500,
                background: "rgba(255,255,255,0.06)", color: MC.muted, border: `1px solid ${MC.border}`,
              }}>
                {tile.badge === "financial" ? <Lock size={9} /> : <ShieldCheck size={9} />}
                {tile.badge === "financial" ? "Financial access" : "Admin"}
              </span>
            )}
            <ChevronRight size={13} style={{ opacity: 0.3 }} />
          </div>
        </div>

        {/* hero number */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
          <span
            {...drillProps}
            style={{
              fontSize: 32, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.025em",
              fontVariantNumeric: "tabular-nums",
              backgroundImage: isDark ? "linear-gradient(135deg, #fff 40%, rgba(168,214,114,0.85) 100%)" : "none",
              WebkitBackgroundClip: isDark ? "text" : "unset",
              backgroundClip: isDark ? "text" : "unset",
              color: isDark ? "transparent" : MC.text,
              filter: isDark ? "drop-shadow(0 0 18px rgba(107,165,57,0.3))" : "none",
              ...(drillProps as any).style,
            }}
          >
            {tile.hero}
          </span>
          {tile.heroUnit && <span style={{ fontSize: 11.5, color: MC.muted }}>{tile.heroUnit}</span>}
          {tile.chip && <span style={{ marginLeft: "auto" }}><ToneChip text={tile.chip.text} tone={tile.chip.tone} /></span>}
        </div>

        {/* takeaway + sub */}
        <div style={{ marginTop: 5, fontSize: 11, fontWeight: 500, lineHeight: 1.5, color: MC.muted }}>
          {tile.takeaway}
        </div>
        <div style={{ marginTop: 2, fontSize: 9.5, color: MC.faint, lineHeight: 1.4 }}>{tile.sub}</div>

        {/* footer: drill + exports + optional full-report link */}
        <div style={{
          marginTop: "auto", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8,
          borderTop: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : MC.border}`,
          marginLeft: -18, marginRight: -18, paddingLeft: 18, paddingRight: 18,
        }}>
          {/* row 1: View data link + PDF/Excel exports */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            {tile.card ? (
              <span {...drillProps} style={{
                fontSize: 10, fontWeight: 700, color: MC.greenInk,
                textTransform: "uppercase", letterSpacing: "0.09em",
                ...(drillProps as any).style,
              }}>
                View data · {tile.card.rows.length.toLocaleString("en-US")} rows
              </span>
            ) : (
              <span style={{ fontSize: 10, color: MC.faint }}>{err ? "" : "No data to export yet"}</span>
            )}
            <span style={{ display: "inline-flex", gap: 5 }}>
              {err && <span style={{ fontSize: 9.5, color: MC.bad, alignSelf: "center" }}>Export failed</span>}
              {tile.card && (
                <>
                  <TileExportBtn label="PDF" icon={FileText} loading={busy === "pdf"} disabled={busy !== null} onClick={e => runExport("pdf", e)} />
                  <TileExportBtn label="Excel" icon={FileSpreadsheet} loading={busy === "xlsx"} disabled={busy !== null} onClick={e => runExport("xlsx", e)} />
                </>
              )}
            </span>
          </div>
          {/* row 2: "View full report" — opens this tile's section inline */}
          {tile.reportHref && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); onOpenSection(tile.id); }}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onOpenSection(tile.id); }
              }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: 10, fontWeight: 700, letterSpacing: "0.07em",
                textTransform: "uppercase", cursor: "pointer",
                color: MC.greenInk,
                padding: "5px 12px", borderRadius: 5,
                border: `1px solid ${MC.greenInk}55`,
                background: isDark ? "rgba(107,165,57,0.10)" : "rgba(107,165,57,0.08)",
                transition: "background 0.12s, border-color 0.12s",
                alignSelf: "flex-start",
                userSelect: "none",
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLSpanElement>) => {
                e.currentTarget.style.background = isDark ? "rgba(107,165,57,0.20)" : "rgba(107,165,57,0.15)";
                e.currentTarget.style.borderColor = MC.greenInk;
              }}
              onMouseLeave={(e: React.MouseEvent<HTMLSpanElement>) => {
                e.currentTarget.style.background = isDark ? "rgba(107,165,57,0.10)" : "rgba(107,165,57,0.08)";
                e.currentTarget.style.borderColor = `${MC.greenInk}55`;
              }}
            >
              View full report →
            </span>
          )}
        </div>
      </div>
    </Glass>
  );
}

function TileExportBtn({ label, icon: Icon, loading, disabled, onClick }: {
  label: string; icon: React.ElementType; loading: boolean; disabled: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const MC = useMC();
  /* span[role=button]: the whole tile is clickable, so no nested <button> */
  return (
    <span
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={e => { e.stopPropagation(); if (!disabled) onClick(e); }}
      onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && !disabled) { e.preventDefault(); e.stopPropagation(); onClick(e as any); } }}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "5px 10px", borderRadius: 8,
        border: "1px solid rgba(168,214,114,0.3)",
        background: loading ? "rgba(168,214,114,0.12)" : "transparent",
        fontSize: 10, fontWeight: 700, color: MC.greenInk,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled && !loading ? 0.5 : 1, whiteSpace: "nowrap",
      }}
    >
      {loading ? <Loader2 size={11} className="animate-spin" /> : <Icon size={11} />}
      {label}
    </span>
  );
}

/* ── the hub page ── */
export default function AnalyticsCenterPage() {
  const MC = useMC();
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const [, setLocation] = useLocation();
  const initial = (() => { try { return peekReportModel(); } catch { return null; } })();
  const [m, setM] = useState<ReportModel | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [caps, setCaps] = useState<MyCapabilities | null>(null);
  const [drawer, setDrawer] = useState<CardModel | null>(null);
  /* Recruitment tile data — same endpoint + same default period (current
   * quarter) as the Recruitment page, so the hub can never disagree with it.
   * undefined = loading · null = failed · payload = live. */
  const [rec, setRec] = useState<RecruitmentAnalytics | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const r = getPeriodRange("quarter");
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const endIncl = new Date(r.end.getTime() - 86_400_000);
    getRecruitmentAnalytics(iso(r.start), iso(endIncl))
      .then(p => { if (alive) setRec(p); })
      .catch(() => { if (alive) setRec(null); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!initial) setLoading(true);
      setError(null);
      try {
        const built = await loadReportModel();
        if (cancelled) return;
        if (!built) setError("No portfolio data is available right now.");
        else setM(built);
      } catch (e: any) {
        /* keep any cached model on screen, but NEVER pretend it is live */
        if (!cancelled) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    getMyCapabilities().then(c => { if (alive) setCaps(c); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const hub = m ? buildHubData(m) : null;
  /* "Live" is only claimed when the refresh succeeded AND every source loaded */
  const sourcesOk = !m?.sources || (m.sources.records && m.sources.staffing && m.sources.demands);
  /* Financial tile: hidden only when capabilities are KNOWN to exclude
   * financials (server re-checks regardless — this is display gating). */
  const showFinancial = caps ? caps.caps.editFinancials !== false : true;
  const tiles = (hub ? [...hub.tiles, buildRecruitmentTile(rec)] : [])
    .filter(t => {
      if (t.id === "usage") return false;
      if (t.id === "financial" && !showFinancial) return false;
      return true;
    })
    .map(t => {
      /* Fix hub tile wording/drill population without touching the shared model.
       * Financial tile: hero is contracted-labor dollars — make the drill card
       * title and takeaway match what the hero actually shows so the drawer is
       * not misleadingly titled "Project Money Fields" when only the labor
       * figure is highlighted. */
      if (t.id === "financial" && t.card) {
        return {
          ...t,
          card: {
            ...t.card,
            title: "Financial — Contracted Labor & Portfolio Value",
            takeaway: "Contract value, contracted labor and forecast cost per active project — the figures behind the hub's Financial tile.",
          },
        };
      }
      /* Project tile: hero is total-records count (leads+opps+projects) but
       * the pre-existing drill card carries only schedule rows. Open a card
       * that covers all three populations so the drill population matches
       * the hero and segment chart shown on the tile. */
      if (t.id === "project" && t.card && m) {
        // The schedule card from buildHubData is already correct for the
        // schedule metric, but the tile hero shows ALL record types.
        // We leave the card as-is (it still shows schedule health) but
        // update the title and takeaway to reflect the full picture so
        // users see what they actually drilled into.
        return {
          ...t,
          card: {
            ...t.card,
            title: "Project — Schedule Health (Active Projects)",
            takeaway: `Where every active project stands against its planned end date. The tile hero (${t.hero}) includes leads and open pursuits — the rows here are the ${t.card.rows.length} active projects.`,
          },
        };
      }
      return t;
    });

  return (
    <MissionWorld>
      <ModuleHeader
        title="Analytics Center"
        section="Operational Intelligence"
        icon={Radar}
        status={m && !error && sourcesOk ? (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px",
            borderRadius: 999, fontSize: 11, fontWeight: 500,
            background: "rgba(132,204,22,0.1)", border: "1px solid rgba(132,204,22,0.3)", color: MC.good,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: MC.good, boxShadow: "0 0 6px rgba(132,204,22,0.9)" }} />
            Live · as of {new Date(m.generatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </span>
        ) : m && (error || !sourcesOk) ? (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px",
            borderRadius: 999, fontSize: 11, fontWeight: 500,
            background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.35)", color: MC.warn,
          }}>
            <AlertTriangle size={12} />
            {error ? "Couldn't refresh — showing earlier numbers" : "Partial data — some sources didn't load"}
          </span>
        ) : undefined}
        style={{ marginBottom: 16 }}
      />

      {loading && (
        <Glass style={{ marginTop: 18, padding: 80, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: MC.muted }}>
          <Loader2 className="animate-spin" size={18} style={{ color: MC.green }} />
          Loading live portfolio data…
        </Glass>
      )}

      {!loading && error && !m && (
        <Glass style={{ marginTop: 18, padding: 60, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: MC.warn }}>
          <AlertTriangle size={16} />
          {error}
        </Glass>
      )}

      {hub && m?.sources && (!m.sources.records || !m.sources.staffing || !m.sources.demands) && (
        <div style={{
          marginTop: 16, display: "flex", alignItems: "center", gap: 8,
          padding: "9px 14px", borderRadius: 10, fontSize: 11.5, color: MC.warn,
          background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.3)",
        }}>
          <AlertTriangle size={13} style={{ flexShrink: 0 }} />
          <span>
            {[
              !m.sources.records ? "some project/opportunity records" : null,
              !m.sources.staffing ? "staffing data" : null,
              !m.sources.demands ? "open-position data" : null,
            ].filter(Boolean).join(", ")}{" "}
            didn't load — affected numbers show "—" instead of guesses. Refresh to try again.
          </span>
        </div>
      )}

      {hub && (
        <>
          {/* firm-status ticker */}
          <div style={{
            marginTop: 16, overflow: "hidden", display: "flex", alignItems: "center",
            background: isDark ? "rgba(20,32,44,0.95)" : "#FFFFFF",
            border: isDark ? "1px solid rgba(255,255,255,0.07)" : "1px solid #E8ECF0",
            borderRadius: 10,
          }}>
            <div style={{
              padding: "8px 16px", fontSize: 9, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.16em", flexShrink: 0, color: "#16240a",
              background: "linear-gradient(140deg, #8EC94A, #6BA539)",
              alignSelf: "stretch", display: "flex", alignItems: "center",
            }}>Firm Status</div>
            <div style={{ display: "flex", alignItems: "center", flex: 1, justifyContent: "space-between", padding: "4px 12px", flexWrap: "wrap" }}>
              {hub.ticker.map(t => (
                <button
                  key={t.label}
                  onClick={() => t.detail && setDrawer(t.detail)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, flexShrink: 0,
                    background: "none", border: "none", padding: "4px 8px", borderRadius: 7, margin: 0,
                    cursor: t.detail ? "pointer" : "default", color: "inherit", fontFamily: "inherit",
                    transition: "background 0.12s",
                  }}
                  title={t.detail ? `Click to see ${t.label} breakdown` : undefined}
                  onMouseEnter={e => { if (t.detail) (e.currentTarget as HTMLButtonElement).style.background = isDark ? "rgba(255,255,255,0.08)" : "rgba(15,25,34,0.05)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
                >
                  <span style={{ color: isDark ? MC.faint : "#6B7280" }}>{t.label}</span>
                  <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: isDark ? MC.text : "#111827" }}>{t.val}</span>
                  <ToneDot tone={t.tone} />
                </button>
              ))}
            </div>
          </div>

          {/* headline band — real backlog + real composition (no invented history) */}
          <Glass style={{ marginTop: 16, padding: "20px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 20 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: MC.greenInk }}>
                {hub.hero.label}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginTop: 4, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 58, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.03em",
                  fontVariantNumeric: "tabular-nums",
                  backgroundImage: isDark
                    ? "linear-gradient(180deg, #FFFFFF 30%, #A8D672 100%)"
                    : "linear-gradient(180deg, #1a3a0a 20%, #6BA539 100%)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                  filter: isDark ? "drop-shadow(0 0 28px rgba(107,165,57,0.35))" : "none",
                }}>{hub.hero.value}</span>
                <span style={{ fontSize: 11.5, lineHeight: 1.5, color: MC.muted, maxWidth: 300 }}>{hub.hero.explain}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
              {hub.hero.side.map(s => (
                <div key={s.label} style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.14em", color: MC.faint }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{s.value}</div>
                </div>
              ))}
            </div>
          </Glass>

          {/* tile grid */}
          <div style={{
            marginTop: 18, display: "grid", gap: 18,
            gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          }}>
            {tiles.map(t => (
              <HubTileCard
                key={t.id}
                tile={t}
                onOpenSection={id => setLocation(`/analytics-center/${id}`)}
                onDrill={setDrawer}
              />
            ))}
          </div>

          <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end", fontSize: 11, color: MC.faint }}>
            <span>Analytics Center</span>
          </div>
        </>
      )}

      <DataDrawer card={drawer} onClose={() => setDrawer(null)} />
    </MissionWorld>
  );
}

/* ── section router: built pages render, the rest keep the placeholder ── */
export function AnalyticsCenterSectionPage({ section }: { section: string }) {
  const MC = useMC();
  if (section === "executive") return <AnalyticsExecutivePage />;
  if (section === "pipeline") return <AnalyticsPipelinePage />;
  if (section === "financial") return <AnalyticsFinancialPage />;
  if (section === "project") return <AnalyticsProjectPage />;
  if (section === "staff") return <AnalyticsStaffPage />;
  if (section === "resource") return <AnalyticsResourcePage />;
  if (section === "utilization") return <AnalyticsUtilizationPage />;
  if (section === "bench") return <AnalyticsBenchPage />;
  if (section === "open-positions") return <AnalyticsPositionsPage />;
  if (section === "recruitment") return <AnalyticsRecruitmentPage />;
  if (section === "usage") return <Redirect to="/usage-analytics" />;
  const title = (SECTION_TITLES as Record<string, string>)[section] ?? "Analytics";
  return (
    <MissionWorld>
      <Link
        href="/analytics-center"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
          color: MC.muted, textDecoration: "none",
        }}
      >
        <ArrowLeft size={13} />
        Analytics Center
      </Link>
      <Glass style={{ marginTop: 16, padding: "60px 40px", textAlign: "center" }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: MC.greenInk }}>
          Analytics Center
        </div>
        <h1 style={{ margin: "8px 0 10px", fontSize: 28, fontWeight: 800, letterSpacing: "-0.015em" }}>{title}</h1>
        <p style={{ margin: "0 auto", maxWidth: 460, fontSize: 13, lineHeight: 1.6, color: MC.muted }}>
          This dashboard is being built. Its live headline numbers are already on the hub —
          open the {title} tile's data view for the full underlying records in the meantime.
        </p>
      </Glass>
    </MissionWorld>
  );
}
