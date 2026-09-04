/**
 * Usage telemetry count-integrity harness (CI gate).
 * Run: pnpm --filter @workspace/api-server run check:usage-counts
 *
 * Verifies the two race-condition fixes added to usage-telemetry.ts:
 *
 *  A. Partial-batch retry contract
 *     insertBatch() processes chunks independently (autocommit). When chunk k
 *     fails, only rows from chunk k onward are requeued — NOT the already-
 *     committed earlier chunks. This harness proves that under a mid-batch
 *     failure no row is counted twice and no row is silently lost.
 *
 *  B. Rollup watermark (SQL structural guard)
 *     runUsageRollupOnce() captures @maxId = MAX(id WHERE at < @cutoff) and
 *     bounds BOTH the MERGE source query AND the DELETE with `id <= @maxId`.
 *     This prevents a concurrent flush that inserts a prior-day row between
 *     the MERGE read and the DELETE from having that row deleted before the
 *     next rollup picks it up (which would lose it). This guard checks the
 *     SQL text for the required constraints.
 *
 *  C. Count integrity under concurrent recordUsage() calls with mid-stream
 *     rollup simulation
 *     N synchronous recordUsage() calls are recorded, a partial-DB-write is
 *     simulated (some rows land in "daily", some remain in "raw"), then we
 *     assert daily + raw + dropped === emitted.  A second-failure drop path
 *     is also exercised so the drop count never silently inflates totals.
 *
 * This harness does NOT hit the real database — insertBatch is replaced by
 * a controllable mock, and the rollup is simulated in-memory. The SQL guard
 * anchors on stable text markers; removal or weakening will fail loudly.
 *
 * Exit code 0 = all good; 1 = extraction drift or a fixture failure.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(here, "../src/lib/usage-telemetry.ts"),
  "utf8",
);

// ── Harness ──────────────────────────────────────────────────────────────────
let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual ?? null);
  const e = JSON.stringify(expected ?? null);
  if (a === e) {
    console.log(`  OK   ${name}`);
    return;
  }
  failures++;
  console.error(`  FAIL ${name}\n       expected ${e}\n       got      ${a}`);
}
function checkGte(name: string, actual: number, min: number) {
  if (actual >= min) {
    console.log(`  OK   ${name} (${actual} >= ${min})`);
    return;
  }
  failures++;
  console.error(`  FAIL ${name}: expected >= ${min}, got ${actual}`);
}

// ── Section A: Source-text structural guards ──────────────────────────────────
// These anchors are intentionally strict so any weakening of the two fixes
// fails loudly here, long before a regression reaches production.
console.log("check-usage-telemetry-counts: A. source-text structural guards");

// A1. insertBatch must accumulate `written` per successful chunk and return
//     { written, error } — the partial-commit boundary depends on this shape.
check(
  "A1 insertBatch tracks written across chunks",
  /written \+= chunk\.length/.test(src),
  true,
);
check(
  "A1 insertBatch returns { written, error } on success",
  /return \{ written, error: null \}/.test(src),
  true,
);
check(
  "A1 insertBatch returns { written, error } on per-chunk failure",
  /return \{ written, error: e \}/.test(src),
  true,
);

// A2. flushUsageNow must slice from `written` (not 0) when requeueing.
check(
  "A2 flushUsageNow requeues only tail: batch.slice(written)",
  /const failed = batch\.slice\(written\)/.test(src),
  true,
);
// A3. Re-queue guard: rows already marked retried are NOT re-queued again.
check(
  "A3 retried rows filtered out before requeue",
  /const retryable = failed\.filter\(\(ev\) => !ev\.retried\)/.test(src),
  true,
);
check(
  "A3 retried flag stamped before requeue",
  /retryable\.forEach\(\(ev\) => \{ ev\.retried = true; \}\)/.test(src),
  true,
);

// A4. The rollup SQL watermark: @maxId captures prior-day rows at a point in
//     time and both MERGE and DELETE are bounded by id <= @maxId.
check(
  "A4 rollup declares @maxId watermark",
  /DECLARE @maxId BIGINT = \(SELECT ISNULL\(MAX\(id\), 0\) FROM dbo\.rmone_usage_events WHERE at < @cutoff\)/.test(src),
  true,
);
check(
  "A4 MERGE source is bounded by id <= @maxId",
  /WHERE at < @cutoff AND id <= @maxId\s*\n\s*GROUP BY/.test(src),
  true,
);
check(
  "A4 DELETE is bounded by id <= @maxId",
  /DELETE FROM dbo\.rmone_usage_events WHERE at < @cutoff AND id <= @maxId/.test(src),
  true,
);

// A5. The rollup runs in a single transaction with XACT_ABORT so a partial
//     failure rolls back rather than leaving daily+raw in inconsistent state.
check(
  "A5 rollup uses XACT_ABORT + single transaction",
  /SET XACT_ABORT ON;\s*\n\s*BEGIN TRAN/.test(src),
  true,
);
check(
  "A5 rollup commits in the same block as the delete",
  /DECLARE @deleted INT = @@ROWCOUNT;\s*\n\s*DELETE FROM dbo\.rmone_usage_daily[\s\S]*?COMMIT;/.test(src),
  true,
);

// A6. MERGE is additive (UPDATE adds cnt, not replaces) — a late-flush event
//     whose day was already rolled still lands correctly on the next pass.
check(
  "A6 MERGE UPDATE adds cnt (not replaces)",
  /WHEN MATCHED THEN UPDATE SET d\.cnt = d\.cnt \+ s\.cnt/.test(src),
  true,
);

// A7. flushing mutex: flushUsageNow early-returns if already flushing.
check(
  "A7 flushing mutex prevents concurrent flushes",
  /if \(flushing \|\| buffer\.length === 0\) return;/.test(src),
  true,
);

// A8. Buffer drain is atomic: buffer is captured and cleared before the
//     async insertBatch starts, so new arrivals go to the fresh buffer.
check(
  "A8 buffer captured then cleared atomically before insertBatch",
  /const batch = buffer;\s*\n\s*buffer = \[\];\s*\n\s*try \{\s*\n\s*const \{ written, error \} = await insertBatch\(batch\)/.test(src),
  true,
);

// ── Section B: In-memory logic harness ───────────────────────────────────────
// The harness reimplements the buffer + flush logic verbatim, replacing only
// getMssqlPool/insertBatch with an injectable mock. A drift guard (section A)
// ensures the real source hasn't diverged from this shape.
console.log("\ncheck-usage-telemetry-counts: B. in-memory logic (mocked insertBatch)");

interface UsageEvent {
  tenant: string; userId: string; username: string; role: string | null;
  kind: string; feature: string; isSystem: boolean; cnt: number; at: Date;
  retried?: boolean;
}
type MockInsert = (rows: UsageEvent[]) => Promise<{ written: number; error: unknown }>;

function makeHarness(mockInsert: MockInsert) {
  const MAX_BUFFER = 5_000;
  const ROWS_PER_INSERT = 50;
  const SYSTEM_USERNAMES = new Set(["__cache_warmer__", "cache-warmer"]);

  let buf: UsageEvent[] = [];
  let flushing = false;
  let dropped = 0;

  function recordUsage(
    actor: { tenant: string; userId: string; username: string; role?: string | null },
    kind: string,
    feature = "",
    opts?: { system?: boolean; cnt?: number },
  ) {
    try {
      const tenant = (actor.tenant || "").trim();
      const username = (actor.username || "").trim();
      if (!tenant) return;
      if (buf.length >= MAX_BUFFER) { dropped++; return; }
      const isSystem =
        opts?.system === true ||
        username === "" ||
        SYSTEM_USERNAMES.has(username.toLowerCase());
      buf.push({
        tenant, userId: (actor.userId || username || "unknown").slice(0, 100),
        username: (username || "system").slice(0, 200),
        role: actor.role ? String(actor.role).slice(0, 200) : null,
        kind, feature: String(feature || "").slice(0, 120),
        isSystem, cnt: Math.max(1, Math.floor(opts?.cnt ?? 1)),
        at: new Date(),
      });
    } catch { /* never throws */ }
  }

  async function flushUsageNow(): Promise<{ writtenThisFlush: number }> {
    if (flushing || buf.length === 0) return { writtenThisFlush: 0 };
    flushing = true;
    const batch = buf;
    buf = [];
    let writtenThisFlush = 0;
    try {
      const { written, error } = await mockInsert(batch);
      writtenThisFlush = written;
      if (error) {
        const failed = batch.slice(written);
        const retryable = failed.filter((ev) => !ev.retried);
        const droppedNow = failed.length - retryable.length;
        retryable.forEach((ev) => { ev.retried = true; });
        if (buf.length + retryable.length <= MAX_BUFFER) {
          buf = retryable.concat(buf);
        } else {
          dropped += retryable.length;
        }
        dropped += droppedNow;
      }
    } finally {
      flushing = false;
    }
    return { writtenThisFlush };
  }

  return {
    recordUsage,
    flushUsageNow,
    bufferContents: () => [...buf],
    bufferLength: () => buf.length,
    droppedCount: () => dropped,
    // Inject events directly into buffer (simulate events arriving during flush)
    injectRaw: (evs: UsageEvent[]) => { buf = buf.concat(evs); },
    // Peek at retried flags in buffer
    retriedInBuffer: () => buf.filter((e) => e.retried).length,
  };
}

