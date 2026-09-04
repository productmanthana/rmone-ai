import { compactUsd } from "../lib/money";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingUp, X, Loader2, AlertCircle, CheckCircle, Circle, ChevronDown, Briefcase, Building2, Layers, Check, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";

import { setChatPrompt } from "@/lib/chatBridge";
import {
  getResourceAllocations,
  getResourceDemands,
  getAllocationUtilization,
  getResourceMaster,
  getModuleRecords,
} from "@/lib/api";
import { getBusinessRules, useBusinessRulesVersion } from "@/lib/businessRules";
import { readForecastSrc, writeForecastSrc, hasForecastSrcCache } from "@/lib/forecastCache";
import {
  buildForecast,
  computeForecastWindow,
  pickPursuit,
  getOpenPursuits,
  PIVOTS,
  type Pivot,
  type Scenario,
  type ForecastModel,
  type CollisionBar,
  type DrillPerson,
  type PursuitInfo,
  type OpenPursuit,
} from "@/lib/forecastIntelligence";

/* =============================================================
   RM ONE · Visual Forecasting (web)

   Mirrors the mobile Forecast screen layout (4 zones: heatmap,
   demand-vs-capacity curve, resource collision, scenario) but
   uses a desktop two-column grid below the heatmap. All chart
   data is derived from the same live allocation, demand and
   utilization data the rest of the app uses (see
   lib/forecastIntelligence.ts). The "Win pursuit" scenario
   re-renders every chart with a deterministic uplift modelling
   a hypothetical award.
   ============================================================= */

const BRAND = {
  bg: "var(--rm-bg)",
  bgDeep: "var(--rm-bg)",
  card: "var(--rm-panel)",
  cardBorder: "var(--rm-panel-border)",
  cardBorderStrong: "var(--rm-panel-border)",
  green: "#6BA539",
  greenBg: "var(--rm-green)",
  greenLight: "#A9C23F",
  greenDeep: "#4F8A2A",
  amber: "#C99633",
  amberDeep: "#A87A1F",
  orange: "#E87722",
  red: "#E03C3C",
  redSoft: "#F87171",
  white: "var(--rm-text)",
  textSecondary: "var(--rm-text-muted)",
  textMuted: "var(--rm-text-faint)",
};

/* =================  Company → BU → Division → Dept scope filter  =================
   Mirrors the cascading BU/Division/Dept filter on the Projects and Staff pages.
   The forecast model is built entirely from LiveResourceProxy resources (which
   carry businessUnit/divisionName/departmentName), so scoping the workforce here
   flows through to every pivot tab (Office / Role / Discipline) automatically. */
type OrgRow = { bu: string; division: string; dept: string };
type OrgFilterOption = { value: string; label: string; sub: string };
function buildOrgFilterOptions(rows: OrgRow[], buFilter: string, divFilter: string): {
  bus: string[]; divs: string[]; depts: OrgFilterOption[];
} {
  const norm = (s: string) => (s && s !== "—" ? s.trim() : "");
  const buSet = new Set<string>();
  const divSet = new Set<string>();
  const deptAllDivs = new Map<string, Set<string>>();
  const deptScoped = new Set<string>();
  for (const r of rows) {
    const bu = norm(r.bu), div = norm(r.division), dept = norm(r.dept);
    if (bu) buSet.add(bu);
    if (div && (buFilter === "All" || bu === buFilter)) divSet.add(div);
    if (dept) {
      if (!deptAllDivs.has(dept)) deptAllDivs.set(dept, new Set());
      if (div) deptAllDivs.get(dept)!.add(div);
    }
    if (dept && (buFilter === "All" || bu === buFilter) && (divFilter === "All" || div === divFilter)) {
      deptScoped.add(dept);
    }
  }
  const depts = Array.from(deptScoped).sort().map((dept) => {
    const divs = deptAllDivs.get(dept) ?? new Set<string>();
    const sub = divs.size > 1 ? `Under: ${Array.from(divs).sort().join(", ")}` : "";
    return { value: dept, label: dept, sub };
  });
  return { bus: Array.from(buSet).sort(), divs: Array.from(divSet).sort(), depts };
}

/* =================  Drill-down narrative helpers  =================
   The "drill into a cell" panel lists the real people behind a heatmap
   cell. Those contributors are precomputed in forecastIntelligence.ts
   (model.drill.cells[pivot][row][week]) from the same live utilization
   rows + allocations that feed the heatmap, so the panel and the chat
   hand-off never invent per-cell records. */

type ProjBar = CollisionBar;

type Contributor = DrillPerson;

/** Real contributors behind a heatmap cell, read from the live model. */
function contributorsFor(
  model: ForecastModel,
  pivot: Pivot,
  row: string,
  week: string,
): Contributor[] {
  return model.drill.cells[pivot]?.[row]?.[week] ?? [];
}

type HireRequisition = {
  role: string;
  count: number;
  week: string;
  month: string;
  salary: number;
  timeToFillWeeks: number;
  justification: string;
  drivers: string[];
};

const HIRE_UNIT_COST: Record<string, number> = {
  "Sr PM": 185000,
  "PM": 145000,
  "PE": 115000,
  "Estimator": 105000,
  "Super": 125000,
  "Foreman": 95000,
  "Designer": 95000,
};

function buildRequisition(model: ForecastModel, pivot: Pivot, scenario: Scenario): HireRequisition {
  const t = model.hireTrigger[pivot][scenario];
  const m = t.demand.match(/^(\d+)\s+(.+)$/);
  const count = m ? parseInt(m[1], 10) : 1;
  const role = m ? m[2] : t.demand;
  const salary = HIRE_UNIT_COST[role] ?? 130000;
  const drivers = model.collision[pivot].bars.map((b) => b.name);
  return {
    role,
    count,
    week: t.week,
    month: t.month,
    salary,
    timeToFillWeeks: 6,
    justification:
      `Demand crosses capacity in ${t.month} (${t.week}). Without ${count} additional ${role}${count > 1 ? "s" : ""}, peak utilization breaches 110% across pursuits in flight.`,
    drivers,
  };
}

/* =================  helpers  ================= */
function utilStatus(p: number): "ok" | "warn" | "over" {
  if (p >= 105) return "over";
  if (p >= 90) return "warn";
  return "ok";
}
function utilColor(p: number): string {
  const s = utilStatus(p);
  if (s === "over") return BRAND.red;
  if (s === "warn") return BRAND.amber;
  return BRAND.green;
}

/* =================  small components  ================= */

