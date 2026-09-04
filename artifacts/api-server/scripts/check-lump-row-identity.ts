/**
 * Guard for the Edit Assignment "Total Hours" save path (task #672).
 *
 * Bug class: lump/container rows used to be recognized by span length alone
 * (> 30 days), so on a short assignment (≤ 30 days — even a single day) every
 * total-hours save missed its own previous lump row and INSERTED a fresh one;
 * stale rows survived inside the date window and hours stacked (15h+35h+62h
 * all counted at once).
 *
 * Contract enforced here (source assertions on assignResourceRds):
 *  1. The assignment's PREVIOUS window is captured BEFORE Step 1 rewrites the
 *     RWI dates — matching a row against the assignment's own window is the
 *     only reliable lump identity on short assignments. Capture form: the
 *     locked audit pre-image (readAssignmentAuditState() executing
 *     assignmentAuditRwiSql) is read first and fails loudly if the row is
 *     gone; oldRwiStart/oldRwiEnd derive from that pre-image, so the audit
 *     trail and lump identity can never diverge.
 *  2. Step 1's container date-update also matches the previous-span lump row
 *     (@pstart/@pend), so dates-only edits on short assignments don't strand it.
 *  3. Step 1b delegates lump selection to the pure classifyLumpRows
 *     (src/lib/lump-hours.ts): exactly one row receives the total, stale lump
 *     rows are zeroed, and the insert fallback only fires when NO candidate
 *     exists (plan.insert). Behavioral fixtures for that live in
 *     scripts/check-lump-hours.ts (same check:hours-win chain).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../src/lib/rds-provider.ts"), "utf8");

let failed = 0;
const assert = (name: string, ok: boolean) => {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
};

// 1. Previous span is captured BEFORE Step 1 rewrites the RWI dates.
//    Capture form (audit unification + deadlock-guard rev): the locked audit
//    pre-image SQL (assignmentAuditRwiSql — SELECT … FROM ResourceWorkItems)
//    is executed by readAssignmentAuditState(), whose first call yields
//    beforeRow; a missing row throws instead of silently matching zero rows,
//    and oldRwiStart/oldRwiEnd derive from beforeRow. (The pre-rename inline
//    beforeSnap form is tolerated so the gate stays green on trees from
//    either side of that refactor.)
const auditSqlIdx = src.search(/assignmentAudit(?:Rwi)?Sql[\s\S]{0,1500}FROM core2\.dbo\.ResourceWorkItems rwi/);
const auditQueryIdx = src.search(/\.query\(assignmentAudit(?:Rwi)?Sql\)/);
const snapIdx = src.search(/const beforeRow = await readAssignmentAuditState\(\)|const beforeSnap = await new sql\.Request\(tx\)[\s\S]{0,300}\.query\(assignmentAuditSql\)/);
const deriveIdx = src.search(/const oldRwiStart[^\n]*beforeRow\.StartDate[\s\S]{0,200}const oldRwiEnd[^\n]*beforeRow\.EndDate/);
const step1Idx = src.indexOf("── Step 1: update RWI + container RA rows");
assert("audit pre-image SQL reads ResourceWorkItems (assignmentAuditRwiSql)",
  auditSqlIdx >= 0 && auditQueryIdx >= 0);
assert("beforeRow acquired from the pre-image reader (readAssignmentAuditState)",
  snapIdx >= 0);
assert("missing pre-image fails loudly (no silent zero-row UPDATE)",
  /if \(!beforeRow\) \{[\s\S]{0,400}throw new Error/.test(src));
assert("previous RWI span derives from the pre-image (beforeRow.StartDate/EndDate)", deriveIdx >= 0);
assert("…and captured BEFORE Step 1 rewrites the RWI dates",
  snapIdx >= 0 && deriveIdx >= 0 && step1Idx > snapIdx && step1Idx > deriveIdx);

// 2. Step 1 date-update coverage for short-span lump rows.
assert("container date-update also matches the previous-span lump row (@pstart/@pend)",
  /AllocationHour > 0[\s\S]{0,600}AllocationStartDate = @pstart AND AllocationEndDate = @pend/.test(src));
assert("long-span (>30 day) lumps still date-updated",
  /DATEDIFF\(day, AllocationStartDate, AllocationEndDate\) > 30\s*\n\s*OR \(AllocationStartDate = @pstart/.test(src));

// 3. Step 1b lump selection is delegated to the pure, fixture-tested module.
const step1bIdx = src.indexOf("Step 1b: persist edited total hours");
const step1b = step1bIdx >= 0 ? src.slice(step1bIdx, src.indexOf("── Step 2:", step1bIdx)) : "";
assert("Step 1b present", step1bIdx >= 0);
assert("Step 1b delegates to classifyLumpRows (lib/lump-hours.ts)",
  step1b.includes("classifyLumpRows("));
assert("old and new windows both feed the classifier",
  /oldStart: oldRwiStart, oldEnd: oldRwiEnd, newStart: start, newEnd: end/.test(step1b));
assert("exactly one row receives the total (plan.updateId targeted UPDATE)",
  /plan\.updateId[\s\S]{0,1500}WHERE\s+ID = @id AND TenantID = @tid/.test(step1b));
assert("stale stacked lump rows are cleared (plan.zeroIds)",
  step1b.includes("plan.zeroIds"));
assert("insert fallback only fires when NO candidate matched (plan.insert)",
  /if \(plan\.insert\)/.test(step1b));

if (failed > 0) {
  console.error(`\n${failed} lump-row identity assertion(s) FAILED — total-hours saves may stack duplicate rows again.`);
  process.exit(1);
}
console.log("\nAll lump-row identity assertions passed.");
