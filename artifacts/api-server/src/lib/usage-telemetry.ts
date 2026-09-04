/**
 * Usage telemetry (#482) — the invisible recording layer behind the Usage
 * Analytics page.
 *
 * Design contract:
 *  - recordUsage() is SYNCHRONOUS and never throws: it pushes into an
 *    in-memory buffer and returns immediately. No request ever waits on
 *    telemetry, and a telemetry bug must never break an app request.
 *  - A lazy, unref'd timer flushes the buffer every few seconds as batched
 *    multi-row INSERTs into dbo.rmone_usage_events (app DB, SQL Server).
 *  - A failed flush re-queues the batch ONCE; a second failure drops it
 *    (counted + logged). Losing a few telemetry rows under DB duress is
 *    acceptable — blocking requests or growing memory unbounded is not.
 *  - USAGE_TELEMETRY_OFF=1 is the kill switch (disables recording AND the
 *    rollup schedule; the analytics endpoint then reports unavailable).
 *  - The hourly rollup (lead worker only) folds COMPLETE UTC days into
 *    dbo.rmone_usage_daily and deletes the rolled raw rows in the same
 *    transaction — so endpoint queries can aggregate "daily + raw" with no
 *    double counting, and the raw table stays small by construction.
 *
 * Event vocabulary (kind / feature):
 *  - "login"  / ""                    — successful password login
 *  - "page"   / "<ModuleName>"        — SPA module visit (client beacon)
 *  - "tx"     / "allocation_update" | "record_open" | "project_save" |
 *               "work_item_created" | "record_created" | "data_import"
 * is_system=1 marks automated activity (import pipeline bulk writes, cache
 * warmers, scheduled jobs) so the page can show an honest human-vs-system
 * split. Human counts NEVER include system rows.
 */
import { getMssqlPool, mssql } from "@workspace/db";
import { BACKGROUND_PROFILE, IS_DEPLOYED_SERVER } from "./deploy-env.js";

export type UsageKind = "login" | "page" | "tx";

export interface UsageActor {
  tenant: string;
  userId: string;
  username: string;
  role?: string | null;
}

interface UsageEvent {
  tenant: string;
  userId: string;
  username: string;
  role: string | null;
  kind: UsageKind;
  feature: string;
  /** Optional context: record ticket ID, page path segment, etc. Empty string = no context. */
  context: string;
  isSystem: boolean;
  cnt: number;
  at: Date;
  retried?: boolean;
}

/** Known non-human identities — their events are flagged is_system. */
const SYSTEM_USERNAMES = new Set(["__cache_warmer__", "cache-warmer"]);

const MAX_BUFFER = 5_000;   // hard cap — beyond this, drop (never grow unbounded)
const FLUSH_EVERY_MS = 5_000;
const FLUSH_AT = 200;       // flush early once the buffer reaches this
const ROWS_PER_INSERT = 50; // 50 rows × 9 params = 450 params per statement

let buffer: UsageEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;
let droppedTotal = 0;

export function usageTelemetryEnabled(): boolean {
  return process.env["USAGE_TELEMETRY_OFF"] !== "1";
}

/** Fire-and-forget. Safe to call from any request handler — never throws,
 *  never awaits, never blocks. */
export function recordUsage(
  actor: UsageActor,
  kind: UsageKind,
  feature = "",
  opts?: { system?: boolean; cnt?: number; context?: string },
): void {
  try {
    if (!usageTelemetryEnabled()) return;
    const tenant = (actor.tenant || "").trim();
    const username = (actor.username || "").trim();
    if (!tenant) return; // unattributable — record nothing rather than guess
    if (buffer.length >= MAX_BUFFER) { droppedTotal++; return; }
    const isSystem =
      opts?.system === true || username === "" || SYSTEM_USERNAMES.has(username.toLowerCase());
    buffer.push({
      tenant,
      userId: (actor.userId || username || "unknown").slice(0, 100),
      username: (username || "system").slice(0, 200),
      role: actor.role ? String(actor.role).slice(0, 200) : null,
      kind,
      feature: String(feature || "").slice(0, 120),
      context: String(opts?.context ?? "").slice(0, 200),
      isSystem,
      cnt: Math.max(1, Math.floor(opts?.cnt ?? 1)),
      at: new Date(),
    });
    ensureFlushTimer();
    // Tx events are single intentional actions (record open, save, etc.) —
    // flush immediately so they appear in the analytics DB within ~1s rather
    // than waiting up to the 5-second batch window.
    if (kind === "tx" || buffer.length >= FLUSH_AT) void flushUsageNow();
  } catch {
    /* telemetry must never break a request */
  }
}

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => { void flushUsageNow(); }, FLUSH_EVERY_MS);
  flushTimer.unref?.();
}