function Pill({
  children, bg, fg, border,
}: {
  children: React.ReactNode; bg?: string; fg?: string; border?: string;
}) {
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded text-[10.5px] font-bold"
      style={{
        backgroundColor: bg ?? "rgba(255,255,255,0.08)",
        color: fg ?? BRAND.white,
        border: border ? `1px solid ${border}` : "none",
        letterSpacing: "0.08em",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/* Reusable HEADLINE row — used by every chart zone for visual consistency:
   eyebrow label · title sentence · coloured answer · right tag. */
function HeadlineRow({
  title, answer, answerColor, rightTag,
}: {
  title: string;
  answer: string;
  answerColor: string;
  rightTag?: { text: string; bg?: string; fg?: string; border?: string };
}) {
  return (
    <div className="flex flex-col gap-1.5 mb-3">
      <div
        className="text-[10px] font-bold tracking-[0.16em]"
        style={{ color: BRAND.textMuted }}
      >
        HEADLINE
      </div>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[15px] font-semibold" style={{ color: BRAND.white }}>
            {title}
          </span>
          <span className="text-[15px] font-extrabold tabular-nums" style={{ color: answerColor }}>
            {answer}
          </span>
        </div>
        {rightTag && (
          <Pill bg={rightTag.bg} fg={rightTag.fg} border={rightTag.border}>
            {rightTag.text}
          </Pill>
        )}
      </div>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl ${className ?? ""}`}
      style={{
        backgroundColor: BRAND.card,
        border: `1px solid ${BRAND.cardBorder}`,
        padding: 18,
      }}
    >
      {children}
    </div>
  );
}

/* =================  Zone 1 — Heatmap  ================= */
function HeatmapZone({
  pivot, scenario, model, onCellClick, weekOffset, pageWeeks,
}: {
  pivot: Pivot;
  scenario: Scenario;
  model: ForecastModel;
  onCellClick: (row: string, week: string, pct: number) => void;
  weekOffset: number;
  pageWeeks: number;
}) {
  const rows = model.rowsByPivot[pivot];
  const data = model.heatmap[pivot][scenario];
  const fullHeadline = model.heatmapHeadline[pivot][scenario];
  const weeks = model.weekLabels.slice(weekOffset, weekOffset + pageWeeks);

  // The headline must describe what is ON SCREEN. The model-level headline is
  // computed over the full 52-week horizon, so it could name a week (e.g. W37)
  // outside the visible 8-week page — the user then sees "200%" while every
  // visible cell reads 100. Recompute the peak from the visible slice only.
  let headline = { week: weeks[0] ?? "W1", row: "", pct: 0 };
  for (const r of rows) {
    const series = (data[r] ?? []).slice(weekOffset, weekOffset + pageWeeks);
    for (let i = 0; i < series.length; i++) {
      if (series[i] > headline.pct) headline = { week: weeks[i], row: r, pct: series[i] };
    }
  }

  return (
    <Card>
      <HeadlineRow
        title="Peak overload week"
        answer={
          headline.pct > 0 && headline.row
            ? pivot === "Discipline"
              ? `${headline.week} · ${headline.row} ${headline.pct} idx`
              : `${headline.week} · ${headline.row} ${headline.pct}%`
            : fullHeadline.pct > 0 && fullHeadline.row
              ? `No overload in this window · peak at ${fullHeadline.week}`
              : "No overload in window"
        }
        answerColor={headline.pct >= 105 ? BRAND.red : headline.pct >= 90 ? BRAND.amber : BRAND.green}
      />

      {/* Grid: row label column + N week columns */}
      <div
        className="grid gap-1 mt-2"
        style={{
          gridTemplateColumns: `minmax(86px, 110px) repeat(${weeks.length}, minmax(0, 1fr))`,
        }}
      >
        {/* week header */}
        <div />
        {weeks.map((w) => {
          const isPeak = headline.pct > 0 && w === headline.week;
          return (
            <div
              key={w}
              className="text-center text-[11px] font-semibold py-1"
              style={{
                color: isPeak ? BRAND.red : BRAND.textSecondary,
              }}
            >
              {w}
            </div>
          );
        })}

        {rows.length === 0 ? (
          <div
            className="col-span-full text-[12px] py-6 text-center"
            style={{ color: BRAND.textMuted }}
          >
            No utilization data in the forecast window.
          </div>
        ) : (
          rows.map((row) => {
            const isPeakRow = row === headline.row;
            return (
              <Row
                key={row}
                row={row}
                weeks={weeks}
                data={(data[row] ?? []).slice(weekOffset, weekOffset + pageWeeks)}
                isPeakRow={isPeakRow}
                peakWeekIdx={weeks.indexOf(headline.week)}
                onCellClick={(week, pct) => onCellClick(row, week, pct)}
                isDiscipline={pivot === "Discipline"}
              />
            );
          })
        )}
      </div>

      {/* Legend + 8 WKS tag */}
      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-3 text-[11px]" style={{ color: BRAND.textSecondary }}>
          <LegendDot color={BRAND.green}  label="OK" />
          <LegendDot color={BRAND.amber}  label="Warn" />
          <LegendDot color={BRAND.red}    label="Overload" />
        </div>
        <Pill bg="rgba(255,255,255,0.08)" fg={BRAND.textSecondary}>{weeks.length} WKS</Pill>
      </div>
    </Card>
  );
}

function Row({
  row, weeks, data, isPeakRow, peakWeekIdx, onCellClick, isDiscipline,
}: {
  row: string;
  weeks: string[];
  data: number[];
  isPeakRow: boolean;
  peakWeekIdx: number;
  onCellClick: (week: string, pct: number) => void;
  isDiscipline?: boolean;
}) {
  return (
    <>
      <div
        className="flex items-center text-[12px] truncate pr-2"
        style={{
          color: isPeakRow ? BRAND.white : BRAND.textSecondary,
          fontWeight: isPeakRow ? 700 : 500,
        }}
        title={row}
      >
        {row}
      </div>
      {weeks.map((week, i) => {
        const v = data[i] ?? 0;
        const status = utilStatus(v);
        const bg = v > 0 ? utilColor(v) : "rgba(255,255,255,0.04)";
        const isPeakCell = isPeakRow && i === peakWeekIdx;
        const tipSuffix = isDiscipline ? " (load index · 100 = firm avg)" : "% — click to see who's behind it";
        return (
          <button
            key={i}
            type="button"
            onClick={() => onCellClick(week, v)}
            className="flex items-center justify-center rounded transition-transform hover:scale-[1.06] focus:outline-none focus:ring-2 focus:ring-white/60"
            style={{
              backgroundColor: bg,
              height: 30,
              border: isPeakCell ? `1.5px solid ${BRAND.white}` : "1px solid rgba(0,0,0,0.10)",
              boxShadow: isPeakCell ? "0 0 0 1px rgba(0,0,0,0.20)" : "none",
              cursor: "pointer",
              padding: 0,
            }}
            title={`${row} · ${week} · ${v}${tipSuffix}`}
            aria-label={`${row} ${week} ${isDiscipline ? `load index ${v}` : `${v}%`} — open contributors`}
          >
            {v > 0 && (
              <span
                className="text-[11px] font-extrabold tabular-nums"
                style={{ color: status === "ok" ? "rgba(0,0,0,0.55)" : "#FFFFFF" }}
              >
                {v}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        style={{
          width: 10, height: 10, borderRadius: "50%", backgroundColor: color,
          display: "inline-block",
        }}
      />
      <span>{label}</span>
    </span>
  );
}

/* =================  Zone 2 — Demand vs Capacity  ================= */
function DemandCapacityZone({
  pivot, scenario, model, onHireClick, weekOffset, pageWeeks,
}: {
  pivot: Pivot;
  scenario: Scenario;
  model: ForecastModel;
  onHireClick: () => void;
  weekOffset: number;
  pageWeeks: number;
}) {
  const series = model.demandCap[pivot][scenario];
  const trigger = model.hireTrigger[pivot][scenario];
  const weeks = model.weekLabels.slice(weekOffset, weekOffset + pageWeeks);
  const demand = series.demand.slice(weekOffset, weekOffset + pageWeeks);
  const capacity = series.capacity.slice(weekOffset, weekOffset + pageWeeks);

  // Compute SVG layout. demand & capacity are now in FTE units (counts of
  // people), so we derive the y-axis range dynamically from the data and
  // pad ~15% headroom so the HIRE callout doesn't clip.
  const W = 600;
  const H = 180;
  const padL = 36;
  const padR = 16;
  const padT = 24;
  const padB = 26;

  const allValues = [...demand, ...capacity].filter((v) => Number.isFinite(v));
  const dataMax = allValues.length > 0 ? Math.max(...allValues) : 1;
  const maxY = Math.max(1, dataMax * 1.15);
  const minY = 0;

  const x = (i: number) =>
    padL + (i * (W - padL - padR)) / Math.max(1, weeks.length - 1);
  const y = (v: number) =>
    padT + (1 - (v - minY) / Math.max(1, maxY - minY)) * (H - padT - padB);

  const demandPath = demand
    .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`)
    .join(" ");
  const capPath = capacity
    .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`)
    .join(" ");

  // Crossover index — first week where demand > capacity
  const crossIdx = demand.findIndex((d, i) => d > capacity[i]);
  const crossX = crossIdx >= 0 ? x(crossIdx) : x(weeks.length - 1);
  const crossY = crossIdx >= 0 ? y(demand[crossIdx]) : y(demand[weeks.length - 1] ?? 0);

  const hasCrossover = crossIdx >= 0;

  return (
    <Card>
      <HeadlineRow
        title="Hiring trigger month"
        answer={
          hasCrossover
            ? `${trigger.month} · ${trigger.week} · ${trigger.demand}`
            : "Capacity covers demand"
        }
        answerColor={hasCrossover ? BRAND.orange : BRAND.green}
        rightTag={
          hasCrossover
            ? { text: "DEMAND CROSSES CAP", bg: "rgba(232,119,34,0.18)", fg: BRAND.orange, border: "rgba(232,119,34,0.40)" }
            : undefined
        }
      />

      <div className="w-full" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
          {/* Capacity (flat reference) */}
          <path d={capPath} fill="none" stroke={BRAND.textMuted} strokeWidth={2} strokeDasharray="6 4" />
          {/* Demand */}
          <path d={demandPath} fill="none" stroke={BRAND.orange} strokeWidth={2.5} />
          {/* HIRE annotation at crossover — clickable to open the
              suggested hiring requisition. The transparent hit-area
              extends across the full plot height around the crossover
              so it's easy to tap. */}
          {hasCrossover && (
            <>
              <line
                x1={crossX} x2={crossX}
                y1={padT - 2} y2={H - padB + 2}
                stroke="rgba(255,255,255,0.20)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <circle cx={crossX} cy={crossY} r={4} fill={BRAND.orange} stroke="#fff" strokeWidth={1} />
              <g
                onClick={onHireClick}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onHireClick();
                  }
                }}
                style={{ cursor: "pointer", outline: "none" }}
                role="button"
                tabIndex={0}
                aria-label={`Open hiring requisition for ${trigger.demand} in ${trigger.month}`}
              >
                <rect
                  x={crossX - 28} y={padT - 8}
                  width={56} height={28} rx={4}
                  fill="transparent"
                />
                <rect
                  x={crossX - 22} y={padT - 4}
                  width={44} height={18} rx={3}
                  fill={BRAND.orange}
                />
                <text
                  x={crossX} y={padT + 8}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={800}
                  fill="#FFFFFF"
                  letterSpacing="1.5"
                >HIRE</text>
              </g>
            </>
          )}
          {/* Y-axis ticks (0, capacity, max) so readers can see FTE units */}
          {(() => {
            const ticks = Array.from(new Set([
              0,
              capacity[0] || 0,
              Math.round(maxY),
            ])).filter((t) => t >= 0).sort((a, b) => a - b);
            return ticks.map((t) => (
              <g key={t}>
                <line
                  x1={padL - 4} x2={W - padR}
                  y1={y(t)} y2={y(t)}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth={1}
                />
                <text
                  x={padL - 6} y={y(t) + 3}
                  textAnchor="end"
                  fontSize={9}
                  fill={BRAND.textMuted}
                >{t}</text>
              </g>
            ));
          })()}
          {/* Week tick labels */}
          {weeks.map((w, i) => (
            <text
              key={w}
              x={x(i)} y={H - 8}
              textAnchor="middle"
              fontSize={9}
              fill={BRAND.textMuted}
            >
              {w}
            </text>
          ))}
        </svg>
      </div>

      {/* Mini legend */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-4 text-[11px]" style={{ color: BRAND.textSecondary }}>
          <LegendBar color={BRAND.orange} label="Demand" />
          <LegendBar color={BRAND.textMuted} label="Capacity" dashed />
        </div>
        <Pill bg="rgba(255,255,255,0.08)" fg={BRAND.textSecondary}>FTE</Pill>
      </div>
    </Card>
  );
}

function LegendBar({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        style={{
          width: 18, height: 0,
          borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}`,
          display: "inline-block",
        }}
      />
      <span>{label}</span>
    </span>
  );
}

