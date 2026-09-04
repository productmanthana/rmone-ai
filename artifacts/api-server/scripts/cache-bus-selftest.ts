/**
 * LIVE round-trip diagnostic for the cross-instance cache bus — run manually
 * (or from a deploy pipeline) to prove the CONFIGURED transport really
 * carries cache busts between instances. Not part of any check chain: it
 * talks to the real transport (app DB or Redis).
 *
 *   DB fallback:  CACHE_BUS=db pnpm --filter @workspace/api-server exec tsx scripts/cache-bus-selftest.ts
 *   Redis:        CACHE_BUS=redis REDIS_URL=redis://... pnpm --filter @workspace/api-server exec tsx scripts/cache-bus-selftest.ts
 *
 * Simulates TWO instances inside one process (distinct instanceIds on the
 * shared transport) and asserts the full policy, end to end:
 *   1. a bustCache published by A arrives at B — exactly ONCE (the DB
 *      poller's overlapping windows re-read rows; dedupe must apply once);
 *   2. A never hears its own publish back (self-echo filter);
 *   3. an oversized adoption respects the transport cap (dropped on DB's
 *      64KB, forwarded under Redis's 2MB).
 */
import { randomUUID } from "node:crypto";
import { bootstrapDatabase, closeMssqlPool } from "@workspace/db";
import { startCacheBus, resolveBusMode } from "../src/lib/cache-bus.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const env: Record<string, string | undefined> = {
  ...process.env,
  // Snappy polling for the test unless the caller pinned one.
  CACHE_BUS_POLL_MS: process.env.CACHE_BUS_POLL_MS || "500",
};

const decision = resolveBusMode(env);
if (decision.mode === "off") {
  console.error(
    "cache-bus-selftest: bus resolves to OFF for this environment — set CACHE_BUS=db " +
      "or CACHE_BUS=redis (+ CACHE_BUS_REDIS_URL/REDIS_URL). Nothing to test.",
  );
  process.exit(2);
}
console.log(`cache-bus-selftest: transport=${decision.mode} (${decision.reason})`);

if (decision.mode === "db") {
  // Idempotent — also proves the rmone_cache_bus_events DDL applies.
  await bootstrapDatabase();
}

const marker = `selftest-${randomUUID().slice(0, 8)}`;
const gotA: Record<string, unknown>[] = [];
const gotB: Record<string, unknown>[] = [];
const busA = startCacheBus({ instanceId: `A-${marker}`, onRemoteMessage: (m) => gotA.push(m), env });
const busB = startCacheBus({ instanceId: `B-${marker}`, onRemoteMessage: (m) => gotB.push(m), env });

// Give Redis time to connect + subscribe (DB mode just needs the first tick).
await sleep(decision.mode === "redis" ? 2_000 : 300);

busA.publish({ type: "bustCache", fn: "finAnalytics", tid: marker });
// ~200KB adoption: over the DB cap (64KB), under the Redis cap (2MB).
busA.publish({ type: "adoptCache", fn: "selftest", tid: marker, payloadJson: "x".repeat(200_000) });

const isOurBust = (m: Record<string, unknown>): boolean =>
  m["type"] === "bustCache" && m["tid"] === marker;

const deadline = Date.now() + 20_000;
while (Date.now() < deadline && !gotB.some(isOurBust)) await sleep(250);
// Two extra poll cycles: catch duplicate delivery and stragglers.
await sleep(1_500);

const bustsAtB = gotB.filter(isOurBust).length;
const echoesAtA = gotA.filter((m) => m["tid"] === marker).length;
const adoptionsAtB = gotB.filter((m) => m["type"] === "adoptCache" && m["tid"] === marker).length;
const expectedAdoptions = decision.mode === "db" ? 0 : 1;

let ok = true;
const report = (pass: boolean, label: string): void => {
  ok = ok && pass;
  console.log(`  ${pass ? "✓" : "✗"} ${label}`);
};
report(bustsAtB === 1, `bust from A delivered to B exactly once (got ${bustsAtB})`);
report(echoesAtA === 0, `A never hears its own publishes (got ${echoesAtA})`);
report(
  adoptionsAtB === expectedAdoptions,
  `200KB adoption ${expectedAdoptions === 0 ? "dropped by DB size cap" : "forwarded under Redis cap"} (got ${adoptionsAtB})`,
);

await busA.stop();
await busB.stop();
await closeMssqlPool().catch(() => {});
console.log(ok ? "cache-bus-selftest: PASS" : "cache-bus-selftest: FAIL");
process.exit(ok ? 0 : 1);
