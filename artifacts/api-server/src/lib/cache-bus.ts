/**
 * Cross-INSTANCE cache bus — carries the cluster's cache-refresh IPC messages
 * across load-balanced API machines (the planned AWS Elastic Beanstalk move
 * runs 2+ instances per environment behind a load balancer).
 *
 * Today every write path invalidates per-worker in-memory caches through ONE
 * choke point: worker → process.send(msg) → primary relay (src/index.ts) →
 * every other worker's handleClusterMessage. That relay spans one machine
 * only. With 2+ instances, a save handled by instance A never refreshes
 * instance B, so B serves stale data until its TTLs expire.
 *
 * This module runs in the CLUSTER PRIMARY only and widens that same choke
 * point across machines:
 *   publish — every message the relay fans out locally is also (when
 *             whitelisted, see below) published to the shared channel;
 *   receive — messages published by OTHER instances are handed back to the
 *             primary, which forwards them verbatim to ALL local workers.
 *             They arrive in exactly the shape a local sibling would have
 *             sent, so every existing worker-side handler (bust cases, gen
 *             guards, adoption checks) works unchanged.
 *
 * Transports (resolveBusMode):
 *   redis — Redis pub/sub via CACHE_BUS_REDIS_URL (or REDIS_URL). Preferred
 *           for multi-instance deploys: ~ms latency, zero DB load.
 *   db    — polling fallback via dbo.rmone_cache_bus_events in the app DB.
 *           Auto-selected when INSTANCE_COUNT > 1 but no Redis URL is set.
 *           Latency ≈ CACHE_BUS_POLL_MS (default 2s).
 *   off   — single-instance / dev default: exactly today's behavior. No
 *           Redis, no polling, no new connections, zero new moving parts.
 *
 * Message policy (classifyBusMessage):
 *   bust  — bustCache / bustExtraFields / bustUsageAnalytics: the CORRECTNESS
 *           channel. Always forwarded (tiny, idempotent deletes).
 *   adopt — adoptCache / adoptUsageAnalytics: computed-payload sharing, an
 *           optimization. Forwarded subject to a per-transport size cap; a
 *           dropped adoption just means the other instance recomputes on its
 *           next request. Receive-side guards (fail-closed shape checks,
 *           post-bust staleness with skew slack, local in-flight wins) all
 *           live in the existing worker handlers and apply unchanged.
 *   warm  — warmHome / warmProjectHours / warmDemandProjects / noteHotProject:
 *           "go fetch it yourself" load hints. NOT forwarded by default —
 *           they multiply RDS query load by instance count (warm fan-out has
 *           starved RDS before), and cross-instance freshness is already
 *           guaranteed by busts + adoptions. CACHE_BUS_FORWARD_WARMS=1 opts in.
 *   skip  — cluster lifecycle messages (workerCrashed, reconcileDone) and
 *           anything unrecognized: strictly machine-local, never forwarded.
 *
 * Delivery is best-effort and at-least-once. Duplicates are harmless (busts
 * are idempotent; adoptions carry their own guards) and a dropped message
 * only means one instance serves until its cache TTL expires — the exact
 * backstop that exists today. That tolerance is what lets the DB poller use
 * an overlapping lookback window + id dedupe instead of a fragile
 * exactly-once watermark (identity order ≠ commit order under concurrency,
 * so `id > max(seen)` can permanently skip late-committing rows).
 */
import type { Redis as RedisClient } from "ioredis";
import {
  insertCacheBusEvent,
  fetchCacheBusEvents,
  purgeCacheBusEvents,
} from "@workspace/db";

export type CacheBusMode = "redis" | "db" | "off";

export interface CacheBus {
  readonly mode: CacheBusMode;
  /** Publish one relayed IPC message to sibling instances (no-op when the
   *  message is machine-local or the bus is off). Never throws. */
  publish(msg: unknown): void;
  /** Stop timers / close connections. Safe to call more than once. */
  stop(): Promise<void>;
}

type EnvLike = Record<string, string | undefined>;

// ── Mode resolution ──────────────────────────────────────────────────────────

export interface BusModeDecision {
  mode: CacheBusMode;
  redisUrl: string | null;
  reason: string;
}

