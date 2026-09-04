// ─────────────────────────────────────────────────────────────────────────────
// Viewer-scoped stage/schedule sets — RETIRED (Aug 2026, client request).
//
// Saved schedules (projectPhaseSets) and opportunity stage sets (oppStageSets)
// used to carry an audience (everyone | groups | except | people) and the
// first matching set overrode the default for that viewer/creator. The client
// asked for this to be removed as too complicated: saved schedules are now
// PLAIN TEMPLATES with no audience. The default list applies to everyone, and
// "Make default" on the settings page is the only way to change what applies.
//
// The resolvers below are kept as the single choke points every consumer
// (/stage-rules, /field-options, /new-record, rds-provider stage gates) still
// calls — they now deliberately resolve to "no override" so the tenant-wide
// default always wins. Stored audience fields on old data are ignored, not
// deleted, so this is reversible.
//
// NOTE: per-stage "Applies to" audiences (StageRules.stageAudiences — a
// display-only feature configured in the Set rules drawer) are a SEPARATE
// feature and stay live via viewerAudienceMembership below.
// ─────────────────────────────────────────────────────────────────────────────
import type { StageRuleModule } from "./stage-rules.js";
import { getUserGroupsForTenant, orgAudienceIdsForChecked, userAudienceId } from "./access-control.js";

/**
 * RETIRED — always null: no saved opportunity stage set overrides the tenant
 * default any more (audience scoping on schedules was removed). Callers fall
 * back to the tenant-wide default pipeline.
 */
export async function resolveOppStagesForViewer(
  _tenantLabel: string,
  _userId: string | null | undefined,
): Promise<string[] | null> {
  return null;
}

/**
 * RETIRED — always empty: named workflow templates no longer override the
 * live workflow for any viewer (audience scoping on schedules was removed).
 * Tenant defaults apply to everyone.
 */
export async function resolveTemplateStageOrdersForViewer(
  _tenantLabel: string,
  _userId: string | null | undefined,
): Promise<Partial<Record<StageRuleModule, string[]>>> {
  return {};
}

/**
 * The viewer's audience membership for per-stage "Applies to" checks
 * (StageRules.stageAudiences → filterStagesByAudience): group ids + the
 * viewer's own "user:" sentinel + live "org:"/"role:" sentinels, all lowercase.
 * Returns null when there's no acting user OR the lookups fail — callers
 * must then leave stage lists UNFILTERED (fail-visible, display-only
 * feature).
 */
export async function viewerAudienceMembership(
  tenantLabel: string,
  userId: string | null | undefined,
): Promise<{ ids: Set<string>; orgUnknown: boolean } | null> {
  const uid = String(userId ?? "").trim().toLowerCase();
  if (!uid) return null;
  try {
    const gdoc = await getUserGroupsForTenant(tenantLabel);
    const ids = new Set(
      gdoc.groups.filter((g) => g.memberIds.includes(uid)).map((g) => g.id.trim().toLowerCase()),
    );
    // The viewer's own user sentinel — "Only specific people" audiences.
    ids.add(userAudienceId(uid));
    // Live org audiences (org:bu/div/dept sentinels) count as memberships.
    let orgUnknown = false;
    const orgSet = await orgAudienceIdsForChecked(tenantLabel, uid);
    if (orgSet) for (const oid of orgSet) ids.add(oid);
    else orgUnknown = true; // outage — membership unknown, not empty
    return { ids, orgUnknown };
  } catch (e) {
    console.warn(`[stageAudiences] membership lookup failed for ${tenantLabel}: ${String(e).slice(0, 160)}`);
    return null;
  }
}

/**
 * RETIRED — always null: nothing viewer-specific applies any more; every
 * caller falls back to the tenant-wide configured order.
 */
export async function resolveWorkflowStagesForViewer(
  _tenantLabel: string,
  _userId: string | null | undefined,
  _module: StageRuleModule,
): Promise<string[] | null> {
  return null;
}
