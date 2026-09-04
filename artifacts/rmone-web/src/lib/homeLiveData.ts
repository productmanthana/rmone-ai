// Live-data overlay for the role-aware home screen.
//
// Fetches real RM ONE data, runs it through buildHomeIntelligence (Phase-2
// full intelligence engine), and returns a LiveOverlay that RoleHome.tsx
// merges into its curated template. Sub-drivers, risks, and decisions all
// come from the live engine — curated SAMPLE rows are backfill only.

import {
  ArrowRightLeft,
  UserPlus,
  Briefcase,
  TrendingDown,
  FileSignature,
  DollarSign,
} from "lucide-react";
import {
  getResourceAllocations,
  getResourceDemands,
  getModuleRecords,
  getProjectList,
  getAlertsFeed,
  type ModuleRecord,
  type DemandItem,
  type LiveResourceProxy,
} from "./api";
import type { RolePersona } from "./roleResolver";
import type { RiskItem, WindowKey, ActionItem, SubDriver } from "./roleHomeData";
import { buildHomeIntelligence, ALL_TIME_DAYS, type ActionDetail } from "./homeIntelligence";

export type LiveSubValue = {
  value: number;
  tone: "good" | "warn";
  formulaDetail?: SubDriver["formulaDetail"];
};

// Non-null detail table (the underlying records behind a KPI tile).
type Detail = NonNullable<ActionDetail>;

// Raw records cached on the overlay so the action-modal popup can
// render the underlying rows behind each "live" recommended action.
// Populated only when the upstream call succeeds.
export type LiveActionRecords = {
  demands: DemandItem[];
  benchResources: LiveResourceProxy[];
  overAllocatedResources: LiveResourceProxy[];
  atRiskProjects: ModuleRecord[];
  atRiskPursuits: ModuleRecord[];
};

export type LiveOverlay = {
  liveSubs: Record<string, LiveSubValue>;
  liveSubRecords: Record<string, Detail>;
  liveRisks: RiskItem[];
  liveActions: ActionItem[];
  records: LiveActionRecords;
  generatedAt: number;
  /** True when one or more source API calls failed — the overlay was computed
   *  from incomplete data (e.g. only Open Positions available). A partial
   *  overlay is shown but never cached, and RoleHome schedules a silent
   *  refetch to replace it with a complete one. */
  partial?: boolean;
};

// Stable map from action kind → lucide icon. Covers both legacy overlay
// kinds (Rebalance / Staff / Review …) and buildHomeIntelligence decision
// categories (REBALANCE / STAFF / REVIEW …) so rehydration always works.
export const ACTION_ICON_BY_KIND: Record<string, ActionItem["Icon"]> = {
  Rebalance: ArrowRightLeft,
  Staff: UserPlus,
  Review: Briefcase,
  Pursue: TrendingDown,
  Reassign: FileSignature,
  REBALANCE: ArrowRightLeft,
  REASSIGN: FileSignature,
  STAFF: UserPlus,
  APPROVE: UserPlus,
  REVIEW: Briefcase,
  PURSUE: TrendingDown,
  ACCELERATE: TrendingDown,
  PRIORITIZE: Briefcase,
  DEFER: TrendingDown,
  BUDGET: DollarSign,
  RESOLVE: Briefcase,
  CONFIRM: Briefcase,
  HIRE: UserPlus,
  ADVANCE: TrendingDown,
  QUALIFY: TrendingDown,
};

// Re-attach non-serializable icon components to a freshly deserialized
// overlay (from sessionStorage). Falls back to ArrowRightLeft for any
// unexpected kind so we never render a bare object.
export function rehydrateOverlayIcons(overlay: LiveOverlay): LiveOverlay {
  if (!overlay || !Array.isArray(overlay.liveActions)) return overlay;
  return {
    ...overlay,
    liveActions: overlay.liveActions.map((a) => ({
      ...a,
      Icon:
        ACTION_ICON_BY_KIND[a.kind] ??
        ACTION_ICON_BY_KIND[a.kind.toUpperCase()] ??
        ArrowRightLeft,
    })),
  };
}

const EMPTY_RECORDS: LiveActionRecords = {
  demands: [],
  benchResources: [],
  overAllocatedResources: [],
  atRiskProjects: [],
  atRiskPursuits: [],
};

const EMPTY_OVERLAY: LiveOverlay = {
  liveSubs: {},
  liveSubRecords: {},
  liveRisks: [],
  liveActions: [],
  records: EMPTY_RECORDS,
  generatedAt: 0,
};

