/**
 * Usage Analytics (#482) — admin-gated aggregates over the telemetry layer.
 *
 * Routes (mounted under /api/rmone):
 *  - POST /usage-beacon      — SPA module-visit beacon (any authenticated user)
 *  - GET  /usage-analytics   — the Usage Analytics page payload (admin only;
 *                              cross-tenant scope for root superadmins)
 *
 * Honesty contract (mirrors the rest of the Analytics Center):
 *  - Only observed numbers are returned. Nothing is estimated or backfilled.
 *  - collectingSince discloses when recording started; the page renders a
 *    "collecting since" state until real data accumulates.
 *  - Query failures are 500s (the client shows "couldn't load", never zeros).
 *  - Row lists for drawers are capped, with the TRUE totals disclosed
 *    alongside so a capped table never silently implies a smaller total.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { getMssqlPool, mssql } from "@workspace/db";
import { resolveRequestSource, isSuperAdminSource, lookupUserForLogin } from "../lib/rds-auth.js";
import { resolveHiddenNavIdsChecked } from "../lib/access-control.js";
import { recordUsage, usageTelemetryEnabled } from "../lib/usage-telemetry.js";
import { resolveTenantId } from "../lib/pipeline.js";

const router: IRouter = Router();

async function canViewUsageAnalytics(rds: {
  tenant: string; username: string; accessLevel: string;
}): Promise<boolean> {
  const live = await lookupUserForLogin(rds.tenant, rds.username);
  if (!live || live.enabled === false) return false;
  const rawAcl = String(live.accessLevel ?? "").trim().toLowerCase();
  const acl = rawAcl === "administrator" || rawAcl === "unset" || !rawAcl ? "admin" : rawAcl;
  const hidden = await resolveHiddenNavIdsChecked(
    rds.tenant, live.id ?? null, acl === "admin", rawAcl,
  );
  return !hidden.includes("usageanalytics");
}

/* ── Beacon ── */

// Per-user sliding-window cap: a scripted client with a valid token must not
// be able to grow the raw table unbounded. Beyond the cap the beacon still
// answers 204 (it is fire-and-forget by contract) but the event is dropped.
// Real navigation never gets close: the web client already dedupes to one
// beacon per module per 30s.
const BEACON_PER_MINUTE = 60;
const beaconWindows = new Map<string, { start: number; n: number }>();
function beaconAllowed(key: string): boolean {
  const now = Date.now();
  const w = beaconWindows.get(key);
  if (!w || now - w.start > 60_000) {
    if (beaconWindows.size > 5_000) beaconWindows.clear(); // bounded memory
    beaconWindows.set(key, { start: now, n: 1 });
    return true;
  }
  w.n += 1;
  return w.n <= BEACON_PER_MINUTE;
}

router.post("/usage-beacon", (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  const body = req.body as { feature?: unknown; context?: unknown } | undefined;
  const feature = String(body?.feature ?? "").trim().slice(0, 120);
  // context = specific record/page identifier (ticket ID or path segment), safe chars only
  const context = String(body?.context ?? "").trim().replace(/[^\w\-. ]/g, "").slice(0, 200);
  // Only well-formed module names — the beacon is client-supplied input.
  if (/^[A-Za-z][A-Za-z0-9_-]{0,119}$/.test(feature) && beaconAllowed(`${rds.tenant}|${rds.userId}`)) {
    recordUsage(rds, "page", feature, { context });
  }
  res.status(204).end();
});

/* ── Analytics payload ── */

const ROW_CAP = 300;      // per drawer list; true totals always disclosed
const DEFAULT_WEEKS = 5;  // matches the client's own analysis window

interface UsageRow {
  tenant_id: string;
  day: Date;
  user_id: string;
  username: string;
  role: string | null;
  kind: string;
  feature: string;
  context: string | null;
  is_system: boolean;
  cnt: number;
}

/** Raw (un-rolled) event row with exact timestamp from rmone_usage_events. */
interface RawEventRow {
  tenant_id: string;
  at: Date;
  user_id: string;
  username: string;
  role: string | null;
  kind: string;
  feature: string;
  context: string | null;
  is_system: boolean;
  cnt: number;
}
interface EnabledUser {
  tenant_id: string;
  id: string;
  username: string;
  name: string;
  role: string | null;
  is_manager: boolean;
}

