/**
 * Actuals-vs-Forecast people details — name honesty, picker choices, and the
 * click-to-detail path.
 *
 * The client's requirement: the person filter popup must show human-readable
 * tenant names (never a raw GUID as the primary label), useful role/division
 * and hour context, and clicking a person must open their weekly detail —
 * including people whose plan sits entirely in future weeks. Filtering stays
 * keyed on stable person ids so duplicate display names never merge.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  afPersonDisplayName, looksLikePersonId, explainRows, buildAfPersonChoices,
  afDetailMetricFor, afDetailMetricAt, afPickerAnchorPoint, seriesFromDetail,
  filterDetail, UNKNOWN_PERSON_LABEL, UNSTAFFED_DEMAND_LABEL,
  type AfMetric,
} from "../afMath";
import type { AfDetailRow, AfWeekRow } from "../api";

/* ── fixtures ─────────────────────────────────────────────────────────── */

const GUID_A = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const GUID_B = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const GUID_C = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
const GUID_D = "d4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80";
const GUID_E = "e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8091";
const GUID_F = "f6a7b8c9-d0e1-4f2a-9b4c-5d6e7f809102";

function row(over: Partial<AfDetailRow>): AfDetailRow {
  return {
    weekMonday: "2026-08-03", person: GUID_A, personName: "Ana Lopez",
    roleName: "PM", division: "East",
    actualHours: 0, actualCost: 0, actualBill: 0,
    forecastHours: 0, forecastCost: 0, forecastBill: 0,
    remainingHours: 0, remainingCost: 0, remainingBill: 0,
    substituted: false, rateApproximated: false, missingDivision: false,
    ...over,
  };
}

function week(weekMonday: string): AfWeekRow {
  return {
    weekMonday,
    actualHoursTd: 0, forecastRemainingHours: 0, forecastTotalHours: 0, forecastHoursTd: 0,
    actualCostTd: 0, forecastRemainingCost: 0, forecastTotalCost: 0, forecastCostTd: 0,
    actualBillTd: 0, forecastRemainingBill: 0, forecastTotalBill: 0, forecastBillTd: 0,
    hoursVariance: 0, costVariance: 0, billVariance: 0,
    substitutedHours: 0, unratedActualHours: 0, final: false, backfilled: false,
  } as AfWeekRow;
}

/* ── 1. Display-name honesty ──────────────────────────────────────────── */

assert.equal(afPersonDisplayName(GUID_A, "Ana Lopez"), "Ana Lopez", "a real directory name passes through untouched");
assert.equal(afPersonDisplayName(GUID_A, "  "), UNKNOWN_PERSON_LABEL, "a blank stored name falls back to the honest label");
assert.equal(afPersonDisplayName(GUID_A, GUID_B), UNKNOWN_PERSON_LABEL, "a GUID-shaped stored name is never shown as a person's name");
assert.equal(
  afPersonDisplayName(GUID_A, GUID_A.toUpperCase()),
  UNKNOWN_PERSON_LABEL,
  "a stored name that merely echoes the person's own id (any casing) is not a name",
);
assert.equal(afPersonDisplayName("", "whatever"), "whatever", "open-demand rows pass through — surfaces label open demand themselves");
assert.ok(looksLikePersonId(` ${GUID_C} `), "id detection tolerates padding so padded GUIDs can't sneak through as names");
assert.ok(!looksLikePersonId("Ana Lopez"), "ordinary names are not mistaken for ids");

/* ── 2. explainRows carries honest names into the detail popup ────────── */

{
  const people = explainRows(
    [
      row({ person: GUID_E, personName: GUID_E, forecastHours: 4 }),            // GUID stored as name
      row({ person: GUID_E, personName: "Elena Ruiz", actualHours: 3 }),        // later row has the real name
      row({ person: GUID_B, personName: "", forecastHours: 6 }),                // never named anywhere
      row({ person: "", personName: "", roleName: "Designer", forecastHours: 8 }), // open demand
    ],
    "2026-08-10",
  );
  const byId = new Map(people.map((p) => [p.person, p]));
  assert.equal(byId.get(GUID_E)?.name, "Elena Ruiz", "a later row's real name upgrades an earlier GUID-name fallback");
  assert.equal(byId.get(GUID_B)?.name, UNKNOWN_PERSON_LABEL, "a person with no name anywhere gets the honest fallback, not their GUID");
  assert.equal(byId.get("")?.person, "", "open demand keeps its empty person key for the popup's own labeling");
}

