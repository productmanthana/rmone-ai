/* ─────────────────────────────────────────────────────────────
 * Analytics Center — Projects · Opportunities · Leads (tabbed).
 * All data from the shared ReportModel — same source as the hub
 * and Reports pages, so every figure is always consistent.
 * ──────────────────────────────────────────────────────────── */
import { useState, useMemo } from "react";
import { fmtMoney, fmtDateShort } from "@/lib/reportData";
import {
  buildProjectSection, buildLeadSection, buildOppSection,
} from "@/lib/analyticsSections";
import { int, filterCardByField, orgDimLabel, type CardModel } from "@/lib/analyticsCenter";
import { OrgDimPicker, useOrgDim } from "@/components/analytics/OrgDimPicker";
import {
  MissionWorld, SectionHeader, CardShell, DrillNumber, useReportModel, LoadingBlock, ErrorBlock,
} from "@/components/analytics/MissionWorld";
import { MC, useMC, Glass } from "@/components/analytics/MissionKit";
import { ArcGauge, MissionHorizBars, ExpandableBars } from "@/components/analytics/MissionCharts";
import { DataDrawer } from "@/components/analytics/DataDrawer";

type Tab = "projects" | "opps" | "leads";

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const MC = useMC();
  const TABS: { id: Tab; label: string }[] = [
    { id: "projects", label: "Projects" },
    { id: "opps", label: "Opportunities" },
    { id: "leads", label: "Leads" },
  ];
  return (
    <div style={{
      display: "inline-flex", borderRadius: 6,
      border: "1px solid var(--rm-panel-border)",
      overflow: "hidden", marginBottom: 20,
    }}>
      {TABS.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            fontFamily: "'IBM Plex Mono',ui-monospace,monospace",
            fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
            padding: "7px 20px", border: 0, cursor: "pointer",
            background: active === t.id ? "var(--rm-text)" : "transparent",
            color: active === t.id ? "var(--rm-bg)" : "var(--rm-text-muted)",
            transition: "background 0.15s, color 0.15s",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default function AnalyticsProjectPage() {
  const MC = useMC();
  const { m, loading, error } = useReportModel();
  const [drawer, setDrawer] = useState<CardModel | null>(null);
  const [tab, setTab] = useState<Tab>("projects");
  const [orgDim, setOrgDim] = useOrgDim("analytics:orgDim");

  const projS = useMemo(() => m ? buildProjectSection(m, new Date(), orgDim) : null, [m, orgDim]);
  const leadS = useMemo(() => m ? buildLeadSection(m, orgDim) : null, [m, orgDim]);
  const oppS  = useMemo(() => m ? buildOppSection(m, new Date(), orgDim) : null, [m, orgDim]);

  const title = tab === "projects" ? "Projects"
    : tab === "opps" ? "Opportunities"
    : "Leads";

  return (
    <MissionWorld>
      <SectionHeader title={title} m={m} error={error} right={<OrgDimPicker value={orgDim} onChange={setOrgDim} />} />

      {loading && !m && <LoadingBlock />}
      {!loading && !m && <ErrorBlock text={error || "No portfolio data is available right now."} />}

      {m && (
        <>
          <TabBar active={tab} onChange={t => { setTab(t); setDrawer(null); }} />

          {/* ═══ PROJECTS ═══ */}
          {tab === "projects" && projS && (
            <>
              {!projS.recordsOk && <ErrorBlock text={projS.health.sentence} />}
              {projS.recordsOk && (
                <>
                  <Glass style={{ marginBottom: 16, padding: "22px 28px", display: "flex", alignItems: "center", gap: 30, flexWrap: "wrap" }}>
                    <div
                      {...(projS.health.card ? {
                        role: "button" as const, tabIndex: 0,
                        title: "See every project's schedule standing",
                        onClick: () => setDrawer(projS.health.card!),
                        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(projS.health.card!); } },
                        style: { cursor: "zoom-in" as const },
                      } : {})}
                    >
                      <ArcGauge
                        pct={projS.health.pct ?? 0}
                        size={160}
                        label={projS.health.pct != null ? `${projS.health.pct}%` : "—"}
                        caption="on time"
                        color={projS.health.pct == null ? "#6B99BB" : projS.health.pct >= 80 ? "#8EC94A" : projS.health.pct >= 60 ? "#F0A842" : "#F87171"}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 260 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: MC.greenInk }}>
                        Schedule Health
                      </div>
                      <div style={{ marginTop: 8, fontSize: 15, fontWeight: 600, lineHeight: 1.55, maxWidth: 620 }}>
                        {projS.health.sentence}
                      </div>
                      <div style={{ marginTop: 10, display: "flex", gap: 22, flexWrap: "wrap" }}>
                        {[
                          { label: "Active projects", value: int(m.activeProjects), card: projS.health.card },
                          { label: "On schedule", value: int(m.onScheduleCount), card: projS.health.card && filterCardByField(projS.health.card, "scheduleGroup", "On schedule") },
                          { label: "Overdue", value: int(m.overdueCount), card: projS.health.card && filterCardByField(projS.health.card, "scheduleGroup", "Overdue") },
                          { label: "No end date", value: int(m.noDateCount), card: projS.health.card && filterCardByField(projS.health.card, "scheduleGroup", "No end date") },
                        ].map(x => (
                          <div key={x.label}>
                            <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: MC.faint }}>{x.label}</div>
                            <div style={{ marginTop: 2 }}>
                              <DrillNumber value={x.value} card={x.card} onDrill={setDrawer} size={22} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Glass>

                  <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
                    {projS.statuses && (
                      <CardShell title="Projects by Status" takeaway="Every active project grouped by its current status, biggest group first. Click a bar to see those projects." card={projS.statuses.card} onDrill={setDrawer}>
                        <ExpandableBars
                          rows={projS.statuses.rows.map(r => ({ label: r.label, v: r.v }))}
                          initial={7} noun="statuses" color="#6B99BB"
                          onBarClick={row => setDrawer(filterCardByField(projS.statuses!.card, "status", row.label))}
                        />
                      </CardShell>
                    )}
                    {projS.byOrg && (
                      <CardShell title={`Value by ${orgDimLabel(projS.byOrg.dim)}`} takeaway="How the active portfolio spreads across the firm. Click a bar to see those projects." card={projS.byOrg.card} onDrill={setDrawer}>
                        <ExpandableBars
                          rows={projS.byOrg.rows.map(d => ({ label: d.label, v: d.value, text: fmtMoney(d.value), filterValue: d.key }))}
                          initial={8} noun={`${orgDimLabel(projS.byOrg.dim).toLowerCase()}s`} color="#8EC94A"
                          onBarClick={row => projS.byOrg && setDrawer(filterCardByField(projS.byOrg.card, projS.byOrg.dim, row.filterValue ?? row.label))}
                        />
                      </CardShell>
                    )}
                    {projS.bySector && (
                      <CardShell title="Value by Sector" takeaway="Which markets the active work serves. Click a bar for the rows." card={projS.bySector.card} onDrill={setDrawer}>
                        <ExpandableBars
                          rows={projS.bySector.rows.map(d => ({ label: d.label, v: d.value, text: fmtMoney(d.value) }))}
                          initial={8} noun="sectors" color="#C4D44A"
                          onBarClick={row => projS.bySector && setDrawer(filterCardByField(projS.bySector.card, "sector", row.label))}
                        />
                      </CardShell>
                    )}
                    {projS.byCity && (
                      <CardShell title="Value by City" takeaway="Geographic exposure — where the active contract value sits." card={projS.byCity.card} onDrill={setDrawer}>
                        <ExpandableBars
                          rows={projS.byCity.rows.map(c => ({ label: c.label, v: c.value, text: fmtMoney(c.value) }))}
                          initial={10} noun="cities" color="#A78BFA"
                          onBarClick={row => projS.byCity && setDrawer(filterCardByField(projS.byCity.card, "city", row.label))}
                        />
                      </CardShell>
                    )}
                    {projS.largest && (
                      <CardShell title="Largest Active Engagements" takeaway="The projects the firm depends on most, by contract value. Open View data to navigate to a record." card={projS.largest.card} onDrill={setDrawer}>
                        <ExpandableBars
                          rows={projS.largest.rows.map(p => ({ label: p.name, v: p.value, text: `${fmtMoney(p.value)} · ${p.client || p.sector || "—"}` }))}
                          initial={10} noun="projects" color="#8EC94A"
                          onBarClick={row => setDrawer(filterCardByField(projS.largest!.card, "name", row.label))}
                        />
                      </CardShell>
                    )}
                    {projS.overdue && (
                      <CardShell title="Overdue Projects" takeaway="Past the planned end date — bar length shows how far over. Open View data to navigate to a record." card={projS.overdue.card} onDrill={setDrawer}>
                        <ExpandableBars
                          rows={projS.overdue.rows.map(p => ({ label: p.name, v: Math.max(1, p.daysOverdue ?? 1), text: `${int(p.daysOverdue ?? 0)}d overdue · ${p.targetEnd ? fmtDateShort(p.targetEnd) : "—"}` }))}
                          initial={10} noun="projects" color="#F87171"
                          onBarClick={row => setDrawer(filterCardByField(projS.overdue!.card, "name", row.label))}
                        />
                      </CardShell>
                    )}
                    {projS.endingSoon && (
                      <CardShell title="Ending Within 90 Days" takeaway="The wind-down pipeline — longer bar means closer to finishing. Open View data for record links." card={projS.endingSoon.card} onDrill={setDrawer}>
                        <ExpandableBars
                          rows={projS.endingSoon.rows.map(p => {
                            const daysLeft = p.targetEnd ? Math.max(0, Math.round((new Date(p.targetEnd).getTime() - Date.now()) / 86400000)) : 90;
                            return { label: p.name, v: Math.max(1, 90 - daysLeft), text: `${p.targetEnd ? fmtDateShort(p.targetEnd) : "—"} · ${daysLeft}d left` };
                          })}
                          initial={8} noun="projects" color="#6B99BB"
                          onBarClick={row => setDrawer(filterCardByField(projS.endingSoon!.card, "name", row.label))}
                        />
                      </CardShell>
                    )}
                    {projS.valueRanges && (
                      <CardShell title="Projects by Contract Size" takeaway="How many projects fall in each value range. Click a bar to see those projects." card={projS.valueRanges.card} onDrill={setDrawer}>
                        <MissionHorizBars
                          rows={projS.valueRanges.rows.map(r => ({ label: r.label, v: r.count, text: `${int(r.count)} project${r.count === 1 ? "" : "s"}` }))}
                          color="#C4D44A"
                          onBarClick={row => projS.valueRanges && setDrawer(filterCardByField(projS.valueRanges.card, "contractSizeRange", row.label))}
                        />
                      </CardShell>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* ═══ OPPORTUNITIES ═══ */}
          {tab === "opps" && oppS && (
            <>
              {!oppS.recordsOk && <ErrorBlock text="Opportunity records didn't load — refresh to try again." />}
              {oppS.recordsOk && (
                <>
                  {/* hero */}
                  <Glass style={{ marginBottom: 16, padding: "22px 28px", display: "flex", alignItems: "center", gap: 30, flexWrap: "wrap" }}>
                    <div
                      role="button" tabIndex={0}
                      onClick={() => setDrawer(oppS.allCard)}
                      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(oppS.allCard); } }}
                      style={{ cursor: "zoom-in" }}
                    >
                      <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em", color: "#F0A842" }}>
                        {fmtMoney(oppS.pipelineValue)}
                      </div>
                      <div style={{ fontSize: 11, color: MC.faint, marginTop: 4 }}>Open pipeline value</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 260 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: "#F0A842" }}>
                        Pipeline Overview
                      </div>
                      {/* Opportunity KPIs — each one is a drill target for the underlying rows */}
                      <div style={{ marginTop: 10, display: "flex", gap: 22, flexWrap: "wrap" }}>
                        {[
                          { label: "Active bids", value: int(oppS.activeBids), card: oppS.allCard },
                          { label: "Weighted value", value: fmtMoney(oppS.weightedPipeline), card: oppS.allCard },
                          ...(m.winRate != null ? [{ label: "Win rate", value: `${m.winRate}%`, card: oppS.allCard }] : []),
                          { label: "Avg bid size", value: oppS.activeBids > 0 ? fmtMoney(oppS.pipelineValue / oppS.activeBids) : "—", card: oppS.activeBids > 0 ? oppS.allCard : null },
                        ].map(x => (
                          <div
                            key={x.label}
                            role={x.card ? "button" : undefined}
                            tabIndex={x.card ? 0 : undefined}
                            title={x.card ? `See all ${x.label} data` : undefined}
                            onClick={x.card ? (e) => { e.stopPropagation(); setDrawer(x.card!); } : undefined}
                            onKeyDown={x.card ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setDrawer(x.card!); } } : undefined}
                            style={{ cursor: x.card ? "zoom-in" : "default" }}
                          >
                            <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: MC.faint }}>{x.label}</div>
                            <div style={{ marginTop: 2, fontSize: 20, fontWeight: 700 }}>{x.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Glass>

                  {oppS.activeBids === 0 ? (
                    <div style={{ padding: "40px 0", textAlign: "center", color: MC.faint, fontSize: 14 }}>No open pursuits on record.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
                      {oppS.byStage && (
                        <CardShell title="Active Bids by Stage" takeaway="Where the open pipeline sits today — click a bar to see those pursuits." card={oppS.allCard} onDrill={setDrawer}>
                          <ExpandableBars
                            rows={oppS.byStage.rows.map(r => ({ label: r.label, v: r.v, text: `${int(r.count)} bid${r.count === 1 ? "" : "s"} · ${fmtMoney(r.v)}` }))}
                            initial={8} noun="stages" color="#F0A842"
                            onBarClick={row => setDrawer(filterCardByField(oppS.allCard, "stage", row.label))}
                          />
                        </CardShell>
                      )}
                      {oppS.byOrg && (
                        <CardShell title={`Value by ${orgDimLabel(oppS.byOrg.dim)}`} takeaway={`Pipeline spread across the firm's ${orgDimLabel(oppS.byOrg.dim).toLowerCase()}s — click a bar to see those pursuits.`} card={oppS.allCard} onDrill={setDrawer}>
                          <ExpandableBars
                            rows={oppS.byOrg.rows.map(d => ({ label: d.label, v: d.v, text: fmtMoney(d.v), filterValue: d.key }))}
                            initial={8} noun={`${orgDimLabel(oppS.byOrg.dim).toLowerCase()}s`} color="#8EC94A"
                            onBarClick={row => oppS.byOrg && setDrawer(filterCardByField(oppS.allCard, oppS.byOrg.dim, row.filterValue ?? row.label))}
                          />
                        </CardShell>
                      )}
                      {oppS.bySector && (
                        <CardShell title="Value by Sector" takeaway="Which markets the active pursuits target — click a bar to see those pursuits." card={oppS.allCard} onDrill={setDrawer}>
                          <ExpandableBars
                            rows={oppS.bySector.rows.map(s => ({ label: s.label, v: s.v, text: fmtMoney(s.v) }))}
                            initial={8} noun="sectors" color="#C4D44A"
                            onBarClick={row => setDrawer(filterCardByField(oppS.allCard, "sector", row.label))}
                          />
                        </CardShell>
                      )}
                      {oppS.byCity && (
                        <CardShell title="Value by City" takeaway="Geographic spread of the active pipeline — click a bar to see those pursuits." card={oppS.allCard} onDrill={setDrawer}>
                          <ExpandableBars
                            rows={oppS.byCity.rows.map(c => ({ label: c.label, v: c.v, text: fmtMoney(c.v) }))}
                            initial={10} noun="cities" color="#A78BFA"
                            onBarClick={row => setDrawer(filterCardByField(oppS.allCard, "city", row.label))}
                          />
                        </CardShell>
                      )}
                      {oppS.largest && (
                        <CardShell title="Largest Active Pursuits" takeaway="Top pursuits by contract value — the work the firm is chasing hardest." card={oppS.allCard} onDrill={setDrawer}>
                          <ExpandableBars
                            rows={oppS.largest.map(o => ({ label: o.name, v: o.value, text: `${fmtMoney(o.value)} · ${o.client || o.sector || "—"}` }))}
                            initial={10} noun="pursuits" color="#F0A842"
                            onBarClick={row => setDrawer(filterCardByField(oppS.allCard, "name", row.label))}
                          />
                        </CardShell>
                      )}
                      {oppS.bidsSoon && (
                        <CardShell title="Bids Due in 90 Days" takeaway="Open pursuits with a bid date in the next 90 days — closest first." card={oppS.bidsSoon.card} onDrill={setDrawer}>
                          <ExpandableBars
                            rows={oppS.bidsSoon.rows.map(o => {
                              const daysLeft = o.daysToBid ?? (o.bidDate ? Math.max(0, Math.round((new Date(o.bidDate).getTime() - Date.now()) / 86400000)) : 90);
                              return { label: o.name, v: Math.max(1, 90 - daysLeft), text: `${o.bidDate ? fmtDateShort(o.bidDate) : "—"} · ${int(daysLeft)}d left` };
                            })}
                            initial={8} noun="pursuits" color="#6B99BB"
                            onBarClick={row => setDrawer(filterCardByField(oppS.bidsSoon!.card, "name", row.label))}
                          />
                        </CardShell>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ═══ LEADS ═══ */}
          {tab === "leads" && leadS && (
            <>
              {!leadS.recordsOk && <ErrorBlock text="Lead records didn't load — refresh to try again." />}
              {leadS.recordsOk && (
                <>
                  {/* hero */}
                  <Glass style={{ marginBottom: 16, padding: "22px 28px", display: "flex", alignItems: "center", gap: 30, flexWrap: "wrap" }}>
                    <div
                      role="button" tabIndex={0}
                      onClick={() => setDrawer(leadS.allCard)}
                      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(leadS.allCard); } }}
                      style={{ cursor: "zoom-in" }}
                    >
                      <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em", color: "#6B99BB" }}>
                        {int(leadS.count)}
                      </div>
                      <div style={{ fontSize: 11, color: MC.faint, marginTop: 4 }}>Total leads on record</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 260 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: "#6B99BB" }}>
                        Lead Book Overview
                      </div>
                      <div style={{ marginTop: 10, display: "flex", gap: 22, flexWrap: "wrap" }}>
                        {[
                          { label: "Est. total value", value: fmtMoney(leadS.totalValue) },
                          ...(leadS.byStatus ? [{ label: "Status groups", value: int(leadS.byStatus.rows.length) }] : []),
                          ...(leadS.bySector ? [{ label: "Sectors covered", value: int(leadS.bySector.rows.length) }] : []),
                        ].map(x => (
                          <div key={x.label}>
                            <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: MC.faint }}>{x.label}</div>
                            <div style={{ marginTop: 2, fontSize: 20, fontWeight: 700 }}>{x.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Glass>

                  {leadS.count === 0 ? (
                    <div style={{ padding: "40px 0", textAlign: "center", color: MC.faint, fontSize: 14 }}>No leads on record for this account.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
                      {leadS.byStatus && (
                        <CardShell title="Leads by Status" takeaway="How the lead book is distributed across each status — click a bar to see those leads." card={leadS.allCard} onDrill={setDrawer}>
                          <ExpandableBars
                            rows={leadS.byStatus.rows.map(r => ({ label: r.label, v: r.v }))}
                            initial={7} noun="statuses" color="#6B99BB"
                            onBarClick={row => setDrawer(filterCardByField(leadS.allCard, "status", row.label))}
                          />
                        </CardShell>
                      )}
                      {leadS.bySector && (
                        <CardShell title="Est. Value by Sector" takeaway="Which sectors the lead book targets — click a bar to see those leads." card={leadS.allCard} onDrill={setDrawer}>
                          <ExpandableBars
                            rows={leadS.bySector.rows.map(s => ({ label: s.label, v: s.v, text: fmtMoney(s.v) }))}
                            initial={8} noun="sectors" color="#C4D44A"
                            onBarClick={row => setDrawer(filterCardByField(leadS.allCard, "sector", row.label))}
                          />
                        </CardShell>
                      )}
                      {leadS.byOrg && (
                        <CardShell title={`Est. Value by ${orgDimLabel(leadS.byOrg.dim)}`} takeaway={`Which ${orgDimLabel(leadS.byOrg.dim).toLowerCase()}s own these leads — click a bar to see those leads.`} card={leadS.allCard} onDrill={setDrawer}>
                          <ExpandableBars
                            rows={leadS.byOrg.rows.map(d => ({ label: d.label, v: d.v, text: fmtMoney(d.v), filterValue: d.key }))}
                            initial={8} noun={`${orgDimLabel(leadS.byOrg.dim).toLowerCase()}s`} color="#8EC94A"
                            onBarClick={row => leadS.byOrg && setDrawer(filterCardByField(leadS.allCard, leadS.byOrg.dim, row.filterValue ?? row.label))}
                          />
                        </CardShell>
                      )}
                      {leadS.byCity && (
                        <CardShell title="Est. Value by City" takeaway="Geographic spread of the lead book — click a bar to see those leads." card={leadS.allCard} onDrill={setDrawer}>
                          <ExpandableBars
                            rows={leadS.byCity.rows.map(c => ({ label: c.label, v: c.v, text: fmtMoney(c.v) }))}
                            initial={10} noun="cities" color="#A78BFA"
                            onBarClick={row => setDrawer(filterCardByField(leadS.allCard, "city", row.label))}
                          />
                        </CardShell>
                      )}
                      {leadS.largest && (
                        <CardShell title="Highest Estimated Value" takeaway="Top leads by estimated value — click a bar to drill into that lead." card={leadS.allCard} onDrill={setDrawer}>
                          <ExpandableBars
                            rows={leadS.largest.map(l => ({ label: l.name, v: l.value, text: `${fmtMoney(l.value)} · ${l.client || l.sector || "—"}` }))}
                            initial={10} noun="leads" color="#6B99BB"
                            onBarClick={row => setDrawer(filterCardByField(leadS.allCard, "name", row.label))}
                          />
                        </CardShell>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}

        </>
      )}

      <DataDrawer card={drawer} onClose={() => setDrawer(null)} />
    </MissionWorld>
  );
}