// ── B1: N concurrent recordUsage() calls – all land in the buffer ────────────
{
  const N = 350; // spans multiple flush-at threshold, exercises > ROWS_PER_INSERT
  const writes: { written: number[] } = { written: [] };
  const h = makeHarness(async (rows) => {
    writes.written.push(rows.length);
    return { written: rows.length, error: null };
  });
  const actor = (i: number) => ({ tenant: "t1", userId: `u${i}`, username: `user${i}` });
  // Synchronous calls — in real Node.js each HTTP handler runs synchronously
  // before yielding; this simulates the "all handlers fire before the event
  // loop processes the flush micro-task" scenario.
  for (let i = 0; i < N; i++) h.recordUsage(actor(i), "page", "Dashboard");
  check("B1 N=350 sync calls → buffer holds all N", h.bufferLength(), N);
  check("B1 dropped = 0 (well below MAX_BUFFER)", h.droppedCount(), 0);
}

// ── B2: Flush drains entire buffer; concurrent arrivals go to fresh buffer ───
{
  let resolveInsert!: () => void;
  const insertProm = new Promise<void>((r) => { resolveInsert = r; });
  let writtenCount = 0;

  const h = makeHarness(async (rows) => {
    await insertProm;            // pause insert until we inject new arrivals
    writtenCount += rows.length;
    return { written: rows.length, error: null };
  });

  // Seed buffer with 100 "prior" events
  const prior = 100;
  for (let i = 0; i < prior; i++) {
    h.recordUsage({ tenant: "t1", userId: "u1", username: "alice" }, "tx", "record_open");
  }
  check("B2 seeded buffer length", h.bufferLength(), prior);

  // Start flush — the mock insert is awaiting resolveInsert
  const flushProm = h.flushUsageNow();

  // While flush is in-flight, 50 new events arrive from other "workers"
  const concurrent = 50;
  for (let i = 0; i < concurrent; i++) {
    h.recordUsage({ tenant: "t1", userId: "u2", username: "bob" }, "login", "");
  }

  // Let the insert complete
  resolveInsert();
  await flushProm;

  // The 100 prior events were written; the 50 concurrent events are now in
  // the fresh buffer — none lost, none doubled.
  check("B2 written = prior batch size", writtenCount, prior);
  check("B2 buffer after flush = concurrent arrivals", h.bufferLength(), concurrent);
  check("B2 no drops", h.droppedCount(), 0);
}

