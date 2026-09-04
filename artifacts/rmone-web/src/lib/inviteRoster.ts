/**
 * In-memory session cache for the Manage Staff roster (team members +
 * invite status), shared by the Settings → Staff & Resources → Manage Staff
 * card and the invite dialog.
 *
 * Problem: the card blocked its first paint on a network round-trip every
 * visit ("Loading team members…" spinner), even though the roster rarely
 * changes between visits.
 *
 * Fix: keep the last successfully-loaded roster in a module-level Map so the
 * card renders instantly while a background refetch revalidates (SWR) — the
 * same pattern as lib/settingsSeed.ts.
 *
 * Rules (tenant isolation + hollow-cache):
 *  - memory only — NEVER localStorage (zero-browser-storage requirement);
 *  - cleared wholesale on `rmone:authChanged` (login, logout, tenant switch);
 *  - only successful fetches are cached — failures never poison the cache;
 *  - keys are tenant-scoped by construction (the tenantId/label the caller
 *    passes to the backend).
 */

import { authHeaders } from "@/lib/api";

const API = "/api/onboarding";

export interface InviteMember {
  userGuid: string;
  name: string;
  email: string;
  username: string;
  jobTitle: string;
  divisionName: string | null;
  departmentName: string | null;
  hasEmail: boolean;
  inviteStatus: "none" | "sent" | "accepted" | "expired";
  accessLevel: string | null;
  /** false = deactivated (sign-in blocked, history kept). */
  enabled?: boolean;
  sentAt: string | null;
  acceptedAt: string | null;
}

const rosterCache = new Map<string, InviteMember[]>();
const warming = new Set<string>();

/** Last successfully-loaded roster for this tenant, if any (instant render). */
export function getInviteRosterSeed(tenantId: string): InviteMember[] | undefined {
  return rosterCache.get(tenantId);
}

/**
 * Fetch the roster and cache it on success. Throws on failure (the cache is
 * left untouched — a failed fetch must never look like an empty roster).
 */
export async function fetchInviteRoster(tenantId: string): Promise<InviteMember[]> {
  const res = await fetch(`${API}/invites?tenantId=${encodeURIComponent(tenantId)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json() as { members: InviteMember[] };
  const raw = d.members ?? [];
  const seenGuid = new Set<string>();
  const members = raw.filter(m => { if (seenGuid.has(m.userGuid)) return false; seenGuid.add(m.userGuid); return true; });
  rosterCache.set(tenantId, members);
  return members;
}

/** Fire-and-forget pre-fetch so the first open paints instantly. */
export function warmInviteRoster(tenantId: string): void {
  if (!tenantId || rosterCache.has(tenantId) || warming.has(tenantId)) return;
  warming.add(tenantId);
  fetchInviteRoster(tenantId)
    .catch(() => { /* never cache failures */ })
    .finally(() => warming.delete(tenantId));
}

// Different sign-in (or tenant switch) → roster no longer applies. Same
// event every other client cache clears on.
if (typeof window !== "undefined") {
  window.addEventListener("rmone:authChanged", () => {
    rosterCache.clear();
    warming.clear();
  });
}
