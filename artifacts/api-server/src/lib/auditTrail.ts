import type { NextFunction, Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { getPool, sql } from "./db.js";
import { resolveRequestSource, type RequestSource } from "./rds-auth.js";

export type AuditOutcome = "success" | "failed" | "denied" | "partial" | "cancelled";
export type AuditTrailEventKind = "interaction" | "change";

export interface TrustedAuditChange {
  FieldName: string;
  OldValue: unknown;
  NewValue: unknown;
}
const AUDIT_INTERACTION_TYPES = new Set([
  "view", "open", "close", "navigate", "filter", "search", "export", "action",
]);
const AUDIT_INTERACTION_ENTITY_TYPES = new Set([
  "project", "opportunity", "lead", "company", "contact", "staff",
  "resource", "allocation", "configuration", "dashboard", "report",
  "audit-trail", "list", "record",
]);
const AUDIT_INTERACTION_SCREENS = new Set([
  "home", "alerts", "chat", "daily-briefing", "forecast", "login", "profile",
  "projects", "project-create", "project-detail", "rate-card", "resources",
  "rfp", "screenshot", "superadmin",
]);
const AUDIT_INTERACTION_ID = /^[a-z0-9][a-z0-9._:-]{0,199}$/i;

export interface AuditInteractionTarget {
  interactionType: string;
  entityType: string | null;
  entityId: string | null;
}

/** Accept only the semantic identifiers used by POST /audit-interaction.
 *  This intentionally rejects arbitrary request fields and never returns a
 *  display name or a selected/filter value for persistence. */
export function parseAuditInteraction(value: unknown): AuditInteractionTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (!keys.every((key) => ["interactionType", "entityType", "entityId", "screen"].includes(key))) return null;
  if (typeof body.interactionType !== "string" || !AUDIT_INTERACTION_TYPES.has(body.interactionType)) return null;
  if (body.entityType != null
    && (typeof body.entityType !== "string" || !AUDIT_INTERACTION_ENTITY_TYPES.has(body.entityType))) return null;
  if (body.entityId != null
    && (typeof body.entityId !== "string" || !AUDIT_INTERACTION_ID.test(body.entityId))) return null;
  if (body.screen != null
    && (typeof body.screen !== "string" || !AUDIT_INTERACTION_SCREENS.has(body.screen))) return null;
  // Entity IDs are only meaningful alongside a typed entity.
  if (body.entityId != null && body.entityType == null) return null;
  if (body.screen != null && (body.entityType != null || body.entityId != null)) return null;
  const screen = typeof body.screen === "string" ? body.screen : null;
  return {
    interactionType: body.interactionType,
    entityType: screen?.startsWith("project-") ? "project" : body.entityType ?? (screen ? "dashboard" : null),
    entityId: screen ?? body.entityId ?? null,
  };
}

export interface AuditEventInput {
  eventKey?: string;
  tenantId: string;
  actorId?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  actorType?: "user" | "system" | "import" | "ai" | "api";
  action: string;
  outcome: AuditOutcome;
  entityType?: string | null;
  entityId?: string | null;
  entityName?: string | null;
  source?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  changes?: unknown;
  failureReason?: string | null;
  metadata?: unknown;
}

/** Account-security standing of the actor at read time, derived from the live
 *  user roster (rmone_users). "system" covers automated/import/AI actors. */
export type AuditAccountStatus =
  | "secured"        // active account with a password-protected sign-in
  | "invite_pending" // account exists but the user has not set a password yet
  | "deactivated"    // account exists but sign-in is disabled
  | "removed"        // actor recorded but no longer in the user roster
  | "system"         // automated actor (RM ONE, imports, AI)
  | "unknown";       // no actor identity was recorded

export interface AuditTrailRow {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  actorType: string;
  accountStatus: AuditAccountStatus;
  action: string;
  outcome: AuditOutcome;
  entityType: string | null;
  entityId: string | null;
  entityName: string | null;
  source: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  changes: unknown;
  failureReason: string | null;
  metadata: unknown;
  createdAt: string;
}

const SECRET_KEY = /(password|passwd|secret|token|authorization|cookie|session|api[-_]?key|private[-_]?key|credential)/i;
const PRIVATE_VALUE_KEY = /(ssn|social.?security|date.?of.?birth|dob|bank|routing|account.?number|card|cvv|passport|driver.?licen[cs]e|phone|mobile|address|postal|zip|email)/i;
import { isFinancialFieldName } from "./financial-fields.js";

const FINANCIAL_KEY = /(amount|budget|cost|rate|revenue|contractvalue|projectvalue|financial|margin|fee|price)/i;
const MAX_JSON = 12_000;
const MAX_FAILURE = 500;
export const AUDIT_RETENTION_POLICY = "indefinite" as const;

// POST endpoints that only READ data (page-load fetches and telemetry pings).
// Method alone misclassifies them as edits: they carry query-shaped bodies,
// mutate nothing, and produced "Edited project — no change details" noise rows
// on every project-detail page load (Aug 2026). Keep this list in lockstep
// with the read-side exclusion in fetchAuditTrail.
export const READ_SHAPED_POST_PATHS = [
  "/project-allocations",
  "/usage-beacon",
  // Read-only queries that use POST for their request body: bench/availability
  // lookups write nothing, so recording them would fabricate "edit" rows.
  "/bench-resources",
  "/resource-skills-availability",
  // Client diagnostic log shipping — telemetry, not a user action.
  "/debug-log",
] as const;
export function isReadShapedPost(path: string): boolean {
  return READ_SHAPED_POST_PATHS.some((suffix) => path.endsWith(suffix));
}

// Last-resort in-memory retry queue. The durable outbox lives in the SAME
// database as the audit table, so a DB-side failure (pool outage, lock
// timeout) usually takes BOTH down at once — events used to vanish silently
// (Aug 27 2026: two financial edits lost this way). Bounded so a long outage
// cannot grow the heap without limit; drops are counted as write failures.
const MEMORY_PENDING_MAX = 2000;
const memoryPendingEvents: AuditEventInput[] = [];
function stashAuditEventsInMemory(events: readonly AuditEventInput[]): void {
  for (const event of events) memoryPendingEvents.push(event);
  if (memoryPendingEvents.length > MEMORY_PENDING_MAX) {
    const dropped = memoryPendingEvents.splice(0, memoryPendingEvents.length - MEMORY_PENDING_MAX);
    noteAuditBatchFailure(new Error("audit memory queue overflow — events permanently dropped"), dropped);
  }
  scheduleOutboxDrain(5_000);
}
interface TenantAuditHealthState {
  failures: number;
  pending: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  errorClass: string;
  flushing: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}
const tenantHealth = new Map<string, TenantAuditHealthState>();

function healthState(tenantId: string): TenantAuditHealthState {
  const key = tenantId || "system";
  let state = tenantHealth.get(key);
  if (!state) {
    state = { failures: 0, pending: 0, lastFailureAt: null, lastSuccessAt: null, errorClass: "unknown", flushing: false, timer: null };
    tenantHealth.set(key, state);
  }
  return state;
}

function scheduleHealthFlush(tenantId: string, delayMs: number): void {
  const state = healthState(tenantId);
  if (state.timer || state.flushing || state.pending <= 0) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    void flushAuditHealth(tenantId);
  }, delayMs);
  state.timer.unref?.();
}

