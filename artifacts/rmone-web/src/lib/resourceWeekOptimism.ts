import type { ActiveAllocationProxy, LiveResourceProxy } from "./api";
import {
  allocEntryHrsPerWeek,
  hoursWinFilter,
  mondayOf,
  parseLocalDay,
  parsePeriodKey,
  parseUtilCell,
  type UtilMode,
} from "./utilGrid";

export interface ResourceWeekOverride {
  personId: string;
  personName: string;
  projectId: string;
  projectName: string;
  week: string;
  previousHours: number;
  hours: number;
  revision: number;
  /** The authoritative Project Team verification read accepted this value. */
  verificationSucceeded?: boolean;
  /** The raw Resources allocation feed has subsequently shown this value. */
  allocationConfirmed?: boolean;
}

export type ResourceWeekOverrideMap = Record<string, ResourceWeekOverride>;

const HOUR_TOLERANCE = 0.05;

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function localIsoDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function offsetLocalDay(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function weekBounds(week: string): { start: number; end: number } | null {
  const parsed = parseLocalDay(week);
  if (!Number.isFinite(parsed)) return null;
  const start = mondayOf(parsed);
  return { start, end: offsetLocalDay(start, 6) };
}

export function resourceWeekOverrideKey(personId: string, projectId: string, week: string): string {
  return `${normalized(personId)}|${normalized(projectId)}|${week}`;
}

export function hasResourceWeekOverrideInWindow(
  overrides: ResourceWeekOverride[],
  personId: string,
  windowStart: number,
  windowEnd: number,
): boolean {
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) return false;
  const personKey = normalized(personId);
  return overrides.some(override => {
    if (normalized(override.personId) !== personKey) return false;
    const bounds = weekBounds(override.week);
    return Boolean(bounds && bounds.start <= windowEnd && bounds.end >= windowStart);
  });
}

export function storeResourceWeekOverride(
  current: ResourceWeekOverrideMap,
  override: ResourceWeekOverride,
): ResourceWeekOverrideMap {
  const key = resourceWeekOverrideKey(override.personId, override.projectId, override.week);
  const existing = current[key];
  if (existing && existing.revision > override.revision) return current;
  return { ...current, [key]: override };
}

export function removeResourceWeekOverrideIfRevision(
  current: ResourceWeekOverrideMap,
  key: string,
  revision: number,
): ResourceWeekOverrideMap {
  const existing = current[key];
  if (!existing || existing.revision !== revision) return current;
  const next = { ...current };
  delete next[key];
  return next;
}

export function resourceProjectWeekHours(
  resource: LiveResourceProxy | undefined,
  projectId: string,
  week: string,
  workWeekHours: number,
): number {
  const bounds = weekBounds(week);
  if (!resource || !bounds) return 0;
  const entries = ((resource.allAllocations ?? resource.activeAllocations ?? []) as ActiveAllocationProxy[])
    .filter(entry => {
      if (normalized(entry.projectId ?? "") !== normalized(projectId)) return false;
      const start = parseLocalDay(entry.startDate);
      const end = parseLocalDay(entry.endDate);
      return Number.isFinite(start) && Number.isFinite(end) && start <= bounds.end && end >= bounds.start;
    });
  const total = hoursWinFilter(entries)
    .reduce((sum, entry) => sum + allocEntryHrsPerWeek(entry, workWeekHours), 0);
  return Math.round(total * 10) / 10;
}

function replaceProjectWeek(
  entries: ActiveAllocationProxy[] | undefined,
  override: ResourceWeekOverride,
  workWeekHours: number,
): ActiveAllocationProxy[] {
  const bounds = weekBounds(override.week);
  if (!bounds) return entries ?? [];
  const projectKey = normalized(override.projectId);
  let template: ActiveAllocationProxy | undefined;
  const next: ActiveAllocationProxy[] = [];

  for (const entry of entries ?? []) {
    if (normalized(entry.projectId ?? "") !== projectKey) {
      next.push(entry);
      continue;
    }
    const start = parseLocalDay(entry.startDate);
    const end = parseLocalDay(entry.endDate);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > bounds.end || end < bounds.start) {
      next.push(entry);
      continue;
    }

    template ??= entry;
    if (start < bounds.start) {
      next.push({ ...entry, endDate: localIsoDay(offsetLocalDay(bounds.start, -1)) });
    }
    if (end > bounds.end) {
      next.push({ ...entry, startDate: localIsoDay(offsetLocalDay(bounds.end, 1)) });
    }
  }

  if (override.hours > 0) {
    const pct = Math.round((override.hours / Math.max(workWeekHours, 1)) * 10_000) / 100;
    next.push({
      ...(template ?? {
        projectId: override.projectId,
        projectName: override.projectName,
      }),
      projectId: override.projectId,
      projectName: template?.projectName || override.projectName,
      pct,
      hours: override.hours,
      startDate: localIsoDay(bounds.start),
      endDate: localIsoDay(bounds.end),
    });
  }

  return next.sort((a, b) =>
    parseLocalDay(a.startDate) - parseLocalDay(b.startDate) ||
    normalized(a.projectId).localeCompare(normalized(b.projectId))
  );
}

