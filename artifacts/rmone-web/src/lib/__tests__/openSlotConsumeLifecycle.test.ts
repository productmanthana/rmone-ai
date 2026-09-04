/**
 * Integration test: hiring from Home/Alerts must fill the EXACT open position
 * that was clicked — through the REAL useAssignMemberCascade lifecycle
 * (react-test-renderer harness, same pattern as crossBuAutoContinue.test.ts).
 *
 * Two silent-failure regressions are locked in here:
 *  1. The assign workspace used to read the selected open position's RA ids
 *     only ONCE, at open. Quick actions on Home/Alerts recover the ids from a
 *     fresh team read that lands AFTER the modal mounted, so the late prop
 *     was dropped and the save never consumed the slot. Scenario A delivers
 *     consumeRaIds after mount (and after the person pick) and asserts the
 *     assign-resource payload carries ConsumeOpenSlotRaIds.
 *  2. Picking a person already on the team takes the existing-member edit
 *     path, which never reaches assignResource's ConsumeOpenSlotRaIds — the
 *     hook must retire the selected slot explicitly via removeOpenPosition.
 *     Scenario B delivers the ids late too, saves for an existing member,
 *     and asserts remove-open-position is called with the same ids.
 *  3. Daily Briefing demand rows are the alert-side hand-off: they must
 *     expose _ticket (project) and _raId (exact open position) so the panel's
 *     "Add Team Member" quick action can target the clicked row. Scenario C
 *     calls buildDemandsDetail directly.
 */
import assert from "node:assert/strict";

// ── Browser-global shims (must exist BEFORE the hook's module graph loads) ──
// window/document stay undefined on purpose: every window use in the hook and
// lib/api is guarded, and the undefined-window path skips DOM toasts.
const storeMap = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (storeMap.has(k) ? storeMap.get(k)! : null),
  setItem: (k: string, v: string) => { storeMap.set(k, String(v)); },
  removeItem: (k: string) => { storeMap.delete(k); },
  clear: () => { storeMap.clear(); },
  key: (i: number) => [...storeMap.keys()][i] ?? null,
  get length() { return storeMap.size; },
};
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ── Fixtures ────────────────────────────────────────────────────────────────
// The person's home division matches the project's division (d1) so the
// cross-BU confirmation never opens — this test is about slot consumption.
const PROJECT_A = "PMM-26-801"; // fresh assign (person NOT on the team)
const PROJECT_B = "PMM-26-802"; // existing-member edit (person already on team)
const PERSON_ID = "aaaaaaaa-0000-0000-0000-0000000000d1";
const PERSON_NAME = "Riley Fill";
const WEEK = "2026-09-07"; // future Monday — never trips the past-week lock
const LATE_IDS_A = [4321, 4322];
const LATE_IDS_B = [7777];

const DIVISIONS = [
  { ID: "d1", Title: "Buildings", ShortName: "BLD", BusinessUnitIdLookup: "bu1" },
];
const PROJECT_ROLES = [
  { DivisionIDLookup: "d1", DivisionShortName: "BLD", DivisionName: "Buildings", Name: "Project Manager" },
];
const USERS = [{
  Id: PERSON_ID, Name: PERSON_NAME, JobProfile: "Senior Engineer",
  Role: "Project Manager", DivisionName: "Buildings", DivisionId: "d1",
  Department: "", DepartmentId: "", UserName: "riley@example.test", Email: "riley@example.test",
}];
const BUSINESS_UNITS = [{ ID: "bu1", ShortName: "East" }];

// ── Stateful fetch stub ─────────────────────────────────────────────────────
// The weekly save inside the hook (runFastWeeklyHoursSave → the REAL
// saveMemberWeeklyHours) force-refreshes the team, posts /hours-allocation,
// then verifies against another fresh team read — so the stub tracks team
// membership and the posted week map per project like the server would.
interface ProjState { onTeam: boolean; hoursMap: Record<string, number> }
const projState: Record<string, ProjState> = {
  [PROJECT_A]: { onTeam: false, hoursMap: {} },
  [PROJECT_B]: { onTeam: true, hoursMap: { [WEEK]: 6 } },
};
const memberRow = (projectId: string) => ({
  name: PERSON_NAME, role: "Project Manager", bu: "BLD", title: "Senior Engineer",
  eacHrs: 0, etcHrs: 0, costRate: 0, eacCost: 0, etcCost: 0, ncHrs: 0, ncCost: 0,
  pctAllocation: 0, startDate: "2026-01-05", endDate: "2026-12-25",
  resourceId: PERSON_ID, rwiId: 8801, isLocked: false,
  weeklyHours: Object.entries(projState[projectId].hoursMap).map(([week, hours]) => ({ week, hours })),
});

