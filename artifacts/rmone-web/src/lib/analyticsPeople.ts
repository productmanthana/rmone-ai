/* ─────────────────────────────────────────────────────────────
 * analyticsPeople.ts — pure view-model builders for the five
 * people-side Analytics Center pages: Staff, Resource,
 * Utilization, Bench and Open Positions & Demand.
 *
 * Same honesty contract as the hub and analyticsSections.ts:
 *   • every number comes from the SAME ReportModel as the hub
 *     tiles, so the pages agree with the hub by construction
 *   • a failed source degrades to null / "—" — never to a
 *     fabricated zero
 *   • there is NO stored history, so nothing here invents a
 *     trend: the only time-series are FORWARD-looking weekly
 *     windows computed from real allocation / demand dates
 *   • every visible figure carries a CardModel (drill + PDF /
 *     Excel exports); person rows carry _person, project rows
 *     carry _ticket so the drawer can link to records
 *
 * Hours math goes through allocEntryHrsPerWeek — the shared
 * choke point that decides hours-vs-percent semantics — so the
 * numbers match the Resources page views.
 * Pure data — no React — so the honesty check script can run it.
 * ──────────────────────────────────────────────────────────── */
import type { ReportModel, StaffRow, DemandRow } from "@/lib/reportData";
import {
  DEMAND_COLS, demandRows, countBy, int,
  type CardModel, type CardColumn, type CardRow,
} from "@/lib/analyticsCenter";
import { allocEntryHrsPerWeek, mondayOf, parseLocalDay } from "@workspace/alloc-math";

/* ── shared bits ── */
const PALETTE = ["#8EC94A", "#6B99BB", "#F0A842", "#A78BFA", "#C4D44A", "#38BDF8", "rgba(255,255,255,0.3)"];
const DAY_MS = 86_400_000;

export type RankedList = { rows: { label: string; v: number }[]; allRows: { label: string; v: number }[]; totalGroups: number; card: CardModel };
export type SegmentList = { total: number; segments: { label: string; v: number; color: string }[]; card: CardModel };

/** Full people columns — the richer org/HR fields added for these pages. */
export const PEOPLE_COLS: CardColumn[] = [
  { key: "name", label: "Person", width: 26 },
  { key: "role", label: "Role", width: 22 },
  { key: "division", label: "Division", width: 18 },
  { key: "department", label: "Department", width: 18 },
  { key: "employmentType", label: "Type", width: 14 },
  { key: "totalProjects", label: "Total Projects", kind: "int", align: "right", width: 12 },
  { key: "utilization", label: "Utilization", kind: "pct", align: "right", width: 12 },
  { key: "band", label: "Load", width: 12 },
];

const STAFF_ROSTER_COLS: CardColumn[] = PEOPLE_COLS;

export function peopleRows(list: StaffRow[]): CardRow[] {
  return list.map(s => ({
    ...s,
    role: s.role ?? "—",
    division: s.division ?? "—",
    department: s.department ?? "—",
    businessUnit: s.businessUnit ?? "—",
    employmentType: s.employmentType ?? "—",
    totalProjects: s.totalProjects ?? s.activeProjects,
    utilization: Math.round(s.utilization),
    allocations: undefined,
    _person: s.name,
  }));
}

const flags = (m: ReportModel) => ({
  staffingOk: m.sources ? m.sources.staffing : true,
  demandsOk: m.sources ? m.sources.demands : true,
});

/** Forward Monday-keyed week starts (local midnight), DST-safe. */
function forwardWeekStarts(now: Date, weeks: number): number[] {
  const out: number[] = [];
  const cur = new Date(mondayOf(now.getTime()));
  for (let i = 0; i <= weeks; i++) { out.push(cur.getTime()); cur.setDate(cur.getDate() + 7); }
  return out; // weeks+1 entries: starts[i+1]-1 = end of week i
}

