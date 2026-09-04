// ─────────────────────────────────────────────────────────────────────────────
// manualStatusLatch — should a manually chosen stored Status DISPLAY over the
// schedule-derived current phase?
//
// The server's auto-advance has a "manual latch": a human save stamps
// PMM/Opportunity.StatusManualDate, and automation never overwrites the status
// while that stamp's UTC calendar day is on/after the start DAY of the
// schedule's last-STARTED phase (the catch-up target). Display surfaces that
// derive the shown status from the schedule (Quick Actions hub card +
// landing/search cards) must honor the SAME rule, or a saved manual change
// looks like it silently failed: the DB row updates but the card keeps
// showing the date-derived phase.
//
// Comparison semantics deliberately MIRROR the server (rds-provider
// auto-advance): the manual stamp is normalized to its UTC "YYYY-MM-DD" day
// and compared against the phase's schedule day STRING — never against a
// browser-local midnight instant, which flips the decision near midnight in
// non-UTC timezones.
//
// Rule:
//   • no usable StatusManualDate            → schedule-derived phase wins
//   • no phase has started yet              → the human choice stands
//     (auto-advance skips "schedule not started", so nothing will fight it)
//   • manual UTC day >= last-started
//     phase's start day                     → the human choice stands
//   • older stamp (a NEWER phase has since
//     started)                              → schedule-derived phase wins
//     (auto-advance will re-stamp the record forward on its next pass)
// ─────────────────────────────────────────────────────────────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today as a LOCAL "YYYY-MM-DD" calendar day — schedule days are calendar
 *  days, and this matches how the displayed derived phase itself is chosen
 *  (currentSchedulePhase / currentPhaseOf use local now). */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** StatusManualDate → its UTC "YYYY-MM-DD" day, exactly like the server's
 *  latch check ("" when missing/invalid/sentinel). */
function manualUtcDay(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim();
  if (!s || s.startsWith("0001")) return "";
  const md = new Date(s);
  if (isNaN(md.getTime()) || md.getUTCFullYear() <= 2000) return "";
  return md.toISOString().slice(0, 10);
}

/**
 * True when a human's manual status choice (StatusManualDate) should be
 * displayed instead of the schedule-derived current phase.
 *
 * @param manualRaw      raw StatusManualDate value from the record payload
 * @param phaseStartDays schedule-day strings ("YYYY-MM-DD"; longer ISO values
 *                       are truncated) of the record's phases; invalid
 *                       entries are ignored
 * @param todayDay       local calendar day used to decide which phases have
 *                       started (defaults to today)
 */
export function manualStatusWins(
  manualRaw: unknown,
  phaseStartDays: string[],
  todayDay: string = localToday(),
): boolean {
  const manualDay = manualUtcDay(manualRaw);
  if (!manualDay) return false;
  let lastStarted = "";
  for (const raw of phaseStartDays) {
    const day = String(raw ?? "").slice(0, 10);
    if (!DAY_RE.test(day) || day <= "2000-12-31" || day > todayDay) continue;
    if (day > lastStarted) lastStarted = day;
  }
  // Schedule hasn't started (or has no dated phases): auto-advance skips such
  // records, so the manual choice is the standing truth.
  if (!lastStarted) return true;
  return manualDay >= lastStarted;
}