// The home screen no longer offers a day-window picker — every persona's
// live numbers aggregate the entire tenant regardless of date. WindowKey
// is kept only as an internal cache-bucket key (see roleHomeData.ts); it
// no longer maps to a real day count.
const WINDOW_DAYS: Record<WindowKey, number> = {
  "7d": ALL_TIME_DAYS,
  "30d": ALL_TIME_DAYS,
  "60d": ALL_TIME_DAYS,
  "90d": ALL_TIME_DAYS,
};

// Status text patterns that indicate an at-risk record (used for
// populating the legacy records.atRiskProjects/atRiskPursuits arrays).
const RISK_RE = /risk|delay|hold|issue|red|stop|escalat|over[- ]?budget|slip|behind/i;

function statusOf(r: ModuleRecord): string {
  const v =
    (r as Record<string, unknown>).CRMProjectStatusChoice ??
    (r as Record<string, unknown>).CRMOpportunityStatusChoice ??
    (r as Record<string, unknown>).LeadStatus ??
    (r as Record<string, unknown>).Status ??
    "";
  return typeof v === "string" ? v : String(v ?? "");
}

// Overall budget for one overlay fetch attempt. Must comfortably cover the
// cold-server path: the four source queries run in parallel against the
// remote RDS link and take 5-10 s each when the server caches are cold
// (login-time warming usually hides this, but not always — e.g. right after
// an api-server restart). 12 s proved too tight and produced "NO LIVE DATA".
const OVERLAY_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function fetchHomeOverlay(
  role: RolePersona,
  win: WindowKey,
  opts?: { username?: string },
): Promise<LiveOverlay> {
  return withTimeout(_fetchHomeOverlay(role, win, opts), OVERLAY_TIMEOUT_MS, EMPTY_OVERLAY);
}

/** Like fetchHomeOverlay but with a much longer budget (45 s).
 *  Used as a silent background fetch after both quick attempts fail so the
 *  home page updates without any loading state when the API eventually warms up. */
export async function fetchHomeOverlayPatient(
  role: RolePersona,
  win: WindowKey,
  opts?: { username?: string },
): Promise<LiveOverlay> {
  return withTimeout(_fetchHomeOverlay(role, win, opts), 45_000, EMPTY_OVERLAY);
}

