/**
 * Server-side accessor for the "Business rules & thresholds" an admin sets on
 * the Onboarding → Settings page. These live in the same layered settings store
 * as the onboarding defaults (built-in ← global overrides ← per-client), but
 * unlike the import-time defaults they tune the math the LIVE app applies to real
 * RM ONE data (utilization severity bands, hours↔% conversions, demand urgency).
 *
 * Live analytics are scoped to the SIGNED-IN company: when a tenant label is
 * available we resolve that company's EFFECTIVE rules (global defaults overlaid
 * with the company's own overrides). Callers without a tenant (e.g. an upstream
 * RM ONE session with no onboarded company) fall back to the global layer, which
 * keeps the app behaving exactly as it did before per-company rules existed.
 *
 * Values are cached briefly per scope so a hot path (e.g. scoring a batch of
 * staff records) does not hit Postgres per record; admin edits take effect
 * within the TTL or immediately after a save calls invalidateBusinessRules().
 */
import {
  GLOBAL_SCOPE, normTenantKey, loadEffectiveDefaults,
} from "./onboarding-settings-store.js";
import { BUILTIN_ONBOARDING_DEFAULTS } from "./onboarding-defaults.js";
import type { OnboardingDefaults } from "./onboarding-defaults.js";

const TTL_MS = 30_000;

const cache = new Map<string, { at: number; rules: OnboardingDefaults }>();

/**
 * Resolve the effective business rules for a company (built-in ← global ←
 * per-client). Pass the signed-in company's tenant label to get company-scoped
 * rules; omit it for the global layer. Falls back to the built-in constants if
 * the DB is unreachable, so the app keeps behaving exactly as before.
 */
export async function getBusinessRulesForTenant(
  tenantLabel?: string,
): Promise<OnboardingDefaults> {
  const key = tenantLabel ? normTenantKey(tenantLabel) : GLOBAL_SCOPE;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rules;
  try {
    const rules = await loadEffectiveDefaults(tenantLabel);
    cache.set(key, { at: Date.now(), rules });
    return rules;
  } catch {
    return { ...BUILTIN_ONBOARDING_DEFAULTS };
  }
}

/**
 * STRICT variant for authorization-relevant reads (e.g. the past-week hours
 * lock): identical cache behavior, but a failed Settings load PROPAGATES
 * instead of silently substituting the permissive built-in defaults.
 *
 * Fresh cache hits are served because the cache only ever stores rules from a
 * SUCCESSFUL loadEffectiveDefaults call (both accessors set it only on
 * success) — a known-good recent policy read, never a fallback. On a cache
 * miss with an unreachable settings store this REJECTS, so callers enforcing
 * a tenant-configured lock can fail closed rather than skip enforcement.
 *
 * `deps.load` is injectable so tests can exercise the cache-miss failure path
 * without a live database.
 */
export async function getBusinessRulesForTenantStrict(
  tenantLabel?: string,
  deps: { load: (tenantLabel?: string) => Promise<OnboardingDefaults> } = {
    load: (t?: string) => loadEffectiveDefaults(t),
  },
): Promise<OnboardingDefaults> {
  const key = tenantLabel ? normTenantKey(tenantLabel) : GLOBAL_SCOPE;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rules;
  const rules = await deps.load(tenantLabel);
  cache.set(key, { at: Date.now(), rules });
  return rules;
}

/** Global-layer business rules (back-compat shorthand for the untenanted case). */
export async function getBusinessRules(): Promise<OnboardingDefaults> {
  return getBusinessRulesForTenant();
}

/** Drop every cached scope so the next read re-resolves from the DB (after a save). */
export function invalidateBusinessRules(): void {
  cache.clear();
}
