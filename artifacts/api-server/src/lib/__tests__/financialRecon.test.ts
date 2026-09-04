/**
 * Deterministic validation for financial-analytics.ts reconciliation:
 *   1. rates      — billRate / costRate / NC cost logic
 *   2. NC logic   — NC hours go to nonJobChargeableCost, not assignedBillDollars
 *   3. demand     — open-demand rows (person="") accumulate plannedHours only
 *   4. dedup      — hours-win: pct rows are skipped when hours rows claim the week
 *   5. recon sums — recon totals reconcile to basis totals (within rounding)
 *   6. recon rows — one row per (ticket, person, allocationId, billRate, costRate, NC)
 *   7. allocationId — survives from FinAllocRow through to FinReconRow
 */

import assert from "node:assert/strict";
import { computeFinancialAnalytics, type FinAllocRow } from "../financial-analytics.js";

// Reference date: 2025-06-15 (a Sunday) → t12m starts 2024-06-15
const NOW = new Date("2025-06-15T12:00:00Z");

/** Build a minimal FinAllocRow with defaults. */
function row(patch: Partial<FinAllocRow> & { start: string }): FinAllocRow {
  const startVal = patch.start;
  const endVal = patch.end ?? startVal;
  const base: FinAllocRow = {
    ticket: "T-001",
    person: "user-a",
    allocationId: "",
    allocationStart: startVal,
    allocationEnd: endVal,
    start: startVal,
    end: endVal,
    hours: 0,
    pct: 0,
    nonChargeable: false,
    billRate: 0,
    costRate: 0,
    division: "",
  };
  // Apply patch fields individually to avoid duplicate-key issues with spread.
  return Object.assign(base, patch);
}

// ─── 1. Rates ────────────────────────────────────────────────────────────────
{
  const rows: FinAllocRow[] = [
    row({ ticket: "T-001", person: "u1", allocationId: "ra-1",
          start: "2025-01-06", end: "2025-01-12",
          hours: 40, billRate: 100, costRate: 60 }),
  ];
  const r = computeFinancialAnalytics(rows, 40, NOW);
  const b = r.bases.t12m;
  // 40h billable: 40 × 100 = 4000
  assert.equal(b.assignedBillDollars, 4000, "bill rate applied");
  // 40h job cost: 40 × 60 = 2400
  assert.equal(b.jobChargeableCost, 2400, "cost rate applied");
  assert.equal(b.nonJobChargeableCost, 0, "no NC cost");
  console.log("✓ rates");
}

// ─── 2. NC logic ─────────────────────────────────────────────────────────────
{
  const rows: FinAllocRow[] = [
    row({ ticket: "T-001", person: "u1", allocationId: "ra-1",
          start: "2025-01-06", end: "2025-01-12",
          hours: 40, billRate: 100, costRate: 60, nonChargeable: true }),
  ];
  const r = computeFinancialAnalytics(rows, 40, NOW);
  const b = r.bases.t12m;
  // NC row: must NOT contribute to client billing
  assert.equal(b.assignedBillDollars, 0, "NC row excluded from billing");
  // NC row: must contribute to nonJobChargeableCost
  assert.equal(b.nonJobChargeableCost, 2400, "NC row in nonJobChargeableCost");
  assert.equal(b.jobChargeableCost, 0, "no job cost for NC");
  console.log("✓ NC logic");
}

// ─── 3. Demand (open slots) ───────────────────────────────────────────────────
{
  const rows: FinAllocRow[] = [
    // Open demand: person=""
    row({ ticket: "T-001", person: "", allocationId: "",
          start: "2025-01-06", end: "2025-01-12",
          pct: 100, billRate: 100, costRate: 60 }),
  ];
  const r = computeFinancialAnalytics(rows, 40, NOW);
  const b = r.bases.t12m;
  // Demand hours count as planned
  assert.ok(b.plannedHours > 0, "demand plannedHours > 0");
  // But NOT as assigned billing or cost
  assert.equal(b.assignedHours, 0, "demand: assignedHours = 0");
  assert.equal(b.assignedBillDollars, 0, "demand: no billing");
  assert.equal(b.jobChargeableCost, 0, "demand: no job cost");
  console.log("✓ demand");
}