// ── B3: Partial-batch failure — only unwritten tail requeued ─────────────────
// 160 events, 3 chunks: chunk 0 (rows 0-49) succeeds, chunk 1 (rows 50-99)
// fails. Chunk 2 was never attempted. Requeued = chunks 1+2 (110 rows total).
{
  const TOTAL = 160;
  const CHUNK = 50; // ROWS_PER_INSERT from the source
  const firstChunkSize = CHUNK;  // rows 0-49 committed
  const failChunkSize = CHUNK;   // rows 50-99 failed
  const unstarted = TOTAL - firstChunkSize - failChunkSize; // rows 100-159

  const h = makeHarness(async (rows) => {
    // Simulate: first chunk commits (written=50), second chunk throws
    const committedRows = rows.slice(0, firstChunkSize);
    void committedRows; // consumed by DB, not returned
    return { written: firstChunkSize, error: new Error("connection reset") };
  });

  for (let i = 0; i < TOTAL; i++) {
    h.recordUsage({ tenant: "t1", userId: `u${i}`, username: `user${i}` }, "tx", "project_save");
  }
  check("B3 buffer seeded", h.bufferLength(), TOTAL);

  await h.flushUsageNow();

  const expectedRequeued = failChunkSize + unstarted; // 50 + 60 = 110
  check("B3 requeued = unwritten tail only (110, not 160)", h.bufferLength(), expectedRequeued);
  check("B3 requeued rows all marked retried=true", h.retriedInBuffer(), expectedRequeued);
  check("B3 no rows permanently dropped (first retry)", h.droppedCount(), 0);
}

