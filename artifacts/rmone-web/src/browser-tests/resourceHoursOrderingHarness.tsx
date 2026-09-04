import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
// The app mounts the toast viewport at the root (App.tsx); the harness must
// mirror that or toast-reported failures (e.g. the hours-save verification
// mismatch warning) never reach document.body and the scenarios can't see them.
import { Toaster } from "@/components/ui/toaster";
import Resources, {
  observeResourcesIntegrationController,
  type ResourcesIntegrationController,
} from "@/pages/resources";
import { AuthContext, type AuthContextType } from "@/lib/auth-context";
import type { LiveResourceProxy } from "@/lib/api";
import type { ResourceProjectWeekEdit } from "@/components/ResourcesTimelineGrid";
import type { UtilMode } from "@/lib/utilGrid";

const PERSON = "aaaaaaaa-0000-0000-0000-000000000001";
const PROJECT = "PMM-26-001";
const OTHER_PROJECT = "OPM-26-002";
const WORK_WEEK = 40;
const PERIOD_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function localDateKey(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function utilizationPeriod(value: Date): string {
  return `${PERIOD_MONTHS[value.getMonth()]}-${String(value.getDate()).padStart(2, "0")}-${String(value.getFullYear()).slice(-2)}`;
}

// Keep the fixture inside whatever quarter Resources selects from the runtime
// clock. The second Monday is safely inside the quarter even when day one is
// itself a Monday, and avoids the test aging out of Staff's selected window.
const runtimeNow = new Date();
const quarterStart = new Date(
  runtimeNow.getFullYear(),
  Math.floor(runtimeNow.getMonth() / 3) * 3,
  1,
  12,
);
const fixtureMonday = new Date(quarterStart);
fixtureMonday.setDate(1 + ((8 - quarterStart.getDay()) % 7) + 7);
const fixtureSunday = new Date(fixtureMonday);
fixtureSunday.setDate(fixtureMonday.getDate() + 6);
const fixtureMonthStart = new Date(fixtureMonday.getFullYear(), fixtureMonday.getMonth(), 1, 12);
// Three consecutive Monday buckets so multiple weekly cells can fold into one
// bulk save. The second Monday lands on day 8-14, so +14 days stays inside the
// fixture month (and quarter) in every quarter.
const fixtureWeekStarts = [0, 7, 14].map(offset => {
  const monday = new Date(fixtureMonday);
  monday.setDate(fixtureMonday.getDate() + offset);
  return monday;
});
const WEEKS = fixtureWeekStarts.map(localDateKey);
const WEEK_ENDS = fixtureWeekStarts.map(monday => {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return localDateKey(sunday);
});
const WEEK_PERIODS = fixtureWeekStarts.map(utilizationPeriod);
const WEEK = WEEKS[0];
const WEEK_END = WEEK_ENDS[0];
const WEEK2 = WEEKS[1];
const WEEK3 = WEEKS[2];
const MONTH_PERIOD = utilizationPeriod(fixtureMonthStart);

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
type ViewRequest = {
  kind: "allocation" | "utilization";
  mode: UtilMode;
  deferred: Deferred<Response>;
  resolved: boolean;
};

type HarnessApi = {
  reset: (mode?: UtilMode) => Promise<void>;
  startControllerEdit: (hours: number) => Promise<void>;
  startTimelineEdit: (hours: number) => Promise<void>;
  startTimelineEditWeek: (week: string, hours: number) => Promise<void>;
  switchMode: (mode: UtilMode) => Promise<void>;
  waitForRequests: (allocation: number, utilization: number) => Promise<void>;
  requests: () => ViewRequest[];
  resolve: (request: ViewRequest, hours: number) => void;
  resolveTruth: (request: ViewRequest) => void;
  /** Hold each /hours-allocation POST open until resolveSave releases it —
   *  the fast save path resolves the visible save at acceptance (when the
   *  POST returns), so folding can only be observed with a held POST. */
  setDelaySaves: (on: boolean) => void;
  saveRequests: () => SaveRequest[];
  resolveSave: (request: SaveRequest) => void;
  hoursSaves: () => Array<Record<string, number>>;
  setPerConsumerBodies: (on: boolean) => void;
  setIndependentViewRequests: (on: boolean) => void;
  triggerViewRefresh: () => Promise<void>;
  mismatchNextSave: () => void;
  flush: () => Promise<void>;
};

declare global {
  interface Window {
    __resourceHoursHarness?: HarnessApi;
  }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Project One carries one Monday-aligned allocation entry per week that has
// hours; Other Project stays a single 10h entry on the first week so summary
// cells keep their historical "2 projects" shape.
function resourceWithWeeks(weeks: Record<string, number>): LiveResourceProxy {
  const allocations = WEEKS.flatMap((week, index) => {
    const hours = weeks[week] ?? 0;
    if (hours <= 0) return [];
    return [{
      projectId: PROJECT,
      projectName: "Project One",
      pct: hours / WORK_WEEK * 100,
      hours,
      startDate: week,
      endDate: WEEK_ENDS[index],
    }];
  });
  allocations.push({ projectId: OTHER_PROJECT, projectName: "Other Project", pct: 25, hours: 10, startDate: WEEK, endDate: WEEK_END });
  return {
    id: PERSON,
    name: "Alex Chen",
    username: "alex@example.test",
    role: "Project Manager",
    roleName: "Project Manager",
    currentPct: ((weeks[WEEK] ?? 0) + 10) / WORK_WEEK * 100,
    totalProjects: 2,
    allProjectIds: [PROJECT, OTHER_PROJECT],
    activeProjects: [PROJECT, OTHER_PROJECT],
    activeAllocations: allocations,
    allAllocations: [...allocations],
    lastActiveDate: WEEK_END,
  };
}

function utilRows(mode: UtilMode, weeks: Record<string, number>): Record<string, unknown>[] {
  if (mode === "Monthly") {
    const projectTotal = WEEKS.reduce((sum, week) => sum + (weeks[week] ?? 0), 0);
    const totalHours = projectTotal + 10;
    const totalPct = Math.round(totalHours / WORK_WEEK * 100);
    return [{
      UserId: PERSON,
      ResourceUser: "Alex Chen",
      [MONTH_PERIOD]: `P:${totalPct}#H:${totalHours}#C:2#F:${(totalPct / 100).toFixed(2)}#A:${Math.max(0, 100 - totalPct)}#S:Good#IDS:${PROJECT}:${Math.round(projectTotal / WORK_WEEK * 100)}|${OTHER_PROJECT}:25`,
    }];
  }
  const row: Record<string, unknown> = { UserId: PERSON, ResourceUser: "Alex Chen" };
  WEEKS.forEach((week, index) => {
    const projectHours = weeks[week] ?? 0;
    const otherHours = index === 0 ? 10 : 0;
    const totalHours = projectHours + otherHours;
    const totalPct = Math.round(totalHours / WORK_WEEK * 100);
    const ids = [
      ...(projectHours > 0 ? [`${PROJECT}:${Math.round(projectHours / WORK_WEEK * 100)}`] : []),
      ...(otherHours > 0 ? [`${OTHER_PROJECT}:25`] : []),
    ];
    row[WEEK_PERIODS[index]] =
      `P:${totalPct}#H:${totalHours}#C:${ids.length}#F:${(totalPct / 100).toFixed(2)}#A:${Math.max(0, 100 - totalPct)}#S:${totalPct >= 40 ? "Good" : "Under"}`
      + (ids.length > 0 ? `#IDS:${ids.join("|")}` : "");
  });
  return [row];
}

function teamMember() {
  return {
    name: "Alex Chen",
    role: "Project Manager",
    bu: "Design",
    title: "PM",
    eacHrs: 0,
    etcHrs: 0,
    costRate: 0,
    eacCost: 0,
    etcCost: 0,
    ncHrs: 0,
    ncCost: 0,
    pctAllocation: 100,
    startDate: WEEK,
    endDate: WEEK_ENDS[WEEK_ENDS.length - 1],
    resourceId: PERSON,
    weeklyHours: WEEKS.map(week => ({ week, hours: serverWeeks[week] ?? 0 })),
    isLocked: false,
  };
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 0 },
    mutations: { retry: false },
  },
});

