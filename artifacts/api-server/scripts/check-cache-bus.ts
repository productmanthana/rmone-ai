/**
 * Guards the cross-instance cache-bus contract (src/lib/cache-bus.ts) and the
 * instance-aware DB pool budget (src/lib/db.ts computePoolBudget):
 *
 *  1. Mode resolution — dev/single-instance stays OFF (no Redis required, no
 *     polling, today's behavior byte-for-byte); a Redis URL turns the bus on;
 *     INSTANCE_COUNT>1 without Redis falls back to DB polling; explicit
 *     CACHE_BUS=redis|db|off always wins (redis without a URL disables).
 *  2. Publish whitelist — busts and adoptions cross instances; cluster
 *     lifecycle messages (workerCrashed/reconcileDone) NEVER do; warm hints
 *     only behind CACHE_BUS_FORWARD_WARMS=1 (warm fan-out has starved RDS
 *     before — multiplying it by instance count must be an explicit choice);
 *     adoptions are size-capped per transport (DB 64KB, Redis 2MB).
 *  3. Envelope — self-origin echoes filtered, foreign origins delivered
 *     verbatim, junk/foreign versions ignored.
 *  4. DB-poller dedupe — overlapping lookback windows re-read rows by design;
 *     SeenIdWindow applies each id once and expires entries after its TTL.
 *  5. Pool budget — INSTANCE_COUNT / POOL_BUDGET divide the ~200-connection
 *     fleet budget; single-instance numbers stay EXACTLY historical (4
 *     workers → max 50 / min 5); the 15-per-worker floor is flagged when it
 *     overshoots the budget.
 *  6. Wiring — the primary relay actually publishes to the bus, the bus is
 *     started in index.ts, the drain probe exists, and ioredis is importable
 *     with the constructor shape the dynamic import expects.
 *  7. Token-keyed records bust — bustRecordCache (field-save path) broadcasts
 *     a sha256 token-HASH bust that sibling workers apply through the same
 *     local helper, and the message classifies as a bust so it rides the
 *     cross-instance bus too; raw token material never leaves the process.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveBusMode,
  classifyBusMessage,
  encodeForPublish,
  decodeEnvelope,
  SeenIdWindow,
  DB_MAX_ENVELOPE_BYTES,
  REDIS_MAX_ENVELOPE_BYTES,
} from "../src/lib/cache-bus.js";
import { computePoolBudget } from "../src/lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "..", "src");

let failures = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✓ ${name}`);
    })
    .catch((e: unknown) => {
      failures++;
      console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`);
    });
}

// ── 1. Mode resolution ───────────────────────────────────────────────────────
await check("dev default (empty env) → off", () => {
  assert.equal(resolveBusMode({}).mode, "off");
});
await check("INSTANCE_COUNT=1 → off (single machine needs no bus)", () => {
  assert.equal(resolveBusMode({ INSTANCE_COUNT: "1" }).mode, "off");
});
await check("REDIS_URL → redis", () => {
  const d = resolveBusMode({ REDIS_URL: "redis://h:6379" });
  assert.equal(d.mode, "redis");
  assert.equal(d.redisUrl, "redis://h:6379");
});
await check("CACHE_BUS_REDIS_URL wins over REDIS_URL", () => {
  const d = resolveBusMode({ CACHE_BUS_REDIS_URL: "rediss://dedicated", REDIS_URL: "redis://shared" });
  assert.equal(d.mode, "redis");
  assert.equal(d.redisUrl, "rediss://dedicated");
});
await check("INSTANCE_COUNT=2 with no Redis → db fallback", () => {
  assert.equal(resolveBusMode({ INSTANCE_COUNT: "2" }).mode, "db");
});
await check("explicit CACHE_BUS=off beats Redis URL and INSTANCE_COUNT", () => {
  assert.equal(resolveBusMode({ CACHE_BUS: "off", REDIS_URL: "redis://h", INSTANCE_COUNT: "3" }).mode, "off");
});
await check("explicit CACHE_BUS=db beats Redis URL", () => {
  assert.equal(resolveBusMode({ CACHE_BUS: "db", REDIS_URL: "redis://h" }).mode, "db");
});
await check("CACHE_BUS=redis without a URL → off (disabled loudly, never a crash)", () => {
  const d = resolveBusMode({ CACHE_BUS: "redis" });
  assert.equal(d.mode, "off");
  assert.match(d.reason, /unset/i);
});
await check("junk INSTANCE_COUNT → off (defaults to 1)", () => {
  assert.equal(resolveBusMode({ INSTANCE_COUNT: "banana" }).mode, "off");
});

// ── 2. Message classification / publish whitelist ───────────────────────────
await check("busts classified as bust (all three types)", () => {
  assert.equal(classifyBusMessage({ type: "bustCache", fn: "finAnalytics" }), "bust");
  assert.equal(classifyBusMessage({ type: "bustExtraFields", tenant: "t" }), "bust");
  assert.equal(classifyBusMessage({ type: "bustUsageAnalytics" }), "bust");
});
await check("adoptions classified as adopt", () => {
  assert.equal(classifyBusMessage({ type: "adoptCache", fn: "x" }), "adopt");
  assert.equal(classifyBusMessage({ type: "adoptUsageAnalytics" }), "adopt");
});
await check("warm hints classified as warm", () => {
  for (const type of ["warmHome", "warmProjectHours", "warmDemandProjects", "noteHotProject"]) {
    assert.equal(classifyBusMessage({ type }), "warm", type);
  }
});
await check("cluster lifecycle + junk → skip (NEVER cross machines)", () => {
  assert.equal(classifyBusMessage({ type: "workerCrashed", ownerToken: "x" }), "skip");
  assert.equal(classifyBusMessage({ type: "reconcileDone", ownerToken: "x" }), "skip");
  assert.equal(classifyBusMessage({ type: "somethingNew" }), "skip");
  assert.equal(classifyBusMessage(null), "skip");
  assert.equal(classifyBusMessage(42), "skip");
  assert.equal(classifyBusMessage({}), "skip");
  assert.equal(classifyBusMessage([{ type: "bustCache" }]), "skip");
});
const pub = { mode: "db" as const, origin: "origin-A", forwardWarms: false };
await check("bust encodes for publish", () => {
  assert.ok(encodeForPublish({ type: "bustCache", fn: "org", tenant: "t" }, pub));
});
await check("lifecycle messages never encode", () => {
  assert.equal(encodeForPublish({ type: "workerCrashed", ownerToken: "x" }, pub), null);
  assert.equal(encodeForPublish({ type: "reconcileDone" }, { ...pub, forwardWarms: true }), null);
});
await check("warms drop by default, encode only with the opt-in", () => {
  assert.equal(encodeForPublish({ type: "warmHome" }, pub), null);
  assert.ok(encodeForPublish({ type: "warmHome" }, { ...pub, forwardWarms: true }));
});
await check("adoption size caps: DB 64KB, Redis 2MB", () => {
  const mid = { type: "adoptCache", fn: "x", payloadJson: "x".repeat(100_000) }; // ~100KB
  assert.equal(encodeForPublish(mid, pub), null, "over DB cap → dropped");
  assert.ok(encodeForPublish(mid, { ...pub, mode: "redis" }), "under Redis cap → forwarded");
  const huge = { type: "adoptCache", fn: "x", payloadJson: "x".repeat(2_100_000) };
  assert.equal(encodeForPublish(huge, { ...pub, mode: "redis" }), null, "over Redis cap → dropped");
  assert.ok(DB_MAX_ENVELOPE_BYTES < REDIS_MAX_ENVELOPE_BYTES);
});
await check("busts are never size-capped (correctness channel)", () => {
  // A bust is tiny in practice; the policy point is that correctness
  // messages must not silently vanish behind an optimization cap.
  const chunky = { type: "bustCache", fn: "org", tenants: "t".repeat(100_000) };
  assert.ok(encodeForPublish(chunky, pub));
});

// ── 3. Envelope round-trip ───────────────────────────────────────────────────
await check("round-trip: foreign origin delivers the inner message verbatim", () => {
  const msg = { type: "bustCache", fn: "projectDetail", tenant: "acme", ids: ["a", "b"] };
  const json = encodeForPublish(msg, pub);
  assert.ok(json);
  assert.deepEqual(decodeEnvelope(json as string, "origin-B"), msg);
});
await check("round-trip: own origin is filtered (self-echo)", () => {
  const json = encodeForPublish({ type: "bustCache", fn: "org" }, pub);
  assert.equal(decodeEnvelope(json as string, "origin-A"), null);
});
await check("malformed / foreign-version envelopes are ignored", () => {
  assert.equal(decodeEnvelope("not json", "me"), null);
  assert.equal(decodeEnvelope('"a string"', "me"), null);
  assert.equal(decodeEnvelope(JSON.stringify({ v: 2, o: "x", m: { type: "bustCache" } }), "me"), null);
  assert.equal(decodeEnvelope(JSON.stringify({ v: 1, o: "", m: { type: "bustCache" } }), "me"), null);
  assert.equal(decodeEnvelope(JSON.stringify({ v: 1, o: "x" }), "me"), null);
  assert.equal(decodeEnvelope(JSON.stringify({ v: 1, o: "x", m: [1, 2] }), "me"), null);
});

// ── 4. Poller dedupe window ──────────────────────────────────────────────────
await check("SeenIdWindow applies each id once, expires after TTL", () => {
  const w = new SeenIdWindow(1_000);
  const t0 = 1_000_000;
  assert.equal(w.check(7, t0), true, "first sight is fresh");
  assert.equal(w.check(7, t0 + 500), false, "re-read within TTL deduped");
  assert.equal(w.check(8, t0 + 500), true, "different id is fresh");
  assert.equal(w.check(7, t0 + 2_000), true, "expired id is fresh again");
  w.prune(t0 + 10_000);
  assert.equal(w.size, 0, "prune clears expired entries");
});

// ── 5. Pool budget matrix ────────────────────────────────────────────────────
await check("single-instance defaults are bit-identical to the historical formula", () => {
  const b4 = computePoolBudget({ cpuCount: 4 });
  assert.deepEqual([b4.workerCount, b4.poolMax, b4.poolMin], [4, 50, 5]);
  const b2 = computePoolBudget({ cpuCount: 8, workersEnv: "2" });
  assert.deepEqual([b2.workerCount, b2.poolMax, b2.poolMin], [2, 100, 10]);
  // WORKERS above 4 (deliberate override on a big VM): historical min floor 2
  const b16 = computePoolBudget({ cpuCount: 16, workersEnv: "16" });
  assert.deepEqual([b16.poolMax, b16.poolMin], [15, 2]);
  assert.equal(b4.floorEngaged, false);
});
await check("INSTANCE_COUNT divides the budget across machines", () => {
  const b = computePoolBudget({ cpuCount: 4, instanceCountEnv: "2" });
  assert.deepEqual([b.poolMax, b.poolMin], [25, 2]); // 2 instances × 4 workers × 25 = 200
  assert.equal(b.floorEngaged, false);
});
await check("POOL_BUDGET overrides the 200 total", () => {
  const b = computePoolBudget({ cpuCount: 4, instanceCountEnv: "2", poolBudgetEnv: "300" });
  assert.equal(b.poolMax, Math.floor(300 / 8));
});
await check("per-worker floor engages (and is flagged) in oversized fleets", () => {
  const b = computePoolBudget({ cpuCount: 4, instanceCountEnv: "4" });
  assert.equal(b.poolMax, 15); // floor: 200/16 = 12.5 → floor(12) < 15
  assert.equal(b.poolMin, 1);
  assert.equal(b.floorEngaged, true, "16 workers × 15 = 240 > 200 must be flagged");
});
await check("junk env values fall back to sane clamps", () => {
  const b = computePoolBudget({ cpuCount: 4, instanceCountEnv: "zero?", poolBudgetEnv: "-5" });
  // NaN instance count → 1; negative budget clamps to the 20 floor →
  // per-worker max hits its own floor (15) and min = floor(20/4) = 5.
  assert.deepEqual([b.instanceCount, b.poolBudget, b.poolMax, b.poolMin], [1, 20, 15, 5]);
  assert.equal(b.floorEngaged, true, "4×15 = 60 > 20 must be flagged");
});

// ── 6. Wiring ────────────────────────────────────────────────────────────────
const read = (rel: string): string => fs.readFileSync(path.join(SRC, rel), "utf8");
await check("index.ts starts the bus and publishes from the relay choke point", () => {
  const idx = read("index.ts");
  assert.match(idx, /startCacheBus\(/, "bus must be constructed in the primary");
  // The fan-out relay is the LAST cluster.on("message") registration (an
  // earlier one handles reconcile ACKs). The publish hook must live inside
  // it so every existing and future bust caller crosses instances with zero
  // caller changes.
  const relayStart = idx.lastIndexOf('cluster.on("message"');
  assert.ok(relayStart > 0, "relay registration must exist");
  const relayWindow = idx.slice(relayStart, relayStart + 1_200);
  assert.match(
    relayWindow,
    /cacheBus\.publish\(msg\)/,
    "the relay handler must publish every fanned-out message to the bus",
  );
  assert.match(idx, /cacheBus\.stop\(\)/, "shutdown must stop the bus");
});
await check("drain probe wired: /healthz/imports → summarizeActiveImports", () => {
  assert.match(read(path.join("routes", "health.ts")), /healthz\/imports/);
  assert.match(read(path.join("routes", "health.ts")), /summarizeActiveImports/);
  assert.match(read(path.join("routes", "onboarding.ts")), /export async function summarizeActiveImports/);
});
await check("ioredis importable with the constructor shape the dynamic import expects", async () => {
  const mod = await import("ioredis");
  assert.equal(typeof mod.default, "function", "default export must be the Redis class");
  // lazyConnect: constructor must not open sockets — validates option shape offline.
  const client = new mod.default("redis://127.0.0.1:1", { lazyConnect: true, enableOfflineQueue: false });
  client.disconnect();
});

// ── 7. Token-keyed records bust crosses workers (and instances) ─────────────
// After a field save, bustRecordCache must reach SIBLING workers: the local
// delete alone leaves the saving user's next list request — round-robined to
// another worker — serving their pre-save list until TTL expiry. The broadcast
// carries a sha256 token HASH (the cache-key suffix), never raw token bytes:
// the same message rides the cross-instance bus, whose DB transport persists
// envelopes in a table.
const proxySrc = read(path.join("routes", "rmone-proxy.ts"));
await check("recordToken bust is whitelisted to cross instances", () => {
  assert.equal(
    classifyBusMessage({ type: "bustCache", fn: "recordToken", tokenHash: "a".repeat(32) }),
    "bust",
  );
  assert.ok(
    encodeForPublish({ type: "bustCache", fn: "recordToken", tokenHash: "a".repeat(32) }, pub),
    "must encode for the bus so multi-instance fleets converge too",
  );
});
await check("bustRecordCache hashes the token, applies via the shared helper, and broadcasts", () => {
  const start = proxySrc.indexOf("export function bustRecordCache(");
  assert.ok(start > 0, "bustRecordCache must exist in rmone-proxy.ts");
  const body = proxySrc.slice(start, start + 900);
  assert.match(body, /recordCacheTokenHash\(/, "must derive the hashed key suffix");
  assert.match(body, /bustRecordCacheLocal\(tokenHash\)/, "local apply must go through the shared helper");
  assert.match(
    body,
    /broadcastBust\(\{ type: "bustCache", fn: "recordToken", tokenHash \}\)/,
    "must broadcast the token-hash bust to sibling workers",
  );
  assert.ok(!/broadcastBust\([^)]*auth/i.test(body), "raw auth material must never ride the bus");
  const hashFn = proxySrc.indexOf("function recordCacheTokenHash(");
  assert.ok(hashFn > 0, "recordCacheTokenHash must exist");
  assert.match(
    proxySrc.slice(hashFn, hashFn + 500),
    /createHash\("sha256"\)/,
    "suffix must be a real hash, not a token substring",
  );
});
await check("cluster handler applies recordToken through the same local helper", () => {
  const handlerStart = proxySrc.indexOf("export function handleClusterMessage(");
  assert.ok(handlerStart > 0, "handleClusterMessage must exist");
  const caseAt = proxySrc.indexOf('case "recordToken"', handlerStart);
  assert.ok(caseAt > handlerStart, 'handleClusterMessage must have a "recordToken" case');
  assert.match(
    proxySrc.slice(caseAt, caseAt + 600),
    /bustRecordCacheLocal\(/,
    "IPC apply must route through bustRecordCacheLocal (same rule as the direct call)",
  );
});
await check("the field-save route's token-keyed bust rides the broadcast", () => {
  // /update-fields (the incident route) must still bust through
  // bustRecordCache — the broadcast lives INSIDE it, so every save-path call
  // site inherits sibling delivery without per-site wiring.
  const route = proxySrc.indexOf('router.post("/update-fields"');
  assert.ok(route > 0, "/update-fields route must exist");
  const nextRoute = proxySrc.indexOf("router.", route + 10);
  const routeBody = proxySrc.slice(route, nextRoute > 0 ? nextRoute : route + 4000);
  assert.match(routeBody, /bustRecordCache\(/, "field save must call bustRecordCache");
});

if (failures > 0) {
  console.error(`\ncheck-cache-bus: ${failures} failure(s)`);
  process.exit(1);
}
console.log("check-cache-bus: all checks passed");
