/**
 * Pure, DB-free decision logic for the saveWeeklyHoursRds team-membership guard.
 *
 * Extracted so unit tests can cover the NOT_ON_TEAM guard without a live
 * database. The full implementation in saveWeeklyHoursRds calls this function
 * after it has probed ResourceWorkItems and ResourceAllocation:
 *
 *   const decision = resolveWeeklyHoursMembership({
 *     rwiRowCount: rwiRes.recordset?.length ?? 0,
 *     raRowCount:  raProbe.recordset?.length ?? 0,
 *   });
 *   if (decision === "not_on_team") {
 *     skippedNotOnTeam.push(personId);
 *     continue;
 *   }
 *   // "heal_ra_only" → create a new RWI
 *   // "proceed"      → use the existing RWI
 */

export type WeeklyHoursMembership = "proceed" | "heal_ra_only" | "not_on_team";

const DAY_MS = 86_400_000;

function parseWeeklyHoursNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

function strictIsoDay(value: unknown): { utc: number; ymd: string } | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/,
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const parsed = new Date(utc);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return null;
  return { utc, ymd: `${match[1]}-${match[2]}-${match[3]}` };
}

/**
 * Resolve a legacy/sub-week date window to exactly one Monday→Sunday week.
 *
 * A malformed historical "weekly" row can be stored as Wed→Tue. Treating that
 * row as an ordinary overlap makes its full hours appear in TWO Monday columns.
 * Prefer a Monday contained inside the row (Wed→Tue therefore belongs to the
 * following Monday); when the short row contains no Monday, use the Monday of
 * the calendar week containing its start date.
 */
export function canonicalMondayWeekWindow(
  startValue: unknown,
  endValue: unknown,
): { startYmd: string; endYmd: string } | null {
  const start = strictIsoDay(startValue);
  const end = strictIsoDay(endValue);
  if (start === null || end === null || end.utc < start.utc) return null;

  const startDay = new Date(start.utc).getUTCDay(); // Sun=0, Mon=1, ...
  const daysBackToMonday = (startDay + 6) % 7;
  const mondayOnOrBefore = start.utc - daysBackToMonday * DAY_MS;
  const daysForwardToMonday = (8 - startDay) % 7;
  const mondayOnOrAfter = start.utc + daysForwardToMonday * DAY_MS;
  const monday = mondayOnOrAfter <= end.utc
    ? mondayOnOrAfter
    : mondayOnOrBefore;
  const sunday = monday + 6 * DAY_MS;

  return {
    startYmd: new Date(monday).toISOString().slice(0, 10),
    endYmd: new Date(sunday).toISOString().slice(0, 10),
  };
}

/**
 * Canonicalize one posted weekly-hours row before validation or persistence.
 *
 * AllocationHour is the authoritative weekly value whenever the caller
 * explicitly supplies it, including 0 for a clear. PctAllocation is only a
 * compatibility fallback for older callers that do not send AllocationHour.
 * Both fields are then mirrored to the same value so a stale whole-assignment
 * total (for example AllocationHour=4 with PctAllocation=602) can never block
 * or corrupt a valid weekly replacement.
 */
export function canonicalizeWeeklyHoursRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const rawHour = row.AllocationHour;
  const hasExplicitHour =
    Object.prototype.hasOwnProperty.call(row, "AllocationHour") &&
    rawHour !== null &&
    rawHour !== undefined &&
    !(typeof rawHour === "string" && rawHour.trim() === "");
  const numeric = parseWeeklyHoursNumber(
    hasExplicitHour ? rawHour : row.PctAllocation,
  );
  if (numeric === null) {
    throw new Error(
      "INVALID_WEEKLY_HOURS: weekly hours must be a finite number.",
    );
  }
  return {
    ...row,
    AllocationHour: numeric,
    PctAllocation: numeric,
  };
}

/**
 * Validate a canonical weekly row before saveWeeklyHoursRds starts its
 * transaction. Positive rows must identify a real ISO calendar window between
 * one and seven inclusive days. Zero rows are clear instructions and may carry
 * incomplete legacy date metadata because they are never inserted.
 */
export function validateCanonicalWeeklyHoursRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const hours = parseWeeklyHoursNumber(row.AllocationHour);
  if (hours === null) {
    throw new Error(
      "INVALID_WEEKLY_HOURS: weekly hours must be a finite number.",
    );
  }
  if (hours < 0 || hours > 168) {
    const week = String(row.AllocationStartDate ?? "").slice(0, 10);
    throw new Error(
      `INVALID_WEEKLY_HOURS: rejected ${hours}h for ${week || "an unknown week"}; ` +
      "a person-week must be between 0 and 168 hours.",
    );
  }
  if (hours === 0) return row;

  const start = strictIsoDay(row.AllocationStartDate);
  const end = strictIsoDay(row.AllocationEndDate);
  if (start === null || end === null) {
    throw new Error(
      "INVALID_WEEKLY_DATE: positive weekly hours require real ISO start and end dates.",
    );
  }
  const inclusiveDays = Math.round((end.utc - start.utc) / DAY_MS) + 1;
  if (inclusiveDays < 1 || inclusiveDays > 7) {
    throw new Error(
      "INVALID_WEEKLY_DATE: a weekly allocation row must span between 1 and 7 days.",
    );
  }
  const canonicalWeek = canonicalMondayWeekWindow(start.ymd, end.ymd);
  if (canonicalWeek === null) {
    throw new Error(
      "INVALID_WEEKLY_DATE: a weekly allocation row must resolve to one Monday week.",
    );
  }
  // Persist the same exact calendar days that passed validation. This avoids a
  // later permissive Date parser interpreting offsets or malformed suffixes
  // differently after the full-replacement clear has begun. Weekly identity is
  // always Monday→Sunday, even when a historical client submitted Wed→Tue.
  return {
    ...row,
    AllocationStartDate: `${canonicalWeek.startYmd}T00:00:00`,
    AllocationEndDate: `${canonicalWeek.endYmd}T00:00:00`,
  };
}

