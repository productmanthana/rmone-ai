// ─────────────────────────────────────────────────────────────────────────────
// Contract-value change history — core2.dbo.RMOneFieldHistory
//
// The upstream schema only stores each record's CURRENT contract values, so
// "who changed this value and when" could previously only be answered with
// production log forensics (Aug 26 incident: a Lead's ApproxContractValue /
// ContractValue edited 9x within minutes — every save landed, but nothing
// in-product could show the trail). This ledger mirrors RMOneStatusHistory:
// every financial value write through the canonical record-field updater
// (updateRecordFieldsRds) appends a row here — tenant, module, ticket, field
// (the live column written), old value, new value, changed-at (UTC),
// changed-by (username + user id), source. Imports have no per-row old-value
// context, so the pipeline takes a snapshot before its writes and diffs it
// afterwards (source "import"), exactly like the status ledger.
//
// Ledgered fields — the canonical contract-value kinds plus every live column
// a canonical write can land on (schema drift: e.g. a tenant without
// ContractValue lands "ContractValue" edits on ApproxContractValue), along
// with the forecast and non-operating cost fields from the Budget card:
//   labor         → LaborContractAmount
//   approxvalue   → ApproxContractValue, ContractValue
//   contractvalue → ContractValue, ApproxContractValue, ProjectValue
//   forecastcost  → ForecastedProjectCost
//   noncost       → NonOperatingCost
//
// Writes are best-effort: history must NEVER fail or slow a save — every
// public writer catches internally and logs a warning instead of throwing.
// Table lives in core2 (shared across dev/prod like RMOneStatusHistory), so
// history written by any environment is visible in production.
// ─────────────────────────────────────────────────────────────────────────────
import { getPool, sql } from "./db.js";
import { recordAuditEvents } from "./auditTrail.js";

export type FieldHistoryModule = "PMM" | "OPM" | "LEM";

/** Live columns whose changes are ledgered (landing columns of the
 *  contract-value and Budget-card money field kinds in updateRecordFieldsRds). */
export const LEDGERED_VALUE_COLUMNS = [
  "ContractValue",
  "ApproxContractValue",
  "ProjectValue",
  "LaborContractAmount",
  "ForecastedProjectCost",
  "NonOperatingCost",
] as const;
const LEDGERED_SET = new Set<string>(LEDGERED_VALUE_COLUMNS.map((c) => c.toLowerCase()));
export const isLedgeredValueColumn = (col: string): boolean => LEDGERED_SET.has(col.toLowerCase());

export interface FieldChangeInput {
  tenantId: string;               // tenant GUID (TenantID)
  module: FieldHistoryModule;
  ticketId: string;
  fieldName: string;              // the live column written (e.g. ContractValue)
  oldValue: string | null;        // canonical money string (normalizeMoneyValue)
  newValue: string | null;
  changedBy?: string | null;      // acting user's USERNAME when a person made the change
  changedById?: string | null;    // acting user's GUID
  source: "user" | "auto" | "import";
}

export interface FieldChangeRow {
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;              // ISO UTC
  changedBy: string | null;
  changedById: string | null;
  source: string;
}

/**
 * Canonical money form shared by the write capture, the pre-UPDATE old-value
 * read, and the import snapshot/diff — so echo detection compares like with
 * like. Mirrors the updateRecordFieldsRds numeric binding ($ , and whitespace
 * stripped; blank/non-numeric → null) and the Decimal(18,2) column (2-dp
 * rounding, trailing zeros trimmed). Values too large for toFixed (the DB
 * holds quintillion-scale junk) fall back to String(n).
 */
export function normalizeMoneyValue(v: unknown): string | null {
  if (v == null) return null;
  const raw = String(v).replace(/[$,\s]/g, "");
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) >= 1e15) return String(n);
  return n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/** True when old and new are the same value after canonicalization — an echo
 *  save, never recorded. */
export function isEchoValueChange(oldValue: string | null, newValue: string | null): boolean {
  return (normalizeMoneyValue(oldValue) ?? "") === (normalizeMoneyValue(newValue) ?? "");
}