// ─── 4. Dedup: hours-win ─────────────────────────────────────────────────────
{
  // Both a pct row (multi-week) and an hours row (single week) cover 2025-01-06.
  // The hours row should win; the pct row should be skipped for that week.
  const rows: FinAllocRow[] = [
    // Pct row spanning 4 weeks — would contribute 40h/wk if not suppressed
    row({ ticket: "T-001", person: "u1", allocationId: "",
          start: "2025-01-06", end: "2025-01-26", pct: 100, billRate: 100, costRate: 60 }),
    // Hours row for a single week only
    row({ ticket: "T-001", person: "u1", allocationId: "ra-wk",
          start: "2025-01-06", end: "2025-01-12", hours: 30, billRate: 100, costRate: 60 }),
  ];
  const r = computeFinancialAnalytics(rows, 40, NOW);
  const b = r.bases.t12m;
  // Pct row: 2025-01-06 to 2025-01-26 spans weeks Jan-06, Jan-13, Jan-20 (3 weeks).
  // Hours row owns week Jan-06 (30h). Pct row covers Jan-13 and Jan-20 (2×40=80h).
  // Total: 30 + 80 = 110h.
  assert.ok(Math.abs(b.assignedHours - 110) < 2, `hours-win: expected ~110h, got ${b.assignedHours}`);
  console.log("✓ dedup hours-win");
}

// ─── 5. Recon sums reconcile to basis totals ──────────────────────────────────
{
  const rows: FinAllocRow[] = [
    row({ ticket: "T-001", person: "u1", allocationId: "ra-1",
          start: "2025-01-06", end: "2025-01-12",
          hours: 40, billRate: 100, costRate: 60 }),
    row({ ticket: "T-002", person: "u2", allocationId: "ra-2",
          start: "2025-02-03", end: "2025-02-09",
          hours: 32, billRate: 150, costRate: 80, nonChargeable: true }),
    row({ ticket: "T-001", person: "u3", allocationId: "ra-3",
          start: "2025-03-10", end: "2025-03-16",
          hours: 20, billRate: 0, costRate: 0 }), // unrated
  ];
  const r = computeFinancialAnalytics(rows, 40, NOW);
  for (const k of ["all", "t12m", "fytd", "runrate"] as const) {
    const b = r.bases[k];
    const rc = b.recon;
    // Recon sums must match basis totals (within 2 — rounding in r0/r1)
    assert.ok(Math.abs(rc.sumPlanClientBilling - b.assignedBillDollars) <= 2,
      `${k}: recon billing ${rc.sumPlanClientBilling} ≠ basis ${b.assignedBillDollars}`);
    assert.ok(Math.abs(rc.sumJobCost - b.jobChargeableCost) <= 2,
      `${k}: recon jobCost ${rc.sumJobCost} ≠ basis ${b.jobChargeableCost}`);
    assert.ok(Math.abs(rc.sumNcCost - b.nonJobChargeableCost) <= 2,
      `${k}: recon ncCost ${rc.sumNcCost} ≠ basis ${b.nonJobChargeableCost}`);
    assert.ok(Math.abs(rc.sumTotalInternalCost - (b.jobChargeableCost + b.nonJobChargeableCost)) <= 2,
      `${k}: recon totalCost mismatch`);
  }
  console.log("✓ recon sums reconcile");
}

// ─── 6. Recon row grouping ────────────────────────────────────────────────────
{
  // Two RA rows for the same person/ticket but different allocationIds = two recon rows.
  // Two RA rows with the SAME allocationId but different rates also separate (reconKey encodes rate).
  const rows: FinAllocRow[] = [
    row({ ticket: "T-001", person: "u1", allocationId: "ra-A",
          start: "2025-01-06", end: "2025-01-12", hours: 40, billRate: 100, costRate: 60 }),
    row({ ticket: "T-001", person: "u1", allocationId: "ra-B",
          start: "2025-01-13", end: "2025-01-19", hours: 40, billRate: 120, costRate: 70 }),
    row({ ticket: "T-001", person: "u2", allocationId: "ra-C",
          start: "2025-01-06", end: "2025-01-12", hours: 40, billRate: 100, costRate: 60 }),
  ];
  const r = computeFinancialAnalytics(rows, 40, NOW);
  const rc = r.bases.t12m.recon;
  // Expect 3 distinct recon rows (different allocationIds + different persons)
  assert.equal(rc.rows.length, 3, `expected 3 recon rows, got ${rc.rows.length}`);
  console.log("✓ recon row grouping");
}

