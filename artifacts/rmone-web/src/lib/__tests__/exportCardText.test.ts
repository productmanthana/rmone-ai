import assert from "node:assert/strict";
import { sanitizeExportText } from "../exportCard";

assert.equal(
  sanitizeExportText("📋 All edits"),
  "All edits",
  "clipboard icon must not leak into exports",
);
assert.equal(
  sanitizeExportText("→ view · Live data — current"),
  "-> view - Live data - current",
  "arrows and typographic punctuation must stay readable in exports",
);
assert.equal(
  sanitizeExportText("✓ Complete ⚠️"),
  "[OK] Complete [Warning]",
  "status symbols must have plain-text export equivalents",
);

console.log("export text sanitization tests passed");