export function applyResourceWeekOverrides(
  resources: LiveResourceProxy[],
  overrides: ResourceWeekOverride[],
  workWeekHours: number,
): LiveResourceProxy[] {
  if (overrides.length === 0) return resources;
  const byPerson = new Map<string, ResourceWeekOverride[]>();
  for (const override of overrides) {
    const key = normalized(override.personId);
    const list = byPerson.get(key) ?? [];
    list.push(override);
    byPerson.set(key, list);
  }

  return resources.map(resource => {
    const personOverrides = byPerson.get(normalized(resource.id));
    if (!personOverrides?.length) return resource;
    let allAllocations = [...(resource.allAllocations ?? resource.activeAllocations ?? [])];
    let activeAllocations = [...(resource.activeAllocations ?? [])];
    for (const override of personOverrides.sort((a, b) => a.revision - b.revision)) {
      allAllocations = replaceProjectWeek(allAllocations, override, workWeekHours);
      activeAllocations = replaceProjectWeek(activeAllocations, override, workWeekHours);
    }
    const activeProjects = Array.from(new Set(
      activeAllocations
        .filter(entry => (entry.hours ?? 0) > 0 || (entry.pct ?? 0) > 0)
        .map(entry => entry.projectId)
        .filter(Boolean),
    ));
    return {
      ...resource,
      allAllocations,
      activeAllocations,
      activeProjects,
      allProjectIds: Array.from(new Set([
        ...(resource.allProjectIds ?? []),
        ...personOverrides.map(override => override.projectId),
      ])),
    };
  });
}

interface UtilPeriodMetrics {
  hours: number;
  /** Hours encoded by the server utilization cell (explicit rows win). */
  serverHours: number;
  pct: number;
  projectIds: { pid: string; pct: number }[];
  projectCount: number;
}

function formatUtilCell(metrics: UtilPeriodMetrics): string | null {
  const { hours, projectIds, projectCount } = metrics;
  const roundedHours = Math.round(Math.max(0, hours) * 10) / 10;
  const pct = Math.max(0, Math.round(metrics.pct));
  if (roundedHours <= 0 && pct <= 0) return null;
  const status = pct >= 120 ? "Over" : pct >= 40 ? "Good" : "Under";
  const ids = projectIds.length > 0
    ? `#IDS:${projectIds.map(entry => `${entry.pid}:${Math.round(entry.pct)}`).join("|")}`
    : "";
  return `P:${pct}#H:${roundedHours}#C:${projectCount}#F:${(pct / 100).toFixed(2)}#A:${Math.max(0, 100 - pct)}#S:${status}${ids}`;
}

function monthMatches(periodStart: number, weekStart: number): boolean {
  const period = new Date(periodStart);
  const week = new Date(weekStart);
  return period.getFullYear() === week.getFullYear() && period.getMonth() === week.getMonth();
}

function firstMondayInMonth(periodStart: number): Date {
  const month = new Date(periodStart);
  const cursor = new Date(month.getFullYear(), month.getMonth(), 1);
  const firstMonday = mondayOf(cursor.getTime());
  if (firstMonday < cursor.getTime()) cursor.setTime(offsetLocalDay(firstMonday, 7));
  else cursor.setTime(firstMonday);
  return cursor;
}

