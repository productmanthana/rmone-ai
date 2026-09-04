/**
 * Integration test for the cross-BU confirmation's auto-continue lifecycle in
 * useAssignMemberCascade — the REAL hook rendered through React (not the pure
 * predicate, which crossBuConfirmation.test.ts already covers).
 *
 * The one invariant that matters: the confirmation can never double-add
 * someone to the team.
 *   1. Add to team → cross-BU popup opens → confirm → BU write succeeds →
 *      the submit resumes automatically → EXACTLY ONE assign-resource write.
 *   2. Cancel → popup dismissed, person selection cleared, ZERO writes.
 *   3. Failed BU write → error shown in the popup, popup stays open, ZERO
 *      assignment writes, no auto-continue.
 *   4. StrictMode double-invoked effects still produce only ONE write.
 *
 * The hook runs against a fetch stub (all /api/rmone endpoints), so the full
 * effect lifecycle — autoSubmitAfterBuAddRef arming in addBuToProject, the
 * shouldAutoContinueAfterBuAdd-gated useEffect, and submit()'s pending-popup
 * gate — executes exactly as in the app.
 */
import assert from "node:assert/strict";

// ── Browser-global shims (must exist BEFORE the hook's module graph loads) ──
// window/document stay undefined on purpose: every window use in the hook and
// lib/api is guarded (`typeof window !== "undefined"` or try/catch), and the
// undefined-window path skips DOM toasts, which is exactly what we want here.
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

// ── Fixture: project lives in division d1; the picked person's home is d2 ──
const PROJECT = "PMM-26-777";
const PERSON_ID = "aaaaaaaa-0000-0000-0000-0000000000d2";
const PERSON_NAME = "Pat Cross";
const DIVISIONS = [
  { ID: "d1", Title: "Buildings", ShortName: "BLD", BusinessUnitIdLookup: "bu1" },
  { ID: "d2", Title: "Civil", ShortName: "CIV", BusinessUnitIdLookup: "bu2" },
];
const PROJECT_ROLES = [
  { DivisionIDLookup: "d1", DivisionShortName: "BLD", DivisionName: "Buildings", Name: "Project Manager" },
];
const USERS = [{
  Id: PERSON_ID, Name: PERSON_NAME, JobProfile: "Senior Engineer",
  Role: "Project Manager", DivisionName: "Civil", DivisionId: "d2",
  Department: "", DepartmentId: "", UserName: "pat@example.test", Email: "pat@example.test",
}];
const BUSINESS_UNITS = [
  { ID: "bu1", ShortName: "East" },
  { ID: "bu2", ShortName: "West" },
];

// ── fetch stub: records every write; read endpoints serve the fixture ──────
const assignCalls: { url: string; body: Record<string, unknown> }[] = [];
const updateFieldsCalls: { body: Record<string, unknown> }[] = [];
let updateFieldsResponse: () => unknown = () => ({ ok: true, updated: ["DivisionLookup", "DivisionMultiLookup"] });

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = url.split("?")[0];
  const method = (init?.method ?? "GET").toUpperCase();
  if (path.endsWith("/assign-resource") && method === "POST") {
    assignCalls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return new Response("true", { status: 200 });
  }
  if (path.endsWith("/update-fields") && method === "POST") {
    updateFieldsCalls.push({ body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return jsonResponse(updateFieldsResponse());
  }
  if (path.endsWith("/divisions")) return jsonResponse(DIVISIONS);
  if (path.endsWith("/project-division-roles")) return jsonResponse(PROJECT_ROLES);
  if (path.endsWith("/user-list")) return jsonResponse(USERS);
  if (path.endsWith("/business-units-list")) return jsonResponse(BUSINESS_UNITS);
  if (path.endsWith("/job-titles") || path.endsWith("/departments")) return jsonResponse([]);
  // Everything else (availability, roles-by-bu, …) — harmless empty list.
  return jsonResponse([]);
}) as typeof fetch;

// Imported dynamically so the shims above are installed first.
const React = (await import("react")).default;
const { default: TestRenderer, act } = await import("react-test-renderer");
const { useAssignMemberCascade } = await import("../../hooks/useAssignMemberCascade");

