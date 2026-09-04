/* ─────────────────────────────────────────────────────────────
 * Usage Analytics (#482 + #488) — pure view-model builder.
 * Turns the /usage-analytics payload into the Mission Control
 * page's card models. Pure + import-light so the honesty check
 * script can unit-test every state.
 *
 * Honesty rules encoded here (tested by check-analytics-honesty):
 *  - payload null (fetch failed)      → state "error", NO numbers
 *  - available:false (kill switch)    → state "off", NO numbers
 *  - available:false restricted       → state "restricted"
 *  - zero recorded events             → state "collecting": adoption is
 *    "—" (null), never a fabricated 0% — people may have been active
 *    before recording started
 *  - ready: zeros are real (recording was on and saw nothing); the
 *    "least used" list may only call a module zero because the module
 *    list is KNOWN, not inferred from observed data
 *  - capped drawer lists always disclose the TRUE total
 *
 * Phase 2 (Usage → Outcomes) honesty rules:
 *  - OUTCOME_MIN_WEEKS weeks of data required; "—" until then
 *  - All metrics are OBSERVED counts, never estimated or extrapolated
 *  - Plain language: state what is observed, never imply causation
 *  - "—" for any metric where the denominator is 0 (no users in band)
 * ──────────────────────────────────────────────────────────── */
import type { UsageAnalytics, UsageTenant } from "./api";
import type { CardModel, HubTile } from "./analyticsCenter";

/** Minimum weeks of rolled-up data before Phase 2 outcome metrics show real
 *  numbers. Under this threshold every outcome metric shows "—" and a note. */
export const OUTCOME_MIN_WEEKS = 4;

/** Canonical SPA modules the beacon can report. A module absent from the
 *  observed data is only an honest zero because this list exists. */
export const KNOWN_MODULES: string[] = [
  "Home", "Projects", "ProjectDetail", "Resources", "Forecast", "Chat",
  "IntelligenceHub", "Alerts", "Reports", "AnalyticsCenter", "DataImport",
  "Settings", "BillingRates", "CreateRecord", "DailyBriefing", "SystemHealth",
];

/** Human-readable display names for SPA module beacons. */
export const PAGE_LABELS: Record<string, string> = {
  Home: "Home",
  Projects: "Projects",
  ProjectDetail: "Project Detail",
  Resources: "Resources",
  Forecast: "Forecast",
  Chat: "Chat",
  IntelligenceHub: "Intelligence Hub",
  Alerts: "Alerts",
  Reports: "Reports",
  AnalyticsCenter: "Analytics Center",
  DataImport: "Data Import",
  Settings: "Settings",
  BillingRates: "Billing Rates",
  CreateRecord: "Create Record",
  DailyBriefing: "Daily Briefing",
  SystemHealth: "System Health",
};

/** Splits CamelCase as a fallback when a module name is not in PAGE_LABELS. */
function fmtPage(feature: string): string {
  return PAGE_LABELS[feature] ?? feature.replace(/([A-Z])/g, " $1").trim();
}

export const TX_LABELS: Record<string, string> = {
  allocation_update: "Allocation Update",
  record_open: "Opened Record",
  project_save: "Project Save",
  work_item_created: "Work Item Created",
  record_created: "Record Created",
  data_import: "Data Import (automated)",
};

export const ALL_TAB = "All Tenants";

