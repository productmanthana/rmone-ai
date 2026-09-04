import assert from "node:assert/strict";
import type { LiveResourceProxy } from "../api.js";
import {
  applyResourceWeekOverrides,
  applyResourceWeekOverridesToUtilRows,
  hasResourceWeekOverrideInWindow,
  pruneConfirmedResourceWeekOverrides,
  removeResourceWeekOverrideIfRevision,
  resourceProjectWeekHours,
  resourceWeekOverrideKey,
  storeResourceWeekOverride,
  type ResourceWeekOverride,
} from "../resourceWeekOptimism.js";
import { parseUtilCell } from "../utilGrid.js";

const PERSON = "aaaaaaaa-0000-0000-0000-000000000001";
const PROJECT = "PMM-26-001";
const OTHER_PROJECT = "OPM-26-002";
const WEEK = "2026-08-17";
const WORK_WEEK = 40;

function resourceWithProjectHours(projectHours: number): LiveResourceProxy {
  return {
    id: PERSON,
    name: "Alex Chen",
    username: "alex@example.test",
    role: "Project Manager",
    currentPct: 90,
    totalProjects: 2,
    allProjectIds: [PROJECT, OTHER_PROJECT],
    activeProjects: [PROJECT, OTHER_PROJECT],
    activeAllocations: [
      { projectId: PROJECT, projectName: "Project One", pct: projectHours / WORK_WEEK * 100, hours: projectHours, startDate: WEEK, endDate: "2026-08-23" },
      { projectId: OTHER_PROJECT, projectName: "Other Project", pct: 25, hours: 10, startDate: WEEK, endDate: "2026-08-23" },
    ],
    allAllocations: [
      { projectId: PROJECT, projectName: "Project One", pct: projectHours / WORK_WEEK * 100, hours: projectHours, startDate: WEEK, endDate: "2026-08-23" },
      { projectId: OTHER_PROJECT, projectName: "Other Project", pct: 25, hours: 10, startDate: WEEK, endDate: "2026-08-23" },
    ],
    lastActiveDate: "2026-08-23",
  };
}

function override(hours: number, previousHours = 26, revision = 1): ResourceWeekOverride {
  return {
    personId: PERSON,
    personName: "Alex Chen",
    projectId: PROJECT,
    projectName: "Project One",
    week: WEEK,
    previousHours,
    hours,
    revision,
  };
}

const baseResource = resourceWithProjectHours(26);
const accepted = override(30);
assert.equal(
  hasResourceWeekOverrideInWindow(
    [accepted],
    PERSON,
    new Date("2026-07-01T00:00:00").getTime(),
    new Date("2026-09-30T00:00:00").getTime(),
  ),
  true,
  "the accepted Monday week is recognized inside its selected quarter",
);
assert.equal(
  hasResourceWeekOverrideInWindow(
    [accepted],
    PERSON,
    new Date("2026-10-01T00:00:00").getTime(),
    new Date("2026-12-31T00:00:00").getTime(),
  ),
  false,
  "an accepted edit in another quarter cannot trigger the selected quarter's zero-load fallback",
);
const patched = applyResourceWeekOverrides([baseResource], [accepted], WORK_WEEK)[0];

assert.equal(
  resourceProjectWeekHours(patched, PROJECT, WEEK, WORK_WEEK),
  30,
  "accepted value replaces the exact person/project/Monday week",
);
assert.equal(
  resourceProjectWeekHours(patched, OTHER_PROJECT, WEEK, WORK_WEEK),
  10,
  "an unrelated project in the same week is unchanged",
);

const weeklyRows = [{
  UserId: PERSON,
  ResourceUser: "Alex Chen",
  "Aug-17-26": "P:90#H:36#C:2#F:0.90#A:10#S:Good#IDS:PMM-26-001:65|OPM-26-002:25",
}];
const weeklyPatched = applyResourceWeekOverridesToUtilRows(
  weeklyRows,
  [baseResource],
  [accepted],
  "Weekly",
  WORK_WEEK,
);
const weeklyCell = parseUtilCell(weeklyPatched[0]["Aug-17-26"]);
assert.equal(weeklyCell?.h, 40, "timeline total moves by the accepted project-week delta");
assert.equal(weeklyCell?.p, 100, "capacity percentage moves with the accepted weekly total");
assert.deepEqual(
  [...(weeklyCell?.projectIds ?? [])].sort((a, b) => a.pid.localeCompare(b.pid)),
  [{ pid: OTHER_PROJECT, pct: 25 }, { pid: PROJECT, pct: 75 }],
  "expanded project weights reflect the accepted value",
);

