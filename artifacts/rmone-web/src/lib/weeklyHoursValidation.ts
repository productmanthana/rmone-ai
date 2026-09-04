export const MAX_WEEKLY_HOURS = 168;

export type WeeklyHoursViolation =
  | { week: string; hours: number; reason: "not_a_number" | "negative" | "over_limit" };

/**
 * Parse a typed weekly-hours field without treating a blank as an explicit
 * zero. Users must type 0 when they intend to clear a weekly allocation.
 */
export function parseWeeklyHoursDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Validate untrusted planner values before an assignment or weekly replacement starts. */
export function findWeeklyHoursViolation(
  entries: Iterable<readonly [string, unknown]>,
): WeeklyHoursViolation | null {
  for (const [week, rawHours] of entries) {
    if (typeof rawHours !== "number" || !Number.isFinite(rawHours)) {
      return { week, hours: Number.NaN, reason: "not_a_number" };
    }
    if (rawHours < 0) return { week, hours: rawHours, reason: "negative" };
    if (rawHours > MAX_WEEKLY_HOURS) {
      return { week, hours: rawHours, reason: "over_limit" };
    }
  }
  return null;
}

export function weeklyHoursViolationMessage(
  violation: WeeklyHoursViolation,
): string {
  const week = /^\d{4}-\d{2}-\d{2}$/.test(violation.week)
    ? `the week of ${violation.week}`
    : "a weekly allocation";
  if (violation.reason === "over_limit") {
    return `${week} is set to ${violation.hours} hours. The maximum is ${MAX_WEEKLY_HOURS} hours per week. Nothing has been saved.`;
  }
  if (violation.reason === "negative") {
    return `${week} cannot be negative. Enter a value from 0 to ${MAX_WEEKLY_HOURS} hours. Nothing has been saved.`;
  }
  return `${week} must contain a valid number from 0 to ${MAX_WEEKLY_HOURS}. Nothing has been saved.`;
}