/* ── 3. Picker choices: hydration, context, stats, stable ids ─────────── */

const detail: AfDetailRow[] = [
  // Ana: actuals + plan through the cutoff, more plan in a future week, two roles.
  row({ weekMonday: "2026-08-03", actualHours: 10, forecastHours: 8 }),
  row({ weekMonday: "2026-08-10", actualHours: 5.5, forecastHours: 8, roleName: "Sr PM" }),
  row({ weekMonday: "2026-08-17", forecastHours: 12, roleName: "PM", division: "West" }),
  // Ben: planned ONLY after the latest snapshot week.
  row({ person: GUID_B, personName: "Ben Cho", roleName: "Engineer", division: "North", weekMonday: "2026-08-17", forecastHours: 20, forecastCost: 500 }),
  // Two different people who share a display name.
  row({ person: GUID_C, personName: "Dana Smith", roleName: "Analyst", weekMonday: "2026-08-03", forecastHours: 5 }),
  row({ person: GUID_D, personName: "Dana Smith", roleName: "Architect", weekMonday: "2026-08-03", forecastHours: 7 }),
  // Elena: first row carries her GUID as the name, a later row the real name.
  row({ person: GUID_E, personName: GUID_E, roleName: "QA", weekMonday: "2026-08-03", forecastHours: 3 }),
  row({ person: GUID_E, personName: "Elena Ruiz", roleName: "QA", weekMonday: "2026-08-10", actualHours: 2 }),
  // Frank: imported actuals only, never planned.
  row({ person: GUID_F, personName: "Frank Ito", roleName: "Surveyor", weekMonday: "2026-08-03", actualHours: 6 }),
  // Open (unstaffed) demand.
  row({ person: "", personName: "", roleName: "Designer", weekMonday: "2026-08-10", forecastHours: 9 }),
];
const weeks = [week("2026-08-03"), week("2026-08-10"), week("2026-08-17")];
const choices = buildAfPersonChoices(detail, weeks, "2026-08-10");
const byId = new Map(choices.map((c) => [c.id, c]));

{
  const ana = byId.get(GUID_A)!;
  assert.equal(ana.name, "Ana Lopez", "picker rows show the tenant directory name");
  assert.equal(ana.role, "PM, Sr PM", "distinct roles accumulate once each (exact-token dedupe, so PM ≠ Sr PM)");
  assert.equal(ana.division, "East, West", "distinct divisions accumulate the same way");
  assert.equal(ana.actualHours, 15.5, "actual hours sum through the latest snapshot week only");
  assert.equal(ana.plannedHours, 16, "planned hours use the same to-date cutoff");
  assert.equal(ana.varianceHours, 0.5, "difference = planned − actual (page sign convention)");
  assert.equal(ana.plannedTotalHours, 28, "the all-weeks plan total still includes future weeks");

  const ben = byId.get(GUID_B)!;
  assert.deepEqual(
    [ben.actualHours, ben.plannedHours, ben.plannedTotalHours],
    [0, 0, 20],
    "a future-only person shows zero to-date stats but a real upcoming plan total",
  );

  assert.ok(byId.has(GUID_C) && byId.has(GUID_D), "duplicate display names stay separate entries keyed by GUID");
  assert.equal(byId.get(GUID_C)?.name, byId.get(GUID_D)?.name, "…even though their labels match");
  assert.notEqual(byId.get(GUID_C)?.plannedHours, byId.get(GUID_D)?.plannedHours, "each keeps their own hours");

  assert.equal(byId.get(GUID_E)?.name, "Elena Ruiz", "GUID-named first rows are upgraded by a later real name");
  assert.equal(byId.get("")?.name, UNSTAFFED_DEMAND_LABEL, "open demand is labeled as unstaffed demand, distinct from people");

  const names = choices.map((c) => c.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), "choices are sorted by display name");
}

// No snapshot weeks yet: to-date stats are honestly zero, but the plan total
// still counts so future-only people don't render as dead all-zero rows.
{
  const noWeeks = buildAfPersonChoices(detail, [], "2026-08-10");
  const ana = noWeeks.find((c) => c.id === GUID_A)!;
  assert.deepEqual([ana.actualHours, ana.plannedHours, ana.plannedTotalHours], [0, 0, 28]);
}

/* ── 4. Click-to-detail: the popup opens on a tab that has the person ─── */