// ─── 7b helper: sum the SERIALIZED rows (what the UI displays/sums) ──────────
function sumSerialized(rows: { plannedHours: number; planClientBilling: number; jobCost: number; ncCost: number }[]) {
  const s = { plannedHours: 0, planClientBilling: 0, jobCost: 0, ncCost: 0 };
  for (const r of rows) {
    s.plannedHours += r.plannedHours;
    s.planClientBilling += r.planClientBilling;
    s.jobCost += r.jobCost;
    s.ncCost += r.ncCost;
  }
  return s;
}

// ─── 8. Serialized rows sum EXACTLY to basis headline ────────────────────────
// Rows are quantized to whole dollars/hours with remainder carrying, so the
// VISIBLE values (what fmtCell renders) sum exactly to the headline.
{
  // Fractional rates/hours to force sub-dollar per-row values that would break
  // under per-row rounding.
  const rows: FinAllocRow[] = [];
  for (let i = 0; i < 40; i++) {
    rows.push(row({
      ticket: `T-${String(i % 7).padStart(3, "0")}`,
      person: `u${i}`, allocationId: `ra-${i}`,
      start: "2025-01-06", end: "2025-01-12",
      hours: 7.3, billRate: 99.37, costRate: 61.13,
      nonChargeable: i % 5 === 0,
    }));
  }
  const r = computeFinancialAnalytics(rows, 40, NOW);
  for (const k of ["all", "t12m", "fytd", "runrate"] as const) {
    const b = r.bases[k];
    // Every serialized value must already be a whole unit (display-exact):
    for (const rr of b.recon.rows) {
      for (const f of ["plannedHours", "chargeableHours", "planClientBilling", "jobCost", "ncCost", "totalInternalCost"] as const) {
        assert.ok(Number.isInteger(rr[f]), `${k}: row field ${f}=${rr[f]} not quantized`);
      }
      assert.equal(rr.totalInternalCost, rr.jobCost + rr.ncCost, `${k}: total ≠ job + nc per row`);
    }
    const s = sumSerialized(b.recon.rows);
    assert.equal(s.planClientBilling, b.assignedBillDollars,
      `${k}: displayed billing total ${s.planClientBilling} ≠ headline ${b.assignedBillDollars}`);
    assert.equal(s.jobCost, b.jobChargeableCost,
      `${k}: displayed job cost total ${s.jobCost} ≠ headline ${b.jobChargeableCost}`);
    assert.equal(s.ncCost, b.nonJobChargeableCost,
      `${k}: displayed NC cost total ${s.ncCost} ≠ headline ${b.nonJobChargeableCost}`);
    assert.ok(Math.abs(s.plannedHours - b.plannedHours) <= 0.5,
      `${k}: displayed hours total ${s.plannedHours} ≠ headline ${b.plannedHours}`);
  }
  console.log("✓ serialized rows sum exactly to headline");
}

// ─── 9. Truncation: aggregate remainder row keeps the table summing ──────────
{
  // More allocation groups than MAX_RECON_ROWS (5000): expect ONE trailing
  // aggregate row carrying the omitted remainder so rows still sum to headline.
  const rows: FinAllocRow[] = [];
  const GROUPS = 5040;
  for (let i = 0; i < GROUPS; i++) {
    rows.push(row({
      ticket: `T-${String(i % 97).padStart(3, "0")}`,
      person: `u${i}`, allocationId: `ra-${i}`,
      start: "2025-01-06", end: "2025-01-12",
      hours: 2.7, billRate: 103.19, costRate: 58.61,
    }));
  }
  const r = computeFinancialAnalytics(rows, 40, NOW);
  const b = r.bases.t12m;
  const rc = b.recon;
  assert.equal(rc.rowsTruncated, GROUPS - 5000, `rowsTruncated should be ${GROUPS - 5000}`);
  const agg = rc.rows[rc.rows.length - 1];
  assert.equal(agg.aggregateOf, GROUPS - 5000, "trailing aggregate row present with aggregateOf");
  assert.equal(rc.rows.filter(x => x.aggregateOf).length, 1, "exactly one aggregate row");
  const s = sumSerialized(rc.rows);
  assert.equal(s.planClientBilling, b.assignedBillDollars,
    `truncated: billing total ${s.planClientBilling} ≠ headline ${b.assignedBillDollars}`);
  assert.equal(s.jobCost, b.jobChargeableCost, "truncated: job cost total ≠ headline");
  assert.ok(Math.abs(s.plannedHours - b.plannedHours) <= 0.5, "truncated: hours total ≠ headline");
  console.log("✓ truncation aggregate row reconciles");
}

