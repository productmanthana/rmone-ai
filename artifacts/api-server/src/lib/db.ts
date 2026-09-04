/**
 * SQL Server connection to RM ONE's core2 + core2_common databases.
 *
 * Accepts EITHER a single connection URL:
 *   APP_DATABASE_URL = mssql://user:password@host:1433/database
 *
 * OR the five individual secrets (legacy):
 *   CLIENT_DB_HOST / CLIENT_DB_PORT / CLIENT_DB_NAME / CLIENT_DB_USER / CLIENT_DB_PASSWORD
 */
import sql from "mssql";
import os from "node:os";
// Rotation-proof credentials: when DB_MASTER_SECRET_ARN is set (AWS
// environments whose RDS master password is auto-rotated by Secrets Manager),
// overlay the CURRENT username/password from that secret onto the parsed
// connection config and self-heal on login failures. No-op elsewhere.
// See lib/db/src/master-credentials.ts for the Sep 2026 outage story.
import {
  applyMasterCredentials,
  isLoginFailure,
  refreshMasterCredentialsAfterLoginFailure,
} from "@workspace/db";

// Per-worker pool sizing scaled by cluster width so the TOTAL connection
// budget against RDS stays constant regardless of VM size. Mirrors the
// NUM_WORKERS formula in index.ts (min(cpus, 4)). Root cause of the July 2026
// production outage: upgrading the deploy VM to 8 GB doubled vCPUs → workers
// went 2→4 → total pool capacity (and permanently-open min connections)
// doubled, saturating the RDS instance until even fresh connects timed out.
// Budget: ~200 max / ~20 warm-min across the whole cluster.
// Raised 100→200 in July 2026 after the RDS instance was upgraded to
// db.r7i.2xlarge (8 vCPU / 64 GB) — it comfortably handles 200 connections.
// WORKERS env override must stay in lockstep with NUM_WORKERS in src/index.ts:
// pool size scales inversely with worker count, so a mismatch would blow the
// ~200-connection cluster budget against RDS.
//
// INSTANCE-AWARE since Aug 2026 (the Elastic Beanstalk move runs 2+ load-
// balanced machines against the SAME RDS): the budget divides by workers ×
// INSTANCE_COUNT so N instances still respect the fleet-wide limit. Set
// INSTANCE_COUNT on every instance of a multi-machine environment — the
// default of 1 keeps single-machine numbers EXACTLY as before. POOL_BUDGET
// overrides the 200 total when the RDS tier changes (prefer it over editing
// this file).

export interface PoolBudgetInputs {
  cpuCount: number;
  workersEnv?: string | undefined;
  instanceCountEnv?: string | undefined;
  poolBudgetEnv?: string | undefined;
}

export interface PoolBudget {
  workerCount: number;
  instanceCount: number;
  poolBudget: number;
  poolMax: number;
  poolMin: number;
  /** True when the per-worker floor (15) makes the fleet total overshoot the
   *  budget — lower WORKERS / INSTANCE_COUNT or raise POOL_BUDGET. */
  floorEngaged: boolean;
}

/** Pure so the check scripts can pin the matrix. Single-instance defaults
 *  must stay bit-identical to the historical formula (4 workers → 50/5). */
export function computePoolBudget(i: PoolBudgetInputs): PoolBudget {
  const workerCount = Math.max(1, Math.min(i.cpuCount, Number(i.workersEnv) || 4));
  const instanceCount = Math.max(1, Math.floor(Number(i.instanceCountEnv) || 1));
  const poolBudget = Math.max(20, Math.floor(Number(i.poolBudgetEnv) || 200));
  const divisor = workerCount * instanceCount;
  // Per-worker floor of 15: below that, one import's parallel writes starve
  // the same worker's page reads and requests queue into acquire timeouts.
  const poolMax = Math.max(15, Math.floor(poolBudget / divisor));
  // Warm-min budget of ~20 fleet-wide. Single instance keeps the historical
  // per-worker floor of 2; multi-instance drops the floor to 1 so N machines
  // don't quietly multiply the permanently-open session count.
  const poolMin = Math.max(instanceCount > 1 ? 1 : 2, Math.floor(20 / divisor));
  return {
    workerCount,
    instanceCount,
    poolBudget,
    poolMax,
    poolMin,
    floorEngaged: poolMax * divisor > poolBudget,
  };
}

