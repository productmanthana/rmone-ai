/**
 * Alerts route — backs items #8, #9, #10, #13 of the operational-
 * intelligence detector list.
 *
 * Design choice: lazy-on-read instead of a scheduled job. The first
 * request of each calendar day computes a snapshot (writes to
 * forecast_snapshots) and runs the AI escalation scan (writes to
 * ai_escalations). Subsequent requests within the same day are
 * served from the cached rows. This avoids needing a long-lived
 * service token or background scheduler, and the first request still
 * returns in ~1-2s because it only adds two RM ONE reads + one OpenAI
 * call to the existing fetch path.
 *
 * Endpoints:
 *   GET    /api/alerts/feed         → merged alert rows (forecast diff,
 *                                     exec approvals, AI escalations,
 *                                     unresolved-from-yesterday)
 *   POST   /api/alerts/state        → upsert resolve/dismiss/snooze
 *   GET    /api/alerts/state        → list current state for caller
 *
 * Required headers:
 *   Authorization: Bearer <rmone-token>
 *   x-rmone-tenant: <tenant>           (echoed from /token response)
 *   x-rmone-user-guid: <user-guid>     (from /profile response)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { openai, openaiConfigured } from "../lib/openai-client.js";
import {
  getForecastSnapshot,
  upsertForecastSnapshot,
  getForecastHistory,
  getAiEscalations,
  replaceAiEscalationsAtomic,
  getAlertStatesByUser,
  upsertAlertState,
  type ForecastSnapshot,
  type AiEscalation,
} from "@workspace/db";
import { isValidSessionToken } from "./rmone-proxy.js";
import { getBusinessRulesForTenant } from "../lib/business-rules.js";
import { allocationsDirtyAt } from "../lib/financial-cache.js";
import { tenantLabelToTid } from "../lib/rds-provider.js";
import { boundedAuditChanges, setAuditTarget, setTrustedAuditChanges } from "../lib/auditTrail.js";
import {
  forecastWindow,
  summarizeWindowedUtilization,
  windowedPctForResource,
  hasAllocationSignal,
  countDemandPositions,
  type ResourceLike,
} from "@workspace/alloc-math";

const router: IRouter = Router();
const SELF_BASE = `http://127.0.0.1:${process.env.PORT || "8080"}/api/rmone`;

const RISK_RE = /risk|delay|hold|issue|red|stop|escalat|over[- ]?budget|slip|behind/i;

// Trim a card summary to max chars WITHOUT cutting a ticket ID in half — a
// hard slice can clip "OPM-00424" to "OPM-004", which still looks like a
// valid ID to the client parsers and links to a nonexistent record. Cut at
// the last comma boundary instead.
const clipSummary = (s: string, max = 500): string => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const comma = cut.lastIndexOf(", ");
  return (comma > 0 ? cut.slice(0, comma) : cut) + " …";
};

// ──────────────────────────────────────────────────────────────────
// Session resolution
// ──────────────────────────────────────────────────────────────────

interface SessionMeta {
  bearer: string;
  tenant: string;
  userGuid: string;
}

async function requireSession(req: Request, res: Response): Promise<SessionMeta | null> {
  const auth = req.headers.authorization ?? "";
  const tenant = String(req.headers["x-rmone-tenant"] ?? "").trim();
  const userGuid = String(req.headers["x-rmone-user-guid"] ?? "").trim();
  if (!auth) {
    res.status(401).json({ error: "Missing Authorization header" });
    return null;
  }
  if (!tenant) {
    res.status(400).json({ error: "Missing x-rmone-tenant header" });
    return null;
  }
  const token = auth.replace(/^bearer\s+/i, "").trim();
  const ok = await isValidSessionToken(token).catch(() => false);
  if (!ok) {
    res.status(401).json({ error: "Invalid or expired session" });
    return null;
  }
  return { bearer: auth, tenant, userGuid };
}

// ──────────────────────────────────────────────────────────────────
// Self-fetch helpers (call our own /api/rmone/* with caller's bearer)
// ──────────────────────────────────────────────────────────────────

async function selfGet<T>(path: string, bearer: string): Promise<T | null> {
  try {
    const r = await fetch(`${SELF_BASE}${path}`, {
      headers: { Authorization: bearer, Accept: "application/json" },
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

interface ModuleRecord { [k: string]: unknown }
interface ModuleResp { data?: ModuleRecord[]; total?: number }
interface DemandResp { data?: Array<{ [k: string]: unknown; ApproxContractValue?: number }>; total?: number }
interface AllocationsResp {
  total?: number; bench?: number; overAllocated?: number;
  resources?: Array<{
    [k: string]: unknown;
    id?: string; name?: string; currentPct?: number; totalProjects?: number;
    activeAllocations?: Array<{ projectId?: string; projectName?: string }>;
    allAllocations?: Array<{ projectId?: string; projectName?: string }>;
  }>;
}

const fieldStr = (r: ModuleRecord, k: string): string => {
  const v = r[k];
  return typeof v === "string" ? v : v == null ? "" : String(v);
};
const fieldNum = (r: ModuleRecord, k: string): number => {
  const v = r[k];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const statusOf = (r: ModuleRecord) =>
  fieldStr(r, "CRMProjectStatusChoice") ||
  fieldStr(r, "CRMOpportunityStatusChoice") ||
  fieldStr(r, "Status") ||
  "";

// ──────────────────────────────────────────────────────────────────
// Snapshot computation (#8 backing data)
// ──────────────────────────────────────────────────────────────────

function startOfUtcDay(d = new Date()): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

// In-process per-tenant promise cache. When several concurrent
// requests for the same tenant land on the API server before today's
// snapshot / AI scan finishes, we coalesce them onto a single
// in-flight promise instead of each one independently fetching from
// upstream RM ONE and (worse) hitting OpenAI multiple times. Cleared
// once the promise settles so the next day re-runs normally.
const _snapshotInFlight = new Map<string, Promise<ForecastSnapshot | null>>();
const _aiInFlight = new Map<string, Promise<AiEscalation[]>>();

async function ensureTodaySnapshot(meta: SessionMeta): Promise<ForecastSnapshot | null> {
  const key = meta.tenant;
  const cached = _snapshotInFlight.get(key);
  if (cached) return cached;
  const p = _ensureTodaySnapshotImpl(meta).finally(() => {
    _snapshotInFlight.delete(key);
  });
  _snapshotInFlight.set(key, p);
  return p;
}

async function _ensureTodaySnapshotImpl(meta: SessionMeta): Promise<ForecastSnapshot | null> {
  const today = startOfUtcDay();
  const existing = await getForecastSnapshot(meta.tenant, today);
  if (existing) return existing;

  const [pmm, opm, demands, allocs] = await Promise.all([
    selfGet<ModuleResp>("/records/PMM", meta.bearer),
    selfGet<ModuleResp>("/records/OPM", meta.bearer),
    selfGet<DemandResp>("/resource-demands", meta.bearer),
    selfGet<AllocationsResp>("/resource-allocations", meta.bearer),
  ]);

  // A degraded read (any core feed failed) must NOT persist a baseline —
  // zeros written today poison "since yesterday" deltas for days after.
  if (!pmm || !opm || !demands || !allocs) {
    console.warn("[alerts] snapshot skipped — degraded feed(s):", meta.tenant);
    return null;
  }

  const opmRows = opm?.data ?? [];
  const pmmRows = pmm?.data ?? [];
  const demandRows = demands?.data ?? [];
  const resources = (allocs?.resources ?? []) as unknown as ResourceLike[];

  // An allocations feed with resources but ZERO allocation rows anywhere is
  // either a brand-new tenant or a partial read — same poisoning risk.
  if (!hasAllocationSignal(resources)) {
    console.warn("[alerts] snapshot skipped — no allocation signal:", meta.tenant);
    return null;
  }

  const pipelineValue = opmRows.reduce(
    (s, r) => s + fieldNum(r, "ApproxContractValue"),
    0,
  );
  const backlogValue = pmmRows.reduce(
    (s, r) => s + fieldNum(r, "ApproxContractValue"),
    0,
  );

  // Windowed utilization over the tenant's rolling forecast window using the
  // admin-tuned thresholds — same shared math (lib/alloc-math) as the web
  // Resources page and Daily Briefing, so counts agree across surfaces.
  // (The feed's raw currentPct means "allocated TODAY", which reads ~0% for
  // portfolios whose weekly rows live in the past/future.)
  const rules = await getBusinessRulesForTenant(meta.tenant);
  const fw = forecastWindow(rules.forecastWeeks);
  const util = summarizeWindowedUtilization(
    resources,
    fw.startMs,
    fw.endMs,
    rules,
    rules.workWeekHours,
  );

  try {
    return await upsertForecastSnapshot({
      tenant: meta.tenant,
      snapshotDate: today,
      revenuePipeline: pipelineValue,
      pipelineCount: opmRows.length,
      revenueBacklog: backlogValue,
      backlogCount: pmmRows.length,
      // Distinct open positions (TicketId+Role), not raw weekly demand rows.
      openDemandCount: countDemandPositions(demandRows),
      benchCount: util.bench,
      overAllocatedCount: util.overloaded,
      utilizationPct: util.avgUtilization,
    });
  } catch (e) {
    console.warn("[alerts] snapshot insert failed:", String(e));
    return null;
  }
}

interface ForecastDiff {
  label: string;
  delta: number;
  pct: number;
  direction: "up" | "down" | "flat";
  /** Current value (today's snapshot). */
  cur: number;
  /** Baseline value (most recent prior-day snapshot). */
  prev: number;
  /** Date of the baseline snapshot the delta is measured against. */
  baselineDate: Date;
}

