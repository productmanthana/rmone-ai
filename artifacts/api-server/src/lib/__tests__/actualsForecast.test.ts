/**
 * Actuals vs Forecast engine (actuals-forecast.ts) — deterministic tests.
 *   1. EAC identity  — COO example: 2 actual + 86 remaining = 88 (converges)
 *   2. convergence   — remaining hits 0 at plan end; EAC = actual TD
 *   3. variance sign — forecast TD − actual TD; POSITIVE = favorable
 *   4. imported-only — missing actuals count 0; never substituted by default
 *   5. substitution  — only when !useImportedActuals && fallback; completed
 *                      weeks only; imported rows win; demand never substitutes
 *   6. rate ladder   — exact assignment → single-role → week-hours tiebreak →
 *                      catalogue → unrated (counted, $0, flagged)
 *   7. Monday snap   — mid-week actual dates land in the UTC-Monday bucket
 *   8. demand rows   — unstaffed planned work still counts as forecast
 */
import assert from "node:assert/strict";
import {
  aggregateActualKeyRows, buildTicketPlans, computeProjectAf, normalizeRoleRates,
  type AfActualRow, type AfFlags,
} from "../actuals-forecast.js";
import { type FinAllocRow } from "../financial-analytics.js";

const DAY = 86_400_000;
const W1 = Date.UTC(2026, 7, 3);   // Mon 2026-08-03
const W2 = Date.UTC(2026, 7, 10);  // Mon 2026-08-10
const W3 = Date.UTC(2026, 7, 17);  // Mon 2026-08-17
const W4 = Date.UTC(2026, 7, 24);  // Mon 2026-08-24
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const IMPORTED_ONLY: AfFlags = { useImportedActuals: true, usePlannedAsActualFallback: false };
const SUBSTITUTE: AfFlags = { useImportedActuals: false, usePlannedAsActualFallback: true };

/** Minimal FinAllocRow: a one-week assignment slice (Mon..Sun, hours-win). */
function planRow(patch: Partial<FinAllocRow> & { start: string }): FinAllocRow {
  const startVal = patch.start;
  const endVal = patch.end ?? iso(Date.parse(startVal) + 6 * DAY);
  const base: FinAllocRow = {
    ticket: "PMM-01",
    person: "User-A",           // mixed case on purpose — engine lowercases
    allocationId: "",
    allocationStart: startVal,
    allocationEnd: endVal,
    start: startVal,
    end: endVal,
    hours: 0,
    pct: 0,
    nonChargeable: false,
    billRate: 100,
    costRate: 50,
    division: "Bridges",
    roleName: "PM",
  };
  return Object.assign(base, patch);
}

/** The COO's 88-hour project: W1=2h, W2=30h, W3=28h, W4=28h. */
function standardPlan() {
  const rows: FinAllocRow[] = [
    planRow({ start: iso(W1), hours: 2 }),
    planRow({ start: iso(W2), hours: 30 }),
    planRow({ start: iso(W3), hours: 28 }),
    planRow({ start: iso(W4), hours: 28 }),
  ];
  return buildTicketPlans(rows, 40).get("PMM-01");
}

function actual(patch: Partial<AfActualRow>): AfActualRow {
  return Object.assign({
    ticket: "PMM-01", person: "USER-A", personName: "Alice",
    weekMs: W1, hours: 0, roleName: "PM", division: "",
  }, patch);
}

const wk = (s: ReturnType<typeof computeProjectAf>, ms: number) => {
  const p = s.weeks.find(x => x.weekMonday === iso(ms));
  assert.ok(p, `missing week point ${iso(ms)}`);
  return p!;
};

