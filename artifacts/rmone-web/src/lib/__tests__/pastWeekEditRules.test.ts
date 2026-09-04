import assert from "node:assert/strict";
import {
  PAST_WEEK_LOCKED_REASON,
  pastWeekEditState,
} from "../businessRules.js";

const today = new Date(2026, 7, 21, 12); // Friday; current Monday is 2026-08-17.

const disabled = { allowPastDateEdit: false, pastEditLimitWeeks: null };
const oneWeek = { allowPastDateEdit: true, pastEditLimitWeeks: 1 };
const unlimited = { allowPastDateEdit: true, pastEditLimitWeeks: null };

assert.deepEqual(
  pastWeekEditState("2026-08-17", disabled, today),
  { isPast: false, ageWeeks: 0, locked: false, reason: null },
  "the current week stays editable",
);

assert.deepEqual(
  pastWeekEditState("2026-08-10", disabled, today),
  { isPast: true, ageWeeks: 1, locked: true, reason: PAST_WEEK_LOCKED_REASON },
  "the previous week locks when past editing is disabled",
);

assert.equal(
  pastWeekEditState("2026-08-10", oneWeek, today).locked,
  false,
  "the configured boundary week remains editable",
);

assert.deepEqual(
  pastWeekEditState("2026-08-03", oneWeek, today),
  { isPast: true, ageWeeks: 2, locked: true, reason: PAST_WEEK_LOCKED_REASON },
  "weeks older than the configured limit lock",
);

assert.equal(
  pastWeekEditState("2025-01-06", unlimited, today).locked,
  false,
  "unlimited past editing keeps historical weeks editable",
);

assert.deepEqual(
  pastWeekEditState("not-a-week", disabled, today),
  { isPast: false, ageWeeks: 0, locked: false, reason: null },
  "malformed week keys are not misclassified",
);

console.log("✓ past-week edit rules use the shared Monday-aligned policy");