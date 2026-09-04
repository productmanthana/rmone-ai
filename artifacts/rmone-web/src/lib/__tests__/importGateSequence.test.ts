/**
 * Regression tests: the import wizard's pre-run pause points (staff-groups,
 * record-groups, new-access-levels) can never loop forever or get silently
 * skipped after going Back.
 *
 * Covers (state machine in lib/importGateLatches.ts, wired 1:1 into
 * InlineDataGrid's finishSubmitInner / stepBackFromGroups / submit resets):
 *  A) gate fires → confirm → re-entry proceeds (no infinite popup loop)
 *  B) Back → Continue re-offers the step (no silent skip)
 *  C) decline-all (✕ every suggested level) → continues without re-prompt
 *  D) a brand-new submit pass re-offers every step
 *  E) all three gates walk in order; confirming one never skips the next
 *  F) auto-resolved staff gate (stored defaults) does NOT swallow New-levels
 *  G) canStepBack: file mode always; template mode only after Fix issues
 */

import assert from "node:assert/strict";
import { ImportGateLatches, type GateFacts } from "../importGateLatches.js";

const facts = (p: Partial<GateFacts> = {}): GateFacts => ({
  staffGroupsGate: false,
  recordGroupsGate: false,
  hasNewLevels: false,
  ...p,
});

// ── A) gate fires → confirm → re-entry proceeds ─────────────────────────────
{
  const g = new ImportGateLatches();
  g.startSubmitPass();
  // Staff gate fires…
  assert.equal(g.next(facts({ staffGroupsGate: true, hasNewLevels: true })), "staffGroups");
  // …popup confirmed (picks applied, suggested levels answered)…
  g.resolveStaffGroups({ viaPopupConfirm: true });
  // …re-entry: the confirm filled the empty cells, but even if the staff
  // gate WOULD still fire (same facts), the latch walks past it exactly once
  // — and the levels offer was answered on the same popup, so no re-prompt.
  assert.equal(g.next(facts({ staffGroupsGate: true, hasNewLevels: true })), null, "confirmed pass must proceed to import");
  // Latches are one-shot: consumed by the walk, not sticky.
  const s = g.snapshot();
  assert.equal(s.staffResolved, false);
  assert.equal(s.newLevelsResolved, false);
}

// Same for the record-groups gate.
{
  const g = new ImportGateLatches();
  g.startSubmitPass();
  assert.equal(g.next(facts({ recordGroupsGate: true, hasNewLevels: true })), "recordGroups");
  g.resolveRecordGroups({ viaPopupConfirm: true });
  assert.equal(g.next(facts({ recordGroupsGate: true, hasNewLevels: true })), null);
}

// Levels-only gate (any card, unknown Access Level values). The levels-only
// popup is the staff popup with groups:[] — its confirm resolves the staff
// latch with viaPopupConfirm (same code path in InlineDataGrid).
{
  const g = new ImportGateLatches();
  g.startSubmitPass();
  assert.equal(g.next(facts({ hasNewLevels: true })), "newLevels");
  g.resolveStaffGroups({ viaPopupConfirm: true });
  assert.equal(g.next(facts({ hasNewLevels: true })), null, "created levels must not re-prompt");
}

// ── B) Back → Continue re-offers the step ───────────────────────────────────
{
  const g = new ImportGateLatches();
  g.startSubmitPass();
  assert.equal(g.next(facts({ hasNewLevels: true })), "newLevels");
  g.stepBack(); // "← Back" from the popup re-arms the offer
  assert.equal(g.next(facts({ hasNewLevels: true })), "newLevels", "Back then Continue must re-offer the New-levels step");
  // And confirming after the re-offer still proceeds.
  g.resolveStaffGroups({ viaPopupConfirm: true });
  assert.equal(g.next(facts({ hasNewLevels: true })), null);
}

// Back from the staff-groups popup: the staff latch was never set (Back is
// only reachable before confirm) → the gate re-fires on the next walk.
{
  const g = new ImportGateLatches();
  g.startSubmitPass();
  assert.equal(g.next(facts({ staffGroupsGate: true })), "staffGroups");
  g.stepBack();
  assert.equal(g.next(facts({ staffGroupsGate: true })), "staffGroups", "Back must not consume the staff gate");
}

