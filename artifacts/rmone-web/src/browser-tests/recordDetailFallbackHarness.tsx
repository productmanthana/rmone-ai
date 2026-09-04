/*
 * Record-detail Phase-1 fallback regression (task: record pages must still
 * fill in from the module list when the small detail call fails).
 *
 * On Aug 27 2026 the record page's first paint was changed to wait ONLY for
 * the small detail response (project-detail.tsx Phase 1): the big module
 * list no longer gates rendering and back-fills blank fields silently
 * afterwards. This harness pins the preserved fallback behaviors:
 *
 *   1. detail OK + slow list  → the page renders from the detail response
 *      alone; when the list finally lands it back-fills ONLY blank fields
 *      and never wipes the already-rendered team/health state.
 *   2. detail fails/empty + list OK → the page rebuilds from that record's
 *      row in the CORRECT module list — including a custom-id Lead
 *      (LD-0003) whose ID-prefix guess (PMM) differs from the module of its
 *      correctly-seeded shell (LEM).
 *   3. both sources fail on an already-rendered record → the fields on
 *      screen are kept, not blanked.
 *
 * Runs in a real browser via scripts/check-record-detail-fallback-browser.mjs
 * (same pattern as the resource-hours ordering harness). It mounts the real
 * ProjectDetail page against a mocked window.fetch and reads page state
 * through the read-only observeProjectDetailIntegration seam.
 */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import ProjectDetail, {
  observeProjectDetailIntegration,
  type ProjectDetailIntegrationSnapshot,
} from "@/pages/project-detail";
import { AuthContext, type AuthContextType } from "@/lib/auth-context";
import { bustCache, getModuleRecords } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { readProjectSnapshot } from "@/lib/projectDetailCache";

/* ───────────────────────── auth fixture ───────────────────────── */

const PERSON_GUID = "aaaaaaaa-0000-0000-0000-000000000001";

localStorage.setItem("rmone_token", "browser-test-token");
localStorage.setItem("rmone_username", "browser-test-admin");
localStorage.setItem("rmone_tenant", "browser-test-tenant");
localStorage.setItem("rmone_canEdit", "1");
localStorage.setItem("rmone_isAdmin", "1");

const authValue: AuthContextType = {
  user: {
    username: "browser-test-admin",
    tenant: "browser-test-tenant",
    token: "browser-test-token",
    userId: PERSON_GUID,
    canEdit: true,
    isAdmin: true,
  },
  isLoading: false,
  signIn: async () => {},
  signOut: async () => {},
  handleAuthError: async () => {},
};

/* ───────────────────────── fetch mock ───────────────────────── */

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Row = Record<string, unknown>;
type DetailMode =
  | { kind: "data"; data: Row }   // { Status: true, Data: … }
  | { kind: "empty" }             // { Status: false, Data: null } — record not found
  | { kind: "fail" };             // HTTP 500 → the client's timeout/fallback path
type ListMode =
  | { kind: "rows"; rows: Row[] }
  | { kind: "defer" }             // stays pending until resolveDeferredList()
  | { kind: "fail" };             // HTTP 500 → emptyRecords fallback

const detailModes = new Map<string, DetailMode>();
const listModes = new Map<string, ListMode>();
const listDeferrals = new Map<string, Deferred<Response>>();
let teamMembers: Row[] = [];
const fetchLog: string[] = [];

function listBody(rows: Row[]): { total: number; data: Row[] } {
  return { total: rows.length, data: rows };
}

