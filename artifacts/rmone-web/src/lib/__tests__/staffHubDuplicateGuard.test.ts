/**
 * Regression guard: the staff quick-actions hub (StaffActionHub) must never
 * let a person be added to a record they already belong to.
 *
 * The mechanism:
 *   1. When the user picks a record, `prepQuery` fetches the team with
 *      `getProjectTeam(id, true)` — the `true` flag busts both the client
 *      React-Query cache AND the server worker cache, so even a stale
 *      snapshot cannot smuggle a duplicate through.
 *   2. The team fetch MUST NOT be silently caught.  A failed read leaves
 *      `prepQuery.isError` true, which keeps the AddTeamMemberModal closed,
 *      so the user cannot proceed without a verified team list.
 *   3. The `prepQuery` cache key includes BOTH module AND record id, so a
 *      PMM record and an OPM record that happen to share the same TicketId
 *      never reuse each other's prep result.
 *   4. The fresh team is passed through `quickExistingAllocations()` to the
 *      `existingAllocations` prop of AddTeamMemberModal, which is what the
 *      planner uses to detect and redirect duplicate adds to edit-in-place.
 *   5. `quickExistingAllocations` maps team members by `resourceId` (GUID),
 *      matching the GUID-first lookup in `useAssignMemberCascade`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pageSource = readFileSync(
  new URL("../../pages/quick-actions.tsx", import.meta.url),
  "utf8",
);
const quickActionsSource = readFileSync(
  new URL("../quickActions.ts", import.meta.url),
  "utf8",
);
const roleHomeSource = readFileSync(
  new URL("../../components/RoleHome.tsx", import.meta.url),
  "utf8",
);

// ── 1. Fresh read ──────────────────────────────────────────────────────────
// The team fetch inside prepQuery must pass true (fresh=true) so no stale
// client or server cache can allow a duplicate to slip through.
assert.match(
  pageSource,
  /getProjectTeam\(record\.id,\s*true\)/,
  "prepQuery must call getProjectTeam with fresh=true to bust client+server caches",
);

// ── 2. No silent catch on team fetch ──────────────────────────────────────
// The task-data fetch is intentionally .catch(() => null) because schedule
// bounds are optional context.  The team fetch must NOT be silently caught —
// any error must propagate so prepQuery lands in isError state and the modal
// stays closed (fail-closed duplicate guard).
const prepQueryStart = pageSource.indexOf(
  '"quick-actions", "staff-assign-prep"',
);
assert.notEqual(
  prepQueryStart,
  -1,
  'prepQuery with "staff-assign-prep" key must exist in StaffActionHub',
);
// Grab enough of the queryFn body to cover the three Promise.all arms.
const prepQueryBlock = pageSource.slice(prepQueryStart, prepQueryStart + 2500);

// getTaskData is caught; getProjectTeam must NOT be.
assert.match(
  prepQueryBlock,
  /getTaskData[\s\S]*?\.catch\(\(\) => null\)/,
  "getTaskData (schedule bounds) must be silently caught since it is optional context",
);
assert.doesNotMatch(
  prepQueryBlock,
  /getProjectTeam[\s\S]{0,120}\.catch/,
  "getProjectTeam inside prepQuery must NOT be silently caught — team errors must block the modal",
);

// ── 3. Cross-module cache isolation ───────────────────────────────────────
// The prep cache key must include the module so a PMM record and an OPM
// record with the same TicketId never share prep data.
assert.match(
  pageSource,
  /queryKey:\s*\["quick-actions",\s*"staff-assign-prep",\s*pickedModule/,
  "staff-assign-prep cache key must be scoped by module to prevent cross-module cache reuse",
);

// ── 4. Fresh team wired to existingAllocations ────────────────────────────
// AddTeamMemberModal must receive existingAllocations from the fresh prepQuery
// team read, not from any cached snapshot.
assert.match(
  pageSource,
  /existingAllocations=\{quickExistingAllocations\(prepQuery\.data\.team\.team\)\}/,
  "AddTeamMemberModal (staff hub path) must receive existingAllocations from the fresh prepQuery team read",
);

// ── 5. Exact open-slot consumption ─────────────────────────────────────────
// A Quick Actions assignment starts from a person, so it can consume a demand
// row only when the fresh project team exposes one unambiguous open role. For
// multi-role projects the modal receives the fresh role list and its existing
// role chips select the exact RA IDs instead of closing unrelated positions.
assert.match(
  pageSource,
  /consumeRaIds=\{openSlotRaIdsForQuickFill\(prepQuery\.data\.team\.openRoles, item\.role\)\}/,
  "StaffActionHub must pass the matching fresh open-slot RA ID list to AddTeamMemberModal",
);
assert.match(
  pageSource,
  /openRoles=\{prepQuery\.data\.team\.openRoles\}/,
  "StaffActionHub must pass fresh open roles so multi-slot fills consume the selected role only",
);
assert.match(
  pageSource,
  /function openSlotRaIdsForQuickFill\(\s*openRoles: readonly OpenRole\[\],\s*staffRole\?: string,/,
  "Quick Actions must identify a safe slot by the selected staff member's role",
);
assert.match(
  pageSource,
  /return matchingSlots\.length === 1 \? matchingSlots\[0\]\.raIds : undefined/,
  "Quick Actions must refuse to auto-consume several matching open roles at once",
);
assert.ok(
  pageSource.includes('replace(/\\s*\\(\\d+\\)$/, "")'),
  "Quick Actions must normalize a trailing duplicate suffix before deciding a slot is unambiguous",
);
assert.match(
  pageSource,
  /requireOpenRoleSelection=\{hasDuplicateOpenRoleChoices\(prepQuery\.data\.team\.openRoles\)\}/,
  "Quick Actions must require an explicit choice when duplicate role/title slots are present",
);
assert.match(
  pageSource,
  /consumeRaIds=\{openSlotRaIdsForQuickFill[\s\S]*?inferredConsumeRaIds/,
  "Quick Actions must mark shortcut-derived RA IDs as inferred rather than as an operator's selected slot",
);
assert.match(
  pageSource,
  /seenRoleLabels[\s\S]*?seenTitleLabels/,
  "Quick Actions must treat duplicate roles OR duplicate titles as ambiguous, even when their other label differs",
);

const addTeamMemberSource = readFileSync(
  new URL("../../components/AddTeamMemberModal.tsx", import.meta.url),
  "utf8",
);
const cascadeSource = readFileSync(
  new URL("../../hooks/useAssignMemberCascade.ts", import.meta.url),
  "utf8",
);
assert.match(
  addTeamMemberSource,
  /data-testid=\{`open-role-choice-\$\{i\}`\}[\s\S]*?\{dates\} · \{hours\} · \{org\}/,
  "Duplicate open-role choices must show their own dates, hours, and organization context",
);
assert.match(
  addTeamMemberSource,
  /data-testid="open-role-selection-required"/,
  "The add-member form must explain when a duplicate slot selection is required",
);
assert.match(
  cascadeSource,
  /!openRoleSelectionRequired[\s\S]*?!buMismatchPromptOpen/,
  "The save action must stay disabled until the operator selects an identical open role",
);
assert.match(
  cascadeSource,
  /ConsumeOpenSlotRaIds: consumeIds[\s\S]*?RequireOpenSlotSelection: true/,
  "A chosen slot must send only its own RA IDs and mark the request as explicitly selected",
);
assert.match(
  cascadeSource,
  /return matching\.length > 1/,
  "Role matching ambiguity must require a choice even when identical roles have different titles",
);
assert.match(
  cascadeSource,
  /roleStillMatches[\s\S]*?titleStillMatches[\s\S]*?setConsumeIds\(inferredConsumeRaIds \? null/,
  "Changing the person or title after choosing a slot must clear stale RA IDs before save",
);
assert.match(
  cascadeSource,
  /A person change can infer a new role\/title[\s\S]*?inferredConsumeRaIds \? null/,
  "Quick Actions must clear inferred RA IDs rather than restoring them after role, title, or person changes",
);

// ── 6. Home count refresh ──────────────────────────────────────────────────
// assignResource publishes on the unified data-sync bus after a successful
// save. RoleHome must subscribe and re-fetch its live overlay so the demand
// count drops immediately without waiting for a navigation or timed refresh.
assert.match(
  roleHomeSource,
  /subscribeDataChanged\("any",\s*\(\)\s*=>\s*setAllocationRevision/,
  "RoleHome must refresh via the data-sync bus when a write fills an open role",
);
assert.match(
  roleHomeSource,
  /allocationRevision\]/,
  "RoleHome overlay fetch must depend on the allocation revision",
);

// ── 7. Modal gated on prepQuery.data (error keeps modal closed) ───────────
// When prepQuery.isError the modal must NOT render, so the user cannot bypass
// the duplicate check with a stale or absent team snapshot.
assert.match(
  pageSource,
  /pickedRecord && prepQuery\.data/,
  "AddTeamMemberModal must be gated on prepQuery.data so an error state keeps it closed",
);

// ── 6. GUID-first personId in quickExistingAllocations ────────────────────
// The planner's duplicate detection uses existingAllocations[].personId, and
// useAssignMemberCascade matches by GUID first.  quickExistingAllocations must
// map member.resourceId (the GUID) as personId.
assert.match(
  quickActionsSource,
  /personId:\s*member\.resourceId/,
  "quickExistingAllocations must map member.resourceId as personId for GUID-first duplicate detection",
);

console.log(
  "staff-hub-duplicate-guard: fresh team read wins over cache; cross-module isolation confirmed; duplicate add is blocked",
);