async function flushAuditHealth(tenantId: string): Promise<void> {
  const state = healthState(tenantId);
  if (state.flushing || state.pending <= 0) return;
  state.flushing = true;
  const toPersist = state.pending;
  try {
    const pool = await getPool();
    await pool.request().query(`
      IF OBJECT_ID(N'rmoneapp.dbo.rmone_audit_health', N'U') IS NULL
      BEGIN
        CREATE TABLE rmoneapp.dbo.rmone_audit_health (
          id BIGINT IDENTITY(1,1) PRIMARY KEY,
          occurred_at DATETIME2(3) NOT NULL CONSTRAINT DF_rmone_audit_health_at DEFAULT SYSUTCDATETIME(),
          tenant_id VARCHAR(64) NOT NULL,
          failure_count INT NOT NULL,
          error_class VARCHAR(24) NOT NULL
        );
        CREATE INDEX IX_rmone_audit_health_at ON rmoneapp.dbo.rmone_audit_health (tenant_id, occurred_at DESC);
      END
      ELSE IF COL_LENGTH(N'rmoneapp.dbo.rmone_audit_health', N'tenant_id') IS NULL
      BEGIN
        ALTER TABLE rmoneapp.dbo.rmone_audit_health ADD tenant_id VARCHAR(64) NULL;
        UPDATE rmoneapp.dbo.rmone_audit_health SET tenant_id = 'system' WHERE tenant_id IS NULL;
        ALTER TABLE rmoneapp.dbo.rmone_audit_health ALTER COLUMN tenant_id VARCHAR(64) NOT NULL;
      END
    `);
    await pool.request()
      .input("tenant", sql.VarChar, tenantId)
      .input("count", sql.Int, toPersist)
      .input("class", sql.VarChar, state.errorClass)
      .query("INSERT INTO rmoneapp.dbo.rmone_audit_health (tenant_id, failure_count, error_class) VALUES (@tenant, @count, @class)");
    state.pending = Math.max(0, state.pending - toPersist);
  } catch (healthError) {
    console.error(`[audit-trail] could not persist audit health signal: ${String(healthError).slice(0, 200)}`);
  } finally {
    state.flushing = false;
    if (state.pending > 0) scheduleHealthFlush(tenantId, state.pending < toPersist ? 1_000 : 60_000);
  }
}

function noteAuditWriteFailure(error: unknown, count = 1, tenantId = "system"): void {
  const state = healthState(tenantId);
  state.failures += count;
  state.pending += count;
  state.lastFailureAt = new Date().toISOString();
  state.errorClass = createHash("sha256").update(String(error).slice(0, 500)).digest("hex").slice(0, 24);
  scheduleHealthFlush(tenantId, 1_000);
}

export function countAuditEventsByTenant(events: readonly AuditEventInput[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    const tenantId = event.tenantId || "system";
    counts.set(tenantId, (counts.get(tenantId) ?? 0) + 1);
  }
  return counts;
}

function noteAuditBatchFailure(error: unknown, events: readonly AuditEventInput[]): void {
  for (const [tenantId, count] of countAuditEventsByTenant(events)) {
    noteAuditWriteFailure(error, count, tenantId);
  }
}

