import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const roleHomeSource = readFileSync(
  new URL("../../components/RoleHome.tsx", import.meta.url),
  "utf8",
);
const homeIntelligenceSource = readFileSync(
  new URL("../homeIntelligence.ts", import.meta.url),
  "utf8",
);
const rdsProviderSource = readFileSync(
  new URL("../../../../api-server/src/lib/rds-provider.ts", import.meta.url),
  "utf8",
);

assert.match(
  rdsProviderSource,
  /ra\.ID AS RaId/,
  "the demand API must expose the backing ResourceAllocation ID",
);
assert.match(
  homeIntelligenceSource,
  /_raId: raId/,
  "home demand rows must retain the backing RA ID for alert actions",
);
assert.match(
  roleHomeSource,
  /const raId = demandRaId\(row\?\.\["_raId"\]\)/,
  "Add Team Member must capture the selected alert row's exact RA ID",
);
assert.match(
  roleHomeSource,
  /consumeRaIds=\{qaAddMemberConsumeRaIds\}/,
  "the selected (or safely recovered) RA ID must be passed into the assignment modal",
);
assert.match(
  roleHomeSource,
  /retireOpenPositionFromOverlay\(current, consumedRaIds\)/,
  "a successful assignment must optimistically retire the selected position",
);

console.log("roleHomeOpenPositionRetire: explicit alert-row RA IDs are preserved and retired");