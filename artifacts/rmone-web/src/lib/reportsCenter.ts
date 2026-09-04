
/* ─────────────────────────────────────────────────────────────
 * reportsCenter.ts — pure view-model builders for the Reports
 * pages (Leads / Opportunities / Projects / Close Out).
 *
 * Honesty contract (same as the Analytics Center): every number
 * comes from the SAME ReportModel the analytics pages use, so
 * Reports and Analytics can never disagree. Period filters run
 * on REAL recorded dates only (Created, AwardedorLossDate,
 * CloseoutDate, Target dates). When the CRMStatusLedger is
 * available (status-change history recorded since the ledger
 * shipped), per-period conversion/decision counts use it.
 * Older models without ledger data fall back to all-time with
 * an explanatory note — never fabricated per-period numbers.
 * Pure data — no React.
 * ──────────────────────────────────────────────────────────── */

/** One row from the CRMStatusLedger — already period-scoped by the API. */
export type LedgerFeed = { rows: LedgerEntry[]; truncated: boolean; since: string | null };
/** A CRM ledger fetch proves coverage of a period only when it is untruncated
 *  AND its tenant-wide recording-start watermark (`since`) is on/before the
 *  period start — an empty table or a period predating recording proves nothing. */
function ledgerFeedCovers(ledger: LedgerFeed | undefined, r: PeriodRange): boolean {
  if (!ledger || ledger.truncated || !ledger.since) return false;
  const since = new Date(ledger.since);
  return !isNaN(since.getTime()) && since.getTime() <= r.start.getTime();
}
/** Defensive echo filter: a row whose old and new statuses match is a re-save,
 *  not a change — never count it as a conversion. */
function isEcho(e: LedgerEntry): boolean {
  return (e.oldStatus ?? "").trim().toLowerCase() === e.newStatus.trim().toLowerCase();
}
export type LedgerEntry = {
  ticketId: string;
  module: string;            // "OPM" | "LEM"
  oldStatus: string | null;
  newStatus: string;
  changedAt: string;         // ISO UTC timestamp
  changedBy: string | null;
};
import {
  fmtMoney, type ReportModel, type ProjectRow, type OppRow, type LeadRow,
  type StatusChangeItem,
} from "@/lib/reportData";
import {
  countBy, sumBy, int, orgDimLabel, countByOrg, sumByOrg,
  type CardModel, type CardColumn, type CardRow, type OrgDim,
} from "@/lib/analyticsCenter";

/* ═══════════════════ modules ═══════════════════ */

export type ReportModuleId = "leads" | "opportunities" | "projects" | "closeout";

export const REPORT_MODULES: { id: ReportModuleId; title: string; blurb: string }[] = [
  {
    id: "leads",
    title: "Leads",
    blurb: "New leads, the active lead book, statuses, age and conversion into opportunities.",
  },
  {
    id: "opportunities",
    title: "Opportunities",
    blurb: "New pursuits, the open pipeline by stage and division, and bids won or lost in the period.",
  },
  {
    id: "projects",
    title: "Projects",
    blurb: "New projects, the active portfolio by status and division, and work starting or finishing in the period.",
  },
  {
    id: "closeout",
    title: "Close Out",
    blurb: "Projects heading into close-out, past their close-out date, and fully closed.",
  },
];

export const REPORT_TITLES: Record<ReportModuleId, string> = Object.fromEntries(
  REPORT_MODULES.map(m => [m.id, m.title]),
) as Record<ReportModuleId, string>;

/* ═══════════════════ periods ═══════════════════ */
export type PeriodKind = "week" | "month" | "quarter" | "ytd" | "custom";
export type PeriodRange = { kind: PeriodKind; start: Date; end: Date; label: string };

export const PERIOD_CHOICES: { kind: PeriodKind; label: string }[] = [
  { kind: "week", label: "This week" },
  { kind: "month", label: "This month" },
  { kind: "quarter", label: "This quarter" },
  { kind: "ytd", label: "Year to date" },
  { kind: "custom", label: "Custom" },
];

const DAY = 86_400_000;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Parse a date-only input ("2026-08-18") as LOCAL midnight — never UTC. */
export function parseLocalDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/** [start, end) in local time. Default = current week (Mon–Sun) — reports
 *  primarily support the weekly management review. */
export function getPeriodRange(
  kind: PeriodKind,
  customStart?: string,
  customEnd?: string,
  now = new Date(),
): PeriodRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (kind) {
    case "month": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      return { kind, start, end, label: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
    }
    case "quarter": {
      const q = Math.floor(today.getMonth() / 3);
      const start = new Date(today.getFullYear(), q * 3, 1);
      const end = new Date(today.getFullYear(), q * 3 + 3, 1);
      return { kind, start, end, label: `Q${q + 1} ${today.getFullYear()}` };
    }
    case "ytd": {
      const start = new Date(today.getFullYear(), 0, 1);
      return { kind, start, end: addDays(today, 1), label: `${today.getFullYear()} to date` };
    }
    case "custom": {
      const s = customStart ? parseLocalDay(customStart) : null;
      const e = customEnd ? parseLocalDay(customEnd) : null;
      if (s && e && e.getTime() >= s.getTime()) {
        return { kind, start: s, end: addDays(e, 1), label: `${fmtDay(s)} – ${fmtDay(e)}` };
      }
      /* invalid custom range → fall back to the default week */
      return { ...getPeriodRange("week", undefined, undefined, now), kind: "custom" };
    }
    case "week":
    default: {
      const dow = (today.getDay() + 6) % 7; // Mon = 0
      const start = addDays(today, -dow);
      return { kind: "week", start, end: addDays(start, 7), label: `Week of ${fmtDay(start)}` };
    }
  }
}

export function inPeriod(iso: string | null | undefined, r: PeriodRange): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !isNaN(t) && t >= r.start.getTime() && t < r.end.getTime();
}

/* ── time buckets for "over time" column charts ──
 * ≤14 days → daily, ≤120 days → weekly (Mon), else monthly. */
export type TimeBucket = { label: string; count: number; value: number };
export function timeBuckets<T>(
  rows: T[],
  date: (row: T) => string | null | undefined,
  value: (row: T) => number,
  r: PeriodRange,
): { buckets: TimeBucket[]; bucketOf: (row: T) => string | null } {
  const days = Math.max(1, Math.round((r.end.getTime() - r.start.getTime()) / DAY));
  const mode: "day" | "week" | "month" = days <= 14 ? "day" : days <= 120 ? "week" : "month";

  const startOf = (d: Date): Date => {
    if (mode === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (mode === "week") { const dow = (d.getDay() + 6) % 7; return addDays(d, -dow); }
    return new Date(d.getFullYear(), d.getMonth(), 1);
  };
  const next = (d: Date): Date =>
    mode === "day" ? addDays(d, 1) : mode === "week" ? addDays(d, 7) : new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const labelOf = (d: Date): string =>
    mode === "day"
      ? d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" })
      : mode === "week"
        ? `Wk of ${fmtDay(d)}`
        : d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });

  const buckets: TimeBucket[] = [];
  const index = new Map<number, TimeBucket>();
  for (let d = startOf(r.start); d.getTime() < r.end.getTime(); d = next(d)) {
    const b = { label: labelOf(d), count: 0, value: 0 };
    buckets.push(b);
    index.set(d.getTime(), b);
  }
  const bucketOf = (row: T): string | null => {
    const iso = date(row);
    if (!iso) return null;
    const t = new Date(iso);
    if (isNaN(t.getTime())) return null;
    const b = index.get(startOf(t).getTime());
    return b ? b.label : null;
  };
  for (const row of rows) {
    const iso = date(row);
    if (!iso || !inPeriod(iso, r)) continue;
    const b = index.get(startOf(new Date(iso)).getTime());
    if (b) { b.count += 1; b.value += value(row); }
  }
  return { buckets, bucketOf };
}