const weekLabel = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const normRole = (r: string | null | undefined) =>
  String(r ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* ═══════════════════ STAFF ═══════════════════ */
export type StaffSection = {
  staffingOk: boolean;
  hero: { value: string; sub: string; explain: string; card: CardModel | null };
  kpis: { label: string; value: string; card: CardModel | null }[];
  /** headcount by division — mirrors the hub Staff tile's bars */
  byDivision: RankedList | null;
  byBusinessUnit: RankedList | null;
  byDepartment: RankedList | null;
  rolesMix: RankedList | null;
  employmentTypes: SegmentList | null;
  cities: RankedList | null;
};

export function buildStaffSection(m: ReportModel): StaffSection {
  const { staffingOk } = flags(m);
  if (!staffingOk) {
    return {
      staffingOk,
      hero: {
        value: "—", sub: "",
        explain: "Staffing data didn't load, so no headcount is shown. Refresh to try again — nothing is estimated in the meantime.",
        card: null,
      },
      kpis: [],
      byDivision: null, byBusinessUnit: null, byDepartment: null,
      rolesMix: null, employmentTypes: null, cities: null,
    };
  }

  const deployed = m.staff.filter(s => s.activeProjects > 0);
  const staffRows = (list: StaffRow[]) => peopleRows(list);
  const rosterCard: CardModel = {
    id: "staff",
    title: "Staff — Full Roster",
    takeaway: "Everyone on the team with role, division, department and current load.",
    stats: [
      { label: "People", value: int(m.totalStaff) },
      { label: "On projects", value: int(deployed.length) },
      { label: "Available", value: int(m.benchCount) },
    ],
    columns: STAFF_ROSTER_COLS,
    rows: staffRows(m.staff),
  };

  /* ranked-list helper: card rows = the roster sorted by that grouping so
   * the export reads as grouped blocks */
  const ranked = (
    title: string, takeaway: string,
    groups: { label: string; v: number }[],
    key: (s: StaffRow) => string | null | undefined,
    top = 8,
    filterKey?: string,
  ): RankedList | null => groups.length === 0 ? null : {
    rows: groups.slice(0, top),
    allRows: groups,
    totalGroups: groups.length,
    card: {
      id: "staff",
      title, takeaway,
      stats: groups.slice(0, 4).map(g => ({ label: g.label, value: int(g.v), filterKey })),
      columns: STAFF_ROSTER_COLS,
      rows: staffRows([...m.staff].sort((a, b) =>
        ((key(a) || "Unassigned")).localeCompare(key(b) || "Unassigned") || b.utilization - a.utilization)),
    },
  };

  const byDivision = countBy(m.staff, s => s.division);
  const hasBU = m.staff.some(s => s.businessUnit);
  const hasDept = m.staff.some(s => s.department);
  const hasType = m.staff.some(s => s.employmentType);
  const hasCity = m.staff.some(s => s.city);
  const roles = countBy(m.staff, s => s.role);
  const types = hasType ? countBy(m.staff, s => s.employmentType) : [];

  return {
    staffingOk,
    hero: {
      value: int(m.totalStaff),
      sub: `${int(deployed.length)} on projects · ${int(m.benchCount)} fully available · ${int(byDivision.length)} division${byDivision.length === 1 ? "" : "s"}`,
      explain: byDivision.length > 1
        ? `${byDivision[0].label} is the largest group with ${int(byDivision[0].v)} people.`
        : "Everyone in the workforce, in one list.",
      card: rosterCard,
    },
    kpis: [
      {
        label: "On projects", value: int(deployed.length),
        card: {
          id: "staff",
          title: "Staff — People On Projects",
          takeaway: "Everyone assigned to at least one active project, busiest first.",
          stats: [{ label: "On projects", value: int(deployed.length) }, { label: "Of total", value: int(m.totalStaff) }],
          columns: STAFF_ROSTER_COLS,
          rows: staffRows([...deployed].sort((a, b) => b.activeProjects - a.activeProjects || b.utilization - a.utilization)),
        },
      },
      {
        label: "Fully available", value: int(m.benchCount),
        card: {
          id: "staff",
          title: "Staff — Fully Available People",
          takeaway: "People with no current project load — the same list as the Bench page.",
          stats: [{ label: "Available", value: int(m.benchCount) }],
          columns: STAFF_ROSTER_COLS,
          rows: staffRows(m.staff.filter(s => s.band === "Available")),
        },
      },
      {
        label: "Divisions", value: int(byDivision.length),
        card: {
          id: "staff",
          title: "Staff — Divisions",
          takeaway: `${byDivision.length} division${byDivision.length === 1 ? "" : "s"} — click any row to see the people in it.`,
          stats: byDivision.slice(0, 4).map(g => ({ label: g.label, value: int(g.v) })),
          columns: [
            { key: "division", label: "Division", width: 40 },
            { key: "people", label: "People", kind: "int" as const, align: "right" as const, width: 16 },
          ],
          rows: byDivision.map(g => ({
            division: g.label,
            people: g.v,
            _subCard: {
              id: "staff" as const,
              title: `Staff — ${g.label}`,
              takeaway: `${int(g.v)} ${g.v === 1 ? "person" : "people"} in ${g.label}.`,
              stats: [{ label: "People", value: int(g.v) }],
              columns: STAFF_ROSTER_COLS,
              rows: staffRows(m.staff.filter(s => (s.division || "Unassigned") === g.label)
                .sort((a, b) => (a.role || "Unassigned").localeCompare(b.role || "Unassigned"))),
            },
          })),
        },
      },
      {
        label: "Distinct roles", value: int(roles.length),
        card: {
          id: "staff",
          title: "Staff — Roles",
          takeaway: `${roles.length} distinct role${roles.length === 1 ? "" : "s"} — click any row to see the people in it.`,
          stats: roles.slice(0, 4).map(g => ({ label: g.label, value: int(g.v) })),
          columns: [
            { key: "role", label: "Role", width: 40 },
            { key: "people", label: "People", kind: "int" as const, align: "right" as const, width: 16 },
          ],
          rows: roles.map(g => ({
            role: g.label,
            people: g.v,
            _subCard: {
              id: "staff" as const,
              title: `Staff — ${g.label}`,
              takeaway: `${int(g.v)} ${g.v === 1 ? "person" : "people"} holding the ${g.label} role.`,
              stats: [{ label: "People", value: int(g.v) }],
              columns: STAFF_ROSTER_COLS,
              rows: staffRows(m.staff.filter(s => (s.role || "Unassigned") === g.label)
                .sort((a, b) => a.name.localeCompare(b.name))),
            },
          })),
        },
      },
    ],
    byDivision: ranked(
      "Staff — Headcount by Division",
      "How the workforce spreads across divisions — the same split as the hub's Staff tile.",
      byDivision, s => s.division, 20, "division"),
    byBusinessUnit: hasBU ? ranked(
      "Staff — Headcount by Business Unit",
      "How the workforce spreads across business units.",
      countBy(m.staff, s => s.businessUnit), s => s.businessUnit, 20, "division") : null,
    byDepartment: hasDept ? ranked(
      "Staff — Headcount by Department",
      "Where people sit across departments.",
      countBy(m.staff, s => s.department), s => s.department, 20, "department") : null,
    rolesMix: ranked(
      "Staff — Role Mix",
      `How many people hold each role.${roles.length > 10 ? ` Top 10 shown — ${roles.length - 10} more role${roles.length - 10 === 1 ? "" : "s"} in the full export.` : ""}`,
      roles, s => s.role, 10, "role"),
    employmentTypes: types.length > 0 ? {
      total: Math.max(1, m.totalStaff),
      segments: types.slice(0, PALETTE.length).map((t, i) => ({ label: t.label, v: t.v, color: PALETTE[i] })),
      card: {
        id: "staff",
        title: "Staff — Employment Types",
        takeaway: "Full-time, part-time, contract and other employment types across the roster.",
        stats: types.slice(0, 4).map(t => ({ label: t.label, value: int(t.v), filterKey: "employmentType" })),
        columns: STAFF_ROSTER_COLS,
        // employmentType canonicalized IDENTICALLY to countBy's segment
        // labels (trimmed; blank/"—" → "Unassigned") so segment clicks
        // filter correctly even for values with stray whitespace.
        rows: staffRows([...m.staff].sort((a, b) =>
          (a.employmentType || "Unassigned").localeCompare(b.employmentType || "Unassigned")))
          .map(r => {
            const t = typeof r.employmentType === "string" ? r.employmentType.trim() : "";
            return { ...r, employmentType: t && t !== "—" ? t : "Unassigned" };
          }),
      },
    } : null,
    cities: hasCity ? ranked(
      "Staff — People by City",
      "Where the team sits, by staff directory city.",
      countBy(m.staff, s => s.city), s => s.city) : null,
  };
}

/* ═══════════════════ RESOURCE ═══════════════════ */
export type WeeklyLoadRow = { week: string; hours: number; capacity: number | null };
export type ResourceSection = {
  staffingOk: boolean;
  demandsOk: boolean;
  hero: { deployed: string; rate: number | null; explain: string; card: CardModel | null };
  kpis: { label: string; value: string; card: CardModel | null }[];
  /** forward 12-week booked hours vs weekly capacity — the ONE chart */
  weeklyLoad: {
    rows: WeeklyLoadRow[];
    capacity: number | null;
    card: CardModel;
    drillCards: Record<string, CardModel>;
  } | null;
  busiest: { rows: StaffRow[]; card: CardModel } | null;
  mostProjects: { rows: StaffRow[]; card: CardModel } | null;
  overBooked: { rows: StaffRow[]; card: CardModel } | null;
};

const WEEKLY_COLS: CardColumn[] = [
  { key: "week", label: "Week Of", width: 14 },
  { key: "hours", label: "Booked Hours", kind: "int", align: "right", width: 14 },
  { key: "capacity", label: "Capacity Hours", kind: "int", align: "right", width: 15 },
  { key: "share", label: "Booked Share", kind: "pct", align: "right", width: 13 },
];

export function buildResourceSection(m: ReportModel, workWeekHours = 40, now = new Date()): ResourceSection {
  const { staffingOk, demandsOk } = flags(m);
  if (!staffingOk) {
    return {
      staffingOk, demandsOk,
      hero: {
        deployed: "—", rate: null,
        explain: "Staffing data didn't load, so deployment can't be measured right now. Refresh to try again.",
        card: null,
      },
      kpis: [],
      weeklyLoad: null, busiest: null, mostProjects: null, overBooked: null,
    };
  }

  const deployed = m.staff.filter(s => s.activeProjects > 0);
  const deployedCard: CardModel = {
    id: "resource",
    title: "Resource — Deployed People",
    takeaway: "Who is on project work right now, busiest first.",
    stats: [
      { label: "Deployed", value: int(deployed.length) },
      ...(m.deployedRate != null ? [{ label: "Deployment rate", value: `${m.deployedRate}%` }] : []),
      { label: "Open positions", value: demandsOk ? int(m.openDemands) : "—" },
    ],
    columns: PEOPLE_COLS,
    rows: peopleRows([...deployed].sort((a, b) => b.activeProjects - a.activeProjects || b.utilization - a.utilization)),
  };

  /* forward weekly booked hours — only when allocation entries actually
   * came through (older cached payloads may not carry them) */
  const hasAllocs = m.staff.some(s => Array.isArray(s.allocations) && s.allocations.length > 0);
  let weeklyLoad: ResourceSection["weeklyLoad"] = null;
  if (hasAllocs) {
    const starts = forwardWeekStarts(now, 12);
    const hours = new Array<number>(12).fill(0);
    const allocationRowsByWeek: CardRow[][] = new Array(12).fill(null).map(() => []);
    for (const s of m.staff) {
      for (const a of s.allocations ?? []) {
        const as = parseLocalDay(a.startDate ?? "");
        const ae = parseLocalDay(a.endDate ?? "");
        if (isNaN(as) || isNaN(ae)) continue;
        const hrs = allocEntryHrsPerWeek(a, workWeekHours);
        if (hrs <= 0) continue;
        /* day-level overlap on local midnights only — no fixed-ms end-of-day
         * arithmetic, so DST transitions can't shift an entry into the wrong
         * week: week i covers [starts[i], starts[i+1}), and an allocation
         * whose END DAY is on/after the week start still covers that week. */
        for (let i = 0; i < 12; i++) {
          if (as < starts[i + 1] && ae >= starts[i]) {
            const displayedHours = Math.round(hrs);
            hours[i] += displayedHours;
            allocationRowsByWeek[i].push({
              person: s.name,
              role: s.role ?? "—",
              projectId: a.projectId,
              project: a.projectName ?? a.projectId,
              hours: displayedHours,
              start: a.startDate ?? null,
              end: a.endDate ?? null,
              _ticket: a.projectId,
              _person: s.name,
            });
          }
        }
      }
    }
    const capacity = m.totalStaff > 0 ? m.totalStaff * workWeekHours : null;
    const rows: WeeklyLoadRow[] = starts.slice(0, 12).map((w, i) => ({
      week: weekLabel(w),
      hours: Math.round(hours[i]),
      capacity,
    }));
    const allocationCols: CardColumn[] = [
      { key: "person", label: "Person", width: 24 },
      { key: "role", label: "Role", width: 20 },
      { key: "projectId", label: "Project ID", width: 15 },
      { key: "project", label: "Project", width: 32 },
      { key: "hours", label: "Booked Hours", kind: "int", align: "right", width: 14 },
      { key: "start", label: "From", kind: "date", width: 13 },
      { key: "end", label: "To", kind: "date", width: 13 },
    ];
    const drillCards = Object.fromEntries(rows.map((row, i) => [row.week, {
      id: "resource" as const,
      title: `Resource — Bookings Active in Week of ${row.week}`,
      takeaway: `${int(allocationRowsByWeek[i].length)} allocation${allocationRowsByWeek[i].length === 1 ? "" : "s"} active in this week, totalling ${int(row.hours)} booked hours.`,
      stats: [
        { label: "Booked hours", value: `${int(row.hours)}h` },
        { label: "Allocations", value: int(allocationRowsByWeek[i].length) },
      ],
      columns: allocationCols,
      rows: allocationRowsByWeek[i],
    } satisfies CardModel]));
    weeklyLoad = {
      rows,
      capacity,
      drillCards,
      card: {
        id: "resource",
        title: "Resource — Weekly Booked Hours (Synthetic Aggregate), Next 12 Weeks",
        takeaway: `Synthetic weekly aggregate: each row is the SUM of hours booked across all allocations active in that week — not a list of individual allocation records. Computed from real allocation start/end dates. Capacity = ${capacity != null ? int(capacity) : "—"} hours/week (${int(m.totalStaff)} people × ${int(workWeekHours)}h). Forward-looking only — no historical data is stored.`,
        stats: [
          { label: "Capacity / week", value: capacity != null ? `${int(capacity)}h` : "—" },
          { label: "Booked next week", value: `${int(rows[0]?.hours ?? 0)}h` },
        ],
        columns: WEEKLY_COLS,
        rows: rows.map(r => ({
          ...r,
          share: r.capacity ? Math.round((r.hours / r.capacity) * 100) : null,
          _aggregate: "true",
        })),
      },
    };
  }

  const busiestList = [...deployed].sort((a, b) => b.utilization - a.utilization);
  const mostProjList = [...deployed].sort((a, b) => b.activeProjects - a.activeProjects || b.utilization - a.utilization);
  const overList = m.staff.filter(s => s.band === "Overloaded").sort((a, b) => b.utilization - a.utilization);
  const multiCount = deployed.filter(s => s.activeProjects >= 2).length;

  return {
    staffingOk, demandsOk,
    hero: {
      deployed: int(deployed.length),
      rate: m.deployedRate,
      explain: m.deployedRate != null
        ? `${m.deployedRate}% of the ${int(m.totalStaff)}-person workforce is assigned to at least one project.`
        : "People assigned to at least one active project.",
      card: deployedCard,
    },
    kpis: [
      { label: "Deployed", value: int(deployed.length), card: deployedCard },
      {
        label: "On several projects", value: int(multiCount),
        card: {
          id: "resource",
          title: "Resource — People On Several Projects",
          takeaway: "People juggling two or more active projects at once.",
          stats: [{ label: "On 2+ projects", value: int(multiCount) }],
          columns: PEOPLE_COLS,
          rows: peopleRows(deployed.filter(s => s.activeProjects >= 2).sort((a, b) => b.activeProjects - a.activeProjects)),
        },
      },
      {
        label: "Over-booked", value: int(overList.length),
        card: {
          id: "resource",
          title: "Resource — Over-Booked People",
          takeaway: overList.length > 0
            ? "People whose current load is above a full week."
            : "Nobody is over a full week right now — an empty list is the good answer here.",
          stats: [{ label: "Over-booked", value: int(overList.length) }],
          columns: PEOPLE_COLS,
          rows: peopleRows(overList),
        },
      },
      {
        label: "Open positions", value: demandsOk ? int(m.openDemands) : "—",
        card: demandsOk ? {
          id: "resource",
          title: "Resource — Open Positions",
          takeaway: "Each row is one role a project still needs filled.",
          stats: [{ label: "Open positions", value: int(m.openDemands) }],
          columns: DEMAND_COLS,
          rows: demandRows(m.demands),
        } : null,
      },
    ],
    weeklyLoad,
    busiest: busiestList.length > 0 ? {
      rows: busiestList,
      card: {
        id: "resource",
        title: "Resource — Busiest People",
        takeaway: "The most heavily booked people right now.",
        stats: [{ label: "Deployed", value: int(deployed.length) }],
        columns: PEOPLE_COLS,
        rows: peopleRows([...deployed].sort((a, b) => b.utilization - a.utilization)),
      },
    } : null,
    mostProjects: mostProjList.length > 0 ? {
      rows: mostProjList,
      card: {
        id: "resource",
        title: "Resource — Most Projects Per Person",
        takeaway: "Who is spread across the most active projects.",
        stats: [{ label: "On 2+ projects", value: int(multiCount) }],
        columns: PEOPLE_COLS,
        rows: peopleRows(mostProjList),
      },
    } : null,
    overBooked: overList.length > 0 ? {
      rows: overList,
      card: {
        id: "resource",
        title: "Resource — Over-Booked People",
        takeaway: "People whose current load is above a full week — candidates for rebalancing.",
        stats: [{ label: "Over-booked", value: int(overList.length) }],
        columns: PEOPLE_COLS,
        rows: peopleRows(overList),
      },
    } : null,
  };
}

export type OrgBoardRow = { label: string; avg: number; people: number; overloaded: number };
export type UtilizationSection = {
  staffingOk: boolean;
  hero: { avgPct: number | null; caption: string; card: CardModel | null };
  /** clearly-labeled static industry reference — NOT computed from data */
  benchmarkNote: string;
  bands: SegmentList | null;
  divisionBoard: OrgBoard | null;
  divisionBoardBU: OrgBoard | null;
  divisionBoardDept: OrgBoard | null;
  overloaded: { rows: StaffRow[]; card: CardModel } | null;
  underused: { rows: StaffRow[]; card: CardModel } | null;
};

export function buildUtilizationSection(m: ReportModel): UtilizationSection {
  const { staffingOk } = flags(m);
  const benchmarkNote =
    "Industry reference for A&E firms: 60–65% across all staff, 75–90% for technical staff. This is a static published range, not computed from your data.";
  if (!staffingOk) {
    return {
      staffingOk,
      hero: {
        avgPct: null,
        caption: "Staffing data didn't load, so utilization can't be measured right now. Refresh to try again.",
        card: null,
      },
      benchmarkNote,
      bands: null, divisionBoard: null, divisionBoardBU: null, divisionBoardDept: null, overloaded: null, underused: null,
    };
  }

  /* same average as the hub Utilization tile: mean of per-person utilization
   * (an empty-but-loaded roster averages to 0, exactly like the hub) */
  const avg = m.staff.length > 0
    ? Math.round(m.staff.reduce((a, s) => a + s.utilization, 0) / m.staff.length)
    : 0;

  const personCard: CardModel = {
    id: "utilization",
    title: "Utilization — Person by Person",
    takeaway: "Current workload per person, heaviest first.",
    stats: [
      ...(avg != null ? [{ label: "Average", value: `${avg}%` }] : []),
      { label: "Overloaded", value: int(m.overAllocCount), filterKey: "band" },
      { label: "Healthy", value: int(m.healthyCount) },
      { label: "Available", value: int(m.benchCount), filterKey: "band" },
    ],
    columns: PEOPLE_COLS,
    rows: peopleRows([...m.staff].sort((a, b) => b.utilization - a.utilization)),
  };

  /* org scoreboard helper — groups staff by any key, returns sorted board rows */
  const buildOrgBoard = (
    keyFn: (s: StaffRow) => string | null | undefined,
  ): OrgBoardRow[] => {
    const byKey = new Map<string, StaffRow[]>();
    for (const s of m.staff) {
      const k = (keyFn(s) || "").trim() || "—";
      const list = byKey.get(k) ?? [];
      list.push(s);
      byKey.set(k, list);
    }
    return [...byKey.entries()]
      .map(([label, list]) => ({
        label,
        avg: Math.round(list.reduce((a, s) => a + s.utilization, 0) / list.length),
        people: list.length,
        overloaded: list.filter(s => s.band === "Overloaded").length,
      }))
      .sort((a, b) => b.people - a.people)
      .slice(0, 8);
  };

  /* division scoreboard */
  const boardRows = buildOrgBoard(s => s.division);

  const overloadedList = m.staff.filter(s => s.band === "Overloaded").sort((a, b) => b.utilization - a.utilization);
  const underusedList = m.staff
    .filter(s => s.band === "Available" || s.band === "Light")
    .sort((a, b) => a.utilization - b.utilization);
  const bandRows = m.utilizationBands ?? [];

  /* org board card builder — reused for division, BU, and department */
  const ORG_BOARD_COLS: CardColumn[] = [
    { key: "label", label: "Group", width: 26 },
    { key: "avg", label: "Avg Load", kind: "pct", align: "right", width: 12 },
    { key: "people", label: "People", kind: "int", align: "right", width: 10 },
    { key: "overloaded", label: "Overloaded", kind: "int", align: "right", width: 12 },
  ];
  const makeOrgBoard = (
    rows: OrgBoardRow[],
    title: string,
    takeaway: string,
    filterKey: string,
  ): OrgBoard => {
    const drillCards = Object.fromEntries(rows.map(row => {
      const matching = m.staff.filter(staff =>
        (String(staff[filterKey as keyof StaffRow] ?? "").trim() || "—") === row.label);
      return [row.label, {
        id: "utilization" as const,
        title: `${title} — ${row.label}`,
        takeaway: `${int(matching.length)} ${matching.length === 1 ? "person" : "people"} in ${row.label}.`,
        stats: [
          { label: "People", value: int(matching.length) },
          { label: "Average load", value: `${row.avg}%` },
          { label: "Overloaded", value: int(row.overloaded) },
        ],
        columns: PEOPLE_COLS,
        rows: peopleRows(matching),
      } satisfies CardModel];
    }));
    return {
      rows,
      drillCards,
      card: {
        id: "utilization",
        title,
        takeaway,
        stats: rows.slice(0, 4).map(r => ({ label: r.label, value: `${r.avg}%`, filterKey })),
        columns: PEOPLE_COLS,
        rows: peopleRows(m.staff),
      },
    };
  };

  const hasBU = m.staff.some(s => s.businessUnit);
  const hasDept = m.staff.some(s => s.department);

  const buBoardRows = hasBU ? buildOrgBoard(s => s.businessUnit) : [];
  const deptBoardRows = hasDept ? buildOrgBoard(s => s.department) : [];

  return {
    staffingOk,
    hero: {
      avgPct: avg,
      caption: m.staff.length > 0
        ? `Average current load across ${int(m.totalStaff)} people. ${int(m.overAllocCount)} ${m.overAllocCount === 1 ? "person is" : "people are"} over a full load.`
        : "No people are on record yet, so the average is 0% by definition.",
      card: personCard,
    },
    benchmarkNote,
    bands: bandRows.some(b => b.count > 0) ? {
      total: Math.max(1, m.totalStaff),
      segments: bandRows.map((b, i) => ({ label: b.label, v: b.count, color: PALETTE[i % PALETTE.length] })),
      card: {
        id: "utilization",
        title: "Utilization — How Busy Is Everyone",
        takeaway: "Everyone grouped into load bands, from fully available to overloaded.",
        stats: bandRows.map(b => ({ label: b.label, value: int(b.count), filterKey: "band" })),
        columns: PEOPLE_COLS,
        rows: peopleRows([...m.staff].sort((a, b) => b.utilization - a.utilization)),
      },
    } : null,
    divisionBoard: boardRows.length > 0
      ? makeOrgBoard(boardRows, "Utilization — Division Scoreboard", "Average load, headcount and overloaded people per division.", "division")
      : null,
    divisionBoardBU: buBoardRows.length > 0
      ? makeOrgBoard(buBoardRows, "Utilization — Business Unit Scoreboard", "Average load, headcount and overloaded people per business unit.", "businessUnit")
      : null,
    divisionBoardDept: deptBoardRows.length > 0
      ? makeOrgBoard(deptBoardRows, "Utilization — Department Scoreboard", "Average load, headcount and overloaded people per department.", "department")
      : null,
    overloaded: overloadedList.length > 0 ? {
      rows: overloadedList,
      card: {
        id: "utilization",
        title: "Utilization — Overloaded People",
        takeaway: "People carrying more than a full load — heaviest first.",
        stats: [{ label: "Overloaded", value: int(overloadedList.length) }],
        columns: PEOPLE_COLS,
        rows: peopleRows(overloadedList),
      },
    } : null,
    underused: underusedList.length > 0 ? {
      rows: underusedList,
      card: {
        id: "utilization",
        title: "Utilization — Lightest Loads",
        takeaway: "People with little or no current project work — most available first.",
        stats: [{ label: "Available or light", value: int(underusedList.length) }],
        columns: PEOPLE_COLS,
        rows: peopleRows(underusedList),
      },
    } : null,
  };
}

/* ═══════════════════ BENCH ═══════════════════ */
export type RollOffRow = {
  name: string; role: string | null; division: string | null;
  project: string; endsOn: string; daysLeft: number; utilization: number;
};
export type BenchMatchRow = {
  name: string; role: string | null; division: string | null;
  utilization: number; band: string; openSeats: number;
};
export type BenchSection = {
  staffingOk: boolean;
  demandsOk: boolean;
  hero: {
    value: string; available: number | null; light: number | null; explain: string;
    card: CardModel | null; availableCard: CardModel | null; lightCard: CardModel | null;
  };
  /** bench people whose role exactly matches an open-position role */
  matches: { rows: BenchMatchRow[]; card: CardModel } | null;
  byRole: RankedList | null;
  byDivision: RankedList | null;
  byBusinessUnit: RankedList | null;
  byDepartment: RankedList | null;
  rollOffs: { rows: RollOffRow[]; card: CardModel } | null;
};

const ROLLOFF_COLS: CardColumn[] = [
  { key: "name", label: "Person", width: 26 },
  { key: "role", label: "Role", width: 22 },
  { key: "division", label: "Division", width: 18 },
  { key: "project", label: "Last Project", width: 30 },
  { key: "endsOn", label: "Ends", kind: "date", width: 13 },
  { key: "daysLeft", label: "Days Left", kind: "int", align: "right", width: 11 },
];
const MATCH_COLS: CardColumn[] = [
  { key: "name", label: "Person", width: 26 },
  { key: "role", label: "Role", width: 24 },
  { key: "division", label: "Division", width: 18 },
  { key: "band", label: "Load", width: 12 },
  { key: "utilization", label: "Utilization", kind: "pct", align: "right", width: 12 },
  { key: "openSeats", label: "Matching Open Seats", kind: "int", align: "right", width: 18 },
];

export function buildBenchSection(m: ReportModel, now = new Date()): BenchSection {
  const { staffingOk, demandsOk } = flags(m);
  if (!staffingOk) {
    return {
      staffingOk, demandsOk,
      hero: {
        value: "—", available: null, light: null,
        explain: "Staffing data didn't load, so the bench can't be measured right now. Refresh to try again.",
        card: null, availableCard: null, lightCard: null,
      },
      matches: null, byRole: null, byDivision: null, byBusinessUnit: null, byDepartment: null, rollOffs: null,
    };
  }

  /* mirror the hub Bench tile: hero = Available band, sub = Available vs Light */
  const benchStaff = m.staff
    .filter(s => s.band === "Available" || s.band === "Light")
    .sort((a, b) => a.utilization - b.utilization);
  const availableCount = benchStaff.filter(s => s.band === "Available").length;
  const lightCount = benchStaff.filter(s => s.band === "Light").length;

  const benchCard: CardModel = {
    id: "bench",
    title: "Bench — Available People",
    takeaway: "Who could take on more work, most available first.",
    stats: [
      { label: "On the bench", value: int(m.benchCount) },
      { label: "Lightly loaded", value: int(lightCount) },
      { label: "Open positions to fill", value: demandsOk ? int(m.openDemands) : "—" },
    ],
    columns: PEOPLE_COLS,
    rows: peopleRows(benchStaff),
  };
  const availableCard: CardModel = {
    id: "bench",
    title: "Bench — Fully Available People",
    takeaway: "People with no current project load at all.",
    stats: [{ label: "Fully available", value: int(availableCount) }],
    columns: PEOPLE_COLS,
    rows: peopleRows(benchStaff.filter(s => s.band === "Available")),
  };
  const lightCard: CardModel = {
    id: "bench",
    title: "Bench — Lightly Loaded People",
    takeaway: "People with some work but plenty of spare capacity.",
    stats: [{ label: "Lightly loaded", value: int(lightCount) }],
    columns: PEOPLE_COLS,
    rows: peopleRows(benchStaff.filter(s => s.band === "Light")),
  };

  /* redeployment matches: conservative EXACT role-name matching only */
  let matches: BenchSection["matches"] = null;
  if (demandsOk) {
    const seatsByRole = new Map<string, number>();
    for (const d of m.demands) {
      const k = normRole(d.role);
      if (!k) continue;
      seatsByRole.set(k, (seatsByRole.get(k) ?? 0) + 1);
    }
    const matchRows: BenchMatchRow[] = benchStaff
      .filter(s => seatsByRole.has(normRole(s.role)))
      .map(s => ({
        name: s.name, role: s.role, division: s.division,
        utilization: Math.round(s.utilization), band: s.band,
        openSeats: seatsByRole.get(normRole(s.role)) ?? 0,
      }))
      .sort((a, b) => b.openSeats - a.openSeats || a.utilization - b.utilization);
    matches = {
      rows: matchRows,
      card: {
        id: "bench",
        title: "Bench — Redeployment Matches",
        takeaway: "Bench people whose role name exactly matches an open position's role. Exact name matches only — similar roles are not guessed.",
        stats: [
          { label: "Matches", value: int(matchRows.length) },
          { label: "Open positions", value: int(m.openDemands) },
        ],
        columns: MATCH_COLS,
        rows: matchRows.map(r => ({ ...r, role: r.role ?? "—", division: r.division ?? "—", _person: r.name })),
      },
    };
  }

  const ranked = (title: string, takeaway: string, groups: { label: string; v: number }[], filterKey?: string): RankedList | null =>
    groups.length === 0 ? null : {
      rows: groups.slice(0, 8),
      allRows: groups,
      totalGroups: groups.length,
      card: {
        id: "bench",
        title, takeaway,
        stats: groups.slice(0, 4).map(g => ({ label: g.label, value: int(g.v), filterKey })),
        columns: PEOPLE_COLS,
        rows: peopleRows(benchStaff),
      },
    };

  /* roll-offs: deployed people whose LAST allocation ends within 28 days —
   * real end dates only; needs allocation entries on the payload */
  const hasAllocs = m.staff.some(s => Array.isArray(s.allocations) && s.allocations.length > 0);
  let rollOffs: BenchSection["rollOffs"] = null;
  if (hasAllocs) {
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const horizon = todayMs + 28 * DAY_MS;
    const rows: RollOffRow[] = [];
    for (const s of m.staff) {
      if (s.activeProjects <= 0 || !s.allocations?.length) continue;
      let maxEnd = -Infinity;
      let project = "";
      for (const a of s.allocations) {
        const e = parseLocalDay(a.endDate ?? "");
        if (isNaN(e)) continue;
        if (e > maxEnd) { maxEnd = e; project = a.projectName || a.projectId; }
      }
      if (maxEnd >= todayMs && maxEnd <= horizon) {
        rows.push({
          name: s.name, role: s.role, division: s.division,
          project,
          endsOn: new Date(maxEnd).toISOString(),
          daysLeft: Math.max(0, Math.round((maxEnd - todayMs) / DAY_MS)),
          utilization: Math.round(s.utilization),
        });
      }
    }
    rows.sort((a, b) => a.daysLeft - b.daysLeft);
    rollOffs = {
      rows,
      card: {
        id: "bench",
        title: "Bench — Rolling Off Within 4 Weeks",
        takeaway: "People whose last known allocation ends in the next 28 days — the incoming bench. Real allocation end dates, no projections.",
        stats: [{ label: "Rolling off", value: int(rows.length) }],
        columns: ROLLOFF_COLS,
        rows: rows.map(r => ({ ...r, role: r.role ?? "—", division: r.division ?? "—", _person: r.name })),
      },
    };
  }

  return {
    staffingOk, demandsOk,
    hero: {
      value: int(m.benchCount),
      available: availableCount,
      light: lightCount,
      explain: m.benchCount === 0
        ? "Nobody is sitting fully idle right now."
        : "People with no current project load — ready to be placed.",
      card: benchCard,
      availableCard,
      lightCard,
    },
    matches,
    byRole: ranked(
      "Bench — By Role",
      "Which roles are sitting on the bench (fully available + lightly loaded).",
      countBy(benchStaff, s => s.role), "role"),
    byDivision: ranked(
      "Bench — By Division",
      "Where the bench sits across divisions.",
      countBy(benchStaff, s => s.division), "division"),
    /* BU / Department only when the roster actually carries those fields —
     * an all-"Unassigned" list is absence, not a grouping (the page shows an
     * honest note for a null dimension instead). */
    byBusinessUnit: m.staff.some(s => s.businessUnit) ? ranked(
      "Bench — By Business Unit",
      "Where the bench sits across business units.",
      countBy(benchStaff, s => s.businessUnit), "businessUnit") : null,
    byDepartment: m.staff.some(s => s.department) ? ranked(
      "Bench — By Department",
      "Where the bench sits across departments.",
      countBy(benchStaff, s => s.department), "department") : null,
    rollOffs,
  };
}

/* ═══════════════════ OPEN POSITIONS & DEMAND ═══════════════════ */
export type AffectedProjectRow = { ticket: string; project: string; seats: number; roles: string };
export type OpenPositionsSection = {
  demandsOk: boolean;
  staffingOk: boolean;
  hero: { value: string; rolesAffected: number | null; rolesCard: CardModel | null; explain: string; card: CardModel | null };
  kpis: { label: string; value: string; card: CardModel | null }[];
  byRole: RankedList | null;
  /** when each open seat needs someone: already started / soon / later / undated */
  timing: SegmentList | null;
  /** forward 12-week count of open seats needing coverage — the ONE chart.
   *  Built ONLY from positions with both a start and an end date; positions
   *  missing either are counted in undatedCount and disclosed, never plotted. */
  weeklySeats: {
    rows: { week: string; seats: number }[];
    undatedCount: number;
    benchNote: string | null;
    card: CardModel;
    drillCards: Record<string, CardModel>;
  } | null;
  affectedProjects: { rows: AffectedProjectRow[]; card: CardModel } | null;
};

const AFFECTED_COLS: CardColumn[] = [
  { key: "ticket", label: "Project ID", width: 15 },
  { key: "project", label: "Project", width: 38 },
  { key: "seats", label: "Open Seats", kind: "int", align: "right", width: 12 },
  { key: "roles", label: "Roles Needed", width: 34 },
];

export function buildOpenPositionsSection(m: ReportModel, now = new Date(), chartNow = now): OpenPositionsSection {
  const demandsOk = m.sources ? m.sources.demands : true;
  const staffingOk = m.sources ? m.sources.staffing : true;
  if (!demandsOk) {
    return {
      demandsOk, staffingOk,
      hero: {
        value: "—", rolesAffected: null, rolesCard: null,
        explain: "Open-position data didn't load, so nothing is shown here. Refresh to try again — nothing is estimated in the meantime.",
        card: null,
      },
      kpis: [],
      byRole: null, timing: null, weeklySeats: null, affectedProjects: null,
    };
  }

  const allCard: CardModel = {
    id: "open-positions",
    title: "Open Positions — Every Unfilled Seat",
    takeaway: "Each row is one role a project still needs filled.",
    stats: [
      { label: "Open positions", value: int(m.openDemands) },
      { label: "Committed", value: int(m.demands.filter(d => !d.soft).length), filterKey: "type" },
      { label: "Soft requests", value: int(m.demands.filter(d => d.soft).length) },
    ],
    columns: DEMAND_COLS,
    rows: demandRows(m.demands),
  };

  const demandByRole = countBy(m.demands, d => d.role);
  const committed = m.demands.filter(d => !d.soft);
  const soft = m.demands.filter(d => d.soft);

  /* timing buckets from real start dates */
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const soonMs = todayMs + 28 * DAY_MS;
  const bucketOf = (d: DemandRow): "started" | "soon" | "later" | "undated" => {
    if (!d.start) return "undated";
    const s = parseLocalDay(d.start.slice(0, 10));
    if (isNaN(s)) return "undated";
    if (s <= todayMs) return "started";
    if (s <= soonMs) return "soon";
    return "later";
  };
  const buckets = { started: [] as DemandRow[], soon: [] as DemandRow[], later: [] as DemandRow[], undated: [] as DemandRow[] };
  for (const d of m.demands) buckets[bucketOf(d)].push(d);
  const timingCard = (label: string, list: DemandRow[], takeaway: string): CardModel => ({
    id: "open-positions",
    title: `Open Positions — ${label}`,
    takeaway,
    stats: [{ label, value: int(list.length) }],
    columns: DEMAND_COLS,
    rows: demandRows(list),
  });

  /* forward weekly open-seat coverage (counts, not hours — seat counts are
   * unambiguous where per-week allocation numbers are not). Only positions
   * with BOTH real dates are plotted; the rest are disclosed as a count —
   * plotting an undated seat into every week would be an invented claim. */
  let weeklySeats: OpenPositionsSection["weeklySeats"] = null;
  {
    const dated: { d: DemandRow; s: number; e: number }[] = [];
    let undatedCount = 0;
    for (const d of m.demands) {
      const s = d.start ? parseLocalDay(d.start.slice(0, 10)) : NaN;
      const e = d.end ? parseLocalDay(d.end.slice(0, 10)) : NaN;
      if (isNaN(s) || isNaN(e)) undatedCount++;
      else dated.push({ d, s, e });
    }
    if (dated.length > 0) {
      /* chartNow may be shifted by weekOffset (chart navigation) while `now`
       * stays the real current date for timing-bucket / KPI calculations. */
      const starts = forwardWeekStarts(chartNow, 12);
      const seats = new Array<number>(12).fill(0);
      for (const { s, e } of dated) {
        /* day-level overlap on local midnights only (DST-safe): week i is
         * [starts[i], starts[i+1}); an end DAY on/after the week start counts */
        for (let i = 0; i < 12; i++) {
          if (s < starts[i + 1] && e >= starts[i]) seats[i] += 1;
        }
      }
      const rows = starts.slice(0, 12).map((w, i) => ({ week: weekLabel(w), seats: seats[i] }));
      const drillCards = Object.fromEntries(rows.map((row, i) => {
        const matching = dated
          .filter(({ s, e }) => s < starts[i + 1] && e >= starts[i])
          .map(({ d }) => d);
        return [row.week, {
          id: "open-positions" as const,
          title: `Open Positions — Seats Active in Week of ${row.week}`,
          takeaway: `${int(matching.length)} open seat${matching.length === 1 ? "" : "s"} active in this week.`,
          stats: [{ label: "Open seats", value: int(matching.length) }],
          columns: DEMAND_COLS,
          rows: demandRows(matching),
        } satisfies CardModel];
      }));
      const firstWeek = rows[0]?.week ?? "";
      const lastWeek  = rows[rows.length - 1]?.week ?? "";
      const rangeLabel = firstWeek && lastWeek ? `${firstWeek} → ${lastWeek}` : "Next 12 Weeks";
      const benchNote = staffingOk
        ? `For scale: ${int(m.benchCount)} ${m.benchCount === 1 ? "person is" : "people are"} fully available today.`
        : null;
      weeklySeats = {
        rows,
        undatedCount,
        benchNote,
        drillCards,
        card: {
          id: "open-positions",
          title: `Open Positions — Weekly Seat Coverage (Synthetic Aggregate), ${rangeLabel}`,
          takeaway: `Synthetic weekly aggregate: each row is the COUNT of open seats active in that week, computed from real position start/end dates — not a list of individual position records.`
            + ` Covers ${rangeLabel}.`
            + (undatedCount > 0 ? ` ${int(undatedCount)} position${undatedCount === 1 ? " has" : "s have"} no dates and ${undatedCount === 1 ? "is" : "are"} not included.` : ""),
          stats: [
            { label: firstWeek || "First week", value: int(rows[0]?.seats ?? 0) },
            ...(undatedCount > 0 ? [{ label: "Not plotted (no dates)", value: int(undatedCount) }] : []),
            ...(staffingOk ? [{ label: "Fully available today", value: int(m.benchCount) }] : []),
          ],
          columns: [
            { key: "week", label: "Week Of", width: 14 },
            { key: "seats", label: "Open Seats (Aggregate)", kind: "int", align: "right", width: 22 },
          ],
          rows: rows.map(r => ({ ...r, _aggregate: "true" })),
        },
      };
    }
  }

  /* most affected projects */
  const byTicket = new Map<string, { ticket: string; project: string; roles: string[] }>();
  for (const d of m.demands) {
    const cur = byTicket.get(d.ticket) ?? { ticket: d.ticket, project: d.project, roles: [] };
    cur.roles.push(d.role);
    byTicket.set(d.ticket, cur);
  }
  const affectedRows: AffectedProjectRow[] = [...byTicket.values()]
    .map(p => ({
      ticket: p.ticket,
      project: p.project,
      seats: p.roles.length,
      roles: p.roles.slice(0, 3).join(", ") + (p.roles.length > 3 ? ` +${p.roles.length - 3} more` : ""),
    }))
    .sort((a, b) => b.seats - a.seats);

  return {
    demandsOk, staffingOk,
    hero: {
      value: int(m.openDemands),
      rolesAffected: demandByRole.length,
      rolesCard: {
        id: "open-positions",
        title: "Open Positions — Roles Affected",
        takeaway: demandByRole.length > 0
          ? "Every role with at least one unfilled seat."
          : "No roles have unfilled seats right now.",
        stats: demandByRole.slice(0, 4).map(r => ({ label: r.label, value: int(r.v), filterKey: "role" })),
        columns: DEMAND_COLS,
        rows: demandRows([...m.demands].sort((a, b) => a.role.localeCompare(b.role))),
      },
      explain: demandByRole.length > 0
        ? `${demandByRole[0].label} is the biggest gap with ${int(demandByRole[0].v)} open seat${demandByRole[0].v === 1 ? "" : "s"}.`
        : "No unfilled positions right now.",
      card: allCard,
    },
    kpis: [
      { label: "Committed seats", value: int(committed.length), card: timingCard("Committed Seats", committed, "Open seats on committed (non-soft) requests.") },
      { label: "Soft requests", value: int(soft.length), card: timingCard("Soft Requests", soft, "Open seats requested softly — not yet committed.") },
      {
        label: "Projects affected", value: int(byTicket.size),
        card: {
          id: "open-positions",
          title: "Open Positions — Projects Affected",
          takeaway: affectedRows.length > 0
            ? "Projects with at least one unfilled seat, most affected first."
            : "No projects have unfilled seats right now.",
          stats: [{ label: "Total Projects", value: int(byTicket.size) }],
          columns: AFFECTED_COLS,
          rows: affectedRows.map(r => ({ ...r, _ticket: r.ticket })),
        },
      },
      {
        label: "Already started, unstaffed", value: int(buckets.started.length),
        card: timingCard(
          "Already Started, Still Unstaffed", buckets.started,
          buckets.started.length > 0
            ? "Positions whose window has already begun with nobody assigned — the most urgent gaps."
            : "No position's window has begun without someone assigned — an empty list is the good answer here.",
        ),
      },
    ],
    byRole: demandByRole.length > 0 ? {
      rows: demandByRole.slice(0, 8),
      allRows: demandByRole,
      totalGroups: demandByRole.length,
      card: {
        id: "open-positions",
        title: "Open Positions — By Role",
        takeaway: "Which roles the firm is short of, biggest gap first.",
        stats: demandByRole.slice(0, 4).map(r => ({ label: r.label, value: int(r.v), filterKey: "role" })),
        columns: DEMAND_COLS,
        rows: demandRows([...m.demands].sort((a, b) => a.role.localeCompare(b.role))),
      },
    } : null,
    timing: m.demands.length > 0 ? {
      total: Math.max(1, m.demands.length),
      segments: [
        { label: "Already started", v: buckets.started.length, color: "#F87171" },
        { label: "Starting ≤ 4 weeks", v: buckets.soon.length, color: "#F0A842" },
        { label: "Starting later", v: buckets.later.length, color: "#6B99BB" },
        { label: "No start date", v: buckets.undated.length, color: "rgba(255,255,255,0.3)" },
      ],
      card: {
        id: "open-positions",
        title: "Open Positions — When Each Seat Is Needed",
        takeaway: "Open seats grouped by how soon their window starts (real position dates).",
        stats: [
          { label: "Already started", value: int(buckets.started.length) },
          { label: "≤ 4 weeks", value: int(buckets.soon.length) },
          { label: "Later", value: int(buckets.later.length) },
          { label: "Undated", value: int(buckets.undated.length) },
        ],
        columns: DEMAND_COLS,
        // timing field matches the donut segment labels exactly so segment
        // clicks can filter this card to just that bucket's rows.
        rows: [
          ...demandRows(buckets.started).map(r => ({ ...r, timing: "Already started" })),
          ...demandRows(buckets.soon).map(r => ({ ...r, timing: "Starting ≤ 4 weeks" })),
          ...demandRows(buckets.later).map(r => ({ ...r, timing: "Starting later" })),
          ...demandRows(buckets.undated).map(r => ({ ...r, timing: "No start date" })),
        ],
      },
    } : null,
    weeklySeats,
    affectedProjects: affectedRows.length > 0 ? {
      rows: affectedRows.slice(0, 10),
      card: {
        id: "open-positions",
        title: "Open Positions — Most Affected Projects",
        takeaway: "Projects with the most unfilled seats.",
        stats: affectedRows.slice(0, 4).map(r => ({ label: r.ticket, value: int(r.seats), filterKey: "ticket" })),
        columns: AFFECTED_COLS,
        rows: affectedRows.map(r => ({ ...r, _ticket: r.ticket })),
      },
    } : null,
  };
}

export type OrgBoard = {
  rows: OrgBoardRow[];
  card: CardModel;
  drillCards: Record<string, CardModel>;
};