function weeklyUtilMetrics(
  resource: LiveResourceProxy,
  weekStart: number,
  workWeekHours: number,
): UtilPeriodMetrics | null {
  const weekEnd = offsetLocalDay(weekStart, 6);
  const overlapping = ((resource.allAllocations ?? resource.activeAllocations ?? []) as ActiveAllocationProxy[])
    .filter(entry => {
      const start = parseLocalDay(entry.startDate);
      const end = parseLocalDay(entry.endDate);
      return Number.isFinite(start) && Number.isFinite(end) && start <= weekEnd && end >= weekStart;
    });
  const effective = hoursWinFilter(overlapping);
  if (effective.length === 0) return null;

  let pct = 0;
  let hours = 0;
  let explicitHours = 0;
  const projectPcts = new Map<string, number>();
  for (const entry of effective) {
    const entryPct = Number(entry.pct) || 0;
    pct += entryPct;
    hours += allocEntryHrsPerWeek(entry, workWeekHours);
    explicitHours += Number(entry.hours) > 0 ? Number(entry.hours) : 0;
    if (entry.projectId) {
      projectPcts.set(entry.projectId, Math.max(projectPcts.get(entry.projectId) ?? 0, entryPct));
    }
  }
  if (pct <= 0 && hours <= 0) return null;
  return {
    hours: Math.round(hours * 10) / 10,
    serverHours: explicitHours > 0
      ? Math.round(explicitHours)
      : Math.round((pct / 100) * workWeekHours * 10) / 10,
    pct: Math.round(pct),
    projectIds: Array.from(projectPcts.entries()).map(([pid, projectPct]) => ({ pid, pct: projectPct })),
    projectCount: projectPcts.size,
  };
}

function monthlyUtilMetrics(
  resource: LiveResourceProxy,
  periodStart: number,
  workWeekHours: number,
): UtilPeriodMetrics | null {
  const month = new Date(periodStart);
  const cursor = firstMondayInMonth(periodStart);
  let totalHours = 0;
  let totalServerHours = 0;
  let totalPct = 0;
  let activeWeeks = 0;
  let projectCount = 0;
  const projectPcts = new Map<string, number>();
  while (cursor.getMonth() === month.getMonth() && cursor.getFullYear() === month.getFullYear()) {
    const weekly = weeklyUtilMetrics(resource, cursor.getTime(), workWeekHours);
    if (weekly) {
      totalHours += weekly.hours;
      totalServerHours += weekly.serverHours;
      totalPct += weekly.pct;
      activeWeeks++;
      projectCount = Math.max(projectCount, weekly.projectCount);
      for (const entry of weekly.projectIds) {
        projectPcts.set(entry.pid, Math.max(projectPcts.get(entry.pid) ?? 0, entry.pct));
      }
    }
    cursor.setDate(cursor.getDate() + 7);
  }
  if (activeWeeks === 0) return null;
  return {
    // The API's monthly H field is the sum of weekly H values; P is the
    // average across active Monday buckets (rds-provider.ts monthly aggregate).
    hours: Math.round(totalHours * 10) / 10,
    serverHours: Math.round(totalServerHours),
    pct: Math.round(totalPct / activeWeeks),
    projectIds: Array.from(projectPcts.entries()).map(([pid, projectPct]) => ({ pid, pct: projectPct })),
    projectCount,
  };
}

function periodUtilMetrics(
  resource: LiveResourceProxy,
  periodStart: number,
  mode: UtilMode,
  workWeekHours: number,
): UtilPeriodMetrics | null {
  return mode === "Weekly"
    ? weeklyUtilMetrics(resource, mondayOf(periodStart), workWeekHours)
    : monthlyUtilMetrics(resource, periodStart, workWeekHours);
}

function periodMatchesOverride(periodStart: number, override: ResourceWeekOverride, mode: UtilMode): boolean {
  const weekStart = parseLocalDay(override.week);
  if (!Number.isFinite(weekStart)) return false;
  return mode === "Weekly"
    ? mondayOf(periodStart) === mondayOf(weekStart)
    : monthMatches(periodStart, mondayOf(weekStart));
}