// ─── 1+2+3. EAC identity, convergence, variance sign, Monday snap ───────────
{
  const plan = standardPlan();
  assert.ok(plan, "plan built");
  assert.equal(plan!.totals.hours, 88);
  assert.equal(plan!.totals.cost, 88 * 50);
  assert.equal(plan!.totals.bill, 88 * 100);

  // 2h imported on WEDNESDAY of W1 → must snap into the W1 Monday bucket.
  const s = computeProjectAf({
    ticket: "PMM-01", plan,
    actuals: [actual({ weekMs: W1 + 2 * DAY, hours: 2 })],
    flags: IMPORTED_ONLY, currentWeekMs: W2,
  });
  assert.equal(s.weeks.length, 4);
  assert.equal(s.weeks[0]!.weekMonday, iso(W1));
  assert.deepEqual(s.planTotals, { hours: 88, cost: 4400, bill: 8800 });
  assert.ok(s.divisions.includes("Bridges"));

  const w1 = wk(s, W1);
  assert.equal(w1.actualHoursTd, 2);
  assert.equal(w1.forecastHoursTd, 2);           // plan TD
  assert.equal(w1.forecastRemainingHours, 86);   // 88 − 2 planned so far
  assert.equal(w1.forecastTotalHours, 88);       // EAC: 2 actual + 86 remaining
  assert.equal(w1.hoursVariance, 0);             // on plan
  assert.equal(w1.actualCostTd, 2 * 50);         // exact assignment rate
  assert.equal(w1.forecastTotalCost, 4400);
  assert.equal(w1.unratedActualHours, 0);
  assert.equal(w1.substitutedHours, 0);

  // Plan end: remaining exhausted, EAC = actual TD (blue meets green).
  const w4 = wk(s, W4);
  assert.equal(w4.forecastRemainingHours, 0);
  assert.equal(w4.forecastTotalHours, 2);
  assert.equal(w4.forecastHoursTd, 88);
  assert.equal(w4.hoursVariance, 86);            // way under plan = positive

  // Over plan: 4 actual vs 2 planned → NEGATIVE (unfavorable) variance.
  const over = computeProjectAf({
    ticket: "PMM-01", plan,
    actuals: [actual({ hours: 4 })],
    flags: IMPORTED_ONLY, currentWeekMs: W2,
  });
  const ow1 = wk(over, W1);
  assert.equal(ow1.hoursVariance, -2);
  assert.equal(ow1.forecastTotalHours, 90);      // EAC grows when over plan
}

// ─── 4. Imported-only: missing actuals are honest zeros ─────────────────────
{
  const plan = standardPlan();
  const s = computeProjectAf({
    ticket: "PMM-01", plan, actuals: [], flags: IMPORTED_ONLY, currentWeekMs: W2,
  });
  const w1 = wk(s, W1);
  assert.equal(w1.actualHoursTd, 0);
  assert.equal(w1.hoursVariance, 2);             // under plan = favorable
  assert.equal(w1.forecastTotalHours, 86);       // 0 + 86 remaining
  assert.equal(w1.substitutedHours, 0);
  assert.equal(s.substitutionUsed, false);
}

// ─── 5. Substitution mode ────────────────────────────────────────────────────
{
  const plan = standardPlan();

  // a) Nothing imported → completed W1 substitutes its 2 planned hours.
  const a = computeProjectAf({
    ticket: "PMM-01", plan, actuals: [], flags: SUBSTITUTE, currentWeekMs: W2,
  });
  assert.equal(a.substitutionUsed, true);
  const aw1 = wk(a, W1);
  assert.equal(aw1.actualHoursTd, 2);
  assert.equal(aw1.substitutedHours, 2);
  assert.equal(aw1.actualCostTd, 100);
  const subCell = a.detail.find(d => d.weekMonday === iso(W1) && d.substituted);
  assert.ok(subCell, "substituted detail cell flagged");
  // Current week W2 is NOT completed → its 30 planned hours never substitute.
  const aw2 = wk(a, W2);
  assert.equal(aw2.actualHoursTd, 2);
  assert.equal(aw2.substitutedHours, 2);

  // b) An imported row for that person+week WINS over substitution.
  const b = computeProjectAf({
    ticket: "PMM-01", plan,
    actuals: [actual({ hours: 5 })],
    flags: SUBSTITUTE, currentWeekMs: W2,
  });
  const bw1 = wk(b, W1);
  assert.equal(bw1.actualHoursTd, 5);
  assert.equal(bw1.substitutedHours, 0);

  // c) Open-demand rows (person "") NEVER substitute — nobody worked them —
  //    but they still count as forecast (plan TD includes them).
  const rows: FinAllocRow[] = [
    planRow({ start: iso(W1), hours: 2 }),
    planRow({ start: iso(W1), hours: 4, person: "", roleName: "Estimator" }),
    planRow({ start: iso(W2), hours: 30 }),
    planRow({ start: iso(W3), hours: 28 }),
    planRow({ start: iso(W4), hours: 24 }),
  ];
  const dPlan = buildTicketPlans(rows, 40).get("PMM-01");
  const c = computeProjectAf({
    ticket: "PMM-01", plan: dPlan, actuals: [], flags: SUBSTITUTE, currentWeekMs: W2,
  });
  const cw1 = wk(c, W1);
  assert.equal(cw1.forecastHoursTd, 6);          // 2 staffed + 4 demand
  assert.equal(cw1.actualHoursTd, 2);            // only the staffed row substituted
  const demandCell = c.detail.find(d => d.weekMonday === iso(W1) && d.person === "");
  assert.ok(demandCell, "demand forecast cell present");
  assert.equal(demandCell!.actualHours, 0);
}

