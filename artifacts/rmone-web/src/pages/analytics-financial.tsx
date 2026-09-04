/* ─────────────────────────────────────────────────────────────
 * Analytics Center — Financial page (Mission Control style).
 * All figures are PLANNED (allocation plans × rates), not timesheets.
 * Charts: max 3 (monthly hours, monthly billing, chargeable arc).
 * ──────────────────────────────────────────────────────────── */
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { fmtMoney } from "@/lib/reportData";
import { getFinancialAnalytics, type FinancialAnalytics } from "@/lib/api";
import {
  buildFinancialSection, finMonthlyChartRows, finDivisionChartRows,
} from "@/lib/analyticsSections";
import { int, orgDimLabel, selectByOrgDim, type CardModel } from "@/lib/analyticsCenter";
import { OrgDimPicker, useOrgDim } from "@/components/analytics/OrgDimPicker";
import {
  MissionWorld, SectionHeader, CardShell, StatCard, DrillZone, useReportModel, LoadingBlock, ErrorBlock,
} from "@/components/analytics/MissionWorld";
import { MC, useMC, Glass } from "@/components/analytics/MissionKit";
import { ArcGauge, MissionColumns, MissionArea, ChartCaption, ExpandableBars } from "@/components/analytics/MissionCharts";
import { DataDrawer } from "@/components/analytics/DataDrawer";
import { getMyCapabilities, type MyCapabilities } from "@/lib/permissions";

