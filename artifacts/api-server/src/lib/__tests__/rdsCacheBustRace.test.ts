/**
 * check:cache-guards — bust-during-refresh regression tests.
 *
 * The project-detail speedup added serve-stale caching (short TTL + 10-min
 * grace + ONE background rebuild) to the tenant-scoped staff-org and
 * division-hierarchy maps in rds-provider.ts. An org import busts those
 * caches when it finishes — but a background rebuild that started BEFORE the
 * bust could finish AFTER it and write pre-import org data back, silently
 * undoing the import for a full TTL. Generation counters (staffOrgGen /
 * divHierGen, bumped by the invalidators) guard every cache write in the
 * rebuilds, including divisionHierarchy's stale-if-error restore.
 *
 * These tests pin that behaviour end-to-end against a fake mssql driver:
 *   - control: a background refresh DOES repopulate when nothing busted it
 *     (proves the serve-stale path + the query gate really intercept a rebuild,
 *     so the race assertions below cannot pass vacuously);
 *   - race: invalidate mid-rebuild → the finished rebuild must NOT repopulate;
 *     the next read hits the DB fresh (blocking) and sees post-import data;
 *   - divisionHierarchy stale-if-error: restore kept without a bust, skipped
 *     after one.
 *
 * Node harness pattern (tsx + watchdog + explicit process.exit) — chained into
 * check:synonyms (workflow "synonym-map"); the repo is at the 10-workflow cap
 * (see .agents/memory/check-workflow-limit.md).
 */
import assert from "node:assert/strict";
import {
  addResponder, advanceClock, armGate, countQueries, flush,
  setTableColumns, startWatchdog,
  type FakeQuery,
} from "./helpers/fakeRdsDb.js";

startWatchdog("rdsCacheBustRace");

// Loaded AFTER the fake driver is in place — a static import would hoist.
const rds = await import("../rds-provider.js");

// ── Fixtures ─────────────────────────────────────────────────────────────────
// @workspace/db getActiveUsersByTenant — the query every staff-org rebuild
// starts from. (The org-chain's Department leg reads rmoneapp.dbo.rmone_users —
// exclude it so counters only see the roster query.)
const isUsersQuery = (q: FakeQuery) =>
  q.text.includes("FROM dbo.rmone_users") && !q.text.includes("rmoneapp");
const usersByTenant = new Map<string, Record<string, unknown>[]>();
addResponder((q) => (isUsersQuery(q)
  ? { recordset: usersByTenant.get(String(q.params.tid)) ?? [] }
  : undefined));

// rebuildDivisionHierarchy's SELECT aliases "AS DivTitle" — distinct from the
// staff-org chain's "AS DivName" and getRecordDetail's "AS [__DivTitle]".
const isDivHierQuery = (q: FakeQuery) => q.text.includes("AS DivTitle");
const divRowsByTenant = new Map<string, Record<string, unknown>[]>();
addResponder((q) => (isDivHierQuery(q)
  ? { recordset: divRowsByTenant.get(String(q.params.tid)) ?? [] }
  : undefined));

setTableColumns("JobTitle", ["ID", "Title", "DepartmentId", "TenantID"]);
setTableColumns("Department", ["ID", "Title", "DivisionIdLookup", "TenantID", "Deleted"]);
setTableColumns("CompanyDivisions", ["ID", "Title", "ShortName", "BusinessUnitIdLookup", "TenantID"]);
setTableColumns("BusinessUnit", ["ID", "Title", "TenantID"]);
setTableColumns("AspNetUsers", []); // no Id column → the core2 supplement leg no-ops

const user = (tid: string, id: string, name: string) => ({
  id, tenant_id: tid, username: id, name, email: `${id}@example.test`,
  enabled: true, deleted: false,
});
const divRow = (id: string, shortName: string) => ({
  ID: id, DivTitle: `${shortName} Division`, DivShort: shortName, BuTitle: "BU One",
});

const usersQueries = (tid: string) => countQueries((q) => isUsersQuery(q) && q.params.tid === tid);
const divQueries = (tid: string) => countQueries((q) => isDivHierQuery(q) && q.params.tid === tid);

// Past the TTL (staff 5 min / divisions 60 s), inside the 10-min stale grace.
const STAFF_STALE_ADVANCE_MS = 6 * 60_000;
const DIV_STALE_ADVANCE_MS = 90_000;

