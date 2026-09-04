/**
 * Actuals vs Forecast store — deterministic frozen-history regression tests.
 *
 * The engine tests prove the identities while computing a series. This test
 * drives the app-DB store itself through the fake mssql layer so a late
 * timesheet import cannot accidentally rewrite a frozen forecast.
 */
import assert from "node:assert/strict";
import {
  addResponder,
  startWatchdog,
  type FakeQuery,
} from "./helpers/fakeRdsDb.js";
import type { AfWeekPoint } from "../actuals-forecast.js";

startWatchdog("actualsForecastStore");

// The store uses transactions. The fake request router is sufficient for the
// statements; these no-op transaction methods keep the test off real tedious
// connections while preserving the store's transaction boundaries.
const sqlModule = await import("mssql");
const sql = sqlModule.default;
const txProto = sql.Transaction.prototype as unknown as Record<string, unknown>;
txProto.begin = function () { return Promise.resolve(this); };
txProto.commit = function () { return Promise.resolve(); };
txProto.rollback = function () { return Promise.resolve(); };

// Loaded after the fake driver and transaction shim are in place.
const store = await import("../actuals-forecast-store.js");
const { currentWeekMsUtcMinus12, isoDayUtc } = await import("../actuals-forecast.js");

const TID = "tenant-af-store-test";
const TICKET = "PMM-AF-STORE";
const W1 = "2026-08-03"; // past relative to the test's chosen current week
const W2 = "2026-08-10";
const W3 = "2026-08-17";

type Snapshot = {
  tenant_id: string;
  ticket_id: string;
  weekMonday: string;
  actual_hours_td: number;
  forecast_remaining_hours: number;
  forecast_total_hours: number;
  forecast_hours_td: number;
  actual_cost_td: number;
  forecast_remaining_cost: number;
  forecast_total_cost: number;
  forecast_cost_td: number;
  actual_bill_td: number;
  forecast_remaining_bill: number;
  forecast_total_bill: number;
  forecast_bill_td: number;
  hours_variance: number;
  cost_variance: number;
  bill_variance: number;
  substituted_hours: number;
  unrated_actual_hours: number;
  final: number;
  backfilled: number;
};

const snapshots = new Map<string, Snapshot>();
const key = (tid: string, ticket: string, week: string) => `${tid}|${ticket}|${week}`;
const param = (q: FakeQuery, name: string): unknown => q.params[name];
const numberParam = (q: FakeQuery, name: string): number => Number(param(q, name));
const dateParam = (q: FakeQuery, name: string): string => String(param(q, name)).slice(0, 10);

function point(
  weekMonday: string,
  patch: Partial<Snapshot> = {},
): Snapshot {
  return {
    tenant_id: TID,
    ticket_id: TICKET,
    weekMonday,
    actual_hours_td: 4,
    forecast_remaining_hours: 20,
    forecast_total_hours: 24,
    forecast_hours_td: 10,
    actual_cost_td: 400,
    forecast_remaining_cost: 2_000,
    forecast_total_cost: 2_400,
    forecast_cost_td: 1_000,
    actual_bill_td: 800,
    forecast_remaining_bill: 4_000,
    forecast_total_bill: 4_800,
    forecast_bill_td: 2_000,
    hours_variance: 6,
    cost_variance: 600,
    bill_variance: 1_200,
    substituted_hours: 0,
    unrated_actual_hours: 0,
    final: 0,
    backfilled: 0,
    ...patch,
  };
}

function allSnapshots(tid: string, ticket: string): Snapshot[] {
  return [...snapshots.values()].filter((row) =>
    row.tenant_id === tid && row.ticket_id === ticket
  );
}

/**
 * A deliberately small SQL-shaped fake: it handles only the statements issued
 * by actuals-forecast-store, while all values still travel through mssql
 * request parameters exactly as they do in production.
 */
