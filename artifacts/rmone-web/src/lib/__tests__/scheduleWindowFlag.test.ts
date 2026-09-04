// Schedule-window flag wiring — every add / edit / change-resource surface
// must resolve the record's ACTUAL display mode (per-record override +
// module-aware tenant fallback) before telling the server whether member
// dates are bound to the phase schedule, or pass nothing so the server's
// module-aware fallback governs. A fabricated boolean (e.g. the tenant
// PROJECT mode for an OPM record) overrides the server with the wrong rule —
// the exact regression this guard exists to block.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string): string =>
  readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

// ── AddTeamMemberModal resolves per record, or preserves undefined ──────────
const modal = read("components/AddTeamMemberModal.tsx");
assert.ok(
  modal.includes("getDisplayModeForRecord(projectId, module)"),
  "the modal must resolve the record's own display mode (override + module-aware tenant fallback)",
);
assert.ok(
  modal.includes("useProjectViewModeVersion();"),
  "the modal must re-resolve when a per-record override changes while open",
);
assert.ok(
  modal.includes("scheduleWindowEnabled: recordResolvedMode != null ? scheduleEnabled : undefined"),
  "only a RECORD-resolved answer may become a boolean; hosts without record context must leave the flag undefined so the SERVER fallback governs",
);
assert.ok(
  !modal.includes("scheduleWindowEnabled: scheduleEnabled,"),
  "the modal must never pass an always-boolean flag derived from the tenant project mode (wrong for OPM/LEM, blind to overrides)",
);

// ── Cascade forwards the flag on ALL THREE save payloads ─────────────────────
// (edit/persist-window, change-resource, and the main assign), omitting the
// key entirely when undefined — an explicit false must stay distinguishable
// from "caller had no record context".
const cascade = read("hooks/useAssignMemberCascade.ts");
const spread =
  "...(scheduleWindowEnabled !== undefined ? { ScheduleWindowEnabled: scheduleWindowEnabled } : {})";
assert.equal(
  cascade.split(spread).length - 1,
  3,
  "the cascade must conditionally spread ScheduleWindowEnabled on exactly its three save payloads (persist-window edit, change-resource, assign)",
);

// ── InlineAddMemberRow: record-resolved rule + visible-date policy ──────────
const row = read("components/InlineAddMemberRow.tsx");
assert.ok(
  row.includes("getDisplayModeForRecord(projectId, module)"),
  "the inline row must resolve the record's own display mode, not the legacy tenant-global fallback",
);
assert.ok(
  row.includes("useProjectViewModeVersion();"),
  "the inline row must re-resolve when a per-record override changes",
);
assert.equal(
  row.split("clampTyped={false}").length - 1,
  2,
  "both inline date controls must keep typed out-of-window dates VISIBLE (no silent snap) — warn + block instead",
);
assert.ok(
  row.includes("const dateWindowIssue = hasScheduleWindow && ("),
  "the inline row must compute an out-of-window state for its visible dates",
);
assert.ok(
  row.includes("const submitOk = canSubmit && !dateWindowIssue;"),
  "out-of-window dates must block the Add button, mirroring the modal",
);
assert.equal(
  row.split("disabled={!submitOk && !submitting}").length - 1,
  2,
  "both Add buttons (strip + gridRow) must gate on the window check",
);
assert.ok(
  row.split("member dates must stay within {schedWindowLabel}").length - 1 >= 2,
  "both inline variants must show the schedule-window warning, not just disable the button",
);

// ── Every modal host passes record module context ───────────────────────────
// Instance count is asserted per file so a NEW context-less instance (which
// would silently fall back to the server's tenant-mode guess and ignore
// per-record overrides) fails loudly here.
const modalHosts: Array<[string, number]> = [
  ["pages/project-detail.tsx", 3], // add + change-resource + edit member
  ["pages/quick-actions.tsx", 3],
  ["pages/projects.tsx", 2], // teamPending + TeamModal (PMM and adapted OPM)
  ["pages/lead-create.tsx", 2],
  ["pages/opportunity-create.tsx", 1],
  ["pages/project-create.tsx", 1],
  ["components/RoleHome.tsx", 1],
  ["components/StaffRecordAssignmentModal.tsx", 1],
  ["hooks/useStaffingQuickActions.tsx", 1],
];
for (const [rel, expected] of modalHosts) {
  const src = read(rel);
  const chunks = src.split("<AddTeamMemberModal").slice(1);
  assert.equal(
    chunks.length,
    expected,
    `${rel}: expected ${expected} AddTeamMemberModal instance(s) — update this guard when adding one, and give it record context`,
  );
  chunks.forEach((chunk, i) => {
    const end = chunk.indexOf("/>");
    const props = chunk.slice(0, end === -1 ? 2500 : Math.min(end, 2500));
    assert.ok(
      /(^|\s)module=/.test(props),
      `${rel}: AddTeamMemberModal instance ${i + 1} must pass module= so the modal can resolve the record's display mode (or the schedule-window flag degrades to the server's tenant guess)`,
    );
  });
}

// TeamScheduleGrid feeds the inline row the same record context.
const grid = read("components/TeamScheduleGrid.tsx");
const rowChunks = grid.split("<InlineAddMemberRow").slice(1);
assert.ok(rowChunks.length >= 3, "TeamScheduleGrid renders the inline add row in its strip and grid variants");
rowChunks.forEach((chunk, i) => {
  const end = chunk.indexOf("/>");
  const props = chunk.slice(0, end === -1 ? 2500 : Math.min(end, 2500));
  assert.ok(
    /(^|\s)module=/.test(props),
    `TeamScheduleGrid: InlineAddMemberRow instance ${i + 1} must pass module=`,
  );
});

console.log("scheduleWindowFlag.test.ts passed");
