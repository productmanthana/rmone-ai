/* Run: pnpm --filter @workspace/rmone-web exec tsx --tsconfig tsconfig.json \
 *        src/lib/__tests__/coalesceWeeklyCellSaves.test.ts
 *
 * Verifies the rapid-edit coalescer: first edit saves immediately, edits made
 * while a save is in flight fold into ONE follow-up bulk weekPatches save per
 * project, failures reject every folded edit, and different projects save on
 * independent lanes.
 */
import assert from "node:assert/strict";
import { createWeeklyCellSaveCoalescer } from "../coalesceWeeklyCellSaves";
import type { ResourceProjectWeeksEdit } from "@/components/ResourcesTimelineGrid";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSaver() {
  const calls: Array<{ edit: ResourceProjectWeeksEdit; gate: Deferred }> = [];
  const saveWeeks = (edit: ResourceProjectWeeksEdit): Promise<void> => {
    const gate = deferred();
    calls.push({ edit, gate });
    return gate.promise;
  };
  return { calls, saveWeeks };
}

const identity = {
  personId: "8b7f2c9e-0a41-4c11-9d6a-2f9d6f3a1e55",
  personName: "Laura Jensen",
  role: "Field Inspector",
};

const edit = (projectId: string, week: string, hours: number, onAccepted?: () => void) => ({
  ...identity,
  projectId,
  projectName: `Project ${projectId}`,
  week,
  hours,
  onAccepted,
});

