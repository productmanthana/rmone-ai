/* ─────────────────────────────────────────────────────────────────────────
 * Actuals vs Forecast — weekly snapshot job.
 *
 * Computes each project's point-in-time series (engine: actuals-forecast.ts)
 * and persists it (store: actuals-forecast-store.ts). Runs hourly on the
 * LEAD worker only, in production (or AF_SNAPSHOT_JOB=on), guarded by an
 * app-DB applock so multiple EB instances never double-write.
 *
 * Freeze semantics live in the store: finalizeDueWeeks() flips fully-elapsed
 * weeks to [final]=1 BEFORE each recompute, so a week's forecast columns keep
 * whatever the last run during that week saw — history is never rewritten
 * from today's plan (Don's core rule).
 * ──────────────────────────────────────────────────────────────────────── */
import { getActiveTenantRegistry, getEnabledUsersByTenant, getMssqlPool, mssql } from "@workspace/db";
import { getFinancialAllocationRowsRds } from "./rds-provider.js";
import { loadEffectiveDefaults } from "./onboarding-settings-store.js";
import {
  buildTicketPlans,
  computeProjectAf,
  currentWeekMsUtcMinus12,
  normalizeRoleRates,
  type AfActualRow,
  type AfFlags,
} from "./actuals-forecast.js";
import {
  finalizeDueWeeks,
  loadActualRows,
  readSnapshotTickets,
  tenantsWithActuals,
  writeSnapshotSeries,
} from "./actuals-forecast-store.js";
import { WEEK } from "./financial-analytics.js";

const INCREMENTAL_LOOKBACK_WEEKS = 8;

/** First builds and manual rebuilds materialize at most this much history
 * (AF_BACKFILL_WEEKS env to tune; opts.fullHistory to override). Safe bound:
 * the engine folds pre-window plan+actual activity into cumulatives before
 * emitting, so every TD/variance/EAC number stays exact — older weeks are
 * simply not materialized as rows. Unbounded first builds on legacy tenants
 * (15 years × thousands of tickets) held the per-tenant applock for hours,
 * which also made import commits hit the 60s lock timeout. */
const DEFAULT_BACKFILL_WEEKS = 104;
function backfillWeeks(): number {
  const n = Number(process.env.AF_BACKFILL_WEEKS);
  return Number.isFinite(n) && n >= 8 ? Math.floor(n) : DEFAULT_BACKFILL_WEEKS;
}

export interface AfRunStats {
  tenant: string;
  tickets: number;
  weeksWritten: number;
  weeksRestated: number;
  skipped?: string;
}

/** Compute + persist snapshots for one tenant.
 *  - default (incremental): tickets that already have history recompute from
 *    currentWeek − 8w; brand-new tickets get their full series.
 *  - backfill: recompute every ticket's full series (or from opts.fromWeekMs)
 *    — frozen weeks still only have their ACTUAL side restated. */
export async function runAfSnapshotsForTenant(
  tid: string,
  tenantLabel: string,
  opts: { tickets?: string[]; backfill?: boolean; fromWeekMs?: number; fullHistory?: boolean } = {},
): Promise<AfRunStats> {
  // EVERY snapshot writer (hourly sweep, manual /rebuild, import commit)
  // serializes per tenant here — two concurrent runs would race
  // finalizeDueWeeks/delete-replace on the same rows. Waits up to 60s for
  // the tenant lock, then fails LOUDLY (never a silent skip).
  const start = await startAfSnapshotsForTenant(tid, tenantLabel, opts, 60_000);
  if (!start.started) {
    throw new Error("af-snapshot lock timeout - another rebuild for this tenant is running");
  }
  return start.done;
}

/** Atomically acquire the per-tenant snapshot applock (waiting at most
 * `lockWaitMs`), then run the build. Returns `{ started: false }` WITHOUT
 * queuing when the lock is busy — the caller decides (409 for the manual
 * rebuild route, loud throw for import commits via the wrapper above).
 * When `{ started: true }`, the lock is ALREADY HELD at return time (so
 * `isAfBuildInProgress` / the overview `building` flag are immediately
 * true) and `done` resolves with the run's stats. Probe-then-start was a
 * TOCTOU race: two concurrent requests could both see the lock free, and
 * the loser queued 60s on the applock tying up a DB connection. */
