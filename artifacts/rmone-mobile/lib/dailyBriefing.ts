// Composes Daily Briefing data from existing live data sources.
//
// Rather than introducing yet another server endpoint, we reuse the same
// API helpers the deeper tabs already consume (Resources, Pipeline, Inbox)
// so the numbers shown on the briefing match what the user will find when
// they tap through. Day-over-day deltas are computed against a snapshot we
// persist locally each time the briefing is opened.

import { compactUsd } from "./money";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  bustCacheByPrefix,
  getResourceAllocations,
  getModuleRecords,
  getResourceDemands,
  type LiveResource,
  type ModuleRecord,
  type DemandItem,
} from "./api";
import {
  fetchInbox,
  getInboxMessages,
  getReadIds,
  extractName,
  type InboxMessage,
} from "./inboxStore";
import type { ActionDetail } from "./homeIntelligence";
import type { RolePersona } from "./roleResolver";
import { ROLE_HOME_DATA } from "./roleHomeData";
import {
  collapseDemandsToPositions,
  fundedDemandRows,
  uniqueProjectDemandValue,
} from "./demandPositions";

// Drill-down tables show the full matching set; safety cap only.
const MAX_DETAIL_ROWS = 500;
const SNAPSHOT_KEY = "daily_briefing_snapshot_v2";

/** Operational signal domains the briefing can lead with. The active
 *  persona reorders these so the hero, Overnight Scan KPIs and the
 *  "what changed" rows surface the role's primary concern first — the
 *  same persona model the role-based Home screen uses. Live numbers are
 *  identical for every role; only the ORDER / which alert is pinned
 *  changes. */
type BriefingDomain = "staffing" | "demands" | "pipeline";

const ROLE_DOMAIN_PRIORITY: Record<RolePersona, BriefingDomain[]> = {
  // Operations leader → staffing/utilization first.
  COO: ["staffing", "demands", "pipeline"],
  // Finance leader → revenue/pipeline first, then contract value at risk.
  CFO: ["pipeline", "demands", "staffing"],
  // Executive / CEO → firm-wide: lead with delivery risk, then growth.
  EXECUTIVE: ["staffing", "pipeline", "demands"],
  // Resource / staffing manager → capacity first.
  RESOURCE_MANAGER: ["staffing", "demands", "pipeline"],
  // Project manager → open work to fill + delivery risk on their projects.
  PROJECT_MANAGER: ["demands", "staffing", "pipeline"],
};

/** A persisted snapshot used to compute day-over-day deltas on the briefing. */
interface BriefingSnapshot {
  date: string;          // YYYY-MM-DD when this snapshot was captured
  staffTotal: number;
  overAllocated: number;
  bench: number;
  healthy: number;
  avgUtilization: number;
  pipelineWeighted: number; // $ — sum of weighted open OPM
  pipelineCount: number;    // # of open opportunities
  pmmActive: number;        // # of active PMM projects
  demandsCount: number;
  demandsValue: number;     // $ — sum of ApproxContractValue across open demands
}

interface CurrentSnapshot extends Omit<BriefingSnapshot, "date"> {}

/** Persisted history of daily snapshots, newest first. We keep up to ~100
 *  days so the "Forecast shift" KPI and the changes block can compare today
 *  against any of the supported windows (7d / 30d / 60d / 90d). */
interface SnapshotStore {
  history: BriefingSnapshot[];
}

export interface BriefingHero {
  /** Pinned-card timestamp ("3 sec ago", "12 min ago"). */
  agoLabel: string;
  /** Optional "NEXT 7 DAYS" / "NOW" / "THIS WEEK" framing chip. */
  windowLabel: string;
  headline: string;
  subline: string;
  /** Drives card chrome / pinned tag styling on the screen. */
  severity: "critical" | "warning" | "clear";
  /** Tag label to render alongside the pinned dot. */
  tagLabel: string;
  /** Optional drill-down detail — when present, "Resolve now" / "View"
   *  open the ActionModal with this payload instead of navigating away. */
  detail?: ActionDetail;
  /** Present when the hero represents something the user can act on
   *  (over-allocated resource, open staffing demands). Drives the
   *  primary "Acknowledge Risk" CTA in the drill-down modal opened
   *  via "Resolve now". */
  resolveRef?: {
    refId: string;
    label: string;
    level: string;
    sub?: string;
  };
}

export interface BriefingScanStats {
  /** Free-form sub-stat ("412 PROJ · 87 STAFF · 24 PURSUITS"). */
  subStat: string;
  kpis: BriefingKpi[];
}

export interface BriefingKpi {
  number: string;          // e.g. "3" or "+$4.2M"
  tone: "critical" | "good" | "neutral";
  labelTop: string;        // first line of the small uppercase label
  labelBottom: string;     // second line
  caption: string;         // small caption underneath ("+2 vs yest.", "wk-over-wk", etc.)
  /** Drill-down records shown when the user taps the KPI tile. */
  detail?: ActionDetail;
}

export interface BriefingChange {
  /** Feather icon name. Matches the screen's accepted icon set. */
  icon: "trending-up" | "trending-down" | "arrow-down-right" | "arrow-up-right";
  tone: "good" | "bad" | "neutral";
  label: string;
  context: string;
  delta: string;
  /** Drill-down records shown when the user taps the change row. */
  detail?: ActionDetail;
}

export interface BriefingNotification {
  id: string;
  tier: "CRITICAL" | "WARNING" | "INSIGHT";
  ago: string;
  description: string;
  /** Short timing/owner chip ("UNREAD", initials of sender, etc.). */
  chip: string;
  /** Optional drill-down detail — when present, tapping opens the records table. */
  detail?: ActionDetail;
}

export interface DailyBriefingData {
  hero: BriefingHero;
  scan: BriefingScanStats;
  changes: BriefingChange[];
  /** Section heading for the "what changed" card, e.g.
      "WHAT CHANGED IN LAST 30D" or "TODAY'S SNAPSHOT" when there's no baseline. */
  changesHeading: string;
  changesBadge: string;        // e.g. "5 MOVES VS 30D"
  /** True when changes are a current-state snapshot (no baseline available
      for the chosen window yet). */
  changesAreSample: boolean;
  notifications: BriefingNotification[];
  notificationsBadge: string;  // e.g. "3 NEW"
  /** True when notifications are placeholder examples (real inbox is empty). */
  notificationsAreSample: boolean;
  /** Role-specific greeting shown in the header (mirrors the Home screen
   *  persona greeting, e.g. "Operational health" / "Financial health"). */
  greeting: string;
  /** The persona the briefing was composed for. */
  role: RolePersona;
  fetchedAt: number;
  /** True when one or more upstream sources failed but enough data
   *  survived to render. The screen surfaces this to avoid giving
   *  users false confidence in a partial briefing. */
  degraded: boolean;
  /** Friendly source labels that failed (e.g. "allocations"). Empty when not degraded. */
  degradedSources: string[];
}

