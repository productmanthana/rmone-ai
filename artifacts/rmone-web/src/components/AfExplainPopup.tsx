/**
 * AfExplainPopup — "where does this number come from?"
 *
 * Opened by clicking any Actuals-vs-Forecast table cell or chart point.
 * Written for NON-technical readers: plain-language definition, the actual
 * arithmetic with the clicked period's real numbers, the data source, and a
 * per-person breakdown so a value like "200 h" is traceable to the people
 * and weeks behind it.
 *
 * Honesty rules (match the page's Definitions card):
 *  - The headline + formula always use the FROZEN point values the user
 *    clicked (they reconcile with the table).
 *  - The people list is rebuilt from the CURRENT plan detail. When its total
 *    differs from the frozen value, we say so explicitly instead of letting
 *    the mismatch look like a bug.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { X, Info, ChevronRight, GripHorizontal } from "lucide-react";
import type { AfDetailRow, AfFlagsInfo } from "@/lib/api";
import {
  explainRows, pointValueOf, tripleValue, fmtNum, fmtUsd, personWeekSeries, buildWeekStrip,
  UNKNOWN_PERSON_LABEL,
  type AfExplainPerson, type AfMetric, type AfPoint, type AfUnit, type AfWeekCell, type PeriodKind,
} from "@/lib/afMath";
import { Z } from "@/lib/zLayers";

const BLUE = "#2563eb";
const GREEN = "#16a34a";
const RED = "#dc2626";

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function dateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTH_SHORT[m - 1]} ${d}, ${y}`;
}

function monthYear(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m] = iso.split("-").map(Number);
  if (!y || !m) return null;
  return `${MONTH_SHORT[m - 1]} ${y}`;
}

/** "Feb 2011 – Sep 2011", "Feb 2011", or "—". */
function rangeLabel(a: string | null, b: string | null): string {
  const A = monthYear(a);
  const B = monthYear(b);
  if (!A) return "—";
  if (!B || A === B) return A;
  return `${A} – ${B}`;
}

/** Human name of the clicked period ("2015", "August 2026", "the week of…"). */
function periodPhrase(p: AfPoint, kind: PeriodKind): string {
  if (kind === "year") return p.key;
  if (kind === "month") {
    const [y, m] = p.key.split("-").map(Number);
    if (y && m) return `${MONTH_FULL[m - 1]} ${y}`;
  }
  return `the week of ${dateLong(p.weekMonday)}`;
}

function fmtV(unit: AfUnit, v: number): string {
  return unit === "hours" ? `${fmtNum(v)} h` : fmtUsd(v);
}

function metricTitle(m: AfMetric, u: AfUnit): string {
  const noun = u === "hours" ? "Hours" : u === "cost" ? "Cost" : "Billing";
  if (m === "actual") return `Actual ${noun} to Date`;
  if (m === "plan") return `Planned ${noun} to Date`;
  if (m === "variance") return `${noun} Variance`;
  return `Expected Total ${noun} at Completion`;
}

const METRIC_TABS: { key: AfMetric; label: string }[] = [
  { key: "actual", label: "Actual" },
  { key: "plan", label: "Planned" },
  { key: "variance", label: "Difference" },
  { key: "eac", label: "Expected total" },
];

interface BreakRow {
  key: string;
  personKey: string;    // detail-row person id ("" = open demand)
  name: string;
  sub: string;          // role · division
  when: string;         // month range the value happened in
  cols: number[];       // metric-specific value columns
  hours: number[];      // matching hours per column (for the "h × rate" hint)
  approx: boolean;
  isOpenDemand: boolean;
  isRemainder: boolean;
}

