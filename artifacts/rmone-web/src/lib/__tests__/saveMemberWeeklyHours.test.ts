/**
 * Tests for saveMemberWeeklyHours.ts
 *
 * Tests cover:
 *   A) Member identity — GUID-first, name fallback, GUID mismatch strict rule
 *   B) Week-map construction — weekPatch, fullWeekMap, weekPatches
 *   C) Validation — rejects new/worsening >168h, negative, NaN; passes exactly-168
 *   D) Locked allocation — throws AllocationLockedError
 *   E) NOT_ON_TEAM — throws NotOnTeamError when member absent
 *   F) Queue serialization — writes chain onto memberWriteQueue
 *   G) notifyMemberWrite called on success and on failure
 *   H) Verify/refetch — returns confirmed map from server; throws SaveMismatchError on mismatch
 *      and emits the confirmed-allocation signal only after verification
 *   I) Raw Error response treated as failure
 *   J) Both weekPatch and fullWeekMap supplied → validation error
 *   K) weekPatches preserves untouched fresh-server weeks
 *   L) GUID mismatch → never falls back by name, throws NotOnTeamError
 */

import assert from "node:assert/strict";

// ── Import the REAL production implementation (factory) ───────────────────────
// The factory accepts injected deps for network calls; all other logic
// (validation, GUID lookup, queue, notify, verify) is the EXACT production code.

import {
  createSaveMemberWeeklyHours,
  NotOnTeamError,
  AllocationLockedError,
  PastWeekLockedError,
  SaveMismatchError,
} from "../saveMemberWeeklyHours.js";
import {
  queueProjectMemberWrite,
  notifyMemberWrite as realNotifyMemberWrite,
} from "../memberWriteQueue.js";

// ── Minimal stubs ─────────────────────────────────────────────────────────────

// Track what updateHoursAllocation received.
let lastAllocationCall: { ProjectID: string; Allocations: Record<string, unknown>[] } | null = null;
// Control what updateHoursAllocation returns.
let allocationResult: unknown = {};
// Control whether updateHoursAllocation throws.
let allocationError: Error | null = null;

// Track getProjectTeam calls.
let teamCallCount = 0;
// Two-phase response: first call (fresh refresh at queue turn) and second call
// (post-save verify).  Can be overridden per test.
let teamResponses: Array<{ team: ReturnType<typeof makeMember>[] }> = [];
let verifyGate: Promise<void> | null = null;

// notifyMemberWrite call log.
const notifyLog: Array<{ projectId: string; memberId: string; ok: boolean; weekMap: Record<string, number> | null }> = [];
// Confirmed-allocation signal log. This models the browser event without
// depending on a DOM in this Node test.
const confirmedAllocationLog: string[] = [];
const lockedWeeks = new Set<string>();

function makeMember(override: Partial<{
  name: string;
  resourceId: string;
  role: string;
  isLocked: boolean;
  weeklyHours: Array<{ week: string; hours: number }>;
}> = {}) {
  return {
    name: override.name ?? "Alex Chen",
    role: override.role ?? "Project Manager",
    bu: "Design",
    title: "PM",
    eacHrs: 0, etcHrs: 0, costRate: 0, eacCost: 0, etcCost: 0,
    ncHrs: 0, ncCost: 0, pctAllocation: 100,
    startDate: "2026-01-01", endDate: "2026-12-31",
    resourceId: override.resourceId ?? "aaaaaaaa-0000-0000-0000-000000000001",
    weeklyHours: override.weeklyHours ?? [
      { week: "2026-03-02", hours: 8 },
      { week: "2026-03-09", hours: 16 },
    ],
    isLocked: override.isLocked ?? false,
  };
}

// ── Wire up the REAL production helper with stub network deps ─────────────────
// createSaveMemberWeeklyHours returns the IDENTICAL production code path with
// only the network I/O calls (project team/full allocations and save) stubbed.
// All logic — GUID identity, weekPatches merge, validation, queue, notify,
// verify, error classes — runs exactly as in production.

type Member = ReturnType<typeof makeMember>;

function makeTestHelper() {
  return createSaveMemberWeeklyHours({
    getProjectTeam: async (_projectId: string, _fresh: boolean) => {
      const callIndex = teamCallCount++;
      if (callIndex > 0 && verifyGate) await verifyGate;
      // A real fresh endpoint keeps returning its current snapshot. Reuse the
      // final fixture response for verification retries rather than turning a
      // third read into a fake empty roster.
      const resp = teamResponses[Math.min(callIndex, Math.max(0, teamResponses.length - 1))];
      return { team: (resp?.team ?? []) as unknown as import("../api.js").ProjectTeamMember[] };
    },
    getFullProjectAllocations: async (_projectId: string, _fresh: boolean) => ({
      ExistingAllocations: ((teamResponses[0]?.team ?? []) as Member[]).map((m) => ({
        AssignedTo: m.resourceId,
        AssignedToName: m.name,
        TypeName: m.role,
        RoleName: m.role,
      })),
      NewAllocations: [],
    }),
    updateHoursAllocation: async (payload: { ProjectID: string; Allocations: Record<string, unknown>[] }) => {
      lastAllocationCall = payload;
      if (allocationError) throw allocationError;
      return allocationResult;
    },
    queueProjectMemberWrite,
    notifyMemberWrite: (projectId: string, ev: { memberId: string; weekMap: Record<string, number> | null; ok: boolean }) => {
      notifyLog.push({ projectId, memberId: ev.memberId, ok: ev.ok, weekMap: ev.weekMap });
      realNotifyMemberWrite(projectId, ev);
    },
    notifyAllocationConfirmed: (projectId: string) => {
      confirmedAllocationLog.push(projectId);
    },
    isPastWeekLocked: (weekKey: string) => lockedWeeks.has(weekKey),
  });
}

