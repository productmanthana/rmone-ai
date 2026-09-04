/**
 * check:synonyms — leads-directory honesty regression tests.
 *
 * getLeadsDirectoryRds (Resources → Manager view) scans PMM + Opportunity for
 * key-personnel (*User) and CustomLeadsJson lead roles. Its honesty contract:
 *   - a metadata (tableColumns) failure is a FAILED scan → `partial: true`,
 *     never silently treated as "this table has no lead columns";
 *   - ALL attempted scans failing must THROW (the route's catch turns that
 *     into a 502 — pinned live by scripts/lead-team-context-probe.local.ts),
 *     never an authoritative-looking 200 `{ leads: [] }`;
 *   - custom lead roles (CustomLeadsJson, display NAMES) promote into the
 *     directory only on a UNIQUE active-user name match, as `custom:<Label>`.
 *
 * Scenario order matters: tableColumns serves stale-while-revalidate after a
 * first success, so metadata-failure scenarios run BEFORE any successful
 * probe of the same table caches its columns (PMM fails in 1 and 2; only
 * scenario 3 lets it succeed). Failed probes are never cached.
 */
import assert from "node:assert/strict";
import {
  addResponder, armGate, setTableColumns, startWatchdog,
  type FakeQuery,
} from "./helpers/fakeRdsDb.js";

startWatchdog("leadsDirectoryHonesty");

// Loaded AFTER the fake driver is in place — a static import would hoist.
const rds = await import("../rds-provider.js");

// ── Fixtures ─────────────────────────────────────────────────────────────────
const T1 = "tenant-ldir-partial";
const T2 = "tenant-ldir-allfail";
const T3 = "tenant-ldir-healthy";

const LEAD_GUID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const UMA_GUID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const DANA1_GUID = "cccccccc-3333-4333-8333-cccccccccccc";
const DANA2_GUID = "dddddddd-4444-4444-8444-dddddddddddd";

const user = (tid: string, id: string, name: string) => ({
  id, tenant_id: tid, username: id, name, email: `${id}@example.test`,
  enabled: true, deleted: false,
});
const roster = (tid: string) => [
  user(tid, LEAD_GUID, "Larry Lead"),
  user(tid, UMA_GUID, "Uma Unique"),
  user(tid, DANA1_GUID, "Dana Dup"),
  user(tid, DANA2_GUID, "Dana Dup"), // ambiguous name — never promotable
];
const isUsersQuery = (q: FakeQuery) =>
  q.text.includes("FROM dbo.rmone_users") && !q.text.includes("rmoneapp");
addResponder((q) => (isUsersQuery(q) && String(q.params.tid).startsWith("tenant-ldir-")
  ? { recordset: roster(String(q.params.tid)) }
  : undefined));

const isMetaProbe = (q: FakeQuery, table: string) =>
  q.text.includes("INFORMATION_SCHEMA.COLUMNS") && String(q.params.t) === table;
const isLeadScan = (q: FakeQuery, table: string, tid: string) =>
  q.text.includes(`FROM core2.dbo.[${table}]`) && q.params._ldTid === tid;

/** Fail a table's NEXT metadata probe (armed pre-hit so no unhandled rejection). */
function failNextMetaProbe(table: string): void {
  const gate = armGate((q) => isMetaProbe(q, table));
  // fail only once routeQuery has attached its await — rejection is always handled.
  void gate.hit.then(() => gate.fail(new Error(`fake ${table} metadata outage`)));
}

const scenario = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n     ${(e as Error).stack ?? String(e)}`); process.exitCode = 1; }
};

// ── 1. One module's metadata fails → partial:true, other module still scanned ─
addResponder((q) => (isLeadScan(q, "Opportunity", T1)
  ? { recordset: [{ TicketId: "OPM-T1-1", ProjectLeadUser: LEAD_GUID, CustomLeadsJson: "" }] }
  : undefined));
await scenario("metadata failure = failed scan: partial=true, surviving module's leads kept", async () => {
  failNextMetaProbe("PMM"); // cold miss → rejection reaches the scan's catch
  setTableColumns("Opportunity", ["TicketId", "TenantID", "ProjectLeadUser", "CustomLeadsJson"]);
  const dir = await rds.getLeadsDirectoryRds(T1);
  assert.equal(dir.partial, true, "metadata failure must set partial");
  const larry = dir.leads.find((l) => l.id === LEAD_GUID);
  assert.ok(larry, "Opportunity scan must still contribute leads");
  assert.ok(larry!.fields.includes("ProjectLeadUser"), `fields: ${larry!.fields}`);
});

// ── 2. EVERY attempted scan fails → throw (route catch → 502), never 200-[] ──
addResponder((q) => {
  if (isLeadScan(q, "Opportunity", T2)) throw new Error("fake Opportunity scan outage");
  return undefined;
});
await scenario("all scans fail → getLeadsDirectoryRds throws (metadata + query failure modes)", async () => {
  failNextMetaProbe("PMM"); // still uncached — scenario 1's failure was not cached
  await assert.rejects(rds.getLeadsDirectoryRds(T2), /failed for all modules/);
});

// ── 3. Healthy: *User + custom leads, unique-name-only promotion, partial=false ─
addResponder((q) => (isLeadScan(q, "PMM", T3)
  ? {
      recordset: [{
        TicketId: "PRJ-T3-1",
        ProjectLeadUser: LEAD_GUID,
        CustomLeadsJson: JSON.stringify({ "QA Lead": ["Uma Unique"], "Design Lead": ["Dana Dup"] }),
      }],
    }
  : undefined));
await scenario("healthy scan: custom:<Label> via unique name only, ambiguous names never promoted", async () => {
  setTableColumns("PMM", ["TicketId", "TenantID", "ProjectLeadUser", "CustomLeadsJson"]);
  const dir = await rds.getLeadsDirectoryRds(T3);
  assert.equal(dir.partial, false, "both scans succeeded — partial must be false");
  const larry = dir.leads.find((l) => l.id === LEAD_GUID);
  assert.ok(larry?.fields.includes("ProjectLeadUser"), "GUID *User token → directory entry");
  const uma = dir.leads.find((l) => l.id === UMA_GUID);
  assert.deepEqual(uma?.fields, ["custom:QA Lead"], "unique custom name → custom:<Label> field");
  assert.equal(uma?.recordCount, 1);
  assert.ok(!dir.leads.some((l) => l.name === "Dana Dup"),
    "ambiguous display name must NEVER be promoted to a directory entry");
});

console.log(process.exitCode === 1 ? "leadsDirectoryHonesty: FAILURES" : "leadsDirectoryHonesty: all passed");
process.exit(process.exitCode === 1 ? 1 : 0);