function clipped(value: unknown, max = 500): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeAuditValue(item, depth + 1));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const fieldName = String(record["FieldName"] ?? record["fieldName"] ?? record["field"] ?? record["name"] ?? "");
    if (SECRET_KEY.test(fieldName) || PRIVATE_VALUE_KEY.test(fieldName)) {
      return {
        ...Object.fromEntries(Object.entries(record).filter(([key]) => !/^(value|oldvalue|newvalue|before|after)$/i.test(key))),
        Value: "[redacted]",
      };
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record).slice(0, 100)) {
      out[key] = SECRET_KEY.test(key) || PRIVATE_VALUE_KEY.test(key) ? "[redacted]" : sanitizeAuditValue(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

function safeJson(value: unknown): string | null {
  if (value == null) return null;
  try {
    const json = JSON.stringify(sanitizeAuditValue(value));
    return json.length <= MAX_JSON ? json : JSON.stringify({ truncated: true });
  } catch {
    return null;
  }
}

let ensurePromise: Promise<void> | null = null;
let outboxEnsurePromise: Promise<void> | null = null;
let outboxDrainTimer: ReturnType<typeof setTimeout> | null = null;
let outboxDrainAt = 0;
let outboxDraining = false;

function normalizedAuditEvent(event: AuditEventInput): AuditEventInput {
  return { ...event, eventKey: clipped(event.eventKey, 64) ?? randomUUID() };
}

export function ensureAuditTrailTable(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    const pool = await getPool();
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM core2.sys.tables
        WHERE name = N'RMOneAuditTrail' AND schema_id = SCHEMA_ID(N'dbo')
      )
      BEGIN
        CREATE TABLE core2.dbo.RMOneAuditTrail (
          ID             BIGINT IDENTITY(1,1) PRIMARY KEY,
          EventKey       VARCHAR(64)    NOT NULL,
          TenantID       VARCHAR(64)    NOT NULL,
          ActorID        NVARCHAR(200)  NULL,
          ActorName      NVARCHAR(255)  NULL,
          ActorEmail     NVARCHAR(320)  NULL,
          ActorRole      NVARCHAR(255)  NULL,
          ActorType      VARCHAR(24)    NOT NULL CONSTRAINT DF_RMOneAudit_ActorType DEFAULT 'user',
          Action         VARCHAR(160)   NOT NULL,
          Outcome        VARCHAR(24)    NOT NULL,
          EntityType     VARCHAR(64)    NULL,
          EntityID       NVARCHAR(200)  NULL,
          EntityName     NVARCHAR(500)  NULL,
          Source         VARCHAR(80)    NULL,
          IPAddress      VARCHAR(64)    NULL,
          UserAgent      NVARCHAR(600)  NULL,
          RequestID      VARCHAR(128)   NULL,
          ChangesJson    NVARCHAR(MAX)  NULL,
          FailureReason  NVARCHAR(1000) NULL,
          MetadataJson   NVARCHAR(MAX)  NULL,
          CreatedAt      DATETIME2(3)   NOT NULL CONSTRAINT DF_RMOneAudit_At DEFAULT SYSUTCDATETIME()
        );
        CREATE INDEX IX_RMOneAudit_TenantAt
          ON core2.dbo.RMOneAuditTrail (TenantID, CreatedAt DESC, ID DESC);
        CREATE INDEX IX_RMOneAudit_Target
          ON core2.dbo.RMOneAuditTrail (TenantID, EntityType, EntityID, ID DESC);
        CREATE INDEX IX_RMOneAudit_Actor
          ON core2.dbo.RMOneAuditTrail (TenantID, ActorID, ID DESC);
        CREATE UNIQUE INDEX UX_RMOneAudit_EventKey
          ON core2.dbo.RMOneAuditTrail (EventKey);
      END
      ELSE IF COL_LENGTH(N'core2.dbo.RMOneAuditTrail', N'EventKey') IS NULL
      BEGIN
        ALTER TABLE core2.dbo.RMOneAuditTrail ADD EventKey VARCHAR(64) NULL;
        EXEC core2.sys.sp_executesql N'CREATE UNIQUE INDEX UX_RMOneAudit_EventKey ON dbo.RMOneAuditTrail (EventKey) WHERE EventKey IS NOT NULL';
      END

      -- Tenant-wide lists (Audit Center) read ORDER BY ID DESC with only the
      -- TenantID filter; the (TenantID, CreatedAt, ID) index cannot serve that
      -- order without sorting every tenant row, so the hot shape gets its own
      -- key. Existing deployments pick this up here (idempotent).
      IF EXISTS (SELECT 1 FROM core2.sys.tables WHERE name = N'RMOneAuditTrail' AND schema_id = SCHEMA_ID(N'dbo'))
         AND NOT EXISTS (SELECT 1 FROM core2.sys.indexes WHERE name = N'IX_RMOneAudit_TenantId' AND object_id = OBJECT_ID(N'core2.dbo.RMOneAuditTrail'))
        CREATE INDEX IX_RMOneAudit_TenantId ON core2.dbo.RMOneAuditTrail (TenantID, ID DESC);
    `);
    await pool.request().query(`
      EXEC core2.sys.sp_executesql N'
        CREATE OR ALTER TRIGGER dbo.TR_RMOneAuditTrail_AppendOnly
        ON dbo.RMOneAuditTrail
        INSTEAD OF UPDATE, DELETE
        AS
        BEGIN
          SET NOCOUNT ON;
          THROW 51001, ''RMOneAuditTrail is append-only'', 1;
        END
      '
    `);
  })().catch((error) => {
    ensurePromise = null;
    throw error;
  });
  return ensurePromise;
}

export function ensureAuditOutboxTable(): Promise<void> {
  if (outboxEnsurePromise) return outboxEnsurePromise;
  outboxEnsurePromise = (async () => {
    const pool = await getPool();
    await pool.request().query(`
      IF OBJECT_ID(N'rmoneapp.dbo.rmone_audit_outbox', N'U') IS NULL
      BEGIN
        CREATE TABLE rmoneapp.dbo.rmone_audit_outbox (
          OutboxID BIGINT IDENTITY(1,1) PRIMARY KEY,
          EventKey VARCHAR(64) NOT NULL,
          TenantID VARCHAR(64) NOT NULL,
          PayloadJson NVARCHAR(MAX) NOT NULL,
          Attempts INT NOT NULL CONSTRAINT DF_rmone_audit_outbox_attempts DEFAULT 0,
          NextAttemptAt DATETIME2(3) NOT NULL CONSTRAINT DF_rmone_audit_outbox_next DEFAULT SYSUTCDATETIME(),
          CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_rmone_audit_outbox_created DEFAULT SYSUTCDATETIME()
        );
        CREATE UNIQUE INDEX UX_rmone_audit_outbox_event ON rmoneapp.dbo.rmone_audit_outbox (EventKey);
        CREATE INDEX IX_rmone_audit_outbox_due ON rmoneapp.dbo.rmone_audit_outbox (NextAttemptAt, OutboxID);
      END

      -- Health table is created EAGERLY: it used to exist only after the
      -- first successful failure-flush, which meant an incident that broke
      -- audit writes also prevented the health signal from ever persisting.
      IF OBJECT_ID(N'rmoneapp.dbo.rmone_audit_health', N'U') IS NULL
      BEGIN
        CREATE TABLE rmoneapp.dbo.rmone_audit_health (
          id BIGINT IDENTITY(1,1) PRIMARY KEY,
          occurred_at DATETIME2(3) NOT NULL CONSTRAINT DF_rmone_audit_health_at DEFAULT SYSUTCDATETIME(),
          tenant_id VARCHAR(64) NOT NULL,
          failure_count INT NOT NULL,
          error_class VARCHAR(24) NOT NULL
        );
        CREATE INDEX IX_rmone_audit_health_at ON rmoneapp.dbo.rmone_audit_health (tenant_id, occurred_at DESC);
      END
    `);
  })().catch((error) => {
    outboxEnsurePromise = null;
    throw error;
  });
  return outboxEnsurePromise;
}

function scheduleOutboxDrain(delayMs = 1_000): void {
  const desiredAt = Date.now() + delayMs;
  if (outboxDrainTimer && outboxDrainAt <= desiredAt) return;
  if (outboxDrainTimer) clearTimeout(outboxDrainTimer);
  outboxDrainAt = desiredAt;
  outboxDrainTimer = setTimeout(() => {
    outboxDrainTimer = null;
    outboxDrainAt = 0;
    void drainAuditOutbox();
  }, delayMs);
  outboxDrainTimer.unref?.();
}

export function startAuditOutboxWorker(): void {
  scheduleOutboxDrain(1_000);
}

async function enqueueAuditOutbox(events: readonly AuditEventInput[]): Promise<boolean> {
  try {
    await ensureAuditOutboxTable();
    const pool = await getPool();
    for (const raw of events) {
      const event = normalizedAuditEvent(raw);
      const payload = JSON.stringify({
        ...event,
        changes: sanitizeAuditValue(event.changes),
        metadata: sanitizeAuditValue(event.metadata),
        failureReason: clipped(event.failureReason, MAX_FAILURE),
      });
      await pool.request()
        .input("eventKey", sql.VarChar, event.eventKey)
        .input("tenant", sql.VarChar, clipped(event.tenantId, 64))
        .input("payload", sql.NVarChar, payload)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM rmoneapp.dbo.rmone_audit_outbox WHERE EventKey = @eventKey)
            INSERT INTO rmoneapp.dbo.rmone_audit_outbox (EventKey, TenantID, PayloadJson)
            VALUES (@eventKey, @tenant, @payload)
        `);
    }
    scheduleOutboxDrain();
    return true;
  } catch (error) {
    // The outbox shares the database with the audit table, so this failure is
    // usually the SAME incident that broke the direct insert. Keep the events
    // in memory and retry from the drain timer instead of dropping them.
    console.error(`[audit-trail] durable outbox write failed (${events.length} events held in memory): ${String(error).slice(0, 200)}`);
    stashAuditEventsInMemory(events.map(normalizedAuditEvent));
    return false;
  }
}

