/* ─────────────────────────────────────────────────────────────
 * Analytics Center — Pipeline page (Mission Control style).
 * ──────────────────────────────────────────────────────────── */
import { useState } from "react";
import { fmtMoney } from "@/lib/reportData";
import { buildPipelineSection } from "@/lib/analyticsSections";
import { int, filterCardByField, orgDimLabel, type CardModel } from "@/lib/analyticsCenter";
import { OrgDimPicker, useOrgDim } from "@/components/analytics/OrgDimPicker";
import {
  MissionWorld, SectionHeader, CardShell, StatCard, DrillNumber, useReportModel, LoadingBlock, ErrorBlock,
} from "@/components/analytics/MissionWorld";
import { useMC, Glass } from "@/components/analytics/MissionKit";
import { ArcGauge, MissionHorizBars, ExpandableBars } from "@/components/analytics/MissionCharts";
import { DataDrawer } from "@/components/analytics/DataDrawer";

/* uppercase divider that splits the page into Leads vs Opportunities */
function SubHead({ label }: { label: string }) {
  const MC = useMC();
  return (
    <div style={{ marginTop: 26, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.2em", color: MC.greenInk, whiteSpace: "nowrap" }}>
        {label}
      </div>
      <div style={{ flex: 1, height: 1, background: MC.border }} />
    </div>
  );
}

export default function AnalyticsPipelinePage() {
  const MC = useMC();
  const { m, loading, error } = useReportModel();
  const [drawer, setDrawer] = useState<CardModel | null>(null);
  const [winLossExpanded, setWinLossExpanded] = useState(false);
  const [orgDim, setOrgDim] = useOrgDim("analytics:orgDim");

  const s = m ? buildPipelineSection(m, orgDim) : null;

  return (
    <MissionWorld>
      <SectionHeader title="Pipeline" m={m} error={error} right={<OrgDimPicker value={orgDim} onChange={setOrgDim} />} />

      {loading && !m && <LoadingBlock />}
      {!loading && !m && <ErrorBlock text={error || "No pipeline data is available right now."} />}

      {s && !s.recordsOk && <ErrorBlock text={s.hero.explain} />}

      {s && s.recordsOk && m && (
        <>
          {/* hero: open pipeline headline + win-rate gauge */}
          <Glass style={{ marginTop: 16, padding: "22px 28px", display: "flex", alignItems: "center", gap: 30, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: MC.greenInk }}>
                Open Pipeline
              </div>
              <div style={{ marginTop: 6 }}>
                <DrillNumber value={s.hero.value} card={s.hero.card} onDrill={setDrawer} size={40} />
              </div>
              <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600, lineHeight: 1.55, maxWidth: 620, color: MC.muted }}>
                {s.hero.explain}
              </div>
            </div>
            <div
              {...(s.winRate.card ? {
                role: "button" as const, tabIndex: 0, title: "See every decided bid",
                onClick: () => setDrawer(s.winRate.card),
                onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(s.winRate.card); } },
                style: { cursor: "zoom-in" as const },
              } : {})}
            >
              <ArcGauge
                pct={s.winRate.pct ?? 0}
                size={160}
                label={s.winRate.pct != null ? `${s.winRate.pct}%` : "—"}
                caption="win rate"
                color={s.winRate.pct == null ? "#6B99BB" : s.winRate.pct >= 50 ? "#8EC94A" : s.winRate.pct >= 25 ? "#F0A842" : "#F87171"}
              />
              <div style={{ marginTop: 4, textAlign: "center", fontSize: 10.5, color: MC.faint, maxWidth: 180 }}>
                {s.winRate.caption}
              </div>
            </div>
          </Glass>

          {/* KPI band */}
          <div style={{ marginTop: 16, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            {s.kpis.map(k => (
              <StatCard key={k.label} label={k.label} value={k.value} card={k.card} onDrill={setDrawer} />
            ))}
          </div>

          {/* ── LEADS — before they become formal pursuits ── */}
          <SubHead label="Leads — before they become pursuits" />
          <div style={{ marginTop: 12, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
            {s.leads && (
              <CardShell
                title="Early-Stage Lead Book"
                takeaway="Leads on record before they become formal pursuits, ranked by value."
                card={s.leads.card}
                onDrill={setDrawer}
              >
                <ExpandableBars
                  rows={s.leads.rows.map(l => ({
                    label: l.name.length > 28 ? l.name.slice(0, 26) + "…" : l.name,
                    v: l.value,
                    text: l.value > 0 ? fmtMoney(l.value) : "—",
                  }))}
                  initial={8}
                  noun="leads"
                  color="#F0A842"
                  onBarClick={(row) => setDrawer(filterCardByField(s.leads!.card, "name", row.label))}
                />
              </CardShell>
            )}

            {s.leadsByStatus && (
              <CardShell
                title="Leads by Status"
                takeaway="The lead book grouped by each lead's current status. Click a bar for those leads."
                card={s.leadsByStatus.card}
                onDrill={setDrawer}
              >
                <MissionHorizBars
                  rows={s.leadsByStatus.rows.map(r => ({ label: r.label, v: r.v, text: `${int(r.v)} lead${r.v === 1 ? "" : "s"}` }))}
                  color="#6B99BB"
                  onBarClick={(row) => s.leadsByStatus && setDrawer(filterCardByField(s.leadsByStatus.card, "status", row.label))}
                />
              </CardShell>
            )}

            {s.leadsBySector && (
              <CardShell
                title="Leads by Sector"
                takeaway="Which markets the early-stage leads sit in. Click a bar for those leads."
                card={s.leadsBySector.card}
                onDrill={setDrawer}
              >
                <MissionHorizBars
                  rows={s.leadsBySector.rows.map(r => ({ label: r.label, v: r.v, text: `${int(r.v)} lead${r.v === 1 ? "" : "s"}` }))}
                  color="#8EC94A"
                  onBarClick={(row) => s.leadsBySector && setDrawer(filterCardByField(s.leadsBySector.card, "sector", row.label))}
                />
              </CardShell>
            )}
          </div>

          {/* ── OPPORTUNITIES — formal pursuits in play ── */}
          <SubHead label="Opportunities — formal pursuits" />
          <div style={{ marginTop: 12, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>

            {/* Active Bids by Stage + Win/Loss by Sector — always 2 equal cols, full row */}
            {(s.byStage || s.winLoss) && (
              <div style={{ gridColumn: "1 / -1", display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
                {s.byStage && (
                  <CardShell
                    title="Active Bids by Stage"
                    takeaway="Where the open pipeline sits today, stage by stage."
                    card={s.byStage.card}
                    onDrill={setDrawer}
                  >
                    <MissionHorizBars
                      rows={s.byStage.rows.map(st => ({
                        label: st.label,
                        v: st.value,
                        text: `${int(st.count)} bid${st.count === 1 ? "" : "s"} · ${fmtMoney(st.value)}`,
                      }))}
                      color="#6B99BB"
                      onBarClick={(row) => s.byStage && setDrawer(filterCardByField(s.byStage.card, "stage", row.label))}
                    />
                  </CardShell>
                )}

                {s.winLoss && (
                  <CardShell
                    title="Win / Loss by Sector"
                    takeaway="How decided bids have gone in each market — green won, red lost."
                    card={s.winLoss.card}
                    onDrill={setDrawer}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {(winLossExpanded ? s.winLoss.rows : s.winLoss.rows.slice(0, 7)).map(r => {
                        const total = r.won + r.lost;
                        const wonPct = total > 0 ? (r.won / total) * 100 : 0;
                        return (
                          <div key={r.sector}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5 }}>
                              <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sector}</span>
                              <span style={{ flexShrink: 0, color: MC.muted, fontVariantNumeric: "tabular-nums" }}>
                                {int(r.won)} won · {int(r.lost)} lost
                              </span>
                            </div>
                            <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", marginTop: 5, background: "rgba(127,127,127,0.15)" }}>
                              {r.won > 0 && <div style={{ width: `${wonPct}%`, background: "#8EC94A" }} />}
                              {r.lost > 0 && <div style={{ width: `${100 - wonPct}%`, background: "#F87171" }} />}
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: MC.faint, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                              <span>{fmtMoney(r.wonValue)} won</span>
                              <span>{fmtMoney(r.lostValue)} lost</span>
                            </div>
                          </div>
                        );
                      })}
                      {s.winLoss.rows.length > 7 && (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={e => { e.stopPropagation(); setWinLossExpanded(x => !x); }}
                          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setWinLossExpanded(x => !x); } }}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            fontSize: 11.5, fontWeight: 700, color: "#F0A842",
                            cursor: "pointer", userSelect: "none", padding: "4px 0",
                          }}
                        >
                          {winLossExpanded
                            ? "Show top 7 only"
                            : `+ ${int(s.winLoss.rows.length - 7)} more sector${s.winLoss.rows.length - 7 === 1 ? "" : "s"} — click to see all`}
                        </div>
                      )}
                    </div>
                  </CardShell>
                )}
              </div>
            )}

            {/* biggest open pursuits — horizontal bar chart, full width */}
            {s.topPursuits && (
              <CardShell
                title="Biggest Open Pursuits"
                takeaway="The top open bids ranked by value. Click a bar to see all records."
                card={s.topPursuits.card}
                onDrill={setDrawer}
                style={{ gridColumn: "1 / -1" }}
              >
                <ExpandableBars
                  rows={s.topPursuits.rows.map(o => ({
                    label: o.name.length > 32 ? o.name.slice(0, 30) + "…" : o.name,
                    v: o.value,
                    text: fmtMoney(o.value) + (o.probability != null ? ` · ${int(o.probability)}% win` : ""),
                  }))}
                  initial={10}
                  noun="pursuits"
                  color="#8EC94A"
                  onBarClick={(row) => setDrawer(filterCardByField(s.topPursuits!.card, "name", row.label))}
                />
              </CardShell>
            )}

            {/* Pipeline value + aging: a dedicated full-width row with equal
             * columns so these companion views never get pushed into a
             * leftover third track of the parent opportunities grid. */}
            {(s.byOrg || s.oldestBids) && (
              <div style={{
                gridColumn: "1 / -1",
                display: "grid",
                gap: 16,
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              }}>
                {/* open pipeline value by the selected org dimension */}
                {s.byOrg && (
                  <CardShell
                    title={`Pipeline Value by ${orgDimLabel(s.byOrg.dim)}`}
                    takeaway={`Where the open pursuit value sits across the organization. Click a bar for that ${orgDimLabel(s.byOrg.dim).toLowerCase()}'s pursuits.`}
                    card={s.byOrg.card}
                    onDrill={setDrawer}
                  >
                    <MissionHorizBars
                      rows={s.byOrg.rows.map(d => ({ label: d.label, v: d.v, text: fmtMoney(d.v), filterValue: d.key }))}
                      color="#8EC94A"
                      onBarClick={(row) => s.byOrg && setDrawer(filterCardByField(s.byOrg.card, s.byOrg.dim, row.filterValue ?? row.label))}
                    />
                  </CardShell>
                )}

                {/* longest-running open bids — from real Created dates */}
                {s.oldestBids && (
                  <CardShell
                    title="Longest-Running Open Bids"
                    takeaway="Open pursuits that have been in play the longest — worth a status check."
                    card={s.oldestBids.card}
                    onDrill={setDrawer}
                  >
                    <MissionHorizBars
                      rows={s.oldestBids.rows.map(r => ({
                        label: r.opp.name.length > 28 ? r.opp.name.slice(0, 26) + "…" : r.opp.name,
                        v: r.days,
                        text: `${int(r.days)} day${r.days === 1 ? "" : "s"}`,
                      }))}
                      color="#F0A842"
                      onBarClick={(row) => s.oldestBids && setDrawer(filterCardByField(s.oldestBids.card, "name", row.label))}
                    />
                  </CardShell>
                )}
              </div>
            )}
          </div>

        </>
      )}

      <DataDrawer card={drawer} onClose={() => setDrawer(null)} />
    </MissionWorld>
  );
}
