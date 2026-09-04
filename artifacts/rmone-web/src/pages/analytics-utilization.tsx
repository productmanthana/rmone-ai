/* ─────────────────────────────────────────────────────────────
 * Analytics Center — Utilization page (Mission Control style).
 * Client-side only: same ReportModel as the hub, so the average
 * here always equals the hub tile. Charts rule: ZERO recharts
 * charts — the page is a gauge, a band strip, a division
 * scoreboard and ranked lists. No 12-month climb is shown
 * (no stored history). The industry benchmark strip is a
 * clearly-labeled STATIC reference, never computed from data.
 * Every figure is clickable (DataDrawer) and every card exports
 * to PDF + Excel via CardShell.
 * ──────────────────────────────────────────────────────────── */
import { useState } from "react";
import { buildUtilizationSection } from "@/lib/analyticsPeople";
import { int, orgDimLabel, selectByOrgDim, type CardModel } from "@/lib/analyticsCenter";
import { filterCardByField } from "@/lib/analyticsCenter";
import {
  MissionWorld, SectionHeader, CardShell, StatCard, DrillZone, DrillNumber, useReportModel, LoadingBlock, ErrorBlock,
} from "@/components/analytics/MissionWorld";
import { MC, useMC, Glass } from "@/components/analytics/MissionKit";
import { ArcGauge, MissionHorizBars, ExpandableBars, MissionDonut } from "@/components/analytics/MissionCharts";
import { DataDrawer } from "@/components/analytics/DataDrawer";
import { OrgDimPicker, useOrgDim } from "@/components/analytics/OrgDimPicker";