export async function drainAuditOutbox(): Promise<void> {
  if (outboxDraining) return;
  outboxDraining = true;
  try {
    await ensureAuditOutboxTable();
    const pool = await getPool();
    // First flush any events that could not even reach the durable outbox
    // (memory is the last-resort queue when the whole DB was unreachable).
    // recordAuditEvents re-enqueues its own failures, so one pass is safe.
    if (memoryPendingEvents.length > 0) {
      const retry = memoryPendingEvents.splice(0, memoryPendingEvents.length);
      await recordAuditEvents(retry);
    }
    const due = await pool.request().query(`
      SELECT TOP (100) EventKey, PayloadJson
      FROM rmoneapp.dbo.rmone_audit_outbox
      WHERE NextAttemptAt <= SYSUTCDATETIME()
      ORDER BY OutboxID;
      SELECT MIN(NextAttemptAt) AS nextAttemptAt
      FROM rmoneapp.dbo.rmone_audit_outbox;
    `);
    const events = due.recordset.flatMap((row: any) => {
      try { return [JSON.parse(String(row.PayloadJson)) as AuditEventInput]; } catch { return []; }
    });
    if (events.length === 0) {
      const nextAttemptAt = (due.recordsets as sql.IRecordSet<any>[])[1]?.[0]?.nextAttemptAt;
      const delay = nextAttemptAt
        ? Math.min(60_000, Math.max(250, new Date(nextAttemptAt).getTime() - Date.now()))
        : 60_000;
      scheduleOutboxDrain(delay);
      return;
    }
    const succeeded = await recordAuditEvents(events);
    const eventKeys = events.map((event) => clipped(event.eventKey, 64)).filter(Boolean) as string[];
    if (succeeded) {
      for (const eventKey of eventKeys) {
        await pool.request().input("eventKey", sql.VarChar, eventKey)
          .query("DELETE FROM rmoneapp.dbo.rmone_audit_outbox WHERE EventKey = @eventKey");
      }
    } else {
      for (const eventKey of eventKeys) {
        await pool.request().input("eventKey", sql.VarChar, eventKey).query(`
          UPDATE rmoneapp.dbo.rmone_audit_outbox
          SET Attempts = Attempts + 1,
              NextAttemptAt = DATEADD(SECOND, CASE WHEN Attempts < 6 THEN POWER(2, Attempts) ELSE 60 END, SYSUTCDATETIME())
          WHERE EventKey = @eventKey
        `);
      }
    }
    scheduleOutboxDrain(succeeded ? 250 : 60_000);
  } catch (error) {
    console.error(`[audit-trail] durable outbox drain failed: ${String(error).slice(0, 200)}`);
    scheduleOutboxDrain(60_000);
  } finally {
    outboxDraining = false;
  }
}

export async function recordAuditEvent(event: AuditEventInput): Promise<boolean> {
  event = normalizedAuditEvent(event);
  try {
    await ensureAuditTrailTable();
    const pool = await getPool();
    await pool.request()
      .input("tid", sql.VarChar, clipped(event.tenantId, 64))
      .input("eventKey", sql.VarChar, event.eventKey)
      .input("actorId", sql.NVarChar, clipped(event.actorId, 200))
      .input("actorName", sql.NVarChar, clipped(event.actorName, 255))
      .input("actorEmail", sql.NVarChar, clipped(event.actorEmail, 320))
      .input("actorRole", sql.NVarChar, clipped(event.actorRole, 255))
      .input("actorType", sql.VarChar, clipped(event.actorType ?? "user", 24))
      .input("action", sql.VarChar, clipped(event.action, 160))
      .input("outcome", sql.VarChar, event.outcome)
      .input("entityType", sql.VarChar, clipped(event.entityType, 64))
      .input("entityId", sql.NVarChar, clipped(event.entityId, 200))
      .input("entityName", sql.NVarChar, clipped(event.entityName, 500))
      .input("source", sql.VarChar, clipped(event.source, 80))
      .input("ip", sql.VarChar, clipped(event.ipAddress, 64))
      .input("ua", sql.NVarChar, clipped(event.userAgent, 600))
      .input("requestId", sql.VarChar, clipped(event.requestId, 128))
      .input("changes", sql.NVarChar, safeJson(event.changes))
      .input("failure", sql.NVarChar, clipped(event.failureReason, 1000))
      .input("metadata", sql.NVarChar, safeJson(event.metadata))
      .query(`
        INSERT INTO core2.dbo.RMOneAuditTrail
          (EventKey, TenantID, ActorID, ActorName, ActorEmail, ActorRole, ActorType, Action,
           Outcome, EntityType, EntityID, EntityName, Source, IPAddress, UserAgent,
           RequestID, ChangesJson, FailureReason, MetadataJson)
        SELECT
          @eventKey, @tid, @actorId, @actorName, @actorEmail, @actorRole, @actorType, @action,
           @outcome, @entityType, @entityId, @entityName, @source, @ip, @ua,
            @requestId, @changes, @failure, @metadata
        WHERE NOT EXISTS (SELECT 1 FROM core2.dbo.RMOneAuditTrail WHERE EventKey = @eventKey)
      `);
    healthState(event.tenantId).lastSuccessAt = new Date().toISOString();
    scheduleOutboxDrain();
    return true;
  } catch (error) {
    await enqueueAuditOutbox([event]);
    noteAuditWriteFailure(error, 1, event.tenantId);
    console.warn(`[audit-trail] event write failed: ${String(error).slice(0, 240)}`);
    return false;
  }
}

/** High-volume append used by imports and system jobs. It writes bounded
 * parameterized chunks so audit capture cannot materialize an unbounded SQL
 * statement or open one connection per changed record. Failure remains
 * best-effort and observable through auditTrailHealth(). */
export async function recordAuditEvents(events: AuditEventInput[]): Promise<boolean> {
  if (events.length === 0) return true;
  events = events.map(normalizedAuditEvent);
  let allSucceeded = true;
  try {
    await ensureAuditTrailTable();
    const pool = await getPool();
    const CHUNK = 40;
    for (let offset = 0; offset < events.length; offset += CHUNK) {
      const rows = events.slice(offset, offset + CHUNK);
      const req = pool.request();
      const values: string[] = [];
      rows.forEach((event, index) => {
        req.input(`t${index}`, sql.VarChar, clipped(event.tenantId, 64)!);
        req.input(`ek${index}`, sql.VarChar, event.eventKey);
        req.input(`ai${index}`, sql.NVarChar, clipped(event.actorId, 128));
        req.input(`an${index}`, sql.NVarChar, clipped(event.actorName, 200));
        req.input(`ae${index}`, sql.NVarChar, clipped(event.actorEmail, 320));
        req.input(`ar${index}`, sql.NVarChar, clipped(event.actorRole, 100));
        req.input(`at${index}`, sql.VarChar, clipped(event.actorType ?? "system", 32));
        req.input(`ac${index}`, sql.VarChar, clipped(event.action, 160)!);
        req.input(`ou${index}`, sql.VarChar, event.outcome);
        req.input(`et${index}`, sql.VarChar, clipped(event.entityType, 64));
        req.input(`ei${index}`, sql.NVarChar, clipped(event.entityId, 160));
        req.input(`en${index}`, sql.NVarChar, clipped(event.entityName, 300));
        req.input(`so${index}`, sql.VarChar, clipped(event.source, 80));
        req.input(`ip${index}`, sql.VarChar, clipped(event.ipAddress, 64));
        req.input(`ua${index}`, sql.NVarChar, clipped(event.userAgent, 500));
        req.input(`rq${index}`, sql.VarChar, clipped(event.requestId, 128));
        req.input(`ch${index}`, sql.NVarChar, safeJson(event.changes));
        req.input(`fr${index}`, sql.NVarChar, clipped(event.failureReason, MAX_FAILURE));
        req.input(`me${index}`, sql.NVarChar, safeJson(event.metadata));
        values.push(`(@ek${index},@t${index},@ai${index},@an${index},@ae${index},@ar${index},@at${index},@ac${index},@ou${index},@et${index},@ei${index},@en${index},@so${index},@ip${index},@ua${index},@rq${index},@ch${index},@fr${index},@me${index})`);
      });
      try {
        await req.query(`
          WITH pending(EventKey,TenantID,ActorID,ActorName,ActorEmail,ActorRole,ActorType,Action,Outcome,
              EntityType,EntityID,EntityName,Source,IPAddress,UserAgent,RequestID,
              ChangesJson,FailureReason,MetadataJson) AS (SELECT * FROM (VALUES ${values.join(",")}) v(EventKey,TenantID,ActorID,ActorName,ActorEmail,ActorRole,ActorType,Action,Outcome,EntityType,EntityID,EntityName,Source,IPAddress,UserAgent,RequestID,ChangesJson,FailureReason,MetadataJson))
          INSERT INTO core2.dbo.RMOneAuditTrail
            (EventKey,TenantID,ActorID,ActorName,ActorEmail,ActorRole,ActorType,Action,Outcome,
             EntityType,EntityID,EntityName,Source,IPAddress,UserAgent,RequestID,
             ChangesJson,FailureReason,MetadataJson)
          SELECT p.* FROM pending p
          WHERE NOT EXISTS (SELECT 1 FROM core2.dbo.RMOneAuditTrail a WHERE a.EventKey = p.EventKey)
        `);
        for (const event of rows) healthState(event.tenantId).lastSuccessAt = new Date().toISOString();
        scheduleOutboxDrain();
      } catch (error) {
        allSucceeded = false;
        await enqueueAuditOutbox(rows);
        noteAuditBatchFailure(error, rows);
        console.warn(`[audit-trail] batch write failed (${rows.length} events): ${String(error).slice(0, 240)}`);
      }
    }
  } catch (error) {
    allSucceeded = false;
    await enqueueAuditOutbox(events);
    noteAuditBatchFailure(error, events);
    console.warn(`[audit-trail] batch setup failed (${events.length} events): ${String(error).slice(0, 240)}`);
  }
  return allSucceeded;
}