addResponder((q) => {
  const text = q.text;

  if (text.includes("SELECT CONVERT(varchar(10), week_monday, 23) AS wk")) {
    return {
      recordset: allSnapshots(TID, TICKET).map((row) => ({
        wk: row.weekMonday,
        fin: row.final,
        actual_hours_td: row.actual_hours_td,
        forecast_remaining_hours: row.forecast_remaining_hours,
        forecast_total_hours: row.forecast_total_hours,
        forecast_hours_td: row.forecast_hours_td,
        actual_cost_td: row.actual_cost_td,
        forecast_remaining_cost: row.forecast_remaining_cost,
        forecast_total_cost: row.forecast_total_cost,
        forecast_cost_td: row.forecast_cost_td,
        actual_bill_td: row.actual_bill_td,
        forecast_remaining_bill: row.forecast_remaining_bill,
        forecast_total_bill: row.forecast_total_bill,
        forecast_bill_td: row.forecast_bill_td,
        hours_variance: row.hours_variance,
        cost_variance: row.cost_variance,
        bill_variance: row.bill_variance,
      })),
    };
  }

  if (text.includes("SELECT CONVERT(varchar(10), s.week_monday, 23) AS weekMonday")) {
    const tid = String(param(q, "tid"));
    const ticket = String(param(q, "tk"));
    return {
      recordset: allSnapshots(tid, ticket).sort((a, b) =>
        a.weekMonday.localeCompare(b.weekMonday)
      ).map((row) => ({
        weekMonday: row.weekMonday,
        actual_hours_td: row.actual_hours_td,
        forecast_remaining_hours: row.forecast_remaining_hours,
        forecast_total_hours: row.forecast_total_hours,
        forecast_hours_td: row.forecast_hours_td,
        actual_cost_td: row.actual_cost_td,
        forecast_remaining_cost: row.forecast_remaining_cost,
        forecast_total_cost: row.forecast_total_cost,
        forecast_cost_td: row.forecast_cost_td,
        actual_bill_td: row.actual_bill_td,
        forecast_remaining_bill: row.forecast_remaining_bill,
        forecast_total_bill: row.forecast_total_bill,
        forecast_bill_td: row.forecast_bill_td,
        hours_variance: row.hours_variance,
        cost_variance: row.cost_variance,
        bill_variance: row.bill_variance,
        substituted_hours: row.substituted_hours,
        unrated_actual_hours: row.unrated_actual_hours,
        final_: row.final,
        backfilled: row.backfilled,
        computed_at: null,
        // No rmone_actual_hours rows are persisted by this fake, so coverage
        // is honestly 0 for every snapshot row.
        actuals_covered: 0,
      })),
    };
  }

  if (text.includes("UPDATE dbo.rmone_af_snapshots SET [final] = 1")) {
    const tid = String(param(q, "tid"));
    const cutoff = dateParam(q, "cw");
    let changed = 0;
    for (const row of snapshots.values()) {
      if (row.tenant_id === tid && row.final === 0 && row.weekMonday < cutoff) {
        row.final = 1;
        changed++;
      }
    }
    return { recordset: Array.from({ length: changed }, () => ({})) };
  }

  if (text.includes("UPDATE dbo.rmone_af_snapshots SET") &&
      text.includes("actual_hours_td = @ah")) {
    const tid = String(param(q, "tid"));
    const ticket = String(param(q, "tk"));
    const week = dateParam(q, "wm");
    const row = snapshots.get(key(tid, ticket, week));
    assert.ok(row, `frozen row ${week} must exist before restatement`);
    assert.equal(row!.final, 1, `only frozen row ${week} may enter restatement UPDATE`);
    row!.actual_hours_td = numberParam(q, "ah");
    row!.actual_cost_td = numberParam(q, "ac");
    row!.actual_bill_td = numberParam(q, "ab");
    row!.forecast_total_hours = row!.actual_hours_td + row!.forecast_remaining_hours;
    row!.forecast_total_cost = row!.actual_cost_td + row!.forecast_remaining_cost;
    row!.forecast_total_bill = row!.actual_bill_td + row!.forecast_remaining_bill;
    row!.hours_variance = row!.forecast_hours_td - row!.actual_hours_td;
    row!.cost_variance = row!.forecast_cost_td - row!.actual_cost_td;
    row!.bill_variance = row!.forecast_bill_td - row!.actual_bill_td;
    row!.substituted_hours = numberParam(q, "sh");
    row!.unrated_actual_hours = numberParam(q, "uh");
    return { recordset: [] };
  }

  if (text.includes("DELETE FROM dbo.rmone_af_snapshots")) {
    const tid = String(param(q, "tid"));
    const ticket = String(param(q, "tk"));
    const from = dateParam(q, "fm");
    for (const [snapshotKey, row] of snapshots) {
      if (row.tenant_id === tid && row.ticket_id === ticket &&
          row.final === 0 && row.weekMonday >= from) {
        snapshots.delete(snapshotKey);
      }
    }
    return { recordset: [] };
  }

  if (text.includes("INSERT INTO dbo.rmone_af_snapshots")) {
    const indexes = [...text.matchAll(/@wm(\d+)/g)].map((match) => Number(match[1]));
    for (const i of indexes) {
      const weekMonday = dateParam(q, `wm${i}`);
      snapshots.set(key(String(param(q, `tid${i}`)), String(param(q, `tk${i}`)), weekMonday), {
        tenant_id: String(param(q, `tid${i}`)),
        ticket_id: String(param(q, `tk${i}`)),
        weekMonday,
        actual_hours_td: numberParam(q, `a${i}`),
        forecast_remaining_hours: numberParam(q, `b${i}`),
        forecast_total_hours: numberParam(q, `c${i}`),
        forecast_hours_td: numberParam(q, `d${i}`),
        actual_cost_td: numberParam(q, `e${i}`),
        forecast_remaining_cost: numberParam(q, `f${i}`),
        forecast_total_cost: numberParam(q, `g${i}`),
        forecast_cost_td: numberParam(q, `h${i}`),
        actual_bill_td: numberParam(q, `i${i}`),
        forecast_remaining_bill: numberParam(q, `k${i}`),
        forecast_total_bill: numberParam(q, `l${i}`),
        forecast_bill_td: numberParam(q, `m${i}`),
        hours_variance: numberParam(q, `n${i}`),
        cost_variance: numberParam(q, `o${i}`),
        bill_variance: numberParam(q, `p${i}`),
        substituted_hours: numberParam(q, `q${i}`),
        unrated_actual_hours: numberParam(q, `r${i}`),
        final: numberParam(q, `s${i}`),
        backfilled: numberParam(q, `u${i}`),
      });
    }
    return { recordset: [] };
  }

  // Snapshot-detail DELETE/INSERT statements are intentionally not persisted
  // here; this test is scoped to the snapshot truth rows under test.
  return undefined;
});