let controller: ResourcesIntegrationController | null = null;
observeResourcesIntegrationController(value => { controller = value; });
let serverWeeks: Record<string, number> = { [WEEK]: 26 };
const hoursSaveBodies: Array<Record<string, number>> = [];
let mismatchNext = false;
let delayViews = false;
let viewRequests: ViewRequest[] = [];
let independentViewRequests = false;
let delaySaves = false;
let saveRequests: SaveRequest[] = [];
const activeControllerSaves = new Set<Promise<void>>();

interface SaveRequest {
  deferred: Deferred<Response>;
  resolved: boolean;
}

/* Concurrent page reads (save refresh + data-sync bus + confirmed listener)
   share one pending delayed request. A Response body is single-use, so when
   several fetch calls await the same deferred, only ONE consumer's json()
   succeeds. Scenarios opt in to per-consumer body clones so every consumer
   receives the production-equivalent response. */
let perConsumerBodies = false;
function handOutDelayed(promise: Promise<Response>): Promise<Response> {
  return perConsumerBodies ? promise.then(response => response.clone()) : promise;
}

const fetchLog: string[] = [];
const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(rawUrl, window.location.href);
  const path = url.pathname;
  fetchLog.push(`${init?.method ?? "GET"} ${path.split("/").slice(-1)[0]}`);

  if (path.endsWith("/resource-allocations")) {
    if (delayViews) {
      const existing = independentViewRequests
        ? undefined
        : viewRequests.find(request => request.kind === "allocation" && !request.resolved);
      if (existing) return handOutDelayed(existing.deferred.promise);
      const request: ViewRequest = {
        kind: "allocation",
        mode: "Weekly",
        deferred: deferred<Response>(),
        resolved: false,
      };
      viewRequests.push(request);
      return handOutDelayed(request.deferred.promise);
    }
    return jsonResponse({ resources: [resourceWithWeeks(serverWeeks)] });
  }

  if (path.endsWith("/allocation-utilization")) {
    const mode = (url.searchParams.get("mode") === "Monthly" ? "Monthly" : "Weekly") as UtilMode;
    if (delayViews) {
      const existing = independentViewRequests
        ? undefined
        : viewRequests.find(request =>
          request.kind === "utilization" && request.mode === mode && !request.resolved
        );
      if (existing) return handOutDelayed(existing.deferred.promise);
      const request: ViewRequest = {
        kind: "utilization",
        mode,
        deferred: deferred<Response>(),
        resolved: false,
      };
      viewRequests.push(request);
      return handOutDelayed(request.deferred.promise);
    }
    return jsonResponse(utilRows(mode, serverWeeks));
  }

  if (path.endsWith("/project-team")) {
    return jsonResponse({ team: [teamMember()], openRoles: [] });
  }

  if (path.endsWith("/project-allocations") && init?.method === "POST") {
    return jsonResponse({
      ExistingAllocations: [{
        AssignedTo: PERSON,
        AssignedToName: "Alex Chen",
        TypeName: "Project Manager",
        RoleName: "Project Manager",
      }],
      NewAllocations: [],
    });
  }

  if (path.endsWith("/hours-allocation") && init?.method === "POST") {
    // The production save posts one allocation row per week in the member's
    // full week map. Apply EVERY posted row so bulk (folded) saves land whole;
    // a mismatch drops the entire write, mirroring a server-side no-op.
    const body = JSON.parse(String(init.body ?? "{}")) as { Allocations?: Array<Record<string, unknown>> };
    const saved: Record<string, number> = {};
    for (const allocation of body.Allocations ?? []) {
      const week = String(allocation.AllocationStartDate ?? "").slice(0, 10);
      const hours = Number(allocation.AllocationHour ?? allocation.PctAllocation);
      if (/^\d{4}-\d{2}-\d{2}$/.test(week) && Number.isFinite(hours)) saved[week] = hours;
    }
    hoursSaveBodies.push(saved);
    if (!mismatchNext) Object.assign(serverWeeks, saved);
    mismatchNext = false;
    if (delaySaves) {
      // Production POSTs have real latency; the folded-batch scenarios hold
      // each save open so follow-up edits land inside a REAL in-flight
      // window. The server-side effect above still applies at issue time —
      // a real server commits before its response reaches the client.
      const request: SaveRequest = { deferred: deferred<Response>(), resolved: false };
      saveRequests.push(request);
      return request.deferred.promise;
    }
    return jsonResponse({ ok: true });
  }

  if (path.endsWith("/resource-demands") || path.endsWith("/resource-conflicts")) {
    return jsonResponse({ total: 0, data: [] });
  }
  if (path.endsWith("/manager-staff") && url.searchParams.get("list") === "1") {
    return jsonResponse({ managers: [] });
  }
  if (path.endsWith("/my-capabilities")) {
    return jsonResponse({
      source: "builtin",
      caps: { manageStaff: true, editData: true, editFinancials: true },
      selfRevert: null,
    });
  }
  if (path.startsWith("/api/")) {
    return jsonResponse([]);
  }
  return originalFetch(input, init);
};

