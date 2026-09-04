// Curated standard job titles offered as ready-to-pick suggestions in every
// job-title picker (mirror of rmone-web/src/lib/standardTitles.ts — keep the
// two lists in lockstep). Names align with the roleResolver TRANSLATIONS
// keywords so each resolves to the intended home persona.
export const STANDARD_JOB_TITLES: string[] = [
  "CEO",
  "CFO",
  "COO",
  "CTO",
  "President",
  "Owner",
  "Principal",
  "Managing Director",
  "Partner",
  "Controller",
  "Finance Manager",
  "Operations Manager",
  "Resource Manager",
  "Staffing Manager",
  "HR Manager",
  "Project Manager",
  "Program Manager",
];

/** Append any standard titles missing from a plain name list (case-insensitive). */
export function withSuggestedTitleNames(names: string[]): string[] {
  const have = new Set(names.map((n) => n.trim().toLowerCase()));
  const extra = STANDARD_JOB_TITLES.filter((n) => !have.has(n.toLowerCase()));
  return extra.length ? [...names, ...extra] : names;
}