assert.equal(afDetailMetricFor({ actualHours: 15.5, plannedHours: 16, plannedTotalHours: 28 }), "plan", "planned-to-date people open on the Planned breakdown");
assert.equal(afDetailMetricFor({ actualHours: 4, plannedHours: 0, plannedTotalHours: 0 }), "actual", "actuals-only people open on the Actual breakdown");
assert.equal(
  afDetailMetricFor({ actualHours: 0, plannedHours: 0, plannedTotalHours: 20 }),
  "eac",
  "future-only people open on Expected total — the only tab whose rows include still-planned hours",
);
assert.equal(afDetailMetricFor({ actualHours: 0, plannedHours: 0, plannedTotalHours: 0 }), "plan", "all-zero people fall back to Planned (its empty-state explainer)");

/* ── 4b. Routing at the popup's own cutoff always lands on a visible row ── */

// Mirror AfExplainPopup's row predicates (hours family): the actual tab
// keeps a person only when actual ≠ 0, the plan tab only when planTd ≠ 0,
// and the EAC tab only when actual ≠ 0 or remaining (planTotal − planTd) ≠ 0.
function popupRowVisible(
  rows: AfDetailRow[], cutoff: string, person: string, metric: AfMetric,
  unit: "hours" | "cost" | "bill" = "hours",
): boolean {
  const p = explainRows(rows, cutoff).find((x) => x.person === person);
  if (!p) return false;
  const v = (t: { hours: number; cost: number; bill: number }) =>
    unit === "hours" ? t.hours : unit === "cost" ? t.cost : t.bill;
  const a = v(p.actual);
  const pl = v(p.plan);
  const rem = v(p.planTotal) - v(p.plan);
  if (metric === "actual") return a !== 0;
  if (metric === "plan") return pl !== 0;
  if (metric === "variance") return a !== 0 || pl !== 0;
  return a !== 0 || rem !== 0; // eac
}

{
  // Ben is planned only after the latest snapshot: at the "now" anchor his
  // to-date stats are zero, so routing must land on Expected total…
  const nowCutoff = "2026-08-10";
  const benNow = afDetailMetricAt(detail, nowCutoff, GUID_B);
  assert.equal(benNow, "eac", "future-only person routes to Expected total at the now anchor");
  assert.ok(popupRowVisible(detail, nowCutoff, GUID_B, benNow), "…and his EAC row is actually visible there");

  // …and at an end-of-series anchor his plan-to-date is nonzero, so routing
  // flips to the Planned tab — still a visible row. This is why the tab
  // decision must be made at the popup's cutoff, not from picker stats.
  const endCutoff = "2026-08-17";
  const benEnd = afDetailMetricAt(detail, endCutoff, GUID_B);
  assert.equal(benEnd, "plan", "the same person routes to Planned when the anchor cutoff covers his weeks");
  assert.ok(popupRowVisible(detail, endCutoff, GUID_B, benEnd), "…with a visible Planned row");

  assert.equal(afDetailMetricAt(detail, "2026-08-03", GUID_F), "actual", "actuals-only people route to the Actual breakdown");
  assert.equal(afDetailMetricAt(detail, nowCutoff, "not-a-person"), "plan", "an unknown person id falls back to Planned");

  // The popup's row predicates evaluate in the SELECTED unit family, so
  // routing must too: on Cost view Ben's future forecast cost lands on EAC…
  assert.equal(afDetailMetricAt(detail, nowCutoff, GUID_B, "cost"), "eac", "cost view routes by cost values, not hours");
  assert.ok(popupRowVisible(detail, nowCutoff, GUID_B, "eac", "cost"), "…and his EAC cost row is visible");
  // …while a person planned in hours with $0 cost (unrated role) has NO
  // visible cost row on any tab — Planned's empty state is the honest answer.
  assert.equal(afDetailMetricAt(detail, nowCutoff, GUID_C, "cost"), "plan", "all-zero-cost people fall back to Planned on cost view");
  for (const m of ["actual", "plan", "variance", "eac"] as const) {
    assert.equal(popupRowVisible(detail, nowCutoff, GUID_C, m, "cost"), false, "unrated people legitimately have no cost rows on any tab");
  }

  // Whatever the anchor, anyone with ANY nonzero hours gets a visible row.
  for (const cutoff of ["2026-08-03", nowCutoff, endCutoff]) {
    for (const id of [GUID_A, GUID_B, GUID_C, GUID_D, GUID_E, GUID_F, ""]) {
      const metric = afDetailMetricAt(detail, cutoff, id);
      const p = explainRows(detail, cutoff).find((x) => x.person === id)!;
      const hasAnything = p.actual.hours !== 0 || p.planTotal.hours !== 0;
      assert.ok(
        popupRowVisible(detail, cutoff, id, metric) || !hasAnything,
        `person ${id || "open-demand"} at cutoff ${cutoff} must land on a tab that shows their row`,
      );
    }
  }
}

