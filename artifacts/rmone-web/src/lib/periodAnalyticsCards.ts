import {
  buildLeadSection,
  buildOppSection,
  buildProjectSection,
  type LeadSection,
  type OppSection,
  type ProjectSection,
} from "./analyticsSections";
import type { CardModel, OrgDim } from "./analyticsCenter";
import type { ReportModel } from "./reportData";
import { inPeriod, type PeriodRange, type ReportModuleId } from "./reportsCenter";

export type PeriodAnalyticsDetail =
  | { module: "leads"; range: PeriodRange; section: LeadSection }
  | { module: "opportunities"; range: PeriodRange; section: OppSection }
  | { module: "projects"; range: PeriodRange; section: ProjectSection };

export function buildPeriodAnalyticsDetail(
  module: Exclude<ReportModuleId, "closeout">,
  model: ReportModel,
  range: PeriodRange,
  orgDim: OrgDim,
  now = new Date(),
): PeriodAnalyticsDetail {
  if (module === "leads") {
    const rows = model.leads.filter(lead => inPeriod(lead.created, range));
    return {
      module,
      range,
      section: buildLeadSection(model, orgDim, { rows, label: range.label }),
    };
  }
  if (module === "opportunities") {
    const rows = model.opps.filter(opportunity => inPeriod(opportunity.created, range));
    return {
      module,
      range,
      section: buildOppSection(model, now, orgDim, { rows, label: range.label }),
    };
  }
  const rows = model.projects.filter(project => inPeriod(project.created, range));
  return {
    module,
    range,
    section: buildProjectSection(model, now, orgDim, { rows, label: range.label }),
  };
}

/**
 * The report-level workbook contains one sheet per visible detail card. Some
 * Analytics Center cards intentionally share one raw-record drawer; cloning
 * the card title keeps each sheet aligned with the label the user saw.
 */
export function periodAnalyticsExportCards(detail: PeriodAnalyticsDetail): CardModel[] {
  const titled = (card: CardModel, title: string): CardModel => ({ ...card, title });
  if (detail.module === "leads") {
    const section = detail.section;
    return [
      section.byStatus ? titled(section.allCard, "Leads by Status") : null,
      section.bySector ? titled(section.allCard, "Est. Value by Sector") : null,
      section.byOrg ? titled(section.allCard, `Est. Value by ${section.byOrg.dim}`) : null,
      section.byCity ? titled(section.allCard, "Est. Value by City") : null,
      section.largest ? titled(section.allCard, "Highest Estimated Value") : null,
    ].filter((card): card is CardModel => card != null);
  }
  if (detail.module === "opportunities") {
    const section = detail.section;
    return [
      section.byStage ? titled(section.allCard, "Active Bids by Stage") : null,
      section.byOrg ? titled(section.allCard, `Opportunity Value by ${section.byOrg.dim}`) : null,
      section.bySector ? titled(section.allCard, "Opportunity Value by Sector") : null,
      section.byCity ? titled(section.allCard, "Opportunity Value by City") : null,
      section.largest ? titled(section.allCard, "Largest Active Pursuits") : null,
      section.bidsSoon?.card ?? null,
    ].filter((card): card is CardModel => card != null);
  }
  const section = detail.section;
  return [
    section.health.card,
    section.statuses?.card ?? null,
    section.byOrg?.card ?? null,
    section.bySector?.card ?? null,
    section.byCity?.card ?? null,
    section.largest?.card ?? null,
    section.overdue?.card ?? null,
    section.endingSoon?.card ?? null,
    section.valueRanges?.card ?? null,
  ].filter((card): card is CardModel => card != null);
}

export function filterScheduleHealthCard(card: CardModel, metricLabel: string): CardModel {
  const normalized = metricLabel.trim().toLowerCase();
  const matches = (row: CardModel["rows"][number]): boolean => {
    const schedule = String(row.schedule ?? "").trim().toLowerCase();
    if (normalized === "on schedule") return schedule === "on schedule";
    if (normalized === "overdue") return schedule.includes("overdue");
    if (normalized === "no end date") return schedule === "no end date";
    return true;
  };
  const rows = card.rows.filter(matches);
  return {
    ...card,
    title: `${card.title} — ${metricLabel}`,
    takeaway: `${metricLabel} projects from the same selected report period.`,
    stats: [{ label: metricLabel, value: rows.length.toLocaleString("en-US") }],
    rows,
  };
}