/* ═══════════════════ report shapes ═══════════════════ */
export type ReportViz =
  | { kind: "hbars"; rows: { label: string; v: number; text?: string; filterValue?: string }[]; color?: string }
  | { kind: "columns"; data: { x: string; y: number }[]; color?: string }
  | { kind: "donut"; segments: { label: string; v: number; color: string }[]; total: number; centerLabel?: string };

export type ReportChart = {
  title: string;
  takeaway: string;
  viz: ReportViz;
  card: CardModel;
  /** card-row field the clicked bar label maps onto (click-to-filter) */
  filterField?: string;
  wide?: boolean;
};

export type ModuleReport = {
  hero: { label: string; value: string; explain: string; card: CardModel | null };
  kpis: { label: string; value: string; card: CardModel | null }[];
  charts: ReportChart[];
  /** honest limitations — rendered as an info strip, never hidden */
  notes: string[];
};

export type ReportCardMetric = { label: string; value: string | number };

/**
 * A Reports hub card shows two headline indicators. Its export must retain
 * those exact visible indicators as well as the module's detailed data: the
 * module hero alone is often only the all-time/active population.
 */
export function withReportCardMetrics(report: ModuleReport, metrics: ReportCardMetric[]): ModuleReport {
  const cleanMetrics = metrics.map(metric => ({
    label: metric.label.trim(),
    value: String(metric.value),
  })).filter(metric => metric.label.length > 0);
  if (cleanMetrics.length === 0) return report;

  const labelsOverlap = (a: string, b: string) => {
    const left = a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const right = b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (left === right || left.startsWith(`${right} `) || right.startsWith(`${left} `)) return true;
    // The hub uses plain-language labels ("New in period"), while module
    // reports use the selected range ("New (This Quarter)"). They describe
    // the same number and should not be exported as duplicate summary rows.
    const meaningfulPeriodTerms = ["new", "won", "closed"];
    return meaningfulPeriodTerms.some(term =>
      left.split(" ").includes(term) && right.split(" ").includes(term));
  };
  const isVisibleMetric = (label: string) => cleanMetrics.some(metric => labelsOverlap(metric.label, label));
  const exportMetrics = cleanMetrics.map(metric => ({ ...metric, card: null }));

  return {
    ...report,
    hero: {
      ...report.hero,
      card: report.hero.card
        ? {
            ...report.hero.card,
            stats: [
              ...cleanMetrics,
              ...report.hero.card.stats.filter(stat => !isVisibleMetric(stat.label)),
            ],
          }
        : null,
    },
    // The Excel summary has no card-stat section, so carry the same two
    // visible hub indicators into its KPI rows too.
    kpis: [
      ...exportMetrics,
      ...report.kpis.filter(kpi => !isVisibleMetric(kpi.label)),
    ],
  };
}

/**
 * Finds the period-scoped data card that backs each secondary Reports hub
 * indicator. The primary indicator is already the hero card; these cards are
 * exported as separate tables/sheets so their record populations stay clear.
 */
export function getReportPeriodMetricCards(
  report: ModuleReport,
  visibleMetrics: ReportCardMetric[],
): { label: string; card: CardModel }[] {
  const usedCards = new Set<CardModel>(report.hero.card ? [report.hero.card] : []);
  const periodKeyword = (label: string) => {
    const normalized = label.toLowerCase();
    if (normalized.includes("new")) return "new";
    if (normalized.includes("won")) return "won";
    if (normalized.includes("closed")) return "closed";
    return null;
  };

  return visibleMetrics.slice(1).flatMap(metric => {
    const keyword = periodKeyword(metric.label);
    if (!keyword) return [];
    const kpi = report.kpis.find(candidate =>
      candidate.card
      && !usedCards.has(candidate.card)
      && candidate.label.toLowerCase().includes(keyword));
    if (!kpi?.card) return [];
    usedCards.add(kpi.card);
    return [{ label: `${metric.label} records`, card: kpi.card }];
  });
}

/* ═══════════════════ columns + row mappers ═══════════════════ */
export const R_LEAD_COLS: CardColumn[] = [
  { key: "id", label: "ID", width: 14 },
  { key: "name", label: "Lead", width: 32 },
  { key: "client", label: "Company", width: 22 },
  { key: "status", label: "Status", width: 14 },
  { key: "owner", label: "Owner", width: 18 },
  { key: "created", label: "Created", kind: "date", width: 13 },
  { key: "value", label: "Est. Value", kind: "money", align: "right", width: 12 },
];
/** Like R_LEAD_COLS but with an extra "Converted to" column — use for cards
 *  that may show converted leads so users see Opportunity vs Project. */
export const R_LEAD_COLS_CONV: CardColumn[] = [
  { key: "id", label: "ID", width: 13 },
  { key: "name", label: "Lead", width: 28 },
  { key: "client", label: "Company", width: 20 },
  { key: "status", label: "Status", width: 13 },
  { key: "convertedTo", label: "Converted to", width: 14 },
  { key: "owner", label: "Owner", width: 16 },
  { key: "created", label: "Created", kind: "date", width: 13 },
  { key: "value", label: "Est. Value", kind: "money", align: "right", width: 12 },
];
export const R_OPP_COLS: CardColumn[] = [
  { key: "id", label: "ID", width: 14 },
  { key: "name", label: "Opportunity", width: 32 },
  { key: "client", label: "Client", width: 22 },
  { key: "stage", label: "Stage", width: 18 },
  { key: "owner", label: "Owner", width: 18 },
  { key: "created", label: "Created", kind: "date", width: 13 },
  { key: "value", label: "Value", kind: "money", align: "right", width: 12 },
];
export const R_DECIDED_COLS: CardColumn[] = [
  { key: "id", label: "ID", width: 14 },
  { key: "name", label: "Opportunity", width: 32 },
  { key: "client", label: "Client", width: 22 },
  { key: "result", label: "Result", width: 10 },
  { key: "decidedDate", label: "Decided", kind: "date", width: 13 },
  { key: "value", label: "Value", kind: "money", align: "right", width: 12 },
];
export const R_PROJ_COLS: CardColumn[] = [
  { key: "id", label: "ID", width: 14 },
  { key: "name", label: "Project", width: 32 },
  { key: "client", label: "Client", width: 22 },
  { key: "division", label: "Division", width: 16 },
  { key: "status", label: "Status", width: 14 },
  { key: "owner", label: "Owner", width: 18 },
  { key: "created", label: "Created", kind: "date", width: 13 },
  { key: "value", label: "Value", kind: "money", align: "right", width: 12 },
];
export const R_CLOSEOUT_COLS: CardColumn[] = [
  { key: "id", label: "ID", width: 14 },
  { key: "name", label: "Project", width: 32 },
  { key: "client", label: "Client", width: 22 },
  { key: "status", label: "Status", width: 14 },
  { key: "closeoutDate", label: "Close-Out Date", kind: "date", width: 15 },
  { key: "targetEnd", label: "Planned End", kind: "date", width: 14 },
  { key: "value", label: "Value", kind: "money", align: "right", width: 12 },
];

