/* ─────────────────────────────────────────────────────────────
 * Analytics Center — Executive page (Mission Control style).
 * Client-side only: every number derives from the SAME
 * ReportModel as the hub, so the pages always agree. Max charts
 * rule: ONE recharts chart (backlog by division) — everything
 * else is big numbers, gauges, segment bars and lists.
 * Every figure is clickable (DataDrawer) and every card exports
 * to PDF + Excel via CardShell.
 * ──────────────────────────────────────────────────────────── */
import { useState } from "react";
import { fmtMoney } from "@/lib/reportData";
import { buildExecutiveSection } from "@/lib/analyticsSections";
import {
  buildHubData, int, filterCardByField, filterRowsByOrgKey, orgDimLabel, selectByOrgDim,
  PROJECT_COLS, projRows, STAFF_COLS, staffRows, DEMAND_COLS, demandRows,
  type CardModel,
} from "@/lib/analyticsCenter";
import { OrgDimPicker, useOrgDim } from "@/components/analytics/OrgDimPicker";
import {
  MissionWorld, SectionHeader, CardShell, StatCard, DrillZone, DrillNumber, useReportModel, LoadingBlock, ErrorBlock,
} from "@/components/analytics/MissionWorld";
import { MC, useMC, Glass, ToneDot, MiniGauge } from "@/components/analytics/MissionKit";
import { useTheme } from "@/lib/theme";
import { ArcGauge, MissionHorizBars, ExpandableBars, MissionDonut } from "@/components/analytics/MissionCharts";
import { DataDrawer } from "@/components/analytics/DataDrawer";