// Matched again in the /feed loop to attach the per-person drill-down
// table to this trend row — keep both sites on one constant.
const OVER_ALLOC_DIFF_LABEL = "Over-allocated staff";

async function forecastDiffs(meta: SessionMeta): Promise<ForecastDiff[]> {
  const today = await ensureTodaySnapshot(meta);
  if (!today) return [];
  // Baseline = the most recent snapshot from a PRIOR calendar day.
  // Deltas are only reported when a genuine earlier snapshot exists —
  // a tenant's first day (or a fresh data import with no history) must
  // produce NO movement alerts, never "+100% vs zero" noise.
  const history = await getForecastHistory(
    meta.tenant,
    new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
  );
  const todayTime = today.snapshotDate.getTime();
  const baseline = history
    .filter((r) => r.id !== today.id && r.snapshotDate.getTime() < todayTime)
    .sort((a, b) => b.snapshotDate.getTime() - a.snapshotDate.getTime())[0];
  if (!baseline) return [];

  const mk = (label: string, cur: number, prev: number): ForecastDiff | null => {
    // No meaningful baseline (metric was zero / not yet tracked) —
    // suppress rather than fabricate an infinite percentage.
    if (!(prev > 0)) return null;
    const delta = cur - prev;
    if (Math.abs(delta) < 1) return null;
    const pct = (delta / prev) * 100;
    // Materiality gate: day-over-day drift under 5% is normal churn on a
    // construction portfolio, not an alert.
    if (Math.abs(pct) < 5) return null;
    return {
      label,
      delta,
      pct,
      direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
      cur,
      prev,
      baselineDate: baseline.snapshotDate,
    };
  };
  return [
    mk("Bid pipeline value", today.revenuePipeline ?? 0, baseline.revenuePipeline ?? 0),
    mk("Awarded backlog value", today.revenueBacklog ?? 0, baseline.revenueBacklog ?? 0),
    mk("Unfilled positions", today.openDemandCount, baseline.openDemandCount),
    mk("Bench headcount", today.benchCount, baseline.benchCount),
    mk(OVER_ALLOC_DIFF_LABEL, today.overAllocatedCount, baseline.overAllocatedCount),
  ].filter((d): d is ForecastDiff => d !== null);
}

