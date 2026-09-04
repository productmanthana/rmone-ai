/**
 * Per-worker cap on concurrently-running import pipelines.
 *
 * Why: each pipeline peaks at ~8 pool connections (LC/RA insert concurrency).
 * Nothing previously limited how many pipelines could run at once, so N
 * simultaneous uploads demanded N×8 connections from a 50-max per-worker
 * pool — under a burst, pool-acquire waits blew past 30 s and every import
 * (plus user-facing traffic on the worker) failed with "operation timed out".
 *
 * Cap 2 per worker keeps peak pipeline demand ≤ 16 of the worker's 50
 * connections; with 4 workers the cluster tops out at 8 active imports.
 * Excess imports wait in a FIFO queue — the job status shows a "waiting for
 * a free import slot" phase. Parsing/validation happen before this gate, so
 * only the DB-write stage queues.
 *
 * Release hands the slot directly to the next waiter, so `active` only
 * decrements when the queue is empty. A 30-minute max wait guards against a
 * leaked slot (hung pipeline) freezing the queue forever — after it the
 * waiter proceeds anyway with a loud log (bounded overshoot beats a frozen
 * import queue).
 */

const MAX_CONCURRENT_IMPORTS_PER_WORKER = 2;
const MAX_QUEUE_WAIT_MS = 30 * 60_000;

let active = 0;
const waiters: Array<() => void> = [];

export function importSlotStats(): { active: number; queued: number } {
  return { active, queued: waiters.length };
}

/**
 * Acquire an import slot; resolves with a release function (idempotent).
 * `onQueued` fires only when the caller actually has to wait, with the number
 * of imports ahead of it (running + queued).
 */
export async function acquireImportSlot(onQueued?: (ahead: number) => void): Promise<() => void> {
  if (active < MAX_CONCURRENT_IMPORTS_PER_WORKER) {
    active++;
  } else {
    onQueued?.(active + waiters.length);
    await new Promise<void>((resolve) => {
      let settled = false;
      const wrapped = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(); // slot handed off by release() — `active` already counts it
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const idx = waiters.indexOf(wrapped);
        if (idx >= 0) waiters.splice(idx, 1);
        active++; // overshoot is tracked so release() stays balanced
        console.warn(
          `[import-slots] queue wait exceeded ${MAX_QUEUE_WAIT_MS / 60_000} min — proceeding anyway (active=${active})`,
        );
        resolve();
      }, MAX_QUEUE_WAIT_MS);
      waiters.push(wrapped);
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiters.shift();
    if (next) next(); // hand this slot to the next waiter — active unchanged
    else active--;
  };
}
