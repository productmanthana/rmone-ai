/* ─────────────────────────────────────────────────────────────
 * analyticsCenter.ts — data layer for the Analytics Center hub.
 * Every number derives from the SAME ReportModel that feeds
 * /analytics and /intelligence, so the hub can never disagree
 * with the source pages. Real data only: no fabricated trends,
 * deltas or history — tiles show live composition instead.
 * ──────────────────────────────────────────────────────────── */
import {
  fmtMoney, fmtMoneyFull, fmtDateShort,
  type ReportModel, type StaffRow, type DemandRow, type ProjectRow, type OppRow,
} from "@/lib/reportData";

/* ── sections ── */
export type SectionId =
  | "executive" | "pipeline" | "financial" | "project" | "staff" | "resource"
  | "utilization" | "bench" | "open-positions" | "recruitment" | "usage";

export const SECTION_TITLES: Record<SectionId, string> = {
  executive: "Executive",
  pipeline: "Pipeline",
  financial: "Financial",
  project: "Project",
  staff: "Staff",
  resource: "Resource",
  utilization: "Utilization",
  bench: "Bench",
  "open-positions": "Open Positions & Demand",
  recruitment: "Recruitment",
  usage: "Usage Analytics",
};

/* ── explanation / drill contract ─────────────────────────────
 *  Backward-compatible: explanation is optional on CardModel.
 *  All fields are optional so partial metadata is safe.
 * ─────────────────────────────────────────────────────────── */
export type CardExplanation = {
  /** Plain-English meaning of this metric — "What this means" */
  meaning: string;
  /** How the number is calculated — "How it is calculated" */
  calculation: string;
  /** Time window the data covers, e.g. "Current snapshot" or "This fiscal year" */
  period?: string;
  /** Whether the value is directly from source (planned/actual) or derived */
  measure?: "planned" | "actual" | "derived";
  /** Data source or system the rows come from */
  source?: string;
  /** 0–1 completeness fraction, or a short note, e.g. "All records loaded" */
  completeness?: number | string;
  /** Override totals for specific columns by key (when auto-sum is wrong) */
  totals?: Record<string, number | string>;
};

/* ── card model: one drill-down table (feeds the data drawer AND the
 *    per-card PDF / Excel exports, so screen and file always match) ── */
export type CardColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
  /** cell formatting shared by UI + exports */
  kind?: "text" | "money" | "moneyFull" | "int" | "pct" | "date";
  /** Excel column width */
  width?: number;
};
/** Rows may carry hidden _ticket / _person / _personId fields — the drawer
 *  derives record links from them via lib/issueLink (never text-sniffed). */
export type CardRow = Record<string, unknown>;
export type CardModel = {
  id: SectionId;
  title: string;
  takeaway: string;
  stats: { label: string; value: string; filterKey?: string }[];
  columns: CardColumn[];
  rows: CardRow[];
  /** Optional explanation metadata — shown in the DataDrawer header */
  explanation?: CardExplanation;
};

export type Tone = "good" | "warn" | "bad";

/* ── pure helpers (exported for honesty checks) ──────────────── */

/**
 * Returns true when a column kind is safely summable (int or money).
 * pct columns are intentionally excluded — averaging percentages requires weights.
 */
export function isSafelysummable(col: CardColumn): boolean {
  return col.kind === "int" || col.kind === "money" || col.kind === "moneyFull";
}

/**
 * Compute a total row for the given rows and columns.
 * Only sums columns where isSafelysummable() is true.
 * Explicit overrides from explanation.totals take precedence.
 * Returns null when no column is summable.
 */
export function computeTotalRow(
  rows: CardRow[],
  columns: CardColumn[],
  totalsOverride?: Record<string, number | string>,
): CardRow | null {
  const summable = columns.filter(isSafelysummable);
  if (summable.length === 0) return null;
  const result: CardRow = { _isTotalRow: true };
  for (const col of summable) {
    if (totalsOverride && col.key in totalsOverride) {
      result[col.key] = totalsOverride[col.key];
    } else {
      let sum = 0;
      for (const row of rows) {
        const v = row[col.key];
        if (v !== null && v !== undefined && v !== "") {
          sum += Number(v) || 0;
        }
      }
      result[col.key] = sum;
    }
  }
  return result;
}

/**
 * Return a sensible default explanation for any CardModel so legacy cards
 * (those without an explicit explanation field) still show meaningful guidance
 * in the DataDrawer.
 */
export function defaultExplanation(card: CardModel): CardExplanation {
  if (card.explanation) return card.explanation;
  const rowCount = card.rows.length;
  // Strictly neutral fallback — this card did not declare its own explanation,
  // so make NO claims at all: not about row provenance, not about how the
  // headline is derived from these rows, not about a data source, and not
  // about completeness. Rows may be synthetic aggregates or capped lists, and
  // the headline may not be a simple count/sum of them. The card's own
  // takeaway is the only authoritative description. `measure` is deliberately
  // omitted — asserting "actual" would itself be a claim.
  return {
    meaning: card.takeaway || `The rows shown for "${card.title}".`,
    calculation: `This card hasn't declared how its number is derived. ${rowCount.toLocaleString("en-US")} row${rowCount === 1 ? " is" : "s are"} displayed — see the card's own description for what each row represents; the headline may not be a simple count or sum of these rows.`,
    period: "As of the last page load.",
    source: "Not declared by this card — see its description.",
    completeness: rowCount > 0
      ? `${rowCount.toLocaleString("en-US")} row${rowCount === 1 ? "" : "s"} displayed. Coverage isn't declared — the list may be capped or aggregated.`
      : "No rows behind this number.",
  };
}

/**
 * Return a copy of `card` filtered to rows where `rows[field] === value`.
 * Handles truncated bar labels ending in "…" via startsWith fallback.
 * Falls back to the full card if the filter yields 0 or all rows.
 */
