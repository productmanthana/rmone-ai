/**
 * Display-only numeric formatters. Persisted allocation values retain their
 * full precision; UI output never exposes JavaScript binary precision tails.
 */
export function fmtNumber(value: number | string | null | undefined, decimals = 2): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.min(2, Math.max(0, decimals)),
  }).format(numeric);
}

export function fmtHours(value: number | string | null | undefined, decimals = 2): string {
  return fmtNumber(value, decimals);
}

export function fmtPct(value: number | string | null | undefined, decimals = 2): string {
  const formatted = fmtNumber(value, decimals);
  return formatted === "—" ? formatted : `${formatted}%`;
}