const leadR = (l: LeadRow, extra?: Record<string, unknown>): CardRow => ({
  ...l, client: l.client ?? "—", owner: l.owner ?? "—", division: l.division ?? "—",
  businessUnit: l.businessUnit ?? "—", department: l.department ?? "—",
  convertedTo: l.convertedTo ?? "—",
  _ticket: l.id, ...extra,
});
const oppR = (o: OppRow, extra?: Record<string, unknown>): CardRow => ({
  ...o, client: o.client ?? "—", owner: o.owner ?? "—", division: o.division ?? "—",
  businessUnit: o.businessUnit ?? "—", department: o.department ?? "—",
  _ticket: o.id, ...extra,
});
const projR = (p: ProjectRow, extra?: Record<string, unknown>): CardRow => ({
  ...p, client: p.client ?? "—", owner: p.owner ?? "—", division: p.division ?? "—",
  businessUnit: p.businessUnit ?? "—", department: p.department ?? "—",
  _ticket: p.id, ...extra,
});

/* ── organization-dimension column swap ──
 * Reports always show ONE org column: the selected dimension's. Swapping the
 * division column (rather than appending) keeps PDF/Excel layouts stable and
 * guarantees the exported column matches the on-screen grouping. */
function withOrgCol(cols: CardColumn[], dim: OrgDim): CardColumn[] {
  if (cols.some(c => c.key === "division")) {
    if (dim === "division") return cols;
    return cols.map(c => (c.key === "division" ? { ...c, key: dim, label: orgDimLabel(dim) } : c));
  }
  // No org column in the base layout (leads/opps) — insert the selected
  // dimension's column before the money column so the grouping is visible.
  const orgCol: CardColumn = { key: dim, label: orgDimLabel(dim), width: 16 };
  const i = cols.findIndex(c => c.key === "value");
  return i >= 0 ? [...cols.slice(0, i), orgCol, ...cols.slice(i)] : [...cols, orgCol];
}

/* ── age bands (REAL: Created is populated on every record) ── */
const AGE_BANDS = [
  { label: "Under 30 days", max: 30 },
  { label: "30–60 days", max: 60 },
  { label: "60–90 days", max: 90 },
  { label: "Over 90 days", max: Infinity },
];
function ageBand(created: string | null | undefined, nowMs: number): string | null {
  if (!created) return null;
  const t = new Date(created).getTime();
  if (isNaN(t)) return null;
  const days = Math.max(0, Math.floor((nowMs - t) / DAY));
  for (const b of AGE_BANDS) if (days < b.max) return b.label;
  return null;
}
function ageRows(labels: string[], counts: Map<string, number>): { label: string; v: number }[] {
  return labels.filter(l => (counts.get(l) ?? 0) > 0).map(l => ({ label: l, v: counts.get(l) ?? 0 }));
}

const GREEN = "#8EC94A", BLUE = "#6B99BB", AMBER = "#F0A842", RED = "#F87171", LIME = "#C4D44A";

/* ═══════════════ status-change history (true per-period conversions) ═══════
 * RMOneStatusHistory rows loaded into the model. Every status/stage write
 * path appends to it (picker edits, auto-advance, imports), so counts built
 * from it are TRUE "changed during the period" numbers — unlike current
 * statuses, which are all-time. Coverage rule: the tenant's earliest
 * recorded change (`statusHistorySince`) must be on/before the period start
 * for the period to be fully covered; only then do the "all time" honesty
 * notes disappear. A period that starts before tracking began keeps an
 * honest partial-coverage note instead. */
type HistoryInfo = {
  loaded: boolean;                 // ledger endpoint loaded (rows may be empty)
  rows: StatusChangeItem[];
  since: Date | null;              // earliest recorded change, ever
  coverageStart: Date | null;      // earliest change the LOADED rows fully cover
  covers: (r: PeriodRange) => boolean;
};

/* ═══════════════════ LEADS ═══════════════════ */
/* Ledger helpers — patterns mirror rds-provider.ts side-effects exactly */
const LEDGER_WON_RE  = /award|won|win/i;
const LEDGER_LOST_RE = /\blost\b|cancel|declined|dead|no[ -]?bid/i;
const LEDGER_CONV_RE = /convert/i;

/** Convert period-scoped CRMStatusLedger rows into the StatusChangeItem map
 *  shape, unioned with the model-history map (model rows win per ticket). */
function unionLedger(
  base: Map<string, StatusChangeItem>, ledger: LedgerFeed | undefined,
  module: StatusChangeItem["module"], pred: (newStatus: string) => boolean,
): Map<string, StatusChangeItem> {
  for (const e of ledger?.rows ?? []) {
    const key = e.ticketId.toLowerCase();
    if (!isEcho(e) && pred(e.newStatus) && !base.has(key)) {
      base.set(key, {
        module, ticketId: e.ticketId, oldStatus: e.oldStatus,
        newStatus: e.newStatus, changedAt: e.changedAt, changedBy: e.changedBy, source: "user",
      });
    }
  }
  return base;
}