// Shared test helper instance — rebuilt fresh for each test via makeTestHelper()
// so the dep stubs capture the correct closure variables.
let save: ReturnType<typeof makeTestHelper>;

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

function resetState(
  firstTeam: Member[],
  secondTeam?: Member[],
) {
  lastAllocationCall = null;
  allocationResult = {};
  allocationError = null;
  verifyGate = null;
  teamCallCount = 0;
  teamResponses = [
    { team: firstTeam },
    { team: secondTeam ?? firstTeam },
  ];
  notifyLog.length = 0;
  confirmedAllocationLog.length = 0;
  lockedWeeks.clear();
  save = makeTestHelper();
}

// ── A) Member identity ─────────────────────────────────────────────────────────
console.log("\nA) Member identity — GUID-first");

const GUID_A = "aaaaaaaa-0000-0000-0000-000000000001";
const GUID_B = "bbbbbbbb-0000-0000-0000-000000000002";
const PROJECT = "PMM-001";

await test("finds member by GUID when two members share the same display name", async () => {
  const memberA = makeMember({ name: "Jordan Lee", resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 10 }] });
  const memberB = makeMember({ name: "Jordan Lee", resourceId: GUID_B, weeklyHours: [{ week: "2026-03-02", hours: 20 }] });
  resetState([memberA, memberB], [memberA, memberB]);

  const res = await save({
    projectId: PROJECT,
    memberId: GUID_B,
    memberName: "Jordan Lee",
    memberRole: "Designer",
    weekPatch: { week: "2026-03-02", hours: 20 },
  });
  // The posted allocations must carry GUID_B, not GUID_A
  assert.ok(lastAllocationCall !== null);
  assert.equal(
    String(lastAllocationCall!.Allocations[0]?.AssignedTo).toLowerCase(),
    GUID_B.toLowerCase(),
    "payload must use GUID_B — GUID matched member, not name-matched first row"
  );
  assert.deepEqual(res.confirmedWeekMap["2026-03-02"], 20);
});

await test("falls back to name match when memberId is empty string", async () => {
  const member = makeMember({ name: "Riley Kim", resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 8 }] });
  resetState([member], [member]);

  await save({
    projectId: PROJECT,
    memberId: "",
    memberName: "Riley Kim",
    memberRole: "Architect",
    weekPatch: { week: "2026-03-02", hours: 8 },
  });
  assert.equal(lastAllocationCall!.Allocations[0]?.AssignedTo, GUID_A);
});

await test("GUID comparison is case-insensitive", async () => {
  // Server may return uppercase GUID
  const upperGuid = GUID_A.toUpperCase();
  const member = makeMember({ name: "Sam Park", resourceId: upperGuid, weeklyHours: [{ week: "2026-03-02", hours: 5 }] });
  resetState([member], [member]);

  await save({
    projectId: PROJECT,
    memberId: GUID_A.toLowerCase(),  // caller sends lowercase
    memberName: "Sam Park",
    memberRole: "PM",
    weekPatch: { week: "2026-03-02", hours: 5 },
  });
  assert.ok(lastAllocationCall !== null, "should have called updateHoursAllocation");
});

// ── B) Week-map construction ───────────────────────────────────────────────────
console.log("\nB) Week-map construction — patch vs full map vs weekPatches");

await test("one-week patch is merged onto server's full map, not just the patched week", async () => {
  const member = makeMember({
    resourceId: GUID_A,
    weeklyHours: [
      { week: "2026-03-02", hours: 8 },
      { week: "2026-03-09", hours: 16 },
      { week: "2026-03-16", hours: 24 },
    ],
  });
  resetState([member], [
    makeMember({
      resourceId: GUID_A,
      weeklyHours: [
        { week: "2026-03-02", hours: 8 },
        { week: "2026-03-09", hours: 99 },
        { week: "2026-03-16", hours: 24 },
      ],
    }),
  ]);

  await save({
    projectId: PROJECT,
    memberId: GUID_A,
    memberName: "Alex Chen",
    memberRole: "PM",
    weekPatch: { week: "2026-03-09", hours: 99 },
  });

  // Payload should carry all three weeks
  assert.equal(lastAllocationCall!.Allocations.length, 3, "full map POST must include all weeks");
  const sent = Object.fromEntries(
    lastAllocationCall!.Allocations.map(a => [
      String(a.AllocationStartDate).slice(0, 10),
      a.AllocationHour,
    ])
  );
  assert.equal(sent["2026-03-02"], 8, "unpatched week must be preserved");
  assert.equal(sent["2026-03-09"], 99, "patched week must have new value");
  assert.equal(sent["2026-03-16"], 24, "third unpatched week must be preserved");
});