/* =================  Zone 3 — Resource Collision  ================= */
function CollisionZone({
  pivot, model, onOverlapClick, onProjectClick, weekOffset, pageWeeks,
}: {
  pivot: Pivot;
  model: ForecastModel;
  onOverlapClick: (week: string) => void;
  onProjectClick: (project: ProjBar) => void;
  weekOffset: number;
  pageWeeks: number;
}) {
  const c = model.collision[pivot];
  const weeks = model.weekLabels.slice(weekOffset, weekOffset + pageWeeks);
  const weekPct = c.weekPct.slice(weekOffset, weekOffset + pageWeeks);
  const hasData = c.bars.length > 0 && c.person !== "—";

  // The model-level failWeek/pct are computed over the full 52-week horizon,
  // so they can name a week outside the visible page (e.g. "W1" while viewing
  // W29–W36). Show the person's worst week WITHIN the visible window when
  // they have load here; otherwise fall back to the model values.
  let failWeek = c.failWeek;
  let failPct = c.pct;
  {
    let mx = 0, mi = -1;
    for (let i = 0; i < weekPct.length; i++) {
      if ((weekPct[i] ?? 0) > mx) { mx = weekPct[i]; mi = i; }
    }
    if (mi >= 0 && mx > 0) { failWeek = weeks[mi]; failPct = mx; }
  }

  return (
    <Card>
      <HeadlineRow
        title="Resource failure point"
        answer={hasData ? `${failWeek} · ${failPct}%` : "No collisions detected"}
        answerColor={hasData ? BRAND.red : BRAND.green}
        rightTag={
          hasData
            ? {
                text: `${c.person} · ${c.bars.length} PROJECT${c.bars.length === 1 ? "" : "S"} · ${failPct}%`,
                bg: "rgba(224,60,60,0.15)",
                fg: BRAND.redSoft,
                border: "rgba(224,60,60,0.40)",
              }
            : undefined
        }
      />

      <div
        className="grid gap-1 mt-2"
        style={{
          gridTemplateColumns: `minmax(88px, 110px) repeat(${weeks.length}, minmax(0, 1fr))`,
        }}
      >
        {/* header */}
        <div />
        {weeks.map((w) => (
          <div
            key={w}
            className="text-center text-[11px] font-semibold py-1"
            style={{
              color: w === failWeek ? BRAND.redSoft : BRAND.textSecondary,
              fontWeight: w === failWeek ? 700 : 600,
            }}
          >
            {w}
          </div>
        ))}

        {hasData ? (
          c.bars.map((b) => (
            <ProjectRow
              key={b.name}
              bar={b}
              weeks={weeks}
              weekPct={weekPct}
              failWeek={failWeek}
              onProjectClick={() => onProjectClick(b)}
            />
          ))
        ) : (
          <div
            className="col-span-full text-[12px] py-6 text-center"
            style={{ color: BRAND.textMuted }}
          >
            No overlapping project allocations in the forecast window.
          </div>
        )}

        {hasData && (
          <>
            {/* OVERLAP band */}
            <div
              className="flex items-center text-[11px] uppercase tracking-wide"
              style={{ color: BRAND.textSecondary, fontWeight: 700 }}
            >
              OVERLAP
            </div>
            {weeks.map((w, i) => {
              const isFail = c.overlap.includes(w);
              const wp = weekPct[i] ?? 0;
              return (
                <button
                  key={w}
                  type="button"
                  onClick={() => isFail && onOverlapClick(w)}
                  disabled={!isFail}
                  className={`rounded flex items-center justify-center ${isFail ? "transition-transform hover:scale-y-110 focus:outline-none focus:ring-2 focus:ring-white/60" : ""}`}
                  style={{
                    height: 22,
                    marginTop: 4,
                    padding: 0,
                    backgroundColor: isFail ? BRAND.red : "rgba(255,255,255,0.06)",
                    border: isFail ? `1px solid ${BRAND.red}` : "1px solid rgba(255,255,255,0.05)",
                    cursor: isFail ? "pointer" : "default",
                  }}
                  title={isFail ? `Overlap collision · ${w} · ${wp}% — click to open re-balance` : `No overlap · ${w}${wp > 0 ? ` · ${wp}%` : ""}`}
                  aria-label={isFail ? `Open re-balance for overlap collision in ${w}, ${wp}%` : undefined}
                >
                  {wp > 0 && (
                    <span
                      className="text-[10px] font-extrabold tabular-nums"
                      style={{ color: isFail ? "#FFFFFF" : BRAND.textSecondary }}
                    >
                      {wp}
                    </span>
                  )}
                </button>
              );
            })}
          </>
        )}
      </div>
    </Card>
  );
}

