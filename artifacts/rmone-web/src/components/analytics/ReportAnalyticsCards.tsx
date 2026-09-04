import { Children, type ReactNode } from "react";
import { fmtDateShort, fmtMoney, type ReportModel } from "@/lib/reportData";
import {
  buildLeadSection,
  buildOppSection,
  buildProjectSection,
} from "@/lib/analyticsSections";
import {
  filterCardByField,
  int,
  orgDimLabel,
  type CardModel,
  type OrgDim,
} from "@/lib/analyticsCenter";
import { inPeriod, type PeriodRange, type ReportModuleId } from "@/lib/reportsCenter";
import { filterScheduleHealthCard } from "@/lib/periodAnalyticsCards";
import { CardShell, DrillNumber } from "@/components/analytics/MissionWorld";
import { ArcGauge, ExpandableBars, MissionHorizBars } from "@/components/analytics/MissionCharts";
import { Glass, useMC } from "@/components/analytics/MissionKit";
import { PeriodPicker, type PeriodState } from "@/components/analytics/PeriodPicker";

type Props = {
  module: ReportModuleId;
  model: ReportModel;
  range: PeriodRange;
  orgDim: OrgDim;
  period: PeriodState;
  onPeriodChange: (period: PeriodState) => void;
  onDrill: (card: CardModel) => void;
};

