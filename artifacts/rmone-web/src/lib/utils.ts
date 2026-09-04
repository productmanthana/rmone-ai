import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * User-facing numeric display is deliberately capped at two decimal places.
 * This must be used for calculated values rather than rendering a JavaScript
 * number directly, which can expose binary precision tails such as
 * 2626.9999999999999.
 */
export function fmtNumber(v: number | string | null | undefined, decimals = 2): string {
  const n = Number(v);
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.min(2, Math.max(0, decimals)),
  }).format(n);
}

export function fmtHours(v: number | string | null | undefined, decimals = 2): string {
  return fmtNumber(v, decimals);
}

/**
 * Format a number as a percentage capped at 2 decimal places.
 * Trailing zeros are dropped: 136.00 → "136%", 40.50 → "40.5%".
 */
export function fmtPct(v: number | string | null | undefined, decimals = 2): string {
  const formatted = fmtNumber(v, decimals);
  return formatted === "—" ? formatted : `${formatted}%`;
}