// ── C) decline-all continues without creating and without re-prompting ─────
// ✕ removing every suggested level then Confirm: usedNew is empty (nothing
// created — covered by the popup model tests) but the confirm still latches
// the levels offer, so the unknown values in the data don't loop the popup.
{
  const g = new ImportGateLatches();
  g.startSubmitPass();
  assert.equal(g.next(facts({ hasNewLevels: true })), "newLevels");
  g.resolveStaffGroups({ viaPopupConfirm: true }); // confirm with all chips ✕-removed
  // Data still names unknown levels (they import as typed) — no re-prompt.
  assert.equal(g.next(facts({ hasNewLevels: true })), null, "declined levels must stay declined this pass");
}

// ── D) a brand-new submit pass re-offers ───────────────────────────────────
{
  const g = new ImportGateLatches();
  g.startSubmitPass();
  assert.equal(g.next(facts({ hasNewLevels: true })), "newLevels");
  g.resolveStaffGroups({ viaPopupConfirm: true });
  assert.equal(g.next(facts({ hasNewLevels: true })), null);
  // New "Upload N rows" click → submitTemplateData/submitFileData reset.
  g.startSubmitPass();
  assert.equal(g.next(facts({ hasNewLevels: true })), "newLevels", "a new submit pass must re-offer the step");
}

// ── E) sequential walk — confirming one gate never skips the next ──────────
{
  const g = new ImportGateLatches();
  g.startSubmitPass();
  const all = facts({ staffGroupsGate: true, recordGroupsGate: true, hasNewLevels: true });
  assert.equal(g.next(all), "staffGroups");
  g.resolveStaffGroups({ viaPopupConfirm: true });
  // Re-entry (staff cells now filled → staff gate false, others remain).
  assert.equal(g.next(facts({ recordGroupsGate: true, hasNewLevels: true })), "recordGroups");
  g.resolveRecordGroups({ viaPopupConfirm: true });
  assert.equal(g.next(facts({ hasNewLevels: true })), null, "record-groups confirm carried the level chips");
}

// Record-groups confirm answers the levels offer, but a staff confirm in a
// LATER pass must not leak: each pass re-arms the levels one-shot.
{
  const g = new ImportGateLatches();
  g.startSubmitPass();
  g.resolveRecordGroups({ viaPopupConfirm: true });
  g.startSubmitPass();
  assert.equal(g.next(facts({ hasNewLevels: true })), "newLevels", "levels latch must not leak across passes");
}

// ── F) auto-resolved gates must NOT swallow the New-levels step ────────────
// All staff groups had stored default levels → no popup was shown, so the
// suggested-level chips were never offered: the walk must still pause on
// the dedicated New-levels step (otherwise the import would run WITHOUT
// creating the promised levels — the exact silent-skip bug class).
{
  const g = new ImportGateLatches();
  g.startSubmitPass();
  g.resolveStaffGroups(); // auto path — no viaPopupConfirm
  assert.equal(g.next(facts({ hasNewLevels: true })), "newLevels", "auto staff resolve must not skip New-levels");
}
{
  const g = new ImportGateLatches();
  g.startSubmitPass();
  g.resolveRecordGroups(); // auto path (fetch failed / no unknown groups)
  assert.equal(g.next(facts({ hasNewLevels: true })), "newLevels", "auto record-groups resolve must not skip New-levels");
}

// ── G) canStepBack ──────────────────────────────────────────────────────────
{
  const g = new ImportGateLatches();
  g.startSubmitPass();
  assert.equal(g.canStepBack(true), true, "file mode always has Review matches to land on");
  assert.equal(g.canStepBack(false), false, "clean template pass has no earlier step");
  g.markFixIssuesShown();
  assert.equal(g.canStepBack(false), true, "Fix issues shown → Back has a target");
  g.startSubmitPass();
  assert.equal(g.canStepBack(false), false, "Fix-issues marker resets each pass");
}

console.log("importGateSequence: all tests passed");