function resolveDeferredList(moduleName: string, rows: Row[]): void {
  const pending = listDeferrals.get(moduleName);
  if (!pending) throw new Error(`No pending ${moduleName} list request to resolve`);
  listDeferrals.delete(moduleName);
  pending.resolve(jsonResponse(listBody(rows)));
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(rawUrl, window.location.href);
  const path = url.pathname;
  if (!path.startsWith("/api/")) return realFetch(input as RequestInfo, init);
  fetchLog.push(`${(init?.method ?? "GET").toUpperCase()} ${path}${url.search}`);

  // Small record-detail endpoint: /api/rmone/project/:id
  const detailMatch = path.match(/^\/api\/rmone\/project\/([^/]+)$/);
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]).toUpperCase();
    const mode = detailModes.get(id) ?? { kind: "empty" as const };
    if (mode.kind === "fail") return jsonResponse({ error: "detail unavailable (harness)" }, 500);
    if (mode.kind === "empty") return jsonResponse({ Status: false, Data: null });
    return jsonResponse({ Status: true, Data: mode.data });
  }

  // Big module-records list: /api/rmone/records/:MOD
  const listMatch = path.match(/^\/api\/rmone\/records\/([A-Z]+)$/);
  if (listMatch) {
    const moduleName = listMatch[1];
    const mode = listModes.get(moduleName) ?? { kind: "rows" as const, rows: [] };
    if (mode.kind === "fail") return jsonResponse({ error: "records unavailable (harness)" }, 500);
    if (mode.kind === "defer") {
      let pending = listDeferrals.get(moduleName);
      if (!pending) {
        pending = deferred<Response>();
        listDeferrals.set(moduleName, pending);
      }
      return pending.promise;
    }
    return jsonResponse(listBody(mode.rows));
  }

  if (path === "/api/rmone/project-team") return jsonResponse({ team: teamMembers, openRoles: [] });
  if (path === "/api/rmone/allocations") return jsonResponse({ allocations: [] });
  if (path === "/api/rmone/resource-allocations") {
    return jsonResponse({ total: 0, bench: 0, underUtil: 0, healthy: 0, overAllocated: 0, resources: [] });
  }
  if (path === "/api/rmone/task-data") return jsonResponse([]);
  if (path === "/api/rmone/my-capabilities") {
    return jsonResponse({
      source: "builtin",
      caps: { manageStaff: true, editData: true, editFinancials: true },
      selfRevert: null,
    });
  }
  if (path.startsWith("/api/rmone/record-permissions/")) {
    return jsonResponse({ canEditData: true, canAdvanceStage: true, canEditFinancials: true, reason: null, degraded: false });
  }
  if (path === "/api/alerts/feed") return jsonResponse({ rows: [], generatedAt: 0 });
  // Everything else the page warms in the background is irrelevant here.
  return jsonResponse([]);
};

/* ───────────────────────── snapshot seam ───────────────────────── */

let latestSnapshot: ProjectDetailIntegrationSnapshot | null = null;
observeProjectDetailIntegration(snapshot => { latestSnapshot = snapshot; });

function snap(): ProjectDetailIntegrationSnapshot {
  if (!latestSnapshot) throw new Error("ProjectDetail has not published a snapshot yet");
  return latestSnapshot;
}

function nextPaint(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function settleFrames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) await nextPaint();
}

