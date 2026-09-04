/**
 * Tests for runFastWeeklyHoursSave — the accepted-then-failed contract of the
 * Team Allocation workspace fast hours save (persistDirectWeeklyHours).
 *
 * The fast path resolves its promise as soon as the server ACCEPTS the weekly
 * POST (onAccepted), while the forced-fresh verification read continues in the
 * background. These tests pin the hours-integrity guarantee:
 *
 *   A) POST accepted → promise resolves BEFORE verification settles →
 *      background verification rejects → bustCache fires AND the warning
 *      surface fires (never silent).
 *   B) Same guarantee when verification technically succeeds but the fresh
 *      read MISMATCHES the posted hours (SaveMismatchError).
 *   C) Failure BEFORE acceptance still rejects the save promise (modal stays
 *      open, retry possible) — and the warning surface must NOT fire.
 *   D) Defensive resolve — a save that verifies fully without onAccepted ever
 *      firing still resolves (never hangs the submit).
 *   E) Wiring — useAssignMemberCascade routes persistDirectWeeklyHours through
 *      runFastWeeklyHoursSave with bustCache + the loud amber toast.
 *
 * The underlying save is the REAL production saveMemberWeeklyHours logic via
 * createSaveMemberWeeklyHours with only the network I/O stubbed — the same
 * pattern as saveMemberWeeklyHours.test.ts.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { runFastWeeklyHoursSave } from "../fastWeeklyHoursSave.js";
import {
  createSaveMemberWeeklyHours,
  SaveMismatchError,
} from "../saveMemberWeeklyHours.js";
import {
  queueProjectMemberWrite,
  notifyMemberWrite,
} from "../memberWriteQueue.js";

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn).then(() => {
    console.log(`  ✓  ${name}`);
    passed++;
  }).catch(err => {
    console.error(`  ✗  ${name}`);
    console.error(`     ${(err as Error).message}`);
    failed++;
  });
}

// ── Stub scaffolding (mirrors saveMemberWeeklyHours.test.ts) ──────────────────

const GUID_A = "aaaaaaaa-0000-0000-0000-000000000001";
const PROJECT = "PMM-001";

function makeMember(weeklyHours: Array<{ week: string; hours: number }>) {
  return {
    name: "Alex Chen",
    role: "Project Manager",
    bu: "Design", title: "PM",
    eacHrs: 0, etcHrs: 0, costRate: 0, eacCost: 0, etcCost: 0,
    ncHrs: 0, ncCost: 0, pctAllocation: 100,
    startDate: "2026-01-01", endDate: "2026-12-31",
    resourceId: GUID_A,
    weeklyHours,
    isLocked: false,
  };
}

interface Scenario {
  /** Responses per getProjectTeam call: index 0 = queue-turn fresh read,
   *  index 1 = post-save verification read. A function may throw. */
  teamResponses: Array<() => { team: ReturnType<typeof makeMember>[] }>;
  /** Gate awaited before serving the VERIFICATION read (call index ≥ 1). */
  verifyGate?: Promise<void>;
  postError?: Error;
}

function makeSave(s: Scenario) {
  let teamCallCount = 0;
  return createSaveMemberWeeklyHours({
    getProjectTeam: async () => {
      const callIndex = teamCallCount++;
      if (callIndex > 0 && s.verifyGate) await s.verifyGate;
      const resp = s.teamResponses[Math.min(callIndex, s.teamResponses.length - 1)]();
      return { team: resp.team as unknown as import("../api.js").ProjectTeamMember[] };
    },
    getFullProjectAllocations: async () => ({
      ExistingAllocations: s.teamResponses[0]().team.map((m) => ({
        AssignedTo: m.resourceId,
        AssignedToName: m.name,
        TypeName: m.role,
        RoleName: m.role,
      })),
      NewAllocations: [],
    }),
    updateHoursAllocation: async () => {
      if (s.postError) throw s.postError;
      return {};
    },
    queueProjectMemberWrite,
    notifyMemberWrite,
    notifyAllocationConfirmed: () => {},
    isPastWeekLocked: () => false,
  });
}

const SAVE_OPTS = {
  projectId: PROJECT,
  memberId: GUID_A,
  memberName: "Alex Chen",
  memberRole: "Project Manager",
  weekPatches: { "2026-03-02": 24 } as Record<string, number>,
};