/** Decide the transport from the environment. Dev/single-instance resolves to
 *  "off" so local behavior is byte-for-byte today's (no Redis required, no
 *  polling). Explicit CACHE_BUS=redis|db|off always wins. */
export function resolveBusMode(env: EnvLike = process.env): BusModeDecision {
  const explicit = (env["CACHE_BUS"] ?? "").trim().toLowerCase();
  const redisUrl = (env["CACHE_BUS_REDIS_URL"] || env["REDIS_URL"] || "").trim() || null;
  const instances = Math.max(1, Math.floor(Number(env["INSTANCE_COUNT"]) || 1));
  if (explicit === "off") return { mode: "off", redisUrl, reason: "CACHE_BUS=off" };
  if (explicit === "redis") {
    if (redisUrl) return { mode: "redis", redisUrl, reason: "CACHE_BUS=redis" };
    return {
      mode: "off",
      redisUrl: null,
      reason: "CACHE_BUS=redis but CACHE_BUS_REDIS_URL/REDIS_URL is unset — bus disabled",
    };
  }
  if (explicit === "db") return { mode: "db", redisUrl, reason: "CACHE_BUS=db" };
  if (redisUrl) return { mode: "redis", redisUrl, reason: "Redis URL configured" };
  if (instances > 1) {
    return { mode: "db", redisUrl, reason: `INSTANCE_COUNT=${instances} with no Redis URL — DB-polling fallback` };
  }
  return { mode: "off", redisUrl, reason: "single instance — local IPC only" };
}

// ── Message classification / envelope ────────────────────────────────────────

const BUST_TYPES = new Set(["bustCache", "bustExtraFields", "bustUsageAnalytics"]);
const ADOPT_TYPES = new Set(["adoptCache", "adoptUsageAnalytics"]);
const WARM_TYPES = new Set(["warmHome", "warmProjectHours", "warmDemandProjects", "noteHotProject"]);

export type BusMessageClass = "bust" | "adopt" | "warm" | "skip";

export function classifyBusMessage(msg: unknown): BusMessageClass {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return "skip";
  const t = (msg as { type?: unknown }).type;
  if (typeof t !== "string") return "skip";
  if (BUST_TYPES.has(t)) return "bust";
  if (ADOPT_TYPES.has(t)) return "adopt";
  if (WARM_TYPES.has(t)) return "warm";
  return "skip";
}

/** Adoption payload caps per transport. Senders already cap payload JSON at
 *  1.5 MB for local IPC; Redis carries that fine, but NVARCHAR(MAX) rows that
 *  big would make every 2s poll cycle expensive, so the DB transport keeps
 *  only small adoptions and lets receivers recompute the rest locally. */
export const REDIS_MAX_ENVELOPE_BYTES = 2_000_000;
export const DB_MAX_ENVELOPE_BYTES = 64_000;

export interface PublishOptions {
  mode: Exclude<CacheBusMode, "off">;
  origin: string;
  forwardWarms: boolean;
}

/** Serialize a relayed IPC message into a bus envelope, or return null when
 *  it must stay machine-local (lifecycle/unknown types, warms without the
 *  opt-in, adoptions over the transport's size cap). */
export function encodeForPublish(msg: unknown, opts: PublishOptions): string | null {
  const cls = classifyBusMessage(msg);
  if (cls === "skip") return null;
  if (cls === "warm" && !opts.forwardWarms) return null;
  let json: string;
  try {
    json = JSON.stringify({ v: 1, o: opts.origin, m: msg });
  } catch {
    return null; // unserializable — local IPC structured-clones more than JSON does
  }
  if (!json) return null;
  if (cls === "adopt") {
    const cap = opts.mode === "db" ? DB_MAX_ENVELOPE_BYTES : REDIS_MAX_ENVELOPE_BYTES;
    if (Buffer.byteLength(json, "utf8") > cap) return null;
  }
  return json;
}

/** Parse a bus envelope. Returns the inner IPC message, or null for our own
 *  echo (origin === selfOrigin), foreign versions, or malformed payloads. */
