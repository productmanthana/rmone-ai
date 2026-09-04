/**
 * Task #801 — a successful member activation/deactivation must invalidate only
 * that tenant's resource, project-team and person-picker snapshots. The route
 * calls bustStaffIdentityCaches only after updateAppUser succeeds.
 */
import assert from "node:assert/strict";
import { startWatchdog } from "./helpers/fakeRdsDb.js";

startWatchdog("staffIdentityCacheFreshness");

const proxy = await import("../../routes/rmone-proxy.js");
const hooks = proxy.__staffIdentityCacheTestHooks;
const tid = "tenant-status-a";
const otherTid = "tenant-status-b";

hooks.resAllocsCache.set(tid, { data: { resources: [{ id: "a", enabled: true }] }, expiresAt: Date.now() + 60_000 });
hooks.resAllocsInFlight.set(tid, Promise.resolve({}));
hooks.projectTeamCache.set(`${tid}:PMM-1`, { data: { team: [{ resourceId: "a", enabled: true }] }, expiresAt: Date.now() + 60_000 });
hooks.projectTeamInFlight.set(`${tid}:PMM-1`, Promise.resolve({}));
hooks.projectTeamGen.set(`${tid}:PMM-1`, 7);
hooks.usersCache.set(tid, { data: [{ id: "a", enabled: true }], expiresAt: Date.now() + 60_000 });
hooks.usersInFlight.set(tid, Promise.resolve([]));

// Tenant isolation: a status save must not evict a different company's roster.
hooks.resAllocsCache.set(otherTid, { data: { resources: [{ id: "same-guid", enabled: true }] }, expiresAt: Date.now() + 60_000 });
hooks.projectTeamCache.set(`${otherTid}:PMM-1`, { data: { team: [{ resourceId: "same-guid", enabled: true }] }, expiresAt: Date.now() + 60_000 });
hooks.usersCache.set(otherTid, { data: [{ id: "same-guid", enabled: true }], expiresAt: Date.now() + 60_000 });

proxy.bustStaffIdentityCaches(tid);

assert.equal(hooks.resAllocsCache.has(tid), false, "resource allocation snapshot must be fresh after activation");
assert.equal(hooks.resAllocsInFlight.has(tid), false, "resource allocation in-flight work must be dropped");
assert.equal(hooks.projectTeamCache.has(`${tid}:PMM-1`), false, "project-team snapshot must be fresh after activation");
assert.equal(hooks.projectTeamInFlight.has(`${tid}:PMM-1`), false, "project-team in-flight work must be dropped");
assert.equal(hooks.projectTeamGen.get(`${tid}:PMM-1`), 8, "team generation must reject an older in-flight response");
assert.equal(hooks.usersCache.has(tid), false, "person picker snapshot must be fresh after activation");
assert.equal(hooks.usersInFlight.has(tid), false, "person picker in-flight work must be dropped");

assert.equal(hooks.resAllocsCache.has(otherTid), true, "other tenant resource snapshot must survive");
assert.equal(hooks.projectTeamCache.has(`${otherTid}:PMM-1`), true, "other tenant team snapshot must survive");
assert.equal(hooks.usersCache.has(otherTid), true, "other tenant picker snapshot must survive");

console.log("staff identity cache freshness regression passed");
process.exit(0);