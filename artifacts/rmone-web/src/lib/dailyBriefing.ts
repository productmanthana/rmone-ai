// Web port of the mobile dailyBriefing composer
// (artifacts/rmone-mobile/lib/dailyBriefing.ts).
//
// Produces the same DailyBriefingData shape from the same upstream sources
// (resource allocations, PMM/OPM module records, resource demands, inbox)
// so the briefing the web user sees matches the mobile briefing for the
// same signed-in account. Day-over-day deltas are computed against a
// snapshot persisted in localStorage instead of AsyncStorage.

import { compactUsd } from "./money";
import { memSeed } from "./memSeed";
import {
  bustCacheByPrefix,
  getResourceAllocations,
  getModuleRecords,
  getResourceDemands,
  getStoredUser,
  type LiveResource,
  type ModuleRecord,
  type DemandItem,
  getSavedDailyBriefing,
  saveDailyBriefing,
} from "./api";
import {
  fetchInbox,
  getInboxMessages,
  getReadIds,
  extractName,
  type InboxMessage,
} from "./inboxStore";
import type { ActionDetail } from "./homeIntelligence";
import { effStart, effEnd } from "./projectDates";
import {
  staffLink,
  DEMAND_LINK,
  PIPELINE_LINK,
  PROJECTS_LINK,
  FORECAST_LINK,
  STAFF_LIST_LINK,
} from "./issueLink";
import type { RolePersona } from "./roleResolver";
import {
  collapseDemandsToPositions,
  fundedDemandRows,
  uniqueProjectDemandValue,
} from "./demandPositions";
import {
  forecastWindow,
  windowedPctForResource,
  summarizeUtilization,
  hasAllocationSignal,
  type ResourceLike,
} from "@workspace/alloc-math";
import { getBusinessRules } from "./businessRules";

// Drill-down tables show the full matching set (panel paginates); safety cap only.
const MAX_DETAIL_ROWS = 500;
// v4: project end dates switched to the effective end (phase-schedule last
// end when a schedule exists, Target fallback otherwise) — older snapshots
// bucketed overdue/due-soon with the old dates and would poison day-over-day
// deltas, so the key rotates.
const SNAPSHOT_KEY_BASE = "rmone_daily_briefing_snapshot_v4";
function snapshotKey(): string {
  const tenant = getStoredUser()?.tenant;
  return tenant ? `${SNAPSHOT_KEY_BASE}_${tenant.toLowerCase()}` : SNAPSHOT_KEY_BASE;
}

interface BriefingSnapshot {
  date: string;
  staffTotal: number;
  overAllocated: number;
  bench: number;
  healthy: number;
  avgUtilization: number;
  pipelineWeighted: number;
  pipelineCount: number;
  pmmActive: number;
  demandsCount: number;
  demandsValue: number;
}

type CurrentSnapshot = Omit<BriefingSnapshot, "date">;

/** Persisted history of daily snapshots, newest first. We keep up to ~100
 *  days so the "Forecast shift" KPI and the changes block can compare today
 *  against any of the supported windows (7d / 30d / 60d / 90d). */
interface SnapshotStore {
  history: BriefingSnapshot[];
}

export interface BriefingHero {
  agoLabel: string;
  windowLabel: string;
  headline: string;
  subline: string;
  severity: "critical" | "warning" | "clear";
  tagLabel: string;
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
    /** Ticket ID of the single record driving this hero, when there is one.
     *  Lets the resolve-options picker deep-link straight to /project/:id. */
    ticketId?: string;
    /** Person behind an over-allocation hero — drives the staff deep link. */
    personName?: string;
  };
}

export interface BriefingKpi {
  number: string;
  tone: "critical" | "good" | "neutral";
  labelTop: string;
  labelBottom: string;
  caption: string;
  detail?: ActionDetail;
}

export interface BriefingScanStats {
  subStat: string;
  kpis: BriefingKpi[];
}

export type BriefingChangeIcon =
  | "trending-up"
  | "trending-down"
  | "arrow-down-right"
  | "arrow-up-right";

export interface BriefingChange {
  icon: BriefingChangeIcon;
  tone: "good" | "bad" | "neutral";
  label: string;
  context: string;
  delta: string;
  detail?: ActionDetail;
}

export interface BriefingNotification {
  id: string;
  tier: "CRITICAL" | "WARNING" | "INSIGHT";
  ago: string;
  description: string;
  chip: string;
  /** Optional headline metric shown in the row's middle column. */
  metric?: { label: string; value: string; tone?: "good" | "warn" | "bad" };
  /** Optional context chips (e.g. project codes, office, category). */
  chips?: string[];
  /** Optional sparkline (recent trend); 6–12 points works best. */
  spark?: number[];
  /** Optional drill-down detail for the row's Ask AI / details modal. */
  detail?: ActionDetail;
}

export interface DailyBriefingData {
  hero: BriefingHero;
  scan: BriefingScanStats;
  changes: BriefingChange[];
  /** Section heading for the "what changed" card, e.g.
      "WHAT CHANGED THIS MONTH" or "TODAY'S SNAPSHOT" when there's no baseline. */
  changesHeading: string;
  changesBadge: string;
  /** True when changes are a snapshot of current state (no baseline available
      for the chosen window yet), so the UI can label them as SAMPLE rather
      than real period-over-period deltas. */
  changesAreSample: boolean;
  notifications: BriefingNotification[];
  notificationsBadge: string;
  /** True when notifications are placeholder examples (real inbox is empty),
      so the UI can mark the card SAMPLE. */
  notificationsAreSample: boolean;
  fetchedAt: number;
  degraded: boolean;
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
// with mobile lib/dailyBriefing.ts.
const PMM_CLOSED_STATUSES = new Set([
  "closed", "close out", "closeout", "complete", "completed",
  "cancelled", "canceled", "lost", "dead", "archived", "inactive",
]);
const OPM_CLOSED_STATUSES = new Set(["Cancelled", "Lost", "Declined", "Dead"]);

function isPmmActive(r: ModuleRecord): boolean {
  if (r.Closed === true) return false;
  // Lowercase both sides — imported status values vary in casing ("CLOSED",
  // "Complete", "closeout") and a case miss silently counts as active.
  const status = String(r.CRMProjectStatusChoice ?? r.Status ?? r.ModuleStepLookup ?? "").trim().toLowerCase();
  return !PMM_CLOSED_STATUSES.has(status);
}

function isOpmOpen(r: ModuleRecord): boolean {
  if (r.Closed === true) return false;
  const stage = String(r.CRMOpportunityStatusChoice ?? r.Status ?? r.ModuleStepLookup ?? "");
  return !OPM_CLOSED_STATUSES.has(stage);
}

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

/* ─── snapshot persistence (localStorage) ─────────────────────────────── */

const SNAPSHOT_HISTORY_LIMIT = 100;

function loadSnapshotStore(): SnapshotStore {
  try {
    if (typeof localStorage === "undefined") return { history: [] };
    const raw = localStorage.getItem(snapshotKey());
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

function persistSnapshot(current: CurrentSnapshot, store: SnapshotStore): SnapshotStore {
  const today = todayKey();
  const todays: BriefingSnapshot = { date: today, ...current };
  // Replace today's row if it already exists; otherwise prepend.
  const others = store.history.filter((s) => s.date !== today);
  const next: SnapshotStore = {
    history: [todays, ...others].slice(0, SNAPSHOT_HISTORY_LIMIT),
  };
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(snapshotKey(), JSON.stringify(next));
    }
  } catch {/* best effort */}
  return next;
}

/* ─── instant-render briefing seed (in-memory, per tenant+user) ───────── */
//
// The composed briefing is rebuilt from five network sources on every open,
// so revisiting /briefing (avatar menu, back-nav) re-held the "Evaluating
// your daily briefing" spinner for the slowest source — a cold
// /resource-allocations read has been observed taking 70s+. Stale-while-
// revalidate seed: keep the last fully-live composed briefing per
// tenant+user and render it instantly on the next open while the live
// compose refreshes in the background.
//
// Rules (do not regress):
// - Storage is lib/memSeed (in-memory ONLY, wiped by every full bustCache —
//   login/logout/auth-error). App/customer data must NEVER be written to
//   localStorage/sessionStorage (customer requirement, see api.ts).
// - Key includes tenant AND username BY CONSTRUCTION on top of the auth-
//   boundary wipe; never read/write when either is missing — a shared
//   bucket could flash one account's briefing to another account.
// - Only seed FULLY-LIVE composes: every source fulfilled AND no payload
//   carrying a `_degraded` marker (hollow-cache rule — a degraded/partial
//   briefing must never become the next open's instant render).
const SEED_KEY_BASE = "daily-briefing-seed";
const SEED_MAX_AGE_MS = 48 * 60 * 60 * 1000;
// Tolerate small clock skew/adjustments, but a seed stamped further in the
// future than this is corrupt — reject it instead of trusting it forever.
const SEED_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function seedStorageKey(): string | null {
  const u = getStoredUser();
  const tenant = (u?.tenant ?? "").trim().toLowerCase();
  const username = (u?.username ?? "").trim().toLowerCase();
  if (!tenant || !username) return null;
  return `${SEED_KEY_BASE}:${tenant}::${username}`;
}

interface BriefingSeedEnvelope {
  v: 1;
  role: RolePersona;
  window: BriefingWindow;
  data: DailyBriefingData;
}

function persistBriefingSeed(env: BriefingSeedEnvelope): void {
  try {
    const key = seedStorageKey();
    if (!key) return;
    memSeed.setItem(key, JSON.stringify(env));
  } catch { /* instant render is best-effort */ }
}

function isValidBriefingData(value: unknown): value is DailyBriefingData {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<DailyBriefingData>;
  return Boolean(
    d.hero && typeof d.hero === "object" &&
    d.scan && typeof d.scan === "object" && Array.isArray(d.scan.kpis) &&
    Array.isArray(d.changes) &&
    Array.isArray(d.notifications) &&
    typeof d.fetchedAt === "number" &&
    Number.isFinite(d.fetchedAt),
  );
}

/** Read the server-side overnight result. It is intentionally separate from
 * the memory seed: the latter is only a same-session optimization, while this
 * path survives browser, worker, and deployment restarts. */
export async function readSavedBriefing(
  role: RolePersona,
  window: BriefingWindow,
): Promise<DailyBriefingData | null> {
  const hit = await getSavedDailyBriefing(role, window);
  const d = hit?.data;
  if (!isValidBriefingData(d) || d.degraded || d.degradedSources?.length) return null;
  const age = Date.now() - d.fetchedAt;
  if (age > SEED_MAX_AGE_MS || age < -SEED_MAX_FUTURE_SKEW_MS) return null;
  return d;
}

/** Last fully-live briefing for THIS tenant+user, or null when absent,
 *  older than 48h, malformed, or composed for a different role/window. */
export function readBriefingSeed(
  role: RolePersona,
  window: BriefingWindow,
): DailyBriefingData | null {
  try {
    const key = seedStorageKey();
    if (!key) return null;
    const raw = memSeed.getItem(key);
    if (!raw) return null;
    const env = JSON.parse(raw) as BriefingSeedEnvelope;
    if (!env || env.v !== 1 || env.role !== role || env.window !== window) return null;
    const d = env.data;
    // Validate every collection the page renders — a malformed seed must
    // fall back to the normal loading path, never crash the seeded render.
    if (!isValidBriefingData(d)) return null;
    const age = Date.now() - d.fetchedAt;
    if (age > SEED_MAX_AGE_MS || age < -SEED_MAX_FUTURE_SKEW_MS) return null;
    return d;
  } catch {
    return null;
  }
}

/** Fire-and-forget prewarm of the briefing's four slow data sources (the
 *  RDS-backed reads). Called from the login flow when the post-login route
 *  is /briefing so the network round-trips overlap the splash + route
 *  transition instead of starting only when the page mounts. api.ts
 *  cached() de-dupes in-flight promises, so the page's own compose JOINS
 *  these fetches rather than duplicating them.
 *
 *  The inbox is deliberately NOT warmed: inboxStore is an identity-bound
 *  singleton whose user is set by setInboxUser on the briefing page —
 *  fetching it before that runs could pull the PREVIOUS account's inbox on
 *  a shared-browser re-login and contaminate the notifications feed.
 *  Errors are swallowed — the page's own load owns error handling. */
export function warmDailyBriefing(): void {
  try {
    void Promise.allSettled([
      getResourceAllocations(),
      getModuleRecords("PMM"),
      getModuleRecords("OPM"),
      getResourceDemands(),
    ]);
  } catch { /* warm is best-effort */ }
}

/** Pick the snapshot whose age is closest to `days` days, but at least one
 *  full day old (so we never compare today to itself). The match must be
 *  within ±50% of the window so a shallow history doesn't falsely back a
 *  90d delta with a 3-day-old row. Falls back to the oldest snapshot when
 *  nothing fits the tolerance, so the section never looks empty just
 *  because the user installed yesterday. */
/** Parse a YYYY-MM-DD key into local midnight ms, returning NaN on bad input.
 *  Manual component parsing avoids Date(`YYYY-MM-DDTHH:MM:SS`) timezone
 *  ambiguity (some JS engines treat that as UTC, others as local). */
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
    // Use oldest available so a freshly-installed user still gets *some* delta.
    const eligible = history.filter((s) => s && s.date && s.date !== today);
    if (eligible.length > 0) best = eligible[eligible.length - 1];
  }
  return best;
}