await test("fullWeekMap replaces all weeks entirely", async () => {
  const member = makeMember({
    resourceId: GUID_A,
    weeklyHours: [
      { week: "2026-03-02", hours: 40 },
    ],
  });
  const verifyMember = makeMember({
    resourceId: GUID_A,
    weeklyHours: [
      { week: "2026-03-02", hours: 10 },
      { week: "2026-03-09", hours: 20 },
    ],
  });
  resetState([member], [verifyMember]);

  const res = await save({
    projectId: PROJECT,
    memberId: GUID_A,
    memberName: "Alex Chen",
    memberRole: "PM",
    fullWeekMap: { "2026-03-02": 10, "2026-03-09": 20 },
  });
  assert.equal(lastAllocationCall!.Allocations.length, 2);
  assert.deepEqual(res.confirmedWeekMap["2026-03-02"], 10);
  assert.deepEqual(res.confirmedWeekMap["2026-03-09"], 20);
});

await test("zero-hour weeks are included in the payload so the server can clear them", async () => {
  const member = makeMember({
    resourceId: GUID_A,
    weeklyHours: [
      { week: "2026-03-02", hours: 40 },
      { week: "2026-03-09", hours: 8 },
    ],
  });
  const verifyMember = makeMember({
    resourceId: GUID_A,
    weeklyHours: [
      { week: "2026-03-02", hours: 0 },
      { week: "2026-03-09", hours: 0 },
    ],
  });
  resetState([member], [verifyMember]);

  await save({
    projectId: PROJECT,
    memberId: GUID_A,
    memberName: "Alex Chen",
    memberRole: "PM",
    fullWeekMap: { "2026-03-02": 0, "2026-03-09": 0 },
  });

  const sentHours = lastAllocationCall!.Allocations.map(a => a.AllocationHour);
  assert.deepEqual(sentHours, [0, 0], "zero-hour weeks must not be stripped");
});

// ── C) Validation ──────────────────────────────────────────────────────────────
console.log("\nC) Validation — rejects new/worsening >168h, negative, NaN; allows ≤168");

await test("exactly 168h per week is valid and passes through", async () => {
  const member = makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 0 }] });
  resetState([member], [makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 168 }] })]);

  await save({
    projectId: PROJECT,
    memberId: GUID_A,
    memberName: "Alex Chen",
    memberRole: "PM",
    weekPatch: { week: "2026-03-02", hours: 168 },
  });
  assert.equal(lastAllocationCall!.Allocations[0]?.AllocationHour, 168);
});

await test("169h is rejected with a friendly over-limit message (not clamped)", async () => {
  const member = makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 0 }] });
  resetState([member], [member]);

  let threw = false;
  try {
    await save({
      projectId: PROJECT,
      memberId: GUID_A,
      memberName: "Alex Chen",
      memberRole: "PM",
      weekPatch: { week: "2026-03-02", hours: 169 },
    });
  } catch (e) {
    threw = true;
    assert.match((e as Error).message, /maximum is 168 hours per week/i);
    assert.match((e as Error).message, /Nothing has been saved/i);
    // Must NOT clamp — the value 169 must appear in the message
    assert.match((e as Error).message, /169/);
  }
  assert.ok(threw, "must throw for >168h");
  // No POST should have been made
  assert.equal(lastAllocationCall, null, "POST must not be issued for invalid hours");
});

await test("zeroing another week still works when a legacy server row is already over the cap", async () => {
  const serverMember = makeMember({
    resourceId: GUID_A,
    weeklyHours: [
      { week: "2026-03-02", hours: 457 },
      { week: "2026-03-09", hours: 8 },
    ],
  });
  const verifiedMember = makeMember({
    resourceId: GUID_A,
    weeklyHours: [
      { week: "2026-03-02", hours: 457 },
      { week: "2026-03-09", hours: 0 },
    ],
  });
  resetState([serverMember], [verifiedMember]);

  await save({
    projectId: PROJECT,
    memberId: GUID_A,
    memberName: "Alex Chen",
    memberRole: "PM",
    weekPatch: { week: "2026-03-09", hours: 0 },
  });

  const sent = Object.fromEntries(lastAllocationCall!.Allocations.map(a => [
    String(a.AllocationStartDate).slice(0, 10),
    a.AllocationHour,
  ]));
  assert.equal(sent["2026-03-02"], 457, "the existing invalid row must be carried forward unchanged");
  assert.equal(sent["2026-03-09"], 0, "the requested zero-hour correction must be saved");
});

