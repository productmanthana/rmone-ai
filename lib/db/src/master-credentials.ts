import type sql from "mssql";

/**
 * Rotation-proof database credentials.
 *
 * WHY THIS EXISTS (Sep 2 2026 outage): the shared non-production RDS instance
 * uses an AWS-managed master password (`manage_master_user_password`), which
 * AWS Secrets Manager rotates automatically (~every 7 days). The application,
 * however, receives its connection string via a SEPARATE Secrets Manager
 * secret (APP_DATABASE_URL) that Elastic Beanstalk resolves ONLY at
 * deploy/instance-launch time. AWS does not update that URL secret on
 * rotation, and EB does not re-resolve it — so every rotation silently left
 * the fleet holding a dead password and all sign-ins failed with
 * "Login failed for user 'rmoneadmin'".
 *
 * THE FIX (AWS-recommended pattern): when DB_MASTER_SECRET_ARN is set, fetch
 * the CURRENT username/password directly from the RDS-managed secret at
 * runtime, overlay them onto the parsed connection config, and force-refresh
 * + retry once whenever a connection attempt fails authentication (ELOGIN).
 * Existing pooled connections survive a rotation (SQL Server checks passwords
 * only at login), so with this overlay a rotation is a non-event.
 *
 * When DB_MASTER_SECRET_ARN is unset (local dev, hosted workspace, production
 * with a static password) every helper here is a no-op and the AWS SDK is
 * never loaded.
 *
 * SECURITY: secret values are never logged, never written to disk, and never
 * placed in process arguments. Only lifecycle events are logged.
 */

type MasterCredentials = { user: string; password: string };

// Soft TTL: new pool builds re-read the secret at most this often, so a
// long-lived process converges on rotated credentials even without hitting a
// login failure.
const CACHE_TTL_MS = 5 * 60_000;
// Floor between FORCED refreshes so a reconnect herd cannot hammer Secrets
// Manager — one force wins, the rest reuse its result.
const MIN_FORCE_INTERVAL_MS = 5_000;

let _cached: MasterCredentials | null = null;
let _fetchedAt = 0;
let _lastForceAt = 0;
let _inflight: Promise<MasterCredentials | null> | null = null;

export function masterCredentialsConfigured(): boolean {
  return !!process.env.DB_MASTER_SECRET_ARN?.trim();
}

async function fetchFromSecretsManager(arn: string): Promise<MasterCredentials> {
  // arn:aws:secretsmanager:<region>:<account>:secret:… — the region is part
  // of the ARN, so no extra region configuration is needed on the instance.
  const region = arn.split(":")[3] || process.env.AWS_REGION || "us-east-1";
  const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
  const client = new SecretsManagerClient({ region });
  try {
    const out = await client.send(new GetSecretValueCommand({ SecretId: arn }));
    const parsed = JSON.parse(out.SecretString ?? "{}") as { username?: unknown; password?: unknown };
    if (typeof parsed.username !== "string" || !parsed.username ||
        typeof parsed.password !== "string" || !parsed.password) {
      throw new Error("secret payload is missing username/password");
    }
    return { user: parsed.username, password: parsed.password };
  } finally {
    client.destroy();
  }
}

/**
 * Current master credentials, or null when the overlay is not configured.
 * Failure policy is deliberately fail-open: if Secrets Manager is briefly
 * unreachable we keep serving the last-known credentials (or fall back to the
 * ones embedded in the connection URL) instead of turning a fetch blip into
 * an outage — the pre-overlay behavior is the worst case, never worse.
 */
export async function getMasterCredentials(force = false): Promise<MasterCredentials | null> {
  const arn = process.env.DB_MASTER_SECRET_ARN?.trim();
  if (!arn) return null;
  const now = Date.now();
  const freshEnough = _cached !== null && now - _fetchedAt < CACHE_TTL_MS;
  if (!force && freshEnough) return _cached;
  if (force && _cached !== null && now - _lastForceAt < MIN_FORCE_INTERVAL_MS) return _cached;
  if (!_inflight) {
    if (force) _lastForceAt = now;
    _inflight = fetchFromSecretsManager(arn)
      .then((creds) => {
        const changed = _cached !== null && creds.password !== _cached.password;
        _cached = creds;
        _fetchedAt = Date.now();
        console.log(`[appdb] master credentials ${changed ? "REFRESHED after rotation" : "loaded"} from Secrets Manager`);
        return creds;
      })
      .catch((e) => {
        console.error(
          `[appdb] master-credential fetch failed (${(e as Error)?.message}); ` +
          `using ${_cached ? "last-known credentials" : "connection-URL credentials"}`,
        );
        return _cached;
      })
      .finally(() => { _inflight = null; });
  }
  return _inflight;
}

/** Overlay the managed credentials onto a parsed mssql config (no-op when unconfigured). */
export async function applyMasterCredentials<T extends sql.config>(cfg: T | null): Promise<T | null> {
  if (!cfg || !masterCredentialsConfigured()) return cfg;
  const creds = await getMasterCredentials(false);
  if (!creds) return cfg;
  return { ...cfg, user: creds.user, password: creds.password };
}

/** True when an error is a SQL Server authentication failure (error 18456 → tedious ELOGIN). */
export function isLoginFailure(e: unknown): boolean {
  if ((e as { code?: string })?.code === "ELOGIN") return true;
  return (e as { originalError?: { code?: string } })?.originalError?.code === "ELOGIN";
}

/**
 * After a login failure: force-read the secret and report whether the
 * password actually changed (i.e. a retry is worth it). During the brief
 * AWSPENDING window of an in-flight rotation the fetch can still return the
 * old password — returning false lets callers fail honestly; the NEXT
 * connection attempt refreshes again and succeeds.
 */
export async function refreshMasterCredentialsAfterLoginFailure(): Promise<boolean> {
  if (!masterCredentialsConfigured()) return false;
  const before = _cached?.password;
  const fresh = await getMasterCredentials(true);
  return !!fresh && fresh.password !== before;
}
