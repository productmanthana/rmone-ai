/**
 * Financial / contract-value field names — the single server-side source of
 * truth shared by the route gates (rmone-proxy.ts) and the write backstop in
 * updateRecordFieldsRds (rds-provider.ts). Matched case-insensitively against
 * the FieldName the client sends.
 *
 * The web mirrors this list in rmone-web/src/lib/permissions.ts
 * (FINANCIAL_FIELD_NAMES) for display-only gating — keep the two in lockstep.
 */
export const FINANCIAL_FIELD_NAMES = new Set(
  [
    // Core contract, revenue, and rate values.
    "ApproxContractValue", "ContractValue", "ContractedAmount", "ProjectValue", "EstimatedValue",
    "EstimatedRevenue", "TotalValue", "RevenueAmount", "OpportunityValue",
    "ForecastedProjectCost", "LaborContractAmount", "LaborBudget", "ContractLimit", "Fee",
    "GrossMargin", "FeePct", "BillingRate", "Rate", "Cost", "Budget",
    // Construction budget and signed-contract values. These can appear as
    // first-class cards or as user-pinned custom fields, but must receive the
    // same financial capability check in either presentation.
    "NonOperatingCost", "TotalCost", "ProjectCost", "AcquisitionCost",
    "ActualProjectCost", "ActualAcquisitionCost", "EstProjectSpend",
    "ProposalAmount", "BidAmount", "Contingency", "ApprovedChangeOrders",
    "ChangeOrders", "LiquidatedDamages", "ApprovedRFEAmount", "Retainage",
  ].map((s) => s.toLowerCase()),
);

/**
 * Alias-aware financial classification (security). updateRecordFieldsRds
 * resolves submitted field names through fieldKind() (rds-provider.ts): ANY
 * name containing "value" lands on the ContractValue column, "approx" on
 * ApproxContractValue, "labor" on LaborContractAmount, etc. A gate that only
 * checks the exact-name set can therefore be bypassed with an alias (e.g.
 * FieldName "value") that still WRITES a financial column — and its audit
 * entry would dodge name-keyed redaction. This mirrors fieldKind's financial
 * branches with the SAME precedence (earlier non-financial kinds win, so
 * "StatusValue" stays a status field). Keep in lockstep with fieldKind();
 * check-financial-alias.ts guards the pairing.
 */
export function resolvesToFinancialColumn(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = String(name).trim().toLowerCase();
  // Non-financial kinds that take precedence in fieldKind().
  if (n.includes("status") || n.includes("sector") || n.includes("projecttype") || n.includes("servicetype") || n.includes("requestcategory")) return false;
  if (n.includes("labor")) return true;                                          // → LaborContractAmount
  if (n.includes("approx")) return true;                                         // → ApproxContractValue
  if (n === "forecastedprojectcost" || n === "forecastprojectcost") return true; // → ForecastedProjectCost
  if (n.includes("nonoperating") || n.includes("non-operating")) return true;    // → NonOperatingCost
  if (n.includes("value")) return true;                                          // → ContractValue
  return false;
}

export function isFinancialFieldName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = String(name).trim().toLowerCase();
  return FINANCIAL_FIELD_NAMES.has(n) || resolvesToFinancialColumn(n);
}

/** Partition a write's field list: does it touch financial / non-financial fields? */
export function splitFinancialFields(fields: { FieldName?: string }[]): { hasFinancial: boolean; hasNonFinancial: boolean } {
  let hasFinancial = false;
  let hasNonFinancial = false;
  for (const f of fields) {
    if (isFinancialFieldName(f?.FieldName)) hasFinancial = true;
    else hasNonFinancial = true;
  }
  return { hasFinancial, hasNonFinancial };
}