/* ── MiniBar: uniform slim progress bar used inside every stat card ── */
function MiniBar({
  pct, color = "#8EC94A", warnColor, mc,
}: {
  pct: number;          // 0–100
  color?: string;
  warnColor?: string;   // if provided, uses warn color when pct < 30
  mc: ReturnType<typeof useMC>;
}) {
  const fill = Math.max(0, Math.min(100, pct));
  const barColor = warnColor && fill < 30 ? warnColor : color;
  return (
    <div style={{ marginTop: 9, height: 6, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
      <div style={{ width: `${fill}%`, height: "100%", borderRadius: 999, background: barColor, transition: "width 0.4s ease" }} />
    </div>
  );
}

/* ── ProjCount: "X of Y projects · Z missing/open" badge ── */
function ProjCount({
  withCount, total, missingLabel = "missing", color, mc,
}: {
  withCount: number; total: number; missingLabel?: string; color?: string;
  mc: ReturnType<typeof useMC>;
}) {
  if (total <= 0) return null;
  const missing = total - withCount;
  return (
    <div style={{ marginTop: 5, fontSize: 10.5, lineHeight: 1.5 }}>
      <strong style={{ color: color ?? mc.text }}>{withCount.toLocaleString("en-US")}</strong>
      <span style={{ color: mc.faint }}> of </span>
      <strong style={{ color: mc.text }}>{total.toLocaleString("en-US")}</strong>
      <span style={{ color: mc.faint }}> projects</span>
      {missing > 0 && (
        <span style={{ color: mc.faint }}>
          {" · "}
          <strong style={{ color: mc.warn }}>{missing.toLocaleString("en-US")}</strong>
          {" "}{missingLabel}
        </span>
      )}
    </div>
  );
}

export default function AnalyticsFinancialPage() {
  const MC = useMC();
  const { m, loading, error } = useReportModel();
  const [fin, setFin] = useState<FinancialAnalytics | null | "loading">("loading");
  const [caps, setCaps] = useState<MyCapabilities | null>(null);
  const [drawer, setDrawer] = useState<CardModel | null>(null);
  /* Shared Analytics Center org-dimension selection (same session key as the
   * other Center pages — the choice follows the user across pages). */
  const [orgDim, setOrgDim] = useOrgDim("analytics:orgDim");

  useEffect(() => {
    let alive = true;
    getFinancialAnalytics().then(r => { if (alive) setFin(r); }).catch(() => { if (alive) setFin(null); });
    getMyCapabilities().then(c => { if (alive) setCaps(c); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const restricted = caps ? caps.caps.editFinancials === false : false;

  const s = fin === "loading" ? null : buildFinancialSection(m, fin);
  // Overall (all planned work, past + future). Falls back to trailing-12m only
  // when the server still serves a stale copy computed before "all" existed.
  const view = s && s.fin.state === "ok" ? (s.fin.bases.all ?? s.fin.bases.t12m ?? null) : null;

  /* ── derived counts ── */
  const totalProjs   = m?.projects.length ?? 0;
  const projsWithCV  = m ? m.projects.filter(p => p.value > 0).length : 0;
  const projsWithLCA = m ? m.projects.filter(p => p.laborContract > 0).length : 0;
  const projsInWin   = view ? view.hoursCard.rows.length : 0;
  type HRow = { assignedHours: number };
  const projsStaffed = view
    ? (view.hoursCard.rows as HRow[]).filter(r => r.assignedHours > 0).length
    : 0;

  /* percentages for bars */
  const cvPct        = totalProjs > 0 ? Math.round((projsWithCV  / totalProjs) * 100) : 0;
  const lcaPct       = totalProjs > 0 ? Math.round((projsWithLCA / totalProjs) * 100) : 0;
  const staffedPct   = view && view.b.assignedHours + view.b.demandHours > 0
    ? Math.round((view.b.assignedHours / (view.b.assignedHours + view.b.demandHours)) * 100) : 0;
  const billPct      = view && view.b.plannedBillDollars > 0
    ? Math.round((view.b.assignedBillDollars / view.b.plannedBillDollars) * 100) : 0;
  const totalCost    = view ? view.b.jobChargeableCost + view.b.nonJobChargeableCost : 0;
  const jobPct       = totalCost > 0 ? Math.round((view!.b.jobChargeableCost / totalCost) * 100) : 0;
  const ncPct        = totalCost > 0 ? Math.round((view!.b.nonJobChargeableCost / totalCost) * 100) : 0;

  return (
    <MissionWorld>
      <SectionHeader title="Financial" m={m} error={error} />

      {restricted ? (
        <Glass style={{ marginTop: 18, padding: 60, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <Lock size={22} style={{ color: MC.warn }} />
          <div style={{ fontSize: 14, fontWeight: 700 }}>Financial access required</div>
          <div style={{ fontSize: 12, color: MC.muted, maxWidth: 420, lineHeight: 1.6 }}>
            Your access level doesn't include financial data. Ask an administrator to enable
            financial editing for your account if you need this page.
          </div>
        </Glass>
      ) : (
        <>
          {(loading || fin === "loading") && !view && <LoadingBlock text="Loading planned labor economics…" />}
          {!loading && fin !== "loading" && !m && !view && <ErrorBlock text={error || "No portfolio data is available right now."} />}

          {s && fin !== "loading" && (
            <>
              {/* planned-figures banner */}
              <div style={{
                marginTop: 16, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                padding: "9px 14px", borderRadius: 10, fontSize: 11.5, color: MC.muted,
                background: "rgba(255,255,255,0.04)", border: `1px solid ${MC.border}`,
              }}>
                <span style={{ fontWeight: 700, color: MC.greenInk, textTransform: "uppercase", fontSize: 9.5, letterSpacing: "0.1em" }}>Planned figures</span>
                <span>Hours and dollars come from allocation plans × configured rates — not recorded timesheets. Non-chargeable hours stay in internal cost but are excluded from client billing.</span>
                {s.fin.state === "ok" && s.fin.stale && (
                  <span style={{ color: MC.warn }}>Showing a slightly older copy — the latest refresh failed.</span>
                )}
              </div>

              {/* ── KPI sections: Contracted → Allocated → Cost ── */}

              {/* ── CONTRACTED: only projects that have a signed contract value ── */}
              <div style={{ marginTop: 18 }}>
                <div style={{
                  display: "flex", alignItems: "baseline", gap: 10,
                  marginBottom: 10, paddingBottom: 7,
                  borderBottom: `1px solid ${MC.border}`,
                }}>
                  <span style={{
                    fontFamily: "var(--rm-mono, monospace)", fontSize: 10,
                    fontWeight: 900, letterSpacing: "0.18em", textTransform: "uppercase",
                    color: MC.greenInk,
                  }}>Contracted</span>
                  <span style={{ fontSize: 11, color: MC.faint }}>
                    Projects where a signed contract value has been entered
                    {totalProjs > 0 && projsWithCV > 0
                      ? ` · ${projsWithCV} of ${totalProjs} projects`
                      : ""}
                  </span>
                </div>
                <div style={{
                  display: "grid", gap: 14,
                  gridTemplateColumns: "repeat(3, 1fr)",
                  alignItems: "stretch",
                }}>

                {/* ① Contract Revenue */}
                <StatCard
                  label="Contract Revenue"
                  value={s.backlog ? fmtMoney(s.backlog.value) : "—"}
                  card={s.backlog?.card ?? null}
                  onDrill={setDrawer}
                >
                  {s.backlog && totalProjs > 0 && (
                    <>
                      <MiniBar pct={cvPct} color="#8EC94A" warnColor={MC.warn} mc={MC} />
                      <div style={{ marginTop: 4, fontSize: 10.5, color: MC.faint }}>
                        Signed contract value · {cvPct}% of projects have a value
                      </div>
                      <ProjCount withCount={projsWithCV} total={totalProjs} missingLabel="no value entered" mc={MC} />
                    </>
                  )}
                  {!s.backlog && (
                    <div style={{ marginTop: 6, fontSize: 10.5, color: MC.faint }}>Project records didn't load.</div>
                  )}
                </StatCard>

                {/* ② Total Contracted Labor Hours */}
                <StatCard
                  label="Total Contracted Labor Hours"
                  value={view ? int(Math.round(view.b.plannedHours)) : "—"}
                  unit={view ? "hrs" : undefined}
                  card={view?.hoursCard ?? null}
                  onDrill={setDrawer}
                >
                  {view ? (
                    <>
                      <MiniBar pct={view.coveragePct ?? 0} color="#8EC94A" warnColor={MC.warn} mc={MC} />
                      <div style={{ marginTop: 4, fontSize: 10.5, color: MC.faint }}>
                        {view.coveragePct != null
                          ? `${view.coveragePct}% staffed · ${int(Math.round(view.b.demandHours))} hrs open`
                          : "No planned hours in this window."}
                      </div>
                      {projsInWin > 0 && (
                        <ProjCount withCount={projsInWin} total={totalProjs} missingLabel="not yet allocated" mc={MC} />
                      )}
                    </>
                  ) : (
                    <div style={{ marginTop: 6, fontSize: 10.5, color: MC.faint }}>
                      {s.fin.state === "unavailable" ? s.fin.reason : "Couldn't load hours data."}
                    </div>
                  )}
                </StatCard>

                {/* ③ Total Contracted Labor Amount */}
                {(() => {
                  const lcaVal = s.contractedLabor?.value ?? 0;
                  const portfolioVal = s.backlog?.value ?? 0;
                  const lcaMissing = portfolioVal > 0 ? lcaVal < portfolioVal * 0.005 : lcaVal < 1000;
                  const useFinBilling = lcaMissing && view != null;
                  const displayVal = useFinBilling
                    ? fmtMoney(view!.b.assignedBillDollars)
                    : (s.contractedLabor ? fmtMoney(lcaVal) : "—");
                  // Semantically correct: client billing card (not hours/allocation card)
                  const displayCard = useFinBilling
                    ? (view?.clientBillingCard ?? null)
                    : (s.contractedLabor?.card ?? null);
                  const barPct  = useFinBilling ? billPct : lcaPct;
                  const barNote = useFinBilling
                    ? `Client-billable staffed hrs × billing rates · ${billPct}% of potential billing`
                    : `Labor budgets on record · ${lcaPct}% of projects entered`;
                  return (
                    <StatCard label="Total Contracted Labor Amount" value={displayVal} card={displayCard} onDrill={setDrawer}>
                      {(view || s.contractedLabor) && (
                        <>
                          <MiniBar pct={barPct} color="#8EC94A" warnColor={MC.warn} mc={MC} />
                          <div style={{ marginTop: 4, fontSize: 10.5, color: MC.faint }}>{barNote}</div>
                          {useFinBilling ? (
                            totalProjs > 0 && (
                              <div style={{ marginTop: 5, fontSize: 10.5, lineHeight: 1.5 }}>
                                <strong style={{ color: MC.warn }}>{(totalProjs - projsWithLCA).toLocaleString("en-US")}</strong>
                                <span style={{ color: MC.faint }}> of <strong style={{ color: MC.text }}>{totalProjs.toLocaleString("en-US")}</strong> projects missing labor budget</span>
                              </div>
                            )
                          ) : (
                            <ProjCount withCount={projsWithLCA} total={totalProjs} missingLabel="no labor budget" mc={MC} />
                          )}
                        </>
                      )}
                      {!view && !s.contractedLabor && (
                        <div style={{ marginTop: 6, fontSize: 10.5, color: MC.faint }}>Project records didn't load.</div>
                      )}
                    </StatCard>
                  );
                })()}

                </div>{/* end Contracted grid */}
              </div>{/* end Contracted section */}

              {/* ── ALLOCATED: every project with a staffing plan, signed or not ── */}
              <div style={{ marginTop: 18 }}>
                <div style={{
                  display: "flex", alignItems: "baseline", gap: 10,
                  marginBottom: 10, paddingBottom: 7,
                  borderBottom: `1px solid ${MC.border}`,
                }}>
                  <span style={{
                    fontFamily: "var(--rm-mono, monospace)", fontSize: 10,
                    fontWeight: 900, letterSpacing: "0.18em", textTransform: "uppercase",
                    color: MC.greenInk,
                  }}>Allocated</span>
                  <span style={{ fontSize: 11, color: MC.faint }}>
                    All projects with a staffing plan — whether or not a contract has been signed
                    {projsInWin > 0 ? ` · ${projsInWin} active projects` : ""}
                  </span>
                </div>
                <div style={{
                  display: "grid", gap: 14,
                  gridTemplateColumns: "repeat(3, 1fr)",
                  alignItems: "stretch",
                }}>

                {/* ④ Total Allocated Labor Hours */}
                <StatCard
                  label="Total Allocated Labor Hours"
                  value={view ? int(Math.round(view.b.assignedHours)) : "—"}
                  unit={view ? "hrs" : undefined}
                  card={view?.hoursCard ?? null}
                  onDrill={setDrawer}
                >
                  {view ? (
                    <>
                      <MiniBar pct={staffedPct} color="#8EC94A" warnColor={MC.warn} mc={MC} />
                      <div style={{ marginTop: 4, fontSize: 10.5, color: MC.faint }}>
                        {staffedPct}% of all slots staffed · {int(Math.round(view.b.demandHours))} hrs open
                      </div>
                      {projsStaffed > 0 && (
                        <ProjCount withCount={projsStaffed} total={projsInWin} missingLabel="open-only" mc={MC} />
                      )}
                    </>
                  ) : (
                    <div style={{ marginTop: 6, fontSize: 10.5, color: MC.faint }}>
                      {s.fin.state === "unavailable" ? s.fin.reason : "Couldn't load allocated hours."}
                    </div>
                  )}
                </StatCard>

                {/* ⑤ Total Allocated Labor Amount — client billing (assigned chargeable hrs × bill rate) */}
                <StatCard
                  label="Total Allocated Labor Amount"
                  value={view ? fmtMoney(view.b.assignedBillDollars) : "—"}
                  card={view?.clientBillingCard ?? null}
                  onDrill={setDrawer}
                >
                  {view ? (
                    <>
                      <MiniBar pct={billPct} color="#8EC94A" warnColor={MC.warn} mc={MC} />
                      <div style={{ marginTop: 4, fontSize: 10.5, color: MC.faint }}>
                        {billPct}% of potential · {fmtMoney(view.b.plannedBillDollars)} if fully staffed
                      </div>
                      <div style={{ marginTop: 5, fontSize: 10.5, lineHeight: 1.5 }}>
                        <strong style={{ color: MC.text }}>{int(Math.round(view.b.assignedHours))}</strong>
                        <span style={{ color: MC.faint }}> client-billable staffed hrs × billing rates</span>
                      </div>
                    </>
                  ) : (
                    <div style={{ marginTop: 6, fontSize: 10.5, color: MC.faint }}>
                      {s.fin.state === "unavailable" ? s.fin.reason : "Couldn't load billing data."}
                    </div>
                  )}
                </StatCard>

                </div>{/* end Allocated grid */}
              </div>{/* end Allocated section */}

              {/* ── COST: internal labor cost split by billability ── */}
              <div style={{ marginTop: 18 }}>
                <div style={{
                  display: "flex", alignItems: "baseline", gap: 10,
                  marginBottom: 10, paddingBottom: 7,
                  borderBottom: `1px solid ${MC.border}`,
                }}>
                  <span style={{
                    fontFamily: "var(--rm-mono, monospace)", fontSize: 10,
                    fontWeight: 900, letterSpacing: "0.18em", textTransform: "uppercase",
                    color: MC.greenInk,
                  }}>Cost</span>
                  <span style={{ fontSize: 11, color: MC.faint }}>
                    Internal labor cost based on planned hours × staff cost rates
                  </span>
                </div>
                <div style={{
                  display: "grid", gap: 14,
                  gridTemplateColumns: "repeat(3, 1fr)",
                  alignItems: "stretch",
                }}>

                {/* ⑥ Job Chargeable Cost — assigned non-NC hours × internal cost rate */}
                <StatCard
                  label="Job Chargeable Cost"
                  value={view ? fmtMoney(view.b.jobChargeableCost) : "—"}
                  card={view?.jobCostCard ?? null}
                  onDrill={setDrawer}
                >
                  {view ? (
                    <>
                      <MiniBar pct={jobPct} color="#8EC94A" mc={MC} />
                      <div style={{ marginTop: 4, fontSize: 10.5, color: MC.faint }}>
                        {jobPct}% of total labor cost · directly billable to projects
                      </div>
                    </>
                  ) : (
                    <div style={{ marginTop: 6, fontSize: 10.5, color: MC.faint }}>
                      {s.fin.state === "unavailable" ? s.fin.reason : "Couldn't load cost data."}
                    </div>
                  )}
                </StatCard>

                {/* ⑦ Non-Job Chargeable Cost — assigned NC hours × internal cost rate */}
                <StatCard
                  label="Non-Job Chargeable Cost"
                  value={view ? fmtMoney(view.b.nonJobChargeableCost) : "—"}
                  card={view?.ncCostCard ?? null}
                  onDrill={setDrawer}
                >
                  {view ? (
                    <>
                      <MiniBar pct={ncPct} color={MC.warn} mc={MC} />
                      <div style={{ marginTop: 4, fontSize: 10.5, color: MC.faint }}>
                        {ncPct}% of total labor cost · overhead / non-billable time
                      </div>
                    </>
                  ) : (
                    <div style={{ marginTop: 6, fontSize: 10.5, color: MC.faint }}>
                      {s.fin.state === "unavailable" ? s.fin.reason : "Couldn't load cost data."}
                    </div>
                  )}
                </StatCard>

                </div>{/* end Cost grid */}
              </div>{/* end Cost section */}

              {/* unrated-hours honesty note */}
              {view?.unratedNote && (
                <div style={{
                  marginTop: 12, padding: "8px 14px", borderRadius: 10, fontSize: 11, color: MC.warn,
                  background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.3)",
                }}>
                  {view.unratedNote}
                </div>
              )}

              {/* charts */}
              {view && (
                <div style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
                  {/* chart 1 */}
                  <CardShell
                    title="Planned Hours by Month"
                    takeaway="How the planned workload spreads across the window. Click a bar to see that month's detail."
                    card={view.monthlyCard}
                    onDrill={setDrawer}
                  >
                    {/* stopPropagation prevents the bar click from bubbling to CardShell's onDrill */}
                    <div onClick={e => e.stopPropagation()}>
                      <MissionColumns
                        data={finMonthlyChartRows(view.b.monthly)}
                        xKey="month"
                        yKey="plannedHours"
                        color="#6B99BB"
                        height={210}
                        yFmt={v => int(Math.round(v))}
                        onBarClick={(row) => {
                          const ym = row.ym as string | undefined;
                          if (!ym) { setDrawer(view.monthlyCard); return; }
                          // A chart point must open the project evidence for
                          // that month — never the one-row month summary.
                          setDrawer(view.monthlyDetailCards[ym] ?? view.monthlyCard);
                        }}
                      />
                    </div>
                  </CardShell>

                  {/* chart 2 */}
                  <CardShell
                    title="Client-Billable Planned Revenue by Month"
                    takeaway="Chargeable allocated hours × billing rates, month by month. Non-chargeable hours are excluded. Click a point to see that month's detail."
                    card={view.monthlyCard}
                    onDrill={setDrawer}
                  >
                    <div onClick={e => e.stopPropagation()}>
                      <MissionArea
                        data={finMonthlyChartRows(view.b.monthly)}
                        xKey="month"
                        yKey="billDollars"
                        color="#8EC94A"
                        height={210}
                        yFmt={v => fmtMoney(v)}
                        onPointClick={(row) => {
                          const ym = row.ym as string | undefined;
                          if (!ym) { setDrawer(view.monthlyCard); return; }
                          // Billing and hours charts share one month/project
                          // drill so the user can audit every displayed value.
                          setDrawer(view.monthlyDetailCards[ym] ?? view.monthlyCard);
                        }}
                      />
                    </div>
                    <ChartCaption items={[{ label: "Client-billable planned revenue", color: "#8EC94A" }]} />
                  </CardShell>

                  {/* chart 3 */}
                  <CardShell
                    title="Where Labor Cost Goes"
                    takeaway="Job work vs non-chargeable time, from allocation flags. Drill to see total internal cost by project."
                    card={view.totalCostCard}
                    onDrill={setDrawer}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                      <DrillZone card={view.totalCostCard} onDrill={setDrawer} label="See the cost breakdown by project">
                        <ArcGauge
                          pct={view.chargeableSharePct ?? 0}
                          size={130}
                          label={view.chargeableSharePct != null ? `${view.chargeableSharePct}%` : "—"}
                          caption="chargeable"
                          color="#8EC94A"
                        />
                      </DrillZone>
                      <div style={{ fontSize: 11, color: MC.muted, lineHeight: 1.7, minWidth: 180 }}>
                        {view.chargeableSharePct != null ? (
                          <>
                            <div><span style={{ color: MC.greenInk, fontWeight: 700 }}>{fmtMoney(view.b.jobChargeableCost)}</span> planned on job work</div>
                            <div><span style={{ color: MC.warn, fontWeight: 700 }}>{fmtMoney(view.b.nonJobChargeableCost)}</span> planned non-chargeable</div>
                          </>
                        ) : "No costed hours in this window."}
                      </div>
                    </div>
                  </CardShell>

                  {/* reconciliation — auditable allocation-level detail */}
                  <CardShell
                    title="Reconciliation — Audit the Numbers"
                    takeaway="Every dollar above traces back to a person, project and allocation. Drill in to see the allocation-level rows whose sums exactly match this page's headline totals."
                    card={view.reconCard}
                    onDrill={setDrawer}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
                      {view.reconCard.stats.map(s => (
                        <div key={s.label} style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${MC.border}`, background: "rgba(142,201,74,0.06)" }}>
                          <div style={{ fontSize: 9.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: MC.faint }}>{s.label}</div>
                          <div style={{ marginTop: 4, fontSize: 15, fontWeight: 700, color: MC.text, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                  </CardShell>

                  {/* planned billing — shared Division / BU / Department selection */}
                  {(view.divisionCard || view.buCard || view.departmentCard) && (() => {
                    /* Each grouping renders ONLY its own canonical card — a
                     * missing dimension shows an honest empty note, never
                     * another dimension's rows. */
                    const G = {
                      division:     { card: view.divisionCard,   rowKey: "division",   noun: "divisions" },
                      businessUnit: { card: view.buCard,         rowKey: "bu",         noun: "business units" },
                      department:   { card: view.departmentCard, rowKey: "department", noun: "departments" },
                    } as const;
                    const active = G[orgDim];
                    const activeCard = selectByOrgDim(orgDim, {
                      division: view.divisionCard,
                      businessUnit: view.buCard,
                      department: view.departmentCard,
                    });
                    const dimLabel = orgDimLabel(orgDim);
                    const activeRows = orgDim === "division"
                      ? finDivisionChartRows(view.b.byDivision).map(d => ({
                          label: d.division,
                          v: d.billDollars,
                          text: `${fmtMoney(d.billDollars)} · ${int(Math.round(d.plannedHours))} hrs`,
                        }))
                      : (activeCard?.rows ?? []).map((r: any) => ({
                          label: r[active.rowKey] as string,
                          v: r.billDollars as number,
                          text: `${fmtMoney(r.billDollars as number)} · ${int(r.plannedHours as number)} hrs`,
                        }));
                    const cardTitle = `Planned Billing by ${dimLabel}`;
                    const cardTakeaway = orgDim === "division"
                      ? "Which parts of the firm carry the planned work. Click a bar to see that division's projects."
                      : orgDim === "businessUnit"
                      ? "Planned billing grouped by business unit. Click a bar to see that BU's projects."
                      : "Planned billing grouped by department (from each person's job-title department). Click a bar for the detail.";

                    return (
                      <CardShell
                        title={cardTitle}
                        takeaway={cardTakeaway}
                        card={activeCard}
                        onDrill={setDrawer}
                      >
                        {/* Shared Division / BU / Department chips */}
                        <div
                          style={{ display: "flex", marginBottom: 14 }}
                          onClick={e => e.stopPropagation()}
                        >
                          <OrgDimPicker value={orgDim} onChange={setOrgDim} />
                        </div>

                        {activeCard ? (
                          <div onClick={e => e.stopPropagation()}>
                            <ExpandableBars
                              rows={activeRows}
                              initial={10}
                              noun={active.noun}
                              color="#F0A842"
                              onBarClick={(row) => {
                                if (!activeCard) return;
                                const label = row.label;
                                const filteredRows = (activeCard.rows as Array<Record<string, unknown>>)
                                  .filter(r => r[active.rowKey] === label);
                                setDrawer({
                                  ...activeCard,
                                  title: `Financial — ${label}`,
                                  takeaway: `Planned hours and billing for ${label}.`,
                                  stats: [{ label: dimLabel, value: label }],
                                  rows: filteredRows,
                                });
                              }}
                            />
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: MC.muted, padding: "8px 0" }}>
                            No {dimLabel.toLowerCase()} data is available for this window — the
                            server hasn't recorded {active.noun} for these allocations yet. Pick
                            another dimension above.
                          </div>
                        )}
                      </CardShell>
                    );
                  })()}
                </div>
              )}

              {/* project-rows truncation honesty */}
              {view && view.b.projectRowsTruncated > 0 && (
                <div style={{ marginTop: 12, fontSize: 10.5, color: MC.faint }}>
                  Project drill-downs show the top {int(view.b.byProject.length)} projects by planned hours —
                  {" "}{int(view.b.projectRowsTruncated)} smaller ones are summed into the totals but not listed.
                </div>
              )}

              <div style={{ marginTop: 18, fontSize: 11, color: MC.faint }}>
                Contract dollars match the hub tile exactly; hours and planned dollars are computed on the server
                from the same allocation data as Resources and Forecast.
              </div>
            </>
          )}
        </>
      )}

      <DataDrawer card={drawer} onClose={() => setDrawer(null)} />
    </MissionWorld>
  );
}
