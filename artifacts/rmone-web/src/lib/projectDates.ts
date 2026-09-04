/* ONE rule for project/opportunity effective dates (client rule, applies
 * app-wide: home intelligence, daily briefing, projects grid/cards, reports):
 *
 *   1. Record HAS a phase schedule → the schedule wins: effective start =
 *      first phase start (`_ScheduleStart`), effective end = last phase end
 *      (`_ScheduleEnd`). Both are attached to PMM and OPM list rows by the
 *      records API.
 *   2. NO phase schedule → fall back to the record's TargetStartDate /
 *      TargetCompletionDate (which the settings-driven default fills).
 *   3. Closed records → a real ActualCompletionDate (when set) beats both for
 *      the end date; nothing else ever reads the Actual pair for display.
 *
 * Never read TargetStartDate / TargetCompletionDate / ActualStartDate /
 * ActualCompletionDate directly for display or window logic — import from
 * here so every surface derives the same dates.
 */
import { isClosedishStatus } from "./closedish";

/** Parse a record date value; null for blank, invalid, or sentinel dates. */
export function parseRecDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v);
  // "0001-01-01T00:00:00" is the cleared-date sentinel.
  if (s.startsWith("0001")) return null;
  // Date-only strings must parse LOCAL (see date-only-local-parse rule).
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00" : s);
  if (isNaN(d.getTime())) return null;
  if (d.getFullYear() < 1950) return null; // legacy sentinel years
  return d;
}

type AnyRec = Record<string, unknown> | object | null | undefined;

function isClosedRec(rec: AnyRec): boolean {
  const r = rec as any;
  // An explicit Closed flag wins when present — the Status regex is only a
  // fallback ("Closeout" is also a phase name and must never flip an active
  // record onto its ActualCompletionDate).
  if (r?.Closed === true) return true;
  if (r?.Closed === false) return false;
  const s = String(r?.Status ?? "");
  return isClosedishStatus(s);
}

/** Effective start date: first phase start, else Target Start. */
export function effStart(rec: AnyRec): Date | null {
  const r = rec as any;
  return parseRecDate(r?._ScheduleStart) ?? parseRecDate(r?.TargetStartDate);
}

/**
 * Effective end date: last phase end, else Target Completion (OPM records
 * additionally fall back to CloseDate → BidDueDate). For closed records a
 * recorded ActualCompletionDate wins.
 */
export function effEnd(rec: AnyRec, opts?: { closed?: boolean }): Date | null {
  const r = rec as any;
  const closed = opts?.closed ?? isClosedRec(rec);
  if (closed) {
    const a = parseRecDate(r?.ActualCompletionDate);
    if (a) return a;
  }
  return (
    parseRecDate(r?._ScheduleEnd) ??
    parseRecDate(r?.TargetCompletionDate) ??
    parseRecDate(r?.CloseDate) ??
    parseRecDate(r?.BidDueDate)
  );
}

/** True when the record's effective start is today or in the past. */
export function effStarted(rec: AnyRec, today?: Date): boolean {
  const r = rec as any;
  // An explicit recorded actual start always counts as started.
  if (parseRecDate(r?.ActualStartDate)) return true;
  const s = effStart(rec);
  if (!s) return false;
  return s.getTime() <= (today ?? new Date()).getTime();
}
