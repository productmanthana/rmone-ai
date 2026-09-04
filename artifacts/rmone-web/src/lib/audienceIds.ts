/**
 * Per-user audience sentinel ids — web mirror of the server helpers in
 * api-server/src/lib/access-control.ts.
 *
 * "Only specific people" audiences store user sentinels ("user:<lowercased
 * rmone_users id>") in the SAME lists that hold group ids and org sentinels
 * (org:bu/div/dept). No new storage or matching machinery: the server adds
 * each viewer's own sentinel to every membership set it exposes/resolves, so
 * group / org-unit / person audiences all match through one code path.
 */

export const USER_AUDIENCE_PREFIX = "user:";

export function isUserAudienceId(id: unknown): boolean {
  return String(id ?? "").trim().toLowerCase().startsWith(USER_AUDIENCE_PREFIX);
}

/** The sentinel id for a user — ALWAYS lowercased so it matches stored lists
 *  (rule sanitizers lowercase every audience id on save). */
export function userAudienceId(userId: string): string {
  return USER_AUDIENCE_PREFIX + String(userId ?? "").trim().toLowerCase();
}

export type PersonOption = { value: string; label: string };

/** Neutral slate dot — person chips read differently from colored groups. */
export const PERSON_DOT_COLOR = "#64748b";

/** People → MultiPick options with sentinel values ("user:<id>"). */
export function personAudienceOptions(
  people: PersonOption[] | null | undefined,
): { value: string; label: string; color: string }[] {
  return (people ?? []).map((p) => ({
    value: userAudienceId(p.value),
    label: p.label,
    color: PERSON_DOT_COLOR,
  }));
}

/** Resolve an audience id to a display name: group name, person name, or a
 *  placeholder. Shared by scope labels that summarize saved audiences. */
export function audienceIdName(
  id: string,
  groups: { id: string; name: string }[],
  people?: PersonOption[] | null,
): string {
  const g = groups.find((x) => x.id === id);
  if (g) return g.name;
  if (isUserAudienceId(id)) {
    const low = String(id).trim().toLowerCase();
    const p = (people ?? []).find((x) => userAudienceId(x.value) === low);
    if (p) return p.label;
  }
  return "…";
}
