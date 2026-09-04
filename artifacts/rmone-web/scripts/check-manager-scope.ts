// check:manager-scope — Manager view surfaces must FAIL CLOSED on project scope.
//
// Bug this guards against (Sep 2026): clicking a direct report in Manager view
// opened the workload popup with the person's FULL project history when the
// person had no entry in projectIdsByPerson (undefined scope → unscoped), and
// consumers treated a provided-but-EMPTY scope as "show everything" via
// `projectScope?.length ? … : null`. Records not shared with the selected
// manager leaked into a manager-scoped view.
//
// Invariants (static source-binding on pages/resources.tsx and
// ResourcesTimelineGrid.tsx):
//   1. The fail-open pattern `projectScope?.length` is BANNED — scope consumers
//      must key on PRESENCE (`projectScope ? … : null`): provided-but-empty
//      means "nothing shared", not "unscoped".
//   2. Every Manager-grid click-handler lookup of projectIdsByPerson defaults
//      with `?? []` so a missing entry becomes an empty (fail-closed) scope,
//      never undefined.
//   3. Scoped popups stay honest: the scope owner's name is threaded to
//      StaffUtilModal so headings read "shared with <manager>".
//   4. The Manager grid seeds every displayed person with a scope entry, so
//      direct reports with no shared records cannot fall back to all projects.
//   5. ResourcesTimelineGrid keys its per-person filter on scope presence, so
//      an explicitly empty scope filters both cells and expanded project rows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "../src/pages/resources.tsx"), "utf8");
const timelineSrc = readFileSync(path.join(here, "../src/components/ResourcesTimelineGrid.tsx"), "utf8");

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`✓ ${label}`); }
  catch (e) { failures++; console.log(`✗ ${label}\n  ${(e as Error).message}`); }
}

// ── 1. Presence semantics: provided scope ALWAYS filters ────────────────────
check("fail-open `projectScope?.length` pattern is banned", () => {
  const hits = src.match(/projectScope\?\.length/g) ?? [];
  assert.equal(hits.length, 0,
    "scope consumers must key on presence (`projectScope ? new Set(…) : null`); " +
    "`projectScope?.length` reopens the leak by treating an empty scope as unscoped");
});

check("both scope consumers build scopeKeys from presence", () => {
  const hits = src.match(/scopeKeys\s*=[^;]{0,120}?projectScope\s*\?\s*new Set\(projectScope\.map\(/g) ?? [];
  assert.equal(hits.length, 2,
    `expected exactly 2 presence-keyed scopeKeys builders (StaffUtilModal + ` +
    `buildCellModalState), found ${hits.length}`);
});

// ── 2. Manager-grid click handlers pass a DEFINED scope (`?? []`) ───────────
check("every projectIdsByPerson click-handler lookup defaults to []", () => {
  const lookups = src.match(/managerGrid\?\.projectIdsByPerson\[/g) ?? [];
  const defaulted = src.match(/projectIdsByPerson\[\s*[^\]]*\]\s*\?\?\s*\[\]/g) ?? [];
  assert.equal(lookups.length, 3,
    `expected the 3 Manager-grid call sites (onPersonClick, onCellClick, ` +
    `onStatusBadgeClick); found ${lookups.length} — if a site was legitimately ` +
    `added/removed, update this count AND keep \`?? []\` on every lookup`);
  assert.equal(defaulted.length, lookups.length,
    `${lookups.length - defaulted.length} lookup(s) missing \`?? []\` — an ` +
    `undefined scope falls open to the person's full history`);
});

// ── 3. Honest labels: scope owner threaded into the popup ───────────────────
check("Manager weekly-hours popups carry the scope owner's name", () => {
  const calls = src.match(/openWeeklyHoursByName\([\s\S]{0,400}?\?\?\s*\[\],\s*managerGrid\?\.self\?\.name,\s*\)/g) ?? [];
  assert.equal(calls.length, 2,
    `expected onPersonClick + onStatusBadgeClick to pass managerGrid?.self?.name ` +
    `as scopeOwnerName, found ${calls.length}`);
});

check("StaffUtilModal receives scopeOwnerName from staffListModal state", () => {
  assert.ok(src.includes("scopeOwnerName={staffListModal.scopeOwnerName}"),
    "render site must thread staffListModal.scopeOwnerName into StaffUtilModal");
});

check("StaffUtilModal project lists stay inScope-filtered", () => {
  const hits = src.match(/\.filter\(inScope\)/g) ?? [];
  assert.ok(hits.length >= 2,
    `expected ≥2 .filter(inScope) list sources in StaffUtilModal, found ${hits.length}`);
});

// ── 4. Expanded Manager rows and cells use the same fail-closed scope ───────
check("Manager grid seeds every displayed person with an empty scope", () => {
  assert.match(
    src,
    /const ensurePersonScope = \(personId: string\) =>[\s\S]*?projectIdsByPerson\.set\(id, new Set<string>\(\)\)[\s\S]*?ensurePersonScope\(idL\)[\s\S]*?ensurePersonScope\(mid\)/,
    "every displayed Manager person must receive a scope entry before shared projects are added",
  );
});

check("Timeline grid treats a provided empty scope as nothing shared", () => {
  assert.match(
    timelineSrc,
    /const scopedSet = scopedIds\s*\?\s*new Set\(scopedIds\.map\(projectId => projectId\.trim\(\)\.toLowerCase\(\)\)\)\s*:\s*null/,
    "scope filtering must use presence, not scopedIds.length, so empty scopes filter closed",
  );
  assert.doesNotMatch(
    timelineSrc,
    /const scopedSet = scopedIds\?\.length/,
    "an empty Manager scope must not fall through to unrestricted cells or project rows",
  );
});

// ── 5. Visual chart follows projects, never company-org labels ─────────────
check("Manager visual chart roots at the manager and branches by project", () => {
  const start = src.indexOf("function ManagerOrgChartPopup");
  const end = src.indexOf("function ConflictAnalysisModal", start);
  assert.ok(start >= 0 && end > start, "ManagerOrgChartPopup source block must exist");
  const popup = src.slice(start, end);
  assert.ok(
    popup.includes('label={managerName}') && popup.includes('badge="Manager"'),
    "selected manager must be the chart root",
  );
  assert.ok(
    popup.includes('label={project.ticketId}') &&
    popup.includes("Team members") &&
    popup.includes("members={project.members}") &&
    popup.includes("project.members.length"),
    "each independent flow must show its project ID and named team members",
  );
  assert.doesNotMatch(
    popup,
    /roleCounts|RoleCountGrid|Working by role/,
    "project branches must not collapse team members into role-count cards",
  );
  assert.doesNotMatch(
    popup,
    /badge="(?:Business Unit|Division|Department)"/,
    "company hierarchy labels do not describe the Manager view relationship",
  );
});

console.log(failures === 0
  ? "\nPASS check-manager-scope: Manager surfaces fail closed on shared-record scope"
  : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
