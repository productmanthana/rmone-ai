// Compact display for billion-and-above dollar values. Every money formatter
// in the app used to stop at the "B" tier, so junk-sized data (trillions and
// beyond, e.g. test records holding $2.2 quintillion) printed the raw digits
// with a "B" stuck on the end — "$2222225457.9B" — overflowing and overlapping
// card layouts. Callers keep their own sub-billion tiers and delegate here
// only when the value is >= $1B.
//
// Expects a non-negative value (all call sites either check v >= 1e9 first or
// pass Math.abs and re-attach the sign themselves).
export function compactUsd(v: number): string {
  const TIERS: [number, string][] = [
    [1e18, "Qi"], // quintillion
    [1e15, "Qa"], // quadrillion
    [1e12, "T"],
    [1e9, "B"],
  ];
  for (const [div, suffix] of TIERS) {
    if (v >= div) {
      const n = v / div;
      // 3 digits max before the suffix; drop a pointless ".0".
      const s = n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, "");
      return `$${s}${suffix}`;
    }
  }
  return `$${(v / 1e9).toFixed(1)}B`;
}