export function buildLeadsReport(m: ReportModel, r: PeriodRange, now = new Date(), ledger?: LedgerFeed, orgDim: OrgDim = "division"): ModuleReport {
  const nowMs = now.getTime();
  const LEAD_COLS_D      = withOrgCol(R_LEAD_COLS,      orgDim);
  // For cards that may show converted leads — includes "Converted to" column.
  const LEAD_CONV_COLS_D = withOrgCol(R_LEAD_COLS_CONV, orgDim);
  /* hasAll: older cached models lack allLeads — then closed/converted leads
   * are missing and "all" is only the open book. Never present that subset
   * as the complete record: labels + notes below say so. */
  const hasAll = m.allLeads != null;
  const all = m.allLeads ?? m.leads;
  const active = m.leads;
  const createdInP = all.filter(l => inPeriod(l.created, r));
  const converted = m.conversion.convertedLeads;

  /* True per-period conversions — two real feeds unioned by ticket: the
   * period-scoped CRMStatusLedger rows passed in by the page, and the
   * RMOneStatusHistory rows on the model. */
  const hist = historyInfo(m);
  const convChanges = unionLedger(
    changedTo(hist, "LEM", r, s => LEDGER_CONV_RE.test(s)), ledger, "LEM", s => LEDGER_CONV_RE.test(s));
  const convertedInP = all.filter(l => convChanges.has(l.id.toLowerCase()));
  /* An UNTRUNCATED period-scoped ledger fetch covers the period; a truncated
   * one has real rows but proves nothing about completeness — never let it
   * claim coverage or silence the honesty notes. */
  const ledgerCovers = ledgerFeedCovers(ledger, r);
  const histActive = ledgerCovers || (hist.loaded && hist.covers(r));
  const convertedInPCard: CardModel | null = histActive ? {
    id: "pipeline", title: `Leads — Converted (${r.label})`,
    takeaway: "Leads whose recorded status change to Converted landed inside the period (from the status-change ledger).",
    stats: [
      { label: "Converted", value: int(convertedInP.length) },
      { label: "Est. value", value: fmtMoney(convertedInP.reduce((s, l) => s + l.value, 0)) },
    ],
    columns: LEAD_CONV_COLS_D,
    rows: convertedInP.map(l => leadR(l, { converted: convChanges.get(l.id.toLowerCase())?.changedAt ?? "—" })),
  } : null;

  const activeCard: CardModel = {
    id: "pipeline", title: "Leads — Active Lead Book",
    takeaway: "Every lead still open, largest estimated value first.",
    stats: [
      { label: "Active leads", value: int(active.length) },
      { label: "Est. value", value: fmtMoney(m.leadValue) },
    ],
    columns: LEAD_COLS_D, rows: active.map(l => leadR(l)),
  };
  const createdCard: CardModel = {
    id: "pipeline", title: `Leads — New (${r.label})`,
    takeaway: `Leads created between ${fmtDay(r.start)} and ${fmtDay(addDays(r.end, -1))}, from the recorded creation date.`,
    stats: [{ label: "New leads", value: int(createdInP.length) }],
    // Use conversion columns so any "Converted" rows show what they became.
    columns: LEAD_CONV_COLS_D, rows: createdInP.map(l => leadR(l)),
  };
  const convertedCard: CardModel | null = converted.length > 0 ? {
    id: "pipeline", title: "Leads — Converted (all time)",
    takeaway: "Leads stamped Converted by the convert flow. 'Converted to' shows whether the lead became an Opportunity or went all the way to a Project. The system doesn't record WHEN a lead converted, so this list is all-time.",
    stats: [
      { label: "Converted", value: int(converted.length) },
      { label: "Est. value", value: fmtMoney(m.conversion.leadsConvertedValue) },
    ],
    columns: LEAD_CONV_COLS_D, rows: converted.map(l => leadR(l)),
  } : null;
  const allCard: CardModel = {
    id: "pipeline",
    title: hasAll ? "Leads — Every Lead on Record" : "Leads — Open Leads Only",
    takeaway: hasAll
      ? "Open, converted and closed leads together, grouped by current status in the chart."
      : "Closed and converted leads couldn't be loaded in this view — these are the open leads only.",
    stats: [{ label: hasAll ? "Total leads" : "Open leads", value: int(all.length) }],
    columns: LEAD_COLS_D, rows: all.map(l => leadR(l)),
  };

  /* charts */
  const { buckets, bucketOf } = timeBuckets(all, l => l.created, l => l.value, r);
  const byStatus = countBy(all, l => l.status);
  const byOrg = countByOrg(all, orgDim);
  const ageCounts = new Map<string, number>();
  const agedRows: CardRow[] = [];
  for (const l of active) {
    const band = ageBand(l.created, nowMs);
    if (!band) continue;
    ageCounts.set(band, (ageCounts.get(band) ?? 0) + 1);
    agedRows.push(leadR(l, { ageBand: band }));
  }

  const charts: ReportChart[] = [
    {
      title: `New Leads — ${r.label}`,
      takeaway: "Leads created in the period, by recorded creation date. Click a bar for those records.",
      viz: { kind: "columns", data: buckets.map(b => ({ x: b.label, y: b.count })), color: AMBER },
      card: { ...createdCard, rows: createdInP.map(l => leadR(l, { period: bucketOf(l) ?? "—" })) },
      filterField: "period",
      wide: true,
    },
    ...(byStatus.length > 0 ? [{
      title: "Leads by Status",
      takeaway: "Every lead on record grouped by its current status. Click a bar to see that group.",
      viz: { kind: "hbars" as const, rows: byStatus.map(s => ({ label: s.label, v: s.v, text: int(s.v) })), color: BLUE },
      card: allCard,
      filterField: "status",
    }] : []),
    ...(byOrg.length > 0 ? [{
      title: `Leads by ${orgDimLabel(orgDim)}`,
      takeaway: `Where the lead book sits across the organization (leads without a ${orgDimLabel(orgDim).toLowerCase()} are not shown).`,
      viz: { kind: "hbars" as const, rows: byOrg.map(s => ({ label: s.label, v: s.v, text: int(s.v), filterValue: s.key })), color: GREEN },
      card: allCard,
      filterField: orgDim,
    }] : []),
    ...(agedRows.length > 0 ? [{
      title: "Lead Age (active leads)",
      takeaway: "How long each open lead has been on the books, from its recorded creation date.",
      viz: { kind: "hbars" as const, rows: ageRows(AGE_BANDS.map(b => b.label), ageCounts), color: LIME },
      card: {
        id: "pipeline" as const, title: "Leads — Age of Active Leads",
        takeaway: "Open leads with days since creation, oldest habits first.",
        stats: [], columns: LEAD_COLS_D, rows: agedRows,
      },
      filterField: "ageBand",
    }] : []),
  ];

  return {
    hero: {
      label: "Active Leads",
      value: int(active.length),
      explain: `${int(active.length)} lead${active.length === 1 ? "" : "s"} still open, worth about ${fmtMoney(m.leadValue)} if they all land.`,
      card: activeCard,
    },
    kpis: [
      { label: `New (${r.label})`, value: int(createdInP.length), card: createdCard },
      ...(histActive
        ? [{ label: `Converted to opps (${r.label})`, value: int(convertedInP.length), card: convertedInPCard }]
        : []),
      {
        label: "Converted to opps (all time)",
        value: m.conversion.leadConversionRate != null
          ? `${int(m.conversion.leadsConverted)} · ${m.conversion.leadConversionRate}%`
          : int(m.conversion.leadsConverted),
        card: convertedCard,
      },
      { label: "Est. value of active book", value: fmtMoney(m.leadValue), card: activeCard },
      { label: hasAll ? "Every lead on record" : "Open leads loaded", value: int(all.length), card: allCard },
    ],
    charts,
    notes: [
      ...(hasAll ? [] : ["Closed and converted leads couldn't be loaded in this view, so totals cover open leads only — refresh to load the full history."]),
      ...(active.some(l => !l.created) ? ["Some leads have no recorded creation date and are excluded from the age chart."] : []),
    ],
  };
}