/** UTC Monday (00:00) of the week containing d, as YYYY-MM-DD. */
function weekStartUtc(d: Date): string {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (day.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  day.setUTCDate(day.getUTCDate() - dow);
  return day.toISOString().slice(0, 10);
}

/* ── Cluster-wide TTL cache (stale-while-revalidate + IPC adoption) ───────
 * The analytics query scans all usage rows and can be slow on large tenants.
 * Entries are FRESH for 5 minutes; past that they are served STALE instantly
 * (with the payload's own generatedAt disclosing the age — the page shows a
 * "Data as of" label) for up to 6 hours while a background refresh runs, so
 * a page load only ever blocks when NOTHING has been computed cluster-wide.
 * ?bust=1 (the page's Refresh button) forces a cluster-wide recompute.
 *
 * The Map is per worker, so without sharing, round-robined page loads hit a
 * cold worker most of the time and the reload spinner comes back on every
 * other visit. The worker that ran the scan therefore broadcasts the RESULT
 * (adoptCache pattern — see rmone-proxy.ts) and siblings adopt it. */
const _analyticsCache = new Map<string, { at: number; staleUntil: number; payload: unknown }>();
const ANALYTICS_TTL_MS   = 5 * 60 * 1000;       // 5 min fresh
const ANALYTICS_STALE_MS = 6 * 60 * 60 * 1000;  // 6 h stale-while-revalidate window

function analyticsCache(key: string): { payload: unknown; stale: boolean } | null {
  const entry = _analyticsCache.get(key);
  if (!entry) return null;
  const now = Date.now();
  if (now > entry.staleUntil) { _analyticsCache.delete(key); return null; }
  return { payload: entry.payload, stale: now > entry.at + ANALYTICS_TTL_MS };
}
function analyticsStore(
  key: string,
  payload: unknown,
  opts?: { fromIpc?: boolean; at?: number; staleUntil?: number },
) {
  const now = Date.now();
  const at = opts?.at ?? now;
  const staleUntil = opts?.staleUntil ?? now + ANALYTICS_STALE_MS;
  _analyticsCache.set(key, { at, staleUntil, payload });
  if (_analyticsCache.size > 500) {
    const oldest = _analyticsCache.keys().next().value;
    if (oldest) _analyticsCache.delete(oldest);
  }
  if (!opts?.fromIpc) broadcastUsagePayload(key, payload, at, staleUntil);
}

/* ── Cross-worker payload adoption + cluster-wide bust ────────────────────
 * Receive-side guards keep the hollow-cache rules intact: never adopt an
 * emptiness/failure shape (fail-closed — the sender's gate is not trusted),
 * never adopt a payload that settled before a local bust of the same key,
 * a local in-flight compute always wins, and a fresher local entry is never
 * downgraded. Adoption stores with fromIpc so it never re-broadcasts. */
const USAGE_ADOPT_MAX_JSON_BYTES = 1_500_000; // don't relay megabyte payloads through the primary
const _analyticsBustAt = new Map<string, number>();
/* Per-key generation counter: a query captures the generation when it STARTS
 * and may only store/broadcast its result if the generation is unchanged when
 * it settles. A bust bumps the generation (locally and, via IPC, on every
 * sibling), so a query begun before the bust can never cache or re-propagate
 * its pre-bust result — timestamps alone can't guarantee that, because
 * analyticsStore stamps `at` at COMPLETION time, which is after the bust. */
const _analyticsGen = new Map<string, number>();

/** Bound the bookkeeping maps like the payload cache — every distinct
 *  admin-supplied date-range key would otherwise accumulate forever. */
function capBookkeeping(map: Map<string, number>): void {
  if (map.size > 500) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

/** Only real, non-empty success payloads may travel between workers. */
function usableUsagePayload(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const p = data as { available?: unknown; tenants?: unknown };
  return p.available === true && Array.isArray(p.tenants) && p.tenants.length > 0;
}

function broadcastUsagePayload(key: string, payload: unknown, at: number, staleUntil: number): void {
  if (!process.send) return; // single-process run — nobody to share with
  if (!usableUsagePayload(payload)) return;
  try {
    const json = JSON.stringify(payload);
    if (!json || json.length > USAGE_ADOPT_MAX_JSON_BYTES) return;
    process.send({ type: "adoptUsageAnalytics", key, json, at, staleUntil });
  } catch { /* worker shutting down or unserializable payload — skip */ }
}

/** Drop the key on this worker AND every sibling, recording the bust time
 *  (rejects pre-bust IPC payloads, +1s skew slack) and bumping the generation
 *  (invalidates any compute already in flight on this worker). */
function bustUsageAnalyticsLocal(key: string): void {
  _analyticsCache.delete(key);
  _analyticsBustAt.set(key, Date.now());
  capBookkeeping(_analyticsBustAt);
  _analyticsGen.set(key, (_analyticsGen.get(key) ?? 0) + 1);
  capBookkeeping(_analyticsGen);
}
function bustUsageAnalyticsEverywhere(key: string): void {
  bustUsageAnalyticsLocal(key);
  if (process.send) {
    try { process.send({ type: "bustUsageAnalytics", key }); } catch { /* shutting down */ }
  }
}

// Worker-side IPC receive. The cluster primary relays every worker message to
// all siblings (index.ts cluster.on("message")), so no primary wiring needed.
// Registering an extra "message" listener alongside handleClusterMessage is
// safe — unknown types fall through both handlers untouched.
process.on("message", (raw: unknown) => {
  if (!raw || typeof raw !== "object") return;
  const m = raw as { type?: string; key?: string; json?: string; at?: number; staleUntil?: number };
  if (m.type === "bustUsageAnalytics") {
    if (typeof m.key === "string") bustUsageAnalyticsLocal(m.key);
    return;
  }
  if (m.type !== "adoptUsageAnalytics") return;
  if (typeof m.key !== "string" || typeof m.json !== "string" || typeof m.at !== "number" || typeof m.staleUntil !== "number") return;
  if (m.staleUntil <= Date.now()) return; // expired in transit
  let data: unknown;
  try { data = JSON.parse(m.json); } catch { return; }
  if (!usableUsagePayload(data)) return;
  if (m.at <= (_analyticsBustAt.get(m.key) ?? 0) + 1000) return;
  if (_analyticsInflight.has(m.key)) return; // our own compute wins
  const hit = _analyticsCache.get(m.key);
  if (hit && hit.at >= m.at) return; // never downgrade a fresher local entry
  analyticsStore(m.key, data, { fromIpc: true, at: m.at, staleUntil: m.staleUntil });
});

/** In-flight dedup: prevent multiple parallel requests from all computing
 *  the same payload simultaneously. */
const _analyticsInflight = new Map<string, Promise<unknown>>();

router.get("/usage-analytics", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  const superadmin = isSuperAdminSource(rds);
  if (!superadmin && !(await canViewUsageAnalytics(rds).catch(() => false))) {
    res.status(403).json({ error: "forbidden", detail: "Usage Analytics is not available for your access level." }); return;
  }

  const isDateStr = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const paramStart = isDateStr(req.query["start"]) ? req.query["start"] : null;
  const paramEnd   = isDateStr(req.query["end"])   ? req.query["end"]   : null;
  const bust = req.query["bust"] === "1";
  // The dashboard summary never needs per-event rows. Those are only useful
  // after an admin opens a drill drawer, so keep them off the cold first paint.
  const includeDetails = req.query["details"] === "1";
  const todayWk = weekStartUtc(new Date());

  // ── Cache check (stale-while-revalidate) ──────────────────────────────
  const cacheKeyBase = `${superadmin ? "all" : rds.tenant}|${paramStart ?? ""}|${paramEnd ?? ""}`;
  const cacheKey = `${cacheKeyBase}|${includeDetails ? "details" : "summary"}`;
  // Explicit Refresh must recompute for the whole cluster, not just this
  // worker — otherwise the next round-robined load resurrects the old entry.
  if (bust) {
    // The detail payload contains a complete aggregate alongside its evidence.
    // Keep the two variants in one freshness generation: otherwise a Refresh
    // can recompute the summary, then a drawer can revive an older detail
    // cache and replace that fresh dashboard on the client.
    bustUsageAnalyticsEverywhere(`${cacheKeyBase}|summary`);
    bustUsageAnalyticsEverywhere(`${cacheKeyBase}|details`);
  }
  if (!bust) {
    const hit = analyticsCache(cacheKey);
    if (hit) {
      if (hit.stale) {
        // Serve stale immediately; kick off background refresh (deduplicated).
        if (!_analyticsInflight.has(cacheKey)) {
          const bg: Promise<unknown> = runUsageQuery(rds, superadmin, paramStart, paramEnd, todayWk, cacheKey, includeDetails)
            .catch(e => console.warn("[usage-analytics] background refresh failed:", String(e).slice(0, 200)))
            .finally(() => {
              // Guarded delete: never remove a NEWER in-flight (a bust may
              // have replaced this entry while the query was running).
              if (_analyticsInflight.get(cacheKey) === bg) _analyticsInflight.delete(cacheKey);
            });
          _analyticsInflight.set(cacheKey, bg);
        }
      }
      res.json(hit.payload);
      return;
    }
  }

  // ── Cold start (or bust): wait for the compute, dedup in-flight requests ─
  try {
    // A bust request must never be answered by a query that started before
    // the bust — start a fresh compute and make IT the shared in-flight.
    let inflight = bust ? undefined : _analyticsInflight.get(cacheKey);
    if (!inflight) {
      const p: Promise<unknown> = runUsageQuery(rds, superadmin, paramStart, paramEnd, todayWk, cacheKey, includeDetails)
        .finally(() => {
          if (_analyticsInflight.get(cacheKey) === p) _analyticsInflight.delete(cacheKey);
        });
      _analyticsInflight.set(cacheKey, p);
      inflight = p;
    }
    const payload = await inflight;
    res.json(payload);
  } catch (e) {
    console.warn("[usage-analytics] failed:", String(e).slice(0, 300));
    res.status(500).json({ error: "usage_query_failed", detail: String(e).slice(0, 200) });
  }
});

/** Extracted compute: runs the 4 queries in 2 parallel waves, builds the
 *  tenant aggregation, stores the result in cache, and returns the payload. */
async function runUsageQuery(
  rds: NonNullable<ReturnType<typeof resolveRequestSource>>,
  superadmin: boolean,
  paramStart: string | null,
  paramEnd: string | null,
  todayWk: string,
  cacheKey: string,
  includeDetails: boolean,
): Promise<unknown> {
  // Generation snapshot: if a bust lands while this query runs, the result is
  // still returned to the caller that awaited it, but it must NOT be stored
  // or broadcast — see _analyticsGen.
  const genAtStart = _analyticsGen.get(cacheKey) ?? 0;
  const pool = await getMssqlPool();

  const tenantFilter = superadmin ? "" : "AND tenant_id = @tenant";

  // ── Wave 1: collectingSince + enabled users — fully independent, run in parallel ──
  const sinceReq = pool.request();
  if (!superadmin) sinceReq.input("tenant", mssql.NVarChar, rds.tenant);
  const sinceP = sinceReq.query(`
    SELECT MIN(x) AS since FROM (
      SELECT MIN(CONVERT(DATETIME2, [day])) AS x FROM dbo.rmone_usage_daily WHERE 1=1 ${tenantFilter}
      UNION ALL
      SELECT MIN(at) AS x FROM dbo.rmone_usage_events WHERE 1=1 ${tenantFilter}
    ) m
  `);

  const usersReq = pool.request();
  let userFilter = "";
  if (!superadmin) {
    usersReq.input("tid", mssql.NVarChar, rds.tid);
    userFilter = "AND tenant_id = @tid";
  }
  const usersP = usersReq.query(`
    SELECT tenant_id, id, username, name, [role], is_manager
    FROM dbo.rmone_users
    WHERE enabled = 1 AND deleted = 0 ${userFilter}
  `);

  const [sinceQ, usersQ] = await Promise.all([sinceP, usersP]);
  const sinceRaw = (sinceQ.recordset?.[0] as { since?: Date | null } | undefined)?.since ?? null;
  const collectingSince = sinceRaw ? new Date(sinceRaw).toISOString() : null;
  const enabledUsers = (usersQ.recordset ?? []) as EnabledUser[];

  // Compute the effective window now that collectingSince is known.
  const effectiveStart = paramStart
    ? weekStartUtc(new Date(`${paramStart}T12:00:00Z`))
    : collectingSince ? weekStartUtc(new Date(collectingSince)) : todayWk;
  const effectiveEnd = paramEnd
    ? weekStartUtc(new Date(`${paramEnd}T12:00:00Z`))
    : todayWk;
  const weekStarts: string[] = [];
  { const d = new Date(`${effectiveStart}T00:00:00Z`), e = new Date(`${effectiveEnd}T00:00:00Z`);
    while (d <= e && weekStarts.length < 156) { weekStarts.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7); } }
  const weeks = Math.max(1, weekStarts.length);
  const windowStart = effectiveStart;

  // ── Wave 2: rolled+raw event rows + today's raw events — run in parallel ──
  const evReq = pool.request();
  if (!superadmin) evReq.input("tenant", mssql.NVarChar, rds.tenant);
  let dateLoDly = "", dateLoEvt = "", dateHiDly = "", dateHiEvt = "";
  if (paramStart) {
    evReq.input("ws", mssql.Date, effectiveStart);
    dateLoDly = "AND [day] >= @ws";
    dateLoEvt = "AND at >= @ws";
  }
  if (paramEnd) {
    const endIncl = new Date(`${effectiveEnd}T00:00:00Z`);
    endIncl.setUTCDate(endIncl.getUTCDate() + 6);
    evReq.input("we", mssql.Date, endIncl.toISOString().slice(0, 10));
    dateHiDly = "AND [day] <= @we";
    // Keep `at` bare on the left side so SQL Server can seek the
    // tenant/date index instead of evaluating CONVERT for every raw event.
    dateHiEvt = "AND at < DATEADD(DAY, 1, @we)";
  }
  const contextColumn = includeDetails
    ? "ISNULL(context,'') AS context"
    : "CAST('' AS NVARCHAR(200)) AS context";
  const contextGroup = includeDetails ? ", context" : "";
  const evP = evReq.query(`
    SELECT tenant_id, [day], user_id, MAX(username) AS username, MAX([role]) AS [role],
           kind, feature, MAX(context) AS context, is_system, SUM(cnt) AS cnt
    FROM (
      SELECT tenant_id, [day], user_id, username, [role], kind, feature, ${contextColumn}, is_system, cnt
      FROM dbo.rmone_usage_daily WHERE 1=1 ${dateLoDly} ${dateHiDly} ${tenantFilter}
      UNION ALL
      SELECT tenant_id, CONVERT(DATE, at) AS [day], user_id, username, [role], kind, feature, ${contextColumn}, is_system, cnt
      FROM dbo.rmone_usage_events WHERE 1=1 ${dateLoEvt} ${dateHiEvt} ${tenantFilter}
    ) u
    GROUP BY tenant_id, [day], user_id, kind, feature${contextGroup}, is_system
  `);

  const todayUtc = new Date().toISOString().slice(0, 10);
  const rawP: Promise<{ recordset?: unknown[] }> = includeDetails
    ? (() => {
        const rawReq = pool.request().input("todayStart", mssql.Date, todayUtc);
        const tomorrow = new Date(`${todayUtc}T00:00:00Z`);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        rawReq.input("tomorrowStart", mssql.Date, tomorrow.toISOString().slice(0, 10));
        let rawFilter = "";
        if (!superadmin) {
          rawReq.input("tenant2", mssql.NVarChar, rds.tenant);
          rawFilter = "AND tenant_id = @tenant2";
        }
        return rawReq.query(`
          SELECT tenant_id, at, user_id, username, [role], kind, feature, ISNULL(context,'') AS context, is_system, cnt
          FROM dbo.rmone_usage_events
          WHERE at >= @todayStart AND at < @tomorrowStart ${rawFilter}
          ORDER BY at DESC
        `);
      })()
    : Promise.resolve({ recordset: [] });

  const [evQ, rawQ] = await Promise.all([evP, rawP]);
  const rows = (evQ.recordset ?? []) as UsageRow[];
  // Today's raw rows feed the drill drawers only (timestamps instead of bare
  // dates). They must respect the requested window: a custom range that ends
  // before today must not surface today's events in a drill while the tiles
  // honestly report zero. Aggregates already come from the window-filtered
  // rows; this gate keeps the drills consistent with them.
  const windowEndIncl = (() => {
    const e = new Date(`${effectiveEnd}T00:00:00Z`);
    e.setUTCDate(e.getUTCDate() + 6);
    return e.toISOString().slice(0, 10);
  })();
  const todayInWindow =
    (!paramStart || effectiveStart <= todayUtc) &&
    (!paramEnd || windowEndIncl >= todayUtc);
  const rawTodayRows = todayInWindow ? ((rawQ.recordset ?? []) as RawEventRow[]) : [];

    // ── Aggregate per tenant ──
    // Canonical grouping key = tenant GUID. Events carry the LABEL (same
    // app-DB convention as onboarding history); rmone_users carries the GUID.
    // resolveTenantId maps label→GUID and passes GUIDs through unchanged.
    const tenantGuidMemo = new Map<string, string>();
    const tidOf = (raw: string) => {
      const key = (raw ?? "").trim().toLowerCase();
      const known = tenantGuidMemo.get(key);
      if (known) return known;
      const guid = resolveTenantId(raw).toLowerCase();
      tenantGuidMemo.set(key, guid);
      return guid;
    };
    const labelByGuid = new Map<string, string>();
    if (!superadmin) labelByGuid.set(tidOf(rds.tenant), rds.tenant);
    const usersByGuid = new Map<string, EnabledUser[]>();
    const rowsByGuid = new Map<string, UsageRow[]>();
    const rawRowsByGuid = new Map<string, RawEventRow[]>();
    for (const user of enabledUsers) {
      const guid = tidOf(user.tenant_id);
      const list = usersByGuid.get(guid) ?? [];
      list.push(user);
      usersByGuid.set(guid, list);
    }
    for (const r of rows) {
      const g = tidOf(r.tenant_id);
      if (!labelByGuid.has(g)) labelByGuid.set(g, r.tenant_id);
      const list = rowsByGuid.get(g) ?? [];
      list.push(r);
      rowsByGuid.set(g, list);
    }
    for (const r of rawTodayRows) {
      const g = tidOf(r.tenant_id);
      const list = rawRowsByGuid.get(g) ?? [];
      list.push(r);
      rawRowsByGuid.set(g, list);
    }
    if (superadmin) {
      // Labels for user-only tenants (enabled users but no events yet) —
      // onboarding history is the broadest label registry we have. A GUID
      // with no known label falls back to displaying the GUID (honest, rare).
      const lblQ = await pool.request().query(`SELECT DISTINCT tenant_id FROM dbo.rmone_onboarding_jobs`);
      for (const row of (lblQ.recordset ?? []) as { tenant_id: string | null }[]) {
        const raw = (row.tenant_id ?? "").trim();
        if (!raw) continue;
        const g = tidOf(raw);
        if (!labelByGuid.has(g)) labelByGuid.set(g, raw);
      }
    }

    const tenantSet = new Set<string>();
    usersByGuid.forEach((_users, guid) => tenantSet.add(guid));
    rowsByGuid.forEach((_rows, guid) => tenantSet.add(guid));
    if (!superadmin) { tenantSet.clear(); tenantSet.add(tidOf(rds.tenant)); }

    const tenants = [...tenantSet]
      .sort((a, b) => (labelByGuid.get(a) ?? a).localeCompare(labelByGuid.get(b) ?? b))
      .map((guid) => {
      const tenant = labelByGuid.get(guid) ?? guid;
       const tUsers = usersByGuid.get(guid) ?? [];
       const tRows = rowsByGuid.get(guid) ?? [];
      // Today's un-rolled raw events for this tenant — used in drill rows only.
       const tRawRows = rawRowsByGuid.get(guid) ?? [];

      // Per-user aggregation (humans only for activity/adoption).
      const byUser = new Map<string, {
        username: string; role: string | null;
        logins: number; visits: number; tx: number;
        weeksWithLogin: Set<string>; weeksActive: Set<string>;
        modules: Set<string>; // distinct SPA modules visited
      }>();
      let pageVisits = 0, humanTx = 0, logins = 0, humanEvents = 0, systemEvents = 0;
      const featureCounts = new Map<string, number>();
      const txHuman = new Map<string, number>();
      const txSystem = new Map<string, number>();
      const weeklyActivity = new Map<string, number>();
      const weeklyUsers = new Map<string, Set<string>>();
      const weeklyAllocEditsMap = new Map<string, number>();     // week → alloc_update tx count
      const weeklyModulesMap = new Map<string, Set<string>>();   // week → distinct modules visited
      const importWeekSet = new Set<string>(); // weeks that had ≥1 data_import

      for (const r of tRows) {
        const wk = weekStartUtc(new Date(r.day));
        if (r.is_system) {
          systemEvents += r.cnt;
          if (r.kind === "tx") {
            txSystem.set(r.feature, (txSystem.get(r.feature) ?? 0) + r.cnt);
            if (r.feature === "data_import") importWeekSet.add(wk);
          }
          continue;
        }
        humanEvents += r.cnt;
        weeklyActivity.set(wk, (weeklyActivity.get(wk) ?? 0) + r.cnt);
        let u = byUser.get(r.user_id);
        if (!u) {
          u = { username: r.username, role: r.role, logins: 0, visits: 0, tx: 0, weeksWithLogin: new Set(), weeksActive: new Set(), modules: new Set() };
          byUser.set(r.user_id, u);
        }
        u.weeksActive.add(wk);
        if (!weeklyUsers.has(wk)) weeklyUsers.set(wk, new Set());
        weeklyUsers.get(wk)!.add(r.user_id);
        if (r.kind === "login") { logins += r.cnt; u.logins += r.cnt; u.weeksWithLogin.add(wk); }
        else if (r.kind === "page") {
          pageVisits += r.cnt; u.visits += r.cnt;
          featureCounts.set(r.feature, (featureCounts.get(r.feature) ?? 0) + r.cnt);
          u.modules.add(r.feature);
          // Track distinct modules visited per week (across all users)
          if (!weeklyModulesMap.has(wk)) weeklyModulesMap.set(wk, new Set());
          weeklyModulesMap.get(wk)!.add(r.feature);
        } else if (r.kind === "tx") {
          humanTx += r.cnt; u.tx += r.cnt;
          txHuman.set(r.feature, (txHuman.get(r.feature) ?? 0) + r.cnt);
          // Track allocation edits per week
          if (r.feature === "allocation_update") {
            weeklyAllocEditsMap.set(wk, (weeklyAllocEditsMap.get(wk) ?? 0) + r.cnt);
          }
        }
      }

      // Login-frequency bands over the users active in the window.
      const bands = { every: 0, most: 0, occasional: 0 };
      // Also compute average distinct modules per login-frequency band. The
      // individual member lists are evidence for a drill drawer, so skip
      // building and serializing them on the summary-only path.
      let consistentModuleSum = 0, consistentCount = 0;
      let occasionalModuleSum = 0, occasionalCount = 0;
      type BreadthMember = { username: string; role: string; modules: number; moduleNames: string[]; weeksLoggedIn: number; logins: number; visits: number };
      const consistentMembers: BreadthMember[] = [];
      const occasionalMembers: BreadthMember[] = [];
      for (const u of byUser.values()) {
        const n = u.weeksWithLogin.size;
        if (n === 0) continue;
        const member: BreadthMember | null = includeDetails ? {
          username: u.username,
          role: u.role ?? "",
          modules: u.modules.size,
          moduleNames: [...u.modules].sort(),
          weeksLoggedIn: n,
          logins: u.logins,
          visits: u.visits,
        } : null;
        if (n >= weeks) {
          bands.every++;
          consistentModuleSum += u.modules.size;
          consistentCount++;
          if (member) consistentMembers.push(member);
        } else if (n >= Math.ceil(weeks * 0.6)) {
          bands.most++;
          // "most" users included in consistent avg for better sample size
          consistentModuleSum += u.modules.size;
          consistentCount++;
          if (member) consistentMembers.push(member);
        } else {
          bands.occasional++;
          occasionalModuleSum += u.modules.size;
          occasionalCount++;
          if (member) occasionalMembers.push(member);
        }
      }

      // Never-active list: enabled users with ZERO observed human events.
      const activeIds = new Set([...byUser.keys()].map((k) => k.toLowerCase()));
      const neverActive = tUsers.filter((u) => !activeIds.has(u.id.toLowerCase()));

      // Adoption numerator counts only CURRENTLY-ENABLED users. Activity from
      // since-disabled accounts is still listed (it happened) but must never
      // push adoption above 100% against the enabled-user denominator.
      const enabledIds = new Set(tUsers.map((u) => u.id.toLowerCase()));
      const activeEnabled = [...byUser.keys()].filter((id) => enabledIds.has(id.toLowerCase())).length;

      const activeRows = [...byUser.entries()]
        .map(([id, u]) => ({
          _person: id,
          user: u.username,
          role: enabledIds.has(id.toLowerCase()) ? (u.role ?? "") : `${u.role ?? ""} (account disabled)`.trim(),
          logins: u.logins, visits: u.visits, tx: u.tx,
          weeksActive: u.weeksActive.size,
        }))
        .sort((a, b) => (b.logins + b.visits + b.tx) - (a.logins + a.visits + a.tx));

      // Phase 2 — usage → outcomes metrics.
      // All numbers derived purely from observed telemetry — no estimation.
      const allocEditHuman = txHuman.get("allocation_update") ?? 0;

      // Weekly series for sparklines — null means NO activity was recorded
      // in that week (genuine gap, not a zero). The client renders gaps.
      const weeklyAllocEdits = weekStarts.map((wk) => {
        const edits = weeklyAllocEditsMap.get(wk) ?? null;
        const wau = weeklyUsers.get(wk)?.size ?? 0;
        // Rate = edits / WAU for the week; null if no users that week
        return {
          week: wk,
          rate: edits !== null && wau > 0
            ? Math.round((edits / wau) * 100) / 100
            : null,
        };
      });

      // Weekly distinct modules visited (across all users, not per-band)
      const weeklyDistinctModules = weekStarts.map((wk) => ({
        week: wk,
        distinctModules: weeklyModulesMap.get(wk)?.size ?? null,
      }));

      const outcomes = {
        /** Average allocation_update transactions per active user per week.
         *  null when there are no active users (avoids division by zero). */
        allocEditsPerUserWeek:
          activeEnabled > 0 && weeks > 0
            ? Math.round((allocEditHuman / activeEnabled / weeks) * 100) / 100
            : null,
        /** Total allocation edits (human) in the window. */
        allocEditsTotal: allocEditHuman,
        /** Average distinct SPA modules visited by consistent users
         *  (logged in every week or most weeks). null if no such users. */
        avgModulesConsistent: consistentCount > 0
          ? Math.round((consistentModuleSum / consistentCount) * 10) / 10
          : null,
        /** Average distinct SPA modules visited by occasional users. null if none. */
        avgModulesOccasional: occasionalCount > 0
          ? Math.round((occasionalModuleSum / occasionalCount) * 10) / 10
          : null,
        /** Number of users counted as consistent (every + most weeks). */
        consistentUsers: consistentCount,
        /** Number of users counted as occasional. */
        occasionalUsers: occasionalCount,
        // Per-user evidence stays with the on-demand drill response.
        ...(includeDetails ? { consistentMembers, occasionalMembers } : {}),
        /** The actual ISO week-start strings that had ≥1 data import.
         *  Returning identities (not just a count) lets the client union
         *  weeks correctly across tenants in the all-tenant scope. */
        importWeeks: [...importWeekSet],
        /** Total weeks in the window (for context). */
        totalWeeks: weeks,
        /** Weekly allocation edit RATE (edits/WAU) series for sparklines.
         *  null rate = no activity that week (genuine gap, not a zero). */
        weeklyAllocEdits,
        /** Weekly distinct module count for sparklines.
         *  null distinctModules = no page visits that week (gap). */
        weeklyDistinctModules,
      };

      // Normalise the role label (stored as-is in rmone_users.role) into
      // a display-friendly key. Unknown / blank values fall back to "User".
      const roleCounts: Record<string, number> = {};
      for (const u of tUsers) {
        const raw = (u.role ?? "").trim().toLowerCase();
        const label =
          raw === "admin"   ? "Admin"   :
          raw === "manager" ? "Manager" :
          raw === "user"    ? "User"    :
          raw               ? raw.charAt(0).toUpperCase() + raw.slice(1) : "User";
        roleCounts[label] = (roleCounts[label] ?? 0) + 1;
      }

      return {
        tenant,
        enabledUsers: tUsers.length,
        managers: tUsers.filter((u) => u.is_manager).length,
        roleCounts,
        activeUsers: activeEnabled,
        logins,
        pageVisits,
        humanTx,
        humanEvents,
        systemEvents,
        weekly: weekStarts.map((wk) => ({
          week: wk,
          activity: weeklyActivity.get(wk) ?? 0,
          wau: weeklyUsers.get(wk)?.size ?? 0,
        })),
        features: [...featureCounts.entries()]
          .map(([name, visits]) => ({ name, visits }))
          .sort((a, b) => b.visits - a.visits),
        txByType: [...new Set([...txHuman.keys(), ...txSystem.keys()])]
          .map((type) => ({ type, human: txHuman.get(type) ?? 0, system: txSystem.get(type) ?? 0 }))
          .sort((a, b) => (b.human + b.system) - (a.human + a.system)),
        loginBands: bands,
        outcomes,
        activeUserRows: activeRows.slice(0, ROW_CAP),
        activeUserTotal: activeRows.length,
        neverActiveRows: neverActive
          .slice(0, ROW_CAP)
          .map((u) => ({ _person: u.id, user: u.name || u.username, username: u.username, role: u.role ?? "" })),
        neverActiveTotal: neverActive.length,
        // Full uncapped list of display names for enabled users who WERE
        // active in the selected window — used by the org-adoption chart on
        // the client where a Set membership check is cheaper than the large
        // never-active list (which can exceed ROW_CAP and produce wrong %).
        activeUserNames: tUsers
          .filter((u) => activeIds.has(u.id.toLowerCase()))
          .map((u) => (u.name || u.username).toLowerCase().trim()),
        // Event-level rows are intentionally deferred until an admin opens a
        // drawer. They are useful evidence, but unnecessary for the summary
        // dashboard and can make cross-tenant responses much larger.
        ...(includeDetails ? {
        // Per-(user, page/type, day) detail rows for the three drill drawers.
        // For historical (rolled) days, tRows are grouped by (user_id, kind,
        // feature, day).  For today, we substitute individual raw-event rows
        // so admins see "Aug 17 at 11:20 AM" rather than just the date.
        // Raw rows carry an `at` ISO datetime and `context`; rolled rows carry
        // only `day` and `context`.  Sort newest first.
        pageVisitRows: (() => {
          const tRaw = tRawRows.filter((r) => r.kind === "page" && !r.is_system).map((r) => ({
            feature: r.feature, context: r.context ?? "", user: r.username, role: r.role ?? "",
            day: (r.at instanceof Date ? r.at : new Date(r.at as string)).toISOString().slice(0, 10),
            at: (r.at instanceof Date ? r.at : new Date(r.at as string)).toISOString(),
            cnt: r.cnt,
          }));
          const tHist = tRows
            .filter((r) => r.kind === "page" && !r.is_system)
            .map((r) => {
              const d = (r.day instanceof Date ? r.day : new Date(r.day as string)).toISOString().slice(0, 10);
              return { feature: r.feature, context: r.context ?? "", user: r.username, role: r.role ?? "", day: d, at: undefined as string | undefined, cnt: r.cnt };
            })
            .filter((r) => r.day < todayUtc);
          return [...tRaw, ...tHist].sort((a, b) => (b.at ?? b.day).localeCompare(a.at ?? a.day)).slice(0, ROW_CAP);
        })(),
        pageVisitTotal: tRows.filter((r) => r.kind === "page" && !r.is_system).length,
        loginDetailRows: (() => {
          const tRaw = tRawRows.filter((r) => r.kind === "login" && !r.is_system).map((r) => ({
            user: r.username, role: r.role ?? "",
            day: (r.at instanceof Date ? r.at : new Date(r.at as string)).toISOString().slice(0, 10),
            at: (r.at instanceof Date ? r.at : new Date(r.at as string)).toISOString(),
            cnt: r.cnt,
          }));
          const tHist = tRows
            .filter((r) => r.kind === "login" && !r.is_system)
            .map((r) => {
              const d = (r.day instanceof Date ? r.day : new Date(r.day as string)).toISOString().slice(0, 10);
              return { user: r.username, role: r.role ?? "", day: d, at: undefined as string | undefined, cnt: r.cnt };
            })
            .filter((r) => r.day < todayUtc);
          return [...tRaw, ...tHist].sort((a, b) => (b.at ?? b.day).localeCompare(a.at ?? a.day)).slice(0, ROW_CAP);
        })(),
        loginDetailTotal: tRows.filter((r) => r.kind === "login" && !r.is_system).length,
        txDetailRows: (() => {
          const tRaw = tRawRows.filter((r) => r.kind === "tx" && !r.is_system).map((r) => ({
            feature: r.feature, context: r.context ?? "", user: r.username, role: r.role ?? "",
            day: (r.at instanceof Date ? r.at : new Date(r.at as string)).toISOString().slice(0, 10),
            at: (r.at instanceof Date ? r.at : new Date(r.at as string)).toISOString(),
            cnt: r.cnt,
          }));
          const tHist = tRows
            .filter((r) => r.kind === "tx" && !r.is_system)
            .map((r) => {
              const d = (r.day instanceof Date ? r.day : new Date(r.day as string)).toISOString().slice(0, 10);
              return { feature: r.feature, context: r.context ?? "", user: r.username, role: r.role ?? "", day: d, at: undefined as string | undefined, cnt: r.cnt };
            })
            .filter((r) => r.day < todayUtc);
          return [...tRaw, ...tHist].sort((a, b) => (b.at ?? b.day).localeCompare(a.at ?? a.day)).slice(0, ROW_CAP);
        })(),
        txDetailTotal: tRows.filter((r) => r.kind === "tx" && !r.is_system).length,
        } : {}),
      };
    });

  const payload = {
    available: true,
    scope: superadmin ? "all" : "tenant",
    weeks,
    windowStart,
    windowEnd: new Date().toISOString().slice(0, 10),
    weekStarts,
    collectingSince,
    generatedAt: new Date().toISOString(),
    tenants,
  };
  // Store + share only if no bust superseded this compute while it ran.
  if ((_analyticsGen.get(cacheKey) ?? 0) === genAtStart) analyticsStore(cacheKey, payload);
  return payload;
}

