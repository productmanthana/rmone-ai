// Mobile mirror of the web home live-data overlay
// (artifacts/rmone-web/src/lib/homeLiveData.ts).
//
// Mobile home tab (app/(tabs)/index.tsx) is already wired to live RM ONE
// data via `buildHomeIntelligence` — every gauge/sub-driver/risk on the
// home is computed from real PMM/OPM/LEM/demand records. The one place
// still rendering curated mock content on mobile is the Alerts tab,
// which today reads from `ROLE_HOME_DATA` in `lib/roleHomeData.ts`.
//
// This module exposes `fetchHomeRisks(role)` for the alerts screen so
// it can prepend real at-risk records to the curated list and show a
// "SAMPLE" badge on rows that didn't come from live data.

import {
  getModuleRecords,
  getProjectList,
  getResourceAllocations,
  getResourceDemands,
  getAlertsFeed,
  type ModuleRecord,
} from "./api";
import type { RolePersona } from "./roleResolver";
import type { RiskItem } from "./roleHomeData";

const RISK_RE = /risk|delay|hold|issue|red|stop|escalat|over[- ]?budget|slip|behind/i;

// Drill-down record tables show the full matching set; safety cap only.
const MAX_DETAIL_ROWS = 500;

function statusOf(r: ModuleRecord): string {
  const v =
    r.CRMProjectStatusChoice ??
    r.CRMOpportunityStatusChoice ??
    r.LeadStatus ??
    r.Status ??
    "";
  return typeof v === "string" ? v : String(v ?? "");
}

