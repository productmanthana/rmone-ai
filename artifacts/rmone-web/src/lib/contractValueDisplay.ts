/**
 * Own-column contract values for display (#124 follow-up, Aug 2026).
 *
 * `project.value` is the Approx-FIRST headline coalesce built in the detail
 * parser (ApproxContractValue || ContractValue || ContractedAmount || …). That
 * is the right "headline value" for lists and summaries, but any cell LABELED
 * "Contract Value" or "Approx Contract Value" must show its OWN stored column
 * whenever the record's live table carries BOTH columns (e.g. Lead) —
 * otherwise a record with Approx=63 / Contract=48 renders both cells as 63.
 *
 * rawFields keys mirror the live table's columns (the read path selects the
 * live row), so key PRESENCE = column presence — same heuristic as the #124
 * cvLockNote site. When only one column exists the two FieldNames collapse to
 * one stored column and the headline value is the honest display for both.
 */
export function ownContractValues(
  rawFields: Record<string, unknown> | null | undefined,
  headlineValue: number,
): { distinct: boolean; contract: number; approx: number } {
  const rf = rawFields ?? {};
  const keys = Object.keys(rf);
  const lower = new Set(keys.map((k) => k.trim().toLowerCase()));
  const distinct = lower.has("approxcontractvalue") && lower.has("contractvalue");
  if (!distinct) return { distinct, contract: headlineValue, approx: headlineValue };
  const numAt = (want: string): number => {
    if (want in rf) return Number(rf[want] ?? 0) || 0;
    const wantLower = want.toLowerCase();
    for (const k of keys) {
      if (k.trim().toLowerCase() === wantLower) return Number(rf[k] ?? 0) || 0;
    }
    return 0;
  };
  return { distinct, contract: numAt("ContractValue"), approx: numAt("ApproxContractValue") };
}
