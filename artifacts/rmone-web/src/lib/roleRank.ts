/**
 * Seniority rank for a role/title string — powers the Resources → Manager tab
 * hierarchy ("who ranks under whom on a record's team").
 *
 * Higher = more senior. "Under" someone means STRICTLY lower rank — a second
 * Project Manager never ranks under a Project Manager. Keyword-scored so
 * tenant-specific titles ("Senior Project Architect", "MEP Coordinator")
 * still land in a sensible tier without a per-tenant lookup table.
 *
 * Tiers (top → bottom):
 *   100 chief executives (CEO/COO/CFO/CTO/Chief …)
 *    95 President
 *    90 Vice President            85 Associate/Assistant VP
 *    82 Principal / Partner
 *    80 Director                  75 Associate/Assistant Director
 *    70 Senior Manager            65 Manager
 *    62 Superintendent / Supervisor
 *    58 Lead / Foreman
 *    48 Senior individual contributor
 *    38 individual contributor (default)
 *    30 blank/unknown
 *    20 Junior / Intern / Trainee
 */
export function roleRank(roleOrTitle: string | null | undefined): number {
  const s = String(roleOrTitle ?? "").trim().toLowerCase().replace(/[._]/g, " ");
  if (!s) return 30;
  const has = (re: RegExp) => re.test(s);
  const assoc = has(/\b(associate|assistant|asst|deputy)\b/);
  if (has(/\b(ceo|coo|cfo|cto|chief)\b/)) return 100;
  // "vice president" must be checked BEFORE bare "president".
  if (has(/vice\s*president|\bvp\b|\bavp\b/)) return assoc || has(/\bavp\b/) ? 85 : 90;
  if (has(/\bpresident\b/)) return 95;
  if (has(/\bprincipal\b|\bpartner\b/)) return 82;
  if (has(/\bdirector\b/)) return assoc ? 75 : 80;
  if (has(/\bmanager\b|\bmgr\b/)) return has(/\b(senior|sr)\b/) ? 70 : 65;
  if (has(/\bsuperintendent\b|\bsupervisor\b/)) return 62;
  if (has(/\blead\b|\bforeman\b/)) return 58;
  if (has(/\b(junior|jr|intern|trainee|apprentice)\b/)) return 20;
  if (has(/\b(senior|sr)\b/)) return 48;
  return 38;
}