let passed = 0;
let failed = 0;
async function scenario(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n     ${(e as Error).stack ?? String(e)}`); }
}

// ── Staff-org map ────────────────────────────────────────────────────────────

await scenario("staff-org control: background refresh repopulates when NO bust intervenes", async () => {
  const TID = "tenant-staff-control";
  usersByTenant.set(TID, [user(TID, "ctrl-pre", "Ctrl PreRefresh")]);
  const r1 = await rds.appStaffOrgMapChecked(TID);
  assert.equal(r1.ok, true);
  assert.ok(r1.map.has("ctrl-pre"));
  assert.equal(usersQueries(TID), 1);

  advanceClock(STAFF_STALE_ADVANCE_MS);

  const gate = armGate((q) => isUsersQuery(q) && q.params.tid === TID);
  const r2 = await rds.appStaffOrgMapChecked(TID);
  assert.ok(r2.map.has("ctrl-pre"), "stale map should be served while the refresh runs");
  await gate.hit;
  assert.equal(usersQueries(TID), 2, "ONE background refresh should be in flight");
  gate.release([user(TID, "ctrl-post", "Ctrl PostRefresh")]);
  await flush();

  const r3 = await rds.appStaffOrgMapChecked(TID);
  assert.equal(usersQueries(TID), 2, "refreshed map must come from cache — no third query");
  assert.ok(r3.map.has("ctrl-post"), "background refresh result must have been cached");
  assert.ok(!r3.map.has("ctrl-pre"));
});

await scenario("staff-org race: bust during in-flight refresh cannot resurrect pre-import data", async () => {
  const TID = "tenant-staff-race";
  const preImport = [user(TID, "stale-user", "Alice PreImport")];
  usersByTenant.set(TID, preImport);
  const r1 = await rds.appStaffOrgMapChecked(TID);
  assert.ok(r1.map.has("stale-user"));
  assert.equal(usersQueries(TID), 1);

  advanceClock(STAFF_STALE_ADVANCE_MS);

  const gate = armGate((q) => isUsersQuery(q) && q.params.tid === TID);
  const r2 = await rds.appStaffOrgMapChecked(TID);
  assert.ok(r2.map.has("stale-user"), "stale map served during the grace window");
  await gate.hit; // background rebuild is now mid-flight, reading PRE-import data

  // The org import finishes: it busts the cache and the DB now holds new rows.
  rds.invalidateStaffOrgCache(TID);
  usersByTenant.set(TID, [user(TID, "fresh-user", "Bob PostImport")]);

  gate.release(preImport); // the in-flight rebuild completes with PRE-bust rows
  await flush();
  assert.equal(usersQueries(TID), 2);

  // The poisoned rebuild must NOT have repopulated the cache: the next read
  // does a fresh BLOCKING rebuild and sees the post-import roster.
  const r3 = await rds.appStaffOrgMapChecked(TID);
  assert.equal(usersQueries(TID), 3, "next read after the bust must hit the DB (entry stayed deleted)");
  assert.ok(r3.map.has("fresh-user"), "post-import roster must be visible");
  assert.ok(!r3.map.has("stale-user"), "pre-import roster must NOT resurface");
});

// ── Division hierarchy ───────────────────────────────────────────────────────

await scenario("divisionHierarchy control: background refresh repopulates when NO bust intervenes", async () => {
  const TID = "tenant-div-control";
  divRowsByTenant.set(TID, [divRow("11", "CTRL-OLD")]);
  const m1 = await rds.divisionHierarchy(TID);
  assert.equal(m1.get("11")?.divTitle, "CTRL-OLD");
  assert.equal(divQueries(TID), 1);

  advanceClock(DIV_STALE_ADVANCE_MS);

  const gate = armGate((q) => isDivHierQuery(q) && q.params.tid === TID);
  const m2 = await rds.divisionHierarchy(TID);
  assert.equal(m2.get("11")?.divTitle, "CTRL-OLD", "stale hierarchy served while refresh runs");
  await gate.hit;
  gate.release([divRow("11", "CTRL-NEW")]);
  await flush();

  const m3 = await rds.divisionHierarchy(TID);
  assert.equal(divQueries(TID), 2, "refreshed hierarchy must come from cache — no third query");
  assert.equal(m3.get("11")?.divTitle, "CTRL-NEW");
});

await scenario("divisionHierarchy race: bust during in-flight refresh cannot resurrect pre-import data", async () => {
  const TID = "tenant-div-race";
  const preImport = [divRow("21", "PRE-IMPORT")];
  divRowsByTenant.set(TID, preImport);
  const m1 = await rds.divisionHierarchy(TID);
  assert.equal(m1.get("21")?.divTitle, "PRE-IMPORT");
  assert.equal(divQueries(TID), 1);

  advanceClock(DIV_STALE_ADVANCE_MS);

  const gate = armGate((q) => isDivHierQuery(q) && q.params.tid === TID);
  const m2 = await rds.divisionHierarchy(TID);
  assert.equal(m2.get("21")?.divTitle, "PRE-IMPORT");
  await gate.hit;

  rds.invalidateDivisionHierarchy(TID);
  divRowsByTenant.set(TID, [divRow("21", "POST-IMPORT")]);

  gate.release(preImport);
  await flush();
  assert.equal(divQueries(TID), 2);

  const m3 = await rds.divisionHierarchy(TID);
  assert.equal(divQueries(TID), 3, "next read after the bust must hit the DB (entry stayed deleted)");
  assert.equal(m3.get("21")?.divTitle, "POST-IMPORT", "pre-import hierarchy must NOT resurface");
});

await scenario("divisionHierarchy stale-if-error control: restore serves last real map when NO bust intervenes", async () => {
  const TID = "tenant-div-err-control";
  divRowsByTenant.set(TID, [divRow("31", "ERR-OLD")]);
  const m1 = await rds.divisionHierarchy(TID);
  assert.equal(m1.get("31")?.divTitle, "ERR-OLD");
  assert.equal(divQueries(TID), 1);

  advanceClock(DIV_STALE_ADVANCE_MS);

  const gate = armGate((q) => isDivHierQuery(q) && q.params.tid === TID);
  const m2 = await rds.divisionHierarchy(TID);
  assert.equal(m2.get("31")?.divTitle, "ERR-OLD");
  await gate.hit;
  // Plain Error (no `code`) — withDbRetry treats it as non-transient/final.
  gate.fail(new Error("simulated final DB failure"));
  await flush();

  // Stale-if-error restore: the last REAL hierarchy is re-cached (short TTL) —
  // the next read serves it without touching the DB.
  const m3 = await rds.divisionHierarchy(TID);
  assert.equal(divQueries(TID), 2, "restored stale entry must be served without a new query");
  assert.equal(m3.get("31")?.divTitle, "ERR-OLD");
});

await scenario("divisionHierarchy stale-if-error race: restore is SKIPPED after a bust", async () => {
  const TID = "tenant-div-err-race";
  divRowsByTenant.set(TID, [divRow("41", "ERR-STALE")]);
  const m1 = await rds.divisionHierarchy(TID);
  assert.equal(m1.get("41")?.divTitle, "ERR-STALE");
  assert.equal(divQueries(TID), 1);

  advanceClock(DIV_STALE_ADVANCE_MS);

  const gate = armGate((q) => isDivHierQuery(q) && q.params.tid === TID);
  const m2 = await rds.divisionHierarchy(TID);
  assert.equal(m2.get("41")?.divTitle, "ERR-STALE");
  await gate.hit;

  // Import busts mid-rebuild; the rebuild then fails its final query. The
  // stale-if-error restore holds a pre-bust snapshot — it must NOT re-cache it.
  rds.invalidateDivisionHierarchy(TID);
  divRowsByTenant.set(TID, [divRow("41", "ERR-FRESH")]);
  gate.fail(new Error("simulated final DB failure during import bust"));
  await flush();
  assert.equal(divQueries(TID), 2);

  const m3 = await rds.divisionHierarchy(TID);
  assert.equal(divQueries(TID), 3, "bust must force a fresh blocking rebuild — a restored entry would have skipped the DB");
  assert.equal(m3.get("41")?.divTitle, "ERR-FRESH", "pre-import hierarchy must NOT be resurrected by the restore");
});

console.log(`\nrdsCacheBustRace: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