/* ─── helpers ─────────────────────────────────────────────────────────── */

function fmtMoney(v: number): string {
  if (!v || isNaN(v)) return "$0";
  const abs = Math.abs(v);
  let body: string;
  if (abs >= 1_000_000_000) body = compactUsd(abs);
  else if (abs >= 1_000_000) body = `$${(abs / 1_000_000).toFixed(1)}M`;
  else if (abs >= 1_000) body = `$${(abs / 1_000).toFixed(0)}K`;
  else body = `$${abs.toFixed(0)}`;
  return v < 0 ? `−${body}` : body;
}

function signedMoney(delta: number): string {
  if (!delta || isNaN(delta) || Math.abs(delta) < 1) return "$0";
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${fmtMoney(Math.abs(delta)).replace(/^−/, "")}`;
}

function signedInt(delta: number): string {
  if (!delta || isNaN(delta)) return "0";
  const n = Math.round(delta);
  if (n === 0) return "0";
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

function signedPct(delta: number, suffix = "%"): string {
  if (!delta || isNaN(delta)) return `0${suffix}`;
  const rounded = Math.round(delta);
  if (rounded === 0) return `0${suffix}`;
  return rounded > 0 ? `+${rounded}${suffix}` : `−${Math.abs(rounded)}${suffix}`;
}

function relativeAgo(dateMsOrIso: number | string): string {
  const ms = typeof dateMsOrIso === "number" ? dateMsOrIso : new Date(dateMsOrIso).getTime();
  if (!ms || isNaN(ms)) return "";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))} sec ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Closed-list model: a project is ACTIVE unless its status clearly says it is
// finished/dead. The old allow-list of "active" stage names silently counted
// 0 active projects for tenants whose imported data used statuses outside the
// list (e.g. literal "Active") — the briefing then showed a false ALL CLEAR
// while the home page counted the same records as active. Keep in lockstep
// with web src/lib/dailyBriefing.ts.
const PMM_CLOSED_STATUSES = new Set([
  "closed", "close out", "closeout", "complete", "completed",
  "cancelled", "canceled", "lost", "dead", "archived", "inactive",
]);
const OPM_CLOSED_STATUSES = new Set(["Cancelled", "Lost", "Declined", "Dead"]);

function isPmmActive(r: ModuleRecord): boolean {
  if (r.Closed === true) return false;
  // Lowercase both sides — imported status values vary in casing ("CLOSED",
  // "Complete", "closeout") and a case miss silently counts as active.
  const status = String(r.CRMProjectStatusChoice || r.Status || r.ModuleStepLookup || "").trim().toLowerCase();
  return !PMM_CLOSED_STATUSES.has(status);
}

// Revenue for an opportunity/project record. Fallback chain includes
// ContractValue and ContractedAmount — some client imports populate ONLY
// ContractedAmount, and ignoring it renders every record as $0.
function getOpmRevenue(r: ModuleRecord): number {
  return (
    Number(r.ApproxContractValue ?? 0) ||
    Number((r as any).ContractValue ?? 0) ||
    Number((r as any).ContractedAmount ?? 0) ||
    0
  );
}

function isOpmOpen(r: ModuleRecord): boolean {
  if (r.Closed === true) return false;
  const stage = r.CRMOpportunityStatusChoice || r.Status || r.ModuleStepLookup || "";
  return !OPM_CLOSED_STATUSES.has(stage);
}

/** Pull the most populated city across a set of records. Used to give the
 *  hero alert geographic flavor when one office is dominant; falls back to
 *  empty string when the data lacks a clear winner. */
function dominantCity(records: ModuleRecord[]): string {
  const counts = new Map<string, number>();
  for (const r of records) {
    const c = (r.City as string | undefined)?.trim();
    if (!c) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [c, n] of counts) {
    if (n > bestN) { best = c; bestN = n; }
  }
  return bestN >= 3 ? best : "";
}

/* ─── drill-down detail builders ──────────────────────────────────────── */

function projectsForResource(r: LiveResource): string {
  // Dedupe — the upstream allocation feed can list the same project
  // multiple times (one per role/phase row), and we don't want the
  // drill-down or AI prompt to show "PMM-25-000167, PMM-25-000167".
  const list = Array.from(
    new Set((r.activeProjects ?? []).filter(Boolean) as string[]),
  );
  if (list.length === 0) return "—";
  const head = list.slice(0, 3).join(", ");
  return list.length > 3 ? `${head} +${list.length - 3}` : head;
}

function buildOverAllocatedDetail(
  resources: LiveResource[],
  title: string,
  subtitle: string,
): ActionDetail {
  const rows = resources
    .filter((r) => r.currentPct > 100)
    .sort((a, b) => b.currentPct - a.currentPct)
    .slice(0, MAX_DETAIL_ROWS)
    .map((r) => ({
      Name: r.name,
      Role: (r.role as string) || "—",
      Projects: projectsForResource(r),
      // Hidden full unique list — used by the AI hand-off so the
      // prompt sees ALL projects, not just the truncated "+N" form.
      _projectsAll: Array.from(
        new Set((r.activeProjects ?? []).filter(Boolean) as string[]),
      ).join(", "),
      Utilization: `${Math.round(r.currentPct)}%`,
    }));
  return {
    title,
    subtitle,
    columns: [
      { key: "Name", label: "Resource" },
      { key: "Role", label: "Role" },
      { key: "Projects", label: "Active projects" },
      { key: "Utilization", label: "Util %", align: "right" },
    ],
    rows,
    emptyText: "No over-allocated resources detected.",
  };
}

function buildHealthyDetail(resources: LiveResource[]): ActionDetail {
  const rows = resources
    .filter((r) => r.currentPct >= 75 && r.currentPct <= 100)
    .sort((a, b) => b.currentPct - a.currentPct)
    .slice(0, MAX_DETAIL_ROWS)
    .map((r) => ({
      Name: r.name,
      Role: (r.role as string) || "—",
      Projects: projectsForResource(r),
      Utilization: `${Math.round(r.currentPct)}%`,
    }));
  return {
    title: "Optimal staff allocation",
    subtitle: "Resources running at 75–100% utilization — your healthy bench-load zone.",
    columns: [
      { key: "Name", label: "Resource" },
      { key: "Role", label: "Role" },
      { key: "Projects", label: "Active projects" },
      { key: "Utilization", label: "Util %", align: "right" },
    ],
    rows,
    emptyText: "No resources currently in the optimal range.",
  };
}

function buildBenchDetail(resources: LiveResource[]): ActionDetail {
  const benched = resources.filter((r) => r.currentPct === 0);
  const rows = benched.map((r) => ({
    Name: r.name,
    Role: (r.role as string) || "—",
    Utilization: "0%",
  }));
  return {
    title: "Bench capacity",
    subtitle: `${benched.length} resource${benched.length === 1 ? "" : "s"} available now (0% allocated)`,
    columns: [
      { key: "Name", label: "Resource" },
      { key: "Role", label: "Role" },
      { key: "Utilization", label: "Util %", align: "right" },
    ],
    rows,
    emptyText: "No resources are currently on the bench.",
  };
}

function buildPipelineDetail(
  openOpms: ModuleRecord[],
  weighted: number,
  title: string,
  subtitle: string,
): ActionDetail {
  const rows = [...openOpms]
    .sort((a, b) => {
      const av = getOpmRevenue(a) * ((a.SuccessChance ?? 0) / 100);
      const bv = getOpmRevenue(b) * ((b.SuccessChance ?? 0) / 100);
      return bv - av;
    })
    .slice(0, MAX_DETAIL_ROWS)
    .map((r) => {
      const v = getOpmRevenue(r);
      const p = r.SuccessChance ?? 0;
      return {
        _id: (r.TicketId as string) || "",
        Project: (r.Title as string) || (r.TicketId as string) || "(untitled)",
        Stage: (r.CRMOpportunityStatusChoice as string) || (r.Status as string) || "—",
        Win: `${Math.round(p)}%`,
        Weighted: fmtMoney(v * (p / 100)),
      };
    });
  return {
    title,
    subtitle: `${subtitle} · ${fmtMoney(weighted)} weighted total (value × win %)`,
    columns: [
      { key: "Project", label: "Pursuit" },
      { key: "Stage", label: "Stage" },
      { key: "Win", label: "Win %" },
      { key: "Weighted", label: "Weighted $", align: "right" },
    ],
    rows,
    emptyText: "No open opportunities in the pipeline.",
  };
}

function buildUtilizationDetail(
  resources: LiveResource[],
  avgUtil: number,
): ActionDetail {
  const active = resources.filter((r) => r.currentPct > 0);
  const rows = [...active]
    .sort((a, b) => b.currentPct - a.currentPct)
    .slice(0, MAX_DETAIL_ROWS)
    .map((r) => ({
      Name: r.name,
      Role: (r.role as string) || "—",
      Utilization: `${Math.round(r.currentPct)}%`,
    }));
  return {
    title: "Utilization breakdown",
    subtitle: `${active.length} active resources · firm average ${avgUtil}%`,
    columns: [
      { key: "Name", label: "Resource" },
      { key: "Role", label: "Role" },
      { key: "Utilization", label: "Util %", align: "right" },
    ],
    rows,
    emptyText: "No active utilization recorded.",
  };
}

function buildDemandsDetail(
  demandItems: DemandItem[],
  totalValue: number,
): ActionDetail {
  const rows = demandItems.slice(0, MAX_DETAIL_ROWS).map((d) => ({
    _id: d.TicketId || "",
    Title: d.Title || d.TicketId || "(untitled)",
    Role: d.Role || "—",
    Value: fmtMoney(d.ApproxContractValue ?? 0),
  }));
  return {
    title: "Open staffing demands",
    subtitle: `${demandItems.length} unfilled · ${fmtMoney(totalValue)} contract value`,
    columns: [
      { key: "Title", label: "Demand" },
      { key: "Role", label: "Role" },
      { key: "Value", label: "Contract $", align: "right" },
    ],
    rows,
    emptyText: "No open staffing demands.",
  };
}

/* ─── snapshot persistence ────────────────────────────────────────────── */

const SNAPSHOT_HISTORY_LIMIT = 100;

async function loadSnapshotStore(): Promise<SnapshotStore> {
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return { history: [] };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      // New shape — newest-first array of snapshots.
      if (Array.isArray((parsed as { history?: unknown }).history)) {
        const arr = ((parsed as { history: unknown[] }).history as BriefingSnapshot[])
          .filter((s) => s && typeof s === "object" && typeof s.date === "string");
        return { history: arr.slice(0, SNAPSHOT_HISTORY_LIMIT) };
      }
      // Legacy { prior, current } shape — migrate forward.
      const legacy: BriefingSnapshot[] = [];
      if ((parsed as { current?: BriefingSnapshot }).current) legacy.push((parsed as { current: BriefingSnapshot }).current);
      if ((parsed as { prior?: BriefingSnapshot }).prior) legacy.push((parsed as { prior: BriefingSnapshot }).prior);
      return { history: legacy };
    }
    return { history: [] };
  } catch {
    return { history: [] };
  }
}

/** Persist today's snapshot, replacing any same-day row and pruning to ~100 days. */
async function persistSnapshot(current: CurrentSnapshot, store: SnapshotStore): Promise<SnapshotStore> {
  const today = todayKey();
  const todays: BriefingSnapshot = { date: today, ...current };
  const others = store.history.filter((s) => s.date !== today);
  const next: SnapshotStore = {
    history: [todays, ...others].slice(0, SNAPSHOT_HISTORY_LIMIT),
  };
  try {
    await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(next));
  } catch {
    /* best effort */
  }
  return next;
}

/** Pick the snapshot whose age is closest to `days` days, but at least one
 *  full day old (so we never compare today to itself). The match must be
 *  within ±50% of the window so a shallow history doesn't falsely back a
 *  90d delta with a 3-day-old row. Falls back to the oldest available
 *  snapshot otherwise so freshly-installed users still get *some* delta. */
/** Parse YYYY-MM-DD into local midnight ms (avoids JS engine timezone
 *  ambiguity around `new Date("YYYY-MM-DDTHH:MM:SS")`). */
function dateKeyToMs(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return NaN;
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d)).getTime();
}

function pickBaselineForWindow(history: BriefingSnapshot[], days: number): BriefingSnapshot | null {
  const today = todayKey();
  const todayMs = dateKeyToMs(today);
  const minAgeMs = 1 * 86_400_000;
  const targetMs = days * 86_400_000;
  const tolerance = Math.max(2, Math.floor(days * 0.5)) * 86_400_000;
  let best: BriefingSnapshot | null = null;
  let bestDiff = Infinity;
  for (const snap of history) {
    if (!snap || !snap.date || snap.date === today) continue;
    const ms = dateKeyToMs(snap.date);
    if (isNaN(ms)) continue;
    const ageMs = todayMs - ms;
    if (ageMs < minAgeMs) continue;
    const diff = Math.abs(ageMs - targetMs);
    if (diff < bestDiff && diff <= tolerance) {
      bestDiff = diff;
      best = snap;
    }
  }
  if (!best) {
    const eligible = history.filter((s) => s && s.date && s.date !== today);
    if (eligible.length > 0) best = eligible[eligible.length - 1];
  }
  return best;
}

/* ─── compose ─────────────────────────────────────────────────────────── */

/** Window keys mirror the home page selector so the user gets the same
 *  vocabulary (7 / 30 / 60 / 90 days). The CRITICAL / WARNING / INSIGHT
 *  notifications are filtered to only fire on signals whose underlying
 *  date falls inside the active window. */
export type BriefingWindow = "7d" | "30d" | "60d" | "90d";
export const BRIEFING_WINDOW_KEYS: BriefingWindow[] = ["7d", "30d", "60d", "90d"];
export const BRIEFING_WINDOW_DAYS: Record<BriefingWindow, number> = {
  "7d": 7,
  "30d": 30,
  "60d": 60,
  "90d": 90,
};
export const BRIEFING_WINDOW_LABEL: Record<BriefingWindow, string> = {
  "7d": "7D",
  "30d": "30D",
  "60d": "60D",
  "90d": "90D",
};

export interface ComposeOptions {
  /** When true, evict any cached responses for the briefing's data sources
   *  before fetching. Used by pull-to-refresh so the user gets a fully fresh
   *  briefing instead of the same in-memory cache the deeper tabs share. */
  forceRefresh?: boolean;
  /** Time horizon for the operational notifications block. Defaults to
   *  "7d". Drives the chip label and filters CRITICAL/WARNING/INSIGHT
   *  signals so each row only fires when its underlying date sits inside
   *  the selected horizon. */
  window?: BriefingWindow;
  /** Active persona. Reorders the hero, Overnight Scan KPIs and the
   *  "what changed" rows so the role's primary concern leads — mirrors
   *  the role-based Home screen. Defaults to "PROJECT_MANAGER" when the
   *  caller does not resolve a role. */
  role?: RolePersona;
}

/** Try several date-ish fields on a record and return the first that
 *  parses as a real Date. Returns null when nothing usable is present. */
function pickDate(rec: Record<string, unknown>, keys: string[]): Date | null {
  for (const k of keys) {
    const raw = rec[k];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return new Date(t);
  }
  return null;
}

/** True when [start, end] overlaps [today, today+days]. Either side may
 *  be missing — a missing start counts as "open-ended in the past" and a
 *  missing end as "open-ended in the future". */
function overlapsHorizon(
  start: Date | null,
  end: Date | null,
  horizonEnd: Date,
  horizonStart: Date,
): boolean {
  const s = start ?? new Date(-8.64e15);
  const e = end ?? new Date(8.64e15);
  return s <= horizonEnd && e >= horizonStart;
}

export async function composeDailyBriefing(opts: ComposeOptions = {}): Promise<DailyBriefingData> {
  if (opts.forceRefresh) {
    bustCacheByPrefix("resource-allocations:");
    bustCacheByPrefix("resource-demands:");
    bustCacheByPrefix("module:");
  }
  // Kick all data fetches in parallel. Each is wrapped so a single failure
  // doesn't kill the whole briefing — the renderer falls back to safe
  // placeholders for the affected section. The inbox is non-critical
  // (notifications card simply hides), but if every operational data source
  // fails we deliberately throw so the screen can show its real error
  // state instead of a fabricated "all clear" briefing.
  const [allocRes, pmmRes, opmRes, demandRes, inboxRes] = await Promise.allSettled([
    getResourceAllocations(),
    getModuleRecords("PMM"),
    getModuleRecords("OPM"),
    getResourceDemands(),
    fetchInbox(),
  ]);

  const alloc = allocRes.status === "fulfilled" ? allocRes.value : null;
  const pmm = pmmRes.status === "fulfilled" ? pmmRes.value : null;
  const opm = opmRes.status === "fulfilled" ? opmRes.value : null;
  const demand = demandRes.status === "fulfilled" ? demandRes.value : null;

  // Track which sources failed so the screen can warn users that the
  // briefing is partial and the "all clear" / KPI numbers may be incomplete.
  const degradedSources: string[] = [];
  if (allocRes.status === "rejected") degradedSources.push("allocations");
  if (pmmRes.status === "rejected") degradedSources.push("projects");
  if (opmRes.status === "rejected") degradedSources.push("pipeline");
  if (demandRes.status === "rejected") degradedSources.push("demands");
  // fetchInbox swallows its own errors but now returns a success boolean.
  const inboxOk = inboxRes.status === "fulfilled" && inboxRes.value === true;
  if (!inboxOk) degradedSources.push("inbox");
  const allocationsFailed = allocRes.status === "rejected";

  // Require at least one of the three operational sources (allocations / PMM /
  // OPM) to render a meaningful briefing. If all three failed there's no
  // signal to summarize and we'd otherwise mint a misleading "balanced
  // workforce" hero — surface the underlying failure to the screen instead.
  if (!alloc && !pmm && !opm) {
    const reasons: string[] = [];
    if (allocRes.status === "rejected") reasons.push(`alloc: ${String(allocRes.reason)}`);
    if (pmmRes.status === "rejected") reasons.push(`pmm: ${String(pmmRes.reason)}`);
    if (opmRes.status === "rejected") reasons.push(`opm: ${String(opmRes.reason)}`);
    const detail = reasons.join(" · ") || "no data returned";
    const err = new Error(`Daily briefing data unavailable — ${detail}`) as Error & { briefingFailure?: boolean };
    err.briefingFailure = true;
    throw err;
  }

  const resources: LiveResource[] = alloc?.resources ?? [];
  const pmmRecords: ModuleRecord[] = pmm?.data ?? [];
  const opmRecords: ModuleRecord[] = opm?.data ?? [];
  const demandItems: DemandItem[] = demand?.data ?? [];

  /* ── current metrics ── */
  const staffTotal = alloc?.total ?? resources.length;
  const overAllocated = alloc?.overAllocated ?? resources.filter(r => r.currentPct > 100).length;
  const bench = alloc?.bench ?? resources.filter(r => r.currentPct === 0).length;
  const healthy = alloc?.healthy ?? resources.filter(r => r.currentPct >= 75 && r.currentPct <= 100).length;
  const activeForAvg = resources.filter(r => r.currentPct > 0);
  const avgUtilization = activeForAvg.length
    ? Math.round(activeForAvg.reduce((s, r) => s + r.currentPct, 0) / activeForAvg.length)
    : 0;

  const pmmActive = pmmRecords.filter(isPmmActive).length;
  const openOpms = opmRecords.filter(isOpmOpen);
  const pipelineCount = openOpms.length;
  const pipelineWeighted = openOpms.reduce((s, r) => {
    const v = getOpmRevenue(r);
    const p = r.SuccessChance ?? 0;
    return s + v * (p / 100);
  }, 0);

  // Collapse weekly demand rows into unique (project, role) positions before
  // counting — raw rows are one-per-week, so counting them inflates demand.
  // Contract value counts each project once (see lib/demandPositions.ts).
  const demandPositions = collapseDemandsToPositions(demandItems);
  const demandsCount = demandPositions.length;
  const demandsValue = uniqueProjectDemandValue(demandPositions);

  const current: CurrentSnapshot = {
    staffTotal, overAllocated, bench, healthy, avgUtilization,
    pipelineWeighted, pipelineCount, pmmActive,
    demandsCount, demandsValue,
  };

  // ── Window context (hoisted so HERO + SCAN + NOTIFICATIONS share it) ──
  const win: BriefingWindow = opts.window ?? "7d";
  const winDays = BRIEFING_WINDOW_DAYS[win];
  const winLabel = BRIEFING_WINDOW_LABEL[win];
  const winSuffix = `vs ${winDays}d ago`;
  const horizonStart = new Date();
  horizonStart.setHours(0, 0, 0, 0);
  const horizonEnd = new Date(horizonStart.getTime() + winDays * 86_400_000);

  const store = await loadSnapshotStore();
  const baseline = pickBaselineForWindow(store.history, winDays);
  void persistSnapshot(current, store);

  // ── Role framing ── Live numbers are identical for every persona; the
  // role only changes which signal leads (hero), the order of the
  // Overnight Scan KPIs, and the order of the "what changed" rows.
  const role: RolePersona = opts.role ?? "PROJECT_MANAGER";
  const priority = ROLE_DOMAIN_PRIORITY[role];
  const greeting = ROLE_HOME_DATA[role].greeting;
  const domainRank = (d: BriefingDomain): number => {
    const i = priority.indexOf(d);
    return i === -1 ? 99 : i;
  };

  // Forecast delta vs the baseline matching the active window. Hoisted
  // above the hero so the CFO/EXECUTIVE personas can lead with a real
  // pipeline-decline risk when one exists.
  const fcastDelta = baseline ? pipelineWeighted - baseline.pipelineWeighted : 0;

  // Window-filtered slices reused by HERO + SCAN + NOTIFICATIONS so the
  // chosen chip really filters the whole briefing — not just the alerts.
  const overInWindow = [...resources]
    .filter((r) => r.currentPct > 100)
    .filter((r) =>
      (r.activeAllocations ?? []).some((a) =>
        overlapsHorizon(
          a.startDate ? new Date(a.startDate) : null,
          a.endDate ? new Date(a.endDate) : null,
          horizonEnd,
          horizonStart,
        ),
      ),
    )
    .sort((a, b) => b.currentPct - a.currentPct);
  const overAllocatedWin = overInWindow.length;

  // Window rule (must match the web Weekly Demand popup): count POSITIONS,
  // not weekly rows, and only positions with unfilled hours inside the
  // window — zero-hour placeholder weeks don't count as open demand.
  const demandRowsInWindow = demandItems.filter((d) =>
    overlapsHorizon(
      d.AllocationStartDate ? new Date(d.AllocationStartDate) : (d.TargetStartDate ? new Date(d.TargetStartDate) : null),
      d.AllocationEndDate ? new Date(d.AllocationEndDate) : (d.TargetCompletionDate ? new Date(d.TargetCompletionDate) : null),
      horizonEnd,
      horizonStart,
    ),
  );
  const demandsInWindow = collapseDemandsToPositions(fundedDemandRows(demandRowsInWindow));
  const demandsInWindowValue = uniqueProjectDemandValue(demandsInWindow);

  const opmsInWindow = openOpms.filter((r) => {
    const d = pickDate(r as Record<string, unknown>, [
      "BidDueDate", "TargetStartDate", "CloseDate", "TargetCompletionDate",
    ]);
    if (!d) return false;
    return d >= horizonStart && d <= horizonEnd;
  });
  const opmsInWindowWeighted = opmsInWindow.reduce((s, r) => {
    const v = getOpmRevenue(r);
    const p = Number(r.SuccessChance ?? 0) || 0;
    return s + v * (p / 100);
  }, 0);

  /* ── HERO (window-aware, role-prioritized) ──
     Each candidate below is a REAL risk drawn from live data. The active
     persona only decides which real risk gets pinned first (e.g. CFO
     leads with a pipeline decline, Resource Mgr with over-allocation).
     We never promote a positive signal to PINNED · CRITICAL. */
  const topOverInWin = overInWindow[0];
  const heroCandidates: Partial<Record<BriefingDomain, BriefingHero>> = {};

  if (topOverInWin) {
    const otherOver = Math.max(0, overAllocatedWin - 1);
    const projectsAtRisk = topOverInWin.activeProjects?.length ?? 0;
    const city = dominantCity(pmmRecords);
    const cityFrag = city ? ` · ${city} office` : "";
    const headline = `${topOverInWin.name} projected at ${Math.round(topOverInWin.currentPct)}% utilization${cityFrag}.`;
    const subline = otherOver > 0
      ? `+${otherOver} other resource${otherOver === 1 ? "" : "s"} over capacity in window · cascade risk on ${projectsAtRisk} active project${projectsAtRisk === 1 ? "" : "s"}`
      : `Cascade risk on ${projectsAtRisk} active project${projectsAtRisk === 1 ? "" : "s"} · review allocation now`;
    heroCandidates.staffing = {
      agoLabel: relativeAgo(Date.now()),
      windowLabel: `NEXT ${winLabel}`,
      severity: "critical",
      tagLabel: "PINNED · CRITICAL",
      headline,
      subline,
      detail: buildOverAllocatedDetail(
        overInWindow.length > 0 ? overInWindow : resources,
        `Over-allocated · next ${winLabel}`,
        `${overAllocatedWin} resource${overAllocatedWin === 1 ? "" : "s"} projected over 100% in window`,
      ),
      resolveRef: {
        refId: `briefing:over-allocated:${topOverInWin.id}`,
        label: `${topOverInWin.name} over-allocation (${Math.round(topOverInWin.currentPct)}%)`,
        level: "critical",
        sub: subline,
      },
    };
  }

  if (demandsInWindow.length > 0) {
    const top = demandsInWindow[0];
    heroCandidates.demands = {
      agoLabel: relativeAgo(Date.now()),
      windowLabel: `NEXT ${winLabel}`,
      severity: "warning",
      tagLabel: "PINNED · WARNING",
      headline: `${demandsInWindow.length} staffing demand${demandsInWindow.length === 1 ? "" : "s"} awaiting fill in next ${winLabel}.`,
      subline: `Top: ${top.Title || top.TicketId} · ${top.Role || "role TBD"} · ${fmtMoney(demandsInWindowValue)} contract value`,
      detail: buildDemandsDetail(demandsInWindow, demandsInWindowValue),
      resolveRef: {
        refId: `briefing:open-demands:${top.TicketId ?? "top"}`,
        label: `Open staffing demands · next ${winLabel} (${demandsInWindow.length})`,
        level: "warning",
        sub: `${top.Title || top.TicketId} · ${top.Role || "role TBD"}`,
      },
    };
  }

  // Pipeline only leads as a HERO when it is genuinely a RISK — i.e. the
  // weighted forecast has fallen vs the matching baseline. A rising
  // pipeline is good news and must never be pinned as a critical alert.
  if (baseline && fcastDelta < 0 && Math.abs(fcastDelta) > 1) {
    const drop = fmtMoney(Math.abs(fcastDelta));
    heroCandidates.pipeline = {
      agoLabel: relativeAgo(Date.now()),
      windowLabel: `NEXT ${winLabel}`,
      severity: "warning",
      tagLabel: "PINNED · WARNING",
      headline: `Pipeline weighted value down ${drop} ${winSuffix}.`,
      subline: `${pipelineCount} open opportunit${pipelineCount === 1 ? "y" : "ies"} · ${fmtMoney(pipelineWeighted)} weighted total`,
      detail: buildPipelineDetail(
        openOpms,
        pipelineWeighted,
        `Forecast backlog · ${winSuffix}`,
        `${pipelineCount} open opportunit${pipelineCount === 1 ? "y" : "ies"} weighted`,
      ),
      resolveRef: {
        refId: `briefing:pipeline-decline`,
        label: `Pipeline weighted value down ${drop}`,
        level: "warning",
        sub: `${fmtMoney(pipelineWeighted)} weighted · ${pipelineCount} open`,
      },
    };
  }

  let hero: BriefingHero;
  const pickedDomain = priority.find((d) => heroCandidates[d]);
  if (pickedDomain) {
    hero = heroCandidates[pickedDomain]!;
  } else if (allocationsFailed) {
    hero = {
      agoLabel: relativeAgo(Date.now()),
      windowLabel: "DEGRADED",
      severity: "warning",
      tagLabel: "PINNED · DATA DEGRADED",
      headline: "Allocation feed unavailable — utilization risk unverified.",
      subline: "Pull to refresh, or open Resources to retry the live workforce sync.",
    };
  } else if (
    // Degenerate-data guard: active projects and staff on file but NOBODY
    // carries any current allocation — "Workforce balanced · 0 of N" would
    // be a lie. Surface the staffing-data gap instead of ALL CLEAR.
    pmmActive > 0 &&
    staffTotal > 0 &&
    healthy === 0 &&
    overAllocated === 0 &&
    avgUtilization === 0
  ) {
    hero = {
      agoLabel: relativeAgo(Date.now()),
      windowLabel: `NEXT ${winLabel}`,
      severity: "warning",
      tagLabel: "PINNED · DATA GAP",
      headline: `${pmmActive} active project${pmmActive === 1 ? "" : "s"} but no current staffing hours on file.`,
      subline: `${staffTotal} staff loaded · 0 with allocation hours in this window — likely missing hours data, not confirmed under-staffing`,
    };
  } else {
    hero = {
      agoLabel: relativeAgo(Date.now()),
      windowLabel: `NEXT ${winLabel} · ALL CLEAR`,
      severity: "clear",
      tagLabel: "PINNED · ALL CLEAR",
      headline: `Workforce balanced for next ${winLabel} · ${healthy} of ${staffTotal} resources optimally allocated.`,
      subline: "No critical staffing risks detected in the latest scan.",
    };
  }

  /* ── OVERNIGHT SCAN ── */
  const subStat = `${pmmActive} PROJ · ${staffTotal} STAFF · ${pipelineCount} PURSUITS`;

  // Deltas vs the snapshot whose age matches the active window.
  // (fcastDelta is hoisted above the hero so the pipeline-decline hero
  // candidate can use it.)
  const overDelta  = baseline ? overAllocated - baseline.overAllocated : 0;
  const healthyDelta = baseline ? healthy - baseline.healthy : 0;

  // Tag each KPI with its signal domain, then order by the active
  // persona's priority so the role's primary metric leads the row. The
  // numbers themselves are identical for every persona.
  const kpisTagged: Array<{ domain: BriefingDomain; kpi: BriefingKpi }> = [
    {
      domain: "staffing",
      kpi: {
        number: String(overAllocatedWin),
        tone: overAllocatedWin > 0 ? "critical" : "good",
        labelTop: "RISKS",
        labelBottom: "FLAGGED",
        caption: `in next ${winLabel}`,
        detail: buildOverAllocatedDetail(
          overInWindow.length > 0 ? overInWindow : resources,
          `Risks flagged · next ${winLabel}`,
          `${overAllocatedWin} resource${overAllocatedWin === 1 ? "" : "s"} projected over 100%`,
        ),
      },
    },
    {
      domain: "demands",
      kpi: {
        number: String(demandsInWindow.length),
        tone: demandsInWindow.length > 0 ? "neutral" : "good",
        labelTop: "OPEN",
        labelBottom: "DEMANDS",
        caption: demandsInWindowValue > 0
          ? `${fmtMoney(demandsInWindowValue)} · in ${winLabel}`
          : `due in ${winLabel}`,
        detail: buildDemandsDetail(
          demandsInWindow.length > 0 ? demandsInWindow : demandPositions,
          demandsInWindow.length > 0 ? demandsInWindowValue : demandsValue,
        ),
      },
    },
    {
      domain: "pipeline",
      kpi: {
        number: fmtMoney(opmsInWindowWeighted),
        tone: opmsInWindowWeighted > 0 ? "good" : "neutral",
        labelTop: "PIPELINE",
        labelBottom: "IN WIN",
        caption: `${opmsInWindow.length} closing in ${winLabel}`,
        detail: buildPipelineDetail(
          opmsInWindow.length > 0 ? opmsInWindow : openOpms,
          opmsInWindow.length > 0 ? opmsInWindowWeighted : pipelineWeighted,
          `Pipeline closing in ${winLabel}`,
          `${opmsInWindow.length} of ${pipelineCount} open opportunit${pipelineCount === 1 ? "y" : "ies"}`,
        ),
      },
    },
  ];
  const kpis: BriefingKpi[] = kpisTagged
    .slice()
    .sort((a, b) => domainRank(a.domain) - domainRank(b.domain))
    .map((x) => x.kpi);

  /* ── WHAT CHANGED ── */
  const changes: BriefingChange[] = [];

  const utilDetail = () => buildUtilizationDetail(resources, avgUtilization);
  const forecastDetail = () =>
    buildPipelineDetail(openOpms, pipelineWeighted, "Forecast backlog",
      `${pipelineCount} open opportunit${pipelineCount === 1 ? "y" : "ies"} weighted`);
  const conflictsDetail = () =>
    buildOverAllocatedDetail(resources, "Staffing conflicts",
      `${overAllocated} resource${overAllocated === 1 ? "" : "s"} above 100% utilization`);
  const benchDetail = () => buildBenchDetail(resources);
  const demandsDetail = () => buildDemandsDetail(demandPositions, demandsValue);

  if (baseline) {
    const utilDelta = avgUtilization - baseline.avgUtilization;
    if (utilDelta !== 0) {
      changes.push({
        icon: utilDelta > 0 ? "trending-up" : "trending-down",
        tone: utilDelta > 0 ? "bad" : "good",
        label: "Utilization",
        context: `Avg ${avgUtilization}% across ${activeForAvg.length} active`,
        delta: signedPct(utilDelta),
        detail: utilDetail(),
      });
    }
    if (Math.abs(fcastDelta) > 1) {
      changes.push({
        icon: fcastDelta > 0 ? "trending-up" : "trending-down",
        tone: fcastDelta > 0 ? "good" : "bad",
        label: "Forecast backlog",
        context: `${pipelineCount} open opportunit${pipelineCount === 1 ? "y" : "ies"} weighted`,
        delta: signedMoney(fcastDelta),
        detail: forecastDetail(),
      });
    }
    if (overDelta !== 0) {
      changes.push({
        icon: overDelta > 0 ? "trending-up" : "trending-down",
        tone: overDelta > 0 ? "bad" : "good",
        label: "Staffing conflicts",
        context: `${overAllocated} resource${overAllocated === 1 ? "" : "s"} >100% allocated`,
        delta: signedInt(overDelta),
        detail: conflictsDetail(),
      });
    }
    const benchDeltaN = bench - baseline.bench;
    if (benchDeltaN !== 0) {
      changes.push({
        icon: benchDeltaN > 0 ? "trending-up" : "trending-down",
        tone: benchDeltaN > 0 ? "good" : "bad",
        label: "Bench capacity",
        context: `${bench} resource${bench === 1 ? "" : "s"} on bench`,
        delta: signedInt(benchDeltaN),
        detail: benchDetail(),
      });
    }
    const pcountDelta = pipelineCount - baseline.pipelineCount;
    if (pcountDelta !== 0) {
      changes.push({
        icon: pcountDelta > 0 ? "trending-up" : "trending-down",
        tone: pcountDelta > 0 ? "good" : "bad",
        label: "Proposal pipeline",
        context: `${pipelineCount} open · ${fmtMoney(pipelineWeighted)} weighted`,
        delta: `${signedInt(pcountDelta)} opp${Math.abs(pcountDelta) === 1 ? "" : "s"}`,
        detail: forecastDetail(),
      });
    }
    const demandDelta = demandsCount - baseline.demandsCount;
    if (demandDelta !== 0) {
      changes.push({
        icon: demandDelta > 0 ? "trending-up" : "trending-down",
        tone: demandDelta > 0 ? "bad" : "good",
        label: "Open staffing demands",
        context: `${demandsCount} unfilled · ${fmtMoney(demandsValue)}`,
        delta: signedInt(demandDelta),
        detail: demandsDetail(),
      });
    }
  }

  // Always show today's headline metrics so the section never looks empty
  // — even on first load when no prior baseline exists, or when nothing
  // changed overnight.
  if (changes.length === 0) {
    if (avgUtilization > 0) {
      changes.push({
        icon: "trending-up", tone: "neutral",
        label: "Utilization",
        context: `${activeForAvg.length} resources active`,
        delta: `${avgUtilization}%`,
        detail: utilDetail(),
      });
    }
    if (pipelineWeighted > 0) {
      changes.push({
        icon: "trending-up", tone: "neutral",
        label: "Forecast backlog",
        context: `${pipelineCount} open opportunit${pipelineCount === 1 ? "y" : "ies"}`,
        delta: fmtMoney(pipelineWeighted),
        detail: forecastDetail(),
      });
    }
    if (overAllocated > 0) {
      changes.push({
        icon: "trending-up", tone: "neutral",
        label: "Staffing conflicts",
        context: `>100% allocated`,
        delta: String(overAllocated),
        detail: conflictsDetail(),
      });
    }
    if (bench > 0) {
      changes.push({
        icon: "trending-down", tone: "neutral",
        label: "Bench capacity",
        context: `Available now`,
        delta: String(bench),
        detail: benchDetail(),
      });
    }
    if (demandsCount > 0) {
      changes.push({
        icon: "trending-up", tone: "neutral",
        label: "Open staffing demands",
        context: `${fmtMoney(demandsValue)} contract value`,
        delta: String(demandsCount),
        detail: demandsDetail(),
      });
    }
  }

  // Order the change rows by the active persona's priority (stable, so
  // rows within the same domain keep their original order), then cap to 5
  // to match the original layout. Same rows for every role — the role
  // only changes which domain's movements surface first.
  const changeDomain = (label: string): BriefingDomain =>
    label === "Forecast backlog" || label === "Proposal pipeline"
      ? "pipeline"
      : label === "Open staffing demands"
      ? "demands"
      : "staffing";
  const orderedChanges = changes
    .map((c, i) => ({ c, i }))
    .sort(
      (a, b) =>
        domainRank(changeDomain(a.c.label)) - domainRank(changeDomain(b.c.label)) ||
        a.i - b.i,
    )
    .map((x) => x.c);
  const clippedChanges = orderedChanges.slice(0, 5);
  const changesHeading = baseline
    ? `WHAT CHANGED IN LAST ${winLabel}`
    : "TODAY'S SNAPSHOT";
  const changesBadge = baseline
    ? `${clippedChanges.length} MOVE${clippedChanges.length === 1 ? "" : "S"} VS ${winLabel}`
    : winLabel;

  /* ── NOTIFICATIONS (operational alerts, horizon-aware) ──
     Reuses the window-filtered slices computed above so the chip label
     ("7D" / "30D" / "60D" / "90D") tells the truth: only signals whose
     underlying date overlaps [today, today + N days] are surfaced. */
  const opNotifications: BriefingNotification[] = [];

  const topOverNotif = overInWindow[0];
  if (topOverNotif) {
    const others = Math.max(0, overInWindow.length - 1);
    opNotifications.push({
      id: `op-crit-${topOverNotif.id}`,
      tier: "CRITICAL",
      ago: "live",
      description: others > 0
        ? `${topOverNotif.name} projected at ${Math.round(topOverNotif.currentPct)}% utilization · +${others} other${others === 1 ? "" : "s"} over capacity.`
        : `${topOverNotif.name} projected at ${Math.round(topOverNotif.currentPct)}% utilization in window.`,
      chip: winLabel,
      detail: buildOverAllocatedDetail(
        overInWindow.length > 0 ? overInWindow : resources,
        `Over-allocated · ${winLabel}`,
        `${topOverNotif.name} projected at ${Math.round(topOverNotif.currentPct)}% utilization in window`,
      ),
    });
  }

  if (demandsInWindow.length > 0) {
    opNotifications.push({
      id: "op-warn-demands",
      tier: "WARNING",
      ago: "live",
      description: `${demandsInWindow.length} open staffing demand${demandsInWindow.length === 1 ? "" : "s"} unfilled · ${fmtMoney(demandsInWindowValue)} contract value at risk.`,
      chip: winLabel,
      detail: buildDemandsDetail(demandsInWindow, demandsInWindowValue),
    });
  } else if (bench >= 5) {
    opNotifications.push({
      id: "op-warn-bench",
      tier: "WARNING",
      ago: "live",
      description: `Bench capacity climbing — ${bench} resource${bench === 1 ? "" : "s"} idle.`,
      chip: winLabel,
      detail: buildBenchDetail(resources),
    });
  }

  if (opmsInWindow.length > 0) {
    opNotifications.push({
      id: "op-insight-pipeline",
      tier: "INSIGHT",
      ago: "live",
      description: `${opmsInWindow.length} pipeline opportunit${opmsInWindow.length === 1 ? "y" : "ies"} due in window · ${fmtMoney(opmsInWindowWeighted)} weighted value.`,
      chip: winLabel,
      detail: buildPipelineDetail(
        opmsInWindow,
        opmsInWindowWeighted,
        `Pipeline closing ${winLabel}`,
        `${opmsInWindow.length} opportunit${opmsInWindow.length === 1 ? "y" : "ies"} due in window`,
      ),
    });
  } else if (win === "7d" && baseline && Math.abs(fcastDelta) > 1) {
    opNotifications.push({
      id: "op-insight-forecast",
      tier: "INSIGHT",
      ago: "live",
      description: `Pipeline weighted value ${fcastDelta > 0 ? "up" : "down"} ${signedMoney(fcastDelta).replace(/^[+−]/, "")} week-over-week.`,
      chip: winLabel,
      detail: buildPipelineDetail(
        openOpms.length > 0 ? openOpms : opmsInWindow,
        pipelineWeighted,
        `Pipeline overview`,
        `Weighted value ${fcastDelta > 0 ? "up" : "down"} ${signedMoney(fcastDelta).replace(/^[+−]/, "")} week-over-week`,
      ),
    });
  }

  const realNotifsCount = opNotifications.length;
  // No fabricated SAMPLE rows — an empty list renders an honest empty state
  // on the screen instead of placeholder notifications dressed up as data.
  const notificationsAreSample = realNotifsCount === 0;
  const finalNotifications: BriefingNotification[] = opNotifications;
  // Only CRITICAL/WARNING rows count as alerts — INSIGHT rows are context,
  // not something to fix, so they must not inflate the alert badge.
  const alertCount = opNotifications.filter((n) => n.tier !== "INSIGHT").length;
  const notificationsBadge =
    alertCount > 0 ? `${alertCount} ALERT${alertCount === 1 ? "" : "S"}` : "NO ALERTS";

  return {
    hero,
    scan: { subStat, kpis },
    changes: clippedChanges,
    changesHeading,
    changesBadge,
    changesAreSample: !baseline,
    notifications: finalNotifications,
    notificationsBadge,
    notificationsAreSample,
    greeting,
    role,
    fetchedAt: Date.now(),
    degraded: degradedSources.length > 0,
    degradedSources,
  };
}