// ──────────────────────────────────────────────────────────────────
// Exec approvals (#13) — derived live from PMM/OPM StageActionUsersUser
// ──────────────────────────────────────────────────────────────────

interface ApprovalRow { ticket: string; title: string; module: "PMM" | "OPM"; stage: string }

async function execApprovals(meta: SessionMeta): Promise<ApprovalRow[]> {
  if (!meta.userGuid) return [];
  const [pmm, opm] = await Promise.all([
    selfGet<ModuleResp>("/records/PMM", meta.bearer),
    selfGet<ModuleResp>("/records/OPM", meta.bearer),
  ]);
  const guid = meta.userGuid.toLowerCase();
  const out: ApprovalRow[] = [];
  for (const [rows, moduleKey] of [
    [pmm?.data ?? [], "PMM" as const],
    [opm?.data ?? [], "OPM" as const],
  ] as const) {
    for (const r of rows) {
      const users = fieldStr(r, "StageActionUsersUser");
      if (!users) continue;
      if (!users.toLowerCase().includes(guid)) continue;
      out.push({
        ticket: fieldStr(r, "TicketId") || "—",
        title: fieldStr(r, "Title") || fieldStr(r, "ShortName") || "—",
        module: moduleKey,
        stage: fieldStr(r, "ModuleStepLookup") || statusOf(r) || "Pending",
      });
      if (out.length >= 10) return out;
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// AI escalations (#10) — once per tenant per day, regenerated intraday
// when allocation data changes MATERIALLY.
//
// Freshness gate: every allocation/flag write path busts the financial
// cache (lib/financial-cache.ts), which stamps a per-tenant dirty
// marker. When the marker postdates today's cards, we recompute the
// SAME deterministic over-allocation set the cards were built from and
// compare fingerprints — only a material change (someone enters/leaves
// the >110% window set, or a rounded pct moves) retires today's cards
// and pays for a regeneration. Hours shuffled below thresholds keep the
// existing cards with zero LLM cost.
// ──────────────────────────────────────────────────────────────────

/** Over-allocated resources under the SAME shared windowed math as the
 *  snapshot builder and the web surfaces (lib/alloc-math over the tenant's
 *  rolling forecast window). The feed's raw currentPct is "allocated TODAY"
 *  and sums stacked container + weekly rows, which produced impossible
 *  figures (171%, 318%) that disagreed with the Timeline popup. */
async function computeOverAllocAll(meta: SessionMeta, allocs: AllocationsResp | null) {
  const escRules = await getBusinessRulesForTenant(meta.tenant);
  const escWin = forecastWindow(escRules.forecastWeeks);
  return (allocs?.resources ?? [])
    .map((r) => ({
      ...r,
      currentPct: windowedPctForResource(
        r as unknown as ResourceLike,
        escWin.startMs,
        escWin.endMs,
        escRules.workWeekHours,
      ),
    }))
    .filter((r) => (r.currentPct ?? 0) > 110)
    .sort((a, b) => (b.currentPct ?? 0) - (a.currentPct ?? 0));
}

/** Order-independent digest of the over-allocation set (stable resource id +
 *  rounded pct — two distinct people can share a display name, so names alone
 *  could mask one person leaving the set while a namesake enters). Stored in
 *  each card's payload; compared on read to detect staleness. Cards holding an
 *  older name-based digest simply compare unequal once and regenerate. */
const allocFingerprintOf = (list: Array<{ id?: string; name?: string; currentPct?: number }>): string =>
  list
    .map(
      (r) =>
        `${String(r.id ?? "").trim() || String(r.name ?? "").trim()}:${Math.round(r.currentPct ?? 0)}`,
    )
    .sort()
    .join("|");

// Per-worker memo: the allocations-dirty marker value the last successful
// verification/regeneration COVERED for this tenant. Freshness compares the
// live marker against this — never against wall-clock "now" or the cards'
// generated_at: a write that lands while a verify fetch (or a regeneration's
// source read) is in flight must leave the marker ahead of the memo so the
// next read re-verifies instead of trusting pre-write data forever.
const _aiCoveredMarker = new Map<string, number>();

async function todayCardsStillFresh(meta: SessionMeta, todayRows: AiEscalation[]): Promise<boolean> {
  const dirtyAt = allocationsDirtyAt(tenantLabelToTid(meta.tenant));
  if (dirtyAt === 0) return true; // no allocation writes seen since worker start
  if (dirtyAt <= (_aiCoveredMarker.get(meta.tenant) ?? 0)) return true; // verified past this write already
  const stored = todayRows
    .map((r) => (r.payload as Record<string, unknown> | null)?.allocFingerprint)
    .find((v): v is string => typeof v === "string");
  // Capture the marker value this verification will cover BEFORE fetching —
  // a write landing mid-fetch advances the marker past it, forcing re-verify.
  const covering = dirtyAt;
  const allocs = await selfGet<AllocationsResp>("/resource-allocations", meta.bearer);
  if (!allocs) return true; // degraded read — never retire cards off a failed fetch
  const fp = allocFingerprintOf(await computeOverAllocAll(meta, allocs));
  if (stored === fp) {
    _aiCoveredMarker.set(meta.tenant, covering);
    return true;
  }
  console.log(
    `[alerts] escalation cards stale for ${meta.tenant} — over-allocation set changed, regenerating`,
  );
  return false;
}

/** Commit a regeneration through the cluster-safe atomic replace (applock in
 *  lib/db). Lock busy → another worker is mid-replacement: keep serving the
 *  rows this read started with (one more stale response, self-heals on the
 *  next read). Superseded → a sibling already wrote a set at least as fresh
 *  as our source read; serve theirs. Only a committed replacement (or a
 *  fingerprint match in todayCardsStillFresh) advances the covered-marker
 *  memo. */
async function finishReplace(
  meta: SessionMeta,
  since: Date,
  regenStart: Date,
  coveringMarker: number,
  todayRows: AiEscalation[],
  rows: Parameters<typeof replaceAiEscalationsAtomic>[3],
): Promise<AiEscalation[]> {
  try {
    const res = await replaceAiEscalationsAtomic(meta.tenant, since, regenStart, rows);
    if (!res.acquired) {
      console.log(
        `[alerts] escalation replace busy for ${meta.tenant} — another worker is regenerating`,
      );
      return todayRows;
    }
    if (res.superseded) return res.rows;
    _aiCoveredMarker.set(meta.tenant, coveringMarker);
    return res.rows;
  } catch (e) {
    console.warn("[alerts] AI escalation replace failed:", String(e));
    return todayRows; // keep whatever exists; the next feed read retries
  }
}

async function ensureAiEscalations(meta: SessionMeta): Promise<AiEscalation[]> {
  const key = meta.tenant;
  const cached = _aiInFlight.get(key);
  if (cached) return cached;
  const p = _ensureAiEscalationsImpl(meta).finally(() => {
    _aiInFlight.delete(key);
  });
  _aiInFlight.set(key, p);
  return p;
}

async function _ensureAiEscalationsImpl(meta: SessionMeta): Promise<AiEscalation[]> {
  // Serve today's cards unless allocation data changed materially after they
  // were written (todayCardsStillFresh — see the freshness-gate note above).
  const since = startOfUtcDay();
  const todayRows = await getAiEscalations(meta.tenant, since);
  if (todayRows.length > 0 && (await todayCardsStillFresh(meta, todayRows))) {
    return todayRows;
  }

  // Generate now. Use a small rule-based pre-filter then ask OpenAI to
  // summarize the top items into 1-3 escalation cards. Capture the dirty
  // marker BEFORE reading sources (finishReplace memoizes it only on commit,
  // so a write landing during generation forces re-verification next read)
  // and the wall-clock start (the atomic replace treats sibling rows stamped
  // after it as fresher — see replaceAiEscalationsAtomic).
  const coveringMarker = allocationsDirtyAt(tenantLabelToTid(meta.tenant));
  const regenStart = new Date();
  const [pmm, opm, allocs] = await Promise.all([
    selfGet<ModuleResp>("/records/PMM", meta.bearer),
    selfGet<ModuleResp>("/records/OPM", meta.bearer),
    selfGet<AllocationsResp>("/resource-allocations", meta.bearer),
  ]);
  // Honesty guard: never fabricate cards (or an "all clear" sentinel) from
  // failed reads. Keep whatever exists; a fully failed fresh run contributes
  // no rows today and retries on the next feed request. Stale cards are
  // retired only inside the atomic replace, with replacement rows in hand —
  // new card IDs mean dismissals of the retired cards are deliberately
  // forgotten (the new card describes a different situation and must be seen).

  // Full flagged set — do NOT cap at a handful, or the AI writes cards citing
  // 8 records while the live Pipeline page counts 23 with the same status.
  const flaggedAll = [...(pmm?.data ?? []), ...(opm?.data ?? [])].filter((r) =>
    RISK_RE.test(statusOf(r)),
  );
  // Exact totals per status so the card can state the real portfolio count.
  const statusTotals: Record<string, number> = {};
  for (const r of flaggedAll) {
    const s = statusOf(r) || "Unknown";
    statusTotals[s] = (statusTotals[s] || 0) + 1;
  }
  const flagged = flaggedAll
    .slice(0, 60)
    .map((r) => ({
      ticket: fieldStr(r, "TicketId"),
      title: fieldStr(r, "Title") || fieldStr(r, "ShortName"),
      status: statusOf(r),
    }));
  // Ticket → { name, status } for EVERY flagged record (not just the 60
  // prompt examples). Stored in each card's payload so /feed can attach a
  // per-record table with real names — the drill-down panel shows the
  // opportunity/project name instead of repeating the card title per row.
  const recordIndex: Record<string, { name: string; status: string }> = {};
  for (const r of flaggedAll) {
    const t = fieldStr(r, "TicketId");
    if (!t) continue;
    recordIndex[t] = {
      name: fieldStr(r, "Title") || fieldStr(r, "ShortName") || "",
      status: statusOf(r) || "",
    };
  }
  const overAllocAll = await computeOverAllocAll(meta, allocs);
  const escFp = allocFingerprintOf(overAllocAll);
  const overAlloc = overAllocAll
    .slice(0, 5)
    .map((r) => ({ name: r.name ?? "", pct: Math.round(r.currentPct ?? 0), projects: r.totalProjects ?? 0 }));
  // Person → projects index for EVERY over-allocated resource (not just
  // the 5 prompt examples). Stored in each card's payload so /feed can
  // attach a one-row-per-person table showing each person's real projects
  // — the drill-down must never collapse several people into a single
  // paragraph row. Active allocations are the cause of today's overload;
  // fall back to all allocations only when the active list is empty.
  const personIndex = overAllocAll
    .map((r) => {
      const src =
        Array.isArray(r.activeAllocations) && r.activeAllocations.length > 0
          ? r.activeAllocations
          : Array.isArray(r.allAllocations)
            ? r.allAllocations
            : [];
      const seen = new Set<string>();
      const projects: Array<{ ticket: string; name: string }> = [];
      for (const a of src) {
        const t = String(a?.projectId ?? "").trim();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        projects.push({ ticket: t, name: String(a?.projectName ?? "").trim() });
      }
      return { name: String(r.name ?? ""), pct: Math.round(r.currentPct ?? 0), projects };
    })
    .filter((p) => p.name);

  if (flagged.length === 0 && overAlloc.length === 0) {
    // "All clear" sentinel so we don't re-run today (committed atomically).
    return finishReplace(meta, since, regenStart, coveringMarker, todayRows, [
      {
        tenant: meta.tenant,
        role: null,
        userGuid: null,
        severity: "info",
        title: "Overnight scan complete — no escalations",
        summary: "No risk-flagged projects and no resources over 110% utilization were detected.",
        payload: { flagged: 0, overAlloc: 0, allocFingerprint: escFp } as Record<string, unknown>,
        status: "open",
        generatedAt: new Date(),
        expiresAt: null,
      },
    ]);
  }

  let cards: Array<{ severity: "high" | "med" | "info"; title: string; summary: string }> = [];
  try {
    if (openaiConfigured()) {
      const prompt = [
        "You are an operations analyst reviewing today's RM ONE signals.",
        "Produce 1-3 short escalation cards (JSON array of {severity, title, summary}).",
        "severity ∈ {high, med, info}. title <= 80 chars. summary <= 400 chars.",
        "Focus on the most urgent items. Be specific (cite ticket IDs / names).",
        "",
        "🔴 ANTI-HALLUCINATION RULES (strict):",
        "- Only cite project IDs, names, dollar amounts, percentages, dates, and people that appear VERBATIM in the data blocks below. Do NOT invent any.",
        "- Do NOT include absolute calendar dates (e.g. 'by May 18') unless the date appears verbatim in the data. Use relative windows like 'this week' or 'within 5 business days' for any deadline.",
        "- Do NOT invent reasons for risk flags or over-allocation. If the cause isn't in the data, just state the signal (e.g. 'PMM-X is 30 days past target completion with 0 allocations').",
        "- If the input lists are empty, return [].",
        "",
        "🔴 COUNT ACCURACY RULES (strict):",
        "- 'Status totals' below are the EXACT portfolio-wide counts. When a card covers records sharing a status, the title MUST state that exact total (e.g. '23 opportunities On Hold'), never the number of examples you cite.",
        "- In the summary, list EVERY affected ticket ID for that status from the data (comma-separated). If they don't all fit in 400 chars, list as many as fit and end with 'and N more'.",
        "- A card about over-allocated resources MUST state the exact over-allocated total below, never the number of examples you cite.",
        "",
        "Status totals (exact, portfolio-wide):",
        JSON.stringify(statusTotals),
        "",
        `Over-allocated resources total (exact): ${overAllocAll.length}`,
        "",
        "Risk-flagged projects/pursuits:",
        JSON.stringify(flagged),
        "",
        "Most over-allocated resources:",
        JSON.stringify(overAlloc),
        "",
        "Return ONLY the JSON array, no prose.",
      ].join("\n");
      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 600,
      });
      const text = resp.choices[0]?.message?.content?.trim() ?? "[]";
      const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "");
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        cards = parsed.slice(0, 3).map((c: Record<string, unknown>) => ({
          severity: (["high", "med", "info"].includes(String(c.severity)) ? c.severity : "med") as "high" | "med" | "info",
          title: String(c.title ?? "Escalation").slice(0, 200),
          summary: clipSummary(String(c.summary ?? "")),
        }));
      }
    }
  } catch (e) {
    console.warn("[alerts] AI escalation gen failed, falling back to rule-based:", String(e));
  }

  // Fallback: deterministic top-3 rule-based cards.
  if (cards.length === 0) {
    if (flagged[0]) {
      // Group by the dominant status so the card states the REAL total
      // (e.g. "23 records On Hold") instead of citing a single example.
      const dominant = Object.entries(statusTotals).sort(([, a], [, b]) => b - a)[0];
      const group = dominant
        ? flagged.filter((f) => (f.status || "Unknown") === dominant[0])
        : [];
      if (dominant && dominant[1] > 1 && group.length > 1) {
        const ids = group.map((f) => f.ticket).filter(Boolean);
        const cited = ids.join(", ");
        const suffix =
          dominant[1] > ids.length ? ` and ${dominant[1] - ids.length} more` : "";
        cards.push({
          severity: "high",
          title: `${dominant[1]} records ${dominant[0]} — review required`,
          summary: clipSummary(`${cited}${suffix} — status "${dominant[0]}".`),
        });
      } else {
        cards.push({
          severity: "high",
          title: `${flagged[0].ticket} flagged: ${flagged[0].status}`,
          summary: flagged[0].title || "Review project status and assign owner.",
        });
      }
    }
    if (overAlloc[0]) {
      const totalOver = overAllocAll.length;
      cards.push({
        severity: overAlloc[0].pct > 130 ? "high" : "med",
        title:
          totalOver > 1
            ? `${totalOver} resources over-allocated (110%+)`
            : `${overAlloc[0].name} at ${overAlloc[0].pct}% utilization`,
        summary:
          totalOver > 1
            ? clipSummary(
                `${overAllocAll
                  .map((r) => `${String(r.name ?? "")} (${Math.round(r.currentPct ?? 0)}%)`)
                  .join(", ")} — rebalance recommended.`,
              )
            : `Over-allocated across ${overAlloc[0].projects} projects — rebalance recommended.`,
      });
    }
  }

  return finishReplace(
    meta,
    since,
    regenStart,
    coveringMarker,
    todayRows,
    cards.map((c) => ({
      tenant: meta.tenant,
      role: null,
      userGuid: null,
      severity: c.severity,
      title: c.title,
      summary: c.summary,
      payload: { source: "lazy-daily", recordIndex, personIndex, allocFingerprint: escFp } as Record<string, unknown>,
      status: "open",
      generatedAt: new Date(),
      expiresAt: null,
    })),
  );
}