export function filterCardByField(card: CardModel, field: string, value: string): CardModel {
  const clean = value.endsWith("…") ? value.slice(0, -1) : value;
  const rows = card.rows.filter(r => {
    const v = isOrgDim(field)
      ? (orgKeyOf(r, field) ?? "")
      : String(r[field] ?? "");
    return v === value || (clean !== value && v.startsWith(clean));
  });
  // Return the original card unchanged only when the filter matches everything
  // (no meaningful filtering happened). When 0 rows match, still return the
  // filtered result — the DataDrawer already shows "No rows behind this number".
  if (rows.length >= card.rows.length) return card;
  const displayValue = rows.length > 0 && isOrgDim(field)
    ? String(rows[0][field] ?? value)
    : rows.length === 1 ? String(rows[0][field] ?? value) : value;
  return {
    ...card,
    title: `${card.title} — ${displayValue}`,
    takeaway: rows.length === 0
      ? `No records found for "${displayValue}".`
      : `Showing ${rows.length === 1 ? "1 entry" : `${rows.length} entries`} for "${displayValue}".`,
    stats: [],
    rows,
  };
}

/* ── tile visuals (each tile a DIFFERENT micro-treatment — variety
 *    mandate from the chosen Mission Control style) ── */
export type TileViz =
  | { kind: "bars"; rows: { label: string; v: number; text?: string }[]; max: number; color?: string; suffix?: string }
  | { kind: "gauge"; pct: number; label: string; caption: string }
  | { kind: "segments"; total: number; segments: { label: string; v: number; color: string }[] }
  | { kind: "chips"; items: { label: string; v: string }[] }
  | { kind: "pairs"; pairs: { label: string; value: string; color?: string }[] }
  | { kind: "note"; text: string };

export type HubTile = {
  id: SectionId;
  title: string;
  badge?: "financial" | "admin";
  hero: string;
  heroUnit?: string;
  takeaway: string;
  sub: string;
  chip?: { text: string; tone: Tone };
  /** If set, the tile footer shows a "View full report" link to this path. */
  reportHref?: string;
  viz: TileViz;
  /** null = no drill data yet (Usage before telemetry ships) */
  card: CardModel | null;
};

export type HubData = {
  ticker: { label: string; val: string; tone: Tone; detail?: CardModel }[];
  hero: {
    label: string;
    value: string;
    explain: string;
    /** real composition stats shown beside the headline (no fake trends) */
    side: { label: string; value: string }[];
  };
  tiles: HubTile[];
};

/* ── organization dimension contract (shared by Reports + Analytics) ──
 * Business Unit, Division and Department are SEPARATE canonical dimensions:
 * each reads ONLY its own field — never another dimension's label as a
 * fallback. That single-source rule is what keeps a Business Unit named
 * "East" from silently merging into a Division named "East": identity is
 * (dimension, canonical label), so same-name units in different dimensions
 * can never collide, and a record with no value for the selected dimension
 * stays honestly "Unassigned". */
export type OrgDim = "division" | "businessUnit" | "department";
export const ORG_DIMS: readonly { key: OrgDim; label: string; short: string }[] = [
  { key: "division", label: "Division", short: "Div" },
  { key: "businessUnit", label: "Business Unit", short: "BU" },
  { key: "department", label: "Department", short: "Dept" },
] as const;
export function orgDimLabel(dim: OrgDim): string {
  return ORG_DIMS.find(d => d.key === dim)?.label ?? "Division";
}
/** Pick the SELECTED dimension's value — and ONLY that dimension's.
 *  Returns null when the selected dimension has no data; callers must render
 *  an honest absence state, never another dimension's list (which would show
 *  bars whose drill filters find nothing). Shared by the Bench / Financial
 *  org cards so the no-cross-dimension-fallback rule lives in one place. */
export function selectByOrgDim<T>(
  dim: OrgDim,
  opts: { division: T | null; businessUnit: T | null; department: T | null },
): T | null {
  return opts[dim] ?? null;
}
/** Rows carrying the three canonical org fields (ProjectRow / OppRow /
 *  LeadRow / StaffRow all match structurally). */
export type OrgFields = {
  division?: string | null;
  businessUnit?: string | null;
  department?: string | null;
  divisionId?: string | null;
  businessUnitId?: string | null;
  departmentId?: string | null;
};
export type OrgGroup = { label: string; key: string; v: number };
function isOrgDim(field: string): field is OrgDim {
  return field === "division" || field === "businessUnit" || field === "department";
}
/** The selected dimension's value for a row — canonical field ONLY, no
 *  cross-dimension fallback. "—" placeholders count as missing. */
export function orgValueOf(row: OrgFields, dim: OrgDim): string | null {
  const v = row[dim];
  const s = (v ?? "").trim();
  return s && s !== "—" ? s : null;
}
/** A stable, dimension-local organization key. New payloads use the database
 * ID; name identity is retained only for legacy payloads without that ID. */
export function orgKeyOf(row: OrgFields, dim: OrgDim): string | null {
  const label = orgValueOf(row, dim);
  if (!label) return null;
  const id = row[`${dim}Id` as const];
  const stableId = typeof id === "string" ? id.trim() : "";
  return stableId ? `id:${stableId}` : `name:${label}`;
}
/** Select the records for one ID-first organization group. Shared by legacy
 * and current Analytics views so no drill falls back to a display label. */
export function filterRowsByOrgKey<T extends OrgFields>(rows: T[], dim: OrgDim, key: string): T[] {
  return rows.filter(row => orgKeyOf(row, dim) === key);
}
/** Group an org dimension by stable ID when present. Duplicate display names
 * receive a deterministic ordinal so separate bars remain understandable. */