export default function AnalyticsUtilizationPage() {
  const MC = useMC();
  const { m, loading, error } = useReportModel();
  const [drawer, setDrawer] = useState<CardModel | null>(null);
  /* Shared Analytics Center org-dimension selection (same session key as the
   * other Center pages — the choice follows the user across pages). */
  const [orgDim, setOrgDim] = useOrgDim("analytics:orgDim");

  const s = m ? buildUtilizationSection(m) : null;

  return (
    <MissionWorld>
      <SectionHeader title="Utilization" m={m} error={error} />

      {loading && !m && <LoadingBlock />}
      {!loading && !m && <ErrorBlock text={error || "No staffing data is available right now."} />}

      {s && (
        <>
          {/* hero band: firm-wide average gauge */}
          <Glass style={{ marginTop: 16, padding: "22px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 24 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: MC.greenInk }}>
                Average Workload Right Now
              </div>
              <div style={{ marginTop: 6 }}>
                <DrillNumber value={s.hero.avgPct != null ? `${s.hero.avgPct}%` : "—"} card={s.hero.card} onDrill={setDrawer} size={54} />
              </div>
              <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.5, color: MC.muted, maxWidth: 400 }}>{s.hero.caption}</div>
            </div>
            <div
              {...(s.hero.card ? {
                role: "button" as const, tabIndex: 0, title: "See workload person by person",
                onClick: () => setDrawer(s.hero.card),
                onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(s.hero.card); } },
              } : {})}
              style={{ textAlign: "center", ...(s.hero.card ? { cursor: "zoom-in" } : {}) }}
            >
              <ArcGauge
                pct={s.hero.avgPct ?? 0}
                size={130}
                label={s.hero.avgPct != null ? `${s.hero.avgPct}%` : "—"}
                caption="Firm-wide average"
                color={s.hero.avgPct != null && s.hero.avgPct >= 60 ? "#8EC94A" : "#F0A842"}
              />
            </div>
          </Glass>

          {/* static industry reference — clearly labeled, never computed.
              Uses CSS variables so it respects light/dark mode automatically. */}
          <div style={{
            marginTop: 12, padding: "10px 16px", borderRadius: 10, fontSize: 11, lineHeight: 1.55,
            color: "var(--rm-text-muted)",
            background: "var(--rm-panel)",
            border: "1px dashed var(--rm-panel-border)",
          }}>
            <span style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 9.5, color: "var(--rm-text-faint)", marginRight: 8 }}>
              Static Reference
            </span>
            {s.benchmarkNote}
          </div>

          <div style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
            {/* load bands */}
            {s.bands && (
              <CardShell
                title="How Busy Is Everyone"
                takeaway="Everyone grouped into load bands, from fully available to overloaded — same split as the hub tile."
                card={s.bands.card}
                onDrill={setDrawer}
                style={{ gridColumn: "1 / -1" }}
              >
                <MissionDonut
                  total={s.bands.total}
                  segments={s.bands.segments}
                  onSegmentClick={(seg) => setDrawer(filterCardByField(s.bands!.card, "band", seg.label))}
                />
              </CardShell>
            )}

            {/* org scoreboard — full width, shared Division / BU / Department
             * selection. The selected dimension's board ONLY — a missing
             * dimension shows an honest note, never another dimension's rows
             * (whose drill filters would find nothing). */}
            {(s.divisionBoard || s.divisionBoardBU || s.divisionBoardDept) && (() => {
              const activeBoard = selectByOrgDim(orgDim, {
                division: s.divisionBoard,
                businessUnit: s.divisionBoardBU,
                department: s.divisionBoardDept,
              });
              const dimLabel = orgDimLabel(orgDim);

              return (
                <CardShell
                  title={`${dimLabel} Scoreboard`}
                  takeaway="Average load, headcount and overloaded people — switch between division, business unit and department."
                  card={activeBoard?.card ?? null}
                  onDrill={setDrawer}
                  style={{ gridColumn: "1 / -1" }}
                >
                  {/* dimension chips — stopPropagation keeps them from triggering the card drill */}
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{ display: "flex", gap: 6, marginBottom: 14 }}
                  >
                    <OrgDimPicker value={orgDim} onChange={setOrgDim} />
                  </div>
                  {activeBoard ? (
                    <ExpandableBars
                      rows={activeBoard.rows.map(r => ({
                        label: r.label,
                        v: r.avg,
                        text: `${r.avg}% avg · ${int(r.people)} people${r.overloaded > 0 ? ` · ${int(r.overloaded)} overloaded` : ""}`,
                      }))}
                      initial={10}
                      noun="groups"
                      color="#6B99BB"
                      onBarClick={(row) => setDrawer(
                        activeBoard.drillCards[row.label]
                        ?? filterCardByField(activeBoard.card, orgDim, row.label),
                      )}
                    />
                  ) : (
                    <div style={{ fontSize: 12, color: MC.muted, padding: "8px 0" }}>
                      No {dimLabel.toLowerCase()} data on the roster — nobody has a{" "}
                      {dimLabel.toLowerCase()} recorded, so there is nothing to score.
                      Pick another dimension above.
                    </div>
                  )}
                </CardShell>
              );
            })()}

            {/* people to watch */}
            {s.overloaded && (
              <CardShell
                title="Overloaded People"
                takeaway="People carrying more than a full load — heaviest first."
                card={s.overloaded.card}
                onDrill={setDrawer}
              >
                <DrillZone card={s.overloaded.card} onDrill={setDrawer} label="See everyone over a full load">
                  <ExpandableBars
                    rows={s.overloaded.rows.map(p => ({ label: p.name, v: p.utilization, text: `${int(p.utilization)}% · ${int(p.activeProjects)} project${p.activeProjects === 1 ? "" : "s"}` }))}
                    initial={8}
                    noun="people"
                    color="#F87171"
                    onBarClick={(row) => setDrawer(filterCardByField(s.overloaded!.card, "name", row.label))}
                  />
                </DrillZone>
              </CardShell>
            )}

            {s.underused && (
              <CardShell
                title="Lightest Loads"
                takeaway="People with little or no current project work — the first place to look when staffing."
                card={s.underused.card}
                onDrill={setDrawer}
                style={{ gridColumn: "1 / -1" }}
              >
                <DrillZone card={s.underused.card} onDrill={setDrawer} label="See everyone with a light load">
                  <ExpandableBars
                    rows={s.underused.rows.map(p => ({ label: p.name, v: Math.max(1, p.utilization), text: `${int(p.utilization)}% · ${p.band}` }))}
                    initial={8}
                    noun="people"
                    color="#6B99BB"
                    onBarClick={(row) => setDrawer(filterCardByField(s.underused!.card, "name", row.label))}
                  />
                </DrillZone>
              </CardShell>
            )}
          </div>

          <div style={{ marginTop: 18, fontSize: 11, color: MC.faint }}>
            No utilization trend is shown because no history is stored — nothing here is estimated.
          </div>
        </>
      )}

      <DataDrawer card={drawer} onClose={() => setDrawer(null)} />
    </MissionWorld>
  );
}
