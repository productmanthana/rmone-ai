/* ─────────────────────────────────────────────────────────────
 * analyticsSections.ts — pure view-model builders for the
 * Analytics Center section pages (Executive, Project, Financial).
 * Same honesty contract as the hub: every number comes from the
 * shared ReportModel (or the server financial endpoint), a failed
 * source degrades to null/"—" — never to a fabricated zero — and
 * every visible figure carries a CardModel so the page can open
 * the underlying rows and export them to PDF/Excel.
 * Pure data — no React — so the honesty check script can run it.
 * ──────────────────────────────────────────────────────────── */
import {
  fmtMoney, type ReportModel, type ProjectRow, type OppRow, type NamedValue,
  type LeadRow, type SectorWinLoss,
} from "@/lib/reportData";
import {
  PROJECT_COLS, FINANCIAL_COLS, SCHEDULE_COLS, DECIDED_COLS,
  projRows, scheduleRows, decidedRows, countBy, sumBy, int,
  orgDimLabel, orgValueOf, orgKeyOf, sumByOrg, countByOrg,
  type CardModel, type CardColumn, type CardRow, type Tone, type OrgDim, type OrgGroup,
} from "@/lib/analyticsCenter";
import type {
  FinancialAnalytics, FinBasis, FinBasisKey, FinMonthly, FinDivisionRow,
  FinOrgProjectGroup, FinReconRow, FinReconMeta,
} from "@/lib/api";

/* ── extra column sets used only by the section pages ── */
export const OPP_COLS: CardColumn[] = [
  { key: "id", label: "ID", width: 15 },
  { key: "name", label: "Pursuit", width: 38 },
  { key: "client", label: "Client", width: 24 },
  { key: "stage", label: "Stage", width: 20 },
  { key: "value", label: "Value", kind: "money", align: "right", width: 13 },
  { key: "probability", label: "Win %", kind: "pct", align: "right", width: 10 },
  { key: "bidDate", label: "Bid Date", kind: "date", width: 13 },
];
export const OVERDUE_COLS: CardColumn[] = [
  { key: "id", label: "ID", width: 15 },
  { key: "name", label: "Project", width: 38 },
  { key: "client", label: "Client", width: 24 },
  { key: "division", label: "Division", width: 18 },
  { key: "daysOverdue", label: "Days Over", kind: "int", align: "right", width: 11 },
  { key: "targetEnd", label: "Planned End", kind: "date", width: 14 },
  { key: "value", label: "Value", kind: "money", align: "right", width: 13 },
];
export const SUMMARY_COLS: CardColumn[] = [
  { key: "label", label: "Group", width: 30 },
  { key: "count", label: "Total Projects", kind: "int", align: "right", width: 12 },
  { key: "value", label: "Value", kind: "money", align: "right", width: 15 },
];
export const CLIENT_COLS: CardColumn[] = [
  { key: "label", label: "Client", width: 32 },
  { key: "count", label: "Total Projects", kind: "int", align: "right", width: 12 },
  { key: "value", label: "Backlog", kind: "money", align: "right", width: 15 },
  { key: "share", label: "Share", kind: "pct", align: "right", width: 10 },
];
export const FIN_PROJECT_COLS: CardColumn[] = [
  { key: "ticket", label: "ID", width: 15 },
  { key: "name", label: "Project", width: 38 },
  { key: "division", label: "Division", width: 18 },
  { key: "plannedHours", label: "Planned Hrs", kind: "int", align: "right", width: 13 },
  { key: "assignedHours", label: "Assigned Hrs", kind: "int", align: "right", width: 13 },
  { key: "billDollars", label: "Planned Billing", kind: "moneyFull", align: "right", width: 17 },
  { key: "jobCost", label: "Job Cost", kind: "moneyFull", align: "right", width: 15 },
  { key: "nonJobCost", label: "Non-Job Cost", kind: "moneyFull", align: "right", width: 15 },
];
export const FIN_MONTH_COLS: CardColumn[] = [
  { key: "ym", label: "Month", width: 12 },
  { key: "plannedHours", label: "Planned Hrs", kind: "int", align: "right", width: 13 },
  { key: "billDollars", label: "Planned Billing", kind: "moneyFull", align: "right", width: 17 },
  { key: "costDollars", label: "Planned Cost", kind: "moneyFull", align: "right", width: 17 },
];
export const FIN_DIVISION_COLS: CardColumn[] = [
  { key: "division", label: "Division", width: 26 },
  { key: "plannedHours", label: "Planned Hrs", kind: "int", align: "right", width: 13 },
  { key: "assignedHours", label: "Assigned Hrs", kind: "int", align: "right", width: 13 },
  { key: "billDollars", label: "Planned Billing", kind: "moneyFull", align: "right", width: 17 },
];
export const FIN_BU_COLS: CardColumn[] = [
  { key: "bu", label: "Business Unit", width: 26 },
  { key: "plannedHours", label: "Planned Hrs", kind: "int", align: "right", width: 13 },
  { key: "assignedHours", label: "Assigned Hrs", kind: "int", align: "right", width: 13 },
  { key: "billDollars", label: "Planned Billing", kind: "moneyFull", align: "right", width: 17 },
];
export const FIN_DEPT_COLS: CardColumn[] = [
  { key: "department", label: "Department", width: 26 },
  { key: "plannedHours", label: "Planned Hrs", kind: "int", align: "right", width: 13 },
  { key: "assignedHours", label: "Assigned Hrs", kind: "int", align: "right", width: 13 },
  { key: "billDollars", label: "Planned Billing", kind: "moneyFull", align: "right", width: 17 },
];
// Reconciliation detail columns — person/allocation level breakdown per project
export const FIN_RECON_COLS: CardColumn[] = [
  { key: "person", label: "Person / Demand", width: 28 },
  { key: "allocationId", label: "Alloc ID", width: 14 },
  { key: "allocationStart", label: "Alloc Start", kind: "date", width: 13 },
  { key: "allocationEnd", label: "Alloc End", kind: "date", width: 13 },
  { key: "nonChargeable", label: "NC", width: 6 },
  { key: "plannedHours", label: "Planned Hrs", kind: "int", align: "right", width: 13 },
  { key: "chargeableHours", label: "Chargeable Hrs", kind: "int", align: "right", width: 15 },
  { key: "billRate", label: "Bill $/h", kind: "moneyFull", align: "right", width: 12 },
  { key: "planClientBilling", label: "Client Billing", kind: "moneyFull", align: "right", width: 15 },
  { key: "costRate", label: "Cost $/h", kind: "moneyFull", align: "right", width: 12 },
  { key: "jobCost", label: "Job Cost", kind: "moneyFull", align: "right", width: 14 },
  { key: "ncCost", label: "NC Cost", kind: "moneyFull", align: "right", width: 14 },
  { key: "totalInternalCost", label: "Total Cost", kind: "moneyFull", align: "right", width: 14 },
];
// Project-level summary with nested allocation detail
export const FIN_PROJECT_DETAIL_COLS: CardColumn[] = [
  { key: "ticket", label: "ID", width: 15 },
  { key: "name", label: "Project / Person", width: 38 },
  { key: "division", label: "Division", width: 18 },
  { key: "plannedHours", label: "Planned Hrs", kind: "int", align: "right", width: 13 },
  { key: "chargeableHours", label: "Chargeable Hrs", kind: "int", align: "right", width: 15 },
  { key: "planClientBilling", label: "Client Billing", kind: "moneyFull", align: "right", width: 15 },
  { key: "jobCost", label: "Job Cost", kind: "moneyFull", align: "right", width: 14 },
  { key: "ncCost", label: "NC Cost", kind: "moneyFull", align: "right", width: 14 },
  { key: "totalInternalCost", label: "Total Cost", kind: "moneyFull", align: "right", width: 14 },
];

const namedRows = (list: NamedValue[]): CardRow[] =>
  list.map(d => ({ label: d.label, count: d.count, value: d.value }));

function oppRows(list: OppRow[]): CardRow[] {
  return list.map(o => ({ ...o, client: o.client ?? "—", probability: o.probability, _ticket: o.id }));
}

/* ═══════════════════ EXECUTIVE ═══════════════════ */
export type ExecutiveSection = {
  recordsOk: boolean;
  staffingOk: boolean;
  /** headline: signed backlog */
  hero: { value: string; explain: string; card: CardModel | null };
  /** the two arc gauges (null = unknown, page renders "—") */
  winRate: { pct: number | null; card: CardModel | null; caption: string };
  onTime: { pct: number | null; card: CardModel | null; caption: string };
  /** KPI band */
  kpis: { label: string; value: string; card: CardModel | null }[];
  /** funnel: lifecycle stages with real counts + values */
  funnel: {
    rows: { label: string; count: number; value: number }[];
    card: CardModel;
    /** Record-level evidence for each aggregate bar. */
    drillCards: Record<string, CardModel>;
  } | null;
  /** conversion drills */
  conversion: {
    leadRate: number | null; leadText: string;
    oppRate: number | null; oppText: string;
    leadCard: CardModel | null; oppCard: CardModel | null;
  } | null;
  /** status mix segments */
  statusSegments: { total: number; segments: { label: string; v: number; color: string }[]; card: CardModel } | null;
  /** backlog by division — THE one recharts chart on this page */
  backlogByDivision: { rows: NamedValue[]; card: CardModel } | null;
  /** division scorecard — tabs for div / BU / dept, only the tiers this tenant uses */
  divisionScore: {
    tabs: { key: "div" | "bu" | "dep"; label: string; count: number; rows: { key: string; label: string; backlog: string; backlogValue: number; people: string; peopleCount: number; openSeats: string; openSeatsCount: number }[] }[];
    card: CardModel;
  } | null;
  /** client concentration */
  clients: {
    rows: (NamedValue & { share: number })[];
    card: CardModel;
    /** One project-level card per client; keys are the exact chart labels. */
    drillCards: Record<string, CardModel>;
  } | null;
};

const STATUS_COLORS = ["#8EC94A", "#6B99BB", "#F0A842", "#A78BFA", "#C4D44A", "rgba(255,255,255,0.3)"];