localStorage.setItem("rmone_token", "browser-test-token");
localStorage.setItem("rmone_username", "browser-test-admin");
localStorage.setItem("rmone_tenant", "browser-test-tenant");
localStorage.setItem("rmone_canEdit", "1");
localStorage.setItem("rmone_isAdmin", "1");
localStorage.setItem("rmone:staffViewMode", "grid");
history.replaceState(null, "", `${location.pathname}?view=Timeline`);

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

function buttonWithText(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button"))
    .find(button => button.textContent?.trim() === label);
}

async function switchResourceView(view: "Timeline" | "Staff"): Promise<void> {
  const button = Array.from(document.querySelectorAll("button")).find(item => {
    const text = item.textContent?.trim() ?? "";
    return view === "Staff" ? text.startsWith("Staff (") : text === "Timeline";
  });
  if (!button) throw new Error(`Could not find the real ${view} Resources tab`);
  button.click();
  await nextPaint();
}

function projectOneEditButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button"))
    .filter(button =>
      /^Edit \d+(?:\.\d+)? hours for this project\/week$/.test(button.title)
      && button.closest("tr")?.textContent?.includes("Project One")
    );
}

function findProjectOneEdit(): HTMLButtonElement | undefined {
  return projectOneEditButtons()[0];
}

/** Assert the Project One row's weekly cells (in column order) display exactly
 *  these hour values — optimistic, accepted, or rolled-back server truth. */
function expectProjectOneWeekCells(hours: number[], label: string): void {
  const buttons = projectOneEditButtons();
  if (buttons.length !== hours.length) {
    throw new Error(`${label}: expected ${hours.length} Project One week cells, found ${buttons.length}`);
  }
  hours.forEach((value, index) => {
    const expected = `Edit ${value} hours for this project/week`;
    if (buttons[index].title !== expected) {
      throw new Error(`${label}: week ${WEEKS[index]} cell shows "${buttons[index].title}" instead of "${expected}"`);
    }
  });
}

async function ensureProjectRowsExpanded(): Promise<void> {
  if (findProjectOneEdit()) return;
  const personButton = Array.from(document.querySelectorAll("button"))
    .find(button => button.title === "Open Alex Chen's workload, then edit an exact project week");
  const personCell = personButton?.closest("tr")?.querySelector("td");
  if (!personCell) throw new Error("Could not find the real Alex Chen Timeline row");
  personCell.click();
  await waitUntil(
    () => Boolean(findProjectOneEdit()),
    "The real Project One / Monday Timeline row did not expand",
  );
}

