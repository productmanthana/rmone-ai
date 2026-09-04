/* ─────────────────────────────────────────────────────────────
 * Analytics Center — Resource page (Mission Control style).
 * Client-side only: same ReportModel as the hub, so the pages
 * always agree. Charts rule: ONE recharts chart — forward
 * 12-week booked hours vs capacity, computed from REAL
 * allocation dates through the shared alloc-math hours choke
 * point. Week window is scrollable: ◀ ▶ shifts by 12 weeks.
 * Every figure is clickable (DataDrawer) and every card exports
 * to PDF + Excel via CardShell.
 * ──────────────────────────────────────────────────────────── */
import { useState, useMemo } from "react";
import { buildResourceSection } from "@/lib/analyticsPeople";
import { int, type CardModel } from "@/lib/analyticsCenter";
import { getBusinessRules } from "@/lib/businessRules";
import { filterCardByField } from "@/lib/analyticsCenter";
import {
  MissionWorld, SectionHeader, CardShell, StatCard, DrillZone, DrillNumber, useReportModel, LoadingBlock, ErrorBlock,
} from "@/components/analytics/MissionWorld";
import { MC, useMC, Glass } from "@/components/analytics/MissionKit";
import { ArcGauge, MissionColumns, ChartCaption, ExpandableBars } from "@/components/analytics/MissionCharts";
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
        padding: "5px 14px", borderRadius: 5,
        border: active ? "1px solid var(--rm-text)" : "1px solid var(--rm-panel-border)",
        background: active ? "var(--rm-text)" : "transparent",
        cursor: "pointer",
        color: active ? "var(--rm-bg)" : "var(--rm-text)",
        fontSize: 10.5,
        fontFamily: "'IBM Plex Mono',ui-monospace,monospace",
        letterSpacing: "0.06em",
        transition: "background 0.12s, color 0.12s",
      }}
    >
      {label}
    </button>
  );
}