export function buildExecutiveSection(m: ReportModel): ExecutiveSection {
  const recordsOk = m.sources ? m.sources.records : true;
  const staffingOk = m.sources ? m.sources.staffing : true;
  const demandsOk = m.sources ? m.sources.demands : true;

  const portfolioCard: CardModel = {
    id: "executive",
    title: "Executive — Active Portfolio",
    takeaway: "Every active project behind the backlog number, largest first.",
    stats: [
      { label: "Backlog", value: fmtMoney(m.backlogValue) },
      { label: "Active projects", value: int(m.activeProjects) },
      { label: "Avg project value", value: fmtMoney(m.avgProjectValue) },
    ],
    columns: PROJECT_COLS,
    rows: projRows(m.projects),
  };
  const pipelineCard: CardModel = {
    id: "executive",
    title: "Executive — Open Pipeline",
    takeaway: "Every pursuit still in play, largest first.",
    stats: [
      { label: "Pipeline", value: fmtMoney(m.pipelineValue) },
      { label: "Weighted", value: fmtMoney(m.weightedPipeline) },
      { label: "Active bids", value: int(m.activeBids) },
    ],
    columns: OPP_COLS,
    rows: oppRows(m.opps),
  };
  const decidedCard: CardModel | null = m.decidedOpps.length > 0 ? {
    id: "executive",
    title: "Executive — Decided Bids",
    takeaway: "Every bid that has been won or lost — the rows behind the win rate.",
    stats: [
      { label: "Won", value: `${int(m.wonCount)} (${fmtMoney(m.wonValue)})` },
      { label: "Lost", value: `${int(m.lostCount)} (${fmtMoney(m.lostValue)})` },
      ...(m.winRate != null ? [{ label: "Win rate", value: `${m.winRate}%` }] : []),
    ],
    columns: OPP_COLS,
    rows: oppRows(m.decidedOpps),
  } : null;
  const scheduleCard: CardModel = {
    id: "executive",
    title: "Executive — Schedule Standing",
    takeaway: "Where every active project stands against its planned end date.",
    stats: [
      { label: "On schedule", value: int(m.onScheduleCount), filterKey: "scheduleGroup" },
      { label: "Overdue", value: int(m.overdueCount), filterKey: "scheduleGroup" },
      { label: "No end date", value: int(m.noDateCount), filterKey: "scheduleGroup" },
    ],
    columns: SCHEDULE_COLS,
    rows: scheduleRows([...m.projects].sort((a, b) => Number(b.overdue) - Number(a.overdue) || (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0))),
  };

  if (!recordsOk) {
    /* Project/pipeline records failed to load: the page shows unknowns. */
    return {
      recordsOk, staffingOk,
      hero: {
        value: "—",
        explain: "Project and pipeline records didn't load, so no headline number is shown. Refresh to try again.",
        card: null,
      },
      winRate: { pct: null, card: null, caption: "of decided bids won" },
      onTime: { pct: null, card: null, caption: "of dated projects on time" },
      kpis: [],
      funnel: null,
      conversion: null,
      statusSegments: null,
      backlogByDivision: null,
      divisionScore: null,
      clients: null,
    };
  }

  const funnelRows = m.funnel.filter(f => f.count > 0 || f.value > 0);
  const statuses = countBy(m.projects, p => p.status);
  const awardedOpps = m.decidedOpps.filter(o => o.won);
  const leadCols: CardColumn[] = [
    { key: "id", label: "ID", width: 15 },
    { key: "name", label: "Lead", width: 38 },
    { key: "client", label: "Client", width: 24 },
    { key: "status", label: "Status", width: 18 },
    { key: "value", label: "Value", kind: "money", align: "right", width: 13 },
  ];
  const funnelDrillCards: Record<string, CardModel> = {
    Leads: {
      id: "executive",
      title: "Executive — Lifecycle Funnel — Leads",
      takeaway: `All ${int(m.leads.length)} leads behind this funnel total.`,
      stats: [{ label: "Leads", value: int(m.leads.length) }],
      columns: leadCols,
      rows: m.leads.map(l => ({ ...l, client: l.client ?? "—", _ticket: l.id })),
    },
    "Active Bids": pipelineCard,
    "Awarded (YTD)": {
      id: "executive",
      title: "Executive — Lifecycle Funnel — Awarded",
      takeaway: `All ${int(awardedOpps.length)} awarded pursuits behind this funnel total.`,
      stats: [{ label: "Awarded", value: int(awardedOpps.length) }],
      columns: OPP_COLS,
      rows: oppRows(awardedOpps),
    },
  };

  const clientDrillCards = Object.fromEntries(
    (m.clientConcentration ?? []).map(client => {
      const matching = m.projects
        .filter(project => project.client === client.label)
        .sort((a, b) => b.value - a.value);
      return [client.label, {
        id: "executive" as const,
        title: `Executive — Client Concentration — ${client.label}`,
        takeaway: `All ${int(matching.length)} active project${matching.length === 1 ? "" : "s"} for ${client.label}, largest first.`,
        stats: [
          { label: "Projects", value: int(matching.length) },
          { label: "Backlog", value: fmtMoney(matching.reduce((sum, project) => sum + project.value, 0)) },
          { label: "Portfolio share", value: `${Math.round(client.share)}%` },
        ],
        columns: PROJECT_COLS,
        rows: projRows(matching),
      } satisfies CardModel];
    }),
  );

  /* Org scorecard: a shared stable key joins projects, people, and demands.
   * Display names are not identity — same-named units are valid. */
  type SRow = { key: string; label: string; backlog: string; backlogValue: number; people: string; peopleCount: number; openSeats: string; openSeatsCount: number };
  type Bucket = { key: string; baseLabel: string; backlogValue: number; peopleCount: number; openSeatsCount: number };
  function makeSRows(dim: OrgDim, showBacklog: boolean, showSeats: boolean): SRow[] {
    const buckets = new Map<string, Bucket>();
    const add = (row: Parameters<typeof orgKeyOf>[0], field: "backlogValue" | "peopleCount" | "openSeatsCount", value: number) => {
      const baseLabel = orgValueOf(row, dim) ?? "Unassigned";
      const key = orgKeyOf(row, dim) ?? `name:${baseLabel}`;
      const bucket = buckets.get(key) ?? { key, baseLabel, backlogValue: 0, peopleCount: 0, openSeatsCount: 0 };
      bucket[field] += value;
      buckets.set(key, bucket);
    };
    for (const project of m.projects) add(project, "backlogValue", project.value);
    if (staffingOk) for (const staff of m.staff) add(staff, "peopleCount", 1);
    if (demandsOk) {
      const projectsByTicket = new Map(m.projects.map(project => [project.id, project]));
      for (const demand of m.demands) {
        const project = projectsByTicket.get(demand.ticket);
        if (project) add(project, "openSeatsCount", 1);
      }
    }
    const duplicateKeys = new Map<string, string[]>();
    for (const bucket of buckets.values()) {
      const keys = duplicateKeys.get(bucket.baseLabel) ?? [];
      keys.push(bucket.key);
      duplicateKeys.set(bucket.baseLabel, keys);
    }
    for (const keys of duplicateKeys.values()) keys.sort((a, b) => a.localeCompare(b));
    return [...buckets.values()]
      .filter(bucket => bucket.backlogValue > 0 || bucket.peopleCount > 0)
      .map(bucket => {
        const sameNameKeys = duplicateKeys.get(bucket.baseLabel) ?? [];
        const label = sameNameKeys.length > 1
          ? `${bucket.baseLabel} (${sameNameKeys.indexOf(bucket.key) + 1})`
          : bucket.baseLabel;
        return {
          key: bucket.key, label,
          backlog: showBacklog ? fmtMoney(bucket.backlogValue) : "—",
          backlogValue: showBacklog ? bucket.backlogValue : 0,
          people: staffingOk ? int(bucket.peopleCount) : "—",
          peopleCount: staffingOk ? bucket.peopleCount : 0,
          openSeats: showSeats ? int(bucket.openSeatsCount) : "—",
          openSeatsCount: showSeats ? bucket.openSeatsCount : 0,
        };
      })
      .sort((a, b) => b.backlogValue - a.backlogValue || b.peopleCount - a.peopleCount || a.label.localeCompare(b.label));
  }

  const divRows  = makeSRows("division", recordsOk, demandsOk);
  const buRows   = makeSRows("businessUnit", recordsOk, demandsOk);
  const deptRows = makeSRows("department", recordsOk, demandsOk);

  const hasGroup = (rows: SRow[]) => rows.filter(r => r.label !== "Unassigned").length > 1;
  const scoreTabs: { key: "div" | "bu" | "dep"; label: string; count: number; rows: SRow[] }[] = [
    ...(hasGroup(divRows)  ? [{ key: "div" as const,  label: "Division",      count: divRows.filter(r  => r.label !== "Unassigned").length, rows: divRows  }] : []),
    ...(hasGroup(buRows)   ? [{ key: "bu"  as const,  label: "Business Unit", count: buRows.filter(r   => r.label !== "Unassigned").length, rows: buRows   }] : []),
    ...(hasGroup(deptRows) ? [{ key: "dep" as const,  label: "Department",    count: deptRows.filter(r => r.label !== "Unassigned").length, rows: deptRows }] : []),
  ];

  return {
    recordsOk, staffingOk,
    hero: {
      value: fmtMoney(m.backlogValue),
      explain: `Total value of ${int(m.activeProjects)} approved, active contracts.`,
      card: portfolioCard,
    },
    winRate: {
      pct: m.winRate,
      card: decidedCard,
      caption: m.winRate != null
        ? `${int(m.wonCount)} of ${int(m.wonCount + m.lostCount)} decided bids won`
        : "no decided bids on record yet",
    },
    onTime: {
      pct: m.onTimeRate,
      card: scheduleCard,
      caption: m.onTimeRate != null
        ? `${int(m.onScheduleCount)} of ${int(m.onScheduleCount + m.overdueCount)} dated projects on time`
        : "no dated projects to measure yet",
    },
    kpis: [
      { label: "Open pipeline", value: fmtMoney(m.pipelineValue), card: pipelineCard },
      { label: "Weighted pipeline", value: fmtMoney(m.weightedPipeline), card: pipelineCard },
      { label: "Active bids", value: int(m.activeBids), card: pipelineCard },
      { label: "Avg project value", value: fmtMoney(m.avgProjectValue), card: portfolioCard },
    ],
    funnel: funnelRows.length > 0 ? {
      rows: funnelRows,
      drillCards: funnelDrillCards,
      card: {
        id: "executive",
        title: "Executive — Lifecycle Funnel",
        takeaway: "How much work sits at each stage of the lifecycle right now.",
        stats: funnelRows.map(f => ({ label: f.label, value: `${int(f.count)} · ${fmtMoney(f.value)}`, filterKey: "label" })),
        columns: [
          { key: "label", label: "Stage", width: 22 },
          { key: "count", label: "Records", kind: "int", align: "right", width: 12 },
          { key: "value", label: "Value", kind: "money", align: "right", width: 15 },
        ],
        rows: funnelRows.map(f => ({ ...f })),
      },
    } : null,
    conversion: {
      leadRate: m.conversion.leadConversionRate,
      leadText: m.conversion.leadConversionRate != null
        ? `${int(m.conversion.leadsConverted)} of ${int(m.conversion.leadsTotal)} leads became pursuits`
        : "No leads on record yet.",
      oppRate: m.conversion.oppConversionRate,
      oppText: m.conversion.oppConversionRate != null
        ? `${int(m.conversion.oppsConverted)} of ${int(m.conversion.oppsTotal)} pursuits became projects`
        : "No pursuits on record yet.",
      leadCard: m.conversion.convertedLeads.length > 0 ? {
        id: "executive",
        title: "Executive — Leads That Became Pursuits",
        takeaway: "Every lead that converted into an opportunity.",
        stats: [
          { label: "Converted", value: int(m.conversion.leadsConverted) },
          { label: "Value", value: fmtMoney(m.conversion.leadsConvertedValue) },
        ],
        columns: [
          { key: "id", label: "ID", width: 15 },
          { key: "name", label: "Lead", width: 38 },
          { key: "client", label: "Client", width: 24 },
          { key: "status", label: "Status", width: 18 },
          { key: "value", label: "Value", kind: "money", align: "right", width: 13 },
        ],
        rows: m.conversion.convertedLeads.map(l => ({ ...l, client: l.client ?? "—", _ticket: l.id })),
      } : null,
      oppCard: m.conversion.convertedOpps.length > 0 ? {
        id: "executive",
        title: "Executive — Pursuits That Became Projects",
        takeaway: "Every opportunity that converted into delivery work.",
        stats: [
          { label: "Converted", value: int(m.conversion.oppsConverted) },
          { label: "Value", value: fmtMoney(m.conversion.oppsConvertedValue) },
        ],
        columns: OPP_COLS,
        rows: oppRows(m.conversion.convertedOpps),
      } : null,
    },
    statusSegments: statuses.length > 0 ? {
      total: Math.max(1, m.projects.length),
      segments: statuses.slice(0, 6).map((s, i) => ({ label: s.label, v: s.v, color: STATUS_COLORS[i % STATUS_COLORS.length] })),
      card: {
        id: "executive",
        title: "Executive — Projects by Status",
        takeaway: "Every active project grouped by its current status.",
        stats: statuses.slice(0, 4).map(s => ({ label: s.label, value: int(s.v), filterKey: "status" })),
        columns: PROJECT_COLS,
        rows: projRows(m.projects),
      },
    } : null,
    backlogByDivision: (m.backlogByDivision ?? []).length > 0 ? {
      rows: m.backlogByDivision.slice(0, 10),
      card: {
        id: "executive",
        title: "Executive — Backlog by Division",
        takeaway: "Which parts of the firm hold the signed work.",
        stats: m.backlogByDivision.slice(0, 4).map(d => ({ label: d.label, value: fmtMoney(d.value), filterKey: "label" })),
        columns: SUMMARY_COLS,
        rows: namedRows(m.backlogByDivision),
      },
    } : null,
    divisionScore: scoreTabs.length > 0 ? {
      tabs: scoreTabs,
      card: {
        id: "executive",
        title: "Executive — Org Scorecard",
        takeaway: "Backlog, headcount and open seats by org group.",
        stats: [],
        columns: [
          { key: "label", label: "Group", width: 26 },
          { key: "backlog", label: "Backlog", align: "right", width: 14 },
          { key: "people", label: "People", align: "right", width: 10 },
          { key: "openSeats", label: "Open Seats", align: "right", width: 12 },
        ],
        rows: scoreTabs[0].rows.map(r => ({ ...r })),
      },
    } : null,
    clients: (m.clientConcentration ?? []).length > 0 ? {
      rows: m.clientConcentration,
      drillCards: clientDrillCards,
      card: {
        id: "executive",
        title: "Executive — Client Concentration",
        takeaway: "How much of the backlog depends on each client.",
        stats: m.clientConcentration.slice(0, 3).map(c => ({ label: c.label, value: `${fmtMoney(c.value)} · ${Math.round(c.share)}%`, filterKey: "label" })),
        columns: CLIENT_COLS,
        rows: m.clientConcentration.map(c => ({ label: c.label, count: c.count, value: c.value, share: Math.round(c.share) })),
      },
    } : null,
  };
}

