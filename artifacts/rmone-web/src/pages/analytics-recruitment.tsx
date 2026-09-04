/* ─────────────────────────────────────────────────────────────
 * Analytics Center — Recruitment page (Mission Control style).
 *
 * Recruitment Capacity Variance, per role, in HOURS:
 *   variance = available hours − required hours
 *   negative = shortage (recruit) · positive = surplus · 0 = matched
 *
 * Available = roster capacity (Settings work week, minus company
 * holidays on working days, scaled by each person's leave windows).
 * Required = booked allocation hours + open-position demand, as
 * planned — never holiday-reduced (that would deduct twice).
 *
 * Charts: max 3 — the role variance runway (diverging bars) and
 * the week-by-week balance strip. All figures are PLANNED.
 * ──────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useState } from "react";
import { CalendarOff, Scale, UserPlus } from "lucide-react";
import { getRecruitmentAnalytics, type RecruitmentAnalytics, type RecruitRoleRow } from "@/lib/api";
import { type CardModel, type CardExplanation } from "@/lib/analyticsCenter";
import {
  MissionWorld, SectionHeader, CardShell, StatCard, DrillZone, useReportModel, LoadingBlock,
} from "@/components/analytics/MissionWorld";
import { useMC, Glass } from "@/components/analytics/MissionKit";
import { ChartCaption } from "@/components/analytics/MissionCharts";
import { DataDrawer } from "@/components/analytics/DataDrawer";
import { PeriodPicker, DEFAULT_PERIOD, type PeriodState } from "@/components/analytics/PeriodPicker";
import { getPeriodRange, type PeriodRange } from "@/lib/reportsCenter";

const SHORT = "#F0716B";   // shortage (recruit)
const SHORT_SOFT = "rgba(240,113,107,0.16)";
const SURPLUS = "#8EC94A"; // surplus (bench capacity)
const SURPLUS_SOFT = "rgba(142,201,74,0.16)";
const MATCH = "#6B99BB";

/* hours formatting — whole hours everywhere (≤2-decimal display rule) */
const h0 = (n: number) => Math.round(n).toLocaleString("en-US");
const signedH = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${h0(Math.abs(n))}`;
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const weekLabel = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    : iso;
};

/** Inclusive ISO [start, end] from the picker's [start, end) local range. */
function isoRange(r: PeriodRange): { start: string; end: string } {
  const endIncl = new Date(r.end.getTime() - 86_400_000);
  return { start: isoLocal(r.start), end: isoLocal(endIncl) };
}

const VARIANCE_EXPLAIN: CardExplanation = {
  meaning:
    "Whether each role's team has enough planned hours to cover the work booked for this period. A negative variance is a recruitment gap; a positive one is spare capacity.",
  calculation:
    "Variance = available − required, in hours. Available = each person's weekly capacity (work-week hours minus company holidays on working days, scaled by recorded leave), summed into their role. Required = booked allocation hours plus open-position demand, counted as planned — holidays never reduce the requirement side.",
  measure: "planned" as const,
  source: "Allocation plans, open positions, roster and Settings calendar rules",
};

/* ── chart 1: role variance runway (diverging horizontal bars) ── */
function VarianceRunway({ roles, onPick }: {
  roles: RecruitRoleRow[];
  onPick: (r: RecruitRoleRow) => void;
}) {
  const mc = useMC();
  const maxAbs = Math.max(1, ...roles.map(r => Math.abs(r.variance)));
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 }}>
      {/* zero axis */}
      <div style={{
        position: "absolute", top: 0, bottom: 0, left: "calc(172px + (100% - 172px - 86px) / 2)",
        width: 1, background: mc.border, zIndex: 0,
      }} />
      {roles.map(r => {
        const short = r.variance < -0.05;
        const surplus = r.variance > 0.05;
        const frac = Math.min(1, Math.abs(r.variance) / maxAbs);
        const color = short ? SHORT : surplus ? SURPLUS : MATCH;
        return (
          <div
            key={r.role}
            role="button"
            tabIndex={0}
            title={`${r.role} — available ${h0(r.available)} h · required ${h0(r.required)} h · click for the week-by-week detail`}
            onClick={() => onPick(r)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(r); } }}
            style={{
              display: "grid", gridTemplateColumns: "160px 1fr 74px", alignItems: "center", gap: 12,
              cursor: "zoom-in", position: "relative", zIndex: 1, padding: "3px 0",
            }}
          >
            <div style={{ fontSize: 11.5, fontWeight: 600, color: mc.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>
              {r.role}
              <div style={{ fontSize: 9.5, fontWeight: 500, color: mc.faint }}>
                {r.people} {r.people === 1 ? "person" : "people"}
                {r.openPositions > 0 ? ` · ${r.openPositions} open` : ""}
              </div>
            </div>
            <div style={{ position: "relative", height: 18 }}>
              {/* left half = shortage, right half = surplus */}
              <div style={{
                position: "absolute", top: 2, bottom: 2, borderRadius: 5,
                ...(short
                  ? { right: "50%", width: `${frac * 50}%`, background: `linear-gradient(90deg, ${SHORT}, ${SHORT}CC)`, boxShadow: `0 0 12px ${SHORT_SOFT}` }
                  : surplus
                    ? { left: "50%", width: `${frac * 50}%`, background: `linear-gradient(90deg, ${SURPLUS}CC, ${SURPLUS})`, boxShadow: `0 0 12px ${SURPLUS_SOFT}` }
                    : { left: "calc(50% - 2px)", width: 4, background: MATCH }),
              }} />
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums", color, textAlign: "left" }}>
              {signedH(r.variance)}<span style={{ fontSize: 9, fontWeight: 600, color: mc.faint }}> h</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── chart 2: week-by-week balance strip (diverging columns) ── */
/** Compact per-bar value label — whole hours below 1 000, "1.2k" above. */
function fmtBarHours(v: number): string {
  const a = Math.abs(v);
  const num = a >= 1000 ? `${(a / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(Math.round(a));
  return v < -0.05 ? `−${num}` : num;
}

function WeeklyBalanceStrip({ weeks }: { weeks: { weekStart: string; available: number; required: number; variance: number }[] }) {
  const mc = useMC();
  const maxAbs = Math.max(1, ...weeks.map(w => Math.abs(w.variance)));
  const H = 120, mid = H / 2;
  const labelEvery = weeks.length > 16 ? Math.ceil(weeks.length / 12) : 1;
  // Per-bar value labels stay readable only while bars are reasonably wide.
  const showValues = weeks.length <= 20;
  return (
    <div>
      <div style={{ position: "relative", display: "flex", alignItems: "stretch", gap: 3, height: H }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: mid, height: 1, background: mc.border }} />
        {weeks.map(w => {
          const short = w.variance < -0.05;
          const frac = Math.min(1, Math.abs(w.variance) / maxAbs);
          // Leave headroom above/below each bar for its value label.
          const barH = Math.max(w.variance === 0 ? 2 : 3, frac * (mid - 18));
          const lbl = fmtBarHours(w.variance);
          return (
            <div
              key={w.weekStart}
              title={`Week of ${weekLabel(w.weekStart)} — available ${h0(w.available)} h · required ${h0(w.required)} h · ${short ? "short" : "spare"} ${h0(Math.abs(w.variance))} h`}
              style={{ flex: 1, position: "relative", minWidth: 6 }}
            >
              <div style={{
                position: "absolute", left: "12%", right: "12%", borderRadius: 3,
                ...(short
                  ? { top: mid, height: barH, background: `linear-gradient(180deg, ${SHORT}, ${SHORT}88)` }
                  : { bottom: H - mid, height: barH, background: `linear-gradient(0deg, ${SURPLUS}88, ${SURPLUS})` }),
              }} />
              {/* value label at the outer end of the bar */}
              {showValues && <div style={{
                position: "absolute", left: "-30%", right: "-30%", textAlign: "center",
                fontSize: 8.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1,
                color: short ? SHORT : w.variance > 0.05 ? SURPLUS : mc.faint,
                whiteSpace: "nowrap", pointerEvents: "none",
                ...(short ? { top: mid + barH + 4 } : { bottom: (H - mid) + barH + 4 }),
              }}>
                {lbl}
              </div>}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 3, marginTop: 5 }}>
        {weeks.map((w, i) => (
          <div key={w.weekStart} style={{ flex: 1, minWidth: 6, fontSize: 8.5, color: mc.faint, textAlign: "center", whiteSpace: "nowrap", overflow: "visible" }}>
            {i % labelEvery === 0 ? weekLabel(w.weekStart) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsRecruitmentPage() {
  const MCp = useMC();
  const { m, error } = useReportModel(); // header status only — figures come from the server payload
  const [period, setPeriod] = useState<PeriodState>(DEFAULT_PERIOD);
  const [data, setData] = useState<RecruitmentAnalytics | null | "loading">("loading");
  const [drawer, setDrawer] = useState<CardModel | null>(null);

  const range = useMemo(
    () => getPeriodRange(period.kind, period.customStart, period.customEnd),
    [period],
  );
  const { start, end } = isoRange(range);
  const customIncomplete = period.kind === "custom" && (!period.customStart || !period.customEnd);

  useEffect(() => {
    if (customIncomplete) return;
    let alive = true;
    // Keep the previous payload on screen while a new period loads — only the
    // very first fetch (or a failed one) shows the full-page spinner; period
    // switches just swap the numbers in place when the response lands.
    setData(prev => (prev === "loading" || prev === null ? "loading" : prev));
    getRecruitmentAnalytics(start, end).then(r => { if (alive) setData(r); });
    return () => { alive = false; };
  }, [start, end, customIncomplete]);

  const ok = data !== "loading" && data !== null && data.available === true ? data : null;

  /* ── drill cards ── */
  const roleCard: CardModel | null = ok ? {
    id: "recruitment",
    title: "Recruitment — Capacity Variance by Role",
    takeaway: "Available minus required hours for every role in the selected period. Negative rows are recruitment gaps.",
    stats: [
      { label: "Roles short", value: String(ok.totals.rolesShort) },
      { label: "Roles with spare hours", value: String(ok.totals.rolesSurplus) },
      { label: "Open positions", value: String(ok.totals.openPositions) },
    ],
    columns: [
      { key: "role", label: "Role", kind: "text" },
      { key: "people", label: "People", kind: "int", align: "right" },
      { key: "openPositions", label: "Open positions", kind: "int", align: "right" },
      { key: "available", label: "Available (h)", kind: "int", align: "right" },
      { key: "booked", label: "Booked (h)", kind: "int", align: "right" },
      { key: "unfilled", label: "Unfilled demand (h)", kind: "int", align: "right" },
      { key: "variance", label: "Variance (h)", kind: "int", align: "right" },
    ],
    rows: ok.roles.map(r => ({
      role: r.role,
      people: r.people,
      openPositions: r.openPositions,
      available: Math.round(r.available),
      booked: Math.round(r.staffedHours),
      unfilled: Math.round(r.demandHours),
      variance: Math.round(r.variance),
    })),
    explanation: {
      ...VARIANCE_EXPLAIN,
      period: `${range.label} (${start} → ${end})`,
      completeness: `Roster: ${ok.totals.people} enabled people · calendar: ${ok.workingDays}-day work week, ${ok.workWeekHours} h`,
    },
  } : null;

  const weeklyCardFor = (r: RecruitRoleRow): CardModel => ({
    id: "recruitment",
    title: `Recruitment — ${r.role}, week by week`,
    takeaway: r.variance < -0.05
      ? `${r.role} is short ${h0(Math.abs(r.variance))} hours across this period.`
      : r.variance > 0.05
        ? `${r.role} has ${h0(r.variance)} spare hours across this period.`
        : `${r.role} is exactly matched this period.`,
    stats: [
      { label: "Available", value: `${h0(r.available)} h` },
      { label: "Required", value: `${h0(r.required)} h` },
      { label: "Variance", value: `${signedH(r.variance)} h` },
    ],
    columns: [
      { key: "week", label: "Week of", kind: "text" },
      { key: "available", label: "Available (h)", kind: "int", align: "right" },
      { key: "required", label: "Required (h)", kind: "int", align: "right" },
      { key: "variance", label: "Variance (h)", kind: "int", align: "right" },
    ],
    rows: r.weekly.map(w => ({
      week: weekLabel(w.weekStart),
      available: Math.round(w.available),
      required: Math.round(w.required),
      variance: Math.round(w.variance),
    })),
    explanation: {
      ...VARIANCE_EXPLAIN,
      period: `${range.label} (${start} → ${end})`,
      completeness: `${r.people} ${r.people === 1 ? "person" : "people"} in this role · ${r.openPositions} open position${r.openPositions === 1 ? "" : "s"}`,
    },
  });

  const weeklyTotalsCard: CardModel | null = ok ? {
    id: "recruitment",
    title: "Recruitment — Whole Company, Week by Week",
    takeaway: "Available vs required hours per week across every role.",
    stats: [
      { label: "Available", value: `${h0(ok.totals.available)} h` },
      { label: "Required", value: `${h0(ok.totals.required)} h` },
      { label: "Net variance", value: `${signedH(ok.totals.variance)} h` },
    ],
    columns: [
      { key: "week", label: "Week of", kind: "text" },
      { key: "available", label: "Available (h)", kind: "int", align: "right" },
      { key: "required", label: "Required (h)", kind: "int", align: "right" },
      { key: "variance", label: "Variance (h)", kind: "int", align: "right" },
    ],
    rows: ok.weeklyTotals.map(w => ({
      week: weekLabel(w.weekStart),
      available: Math.round(w.available),
      required: Math.round(w.required),
      variance: Math.round(w.variance),
    })),
    explanation: {
      ...VARIANCE_EXPLAIN,
      period: `${range.label} (${start} → ${end})`,
      completeness: `Roster: ${ok.totals.people} enabled people`,
    },
  } : null;

  const shortRoles = ok ? ok.roles.filter(r => r.variance < -0.05) : [];
  const gapTone = ok ? (ok.totals.rolesShort > 0 ? SHORT : SURPLUS) : MCp.muted;

  return (
    <MissionWorld>
      <SectionHeader
        title="Recruitment"
        m={m}
        error={error}
        right={<PeriodPicker value={period} onChange={setPeriod} />}
      />

      {customIncomplete ? (
        <Glass style={{ marginTop: 18, padding: 40, textAlign: "center", color: MCp.muted, fontSize: 12 }}>
          Pick both custom dates to run the recruitment math for that window.
        </Glass>
      ) : data === "loading" ? (
        <LoadingBlock text="Computing capacity vs demand for every role…" />
      ) : data === null ? (
        <Glass style={{ marginTop: 18, padding: 40, textAlign: "center", color: MCp.warn, fontSize: 12 }}>
          The recruitment math didn't load. Refresh the page to try again — nothing is estimated in the meantime.
        </Glass>
      ) : data.available === false ? (
        <Glass style={{ marginTop: 18, padding: 40, textAlign: "center", color: MCp.muted, fontSize: 12, lineHeight: 1.7 }}>
          {data.reason || "Recruitment analytics isn't supported for this company's data source yet."}
        </Glass>
      ) : ok && (
        <>
          {/* ── hero band: the single recruitment headline ── */}
          <Glass style={{ marginTop: 18, padding: "22px 26px", position: "relative", overflow: "hidden" }}>
            <div style={{
              position: "absolute", inset: 0, pointerEvents: "none",
              background: `radial-gradient(520px 180px at 18% 0%, ${ok.totals.rolesShort > 0 ? SHORT_SOFT : SURPLUS_SOFT}, transparent 70%)`,
            }} />
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 26, position: "relative" }}>
              <DrillZone card={roleCard} onDrill={setDrawer} label="See every role behind this headline">
                <div style={{ display: "flex", alignItems: "center", gap: 16, cursor: "zoom-in" }}>
                  <div style={{
                    width: 46, height: 46, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center",
                    background: `linear-gradient(140deg, ${gapTone}, ${gapTone}99)`, boxShadow: `0 0 26px ${gapTone}55`, color: "#10160a",
                  }}>
                    <UserPlus size={22} style={{ color: "rgba(10,14,6,0.85)" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: MCp.faint }}>
                      Recruitment capacity variance · {range.label}
                    </div>
                    <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.15, color: gapTone, fontVariantNumeric: "tabular-nums" }}>
                      {ok.totals.rolesShort > 0 ? `${h0(ok.totals.shortageHours)} h short` : "No gaps"}
                      <span style={{ fontSize: 13, fontWeight: 600, color: MCp.muted, marginLeft: 10 }}>
                        {ok.totals.rolesShort > 0
                          ? `across ${ok.totals.rolesShort} role${ok.totals.rolesShort === 1 ? "" : "s"}`
                          : "every role is covered this period"}
                      </span>
                    </div>
                  </div>
                </div>
              </DrillZone>
              <div style={{ marginLeft: "auto", display: "flex", gap: 22, flexWrap: "wrap" }}>
                {[
                  { label: "Available", value: `${h0(ok.totals.available)} h`, color: MCp.text },
                  { label: "Required", value: `${h0(ok.totals.required)} h`, color: MCp.text },
                  { label: "Net balance", value: `${signedH(ok.totals.variance)} h`, color: ok.totals.variance < 0 ? SHORT : SURPLUS },
                  { label: "Open positions", value: h0(ok.totals.openPositions), color: MCp.text },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: MCp.faint }}>{s.label}</div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: s.color, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </Glass>

          {/* ── stat row ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 12 }}>
            <StatCard label="Roles needing recruitment" value={String(ok.totals.rolesShort)} card={roleCard} onDrill={setDrawer}>
              <div style={{ marginTop: 6, fontSize: 10.5, color: MCp.faint }}>
                {shortRoles.length > 0
                  ? `Biggest gap: ${shortRoles[0].role} (${h0(Math.abs(shortRoles[0].variance))} h)`
                  : "No role is under water this period"}
              </div>
            </StatCard>
            <StatCard label="Roles with spare hours" value={String(ok.totals.rolesSurplus)} card={roleCard} onDrill={setDrawer}>
              <div style={{ marginTop: 6, fontSize: 10.5, color: MCp.faint }}>
                {`${h0(ok.totals.surplusHours)} spare hours could absorb new work`}
              </div>
            </StatCard>
            <StatCard label="People contributing capacity" value={h0(ok.totals.people)} card={roleCard} onDrill={setDrawer}>
              <div style={{ marginTop: 6, fontSize: 10.5, color: MCp.faint }}>
                {`${ok.workWeekHours} h work week · ${ok.workingDays} working days`}
              </div>
            </StatCard>
            <StatCard label="Unfilled demand" value={`${h0(ok.roles.reduce((s, r) => s + r.demandHours, 0))} h`} card={roleCard} onDrill={setDrawer}>
              <div style={{ marginTop: 6, fontSize: 10.5, color: MCp.faint }}>
                {`${h0(ok.totals.openPositions)} open position${ok.totals.openPositions === 1 ? "" : "s"} still to fill`}
              </div>
            </StatCard>
          </div>

          {/* ── chart 1: role variance runway ── */}
          <CardShell
            title="Where to recruit — variance by role"
            takeaway="Bars left of the line are shortages (recruit or rebalance); bars right of it are spare capacity. Click a role for its week-by-week detail."
            card={roleCard}
            onDrill={setDrawer}
            style={{ marginTop: 12 }}
          >
            {ok.roles.length === 0 ? (
              <div style={{ padding: 30, textAlign: "center", fontSize: 12, color: MCp.muted }}>
                No roster capacity and no booked work fall inside this period.
              </div>
            ) : (
              <>
                <VarianceRunway roles={ok.roles} onPick={r => setDrawer(weeklyCardFor(r))} />
                <ChartCaption items={[
                  { label: "Shortage — recruitment gap", color: SHORT },
                  { label: "Surplus — spare hours", color: SURPLUS },
                  { label: "Matched", color: MATCH },
                ]} />
              </>
            )}
          </CardShell>

          {/* ── chart 2: weekly balance ── */}
          <CardShell
            title="When the crunch hits — week by week"
            takeaway="Net hours balance across all roles for each week in the period. Bars below the line are weeks where booked work exceeds team capacity."
            card={weeklyTotalsCard}
            onDrill={setDrawer}
            style={{ marginTop: 12 }}
          >
            <WeeklyBalanceStrip weeks={ok.weeklyTotals} />
            <ChartCaption items={[
              { label: "Spare hours that week", color: SURPLUS },
              { label: "Short that week", color: SHORT },
            ]} />
          </CardShell>

          {/* ── capacity basis — plain-language honesty note ── */}
          <Glass style={{ marginTop: 12, padding: "14px 18px", display: "flex", gap: 14, alignItems: "flex-start" }}>
            <Scale size={15} style={{ color: MCp.muted, marginTop: 2, flexShrink: 0 }} />
            <div style={{ fontSize: 11, color: MCp.muted, lineHeight: 1.7 }}>
              <strong style={{ color: MCp.text }}>How these numbers are built.</strong>{" "}
              Available hours = each person's {ok.workWeekHours}-hour work week — that number comes from your
              company's Settings ("Hours in a full week"), not a fixed default — minus company holidays that land on
              working days, scaled down by recorded leave, then summed into their role. Required hours = allocation
              plans plus open-position demand, exactly as booked (holidays never shrink the requirement — that would
              deduct the same day twice). Everything here is <strong style={{ color: MCp.text }}>planned</strong> work,
              not timesheets, and people without a recorded role are shown honestly under "No role recorded".
              {ok.holidaysInPeriod.length > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, color: MCp.faint }}>
                  <CalendarOff size={12} style={{ flexShrink: 0 }} />
                  {ok.holidaysInPeriod.length} company holiday{ok.holidaysInPeriod.length === 1 ? "" : "s"} inside this period:{" "}
                  {ok.holidaysInPeriod.map(weekLabel).join(" · ")}
                </span>
              )}
            </div>
          </Glass>
        </>
      )}

      <DataDrawer card={drawer} onClose={() => setDrawer(null)} />
    </MissionWorld>
  );
}
