// ── Flexible org hierarchy helpers ──────────────────────────────────────────
// Tenants can hide the Business Unit / Division / Department tiers via the
// Manage Organization hierarchy toggles (business rules showBusinessUnit /
// showDivision / showDepartment). The DB schema keeps its full FK chain
// (record → DivisionLookup → CompanyDivisions → BusinessUnit), so when the
// Division tier is HIDDEN, forms resolve a hidden "bridge" division instead:
//   • with a BU selected → bridge mirrors the BU's name (mirror-named), linked
//     to the BU so the read-path BU derivation keeps working unchanged;
//   • no BU tier either → one tenant-wide bridge named from unassignedLabel.
// Bridge resolution is server-side (idempotent, race-safe across workers).

import { ensureBridgeDivision } from "./api";
import { getBusinessRules } from "./businessRules";

/**
 * Resolve the division id a form should persist.
 * - Division tier visible → pass the user's selection through untouched.
 * - Division tier hidden  → find-or-create the bridge division for the
 *   selected BU (or the tenant-wide bridge when there is no BU) and return
 *   its id. Throws on backend failure — callers must surface the error, not
 *   silently save an unlinked record.
 */
export async function resolveDivisionForSave(
  divisionId: string | undefined | null,
  businessUnitId?: string | undefined | null,
): Promise<string> {
  const rules = getBusinessRules();
  const div = (divisionId ?? "").trim();
  if (rules.showDivision) return div;
  // A concrete division id may already be present (e.g. prefilled from a
  // conversion seed or an earlier bridge resolution) — reuse it as-is.
  if (div) return div;
  const bridge = await ensureBridgeDivision((businessUnitId ?? "").trim() || undefined, rules.unassignedLabel);
  return String(bridge.id);
}

/**
 * True when a division row is a hidden bridge. Only meaningful for tenants
 * with the Division tier hidden — for everyone else mirror-named divisions
 * are legitimate user data and must never be filtered.
 * @param divTitle   division Title
 * @param divBuId    division BusinessUnitIdLookup ("" when unlinked)
 * @param buTitleById map of BusinessUnit id → Title
 */
export function isBridgeDivision(
  divTitle: string,
  divBuId: string,
  buTitleById: Map<string, string>,
): boolean {
  const rules = getBusinessRules();
  if (rules.showDivision) return false;
  const t = (divTitle ?? "").trim().toLowerCase();
  if (!t) return false;
  const buTitle = (buTitleById.get((divBuId ?? "").trim()) ?? "").trim().toLowerCase();
  if (buTitle && t === buTitle) return true;
  // Tenant-wide bridge (no BU): named from the unassigned label.
  if (!buTitle && t === (rules.unassignedLabel ?? "").trim().toLowerCase()) return true;
  return false;
}
