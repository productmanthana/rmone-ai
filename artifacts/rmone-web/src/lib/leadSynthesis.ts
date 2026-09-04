// ── Team-title lead synthesis — ONE definition for every surface ────────────
// The record page's "Project Leads" card synthesises key personnel from team
// members whose project role / job title matches a standard lead label. The
// projects Data Grid mirrors the same card, so the mapping and the additive
// pass live here — page-local copies WILL drift (the card's rules carry
// several hard-won fixes: additive always-run, project role preferred over
// corporate title, `?? candidates[0]` so a member is never dropped just
// because their label is taken).

/** Lowercased project-role / job-title → canonical lead label. */
export const LEAD_TITLE_MAP: Record<string, string> = {
  "project manager":         "Project Manager",
  "pm":                      "Project Manager",
  "senior project manager":  "Senior Project Manager",
  "sr. project manager":     "Senior Project Manager",
  "sr project manager":      "Senior Project Manager",
  "project lead":            "Project Lead",
  "principal engineer":      "Project Lead",
  "principal-in-charge":     "Project Lead",
  "business lead":           "Business Lead",
  "owner":                   "Owner",
  "lead estimator":          "Lead Estimator",
  "estimator":               "Estimator",
  "senior estimator":        "Senior Estimator",
  "sr. estimator":           "Senior Estimator",
  "superintendent":          "Superintendent",
  "lead superintendent":     "Lead Superintendent",
  "program manager":         "Program Manager",
  "senior mep manager":      "Senior MEP Manager",
  // Executive leadership titles (AEC standard: executives on a project are
  // key contacts). Matched from the job title as well as the project role.
  "president":                 "President",
  "executive vice president":  "Executive Vice President",
  "evp":                       "Executive Vice President",
  "senior vice president":     "Senior Vice President",
  "svp":                       "Senior Vice President",
  "vice president":            "Vice President",
  "vp":                        "Vice President",
  "project executive":         "Project Executive",
  "principal":                 "Principal",
  "associate vice president":  "Associate Vice President",
  "avp":                       "Associate Vice President",
};

/** Minimal team-member shape the synthesis needs (structural subset of
 *  ProjectTeamMember so both the detail page and the grid can pass their
 *  own row types). */
export interface LeadSynthMember {
  name?: string;
  /** The member's role ON THIS PROJECT (preferred over the job title). */
  role?: string;
  /** Corporate job title. */
  title?: string;
  resourceId?: string;
}

export interface SynthesizedLead {
  name: string;
  role: string;
  guid: string;
}

/**
 * Additive team-role fallback used by the Project Leads card (and mirrored by
 * the Data Grid's lead columns): synthesise lead entries from team members
 * whose project role or job title maps to a standard lead label.
 *
 * Rules (do not "simplify" — each guards a past regression):
 *  • ADDITIVE: runs regardless of how many explicit leads exist; only people
 *    already listed explicitly (name match) are skipped.
 *  • Prefers the member's role ON THE PROJECT over their corporate job title.
 *  • Seeds claimed roles from the explicit entries so a synthesised member
 *    prefers an unclaimed label — but `?? candidates[0]` keeps the member
 *    even when every candidate label is already taken.
 *  • `resourceId ?? name` for the guid (empty-string resourceId is kept).
 */
export function synthesizeTeamLeads(
  team: readonly LeadSynthMember[],
  existing: readonly { name: string; role: string }[],
): SynthesizedLead[] {
  const out: SynthesizedLead[] = [];
  if (team.length === 0) return out;
  // People already listed explicitly are never duplicated by the fallback —
  // the explicit, removable entry wins.
  const listedNames = new Set(existing.map((k) => k.name.toLowerCase().trim()));
  // Seed with explicitly-claimed roles so a synthesised member prefers an
  // unclaimed label, but NEVER drop a member just because their label is
  // taken — a second person with the same lead title still shows.
  const seenRoles = new Set<string>(existing.map((k) => k.role));
  for (const member of team) {
    if (!member.name || listedNames.has(member.name.toLowerCase().trim())) continue;
    const titleKey = (member.title ?? "").toLowerCase().trim();
    const roleKey  = (member.role  ?? "").toLowerCase().trim();
    // Prefer the member's role ON THIS PROJECT over their corporate job
    // title (e.g. an Associate Vice President serving as the project's
    // Senior Project Manager should show as Senior PM). If that lead slot is
    // already taken, fall through to the title-derived one; if every
    // candidate label is taken, keep the first candidate anyway.
    const candidates = [LEAD_TITLE_MAP[roleKey], LEAD_TITLE_MAP[titleKey]].filter(Boolean) as string[];
    const matched = candidates.find((c) => !seenRoles.has(c)) ?? candidates[0];
    if (matched) {
      seenRoles.add(matched);
      listedNames.add(member.name.toLowerCase().trim());
      out.push({
        name: member.name,
        role: matched,
        guid: member.resourceId ?? member.name,
      });
    }
  }
  return out;
}