/* ═══════════════════ PIPELINE ═══════════════════ */
export const STAGE_COLS: CardColumn[] = [
  { key: "label", label: "Stage", width: 26 },
  { key: "count", label: "Bids", kind: "int", align: "right", width: 10 },
  { key: "value", label: "Value", kind: "money", align: "right", width: 15 },
];
export const LEAD_COLS: CardColumn[] = [
  { key: "id", label: "ID", width: 15 },
  { key: "name", label: "Lead", width: 38 },
  { key: "client", label: "Client", width: 24 },
  { key: "sector", label: "Sector", width: 18 },
  { key: "status", label: "Status", width: 16 },
  { key: "value", label: "Est. Value", kind: "money", align: "right", width: 13 },
];

export type PipelineSection = {
  recordsOk: boolean;
  /** headline: open pipeline value */
  hero: { value: string; explain: string; card: CardModel | null };
  /** win-rate arc gauge (null = no decided bids yet) */
  winRate: { pct: number | null; caption: string; card: CardModel | null };
  /** KPI band */
  kpis: { label: string; value: string; card: CardModel | null }[];
  /** active bids by stage — where the open pipeline sits */
  byStage: { rows: NamedValue[]; card: CardModel } | null;
  /** decided-bid outcomes per sector */
  winLoss: { rows: SectorWinLoss[]; card: CardModel | null } | null;
  /** biggest open pursuits (value, probability, bid date) */
  topPursuits: { rows: OppRow[]; card: CardModel } | null;
  /** early-stage lead book */
  leads: { rows: LeadRow[]; card: CardModel } | null;
  /** lead book grouped by current status */
  leadsByStatus: { rows: { label: string; v: number }[]; card: CardModel } | null;
  /** lead book grouped by sector */
  leadsBySector: { rows: { label: string; v: number }[]; card: CardModel } | null;
  /** open pipeline value by the selected org dimension */
  byOrg: { dim: OrgDim; rows: OrgGroup[]; card: CardModel } | null;
  /** longest-running open bids (REAL created dates, oldest first) */
  oldestBids: { rows: { opp: OppRow; days: number }[]; card: CardModel } | null;
  /** closed pursuits neither won nor lost — cancelled / on hold / dead */
  inactive: { count: number; card: CardModel } | null;
};

