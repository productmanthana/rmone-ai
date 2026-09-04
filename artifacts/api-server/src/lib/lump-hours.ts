// ─────────────────────────────────────────────────────────────────────────────
// Lump ("Total Hours") row classification for assignResourceRds Step 1b.
//
// When the Edit Assignment modal sends AllocationHour (direct total-hours edit,
// no phase schedule), the save must REPLACE the member's existing lump/container
// RA row — never stack a new one. The old SQL predicate only matched rows that
// were empty OR spanned > 30 days, so on a short (≤ 30 day) assignment the lump
// row created by the previous save (hours > 0, span ≤ 30d) matched nothing and
// the insert fallback stacked a fresh row on every save (verified in prod:
// three active rows 15h + 35h + 62h for the same Jul 8–28 span → 112h shown).
//
// The fix: classification happens here, in pure TS, over the RWI's active RA
// rows as they stand AFTER Step 1's date updates. A row is a lump CANDIDATE if:
//   - it is empty (AllocationHour NULL or 0) — the classic container row, or
//   - its span EXACTLY equals the assignment's new window, or
//   - its span EXACTLY equals the RWI's pre-update window (a short lump row
//     written by a previous save carries exactly that span, and Step 1 leaves
//     its dates untouched when the span is ≤ 30 days).
// Weekly breakdown rows (hours > 0 with their own week-sized spans) match none
// of these and are NEVER updated or zeroed here.
//
// Exactly ONE candidate receives the new total (prefer rows already holding
// hours, then the most recent by ID); every OTHER candidate still holding
// hours is zeroed — this also self-heals rows already stacked by the old bug.
// No candidates at all → caller inserts a fresh container row (pure-import
// members never had one).
//
// This module is intentionally dependency-free so the check script
// (scripts/check-lump-hours.ts, chained into check:hours-win) can import the
// REAL implementation without pulling in the DB pool.
// ─────────────────────────────────────────────────────────────────────────────

export interface LumpRowInput {
  /** ResourceAllocation.ID */
  id: number;
  /** AllocationHour (null when the column is NULL) */
  hour: number | null;
  /** PctAllocation (null when NULL) — informational only */
  pct: number | null;
  start: Date | null;
  end: Date | null;
  /** false = this row may be ZEROED but must never become the update target
   *  (replace-all pulls the person's legacy null-lookup RA rows into the net
   *  purely for cleanup — writing the new total onto one of them would detach
   *  the hours from the RWI being edited, or clobber a distinct legacy
   *  assignment). Absent/true = normal target-RWI row. */
  targetable?: boolean;
}

export interface LumpWindow {
  /** RWI StartDate/EndDate BEFORE Step 1 updated them */
  oldStart: Date | null;
  oldEnd: Date | null;
  /** The window this save is writing */
  newStart: Date | null;
  newEnd: Date | null;
}

export interface LumpPlan {
  /** RA row that receives the new total (hours + pct + new window dates) */
  updateId: number | null;
  /** Stale lump rows (hours > 0) to zero — never weekly breakdown rows */
  zeroIds: number[];
  /** No candidate exists — insert a fresh container row */
  insert: boolean;
}

const ms = (d: Date | null | undefined): number | null =>
  d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;

function spanEquals(
  s1: Date | null, e1: Date | null,
  s2: Date | null, e2: Date | null,
): boolean {
  const a = ms(s1), b = ms(e1), c = ms(s2), d = ms(e2);
  return a != null && b != null && c != null && d != null && a === c && b === d;
}

export interface LumpOptions {
  /** REPLACE-ALL mode (Edit Assignment "replace" semantics, Aug 2026): the
   *  entered total is the member's WHOLE truth for this assignment, so every
   *  other active row still holding hours — INCLUDING weekly breakdown rows —
   *  is zeroed. Exactly one row survives with the new total. Without this
   *  flag weekly rows are never touched (legacy/period-safe behavior). */
  replaceAll?: boolean;
}

export function classifyLumpRows(rows: LumpRowInput[], win: LumpWindow, opts?: LumpOptions): LumpPlan {
  const replaceAll = opts?.replaceAll === true;
  const candidates = rows.filter((r) => {
    if (r.targetable === false) return false; // zero-only row, never the target
    if (r.hour == null || r.hour === 0) return true; // empty container / zeroed row
    return (
      spanEquals(r.start, r.end, win.newStart, win.newEnd) ||
      spanEquals(r.start, r.end, win.oldStart, win.oldEnd)
    );
  });
  if (candidates.length === 0) {
    return {
      updateId: null,
      // Replace-all: the fresh insert becomes the ONLY active row — zero the
      // weekly/import rows that used to carry the hours (they stacked with the
      // inserted lump otherwise: verified in prod, 204h of weekly rows + a
      // 208h lump both shown as separate periods).
      zeroIds: replaceAll ? rows.filter((r) => (r.hour ?? 0) > 0).map((r) => r.id) : [],
      insert: true,
    };
  }

  // Prefer a row already holding hours (the lump written by the last save),
  // most recent first, so repeated saves keep converging on one row.
  const sorted = [...candidates].sort((a, b) => {
    const ah = (a.hour ?? 0) > 0 ? 1 : 0;
    const bh = (b.hour ?? 0) > 0 ? 1 : 0;
    if (ah !== bh) return bh - ah;
    return b.id - a.id;
  });
  const chosen = sorted[0]!;
  const zeroIds = replaceAll
    ? rows.filter((r) => r.id !== chosen.id && (r.hour ?? 0) > 0).map((r) => r.id)
    : sorted.slice(1).filter((r) => (r.hour ?? 0) > 0).map((r) => r.id);
  return { updateId: chosen.id, zeroIds, insert: false };
}