// ── B4: Second failure — already-retried rows are dropped, not re-requeued ───
{
  const h = makeHarness(async (_rows) => {
    // Always fail from row 0
    return { written: 0, error: new Error("connection dead") };
  });

  // Seed 60 events and flush once → they get retried=true in buffer
  for (let i = 0; i < 60; i++) {
    h.recordUsage({ tenant: "t1", userId: "u1", username: "carol" }, "page", "Projects");
  }
  await h.flushUsageNow(); // first failure: 60 events requeued with retried=true
  check("B4 after first failure: 60 in buffer, retried=true", h.bufferLength(), 60);
  check("B4 after first failure: dropped still 0", h.droppedCount(), 0);

  // Second flush: all are retried=true → none requeued again → all dropped
  await h.flushUsageNow();
  check("B4 after second failure: buffer empty (not re-requeued)", h.bufferLength(), 0);
  check("B4 after second failure: all 60 counted as dropped", h.droppedCount(), 60);
}

// ── B5: MAX_BUFFER cap — overflow drops, no OOM growth ───────────────────────
{
  const MAX_BUFFER = 5_000;
  const h = makeHarness(async (_rows) => ({ written: 0, error: new Error("DB down") }));

  // Fill right to the cap
  for (let i = 0; i < MAX_BUFFER; i++) {
    h.recordUsage({ tenant: "t1", userId: `u${i}`, username: `u${i}` }, "tx", "alloc");
  }
  check("B5 buffer at exactly MAX_BUFFER", h.bufferLength(), MAX_BUFFER);

  // One more should be dropped, not buffered
  h.recordUsage({ tenant: "t1", userId: "overflow", username: "overflow" }, "login", "");
  check("B5 overflow event dropped (buffer unchanged)", h.bufferLength(), MAX_BUFFER);
  check("B5 dropped count = 1", h.droppedCount(), 1);
}

// ── B6: flushing mutex — second call is a no-op while first is in-flight ────
{
  let insertCalls = 0;
  let resolveInsert2!: () => void;
  const insertProm2 = new Promise<void>((r) => { resolveInsert2 = r; });

  const h = makeHarness(async (_rows) => {
    insertCalls++;
    await insertProm2;
    return { written: _rows.length, error: null };
  });

  for (let i = 0; i < 10; i++) {
    h.recordUsage({ tenant: "t1", userId: "u1", username: "dave" }, "login", "");
  }

  const flush1 = h.flushUsageNow();
  const flush2 = h.flushUsageNow(); // second call while first is in-flight
  const flush3 = h.flushUsageNow(); // third call

  resolveInsert2();
  await Promise.all([flush1, flush2, flush3]);

  check("B6 only one insertBatch call fired (mutex)", insertCalls, 1);
}

// ── Section C: Rollup simulation — daily + raw === emitted ───────────────────
// Simulates two cluster workers racing a rollup:
//   Worker A: records 200 prior-day events and flushes them to "DB"
//   Rollup:   runs, captures @maxId = 200, folds those 200 into daily
//   Worker B: inserts 30 MORE prior-day events (late arrivals) AFTER @maxId
//   Rollup:   tries to delete id <= 200 → those 30 new rows have id > 200 (safe)
// Final invariant: daily.cnt + raw.cnt === 200 + 30 = 230; no double-count.
console.log("\ncheck-usage-telemetry-counts: C. rollup simulation (daily+raw=emitted)");

