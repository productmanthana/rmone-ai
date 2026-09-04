// Computes the Visual Forecasting screen's four zones (heatmap, demand/capacity
// curve, resource collision, win-pursuit scenario) entirely from the live
// allocation, demand, and OPM/PMM/LEM records the rest of the mobile app
// already consumes. No hard-coded demo numbers — every value here is a
// function of the data passed in.
//
// Data choices:
// - Heatmap roll-ups use LiveResource.activeAllocations (the same source the
//   Resources Timeline view aggregates from in lib/api.ts).
// - Demand vs Capacity curve uses DemandItem records (real allocation
//   requests with explicit Role / window) measured against current FTE
//   capacity per cohort (count of LiveResources matching the cohort).
// - Resource collision picks the LiveResource with the highest projected
//   weekly load and surfaces their actual top conflicting projects.
// - Win-pursuit scenario picks the NYCHA opportunity if present, else the
//   top open OPM by ApproxContractValue, and applies a deterministic ramp
//   derived from that record's value, target start date, and metadata.

import { compactUsd } from "./money";
import type { DemandItem, LiveResource, ModuleRecord, ResourceMasterRow } from "./api";

export type PivotKey = "Office" | "Role" | "Discipline";

const NUM_WEEKS = 8;
const MAX_HEATMAP_ROWS = 7;
const PALETTE = ["#6BA539", "#A9C23F", "#E87722", "#3B7E2B", "#B27518"];

export interface ForecastWeek {
  label: string;   // ISO week label e.g. "W18"
  startMs: number; // Monday 00:00 local
  endMs: number;   // Sunday 23:59:59 local
}

export interface HeatmapData {
  title: string;
  answer: string;
  peakWeekIdx: number;
  rows: { label: string; values: number[] }[];
}

export interface CurveData {
  title: string;
  answer: string;
  cohort: string;
  /** Both arrays in FTE units. */
  demand: number[];
  capacity: number[];
  /** Index of the first week where demand > capacity, or argmax(demand) if
   *  the curves never cross within the window. -1 when there's no data. */
  hireIndex: number;
  yMin: number;
  yMax: number;
  hasCrossover: boolean;
}

export interface CollisionData {
  title: string;
  answer: string;
  rightTag: string;
  bars: { label: string; startIdx: number; endIdx: number; color: string }[];
  overlapIdx: number[];
}

export interface ScenarioInfo {
  hasPursuit: boolean;
  pursuitId: string;
  pursuitTitle: string;
  pursuitClient: string;
  pursuitValue: number;
  /** "+$8.2M" — derived from ApproxContractValue */
  valueLabel: string;
  /** "What if we win NYCHA Castle Hill?" */
  promptHeadline: string;
  /** Subtitle showing pursuit + client + value */
  promptDetail: string;
  /** Heatmap rows / curves to bump if matching */
  affectedOffice: string;
  affectedDiscipline: string;
  affectedRole: string;
}

export interface ForecastIntelligence {
  weeks: ForecastWeek[];
  weekLabels: string[];
  base: {
    heatmap: Record<PivotKey, HeatmapData>;
    curve: Record<PivotKey, CurveData>;
    collision: Record<PivotKey, CollisionData>;
  };
  win: {
    heatmap: Record<PivotKey, HeatmapData>;
    curve: Record<PivotKey, CurveData>;
    collision: Record<PivotKey, CollisionData>;
  };
  scenario: ScenarioInfo;
  meta: {
    resourceCount: number;
    demandCount: number;
    projectsWithMeta: number;
  };
}

/* ── Date helpers ──────────────────────────────────────────────────── */
function mondayOf(d: Date): Date {
  const c = new Date(d);
  const day = c.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  c.setDate(c.getDate() + diff);
  c.setHours(0, 0, 0, 0);
  return c;
}