const monthlyPatched = applyResourceWeekOverridesToUtilRows(
  [{
    UserId: PERSON,
    ResourceUser: "Alex Chen",
    "Aug-01-26": "P:90#H:36#C:2#F:0.90#A:10#S:Good#IDS:PMM-26-001:65|OPM-26-002:25",
  }],
  [baseResource],
  [accepted],
  "Monthly",
  WORK_WEEK,
);
const monthlyCell = parseUtilCell(monthlyPatched[0]["Aug-01-26"]);
assert.equal(monthlyCell?.h, 40, "monthly timeline aggregate receives the same accepted weekly delta");
assert.equal(monthlyCell?.p, 100, "monthly capacity average stays aligned for the affected active week");

const zeroedResources = applyResourceWeekOverrides([baseResource], [override(0)], WORK_WEEK);
assert.equal(
  resourceProjectWeekHours(zeroedResources[0], PROJECT, WEEK, WORK_WEEK),
  0,
  "saving zero removes the exact weekly project contribution",
);
const zeroedRows = applyResourceWeekOverridesToUtilRows(
  weeklyRows,
  [baseResource],
  [override(0)],
  "Weekly",
  WORK_WEEK,
);
const zeroedCell = parseUtilCell(zeroedRows[0]["Aug-17-26"]);
assert.equal(zeroedCell?.h, 10);
assert.equal(zeroedCell?.p, 25);
assert.deepEqual(zeroedCell?.projectIds, [{ pid: OTHER_PROJECT, pct: 25 }]);

const broadResource: LiveResourceProxy = {
  ...resourceWithProjectHours(26),
  activeAllocations: [
    { projectId: PROJECT, projectName: "Project One", pct: 50, startDate: "2026-08-10", endDate: "2026-08-30" },
  ],
  allAllocations: [
    { projectId: PROJECT, projectName: "Project One", pct: 50, startDate: "2026-08-10", endDate: "2026-08-30" },
  ],
};
const broadPatched = applyResourceWeekOverrides([broadResource], [accepted], WORK_WEEK)[0];
assert.equal(resourceProjectWeekHours(broadPatched, PROJECT, "2026-08-10", WORK_WEEK), 20);
assert.equal(resourceProjectWeekHours(broadPatched, PROJECT, WEEK, WORK_WEEK), 30);
assert.equal(resourceProjectWeekHours(broadPatched, PROJECT, "2026-08-24", WORK_WEEK), 20);

const confirmedRaw = resourceWithProjectHours(30);
const rebuiltFromConfirmedAlloc = applyResourceWeekOverridesToUtilRows(
  weeklyRows,
  [confirmedRaw],
  [accepted],
  "Weekly",
  WORK_WEEK,
);
assert.equal(parseUtilCell(rebuiltFromConfirmedAlloc[0]["Aug-17-26"])?.h, 40);
assert.equal(
  parseUtilCell(rebuiltFromConfirmedAlloc[0]["Aug-17-26"])?.p,
  100,
  "a confirmed allocation feed keeps a stale utilization refetch from repainting the old value",
);
const key = resourceWeekOverrideKey(PERSON, PROJECT, WEEK);
assert.equal(
  pruneConfirmedResourceWeekOverrides(
    { [key]: accepted },
    [confirmedRaw],
    weeklyRows,
    "Weekly",
    WORK_WEEK,
  )[key].hours,
  30,
  "allocation confirmation alone does not clear the overlay while utilization is stale",
);
const confirmedUtilRows = [{
  UserId: PERSON,
  ResourceUser: "Alex Chen",
  "Aug-17-26": "P:100#H:40#C:2#F:1.00#A:0#S:Good#IDS:PMM-26-001:75|OPM-26-002:25",
}];
assert.deepEqual(
  pruneConfirmedResourceWeekOverrides(
    { [key]: accepted },
    [confirmedRaw],
    confirmedUtilRows,
    "Weekly",
    WORK_WEEK,
  ),
  {},
  "the exact overlay clears only after allocation and utilization truth both catch up",
);

