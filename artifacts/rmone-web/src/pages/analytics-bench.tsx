/* ─────────────────────────────────────────────────────────────
 * Analytics Center — Bench page (Mission Control style).
 * Client-side only: same ReportModel as the hub, so the bench
 * count always equals the hub tile. Charts rule: ZERO recharts
 * charts — big numbers, ranked bars, a match table and a
 * roll-off list. No 12-month bench trend and no $-at-risk
 * (no stored history / no rate data).
 * Every figure is clickable (DataDrawer) and every card exports
 * to PDF + Excel via CardShell.
 * ──────────────────────────────────────────────────────────── */
import { useState } from "react";
import { buildBenchSection } from "@/lib/analyticsPeople";
import { int, orgDimLabel, selectByOrgDim, type CardModel } from "@/lib/analyticsCenter";
import { filterCardByField } from "@/lib/analyticsCenter";
import {
  MissionWorld, SectionHeader, CardShell, StatCard, DrillZone, DrillNumber, useReportModel, LoadingBlock, ErrorBlock,
} from "@/components/analytics/MissionWorld";
import { MC, useMC, Glass } from "@/components/analytics/MissionKit";
import { ExpandableBars } from "@/components/analytics/MissionCharts";
import { DataDrawer } from "@/components/analytics/DataDrawer";
import { OrgDimPicker, useOrgDim } from "@/components/analytics/OrgDimPicker";

