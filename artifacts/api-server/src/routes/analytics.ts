// ─────────────────────────────────────────────────────────────────────────────
// Analytics Center server endpoints.
//
// GET /api/analytics/financial — annualized planned-labor metrics for the
// Financial page, computed from tenant-wide allocation rows × rates (see
// lib/financial-analytics.ts for the math and honesty rules).
//
// Availability contract (matches the hub's degrade pattern):
//   • RDS (AWS-onboarded) session → full payload, { available: true, ... }
//   • valid non-RDS/upstream session → 200 { available: false, reason } — the
//     page shows "—" with a plain explanation, no upstream fan-out exists
//   • no/invalid session → 401
//   • custom access level WITHOUT the financial capability → 403
//
// Caching: one computed payload per tenant, 10-min TTL with single-flight and
// a 30-min stale-if-error tail. Failures are never cached and an empty
// payload is never fabricated (hollow-cache rule) — a hard failure with no
// stale copy is an honest 500.
//
// Bust guard: bustFinancialCache records the bust timestamp in finBustAt.
// computeForTenant checks startedAt ≤ finBustAt before writing to finCache,
// so a post-bust in-flight fetch cannot overwrite fresh data with stale results
// (same pattern as projectDetailBustAt / taskDataBustAt in rmone-proxy.ts).
// ─────────────────────────────────────────────────────────────────────────────
import { Router, type IRouter, type Request, type Response } from "express";
import { resolveRequestSource } from "../lib/rds-auth.js";
import { blockIfReadOnly } from "./rmone-proxy.js";
import { getCapsForAcl } from "../lib/access-control.js";
import { getFinancialAllocationRowsRds, getResourceDemands, realTitleOf } from "../lib/rds-provider.js";
import { computeFinancialAnalytics, type FinancialAnalyticsCore } from "../lib/financial-analytics.js";
import { computeRecruitmentAnalytics, type RecruitmentAnalyticsCore, type RecruitDemandRow, type RecruitStaffedRow } from "../lib/recruitment-analytics.js";
import { getBusinessRulesForTenant } from "../lib/business-rules.js";
import { getEnabledUsersByTenant, getResourceAvailabilityByTenant } from "@workspace/db";
import type { AvailabilityWindow } from "@workspace/alloc-math";
import { finCache as _finCache, finInflight as _finInflight, finBustAt, bustFinancialCache, recCache, recInflight, recBustAt, capRecCache, broadcastRecruitmentPayload } from "../lib/financial-cache.js";

export { bustFinancialCache };

const router: IRouter = Router();

interface FinCacheEntry {
  payload: FinancialAnalyticsCore & { generatedAt: string };
  exp: number;       // fresh until
  staleExp: number;  // usable as stale-if-error until
}
const FIN_TTL_MS = 15 * 60_000;   // fresh for 15 min
const FIN_STALE_MS = 2 * 60 * 60_000; // stale-while-revalidate for 2 h
const finCache    = _finCache    as Map<string, FinCacheEntry>;
const finInflight = _finInflight as Map<string, Promise<FinCacheEntry["payload"]>>;

async function computeForTenant(tid: string, tenant: string): Promise<FinCacheEntry["payload"]> {
  const inflight = finInflight.get(tid);
  if (inflight) return inflight;
  const startedAt = Date.now();
  const p = (async () => {
    const { rows, workWeekHours } = await getFinancialAllocationRowsRds(tid, tenant);
    const core = computeFinancialAnalytics(rows, workWeekHours);
    const payload = { ...core, generatedAt: new Date().toISOString() };
    // Bust guard: skip the write if a bust fired after this fetch started.
    // finBustAt records the most-recent bust time; if startedAt is at or before
    // it, our rows reflect the pre-bust state and must not pollute the cache.
    // A 1 s slack covers sub-millisecond IPC delivery skew (same as the
    // projectDetail / taskData guards in rmone-proxy.ts).
    const lastBust = finBustAt.get(tid) ?? 0;
    if (startedAt <= lastBust + 1000) {
      console.log(`[analytics/financial] discarding stale in-flight result for ${tid} (startedAt=${startedAt} lastBust=${lastBust})`);
      // Return the payload to the caller that kicked off this computation
      // (they get fresh-ish data for THIS response), but do NOT cache it so
      // the NEXT request re-fetches after the bust.
      return payload;
    }
    finCache.set(tid, { payload, exp: Date.now() + FIN_TTL_MS, staleExp: Date.now() + FIN_STALE_MS });
    return payload;
  })();
  finInflight.set(tid, p);
  try {
    return await p;
  } finally {
    finInflight.delete(tid);
  }
}