/* ─── detail builders (drill-down popups) ─────────────────────────────── */

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
  const { overCapacityPct } = getBusinessRules();
  const rows = resources
    .filter((r) => r.currentPct >= overCapacityPct)
    .sort((a, b) => b.currentPct - a.currentPct)
    .slice(0, MAX_DETAIL_ROWS)
    .map((r) => ({
      Resource: r.name,
      Role: r.role || "—",
      Utilization: `${Math.round(r.currentPct)}%`,
      Projects: projectsForResource(r),
      // Hidden full unique list — used by the AI hand-off so the
      // prompt sees ALL projects, not just the truncated "+N" form.
      _projectsAll: Array.from(
        new Set((r.activeProjects ?? []).filter(Boolean) as string[]),
      ).join(", "),
    }));
  return {
    title,
    subtitle,
    columns: [
      { key: "Resource", label: "Resource" },
      { key: "Role", label: "Role" },
      { key: "Utilization", label: "Util.", align: "right", note: `Hours assigned ÷ working capacity — 100% = fully booked, ${overCapacityPct}%+ = overloaded` },
      { key: "Projects", label: "Projects" },
    ],
    rows,
    emptyText: `No resources currently at ${overCapacityPct}%+ allocation.`,
    goTo: staffLink(rows.length === 1 ? String(rows[0].Resource) : null),
  };
}

function buildHealthyDetail(resources: LiveResource[]): ActionDetail {
  const { overCapacityPct, underAllocatedPct } = getBusinessRules();
  const rows = resources
    .filter((r) => r.currentPct >= underAllocatedPct && r.currentPct < overCapacityPct)
    .sort((a, b) => b.currentPct - a.currentPct)
    .slice(0, MAX_DETAIL_ROWS)
    .map((r) => ({
      Resource: r.name,
      Role: r.role || "—",
      Utilization: `${Math.round(r.currentPct)}%`,
      Projects: projectsForResource(r),
    }));
  return {
    title: "Optimal staff",
    subtitle: `${rows.length} resource${rows.length === 1 ? "" : "s"} at ${underAllocatedPct}–${overCapacityPct}% utilization`,
    columns: [
      { key: "Resource", label: "Resource" },
      { key: "Role", label: "Role" },
      { key: "Utilization", label: "Util.", align: "right", note: `Hours assigned ÷ working capacity — 100% = fully booked, ${overCapacityPct}%+ = overloaded` },
      { key: "Projects", label: "Projects" },
    ],
    rows,
    emptyText: "No resources currently in the optimal band.",
    goTo: STAFF_LIST_LINK,
  };
}

function buildBenchDetail(resources: LiveResource[]): ActionDetail {
  const benched = resources.filter((r) => r.currentPct <= 0);
  const rows = benched.map((r) => ({
    Resource: r.name,
    Role: r.role || "—",
    LastActive: r.lastActiveDate ? new Date(r.lastActiveDate).toLocaleDateString() : "—",
  }));
  return {
    title: "Bench capacity",
    subtitle: `${benched.length} resource${benched.length === 1 ? "" : "s"} available now`,
    columns: [
      { key: "Resource", label: "Resource" },
      { key: "Role", label: "Role" },
      { key: "LastActive", label: "Last active", align: "right" },
    ],
    rows,
    emptyText: "No resources currently on the bench.",
    goTo: STAFF_LIST_LINK,
  };
}

function buildPipelineDetail(
  openOpms: ModuleRecord[],
  pipelineWeighted: number,
  title: string,
  subtitle: string,
): ActionDetail {
  const rows = [...openOpms]
    .sort((a, b) => (Number(b.ApproxContractValue ?? 0) || 0) - (Number(a.ApproxContractValue ?? 0) || 0))
    .map((r) => {
      const v = Number(r.ApproxContractValue ?? 0) || 0;
      const p = Number(r.SuccessChance ?? 0) || 0;
      return {
        _id: String(r.TicketId ?? ""),
        Opportunity: String(r.Title ?? r.TicketId ?? "—"),
        Stage: String(r.CRMOpportunityStatusChoice ?? r.Status ?? r.ModuleStepLookup ?? "—"),
        Value: fmtMoney(v),
        Win: `${Math.round(p)}%`,
        Weighted: fmtMoney(v * (p / 100)),
      };
    });
  return {
    title,
    subtitle: `${subtitle} · ${fmtMoney(pipelineWeighted)} weighted (value × win %)`,
    columns: [
      { key: "Opportunity", label: "Opportunity" },
      { key: "Stage", label: "Stage" },
      { key: "Value", label: "Value", align: "right" },
      { key: "Win", label: "Win %", align: "right", note: "Your team's estimate of how likely this bid is to close — entered manually on each opportunity" },
      { key: "Weighted", label: "Weighted", align: "right", note: "Value × Win % — e.g. a $1M bid at 50% shows $500K here" },
    ],
    rows,
    emptyText: "No open opportunities in the pipeline.",
    goTo: PIPELINE_LINK,
  };
}

function buildUtilizationDetail(resources: LiveResource[], avgUtilization: number): ActionDetail {
  const rows = [...resources]
    .filter((r) => r.currentPct > 0)
    .sort((a, b) => b.currentPct - a.currentPct)
    .slice(0, MAX_DETAIL_ROWS)
    .map((r) => ({
      Resource: r.name,
      Role: r.role || "—",
      Utilization: `${Math.round(r.currentPct)}%`,
      Projects: projectsForResource(r),
    }));
  return {
    title: "Utilization",
    subtitle: `Avg ${avgUtilization}% across ${rows.length} active resource${rows.length === 1 ? "" : "s"}`,
    columns: [
      { key: "Resource", label: "Resource" },
      { key: "Role", label: "Role" },
      { key: "Utilization", label: "Util.", align: "right", note: `Hours assigned ÷ working capacity — 100% = fully booked, ${getBusinessRules().overCapacityPct}%+ = overloaded` },
      { key: "Projects", label: "Projects" },
    ],
    rows,
    emptyText: "No active resources to display.",
    goTo: FORECAST_LINK,
  };
}

function getRecordValue(r: ModuleRecord): number {
  // Fallback chain includes ContractValue and ContractedAmount — some client
  // imports populate ONLY ContractedAmount, and ignoring it renders every
  // project as $0 across the briefing.
  return (
    Number(r.ForecastedProjectCost ?? 0) ||
    Number(r.ApproxContractValue ?? 0) ||
    Number((r as any).ContractValue ?? 0) ||
    Number((r as any).ContractedAmount ?? 0) ||
    Number(r.LaborContractAmount ?? 0) ||
    0
  );
}

function buildExposedProjectsDetail(
  projects: ModuleRecord[],
  totalValue: number,
  winLabel: string,
): ActionDetail {
  const rows = projects.slice(0, MAX_DETAIL_ROWS).map((r) => ({
    _id: String(r.TicketId ?? ""),
    Project: String(r.Title ?? r.TicketId ?? "—"),
    Client: String((r as any).CRMCompanyLookupName ?? (r as any).ClientName ?? (r as any).CompanyName ?? "—"),
    Value: fmtMoney(getRecordValue(r)),
  }));
  return {
    title: "Revenue at risk — projects with no staffing on file",
    subtitle: `${projects.length} active project${projects.length === 1 ? "" : "s"} · ${fmtMoney(totalValue)} total exposure`,
    columns: [
      { key: "Project", label: "Project" },
      { key: "Client", label: "Client" },
      { key: "Value", label: "Contract Value", align: "right" },
    ],
    rows,
    emptyText: "All active projects have team members or staffing plans on file.",
    goTo: PROJECTS_LINK,
  };
}

// Exported for tests: openSlotConsumeLifecycle.test.ts asserts the hidden
// _ticket/_raId hand-off fields the panel quick actions depend on.
// Exported for tests: openSlotConsumeLifecycle.test.ts asserts the hidden
// _ticket/_raId hand-off fields the panel quick actions depend on.
export function buildDemandsDetail(demandItems: DemandItem[], demandsValue: number): ActionDetail {
  const rows = [...demandItems]
    .sort((a, b) => (Number(b.ApproxContractValue ?? 0) || 0) - (Number(a.ApproxContractValue ?? 0) || 0))
    .slice(0, MAX_DETAIL_ROWS)
    .map((d) => {
      const raId = Number(d.RaId);
      return {
        _id: String(d.TicketId ?? ""),
        // Hidden hand-off fields (never rendered — columns drive display):
        // the panel's "Add Team Member" quick action reads _ticket for the
        // project and _raId for the EXACT open position to consume on save,
        // matching the home page's hire rows.
        _ticket: String(d.TicketId ?? ""),
        ...(Number.isInteger(raId) && raId > 0 ? { _raId: raId } : {}),
        Demand: String(d.Title ?? d.TicketId ?? "—"),
        Role: String(d.Role ?? "—"),
        Value: fmtMoney(Number(d.ApproxContractValue ?? 0) || 0),
      };
    });
  return {
    title: "Open staffing demands",
    subtitle: `${rows.length} unfilled · ${fmtMoney(demandsValue)} contract value`,
    columns: [
      { key: "Demand", label: "Demand" },
      { key: "Role", label: "Role" },
      { key: "Value", label: "Value", align: "right" },
    ],
    rows,
    emptyText: "No open staffing demands.",
    goTo: DEMAND_LINK,
  };
}