/* ═══════════════════ OPPORTUNITIES ═══════════════════ */
export function buildOppsReport(m: ReportModel, r: PeriodRange, now = new Date(), ledger?: LedgerFeed, orgDim: OrgDim = "division"): ModuleReport {
  const nowMs = now.getTime();
  const OPP_COLS_D = withOrgCol(R_OPP_COLS, orgDim);
  /* hasAll: older cached models lack allOpps — then cancelled/on-hold
   * pursuits are unknowable (opps+decidedOpps only cover open/won/lost),
   * so the inactive block stays empty rather than showing a false zero
   * as an authoritative all-time figure (its KPI is hidden + noted). */
  const hasAll = m.allOpps != null;
  const all = m.allOpps ?? [...m.opps, ...m.decidedOpps];
  const open = m.opps;
  const createdInP = all.filter(o => inPeriod(o.created, r));

  /* Ledger-backed per-period won/lost: ledger entries are already scoped to
   * the period by the API (since/until params). Fall back to AwardedorLossDate
   * column matching when no ledger is available. */
  const fullLedger = ledgerFeedCovers(ledger, r) ? ledger!.rows.filter(e => !isEcho(e)) : null;
  const ledgerWonIds  = fullLedger ? new Set(fullLedger.filter(e => LEDGER_WON_RE.test(e.newStatus)).map(e => e.ticketId))  : null;
  const ledgerLostIds = fullLedger ? new Set(fullLedger.filter(e => LEDGER_LOST_RE.test(e.newStatus)).map(e => e.ticketId)) : null;

  const wonInP  = ledgerWonIds  ? all.filter(o => ledgerWonIds.has(o.id))
                : m.decidedOpps.filter(o => o.won && inPeriod(o.decidedDate, r));
  const lostInP = ledgerLostIds ? all.filter(o => ledgerLostIds.has(o.id))
                : m.decidedOpps.filter(o => !o.won && inPeriod(o.decidedDate, r));
  const undatedDecided = fullLedger ? [] : m.decidedOpps.filter(o => !o.decidedDate);

  /* True per-period conversions to projects — model history unioned with the
   * period-scoped CRMStatusLedger rows (the convert flow stamps
   * "Closed – Won"; both ledgers record WHEN). */
  const hist = historyInfo(m);
  const oppConvPred = (s: string) => LEDGER_WON_RE.test(s) || LEDGER_CONV_RE.test(s);
  const convChanges = unionLedger(changedTo(hist, "OPM", r, oppConvPred), ledger, "OPM", oppConvPred);
  const becameProjectsInP = all.filter(o => convChanges.has(o.id.toLowerCase()));
  /* An UNTRUNCATED period-scoped ledger fetch covers the period; a truncated
   * one has real rows but proves nothing about completeness — never let it
   * claim coverage or silence the honesty notes. */
  const ledgerCovers = ledgerFeedCovers(ledger, r);
  const histActive = ledgerCovers || (hist.loaded && hist.covers(r));
  const becameProjectsCard: CardModel | null = histActive ? {
    id: "pipeline", title: `Opportunities — Became Projects (${r.label})`,
    takeaway: "Pursuits whose recorded status change to a won/converted stage landed inside the period (from the status-change ledger).",
    stats: [
      { label: "Converted", value: int(becameProjectsInP.length) },
      { label: "Value", value: fmtMoney(becameProjectsInP.reduce((s, o) => s + o.value, 0)) },
    ],
    columns: OPP_COLS_D,
    rows: becameProjectsInP.map(o => oppR(o, { converted: convChanges.get(o.id.toLowerCase())?.changedAt ?? "—" })),
  } : null;

  const inactive = hasAll
    ? all.filter(o => o.closed && !o.won && !o.stage.toLowerCase().includes("lost"))
    : [];

  const openCard: CardModel = {
    id: "pipeline", title: "Opportunities — Open Pipeline",
    takeaway: "Every pursuit still in play, largest first.",
    stats: [
      { label: "Open bids", value: int(open.length) },
      { label: "Pipeline", value: fmtMoney(m.pipelineValue) },
      { label: "Weighted", value: fmtMoney(m.weightedPipeline) },
    ],
    columns: OPP_COLS_D, rows: open.map(o => oppR(o)),
  };
  const createdCard: CardModel = {
    id: "pipeline", title: `Opportunities — New (${r.label})`,
    takeaway: "Opportunities created in the period, from the recorded creation date.",
    stats: [{ label: "New opportunities", value: int(createdInP.length) }],
    columns: OPP_COLS_D, rows: createdInP.map(o => oppR(o)),
  };
  const decidedInP = [...wonInP, ...lostInP];
  const decidedCard: CardModel | null = decidedInP.length > 0 ? {
    id: "pipeline", title: `Opportunities — Decided (${r.label})`,
    takeaway: "Bids with a recorded win/loss date inside the period.",
    stats: [
      { label: "Won", value: `${int(wonInP.length)} (${fmtMoney(wonInP.reduce((s, o) => s + o.value, 0))})`, filterKey: "result" },
      { label: "Lost", value: `${int(lostInP.length)} (${fmtMoney(lostInP.reduce((s, o) => s + o.value, 0))})`, filterKey: "result" },
    ],
    columns: R_DECIDED_COLS,
    rows: decidedInP.map(o => oppR(o, { result: o.won ? "Won" : "Lost" })),
  } : null;
  const inactiveCard: CardModel | null = inactive.length > 0 ? {
    id: "pipeline", title: "Opportunities — Cancelled / On Hold / Dead (all time)",
    takeaway: "Closed pursuits that were neither won nor lost.",
    stats: [{ label: "Records", value: int(inactive.length) }],
    columns: OPP_COLS_D, rows: inactive.map(o => oppR(o)),
  } : null;

  /* charts */
  const { buckets, bucketOf } = timeBuckets(all, o => o.created, o => o.value, r);
  const byOrg = sumByOrg(open, orgDim, o => o.value);
  const ageCounts = new Map<string, number>();
  const agedRows: CardRow[] = [];
  for (const o of open) {
    const band = ageBand(o.created, nowMs);
    if (!band) continue;
    ageCounts.set(band, (ageCounts.get(band) ?? 0) + 1);
    agedRows.push(oppR(o, { ageBand: band }));
  }

  const charts: ReportChart[] = [
    {
      title: `New Opportunities — ${r.label}`,
      takeaway: "Opportunities created in the period, by recorded creation date. Click a bar for those records.",
      viz: { kind: "columns", data: buckets.map(b => ({ x: b.label, y: b.count })), color: AMBER },
      card: { ...createdCard, rows: createdInP.map(o => oppR(o, { period: bucketOf(o) ?? "—" })) },
      filterField: "period",
      wide: true,
    },
    ...((m.opmByStage ?? []).length > 0 ? [{
      title: "Open Pipeline by Stage",
      takeaway: "Where the open pipeline sits today, stage by stage.",
      viz: {
        kind: "hbars" as const,
        rows: (m.opmByStage ?? []).map(s => ({ label: s.label, v: s.value, text: `${int(s.count)} · ${fmtMoney(s.value)}` })),
        color: BLUE,
      },
      card: openCard,
      filterField: "stage",
    }] : []),
    ...(decidedInP.length > 0 && decidedCard ? [{
      title: `Won vs Lost — ${r.label}`,
      takeaway: "Bids decided during the period, by their recorded decision date.",
      viz: {
        kind: "donut" as const,
        segments: [
          { label: "Won", v: wonInP.length, color: GREEN },
          { label: "Lost", v: lostInP.length, color: RED },
        ],
        total: decidedInP.length,
        centerLabel: `${int(decidedInP.length)} decided`,
      },
      card: decidedCard,
      filterField: "result",
    }] : []),
    ...(byOrg.length > 0 ? [{
      title: `Pipeline Value by ${orgDimLabel(orgDim)}`,
      takeaway: `Open pursuit value across the organization (pursuits without a ${orgDimLabel(orgDim).toLowerCase()} are not shown).`,
      viz: { kind: "hbars" as const, rows: byOrg.map(d => ({ label: d.label, v: d.v, text: fmtMoney(d.v), filterValue: d.key })), color: GREEN },
      card: openCard,
      filterField: orgDim,
    }] : []),
    ...(agedRows.length > 0 ? [{
      title: "Open Pursuit Age",
      takeaway: "How long each open bid has been in play, from its recorded creation date.",
      viz: { kind: "hbars" as const, rows: ageRows(AGE_BANDS.map(b => b.label), ageCounts), color: LIME },
      card: {
        id: "pipeline" as const, title: "Opportunities — Age of Open Pursuits",
        takeaway: "Open pursuits with days since creation.",
        stats: [], columns: OPP_COLS_D, rows: agedRows,
      },
      filterField: "ageBand",
    }] : []),
  ];

  return {
    hero: {
      label: "Open Pipeline",
      value: fmtMoney(m.pipelineValue),
      explain: `${int(open.length)} open pursuit${open.length === 1 ? "" : "s"} · ${fmtMoney(m.weightedPipeline)} weighted by win probability.`,
      card: openCard,
    },
    kpis: [
      { label: `New (${r.label})`, value: int(createdInP.length), card: createdCard },
      { label: `Won (${r.label})`, value: `${int(wonInP.length)} · ${fmtMoney(wonInP.reduce((s, o) => s + o.value, 0))}`, card: decidedCard },
      { label: `Lost (${r.label})`, value: int(lostInP.length), card: decidedCard },
      ...(inactive.length > 0 ? [{ label: "Cancelled / on hold (all time)", value: int(inactive.length), card: inactiveCard }] : []),
      ...(histActive
        ? [{ label: `Became projects (${r.label})`, value: int(becameProjectsInP.length), card: becameProjectsCard }]
        : []),
      {
        label: "Became projects (all time)",
        value: m.conversion.oppConversionRate != null
          ? `${int(m.conversion.oppsConverted)} · ${m.conversion.oppConversionRate}%`
          : int(m.conversion.oppsConverted),
        card: m.conversion.convertedOpps.length > 0 ? {
          id: "pipeline", title: "Opportunities — Converted to Projects (all time)",
          takeaway: "Opportunities stamped Closed – Won by the convert flow. The conversion date itself isn't recorded.",
          stats: [{ label: "Converted", value: int(m.conversion.oppsConverted) }],
          columns: OPP_COLS_D, rows: m.conversion.convertedOpps.map(o => oppR(o)),
        } : null,
      },
    ],
    charts,
    notes: [
      ...(undatedDecided.length > 0
        ? [`${int(undatedDecided.length)} decided bid${undatedDecided.length === 1 ? " has" : "s have"} no recorded decision date, so they can't be placed in a period — the "won/lost this period" numbers only count dated decisions.`]
        : []),
      ...(hasAll ? [] : ["Cancelled and on-hold pursuits couldn't be loaded in this view, so \"new this period\" may undercount — refresh to load the full history."]),
    ],
  };
}