export function sumByOrg<T extends OrgFields>(
  rows: T[],
  dim: OrgDim,
  val: (row: T) => number,
): OrgGroup[] {
  const groups = new Map<string, { label: string; v: number }>();
  for (const row of rows) {
    const key = orgKeyOf(row, dim);
    const label = orgValueOf(row, dim);
    if (!key || !label) continue;
    const group = groups.get(key) ?? { label, v: 0 };
    group.v += val(row);
    groups.set(key, group);
  }
  const labelKeys = new Map<string, string[]>();
  for (const [key, group] of groups) {
    const keys = labelKeys.get(group.label) ?? [];
    keys.push(key);
    labelKeys.set(group.label, keys);
  }
  for (const keys of labelKeys.values()) keys.sort((a, b) => a.localeCompare(b));
  return [...groups.entries()]
    .map(([key, group]) => {
      const matches = labelKeys.get(group.label) ?? [];
      const index = matches.indexOf(key);
      return {
        key,
        label: matches.length > 1 ? `${group.label} (${index + 1})` : group.label,
        v: group.v,
      };
    })
    .sort((a, b) => b.v - a.v || a.label.localeCompare(b.label));
}
export function countByOrg<T extends OrgFields>(rows: T[], dim: OrgDim): OrgGroup[] {
  return sumByOrg(rows, dim, () => 1);
}

/* ── small helpers ── */
export function countBy<T>(rows: T[], key: (r: T) => string | null | undefined): { label: string; v: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = (key(r) || "").trim() || "Unassigned";
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].map(([label, v]) => ({ label, v })).sort((a, b) => b.v - a.v);
}
export function sumBy<T>(rows: T[], key: (r: T) => string | null | undefined, val: (r: T) => number): { label: string; v: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = (key(r) || "").trim() || "Unassigned";
    map.set(k, (map.get(k) ?? 0) + val(r));
  }
  return [...map.entries()].map(([label, v]) => ({ label, v })).sort((a, b) => b.v - a.v);
}
export const int = (n: number) => n.toLocaleString("en-US");

/** Shared cell formatter for CardModel rows (drawer + PDF text use the
 *  same output; lives here so the drawer never pulls the export chunk). */
export function fmtCell(v: unknown, col: CardColumn): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (col.kind) {
    case "money": return fmtMoney(Number(v) || 0);
    case "moneyFull": return fmtMoneyFull(Number(v) || 0);
    case "pct": return `${Math.round(Number(v) || 0)}%`;
    case "int": return Math.round(Number(v) || 0).toLocaleString("en-US");
    case "date": return fmtDateShort(String(v));
    default: return String(v);
  }
}

/* ── card columns (shared shapes) ── */
export const PROJECT_COLS: CardColumn[] = [
  { key: "id", label: "ID", width: 15 },
  { key: "name", label: "Project", width: 38 },
  { key: "client", label: "Client", width: 24 },
  { key: "division", label: "Division", width: 18 },
  { key: "sector", label: "Sector", width: 18 },
  { key: "value", label: "Value", kind: "money", align: "right", width: 13 },
  { key: "status", label: "Status", width: 16 },
];
export const FINANCIAL_COLS: CardColumn[] = [
  { key: "id", label: "ID", width: 15 },
  { key: "name", label: "Project", width: 38 },
  { key: "client", label: "Client", width: 24 },
  { key: "value", label: "Contract Value", kind: "moneyFull", align: "right", width: 17 },
  { key: "laborContract", label: "Labor Contract", kind: "moneyFull", align: "right", width: 17 },
  { key: "forecastCost", label: "Forecast Cost", kind: "moneyFull", align: "right", width: 17 },
];
export const SCHEDULE_COLS: CardColumn[] = [
  { key: "id", label: "ID", width: 15 },
  { key: "name", label: "Project", width: 38 },
  { key: "client", label: "Client", width: 24 },
  { key: "schedule", label: "Schedule", width: 18 },
  { key: "targetEnd", label: "Target End", kind: "date", width: 14 },
  { key: "value", label: "Value", kind: "money", align: "right", width: 13 },
];
export const STAFF_COLS: CardColumn[] = [
  { key: "name", label: "Person", width: 26 },
  { key: "role", label: "Role", width: 24 },
  { key: "division", label: "Division", width: 20 },
  { key: "totalProjects", label: "Total Projects", kind: "int", align: "right", width: 12 },
  { key: "utilization", label: "Utilization", kind: "pct", align: "right", width: 12 },
  { key: "band", label: "Load", width: 12 },
];
export const DEMAND_COLS: CardColumn[] = [
  { key: "ticket", label: "Project ID", width: 15 },
  { key: "project", label: "Project", width: 38 },
  { key: "role", label: "Role Needed", width: 24 },
  { key: "pct", label: "Allocation", kind: "pct", align: "right", width: 12 },
  { key: "start", label: "From", kind: "date", width: 13 },
  { key: "end", label: "To", kind: "date", width: 13 },
  { key: "type", label: "Type", width: 11 },
];
export const OPP_COLS: CardColumn[] = [
  { key: "id", label: "ID", width: 15 },
  { key: "name", label: "Opportunity", width: 38 },
  { key: "client", label: "Client", width: 24 },
  { key: "stage", label: "Stage", width: 20 },
  { key: "value", label: "Value", kind: "money", align: "right", width: 13 },
  { key: "weighted", label: "Weighted", kind: "money", align: "right", width: 13 },
];
export const DECIDED_COLS: CardColumn[] = [
  { key: "id", label: "ID", width: 15 },
  { key: "name", label: "Opportunity", width: 38 },
  { key: "client", label: "Client", width: 24 },
  { key: "result", label: "Result", width: 12 },
  { key: "value", label: "Value", kind: "money", align: "right", width: 13 },
  { key: "sector", label: "Sector", width: 18 },
];