export function AfExplainPopup({ ticket, projectTitle, point, unit, initialMetric, initialPersonKey, periodKind, detail, filtered, flags, seriesStartWeek, onClose }: {
  ticket: string;
  projectTitle: string;
  point: AfPoint;
  unit: AfUnit;
  initialMetric: AfMetric;
  /** Optional person selected in the people popup. Opens their weekly row immediately. */
  initialPersonKey?: string;
  periodKind: PeriodKind;
  detail: AfDetailRow[];
  filtered: boolean;
  flags: AfFlagsInfo;
  /** Earliest UNFILTERED snapshot week — detects when frozen totals reach
   * further back than the person-by-person detail history. */
  seriesStartWeek: string | null;
  onClose: () => void;
}) {
  const [metric, setMetric] = useState<AfMetric>(initialMetric);
  const expandedKey = initialPersonKey === "" ? "\u0000open" : (initialPersonKey ?? null);
  const [openPerson, setOpenPerson] = useState<string | null>(expandedKey);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // The popup stays mounted while the user clicks from cell to cell — follow
  // the newly clicked metric/point instead of latching the first one.
  useEffect(() => {
    setMetric(initialMetric);
    setOpenPerson(expandedKey);
    setDragOffset({ x: 0, y: 0 });
  }, [initialMetric, point, expandedKey]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const rect = panelRef.current?.getBoundingClientRect();
      const width = rect?.width ?? Math.min(600, window.innerWidth - 32);
      const height = rect?.height ?? Math.min(700, window.innerHeight - 32);
      const maxX = Math.max(0, (window.innerWidth - width) / 2 - 16);
      const maxY = Math.max(0, (window.innerHeight - height) / 2 - 16);
      setDragOffset({
        x: Math.max(-maxX, Math.min(maxX, drag.originX + event.clientX - drag.startX)),
        y: Math.max(-maxY, Math.min(maxY, drag.originY + event.clientY - drag.startY)),
      });
    };
    const stop = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging]);

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX: dragOffset.x, originY: dragOffset.y };
    setDragging(true);
  };

  // Escape closes; Tab is trapped inside the panel so keyboard focus cannot
  // reach (and change) the filter controls behind the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !panel.contains(active)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const people = useMemo(() => explainRows(detail, point.weekMonday), [detail, point.weekMonday]);

  const displayed = pointValueOf(point, metric);
  const frozenRemaining = point.eac - point.actualTd; // remaining plan as frozen that week
  const actualsMissing = metric !== "plan" && !point.actualsCovered;
  const displayedLabel = actualsMissing
    ? (metric === "actual" ? "Not imported" : "—")
    : fmtV(unit, displayed);

  // Current-plan totals (what the people list adds up to).
  const totals = useMemo(() => {
    let actual = 0, plan = 0, planTotal = 0;
    for (const p of people) {
      actual += tripleValue(p.actual, unit);
      plan += tripleValue(p.plan, unit);
      planTotal += tripleValue(p.planTotal, unit);
    }
    return { actual, plan, planTotal, remaining: planTotal - plan };
  }, [people, unit]);

  const computed =
    metric === "actual" ? totals.actual :
    metric === "plan" ? totals.plan :
    metric === "variance" ? totals.plan - totals.actual :
    totals.actual + totals.remaining;

  // Frozen-vs-today disclosure: only meaningful on the unfiltered view
  // (filtered series are themselves recomputed from this same detail).
  // We can NOT attribute a mismatch to one cause — it may be plan edits,
  // actuals imported after the freeze, or frozen totals that reach further
  // back than the stored person-by-person history (bounded rebuild ranges).
  const tol = Math.max(unit === "hours" ? 1 : 5, Math.abs(displayed) * 0.01);
  const recordsDiffer = !actualsMissing && !filtered && Math.abs(computed - displayed) > tol;
  const firstDetailWeek = useMemo(() => {
    let min: string | null = null;
    for (const r of detail) if (!min || r.weekMonday < min) min = r.weekMonday;
    return min;
  }, [detail]);
  const historyGap = !!(seriesStartWeek && firstDetailWeek && seriesStartWeek < firstDetailWeek);

  /* ── per-person rows for the active metric ── */
  const { rows, totalCols, colHeads } = useMemo(() => {
    const val = (t: AfExplainPerson["actual"]) => tripleValue(t, unit);
    const noun = unit === "hours" ? "Hours" : unit === "cost" ? "Cost" : "Billing";
    let heads: string[];
    const build: { row: BreakRow; primary: number }[] = [];
    for (const p of people) {
      const a = val(p.actual), pl = val(p.plan), rem = val(p.planTotal) - val(p.plan);
      let cols: number[]; let hours: number[]; let when = ""; let primary = 0;
      if (metric === "actual") {
        if (!a) continue;
        cols = [a]; hours = [p.actual.hours]; when = rangeLabel(p.firstActualWeek, p.lastActualWeek); primary = Math.abs(a);
      } else if (metric === "plan") {
        if (!pl) continue;
        cols = [pl]; hours = [p.plan.hours]; when = rangeLabel(p.firstPlanWeek, p.lastPlanWeek); primary = Math.abs(pl);
      } else if (metric === "variance") {
        if (!a && !pl) continue;
        cols = [pl, a, pl - a]; hours = [p.plan.hours, p.actual.hours, 0]; when = rangeLabel(p.firstPlanWeek ?? p.firstActualWeek, p.lastPlanWeek ?? p.lastActualWeek); primary = Math.abs(pl - a);
      } else {
        const total = a + rem;
        if (!a && !rem) continue;
        cols = [a, rem, total]; hours = [p.actual.hours, p.planTotal.hours - p.plan.hours, 0]; when = ""; primary = Math.abs(total);
      }
      const roles = p.roles.slice(0, 2).join(", ") + (p.roles.length > 2 ? ` +${p.roles.length - 2}` : "");
      build.push({
        primary,
        row: {
          key: p.person || "\u0000open",
          personKey: p.person,
          name: p.person === "" ? "Open roles (not yet staffed)" : (p.name || UNKNOWN_PERSON_LABEL),
          sub: [roles, p.division].filter(Boolean).join(" · "),
          when,
          cols, hours,
          approx: p.anyApprox && unit !== "hours",
          isOpenDemand: p.person === "",
          isRemainder: false,
        },
      });
    }
    build.sort((x, y) => y.primary - x.primary);
    const MAXROWS = 10;
    const shown = build.slice(0, MAXROWS).map((b) => b.row);
    const hidden = build.slice(MAXROWS);
    if (hidden.length > 0) {
      const nCols = shown[0]?.cols.length ?? 1;
      const sum = new Array<number>(nCols).fill(0);
      const sumH = new Array<number>(nCols).fill(0);
      for (const h of hidden) for (let i = 0; i < nCols; i++) { sum[i] += h.row.cols[i] ?? 0; sumH[i] += h.row.hours[i] ?? 0; }
      shown.push({
        key: "\u0000rest", personKey: "", name: `${hidden.length} more ${hidden.length === 1 ? "person" : "people"}`,
        sub: "", when: "", cols: sum, hours: sumH, approx: false, isOpenDemand: false, isRemainder: true,
      });
    }
    const tCols =
      metric === "actual" ? [totals.actual] :
      metric === "plan" ? [totals.plan] :
      metric === "variance" ? [totals.plan, totals.actual, totals.plan - totals.actual] :
      [totals.actual, totals.remaining, totals.actual + totals.remaining];
    if (metric === "variance") heads = ["Planned", "Actual", "Difference"];
    else if (metric === "eac") heads = ["Used so far", "Still planned", "Expected total"];
    else heads = [noun, "When"];
    return { rows: shown, totalCols: tCols, colHeads: heads };
  }, [people, metric, unit, totals]);

  const period = periodPhrase(point, periodKind);
  const showWhen = metric === "actual" || metric === "plan";
  const anyApproxShown = rows.some((r) => r.approx);
  // Substitution disclosure keys off the clicked point's FROZEN cumulative
  // substituted hours — visible detail rows alone can miss substitutions that
  // happened before the stored person-by-person history begins.
  const substitutedHrs = flags.usePlannedAsActualFallback ? Math.max(point.substitutedHours, 0) : 0;
  const hasSubstituted = substitutedHrs > 0 || (flags.usePlannedAsActualFallback && people.some((p) => p.anySubstituted));
  const hasOpenDemand = rows.some((r) => r.isOpenDemand) && (metric === "plan" || metric === "eac" || metric === "variance");

  /* ── copy ── */
  const money = unit !== "hours";
  const whatIsThis =
    actualsMissing ? (
      metric === "actual"
        ? `No actual-timesheet row was imported for this project in ${period}. This is unknown, not a confirmed zero.`
        : `This number needs imported actual time for ${period}. No actual-timesheet row was imported, so RM ONE cannot calculate it honestly.`
    ) : metric === "actual" ? (
      (money
        ? `All the actual time recorded for this project through ${period}, priced at each person's rate.`
        : `All the actual time recorded for this project through ${period}.`) +
      (hasSubstituted
        ? " It comes from imported timesheet files plus, for some finished weeks with no timesheet, planned hours counted automatically (see the note below)."
        : " Actual time comes from the timesheet files imported into RM ONE.")
    ) : metric === "plan" ? (
      money
        ? `What the schedule said would have been spent by ${period}: every planned hour on this project's team plan up to that date, priced at each person's rate.`
        : `What the schedule said would have been worked by ${period}: every hour entered on this project's team plan up to that date.`
    ) : metric === "variance" ? (
      `The gap between the plan and reality through ${period}. Green (positive) means less was used than planned; red (negative) means more.`
    ) : (
      `Where this project is expected to end up: what has actually been used so far, plus everything still on the plan after this point.`
    );

  const subSuffix = hasSubstituted ? " — partly substituted planned hours, see the note below" : "";
  const source =
    actualsMissing
      ? `Source status: no matching row exists in the Actuals Import data for this project and period. Planned allocations are kept separate and are not assumed to be worked time.`
      : metric === "actual"
      ? hasSubstituted
        ? `Source: timesheet files imported on the Import Actuals page, PLUS planned hours automatically counted as actuals for finished weeks with no imported timesheet (a workspace setting)${substitutedHrs > 0 ? ` — ${fmtNum(substitutedHrs)} h of the time behind this total` : ""}.${money ? " Dollars = hours × each person's rate." : ""}`
        : `Source: timesheet files imported on the Import Actuals page. Each imported row says who worked, in which week, and how many hours.${money ? " Dollars = those hours × each person's rate." : ""}`
      : metric === "plan"
        ? `Source: the hours entered on this project's team plan (allocations) in RM ONE — who is scheduled, for which weeks.${money ? " Dollars = planned hours × each person's rate." : ""}`
        : metric === "variance"
          ? `Source: the two numbers it compares — the team plan (planned) and imported timesheet files (actual${subSuffix}).`
          : `Source: imported timesheet files for the "used so far" part (actual${subSuffix}), and the project's team plan for the "still planned" part.`;

  const formula =
    actualsMissing ? (
      <>
        <b>{metric === "actual" ? "Not imported" : "Not available"}</b>
        <span style={{ opacity: 0.75 }}> — import the actual-timesheet row before comparing it with the plan.</span>
      </>
    ) : metric === "variance" ? (
      <>
        <b>{fmtV(unit, point.forecastTd)}</b> planned − <b>{fmtV(unit, point.actualTd)}</b> actual ={" "}
        <b style={{ color: displayed > 0 ? GREEN : displayed < 0 ? RED : undefined }}>{fmtV(unit, displayed)}</b>
        <span style={{ opacity: 0.75 }}>{displayed > 0 ? " — under plan so far" : displayed < 0 ? " — over plan so far" : " — exactly on plan"}</span>
      </>
    ) : metric === "eac" ? (
      <>
        <b>{fmtV(unit, point.actualTd)}</b> used so far + <b>{fmtV(unit, frozenRemaining)}</b> still planned ={" "}
        <b>{fmtV(unit, displayed)}</b> expected in total
      </>
    ) : (
      <>
        <b>{fmtV(unit, displayed)}</b> = the sum of {metric === "actual" ? "every imported hour" : "every planned hour"}
        {money ? " × rate" : ""} through {period}
      </>
    );

  // The empty/zero explainers non-technical users actually need.
  const zeroExplainer =
    actualsMissing
      ? `No actual hours were imported for this project in ${period}. The plan can still show scheduled hours, but Actual and Difference remain unavailable until the matching actual-timesheet data is imported.`
      : metric === "actual" && rows.length === 0
      ? `An actual-timesheet row was imported for this period, but it contains no non-zero hours. That is a confirmed ${fmtV(unit, 0)}.`
      : metric === "plan" && rows.length === 0
        ? `No hours were planned through ${period} on this project's team plan, so there is nothing to add up yet.`
        : metric === "eac" && displayed === 0 && totals.planTotal > 0 && point.actualTd === 0
          ? `This shows 0 because all of this project's planned hours are already in the past (nothing is still scheduled ahead), and no actual hours were imported. If work really happened, importing the actual hours will fill this in.`
          : metric === "variance" && rows.length === 0
            ? `Nothing was planned and nothing was imported through ${period}, so there is no difference to show.`
            : null;

  const cellR: React.CSSProperties = { padding: "6px 10px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", borderBottom: "1px solid hsl(var(--border))" };
  const cellL: React.CSSProperties = { ...cellR, textAlign: "left", whiteSpace: "normal" };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.45)", zIndex: Z.POPUP, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${metricTitle(metric, unit)} — where this number comes from`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "hsl(var(--card))", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--border))",
          borderRadius: 14, width: "min(600px, 100%)", maxHeight: "84vh", overflowY: "auto",
           boxShadow: "0 18px 50px rgba(2, 6, 23, 0.35)", padding: 18, outline: "none",
           transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
        }}
      >
        {/* header */}
        <div
          onPointerDown={beginDrag}
          style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: dragging ? "grabbing" : "grab", userSelect: "none", touchAction: "none" }}
        >
          <GripHorizontal size={17} style={{ color: "hsl(var(--muted-foreground))", marginTop: 4, flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", color: "hsl(var(--muted-foreground))" }}>
              {ticket}{projectTitle ? ` — ${projectTitle}` : ""} · {period}
            </div>
            <div style={{ fontSize: 17, fontWeight: 750, marginTop: 3 }}>
              {metricTitle(metric, unit)}: {displayedLabel}
            </div>
            {periodKind !== "week" && (
              <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
                as of the week of {dateLong(point.weekMonday)} — the last recorded week in this period
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--muted-foreground))", borderRadius: 8, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
            <X size={15} />
          </button>
        </div>
        <div style={{ fontSize: 10.5, color: "hsl(var(--muted-foreground))", marginTop: 3, marginLeft: 27 }}>
          Drag the header to reposition this popup
        </div>

        {/* metric switcher */}
        <div style={{ display: "inline-flex", border: "1px solid hsl(var(--border))", borderRadius: 8, overflow: "hidden", marginTop: 12 }}>
          {METRIC_TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => { setMetric(t.key); setOpenPerson(null); }}
              style={{
                padding: "5px 11px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
                background: t.key === metric ? BLUE : "hsl(var(--card))",
                color: t.key === metric ? "#fff" : "hsl(var(--muted-foreground))",
              }}>{t.label}</button>
          ))}
        </div>

        {/* what is this */}
        <div style={{ fontSize: 13, lineHeight: 1.55, marginTop: 12 }}>{whatIsThis}</div>

        {/* the arithmetic */}
        <div style={{ background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", borderRadius: 10, padding: "9px 12px", fontSize: 13, marginTop: 10, fontVariantNumeric: "tabular-nums" }}>
          {formula}
        </div>

        {/* source */}
        <div style={{ display: "flex", gap: 7, alignItems: "flex-start", fontSize: 12.5, color: "hsl(var(--muted-foreground))", marginTop: 10, lineHeight: 1.5 }}>
          <Info size={13} style={{ marginTop: 2, flexShrink: 0 }} /> <span>{source}</span>
        </div>

        {/* breakdown */}
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 14, marginBottom: 6 }}>
          {metric === "actual" ? "Who the imported hours belong to" : metric === "plan" ? "Whose planned hours add up to this" : metric === "variance" ? "Person by person" : "Person by person"}
          <span style={{ fontWeight: 400, fontSize: 11.5, color: "hsl(var(--muted-foreground))" }}> — click a name for the week-by-week timeline</span>
        </div>
        {zeroExplainer ? (
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "hsl(var(--muted-foreground))", background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))", borderRadius: 10, padding: "10px 12px" }}>
            {zeroExplainer}
          </div>
        ) : (
          <div style={{ border: "1px solid hsl(var(--border))", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={{ ...cellL, fontSize: 11, color: "hsl(var(--muted-foreground))", background: "hsl(var(--muted))", fontWeight: 600 }}>Person</th>
                  {(showWhen ? [colHeads[0]] : colHeads).map((h) => (
                    <th key={h} style={{ ...cellR, fontSize: 11, color: "hsl(var(--muted-foreground))", background: "hsl(var(--muted))", fontWeight: 600 }}>{h}</th>
                  ))}
                  {showWhen && <th style={{ ...cellR, fontSize: 11, color: "hsl(var(--muted-foreground))", background: "hsl(var(--muted))", fontWeight: 600 }}>When</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const open = openPerson === r.key;
                  const canExpand = !r.isRemainder;
                  const toggle = () => { if (canExpand) setOpenPerson(open ? null : r.key); };
                  return (
                    <Fragment key={r.key}>
                      <tr onClick={toggle} style={canExpand ? { cursor: "pointer" } : undefined}>
                        <td style={cellL}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 5 }}>
                            {canExpand && (
                              <ChevronRight size={12} aria-hidden style={{ marginTop: 3, flexShrink: 0, color: "hsl(var(--muted-foreground))", transform: open ? "rotate(90deg)" : undefined, transition: "transform 120ms" }} />
                            )}
                            <div style={{ minWidth: 0 }}>
                              {canExpand ? (
                                <span
                                  role="button"
                                  tabIndex={0}
                                  aria-expanded={open}
                                  aria-label={`${r.name}: show the week-by-week timeline`}
                                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
                                  style={{ fontWeight: 600, fontStyle: r.isOpenDemand ? "italic" : undefined, textDecoration: "underline dotted", textUnderlineOffset: 3, textDecorationColor: "hsl(var(--muted-foreground) / 0.45)", outlineOffset: 2 }}
                                >
                                  {r.name}{r.approx ? " ≈" : ""}
                                </span>
                              ) : (
                                <div style={{ fontWeight: 600, fontStyle: "italic" }}>{r.name}</div>
                              )}
                              {r.sub && <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{r.sub}</div>}
                            </div>
                          </div>
                        </td>
                        {r.cols.map((c, i) => (
                          <td key={i} style={{ ...cellR, color: metric === "variance" && i === 2 ? (c > 0 ? GREEN : c < 0 ? RED : undefined) : undefined }}>
                            <div>{fmtV(unit, c)}</div>
                            {money && showWhen && r.hours[i] > 0 && c !== 0 && (
                              <div style={{ fontSize: 10.5, color: "hsl(var(--muted-foreground))" }}>
                                {fmtNum(r.hours[i])} h × ~{fmtUsd(c / r.hours[i])}/h
                              </div>
                            )}
                          </td>
                        ))}
                        {showWhen && <td style={{ ...cellR, color: "hsl(var(--muted-foreground))" }}>{r.when || "—"}</td>}
                      </tr>
                      {open && canExpand && (
                        <tr>
                          <td colSpan={showWhen ? 3 : 4} style={{ ...cellL, background: "hsl(var(--muted) / 0.45)", padding: "9px 12px 11px" }}>
                            <PersonWeeks detail={detail} personKey={r.personKey} metric={metric} unit={unit} cutoff={point.weekMonday} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                <tr>
                  <td style={{ ...cellL, borderBottom: "none", fontWeight: 750 }}>Total</td>
                  {totalCols.map((c, i) => (
                    <td key={i} style={{ ...cellR, borderBottom: "none", fontWeight: 750, color: metric === "variance" && i === 2 ? (c > 0 ? GREEN : c < 0 ? RED : undefined) : undefined }}>
                      {fmtV(unit, c)}
                    </td>
                  ))}
                  {showWhen && <td style={{ ...cellR, borderBottom: "none" }} />}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* honesty notes */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
          {recordsDiffer && (
            <Note warn text={`This period was frozen at ${fmtV(unit, displayed)} when its week closed. The person-by-person records above add up to ${fmtV(unit, computed)}. The difference can come from plan edits made after the freeze, from timesheet hours imported later${historyGap && firstDetailWeek ? `, or from weeks before ${monthYear(firstDetailWeek)} that aren't part of the detailed history shown here` : ""}.`} />
          )}
          {historyGap && !recordsDiffer && firstDetailWeek && (
            <Note text={`Person-by-person history is stored from ${monthYear(firstDetailWeek)} onward; earlier weeks appear in the frozen totals only.`} />
          )}
          {point.backfilled && (
            <Note text="This period is from before weekly tracking began, so it was reconstructed from the current plan rather than recorded at the time." />
          )}
          {filtered && (
            <Note text="You're viewing a filtered slice (division / person), recomputed from today's plan rather than the frozen weekly totals." />
          )}
          {hasOpenDemand && (
            <Note text="The plan includes open roles that aren't assigned to a person yet — they count toward planned hours." />
          )}
          {anyApproxShown && (
            <Note text="≈ means the hourly rate was estimated (the imported row didn't match a single assignment exactly)." />
          )}
          {money && point.unratedActualHours > 0 && metric !== "plan" && (
            <Note warn text={`${fmtNum(point.unratedActualHours)} actual hours had no rate on file and count as $0 here.`} />
          )}
          {hasSubstituted && metric !== "plan" && (
            <Note text={`${substitutedHrs > 0 ? `${fmtNum(substitutedHrs)} h of the “actual” time here are` : "Some “actual” hours are"} planned hours automatically counted for finished weeks with no imported timesheet (a workspace setting) — not imported timesheet hours.`} />
          )}
        </div>
      </div>
    </div>
  );
}

/** One person's week-by-week drill-down for the active metric: a scrollable
 * weekly strip (like the workload timeline grid) with one column per week.
 * Totals always reconcile with the person's row because both read the same
 * detail rows over the same week windows. */
function PersonWeeks({ detail, personKey, metric, unit, cutoff }: {
  detail: AfDetailRow[];
  personKey: string;
  metric: AfMetric;
  unit: AfUnit;
  cutoff: string; // point.weekMonday — period cutoff (inclusive)
}) {
  const money = unit !== "hours";
  const fmtT = (v: number) => (money ? fmtUsd(v) : `${fmtNum(v)} h`);
  const actualSeries = useMemo(() => personWeekSeries(detail, personKey, "actual", unit, null, cutoff), [detail, personKey, unit, cutoff]);
  const planSeries = useMemo(() => personWeekSeries(detail, personKey, "plan", unit, null, cutoff), [detail, personKey, unit, cutoff]);
  const futureSeries = useMemo(() => personWeekSeries(detail, personKey, "plan", unit, cutoff, null), [detail, personKey, unit, cutoff]);
  const sum = (s: AfWeekCell[]) => s.reduce((t, c) => t + c.value, 0);

  if (metric === "actual") {
    return (
      <WeekGrid series={[{ label: null, cells: actualSeries }]} money={money}
        emptyText="No imported timesheet weeks for this row here."
        footer={actualSeries.length > 1 ? <>Total <b>{fmtT(sum(actualSeries))}</b> across {actualSeries.length} active weeks</> : null} />
    );
  }
  if (metric === "plan") {
    return (
      <WeekGrid series={[{ label: null, cells: planSeries }]} money={money}
        emptyText="No planned weeks in this window."
        footer={planSeries.length > 1 ? <>Total <b>{fmtT(sum(planSeries))}</b> across {planSeries.length} active weeks</> : null} />
    );
  }
  if (metric === "variance") {
    const diff = sum(planSeries) - sum(actualSeries);
    return (
      <WeekGrid series={[{ label: "Planned", cells: planSeries }, { label: "Actual", cells: actualSeries }]} money={money}
        emptyText="Nothing planned and nothing imported in this window."
        footer={<>Planned <b>{fmtT(sum(planSeries))}</b> − actual <b>{fmtT(sum(actualSeries))}</b> = <b style={{ color: diff > 0 ? GREEN : diff < 0 ? RED : undefined }}>{fmtT(diff)}</b></>} />
    );
  }
  // EAC: one continuous strip — real weeks through the cutoff, then the weeks
  // still on today's plan (shaded so the boundary is visible).
  const combined = [...actualSeries, ...futureSeries]; // disjoint windows, already week-ordered
  return (
    <WeekGrid series={[{ label: null, cells: combined }]} money={money} tintAfter={cutoff}
      emptyText="Nothing used and nothing still planned for this row."
      legend={`Shaded weeks (after ${dateLong(cutoff)}) are still on today's plan; earlier weeks are what was used.`}
      footer={<>Used <b>{fmtT(sum(actualSeries))}</b> + still planned <b>{fmtT(sum(futureSeries))}</b> = <b>{fmtT(sum(actualSeries) + sum(futureSeries))}</b></>} />
  );
}

/** Horizontal week strip: one column per week ("Sep 7 | 33.49"), long all-zero
 * stretches collapsed into a single gap column. Two-series mode (Planned /
 * Actual) shares one week axis so the columns line up. */
function WeekGrid({ series, money, emptyText, tintAfter, legend, footer }: {
  series: { label: string | null; cells: AfWeekCell[] }[];
  money: boolean;
  emptyText: string;
  tintAfter?: string | null;   // shade weeks AFTER this ISO Monday (EAC "still planned")
  legend?: string;
  footer?: React.ReactNode;
}) {
  const cols = useMemo(() => buildWeekStrip(series.map((s) => s.cells)), [series]);
  if (cols.length === 0) {
    return <div style={{ fontSize: 11.5, color: "hsl(var(--muted-foreground))" }}>{emptyText}</div>;
  }
  const hasLabels = series.some((s) => s.label != null);
  const anySub = series.some((s) => s.cells.some((c) => c.substituted));
  const anyApprox = money && series.some((s) => s.cells.some((c) => c.approx));
  const fmtC = (v: number) => (money ? fmtUsd(v) : fmtNum(v));
  const tinted = (w: string) => !!tintAfter && w > tintAfter;
  const tintBg = "#2563eb14";
  let year = "";
  const heads = cols.map((c) => {
    if (c.kind === "gap") return { main: "· · ·", sub: `${c.weeks} wks`, tint: tinted(c.fromWeek), key: `gap:${c.fromWeek}` };
    const [y, m, d] = c.weekMonday.split("-");
    const sub = y !== year ? y : "";
    year = y;
    return { main: `${MONTH_SHORT[Number(m) - 1]} ${Number(d)}`, sub, tint: tinted(c.weekMonday), key: c.weekMonday };
  });
  const th: React.CSSProperties = { padding: "4px 8px 2px", fontSize: 10, fontWeight: 600, color: "hsl(var(--muted-foreground))", textAlign: "center", whiteSpace: "nowrap", borderBottom: "1px solid hsl(var(--border))", borderRight: "1px solid hsl(var(--border))" };
  const td: React.CSSProperties = { padding: "5px 8px", fontSize: 11.5, textAlign: "center", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", borderRight: "1px solid hsl(var(--border))" };
  const sticky: React.CSSProperties = { position: "sticky", left: 0, zIndex: 1, background: "hsl(var(--card))", textAlign: "left" };
  return (
    <div>
      {legend && <div style={{ fontSize: 10.5, color: "hsl(var(--muted-foreground))", marginBottom: 5 }}>{legend}</div>}
      {/* width:0 + minWidth:100% — inside an auto-layout table cell, a plain
          maxWidth:100% still lets the inner table widen the whole column;
          this zeroes the cell's intrinsic contribution so the strip scrolls. */}
      <div style={{ overflowX: "auto", width: 0, minWidth: "100%", border: "1px solid hsl(var(--border))", borderRadius: 8, background: "hsl(var(--card))" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "max-content" }}>
          <thead>
            <tr>
              {hasLabels && <th style={{ ...th, ...sticky }} aria-hidden />}
              {heads.map((h) => (
                <th key={h.key} style={{ ...th, background: h.tint ? tintBg : undefined }}>
                  {h.main}
                  <div style={{ fontWeight: 500, fontSize: 9, lineHeight: "10px", minHeight: 10 }}>{h.sub}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {series.map((s, si) => (
              <tr key={s.label ?? si}>
                {hasLabels && <th scope="row" style={{ ...td, ...sticky, fontSize: 10.5, fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>{s.label}</th>}
                {cols.map((c, ci) => {
                  if (c.kind === "gap") {
                    return <td key={`gap:${ci}`} style={{ ...td, color: "hsl(var(--muted-foreground))", background: tinted(c.fromWeek) ? tintBg : undefined }}>0</td>;
                  }
                  const cell = c.cells[si];
                  return (
                    <td key={c.weekMonday} style={{ ...td, fontWeight: cell ? 600 : 400, color: cell ? undefined : "hsl(var(--muted-foreground))", background: tinted(c.weekMonday) ? tintBg : undefined }}>
                      {cell ? <>{fmtC(cell.value)}{cell.substituted ? "•" : ""}{money && cell.approx ? " ≈" : ""}</> : "0"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer && <div style={{ fontSize: 11.5, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{footer}</div>}
      {(anySub || anyApprox) && (
        <div style={{ fontSize: 10.5, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
          {anySub ? "• planned hours auto-counted for a finished week with no imported timesheet. " : ""}
          {anyApprox ? "≈ estimated rate." : ""}
        </div>
      )}
    </div>
  );
}

function Note({ text, warn }: { text: string; warn?: boolean }) {
  return (
    <div style={{
      fontSize: 11.5, lineHeight: 1.5, borderRadius: 8, padding: "7px 10px",
      border: `1px solid ${warn ? "#d9770640" : "hsl(var(--border))"}`,
      background: warn ? "#d977060d" : "hsl(var(--muted))",
      color: warn ? "#b45309" : "hsl(var(--muted-foreground))",
    }}>{text}</div>
  );
}