/**
 * Three-way team-membership decision for saveWeeklyHoursRds.
 *
 *  rwiRowCount > 0  →  "proceed"      existing team member; use their RWI row
 *  rwiRowCount = 0,
 *  raRowCount  > 0  →  "heal_ra_only" RA-only legacy member; create a minimal RWI
 *  both = 0         →  "not_on_team"  removed/ghost member; refuse with an error
 *
 * @param counts Row counts from the live DB probes. Both must come from
 *   queries scoped to the same (tenantId, personId, projectId) triple with
 *   Deleted = 0 filtering applied.
 */
export function resolveWeeklyHoursMembership(counts: {
  rwiRowCount: number;
  raRowCount: number;
}): WeeklyHoursMembership {
  if (counts.rwiRowCount > 0) return "proceed";
  if (counts.raRowCount > 0) return "heal_ra_only";
  return "not_on_team";
}

/**
 * Build the Error thrown by saveWeeklyHoursRds when EVERY person in the posted
 * payload was refused (all had no active RWI and no active RA row).
 *
 * The message must:
 *  - Start with "NOT_ON_TEAM" (clients parse this prefix to show a specific UI).
 *  - Explain that hours were not saved.
 *  - Tell the user to refresh (the page state is stale).
 */
export function buildNotOnTeamError(): Error {
  return new Error(
    "NOT_ON_TEAM: that person no longer has an assignment on this record — " +
    "hours were not saved. Refresh the page and try again.",
  );
}

/**
 * Client-side parser: if the server error message carries the NOT_ON_TEAM
 * prefix, return a friendly, human-readable explanation. Returns null when the
 * error is unrelated to team membership so callers can fall through to their
 * default error display.
 *
 * The prefix may arrive verbatim or embedded in a JSON/HTTP wrapper (e.g.
 * "502: {\"error\":\"NOT_ON_TEAM: …\"}") so we search for it anywhere in the
 * message string rather than requiring it at position 0.
 */
export function parseNotOnTeamMessage(rawMessage: string): string | null {
  if (!rawMessage.includes("NOT_ON_TEAM")) return null;
  return (
    "This person was removed from the project in another session. " +
    "Refresh to see the updated team before editing hours."
  );
}

// ── Past-week editing policy ──────────────────────────────────────────────────

/**
 * Resolved past-week editing policy for a single record type (PMM or OPM).
 * Derived from the tenant's OnboardingDefaults by `resolvePastWeekPolicy`.
 */
export interface PastWeekPolicy {
  /** Whether past-week editing is enabled at all. */
  allow: boolean;
  /**
   * Maximum number of past weeks that may be edited. null = unlimited.
   * Ignored when allow is false.
   */
  limitWeeks: number | null;
}

/**
 * Derive the effective past-week editing policy for a project or opportunity.
 * Projects (PMM) and Opportunities (OPM) carry independent settings in
 * OnboardingDefaults.
 *
 * @param defaults Effective merged OnboardingDefaults for the tenant.
 * @param isOPM    True when the record is an opportunity (TicketId starts with
 *                 "OPM"); false for all project types (PMM, custom prefixes).
 */
export function resolvePastWeekPolicy(
  defaults: {
    allowPastDateEdit: boolean;
    pastEditLimitWeeks: number | null;
    oppAllowPastDateEdit: boolean;
    oppPastEditLimitWeeks: number | null;
  },
  isOPM: boolean,
): PastWeekPolicy {
  if (isOPM) {
    return {
      allow: defaults.oppAllowPastDateEdit,
      limitWeeks: defaults.oppPastEditLimitWeeks,
    };
  }
  return {
    allow: defaults.allowPastDateEdit,
    limitWeeks: defaults.pastEditLimitWeeks,
  };
}