const callSeq: string[] = [];
const assignCalls: { body: Record<string, unknown> }[] = [];
const hoursCalls: { body: { ProjectID: string; Allocations: Record<string, unknown>[] } }[] = [];
const removeCalls: { body: { ProjectID: string; raIds: number[] } }[] = [];

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = url.split("?")[0];
  const method = (init?.method ?? "GET").toUpperCase();
  const body = () => JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

  if (path.endsWith("/assign-resource") && method === "POST") {
    const b = body();
    assignCalls.push({ body: b });
    callSeq.push(`assign:${b.ProjectID}`);
    const st = projState[String(b.ProjectID)];
    if (st) st.onTeam = true; // the person is on the team from now on
    return new Response("true", { status: 200 });
  }
  if (path.endsWith("/project-team")) {
    const pid = decodeURIComponent(/projectID=([^&]+)/.exec(url)?.[1] ?? "");
    const st = projState[pid];
    return jsonResponse({ team: st?.onTeam ? [memberRow(pid)] : [], openRoles: [] });
  }
  if (path.endsWith("/project-allocations") && method === "POST") {
    const b = body();
    const pid = String(b.ProjectID ?? "");
    const st = projState[pid];
    return jsonResponse({
      ExistingAllocations: st?.onTeam
        ? [{ ID: 9001, ProjectID: pid, AssignedTo: PERSON_ID, AssignedToName: PERSON_NAME, PctAllocation: 0, TypeName: "Project Manager" }]
        : [],
    });
  }
  if (path.endsWith("/hours-allocation") && method === "POST") {
    const b = body() as { ProjectID: string; Allocations: Record<string, unknown>[] };
    hoursCalls.push({ body: b });
    callSeq.push(`hours:${b.ProjectID}`);
    const st = projState[b.ProjectID];
    if (st) {
      for (const row of b.Allocations ?? []) {
        const week = String(row.AllocationStartDate ?? "").slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(week)) st.hoursMap[week] = Number(row.AllocationHour ?? 0);
      }
    }
    return jsonResponse({ Status: true });
  }
  if (path.endsWith("/remove-open-position") && method === "POST") {
    const b = body() as { ProjectID: string; raIds: number[] };
    removeCalls.push({ body: b });
    callSeq.push(`remove:${b.ProjectID}`);
    return jsonResponse({ Status: true, removed: b.raIds?.length ?? 0 });
  }
  if (path.endsWith("/divisions")) return jsonResponse(DIVISIONS);
  if (path.endsWith("/project-division-roles")) return jsonResponse(PROJECT_ROLES);
  if (path.endsWith("/user-list")) return jsonResponse(USERS);
  if (path.endsWith("/business-units-list")) return jsonResponse(BUSINESS_UNITS);
  if (path.endsWith("/job-titles") || path.endsWith("/departments")) return jsonResponse([]);
  // Everything else (availability, business rules, …) — harmless empty list.
  return jsonResponse([]);
}) as typeof fetch;

// Imported dynamically so the shims above are installed first.
const React = (await import("react")).default;
const { default: TestRenderer, act } = await import("react-test-renderer");
const { useAssignMemberCascade } = await import("../../hooks/useAssignMemberCascade");
type Cascade = ReturnType<typeof useAssignMemberCascade>;

// Watchdog: a broken save/queue turn hangs act() instead of failing — convert
// that into a loud, fast failure (see hook-harness pattern notes).
const WATCHDOG = setTimeout(() => {
  console.error(
    `FAIL: test did not finish within 60s (assign=${assignCalls.length} hours=${hoursCalls.length} remove=${removeCalls.length})`,
  );
  process.exit(1);
}, 60_000);
void WATCHDOG;