async function switchMode(mode: UtilMode): Promise<void> {
  const button = buttonWithText(mode);
  if (!button) throw new Error(`Could not find the real ${mode} Resources control`);
  button.click();
  await nextPaint();
}

function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function startTimelineEditAt(week: string, hours: number): Promise<void> {
  await ensureProjectRowsExpanded();
  const weekIndex = WEEKS.indexOf(week);
  if (weekIndex < 0) throw new Error(`Unknown fixture week ${week}`);
  const buttons = projectOneEditButtons();
  if (buttons.length !== WEEKS.length) {
    throw new Error(`Expected ${WEEKS.length} Project One week cells before editing, found ${buttons.length}`);
  }
  buttons[weekIndex].click();
  await nextPaint();
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="Project One, week of ${week}, hours"]`);
  if (!input) {
    const arias = Array.from(document.querySelectorAll("input")).map(item => item.getAttribute("aria-label"));
    throw new Error(`The real exact-week editor did not mount for ${week}. Inputs: ${JSON.stringify(arias)}`);
  }
  changeInput(input, String(hours));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

async function startTimelineEdit(hours: number): Promise<void> {
  await startTimelineEditAt(WEEK, hours);
}

function edit(hours: number): ResourceProjectWeekEdit {
  return {
    personId: PERSON,
    personName: "Alex Chen",
    role: "Project Manager",
    projectId: PROJECT,
    projectName: "Project One",
    week: WEEK,
    hours,
  };
}

const authValue: AuthContextType = {
  user: {
    username: "browser-test-admin",
    tenant: "browser-test-tenant",
    token: "browser-test-token",
    userId: PERSON,
    canEdit: true,
    isAdmin: true,
  },
  isLoading: false,
  signIn: async () => {},
  signOut: async () => {},
  handleAuthError: async () => {},
};

function HarnessRoot() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthContext.Provider value={authValue}>
          <Resources />
          <Toaster />
        </AuthContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function resolveRequestWeeks(request: ViewRequest, weeks: Record<string, number>): void {
  request.resolved = true;
  request.deferred.resolve(jsonResponse(
    request.kind === "allocation"
      ? { resources: [resourceWithWeeks(weeks)] }
      : utilRows(request.mode, weeks),
  ));
}

function resolveRequest(request: ViewRequest, hours: number): void {
  resolveRequestWeeks(request, { [WEEK]: hours });
}

window.__resourceHoursHarness = {
  reset: async (mode = "Weekly") => {
    // Release any save POST a scenario left held open BEFORE awaiting
    // controller saves — a still-held save would deadlock that wait and
    // leak an in-flight coalescer lane into the next scenario.
    delaySaves = false;
    for (const request of saveRequests) {
      if (!request.resolved) {
        request.resolved = true;
        request.deferred.resolve(jsonResponse({ ok: true }));
      }
    }
    saveRequests = [];
    if (activeControllerSaves.size > 0) {
      await Promise.allSettled([...activeControllerSaves]);
    }
    // Dismiss any toast a previous scenario left behind — the mismatch
    // warning otherwise stays mounted (toast limit 1, hour-scale remove
    // delay) and its "did not match" text would false-trip later scenarios'
    // no-error assertions.
    for (const button of Array.from(document.querySelectorAll<HTMLElement>("[toast-close]"))) {
      button.click();
    }
    await waitUntil(
      () => document.querySelectorAll("[toast-close]").length === 0,
      "reset: a lingering hours toast did not dismiss",
    );
    delayViews = false;
    mismatchNext = false;
    perConsumerBodies = false;
    independentViewRequests = false;
    serverWeeks = { [WEEK]: 26 };
    hoursSaveBodies.length = 0;
    viewRequests = [];
    for (const query of queryClient.getQueryCache().findAll({ queryKey: ["resource-allocations"] })) {
      query.setData({ resources: [resourceWithWeeks(serverWeeks)] });
    }
    for (const query of queryClient.getQueryCache().findAll({ queryKey: ["util"] })) {
      const queryMode = query.queryKey[3] === "Monthly" ? "Monthly" : "Weekly";
      query.setData(utilRows(queryMode, serverWeeks));
    }
    await switchMode(mode);
    delayViews = true;
    await nextPaint();
  },
  startControllerEdit: async hours => {
    if (!controller) throw new Error("The mounted Resources save controller is unavailable");
    const saving = controller.saveProjectWeek(edit(hours));
    activeControllerSaves.add(saving);
    void saving.catch(() => {}).finally(() => activeControllerSaves.delete(saving));
    await nextPaint();
  },
  startTimelineEdit: async hours => {
    await startTimelineEdit(hours);
    await nextPaint();
  },
  startTimelineEditWeek: async (week, hours) => {
    await startTimelineEditAt(week, hours);
    await nextPaint();
  },
  switchMode,
  waitForRequests: async (allocation, utilization) => {
    await waitUntil(
      () =>
        viewRequests.filter(request => request.kind === "allocation").length >= allocation
        && viewRequests.filter(request => request.kind === "utilization").length >= utilization,
      `Timed out waiting for ${allocation} allocation and ${utilization} utilization requests; got `
        + `${viewRequests.filter(request => request.kind === "allocation").length} allocation and `
        + `${viewRequests.filter(request => request.kind === "utilization").length} utilization`,
    );
  },
  requests: () => viewRequests,
  resolve: resolveRequest,
  resolveTruth: request => resolveRequestWeeks(request, { ...serverWeeks }),
  hoursSaves: () => hoursSaveBodies,
  setPerConsumerBodies: on => { perConsumerBodies = on; },
  setIndependentViewRequests: on => { independentViewRequests = on; },
  triggerViewRefresh: async () => {
    window.dispatchEvent(new Event("rmone:allocationConfirmed"));
    await nextPaint();
  },
  mismatchNextSave: () => { mismatchNext = true; },
  setDelaySaves: on => { delaySaves = on; },
  saveRequests: () => saveRequests.filter(request => !request.resolved),
  resolveSave: request => {
    request.resolved = true;
    request.deferred.resolve(jsonResponse({ ok: true }));
  },
  flush: nextPaint,
};

function expectRealTimeline(hours: number, total: number, label: string): void {
  const summary = Array.from(document.querySelectorAll("button"))
    .find(button => button.title.includes(`${total}h`) && button.title.includes("2 projects"));
  if (!summary) throw new Error(`${label}: real Timeline did not retain ${total}h`);
  if (!label.startsWith("Monthly")) {
    const exactCell = Array.from(document.querySelectorAll("button"))
      .find(button => button.title === `Edit ${hours} hours for this project/week`);
    if (!exactCell) throw new Error(`${label}: real Project One / Monday cell did not retain ${hours}h`);
  }
}

function expectNoAcceptedWeekOverrides(label: string): void {
  const overlays = controller?.debugAcceptedWeekOverrides() ?? [];
  if (overlays.length > 0) {
    throw new Error(`${label}: settled save left accepted-week overlays behind: ${JSON.stringify(overlays)}`);
  }
}

function expectCanonicalAllocationQueryPayload(label: string): void {
  // App prefetch, Home, Forecast, Projects, and Resources share this query
  // key. It must always remain the raw /resource-allocations payload — any
  // ordering metadata belongs inside the shared API client, never this cache.
  const data = queryClient.getQueryData(["resource-allocations"]) as {
    resources?: unknown[];
    value?: unknown;
  } | undefined;
  if (!Array.isArray(data?.resources) || "value" in (data ?? {})) {
    throw new Error(`${label}: shared resource-allocation query changed shape: ${JSON.stringify(data)}`);
  }
}

async function assertRealStaffTotal(pct: number, label: string, expandWeeklyRows: boolean): Promise<void> {
  await switchResourceView("Staff");
  const row = Array.from(document.querySelectorAll("tr"))
    .find(item => item.textContent?.includes("Alex Chen"));
  const text = row?.textContent ?? "";
  if (!text.includes(`${pct}%`)) {
    throw new Error(`${label}: real Staff allocation total flickered; row was "${text}"`);
  }
  await switchResourceView("Timeline");
  if (expandWeeklyRows) await ensureProjectRowsExpanded();
}

async function assertPopup(hours: number, total: number, label: string): Promise<void> {
  const summary = Array.from(document.querySelectorAll("button"))
    .find(button => button.title.includes(`${total}h`) && button.title.includes("2 projects"));
  summary?.click();
  await nextPaint();
  const modal = document.querySelector('[data-testid="resource-cell-detail"]');
  const text = modal?.textContent ?? "";
  if (
    !text.includes(`${total}h booked`)
    || !text.includes("Project One")
    || !text.includes(String(hours))
    || !text.toLowerCase().includes("capacity")
  ) {
    throw new Error(`${label}: real Resources popup/capacity strip did not retain the accepted values; text was "${text.slice(0, 800)}"`);
  }
}

async function closePopup(): Promise<void> {
  const modal = document.querySelector('[data-testid="resource-cell-detail"]');
  const close = modal ? Array.from(modal.querySelectorAll("button")).find(button => button.textContent?.trim() === "×") : null;
  close?.click();
  await nextPaint();
}

async function runRegression(): Promise<void> {
  const api = window.__resourceHoursHarness!;
  await waitUntil(
    () => Boolean(controller) && document.body.textContent?.includes("Alex Chen") === true,
    "The real Resources page did not finish mounting",
  );

  // Real exact-week Timeline edit: allocation completes before utilization.
  console.info("scenario: weekly allocation-first");
  await api.reset("Weekly");
  api.setPerConsumerBodies(true);
  await api.startTimelineEdit(30);
  await api.waitForRequests(1, 1);
  expectRealTimeline(30, 40, "Weekly before refresh");
  const weeklyAlloc = api.requests().find(request => request.kind === "allocation")!;
  const weeklyUtil = api.requests().find(request => request.kind === "utilization")!;
  api.resolve(weeklyAlloc, 30);
  await api.flush();
  expectRealTimeline(30, 40, "Weekly after allocation");
  await assertRealStaffTotal(100, "Weekly after allocation", true);
  expectRealTimeline(30, 40, "Weekly Staff return");
  api.resolve(weeklyUtil, 30);
  await waitUntil(
    () => {
      const exact = Array.from(document.querySelectorAll("button"))
        .find(button => button.title === "Edit 30 hours for this project/week");
      return Boolean(exact && !exact.disabled);
    },
    "The real Timeline save did not finish after both refreshes",
  );
  expectRealTimeline(30, 40, "Weekly after utilization");
  await assertPopup(30, 40, "Weekly");
  await closePopup();
  expectNoAcceptedWeekOverrides("Weekly");

  // Warm Monthly, then switch to it while the edit is pending. Utilization
  // completes first and allocation completes second.
  console.info("scenario: monthly utilization-first");
  await api.reset("Monthly");
  api.setPerConsumerBodies(true);
  delayViews = false;
  await api.switchMode("Weekly");
  delayViews = true;
  await api.startControllerEdit(30);
  await api.waitForRequests(1, 1);
  await api.switchMode("Monthly");
  await api.waitForRequests(1, 2);
  expectRealTimeline(30, 40, "Monthly before refresh");
  const weeklySaveUtil = api.requests().find(request =>
    request.kind === "utilization" && request.mode === "Weekly"
  )!;
  const monthlyUtil = api.requests().find(request =>
    request.kind === "utilization" && request.mode === "Monthly"
  )!;
  const monthlyAlloc = api.requests().find(request => request.kind === "allocation")!;
  api.resolve(monthlyUtil, 30);
  await api.flush();
  expectRealTimeline(30, 40, "Monthly after utilization");
  await assertRealStaffTotal(100, "Monthly after utilization", false);
  expectRealTimeline(30, 40, "Monthly Staff return");
  await assertPopup(30, 40, "Monthly");
  await closePopup();
  api.resolve(monthlyAlloc, 30);
  api.resolve(weeklySaveUtil, 30);
  await api.flush();
  expectRealTimeline(30, 40, "Monthly after allocation");
  await waitUntil(
    () => (controller?.debugAcceptedWeekOverrides() ?? []).length === 0,
    "Monthly settled save left an accepted-week overlay behind",
  );
  expectNoAcceptedWeekOverrides("Monthly");

  // A real verification mismatch rolls every mounted surface back and leaves
  // the production editor's visible error message in place.
  console.info("scenario: mismatch rollback");
  await api.reset("Weekly");
  api.setPerConsumerBodies(true);
  api.mismatchNextSave();
  await api.startTimelineEdit(31);
  await api.waitForRequests(1, 1);
  for (const request of api.requests()) api.resolve(request, 26);
  // Production gives an accepted write a couple of fresh-read retries before
  // rolling it back: a different API worker can briefly expose the pre-save
  // snapshot. The final mismatch also starts the normal failure refresh, so
  // release each newly-issued mock view read until the cell reports the final
  // verified error rather than sampling the still-optimistic retry window.
  await waitUntil(
    () => {
      for (const request of api.requests()) {
        if (!request.resolved) api.resolve(request, 26);
      }
      return (document.body.textContent ?? "").includes("did not match");
    },
    "The production Resources editor did not report the verification mismatch",
  );
  expectRealTimeline(26, 36, "Mismatch rollback");
  document.querySelector<HTMLInputElement>(`input[aria-label="Project One, week of ${WEEK}, hours"]`)
    ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await api.flush();

  // Multiple weekly cells edited while the first cell's save is still in
  // flight fold into ONE bulk weekPatches save. Happy path first: every folded
  // cell must display its accepted value once the single batch settles.
  console.info("scenario: folded batch accepted");
  await api.reset("Weekly");
  api.setPerConsumerBodies(true);
  // The fast save path resolves the visible save at ACCEPTANCE (when the
  // POST returns), so hold each save POST open — otherwise the mock's
  // instant response closes the in-flight window before cells can fold.
  api.setDelaySaves(true);
  expectProjectOneWeekCells([26, 0, 0], "Folded accepted (baseline)");
  const acceptBaseline = api.hoursSaves().length;
  await api.startTimelineEditWeek(WEEK, 30);
  await api.startTimelineEditWeek(WEEK2, 12);
  await api.startTimelineEditWeek(WEEK3, 9);
  if (api.hoursSaves().length !== acceptBaseline + 1) {
    throw new Error(
      `Folded accepted: week-2/3 edits must fold behind the in-flight save; saw ${api.hoursSaves().length - acceptBaseline} POSTs`,
    );
  }
  expectProjectOneWeekCells([30, 12, 9], "Folded accepted (optimistic)");
  // Accept the first save's held POST → the folded batch flushes as ONE save.
  for (const save of api.saveRequests()) api.resolveSave(save);
  await waitUntil(
    () => api.hoursSaves().length === acceptBaseline + 2,
    "Folded accepted: both folded cells must flush as ONE bulk save once the first save is accepted",
  );
  const acceptSaves = api.hoursSaves();
  const acceptedBatch = acceptSaves[acceptSaves.length - 1];
  if (acceptedBatch[WEEK2] !== 12 || acceptedBatch[WEEK3] !== 9) {
    throw new Error(`Folded accepted: the bulk save did not carry both folded cells: ${JSON.stringify(acceptedBatch)}`);
  }
  // Accept the bulk POST, then feed every refresh live server truth until
  // both saves settle and their accepted overlays are pruned. The visible
  // save completes at acceptance, so the buttons re-enable while the
  // verification refetches are still arriving — keep serving those reads
  // until the prune confirms every accepted value against server truth.
  for (const save of api.saveRequests()) api.resolveSave(save);
  await waitUntil(
    () => {
      for (const save of api.saveRequests()) api.resolveSave(save);
      for (const request of api.requests()) {
        if (!request.resolved) api.resolveTruth(request);
      }
      const buttons = projectOneEditButtons();
      return buttons.length === WEEKS.length && buttons.every(button => !button.disabled)
        && (controller?.debugAcceptedWeekOverrides() ?? []).length === 0;
    },
    "The folded bulk save did not settle after its refresh",
  );
  expectProjectOneWeekCells([30, 12, 9], "Folded accepted (settled)");
  expectRealTimeline(30, 40, "Folded accepted summary");
  const personRow = Array.from(document.querySelectorAll("tr"))
    .find(row => row.textContent?.includes("Alex Chen"));
  const personTitles = Array.from(personRow?.querySelectorAll("button") ?? []).map(button => button.title);
  if (
    !personTitles.some(title => title.includes("12h") && title.includes("1 project"))
    || !personTitles.some(title => title.includes("9h") && title.includes("1 project"))
  ) {
    throw new Error(`Folded accepted: person summary cells did not pick up the folded weeks; titles ${JSON.stringify(personTitles)}`);
  }
  if ((document.body.textContent ?? "").includes("did not match")) {
    throw new Error("Folded accepted: a successful bulk save must not leave a verification error visible");
  }
  const leakedOverlays = controller?.debugAcceptedWeekOverrides() ?? [];
  if (leakedOverlays.length > 0) {
    throw new Error(
      `Folded accepted: settled bulk save left accepted-week overlays behind: ${JSON.stringify(leakedOverlays)}`,
    );
  }

  // The same fold, but the batch fails verification: EVERY folded cell must
  // roll back to server truth with the error visible, while the first cell —
  // already accepted by its own save — keeps its value. Catches regressions
  // where only the last-edited cell rolls back or a folded cell silently keeps
  // its optimistic hours.
  console.info("scenario: folded batch rollback");
  await api.reset("Weekly");
  api.setPerConsumerBodies(true);
  api.setDelaySaves(true);
  fetchLog.length = 0;
  expectProjectOneWeekCells([26, 0, 0], "Folded rollback (baseline)");
  const rollbackBaseline = api.hoursSaves().length;
  await api.startTimelineEditWeek(WEEK, 30);
  if (!projectOneEditButtons()[0]?.disabled) {
    throw new Error(`Folded rollback: the first cell's save is not in flight after Enter; fetches=${JSON.stringify(fetchLog)}`);
  }
  await api.startTimelineEditWeek(WEEK2, 12);
  await api.startTimelineEditWeek(WEEK3, 9);
  expectProjectOneWeekCells([30, 12, 9], "Folded rollback (optimistic)");
  api.mismatchNextSave(); // the folded batch's POST becomes a server no-op
  // Accept the first save's held POST → the folded batch flushes; its POST is
  // the armed no-op, so the server keeps 0h for both folded weeks.
  for (const save of api.saveRequests()) api.resolveSave(save);
  await waitUntil(
    () => api.hoursSaves().length === rollbackBaseline + 2,
    "Folded rollback: the folded batch did not flush once the first save was accepted",
  );
  for (const save of api.saveRequests()) api.resolveSave(save);
  // The batch fails verification after production's fresh-read retries; its
  // failure refresh issues new view reads — release each with live server
  // truth until the real editor reports the mismatch for BOTH folded weeks.
  await waitUntil(
    () => {
      for (const request of api.requests()) {
        if (!request.resolved) api.resolveTruth(request);
      }
      const text = document.body.textContent ?? "";
      return text.includes(`${WEEK2}: sent 12h, server has 0h`)
        && text.includes(`${WEEK3}: sent 9h, server has 0h`);
    },
    () => "The folded batch failure did not surface a verification error naming every folded week; "
      + `saves=${JSON.stringify(api.hoursSaves())} `
      + `alert=${JSON.stringify(document.querySelector('[role="alert"]')?.textContent ?? null)} `
      + `cells=${JSON.stringify(projectOneEditButtons().map(button => `${button.title}${button.disabled ? " (saving)" : ""}`))} `
      + `serverWeeks=${JSON.stringify(serverWeeks)} fetches=${JSON.stringify(fetchLog.slice(-25))}`,
  );
  await waitUntil(
    () => {
      for (const request of api.requests()) {
        if (!request.resolved) api.resolveTruth(request);
      }
      const buttons = projectOneEditButtons();
      return buttons.length === WEEKS.length && buttons.every(button => !button.disabled);
    },
    "The failed folded batch did not settle after its rollback refresh",
  );
  expectProjectOneWeekCells([30, 0, 0], "Folded rollback (server truth)");
  expectRealTimeline(30, 40, "Folded rollback summary");
  const rollbackSaves = api.hoursSaves();
  if (rollbackSaves.length !== rollbackBaseline + 2) {
    throw new Error(
      `Folded rollback: expected exactly one bulk attempt after the first save, saw ${rollbackSaves.length - rollbackBaseline - 1}`,
    );
  }
  const failedBatch = rollbackSaves[rollbackSaves.length - 1];
  if (failedBatch[WEEK2] !== 12 || failedBatch[WEEK3] !== 9) {
    throw new Error(`Folded rollback: the failing bulk save did not carry both folded cells: ${JSON.stringify(failedBatch)}`);
  }
  const staleOptimistic = Array.from(document.querySelectorAll("button"))
    .some(button =>
      button.title === "Edit 12 hours for this project/week"
      || button.title === "Edit 9 hours for this project/week");
  if (staleOptimistic) {
    throw new Error("Folded rollback: a folded cell silently kept its unsaved optimistic hours");
  }
  if (!(document.body.textContent ?? "").includes("did not match")) {
    throw new Error("Folded rollback: the bulk failure error is not visible");
  }
  // Clear the visible error (open an editor, then Escape) so later scenarios
  // can never accidentally match this scenario's banner.
  projectOneEditButtons()[1]?.click();
  await api.flush();
  document.querySelector<HTMLInputElement>(`input[aria-label="Project One, week of ${WEEK2}, hours"]`)
    ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await api.flush();
  if ((document.body.textContent ?? "").includes("did not match")) {
    throw new Error("Folded rollback: the error banner did not clear after dismissing the editor");
  }
  expectNoAcceptedWeekOverrides("Mismatch rollback");

  // A newer same-tuple page save must survive completion of an older pair of
  // stale allocation/utilization responses.
  console.info("scenario: newer edit survives");
  await api.reset("Weekly");
  api.setPerConsumerBodies(true);
  const newerEditBaseline = api.hoursSaves().length;
  await api.startControllerEdit(30);
  await api.waitForRequests(1, 1);
  const olderRequests = [...api.requests()];
  await api.startControllerEdit(32);
  await api.flush();
  expectRealTimeline(32, 42, "Newer accepted edit");
  for (const request of olderRequests) api.resolve(request, 26);
  await api.flush();
  expectRealTimeline(32, 42, "Older completion");
  await waitUntil(
    () => {
      for (const request of api.requests()) {
        if (!request.resolved) api.resolveTruth(request);
      }
      const latestSave = api.hoursSaves().at(-1);
      return api.hoursSaves().length === newerEditBaseline + 2
        && latestSave?.[WEEK] === 32
        && (controller?.debugAcceptedWeekOverrides() ?? []).length === 0;
    },
    () => "Newer edit did not fully settle after the older responses: "
      + `saves=${JSON.stringify(api.hoursSaves())} `
      + `overlays=${JSON.stringify(controller?.debugAcceptedWeekOverrides() ?? [])}`,
  );
  expectRealTimeline(32, 42, "Newer edit settled");
  expectNoAcceptedWeekOverrides("Newer edit survives");

  // An old allocation response may be slower than the fresh response started
  // after an accepted save. The UI must retain the newer truth — the response
  // that arrives last is not necessarily the newest snapshot. This uses real
  // Resources query invalidation and rendering, rather than a helper-only
  // assertion, to cover every hour value (not just zero).
  console.info("scenario: stale response cannot repaint accepted hours");
  await api.reset("Weekly");
  api.setPerConsumerBodies(true);
  api.setIndependentViewRequests(true);
  await api.startControllerEdit(10);
  await api.waitForRequests(1, 1);
  await api.triggerViewRefresh();
  await api.waitForRequests(2, 2);
  const staleRequests = [...api.requests()];
  const newestAllocation = staleRequests.filter(request => request.kind === "allocation").at(-1)!;
  const newestUtilization = staleRequests.filter(request => request.kind === "utilization").at(-1)!;
  api.resolve(newestAllocation, 10);
  api.resolve(newestUtilization, 10);
  await api.flush();
  expectRealTimeline(10, 20, "Ordering after fresh confirmation");
  for (const request of staleRequests) {
    if (!request.resolved) api.resolve(request, 26);
  }
  await api.flush();
  expectRealTimeline(10, 20, "Ordering after stale completion");
  await waitUntil(
    () => {
      for (const request of api.requests()) {
        if (!request.resolved) api.resolveTruth(request);
      }
      return (controller?.debugAcceptedWeekOverrides() ?? []).length === 0;
    },
    "Ordering scenario did not settle after the stale responses completed",
  );
  expectRealTimeline(10, 20, "Ordering settled");
  expectNoAcceptedWeekOverrides("Ordering scenario");
  expectCanonicalAllocationQueryPayload("Ordering scenario");
}

createRoot(document.getElementById("root")!).render(<HarnessRoot />);
requestAnimationFrame(() => {
  void runRegression()
    .then(() => {
      document.documentElement.dataset.testStatus = "passed";
      document.documentElement.dataset.testDetail = "all assertions passed";
    })
    .catch(error => {
      document.documentElement.dataset.testStatus = "failed";
      document.documentElement.dataset.testDetail = error instanceof Error ? error.stack || error.message : String(error);
      console.error(error);
    });
});