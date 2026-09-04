import cluster from "node:cluster";
import os from "node:os";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import app from "./app";
import { warmCacheOnStartup, handleClusterMessage } from "./routes/rmone-proxy.js";
import { startUptimeMonitor } from "./lib/uptime-monitor.js";
import { startAllocationIntegrityScan } from "./lib/allocation-integrity-scan.js";
import { startUsageRollup, flushUsageNow } from "./lib/usage-telemetry.js";
import { startAfSnapshotJob } from "./lib/actuals-forecast-job.js";
import { bootstrapDatabase, closeMssqlPool, markAppDbBootstrapped } from "@workspace/db";
import { startBackgroundIndexes, closeDbPool } from "./lib/db.js";

// Tarn pool-acquire timeouts surface as unhandled Promise rejections when
// concurrent requests exhaust all pool connections.  Without this handler
// Node.js 15+ promotes them to a fatal uncaughtException and kills the process.
// Log and continue — Express has already sent or will send a 5xx for each
// individual request; the server stays up and the pool self-heals on the next
// successful acquire.
process.on("unhandledRejection", (reason: unknown) => {
  console.error(
    "[unhandled-rejection]",
    reason instanceof Error ? reason.message : String(reason),
  );
});
import { startCacheBus, type CacheBus } from "./lib/cache-bus.js";

const rawPort = process.env["PORT"] ?? "5000";
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Cap at 4 workers. Per-worker DB pool size scales DOWN as worker count goes
// up (see lib/db.ts computePoolBudget) so the total connection budget against
// RDS stays ~POOL_BUDGET (default 200) for the WHOLE FLEET regardless of VM
// size — a VM upgrade must add CPU headroom, not DB load. When 2+ load-
// balanced instances share the DB (Elastic Beanstalk), set INSTANCE_COUNT on
// each so the budget also divides across machines. Keep this formula in
// lockstep with computePoolBudget in lib/db.ts.
// WORKERS env (deployment-settable) can cap the count further: fewer workers =
// more RAM headroom each (an import's plan-build can spike gigabytes).
const NUM_WORKERS = Math.max(1, Math.min(os.cpus().length, Number(process.env["WORKERS"]) || 4));

