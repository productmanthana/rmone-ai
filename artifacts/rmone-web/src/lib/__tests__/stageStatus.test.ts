import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyStageCfgToOptions,
  currentSchedulePhase,
  ensureCustomStatusInStageCfg,
  futureSchedulePhase,
  isConfiguredCustomStatus,
  parseStageCfg,
  schedulePhaseNames,
} from "../stageStatus";

const schedule = {
  data: [
    { Title: "Proposal", StageStep: 1, StartDate: "2026-01-01", DueDate: "2026-02-01" },
    { Title: "Negotiation", StageStep: 2, StartDate: "2026-02-02", EndDate: "2026-03-01" },
    { Title: "Delivery", StageStep: 3, StartDate: "2026-03-02", DueDate: "2026-04-01" },
  ],
};

assert.deepEqual(schedulePhaseNames(schedule), ["Proposal", "Negotiation", "Delivery"]);
assert.equal(
  currentSchedulePhase(schedule, new Date("2026-02-18T12:00:00Z").getTime()),
  "Negotiation",
  "EndDate is a valid normalized schedule endpoint",
);
assert.equal(
  currentSchedulePhase(schedule, new Date("2026-02-01T18:00:00Z").getTime()),
  "Proposal",
  "a DueDate remains active through its entire calendar day",
);
assert.equal(
  currentSchedulePhase(schedule, new Date(2026, 1, 1, 23, 30).getTime()),
  "Proposal",
  "a phase remains active at 11:30 PM on its local DueDate",
);

const cfg = parseStageCfg({
  order: ["Proposal", "Warranty", "Negotiation"],
  custom: ["Warranty"],
  removed: ["Proposal"],
  subStatuses: { negotiation: ["Client review"] },
});
assert.deepEqual(
  applyStageCfgToOptions(["Proposal", "Negotiation"], cfg, true),
  ["Proposal", "Negotiation", "Client review", "Warranty"],
  "schedule phases remain ordered and visible while controlled per-record extras follow",
);
assert.deepEqual(
  applyStageCfgToOptions(["New", "Qualified"], {
    order: ["Qualified", "New"],
    custom: [],
    removed: [],
  }, false),
  ["Qualified", "New"],
  "non-schedule workflows can still apply their controlled order",
);
assert.deepEqual(
  applyStageCfgToOptions(["Pipeline", "Active"], {
    order: ["Pending Award", "Pipeline", "Active"],
    custom: ["Pending Award"],
    removed: [],
  }, false),
  ["Pending Award", "Pipeline", "Active"],
  "unscheduled records retain their controlled custom statuses",
);
assert.deepEqual(
  futureSchedulePhase("Delivery", schedule, cfg, new Date("2026-01-20T12:00:00Z").getTime()),
  { phase: "Delivery", startDay: "2026-03-02" },
  "a future lifecycle phase is rejected before any status write",
);
assert.equal(
  futureSchedulePhase("Warranty", schedule, cfg, new Date("2026-01-20T12:00:00Z").getTime()),
  null,
  "controlled custom statuses are not schedule-gated",
);
const withQuickCustom = ensureCustomStatusInStageCfg(cfg, ["Proposal", "Negotiation"], "Proposal2");
assert.deepEqual(
  withQuickCustom.custom,
  ["Warranty", "Proposal2"],
  "saving a new custom status adds it to the record's reusable custom options",
);
assert.equal(
  withQuickCustom.order.at(-1),
  "Proposal2",
  "a new custom status is appended to the controlled per-record order",
);
assert.equal(
  isConfiguredCustomStatus("Proposal2", withQuickCustom),
  true,
  "a saved custom status overrides the date-derived phase in record summaries",
);