/** Inserts rows in autocommit chunks and reports how many rows are durably
 *  written. Each chunk commits independently, so a mid-batch failure must
 *  NEVER requeue earlier chunks — retrying the whole batch after chunk 1
 *  committed would inflate every aggregate. The one remaining ambiguity
 *  (connection dropped AFTER the server committed a chunk) is bounded to a
 *  single chunk retried at most once. */
async function insertBatch(rows: UsageEvent[]): Promise<{ written: number; error: unknown }> {
  const pool = await getMssqlPool();
  let written = 0;
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
    const chunk = rows.slice(i, i + ROWS_PER_INSERT);
    const req = pool.request();
    const values: string[] = [];
    chunk.forEach((e, j) => {
      req.input(`t${j}`, mssql.NVarChar, e.tenant);
      req.input(`u${j}`, mssql.NVarChar, e.userId);
      req.input(`n${j}`, mssql.NVarChar, e.username);
      req.input(`r${j}`, mssql.NVarChar, e.role);
      req.input(`k${j}`, mssql.NVarChar, e.kind);
      req.input(`f${j}`, mssql.NVarChar, e.feature);
      req.input(`x${j}`, mssql.NVarChar, e.context);
      req.input(`s${j}`, mssql.Bit, e.isSystem ? 1 : 0);
      req.input(`c${j}`, mssql.Int, e.cnt);
      req.input(`a${j}`, mssql.DateTime2, e.at);
      values.push(`(@t${j},@u${j},@n${j},@r${j},@k${j},@f${j},@x${j},@s${j},@c${j},@a${j})`);
    });
    try {
      await req.query(
        `INSERT INTO dbo.rmone_usage_events (tenant_id,user_id,username,[role],kind,feature,context,is_system,cnt,at)
         VALUES ${values.join(",")}`,
      );
      written += chunk.length;
    } catch (e) {
      return { written, error: e };
    }
  }
  return { written, error: null };
}

/** Drains the buffer. Exported for tests and graceful pre-response flushes —
 *  normal operation relies on the timer. Never throws. */
export async function flushUsageNow(): Promise<void> {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  const batch = buffer;
  buffer = [];
  try {
    const { written, error } = await insertBatch(batch);
    if (error) {
      // Only the UNWRITTEN tail may be requeued — everything before `written`
      // is committed. Re-queue once; drop for good on the second failure.
      const failed = batch.slice(written);
      const retryable = failed.filter((ev) => !ev.retried);
      const droppedNow = failed.length - retryable.length;
      retryable.forEach((ev) => { ev.retried = true; });
      if (buffer.length + retryable.length <= MAX_BUFFER) {
        buffer = retryable.concat(buffer);
      } else {
        droppedTotal += retryable.length;
      }
      droppedTotal += droppedNow;
      console.warn(
        `[usage-telemetry] flush failed (${failed.length} of ${batch.length} unwritten, ${droppedNow} dropped for good, total dropped ${droppedTotal}): ${String(error).slice(0, 200)}`,
      );
    }
  } finally {
    flushing = false;
  }
}

/** Test/diagnostics hook. */
export function usageTelemetryStats(): { buffered: number; dropped: number } {
  return { buffered: buffer.length, dropped: droppedTotal };
}

// ── Daily rollup ─────────────────────────────────────────────────────────────
// Folds every COMPLETE UTC day of raw events into rmone_usage_daily, then
// deletes the rolled raw rows in the SAME transaction (no double counting,
// no lost rows). MERGE is additive on cnt so a late-flushed event whose day
// was already rolled still lands correctly on the next pass. Daily rows are
// retained ~400 days so month-over-month trends stay available.

