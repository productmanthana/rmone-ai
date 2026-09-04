import sql from "mssql";
import {
  applyMasterCredentials,
  isLoginFailure,
  refreshMasterCredentialsAfterLoginFailure,
} from "./master-credentials.js";

// Name of the user database that holds all rmone_* tables.
// The connection URL typically points to 'master' for the initial connection,
// but user tables cannot be created in system databases on AWS RDS SQL Server.
// We transparently create and use this user database instead.
const USER_DB = "rmoneapp";

function parseConfig(database: string): sql.config | null {
  const url = process.env.APP_DATABASE_URL;
  if (!url) return null;
  try {
    const u = new URL(url);
    return {
      server:   u.hostname,
      port:     u.port ? parseInt(u.port, 10) : 1433,
      database,
      user:     decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      options: {
        encrypt: true,
        trustServerCertificate: true,
        enableArithAbort: true,
        // 30s (was 15s): post-restart reconnect herds queue logins on SQL
        // Server; 15s expired mid-queue and caused minutes of connect failures.
        connectTimeout: 30_000,
        requestTimeout: 120_000,
        packetSize: 32_768,
      },
      pool: { max: 5, min: 1, idleTimeoutMillis: 60_000 },
    };
  } catch {
    console.error("[appdb] SQL Server URL parse failed (APP_DATABASE_URL)");
    return null;
  }
}

// One-shot: connect to master, create the user database if it doesn't exist.
async function ensureUserDatabase(): Promise<void> {
  // Overlay the CURRENT RDS-managed master credentials (rotation-proof; see
  // master-credentials.ts). No-op when DB_MASTER_SECRET_ARN is unset.
  const cfg = await applyMasterCredentials(parseConfig("master"));
  if (!cfg) return;
  const tmp = new sql.ConnectionPool({ ...cfg, pool: { max: 1, min: 0, idleTimeoutMillis: 5_000 } });
  try {
    await tmp.connect();
    await tmp.request().query(
      `IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name=N'${USER_DB}')
         CREATE DATABASE [${USER_DB}]`,
    );
    console.log(`[appdb] user database '${USER_DB}' is ready`);
  } catch (e) {
    // Non-fatal: might already exist or permissions differ — bootstrap will surface real errors.
    console.warn("[appdb] ensureUserDatabase:", (e as Error).message);
  } finally {
    try { await tmp.close(); } catch { /* ignore */ }
  }
}

let _pool: sql.ConnectionPool | null = null;
let _connecting: Promise<sql.ConnectionPool> | null = null;

/**
 * Drop the current pool so the next getMssqlPool() call builds a fresh one.
 * Used by callers (e.g. the login route) that hit a hung/stale connection:
 * `_pool.connected` can remain true while the underlying sockets are dead
 * after a network blip, which otherwise leaves every query waiting out the
 * full requestTimeout.
 */
export function resetMssqlPool(): void {
  const old = _pool;
  _pool = null;
  if (old) { try { void old.close().catch(() => { /* ignore */ }); } catch { /* ignore */ } }
}

// Set during shutdown: blocks getMssqlPool() from rebuilding a fresh pool
// between close and process.exit (which would strand it on SQL Server).
let _closed = false;

/**
 * Close the app-DB pool and release every socket. Call on SIGTERM/SIGINT so
 * restarts don't strand sleeping sessions on SQL Server.
 */
export async function closeMssqlPool(): Promise<void> {
  _closed = true;
  const old = _pool;
  _pool = null;
  _connecting = null;
  if (old) { try { await old.close(); } catch { /* ignore */ } }
}

export async function getMssqlPool(): Promise<sql.ConnectionPool> {
  const cfg = parseConfig(USER_DB);
  if (!cfg) throw new Error("SQL Server URL is not configured (set APP_DATABASE_URL)");
  if (_closed) throw new Error("App-DB pool closed — process is shutting down");
  if (_pool && _pool.connected) return _pool;
  if (!_connecting) {
    _connecting = (async () => {
      // The CREATE DATABASE check needs its own serial connect to master —
      // skip it in cluster workers (APPDB_BOOTSTRAPPED=1): the primary already
      // ensured the user DB exists before forking.
      if (process.env.APPDB_BOOTSTRAPPED !== "1") await ensureUserDatabase();
      // Overlay the CURRENT RDS-managed master credentials; on an auth
      // failure (rotation just happened) force-refresh them and retry ONCE.
      // This is what keeps sign-ins working across AWS's automatic weekly
      // password rotation — see master-credentials.ts for the full story.
      let p: sql.ConnectionPool;
      try {
        p = await new sql.ConnectionPool((await applyMasterCredentials(cfg)) ?? cfg).connect();
      } catch (e) {
        if (!isLoginFailure(e) || !(await refreshMasterCredentialsAfterLoginFailure())) throw e;
        console.warn("[appdb] login failed — retrying with freshly rotated master credentials");
        p = await new sql.ConnectionPool((await applyMasterCredentials(cfg)) ?? cfg).connect();
      }
      if (_closed) {
        // Shutdown raced the connect — close the fresh pool so it isn't stranded.
        try { void p.close().catch(() => { /* ignore */ }); } catch { /* ignore */ }
        throw new Error("App-DB pool closed — process is shutting down");
      }
      // Self-heal: without this handler a dead pool keeps reporting
      // connected=true and every subsequent query hangs until the 120 s
      // requestTimeout — observed in production as multi-minute logins
      // during "[db] pool error: operation timed out" bursts.
      p.on("error", (err: Error) => {
        console.error("[appdb] pool error:", err?.message ?? String(err));
        if (_pool === p) _pool = null;
        // Close the errored pool so its sockets are released — dropping the
        // reference without closing strands sleeping sessions on SQL Server.
        try { void p.close().catch(() => { /* ignore */ }); } catch { /* ignore */ }
      });
      _pool = p;
      return p;
    })()
      .catch((e) => { _connecting = null; throw e; })
      .finally(() => { _connecting = null; });
  }
  return _connecting;
}

export { sql as mssql };