function ReportCardGrid({ children }: { children: ReactNode }) {
  const cards = Children.toArray(children);
  const rows: ReactNode[][] = [];
  for (let index = 0; index < cards.length; index += 3) {
    rows.push(cards.slice(index, index + 3));
  }
  return (
    <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
      {rows.map((row, index) => (
        <div
          key={`analytics-card-row-${index}`}
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`,
            alignItems: "stretch",
          }}
        >
          {row}
        </div>
      ))}
    </div>
  );
}

function ScopeHeader({ range, description }: { range: PeriodRange; description: string }) {
  const MC = useMC();
  return (
    <div style={{ marginTop: 22, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.2em", color: MC.greenInk }}>
          Analytics Center detail
        </div>
        <div style={{ marginTop: 5, fontSize: 20, fontWeight: 800, color: MC.text }}>
          Detailed analysis · {range.label}
        </div>
        <div style={{ marginTop: 5, maxWidth: 760, fontSize: 12, lineHeight: 1.55, color: MC.muted }}>
          {description}
        </div>
      </div>
    </div>
  );
}

function EmptyPeriod({
  label,
  period,
  onPeriodChange,
}: {
  label: string;
  period: PeriodState;
  onPeriodChange: (period: PeriodState) => void;
}) {
  const MC = useMC();
  return (
    <Glass style={{ marginTop: 16, padding: "28px 24px", textAlign: "center", color: MC.muted, fontSize: 13 }}>
      <div>No records with a recorded creation date fall inside {label}.</div>
      <div style={{ marginTop: 18, display: "flex", justifyContent: "center" }}>
        <PeriodPicker value={period} onChange={onPeriodChange} />
      </div>
    </Glass>
  );
}

function PeriodControlsFooter({
  period,
  onPeriodChange,
}: {
  period: PeriodState;
  onPeriodChange: (period: PeriodState) => void;
}) {
  return (
    <Glass style={{ marginTop: 16, padding: "14px 18px", display: "flex", justifyContent: "center" }}>
      <PeriodPicker value={period} onChange={onPeriodChange} />
    </Glass>
  );
}

export function ReportAnalyticsCards({
  module,
  model,
  range,
  orgDim,
  period,
  onPeriodChange,
  onDrill,
}: Props) {
  const MC = useMC();
  const now = new Date();

  if (module === "leads") {
    const rows = model.leads.filter(lead => inPeriod(lead.created, range));
    const section = buildLeadSection(model, orgDim, { rows, label: range.label });
    return (
      <>
        <ScopeHeader
          range={range}
          description="The complete Analytics Center lead card set, filtered to leads created inside the selected report period."
        />
        {section.count === 0 ? <EmptyPeriod label={range.label} period={period} onPeriodChange={onPeriodChange} /> : (
          <>
          <ReportCardGrid>
            {section.byStatus && (
              <CardShell title="Leads by Status" takeaway="How the selected lead book is distributed across each current status." card={section.allCard} onDrill={onDrill}>
                <ExpandableBars
                  rows={section.byStatus.rows.map(row => ({ label: row.label, v: row.v }))}
                  initial={7}
                  noun="statuses"
                  color="#6B99BB"
                  onBarClick={row => onDrill(filterCardByField(section.allCard, "status", row.label))}
                />
              </CardShell>
            )}
            {section.bySector && (
              <CardShell title="Est. Value by Sector" takeaway="Which sectors the selected leads target." card={section.allCard} onDrill={onDrill}>
                <ExpandableBars
                  rows={section.bySector.rows.map(row => ({ label: row.label, v: row.v, text: fmtMoney(row.v) }))}
                  initial={8}
                  noun="sectors"
                  color="#C4D44A"
                  onBarClick={row => onDrill(filterCardByField(section.allCard, "sector", row.label))}
                />
              </CardShell>
            )}
            {section.byOrg && (
              <CardShell
                title={`Est. Value by ${orgDimLabel(section.byOrg.dim)}`}
                takeaway={`Which ${orgDimLabel(section.byOrg.dim).toLowerCase()}s own the selected leads.`}
                card={section.allCard}
                onDrill={onDrill}
              >
                <ExpandableBars
                  rows={section.byOrg.rows.map(row => ({ label: row.label, v: row.v, text: fmtMoney(row.v), filterValue: row.key }))}
                  initial={8}
                  noun={`${orgDimLabel(section.byOrg.dim).toLowerCase()}s`}
                  color="#8EC94A"
                  onBarClick={row => section.byOrg && onDrill(filterCardByField(section.allCard, section.byOrg.dim, row.filterValue ?? row.label))}
                />
              </CardShell>
            )}
            {section.byCity && (
              <CardShell title="Est. Value by City" takeaway="Geographic spread of the selected lead book." card={section.allCard} onDrill={onDrill}>
                <ExpandableBars
                  rows={section.byCity.rows.map(row => ({ label: row.label, v: row.v, text: fmtMoney(row.v) }))}
                  initial={10}
                  noun="cities"
                  color="#A78BFA"
                  onBarClick={row => onDrill(filterCardByField(section.allCard, "city", row.label))}
                />
              </CardShell>
            )}
            {section.largest && (
              <CardShell title="Highest Estimated Value" takeaway="Top selected-period leads by estimated value." card={section.allCard} onDrill={onDrill}>
                <ExpandableBars
                  rows={section.largest.map(lead => ({ label: lead.name, v: lead.value, text: `${fmtMoney(lead.value)} · ${lead.client || lead.sector || "—"}` }))}
                  initial={10}
                  noun="leads"
                  color="#6B99BB"
                  onBarClick={row => onDrill(filterCardByField(section.allCard, "name", row.label))}
                />
              </CardShell>
            )}
          </ReportCardGrid>
          <PeriodControlsFooter period={period} onPeriodChange={onPeriodChange} />
          </>
        )}
      </>
    );
  }

  if (module === "opportunities") {
    const rows = model.opps.filter(opportunity => inPeriod(opportunity.created, range));
    const section = buildOppSection(model, now, orgDim, { rows, label: range.label });
    return (
      <>
        <ScopeHeader
          range={range}
          description="The complete Analytics Center opportunity card set, filtered to currently open pursuits created inside the selected report period."
        />
        {section.activeBids === 0 ? <EmptyPeriod label={range.label} period={period} onPeriodChange={onPeriodChange} /> : (
          <>
          <ReportCardGrid>
            {section.byStage && (
              <CardShell title="Active Bids by Stage" takeaway="Where the selected open pursuits sit today, stage by stage." card={section.allCard} onDrill={onDrill}>
                <ExpandableBars
                  rows={section.byStage.rows.map(row => ({
                    label: row.label,
                    v: row.v,
                    text: `${int(row.count)} bid${row.count === 1 ? "" : "s"} · ${fmtMoney(row.v)}`,
                  }))}
                  initial={8}
                  noun="stages"
                  color="#F0A842"
                  onBarClick={row => onDrill(filterCardByField(section.allCard, "stage", row.label))}
                />
              </CardShell>
            )}
            {section.byOrg && (
              <CardShell
                title={`Value by ${orgDimLabel(section.byOrg.dim)}`}
                takeaway={`Selected-period pipeline spread across the firm's ${orgDimLabel(section.byOrg.dim).toLowerCase()}s.`}
                card={section.allCard}
                onDrill={onDrill}
              >
                <ExpandableBars
                  rows={section.byOrg.rows.map(row => ({ label: row.label, v: row.v, text: fmtMoney(row.v), filterValue: row.key }))}
                  initial={8}
                  noun={`${orgDimLabel(section.byOrg.dim).toLowerCase()}s`}
                  color="#8EC94A"
                  onBarClick={row => section.byOrg && onDrill(filterCardByField(section.allCard, section.byOrg.dim, row.filterValue ?? row.label))}
                />
              </CardShell>
            )}
            {section.bySector && (
              <CardShell title="Value by Sector" takeaway="Which markets the selected active pursuits target." card={section.allCard} onDrill={onDrill}>
                <ExpandableBars
                  rows={section.bySector.rows.map(row => ({ label: row.label, v: row.v, text: fmtMoney(row.v) }))}
                  initial={8}
                  noun="sectors"
                  color="#C4D44A"
                  onBarClick={row => onDrill(filterCardByField(section.allCard, "sector", row.label))}
                />
              </CardShell>
            )}
            {section.byCity && (
              <CardShell title="Value by City" takeaway="Geographic spread of the selected active pipeline." card={section.allCard} onDrill={onDrill}>
                <ExpandableBars
                  rows={section.byCity.rows.map(row => ({ label: row.label, v: row.v, text: fmtMoney(row.v) }))}
                  initial={10}
                  noun="cities"
                  color="#A78BFA"
                  onBarClick={row => onDrill(filterCardByField(section.allCard, "city", row.label))}
                />
              </CardShell>
            )}
            {section.largest && (
              <CardShell title="Largest Active Pursuits" takeaway="Top selected-period open pursuits by contract value." card={section.allCard} onDrill={onDrill}>
                <ExpandableBars
                  rows={section.largest.map(opportunity => ({
                    label: opportunity.name,
                    v: opportunity.value,
                    text: `${fmtMoney(opportunity.value)} · ${opportunity.client || opportunity.sector || "—"}`,
                  }))}
                  initial={10}
                  noun="pursuits"
                  color="#F0A842"
                  onBarClick={row => onDrill(filterCardByField(section.allCard, "name", row.label))}
                />
              </CardShell>
            )}
            {section.bidsSoon && (
              <CardShell title="Bids Due in 90 Days" takeaway="Selected-period open pursuits with a bid date in the next 90 days." card={section.bidsSoon.card} onDrill={onDrill}>
                <ExpandableBars
                  rows={section.bidsSoon.rows.map(opportunity => {
                    const daysLeft = opportunity.daysToBid ?? (opportunity.bidDate ? Math.max(0, Math.round((new Date(opportunity.bidDate).getTime() - Date.now()) / 86400000)) : 90);
                    return {
                      label: opportunity.name,
                      v: Math.max(1, 90 - daysLeft),
                      text: `${opportunity.bidDate ? fmtDateShort(opportunity.bidDate) : "—"} · ${int(daysLeft)}d left`,
                    };
                  })}
                  initial={8}
                  noun="pursuits"
                  color="#6B99BB"
                  onBarClick={row => section.bidsSoon && onDrill(filterCardByField(section.bidsSoon.card, "name", row.label))}
                />
              </CardShell>
            )}
          </ReportCardGrid>
          <PeriodControlsFooter period={period} onPeriodChange={onPeriodChange} />
          </>
        )}
      </>
    );
  }

  if (module === "projects") {
    const rows = model.projects.filter(project => inPeriod(project.created, range));
    const section = buildProjectSection(model, now, orgDim, { rows, label: range.label });
    return (
      <>
        <ScopeHeader
          range={range}
          description="The complete Analytics Center project card set, filtered to currently active projects created inside the selected report period."
        />
        {rows.length === 0 ? <EmptyPeriod label={range.label} period={period} onPeriodChange={onPeriodChange} /> : (
          <>
            {section.health.card && (
              <Glass style={{ marginTop: 16, padding: "22px 28px", display: "flex", alignItems: "center", gap: 30, flexWrap: "wrap" }}>
                <div
                  role="button"
                  tabIndex={0}
                  title="See the selected projects' schedule standing"
                  onClick={() => section.health.card && onDrill(section.health.card)}
                  onKeyDown={event => {
                    if ((event.key === "Enter" || event.key === " ") && section.health.card) {
                      event.preventDefault();
                      onDrill(section.health.card);
                    }
                  }}
                  style={{ cursor: "zoom-in" }}
                >
                  <ArcGauge
                    pct={section.health.pct ?? 0}
                    size={150}
                    label={section.health.pct != null ? `${section.health.pct}%` : "—"}
                    caption="on time"
                    color={section.health.pct == null ? "#6B99BB" : section.health.pct >= 80 ? "#8EC94A" : section.health.pct >= 60 ? "#F0A842" : "#F87171"}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", color: MC.greenInk }}>
                    Schedule Health · {range.label}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 15, fontWeight: 600, lineHeight: 1.55, color: MC.text }}>
                    {section.health.sentence}
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 22, flexWrap: "wrap" }}>
                    {section.health.card.stats.slice(0, 3).map(stat => {
                      const metricCard = filterScheduleHealthCard(section.health.card!, stat.label);
                      return (
                        <div key={stat.label}>
                          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: MC.faint }}>{stat.label}</div>
                          <div style={{ marginTop: 2 }}>
                            <DrillNumber value={String(stat.value)} card={metricCard} onDrill={onDrill} size={22} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Glass>
            )}
            <ReportCardGrid>
              {section.statuses && (
                <CardShell title="Projects by Status" takeaway="Every selected active project grouped by its current status." card={section.statuses.card} onDrill={onDrill}>
                  <ExpandableBars
                    rows={section.statuses.rows.map(row => ({ label: row.label, v: row.v }))}
                    initial={7}
                    noun="statuses"
                    color="#6B99BB"
                    onBarClick={row => section.statuses && onDrill(filterCardByField(section.statuses.card, "status", row.label))}
                  />
                </CardShell>
              )}
              {section.byOrg && (
                <CardShell title={`Value by ${orgDimLabel(section.byOrg.dim)}`} takeaway="How the selected active portfolio spreads across the firm." card={section.byOrg.card} onDrill={onDrill}>
                  <ExpandableBars
                    rows={section.byOrg.rows.map(row => ({ label: row.label, v: row.value, text: fmtMoney(row.value), filterValue: row.key }))}
                    initial={8}
                    noun={`${orgDimLabel(section.byOrg.dim).toLowerCase()}s`}
                    color="#8EC94A"
                    onBarClick={row => section.byOrg && onDrill(filterCardByField(section.byOrg.card, section.byOrg.dim, row.filterValue ?? row.label))}
                  />
                </CardShell>
              )}
              {section.bySector && (
                <CardShell title="Value by Sector" takeaway="Which markets the selected active work serves." card={section.bySector.card} onDrill={onDrill}>
                  <ExpandableBars
                    rows={section.bySector.rows.map(row => ({ label: row.label, v: row.value, text: fmtMoney(row.value) }))}
                    initial={8}
                    noun="sectors"
                    color="#C4D44A"
                    onBarClick={row => section.bySector && onDrill(filterCardByField(section.bySector.card, "label", row.label))}
                  />
                </CardShell>
              )}
              {section.byCity && (
                <CardShell title="Value by City" takeaway="Geographic exposure of the selected active contract value." card={section.byCity.card} onDrill={onDrill}>
                  <ExpandableBars
                    rows={section.byCity.rows.map(row => ({ label: row.label, v: row.value, text: fmtMoney(row.value) }))}
                    initial={10}
                    noun="cities"
                    color="#A78BFA"
                    onBarClick={row => section.byCity && onDrill(filterCardByField(section.byCity.card, "label", row.label))}
                  />
                </CardShell>
              )}
              {section.largest && (
                <CardShell title="Largest Active Engagements" takeaway="The selected active projects with the highest contract value." card={section.largest.card} onDrill={onDrill}>
                  <ExpandableBars
                    rows={section.largest.rows.map(project => ({ label: project.name, v: project.value, text: `${fmtMoney(project.value)} · ${project.client || project.sector || "—"}` }))}
                    initial={10}
                    noun="projects"
                    color="#8EC94A"
                    onBarClick={row => section.largest && onDrill(filterCardByField(section.largest.card, "name", row.label))}
                  />
                </CardShell>
              )}
              {section.overdue && (
                <CardShell title="Overdue Projects" takeaway="Selected projects past their planned end date." card={section.overdue.card} onDrill={onDrill}>
                  <ExpandableBars
                    rows={section.overdue.rows.map(project => ({
                      label: project.name,
                      v: Math.max(1, project.daysOverdue ?? 1),
                      text: `${int(project.daysOverdue ?? 0)}d overdue · ${project.targetEnd ? fmtDateShort(project.targetEnd) : "—"}`,
                    }))}
                    initial={10}
                    noun="projects"
                    color="#F87171"
                    onBarClick={row => section.overdue && onDrill(filterCardByField(section.overdue.card, "name", row.label))}
                  />
                </CardShell>
              )}
              {section.endingSoon && (
                <CardShell title="Ending Within 90 Days" takeaway="Selected projects planned to finish within the next 90 days." card={section.endingSoon.card} onDrill={onDrill}>
                  <ExpandableBars
                    rows={section.endingSoon.rows.map(project => {
                      const daysLeft = project.targetEnd ? Math.max(0, Math.round((new Date(project.targetEnd).getTime() - Date.now()) / 86400000)) : 90;
                      return { label: project.name, v: Math.max(1, 90 - daysLeft), text: `${project.targetEnd ? fmtDateShort(project.targetEnd) : "—"} · ${daysLeft}d left` };
                    })}
                    initial={8}
                    noun="projects"
                    color="#6B99BB"
                    onBarClick={row => section.endingSoon && onDrill(filterCardByField(section.endingSoon.card, "name", row.label))}
                  />
                </CardShell>
              )}
              {section.valueRanges && (
                <CardShell title="Projects by Contract Size" takeaway="How many selected projects fall in each contract-value range." card={section.valueRanges.card} onDrill={onDrill}>
                  <MissionHorizBars
                    rows={section.valueRanges.rows.map(row => ({ label: row.label, v: row.count, text: `${int(row.count)} project${row.count === 1 ? "" : "s"}` }))}
                    color="#C4D44A"
                    onBarClick={row => section.valueRanges && onDrill(filterCardByField(section.valueRanges.card, "contractSizeRange", row.label))}
                  />
                </CardShell>
              )}
            </ReportCardGrid>
             <PeriodControlsFooter period={period} onPeriodChange={onPeriodChange} />
          </>
        )}
      </>
    );
  }

  return null;
}