const week = (
  weekMonday: string,
  actualHoursTd: number,
  actualCostTd: number,
  actualBillTd: number,
  forecastRemainingHours: number,
  forecastRemainingCost: number,
  forecastRemainingBill: number,
): AfWeekPoint => ({
  weekMonday,
  actualHoursTd,
  actualCostTd,
  actualBillTd,
  forecastRemainingHours,
  forecastRemainingCost,
  forecastRemainingBill,
  forecastTotalHours: actualHoursTd + forecastRemainingHours,
  forecastHoursTd: 10,
  forecastTotalCost: actualCostTd + forecastRemainingCost,
  forecastCostTd: 1_000,
  forecastTotalBill: actualBillTd + forecastRemainingBill,
  forecastBillTd: 2_000,
  hoursVariance: 10 - actualHoursTd,
  costVariance: 1_000 - actualCostTd,
  billVariance: 2_000 - actualBillTd,
  substitutedHours: 0,
  unratedActualHours: 0,
});

const currentForWrite = Date.parse(`${W2}T00:00:00Z`);
const initialWeeks = [
  week(W1, 4, 400, 800, 20, 2_000, 4_000),
  week(W2, 7, 700, 1_400, 13, 1_300, 2_600),
  week(W3, 10, 1_000, 2_000, 0, 0, 0),
];

const beforeRejectedFreshWrite = new Map(
  [...snapshots.entries()].map(([snapshotKey, row]) => [snapshotKey, { ...row }]),
);
await assert.rejects(
  store.writeSnapshotSeries(
    TID,
    TICKET,
    [
      week(W2, 7, 700, 1_400, 13, 1_300, 2_600),
      { ...week(W3, 10, 1_000, 2_000, 0, 0, 0), forecastTotalHours: 1 },
    ],
    [],
    { currentWeekMs: currentForWrite },
  ),
  /Rejected snapshot series .*forecast snapshot integrity violation.*total_identity/,
);
assert.deepEqual(
  [...snapshots.entries()],
  [...beforeRejectedFreshWrite.entries()],
  "invalid fresh rows must not delete or publish part of the series",
);

const firstWrite = await store.writeSnapshotSeries(
  TID,
  TICKET,
  initialWeeks,
  [],
  { currentWeekMs: currentForWrite },
);
assert.deepEqual(firstWrite, { restated: 0, written: 3 });

let rows = await store.readSnapshotWeeks(TID, TICKET);
assert.equal(rows.length, 3, "fresh weeks must be inserted");
assert.equal(rows.find((row) => row.weekMonday === W1)?.backfilled, 1,
  "past fresh rows must be marked backfilled");
assert.equal(rows.find((row) => row.weekMonday === W2)?.backfilled, 0,
  "current-week fresh rows must not be marked backfilled");
assert.equal(rows.find((row) => row.weekMonday === W1)?.final_, 1,
  "past fresh rows must be frozen immediately");