export function auditTrailHealth(tenantId: string): {
  writeFailures: number;
  lastWriteFailureAt: string | null;
  lastWriteSuccessAt: string | null;
} {
  const state = healthState(tenantId);
  return { writeFailures: state.failures, lastWriteFailureAt: state.lastFailureAt, lastWriteSuccessAt: state.lastSuccessAt };
}

export async function fetchAuditTrailHealth(tenantId: string): Promise<ReturnType<typeof auditTrailHealth> & { durableFailureCount: number }> {
  let durableFailureCount = 0;
  let durableLastFailureAt: string | null = null;
  try {
    const pool = await getPool();
    const exists = await pool.request().query(`
      SELECT CASE WHEN OBJECT_ID(N'rmoneapp.dbo.rmone_audit_health', N'U') IS NULL THEN 0 ELSE 1 END AS ok
    `);
    if (exists.recordset[0]?.ok) {
      const result = await pool.request()
        .input("tenant", sql.VarChar, tenantId)
        .query(`
        SELECT COALESCE(SUM(CONVERT(BIGINT, failure_count)), 0) AS failureCount,
               MAX(occurred_at) AS lastFailureAt
        FROM rmoneapp.dbo.rmone_audit_health
        WHERE tenant_id = @tenant
      `);
      durableFailureCount = Number(result.recordset[0]?.failureCount ?? 0);
      durableLastFailureAt = result.recordset[0]?.lastFailureAt
        ? new Date(result.recordset[0].lastFailureAt).toISOString()
        : null;
    }
  } catch {
    // Health reads remain available from local counters during a DB outage.
  }
  const local = auditTrailHealth(tenantId);
  const pending = healthState(tenantId).pending;
  return {
    ...local,
    writeFailures: durableFailureCount + pending,
    lastWriteFailureAt: [local.lastWriteFailureAt, durableLastFailureAt].filter(Boolean).sort().at(-1) ?? null,
    durableFailureCount,
  };
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = clipped(value, 500);
    if (text) return text;
  }
  return null;
}

export function inferAuditTarget(req: Request): {
  action: string;
  entityType: string | null;
  entityId: string | null;
  entityName: string | null;
  changes: unknown;
} {
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const path = req.path.toLowerCase();
  if (path.endsWith("/audit-interaction")) {
    const interaction = parseAuditInteraction(body);
    // The observer also records rejected interaction requests.  Their audit
    // shape remains value-free even when a caller submits an unsafe body.
    return interaction
      ? {
        action: `interaction.${interaction.interactionType}`,
        entityType: interaction.entityType,
        entityId: interaction.entityId,
        entityName: null,
        changes: undefined,
      }
      : { action: "interaction.invalid", entityType: null, entityId: null, entityName: null, changes: undefined };
  }
  // Sign-out is a session event, not a record edit.
  if (path.endsWith("/logout")) {
    return { action: "logout", entityType: null, entityId: null, entityName: null, changes: undefined };
  }
  const entityId = firstString(
    body["RecordId"], body["recordId"], body["RecordID"], body["recordID"],
    body["ProjectID"], body["ProjectId"], body["projectId"],
    body["TicketId"], body["ticketId"], body["TicketID"], body["ticketID"],
    body["ResourceId"], body["resourceId"], body["ResourceGuid"], body["resourceGuid"],
    body["UserId"], body["userId"],
    req.params?.["id"], req.params?.["guid"], req.params?.["recordId"], req.params?.["ticketId"],
    req.path.match(/\/(?:project|staff|record|resource)\/([^/]+)/i)?.[1],
  );
  const prefix = String(entityId ?? "").toUpperCase().split("-")[0];
  const entityType =
    prefix === "PMM" ? "project" :
    prefix === "OPM" ? "opportunity" :
    prefix === "LEM" || prefix === "LD" ? "lead" :
    prefix === "COM" ? "company" :
    prefix === "CON" ? "contact" :
    path.includes("allocation") || path.includes("work-item") ? "allocation" :
    path.includes("schedule") || path.includes("lifecycle") ? "schedule" :
    path.includes("staff") || path.includes("resource") || path.includes("user") ? "staff" :
    path.includes("company") ? "company" :
    path.includes("contact") ? "contact" :
    // /upload and /run are the standalone import grid's endpoints — classify
    // them with the other import actions instead of generic "Edited record".
    path.includes("import") || path.includes("onboarding") || path.endsWith("/upload") || path.endsWith("/run") ? "import" :
    path.includes("role") || path.includes("department") || path.includes("division") || path.includes("business-unit") ? "configuration" :
    "record";
  const verb =
    req.method === "GET" ? "view" :
    path.includes("delete") || req.method === "DELETE" ? "delete" :
    path.includes("restore") ? "restore" :
    path.includes("assign") ? "assign" :
    path.includes("create") || req.method === "POST" && /\/(companies|staff|new-record|work-item)$/.test(path) ? "create" :
    path.includes("import") || path.includes("onboarding") || path.endsWith("/upload") || path.endsWith("/run") ? "import" :
    "update";
  return {
    action: `${verb}.${entityType}`,
    entityType,
    entityId,
    entityName: firstString(body["Title"], body["title"], body["Name"], body["name"], body["ProjectName"], body["projectName"]),
    // Request values are intent, not proof of committed state. Routes with an
    // authoritative provider/transaction handoff set res.locals.auditChanges;
    // every other mutation remains a truthful value-free action event.
    changes: undefined,
  };
}

