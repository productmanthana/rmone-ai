import assert from "node:assert/strict";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
}

const storage = new MemoryStorage();
storage.setItem("rmone_token", "test-token");
storage.setItem("rmone_username", "admin@example.com");
storage.setItem("rmone_tenant", "tenant-a");
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

type PendingFetch = {
  url: string;
  resolve: (response: Response) => void;
};
const pending: PendingFetch[] = [];
(globalThis as unknown as { fetch: typeof fetch }).fetch = ((input: string | URL | Request) =>
  new Promise<Response>((resolve) => {
    pending.push({ url: String(input), resolve });
  })) as typeof fetch;

const {
  bustPermissionCaches,
  coerceNavItems,
  getMyCapabilities,
  getMyNavigation,
  getRecordPermissions,
} = await import("../permissions");

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function takePending(fragment: string): PendingFetch {
  const index = pending.findIndex((request) => request.url.includes(fragment));
  assert.notEqual(index, -1, `Expected a pending request containing ${fragment}`);
  return pending.splice(index, 1)[0];
}

const deniedRecord = {
  canEditData: false,
  canAdvanceStage: false,
  canEditFinancials: false,
  reason: "Your access level is view-only.",
};
const adminRecord = {
  canEditData: true,
  canAdvanceStage: true,
  canEditFinancials: true,
  reason: null,
};

// A denied record request starts, then the live profile changes to Admin.
// The fresh Admin response wins even when the old denial resolves last.
const oldRecordPromise = getRecordPermissions("PMM-1");
const oldRecordRequest = takePending("record-permissions/PMM-1");
bustPermissionCaches();
const freshRecordPromise = getRecordPermissions("PMM-1");
const freshRecordRequest = takePending("record-permissions/PMM-1");
freshRecordRequest.resolve(jsonResponse(adminRecord));
assert.equal((await freshRecordPromise).canEditFinancials, true);
oldRecordRequest.resolve(jsonResponse(deniedRecord));
assert.equal((await oldRecordPromise).canEditFinancials, false);
assert.equal((await getRecordPermissions("PMM-1")).canEditFinancials, true,
  "a pre-bust denial must not replace the fresh Admin record verdict");

const deniedCaps = {
  acl: "user",
  source: "builtin",
  levelName: null,
  caps: { editData: false, advanceStages: false, editFinancials: false, manageStaff: false, manageSettings: false, importPage: false },
  canImport: false,
  canSettings: false,
  groupIds: [],
};
const adminCaps = {
  acl: "admin",
  source: "builtin",
  levelName: null,
  caps: { editData: true, advanceStages: true, editFinancials: true, manageStaff: true, manageSettings: true, importPage: true },
  canImport: true,
  canSettings: true,
  groupIds: [],
};

// The same generation guard applies to the global capability single-flight.
const oldCapsPromise = getMyCapabilities({ fresh: true });
const oldCapsRequest = takePending("/my-capabilities");
bustPermissionCaches();
const freshCapsPromise = getMyCapabilities({ fresh: true });
const freshCapsRequest = takePending("/my-capabilities");
freshCapsRequest.resolve(jsonResponse(adminCaps));
assert.equal((await freshCapsPromise).caps.editFinancials, true);
oldCapsRequest.resolve(jsonResponse(deniedCaps));
assert.equal((await oldCapsPromise).caps.editFinancials, false);
assert.equal((await getMyCapabilities()).caps.editFinancials, true,
  "a pre-bust capability response must not replace the fresh Admin capabilities");

// Navigation uses the same guard: a role/nav change can start a fresh request
// while the prior route-change request is still in flight.
const oldNavPromise = getMyNavigation({ fresh: true });
const oldNavRequest = takePending("/my-navigation");
bustPermissionCaches();
const freshNavPromise = getMyNavigation({ fresh: true });
const freshNavRequest = takePending("/my-navigation");
freshNavRequest.resolve(jsonResponse({ hidden: ["reports"], order: [], labels: {} }));
assert.deepEqual((await freshNavPromise).hidden, ["reports"]);
oldNavRequest.resolve(jsonResponse({ hidden: [], order: [], labels: {} }));
assert.deepEqual((await oldNavPromise).hidden, []);
assert.deepEqual((await getMyNavigation()).hidden, ["reports"],
  "a pre-bust navigation response must not replace the fresh role verdict");

// Server storage lowercases ids; web consumers must recover the catalog's
// stable camel-case spelling for sidebar, route guard, settings, order, labels.
bustPermissionCaches();
const canonicalNavPromise = getMyNavigation({ fresh: true });
takePending("/my-navigation").resolve(jsonResponse({
  hidden: ["analyticscenter", "usageanalytics"],
  order: ["manager", "analyticscenter", "usageanalytics"],
  labels: { analyticscenter: "Insights", usageanalytics: "Adoption" },
}));
const canonicalNav = await canonicalNavPromise;
assert.deepEqual(canonicalNav.hidden, ["analyticsCenter", "usageAnalytics"]);
assert.deepEqual(canonicalNav.order, ["manager", "analyticsCenter", "usageAnalytics"]);
assert.deepEqual(canonicalNav.labels, { analyticsCenter: "Insights", usageAnalytics: "Adoption" });
assert.deepEqual(Object.keys(coerceNavItems({
  analyticscenter: { mode: "roles", roleIds: ["admin"], groupIds: [] },
  usageanalytics: { mode: "hidden", roleIds: [], groupIds: [] },
})), ["analyticsCenter", "usageAnalytics"]);

console.log("permissionCacheGeneration.test.ts: all assertions passed");