export function applyResourceWeekOverridesToUtilRows(
  rows: Record<string, unknown>[],
  rawResources: LiveResourceProxy[],
  overrides: ResourceWeekOverride[],
  mode: UtilMode,
  workWeekHours: number,
): Record<string, unknown>[] {
  if (overrides.length === 0 || rows.length === 0) return rows;
  const rawById = new Map(rawResources.map(resource => [normalized(resource.id), resource]));
  const byPerson = new Map<string, ResourceWeekOverride[]>();
  for (const override of overrides) {
    const key = normalized(override.personId);
    const list = byPerson.get(key) ?? [];
    list.push(override);
    byPerson.set(key, list);
  }
  if (byPerson.size === 0) return rows;

  return rows.map(row => {
    const rowId = normalized(String(row.UserId ?? ""));
    const personOverrides = byPerson.get(rowId);
    if (!personOverrides?.length) return row;
    const rawResource = rawById.get(rowId);
    const next = { ...row };
    const overlaidResource = rawResource
      ? applyResourceWeekOverrides([rawResource], personOverrides, workWeekHours)[0]
      : null;

    for (const [period, rawCell] of Object.entries(row)) {
      const periodStart = parsePeriodKey(period);
      if (!Number.isFinite(periodStart)) continue;
      const matching = personOverrides.filter(override => periodMatchesOverride(periodStart, override, mode));
      if (matching.length === 0) continue;

      if (overlaidResource) {
        const metrics = periodUtilMetrics(overlaidResource, periodStart, mode, workWeekHours);
        next[period] = metrics ? formatUtilCell(metrics) : null;
        continue;
      }

      // No approximate delta fallback: without this person's allocation
      // snapshot we cannot correctly derive monthly active-week denominators,
      // project IDs, or peak concurrency. Keep the last server cell until the
      // allocation response arrives; mounted editors still retain their exact
      // local value and the allocation-derived Staff views remain correct.
    }
    return next;
  });
}

type RawUtilStatus = "match" | "mismatch" | "missing";

function rawUtilStatusForResource(
  rows: Record<string, unknown>[],
  resource: LiveResourceProxy,
  override: ResourceWeekOverride,
  mode: UtilMode,
  workWeekHours: number,
): RawUtilStatus {
  const row = rows.find(candidate =>
    normalized(String(candidate.UserId ?? "")) === normalized(resource.id)
  );
  if (!row) return "missing";
  for (const [period, rawCell] of Object.entries(row)) {
    const periodStart = parsePeriodKey(period);
    if (!Number.isFinite(periodStart) || !periodMatchesOverride(periodStart, override, mode)) continue;
    const expected = periodUtilMetrics(resource, periodStart, mode, workWeekHours);
    const actual = parseUtilCell(rawCell);
    if (!expected && !actual) return "match";
    if (!expected || !actual) return "mismatch";
    // The server rounds explicit weekly hours to whole numbers in utilization
    // cells, while allocation rows retain the accepted decimal value.
    return Math.abs(actual.h - expected.serverHours) <= 0.55 &&
      Math.abs(actual.p - expected.pct) <= 1 &&
      actual.c === expected.projectCount
      ? "match"
      : "mismatch";
  }
  return "missing";
}

export function pruneConfirmedResourceWeekOverrides(
  current: ResourceWeekOverrideMap,
  resources: LiveResourceProxy[],
  utilRows: Record<string, unknown>[],
  mode: UtilMode,
  workWeekHours: number,
  options: {
    allowMissingUtilPeriod?: boolean;
    onlyKey?: string;
    onlyRevision?: number;
  } = {},
): ResourceWeekOverrideMap {
  let changed = false;
  const byId = new Map(resources.map(resource => [normalized(resource.id), resource]));
  const next: ResourceWeekOverrideMap = {};
  for (const [key, override] of Object.entries(current)) {
    if (
      (options.onlyKey && key !== options.onlyKey) ||
      (options.onlyRevision !== undefined && override.revision !== options.onlyRevision)
    ) {
      next[key] = override;
      continue;
    }
    const resource = byId.get(normalized(override.personId));
    const allocationMatches = resource &&
      Math.abs(resourceProjectWeekHours(resource, override.projectId, override.week, workWeekHours) - override.hours) <= HOUR_TOLERANCE;
    if (allocationMatches && resource) {
      const utilStatus = rawUtilStatusForResource(utilRows, resource, override, mode, workWeekHours);
      if (utilStatus === "match" || (utilStatus === "missing" && options.allowMissingUtilPeriod)) {
        changed = true;
        continue;
      }
      if (override.verificationSucceeded && !override.allocationConfirmed) {
        next[key] = { ...override, allocationConfirmed: true };
        changed = true;
      } else {
        next[key] = override;
      }
      continue;
    }
    if (override.allocationConfirmed) {
      // This tuple was observed at the accepted value and has since moved
      // again. That later raw allocation is newer server truth, not a stale
      // post-save response, so an old overlay must never mask it.
      changed = true;
      continue;
    }
    next[key] = override;
  }
  return changed ? next : current;
}