await test("a legacy over-cap row still cannot be increased", async () => {
  const serverMember = makeMember({
    resourceId: GUID_A,
    weeklyHours: [{ week: "2026-03-02", hours: 457 }],
  });
  resetState([serverMember], [serverMember]);

  await assert.rejects(
    save({
      projectId: PROJECT,
      memberId: GUID_A,
      memberName: "Alex Chen",
      memberRole: "PM",
      weekPatch: { week: "2026-03-02", hours: 458 },
    }),
    /maximum is 168 hours per week/i,
  );
  assert.equal(lastAllocationCall, null, "POST must not be issued when an invalid row is worsened");
});

await test("negative hours are rejected", async () => {
  const member = makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 0 }] });
  resetState([member], [member]);

  let threw = false;
  try {
    await save({
      projectId: PROJECT,
      memberId: GUID_A,
      memberName: "Alex Chen",
      memberRole: "PM",
      weekPatch: { week: "2026-03-02", hours: -5 },
    });
  } catch (e) {
    threw = true;
    assert.match((e as Error).message, /cannot be negative/i);
  }
  assert.ok(threw, "must throw for negative hours");
});

await test("NaN / non-number is rejected", async () => {
  const member = makeMember({ resourceId: GUID_A, weeklyHours: [] });
  resetState([member], [member]);

  let threw = false;
  try {
    await save({
      projectId: PROJECT,
      memberId: GUID_A,
      memberName: "Alex Chen",
      memberRole: "PM",
      fullWeekMap: { "2026-03-02": NaN },
    });
  } catch (e) {
    threw = true;
    assert.match((e as Error).message, /valid number/i);
  }
  assert.ok(threw, "must throw for NaN");
});

// ── D) Locked allocation ───────────────────────────────────────────────────────
console.log("\nD) Locked allocation — AllocationLockedError");

await test("throws AllocationLockedError when member's isLocked is true", async () => {
  const member = makeMember({ resourceId: GUID_A, isLocked: true });
  resetState([member], [member]);

  let threw = false;
  try {
    await save({
      projectId: PROJECT,
      memberId: GUID_A,
      memberName: "Alex Chen",
      memberRole: "PM",
      weekPatch: { week: "2026-03-02", hours: 8 },
    });
  } catch (e) {
    threw = true;
    assert.ok(e instanceof AllocationLockedError, "must be AllocationLockedError");
    assert.match((e as Error).message, /locked/i);
    assert.match((e as Error).message, /unlock/i);
  }
  assert.ok(threw, "must throw for locked member");
  assert.equal(lastAllocationCall, null, "POST must not be issued for locked member");
});

// ── E) NOT_ON_TEAM ─────────────────────────────────────────────────────────────
console.log("\nE) NOT_ON_TEAM — NotOnTeamError");

await test("throws NotOnTeamError when member absent from fresh team list", async () => {
  const unrelated = makeMember({ name: "Different Person", resourceId: "cccccccc-0000-0000-0000-000000000003" });
  resetState([unrelated], [unrelated]);

  let threw = false;
  try {
    await save({
      projectId: PROJECT,
      memberId: GUID_A,
      memberName: "Alex Chen",
      memberRole: "PM",
      weekPatch: { week: "2026-03-02", hours: 8 },
    });
  } catch (e) {
    threw = true;
    assert.ok(e instanceof NotOnTeamError, "must be NotOnTeamError");
    assert.match((e as Error).message, /not on this project/i);
  }
  assert.ok(threw, "must throw when member not found");
});

await test("throws NotOnTeamError on verify step when member disappears after save", async () => {
  const member = makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 8 }] });
  const unrelated = makeMember({ name: "Someone Else", resourceId: "cccccccc-0000-0000-0000-000000000003" });
  // First call: member present; second call (verify): member gone
  resetState([member], [unrelated]);

  let threw = false;
  try {
    await save({
      projectId: PROJECT,
      memberId: GUID_A,
      memberName: "Alex Chen",
      memberRole: "PM",
      weekPatch: { week: "2026-03-02", hours: 8 },
    });
  } catch (e) {
    threw = true;
    assert.ok(e instanceof NotOnTeamError, "must be NotOnTeamError on verify loss");
  }
  assert.ok(threw, "must throw when member disappears post-save");
});

// ── F) Queue serialization ─────────────────────────────────────────────────────
console.log("\nF) Queue serialization — writes chain onto memberWriteQueue");