export function projRows(list: ProjectRow[]): CardRow[] {
  return list.map(p => ({ ...p, client: p.client ?? "—", division: p.division ?? "—", _ticket: p.id }));
}
export function scheduleRows(list: ProjectRow[]): CardRow[] {
  return list.map(p => ({
    ...p,
    client: p.client ?? "—",
    // Keep the short category separate from the display label so summary
    // cards can filter "Overdue" without losing the days-overdue detail.
    scheduleGroup: p.overdue ? "Overdue" : p.noDate ? "No end date" : "On schedule",
    schedule: p.overdue ? `Overdue${p.daysOverdue != null ? ` ${p.daysOverdue}d` : ""}` : p.noDate ? "No end date" : "On schedule",
    _ticket: p.id,
  }));
}
export function staffRows(list: StaffRow[]): CardRow[] {
  return list.map(s => ({
    ...s,
    role: s.role ?? "—",
    division: s.division ?? "—",
    totalProjects: s.totalProjects ?? s.activeProjects,
    utilization: Math.round(s.utilization),
    _person: s.name,
  }));
}
export function demandRows(list: DemandRow[]): CardRow[] {
  return list.map(d => ({ ...d, pct: Math.round(d.pct), type: d.soft ? "Soft" : "Committed", _ticket: d.ticket }));
}
export function oppRows(list: OppRow[]): CardRow[] {
  return list.map(o => ({
    ...o,
    client: o.client ?? "—",
    sector: o.sector ?? "—",
    /* Organization fields and IDs are deliberately retained even when not
     * visible in OPP_COLS: org chart drills filter this full source row. */
    division: o.division ?? "—",
    stage: o.stage,
    value: o.value,
    weighted: Math.round(o.weighted),
    _ticket: o.id,
  }));
}
export function decidedRows(list: OppRow[]): CardRow[] {
  return list.map(o => ({
    id: o.id, name: o.name, client: o.client ?? "—",
    result: o.won ? "Won" : "Lost", value: o.value, sector: o.sector ?? "—", _ticket: o.id,
  }));
}