export function buildPipelineSection(m: ReportModel, orgDim: OrgDim = "division"): PipelineSection {
  const recordsOk = m.sources ? m.sources.records : true;
  if (!recordsOk) {
    return {
      recordsOk,
      hero: {
        value: "—",
        explain: "Pipeline records didn't load, so no headline number is shown. Refresh to try again.",
        card: null,
      },
      winRate: { pct: null, caption: "of decided bids won", card: null },
      kpis: [],
      byStage: null, winLoss: null, topPursuits: null, leads: null,
      leadsByStatus: null, leadsBySector: null, byOrg: null,
      oldestBids: null, inactive: null,
    };
  }

  const pipelineCard: CardModel = {
    id: "pipeline",
    title: "Pipeline — Every Open Pursuit",
    takeaway: "Every pursuit still in play with stage, win probability and bid date — largest first.",
    stats: [
      { label: "Pipeline", value: fmtMoney(m.pipelineValue) },
      { label: "Weighted", value: fmtMoney(m.weightedPipeline) },
      { label: "Active bids", value: int(m.activeBids) },
    ],
    columns: OPP_COLS,
    rows: oppRows(m.opps),
  };
  const decidedCard: CardModel | null = m.decidedOpps.length > 0 ? {
    id: "pipeline",
    title: "Pipeline — Decided Bids",
    takeaway: "Every bid that has been won or lost — the rows behind the win/loss picture.",
    stats: [
      { label: "Won", value: `${int(m.wonCount)} (${fmtMoney(m.wonValue)})`, filterKey: "result" },
      { label: "Lost", value: `${int(m.lostCount)} (${fmtMoney(m.lostValue)})`, filterKey: "result" },
      ...(m.winRate != null ? [{ label: "Win rate", value: `${m.winRate}%` }] : []),
    ],
    columns: DECIDED_COLS,
    rows: decidedRows(m.decidedOpps),
  } : null;
  /* Always built — a real zero still drills to the (empty) lead book,
   * so every visible figure keeps its DataDrawer/export contract. */
  const leadsCard: CardModel = {
    id: "pipeline",
    title: "Pipeline — Early-Stage Lead Book",
    takeaway: "Every lead on record before it becomes a formal pursuit.",
    stats: [
      { label: "Leads", value: int(m.leadCount) },
      { label: "Est. value", value: fmtMoney(m.leadValue) },
    ],
    columns: LEAD_COLS,
    rows: m.leads.map(l => ({ ...l, client: l.client ?? "—", _ticket: l.id })),
  };

  const stages = (m.opmByStage ?? []).filter(s => s.count > 0 || s.value > 0);
  const wl = (m.winLossBySector ?? []).filter(r => r.won > 0 || r.lost > 0);
  const avgBid = m.activeBids > 0 ? m.pipelineValue / m.activeBids : 0;

  /* lead-book groupings (current status/sector — the only lead facts stored) */
  const leadsByStatus = countBy(m.leads, l => l.status);
  const leadsBySector = countBy(m.leads, l => l.sector);

  /* open pipeline value by the selected org dimension (pursuits without a
   * value for that dimension are not shown — canonical field only, never a
   * cross-dimension fallback) */
  const orgRows = sumByOrg(m.opps, orgDim, o => o.value);

  /* longest-running open bids — from the REAL Created timestamp */
  const nowMs = Date.now();
  const oldest = m.opps
    .filter(o => o.created)
    .map(o => ({ opp: o, days: Math.max(0, Math.floor((nowMs - new Date(o.created as string).getTime()) / 86_400_000)) }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 10);
  const oldestCard: CardModel | null = oldest.length > 0 ? {
    id: "pipeline",
    title: "Pipeline — Longest-Running Open Bids",
    takeaway: "Open pursuits that have been in play the longest, from their recorded creation date.",
    stats: [{ label: "Oldest bid", value: `${int(oldest[0].days)} days` }],
    columns: [
      { key: "id", label: "ID", width: 15 },
      { key: "name", label: "Pursuit", width: 36 },
      { key: "client", label: "Client", width: 24 },
      { key: "stage", label: "Stage", width: 20 },
      { key: "days", label: "Days in Play", kind: "int", align: "right", width: 12 },
      { key: "value", label: "Value", kind: "money", align: "right", width: 13 },
    ],
    rows: oldest.map(({ opp, days }) => ({
      id: opp.id, name: opp.name, client: opp.client ?? "—", stage: opp.stage,
      days, value: opp.value, _ticket: opp.id,
    })),
  } : null;

  /* cancelled / on hold / dead — closed but neither won nor lost.
   * Only computable when the model carries the full record set (allOpps);
   * legacy models without it can't know these rows, so the block/KPI stay
   * hidden rather than showing a fabricated zero. */
  const inactiveList = m.allOpps
    ? m.allOpps.filter(o => o.closed && !o.won && !o.stage.toLowerCase().includes("lost"))
    : [];
  const inactiveCard: CardModel | null = inactiveList.length > 0 ? {
    id: "pipeline",
    title: "Pipeline — Cancelled / On Hold / Dead Pursuits",
    takeaway: "Closed pursuits that were neither won nor lost — they don't count toward the win rate.",
    stats: [{ label: "Records", value: int(inactiveList.length) }],
    columns: OPP_COLS,
    rows: oppRows(inactiveList),
  } : null;

  return {
    recordsOk,
    hero: {
      value: fmtMoney(m.pipelineValue),
      explain: `Total value of ${int(m.activeBids)} open pursuit${m.activeBids === 1 ? "" : "s"} still in play.`,
      card: pipelineCard,
    },
    winRate: {
      pct: m.winRate,
      caption: m.winRate != null
        ? `${int(m.wonCount)} of ${int(m.wonCount + m.lostCount)} decided bids won`
        : "no decided bids on record yet",
      card: decidedCard,
    },
    kpis: [
      { label: "Weighted pipeline", value: fmtMoney(m.weightedPipeline), card: pipelineCard },
      { label: "Active bids", value: int(m.activeBids), card: pipelineCard },
      { label: "Avg bid size", value: m.activeBids > 0 ? fmtMoney(avgBid) : "—", card: pipelineCard },
      { label: "Early-stage leads", value: int(m.leadCount), card: leadsCard },
      ...(inactiveList.length > 0
        ? [{ label: "Cancelled / on hold", value: int(inactiveList.length), card: inactiveCard }]
        : []),
    ],
    byStage: stages.length > 0 ? {
      rows: stages,
      card: {
        id: "pipeline",
        title: "Pipeline — Active Bids by Stage",
        takeaway: "Where the open pipeline sits today, stage by stage.",
        stats: stages.slice(0, 4).map(s => ({ label: s.label, value: `${int(s.count)} · ${fmtMoney(s.value)}`, filterKey: "label" })),
        columns: STAGE_COLS,
        rows: stages.map(s => ({ ...s })),
      },
    } : null,
    winLoss: wl.length > 0 ? { rows: wl, card: decidedCard } : null,
    topPursuits: m.opps.length > 0 ? { rows: m.opps, card: pipelineCard } : null,
    leads: m.leads.length > 0 ? {
      rows: [...m.leads].sort((a, b) => b.value - a.value),
      card: leadsCard,
    } : null,
    leadsByStatus: leadsByStatus.length > 0 ? { rows: leadsByStatus, card: leadsCard } : null,
    leadsBySector: leadsBySector.length > 0 ? { rows: leadsBySector, card: leadsCard } : null,
    byOrg: orgRows.length > 0 ? { dim: orgDim, rows: orgRows, card: pipelineCard } : null,
    oldestBids: oldest.length > 0 && oldestCard ? { rows: oldest, card: oldestCard } : null,
    inactive: inactiveList.length > 0 && inactiveCard ? { count: inactiveList.length, card: inactiveCard } : null,
  };
}

/* ═══════════════════ LEADS ═══════════════════ */
export type LeadSection = {
  recordsOk: boolean;
  count: number;
  totalValue: number;
  /** drill-through card holding all lead rows */
  allCard: CardModel;
  byStatus: { rows: { label: string; v: number }[] } | null;
  bySector: { rows: { label: string; v: number }[] } | null;
  byOrg: { dim: OrgDim; rows: OrgGroup[] } | null;
  byCity: { rows: { label: string; v: number }[] } | null;
  largest: LeadRow[] | null;
};

export type AnalyticsSectionScope<T> = {
  rows: T[];
  /** Human-readable period label used by drawer/export titles. */
  label: string;
};

export function buildLeadSection(
  m: ReportModel,
  orgDim: OrgDim = "division",
  scope?: AnalyticsSectionScope<LeadRow>,
): LeadSection {
  const recordsOk = m.sources ? m.sources.records : true;
  const leads = scope?.rows ?? m.leads;
  const leadValue = leads.reduce((sum, lead) => sum + lead.value, 0);
  const allCard: CardModel = {
    id: "pipeline" as const,
    title: scope ? `Leads — ${scope.label}` : "Leads — All Records",
    takeaway: scope
      ? `Leads created during ${scope.label} — status, sector and estimated value.`
      : "Every lead on record — status, sector and estimated value.",
    stats: [
      { label: scope ? "Leads in period" : "Total leads", value: int(leads.length) },
      { label: "Est. value", value: fmtMoney(leadValue) },
    ],
    columns: LEAD_COLS,
    rows: leads.map(l => ({ ...l, client: l.client ?? "—", _ticket: l.id })),
  };
  if (!recordsOk) return { recordsOk, count: leads.length, totalValue: leadValue, allCard, byStatus: null, bySector: null, byOrg: null, byCity: null, largest: null };
  return {
    recordsOk,
    count: leads.length,
    totalValue: leadValue,
    allCard,
    byStatus: leads.length > 0 ? { rows: countBy(leads, l => l.status) } : null,
    bySector: leads.length > 0 ? { rows: sumBy(leads, l => l.sector, l => l.value) } : null,
    byOrg: leads.some(l => orgValueOf(l, orgDim)) ? { dim: orgDim, rows: sumByOrg(leads, orgDim, l => l.value) } : null,
    byCity: leads.some(l => l.city) ? { rows: sumBy(leads.filter(l => l.city), l => l.city!, l => l.value) } : null,
    largest: leads.length > 0 ? [...leads].sort((a, b) => b.value - a.value).slice(0, 10) : null,
  };
}

/* ═══════════════════ OPPORTUNITIES ═══════════════════ */
export type OppSection = {
  recordsOk: boolean;
  pipelineValue: number;
  activeBids: number;
  weightedPipeline: number;
  /** drill-through card holding all active-opp rows */
  allCard: CardModel;
  /** byStage: v = pipeline value for that stage; count = number of bids */
  byStage: { rows: { label: string; v: number; count: number }[] } | null;
  byOrg: { dim: OrgDim; rows: OrgGroup[] } | null;
  bySector: { rows: { label: string; v: number }[] } | null;
  byCity: { rows: { label: string; v: number }[] } | null;
  largest: OppRow[] | null;
  bidsSoon: { rows: OppRow[]; card: CardModel } | null;
};

export function buildOppSection(
  m: ReportModel,
  now = new Date(),
  orgDim: OrgDim = "division",
  scope?: AnalyticsSectionScope<OppRow>,
): OppSection {
  const recordsOk = m.sources ? m.sources.records : true;
  const opps = scope?.rows ?? m.opps;
  const pipelineValue = opps.reduce((sum, opp) => sum + opp.value, 0);
  const weightedPipeline = opps.reduce((sum, opp) => sum + opp.weighted, 0);
  const activeBids = opps.length;
  const allCard: CardModel = {
    id: "pipeline" as const,
    title: scope ? `Opportunities — ${scope.label}` : "Opportunities — All Active Pursuits",
    takeaway: scope
      ? `Open pursuits created during ${scope.label}, with stage, win probability and bid date.`
      : "Every open pursuit with stage, win probability and bid date — largest first.",
    stats: [
      { label: "Pipeline", value: fmtMoney(pipelineValue) },
      { label: "Weighted", value: fmtMoney(weightedPipeline) },
      { label: scope ? "Open bids in period" : "Active bids", value: int(activeBids) },
    ],
    columns: OPP_COLS,
    rows: oppRows(opps),
  };
  if (!recordsOk) return { recordsOk, pipelineValue, activeBids, weightedPipeline, allCard, byStage: null, byOrg: null, bySector: null, byCity: null, largest: null, bidsSoon: null };

  const horizon = new Date(now.getTime() + 90 * 86_400_000);
  const bidsInWindow = opps
    .filter(o => o.bidDate && new Date(o.bidDate) >= now && new Date(o.bidDate) <= horizon)
    .sort((a, b) => String(a.bidDate).localeCompare(String(b.bidDate)));
  const bidsSoonCard: CardModel | null = bidsInWindow.length > 0 ? {
    id: "pipeline" as const,
    title: "Opportunities — Bids Due in 90 Days",
    takeaway: "Open pursuits with a bid date in the next 90 days — closest first.",
    stats: [
      { label: "Bids in window", value: int(bidsInWindow.length) },
      { label: "Total at stake", value: fmtMoney(bidsInWindow.reduce((a, o) => a + o.value, 0)) },
    ],
    columns: OPP_COLS,
    rows: oppRows(bidsInWindow),
  } : null;

  const stageCounts = new Map(countBy(opps, o => o.stage).map(stage => [stage.label, stage.v]));
  const stages = sumBy(opps, o => o.stage, o => o.value)
    .map(stage => ({ label: stage.label, v: stage.v, count: stageCounts.get(stage.label) ?? 0 }))
    .filter(stage => stage.count > 0 || stage.v > 0);

  return {
    recordsOk,
    pipelineValue,
    activeBids,
    weightedPipeline,
    allCard,
    byStage: stages.length > 0 ? { rows: stages } : null,
    byOrg: opps.some(o => orgValueOf(o, orgDim)) ? { dim: orgDim, rows: sumByOrg(opps, orgDim, o => o.value) } : null,
    bySector: opps.length > 0 ? { rows: sumBy(opps, o => o.sector, o => o.value) } : null,
    byCity: opps.some(o => o.city) ? { rows: sumBy(opps.filter(o => o.city), o => o.city!, o => o.value) } : null,
    largest: opps.length > 0 ? [...opps].sort((a, b) => b.value - a.value).slice(0, 10) : null,
    bidsSoon: bidsInWindow.length > 0 && bidsSoonCard ? { rows: bidsInWindow, card: bidsSoonCard } : null,
  };
}

/* ═══════════════════ PROJECT ═══════════════════ */
export type ProjectSection = {
  recordsOk: boolean;
  /** schedule-health gauge + plain sentence */
  health: { pct: number | null; sentence: string; card: CardModel | null };
  /** ranked status list */
  statuses: { rows: { label: string; v: number }[]; card: CardModel } | null;
  /** value by sector — the one recharts chart */
  bySector: { rows: NamedValue[]; card: CardModel } | null;
  /** org-unit value list (MiniBars) for the selected dimension */
  byOrg: { dim: OrgDim; rows: (OrgGroup & { value: number; count: number })[]; card: CardModel } | null;
  /** overdue table */
  overdue: { rows: ProjectRow[]; card: CardModel } | null;
  /** ending in the next 90 days */
  endingSoon: { rows: ProjectRow[]; card: CardModel } | null;
  /** project size mix */
  valueRanges: { rows: { label: string; count: number }[]; card: CardModel } | null;
  /** geographic exposure — active contract value by city / market */
  byCity: { rows: NamedValue[]; card: CardModel } | null;
  /** largest active engagements — top projects by contract value */
  largest: { rows: ProjectRow[]; card: CardModel } | null;
};

export function buildProjectSection(
  m: ReportModel,
  now = new Date(),
  orgDim: OrgDim = "division",
  scope?: AnalyticsSectionScope<ProjectRow>,
): ProjectSection {
  const recordsOk = m.sources ? m.sources.records : true;
  if (!recordsOk) {
    return {
      recordsOk,
      health: {
        pct: null,
        sentence: "Project records didn't load, so schedule health can't be measured right now. Refresh to try again.",
        card: null,
      },
      statuses: null, bySector: null, byOrg: null,
      overdue: null, endingSoon: null, valueRanges: null,
      byCity: null, largest: null,
    };
  }

  const projects = scope?.rows ?? m.projects;
  const overdueCount = projects.filter(project => project.overdue).length;
  const noDateCount = projects.filter(project => project.noDate).length;
  const onScheduleCount = projects.length - overdueCount - noDateCount;
  const dated = onScheduleCount + overdueCount;
  const onTimeRate = dated > 0 ? Math.round((onScheduleCount / dated) * 100) : null;
  const sentence = onTimeRate == null
    ? `None of the ${int(projects.length)} selected active projects has a planned end date yet, so schedule health can't be measured.`
    : overdueCount === 0
      ? `All ${int(dated)} dated projects are on schedule.${noDateCount > 0 ? ` ${int(noDateCount)} more have no end date set.` : ""}`
      : `${int(overdueCount)} of ${int(dated)} dated projects ${overdueCount === 1 ? "is" : "are"} past the planned end date.${noDateCount > 0 ? ` ${int(noDateCount)} more have no end date set.` : ""}`;

  const scheduleCard: CardModel = {
    id: "project",
    title: scope ? `Project — Schedule Health (${scope.label})` : "Project — Schedule Health",
    takeaway: scope
      ? `Schedule standing for active projects created during ${scope.label}.`
      : "Where every active project stands against its planned end date.",
    stats: [
      { label: "On schedule", value: int(onScheduleCount), filterKey: "scheduleGroup" },
      { label: "Overdue", value: int(overdueCount), filterKey: "scheduleGroup" },
      { label: "No end date", value: int(noDateCount), filterKey: "scheduleGroup" },
      ...(onTimeRate != null ? [{ label: "On-time rate", value: `${onTimeRate}%` }] : []),
    ],
    columns: SCHEDULE_COLS,
    rows: scheduleRows([...projects].sort((a, b) => Number(b.overdue) - Number(a.overdue) || (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0))),
  };

  const statuses = countBy(projects, p => p.status);
  const overdueList = projects
    .filter(p => p.overdue)
    .sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0));

  const horizon = new Date(now.getTime() + 90 * 86400000);
  const endingSoonList = projects
    .filter(p => !p.overdue && p.targetEnd && new Date(p.targetEnd) >= now && new Date(p.targetEnd) <= horizon)
    .sort((a, b) => String(a.targetEnd).localeCompare(String(b.targetEnd)));

  const ranges = [
    { label: "<$1M", count: projects.filter(project => project.value < 1e6).length },
    { label: "$1–5M", count: projects.filter(project => project.value >= 1e6 && project.value < 5e6).length },
    { label: "$5–15M", count: projects.filter(project => project.value >= 5e6 && project.value < 15e6).length },
    { label: "$15–50M", count: projects.filter(project => project.value >= 15e6 && project.value < 50e6).length },
    { label: "$50M+", count: projects.filter(project => project.value >= 50e6).length },
  ].filter(range => range.count > 0);
  const sectorCounts = new Map(countBy(projects, project => project.sector).map(group => [group.label, group.v]));
  const sectors: NamedValue[] = sumBy(projects, project => project.sector, project => project.value)
    .map(group => ({ label: group.label, value: group.v, count: sectorCounts.get(group.label) ?? 0 }))
    .slice(0, 10);
  const cityProjects = projects.filter(project => project.city);
  const cityCounts = new Map(countBy(cityProjects, project => project.city!).map(group => [group.label, group.v]));
  const cities: NamedValue[] = sumBy(cityProjects, project => project.city!, project => project.value)
    .map(group => ({ label: group.label, value: group.v, count: cityCounts.get(group.label) ?? 0 }));
  const largestProjects = [...projects].sort((a, b) => b.value - a.value).slice(0, 10);
  /* Value by the selected org dimension — computed from the project rows'
   * canonical field so every dimension groups the same way (top 8, like the
   * model's backlogBy* maps). */
  const orgCounts = new Map(countByOrg(projects, orgDim).map(group => [group.key, group.v]));
  const orgUnits = sumByOrg(projects, orgDim, p => p.value)
    .map(group => ({ ...group, value: group.v, count: orgCounts.get(group.key) ?? 0 }))
    .slice(0, 8);

  /* Contract-size range thresholds — mirrors the bands in reportData.ts so
   * filtering by range label opens the correct project subset. */
  const VALUE_RANGE_THRESHOLDS = [
    { label: "<$1M",    min: 0,     max: 1e6    },
    { label: "$1–5M",   min: 1e6,   max: 5e6    },
    { label: "$5–15M",  min: 5e6,   max: 15e6   },
    { label: "$15–50M", min: 15e6,  max: 50e6   },
    { label: "$50M+",   min: 50e6,  max: Infinity },
  ];
  const contractSizeRangeOf = (value: number): string => {
    for (const r of VALUE_RANGE_THRESHOLDS) {
      if (value >= r.min && value < r.max) return r.label;
    }
    return "$50M+";
  };

  return {
    recordsOk,
    health: { pct: onTimeRate, sentence, card: scheduleCard },
    statuses: statuses.length > 0 ? {
      rows: statuses,
      card: {
        id: "project",
        title: "Project — By Status",
        takeaway: "Every active project grouped by its current status.",
        stats: statuses.slice(0, 4).map(s => ({ label: s.label, value: int(s.v), filterKey: "status" })),
        columns: PROJECT_COLS,
        rows: projRows(projects),
      },
    } : null,
    bySector: sectors.length > 0 ? {
      rows: sectors,
      card: {
        id: "project",
        title: "Project — Value by Sector",
        takeaway: "Which markets the active work serves.",
        stats: sectors.slice(0, 4).map(s => ({ label: s.label, value: fmtMoney(s.value), filterKey: "label" })),
        columns: SUMMARY_COLS,
        rows: namedRows(sectors),
      },
    } : null,
    byOrg: orgUnits.length > 0 ? {
      dim: orgDim,
      rows: orgUnits,
      card: {
        id: "project",
        title: `Project — Value by ${orgDimLabel(orgDim)}`,
        takeaway: "How the active portfolio spreads across the firm.",
        stats: orgUnits.slice(0, 4).map(d => ({ label: d.label, value: fmtMoney(d.value), filterKey: orgDim })),
        columns: PROJECT_COLS,
        rows: projRows(projects),
      },
    } : null,
    overdue: overdueList.length > 0 ? {
      rows: overdueList,
      card: {
        id: "project",
        title: "Project — Overdue Projects",
        takeaway: "Projects past their planned end date, most overdue first.",
        stats: [
          { label: "Overdue", value: int(overdueList.length) },
          { label: "Value at risk", value: fmtMoney(overdueList.reduce((a, p) => a + p.value, 0)) },
        ],
        columns: OVERDUE_COLS,
        rows: overdueList.map(p => ({ ...p, client: p.client ?? "—", division: p.division ?? "—", _ticket: p.id })),
      },
    } : null,
    endingSoon: endingSoonList.length > 0 ? {
      rows: endingSoonList,
      card: {
        id: "project",
        title: "Project — Ending Within 90 Days",
        takeaway: "Projects whose planned end date falls in the next 90 days — the wind-down pipeline.",
        stats: [
          { label: "Ending soon", value: int(endingSoonList.length) },
          { label: "Value winding down", value: fmtMoney(endingSoonList.reduce((a, p) => a + p.value, 0)) },
        ],
        columns: SCHEDULE_COLS,
        rows: scheduleRows(endingSoonList),
      },
    } : null,
    valueRanges: ranges.length > 0 ? {
      rows: ranges,
      card: {
        id: "project",
        title: "Project — By Contract Size",
        takeaway: "How many projects fall in each value range. Click a bar to see those projects.",
        stats: ranges.map(r => ({ label: r.label, value: int(r.count), filterKey: "contractSizeRange" })),
        columns: [
          ...PROJECT_COLS,
          { key: "contractSizeRange", label: "Size Range", width: 12 },
        ],
        /* Each project row carries its range label so filterCardByField can
         * filter by "contractSizeRange" when a bar is clicked. */
        rows: projRows(projects).map(r => ({
          ...r,
          contractSizeRange: contractSizeRangeOf(Number(r.value ?? 0)),
        })),
      },
    } : null,
    byCity: cities.length > 0 ? {
      rows: cities,
      card: {
        id: "project",
        title: "Project — Value by City",
        takeaway: "Geographic exposure — where the active contract value sits by city / market.",
        stats: cities.slice(0, 4).map(c => ({ label: c.label, value: fmtMoney(c.value), filterKey: "label" })),
        columns: SUMMARY_COLS,
        rows: namedRows(cities),
      },
    } : null,
    largest: largestProjects.length > 0 ? {
      rows: largestProjects,
      card: {
        id: "project",
        title: "Project — Largest Active Engagements",
        takeaway: "Top active projects by contract value — the work the firm depends on most.",
        stats: [
          { label: "Top 10 value", value: fmtMoney(largestProjects.reduce((a, p) => a + p.value, 0)) },
          ...(projects.reduce((sum, project) => sum + project.value, 0) > 0 ? [{
            label: "Share of backlog",
            value: `${Math.round((largestProjects.reduce((a, p) => a + p.value, 0) / projects.reduce((sum, project) => sum + project.value, 0)) * 100)}%`,
          }] : []),
        ],
        columns: PROJECT_COLS,
        rows: projRows(projects),
      },
    } : null,
  };
}

