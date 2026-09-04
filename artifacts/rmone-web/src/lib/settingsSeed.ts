/**
 * In-memory session seeds for the Settings cards (Stage Rules, Display
 * Defaults, Access Levels, User Groups, Staffing Templates…).
 *
 * Problem: every card blocked its first paint on a network round-trip — a
 * full-card spinner on EVERY visit, even though the docs rarely change.
 *
 * Fix: keep the last successfully-loaded doc in a module-level Map and let
 * each card render instantly from it while a background refetch revalidates
 * (SWR). `warmSettingsSeeds()` pre-fetches all docs when the settings hub
 * mounts, so even the FIRST click into a card paints instantly.
 *
 * Rules (tenant isolation + hollow-cache):
 *  - memory only — NEVER localStorage (zero-browser-storage requirement);
 *  - cleared wholesale on `rmone:authChanged` (login, logout, tenant switch);
 *  - only successful fetches are seeded — failures never poison the cache;
 *  - keys are tenant-scoped by construction: `<doc>:<tenantId | "own">`.
 */

import { fetchStageRulesFor, type StageRulesState } from "@/lib/stageRules";
import {
  fetchStagePermissions, fetchUserGroups, fetchAccessLevels, fetchNavVisibility,
  type StagePermRule, type UserGroup,
} from "@/lib/permissions";
import { fetchDisplayDefaultsFor } from "@/lib/displayDefaults";
import { getAllocTemplates } from "@/lib/api";

const seeds = new Map<string, unknown>();

export function getSeed<T>(key: string): T | undefined {
  return seeds.get(key) as T | undefined;
}

export function setSeed<T>(key: string, value: T): void {
  seeds.set(key, value);
}

/** Tenant-scoped seed key. `tenantId` undefined = the admin's own company. */
export function seedScope(tenantId?: string | null): string {
  return tenantId ?? "own";
}

/** Seed shape for the Stage Rules card (three docs load together). */
export interface StageRulesSeed extends StageRulesState {
  perms: StagePermRule[];
  groups: UserGroup[];
}

// One warm per scope per session — seeds persist until auth changes, and
// concurrent duplicate warms (hub remounts) are skipped via this set.
const warming = new Set<string>();

/**
 * Pre-fetch every settings doc for the scope so the cards render instantly
 * on first open. Fire-and-forget; failures simply leave the card on its
 * normal spinner-then-load path.
 */
export function warmSettingsSeeds(tenantId?: string): void {
  const t = seedScope(tenantId);

  const warm = (key: string, fetcher: () => Promise<unknown>) => {
    const full = `${key}:${t}`;
    if (seeds.has(full) || warming.has(full)) return;
    warming.add(full);
    fetcher()
      .then((v) => setSeed(full, v))
      .catch(() => { /* never seed failures */ })
      .finally(() => warming.delete(full));
  };

  warm("stageRules", async (): Promise<StageRulesSeed> => {
    // All-or-nothing: if ANY sub-fetch fails, the warm aborts and nothing is
    // seeded — a failed groups fetch must never be seeded as a synthetic
    // empty list (hollow-cache rule). The card falls back to its normal
    // spinner-then-load path instead.
    const [st, perms, groups] = await Promise.all([
      fetchStageRulesFor(tenantId),
      fetchStagePermissions(tenantId),
      fetchUserGroups(tenantId),
    ]);
    return { rules: st.rules, stageOrder: st.stageOrder, perms, groups };
  });
  warm("displayDefaults", () => fetchDisplayDefaultsFor(tenantId));
  warm("accessLevels", () => fetchAccessLevels(tenantId));
  warm("userGroups", () => fetchUserGroups(tenantId));
  warm("navVisibility", () => fetchNavVisibility(tenantId));
  // Staffing templates are own-tenant only (no superadmin scope switch).
  if (tenantId === undefined) warm("staffingTemplates", () => getAllocTemplates());
}

// Different sign-in (or tenant switch) → seeds no longer apply. Same event
// every other client cache clears on.
if (typeof window !== "undefined") {
  window.addEventListener("rmone:authChanged", () => {
    seeds.clear();
    warming.clear();
  });
}
