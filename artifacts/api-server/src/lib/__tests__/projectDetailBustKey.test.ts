/**
 * check:cache-guards — project-detail bust KEY-SHAPE regression test (#737).
 *
 * Production incident (Aug 27, 2026): a Contract Value edit was invisible
 * after a plain refresh for up to TTL+grace (~35 min). Root cause: GET
 * /project/:id keys its cache `${tid}:${id}:${module ?? "auto"}` (3 segments)
 * while every per-ticket bust deleted `${tid}:${ticketId}` (2 segments) — a
 * silent no-op. The fix (bustProjectDetailForTicketLocal) prefix-matches all
 * module variants case-insensitively across cache + in-flight + gen keys.
 *
 * These tests seed the REAL maps through a test-only hook and pin that
 * contract for:
 *   - the local per-ticket bust (every auto/PMM/OPM/LEM variant, mixed case,
 *     plus the legacy 2-segment exact key; gen counters bumped; unrelated
 *     tickets/tenants untouched);
 *   - the generation guard (a pre-bust snapshot must not repopulate);
 *   - the IPC applier (handleClusterMessage case "projectDetail") — which
 *     must route through the SAME local helper so gens bump on receiving
 *     workers too (see .agents/memory/cluster-cache-bust-ipc.md).
 *
 * The companion static gate is scripts/check-cache-bust-key-shape.ts (flags
 * any cache whose exact-delete key shape can never match its written keys).
 *
 * Node harness pattern (tsx + watchdog + explicit process.exit) — chained
 * into check:cache-guards and check:synonyms (workflow "synonym-map"); the
 * repo is at the 10-workflow cap (see .agents/memory/check-workflow-limit.md).
 */
import assert from "node:assert/strict";
import { startWatchdog } from "./helpers/fakeRdsDb.js";

startWatchdog("projectDetailBustKey");

// Loaded AFTER the fake driver is in place — a static import would hoist.
const proxy = await import("../../routes/rmone-proxy.js");
const { bustProjectDetailCache, handleClusterMessage } = proxy;
const hooks = proxy.__projectDetailTestHooks;
const { cache, inFlight, gen, bustAt } = hooks;