await test("two sequential saves for the same member both complete in order", async () => {
  // Save 1: patch week 2026-03-02 to 10h
  //   - fresh team call: member has week-02=8, week-09=16
  //   - verify call: member has week-02=10, week-09=16
  // Save 2: patch week 2026-03-09 to 20h
  //   - fresh team call: member has week-02=10, week-09=16
  //     (save 2's patch applies on top of what the server returns at ITS turn)
  //   - verify call: member has week-02=10, week-09=20
  const baseWeeks = [{ week: "2026-03-02", hours: 8 }, { week: "2026-03-09", hours: 16 }];
  const afterSave1Weeks = [{ week: "2026-03-02", hours: 10 }, { week: "2026-03-09", hours: 16 }];
  const afterSave2Weeks = [{ week: "2026-03-02", hours: 10 }, { week: "2026-03-09", hours: 20 }];

  teamCallCount = 0;
  teamResponses = [
    { team: [makeMember({ resourceId: GUID_A, weeklyHours: baseWeeks })] },       // save1 fresh
    { team: [makeMember({ resourceId: GUID_A, weeklyHours: afterSave1Weeks })] }, // save1 verify
    { team: [makeMember({ resourceId: GUID_A, weeklyHours: afterSave1Weeks })] }, // save2 fresh
    { team: [makeMember({ resourceId: GUID_A, weeklyHours: afterSave2Weeks })] }, // save2 verify
  ];
  notifyLog.length = 0;
  allocationError = null;
  allocationResult = {};
  lastAllocationCall = null;
  save = makeTestHelper();

  const order: number[] = [];
  const save1 = save({
    projectId: PROJECT, memberId: GUID_A, memberName: "Alex Chen", memberRole: "PM",
    weekPatch: { week: "2026-03-02", hours: 10 },
  }).then(() => { order.push(1); return 1; });
  const save2 = save({
    projectId: PROJECT, memberId: GUID_A, memberName: "Alex Chen", memberRole: "PM",
    weekPatch: { week: "2026-03-09", hours: 20 },
  }).then(() => { order.push(2); return 2; });

  await Promise.all([save1, save2]);
  assert.deepEqual(order, [1, 2], "saves must complete in enqueue order");
  assert.equal(notifyLog.filter(n => n.ok).length, 2, "both notifyMemberWrite(ok=true) must fire");
});

// ── G) notifyMemberWrite calls ─────────────────────────────────────────────────
console.log("\nG) notifyMemberWrite — success and failure notifications");

await test("notifyMemberWrite(ok=true) called with the full week map on success", async () => {
  const member = makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 8 }] });
  resetState([member], [member]);
  notifyLog.length = 0;

  await save({
    projectId: PROJECT, memberId: GUID_A, memberName: "Alex Chen", memberRole: "PM",
    weekPatch: { week: "2026-03-02", hours: 8 },
  });

  const successNote = notifyLog.find(n => n.ok);
  assert.ok(successNote, "success notification must fire");
  assert.equal(successNote!.memberId.toLowerCase(), GUID_A.toLowerCase());
  assert.ok(successNote!.weekMap !== null, "weekMap must not be null on success");
  assert.equal(successNote!.weekMap!["2026-03-02"], 8);
});

await test("onAccepted carries exact identity and hours before verification finishes", async () => {
  const member = makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 26 }] });
  const verified = makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 30 }] });
  resetState([member], [verified]);
  let releaseVerify!: () => void;
  verifyGate = new Promise<void>(resolve => { releaseVerify = resolve; });
  let resolveAccepted!: (value: {
    projectId: string;
    memberId: string;
    previousWeekMap: Record<string, number>;
    acceptedWeekMap: Record<string, number>;
  }) => void;
  const acceptedSeen = new Promise<{
    projectId: string;
    memberId: string;
    previousWeekMap: Record<string, number>;
    acceptedWeekMap: Record<string, number>;
  }>(resolve => { resolveAccepted = resolve; });

  let saveSettled = false;
  const pending = save({
    projectId: PROJECT,
    memberId: GUID_A,
    memberName: "Alex Chen",
    memberRole: "PM",
    weekPatch: { week: "2026-03-02", hours: 30 },
    onAccepted: write => resolveAccepted(write),
  }).finally(() => { saveSettled = true; });

  const accepted = await acceptedSeen;
  assert.equal(accepted.projectId, PROJECT);
  assert.equal(accepted.memberId.toLowerCase(), GUID_A.toLowerCase());
  assert.equal(accepted.previousWeekMap["2026-03-02"], 26);
  assert.equal(accepted.acceptedWeekMap["2026-03-02"], 30);
  assert.equal(saveSettled, false, "accepted callback must run before the verification read settles");

  releaseVerify();
  await pending;
  assert.equal(saveSettled, true);
});

await test("notifyMemberWrite(ok=false, weekMap=null) called on failure", async () => {
  const member = makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 8 }] });
  resetState([member], [member]);
  allocationError = new Error("Network error");
  notifyLog.length = 0;

  let threw = false;
  try {
    await save({
      projectId: PROJECT, memberId: GUID_A, memberName: "Alex Chen", memberRole: "PM",
      weekPatch: { week: "2026-03-02", hours: 8 },
    });
  } catch { threw = true; }

  assert.ok(threw, "must re-throw on network error");
  const failNote = notifyLog.find(n => !n.ok);
  assert.ok(failNote, "failure notification must fire");
  assert.equal(failNote!.weekMap, null, "weekMap must be null on failure");
});

// ── H) Verify/refetch ──────────────────────────────────────────────────────────
console.log("\nH) Verify/refetch — confirmed map and SaveMismatchError");