// ──────────────────────────────────────────────────────────────────
// Public alert-row shape (matches RiskItem on the clients)
// ──────────────────────────────────────────────────────────────────

interface AlertRow {
  alertKey: string;
  tone: "high" | "med" | "info";
  title: string;
  sub?: string;
  source: "forecast-shift" | "exec-approval" | "ai-escalation" | "unresolved";
  // Optional per-record detail table (matches the client's ActionDetail
  // shape). Attached to ai-escalation rows — and to the "Over-allocated
  // staff" forecast-shift row — so the drill-down panel shows each
  // record's real name instead of repeating the card title.
  records?: {
    title: string;
    subtitle?: string;
    columns: Array<{ key: string; label: string; align?: "left" | "right" }>;
    rows: Array<Record<string, string>>;
  };
}

// Generic multi-segment ticket matcher (tenant prefixes are user-defined,
// e.g. OPM-00195 or PRJ-2026-001) — must match the FULL ID or a clipped
// prefix would link to a nonexistent record.
const FEED_TICKET_RE = /\b[A-Z]{2,5}-\d{2,8}(?:-\d{2,8})?\b/g;

// Over-allocation phrasing — used to decide when a card without ticket
// IDs should get the per-person table from its payload's personIndex.
const OVER_ALLOC_TEXT_RE = /over-?alloc|overload|over capacity|utili[sz]ation|\b\d{3}\s?%/i;

