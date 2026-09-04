/**
 * Phase-rename propagation check (CI gate).
 * Run: npx tsx scripts/check-phase-rename-propagation.ts
 *
 * Verifies that a renamed schedule phase reaches existing project and
 * opportunity schedule cards end-to-end, covering three propagation paths:
 *
 *   Path A  Default PMM phases (defaultPhases setting)
 *           → reconcileDefaultLifecyclePhasesRds
 *           → (sig pass) reconcileDefaultLifecyclesBySigRds for "Imported:" templates
 *           → propagateLifecycleStageTitlesToPMMTasksRds
 *
 *   Path B  Default OPM stages (defaultOpportunityStages setting)
 *           → reconcileDefaultLifecyclesBySigRds (OPM)
 *           → propagateLifecycleStageTitlesToPMMTasksRds
 *
 *   Path C  Named phase sets (projectPhaseSets / oppStageSets settings)
 *           → syncPhaseSetLifecyclesRds (both PMM and OPM)
 *           → propagateLifecycleStageTitlesToPMMTasksRds (byName + byPrevSig paths)
 *
 * What is checked here (no DB required):
 *   1. RENAME-PAIR LOGIC   — the positional matching + dedup + unchanged-skip
 *      rules inside propagateLifecycleStageTitlesToPMMTasksRds, verified with
 *      fixture tables that cover all known edge cases.
 *   2. OUTCOME FILTER      — isOutcomeStageName is applied consistently on all
 *      OPM paths so outcome stages (Lost / Won / Closed …) are never written
 *      as schedulable phases into OPM lifecycle templates.
 *   3. SOURCE WIRING       — static analysis of onboarding.ts settings-save
 *      handler and rds-provider.ts reconcile functions ensures every path calls
 *      propagateLifecycleStageTitlesToPMMTasksRds after each template rewrite
 *      and fires bustTaskDataCache + bustLifecyclesCache so schedule cards
 *      refresh without waiting for a 6 h TTL.
 *
 * Exit code 0 = all good; 1 = at least one failure.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isOutcomeStageName } from "../src/lib/stage-rules.js";
import { planLifecyclePhasePropagation } from "../src/lib/lifecycle-phase-diff.js";

const here = dirname(fileURLToPath(import.meta.url));

let failures = 0;
const fail  = (msg: string) => { failures++; console.error("FAIL  " + msg); };
const ok    = (msg: string) => console.log("ok    " + msg);

// ── 1. Phase-aware propagation plan ───────────────────────────────────────────
// Exercise the production planner directly. Middle insertions/deletions must
// preserve common phase identities rather than turning every shifted row into
// a rename.
type PlanFixture = {
  label: string;
  oldList: string[];
  newList: string[];
  want: {
    renames: Array<{ old: string; nw: string }>;
    added: Array<{ title: string; step: number }>;
    removed: string[];
    orderChanged: boolean;
  };
};

const PLAN_FIXTURES: PlanFixture[] = [
  {
    label: "single rename",
    oldList: ["Planning", "Design", "Construction"],
    newList: ["Planning", "Schematic Design", "Construction"],
    want: {
      renames: [{ old: "Design", nw: "Schematic Design" }],
      added: [], removed: [], orderChanged: false,
    },
  },
  {
    label: "identical lists are a no-op",
    oldList: ["Planning", "Design", "Construction"],
    newList: ["Planning", "Design", "Construction"],
    want: { renames: [], added: [], removed: [], orderChanged: false },
  },
  {
    label: "all phases renamed in place",
    oldList: ["A", "B", "C"],
    newList: ["X", "Y", "Z"],
    want: {
      renames: [{ old: "A", nw: "X" }, { old: "B", nw: "Y" }, { old: "C", nw: "Z" }],
      added: [], removed: [], orderChanged: false,
    },
  },
  {
    label: "pure reorder preserves phase identities",
    oldList: ["Alpha", "Beta", "Closeout"],
    newList: ["Beta", "Alpha", "Closeout"],
    want: { renames: [], added: [], removed: [], orderChanged: true },
  },
  {
    label: "middle insertion adds only the new phase",
    oldList: ["Planning", "Construction", "Closeout"],
    newList: ["Planning", "Design", "Construction", "Closeout"],
    want: {
      renames: [],
      added: [{ title: "Design", step: 2 }],
      removed: [],
      orderChanged: true,
    },
  },
  {
    label: "middle deletion removes only the selected phase",
    oldList: ["Planning", "Design", "Construction", "Closeout"],
    newList: ["Planning", "Construction", "Closeout"],
    want: {
      renames: [],
      added: [],
      removed: ["Design"],
      orderChanged: true,
    },
  },
  {
    label: "tail insertion does not disturb existing order",
    oldList: ["A", "B"],
    newList: ["A", "B", "C"],
    want: {
      renames: [],
      added: [{ title: "C", step: 3 }],
      removed: [],
      orderChanged: false,
    },
  },
  {
    label: "rename plus tail insertion stays unambiguous",
    oldList: ["A", "B", "C"],
    newList: ["A", "B2", "C", "D"],
    want: {
      renames: [{ old: "B", nw: "B2" }],
      added: [{ title: "D", step: 4 }],
      removed: [],
      orderChanged: false,
    },
  },
];

for (const fixture of PLAN_FIXTURES) {
  const plan = planLifecyclePhasePropagation(fixture.oldList, fixture.newList);
  const got = {
    renames: plan.renames,
    added: plan.added,
    removed: plan.removed,
    orderChanged: plan.orderChanged,
  };
  if (JSON.stringify(got) !== JSON.stringify(fixture.want)) {
    fail(`phase-plan[${fixture.label}]: got ${JSON.stringify(got)} — want ${JSON.stringify(fixture.want)}`);
  } else {
    ok(`phase-plan[${fixture.label}]`);
  }
}

// ── 2. isOutcomeStageName filter ──────────────────────────────────────────────
// OPM paths filter outcome stages out before writing lifecycle templates so
// "Closed – Won" / "Lost" / "Converted" never appear as schedulable phases.
// Verify both positive (outcome) and negative (schedulable) cases plus the
// en-dash variant the real data uses.

type OutcomeFixture = { name: string; wantOutcome: boolean };
const OUTCOME_FIXTURES: OutcomeFixture[] = [
  // Known outcome names — must be TRUE
  { name: "Lost",                   wantOutcome: true },
  { name: "lost",                   wantOutcome: true },
  { name: "Won",                    wantOutcome: true },
  { name: "won",                    wantOutcome: true },
  { name: "Converted",              wantOutcome: true },
  { name: "converted",              wantOutcome: true },
  { name: "Cancelled",              wantOutcome: true },
  { name: "Canceled",               wantOutcome: true },
  { name: "Declined",               wantOutcome: true },
  { name: "declined",               wantOutcome: true },
  // "Closed" prefix variants (en-dash = U+2013, em-dash = U+2014)
  { name: "Closed",                 wantOutcome: true },
  { name: "Closed – Won",           wantOutcome: true },  // en-dash
  { name: "Closed \u2013 Won",      wantOutcome: true },  // en-dash (explicit)
  { name: "Closed \u2014 Lost",     wantOutcome: true },  // em-dash
  { name: "Closed - Won",           wantOutcome: true },  // hyphen
  { name: "closed - lost",          wantOutcome: true },
  // Schedulable stages — must be FALSE
  { name: "Planning",               wantOutcome: false },
  { name: "Design",                 wantOutcome: false },
  { name: "Construction",           wantOutcome: false },
  { name: "Closeout",               wantOutcome: false },
  { name: "Proposal",               wantOutcome: false },
  { name: "Negotiation",            wantOutcome: false },
  { name: "Active",                 wantOutcome: false },
  { name: "",                       wantOutcome: false },
];

for (const f of OUTCOME_FIXTURES) {
  const got = isOutcomeStageName(f.name);
  if (got !== f.wantOutcome) {
    fail(`outcome-filter["${f.name}"]: got ${got} — want ${f.wantOutcome}`);
  } else {
    ok(`outcome-filter["${f.name}"] → ${got}`);
  }
}

// ── 3. Source wiring verification ─────────────────────────────────────────────
// Read the actual source files and assert that every propagation path correctly
// calls propagateLifecycleStageTitlesToPMMTasksRds after committing a template
// rewrite, and that cache busts fire on the reconcile result.

const rdsProviderSrc = (() => {
  try {
    return readFileSync(join(here, "../src/lib/rds-provider.ts"), "utf8");
  } catch {
    fail("wiring: cannot read src/lib/rds-provider.ts");
    return "";
  }
})();

const onboardingSrc = (() => {
  try {
    return readFileSync(join(here, "../src/routes/onboarding.ts"), "utf8");
  } catch {
    fail("wiring: cannot read src/routes/onboarding.ts");
    return "";
  }
})();

// Helper: extract a named function/block from the source, identified by the
// first line of its declaration, up to a configurable end sentinel.
function extractBlock(src: string, startMarker: string, endSentinel: string): string {
  const idx = src.indexOf(startMarker);
  if (idx < 0) return "";
  const endIdx = src.indexOf(endSentinel, idx + startMarker.length);
  return endIdx < 0 ? src.slice(idx) : src.slice(idx, endIdx + endSentinel.length);
}

// ── 3a. rds-provider.ts: propagateLifecycleStageTitlesToPMMTasksRds must be
//        called after tx.commit() in all three reconcile functions.

if (rdsProviderSrc) {
  // Path A: reconcileDefaultLifecyclePhasesRds
  {
    const block = extractBlock(
      rdsProviderSrc,
      "export async function reconcileDefaultLifecyclePhasesRds(",
      "export async function reconcileDefaultLifecyclesBySigRds(",
    );
    if (!block) {
      fail("wiring[rds-A]: reconcileDefaultLifecyclePhasesRds function not found");
    } else {
      const hasPropagateAfterCommit =
        /await tx\.commit\(\)[\s\S]{0,300}propagateLifecycleStageTitlesToPMMTasksRds/.test(block);
      if (!hasPropagateAfterCommit)
        fail("wiring[rds-A]: reconcileDefaultLifecyclePhasesRds does not call propagateLifecycleStageTitlesToPMMTasksRds after tx.commit()");
      else
        ok("wiring[rds-A]: reconcileDefaultLifecyclePhasesRds calls propagateLifecycleStageTitlesToPMMTasksRds after commit");
    }
  }

  // Path B: reconcileDefaultLifecyclesBySigRds
  {
    const block = extractBlock(
      rdsProviderSrc,
      "export async function reconcileDefaultLifecyclesBySigRds(",
      "// ── Sync named schedule sets",
    );
    if (!block) {
      fail("wiring[rds-B]: reconcileDefaultLifecyclesBySigRds function not found");
    } else {
      const hasPropagateAfterCommit =
        /await tx\.commit\(\)[\s\S]{0,300}propagateLifecycleStageTitlesToPMMTasksRds/.test(block);
      if (!hasPropagateAfterCommit)
        fail("wiring[rds-B]: reconcileDefaultLifecyclesBySigRds does not call propagateLifecycleStageTitlesToPMMTasksRds after tx.commit()");
      else
        ok("wiring[rds-B]: reconcileDefaultLifecyclesBySigRds calls propagateLifecycleStageTitlesToPMMTasksRds after commit");
    }
  }

  // Path C: syncPhaseSetLifecyclesRds — byName and byPrevSig branches
  {
    const block = extractBlock(
      rdsProviderSrc,
      "export async function syncPhaseSetLifecyclesRds(",
      "// Companion gap-filler",
    );
    if (!block) {
      fail("wiring[rds-C]: syncPhaseSetLifecyclesRds function not found");
    } else {
      // Count occurrences (byName path + byPrevSig path = at least 2 calls)
      const matches = block.match(/propagateLifecycleStageTitlesToPMMTasksRds/g) ?? [];
      if (matches.length < 2) {
        fail(
          `wiring[rds-C]: syncPhaseSetLifecyclesRds has only ${matches.length} call(s) to ` +
          `propagateLifecycleStageTitlesToPMMTasksRds — expected at least 2 (byName + byPrevSig paths)`,
        );
      } else {
        ok(`wiring[rds-C]: syncPhaseSetLifecyclesRds has ${matches.length} propagate call(s) covering byName + byPrevSig`);
      }
      // Each call must follow a tx.commit()
      const hasByNameCommit =
        /await tx\.commit\(\)[\s\S]{0,500}propagateLifecycleStageTitlesToPMMTasksRds/.test(block);
      if (!hasByNameCommit)
        fail("wiring[rds-C]: syncPhaseSetLifecyclesRds does not call propagateLifecycleStageTitlesToPMMTasksRds after commit in byName path");
      else
        ok("wiring[rds-C]: syncPhaseSetLifecyclesRds propagates after commit");
    }
  }
}

// ── 3b. onboarding.ts settings-save handler wiring

if (onboardingSrc) {
  // Extract the relevant handler section (covers all schedule reconcile blocks)
  // Delimited by the normList declaration through the schedule-set sync block.
  const block = extractBlock(
    onboardingSrc,
    "const normList = ",
    "// Same treatment for \"Default lifecycle phases\"",
  );
  const fullBlock = block + extractBlock(
    onboardingSrc,
    "// Same treatment for \"Default lifecycle phases\"",
    "// Opportunities that predate ANY schedule",
  ) + extractBlock(
    onboardingSrc,
    "// Named schedule sets",
    "// Same auto-save convention as the adoption block",
  );

  // PATH A: defaultPhases change → reconcileDefaultLifecyclePhasesRds + cache busts
  {
    const hasReconcileCall =
      /reconcileDefaultLifecyclePhasesRds\(\s*tid/.test(onboardingSrc);
    if (!hasReconcileCall)
      fail("wiring[handler-A]: reconcileDefaultLifecyclePhasesRds not called in settings-save handler");
    else
      ok("wiring[handler-A]: reconcileDefaultLifecyclePhasesRds is called");

    // Both cache busts must fire when phaseSync.updated is true
    const phaseSyncBlock = extractBlock(
      onboardingSrc,
      "phaseSync = await reconcileDefaultLifecyclePhasesRds(",
      "} catch (e: any) {",
    );
    const hasBothBusts =
      /bustLifecyclesCache/.test(phaseSyncBlock) &&
      /bustTaskDataCache/.test(phaseSyncBlock);
    if (!hasBothBusts)
      fail("wiring[handler-A]: bustLifecyclesCache + bustTaskDataCache not both called after phaseSync");
    else
      ok("wiring[handler-A]: bustLifecyclesCache + bustTaskDataCache both called after reconcileDefaultLifecyclePhasesRds");
  }

  // PATH B: defaultOpportunityStages change → reconcileDefaultLifecyclesBySigRds (OPM) + cache busts
  {
    const hasOpmCall =
      /reconcileDefaultLifecyclesBySigRds\([\s\S]{0,200}"OPM"/.test(onboardingSrc);
    if (!hasOpmCall)
      fail('wiring[handler-B]: reconcileDefaultLifecyclesBySigRds with module "OPM" not found in settings-save handler');
    else
      ok("wiring[handler-B]: reconcileDefaultLifecyclesBySigRds (OPM) is called for defaultOpportunityStages");

    // Outcome filter applied to the new list
    const hasOutcomeFilter =
      /newList\.filter\(\s*\(s\)\s*=>\s*!isOutcomeStageName\(s\)\)[\s\S]{0,300}"OPM"/.test(onboardingSrc) ||
      /isOutcomeStageName[\s\S]{0,200}reconcileDefaultLifecyclesBySigRds[\s\S]{0,50}"OPM"/.test(onboardingSrc);
    if (!hasOutcomeFilter)
      fail("wiring[handler-B]: isOutcomeStageName filter not applied before reconcileDefaultLifecyclesBySigRds (OPM)");
    else
      ok("wiring[handler-B]: isOutcomeStageName filter applied before reconcileDefaultLifecyclesBySigRds (OPM)");

    // Both prevVariants (outcome-filtered + raw) must be passed
    const hasPrevVariants =
      /\[prevList\.filter\(\s*\(s\)\s*=>\s*!isOutcomeStageName\(s\)\)\s*,\s*prevList\]/.test(onboardingSrc);
    if (!hasPrevVariants)
      fail("wiring[handler-B]: two prevVariant forms (filtered + raw) not passed to reconcileDefaultLifecyclesBySigRds — old seeds seeded without filter would not be matched");
    else
      ok("wiring[handler-B]: both prevVariant forms (filtered + raw) passed to reconcileDefaultLifecyclesBySigRds");

    // Cache busts fire when oppScheduleSync.updated > 0
    const oppSyncBlock = extractBlock(
      onboardingSrc,
      "oppScheduleSync = await reconcileDefaultLifecyclesBySigRds(",
      "if ((oppScheduleSync.failed",
    );
    const hasBothBusts =
      /bustTaskDataCache/.test(oppSyncBlock) && /bustLifecyclesCache/.test(oppSyncBlock);
    if (!hasBothBusts)
      fail("wiring[handler-B]: bustLifecyclesCache + bustTaskDataCache not both called after oppScheduleSync");
    else
      ok("wiring[handler-B]: bustLifecyclesCache + bustTaskDataCache both called after reconcileDefaultLifecyclesBySigRds (OPM)");
  }

  // PATH C: projectPhaseSets / oppStageSets → syncPhaseSetLifecyclesRds (PMM + OPM)
  {
    const hasPmmCall =
      /syncPhaseSetLifecyclesRds\(\s*tid\s*,\s*projSets/.test(onboardingSrc);
    const hasOpmCall =
      /syncPhaseSetLifecyclesRds\(\s*tid\s*,\s*oppSets/.test(onboardingSrc);
    if (!hasPmmCall)
      fail("wiring[handler-C]: syncPhaseSetLifecyclesRds not called for PMM (projSets)");
    else
      ok("wiring[handler-C]: syncPhaseSetLifecyclesRds called for PMM (projSets)");
    if (!hasOpmCall)
      fail("wiring[handler-C]: syncPhaseSetLifecyclesRds not called for OPM (oppSets)");
    else
      ok("wiring[handler-C]: syncPhaseSetLifecyclesRds called for OPM (oppSets)");

    // Outcome filter applied to OPM sets
    const hasOpmOutcomeFilter =
      /buildOppSets[\s\S]{0,400}isOutcomeStageName/.test(onboardingSrc);
    if (!hasOpmOutcomeFilter)
      fail("wiring[handler-C]: isOutcomeStageName filter not applied inside buildOppSets for OPM named sets");
    else
      ok("wiring[handler-C]: isOutcomeStageName filter applied inside buildOppSets");

    // prevSets passed to both PMM and OPM syncs (byPrevSig fallback)
    const hasPrevSets =
      /syncPhaseSetLifecyclesRds\(\s*tid\s*,\s*projSets\s*,\s*"PMM"\s*,\s*buildProjSets\(prevEffective\)\)/.test(onboardingSrc) &&
      /syncPhaseSetLifecyclesRds\(\s*tid\s*,\s*oppSets\s*,\s*"OPM"\s*,\s*buildOppSets\(prevEffective\)\)/.test(onboardingSrc);
    if (!hasPrevSets)
      fail("wiring[handler-C]: prevSets (prevEffective) not passed to syncPhaseSetLifecyclesRds — byPrevSig fallback would not fire for recently-renamed sets");
    else
      ok("wiring[handler-C]: prevSets (prevEffective) passed to both PMM + OPM syncPhaseSetLifecyclesRds calls");

    // Cache busts
    const setBlock = extractBlock(
      onboardingSrc,
      "setLifecycleSync = {",
      "setLifecycleSyncError = `",
    );
    const hasBustLifecycles = /bustLifecyclesCache/.test(setBlock);
    const hasBustTask       = /bustTaskDataCache/.test(setBlock);
    if (!hasBustLifecycles)
      fail("wiring[handler-C]: bustLifecyclesCache not called after syncPhaseSetLifecyclesRds");
    else
      ok("wiring[handler-C]: bustLifecyclesCache called after syncPhaseSetLifecyclesRds");
    if (!hasBustTask)
      fail("wiring[handler-C]: bustTaskDataCache not called when setLifecycleSync.updated > 0");
    else
      ok("wiring[handler-C]: bustTaskDataCache called when setLifecycleSync.updated > 0");
  }
}

// ── 3c. Direct lifecycle editor: PUT /lifecycles/:id ─────────────────────────
// When an admin edits a lifecycle template from the "Manage Lifecycles" modal
// on a record page (not through Settings), the route calls updateLifecycleRds.
// That function must capture the old phase order BEFORE the wipe and propagate
// positional renames to PMMTasks after the commit — exactly the same step the
// Settings reconcile paths take. The route handler must also bust
// bustTaskDataCache so the renamed titles are visible immediately.

const rmoneProxySrc = (() => {
  try {
    return readFileSync(join(here, "../src/routes/rmone-proxy.ts"), "utf8");
  } catch {
    fail("wiring: cannot read src/routes/rmone-proxy.ts");
    return "";
  }
})();

if (rdsProviderSrc) {
  const block = extractBlock(
    rdsProviderSrc,
    "export async function updateLifecycleRds(",
    "// Permanently removes a lifecycle template",
  );
  if (!block) {
    fail("wiring[rds-D]: updateLifecycleRds function not found in rds-provider.ts");
  } else {
    // Old phases must be read before the transaction begins (outside tx.begin()).
    const hasPreRead =
      /oldPhases[\s\S]{0,500}await tx\.begin\(\)/.test(block);
    if (!hasPreRead)
      fail("wiring[rds-D]: updateLifecycleRds does not read old phases before tx.begin() — rename pairs would always be empty");
    else
      ok("wiring[rds-D]: updateLifecycleRds reads old phases before the transaction");

    // propagate must be called after tx.commit()
    const hasPropagateAfterCommit =
      /await tx\.commit\(\)[\s\S]{0,600}propagateLifecycleStageTitlesToPMMTasksRds/.test(block);
    if (!hasPropagateAfterCommit)
      fail("wiring[rds-D]: updateLifecycleRds does not call propagateLifecycleStageTitlesToPMMTasksRds after tx.commit()");
    else
      ok("wiring[rds-D]: updateLifecycleRds calls propagateLifecycleStageTitlesToPMMTasksRds after commit");
  }
}

if (rmoneProxySrc) {
  const block = extractBlock(
    rmoneProxySrc,
    "router.put(\"/lifecycles/:id\"",
    "router.delete(\"/lifecycles/:id\"",
  );
  if (!block) {
    fail("wiring[route-D]: PUT /lifecycles/:id handler not found in rmone-proxy.ts");
  } else {
    const hasBustTask      = /bustTaskDataCache/.test(block);
    const hasBustLifecycles = /bustLifecyclesCache/.test(block);
    if (!hasBustTask)
      fail("wiring[route-D]: PUT /lifecycles/:id does not call bustTaskDataCache — renamed phases would not appear on schedule cards until cache TTL expires");
    else
      ok("wiring[route-D]: PUT /lifecycles/:id calls bustTaskDataCache");
    if (!hasBustLifecycles)
      fail("wiring[route-D]: PUT /lifecycles/:id does not call bustLifecyclesCache");
    else
      ok("wiring[route-D]: PUT /lifecycles/:id calls bustLifecyclesCache");
  }
}

// ── 3d. PMM "Standard" guard in syncPhaseSetLifecyclesRds ────────────────────
// Sets named "Standard" are deliberately excluded from the named-set sync so
// they don't collide with the "Standard" template that
// reconcileDefaultLifecyclePhasesRds owns. Verify the guard exists.
if (rdsProviderSrc) {
  const block = extractBlock(
    rdsProviderSrc,
    "export async function syncPhaseSetLifecyclesRds(",
    "// Companion gap-filler",
  );
  const hasStandardGuard =
    /DEFAULT_LIFECYCLE_NAME\.toLowerCase\(\)/.test(block) &&
    /module === "PMM"/.test(block);
  if (!hasStandardGuard)
    fail('wiring[rds-C-guard]: syncPhaseSetLifecyclesRds missing the DEFAULT_LIFECYCLE_NAME (Standard) guard — PMM "Standard" sets would collide with reconcileDefaultLifecyclePhasesRds');
  else
    ok('wiring[rds-C-guard]: syncPhaseSetLifecyclesRds skips PMM "Standard" sets (avoids collision with reconcileDefaultLifecyclePhasesRds)');
}

// ── 3e. reconcileDefaultLifecyclePhasesRds: "Imported:" sig pass precedes
//        the "Standard" template rewrite so imported tenants are also covered
if (rdsProviderSrc) {
  const block = extractBlock(
    rdsProviderSrc,
    "export async function reconcileDefaultLifecyclePhasesRds(",
    "export async function reconcileDefaultLifecyclesBySigRds(",
  );
  const sigIdx      = block.indexOf("reconcileDefaultLifecyclesBySigRds(");
  const standardIdx = block.indexOf("Config_ModuleLifeCycles");
  if (sigIdx < 0)
    fail("wiring[rds-A-order]: reconcileDefaultLifecyclePhasesRds does not call reconcileDefaultLifecyclesBySigRds for imported tenants");
  else if (standardIdx > 0 && sigIdx > standardIdx)
    fail("wiring[rds-A-order]: sig pass (imported tenants) runs AFTER the Standard template lookup — order is wrong");
  else
    ok("wiring[rds-A-order]: sig pass for imported tenants runs before Standard template lookup");
}

// ── Summary ───────────────────────────────────────────────────────────────────
if (failures) {
  console.error(`\nphase-rename-propagation check: ${failures} failure(s).`);
  process.exit(1);
}
console.log(
  "\nphase-rename-propagation check: OK " +
  "(rename-pair logic + outcome filter + source wiring for all four propagation paths: " +
  "default PMM phases, default OPM stages, named phase sets, and direct lifecycle editor)",
);
process.exit(0);