// ── Primary process ───────────────────────────────────────────────────────────
if (cluster.isPrimary) {
  // RESILIENT STARTUP: workers are spawned IMMEDIATELY so they start
  // listening on the port within ~1 s of process start.  The deploy health
  // probe (/api/healthz — DB-free) therefore always gets a 200 in time.
  //
  // DB bootstrap (idempotent IF-NOT-EXISTS DDL) runs in the background after
  // workers are up.  If RDS is intermittently unreachable at startup the
  // workers still serve; they pick up their own DB pool once connectivity
  // returns.  Workers forked with APPDB_BOOTSTRAPPED=0 each run the DDL
  // themselves on their first real DB call (safe — all statements are
  // IF-NOT-EXISTS / idempotent).
  const BOOT_TIMEOUT_MS = 40_000;
  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`bootstrap timed out after ${ms}ms`)), ms);
      p.then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); },
      );
    });
  let booted = false;

  // Track each worker's logical WORKER_ID so auto-restart can preserve it.
  // Without this, a respawned worker gets WORKER_ID=undefined and the
  // lead-worker gates (heartbeat scheduling, registry persistence, daily
  // alerts warm) can end up duplicated or dropped after a crash.
  const workerIds = new Map<number, number>();
  // Per-fork OWNER_TOKEN: a unique identity each worker stamps onto any import
  // job it runs (owner_token column via /run). On worker death the token
  // pinpoints exactly which running jobs are orphaned — see the exit handler.
  const workerTokens = new Map<number, string>();
  // APPDB_BOOTSTRAPPED=1 tells workers the schema DDL already ran in the
  // primary, so they can skip the ~30 s re-bootstrap on their first DB call.
  // We pass "0" here because workers start before bootstrap completes; the
  // background loop below flips booted=true for future *respawned* workers.
  const bootFlag = () => (booted ? "1" : "0");
  for (let i = 0; i < NUM_WORKERS; i++) {
    const token = randomUUID();
    const w = cluster.fork({ WORKER_ID: String(i), APPDB_BOOTSTRAPPED: bootFlag(), OWNER_TOKEN: token });
    workerIds.set(w.id, i);
    workerTokens.set(w.id, token);
  }
  console.log(`[startup] spawned ${NUM_WORKERS} worker(s) — bootstrapping DB in background`);

  // Crash-reconcile duties dispatched to a worker but not yet confirmed done.
  // A duty is added when a worker dies, sent to a survivor, and RE-sent on
  // every worker start/death (plus a 60s sweep) until some worker ACKs it
  // with a `reconcileDone` message. The DB write behind it is idempotent, so
  // duplicate dispatches are harmless. Without this, a double-death (both
  // workers OOMing ~30s apart — observed in prod 2026-08-07) hands the duty
  // to a sibling that dies before doing it, and the dead owner's jobs sit
  // "running" until the 15-min staleness backstop while the import popup
  // shows "processing" the whole time.
  const pendingReconciles = new Map<string, { workerId: number; lastSentAt: number }>();
  const dispatchPendingReconciles = () => {
    const nowMs = Date.now();
    for (const [token, duty] of pendingReconciles) {
      // In-flight throttle: 'exit', the replacement's 'listening', and the
      // 60s sweep can fire within moments of each other; without this,
      // several workers would run the same (idempotent, but not free)
      // reconcile concurrently during an OOM recovery.
      if (nowMs - duty.lastSentAt < 30_000) continue;
      for (const id in cluster.workers) {
        const w = cluster.workers[id];
        if (!w) continue;
        try {
          w.send({ type: "workerCrashed", workerId: duty.workerId, ownerToken: token });
          duty.lastSentAt = nowMs;
          break; // one recipient per duty is enough
        } catch { /* that one is dying too — try the next */ }
      }
    }
  };
  cluster.on("listening", () => dispatchPendingReconciles());
  cluster.on("message", (_sender, msg) => {
    const m = msg as Record<string, unknown>;
    if (m?.type === "reconcileDone" && typeof m["ownerToken"] === "string") {
      pendingReconciles.delete(m["ownerToken"] as string);
    }
  });
  setInterval(dispatchPendingReconciles, 60_000).unref();

  // Background bootstrap with unlimited retries + capped backoff.  Matters
  // for fresh databases; in production the DDL is always a no-op.
  const retryLoop = async () => {
    let delay = 0;
    let attempt = 0;
    for (;;) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      attempt++;
      try {
        await withTimeout(bootstrapDatabase(), BOOT_TIMEOUT_MS);
        booted = true;
        console.log(`[startup] database bootstrap OK (attempt ${attempt})`);
        // Tell the workers forked before this finished (APPDB_BOOTSTRAPPED=0)
        // that the schema is ready, so their first app-DB call skips the full
        // IF-NOT-EXISTS re-run instead of paying it once per worker.
        for (const w of Object.values(cluster.workers ?? {})) {
          try { w?.send({ type: "appdbBooted" }); } catch { /* worker mid-death — its respawn forks with flag "1" */ }
        }
        return;
      } catch (e) {
        console.error(`[startup] database bootstrap attempt ${attempt} failed:`, e);
        delay = Math.min((delay || 5_000) * 2, 5 * 60_000);
      }
    }
  };
  void retryLoop();

  const cacheBus: CacheBus = startCacheBus({
    instanceId: randomUUID(),
    onRemoteMessage: (msg) => {
      // A bust/adoption another instance relayed: hand it to ALL local
      // workers — relative to the remote sender, every one of them is an
      // "other worker". Same delivery shape as the local relay, so every
      // existing handleClusterMessage case applies unchanged.
      for (const id in cluster.workers) {
        const w = cluster.workers[id];
        if (!w) continue;
        try {
          w.send(msg);
        } catch {
          /* worker died mid-send — its replacement boots with empty caches */
        }
      }
    },
  });

  // Relay cache-bust IPC messages to every OTHER worker so in-memory Map
  // invalidations propagate across the cluster without needing Redis.
  // Each worker sends `process.send(msg)` when it busts a cache; the primary
  // receives it here and fans it out, then each other worker applies it via
  // handleClusterMessage.
  cluster.on("message", (sender, msg) => {
    for (const id in cluster.workers) {
      const w = cluster.workers[id];
      if (w && w !== sender) w.send(msg);
    }
    // Same single choke point, wider blast radius: publish to sibling
    // instances too (no-op when the bus is off; whitelist inside).
    cacheBus.publish(msg);
  });

  // Auto-restart dead workers so the cluster self-heals after OOM or crash.
  // Re-pass the SAME WORKER_ID so the replacement keeps the dead worker's
  // role (lead vs non-lead). Fallback to a non-lead id if the mapping is
  // somehow missing — a lapsed lead duty is safer than two leads.
  let shuttingDown = false;
  cluster.on("exit", (worker, code, signal) => {
    const wid = workerIds.get(worker.id) ?? 1;
    const deadToken = workerTokens.get(worker.id);
    workerIds.delete(worker.id);
    workerTokens.delete(worker.id);
    if (shuttingDown) {
      // Intentional shutdown — do NOT respawn. Exit once the last worker is gone.
      if (workerIds.size === 0) process.exit(0);
      return;
    }
    console.warn(
      `[cluster] worker pid=${worker.process.pid} (WORKER_ID=${wid}) died (code=${code} signal=${signal}) — restarting`,
    );
    // Ask a surviving worker to fail the import jobs the dead worker OWNED
    // (matched by its owner token — never a staleness sweep, which falsely
    // failed live runs on siblings whose best-effort heartbeat lapsed under
    // the same memory duress). The duty stays in pendingReconciles until a
    // worker ACKs it done: the first dispatch can land on a sibling dying of
    // the same OOM (observed: both workers died ~30s apart), so it is re-sent
    // on every worker start/death + a 60s sweep until confirmed.
    if (deadToken) {
      pendingReconciles.set(deadToken, { workerId: wid, lastSentAt: 0 });
    }
    dispatchPendingReconciles();
    const replToken = randomUUID();
    const replacement = cluster.fork({ WORKER_ID: String(wid), APPDB_BOOTSTRAPPED: bootFlag(), OWNER_TOKEN: replToken });
    workerIds.set(replacement.id, wid);
    workerTokens.set(replacement.id, replToken);
  });

  // Graceful shutdown: forward the signal to every worker so each closes its
  // DB pools before exit. Without this, every restart/deploy stranded hundreds
  // of sleeping sessions on SQL Server; they accumulated (observed 3,500+) and
  // slowed new logins into connect-timeout storms.
  const shutdownPrimary = (sig: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[cluster] ${sig} received — stopping ${workerIds.size} worker(s)`);
    // Stop the cross-instance bus first: no point publishing or polling
    // while our own workers are draining, and the DB-mode poller must not
    // keep the primary's app-DB pool busy during exit.
    void cacheBus.stop().catch(() => {});
    void closeMssqlPool().catch(() => {});
    // process.kill delivers the signal immediately; worker.kill() would go
    // through IPC disconnect first, which waits on the worker's open servers
    // and can delay/skip delivery when only the primary was signalled.
    for (const id in cluster.workers) {
      try { cluster.workers[id]?.process.kill(sig); } catch { /* already dead */ }
    }
    // Hard-exit fallback if a worker hangs — stay well under the platform's
    // SIGKILL deadline.
    setTimeout(() => process.exit(0), 8_000).unref();
  };
  process.on("SIGTERM", () => shutdownPrimary("SIGTERM"));
  process.on("SIGINT", () => shutdownPrimary("SIGINT"));

// ── Worker process ────────────────────────────────────────────────────────────
} else {
  const workerId = Number(process.env["WORKER_ID"] ?? "1");
  // Only one worker runs the one-off startup jobs to avoid duplicate work.
  const isLeadWorker = workerId === 0;

  // Apply cache-bust messages broadcast by the primary from other workers.
  // Also handle workerCrashed: the primary sends this to exactly ONE surviving
  // worker, which immediately fails any import jobs whose owner was killed
  // (instead of waiting the 15-min staleness gate). Deliberately NOT gated on
  // the lead worker: when the lead itself dies, any survivor must be able to
  // pick up the duty.
  process.on("message", (msg) => {
    const m = msg as Record<string, unknown>;
    if (m?.type === "appdbBooted") {
      // Primary finished the schema DDL after this worker was forked with
      // APPDB_BOOTSTRAPPED=0 — skip the per-worker re-run on first app-DB call.
      markAppDbBootstrapped();
      return;
    }
    if (m?.type === "workerCrashed") {
      const deadId = m.workerId;
      const deadToken = typeof m["ownerToken"] === "string" ? (m["ownerToken"] as string) : null;
      if (deadToken) {
        console.warn(`[onboarding] worker ${deadId} crashed — failing only jobs owned by its token`);
        // Owner-scoped: fails ONLY jobs stamped with the dead worker's token.
        // Live imports owned by other processes/instances are untouchable here
        // — the old global 3-min staleness sweep falsely failed them whenever
        // their best-effort heartbeat lapsed under memory duress, and the
        // still-running pipeline then kept writing as a zombie.
        // Routed through the onboarding module so create-mode residue is ALSO
        // rolled back — a worker can die between cancel/failure detection and
        // its finalization rollback, stranding partial rows (observed under
        // OOM). Dynamic import: only workers ever run this handler, and the
        // module is already loaded in every worker.
        import("./routes/onboarding.js")
          .then(m => m.reconcileCrashedWorkerJobs(deadId, deadToken))
          // ACK so the primary stops re-dispatching this duty. Sent ONLY when
          // every step verifiably completed — an incomplete reconcile (DB blip
          // during the owner-fail UPDATE, failed rollback) stays pending and
          // is re-dispatched until it fully lands.
          .then((ok) => {
            if (!ok) { console.warn("[onboarding] crash-reconcile incomplete — leaving duty pending for retry"); return; }
            try { process.send?.({ type: "reconcileDone", ownerToken: deadToken }); } catch { /* primary gone */ }
          })
          .catch(e => console.warn("[onboarding] crash-reconcile failed:", (e as Error).message));
      } else {
        // No token in the message (shouldn't happen) — deliberately do NOTHING
        // immediate: the 15-min boot reconcile remains the backstop for true
        // orphans, and a global short-staleness sweep is exactly the false-fail
        // bug this handler replaces.
        console.warn(`[onboarding] worker ${deadId} crashed with no owner token — leaving its jobs to the 15-min boot reconcile`);
      }
    }
    handleClusterMessage(msg);
  });

  // Optional in-process TLS termination. Set both TLS_CERT_PATH and TLS_KEY_PATH
  // and the same port serves HTTPS instead of HTTP.
  const tlsCertPath = process.env["TLS_CERT_PATH"];
  const tlsKeyPath  = process.env["TLS_KEY_PATH"];

  if ((tlsCertPath && !tlsKeyPath) || (!tlsCertPath && tlsKeyPath)) {
    throw new Error("TLS_CERT_PATH and TLS_KEY_PATH must both be set, or both unset.");
  }

  function onListening() {
    console.log(`[worker-${workerId}] listening on port ${port}`);
    // EVERY worker warms up: each worker has its own DB pool, keep-alive
    // heartbeat and in-memory caches, so gating this behind isLeadWorker left
    // the other worker(s) with cold pools (NAT drops idle sockets after ~350s)
    // and cold caches — and home traffic is round-robined across all workers.
    setTimeout(() => warmCacheOnStartup(), 2000);
    if (isLeadWorker) {
      // One-off jobs stay lead-only to avoid duplicate work.
      startUptimeMonitor(port);
      startBackgroundIndexes();
      // Nightly DRY-RUN junk-allocation scan (deployment-only; lead-only so
      // one worker owns the schedule — findings surface via logs + the
      // superadmin /integrity-scan endpoint, never auto-deleted).
      startAllocationIntegrityScan();
      // Usage telemetry (#482): hourly rollup of raw events into daily
      // aggregates (deployment-only unless USAGE_ROLLUP_IN_DEV=1).
      startUsageRollup();
      // Actuals vs Forecast: hourly point-in-time snapshots (production-gated,
      // applock-serialized across instances; AF_SNAPSHOT_JOB=on for dev).
      startAfSnapshotJob();
    }
  }

  const server =
    tlsCertPath && tlsKeyPath
      ? https
          .createServer(
            { cert: fs.readFileSync(tlsCertPath), key: fs.readFileSync(tlsKeyPath) },
            app,
          )
          .listen(port, onListening)
      : app.listen(port, onListening);

  server.timeout        = 300_000;
  server.keepAliveTimeout = 120_000;
  server.headersTimeout   = 125_000;

  // Graceful shutdown: close DB pools so SQL Server releases this worker's
  // sessions immediately instead of holding them as sleeping connections
  // until keep-alive expiry. Stranded sessions from ungraceful restarts
  // accumulated to 3,500+ and caused login-timeout storms in production.
  let workerShuttingDown = false;
  const shutdownWorker = (sig: NodeJS.Signals) => {
    if (workerShuttingDown) return;
    workerShuttingDown = true;
    console.log(`[worker-${workerId}] ${sig} received — closing server and DB pools`);
    server.close(() => { /* stop accepting new requests */ });
    // Hard-exit fallback if a pool close hangs (e.g. DB unreachable).
    setTimeout(() => process.exit(0), 5_000).unref();
    // Drain buffered usage telemetry BEFORE closing pools — otherwise every
    // deploy silently loses the final ≤5s of recorded events. flushUsageNow
    // never throws; the 5s hard-exit fallback above bounds a hung flush.
    void Promise.allSettled([flushUsageNow()])
      .then(() => Promise.allSettled([closeDbPool(), closeMssqlPool()]))
      .then(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdownWorker("SIGTERM"));
  process.on("SIGINT", () => shutdownWorker("SIGINT"));
}