/* ═══════════════════ PROJECTS ═══════════════════ */

export function buildProjectsReport(m: ReportModel, r: PeriodRange, orgDim: OrgDim = "division"): ModuleReport {
  const PROJ_COLS_D = withOrgCol(R_PROJ_COLS, orgDim);
  const all = [...m.projects, ...m.closedProjects];
  const createdInP = all.filter(p => inPeriod(p.created, r));
  const starting = m.projects.filter(p => inPeriod(p.targetStart, r));
  const finishing = m.projects.filter(p => inPeriod(p.targetEnd, r));

  /* True per-period closes from the status-change ledger. */
  const hist = historyInfo(m);
  const closedChanges = changedTo(hist, "PMM", r, s => /closed|complete|cancel/i.test(s));
  const closedInP = all.filter(p => closedChanges.has(p.id.toLowerCase()));
  const histActive = hist.loaded && hist.covers(r);
  const closedInPCard: CardModel | null = histActive ? {
    id: "project", title: `Projects — Closed (${r.label})`,
    takeaway: "Projects whose recorded status change to a closed stage landed inside the period (from the status-change ledger).",
    stats: [{ label: "Closed", value: int(closedInP.length) }],
    columns: PROJ_COLS_D,
    rows: closedInP.map(p => projR(p, { closed: closedChanges.get(p.id.toLowerCase())?.changedAt ?? "—" })),
  } : null;

  const activeCard: CardModel = {
    id: "project", title: "Projects — Active Portfolio",
    takeaway: "Every active project, largest first.",
    stats: [
      { label: "Active projects", value: int(m.activeProjects) },
      { label: "Backlog", value: fmtMoney(m.backlogValue) },
    ],
    columns: PROJ_COLS_D, rows: m.projects.map(p => projR(p)),
  };
  const createdCard: CardModel = {
    id: "project", title: `Projects — New (${r.label})`,
    takeaway: "Projects created in the period, from the recorded creation date.",
    stats: [{ label: "New projects", value: int(createdInP.length) }],
    columns: PROJ_COLS_D, rows: createdInP.map(p => projR(p)),
  };
  const startingCard: CardModel | null = starting.length > 0 ? {
    id: "project", title: `Projects — Starting (${r.label})`,
    takeaway: "Projects whose planned start date falls inside the period.",
    stats: [{ label: "Starting", value: int(starting.length) }],
    columns: PROJ_COLS_D, rows: starting.map(p => projR(p)),
  } : null;
  const finishingCard: CardModel | null = finishing.length > 0 ? {
    id: "project", title: `Projects — Due to Finish (${r.label})`,
    takeaway: "Projects whose planned end date falls inside the period.",
    stats: [{ label: "Due to finish", value: int(finishing.length) }],
    columns: PROJ_COLS_D, rows: finishing.map(p => projR(p)),
  } : null;
  const closedCard: CardModel | null = m.closedProjects.length > 0 ? {
    id: "project", title: "Projects — Closed (all time)",
    takeaway: "Projects marked closed. The close date isn't recorded, so this list is all-time.",
    stats: [{ label: "Closed", value: int(m.closedProjects.length) }],
    columns: PROJ_COLS_D, rows: m.closedProjects.map(p => projR(p)),
  } : null;

  const { buckets, bucketOf } = timeBuckets(all, p => p.created, p => p.value, r);
  const byStatus = countBy(m.projects, p => p.status);
  const byOrg = sumByOrg(m.projects, orgDim, p => p.value)
    .slice(0, 8);

  const charts: ReportChart[] = [
    {
      title: `New Projects — ${r.label}`,
      takeaway: "Projects created in the period, by recorded creation date. Click a bar for those records.",
      viz: { kind: "columns", data: buckets.map(b => ({ x: b.label, y: b.count })), color: AMBER },
      card: { ...createdCard, rows: createdInP.map(p => projR(p, { period: bucketOf(p) ?? "—" })) },
      filterField: "period",
      wide: true,
    },
    ...(byStatus.length > 0 ? [{
      title: "Active Projects by Status",
      takeaway: "Every active project grouped by its current status.",
      viz: { kind: "hbars" as const, rows: byStatus.map(s => ({ label: s.label, v: s.v, text: int(s.v) })), color: BLUE },
      card: activeCard,
      filterField: "status",
    }] : []),
    ...(byOrg.length > 0 ? [{
      title: `Backlog Value by ${orgDimLabel(orgDim)}`,
      takeaway: `Where the signed work sits across the organization (projects without a ${orgDimLabel(orgDim).toLowerCase()} are not shown).`,
      viz: { kind: "hbars" as const, rows: byOrg.map(d => ({ label: d.label, v: d.v, text: fmtMoney(d.v), filterValue: d.key })), color: GREEN },
      card: activeCard,
      filterField: orgDim,
    }] : []),
    ...(finishing.length > 0 && finishingCard ? [{
      title: `Due to Finish — ${r.label}`,
      takeaway: "Projects planned to wrap up during the period, by value.",
      viz: {
        kind: "hbars" as const,
        rows: [...finishing].sort((a, b) => b.value - a.value).slice(0, 12)
          .map(p => ({ label: p.name, v: Math.max(1, p.value), text: p.value > 0 ? fmtMoney(p.value) : "—" })),
        color: AMBER,
      },
      card: finishingCard,
      filterField: "name",
    }] : []),
  ];

  return {
    hero: {
      label: "Active Projects",
      value: int(m.activeProjects),
      explain: `${int(m.activeProjects)} active project${m.activeProjects === 1 ? "" : "s"} worth ${fmtMoney(m.backlogValue)} in signed work.`,
      card: activeCard,
    },
    kpis: [
      { label: `New (${r.label})`, value: int(createdInP.length), card: createdCard },
      { label: `Starting (${r.label})`, value: int(starting.length), card: startingCard },
      { label: `Due to finish (${r.label})`, value: int(finishing.length), card: finishingCard },
      { label: "Overdue right now", value: int(m.overdueCount), card: activeCard },
      ...(histActive
        ? [{ label: `Closed (${r.label})`, value: int(closedInP.length), card: closedInPCard }]
        : []),
      { label: "Closed (all time)", value: int(m.closedProjects.length), card: closedCard },
    ],
    charts,
    notes: [
      ...(histActive
        ? [
            "\"Starting\" and \"due to finish\" use planned schedule dates.",
            ...trackingNote(hist, r, "project closes and phase moves"),
          ]
        : ["\"Starting\" and \"due to finish\" use planned schedule dates. The system doesn't record when a project was actually closed or moved between phases, so completed-per-week counts aren't possible yet."]),
    ],
  };
}