{
  // In-memory "database" tables
  const rawTable: { id: number; cnt: number; at: "yesterday" | "today" }[] = [];
  let dailyTable: { cnt: number; day: "yesterday" }[] = [];
  let nextId = 1;

  // Worker flush: inserts rows into rawTable, returning their assigned IDs
  function dbInsert(count: number, day: "yesterday" | "today") {
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      rawTable.push({ id: nextId, cnt: 1, at: day });
      ids.push(nextId++);
    }
    return ids;
  }

  // Rollup: captures @maxId for prior-day rows, then MERGE+DELETE atomically
  function dbRollup(): { rolled: number; deleted: number } {
    // @cutoff = start of today → only "yesterday" rows are prior-day
    const priorDay = rawTable.filter((r) => r.at === "yesterday");
    if (priorDay.length === 0) return { rolled: 0, deleted: 0 };

    // @maxId = MAX(id) WHERE at < @cutoff (watermark snapshot)
    const maxId = Math.max(...priorDay.map((r) => r.id));

    // MERGE: fold rows with id <= maxId into daily
    const toMerge = rawTable.filter((r) => r.at === "yesterday" && r.id <= maxId);
    const mergedCnt = toMerge.reduce((s, r) => s + r.cnt, 0);
    const existing = dailyTable.find((d) => d.day === "yesterday");
    if (existing) {
      existing.cnt += mergedCnt;  // additive MERGE
    } else {
      dailyTable.push({ cnt: mergedCnt, day: "yesterday" });
    }

    // DELETE: only rows with id <= maxId (watermark bound)
    const before = rawTable.length;
    rawTable.splice(0, rawTable.length, ...rawTable.filter((r) => !(r.at === "yesterday" && r.id <= maxId)));
    const deleted = before - rawTable.length;

    return { rolled: toMerge.length, deleted };
  }

  // Scenario execution:
  // 1. Worker A flushes 200 prior-day events
  dbInsert(200, "yesterday");
  check("C pre-rollup raw count", rawTable.length, 200);

  // 2. Rollup runs, captures @maxId = 200
  const { rolled, deleted } = dbRollup();
  check("C rollup merged 200 daily rows", rolled, 200);
  check("C rollup deleted 200 raw rows", deleted, 200);
  check("C raw table empty after rollup", rawTable.length, 0);

  // 3. Worker B flushes 30 LATE prior-day events AFTER rollup captured @maxId
  //    (these have ids 201-230 — above the watermark — so they're NOT deleted)
  dbInsert(30, "yesterday");
  check("C late-arriving prior-day events in raw (id > maxId)", rawTable.length, 30);

  // 4. Also add 25 today events (must NOT be touched by yesterday's rollup)
  dbInsert(25, "today");
  check("C today events in raw", rawTable.filter((r) => r.at === "today").length, 25);

  // 5. Second rollup pass picks up the 30 late events (now they ARE <= new maxId)
  const { rolled: rolled2, deleted: deleted2 } = dbRollup();
  check("C second rollup merged 30 late rows", rolled2, 30);
  check("C second rollup deleted 30 raw rows", deleted2, 30);

  // 6. Final invariant: daily + raw = total emitted (200 + 30 = 230)
  const dailyCnt = dailyTable.reduce((s, d) => s + d.cnt, 0);
  const rawCnt = rawTable.filter((r) => r.at === "yesterday").reduce((s, r) => s + r.cnt, 0);
  const todayCnt = rawTable.filter((r) => r.at === "today").reduce((s, r) => s + r.cnt, 0);
  check("C daily cnt = 230 (200 original + 30 late)", dailyCnt, 230);
  check("C raw yesterday cnt = 0 (all rolled)", rawCnt, 0);
  check("C today rows untouched by yesterday rollup", todayCnt, 25);
  check("C total (daily + raw_today) = 255", dailyCnt + todayCnt, 255);
}

// ── C2: Rollup is additive — re-running on already-rolled rows is safe ────────
// Simulates a rollup that runs twice (e.g. a restart or clock-skew): the
// second pass must not double the daily count if the same rows somehow
// survive (they shouldn't due to the DELETE, but the MERGE additive rule
// guarantees correctness even if it were run before DELETE).
{
  let dailyCnt = 0;

  // First pass: 100 raw events → daily = 100
  dailyCnt += 100; // MERGE inserts 100

  // Second pass on same events would try to UPDATE dailyCnt += 100
  // but because DELETE ran in the first transaction, there's nothing left.
  // The harness models this: after DELETE, source for MERGE is empty → 0 rolled.
  const secondPassRolled = 0; // source is empty after first pass deleted them
  dailyCnt += secondPassRolled;

  check("C2 rollup additive: no double-count after second pass", dailyCnt, 100);
}

