import React from "react";
import { Sparkles, ArrowRight, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";

const GREEN = "#6BA539";
const GREEN_DARK = "#15803D";
const ORANGE = "#F59E0B";
const ORANGE_DARK = "#B45309";
const RED = "#DC2626";
const NAVY = "#1B2B38";
const TRACK = "#E2E8F0";

type Kpi = {
  label: string;
  value: number;
  delta: number;
  trend: number[];
  status: "good" | "warn";
};

const KPIS: Kpi[] = [
  { label: "On-track projects", value: 92, delta: 3, trend: [78, 82, 85, 84, 88, 90, 92], status: "good" },
  { label: "RFIs response time", value: 78, delta: -4, trend: [86, 84, 83, 82, 80, 79, 78], status: "warn" },
  { label: "Schedule adherence", value: 88, delta: 1, trend: [85, 86, 87, 86, 87, 88, 88], status: "good" },
  { label: "Approvals due", value: 60, delta: -8, trend: [74, 72, 70, 68, 66, 63, 60], status: "warn" },
];

function statusColor(s: "good" | "warn") {
  return s === "good" ? GREEN : ORANGE;
}
function statusText(s: "good" | "warn") {
  return s === "good" ? GREEN_DARK : ORANGE_DARK;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 96;
  const h = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(1, max - min);
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(" ");
  const areaPts = `0,${h} ${pts} ${w},${h}`;
  const gradId = `g-${color.replace("#", "")}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill={`url(#${gradId})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Ring({ value, color, size = 56, stroke = 6 }: { value: number; color: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={TRACK} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
      />
    </svg>
  );
}

function CompositeGauge({ score }: { score: number }) {
  const size = 220;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = Math.PI * r; // half circle
  const offset = c - (score / 100) * c;
  return (
    <div className="relative" style={{ width: size, height: size / 2 + 8 }}>
      <svg width={size} height={size / 2 + 8} viewBox={`0 0 ${size} ${size / 2 + 8}`} className="overflow-visible">
        <defs>
          <linearGradient id="gauge-grad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={ORANGE} />
            <stop offset="55%" stopColor={GREEN} />
            <stop offset="100%" stopColor={GREEN_DARK} />
          </linearGradient>
        </defs>
        <path
          d={`M ${stroke / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${size / 2}`}
          fill="none"
          stroke={TRACK}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={`M ${stroke / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${size / 2}`}
          fill="none"
          stroke="url(#gauge-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-2 flex justify-between px-1 text-[10px] font-semibold text-[rgba(27,43,56,0.4)] tabular-nums">
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </div>
    </div>
  );
}

export function ScorecardGrid() {
  const score = 86;
  return (
    <div className="min-h-[100dvh] bg-[#1B2B38] py-12 px-8 flex justify-center font-sans antialiased" style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div className="w-full flex flex-col gap-5" style={{ maxWidth: "980px" }}>

        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-[rgba(255,255,255,0.72)] text-[11px] font-bold tracking-[0.18em] uppercase">
              My Portfolio · Next 7 Days
            </h1>
            <span
              className="inline-flex items-center gap-1.5 text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded text-white"
              style={{ backgroundColor: GREEN }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              LIVE · 5
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="text-[10px] font-extrabold tracking-wider px-2 py-1 rounded border"
              style={{ color: "#86EFAC", backgroundColor: "rgba(107,165,57,0.14)", borderColor: "rgba(107,165,57,0.45)" }}
            >
              ON TRACK
            </span>
            <div
              className="flex items-center gap-0.5 p-0.5 rounded-lg"
              style={{ backgroundColor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {["7D", "30D", "60D", "90D"].map((w) => (
                <button
                  key={w}
                  className={`px-3 py-1 text-[11px] font-bold tracking-wider rounded-md transition-colors ${
                    w === "7D" ? "text-white shadow-sm" : "text-white/55 hover:text-white/85 hover:bg-white/5"
                  }`}
                  style={w === "7D" ? { backgroundColor: GREEN } : undefined}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Composite Health Tile */}
        <div
          className="bg-white rounded-2xl p-7 items-center"
          style={{
            boxShadow: "0 10px 30px -12px rgba(0,0,0,0.35)",
            display: "grid",
            gridTemplateColumns: "1fr auto",
            columnGap: "32px",
            alignItems: "center",
          }}
        >
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-extrabold tracking-[0.18em] uppercase text-[rgba(27,43,56,0.55)]">
                Composite Health
              </span>
              <span className="text-[10px] font-bold text-[rgba(27,43,56,0.4)]">·</span>
              <span className="text-[10px] font-semibold text-[rgba(27,43,56,0.55)] tracking-wide">
                Across 4 portfolios
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "20px" }}>
              <div style={{ display: "flex", alignItems: "baseline" }}>
                <span
                  className="tabular-nums"
                  style={{ fontSize: "92px", lineHeight: 0.9, fontWeight: 200, letterSpacing: "-0.04em", color: NAVY }}
                >
                  {score}
                </span>
                <span
                  className="tabular-nums"
                  style={{ fontSize: "22px", lineHeight: 1, fontWeight: 300, color: "rgba(27,43,56,0.35)", marginLeft: "6px" }}
                >
                  /100
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "8px" }}>
                <span
                  className="inline-flex items-center gap-1"
                  style={{ fontSize: "11px", fontWeight: 700, color: GREEN_DARK, backgroundColor: "rgba(21,128,61,0.10)", padding: "4px 8px", borderRadius: "6px" }}
                >
                  <TrendingUp size={12} strokeWidth={2.5} />
                  +2 vs last wk
                </span>
                <span style={{ fontSize: "10.5px", fontWeight: 600, color: "rgba(27,43,56,0.5)", letterSpacing: "0.02em" }}>
                  Healthy band · 80+
                </span>
              </div>
            </div>
            <div className="mt-5 flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: GREEN }} />
                <span className="text-[10.5px] font-semibold text-[rgba(27,43,56,0.6)]">2 healthy</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ORANGE }} />
                <span className="text-[10.5px] font-semibold text-[rgba(27,43,56,0.6)]">2 watch</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: RED }} />
                <span className="text-[10.5px] font-semibold text-[rgba(27,43,56,0.6)]">1 critical</span>
              </div>
            </div>
          </div>
          <CompositeGauge score={score} />
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-4 gap-4">
          {KPIS.map((kpi) => {
            const color = statusColor(kpi.status);
            const textColor = statusText(kpi.status);
            const trendUp = kpi.delta >= 0;
            return (
              <div
                key={kpi.label}
                className="bg-white rounded-2xl relative overflow-hidden flex flex-col px-5 pt-5 pb-4 transition-shadow hover:shadow-lg cursor-pointer"
                style={{ boxShadow: "0 6px 18px -10px rgba(0,0,0,0.3)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11px] font-bold tracking-wide uppercase text-[rgba(27,43,56,0.55)] leading-snug pr-1">
                    {kpi.label}
                  </span>
                  <div
                    className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
                    style={{ color: textColor, backgroundColor: `${color}1A` }}
                  >
                    {trendUp ? <TrendingUp size={10} strokeWidth={2.5} /> : <TrendingDown size={10} strokeWidth={2.5} />}
                    {trendUp ? "+" : ""}
                    {kpi.delta}
                  </div>
                </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div className="flex items-baseline gap-1">
                    <span className="text-[44px] leading-none font-light tabular-nums" style={{ color: NAVY }}>
                      {kpi.value}
                    </span>
                    <span className="text-[12px] font-light text-[rgba(27,43,56,0.35)] tabular-nums">/100</span>
                  </div>
                  <Ring value={kpi.value} color={color} size={48} stroke={5} />
                </div>
                <div className="mt-3">
                  <Sparkline data={kpi.trend} color={color} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] font-semibold tracking-wide" style={{ color: textColor }}>
                    {kpi.status === "good" ? "Healthy" : "Watch"}
                  </span>
                  <span className="text-[10px] font-semibold text-[rgba(27,43,56,0.4)] tracking-wide">7D</span>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-1" style={{ backgroundColor: color }} />
              </div>
            );
          })}
        </div>

        {/* Pinned Critical */}
        <div
          className="bg-white rounded-2xl relative overflow-hidden mt-1"
          style={{ boxShadow: "0 10px 30px -12px rgba(0,0,0,0.35)" }}
        >
          <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: "6px", backgroundColor: RED }} />
          <div style={{ paddingLeft: "32px", paddingRight: "24px", paddingTop: "24px", paddingBottom: "24px" }}>
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex items-center gap-2">
                <div
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md"
                  style={{ backgroundColor: RED }}
                >
                  <AlertTriangle size={11} color="#fff" strokeWidth={2.75} />
                  <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-white">
                    Pinned Critical
                  </span>
                </div>
                <span
                  className="text-[10px] font-bold tracking-wider px-2 py-1 rounded"
                  style={{ color: "rgba(27,43,56,0.6)", backgroundColor: "rgba(27,43,56,0.06)" }}
                >
                  RESOURCE · 7D
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10.5px] font-semibold text-[rgba(27,43,56,0.5)]">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: RED }} />
                Updated 3m ago
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "end", columnGap: "24px", marginBottom: "16px" }}>
              <div>
                <h3 className="text-[20px] font-bold leading-tight" style={{ color: NAVY }}>
                  Bruce Korrow — over-allocated 143%
                </h3>
                <p className="text-[13px] mt-1" style={{ color: "rgba(27,43,56,0.65)" }}>
                  Utilization breach across 42 projects
                </p>
              </div>
              <div className="flex items-center gap-5">
                <div className="text-right">
                  <div className="text-[10px] font-bold tracking-wider uppercase text-[rgba(27,43,56,0.45)]">Capacity</div>
                  <div className="text-[20px] font-light tabular-nums" style={{ color: RED }}>143%</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold tracking-wider uppercase text-[rgba(27,43,56,0.45)]">Projects</div>
                  <div className="text-[20px] font-light tabular-nums" style={{ color: NAVY }}>42</div>
                </div>
              </div>
            </div>

            <div
              className="rounded-xl p-4"
              style={{ backgroundColor: "rgba(220,38,38,0.04)", border: "1px solid rgba(220,38,38,0.14)" }}
            >
              <div className="flex items-center gap-1.5 mb-2.5">
                <Sparkles size={13} style={{ color: RED }} />
                <span className="text-[10px] font-extrabold tracking-[0.16em] uppercase" style={{ color: RED }}>
                  AI Analysis · Why this is critical
                </span>
              </div>
              <ul className="space-y-2">
                <li className="text-[12.5px] flex gap-2 items-start leading-relaxed" style={{ color: "rgba(27,43,56,0.85)" }}>
                  <span className="mt-1.5 w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: RED }} />
                  <span>Projected 143% utilization is 43 pts over capacity — burnout and slip risk are immediate, not theoretical.</span>
                </li>
                <li className="text-[12.5px] flex gap-2 items-start leading-relaxed" style={{ color: "rgba(27,43,56,0.85)" }}>
                  <span className="mt-1.5 w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: RED }} />
                  <span>Cascade exposure: a single re-plan touches 42 active projects — schedule, billing and client comms all move with it.</span>
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-between mt-4">
              <button className="text-[12px] font-semibold text-[rgba(27,43,56,0.55)] hover:text-[#1B2B38] transition-colors">
                Snooze 24h
              </button>
              <button
                className="inline-flex items-center gap-1.5 text-[13px] font-bold px-4 py-2 rounded-lg text-white transition-transform hover:scale-[1.02]"
                style={{ backgroundColor: GREEN }}
              >
                Resolve now <ArrowRight size={14} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