let _ensured = false;
export async function ensureFieldHistoryTable(): Promise<void> {
  if (_ensured) return;
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM core2.sys.tables
      WHERE name = N'RMOneFieldHistory' AND schema_id = SCHEMA_ID(N'dbo')
    )
    BEGIN
      CREATE TABLE core2.dbo.RMOneFieldHistory (
        ID          BIGINT IDENTITY(1,1) PRIMARY KEY,
        TenantID    VARCHAR(64)   NOT NULL,
        Module      VARCHAR(8)    NOT NULL,
        TicketId    VARCHAR(128)  NOT NULL,
        FieldName   VARCHAR(64)   NOT NULL,
        OldValue    NVARCHAR(64)  NULL,
        NewValue    NVARCHAR(64)  NULL,
        ChangedAt   DATETIME2     NOT NULL CONSTRAINT DF_RMOneFieldHist_At DEFAULT GETUTCDATE(),
        ChangedBy   NVARCHAR(200) NULL,
        ChangedById NVARCHAR(64)  NULL,
        Source      VARCHAR(16)   NOT NULL CONSTRAINT DF_RMOneFieldHist_Src DEFAULT 'user'
      );
      CREATE INDEX IX_RMOneFieldHist_Record
        ON core2.dbo.RMOneFieldHistory (TenantID, TicketId, ChangedAt);
    END
  `);
  _ensured = true;
}

const normStr = (s: string | null | undefined): string | null => {
  const v = String(s ?? "").trim();
  return v === "" ? null : v;
};

/**
 * Append one contract-value change. Best-effort — never throws, never blocks
 * the caller's save. No-op when old and new are the same canonical value.
 */
export async function recordFieldChange(c: FieldChangeInput): Promise<void> {
  try {
    if (isEchoValueChange(c.oldValue, c.newValue)) return;
    await ensureFieldHistoryTable();
    const pool = await getPool();
    await pool.request()
      .input("tid", sql.VarChar, c.tenantId)
      .input("mod", sql.VarChar, c.module)
      .input("tick", sql.VarChar, String(c.ticketId ?? "").trim())
      .input("fld", sql.VarChar, c.fieldName)
      .input("oldv", sql.NVarChar, normalizeMoneyValue(c.oldValue))
      .input("newv", sql.NVarChar, normalizeMoneyValue(c.newValue))
      .input("by", sql.NVarChar, normStr(c.changedBy))
      .input("byId", sql.NVarChar, normStr(c.changedById))
      .input("src", sql.VarChar, c.source)
      .query(`
        INSERT INTO core2.dbo.RMOneFieldHistory
          (TenantID, Module, TicketId, FieldName, OldValue, NewValue, ChangedBy, ChangedById, Source)
        VALUES (@tid, @mod, @tick, @fld, @oldv, @newv, @by, @byId, @src)
      `);
  } catch (e) {
    console.warn(`[field-history] record failed for ${c.module} ${c.ticketId}.${c.fieldName}: ${String(e).slice(0, 200)}`);
  }
}

/** Batch variant (import diffs, multi-field saves) — one INSERT per chunk,
 *  still best-effort. */
export async function recordFieldChanges(changes: FieldChangeInput[]): Promise<void> {
  const rows = changes.filter((c) => !isEchoValueChange(c.oldValue, c.newValue));
  if (rows.length === 0) return;
  try {
    await ensureFieldHistoryTable();
    const pool = await getPool();
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const req = pool.request();
      const values: string[] = [];
      slice.forEach((c, j) => {
        req.input(`t${j}`, sql.VarChar, c.tenantId);
        req.input(`m${j}`, sql.VarChar, c.module);
        req.input(`k${j}`, sql.VarChar, String(c.ticketId ?? "").trim());
        req.input(`f${j}`, sql.VarChar, c.fieldName);
        req.input(`o${j}`, sql.NVarChar, normalizeMoneyValue(c.oldValue));
        req.input(`n${j}`, sql.NVarChar, normalizeMoneyValue(c.newValue));
        req.input(`b${j}`, sql.NVarChar, normStr(c.changedBy));
        req.input(`i${j}`, sql.NVarChar, normStr(c.changedById));
        req.input(`s${j}`, sql.VarChar, c.source);
        values.push(`(@t${j}, @m${j}, @k${j}, @f${j}, @o${j}, @n${j}, @b${j}, @i${j}, @s${j})`);
      });
      await req.query(`
        INSERT INTO core2.dbo.RMOneFieldHistory
          (TenantID, Module, TicketId, FieldName, OldValue, NewValue, ChangedBy, ChangedById, Source)
        VALUES ${values.join(", ")}
      `);
    }
    if (rows.some((row) => row.source !== "user")) {
      void recordAuditEvents(rows.filter((row) => row.source !== "user").map((row) => ({
        tenantId: row.tenantId,
        actorId: row.changedById ?? null,
        actorName: row.changedBy ?? null,
        actorEmail: row.changedBy?.includes("@") ? row.changedBy : null,
        actorType: row.source === "import" ? "import" : "system",
        action: "financial-field.changed",
        outcome: "success",
        entityType: row.module === "PMM" ? "project" : row.module === "OPM" ? "opportunity" : "lead",
        entityId: row.ticketId,
        source: row.source,
        changes: [{ FieldName: row.fieldName, OldValue: row.oldValue, NewValue: row.newValue }],
        metadata: { bridgedFrom: "field-history" },
      })));
    }
  } catch (e) {
    console.warn(`[field-history] batch record failed (${rows.length} rows): ${String(e).slice(0, 200)}`);
  }
}

// ── import diff support ──────────────────────────────────────────────────────
// Imports write contract values through execInsert/execUpdate machinery with
// no per-row old-value context, so the pipeline takes a tenant-wide snapshot
// of the ledgered columns BEFORE its entity writes and diffs it afterwards.
// Only tickets that existed before AND whose value changed produce history
// rows — a brand-new record's initial value is not a "change".

const SNAP_TABLES: { table: string; module: FieldHistoryModule }[] = [
  { table: "PMM",         module: "PMM" },
  { table: "Opportunity", module: "OPM" },
  { table: "Lead",        module: "LEM" },
];

async function liveValueCols(pool: sql.ConnectionPool, table: string): Promise<string[]> {
  const r = await pool.request()
    .input("tbl", sql.NVarChar, table)
    .query(`
      SELECT c.name FROM core2.sys.columns c
      JOIN core2.sys.tables t ON t.object_id = c.object_id
      WHERE t.name = @tbl AND t.schema_id = SCHEMA_ID(N'dbo')
    `);
  const live = new Set(r.recordset.map((x: any) => String(x.name).toLowerCase()));
  return LEDGERED_VALUE_COLUMNS.filter((c) => live.has(c.toLowerCase()));
}

/** `${module}|${ticket lower}|${column}` → canonical money value */
export type FieldSnapshot = Map<string, string | null>;

/** Tenant-wide current contract values for PMM/OPM/LEM. Throws on failure —
 *  the pipeline catches and simply skips the diff for that run (never diff
 *  against an unknown baseline). */
export async function snapshotTenantFieldValues(tenantId: string): Promise<FieldSnapshot> {
  const pool = await getPool();
  const snap: FieldSnapshot = new Map();
  for (const t of SNAP_TABLES) {
    const cols = await liveValueCols(pool, t.table);
    if (cols.length === 0) continue;
    const r = await pool.request()
      .input("tid", sql.VarChar, tenantId)
      .query(`
        SELECT [TicketId] AS tick, [${cols.join("], [")}]
        FROM core2.dbo.[${t.table}]
        WHERE [TenantID] = @tid AND ([Deleted] = 0 OR [Deleted] IS NULL)
      `);
    for (const row of r.recordset) {
      const tick = String(row.tick ?? "").trim();
      if (!tick) continue;
      for (const col of cols) {
        snap.set(`${t.module}|${tick.toLowerCase()}|${col}`, normalizeMoneyValue((row as any)[col]));
      }
    }
  }
  return snap;
}

/** Pure diff of two snapshots → the changes to append. Tickets absent from
 *  `before` are NEW records (initial value, not a change) and are skipped. */
export function diffFieldSnapshots(
  tenantId: string,
  before: FieldSnapshot,
  after: FieldSnapshot,
): FieldChangeInput[] {
  const changes: FieldChangeInput[] = [];
  for (const [key, newValue] of after) {
    if (!before.has(key)) continue; // new record/column — not a change
    const oldValue = before.get(key) ?? null;
    if ((oldValue ?? "") === (newValue ?? "")) continue; // both already canonical
    const [module, tick, col] = key.split("|") as [FieldHistoryModule, string, string];
    changes.push({
      tenantId, module, ticketId: tick.toUpperCase(), fieldName: col,
      oldValue, newValue, source: "import",
    });
  }
  return changes;
}

/**
 * Diff a fresh snapshot against the pre-import one and append history rows
 * for every record whose contract values changed. Best-effort; returns the
 * number of rows written.
 */
export async function recordImportFieldDiff(tenantId: string, before: FieldSnapshot): Promise<number> {
  try {
    const after = await snapshotTenantFieldValues(tenantId);
    const changes = diffFieldSnapshots(tenantId, before, after);
    await recordFieldChanges(changes);
    return changes.length;
  } catch (e) {
    console.warn(`[field-history] import diff failed: ${String(e).slice(0, 200)}`);
    return 0;
  }
}

// ── reads ────────────────────────────────────────────────────────────────────

/** One record's contract-value trail, newest-first, capped. `truncated` is
 *  true when the cap was hit (older rows exist beyond the returned window). */
export async function fetchFieldHistory(
  tenantId: string,
  ticketId: string,
  opts?: { limit?: number },
): Promise<{ rows: FieldChangeRow[]; truncated: boolean }> {
  await ensureFieldHistoryTable();
  const pool = await getPool();
  const limit = Math.min(Math.max(1, opts?.limit ?? 200), 1000);
  const r = await pool.request()
    .input("tid", sql.VarChar, tenantId)
    .input("tick", sql.VarChar, String(ticketId ?? "").trim())
    .query(`
      SELECT TOP (${limit})
        [FieldName] AS fieldName, [OldValue] AS oldValue, [NewValue] AS newValue,
        [ChangedAt] AS changedAt, [ChangedBy] AS changedBy, [ChangedById] AS changedById,
        [Source] AS source
      FROM core2.dbo.RMOneFieldHistory
      WHERE [TenantID] = @tid AND [TicketId] = @tick
      ORDER BY [ChangedAt] DESC, [ID] DESC
    `);
  const rows: FieldChangeRow[] = (r.recordset ?? []).map((x: any) => ({
    fieldName: String(x.fieldName),
    oldValue: x.oldValue ?? null,
    newValue: x.newValue ?? null,
    changedAt: x.changedAt instanceof Date ? x.changedAt.toISOString() : String(x.changedAt),
    changedBy: x.changedBy ?? null,
    changedById: x.changedById ?? null,
    source: String(x.source ?? "user"),
  }));
  return { rows, truncated: rows.length >= limit };
}
