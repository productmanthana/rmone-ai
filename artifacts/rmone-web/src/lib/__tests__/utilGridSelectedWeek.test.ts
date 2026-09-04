import assert from "node:assert/strict";
import {
  parsePeriodKey,
  selectedWeekDays,
  splitTotalHoursByWeights,
  splitWeeklyHoursAcrossDays,
} from "../utilGrid.js";

const clickedWednesday = parsePeriodKey("01-Jul-26");
assert.equal(
  parsePeriodKey("29-Jun-26"),
  new Date(2026, 5, 29).getTime(),
  "day-first weekly period keys preserve the clicked local date",
);
const days = selectedWeekDays(
  clickedWednesday,
  [0, 6],
  ["2026-07-01"],
);

assert.deepEqual(
  days.map(day => day.isoDay),
  [
    "2026-06-29",
    "2026-06-30",
    "2026-07-01",
    "2026-07-02",
    "2026-07-03",
    "2026-07-04",
    "2026-07-05",
  ],
  "a clicked date is always presented as its exact Monday–Sunday week",
);
assert.deepEqual(
  days.map(day => day.isWorkingDay),
  [true, true, false, true, true, false, false],
  "configured holidays and non-working weekdays are excluded from the daily plan",
);
assert.equal(days[2].holidayLabel, "Company holiday", "an unlabeled holiday remains a non-working day");

const daily = splitWeeklyHoursAcrossDays(150, days);
assert.deepEqual(
  daily,
  [37.5, 37.5, 0, 37.5, 37.5, 0, 0],
  "weekly hours are split only across the selected week's configured working days",
);
assert.equal(
  daily.reduce((sum, value) => sum + value, 0),
  150,
  "the visible day values add back to the exact weekly total",
);

const remainder = splitWeeklyHoursAcrossDays(40, days);
assert.equal(
  Math.round(remainder.reduce((sum, value) => sum + value, 0) * 10) / 10,
  40,
  "the final working day carries any tenth-hour rounding remainder",
);

assert.deepEqual(
  splitTotalHoursByWeights(1, [1, 1, 1]),
  [0.3, 0.4, 0.3],
  "fractional project shares retain the authoritative weekly total instead of rounding down to 0.9h",
);
assert.equal(
  splitTotalHoursByWeights(150, [60, 30, 10]).reduce((sum, value) => sum + value, 0),
  150,
  "weighted project segments always reconcile to the clicked cell total",
);

const noWorkingDays = selectedWeekDays(clickedWednesday, [0, 1, 2, 3, 4, 5, 6], []);
assert.deepEqual(
  splitWeeklyHoursAcrossDays(40, noWorkingDays),
  [0, 0, 0, 0, 0, 0, 0],
  "an all-non-working week never invents planned hours on excluded days",
);

console.log("util-grid-selected-week: all assertions passed");