interface PersonIndexEntry {
  name?: string;
  pct?: number;
  projects?: Array<{ ticket?: string; name?: string }>;
}

// One row per over-allocated person, with the person's real projects.
// Rows carry _person (→ Resources → Timeline deep link on the client)
// and, when the person is on exactly one project, _ticket so the row can
// open that project directly. Multi-person cards must never collapse
// into a single paragraph row. Shared by the AI escalation drill-down and
// the "Over-allocated staff" trend alert so both panels render the exact
// same table (names, live %, real projects, row deep links).
function buildPersonRecordsTable(
  people: PersonIndexEntry[],
  title: string,
  subtitle: string,
): NonNullable<AlertRow["records"]> {
  const rows = people.map((p) => {
    const projects = (Array.isArray(p.projects) ? p.projects : []).filter(
      (pr) => pr && String(pr.ticket ?? "").trim(),
    );
    const projLabel =
      projects.length === 0
        ? "—"
        : projects.length === 1
          ? `${projects[0].ticket}${projects[0].name ? ` — ${projects[0].name}` : ""}`
          : `${projects.length} projects: ${projects
              .slice(0, 2)
              .map((pr) => pr.ticket)
              .join(", ")}${projects.length > 2 ? ` +${projects.length - 2} more` : ""}`;
    const row: Record<string, string> = {
      person: String(p.name ?? "—"),
      allocation: p.pct != null ? `${p.pct}%` : "—",
      projects: projLabel,
      _person: String(p.name ?? ""),
    };
    if (projects.length === 1) row._ticket = String(projects[0].ticket);
    return row;
  });
  return {
    title,
    subtitle,
    columns: [
      { key: "person", label: "Person" },
      { key: "allocation", label: "Allocation", align: "right" },
      { key: "projects", label: "Projects" },
    ],
    rows,
  };
}