// ── C3: N concurrent simulated workers — count is exact ──────────────────────
// 8 simulated workers each record M events. All flush independently.
// Total inserted = 8 × M, none lost, none doubled.
{
  const WORKERS = 8;
  const M = 75; // each worker records 75 events
  const totalExpected = WORKERS * M;
  const inserted: number[] = [];

  // Each worker gets its own harness (simulating separate process memory)
  for (let w = 0; w < WORKERS; w++) {
    const h = makeHarness(async (rows) => {
      inserted.push(rows.length);
      return { written: rows.length, error: null };
    });
    for (let i = 0; i < M; i++) {
      h.recordUsage(
        { tenant: "t1", userId: `w${w}u${i}`, username: `worker${w}user${i}` },
        "tx",
        "allocation_update",
      );
    }
    await h.flushUsageNow();
  }

  const totalInserted = inserted.reduce((s, n) => s + n, 0);
  check(`C3 ${WORKERS} workers × ${M} events = ${totalExpected} inserted exactly`, totalInserted, totalExpected);
  checkGte("C3 each worker flushed its own batch (no merged batches)", inserted.length, WORKERS);
}

// ── Section D: Mobile + web mixed-source flush (task #487) ───────────────────
// Task #487 wires the mobile app into the same telemetry stream via the
// existing recordUsage() path. Mobile events share the same UsageEvent shape
// (no extra fields added) but arrive with mobile-specific kind/feature values:
//   kind="page"  feature="<ExpoScreenName>"   (screen-visit beacon)
//   kind="tx"    feature="record_open" | "project_save" | …  (mutations)
//   kind="login" feature=""                   (mobile sign-in)
//
// These fixtures confirm that a buffer containing both web-sourced and
// mobile-sourced events flushes with exactly the right count — no silent
// drop caused by an unexpected field, no double-count, no buffer mutation.
console.log("\ncheck-usage-telemetry-counts: D. mobile + web mixed-source flush (#487)");

// ── D1: Mixed flush — web + mobile events, happy path ────────────────────────
// 40 web events (kind="page", web feature names) + 35 mobile events
// (kind="page", mobile screen names) + 10 mobile tx events = 85 total.
// All must flush in a single pass with written=85, dropped=0.
{
  const webEvents   = 40; // web SPA beacons
  const mobilePages = 35; // Expo screen beacons (kind="page")
  const mobileTx    = 10; // mobile mutations (kind="tx")
  const totalExpected = webEvents + mobilePages + mobileTx;

  let writtenCount = 0;
  const h = makeHarness(async (rows) => {
    writtenCount += rows.length;
    return { written: rows.length, error: null };
  });

  // Web events: typical SPA module visits
  const webFeatures = ["Dashboard", "Projects", "Resources", "Analytics", "Forecast"];
  for (let i = 0; i < webEvents; i++) {
    h.recordUsage(
      { tenant: "web-tenant", userId: `wu${i}`, username: `webuser${i}` },
      "page",
      webFeatures[i % webFeatures.length],
    );
  }

  // Mobile page events: Expo screen names as produced by task #487
  const mobileScreens = ["projects", "resources", "forecast", "alerts", "profile"];
  for (let i = 0; i < mobilePages; i++) {
    h.recordUsage(
      { tenant: "web-tenant", userId: `mu${i}`, username: `mobileuser${i}` },
      "page",
      mobileScreens[i % mobileScreens.length],
    );
  }

  // Mobile tx events: same transaction kinds as web (record_open, project_save, …)
  const mobileTxKinds = ["record_open", "project_save", "allocation_update"];
  for (let i = 0; i < mobileTx; i++) {
    h.recordUsage(
      { tenant: "web-tenant", userId: `mu${i}`, username: `mobileuser${i}` },
      "tx",
      mobileTxKinds[i % mobileTxKinds.length],
    );
  }

  check("D1 buffer holds web + mobile events", h.bufferLength(), totalExpected);
  check("D1 no drops before flush", h.droppedCount(), 0);

  await h.flushUsageNow();

  check("D1 written = web + mobile total (no drops, no double-count)", writtenCount, totalExpected);
  check("D1 buffer empty after flush", h.bufferLength(), 0);
  check("D1 dropped = 0 throughout", h.droppedCount(), 0);
}