function ProjectRow({
  bar, weeks, weekPct, failWeek, onProjectClick,
}: {
  bar: ProjBar;
  weeks: string[];
  weekPct: number[];
  failWeek: string;
  onProjectClick: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onProjectClick}
        className="flex items-center text-[12px] truncate pr-2 text-left transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-white/60 rounded"
        style={{ color: BRAND.white, fontWeight: 600, cursor: "pointer", background: "transparent", border: "none", padding: 0 }}
        title={`${bar.name} — open re-balance`}
        aria-label={`Open re-balance options for ${bar.name}`}
      >
        {bar.name}
      </button>
      {weeks.map((w, i) => {
        const active = bar.weeks.includes(w);
        const isCollidingHere = active && w === failWeek;
        const pct = weekPct[i] ?? 0;
        return (
          <button
            key={w}
            type="button"
            onClick={() => active && onProjectClick()}
            disabled={!active}
            className={`rounded flex items-center justify-center ${active ? "transition-transform hover:scale-y-110 focus:outline-none focus:ring-2 focus:ring-white/60" : ""}`}
            style={{
              height: 22,
              padding: 0,
              backgroundColor: active
                ? (isCollidingHere ? BRAND.red : BRAND.orange)
                : "rgba(255,255,255,0.04)",
              border: isCollidingHere ? `1px solid ${BRAND.red}` : "1px solid rgba(0,0,0,0.10)",
              cursor: active ? "pointer" : "default",
            }}
            title={active ? `${bar.name} · ${w} — open re-balance` : ""}
            aria-label={active ? `Open re-balance options for ${bar.name} in ${w}` : undefined}
          >
            {active && pct > 0 && (
              <span className="text-[10px] font-extrabold tabular-nums" style={{ color: "#FFFFFF" }}>
                {pct}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

/* =================  Loading Modal  ================= */
/** Replaces the inline "Loading forecast…" bar with a centered floating card
 *  showing a live checklist so the user can see which queries are in flight. */
function ForecastLoadingModal({
  allocLoaded, utilLoaded, demandLoaded, modelReady,
}: {
  allocLoaded: boolean;
  utilLoaded: boolean;
  demandLoaded: boolean;
  modelReady: boolean;
}) {
  const steps: { label: string; done: boolean }[] = [
    { label: "Fetching allocations", done: allocLoaded },
    { label: "Loading utilization data", done: utilLoaded },
    { label: "Fetching open demand", done: demandLoaded },
    { label: "Building forecast model", done: modelReady },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const progress = Math.round((doneCount / steps.length) * 100);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        backgroundColor: "rgba(0,0,0,0.52)",
        backdropFilter: "blur(4px)",
      }}
      aria-modal="true"
      role="dialog"
      aria-label="Loading forecast"
    >
      <div
        style={{
          backgroundColor: "var(--rm-panel)",
          border: "1px solid var(--rm-panel-border)",
          borderRadius: 16,
          padding: "28px 32px",
          width: 340,
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
        }}
      >
        {/* Logo + title row */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 11,
              backgroundColor: BRAND.green,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <TrendingUp size={20} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.white, lineHeight: 1.2 }}>
              Loading Forecast
            </div>
            <div style={{ fontSize: 11, color: BRAND.textSecondary, marginTop: 2 }} id="forecast-loading-subtitle">
              Preparing your forecast view…
            </div>
          </div>
        </div>

        {/* Step checklist */}
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          {steps.map((step, i) => {
            const isActive = !step.done && steps.slice(0, i).every((s) => s.done);
            return (
              <div key={step.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {step.done ? (
                  <CheckCircle size={16} color={BRAND.green} style={{ flexShrink: 0 }} />
                ) : isActive ? (
                  /* CSS ring spinner — cleaner than Loader2's semicircle icon */
                  <div
                    className="animate-spin"
                    style={{
                      flexShrink: 0,
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      border: `2px solid rgba(107,165,57,0.25)`,
                      borderTopColor: BRAND.green,
                    }}
                  />
                ) : (
                  <Circle size={16} color={BRAND.textMuted} style={{ flexShrink: 0 }} />
                )}
                <span
                  style={{
                    fontSize: 13,
                    color: step.done ? BRAND.white : isActive ? BRAND.white : BRAND.textMuted,
                    transition: "color 0.2s",
                  }}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div
          style={{
            marginTop: 22,
            height: 4,
            borderRadius: 4,
            backgroundColor: "var(--rm-panel-soft, rgba(255,255,255,0.07))",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              borderRadius: 4,
              backgroundColor: BRAND.green,
              width: `${progress}%`,
              transition: "width 0.4s ease",
            }}
          />
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 10,
            color: BRAND.textMuted,
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {progress}%
        </div>
      </div>
    </div>
  );
}

/* =================  Pursuit picker dropdown  ================= */
function PursuitDropdown({
  opps, selectedId, onSelect,
}: {
  opps: OpenPursuit[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = opps.find((o) => o.id === selectedId) ?? opps[0];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          backgroundColor: "rgba(255,255,255,0.07)",
          border: `1px solid ${BRAND.cardBorder}`,
          borderRadius: 8,
          color: BRAND.white,
          fontSize: 12,
          fontWeight: 600,
          padding: "5px 10px",
          cursor: "pointer",
          minWidth: 170,
          maxWidth: 220,
        }}
      >
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected?.title.length > 22 ? `${selected.title.slice(0, 21)}…` : (selected?.title ?? "Select pursuit")}
        </span>
        {selected?.valueLabel && (
          <span style={{ color: BRAND.greenLight, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>
            {selected.valueLabel}
          </span>
        )}
        <ChevronDown size={12} style={{ flexShrink: 0, color: BRAND.textSecondary, marginLeft: 2 }} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 5px)",
            right: 0,
            backgroundColor: BRAND.card,
            border: `1px solid ${BRAND.cardBorder}`,
            borderRadius: 10,
            boxShadow: "0 8px 28px rgba(0,0,0,0.5)",
            zIndex: 60,
            minWidth: 260,
            maxHeight: 260,
            overflowY: "auto",
          }}
          className="rm-slim-scroll"
        >
          {opps.map((o) => {
            const isActive = o.id === selectedId;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => { onSelect(o.id); setOpen(false); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                  width: "100%",
                  padding: "10px 14px",
                  backgroundColor: isActive ? "rgba(107,165,57,0.15)" : "transparent",
                  border: "none",
                  borderBottom: `1px solid rgba(255,255,255,0.05)`,
                  color: isActive ? BRAND.white : BRAND.textSecondary,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(255,255,255,0.05)"; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
              >
                <span style={{ fontSize: 12, fontWeight: isActive ? 700 : 500, flex: 1, lineHeight: 1.35 }}>
                  {o.title}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: BRAND.greenLight,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    backgroundColor: "rgba(107,165,57,0.12)",
                    border: "1px solid rgba(107,165,57,0.30)",
                    borderRadius: 5,
                    padding: "1px 6px",
                  }}
                >
                  {o.valueLabel}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* =================  Zone 4 — Scenario Panel  ================= */
function ScenarioPanel({
  scenario, onChange, pursuit, opps, selectedOppId, onSelectOpp,
}: {
  scenario: Scenario;
  onChange: (s: Scenario) => void;
  pursuit: PursuitInfo;
  opps: OpenPursuit[];
  selectedOppId: string | null;
  onSelectOpp: (id: string) => void;
}) {
  // Truncate long pursuit titles so the headline stays readable.
  const shortTitle =
    pursuit.title.length > 36
      ? `${pursuit.title.slice(0, 35)}…`
      : pursuit.title;
  const headline = pursuit.hasPursuit
    ? `What if we win ${shortTitle}?`
    : "No open pursuits to model";
  const detail = !pursuit.hasPursuit
    ? "Add an opportunity to RM ONE to model a win-pursuit scenario."
    : pursuit.estimated
      ? `No contract value on file — modelled at ${pursuit.valueLabel} to show impact`
      : `Selected from your open pipeline · ${pursuit.valueLabel}`;

  return (
    <Card>
      <div className="flex flex-col gap-1.5 mb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div
            className="text-[10px] font-bold tracking-[0.16em]"
            style={{ color: BRAND.green }}
          >
            SCENARIO
          </div>
          {/* Opportunity picker — only shown when there are 2+ open opps */}
          {opps.length > 1 && (
            <PursuitDropdown
              opps={opps}
              selectedId={selectedOppId}
              onSelect={onSelectOpp}
            />
          )}
        </div>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <span className="text-[15px] font-semibold" style={{ color: BRAND.white }}>
            {headline}
          </span>
          {pursuit.hasPursuit && (
            <Pill
              bg="rgba(107,165,57,0.18)"
              fg={BRAND.greenLight}
              border="rgba(107,165,57,0.45)"
            >
              {pursuit.valueLabel}
            </Pill>
          )}
        </div>
        <div
          className="text-[11px]"
          style={{ color: BRAND.textSecondary }}
        >
          {detail}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ScenarioButton
          label="Base case"
          active={scenario === "Base"}
          onClick={() => onChange("Base")}
        />
        <ScenarioButton
          label="Win pursuit"
          active={scenario === "Win"}
          onClick={() => pursuit.hasPursuit && onChange("Win")}
          accent
          disabled={!pursuit.hasPursuit}
        />
      </div>

      <div
        className="mt-3 text-[12px]"
        style={{ color: BRAND.textSecondary }}
      >
        Select an opportunity above, then tap{" "}
        <span style={{ color: BRAND.greenLight, fontWeight: 700 }}>Win pursuit</span>
        {" "}to model FTE impact &amp; hire triggers.
      </div>
    </Card>
  );
}

function ScenarioButton({
  label, active, onClick, accent, disabled,
}: {
  label: string; active: boolean; onClick: () => void; accent?: boolean; disabled?: boolean;
}) {
  const activeBg = accent ? BRAND.green : BRAND.card;
  const activeFg = "#FFFFFF";
  const idleBg = "var(--rm-panel-soft)";
  const idleFg = BRAND.white;
  const idleBorder = "var(--rm-panel-border)";
  const activeBorder = accent ? BRAND.green : "var(--rm-panel-border)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg text-[13px] font-semibold transition-colors"
      style={{
        height: 42,
        backgroundColor: active ? activeBg : idleBg,
        color: active ? activeFg : idleFg,
        border: `1px solid ${active ? activeBorder : idleBorder}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!active && !disabled) e.currentTarget.style.backgroundColor = "var(--rm-panel-hover)";
      }}
      onMouseLeave={(e) => {
        if (!active && !disabled) e.currentTarget.style.backgroundColor = idleBg;
      }}
    >
      {label}
    </button>
  );
}

/* =================  Drill-down side panel  =================
   Slides in from the right when the user clicks a heatmap cell, the
   HIRE annotation, an OVERLAP band, or a project bar in Zone 3.
   The panel summarizes the records driving the number and offers a
   "Re-balance in chat" hand-off that builds a tailored playbook
   prompt and routes into the AI Chat via setChatPrompt. */
type Drill =
  | { kind: "cell"; pivot: Pivot; scenario: Scenario; row: string; week: string; pct: number }
  | { kind: "hire"; pivot: Pivot; scenario: Scenario }
  | { kind: "overlap"; pivot: Pivot; week: string }
  | { kind: "project"; pivot: Pivot; project: ProjBar }
  | null;

function DrillPanel({
  drill, model, onClose, onHandoff,
}: {
  drill: Drill;
  model: ForecastModel;
  onClose: () => void;
  onHandoff: (prompt: string) => void;
}) {
  if (!drill) return null;

  let title = "";
  let subtitle = "";
  let body: React.ReactNode = null;
  let cta = "Re-balance in chat";
  let prompt = "";

  if (drill.kind === "cell") {
    const { pivot, row, week, pct } = drill;
    const status = utilStatus(pct);
    const statusLabel = status === "over" ? "OVERLOAD" : status === "warn" ? "WATCH" : "HEALTHY";
    const statusColor = utilColor(pct);
    const list = contributorsFor(model, pivot, row, week);
    title = `${row} · ${week}`;
    subtitle = pivot === "Discipline"
      ? `${pct} load index · ${statusLabel} (100 = firm avg)`
      : `${pct}% utilization · ${statusLabel}`;
    body = (
      <>
        <PanelStat label="Lens" value={pivot} />
        <PanelStat label="Status" value={statusLabel} valueColor={statusColor} />
        <PanelStat label="Contributors" value={`${list.length} people`} />
        <PanelDivider />
        <div className="text-[11px] font-bold tracking-[0.16em] mb-2" style={{ color: BRAND.textMuted }}>
          WHO &amp; WHAT
        </div>
        {list.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {list.map((c) => (
              <li
                key={`${c.name}-${c.project}`}
                className="flex items-center justify-between gap-3 rounded-md px-3 py-2"
                style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-[13px] font-semibold truncate" style={{ color: BRAND.white }}>
                    {c.name}
                  </span>
                  <span className="text-[11px] truncate" style={{ color: BRAND.textSecondary }}>
                    {c.role} · {c.project}
                  </span>
                </div>
                <span className="text-[13px] font-extrabold tabular-nums" style={{ color: utilColor(c.pct) }}>
                  {+c.pct.toFixed(2)}%
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[12px] py-4 text-center" style={{ color: BRAND.textMuted }}>
            No per-person allocation detail available for this cell.
          </div>
        )}
      </>
    );
    cta = status === "ok" ? "Plan in chat" : "Re-balance in chat";
    const lines = list.map((c) => `- ${c.name} (${c.role}) on ${c.project} · ${c.pct}%`).join("\n");
    prompt = [
      `Drill into the ${pivot} ${row} ${week} utilization at ${pct}% (${statusLabel}).`,
      `These are the people and projects driving that number:\n${lines}`,
      status === "over"
        ? `Recommend specific re-balancing moves that bring utilization under 100% — call out names, projects, and the week the move takes effect. Confirm before anything irreversible is written back to RM ONE.`
        : `Walk me through the headline drivers, flag any risks for the next two weeks, and suggest 1–3 next steps with named owners.`,
    ].join(" ");
  } else if (drill.kind === "hire") {
    const r = buildRequisition(model, drill.pivot, drill.scenario);
    const totalCost = (r.salary * r.count).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    title = `Hire ${r.count} ${r.role}${r.count > 1 ? "s" : ""}`;
    subtitle = `${r.month} · ${r.week} · demand crosses capacity`;
    body = (
      <>
        <PanelStat label="Role" value={r.role} />
        <PanelStat label="Headcount" value={`${r.count}`} />
        <PanelStat label="Target start" value={`${r.month} · ${r.week}`} />
        <PanelStat label="Time-to-fill" value={`~${r.timeToFillWeeks} weeks`} />
        <PanelStat label="Loaded salary" value={`$${r.salary.toLocaleString()} / yr`} />
        <PanelStat label="Annualized cost" value={totalCost} valueColor={BRAND.orange} />
        <PanelDivider />
        <div className="text-[11px] font-bold tracking-[0.16em] mb-2" style={{ color: BRAND.textMuted }}>
          JUSTIFICATION
        </div>
        <p className="text-[13px] leading-snug mb-3" style={{ color: BRAND.white }}>
          {r.justification}
        </p>
        <div className="text-[11px] font-bold tracking-[0.16em] mb-2" style={{ color: BRAND.textMuted }}>
          DRIVING PROJECTS
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {r.drivers.map((d) => (
            <li key={d}>
              <Pill bg="rgba(232,119,34,0.18)" fg={BRAND.orange} border="rgba(232,119,34,0.40)">
                {d}
              </Pill>
            </li>
          ))}
        </ul>
      </>
    );
    cta = "Open requisition in chat";
    prompt = [
      `The forecast suggests opening a hiring requisition: ${r.count} ${r.role}${r.count > 1 ? "s" : ""}, target start ${r.month} (${r.week}), loaded salary ~$${r.salary.toLocaleString()}/yr (annualized cost ${totalCost}), time-to-fill ~${r.timeToFillWeeks} weeks.`,
      `Justification: ${r.justification}`,
      `Driving projects: ${r.drivers.join(", ")}.`,
      `Draft the requisition (role profile, must-have skills, priority), recommend 2–3 sourcing channels, and outline a 30/60/90-day ramp plan. Confirm before posting anything externally.`,
    ].join(" ");
  } else if (drill.kind === "overlap") {
    const c = model.collision[drill.pivot];
    title = `Resource collision · ${drill.week}`;
    subtitle = `${c.person} loaded to ${+c.pct.toFixed(2)}% across ${c.bars.length} projects`;
    body = (
      <>
        <PanelStat label="Person" value={c.person} valueColor={BRAND.redSoft} />
        <PanelStat label="Peak load" value={`${+c.pct.toFixed(2)}%`} valueColor={BRAND.red} />
        <PanelStat label="Failure week" value={c.failWeek} valueColor={BRAND.redSoft} />
        <PanelDivider />
        <div className="text-[11px] font-bold tracking-[0.16em] mb-2" style={{ color: BRAND.textMuted }}>
          COLLIDING PROJECTS
        </div>
        <ul className="flex flex-col gap-1.5">
          {c.bars.map((b) => (
            <li
              key={b.name}
              className="flex items-center justify-between gap-3 rounded-md px-3 py-2"
              style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <span className="text-[13px] font-semibold" style={{ color: BRAND.white }}>{b.name}</span>
              <span className="text-[11px] tabular-nums" style={{ color: BRAND.textSecondary }}>
                {b.weeks[0]}–{b.weeks[b.weeks.length - 1]}
              </span>
            </li>
          ))}
        </ul>
      </>
    );
    prompt = [
      `Resolve a resource collision in ${drill.week}: ${c.person} is allocated ${c.pct}% across ${c.bars.length} projects (${c.bars.map((b) => b.name).join(", ")}).`,
      `Re-balance the schedule so no resource exceeds 100% in ${c.failWeek}. Recommend specific moves (which project, which week, who picks it up), name the trade-offs, and confirm before anything is written back to RM ONE.`,
    ].join(" ");
  } else if (drill.kind === "project") {
    const c = model.collision[drill.pivot];
    const others = c.bars.filter((b) => b.name !== drill.project.name);
    title = `Project · ${drill.project.name}`;
    subtitle = `Collides in ${c.failWeek} with ${others.length} other project${others.length === 1 ? "" : "s"}`;
    body = (
      <>
        <PanelStat label="Project" value={drill.project.name} />
        <PanelStat label="Active weeks" value={`${drill.project.weeks[0]}–${drill.project.weeks[drill.project.weeks.length - 1]}`} />
        <PanelStat label="Person at risk" value={c.person} valueColor={BRAND.redSoft} />
        <PanelStat label="Peak load" value={`${+c.pct.toFixed(2)}%`} valueColor={BRAND.red} />
        <PanelDivider />
        <div className="text-[11px] font-bold tracking-[0.16em] mb-2" style={{ color: BRAND.textMuted }}>
          COLLIDING WITH
        </div>
        <ul className="flex flex-col gap-1.5">
          {others.map((b) => (
            <li
              key={b.name}
              className="flex items-center justify-between gap-3 rounded-md px-3 py-2"
              style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <span className="text-[13px] font-semibold" style={{ color: BRAND.white }}>{b.name}</span>
              <span className="text-[11px] tabular-nums" style={{ color: BRAND.textSecondary }}>
                {b.weeks[0]}–{b.weeks[b.weeks.length - 1]}
              </span>
            </li>
          ))}
        </ul>
      </>
    );
    prompt = [
      `Project ${drill.project.name} is part of a resource collision in ${c.failWeek}. ${c.person} is loaded to ${c.pct}% because ${drill.project.name} overlaps with ${others.map((b) => b.name).join(" and ")}.`,
      `Recommend specific re-balancing moves for ${drill.project.name}: which weeks to shift, who could pick up the work, and the impact on the other projects. Confirm before anything is written back to RM ONE.`,
    ].join(" ");
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.45)",
          zIndex: 60,
        }}
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(420px, 92vw)",
          backgroundColor: BRAND.bgDeep,
          borderLeft: `1px solid ${BRAND.cardBorderStrong}`,
          color: BRAND.white,
          display: "flex",
          flexDirection: "column",
          zIndex: 61,
          boxShadow: "-12px 0 30px rgba(0,0,0,0.35)",
        }}
      >
        <header
          className="flex items-start justify-between gap-3 px-5 py-4"
          style={{ borderBottom: `1px solid ${BRAND.cardBorder}` }}
        >
          <div className="flex flex-col min-w-0">
            <div className="text-[10px] font-bold tracking-[0.18em]" style={{ color: BRAND.textMuted }}>
              FORECAST DRILL-DOWN
            </div>
            <div className="text-[16px] font-extrabold leading-tight mt-1" style={{ color: BRAND.white }}>
              {title}
            </div>
            <div className="text-[12px] mt-0.5" style={{ color: BRAND.textSecondary }}>
              {subtitle}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drill-down"
            className="rounded-md p-1.5 transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/60"
            style={{ color: BRAND.textSecondary }}
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {body}
        </div>

        <footer
          className="px-5 py-4"
          style={{ borderTop: `1px solid ${BRAND.cardBorder}`, backgroundColor: BRAND.bg }}
        >
          <button
            type="button"
            onClick={() => onHandoff(prompt)}
            className="w-full rounded-lg text-[13px] font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-white/60"
            style={{
              height: 44,
              backgroundColor: BRAND.greenBg,
              color: BRAND.white,
              border: `1px solid ${BRAND.greenDeep}`,
              cursor: "pointer",
              letterSpacing: "0.04em",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = BRAND.greenDeep; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = BRAND.green; }}
          >
            {cta}
          </button>
          <div className="text-[11px] mt-2 text-center" style={{ color: BRAND.textMuted }}>
            Hands off to AI Chat with the records you clicked.
          </div>
        </footer>
      </aside>
    </>
  );
}

function PanelStat({
  label, value, valueColor,
}: {
  label: string; value: string; valueColor?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: BRAND.textMuted }}>
        {label}
      </span>
      <span className="text-[13px] font-bold tabular-nums" style={{ color: valueColor ?? BRAND.white }}>
        {value}
      </span>
    </div>
  );
}

function PanelDivider() {
  return (
    <div
      className="my-3"
      style={{ height: 1, backgroundColor: "rgba(255,255,255,0.08)" }}
    />
  );
}

/* =================  Scope filter bar (BU / Division / Department)  =================
   Same cascading pattern as ResOrgFilterBar (resources.tsx) / the Projects page —
   3 independent pills that combine as AND conditions and cascade: picking a BU
   scopes the Division list, picking BU+Division scopes the Department list. */
function ForecastOrgFilterBar({
  bus, divs, depts,
  buFilter, divFilter, deptFilter,
  setBuFilter, setDivFilter, setDeptFilter,
  openMenu, setOpenMenu,
}: {
  bus: string[]; divs: string[]; depts: OrgFilterOption[];
  buFilter: string; divFilter: string; deptFilter: string;
  setBuFilter: (v: string) => void; setDivFilter: (v: string) => void; setDeptFilter: (v: string) => void;
  openMenu: string | null; setOpenMenu: (v: string | null) => void;
}) {
  const anyActive = buFilter !== "All" || divFilter !== "All" || deptFilter !== "All";
  const hasOrg = bus.length > 0 || divs.length > 0 || depts.length > 0;
  if (!hasOrg) return null;
  const dropdownStyle: React.CSSProperties = {
    position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 30,
    backgroundColor: BRAND.bgDeep, border: `1px solid ${BRAND.cardBorder}`, borderRadius: 12,
    minWidth: 200, maxHeight: 280, overflowY: "auto",
    boxShadow: "0 12px 32px rgba(0,0,0,0.45)", padding: "6px 0",
  };
  const pillStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
    borderRadius: 10, backgroundColor: BRAND.card, cursor: "pointer",
    border: `1px solid ${active ? BRAND.green : BRAND.cardBorder}`,
    color: active ? BRAND.green : BRAND.textSecondary,
    fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" as const,
    overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170,
  });
  const optRow = (label: string, sel: boolean, onClick: () => void, sub?: string) => (
    <button key={label} onClick={onClick}
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "8px 14px 8px 22px", background: "transparent", border: "none", color: sel ? BRAND.green : BRAND.white, fontSize: 13, cursor: "pointer", textAlign: "left" }}>
      <span style={{ display: "flex", flexDirection: "column" }}>
        <span>{label}</span>
        {sub && <span style={{ fontSize: 10, color: BRAND.textSecondary, marginTop: 1 }}>{sub}</span>}
      </span>
      {sel && <Check size={14} />}
    </button>
  );
  return (
    <div style={{ position: "relative" }}>
      <div className="flex flex-wrap items-center gap-1.5">
        {bus.length > 0 && (
          <div style={{ position: "relative" }}>
            <button onClick={() => setOpenMenu(openMenu === "bu" ? null : "bu")} style={pillStyle(buFilter !== "All")}>
              <Briefcase size={12} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{buFilter !== "All" ? buFilter : "Business Unit"}</span>
              <ChevronDown size={10} />
            </button>
            {openMenu === "bu" && (
              <div style={dropdownStyle}>
                {optRow("All Business Units", buFilter === "All", () => { setBuFilter("All"); setDivFilter("All"); setDeptFilter("All"); setOpenMenu(null); })}
                {bus.map((b) => optRow(b, buFilter === b, () => { setBuFilter(b); setDivFilter("All"); setDeptFilter("All"); setOpenMenu(null); }))}
              </div>
            )}
          </div>
        )}
        {divs.length > 0 && (
          <div style={{ position: "relative" }}>
            <button onClick={() => setOpenMenu(openMenu === "div" ? null : "div")} style={pillStyle(divFilter !== "All")}>
              <Building2 size={12} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{divFilter !== "All" ? divFilter : "Division"}</span>
              <ChevronDown size={10} />
            </button>
            {openMenu === "div" && (
              <div style={dropdownStyle}>
                {optRow("All Divisions", divFilter === "All", () => { setDivFilter("All"); setDeptFilter("All"); setOpenMenu(null); })}
                {divs.map((d) => optRow(d, divFilter === d, () => { setDivFilter(d); setDeptFilter("All"); setOpenMenu(null); }))}
              </div>
            )}
          </div>
        )}
        {depts.length > 0 && (
          <div style={{ position: "relative" }}>
            <button onClick={() => setOpenMenu(openMenu === "dept" ? null : "dept")} style={pillStyle(deptFilter !== "All")}>
              <Layers size={12} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{deptFilter !== "All" ? deptFilter : "Department"}</span>
              <ChevronDown size={10} />
            </button>
            {openMenu === "dept" && (
              <div style={dropdownStyle}>
                {optRow("All Departments", deptFilter === "All", () => { setDeptFilter("All"); setOpenMenu(null); })}
                {depts.map((d) => optRow(d.label, deptFilter === d.value, () => { setDeptFilter(d.value); setOpenMenu(null); }, d.sub))}
              </div>
            )}
          </div>
        )}
        {anyActive && (
          <button
            onClick={() => { setBuFilter("All"); setDivFilter("All"); setDeptFilter("All"); setOpenMenu(null); }}
            style={{ padding: "7px 10px", borderRadius: 10, background: "transparent", border: `1px solid ${BRAND.cardBorder}`, color: BRAND.textSecondary, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/* =================  Page  ================= */
export default function ForecastPage() {
  const rulesVersion = useBusinessRulesVersion();
  const queryClient = useQueryClient();
  const [pivot, setPivot] = useState<Pivot>("Office");
  const [scenario, setScenario] = useState<Scenario>("Base");
  const [drill, setDrill] = useState<Drill>(null);
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null);
  // Skip the loading modal entirely when core queries are already cached —
  // either in React Query's in-memory cache (same-session return visit) or
  // in the persisted localStorage forecast cache (return after a reload /
  // browser restart, served instantly via placeholderData below). Only show
  // it on a true first load with no cached data anywhere.
  const [showLoadingModal, setShowLoadingModal] = useState<boolean>(() => {
    const hasAlloc  = !!queryClient.getQueryData(["resource-allocations"]);
    const hasDemand = !!queryClient.getQueryData(["resource-demands"]);
    if (hasAlloc && hasDemand) return false;
    // Include the current week's utilization entry in the check — the model
    // cannot build without utilization rows, so a new-week cache miss must
    // show the modal from the first frame rather than flashing it in later.
    // computeForecastWindow(new Date(), 52) is deterministic and matches the
    // `window` memo below (52 overrides the business-rules week count).
    const fw = computeForecastWindow(new Date(), 52);
    return !hasForecastSrcCache(`${fw.startDate}|${fw.endDate}`);
  });
  // prevModel: last successfully built model — used while a refetch is in
  // flight so the page never goes blank during a background update.
  const [prevModel, setPrevModel] = useState<ForecastModel | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const PAGE_WEEKS = getBusinessRules().forecastWeeks;
  const [, navigate] = useLocation();

  // Switch lens without resetting the scenario — user may already be on
  // "Win pursuit" and wants to compare the same scenario across pivot tabs.
  // Drill panel is still closed because the records change with the lens.
  const onPivot = (p: Pivot) => {
    setPivot(p);
    setDrill(null);
  };

  // Close the drill panel when the scenario flips so the visible records
  // in the panel can never disagree with the charts behind it.
  const onScenario = (s: Scenario) => {
    setScenario(s);
    setDrill(null);
  };

  const handoffToChat = (prompt: string) => {
    setChatPrompt(prompt, { newSession: true, autoSend: true });
    setDrill(null);
    navigate("/chat");
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ["forecast-util"] }),
      queryClient.invalidateQueries({ queryKey: ["resource-allocations"] }),
      queryClient.invalidateQueries({ queryKey: ["resource-demands"] }),
      queryClient.invalidateQueries({ queryKey: ["resource-master"] }),
    ]);
    setIsRefreshing(false);
  };

  const titleId = useMemo(() => "forecast-title", []);

  // Cascading BU / Division / Department scope filter — applies across ALL
  // pivot tabs (Office/Role/Discipline) since it filters the underlying
  // workforce + utilization + demand data the model is built from, not the
  // pivot dimension itself.
  const [forecastBuFilter, setForecastBuFilter] = useState("All");
  const [forecastDivFilter, setForecastDivFilter] = useState("All");
  const [forecastDeptFilter, setForecastDeptFilter] = useState("All");
  const [forecastOrgMenu, setForecastOrgMenu] = useState<string | null>(null);
  const forecastFilterActive =
    forecastBuFilter !== "All" || forecastDivFilter !== "All" || forecastDeptFilter !== "All";

  // The forward window starts on the Monday of the current week and is shared
  // by every chart so the heatmap, the curve and the collision bars all
  // describe the same horizon. Its length is the admin-tuned "Forecast window
  // (weeks)" business rule; rulesVersion recomputes it after an async load /
  // admin save so the horizon stays in sync without a page reload.
  const window = useMemo(() => computeForecastWindow(new Date(), 52), [rulesVersion]);

  // Every source query seeds from the persisted forecast cache via
  // placeholderData, so a return visit (even after a full reload) renders
  // the charts instantly from the last good payload while the real fetch
  // revalidates in the background. isPlaceholderData guards the write-back
  // effects below so a placeholder can never re-persist itself.
  //
  // The seeds are read ONCE per mount via useMemo and passed as stable
  // VALUES (not inline arrows): React Query v5 only reuses its memoized
  // placeholder when the placeholderData option is referentially stable, so
  // an inline arrow would re-read + re-JSON.parse multi-MB payloads on
  // every render while the real fetches are in flight.
  const utilSub = `${window.startDate}|${window.endDate}`;
  const utilSeed = useMemo(
    () => readForecastSrc<Awaited<ReturnType<typeof getAllocationUtilization>>>("util", utilSub),
    [utilSub],
  );
  const allocSeed = useMemo(
    () => readForecastSrc<Awaited<ReturnType<typeof getResourceAllocations>>>("alloc"),
    [],
  );
  const demandSeed = useMemo(
    () => readForecastSrc<Awaited<ReturnType<typeof getResourceDemands>>>("demand"),
    [],
  );
  const masterSeed = useMemo(
    () => readForecastSrc<Awaited<ReturnType<typeof getResourceMaster>>>("master"),
    [],
  );
  const pmmSeed = useMemo(
    () => readForecastSrc<Awaited<ReturnType<typeof getModuleRecords>>>("pmm"),
    [],
  );
  const opmSeed = useMemo(
    () => readForecastSrc<Awaited<ReturnType<typeof getModuleRecords>>>("opm"),
    [],
  );
  const lemSeed = useMemo(
    () => readForecastSrc<Awaited<ReturnType<typeof getModuleRecords>>>("lem"),
    [],
  );
  const utilQ = useQuery({
    queryKey: ["forecast-util", window.startDate, window.endDate],
    queryFn: () => getAllocationUtilization({
      startDate: window.startDate,
      endDate: window.endDate,
      mode: "Weekly",
      includeSoftAllocations: true,
    }),
    staleTime: 5 * 60 * 1000,
    placeholderData: utilSeed,
  });
  const allocQ = useQuery({
    queryKey: ["resource-allocations"],
    queryFn: () => getResourceAllocations(),
    staleTime: 5 * 60 * 1000,
    placeholderData: allocSeed,
  });
  const demandQ = useQuery({
    queryKey: ["resource-demands"],
    queryFn: () => getResourceDemands(),
    staleTime: 5 * 60 * 1000,
    placeholderData: demandSeed,
  });
  // Resource master only enriches the drill-down role/department labels, so a
  // failure here must never block the charts — default to an empty directory.
  const masterQ = useQuery({
    queryKey: ["resource-master"],
    queryFn: () => getResourceMaster(),
    staleTime: 5 * 60 * 1000,
    placeholderData: masterSeed,
  });
  // Project records only resolve the Discipline pivot (market sector per
  // project) — a failure must never block the charts, so default to empty.
  const pmmQ = useQuery({
    queryKey: ["pmm"],
    queryFn: () => getModuleRecords("PMM"),
    staleTime: 5 * 60 * 1000,
    placeholderData: pmmSeed,
  });
  const opmQ = useQuery({
    queryKey: ["opm"],
    queryFn: () => getModuleRecords("OPM"),
    staleTime: 5 * 60 * 1000,
    placeholderData: opmSeed,
  });
  const lemQ = useQuery({
    queryKey: ["lem"],
    queryFn: () => getModuleRecords("LEM"),
    staleTime: 5 * 60 * 1000,
    placeholderData: lemSeed,
  });

  // Persist each real (non-placeholder) payload so the next visit renders
  // instantly. Writes are tenant+user scoped and quota-safe (see forecastCache).
  useEffect(() => {
    if (utilQ.data && !utilQ.isPlaceholderData) writeForecastSrc("util", utilSub, utilQ.data);
  }, [utilQ.data, utilQ.isPlaceholderData, utilSub]);
  useEffect(() => {
    if (allocQ.data && !allocQ.isPlaceholderData) writeForecastSrc("alloc", undefined, allocQ.data);
  }, [allocQ.data, allocQ.isPlaceholderData]);
  useEffect(() => {
    if (demandQ.data && !demandQ.isPlaceholderData) writeForecastSrc("demand", undefined, demandQ.data);
  }, [demandQ.data, demandQ.isPlaceholderData]);
  useEffect(() => {
    if (masterQ.data && !masterQ.isPlaceholderData) writeForecastSrc("master", undefined, masterQ.data);
  }, [masterQ.data, masterQ.isPlaceholderData]);
  useEffect(() => {
    if (pmmQ.data && !pmmQ.isPlaceholderData) writeForecastSrc("pmm", undefined, pmmQ.data);
  }, [pmmQ.data, pmmQ.isPlaceholderData]);
  useEffect(() => {
    if (opmQ.data && !opmQ.isPlaceholderData) writeForecastSrc("opm", undefined, opmQ.data);
  }, [opmQ.data, opmQ.isPlaceholderData]);
  useEffect(() => {
    if (lemQ.data && !lemQ.isPlaceholderData) writeForecastSrc("lem", undefined, lemQ.data);
  }, [lemQ.data, lemQ.isPlaceholderData]);

  const error = utilQ.error || allocQ.error || demandQ.error;

  // All open opportunities for the scenario picker dropdown.
  const opps: OpenPursuit[] = useMemo(
    () => getOpenPursuits(opmQ.data?.data ?? []),
    [opmQ.data],
  );

  // Auto-select the first (largest) opp when the list first loads and the
  // user hasn't manually chosen one yet.
  useEffect(() => {
    if (opps.length > 0 && selectedOppId === null) {
      setSelectedOppId(opps[0].id);
    }
  }, [opps, selectedOppId]);

  // The selected pursuit drives the scenario-panel headline, value pill, and
  // the "Win pursuit" uplift scaling inside the forecast model.
  const pursuit: PursuitInfo = useMemo(() => {
    return pickPursuit(opmQ.data?.data ?? [], selectedOppId);
  }, [opmQ.data, selectedOppId]);

  const projectRecords = useMemo(
    () => [
      ...(pmmQ.data?.data ?? []),
      ...(opmQ.data?.data ?? []),
      ...(lemQ.data?.data ?? []),
    ] as Record<string, unknown>[],
    [pmmQ.data, opmQ.data, lemQ.data],
  );

  // ── Pipeline coverage ──────────────────────────────────────────────────────
  // Pipeline value  = total contract value of open (not-closed) OPM opps
  // Portfolio value = total contract value of active (not-closed) PMM projects
  // Coverage %      = pipeline / portfolio × 100, compared to the admin target
  const pipelineCoverage = useMemo(() => {
    const cvField = (r: Record<string, unknown>) => {
      for (const f of ["ApproxContractValue", "LaborContractAmount", "ForecastedProjectCost", "Fee"]) {
        const n = Number(r[f]);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return 0;
    };
    const closedFlag = (r: Record<string, unknown>) => {
      const v = r.Closed;
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v !== 0;
      if (typeof v === "string") { const s = v.trim().toLowerCase(); return s === "true" || s === "1" || s === "yes"; }
      return false;
    };
    const opms = (opmQ.data?.data ?? []) as Record<string, unknown>[];
    const pmms = (pmmQ.data?.data ?? []) as Record<string, unknown>[];
    const pipelineValue  = opms.filter(r => !closedFlag(r)).reduce((s, r) => s + cvField(r), 0);
    const portfolioValue = pmms.filter(r => !closedFlag(r)).reduce((s, r) => s + cvField(r), 0);
    const target = getBusinessRules().proposalCoveragePct;
    const pct = portfolioValue > 0 ? Math.round((pipelineValue / portfolioValue) * 100) : null;
    const healthy = pct !== null && pct >= target;
    const fmt = (v: number) => v >= 1_000_000_000 ? compactUsd(v) : v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${(v / 1_000).toFixed(0)}K` : `$${Math.round(v)}`;
    // Gap = how much additional pipeline value is needed to hit the target
    const targetPipelineValue = portfolioValue * (target / 100);
    const gapValue = targetPipelineValue - pipelineValue;
    return { pct, pipelineValue, portfolioValue, target, healthy, fmt, gapValue };
  }, [opmQ.data, pmmQ.data, rulesVersion]);

  // Cascading org options for the filter bar — mirrors buildOrgFilterOptions
  // usage on Projects/Staff: the Division list scopes to the selected BU, and
  // Department scopes to the selected BU+Division.
  const forecastOrgOptions = useMemo(
    () =>
      buildOrgFilterOptions(
        (allocQ.data?.resources ?? []).map((r) => ({
          bu: r.businessUnit || "",
          division: r.divisionName || "",
          dept: r.departmentName || "",
        })),
        forecastBuFilter,
        forecastDivFilter,
      ),
    [allocQ.data, forecastBuFilter, forecastDivFilter],
  );

  // Resources scoped to the selected BU/Division/Department. This is the
  // single source of truth for the workforce — every downstream input
  // (util rows, demand) is filtered to line up with this same scope so the
  // heatmap/curve/collision charts never mix scoped capacity with unscoped
  // utilization or demand.
  const scopedResources = useMemo(() => {
    const all = allocQ.data?.resources ?? [];
    if (!forecastFilterActive) return all;
    return all.filter((r) => {
      if (forecastBuFilter !== "All" && (r.businessUnit || "") !== forecastBuFilter) return false;
      if (forecastDivFilter !== "All" && (r.divisionName || "") !== forecastDivFilter) return false;
      if (forecastDeptFilter !== "All" && (r.departmentName || "") !== forecastDeptFilter) return false;
      return true;
    });
  }, [allocQ.data, forecastFilterActive, forecastBuFilter, forecastDivFilter, forecastDeptFilter]);

  // Utilization rows must be filtered by the SAME person GUID as scopedResources
  // (never by name — see the resources.tsx GUID-matching fix) or an excluded
  // person's hours silently reappear under the "Unassigned" bucket once
  // enrichUtilRows can't find their proxy in the scoped resource list.
  const scopedUtilRows = useMemo(() => {
    const rows = (utilQ.data as Record<string, unknown>[]) ?? [];
    if (!forecastFilterActive) return rows;
    const allowedIds = new Set(scopedResources.map((r) => (r.id || "").toLowerCase()).filter(Boolean));
    const allowedNames = new Set(scopedResources.map((r) => (r.name || "").toLowerCase()).filter(Boolean));
    return rows.filter((r) => {
      const uid = String(r.UserId ?? r.Id ?? "").trim().toLowerCase();
      if (uid) return allowedIds.has(uid);
      const name = String(r.ResourceUser ?? r.Name ?? "").trim().toLowerCase();
      return name ? allowedNames.has(name) : false;
    });
  }, [utilQ.data, scopedResources, forecastFilterActive]);

  // Open demand (unfilled positions) has no BU/Division/Department of its
  // own — it belongs to a project. Resolve each demand's org via its
  // TicketId against the project records (same field-priority as the
  // Projects page) so scoping the org filter also scopes which open
  // positions count toward capacity gaps. Demand rows whose project org
  // can't be resolved are kept rather than hidden, since these are usually
  // legitimate open reqs on projects whose module record just lacks the field.
  const scopedDemands = useMemo(() => {
    const list = demandQ.data?.data ?? [];
    if (!forecastFilterActive) return list;
    const orgByTicket = new Map<string, OrgRow>();
    for (const rec of projectRecords) {
      const ticket = String((rec as Record<string, unknown>).TicketId ?? "").trim().toUpperCase();
      if (!ticket || orgByTicket.has(ticket)) continue;
      orgByTicket.set(ticket, {
        bu: String((rec as Record<string, unknown>).CRMBusinessUnitChoice ?? (rec as Record<string, unknown>).BusinessUnitName ?? "").trim(),
        division: String((rec as Record<string, unknown>).DivisionName ?? (rec as Record<string, unknown>).DivisionLookup ?? "").trim(),
        dept: String((rec as Record<string, unknown>).DepartmentName ?? (rec as Record<string, unknown>).Department ?? "").trim(),
      });
    }
    return list.filter((d) => {
      const org = orgByTicket.get(String(d.TicketId ?? "").trim().toUpperCase());
      if (!org) return true;
      if (forecastBuFilter !== "All" && org.bu && org.bu !== forecastBuFilter) return false;
      if (forecastDivFilter !== "All" && org.division && org.division !== forecastDivFilter) return false;
      if (forecastDeptFilter !== "All" && org.dept && org.dept !== forecastDeptFilter) return false;
      return true;
    });
  }, [demandQ.data, projectRecords, forecastFilterActive, forecastBuFilter, forecastDivFilter, forecastDeptFilter]);

  const model: ForecastModel | null = useMemo(() => {
    if (!utilQ.data || !allocQ.data || !demandQ.data) return null;
    return buildForecast({
      utilRows: scopedUtilRows,
      resources: scopedResources,
      demands: scopedDemands,
      projectNameMap: allocQ.data.projectNameMap ?? {},
      weeks: window.weeks,
      resourceMaster: masterQ.data ?? [],
      projectRecords,
      pursuitValue: pursuit.value,
    });
  }, [
    utilQ.data, allocQ.data, demandQ.data, masterQ.data,
    scopedUtilRows, scopedResources, scopedDemands, projectRecords,
    window.weeks, pursuit.value, rulesVersion,
  ]);

  // Once the model is built, stash it so we can keep showing it while a
  // background refetch is in flight (prevents the frozen-at-50% spinner).
  const modelBuilt = !!model;
  useEffect(() => {
    if (model) setPrevModel(model);
  }, [model]);

  // displayModel: use the live model when available, fall back to the last
  // successfully built one so the charts never go blank during a refresh.
  const displayModel = model ?? prevModel;

  // Show the full-screen loading overlay only for the TRUE first load (no
  // previous model exists yet). For subsequent refetches, skip the overlay
  // and just let the stale charts stay visible — the Refresh button spinner
  // gives feedback that a background update is happening.
  useEffect(() => {
    if (!modelBuilt && !prevModel) {
      setShowLoadingModal(true);
      return undefined;
    }
    if (modelBuilt) {
      const t = setTimeout(() => setShowLoadingModal(false), 700);
      return () => clearTimeout(t);
    }
    // model null but prevModel exists → background refetch, hide the modal
    setShowLoadingModal(false);
    return undefined;
  }, [modelBuilt, prevModel]);

  // If we lose the pursuit (or it never existed), keep the user in Base mode
  // so the Win-pursuit math doesn't show a meaningless uplift.
  useEffect(() => {
    if (!pursuit.hasPursuit && scenario === "Win") setScenario("Base");
  }, [pursuit.hasPursuit, scenario]);

  return (
    <div
      className="flex flex-col w-full"
      style={{ minHeight: "100%", backgroundColor: BRAND.bg, color: BRAND.white }}
    >
      {/* Page header */}
      <header
        className="flex flex-col gap-2 px-5 md:px-8 pt-5 pb-4"
        style={{
          backgroundColor: BRAND.bgDeep,
          borderBottom: `1px solid ${BRAND.cardBorder}`,
          paddingRight: 56,
          position: "relative",
        }}
      >
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="flex flex-col">
            <div
              className="text-[10.5px] font-bold tracking-[0.18em]"
              style={{ color: BRAND.textSecondary }}
            >
              FORECAST
            </div>
            <h1
              id={titleId}
              className="text-[22px] md:text-[24px] font-extrabold leading-tight mt-1"
              style={{ color: BRAND.white, letterSpacing: "-0.01em" }}
            >
              Visual Forecasting
            </h1>
          </div>
          <div style={{ position: "absolute", top: 12, right: 56, display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => void handleRefresh()}
              disabled={isRefreshing}
              title="Refresh forecast data"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                fontSize: 11, fontWeight: 600,
                color: isRefreshing ? BRAND.textSecondary : BRAND.greenLight,
                background: "transparent", border: "none", cursor: isRefreshing ? "default" : "pointer",
                padding: "2px 6px",
              }}
            >
              <RefreshCw size={12} style={{ animation: isRefreshing ? "spin 1s linear infinite" : "none" }} />
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </button>
            <Pill
              bg="rgba(107,165,57,0.18)"
              fg={BRAND.greenLight}
              border="rgba(107,165,57,0.45)"
            >
              <TrendingUp size={11} className="mr-1.5" />
              {displayModel ? `${displayModel.weekLabels.length}-WK FORECAST` : "FORECAST"}
            </Pill>
          </div>
        </div>

        {/* Pipeline coverage stat — shows live coverage vs admin target */}
        {pipelineCoverage.pct !== null && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", color: BRAND.textSecondary, textTransform: "uppercase" }}>
              Pipeline Coverage
            </span>
            <span style={{
              fontSize: 13, fontWeight: 800,
              color: pipelineCoverage.healthy ? BRAND.green : BRAND.amber,
            }}>
              {pipelineCoverage.pct}%
            </span>
            <span style={{ fontSize: 11, color: BRAND.textMuted }}>
              vs target {pipelineCoverage.target}%
            </span>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
              backgroundColor: pipelineCoverage.healthy ? BRAND.green + "28" : BRAND.amber + "28",
              color: pipelineCoverage.healthy ? BRAND.greenLight : BRAND.amber,
              letterSpacing: 0.4,
            }}>
              {pipelineCoverage.healthy ? "✓ HEALTHY" : "⚠ BELOW TARGET"}
            </span>
            {!pipelineCoverage.healthy && pipelineCoverage.gapValue > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 600,
                color: BRAND.amber,
              }}>
                {pipelineCoverage.fmt(pipelineCoverage.gapValue)} more pipeline needed
              </span>
            )}
            <span style={{ fontSize: 10, color: BRAND.textMuted }}>
              {pipelineCoverage.fmt(pipelineCoverage.pipelineValue)} pipeline · {pipelineCoverage.fmt(pipelineCoverage.portfolioValue)} portfolio
            </span>
          </div>
        )}

        {/* Pivot tabs + org scope filter. The filter applies to every tab
            (Office/Role/Discipline) since it scopes the underlying data,
            not the pivot dimension. */}
        <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
          <div className="flex items-center" style={{ gap: 12 }} role="tablist" aria-label="Forecast lens">
            {PIVOTS.map((p) => {
              const active = p === pivot;
              return (
                <button
                  key={p}
                  role="tab"
                  aria-selected={active}
                  onClick={() => onPivot(p)}
                  className="text-[13px] font-semibold transition-colors"
                  style={{
                    padding: "8px 0",
                    minWidth: 104,
                    textAlign: "center",
                    color: active ? BRAND.white : BRAND.textSecondary,
                    backgroundColor: "transparent",
                    borderBottom: active ? `2px solid ${BRAND.green}` : "2px solid transparent",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.color = BRAND.white;
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.color = BRAND.textSecondary;
                  }}
                >
                  {p}{p === "Discipline" ? <span style={{ fontSize: 10, opacity: 0.65, marginLeft: 4 }}>idx</span> : null}
                </button>
              );
            })}
          </div>
          <ForecastOrgFilterBar
            bus={forecastOrgOptions.bus}
            divs={forecastOrgOptions.divs}
            depts={forecastOrgOptions.depts}
            buFilter={forecastBuFilter}
            divFilter={forecastDivFilter}
            deptFilter={forecastDeptFilter}
            setBuFilter={setForecastBuFilter}
            setDivFilter={setForecastDivFilter}
            setDeptFilter={setForecastDeptFilter}
            openMenu={forecastOrgMenu}
            setOpenMenu={setForecastOrgMenu}
          />
        </div>
      </header>

      {/* Body grid:
          - Heatmap full-width
          - Demand vs Cap + Collision side-by-side on lg
          - Scenario panel full-width below */}
      <div
        className="px-5 md:px-8 py-5 md:py-6"
        style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr" }}
      >
        {error && !model && (
          <Card>
            <div
              className="flex items-center gap-2 text-[13px]"
              style={{ color: BRAND.redSoft }}
            >
              <AlertCircle size={16} />
              <span>Couldn't load forecast data. Try refreshing.</span>
            </div>
          </Card>
        )}

        {showLoadingModal && !error && (
          <ForecastLoadingModal
            allocLoaded={allocQ.isSuccess}
            utilLoaded={utilQ.isSuccess}
            demandLoaded={demandQ.isSuccess}
            modelReady={modelBuilt}
          />
        )}

        {displayModel && (
          <>
            {/* Week navigation bar — prev / page indicator / next */}
            {(() => {
              const total = displayModel.weekLabels.length;
              const canPrev = weekOffset > 0;
              const canNext = weekOffset + PAGE_WEEKS < total;
              const fromWk = displayModel.weekLabels[weekOffset] ?? "";
              const toWk   = displayModel.weekLabels[Math.min(weekOffset + PAGE_WEEKS - 1, total - 1)] ?? "";
              const navBtn = (disabled: boolean, onClick: () => void, children: ReactNode) => (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onClick}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "6px 12px", borderRadius: 8, border: `1px solid ${disabled ? "rgba(255,255,255,0.10)" : "rgba(107,165,57,0.45)"}`,
                    backgroundColor: disabled ? "rgba(255,255,255,0.04)" : "rgba(107,165,57,0.12)",
                    color: disabled ? BRAND.textMuted : BRAND.greenLight,
                    fontSize: 12, fontWeight: 600, cursor: disabled ? "default" : "pointer",
                    transition: "all 0.15s",
                  }}
                >{children}</button>
              );
              const isAtCurrent = weekOffset === 0;
              return (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  {navBtn(!canPrev, () => setWeekOffset(Math.max(0, weekOffset - PAGE_WEEKS)),
                    <><ChevronLeft size={14} /> Prev {PAGE_WEEKS} Wks</>)}

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <button
                      type="button"
                      onClick={() => setWeekOffset(0)}
                      disabled={isAtCurrent}
                      style={{
                        padding: "3px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                        letterSpacing: "0.06em", textTransform: "uppercase",
                        border: `1px solid ${isAtCurrent ? "rgba(107,165,57,0.45)" : "rgba(107,165,57,0.35)"}`,
                        backgroundColor: isAtCurrent ? "rgba(107,165,57,0.18)" : "rgba(107,165,57,0.08)",
                        color: isAtCurrent ? BRAND.greenLight : BRAND.textSecondary,
                        cursor: isAtCurrent ? "default" : "pointer",
                      }}
                    >
                      {isAtCurrent ? "● Current Week" : "↩ Current Week"}
                    </button>
                    <div style={{ fontSize: 11, color: BRAND.textMuted, fontWeight: 500 }}>
                      <span style={{ color: BRAND.textSecondary }}>{fromWk}</span>
                      <span> – </span>
                      <span style={{ color: BRAND.textSecondary }}>{toWk}</span>
                      <span style={{ marginLeft: 6 }}>({weekOffset + 1}–{Math.min(weekOffset + PAGE_WEEKS, total)} of {total})</span>
                    </div>
                  </div>

                  {navBtn(!canNext, () => setWeekOffset(Math.min(total - PAGE_WEEKS, weekOffset + PAGE_WEEKS)),
                    <>Next {PAGE_WEEKS} Wks <ChevronRight size={14} /></>)}
                </div>
              );
            })()}

            <HeatmapZone
              pivot={pivot}
              scenario={scenario}
              model={displayModel}
              weekOffset={weekOffset}
              pageWeeks={PAGE_WEEKS}
              onCellClick={(row, week, pct) =>
                setDrill({ kind: "cell", pivot, scenario, row, week, pct })
              }
            />

            {/* Two-column row on desktop, stacks on narrow widths.
                Uses auto-fit so it doesn't depend on Tailwind responsive
                class scanning when this file is imported elsewhere. */}
            <div
              style={{
                display: "grid",
                gap: 16,
                gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
              }}
            >
              <DemandCapacityZone
                pivot={pivot}
                scenario={scenario}
                model={displayModel}
                weekOffset={weekOffset}
                pageWeeks={PAGE_WEEKS}
                onHireClick={() => setDrill({ kind: "hire", pivot, scenario })}
              />
              <CollisionZone
                pivot={pivot}
                model={displayModel}
                weekOffset={weekOffset}
                pageWeeks={PAGE_WEEKS}
                onOverlapClick={(week) => setDrill({ kind: "overlap", pivot, week })}
                onProjectClick={(project) => setDrill({ kind: "project", pivot, project })}
              />
            </div>

            <ScenarioPanel
              scenario={scenario}
              onChange={onScenario}
              pursuit={pursuit}
              opps={opps}
              selectedOppId={selectedOppId}
              onSelectOpp={(id) => {
                setSelectedOppId(id);
              }}
            />
          </>
        )}
      </div>

      {displayModel && (
        <DrillPanel
          drill={drill}
          model={displayModel}
          onClose={() => setDrill(null)}
          onHandoff={handoffToChat}
        />
      )}
    </div>
  );
}
