import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const providerSource = readFileSync(
  new URL("../rds-provider.ts", import.meta.url),
  "utf8",
);
const routeSource = readFileSync(
  new URL("../../routes/rmone-proxy.ts", import.meta.url),
  "utf8",
);

const guardStart = providerSource.indexOf("// A person may have only one active assignment identity per project.");
const insertStart = providerSource.indexOf("// ── INSERT new assignment", guardStart);
assert.notEqual(guardStart, -1, "server duplicate-assignment guard must exist");
assert.notEqual(insertStart, -1, "new-assignment insert marker must exist");
assert.ok(guardStart < insertStart, "duplicate guard must run before the new-assignment insert");

const guard = providerSource.slice(guardStart, insertStart);
assert.match(guard, /existingRwiId\s*<=\s*0/, "positive existing IDs must retain the edit path");
assert.match(guard, /ResourceWorkItems rwi WITH \(UPDLOCK, HOLDLOCK\)/, "RWI duplicate check must lock against concurrent inserts");
assert.match(guard, /ResourceAllocation ra WITH \(UPDLOCK, HOLDLOCK\)/, "legacy/direct allocation identities must also be checked");
assert.match(guard, /rwi\.ResourceUser = @person/, "duplicate identity must be person-GUID based");
assert.match(guard, /rwi\.WorkItem = @pid/, "duplicate identity must be project based");
assert.match(guard, /throw new DuplicateAssignmentError/, "duplicates must fail closed");

assert.match(
  routeSource,
  /e instanceof DuplicateAssignmentError[\s\S]{0,260}res\.status\(409\)/,
  "the assignment route must return a stable conflict instead of a generic upstream error",
);

console.log("duplicate-assignment-guard: inserts fail closed while positive-ID edits remain allowed");