router.get("/financial", async (req: Request, res: Response) => {
  try {
    const src = resolveRequestSource(req);
    if (!src) {
      // Distinguish "no session at all" from "valid but non-RDS session".
      // Upstream (legacy proxy) sessions carry a bearer token this endpoint
      // cannot verify against core2 — but the page must not treat them as
      // signed out. Any bearer token present → honest "not supported" 200;
      // the record-based cards on the page still work client-side.
      const hdr = req.headers["authorization"];
      const raw = Array.isArray(hdr) ? hdr[0] : hdr;
      if (raw && String(raw).trim()) {
        res.json({
          available: false,
          reason: "Allocation-level financial analytics needs the AWS-hosted data source. This company's data source doesn't support it yet.",
        });
        return;
      }
      res.status(401).json({ error: "not_signed_in" });
      return;
    }

    // Custom access levels: the level's financial capability decides. Built-in
    // levels pass (getCapsForAcl returns null for them) — same rule the web
    // hub uses to show/hide the Financial tile.
    try {
      const caps = await getCapsForAcl(src.accessLevel, src.tenant);
      if (caps && !caps.editFinancials) {
        res.status(403).json({
          error: "financial_restricted",
          error_description: "Your access level doesn't include financial data.",
        });
        return;
      }
    } catch (e) {
      // Fail closed — never serve tenant-wide rates when the policy can't be read.
      console.warn(`[analytics/financial] caps unavailable for ${src.username}@${src.tenant}: ${String(e).slice(0, 120)}`);
      res.status(503).json({ error: "policy_unavailable" });
      return;
    }

    const hit = finCache.get(src.tid);
    const now = Date.now();
    if (hit && now < hit.exp) {
      // Fully fresh — return immediately.
      res.json({ available: true, stale: false, ...hit.payload });
      return;
    }
    if (hit && now < hit.staleExp) {
      // Stale-while-revalidate: serve the cached payload instantly and kick
      // off a background refresh so the NEXT request will be fresh.
      // computeForTenant already deduplicates concurrent calls via finInflight.
      computeForTenant(src.tid, src.tenant).catch(e =>
        console.warn(`[analytics/financial] background refresh failed for ${src.tenant}: ${String(e).slice(0, 200)}`),
      );
      res.json({ available: true, stale: true, ...hit.payload });
      return;
    }
    // Cold start (no usable cache): must wait for a fresh compute.
    try {
      const payload = await computeForTenant(src.tid, src.tenant);
      res.json({ available: true, stale: false, ...payload });
    } catch (e) {
      throw e;
    }
  } catch (e) {
    console.error(`[analytics/financial] ${String(e).slice(0, 300)}`);
    res.status(500).json({ error: "financial_analytics_failed" });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
 * GET /api/analytics/recruitment?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Recruitment Capacity Variance per role = Available − Required hours (see
 * lib/recruitment-analytics.ts for the math + honesty rules). No dollar data
 * is exposed, so there is no financial-capability gate — but the Analytics
 * Center is EDITOR-ONLY in the web client (navCatalog editorOnly), so this
 * route enforces the same rule server-side via blockIfReadOnly: view-only
 * built-in levels and custom levels without editData get 403, and a failed
 * policy read fails CLOSED (503). A valid token alone is NOT enough — the
 * payload is tenant-wide roster capacity, demand, and leave-derived
 * availability.
 *
 * Caching: per (tenant, start, end), 5-min TTL with single-flight. Failures
 * are never cached; there is no fabricated-empty fallback (hollow-cache rule).
 * ──────────────────────────────────────────────────────────────────────────── */
type RecPayload = RecruitmentAnalyticsCore & { generatedAt: string };
const REC_TTL_MS = 5 * 60_000;
/** Serve-stale window: an expired (never busted) entry answers instantly while
 *  a background single-flight recompute refreshes it. Busts DELETE entries, so
 *  a surviving stale entry only ever means "old by clock", never "missed a
 *  write" (rds-save-path-swr pattern). */
const REC_STALE_MS = 2 * 60 * 60_000;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Cheap stable hash for the holiday list (djb2) — keeps cache keys short. */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Business-rule fingerprint baked into the cache key so a Settings change
 *  (work week hours, working days, holidays) is reflected on the very next
 *  request instead of waiting out the TTL. */
function recRulesFingerprint(rules: Awaited<ReturnType<typeof getBusinessRulesForTenant>>): string {
  const wwh = rules.workWeekHours || 40;
  const nwd = (rules.nonWorkingDays ?? [0, 6]).join(".");
  const hol = rules.holidayDates ?? [];
  return `${wwh}|${nwd}|${hol.length}:${djb2(hol.join(","))}`;
}

async function computeRecruitmentForTenant(
  tid: string, tenant: string, start: string, end: string,
  rules: Awaited<ReturnType<typeof getBusinessRulesForTenant>>, key: string,
): Promise<RecPayload> {
  const inflight = recInflight.get(key);
  if (inflight) return inflight as Promise<RecPayload>;
  const startedAt = Date.now(); // post-bust write guard (same pattern as finBustAt)
  const p = (async () => {
    const [finLeg, demandLeg, users, availRows] = await Promise.all([
      getFinancialAllocationRowsRds(tid, tenant),
      getResourceDemands(tid, tenant) as Promise<{ total: number; data: Array<Record<string, unknown>> }>,
      getEnabledUsersByTenant(tid),
      getResourceAvailabilityByTenant(tid),
    ]);

    // Staffed rows only — demand (person="") is covered by getResourceDemands
    // with a real role attached; using both sides of finLeg would double-count.
    const staffedRows: RecruitStaffedRow[] = finLeg.rows
      .filter((r) => r.person)
      .map((r) => ({ person: r.person, ticket: r.ticket, start: r.start, end: r.end, hours: r.hours, pct: r.pct }));

    const demandRows: RecruitDemandRow[] = (demandLeg?.data ?? []).map((d) => ({
      ticketId: String(d.TicketId ?? d.ProjectNumber ?? ""),
      // Strip the display-only " (2)" duplicate-position suffix so hours
      // group under the real role name…
      role: String(d.Role ?? "").replace(/ \(\d+\)$/, ""),
      // …but keep the suffixed original as the slot identity so two
      // identical-role positions on one project still COUNT as two.
      slotKey: String(d.Role ?? ""),
      start: String(d.AllocationStartDate ?? "").slice(0, 10),
      end: String(d.AllocationEndDate ?? d.AllocationStartDate ?? "").slice(0, 10),
      pct: Number(d.PctAllocation) || 0,
    }));

    /* Capacity basis = every ENABLED roster person. Roster start/end dates are
     * deliberately ignored — see the note on RecruitPerson in the compute lib. */
    const people = users.map((u) => ({
      guid: u.id,
      role: realTitleOf(u.title, u.role),
    }));

    const availabilityByGuid = new Map<string, AvailabilityWindow[]>();
    for (const w of availRows) {
      const g = String(w.resourceGuid ?? "");
      if (!g) continue;
      let list = availabilityByGuid.get(g);
      if (!list) { list = []; availabilityByGuid.set(g, list); }
      list.push({ startDate: w.startDate, endDate: w.endDate, availabilityPct: w.availabilityPct });
    }

    const core = computeRecruitmentAnalytics({
      staffedRows,
      demandRows,
      people,
      availabilityByGuid,
      workWeekHours: finLeg.workWeekHours,
      nonWorkingDays: rules.nonWorkingDays,
      holidayDates: rules.holidayDates,
      periodStart: start,
      periodEnd: end,
    });
    const payload = { ...core, generatedAt: new Date().toISOString() };
    // Post-bust guard: if allocations changed while (or within IPC-skew reach
    // of) this compute, return the result but never cache or broadcast it —
    // same 1s slack as the financial path's `startedAt <= lastBust + 1000`.
    if (startedAt > (recBustAt.get(tid) ?? 0) + 1000) {
      capRecCache();
      const exp = Date.now() + REC_TTL_MS;
      // Honest-empty results (brand-new tenant: no roster, no demand) keep the
      // short fresh TTL but get NO serve-stale window — an empty must never be
      // served for hours while real data may be arriving.
      const staleExp = core.roles.length > 0 ? Date.now() + REC_STALE_MS : exp;
      recCache.set(key, { payload, exp, staleExp });
      // Share the result so sibling workers adopt it instead of each paying
      // their own cold compute (empty/failure shapes are never shared —
      // guards live in lib/financial-cache.ts).
      broadcastRecruitmentPayload(key, payload, exp, staleExp);
    }
    return payload;
  })();
  recInflight.set(key, p);
  try {
    return await p;
  } finally {
    recInflight.delete(key);
  }
}

router.get("/recruitment", async (req: Request, res: Response) => {
  try {
    const src = resolveRequestSource(req);
    if (!src) {
      const hdr = req.headers["authorization"];
      const raw = Array.isArray(hdr) ? hdr[0] : hdr;
      if (raw && String(raw).trim()) {
        res.json({
          available: false,
          reason: "Recruitment analytics needs the AWS-hosted data source. This company's data source doesn't support it yet.",
        });
        return;
      }
      res.status(401).json({ error: "not_signed_in" });
      return;
    }

    // Analytics Center is editor-only in the web client — enforce the same
    // rule here so a view-only account can't fetch tenant-wide staffing data
    // by calling the endpoint directly. Fails closed on policy-read errors.
    if (await blockIfReadOnly(req, res)) return;

    const start = String(req.query.start ?? "").trim();
    const end = String(req.query.end ?? "").trim();
    if (!ISO_DAY.test(start) || !ISO_DAY.test(end)) {
      res.status(400).json({ error: "bad_period", error_description: "start and end must be YYYY-MM-DD" });
      return;
    }
    const sMs = Date.parse(start), eMs = Date.parse(end);
    if (!Number.isFinite(sMs) || !Number.isFinite(eMs) || eMs < sMs) {
      res.status(400).json({ error: "bad_period", error_description: "end must be on or after start" });
      return;
    }
    if (eMs - sMs > 400 * 86_400_000) {
      res.status(400).json({ error: "bad_period", error_description: "period is capped at ~13 months" });
      return;
    }

    // Rules fetched up front (cheap — its own short TTL cache) so the Settings
    // fingerprint is part of the cache key: change the work week in Settings
    // and the next request recomputes instead of serving the old basis.
    const rules = await getBusinessRulesForTenant(src.tenant);
    const key = `${src.tid}|${start}|${end}|${recRulesFingerprint(rules)}`;
    const hit = recCache.get(key);
    const now = Date.now();
    if (hit && hit.exp > now) {
      res.json({ available: true, ...(hit.payload as RecPayload) });
      return;
    }
    if (hit && hit.staleExp > now) {
      // Serve-stale-while-revalidate: answer instantly from the expired (but
      // never-busted) entry and refresh in the background — single-flight
      // dedupes concurrent kicks, the bust guard inside protects freshness.
      computeRecruitmentForTenant(src.tid, src.tenant, start, end, rules, key)
        .catch((e) => console.warn(`[analytics/recruitment] background refresh failed for ${src.tenant}: ${String(e).slice(0, 160)}`));
      res.json({ available: true, ...(hit.payload as RecPayload) });
      return;
    }
    const payload = await computeRecruitmentForTenant(src.tid, src.tenant, start, end, rules, key);
    res.json({ available: true, ...payload });
  } catch (e) {
    console.error("[analytics/recruitment] failed:", e);
    // Honest failure — never a fabricated empty payload.
    res.status(500).json({ error: "recruitment_analytics_failed" });
  }
});

/** Login/boot warm hook: precompute the Recruitment page's DEFAULT payload
 *  (current quarter — mirrors DEFAULT_PERIOD + isoRange in rmone-web
 *  analytics-recruitment.tsx, inclusive end date) so the page and the
 *  Analytics hub tile answer instantly on first open. Best-effort: fresh-hit
 *  check + single-flight inside, failures only logged. */
export async function warmRecruitmentAnalytics(tid: string, tenant: string): Promise<void> {
  try {
    const now = new Date();
    const qi = Math.floor(now.getMonth() / 3);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const start = fmt(new Date(now.getFullYear(), qi * 3, 1));
    const end = fmt(new Date(now.getFullYear(), qi * 3 + 3, 0)); // last day of the quarter (inclusive)
    const rules = await getBusinessRulesForTenant(tenant);
    const key = `${tid}|${start}|${end}|${recRulesFingerprint(rules)}`;
    const hit = recCache.get(key);
    if (hit && hit.exp > Date.now()) return;
    await computeRecruitmentForTenant(tid, tenant, start, end, rules, key);
  } catch (e) {
    console.warn(`[warm-recruitment] ${tenant}: ${String(e).slice(0, 160)}`);
  }
}

export default router;
