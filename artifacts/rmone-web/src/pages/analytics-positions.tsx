/* ─────────────────────────────────────────────────────────────
 * Analytics Center — Open Positions & Demand page (Mission
 * Control style). Client-side only: same ReportModel as the
 * hub, so the open-seat count always equals the hub tile.
 * Charts rule: ONE recharts chart — open seats needing coverage
 * per coming week, from REAL position start/end dates. No
 * win-scenario or 3/6/9-month outlook is shown (that would be
 * fabricated). "Aging" is framed from position start dates —
 * there is no created-date to age from.
 * Every figure is clickable (DataDrawer) and every card exports
 * to PDF + Excel via CardShell.
 * ──────────────────────────────────────────────────────────── */
import { useState, useMemo } from "react";
import { buildOpenPositionsSection } from "@/lib/analyticsPeople";
import { int, type CardModel } from "@/lib/analyticsCenter";
import { filterCardByField } from "@/lib/analyticsCenter";
import {
  MissionWorld, SectionHeader, CardShell, StatCard, DrillZone, DrillNumber, useReportModel, LoadingBlock, ErrorBlock,
} from "@/components/analytics/MissionWorld";
import { MC, useMC, Glass } from "@/components/analytics/MissionKit";
import { MissionColumns, ChartCaption, MissionHorizBars, ExpandableBars, MissionDonut } from "@/components/analytics/MissionCharts";
import { DataDrawer } from "@/components/analytics/DataDrawer";

/** Minimal arrow-button used in the week-window navigator. */
function NavBtn({
  onClick, label, active,
}: {
  onClick: () => void;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "9px 20px", borderRadius: 7,
        border: active ? "1px solid var(--rm-text)" : "1px solid var(--rm-panel-border)",
        background: active ? "var(--rm-text)" : "transparent",
        cursor: "pointer",
        color: active ? "var(--rm-bg)" : "var(--rm-text)",
        fontSize: 13,
        fontFamily: "'IBM Plex Mono',ui-monospace,monospace",
        letterSpacing: "0.06em",
        transition: "background 0.12s, color 0.12s",
      }}
    >
      {label}
    </button>
  );
}