export function auditRequestContext(req: Request, actor: RequestSource) {
  const rawClient = firstString(req.headers["x-rmone-client"], req.headers["x-client-platform"])?.toLowerCase();
  const clientPlatform = rawClient === "mobile" ? "mobile" : rawClient === "web" ? "web" : "api";
  const path = req.originalUrl.toLowerCase();
  const source = path.includes("/chat")
    ? "chat/ai"
    : path.includes("/onboarding") || path.includes("/data-cleaning") || path.includes("/import")
      ? "import"
      : clientPlatform;
  return {
    tenantId: actor.tid,
    actorId: actor.userId,
    actorName: null,
    actorEmail: actor.username.includes("@") ? actor.username : null,
    actorRole: actor.role || actor.accessLevel,
    actorType: "user" as const,
    source,
    ipAddress: req.ip || req.socket.remoteAddress || null,
    userAgent: req.get("user-agent") ?? null,
    requestId: randomUUID(),
  };
}

export function auditOutcomeForResponse(statusCode: number, payload: unknown): AuditOutcome {
  if (statusCode === 401 || statusCode === 403) return "denied";
  if (statusCode >= 400) return "failed";
  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>;
    if (body["partial"] === true || body["outcome"] === "partial" || statusCode === 207) return "partial";
    if (body["cancelled"] === true || body["outcome"] === "cancelled") return "cancelled";
    if (body["ok"] === false || body["success"] === false || body["Status"] === false) return "failed";
  }
  return "success";
}

function safeFailureReason(value: unknown, statusCode: number): string {
  if (value && typeof value === "object") {
    const body = value as Record<string, unknown>;
    const code = firstString(body["code"], body["error"]);
    if (code && /^[a-z][a-z0-9_.-]{0,79}$/i.test(code)) return `HTTP ${statusCode}: ${code}`;
  }
  return `Request completed with HTTP ${statusCode}`;
}

export function auditTrailObserver(req: Request, res: Response, next: NextFunction): void {
  const actor = resolveRequestSource(req);
  if (!actor) return next();
  const path = req.path.toLowerCase();
  const isWrite = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  // The audit trail is action/change history, not browsing history. Record
  // explicit semantic interactions, but never infer "Viewed project" merely
  // because a record-detail GET completed.
  if (!isWrite || path.endsWith("/audit-trail") || path.endsWith("/token")) return next();
  // Read-shaped POSTs (data fetches, telemetry beacons) are not user actions —
  // recording them as edits creates false "Edited project" rows on page loads.
  if (isWrite && isReadShapedPost(path)) return next();
  const startedAt = Date.now();
  let responsePayload: unknown;
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    responsePayload = body;
    return originalJson(body);
  }) as Response["json"];
  res.once("finish", () => {
    const inferred = inferAuditTarget(req);
    // Routes that know their real business target hand it over through
    // setAuditTarget (res.locals.auditTarget). Explicit fields win over
    // request-shape inference so the event lands on the AFFECTED record even
    // when the request body carries no recognizable ID (generated ticket IDs,
    // AI-tool writes, child-row edits, template/config saves).
    const explicit = res.locals["auditTarget"] as AuditTargetOverride | undefined;
    const entityType = explicit?.entityType !== undefined ? explicit.entityType : inferred.entityType;
    const action = explicit?.action
      ?? (explicit?.entityType && explicit.entityType !== inferred.entityType
        ? `${inferred.action.split(".")[0]}.${explicit.entityType}`
        : inferred.action);
    const target = {
      action,
      entityType,
      entityId: explicit?.entityId !== undefined ? explicit.entityId : inferred.entityId,
      entityName: explicit?.entityName !== undefined ? explicit.entityName : inferred.entityName,
      changes: inferred.changes,
    };
    const localOutcome = res.locals["auditOutcome"];
    const outcome: AuditOutcome =
      localOutcome === "success" || localOutcome === "failed" || localOutcome === "denied" ||
      localOutcome === "partial" || localOutcome === "cancelled"
        ? localOutcome
        : auditOutcomeForResponse(res.statusCode, responsePayload);
    void recordAuditEvent({
      ...auditRequestContext(req, actor),
      ...target,
      outcome,
      // Only trusted provider/transaction snapshots may disclose values.
      // Uninstrumented writes are intentionally value-free rather than
      // presenting submitted request fields as committed database truth.
      changes: isWrite ? res.locals["auditChanges"] : undefined,
      failureReason: outcome === "success" ? null : safeFailureReason(responsePayload, res.statusCode),
      metadata: {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        clientPlatform: firstString(req.headers["x-rmone-client"], req.headers["x-client-platform"]) ?? "unknown",
      },
    });
  });
  next();
}

