/**
 * Data-quality helpers for the "Missing Data Management" spec.
 *
 *  - safeRatio  (item 42): a single, honest divide-by-zero rule. A ratio with a
 *    zero / missing denominator is NEVER silently shown as 0. It returns "N/A"
 *    unless an admin has turned on `fallbackDenominatorEnabled`, in which case a
 *    caller-supplied fallback denominator may be used and the result is flagged
 *    as an admin-fallback estimate (so the UI can asterisk it).
 *
 *  - resolveDataSource (item 27): a deterministic source-priority resolver. Given
 *    several candidate sources for the same value, it picks the highest-priority
 *    one according to the admin-configured `dataSourcePriority` ranking
 *    (ERP > Timesheet > Scheduling > Manual > AI > Defaults by default).
 */

export interface RatioResult {
  /** Numeric value when computable, else null (render as "N/A"). */
  value: number | null;
  /** True when the denominator was zero/missing and no fallback applied. */
  unavailable: boolean;
  /** True when an admin-fallback denominator was used (UI should flag it). */
  estimated: boolean;
  /** Human-readable note explaining the result (for hover/tooltip). */
  note: string;
}

/**
 * Divide `numerator` by `denominator` honestly.
 *
 * @param fallbackEnabled  the admin `fallbackDenominatorEnabled` setting.
 * @param fallbackDenominator  a real, defensible substitute denominator (e.g. a
 *   team-wide average). Only used when fallbackEnabled is true AND the primary
 *   denominator is zero/missing. Never invented here — the caller must pass a
 *   value derived from real data, or omit it.
 */
export function safeRatio(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  opts: { fallbackEnabled?: boolean; fallbackDenominator?: number | null } = {},
): RatioResult {
  const n = typeof numerator === "number" && Number.isFinite(numerator) ? numerator : null;
  const d = typeof denominator === "number" && Number.isFinite(denominator) ? denominator : null;
  if (n === null) {
    return { value: null, unavailable: true, estimated: false, note: "No numerator available." };
  }
  if (d !== null && d !== 0) {
    return { value: n / d, unavailable: false, estimated: false, note: "Computed from real values." };
  }
  // Denominator is zero or missing.
  const fb = opts.fallbackEnabled ? opts.fallbackDenominator : null;
  if (opts.fallbackEnabled && typeof fb === "number" && Number.isFinite(fb) && fb !== 0) {
    return {
      value: n / fb,
      unavailable: false,
      estimated: true,
      note: "Estimated using an admin-enabled fallback denominator (no real denominator available).",
    };
  }
  return {
    value: null,
    unavailable: true,
    estimated: false,
    note: "Denominator is zero or missing — shown as N/A rather than a misleading 0.",
  };
}

/** Canonical data-source tokens, lower-cased for matching. */
export type DataSource = "erp" | "timesheet" | "scheduling" | "manual" | "ai" | "defaults";

/** Parse the admin `dataSourcePriority` string into an ordered, normalised list. */
export function parseSourcePriority(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(/[>,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export interface SourceCandidate<T> {
  source: string;       // e.g. "ERP", "Timesheet", "AI", "Defaults"
  value: T;             // the value this source supplies
}

/**
 * Pick the candidate from the highest-priority source per the admin ranking.
 * Candidates whose source is not in the ranking are considered lowest priority
 * (kept in their original order). Returns null when there are no candidates.
 */
export function resolveDataSource<T>(
  candidates: SourceCandidate<T>[],
  priorityRaw: string | null | undefined,
): SourceCandidate<T> | null {
  if (!candidates.length) return null;
  const order = parseSourcePriority(priorityRaw);
  const rank = (src: string) => {
    const i = order.indexOf(String(src).trim().toLowerCase());
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  let best = candidates[0];
  let bestRank = rank(best.source);
  for (const c of candidates.slice(1)) {
    const r = rank(c.source);
    if (r < bestRank) { best = c; bestRank = r; }
  }
  return best;
}