// ─── 6. Rate ladder ──────────────────────────────────────────────────────────
{
  const plan = standardPlan();
  const catalogue = normalizeRoleRates(new Map([
    ["Estimator", { billingRate: 80, empCostRate: 40 }],
  ]));
  const s = computeProjectAf({
    ticket: "PMM-01", plan,
    actuals: [
      actual({ hours: 2 }),                                          // exact role match → 50/h
      actual({ hours: 2, person: "stranger-1", personName: "Sam",    // unknown person, catalogue role → 40/h, approximated
               roleName: "estimator" }),
      actual({ hours: 2, person: "stranger-2", personName: "Max",    // no rate anywhere → counted, $0, unrated
               roleName: "Mystery" }),
    ],
    roleRates: catalogue,
    flags: IMPORTED_ONLY, currentWeekMs: W2,
  });
  const w1 = wk(s, W1);
  assert.equal(w1.actualHoursTd, 6);             // ALL hours counted
  assert.equal(w1.actualCostTd, 2 * 50 + 2 * 40);// unrated priced at $0…
  assert.equal(w1.unratedActualHours, 2);        // …but loudly flagged
  const catCell = s.detail.find(d => d.person === "stranger-1");
  assert.ok(catCell?.rateApproximated, "catalogue rate flagged approximated");
  const exactCell = s.detail.find(d => d.person === "user-a" && d.actualHours > 0);
  assert.equal(exactCell?.rateApproximated, false);

  // Missing role column + single-role person → that role, NOT approximated.
  const noRole = computeProjectAf({
    ticket: "PMM-01", plan,
    actuals: [actual({ hours: 2, roleName: "" })],
    flags: IMPORTED_ONLY, currentWeekMs: W2,
  });
  assert.equal(wk(noRole, W1).actualCostTd, 100);
  const nrCell = noRole.detail.find(d => d.person === "user-a" && d.actualHours > 0);
  assert.equal(nrCell?.rateApproximated, false);

  // Two-role person, no role column → the role with planned hours THAT week
  // wins, flagged approximated.
  const rows: FinAllocRow[] = [
    planRow({ start: iso(W1), hours: 2, person: "user-b", roleName: "PM", costRate: 50 }),
    planRow({ start: iso(W2), hours: 10, person: "user-b", roleName: "Estimator", costRate: 30 }),
  ];
  const bPlan = buildTicketPlans(rows, 40).get("PMM-01");
  const tie = computeProjectAf({
    ticket: "PMM-01", plan: bPlan,
    actuals: [actual({ hours: 2, person: "user-b", personName: "Bo", roleName: "" })],
    flags: IMPORTED_ONLY, currentWeekMs: W2,
  });
  assert.equal(wk(tie, W1).actualCostTd, 100);   // PM's 50/h, not Estimator's 30
  const tieCell = tie.detail.find(d => d.person === "user-b" && d.actualHours > 0);
  assert.equal(tieCell?.rateApproximated, true);
}

// ─── 7. Actuals with no plan at all (pure history) ──────────────────────────
{
  const s = computeProjectAf({
    ticket: "OPM-99", plan: undefined,
    actuals: [actual({ ticket: "OPM-99", hours: 3, roleName: "Mystery" })],
    flags: IMPORTED_ONLY, currentWeekMs: W2,
  });
  const w1 = wk(s, W1);
  assert.equal(w1.actualHoursTd, 3);
  assert.equal(w1.forecastRemainingHours, 0);
  assert.equal(w1.forecastTotalHours, 3);        // EAC = actuals alone
  assert.equal(w1.unratedActualHours, 3);
  assert.equal(s.weeks.length, 2);               // W1 → current week
}