const tick = () => new Promise<void>(res => setTimeout(res, 0));

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  \u2713  ${label}`);
};

async function main() {
  // A) first edit flushes immediately, no debounce
  {
    const { calls, saveWeeks } = makeSaver();
    const save = createWeeklyCellSaveCoalescer(saveWeeks);
    const p = save(edit("PMM-26-002", "2026-04-27", 0));
    check("A1: first edit starts its save synchronously", () => {
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].edit.weeks, { "2026-04-27": 0 });
    });
    calls[0].gate.resolve();
    await p;
    check("A2: single-edit promise resolves when the save resolves", () => {
      assert.equal(calls.length, 1);
    });
  }

  // B) edits during an in-flight save coalesce into ONE bulk follow-up
  {
    const { calls, saveWeeks } = makeSaver();
    const save = createWeeklyCellSaveCoalescer(saveWeeks);
    const p1 = save(edit("PMM-26-002", "2026-04-27", 0));
    const p2 = save(edit("PMM-26-002", "2026-05-04", 0));
    const p3 = save(edit("PMM-26-002", "2026-05-11", 0));
    const p4 = save(edit("PMM-26-002", "2026-05-18", 0));
    check("B1: only the first save is in flight while others accumulate", () => {
      assert.equal(calls.length, 1);
    });
    calls[0].gate.resolve();
    await p1;
    await tick();
    check("B2: all queued edits flush as ONE bulk weekPatches save", () => {
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[1].edit.weeks, {
        "2026-05-04": 0,
        "2026-05-11": 0,
        "2026-05-18": 0,
      });
    });
    calls[1].gate.resolve();
    await Promise.all([p2, p3, p4]);
    check("B3: every folded edit resolves with its batch", () => {
      assert.equal(calls.length, 2);
    });
  }

  // C) re-editing the same week while queued — last value wins, one entry
  {
    const { calls, saveWeeks } = makeSaver();
    const save = createWeeklyCellSaveCoalescer(saveWeeks);
    const p1 = save(edit("PMM-26-003", "2026-04-27", 40));
    const p2 = save(edit("PMM-26-003", "2026-05-04", 12));
    const p3 = save(edit("PMM-26-003", "2026-05-04", 0));
    calls[0].gate.resolve();
    await p1;
    await tick();
    check("C1: same-week re-edit collapses to the latest value", () => {
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[1].edit.weeks, { "2026-05-04": 0 });
    });
    calls[1].gate.resolve();
    await Promise.all([p2, p3]);
    passed += 0;
  }

  // D) different projects save on independent lanes (parallel)
  {
    const { calls, saveWeeks } = makeSaver();
    const save = createWeeklyCellSaveCoalescer(saveWeeks);
    const p1 = save(edit("PMM-26-002", "2026-04-27", 0));
    const p2 = save(edit("PMM-26-010", "2026-04-27", 0));
    check("D1: two projects start their saves in parallel", () => {
      assert.equal(calls.length, 2);
      assert.equal(calls[0].edit.projectId, "PMM-26-002");
      assert.equal(calls[1].edit.projectId, "PMM-26-010");
    });
    calls[0].gate.resolve();
    calls[1].gate.resolve();
    await Promise.all([p1, p2]);
  }

  // E) a failed batch rejects EVERY folded edit; later edits still save
  {
    const { calls, saveWeeks } = makeSaver();
    const save = createWeeklyCellSaveCoalescer(saveWeeks);
    const p1 = save(edit("PMM-26-025", "2026-04-27", 0));
    const p2 = save(edit("PMM-26-025", "2026-05-04", 0));
    const p3 = save(edit("PMM-26-025", "2026-05-11", 0));
    calls[0].gate.resolve();
    await p1;
    await tick();
    assert.equal(calls.length, 2);
    calls[1].gate.reject(new Error("lock timeout"));
    const results = await Promise.allSettled([p2, p3]);
    check("E1: every edit in a failed batch rejects (cells roll back loudly)", () => {
      assert.equal(results[0].status, "rejected");
      assert.equal(results[1].status, "rejected");
      const reason = (results[0] as PromiseRejectedResult).reason as Error;
      assert.match(reason.message, /lock timeout/);
    });
    const p4 = save(edit("PMM-26-025", "2026-05-18", 20));
    check("E2: the lane recovers — the next edit starts a fresh save", () => {
      assert.equal(calls.length, 3);
      assert.deepEqual(calls[2].edit.weeks, { "2026-05-18": 20 });
    });
    calls[2].gate.resolve();
    await p4;
  }

  // F) onAccepted hooks of folded edits all fire once when their batch is accepted
  {
    const { calls, saveWeeks } = makeSaver();
    const save = createWeeklyCellSaveCoalescer(saveWeeks);
    let acceptedA = 0;
    let acceptedB = 0;
    const p1 = save(edit("PMM-26-002", "2026-04-27", 0));
    const p2 = save(edit("PMM-26-002", "2026-05-04", 0, () => { acceptedA += 1; }));
    const p3 = save(edit("PMM-26-002", "2026-05-11", 0, () => { acceptedB += 1; }));
    calls[0].gate.resolve();
    await p1;
    await tick();
    assert.equal(calls.length, 2);
    calls[1].edit.onAccepted?.();
    check("F1: batch acceptance fans out to every folded edit's hook exactly once", () => {
      assert.equal(acceptedA, 1);
      assert.equal(acceptedB, 1);
    });
    calls[1].gate.resolve();
    await Promise.all([p2, p3]);
  }

  // G) person switch mid-flight — lanes are person+project, never project alone
  {
    const { calls, saveWeeks } = makeSaver();
    const save = createWeeklyCellSaveCoalescer(saveWeeks);
    const p1 = save(edit("PMM-26-002", "2026-04-27", 0)); // Laura, in flight
    const otherPerson = {
      ...edit("PMM-26-002", "2026-05-04", 16),
      personId: "31f6a884-77aa-4e0e-b0d3-64f2f0f0c111",
      personName: "Laura Gray",
    };
    const p2 = save(otherPerson);
    check("G1: a different person's edit on the SAME project starts its own save", () => {
      assert.equal(calls.length, 2);
      assert.equal(calls[0].edit.personId, identity.personId);
      assert.equal(calls[1].edit.personId, otherPerson.personId);
      assert.deepEqual(calls[1].edit.weeks, { "2026-05-04": 16 });
    });
    const p3 = save(edit("PMM-26-002", "2026-05-11", 0)); // Laura again → queues on HER lane
    check("G2: the original person's follow-up edit queues on their own lane only", () => {
      assert.equal(calls.length, 2);
    });
    calls[0].gate.resolve();
    calls[1].gate.resolve();
    await Promise.all([p1, p2]);
    await tick();
    check("G3: the queued edit flushes under the ORIGINAL person's identity", () => {
      assert.equal(calls.length, 3);
      assert.equal(calls[2].edit.personId, identity.personId);
      assert.deepEqual(calls[2].edit.weeks, { "2026-05-11": 0 });
    });
    calls[2].gate.resolve();
    await p3;
  }

  // H) a synchronously-throwing saver must reject (not strand) the lane
  {
    let callCount = 0;
    const save = createWeeklyCellSaveCoalescer(() => {
      callCount += 1;
      if (callCount === 1) throw new Error("sync boom");
      return Promise.resolve();
    });
    const p1 = save(edit("PMM-26-002", "2026-04-27", 0));
    const r1 = await p1.then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    check("H1: a synchronous saver throw rejects the folded edits", () => {
      assert.equal(r1, "sync boom");
    });
    const p2 = save(edit("PMM-26-002", "2026-05-04", 8));
    await p2;
    check("H2: the lane is not stranded — the next edit saves normally", () => {
      assert.equal(callCount, 2);
    });
  }

  console.log("─".repeat(60));
  console.log(`\u2713 All ${passed} coalesceWeeklyCellSaves checks passed.`);
}

main().catch(error => {
  console.error("coalesceWeeklyCellSaves test failed:", error);
  process.exit(1);
});