const projectsSource = readFileSync(new URL("../../pages/projects.tsx", import.meta.url), "utf8");
const quickActionsSource = readFileSync(new URL("../../pages/quick-actions.tsx", import.meta.url), "utf8");
const projectDetailSource = readFileSync(new URL("../../pages/project-detail.tsx", import.meta.url), "utf8");
assert.match(
  projectsSource,
  /type === "pmm" \? "CRMProjectStatusChoice"/,
  "Projects writes PMM status changes to the canonical project status field",
);
assert.match(
  projectsSource,
  /futureSchedulePhase\(value, scheduleData\.tasks, scheduleData\.cfg\)/,
  "Projects blocks future schedule phases before saving",
);
assert.match(
  projectsSource,
  /requiresLifecycleInspection && lifecycleState !== "ready"/,
  "Projects disables status saving until lifecycle inspection succeeds",
);
assert.match(
  projectsSource,
  /setLifecycleState\("error"\)/,
  "Projects fails closed when lifecycle inspection cannot be completed",
);
assert.match(
  projectsSource,
  /getStageCfg\(recordId, field, \{ strict: true \}\)/,
  "Projects treats a failed stage-config lookup as an inspection failure",
);
assert.match(
  quickActionsSource,
  /futureSchedulePhase\(value, lifecycle\.tasks, lifecycle\.cfg\)/,
  "Quick Actions blocks future schedule phases before saving",
);
assert.match(
  quickActionsSource,
  /const baseOptions = phases;/,
  "Quick Actions never falls back to the tenant status pile — a schedule-less record lists only its own Override-cfg options",
);
assert.doesNotMatch(
  quickActionsSource,
  /await getFieldOptions\("status", module!\)/,
  "the PMM/OPM lifecycle query must not fetch tenant-wide status options",
);
assert.match(
  quickActionsSource,
  /getStageCfg\(item\.id, field, \{ strict: true \}\)/,
  "Quick Actions treats a failed stage-config lookup as an inspection failure",
);
assert.match(
  quickActionsSource,
  /lifecycleStatusQuery\.isLoading \|\| lifecycleStatusQuery\.isError \|\| !lifecycle/,
  "Quick Actions cannot write while lifecycle inspection is unresolved or failed",
);
assert.match(
  quickActionsSource,
  /lifecycleStatusQuery\.isError[\s\S]*?Try again/,
  "Quick Actions exposes retry rather than an empty-status fallback after inspection failure",
);
assert.match(
  quickActionsSource,
  /const result = await updateFields\([\s\S]*?stageCfgSaveQueueRef\.current[\s\S]*?saveStageCfg\(item\.id, fieldName, merged, \{ strict: true \}\)/,
  "Quick Actions blocks only on the record status write and queues custom-option persistence",
);
// The queued persist must merge into a FRESHLY re-read cfg — saving the
// hub's open-time copy would wipe a custom status added on another surface
// (record page / projects list) between hub open and save.
assert.match(
  quickActionsSource,
  /const freshCfg = parseStageCfg\(await getStageCfg\(item\.id, fieldName, \{ strict: true \}\)\)[\s\S]*?ensureCustomStatusInStageCfg\(freshCfg, cfgBaseOptions, savedValue\)/,
  "Quick Actions merges custom-option persistence against a freshly re-read cfg",
);
// Every surface persists a typed custom status into the record's Override
// cfg: the record page's typed save must do it too (same reusable option on
// projects modal + Quick Actions afterwards). It must be serialized AND
// merge against a freshly re-read STRICT server cfg — saveStageCfg replaces
// the whole document, so merging into a stale copy wipes options added
// meanwhile by the footer Override modal or another surface.
assert.match(
  projectDetailSource,
  /stageCfgTypedQueueRef\.current = stageCfgTypedQueueRef\.current[\s\S]*?apiGetStageCfg\(recId, field, \{ strict: true \}\)[\s\S]*?ensureCustomStatusInStageCfg\(cfg, phases, value\)/,
  "record page persists typed customs via a serialized queue over a fresh server cfg",
);
// While schedule phases are unresolved we cannot tell a base phase from a
// custom — the persist must skip rather than misfile a real phase as custom.
assert.match(
  projectDetailSource,
  /if \(schedulePhases === null\) return;[\s\S]{0,200}?const phases = schedulePhases;/,
  "typed-custom persist is gated on resolved schedule phases",
);
// The footer Override modal keeps its cfg in React state — it must adopt
// external cfg writes (typed STATUS-cell customs) or its next save clobbers
// them with the stale whole-document copy.
assert.match(
  projectDetailSource,
  /onExternalCfgWrite[\s\S]*?stageCfgGenRef\.current\+\+;\s*setStageCfg\(readStageCfg\(stageCfgKey\)\);/,
  "footer Override modal adopts external cfg writes and joins the generation guard",
);
assert.match(
  projectDetailSource,
  /return saveField\("CRMProjectStatusChoice", v\)\.then\(\(res\) => \{\s*persistTypedCustomStatus\(v\);/,
  "record page PMM status save chains the reusable-option persist",
);
assert.match(
  projectDetailSource,
  /return saveField\("CRMOpportunityStatusChoice", v\)\.then\(\(res\) => \{\s*persistTypedCustomStatus\(v\);/,
  "record page OPM status save chains the reusable-option persist",
);
// List-page writes must arm the record page's one-shot fresh read — without
// it the record page keeps serving its stale cached copy after a status
// change from the three-dots menu.
assert.match(
  projectsSource,
  /await updateFields\(rec\.id, \[\{ FieldName: field, Value: value \}\]\);[\s\S]{0,400}?markProjectDetailRefetchFresh\(rec\.id\);/,
  "projects-list status modal arms a fresh record-page read after saving",
);
assert.match(
  quickActionsSource,
  /setVisibleStatusOverride\(value\)[\s\S]*?const savedValue[\s\S]*?reconcileStatusAfterMutation\(fieldName, savedValue, mutationSeq\)/,
  "Quick Actions highlights a status optimistically and reconciles its detail in the background",
);
assert.match(
  quickActionsSource,
  /statusMutationSeqRef\.current !== mutationSeq[\s\S]*?Keep the accepted write visible/,
  "an older status reconciliation cannot overwrite a newer accepted selection",
);
assert.match(
  quickActionsSource,
  /selected = option\.trim\(\)\.toLowerCase\(\) === currentStatus\.trim\(\)\.toLowerCase\(\)/,
  "Quick Actions highlights the saved current status rather than an unsaved text draft",
);

console.log("stage-status: all assertions passed");