function buildScheduleRiskDetail(
  projects: ModuleRecord[],
  title: string,
  subtitle: string,
): ActionDetail {
  const rows = projects.slice(0, MAX_DETAIL_ROWS).map((r) => ({
    _id: String(r.TicketId ?? ""),
    Project: String(r.Title ?? r.TicketId ?? "—"),
    Client: String((r as any).CRMCompanyLookupName ?? (r as any).ClientName ?? (r as any).CompanyName ?? "—"),
    Due: effEnd(r) ? effEnd(r)!.toLocaleDateString() : "—",
    Done: `${Math.round(Number(r.PctComplete) || 0)}%`,
  }));
  return {
    title,
    subtitle,
    columns: [
      { key: "Project", label: "Project" },
      { key: "Client", label: "Client" },
      { key: "Due", label: "Due", align: "right" },
      { key: "Done", label: "% Done", align: "right", note: "Completed tasks ÷ total scope — updated as work is marked done in RM ONE" },
    ],
    rows,
    emptyText: "No projects in this category.",
    goTo: PROJECTS_LINK,
  };
}

/* ─── compose ─────────────────────────────────────────────────────────── */

/** Window keys mirror the home page selector so the user gets the same
 *  vocabulary (7 / 30 / 60 / 90 days). The CRITICAL / WARNING / INSIGHT
 *  notifications are filtered to only fire on signals whose underlying
 *  date falls inside the active window. */
export type BriefingWindow = "1d" | "7d" | "30d" | "60d" | "90d";
export const BRIEFING_WINDOW_KEYS: BriefingWindow[] = ["1d", "7d", "30d", "60d", "90d"];
export const BRIEFING_WINDOW_DAYS: Record<BriefingWindow, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "60d": 60,
  "90d": 90,
};
export const BRIEFING_WINDOW_LABEL: Record<BriefingWindow, string> = {
  "1d": "TODAY",
  "7d": "7D",
  "30d": "30D",
  "60d": "60D",
  "90d": "90D",
};
/** Human-readable UPPERCASE label for headings ("WHAT CHANGED TODAY"). */
export const BRIEFING_WINDOW_NAT_UPPER: Record<BriefingWindow, string> = {
  "1d": "TODAY",
  "7d": "THIS WEEK",
  "30d": "THIS MONTH",
  "60d": "LAST 60 DAYS",
  "90d": "THIS QUARTER",
};
/** Human-readable prose label for sentences ("closing today"). */
export const BRIEFING_WINDOW_NAT_PROSE: Record<BriefingWindow, string> = {
  "1d": "today",
  "7d": "this week",
  "30d": "this month",
  "60d": "in the last 60 days",
  "90d": "this quarter",
};
/** Human-readable comparison label for KPI captions ("vs yesterday"). */
export const BRIEFING_WINDOW_NAT_VS: Record<BriefingWindow, string> = {
  "1d": "yesterday",
  "7d": "last week",
  "30d": "last month",
  "60d": "60 days ago",
  "90d": "last quarter",
};

