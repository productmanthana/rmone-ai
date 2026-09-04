/**
 * Wiring guard for the unified data-sync bus (lib/dataSync.ts).
 *
 * The client's requirement: resolving an over-allocation, filling an open
 * position, adding/removing a team member, or updating a status — from ANY
 * surface — must show up on every other related page immediately, without a
 * manual browser refresh. That only stays true while every mutation helper
 * PUBLISHES on the bus and every live page SUBSCRIBES. This test greps the
 * real sources so a refactor that drops either side fails loudly.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const apiSource = read("../api.ts");
const busSource = read("../dataSync.ts");
const roleHomeSource = read("../../components/RoleHome.tsx");
const alertsSource = read("../../pages/alerts.tsx");
const resourcesSource = read("../../pages/resources.tsx");
const projectDetailSource = read("../../pages/project-detail.tsx");
const homeSource = read("../../pages/home.tsx");

/** Slice one exported function's body out of api.ts (up to the next export). */
function fnBody(source: string, name: string): string {
  const startMatch = source.match(new RegExp(`export (?:async )?function ${name}\\b`));
  assert.ok(startMatch?.index !== undefined, `api.ts must still export ${name}`);
  const start = startMatch.index!;
  const next = source.slice(start + 10).search(/\nexport /);
  return next === -1 ? source.slice(start) : source.slice(start, start + 10 + next);
}

