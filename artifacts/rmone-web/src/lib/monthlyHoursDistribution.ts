/**
 * monthlyHoursDistribution — pure math for the Monthly workload editor.
 *
 * The user enters ONE number: the person's TOTAL hours on a project for a
 * calendar month. This module turns that total into per-week hour patches:
 *
 *   • Month → weeks attribution matches the display exactly (the caller
 *     supplies the same Mon-start weeks the monthly bars aggregate), so what
 *     you edit is always what you saw.
 *   • Weeks locked by past-week editing rules are NEVER touched — their
 *     current hours stay and count toward the monthly total.
 *   • The remainder (total − locked hours) is spread evenly across the
 *     editable weeks with remainder-carry rounding at 0.1h precision, so the
 *     written weeks sum EXACTLY to the remainder (e.g. 40h over 3 weeks →
 *     13.3 / 13.3 / 13.4, never 39.9 or 40.2).
 *   • Per-week caps are enforced here for a friendly early error; the save
 *     path re-validates via weeklyHoursValidation regardless.
 *
 * Weekly rows remain the single source of truth — this is a convenience input
 * layered on the existing weekly save, not a new storage model.
 */

/** One Mon-start week inside the edited month. */
export interface MonthWeekSlot {
  /** ISO "YYYY-MM-DD" local Monday — the weekly-save week key. */
  iso: string;
  /** Current hours for this person+project in this week. */
  hours: number;
  /** True when past-week editing rules forbid changing this week. */
  locked: boolean;
}

export type MonthlyDistribution =
  | {
      ok: true;
      /** week ISO → new hours for EDITABLE weeks only (locked weeks omitted). */
      patches: Record<string, number>;
      /** Editable-week shares in week order — for the live preview. */
      shares: { iso: string; hours: number }[];
      /** Hours sitting in locked weeks (unchanged, counted toward the total). */
      lockedHours: number;
      lockedWeeks: number;
    }
  | { ok: false; error: string };

const round1 = (n: number) => Math.round(n * 10) / 10;

export function planMonthlyDistribution(
  weeks: MonthWeekSlot[],
  target: number,
  maxWeekHours: number,
): MonthlyDistribution {
  if (!Number.isFinite(target) || target < 0) {
    return { ok: false, error: "Enter a valid number of hours (0 or more)." };
  }
  if (weeks.length === 0) {
    return { ok: false, error: "This month has no weeks inside the project window." };
  }
  const lockedList = weeks.filter(w => w.locked);
  const editable = weeks.filter(w => !w.locked);
  const lockedHours = round1(lockedList.reduce((t, w) => t + w.hours, 0));
  if (editable.length === 0) {
    return { ok: false, error: "Every week in this month is locked by your past-week editing rules." };
  }
  const remainder = round1(target - lockedHours);
  if (remainder < 0) {
    return {
      ok: false,
      error: `${lockedHours}h already sit in locked past weeks of this month — the monthly total can't go below ${lockedHours}h.`,
    };
  }
  const patches: Record<string, number> = {};
  const shares: { iso: string; hours: number }[] = [];
  let left = remainder;
  for (let i = 0; i < editable.length; i++) {
    const share = round1(left / (editable.length - i));
    if (share > maxWeekHours) {
      return {
        ok: false,
        error: `That total needs more than ${maxWeekHours}h in a single week — the cap is ${maxWeekHours}h per week (max ${round1(lockedHours + maxWeekHours * editable.length)}h for this month).`,
      };
    }
    patches[editable[i].iso] = share;
    shares.push({ iso: editable[i].iso, hours: share });
    left = round1(left - share);
  }
  return { ok: true, patches, shares, lockedHours, lockedWeeks: lockedList.length };
}