await test("returns confirmedWeekMap from post-save refetch", async () => {
  const member = makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 0 }] });
  const verifyMember = makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 40 }] });
  resetState([member], [verifyMember]);

  const res = await save({
    projectId: PROJECT, memberId: GUID_A, memberName: "Alex Chen", memberRole: "PM",
    weekPatch: { week: "2026-03-02", hours: 40 },
  });
  assert.equal(res.confirmedWeekMap["2026-03-02"], 40);
  assert.equal(res.member.name, "Alex Chen");
  assert.deepEqual(confirmedAllocationLog, [PROJECT], "must signal only after server truth is confirmed");
});

await test("retries a briefly stale post-save read before treating an accepted save as a failure", async () => {
  const member = makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 41.3 }] });
  const stillStale = makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 41.3 }] });
  const confirmed = makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 0 }] });
  resetState([member], [stillStale]);
  teamResponses.push({ team: [confirmed] });

  const res = await save({
    projectId: PROJECT, memberId: GUID_A, memberName: "Alex Chen", memberRole: "PM",
    weekPatch: { week: "2026-03-02", hours: 0 },
  });

  assert.equal(res.confirmedWeekMap["2026-03-02"], 0);
  assert.equal(teamCallCount, 3, "must take one fresh retry after the stale verify read");
  assert.deepEqual(confirmedAllocationLog, [PROJECT], "must confirm only after the retry sees persisted truth");
});

await test("throws SaveMismatchError when server truth doesn't match posted values", async () => {
  const member = makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 0 }] });
  // Server returns different value than what we sent
  const verifyMember = makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 5 }] });
  resetState([member], [verifyMember]);

  let threw = false;
  try {
    await save({
      projectId: PROJECT, memberId: GUID_A, memberName: "Alex Chen", memberRole: "PM",
      weekPatch: { week: "2026-03-02", hours: 40 },
    });
  } catch (e) {
    threw = true;
    assert.ok(e instanceof SaveMismatchError, "must be SaveMismatchError");
    assert.match((e as Error).message, /did not match after saving/i);
    assert.match((e as Error).message, /2026-03-02/);
  }
  assert.ok(threw, "must throw SaveMismatchError on server mismatch");
  assert.deepEqual(confirmedAllocationLog, [], "must not signal confirmation when server truth mismatches");
});

// ── I) Raw Error response ──────────────────────────────────────────────────────
console.log("\nI) Raw Error response from server treated as failure");

await test("server raw:Error response throws and notifies failure", async () => {
  const member = makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 8 }] });
  resetState([member], [member]);
  allocationResult = { raw: "Error" };
  notifyLog.length = 0;

  let threw = false;
  try {
    await save({
      projectId: PROJECT, memberId: GUID_A, memberName: "Alex Chen", memberRole: "PM",
      weekPatch: { week: "2026-03-02", hours: 8 },
    });
  } catch (e) {
    threw = true;
    assert.match((e as Error).message, /Save rejected/i);
  }
  assert.ok(threw, "must throw on raw:Error response");
  const failNote = notifyLog.find(n => !n.ok);
  assert.ok(failNote, "failure notification must fire for raw:Error");
});

await test("server raw:error (lowercase) is also treated as failure", async () => {
  const member = makeMember({ resourceId: GUID_A, weeklyHours: [{ week: "2026-03-02", hours: 8 }] });
  resetState([member], [member]);
  allocationResult = { raw: "error" };

  let threw = false;
  try {
    await save({
      projectId: PROJECT, memberId: GUID_A, memberName: "Alex Chen", memberRole: "PM",
      weekPatch: { week: "2026-03-02", hours: 8 },
    });
  } catch { threw = true; }
  assert.ok(threw, "must throw for lowercase raw:error too");
});

// ── J) Argument validation ─────────────────────────────────────────────────────
console.log("\nJ) Argument validation");

await test("throws when neither weekPatch nor fullWeekMap is supplied", async () => {
  resetState([], []);
  let threw = false;
  try {
    await save({
      projectId: PROJECT, memberId: GUID_A, memberName: "Alex Chen", memberRole: "PM",
      // neither weekPatch nor fullWeekMap nor weekPatches
    } as Parameters<typeof save>[0]);
  } catch (e) {
    threw = true;
    assert.match((e as Error).message, /supply either weekPatch/i);
  }
  assert.ok(threw);
});

await test("throws when both weekPatch and fullWeekMap are supplied", async () => {
  resetState([], []);
  let threw = false;
  try {
    await save({
      projectId: PROJECT, memberId: GUID_A, memberName: "Alex Chen", memberRole: "PM",
      weekPatch: { week: "2026-03-02", hours: 8 },
      fullWeekMap: { "2026-03-02": 8 },
    });
  } catch (e) {
    threw = true;
    assert.match((e as Error).message, /not both/i);
  }
  assert.ok(threw);
});

