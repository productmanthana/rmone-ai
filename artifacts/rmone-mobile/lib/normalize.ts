export function normalizeName(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[-_/.,()'"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function nameMatches(haystack: string, needle: string): boolean {
  const h = normalizeName(haystack);
  const n = normalizeName(needle);
  if (!n) return true;
  return h.includes(n);
}
