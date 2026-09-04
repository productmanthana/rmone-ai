import assert from "node:assert/strict";
import {
  orderedDetailPreviewKeys,
  orderVisibleGridColumns,
  reorderPinnedDetailKeys,
} from "../displayDefaults";

const withLegacy = ["alpha", "legacy-field", "beta", "gamma"];
assert.deepEqual(
  reorderPinnedDetailKeys(withLegacy, "beta", "alpha"),
  ["beta", "legacy-field", "alpha", "gamma"],
  "moving known fields must preserve an unrecognized pinned key and its position",
);

assert.deepEqual(
  orderedDetailPreviewKeys(
    ["locked-id"],
    ["beta", "legacy-field", "alpha"],
    new Set(["locked-id", "alpha", "beta"]),
  ),
  ["locked-id", "beta", "alpha"],
  "preview must follow persisted pinned order while omitting unavailable keys",
);

assert.deepEqual(
  orderVisibleGridColumns(
    [{ key: "id" }, { key: "name" }, { key: "status" }, { key: "client" }, { key: "menu" }],
    ["status", "client"],
    new Set(["id", "name"]),
  ).map((column) => column.key),
  ["id", "name", "status", "client", "menu"],
  "legacy saved orders must keep omitted locked identity fields leading",
);

console.log("display-defaults-ordering: all assertions passed");