await test("throws when weekPatches and weekPatch are both supplied", async () => {
  resetState([], []);
  let threw = false;
  try {
    await save({
      projectId: PROJECT, memberId: GUID_A, memberName: "Alex Chen", memberRole: "PM",
      weekPatch: { week: "2026-03-02", hours: 8 },
      weekPatches: { "2026-03-02": 8 },
    });
  } catch (e) {
    threw = true;
    assert.match((e as Error).message, /not both/i);
  }
  assert.ok(threw);
});

await test("throws when weekPatches and fullWeekMap are both supplied", async () => {
  resetState([], []);
  let threw = false;
  try {
    await save({
      projectId: PROJECT, memberId: GUID_A, memberName: "Alex Chen", memberRole: "PM",
      fullWeekMap: { "2026-03-02": 8 },
      weekPatches: { "2026-03-02": 8 },
    });
  } catch (e) {
    threw = true;
    assert.match((e as Error).message, /not both/i);
  }
  assert.ok(threw);
});

// ── K) weekPatches preserves untouched fresh-server weeks ─────────────────────
console.log("\nK) weekPatches — preserves untouched fresh-server weeks");

await test("weekPatches merges onto authoritative server map, preserving untouched weeks", async () => {
  // Server has weeks 02 (8h), 09 (16h), 16 (24h)
  // weekPatches only updates 09 → 40 and adds new week 23 → 12
  // Expected result: 02=8 (preserved), 09=40 (patched), 16=24 (preserved), 23=12 (added)
  const serverMember = makeMember({
    resourceId: GUID_A,
    weeklyHours: [
      { week: "2026-03-02", hours: 8 },
      { week: "2026-03-09", hours: 16 },
      { week: "2026-03-16", hours: 24 },
    ],
  });
  const verifyMember = makeMember({
    resourceId: GUID_A,
    weeklyHours: [
      { week: "2026-03-02", hours: 8 },
      { week: "2026-03-09", hours: 40 },
      { week: "2026-03-16", hours: 24 },
      { week: "2026-03-23", hours: 12 },
    ],
  });
  resetState([serverMember], [verifyMember]);

  const res = await save({
    projectId: PROJECT,
    memberId: GUID_A,
    memberName: "Alex Chen",
    memberRole: "PM",
    weekPatches: { "2026-03-09": 40, "2026-03-23": 12 },
  });

  // All four weeks must appear in the payload
  assert.equal(lastAllocationCall!.Allocations.length, 4, "all four weeks must be in the POST");
  const sent = Object.fromEntries(
    lastAllocationCall!.Allocations.map(a => [
      String(a.AllocationStartDate).slice(0, 10),
      a.AllocationHour,
    ])
  );
  assert.equal(sent["2026-03-02"], 8,  "untouched week 02 must be preserved from server");
  assert.equal(sent["2026-03-09"], 40, "patched week 09 must have new value");
  assert.equal(sent["2026-03-16"], 24, "untouched week 16 must be preserved from server");
  assert.equal(sent["2026-03-23"], 12, "new week 23 must be added");

  // confirmed map must match
  assert.equal(res.confirmedWeekMap["2026-03-02"], 8);
  assert.equal(res.confirmedWeekMap["2026-03-09"], 40);
  assert.equal(res.confirmedWeekMap["2026-03-16"], 24);
  assert.equal(res.confirmedWeekMap["2026-03-23"], 12);
});

await test("weekPatches with empty object preserves the full server map unchanged", async () => {
  const serverMember = makeMember({
    resourceId: GUID_A,
    weeklyHours: [
      { week: "2026-03-02", hours: 10 },
      { week: "2026-03-09", hours: 20 },
    ],
  });
  resetState([serverMember], [serverMember]);

  await save({
    projectId: PROJECT,
    memberId: GUID_A,
    memberName: "Alex Chen",
    memberRole: "PM",
    weekPatches: {},
  });

  assert.equal(lastAllocationCall!.Allocations.length, 2, "both server weeks must be included");
  const sent = Object.fromEntries(
    lastAllocationCall!.Allocations.map(a => [
      String(a.AllocationStartDate).slice(0, 10),
      a.AllocationHour,
    ])
  );
  assert.equal(sent["2026-03-02"], 10);
  assert.equal(sent["2026-03-09"], 20);
});

await test("weekPatches validation rejects >168 on a patched week", async () => {
  const serverMember = makeMember({
    resourceId: GUID_A,
    weeklyHours: [{ week: "2026-03-02", hours: 8 }],
  });
  resetState([serverMember], [serverMember]);

  let threw = false;
  try {
    await save({
      projectId: PROJECT,
      memberId: GUID_A,
      memberName: "Alex Chen",
      memberRole: "PM",
      weekPatches: { "2026-03-02": 200 },
    });
  } catch (e) {
    threw = true;
    assert.match((e as Error).message, /maximum is 168/i);
  }
  assert.ok(threw, "must throw for >168h in weekPatches");
  assert.equal(lastAllocationCall, null, "POST must not be issued");
});