export default function AnalyticsBenchPage() {
  const MC = useMC();
  const { m, loading, error } = useReportModel();
  const [drawer, setDrawer] = useState<CardModel | null>(null);
  /* Shared Analytics Center org-dimension selection (same session key as the
   * other Center pages — the choice follows the user across pages). */
  const [orgDim, setOrgDim] = useOrgDim("analytics:orgDim");

  const s = m ? buildBenchSection(m) : null;

  return (
    <MissionWorld>
      <SectionHeader title="Bench" m={m} error={error} />

      {loading && !m && <LoadingBlock />}
      {!loading && !m && <ErrorBlock text={error || "No staffing data is available right now."} />}

      {s && (
        <>
          {/* hero band: bench size + available/light split */}
          <Glass style={{ marginTop: 16, padding: "22px 28px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 24 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: MC.greenInk }}>
                People Fully Available
              </div>
              <div style={{ marginTop: 6 }}>
                <DrillNumber value={s.hero.value} card={s.hero.card} onDrill={setDrawer} size={54} />
              </div>
              <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.5, color: MC.muted, maxWidth: 400 }}>{s.hero.explain}</div>
            </div>
            {(s.hero.available != null || s.hero.light != null) && (
              <div style={{ display: "flex", gap: 14 }}>
                {[
                  { label: "Fully available", v: s.hero.available, color: "#8EC94A", card: s.hero.availableCard },
                  { label: "Lightly loaded",  v: s.hero.light,     color: "#6B99BB", card: s.hero.lightCard },
                ].map(p => (
                  <div
                    key={p.label}
                    role={p.card ? "button" : undefined}
                    tabIndex={p.card ? 0 : undefined}
                    onClick={p.card ? () => setDrawer(p.card) : undefined}
                    onKeyDown={p.card ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(p.card); } }) : undefined}
                    title={p.card ? "See who's on this list" : undefined}
                    style={{
                      padding: "12px 18px", borderRadius: 12, textAlign: "center",
                      background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
                      cursor: p.card ? "pointer" : undefined,
                    }}
                  >
                    <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: p.color }}>
                      {p.v != null ? int(p.v) : "—"}
                    </div>
                    <div style={{ marginTop: 2, fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: MC.faint }}>
                      {p.label}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Glass>

          <div style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>

            {/* ── Available Staff for Open Roles ──────────────────────
                Plain-language name for what used to be "Redeployment
                Matches". Bar length = how free the person is (availability
                %), so bars are visually distinct even when open-seat
                counts are equal.  */}
            {s.matches ? (
              <CardShell
                title="Available Staff for Open Roles"
                takeaway="Available and lightly loaded staff whose role matches an open position — longest bar means most free to take on work."
                card={s.matches.card}
                onDrill={setDrawer}
                style={{ gridColumn: "1 / -1" }}
              >
                {s.matches.rows.length === 0 ? (
                  <DrillZone card={s.matches.card} onDrill={setDrawer} label="Open the data view to compare the lists yourself">
                    <div style={{ fontSize: 11.5, lineHeight: 1.55, color: MC.muted }}>
                      Nobody on the bench has a role that exactly matches an open position right now.
                      Open the data view to compare the bench and open-position lists side by side.
                    </div>
                  </DrillZone>
                ) : (
                  <ExpandableBars
                    rows={s.matches.rows.map(r => ({
                      label: r.name,
                      /* bar = availability % so bars are visually distinct */
                      v: Math.max(1, 100 - r.utilization),
                      text: `${r.role ?? "—"} · ${int(r.openSeats)} open seat${r.openSeats === 1 ? "" : "s"}`,
                    }))}
                    initial={8}
                    noun="matches"
                    color="#A78BFA"
                    onBarClick={row => setDrawer(filterCardByField(s.matches!.card, "name", row.label))}
                  />
                )}
              </CardShell>
            ) : (
              <Glass style={{ gridColumn: "1 / -1", padding: "16px 20px", fontSize: 11.5, lineHeight: 1.55, color: MC.muted }}>
                Open-position data didn't load, so available staff for open roles can't be shown right now — nothing is guessed in the meantime.
              </Glass>
            )}

            {/* ── roll-offs (incoming bench) ────────────────────────── */}
            {s.rollOffs && (
              <CardShell
                title="Rolling Off Within 4 Weeks"
                takeaway="People whose last known allocation ends in the next 28 days — the incoming bench. Real end dates, no projections."
                card={s.rollOffs.card}
                onDrill={setDrawer}
                style={{ gridColumn: "1 / -1" }}
              >
                {s.rollOffs.rows.length === 0 ? (
                  <DrillZone card={s.rollOffs.card} onDrill={setDrawer} label="Open the data view">
                    <div style={{ fontSize: 11.5, color: MC.muted }}>
                      Nobody's last allocation ends in the next 28 days.
                    </div>
                  </DrillZone>
                ) : (
                  <ExpandableBars
                    rows={s.rollOffs.rows.map(r => ({
                      label: r.name,
                      v: Math.max(1, r.daysLeft),
                      text: `${int(r.daysLeft)}d left · ends ${new Date(r.endsOn).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${r.project || "—"}`,
                    }))}
                    initial={8}
                    noun="people"
                    color="#F0A842"
                    onBarClick={row => setDrawer(filterCardByField(s.rollOffs!.card, "name", row.label))}
                  />
                )}
              </CardShell>
            )}
          </div>

          {/* ── Bench by Role + Bench by Org — always side-by-side, equal width ── */}
          {(s.byRole || s.byDivision || s.byBusinessUnit || s.byDepartment) && (
            <div style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>

              {s.byRole && (
                <CardShell
                  title="Bench by Role"
                  takeaway="Which roles are sitting available or lightly loaded."
                  card={s.byRole.card}
                  onDrill={setDrawer}
                >
                  <DrillZone card={s.byRole.card} onDrill={setDrawer} label="See the bench, person by person">
                    <ExpandableBars
                      rows={s.byRole.allRows.map(r => ({ label: r.label, v: r.v, text: `${int(r.v)} people` }))}
                      initial={8}
                      noun="roles"
                      color="#A78BFA"
                      onBarClick={row => setDrawer(filterCardByField(s.byRole!.card, "role", row.label))}
                    />
                  </DrillZone>
                </CardShell>
              )}

              {/* Bench by Org — shared Division / BU / Department selection.
               * The selected dimension's list ONLY — a missing dimension shows
               * an honest note, never another dimension's bars (whose drill
               * filters would find nothing). */}
              {(s.byDivision || s.byBusinessUnit || s.byDepartment) && (() => {
                const activeList = selectByOrgDim(orgDim, {
                  division: s.byDivision,
                  businessUnit: s.byBusinessUnit,
                  department: s.byDepartment,
                });
                const dimLabel = orgDimLabel(orgDim);

                return (
                  <CardShell
                    title={`Bench by ${dimLabel}`}
                    takeaway="Where the bench sits — switch between division, business unit, and department."
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
                      <DrillZone card={activeList.card} onDrill={setDrawer} label="See the bench, person by person">
                        <ExpandableBars
                          rows={activeList.allRows.map(r => ({ label: r.label, v: r.v, text: `${int(r.v)} people` }))}
                          initial={8}
                          noun="groups"
                          color="#6B99BB"
                          onBarClick={row => setDrawer(filterCardByField(activeList.card, orgDim, row.label))}
                        />
                      </DrillZone>
                    ) : (
                      <div style={{ fontSize: 12, color: MC.muted, padding: "8px 0" }}>
                        No {dimLabel.toLowerCase()} data on the bench roster — people on the bench
                        have no {dimLabel.toLowerCase()} recorded. Pick another dimension above.
                      </div>
                    )}
                  </CardShell>
                );
              })()}
            </div>
          )}

          <div style={{ marginTop: 18, fontSize: 11, color: MC.faint }}>
            No bench trend or bench cost is shown because no history or rate data is stored — nothing here is estimated.
          </div>
        </>
      )}

      <DataDrawer card={drawer} onClose={() => setDrawer(null)} />
    </MissionWorld>
  );
}
