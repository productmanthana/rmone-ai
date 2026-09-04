import assert from "node:assert/strict";

// Import with a configured direct key so the provider-error path actually
// attempts a request. The client method is replaced before any network call.
process.env.ANTHROPIC_API_KEY = "test-only-placeholder";

const [{ anthropic }, { aiMapColumns }] = await Promise.all([
  import("../anthropic.js"),
  import("../data-cleaning/ai.js"),
]);

const originalCreate = anthropic.messages.create.bind(anthropic.messages);
let calls = 0;
(anthropic.messages as any).create = async () => {
  calls += 1;
  throw new Error("simulated provider failure");
};

const input = [{ header: "Mystery Header", samples: ["example"] }];
const targets = ["Project ID", "Project Title"];

const providerFailure = await aiMapColumns("Projects", targets, input);
assert.deepEqual(providerFailure, { "Mystery Header": null });
assert.equal(calls, 1, "configured provider should have been attempted");

delete process.env.ANTHROPIC_API_KEY;
const missingKey = await aiMapColumns("Projects", targets, input);
assert.deepEqual(missingKey, { "Mystery Header": null });
assert.equal(calls, 1, "missing key must skip the provider and fall back safely");

(anthropic.messages as any).create = originalCreate;
console.log("✓ Data Cleaning AI failure falls back to unresolved review decisions");