export async function fetchAuditTrail(
  tenantId: string,
  opts: {
    entityType?: string;
    /** Alternative to entityType: match ANY of these types (entity "family"
     * retrieval — a project's trail includes its schedule/allocation events). */
    entityTypes?: string[];
    entityId?: string;
    actorId?: string;
    actorEmail?: string;
    /** Subject retrieval: events performed BY this person OR affecting this
     * person's staff/resource record. Powers the staff Audit Trail popup so a
     * manager's edit to an employee shows in the employee's history. */
    subjectId?: string;
    subjectEmail?: string;
    outcome?: AuditOutcome;
    action?: string;
    source?: string;
    search?: string;
    startAt?: string;
    endAt?: string;
    beforeId?: number;
    limit?: number;
    eventKind?: AuditTrailEventKind;
    includeFinancial?: boolean;
    includeNetwork?: boolean;
  } = {},
): Promise<{ rows: AuditTrailRow[]; nextCursor: string | null; truncated: boolean; health: ReturnType<typeof auditTrailHealth>; retentionPolicy: typeof AUDIT_RETENTION_POLICY }> {
  await ensureAuditTrailTable();
  const pool = await getPool();
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
  const req = pool.request().input("tid", sql.VarChar, tenantId);
  const where = ["[TenantID] = @tid"];
  if (opts.entityType) { req.input("entityType", sql.VarChar, opts.entityType); where.push("[EntityType] = @entityType"); }
  else if (opts.entityTypes && opts.entityTypes.length > 0) {
    const typeParams = opts.entityTypes.slice(0, 8).map((name, index) => {
      req.input(`entityType${index}`, sql.VarChar, name);
      return `@entityType${index}`;
    });
    where.push(`[EntityType] IN (${typeParams.join(", ")})`);
  }
  if (opts.entityId) { req.input("entityId", sql.NVarChar, opts.entityId); where.push("[EntityID] = @entityId"); }
  if (opts.actorId) { req.input("actorId", sql.NVarChar, opts.actorId); where.push("[ActorID] = @actorId"); }
  if (opts.actorEmail) { req.input("actorEmail", sql.NVarChar, opts.actorEmail); where.push("[ActorEmail] = @actorEmail"); }
  if (opts.subjectId || opts.subjectEmail) {
    const subjectClauses: string[] = [];
    if (opts.subjectId) {
      req.input("subjectId", sql.NVarChar, opts.subjectId);
      subjectClauses.push("a.[ActorID] = @subjectId");
      subjectClauses.push("(a.[EntityType] IN ('staff', 'resource') AND a.[EntityID] = @subjectId)");
    }
    if (opts.subjectEmail) {
      req.input("subjectEmail", sql.NVarChar, opts.subjectEmail);
      subjectClauses.push("a.[ActorEmail] = @subjectEmail");
    }
    where.push(`(${subjectClauses.join(" OR ")})`);
  }
  if (opts.outcome) { req.input("outcome", sql.VarChar, opts.outcome); where.push("[Outcome] = @outcome"); }
  if (opts.action) { req.input("action", sql.VarChar, opts.action); where.push("[Action] = @action"); }
  if (opts.source) { req.input("source", sql.VarChar, opts.source); where.push("[Source] = @source"); }
  if (opts.eventKind === "interaction") {
    where.push("[Action] LIKE 'interaction.%'");
  } else if (opts.eventKind === "change") {
    where.push("[Action] NOT LIKE 'interaction.%'");
  }
  // Record-detail GETs used to create noisy "Viewed project" rows. They are
  // hidden historically as well as disabled in the observer above.
  where.push("[Action] NOT LIKE 'view.%'");
  // Legacy noise: read-shaped POSTs (page-load data fetches, telemetry
  // beacons) were recorded as edits before READ_SHAPED_POST_PATHS existed.
  // Those rows were never user actions — exclude them from every trail read.
  where.push(`NOT ([Action] LIKE 'update.%' AND ISNULL(JSON_VALUE(a.[MetadataJson], '$.path'), '') IN ('/project-allocations', '/rmone/project-allocations', '/usage-beacon', '/rmone/usage-beacon', '/bench-resources', '/rmone/bench-resources', '/resource-skills-availability', '/rmone/resource-skills-availability', '/debug-log', '/rmone/debug-log'))`);
  if (opts.search) {
    req.input("search", sql.NVarChar, `%${opts.search.replace(/[%_[\]]/g, " ").slice(0, 120)}%`);
    where.push("([ActorName] LIKE @search OR [ActorEmail] LIKE @search OR [EntityID] LIKE @search OR [EntityName] LIKE @search OR [Action] LIKE @search)");
  }
  if (opts.startAt) { req.input("startAt", sql.DateTime2, new Date(opts.startAt)); where.push("[CreatedAt] >= @startAt"); }
  if (opts.endAt) { req.input("endAt", sql.DateTime2, new Date(opts.endAt)); where.push("[CreatedAt] < @endAt"); }
  if (opts.beforeId && Number.isSafeInteger(opts.beforeId)) { req.input("beforeId", sql.BigInt, opts.beforeId); where.push("[ID] < @beforeId"); }
  const result = await req.query(`
    SELECT TOP (${limit + 1})
      a.[ID] AS id, a.[ActorID] AS actorId, COALESCE(u.[name], a.[ActorName]) AS actorName,
      COALESCE(u.[email], a.[ActorEmail]) AS actorEmail, a.[ActorRole] AS actorRole, a.[ActorType] AS actorType,
      a.[Action] AS action, a.[Outcome] AS outcome, a.[EntityType] AS entityType,
      a.[EntityID] AS entityId, a.[EntityName] AS entityName, a.[Source] AS source,
      a.[IPAddress] AS ipAddress, a.[UserAgent] AS userAgent, a.[RequestID] AS requestId,
      a.[ChangesJson] AS changesJson, a.[FailureReason] AS failureReason,
      a.[MetadataJson] AS metadataJson, a.[CreatedAt] AS createdAt,
      u.[accountMatched], u.[accountDeleted], u.[accountEnabled], u.[accountPasswordSet]
    FROM core2.dbo.RMOneAuditTrail a
    OUTER APPLY (
      -- Same-tenant roster row first; cross-tenant fallback covers platform
      -- admins who act in a tenant without holding a seat in its roster.
      SELECT TOP (1) ru.[name], ru.[email],
        1 AS accountMatched,
        ru.[deleted] AS accountDeleted,
        ru.[enabled] AS accountEnabled,
        CASE WHEN ru.[password_hash] IS NOT NULL AND LEN(ru.[password_hash]) > 0 THEN 1 ELSE 0 END AS accountPasswordSet
      FROM rmoneapp.dbo.rmone_users ru
      WHERE ru.[id] = a.[ActorID]
        AND (ru.[tenant_id] = a.[TenantID] OR ru.[deleted] = 0)
      ORDER BY CASE WHEN ru.[tenant_id] = a.[TenantID] THEN 0 ELSE 1 END
    ) u
    WHERE ${where.join(" AND ")}
    ORDER BY a.[ID] DESC
  `);
  const raw = result.recordset.slice(0, limit);
  const parse = (value: unknown): unknown => {
    if (!value) return null;
    try { return JSON.parse(String(value)); } catch { return null; }
  };
  // Upgrade historical project-BU rows that were stored before the write path
  // began resolving DivisionLookup IDs. These columns back the user-facing
  // Primary/Supporting Business Units card, so raw numeric IDs must never leak
  // into the audit display.
  const legacyDivisionIds = new Set<string>();
  for (const row of raw) {
    const parsed = parse(row.changesJson);
    if (!Array.isArray(parsed)) continue;
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      const field = String(item.FieldName ?? item.fieldName ?? "").trim().toLowerCase();
      if (field !== "divisionlookup" && field !== "divisionmultilookup") continue;
      for (const value of [item.OldValue, item.oldValue, item.NewValue, item.newValue, item.Value, item.value]) {
        String(value ?? "").split(/[,;]/).map((id) => id.trim()).filter(Boolean).forEach((id) => legacyDivisionIds.add(id));
      }
    }
  }
  const legacyDivisionNames = new Map<string, string>();
  if (legacyDivisionIds.size > 0) {
    try {
      const found = await pool.request()
        .input("lookupTid", sql.NVarChar, tenantId)
        .input("lookupIds", sql.NVarChar(sql.MAX), [...legacyDivisionIds].join(","))
        .query(`SELECT CAST(ID AS NVARCHAR(50)) AS id,
                       COALESCE(NULLIF(LTRIM(RTRIM(Title)), ''), NULLIF(LTRIM(RTRIM(ShortName)), '')) AS label,
                       0 AS priority
                FROM core2.dbo.CompanyDivisions
                WHERE TenantID = @lookupTid
                  AND CAST(ID AS NVARCHAR(50)) IN (
                    SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@lookupIds, ',')
                  )
                UNION ALL
                SELECT CAST(ID AS NVARCHAR(50)) AS id, NULLIF(LTRIM(RTRIM(Title)), '') AS label, 1 AS priority
                FROM core2.dbo.BusinessUnit
                WHERE TenantID = @lookupTid
                  AND CAST(ID AS NVARCHAR(50)) IN (
                    SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@lookupIds, ',')
                  )
                ORDER BY priority`);
      for (const row of found.recordset as Array<{ id?: unknown; label?: unknown }>) {
        const id = String(row.id ?? "").trim();
        const label = String(row.label ?? "").trim();
        // A legitimate division ID wins. BusinessUnit is a compatibility
        // fallback for rows written by the old project-card bug.
        if (id && label && !legacyDivisionNames.has(id)) legacyDivisionNames.set(id, label);
      }
    } catch (error) {
      console.warn(`[audit-trail] legacy business-unit label lookup failed: ${String(error).slice(0, 160)}`);
    }
  }
  const upgradeLegacyChanges = (parsed: unknown): unknown => {
    if (!Array.isArray(parsed)) return parsed;
    const displayValue = (value: unknown): unknown => {
      if (value == null || String(value).trim() === "") return value;
      return String(value).split(/[,;]/).map((rawId) => {
        const id = rawId.trim();
        return legacyDivisionNames.get(id) ?? "Unknown business unit";
      }).join(", ");
    };
    return parsed.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const item = { ...(entry as Record<string, unknown>) };
      const fieldKey = String(item.FieldName ?? item.fieldName ?? "").trim().toLowerCase();
      if (fieldKey !== "divisionlookup" && fieldKey !== "divisionmultilookup") return item;
      item.FieldName = fieldKey === "divisionmultilookup" ? "Supporting Business Units" : "Primary Business Unit";
      for (const key of ["OldValue", "oldValue", "NewValue", "newValue", "Value", "value"]) {
        if (key in item) item[key] = displayValue(item[key]);
      }
      return item;
    }).filter((entry) => {
      if (!entry || typeof entry !== "object") return true;
      const item = entry as Record<string, unknown>;
      const hasPair = "OldValue" in item && "NewValue" in item;
      return !hasPair || String(item.OldValue ?? "") !== String(item.NewValue ?? "");
    });
  };
  const privacyFiltered = (value: unknown): unknown => {
    const parsed = upgradeLegacyChanges(parse(value));
    if (Array.isArray(parsed)) {
      return parsed.slice(0, 100).map((entry) => {
        if (!entry || typeof entry !== "object") return "Changed";
        const item = entry as Record<string, unknown>;
        const fieldName = clipped(item.FieldName ?? item.fieldName ?? item.name ?? item.field, 160) ?? "Changed field";
        // isFinancialFieldName adds alias-awareness (e.g. "value" resolves to
        // the ContractValue column) — covers legacy rows stored under aliases.
        if (SECRET_KEY.test(fieldName) || PRIVATE_VALUE_KEY.test(fieldName) || (!opts.includeFinancial && (FINANCIAL_KEY.test(fieldName) || isFinancialFieldName(fieldName)))) {
          return { FieldName: fieldName, Value: "[redacted]" };
        }
        return sanitizeAuditValue(item);
      });
    }
    if (parsed && typeof parsed === "object") {
      return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).slice(0, 100).map(([key, value]) => [
        key,
        SECRET_KEY.test(key) || PRIVATE_VALUE_KEY.test(key) || (!opts.includeFinancial && (FINANCIAL_KEY.test(key) || isFinancialFieldName(key))) ? "[redacted]" : sanitizeAuditValue(value),
      ]));
    }
    return sanitizeAuditValue(parsed);
  };
  const accountStatusFor = (row: any): AuditAccountStatus => {
    if (String(row.actorType ?? "user") !== "user") return "system";
    if (!row.actorId) return "unknown";
    if (!row.accountMatched || row.accountDeleted) return "removed";
    if (!row.accountEnabled) return "deactivated";
    return row.accountPasswordSet ? "secured" : "invite_pending";
  };
  const rows: AuditTrailRow[] = raw.map((row: any) => ({
    id: String(row.id),
    actorId: row.actorId ?? null,
    actorName: row.actorName ?? null,
    actorEmail: row.actorEmail ?? null,
    actorRole: row.actorRole ?? null,
    actorType: String(row.actorType ?? "user"),
    accountStatus: accountStatusFor(row),
    action: String(row.action),
    outcome: String(row.outcome) as AuditOutcome,
    entityType: row.entityType ?? null,
    entityId: row.entityId ?? null,
    entityName: row.entityName ?? null,
    source: row.source ?? null,
    ipAddress: opts.includeNetwork ? row.ipAddress ?? null : null,
    userAgent: opts.includeNetwork ? row.userAgent ?? null : null,
    requestId: opts.includeNetwork ? row.requestId ?? null : null,
    changes: privacyFiltered(row.changesJson),
    failureReason: row.failureReason ?? null,
    metadata: parse(row.metadataJson),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  }));
  const truncated = result.recordset.length > limit;
  return {
    rows,
    truncated,
    nextCursor: truncated && rows.length ? rows[rows.length - 1].id : null,
    health: auditTrailHealth(tenantId),
    retentionPolicy: AUDIT_RETENTION_POLICY,
  };
}