/* ── 4c. Picker anchor comes from the UNFILTERED series ─────────────────── */
{
  const nowCutoff = "2026-08-10";

  // Scenario the anchor rule exists for: future-only Ben is ALREADY selected,
  // so the page's visible series is his sparse timeline. Reopening the picker
  // and choosing someone else must not anchor on Ben's series — the helper
  // takes the unfiltered frozen weeks and lands on the "now" bucket…
  const anchor = afPickerAnchorPoint(weeks, nowCutoff, "hours");
  assert.ok(anchor, "anchor exists whenever the project has snapshot weeks");
  assert.equal(anchor!.weekMonday, nowCutoff, "anchor = latest snapshot at/before the current week, never the final future point");

  // …whereas Ben's filtered timeline offers no valid "now" point at all (his
  // only week is future) — the exact shape that used to push the anchor onto
  // a future point for the NEXT selection.
  const benOnlyWeeks = seriesFromDetail(filterDetail(detail, { person: GUID_B }));
  assert.ok(benOnlyWeeks.length > 0 && benOnlyWeeks.every((w) => w.weekMonday > nowCutoff),
    "the previously selected person's series is entirely in the future");

  // Completing the A→B transition: the newly selected person routes and
  // renders from THEIR scoped rows at the unfiltered anchor's cutoff.
  const scopedB = filterDetail(detail, { person: GUID_F });
  const metricB = afDetailMetricAt(scopedB, anchor!.weekMonday, GUID_F, "hours");
  assert.equal(metricB, "actual", "the next selection routes from its own scoped rows at the unfiltered anchor cutoff");
  assert.ok(popupRowVisible(scopedB, anchor!.weekMonday, GUID_F, metricB), "…and has a visible row there");

  // Degenerate shapes stay safe: no weeks → no anchor; an all-future series
  // (young project, first snapshot not landed) falls back to its last point,
  // mirroring the picker-stats lastWeek fallback.
  assert.equal(afPickerAnchorPoint([], nowCutoff, "hours"), null, "no snapshot weeks → no anchor → no popup");
  const futureOnly = [week("2026-09-07"), week("2026-09-14")];
  assert.equal(afPickerAnchorPoint(futureOnly, nowCutoff, "hours")!.weekMonday, "2026-09-14",
    "an entirely-future series anchors at its last point, same as picker stats");
}

/* ── 5. Wiring guard: the real surfaces stay on this path ─────────────── */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const pageSource = read("../../pages/actuals-forecast.tsx");
const pickerSource = read("../../components/AfPeoplePickerPopup.tsx");

assert.ok(
  pageSource.includes("buildAfPersonChoices(available.detail, available.weeks, available.currentWeek)"),
  "the page must build picker choices through the shared lib (names + stats stay consistent with the popup)",
);
assert.ok(
  pageSource.includes("afDetailMetricAt(scoped, detailPoint.weekMonday, id, unit)"),
  "picker selection must route the detail tab at the popup's OWN cutoff and scope — routing by to-date picker stats can open a breakdown missing the clicked person",
);
assert.ok(
  pageSource.includes("afPickerAnchorPoint(available.weeks, available.currentWeek, unit)"),
  "the picker anchor must come from the UNFILTERED frozen series — deriving it from the filtered points would reuse the previous selection's sparse timeline",
);
assert.ok(
  !/const personDetailPoint = points\[/.test(pageSource),
  "the anchor must never be the last point of the currently visible (filtered) series",
);
assert.match(
  pageSource,
  /personKey: id/,
  "the chosen person's stable id must ride into the explain popup state",
);
assert.match(
  pageSource,
  /initialPersonKey=\{explain\.personKey\}/,
  "the explain popup must receive the person key so their weekly rows start expanded",
);
assert.match(pageSource, /onSelect=\{choosePerson\}/, "the picker popup must hand selections to choosePerson");
assert.match(
  pickerSource,
  /onClick=\{\(\) => onSelect\(choice\.id\)\}/,
  "picker rows must select by stable id — never by display name",
);
assert.ok(pickerSource.includes("onSelect(null)"), "the picker must keep an explicit All-people reset");

console.log("af-people-details: all assertions passed");