// ── 1. The bus itself ──────────────────────────────────────────────────────
// Cross-tab marker is scope-only: record IDs must never be written to
// localStorage (same privacy stance as the legacy timestamp-only marker).
assert.match(
  busSource,
  /JSON\.stringify\(\s*\{ scopes: detail\.scopes, recordIds: \[\], at: detail\.at, nonce: detail\.nonce \}/,
  "dataSync cross-tab marker must strip recordIds before touching localStorage",
);
// Legacy compatibility: allocation-ish publishes must still emit the old
// event + marker for any listener not yet migrated to the bus.
assert.match(busSource, /rmone:allocationChanged/, "bus must keep emitting the legacy event");
assert.match(busSource, /rmone:allocationTs/, "bus must keep writing the legacy marker");

// ── 2. api.ts registers the cache-bust half ───────────────────────────────
const bustBlock = apiSource.match(/registerSyncBustHandler\(\(scopes\) => \{[\s\S]*?\n\}\);/)?.[0];
assert.ok(bustBlock, "api.ts must register the sync bust handler");
assert.match(bustBlock!, /markAllocationRefetchFresh\(\)/, "bust handler must arm one-shot fresh reads");
assert.match(bustBlock!, /bustCache\("resource-demands"\)/, "bust handler must bust the demand fetch cache");
assert.match(bustBlock!, /bustCache\("alerts-feed:"\)/, "bust handler must bust the alerts feed cache — Home/Alerts refetches would otherwise re-serve pre-write rows");
assert.match(bustBlock!, /queryKey: \["quick-actions"\]/, "bust handler must invalidate Quick Actions queries");

// ── 3. The legacy helper delegates to the bus ─────────────────────────────
assert.match(
  fnBody(apiSource, "notifyAllocationChanged"),
  /notifyDataChanged\(\["allocation", "demand"\]\)/,
  "notifyAllocationChanged must alias onto the bus so all ~30 existing call sites join it",
);

// ── 4. Every mutation helper publishes ─────────────────────────────────────
// Action coverage map (client's list):
//   resolve over-allocation / edit hours  → updateHoursAllocation & friends
//     (they call notifyAllocationChanged, asserted per-helper below)
//   fill an open position                 → assignResource
//   add a team member / open position     → assignResource / addOpenPosition / bulkCopyTeam
//   remove a member / hand over           → removeTeamMember / changeTeamResource
//   retire an open position               → removeOpenPosition (both outcomes)
//   update a status / edit fields         → updateFields / smartUpdate
//   create a record                       → createRecord
const mustPublish: Array<[fn: string, pattern: RegExp, why: string]> = [
  ["assignResource", /notifyDataChanged\(\["allocation", "team", "demand"\]\)/, "filling a position changes membership + demand everywhere"],
  ["addOpenPosition", /notifyDataChanged\(\["allocation", "team", "demand"\]\)/, "a new open position must appear on Demand/Home/Alerts immediately"],
  ["bulkCopyTeam", /notifyDataChanged\(\["allocation", "team", "demand"\]\)/, "copied teams change rosters on every page"],
  ["removeTeamMember", /notifyDataChanged\(\["allocation", "team"\]\)/, "removal was the one team write that never broadcast — must stay on the bus"],
  ["changeTeamResource", /notifyDataChanged\(\["allocation", "team"\]\)/, "hand-over changes two people's workloads"],
  ["updateFields", /notifyDataChanged\(\["record"\], \{ recordIds: \[recordId\] \}\)/, "status/field edits must reach Home, Alerts and open detail pages"],
  ["smartUpdate", /notifyDataChanged\(\["record"\], \{ recordIds: \[recordId\] \}\)/, "smartUpdate is the other record field write path"],
  ["createRecord", /notifyDataChanged\(\["record"\]\)/, "new records change lists and pickers"],
];
for (const [fn, pattern, why] of mustPublish) {
  assert.match(fnBody(apiSource, fn), pattern, `${fn} must publish on the data-sync bus: ${why}`);
}
// removeOpenPosition has TWO success outcomes (normal removal, and the 409
// "already gone" recovery) — both leave the server without the slot, so both
// must broadcast.
{
  const body = fnBody(apiSource, "removeOpenPosition");
  const hits = body.match(/notifyDataChanged\(\["allocation", "team", "demand"\]\)/g) ?? [];
  assert.ok(hits.length >= 2, "removeOpenPosition must publish on BOTH its success paths (normal + already-gone)");
}
// Hours writes (over-allocation fixes) go through helpers that call the
// legacy alias — spot-check the flag/lock togglers and hours save paths
// still notify at all.
for (const fn of ["setAllocationFlag", "setAllocationLock"]) {
  assert.match(
    fnBody(apiSource, fn),
    /notify(?:DataChanged|AllocationChanged)\(/,
    `${fn} must announce its write on the bus (directly or via the alias)`,
  );
}

// ── 5. Every live surface subscribes ───────────────────────────────────────
assert.match(roleHomeSource, /subscribeDataChanged\("any"/, "RoleHome (Home overlay) must subscribe to all scopes");
assert.match(alertsSource, /subscribeDataChanged\("any"/, "Alerts page must subscribe to all scopes");
assert.match(
  resourcesSource,
  /subscribeDataChanged\(\["allocation", "team", "demand", "staff"\]/,
  "Resources must refresh on allocation/team/demand/staff writes",
);
assert.match(
  projectDetailSource,
  /subscribeDataChanged\(\s*\["allocation", "team", "demand", "staff", "record"\]/,
  "Project Detail must refresh on team writes AND record edits",
);
assert.match(projectDetailSource, /recordIds\.includes\(id\)/, "Project Detail must skip record edits that touched OTHER records");
assert.match(homeSource, /subscribeDataChanged\("any"/, "Home page must subscribe to all scopes");
assert.match(homeSource, /\}, \[syncRevision\]\);/, "Home's load effect must re-run on the sync revision");

// ── 6. No double wiring left behind ────────────────────────────────────────
// The migrated surfaces must NOT also keep the legacy listeners — that would
// refetch twice per write (bus event + legacy event).
for (const [label, source] of [
  ["RoleHome", roleHomeSource],
  ["alerts", alertsSource],
  ["resources", resourcesSource],
  ["project-detail", projectDetailSource],
  ["home", homeSource],
] as const) {
  assert.doesNotMatch(
    source,
    /addEventListener\("rmone:allocationChanged"/,
    `${label} must not keep a legacy allocation listener alongside the bus subscription (double refetch)`,
  );
  assert.doesNotMatch(
    source,
    /\.key === "rmone:allocationTs"/,
    `${label} must not keep a legacy storage listener alongside the bus subscription (double refetch)`,
  );
}

console.log("dataSyncWiring.test.ts: every mutation publishes, every surface subscribes");
