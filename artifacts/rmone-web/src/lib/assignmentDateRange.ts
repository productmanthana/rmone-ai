/**
 * Date-order guard for assignment editors. Date inputs and persisted assignment
 * boundaries are calendar days, so compare their YYYY-MM-DD parts rather than
 * allowing a browser timezone to change the ordering.
 *
 * Missing or malformed values are intentionally left to the existing field and
 * server validation paths; this helper has one responsibility: reject a valid,
 * reversed assignment window before any mutation begins.
 */
function parseCalendarDay(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) {
    return null;
  }
  return calendar.getTime();
}

export const ASSIGNMENT_DATE_RANGE_MESSAGE =
  "Start date must be on or before the end date. Choose an end date on or after the start date.";

/** Returns the user-facing error only for a complete, valid, reversed range. */
export function assignmentDateRangeError(startDate: unknown, endDate: unknown): string | null {
  const start = parseCalendarDay(startDate);
  const end = parseCalendarDay(endDate);
  return start != null && end != null && start > end
    ? ASSIGNMENT_DATE_RANGE_MESSAGE
    : null;
}