import {
  derivePlannerSchedule,
  enumeratePlannerScheduleWeeks,
  toISODate,
} from "../phaseHours";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const noLifecycle = derivePlannerSchedule([]);
assert(noLifecycle.state === "no-lifecycle", "an empty task-data list must report no lifecycle");

const noDates = derivePlannerSchedule([{ Title: "Design", StageStep: 1 }]);
assert(noDates.state === "no-dates", "named but undated phases must require Schedule dates");

const lifecycleRows = [
  { Title: "Construction Documents", StageStep: 3, StartDate: "2026-03-23", DueDate: "2026-03-29" },
  { Title: "PD", StageStep: 1, StartDate: "2026-03-03", DueDate: "2026-03-08" },
  { Title: "Closeout", StageStep: 4 },
];
const normalized = derivePlannerSchedule(lifecycleRows);
assert(normalized.state === "ready", "a dated lifecycle must be plannable");
assert(normalized.phases.length === 2 && normalized.missingDateCount === 1, "partially dated schedules must retain dated phases and flag the rest");
assert(normalized.phases[0].title === "Pre-Design", "phases must remain lifecycle ordered");

const wrappedUppercase = derivePlannerSchedule({ Data: lifecycleRows });
assert(wrappedUppercase.state === "ready" && wrappedUppercase.phases.length === 2, "uppercase Data envelopes must preserve dated lifecycle phases");
const wrappedLowercase = derivePlannerSchedule({ data: lifecycleRows });
assert(wrappedLowercase.state === "ready" && wrappedLowercase.phases.length === 2, "lowercase data envelopes must preserve dated lifecycle phases");

const endDateOnly = derivePlannerSchedule([
  { Title: "Planning", StageStep: 1, StartDate: "2026-01-05", DueDate: "2026-06-30" },
  { Title: "Closeout", StageStep: 2, StartDate: "2026-07-01", EndDate: "2027-02-05" },
]);
assert(
  endDateOnly.phases.at(-1)?.end === "2027-02-05",
  "an EndDate-only final phase must define the same schedule boundary used by allocation planning",
);

const scheduleWeeks = enumeratePlannerScheduleWeeks(normalized.phases).map(toISODate);
assert(
  scheduleWeeks.join("|") === "2026-03-02|2026-03-23",
  "schedule planners must show only weeks overlapping dated phases, never gap weeks",
);

console.log("plannerSchedule: authoritative phase windows and gap exclusion passed");