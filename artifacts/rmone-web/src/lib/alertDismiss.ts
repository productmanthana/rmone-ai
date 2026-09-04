// Shared alert-dismissal store. Dismissals are saved in localStorage by the
// Alerts page and must be respected everywhere the same risk feed renders
// (Alerts page AND the home risk feed), so a dismissal on one page
// immediately disappears from the other without a manual refresh.

import { getStoredUser } from "./api";

// Tenant+user-scoped BY CONSTRUCTION: dismissals are a per-person choice, and
// the fallback dismiss key is title-based (titles collide across tenants) —
// an un-scoped key let one company's dismissals silently hide another
// company's alerts on a shared browser. The legacy bare key is purged in
// bustCache() so pre-fix values can't resurface.
function dismissedKey(): string {
  const u = getStoredUser();
  if (!u) return "rmone:dismissed_alerts";
  return `rmone:dismissed_alerts:${u.tenant.toLowerCase()}:${u.username.toLowerCase()}`;
}

export function loadDismissed(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(dismissedKey()) ?? "{}"); } catch { return {}; }
}

export function saveDismissed(d: Record<string, string>) {
  try { localStorage.setItem(dismissedKey(), JSON.stringify(d)); } catch { /* storage unavailable */ }
}

// Prefer the stable backend alertKey when available (survives SWR refreshes).
// Fall back to a title-based key for curated/sample rows that have no backend ID.
// Structural param type so both RiskItem shapes (roleHomeData / homeIntelligence)
// can use it.
export function alertDismissKey(r: { alertKey?: string; title: string; sub?: string }): string {
  if (r.alertKey) return `ak:${r.alertKey}`;
  return encodeURIComponent((r.title + "|" + (r.sub ?? "")).slice(0, 120));
}
