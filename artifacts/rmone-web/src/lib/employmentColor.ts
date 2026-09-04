/**
 * Employment-type color coding (client mandate, mirrors the legacy platform):
 *   Part-Time            → blue
 *   As Needed            → purple
 *   SCA Contingency      → orange
 *   Full-Time, Temporary → no color (names render exactly as before)
 *
 * The actual hex values are ADMIN-TUNABLE per tenant on the Settings page and
 * ride along the business-rules payload — every surface reads through
 * empTypeColor() so the coloring can never drift between pages. An empty
 * string for a type means "no color" (render normally).
 */
import { getBusinessRules } from "./businessRules";

/** Normalize an employee-type label for matching: lowercase, letters only. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export type EmpTypeKey =
  | "empColorPartTime"
  | "empColorAsNeeded"
  | "empColorScaContingency"
  | "empColorTemporary"
  | "empColorFullTime";

/** Map a raw employee-type label to its settings key (null = unknown type). */
export function empTypeKey(type?: string | null): EmpTypeKey | null {
  if (!type) return null;
  const k = norm(type);
  if (!k) return null;
  // Order matters: "SCA Contingency Staff" contains no other keyword; check
  // the most specific tokens first so future labels degrade safely.
  if (k.includes("sca") || k.includes("contingen")) return "empColorScaContingency";
  if (k.includes("part")) return "empColorPartTime";
  if (k.includes("needed") || k === "asneeded") return "empColorAsNeeded";
  if (k.includes("temp")) return "empColorTemporary";
  if (k.includes("full")) return "empColorFullTime";
  return null;
}

/**
 * Color for a person's employee type, or null when the name should render
 * normally (Full-Time, Temporary, unknown, blank — or admin set "no color").
 */
export function empTypeColor(type?: string | null): string | null {
  const key = empTypeKey(type);
  if (!key) return null;
  const c = getBusinessRules()[key];
  return typeof c === "string" && c.trim() ? c : null;
}

/** Legend entries for the types that currently HAVE a color (admin-effective). */
export function empTypeLegend(): { label: string; color: string }[] {
  const r = getBusinessRules();
  const rows: { label: string; key: EmpTypeKey }[] = [
    { label: "Part-Time", key: "empColorPartTime" },
    { label: "As Needed", key: "empColorAsNeeded" },
    { label: "SCA Contingency", key: "empColorScaContingency" },
    { label: "Temporary", key: "empColorTemporary" },
    { label: "Full-Time", key: "empColorFullTime" },
  ];
  return rows
    .filter((x) => typeof r[x.key] === "string" && (r[x.key] as string).trim())
    .map((x) => ({ label: x.label, color: r[x.key] as string }));
}
