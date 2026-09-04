import assert from "node:assert/strict";
import { STAFF_COLS, staffRows } from "../analyticsCenter";
import type { StaffRow } from "../reportData";
import { dedupeUsageOrgStaff } from "../usageOrg";

const totalProjectsColumn = STAFF_COLS.find(column => column.key === "totalProjects");
assert.equal(totalProjectsColumn?.label, "Total Projects");
assert.equal(STAFF_COLS.some(column => column.key === "activeProjects"), false);

const base: StaffRow = {
  id: "person-1",
  name: "Abdul",
  role: "Architect",
  division: "Construction Mgt",
  utilization: 50,
  activeProjects: 1,
  totalProjects: 2,
  band: "Light",
};

assert.equal(staffRows([base])[0].totalProjects, 2);
assert.equal(
  staffRows([{ ...base, totalProjects: undefined }])[0].totalProjects,
  1,
  "older cached rows must fall back to the active count",
);

const duplicateRoster = dedupeUsageOrgStaff([
  { ...base, id: "legacy-1", role: "Staff" },
  { ...base, id: "legacy-2", role: "Staff", totalProjects: 0, utilization: 0 },
]);
assert.equal(duplicateRoster.length, 1, "same person duplicated across legacy ids must count once");
assert.equal(duplicateRoster[0].totalProjects, 2, "the richer duplicate row must be preserved");

const sameNameDifferentRole = dedupeUsageOrgStaff([
  { ...base, id: "person-a", role: "Staff" },
  { ...base, id: "person-b", role: "Architect" },
]);
assert.equal(sameNameDifferentRole.length, 2, "same-name people with different roles must remain separate");

console.log("staff total-project and roster dedupe tests passed");