export async function runUsageRollupOnce(): Promise<{ rolled: number; deleted: number }> {
  const pool = await getMssqlPool();
  const r = await pool.request().query(`
    SET XACT_ABORT ON;
    BEGIN TRAN;
    DECLARE @cutoff DATETIME2 = CONVERT(DATETIME2, CONVERT(DATE, GETUTCDATE()));
    -- Identity watermark: a concurrent worker flush can insert a prior-day
    -- row BETWEEN the MERGE read and the DELETE. IDENTITY values only grow,
    -- so bounding both statements by the max id visible now guarantees the
    -- DELETE can never remove a row the MERGE did not fold (the late row is
    -- picked up by the next hourly pass instead).
    DECLARE @maxId BIGINT = (SELECT ISNULL(MAX(id), 0) FROM dbo.rmone_usage_events WHERE at < @cutoff);
    MERGE dbo.rmone_usage_daily WITH (HOLDLOCK) AS d
    USING (
      SELECT tenant_id, CONVERT(DATE, at) AS [day], user_id,
             MAX(username) AS username, MAX([role]) AS [role],
             kind, feature, ISNULL(context,'') AS context, is_system, SUM(cnt) AS cnt
      FROM dbo.rmone_usage_events
      WHERE at < @cutoff AND id <= @maxId
      GROUP BY tenant_id, CONVERT(DATE, at), user_id, kind, feature, ISNULL(context,''), is_system
    ) AS s
    ON d.tenant_id = s.tenant_id AND d.[day] = s.[day] AND d.user_id = s.user_id
       AND d.kind = s.kind AND d.feature = s.feature
       AND ISNULL(d.context,'') = ISNULL(s.context,'') AND d.is_system = s.is_system
    WHEN MATCHED THEN UPDATE SET d.cnt = d.cnt + s.cnt, d.username = s.username, d.[role] = s.[role]
    WHEN NOT MATCHED THEN INSERT (tenant_id, [day], user_id, username, [role], kind, feature, context, is_system, cnt)
      VALUES (s.tenant_id, s.[day], s.user_id, s.username, s.[role], s.kind, s.feature, s.context, s.is_system, s.cnt);
    DECLARE @rolled INT = @@ROWCOUNT;
    DELETE FROM dbo.rmone_usage_events WHERE at < @cutoff AND id <= @maxId;
    DECLARE @deleted INT = @@ROWCOUNT;
    DELETE FROM dbo.rmone_usage_daily WHERE [day] < DATEADD(DAY, -400, CONVERT(DATE, GETUTCDATE()));
    COMMIT;
    SELECT @rolled AS rolled, @deleted AS deleted;
  `);
  const row = (r.recordset?.[0] ?? {}) as { rolled?: number; deleted?: number };
  return { rolled: row.rolled ?? 0, deleted: row.deleted ?? 0 };
}

// ── Hourly schedule (lead worker only — started from index.ts) ──────────────
// Deployment-only unless USAGE_ROLLUP_IN_DEV=1 (same dev-gating convention as
// the nightly integrity scan: the dev workspace shares the live DB and must
// not add scheduled load). The analytics endpoint aggregates daily + raw, so
// un-rolled dev events still surface correctly either way.
export function startUsageRollup(): void {
  if (!usageTelemetryEnabled()) return;
  if (!IS_DEPLOYED_SERVER && process.env["USAGE_ROLLUP_IN_DEV"] !== "1") return;
  if (BACKGROUND_PROFILE === "off") return;
  const run = () =>
    void runUsageRollupOnce()
      .then(({ rolled, deleted }) => {
        if (rolled > 0 || deleted > 0) console.log(`[usage-telemetry] rollup: ${rolled} merged, ${deleted} raw rows folded`);
      })
      .catch((e) => console.warn("[usage-telemetry] rollup failed:", String(e).slice(0, 200)));
  // Light profile defers the first pass until well past the boot-warm window
  // (see deploy-env.ts); cadence stays hourly for both profiles.
  const firstRunDelayMs = BACKGROUND_PROFILE === "light" ? 15 * 60_000 : 90_000;
  setTimeout(() => { run(); setInterval(run, 60 * 60_000).unref(); }, firstRunDelayMs).unref();
  console.log(`[usage-telemetry] hourly rollup scheduled (first pass in ${(firstRunDelayMs / 60_000).toFixed(1)} min)`);
}