/** Deps with spies; warnSeen resolves when the warning surface fires. */
function makeDeps(save: ReturnType<typeof makeSave>) {
  const bustLog: number[] = [];
  const warnLog: unknown[] = [];
  let resolveWarn!: (err: unknown) => void;
  const warnSeen = new Promise<unknown>(resolve => { resolveWarn = resolve; });
  const deps = {
    save,
    bustCache: () => { bustLog.push(Date.now()); },
    warnVerificationFailed: (error: unknown) => {
      assert.equal(bustLog.length, 1, "bustCache must fire BEFORE the warning surface");
      warnLog.push(error);
      resolveWarn(error);
    },
  };
  return { deps, bustLog, warnLog, warnSeen };
}

// ── A) Accepted → resolves → background verification rejects → loud warning ───
console.log("\nA) Accepted-then-failed verification always warns");

await test("POST accepted resolves first; a rejecting verification read busts caches and fires the warning", async () => {
  let releaseVerify!: () => void;
  const verifyGate = new Promise<void>(resolve => { releaseVerify = resolve; });
  const save = makeSave({
    teamResponses: [
      () => ({ team: [makeMember([{ week: "2026-03-02", hours: 8 }])] }),
      // Background verification read fails outright (network/RDS error).
      () => { throw new Error("fresh team read failed: RDS timeout"); },
    ],
    verifyGate,
  });
  const { deps, bustLog, warnLog, warnSeen } = makeDeps(save);

  let settled = false;
  const fast = runFastWeeklyHoursSave(SAVE_OPTS, deps).then(
    () => { settled = true; return "resolved" as const; },
    () => { settled = true; return "rejected" as const; },
  );

  // The fast promise must settle on ACCEPTANCE, while verification is still
  // gated — the user's modal closes before the background check finishes.
  const outcome = await fast;
  assert.equal(outcome, "resolved", "acceptance must resolve the fast save promise");
  assert.ok(settled, "promise must settle before the verification read is released");
  assert.equal(bustLog.length, 0, "no cache bust before the verification actually fails");
  assert.equal(warnLog.length, 0, "no warning before the verification actually fails");

  // Now let the background verification read run — and fail.
  releaseVerify();
  const warnedWith = await warnSeen;

  assert.equal(bustLog.length, 1, "verification failure must bust caches exactly once");
  assert.equal(warnLog.length, 1, "verification failure must fire the warning surface exactly once");
  assert.match((warnedWith as Error).message, /RDS timeout/, "the warning must carry the verification error");
});

await test("a verification MISMATCH (server disagrees with posted hours) also busts caches and warns", async () => {
  const save = makeSave({
    teamResponses: [
      () => ({ team: [makeMember([{ week: "2026-03-02", hours: 8 }])] }),
      // Verification read succeeds but returns the WRONG hours.
      () => ({ team: [makeMember([{ week: "2026-03-02", hours: 5 }])] }),
    ],
  });
  const { deps, bustLog, warnSeen } = makeDeps(save);

  await runFastWeeklyHoursSave(SAVE_OPTS, deps);
  const warnedWith = await warnSeen;

  assert.equal(bustLog.length, 1, "mismatch must bust caches");
  assert.ok(warnedWith instanceof SaveMismatchError, "the warning must carry the SaveMismatchError");
  assert.match((warnedWith as Error).message, /did not match after saving/i);
});

// ── B) Failure BEFORE acceptance rejects — retry stays possible ───────────────
console.log("\nB) Pre-acceptance failure rejects the save promise");

await test("a POST failure rejects the promise and never touches the warning surface", async () => {
  const save = makeSave({
    teamResponses: [
      () => ({ team: [makeMember([{ week: "2026-03-02", hours: 8 }])] }),
    ],
    postError: new Error("Network error during hours POST"),
  });
  const { deps, bustLog, warnLog } = makeDeps(save);

  let rejectedWith: Error | null = null;
  try {
    await runFastWeeklyHoursSave(SAVE_OPTS, deps);
  } catch (e) {
    rejectedWith = e as Error;
  }

  assert.ok(rejectedWith, "pre-acceptance failure must reject so the modal stays open for retry");
  assert.match(rejectedWith!.message, /Network error/);
  assert.equal(bustLog.length, 0, "pre-acceptance failure must not bust caches here (caller owns retry)");
  assert.equal(warnLog.length, 0, "pre-acceptance failure must not fire the after-close warning");
});