function escalationPersonTable(e: AiEscalation): AlertRow["records"] | undefined {
  const people = (e.payload?.personIndex ?? null) as PersonIndexEntry[] | null;
  if (!Array.isArray(people) || people.length === 0) return undefined;
  const text = `${e.title} ${e.summary}`;
  const mentioned = people.filter((p) => p.name && text.includes(p.name));
  // A card themed around over-allocation covers ALL over-allocated people
  // (titles state the exact total); otherwise only the people the card
  // actually names belong in its table.
  const relevant = OVER_ALLOC_TEXT_RE.test(text) ? people : mentioned;
  if (relevant.length === 0) return undefined;
  return buildPersonRecordsTable(relevant, e.title, e.summary);
}

// Person list for the "Over-allocated staff" trend alert, borrowed from
// today's AI escalation payload: that personIndex is computed under the
// same shared windowed math and kept intraday-fresh by the fingerprint
// gate, so this panel and the escalation panel can never disagree with
// each other. No payload today (all-clear scan, or the escalation source
// failed) → undefined, and the client keeps its one-row summary fallback.
function overAllocTrendRecords(
  escalations: AiEscalation[],
  title: string,
  snapshotCount: number,
): AlertRow["records"] | undefined {
  const people = escalations
    .map((e) => (e.payload?.personIndex ?? null) as PersonIndexEntry[] | null)
    .find((p): p is PersonIndexEntry[] => Array.isArray(p) && p.length > 0);
  if (!people) return undefined;
  const live = `${people.length} ${people.length === 1 ? "person" : "people"} currently over-allocated`;
  // The headline compares once-a-day snapshots; the table is live. Say so
  // whenever the two counts drift apart instead of letting them clash.
  const subtitle =
    people.length === snapshotCount
      ? live
      : `${live} — the headline count compares daily snapshots.`;
  return buildPersonRecordsTable(people, title, subtitle);
}