export interface ComposeOptions {
  /** When true, evict any cached responses for the briefing's data sources
   *  before fetching. Used by pull-to-refresh / Refresh button so the user
   *  gets a fully fresh briefing instead of the same in-memory cache the
   *  deeper tabs share. */
  forceRefresh?: boolean;
  /** Time horizon for the operational notifications block. Defaults to
   *  "7d". Drives the chip label and filters CRITICAL/WARNING/INSIGHT
   *  signals so each row only fires when its underlying date sits inside
   *  the selected horizon. */
  window?: BriefingWindow;
  /** Persona to tailor the briefing for. Mirrors homeIntelligence's role
   *  switch: only ordering, labels and which storyline leads change — every
   *  number stays live. Defaults to "COO" (balanced operations view). */
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

/** What each persona leads with. Mirrors the role-switch in homeIntelligence.ts
 *  so the briefing emphasises the signed-in persona's top concern. All numbers
 *  stay live — only ordering, labels and which storyline leads change. */
type BriefingFocus = "operations" | "staffing" | "delivery" | "financial";

const ROLE_FOCUS: Record<RolePersona, BriefingFocus> = {
  COO: "operations",
  RESOURCE_MANAGER: "staffing",
  PROJECT_MANAGER: "delivery",
  CFO: "financial",
  EXECUTIVE: "financial",
};

/** Per-focus ordering of the "what changed" rows. Empty = keep natural order. */
const CHANGE_PRIORITY: Record<BriefingFocus, string[]> = {
  operations: [
    "Utilization",
    "Staffing conflicts",
    "Bench capacity",
    "Forecast backlog",
    "Proposal pipeline",
    "Open staffing demands",
  ],
  financial: [
    "Forecast backlog",
    "Proposal pipeline",
    "Open staffing demands",
    "Utilization",
    "Staffing conflicts",
    "Bench capacity",
  ],
  staffing: [
    "Staffing conflicts",
    "Bench capacity",
    "Open staffing demands",
    "Utilization",
    "Forecast backlog",
    "Proposal pipeline",
  ],
  delivery: [
    "Overdue projects",
    "Due ahead",
    "Portfolio progress",
    "Active projects",
    "Staffing conflicts",
    "Open staffing demands",
    "Utilization",
    "Forecast backlog",
    "Proposal pipeline",
    "Bench capacity",
  ],
};

export async function composeDailyBriefing(opts: ComposeOptions = {}): Promise<DailyBriefingData> {
  if (opts.forceRefresh) {
    bustCacheByPrefix("resource-allocations");
    bustCacheByPrefix("resource-demands");
    bustCacheByPrefix("module:");
  }

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

  const degradedSources: string[] = [];
  if (allocRes.status === "rejected") degradedSources.push("allocations");
  if (pmmRes.status === "rejected") degradedSources.push("projects");
  if (opmRes.status === "rejected") degradedSources.push("pipeline");
  if (demandRes.status === "rejected") degradedSources.push("demands");
  const inboxOk = inboxRes.status === "fulfilled" && inboxRes.value === true;
  if (!inboxOk) degradedSources.push("inbox");
  const allocationsFailed = allocRes.status === "rejected";

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

  const rawResources: LiveResource[] = (alloc?.resources as unknown as LiveResource[]) ?? [];
  const pmmRecords: ModuleRecord[] = pmm?.data ?? [];
  const opmRecords: ModuleRecord[] = opm?.data ?? [];
  const demandItems: DemandItem[] = demand?.data ?? [];

  // Rewrite every resource's currentPct to its WINDOWED load over the
  // tenant's rolling forecast window (today → +forecastWeeks). The feed's
  // raw currentPct means "allocated TODAY", which reads ~0% for portfolios
  // whose weekly rows live in the past/future — the same shared math the
  // Resources page and the server snapshot use (lib/alloc-math).
  const rules = getBusinessRules();
  const fw = forecastWindow(rules.forecastWeeks);
  const allocSignal = hasAllocationSignal(rawResources as unknown as ResourceLike[]);
  const resources: LiveResource[] = rawResources.map((r) => ({
    ...r,
    currentPct: windowedPctForResource(
      r as unknown as ResourceLike,
      fw.startMs,
      fw.endMs,
      rules.workWeekHours,
    ),
  }));

  /* ── current metrics (admin-tuned thresholds, windowed load) ── */
  const util = summarizeUtilization(resources.map((r) => r.currentPct ?? 0), rules);
  const staffTotal = alloc?.total ?? resources.length;
  const overAllocated = util.overloaded;
  const bench = util.bench;
  const healthy = util.healthy;
  const activeForAvg = resources.filter((r) => r.currentPct > 0);
  const avgUtilization = util.avgUtilization;

  const activePmmRecords = pmmRecords.filter(isPmmActive);
  const pmmActive = activePmmRecords.length;
  const demandProjectIds = new Set(
    demandItems
      .map((d) => String((d as any).TicketId ?? (d as any).ProjectId ?? ""))
      .filter(Boolean),
  );
  // Projects that already have people assigned (from the resources feed's
  // per-resource project lists). Demand rows only represent OPEN (unfilled)
  // positions, so a fully staffed project legitimately has ZERO demand rows —
  // it must NOT be flagged as "no staffing". A project counts as covered when
  // it has EITHER open-demand rows OR at least one assigned team member
  // (same rule as homeIntelligence's isStaffed guard).
  const staffedTids = new Set<string>();
  for (const r of rawResources) {
    const ids = Array.isArray((r as any)?.allProjectIds) ? (r as any).allProjectIds : [];
    for (const id of ids) {
      const t = String(id ?? "").trim().toLowerCase();
      if (t) staffedTids.add(t);
    }
  }
  const isStaffed = (tid: string) =>
    staffedTids.has(String(tid ?? "").trim().toLowerCase());
  const exposedPmm = activePmmRecords
    .filter((r) => {
      const tid = String(r.TicketId ?? "");
      return !tid || (!demandProjectIds.has(tid) && !isStaffed(tid));
    })
    .sort((a, b) => getRecordValue(b) - getRecordValue(a));
  const exposedPmmValue = exposedPmm.reduce((s, r) => s + getRecordValue(r), 0);
  const activePmmValueTotal = activePmmRecords.reduce((s, r) => s + getRecordValue(r), 0);
  const openOpms = opmRecords.filter(isOpmOpen);
  const pipelineCount = openOpms.length;
  const pipelineWeighted = openOpms.reduce((s, r) => {
    const v = Number(r.ApproxContractValue ?? 0) || Number((r as any).ContractValue ?? 0) || Number((r as any).ContractedAmount ?? 0) || 0;
    const p = Number(r.SuccessChance ?? 0) || 0;
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
  const role: RolePersona = opts.role ?? "COO";
  const focus = ROLE_FOCUS[role];
  const winDays = BRIEFING_WINDOW_DAYS[win];
  const winLabel = BRIEFING_WINDOW_LABEL[win];
  const winNatUpper = BRIEFING_WINDOW_NAT_UPPER[win];
  const winNatProse = BRIEFING_WINDOW_NAT_PROSE[win];
  const winNatVs = BRIEFING_WINDOW_NAT_VS[win];
  const _winSuffix = `vs ${winDays}d ago`; void _winSuffix;
  const horizonStart = new Date();
  horizonStart.setHours(0, 0, 0, 0);
  // No day-window cutoff (user mandate): the briefing shows EVERYTHING ahead.
  // Urgency framing (overdue vs due-ahead) is kept — only the N-day limit is
  // gone. winDays still picks the "what changed" baseline (vs yesterday).
  const horizonEnd = new Date(horizonStart.getTime() + 36_500 * 86_400_000);

  const store = loadSnapshotStore();
  const baseline = pickBaselineForWindow(store.history, winDays);
  // Only persist today's baseline from a HEALTHY read: any degraded core
  // feed (or an allocations feed with zero allocation rows anywhere) would
  // write zeros into history and poison "since yesterday" deltas for days.
  const coreDegraded = degradedSources.some((s) => s !== "inbox");
  if (!coreDegraded && allocSignal) persistSnapshot(current, store);

  // Shared slices reused by HERO + SCAN + NOTIFICATIONS — all-time (no day
  // cutoff); only past-ended allocations are excluded from over-capacity risk.
  const overInWindow = [...resources]
    .filter((r) => r.currentPct >= rules.overCapacityPct)
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

  // Count POSITIONS, not weekly rows. No date filter (user mandate): every
  // unfilled position shows regardless of when it starts or ends — matching
  // the home page's all-time demand buckets.
  const demandRowsInWindow = demandItems;
  const demandsInWindow = collapseDemandsToPositions(fundedDemandRows(demandRowsInWindow));
  const demandsInWindowValue = uniqueProjectDemandValue(demandsInWindow);

  const opmsInWindow = openOpms.filter((r) => {
    // Effective end: schedule-derived when phases exist; effEnd's OPM
    // fallback chain already covers TargetCompletionDate → CloseDate →
    // BidDueDate. effStart covers records that only carry a start date.
    const d = effEnd(r) ?? effStart(r);
    if (!d) return false;
    // Past-due pursuits are the MOST urgent — no lower date bound.
    return d <= horizonEnd;
  });
  const opmsInWindowWeighted = opmsInWindow.reduce((s, r) => {
    const v = Number(r.ApproxContractValue ?? 0) || Number((r as any).ContractValue ?? 0) || Number((r as any).ContractedAmount ?? 0) || 0;
    const p = Number(r.SuccessChance ?? 0) || 0;
    return s + v * (p / 100);
  }, 0);

  // ── PM/delivery project schedule metrics ──
  const pmmOverdue = activePmmRecords.filter((r) => {
    const d = effEnd(r);
    return !!d && d < horizonStart;
  });
  const pmmDueSoon = activePmmRecords.filter((r) => {
    const d = effEnd(r);
    return !!d && d >= horizonStart && d <= horizonEnd;
  });
  const avgPctComplete = activePmmRecords.length > 0
    ? Math.round(activePmmRecords.reduce((s, r) => s + (Number(r.PctComplete) || 0), 0) / activePmmRecords.length)
    : 0;
  const pmmBehind = pmmDueSoon.filter((r) => (Number(r.PctComplete) || 0) < 50);

  /* ── HERO (window + role aware) ──
     Build every candidate storyline, then let the persona's focus decide which
     one leads. Non-financial personas keep the original staffing-first order;
     CFO / EXECUTIVE lead with the biggest money signal in the window. */
  const topOverInWin = overInWindow[0];
  const heroAgo = relativeAgo(Date.now());

  const overHero: BriefingHero | null = topOverInWin
    ? (() => {
        const otherOver = Math.max(0, overAllocatedWin - 1);
        const projectsAtRisk = topOverInWin.activeProjects?.length ?? 0;
        const city = dominantCity(pmmRecords);
        const cityFrag = city ? ` · ${city} office` : "";
        return {
          agoLabel: heroAgo,
          windowLabel: "FULL OUTLOOK",
          severity: "critical",
          tagLabel: "PINNED · CRITICAL",
          headline: `${topOverInWin.name} projected at ${Math.round(topOverInWin.currentPct)}% utilization${cityFrag}.`,
          subline: otherOver > 0
            ? `+${otherOver} other resource${otherOver === 1 ? "" : "s"} over capacity · cascade risk on ${projectsAtRisk} active project${projectsAtRisk === 1 ? "" : "s"}`
            : `Cascade risk on ${projectsAtRisk} active project${projectsAtRisk === 1 ? "" : "s"} · review allocation now`,
          detail: buildOverAllocatedDetail(
            overInWindow.length > 0 ? overInWindow : resources,
            "Over-allocated",
            `${overAllocatedWin} resource${overAllocatedWin === 1 ? "" : "s"} projected at ${getBusinessRules().overCapacityPct}%+`,
          ),
          resolveRef: {
            refId: `briefing:over-allocated:${topOverInWin.id}`,
            label: `${topOverInWin.name} over-allocation (${Math.round(topOverInWin.currentPct)}%)`,
            level: "critical",
            sub: otherOver > 0
              ? `+${otherOver} other resource${otherOver === 1 ? "" : "s"} over capacity`
              : `Cascade risk on ${projectsAtRisk} active project${projectsAtRisk === 1 ? "" : "s"}`,
            personName: topOverInWin.name,
          },
        };
      })()
    : null;

  const demandHero: BriefingHero | null = demandsInWindow.length > 0
    ? (() => {
        const top = demandsInWindow[0];
        return {
          agoLabel: heroAgo,
          windowLabel: "FULL OUTLOOK",
          severity: "warning",
          tagLabel: "PINNED · WARNING",
          headline: `${demandsInWindow.length} staffing demand${demandsInWindow.length === 1 ? "" : "s"} awaiting fill.`,
          subline: demandsInWindowValue > 0
            ? `Top: ${top.Title || top.TicketId} · ${top.Role || "role TBD"} · ${fmtMoney(demandsInWindowValue)} contract value`
            : `Top: ${top.Title || top.TicketId} · ${top.Role || "role TBD"} · verify staffing coverage before deadlines`,
          detail: buildDemandsDetail(demandsInWindow, demandsInWindowValue),
          resolveRef: {
            refId: `briefing:open-demands:${top.TicketId ?? "top"}`,
            label: `Open staffing demands (${demandsInWindow.length})`,
            level: "warning",
            sub: `${top.Title || top.TicketId} · ${top.Role || "role TBD"}`,
            ticketId: top.TicketId ? String(top.TicketId) : undefined,
          },
        };
      })()
    : null;

  // CFO/EXECUTIVE hero: revenue at risk from projects with no demand coverage.
  const revenueAtRiskHero: BriefingHero | null = exposedPmm.length > 0
    ? {
        agoLabel: heroAgo,
        windowLabel: "FULL OUTLOOK",
        severity: exposedPmmValue > 5_000_000 ? "critical" : "warning",
        tagLabel: exposedPmmValue > 5_000_000 ? "PINNED · CRITICAL" : "PINNED · WARNING",
        headline: `${fmtMoney(exposedPmmValue)} revenue at risk · ${exposedPmm.length} project${exposedPmm.length === 1 ? "" : "s"} with no staffing on file.`,
        subline: exposedPmm[0]
          ? `Highest exposure: ${String(exposedPmm[0].Title ?? exposedPmm[0].TicketId ?? "—")} · ${fmtMoney(getRecordValue(exposedPmm[0]))} · verify staffing before close`
          : `No staffing data on file for active projects`,
        detail: buildExposedProjectsDetail(exposedPmm, exposedPmmValue, winNatProse),
        resolveRef: {
          refId: `briefing:revenue-at-risk`,
          label: `${fmtMoney(exposedPmmValue)} revenue at risk (${exposedPmm.length} projects)`,
          level: exposedPmmValue > 5_000_000 ? "critical" : "warning",
          sub: exposedPmm[0] ? String(exposedPmm[0].Title ?? exposedPmm[0].TicketId ?? "") : undefined,
          ticketId: exposedPmm[0]?.TicketId ? String(exposedPmm[0].TicketId) : undefined,
        },
      }
    : null;

  // Financial storyline fallback: weighted pipeline closing in window.
  const financialHero: BriefingHero | null = (() => {
    if (opmsInWindow.length > 0 && opmsInWindowWeighted > 0) {
      return {
        agoLabel: heroAgo,
        windowLabel: "FULL OUTLOOK",
        severity: "warning",
        tagLabel: "PINNED · PIPELINE",
        headline: `${fmtMoney(opmsInWindowWeighted)} weighted pipeline awaiting close.`,
        subline: `${opmsInWindow.length} opportunit${opmsInWindow.length === 1 ? "y" : "ies"} due · ${pipelineCount} open in pipeline`,
        detail: buildPipelineDetail(
          opmsInWindow,
          opmsInWindowWeighted,
          `Pipeline awaiting close`,
          `${opmsInWindow.length} of ${pipelineCount} open opportunit${pipelineCount === 1 ? "y" : "ies"} due`,
        ),
        resolveRef: {
          refId: "briefing:pipeline",
          label: `${fmtMoney(opmsInWindowWeighted)} weighted pipeline awaiting close`,
          level: "warning",
          sub: `${opmsInWindow.length} opportunit${opmsInWindow.length === 1 ? "y" : "ies"} due`,
        },
      };
    }
    if (demandsInWindow.length > 0 && demandsInWindowValue > 0) {
      return {
        agoLabel: heroAgo,
        windowLabel: "FULL OUTLOOK",
        severity: "warning",
        tagLabel: "PINNED · REVENUE AT RISK",
        headline: `${fmtMoney(demandsInWindowValue)} contract value at risk from unfilled demand.`,
        subline: `${demandsInWindow.length} open staffing demand${demandsInWindow.length === 1 ? "" : "s"} blocking delivery`,
        detail: buildDemandsDetail(demandsInWindow, demandsInWindowValue),
        resolveRef: {
          refId: "briefing:demand-value",
          label: `${fmtMoney(demandsInWindowValue)} contract value at risk from unfilled demand`,
          level: "warning",
          sub: demandsInWindow[0]
            ? `${demandsInWindow[0].Title || demandsInWindow[0].TicketId} · ${demandsInWindow[0].Role || "role TBD"}`
            : undefined,
          ticketId: demandsInWindow[0]?.TicketId ? String(demandsInWindow[0].TicketId) : undefined,
        },
      };
    }
    return null;
  })();

  const degradedHero: BriefingHero | null = allocationsFailed
    ? {
        agoLabel: heroAgo,
        windowLabel: "DEGRADED",
        severity: "warning",
        tagLabel: "PINNED · DATA DEGRADED",
        headline: "Allocation feed unavailable — utilization risk unverified.",
        subline: "Refresh, or open Resources to retry the live workforce sync.",
      }
    : null;

  // Degenerate-data guard: if the tenant has active projects and staff on
  // file but NOBODY carries any current allocation, "Workforce balanced ·
  // 0 of N optimally allocated" is a lie — the truth is a staffing-data gap.
  // Never show ALL CLEAR in that state; surface the gap instead.
  const dataGapHero: BriefingHero | null =
    !allocationsFailed &&
    pmmActive > 0 &&
    staffTotal > 0 &&
    healthy === 0 &&
    overAllocated === 0 &&
    avgUtilization === 0
      ? {
          agoLabel: heroAgo,
          windowLabel: "FULL OUTLOOK",
          severity: "warning",
          tagLabel: "PINNED · DATA GAP",
          headline: `${pmmActive} active project${pmmActive === 1 ? "" : "s"} but no current staffing hours on file.`,
          subline: `${staffTotal} staff loaded · 0 with allocation hours on file — likely missing hours data, not confirmed under-staffing`,
        }
      : null;

  const clearHero: BriefingHero = {
    agoLabel: heroAgo,
    windowLabel: "FULL OUTLOOK · ALL CLEAR",
    severity: "clear",
    tagLabel: "PINNED · ALL CLEAR",
    headline: `Workforce balanced · ${healthy} of ${staffTotal} resources optimally allocated.`,
    subline: "No critical staffing risks detected in the latest scan.",
  };

  // PM delivery-schedule hero: leads when projects are overdue or due this window.
  const deliveryScheduleHero: BriefingHero | null =
    focus === "delivery" && (pmmOverdue.length > 0 || pmmDueSoon.length > 0)
      ? (() => {
          const isOverdue = pmmOverdue.length > 0;
          const top = isOverdue ? pmmOverdue[0] : pmmDueSoon[0];
          return {
            agoLabel: heroAgo,
            windowLabel: "FULL OUTLOOK",
            severity: isOverdue ? "critical" : "warning",
            tagLabel: isOverdue ? "PINNED · OVERDUE" : "PINNED · DUE SOON",
            headline: isOverdue
              ? `${pmmOverdue.length} active project${pmmOverdue.length === 1 ? "" : "s"} past target date.`
              : `${pmmDueSoon.length} project${pmmDueSoon.length === 1 ? "" : "s"} due ahead.`,
            subline: isOverdue
              ? `${pmmDueSoon.length} more due ahead · avg portfolio completion ${avgPctComplete}%`
              : pmmBehind.length > 0
              ? `${pmmBehind.length} below 50% complete · avg ${avgPctComplete}% across ${pmmActive} active`
              : `Avg portfolio completion ${avgPctComplete}% · ${pmmActive} active projects`,
            detail: buildScheduleRiskDetail(
              isOverdue ? [...pmmOverdue, ...pmmDueSoon] : pmmDueSoon,
              isOverdue ? "Projects past target date" : `Projects due ahead`,
              isOverdue
                ? `${pmmOverdue.length} overdue · ${pmmDueSoon.length} more due`
                : `${pmmDueSoon.length} project${pmmDueSoon.length === 1 ? "" : "s"} · avg ${avgPctComplete}% complete`,
            ),
            resolveRef: {
              refId: `briefing:schedule-risk:${String(top?.TicketId ?? "top")}`,
              label: isOverdue
                ? `${pmmOverdue.length} project${pmmOverdue.length === 1 ? "" : "s"} overdue`
                : `${pmmDueSoon.length} project${pmmDueSoon.length === 1 ? "" : "s"} due ahead`,
              level: isOverdue ? "critical" : "warning",
              sub: top ? String(top.Title ?? top.TicketId ?? "") : undefined,
              ticketId: top?.TicketId ? String(top.TicketId) : undefined,
            },
          };
        })()
      : null;

  // COO/PM delivery-risk hero: operational framing (projects at risk, not $-value).
  const deliveryRiskHero: BriefingHero | null = (focus === "operations" || focus === "delivery") && exposedPmm.length > 0
    ? {
        agoLabel: heroAgo,
        windowLabel: "FULL OUTLOOK",
        severity: exposedPmm.length >= 5 ? "critical" : "warning",
        tagLabel: exposedPmm.length >= 5 ? "PINNED · CRITICAL" : "PINNED · WARNING",
        headline: `${exposedPmm.length} active project${exposedPmm.length === 1 ? "" : "s"} with no staffing on file · delivery risk.`,
        subline: exposedPmm[0]
          ? `Highest: ${String(exposedPmm[0].Title ?? exposedPmm[0].TicketId ?? "—")} · verify staffing plan before delivery deadline`
          : "No staffing data on file for active projects · run staffing review",
        detail: buildExposedProjectsDetail(exposedPmm, exposedPmmValue, winNatProse),
        resolveRef: {
          refId: "briefing:delivery-risk",
          label: `${exposedPmm.length} project${exposedPmm.length === 1 ? "" : "s"} at delivery risk`,
          level: exposedPmm.length >= 5 ? "critical" : "warning",
          sub: exposedPmm[0] ? String(exposedPmm[0].Title ?? exposedPmm[0].TicketId ?? "") : undefined,
          ticketId: exposedPmm[0]?.TicketId ? String(exposedPmm[0].TicketId) : undefined,
        },
      }
    : null;

  // Financial personas lead with the money storyline; COO leads with operational
  // risks then delivery risk; everyone else keeps the original staffing-first order.
  const heroOrder: (BriefingHero | null)[] =
    focus === "financial"
      ? [revenueAtRiskHero, financialHero, overHero, demandHero, degradedHero]
      : focus === "delivery"
        ? [deliveryScheduleHero, overHero, demandHero, degradedHero]
        : focus === "operations"
          ? [overHero, deliveryRiskHero, demandHero, degradedHero]
          : [overHero, demandHero, degradedHero];
  const hero: BriefingHero =
    heroOrder.find((h): h is BriefingHero => h != null) ?? dataGapHero ?? clearHero;

  /* ── OVERNIGHT SCAN ── */
  const subStat = `${pmmActive} PROJ · ${staffTotal} STAFF · ${pipelineCount} PURSUITS`;

  // Deltas vs the snapshot whose age matches the active window.
  const fcastDelta = baseline ? pipelineWeighted - baseline.pipelineWeighted : 0;
  const overDelta  = baseline ? overAllocated - baseline.overAllocated : 0;
  const healthyDelta = baseline ? healthy - baseline.healthy : 0;

  const riskKpi: BriefingKpi = {
    number: String(overAllocatedWin),
    tone: overAllocatedWin > 0 ? "critical" : "good",
    labelTop: "RISKS",
    labelBottom: "FLAGGED",
    caption: "now & ahead",
    detail: buildOverAllocatedDetail(
      overInWindow.length > 0 ? overInWindow : resources,
      "Risks flagged",
      `${overAllocatedWin} resource${overAllocatedWin === 1 ? "" : "s"} projected at ${getBusinessRules().overCapacityPct}%+`,
    ),
  };
  const demandsKpi: BriefingKpi = {
    number: String(demandsInWindow.length),
    tone: demandsInWindow.length > 0 ? "neutral" : "good",
    labelTop: "OPEN",
    labelBottom: "DEMANDS",
    caption: demandsInWindowValue > 0
      ? `${fmtMoney(demandsInWindowValue)} at stake`
      : "all open",
    detail: buildDemandsDetail(
      demandsInWindow.length > 0 ? demandsInWindow : demandPositions,
      demandsInWindow.length > 0 ? demandsInWindowValue : demandsValue,
    ),
  };
  const pipelineKpi: BriefingKpi = {
    number: fmtMoney(opmsInWindowWeighted),
    tone: opmsInWindowWeighted > 0 ? "good" : "neutral",
    labelTop: "PIPELINE",
    labelBottom: "OPEN",
    caption: `${opmsInWindow.length} awaiting close`,
    detail: buildPipelineDetail(
      opmsInWindow.length > 0 ? opmsInWindow : openOpms,
      opmsInWindow.length > 0 ? opmsInWindowWeighted : pipelineWeighted,
      `Pipeline awaiting close`,
      `${opmsInWindow.length} of ${pipelineCount} open opportunit${pipelineCount === 1 ? "y" : "ies"}`,
    ),
  };
  const benchKpi: BriefingKpi = {
    number: String(bench),
    tone: "good",
    labelTop: "BENCH",
    labelBottom: "AVAIL",
    caption: bench === 1 ? "resource open now" : "resources open now",
    detail: buildBenchDetail(resources),
  };
  const forecastKpi: BriefingKpi = {
    number: baseline ? signedMoney(fcastDelta) : fmtMoney(pipelineWeighted),
    tone: baseline ? (fcastDelta >= 0 ? "good" : "critical") : "neutral",
    labelTop: "FORECAST",
    labelBottom: "SHIFT",
    caption: baseline ? `vs ${winNatVs}` : "weighted total",
    detail: buildPipelineDetail(
      openOpms,
      pipelineWeighted,
      "Forecast backlog",
      `${pipelineCount} open opportunit${pipelineCount === 1 ? "y" : "ies"} weighted`,
    ),
  };

  const revenueAtRiskKpi: BriefingKpi = {
    number: fmtMoney(exposedPmmValue),
    tone: exposedPmmValue > 0 ? "critical" : "good",
    labelTop: "REVENUE",
    labelBottom: "AT RISK",
    caption: `${exposedPmm.length} project${exposedPmm.length === 1 ? "" : "s"} unstaffed`,
    detail: buildExposedProjectsDetail(exposedPmm, exposedPmmValue, winNatProse),
  };

  const portfolioValueKpi: BriefingKpi = {
    number: fmtMoney(activePmmValueTotal),
    tone: activePmmValueTotal > 0 ? "good" : "neutral",
    labelTop: "ACTIVE",
    labelBottom: "PORTFOLIO",
    caption: `${pmmActive} project${pmmActive === 1 ? "" : "s"}`,
    detail: buildExposedProjectsDetail(
      activePmmRecords.length > 0 ? activePmmRecords : [],
      activePmmValueTotal,
      winNatProse,
    ),
  };
  const pipelineTotalKpi: BriefingKpi = {
    number: fmtMoney(pipelineWeighted),
    tone: pipelineWeighted > 0 ? "good" : "neutral",
    labelTop: "PIPELINE",
    labelBottom: "WEIGHTED",
    caption: `${pipelineCount} pursuit${pipelineCount === 1 ? "" : "s"} total`,
    detail: buildPipelineDetail(
      openOpms.length > 0 ? openOpms : [],
      pipelineWeighted,
      "Total weighted pipeline",
      `${pipelineCount} open opportunit${pipelineCount === 1 ? "y" : "ies"}`,
    ),
  };

  const activeProjectsKpi: BriefingKpi = {
    number: String(pmmActive),
    tone: pmmActive > 0 ? "neutral" : "neutral",
    labelTop: "ACTIVE",
    labelBottom: "PROJECTS",
    caption: pmmOverdue.length > 0
      ? `${pmmOverdue.length} overdue · ${pmmDueSoon.length} due ahead`
      : pmmDueSoon.length > 0 ? `${pmmDueSoon.length} due ahead` : `portfolio`,
    detail: buildScheduleRiskDetail(
      [...activePmmRecords].sort((a, b) => (Number(b.PctComplete) || 0) - (Number(a.PctComplete) || 0)).slice(0, MAX_DETAIL_ROWS),
      "Active project portfolio",
      `${pmmActive} active · avg ${avgPctComplete}% complete`,
    ),
  };
  const scheduleRiskKpi: BriefingKpi = {
    number: String(pmmOverdue.length + pmmDueSoon.length),
    tone: pmmOverdue.length > 0 ? "critical" : pmmDueSoon.length > 0 ? "neutral" : "good",
    labelTop: pmmOverdue.length > 0 ? "OVERDUE" : "DUE",
    labelBottom: pmmOverdue.length > 0 ? "/ DUE SOON" : "AHEAD",
    caption: pmmOverdue.length > 0
      ? `${pmmOverdue.length} overdue · ${pmmDueSoon.length} due ahead`
      : `due ahead`,
    detail: buildScheduleRiskDetail(
      [...pmmOverdue, ...pmmDueSoon],
      "Schedule risk",
      `${pmmOverdue.length} overdue · ${pmmDueSoon.length} due ahead`,
    ),
  };
  const avgProgressKpi: BriefingKpi = {
    number: `${avgPctComplete}%`,
    tone: avgPctComplete >= 75 ? "good" : avgPctComplete >= 50 ? "neutral" : "critical",
    labelTop: "AVG",
    labelBottom: "PROGRESS",
    caption: `across ${pmmActive} active`,
    detail: buildScheduleRiskDetail(
      [...activePmmRecords].sort((a, b) => (Number(b.PctComplete) || 0) - (Number(a.PctComplete) || 0)).slice(0, MAX_DETAIL_ROWS),
      "Portfolio completion",
      `Avg ${avgPctComplete}% complete across ${pmmActive} active projects`,
    ),
  };

  // Each persona surfaces the three KPIs that matter most to it.
  const kpis: BriefingKpi[] =
    focus === "financial"
      ? [pipelineKpi, revenueAtRiskKpi, forecastKpi]
      : focus === "operations"
        ? [riskKpi, portfolioValueKpi, pipelineTotalKpi]
        : focus === "staffing"
          ? [riskKpi, demandsKpi, benchKpi]
          : focus === "delivery"
            ? [activeProjectsKpi, scheduleRiskKpi, demandsKpi]
            : [riskKpi, demandsKpi, pipelineKpi];

  /* ── WHAT CHANGED ── */
  const changes: BriefingChange[] = [];

  const utilDetail = () => buildUtilizationDetail(resources, avgUtilization);
  const forecastDetail = () =>
    buildPipelineDetail(openOpms, pipelineWeighted, "Forecast backlog",
      `${pipelineCount} open opportunit${pipelineCount === 1 ? "y" : "ies"} weighted`);
  const conflictsDetail = () =>
    buildOverAllocatedDetail(resources, "Staffing conflicts",
      `${overAllocated} resource${overAllocated === 1 ? "" : "s"} above 100% utilization`);
  const benchDetailFn = () => buildBenchDetail(resources);
  const demandsDetailFn = () => buildDemandsDetail(demandPositions, demandsValue);

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
    if (Math.abs(fcastDelta) > 1 && focus !== "delivery" && focus !== "staffing") {
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
        context: `${overAllocated} resource${overAllocated === 1 ? "" : "s"} ≥${rules.overCapacityPct}% allocated`,
        delta: signedInt(overDelta),
        detail: conflictsDetail(),
      });
    }
    const benchDelta = bench - baseline.bench;
    if (benchDelta !== 0) {
      changes.push({
        icon: benchDelta > 0 ? "trending-up" : "trending-down",
        tone: benchDelta > 0 ? "good" : "bad",
        label: "Bench capacity",
        context: `${bench} resource${bench === 1 ? "" : "s"} on bench`,
        delta: signedInt(benchDelta),
        detail: benchDetailFn(),
      });
    }
    const pcountDelta = pipelineCount - baseline.pipelineCount;
    if (pcountDelta !== 0 && focus !== "delivery" && focus !== "staffing") {
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
        detail: demandsDetailFn(),
      });
    }
    // PM/delivery-specific delta rows (project schedule health).
    if (focus === "delivery") {
      const pmmActiveDelta = pmmActive - baseline.pmmActive;
      if (pmmActiveDelta !== 0) {
        changes.push({
          icon: pmmActiveDelta > 0 ? "trending-up" : "trending-down",
          tone: "neutral",
          label: "Active projects",
          context: `${pmmActive} active project${pmmActive === 1 ? "" : "s"}`,
          delta: signedInt(pmmActiveDelta),
          detail: buildScheduleRiskDetail(
            [...activePmmRecords].sort((a, b) => (Number(b.PctComplete) || 0) - (Number(a.PctComplete) || 0)).slice(0, MAX_DETAIL_ROWS),
            "Active projects", `${pmmActive} active · avg ${avgPctComplete}% complete`,
          ),
        });
      }
      if (pmmOverdue.length > 0) {
        changes.push({
          icon: "trending-up", tone: "bad",
          label: "Overdue projects",
          context: `${pmmOverdue.length} past target date`,
          delta: String(pmmOverdue.length),
          detail: buildScheduleRiskDetail(pmmOverdue, "Overdue projects", `${pmmOverdue.length} past target date`),
        });
      }
      if (pmmDueSoon.length > 0) {
        changes.push({
          icon: "arrow-up-right",
          tone: pmmBehind.length > 0 ? "bad" : "neutral",
          label: "Due ahead",
          context: `${pmmDueSoon.length} project${pmmDueSoon.length === 1 ? "" : "s"} due ahead`,
          delta: pmmBehind.length > 0 ? `${pmmBehind.length} behind` : `${pmmDueSoon.length} on track`,
          detail: buildScheduleRiskDetail(pmmDueSoon, `Projects due ahead`, `${pmmDueSoon.length} due · ${pmmBehind.length} below 50%`),
        });
      }
      if (avgPctComplete > 0) {
        changes.push({
          icon: "trending-up",
          tone: avgPctComplete >= 75 ? "good" : "neutral",
          label: "Portfolio progress",
          context: `Avg ${avgPctComplete}% across ${pmmActive} active`,
          delta: `${avgPctComplete}%`,
          detail: buildScheduleRiskDetail(
            [...activePmmRecords].sort((a, b) => (Number(b.PctComplete) || 0) - (Number(a.PctComplete) || 0)).slice(0, MAX_DETAIL_ROWS),
            "Portfolio progress", `Avg ${avgPctComplete}% complete across ${pmmActive} active projects`,
          ),
        });
      }
    }
  }

  if (changes.length === 0) {
    if (focus === "financial") {
      if (exposedPmmValue > 0) {
        changes.push({
          icon: "trending-up", tone: "bad",
          label: "Revenue at risk",
          context: `${exposedPmm.length} project${exposedPmm.length === 1 ? "" : "s"} with no staffing on file`,
          delta: fmtMoney(exposedPmmValue),
          detail: buildExposedProjectsDetail(exposedPmm, exposedPmmValue, winNatProse),
        });
      }
      if (pipelineWeighted > 0) {
        changes.push({
          icon: "trending-up", tone: "good",
          label: "Pipeline coverage",
          context: `${pipelineCount} open opportunit${pipelineCount === 1 ? "y" : "ies"} weighted`,
          delta: fmtMoney(pipelineWeighted),
          detail: forecastDetail(),
        });
      }
      if (opmsInWindow.length > 0) {
        changes.push({
          icon: "arrow-up-right", tone: "good",
          label: "Pursuits closing",
          context: `Due ahead`,
          delta: `${opmsInWindow.length} opp${opmsInWindow.length === 1 ? "" : "s"}`,
          detail: buildPipelineDetail(
            opmsInWindow, opmsInWindowWeighted,
            `Pipeline awaiting close`,
            `${opmsInWindow.length} of ${pipelineCount} opportunit${pipelineCount === 1 ? "y" : "ies"} due`,
          ),
        });
      }
      if (pmmActive > 0) {
        changes.push({
          icon: "trending-up", tone: "neutral",
          label: "Active backlog",
          context: `${pmmActive} active project${pmmActive === 1 ? "" : "s"}`,
          delta: `${pmmActive}`,
        });
      }
      if (demandsCount > 0) {
        changes.push({
          icon: "trending-up", tone: "neutral",
          label: "Open staffing demands",
          context: `${fmtMoney(demandsValue)} contract value`,
          delta: String(demandsCount),
          detail: demandsDetailFn(),
        });
      }
    } else if (focus === "delivery") {
      // PM/delivery persona snapshot: project schedule health
      if (pmmActive > 0) {
        changes.push({
          icon: "trending-up", tone: "neutral",
          label: "Active projects",
          context: `${pmmActive} active project${pmmActive === 1 ? "" : "s"}`,
          delta: `${pmmActive}`,
          detail: buildScheduleRiskDetail(
            [...activePmmRecords].sort((a, b) => (Number(b.PctComplete) || 0) - (Number(a.PctComplete) || 0)).slice(0, MAX_DETAIL_ROWS),
            "Active projects", `${pmmActive} active · avg ${avgPctComplete}% complete`,
          ),
        });
      }
      if (pmmOverdue.length > 0) {
        changes.push({
          icon: "trending-up", tone: "bad",
          label: "Overdue projects",
          context: `${pmmOverdue.length} past target date`,
          delta: String(pmmOverdue.length),
          detail: buildScheduleRiskDetail(pmmOverdue, "Overdue projects", `${pmmOverdue.length} past target date`),
        });
      }
      if (pmmDueSoon.length > 0) {
        changes.push({
          icon: "arrow-up-right",
          tone: pmmBehind.length > 0 ? "bad" : "neutral",
          label: "Due ahead",
          context: `${pmmDueSoon.length} project${pmmDueSoon.length === 1 ? "" : "s"} due ahead`,
          delta: pmmBehind.length > 0 ? `${pmmBehind.length} behind` : `${pmmDueSoon.length} on track`,
          detail: buildScheduleRiskDetail(pmmDueSoon, `Projects due ahead`, `${pmmDueSoon.length} due · ${pmmBehind.length} below 50%`),
        });
      }
      if (avgPctComplete > 0) {
        changes.push({
          icon: "trending-up",
          tone: avgPctComplete >= 75 ? "good" : "neutral",
          label: "Portfolio progress",
          context: `Avg ${avgPctComplete}% across ${pmmActive} active`,
          delta: `${avgPctComplete}%`,
          detail: buildScheduleRiskDetail(
            [...activePmmRecords].sort((a, b) => (Number(b.PctComplete) || 0) - (Number(a.PctComplete) || 0)).slice(0, MAX_DETAIL_ROWS),
            "Portfolio progress", `Avg ${avgPctComplete}% complete across ${pmmActive} active projects`,
          ),
        });
      }
      if (demandsCount > 0) {
        changes.push({
          icon: "trending-up", tone: "neutral",
          label: "Open staffing demands",
          context: `${fmtMoney(demandsValue)} contract value`,
          delta: String(demandsCount),
          detail: demandsDetailFn(),
        });
      }
    } else {
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
          context: `≥${rules.overCapacityPct}% allocated`,
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
          detail: benchDetailFn(),
        });
      }
      if (demandsCount > 0) {
        changes.push({
          icon: "trending-up", tone: "neutral",
          label: "Open staffing demands",
          context: `${fmtMoney(demandsValue)} contract value`,
          delta: String(demandsCount),
          detail: demandsDetailFn(),
        });
      }
    }
  }

  // Reorder so the persona's priorities lead (stable sort keeps insertion order
  // within ties). "operations" keeps the natural order.
  const changePrio = CHANGE_PRIORITY[focus];
  if (changePrio.length > 0) {
    const rankChange = (label: string) => {
      const idx = changePrio.indexOf(label);
      return idx === -1 ? 999 : idx;
    };
    changes.sort((a, b) => rankChange(a.label) - rankChange(b.label));
  }

  const clippedChanges = changes.slice(0, 5);
  const changesHeading = baseline
    ? `WHAT CHANGED ${winNatUpper}`
    : "TODAY'S SNAPSHOT";
  const changesBadge = baseline
    ? `${clippedChanges.length} MOVE${clippedChanges.length === 1 ? "" : "S"} VS ${winNatUpper}`
    : winNatUpper;

  /* ── NOTIFICATIONS (operational alerts, horizon-aware) ──
     CFO sees financial signals (revenue at risk, pipeline coverage, client
     concentration). All other personas see the original staffing signals. */
  const opNotifications: BriefingNotification[] = [];

  if (focus === "financial") {
    // CRITICAL — revenue at risk from active projects with no demand coverage
    if (exposedPmm.length > 0) {
      opNotifications.push({
        id: "cfo-crit-revenue-at-risk",
        tier: exposedPmmValue > 5_000_000 ? "CRITICAL" : "WARNING",
        ago: "live",
        description: `${fmtMoney(exposedPmmValue)} revenue at risk · ${exposedPmm.length} active project${exposedPmm.length === 1 ? "" : "s"} with no staffing on file.`,
        chip: "LIVE",
        metric: { label: "exposed", value: fmtMoney(exposedPmmValue), tone: "bad" },
        chips: [`${exposedPmm.length} unstaffed`],
        detail: buildExposedProjectsDetail(exposedPmm, exposedPmmValue, winNatProse),
      });
    }
    // WARNING — only when pursuits actually close inside the horizon: those
    // carry bid/decision deadlines the CFO can act on TODAY. A quiet pipeline
    // is an overview, not a warning — that lives in the INSIGHT row below.
    if (opmsInWindow.length > 0) {
      opNotifications.push({
        id: "cfo-warn-closing",
        tier: "WARNING",
        ago: "live",
        description: `${opmsInWindow.length} pursuit${opmsInWindow.length === 1 ? "" : "s"} awaiting close · ${fmtMoney(opmsInWindowWeighted)} weighted at stake — review win odds and bid commitments before deadlines slip further.`,
        chip: "LIVE",
        metric: { label: "closing", value: fmtMoney(opmsInWindowWeighted), tone: "warn" },
        chips: [`${opmsInWindow.length} due`],
        detail: buildPipelineDetail(
          opmsInWindow,
          opmsInWindowWeighted,
          `Pipeline awaiting close`,
          `${opmsInWindow.length} opportunit${opmsInWindow.length === 1 ? "y" : "ies"} due`,
        ),
      });
    }
    // INSIGHT — pipeline overview with the weighting made explicit so the
    // number is self-explanatory: each pursuit counts at value × win chance.
    if (pipelineCount > 0) {
      opNotifications.push({
        id: "cfo-insight-pipeline",
        tier: "INSIGHT",
        ago: "live",
        description: pipelineWeighted > 0
          ? `${fmtMoney(pipelineWeighted)} weighted pipeline across ${pipelineCount} active bid${pipelineCount === 1 ? "" : "s"} not yet won or closed · each counted at contract value × win probability.`
          : `${pipelineCount} active bid${pipelineCount === 1 ? "" : "s"} not yet won or closed · weighted value shows $0 because win probabilities or contract values have not been entered on these opportunities.`,
        chip: "LIVE",
        metric: pipelineWeighted > 0
          ? { label: "weighted", value: fmtMoney(pipelineWeighted), tone: "good" as const }
          : { label: "data needed", value: `${pipelineCount} open`, tone: "warn" as const },
        detail: buildPipelineDetail(
          openOpms,
          pipelineWeighted,
          "Pipeline overview",
          `${pipelineCount} open opportunit${pipelineCount === 1 ? "y" : "ies"}`,
        ),
      });
    }
    // INSIGHT — client concentration (top client > 25% of active backlog)
    const clientValueMap: Record<string, number> = {};
    for (const r of activePmmRecords) {
      const client = String((r as any).CRMCompanyLookupName ?? (r as any).ClientName ?? (r as any).CompanyName ?? "");
      if (!client) continue;
      clientValueMap[client] = (clientValueMap[client] ?? 0) + getRecordValue(r);
    }
    const topClientEntry = Object.entries(clientValueMap).sort((a, b) => b[1] - a[1])[0];
    const activePmmValueTotal = activePmmRecords.reduce((s, r) => s + getRecordValue(r), 0);
    const topClientShare = topClientEntry && activePmmValueTotal > 0
      ? Math.round((topClientEntry[1] / activePmmValueTotal) * 100)
      : 0;
    if (topClientEntry && topClientShare >= 25) {
      opNotifications.push({
        id: "cfo-insight-concentration",
        tier: "INSIGHT",
        ago: "live",
        description: `${topClientEntry[0]} represents ${topClientShare}% of active portfolio value · ${fmtMoney(topClientEntry[1])} · client concentration risk.`,
        chip: "LIVE",
        metric: { label: "concentration", value: `${topClientShare}%`, tone: topClientShare >= 40 ? "bad" : "warn" },
        chips: [topClientEntry[0]],
      });
    }
    // (Closing-in-window info now lives in the WARNING above — no duplicate insight.)
  } else if (focus === "delivery") {
    // ── PM notifications: project schedule risk ──

    // CRITICAL — overdue projects
    if (pmmOverdue.length > 0) {
      const top = pmmOverdue[0];
      opNotifications.push({
        id: `pm-crit-overdue`,
        tier: "CRITICAL",
        ago: "live",
        description: pmmOverdue.length === 1
          ? `"${String(top.Title ?? top.TicketId ?? "Project")}" is past its target completion date.`
          : `${pmmOverdue.length} active project${pmmOverdue.length === 1 ? "" : "s"} past target date · avg ${avgPctComplete}% complete across portfolio.`,
        chip: "LIVE",
        metric: { label: "overdue", value: `${pmmOverdue.length}`, tone: "bad" },
        chips: pmmOverdue.length > 1 ? [`${pmmOverdue.length} overdue`] : undefined,
        detail: buildScheduleRiskDetail(pmmOverdue, "Overdue projects", `${pmmOverdue.length} past target date`),
      });
    }

    // WARNING — due soon + behind schedule
    if (pmmDueSoon.length > 0) {
      opNotifications.push({
        id: `pm-warn-due-soon`,
        tier: "WARNING",
        ago: "live",
        description: pmmBehind.length > 0
          ? `${pmmDueSoon.length} project${pmmDueSoon.length === 1 ? "" : "s"} due ahead · ${pmmBehind.length} below 50% complete.`
          : `${pmmDueSoon.length} project${pmmDueSoon.length === 1 ? "" : "s"} due ahead · avg ${avgPctComplete}% complete.`,
        chip: "LIVE",
        metric: pmmBehind.length > 0
          ? { label: "behind", value: `${pmmBehind.length}`, tone: "warn" as const }
          : { label: "due", value: `${pmmDueSoon.length}`, tone: "warn" as const },
        chips: [`${pmmDueSoon.length} due`],
        detail: buildScheduleRiskDetail(pmmDueSoon, `Projects due ahead`, `${pmmDueSoon.length} due · ${pmmBehind.length} below 50%`),
      });
    }

    // INSIGHT — portfolio progress
    if (pmmActive > 0) {
      opNotifications.push({
        id: "pm-insight-progress",
        tier: "INSIGHT",
        ago: "live",
        description: `Portfolio avg completion ${avgPctComplete}% across ${pmmActive} active project${pmmActive === 1 ? "" : "s"}.`,
        chip: "LIVE",
        metric: {
          label: "avg complete",
          value: `${avgPctComplete}%`,
          tone: avgPctComplete >= 75 ? "good" : avgPctComplete >= 50 ? "warn" : "bad",
        },
        chips: demandsCount > 0 ? [`${demandsCount} open demand${demandsCount === 1 ? "" : "s"}`] : undefined,
        detail: buildScheduleRiskDetail(
          [...activePmmRecords].sort((a, b) => (Number(b.PctComplete) || 0) - (Number(a.PctComplete) || 0)).slice(0, MAX_DETAIL_ROWS),
          "Portfolio completion", `Avg ${avgPctComplete}% complete across ${pmmActive} active projects`,
        ),
      });
    }

  } else if (focus === "operations") {
    // ── COO notifications: operational risk + coverage + pipeline ──

    // CRITICAL/WARNING — over-allocated resources in window
    const topOverNotif = overInWindow[0];
    if (topOverNotif) {
      const others = Math.max(0, overInWindow.length - 1);
      const projects = (topOverNotif.activeProjects ?? []).filter(Boolean);
      opNotifications.push({
        id: `coo-crit-${topOverNotif.id}`,
        tier: "CRITICAL",
        ago: "live",
        description: others > 0
          ? `${topOverNotif.name} projected at ${Math.round(topOverNotif.currentPct)}% utilization · +${others} other${others === 1 ? "" : "s"} over capacity.`
          : `${topOverNotif.name} projected at ${Math.round(topOverNotif.currentPct)}% utilization.`,
        chip: "LIVE",
        metric: { label: "utilization", value: `${Math.round(topOverNotif.currentPct)}%`, tone: "bad" },
        chips: projects.length > 0 ? projects.slice() : undefined,
        detail: buildOverAllocatedDetail(
          overInWindow.length > 0 ? overInWindow : resources,
          "Over-allocated",
          `${topOverNotif.name} projected at ${Math.round(topOverNotif.currentPct)}% utilization`,
        ),
      });
    }

    // WARNING — open demands (count chip; suppress $0 metric badge)
    if (demandsInWindow.length > 0) {
      opNotifications.push({
        id: "coo-warn-demands",
        tier: "WARNING",
        ago: "live",
        description: demandsInWindowValue > 0
          ? `${demandsInWindow.length} open staffing demand${demandsInWindow.length === 1 ? "" : "s"} unfilled · ${fmtMoney(demandsInWindowValue)} contract value at risk.`
          : `${demandsInWindow.length} open staffing demand${demandsInWindow.length === 1 ? "" : "s"} · role${demandsInWindow.length === 1 ? "" : "s"} unfilled · delivery timeline at risk.`,
        chip: "LIVE",
        metric: demandsInWindowValue > 0
          ? { label: "at risk", value: fmtMoney(demandsInWindowValue), tone: "warn" as const }
          : { label: "open", value: `${demandsInWindow.length}`, tone: "warn" as const },
        chips: [`${demandsInWindow.length} open`],
        detail: buildDemandsDetail(demandsInWindow, demandsInWindowValue),
      });
    } else if (!topOverNotif && bench >= 5) {
      opNotifications.push({
        id: "coo-warn-bench",
        tier: "WARNING",
        ago: "live",
        description: `Bench capacity climbing — ${bench} resource${bench === 1 ? "" : "s"} idle · consider utilization rebalance.`,
        chip: "LIVE",
        metric: { label: "idle", value: `${bench}`, tone: "warn" },
      });
    }

    // INSIGHT — portfolio demand coverage
    if (exposedPmm.length > 0) {
      const coveredCount = activePmmRecords.length - exposedPmm.length;
      const coveragePct = activePmmRecords.length > 0
        ? Math.round((coveredCount / activePmmRecords.length) * 100)
        : 100;
      opNotifications.push({
        id: "coo-insight-coverage",
        tier: "INSIGHT",
        ago: "live",
        description: `${coveredCount} of ${activePmmRecords.length} active project${activePmmRecords.length === 1 ? "" : "s"} have staffing on file · ${exposedPmm.length} without staffing data on file.`,
        chip: "LIVE",
        metric: { label: "coverage", value: `${coveragePct}%`, tone: coveragePct >= 80 ? "good" : "warn" },
        chips: [`${exposedPmm.length} unstaffed`],
        detail: buildExposedProjectsDetail(exposedPmm, exposedPmmValue, winNatProse),
      });
    }

    // INSIGHT — pipeline overview (always if data exists)
    if (pipelineCount > 0) {
      opNotifications.push({
        id: "coo-insight-pipeline",
        tier: "INSIGHT",
        ago: "live",
        description: `${pipelineCount} active bid${pipelineCount === 1 ? "" : "s"} not yet won or closed · ${fmtMoney(pipelineWeighted)} weighted · ${opmsInWindow.length > 0 ? `${opmsInWindow.length} due ahead` : `none due ahead`}.`,
        chip: "LIVE",
        metric: { label: "weighted", value: fmtMoney(pipelineWeighted), tone: pipelineWeighted > 0 ? "good" : "warn" },
        chips: opmsInWindow.length > 0 ? [`${opmsInWindow.length} due`] : undefined,
        detail: buildPipelineDetail(
          openOpms.length > 0 ? openOpms : opmsInWindow,
          pipelineWeighted,
          "Pipeline",
          `${pipelineCount} open opportunit${pipelineCount === 1 ? "y" : "ies"} · ${fmtMoney(pipelineWeighted)} weighted`,
        ),
      });
    }
  } else {
    // ── Staffing / Delivery notifications ──

    // CRITICAL — top over-allocated resource whose active allocations
    // overlap the chosen horizon.
    const topOverNotif = overInWindow[0];
    if (topOverNotif) {
      const others = Math.max(0, overInWindow.length - 1);
      const projects = (topOverNotif.activeProjects ?? []).filter(Boolean);
      const projectChips = projects.slice();
      opNotifications.push({
        id: `op-crit-${topOverNotif.id}`,
        tier: "CRITICAL",
        ago: "live",
        description: others > 0
          ? `${topOverNotif.name} projected at ${Math.round(topOverNotif.currentPct)}% utilization · +${others} other${others === 1 ? "" : "s"} over capacity.`
          : `${topOverNotif.name} projected at ${Math.round(topOverNotif.currentPct)}% utilization.`,
        chip: "LIVE",
        metric: {
          label: "utilization",
          value: `${Math.round(topOverNotif.currentPct)}%`,
          tone: "bad",
        },
        chips: projectChips.length > 0 ? projectChips : undefined,
        detail: buildOverAllocatedDetail(
          overInWindow.length > 0 ? overInWindow : resources,
          "Over-allocated",
          `${topOverNotif.name} projected at ${Math.round(topOverNotif.currentPct)}% utilization`,
        ),
      });
    }

    // WARNING — open staffing demands whose allocation period overlaps
    // the horizon. Falls back to bench drift only when no demands fall in window.
    if (demandsInWindow.length > 0) {
      opNotifications.push({
        id: "op-warn-demands",
        tier: "WARNING",
        ago: "live",
        description: `${demandsInWindow.length} open staffing demand${demandsInWindow.length === 1 ? "" : "s"} unfilled · ${fmtMoney(demandsInWindowValue)} contract value at risk.`,
        chip: "LIVE",
        metric: {
          label: "at risk",
          value: fmtMoney(demandsInWindowValue),
          tone: "warn",
        },
        chips: [`${demandsInWindow.length} open`],
        detail: buildDemandsDetail(demandsInWindow, demandsInWindowValue),
      });
    } else if (bench >= 5) {
      opNotifications.push({
        id: "op-warn-bench",
        tier: "WARNING",
        ago: "live",
        description: `Bench capacity climbing — ${bench} resource${bench === 1 ? "" : "s"} idle.`,
        chip: "LIVE",
        metric: { label: "idle", value: `${bench}`, tone: "warn" },
        detail: buildBenchDetail(resources),
      });
    }
  }

  // INSIGHT — pipeline opportunities whose bid-due / target-start lands
  // inside the horizon (for non-financial personas only).
  if (focus !== "financial" && opmsInWindow.length > 0) {
    opNotifications.push({
      id: "op-insight-pipeline",
      tier: "INSIGHT",
      ago: "live",
      description: `${opmsInWindow.length} pipeline opportunit${opmsInWindow.length === 1 ? "y" : "ies"} due · ${fmtMoney(opmsInWindowWeighted)} weighted value.`,
      chip: "LIVE",
      metric: {
        label: "weighted",
        value: fmtMoney(opmsInWindowWeighted),
        tone: "good",
      },
      chips: [`${opmsInWindow.length} due`],
      detail: buildPipelineDetail(
        opmsInWindow,
        opmsInWindowWeighted,
        `Pipeline awaiting close`,
        `${opmsInWindow.length} opportunit${opmsInWindow.length === 1 ? "y" : "ies"} due`,
      ),
    });
  } else if (win === "7d" && baseline && Math.abs(fcastDelta) > 1) {
    // 7-day view falls back to the week-over-week pipeline movement so
    // the INSIGHT row still has something useful to say.
    opNotifications.push({
      id: "op-insight-forecast",
      tier: "INSIGHT",
      ago: "live",
      description: `Pipeline weighted value ${fcastDelta > 0 ? "up" : "down"} ${signedMoney(fcastDelta).replace(/^[+−]/, "")} week-over-week.`,
      chip: "LIVE",
      metric: {
        label: "wow",
        value: signedMoney(fcastDelta),
        tone: fcastDelta > 0 ? "good" : "warn",
      },
      detail: buildPipelineDetail(
        openOpms.length > 0 ? openOpms : opmsInWindow,
        pipelineWeighted,
        `Pipeline overview`,
        `Weighted value ${fcastDelta > 0 ? "up" : "down"} ${signedMoney(fcastDelta).replace(/^[+−]/, "")} week-over-week`,
      ),
    });
  }

  // ── Hero de-duplication ──
  // The pinned hero at the top already tells one storyline; the alerts
  // list below must not repeat that same story as another row. Drop the
  // notification that retells the hero — unless dropping would empty the
  // list entirely (then keep the originals rather than show samples).
  const retellsHeroStory = (notifId: string, h: BriefingHero): boolean => {
    const ref = h.resolveRef?.refId ?? "";
    if (ref.startsWith("briefing:over-allocated")) {
      // Hero = top over-allocated resource; drop the CRITICAL
      // over-allocation notification that repeats the same person.
      return notifId.startsWith("op-crit-") || notifId.startsWith("coo-crit-");
    }
    if (ref.startsWith("briefing:open-demands")) {
      return notifId === "op-warn-demands" || notifId === "coo-warn-demands";
    }
    if (ref === "briefing:revenue-at-risk") {
      return notifId === "cfo-crit-revenue-at-risk";
    }
    if (ref === "briefing:pipeline") {
      return notifId === "cfo-warn-closing";
    }
    if (ref === "briefing:delivery-risk") {
      // COO delivery-risk hero = projects without demand coverage; the
      // coverage INSIGHT retells the same exposed-projects story.
      return notifId === "coo-insight-coverage";
    }
    if (ref.startsWith("briefing:schedule-risk")) {
      // PM hero leads with either the overdue or the due-soon storyline —
      // drop only the notification that mirrors the variant shown.
      return h.tagLabel.includes("OVERDUE")
        ? notifId === "pm-crit-overdue"
        : notifId === "pm-warn-due-soon";
    }
    return false;
  };
  const dedupedNotifications = opNotifications.filter(
    (n) => !retellsHeroStory(n.id, hero),
  );
  const displayNotifications =
    dedupedNotifications.length > 0 || opNotifications.length === 0
      ? dedupedNotifications
      : opNotifications;

  const realNotifsCount = displayNotifications.length;
  // No fabricated SAMPLE rows — an empty list renders an honest empty state
  // on the page instead of placeholder notifications dressed up as data.
  const notificationsAreSample = realNotifsCount === 0;
  const finalNotifications: BriefingNotification[] = displayNotifications;
  // Only CRITICAL/WARNING rows count as alerts — INSIGHT rows are context,
  // not something to fix, so they must not inflate the red alert badge.
  const alertCount = displayNotifications.filter((n) => n.tier !== "INSIGHT").length;
  const notificationsBadge =
    alertCount > 0 ? `${alertCount} ALERT${alertCount === 1 ? "" : "S"}` : "NO ALERTS";

  const composed: DailyBriefingData = {
    hero,
    scan: { subStat, kpis },
    changes: clippedChanges,
    changesHeading,
    changesBadge,
    changesAreSample: !baseline,
    notifications: finalNotifications,
    notificationsBadge,
    notificationsAreSample,
    fetchedAt: Date.now(),
    degraded: degradedSources.length > 0,
    degradedSources,
  };

  // Persist ONLY fully-live composes as the next open's instant-render seed
  // (hollow-cache rule: a degraded/partial briefing is never cached). A
  // rejected source lands in degradedSources, but a FULFILLED source can
  // still be a degraded payload — /resource-allocations survives a partial
  // DB failure by serving a names-only roster marked `_degraded` — so check
  // the payload markers too. Checked on all four core sources defensively.
  const anyPayloadDegraded = [alloc, pmm, opm, demand].some(
    (p) => Boolean((p as { _degraded?: unknown } | null)?._degraded),
  );
  if (degradedSources.length === 0 && !anyPayloadDegraded) {
    persistBriefingSeed({ v: 1, role, window: win, data: composed });
    // Keep the visible response independent from app-database latency. This
    // durable copy is what makes tomorrow's first open instant.
    void saveDailyBriefing(role, win, composed);
  }

  return composed;
}
