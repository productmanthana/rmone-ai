import { strict as assert } from "node:assert";
import {
  canonicalizeResourcePopupProjectRefs,
  resolveResourcePopupProjectId,
} from "../resourcePopupProjectIdentity";

const names: Record<string, string> = {
  "PMM-26-00002436": "test",
  "PMM-26-00002435": "tse66",
  testtt: "test",
};
const nameForId = (projectId: string) => names[projectId] ?? projectId;
const candidates = [
  { projectId: "PMM-26-00002436", projectName: "test" },
  { projectId: "PMM-26-00002435", projectName: "tse66" },
];

assert.equal(
  resolveResourcePopupProjectId("testtt", candidates, nameForId),
  "PMM-26-00002436",
  "a compact display alias resolves to the person's unique canonical PMM TicketId",
);
assert.equal(
  resolveResourcePopupProjectId("pmm-26-00002435", candidates, nameForId),
  "PMM-26-00002435",
  "an exact TicketId match preserves the canonical server casing",
);
assert.equal(
  resolveResourcePopupProjectId(
    "Shared title",
    [
      { projectId: "PMM-26-1", projectName: "Shared title" },
      { projectId: "PMM-26-2", projectName: "Shared title" },
    ],
    projectId => projectId,
  ),
  "Shared title",
  "an ambiguous display name is never guessed into the wrong project",
);
assert.deepEqual(
  canonicalizeResourcePopupProjectRefs(
    [
      { pid: "testtt", pct: 60 },
      { pid: "PMM-26-00002436", pct: 40 },
    ],
    candidates,
    nameForId,
  ),
  [{ pid: "PMM-26-00002436", pct: 100 }],
  "alias and canonical references merge under one TicketId without losing their weights",
);

console.log("resource-popup-project-identity: all assertions passed");