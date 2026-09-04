// ─────────────────────────────────────────────────────────────────────────────
// Status-change history — core2.dbo.RMOneStatusHistory
//
// The upstream schema only stores each record's CURRENT status/stage; the
// client's reports need "converted during the period" and time-in-stage
// numbers. Every status/stage write path (web + mobile picker via
// updateRecordFieldsRds, schedule auto-advance, imports) appends a row here:
// tenant, module, ticket, old status, new status, changed-at (UTC),
// changed-by, source. Reads are tenant-scoped.
//
// Writes are best-effort: history must NEVER fail or slow a save — every
// public writer catches internally and logs a warning instead of throwing.
// Table lives in core2 (shared across dev/prod like RMOneInviteTokens), so
// history written by any environment is visible to the production reports.
// ─────────────────────────────────────────────────────────────────────────────
import { getPool, sql } from "./db.js";
import { recordAuditEvents } from "./auditTrail.js";

export type StatusHistoryModule = "PMM" | "OPM" | "LEM";

export interface StatusChangeInput {
  tenantId: string;               // tenant GUID (TenantID)
  module: StatusHistoryModule;
  ticketId: string;
  oldStatus: string | null;
  newStatus: string | null;
  changedBy?: string | null;      // acting user id when a person made the change
  source: "user" | "auto" | "import";
}

export interface StatusHistoryRow {
  module: StatusHistoryModule;
  ticketId: string;
  oldStatus: string | null;
  newStatus: string | null;
  changedAt: string;              // ISO UTC
  changedBy: string | null;
  source: string;
}