export function decodeEnvelope(raw: string, selfOrigin: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const e = parsed as { v?: unknown; o?: unknown; m?: unknown };
  if (e.v !== 1) return null;
  if (typeof e.o !== "string" || e.o.length === 0 || e.o === selfOrigin) return null;
  if (!e.m || typeof e.m !== "object" || Array.isArray(e.m)) return null;
  return e.m as Record<string, unknown>;
}

// ── DB-poller dedupe window ──────────────────────────────────────────────────

/** Sliding-window id dedupe for the at-least-once DB transport: the poll
 *  window overlaps between cycles on purpose, so most rows are read several
 *  times but must be applied once. Entries expire after ttlMs (longer than
 *  any possible lookback window). */
export class SeenIdWindow {
  private readonly seen = new Map<number, number>();
  constructor(private readonly ttlMs: number) {}

  /** True when the id is new (records it); false for an already-seen id. */
  check(id: number, nowMs = Date.now()): boolean {
    this.prune(nowMs);
    if (this.seen.has(id)) return false;
    this.seen.set(id, nowMs);
    return true;
  }

  prune(nowMs = Date.now()): void {
    for (const [id, at] of this.seen) {
      if (nowMs - at > this.ttlMs) this.seen.delete(id);
    }
  }

  get size(): number {
    return this.seen.size;
  }
}

// ── Rate-limited logging ─────────────────────────────────────────────────────
// A dead Redis or unreachable DB would otherwise log on every publish/poll.

const _lastWarnAt = new Map<string, number>();
function warnRateLimited(kind: string, e: unknown): void {
  const now = Date.now();
  if (now - (_lastWarnAt.get(kind) ?? 0) < 60_000) return;
  _lastWarnAt.set(kind, now);
  console.warn(`[cache-bus] ${kind}:`, e instanceof Error ? e.message : String(e));
}

// ── Bus construction (primary process only) ─────────────────────────────────

export interface StartCacheBusOptions {
  /** Unique identity of THIS instance on the bus (self-echo filter). */
  instanceId: string;
  /** Called with the inner IPC message for every event another instance
   *  published. The caller fans it out to all local workers. */
  onRemoteMessage: (msg: Record<string, unknown>) => void;
  env?: EnvLike;
}