// Build the per-record detail table for an AI escalation card from the
// ticket IDs in its text + the name/status index stored in its payload.
// Cards with no ticket IDs (over-allocation cards) fall back to the
// per-person table instead.
function escalationRecordsTable(e: AiEscalation): AlertRow["records"] | undefined {
  const idx = (e.payload?.recordIndex ?? null) as Record<string, { name?: string; status?: string }> | null;
  if (!idx) return escalationPersonTable(e);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of `${e.title} ${e.summary}`.matchAll(FEED_TICKET_RE)) {
    if (!seen.has(m[0])) {
      seen.add(m[0]);
      ids.push(m[0]);
    }
  }
  // The summary is clipped (~400-500 chars ≈ 35-40 IDs) and ends with
  // "and N more" for large portfolios — but recordIndex holds EVERY flagged
  // record. Use the parsed IDs to learn which status(es) this card covers,
  // then append the indexed records with those statuses that got clipped
  // out of the text, so the table always matches the total in the title.
  const cardStatuses = new Set(
    ids.map((id) => idx[id]?.status).filter((s): s is string => !!s),
  );
  if (cardStatuses.size > 0) {
    for (const [ticket, rec] of Object.entries(idx)) {
      if (!seen.has(ticket) && rec.status && cardStatuses.has(rec.status)) {
        seen.add(ticket);
        ids.push(ticket);
      }
    }
  }
  const rows = ids.map((id) => ({
    record: id,
    name: idx[id]?.name || "—",
    status: idx[id]?.status || "",
    _ticket: id,
  }));
  if (rows.length === 0 || rows.every((r) => r.name === "—")) {
    return escalationPersonTable(e);
  }
  return {
    title: e.title,
    subtitle: e.summary,
    columns: [
      { key: "record", label: "Record / Item" },
      { key: "name", label: "Name" },
      { key: "status", label: "Status" },
    ],
    rows,
  };
}

// ──────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────