export default function AnalyticsResourcePage() {
  const MC = useMC();
  const { m, loading, error } = useReportModel();
  const [drawer, setDrawer] = useState<CardModel | null>(null);

  /**
   * weekOffset is in whole weeks. 0 = "starts this week",
   * ±12 = shift the 12-week window one page forward/back.
   */
  const [weekOffset, setWeekOffset] = useState(0);

  /** Date that represents the start of the visible window. */
  const shiftedNow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);

  const workWeekHours = getBusinessRules().workWeekHours;
  const s = useMemo(
    () => m ? buildResourceSection(m, workWeekHours, shiftedNow) : null,
    [m, workWeekHours, shiftedNow],
  );

  return (
    <MissionWorld>
      <SectionHeader title="Resource" m={m} error={error} />

      {loading && !m && <LoadingBlock />}
      {!loading && !m && <ErrorBlock text={error || "No staffing data is available right now."} />}

      {s && (
        <>
          {/* hero band: deployed + deployment gauge */}
          <Glass style={{ marginTop: 16, padding: "22px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 24 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: MC.greenInk }}>
                People On Project Work
              </div>
              <div style={{ marginTop: 6 }}>
                <DrillNumber value={s.hero.deployed} card={s.hero.card} onDrill={setDrawer} size={54} />
              </div>
              <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.5, color: MC.muted, maxWidth: 380 }}>{s.hero.explain}</div>
            </div>
            <div
              {...(s.hero.card ? {
                role: "button" as const, tabIndex: 0, title: "See the data behind this number",
                onClick: () => setDrawer(s.hero.card),
                onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(s.hero.card); } },
              } : {})}
              style={{ textAlign: "center", ...(s.hero.card ? { cursor: "zoom-in" } : {}) }}
            >
              <ArcGauge
                pct={s.hero.rate ?? 0}
                size={130}
                label={s.hero.rate != null ? `${s.hero.rate}%` : "—"}
                caption="Deployment rate"
                color={s.hero.rate != null && s.hero.rate >= 70 ? "#8EC94A" : "#F0A842"}
              />
            </div>
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
            {/* scrollable 12-week booked hours chart */}
            {s.weeklyLoad && (() => {
              const rows = s.weeklyLoad.rows;
              const firstWeek = rows[0]?.week ?? "";
              const lastWeek  = rows[rows.length - 1]?.week ?? "";
              const rangeLabel = firstWeek && lastWeek ? `${firstWeek} → ${lastWeek}` : "Next 12 Weeks";
              const isPast   = weekOffset < 0;
              const isFuture = weekOffset > 0;

              return (
                <CardShell
                  title={`Booked Hours — ${rangeLabel}`}
                  takeaway={`Hours booked on allocations each week${s.weeklyLoad.capacity != null ? ` — full-roster capacity is ${int(s.weeklyLoad.capacity)}h per week` : ""}. Use the arrows to step through weeks.`}
                  card={s.weeklyLoad.card}
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
                      yKey="hours"
                      color="#6B99BB"
                      height={220}
                      yFmt={v => `${int(v)}h`}
                      onBarClick={row => {
                        if (Number(row.hours ?? 0) === 0) return;
                         const week = String(row.week ?? "");
                         if (!week || !s.weeklyLoad) return;
                         setDrawer(s.weeklyLoad.drillCards[week] ?? filterCardByField(s.weeklyLoad.card, "week", week));
                      }}
                    />
                  </div>
                  <ChartCaption
                    items={[
                      { label: "Booked hours per week", color: "#6B99BB" },
                      ...(s.weeklyLoad.capacity != null ? [{ label: `Capacity ${int(s.weeklyLoad.capacity)}h / week`, color: "rgba(255,255,255,0.35)" }] : []),
                    ]}
                  />
                </CardShell>
              );
            })()}

            {/* Busiest People — full width so the list has room to breathe */}
            {s.busiest && (
              <CardShell
                title="Busiest People"
                takeaway="The most heavily booked people right now."
                card={s.busiest.card}
                onDrill={setDrawer}
                style={{ gridColumn: "1 / -1" }}
              >
                <DrillZone card={s.busiest.card} onDrill={setDrawer} label="See every deployed person">
                  <ExpandableBars
                    rows={s.busiest.rows.map(p => ({ label: p.name, v: p.utilization, text: `${int(p.utilization)}% · ${int(p.activeProjects)} project${p.activeProjects === 1 ? "" : "s"}` }))}
                    initial={8}
                    noun="people"
                    color="#F0A842"
                    onBarClick={row => setDrawer(filterCardByField(s.busiest!.card, "name", row.label))}
                  />
                </DrillZone>
              </CardShell>
            )}

            {/* Most Projects Per Person — full width */}
            {s.mostProjects && (
              <CardShell
                title="Most Projects Per Person"
                takeaway="Who is spread across the most active projects at once."
                card={s.mostProjects.card}
                onDrill={setDrawer}
                style={{ gridColumn: "1 / -1" }}
              >
                <DrillZone card={s.mostProjects.card} onDrill={setDrawer} label="See the people on several projects">
                  <ExpandableBars
                    rows={s.mostProjects.rows.map(p => ({ label: p.name, v: p.activeProjects, text: `${int(p.activeProjects)} project${p.activeProjects === 1 ? "" : "s"} · ${int(p.utilization)}%` }))}
                    initial={8}
                    noun="people"
                    color="#A78BFA"
                    onBarClick={row => setDrawer(filterCardByField(s.mostProjects!.card, "name", row.label))}
                  />
                </DrillZone>
              </CardShell>
            )}

            {s.overBooked && (
              <CardShell
                title="Over-Booked People"
                takeaway="People whose current load is above a full week — candidates for rebalancing."
                card={s.overBooked.card}
                onDrill={setDrawer}
              >
                <DrillZone card={s.overBooked.card} onDrill={setDrawer} label="See everyone over a full load">
                  <ExpandableBars
                    rows={s.overBooked.rows.map(p => ({ label: p.name, v: p.utilization, text: `${int(p.utilization)}%` }))}
                    initial={8}
                    noun="people"
                    color="#F87171"
                    onBarClick={row => setDrawer(filterCardByField(s.overBooked!.card, "name", row.label))}
                  />
                </DrillZone>
              </CardShell>
            )}
          </div>

          <div style={{ marginTop: 18, fontSize: 11, color: MC.faint }}>
            Weekly hours use the same allocation math as the Resources page.
          </div>
        </>
      )}

      <DataDrawer card={drawer} onClose={() => setDrawer(null)} />
    </MissionWorld>
  );
}