// ─── 8. Import aggregation: daily rows collapse into weekly keys ────────────
{
  const rows = [
    { ticket: "PMM-01", person: "USER-A", personName: "Alice", weekIso: "2026-08-03", hours: 2,   roleName: "PM", division: "" },
    { ticket: "pmm-01", person: "user-a", personName: "",      weekIso: "2026-08-03", hours: 5.5, roleName: "pm", division: "Bridges" },
    { ticket: "PMM-01", person: "user-a", personName: "Alice", weekIso: "2026-08-03", hours: 1,   roleName: "Estimator", division: "" },
    { ticket: "PMM-02", person: "user-a", personName: "Alice", weekIso: "2026-08-03", hours: 3,   roleName: "PM", division: "" },
  ];
  const agg = aggregateActualKeyRows(rows);
  assert.equal(agg.length, 3);                    // case-folded key merges rows 1+2
  const merged = agg.find(r => r.ticket === "PMM-01" && r.roleName === "PM");
  assert.equal(merged?.hours, 7.5);               // 2 + 5.5 summed
  assert.equal(merged?.personName, "Alice");      // first non-empty name kept
  assert.equal(merged?.division, "Bridges");      // first non-empty division kept
  const estRow = agg.find(r => r.roleName === "Estimator");
  assert.equal(estRow?.hours, 1);                 // different role = separate key
  assert.equal(agg.find(r => r.ticket === "PMM-02")?.hours, 3);
}

// ─── 9. Identity sweep: every week × all three unit families ────────────────
// total = actual TD + remaining, variance = plan TD − actual TD, remaining ≥ 0
// — for imported, substituted and no-plan series alike. The web pages LEAN on
// these identities (graph/report derive "remaining" as EAC − actual TD), so
// any restatement of the construction must fail here loudly.
{
  const rows: FinAllocRow[] = [
    planRow({ start: iso(W1), hours: 2 }),
    planRow({ start: iso(W1), hours: 4, person: "", roleName: "Estimator", billRate: 80, costRate: 40 }),
    planRow({ start: iso(W2), hours: 30 }),
    planRow({ start: iso(W3), hours: 28, billRate: 120, costRate: 65 }),
    planRow({ start: iso(W4), hours: 28 }),
  ];
  const plan = buildTicketPlans(rows, 40).get("PMM-01");
  const FAMILIES = [
    { act: "actualHoursTd", rem: "forecastRemainingHours", tot: "forecastTotalHours", td: "forecastHoursTd", vari: "hoursVariance" },
    { act: "actualCostTd", rem: "forecastRemainingCost", tot: "forecastTotalCost", td: "forecastCostTd", vari: "costVariance" },
    { act: "actualBillTd", rem: "forecastRemainingBill", tot: "forecastTotalBill", td: "forecastBillTd", vari: "billVariance" },
  ] as const;
  const scenarios: Array<{ label: string; s: ReturnType<typeof computeProjectAf> }> = [
    { label: "imported", s: computeProjectAf({
      ticket: "PMM-01", plan,
      actuals: [
        actual({ hours: 3.25 }),
        actual({ weekMs: W2, hours: 41.5 }),
        actual({ weekMs: W2, hours: 2, person: "stranger", personName: "Sam", roleName: "Mystery" }),
      ],
      flags: IMPORTED_ONLY, currentWeekMs: W3,
    }) },
    { label: "substituted", s: computeProjectAf({
      ticket: "PMM-01", plan, actuals: [], flags: SUBSTITUTE, currentWeekMs: W3,
    }) },
    { label: "no-plan", s: computeProjectAf({
      ticket: "OPM-99", plan: undefined,
      actuals: [actual({ ticket: "OPM-99", hours: 3, roleName: "Mystery" })],
      flags: IMPORTED_ONLY, currentWeekMs: W2,
    }) },
  ];
  for (const { label, s } of scenarios) {
    assert.ok(s.weeks.length > 0, `${label}: series not empty`);
    for (const w of s.weeks) {
      const W = w as unknown as Record<string, number>;
      for (const f of FAMILIES) {
        const at = `${label} ${w.weekMonday} ${f.vari}`;
        assert.ok(
          Number.isFinite(W[f.act]!) && Number.isFinite(W[f.rem]!) && Number.isFinite(W[f.tot]!)
          && Number.isFinite(W[f.td]!) && Number.isFinite(W[f.vari]!),
          `${at}: all fields finite`);
        assert.ok(Math.abs(W[f.tot]! - (W[f.act]! + W[f.rem]!)) < 1e-6, `${at}: total = actual TD + remaining`);
        assert.ok(Math.abs(W[f.vari]! - (W[f.td]! - W[f.act]!)) < 1e-6, `${at}: variance = plan TD − actual TD`);
        assert.ok(W[f.rem]! >= 0, `${at}: remaining never negative`);
      }
    }
    // Plan fully consumed by the final stored week → remaining 0 in every family.
    const L = s.weeks[s.weeks.length - 1]! as unknown as Record<string, number>;
    for (const f of FAMILIES) assert.equal(L[f.rem], 0, `${label} final week: ${f.rem} exhausted`);
  }
}

console.log("actualsForecast.test.ts: all assertions passed");