async function _fetchHomeOverlay(
  role: RolePersona,
  win: WindowKey,
  opts?: { username?: string },
): Promise<LiveOverlay> {
  try {
    const windowDays = WINDOW_DAYS[win] ?? 60;

    // Timing diagnostics for the post-login splash — logs how long each
    // source call takes so slow logins can be attributed precisely.
    const t0 = Date.now();
    const timed = <T,>(label: string, p: Promise<T>): Promise<T> =>
      p.finally(() => console.log(`[splash] overlay source ${label}: ${Date.now() - t0}ms`));

    const [allocsRes, demandsRes, pmmRes, opmRes, pmIdsRes, alertsRes] = await Promise.all([
      timed("allocations", getResourceAllocations().catch((e) => { console.warn("[fetchHomeOverlay] allocations failed:", String(e)); return null; })),
      timed("demands", getResourceDemands().catch((e) => { console.warn("[fetchHomeOverlay] demands failed:", String(e)); return null; })),
      timed("PMM", getModuleRecords("PMM").catch((e) => { console.warn("[fetchHomeOverlay] PMM failed:", String(e)); return null; })),
      timed("OPM", getModuleRecords("OPM").catch((e) => { console.warn("[fetchHomeOverlay] OPM failed:", String(e)); return null; })),
      role === "PROJECT_MANAGER" && opts?.username
        ? timed("projectList", getProjectList(opts.username).catch(() => [] as string[]))
        : Promise.resolve<string[] | null>(null),
      // Alerts run in the same parallel batch (they used to run sequentially
      // AFTER the four data calls, eating several seconds of the budget).
      timed("alerts", getAlertsFeed().catch(() => null)),
    ]);
    console.log(`[splash] overlay sources all settled: ${Date.now() - t0}ms`);

    // If any core source failed, the intelligence below is computed from
    // incomplete data — flag the overlay so it is shown but never cached.
    const partial = !allocsRes || !demandsRes || !pmmRes || !opmRes;

    // Narrow PMM to the PM's own project list.
    // Default-deny: empty if the PM has no assigned projects.
    let pmmRecords: ModuleRecord[] = pmmRes?.data ?? [];
    if (role === "PROJECT_MANAGER") {
      if (!pmIdsRes || pmIdsRes.length === 0) {
        pmmRecords = [];
      } else {
        const ids = new Set(pmIdsRes.map(String));
        pmmRecords = pmmRecords.filter((r) =>
          ids.has(String((r as Record<string, unknown>).TicketId ?? "")),
        );
      }
    }

    // Run the Phase-2 intelligence engine on the live data.
    const tIntel = Date.now();
    const intel = buildHomeIntelligence(
      pmmRecords,
      opmRes?.data ?? [],
      [], // lem — not available in web app
      demandsRes?.data ?? [],
      windowDays,
      role,
      allocsRes,
    );
    console.log(`[splash] intelligence compute: ${Date.now() - tIntel}ms`);

    // Map sub-drivers → liveSubs (value/tone) + liveSubRecords (detail tables)
    const liveSubs: Record<string, LiveSubValue> = {};
    const liveSubRecords: Record<string, Detail> = {};
    for (const sd of intel.subDrivers) {
      // Skip sub-drivers explicitly marked unavailable — storing them would
      // cause the UI to treat value:0 as a live "0" instead of showing
      // "Not available yet".
      if (sd.available === false) continue;
      liveSubs[sd.label] = {
        value: sd.value ?? 0,
        tone: sd.tone ?? "good",
        formulaDetail: sd.formulaDetail,
      };
      if (sd.records) liveSubRecords[sd.label] = sd.records as Detail;
    }

    // Map risks: CRIT → high, WARN → med, INSIGHT → info
    const liveRisks: RiskItem[] = intel.risks.map((r) => ({
      tone:
        r.level === "CRIT"
          ? ("high" as const)
          : r.level === "WARN"
            ? ("med" as const)
            : ("info" as const),
      title: r.text,
      sub: r.detail,
      kind: r.kind,
      records: r.records ?? undefined,
      isLive: true,
    }));

    // Map decisions → liveActions (decision `detail` carried for modal popups)
    const liveActions: ActionItem[] = intel.decisions.map((d) => ({
      Icon: (ACTION_ICON_BY_KIND[d.category] ??
        ACTION_ICON_BY_KIND[String(d.category ?? "").toUpperCase()] ??
        Briefcase) as ActionItem["Icon"],
      kind: d.category,
      title: d.text,
      cta: d.cta,
      detail: d.detail ?? undefined,
      isLive: true,
    }));

    // Merge backend-derived alert rows (forecast shifts, exec approvals, etc.)
    // Fetched in the parallel batch above; failure is non-fatal.
    if (alertsRes) {
      for (const r of alertsRes.rows) {
        liveRisks.push({
          tone: r.tone,
          title: r.title,
          sub: r.sub,
          isLive: true,
          alertKey: r.alertKey,
          // Backend-attached per-record table (ai-escalation cards) — the
          // drill-down shows each record's real name instead of repeating
          // the card title on every row.
          records: r.records,
        } as RiskItem);
      }
    }

    // Legacy record arrays — used by buildActionDetail in RoleHome.tsx as
    // a fallback when action.detail is absent (e.g. curated SAMPLE rows).
    const opmRecords = opmRes?.data ?? [];
    const records: LiveActionRecords = {
      demands: demandsRes?.data ?? [],
      benchResources: (allocsRes?.resources ?? []).filter(
        (r) => ((r as { currentPct?: number }).currentPct ?? 0) === 0,
      ),
      overAllocatedResources: (allocsRes?.resources ?? []).filter(
        (r) => ((r as { currentPct?: number }).currentPct ?? 0) > 100,
      ),
      atRiskProjects: pmmRecords.filter((r) => RISK_RE.test(statusOf(r))),
      atRiskPursuits:
        role === "PROJECT_MANAGER"
          ? []
          : opmRecords.filter((r) => RISK_RE.test(statusOf(r))),
    };

    console.log(
      `[splash] overlay built: ${Date.now() - t0}ms total (partial=${partial}, subs=${Object.keys(liveSubs).length})`,
    );
    return {
      liveSubs,
      liveSubRecords,
      liveRisks,
      liveActions,
      records,
      generatedAt: Date.now(),
      partial,
    };
  } catch (e) {
    console.warn("[fetchHomeOverlay] failed:", String(e));
    return EMPTY_OVERLAY;
  }
}

/**
 * Lightweight count of "live operational signals" for the chat header pill.
 * Returns 0 on any failure so the UI falls back gracefully.
 */
export async function fetchSignalsCount(): Promise<number> {
  try {
    const [pmmRes, opmRes, demandsRes] = await Promise.all([
      getModuleRecords("PMM").catch(() => null),
      getModuleRecords("OPM").catch(() => null),
      getResourceDemands().catch(() => null),
    ]);
    const pmm = pmmRes?.data ?? [];
    const opm = opmRes?.data ?? [];
    const pmmRisk = pmm.filter((r) => RISK_RE.test(statusOf(r))).length;
    const opmRisk = opm.filter((r) => RISK_RE.test(statusOf(r))).length;
    const openSlots = demandsRes?.data?.length ?? 0;
    return pmmRisk + opmRisk + openSlots;
  } catch {
    return 0;
  }
}
