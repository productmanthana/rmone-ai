/**
 * Pure helper: locate the allocation row for ONE person from the full project
 * grid returned by getFullProjectAllocations.
 *
 * GUID match wins outright and is checked across ALL rows before any name
 * matching begins. A row carrying a DIFFERENT person GUID is refused even when
 * the display names are identical (tenants can hold duplicate same-name
 * accounts — a name-first match returns the wrong account's row and silently
 * re-adds someone the user never picked). The GUID guard only fires when BOTH
 * sides are GUID-shaped; some tenants store display names in the id columns, so
 * a mismatch between a GUID resourceId and a display-name id field is
 * meaningless and must not block name matching.
 *
 * Mirrors matchMemberAlloc in artifacts/rmone-web/src/lib/phaseHours.ts — keep
 * the two in sync when changing the matching algorithm.
 */

export interface AllocRow {
  AssignedTo?: string | null;
  ResourceId?: string | null;
  ResourceID?: string | null;
  AssignedToName?: string | null;
  FirstName?: string | null;
  LastName?: string | null;
  ResourceName?: string | null;
  [key: string]: unknown;
}

const GUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rowPersonId(ea: AllocRow): string {
  return String(ea.ResourceId ?? ea.ResourceID ?? ea.AssignedTo ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Find the allocation row for `person` inside `rows`.
 *
 * @param rows  Flat list of allocation rows (ExistingAllocations or NewAllocations).
 * @param person  The person to locate — name + optional GUID resourceId.
 * @returns The matched row, or undefined when not found.
 */
export function findPersonRow(
  rows: AllocRow[],
  person: { name: string; resourceId?: string | null },
): AllocRow | undefined {
  const resId = (person.resourceId ?? "").trim().toLowerCase();
  const normTarget = person.name.trim().toLowerCase();
  const normWords = normTarget.split(/\s+/).filter(Boolean);

  const idMatchFn = (ea: AllocRow): boolean =>
    resId !== "" && rowPersonId(ea) === resId;

  const nameMatchFn = (ea: AllocRow): boolean => {
    const rid = rowPersonId(ea);
    // Refuse name-matching when both sides are GUID-shaped but differ.
    if (GUID_SHAPE.test(rid) && GUID_SHAPE.test(resId) && rid !== resId) return false;
    const assignN = (ea.AssignedToName ?? "").trim().toLowerCase();
    if (assignN && assignN === normTarget) return true;
    const full = `${ea.FirstName ?? ""} ${ea.LastName ?? ""}`.trim().toLowerCase();
    const resName = (ea.ResourceName ?? "").trim().toLowerCase();
    if (full && full === normTarget) return true;
    if (resName && resName === normTarget) return true;
    const fullWords = (assignN || full).split(/\s+/).filter(Boolean);
    if (
      normWords.length >= 2 &&
      fullWords.length >= 2 &&
      normWords[0] === fullWords[0] &&
      normWords[normWords.length - 1] === fullWords[fullWords.length - 1]
    )
      return true;
    return false;
  };

  return rows.find(idMatchFn) ?? rows.find(nameMatchFn);
}