const frozenBefore = rows.find((row) => row.weekMonday === W1)!;
const frozenForecastBefore = {
  forecast_remaining_hours: frozenBefore.forecast_remaining_hours,
  forecast_hours_td: frozenBefore.forecast_hours_td,
  forecast_remaining_cost: frozenBefore.forecast_remaining_cost,
  forecast_cost_td: frozenBefore.forecast_cost_td,
  forecast_remaining_bill: frozenBefore.forecast_remaining_bill,
  forecast_bill_td: frozenBefore.forecast_bill_td,
};

const beforeRejectedRestatement = new Map(
  [...snapshots.entries()].map(([snapshotKey, row]) => [snapshotKey, { ...row }]),
);
await assert.rejects(
  store.writeSnapshotSeries(
    TID,
    TICKET,
    [{ ...week(W1, 9, 875, 1_725, 20, 2_000, 4_000), actualHoursTd: Number.NaN }],
    [],
    { currentWeekMs: currentForWrite },
  ),
  /Rejected snapshot series .*forecast snapshot integrity violation.*non_finite/,
);
assert.deepEqual(
  [...snapshots.entries()],
  [...beforeRejectedRestatement.entries()],
  "invalid restatements must not publish an update",
);

const lateWeeks = [
  week(W1, 9, 875, 1_725, 20, 2_000, 4_000),
  week(W2, 8, 800, 1_600, 12, 1_200, 2_400),
  week(W3, 11, 1_100, 2_200, 0, 0, 0),
];
const restated = await store.writeSnapshotSeries(
  TID,
  TICKET,
  lateWeeks,
  [],
  { currentWeekMs: currentForWrite },
);
assert.deepEqual(restated, { restated: 1, written: 2 },
  "late import must restate only the frozen week and reinsert open weeks");

rows = await store.readSnapshotWeeks(TID, TICKET);
const restatedW1 = rows.find((row) => row.weekMonday === W1)!;
assert.equal(restatedW1.final_, 1, "restated history must remain frozen");
assert.deepEqual({
  forecast_remaining_hours: restatedW1.forecast_remaining_hours,
  forecast_hours_td: restatedW1.forecast_hours_td,
  forecast_remaining_cost: restatedW1.forecast_remaining_cost,
  forecast_cost_td: restatedW1.forecast_cost_td,
  forecast_remaining_bill: restatedW1.forecast_remaining_bill,
  forecast_bill_td: restatedW1.forecast_bill_td,
}, frozenForecastBefore, "frozen forecast columns must be byte-identical");

const families = [
  ["hours", "actual_hours_td", "forecast_remaining_hours", "forecast_total_hours", "forecast_hours_td", "hours_variance"],
  ["cost", "actual_cost_td", "forecast_remaining_cost", "forecast_total_cost", "forecast_cost_td", "cost_variance"],
  ["bill", "actual_bill_td", "forecast_remaining_bill", "forecast_total_bill", "forecast_bill_td", "bill_variance"],
] as const;
for (const [label, actual, remaining, total, forecastTd, variance] of families) {
  const row = restatedW1 as Record<string, number>;
  assert.equal(row[total], row[actual]! + row[remaining]!,
    `${label}: total = actual + frozen remaining`);
  assert.equal(row[variance], row[forecastTd]! - row[actual]!,
    `${label}: variance = frozen forecast TD - new actual`);
}

// Exercise the separate freeze sweep as well. Its cutoff is derived from the
// production UTC−12 clock, so the fixture remains deterministic on any date.
const cutoff = isoDayUtc(currentWeekMsUtcMinus12());
const priorWeek = isoDayUtc(currentWeekMsUtcMinus12() - 7 * 86_400_000);
const finalizeTid = "tenant-af-finalize-test";
const finalizeTicket = "PMM-AF-FINALIZE";
snapshots.set(key(finalizeTid, finalizeTicket, priorWeek), point(priorWeek, {
  tenant_id: finalizeTid,
  ticket_id: finalizeTicket,
}));
snapshots.set(key(finalizeTid, finalizeTicket, cutoff), point(cutoff, {
  tenant_id: finalizeTid,
  ticket_id: finalizeTicket,
}));
const finalized = await store.finalizeDueWeeks(finalizeTid);
assert.equal(finalized, 1, "finalizeDueWeeks must freeze only elapsed open weeks");
assert.equal(snapshots.get(key(finalizeTid, finalizeTicket, priorWeek))!.final, 1);
assert.equal(snapshots.get(key(finalizeTid, finalizeTicket, cutoff))!.final, 0);

console.log("actualsForecastStore.test.ts: all assertions passed");
process.exit(0);