router.get("/feed", async (req: Request, res: Response) => {
  const meta = await requireSession(req, res);
  if (!meta) return;
  try {
    // Each source is best-effort (a partial feed is better than none), but
    // count core-source failures: if EVERY source failed we must not fabricate
    // an "all clear" empty feed — that's a 503, and the client keeps whatever
    // it was already showing.
    let coreFailures = 0;
    const safe = <T,>(p: Promise<T[]>, label: string): Promise<T[]> =>
      p.catch((e) => {
        coreFailures++;
        console.warn(`[alerts] ${label} failed: ${String(e)}`);
        return [] as T[];
      });
    const [diffs, approvals, escalations, dismissed] = await Promise.all([
      safe(forecastDiffs(meta), "forecastDiffs"),
      safe(execApprovals(meta), "execApprovals"),
      safe(ensureAiEscalations(meta), "aiEscalations"),
      getAlertStatesByUser(meta.tenant, meta.userGuid || "")
        .catch(() => [] as Array<{ alertKey: string; status: string }>),
    ]);
    if (coreFailures >= 3) {
      res.status(503).json({ error: "Alert sources temporarily unavailable" });
      return;
    }

    const dismissedKeys = new Set(
      (Array.isArray(dismissed) ? dismissed : []).map((d) => d.alertKey),
    );
    const rows: AlertRow[] = [];

    for (const d of diffs) {
      const key = `forecast-shift:${d.label}`;
      if (dismissedKeys.has(key)) continue;
      const sign = d.direction === "up" ? "+" : "−";
      const isCurrency = d.label.includes("value");
      const fmt = (n: number) => {
        const abs = Math.abs(n);
        if (!isCurrency) return Math.round(abs).toLocaleString();
        // Tiers must not stop at B — junk-sized data (trillions and beyond)
        // would otherwise print raw digits with a "B" stuck on the end.
        if (abs >= 1e18) return `$${(abs / 1e18).toFixed(1)}Qi`;
        if (abs >= 1e15) return `$${(abs / 1e15).toFixed(1)}Qa`;
        if (abs >= 1e12) return `$${(abs / 1e12).toFixed(1)}T`;
        if (abs >= 1_000_000_000) return `$${(abs / 1_000_000_000).toFixed(1)}B`;
        if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)}M`;
        return `$${(abs / 1000).toFixed(0)}K`;
      };
      // "since yesterday" when the baseline snapshot is the prior calendar
      // day, otherwise name the actual snapshot date (weekends / gaps).
      // Compare UTC calendar days — elapsed-ms math misclassifies a genuine
      // yesterday-baseline as 2 days back once the clock passes noon UTC.
      const dayNum = (t: Date) => Math.floor(t.getTime() / (24 * 60 * 60 * 1000));
      const daysBack = dayNum(new Date()) - dayNum(d.baselineDate);
      const sinceLabel =
        daysBack <= 1
          ? "since yesterday"
          : `since ${d.baselineDate.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
      // Only quote a percentage when it reads sanely — a jump from a tiny
      // baseline produces silly figures (+50,000%), so fall back to the
      // plain was → now numbers which say the same thing credibly.
      const pctPart =
        Math.abs(d.pct) <= 500 ? ` · ${sign}${Math.abs(d.pct).toFixed(1)}%` : "";
      const title = `${d.label} ${sign}${fmt(d.delta)} ${sinceLabel}`;
      // The over-allocated-staff trend drills into the SAME per-person
      // table as the AI escalation card (real names, live %, real projects,
      // row deep links) instead of one synthetic row restating the headline.
      const records =
        d.label === OVER_ALLOC_DIFF_LABEL
          ? overAllocTrendRecords(escalations, title, d.cur)
          : undefined;
      rows.push({
        alertKey: key,
        tone: Math.abs(d.pct) >= 10 ? "med" : "info",
        title,
        sub: `Was ${fmt(d.prev)} → now ${fmt(d.cur)}${pctPart}`,
        source: "forecast-shift",
        ...(records ? { records } : {}),
      });
    }

    for (const a of approvals) {
      const key = `exec-approval:${a.module}:${a.ticket}`;
      if (dismissedKeys.has(key)) continue;
      rows.push({
        alertKey: key,
        tone: "high",
        title: `${a.ticket} — your approval required`,
        sub: `${a.title} (${a.stage})`,
        source: "exec-approval",
      });
    }

    for (const e of escalations) {
      const key = `ai-escalation:${e.id}`;
      if (dismissedKeys.has(key) || e.status !== "open") continue;
      rows.push({
        alertKey: key,
        tone: (e.severity === "high" || e.severity === "med" || e.severity === "info"
          ? e.severity
          : "med") as "high" | "med" | "info",
        title: e.title,
        sub: e.summary,
        source: "ai-escalation",
        records: escalationRecordsTable(e),
      });
    }

    res.json({ rows, generatedAt: Date.now() });
  } catch (e) {
    console.warn("[alerts/feed] failed:", String(e));
    res.json({ rows: [], generatedAt: Date.now() });
  }
});

router.get("/state", async (req: Request, res: Response) => {
  const meta = await requireSession(req, res);
  if (!meta) return;
  if (!meta.userGuid) {
    res.json({ items: [] });
    return;
  }
  const items = await getAlertStatesByUser(meta.tenant, meta.userGuid);
  res.json({ items });
});

router.post("/state", async (req: Request, res: Response) => {
  const meta = await requireSession(req, res);
  if (!meta) return;
  if (!meta.userGuid) {
    res.status(400).json({ error: "Missing x-rmone-user-guid header" });
    return;
  }
  const body = (req.body ?? {}) as {
    alertKey?: string;
    status?: string;
    snoozedUntil?: string | null;
    note?: string | null;
  };
  const alertKey = String(body.alertKey ?? "").trim();
  const status = String(body.status ?? "").trim();
  if (!alertKey || !["resolved", "dismissed", "snoozed", "open"].includes(status)) {
    res.status(400).json({ error: "alertKey and valid status required" });
    return;
  }
  const snoozedUntil = body.snoozedUntil ? new Date(body.snoozedUntil) : null;
  const note = body.note ? String(body.note).slice(0, 500) : null;
  try {
    let before: Awaited<ReturnType<typeof getAlertStatesByUser>>[number] | undefined;
    try {
      before = (await getAlertStatesByUser(meta.tenant, meta.userGuid))
        .find((item) => item.alertKey === alertKey);
    } catch {
      // Audit enrichment is best-effort; the write remains available.
    }
    const row = await upsertAlertState({ tenant: meta.tenant, userGuid: meta.userGuid, alertKey, status, snoozedUntil, note });
    const ticket = alertKey.match(/\b(?:PMM|OPM|LEM|LD|COM|CON)-[A-Z0-9-]+\b/i)?.[0] ?? "";
    const prefix = ticket.toUpperCase().match(/^[A-Z]+/)?.[0] ?? "";
    const entityType =
      prefix === "PMM" ? "project" :
      prefix === "OPM" ? "opportunity" :
      prefix === "LEM" || prefix === "LD" ? "lead" :
      prefix === "COM" ? "company" :
      prefix === "CON" ? "contact" : "record";
    setAuditTarget(res, { entityType, entityId: ticket || null, entityName: alertKey, action: "update.record" });
    setTrustedAuditChanges(res, boundedAuditChanges([
      { FieldName: "Alert key", OldValue: before?.alertKey ?? null, NewValue: row.alertKey },
      { FieldName: "Alert status", OldValue: before?.status ?? null, NewValue: row.status },
    ]));
    res.json({ ok: true, row });
  } catch (e) {
    console.warn("[alerts/state] upsert failed:", String(e));
    res.status(500).json({ error: "Upsert failed" });
  }
});

export default router;