/* ═══════════════════ CLOSE OUT ═══════════════════ */

export type PeriodClosedProjects = {
  projects: ProjectRow[];
  closedAtById: Map<string, string>;
  historyLoaded: boolean;
  historyCoversPeriod: boolean;
};

/**
 * Projects with real evidence that they closed inside the selected period.
 * A recorded ClosedDate remains valid evidence, while the status ledger fills
 * the common case where the project was changed to Closed but ClosedDate was
 * never populated. Ticket IDs are deduplicated across both sources.
 */
export function getClosedProjectsInPeriod(m: ReportModel, r: PeriodRange): PeriodClosedProjects {
  const all = [...m.projects, ...m.closedProjects];
  const hist = historyInfo(m);
  const closedChanges = changedTo(hist, "PMM", r, s => /closed|complete|closeout/i.test(s));
  const closedAtById = new Map<string, string>();

  for (const p of m.closedProjects) {
    if (p.closedDate && inPeriod(p.closedDate, r)) {
      closedAtById.set(p.id.toLowerCase(), p.closedDate);
    }
  }
  for (const [ticketId, change] of closedChanges) {
    closedAtById.set(ticketId, change.changedAt);
  }

  return {
    projects: all.filter(p => closedAtById.has(p.id.toLowerCase())),
    closedAtById,
    historyLoaded: hist.loaded,
    historyCoversPeriod: hist.loaded && hist.covers(r),
  };
}

export function buildCloseoutReport(m: ReportModel, r: PeriodRange, now = new Date()): ModuleReport {
  const nowMs = now.getTime();
  const all = [...m.projects, ...m.closedProjects];
  const withDate = all.filter(p => p.closeoutDate);
  const enteringInP = withDate.filter(p => inPeriod(p.closeoutDate, r));
  const upcoming = m.projects.filter(p => p.closeoutDate && new Date(p.closeoutDate).getTime() > nowMs);
  const delayed = m.projects.filter(p => p.closeoutDate && new Date(p.closeoutDate).getTime() <= nowMs);

  /* True per-period closes from recorded dates and/or the status ledger. */
  const hist = historyInfo(m);
  const periodClosed = getClosedProjectsInPeriod(m, r);
  const closedInP = periodClosed.projects;
  const histActive = periodClosed.historyCoversPeriod;
  const periodCloseKnown = histActive || closedInP.length > 0;
  const closedInPCard: CardModel | null = periodCloseKnown ? {
    id: "project", title: `Close Out — Fully Closed (${r.label})`,
    takeaway: "Projects with a recorded close date or a verified status change to a closed stage inside the period.",
    stats: [{ label: "Closed", value: int(closedInP.length) }],
    columns: R_PROJ_COLS,
    rows: closedInP.map(p => projR(p, { closed: periodClosed.closedAtById.get(p.id.toLowerCase()) ?? "—" })),
  } : null;

  const withDateCard: CardModel | null = withDate.length > 0 ? {
    id: "project", title: "Close Out — Projects With a Close-Out Date",
    takeaway: "Every project that has a close-out date on record.",
    stats: [{ label: "Total Projects", value: int(withDate.length) }],
    columns: R_CLOSEOUT_COLS, rows: withDate.map(p => projR(p)),
  } : null;
  const enteringCard: CardModel | null = enteringInP.length > 0 ? {
    id: "project", title: `Close Out — Entering (${r.label})`,
    takeaway: "Projects whose close-out date falls inside the period.",
    stats: [{ label: "Entering close-out", value: int(enteringInP.length) }],
    columns: R_CLOSEOUT_COLS, rows: enteringInP.map(p => projR(p)),
  } : null;
  const delayedCard: CardModel | null = delayed.length > 0 ? {
    id: "project", title: "Close Out — Past Close-Out Date, Still Open",
    takeaway: "Active projects already past their close-out date — the close-out backlog.",
    stats: [{ label: "Total Projects", value: int(delayed.length) }],
    columns: R_CLOSEOUT_COLS, rows: delayed.map(p => projR(p)),
  } : null;
  const closedCard: CardModel | null = m.closedProjects.length > 0 ? {
    id: "project", title: "Close Out — Fully Closed Projects (all time)",
    takeaway: "Projects marked closed. The close date isn't recorded, so this list is all-time.",
    stats: [{ label: "Closed", value: int(m.closedProjects.length) }],
    columns: R_PROJ_COLS, rows: m.closedProjects.map(p => projR(p)),
  } : null;

  /* timeline across ALL close-out dates (monthly), independent of the picker —
   * with so few dated projects, restricting it to the period would blank it */
  const monthMap = new Map<string, { label: string; count: number; value: number; ym: string }>();
  for (const p of withDate) {
    const d = new Date(p.closeoutDate as string);
    if (isNaN(d.getTime())) continue;
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    const cur = monthMap.get(ym) ?? { label, count: 0, value: 0, ym };
    cur.count += 1; cur.value += p.value;
    monthMap.set(ym, cur);
  }
  const months = [...monthMap.values()].sort((a, b) => a.ym.localeCompare(b.ym));

  const charts: ReportChart[] = [
    ...(months.length > 0 && withDateCard ? [{
      title: "Close-Out Timeline (all recorded dates)",
      takeaway: "When projects are scheduled to enter close-out, month by month.",
      viz: { kind: "columns" as const, data: months.map(b => ({ x: b.label, y: b.count })), color: BLUE },
      card: {
        ...withDateCard,
        rows: withDate.map(p => {
          const d = new Date(p.closeoutDate as string);
          const label = isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
          return projR(p, { period: label });
        }),
      },
      filterField: "period",
      wide: true,
    }] : []),
    ...(withDate.length > 0 && withDateCard ? [{
      title: "Close-Out Projects by Value",
      takeaway: "The projects heading into close-out, largest first.",
      viz: {
        kind: "hbars" as const,
        rows: [...withDate].sort((a, b) => b.value - a.value).slice(0, 12)
          .map(p => ({ label: p.name, v: Math.max(1, p.value), text: p.value > 0 ? fmtMoney(p.value) : "—" })),
        color: GREEN,
      },
      card: withDateCard,
      filterField: "name",
    }] : []),
    ...(withDate.length > 0 && withDateCard ? [{
      title: "Status of Close-Out Projects",
      takeaway: "Current status of every project with a close-out date.",
      viz: {
        kind: "hbars" as const,
        rows: countBy(withDate, p => p.status).map(s => ({ label: s.label, v: s.v, text: int(s.v) })),
        color: LIME,
      },
      card: withDateCard,
      filterField: "status",
    }] : []),
  ];

  return {
    hero: {
      label: "Close-Out Coverage",
      value: `${int(withDate.length)} of ${int(all.length)}`,
      explain: withDate.length > 0
        ? `${int(withDate.length)} project${withDate.length === 1 ? " has" : "s have"} a close-out date on record — the rest can't appear in this report until a date is added.`
        : "No project has a close-out date on record yet, so this report has nothing to measure. Add close-out dates to project records to activate it.",
      card: withDateCard,
    },
    kpis: [
      { label: `Entering close-out (${r.label})`, value: int(enteringInP.length), card: enteringCard },
      { label: "Scheduled ahead", value: int(upcoming.length), card: withDateCard },
      { label: "Past date, still open", value: int(delayed.length), card: delayedCard },
      ...(periodCloseKnown
        ? [{ label: `Fully closed (${r.label})`, value: int(closedInP.length), card: closedInPCard }]
        : []),
      { label: "Fully closed (all time)", value: int(m.closedProjects.length), card: closedCard },
    ],
    charts,
    notes: [
      ...(withDate.length < all.length
        ? [`Only ${int(withDate.length)} of ${int(all.length)} projects have a close-out date. Add close-out dates to the remaining records to make this report complete.`]
        : []),
      ...(hist.loaded
        ? trackingNote(hist, r, "close-out status changes")
        : ["Close-out duration and reopened projects can't be measured yet — the system doesn't record when close-out actually started or finished, only the planned close-out date."]),
    ],
  };
}


