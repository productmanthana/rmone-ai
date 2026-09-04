/* ─────────────────────────────────────────────────────────────
 * Analytics Center — Staff page (Mission Control style).
 * Client-side only: every number derives from the SAME
 * ReportModel as the hub, so the pages always agree.
 * Charts rule: ZERO recharts charts — headcount composition is
 * big numbers, ranked bars and a segment strip. There is no
 * stored history, so no joiner/leaver or headcount trends are
 * shown (they would be fabricated).
 * Every figure is clickable (DataDrawer) and every card exports
 * to PDF + Excel via CardShell.
 * ──────────────────────────────────────────────────────────── */
import { useState } from "react";
import { buildStaffSection } from "@/lib/analyticsPeople";
import { int, filterCardByField, orgDimLabel, selectByOrgDim, type CardModel } from "@/lib/analyticsCenter";
import {
  MissionWorld, SectionHeader, CardShell, StatCard, DrillZone, DrillNumber, useReportModel, LoadingBlock, ErrorBlock,
} from "@/components/analytics/MissionWorld";
import { MC, useMC, Glass } from "@/components/analytics/MissionKit";
import { MissionHorizBars, ExpandableBars, MissionDonut } from "@/components/analytics/MissionCharts";
import { DataDrawer } from "@/components/analytics/DataDrawer";
import { OrgDimPicker, useOrgDim } from "@/components/analytics/OrgDimPicker";

export default function AnalyticsStaffPage() {
  const MC = useMC();
  const { m, loading, error } = useReportModel();
  const [drawer, setDrawer] = useState<CardModel | null>(null);
  /* Shared Analytics Center org-dimension selection (same session key as the
   * other Center pages — the choice follows the user across pages). */
  const [orgDim, setOrgDim] = useOrgDim("analytics:orgDim");

  const s = m ? buildStaffSection(m) : null;

  return (
    <MissionWorld>
      <SectionHeader title="Staff" m={m} error={error} />

      {loading && !m && <LoadingBlock />}
      {!loading && !m && <ErrorBlock text={error || "No staffing data is available right now."} />}

      {s && (
        <>
          {/* hero band: headcount */}
          <Glass style={{ marginTop: 16, padding: "22px 28px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 24 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: MC.greenInk }}>
                People In The Firm
              </div>
              <div style={{ marginTop: 6 }}>
                <DrillNumber value={s.hero.value} card={s.hero.card} onDrill={setDrawer} size={54} />
              </div>
              {s.hero.sub && (
                <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>{s.hero.sub}</div>
              )}
              <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.5, color: MC.muted, maxWidth: 420 }}>{s.hero.explain}</div>
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

          {/* cards grid — composition only, no fabricated trends */}
          <div style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
            {/* headcount by org — shared Division / BU / Department selection.
             * The selected dimension's list ONLY — a missing dimension shows
             * an honest note, never another dimension's bars. */}
            {(s.byDivision || s.byBusinessUnit || s.byDepartment) && (() => {
              const activeList = selectByOrgDim(orgDim, {
                division: s.byDivision,
                businessUnit: s.byBusinessUnit,
                department: s.byDepartment,
              });
              const dimLabel = orgDimLabel(orgDim);

              return (
                <CardShell
                  title={`Headcount by ${dimLabel}`}
                  takeaway="How the workforce spreads across the firm — switch between division, business unit and department."
                  card={activeList?.card ?? null}
                  onDrill={setDrawer}
                >
                  {/* dimension chips — stopPropagation keeps them from triggering the card drill */}
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{ display: "flex", gap: 6, marginBottom: 14 }}
                  >
                    <OrgDimPicker value={orgDim} onChange={setOrgDim} />
                  </div>
                  {activeList ? (
                    <DrillZone card={activeList.card} onDrill={setDrawer} label={`See everyone, grouped by ${dimLabel.toLowerCase()}`}>
                      <ExpandableBars
                        rows={activeList.allRows.map(r => ({ label: r.label, v: r.v, text: `${int(r.v)} people` }))}
                        initial={12}
                        noun="groups"
                        color="#8EC94A"
                      />
                    </DrillZone>
                  ) : (
                    <div style={{ fontSize: 12, color: MC.muted, padding: "8px 0" }}>
                      No {dimLabel.toLowerCase()} data on the roster — nobody has a{" "}
                      {dimLabel.toLowerCase()} recorded. Pick another dimension above.
                    </div>
                  )}
                </CardShell>
              );
            })()}

            {s.rolesMix && (
              <CardShell
                title="Role Mix"
                takeaway="How many people hold each role."
                card={s.rolesMix.card}
                onDrill={setDrawer}
              >
                <DrillZone card={s.rolesMix.card} onDrill={setDrawer} label="See everyone, grouped by role">
                  <ExpandableBars
                    rows={s.rolesMix.allRows.map(r => ({ label: r.label, v: r.v, text: `${int(r.v)} people` }))}
                    initial={10}
                    noun="roles"
                    color="#F0A842"
                  />
                </DrillZone>
              </CardShell>
            )}

            {s.employmentTypes && (
              <CardShell
                title="Employment Types"
                takeaway="Full-time, part-time, contract and other employment types."
                card={s.employmentTypes.card}
                onDrill={setDrawer}
              >
                <DrillZone card={s.employmentTypes.card} onDrill={setDrawer} label="See everyone, grouped by employment type">
                  <MissionDonut
                    total={s.employmentTypes.total}
                    segments={s.employmentTypes.segments}
                    onSegmentClick={(seg) => setDrawer(filterCardByField(s.employmentTypes!.card, "employmentType", seg.label))}
                  />
                </DrillZone>
              </CardShell>
            )}

            {s.cities && (
              <CardShell
                title="People by City"
                takeaway="Where the team sits, from the staff directory."
                card={s.cities.card}
                onDrill={setDrawer}
              >
                <DrillZone card={s.cities.card} onDrill={setDrawer} label="See everyone, grouped by city">
                  <ExpandableBars
                    rows={s.cities.allRows.map(r => ({ label: r.label, v: r.v, text: `${int(r.v)} people` }))}
                    initial={8}
                    noun="cities"
                    color="#C4D44A"
                  />
                </DrillZone>
              </CardShell>
            )}
          </div>

          <div style={{ marginTop: 18, fontSize: 11, color: MC.faint }}>
            No joiner/leaver or headcount trends are shown because no history is stored — nothing here is estimated.
          </div>
        </>
      )}

      <DataDrawer card={drawer} onClose={() => setDrawer(null)} />
    </MissionWorld>
  );
}