/**
 * Returns true when the given week is locked under the supplied policy and
 * reference timestamp — meaning the API must reject CHANGED hours for that
 * week (unchanged values may still round-trip).
 *
 * A week is locked when:
 *  - Past editing is fully disabled (`allow = false`) and the week's Monday
 *    predates the current Monday, OR
 *  - Past editing is capped (`allow = true`, `limitWeeks = N`) and the week's
 *    Monday is more than N full weeks before the current Monday.
 *
 * The current week and all future weeks are NEVER locked.
 *
 * @param weekMondayYmd Canonical Monday start of the week ("YYYY-MM-DD").
 *   `canonicalMondayWeekWindow` can be used to derive this from any date
 *   within the week before calling this function.
 * @param policy        Resolved past-edit policy for this record type.
 * @param nowUtc        Reference timestamp (ms since epoch). Defaults to
 *   `Date.now()`. Inject a fixed value in unit tests.
 */
export function isWeekLockedByPolicy(
  weekMondayYmd: string,
  policy: PastWeekPolicy,
  nowUtc: number = Date.now(),
): boolean {
  // Fully-open policy: unlimited past editing → nothing is ever locked.
  if (policy.allow && policy.limitWeeks === null) return false;

  const weekStart = strictIsoDay(weekMondayYmd);
  if (!weekStart) return false; // malformed — let downstream validation handle it

  // Determine the "current Monday" using UTC-12 (the most western real-world
  // timezone, equivalent to Baker Island / Howland Island). Week date strings
  // in the DB are LOCAL Monday calendar dates derived by the client's browser.
  // A UTC-based server incorrectly treats them as past once UTC crosses into
  // the next Monday, while users in UTC-8 to UTC-12 are still in Sunday local
  // time (their "current week" still starts on the previous Monday).
  //
  // Using UTC-12 as the reference eliminates false positives for any user in
  // any real-world timezone: a week that appears past even from UTC-12's
  // perspective is genuinely past for everyone. The trade-off is a small
  // false-negative window (≤ 26 h) for far-east users, which is acceptable
  // because the server guard is a safety net, not the primary enforcement layer
  // — the client-side guard fires first for legitimate browser clients.
  const UTC_MINUS_12_MS = 12 * 60 * 60 * 1000;
  const permissiveNow = nowUtc - UTC_MINUS_12_MS;
  const permDate = new Date(permissiveNow);
  const permDow = permDate.getUTCDay(); // day-of-week as seen from UTC-12
  const daysBackToMonday = (permDow + 6) % 7;
  const thisMondayUtc =
    Date.UTC(permDate.getUTCFullYear(), permDate.getUTCMonth(), permDate.getUTCDate()) -
    daysBackToMonday * DAY_MS;

  // Current week and future weeks are always editable.
  if (weekStart.utc >= thisMondayUtc) return false;

  // Past week: check the policy.
  if (!policy.allow) return true; // editing disabled → all past weeks locked

  // allow=true with a week cap: locked when the week is strictly beyond the limit.
  // weeksBack is exact (both values are UTC Monday midnight).
  const weeksBack = Math.round((thisMondayUtc - weekStart.utc) / (7 * DAY_MS));
  return weeksBack > policy.limitWeeks!;
}

/**
 * Build the Error thrown (and surfaced as HTTP 423) when a weekly-hours save
 * attempts to CHANGE hours for a locked past week. Unchanged values are
 * permitted to round-trip.
 *
 * The LOCKED_PAST_WEEK prefix is parsed by the route error handler to produce
 * a structured 423 response distinct from a generic 502.
 */
export function buildLockedPastWeekError(weekYmd: string): Error {
  return new Error(
    `LOCKED_PAST_WEEK: the tenant settings do not allow editing past-week hours ` +
    `(week of ${weekYmd}). Unchanged values may pass through; ` +
    `only new or changed hours are blocked.`,
  );
}

/**
 * Build the Error thrown (and surfaced as HTTP 503) when the tenant's
 * Settings cannot be read at save time, so the past-week edit policy cannot
 * be evaluated. The guard FAILS CLOSED: substituting permissive built-in
 * defaults would let a configured lock be bypassed whenever the Settings
 * read fails (cache miss + DB outage), so the save is rejected as retryable
 * instead of silently skipping enforcement.
 *
 * The PAST_WEEK_POLICY_UNAVAILABLE prefix is parsed by the route error
 * handler to produce a structured 503 response distinct from a generic 502.
 */
export function buildPolicyUnavailableError(cause: unknown): Error {
  const causeText = String(cause ?? "unknown").slice(0, 200);
  return new Error(
    `PAST_WEEK_POLICY_UNAVAILABLE: tenant settings could not be read to ` +
    `evaluate the past-week edit policy, so hours were not saved. ` +
    `Please retry in a moment. (cause: ${causeText})`,
  );
}

/**
 * Resolve the tenant's business rules for past-week enforcement, converting
 * ANY load failure into the fail-closed PAST_WEEK_POLICY_UNAVAILABLE error
 * (mapped to HTTP 503 by the route). Callers must pass a STRICT loader that
 * propagates settings-store failures — never one that substitutes permissive
 * defaults — or the fail-closed guarantee is silently lost.
 */
export async function resolvePastWeekRulesOrThrow<T>(
  strictLoad: () => Promise<T>,
): Promise<T> {
  try {
    return await strictLoad();
  } catch (cause) {
    throw buildPolicyUnavailableError(cause);
  }
}