function isoWeekNum(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabelOf(ms: number): string {
  return MONTH_ABBR[new Date(ms).getMonth()];
}

function buildWeeks(now: Date): ForecastWeek[] {
  const monday = mondayOf(now);
  const weeks: ForecastWeek[] = [];
  for (let i = 0; i < NUM_WEEKS; i++) {
    const start = new Date(monday);
    start.setDate(start.getDate() + i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    weeks.push({
      label: `W${isoWeekNum(start)}`,
      startMs: start.getTime(),
      endMs: end.getTime(),
    });
  }
  return weeks;
}

function fmtMoney(n: number): string {
  if (!isFinite(n) || n <= 0) return "$0";
  if (n >= 1e9) return compactUsd(n);
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

/* ── Project metadata lookup (city / discipline) ───────────────────── */
interface ProjMeta { city: string; discipline: string; title: string }

function getProjectCity(r: any): string {
  return String(r?.City || "").trim();
}
function getProjectDiscipline(r: any): string {
  return String(
    r?.SectorChoice || r?.Sector || r?.SectorName ||
    r?.IndustryChoice || r?.MarketSector ||
    r?.CRMBusinessUnitChoice || ""
  ).trim();
}
function getProjectTitle(r: any): string {
  return String(r?.Title || r?.ShortName || r?.TicketId || "").trim();
}

function buildProjectMeta(...lists: ModuleRecord[][]): Record<string, ProjMeta> {
  const map: Record<string, ProjMeta> = {};
  for (const list of lists) {
    for (const r of list || []) {
      const id = String((r as any)?.TicketId || "");
      if (!id) continue;
      const meta = {
        city: getProjectCity(r),
        discipline: getProjectDiscipline(r),
        title: getProjectTitle(r),
      };
      const cur = map[id];
      if (!cur) {
        map[id] = meta;
      } else {
        if (!cur.city && meta.city) cur.city = meta.city;
        if (!cur.discipline && meta.discipline) cur.discipline = meta.discipline;
        if (!cur.title && meta.title) cur.title = meta.title;
      }
    }
  }
  return map;
}

/* ── Per-resource weekly load ──────────────────────────────────────── */
function resourceWeeklyTotal(r: LiveResource, weeks: ForecastWeek[]): number[] {
  const out = new Array(weeks.length).fill(0);
  for (const a of r.activeAllocations) {
    const aS = new Date(a.startDate).getTime();
    const aE = new Date(a.endDate).getTime();
    if (!isFinite(aS) || !isFinite(aE)) continue;
    for (let i = 0; i < weeks.length; i++) {
      const w = weeks[i];
      if (aS <= w.endMs && aE >= w.startMs) out[i] += a.pct;
    }
  }
  return out;
}

function resourceWeeklyFiltered(
  r: LiveResource,
  weeks: ForecastWeek[],
  match: (projectId: string) => boolean,
): number[] {
  const out = new Array(weeks.length).fill(0);
  for (const a of r.activeAllocations) {
    if (!match(a.projectId)) continue;
    const aS = new Date(a.startDate).getTime();
    const aE = new Date(a.endDate).getTime();
    if (!isFinite(aS) || !isFinite(aE)) continue;
    for (let i = 0; i < weeks.length; i++) {
      const w = weeks[i];
      if (aS <= w.endMs && aE >= w.startMs) out[i] += a.pct;
    }
  }
  return out;
}

/* ── Heatmap (mean cohort utilization per week) ────────────────────── */
function buildHeatmap(
  pivot: PivotKey,
  resources: LiveResource[],
  projectMeta: Record<string, ProjMeta>,
  weeks: ForecastWeek[],
  resourceOfficeMap: Map<string, string>,
): HeatmapData {
  const cohorts = new Map<string, number[][]>();

  if (pivot === "Role") {
    // Role grouping is per-resource (their job title) — load is total weekly load.
    const totals = new Map<LiveResource, number[]>();
    for (const r of resources) totals.set(r, resourceWeeklyTotal(r, weeks));
    for (const r of resources) {
      const role = (r.role || "").trim() || "Unassigned";
      if (!cohorts.has(role)) cohorts.set(role, []);
      cohorts.get(role)!.push(totals.get(r)!);
    }
  } else if (pivot === "Office") {
    // Office grouping is per-resource (their registered office/location).
    // Use total weekly load — a person belongs to exactly one office.
    const totals = new Map<LiveResource, number[]>();
    for (const r of resources) totals.set(r, resourceWeeklyTotal(r, weeks));
    for (const r of resources) {
      const office = resourceOfficeMap.get(r.id) || "Unassigned";
      if (!cohorts.has(office)) cohorts.set(office, []);
      cohorts.get(office)!.push(totals.get(r)!);
    }
  } else {
    // Discipline pivot: group by the discipline of the projects a person works on.
    for (const r of resources) {
      const groupKeys = new Set<string>();
      for (const a of r.activeAllocations) {
        const m = projectMeta[a.projectId];
        if (!m) continue;
        if (m.discipline) groupKeys.add(m.discipline);
      }
      for (const k of groupKeys) {
        const filtered = resourceWeeklyFiltered(r, weeks, (pid) => {
          const m = projectMeta[pid];
          return !!m && m.discipline === k;
        });
        if (!cohorts.has(k)) cohorts.set(k, []);
        cohorts.get(k)!.push(filtered);
      }
    }
  }

  const rows: { key: string; values: number[]; teamSize: number }[] = [];
  for (const [key, arrays] of cohorts.entries()) {
    if (!key || arrays.length === 0) continue;
    const values = weeks.map((_, i) => {
      const sum = arrays.reduce((s, a) => s + a[i], 0);
      return sum / arrays.length;
    });
    rows.push({ key, values, teamSize: arrays.length });
  }

  rows.sort((a, b) => Math.max(...b.values) - Math.max(...a.values));
  const top = rows.slice(0, MAX_HEATMAP_ROWS);

  let peakWeekIdx = 0;
  let peakRow = "";
  let peakVal = 0;
  for (const row of top) {
    for (let i = 0; i < row.values.length; i++) {
      if (row.values[i] > peakVal) {
        peakVal = row.values[i];
        peakWeekIdx = i;
        peakRow = row.key;
      }
    }
  }

  const answer = top.length === 0
    ? `${weeks[0].label} · No data`
    : peakVal === 0
      ? `${weeks[0].label} · No active load`
      : `${weeks[peakWeekIdx].label} · ${peakRow} ${Math.round(peakVal)}%`;

  return {
    title: "Peak overload week",
    answer,
    peakWeekIdx,
    rows: top.map((r) => ({ label: r.key, values: r.values })),
  };
}

/* ── Demand vs Capacity curve (DemandItem-driven) ──────────────────── */
function buildCurve(
  pivot: PivotKey,
  resources: LiveResource[],
  demands: DemandItem[],
  projectMeta: Record<string, ProjMeta>,
  weeks: ForecastWeek[],
  resourceOfficeMap: Map<string, string>,
): CurveData {
  // cohort key → weekly demand FTE total
  const demandByCohort = new Map<string, number[]>();
  for (const d of demands) {
    const cohortKeys: string[] = [];
    if (pivot === "Role") {
      const r = (d.Role || "").trim() || "Unassigned";
      cohortKeys.push(r);
    } else {
      const m = projectMeta[d.TicketId];
      if (!m) continue;
      const k = pivot === "Office" ? m.city : m.discipline;
      if (k) cohortKeys.push(k);
    }
    const aS = new Date(d.AllocationStartDate).getTime();
    const aE = new Date(d.AllocationEndDate).getTime();
    if (!isFinite(aS) || !isFinite(aE)) continue;
    for (const k of cohortKeys) {
      if (!demandByCohort.has(k)) demandByCohort.set(k, new Array(weeks.length).fill(0));
      const arr = demandByCohort.get(k)!;
      for (let i = 0; i < weeks.length; i++) {
        const w = weeks[i];
        if (aS <= w.endMs && aE >= w.startMs) {
          arr[i] += (Number(d.PctAllocation) || 0) / 100;
        }
      }
    }
  }

  // Cohort capacity = number of LiveResources matching that cohort.
  const capacityByCohort = new Map<string, number>();
  if (pivot === "Role") {
    for (const r of resources) {
      const role = (r.role || "").trim() || "Unassigned";
      capacityByCohort.set(role, (capacityByCohort.get(role) || 0) + 1);
    }
  } else if (pivot === "Office") {
    // Capacity by office = head count per registered office location.
    for (const r of resources) {
      const office = resourceOfficeMap.get(r.id) || "Unassigned";
      capacityByCohort.set(office, (capacityByCohort.get(office) || 0) + 1);
    }
  } else {
    // Discipline capacity: count each resource once per discipline they work in.
    for (const r of resources) {
      const seen = new Set<string>();
      for (const a of r.activeAllocations) {
        const m = projectMeta[a.projectId];
        if (!m) continue;
        if (m.discipline) seen.add(m.discipline);
      }
      for (const k of seen) capacityByCohort.set(k, (capacityByCohort.get(k) || 0) + 1);
    }
  }

  // Pick cohort with highest peak demand FTE
  let bestKey = "";
  let bestDemand: number[] = new Array(weeks.length).fill(0);
  let bestCap = 0;
  let bestPeak = -1;
  for (const [key, arr] of demandByCohort.entries()) {
    const peak = Math.max(...arr);
    if (peak > bestPeak) {
      bestPeak = peak;
      bestKey = key;
      bestDemand = arr;
      bestCap = Math.max(1, capacityByCohort.get(key) || 0);
    }
  }

  if (!bestKey || bestPeak <= 0) {
    return {
      title: "Hiring trigger month",
      answer: "No demand in 8-week window",
      cohort: "",
      demand: new Array(NUM_WEEKS).fill(0),
      capacity: new Array(NUM_WEEKS).fill(0),
      hireIndex: 0,
      yMin: 0,
      yMax: 10,
      hasCrossover: false,
    };
  }

  const capacityArr = new Array(weeks.length).fill(bestCap);
  const crossoverIdx = bestDemand.findIndex((d) => d > bestCap);
  const hasCrossover = crossoverIdx !== -1;
  const peakDemandIdx = bestDemand.indexOf(Math.max(...bestDemand));
  const hireIdx = hasCrossover ? crossoverIdx : peakDemandIdx;
  const yMax = Math.max(bestPeak, bestCap, 1) * 1.2;
  const peakWeek = weeks[hireIdx];
  const need = Math.max(1, Math.ceil(bestDemand[hireIdx] - bestCap));
  const cohortLabel = pivot === "Role" ? bestKey : "FTE";

  const answer = hasCrossover
    ? `${monthLabelOf(peakWeek.startMs)} · ${peakWeek.label} · ${need} ${cohortLabel}`
    : `Steady · ${bestKey} within capacity`;

  return {
    title: "Hiring trigger month",
    answer,
    cohort: bestKey,
    demand: bestDemand,
    capacity: capacityArr,
    hireIndex: hireIdx,
    yMin: 0,
    yMax,
    hasCrossover,
  };
}

/* ── Resource collision (most-overloaded individual) ───────────────── */
function buildCollision(
  resources: LiveResource[],
  projectMeta: Record<string, ProjMeta>,
  weeks: ForecastWeek[],
  projectNames: Record<string, string>,
): CollisionData {
  let topR: LiveResource | null = null;
  let topPeak = 0;
  let topLoad: number[] = new Array(weeks.length).fill(0);
  for (const r of resources) {
    const arr = resourceWeeklyTotal(r, weeks);
    const peak = Math.max(...arr);
    if (peak > topPeak) {
      topPeak = peak;
      topR = r;
      topLoad = arr;
    }
  }

  if (!topR) {
    return {
      title: "Resource failure point",
      answer: weeks[0].label,
      rightTag: "NO DATA · 0 PROJECTS · 0%",
      bars: [],
      overlapIdx: [],
    };
  }

  // Top 3 active allocations by pct for this person
  const topAllocs = topR.activeAllocations.slice().sort((a, b) => b.pct - a.pct).slice(0, 3);
  const bars = topAllocs.map((a, i) => {
    const aS = new Date(a.startDate).getTime();
    const aE = new Date(a.endDate).getTime();
    let startIdx = 0;
    let endIdx = weeks.length - 1;
    for (let j = 0; j < weeks.length; j++) {
      if (weeks[j].endMs < aS) startIdx = j + 1;
    }
    for (let j = weeks.length - 1; j >= 0; j--) {
      if (weeks[j].startMs > aE) endIdx = j - 1;
    }
    startIdx = Math.max(0, Math.min(weeks.length - 1, startIdx));
    endIdx = Math.max(startIdx, Math.min(weeks.length - 1, endIdx));
    const meta = projectMeta[a.projectId];
    const projTitle = projectNames[a.projectId] || meta?.title || a.projectId;
    const label = projTitle.length > 14 ? projTitle.slice(0, 13) + "…" : projTitle;
    return { label, startIdx, endIdx, color: PALETTE[i % PALETTE.length] };
  });

  const overlapIdx: number[] = [];
  for (let i = 0; i < topLoad.length; i++) {
    if (topLoad[i] > 100) overlapIdx.push(i);
  }
  // If never crosses 100, fall back to the absolute peak week so the answer
  // still makes visual sense.
  const peakIdx = topLoad.indexOf(topPeak);
  const peakWeek = weeks[peakIdx];

  // Compose right tag: "FIRST L. · N PROJECTS · NN%"
  const parts = topR.name.trim().split(/\s+/);
  const firstName = (parts[0] || topR.name).toUpperCase();
  const lastInitial = parts.length > 1 ? `${parts[parts.length - 1].charAt(0).toUpperCase()}.` : "";
  const tagName = lastInitial ? `${firstName} ${lastInitial}` : firstName;
  const projCount = topR.activeAllocations.length;

  return {
    title: "Resource failure point",
    answer: peakWeek.label,
    rightTag: `${tagName} · ${projCount} PROJ · ${Math.round(topPeak)}%`,
    bars,
    overlapIdx,
  };
}

/* ── Win-pursuit scenario ──────────────────────────────────────────── */
function pickPursuit(opm: ModuleRecord[]): ModuleRecord | null {
  const open = (opm || []).filter((o) => !(o as any)?.Closed);
  // Prefer NYCHA-related opportunity (matches the "What if we win NYCHA?"
  // narrative that's been used historically).
  const nycha = open.find((o) => {
    const t = String((o as any)?.Title || "").toLowerCase();
    const c = String((o as any)?.CRMCompanyLookupName || (o as any)?.ClientName || (o as any)?.CompanyName || "").toLowerCase();
    return t.includes("nycha") || c.includes("nycha");
  });
  if (nycha) return nycha;
  // Else: top open OPM by ApproxContractValue.
  const sorted = open
    .slice()
    .sort(
      (a, b) =>
        (Number((b as any)?.ApproxContractValue) || 0) -
        (Number((a as any)?.ApproxContractValue) || 0),
    );
  return sorted[0] || null;
}

function deriveScenario(
  opm: ModuleRecord[],
  baseRoleCohort: string,
): ScenarioInfo {
  const p = pickPursuit(opm);
  if (!p) {
    return {
      hasPursuit: false,
      pursuitId: "",
      pursuitTitle: "",
      pursuitClient: "",
      pursuitValue: 0,
      valueLabel: "+$0",
      promptHeadline: "No open pursuits to model",
      promptDetail: "There are no open OPM opportunities in the pipeline.",
      affectedOffice: "",
      affectedDiscipline: "",
      affectedRole: baseRoleCohort,
    };
  }
  const id = String((p as any)?.TicketId || "");
  const title = getProjectTitle(p) || "Pursuit";
  const client = String((p as any)?.CRMCompanyLookupName || (p as any)?.ClientName || (p as any)?.CompanyName || "").trim();
  const value = Number((p as any)?.ApproxContractValue) || 0;
  const office = getProjectCity(p);
  const discipline = getProjectDiscipline(p);
  const valueLabel = value > 0 ? `+${fmtMoney(value)}` : "+$0";
  const headlineName = title.length > 30 ? title.slice(0, 29) + "…" : title;
  return {
    hasPursuit: true,
    pursuitId: id,
    pursuitTitle: title,
    pursuitClient: client,
    pursuitValue: value,
    valueLabel,
    promptHeadline: `What if we win ${headlineName}?`,
    promptDetail: client
      ? `${title} · ${client} · ${valueLabel}`
      : `${title} · ${valueLabel}`,
    affectedOffice: office,
    affectedDiscipline: discipline,
    affectedRole: baseRoleCohort,
  };
}

/* Apply the win delta to a curve. Bump = peakFTE × ramp where peakFTE is
 * derived from the pursuit's ApproxContractValue (~1 FTE per $1.5M, a
 * common AEC industry rule of thumb). */
function applyScenarioToCurve(
  pivot: PivotKey,
  base: CurveData,
  scenario: ScenarioInfo,
  weeks: ForecastWeek[],
): CurveData {
  if (!scenario.hasPursuit || scenario.pursuitValue <= 0) return base;
  const peakFTE = scenario.pursuitValue / 1_500_000;
  const ramp = weeks.map((_, i) => peakFTE * ((i + 1) / weeks.length));
  // If the curve's cohort directly matches the pursuit's office/discipline,
  // bump at full strength. Otherwise apply a fractional secondary draw —
  // winning pulls on shared resources too.
  const matches =
    pivot === "Role" ||
    (pivot === "Office" && base.cohort === scenario.affectedOffice) ||
    (pivot === "Discipline" && base.cohort === scenario.affectedDiscipline);
  const scale = matches ? 1 : 0.4;
  const newDemand = base.demand.map((d, i) => d + ramp[i] * scale);
  const cap = base.capacity[0] || 0;
  const crossoverIdx = newDemand.findIndex((d) => d > cap);
  const hasCrossover = crossoverIdx !== -1;
  const peakDemandIdx = newDemand.indexOf(Math.max(...newDemand));
  const hireIdx = hasCrossover ? crossoverIdx : peakDemandIdx;
  const peakWeek = weeks[hireIdx];
  const need = Math.max(1, Math.ceil(newDemand[hireIdx] - cap));
  const cohortLabel = pivot === "Role" ? base.cohort : "FTE";
  const answer = hasCrossover
    ? `${monthLabelOf(peakWeek.startMs)} · ${peakWeek.label} · ${need} ${cohortLabel}`
    : `Steady · ${base.cohort} within capacity`;
  const yMax = Math.max(...newDemand, cap, 1) * 1.2;
  return {
    ...base,
    demand: newDemand,
    capacity: base.capacity.slice(),
    hireIndex: hireIdx,
    hasCrossover,
    yMax,
    answer,
  };
}

/* Apply the win delta to a heatmap row matching the pursuit's office /
 * discipline / role. */
function applyScenarioToHeatmap(
  pivot: PivotKey,
  base: HeatmapData,
  scenario: ScenarioInfo,
  weeks: ForecastWeek[],
): HeatmapData {
  if (!scenario.hasPursuit || scenario.pursuitValue <= 0) return base;
  // Heuristic: $1M of pursuit value adds ~5 percentage points at peak on
  // the impacted cohort row. Ramp linearly across the window.
  const peakPct = (scenario.pursuitValue / 1_000_000) * 5;
  const ramp = weeks.map((_, i) => peakPct * ((i + 1) / weeks.length));
  const targetRowKey = pivot === "Office"
    ? scenario.affectedOffice
    : pivot === "Discipline"
      ? scenario.affectedDiscipline
      : scenario.affectedRole;
  if (!targetRowKey) return base;

  const newRows = base.rows.map((row) => {
    if (row.label !== targetRowKey) return row;
    return { label: row.label, values: row.values.map((v, i) => v + ramp[i]) };
  });

  let peakWeekIdx = base.peakWeekIdx;
  let peakRow = "";
  let peakVal = 0;
  for (const row of newRows) {
    for (let i = 0; i < row.values.length; i++) {
      if (row.values[i] > peakVal) {
        peakVal = row.values[i];
        peakWeekIdx = i;
        peakRow = row.label;
      }
    }
  }
  const answer = peakRow
    ? `${weeks[peakWeekIdx].label} · ${peakRow} ${Math.round(peakVal)}%`
    : base.answer;
  return { ...base, rows: newRows, peakWeekIdx, answer };
}

/* ── Public entry point ────────────────────────────────────────────── */
export function computeForecast(
  resources: LiveResource[],
  demands: DemandItem[],
  pmm: ModuleRecord[],
  opm: ModuleRecord[],
  lem: ModuleRecord[],
  projectNames: Record<string, string> = {},
  resourceMaster: ResourceMasterRow[] = [],
  now: Date = new Date(),
): ForecastIntelligence {
  const weeks = buildWeeks(now);
  const projectMeta = buildProjectMeta(pmm, opm, lem);
  const projectsWithMeta = Object.values(projectMeta)
    .filter((m) => m.city || m.discipline).length;

  // Resource → office lookup from resource-master (DeskLocation via `office` field).
  // Prefer rm.office; fall back to rm.department for non-RDS tenants.
  const resourceOfficeMap = new Map<string, string>();
  for (const rm of resourceMaster) {
    const office = String(rm.office ?? rm.department ?? "").trim();
    if (rm.id && office) resourceOfficeMap.set(rm.id, office);
  }

  const baseHeat: Record<PivotKey, HeatmapData> = {
    Office: buildHeatmap("Office", resources, projectMeta, weeks, resourceOfficeMap),
    Role: buildHeatmap("Role", resources, projectMeta, weeks, resourceOfficeMap),
    Discipline: buildHeatmap("Discipline", resources, projectMeta, weeks, resourceOfficeMap),
  };
  const baseCurve: Record<PivotKey, CurveData> = {
    Office: buildCurve("Office", resources, demands, projectMeta, weeks, resourceOfficeMap),
    Role: buildCurve("Role", resources, demands, projectMeta, weeks, resourceOfficeMap),
    Discipline: buildCurve("Discipline", resources, demands, projectMeta, weeks, resourceOfficeMap),
  };
  const collision = buildCollision(resources, projectMeta, weeks, projectNames);
  const baseColl: Record<PivotKey, CollisionData> = {
    Office: collision,
    Role: collision,
    Discipline: collision,
  };

  const scenario = deriveScenario(opm, baseCurve.Role.cohort || "");

  const winHeat: Record<PivotKey, HeatmapData> = {
    Office: applyScenarioToHeatmap("Office", baseHeat.Office, scenario, weeks),
    Role: applyScenarioToHeatmap("Role", baseHeat.Role, scenario, weeks),
    Discipline: applyScenarioToHeatmap("Discipline", baseHeat.Discipline, scenario, weeks),
  };
  const winCurve: Record<PivotKey, CurveData> = {
    Office: applyScenarioToCurve("Office", baseCurve.Office, scenario, weeks),
    Role: applyScenarioToCurve("Role", baseCurve.Role, scenario, weeks),
    Discipline: applyScenarioToCurve("Discipline", baseCurve.Discipline, scenario, weeks),
  };
  // Collision view is anchored on a real individual — winning the pursuit
  // doesn't change who is most overloaded today, so we leave it as-is in
  // both scenarios.
  const winColl = baseColl;

  return {
    weeks,
    weekLabels: weeks.map((w) => w.label),
    base: { heatmap: baseHeat, curve: baseCurve, collision: baseColl },
    win: { heatmap: winHeat, curve: winCurve, collision: winColl },
    scenario,
    meta: {
      resourceCount: resources.length,
      demandCount: demands.length,
      projectsWithMeta,
    },
  };
}