let _ensured = false;
export async function ensureStatusHistoryTable(): Promise<void> {
  if (_ensured) return;
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM core2.sys.tables
      WHERE name = N'RMOneStatusHistory' AND schema_id = SCHEMA_ID(N'dbo')
    )
    BEGIN
      CREATE TABLE core2.dbo.RMOneStatusHistory (
        ID          BIGINT IDENTITY(1,1) PRIMARY KEY,
        TenantID    VARCHAR(64)   NOT NULL,
        Module      VARCHAR(8)    NOT NULL,
        TicketId    VARCHAR(128)  NOT NULL,
        OldStatus   NVARCHAR(255) NULL,
        NewStatus   NVARCHAR(255) NULL,
        ChangedAt   DATETIME2     NOT NULL CONSTRAINT DF_RMOneStatusHist_At DEFAULT GETUTCDATE(),
        ChangedBy   NVARCHAR(200) NULL,
        Source      VARCHAR(16)   NOT NULL CONSTRAINT DF_RMOneStatusHist_Src DEFAULT 'user'
      );
      CREATE INDEX IX_RMOneStatusHist_Tenant
        ON core2.dbo.RMOneStatusHistory (TenantID, Module, ChangedAt);
    END
  `);
  _ensured = true;
}

const norm = (s: string | null | undefined): string | null => {
  const v = String(s ?? "").trim();
  return v === "" ? null : v;
};

/**
 * Append one status change. Best-effort — never throws, never blocks the
 * caller's save. No-op when old and new are identical after trimming
 * (case-insensitive): an echo save is not a status change.
 */
export async function recordStatusChange(c: StatusChangeInput): Promise<void> {
  try {
    const oldS = norm(c.oldStatus);
    const newS = norm(c.newStatus);
    if ((oldS ?? "").toLowerCase() === (newS ?? "").toLowerCase()) return;
    await ensureStatusHistoryTable();
    const pool = await getPool();
    await pool.request()
      .input("tid", sql.VarChar, c.tenantId)
      .input("mod", sql.VarChar, c.module)
      .input("tick", sql.VarChar, String(c.ticketId ?? "").trim())
      .input("olds", sql.NVarChar, oldS)
      .input("news", sql.NVarChar, newS)
      .input("by", sql.NVarChar, norm(c.changedBy))
      .input("src", sql.VarChar, c.source)
      .query(`
        INSERT INTO core2.dbo.RMOneStatusHistory
          (TenantID, Module, TicketId, OldStatus, NewStatus, ChangedBy, Source)
        VALUES (@tid, @mod, @tick, @olds, @news, @by, @src)
      `);
    if (c.source !== "user") {
      void recordAuditEvents([{
        tenantId: c.tenantId,
        actorName: c.changedBy ?? null,
        actorEmail: c.changedBy?.includes("@") ? c.changedBy : null,
        actorType: c.source === "import" ? "import" : "system",
        action: "status.changed",
        outcome: "success",
        entityType: c.module === "PMM" ? "project" : c.module === "OPM" ? "opportunity" : "lead",
        entityId: c.ticketId,
        source: c.source,
        changes: [{ FieldName: "Status", OldValue: oldS, NewValue: newS }],
        metadata: { bridgedFrom: "status-history" },
      }]);
    }
  } catch (e) {
    console.warn(`[status-history] record failed for ${c.module} ${c.ticketId}: ${String(e).slice(0, 200)}`);
  }
}

/** Batch variant for import diffs — one INSERT per chunk, still best-effort. */
export async function recordStatusChanges(changes: StatusChangeInput[]): Promise<void> {
  const rows = changes.filter(c =>
    (norm(c.oldStatus) ?? "").toLowerCase() !== (norm(c.newStatus) ?? "").toLowerCase());
  if (rows.length === 0) return;
  try {
    await ensureStatusHistoryTable();
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
        req.input(`o${j}`, sql.NVarChar, norm(c.oldStatus));
        req.input(`n${j}`, sql.NVarChar, norm(c.newStatus));
        req.input(`b${j}`, sql.NVarChar, norm(c.changedBy));
        req.input(`s${j}`, sql.VarChar, c.source);
        values.push(`(@t${j}, @m${j}, @k${j}, @o${j}, @n${j}, @b${j}, @s${j})`);
      });
      await req.query(`
        INSERT INTO core2.dbo.RMOneStatusHistory
          (TenantID, Module, TicketId, OldStatus, NewStatus, ChangedBy, Source)
        VALUES ${values.join(", ")}
      `);
    }
    if (rows.some((row) => row.source !== "user")) {
      void recordAuditEvents(rows.filter((row) => row.source !== "user").map((row) => ({
        tenantId: row.tenantId,
        actorName: row.changedBy ?? null,
        actorEmail: row.changedBy?.includes("@") ? row.changedBy : null,
        actorType: row.source === "import" ? "import" : "system",
        action: "status.changed",
        outcome: "success",
        entityType: row.module === "PMM" ? "project" : row.module === "OPM" ? "opportunity" : "lead",
        entityId: row.ticketId,
        source: row.source,
        changes: [{ FieldName: "Status", OldValue: norm(row.oldStatus), NewValue: norm(row.newStatus) }],
        metadata: { bridgedFrom: "status-history" },
      })));
    }
  } catch (e) {
    console.warn(`[status-history] batch record failed (${rows.length} rows): ${String(e).slice(0, 200)}`);
  }
}

// ── import diff support ──────────────────────────────────────────────────────
// Imports write statuses through execInsert/execUpdate machinery with no
// per-row old-value context, so the pipeline takes a tenant-wide status
// snapshot BEFORE its entity writes and diffs it afterwards. Only tickets
// that existed before AND changed status produce history rows — brand-new
// records' initial status is not a "change".

const SNAP_TABLES: { table: string; module: StatusHistoryModule; cols: string[] }[] = [
  { table: "PMM",         module: "PMM", cols: ["CRMProjectStatusChoice", "Status"] },
  { table: "Opportunity", module: "OPM", cols: ["CRMOpportunityStatusChoice", "Status"] },
  { table: "Lead",        module: "LEM", cols: ["LeadStatus", "Status"] },
];

async function liveStatusCols(pool: sql.ConnectionPool, table: string, cols: string[]): Promise<string[]> {
  const r = await pool.request()
    .input("tbl", sql.NVarChar, table)
    .query(`
      SELECT c.name FROM core2.sys.columns c
      JOIN core2.sys.tables t ON t.object_id = c.object_id
      WHERE t.name = @tbl AND t.schema_id = SCHEMA_ID(N'dbo')
    `);
  const live = new Set(r.recordset.map((x: any) => String(x.name).toLowerCase()));
  return cols.filter(c => live.has(c.toLowerCase()));
}

export type StatusSnapshot = Map<string, string | null>; // `${module}|${ticket lower}` → status

/** Tenant-wide current statuses for PMM/OPM/LEM. Throws on failure — the
 *  pipeline catches and simply skips the diff for that run. */
export async function snapshotTenantStatuses(tenantId: string): Promise<StatusSnapshot> {
  const pool = await getPool();
  const snap: StatusSnapshot = new Map();
  for (const t of SNAP_TABLES) {
    const cols = await liveStatusCols(pool, t.table, t.cols);
    if (cols.length === 0) continue;
    const expr = cols.length > 1 ? `COALESCE([${cols.join("], [")}])` : `[${cols[0]}]`;
    const r = await pool.request()
      .input("tid", sql.VarChar, tenantId)
      .query(`
        SELECT [TicketId] AS tick, ${expr} AS st
        FROM core2.dbo.[${t.table}]
        WHERE [TenantID] = @tid AND ([Deleted] = 0 OR [Deleted] IS NULL)
      `);
    for (const row of r.recordset) {
      const tick = String(row.tick ?? "").trim();
      if (!tick) continue;
      snap.set(`${t.module}|${tick.toLowerCase()}`, norm(row.st));
    }
  }
  return snap;
}

/**
 * Diff a fresh snapshot against the pre-import one and append history rows
 * for every ticket whose status changed. Best-effort; returns rows written.
 */
export async function recordImportStatusDiff(tenantId: string, before: StatusSnapshot): Promise<number> {
  try {
    const after = await snapshotTenantStatuses(tenantId);
    const changes: StatusChangeInput[] = [];
    for (const [key, newStatus] of after) {
      if (!before.has(key)) continue; // new record — initial status, not a change
      const oldStatus = before.get(key) ?? null;
      if ((oldStatus ?? "").toLowerCase() === (newStatus ?? "").toLowerCase()) continue;
      const [module, tick] = key.split("|") as [StatusHistoryModule, string];
      changes.push({ tenantId, module, ticketId: tick.toUpperCase(), oldStatus, newStatus, source: "import" });
    }
    await recordStatusChanges(changes);
    return changes.length;
  } catch (e) {
    console.warn(`[status-history] import diff failed: ${String(e).slice(0, 200)}`);
    return 0;
  }
}

// ── reads ────────────────────────────────────────────────────────────────────

/** Tenant-scoped history plus the tenant's earliest recorded change ("tracking
 *  since"). Capped newest-first; when the cap is hit, `truncated` is true and
 *  consumers must treat coverage as starting at the OLDEST returned row (the
 *  window is complete from there to now), never at `since` — otherwise counts
 *  could silently undercount while claiming full coverage. */
export async function fetchStatusHistory(
  tenantId: string,
  opts?: { module?: StatusHistoryModule; limit?: number },
): Promise<{ rows: StatusHistoryRow[]; since: string | null; truncated: boolean }> {
  await ensureStatusHistoryTable();
  const pool = await getPool();
  const limit = Math.min(Math.max(1, opts?.limit ?? 5000), 20000);
  const modClause = opts?.module ? "AND [Module] = @mod" : "";
  const req = pool.request().input("tid", sql.VarChar, tenantId);
  if (opts?.module) req.input("mod", sql.VarChar, opts.module);
  const r = await req.query(`
    SELECT TOP (${limit})
      [Module] AS module, [TicketId] AS ticketId, [OldStatus] AS oldStatus,
      [NewStatus] AS newStatus, [ChangedAt] AS changedAt, [ChangedBy] AS changedBy,
      [Source] AS source
    FROM core2.dbo.RMOneStatusHistory
    WHERE [TenantID] = @tid ${modClause}
    ORDER BY [ChangedAt] DESC, [ID] DESC;
    SELECT MIN([ChangedAt]) AS since
    FROM core2.dbo.RMOneStatusHistory
    WHERE [TenantID] = @tid;
  `);
  const sets = (r.recordsets ?? []) as unknown as any[][];
  const rows: StatusHistoryRow[] = (sets[0] ?? []).map((x: any) => ({
    module: String(x.module) as StatusHistoryModule,
    ticketId: String(x.ticketId),
    oldStatus: x.oldStatus ?? null,
    newStatus: x.newStatus ?? null,
    changedAt: x.changedAt instanceof Date ? x.changedAt.toISOString() : String(x.changedAt),
    changedBy: x.changedBy ?? null,
    source: String(x.source ?? "user"),
  }));
  const sinceRaw = sets[1]?.[0]?.since ?? null;
  const since = sinceRaw ? (sinceRaw instanceof Date ? sinceRaw.toISOString() : String(sinceRaw)) : null;
  return { rows, since, truncated: rows.length >= limit };
}