// ─── 7. allocationId propagation ─────────────────────────────────────────────
{
  const rows: FinAllocRow[] = [
    row({ ticket: "T-001", person: "u1", allocationId: "ra-IDENTITY-42",
          allocationStart: "2025-01-06", allocationEnd: "2025-01-12",
          start: "2025-01-06", end: "2025-01-12",
          hours: 40, billRate: 100, costRate: 60 }),
  ];
  const r = computeFinancialAnalytics(rows, 40, NOW);
  const rc = r.bases.t12m.recon;
  assert.equal(rc.rows.length, 1);
  assert.equal(rc.rows[0].allocationId, "ra-IDENTITY-42", "allocationId preserved");
  assert.equal(rc.rows[0].allocationStart, "2025-01-06", "allocationStart preserved");
  assert.equal(rc.rows[0].allocationEnd, "2025-01-12", "allocationEnd preserved");
  console.log("✓ allocationId propagation");
}

// ─── 10. Monthly chart drill rows are exact project evidence ─────────────────
{
  // Multiple projects with fractional hours/rates exercise the visible
  // remainder-carrying quantization used by a clicked month chart point.
  const rows: FinAllocRow[] = [
    row({ ticket: "T-MONTH-A", person: "u1", allocationId: "ma",
      start: "2025-01-06", end: "2025-01-12", hours: 17.4, billRate: 101.25, costRate: 60.5 }),
    row({ ticket: "T-MONTH-B", person: "u2", allocationId: "mb",
      start: "2025-01-13", end: "2025-01-19", hours: 11.6, billRate: 89.75, costRate: 45.25, nonChargeable: true }),
    row({ ticket: "T-MONTH-C", person: "", allocationId: "",
      start: "2025-01-20", end: "2025-01-26", pct: 50, billRate: 120, costRate: 70 }),
  ];
  const b = computeFinancialAnalytics(rows, 40, NOW).bases.all;
  const month = b.monthly.find(m => m.ym === "2025-01");
  const details = (b.monthlyByProject ?? []).filter(r => r.ym === "2025-01");
  assert.ok(month, "January month chart point exists");
  assert.equal(details.length, 3, "one project evidence row per January project/demand");
  for (const r of details) {
    for (const f of ["plannedHours", "assignedHours", "billDollars", "jobCost", "nonJobCost", "totalInternalCost"] as const) {
      assert.ok(Number.isInteger(r[f]), `month drill ${f} is display-quantized`);
    }
    assert.equal(r.totalInternalCost, r.jobCost + r.nonJobCost, "month drill cost invariant");
  }
  assert.equal(details.reduce((s, r) => s + r.plannedHours, 0), Math.round(month!.plannedHours),
    "visible month project hours sum to visible chart point");
  assert.equal(details.reduce((s, r) => s + r.billDollars, 0), month!.billDollars,
    "visible month project billing sums to chart point");
  assert.equal(details.reduce((s, r) => s + r.totalInternalCost, 0), month!.costDollars,
    "visible month project cost sums to chart point");
  console.log("✓ monthly project drill reconciles");
}

// ─── 11. Monthly project cap retains an explicit remainder ───────────────────
{
  const rows: FinAllocRow[] = [];
  for (let i = 0; i < 502; i++) {
    rows.push(row({
      ticket: `T-CAP-${i}`, person: `u${i}`, allocationId: `cap-${i}`,
      start: "2025-02-03", end: "2025-02-09", hours: 1, billRate: 100, costRate: 50,
    }));
  }
  const b = computeFinancialAnalytics(rows, 40, NOW).bases.all;
  const details = (b.monthlyByProject ?? []).filter(r => r.ym === "2025-02");
  const aggregate = details.find(r => r.aggregateOf);
  assert.equal(details.length, 501, "500 project rows plus a final aggregate line");
  assert.equal(aggregate?.aggregateOf, 2, "aggregate line states exactly how many projects it represents");
  const month = b.monthly.find(m => m.ym === "2025-02")!;
  assert.equal(details.reduce((s, r) => s + r.billDollars, 0), month.billDollars,
    "capped month project billing remains exact");
  console.log("✓ monthly project cap retains aggregate");
}

