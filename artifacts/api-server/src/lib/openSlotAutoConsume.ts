// Pure matching logic behind findAutoConsumeOpenSlotRds (rds-provider.ts).
//
// When a manual Add Member save (which never carries ConsumeOpenSlotRaIds)
// adds exactly ONE person, the route looks for a still-open demand slot with
// the same role whose date window overlaps the new assignment, and retires it
// (soft-delete via consumeOpenSlotsRds). That deletion is best-effort and
// invisible to the caller, so a matching bug would silently destroy tracked
// demand — which is why the decision itself lives here as a pure function
// with unit tests, decoupled from the DB fetch.
//
// Contract (mirrors the doc on findAutoConsumeOpenSlotRds):
//  • Role match is case-insensitive and ignores a trailing "(N)" duplicate
//    suffix on the slot side (the demand grouping stamps "Role (2)" onto the
//    second same-role/same-start slot). The caller passes EVERY name the new
//    member carries (TypeName role text, Title, JobTitleName) — any one match
//    counts.
//  • Date overlap is MANDATORY and inclusive (start == slot end still
//    overlaps). If ANY of the four dates is missing or unparseable → no
//    action. Ambiguity fails closed.
//  • Several overlapping same-role slots → return the EARLIEST-STARTING one
//    only; adding one person retires at most one position.

export interface OpenSlotCandidate {
  role: string;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  raIds: number[];
}

/** Normalize a role name for matching: trim, lowercase, strip a trailing
 *  "(N)" duplicate suffix. */
export function normalizeRoleName(s: string | null | undefined): string {
  return String(s ?? "").trim().toLowerCase().replace(/\s*\(\d+\)$/, "");
}

// Strict ISO date / datetime shape: "YYYY-MM-DD" optionally followed by a
// "T"/" " time part and an optional zone. Anything else — trailing junk,
// locale formats, bare years — is rejected. `new Date(str)` alone is NOT
// safe here: it silently normalizes impossible calendar dates ("2026-02-30"
// → Mar 2) and accepts some malformed strings, which would turn garbage
// input into a "valid" overlap window and retire the wrong slot.
const STRICT_DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?)?$/;

/** Parse a date value STRICTLY. Returns the epoch ms, or NaN when the value
 *  is missing, malformed, or not a real calendar date (round-trip validated:
 *  "2026-02-30" → NaN, never Mar 2). Date instances (as the mssql driver
 *  returns) are accepted when finite. */
export function parseDateStrict(v: string | Date | null | undefined): number {
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : NaN;
  }
  if (typeof v !== "string") return NaN;
  const m = STRICT_DATE_RE.exec(v.trim());
  if (!m) return NaN;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  // Calendar round-trip: the components must survive Date.UTC unchanged.
  const cal = new Date(Date.UTC(y, mo - 1, d));
  if (cal.getUTCFullYear() !== y || cal.getUTCMonth() !== mo - 1 || cal.getUTCDate() !== d) return NaN;
  // Time-of-day fields, when present, must be in range (Date would roll over).
  if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59 || (m[6] !== undefined && Number(m[6]) > 59))) return NaN;
  const t = new Date(v.trim()).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Pick the single open slot a new assignment fills, or null when nothing
 * may be retired. See module doc for the full contract.
 */
export function matchAutoConsumeOpenSlot(
  slots: OpenSlotCandidate[],
  roleNames: string[],
  startDate?: string,
  endDate?: string,
): OpenSlotCandidate | null {
  const wanted = new Set(roleNames.map(normalizeRoleName).filter(Boolean));
  if (wanted.size === 0) return null;
  const candidates = slots.filter(
    (s) => wanted.has(normalizeRoleName(s.role)) && s.raIds.length > 0,
  );
  if (candidates.length === 0) return null;
  const s = parseDateStrict(startDate);
  const e = parseDateStrict(endDate);
  // Overlap is MANDATORY: the assignment's own window must be valid (both
  // dates strictly parseable AND not reversed) or nothing may be retired.
  if (!Number.isFinite(s) || !Number.isFinite(e) || s > e) return null;
  const overlapping = candidates.filter((c) => {
    const cs = parseDateStrict(c.startDate);
    const ce = parseDateStrict(c.endDate);
    // Missing/invalid/reversed dates on the slot side → that slot is not
    // eligible (fail closed).
    if (!Number.isFinite(cs) || !Number.isFinite(ce) || cs > ce) return false;
    return s <= ce && cs <= e; // inclusive boundaries
  });
  if (overlapping.length === 0) return null;
  // Several overlapping slots of the same role → retire the earliest-starting
  // one (the most overdue), mirroring how a human would fill the queue.
  const sorted = [...overlapping].sort((a, b) =>
    String(a.startDate).localeCompare(String(b.startDate)),
  );
  return sorted[0];
}
