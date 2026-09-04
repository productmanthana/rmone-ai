import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { highestAllocationTicket } from "../homeIntelligence";

assert.equal(
  highestAllocationTicket([
    { ticket: "PMM-26-00002435", pct: 89 },
    { ticket: "PMM-26-00002436", pct: 120 },
  ]),
  "PMM-26-00002436",
  "a later, larger project allocation must win over display order",
);
assert.equal(
  highestAllocationTicket([
    { ticket: "PMM-26-00002435", pct: 120 },
    { ticket: "PMM-26-00002436", pct: 120 },
  ]),
  "PMM-26-00002435",
  "ties keep the first stable project target",
);

const roleHomeSource = readFileSync(
  new URL("../../components/RoleHome.tsx", import.meta.url),
  "utf8",
);
assert.match(
  roleHomeSource,
  /function openHomeAllocationFromLink\(to: string\): boolean/,
  "Home must recognize person Timeline links as allocation-popup targets",
);
assert.match(
  roleHomeSource,
  /setHomeAllocationTarget\(\{ person, fallback: to \}\)/,
  "Home must keep the linked person and fallback route when opening the allocation popup",
);
assert.match(
  roleHomeSource,
  /<StaffUtilModal[\s\S]*mode="all"[\s\S]*onSaveProjectWeek=\{saveHomeAllocationWeek\}/,
  "Home must show the reusable all-projects allocation popup with weekly editing enabled",
);
assert.match(
  roleHomeSource,
  /if \(!openHomeAllocationFromLink\(to\)\) setLocation\(to\);/,
  "Home panels must use the in-place popup before falling back to normal navigation",
);

console.log("home-overload-target: all assertions passed");