// ─── 12. Org-unit project drills use exact allocation contributions ──────────
{
  // The same project is deliberately staffed by two departments. Its rows
  // must be split by the allocation org — not repeated in full under each
  // record-level department label.
  const rows: FinAllocRow[] = [
    row({ ticket: "T-SHARED", person: "u-civil", allocationId: "civil-a",
      start: "2025-01-06", end: "2025-01-12", hours: 17.4, billRate: 101.25, costRate: 60.5,
      division: "Civil", businessUnit: "Delivery", department: "Structures" }),
    row({ ticket: "T-SHARED", person: "u-rail", allocationId: "rail-a",
      start: "2025-01-06", end: "2025-01-12", hours: 11.6, billRate: 89.75, costRate: 45.25,
      division: "Rail", businessUnit: "Delivery", department: "Signals" }),
    row({ ticket: "T-OTHER", person: "u-civil", allocationId: "civil-b",
      start: "2025-01-13", end: "2025-01-19", hours: 8.8, billRate: 99.5, costRate: 55.5,
      division: "Civil", businessUnit: "Delivery", department: "Structures" }),
  ];
  const b = computeFinancialAnalytics(rows, 40, NOW).bases.all;
  // Each source key is unique in this fixture, so the explicit named parent
  // verifies the allocation-derived child split rather than record metadata.
  const civil = b.byDivision.find(r => r.division === "Civil")!;
  const delivery = b.byBusinessUnit.find(r => r.bu === "Delivery")!;
  const structures = b.byDepartment.find(r => r.department === "Structures")!;
  const civilGroup = b.byDivisionByProject.find(g => g.org === "Civil")!;
  const deliveryGroup = b.byBusinessUnitByProject.find(g => g.org === "Delivery")!;
  const structuresGroup = b.byDepartmentByProject.find(g => g.org === "Structures")!;
  for (const [name, group, parent] of [
    ["Civil", civilGroup, civil],
    ["Delivery", deliveryGroup, delivery],
    ["Structures", structuresGroup, structures],
  ] as const) {
    for (const field of ["plannedHours", "assignedHours", "billDollars"] as const) {
      assert.ok(group.rows.every(r => Number.isInteger(r[field])), `${name}: ${field} is display-quantized`);
      assert.equal(group.rows.reduce((sum, r) => sum + r[field], 0), parent[field],
        `${name}: listed project ${field} exactly matches parent`);
    }
  }
  assert.equal(structuresGroup.rows.find(r => r.ticket === "T-SHARED")?.plannedHours, 17,
    "shared project retains only Structures allocation in Structures drill");
  assert.equal(b.byDepartmentByProject.find(g => g.org === "Signals")?.rows.find(r => r.ticket === "T-SHARED")?.plannedHours, 12,
    "shared project retains only Signals allocation in Signals drill");
  console.log("✓ org project drills reconcile exactly");
}

// ─── 13. Org-unit project cap keeps an explicit aggregate remainder ──────────
{
  const rows: FinAllocRow[] = [];
  for (let i = 0; i < 102; i++) {
    rows.push(row({
      ticket: `T-ORG-CAP-${i}`, person: `u${i}`, allocationId: `org-cap-${i}`,
      start: "2025-02-03", end: "2025-02-09", hours: 1, billRate: 100, costRate: 50,
      division: "Civil", businessUnit: "Delivery", department: "Structures",
    }));
  }
  const b = computeFinancialAnalytics(rows, 40, NOW).bases.all;
  const group = b.byBusinessUnitByProject.find(g => g.org === "Delivery")!;
  const parent = b.byBusinessUnit.find(r => r.bu === "Delivery")!;
  assert.equal(group.rows.length, 101, "100 project rows plus a final org aggregate line");
  assert.equal(group.rowsTruncated, 2, "org drill reports two omitted projects");
  assert.equal(group.rows[group.rows.length - 1]?.aggregateOf, 2, "org aggregate line states the omitted count");
  assert.equal(group.rows.reduce((sum, r) => sum + r.plannedHours, 0), parent.plannedHours,
    "capped org project hours remain exact");
  assert.equal(group.rows.reduce((sum, r) => sum + r.billDollars, 0), parent.billDollars,
    "capped org project billing remains exact");
  console.log("✓ org project cap retains aggregate");
}

console.log("\nAll financial reconciliation tests passed.");