export default function AnalyticsPositionsPage() {
  const MC = useMC();
  const { m, loading, error } = useReportModel();
  const [drawer, setDrawer] = useState<CardModel | null>(null);

  /**
   * weekOffset is in whole weeks. 0 = "starts this week",
   * ±12 = shift the 12-week window one page forward/back.
   */
  const [weekOffset, setWeekOffset] = useState(0);

  /** Date that represents the start of the visible chart window.
   *  The real current date is passed as `now` separately so that
   *  timing buckets (donut, KPIs) are never affected by navigation. */
  const shiftedNow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);

  const s = useMemo(
    () => m ? buildOpenPositionsSection(m, new Date(), shiftedNow) : null,
    [m, shiftedNow],
  );

  return (
    <MissionWorld>
      <SectionHeader title="Open Positions & Demand" m={m} error={error} />

      {loading && !m && <LoadingBlock />}
      {!loading && !m && <ErrorBlock text={error || "No demand data is available right now."} />}

      {s && (
        <>
          {/* hero band: unfilled seats */}
          <Glass style={{ marginTop: 16, padding: "22px 28px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 24 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: MC.greenInk }}>
                Seats Still To Fill
              </div>
              <div style={{ marginTop: 6 }}>
                <DrillNumber value={s.hero.value} card={s.hero.card} onDrill={setDrawer} size={54} />
              </div>
              <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.5, color: MC.muted, maxWidth: 420 }}>{s.hero.explain}</div>
            </div>
            {s.hero.rolesAffected != null && (
              <div
                role={s.hero.rolesCard ? "button" : undefined}
                tabIndex={s.hero.rolesCard ? 0 : undefined}
                onClick={s.hero.rolesCard ? () => setDrawer(s.hero.rolesCard) : undefined}
                onKeyDown={s.hero.rolesCard ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(s.hero.rolesCard); } }) : undefined}
                title={s.hero.rolesCard ? "See every open seat by role" : undefined}
                style={{
                  padding: "12px 18px", borderRadius: 12, textAlign: "center",
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
                  cursor: s.hero.rolesCard ? "pointer" : undefined,
                }}
              >
                <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "#F0A842" }}>
                  {int(s.hero.rolesAffected)}
                </div>
                <div style={{ marginTop: 2, fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: MC.faint }}>
                  Roles affected
                </div>
              </div>
            )}
          </Glass>

          {/* KPI band */}
          {s.kpis.length > 0 && (
            <div style={{ marginTop: 16, display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              {s.kpis.map(k => (
                <StatCard key={k.label} label={k.label} value={k.value} card={k.card} onDrill={setDrawer} />
              ))}
            </div>
          )}

          <div style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
            {/* timing strip — from real start dates, always uses real current date */}
            {s.timing && (
              <CardShell
                title="When Each Seat Is Needed"
                takeaway="Open seats grouped by how soon their window starts. Positions whose window already began are the most urgent."
                card={s.timing.card}
                onDrill={setDrawer}
                style={{ gridColumn: "1 / -1" }}
              >
                <MissionDonut
                  total={s.timing.total}
                  segments={s.timing.segments}
                  onSegmentClick={(seg) => setDrawer(filterCardByField(s.timing!.card, "timing", seg.label))}
                />
              </CardShell>
            )}

            {/* forward coverage — the ONE recharts chart on this page */}
            {s.weeklySeats && (() => {
              const rows = s.weeklySeats.rows;
              const firstWeek = rows[0]?.week ?? "";
              const lastWeek  = rows[rows.length - 1]?.week ?? "";
              const rangeLabel = firstWeek && lastWeek ? `${firstWeek} → ${lastWeek}` : "Next 12 Weeks";
              const isPast   = weekOffset < 0;
              const isFuture = weekOffset > 0;

              return (
                <CardShell
                  title={`Seats Needing Coverage — ${rangeLabel}`}
                  takeaway={`How many open seats need someone in each coming week, from real position dates.${s.weeklySeats.benchNote ? ` ${s.weeklySeats.benchNote}` : ""} Use the arrows to step through weeks.`}
                  card={s.weeklySeats.card}
                  onDrill={setDrawer}
                  style={{ gridColumn: "1 / -1" }}
                >
                  {/* week-window navigator — stopPropagation keeps it from triggering the card drill */}
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}
                  >
                    <NavBtn label="← Prev 12w" onClick={() => setWeekOffset(o => o - 12)} />
                    {weekOffset !== 0 && (
                      <NavBtn label="Today" active onClick={() => setWeekOffset(0)} />
                    )}
                    <NavBtn label="Next 12w →" onClick={() => setWeekOffset(o => o + 12)} />
                    {weekOffset !== 0 && (
                      <span style={{ fontSize: 11, color: MC.faint, fontStyle: "italic", marginLeft: 4 }}>
                        {isPast
                          ? `Showing ${Math.abs(weekOffset)}w back from today`
                          : isFuture
                            ? `Showing ${weekOffset}w ahead of today`
                            : ""}
                      </span>
                    )}
                  </div>

                  <div onClick={e => e.stopPropagation()}>
                    <MissionColumns
                      data={rows.map(r => ({ ...r }))}
                      xKey="week"
                      yKey="seats"
                      color="#F0A842"
                      height={220}
                      yFmt={v => int(v)}
                       onBarClick={(row) => {
                         const week = String(row.week ?? "");
                         if (!week || !s.weeklySeats) return;
                         setDrawer(s.weeklySeats.drillCards[week] ?? filterCardByField(s.weeklySeats.card, "week", week));
                       }}
                    />
                  </div>
                  <ChartCaption items={[{ label: "Open seats in that week", color: "#F0A842" }]} />
                </CardShell>
              );
            })()}

          </div>

          {/* Gaps by Role + Most Affected Projects — fixed 1fr 1fr so they're always equal width */}
          {(s.byRole || s.affectedProjects) && (
            <div style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
              {s.byRole && (
                <CardShell
                  title="Gaps by Role"
                  takeaway="Which roles the firm is short of, biggest gap first."
                  card={s.byRole.card}
                  onDrill={setDrawer}
                >
                  <DrillZone card={s.byRole.card} onDrill={setDrawer} label="See every open seat, grouped by role">
                    <ExpandableBars
                      rows={s.byRole.allRows.map(r => ({ label: r.label, v: r.v, text: `${int(r.v)} seat${r.v === 1 ? "" : "s"}` }))}
                      initial={8}
                      noun="roles"
                      color="#8EC94A"
                      onBarClick={(row) => setDrawer(filterCardByField(s.byRole!.card, "role", row.label))}
                    />
                  </DrillZone>
                </CardShell>
              )}

              {s.affectedProjects && (
                <CardShell
                  title="Most Affected Projects"
                  takeaway="Projects with the most unfilled seats — each row links to the record."
                  card={s.affectedProjects.card}
                  onDrill={setDrawer}
                >
                  <ExpandableBars
                    rows={s.affectedProjects.rows.map(r => ({
                      label: r.project,
                      v: r.seats,
                      text: `${int(r.seats)} open seat${r.seats === 1 ? "" : "s"} · ${r.roles}`,
                    }))}
                    initial={8}
                    noun="projects"
                    color="#F0A842"
                    onBarClick={(row) => setDrawer(filterCardByField(s.affectedProjects!.card, "project", row.label))}
                  />
                </CardShell>
              )}
            </div>
          )}

          <div style={{ marginTop: 18, fontSize: 11, color: MC.faint }}>
            No hiring-outlook scenarios are shown because they can't be computed from stored data — nothing here is estimated.
          </div>
        </>
      )}

      <DataDrawer card={drawer} onClose={() => setDrawer(null)} />
    </MissionWorld>
  );
}
