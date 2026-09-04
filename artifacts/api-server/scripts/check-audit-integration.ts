import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import rateLimit from "express-rate-limit";
import { auditTrailObserver, ensureAuditOutboxTable, fetchAuditTrail, recordAuditEvents, startAuditOutboxWorker } from "../src/lib/auditTrail.js";
import { getPool, sql } from "../src/lib/db.js";
import { resolveTenantId } from "../src/lib/pipeline.js";
import { signRdsToken } from "../src/lib/rds-auth.js";
import rmoneProxyRouter from "../src/routes/rmone-proxy.js";

const tenantA = `audit-check-${randomUUID()}`;
const tenantB = `audit-check-${randomUUID()}`;
let auditServer: Server | null = null;

async function waitForAuditRow(
  tenantId: string,
  predicate: (row: Awaited<ReturnType<typeof fetchAuditTrail>>["rows"][number]) => boolean,
  message: string,
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await fetchAuditTrail(tenantId, { limit: 200, includeFinancial: false, includeNetwork: false });
    const row = result.rows.find(predicate);
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

try {
  const common = {
    actorId: "audit-check-user",
    actorName: "Audit Check User",
    actorEmail: "audit-check@example.invalid",
    actorType: "user" as const,
    outcome: "success" as const,
    entityType: "project",
    source: "system",
  };
  const wrote = await recordAuditEvents([
    { ...common, tenantId: tenantA, action: "view.project", entityId: "AUD-1" },
    {
      ...common,
      tenantId: tenantA,
      action: "financial-field.changed",
      entityId: "AUD-1",
      changes: [
        { FieldName: "ContractValue", OldValue: "10", NewValue: "20" },
        { FieldName: "BankAccountNumber", OldValue: "111", NewValue: "222" },
      ],
    },
    { ...common, tenantId: tenantA, action: "update.project", entityId: "AUD-2" },
    { ...common, tenantId: tenantA, action: "update.project", entityId: "AUD-3" },
    { ...common, tenantId: tenantB, action: "update.project", entityId: "OTHER-TENANT" },
  ]);
  assert.equal(wrote, true, "batch audit write failed");

  const first = await fetchAuditTrail(tenantA, { limit: 2, includeFinancial: false, includeNetwork: false });
  assert.equal(first.rows.length, 2);
  assert.equal(first.truncated, true);
  assert.ok(first.nextCursor);
  assert.equal(first.rows.some((row) => row.action === "view.project"), false, "legacy inferred record views must stay hidden");
  assert.equal(first.rows.some((row) => row.entityId === "OTHER-TENANT"), false, "cross-tenant row leaked");

  const second = await fetchAuditTrail(tenantA, {
    limit: 2,
    beforeId: Number(first.nextCursor),
    includeFinancial: false,
    includeNetwork: false,
  });
  assert.equal(second.rows.length, 1);
  assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.id)).size, 3, "cursor pages overlapped");

  const financial = await fetchAuditTrail(tenantA, {
    action: "financial-field.changed",
    includeFinancial: false,
    includeNetwork: false,
  });
  const changes = financial.rows[0]?.changes as Array<Record<string, unknown>>;
  assert.equal(changes[0]?.Value, "[redacted]", "financial value leaked without permission");
  assert.equal(changes[1]?.Value, "[redacted]", "private account value leaked");

  // Authenticated end-to-end interaction coverage. Mount the real RM ONE
  // router so this exercises POST /audit-interaction plus the global observer.
  // The root account is used only for the read side because its tenant-scoped
  // superadmin path does not require a roster fixture; tenant B still uses a
  // distinct signed token and is written through the same route.
  const routeTenantA = "rmone";
  const routeTenantAId = resolveTenantId(routeTenantA);
  const routeTenantB = `audit-e2e-${randomUUID()}`;
  const routeTenantBId = resolveTenantId(routeTenantB);
  const actorA = randomUUID();
  const actorB = randomUUID();
  const entityA = `audit-e2e-a-${randomUUID()}`;
  const entityB = `audit-e2e-b-${randomUUID()}`;
  const changeEntity = `audit-e2e-change-${randomUUID()}`;
  const invalidMarker = `secret-payload-${randomUUID()}`;
  const tokenA = signRdsToken({
    sub: actorA,
    tenant: routeTenantA,
    username: "sanjeev@rmone.com",
    role: "admin",
    accessLevel: "admin",
  });
  const tokenB = signRdsToken({
    sub: actorB,
    tenant: routeTenantB,
    username: `audit-e2e-${randomUUID()}@example.invalid`,
    role: "admin",
    accessLevel: "admin",
  });
  const routeApp = express();
  routeApp.set("trust proxy", 1);
  routeApp.use("/api", auditTrailObserver);
  routeApp.use(express.json());
  routeApp.use("/api/rmone", rmoneProxyRouter);
  auditServer = routeApp.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => auditServer?.once("listening", resolve));
  const routePort = (auditServer.address() as AddressInfo).port;
  const postInteraction = async (token: string, body: unknown) => fetch(
    `http://127.0.0.1:${routePort}/api/rmone/audit-interaction`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-RMOne-Client": "web",
        "User-Agent": "audit-integration-check",
      },
      body: JSON.stringify(body),
    },
  );
  const readAudit = async (token: string, query: string) => fetch(
    `http://127.0.0.1:${routePort}/api/rmone/audit-trail?${query}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  const acceptedA = await postInteraction(tokenA, {
    interactionType: "open",
    entityType: "project",
    entityId: entityA,
  });
  assert.equal(acceptedA.status, 204, "authenticated interaction request was not accepted");
  const acceptedB = await postInteraction(tokenB, {
    interactionType: "open",
    entityType: "project",
    entityId: entityB,
  });
  assert.equal(acceptedB.status, 204, "second tenant interaction request was not accepted");
  const rejected = await postInteraction(tokenA, {
    interactionType: "search",
    entityType: "project",
    entityId: entityA,
    query: invalidMarker,
  });
  assert.equal(rejected.status, 400, "arbitrary interaction payload was accepted");

  const interactionA = await waitForAuditRow(
    routeTenantAId,
    (row) => row.action === "interaction.open" && row.entityId === entityA,
    "accepted interaction was not written to the audit ledger",
  );
  assert.equal(interactionA.actorId, actorA, "interaction actor was not attributed from the verified token");
  assert.equal(interactionA.actorEmail, "sanjeev@rmone.com", "interaction actor email was not attributed from the token");
  const tenantARows = (await fetchAuditTrail(routeTenantAId, {
    entityId: entityA,
    action: "interaction.open",
    includeFinancial: false,
    includeNetwork: false,
  })).rows;
  assert.equal(tenantARows.length, 1, "one interaction request must produce exactly one ledger row");

  const invalidRow = await waitForAuditRow(
    routeTenantAId,
    (row) => row.action === "interaction.invalid" && row.actorId === actorA,
    "invalid interaction was not recorded",
  );
  assert.equal(invalidRow.entityType, null, "invalid interaction stored an arbitrary entity type");
  assert.equal(invalidRow.entityId, null, "invalid interaction stored an arbitrary entity ID");
  assert.equal(invalidRow.changes, null, "invalid interaction stored arbitrary payload data");
  assert.equal(JSON.stringify(invalidRow.metadata).includes(invalidMarker), false, "invalid payload value leaked into audit metadata");

  const tenantBRows = (await fetchAuditTrail(routeTenantBId, {
    entityId: entityB,
    action: "interaction.open",
    includeFinancial: false,
    includeNetwork: false,
  })).rows;
  assert.equal(tenantBRows.length, 1, "second tenant interaction was not written");
  assert.equal(tenantBRows[0]?.actorId, actorB, "second tenant interaction was attributed to the wrong actor");
  assert.equal(
    (await fetchAuditTrail(routeTenantAId, { entityId: entityB, includeFinancial: false, includeNetwork: false })).rows.length,
    0,
    "tenant A can see tenant B's interaction",
  );
  assert.equal(
    (await fetchAuditTrail(routeTenantBId, { entityId: entityA, includeFinancial: false, includeNetwork: false })).rows.length,
    0,
    "tenant B can see tenant A's interaction",
  );

  await recordAuditEvents([{
    tenantId: routeTenantAId,
    actorId: actorA,
    actorEmail: "sanjeev@rmone.com",
    actorType: "user",
    action: "update.project",
    outcome: "success",
    entityType: "project",
    entityId: changeEntity,
    source: "web",
    ipAddress: "203.0.113.40",
    userAgent: "private-user-agent",
    requestId: "private-request-id",
    changes: [
      { FieldName: "Status", OldValue: "Open", NewValue: "Closed" },
      { FieldName: "ContractValue", OldValue: "10", NewValue: "20" },
      { FieldName: "BankAccountNumber", OldValue: "111", NewValue: "222" },
    ],
  }]);
  const interactionFilterResponse = await readAudit(
    tokenA,
    `eventKind=interaction&search=${encodeURIComponent(entityA)}`,
  );
  assert.equal(interactionFilterResponse.status, 200, "interaction audit filter was not available");
  const interactionFilter = await interactionFilterResponse.json() as { rows: Array<{ action: string }> };
  assert.equal(interactionFilter.rows.length, 1, "interaction filter returned the wrong number of rows");
  assert.equal(interactionFilter.rows.every((row) => row.action.startsWith("interaction.")), true, "interaction filter returned a change event");

  const changeFilterResponse = await readAudit(
    tokenA,
    `eventKind=change&search=${encodeURIComponent(changeEntity)}`,
  );
  assert.equal(changeFilterResponse.status, 200, "data changes audit filter was not available");
  const changeFilter = await changeFilterResponse.json() as { rows: Array<{ action: string }> };
  assert.equal(changeFilter.rows.length, 1, "data changes filter returned the wrong number of rows");
  assert.equal(changeFilter.rows.every((row) => !row.action.startsWith("interaction.") && !row.action.startsWith("view.")), true, "data changes filter returned an interaction event");

  const privateDetails = (await fetchAuditTrail(routeTenantAId, {
    entityId: changeEntity,
    includeFinancial: false,
    includeNetwork: false,
  })).rows[0];
  assert.ok(privateDetails, "change fixture was not written");
  assert.equal(privateDetails.ipAddress, null, "network details leaked without permission");
  assert.equal(privateDetails.userAgent, null, "user-agent leaked without permission");
  assert.equal(privateDetails.requestId, null, "request ID leaked without permission");
  const privateChanges = privateDetails.changes as Array<Record<string, unknown>>;
  assert.equal(privateChanges.find((item) => item.FieldName === "Status")?.NewValue, "Closed");
  assert.equal(privateChanges.find((item) => item.FieldName === "ContractValue")?.Value, "[redacted]", "financial value leaked without permission");
  assert.equal(privateChanges.find((item) => item.FieldName === "BankAccountNumber")?.Value, "[redacted]", "private value leaked without permission");

  const pool = await getPool();
  let appendOnlyBlocked = false;
  try {
    await pool.request().input("tenant", sql.VarChar, tenantA)
      .query("DELETE FROM core2.dbo.RMOneAuditTrail WHERE TenantID = @tenant");
  } catch (error) {
    appendOnlyBlocked = /append-only|51001/i.test(String(error));
  }
  assert.equal(appendOnlyBlocked, true, "database did not enforce append-only audit storage");

  const replayKey = randomUUID();
  const replayEvent = {
    ...common,
    eventKey: replayKey,
    tenantId: tenantA,
    action: "outbox.replayed",
    entityId: "AUD-OUTBOX",
  };
  await ensureAuditOutboxTable();
  await pool.request()
    .input("eventKey", sql.VarChar, replayKey)
    .input("tenant", sql.VarChar, tenantA)
    .input("payload", sql.NVarChar, JSON.stringify(replayEvent))
    .query(`
      INSERT INTO rmoneapp.dbo.rmone_audit_outbox (EventKey, TenantID, PayloadJson, NextAttemptAt)
      VALUES (@eventKey, @tenant, @payload, DATEADD(MILLISECOND, 1500, SYSUTCDATETIME()))
    `);
  startAuditOutboxWorker();
  let replayed = await fetchAuditTrail(tenantA, { action: "outbox.replayed" });
  for (let attempt = 0; attempt < 40 && !replayed.rows.some((row) => row.entityId === "AUD-OUTBOX"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    replayed = await fetchAuditTrail(tenantA, { action: "outbox.replayed" });
  }
  assert.equal(replayed.rows.some((row) => row.entityId === "AUD-OUTBOX"), true, "durable outbox did not replay an event");

  const rateTenantLabel = `audit-rate-${randomUUID()}`;
  const rateTenantId = resolveTenantId(rateTenantLabel);
  const token = signRdsToken({
    sub: randomUUID(),
    tenant: rateTenantLabel,
    username: "audit-rate@example.invalid",
    role: "admin",
    accessLevel: "admin",
  });
  const rateApp = express();
  rateApp.set("trust proxy", 1);
  rateApp.use("/api", auditTrailObserver);
  rateApp.use("/api", rateLimit({ windowMs: 60_000, max: 1, standardHeaders: false, legacyHeaders: false }));
  rateApp.use(express.json());
  rateApp.post("/api/write", (_req, res) => res.json({ ok: true }));
  const server = rateApp.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/write`, { method: "POST", headers, body: "{}" })).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/write`, { method: "POST", headers, body: "{}" })).status, 429);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const rateAudit = await fetchAuditTrail(rateTenantId, { outcome: "failed", limit: 20 });
  assert.equal(
    rateAudit.rows.some((row) => (row.metadata as Record<string, unknown> | null)?.statusCode === 429),
    true,
    "rate-limited authenticated mutation was not audited",
  );
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  console.log("audit integration check passed: batching, tenant isolation, stable cursor, and redaction");
} finally {
  if (auditServer) {
    await new Promise<void>((resolve) => auditServer?.close(() => resolve()));
    auditServer = null;
  }
  // Synthetic tenant IDs are intentionally retained. The production ledger is
  // database-enforced append-only, so tests must not add a deletion backdoor.
  try { await (await getPool()).close(); } catch { /* no pool opened */ }
}

// Native fetch keeps an idle undici socket alive in some Node releases.
// Reaching this line means every assertion and cleanup step succeeded.
process.exit(0);