const _budget = computePoolBudget({
  cpuCount: os.cpus().length,
  workersEnv: process.env.WORKERS,
  instanceCountEnv: process.env.INSTANCE_COUNT,
  poolBudgetEnv: process.env.POOL_BUDGET,
});
const WORKER_COUNT = _budget.workerCount;
const POOL_MAX = _budget.poolMax; // 4 workers × 1 instance → 50, 2×1 → 100, 4×2 → 25
const POOL_MIN = _budget.poolMin; // 4 workers × 1 instance → 5,  2×1 → 10, 4×2 → 2

// Visible only when the env deviates from single-machine defaults (dev stays
// silent). Every process logs once so a misconfigured instance shows up in
// its own logs.
if (_budget.instanceCount > 1 || process.env.POOL_BUDGET) {
  console.log(
    `[db] pool budget ${_budget.poolBudget} across ${_budget.instanceCount} instance(s) × ${_budget.workerCount} worker(s) → per-worker max=${POOL_MAX} min=${POOL_MIN}`,
  );
}
if (_budget.floorEngaged) {
  console.warn(
    `[db] per-worker floor engaged: ${_budget.instanceCount}×${_budget.workerCount} workers at max=${POOL_MAX} exceeds POOL_BUDGET=${_budget.poolBudget} — lower WORKERS/INSTANCE_COUNT or raise POOL_BUDGET`,
  );
}

