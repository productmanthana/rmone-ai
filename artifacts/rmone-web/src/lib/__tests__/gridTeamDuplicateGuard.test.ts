import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pageSource = readFileSync(
  new URL("../../pages/projects.tsx", import.meta.url),
  "utf8",
);

const teamActionStart = pageSource.indexOf('action === "team"');
assert.notEqual(teamActionStart, -1, "grid team action handler must exist");
const teamAction = pageSource.slice(teamActionStart, teamActionStart + 1000);

assert.match(
  teamAction,
  /getProjectTeam\(record\.id,\s*true\)/,
  "grid Add Team Member must fetch a fresh team before opening the modal",
);
assert.match(
  teamAction,
  /existingAllocations:\s*quickExistingAllocations\(team\.team\)/,
  "grid Add Team Member must derive duplicate guards from the fresh team",
);
assert.match(
  pageSource,
  /existingAllocations=\{teamPending\.existingAllocations\}/,
  "grid Add Team Member modal must receive the fetched allocation refs",
);

console.log("grid-team-duplicate-guard: grid add verifies the fresh team before opening");