/** Compare authoritative snapshots, not request bodies.  The final sentinel
 * makes bounded bulk detail honest: the total is complete even though only a
 * safe number of individual changes are stored inline. */
export function trustedAuditDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  opts: { fields?: string[]; prefix?: string; limit?: number; total?: number } = {},
): TrustedAuditChange[] {
  const left = before ?? {};
  const right = after ?? {};
  const keys = opts.fields ?? [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const all = keys.flatMap((key) => {
    const oldValue = left[key] ?? null;
    const newValue = right[key] ?? null;
    const oldJson = JSON.stringify(sanitizeAuditValue(oldValue));
    const newJson = JSON.stringify(sanitizeAuditValue(newValue));
    return oldJson === newJson ? [] : [{
      FieldName: `${opts.prefix ? `${opts.prefix} ` : ""}${key}`,
      OldValue: oldValue,
      NewValue: newValue,
    }];
  });
  const total = Math.max(all.length, opts.total ?? all.length);
  const limit = Math.max(1, Math.min(100, opts.limit ?? 80));
  if (all.length <= limit && total === all.length) return all;
  const shown = all.slice(0, limit);
  shown.push({
    FieldName: "Audit detail coverage",
    OldValue: `${shown.length} detail${shown.length === 1 ? "" : "s"} shown`,
    NewValue: `${total} total change${total === 1 ? "" : "s"}; ${Math.max(0, total - shown.length)} not shown`,
  });
  return shown;
}

export function boundedAuditChanges(
  changes: readonly TrustedAuditChange[],
  total = changes.length,
  limit = 80,
): TrustedAuditChange[] {
  const safeLimit = Math.max(1, Math.min(100, limit));
  if (changes.length <= safeLimit && total === changes.length) return [...changes];
  const shown = changes.slice(0, safeLimit);
  return [
    ...shown,
    {
      FieldName: "Audit detail coverage",
      OldValue: `${shown.length} detail${shown.length === 1 ? "" : "s"} shown`,
      NewValue: `${total} total change${total === 1 ? "" : "s"}; ${Math.max(0, total - shown.length)} not shown`,
    },
  ];
}

/** Move provider-only audit material to the observer and keep it out of API
 * responses.  Returning these snapshots to clients would unnecessarily expose
 * other rows touched by a bulk operation. */
export function handoffTrustedAuditChanges(
  res: Response,
  result: { auditChanges?: TrustedAuditChange[] } | null | undefined,
): void {
  if (!result?.auditChanges) return;
  res.locals["auditChanges"] = result.auditChanges;
  delete result.auditChanges;
}

export function setTrustedAuditChanges(res: Response, changes: readonly TrustedAuditChange[]): void {
  res.locals["auditChanges"] = [...changes];
}

/** Explicit business target for the audit observer. Routes call this when the
 * request shape alone cannot identify the affected record — e.g. the ticket ID
 * is generated during the request, the write is keyed by an internal row ID,
 * or an AI tool performed the write behind a generic endpoint. Partial
 * overrides merge over request-shape inference; unspecified fields keep the
 * inferred value. */
export interface AuditTargetOverride {
  action?: string;
  entityType?: string | null;
  entityId?: string | null;
  entityName?: string | null;
}

export function setAuditTarget(res: Response, target: AuditTargetOverride): void {
  const existing = (res.locals["auditTarget"] as AuditTargetOverride | undefined) ?? {};
  res.locals["auditTarget"] = { ...existing, ...target };
}