type Cascade = ReturnType<typeof useAssignMemberCascade>;

// Watchdog: a broken one-shot (armed ref never cleared) makes the
// auto-continue effect resubmit forever, which hangs act()/flush() instead of
// tripping an assertion. Convert that hang into a loud, fast failure. The
// healthy run finishes in a few seconds.
const WATCHDOG = setTimeout(() => {
  console.error(
    `FAIL: test did not finish within 60s — likely an auto-continue submit loop ` +
    `(assign-resource calls so far: ${assignCalls.length})`,
  );
  process.exit(1);
}, 60_000);
void WATCHDOG;

// Let every queued microtask/timer turn (fetch responses, the auto-continue
// effect, submit()'s awaits) settle between assertions.
async function flush(turns = 12): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

interface Scenario {
  out: { current: Cascade | null };
  assigned: string[];
  closed: number[];
  renderer: ReturnType<typeof TestRenderer.create>;
  cascade: () => Cascade;
  assignBaseline: number;
  updateBaseline: number;
}

async function openWorkspace(opts?: { strictMode?: boolean }): Promise<Scenario> {
  const out: { current: Cascade | null } = { current: null };
  const assigned: string[] = [];
  const closed: number[] = [];
  function Harness(): null {
    out.current = useAssignMemberCascade({
      active: true,
      projectId: PROJECT,
      projectName: "Harbor Tower",
      projectStartDate: "2026-01-05",
      projectEndDate: "2026-06-26",
      existingAllocations: [],
      onAssigned: (name: string) => { assigned.push(name); },
      onClose: () => { closed.push(1); },
    });
    return null;
  }
  const tree = opts?.strictMode
    ? React.createElement(React.StrictMode, null, React.createElement(Harness))
    : React.createElement(Harness);
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await act(async () => { renderer = TestRenderer.create(tree); });
  await flush();
  const scenario: Scenario = {
    out, assigned, closed, renderer,
    cascade: () => {
      assert.ok(out.current, "harness did not render the cascade hook");
      return out.current!;
    },
    assignBaseline: assignCalls.length,
    updateBaseline: updateFieldsCalls.length,
  };
  // Roster loaded: the project's BU (d1) is auto-picked.
  assert.equal(scenario.cascade().bu, "d1", "project division should be auto-selected after load");
  return scenario;
}