export async function startAfSnapshotsForTenant(
  tid: string,
  tenantLabel: string,
  opts: { tickets?: string[]; backfill?: boolean; fromWeekMs?: number; fullHistory?: boolean } = {},
  lockWaitMs = 0,
): Promise<{ started: false } | { started: true; done: Promise<AfRunStats> }> {
  const pool = await getMssqlPool();
  const tx = new mssql.Transaction(pool);
  await tx.begin();
  let rc: number;
  try {
    const r = await new mssql.Request(tx)
      .input("res", mssql.NVarChar, `rmone:af-snap:${tid.trim().toLowerCase()}`)
      .input("wait", mssql.Int, Math.max(0, Math.floor(lockWaitMs)))
      .query(
        `DECLARE @r INT;
         EXEC @r = sp_getapplock @Resource=@res, @LockMode='Exclusive',
                                 @LockOwner='Transaction', @LockTimeout=@wait;
         SELECT @r AS rc;`,
      );
    rc = Number(r.recordset?.[0]?.rc ?? -999);
  } catch (e) {
    // Genuine acquisition ERROR (connection, SQL) — never report as "busy".
    try { await tx.rollback(); } catch { /* gone */ }
    throw e;
  }
  if (rc < 0) {
    // 0/1 = granted (immediately / after wait); negatives = timeout etc.
    try { await tx.rollback(); } catch { /* gone */ }
    return { started: false };
  }
  const done = (async () => {
    try {
      return await runAfSnapshotsForTenantLocked(tid, tenantLabel, opts);
    } finally {
      // Commit (or rollback) releases the applock.
      try { await tx.commit(); } catch { try { await tx.rollback(); } catch { /* gone */ } }
    }
  })();
  return { started: true, done };
}

async function runAfSnapshotsForTenantLocked(
  tid: string,
  tenantLabel: string,
  opts: { tickets?: string[]; backfill?: boolean; fromWeekMs?: number; fullHistory?: boolean } = {},
): Promise<AfRunStats> {
  const currentWeekMs = currentWeekMsUtcMinus12();
  await finalizeDueWeeks(tid);

  const defaults = await loadEffectiveDefaults(tenantLabel).catch(() => null);
  const flags: AfFlags = {
    useImportedActuals: defaults?.useImportedActuals !== false,
    usePlannedAsActualFallback: defaults?.usePlannedAsActualFallback === true,
  };

  const [leg, actuals, existingTickets, users] = await Promise.all([
    getFinancialAllocationRowsRds(tid, tenantLabel),
    loadActualRows(tid),
    readSnapshotTickets(tid),
    getEnabledUsersByTenant(tid).catch(() => []),
  ]);
  const plans = buildTicketPlans(leg.rows, leg.workWeekHours);
  const roleRates = normalizeRoleRates(leg.roleRates);
  const personNames = new Map<string, string>();
  for (const u of users) {
    const id = String(u.id ?? "").trim().toLowerCase();
    if (id) personNames.set(id, String(u.name || u.username || "").trim());
  }

  const byTicket = new Map<string, AfActualRow[]>();
  for (const a of actuals) {
    const arr = byTicket.get(a.ticket);
    if (arr) arr.push(a);
    else byTicket.set(a.ticket, [a]);
  }

  let tickets: string[];
  if (opts.tickets && opts.tickets.length) {
    tickets = [...new Set(opts.tickets.map((t) => t.trim()).filter(Boolean))];
  } else {
    tickets = [...new Set([...plans.keys(), ...byTicket.keys()])];
  }

  // Most-recently-active tickets first: during a long (re)build the overview
  // and picker fill with the projects people actually look at within the
  // first minute, and PMM/OPM interleave by recency instead of raw RA row
  // order (raw order starved PMM projects for hours on legacy tenants).
  const lastActivity = new Map<string, number>();
  for (const [tk, plan] of plans) {
    let m = 0;
    for (const pp of plan.people.values())
      for (const rp of pp.roles.values())
        for (const w of rp.weeks.keys()) if (w > m) m = w;
    lastActivity.set(tk, m);
  }
  for (const [tk, arr] of byTicket) {
    let m = lastActivity.get(tk) ?? 0;
    for (const a of arr) if (a.weekMs > m) m = a.weekMs;
    lastActivity.set(tk, m);
  }
  tickets.sort((a, b) => (lastActivity.get(b) ?? 0) - (lastActivity.get(a) ?? 0));

  const boundedFromMs = opts.fullHistory ? undefined : currentWeekMs - backfillWeeks() * WEEK;
  let weeksWritten = 0;
  let weeksRestated = 0;
  let done = 0;
  for (const ticket of tickets) {
    const plan = plans.get(ticket);
    const acts = byTicket.get(ticket) ?? [];
    if (!plan && !acts.length) continue;
    const incremental = !opts.backfill && existingTickets.has(ticket);
    const fromWeekMs = opts.backfill
      ? (opts.fromWeekMs ?? boundedFromMs)
      : incremental
        ? currentWeekMs - INCREMENTAL_LOOKBACK_WEEKS * WEEK
        : boundedFromMs;
    const series = computeProjectAf({
      ticket, plan, actuals: acts, roleRates, flags, currentWeekMs, fromWeekMs, personNames,
    });
    if (!series.weeks.length) continue;
    const w = await writeSnapshotSeries(tid, ticket, series.weeks, series.detail, { currentWeekMs });
    weeksWritten += w.written;
    weeksRestated += w.restated;
    done++;
  }
  return { tenant: tenantLabel || tid, tickets: done, weeksWritten, weeksRestated };
}

