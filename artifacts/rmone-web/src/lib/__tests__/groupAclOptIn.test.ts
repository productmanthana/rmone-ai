/**
 * Regression tests: GroupAccessLevelPopup's suggested-level opt-in model
 * (lib/groupAclPopupModel.ts — the popup routes all its suggested/created
 * level logic through these functions).
 *
 * Covers:
 *  A) buildSuggestedSeed — dedupe, built-in/custom exclusion, casing, caps
 *  B) ✕-removing a suggested level, then typing a SAME-NAMED draft via
 *     "+ New level", must NOT auto-create it unless a group picks it
 *     (bug caught in architect review, Aug 2026)
 *  C) decline-all — every chip ✕-removed → nothing is created
 *  D) commitDraftLevel — existing-name reuse, blank/whitespace, 80-char cap
 *  E) computeUsedNewLevels — picked-only rule + opted-in suggestions
 */

import assert from "node:assert/strict";
import {
  buildSuggestedSeed,
  removeSuggestedOptIn,
  commitDraftLevel,
  computeUsedNewLevels,
  type LevelDraft,
} from "../groupAclPopupModel.js";

type Caps = { editData: boolean };
const CAPS: Caps = { editData: true };
const BUILTINS = ["Admin", "Manager", "User"] as const;
const draft = (name: string): LevelDraft<Caps> => ({ name, caps: CAPS });

// ── A) buildSuggestedSeed ───────────────────────────────────────────────────
{
  const seed = buildSuggestedSeed(
    ["Standard", "standard", " STANDARD ", "Admin", "manager", "Viewer", "viewer", "", "  "],
    ["Contractor"],
    BUILTINS,
  );
  assert.deepEqual(seed, ["Standard", "Viewer"], "dedupe case-insensitively, first casing wins, built-ins excluded");
  assert.deepEqual(buildSuggestedSeed(["contractor"], ["Contractor"], BUILTINS), [], "tenant customs excluded");
  assert.deepEqual(buildSuggestedSeed(undefined, [], BUILTINS), []);
  const long = "x".repeat(120);
  assert.deepEqual(buildSuggestedSeed([long], [], BUILTINS), [long.slice(0, 80)], "names cap at 80 chars");
}

// ── B) ✕-removed suggestion + same-named draft must follow picked-only ─────
{
  // Popup opens with "Standard" suggested (seeded as a draft + opted in).
  const seed = buildSuggestedSeed(["Standard"], [], BUILTINS);
  let created: LevelDraft<Caps>[] = seed.map(draft);
  let optedIn = new Set(seed.map(n => n.toLowerCase()));

  // ✕ on the chip: draft removed AND opt-in dropped (mirrors removeCreated).
  created = created.filter(x => x.name !== "Standard");
  optedIn = removeSuggestedOptIn(optedIn, "Standard");
  assert.equal(optedIn.size, 0);

  // Later, the user types a same-named draft via "+ New level" but assigns
  // it to NO group (commitNew picks it for one group; user re-picks that
  // group to "User" afterwards).
  const levels = [...BUILTINS];
  const res = commitDraftLevel(levels, created, "Standard", CAPS);
  created = res.created;
  assert.equal(res.pick, "Standard");
  const picks = { pmo: "User" }; // the group was re-pointed away

  // The stale suggestion must NOT resurrect: nothing picked it → not created.
  const used = computeUsedNewLevels(created, picks, optedIn);
  assert.deepEqual(used, [], "same-named draft after ✕ must not auto-create unless a group picks it");

  // …but if a group DOES pick it, it is created (picked-only rule).
  const used2 = computeUsedNewLevels(created, { pmo: "Standard" }, optedIn);
  assert.deepEqual(used2.map(u => u.name), ["Standard"]);
}

// removeSuggestedOptIn is a referential no-op for unknown names (React state).
{
  const set = new Set(["standard"]);
  assert.equal(removeSuggestedOptIn(set, "Viewer"), set, "unknown name must return the same Set instance");
  assert.notEqual(removeSuggestedOptIn(set, " STANDARD "), set, "trim+case-insensitive removal");
}

// ── C) decline-all creates nothing ──────────────────────────────────────────
{
  const seed = buildSuggestedSeed(["Standard", "Viewer"], [], BUILTINS);
  let created = seed.map(draft);
  let optedIn = new Set(seed.map(n => n.toLowerCase()));
  for (const n of [...seed]) {
    created = created.filter(x => x.name !== n);
    optedIn = removeSuggestedOptIn(optedIn, n);
  }
  assert.deepEqual(
    computeUsedNewLevels(created, { pmo: "User" }, optedIn),
    [],
    "✕ every suggested level → confirm creates nothing",
  );
}

// Left-in-place suggestions ARE created even when no group picks them —
// their rows carry the name directly.
{
  const seed = buildSuggestedSeed(["Standard"], [], BUILTINS);
  const created = seed.map(draft);
  const optedIn = new Set(seed.map(n => n.toLowerCase()));
  assert.deepEqual(
    computeUsedNewLevels(created, { pmo: "User" }, optedIn).map(u => u.name),
    ["Standard"],
    "opted-in suggestion is created even without a group pick",
  );
}

// ── D) commitDraftLevel ─────────────────────────────────────────────────────
{
  const levels = ["Admin", "Manager", "User", "Contractor"];
  // Existing name (any casing) → reuse, no new draft.
  const r1 = commitDraftLevel(levels, [], "  contractor ", CAPS);
  assert.equal(r1.pick, "Contractor");
  assert.deepEqual(r1.created, []);
  // Blank → no-op.
  const r2 = commitDraftLevel(levels, [], "   ", CAPS);
  assert.equal(r2.pick, null);
  // Fresh name → appended and picked; 80-char cap applied.
  const r3 = commitDraftLevel(levels, [], "y".repeat(100), CAPS);
  assert.equal(r3.pick, "y".repeat(80));
  assert.equal(r3.created.length, 1);
}

// ── E) computeUsedNewLevels picked-only for plain drafts ────────────────────
{
  const created = [draft("Reviewer"), draft("Auditor")];
  const used = computeUsedNewLevels(created, { pmo: "Reviewer" }, new Set());
  assert.deepEqual(used.map(u => u.name), ["Reviewer"], "unpicked plain draft is discarded");
}

console.log("groupAclOptIn: all tests passed");