const verifiedAccepted = { ...accepted, verificationSucceeded: true };
const outsideLoadedRangeRows = [{
  UserId: PERSON,
  ResourceUser: "Alex Chen",
  "Sep-07-26": "P:25#H:10#C:1#F:0.25#A:75#S:Under#IDS:OPM-26-002:25",
}];
const observedWithoutPeriod = pruneConfirmedResourceWeekOverrides(
  { [key]: verifiedAccepted },
  [confirmedRaw],
  outsideLoadedRangeRows,
  "Weekly",
  WORK_WEEK,
);
assert.equal(
  observedWithoutPeriod[key].allocationConfirmed,
  true,
  "a verified value observed in raw allocations is marked even when its Timeline period is outside the loaded range",
);
assert.deepEqual(
  pruneConfirmedResourceWeekOverrides(
    { [key]: verifiedAccepted },
    [confirmedRaw],
    outsideLoadedRangeRows,
    "Weekly",
    WORK_WEEK,
    { allowMissingUtilPeriod: true, onlyKey: key, onlyRevision: accepted.revision },
  ),
  {},
  "the completed fresh refetch may clear an exact overlay whose Timeline period is not loaded",
);
assert.deepEqual(
  pruneConfirmedResourceWeekOverrides(
    observedWithoutPeriod,
    [resourceWithProjectHours(34)],
    outsideLoadedRangeRows,
    "Weekly",
    WORK_WEEK,
  ),
  {},
  "a later external server value replaces an already observed accepted overlay instead of being masked",
);

assert.deepEqual(
  applyResourceWeekOverridesToUtilRows(
    monthlyPatched,
    [],
    [accepted],
    "Monthly",
    WORK_WEEK,
  ),
  monthlyPatched,
  "utilization-only responses are left unchanged until the matching allocation snapshot can rebuild them exactly",
);

const baseDifferentWeeks: LiveResourceProxy = {
  ...resourceWithProjectHours(26),
  activeAllocations: [
    { projectId: OTHER_PROJECT, projectName: "Other Project", pct: 25, hours: 10, startDate: "2026-08-03", endDate: "2026-08-09" },
  ],
  allAllocations: [
    { projectId: OTHER_PROJECT, projectName: "Other Project", pct: 25, hours: 10, startDate: "2026-08-03", endDate: "2026-08-09" },
  ],
};
const monthlyActivation = applyResourceWeekOverridesToUtilRows(
  [{
    UserId: PERSON,
    ResourceUser: "Alex Chen",
    "Aug-01-26": "P:25#H:10#C:1#F:0.25#A:75#S:Under#IDS:OPM-26-002:25",
  }],
  [baseDifferentWeeks],
  [override(20, 0)],
  "Monthly",
  WORK_WEEK,
);
const activatedMonth = parseUtilCell(monthlyActivation[0]["Aug-01-26"]);
assert.equal(activatedMonth?.h, 30, "a new active week is included in the monthly hours sum");
assert.equal(activatedMonth?.p, 38, "monthly percentage averages both active Monday buckets");
assert.equal(activatedMonth?.c, 1, "monthly project count remains the peak concurrent count");
assert.deepEqual(
  activatedMonth?.projectIds,
  [{ pid: OTHER_PROJECT, pct: 25 }, { pid: PROJECT, pct: 50 }],
);

const monthlyZero = applyResourceWeekOverridesToUtilRows(
  [{
    UserId: PERSON,
    ResourceUser: "Alex Chen",
    "Aug-01-26": "P:58#H:36#C:1#F:0.58#A:42#S:Good#IDS:OPM-26-002:25|PMM-26-001:65",
  }],
  [{
    ...baseDifferentWeeks,
    activeAllocations: [
      ...(baseDifferentWeeks.activeAllocations ?? []),
      { projectId: PROJECT, projectName: "Project One", pct: 65, hours: 26, startDate: WEEK, endDate: "2026-08-23" },
    ],
    allAllocations: [
      ...(baseDifferentWeeks.allAllocations ?? []),
      { projectId: PROJECT, projectName: "Project One", pct: 65, hours: 26, startDate: WEEK, endDate: "2026-08-23" },
    ],
  }],
  [override(0)],
  "Monthly",
  WORK_WEEK,
);
const zeroedMonth = parseUtilCell(monthlyZero[0]["Aug-01-26"]);
assert.equal(zeroedMonth?.h, 10, "zeroing the only allocation in a week removes it from monthly hours");
assert.equal(zeroedMonth?.p, 25, "zeroing an active week removes it from the monthly average denominator");
assert.deepEqual(
  zeroedMonth?.projectIds,
  [{ pid: OTHER_PROJECT, pct: 25 }],
  "a project with no remaining month allocation is removed from monthly project IDs",
);

const older = override(30, 26, 1);
const newer = override(32, 30, 2);
const latestMap = storeResourceWeekOverride(storeResourceWeekOverride({}, older), newer);
assert.equal(latestMap[key].hours, 32, "a newer accepted edit replaces the older exact tuple");
assert.equal(
  removeResourceWeekOverrideIfRevision(latestMap, key, older.revision),
  latestMap,
  "an older failed save cannot clear a newer accepted edit",
);
assert.deepEqual(
  removeResourceWeekOverrideIfRevision(latestMap, key, newer.revision),
  {},
  "the matching revision can be removed during rollback",
);

console.log("resource-week-optimism: all assertions passed");