/* ── all-tenants sweep ────────────────────────────────────────────────── */

async function listSnapshotTenants(): Promise<Array<{ tid: string; label: string }>> {
  const out = new Map<string, { tid: string; label: string }>();
  try {
    for (const row of await getActiveTenantRegistry()) {
      const tid = row.tenantId.trim();
      if (tid) out.set(tid.toLowerCase(), { tid, label: row.tenantLabel.trim() || tid });
    }
  } catch (e) {
    console.warn(`[af-snapshot] tenant registry unavailable: ${String(e).slice(0, 120)}`);
  }
  // Tenants with imported actuals but no registry entry still need snapshots.
  try {
    for (const tid of await tenantsWithActuals()) {
      const k = tid.trim().toLowerCase();
      if (k && !out.has(k)) out.set(k, { tid: tid.trim(), label: tid.trim() });
    }
  } catch (e) {
    console.warn(`[af-snapshot] actuals tenant scan failed: ${String(e).slice(0, 120)}`);
  }
  return [...out.values()];
}

export async function runAfSnapshotsAllTenants(): Promise<AfRunStats[]> {
  const tenants = await listSnapshotTenants();
  const stats: AfRunStats[] = [];
  for (const t of tenants) {
    try {
      stats.push(await runAfSnapshotsForTenant(t.tid, t.label));
    } catch (e) {
      console.warn(`[af-snapshot] tenant ${t.label} failed: ${String(e).slice(0, 200)}`);
      stats.push({ tenant: t.label, tickets: 0, weeksWritten: 0, weeksRestated: 0, skipped: String(e).slice(0, 200) });
    }
  }
  return stats;
}

/** Serialize across instances: transaction-scoped applock on the app DB.
 * Returns null when another instance holds the lock (skip, don't queue). */
async function withAfLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const pool = await getMssqlPool();
  const tx = new mssql.Transaction(pool);
  await tx.begin();
  try {
    const r = await new mssql.Request(tx).query(
      `DECLARE @res int;
       EXEC @res = sp_getapplock @Resource = 'rmone_af_snapshot_job', @LockMode = 'Exclusive',
                                 @LockOwner = 'Transaction', @LockTimeout = 0;
       SELECT @res AS res;`,
    );
    if (Number(r.recordset?.[0]?.res ?? -1) < 0) return null; // busy elsewhere
    return await fn();
  } finally {
    // Commit releases the transaction-scoped lock; rollback would too.
    try { await tx.commit(); } catch { try { await tx.rollback(); } catch { /* gone */ } }
  }
}

let jobArmed = false;

/** Lead-worker only (call site in index.ts). Hourly; production-gated with an
 * AF_SNAPSHOT_JOB=on escape hatch for dev testing. */
export function startAfSnapshotJob(): void {
  if (jobArmed) return;
  jobArmed = true;
  const enabled = process.env.NODE_ENV === "production" || process.env.AF_SNAPSHOT_JOB === "on";
  if (!enabled) {
    console.log("[af-snapshot] job disabled outside production (AF_SNAPSHOT_JOB=on to enable)");
    return;
  }
  const tick = () => {
    withAfLock(async () => {
      const started = Date.now();
      const stats = await runAfSnapshotsAllTenants();
      const tot = stats.reduce((s, x) => s + x.weeksWritten + x.weeksRestated, 0);
      console.log(
        `[af-snapshot] swept ${stats.length} tenant(s), ${tot} week rows in ${Math.round((Date.now() - started) / 1000)}s`,
      );
    }).catch((e) => console.warn(`[af-snapshot] run failed: ${String(e).slice(0, 200)}`));
  };
  setTimeout(tick, 3 * 60_000).unref();   // shortly after boot
  setInterval(tick, 60 * 60_000).unref(); // hourly
  console.log("[af-snapshot] hourly snapshot job armed");
}