/** Pick the cross-BU person, then click "Add to team" → popup must open with no write. */
async function pickCrossBuPersonAndStartAdd(s: Scenario): Promise<void> {
  await act(async () => { s.cascade().setPicker("person"); });
  await act(async () => { s.cascade().applyPick(PERSON_ID, PERSON_NAME); });
  await flush(4);
  const afterPick = s.cascade();
  assert.equal(afterPick.personId, PERSON_ID);
  assert.equal(afterPick.role, "Project Manager", "person pick should infer the role");
  // Selection alone is only a PENDING mismatch — popup not open yet.
  assert.equal(afterPick.buMismatch, null, "popup must not open from selection alone");
  assert.equal(afterPick.canSubmit, true, "Add to team must be clickable for the cross-BU person");

  await act(async () => { await s.cascade().submit(); });
  await flush(4);
  const afterAddClick = s.cascade();
  assert.ok(afterAddClick.buMismatch, "Add to team must open the cross-BU confirmation");
  assert.equal(afterAddClick.buMismatch?.divisionId, "d2");
  assert.equal(assignCalls.length, s.assignBaseline, "no assignment write while the popup is open");
  assert.equal(updateFieldsCalls.length, s.updateBaseline, "no BU write before the manager confirms");
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1 — confirm: BU write succeeds → submit resumes automatically →
// exactly ONE assign-resource call, then the flow closes.
{
  const s = await openWorkspace();
  await pickCrossBuPersonAndStartAdd(s);

  await act(async () => { await s.cascade().addBuToProject(); });
  await flush();

  assert.equal(updateFieldsCalls.length, s.updateBaseline + 1, "confirm performs exactly one BU write");
  assert.equal(assignCalls.length, s.assignBaseline + 1, "confirmed add must produce exactly ONE assignment write");
  const written = assignCalls[assignCalls.length - 1].body;
  const alloc = (written.Allocations as Record<string, unknown>[])[0];
  assert.equal(written.ProjectID, PROJECT);
  assert.equal(alloc.AssignedTo, PERSON_ID);
  assert.equal(alloc.ID, 0, "confirmed add is a NEW assignment insert");
  assert.deepEqual(s.assigned, [PERSON_NAME], "onAssigned fires once with the person");
  assert.equal(s.closed.length, 1, "the workspace closes once after the resumed submit");
  assert.equal(s.cascade().buMismatch, null, "popup is gone after confirm");

  // The one-shot must not re-fire on later commits (submitting flips back to
  // false, which re-runs the auto-continue effect one more time).
  await flush();
  await act(async () => { s.cascade().setStartDate("2026-02-02"); });
  await flush();
  assert.equal(assignCalls.length, s.assignBaseline + 1, "no second submit after the one-shot consumed itself");
  assert.equal(s.assigned.length, 1);
  await act(async () => { s.renderer.unmount(); });
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2 — cancel: popup dismissed → person selection cleared, ZERO writes.
{
  const s = await openWorkspace();
  await pickCrossBuPersonAndStartAdd(s);

  await act(async () => { s.cascade().dismissBuMismatch(); });
  await flush();

  const afterCancel = s.cascade();
  assert.equal(afterCancel.buMismatch, null, "cancel closes the popup");
  assert.equal(afterCancel.personId, "", "cancel abandons the person pick");
  assert.equal(afterCancel.personName, "");
  assert.equal(updateFieldsCalls.length, s.updateBaseline, "cancel never writes the BU");
  assert.equal(assignCalls.length, s.assignBaseline, "cancel never writes an assignment");
  assert.equal(s.assigned.length, 0);
  assert.equal(s.closed.length, 0, "cancel keeps the workspace open");
  await act(async () => { s.renderer.unmount(); });
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3 — failed BU write: error shown in the popup, popup stays open,
// no assignment write, no auto-continue.
{
  const s = await openWorkspace();
  await pickCrossBuPersonAndStartAdd(s);

  updateFieldsResponse = () => ({ ok: false, error: "Division update failed" });
  try {
    await act(async () => { await s.cascade().addBuToProject(); });
    await flush();

    const afterFail = s.cascade();
    assert.equal(updateFieldsCalls.length, s.updateBaseline + 1, "the failed BU write was attempted once");
    assert.equal(afterFail.buMismatchError, "Division update failed", "the popup shows the server's error");
    assert.ok(afterFail.buMismatch, "the popup stays open after a failed BU write");
    assert.equal(assignCalls.length, s.assignBaseline, "a failed BU write must never arm the auto-continue");
    assert.equal(s.assigned.length, 0);
    assert.equal(s.closed.length, 0);

    // Dismissing after the failure must also stay write-free.
    await act(async () => { s.cascade().dismissBuMismatch(); });
    await flush();
    assert.equal(assignCalls.length, s.assignBaseline, "no write sneaks in after dismissing the failed popup");
  } finally {
    updateFieldsResponse = () => ({ ok: true, updated: ["DivisionLookup", "DivisionMultiLookup"] });
  }
  await act(async () => { s.renderer.unmount(); });
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4 — StrictMode: dev double-invoked effects (mount/re-run) must not
// turn one confirmed add into two submits.
{
  const s = await openWorkspace({ strictMode: true });
  await pickCrossBuPersonAndStartAdd(s);

  await act(async () => { await s.cascade().addBuToProject(); });
  await flush();

  assert.equal(assignCalls.length, s.assignBaseline + 1, "StrictMode double-effects must still yield exactly ONE assignment write");
  assert.deepEqual(s.assigned, [PERSON_NAME]);
  assert.equal(s.closed.length, 1);
  await flush();
  assert.equal(assignCalls.length, s.assignBaseline + 1, "still exactly one write after settling");
  await act(async () => { s.renderer.unmount(); });
}

console.log("cross-BU auto-continue integration checks passed");
process.exit(0);