/* ═══════════════════ hub stats ═══════════════════ */
export type HubModuleStat = { id: ReportModuleId; title: string; blurb: string; stats: { label: string; value: string }[] };

export function buildReportsHubStats(m: ReportModel, r: PeriodRange): HubModuleStat[] {
  const allLeads = m.allLeads ?? m.leads;
  const allOpps = m.allOpps ?? [...m.opps, ...m.decidedOpps];
  const allProjects = [...m.projects, ...m.closedProjects];
  const withCloseout = allProjects.filter(p => p.closeoutDate);
  const delayed = m.projects.filter(p => p.closeoutDate && new Date(p.closeoutDate).getTime() <= Date.now());
  const wonInP = m.decidedOpps.filter(o => o.won && inPeriod(o.decidedDate, r));
  const byId: Record<ReportModuleId, { label: string; value: string }[]> = {
    leads: [
      { label: "Active", value: int(m.leads.length) },
      { label: `New (${r.label})`, value: int(allLeads.filter(l => inPeriod(l.created, r)).length) },
    ],
    opportunities: [
      { label: "Open bids", value: int(m.opps.length) },
      { label: `Won (${r.label})`, value: int(wonInP.length) },
    ],
    projects: [
      { label: "Active", value: int(m.activeProjects) },
      { label: `New (${r.label})`, value: int(allProjects.filter(p => inPeriod(p.created, r)).length) },
    ],
    closeout: [
      { label: "With close-out date", value: int(withCloseout.length) },
      { label: "Past date, open", value: int(delayed.length) },
    ],
  };
  return REPORT_MODULES.map(mod => ({ ...mod, stats: byId[mod.id] }));
}

/**
 * Hub-level period/history coverage notes — same honesty contract as module
 * reports. These disclose when "Won in period" or "Closed in period" hub KPIs
 * are known to be incomplete:
 *   • Decided bids without a recorded decision date can't be placed in a period.
 *   • Closed projects without a closedDate can't be placed in a period.
 *   • Conversion rates are always all-time (no per-record conversion date).
 * Pure function — no React, safe to test in the honesty script.
 */
export function buildHubHonestyNotes(m: ReportModel, r?: PeriodRange): string[] {
  const notes: string[] = [];
  const undatedDecided = m.decidedOpps.filter(o => !o.decidedDate).length;
  if (undatedDecided > 0) {
    notes.push(
      `${undatedDecided} decided bid${undatedDecided === 1 ? "" : "s"} have no recorded decision date — the "Won in period" count only covers dated decisions.`
    );
  }
  const noCloseDate = m.closedProjects.filter(p => !p.closedDate).length;
  const hist = r ? historyInfo(m) : null;
  const historyCoversPeriod = !!(r && hist?.loaded && hist.covers(r));
  if (noCloseDate > 0 && !historyCoversPeriod) {
    notes.push(
      hist?.loaded
        ? `${noCloseDate} closed project${noCloseDate === 1 ? "" : "s"} have no recorded close date. Their recorded status changes are included, but tracking does not fully cover the selected period, so "Closed in period" may be incomplete.`
        : `${noCloseDate} closed project${noCloseDate === 1 ? "" : "s"} have no recorded close date — the "Closed in period" count covers only those with a date.`
    );
  }
  return notes;
}

export const MODULE_BUILDERS: Record<
  ReportModuleId,
  (m: ReportModel, r: PeriodRange, now?: Date, ledger?: LedgerFeed, orgDim?: OrgDim) => ModuleReport
> = {
  leads: (m, r, now, ledger, orgDim) => buildLeadsReport(m, r, now, ledger, orgDim),
  opportunities: (m, r, now, ledger, orgDim) => buildOppsReport(m, r, now, ledger, orgDim),
  projects: (m, r, _now, _ledger, orgDim) => buildProjectsReport(m, r, orgDim),
  closeout: (m, r, now) => buildCloseoutReport(m, r, now),
};

function historyInfo(m: ReportModel): HistoryInfo {
  const rows = m.statusHistory ?? null;
  const since = m.statusHistorySince ? new Date(m.statusHistorySince) : null;
  const okSince = since && !isNaN(since.getTime()) ? since : null;
  /* Truncation honesty: the server returns rows newest-first with a cap. When
   * the cap was hit, older changes are MISSING from `rows`, so the complete
   * window only reaches back to the OLDEST returned row — coverage must be
   * assessed from that, never from tenant-wide `since`, or counts would
   * silently undercount while claiming full coverage. */
  let coverageStart = okSince;
  if (m.statusHistoryTruncated && rows && rows.length > 0) {
    let oldest: Date | null = null;
    for (const row of rows) {
      const d = new Date(row.changedAt);
      if (!isNaN(d.getTime()) && (oldest == null || d.getTime() < oldest.getTime())) oldest = d;
    }
    coverageStart = oldest ?? null; // unparseable dates → no coverage claim
    if (coverageStart == null) coverageStart = new Date(); // fail-closed: never covers past periods
  }
  return {
    loaded: rows != null,
    rows: rows ?? [],
    since: okSince,
    coverageStart,
    covers: (r) => coverageStart != null && coverageStart.getTime() <= r.start.getTime(),
  };
}

/** History rows for a module whose change landed inside the period and whose
 *  NEW status matches `pred`. Newest change wins per ticket (a record that
 *  converted then reverted inside the period is not counted). */
function changedTo(
  h: HistoryInfo, module: StatusChangeItem["module"], r: PeriodRange,
  pred: (newStatus: string) => boolean,
): Map<string, StatusChangeItem> {
  const latest = new Map<string, StatusChangeItem>(); // ticket lower → newest in-period change
  for (const row of h.rows) {
    if (row.module !== module || !inPeriod(row.changedAt, r)) continue;
    const key = row.ticketId.toLowerCase();
    const cur = latest.get(key);
    if (!cur || new Date(row.changedAt).getTime() > new Date(cur.changedAt).getTime()) latest.set(key, row);
  }
  const out = new Map<string, StatusChangeItem>();
  for (const [key, row] of latest) {
    if (pred(String(row.newStatus ?? ""))) out.set(key, row);
  }
  return out;
}

/** Honest partial-coverage note when tracking began after the period start. */
function trackingNote(h: HistoryInfo, r: PeriodRange, what: string): string[] {
  if (!h.loaded) return [];
  if (h.covers(r)) return [];
  const sinceTxt = h.coverageStart
    ? h.coverageStart.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;
  return [sinceTxt
    ? `Recorded status changes cover ${sinceTxt} onward — ${what} before then can't be dated, so counts for periods starting earlier may be incomplete.`
    : `Status-change tracking just started — ${what} will appear in per-period counts as changes are recorded.`];
}