export default function AnalyticsExecutivePage() {
  const MC = useMC();
  const { mode } = useTheme();
  const isDark = mode !== "light";
  const { m, loading, error } = useReportModel();
  const [drawer, setDrawer] = useState<CardModel | null>(null);
  /* Shared Analytics Center org-dimension selection (same session key as the
   * other Center pages — the choice follows the user across pages). */
  const [orgDim, setOrgDim] = useOrgDim("analytics:orgDim");

  const s = m ? buildExecutiveSection(m) : null;
  const ticker = m ? buildHubData(m).ticker : [];

  return (
    <MissionWorld>
      <SectionHeader title="Executive" m={m} error={error} />

      {loading && !m && <LoadingBlock />}
      {!loading && !m && <ErrorBlock text={error || "No portfolio data is available right now."} />}

      {s && (
        <>
          {/* firm-status ticker — clickable, theme-aware (same behaviour as the hub) */}
          {ticker.length > 0 && (
            <div style={{
              marginTop: 16,
              overflow: "hidden", display: "flex", alignItems: "center",
              background: isDark ? "rgba(20,32,44,0.95)" : "#FFFFFF",
              border: isDark ? "1px solid rgba(255,255,255,0.07)" : "1px solid #E8ECF0",
              borderRadius: 10,
            }}>
              <div style={{
                padding: "8px 16px", fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.16em", flexShrink: 0, color: "#16240a",
                background: "linear-gradient(140deg, #8EC94A, #6BA539)",
                alignSelf: "stretch", display: "flex", alignItems: "center",
              }}>Firm Status</div>
              <div style={{ display: "flex", alignItems: "center", flex: 1, justifyContent: "space-between", padding: "4px 12px", flexWrap: "wrap" }}>
                {ticker.map(t => (
                  <button
                    key={t.label}
                    onClick={() => t.detail && setDrawer(t.detail)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, flexShrink: 0,
                      background: "none", border: "none", padding: "4px 8px", borderRadius: 7, margin: 0,
                      cursor: t.detail ? "pointer" : "default", color: "inherit", fontFamily: "inherit",
                      transition: "background 0.12s",
                    }}
                    title={t.detail ? `Click to see ${t.label} breakdown` : undefined}
                    onMouseEnter={e => { if (t.detail) (e.currentTarget as HTMLButtonElement).style.background = isDark ? "rgba(255,255,255,0.08)" : "rgba(15,25,34,0.05)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
                  >
                    <span style={{ color: isDark ? MC.faint : "#6B7280" }}>{t.label}</span>
                    <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: isDark ? MC.text : "#111827" }}>{t.val}</span>
                    <ToneDot tone={t.tone} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* hero band: backlog + the two arc gauges */}
          <Glass style={{ marginTop: 16, padding: "22px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 24 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: MC.greenInk }}>
                Signed Work In The Bank
              </div>
              <div style={{ marginTop: 6 }}>
                <DrillNumber value={s.hero.value} card={s.hero.card} onDrill={setDrawer} size={54} />
              </div>
              <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.5, color: MC.muted, maxWidth: 340 }}>{s.hero.explain}</div>
            </div>
            <div style={{ display: "flex", gap: 30, flexWrap: "wrap" }}>
              {[{ g: s.winRate, name: "Win rate" }, { g: s.onTime, name: "On-time delivery" }].map(({ g, name }) => (
                <div
                  key={name}
                  {...(g.card ? {
                    role: "button" as const, tabIndex: 0, title: "See the data behind this number",
                    onClick: () => setDrawer(g.card),
                    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(g.card); } },
                    style: { cursor: "zoom-in" as const },
                  } : {})}
                  style={{ textAlign: "center", ...(g.card ? { cursor: "zoom-in" } : {}) }}
                >
                  <ArcGauge pct={g.pct ?? 0} size={130} label={g.pct != null ? `${g.pct}%` : "—"} caption={name} color={g.pct != null && g.pct >= 50 ? "#8EC94A" : "#F0A842"} />
                  <div style={{ marginTop: 2, fontSize: 10, color: MC.faint, maxWidth: 150, lineHeight: 1.45, margin: "2px auto 0" }}>{g.caption}</div>
                </div>
              ))}
            </div>
          </Glass>

          {/* KPI band — clickable, export-capable big numbers, no charts */}
          {s.kpis.length > 0 && (
            <div style={{ marginTop: 16, display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              {s.kpis.map(k => (
                <StatCard key={k.label} label={k.label} value={k.value} card={k.card} onDrill={setDrawer} />
              ))}
            </div>
          )}

          {/* cards grid */}
          <div style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
            {/* lifecycle funnel + status — always two equal columns, full row */}
            {(s.funnel || s.statusSegments) && (
              <div style={{ gridColumn: "1 / -1", display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
                {s.funnel && (
                  <CardShell
                    title="Lifecycle Funnel"
                    takeaway="How much work sits at each stage — leads, pursuits, delivery."
                    card={s.funnel.card}
                    onDrill={setDrawer}
                  >
                    <DrillZone card={s.funnel.card} onDrill={setDrawer} label="See every record in the funnel">
                      <MissionHorizBars
                        rows={s.funnel.rows.map(f => ({ label: f.label, v: f.count, text: `${int(f.count)} · ${fmtMoney(f.value)}` }))}
                        color="#6B99BB"
                        onBarClick={(row) => setDrawer(
                          s.funnel!.drillCards[row.label]
                          ?? filterCardByField(s.funnel!.card, "label", row.label),
                        )}
                      />
                    </DrillZone>
                    {s.conversion && (
                      <div style={{ marginTop: 16, display: "flex", gap: 22, flexWrap: "wrap" }}>
                        {[
                          { pct: s.conversion.leadRate, text: s.conversion.leadText, card: s.conversion.leadCard, name: "Leads → pursuits" },
                          { pct: s.conversion.oppRate, text: s.conversion.oppText, card: s.conversion.oppCard, name: "Pursuits → projects" },
                        ].map(c => (
                          <div
                            key={c.name}
                            {...(c.card ? {
                              role: "button" as const, tabIndex: 0, title: "See the converted records",
                              onClick: (e: React.SyntheticEvent) => { e.stopPropagation(); setDrawer(c.card); },
                              onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(c.card); } },
                            } : {})}
                            style={{ display: "flex", alignItems: "center", gap: 10, ...(c.card ? { cursor: "zoom-in" } : {}) }}
                          >
                            <MiniGauge pct={Math.max(0, Math.min(100, c.pct ?? 0))} label={c.pct != null ? `${c.pct}%` : "—"} size={56} />
                            <div style={{ fontSize: 10.5, color: MC.faint, lineHeight: 1.5, maxWidth: 150 }}>
                              <div style={{ color: "rgba(255,255,255,0.75)", fontWeight: 600 }}>{c.name}</div>
                              {c.text}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardShell>
                )}
                {s.statusSegments && (
                  <CardShell
                    title="Projects by Status"
                    takeaway="The active portfolio split by current status. Click a segment to see those projects."
                    card={s.statusSegments.card}
                    onDrill={setDrawer}
                  >
                    <MissionDonut
                      total={s.statusSegments.total}
                      segments={s.statusSegments.segments}
                      onSegmentClick={(seg) => setDrawer(filterCardByField(s.statusSegments!.card, "status", seg.label))}
                    />
                  </CardShell>
                )}
              </div>
            )}

            {/* client concentration — full width */}
            {s.clients && (
              <CardShell
                title="Client Concentration"
                takeaway="How much of the backlog depends on each client."
                card={s.clients.card}
                onDrill={setDrawer}
                style={{ gridColumn: "1 / -1" }}
              >
                <DrillZone
                  card={s.clients.card}
                  onDrill={setDrawer}
                  label="See the projects behind each client"
                >
                  <ExpandableBars
                    rows={s.clients.rows.map(c => ({ label: c.label, v: c.value, text: `${fmtMoney(c.value)} · ${Math.round(c.share)}%` }))}
                    initial={8}
                    noun="clients"
                    color="#F0A842"
                    onBarClick={(row) => setDrawer(
                      s.clients!.drillCards[row.label]
                      ?? filterCardByField(s.clients!.card, "label", row.label),
                    )}
                  />
                </DrillZone>
              </CardShell>
            )}

            {/* org scorecard — shared Division / BU / Department selection, full width.
             * The selected dimension's tier ONLY — a tier the tenant doesn't
             * use shows an honest note, never another tier's rows. */}
            {s.divisionScore && m && (() => {
              const tabs = s.divisionScore.tabs;
              const activeTab = selectByOrgDim(orgDim, {
                division: tabs.find(t => t.key === "div") ?? null,
                businessUnit: tabs.find(t => t.key === "bu") ?? null,
                department: tabs.find(t => t.key === "dep") ?? null,
              });
              const dimLabel = orgDimLabel(orgDim);
              const rows = activeTab?.rows ?? [];
              const activeCard: CardModel | null = activeTab ? {
                ...s.divisionScore.card,
                title: `Executive — Org Scorecard (${activeTab.label})`,
                columns: s.divisionScore.card.columns.map((col, i) =>
                  i === 0 ? { ...col, label: activeTab.label } : col,
                ),
                rows: activeTab.rows.map(r => ({ ...r })),
              } : null;

              /* Build source-level filtered cards for drill-through.
               * Clicking a Backlog bar opens the actual project rows for that
               * group; clicking People opens staff rows; Open Seats opens
               * demand rows. Falls back to the aggregate card when no source
               * rows are available. All three dimensions read the canonical
               * fields on staff AND project rows (projects now carry
               * department too). */
              type ScoreGroup = { key: string; label: string };
              const makeProjectCard = (group: ScoreGroup): CardModel | null => {
                const matching = filterRowsByOrgKey(m.projects, orgDim, group.key);
                if (matching.length === 0) return null;
                return {
                  id: "executive",
                  title: `Executive — ${group.label} · Active Projects`,
                  takeaway: `${int(matching.length)} active project${matching.length === 1 ? "" : "s"} in ${group.label}.`,
                  stats: [{ label: "Active Projects", value: int(matching.length) }],
                  columns: PROJECT_COLS,
                  rows: projRows([...matching].sort((a, b) => b.value - a.value)),
                };
              };

              const makeStaffCard = (group: ScoreGroup): CardModel | null => {
                const matching = filterRowsByOrgKey(m.staff, orgDim, group.key);
                if (matching.length === 0) return null;
                return {
                  id: "executive",
                  title: `Executive — ${group.label} · People`,
                  takeaway: `${int(matching.length)} ${matching.length === 1 ? "person" : "people"} in ${group.label}.`,
                  stats: [{ label: "People", value: int(matching.length) }],
                  columns: STAFF_COLS,
                  rows: staffRows([...matching].sort((a, b) => b.utilization - a.utilization)),
                };
              };

              const makeDemandCard = (group: ScoreGroup): CardModel | null => {
                // Match demands whose project is in the given group
                const projIds = new Set(
                  filterRowsByOrgKey(m.projects, orgDim, group.key).map(p => p.id),
                );
                const matching = m.demands.filter(d => projIds.has(d.ticket));
                if (matching.length === 0) return null;
                return {
                  id: "executive",
                  title: `Executive — ${group.label} · Open Seats`,
                  takeaway: `${int(matching.length)} open seat${matching.length === 1 ? "" : "s"} on projects in ${group.label}.`,
                  stats: [{ label: "Open seats", value: int(matching.length) }],
                  columns: DEMAND_COLS,
                  rows: demandRows(matching),
                };
              };

              return (
                <CardShell
                  title="Org Scorecard"
                  takeaway={`Backlog, headcount and open seats by ${dimLabel.toLowerCase()}. Click a bar to see the source rows.`}
                  card={activeCard}
                  onDrill={setDrawer}
                  style={{ gridColumn: "1 / -1" }}
                >
                  {/* shared dimension chips — stopPropagation keeps them from triggering the card drill */}
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{ display: "flex", gap: 6, marginBottom: 16 }}
                  >
                    <OrgDimPicker value={orgDim} onChange={setOrgDim} />
                  </div>
                  {activeTab && activeCard ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                      {/* Backlog */}
                      {rows.some(r => r.backlogValue > 0) && (
                        <div>
                          <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: MC.faint, marginBottom: 6 }}>Backlog</div>
                          <ExpandableBars
                            rows={rows.map(r => ({ label: r.label, v: r.backlogValue, text: r.backlog, filterValue: r.key }))}
                            initial={8}
                            noun="groups"
                            color="#6B99BB"
                            onBarClick={(row) => {
                              const group = rows.find(r => r.key === (row.filterValue ?? row.label));
                              const sourceCard = group && makeProjectCard(group);
                              setDrawer(sourceCard ?? filterCardByField(activeCard, "label", row.label));
                            }}
                          />
                        </div>
                      )}
                      {/* People */}
                      {rows.some(r => r.peopleCount > 0) && (
                        <div>
                          <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: MC.faint, marginBottom: 6 }}>People</div>
                          <ExpandableBars
                            rows={rows.map(r => ({ label: r.label, v: r.peopleCount, text: r.people, filterValue: r.key }))}
                            initial={8}
                            noun="groups"
                            color="#8EC94A"
                            onBarClick={(row) => {
                              const group = rows.find(r => r.key === (row.filterValue ?? row.label));
                              const sourceCard = group && makeStaffCard(group);
                              setDrawer(sourceCard ?? filterCardByField(activeCard, "label", row.label));
                            }}
                          />
                        </div>
                      )}
                      {/* Open Seats */}
                      {rows.some(r => (r.openSeatsCount ?? 0) > 0) && (
                        <div>
                          <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: MC.faint, marginBottom: 6 }}>Open Seats</div>
                          <ExpandableBars
                            rows={rows.filter(r => (r.openSeatsCount ?? 0) > 0).map(r => ({ label: r.label, v: r.openSeatsCount ?? 0, text: r.openSeats, filterValue: r.key }))}
                            initial={8}
                            noun="groups"
                            color="#F0A842"
                            onBarClick={(row) => {
                              const group = rows.find(r => r.key === (row.filterValue ?? row.label));
                              const sourceCard = group && makeDemandCard(group);
                              setDrawer(sourceCard ?? filterCardByField(activeCard, "label", row.label));
                            }}
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: MC.muted, padding: "8px 0" }}>
                      No {dimLabel.toLowerCase()} data to score — records and roster
                      don't carry {dimLabel.toLowerCase()} groups yet. Pick another
                      dimension above.
                    </div>
                  )}
                </CardShell>
              );
            })()}

          </div>

        </>
      )}

      <DataDrawer card={drawer} onClose={() => setDrawer(null)} />
    </MissionWorld>
  );
}