async function waitUntil(
  predicate: () => boolean,
  message: string | (() => string),
  timeoutMs = 8000,
): Promise<void> {
  const start = performance.now();
  for (;;) {
    let verdict = false;
    try { verdict = predicate(); } catch { verdict = false; }
    if (verdict) return;
    if (performance.now() - start > timeoutMs) {
      throw new Error(typeof message === "function" ? message() : message);
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

async function waitForSnapshot(
  predicate: (s: ProjectDetailIntegrationSnapshot) => boolean,
  message: string | (() => string),
): Promise<ProjectDetailIntegrationSnapshot> {
  await waitUntil(() => latestSnapshot !== null && predicate(latestSnapshot), message);
  return snap();
}

function overlayVisible(): boolean {
  return (document.body.textContent ?? "").includes("Loading project…");
}

/* ───────────────────────── mount plumbing ───────────────────────── */

let activeRoot: Root | null = null;
let activeContainer: HTMLElement | null = null;

function renderMountedRecord(projectId: string): void {
  if (!activeRoot) throw new Error("No mounted ProjectDetail root to update");
  activeRoot.render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthContext.Provider value={authValue}>
          <ProjectDetail projectId={projectId} />
        </AuthContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

async function mountRecord(projectId: string): Promise<void> {
  latestSnapshot = null;
  activeContainer = document.createElement("div");
  document.getElementById("root")!.appendChild(activeContainer);
  activeRoot = createRoot(activeContainer);
  renderMountedRecord(projectId);
  await nextPaint();
}

async function switchMountedRecord(projectId: string): Promise<void> {
  latestSnapshot = null;
  // Re-render the same root with a new prop. This intentionally preserves the
  // ProjectDetail instance, matching /project/:id route navigation.
  renderMountedRecord(projectId);
  await nextPaint();
}

function unmountRecord(): void {
  activeRoot?.unmount();
  activeContainer?.remove();
  activeRoot = null;
  activeContainer = null;
  latestSnapshot = null;
}

function teamMemberFixture(): Row {
  return {
    name: "Alex Chen",
    role: "Project Manager",
    title: "Project Manager",
    bu: "Design",
    dept: "Delivery",
    pctAllocation: 100,
    startDate: "",
    endDate: "",
    resourceId: PERSON_GUID,
    weeklyHours: [],
    isLocked: false,
    eacHrs: 0, etcHrs: 0, costRate: 0, eacCost: 0, etcCost: 0, ncHrs: 0, ncCost: 0,
  };
}

function resetScenario(): void {
  unmountRecord();
  // Client-side caches from the previous scenario (module lists, detail,
  // team) must never leak forward — every scenario owns its record id, and
  // the full bust also clears the in-memory snapshot store.
  bustCache();
  detailModes.clear();
  listModes.clear();
  listDeferrals.clear();
  teamMembers = [teamMemberFixture()];
  fetchLog.length = 0;
}

/* ───────────────────────── scenarios ───────────────────────── */

// 1. Detail OK + slow list: page renders from detail alone; the late list
//    back-fills blank fields without wiping team/health state.
async function scenarioDetailOkSlowList(): Promise<void> {
  console.info("scenario: detail ok + slow list back-fills blanks without wiping team/health");
  resetScenario();
  const id = "PMM-26-101";
  detailModes.set(id, {
    kind: "data",
    data: {
      TicketId: id,
      Title: "Riverfront Tower",
      CRMProjectStatusChoice: "Active",
      ModuleName: "PMM",
      ApproxContractValue: 2500000,
      CompanyName: "Bright Build Co",
      // City / SectorChoice deliberately absent — the slow list back-fills them.
    },
  });
  listModes.set("PMM", { kind: "defer" });
  await mountRecord(id);

  const rendered = await waitForSnapshot(
    s => s.initialLoadComplete && !s.loading && s.name === "Riverfront Tower"
      && s.allocationNames.includes("Alex Chen"),
    () => "Phase 1 did not render from the detail response while the module list was still pending: "
      + JSON.stringify(latestSnapshot),
  );
  if (!listDeferrals.has("PMM")) {
    throw new Error("The module list request never fired — nothing pending to back-fill from");
  }
  if (rendered.city !== "") throw new Error(`City should be blank before the list lands, saw "${rendered.city}"`);
  if (rendered.sector !== "—") throw new Error(`Sector should be the "—" placeholder before the list lands, saw "${rendered.sector}"`);
  if (overlayVisible()) throw new Error("Full-page overlay is still up after Phase 1 + Phase 2 settled");
  await settleFrames(3);
  const before = snap();
  if (before.healthScore < 0) throw new Error("Phase 2 never computed a health score before the list landed");

  resolveDeferredList("PMM", [{
    TicketId: id,
    Title: "Riverfront Tower (stale list title)", // detail value must win
    City: "Buffalo",
    SectorChoice: "Healthcare",
    ModuleName: "PMM",
  }]);
  const merged = await waitForSnapshot(
    s => s.city === "Buffalo" && s.sector === "Healthcare",
    () => `The late module list never back-filled the blank City/Sector fields: ${JSON.stringify(latestSnapshot)}`,
  );
  if (merged.name !== "Riverfront Tower") {
    throw new Error(`List back-fill overwrote a detail-provided field: name became "${merged.name}"`);
  }
  if (!merged.allocationNames.includes("Alex Chen")) {
    throw new Error("List back-fill wiped the already-rendered team");
  }
  if (merged.healthScore !== before.healthScore) {
    throw new Error(`List back-fill reset the health score: ${before.healthScore} → ${merged.healthScore}`);
  }
  if (merged.loading || !merged.initialLoadComplete) {
    throw new Error("List back-fill re-triggered the page loading state");
  }
  await settleFrames(2);
  const settled = snap();
  if (!settled.allocationNames.includes("Alex Chen") || settled.name !== "Riverfront Tower") {
    throw new Error(`Back-filled page did not hold its state: ${JSON.stringify(settled)}`);
  }
}

// 2a. Detail request fails outright + list OK: page rebuilds from the list row.
async function scenarioDetailFailsListRebuild(): Promise<void> {
  console.info("scenario: detail failure rebuilds the page from the module list row");
  resetScenario();
  const id = "PMM-26-202";
  detailModes.set(id, { kind: "fail" });
  listModes.set("PMM", {
    kind: "rows",
    rows: [
      { TicketId: "PMM-26-999", Title: "Decoy Project", ModuleName: "PMM" },
      {
        TicketId: id,
        Title: "Harbor Bridge Retrofit",
        CRMProjectStatusChoice: "Bidding",
        City: "Oakland",
        SectorChoice: "Transportation",
        ModuleName: "PMM",
      },
    ],
  });
  await mountRecord(id);

  const rebuilt = await waitForSnapshot(
    s => s.initialLoadComplete && !s.loading && s.name === "Harbor Bridge Retrofit",
    () => `Detail-failure rebuild did not use the list row: ${JSON.stringify(latestSnapshot)}`,
  );
  if (rebuilt.status !== "Bidding") throw new Error(`List-row rebuild lost the status, saw "${rebuilt.status}"`);
  if (rebuilt.city !== "Oakland") throw new Error(`List-row rebuild lost the city, saw "${rebuilt.city}"`);
  if (rebuilt.module !== "PMM") throw new Error(`List-row rebuild picked the wrong module: "${rebuilt.module}"`);
  if (rebuilt.rawFieldCount === 0) throw new Error("List-row rebuild produced an empty field bag");
  if (!fetchLog.some(line => line.includes("/api/rmone/records/PMM"))) {
    throw new Error("The rebuild never fetched the module records list");
  }
  if (overlayVisible()) throw new Error("Overlay still up after the list-row rebuild settled");
}

// 2b. Empty detail on a CUSTOM id (LD-0003 guesses PMM by prefix) must rebuild
//     from the module of the correctly-seeded Lead shell — never the guess.
async function scenarioCustomIdKeepsSeededModule(): Promise<void> {
  console.info("scenario: empty detail keeps the seeded LEM shell for a custom id");
  resetScenario();
  const id = "LD-0003";
  detailModes.set(id, { kind: "empty" });
  listModes.set("LEM", {
    kind: "rows",
    rows: [{
      TicketId: id,
      Title: "Northside Clinic Lead",
      Status: "New",
      ModuleName: "LEM",
      City: "Detroit",
    }],
  });
  // If a regression sends the rebuild to the GUESSED module list, this empty
  // PMM answer would blank the page down to the bare id.
  listModes.set("PMM", { kind: "rows", rows: [] });
  // The navigation-from-Leads flow leaves the LEM list in the client cache —
  // that cached row is what seeds the correct Lead shell before Phase 1.
  await getModuleRecords("LEM");
  fetchLog.length = 0;
  await mountRecord(id);

  const lead = await waitForSnapshot(
    s => s.initialLoadComplete && !s.loading && s.coreDataSettled,
    () => `The LD-0003 page never settled: ${JSON.stringify(latestSnapshot)}`,
  );
  await settleFrames(3);
  const settled = snap();
  if (settled.name !== "Northside Clinic Lead") {
    throw new Error(`Custom-id record was rebuilt from the wrong source — name "${settled.name}" (expected the seeded LEM row)`);
  }
  if (settled.module !== "LEM") {
    throw new Error(`Empty detail clobbered the seeded Lead shell back to the ID-prefix guess: module "${settled.module}"`);
  }
  if (settled.city !== "Detroit") {
    throw new Error(`Rebuild lost the LEM list-row fields: city "${settled.city}"`);
  }
  if (fetchLog.some(line => line.includes("/api/rmone/records/PMM"))) {
    throw new Error("Detail failure re-fetched the GUESSED (PMM) list instead of the seeded record's own module list");
  }
  if (lead.error !== "") throw new Error(`Unexpected page error: ${lead.error}`);
}

// 3. Both Phase-1 sources fail on an already-rendered record: the fields on
//    screen are kept, not blanked.
async function scenarioBothFailKeepsRenderedFields(): Promise<void> {
  console.info("scenario: both phase-1 sources fail on an already-rendered record");
  resetScenario();
  const id = "PMM-26-303";
  const goodRow: Row = {
    TicketId: id,
    Title: "Summit Plaza",
    CRMProjectStatusChoice: "Active",
    City: "Denver",
    SectorChoice: "Civic",
    ModuleName: "PMM",
    ApproxContractValue: 1200000,
  };
  detailModes.set(id, { kind: "data", data: { ...goodRow } });
  listModes.set("PMM", { kind: "rows", rows: [{ ...goodRow }] });
  await mountRecord(id);

  await waitForSnapshot(
    s => s.initialLoadComplete && !s.loading && s.name === "Summit Plaza"
      && s.allocationNames.includes("Alex Chen"),
    () => `The record never finished its healthy first load: ${JSON.stringify(latestSnapshot)}`,
  );
  await settleFrames(3);
  const before = snap();

  // Now the world breaks: both Phase-1 sources start failing, and the client
  // caches that would mask the failure are gone (as after a long-throttled
  // background tab). A silent refresh must keep the rendered fields.
  detailModes.set(id, { kind: "fail" });
  listModes.set("PMM", { kind: "fail" });
  bustCache(`project:details:${id}`);
  bustCache("module:PMM");
  fetchLog.length = 0;
  window.dispatchEvent(new Event("rmone:billingRatesChanged")); // → loadProject(true)

  await waitUntil(
    () => fetchLog.some(line => line.includes(`/api/rmone/project/${id}`))
      && fetchLog.some(line => line.includes("/api/rmone/records/PMM")),
    () => `The silent refresh never re-fetched the failed detail + list sources: ${JSON.stringify(fetchLog)}`,
  );
  // Hold the page under observation while the failed refresh settles — the
  // rendered fields must never blank, not even transiently.
  const watchStart = performance.now();
  while (performance.now() - watchStart < 500) {
    const current = snap();
    if (current.name !== "Summit Plaza" || current.city !== "Denver") {
      throw new Error(`The failed refresh blanked on-screen fields: name="${current.name}" city="${current.city}"`);
    }
    if (overlayVisible()) throw new Error("The failed silent refresh re-showed the full-page overlay");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const after = snap();
  if (after.status !== "Active") throw new Error(`Failed refresh lost the status: "${after.status}"`);
  if (after.sector !== "Civic") throw new Error(`Failed refresh lost the sector: "${after.sector}"`);
  if (after.rawFieldCount !== before.rawFieldCount) {
    throw new Error(`Failed refresh changed the raw field bag: ${before.rawFieldCount} → ${after.rawFieldCount} fields`);
  }
  if (!after.allocationNames.includes("Alex Chen")) throw new Error("Failed refresh wiped the rendered team");
  if (after.loading || !after.initialLoadComplete) throw new Error("Failed refresh left the page in a loading state");
}

// 4. Record-to-record navigation reuses the mounted component. If the next
// record's detail and list sources both fail, the previous record's fields
// must not be rendered or persisted under the next record's snapshot key.
async function scenarioSwitchToBrokenRecordDoesNotLeakFields(): Promise<void> {
  console.info("scenario: switching to a broken record shows a blank shell, not the previous record");
  resetScenario();
  const idA = "PMM-26-404";
  const idB = "PMM-26-405";
  const goodRowA: Row = {
    TicketId: idA,
    Title: "Granite Point Hospital",
    CRMProjectStatusChoice: "Active",
    City: "Boston",
    SectorChoice: "Healthcare",
    CompanyName: "Northstar Builders",
    ModuleName: "PMM",
  };
  const goodRowB: Row = {
    TicketId: idB,
    Title: "Cedar Grove Library",
    CRMProjectStatusChoice: "Bidding",
    City: "Portland",
    SectorChoice: "Civic",
    CompanyName: "Cedar Works",
    ModuleName: "PMM",
  };

  detailModes.set(idA, { kind: "data", data: { ...goodRowA } });
  listModes.set("PMM", { kind: "rows", rows: [{ ...goodRowA }] });
  await mountRecord(idA);
  await waitForSnapshot(
    s => s.initialLoadComplete && !s.loading && s.id === idA
      && s.name === "Granite Point Hospital" && s.city === "Boston",
    () => `Record A never finished its healthy load: ${JSON.stringify(latestSnapshot)}`,
  );
  await settleFrames(3);
  if (!readProjectSnapshot<{ project: ProjectDetailIntegrationSnapshot }>(idA)) {
    throw new Error("Healthy record A was not persisted before the route-reuse switch");
  }

  // B is unavailable at both Phase-1 sources. Bust the list cache populated by
  // A so this switch really exercises the failed list request, rather than
  // reading A's module-list response from the client cache.
  detailModes.set(idB, { kind: "fail" });
  listModes.set("PMM", { kind: "fail" });
  bustCache(`project:details:${idB}:auto`);
  bustCache("module:PMM");
  fetchLog.length = 0;
  await switchMountedRecord(idB);

  await waitUntil(
    () => fetchLog.some(line => line.includes(`/api/rmone/project/${idB}`))
      && fetchLog.some(line => line.includes("/api/rmone/records/PMM")),
    () => `Broken record B never fetched both Phase-1 sources: ${JSON.stringify(fetchLog)}`,
  );
  const broken = await waitForSnapshot(
    s => s.id === idB && !s.loading && s.coreDataSettled,
    () => `Broken record B never settled on its own shell: ${JSON.stringify(latestSnapshot)}`,
  );
  if (broken.name === "Granite Point Hospital" || broken.city === "Boston"
      || broken.sector === "Healthcare" || broken.company === "Northstar Builders") {
    throw new Error(`Record A fields leaked onto broken record B: ${JSON.stringify(broken)}`);
  }
  if (broken.name !== idB || broken.city !== "" || broken.sector !== "—"
      || broken.company !== "" || broken.rawFieldCount !== 0) {
    throw new Error(`Broken record B did not fall through to a blank shell: ${JSON.stringify(broken)}`);
  }
  if (readProjectSnapshot(idB) !== undefined) {
    throw new Error("Broken record B persisted a snapshot instead of remaining uncached");
  }

  // Recover B and remount it like a reload. The healthy sources should now
  // populate B with its own fields, proving the failed visit did not poison
  // the record's future snapshot/read path.
  detailModes.set(idB, { kind: "data", data: { ...goodRowB } });
  listModes.set("PMM", { kind: "rows", rows: [{ ...goodRowB }] });
  bustCache(`project:details:${idB}:auto`);
  bustCache("module:PMM");
  unmountRecord();
  await mountRecord(idB);
  const recovered = await waitForSnapshot(
    s => s.initialLoadComplete && !s.loading && s.id === idB
      && s.name === "Cedar Grove Library" && s.city === "Portland",
    () => `Recovered record B did not load its own fields: ${JSON.stringify(latestSnapshot)}`,
  );
  if (recovered.status !== "Bidding" || recovered.sector !== "Civic"
      || recovered.company !== "Cedar Works") {
    throw new Error(`Recovered record B fields were incomplete or stale: ${JSON.stringify(recovered)}`);
  }
}

/* ───────────────────────── runner ───────────────────────── */

async function runRegression(): Promise<void> {
  await scenarioDetailOkSlowList();
  await scenarioDetailFailsListRebuild();
  await scenarioCustomIdKeepsSeededModule();
  await scenarioBothFailKeepsRenderedFields();
  await scenarioSwitchToBrokenRecordDoesNotLeakFields();
}

void runRegression()
  .then(() => {
    document.documentElement.dataset.testStatus = "passed";
    document.documentElement.dataset.testDetail = "all assertions passed";
  })
  .catch(error => {
    document.documentElement.dataset.testStatus = "failed";
    document.documentElement.dataset.testDetail =
      error instanceof Error ? error.stack || error.message : String(error);
    console.error(error);
  });
