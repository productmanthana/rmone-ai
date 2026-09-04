/**
 * Fake SQL Server layer for rds-provider regression tests. NO real database is
 * ever contacted: the single shared `mssql` package instance (both
 * artifacts/api-server/src/lib/db.ts and @workspace/db resolve the same copy
 * under pnpm) is prototype-patched so that
 *   - ConnectionPool.connect() succeeds instantly without dialing anything,
 *   - Request.query(text) is answered by an in-test router keyed on the SQL
 *     text and the bound parameters.
 *
 * The module also replaces Date.now() with a controllable clock so tests can
 * cross serve-stale TTL/grace windows instantly, and offers a one-shot "gate"
 * that holds a matching query in flight until the test releases (or fails)
 * it — the mechanism used to simulate a cache bust landing while a background
 * rebuild is mid-query.
 *
 * IMPORT ORDER MATTERS: import this module FIRST, then load the module under
 * test with a dynamic `await import(...)` — a static import would hoist above
 * these patches (see .agents/memory/hook-integration-test-harness.md).
 */
import sql from "mssql";

// Belt and braces: even if a prototype patch regressed, no real server exists
// at this host — tests can never touch live data.
process.env.APP_DATABASE_URL = "mssql://fake:fake@rds-test-double.invalid:1433/master";
// @workspace/db skips its CREATE DATABASE + DDL bootstrap sweep with this set.
process.env.APPDB_BOOTSTRAPPED = "1";
// The Secrets Manager master-credentials overlay (lib/db/master-credentials.ts)
// performs a REAL AWS network fetch before the first app-DB pool is built. The
// fake clock + flush() can only drain deterministic work, so that un-fake-able
// I/O leaves background rebuilds parked mid-scenario (the staff-org control
// assertion fails while the fetch is in flight). No real DB exists here anyway
// — force the plain database-URL path.
delete process.env.DB_MASTER_SECRET_ARN;

// ── Controllable clock (Date.now only; timers stay real) ────────────────────
const realNow = Date.now();
let clockOffset = 0;
Date.now = () => realNow + clockOffset;
export function advanceClock(ms: number): void { clockOffset += ms; }

// ── Query routing ────────────────────────────────────────────────────────────
export interface FakeQuery { text: string; params: Record<string, unknown> }
interface FakeResult {
  recordset: unknown[];
  recordsets: unknown[][];
  rowsAffected: number[];
  output: Record<string, unknown>;
}
function makeResult(recordset: unknown[]): FakeResult {
  return { recordset, recordsets: [recordset], rowsAffected: [recordset.length], output: {} };
}

/** Return rows for a matching query, or undefined to pass to the next responder. */
export type Responder = (q: FakeQuery) => { recordset: unknown[] } | undefined;
const responders: Responder[] = [];
export function addResponder(r: Responder): void { responders.push(r); }

export const queryLog: FakeQuery[] = [];
export function countQueries(match: (q: FakeQuery) => boolean): number {
  return queryLog.filter(match).length;
}

// Column fixtures answering tableColumns()'s INFORMATION_SCHEMA.COLUMNS probes.
const tableCols = new Map<string, string[]>();
export function setTableColumns(table: string, cols: string[]): void {
  tableCols.set(table.toLowerCase(), cols);
}

// ── One-shot gate: hold a matching query in flight until the test decides ───
export interface ArmedGate {
  /** Resolves once the gated query has actually been issued. */
  hit: Promise<FakeQuery>;
  /** Complete the gated query successfully with these rows. */
  release(rows: unknown[]): void;
  /** Fail the gated query. Use a plain Error (no `code`) so withDbRetry treats it as non-transient. */
  fail(err: Error): void;
}
let armedGate: {
  match: (q: FakeQuery) => boolean;
  onHit: (q: FakeQuery) => void;
  result: Promise<unknown[]>;
} | null = null;
export function armGate(match: (q: FakeQuery) => boolean): ArmedGate {
  let release!: (rows: unknown[]) => void;
  let fail!: (e: Error) => void;
  const result = new Promise<unknown[]>((res, rej) => { release = res; fail = rej; });
  let onHit!: (q: FakeQuery) => void;
  const hit = new Promise<FakeQuery>((res) => { onHit = res; });
  armedGate = { match, onHit, result };
  return { hit, release, fail };
}

async function routeQuery(
  this: { parameters?: Record<string, { value: unknown }> },
  text: string,
): Promise<FakeResult> {
  const params: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(this.parameters ?? {})) params[k] = v.value;
  const q: FakeQuery = { text, params };
  queryLog.push(q);

  if (armedGate && armedGate.match(q)) {
    const g = armedGate;
    armedGate = null; // one-shot — later matching queries flow normally
    g.onHit(q);
    return makeResult(await g.result); // rejects when fail() was used
  }

  if (text.includes("INFORMATION_SCHEMA.COLUMNS")) {
    const t = String(params.t ?? params.table ?? "").toLowerCase();
    return makeResult((tableCols.get(t) ?? []).map((c) => ({ COLUMN_NAME: c })));
  }

  for (let i = responders.length - 1; i >= 0; i--) {
    const r = responders[i](q);
    if (r !== undefined) return makeResult(r.recordset);
  }
  return makeResult([]);
}

// ── Patch the shared mssql driver ────────────────────────────────────────────
(sql.ConnectionPool.prototype as unknown as Record<string, unknown>).connect =
  function (this: Record<string, unknown>) { this._connected = true; return Promise.resolve(this); };
(sql.ConnectionPool.prototype as unknown as Record<string, unknown>).close =
  function (this: Record<string, unknown>) { this._connected = false; return Promise.resolve(); };
(sql.Request.prototype as unknown as Record<string, unknown>).query = routeQuery;
(sql.Request.prototype as unknown as Record<string, unknown>).batch = routeQuery;

// ── Misc test plumbing ───────────────────────────────────────────────────────
/** Let queued microtasks/macrotasks (background rebuilds) settle. */
export async function flush(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Hard failure on hangs — a stuck gate must fail the check chain, not freeze it. */
export function startWatchdog(label: string, ms = 120_000): void {
  setTimeout(() => {
    console.error(`WATCHDOG: ${label} did not finish within ${ms}ms — failing.`);
    process.exit(1);
  }, ms);
}
