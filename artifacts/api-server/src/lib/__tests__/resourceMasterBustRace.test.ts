/**
 * check chain — /resource-master cache bust-race regression test.
 *
 * The resource-master directory cache (rmone-proxy.ts) is busted alongside
 * the users-family caches on every staff write. Review of the initial
 * implementation flagged the classic in-flight race: a fetch that began
 * BEFORE a staff write could complete AFTER the bust and write its pre-bust
 * roster back into the cache (staff-org/divisionHierarchy had the same bug —
 * see rdsCacheBustRace.test.ts and .agents/memory/cluster-cache-bust-ipc.md).
 *
 * These scenarios pin the generation-guard contract on the REAL functions:
 *   1. control — an unbusted fetch caches its rows;
 *   2. bust during in-flight fetch → rows still returned to the caller but
 *      NEVER cached; the next fetch hits the source and caches post-bust data;
 *   3. a pre-bust completion must not delete a NEWER post-bust in-flight
 *      entry (single-flight survives the race);
 *   4. the IPC "users" signal routes through the same local bust (sibling
 *      workers bump the gen too).
 *
 * Node harness pattern (tsx + watchdog + explicit process.exit), chained
 * into check:synonyms (workflow "synonym-map") — the repo is at the
 * 10-workflow cap (see .agents/memory/check-workflow-limit.md).
 */
import assert from "node:assert/strict";
import { startWatchdog } from "./helpers/fakeRdsDb.js";

startWatchdog("resourceMasterBustRace");

// Loaded AFTER the fake driver is in place — a static import would hoist.
const proxy = await import("../../routes/rmone-proxy.js");
const { handleClusterMessage } = proxy;
const hooks = proxy.__resourceMasterTestHooks;
const { cache, inFlight, gen, bust, fetch: fetchRm, setFetcher } = hooks;

let passed = 0;
let failed = 0;
async function scenario(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n     ${(e as Error).stack ?? String(e)}`); }
  finally { setFetcher(null); cache.clear(); inFlight.clear(); gen.clear(); }
}

type Deferred = { promise: Promise<object[]>; resolve: (rows: object[]) => void };
function deferred(): Deferred {
  let resolve!: (rows: object[]) => void;
  const promise = new Promise<object[]>((r) => { resolve = r; });
  return { promise, resolve };
}

const OLD_ROWS = [{ name: "Old Title" }];
const NEW_ROWS = [{ name: "New Title" }];
const TID = "tenant-rm-race";

await scenario("control: unbusted fetch caches its rows", async () => {
  setFetcher(() => Promise.resolve(OLD_ROWS));
  const rows = await fetchRm(TID);
  assert.deepEqual(rows, OLD_ROWS, "caller gets the rows");
  assert.deepEqual(cache.get(TID)?.data, OLD_ROWS, "rows are cached");
  assert.equal(inFlight.has(TID), false, "in-flight entry cleaned up");
});

await scenario("race: bust during in-flight fetch → pre-bust rows never cached", async () => {
  const d1 = deferred();
  setFetcher(() => d1.promise);
  const p1 = fetchRm(TID);              // fetch starts (pre-bust)
  assert.equal(inFlight.has(TID), true, "fetch is in flight");
  bust(TID);                            // staff write lands mid-flight
  assert.equal(inFlight.has(TID), false, "bust clears in-flight");
  d1.resolve(OLD_ROWS);                 // pre-bust fetch completes late
  const rows1 = await p1;
  assert.deepEqual(rows1, OLD_ROWS, "late caller still gets its rows");
  assert.equal(cache.has(TID), false, "pre-bust rows must NOT be cached");
  // Next fetch hits the source and caches post-bust data.
  setFetcher(() => Promise.resolve(NEW_ROWS));
  const rows2 = await fetchRm(TID);
  assert.deepEqual(rows2, NEW_ROWS, "fresh fetch returns post-bust rows");
  assert.deepEqual(cache.get(TID)?.data, NEW_ROWS, "post-bust rows are cached");
});

await scenario("race: pre-bust completion never deletes a newer in-flight entry", async () => {
  const d1 = deferred();
  setFetcher(() => d1.promise);
  const p1 = fetchRm(TID);              // old fetch (pre-bust)
  bust(TID);
  const d2 = deferred();
  setFetcher(() => d2.promise);
  const p2 = fetchRm(TID);              // new fetch (post-bust), now in flight
  assert.equal(inFlight.has(TID), true, "new fetch is in flight");
  d1.resolve(OLD_ROWS);                 // old fetch completes late
  await p1;
  assert.equal(inFlight.has(TID), true, "old completion must NOT delete the new in-flight entry");
  assert.equal(cache.has(TID), false, "old rows still not cached");
  d2.resolve(NEW_ROWS);
  const rows2 = await p2;
  assert.deepEqual(rows2, NEW_ROWS);
  assert.deepEqual(cache.get(TID)?.data, NEW_ROWS, "new rows cached after clean completion");
  assert.equal(inFlight.has(TID), false, "in-flight cleaned up at the end");
});

await scenario("IPC 'users' signal busts resource-master through the same helper", async () => {
  cache.set(TID, { data: OLD_ROWS, expiresAt: Date.now() + 5 * 60_000 });
  inFlight.set(TID, Promise.resolve(OLD_ROWS));
  const genBefore = gen.get(TID) ?? 0;
  handleClusterMessage({ type: "bustCache", fn: "users", tid: TID });
  assert.equal(cache.has(TID), false, "IPC bust clears the cache");
  assert.equal(inFlight.has(TID), false, "IPC bust clears in-flight");
  assert.equal(gen.get(TID), genBefore + 1, "IPC bust bumps the generation");
});

console.log(`\nresourceMasterBustRace: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