let passed = 0;
let failed = 0;
async function scenario(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n     ${(e as Error).stack ?? String(e)}`); }
}

const entry = (v: string) => ({ data: { Status: true, Data: { v } }, expiresAt: Date.now() + 5 * 60_000 });

function seedKey(k: string, genValue?: number): void {
  cache.set(k, entry(`seed:${k}`));
  inFlight.set(k, Promise.resolve(null));
  if (genValue !== undefined) gen.set(k, genValue);
}

function assertBusted(k: string, expectedGen: number, label: string): void {
  assert.equal(cache.has(k), false, `${label}: cache entry "${k}" must be deleted`);
  assert.equal(inFlight.has(k), false, `${label}: in-flight entry "${k}" must be deleted`);
  assert.equal(gen.get(k), expectedGen, `${label}: gen counter for "${k}" must be bumped`);
}

// ── Local per-ticket bust ────────────────────────────────────────────────────

await scenario("local per-ticket bust clears EVERY 3-part module variant (incl. mixed case) and bumps gens", async () => {
  const TID = "tenant-bust-local";
  const TICKET = "PMM-26-110";
  const variants = [
    `${TID}:${TICKET}:auto`,
    `${TID}:${TICKET}:PMM`,
    `${TID}:${TICKET}:OPM`,
    `${TID}:${TICKET}:LEM`,
    `${TID}:pmm-26-110:auto`, // ticket case differs from the bust argument
    `${TID}:Pmm-26-110:OPM`,
    `${TID}:${TICKET}`,       // legacy 2-segment key (exact-match branch)
  ];
  for (const [i, k] of variants.entries()) seedKey(k, i + 3);
  // A key busted earlier has a gen entry but no cache/in-flight rows — the
  // sweep unions gen keys too, so it must STILL bump (a reader could have
  // captured its gen just before registering in-flight).
  const genOnly = `${TID}:${TICKET}:gen-only`;
  gen.set(genOnly, 9);

  const survivors = [
    `${TID}:PMM-26-1109:auto`,          // superstring ticket must NOT be swept
    `${TID}:PMM-26-999:auto`,           // sibling ticket
    `tenant-bust-other:${TICKET}:auto`, // same ticket, other tenant
  ];
  for (const k of survivors) seedKey(k, 1);

  // Control: seeding really populated all three maps (so the "gone" assertions
  // below cannot pass vacuously against never-seeded maps).
  for (const k of [...variants, ...survivors]) {
    assert.equal(cache.has(k), true, `seed missing for ${k}`);
    assert.equal(inFlight.has(k), true, `in-flight seed missing for ${k}`);
  }

  bustProjectDetailCache(TID, TICKET);

  variants.forEach((k, i) => assertBusted(k, i + 3 + 1, "local bust"));
  assert.equal(gen.get(genOnly), 10, "gen-only key must be bumped too");
  for (const k of survivors) {
    assert.equal(cache.has(k), true, `survivor "${k}" must be untouched`);
    assert.equal(gen.get(k), 1, `survivor gen for "${k}" must not bump`);
  }
  // adoptCache guard pre-stamped for all four canonical module variants, even
  // ones with no local entry — a sibling's pre-save payload broadcast must
  // not be adopted by a worker that had nothing to bust.
  for (const mod of ["auto", "PMM", "OPM", "LEM"]) {
    assert.equal(bustAt.get(`${TID}:${TICKET}:${mod}`), Date.now(),
      `bustAt must be stamped for module variant "${mod}"`);
  }
});

// ── Generation guard ─────────────────────────────────────────────────────────

await scenario("generation guard: a pre-bust snapshot must NOT repopulate the cache after the bust", async () => {
  const TID = "tenant-bust-gen";
  const K = `${TID}:OPM-77:auto`;
  const v = (key: string) => (cache.get(key)?.data as { Data?: { v?: string } } | undefined)?.Data?.v;

  // Control: an undisturbed write DOES land (proves setIfCurrent really writes).
  hooks.setIfCurrent(K, gen.get(K) ?? 0, { Status: true, Data: { v: "control" } });
  assert.equal(v(K), "control");

  // Race: a refresh captured startGen BEFORE the save's bust, finished after.
  const startGen = gen.get(K) ?? 0;
  bustProjectDetailCache(TID, "OPM-77");
  assert.equal(cache.has(K), false);
  hooks.setIfCurrent(K, startGen, { Status: true, Data: { v: "pre-save-stale" } });
  assert.equal(cache.has(K), false, "stale pre-bust snapshot must be discarded by the gen guard");

  // A write that captured the POST-bust gen lands normally again.
  hooks.setIfCurrent(K, gen.get(K) ?? 0, { Status: true, Data: { v: "fresh" } });
  assert.equal(v(K), "fresh");
});

// ── IPC applier (handleClusterMessage case "projectDetail") ─────────────────

await scenario("IPC applier per-ticket routes through the SAME prefix bust + gen bump", async () => {
  const TID = "tenant-bust-ipc";
  const TICKET = "LEM-00034340";
  const variants = [
    `${TID}:${TICKET}:auto`,
    `${TID}:${TICKET}:PMM`,
    `${TID}:${TICKET}:OPM`,
    `${TID}:${TICKET}:LEM`,
    `${TID}:lem-00034340:LEM`, // sibling worker saved with different ID case
    `${TID}:${TICKET}`,        // legacy 2-segment key
  ];
  for (const [i, k] of variants.entries()) seedKey(k, i);
  const survivor = `${TID}:LEM-00034341:auto`;
  seedKey(survivor, 2);

  // Bust argument case ALSO differs from most seeded keys (save payload vs URL).
  handleClusterMessage({ type: "bustCache", fn: "projectDetail", tid: TID, ticketId: "lem-00034340" });

  variants.forEach((k, i) => assertBusted(k, i + 1, "IPC per-ticket"));
  assert.equal(cache.has(survivor), true, "sibling ticket must survive the IPC bust");
  assert.equal(gen.get(survivor), 2);
  for (const mod of ["auto", "PMM", "OPM", "LEM"]) {
    // Pre-stamps use the CANONICAL pdKey case (uppercase ticket segment),
    // regardless of the caller's case — adoption normalizes through
    // pdNormalizeKey, so guard keys and adopted keys always align.
    assert.ok(bustAt.has(`${TID}:LEM-00034340:${mod}`),
      `bustAt stamped for "${mod}" under the canonical pdKey case`);
  }
});

await scenario("IPC applier tenant-wide (no ticketId) clears every key for the tenant, incl. gen-only", async () => {
  const TID = "tenant-bust-ipc-wide";
  const keys = [`${TID}:PMM-1:auto`, `${TID}:OPM-2:PMM`, `${TID}:LEM-3:LEM`];
  for (const [i, k] of keys.entries()) seedKey(k, i);
  const genOnly = `${TID}:PMM-4:auto`;
  gen.set(genOnly, 5);
  const other = "tenant-bust-ipc-wide-b:PMM-1:auto"; // prefix `${TID}:` must not match
  seedKey(other, 7);

  // Malformed message (no tid) must be a no-op.
  handleClusterMessage({ type: "bustCache", fn: "projectDetail" });
  assert.equal(cache.has(keys[0]), true, "message without tid must be ignored");

  handleClusterMessage({ type: "bustCache", fn: "projectDetail", tid: TID });
  keys.forEach((k, i) => assertBusted(k, i + 1, "IPC tenant-wide"));
  assert.equal(gen.get(genOnly), 6, "gen-only key must bump on tenant-wide IPC bust");
  assert.equal(cache.has(other), true, "other tenant must be untouched");
  assert.equal(gen.get(other), 7);
});

// ── Local tenant-wide bust ───────────────────────────────────────────────────

await scenario("local tenant-wide bust (no ticketId) clears every cached/in-flight key for the tenant", async () => {
  const TID = "tenant-bust-wide-local";
  const keys = [`${TID}:PMM-1:auto`, `${TID}:OPM-2:OPM`];
  for (const [i, k] of keys.entries()) seedKey(k, i);
  const other = "tenant-bust-wide-localx:PMM-1:auto"; // superstring tenant survives
  seedKey(other, 3);

  bustProjectDetailCache(TID);

  keys.forEach((k, i) => assertBusted(k, i + 1, "local tenant-wide"));
  assert.equal(cache.has(other), true, "superstring tenant id must survive");
  assert.equal(gen.get(other), 3);
});

console.log(`\nprojectDetailBustKey: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