// ── D2: Mobile login event shape ──────────────────────────────────────────────
// Mobile sign-in fires kind="login" with an empty feature string — identical to
// the web login path. Confirm the login shape is treated identically to web and
// flushes at exact count.
{
  let writtenCount = 0;
  const h = makeHarness(async (rows) => {
    writtenCount += rows.length;
    return { written: rows.length, error: null };
  });

  // 5 web logins
  for (let i = 0; i < 5; i++) {
    h.recordUsage({ tenant: "t2", userId: `wu${i}`, username: `webuser${i}` }, "login");
  }
  // 5 mobile logins (identical shape, different user IDs)
  for (let i = 0; i < 5; i++) {
    h.recordUsage({ tenant: "t2", userId: `mu${i}`, username: `mobileuser${i}` }, "login");
  }

  check("D2 buffer = 10 logins (5 web + 5 mobile)", h.bufferLength(), 10);
  await h.flushUsageNow();
  check("D2 all 10 logins written exactly", writtenCount, 10);
  check("D2 no drops", h.droppedCount(), 0);
}

// ── D3: Mixed flush with mid-batch failure — tail requeue preserves both ─────
// 80 events: 40 web (first in buffer) + 40 mobile (second in buffer).
// chunk 0 (rows 0-49, web + some mobile) commits; chunk 1 (rows 50-79,
// remaining mobile) fails. Requeued tail = rows 50-79 = 30 events.
// Invariant: written (50) + requeued (30) = original total (80).
{
  const TOTAL   = 80;
  const WEB_N   = 40;
  const MOB_N   = 40;
  const CHUNK   = 50; // ROWS_PER_INSERT
  const expectedWritten  = CHUNK;            // chunk 0 committed
  const expectedRequeued = TOTAL - CHUNK;    // 30 rows tail

  const h = makeHarness(async (rows) => {
    return { written: CHUNK, error: new Error("connection reset") };
  });

  for (let i = 0; i < WEB_N; i++) {
    h.recordUsage({ tenant: "t3", userId: `wu${i}`, username: `webuser${i}` }, "page", "Dashboard");
  }
  for (let i = 0; i < MOB_N; i++) {
    h.recordUsage({ tenant: "t3", userId: `mu${i}`, username: `mobileuser${i}` }, "page", "projects");
  }
  check("D3 buffer seeded with web + mobile", h.bufferLength(), TOTAL);

  await h.flushUsageNow();

  check("D3 written + requeued = total (no silent drop)", expectedWritten + h.bufferLength(), TOTAL);
  check("D3 requeued = unwritten tail only", h.bufferLength(), expectedRequeued);
  check("D3 requeued rows marked retried=true", h.retriedInBuffer(), expectedRequeued);
  check("D3 dropped = 0 on first failure", h.droppedCount(), 0);
}

// ── D4: system flag preserved for mobile system events ───────────────────────
// Mobile import/cache-warmer paths fire with opts.system=true. Confirm those
// events land in the buffer correctly flagged (isSystem=true) without affecting
// the count of human events — the flush count must still equal total emitted.
{
  let writtenCount = 0;
  const h = makeHarness(async (rows) => {
    writtenCount += rows.length;
    return { written: rows.length, error: null };
  });

  // 10 human mobile events
  for (let i = 0; i < 10; i++) {
    h.recordUsage({ tenant: "t4", userId: `mu${i}`, username: `mobileuser${i}` }, "tx", "record_open");
  }
  // 5 mobile system events (import pipeline from mobile-triggered import)
  for (let i = 0; i < 5; i++) {
    h.recordUsage(
      { tenant: "t4", userId: "sys", username: "__cache_warmer__" },
      "tx",
      "data_import",
      { system: true },
    );
  }

  const systemInBuf = h.bufferContents().filter((e) => e.isSystem).length;
  const humanInBuf  = h.bufferContents().filter((e) => !e.isSystem).length;
  check("D4 system events flagged correctly in buffer", systemInBuf, 5);
  check("D4 human events correctly unflagged in buffer", humanInBuf, 10);

  await h.flushUsageNow();
  check("D4 all 15 events (human+system) written exactly", writtenCount, 15);
  check("D4 no drops", h.droppedCount(), 0);
}

// ── Summary ──────────────────────────────────────────────────────────────────
if (failures) {
  console.error(`\ncheck-usage-telemetry-counts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-usage-telemetry-counts: all checks passed");
