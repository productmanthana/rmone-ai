/**
 * Browser regression: a BRAND-NEW team member with zero booked hours can be
 * given hours from the ExistingWorkTimelineModal popup.
 *
 * Pins the two fixes that made this work:
 *  1. `workload.projects` (the server's date-independent second recordset)
 *     seeds a visible all-zero row for every assignment that produced no
 *     bucketed `weeks` rows (zero-hour / out-of-window assignments).
 *  2. When the workload has memberships but NO bucketed weeks at all, the
 *     modal synthesizes a 12-week Monday planning window so those rows render
 *     editable "+" cells instead of a zero-column grid.
 *
 * Scenario A — membership-only workload (projects[] set, weeks[] empty):
 *   every listed project renders, a 12-week Monday grid renders, and a cell
 *   edit fires the real save pipeline with the right projectId + weekStart.
 * Scenario B — mixed workload (real bucketed weeks + one zero-hour project):
 *   the zero-hour project renders WITH editable cells alongside the real
 *   weeks, and editing it saves against the right project + Monday.
 *
 * The full production save path runs (saveMemberWeeklyHours → fresh team read
 * → allocation identity match → POST /hours-allocation → verification read);
 * only window.fetch is mocked. The runner freezes Date at 2031-05-14T12:00:00Z
 * (a Wednesday) so the synthesized window is deterministic.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { ExistingWorkTimelineModal } from "@/components/ExistingWorkTimelineModal";
import type { ProjectTeamMember, ResourceWeekAllocations } from "@/lib/api";

const PERSON = "7f2c1e5a-9b3d-4c8e-a1f6-2d5b8c9e0a41";
const PERSON_NAME = "Jordan Blake";
const PERSON_ROLE = "Project Engineer";
// One project-module and one opportunity-module ticket so BOTH past-edit rule
// branches (PMM vs OPM) are exercised across the two scenarios.
const PROJECT_A = "PMM-31-0007";
const PROJECT_A_NAME = "Harbor Tower";
const PROJECT_B = "OPM-31-0021";
const PROJECT_B_NAME = "Beacon Bid";
const FULL_WEEK_HOURS = 40;

// The 12 UTC Mondays the modal must synthesize for the frozen clock
// (2031-05-14 is a Wednesday; the current week's Monday is 2031-05-12).
// Independent literals — NOT computed with the component's own arithmetic —
// so a regression in its Monday math cannot cancel out here.
const EXPECTED_MONDAYS = [
  "2031-05-12", "2031-05-19", "2031-05-26", "2031-06-02",
  "2031-06-09", "2031-06-16", "2031-06-23", "2031-06-30",
  "2031-07-07", "2031-07-14", "2031-07-21", "2031-07-28",
];

function parseYmd(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Human week label exactly as the modal renders it ("May 12"). */
function labelOf(week: string): string {
  return parseYmd(week).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Mock server state ─────────────────────────────────────────────────────────
// Weekly truth per project; /hours-allocation POSTs apply here so the save
// pipeline's verification read confirms against what was actually written.
const serverWeeksByProject: Record<string, Record<string, number>> = {
  [PROJECT_A]: {},
  [PROJECT_B]: {},
};

type CapturedSave = {
  projectId: string;
  assignedTo: string;
  weeks: Record<string, number>;
  rowCount: number;
};
const hoursSaves: CapturedSave[] = [];
let savedCallbacks = 0;
const fetchLog: string[] = [];

function teamMemberFor(projectId: string): ProjectTeamMember {
  const weekMap = serverWeeksByProject[projectId] ?? {};
  return {
    name: PERSON_NAME,
    role: PERSON_ROLE,
    bu: "Structures",
    title: "Engineer",
    eacHrs: 0,
    etcHrs: 0,
    costRate: 0,
    eacCost: 0,
    etcCost: 0,
    ncHrs: 0,
    ncCost: 0,
    pctAllocation: 0,
    startDate: "",
    endDate: "",
    resourceId: PERSON,
    // Brand-new member: starts with NO weekly rows at all; saved weeks appear
    // here afterwards so the production verification read can match.
    weeklyHours: Object.entries(weekMap).map(([week, hours]) => ({ week, hours })),
    isLocked: false,
  };
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(rawUrl, window.location.href);
  const path = url.pathname;
  fetchLog.push(`${init?.method ?? "GET"} ${path.split("/").slice(-1)[0]}`);

  if (path.endsWith("/project-team")) {
    const projectId = url.searchParams.get("projectID") ?? "";
    return jsonResponse({ team: [teamMemberFor(projectId)], openRoles: [] });
  }

  if (path.endsWith("/project-allocations") && init?.method === "POST") {
    const body = JSON.parse(String(init.body ?? "{}")) as { ProjectID?: string };
    const projectId = String(body.ProjectID ?? "");
    // The zero-hour membership still has a real RA identity row — that is
    // exactly what the date-independent projects[] recordset represents.
    return jsonResponse({
      ExistingAllocations: [{
        ID: 500,
        ProjectID: projectId,
        AssignedTo: PERSON,
        AssignedToName: PERSON_NAME,
        TypeName: PERSON_ROLE,
        RoleName: PERSON_ROLE,
        PctAllocation: 0,
        Percentage: 0,
      }],
      NewAllocations: [],
    });
  }

  if (path.endsWith("/hours-allocation") && init?.method === "POST") {
    const body = JSON.parse(String(init.body ?? "{}")) as {
      ProjectID?: string;
      Allocations?: Array<Record<string, unknown>>;
    };
    const projectId = String(body.ProjectID ?? "");
    const rows = body.Allocations ?? [];
    const weeks: Record<string, number> = {};
    for (const row of rows) {
      const week = String(row.AllocationStartDate ?? "").slice(0, 10);
      const hours = Number(row.AllocationHour ?? row.PctAllocation);
      if (/^\d{4}-\d{2}-\d{2}$/.test(week) && Number.isFinite(hours)) weeks[week] = hours;
    }
    hoursSaves.push({
      projectId,
      assignedTo: String(rows[0]?.AssignedTo ?? ""),
      weeks,
      rowCount: rows.length,
    });
    Object.assign(serverWeeksByProject[projectId] ??= {}, weeks);
    return jsonResponse({ ok: true });
  }

  if (path.startsWith("/api/")) {
    return jsonResponse([]);
  }
  return originalFetch(input, init);
};

localStorage.setItem("rmone_token", "browser-test-token");
localStorage.setItem("rmone_username", "browser-test-admin");
localStorage.setItem("rmone_tenant", "browser-test-tenant");

// ── DOM helpers ───────────────────────────────────────────────────────────────
function nextPaint(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function waitUntil(predicate: () => boolean, message: string | (() => string)): Promise<void> {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > 5_000) {
      throw new Error(typeof message === "function" ? message() : message);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await nextPaint();
}

function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** All "+" (add hours) cells for one project row, in DOM (week) order. */
function addButtons(projectName: string): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .filter(button => (button.getAttribute("aria-label") ?? "").startsWith(`Add hours for ${projectName}, week of `));
}

function addButtonLabels(projectName: string): string[] {
  const prefix = `Add hours for ${projectName}, week of `;
  return addButtons(projectName).map(button => (button.getAttribute("aria-label") ?? "").slice(prefix.length));
}

function bookedCell(projectName: string, week: string, hours: string): Element | null {
  return document.querySelector(`[title="Edit ${projectName} · week of ${labelOf(week)} · ${hours}h"]`);
}

async function editCell(projectName: string, week: string, hours: number): Promise<void> {
  const button = addButtons(projectName)
    .find(item => item.getAttribute("aria-label") === `Add hours for ${projectName}, week of ${labelOf(week)}`);
  if (!button) {
    throw new Error(`No "+" cell for ${projectName} / ${week}; labels: ${JSON.stringify(addButtonLabels(projectName))}`);
  }
  button.click();
  await nextPaint();
  const input = document.querySelector<HTMLInputElement>(
    `input[aria-label="Hours for ${projectName}, week of ${labelOf(week)}"]`,
  );
  if (!input) {
    const arias = Array.from(document.querySelectorAll("input")).map(item => item.getAttribute("aria-label"));
    throw new Error(`The inline hours editor did not mount for ${projectName} / ${week}. Inputs: ${JSON.stringify(arias)}`);
  }
  changeInput(input, String(hours));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await nextPaint();
}

function expectSave(index: number, expected: CapturedSave, label: string): void {
  const save = hoursSaves[index];
  if (!save) throw new Error(`${label}: save #${index + 1} was never posted; fetches=${JSON.stringify(fetchLog.slice(-20))}`);
  if (save.projectId !== expected.projectId) {
    throw new Error(`${label}: save targeted project "${save.projectId}" instead of "${expected.projectId}"`);
  }
  if (save.assignedTo !== expected.assignedTo) {
    throw new Error(`${label}: save carried AssignedTo "${save.assignedTo}" instead of the person GUID`);
  }
  if (save.rowCount !== expected.rowCount) {
    throw new Error(`${label}: expected ${expected.rowCount} allocation row(s), got ${save.rowCount}: ${JSON.stringify(save.weeks)}`);
  }
  const gotWeeks = JSON.stringify(save.weeks);
  const wantWeeks = JSON.stringify(expected.weeks);
  if (gotWeeks !== wantWeeks) {
    throw new Error(`${label}: saved week map ${gotWeeks} instead of ${wantWeeks}`);
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
type Fixture = { key: string; workload: ResourceWeekAllocations; weekStarts: string[] };

/** Scenario A: brand-new member — memberships exist, but EVERY assignment is
 *  zero-hour, so the workload has projects[] entries and zero weeks rows.
 *  quick-actions derives weekStarts from weeks rows, so it passes []. */
const membershipOnlyFixture: Fixture = {
  key: "membership-only",
  workload: {
    resourceId: PERSON,
    start: "2030-08-25",
    end: "2032-08-25",
    fullWeekHours: FULL_WEEK_HOURS,
    weeks: [],
    projects: [
      { projectId: PROJECT_A, projectName: PROJECT_A_NAME },
      { projectId: PROJECT_B, projectName: PROJECT_B_NAME },
    ],
  },
  weekStarts: [],
};

/** Scenario B: mixed — real bucketed weeks on one project plus a second,
 *  zero-hour project that only the projects[] recordset knows about. */
const week0 = EXPECTED_MONDAYS[0];
const week1 = EXPECTED_MONDAYS[1];
function bucket(weekStart: string, hours: number, id: number) {
  const end = new Date(weekStart + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 6);
  return {
    projectId: PROJECT_A,
    projectName: PROJECT_A_NAME,
    weekStart,
    weekEnd: end.toISOString().slice(0, 10),
    hours,
    pct: Math.round((hours / FULL_WEEK_HOURS) * 10000) / 100,
    allocationIds: [id],
    isLocked: false,
    isNonChargeable: false,
    isSoftAllocation: false,
  };
}
const mixedFixture: Fixture = {
  key: "mixed",
  workload: {
    resourceId: PERSON,
    start: "2030-08-25",
    end: "2032-08-25",
    fullWeekHours: FULL_WEEK_HOURS,
    weeks: [bucket(week0, 16, 9101), bucket(week1, 8, 9102)],
    projects: [
      { projectId: PROJECT_A, projectName: PROJECT_A_NAME },
      { projectId: PROJECT_B, projectName: PROJECT_B_NAME },
    ],
  },
  weekStarts: [week0, week1],
};

// ── Mount ─────────────────────────────────────────────────────────────────────
const root = createRoot(document.getElementById("root")!);

function Shell({ fixture }: { fixture: Fixture }) {
  return (
    <ExistingWorkTimelineModal
      key={fixture.key}
      personName={PERSON_NAME}
      personId={PERSON}
      personRole={PERSON_ROLE}
      workload={fixture.workload}
      weekStarts={fixture.weekStarts}
      canEdit
      onClose={() => {}}
      onOpenProject={() => {}}
      onSaved={() => { savedCallbacks++; }}
    />
  );
}

async function mount(fixture: Fixture): Promise<void> {
  root.render(<Shell fixture={fixture} />);
  await nextPaint();
}

// ── Scenarios ─────────────────────────────────────────────────────────────────
async function runRegression(): Promise<void> {
  // The runner freezes the clock; every Monday below depends on it.
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (localToday !== "2031-05-14") {
    throw new Error(`Harness clock is not frozen (today=${localToday}); run via check-existing-work-timeline-browser.mjs`);
  }
  for (const monday of EXPECTED_MONDAYS) {
    if (new Date(monday + "T00:00:00Z").getUTCDay() !== 1) {
      throw new Error(`Fixture literal ${monday} is not a Monday`);
    }
  }

  console.info("scenario: membership-only (zero weeks) workload");
  await mount(membershipOnlyFixture);
  await waitUntil(
    () => Boolean(document.querySelector('[role="dialog"]')),
    "The existing-work timeline modal did not mount",
  );
  const bodyText = () => document.body.textContent ?? "";
  if (!bodyText().includes(PROJECT_A_NAME) || !bodyText().includes(PROJECT_B_NAME)) {
    throw new Error("Membership-only: a zero-hour project row is missing from the popup "
      + `(need "${PROJECT_A_NAME}" and "${PROJECT_B_NAME}")`);
  }
  if (!bodyText().includes("2 projects")) {
    throw new Error(`Membership-only: header did not count both memberships; header text: "${bodyText().slice(0, 300)}"`);
  }
  const expectedLabels = EXPECTED_MONDAYS.map(labelOf);
  for (const name of [PROJECT_A_NAME, PROJECT_B_NAME]) {
    const labels = addButtonLabels(name);
    if (JSON.stringify(labels) !== JSON.stringify(expectedLabels)) {
      throw new Error(`Membership-only: ${name} must render the synthesized 12-week Monday grid `
        + `${JSON.stringify(expectedLabels)}, got ${JSON.stringify(labels)}`);
    }
  }

  // Give the brand-new member their FIRST hours: 12h in the third week.
  const targetWeek = EXPECTED_MONDAYS[2];
  await editCell(PROJECT_A_NAME, targetWeek, 12);
  await waitUntil(
    () => hoursSaves.length === 1 && savedCallbacks === 1,
    () => `Membership-only: the cell edit did not complete a verified save; `
      + `saves=${JSON.stringify(hoursSaves)} confirmed=${savedCallbacks} fetches=${JSON.stringify(fetchLog.slice(-20))} `
      + `body="${bodyText().slice(0, 400)}"`,
  );
  expectSave(0, {
    projectId: PROJECT_A,
    assignedTo: PERSON,
    weeks: { [targetWeek]: 12 },
    rowCount: 1,
  }, "Membership-only");
  await waitUntil(
    () => Boolean(bookedCell(PROJECT_A_NAME, targetWeek, "12")),
    "Membership-only: the saved cell did not show 12h",
  );
  if (bodyText().includes("Could not save") || bodyText().includes("Reload the page")) {
    throw new Error(`Membership-only: save surfaced an error: "${bodyText().slice(0, 400)}"`);
  }

  console.info("scenario: mixed workload (real weeks + zero-hour project)");
  await mount(mixedFixture);
  await waitUntil(
    () => Boolean(bookedCell(PROJECT_A_NAME, week0, "16")),
    () => `Mixed: the real 16h bucket did not render; body="${bodyText().slice(0, 400)}"`,
  );
  if (!bookedCell(PROJECT_A_NAME, week1, "8")) {
    throw new Error("Mixed: the real 8h bucket did not render as an editable booked cell");
  }
  // The zero-hour project must render WITH editable "+" cells for exactly the
  // real weeks in range — alongside (not instead of) the booked rows.
  const zeroLabels = addButtonLabels(PROJECT_B_NAME);
  if (JSON.stringify(zeroLabels) !== JSON.stringify([labelOf(week0), labelOf(week1)])) {
    throw new Error(`Mixed: zero-hour project must expose editable cells for both real weeks, got ${JSON.stringify(zeroLabels)}`);
  }
  if (addButtons(PROJECT_A_NAME).length !== 0) {
    throw new Error("Mixed: fully-booked project rows must not grow phantom '+' cells");
  }

  await editCell(PROJECT_B_NAME, week1, 6);
  await waitUntil(
    () => hoursSaves.length === 2 && savedCallbacks === 2,
    () => `Mixed: the zero-hour project edit did not complete a verified save; `
      + `saves=${JSON.stringify(hoursSaves)} confirmed=${savedCallbacks} fetches=${JSON.stringify(fetchLog.slice(-20))}`,
  );
  expectSave(1, {
    projectId: PROJECT_B,
    assignedTo: PERSON,
    weeks: { [week1]: 6 },
    rowCount: 1,
  }, "Mixed");
  await waitUntil(
    () => Boolean(bookedCell(PROJECT_B_NAME, week1, "6")),
    "Mixed: the zero-hour project's saved cell did not show 6h",
  );
  if (!bookedCell(PROJECT_A_NAME, week0, "16")) {
    throw new Error("Mixed: saving the zero-hour project must not disturb the real booked cells");
  }
}

runRegression()
  .then(() => {
    document.documentElement.dataset.testStatus = "passed";
    document.documentElement.dataset.testDetail = "all assertions passed";
  })
  .catch(error => {
    document.documentElement.dataset.testStatus = "failed";
    document.documentElement.dataset.testDetail = error instanceof Error ? error.stack || error.message : String(error);
    console.error(error);
  });
