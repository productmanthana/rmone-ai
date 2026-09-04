/**
 * Server-side assignment date-order guard. This is deliberately independent of
 * client validation: callers such as mobile, old tabs, or direct API clients
 * must not be able to persist a reversed assignment span.
 *
 * Blank and malformed values retain the provider's existing compatibility
 * behavior. This guard rejects only a complete, parseable range where start is
 * after end.
 */
function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export const ASSIGNMENT_DATE_RANGE_MESSAGE =
  "Start date must be on or before the end date. Choose an end date on or after the start date.";

export function assignmentDateRangeError(startDate: unknown, endDate: unknown): string | null {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  return start && end && start.getTime() > end.getTime()
    ? ASSIGNMENT_DATE_RANGE_MESSAGE
    : null;
}