/* ═══════════════════ FINANCIAL ═══════════════════ */
export const FIN_BASIS_LABELS: Record<FinBasisKey, string> = {
  all: "Overall",
  t12m: "Trailing 12 months",
  fytd: "Year to date",
  runrate: "Run rate",
};
export const FIN_BASIS_NOTES: Record<FinBasisKey, string> = {
  all: "Every planned hour and dollar on record — past and future plans included.",
  t12m: "Planned hours and dollars over the last 12 months.",
  fytd: "January 1 to today, annualized. Uses the calendar year — if your fiscal year starts on a different month, read this as calendar-year-to-date.",
  runrate: "The last 13 weeks scaled to a full year — what the year looks like if the current pace holds.",
};

export type FinBasisView = {
  key: FinBasisKey;
  label: string;
  note: string;
  windowText: string;
  b: FinBasis;
  /** allocated ÷ contracted (planned) hours, 0–100, null when no plan */
  coveragePct: number | null;
  /** job ÷ (job + non-job) chargeable cost, null when no cost */
  chargeableSharePct: number | null;
  unratedNote: string | null;
  /** Human-readable explanation of the overall planned basis and data completeness */
  explanationNote: string;
  hoursCard: CardModel;
  monthlyCard: CardModel;
  /** One exact project-level audit card per month chart point. */
  monthlyDetailCards: Record<string, CardModel>;
  divisionCard: CardModel | null;
  buCard: CardModel | null;
  /** Department grouping — server-aggregated (person-level departments);
   *  null when the payload predates byDepartment (honest absence). */
  departmentCard: CardModel | null;
  /** Reconciliation card — per-project rows each with nested person/allocation _subCard */
  reconCard: CardModel;
  /** Client billing card (used by Total Allocated Labor Amount KPI) */
  clientBillingCard: CardModel;
  /** Job cost card (used by Job Chargeable Cost KPI) */
  jobCostCard: CardModel;
  /** Non-job (NC) cost card (used by Non-Job Chargeable Cost KPI) */
  ncCostCard: CardModel;
  /** Total internal cost card (job + NC) */
  totalCostCard: CardModel;
};