export function startCacheBus(opts: StartCacheBusOptions): CacheBus {
  const env = opts.env ?? process.env;
  const decision = resolveBusMode(env);
  const forwardWarms = env["CACHE_BUS_FORWARD_WARMS"] === "1";

  if (decision.mode === "off") {
    console.log(`[cache-bus] off — ${decision.reason}`);
    return { mode: "off", publish: () => {}, stop: async () => {} };
  }

  const deliver = (m: Record<string, unknown>): void => {
    try {
      opts.onRemoteMessage(m);
    } catch (e) {
      warnRateLimited("deliver", e);
    }
  };

  // ── Redis pub/sub transport ────────────────────────────────────────────
  if (decision.mode === "redis" && decision.redisUrl) {
    const channel = (env["CACHE_BUS_CHANNEL"] || "").trim() || "rmone:cache-bus";
    console.log(`[cache-bus] redis pub/sub on channel "${channel}" — ${decision.reason}`);
    let stopped = false;
    let pub: RedisClient | null = null;
    let sub: RedisClient | null = null;
    // Envelopes published during the brief dynamic-import/connect window.
    // Bounded: beyond the cap we drop (TTL backstop) rather than queue forever.
    const pendingEarly: string[] = [];

    void (async () => {
      const { default: Redis } = await import("ioredis");
      const retryStrategy = (times: number): number => Math.min(30_000, 1_000 * 2 ** Math.min(times, 5));
      // Publisher: NO offline queue — while Redis is down we drop instead of
      // buffering unboundedly (a lost bust = stale until TTL, same as today
      // cross-instance; an unbounded queue = OOM risk in the primary).
      pub = new Redis(decision.redisUrl as string, {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy,
      });
      // Subscriber: offline queue ON so the initial SUBSCRIBE survives a
      // Redis that is briefly unreachable at boot; ioredis re-subscribes
      // automatically after every reconnect once the subscription is tracked.
      sub = new Redis(decision.redisUrl as string, {
        enableOfflineQueue: true,
        maxRetriesPerRequest: 1,
        retryStrategy,
      });
      pub.on("error", (e: Error) => warnRateLimited("redis-pub", e));
      sub.on("error", (e: Error) => warnRateLimited("redis-sub", e));
      sub.on("ready", () => console.log("[cache-bus] redis subscriber ready"));
      sub.on("message", (ch: string, raw: string) => {
        if (ch !== channel || stopped) return;
        const m = decodeEnvelope(String(raw), opts.instanceId);
        if (m) deliver(m);
      });
      void sub.subscribe(channel).catch((e: unknown) => warnRateLimited("redis-subscribe", e));
      if (stopped) return;
      for (const json of pendingEarly.splice(0)) {
        void pub.publish(channel, json).catch((e: unknown) => warnRateLimited("redis-publish", e));
      }
    })().catch((e) => {
      // Loud but non-fatal: the API keeps serving; only cross-instance
      // freshness degrades to TTL expiry (today's behavior).
      console.error(
        "[cache-bus] redis transport failed to start — cross-instance cache busts are NOT flowing:",
        e instanceof Error ? e.message : String(e),
      );
    });

    return {
      mode: "redis",
      publish(msg: unknown): void {
        if (stopped) return;
        const json = encodeForPublish(msg, { mode: "redis", origin: opts.instanceId, forwardWarms });
        if (!json) return;
        if (pub) {
          void pub.publish(channel, json).catch((e: unknown) => warnRateLimited("redis-publish", e));
        } else if (pendingEarly.length < 500) {
          pendingEarly.push(json);
        }
      },
      async stop(): Promise<void> {
        stopped = true;
        for (const c of [pub, sub]) {
          if (!c) continue;
          try {
            await c.quit();
          } catch {
            try { c.disconnect(); } catch { /* already gone */ }
          }
        }
        pub = null;
        sub = null;
      },
    };
  }

  // ── DB-polling transport ───────────────────────────────────────────────
  const pollMs = Math.min(30_000, Math.max(500, Number(env["CACHE_BUS_POLL_MS"]) || 2_000));
  console.log(
    `[cache-bus] DB polling dbo.rmone_cache_bus_events every ${pollMs}ms — ${decision.reason}`,
  );
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  // Dedupe TTL comfortably exceeds the max lookback (600s) + purge horizon.
  const seen = new SeenIdWindow(15 * 60_000);
  let lastOkPollAt = Date.now();
  let lastPurgeAt = Date.now();
  const POLL_BATCH = 500;

  const pollOnce = async (): Promise<void> => {
    const nowMs = Date.now();
    // Gap-aware window: normally 20s of overlap (vs 2s polls — every row is
    // seen ~10×, dedupe applies it once); after a DB outage or event-loop
    // stall the window widens to cover the silence, capped at 10 min (the
    // purge horizon — beyond that TTL expiry is the backstop).
    const gapSec = Math.ceil((nowMs - lastOkPollAt) / 1_000);
    const lookbackSec = Math.min(600, Math.max(20, gapSec + 10));
    let afterId = 0;
    for (let page = 0; page < 5; page++) {
      const rows = await fetchCacheBusEvents(opts.instanceId, lookbackSec, POLL_BATCH, afterId);
      for (const row of rows) {
        afterId = Math.max(afterId, row.id);
        if (!seen.check(row.id)) continue;
        const m = decodeEnvelope(row.payload, opts.instanceId);
        if (m) deliver(m);
      }
      if (rows.length < POLL_BATCH) break;
    }
    lastOkPollAt = Date.now();
    if (nowMs - lastPurgeAt > 5 * 60_000) {
      lastPurgeAt = nowMs;
      void purgeCacheBusEvents(15).catch((e: unknown) => warnRateLimited("db-purge", e));
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void pollOnce()
        .catch((e: unknown) => warnRateLimited("db-poll", e))
        .finally(schedule);
    }, pollMs);
    timer.unref();
  };
  schedule();

  return {
    mode: "db",
    publish(msg: unknown): void {
      if (stopped) return;
      const json = encodeForPublish(msg, { mode: "db", origin: opts.instanceId, forwardWarms });
      if (!json) return;
      void insertCacheBusEvent(opts.instanceId, json).catch((e: unknown) =>
        warnRateLimited("db-publish", e),
      );
    },
    async stop(): Promise<void> {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
