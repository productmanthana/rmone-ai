/**
 * Pure safety rules for consolidating old duplicate assignment identities.
 *
 * A duplicate ResourceWorkItem is never enough on its own to justify a merge:
 * the allocation periods must have a single unambiguous weekly history. This
 * module deliberately treats overlapping, unequal positive rows as a conflict
 * rather than attempting to add, overwrite, or guess at their intended hours.
 */

export interface LegacyAssignmentPeriodRow {
  id: number;
  rwiId: number;
  start: string | null;
  end: string | null;
  hours: number;
}

export interface LegacyPeriodConflict {
  kind: "locked" | "missing_dates" | "overlapping_hours";
  message: string;
  rows: number[];
}

export interface LegacyPeriodAnalysis {
  canonicalRwiId: number;
  duplicateAllocationIds: number[];
  mergedHours: number;
  rawHours: number;
  conflicts: LegacyPeriodConflict[];
  mergeable: boolean;
}

const EPSILON = 0.0001;

function dayOf(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
}

function sameHours(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

/**
 * Selects the newest assignment identity as the canonical target, de-duplicates
 * exact copies of the same dated period, and detects every case where a person
 * could have two different positive hour values for the same time.
 */
export function analyzeLegacyAssignmentPeriods(input: {
  assignmentIds: number[];
  rows: LegacyAssignmentPeriodRow[];
  locked: boolean;
}): LegacyPeriodAnalysis {
  const assignmentIds = [...new Set(input.assignmentIds)].sort((a, b) => a - b);
  const canonicalRwiId = assignmentIds.at(-1) ?? 0;
  const rows = input.rows
    .filter(row => assignmentIds.includes(row.rwiId))
    .map(row => ({ ...row, hours: Number(row.hours) || 0 }));
  const conflicts: LegacyPeriodConflict[] = [];
  const duplicateAllocationIds: number[] = [];

  if (input.locked) {
    conflicts.push({
      kind: "locked",
      message: "One or more periods are locked. Unlock them before consolidating this assignment.",
      rows: [],
    });
  }

  const positive = rows.filter(row => row.hours > EPSILON);
  for (const row of positive) {
    if (dayOf(row.start) == null || dayOf(row.end) == null) {
      conflicts.push({
        kind: "missing_dates",
        message: "A positive-hours period has no usable start and end date.",
        rows: [row.id],
      });
    }
  }

  // Exact spans with equal hours are duplicate copies. Keep the canonical RWI's
  // copy where possible; otherwise retain the oldest physical allocation row.
  const exact = new Map<string, LegacyAssignmentPeriodRow[]>();
  for (const row of positive) {
    const start = dayOf(row.start);
    const end = dayOf(row.end);
    if (start == null || end == null) continue;
    const key = `${start}|${end}`;
    const group = exact.get(key) ?? [];
    group.push(row);
    exact.set(key, group);
  }
  for (const group of exact.values()) {
    const values = [...new Set(group.map(row => row.hours.toFixed(4)))];
    if (values.length > 1) {
      conflicts.push({
        kind: "overlapping_hours",
        message: "The same dated period has different positive hour values.",
        rows: group.map(row => row.id),
      });
      continue;
    }
    if (group.length > 1) {
      const keeper = [...group].sort((a, b) =>
        Number(b.rwiId === canonicalRwiId) - Number(a.rwiId === canonicalRwiId) || a.id - b.id,
      )[0];
      duplicateAllocationIds.push(...group.filter(row => row.id !== keeper.id).map(row => row.id));
    }
  }

  // Different date spans that overlap are only safe if they are the exact
  // duplicate copies handled above. This prevents a broad legacy total from
  // being silently combined with a narrower manual-week override.
  for (let i = 0; i < positive.length; i++) {
    const a = positive[i];
    const aStart = dayOf(a.start);
    const aEnd = dayOf(a.end);
    if (aStart == null || aEnd == null) continue;
    for (let j = i + 1; j < positive.length; j++) {
      const b = positive[j];
      if (a.rwiId === b.rwiId) continue;
      const bStart = dayOf(b.start);
      const bEnd = dayOf(b.end);
      if (bStart == null || bEnd == null) continue;
      const exactSame = aStart === bStart && aEnd === bEnd;
      if (!exactSame && Math.max(aStart, bStart) <= Math.min(aEnd, bEnd)) {
        conflicts.push({
          kind: "overlapping_hours",
          message: "Two legacy assignments have positive hours across overlapping periods.",
          rows: [a.id, b.id],
        });
      }
    }
  }

  const duplicateIds = new Set(duplicateAllocationIds);
  const rawHours = rows.reduce((sum, row) => sum + row.hours, 0);
  const mergedHours = rows
    .filter(row => !duplicateIds.has(row.id))
    .reduce((sum, row) => sum + row.hours, 0);
  return {
    canonicalRwiId,
    duplicateAllocationIds: [...duplicateIds],
    rawHours,
    mergedHours,
    conflicts,
    mergeable: conflicts.length === 0 && assignmentIds.length > 1,
  };
}