async function flush(turns = 12): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario A — fresh assign: consumeRaIds prop arrives AFTER mount (and after
// the person pick), exactly like the Home/Alerts quick action whose fresh team
// read recovers the slot ids a moment after the modal opened. The late ids
// must reach the assign-resource payload as ConsumeOpenSlotRaIds.
{
  const PLAN_A: Record<string, number> = { [WEEK]: 20 };
  const out: { current: Cascade | null } = { current: null };
  const assigned: string[] = [];
  const closed: number[] = [];
  function HarnessA(props: { consumeRaIds?: number[] }): null {
    out.current = useAssignMemberCascade({
      active: true,
      projectId: PROJECT_A,
      projectName: "Harbor Tower",
      projectStartDate: "2026-01-05",
      projectEndDate: "2026-12-25",
      existingAllocations: [],
      plannedWeeklyHours: PLAN_A,
      consumeRaIds: props.consumeRaIds,
      onAssigned: (name: string) => { assigned.push(name); },
      onClose: () => { closed.push(1); },
    });
    return null;
  }
  const cascade = () => {
    assert.ok(out.current, "harness A did not render the cascade hook");
    return out.current!;
  };

  let renderer!: ReturnType<typeof TestRenderer.create>;
  // Mount WITHOUT the slot ids — the quick action hasn't recovered them yet.
  await act(async () => { renderer = TestRenderer.create(React.createElement(HarnessA, {})); });
  await flush();

  // Pick the person before the ids arrive (worst-case ordering).
  await act(async () => { cascade().setPicker("person"); });
  await act(async () => { cascade().applyPick(PERSON_ID, PERSON_NAME); });
  await flush(4);
  assert.equal(cascade().personId, PERSON_ID);
  assert.equal(cascade().role, "Project Manager", "person pick should infer the role");
  assert.equal(cascade().buMismatch, null, "same-division person must not open the cross-BU popup");

  // The fresh team read lands: the ids arrive as a NEW prop value after mount.
  await act(async () => { renderer.update(React.createElement(HarnessA, { consumeRaIds: LATE_IDS_A })); });
  await flush(4);

  assert.equal(cascade().canSubmit, true, "Add to team must be clickable");
  await act(async () => { await cascade().submit(); });
  await flush();

  assert.equal(assignCalls.length, 1, "fresh assign must produce exactly ONE assign-resource write");
  const written = assignCalls[0].body;
  assert.equal(written.ProjectID, PROJECT_A);
  assert.deepEqual(
    written.ConsumeOpenSlotRaIds,
    LATE_IDS_A,
    "the save payload must carry the RA ids that arrived AFTER mount — dropping them leaves the clicked position open",
  );
  const alloc = (written.Allocations as Record<string, unknown>[])[0];
  assert.equal(alloc.AssignedTo, PERSON_ID);
  assert.equal(alloc.ID, 0, "fresh assign is a NEW assignment insert");
  const hoursA = hoursCalls.filter((c) => c.body.ProjectID === PROJECT_A);
  assert.equal(hoursA.length, 1, "the exact weekly plan is saved through /hours-allocation");
  assert.equal(projState[PROJECT_A].hoursMap[WEEK], 20, "the planned week landed");
  assert.deepEqual(assigned, [PERSON_NAME], "onAssigned fires once");
  assert.equal(closed.length, 1, "the workspace closes after the save");
  assert.equal(
    removeCalls.length, 0,
    "the fresh-assign path consumes the slot via ConsumeOpenSlotRaIds, never remove-open-position",
  );
  await act(async () => { renderer.unmount(); });
  console.log("Scenario A passed: late-arriving RA ids reach ConsumeOpenSlotRaIds on a fresh assign");
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario B — the picked person is ALREADY on the team: the edit path never
// reaches assignResource, so the hook must retire the selected slot explicitly
// via remove-open-position with the SAME (late-arriving) ids.
{
  const PLAN_B: Record<string, number> = { [WEEK]: 12 };
  const EXISTING_B = [{
    // quickExistingAllocations shape — what the quick action passes in.
    personId: PERSON_ID, bu: "BLD", role: "Project Manager", title: "Senior Engineer",
    hours: 6, allocationId: 8801, startDate: "2026-01-05", endDate: "2026-12-25",
  }];
  const out: { current: Cascade | null } = { current: null };
  const assigned: string[] = [];
  const closed: number[] = [];
  function HarnessB(props: { consumeRaIds?: number[] }): null {
    out.current = useAssignMemberCascade({
      active: true,
      projectId: PROJECT_B,
      projectName: "Marina Depot",
      projectStartDate: "2026-01-05",
      projectEndDate: "2026-12-25",
      existingAllocations: EXISTING_B,
      plannedWeeklyHours: PLAN_B,
      consumeRaIds: props.consumeRaIds,
      onAssigned: (name: string) => { assigned.push(name); },
      onClose: () => { closed.push(1); },
    });
    return null;
  }
  const cascade = () => {
    assert.ok(out.current, "harness B did not render the cascade hook");
    return out.current!;
  };
  const assignBaseline = assignCalls.length;

  let renderer!: ReturnType<typeof TestRenderer.create>;
  await act(async () => { renderer = TestRenderer.create(React.createElement(HarnessB, {})); });
  await flush();

  await act(async () => { cascade().setPicker("person"); });
  await act(async () => { cascade().applyPick(PERSON_ID, PERSON_NAME); });
  await flush(4);
  assert.equal(cascade().personId, PERSON_ID);
  // Edit-in-place seed: dates come from the saved assignment, so the window
  // UPDATE below is a no-op and no assign-resource write may happen at all.
  assert.equal(cascade().startDate, "2026-01-05");
  assert.equal(cascade().endDate, "2026-12-25");

  // The slot ids arrive late here too.
  await act(async () => { renderer.update(React.createElement(HarnessB, { consumeRaIds: LATE_IDS_B })); });
  await flush(4);

  await act(async () => { await cascade().submit(); });
  // INSTANT-SAVE contract: the editor closes immediately; the write chain runs
  // in the background.
  assert.equal(closed.length, 1, "existing-member edit closes instantly");
  await flush(16);

  assert.equal(
    assignCalls.length, assignBaseline,
    "the existing-member edit path must NEVER call assign-resource (would duplicate the assignment)",
  );
  const hoursB = hoursCalls.filter((c) => c.body.ProjectID === PROJECT_B);
  assert.equal(hoursB.length, 1, "the member's weekly hours are saved through /hours-allocation");
  assert.equal(projState[PROJECT_B].hoursMap[WEEK], 12, "the edited week landed");
  assert.equal(removeCalls.length, 1, "the selected open position must be retired explicitly");
  assert.equal(removeCalls[0].body.ProjectID, PROJECT_B);
  assert.deepEqual(
    removeCalls[0].body.raIds,
    LATE_IDS_B,
    "remove-open-position must receive the SAME ids the operator's clicked row carried",
  );
  const hoursIdx = callSeq.indexOf(`hours:${PROJECT_B}`);
  const removeIdx = callSeq.indexOf(`remove:${PROJECT_B}`);
  assert.ok(
    hoursIdx >= 0 && removeIdx > hoursIdx,
    "the slot is retired only AFTER the hours save was accepted (a failed save must not consume the slot)",
  );
  assert.deepEqual(assigned, [PERSON_NAME], "onAssigned fires after the background chain lands");
  await act(async () => { renderer.unmount(); });
  console.log("Scenario B passed: existing-member edit retires the exact clicked slot via remove-open-position");
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario C — Daily Briefing demand rows carry the hand-off fields the panel
// quick action needs: _ticket (project) always, _raId only when the backing
// ResourceAllocation ID is a real positive integer.
{
  const { buildDemandsDetail } = await import("../dailyBriefing");
  const mkDemand = (over: Record<string, unknown>) => ({
    TicketId: "PMM-26-900", Title: "Demand", Role: "Project Manager",
    PctAllocation: 40, AllocationStartDate: "2026-09-07", AllocationEndDate: "2026-12-25",
    SoftAllocation: false, NonChargeable: false, IsLocked: false,
    ApproxContractValue: 0,
    TargetStartDate: null, TargetCompletionDate: null,
    ActualStartDate: null, ActualCompletionDate: null, CloseDate: null,
    ...over,
  });
  const detail = buildDemandsDetail([
    mkDemand({ TicketId: "PMM-26-901", RaId: 55, ApproxContractValue: 900000 }) as never,
    mkDemand({ TicketId: "PMM-26-902", ApproxContractValue: 500000 }) as never,
    mkDemand({ TicketId: "PMM-26-903", RaId: 0, ApproxContractValue: 100000 }) as never,
  ], 1500000);

  const rowFor = (ticket: string) => {
    const row = detail.rows.find((r) => (r as Record<string, unknown>)._id === ticket) as Record<string, unknown> | undefined;
    assert.ok(row, `demand row for ${ticket} missing`);
    return row!;
  };
  const withRa = rowFor("PMM-26-901");
  assert.equal(withRa._ticket, "PMM-26-901", "demand rows must carry _ticket for the quick action's project hand-off");
  assert.equal(withRa._raId, 55, "demand rows must carry _raId so the quick action fills the EXACT clicked position");
  const noRa = rowFor("PMM-26-902");
  assert.equal(noRa._ticket, "PMM-26-902");
  assert.ok(!("_raId" in noRa), "a demand row without a backing RA id must not fabricate one");
  const zeroRa = rowFor("PMM-26-903");
  assert.ok(!("_raId" in zeroRa), "RaId 0 is not a real row id — it must not be exposed");
  // The hidden hand-off keys must never leak into the rendered columns.
  const columnKeys = new Set(detail.columns.map((c) => c.key));
  assert.ok(!columnKeys.has("_ticket") && !columnKeys.has("_raId"), "_ticket/_raId are hidden hand-off fields, not display columns");
  console.log("Scenario C passed: buildDemandsDetail rows expose _ticket and valid _raId only");
}

console.log("openSlotConsumeLifecycle: exact-position fill checks passed");
process.exit(0);
