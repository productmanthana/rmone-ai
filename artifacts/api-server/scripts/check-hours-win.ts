/**
 * Hours-win rule regression harness (CI gate).
 * Run: pnpm --filter @workspace/api-server run check:hours-win
 *
 * Guards the Aug 2026 fix for the "%-plan + real hours" double-count: a
 * %-only assignment writes one long-span container row (pct=X, hr=null);
 * when weekly hours are later saved for the SAME project, both used to count
 * in that week's utilization (50% plan + 20h real week read 144% "Over"
 * instead of 94%). The rule: when a project has a real-hours entry covering
 * a week, percent-only entries for that project in that week are the plan
 * those hours replaced — skip them from SUMS for that week only.
 *
 * The two server code paths live inline in src/lib/rds-provider.ts (a module
 * whose import graph pulls in the DB pool), so — following the established
 * harness pattern (see check-title-reroute-web.ts) — this script extracts the
 * REAL source slices into a temp module and drives fixtures against them:
 *   1. getAllocationUtilizationRds week loop (per-week hourPids set)
 *   2. _getResourceAllocationsImpl currentPct post-pass (today snapshot)
 * The web twin `hoursWinFilter` (rmone-web/src/lib/utilGrid.ts) is pure and
 * imported directly. Keep all three in lockstep.
 *
 * Exit code 0 = all good; 1 = extraction drift or a fixture failure.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hoursWinFilter, allocEntryHrsPerWeek } from "../../rmone-web/src/lib/utilGrid.js";

const here = dirname(fileURLToPath(import.meta.url));
const providerPath = join(here, "../src/lib/rds-provider.ts");
const src = readFileSync(providerPath, "utf8");

// ── Extraction ──────────────────────────────────────────────────────────────
// Slices are anchored on stable declarations/comments. If one goes missing the
// script fails loudly ("extraction drift") rather than silently testing nothing.
function sliceBetween(startRe: RegExp, endRe: RegExp, label: string): string {
  const s = src.search(startRe);
  if (s < 0) throw new Error(`extraction drift: start marker not found for ${label} (${startRe})`);
  const rest = src.slice(s);
  const e = rest.search(endRe);
  if (e < 0) throw new Error(`extraction drift: end marker not found for ${label} (${endRe})`);
  const m = rest.slice(e).match(endRe)!;
  return rest.slice(0, e + m[0].length);
}

// 1. Week-loop body from getAllocationUtilizationRds: everything from the pct
//    accumulator through the alloc loop that applies the hours-win skip.
const weekLoopBody = sliceBetween(
  /let pct = 0, totalHrs = 0;/,
  /\n\s*const projEntries =/,
  "week-loop hours-win block",
).replace(/\n\s*const projEntries =\s*$/, "");
if (!/hourPids/.test(weekLoopBody) || !/hourPids\.has\(a\.pid\)\) continue;/.test(weekLoopBody)) {
  throw new Error("extraction drift: week-loop slice no longer contains the hours-win skip");
}

// 2. currentPct post-pass from _getResourceAllocationsImpl (today snapshot).
const postPassBody = sliceBetween(
  /for \(const p of byId\.values\(\)\) \{\s*\n\s*if \(p\.activeAllocations\.length < 2\) continue;/,
  /if \(p\.currentPct < 0\) p\.currentPct = 0;\s*\n\s*\}/,
  "currentPct post-pass",
);
if (!/hourPids\.has\(a\.projectId\)\) p\.currentPct -= a\.pct;/.test(postPassBody)) {
  throw new Error("extraction drift: currentPct post-pass no longer subtracts the %-plan");
}

// 3. utilCell (pct → H derivation) — must honour the tenant work-week basis
//    in lockstep with the web's allocEntryHrsPerWeek.
const utilCellBody = sliceBetween(
  /function utilCell\(pct: number, projCount: number, stdWeekHours: number/,
  /\n\}/,
  "utilCell",
);
if (!/stdWeekHours/.test(utilCellBody.split("\n")[1] + utilCellBody)) {
  throw new Error("extraction drift: utilCell no longer parameterised by stdWeekHours");
}

const tmp = mkdtempSync(join(tmpdir(), "hours-win-"));
const modPath = join(tmp, "extracted.ts");
writeFileSync(modPath, `
type Alloc = { s: number; e: number; pct: number; pid: string; hrs: number };
export function weekSum(allocs: Alloc[], w: { s: number; e: number }) {
  ${weekLoopBody}
  return { pct, totalHrs, projMap };
}
type Person = { activeAllocations: { projectId: string; pct: number; hours?: number }[]; currentPct: number };
export function currentPctPass(byId: Map<string, Person>) {
  ${postPassBody}
}
export ${utilCellBody}
`);
const { weekSum, currentPctPass, utilCell } = await import(pathToFileURL(modPath).href) as {
  utilCell: (pct: number, projCount: number, stdWeekHours: number, actualHrs?: number) => string;
  weekSum: (allocs: { s: number; e: number; pct: number; pid: string; hrs: number }[], w: { s: number; e: number }) => { pct: number; totalHrs: number; projMap: Map<string, number> };
  currentPctPass: (byId: Map<string, { activeAllocations: { projectId: string; pct: number; hours?: number }[]; currentPct: number }>) => void;
};

// ── Harness ─────────────────────────────────────────────────────────────────
let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual ?? null), e = JSON.stringify(expected ?? null);
  if (a === e) { console.log(`  OK   ${name}`); return; }
  failures++;
  console.error(`  FAIL ${name}\n       expected ${e}\n       got      ${a}`);
}

// Week windows (Monday-aligned, ms). Week A = Aug 3–9 2026, week B = Aug 10–16.
const DAY = 86_400_000;
const wA = { s: Date.UTC(2026, 7, 3), e: Date.UTC(2026, 7, 9) + DAY - 1 };
const wB = { s: Date.UTC(2026, 7, 10), e: Date.UTC(2026, 7, 16) + DAY - 1 };
// The container plan span covers BOTH weeks; the hours row covers week A only.
const plan50 = { s: wA.s, e: wB.e, pct: 50, pid: "PMM-1", hrs: 0 };      // %-only container
const hours20A = { s: wA.s, e: wA.e, pct: 94, pid: "PMM-1", hrs: 20 };   // real 20h week (pct hours-derived)
const otherProj = { s: wA.s, e: wA.e, pct: 50, pid: "PMM-2", hrs: 0 };   // %-only, different project
const noPid = { s: wA.s, e: wA.e, pct: 25, pid: "", hrs: 0 };            // no projectId

console.log("check-hours-win: getAllocationUtilizationRds week loop");

// 1. Same project, hours week: the %-plan is skipped → 94, not 144.
check("same project, hours week → pct-only skipped (94 not 144)",
  weekSum([plan50, hours20A], wA).pct, 94);
// Hours totals were never doubled — the hour row's hours still count once.
check("same project, hours week → hours counted once",
  weekSum([plan50, hours20A], wA).totalHrs, 20);

// 2. Same project, DIFFERENT week: the plan still counts (legacy %-schedules).
check("same project, week hours don't cover → plan counts",
  weekSum([plan50, hours20A], wB).pct, 50);

// 3. Different project, same week: %-only entry still counts.
check("different project, same week → pct-only counts",
  weekSum([plan50, hours20A, otherProj], wA).pct, 144);

// 4. hrs=0 entries never trigger suppression (only rows with hrs>0 populate hourPids).
check("all entries hrs=0 → nothing suppressed",
  weekSum([plan50, otherProj], wA).pct, 100);

// 5. Entries with no projectId are preserved even when hours exist.
check("no projectId → preserved",
  weekSum([plan50, hours20A, noPid], wA).pct, 119);

// 6. An hour row WITHOUT a projectId must not suppress anything.
check("hour row without pid → no suppression",
  weekSum([plan50, { ...hours20A, pid: "" }], wA).pct, 144);

console.log("\ncheck-hours-win: _getResourceAllocationsImpl currentPct post-pass");

function runPass(currentPct: number, allocs: { projectId: string; pct: number; hours?: number }[]): number {
  const p = { activeAllocations: allocs, currentPct };
  currentPctPass(new Map([["u1", p]]));
  return p.currentPct;
}
const aPlan = { projectId: "PMM-1", pct: 50, hours: undefined as number | undefined };
const aHrs = { projectId: "PMM-1", pct: 94, hours: 20 };

// 7. Today snapshot subtracts the plan once → 144 becomes 94.
check("post-pass subtracts plan once (144 → 94)", runPass(144, [aPlan, aHrs]), 94);

// 8. Two hour entries for the same project still subtract the plan ONCE.
check("two hour rows, one plan → subtract once",
  runPass(194, [aPlan, aHrs, { projectId: "PMM-1", pct: 50, hours: 10 }]), 144);

// 9. Floors at 0 (never negative).
check("floors at 0", runPass(30, [aPlan, aHrs]), 0);

// 10. hours=0 / undefined entries never populate hourPids → nothing subtracted.
check("no real-hours entries → untouched",
  runPass(100, [aPlan, { projectId: "PMM-1", pct: 50, hours: 0 }]), 100);

// 11. Different project's hours don't suppress this project's plan.
check("hours on different project → plan kept",
  runPass(144, [aPlan, { projectId: "PMM-2", pct: 94, hours: 20 }]), 144);

// 12. Single-entry people are skipped (guard clause).
check("single active allocation → untouched", runPass(94, [aHrs]), 94);

console.log("\ncheck-hours-win: web hoursWinFilter (lib/utilGrid.ts)");

type E = { id: string; projectId?: string; hours?: number };
const ids = (es: E[]) => es.map(e => e.id);
const wPlan: E = { id: "plan", projectId: "PMM-1", hours: undefined };
const wHrs: E = { id: "hrs", projectId: "PMM-1", hours: 20 };
const wOther: E = { id: "other", projectId: "PMM-2" };
const wNoPid: E = { id: "nopid", hours: 0 };

// 13. Same project, same window: pct-only dropped.
check("hoursWinFilter drops same-project pct-only", ids(hoursWinFilter([wPlan, wHrs])), ["hrs"]);
// 14. No hour entries: everything preserved (weeks without hours keep the plan).
check("hoursWinFilter no hours → untouched", ids(hoursWinFilter([wPlan, wOther, wNoPid])), ["plan", "other", "nopid"]);
// 15. Different project + no-projectId entries preserved alongside hours.
check("hoursWinFilter keeps other project + no-pid", ids(hoursWinFilter([wPlan, wHrs, wOther, wNoPid])), ["hrs", "other", "nopid"]);
// 16. hours=0 entry for the hour project is a pct-only shape → dropped; hours=null too.
check("hoursWinFilter hrs=0 same project dropped", ids(hoursWinFilter([{ id: "z", projectId: "PMM-1", hours: 0 }, wHrs])), ["hrs"]);
// 17. An hour entry without projectId suppresses nothing.
check("hoursWinFilter hour row without pid → no suppression",
  ids(hoursWinFilter([wPlan, { id: "h2", hours: 20 }])), ["plan", "h2"]);

console.log("\ncheck-hours-win: non-40h work-week lockstep (server utilCell H vs web allocEntryHrsPerWeek)");

const hOf = (cell: string) => parseFloat((cell.split("#").find(p => p.startsWith("H:")) ?? "H:0").slice(2));
// 18. 100% plan on a 55h tenant renders 55h on both sides (the task's bug: was 40h).
check("server H: 100% of 55h week → 55", hOf(utilCell(100, 1, 55)), 55);
check("web hrs: 100% of 55h week → 55", allocEntryHrsPerWeek({ pct: 100 } as never, 55), 55);
// 19. 50% plan on a 30h tenant → 15 on both sides.
check("server H: 50% of 30h week → 15", hOf(utilCell(50, 1, 30)), 15);
check("web hrs: 50% of 30h week → 15", allocEntryHrsPerWeek({ pct: 50 } as never, 30), 15);
// 20. Real hours always win over the pct derivation, regardless of basis.
check("server H: real hours win over pct", hOf(utilCell(100, 1, 55, 20)), 20);
check("web hrs: real hours win over pct", allocEntryHrsPerWeek({ pct: 100, hours: 20 } as never, 55), 20);
// 21. Fractional results share one rounding contract (one decimal, identical
//     expression) — 33% of 55h = 18.2 on BOTH sides, never 18 vs 18.2.
check("server H: 33% of 55h week → 18.2", hOf(utilCell(33, 1, 55)), 18.2);
check("web hrs: 33% of 55h week → 18.2", allocEntryHrsPerWeek({ pct: 33 } as never, 55), 18.2);
// 22. Non-integral pct on a 30h week → 3.8 on both sides (12.5% → 3.75 → 3.8).
check("server H: 12.5% of 30h week → 3.8", hOf(utilCell(12.5, 1, 30)), 3.8);
check("web hrs: 12.5% of 30h week → 3.8", allocEntryHrsPerWeek({ pct: 12.5 } as never, 30), 3.8);
// 23. Non-positive basis falls back to 40 on the web (server callers guard with || 40).
check("web hrs: basis 0 → 40h fallback", allocEntryHrsPerWeek({ pct: 100 } as never, 0), 40);

if (failures) {
  console.error(`\ncheck-hours-win: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-hours-win: all fixtures passed");