await test("a pre-POST failure (member not on team) rejects the same way", async () => {
  const save = makeSave({
    teamResponses: [
      () => ({ team: [] }), // fresh read finds nobody — NotOnTeamError before any POST
    ],
  });
  const { deps, warnLog } = makeDeps(save);

  let rejectedWith: Error | null = null;
  try {
    await runFastWeeklyHoursSave(SAVE_OPTS, deps);
  } catch (e) {
    rejectedWith = e as Error;
  }
  assert.ok(rejectedWith, "must reject when the member is missing before acceptance");
  assert.match(rejectedWith!.message, /not on this project/i);
  assert.equal(warnLog.length, 0);
});

await test("non-Error rejections are wrapped into a real Error for the caller", async () => {
  const stubSave = () => Promise.reject("string failure");
  const { deps } = makeDeps(stubSave as unknown as ReturnType<typeof makeSave>);

  let rejectedWith: unknown = null;
  try {
    await runFastWeeklyHoursSave(SAVE_OPTS, { ...deps, save: stubSave as never });
  } catch (e) {
    rejectedWith = e;
  }
  assert.ok(rejectedWith instanceof Error, "caller must always receive an Error instance");
  assert.match((rejectedWith as Error).message, /string failure/);
});

// ── C) Defensive resolve when acceptance never fires ──────────────────────────
console.log("\nC) Defensive resolve");

await test("a fully-verified save whose onAccepted never fired still resolves (no hang)", async () => {
  // Stub save that ignores onAccepted entirely and verifies successfully.
  const stubSave = () => Promise.resolve({
    confirmedWeekMap: { "2026-03-02": 24 },
    member: makeMember([{ week: "2026-03-02", hours: 24 }]) as never,
  });
  const { deps, bustLog, warnLog } = makeDeps(stubSave as never);

  await runFastWeeklyHoursSave(SAVE_OPTS, { ...deps, save: stubSave as never });
  assert.equal(bustLog.length, 0);
  assert.equal(warnLog.length, 0);
});

// ── D) Wiring — the hook routes through the fast path with the loud toast ─────
console.log("\nD) useAssignMemberCascade wiring");

await test("persistDirectWeeklyHours uses runFastWeeklyHoursSave with bustCache + amber warning toast", () => {
  const hookSource = readFileSync(
    new URL("../../hooks/useAssignMemberCascade.ts", import.meta.url),
    "utf8",
  );

  const fnStart = hookSource.indexOf("async function persistDirectWeeklyHours()");
  assert.notEqual(fnStart, -1, "persistDirectWeeklyHours must exist");
  const fnBody = hookSource.slice(fnStart, fnStart + 3500);

  assert.match(
    fnBody,
    /await runFastWeeklyHoursSave\(/,
    "the direct weekly save must route through the extracted fast path",
  );
  assert.match(
    fnBody,
    /runFastWeeklyHoursSave\([\s\S]*?weekPatches,[\s\S]*?bustCache,[\s\S]*?warnVerificationFailed:/,
    "the fast path must be wired with weekPatches, bustCache, and the warning surface",
  );
  assert.match(
    fnBody,
    /hours were saved, but the follow-up check could not confirm them/,
    "the warning toast must keep its explicit accepted-but-unconfirmed wording",
  );
  assert.match(
    fnBody,
    /showAllocationSaveToast\([\s\S]*?"warning",?\s*\)/,
    "the fast-path verification warning must use the shared toast at WARNING severity",
  );
  assert.match(
    hookSource,
    /warning:\s*\{[^}]*#F59E0B/,
    "the shared toast's warning palette must stay amber (loud), not a success green",
  );
  assert.match(
    hookSource,
    /import \{ runFastWeeklyHoursSave \} from "@\/lib\/fastWeeklyHoursSave"/,
    "the hook must import the shared fast-path helper",
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────
if (failed > 0) {
  console.error(`\n${failed} fast weekly hours save test(s) failed.`);
  process.exit(1);
}
console.log(`\n✓ All ${passed} fast weekly hours save tests passed.`);