/* ── the hub ── */
export function buildHubData(m: ReportModel): HubData {
  /* Data honesty: a source that failed to load is an unknown, not a zero.
   * Legacy models without `sources` are assumed complete. */
  const recordsOk = m.sources ? m.sources.records : true;
  const staffingOk = m.sources ? m.sources.staffing : true;
  const demandsOk = m.sources ? m.sources.demands : true;
  const people = staffingOk ? int(m.totalStaff) : "—";
  const openPos = demandsOk ? int(m.openDemands) : "—";

  /* real per-division compositions */
  const staffByDiv = countBy(m.staff, s => s.division);
  const backlogByDiv = (m.backlogByDivision ?? []).slice(0, 5);
  const avgUtil = m.staff.length
    ? m.staff.reduce((a, s) => a + s.utilization, 0) / m.staff.length
    : 0;
  const deployed = m.staff.filter(s => s.activeProjects > 0);
  const benchStaff = m.staff
    .filter(s => s.band === "Available" || s.band === "Light")
    .sort((a, b) => a.utilization - b.utilization);
  const demandByRole = countBy(m.demands, d => d.role);
  const marginRisk = m.projects.filter(p => p.overdue && p.value > 0);

  /* ── ticker: live values with tone dots (no fake ▲▼ deltas — there is
   *    no stored history to compare against) ── */
  const benchShare = m.totalStaff > 0 ? m.benchCount / m.totalStaff : 0;
  const overdueProjects = m.projects.filter(p => p.overdue);
  const committedDemands = m.demands.filter(d => !d.soft);
  const ticker: HubData["ticker"] = [
    ...(recordsOk
      ? [
          {
            label: "Backlog", val: fmtMoney(m.backlogValue), tone: "good" as Tone,
            detail: {
              id: "executive" as SectionId, title: "Signed Backlog",
              takeaway: `${int(m.activeProjects)} active contracts totalling ${fmtMoney(m.backlogValue)}`,
              stats: [
                { label: "Total Value", value: fmtMoney(m.backlogValue) },
                { label: "Active Projects", value: int(m.activeProjects) },
                { label: "Avg Value", value: fmtMoney(m.avgProjectValue) },
              ],
              columns: PROJECT_COLS, rows: projRows(m.projects),
              explanation: {
                meaning: "The total contract value of all currently active, signed projects. This is the firm's committed work in the bank.",
                calculation: "Sum of the contract value field across all projects with Active status. Each project row contributes its full value.",
                period: "Current snapshot",
                measure: "actual" as const,
                source: "Project records",
                completeness: recordsOk ? "All project records loaded" : "Partial — some records may be missing",
              },
            },
          },
          {
            label: "Active Projects", val: int(m.activeProjects), tone: "good" as Tone,
            detail: {
              id: "project" as SectionId, title: "Active Projects",
              takeaway: `${m.onScheduleCount} on schedule · ${m.overdueCount} overdue · ${m.noDateCount} missing an end date`,
              stats: [
                { label: "On Schedule", value: int(m.onScheduleCount) },
                { label: "Overdue", value: int(m.overdueCount) },
                { label: "No Date", value: int(m.noDateCount) },
              ],
              columns: SCHEDULE_COLS, rows: scheduleRows(m.projects),
              explanation: {
                meaning: "Count of projects currently in Active status, showing their schedule health.",
                calculation: "Each row is one active project. Overdue = target end date is in the past. No Date = no target end date set.",
                period: "Current snapshot",
                measure: "actual" as const,
                source: "Project records",
                completeness: recordsOk ? "All project records loaded" : "Partial",
              },
            },
          },
          {
            label: "Pipeline", val: fmtMoney(m.pipelineValue), tone: "good" as Tone,
            detail: {
              id: "executive" as SectionId, title: "Open Pipeline",
              takeaway: `${int(m.activeBids)} active pursuits · ${fmtMoney(m.weightedPipeline)} weighted`,
              stats: [
                { label: "Pursuits", value: int(m.activeBids) },
                { label: "Total Value", value: fmtMoney(m.pipelineValue) },
                { label: "Weighted", value: fmtMoney(m.weightedPipeline) },
              ],
              columns: OPP_COLS, rows: oppRows(m.opps),
              explanation: {
                meaning: "The total face value of every open opportunity still in play (not yet won or lost).",
                calculation: "Sum of the value field across all opportunities in an active/open stage. Weighted pipeline applies a stage-based probability factor.",
                period: "Current snapshot",
                measure: "actual" as const,
                source: "Opportunity records",
                completeness: recordsOk ? "All opportunity records loaded" : "Partial",
              },
            },
          },
          ...(m.winRate != null
            ? [{
                label: "Win Rate", val: `${m.winRate}%`,
                tone: (m.winRate >= 50 ? "good" : m.winRate >= 25 ? "warn" : "bad") as Tone,
                detail: {
                  id: "executive" as SectionId, title: "Win Rate Breakdown",
                  takeaway: `${int(m.wonCount)} won · ${int(m.lostCount)} lost of ${int(m.wonCount + m.lostCount)} decided bids`,
                  stats: [
                    { label: "Won", value: int(m.wonCount) },
                    { label: "Lost", value: int(m.lostCount) },
                    { label: "Win Rate", value: `${m.winRate}%` },
                  ],
                  columns: DECIDED_COLS, rows: decidedRows(m.decidedOpps),
                  explanation: {
                    meaning: "The percentage of decided (won or lost) bids that were won. Excludes pursuits still in progress.",
                    calculation: "Won ÷ (Won + Lost) × 100, rounded to the nearest whole number. Only decided opportunities are counted.",
                    period: "All-time based on available historical data",
                    measure: "derived" as const,
                    source: "Decided opportunity records",
                    completeness: recordsOk ? "All decided records loaded" : "Partial",
                  },
                },
              }]
            : []),
        ]
      : []),
    ...(staffingOk
      ? [
          {
            label: "Staff", val: int(m.totalStaff), tone: "good" as Tone,
            detail: {
              id: "staff" as SectionId, title: "All Staff",
              takeaway: `${int(m.totalStaff)} people · ${m.deployedRate != null ? `${m.deployedRate}% deployed on projects` : "deployment data unavailable"}`,
              stats: [
                { label: "Total", value: int(m.totalStaff) },
                { label: "Deployed", value: m.deployedRate != null ? `${m.deployedRate}%` : "—" },
                { label: "Overloaded", value: int(m.overAllocCount) },
              ],
              columns: STAFF_COLS, rows: staffRows(m.staff),
              explanation: {
                meaning: "Every person in the workforce, showing their current role, division, and utilization load.",
                calculation: "One row per staff member. Utilization is the sum of their active project allocations as a percentage of a full-time role.",
                period: "Current snapshot",
                measure: "actual" as const,
                source: "Staffing records",
                completeness: staffingOk ? "All staff records loaded" : "Partial",
              },
            },
          },
          {
            label: "Bench", val: int(m.benchCount),
            tone: (benchShare > 0.2 ? "bad" : benchShare > 0.1 ? "warn" : "good") as Tone,
            detail: {
              id: "bench" as SectionId, title: "Available Bench",
              takeaway: `${int(m.benchCount)} people with little or no project work`,
              stats: [
                { label: "Fully Available", value: int(m.staff.filter(s => s.band === "Available").length) },
                { label: "Lightly Loaded", value: int(m.staff.filter(s => s.band === "Light").length) },
                { label: "Share of Headcount", value: `${Math.round(benchShare * 100)}%` },
              ],
              columns: STAFF_COLS, rows: staffRows(benchStaff),
              explanation: {
                meaning: "People who are fully available or only lightly loaded — they have capacity for new project assignments.",
                calculation: "Filtered to staff with utilization bands of Available (0–20%) or Light (20–50%). Sorted by utilization ascending so the most available appear first.",
                period: "Current snapshot",
                measure: "actual" as const,
                source: "Staffing records",
                completeness: staffingOk ? "All staff records loaded" : "Partial",
              },
            },
          },
        ]
      : []),
    ...(demandsOk
      ? [{
          label: "Open Positions", val: int(m.openDemands),
          tone: (m.openDemands > 0 ? "warn" : "good") as Tone,
          detail: {
            id: "open-positions" as SectionId, title: "Open Positions & Demand",
            takeaway: `${int(m.openDemands)} unfilled roles across active projects`,
            stats: [
              { label: "Total Openings", value: int(m.openDemands) },
              { label: "Committed", value: int(committedDemands.length) },
              { label: "Soft Requests", value: int(m.demands.filter(d => d.soft).length) },
            ],
            columns: DEMAND_COLS, rows: demandRows(m.demands),
            explanation: {
              meaning: "Each row is a role a project still needs filled. These are open demand records — no staff member is yet assigned.",
              calculation: "Count of demand records without a confirmed assignment. Committed = formally required; Soft = requested but not yet locked.",
              period: "Current snapshot",
              measure: "actual" as const,
              source: "Demand / staffing request records",
              completeness: demandsOk ? "All demand records loaded" : "Partial",
            },
          },
        }]
      : []),
    ...(recordsOk
      ? [{
          label: "Overdue", val: int(m.overdueCount),
          tone: (m.overdueCount === 0 ? "good" : m.overdueCount > m.activeProjects * 0.15 ? "bad" : "warn") as Tone,
          detail: overdueProjects.length > 0 ? {
            id: "project" as SectionId, title: "Overdue Projects",
            takeaway: `${int(m.overdueCount)} projects past their target end date`,
            stats: [
              { label: "Overdue", value: int(m.overdueCount) },
              { label: "Carrying Value", value: int(m.marginRiskCount) },
              { label: "On Schedule", value: int(m.onScheduleCount) },
            ],
            columns: SCHEDULE_COLS, rows: scheduleRows(overdueProjects),
            explanation: {
              meaning: "Active projects whose target end date has already passed. These represent schedule risk and potential margin exposure.",
              calculation: "Filtered to active projects where targetEnd < today. Value shows the contract dollars still at risk.",
              period: "Current snapshot",
              measure: "actual" as const,
              source: "Project records",
              completeness: recordsOk ? "All project records loaded" : "Partial",
            },
          } : undefined,
        }]
      : []),
  ];

  const hero: HubData["hero"] = recordsOk
    ? {
        label: "Signed Work In The Bank",
        value: fmtMoney(m.backlogValue),
        explain: `Total value of ${int(m.activeProjects)} approved, active contracts.`,
        side: [
          { label: "Open pipeline", value: fmtMoney(m.pipelineValue) },
          { label: "Weighted pipeline", value: fmtMoney(m.weightedPipeline) },
          { label: "Active bids", value: int(m.activeBids) },
          { label: "People", value: people },
        ],
      }
    : {
        label: "Signed Work In The Bank",
        value: "—",
        explain: "Project and pipeline records didn't fully load, so no headline number is shown. Refresh to try again.",
        side: [{ label: "People", value: people }],
      };

  /* ── tiles (each with its own drill-down card) ── */
  const tiles: HubTile[] = [
    {
      id: "executive",
      title: "Executive",
      hero: fmtMoney(m.backlogValue),
      takeaway: "The total value of signed, active work across the whole firm.",
      sub: `${int(m.activeProjects)} active projects · ${fmtMoney(m.pipelineValue)} in pursuit · ${people} people`,
      reportHref: "/reports",
      viz: {
        kind: "bars",
        rows: backlogByDiv.map(d => ({ label: d.label, v: d.value, text: fmtMoney(d.value) })),
        max: Math.max(1, ...backlogByDiv.map(d => d.value)),
        color: "#8EC94A",
      },
      card: {
        id: "executive",
        title: "Executive — Active Portfolio",
        takeaway: "Every active project behind the backlog number, largest first.",
        stats: [
          { label: "Backlog", value: fmtMoney(m.backlogValue) },
          { label: "Active projects", value: int(m.activeProjects) },
          { label: "Pipeline", value: fmtMoney(m.pipelineValue) },
          { label: "Avg project value", value: fmtMoney(m.avgProjectValue) },
        ],
        columns: PROJECT_COLS,
        rows: projRows(m.projects),
        explanation: {
          meaning: "Every active project contributing to the signed backlog. The tile hero (top number) is the sum of all contract values shown here.",
          calculation: "Rows filtered to Active status projects, sorted by contract value descending. The backlog total is the sum of the Value column.",
          period: "Current snapshot",
          measure: "actual" as const,
          source: "Project records",
          completeness: recordsOk ? "All project records loaded" : "Partial",
        },
      },
    },
    {
      id: "pipeline",
      title: "Pipeline",
      hero: fmtMoney(m.pipelineValue),
      takeaway: "The value of every pursuit still in play.",
      sub: `${int(m.activeBids)} active bids · ${fmtMoney(m.weightedPipeline)} weighted · ${int(m.leadCount)} early-stage lead${m.leadCount === 1 ? "" : "s"}`,
      reportHref: "/reports",
      viz: {
        kind: "bars",
        rows: (m.opmByStage ?? []).slice(0, 5).map(st => ({ label: st.label, v: st.value, text: fmtMoney(st.value) })),
        max: Math.max(1, ...(m.opmByStage ?? []).slice(0, 5).map(st => st.value)),
        color: "#6B99BB",
      },
      card: {
        id: "pipeline",
        title: "Pipeline — Every Open Pursuit",
        takeaway: "Every pursuit still in play, largest first.",
        stats: [
          { label: "Pipeline", value: fmtMoney(m.pipelineValue) },
          { label: "Weighted", value: fmtMoney(m.weightedPipeline) },
          { label: "Active bids", value: int(m.activeBids) },
        ],
        columns: OPP_COLS,
        rows: oppRows(m.opps),
        explanation: {
          meaning: "Every open opportunity that has not yet been won or lost, showing the total dollar value still in play.",
          calculation: "Rows are all opportunities in open/active stages. Value = face value of the pursuit. Weighted = value × stage probability factor.",
          period: "Current snapshot",
          measure: "actual" as const,
          source: "Opportunity records",
          completeness: recordsOk ? "All opportunity records loaded" : "Partial",
        },
      },
    },
    {
      id: "financial",
      title: "Financial",
      badge: "financial",
      hero: fmtMoney(m.totalForecastCost),
      takeaway: "Labor dollars contracted across active projects.",
      sub: `Avg project ${fmtMoney(m.avgProjectValue)} · ${int(marginRisk.length)} overdue projects still carrying value`,
      chip: marginRisk.length > 0 ? { text: `${int(marginRisk.length)} at margin risk`, tone: "warn" } : { text: "No margin-risk projects", tone: "good" },
      reportHref: "/reports",
      viz: {
        kind: "pairs",
        pairs: [
          { label: "Contracted labor", value: fmtMoney(m.totalForecastCost), color: "#A8D672" },
          { label: "Portfolio value", value: fmtMoney(m.backlogValue), color: "#F0A842" },
        ],
      },
      card: {
        id: "financial",
        title: "Financial — Project Money Fields",
        takeaway: "Contract value, labor contract and forecast cost per active project.",
        stats: [
          { label: "Contracted labor", value: fmtMoney(m.totalForecastCost) },
          { label: "Portfolio value", value: fmtMoney(m.backlogValue) },
          { label: "Margin-risk projects", value: int(marginRisk.length) },
        ],
        columns: FINANCIAL_COLS,
        rows: projRows(m.projects),
        explanation: {
          meaning: "The three key money fields for every active project: the total contract value, the labor-only contract portion, and the forecast cost to complete.",
          calculation: "One row per active project. Contract Value = total agreement amount. Labor Contract = labor-only subset. Forecast Cost = current cost-to-complete estimate.",
          period: "Current snapshot",
          measure: "actual" as const,
          source: "Project financial records",
          completeness: recordsOk ? "All project records loaded" : "Partial",
          totals: { value: m.backlogValue, forecastCost: m.totalForecastCost },
        },
      },
    },
    {
      id: "project",
      title: "Leads · Opps · Projects",
      hero: int((m.allLeads?.length ?? m.leads.length) + m.activeBids + m.activeProjects),
      heroUnit: "total records",
      takeaway: `${int(m.allLeads?.length ?? m.leads.length)} leads · ${int(m.activeBids)} open opps · ${int(m.activeProjects)} active projects`,
      sub: m.onTimeRate != null
        ? `Projects: ${int(m.onScheduleCount)} on schedule · ${int(m.overdueCount)} overdue`
        : `Projects: ${int(m.activeProjects)} active · no schedule data`,
      chip: m.onTimeRate != null ? { text: `${m.onTimeRate}% on time`, tone: m.onTimeRate >= 80 ? "good" : m.onTimeRate >= 60 ? "warn" : "bad" } : undefined,
      reportHref: "/reports",
      viz: {
        kind: "segments",
        total: Math.max(1, (m.allLeads?.length ?? m.leads.length) + m.activeBids + m.activeProjects),
        segments: [
          { label: "Leads", v: m.allLeads?.length ?? m.leads.length, color: "#6B99BB" },
          { label: "Opportunities", v: m.activeBids, color: "#F0A842" },
          { label: "Active Projects", v: m.activeProjects, color: "#8EC94A" },
        ],
      },
      card: {
        id: "project",
        title: "Project — Schedule Health",
        takeaway: "Where every active project stands against its planned end date.",
        stats: [
          { label: "On schedule", value: int(m.onScheduleCount) },
          { label: "Overdue", value: int(m.overdueCount) },
          { label: "No end date", value: int(m.noDateCount) },
          ...(m.onTimeRate != null ? [{ label: "On-time rate", value: `${m.onTimeRate}%` }] : []),
        ],
        columns: SCHEDULE_COLS,
        rows: scheduleRows([...m.projects].sort((a, b) => Number(b.overdue) - Number(a.overdue) || (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0))),
        explanation: {
          meaning: "Schedule health for every active project. Overdue projects appear first so the biggest risks are immediately visible.",
          calculation: "Sorted with overdue projects first (by days overdue descending), then on-schedule, then no-date. Overdue = target end date < today.",
          period: "Current snapshot",
          measure: "actual" as const,
          source: "Project records",
          completeness: recordsOk ? "All project records loaded" : "Partial",
        },
      },
    },
    {
      id: "staff",
      title: "Staff",
      hero: int(m.totalStaff),
      heroUnit: "people",
      takeaway: staffByDiv.length > 1
        ? `${staffByDiv[0].label} is the largest group with ${int(staffByDiv[0].v)} people.`
        : "Everyone in the workforce, in one list.",
      sub: `${int(deployed.length)} on projects · ${int(m.benchCount)} available · ${int(staffByDiv.length)} division${staffByDiv.length === 1 ? "" : "s"}`,
      reportHref: "/reports",
      viz: {
        kind: "bars",
        rows: staffByDiv.slice(0, 5).map(d => ({ label: d.label, v: d.v })),
        max: Math.max(1, ...staffByDiv.slice(0, 5).map(d => d.v)),
        color: "#6B99BB",
      },
      card: {
        id: "staff",
        title: "Staff — Full Roster",
        takeaway: "Everyone on the team with role, division and current load.",
        stats: [
          { label: "People", value: int(m.totalStaff) },
          { label: "On projects", value: int(deployed.length) },
          { label: "Available", value: int(m.benchCount) },
        ],
        columns: STAFF_COLS,
        rows: staffRows(m.staff),
        explanation: {
          meaning: "Every person in the workforce. The tile hero is the total headcount.",
          calculation: "One row per staff member. Utilization = sum of active project allocations as a % of a full-time role. Projects = count of active project assignments.",
          period: "Current snapshot",
          measure: "actual" as const,
          source: "Staffing records",
          completeness: staffingOk ? "All staff records loaded" : "Partial",
        },
      },
    },
    {
      id: "resource",
      title: "Resource",
      hero: int(deployed.length),
      heroUnit: "people on projects",
      takeaway: m.deployedRate != null
        ? `${m.deployedRate}% of the workforce is assigned to at least one project.`
        : "People assigned to at least one active project.",
      sub: `${int(m.totalStaff)} total staff · ${openPos} unfilled positions`,
      reportHref: "/reports",
      viz: {
        kind: "gauge",
        pct: Math.max(0, Math.min(100, m.deployedRate ?? 0)),
        label: m.deployedRate != null ? `${m.deployedRate}%` : "—",
        caption: "share of staff deployed on projects",
      },
      card: {
        id: "resource",
        title: "Resource — Deployed People",
        takeaway: "Who is on project work right now, busiest first.",
        stats: [
          { label: "Deployed", value: int(deployed.length) },
          ...(m.deployedRate != null ? [{ label: "Deployment rate", value: `${m.deployedRate}%` }] : []),
          { label: "Open positions", value: openPos },
        ],
        columns: STAFF_COLS,
        rows: staffRows([...deployed].sort((a, b) => b.activeProjects - a.activeProjects || b.utilization - a.utilization)),
        explanation: {
          meaning: "Staff members currently assigned to at least one active project, sorted by how busy they are.",
          calculation: "Filtered to staff with activeProjects > 0. Sorted by project count descending, then utilization descending.",
          period: "Current snapshot",
          measure: "actual" as const,
          source: "Staffing records",
          completeness: staffingOk ? "All staff records loaded" : "Partial",
        },
      },
    },
    {
      id: "utilization",
      title: "Utilization",
      hero: `${Math.round(avgUtil)}%`,
      takeaway: `${int(m.overAllocCount)} ${m.overAllocCount === 1 ? "person is" : "people are"} carrying more than a full load.`,
      sub: `Average across ${int(m.totalStaff)} people · ${int(m.healthyCount)} in a healthy range`,
      chip: m.overAllocCount > 0 ? { text: `${int(m.overAllocCount)} overloaded`, tone: "bad" } : { text: "No one overloaded", tone: "good" },
      viz: {
        kind: "bars",
        rows: m.utilizationBands.map(b => ({ label: b.label, v: b.count })),
        max: Math.max(1, ...m.utilizationBands.map(b => b.count)),
        color: "#C4D44A",
      },
      card: {
        id: "utilization",
        title: "Utilization — Person by Person",
        takeaway: "Current workload per person, heaviest first.",
        stats: [
          { label: "Average", value: `${Math.round(avgUtil)}%` },
          { label: "Overloaded", value: int(m.overAllocCount) },
          { label: "Healthy", value: int(m.healthyCount) },
          { label: "Available", value: int(m.benchCount) },
        ],
        columns: STAFF_COLS,
        rows: staffRows([...m.staff].sort((a, b) => b.utilization - a.utilization)),
        explanation: {
          meaning: "The current workload distribution across all staff. The tile hero is the mean utilization percentage.",
          calculation: "Utilization per person = sum of project allocation percentages. Overloaded = > 100%. Healthy = 50–100%. Available = < 50%.",
          period: "Current snapshot",
          measure: "derived" as const,
          source: "Staffing and allocation records",
          completeness: staffingOk ? "All staff records loaded" : "Partial",
        },
      },
    },
    {
      id: "bench",
      title: "Bench",
      hero: int(m.benchCount),
      heroUnit: "people available",
      takeaway: m.benchCount === 0
        ? "Nobody is sitting idle right now."
        : "People with little or no project work — ready to be placed.",
      sub: `${int(benchStaff.filter(s => s.band === "Available").length)} fully available · ${int(benchStaff.filter(s => s.band === "Light").length)} lightly loaded`,
      viz: {
        kind: "pairs",
        pairs: [
          { label: "Fully available", value: int(benchStaff.filter(s => s.band === "Available").length), color: "#A78BFA" },
          { label: "Lightly loaded", value: int(benchStaff.filter(s => s.band === "Light").length), color: "#6B99BB" },
        ],
      },
      card: {
        id: "bench",
        title: "Bench — Available People",
        takeaway: "Who could take on more work, most available first.",
        stats: [
          { label: "On the bench", value: int(m.benchCount) },
          { label: "Open positions to fill", value: openPos },
        ],
        columns: STAFF_COLS,
        rows: staffRows(benchStaff),
        explanation: {
          meaning: "People who are fully available or lightly loaded — prime candidates for new project assignments.",
          calculation: "Filtered to staff in the Available band (0–20% utilization) or Light band (20–50%). Sorted by utilization ascending.",
          period: "Current snapshot",
          measure: "actual" as const,
          source: "Staffing records",
          completeness: staffingOk ? "All staff records loaded" : "Partial",
        },
      },
    },
    {
      id: "open-positions",
      title: "Open Positions & Demand",
      hero: int(m.openDemands),
      heroUnit: "unfilled roles",
      takeaway: demandByRole.length > 0
        ? `${demandByRole[0].label} is the biggest gap with ${int(demandByRole[0].v)} open seat${demandByRole[0].v === 1 ? "" : "s"}.`
        : "No unfilled positions right now.",
      sub: `${int(m.demands.filter(d => d.soft).length)} soft request${m.demands.filter(d => d.soft).length === 1 ? "" : "s"} · ${int(m.demands.filter(d => !d.soft).length)} committed`,
      viz: {
        kind: "chips",
        items: demandByRole.slice(0, 4).map(r => ({ label: r.label, v: int(r.v) })),
      },
      card: {
        id: "open-positions",
        title: "Open Positions — Every Unfilled Seat",
        takeaway: "Each row is one role a project still needs filled.",
        stats: [
          { label: "Open positions", value: int(m.openDemands) },
          { label: "Roles affected", value: int(demandByRole.length) },
        ],
        columns: DEMAND_COLS,
        rows: demandRows(m.demands),
        explanation: {
          meaning: "Each row is a specific role that a project needs filled but has no confirmed staff assignment yet.",
          calculation: "All demand records without an assigned person. Type = Committed (formally required) or Soft (requested, not locked).",
          period: "Current snapshot",
          measure: "actual" as const,
          source: "Demand / staffing request records",
          completeness: demandsOk ? "All demand records loaded" : "Partial",
        },
      },
    },
    {
      id: "usage",
      title: "Usage Analytics",
      badge: "admin",
      hero: "—",
      takeaway: "Who actually uses the platform, and how often.",
      sub: "Not measured yet — usage tracking ships with the telemetry update",
      viz: { kind: "note", text: "This tile will show real adoption numbers once usage tracking is live. No estimates are shown in the meantime." },
      card: null,
    },
  ];

  /* Degrade tiles whose source failed: "—" + a plain note, never zeros. */
  const degrade = (t: HubTile, what: string): HubTile => ({
    ...t,
    hero: "—",
    heroUnit: undefined,
    chip: undefined,
    takeaway: `${what} didn't load, so this tile has no live numbers right now.`,
    sub: "Refresh the page to try again — nothing is estimated in the meantime.",
    viz: { kind: "note", text: `${what} is unavailable right now. This tile never shows guessed numbers.` },
    card: null,
  });
  const RECORD_TILES: SectionId[] = ["executive", "pipeline", "financial", "project"];
  const STAFFING_TILES: SectionId[] = ["staff", "resource", "utilization", "bench"];
  let finalTiles = tiles;
  if (!recordsOk) {
    finalTiles = finalTiles.map(t => (RECORD_TILES.includes(t.id) ? degrade(t, "Project and pipeline records") : t));
  }
  if (!staffingOk) {
    finalTiles = finalTiles.map(t => (STAFFING_TILES.includes(t.id) ? degrade(t, "Staffing data") : t));
  }
  if (!demandsOk) {
    finalTiles = finalTiles.map(t => (t.id === "open-positions" ? degrade(t, "Open-position data") : t));
  }

  return { ticker, hero, tiles: finalTiles };
}