function parseConfig(): sql.config | null {
  const url = process.env.APP_DATABASE_URL;

  if (url) {
    try {
      const u = new URL(url);
      return {
        server:   u.hostname,
        port:     u.port ? parseInt(u.port, 10) : 1433,
        database: u.pathname.replace(/^\//, "") || "master",
        user:     decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        options: {
          encrypt: true,
          trustServerCertificate: true,
          enableArithAbort: true,
          // 30s (was 15s): after a restart all workers reconnect at once and
          // SQL Server queues the logins; 15s expired mid-queue and turned a
          // reconnect herd into minutes of "Failed to connect in 15000ms".
          connectTimeout: 30_000,
          requestTimeout: 240_000,
          // Large TDS packets — the RDS link is high-latency, and the default
          // 4 KB packet makes big result sets (e.g. the 16k-row catalog scan the
          // clone engine runs) crawl at ~160 rows/s. 32 KB packets cut that scan
          // from ~100s to ~5s.
          packetSize: 32_768,
        },
        // min>0 keeps warm connections open so requests don't pay the
        // high-latency RDS TCP+TLS handshake on every cold pool.
        // idleTimeoutMillis:600_000 (10 min) keeps those connections alive well
        // past any typical page-navigation gap so the pool stays warm between
        // visits. The heartbeat (see startHeartbeat below) pings every 30 s so
        // SQL Server never closes its side of the idle sockets.
        pool: {
          // Scaled by WORKER_COUNT × INSTANCE_COUNT (see computePoolBudget)
          // so total FLEET connections stay ~POOL_BUDGET max / ~20 warm
          // regardless of vCPU or machine count.
          max: POOL_MAX,
          min: POOL_MIN,
          idleTimeoutMillis: 600_000,
          // If all slots are busy, fail fast after 30s instead of queuing
          // indefinitely — this surfaces a 503 to the client sooner and prevents
          // hundreds of requests stacking up behind a slow batch job.
          acquireTimeoutMillis: 30_000,
          // Cap how long a new physical TCP connection may take. Matches
          // connectTimeout so queued logins during a reconnect herd still land.
          createTimeoutMillis: 30_000,
        },
      };
    } catch {
      console.error("[db] APP_DATABASE_URL is invalid — check the format: mssql://user:pass@host:1433/dbname");
      return null;
    }
  }

  const host = process.env.CLIENT_DB_HOST;
  const user = process.env.CLIENT_DB_USER;
  const pass = process.env.CLIENT_DB_PASSWORD;
  if (host && user && pass) {
    return {
      server:   host,
      port:     parseInt(process.env.CLIENT_DB_PORT ?? "1433", 10),
      database: process.env.CLIENT_DB_NAME ?? "master",
      user,
      password: pass,
      options: {
        encrypt: true,
        trustServerCertificate: true,
        enableArithAbort: true,
        connectTimeout: 30_000, // see note above — survives post-restart login queueing
        requestTimeout: 240_000,
        packetSize: 32_768, // see note above — speeds large result sets over the RDS link
      },
      pool: {
        max: POOL_MAX, // scaled by WORKER_COUNT × INSTANCE_COUNT — see computePoolBudget
        min: POOL_MIN,
        idleTimeoutMillis: 600_000,
        acquireTimeoutMillis: 30_000,
        createTimeoutMillis: 30_000,
      },
    };
  }

  return null;
}

let _pool: sql.ConnectionPool | null = null;
let _connecting: Promise<sql.ConnectionPool> | null = null;
// Last successfully-connected pool. NEVER nulled (unlike _pool, which the
// on("error") handler nulls so getPool() rebuilds). Serves as the fallback
// target for getLivePool() while a reconnect is in flight — its requests
// reject with a transient code callers already handle, instead of crashing
// on a null reference.
let _lastPool: sql.ConnectionPool | null = null;
// Set by closeDbPool() during shutdown: blocks getPool() from rebuilding a
// fresh pool (e.g. the 30 s heartbeat firing between close and process.exit),
// which would strand a brand-new never-closed pool on SQL Server.
let _closed = false;
let _heartbeat: NodeJS.Timeout | null = null;

/**
 * One-shot single-connection pool for DDL (CREATE INDEX, ALTER INDEX REBUILD).
 * Uses max:1 so every request lands on the SAME physical connection — required
 * for SINGLE_USER mode to work correctly (Sch-M guaranteed via ROLLBACK IMMEDIATE).
 * requestTimeout:0 disables the driver-level 240 s cap that was killing CREATE INDEX.
 * Caller is responsible for calling pool.close() when done.
 */
export async function getDdlPool(): Promise<sql.ConnectionPool> {
  const base = await applyMasterCredentials(parseConfig());
  if (!base) throw new Error("SQL Server not configured");
  const cfg: sql.config = {
    ...base,
    options: { ...base.options, requestTimeout: 0 },
    pool: { max: 1, min: 0, idleTimeoutMillis: 120_000 },
  };
  // connectWithRetry (not a bare connect) so DDL pools get the same
  // rotated-credential self-heal and transient-blip retries as the main pool.
  return connectWithRetry(cfg);
}

export function isConfigured(): boolean {
  return !!(process.env.APP_DATABASE_URL ||
    (process.env.CLIENT_DB_HOST && process.env.CLIENT_DB_USER && process.env.CLIENT_DB_PASSWORD));
}

// Connection/request errors that are transient (network blip, RDS failover, or a
// stale pooled socket) and therefore safe to retry. The RDS link is known to be
// intermittently slow/unreachable, so a short bounded retry turns a one-off blip
// into a hidden recovery instead of a user-facing 502.
const TRANSIENT_DB_CODES = new Set([
  "ETIMEOUT", "ECONNCLOSED", "ESOCKET", "ENOTOPEN", "ECONNRESET", "EPIPE",
]);

export function isTransientDbError(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return !!code && TRANSIENT_DB_CODES.has(code);
}

/** Pool-acquire timeout: tarn throws this when all connections are busy and
 *  the acquire wait exceeds the pool's acquireTimeoutMillis.  The error has
 *  no standard code — only a message — so we detect it by message text.
 *  In an import pipeline this is indistinguishable from a full DB outage:
 *  treat it the same as connectionLost so the run stops immediately. */
export function isPoolTimeoutError(e: unknown): boolean {
  return /operation timed out/i.test((e as Error)?.message ?? "");
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function connectWithRetry(cfg: sql.config, attempts = 4): Promise<sql.ConnectionPool> {
  let lastErr: unknown;
  let activeCfg = cfg;
  let credsRefreshed = false;
  for (let i = 0; i < attempts; i++) {
    try {
      return await new sql.ConnectionPool(activeCfg).connect();
    } catch (e) {
      lastErr = e;
      // Rotation self-heal: an authentication failure right after AWS rotated
      // the RDS-managed master password. Force-refresh credentials from
      // Secrets Manager and retry once with the new password. When the
      // overlay is not configured (or the password didn't change), ELOGIN
      // stays terminal exactly as before.
      if (isLoginFailure(e) && !credsRefreshed) {
        credsRefreshed = true;
        if (await refreshMasterCredentialsAfterLoginFailure()) {
          activeCfg = (await applyMasterCredentials(activeCfg)) ?? activeCfg;
          console.warn("[db] login failed — retrying with freshly rotated master credentials");
          continue;
        }
      }
      if (i === attempts - 1 || !isTransientDbError(e)) break;
      const backoff = Math.min(2_000 * 2 ** i, 10_000);
      console.warn(`[db] connect attempt ${i + 1}/${attempts} failed (${(e as Error)?.message}); retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

export async function getPool(): Promise<sql.ConnectionPool> {
  const cfg = await applyMasterCredentials(parseConfig());
  if (!cfg) {
    throw new Error(
      "SQL Server not configured. Set APP_DATABASE_URL " +
      "(e.g. mssql://user:pass@host:1433/master) in the workspace secret store."
    );
  }
  if (_closed) throw new Error("DB pool closed — process is shutting down");
  if (_pool && _pool.connected) return _pool;
  // Single-flight guard: concurrent callers during a cold start share ONE connect
  // instead of each racing to build a separate pool (which leaked connections).
  if (!_connecting) {
    _connecting = connectWithRetry(cfg)
      .then((pool) => {
        if (_closed) {
          // Shutdown raced the connect: close the fresh pool immediately so
          // it isn't stranded on SQL Server after the process exits.
          void pool.close().catch(() => { /* ignore */ });
          throw new Error("DB pool closed — process is shutting down");
        }
        pool.on("error", (err) => {
          console.error("[db] pool error:", err.message);
          if (_pool === pool) { _pool = null; _connecting = null; }
          // Close the errored pool so its remaining sockets are released.
          // Dropping the reference without closing strands sleeping sessions
          // on SQL Server (observed: thousands of orphaned connections).
          void pool.close().catch(() => { /* ignore */ });
        });
        _pool = pool;
        _lastPool = pool;
        return pool;
      })
      .finally(() => { _connecting = null; });
  }
  return _connecting;
}

/**
 * Live-pool facade for LONG-RUNNING work (the onboarding import pipeline).
 *
 * Problem it solves: pool.on("error") closes the errored pool and nulls the
 * singleton so the NEXT getPool() reconnects — but any code that captured the
 * pool reference at start-of-run (the pipeline holds one for its entire
 * multi-minute run) is left with a CLOSED pool and throws "Connection is
 * closed." for every remaining statement, even after the link recovers.
 *
 * The facade is a stable object that builds each request/transaction from the
 * CURRENT healthy singleton at call time. When the singleton is unhealthy it
 * kicks an async reconnect (single-flight inside getPool) so recovery does not
 * wait for the 30 s heartbeat, and meanwhile serves the last-known pool whose
 * requests fail with a transient code the pipeline's retry paths handle.
 *
 * Deliberately a NARROW surface — request() and transaction() are the only
 * pool members the pipeline uses (verified) — not a Proxy: a transaction must
 * bind to ONE concrete pool for begin/acquire/release to stay on the same
 * physical connection.
 */
export function getLivePool(): Pick<sql.ConnectionPool, "request" | "transaction"> {
  const cur = (): sql.ConnectionPool => {
    if (_pool && _pool.connected) return _pool;
    if (!_closed) void getPool().catch(() => { /* callers retry */ });
    const p = _pool ?? _lastPool;
    if (!p) throw new Error("SQL Server pool not initialised — call getPool() first");
    return p;
  };
  return {
    request: (() => cur().request()) as sql.ConnectionPool["request"],
    transaction: (() => new sql.Transaction(cur())) as sql.ConnectionPool["transaction"],
  };
}

/**
 * Close the singleton pool and release every socket. Call on SIGTERM/SIGINT
 * so restarts/deploys don't strand sleeping sessions on SQL Server — stranded
 * sessions accumulate across restarts (observed at 3,500+) and slow new
 * logins to the point of connect timeouts.
 */
export async function closeDbPool(): Promise<void> {
  _closed = true;
  if (_heartbeat) { clearInterval(_heartbeat); _heartbeat = null; }
  const old = _pool;
  _pool = null;
  _connecting = null;
  if (old) { try { await old.close(); } catch { /* ignore */ } }
}

/**
 * Run a DB operation with bounded exponential-backoff retry on TRANSIENT errors
 * (network blips / RDS failover / stale pooled socket). Non-transient errors
 * (bad SQL, constraint violations) are re-thrown immediately. On a closed-pool
 * error the singleton pool is reset so the next attempt reconnects.
 * Opt-in: wrap read paths where a transient blip should self-heal.
 */
export async function withDbRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === attempts - 1 || !isTransientDbError(e)) break;
      if ((e as { code?: string })?.code === "ECONNCLOSED") {
        const old = _pool;
        _pool = null; _connecting = null;
        // Release the dead pool's remaining sockets instead of stranding them.
        if (old) { try { void old.close().catch(() => { /* ignore */ }); } catch { /* ignore */ } }
      }
      await sleep(Math.min(500 * 2 ** i, 4_000));
    }
  }
  throw lastErr;
}

/**
 * Start a keep-alive heartbeat that runs a cheap SELECT 1 every 30 s.
 * This prevents two failure modes:
 *   1. SQL Server closing idle connections on its side (default idle timeout
 *      on many RDS SQL Server configs is 30-60 min, but some are 5 min).
 *   2. The mssql pool's min-connection sockets being torn down by NAT/firewall
 *      devices on the network path (AWS VPC NAT gateway drops TCP after ~350 s).
 *
 * Call once at server startup. The interval keeps the pool permanently warm
 * so every user request hits pre-established connections — no cold-connect cost.
 */
export function startHeartbeat(): void {
  if (!isConfigured() || _closed || _heartbeat) return;
  _heartbeat = setInterval(async () => {
    if (_closed) return;
    try {
      const pool = await getPool();
      await pool.request().query("SELECT 1 AS hb");
    } catch {
      // Swallow silently — withDbRetry handles transient errors on real requests.
      // If the pool is truly gone, getPool() will reconnect on the next real request.
    }
  }, 30_000);
}

export async function dbStatus(): Promise<{ connected: boolean; message: string }> {
  if (!isConfigured()) {
    return { connected: false, message: "Not configured — add APP_DATABASE_URL secret" };
  }
  try {
    const pool = await getPool();
    await pool.request().query("SELECT 1 AS ok");
    return { connected: true, message: "Connected" };
  } catch (e: any) {
    return { connected: false, message: e.message };
  }
}

// The RM ONE tables all live in the `core2` database. The connection may default
// to `master`, so INFORMATION_SCHEMA queries MUST be prefixed with `core2.` —
// otherwise they return 0 rows and the schema lookup yields nothing.
export async function getTableColumns(tableName: string): Promise<string[]> {
  const pool = await getPool();
  const res = await pool.request()
    .input("table", sql.NVarChar, tableName)
    .query(`
      SELECT COLUMN_NAME
      FROM core2.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @table
      ORDER BY ORDINAL_POSITION
    `);
  return res.recordset.map((r: any) => r.COLUMN_NAME as string);
}

export async function getUniversalSchema(): Promise<Record<string, string[]>> {
  try {
    // Re-acquire the pool INSIDE the retried closure: on ECONNCLOSED withDbRetry
    // nulls the singleton, so the next attempt must call getPool() again to get a
    // freshly reconnected pool rather than reusing the closed reference.
    const res = await withDbRetry(async () => {
      const pool = await getPool();
      return pool.request().query(`
      SELECT TABLE_NAME, COLUMN_NAME
      FROM core2.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME IN (
        'CompanyDivisions','Department','Roles','Jobtitle','AspNetUsers',
        'ResourceWorkItems','CRMCompany','CRMContact','PMM','Opportunity',
        'ResourceAllocation','Config_ConfigurationVariable',
        'ModuleTasks','TicketHours','RoleBillingRateByDept',
        'POR','PORCompanyInsights','PORCompanyNotes',
        'PORInitiativeInsights','PORInitiativeNotes',
        'ResourceTimeSheet','SVCRequests','ACR','ProjectChangeLog','Tenant'
      )
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `);
    });
    const schema: Record<string, string[]> = {};
    for (const row of res.recordset) {
      if (!schema[row.TABLE_NAME]) schema[row.TABLE_NAME] = [];
      schema[row.TABLE_NAME].push(row.COLUMN_NAME);
    }
    // Trust the live core2 schema only — no hardcoded fallback. An empty result
    // (wrong DB / perms / connection down) returns {} so callers fail loudly
    // rather than acting on stale guessed columns.
    if (Object.keys(schema).length === 0) {
      console.warn("[getUniversalSchema] live core2 schema returned 0 columns — returning {} (hardcoded fallback removed)");
    }
    return schema;
  } catch (e) {
    console.error(
      "[getUniversalSchema] live core2 schema lookup failed — returning {} (hardcoded fallback removed):",
      (e as Error)?.message ?? e,
    );
    return {};
  }
}

/**
 * Background index builder for large tables that take >2 min to index and
 * cannot be built within script tooling windows. Called once after server
 * startup; a dedicated DDL pool with requestTimeout:0 ensures the CREATE INDEX
 * runs to completion regardless of how long it takes. Safe to call on every
 * restart — each index is checked for existence before attempting CREATE.
 */
export function startBackgroundIndexes(): void {
  if (!isConfigured()) return;

  void (async () => {
    // Wait 10 s so the main pool warms up first and startup logs are clean.
    await sleep(10_000);

    let pool: sql.ConnectionPool | null = null;
    try {
      pool = await getDdlPool();
    } catch (e) {
      console.warn("[bg-indexes] could not open DDL pool:", (e as Error)?.message ?? e);
      return;
    }

    const tables: Array<{
      table: string;
      name: string;
      keys: string;
      include?: string[];
      includeCols?: string;   // for columns known without a colsOf call
    }> = [
      {
        table: "Opportunity",
        name:  "IX_Opp_Tid_TicketId_Del",
        keys:  "[TenantID], [TicketId], [Deleted]",
      },
      {
        table: "CRMContact",
        name:  "IX_CRMCt_Tid_Del",
        keys:  "[TenantID], [Deleted]",
      },
      // Supports sargable DivisionLookup IN (…) predicate emitted by the BU
      // rename propagation UPDATE on large PMM/Opportunity tables.  The
      // [TenantID] leading key matches the WHERE p.[TenantID]=@tid filter so
      // SQL Server narrows to the tenant's rows before evaluating the IN list.
      {
        table: "PMM",
        name:  "IX_PMM_Tid_DivLookup",
        keys:  "[TenantID], [DivisionLookup]",
      },
      {
        table: "Opportunity",
        name:  "IX_Opp_Tid_DivLookup",
        keys:  "[TenantID], [DivisionLookup]",
      },
    ];

    for (const t of tables) {
      try {
        // Check existence
        const ex = await pool.request()
          .input("tbl", sql.NVarChar, t.table)
          .input("idx", sql.NVarChar, t.name)
          .query(`SELECT 1 AS found
                  FROM core2.sys.indexes i
                  JOIN core2.sys.objects o ON o.object_id = i.object_id
                  WHERE o.name = @tbl AND i.name = @idx`);
        if ((ex.recordset ?? []).length > 0) {
          // Already exists — nothing to do.
          continue;
        }

        // Discover INCLUDE columns from live schema
        const colsRes = await pool.request()
          .input("t", sql.NVarChar, t.table)
          .query(`SELECT LOWER(c.name) AS n
                  FROM core2.sys.columns c
                  JOIN core2.sys.objects o ON o.object_id = c.object_id
                  WHERE o.name = @t AND o.type = 'U'`);
        const cols = new Set((colsRes.recordset ?? []).map((r: Record<string, unknown>) => r.n as string));
        if (cols.size === 0) continue; // table absent — skip

        let incCols: string[] = [];
        if (t.table === "Opportunity") {
          incCols = ["Title"]
            .concat(cols.has("crmopportunitystatuschoice") ? ["CRMOpportunityStatusChoice"] : [])
            .concat(cols.has("divisionlookup")             ? ["DivisionLookup"]             : [])
            .concat(cols.has("closedate")                  ? ["CloseDate"]                  : []);
        } else if (t.table === "CRMContact") {
          incCols = ([] as string[])
            .concat(cols.has("pointofcontact")   ? ["PointOfContact"]   : [])
            .concat(cols.has("crmcompanylookup") ? ["CRMCompanyLookup"] : [])
            .concat(cols.has("emailaddress")     ? ["EmailAddress"]     : cols.has("email") ? ["Email"] : []);
        }

        // Never INCLUDE a column that is already an index key — SQL Server
        // rejects the DDL ("Cannot use duplicate column names in index").
        // Bit us when IX_Opp_Tid_DivLookup keyed on DivisionLookup while the
        // shared Opportunity include-list also carried DivisionLookup.
        const keyCols = new Set(
          t.keys.split(",").map(k => k.replace(/[\[\]\s]/g, "").toLowerCase()),
        );
        incCols = incCols.filter(c => !keyCols.has(c.toLowerCase()));

        const includeSql = incCols.length
          ? ` INCLUDE (${incCols.map(c => `[${c}]`).join(", ")})`
          : "";
        const ddl = `CREATE NONCLUSTERED INDEX [${t.name}]
                     ON core2.dbo.[${t.table}] (${t.keys})${includeSql}`;

        console.log(`[bg-indexes] building ${t.table}.${t.name} …`);
        await pool.request().batch(ddl);
        console.log(`[bg-indexes] ✓ ${t.table}.${t.name}`);
      } catch (e) {
        console.warn(`[bg-indexes] ${t.table}.${t.name} failed:`, (e as Error)?.message ?? e);
      }
    }

    try { await pool.close(); } catch { /* ignore */ }
  })();
}

export { sql };

