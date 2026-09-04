/**
 * Daily Briefing gate — single source of truth for whether the
 * launch briefing should be shown today. The briefing appears once
 * per calendar day after login; subsequent logins (or the user
 * tapping "Open command center") mark it as seen and skip straight
 * to the command center until the next day.
 *
 * Storage: `localStorage.rmone.lastBriefingShown:<tenant>::<username>`
 * = `YYYY-MM-DD` (the date on which THAT user last saw the briefing).
 * The key is scoped per tenant + username: with a shared key, one
 * account seeing the briefing blocked every other account that logged
 * in from the same browser that day.
 *
 * Imported by both `pages/login.tsx` (to pick the post-login route)
 * and `pages/daily-briefing.tsx` (to write the seen marker when
 * the user dismisses the briefing).
 */

const BRIEFING_STORAGE_KEY = "rmone.lastBriefingShown";

// Tenant + username are written to localStorage by the login flow
// (lib/api.ts) before any briefing-gate call runs post-login.
function storageKey(): string {
  let tenant = "";
  let user = "";
  try {
    tenant = (localStorage.getItem("rmone_tenant") ?? "").trim().toLowerCase();
    user = (localStorage.getItem("rmone_username") ?? "").trim().toLowerCase();
  } catch {
    /* localStorage unavailable — fall through to unscoped suffix */
  }
  return `${BRIEFING_STORAGE_KEY}:${tenant}::${user}`;
}

function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function markBriefingSeen(d: Date = new Date()): void {
  try {
    localStorage.setItem(storageKey(), todayKey(d));
  } catch {
    /* localStorage unavailable (private mode, etc.) — silently no-op */
  }
}

export function shouldShowBriefingToday(d: Date = new Date()): boolean {
  try {
    const last = localStorage.getItem(storageKey());
    return last !== todayKey(d);
  } catch {
    // localStorage unavailable — show the briefing
    return true;
  }
}