/* ── Allocation Edit Log ── */

/**
 * GET /usage-analytics/alloc-edits
 * Returns individual allocation-save events with project name lookup and
 * before/after hour totals (when captured by the /hours-allocation route).
 * Same auth gate as the main payload (admin-only per tenant; superadmin sees all).
 * Accepts optional ?start=YYYY-MM-DD&end=YYYY-MM-DD bounds.
 *
 * Context format (written by /hours-allocation):
 *  - New events: JSON {"p":"<projectId>","b":<hoursBefore>,"a":<hoursAfter>}
 *    where b/a are omitted when the pre-read could not be performed.
 *  - Legacy events: bare numeric project ID string.
 * Both formats are handled transparently.
 */
router.get("/usage-analytics/alloc-edits", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  const superadmin = isSuperAdminSource(rds);
  if (!superadmin && !(await canViewUsageAnalytics(rds).catch(() => false))) {
    res.status(403).json({ error: "forbidden", detail: "Usage Analytics is not available for your access level." }); return;
  }

  const isDateStr = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const paramStart = isDateStr(req.query["start"]) ? req.query["start"] : null;
  const paramEnd   = isDateStr(req.query["end"])   ? req.query["end"]   : null;

  try {
    const pool = await getMssqlPool();

    // Build event query with optional tenant + date filters.
    let evFilter = "";
    const evReq = pool.request();
    if (!superadmin) { evReq.input("tenant", mssql.NVarChar, rds.tenant); evFilter = "AND e.tenant_id = @tenant"; }
    let dateLo = "", dateHi = "";
    if (paramStart) { evReq.input("ws", mssql.Date, paramStart); dateLo = "AND CONVERT(DATE, e.at) >= @ws"; }
    if (paramEnd)   { evReq.input("we", mssql.Date, paramEnd);   dateHi = "AND CONVERT(DATE, e.at) <= @we"; }

    const evQ = await evReq.query(`
      SELECT TOP 300
        e.tenant_id,
        CONVERT(NVARCHAR(30), e.at, 126) AS at_iso,
        e.user_id, e.username, e.role,
        ISNULL(e.context,'') AS context,
        e.cnt
      FROM dbo.rmone_usage_events e
      WHERE e.feature = 'allocation_update'
        AND e.is_system = 0
        ${dateLo} ${dateHi} ${evFilter}
      ORDER BY e.at DESC
    `);

    interface RawAllocRow {
      tenant_id: string; at_iso: string; user_id: string;
      username: string; role: string | null; context: string; cnt: number;
    }
    const evRows = (evQ.recordset ?? []) as RawAllocRow[];

    // Parse the context field for each event.
    // New format: {"p":"<projectId>","b":<hoursBefore>,"a":<hoursAfter>} (b/a optional)
    // Legacy format: bare numeric project ID string.
    interface ParsedCtx { projectId: string; hoursBefore: number | null; hoursAfter: number | null }
    function parseAllocContext(raw: string): ParsedCtx {
      const s = (raw ?? "").trim();
      if (s.startsWith("{")) {
        try {
          const j = JSON.parse(s) as { p?: unknown; b?: unknown; a?: unknown };
          return {
            projectId: String(j.p ?? ""),
            hoursBefore: j.b != null ? Number(j.b) : null,
            hoursAfter:  j.a != null ? Number(j.a) : null,
          };
        } catch { /* fall through to legacy treatment */ }
      }
      // Legacy: bare numeric project ID
      return { projectId: s, hoursBefore: null, hoursAfter: null };
    }

    const parsedContexts = evRows.map((r) => ({ row: r, ctx: parseAllocContext(r.context) }));

    // Batch-resolve project names from ResourceWorkItems using the numeric project ID.
    const numericIds = [...new Set(parsedContexts.map((pc) => pc.ctx.projectId).filter((c) => /^\d+$/.test(c)))].slice(0, 100);
    const projectMap = new Map<string, { ticketId: string; title: string }>();
    if (numericIds.length > 0) {
      const pReq = pool.request();
      if (!superadmin) pReq.input("tid", mssql.NVarChar, rds.tid);
      const tidFilter = superadmin ? "" : "AND TenantID = @tid";
      // IDs are validated as digit-only above — safe to inline.
      const pQ = await pReq.query(`
        SELECT CAST(ID AS NVARCHAR) AS id,
               ISNULL(TicketId,'')          AS ticketId,
               ISNULL(Title,'(untitled)')   AS title
        FROM dbo.ResourceWorkItems
        WHERE ID IN (${numericIds.join(",")}) ${tidFilter}
      `);
      for (const p of (pQ.recordset ?? []) as { id: string; ticketId: string; title: string }[]) {
        projectMap.set(p.id, { ticketId: p.ticketId, title: p.title });
      }
    }

    const rows = parsedContexts.map(({ row: r, ctx }) => {
      const proj = projectMap.get(ctx.projectId) ?? null;
      return {
        at: r.at_iso,
        username: r.username,
        role: r.role,
        tenant: r.tenant_id,
        projectId: ctx.projectId,
        projectTicketId: proj?.ticketId ?? null,
        projectTitle: proj?.title ?? null,
        cellsSaved: r.cnt,
        hoursBefore: ctx.hoursBefore,
        hoursAfter:  ctx.hoursAfter,
      };
    });

    const todayUtc = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

    res.json({ rows, total: rows.length });
  } catch (e) {
    console.warn("[usage-analytics/alloc-edits] failed:", String(e).slice(0, 300));
    res.status(500).json({ error: "alloc_edit_log_failed", detail: String(e).slice(0, 200) });
  }
});

export default router;