function fmtWk(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
/**
 * Format a date (or datetime) string for display in drill tables.
 * - Day-only strings ("2026-08-17") → "Aug 17, 2026"
 * - Full ISO datetimes with a non-midnight UTC time component
 *   ("2026-08-17T11:20:00.000Z") → "Aug 17 at 11:20 AM"
 * Raw (un-rolled) events from today carry the full ISO string; historical
 * rolled rows carry only the date — both are handled here.
 */
function fmtDay(iso: string): string {
  const d = new Date(iso);
  // Detect whether the string carries a meaningful time component:
  // a date-only string ("YYYY-MM-DD") parsed as UTC lands at exactly midnight.
  const hasTime = iso.length > 10 && (d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0);
  if (hasTime) {
    const datePart = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const timePart = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    return `${datePart} at ${timePart}`;
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export type UsageAgg = {
  label: string;
  enabledUsers: number;
  managers: number;
  /** Enabled-user count by role label, merged across all selected tenants. */
  roleCounts: Record<string, number>;
  activeUsers: number;
  /** null = not measurable (no enabled users, or nothing recorded yet) */
  adoptionPct: number | null;
  logins: number;
  pageVisits: number;
  humanTx: number;
  humanEvents: number;
  systemEvents: number;
  totalEvents: number;
  weekly: { week: string; label: string; activity: number; wau: number }[];
  features: { name: string; visits: number; known: boolean }[];
  leastUsed: { name: string; visits: number }[];
  txByType: { type: string; label: string; human: number; system: number }[];
  bands: { band: string; users: number }[];
  perTenant: { tenant: string; enabled: number; active: number; adoptionPct: number | null }[];
  /** Weekly data aggregated by calendar month for the monthly trend chart. */
  monthly: { month: string; label: string; activity: number; mau: number }[];
  cards: {
    adoption: CardModel;
    activity: CardModel;
    neverActive: CardModel;
    weekly: CardModel;
    features: CardModel;
    tx: CardModel;
    humanSystem: CardModel;
    bands: CardModel;
    loginsUsers: CardModel;
    pageVisitsUsers: CardModel;
    humanTxUsers: CardModel;
  };
  activeShown: number;
  activeTotal: number;
  neverShown: number;
  neverTotal: number;
};

/** Phase 2 — a single aggregated outcome metric, ready for display.
 *  `value` is null when not enough history exists or the sample is empty. */
export type OutcomeMetric = {
  /** Display value, or null if below OUTCOME_MIN_WEEKS or empty sample. */
  value: number | null;
  /** Formatted string: number with units, or "—" */
  display: string;
  /** Number of weeks of data behind this metric. */
  weeksOfData: number;
  /** True if we have enough history to show real numbers. */
  hasEnoughHistory: boolean;
  /** Per-week sparkline values. null entries = genuine gaps (no activity
   *  that week); never fabricated zeros. Empty array = no series yet. */
  sparkline: (number | null)[];
  /** Short week labels (e.g. "Jun 2") matching sparkline length. */
  sparkLabels: string[];
};

/** Aggregated Phase 2 outcome metrics for the selected scope. */
export type UsageOutcomes = {
  /** Avg allocation edits per active user per week. */
  allocEditsPerUserWeek: OutcomeMetric & {
    /** Total allocation edits in the window. */
    totalEdits: number;
    /** Number of active users the rate is divided across. */
    activeUsers: number;
  };
  /** Feature breadth: avg distinct modules for consistent vs occasional users. */
  featureBreadth: OutcomeMetric & {
    /** Avg modules for consistent (every + most weeks) users. */
    consistentAvg: number | null;
    /** Avg modules for occasional users. */
    occasionalAvg: number | null;
    /** User counts in each band. */
    consistentUsers: number;
    occasionalUsers: number;
    /** Ratio (consistent/occasional), or null if either is null. */
    ratio: number | null;
  };
  /** Import regularity: how many tracked weeks had ≥1 data import. */
  importRegularity: OutcomeMetric & {
    importWeeks: number;
    totalWeeks: number;
    /** Percentage of weeks with imports, or null if no weeks. */
    pct: number | null;
  };
  /** Card models for drawers — each outcome has its own focused drill.
   *  null when hasEnoughHistory is false (no drill while gate is active). */
  card: CardModel;
  allocCard: CardModel | null;
  breadthCard: CardModel | null;
  importCard: CardModel | null;
};

export type UsageView = {
  state: "error" | "off" | "restricted" | "collecting" | "ready";
  reason: string | null;
  collectingSince: string | null;
  collectingSinceLabel: string | null;
  windowLabel: string;
  weeks: number;
  scope: "tenant" | "all";
  tabs: string[];
  tab: string;
  agg: UsageAgg | null;
  outcomes: UsageOutcomes | null;
};

const ROW_CAP = 300; // mirrors the server cap; totals disclosed separately

function buildAgg(tenants: UsageTenant[], weekStarts: string[], weeks: number, label: string, anyEventsInScope: boolean): UsageAgg {
  const sum = (f: (t: UsageTenant) => number) => tenants.reduce((a, t) => a + f(t), 0);
  const enabledUsers = sum((t) => t.enabledUsers);
  const managers = sum((t) => t.managers);
  // Merge per-role counts across all selected tenants.
  const roleCounts: Record<string, number> = {};
  for (const t of tenants) {
    for (const [role, count] of Object.entries(t.roleCounts ?? {})) {
      roleCounts[role] = (roleCounts[role] ?? 0) + count;
    }
  }
  const activeUsers = sum((t) => t.activeUsers);
  const logins = sum((t) => t.logins);
  const pageVisits = sum((t) => t.pageVisits);
  const humanTx = sum((t) => t.humanTx);
  const humanEvents = sum((t) => t.humanEvents);
  const systemEvents = sum((t) => t.systemEvents);
  const totalEvents = humanEvents + systemEvents;

  // Adoption: only a real percentage when there are enabled users AND
  // recording has actually observed something in this scope. A silent
  // telemetry layer must show "—", never "0%".
  const adoptionPct =
    enabledUsers > 0 && anyEventsInScope ? Math.round((activeUsers / enabledUsers) * 1000) / 10 : null;

  const weekly = weekStarts.map((wk) => ({
    week: wk,
    label: fmtWk(wk),
    activity: sum((t) => t.weekly.find((w) => w.week === wk)?.activity ?? 0),
    wau: sum((t) => t.weekly.find((w) => w.week === wk)?.wau ?? 0),
  }));

  // Features: observed visits merged with the KNOWN module list so unused
  // modules appear as honest zeros.
  const featMap = new Map<string, number>();
  for (const t of tenants) for (const f of t.features) featMap.set(f.name, (featMap.get(f.name) ?? 0) + f.visits);
  const known = new Set(KNOWN_MODULES);
  const features = [...new Set([...featMap.keys(), ...KNOWN_MODULES])]
    .map((name) => ({ name, visits: featMap.get(name) ?? 0, known: known.has(name) }))
    .sort((a, b) => b.visits - a.visits);
  // Sort ascending (fewest visits first = 0-visit modules at the top of the card)
  // so the most-neglected modules are immediately visible without scrolling.
  const leastUsed = [...features].sort((a, b) => a.visits - b.visits).slice(0, 5);

  // Monthly aggregation: group weeks by YYYY-MM, sum activity, peak WAU as a
  // proxy for Monthly Active Users (MAU). Peak is used rather than sum because
  // the same person can be counted in multiple weeks of the same month.
  const monthlyAcc = new Map<string, { activity: number; mau: number }>();
  for (const w of weekly) {
    const mo = w.week.slice(0, 7); // YYYY-MM
    const cur = monthlyAcc.get(mo) ?? { activity: 0, mau: 0 };
    cur.activity += w.activity;
    cur.mau = Math.max(cur.mau, w.wau);
    monthlyAcc.set(mo, cur);
  }
  const monthly = [...monthlyAcc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mo, v]) => ({
      month: mo,
      label: new Date(`${mo}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
      activity: v.activity,
      mau: v.mau,
    }));

  const txMap = new Map<string, { human: number; system: number }>();
  for (const t of tenants)
    for (const x of t.txByType) {
      const cur = txMap.get(x.type) ?? { human: 0, system: 0 };
      cur.human += x.human; cur.system += x.system;
      txMap.set(x.type, cur);
    }
  const txByType = [...txMap.entries()]
    .map(([type, v]) => ({ type, label: TX_LABELS[type] ?? type, ...v }))
    .sort((a, b) => (b.human + b.system) - (a.human + a.system));

  const bands = [
    { band: `Every week (${weeks}/${weeks})`, users: sum((t) => t.loginBands.every) },
    { band: "Most weeks", users: sum((t) => t.loginBands.most) },
    { band: "Occasional", users: sum((t) => t.loginBands.occasional) },
  ];

  const perTenant = tenants.map((t) => ({
    tenant: t.tenant,
    enabled: t.enabledUsers,
    active: t.activeUsers,
    adoptionPct:
      t.enabledUsers > 0 && (t.humanEvents + t.systemEvents > 0 || anyEventsInScope)
        ? Math.round((t.activeUsers / t.enabledUsers) * 1000) / 10
        : null,
  }));

  const activeRows = tenants
    .flatMap((t) => t.activeUserRows.map((r) => ({ ...r, tenant: t.tenant })))
    .sort((a, b) => (b.logins + b.visits + b.tx) - (a.logins + a.visits + a.tx))
    .slice(0, ROW_CAP);
  const activeTotal = sum((t) => t.activeUserTotal);
  const neverRows = tenants
    .flatMap((t) => t.neverActiveRows.map((r) => ({ ...r, tenant: t.tenant })))
    .slice(0, ROW_CAP);
  const neverTotal = sum((t) => t.neverActiveTotal);

  const capNote = (shown: number, total: number) =>
    total > shown ? ` Showing the first ${shown} of ${total} rows — exports include the same rows.` : "";

  // Adoption card: all enabled users (active first, then never-active)
  const allUserRows = [
    ...activeRows.map((r) => ({
      user: r.user, tenant: r.tenant, role: r.role,
      status: "Active", logins: r.logins, visits: r.visits, tx: r.tx,
    })),
    ...neverRows.map((r) => ({
      user: r.user, tenant: r.tenant, role: r.role,
      status: "Never active", logins: 0, visits: 0, tx: 0,
    })),
  ].slice(0, ROW_CAP);
  const allUserTotal = activeTotal + neverTotal;
  const capNoteAll = allUserTotal > allUserRows.length
    ? ` Showing the first ${allUserRows.length} of ${allUserTotal} users — exports include the same rows.` : "";

  // Merge per-user member lists from all tenants for drill-down sub-cards.
  // Defined here (before `cards`) so bands + breadth rows can both use buildMemberSubCard.
  type BreadthMember = { username: string; role: string; modules: number; moduleNames?: string[]; weeksLoggedIn: number; logins: number; visits: number };
  const allConsistentMembers: BreadthMember[] = [];
  const allOccasionalMembers: BreadthMember[] = [];
  for (const t of tenants) {
    if (t.outcomes?.consistentMembers) allConsistentMembers.push(...t.outcomes.consistentMembers);
    if (t.outcomes?.occasionalMembers) allOccasionalMembers.push(...t.outcomes.occasionalMembers);
  }

  const buildMemberSubCard = (groupLabel: string, members: BreadthMember[]): import("./analyticsCenter").CardModel => ({
    id: "usage" as import("./analyticsCenter").SectionId,
    title: groupLabel,
    takeaway: `${members.length} person${members.length !== 1 ? "s" : ""} in this group. Each row shows how many different areas of the app they visited, which pages, and how often they logged in.`,
    stats: [
      { label: "People", value: String(members.length) },
      { label: "Avg areas visited", value: members.length > 0 ? String(Math.round(members.reduce((s, m) => s + m.modules, 0) / members.length)) : "—" },
    ],
    columns: [
      { key: "user",    label: "Who",             width: 26 },
      { key: "role",    label: "Role",             width: 20 },
      { key: "weeks",   label: "Weeks logged in",  align: "right" as const, kind: "int" as const, width: 16 },
      { key: "areas",   label: "Areas visited",    align: "right" as const, kind: "int" as const, width: 14 },
      { key: "pages",   label: "Pages visited",    width: 36 },
      { key: "logins",  label: "Total logins",     align: "right" as const, kind: "int" as const, width: 14 },
    ],
    rows: [...members]
      .sort((a, b) => b.modules - a.modules)
      .map(m => {
        const names = (m.moduleNames ?? []).map(n => PAGE_LABELS[n] ?? fmtPage(n));
        const pages = names.join(", ") || "—";
        return { user: m.username, role: m.role || "—", weeks: m.weeksLoggedIn, areas: m.modules, pages, logins: m.logins };
      }),
  });

  const cards: UsageAgg["cards"] = {
    adoption: {
      id: "usage",
      title: `Observed Adoption — ${label}`,
      takeaway: `Active = at least one recorded human action in the window. Active users listed first.${capNoteAll}`,
      stats: [
        { label: "Enabled users", value: String(enabledUsers) },
        { label: "Active in window", value: String(activeUsers) },
      ],
      columns: [
        { key: "user", label: "User", width: 24 },
        { key: "tenant", label: "Tenant", width: 12 },
        { key: "role", label: "Role", width: 18 },
        { key: "status", label: "Status", width: 14 },
        { key: "logins", label: "Logins", kind: "int", align: "right", width: 10 },
        { key: "visits", label: "Page visits", kind: "int", align: "right", width: 12 },
        { key: "tx", label: "Transactions", kind: "int", align: "right", width: 13 },
      ],
      rows: allUserRows,
    },
    activity: {
      id: "usage",
      title: `Active Users — ${label}`,
      takeaway: `Each row is one person with recorded activity in the window.${capNote(activeRows.length, activeTotal)}`,
      stats: [
        { label: "Active users", value: String(activeTotal) },
        { label: "Logins", value: String(logins) },
      ],
      columns: [
        { key: "user", label: "User", width: 26 },
        { key: "tenant", label: "Tenant", width: 12 },
        { key: "role", label: "Role", width: 20 },
        { key: "logins", label: "Logins", kind: "int", align: "right", width: 10 },
        { key: "visits", label: "Page visits", kind: "int", align: "right", width: 12 },
        { key: "tx", label: "Transactions", kind: "int", align: "right", width: 13 },
        { key: "weeksActive", label: "Weeks active", kind: "int", align: "right", width: 13 },
      ],
      rows: activeRows.map((r) => ({
        user: r.user, tenant: r.tenant, role: r.role, logins: r.logins,
        visits: r.visits, tx: r.tx, weeksActive: r.weeksActive,
      })),
    },
    neverActive: {
      id: "usage",
      title: `Never Active in Window — ${label}`,
      takeaway: `Enabled accounts with ZERO recorded activity — the onboarding target list.${capNote(neverRows.length, neverTotal)}`,
      stats: [{ label: "Never active", value: String(neverTotal) }],
      columns: [
        { key: "user", label: "Name", width: 26 },
        { key: "username", label: "Username", width: 26 },
        { key: "tenant", label: "Tenant", width: 12 },
        { key: "role", label: "Role", width: 20 },
      ],
      rows: neverRows.map((r) => ({ user: r.user, username: r.username, tenant: r.tenant, role: r.role })),
    },
    weekly: {
      id: "usage",
      title: `Weekly Activity — ${label}`,
      takeaway: "Human events per week (logins + page visits + transactions). The current week is partial. Click a week to see all events.",
      stats: [{ label: "Human events", value: String(humanEvents) }],
      columns: [
        { key: "label", label: "Week of", width: 14 },
        { key: "activity", label: "Human events", kind: "int", align: "right", width: 14 },
        { key: "wau", label: "Active users", kind: "int", align: "right", width: 14 },
      ],
      rows: weekly.map((w, i) => {
        const nextWk = weekStarts[i + 1] ?? "9999-12-31";
        const inWeek = (day: string) => day >= w.week && day < nextWk;

        // Collect all event rows for this week across all tenants
        type EventRow = { type: string; record: string; user: string; tenant: string; role: string; date: string; _day: string; count: number };
        const allEventRows: EventRow[] = [];

        for (const t of tenants) {
          for (const r of t.loginDetailRows ?? []) {
            if (inWeek(r.day)) allEventRows.push({
              type: "Login", record: "—", user: r.user, tenant: t.tenant,
              role: r.role ?? "", date: fmtDay(r.day), _day: r.day, count: r.cnt,
            });
          }
          for (const r of t.pageVisitRows ?? []) {
            if (inWeek(r.day)) allEventRows.push({
              type: fmtPage(r.feature), record: r.context || "—", user: r.user, tenant: t.tenant,
              role: r.role ?? "", date: fmtDay(r.day), _day: r.day, count: r.cnt,
            });
          }
          for (const r of t.txDetailRows ?? []) {
            if (inWeek(r.day)) allEventRows.push({
              type: TX_LABELS[r.feature] ?? r.feature, record: r.context || "—", user: r.user, tenant: t.tenant,
              role: r.role ?? "", date: fmtDay(r.day), _day: r.day, count: r.cnt,
            });
          }
        }

        allEventRows.sort((a, b) => b._day.localeCompare(a._day));
        const subRows = allEventRows.slice(0, ROW_CAP).map(({ _day: _d, ...rest }) => rest);

        const _subCard: CardModel = {
          id: "usage",
          title: `Week of ${w.label}`,
          takeaway: "All recorded events — logins, page visits, and transactions — for this week. Newest first.",
          stats: [
            { label: "Human events", value: String(w.activity) },
            { label: "Active users", value: String(w.wau) },
          ],
          columns: [
            { key: "type", label: "Type / Page", width: 22 },
            { key: "record", label: "Record", width: 16 },
            { key: "user", label: "User", width: 20 },
            { key: "tenant", label: "Tenant", width: 12 },
            { key: "role", label: "Role", width: 14 },
            { key: "date", label: "Date", width: 14 },
            { key: "count", label: "Count", kind: "int" as const, align: "right" as const, width: 10 },
          ],
          rows: subRows,
        };

        return { label: w.label, activity: w.activity, wau: w.wau, _subCard };
      }),
    },
    features: {
      id: "usage",
      title: `Feature Usage — ${label}`,
      takeaway: "Page visits per module (human users). Zero-visit modules are listed honestly.",
      stats: [{ label: "Page visits", value: String(pageVisits) }],
      columns: [
        { key: "name", label: "Module", width: 24 },
        { key: "visits", label: "Visits", kind: "int", align: "right", width: 12 },
      ],
      rows: features.map((f) => ({ name: f.name, visits: f.visits })),
    },
    tx: {
      id: "usage",
      title: `Transactions by Type — ${label}`,
      takeaway: "Human-initiated vs automated (imports, system jobs) — never mixed together.",
      stats: [
        { label: "Human", value: String(humanTx) },
        { label: "System", value: String(systemEvents) },
      ],
      columns: [
        { key: "label", label: "Type", width: 26 },
        { key: "human", label: "Human", kind: "int", align: "right", width: 12 },
        { key: "system", label: "System", kind: "int", align: "right", width: 12 },
      ],
      rows: txByType.map((t) => ({ label: t.label, human: t.human, system: t.system })),
    },
    humanSystem: {
      id: "usage",
      title: `Human vs System Activity — ${label}`,
      takeaway: "System = import pipeline bulk writes and automated jobs, flagged at write time.",
      stats: [
        { label: "Human events", value: String(humanEvents) },
        { label: "System events", value: String(systemEvents) },
      ],
      columns: [
        { key: "tenant", label: "Tenant", width: 16 },
        { key: "human", label: "Human", kind: "int", align: "right", width: 12 },
        { key: "system", label: "System", kind: "int", align: "right", width: 12 },
      ],
      rows: tenants.map((t) => ({ tenant: t.tenant, human: t.humanEvents, system: t.systemEvents })),
    },
    bands: {
      id: "usage",
      title: `Login Frequency — ${label}`,
      takeaway: `How consistently the ${activeUsers} active users logged in across the ${weeks}-week window.`,
      stats: [{ label: "Active users", value: String(activeUsers) }],
      columns: [
        { key: "band", label: "Band", width: 22 },
        { key: "users", label: "Users", kind: "int", align: "right", width: 10 },
      ],
      rows: [
        {
          band: bands[0].band, users: bands[0].users,
          _subCard: allConsistentMembers.filter(m => m.weeksLoggedIn >= weeks).length > 0
            ? buildMemberSubCard("Active every week — who they are", allConsistentMembers.filter(m => m.weeksLoggedIn >= weeks))
            : undefined,
        },
        {
          band: bands[1].band, users: bands[1].users,
          _subCard: allConsistentMembers.filter(m => m.weeksLoggedIn < weeks).length > 0
            ? buildMemberSubCard("Active most weeks — who they are", allConsistentMembers.filter(m => m.weeksLoggedIn < weeks))
            : undefined,
        },
        {
          band: bands[2].band, users: bands[2].users,
          _subCard: allOccasionalMembers.length > 0
            ? buildMemberSubCard("Occasional users — who they are", allOccasionalMembers)
            : undefined,
        },
      ],
    },
    loginsUsers: (() => {
      // Per-(user, day) login rows merged across tenants, newest first.
      const lAll = tenants
        .flatMap((t) => (t.loginDetailRows ?? []).map((r) => ({ ...r, tenant: t.tenant })))
        .sort((a, b) => (b.at ?? b.day).localeCompare(a.at ?? a.day))
        .slice(0, ROW_CAP);
      const lTotal = sum((t) => t.loginDetailTotal ?? 0);
      return {
        id: "usage",
        title: `Logins by User — ${label}`,
        takeaway: `Each row is one person's logins on one day, newest first.${capNote(lAll.length, lTotal)}`,
        stats: [{ label: "Total logins", value: String(logins) }, { label: "Active users", value: String(activeTotal) }],
        columns: [
          { key: "user", label: "User", width: 26 },
          { key: "tenant", label: "Tenant", width: 12 },
          { key: "role", label: "Role", width: 20 },
          { key: "date", label: "Date", width: 14 },
          { key: "logins", label: "Logins", kind: "int" as const, align: "right" as const, width: 10 },
        ],
        rows: lAll.map((r) => ({
          user: r.user, tenant: r.tenant, role: r.role, date: fmtDay(r.at ?? r.day), logins: r.cnt,
        })),
      };
    })(),
    pageVisitsUsers: (() => {
      // Per-(user, page, day) rows merged across tenants, newest first.
      const pvAll = tenants
        .flatMap((t) => (t.pageVisitRows ?? []).map((r) => ({ ...r, tenant: t.tenant })))
        .sort((a, b) => (b.at ?? b.day).localeCompare(a.at ?? a.day))
        .slice(0, ROW_CAP);
      const pvTotal = sum((t) => t.pageVisitTotal ?? 0);
      return {
        id: "usage",
        title: `Page Visits by User — ${label}`,
        takeaway: `Each row is one person's visits to one page on one day, newest first.${capNote(pvAll.length, pvTotal)}`,
        stats: [{ label: "Total page visits", value: String(pageVisits) }, { label: "Active users", value: String(activeTotal) }],
        columns: [
          { key: "page", label: "Page", width: 20 },
          { key: "record", label: "Record", width: 16 },
          { key: "user", label: "User", width: 22 },
          { key: "tenant", label: "Tenant", width: 12 },
          { key: "role", label: "Role", width: 14 },
          { key: "date", label: "Date", width: 14 },
          { key: "visits", label: "Visits", kind: "int" as const, align: "right" as const, width: 10 },
        ],
        rows: pvAll.map((r) => ({
          page: fmtPage(r.feature),
          record: r.context || "—",
          user: r.user,
          tenant: r.tenant,
          role: r.role,
          date: fmtDay(r.at ?? r.day),
          visits: r.cnt,
        })),
      };
    })(),
    humanTxUsers: (() => {
      // Per-(user, tx-type, day, record) rows merged across tenants, newest first.
      const txAll = tenants
        .flatMap((t) => (t.txDetailRows ?? []).map((r) => ({ ...r, tenant: t.tenant })))
        .sort((a, b) => (b.at ?? b.day).localeCompare(a.at ?? a.day))
        .slice(0, ROW_CAP);
      const txTotal = sum((t) => t.txDetailTotal ?? 0);
      return {
        id: "usage",
        title: `Transactions by User — ${label}`,
        takeaway: `Each row is one person's transactions of one type on one day, newest first.${capNote(txAll.length, txTotal)}`,
        stats: [{ label: "Total transactions", value: String(humanTx) }, { label: "Active users", value: String(activeTotal) }],
        columns: [
          { key: "type", label: "Type", width: 20 },
          { key: "record", label: "Record", width: 16 },
          { key: "user", label: "User", width: 22 },
          { key: "tenant", label: "Tenant", width: 12 },
          { key: "role", label: "Role", width: 14 },
          { key: "date", label: "Date", width: 14 },
          { key: "count", label: "Count", kind: "int" as const, align: "right" as const, width: 10 },
        ],
        rows: txAll.map((r) => ({
          type: TX_LABELS[r.feature] ?? r.feature,
          record: r.context || "—",
          user: r.user,
          tenant: r.tenant,
          role: r.role,
          date: fmtDay(r.at ?? r.day),
          count: r.cnt,
        })),
      };
    })(),
  };

  return {
    label, enabledUsers, managers, roleCounts, activeUsers, adoptionPct,
    logins, pageVisits, humanTx, humanEvents, systemEvents, totalEvents,
    weekly, monthly, features, leastUsed, txByType, bands, perTenant, cards,
    activeShown: activeRows.length, activeTotal,
    neverShown: neverRows.length, neverTotal,
  };
}

/** Build Phase 2 usage → outcomes metrics from the selected tenants.
 *  All numbers are strictly observed — "—" when history is too short or sample is empty.
 *  `t.outcomes` may be absent on legacy payloads — all access uses optional chaining. */
function buildOutcomes(tenants: UsageTenant[], weeks: number, label: string, weekStarts: string[]): UsageOutcomes {
  const sum = (f: (t: UsageTenant) => number) => tenants.reduce((a, t) => a + f(t), 0);
  const hasEnoughHistory = weeks >= OUTCOME_MIN_WEEKS;

  // ── 1. Allocation edit cadence ──
  const totalEdits = sum((t) => t.outcomes?.allocEditsTotal ?? 0);
  const activeUsers = sum((t) => t.activeUsers);
  const rawAllocRate = activeUsers > 0 && weeks > 0
    ? Math.round((totalEdits / activeUsers / weeks) * 100) / 100
    : null;

  // ── 2. Feature breadth: consistent vs. occasional users ──
  const consistentUsers = sum((t) => t.outcomes?.consistentUsers ?? 0);
  const occasionalUsers = sum((t) => t.outcomes?.occasionalUsers ?? 0);
  // Weighted average across tenants for modules (weight by user count)
  let consistentModuleSum = 0, consistentSampleSize = 0;
  let occasionalModuleSum = 0, occasionalSampleSize = 0;
  for (const t of tenants) {
    const o = t.outcomes;
    if (o?.avgModulesConsistent != null && o.consistentUsers > 0) {
      consistentModuleSum += o.avgModulesConsistent * o.consistentUsers;
      consistentSampleSize += o.consistentUsers;
    }
    if (o?.avgModulesOccasional != null && o.occasionalUsers > 0) {
      occasionalModuleSum += o.avgModulesOccasional * o.occasionalUsers;
      occasionalSampleSize += o.occasionalUsers;
    }
  }
  const consistentAvg = consistentSampleSize > 0
    ? Math.round((consistentModuleSum / consistentSampleSize) * 10) / 10
    : null;
  const occasionalAvg = occasionalSampleSize > 0
    ? Math.round((occasionalModuleSum / occasionalSampleSize) * 10) / 10
    : null;
  const breadthRatio = consistentAvg !== null && occasionalAvg !== null && occasionalAvg > 0
    ? Math.round((consistentAvg / occasionalAvg) * 10) / 10
    : null;

  // ── 3. Import regularity ──
  // Union the import week strings across tenants so that weeks where
  // different tenants imported are each counted once (not summed or maxed).
  const importWeekUnion = new Set<string>();
  for (const t of tenants) {
    for (const wk of t.outcomes?.importWeeks ?? []) importWeekUnion.add(wk);
  }
  const importWeeks = importWeekUnion.size;
  const importPct = weeks > 0
    ? Math.round((importWeeks / weeks) * 100)
    : null;

  // ── Sparkline series ──
  // Each series aligns to the global weekStarts array. null = genuine gap
  // (no activity that week), never a fabricated zero.

  // Alloc edit rate per week: sum rates across tenants weighted by WAU.
  // If a week has no activity across all tenants, emit null (gap).
  const allocSparkline: (number | null)[] = weekStarts.map((wk) => {
    let totalWeekEdits = 0, totalWeekWau = 0;
    let anyData = false;
    for (const t of tenants) {
      const entry = t.outcomes?.weeklyAllocEdits?.find((e) => e.week === wk);
      if (entry !== undefined) {
        // Rate is per WAU; reconstruct raw count from rate×wau via weekly WAU
        const wkWau = t.weekly.find((w) => w.week === wk)?.wau ?? 0;
        if (wkWau > 0 && entry.rate !== null) {
          totalWeekEdits += Math.round(entry.rate * wkWau);
          totalWeekWau += wkWau;
          anyData = true;
        } else if (wkWau === 0 && entry.rate === null) {
          // Week exists in payload but had zero users — still counts as a
          // recorded week; we'll leave anyData false so it renders as gap.
        }
      }
    }
    if (!anyData) return null;
    return totalWeekWau > 0 ? Math.round((totalWeekEdits / totalWeekWau) * 100) / 100 : null;
  });

  // Feature breadth sparkline: sum of distinct modules per week across tenants
  // (union isn't possible without the raw sets, so we sum — slight overcount
  // for multi-tenant views is acceptable; the sparkline is a trend indicator).
  const breadthSparkline: (number | null)[] = weekStarts.map((wk) => {
    let total = 0, anyData = false;
    for (const t of tenants) {
      const entry = t.outcomes?.weeklyDistinctModules?.find((e) => e.week === wk);
      if (entry?.distinctModules != null) { total += entry.distinctModules; anyData = true; }
    }
    return anyData ? total : null;
  });

  // Import regularity sparkline: 1 if at least one tenant imported that week, null otherwise.
  const importSparkline: (number | null)[] = weekStarts.map((wk) =>
    importWeekUnion.has(wk) ? 1 : null
  );

  const sparkLabels = weekStarts.map(fmtWk);

  // ── Shared drawer card ──
  const card: CardModel = {
    id: "usage",
    title: `Usage → Outcomes — ${label}`,
    takeaway: [
      "Observed correlations between usage patterns and operational activity.",
      `Based on ${weeks} week${weeks !== 1 ? "s" : ""} of data.`,
    ].join(" "),
    stats: [
      { label: "Weeks of data", value: String(weeks) },
      { label: "Allocation edits (window)", value: String(totalEdits) },
      { label: "Consistent users", value: String(consistentUsers) },
      { label: "Occasional users", value: String(occasionalUsers) },
      { label: "Import weeks", value: String(importWeeks) },
    ],
    columns: [
      { key: "metric", label: "Metric", width: 34 },
      { key: "value", label: "Observed value", align: "right", width: 20 },
      { key: "note", label: "Note", width: 40 },
    ],
    rows: [
      {
        metric: "Allocation edits per active user per week",
        value: rawAllocRate !== null ? String(rawAllocRate) : "—",
        note: `${totalEdits} total edits across ${activeUsers} active users over ${weeks} weeks`,
      },
      {
        metric: "Avg distinct modules — consistent users",
        value: consistentAvg !== null ? String(consistentAvg) : "—",
        note: `${consistentUsers} user${consistentUsers !== 1 ? "s" : ""} who logged in every week or most weeks`,
      },
      {
        metric: "Avg distinct modules — occasional users",
        value: occasionalAvg !== null ? String(occasionalAvg) : "—",
        note: `${occasionalUsers} user${occasionalUsers !== 1 ? "s" : ""} who logged in occasionally`,
      },
      {
        metric: "Weeks with at least one data import",
        value: `${importWeeks} of ${weeks}`,
        note: importPct !== null ? `${importPct}% of tracked weeks` : "No weeks recorded",
      },
    ],
  };

  const allocMetric: OutcomeMetric = {
    value: hasEnoughHistory ? rawAllocRate : null,
    display: hasEnoughHistory && rawAllocRate !== null ? `${rawAllocRate}/user/wk` : "—",
    weeksOfData: weeks,
    hasEnoughHistory,
    sparkline: allocSparkline,
    sparkLabels,
  };

  const breadthMetric: OutcomeMetric = {
    value: hasEnoughHistory ? breadthRatio : null,
    display: hasEnoughHistory && breadthRatio !== null ? `${breadthRatio}×` : "—",
    weeksOfData: weeks,
    hasEnoughHistory,
    sparkline: breadthSparkline,
    sparkLabels,
  };

  const importMetric: OutcomeMetric = {
    value: hasEnoughHistory ? importWeeks : null,
    display: hasEnoughHistory ? `${importWeeks} of ${weeks} wks` : "—",
    weeksOfData: weeks,
    hasEnoughHistory,
    sparkline: importSparkline,
    sparkLabels,
  };

  // ── Separate drill cards — one per outcome card ──

  // Allocation Edits: per-week table (week | edits | active users | rate)
  const allocWeekRows = weekStarts.map((wk, i) => {
    let weekEdits = 0, weekWau = 0;
    for (const t of tenants) {
      const entry = t.outcomes?.weeklyAllocEdits?.find((e) => e.week === wk);
      const wkWau = t.weekly.find((w) => w.week === wk)?.wau ?? 0;
      if (entry && entry.rate !== null && wkWau > 0) {
        weekEdits += Math.round(entry.rate * wkWau);
        weekWau += wkWau;
      }
    }
    const rate = weekWau > 0 ? Math.round((weekEdits / weekWau) * 100) / 100 : null;
    return {
      week: sparkLabels[i] ?? fmtWk(wk),
      edits: weekEdits,
      users: weekWau,
      rate: rate !== null ? String(rate) : "—",
      // Hidden field so the frontend can filter allocEdits events to this week.
      _weekStart: wk,
    };
  });
  const allocCard: CardModel = {
    id: "usage",
    title: `Allocation Edits by Week — ${label}`,
    takeaway: `Weekly breakdown of allocation edits per active user. ${totalEdits} total edits across ${activeUsers} active user${activeUsers !== 1 ? "s" : ""} over ${weeks} week${weeks !== 1 ? "s" : ""}.`,
    stats: [
      { label: "Total edits", value: String(totalEdits) },
      { label: "Active users", value: String(activeUsers) },
      { label: "Rate", value: rawAllocRate !== null ? `${rawAllocRate}/user/wk` : "—" },
    ],
    columns: [
      { key: "week", label: "Week of", width: 14 },
      { key: "edits", label: "Edits", kind: "int" as const, align: "right", width: 12 },
      { key: "users", label: "Active users", kind: "int" as const, align: "right", width: 14 },
      { key: "rate", label: "Rate/user", align: "right", width: 14 },
    ],
    rows: allocWeekRows,
  };

  // Merge per-user member lists from all tenants for breadth drill-down sub-cards.
  type BreadthMember = { username: string; role: string; modules: number; moduleNames?: string[]; weeksLoggedIn: number; logins: number; visits: number };
  const allConsistentMembers: BreadthMember[] = [];
  const allOccasionalMembers: BreadthMember[] = [];
  for (const t of tenants) {
    if (t.outcomes?.consistentMembers) allConsistentMembers.push(...t.outcomes.consistentMembers);
    if (t.outcomes?.occasionalMembers) allOccasionalMembers.push(...t.outcomes.occasionalMembers);
  }
  const buildMemberSubCard = (groupLabel: string, members: BreadthMember[]): import("./analyticsCenter").CardModel => ({
    id: "usage" as import("./analyticsCenter").SectionId,
    title: groupLabel,
    takeaway: `${members.length} person${members.length !== 1 ? "s" : ""} in this group. Each row shows how many different areas of the app they visited, which pages, and how often they logged in.`,
    stats: [
      { label: "People", value: String(members.length) },
      { label: "Avg areas visited", value: members.length > 0 ? String(Math.round(members.reduce((s, m) => s + m.modules, 0) / members.length)) : "—" },
    ],
    columns: [
      { key: "user",    label: "Who",             width: 26 },
      { key: "role",    label: "Role",             width: 20 },
      { key: "weeks",   label: "Weeks logged in",  align: "right" as const, kind: "int" as const, width: 16 },
      { key: "areas",   label: "Areas visited",    align: "right" as const, kind: "int" as const, width: 14 },
      { key: "pages",   label: "Pages visited",    width: 36 },
      { key: "logins",  label: "Total logins",     align: "right" as const, kind: "int" as const, width: 14 },
    ],
    rows: [...members]
      .sort((a, b) => b.modules - a.modules)
      .map(m => {
        const names = (m.moduleNames ?? []).map(n => PAGE_LABELS[n] ?? fmtPage(n));
        const pages = names.join(", ") || "—";
        return { user: m.username, role: m.role || "—", weeks: m.weeksLoggedIn, areas: m.modules, pages, logins: m.logins };
      }),
  });

  // Platform Depth: per-group + per-tenant detail
  const breadthGroupRows: import("./analyticsCenter").CardRow[] = [
    {
      group: "Regular users — logged in most weeks",
      users: consistentUsers,
      avgModules: consistentAvg !== null ? String(consistentAvg) : "—",
      note: "Visited this many different areas of the app on average",
      _subCard: allConsistentMembers.length > 0 ? buildMemberSubCard("Regular users — who they are", allConsistentMembers) : undefined,
    },
    {
      group: "Occasional users — logged in sometimes",
      users: occasionalUsers,
      avgModules: occasionalAvg !== null ? String(occasionalAvg) : "—",
      note: "Visited this many different areas of the app on average",
      _subCard: allOccasionalMembers.length > 0 ? buildMemberSubCard("Occasional users — who they are", allOccasionalMembers) : undefined,
    },
  ];
  // Add per-tenant rows when multi-tenant
  if (tenants.length > 1) {
    for (const t of tenants) {
      const o = t.outcomes;
      if (!o) continue;
      breadthGroupRows.push({
        group: t.tenant,
        users: (o.consistentUsers ?? 0) + (o.occasionalUsers ?? 0),
        avgModules: o.avgModulesConsistent !== null ? String(Math.round((o.avgModulesConsistent ?? 0) * 10) / 10) : "—",
        note: `${o.consistentUsers ?? 0} logged in most weeks, ${o.occasionalUsers ?? 0} logged in occasionally`,
      });
    }
  }
  const breadthCard: CardModel = {
    id: "usage",
    title: `Platform Depth by Login Habit — ${label}`,
    takeaway: `How many different areas of the app each group visited on average. Regular users = logged in most weeks. Occasional users = logged in less often. ${breadthRatio !== null ? `Regular users visited ${breadthRatio}× more areas than occasional users.` : ""}`,
    stats: [
      { label: "Regular users", value: String(consistentUsers) },
      { label: "Occasional users", value: String(occasionalUsers) },
      { label: "Difference", value: breadthRatio !== null ? `${breadthRatio}× more areas` : "—" },
    ],
    columns: [
      { key: "group",      label: "Who",              width: 36 },
      { key: "users",      label: "People",  kind: "int" as const, align: "right", width: 10 },
      { key: "avgModules", label: "Areas visited (avg)", align: "right", width: 18 },
      { key: "note",       label: "What this means",  width: 36 },
    ],
    rows: breadthGroupRows,
  };

  // Data Uploads: per-week showing which weeks had file uploads
  const importCard: CardModel = {
    id: "usage",
    title: `Data File Uploads by Week — ${label}`,
    takeaway: `A data file (such as a staff list or project update) was uploaded in ${importWeeks} out of ${weeks} week${weeks !== 1 ? "s" : ""}${importPct !== null ? ` (${importPct}%)` : ""}. Each row below shows one week and whether any file came in that week.`,
    stats: [
      { label: "Weeks with a file upload", value: String(importWeeks) },
      { label: "Total weeks tracked", value: String(weeks) },
      { label: "How often", value: importPct !== null ? `${importPct}% of weeks` : "—" },
    ],
    columns: [
      { key: "week",     label: "Week",           width: 16 },
      { key: "imported", label: "File uploaded?", width: 14 },
      { key: "tenants",  label: "Who uploaded",   width: 36 },
    ],
    rows: weekStarts.map((wk, i) => {
      const hadImport = importWeekUnion.has(wk);
      const importingTenants = tenants
        .filter((t) => (t.outcomes?.importWeeks ?? []).includes(wk))
        .map((t) => t.tenant)
        .join(", ") || "—";
      return {
        week: sparkLabels[i] ?? fmtWk(wk),
        imported: hadImport ? "✓ Yes" : "—",
        tenants: importingTenants,
      };
    }),
  };

  return {
    allocEditsPerUserWeek: { ...allocMetric, totalEdits, activeUsers },
    featureBreadth: {
      ...breadthMetric,
      // Extended computed fields are also gated — UI must read these rather
      // than re-deriving values that should be suppressed below the threshold.
      consistentAvg: hasEnoughHistory ? consistentAvg : null,
      occasionalAvg: hasEnoughHistory ? occasionalAvg : null,
      consistentUsers: hasEnoughHistory ? consistentUsers : 0,
      occasionalUsers: hasEnoughHistory ? occasionalUsers : 0,
      ratio: hasEnoughHistory ? breadthRatio : null,
    },
    importRegularity: {
      ...importMetric,
      importWeeks: Math.max(0, importWeeks),
      totalWeeks: weeks,
      pct: importPct,
    },
    card,
    // Drill cards are suppressed until there is enough history — returning them
    // below the gate would expose calculated rates the metric display hides.
    allocCard: hasEnoughHistory ? allocCard : null,
    breadthCard: hasEnoughHistory ? breadthCard : null,
    importCard: hasEnoughHistory ? importCard : null,
  };
}

export function buildUsageView(p: UsageAnalytics | null, tab: string): UsageView {
  const base = {
    reason: null as string | null,
    collectingSince: null as string | null,
    collectingSinceLabel: null as string | null,
    windowLabel: "",
    weeks: 0,
    scope: "tenant" as const,
    tabs: [] as string[],
    tab,
    agg: null,
    outcomes: null,
  };
  if (p === null) {
    return { ...base, state: "error", reason: "Usage data didn't load right now. Refresh to retry — nothing is shown rather than wrong numbers." };
  }
  if (!p.available) {
    return { ...base, state: p.restricted ? "restricted" : "off", reason: p.reason };
  }

  const tabs = p.scope === "all" ? [ALL_TAB, ...p.tenants.map((t) => t.tenant)] : [];
  const selTab = tabs.length > 0 && tabs.includes(tab) ? tab : tabs[0] ?? "";
  const selected =
    p.scope === "all" && selTab !== ALL_TAB ? p.tenants.filter((t) => t.tenant === selTab) : p.tenants;
  const label = p.scope === "all" ? (selTab === ALL_TAB ? "All Tenants" : selTab) : p.tenants[0]?.tenant ?? "This Tenant";

  // "Anything recorded" is judged over the WHOLE payload, not the selected
  // tab — one silent tenant next to an active one still shows real zeros.
  const anyEvents = p.tenants.some((t) => t.humanEvents + t.systemEvents > 0);
  const agg = buildAgg(selected, p.weekStarts, p.weeks, label, anyEvents);
  const outcomes = buildOutcomes(selected, p.weeks, label, p.weekStarts);

  const windowLabel = `${fmtWk(p.windowStart)} – ${fmtWk(p.windowEnd)} · ${p.weeks} weeks`;
  const sinceLabel = p.collectingSince ? fmtDay(p.collectingSince) : null;

  return {
    state: anyEvents ? "ready" : "collecting",
    reason: null,
    collectingSince: p.collectingSince,
    collectingSinceLabel: sinceLabel,
    windowLabel,
    weeks: p.weeks,
    scope: p.scope,
    tabs,
    tab: selTab,
    agg,
    outcomes: anyEvents ? outcomes : null,
  };
}

/** Patches the hub's Usage tile with live numbers once the endpoint answers.
 *  "loading" keeps a quiet checking state; null (failed fetch) degrades to
 *  "—" + plain note, NEVER zeros. */
export function usageHubTile(t: HubTile, u: UsageAnalytics | null | "loading"): HubTile {
  if (u === "loading") {
    return { ...t, hero: "—", sub: "Checking usage data…", viz: { kind: "note", text: "Loading live adoption numbers." }, card: null };
  }
  if (u === null) {
    return { ...t, hero: "—", sub: "Usage data didn't load right now", viz: { kind: "note", text: "The usage service didn't answer — no numbers are shown rather than wrong ones." }, card: null };
  }
  if (!u.available) {
    return { ...t, hero: "—", sub: u.reason, viz: { kind: "note", text: u.reason }, card: null };
  }
  const anyEvents = u.tenants.some((x) => x.humanEvents + x.systemEvents > 0);
  const enabled = u.tenants.reduce((a, x) => a + x.enabledUsers, 0);
  const active = u.tenants.reduce((a, x) => a + x.activeUsers, 0);
  if (!anyEvents) {
    const since = u.collectingSince ? fmtDay(u.collectingSince) : "just now";
    return {
      ...t,
      hero: "—",
      sub: `Collecting since ${since} — no activity recorded yet`,
      viz: { kind: "note", text: `Usage tracking is live. ${enabled} enabled accounts are being observed; numbers appear as soon as people sign in.` },
      card: null,
    };
  }
  const pct = enabled > 0 ? Math.round((active / enabled) * 1000) / 10 : null;
  return {
    ...t,
    hero: pct == null ? "—" : `${pct}%`,
    sub: `${active} of ${enabled} enabled users active in the last ${u.weeks} weeks`,
    viz: pct == null
      ? { kind: "note", text: "No enabled users found to measure adoption against." }
      : { kind: "gauge", pct: Math.min(100, pct), label: "Adoption", caption: `${active} of ${enabled} enabled` },
    card: null,
  };
}