export type FinancialSection = {
  recordsOk: boolean;
  /** contract-money cards straight from the ReportModel (same as hub tile) */
  backlog: { value: number; card: CardModel } | null;
  contractedLabor: { value: number; card: CardModel } | null;
  /** server-computed planned labor economics */
  fin:
    | { state: "ok"; stale: boolean; generatedAt: string; workWeekHours: number; bases: Record<FinBasisKey, FinBasisView> }
    | { state: "unavailable"; restricted: boolean; reason: string }
    | { state: "error" };
};

const monthLabel = (ym: string): string => {
  const [y, mo] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, (mo || 1) - 1, 1)).toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
};

export function buildFinancialSection(m: ReportModel | null, fin: FinancialAnalytics | null): FinancialSection {
  const recordsOk = m ? (m.sources ? m.sources.records : true) : false;

  const backlog = m && recordsOk ? {
    value: m.backlogValue,
    card: {
      id: "financial" as const,
      title: "Financial — Portfolio Value",
      takeaway: "Contract value, labor contract and forecast cost per active project.",
      stats: [
        { label: "Portfolio value", value: fmtMoney(m.backlogValue) },
        { label: "Active projects", value: int(m.activeProjects) },
      ],
      columns: FINANCIAL_COLS,
      rows: projRows(m.projects),
    },
  } : null;

  const contractedLabor = m && recordsOk ? {
    value: m.totalForecastCost,
    card: {
      id: "financial" as const,
      title: "Financial — Contracted Labor Dollars",
      takeaway: "Labor contract amounts across active projects — the same number as the hub's Financial tile.",
      stats: [
        { label: "Contracted labor", value: fmtMoney(m.totalForecastCost) },
        { label: "Active projects", value: int(m.activeProjects) },
      ],
      columns: FINANCIAL_COLS,
      rows: projRows(m.projects),
    },
  } : null;

  let finState: FinancialSection["fin"];
  if (!fin) {
    finState = { state: "error" };
  } else if (!fin.available) {
    finState = { state: "unavailable", restricted: fin.restricted === true, reason: fin.reason };
  } else {
    /* decorate project tickets with names/divisions/BUs/departments from the ReportModel */
    const nameByTicket = new Map<string, { name: string; division: string | null; businessUnit: string | null; department: string | null }>();
    if (m) {
      for (const p of [...m.projects, ...m.closedProjects]) nameByTicket.set(p.id, { name: p.name, division: p.division, businessUnit: p.businessUnit ?? null, department: p.department ?? null });
      for (const o of [...m.opps, ...m.decidedOpps]) if (!nameByTicket.has(o.id)) nameByTicket.set(o.id, { name: o.name, division: o.division, businessUnit: o.businessUnit ?? null, department: o.department ?? null });
    }
    // Reconciliation rows carry ResourceUser GUIDs by design. Resolve the
    // visible label from the same tenant-scoped staff roster used by the
    // report model, while retaining the GUID in a hidden field for the
    // exact-profile navigation link.
    const personNameById = new Map<string, string>();
    for (const person of m?.staff ?? []) {
      const id = String(person.id ?? "").trim().toLowerCase();
      const name = String(person.name ?? "").trim();
      if (id && name) personNameById.set(id, name);
    }
    const bases = {} as Record<FinBasisKey, FinBasisView>;
    for (const key of ["all", "t12m", "fytd", "runrate"] as FinBasisKey[]) {
      const b = fin.bases[key];
      // Stale server copies computed before the "all" basis existed lack it —
      // skip gracefully; the page falls back to t12m.
      if (!b) continue;
      const windowText = key === "all"
        ? "All planned work"
        : `${new Date(b.windowStart).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} – ${new Date(b.windowEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
      const coveragePct = b.plannedHours > 0 ? Math.round((b.assignedHours / b.plannedHours) * 100) : null;
      const totalCost = b.jobChargeableCost + b.nonJobChargeableCost;
      const chargeableSharePct = totalCost > 0 ? Math.round((b.jobChargeableCost / totalCost) * 100) : null;
      const unrated = Math.round(Math.max(b.unratedBillHours, b.unratedCostHours));
      // Year-based filter chips for the monthly breakdown
      const yearGroups = b.monthly.reduce((acc, r) => {
        const y = r.ym.slice(0, 4);
        acc[y] = (acc[y] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const yearKeys = Object.keys(yearGroups).sort();
      const monthlyStats = yearKeys.length > 1
        ? yearKeys.map(y => ({ label: y, value: `${yearGroups[y]} month${yearGroups[y] !== 1 ? "s" : ""}`, filterKey: "ym_year" }))
        : [{ label: "Months", value: int(b.monthly.length) }, { label: "Planned billing", value: fmtMoney(b.assignedBillDollars) }];

      const projectRows: CardRow[] = b.byProject.map(p => {
        const meta = nameByTicket.get(p.ticket);
        return {
          ticket: p.ticket,
          name: meta?.name ?? "—",
          division: meta?.division ?? "—",
          businessUnit: meta?.businessUnit ?? "—",
          department: meta?.department ?? "—",
          plannedHours: Math.round(p.plannedHours),
          assignedHours: Math.round(p.assignedHours),
          billDollars: p.billDollars,
          jobCost: p.jobCost,
          nonJobCost: p.nonJobCost,
          _ticket: p.ticket,
        };
      });

      /* ── Reconciliation: per-project rows with nested person/allocation _subCard ── */
      // The server may append ONE aggregate row (aggregateOf set) carrying the
      // sum of every allocation group beyond its row cap — keep it separate
      // from the per-project grouping and re-attach it as its own line so the
      // listed rows still sum exactly to the basis totals.
      const reconAggRow = b.recon?.rows.find(r => r.aggregateOf) ?? null;
      const reconByTicket = new Map<string, FinReconRow[]>();
      if (b.recon) {
        for (const rr of b.recon.rows) {
          if (rr.aggregateOf) continue;
          const arr = reconByTicket.get(rr.ticket) ?? [];
          arr.push(rr);
          reconByTicket.set(rr.ticket, arr);
        }
      }
      // Build project-level reconciliation summary rows (sorted by planClientBilling desc)
      const reconProjectRows: CardRow[] = [...reconByTicket.entries()]
        .map(([ticket, rrows]) => {
          const meta = nameByTicket.get(ticket);
          const sumPH  = rrows.reduce((s, r) => s + r.plannedHours, 0);
          const sumCH  = rrows.reduce((s, r) => s + r.chargeableHours, 0);
          const sumBill = rrows.reduce((s, r) => s + r.planClientBilling, 0);
          const sumJob  = rrows.reduce((s, r) => s + r.jobCost, 0);
          const sumNC   = rrows.reduce((s, r) => s + r.ncCost, 0);
          // Per-person/allocation detail sub-card. The server applies
          // remainder-carrying whole-unit quantization before serialization,
          // so every visible value and total reconciles exactly.
          const detailRows: CardRow[] = rrows.map(r => {
            const personName = r.person
              ? (personNameById.get(r.person.trim().toLowerCase()) ?? r.person)
              : "(open demand)";
            return {
              person: personName,
              ...(r.person ? { _person: personName, _personId: r.person } : {}),
              allocationId: r.allocationId || "—",
              allocationStart: r.allocationStart,
              allocationEnd: r.allocationEnd,
              nonChargeable: r.nonChargeable ? "Yes" : "No",
              plannedHours: r.plannedHours,
              chargeableHours: r.chargeableHours,
              billRate: r.billRate,
              planClientBilling: r.planClientBilling,
              costRate: r.costRate,
              jobCost: r.jobCost,
              ncCost: r.ncCost,
              totalInternalCost: r.totalInternalCost,
            };
          });
          const subCard: CardModel = {
            id: "financial",
            title: `Reconciliation — ${meta?.name ?? ticket}`,
            takeaway: `Person/allocation detail for ${meta?.name ?? ticket}. Each row is one allocation identity × rate combination within the window. Sums reconcile to the project totals above.`,
            stats: [
              { label: "Allocations", value: int(rrows.length) },
              { label: "Client billing", value: fmtMoney(Math.round(sumBill)) },
              { label: "Job cost", value: fmtMoney(Math.round(sumJob)) },
              { label: "NC cost", value: fmtMoney(Math.round(sumNC)) },
            ],
            columns: FIN_RECON_COLS,
            rows: detailRows,
          };
          return {
            ticket,
            name: meta?.name ?? "—",
            division: meta?.division ?? "—",
            plannedHours: sumPH,
            chargeableHours: sumCH,
            planClientBilling: sumBill,
            jobCost: sumJob,
            ncCost: sumNC,
            totalInternalCost: sumJob + sumNC,
            _subCard: subCard,
          };
        })
        .sort((a, b) => (b.planClientBilling as number) - (a.planClientBilling as number));
      // Aggregate remainder line LAST so the table always sums to the headline.
      if (reconAggRow) {
        reconProjectRows.push({
          ticket: "—",
          name: `Omitted allocations — aggregate of ${int(reconAggRow.aggregateOf ?? 0)} groups beyond the listing cap`,
          division: "—",
          plannedHours: reconAggRow.plannedHours,
          chargeableHours: reconAggRow.chargeableHours,
          planClientBilling: reconAggRow.planClientBilling,
          jobCost: reconAggRow.jobCost,
          ncCost: reconAggRow.ncCost,
          totalInternalCost: reconAggRow.totalInternalCost,
        });
      }
      const reconMeta: FinReconMeta | undefined = b.recon;
      const reconTruncNote = reconMeta && reconMeta.rowsTruncated > 0
        ? ` (${int(reconMeta.rowsTruncated)} allocation groups beyond the cap are combined into one "Omitted allocations" aggregate line so the table still adds up)`
        : "";

      // Explanation note — overall planned basis and data source/completeness
      const unratedNote2 = unrated > 0
        ? ` ${int(unrated)} hours have no rate configured and are excluded from dollar figures.` : "";
      const truncNote = b.projectRowsTruncated > 0
        ? ` Project list capped at ${int(b.byProject.length)}; ${int(b.projectRowsTruncated)} smaller ones are in totals only.` : "";
      const explanationNote = `Basis: ${FIN_BASIS_LABELS[key]} (${windowText}). `
        + `All figures are planned from allocation plans × configured rates — not timesheet actuals. `
        + `${int(Math.round(b.plannedHours))} total planned hrs: `
        + `${int(Math.round(b.assignedHours))} assigned, `
        + `${int(Math.round(b.demandHours))} open demand. `
        + `Client billing = assigned chargeable hrs × bill rate. `
        + `Job cost = assigned non-NC hrs × cost rate. `
        + `NC cost = assigned NonChargeable hrs × cost rate.`
        + unratedNote2 + truncNote + reconTruncNote;

      /* ── Month chart drill: project-level evidence for each chart point ──
       * The API builds these rows inside the same weekly expansion as monthly
       * chart totals. Do not derive them by filtering all-window project rows:
       * a project can contribute to many months and that would misstate June.
       */
      const monthlyDetailCards: Record<string, CardModel> = {};
      // A legacy/cached payload can predate monthlyByProject. Do not offer an
      // empty project drawer in that case: retain the original monthly table
      // until the refreshed Overall payload supplies the evidence.
      if (Array.isArray(b.monthlyByProject)) {
        for (const month of b.monthly) {
        const rawRows = b.monthlyByProject.filter(r => r.ym === month.ym);
        const omitted = rawRows.find(r => r.aggregateOf);
        const detailRows: CardRow[] = rawRows.map(r => {
          if (r.aggregateOf) {
            return {
              ticket: "—",
              name: `Omitted projects — aggregate of ${int(r.aggregateOf)} smaller projects`,
              division: "—",
              plannedHours: r.plannedHours,
              assignedHours: r.assignedHours,
              billDollars: r.billDollars,
              jobCost: r.jobCost,
              nonJobCost: r.nonJobCost,
            };
          }
          const meta = nameByTicket.get(r.ticket);
          return {
            ticket: r.ticket,
            name: meta?.name ?? "—",
            division: meta?.division ?? "—",
            plannedHours: r.plannedHours,
            assignedHours: r.assignedHours,
            billDollars: r.billDollars,
            jobCost: r.jobCost,
            nonJobCost: r.nonJobCost,
            _ticket: r.ticket,
          };
        });
        const projectCount = rawRows.reduce((count, r) => count + (r.aggregateOf ?? 1), 0);
        const label = monthLabel(month.ym);
        const omissionNote = omitted
          ? ` ${int(omitted.aggregateOf ?? 0)} smaller projects are represented by the final aggregate line, so totals still match the chart.`
          : "";
        monthlyDetailCards[month.ym] = {
          id: "financial",
          title: `Financial — ${label} by Project`,
          takeaway: `Every planned financial figure for ${label}, grouped by project. Planned billing = assigned, chargeable hours × the configured billing rate. Job cost = assigned non-NC hours × cost rate. Non-chargeable work remains in Non-Job Cost and never contributes to client billing.${omissionNote}`,
          stats: [
            { label: "Total Projects", value: int(projectCount) },
            { label: "Planned hours", value: int(Math.round(month.plannedHours)) },
            { label: "Planned billing", value: fmtMoney(month.billDollars) },
            { label: "Planned cost", value: fmtMoney(month.costDollars) },
          ],
          columns: FIN_PROJECT_COLS,
          rows: detailRows,
          explanation: {
            meaning: `The project contributions behind the ${label} point on the financial charts.`,
            calculation: "The server expands every allocation into its planned weeks, applies hours-win de-duplication, then groups that month's included weeks by project. Billing excludes open demand, non-chargeable work, and hours without a billing rate. Job and non-chargeable cost use the configured internal cost rate.",
            period: `${label} (calendar month)`,
            measure: "planned",
            source: "Allocation plans and configured billing / internal cost rates",
            completeness: omitted
              ? `All projects are represented: ${int(omitted.aggregateOf ?? 0)} appear in the final aggregate line.`
              : "All projects with planned work in this month are listed.",
            totals: {
              plannedHours: Math.round(month.plannedHours),
              billDollars: month.billDollars,
              jobCost: detailRows.reduce((sum, r) => sum + (Number(r.jobCost) || 0), 0),
              nonJobCost: detailRows.reduce((sum, r) => sum + (Number(r.nonJobCost) || 0), 0),
            },
          },
        };
        }
      }

      /* Business Unit rows: SERVER aggregation ONLY (allocation-level,
       * canonical Division→BU hierarchy resolved in the query — same source
       * as byDivision). Older cached payloads predate byBusinessUnit; those
       * honestly show no BU card rather than a record-level re-aggregation
       * whose totals wouldn't reconcile with the allocation-based figures.
       * The server maps missing BUs to "No business unit" — normalize to ""
       * for the shared Unassigned display rule. */
      const buSorted = (b.byBusinessUnit ?? [])
        .map(r => ({ ...r, rawOrg: r.bu, bu: r.bu === "No business unit" ? "" : r.bu }))
        .sort((a, b2) => b2.billDollars - a.billDollars);
      /* Department rows: SERVER aggregation only (person-level department —
       * the client model has no allocation→department relationship, so there
       * is no honest client-side fallback; older payloads simply show no
       * department card rather than a fabricated one). */
      const deptSorted = (b.byDepartment ?? [])
        .map(r => ({ ...r, rawOrg: r.department, department: r.department === "No department" ? "" : r.department }))
        .sort((a, b2) => b2.billDollars - a.billDollars);
      // Org cards are intentionally available only when their exact,
      // allocation-level project evidence is present. A stale cached payload
      // must not fall back to project record tags: a project can contribute
      // distinct values to several departments or business units.
      const groupMap = (groups: FinOrgProjectGroup[] | undefined) =>
        new Map<string, FinOrgProjectGroup>((groups ?? []).map(group => [group.org, group]));
      const divisionProjectGroups = groupMap(b.byDivisionByProject);
      const buProjectGroups = groupMap(b.byBusinessUnitByProject);
      const deptProjectGroups = groupMap(b.byDepartmentByProject);
      const exactProjectRows = (group: FinOrgProjectGroup): CardRow[] => group.rows.map(row => {
        if (row.aggregateOf) {
          return {
            ticket: "—",
            name: `Omitted projects — aggregate of ${int(row.aggregateOf)} smaller projects`,
            division: "—",
            plannedHours: row.plannedHours,
            assignedHours: row.assignedHours,
            billDollars: row.billDollars,
            jobCost: row.jobCost,
            nonJobCost: row.nonJobCost,
          };
        }
        const meta = nameByTicket.get(row.ticket);
        return {
          ticket: row.ticket,
          name: meta?.name ?? "—",
          division: meta?.division ?? "—",
          plannedHours: row.plannedHours,
          assignedHours: row.assignedHours,
          billDollars: row.billDollars,
          jobCost: row.jobCost,
          nonJobCost: row.nonJobCost,
          _ticket: row.ticket,
        };
      });
      const exactProjectCard = (
        group: FinOrgProjectGroup,
        displayOrg: string,
        plannedHours: number,
        billDollars: number,
      ): CardModel => {
        const projectCount = group.rows.reduce((count, row) => count + (row.aggregateOf ?? 1), 0);
        const omissionNote = group.rowsTruncated > 0
          ? ` ${int(group.rowsTruncated)} smaller projects are represented by the final aggregate line, so the listed figures still reconcile exactly.`
          : "";
        return {
          id: "financial",
          title: `Financial — ${displayOrg} by Project`,
          takeaway: `Exact allocation-level project contributions for ${displayOrg}. The listed planned hours and billing sum exactly to the ${displayOrg} group figure.${omissionNote}`,
          stats: [
            { label: "Total Projects", value: int(projectCount) },
            { label: "Planned billing", value: fmtMoney(billDollars) },
            { label: "Planned hrs", value: int(plannedHours) },
          ],
          columns: FIN_PROJECT_COLS,
          rows: exactProjectRows(group),
        };
      };
      const buExactRows = buSorted.filter(row => buProjectGroups.has(row.rawOrg));
      const divisionExactRows = b.byDivision.filter(row => divisionProjectGroups.has(row.division));
      const deptExactRows = deptSorted.filter(row => deptProjectGroups.has(row.rawOrg));

      /* ── Semantically-correct KPI-targeted cards ── */
      // clientBillingCard: assigned chargeable hours × bill rate, by project
      const clientBillingRows = projectRows.filter(p => Number(p.billDollars) > 0);
      const clientBillingCard: CardModel = {
        id: "financial",
        title: `Financial — Client Billing by Project (${FIN_BASIS_LABELS[key]})`,
        takeaway: `Assigned chargeable hours × bill rate per project. Non-chargeable allocations are excluded from this figure. ${explanationNote}`,
        stats: [
          { label: "Planned client billing", value: fmtMoney(b.assignedBillDollars) },
          { label: "Projects with billing", value: int(clientBillingRows.length) },
          { label: "Assigned hrs", value: int(Math.round(b.assignedHours)) },
        ],
        columns: FIN_PROJECT_COLS,
        rows: clientBillingRows,
      };
      // jobCostCard: assigned non-NC hours × cost rate, by project
      const jobCostRows = projectRows.filter(p => Number(p.jobCost) > 0);
      const jobCostCard: CardModel = {
        id: "financial",
        title: `Financial — Job Chargeable Cost by Project (${FIN_BASIS_LABELS[key]})`,
        takeaway: `Assigned, non-NonChargeable hours × internal cost rate per project. Does not include overhead/NC allocations. ${explanationNote}`,
        stats: [
          { label: "Job chargeable cost", value: fmtMoney(b.jobChargeableCost) },
          { label: "Total Projects", value: int(jobCostRows.length) },
        ],
        columns: FIN_PROJECT_COLS,
        rows: jobCostRows,
      };
      // ncCostCard: assigned NC hours × cost rate, by project
      const ncCostRows = projectRows.filter(p => Number(p.nonJobCost) > 0);
      const ncCostCard: CardModel = {
        id: "financial",
        title: `Financial — Non-Chargeable (NC) Cost by Project (${FIN_BASIS_LABELS[key]})`,
        takeaway: `Assigned NonChargeable hours × cost rate per project. These are overhead / admin / non-billable allocations. ${explanationNote}`,
        stats: [
          { label: "NC (non-job) cost", value: fmtMoney(b.nonJobChargeableCost) },
          { label: "Projects with NC", value: int(ncCostRows.length) },
        ],
        columns: FIN_PROJECT_COLS,
        rows: ncCostRows,
      };
      // totalCostCard: job + NC cost, all costed projects
      const totalCostRows = projectRows.filter(p => Number(p.jobCost) + Number(p.nonJobCost) > 0);
      const totalCostCard: CardModel = {
        id: "financial",
        title: `Financial — Total Internal Cost by Project (${FIN_BASIS_LABELS[key]})`,
        takeaway: `Job chargeable cost + NC cost per project — total internal labor cost across all assigned allocations. ${explanationNote}`,
        stats: [
          { label: "Total internal cost", value: fmtMoney(b.jobChargeableCost + b.nonJobChargeableCost) },
          { label: "Job cost", value: fmtMoney(b.jobChargeableCost) },
          { label: "NC cost", value: fmtMoney(b.nonJobChargeableCost) },
        ],
        columns: FIN_PROJECT_COLS,
        rows: totalCostRows,
      };
      // reconCard: project rows each with person/allocation _subCard
      const reconCard: CardModel = {
        id: "financial",
        title: `Financial — Reconciliation by Project (${FIN_BASIS_LABELS[key]})`,
        takeaway: `Auditable allocation-level detail grouped by project. Each project row opens a per-person/allocation breakdown. Rows are listed at whole-hour / whole-dollar precision with rounding remainders carried between rows, so the listed values sum EXACTLY to the basis totals. ${explanationNote}`,
        stats: reconMeta ? [
          { label: "Client billing (recon)", value: fmtMoney(reconMeta.sumPlanClientBilling) },
          { label: "Job cost (recon)", value: fmtMoney(reconMeta.sumJobCost) },
          { label: "NC cost (recon)", value: fmtMoney(reconMeta.sumNcCost) },
          // Aggregate remainder row (aggregateOf) is a container, not a group —
          // count listed groups + the omitted groups it represents.
          { label: "Alloc groups", value: int(reconMeta.rows.filter(r => !r.aggregateOf).length + reconMeta.rowsTruncated) },
        ] : [{ label: "No reconciliation data", value: "—" }],
        columns: FIN_PROJECT_DETAIL_COLS,
        rows: reconProjectRows,
      };

      bases[key] = {
        key,
        label: FIN_BASIS_LABELS[key],
        note: FIN_BASIS_NOTES[key],
        windowText,
        b,
        coveragePct,
        chargeableSharePct,
        unratedNote: unrated > 0
          ? `${int(unrated)} planned hours have no rate configured and are left out of the dollar figures.`
          : null,
        explanationNote,
        hoursCard: {
          id: "financial",
          title: `Financial — Planned Hours by Project (${FIN_BASIS_LABELS[key]})`,
          takeaway: `Planned allocation hours and dollars per project for this window. ${explanationNote}`,
          stats: [
            { label: "Contracted hours", value: int(Math.round(b.plannedHours)) },
            { label: "Allocated hours", value: int(Math.round(b.assignedHours)) },
            { label: "Unfilled (open) hours", value: int(Math.round(b.demandHours)) },
            { label: "Planned billing", value: fmtMoney(b.assignedBillDollars) },
          ],
          columns: FIN_PROJECT_COLS,
          rows: projectRows,
        },
        monthlyCard: {
          id: "financial",
          title: `Financial — Month by Month (${FIN_BASIS_LABELS[key]})`,
          takeaway: "Planned hours, billing and cost per month in this window. Open a month to see the project-by-project calculations behind it.",
          stats: monthlyStats,
          columns: FIN_MONTH_COLS,
          // ym_year is a hidden field used by the year filter chips in
          // DataDrawer; _subCard makes every month row a true next drill level.
          rows: b.monthly.map(r => ({
            ...r,
            plannedHours: Math.round(r.plannedHours),
            ym_year: r.ym.slice(0, 4),
            _subCard: monthlyDetailCards[r.ym],
          })),
        },
        monthlyDetailCards,
        clientBillingCard,
        jobCostCard,
        ncCostCard,
        totalCostCard,
        reconCard,
        buCard: buExactRows.length > 0 ? {
          id: "financial",
          title: `Financial — By Business Unit (${FIN_BASIS_LABELS[key]})`,
          takeaway: "Planned hours and billing per business unit for this window, from each assignment's division→business-unit link. Open a row to see its exact allocation-level project contributions.",
          stats: buExactRows.slice(0, 4).map(r => ({ label: r.bu || "Unassigned", value: fmtMoney(r.billDollars) })),
          columns: FIN_BU_COLS,
          rows: buExactRows.map(r => {
            const displayBU = r.bu || "Unassigned";
            const subCard = exactProjectCard(buProjectGroups.get(r.rawOrg)!, displayBU, r.plannedHours, r.billDollars);
            return {
              bu: displayBU,
              plannedHours: r.plannedHours,
              assignedHours: r.assignedHours,
              billDollars: r.billDollars,
              _subCard: subCard,
            };
          }),
        } : null,
        divisionCard: divisionExactRows.length > 0 ? {
          id: "financial",
          title: `Financial — By Division (${FIN_BASIS_LABELS[key]})`,
          takeaway: "Planned hours and billing per division for this window, from each assignment's division. Open a row to see its exact allocation-level project contributions.",
          stats: divisionExactRows.slice(0, 4).map(d => ({ label: d.division || "Unassigned", value: fmtMoney(d.billDollars), filterKey: "division" })),
          columns: FIN_DIVISION_COLS,
          rows: divisionExactRows.map(d => {
            const displayDiv = d.division || "Unassigned";
            const subCard = exactProjectCard(divisionProjectGroups.get(d.division)!, displayDiv, d.plannedHours, d.billDollars);
            return {
              division: displayDiv,
              plannedHours: d.plannedHours,
              assignedHours: d.assignedHours,
              billDollars: d.billDollars,
              _subCard: subCard,
            };
          }),
        } : null,
        departmentCard: deptExactRows.length > 0 ? {
          id: "financial",
          title: `Financial — By Department (${FIN_BASIS_LABELS[key]})`,
          takeaway: "Planned hours and billing per department for this window, from each allocated person's department. Open a row to see its exact allocation-level project contributions.",
          stats: deptExactRows.slice(0, 4).map(r => ({ label: r.department || "Unassigned", value: fmtMoney(r.billDollars) })),
          columns: FIN_DEPT_COLS,
          rows: deptExactRows.map(r => {
            const displayDept = r.department || "Unassigned";
            const subCard = exactProjectCard(deptProjectGroups.get(r.rawOrg)!, displayDept, r.plannedHours, r.billDollars);
            return {
              department: displayDept,
              plannedHours: r.plannedHours,
              assignedHours: r.assignedHours,
              billDollars: r.billDollars,
              _subCard: subCard,
            };
          }),
        } : null,
      };
    }
    finState = { state: "ok", stale: fin.stale, generatedAt: fin.generatedAt, workWeekHours: fin.workWeekHours, bases };
  }

  return { recordsOk, backlog, contractedLabor, fin: finState };
}

export const finMonthlyChartRows = (monthly: FinMonthly[]) =>
  monthly.map(r => ({ ...r, month: monthLabel(r.ym) }));

export const finDivisionChartRows = (rows: FinDivisionRow[]) =>
  rows.map(d => ({ ...d, division: d.division || "Unassigned" }));