// ── L) GUID mismatch → NEVER fallback by name ─────────────────────────────────
console.log("\nL) GUID mismatch — never fallback by name when memberId is GUID-shaped");

await test("GUID-shaped memberId with no GUID match throws NotOnTeamError even if name matches", async () => {
  // Team has the correct name but a DIFFERENT GUID — must not fall back to name.
  const teamMember = makeMember({
    name: "Alex Chen",
    resourceId: "cccccccc-0000-0000-0000-000000000099",
    weeklyHours: [{ week: "2026-03-02", hours: 8 }],
  });
  resetState([teamMember], [teamMember]);

  let threw = false;
  try {
    await save({
      projectId: PROJECT,
      memberId: GUID_A,          // GUID_A — not on team (only GUID_C is)
      memberName: "Alex Chen",   // name DOES match, but must not be used
      memberRole: "PM",
      weekPatch: { week: "2026-03-02", hours: 8 },
    });
  } catch (e) {
    threw = true;
    assert.ok(e instanceof NotOnTeamError,
      `must throw NotOnTeamError, got: ${(e as Error).constructor.name}: ${(e as Error).message}`);
    assert.match((e as Error).message, /not on this project/i);
  }
  assert.ok(threw, "must throw when GUID-shaped memberId has no GUID match");
  assert.equal(lastAllocationCall, null, "must not POST when GUID lookup fails");
});

await test("non-GUID memberId (plain string) still falls back to name match", async () => {
  // Member ID is not a GUID — name fallback is allowed.
  const teamMember = makeMember({
    name: "Morgan Blake",
    resourceId: GUID_A,
    weeklyHours: [{ week: "2026-03-02", hours: 8 }],
  });
  resetState([teamMember], [teamMember]);

  await save({
    projectId: PROJECT,
    memberId: "not-a-guid",   // not GUID-shaped → name fallback allowed
    memberName: "Morgan Blake",
    memberRole: "Analyst",
    weekPatch: { week: "2026-03-02", hours: 8 },
  });
  // Should have matched by name and used the member's GUID in the payload
  assert.ok(lastAllocationCall !== null, "should have issued POST via name fallback");
  assert.equal(
    String(lastAllocationCall!.Allocations[0]?.AssignedTo).toLowerCase(),
    GUID_A.toLowerCase(),
    "resolved GUID must come from the name-matched member row"
  );
});

await test("empty memberId (no GUID) falls back to name match", async () => {
  const teamMember = makeMember({
    name: "Sam Lee",
    resourceId: GUID_B,
    weeklyHours: [{ week: "2026-03-02", hours: 5 }],
  });
  resetState([teamMember], [teamMember]);

  await save({
    projectId: PROJECT,
    memberId: "",              // empty → name fallback allowed
    memberName: "Sam Lee",
    memberRole: "Engineer",
    weekPatch: { week: "2026-03-02", hours: 5 },
  });
  assert.ok(lastAllocationCall !== null);
  assert.equal(
    String(lastAllocationCall!.Allocations[0]?.AssignedTo).toLowerCase(),
    GUID_B.toLowerCase(),
  );
});

// ── M) Settings-driven past-week lock ────────────────────────────────────────
console.log("\nM) Settings-driven past-week lock");

await test("rejects a changed locked week before posting", async () => {
  const week = "2026-03-02";
  const member = makeMember({
    resourceId: GUID_A,
    weeklyHours: [{ week, hours: 8 }],
  });
  resetState([member], [member]);
  lockedWeeks.add(week);

  let thrown: unknown = null;
  try {
    await save({
      projectId: PROJECT,
      memberId: GUID_A,
      memberName: "Alex Chen",
      memberRole: "PM",
      weekPatch: { week, hours: 12 },
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof PastWeekLockedError);
  assert.match((thrown as Error).message, /Past week — locked/);
  assert.equal(lastAllocationCall, null, "locked historical change must not POST");
});

await test("accepts an unchanged locked week carried through a full-map save", async () => {
  const lockedWeek = "2026-03-02";
  const editableWeek = "2026-03-09";
  const first = makeMember({
    resourceId: GUID_A,
    weeklyHours: [
      { week: lockedWeek, hours: 8 },
      { week: editableWeek, hours: 4 },
    ],
  });
  const verified = makeMember({
    resourceId: GUID_A,
    weeklyHours: [
      { week: lockedWeek, hours: 8 },
      { week: editableWeek, hours: 10 },
    ],
  });
  resetState([first], [verified]);
  lockedWeeks.add(lockedWeek);

  await save({
    projectId: PROJECT,
    memberId: GUID_A,
    memberName: "Alex Chen",
    memberRole: "PM",
    fullWeekMap: {
      [lockedWeek]: 8,
      [editableWeek]: 10,
    },
  });

  assert.ok(lastAllocationCall !== null, "unchanged historical value may be carried forward");
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
if (failed === 0) {
  console.log(`✓ All ${passed} saveMemberWeeklyHours tests passed.`);
} else {
  console.error(`${passed} passed, ${failed} FAILED.`);
  process.exit(1);
}