function fieldStr(r: ModuleRecord, key: keyof ModuleRecord): string {
  const v = r[key];
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export type HomeLiveRisks = {
  liveRisks: RiskItem[];
  generatedAt: number;
};

const EMPTY: HomeLiveRisks = { liveRisks: [], generatedAt: 0 };

export async function fetchHomeRisks(
  role: RolePersona,
  opts?: { username?: string; limit?: number },
): Promise<HomeLiveRisks> {
  try {
    const limit = Math.max(1, Math.min(opts?.limit ?? 10, 25));
    const [pmmRes, opmRes, pmIdsRes, allocsRes, demandsRes] = await Promise.all([
      getModuleRecords("PMM").catch(() => null),
      getModuleRecords("OPM").catch(() => null),
      role === "PROJECT_MANAGER" && opts?.username
        ? getProjectList(opts.username).catch(() => [] as string[])
        : Promise.resolve<string[] | null>(null),
      getResourceAllocations().catch(() => null),
      getResourceDemands().catch(() => null),
    ]);

    let pmm: ModuleRecord[] = pmmRes?.data ?? [];
    // **Default-deny PM scoping**: if we couldn't resolve the PM's
    // project list (network error or no assignments yet), return an
    // empty set rather than leaking org-wide PMM data to a project-
    // scoped role.
    if (role === "PROJECT_MANAGER") {
      if (!pmIdsRes || pmIdsRes.length === 0) {
        pmm = [];
      } else {
        const ids = new Set(pmIdsRes.map(String));
        pmm = pmm.filter((r) => ids.has(fieldStr(r, "TicketId")));
      }
    }
    // OPM (pre-award pursuits) is not assigned via the project ticket
    // list, so exclude it for PROJECT_MANAGER to avoid showing live
    // risks outside the PM's scope.
    const opm = role === "PROJECT_MANAGER" ? [] : opmRes?.data ?? [];

    const liveRisks: RiskItem[] = [];

    // 1. Delivery risk warnings — PMM/OPM rows whose status text
    //    contains a risk keyword.
    const flagged = [...pmm, ...opm].filter((r) => RISK_RE.test(statusOf(r))).slice(0, 5);
    for (const r of flagged) {
      const ticket = fieldStr(r, "TicketId") || "—";
      const title = fieldStr(r, "Title") || fieldStr(r, "ShortName") || ticket;
      const status = statusOf(r) || "Risk flagged";
      liveRisks.push({
        tone: "high",
        title: `${ticket} — ${status}`,
        sub: title,
        isLive: true,
      });
    }

    // 2. Per-person utilization breaches — over-allocated resources
    //    (>100%). >120% = critical, 101-120% = warn.
    const overResources = (allocsRes?.resources ?? [])
      .filter((r) => (r.currentPct ?? 0) > 100)
      .sort((a, b) => (b.currentPct ?? 0) - (a.currentPct ?? 0))
      .slice(0, 5);
    for (const r of overResources) {
      const pct = Math.round(r.currentPct ?? 0);
      liveRisks.push({
        tone: pct > 120 ? "high" : "med",
        title: `${r.name} — over-allocated ${pct}%`,
        sub: `Utilization breach across ${r.totalProjects} project${r.totalProjects === 1 ? "" : "s"}`,
        isLive: true,
        records: {
          title: `${r.name} — over-allocated ${pct}%`,
          subtitle: `Utilization breach · ${r.role || "—"}`,
          columns: [
            { key: "name", label: "Resource" },
            { key: "user", label: "User" },
            { key: "role", label: "Role" },
            { key: "pct", label: "Current %", align: "right" as const },
            { key: "projects", label: "Total Projects", align: "right" as const },
          ],
          rows: [
            {
              name: r.name || "—",
              user: r.username || "—",
              role: r.role || "—",
              pct: `${pct}%`,
              projects: String(r.totalProjects ?? 0),
            },
          ],
        },
      });
    }

    // 3. Bench summary — 0% allocated resources.
    const benchResources = (allocsRes?.resources ?? []).filter((r) => (r.currentPct ?? 0) === 0);
    const benchCount = benchResources.length;
    if (benchCount >= 5) {
      liveRisks.push({
        tone: "med",
        title: `${benchCount} resources on bench`,
        sub: "Utilization below threshold — consider reassignment to open demand",
        isLive: true,
        records: {
          title: `${benchCount} resources on bench`,
          subtitle: "Utilization below threshold — consider reassignment to open demand",
          columns: [
            { key: "name", label: "Resource" },
            { key: "user", label: "User" },
            { key: "role", label: "Role" },
            { key: "pct", label: "Current %", align: "right" as const },
            { key: "lastActive", label: "Last active" },
          ],
          rows: benchResources.slice(0, MAX_DETAIL_ROWS).map((r) => ({
            name: r.name || "—",
            user: r.username || "—",
            role: r.role || "—",
            pct: `${r.currentPct ?? 0}%`,
            lastActive: r.lastActiveDate ? r.lastActiveDate.slice(0, 10) : "—",
          })),
        },
      });
    }

    // 4. Proposal staffing exposure — open demand slots aggregated.
    const openDemandCount = demandsRes?.data?.length ?? 0;
    if (openDemandCount >= 5) {
      liveRisks.push({
        tone: openDemandCount > 50 ? "high" : "med",
        title: `${openDemandCount} open staffing demand${openDemandCount === 1 ? "" : "s"}`,
        sub: "Proposal & active-project staffing exposure",
        isLive: true,
        records: {
          title: `${openDemandCount} open staffing demand${openDemandCount === 1 ? "" : "s"}`,
          subtitle: "Proposal & active-project staffing exposure",
          columns: [
            { key: "ticket", label: "Ticket" },
            { key: "title", label: "Project" },
            { key: "role", label: "Role needed" },
            { key: "pct", label: "Allocation %", align: "right" as const },
            { key: "start", label: "Target start" },
          ],
          rows: (demandsRes?.data ?? []).slice(0, MAX_DETAIL_ROWS).map((d) => ({
            ticket: d.TicketId,
            title: d.Title || "—",
            role: d.Role || "—",
            pct: d.PctAllocation != null ? `${Math.round(d.PctAllocation)}%` : "—",
            start: d.AllocationStartDate
              ? d.AllocationStartDate.slice(0, 10)
              : (d.TargetStartDate?.slice(0, 10) ?? "—"),
          })),
        },
      });
    }

    // 5 & 6. Schedule conflicts (overdue) and operational deadline
    // reminders (due within 14 days).
    const nowMs = Date.now();
    const fortnightMs = 14 * 24 * 60 * 60 * 1000;
    const isClosed = (r: ModuleRecord) =>
      String(fieldStr(r, "Closed" as keyof ModuleRecord)).toLowerCase() === "true";
    const overdue = pmm
      .filter((r) => {
        if (isClosed(r)) return false;
        const t = Date.parse(fieldStr(r, "TargetCompletionDate" as keyof ModuleRecord));
        return Number.isFinite(t) && t < nowMs;
      })
      .slice(0, 3);
    for (const r of overdue) {
      const ticket = fieldStr(r, "TicketId" as keyof ModuleRecord) || "—";
      const title =
        fieldStr(r, "Title" as keyof ModuleRecord) ||
        fieldStr(r, "ShortName" as keyof ModuleRecord) ||
        "Overdue delivery";
      const target = fieldStr(r, "TargetCompletionDate" as keyof ModuleRecord).slice(0, 10) || "—";
      const status = statusOf(r) || "—";
      liveRisks.push({
        tone: "high",
        title: `${ticket} — past target completion date`,
        sub: title,
        isLive: true,
        records: {
          title: `${ticket} — past target completion date`,
          subtitle: title,
          columns: [
            { key: "ticket", label: "Project" },
            { key: "title", label: "Title" },
            { key: "status", label: "Status" },
            { key: "target", label: "Target completion" },
          ],
          rows: [{ ticket, title, status, target }],
        },
      });
    }
    const upcoming = pmm
      .filter((r) => {
        if (isClosed(r)) return false;
        const t = Date.parse(fieldStr(r, "TargetCompletionDate" as keyof ModuleRecord));
        return Number.isFinite(t) && t > nowMs && t - nowMs <= fortnightMs;
      })
      .slice(0, 3);
    for (const r of upcoming) {
      const ticket = fieldStr(r, "TicketId" as keyof ModuleRecord) || "—";
      const t = Date.parse(fieldStr(r, "TargetCompletionDate" as keyof ModuleRecord));
      const daysLeft = Math.max(1, Math.ceil((t - nowMs) / (24 * 60 * 60 * 1000)));
      const title =
        fieldStr(r, "Title" as keyof ModuleRecord) ||
        fieldStr(r, "ShortName" as keyof ModuleRecord) ||
        "Operational deadline";
      const target = fieldStr(r, "TargetCompletionDate" as keyof ModuleRecord).slice(0, 10) || "—";
      const status = statusOf(r) || "—";
      liveRisks.push({
        tone: daysLeft <= 7 ? "med" : "info",
        title: `${ticket} — due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
        sub: title,
        isLive: true,
        records: {
          title: `${ticket} — due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
          subtitle: title,
          columns: [
            { key: "ticket", label: "Project" },
            { key: "title", label: "Title" },
            { key: "status", label: "Status" },
            { key: "target", label: "Target completion" },
            { key: "daysLeft", label: "Days left", align: "right" as const },
          ],
          rows: [{ ticket, title, status, target, daysLeft: String(daysLeft) }],
        },
      });
    }

    // Merge backend-derived alert rows (forecast shifts #8, exec
    // approvals #13, AI escalations #10) from /api/alerts/feed.
    try {
      const backend = await getAlertsFeed();
      for (const r of backend.rows) {
        liveRisks.push({
          tone: r.tone,
          title: r.title,
          sub: r.sub,
          isLive: true,
          alertKey: r.alertKey,
        } as RiskItem);
      }
    } catch {
      /* non-fatal */
    }

    // Cap to the requested limit (alerts page passes ~10).
    return { liveRisks: liveRisks.slice(0, limit), generatedAt: Date.now() };
  } catch {
    return EMPTY;
  }
}

/**
 * Lightweight count of "live operational signals" the AI is monitoring,
 * for the chat header pill (LIVE · N SIGNALS). Counts at-risk PMM/OPM
 * records + open demand slots — same definition as the web adapter so
 * web and mobile show the same number for the same tenant. Returns 0
 * on any failure so the UI falls back to a plain "LIVE" pill instead
 * of showing a misleading number.
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
