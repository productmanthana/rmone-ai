import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import multer from "multer";
const _rcUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
import { bustModuleCache, recentAssignments } from "./chat.js";
import { bustFinancialCache, warmRecruitmentAnalytics } from "./analytics.js";
import { adoptRecruitmentPayload } from "../lib/financial-cache.js";
import { BACKGROUND_PROFILE, IS_DEPLOYED_SERVER } from "../lib/deploy-env.js";
import { lookupUserForLogin, verifyPassword, signRdsToken, verifyRdsToken, getRdsProfile, resolveRequestSource, canEditFromAcl, TOKEN_TTL, isSuperAdminSource, ROOT_SUPERADMIN_ACCOUNTS } from "../lib/rds-auth.js";
import { fetchStatusHistory } from "../lib/statusHistory.js";
import { fetchFieldHistory } from "../lib/fieldHistory.js";
import { sendEmail } from "../lib/agentmail.js";
import { loadEffectiveDefaults, recordAssumedScheduleDates, recordAssumedRoleRate } from "../lib/onboarding-settings-store.js";
import { BUILTIN_ONBOARDING_DEFAULTS, resolveAssumedDurationMonths, resolveViewerDisplayModes, buildViewerMemberships } from "../lib/onboarding-defaults.js";
import { resolveWorkflowStagesForViewer, viewerAudienceMembership } from "../lib/opp-stage-sets.js";
import { filterStagesByAudience, isOutcomeStageName, type StageAudience } from "../lib/stage-rules.js";
import type { OnboardingDefaults } from "../lib/onboarding-defaults.js";
import { getRecords as rdsGetRecords, getResourceAllocations as rdsGetResourceAllocations, bustResourceAllocationsCache, getResourceDemands as rdsGetResourceDemands, getRecordDetail as rdsGetRecordDetail, getDivisionsRds, updateStaffAssignmentRds, updateStaffExtraRds, getRolesByBuRds, getJobTitlesRds, createRoleRds, deleteRoleRds, deleteRecordRds, listDeletedRecordsRds, restoreRecordRds, createJobTitleRds, createDivisionRds, ensureBridgeDivisionRds, createDepartmentRds, ParentRequiredError, createBusinessUnitRds, getBusinessUnitsListRds, getResourcesByJobTitleRds, getUsersRds, bustUsersRdsCache, getResourceMasterRds, getProjectTeamRds, assignResourceRds, DuplicateAssignmentError, getFieldOptionsRds, updateRecordFieldsRds, getProjectDivisionsRds, updateProjectDivisionRolesRds, getLifecyclesRds, getAllocationUtilizationRds, createLifecycleRds, updateLifecycleRds, deleteLifecycleRds, createScheduleRds, findOrCreateLifecycleForPhasesRds, getTaskDataRds, autoCloseEndedScheduleRds, autoAdvanceScheduleStatusRds, getWeeklyAllocationsRds, saveWeeklyHoursRds, benchResourcesRds, allocationsRds, resourceSkillsAvailabilityRds, companyProjectsRds, peopleSearchRds, peopleProjectsRds, companyContactsRds, createRecordRds, createWorkItemRds, weeklyResourcesRds, businessUnitsRds, resourceDemandSingularRds, departmentsRds, jobTitlesTableRds, roleBillingRatesRds, updateRoleBillingRateRds, roleBillingRatesByDeptRds, updateRoleBillingRateByDeptRds, updateRoleRatesByDeptRds, hasDeptRatesTableRds, renameDivisionRds, relinkDivisionRds, deleteDivisionRds, renameBusinessUnitRds, deleteBusinessUnitRds, renameDepartmentRds, relinkDepartmentRds, deleteDepartmentRds, updateRoleRatesRds, rateCardDeptMapRds, batchUpdateRoleRatesRds, getBulkTeamAssignmentsRds, getBulkScheduleRds, migrateLumpSumAllocationsRds, migrateLumpSumAllocationsAllTenantsRds, reapplyDefaultHoursRds, createOpenPositionRds, consumeOpenSlotsRds, transferOpenSlotsRds, findAutoConsumeOpenSlotRds, removeTeamMemberRds, reconcileFilledOpenSlotsRds, getMemberAssignmentSpanRds, changeTeamResourceRds, ensureDivisionMultiColumn, ensureStatusManualColumn, applySkipRedirects, checkStageFieldLocks, checkRequiredFieldsForStage, bustStageRulesCache, bustStageOrderCache, getStageRulesForTenant, checkStageWritePermission, getStagePermissionSummary, checkWorkflowTypeRestriction, orgAudienceIdsForUser, orgAudienceIdsForUserChecked, orgAudienceIdsByUser, invalidateStaffOrgCache, getStaffCoreRds, getManagersListRds, getManagerStaffRds, getManagerTeamCountsRds, getLeadsDirectoryRds, getLeadTeamContextRds, setAllocationLockRds, setAllocationFlagRds, bustRecordPhaseOrderCache, invalidateDivisionHierarchy, listCompaniesSlim, createCompanyRds, ensureCompanyIdsRds, bustCompaniesSlimCache, getStatusLedger, backfillDecisionDatesRds, backfillDecisionDatesAllTenantsRds, getResourceWeekAllocationsRds, bulkCopyTeamRds, type CreateCompanyBody } from "../lib/rds-provider.js";
import { getCapsForAcl, getResolvedAccessCaps, getCustomLevelName, isCustomAcl, bustAccessControlCache, resolveHiddenNavIds, getNavVisibilityForTenant, getAclChangeEntry, recordAclChange, getUserGroupsForTenant, userAudienceId, type Caps } from "../lib/access-control.js";
import { isFinancialFieldName, splitFinancialFields } from "../lib/financial-fields.js";
import { getPool, isConfigured, startHeartbeat } from "../lib/db.js";
import { bustExtraFieldsCache } from "../lib/rds-extra-fields.js";
import { resolveTenantId, restoreAdminUser, autoResolveAnsweredReviewItems } from "../lib/pipeline.js";
import { createStaffRds, StaffConflictError } from "../lib/staff.js";
import { sendSetPasswordInvite } from "../lib/invites.js";
import { getBusinessRules, getBusinessRulesForTenantStrict } from "../lib/business-rules.js";
import {
  canonicalizeWeeklyHoursRow,
  validateCanonicalWeeklyHoursRow,
  canonicalMondayWeekWindow,
  resolvePastWeekPolicy,
  isWeekLockedByPolicy,
  buildLockedPastWeekError,
  resolvePastWeekRulesOrThrow,
} from "../lib/saveWeeklyHoursGuard.js";
import { upsertOnboardingJob, getActiveTenantRegistry, upsertActiveTenantRegistry, resetMssqlPool, getUsersByTenantAndIds, countActiveOnboardingImports, getOnboardingSettings, upsertOnboardingSettings } from "@workspace/db";
import { recordOrgProvenance, getOrgProvenance, getOnboardingHistorySlimByTenant, getOnboardingJobFileBin, type OrgProvenanceInput } from "@workspace/db";
import { parseExcel } from "../lib/excel.js";
import { importSlotStats } from "../lib/importSlots.js";
import { recordUsage } from "../lib/usage-telemetry.js";
import { boundedAuditChanges, fetchAuditTrail, fetchAuditTrailHealth, handoffTrustedAuditChanges, parseAuditInteraction, setAuditTarget, setTrustedAuditChanges, trustedAuditDiff, type AuditOutcome, type AuditTrailEventKind } from "../lib/auditTrail.js";
import { v4 as uuidv4 } from "uuid";

const router: IRouter = Router();

// Daily Briefing is composed in the browser because it combines several
// tenant-scoped RDS reads with the user's private inbox. Keep the completed
// result in the app database so the next visit can paint immediately, but make
// the key opaque and derive it exclusively from the verified token.
const DAILY_BRIEFING_CACHE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const DAILY_BRIEFING_CACHE_FUTURE_SKEW_MS = 5 * 60 * 1000;

function dailyBriefingCacheScope(
  rds: { tid: string; userId: string },
  role: string,
  window: string,
): string {
  const digest = createHash("sha256")
    .update(`${rds.tid}\u0000${rds.userId}\u0000${role}\u0000${window}`)
    .digest("hex");
  return `daily-briefing-cache:v1:${digest}`;
}

function isUsableDailyBriefingData(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  return Boolean(
    d.hero && typeof d.hero === "object" &&
    d.scan && typeof d.scan === "object" &&
    Array.isArray((d.scan as Record<string, unknown>).kpis) &&
    Array.isArray(d.changes) &&
    Array.isArray(d.notifications) &&
    typeof d.fetchedAt === "number" &&
    Number.isFinite(d.fetchedAt) &&
    d.degraded === false &&
    Array.isArray(d.degradedSources) &&
    d.degradedSources.length === 0,
  );
}

function briefingRoleAndWindow(req: Request): { role: string; window: string } | null {
  const role = typeof req.query.role === "string" ? req.query.role.trim() : "";
  const window = typeof req.query.window === "string" ? req.query.window.trim() : "";
  if (
    !["COO", "CFO", "RESOURCE_MANAGER", "PROJECT_MANAGER", "EXECUTIVE"].includes(role) ||
    window !== "1d"
  ) return null;
  return { role, window };
}

router.get("/daily-briefing-cache", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) return res.status(401).json({ error: "Authentication required" });
  const selection = briefingRoleAndWindow(req);
  if (!selection) return res.status(400).json({ error: "Invalid briefing selection" });

  try {
    const row = await getOnboardingSettings(
      dailyBriefingCacheScope(rds, selection.role, selection.window),
    );
    const data = row?.settings && typeof row.settings === "object"
      ? (row.settings as Record<string, unknown>).data
      : null;
    const fetchedAt = isUsableDailyBriefingData(data)
      ? Number((data as Record<string, unknown>).fetchedAt)
      : NaN;
    const age = Date.now() - fetchedAt;
    if (
      !isUsableDailyBriefingData(data) ||
      !Number.isFinite(age) ||
      age > DAILY_BRIEFING_CACHE_MAX_AGE_MS ||
      age < -DAILY_BRIEFING_CACHE_FUTURE_SKEW_MS
    ) {
      return res.json({ available: false });
    }
    return res.json({
      available: true,
      data,
      savedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
    });
  } catch (e) {
    // Cache failure must never prevent the normal live briefing path.
    console.warn(`[daily-briefing-cache] read failed: ${String(e).slice(0, 180)}`);
    return res.json({ available: false });
  }
});

router.put("/daily-briefing-cache", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) return res.status(401).json({ error: "Authentication required" });
  const selection = briefingRoleAndWindow(req);
  if (!selection || !isUsableDailyBriefingData(req.body?.data)) {
    return res.status(400).json({ error: "Invalid briefing cache payload" });
  }

  const data = req.body.data as Record<string, unknown>;
  const age = Date.now() - Number(data.fetchedAt);
  if (
    !Number.isFinite(age) ||
    age > DAILY_BRIEFING_CACHE_MAX_AGE_MS ||
    age < -DAILY_BRIEFING_CACHE_FUTURE_SKEW_MS
  ) {
    return res.status(400).json({ error: "Briefing cache payload is stale" });
  }

  try {
    await upsertOnboardingSettings({
      scope: dailyBriefingCacheScope(rds, selection.role, selection.window),
      label: "daily briefing",
      settings: { v: 1, role: selection.role, window: selection.window, data },
    });
    return res.json({ ok: true });
  } catch (e) {
    // Saving is best-effort; the caller already has the live result.
    console.warn(`[daily-briefing-cache] write failed: ${String(e).slice(0, 180)}`);
    return res.status(503).json({ error: "Briefing cache unavailable" });
  }
});

// Financial / contract-value field names — shared with the write backstop in
// rds-provider.ts. Lives in lib/financial-fields.ts (single source of truth).

// Server-side enforcement of the financial-edit security default. Returns true
// (and sends a 403/503) when the write must be denied; false to let it proceed.
// Applied at EVERY route that can write to updateRecordFieldsRds.
//
// Behaviour:
//  • Non-financial writes, or upstream RM ONE sessions (resolveRequestSource ===
//    null), are never blocked here.
//  • Fails CLOSED: if the policy cannot be loaded we deny the financial write
//    (503) rather than risk an unguarded edit.
//  • `accessLevel === null` (unset) is grandfathered as allowed. This is a
//    deliberate, app-specific choice — onboarding intentionally leaves the
//    access level unset for most imported users (UserRoleIdLookup omitted), so
//    treating null as "blocked" would lock EVERY freshly-onboarded tenant out
//    of financial edits until an admin level is manually assigned. Known
//    non-admin levels (e.g. "user", "manager") ARE blocked when the rule is on.
async function blockIfFinancialRestricted(
  req: Request,
  res: Response,
  fields: { FieldName?: string }[],
): Promise<boolean> {
  const rds = resolveRequestSource(req);
  if (!rds) return false;
  // Alias-aware: fieldKind() in the provider resolves names like "value" onto
  // the ContractValue column, so the exact-name set alone is bypassable.
  const touchesFinancial = fields.some((f) => isFinancialFieldName(f?.FieldName));
  if (!touchesFinancial) return false;
  // A custom level, or an explicitly customized built-in Manager/User level,
  // owns its financial decision in BOTH directions. Without an override, the
  // historic Manager financial-company-rule behavior remains unchanged.
  const liveC = await resolveLiveAcl(rds);
  if (liveC.identityGone) {
    res.status(403).json({ error: "read_only", error_description: "This account is no longer active. Please contact an administrator." });
    return true;
  }
  try {
    const capResolution = await resolveAccessCaps(liveC, rds.tenant);
    // Manager retains the historic tenant financial rule only until an admin
    // saves an explicit Manager override. Every other resolved level (notably
    // the default User) is governed directly by its capability matrix.
    if (capResolution.caps && (capResolution.explicit || String(liveC.acl).trim().toLowerCase() !== "manager")) {
      if (capResolution.caps.editFinancials) return false;
      console.log(`[financial-gate] blocked ${rds.username}@${rds.tenant} (access level without financial edit)`);
      res.status(403).json({
        error: "financial_edit_restricted",
        error_description: "Your access level doesn't allow editing contract values and other financial fields.",
      });
      return true;
    }
  } catch (e) {
    console.warn(`[financial-gate] caps unavailable for ${rds.username}@${rds.tenant}: ${String(e).slice(0, 120)}`);
    res.status(503).json({
      error: "policy_unavailable",
      error_description: "Cannot verify financial-edit policy right now. Please try again.",
    });
    return true;
  }
  let rules;
  try {
    rules = await getBusinessRules();
  } catch {
    // Fail closed — never let a financial edit through when we cannot confirm
    // the governing policy.
    console.warn(`[financial-gate] policy unavailable; denying financial edit for ${rds.username}@${rds.tenant}`);
    res.status(503).json({
      error: "policy_unavailable",
      error_description: "Cannot verify financial-edit policy right now. Please try again.",
    });
    return true;
  }
  if (!rules.restrictFinancialEditsToAdmin) return false;
  // Use the LIVE DB access level (30s cache) rather than the JWT's login-time
  // value, so mid-session upgrades/downgrades apply here too — same rule as
  // blockIfReadOnly. A deleted/disabled account is never treated as admin.
  const live = await resolveLiveAcl(rds);
  const acl = live.acl == null ? null : String(live.acl).toLowerCase();
  const isAdmin = !live.identityGone && (acl === null || acl === "admin" || acl === "administrator");
  if (isAdmin) return false;
  console.log(`[financial-gate] blocked ${rds.username}@${rds.tenant} (acl=${live.acl}) financial edit`);
  res.status(403).json({
    error: "financial_edit_restricted",
    error_description: "Editing contract values and other financial fields is restricted to administrators.",
  });
  return true;
}

// Server-side enforcement of company STAGE RULES (admin-configured field
// locks — "once a record reaches stage X these fields can't change"). Mirrors
// blockIfFinancialRestricted: returns true (and sends the 403/503) when the
// write must be denied. The same check also runs INSIDE updateRecordFieldsRds
// as a backstop for non-HTTP callers (chat tools, decision agent); this
// route-level twin exists so web saves get a clean 403 with the human
// explanation instead of a generic 502. Applies to ALL users, admins included.
async function blockIfStageLocked(
  req: Request,
  res: Response,
  recordId: string | undefined,
  fields: { FieldName?: string }[],
): Promise<boolean> {
  const rds = resolveRequestSource(req);
  if (!rds || !recordId || !Array.isArray(fields) || fields.length === 0) return false;
  try {
    // #122: identify the acting user so exempt-group members pass their locks.
    const lock = await checkStageFieldLocks(rds.tid, rds.tenant, recordId, fields, undefined, { userId: rds.userId });
    if (lock) {
      console.log(`[stage-rules] blocked ${rds.username}@${rds.tenant} ${recordId}: ${lock.message}`);
      res.status(403).json({ ok: false, error: lock.message, code: "stage_locked", error_description: lock.message });
      return true;
    }
    // Required fields to ENTER a stage (#137) — same friendly-403 treatment.
    const need = await checkRequiredFieldsForStage(rds.tid, rds.tenant, recordId, fields, undefined, { userId: rds.userId });
    if (need) {
      console.log(`[stage-required] blocked ${rds.username}@${rds.tenant} ${recordId}: ${need.message}`);
      res.status(403).json({ ok: false, error: need.message, code: "required_fields_missing", error_description: need.message });
      return true;
    }
    return false;
  } catch (e) {
    // Fail closed — never let a possibly-locked edit through when the policy
    // can't be read (same stance as the financial gate).
    console.warn(`[stage-rules] policy unavailable; denying edit for ${rds.username}@${rds.tenant}: ${String(e).slice(0, 120)}`);
    res.status(503).json({
      ok: false,
      error: "Cannot verify your company's stage rules right now. Please try again.",
      code: "policy_unavailable",
      error_description: "Cannot verify your company's stage rules right now. Please try again.",
    });
    return true;
  }
}

// ── Live access-level resolution (shared by both write gates below) ─────────
// The JWT carries the access level from LOGIN time, which goes stale when an
// admin changes a user's level mid-session (tokens live 12h). Both write gates
// therefore verify the CURRENT DB access level, cached 30s per user so the DB
// pays at most ~2 lookups/min per active editor. Access-level changes take
// effect within 30 seconds in BOTH directions (upgrade unblocks; downgrade
// blocks) — no re-login needed.
//  • DB lookup ERROR → fall back to the JWT's values (availability on a DB
//    blip; never wider than what login granted), uncached so we retry.
//  • User row MISSING or disabled → definitive block: an account deleted or
//    deactivated mid-session must not keep editing on a still-valid token.
interface LiveAcl { acl: string; canEdit: boolean; identityGone: boolean }
const liveAclCache = new Map<string, { v: LiveAcl; exp: number }>();
const LIVE_ACL_TTL_MS = 30_000;
async function resolveLiveAcl(rds: { tenant: string; username: string; accessLevel: string; canEdit: boolean }): Promise<LiveAcl> {
  const key = `${rds.tenant.toLowerCase()}|${rds.username.toLowerCase()}`;
  const hit = liveAclCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.v;
  try {
    const fresh = await lookupUserForLogin(rds.tenant, rds.username);
    let v: LiveAcl;
    if (!fresh && (ROOT_SUPERADMIN_ACCOUNTS as string[]).includes(rds.username.trim().toLowerCase())) {
      // Root superadmin accounts have NO per-tenant roster row by design when
      // they enter a client tenant. Treating that missing row as "identity
      // gone" returned "account no longer active" from record-permissions and
      // silently disabled every record-page edit control (e.g. the schedule
      // Assign button) for the platform owners. Keep the JWT's values instead.
      // A root account that DOES hold a real (possibly disabled) seat in the
      // tenant still resolves through that seat below, unchanged.
      v = { acl: rds.accessLevel, canEdit: canEditFromAcl(rds.accessLevel), identityGone: false };
    } else if (!fresh || fresh.enabled === false) {
      v = { acl: rds.accessLevel, canEdit: false, identityGone: true };
    } else {
      v = { acl: fresh.accessLevel, canEdit: canEditFromAcl(fresh.accessLevel), identityGone: false };
      if (v.canEdit !== rds.canEdit) {
        console.log(`[edit-gate] live ACL differs from JWT for ${rds.username}@${rds.tenant} (jwt=${rds.accessLevel} db=${fresh.accessLevel}) — using DB value`);
      }
    }
    liveAclCache.set(key, { v, exp: Date.now() + LIVE_ACL_TTL_MS });
    return v;
  } catch {
    // DB lookup failed — keep the JWT's values (no cache write so we retry next time)
    return { acl: rds.accessLevel, canEdit: rds.canEdit, identityGone: false };
  }
}

/**
 * Resolve the actual capability bundle for custom roles and for the two
 * configurable built-in roles. `null` intentionally preserves the legacy
 * behavior for Admin/unset/unknown values (grandfathered tenants).
 *
 * `explicit` is true when a saved level definition made the decision. It lets
 * the financial company rule continue to govern an untouched Manager default,
 * while an administrator's explicit built-in override takes precedence.
 */
async function resolveAccessCaps(live: LiveAcl, tenant: string): Promise<{ caps: Caps | null; explicit: boolean }> {
  return getResolvedAccessCaps(live.acl, tenant);
}

// Role-based edit gating for RDS-authenticated requests. Returns true (and sends a
// 403) when the caller is an RDS user whose access level is view-only; returns false
// to let the handler continue. RM ONE-cloud requests (resolveRequestSource === null)
// are never blocked here — the upstream owns their authorization.
export async function blockIfReadOnly(req: Request, res: Response): Promise<boolean> {
  const rds = resolveRequestSource(req);
  if (!rds) return false;
  const live = await resolveLiveAcl(rds);
  if (live.identityGone) {
    console.log(`[edit-gate] blocked ${rds.username}@${rds.tenant} (account deleted or disabled)`);
    res.status(403).json({
      error: "read_only",
      error_description: "This account is no longer active. Please contact an administrator.",
    });
    return true;
  }
  let capResolution: { caps: Caps | null; explicit: boolean };
  try {
    capResolution = await resolveAccessCaps(live, rds.tenant);
  } catch (e) {
    console.warn(`[edit-gate] caps unavailable for ${rds.username}@${rds.tenant}: ${String(e).slice(0, 120)}`);
    res.status(503).json({ error: "policy_unavailable", error_description: "Cannot verify your access level right now. Please try again." });
    return true;
  }
  if (capResolution.caps && !capResolution.caps.editData) {
    console.log(`[edit-gate] blocked ${rds.username}@${rds.tenant} (access level without data edit)`);
    res.status(403).json({ error: "read_only", error_description: "Your access level doesn't allow editing record data. Ask an administrator for help." });
    return true;
  }
  if (!capResolution.caps && !live.canEdit) {
    console.log(`[edit-gate] blocked ${rds.username}@${rds.tenant} (acl=${live.acl})`);
    res.status(403).json({
      error: "read_only",
      error_description: "Your access level is view-only. Ask an administrator or manager to make changes.",
    });
    return true;
  }
  return false;
}

// Field-aware edit gate for RECORD FIELD writes (#87). Same as blockIfReadOnly
// for built-in levels, but for CUSTOM levels each capability governs its own
// field group: editData covers non-financial fields, editFinancials covers
// financial fields — so a "financials only" level can edit contract values
// while everything else stays locked (and vice versa). Fails CLOSED on a cold
// policy read, same stance as every other gate here.
export async function blockIfFieldWriteDenied(
  req: Request,
  res: Response,
  fields: { FieldName?: string }[],
): Promise<boolean> {
  const rds = resolveRequestSource(req);
  if (!rds) return false;
  const live = await resolveLiveAcl(rds);
  if (live.identityGone) {
    console.log(`[edit-gate] blocked ${rds.username}@${rds.tenant} (account deleted or disabled)`);
    res.status(403).json({
      error: "read_only",
      error_description: "This account is no longer active. Please contact an administrator.",
    });
    return true;
  }
  let capResolution: { caps: Caps | null; explicit: boolean };
  try {
    capResolution = await resolveAccessCaps(live, rds.tenant);
  } catch (e) {
    console.warn(`[edit-gate] caps unavailable for ${rds.username}@${rds.tenant}: ${String(e).slice(0, 120)}`);
    res.status(503).json({ error: "policy_unavailable", error_description: "Cannot verify your access level right now. Please try again." });
    return true;
  }
  if (!capResolution.caps && !live.canEdit) {
    console.log(`[edit-gate] blocked ${rds.username}@${rds.tenant} (acl=${live.acl})`);
    res.status(403).json({
      error: "read_only",
      error_description: "Your access level is view-only. Ask an administrator or manager to make changes.",
    });
    return true;
  }
  if (capResolution.caps) {
      const caps = capResolution.caps;
      const { hasFinancial, hasNonFinancial } = splitFinancialFields(fields);
      if (hasNonFinancial && !caps.editData) {
        console.log(`[edit-gate] blocked ${rds.username}@${rds.tenant} (custom level: non-financial fields without edit access)`);
        res.status(403).json({
          error: "read_only",
          error_description: caps.editFinancials
            ? "Your access level only allows editing financial fields (contract values and similar). The other fields are locked."
            : "Your access level is view-only. Ask an administrator to change your access level if you need to make edits.",
        });
        return true;
      }
      if (hasFinancial && !caps.editFinancials) {
        console.log(`[edit-gate] blocked ${rds.username}@${rds.tenant} (custom level: financial fields without financial edit)`);
        res.status(403).json({
          error: "financial_edit_restricted",
          error_description: "Your access level doesn't allow editing contract values and other financial fields.",
        });
        return true;
      }
      const touchesStatus = fields.some((f) => /^(status|stage|crmprojectstatuschoice|crmopportunitystatuschoice)$/i.test(String(f?.FieldName ?? "").trim()));
      if (touchesStatus && (!caps.editData || !caps.advanceStages)) {
        res.status(403).json({
          error: "stage_edit_restricted",
          error_description: "Your access level doesn't allow moving records to a different stage.",
        });
        return true;
      }
  }
  return false;
}

// Staff management gate (#87): only affects CUSTOM access levels — a custom
// level must include the "manage staff" capability to add/edit staff. Built-in
// levels keep today's behavior ("user" acl = view-only). STANDALONE gate — do
// NOT pair it with blockIfReadOnly: manage-staff deliberately works WITHOUT
// the edit-data capability, so a "staff manager only" level can add and edit
// staff while record editing stays locked.
async function blockIfNoStaffCap(req: Request, res: Response): Promise<boolean> {
  const rds = resolveRequestSource(req);
  if (!rds) return false;
  const live = await resolveLiveAcl(rds);
  if (live.identityGone) {
    console.log(`[staff-gate] blocked ${rds.username}@${rds.tenant} (account deleted or disabled)`);
    res.status(403).json({
      error: "read_only",
      error_description: "This account is no longer active. Please contact an administrator.",
    });
    return true;
  }
  let capResolution: { caps: Caps | null; explicit: boolean };
  try {
    capResolution = await resolveAccessCaps(live, rds.tenant);
  } catch (e) {
    console.warn(`[staff-gate] caps unavailable for ${rds.username}@${rds.tenant}: ${String(e).slice(0, 120)}`);
    res.status(503).json({ error: "policy_unavailable", error_description: "Cannot verify your access level right now. Please try again." });
    return true;
  }
  if (!capResolution.caps && !live.canEdit) {
    console.log(`[staff-gate] blocked ${rds.username}@${rds.tenant} (acl=${live.acl})`);
    res.status(403).json({
      error: "read_only",
      error_description: "Your access level is view-only. Ask an administrator or manager to make changes.",
    });
    return true;
  }
  if (capResolution.caps && !capResolution.caps.manageStaff) {
    console.log(`[staff-gate] blocked ${rds.username}@${rds.tenant} (access level without manage-staff)`);
    res.status(403).json({
      error: "staff_restricted",
      error_description: "Your access level doesn't allow managing staff. Ask an administrator for help.",
    });
    return true;
  }
  return false;
}

// Lifecycle templates are company-wide settings. Built-in admins and custom
// levels with manageSettings may mutate them; ordinary record editors may not.
async function blockIfNoSettingsCap(req: Request, res: Response): Promise<boolean> {
  const rds = resolveRequestSource(req);
  if (!rds) return false;
  const live = await resolveLiveAcl(rds);
  const acl = String((live.identityGone ? "user" : live.acl) ?? "unset").trim().toLowerCase() || "unset";
  if (live.identityGone) {
    res.status(403).json({
      error: "settings_restricted",
      error_description: "This account is no longer active. Please contact an administrator.",
    });
    return true;
  }
  if (!isCustomAcl(acl) && acl !== "manager" && acl !== "user") {
    if (acl === "admin" || acl === "administrator" || acl === "unset") return false;
    res.status(403).json({
      error: "settings_restricted",
      error_description: "Only administrators can manage lifecycle templates.",
    });
    return true;
  }
  try {
    const capResolution = await resolveAccessCaps(live, rds.tenant);
    if (capResolution.caps?.manageSettings === true) return false;
    res.status(403).json({
      error: "settings_restricted",
      error_description: "Your access level doesn't allow managing lifecycle templates.",
    });
    return true;
  } catch (e) {
    console.warn(`[settings-gate] caps unavailable for ${rds.username}@${rds.tenant}: ${String(e).slice(0, 120)}`);
    res.status(503).json({
      error: "policy_unavailable",
      error_description: "Cannot verify settings access right now. Please try again.",
    });
    return true;
  }
}

// Per-stage write permissions + custom-level stage caps (#87). Mirrors
// blockIfStageLocked: returns true (and sends the 403/503) when the write must
// be denied. The same check also runs inside updateRecordFieldsRds as a
// backstop for non-HTTP callers (chat tools). Uses the LIVE acl so a level
// change applies within ~30s, and the token's user id for stage assignments.
export async function blockIfStagePermissionDenied(
  req: Request,
  res: Response,
  recordId: string | undefined,
  fields: { FieldName?: string }[],
): Promise<boolean> {
  const rds = resolveRequestSource(req);
  if (!rds || !recordId || !Array.isArray(fields) || fields.length === 0) return false;
  const live = await resolveLiveAcl(rds);
  try {
    const denial = await checkStageWritePermission(rds.tid, rds.tenant, recordId, fields, {
      userId: rds.userId,
      acl: live.identityGone ? rds.accessLevel : live.acl,
    });
    if (!denial) return false;
    console.log(`[stage-perms] blocked ${rds.username}@${rds.tenant} ${recordId} (${denial.code}): ${denial.message}`);
    res.status(403).json({ ok: false, error: denial.message, code: denial.code, error_description: denial.message });
    return true;
  } catch (e) {
    console.warn(`[stage-perms] policy unavailable; denying edit for ${rds.username}@${rds.tenant}: ${String(e).slice(0, 120)}`);
    res.status(503).json({
      ok: false,
      error: "Cannot verify your company's stage permissions right now. Please try again.",
      code: "policy_unavailable",
      error_description: "Cannot verify your company's stage permissions right now. Please try again.",
    });
    return true;
  }
}

// Workflow-type group restrictions (#121). Mirrors blockIfStagePermissionDenied:
// returns true (and sends the 403/503) when the write must be denied. Only
// fires when the write SETS a group-restricted workflow type — clearing it,
// unknown values, and unrestricted types pass through. Applies to admins too
// (same stance as stage locks). The same check re-runs inside
// updateRecordFieldsRds as a backstop for non-HTTP callers (chat tools).
export async function blockIfWorkflowTypeDenied(
  req: Request,
  res: Response,
  recordId: string | undefined,
  fields: { FieldName?: string; Value?: string }[],
): Promise<boolean> {
  const rds = resolveRequestSource(req);
  if (!rds || !recordId || !Array.isArray(fields) || fields.length === 0) return false;
  try {
    const denial = await checkWorkflowTypeRestriction(rds.tid, rds.tenant, recordId, fields, { userId: rds.userId });
    if (!denial) return false;
    console.log(`[workflow-type] blocked ${rds.username}@${rds.tenant} ${recordId}: ${denial.message}`);
    res.status(403).json({ ok: false, error: denial.message, code: "workflow_type_restricted", error_description: denial.message });
    return true;
  } catch (e) {
    // The check reads policy ONLY for writes that touch the workflow type, so
    // this catch means a gated write met an unreadable policy — fail closed.
    console.warn(`[workflow-type] policy unavailable; denying edit for ${rds.username}@${rds.tenant}: ${String(e).slice(0, 120)}`);
    res.status(503).json({
      ok: false,
      error: "Cannot verify your company's workflow type restrictions right now. Please try again.",
      code: "policy_unavailable",
      error_description: "Cannot verify your company's workflow type restrictions right now. Please try again.",
    });
    return true;
  }
}

/**
 * Returns true if `token` is a currently-valid RDS-issued JWT (self-verifying
 * via SESSION_SECRET). Used by paid AI endpoints to authenticate callers.
 * Kept exported for card-insights.ts / alerts.ts.
 */
export async function isValidSessionToken(token: string | null | undefined): Promise<boolean> {
  return !!token && !!verifyRdsToken(token);
}

/**
 * GET /api/rmone/effective-display-modes — the signed-in viewer's RESOLVED
 * project/opportunity display modes: tenant base values with the SAME
 * audience/exception semantics the web applies client-side (ordered
 * first-match-wins exception rows; legacy ApplyMode/GroupIds fallback).
 * Built for WRITE-time gates on clients that cannot resolve audiences
 * locally (the mobile schedule-window clamp). Deliberately UNCACHED so a
 * settings change is honored at the very next write decision, and failures
 * are a loud 5xx — callers must treat "mode unknown" explicitly (no clamp;
 * the server's own assign gate is the backstop), never assume a mode.
 */
router.get("/effective-display-modes", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  try {
    const uid = String(rds.userId ?? "").trim().toLowerCase();
    // Same membership recipe as /my-capabilities: user groups + the user's
    // own sentinel + live org sentinels. Unlike there, failures are NOT
    // swallowed — an incomplete membership set would resolve the WRONG mode
    // for audience-scoped tenants, so this read fails loud instead. That
    // includes the org chain: the CHECKED variant keeps "unresolved" as
    // null (the plain one flattens it to an empty set, which would quietly
    // mis-resolve except/org-sentinel rules) and buildViewerMemberships
    // throws on it → 5xx → the mobile write gate fails closed.
    let memberships: string[] | null = null;
    if (uid) {
      const gdoc = await getUserGroupsForTenant(rds.tenant);
      const orgIds = await orgAudienceIdsForUserChecked(rds.tid, uid);
      memberships = buildViewerMemberships(
        uid,
        gdoc.groups.filter((g) => g.memberIds.includes(uid)).map((g) => g.id),
        userAudienceId(uid),
        orgIds,
      );
    }
    const effective = await loadEffectiveDefaults(rds.tenant);
    res.json(resolveViewerDisplayModes(effective, memberships));
  } catch (e) {
    console.error("[effective-display-modes] failed:", e);
    res.status(500).json({ error: "effective-display-modes failed" });
  }
});

/**
 * GET /api/rmone/my-capabilities — what the signed-in user may do, resolved
 * server-side from the LIVE access level (#87). The web reads this instead of
 * re-implementing capability logic, so display and enforcement can't drift.
 * Built-in levels report today's effective behavior; custom levels report
 * their configured capabilities (a deleted level reports view-only).
 */
router.get("/my-capabilities", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  try {
    const live = await resolveLiveAcl(rds);
    const acl = String((live.identityGone ? "user" : live.acl) ?? "unset").trim().toLowerCase() || "unset";
    // Self-lockout escape hatch: when the LAST change to this user's level was
    // made BY THEMSELVES (e.g. an admin testing a restricted level), offer a
    // self-service revert to the previous level. Set by someone else → none.
    let selfRevert: { to: string; label: string } | null = null;
    if (!live.identityGone) {
      try {
        const entry = await getAclChangeEntry(rds.tenant, rds.userId);
        const selfId = String(rds.userId ?? "").trim().toLowerCase();
        // The entry must be self-made AND still describe the CURRENT level
        // (entry.next === acl). A mismatch means someone changed the level
        // since (possibly with a failed log write) — offer nothing.
        if (entry && selfId && entry.by === selfId && entry.next !== null && entry.next === acl) {
          const prevLow = entry.prev ?? "unset";
          if (prevLow !== acl) {
            let label: string;
            if (isCustomAcl(prevLow)) {
              label = (await getCustomLevelName(prevLow, rds.tenant)) ?? "your previous level";
            } else {
              label = prevLow === "admin" ? "Admin" : prevLow === "manager" ? "Manager" : prevLow === "user" ? "User (view only)" : "your previous level";
            }
            selfRevert = { to: prevLow, label };
          }
        }
      } catch { /* display-only — the revert route re-checks everything */ }
    }
    // User-group memberships (#121): lets the web app filter group-restricted
    // workflow types client-side. Display-only — every write path re-checks
    // membership server-side, so a blip here just hides options.
    let groupIds: string[] = [];
    try {
      const uid = String(rds.userId ?? "").trim().toLowerCase();
      if (uid) {
        const gdoc = await getUserGroupsForTenant(rds.tenant);
        groupIds = gdoc.groups.filter((g) => g.memberIds.includes(uid)).map((g) => g.id);
        // The user's own sentinel ("user:<id>") rides along too, so every
        // client-side membership check covers "Only specific people"
        // audiences with zero extra client logic.
        groupIds.push(userAudienceId(uid));
        // Live org-audience sentinels (org:bu/div/dept) ride along so every
        // client-side membership check (locks, layouts, skips, workflow types,
        // audience-scoped rules) covers BU/Division/Department audiences with
        // zero extra client logic. Display-only — server re-checks writes.
        try { groupIds.push(...await orgAudienceIdsForUser(rds.tid, uid)); } catch { /* display-only */ }
      }
    } catch { /* display-only */ }
    if (isCustomAcl(acl)) {
      const caps = (await getCapsForAcl(acl, rds.tenant)) ?? {
        editData: false, advanceStages: false, editFinancials: false, manageStaff: false, manageSettings: false, importPage: false,
      };
      const levelName = await getCustomLevelName(acl, rds.tenant);
      res.json({ acl, source: "custom", levelName, caps, canImport: caps.importPage === true && caps.editData === true, canSettings: caps.manageSettings === true, selfRevert, groupIds });
      return;
    }
    // Built-ins: resolve through the same matrix as every write gate. Unset and
    // unknown legacy values retain their historical admin-like display only.
    const isAdminish = acl === "admin" || acl === "administrator" || acl === "unset";
    const isManager = acl === "manager";
    const isUser = acl === "user";
    const capResolution = await resolveAccessCaps(live, rds.tenant);
    let caps: Caps = capResolution.caps ?? {
      editData: !isUser,
      advanceStages: !isUser,
      editFinancials: !isUser,
      manageStaff: !isUser,
      manageSettings: isAdminish,
      importPage: isAdminish,
    };
    // The financial tenant rule applies only to an untouched Manager. An
    // explicit Manager override (including a partial one) is authoritative.
    if (isManager && !capResolution.explicit) {
      try {
        const rules = await getBusinessRules();
        caps = { ...caps, editFinancials: !rules.restrictFinancialEditsToAdmin };
      } catch {
        caps = { ...caps, editFinancials: false }; // financial gate fails closed on policy errors
      }
    }

    // canImport: whether this user may see the Import page (fail closed —
    // admins always pass, everyone else needs the capability on their level).
    const canImport = isAdminish || (caps.importPage === true && caps.editData === true);

    res.json({
      acl,
      source: "builtin",
      levelName: null,
      caps,
      canImport,
      canSettings: isAdminish || caps.manageSettings === true,
      selfRevert,
      groupIds,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /api/rmone/record-permissions/:recordId — server-evaluated "may I edit
 * data / advance the stage of THIS record right now?" for the signed-in user
 * (#87). Combines the custom-level capability ceiling with the per-stage
 * assignments at the record's CURRENT stage. Display-only (writes re-enforce
 * fail-closed); degrades to the acl-only answer on a policy blip.
 */
router.get("/record-permissions/:recordId", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  const recordId = String(req.params.recordId ?? "").trim();
  if (!recordId) { res.status(400).json({ error: "recordId required" }); return; }
  try {
    const live = await resolveLiveAcl(rds);
    if (live.identityGone) {
      res.json({ canEditData: false, canAdvanceStage: false, canEditFinancials: false, reason: "This account is no longer active." });
      return;
    }
    const summary = await getStagePermissionSummary(rds.tid, rds.tenant, recordId, {
      userId: rds.userId,
      acl: live.acl,
    });
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /api/rmone/my-navigation — menu item ids HIDDEN for the signed-in user
 * (#88), resolved server-side from the tenant's navigation config + the
 * user's group memberships. Superadmins always get the full superadmin nav
 * (their sidebar isn't configurable), and built-in admins keep the
 * admin-protected screens no matter what the config says. Display-only and
 * fail-OPEN: on any policy blip the user keeps their full menu — page data
 * stays behind the #87 capability gates regardless.
 */
router.get("/my-navigation", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  if (isSuperAdminSource(rds)) { res.json({ hidden: [], order: [], labels: {}, surfaces: {} }); return; }
  try {
    const live = await resolveLiveAcl(rds);
    const acl = String((live.identityGone ? "user" : live.acl) ?? "unset").trim().toLowerCase() || "unset";
    // Mirrors the web shell's isAdmin (grandfathered "unset" counts as admin);
    // custom levels are never built-in admins, so they get no nav exemption —
    // they also never see the admin screens in the first place.
    const isAdminUser = !isCustomAcl(acl) && (acl === "admin" || acl === "administrator" || acl === "unset");
    const [hidden, doc] = await Promise.all([
      resolveHiddenNavIds(rds.tenant, rds.userId, isAdminUser, acl),
      getNavVisibilityForTenant(rds.tenant),
    ]);
     res.json({ hidden, order: doc.order ?? [], labels: doc.labels ?? {}, surfaces: doc.surfaces ?? {} });
  } catch {
     res.json({ hidden: [], order: [], labels: {}, surfaces: {}, degraded: true });
  }
});

router.post("/debug-log", (req: Request, res: Response) => {
  const entries = Array.isArray(req.body) ? req.body : [req.body];
  for (const e of entries) {
    console.log("[MOBILE-DEBUG]", typeof e === "string" ? e : JSON.stringify(e));
  }
  res.json({ ok: true });
});

router.post("/token", async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, string>;
    // RDS-only: authenticate against core2 and issue our own JWT.
    // Users not found in core2 receive invalid_grant — there is no upstream fallback.
    if (body.username && body.password && body.tenant) {
      try {
        const t0 = Date.now();
        // Login must never wait out the pool's 120 s requestTimeout on a dead
        // connection (observed in prod during "pool error: operation timed
        // out" bursts). Cap the first attempt at 3 s; on timeout drop the app
        // DB pool and retry once on a fresh connection (7 s cap).
        // Total worst-case: ~10 s — keeps the round-trip under the hosting
        // proxy's timeout so the browser receives a proper response rather
        // than a 502 from the proxy.
        const lookupWithCap = (ms: number) => {
          let timer: NodeJS.Timeout | undefined;
          return Promise.race([
            lookupUserForLogin(body.tenant, body.username),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`login lookup timed out after ${ms}ms`)), ms); }),
          ]).finally(() => clearTimeout(timer));
        };
        let user: Awaited<ReturnType<typeof lookupUserForLogin>>;
        try {
          user = await lookupWithCap(3_000);
        } catch (firstErr) {
          console.warn(`[token] login lookup retry after: ${String(firstErr).slice(0, 120)}`);
          // Don't hard-reset the shared app-DB pool while an import pipeline
          // is running — the reset would abort its in-flight queries. Lazy
          // import avoids a static circular dependency (onboarding.ts already
          // imports from this module).
          let importActive = false;
          try {
            const { isImportActive } = await import("./onboarding.js");
            importActive = isImportActive();
          } catch { /* treat as inactive */ }
          if (importActive) {
            console.warn("[token] app-DB pool reset SKIPPED — import in progress");
          } else {
            resetMssqlPool();
          }
          user = await lookupWithCap(7_000);
        }
        if (user && user.passwordHash) {
          if (!user.enabled) {
            res.status(403).json({ error: "account_disabled", error_description: "This account is disabled." });
            return;
          }
          if (verifyPassword(body.password, user.passwordHash)) {
            const token = signRdsToken({ sub: user.id, tenant: body.tenant, username: user.userName, role: user.role, accessLevel: user.accessLevel });
            console.log(`[token] RDS login for ${user.userName}@${body.tenant} (acl=${user.accessLevel}) in ${Date.now() - t0}ms`);
            // Usage telemetry (#482): successful logins are the anchor event
            // for adoption/frequency analytics. Sync push, never blocks.
            recordUsage({ tenant: body.tenant, userId: user.id, username: user.userName, role: user.role }, "login");
            // Fire-and-forget: start warming the home-screen caches NOW so
            // the dashboard data is ready by the time the home page loads.
            // Also broadcast to the other cluster workers — home requests are
            // round-robined, so every worker needs its caches warm.
            try {
              const warmTid = resolveTenantId(body.tenant);
              warmHomeCaches(warmTid, body.tenant);
              // Remember this tenant so boot-time warming and the periodic
              // re-warm scheduler keep its caches hot from now on.
              noteActiveTenant(warmTid, body.tenant);
              broadcastBust({ type: "warmHome", tid: warmTid, tenant: body.tenant });
            } catch { /* best-effort */ }
            // UserRoles (the person's job title, e.g. "Chief Financial Officer")
            // is included directly in the login response so the frontend can
            // persist + render the correct role persona IMMEDIATELY, without
            // depending on the follow-up /profile fetch (which, when slow or
            // failed, left the title blank → badge fell back to "Project Mgr").
            res.json({ access_token: token, token_type: "bearer", expires_in: TOKEN_TTL, userName: user.userName, tenant: body.tenant, src: "rds", AccessLevel: user.accessLevel, CanEdit: canEditFromAcl(user.accessLevel), UserRoles: user.role || "" });
            return;
          }
          // User exists in our AWS DB but the password is wrong: reject here
          // rather than leaking the attempt to the RM ONE cloud.
          res.status(400).json({ error: "invalid_grant", error_description: "The user name or password is incorrect." });
          return;
        }
      } catch (rdsErr) {
        console.log(`[token] RDS auth check failed: ${String(rdsErr).slice(0, 200)}`);
        res.status(502).json({ error: "server_error", error_description: "Login service unavailable." });
        return;
      }
    }
    // No matching RDS user / missing credentials. There is no upstream fallback.
    res.status(400).json({ error: "invalid_grant", error_description: "The user name or password is incorrect." });
  } catch (e) {
    res.status(502).json({ error: "server_error", detail: String(e) });
  }
});

router.post("/logout", async (_req: Request, res: Response) => {
  // RDS sessions are stateless JWTs — nothing to revoke.
  res.json({ ok: true });
});

router.get("/profile", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const profile = await getRdsProfile(rds.tenant, rds.username);
    if (profile) { res.json(profile); return; }
    res.status(404).json({ error: "profile_not_found" });
  } catch (e) {
    res.status(502).json({ error: "server_error", detail: String(e) });
  }
});

router.post("/assign-resource", async (req: Request, res: Response) => {
  try {
    if (await blockIfNoStaffCap(req, res)) return;
    const payload = req.body as {
      ProjectID?: string;
      Allocations?: Record<string, unknown>[];
      ConsumeOpenSlotRaIds?: number[];
      RequireOpenSlotSelection?: boolean;
      // Record-aware clients resolve "do member dates follow the phase
      // schedule?" themselves (per-record display-mode overrides live in
      // client storage, invisible to the server) and pass the answer here.
      // TIGHTEN-ONLY: `true` turns enforcement on for this save; `false` and
      // absent both defer to the server-derived rule (tenant mode for the
      // record's module). Request input must never DISABLE the server gate.
      ScheduleWindowEnabled?: boolean;
    };

      if (!payload.ProjectID || !Array.isArray(payload.Allocations) || payload.Allocations.length === 0) {
        res.status(400).json({ error: "ProjectID and Allocations[] are required" });
        return;
      }

      const rds = resolveRequestSource(req);
      if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
      try {
        const result = await assignResourceRds(
          payload.ProjectID, payload.Allocations, rds.tid, rds.username, rds.tenant,
          { scheduleWindowEnabled: typeof payload.ScheduleWindowEnabled === "boolean" ? payload.ScheduleWindowEnabled : undefined },
        );
        setAuditTarget(res, { entityType: "allocation", entityId: payload.ProjectID });
        const auditResult = result as { auditChanges?: unknown };
        if (auditResult.auditChanges) {
          res.locals["auditChanges"] = auditResult.auditChanges;
          delete auditResult.auditChanges;
        }
        console.log(`[assign-resource][rds] ${rds.username}@${rds.tenant} project=${payload.ProjectID} →`, JSON.stringify(result));
        // When this assignment FILLS an open position, TRANSFER the demand
        // rows behind it onto the new member in place — that hands over the
        // imported weekly hours and every other stored column (SoftAllocation,
        // NonChargeable, IsLocked, rates, …) instead of discarding them, and
        // the slot stops showing as a phantom open position. Only when the
        // save produced no unambiguous person↔work-item link (e.g. several
        // people assigned at once) fall back to the legacy consume
        // (soft-delete) so the slot never lingers. Both paths are
        // tenant-scoped and restricted to still-open (ResourceUser NULL) rows
        // inside the provider, so a stale ID list can never touch real
        // allocations. Best-effort: a failure must not fail the assignment.
        if (Array.isArray(payload.ConsumeOpenSlotRaIds) && payload.ConsumeOpenSlotRaIds.length > 0) {
          try {
            // A client can submit the same id twice or a malformed value; never
            // broaden the destructive request beyond the selected, valid RA IDs.
            const selectedOpenSlotRaIds = [...new Set(payload.ConsumeOpenSlotRaIds
              .filter((id): id is number => Number.isInteger(id) && id > 0))];
            if (selectedOpenSlotRaIds.length === 0) {
              console.warn("[assign-resource][rds] ignored malformed explicit open-slot selection");
            } else {
            const links = (result as { assigned?: { rwiId: number; personId: string }[] })?.assigned ?? [];
            // Dedupe identical person↔RWI pairs so a save that touched the
            // same assignment more than once still counts as ONE link.
            const uniqLinks = [...new Map(links.map((l) => [`${l.rwiId}|${l.personId}`, l])).values()];
            const link = uniqLinks.length === 1 ? uniqLinks[0] : null;
            if (link) {
              const n = await transferOpenSlotsRds(rds.tid, String(payload.ProjectID), selectedOpenSlotRaIds, link.personId, link.rwiId, rds.username);
              console.log(`[assign-resource][rds] transferred ${n} open-slot demand row(s) to rwi=${link.rwiId} for project=${payload.ProjectID}`);
            } else {
              const n = await consumeOpenSlotsRds(rds.tid, String(payload.ProjectID), selectedOpenSlotRaIds, rds.username);
              console.log(`[assign-resource][rds] consumed ${n} open-slot demand row(s) for project=${payload.ProjectID} (no single assign link)`);
            }
            }
          } catch (e) {
            console.warn(`[assign-resource][rds] open-slot transfer failed (assignment saved): ${String(e)}`);
          }
        } else if (!payload.RequireOpenSlotSelection && payload.Allocations.length === 1) {
          // AUTO-RETIRE a matching open slot: members added through the normal
          // Add Member flow (or mobile) never carry ConsumeOpenSlotRaIds, so
          // the demand row survived forever — the project kept showing
          // "1 open role to fill / OVERDUE" even after a person with that
          // exact role was added (client-reported). When the save added
          // exactly ONE member, look for a still-open slot with the same role
          // whose window overlaps the new assignment (or the role's single
          // open slot) and CONSUME it (soft-delete). Consume — NOT transfer —
          // because this flow writes its own hours; transferring the demand
          // rows onto the member would double-count their allocation.
          // Best-effort: a failure must not fail the assignment.
          try {
            const a = payload.Allocations[0] as Record<string, unknown>;
            // TypeName carries the SELECTED ROLE in the Add Member payload
            // (assignResourceRds derives RWI.Title from it); Title/JobTitleName
            // carry the job-title text. Open slots store either, so match all.
            const names = [a.TypeName, a.Title, a.JobTitleName]
              .map((v) => (typeof v === "string" ? v.trim() : ""))
              .filter(Boolean) as string[];
            if (names.length > 0) {
              const match = await findAutoConsumeOpenSlotRds(
                rds.tid, String(payload.ProjectID), names,
                typeof a.AllocationStartDate === "string" ? a.AllocationStartDate : undefined,
                typeof a.AllocationEndDate === "string" ? a.AllocationEndDate : undefined,
              );
              if (match) {
                const n = await consumeOpenSlotsRds(rds.tid, String(payload.ProjectID), match.raIds, rds.username);
                if (n > 0) console.log(`[assign-resource][rds] auto-retired open slot "${match.role}" (${n} demand row(s)) filled by manual add on project=${payload.ProjectID}`);
              }
            }
          } catch (e) {
            console.warn(`[assign-resource][rds] open-slot auto-consume failed (assignment saved): ${String(e)}`);
          }
        }
        // Bust the team cache for this project ON ALL WORKERS so the client's
        // immediate refetch reflects the new assignment no matter which
        // cluster worker serves it (also clears Timeline utilisation caches).
        // Also bust the weekly-allocations cache — the Hours View's edit grid
        // reads it and a new/changed assignment must appear there immediately
        // (previously it could serve a pre-assignment snapshot for up to 2 min).
        bustProjectTeamCache(rds.tid, String(payload.ProjectID));
        bustWeeklyAllocCache(rds.tid, String(payload.ProjectID));
        // Also bust the tid-keyed resource-allocations route cache (and its
        // inner rds-provider cache) on ALL workers — the Resources page's
        // Timeline and Staff tabs read GET /resource-allocations, and without
        // this bust they keep showing the pre-save assignment for up to the
        // full 5-min TTL.
        bustResourceAllocCache(req.headers.authorization ?? "");
        bustResAllocsRouteCache(rds.tid);
        // Financial analytics: assigning a member changes planned/assigned hours.
        bustFinancialCache(rds.tid);
        broadcastBust({ type: "bustCache", fn: "finAnalytics", tid: rds.tid });
        // When the save auto-extended the record's Target End (no-schedule
        // projects whose new member end ran past it), bust the project-detail
        // cache too so the record shows the new end date immediately.
        if ((result as { targetEndExtended?: string })?.targetEndExtended) {
          bustProjectDetailCache(rds.tid, String(payload.ProjectID));
        }
        // Re-warm both Hours View caches in the background so the next open of
        // the Hours View doesn't block on a cold rebuild.
        warmProjectHoursCaches(rds.tid, rds.tenant, String(payload.ProjectID));
        res.json(result);
      } catch (e) {
        console.warn(`[assign-resource][rds] failed: ${String(e)}`);
        if (e instanceof DuplicateAssignmentError) {
          res.status(409).json({
            error: e.code,
            Message: e.message,
            existingAssignmentId: e.existingAssignmentId,
          });
          return;
        }
        res.status(502).json({ error: "Error saving assignment to core2", detail: String(e) });
      }
  } catch (e) {
    console.log("[AssignResource] ← error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// POST /reconcile-open-slots — one-time / admin-triggered sweep (#347): retire
// still-open demand slots that an EXISTING active team member already covers.
// The live auto-retire in /assign-resource only fires when a member is ADDED,
// so slots filled manually BEFORE that fix shipped stayed stuck as "open role
// to fill / OVERDUE" (client-reported: PMM-26-005's Project Coordinator).
// Matching is identical to the live path by construction (the sweep reuses
// the same provider matcher per member): case-insensitive role, "(N)" suffix
// stripped, MANDATORY date overlap, fail closed on ambiguity. Retirement =
// consumeOpenSlotsRds soft-delete, tenant-scoped, still-open rows only.
// Admin-only. Body: { ProjectID?: string, dryRun?: boolean } — omit ProjectID
// to sweep every project in the tenant that still has open demand rows;
// dryRun reports what would be retired without writing.
router.post("/reconcile-open-slots", async (req: Request, res: Response) => {
  try {
    if (await blockIfReadOnly(req, res)) return;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    // Admin gate: built-in admins (grandfathered "unset" counts, mirroring the
    // web shell's isAdmin) and superadmins only — this is a maintenance sweep
    // that soft-deletes demand rows across the whole tenant.
    if (!isSuperAdminSource(rds)) {
      const live = await resolveLiveAcl(rds);
      const acl = String((live.identityGone ? "user" : live.acl) ?? "unset").trim().toLowerCase() || "unset";
      const isAdminUser = !live.identityGone && !isCustomAcl(acl) && (acl === "admin" || acl === "administrator" || acl === "unset");
      if (!isAdminUser) {
        res.status(403).json({
          error: "admin_only",
          error_description: "Reconciling open roles is restricted to administrators.",
        });
        return;
      }
    }
    const body = (req.body ?? {}) as { ProjectID?: string; dryRun?: boolean };
    const projectId = typeof body.ProjectID === "string" && body.ProjectID.trim() ? body.ProjectID.trim() : undefined;
    const dryRun = body.dryRun === true;
    const result = await reconcileFilledOpenSlotsRds(rds.tid, rds.username, projectId, dryRun);
    setAuditTarget(res, { entityType: "allocation", entityId: projectId ?? "tenant-wide", entityName: projectId ?? "Open slot reconciliation", action: "delete.allocation" });
    if (!dryRun) {
      const details = result.projects.flatMap((p) => p.retired.map((x) => ({
        FieldName: `Consumed slot ${p.projectId} / ${x.role}`,
        OldValue: `${x.rowsRemoved} open demand row(s)`,
        NewValue: `Assigned to ${x.matchedMember}`,
      })));
      setTrustedAuditChanges(res, boundedAuditChanges(details, result.totalSlotsRetired));
    }
    console.log(`[reconcile-open-slots] ${rds.username}@${rds.tenant} scope=${projectId ?? "ALL"} dryRun=${dryRun} → retired ${result.totalSlotsRetired} slot(s) / ${result.totalRowsRemoved} row(s) across ${result.projects.length} project(s)`);
    // Bust the caches of every project the sweep touched so team cards and
    // allocation views drop the retired slots immediately (writes only).
    if (!dryRun && result.projects.length > 0) {
      for (const p of result.projects) {
        bustProjectTeamCache(rds.tid, p.projectId);
        bustWeeklyAllocCache(rds.tid, p.projectId);
      }
      bustResourceAllocCache(req.headers.authorization ?? "");
      bustResAllocsRouteCache(rds.tid);
      bustFinancialCache(rds.tid);
      broadcastBust({ type: "bustCache", fn: "finAnalytics", tid: rds.tid });
    }
    res.json({ ok: true, ...result });
  } catch (e) {
    console.warn(`[reconcile-open-slots] failed: ${String(e)}`);
    res.status(502).json({ error: "reconcile_failed", detail: String(e) });
  }
});

// Remove a team member from a project/opportunity/lead: soft-deletes every
// allocation + work-item row for the person on the record. Gated on the
// MANAGE-STAFF capability (blockIfNoStaffCap, standalone — see its doc):
// view-only users 403, and custom access levels need "manage staff" — the
// same setting that governs the flags column. Client mandate. The actor's
// login + a UTC timestamp are logged below; the UI confirm popup promises
// exactly that, so keep the log line if this route is ever reworked.
router.post("/remove-team-member", async (req: Request, res: Response) => {
  try {
    if (await blockIfNoStaffCap(req, res)) return;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const body = (req.body ?? {}) as { ProjectID?: string; ResourceUser?: string };
    const pid = String(body.ProjectID ?? "").trim();
    const person = String(body.ResourceUser ?? "").trim();
    if (!pid || !person) {
      res.status(400).json({ error: "ProjectID and ResourceUser are required" });
      return;
    }
    try {
      const result = await removeTeamMemberRds(rds.tid, pid, person, rds.username);
      setAuditTarget(res, { entityType: "allocation", entityId: pid, entityName: person, action: "delete.allocation" });
      handoffTrustedAuditChanges(res, result);
      console.log(`[remove-team-member][rds] actor=${rds.username}@${rds.tenant} project=${pid} person=${person} at=${new Date().toISOString()} →`, JSON.stringify(result));
      // Same cache busts as /assign-resource: team card, weekly allocations
      // (Hours View), resource-allocations (Resources page Timeline/Staff).
      bustProjectTeamCache(rds.tid, pid);
      bustWeeklyAllocCache(rds.tid, pid);
      bustResourceAllocCache(req.headers.authorization ?? "");
      bustResAllocsRouteCache(rds.tid);
      // Financial analytics: removing a member drops their hours from all aggregates.
      bustFinancialCache(rds.tid);
      broadcastBust({ type: "bustCache", fn: "finAnalytics", tid: rds.tid });
      // Re-warm the Hours View caches in the background so the next open
      // doesn't block on a cold rebuild.
      warmProjectHoursCaches(rds.tid, rds.tenant, pid);
      res.json(result);
    } catch (e) {
      console.warn(`[remove-team-member][rds] failed: ${String(e)}`);
      res.status(502).json({ error: "Error removing team member", detail: String(e) });
    }
  } catch (e) {
    console.log("[RemoveTeamMember] ← error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// Change resource: replace WHO does the remaining work on an assignment.
// History stays put — every week up to and including the current one remains
// on the outgoing member; everything from next Monday onward moves to the
// incoming person. Same manage-staff gate as member removal (client mandate),
// and the actor's login + a UTC timestamp are logged just like removals.
// Orchestration: ① pre-scan the outgoing member's assignment span, ② create
// the incoming person's work item through the SAME assignResourceRds path the
// Add Member modal uses (division/title resolution + schedule-window gate all
// apply), ③ hand the future allocation rows over in one transaction.
router.post("/change-team-resource", async (req: Request, res: Response) => {
  try {
    if (await blockIfNoStaffCap(req, res)) return;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const body = (req.body ?? {}) as {
      ProjectID?: string; FromResourceUser?: string; Allocations?: Record<string, unknown>[];
      // Same record-aware schedule-window flag as /assign-resource — the
      // forced container span below runs through the identical assign gates.
      // TIGHTEN-ONLY: `true` enforces; `false`/absent defer to the
      // server-derived rule. Request input can never disable the gate.
      ScheduleWindowEnabled?: boolean;
    };
    const pid = String(body.ProjectID ?? "").trim();
    const from = String(body.FromResourceUser ?? "").trim();
    const alloc = Array.isArray(body.Allocations) ? body.Allocations[0] : undefined;
    const to = String(alloc?.AssignedTo ?? "").trim();
    if (!pid || !from || !alloc || !to) {
      res.status(400).json({ error: "ProjectID, FromResourceUser and one Allocations[] entry with AssignedTo are required" });
      return;
    }
    if (from.toLowerCase() === to.toLowerCase()) {
      res.status(400).json({ error: "same_person", Message: "Pick a different person — they already hold this assignment." });
      return;
    }
    try {
      // Cutover = next Monday (UTC midnight). The current week always stays
      // with the outgoing member — weekly allocation rows start on Mondays.
      const now = new Date();
      const add = ((8 - now.getUTCDay()) % 7) || 7;
      const cutover = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + add));
      const cutoverYmd = cutover.toISOString().slice(0, 10);

      const span = await getMemberAssignmentSpanRds(rds.tid, pid, from);
      if (!span) {
        res.status(404).json({ error: "not_on_team", Message: "That team member isn't on this record any more — refresh the page and try again." });
        return;
      }
      // Incoming person's container: starts at the cutover (or the outgoing
      // member's start when the whole assignment is still in the future) and
      // runs to the assignment's end — never an inverted range.
      const startMs = Math.max(cutover.getTime(), span.minStart ? span.minStart.getTime() : cutover.getTime());
      const endMs = Math.max(span.maxEnd ? span.maxEnd.getTime() : startMs, startMs);
      const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      const overridden = {
        ...alloc,
        AllocationStartDate: ymd(startMs),
        AllocationEndDate: ymd(endMs),
        // The transfer hands hours over row-by-row — the container itself
        // always starts empty, exactly like a fresh Add Member.
        PctAllocation: 0,
      };

      const result = await assignResourceRds(
        pid, [overridden], rds.tid, rds.username, rds.tenant,
        { scheduleWindowEnabled: typeof body.ScheduleWindowEnabled === "boolean" ? body.ScheduleWindowEnabled : undefined },
      ) as {
        ok?: boolean; Status?: boolean; assigned?: { rwiId: number; personId: string }[];
        targetEndExtended?: string; Message?: string; error?: string;
      };
      if (result && result.ok === false) {
        // Schedule-window / availability rejections surface verbatim — the
        // modal shows result.Message just like a normal Add Member save.
        res.json(result);
        return;
      }
      const links = [...new Map((result?.assigned ?? []).map((l) => [`${l.rwiId}|${l.personId}`, l])).values()];
      const link = links.length === 1 ? links[0] : links.find((l) => l.personId === to);
      if (!link) {
        res.status(502).json({ error: "no_assign_link", Message: "The new assignment saved but couldn't be linked for the hand-over. Refresh the page — the new person may already be on the team." });
        return;
      }

      let transfer;
      try {
        transfer = await changeTeamResourceRds(rds.tid, pid, from, to, link.rwiId, cutover, rds.username);
      } catch (e) {
        // The assign step above already committed: the incoming person is on
        // the team (empty container), but the hand-over transaction rolled
        // back atomically — no hours moved. Report the partial state honestly
        // instead of a generic failure, and bust caches so the UI shows the
        // new member that DID save.
        console.warn(`[change-team-resource][rds] transfer failed AFTER assign committed: ${String(e)}`);
        bustProjectTeamCache(rds.tid, pid);
        bustWeeklyAllocCache(rds.tid, pid);
        bustResourceAllocCache(req.headers.authorization ?? "");
        bustResAllocsRouteCache(rds.tid);
        bustFinancialCache(rds.tid);
        broadcastBust({ type: "bustCache", fn: "finAnalytics", tid: rds.tid });
        res.json({
          Status: false,
          error: "transfer_failed",
          assignCommitted: true,
          Message:
            "The new person was added to the team, but the hours hand-over didn't complete — no hours were moved. Refresh the page, then retry Change Resource on the original member (or remove the new member if you've changed your mind).",
        });
        return;
      }
      console.log(`[change-team-resource][rds] actor=${rds.username}@${rds.tenant} project=${pid} from=${from} to=${to} cutover=${cutoverYmd} at=${new Date().toISOString()} →`, JSON.stringify(transfer));
      setAuditTarget(res, { entityType: "allocation", entityId: pid, action: "update.allocation" });
      setTrustedAuditChanges(res, [
        { FieldName: "Resource", OldValue: from, NewValue: to },
        { FieldName: "Cutover date", OldValue: null, NewValue: cutoverYmd },
      ]);

      // Union of the /assign-resource + /remove-team-member cache busts: team
      // card, weekly allocations (Hours View), resource-allocations
      // (Resources page Timeline/Staff), plus project detail when the save
      // auto-extended the record's Target End.
      bustProjectTeamCache(rds.tid, pid);
      bustWeeklyAllocCache(rds.tid, pid);
      bustResourceAllocCache(req.headers.authorization ?? "");
      bustResAllocsRouteCache(rds.tid);
      if (result?.targetEndExtended) bustProjectDetailCache(rds.tid, pid);
      // Financial analytics: hours move from old to new person → aggregates change.
      bustFinancialCache(rds.tid);
      broadcastBust({ type: "bustCache", fn: "finAnalytics", tid: rds.tid });
      warmProjectHoursCaches(rds.tid, rds.tenant, pid);

      res.json({
        Status: true,
        cutover: cutoverYmd,
        moved: transfer.moved,
        split: transfer.split,
        truncated: transfer.truncated,
        dropped: transfer.dropped,
        synthesized: transfer.synthesized,
        oldMemberRemoved: transfer.oldMemberRemoved,
        targetEndExtended: result?.targetEndExtended,
      });
    } catch (e) {
      console.warn(`[change-team-resource][rds] failed: ${String(e)}`);
      res.status(502).json({ error: "Error changing resource", detail: String(e) });
    }
  } catch (e) {
    console.log("[ChangeTeamResource] ← error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// Remove an OPEN (unfilled) position from a record: soft-deletes the still-
// open demand rows by RA id. Same manage-staff gate as member removal.
// consumeOpenSlotsRds only ever touches rows that are still open (ResourceUser
// NULL/blank, TicketId-scoped) — a stale or crafted id list can never delete a
// real person's allocation rows. Actor login + UTC timestamp are logged; the
// UI confirm popup promises this.
router.post("/remove-open-position", async (req: Request, res: Response) => {
  try {
    if (await blockIfNoStaffCap(req, res)) return;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const body = (req.body ?? {}) as { ProjectID?: string; raIds?: unknown };
    const pid = String(body.ProjectID ?? "").trim();
    const raIds = Array.isArray(body.raIds)
      ? body.raIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    if (!pid || raIds.length === 0) {
      res.status(400).json({ error: "ProjectID and raIds are required" });
      return;
    }
    try {
      const auditChanges: Array<{ FieldName: string; OldValue: unknown; NewValue: unknown }> = [];
      const removed = await consumeOpenSlotsRds(rds.tid, pid, raIds, rds.username, auditChanges);
      console.log(`[remove-open-position][rds] actor=${rds.username}@${rds.tenant} project=${pid} raIds=${raIds.join(",")} removed=${removed} at=${new Date().toISOString()}`);
      if (removed === 0) {
        // Nothing matched: the slot was filled or removed in the meantime.
        res.status(409).json({ error: "not_open", error_description: "This open position was already filled or removed. Refresh to see the latest team." });
        return;
      }
      setAuditTarget(res, { entityType: "allocation", entityId: pid, action: "delete.allocation" });
      if (auditChanges.length) setTrustedAuditChanges(res, boundedAuditChanges(auditChanges, auditChanges.length));
      // Same cache busts as /remove-team-member — open rows ride the
      // /project-team response and share the ResourceAllocation table with
      // the Resources page's demand + timeline reads.
      bustProjectTeamCache(rds.tid, pid);
      bustWeeklyAllocCache(rds.tid, pid);
      bustResourceAllocCache(req.headers.authorization ?? "");
      bustResAllocsRouteCache(rds.tid);
      // Financial analytics: open positions count as planned hours.
      bustFinancialCache(rds.tid);
      broadcastBust({ type: "bustCache", fn: "finAnalytics", tid: rds.tid });
      warmProjectHoursCaches(rds.tid, rds.tenant, pid);
      res.json({ Status: true, removed });
    } catch (e) {
      console.warn(`[remove-open-position][rds] failed: ${String(e)}`);
      res.status(502).json({ error: "Error removing open position", detail: String(e) });
    }
  } catch (e) {
    console.log("[RemoveOpenPosition] ← error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// Create an open position (unfilled headcount) on a project or opportunity:
// one ResourceAllocation row with ResourceUser NULL. Surfaces on the project
// team card, Demand tab, and projects grid open-role chips.
router.post("/open-position", async (req: Request, res: Response) => {
  try {
    // Open positions are staffing changes. Manage staff is deliberately
    // standalone and must work for a customized built-in User even when Edit
    // data is off, matching add/remove/reassign team-member routes.
    if (await blockIfNoStaffCap(req, res)) return;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await createOpenPositionRds(rds.tid, body, rds.username);
    if (result.Status === false) {
      res.status(400).json(result);
      return;
    }
    const pid = String(body.ProjectID ?? body.TicketId ?? "");
    setAuditTarget(res, { entityType: "allocation", entityId: pid, entityName: String(body.Role ?? body.Title ?? "") });
    handoffTrustedAuditChanges(res, result);
    // Same cache busts as /assign-resource: team card, resource-allocations
    // (Timeline/Staff tabs) and the demand route all read this data.
    bustProjectTeamCache(rds.tid, pid);
    bustResourceAllocCache(req.headers.authorization ?? "");
    bustResAllocsRouteCache(rds.tid);
    // Financial analytics: new open position adds planned demand hours.
    bustFinancialCache(rds.tid);
    broadcastBust({ type: "bustCache", fn: "finAnalytics", tid: rds.tid });
    console.log(`[open-position][rds] ${rds.username}@${rds.tenant} project=${pid} →`, JSON.stringify(result));
    res.json(result);
  } catch (e) {
    console.warn(`[open-position][rds] failed: ${String(e)}`);
    res.status(502).json({ error: "Error creating open position", detail: String(e) });
  }
});

// NOTE (Apr 2026): "Value promotion" was previously used to copy
// LaborContractAmount (or other fallback fields) into ApproxContractValue
// when the latter was empty. Per client direction, this is now disabled —
// ApproxContractValue and LaborContractAmount are conceptually different
// (total contract revenue vs. labor portion) and silently substituting one
// for the other was misleading. Each field is now surfaced under its own
// label on the UI. Function kept (no-op) so call sites compile; remove once
// all references are gone.
function promoteValueOnRecord(_rec: Record<string, unknown>): void {
  // intentionally no-op — see note above
}

router.get("/project/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    try {
      const requestedModule = String(req.query["module"] ?? "").toUpperCase();
      const forcedModule = requestedModule === "PMM" || requestedModule === "OPM" || requestedModule === "LEM"
        ? requestedModule
        : undefined;
      const cacheKey = pdKey(rds.tid, String(id), forcedModule);
      const now = Date.now();
      // ForceFresh (post-write refetch, mirrors /resource-allocations): the
      // instant refetch after a record-field save (e.g. Target date edit)
      // can land on a sibling worker whose cross-worker bust IPC hasn't
      // arrived yet — its warm cache would serve the PRE-write record and
      // the client would show the old values again. fresh=1 busts THIS
      // worker's entry (the gen bump also discards any pre-save snapshot
      // still in flight) and falls through to the cold-miss single-flight,
      // so the response is always post-write.
      if (String(req.query["fresh"] ?? "") === "1") bustProjectDetailLocal(cacheKey);
      const hit = projectDetailCache.get(cacheKey);
      // Record the open in the hot-projects LRU (IPC-shared across workers)
      // so the scheduled re-warm keeps this project's caches warm around the
      // clock — the next open, even hours later, is served from memory.
      // Hover prefetches send ?prefetch=1 and are NOT counted: a hover is not
      // an open, and it must never enroll a project in perpetual team rewarms
      // or evict genuinely-opened projects from the 8-slot LRU.
      if (req.query["prefetch"] !== "1") {
        noteHotProject(rds.tid, rds.tenant, String(id));
        // Usage telemetry (#482): a real record open (hover prefetches are
        // excluded by the same gate as the hot-projects LRU above).
        recordUsage(rds, "tx", "record_open", { context: String(id) });
      }

      // Fresh hit → instant, no DB
      if (hit && hit.expiresAt > now) { res.json(hit.data); return; }

      // Stale within grace → instant + silent background refresh
      if (hit && hit.expiresAt + PROJECT_DETAIL_STALE_GRACE_MS > now) {
        res.json(hit.data);
        if (!projectDetailInFlight.has(cacheKey)) {
          const startGen = projectDetailGen.get(cacheKey) ?? 0;
          const bg = rdsGetRecordDetail(String(id), rds.tid, rds.tenant, forcedModule)
            .then((d) => {
              const data = d ?? { Status: false, Data: null };
              setProjectDetailCacheIfCurrent(cacheKey, startGen, data);
              projectDetailInFlight.delete(cacheKey);
              return data;
            })
            .catch((e) => { projectDetailInFlight.delete(cacheKey); console.warn(`[project][rds] bg-refresh failed for ${id}: ${String(e)}`); return null; });
          projectDetailInFlight.set(cacheKey, bg);
        }
        return;
      }

      // Cold miss → single-flight: concurrent opens for the same project share 1 DB query
      let inflight = projectDetailInFlight.get(cacheKey);
      if (!inflight) {
        const startGen = projectDetailGen.get(cacheKey) ?? 0;
        inflight = rdsGetRecordDetail(String(id), rds.tid, rds.tenant, forcedModule)
          .then((d) => {
            const data = d ?? { Status: false, Data: null };
            setProjectDetailCacheIfCurrent(cacheKey, startGen, data);
            projectDetailInFlight.delete(cacheKey);
            return data;
          })
          .catch((e) => { projectDetailInFlight.delete(cacheKey); throw e; });
        projectDetailInFlight.set(cacheKey, inflight);
      }
      res.json(await inflight);
    } catch (e) {
      console.warn(`[project][rds] detail failed for ${id}: ${String(e)}`);
      res.status(502).json({ Status: false, error: "Error fetching record from core2" });
    }
  });

router.put("/project", async (req: Request, res: Response) => {
    try {
      const rds = resolveRequestSource(req);
      if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
      if (await blockIfReadOnly(req, res)) return;
      const { RecordId, Fields } = req.body as { RecordId: string; Fields: { FieldName: string; Value: string }[] };
      // Skip-rule enforcement: rewrite status targets BEFORE the friendly
      // gates so locks/required-fields/stage-perms judge the stage the record
      // will ACTUALLY land on (same wiring as /update-fields).
      const skipRedirect = await applySkipRedirects(rds.tid, rds.tenant, RecordId, Fields ?? []);
      const effFields = skipRedirect.fields;
      if (await blockIfFinancialRestricted(req, res, effFields)) return;
      if (await blockIfStageLocked(req, res, RecordId, effFields)) return;
      if (await blockIfStagePermissionDenied(req, res, RecordId, effFields)) return;
      if (await blockIfWorkflowTypeDenied(req, res, RecordId, effFields)) return;
      const result = await updateRecordFieldsRds(RecordId, effFields, rds.tid, rds.tenant,
        { actor: { userId: rds.userId, acl: rds.accessLevel, username: rds.username } });
      console.log(`[UpdateRecord][rds] ${rds.username}@${rds.tenant} ${RecordId} →`, JSON.stringify(result));
      recordUsage(rds, "tx", "project_save", { context: String(RecordId ?? "") }); // usage telemetry (#482)
      bustProjectDetailCache(rds.tid, RecordId);
      bustDivRolesCache(rds.tid, RecordId);
      if (skipRedirect.redirectedTo && !result.landedStage) result.landedStage = skipRedirect.redirectedTo;
      // Same audit hand-off as /update-fields: real before→after for the
      // observer, stripped from the client payload.
      handoffTrustedAuditChanges(res, result);
      res.json(result);
    } catch (e) {
      console.log("[UpdateRecord] ← error:", String(e));
      res.status(502).json({ error: "Upstream error", detail: String(e) });
    }
  });


router.get("/resource-allocations", async (req: Request, res: Response) => {
    try {
      const rds = resolveRequestSource(req);
      if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
      const cacheKey = rds.tid;
      // ForceFresh (post-write refetch, mirrors getFullProjectAllocations):
      // the instant refetch after a staff add/edit can land on a cluster
      // worker whose cross-worker bust IPC hasn't arrived yet — its warm
      // cache would serve the PRE-write roster and the client re-caches it
      // for minutes ("my edit didn't save"). fresh=1 busts THIS worker's
      // caches (route + inner rds-provider) and falls through to the
      // cold-miss single-flight, so the response is always post-write.
      if (String(req.query["fresh"] ?? "") === "1") bustResAllocsLocal(cacheKey);
      const now = Date.now();
      const hit = resAllocsCache.get(cacheKey);

      // Fresh hit → instant, no DB
      if (hit && hit.expiresAt > now) { res.json(hit.data); return; }

      // Stale within grace → instant + background refresh. A degraded hit
      // (failure residue cached 30s with no healthy predecessor) is EXCLUDED:
      // serving it from grace would hand the client's 30s healing poll the
      // same degraded copy back for up to 6h. Fall through to the cold-miss
      // single-flight instead so the poll waits on a live query and heals in
      // one cycle.
      if (hit && hit.expiresAt + RES_ALLOCS_STALE_MS > now && !resAllocsDegraded(hit.data)) {
        res.json(hit.data);
        if (!resAllocsInFlight.has(cacheKey)) {
          const startGen = resAllocsGen.get(cacheKey) ?? 0;
            let bg!: Promise<unknown>;
            bg = (rdsGetResourceAllocations(rds.tid, rds.tenant) as Promise<unknown>)
              .then((d) => { setResAllocsCacheIfCurrent(cacheKey, startGen, d); clearResAllocsInFlightIfCurrent(cacheKey, bg); return d; })
              .catch((e) => { clearResAllocsInFlightIfCurrent(cacheKey, bg); console.warn(`[resource-allocations][rds] bg-refresh: ${String(e)}`); return null; });
          resAllocsInFlight.set(cacheKey, bg);
        }
        return;
      }

      // Cold miss → single-flight: all concurrent home-screen loads share 1 DB query
      try {
        let inflight = resAllocsInFlight.get(cacheKey);
        if (!inflight) {
          const startGen = resAllocsGen.get(cacheKey) ?? 0;
          let created!: Promise<unknown>;
          created = (rdsGetResourceAllocations(rds.tid, rds.tenant) as Promise<unknown>)
            .then((d) => {
              const result = d as { total?: number; resources?: unknown[] };
              console.log(`[resource-allocations] tid=${rds.tid} total=${result?.total ?? "?"} resources=${result?.resources?.length ?? 0}`);
              setResAllocsCacheIfCurrent(cacheKey, startGen, d);
              clearResAllocsInFlightIfCurrent(cacheKey, created);
              return d;
            })
            .catch((e) => { clearResAllocsInFlightIfCurrent(cacheKey, created); throw e; });
          inflight = created;
          resAllocsInFlight.set(cacheKey, created);
        }
        res.json(await inflight);
      } catch (e) {
        console.warn(`[resource-allocations][rds] failed: ${String(e)}`);
        res.status(502).json({ error: "Error fetching allocations from core2" });
      }
    } catch (e) {
      res.status(502).json({ error: String((e as Error)?.message ?? e) });
    }
  });


/**
 * GET /api/rmone/resource-week-allocations
 * Tenant-scoped weekly workload for a single resource over a date range.
 *
 * Query params:
 *   resourceId  – GUID of the person (required)
 *   start       – YYYY-MM-DD range start (required, Monday-aligned recommended)
 *   end         – YYYY-MM-DD range end   (required)
 *
 * Returns ResourceWeekAllocations shape:
 *   { resourceId, start, end, fullWeekHours, weeks: [ { projectId, projectName,
 *     weekStart, weekEnd, hours, pct, allocationIds, isLocked,
 *     isNonChargeable, isSoftAllocation }, … ] }
 *
 * Errors: 400 on bad input, 401 when unauthenticated, 500/502 on DB failure.
 * No fake empty results: a DB error returns 502, not an empty weeks array.
 */
router.get("/resource-week-allocations", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }

    const resourceId = String(req.query["resourceId"] ?? "").trim();
    const start      = String(req.query["start"]      ?? "").trim();
    const end        = String(req.query["end"]         ?? "").trim();

    if (!resourceId) {
      res.status(400).json({ error: "resourceId is required" }); return;
    }
    if (!start || !end) {
      res.status(400).json({ error: "start and end query parameters are required (YYYY-MM-DD)" }); return;
    }

    // Basic GUID format validation — reject obviously injected values before
    // they reach SQL (the provider also validates dates).
    const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!GUID_RE.test(resourceId)) {
      res.status(400).json({ error: "resourceId must be a valid GUID" }); return;
    }
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      res.status(400).json({ error: "start and end must be YYYY-MM-DD dates" }); return;
    }
    if (end < start) {
      res.status(400).json({ error: "end must be >= start" }); return;
    }

    const result = await getResourceWeekAllocationsRds(rds.tid, resourceId, start, end, rds.tenant);
    res.json(result);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // Surface validation errors (thrown by the provider for bad inputs) as 400;
    // everything else is a genuine DB / server error → 502.
    const isValidation = /required|must be|invalid|>= start/i.test(msg);
    console.warn(`[resource-week-allocations] failed: ${msg}`);
    res.status(isValidation ? 400 : 502).json({ error: msg });
  }
});


/**
 * GET /api/rmone/projects
 * Fetches the list of projects for the logged-in user.
 * Returns: { projects: [{id, name, ...}] } or { error }
 */
router.get("/projects", async (req: Request, res: Response) => {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    try {
      // Serve from the shared PMM records cache (same data /records/PMM
      // returns, kept hot by the warmers) instead of a raw ~2 s SQL query
      // on every call — this route is on the login critical path (the home
      // overlay's projectList source).
      const recs = (await getRecordsCached(rds.tid, rds.tenant, "PMM")) as { data?: unknown[] } | null;
      res.json({ projects: recs?.data ?? [] });
    } catch (e) {
      console.warn(`[my-projects][rds] failed: ${String(e)}`);
      res.status(502).json({ error: "Error fetching projects from core2" });
    }
  });

/**
 * GET /api/rmone/records/:module
 * Fetches all records for a given RM ONE module (PMM, OPM, LEM, COM, CON).
 * Returns a slimmed-down payload with only the fields useful for the mobile app.
 * Results are cached server-side for 5 minutes to avoid hammering RM ONE.
 */
// Token-keyed records cache. Key contract: entries MUST be keyed
// `<scope>:<recordCacheTokenHash(authHeader)>` — bustRecordCache clears a
// user's entries by that suffix on THIS worker and broadcasts the same hash
// to every sibling (cluster IPC case "recordToken"), so a writer using any
// other suffix would silently escape post-save invalidation.
const recordCache = new Map<string, { data: unknown; expiresAt: number }>();
const inFlight   = new Map<string, Promise<void>>();   // dedup simultaneous requests
const CACHE_TTL_MS = 5 * 60 * 1000;

// ── RDS records cache (projects/opps/leads list) ─────────────────────────────
// The /records/:module endpoint returns ALL records for a module — the heaviest
// call in the app. Add SWR + single-flight so 400 concurrent users never block
// on a cold miss or post-write cache bust.
const RECORDS_TTL_MS = 3 * 60 * 1000;
// Long stale grace: past the TTL a hit is served INSTANTLY from cache while a
// background refresh runs. Writes always bust this cache explicitly
// (bustRdsRecordsCache), so a long grace never shows post-write stale data —
// it only avoids the 5-10 s cold RDS query blocking the home page after a
// quiet period. Same reasoning for the allocations/demands caches below.
const RECORDS_STALE_GRACE_MS = 6 * 60 * 60 * 1000;
const recordsCache = new Map<string, { data: unknown; expiresAt: number }>();
const recordsInFlight = new Map<string, Promise<unknown>>();
// Generation counter per tid (same pattern as resAllocsGen below): a records
// query captures the generation when it STARTS and only writes its result if
// no bust happened while it was in flight. Without this, a query that began
// mid-import (e.g. the projects page's empty-state poll) finishes AFTER the
// post-import bust and silently re-caches the pre-import list as fresh.
const recordsGen = new Map<string, number>();

/** Cache the result only if no bust invalidated this tid mid-query. */
function setRecordsCacheIfCurrent(key: string, tid: string, startGen: number, data: unknown): void {
  if ((recordsGen.get(tid) ?? 0) !== startGen) return; // busted mid-flight — discard
  recordsCache.set(key, { data, expiresAt: Date.now() + RECORDS_TTL_MS });
  capMap(recordsCache, CACHE_MAX_PROJECTS);
}

/** Local-only bust (also used when applying a cross-worker IPC message). */
function bustRdsRecordsLocal(tid: string, module?: string): void {
  recordsGen.set(tid, (recordsGen.get(tid) ?? 0) + 1);
  capMap(recordsGen, CACHE_MAX_ORG);
  if (module) {
    recordsCache.delete(`${tid}:${module}`);
    recordsInFlight.delete(`${tid}:${module}`);
  } else {
    for (const k of recordsCache.keys()) if (k.startsWith(`${tid}:`)) recordsCache.delete(k);
    for (const k of recordsInFlight.keys()) if (k.startsWith(`${tid}:`)) recordsInFlight.delete(k);
  }
}

export function bustRdsRecordsCache(tid: string, module?: string): void {
  bustRdsRecordsLocal(tid, module);
  broadcastBust({ type: "bustCache", fn: "records", tid, module });
}

/**
 * Shared SWR + single-flight read of a module's records through the
 * recordsCache. Used by BOTH /records/:module and /projects — /projects
 * previously called the provider directly, paying a raw ~2 s SQL query on
 * every home-screen login even though the identical PMM list was sitting
 * warm in this cache (kept hot by the login/periodic warmers).
 *
 * Every fetch into this cache uses the provider's LIST view (see
 * lib/records-list-slim.ts): empty values omitted, identical alias twins
 * deduped, long note fields truncated (test20 PMM ~2.9 MB → ~0.5 MB). Server
 * code reading rows out of this cache (e.g. /projects, the post-import
 * project warmer) must therefore only rely on populated list fields — full
 * rows come from rdsGetRecords(...) without the view option, or from the
 * detail path.
 */
async function getRecordsCached(tid: string, tenant: string, module: string): Promise<unknown> {
  const cacheKey = `${tid}:${module}`;
  const now = Date.now();
  const hit = recordsCache.get(cacheKey);

  // Fresh hit → instant
  if (hit && hit.expiresAt > now) return hit.data;

  // Stale within grace → instant + background refresh
  if (hit && hit.expiresAt + RECORDS_STALE_GRACE_MS > now) {
    if (!recordsInFlight.has(cacheKey)) {
      const startGen = recordsGen.get(tid) ?? 0;
      const bg: Promise<unknown> = rdsGetRecords(module, tid, tenant, { view: "list" })
        .then((d) => { setRecordsCacheIfCurrent(cacheKey, tid, startGen, d); recordsInFlight.delete(cacheKey); return d; })
        .catch((e) => { recordsInFlight.delete(cacheKey); console.warn(`[records][rds] bg-refresh ${module}: ${String(e)}`); return null; });
      recordsInFlight.set(cacheKey, bg);
    }
    return hit.data;
  }

  // Cold miss → single-flight: concurrent callers share 1 DB query
  let inflight = recordsInFlight.get(cacheKey);
  if (!inflight) {
    const startGen = recordsGen.get(tid) ?? 0;
    inflight = rdsGetRecords(module, tid, tenant, { view: "list" })
      .then((d) => { setRecordsCacheIfCurrent(cacheKey, tid, startGen, d); recordsInFlight.delete(cacheKey); return d; })
      .catch((e) => { recordsInFlight.delete(cacheKey); throw e; });
    recordsInFlight.set(cacheKey, inflight);
  }
  return inflight;
}

// ── RDS resource-allocations cache ───────────────────────────────────────────
// Called by _fetchHomeOverlay (Promise.all) on every home-screen load.
// Without this, every dashboard open hits SQL Server raw. 5-min TTL matches
// the allocation-utilization warmer cycle; 2-min stale grace means zero wait
// on repeat visits even right after TTL expires.
const RES_ALLOCS_TTL_MS   = 5 * 60 * 1000;
const RES_ALLOCS_STALE_MS = 6 * 60 * 60 * 1000; // see RECORDS_STALE_GRACE_MS note
const resAllocsCache    = new Map<string, { data: unknown; expiresAt: number }>();
const resAllocsInFlight = new Map<string, Promise<unknown>>();
// Generation counter per tid. Bumped on every bust. A recompute captures the
// generation when its DB query STARTS and only writes its result into the
// cache if no bust happened while the query was in flight. Without this, a
// query that started before a write (e.g. another user's page load) finishes
// after the bust and silently repopulates the cache with pre-write data —
// the new staff member then stays invisible for the full 5-min TTL.
const resAllocsGen = new Map<string, number>();

// Degraded payloads (_degraded set: the provider survived a partial DB failure
// via a fallback — zeros/dashes instead of real numbers) are failure residue.
// Cache them only briefly, and NEVER let one overwrite a healthy cached roster:
// with the 6-hour stale grace below, a single degraded write would otherwise
// pin an all-zeros Staff grid on screen long after the DB recovered.
const RES_ALLOCS_DEGRADED_TTL_MS = 30 * 1000;
function resAllocsDegraded(o: unknown): boolean {
  return !!(o as { _degraded?: unknown } | null | undefined)?._degraded;
}
function resAllocsHealthy(o: unknown): boolean {
  const d = o as { _degraded?: unknown; resources?: unknown[] } | null | undefined;
  return !!d && !d._degraded && Array.isArray(d.resources) && d.resources.length > 0;
}

/** Cache the result only if no bust invalidated this tid mid-query. */
function setResAllocsCacheIfCurrent(tid: string, startGen: number, data: unknown): void {
  if ((resAllocsGen.get(tid) ?? 0) !== startGen) return; // busted mid-flight — discard
  if (resAllocsDegraded(data)) {
    const prev = resAllocsCache.get(tid);
    if (prev && resAllocsHealthy(prev.data)) {
      // Keep the healthy roster on screen; just retry soon.
      prev.expiresAt = Math.max(prev.expiresAt, Date.now() + RES_ALLOCS_DEGRADED_TTL_MS);
      return;
    }
    resAllocsCache.set(tid, { data, expiresAt: Date.now() + RES_ALLOCS_DEGRADED_TTL_MS });
    capMap(resAllocsCache, CACHE_MAX_ORG);
    return;
  }
  resAllocsCache.set(tid, { data, expiresAt: Date.now() + RES_ALLOCS_TTL_MS });
  capMap(resAllocsCache, CACHE_MAX_ORG);
}

/** A pre-bust query must not clear the newer post-bust single-flight entry
 * when it finally settles. It can still respond to its original caller, but
 * it cannot interfere with the canonical fresh query every later reader joins. */
function clearResAllocsInFlightIfCurrent(tid: string, promise: Promise<unknown>): void {
  if (resAllocsInFlight.get(tid) === promise) resAllocsInFlight.delete(tid);
}

/** Local-only bust (also used when applying a cross-worker IPC message). */
function bustResAllocsLocal(tid: string): void {
  resAllocsGen.set(tid, (resAllocsGen.get(tid) ?? 0) + 1);
  capMap(resAllocsGen, CACHE_MAX_ORG);
  resAllocsCache.delete(tid);
  resAllocsInFlight.delete(tid);
  // Demand rows (open positions) live in the SAME ResourceAllocation table,
  // so any write that invalidates allocations also invalidates demands.
  // This is the demands cache's only explicit bust path — keep it here so
  // the long stale grace below never serves post-write stale open positions.
  resDemandsCache.delete(tid);
  resDemandsInFlight.delete(tid);
  // Also clear the rds-provider's inner 5-min cache (_raCache) on THIS worker.
  // Without this, a worker that receives the IPC bust deletes its route cache,
  // then "recomputes" — but rdsGetResourceAllocations serves the pre-write
  // roster from its own inner cache and the stale list gets re-cached as fresh.
  bustResourceAllocationsCache(tid);
  // Allocation writes change utilisation too — drop THIS tenant's Timeline
  // utilisation grids (scoped delete: other tenants' warm caches survive;
  // the old utilCache.clear() wiped every tenant + quarter on every hours
  // save, so the next Timeline open always paid a full cold rebuild).
  // Because this local bust also runs when the IPC "resAllocs" message
  // arrives, every worker does the same.
  for (const k of utilCache.keys()) if (k.startsWith(`util:${tid}:`)) utilCache.delete(k);
  for (const k of utilInFlight.keys()) if (k.startsWith(`util:${tid}:`)) utilInFlight.delete(k);
  // Immediately rebuild the Timeline utilisation grids this tenant was last
  // viewing so the post-save refetch gets FRESH data with near-zero wait.
  // Skip during an active import: the cache will be busted again by the next
  // batch commit anyway, and firing org-wide util queries wastes pool slots.
  // Two signals are OR'd:
  //   • importSlotStats().active > 0  — this worker is the importing worker
  //   • getImportActiveCached()       — another worker (or env) is importing;
  //     detected via a 30s-TTL async-refreshed DB probe so we don't block.
  if (importSlotStats().active === 0 && !getImportActiveCached()) {
    rewarmUtilForTid(tid);
  }
}

/**
 * Bust the tenant-keyed resource-allocations route cache (resAllocsCache).
 * NOTE: this is a DIFFERENT cache from the token-keyed resourceAllocCache
 * cleared by bustResourceAllocCache() — the RDS GET /resource-allocations
 * route serves exclusively from this tid-keyed map, so any write that adds
 * or changes people (e.g. create-staff) must bust it or the Resources page
 * keeps showing the pre-write roster for up to 7 minutes (TTL + grace).
 */
function bustResAllocsRouteCache(tid: string): void {
  bustResAllocsLocal(tid);
  broadcastBust({ type: "bustCache", fn: "resAllocs", tid });
}

// ── RDS resource-demands cache ────────────────────────────────────────────────
// Also called in the same Promise.all. Demand rows (open positions) change
// rarely; a 5-min TTL + 2-min grace gives instant home loads after first hit.
const RES_DEMANDS_TTL_MS   = 5 * 60 * 1000;
// Long stale grace (see RECORDS_STALE_GRACE_MS note). Demands are busted
// alongside allocations in bustResAllocsLocal — demand rows live in the same
// ResourceAllocation table — so demand-changing writes invalidate this too.
const RES_DEMANDS_STALE_MS = 6 * 60 * 60 * 1000;
const resDemandsCache    = new Map<string, { data: unknown; expiresAt: number }>();
const resDemandsInFlight = new Map<string, Promise<unknown>>();

// ── Login-time home cache warmer ─────────────────────────────────────────────
// The home overlay needs allocations + demands + PMM + OPM records. On a cold
// server (fresh restart, or first login after the caches were evicted) each of
// those queries takes 5-10 s against the remote RDS link — which collides with
// the client's overlay time budget and produces "NO LIVE DATA" or a partial
// "1 of N signals" home. Kicking the four queries off at LOGIN means they are
// already resolved (or in flight and shared via the single-flight maps) by the
// time the home page fires its requests a second or two later.
function warmHomeCaches(tid: string, tenant: string): void {
  const now = Date.now();
  try {
    const aHit = resAllocsCache.get(tid);
    // A degraded hit (failure residue) never counts as "warm" — always kick a
    // real refresh so the healthy roster replaces it as soon as the DB is back.
    if (!(aHit && aHit.expiresAt + RES_ALLOCS_STALE_MS > now && !resAllocsDegraded(aHit.data)) && !resAllocsInFlight.has(tid)) {
      const startGen = resAllocsGen.get(tid) ?? 0;
      const p = (rdsGetResourceAllocations(tid, tenant) as Promise<unknown>)
        .then((d) => { setResAllocsCacheIfCurrent(tid, startGen, d); resAllocsInFlight.delete(tid); return d; })
        .catch((e) => { resAllocsInFlight.delete(tid); console.warn(`[warm-home] allocations: ${String(e)}`); return null; });
      resAllocsInFlight.set(tid, p);
    }
    const dHit = resDemandsCache.get(tid);
    if (!(dHit && dHit.expiresAt + RES_DEMANDS_STALE_MS > now) && !resDemandsInFlight.has(tid)) {
      const p = (rdsGetResourceDemands(tid, tenant) as Promise<unknown>)
        .then((d) => { resDemandsCache.set(tid, { data: d, expiresAt: Date.now() + RES_DEMANDS_TTL_MS }); capMap(resDemandsCache, CACHE_MAX_ORG); resDemandsInFlight.delete(tid); return d; })
        .catch((e) => { resDemandsInFlight.delete(tid); console.warn(`[warm-home] demands: ${String(e)}`); return null; });
      resDemandsInFlight.set(tid, p);
    }
    // LEM included: home.tsx requests records/LEM alongside PMM/OPM, and a
    // cold LEM query costs 25s+ even when the Lead table is small.
    for (const module of ["PMM", "OPM", "LEM"]) {
      const key = `${tid}:${module}`;
      const rHit = recordsCache.get(key);
      if (!(rHit && rHit.expiresAt + RECORDS_STALE_GRACE_MS > now) && !recordsInFlight.has(key)) {
        const startGen = recordsGen.get(tid) ?? 0;
        const p = rdsGetRecords(module, tid, tenant, { view: "list" })
          .then((d) => { setRecordsCacheIfCurrent(key, tid, startGen, d); recordsInFlight.delete(key); return d; })
          .catch((e) => { recordsInFlight.delete(key); console.warn(`[warm-home] records ${module}: ${String(e)}`); return null; });
        recordsInFlight.set(key, p);
      }
    }
    // Also pre-warm this tenant's recently-opened ("hot") projects. The
    // periodic re-warm tick already does this every 10 min, but after a server
    // restart or a long idle gap the first login would otherwise still pay the
    // cold detail + 7-join team query on the first project click. Capped at
    // HOT_PROJECT_REFRESH_MAX_PER_TICK and fully single-flight/generation
    // guarded, so a redundant kick here is harmless.
    refreshHotProjectsIfAged(tid, tenant);
    // Seed the Timeline's DEFAULT grid (current quarter, Weekly — exactly what
    // resources.tsx requests on first open) into lastUtilParams before the
    // rewarm below. On a cold server (restart/first login) lastUtilParams is
    // empty, so without this seed the rewarm is a no-op and the first
    // Timeline open pays the full multi-second cold roster rebuild. The date
    // format mirrors buildQuarters() in rmone-web resources.tsx so the cache
    // key matches the client's request byte-for-byte.
    {
      const qNow = new Date();
      const qi = Math.floor(qNow.getMonth() / 3);
      const fmtQ = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const qSd = fmtQ(new Date(qNow.getFullYear(), qi * 3, 1));
      const qEd = fmtQ(new Date(qNow.getFullYear(), qi * 3 + 3, 0));
      noteUtilParams(tid, `util:${tid}:${qSd}:${qEd}:Weekly`, { startDate: qSd, endDate: qEd, mode: "Weekly", tenant });
    }
    // Seed the Forecast page's grid too (Monday of current week + 52 weeks,
    // Weekly — exactly what forecast.tsx requests). Without this seed the
    // first Forecast open after a cold start pays the full multi-second
    // roster rebuild even though the login warm already fetched the
    // allocations it aggregates. Date math mirrors computeForecastWindow()
    // in rmone-web forecastIntelligence.ts (fixed 52-week horizon,
    // Monday-anchored local dates) so the cache key matches the client's
    // request byte-for-byte. Near week boundaries a server/browser timezone
    // gap can anchor to a different Monday — the seed then warms an adjacent
    // window and that first open pays cold once; same accepted tradeoff as
    // the quarter seed above.
    {
      const fMon = new Date();
      const fDow = fMon.getDay(); // 0=Sun ... 6=Sat
      fMon.setDate(fMon.getDate() + (fDow === 0 ? -6 : 1 - fDow));
      const fEnd = new Date(fMon);
      fEnd.setDate(fMon.getDate() + 52 * 7 - 1); // Sunday of week 52
      const fmtF = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const fSd = fmtF(fMon);
      const fEd = fmtF(fEnd);
      noteUtilParams(tid, `util:${tid}:${fSd}:${fEd}:Weekly`, { startDate: fSd, endDate: fEd, mode: "Weekly", tenant });
    }
    // Recruitment analytics (Analytics hub tile + page), default current
    // quarter. Fire-and-forget: fresh-hit check + single-flight inside, and
    // the computed payload is IPC-shared so siblings adopt it too.
    void warmRecruitmentAnalytics(tid, tenant);
    // Re-warm the utilization grids this tenant last viewed (Timeline/Staff),
    // but only the ones whose cache entry is missing or expired — a login
    // must never trigger a redundant rebuild of a fresh grid.
    rewarmUtilForTid(tid, /* onlyStale */ true);
  } catch { /* warming is best-effort — never let it affect login */ }
}

// ── Active-tenant registry + scheduled home-cache re-warm ────────────────────
// Goal: no user ever pays the 30-45s cold-query cost. Three cold windows exist
// without this: (1) api-server restart wipes the in-memory caches, (2) >6h idle
// (e.g. overnight) lets the stale grace expire so the FIRST login of the
// morning goes cold, (3) login-time warming races the client (queries take 30s
// cold; the client fires ~1s after login). Fix: remember which tenants are
// actually used (disk-persisted, survives restarts), re-warm them at boot, and
// keep them warm with a periodic background refresh so the caches never age out.
const ACTIVE_TENANTS_FILE = path.join(process.cwd(), ".data/active-tenants.json");
const ACTIVE_TENANT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // forget after 7 idle days
const ACTIVE_TENANT_MAX = 20;
// Re-warm cadence: every 10 min, refresh any entry whose TTL expired more than
// 15 min ago. With 3-5 min TTLs this caps cache age at ~25-30 min around the
// clock — trivial DB load (a handful of queries per tenant per cycle, and only
// when something actually aged out).
const HOME_REWARM_INTERVAL_MS = 10 * 60 * 1000;
const HOME_REWARM_MAX_AGE_MS  = 15 * 60 * 1000;
// Missing WORKER_ID (e.g. the primary process importing this module) is
// treated as NOT lead — matches index.ts's default and avoids two "leads"
// after a worker respawn.
const IS_LEAD_WORKER = process.env["WORKER_ID"] === "0";

const activeTenants = new Map<string, { tenant: string; lastActiveAt: number }>();
let activeTenantsSaveTimer: NodeJS.Timeout | null = null;

// ── Hot-projects LRU (per tenant) ─────────────────────────────────────────────
// The projects a tenant's users actually OPEN. The scheduled re-warm keeps
// their detail + team caches warm so a project-card click is served from
// memory even hours later. Recorded in GET /project/:id, IPC-shared across
// workers (same reason as warmHome: requests round-robin, so an open seen by
// one worker must heat all of them), persisted with the tenant registry so
// it survives restarts AND deploys.
const HOT_PROJECTS_PER_TENANT = 8;
type HotProject = { id: string; at: number };
const hotProjects = new Map<string, HotProject[]>();

/** Update this worker's LRU only (no broadcast — also the IPC echo handler). */
function noteHotProjectLocal(tid: string, projectId: string): void {
  if (!tid || !projectId) return;
  const list = hotProjects.get(tid) ?? [];
  const next = [{ id: projectId, at: Date.now() }, ...list.filter((p) => p.id !== projectId)];
  hotProjects.set(tid, next.slice(0, HOT_PROJECTS_PER_TENANT));
}

/** Record a real project open: local LRU + cross-worker broadcast + persist. */
function noteHotProject(tid: string, tenant: string, projectId: string): void {
  noteHotProjectLocal(tid, projectId);
  saveActiveTenantsDebounced(); // no-op on non-lead workers
  broadcastBust({ type: "noteHotProject", tid, tenant, projectId });
}

/** Merge a persisted hot-projects list (disk/DB JSON) into the LRU. */
function mergeHotProjects(tid: string, incoming: unknown): void {
  if (!Array.isArray(incoming)) return;
  const cutoff = Date.now() - ACTIVE_TENANT_RETENTION_MS;
  const byId = new Map<string, HotProject>();
  for (const p of [...(hotProjects.get(tid) ?? []), ...(incoming as HotProject[])]) {
    if (!p || typeof p.id !== "string" || typeof p.at !== "number" || p.at < cutoff) continue;
    const prev = byId.get(p.id);
    if (!prev || prev.at < p.at) byId.set(p.id, { id: p.id, at: p.at });
  }
  const merged = [...byId.values()].sort((a, b) => b.at - a.at).slice(0, HOT_PROJECTS_PER_TENANT);
  if (merged.length) hotProjects.set(tid, merged);
}

function loadActiveTenantsFromDisk(): void {
  try {
    if (!fs.existsSync(ACTIVE_TENANTS_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(ACTIVE_TENANTS_FILE, "utf8")) as Record<string, unknown>;
    // v2 format: { __v:2, tenants:{tid:{tenant,lastActiveAt}}, hotProjects:{tid:[{id,at}]} }
    // Legacy (pre hot-projects): plain Record<tid, {tenant,lastActiveAt}>.
    const isV2 = (parsed as { __v?: number }).__v === 2;
    const tenants = (isV2
      ? (parsed as { tenants?: Record<string, { tenant?: string; lastActiveAt?: number }> }).tenants ?? {}
      : parsed) as Record<string, { tenant?: string; lastActiveAt?: number }>;
    const cutoff = Date.now() - ACTIVE_TENANT_RETENTION_MS;
    for (const [tid, v] of Object.entries(tenants)) {
      if (v?.tenant && typeof v.lastActiveAt === "number" && v.lastActiveAt > cutoff) {
        activeTenants.set(tid, { tenant: v.tenant, lastActiveAt: v.lastActiveAt });
      }
    }
    if (isV2) {
      const hot = (parsed as { hotProjects?: Record<string, unknown> }).hotProjects ?? {};
      for (const [tid, list] of Object.entries(hot)) if (activeTenants.has(tid)) mergeHotProjects(tid, list);
    }
    if (activeTenants.size) console.log(`[home-rewarm] loaded ${activeTenants.size} active tenant(s) from disk`);
  } catch (e) {
    console.warn(`[home-rewarm] could not load active-tenant registry: ${String(e)}`);
  }
}

/** Load the registry from the app database and merge it into the in-memory
 *  map. This is the durable copy: production deploys get a fresh filesystem
 *  (the disk file is wiped), so without the DB row every deploy forgot who
 *  the active tenants were and the first login went cold. Returns the
 *  entries that were NEW to this worker so the caller can warm just those. */
async function loadActiveTenantsFromDb(): Promise<Array<[string, { tenant: string; lastActiveAt: number }]>> {
  const added: Array<[string, { tenant: string; lastActiveAt: number }]> = [];
  try {
    const rows = await getActiveTenantRegistry();
    const cutoff = Date.now() - ACTIVE_TENANT_RETENTION_MS;
    for (const row of rows) {
      if (!row.tenantId || !row.tenantLabel || row.lastActiveAt <= cutoff) continue;
      const cur = activeTenants.get(row.tenantId);
      if (!cur) {
        const v = { tenant: row.tenantLabel, lastActiveAt: row.lastActiveAt };
        activeTenants.set(row.tenantId, v);
        added.push([row.tenantId, v]);
      } else if (cur.lastActiveAt < row.lastActiveAt) {
        cur.lastActiveAt = row.lastActiveAt;
      }
      if (row.hotProjectsJson) {
        try { mergeHotProjects(row.tenantId, JSON.parse(row.hotProjectsJson)); } catch { /* malformed JSON — ignore */ }
      }
    }
    if (added.length) console.log(`[home-rewarm] loaded ${added.length} active tenant(s) from DB registry`);
  } catch (e) {
    console.warn(`[home-rewarm] could not load DB tenant registry: ${String(e)}`);
  }
  return added;
}

/** Persist the registry (lead worker only — avoids cross-worker file races).
 *  Debounced. Durable copy goes to the app DB (survives deploys); the disk
 *  file is kept as a fast synchronous fallback for dev restarts. */
function saveActiveTenantsDebounced(): void {
  if (!IS_LEAD_WORKER || activeTenantsSaveTimer) return;
  activeTenantsSaveTimer = setTimeout(() => {
    activeTenantsSaveTimer = null;
    const snapshot = [...activeTenants].map(([tid, v]) => {
      const hot = hotProjects.get(tid);
      return { tenantId: tid, tenantLabel: v.tenant, lastActiveAt: v.lastActiveAt, hotProjectsJson: hot && hot.length ? JSON.stringify(hot) : null };
    });
    upsertActiveTenantRegistry(snapshot)
      .catch((e) => console.warn(`[home-rewarm] could not persist DB tenant registry: ${String(e)}`));
    try {
      const dir = path.dirname(ACTIVE_TENANTS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const obj = {
        __v: 2 as const,
        tenants: {} as Record<string, { tenant: string; lastActiveAt: number }>,
        hotProjects: {} as Record<string, HotProject[]>,
      };
      for (const [tid, v] of activeTenants) obj.tenants[tid] = v;
      for (const [tid, list] of hotProjects) if (list.length && activeTenants.has(tid)) obj.hotProjects[tid] = list;
      const tmp = `${ACTIVE_TENANTS_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(obj));
      fs.renameSync(tmp, ACTIVE_TENANTS_FILE);
    } catch (e) {
      console.warn(`[home-rewarm] could not persist active-tenant registry: ${String(e)}`);
    }
  }, 5_000);
}

/** Record real user activity (logins only — NOT background warms, so idle
 *  tenants naturally age out of the registry after 7 days). */
function noteActiveTenant(tid: string, tenant: string): void {
  activeTenants.set(tid, { tenant, lastActiveAt: Date.now() });
  // Prune: drop expired entries, then cap to the most recently active.
  const cutoff = Date.now() - ACTIVE_TENANT_RETENTION_MS;
  for (const [k, v] of activeTenants) if (v.lastActiveAt < cutoff) activeTenants.delete(k);
  if (activeTenants.size > ACTIVE_TENANT_MAX) {
    const sorted = [...activeTenants.entries()].sort((a, b) => b[1].lastActiveAt - a[1].lastActiveAt);
    activeTenants.clear();
    for (const [k, v] of sorted.slice(0, ACTIVE_TENANT_MAX)) activeTenants.set(k, v);
  }
  saveActiveTenantsDebounced();
}

/** Force-refresh any home-source cache entry whose TTL expired more than
 *  HOME_REWARM_MAX_AGE_MS ago. Unlike warmHomeCaches (which skips anything
 *  still inside the 6h stale grace), this keeps the data itself FRESH so the
 *  first login of the morning gets current numbers instantly. Reuses the
 *  same single-flight maps + generation guards as the live routes, so a
 *  mid-flight cache bust from a user write is never clobbered. */
function refreshHomeCachesIfAged(tid: string, tenant: string): void {
  const staleBefore = Date.now() - HOME_REWARM_MAX_AGE_MS;
  try {
    const aHit = resAllocsCache.get(tid);
    // Degraded hits count as aged: rewarm them immediately, don't wait out
    // their residue window.
    if ((!aHit || aHit.expiresAt < staleBefore || resAllocsDegraded(aHit.data)) && !resAllocsInFlight.has(tid)) {
      const startGen = resAllocsGen.get(tid) ?? 0;
      const p = (rdsGetResourceAllocations(tid, tenant) as Promise<unknown>)
        .then((d) => { setResAllocsCacheIfCurrent(tid, startGen, d); resAllocsInFlight.delete(tid); return d; })
        .catch((e) => { resAllocsInFlight.delete(tid); console.warn(`[home-rewarm] allocations: ${String(e)}`); return null; });
      resAllocsInFlight.set(tid, p);
    }
    const dHit = resDemandsCache.get(tid);
    if ((!dHit || dHit.expiresAt < staleBefore) && !resDemandsInFlight.has(tid)) {
      const p = (rdsGetResourceDemands(tid, tenant) as Promise<unknown>)
        .then((d) => { resDemandsCache.set(tid, { data: d, expiresAt: Date.now() + RES_DEMANDS_TTL_MS }); capMap(resDemandsCache, CACHE_MAX_ORG); resDemandsInFlight.delete(tid); return d; })
        .catch((e) => { resDemandsInFlight.delete(tid); console.warn(`[home-rewarm] demands: ${String(e)}`); return null; });
      resDemandsInFlight.set(tid, p);
    }
    for (const module of ["PMM", "OPM", "LEM"]) {
      const key = `${tid}:${module}`;
      const rHit = recordsCache.get(key);
      if ((!rHit || rHit.expiresAt < staleBefore) && !recordsInFlight.has(key)) {
        const startGen = recordsGen.get(tid) ?? 0;
        const p = rdsGetRecords(module, tid, tenant, { view: "list" })
          .then((d) => { setRecordsCacheIfCurrent(key, tid, startGen, d); recordsInFlight.delete(key); return d; })
          .catch((e) => { recordsInFlight.delete(key); console.warn(`[home-rewarm] records ${module}: ${String(e)}`); return null; });
        recordsInFlight.set(key, p);
      }
    }
  } catch { /* re-warm is best-effort */ }
}

// Once-per-UTC-day alerts warm. The alerts feed builds a daily snapshot +
// OpenAI escalation scan lazily on first read — 25s+ cold, multi-second even
// with warm sources — so pre-trigger it in the background (lead worker only;
// the snapshot rows are DB-backed and shared, and this avoids two workers
// racing duplicate OpenAI scans). Uses a self-issued, non-admin, short-lived
// token against 127.0.0.1 only; never logged.
const alertsWarmedForDay = new Map<string, string>();
function warmAlertsFeedDaily(tenant: string): void {
  const day = new Date().toISOString().slice(0, 10);
  if (alertsWarmedForDay.get(tenant) === day) return;
  alertsWarmedForDay.set(tenant, day);
  try {
    const token = signRdsToken({ sub: "cache-warmer", tenant, username: "__cache_warmer__", role: "", accessLevel: "user" });
    fetch(`http://127.0.0.1:${process.env.PORT || "8080"}/api/alerts/feed`, {
      headers: { Authorization: `Bearer ${token}`, "x-rmone-tenant": tenant, Accept: "application/json" },
    })
      .then((r) => { if (!r.ok) alertsWarmedForDay.delete(tenant); else console.log(`[home-rewarm] alerts snapshot warmed for ${tenant}`); })
      .catch(() => { alertsWarmedForDay.delete(tenant); });
  } catch {
    alertsWarmedForDay.delete(tenant);
  }
}

// Cap how many hot projects each tenant refreshes per tick. The team query is
// the expensive 7-join one that once saturated the pool when fanned out from
// a list prefetch — the cap + in-flight/single-flight reuse keeps a tick's DB
// load tiny (at most 3 detail + 3 team queries per tenant every 10 min, and
// only for entries that actually expired).
const HOT_PROJECT_REFRESH_MAX_PER_TICK = 3;

/** Kick expired detail + team + task-data cache refreshes for ONE project and
 *  return the kicked promises (empty array = everything was still warm).
 *  Reuses the exact single-flight maps and generation guards the live routes
 *  use, so a warm racing a user save can never repopulate stale data. */
function warmProjectCachesIfAged(tid: string, tenant: string, id: string, now: number): Array<Promise<unknown>> {
  // pdKey, not `${tid}:${id}`: the old 2-part key filled entries the route
  // (3-part keys) never read — the detail warm was a silent no-op serving
  // nobody, and its entries dodged per-ticket busts' exact match too.
  const detailKey = pdKey(tid, id);
  // Team + task-data caches key by 2-part `${tid}:${id}` (their routes and
  // per-ticket busts both use that shape) — do NOT reuse the 3-part detail
  // key for them, or their warms fill entries nothing ever reads (the same
  // key-shape drift class, on the write side; the check-cache-bust-key-shape
  // gate keeps each family single-shape).
  const key = `${tid}:${id}`;
  const kicked: Array<Promise<unknown>> = [];

  const dHit = projectDetailCache.get(detailKey);
  if ((!dHit || dHit.expiresAt < now) && !projectDetailInFlight.has(detailKey)) {
    const startGen = projectDetailGen.get(detailKey) ?? 0;
    const p = rdsGetRecordDetail(id, tid, tenant)
      .then((d) => {
        // Resolve with the same normalized envelope the live route caches,
        // so a route that joins this in-flight never res.json()s raw null.
        const data = d ?? { Status: false, Data: null };
        setProjectDetailCacheIfCurrent(detailKey, startGen, data);
        projectDetailInFlight.delete(detailKey);
        return data;
      })
      .catch((e) => { projectDetailInFlight.delete(detailKey); console.warn(`[hot-rewarm] detail ${id}: ${String(e)}`); return { Status: false, Data: null }; });
    projectDetailInFlight.set(detailKey, p);
    kicked.push(p);
  }

  const tHit = projectTeamCache.get(key);
  if ((!tHit || tHit.expiresAt < now) && !projectTeamInFlight.has(key)) {
    const startGen = projectTeamGen.get(key) ?? 0;
    // defaultRate omitted → getProjectTeamRds derives it from its own
    // parallel settings read (no sequential round-trip here).
    const p = getProjectTeamRds(tid, id, undefined, tenant)
      .then((data) => { setProjectTeamCacheIfCurrent(key, startGen, data); projectTeamInFlight.delete(key); return data; })
      .catch((e) => { projectTeamInFlight.delete(key); console.warn(`[hot-rewarm] team ${id}: ${String(e)}`); return {}; });
    projectTeamInFlight.set(key, p);
    kicked.push(p);
  }

  // Task-data (phase schedule) — read on every project-detail open right
  // alongside detail+team, so warm it in the same tick. Cheap single-project
  // query; taskDataCache has no generation guard (matches the live route's
  // stale-grace background refresh, which has the identical benign race).
  const sHit = taskDataCache.get(key);
  if ((!sHit || sHit.expiresAt < now) && !taskDataInFlight.has(key)) {
    const startGen = taskDataGen.get(key) ?? 0;
    const p: Promise<object[]> = getTaskDataRds(tid, id)
      .then((d) => {
        setTaskDataCacheShared(key, d, { expectedGen: startGen });
        taskDataInFlight.delete(key);
        return d;
      })
      .catch((e) => { taskDataInFlight.delete(key); console.warn(`[hot-rewarm] task-data ${id}: ${String(e)}`); return [] as object[]; });
    taskDataInFlight.set(key, p);
    kicked.push(p);
  }

  return kicked;
}

/** Refresh EXPIRED detail + team cache entries for a tenant's hot projects. */
function refreshHotProjectsIfAged(tid: string, tenant: string): void {
  const list = hotProjects.get(tid);
  if (!list || list.length === 0) return;
  const now = Date.now();
  let refreshed = 0;
  for (const { id } of list) {
    if (refreshed >= HOT_PROJECT_REFRESH_MAX_PER_TICK) break;
    if (warmProjectCachesIfAged(tid, tenant, id, now).length) refreshed++;
  }

  // Lifecycle templates — one cheap per-tenant query; fetched on every
  // project-detail open next to task-data, so keep it warm on the same cadence.
  const lcHit = lifecyclesCache.get(tid);
  if (!lcHit || lcHit.expiresAt < now) {
    getLifecyclesCached(tid).catch((e) => console.warn(`[hot-rewarm] lifecycles ${tenant}: ${String(e)}`));
  }

  if (refreshed) console.log(`[hot-rewarm] refreshing ${refreshed} hot project(s) for ${tenant}`);
}

// ── Demand-page project warming ───────────────────────────────────────────────
// The Resources → Demand page links straight into projects via "View project"
// — and those are precisely the projects nobody opened recently, so the
// hot-projects LRU never covers them and the first open paid the cold 7-join
// team query. Two warm paths fix that:
//   1. The 10-min scheduler tick keeps the TOP demand-referenced projects'
//      detail/team/task caches warm around the clock (candidates ranked by
//      open allocation — the same ordering the page surfaces most).
//   2. Serving GET /resource-demands kicks an immediate warm (throttled,
//      IPC-broadcast so every cluster worker heats its own maps) — by the
//      time the user drills in and clicks, the caches are hot.
// All warms are expired-entry-only + single-flight + generation-guarded, so
// they can never clobber fresher data or duplicate in-flight queries.
const DEMAND_WARM_CANDIDATES        = 12;               // top-N projects considered
const DEMAND_WARM_MAX_PER_TICK      = 4;                // expired warms per 10-min tick
const DEMAND_WARM_ROUTE_CAP         = 8;                // expired warms per page-view kick
const DEMAND_WARM_ROUTE_THROTTLE_MS = 5 * 60 * 1000;    // per-tenant kick throttle
const demandWarmKickedAt = new Map<string, number>();

/** Rank demand rows' project ids by total open allocation and return the top
 *  candidates. Tolerant of bare-array and {data:[...]} payload shapes. */
function demandWarmCandidateIds(payload: unknown): string[] {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown[] } | null)?.data)
      ? (payload as { data: unknown[] }).data
      : [];
  const byTicket = new Map<string, number>();
  for (const r of rows as Array<Record<string, unknown>>) {
    const id = typeof r?.TicketId === "string" ? r.TicketId.trim() : "";
    if (!id) continue;
    byTicket.set(id, (byTicket.get(id) ?? 0) + (Number(r.PctAllocation) || 0));
  }
  return [...byTicket.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, DEMAND_WARM_CANDIDATES)
    .map(([id]) => id);
}

/** Warm projects ONE at a time (await each project's kicked queries before
 *  starting the next) so a kick never fans several heavy 7-join team queries
 *  into the connection pool at once. Best-effort; errors logged per query. */
async function warmProjectsSequentially(tid: string, tenant: string, ids: string[], cap: number): Promise<void> {
  let warmed = 0;
  for (const id of ids) {
    if (warmed >= cap) break;
    const kicked = warmProjectCachesIfAged(tid, tenant, id, Date.now());
    if (kicked.length) { warmed++; await Promise.allSettled(kicked); }
  }
  if (warmed) console.log(`[demand-rewarm] warmed ${warmed} demand project(s) for ${tenant}`);
}

/** Scheduled-tick warm: keep the top demand-page projects from ever aging
 *  out. Skips ids already covered by the hot-projects loop. If the demand
 *  rows themselves aren't cached yet (cold boot), kick the demands query
 *  (single-flight, shared with the live route) and warm when it lands. */
function refreshDemandProjectsIfAged(tid: string, tenant: string): void {
  const hot = new Set((hotProjects.get(tid) ?? []).map((p) => p.id));
  const warmFrom = (payload: unknown): void => {
    const ids = demandWarmCandidateIds(payload).filter((id) => !hot.has(id));
    if (ids.length) void warmProjectsSequentially(tid, tenant, ids, DEMAND_WARM_MAX_PER_TICK);
  };
  const hit = resDemandsCache.get(tid);
  if (hit && hit.expiresAt + RES_DEMANDS_STALE_MS > Date.now()) { warmFrom(hit.data); return; }
  let inflight = resDemandsInFlight.get(tid);
  if (!inflight) {
    inflight = (rdsGetResourceDemands(tid, tenant) as Promise<unknown>)
      .then((d) => { resDemandsCache.set(tid, { data: d, expiresAt: Date.now() + RES_DEMANDS_TTL_MS }); capMap(resDemandsCache, CACHE_MAX_ORG); resDemandsInFlight.delete(tid); return d; })
      .catch((e) => { resDemandsInFlight.delete(tid); console.warn(`[demand-rewarm] demands: ${String(e)}`); return null; });
    resDemandsInFlight.set(tid, inflight);
  }
  void inflight.then((d) => { if (d) warmFrom(d); });
}

/** Page-view kick: called with the payload GET /resource-demands just served.
 *  Warms this worker AND broadcasts the candidate ids so sibling workers
 *  (round-robined requests) heat their own caches too. Throttled per tenant. */
function kickDemandWarm(tid: string, tenant: string, payload: unknown): void {
  const now = Date.now();
  if (now - (demandWarmKickedAt.get(tid) ?? 0) < DEMAND_WARM_ROUTE_THROTTLE_MS) return;
  demandWarmKickedAt.set(tid, now);
  capMap(demandWarmKickedAt, CACHE_MAX_ORG);
  const ids = demandWarmCandidateIds(payload);
  if (!ids.length) return;
  void warmProjectsSequentially(tid, tenant, ids, DEMAND_WARM_ROUTE_CAP);
  broadcastBust({ type: "warmDemandProjects", tid, tenant, ids });
}

// ── Cross-worker import-active signal (cached DB probe) ──────────────────────
// bustResAllocsLocal fires on every allocation write — including on workers that
// are NOT running the import (they receive an IPC "resAllocs" bust from the
// importing worker). Those sibling workers have importSlotStats().active === 0
// so the local check alone is insufficient. We keep a cheap async-refreshed
// cached result of countActiveOnboardingImports so all workers suppress
// rewarmUtilForTid during bulk writes without blocking on the DB each time.
//
// Read policy: return the last known value immediately (zero blocking); if the
// cached value is older than IMPORT_ACTIVE_CACHE_TTL_MS, kick an async refresh.
// On repeated probe failures fall back to "no import active" so a broken
// rmone_onboarding_jobs table can never permanently stall Timeline rewarms.
const IMPORT_ACTIVE_CACHE_TTL_MS = 30_000;
const IMPORT_ACTIVE_FAIL_CAP     = 5;
let importActiveCache            = false;
let importActiveCachedAt         = 0;
let importActiveRefreshInFlight  = false;
let importActiveFailStreak       = 0;

function getImportActiveCached(): boolean {
  if (Date.now() - importActiveCachedAt > IMPORT_ACTIVE_CACHE_TTL_MS && !importActiveRefreshInFlight) {
    importActiveRefreshInFlight = true;
    countActiveOnboardingImports(3)
      .then((n) => {
        importActiveCache           = n > 0;
        importActiveCachedAt        = Date.now();
        importActiveFailStreak      = 0;
        importActiveRefreshInFlight = false;
      })
      .catch((e) => {
        importActiveRefreshInFlight = false;
        importActiveFailStreak++;
        if (importActiveFailStreak >= IMPORT_ACTIVE_FAIL_CAP) {
          // Persistent failure: treat as "no import active" so warms are never
          // permanently suppressed by a broken probe.
          importActiveCache      = false;
          importActiveCachedAt   = Date.now();
          importActiveFailStreak = 0;
          console.warn("[import-active-probe] repeated failures — assuming no import active:", (e as Error).message ?? String(e));
        }
        // Non-fatal streak: keep returning last known value until next tick.
      });
  }
  return importActiveCache;
}

// Consecutive import-activity check failures. Skipping on failure protects a
// struggling DB, but a PERSISTENTLY broken check (bad query, dropped table)
// must not starve rewarm forever — after enough consecutive failures let one
// sweep through and reset the count. At the lead worker's 10-min cadence,
// 6 failures ≈ 1 h of paused warming, well inside every cache's SWR
// stale-grace window.
let rewarmCheckFailStreak = 0;
const REWARM_CHECK_FAIL_BYPASS = 6;
/** One scheduler tick: re-warm every recently-active tenant. */
async function rewarmActiveTenants(): Promise<void> {
  // Fast local check: if THIS worker is actively running an import, skip
  // immediately without hitting the DB — the pool is already under pressure.
  if (importSlotStats().active > 0) {
    console.log("[rewarm] skipped — local import slot active, giving pool priority");
    return;
  }
  // Give live imports the whole pool: skip this sweep while ANY import is
  // running against the shared RDS instance — including one launched by the
  // OTHER environment (dev + prod warm the same server; the check reads the
  // shared jobs table so each side sees the other's imports).
  // On check failure also skip: the DB is likely already struggling and a
  // warm sweep would pile on; every warmed cache has hours of SWR stale-grace.
  try {
    const running = await countActiveOnboardingImports(3);
    rewarmCheckFailStreak = 0;
    if (running > 0) {
      console.log(`[rewarm] skipped — ${running} live import(s) get pool priority`);
      return;
    }
  } catch (e) {
    rewarmCheckFailStreak++;
    if (rewarmCheckFailStreak < REWARM_CHECK_FAIL_BYPASS) {
      console.warn(`[rewarm] skipped — import-activity check failed (${rewarmCheckFailStreak}/${REWARM_CHECK_FAIL_BYPASS}):`, (e as Error).message);
      return;
    }
    rewarmCheckFailStreak = 0;
    console.warn("[rewarm] import-activity check failed repeatedly — running one sweep anyway so caches don't go permanently stale:", (e as Error).message);
  }
  const cutoff = Date.now() - ACTIVE_TENANT_RETENTION_MS;
  // Space tenants a few seconds apart instead of firing every tenant's
  // refresh burst simultaneously — the simultaneous version contributed to
  // memory spikes that OOM-killed production workers (see warmCacheOnStartup).
  const REWARM_TENANT_SPACING_MS = 8_000;
  let i = 0;
  for (const [tid, v] of activeTenants) {
    if (v.lastActiveAt < cutoff) continue;
    const run = () => {
      refreshHomeCachesIfAged(tid, v.tenant);
      // Gate heavy per-project warms on the lead worker only.
      // With 4 workers each firing hot+demand warms, total warm query volume
      // doubles vs. a 2-worker cluster and can exhaust pool slots during a live
      // import run (pool-acquire timeout → preview screen freezes).
      // The lead worker runs every 10 min — sufficient given the 6-hour
      // stale-grace windows on project-detail / team / task-data caches.
      // Workers 1-3 serve SWR-cached data until their own 30-min sweep fires,
      // which still refreshHomeCachesIfAged (the lightweight home-overlay path).
      if (IS_LEAD_WORKER) {
        refreshHotProjectsIfAged(tid, v.tenant);
        refreshDemandProjectsIfAged(tid, v.tenant);
        warmAlertsFeedDaily(v.tenant);
      }
    };
    const delay = i * REWARM_TENANT_SPACING_MS;
    i++;
    if (delay === 0) run();
    else setTimeout(run, delay);
  }
}

// Per-token cache + in-flight de-dup for the heavyweight resource-allocations
// endpoint. The upstream returns thousands of weekly rows for the entire org
// and the project detail page calls this on every load, so a short TTL +
// request coalescing avoids both spinner hangs and upstream stampedes.
//
// The cache key is a SHA-256 of the normalized auth header (collision-resistant)
// because the cached payload contains org-wide allocation data — a weak key
// (e.g. `auth.slice(-16)`) could theoretically expose one user's data to
// another user with the same trailing token characters.
const RESOURCE_ALLOC_TTL_MS = 2 * 60 * 1000;
const RESOURCE_ALLOC_CACHE_MAX = 256;

// ── Project-detail record cache ───────────────────────────────────────────────
// GET /project/:id is Phase-1 of the 6-call parallel load — it resolves BEFORE
// the "Loading project…" overlay can dismiss. Without a cache every open issues
// a fresh SQL round-trip (typically 1–4 s). With SWR every repeat visit within
// 5 min is served from memory in <1 ms. Busted immediately after any field
// mutation (PUT /project, POST /update-fields, POST /smart-update) so edits
// are visible on the very next page open.
const PROJECT_DETAIL_TTL_MS         = 5 * 60 * 1000;
// 30-min grace (was 2 min): the scheduled hot-project re-warm ticks every
// 10 min, so entries must stay servable between ticks or the warm is useless.
// Safe because EVERY write path busts this cache (PUT /project, POST
// /update-fields, /smart-update + cross-worker IPC), and the gen guard below
// discards any pre-bust snapshot that lands after a save.
const PROJECT_DETAIL_STALE_GRACE_MS = 30 * 60 * 1000;
/** Canonical ticket segment for detail-cache keys: trimmed + UPPERCASED so
 *  every constructor (route URL param, save-payload RecordId, warm loop, IPC
 *  adoption) agrees byte-for-byte. Casing drift between these surfaces is how
 *  the Aug 2026 stale-record incident class happens: a bust/pre-stamp keyed
 *  from one casing silently misses an entry keyed from another. */
function pdTicketSeg(id: string): string { return String(id).trim().toUpperCase(); }
const PD_MODULES = new Set(["PMM", "OPM", "LEM"]);
/** Canonical detail-cache key: `${tid}:${TICKET}:${module|"auto"}`. */
function pdKey(tid: string, id: string, mod?: string): string {
  return `${tid}:${pdTicketSeg(id)}:${mod && PD_MODULES.has(mod) ? mod : "auto"}`;
}
/** Re-canonicalize a detail key that arrived over IPC — a sibling on an older
 *  build (rolling restart) may still send 2-part or non-canonical-case keys. */
function pdNormalizeKey(key: string): string {
  const i = key.indexOf(":");
  if (i < 0) return key;
  const j = key.indexOf(":", i + 1);
  const tid = key.slice(0, i);
  const ticket = j < 0 ? key.slice(i + 1) : key.slice(i + 1, j);
  const mod = j < 0 ? undefined : key.slice(j + 1);
  return pdKey(tid, ticket, mod);
}

const projectDetailCache    = new Map<string, { data: unknown; expiresAt: number }>();
const projectDetailInFlight = new Map<string, Promise<unknown>>();
// Generation counter per key — same read-repopulate race guard as
// projectTeamGen: a detail query started BEFORE a save that completes AFTER
// the bust must NOT write its pre-save snapshot back into the cache.
const projectDetailGen = new Map<string, number>();

/** Cache the detail result only if no bust invalidated this key mid-query. */
function setProjectDetailCacheIfCurrent(cacheKey: string, startGen: number, data: unknown, opts?: { fromIpc?: boolean }): void {
  if ((projectDetailGen.get(cacheKey) ?? 0) !== startGen) return; // busted mid-flight — discard
  const expiresAt = Date.now() + PROJECT_DETAIL_TTL_MS;
  projectDetailCache.set(cacheKey, { data, expiresAt });
  capMap(projectDetailCache, CACHE_MAX_PROJECTS);
  // Share the fetched payload with sibling workers (adoptCache) so they don't
  // re-run the same detail query. Never share the not-found/failure envelope —
  // it's cached locally to stop re-hammering, but spreading it cluster-wide
  // would amplify a transient blip into a cluster-wide "missing project".
  const env = data as { Status?: unknown; Data?: unknown } | null;
  const notFoundEnvelope = !!env && env.Status === false && env.Data == null;
  if (!opts?.fromIpc && !notFoundEnvelope) broadcastCachePayload("projectDetail", cacheKey, data, expiresAt);
}

/** Local-only detail bust (also applied from cross-worker IPC). */
function bustProjectDetailLocal(cacheKey: string): void {
  projectDetailGen.set(cacheKey, (projectDetailGen.get(cacheKey) ?? 0) + 1);
  capMap(projectDetailGen, CACHE_MAX_PROJECTS);
  projectDetailCache.delete(cacheKey);
  projectDetailInFlight.delete(cacheKey);
  projectDetailBustAt.set(cacheKey, Date.now()); // adoptCache guard: reject sibling payloads settled before this
  capMap(projectDetailBustAt, CACHE_MAX_PROJECTS);
}

/** Bust every cached detail variant for ONE ticket on THIS worker.
 *  The route's cache key is `${tid}:${id}:${module ?? "auto"}` (3 segments) —
 *  the previous exact delete of `${tid}:${ticketId}` (2 segments) matched
 *  nothing, so every per-ticket bust was a silent no-op and record pages
 *  served pre-save values for the full TTL+grace after a field save (the
 *  in-app ?fresh=1 refetch masked it; a plain page refresh exposed it —
 *  client-reported "edits don't save" incident, Aug 2026). Match by prefix
 *  over cache+inFlight+gen keys, case-insensitively (the :id URL param and a
 *  save payload's RecordId come from different surfaces and can differ in
 *  case). Also pre-stamp the adoptCache bustAt guard for the module variants
 *  so a sibling's pre-save payload broadcast can't be adopted by a worker
 *  that had no local entry to bust. */
function bustProjectDetailForTicketLocal(tid: string, ticketId: string): void {
  // Case-insensitive scan is belt-and-braces: constructors all canonicalize
  // via pdKey now, but entries written by an older build in a mixed-version
  // window must still be caught.
  const prefix = `${tid}:${pdTicketSeg(ticketId)}:`.toLowerCase();
  const exact = `${tid}:${pdTicketSeg(ticketId)}`.toLowerCase();
  const keys = new Set<string>([
    ...projectDetailCache.keys(), ...projectDetailInFlight.keys(), ...projectDetailGen.keys(),
  ]);
  for (const k of keys) {
    const lk = k.toLowerCase();
    if (lk.startsWith(prefix) || lk === exact) bustProjectDetailLocal(k);
  }
  // Pre-stamp the adoptCache guard under the CANONICAL keys (adoption
  // normalizes incoming keys through pdNormalizeKey, so these always align).
  for (const mod of ["auto", "PMM", "OPM", "LEM"]) {
    const k = pdKey(tid, ticketId, mod);
    if (!keys.has(k)) {
      projectDetailBustAt.set(k, Date.now());
      capMap(projectDetailBustAt, CACHE_MAX_PROJECTS);
    }
  }
}

export function bustProjectDetailCache(tid: string, ticketId?: string): void {
  if (ticketId) {
    bustProjectDetailForTicketLocal(tid, ticketId);
  } else {
    const keys = new Set<string>([...projectDetailCache.keys(), ...projectDetailInFlight.keys()]);
    for (const k of keys) if (k.startsWith(`${tid}:`)) bustProjectDetailLocal(k);
  }
  broadcastBust({ type: "bustCache", fn: "projectDetail", tid, ticketId });
}

// ── Project-allocations (simple list) cache ───────────────────────────────────
// GET /allocations?projectID=X is one of the 6 parallel calls in loadProject.
// Without a cache every project-detail open issues a raw SQL round-trip.
// 2-min TTL matches weekly-alloc (allocation data changes on every hours save).
const PROJECT_ALLOCS_TTL_MS         = 2 * 60 * 1000;
const PROJECT_ALLOCS_STALE_GRACE_MS = 30 * 1000;
const projectAllocsCache    = new Map<string, { data: unknown; expiresAt: number }>();
const projectAllocsInFlight = new Map<string, Promise<unknown>>();

export function bustProjectAllocsCache(tid: string, projectId?: string): void {
  if (projectId) {
    projectAllocsCache.delete(`${tid}:${projectId}`);
    projectAllocsInFlight.delete(`${tid}:${projectId}`);
  } else {
    for (const k of projectAllocsCache.keys()) if (k.startsWith(`${tid}:`)) projectAllocsCache.delete(k);
    for (const k of projectAllocsInFlight.keys()) if (k.startsWith(`${tid}:`)) projectAllocsInFlight.delete(k);
  }
  broadcastBust({ type: "bustCache", fn: "projectAllocs", tid, projectId });
}
const resourceAllocCache = new Map<string, { data: object; expiresAt: number }>();
const resourceAllocInFlight = new Map<string, Promise<object>>();

// Per-project team cache. The team data is expensive to compute (7-join SQL
// against remote RDS) and rarely changes mid-session.
// Stale-while-revalidate: if the entry is expired but within the grace window
// the server returns stale data IMMEDIATELY and refreshes in the background so
// the client never waits for a cold DB round-trip.
// 30-min TTL: team rosters don't change minute-to-minute; this cuts live DB
// hits by ~4× compared to the old 8-min TTL, eliminating the most common
// "slow open" case for recently-visited projects.
// 3-hour grace: stale data is almost always shown instantly; background refresh
// only fires when data was changed externally (pipeline import, assignment save).
// Key: `${tid}:${projectId}`.
const PROJECT_TEAM_TTL_MS = 30 * 60 * 1000;
// Empty teams get a SHORT TTL instead of no caching at all. Opportunities
// usually have no team members, so "never cache empty" meant every open of an
// opportunity detail page (and every projects-list team-count prefetch) re-ran
// the full cold 7-join core2 query — the main cause of slow detail-page loads.
// 2 minutes is long enough to absorb a browsing session's repeat hits but
// short enough that a transient false-empty (cold pool) self-heals quickly.
// NOTE: not a hard 2-min bound — after the empty TTL expires the entry falls
// into the SWR grace window, so ONE more stale-empty serve per worker can
// happen while the background refresh rewrites it. Bounded + self-correcting.
// Post-save correctness is unaffected: saves bust the key (gen bump + delete,
// so the grace path can never serve a post-save stale entry) and the client's
// post-save refetch sends ?fresh=1 which bypasses the cache entirely.
const PROJECT_TEAM_EMPTY_TTL_MS = 2 * 60 * 1000;
const PROJECT_TEAM_STALE_GRACE_MS = 3 * 60 * 60 * 1000;
const projectTeamCache = new Map<string, { data: object; expiresAt: number }>();
const projectTeamInFlight = new Map<string, Promise<object>>();
// Generation counter per cache key — guards against the read-repopulate race:
// a team query started BEFORE a save that completes AFTER the bust must NOT
// write its pre-save snapshot back into the cache (team queries can take 30s+
// under post-save DB load, so this window is real). Same pattern as resAllocs.
const projectTeamGen = new Map<string, number>();

/** Cache the team result only if no bust invalidated this key mid-query.
 *  Non-empty teams cache for the full TTL; empty teams cache for a short TTL
 *  (see PROJECT_TEAM_EMPTY_TTL_MS) so repeat opens don't re-run the cold query. */
function setProjectTeamCacheIfCurrent(cacheKey: string, startGen: number, data: object, opts?: { fromIpc?: boolean }): void {
  if ((projectTeamGen.get(cacheKey) ?? 0) !== startGen) return; // busted mid-flight — discard
  const teamArr = (data as { team?: unknown[] })?.team;
  const ttl = teamArr && teamArr.length > 0 ? PROJECT_TEAM_TTL_MS : PROJECT_TEAM_EMPTY_TTL_MS;
  const expiresAt = Date.now() + ttl;
  projectTeamCache.set(cacheKey, { data, expiresAt });
  capMap(projectTeamCache, CACHE_MAX_PROJECTS);
  // Share non-empty team payloads with sibling workers — the team query is the
  // expensive one (multi-join, 30s+ under load), so one fetch should feed the
  // whole cluster. Empty teams stay local: they're cheap to recompute and the
  // short empty-TTL heuristic shouldn't propagate.
  if (!opts?.fromIpc && teamArr && teamArr.length > 0) broadcastCachePayload("projectTeam", cacheKey, data, expiresAt);
}

/** Local-only per-project team bust (also applied from cross-worker IPC). */
function bustProjectTeamLocal(cacheKey: string): void {
  projectTeamGen.set(cacheKey, (projectTeamGen.get(cacheKey) ?? 0) + 1);
  capMap(projectTeamGen, CACHE_MAX_PROJECTS);
  projectTeamCache.delete(cacheKey);
  projectTeamInFlight.delete(cacheKey);
  projectTeamBustAt.set(cacheKey, Date.now()); // adoptCache guard: reject sibling payloads settled before this
  capMap(projectTeamBustAt, CACHE_MAX_PROJECTS);
}

/** Local-only full team-cache clear — bumps gens so in-flight reads discard. */
function bustAllProjectTeamLocal(): void {
  const keys = new Set<string>([
    ...projectTeamCache.keys(), ...projectTeamInFlight.keys(), ...projectTeamGen.keys(),
  ]);
  const bustNow = Date.now();
  for (const k of keys) { projectTeamGen.set(k, (projectTeamGen.get(k) ?? 0) + 1); projectTeamBustAt.set(k, bustNow); }
  capMap(projectTeamGen, CACHE_MAX_PROJECTS);
  projectTeamCache.clear();
  projectTeamInFlight.clear();
}

// Org-structure lookup caches (Divisions / Departments / Business Units).
// These tables are read-heavy and write-rarely — org structure changes maybe
// once a week at most. A 30-min server-side TTL means:
//   • First request after server start → DB (once per tenant per 30 min)
//   • Every subsequent request in that window → instant Map lookup, zero DB
// Busted explicitly when the admin creates/renames/deletes an org entity so
// edits are always visible immediately.
// Key: tenantId string.
const ORG_CACHE_TTL_MS = 30 * 60 * 1000;
// Org structure (divisions, departments, BUs) almost never changes during a
// session — serve stale for up to 1 hour after TTL while refreshing in background.
const ORG_CACHE_STALE_GRACE_MS = 60 * 60 * 1000;
type OrgEntry<T> = { data: T; expiresAt: number };
const divCache     = new Map<string, OrgEntry<object[]>>();
const deptCache    = new Map<string, OrgEntry<object[]>>();
const buListCache  = new Map<string, OrgEntry<object[]>>();
const divInFlight     = new Map<string, Promise<object[]>>();
const deptInFlight    = new Map<string, Promise<object[]>>();
const buListInFlight  = new Map<string, Promise<object[]>>();

// ── Cross-worker IPC cache invalidation ─────────────────────────────────────
// When this process is a cluster worker, calling process.send() delivers the
// message to the primary, which fans it out to all other workers.  The handler
// below (handleClusterMessage) receives it on the other side and applies the
// same local-only deletion — no Redis needed for in-process Maps.
function broadcastBust(msg: object): void {
  if (process.send) {
    try { process.send(msg); } catch { /* worker is shutting down — safe to ignore */ }
  }
}

/** Bust the org-audience membership map (staffOrgCache) on THIS worker and
 *  every sibling. Must be called after any write that can move a person
 *  between BU/Division/Department (staff-assignment edit, create-staff,
 *  onboarding import) — live org audiences (org:bu/div/dept sentinels) read
 *  that map, and without a bust siblings enforce the OLD placement for up to
 *  the 5-min TTL. */
function bustStaffOrgEverywhere(tid: string): void {
  try {
    invalidateStaffOrgCache(tid);
    broadcastBust({ type: "bustCache", fn: "staffOrg", tid });
  } catch { /* best-effort */ }
}

// ── Cross-worker payload adoption (adoptCache) ───────────────────────────────
// The existing warm IPC messages are all "go fetch it yourself" signals, so
// every warm scaled DB load linearly with worker count: N workers → N
// identical queries per key. adoptCache is the data-carrying counterpart —
// the worker that actually ran the query shares the RESULT, siblings adopt it
// into their own maps and skip the DB entirely. Guards on the receive side
// keep every existing correctness rule intact (gen counters, in-flight wins,
// never adopt pre-bust payloads, never adopt emptiness).
const ADOPT_MAX_JSON_BYTES = 1_500_000; // don't relay megabyte payloads through the master
const projectDetailBustAt = new Map<string, number>();
const projectTeamBustAt = new Map<string, number>();
const taskDataBustAt = new Map<string, number>();
function broadcastCachePayload(fn: "projectDetail" | "projectTeam" | "taskData", key: string, data: unknown, expiresAt: number): void {
  if (!process.send) return; // single-process run — nobody to share with
  try {
    const json = JSON.stringify(data);
    if (!json || json.length > ADOPT_MAX_JSON_BYTES) return;
    process.send({ type: "adoptCache", fn, key, json, expiresAt, settledAt: Date.now() });
  } catch { /* worker shutting down or unserializable payload — skip */ }
}
/** ONE writer for task-data cache entries: set + capMap + (non-empty, non-IPC)
 *  share with siblings. Adoption calls it with fromIpc so it never echoes. */
function setTaskDataCacheShared(
  key: string,
  data: object[],
  opts?: { fromIpc?: boolean; expectedGen?: number },
): void {
  // A schedule/lifecycle write may bust this key while an older DB read is
  // still running. Never let that pre-write result repopulate the cache after
  // the bust; callers capture expectedGen immediately before starting a read.
  if (opts?.expectedGen !== undefined && (taskDataGen.get(key) ?? 0) !== opts.expectedGen) return;
  const expiresAt = Date.now() + TASK_DATA_TTL_MS;
  taskDataCache.set(key, { data, expiresAt });
  capMap(taskDataCache, CACHE_MAX_PROJECTS);
  if (!opts?.fromIpc && Array.isArray(data) && data.length > 0) broadcastCachePayload("taskData", key, data, expiresAt);
}

/** Test-only handles for the check:cache-guards bust-key regression test
 *  (projectDetailBustKey.test.ts, #737). The Aug 2026 stale-record incident
 *  was a silent key-shape mismatch — set() wrote `${tid}:${id}:${module}`
 *  (3 segments) while every per-ticket bust deleted `${tid}:${ticketId}`
 *  (2 segments), a no-op. The test seeds these maps directly and asserts
 *  bustProjectDetailCache AND the IPC applier clear every module variant and
 *  bump the gen counter. Never reference these hooks from production code. */
export const __projectDetailTestHooks = {
  cache: projectDetailCache,
  inFlight: projectDetailInFlight,
  gen: projectDetailGen,
  bustAt: projectDetailBustAt,
  setIfCurrent: setProjectDetailCacheIfCurrent,
};

/** Receive a cache-bust IPC message broadcast by another worker. */
export function handleClusterMessage(msg: unknown): void {
  if (!msg || typeof msg !== "object") return;
  const m = msg as { type?: string; fn?: string; tid?: string; ticketId?: string; projectId?: string; clearUtil?: boolean };
  // Login-time home-cache warming must run on EVERY worker — requests are
  // round-robined across the cluster, so warming only the worker that handled
  // the login still leaves the other workers cold. warmHomeCaches is
  // idempotent (cache + in-flight checks), so a redundant echo is harmless.
  if (m.type === "warmHome") {
    const w = m as { tid?: string; tenant?: string };
    if (w.tid && w.tenant) {
      warmHomeCaches(w.tid, w.tenant);
      // A warmHome broadcast only fires on a real login, so record the
      // activity here too — keeps every worker's registry in sync and lets
      // the lead worker persist logins that other workers handled.
      noteActiveTenant(w.tid, w.tenant);
    }
    return;
  }
  // Post-write Hours View warm: the worker that handled the write broadcasts
  // this after the bust messages, so every other worker rebuilds its own
  // project-team + weekly-alloc cache too (each worker has separate Maps).
  if (m.type === "warmProjectHours") {
    const w = m as { tid?: string; tenant?: string; projectId?: string };
    if (w.tid && w.tenant && w.projectId) warmProjectHoursCachesLocal(w.tid, w.tenant, w.projectId);
    return;
  }
  // Post-import extra-fields bust: onboarding just wrote kept/fallback extra
  // fields; every worker must drop its cached row set so subsequent detail
  // reads (including IPC-triggered warms) see the fresh values.
  if (m.type === "bustExtraFields") {
    const w = m as { tenant?: string };
    bustExtraFieldsCache(w.tenant);
    return;
  }
  // Demand-page warm kick: the worker that served GET /resource-demands
  // broadcasts the candidate project ids so every sibling worker heats its
  // OWN detail/team/task maps too (requests round-robin across the cluster).
  // Expired-entry-only + single-flight, so a redundant echo is harmless.
  if (m.type === "warmDemandProjects") {
    const w = m as { tid?: string; tenant?: string; ids?: unknown };
    if (w.tid && w.tenant && Array.isArray(w.ids)) {
      const ids = (w.ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, DEMAND_WARM_ROUTE_CAP);
      if (ids.length) void warmProjectsSequentially(w.tid, w.tenant, ids, DEMAND_WARM_ROUTE_CAP);
    }
    return;
  }
  // Hot-project opens are IPC-shared so every worker's LRU (and therefore its
  // scheduled re-warm) knows about opens handled by siblings. Local-only apply
  // — no re-broadcast, no echo loop. The lead worker also persists here so
  // opens handled by non-lead workers survive a restart.
  if (m.type === "noteHotProject") {
    const w = m as { tid?: string; projectId?: string };
    if (w.tid && w.projectId) {
      noteHotProjectLocal(w.tid, w.projectId);
      saveActiveTenantsDebounced();
    }
    return;
  }
  // Payload adoption: a sibling worker fetched project-detail / project-team /
  // task-data and shares the RESULT — adopt it instead of re-running the query
  // on this worker. Guards, in order: (1) fail-closed shape validation
  // mirroring each broadcast site — a malformed or legacy sibling message must
  // never seed an empty or failure-shaped payload cluster-wide (never cache
  // emptiness, and NEVER via IPC — receive-side must not trust the sender's
  // gate); (2) never adopt a payload that settled before a local bust of the
  // same key (+1s IPC skew slack) — post-save staleness must not ride in via
  // IPC; (3) our own in-flight fetch always wins; (4) never downgrade a
  // fresher local entry. Writes go through the same gen-guarded setters local
  // fetches use, with fromIpc set so adoption never re-broadcasts (no echo).
  if (m.type === "adoptCache") {
    const w = m as { fn?: string; key?: string; json?: string; expiresAt?: number; settledAt?: number };
    if (!w.fn || !w.key || typeof w.json !== "string" || typeof w.expiresAt !== "number" || typeof w.settledAt !== "number") return;
    if (w.expiresAt <= Date.now()) return; // expired in transit
    let data: unknown;
    try { data = JSON.parse(w.json); } catch { return; }
    if (data == null) return;
    if (w.fn === "projectDetail") {
      // Shape: non-empty plain object that is NOT a failure/not-found envelope.
      // Broadcast suppresses {Status:false, Data:null}; adoption rejects ANY
      // Status:false payload (upstream failure envelopes must stay local).
      if (typeof data !== "object" || Array.isArray(data)) return;
      if ((data as { Status?: unknown }).Status === false) return;
      if (Object.keys(data as object).length === 0) return;
      {
        // Canonicalize the incoming key: a differently-cased origin key must
        // land on (and be guarded by) the same entry the bust pre-stamped —
        // otherwise a pre-save payload from a sibling slips past bustAt.
        const key = pdNormalizeKey(w.key);
        if (w.settledAt <= (projectDetailBustAt.get(key) ?? 0) + 1000) return;
        if (projectDetailInFlight.has(key)) return;
        const hit = projectDetailCache.get(key);
        if (hit && hit.expiresAt >= w.expiresAt) return;
        setProjectDetailCacheIfCurrent(key, projectDetailGen.get(key) ?? 0, data, { fromIpc: true });
      }
    } else if (w.fn === "projectTeam") {
      // Shape: object with a non-empty team array — mirrors the broadcast
      // predicate in setProjectTeamCacheIfCurrent (empty teams stay local).
      if (typeof data !== "object" || Array.isArray(data)) return;
      const teamArr = (data as { team?: unknown }).team;
      if (!Array.isArray(teamArr) || teamArr.length === 0) return;
      if (w.settledAt <= (projectTeamBustAt.get(w.key) ?? 0) + 1000) return;
      if (projectTeamInFlight.has(w.key)) return;
      const hit = projectTeamCache.get(w.key);
      if (hit && hit.expiresAt >= w.expiresAt) return;
      setProjectTeamCacheIfCurrent(w.key, projectTeamGen.get(w.key) ?? 0, data as object, { fromIpc: true });
    } else if (w.fn === "taskData") {
      // Shape: non-empty array — mirrors setTaskDataCacheShared's broadcast
      // gate; [] must never be adopted (empty task lists recompute locally).
      if (!Array.isArray(data) || data.length === 0) return;
      if (w.settledAt <= (taskDataBustAt.get(w.key) ?? 0) + 1000) return;
      if (taskDataInFlight.has(w.key)) return;
      const hit = taskDataCache.get(w.key);
      if (hit && hit.expiresAt >= w.expiresAt) return;
      setTaskDataCacheShared(w.key, data as object[], { fromIpc: true });
    } else if (w.fn === "recruitment") {
      // Recruitment analytics payload — all guards (fail-closed shape check,
      // post-bust +1s skew, local in-flight wins, never downgrade a fresher
      // entry) live next to the cache in lib/financial-cache.ts.
      const staleRaw = (m as { staleExpiresAt?: unknown }).staleExpiresAt;
      const staleExpiresAt = typeof staleRaw === "number" ? staleRaw : w.expiresAt;
      adoptRecruitmentPayload(w.key, data, w.expiresAt, staleExpiresAt, w.settledAt);
    }
    return;
  }
  if (m.type !== "bustCache") return;
  switch (m.fn) {
    case "stageRules":
      // Admin saved stage rules (or the opp stage set changed): drop this
      // worker's rules + stage-order snapshots so write enforcement and the
      // /stage-rules payload pick up the new policy promptly. The status
      // dropdowns embed workflow stage names, so their cache goes too.
      bustStageRulesCache((m as { tenant?: string }).tenant);
      bustStageOrderCache(m.tid);
      bustFieldOptionsCache(m.tid);
      break;
    case "accessControl":
      // Admin saved user groups / access levels / stage permissions: drop this
      // worker's access-control snapshots so gates pick up the change promptly.
      bustAccessControlCache((m as { tenant?: string }).tenant);
      break;
    case "org":
      if (m.tid) {
        divCache.delete(m.tid); deptCache.delete(m.tid); buListCache.delete(m.tid);
        divInFlight.delete(m.tid); deptInFlight.delete(m.tid); buListInFlight.delete(m.tid);
      }
      break;
    case "finAnalytics":
      // Allocation hours or NC flag changed — drop this worker's financial
      // analytics cache so the Financial page reflects the new values on the
      // next request rather than serving a stale 10-min TTL copy.
      if (m.tid) bustFinancialCache(m.tid);
      break;
    case "staffOrg":
      // Staff org placement changed (assignment edit, new staff, import) —
      // drop this worker's org-audience membership map so live BU/Division/
      // Department audiences reflect the move promptly, not after the TTL.
      invalidateStaffOrgCache(m.tid);
      break;
    case "users":
      // Both user caches: the route-level snapshot AND the rds-provider
      // getUsersRds cache that backs /user-list — a reactivated/created
      // person must appear in pickers on EVERY worker, not after a 5-min TTL.
      // The resource-master directory (Forecast pivots) is a view of the same
      // rmone_users rows, so it rides the same signal.
      if (m.tid) { usersCache.delete(m.tid); usersInFlight.delete(m.tid); bustUsersRdsCache(m.tid); bustResourceMasterLocal(m.tid); }
      break;
    case "resAllocs":
      if (m.tid) bustResAllocsLocal(m.tid);
      break;
    case "records":
      if (m.tid && (m as Record<string,unknown>).module) {
        const mod = String((m as Record<string,unknown>).module);
        bustRdsRecordsLocal(m.tid, mod);
        // COM records and the slim company-picker list are views of the same
        // rows — a company create/backfill on any worker busts both here.
        if (mod === "COM") bustCompaniesSlimCache(m.tid);
      } else if (m.tid) {
        bustRdsRecordsLocal(m.tid);
        bustCompaniesSlimCache(m.tid);
      }
      break;
    case "recordToken": {
      // Token-keyed records-list bust (bustRecordCache on a sibling worker or
      // instance): the message carries only the sha256-derived key suffix —
      // never raw token bytes. Route through the SAME local helper the direct
      // call uses so both sides delete by the same rule.
      const tokenHash = (m as { tokenHash?: unknown }).tokenHash;
      if (typeof tokenHash === "string" && tokenHash.length > 0) bustRecordCacheLocal(tokenHash);
      break;
    }
    case "taskData":
      if (m.ticketId && m.tid) {
        bustTaskDataLocal(`${m.tid}:${m.ticketId}`);
      } else if (m.tid) {
        const keys = new Set<string>([
          ...taskDataCache.keys(), ...taskDataInFlight.keys(), ...taskDataGen.keys(),
        ]);
        for (const k of keys) if (k.startsWith(`${m.tid}:`)) bustTaskDataLocal(k);
      }
      // Sibling worker saved a schedule — drop this worker's record
      // phase-order snapshot too (stage-rule enforcement reads it).
      if (m.tid) bustRecordPhaseOrderCache(m.tid, m.ticketId);
      break;
    case "lifecycles":
      if (m.tid) { lifecyclesCache.delete(m.tid); lifecyclesInFlight.delete(m.tid); }
      break;
    case "weeklyAlloc":
      if (m.projectId && m.tid) {
        weeklyAllocCache.delete(`${m.tid}:${m.projectId}`);
        weeklyAllocInFlight.delete(`${m.tid}:${m.projectId}`);
      } else if (m.tid) {
        for (const k of weeklyAllocCache.keys()) if (k.startsWith(`${m.tid}:`)) weeklyAllocCache.delete(k);
        for (const k of weeklyAllocInFlight.keys()) if (k.startsWith(`${m.tid}:`)) weeklyAllocInFlight.delete(k);
      }
      break;
    case "allProject":
      bustAllProjectTeamLocal();
      utilCache.clear();
      break;
    case "projectDetail":
      // Must route through bustProjectDetailLocal so the generation counter is
      // bumped on THIS worker too — otherwise a background refresh started here
      // before a save on another worker would pass the gen check and write the
      // pre-save snapshot back into the cache.
      if (m.ticketId && m.tid) {
        bustProjectDetailForTicketLocal(m.tid, m.ticketId);
      } else if (m.tid) {
        const keys = new Set<string>([
          ...projectDetailCache.keys(), ...projectDetailInFlight.keys(), ...projectDetailGen.keys(),
        ]);
        for (const k of keys) if (k.startsWith(`${m.tid}:`)) bustProjectDetailLocal(k);
      }
      break;
    case "divRoles":
      // Route through bustDivRolesLocal so the generation counter is bumped on
      // THIS worker too — otherwise a background refresh started here before a
      // save on another worker would write the pre-save BU list back.
      if (m.ticketId && m.tid) {
        bustDivRolesLocal(`${m.tid}:${m.ticketId}`);
      } else if (m.tid) {
        const keys = new Set<string>([
          ...divRolesCache.keys(), ...divRolesInFlight.keys(), ...divRolesGen.keys(),
        ]);
        for (const k of keys) if (k.startsWith(`${m.tid}:`)) bustDivRolesLocal(k);
      }
      break;
    case "roleRates":
      // Route through bustRoleRatesLocal so the generation counter is bumped
      // on THIS worker too — same mid-flight repopulate guard as divRoles.
      if (m.tid) bustRoleRatesLocal(m.tid);
      break;
    case "projectAllocs":
      if (m.projectId && m.tid) {
        projectAllocsCache.delete(`${m.tid}:${m.projectId}`);
        projectAllocsInFlight.delete(`${m.tid}:${m.projectId}`);
      } else if (m.tid) {
        for (const k of projectAllocsCache.keys()) if (k.startsWith(`${m.tid}:`)) projectAllocsCache.delete(k);
        for (const k of projectAllocsInFlight.keys()) if (k.startsWith(`${m.tid}:`)) projectAllocsInFlight.delete(k);
      }
      break;
    case "projectTeam":
      if (m.projectId && m.tid) {
        bustProjectTeamLocal(`${m.tid}:${m.projectId}`);
      } else if (m.tid) {
        const keys = new Set<string>([
          ...projectTeamCache.keys(), ...projectTeamInFlight.keys(), ...projectTeamGen.keys(),
        ]);
        for (const k of keys) if (k.startsWith(`${m.tid}:`)) bustProjectTeamLocal(k);
      }
      // Allocation writes also change Timeline utilisation; role-rate writes
      // only change cost figures. Keep that expensive global cache clear
      // explicit so a tenant-wide rate save doesn't evict unrelated tenants.
      if (m.clearUtil) utilCache.clear();
      break;
  }
}

/**
 * Bust the project-team cache for ONE project on THIS worker and broadcast the
 * same invalidation to every other cluster worker via IPC. Without the
 * broadcast, a save handled by worker A leaves worker B's 30-min cache entry
 * intact — the client's immediate refetch then randomly lands on B and shows
 * stale data until a manual refresh. Also clears the Timeline utilisation
 * cache everywhere (allocation writes change utilisation too). The local bust
 * bumps the generation counter so an in-flight pre-save read can't repopulate
 * the cache with its stale snapshot after the bust.
 */
function bustProjectTeamCache(tid: string, projectId: string): void {
  bustProjectTeamLocal(`${tid}:${projectId}`);
  utilCache.clear();
  broadcastBust({ type: "bustCache", fn: "projectTeam", tid, projectId, clearUtil: true });
}

/**
 * Bust the project-team cache for EVERY project of a tenant (this worker +
 * IPC broadcast, which the "projectTeam" handler already supports tenant-wide).
 * Needed after role RATE writes: rates are tenant-wide role attributes baked
 * into every cached /project-team payload (member costRate → ETC/EAC cost
 * columns), so a rate save must invalidate all of them — otherwise the grid
 * shows the old cost for up to the 30-min TTL even after a hard refresh.
 */
function bustProjectTeamTenant(tid: string): void {
  const keys = new Set<string>([
    ...projectTeamCache.keys(), ...projectTeamInFlight.keys(), ...projectTeamGen.keys(),
  ]);
  for (const k of keys) if (k.startsWith(`${tid}:`)) bustProjectTeamLocal(k);
  broadcastBust({ type: "bustCache", fn: "projectTeam", tid });
}

/** Refresh every cached view that embeds canonical app-user identity/status.
 * This deliberately uses the established per-cache IPC signals rather than a
 * new one, so worker and cross-instance handlers remain the single source of
 * cache invalidation behavior. */
export function bustStaffIdentityCaches(tid: string): void {
  bustResAllocsRouteCache(tid);
  bustProjectTeamTenant(tid);
  usersCache.delete(tid);
  usersInFlight.delete(tid);
  bustUsersRdsCache(tid);
  bustResourceMasterLocal(tid);
  broadcastBust({ type: "bustCache", fn: "users", tid });
  // Project-team rows resolve canonical identity through this map.
  bustStaffOrgEverywhere(tid);
}

/** Bust all three org caches for a tenant (call after any org write). */
export function bustOrgCache(tid: string): void {
  divCache.delete(tid);
  deptCache.delete(tid);
  buListCache.delete(tid);
  divInFlight.delete(tid);
  deptInFlight.delete(tid);
  buListInFlight.delete(tid);
  broadcastBust({ type: "bustCache", fn: "org", tid });
}

/** After a rename/relink/delete of a BU/Division/Department, record pages still
 *  resolve the OLD name from cached project-detail snapshots and the division-
 *  hierarchy cache — bust those too, not just the org list caches.
 *  Also busts staffOrgCache on THIS worker and all siblings: that cache holds
 *  the resolved buName/divName/deptName per staff member and would otherwise
 *  serve the old name for up to the 5-min TTL on every cluster worker. */
export function bustOrgDerivedCaches(tid: string): void {
  bustOrgCache(tid);
  bustProjectDetailCache(tid);
  invalidateDivisionHierarchy(tid);   // clears divHierCache + staffOrgCache locally
  bustStaffOrgEverywhere(tid);        // broadcasts "staffOrg" IPC so siblings also clear
}

// ── Users list cache ────────────────────────────────────────────────────────
// Keyed by tenantId. Read every time the "Select PM" dropdown or any user-list
// component mounts. Users rarely change (new hire, depart) so 10-min TTL is
// safe.  Busted explicitly when a new staff member is created or deleted.
const USERS_CACHE_TTL_MS         = 10 * 60 * 1000;
const USERS_CACHE_STALE_GRACE_MS = 30 * 60 * 1000;
const usersCache    = new Map<string, { data: object[]; expiresAt: number }>();
const usersInFlight = new Map<string, Promise<object[]>>();

/** Test-only handles for the activation cache-freshness regression. */
export const __staffIdentityCacheTestHooks = {
  resAllocsCache,
  resAllocsInFlight,
  projectTeamCache,
  projectTeamInFlight,
  projectTeamGen,
  usersCache,
  usersInFlight,
};

// ── Project-division-roles (Business Units section) cache ───────────────────
// Keyed by "tid:ticketId". Read every time the BU section expands; writes are
// rare (save / create BU).  2-min TTL + 10-min stale grace so the section
// opens instantly even on a warm (stale) hit, and a background refresh keeps
// it fresh for the next open.
const DIV_ROLES_TTL_MS          = 2 * 60 * 1000;
const DIV_ROLES_STALE_GRACE_MS  = 10 * 60 * 1000;
const divRolesCache    = new Map<string, { data: object; expiresAt: number }>();
const divRolesInFlight = new Map<string, Promise<object>>();
// Generation counter per key — same read-repopulate race guard as
// projectDetailGen: a BU query started BEFORE a save that completes AFTER the
// bust must NOT write its pre-save snapshot back into the cache.
const divRolesGen = new Map<string, number>();

/** Cache the BU result only if no bust invalidated this key mid-query. */
function setDivRolesCacheIfCurrent(cacheKey: string, startGen: number, data: object): void {
  if ((divRolesGen.get(cacheKey) ?? 0) !== startGen) return; // busted mid-flight — discard
  divRolesCache.set(cacheKey, { data, expiresAt: Date.now() + DIV_ROLES_TTL_MS });
  capMap(divRolesCache, CACHE_MAX_PROJECTS);
}

/** Local-only BU-section bust (also applied from cross-worker IPC). */
function bustDivRolesLocal(cacheKey: string): void {
  divRolesGen.set(cacheKey, (divRolesGen.get(cacheKey) ?? 0) + 1);
  capMap(divRolesGen, CACHE_MAX_PROJECTS);
  divRolesCache.delete(cacheKey);
  divRolesInFlight.delete(cacheKey);
}

/** Bust the Business Units section cache after any record-field write —
 *  DivisionLookup / DivisionMultiLookup edits land through /update-fields,
 *  PUT /project and /smart-update, and without this the post-save reload was
 *  served the PRE-save BU list for up to TTL+grace ("my save didn't work"). */
export function bustDivRolesCache(tid: string, ticketId?: string): void {
  if (ticketId) {
    bustDivRolesLocal(`${tid}:${ticketId}`);
  } else {
    const keys = new Set<string>([
      ...divRolesCache.keys(), ...divRolesInFlight.keys(), ...divRolesGen.keys(),
    ]);
    for (const k of keys) if (k.startsWith(`${tid}:`)) bustDivRolesLocal(k);
  }
  broadcastBust({ type: "bustCache", fn: "divRoles", tid, ticketId });
}

// ── Role billing rates cache (company-wide, per tenant) ─────────────────────
// Keyed by tid. Read on EVERY project-detail open (Budget & Costs section) and
// on the Billing Rates page. The underlying data is tiny (tens of rows) but
// costs 2 parallel round-trips to RDS (~0.5-1s+), and on project open the
// request queues behind the team-fetch fan-out — so a warm cache makes the
// Budget section effectively instant. Writes are rare (rate edits, role
// create/delete) and every write path busts explicitly, so a 2-min TTL +
// stale-grace SWR is safe. Dept-scoped requests (departmentId) bypass this
// cache entirely — they're only used on the Billing Rates page.
const ROLE_RATES_TTL_MS         = 2 * 60 * 1000;
const ROLE_RATES_STALE_GRACE_MS = 10 * 60 * 1000;
const roleRatesCache    = new Map<string, { data: object; expiresAt: number }>();
const roleRatesInFlight = new Map<string, Promise<object>>();
// Generation counter — same read-repopulate race guard as divRolesGen: a
// rates query started BEFORE a save that completes AFTER the bust must NOT
// write its pre-save snapshot back into the cache.
const roleRatesGen = new Map<string, number>();

/** Cache the rates result only if no bust invalidated this tenant mid-query. */
function setRoleRatesCacheIfCurrent(tid: string, startGen: number, data: object): void {
  if ((roleRatesGen.get(tid) ?? 0) !== startGen) return; // busted mid-flight — discard
  roleRatesCache.set(tid, { data, expiresAt: Date.now() + ROLE_RATES_TTL_MS });
  capMap(roleRatesCache, CACHE_MAX_PROJECTS);
}

/** Local-only role-rates bust (also applied from cross-worker IPC). */
function bustRoleRatesLocal(tid: string): void {
  roleRatesGen.set(tid, (roleRatesGen.get(tid) ?? 0) + 1);
  capMap(roleRatesGen, CACHE_MAX_PROJECTS);
  roleRatesCache.delete(tid);
  roleRatesInFlight.delete(tid);
}

/** Bust the role-rates cache after any rate write or role create/delete. */
export function bustRoleRatesCache(tid: string): void {
  bustRoleRatesLocal(tid);
  broadcastBust({ type: "bustCache", fn: "roleRates", tid });
}

// ── Task-data (phase schedule) cache ────────────────────────────────────────
// Keyed by "tid:ticketId". Read on every project-detail open; writes are rare
// (only when admin saves a new schedule). 5-min TTL balances freshness vs DB.
const TASK_DATA_TTL_MS = 5 * 60 * 1000;
// After TTL expiry serve the stale value (instantly) while a background
// refresh runs. 6-hour grace (was 2 min): the phase schedule is the ONE
// section the detail page's opening overlay hard-waits on, and under DB
// contention a cold getTaskDataRds can blow past the overlay's 12s bound —
// producing the "overlay closed but schedule still spinning" double-load.
// A long grace means any project visited earlier in the day serves <1 ms
// even when the DB is saturated. Safe because EVERY schedule write path
// calls bustTaskDataCache (+ cross-worker IPC broadcast), so an edited
// schedule is never served stale — the grace only extends UNCHANGED data.
const TASK_DATA_STALE_GRACE_MS = 6 * 60 * 60 * 1000;
const taskDataCache = new Map<string, { data: object[]; expiresAt: number }>();
// Single-flight dedup: when the cache is cold or busted, only ONE DB query
// fires per key. All concurrent requests for the same project share that
// one Promise — so 400 users hitting the same project after a save
// generate exactly 1 DB round-trip, not 400.
const taskDataInFlight = new Map<string, Promise<object[]>>();
const taskDataGen = new Map<string, number>();

function bustTaskDataLocal(key: string): void {
  taskDataGen.set(key, (taskDataGen.get(key) ?? 0) + 1);
  taskDataCache.delete(key);
  taskDataInFlight.delete(key);
  taskDataBustAt.set(key, Date.now());
  capMap(taskDataGen, CACHE_MAX_PROJECTS);
  capMap(taskDataBustAt, CACHE_MAX_PROJECTS);
}

export function bustTaskDataCache(tid: string, ticketId?: string): void {
  if (ticketId) {
    bustTaskDataLocal(`${tid}:${ticketId}`);
  } else {
    const keys = new Set<string>([
      ...taskDataCache.keys(), ...taskDataInFlight.keys(), ...taskDataGen.keys(),
    ]);
    for (const k of keys) if (k.startsWith(`${tid}:`)) bustTaskDataLocal(k);
  }
  // Stage-rule enforcement positions rules on the record's OWN phase order —
  // a schedule write must drop that snapshot too, or positional from/until
  // rules judge against the pre-save schedule for up to its TTL.
  bustRecordPhaseOrderCache(tid, ticketId);
  broadcastBust({ type: "bustCache", fn: "taskData", tid, ticketId });
}

// ── Lifecycles (templates) cache ────────────────────────────────────────────
// Keyed by tid. Read on EVERY project-detail open (the Schedule section fires
// getLifecycles alongside task-data), yet the underlying core2 query costs
// ~0.9s and templates change only when an admin edits them. 10-min TTL +
// stale-grace + single-flight turns that into a <1 ms in-memory hit.
const LIFECYCLES_TTL_MS = 10 * 60 * 1000;
const LIFECYCLES_STALE_GRACE_MS = 5 * 60 * 1000;
const lifecyclesCache = new Map<string, { data: unknown[]; expiresAt: number }>();
const lifecyclesInFlight = new Map<string, Promise<unknown[]>>();

export function bustLifecyclesCache(tid: string): void {
  lifecyclesCache.delete(tid);
  lifecyclesInFlight.delete(tid);
  broadcastBust({ type: "bustCache", fn: "lifecycles", tid });
}

/** Fetch lifecycles through the tid-keyed cache (single-flight on miss). */
function getLifecyclesCached(tid: string): Promise<unknown[]> {
  const now = Date.now();
  const hit = lifecyclesCache.get(tid);
  if (hit && hit.expiresAt > now) return Promise.resolve(hit.data);

  const refresh = (): Promise<unknown[]> => {
    let p = lifecyclesInFlight.get(tid);
    if (!p) {
      p = getLifecyclesRds(tid)
        .then((data) => {
          const arr = Array.isArray(data) ? data : [];
          lifecyclesCache.set(tid, { data: arr, expiresAt: Date.now() + LIFECYCLES_TTL_MS });
          lifecyclesInFlight.delete(tid);
          return arr;
        })
        .catch((e) => { lifecyclesInFlight.delete(tid); throw e; });
      lifecyclesInFlight.set(tid, p);
    }
    return p;
  };

  // Stale within grace → serve instantly, refresh in background.
  if (hit && hit.expiresAt + LIFECYCLES_STALE_GRACE_MS > now) {
    refresh().catch((e) => console.warn(`[lifecycles][rds] bg-refresh failed: ${String(e)}`));
    return Promise.resolve(hit.data);
  }
  // Stale-if-error: past the grace window, still prefer the last-known-good
  // list over a 502 when the refresh fails — lifecycles change rarely.
  return refresh().catch((e) => {
    if (hit) {
      console.warn(`[lifecycles][rds] refresh failed — serving stale: ${String(e)}`);
      return hit.data;
    }
    throw e;
  });
}

// ── Weekly-allocations cache ─────────────────────────────────────────────────
// Keyed by "tid:projectId". Serves the hours-editor grid; busted immediately
// on every hours save so edits are always visible without a page reload.
// 2-min TTL as a safety net for background syncs.
const WEEKLY_ALLOC_TTL_MS = 2 * 60 * 1000;
// Short grace window — hours data changes frequently so don't serve very stale
// data, but 30 s is enough for a background refresh to complete.
const WEEKLY_ALLOC_STALE_GRACE_MS = 30 * 1000;
const weeklyAllocCache = new Map<string, { data: object; expiresAt: number }>();
const weeklyAllocInFlight = new Map<string, Promise<object>>();
// Generation counter per cache key — same read-repopulate race guard as
// projectTeamGen. With debounce=0 two rapid saves each kick off a warm query;
// the older one can finish AFTER the newer one and overwrite the fresher
// result. Incrementing on every bust and checking before each cache write
// ensures only the result from the most-recent query survives.
const weeklyAllocGen = new Map<string, number>();

export function bustWeeklyAllocCache(tid: string, projectId?: string): void {
  if (projectId) {
    const key = `${tid}:${projectId}`;
    weeklyAllocGen.set(key, (weeklyAllocGen.get(key) ?? 0) + 1);
    capMap(weeklyAllocGen, CACHE_MAX_PROJECTS);
    weeklyAllocCache.delete(key);
    weeklyAllocInFlight.delete(key);
  } else {
    for (const k of weeklyAllocCache.keys()) {
      if (k.startsWith(`${tid}:`)) { weeklyAllocGen.set(k, (weeklyAllocGen.get(k) ?? 0) + 1); weeklyAllocCache.delete(k); }
    }
    for (const k of weeklyAllocInFlight.keys()) {
      if (k.startsWith(`${tid}:`)) weeklyAllocInFlight.delete(k);
    }
    capMap(weeklyAllocGen, CACHE_MAX_PROJECTS);
  }
  broadcastBust({ type: "bustCache", fn: "weeklyAlloc", tid, projectId });
}

// ── Post-write warm for the Hours View (project-team + weekly allocations) ──
// Every team-mutating write (assign/edit/remove a member, weekly hours save)
// busts projectTeamCache + weeklyAllocCache. Without a re-warm, the NEXT open
// of Project Detail's Hours View blocks on a full cold rebuild (two heavy
// core2 queries) — the "Loading schedule…" spinner the user sees. This helper
// kicks off that rebuild in the background immediately after the write, so by
// the time the user switches to the Hours View both caches are already fresh.
//
// • Debounced per project (1 s): bulk flows (e.g. bulk-create assigning many
//   members back-to-back) collapse into a single rebuild instead of N.
// • Single-flight: reuses the same inFlight maps as the read routes, so a
//   user request arriving mid-warm joins the warm's promise instead of
//   issuing a duplicate DB query.
// • Gen-guarded (project-team): a bust that lands while the warm query is
//   running bumps the generation counter and the stale result is discarded.
// • Cluster-wide: the IPC broadcast makes every other worker run the same
//   warm — a bust without a warm on worker B would leave B cold and the
//   user's next request round-robins randomly.
const projectHoursWarmTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Debounce reduced to 0 ms: the in-flight dedup (projectTeamInFlight) already
// coalesces concurrent warm queries, so the 1 s delay only meant the warm
// never beat the client's post-save refetch — leaving every surface (Gantt,
// staff grid, project header) on a cold-cache DB query instead of a cache hit.
const PROJECT_HOURS_WARM_DEBOUNCE_MS = 0;

function warmProjectHoursCachesLocal(tid: string, tenant: string, projectId: string): void {
  const key = `${tid}:${projectId}`;
  const prev = projectHoursWarmTimers.get(key);
  if (prev) clearTimeout(prev);
  projectHoursWarmTimers.set(key, setTimeout(() => {
    projectHoursWarmTimers.delete(key);
    // Project-team warm (mirrors the /project-team cold-miss path).
    if (!projectTeamInFlight.has(key)) {
      const startGen = projectTeamGen.get(key) ?? 0;
      // defaultRate omitted → derived inside getProjectTeamRds from its own
      // parallel settings read (saves a sequential DB round-trip).
      const teamP = getProjectTeamRds(tid, projectId, undefined, tenant).then((data) => {
        const teamArr = (data as { team?: unknown[] })?.team;
        // Empty results cache too (short TTL inside setProjectTeamCacheIfCurrent).
        setProjectTeamCacheIfCurrent(key, startGen, data);
        projectTeamInFlight.delete(key);
        console.log(`[warm-hours] project-team tid=${tid} project=${projectId} members=${teamArr?.length ?? 0}`);
        return data;
      }).catch((e) => {
        projectTeamInFlight.delete(key);
        console.warn(`[warm-hours] project-team failed: ${String(e)}`);
        return {} as object;
      });
      projectTeamInFlight.set(key, teamP);
    }
    // Weekly-allocations warm (mirrors the /project-allocations cold-miss path).
    if (!weeklyAllocInFlight.has(key)) {
      // Snapshot the generation BEFORE starting the query — any bust that
      // arrives while the query is in flight will have incremented the counter,
      // and the write guard below will discard our now-stale result.
      const startWAGen = weeklyAllocGen.get(key) ?? 0;
      const wp: Promise<object> = getWeeklyAllocationsRds(tid, projectId, tenant)
        .then((d) => {
          // Gen-guarded write: discard if a bust invalidated this key mid-query.
          if ((weeklyAllocGen.get(key) ?? 0) === startWAGen) {
            weeklyAllocCache.set(key, { data: d, expiresAt: Date.now() + WEEKLY_ALLOC_TTL_MS });
            capMap(weeklyAllocCache, CACHE_MAX_PROJECTS);
          }
          weeklyAllocInFlight.delete(key);
          console.log(`[warm-hours] weekly-alloc tid=${tid} project=${projectId}`);
          return d;
        })
        .catch((e) => {
          weeklyAllocInFlight.delete(key);
          console.warn(`[warm-hours] weekly-alloc failed: ${String(e)}`);
          return {} as object;
        });
      weeklyAllocInFlight.set(key, wp);
    }
  }, PROJECT_HOURS_WARM_DEBOUNCE_MS));
}

/** Warm the Hours View caches on THIS worker and every other cluster worker. */
function warmProjectHoursCaches(tid: string, tenant: string, projectId: string): void {
  if (!projectId) return;
  warmProjectHoursCachesLocal(tid, tenant, projectId);
  broadcastBust({ type: "warmProjectHours", tid, tenant, projectId });
}

// ── LRU cap helper ──────────────────────────────────────────────────────────
// JS Maps preserve insertion order, so keys().next() is always the oldest
// entry. Call this after every .set() on any unbounded cache Map to prevent
// unbounded heap growth under 2 000+ users across many tenants/projects.
function capMap<V>(map: Map<string, V>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
const CACHE_MAX_PROJECTS = 500; // project-scoped caches (team, schedule, weekly alloc)
const CACHE_MAX_ORG      = 200; // tenant-scoped org lists (divisions, depts, BUs)
const CACHE_MAX_UTIL     = 300; // utilization grids (large payloads, fewer tenants)

function tokenCacheKey(prefix: string, auth: string): string {
  // Strip "Bearer " prefix and surrounding whitespace before hashing so the
  // same token formatted slightly differently still hits the same key.
  const normalized = auth.replace(/^bearer\s+/i, "").trim();
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 32);
  return `${prefix}:${hash}`;
}

function pruneResourceAllocCache(): void {
  const now = Date.now();
  for (const [k, v] of resourceAllocCache) {
    if (v.expiresAt <= now) resourceAllocCache.delete(k);
  }
  // Hard cap: if still over the limit, drop the oldest entries (insertion order).
  while (resourceAllocCache.size > RESOURCE_ALLOC_CACHE_MAX) {
    const oldestKey = resourceAllocCache.keys().next().value;
    if (oldestKey === undefined) break;
    resourceAllocCache.delete(oldestKey);
  }
}

/**
 * Invalidate the per-user allocation caches after a write so the next read
 * round-trips to RM ONE instead of returning a 2-min-old snapshot.
 *
 * Why this is needed: the WeeklyAllocationFormCard.handleSave() POSTs to
 * /hours-allocation which writes to RM ONE immediately, but the PersonProfileCard
 * (EAC HRS / Allocation %), people-search results, and the per-person projects
 * sheet all read through resourceAllocCache / peopleCache / peopleProjectsCache.
 * Without this bust, the user saves on web, sees "Saved 640h", then opens the
 * mobile profile and still sees the OLD 125h until either the 2-min TTL expires
 * or they force-refresh. Same problem on web for any subsequent profile render.
 *
 * We only clear the calling user's keys (token-derived) — every cache here is
 * per-user, and busting other users' entries would force needless re-fetches.
 */
function bustResourceAllocCache(auth: string): void {
  const allocKey = tokenCacheKey("resource-allocations", auth);
  resourceAllocCache.delete(allocKey);
  resourceAllocInFlight.delete(allocKey);
  bustResourceAllocationsCache(); // also clear the rds-provider in-memory cache
  // peopleCache + peopleProjectsCache key on the last 20 chars of the raw auth
  // header. Use the same scheme so we hit the right entry.
  const peopleKey = auth.slice(-20);
  peopleCache.delete(peopleKey);
  peopleProjectsCache.delete(peopleKey);
}

/** Token-derived recordCache key suffix. SHA-256 of the normalized auth
 *  header (same normalization as tokenCacheKey) — NEVER raw token bytes: the
 *  "recordToken" bust broadcast carries this suffix through cluster IPC and,
 *  when the cross-instance bus is on, through Redis/DB envelopes (DB mode
 *  persists them in a table), so it must not be replayable credential
 *  material. Every recordCache writer must key entries with this suffix. */
function recordCacheTokenHash(authHeader: string): string {
  const normalized = authHeader.replace(/^bearer\s+/i, "").trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

/** Local-only apply — shared by bustRecordCache and the cluster IPC handler
 *  (case "recordToken") so both sides delete by the exact same rule. */
function bustRecordCacheLocal(tokenHash: string): void {
  for (const key of recordCache.keys()) {
    if (key.endsWith(`:${tokenHash}`)) recordCache.delete(key);
  }
}

/**
 * Clear all cached module records for a given auth token so the next fetch is
 * live — on EVERY worker, not just the one that handled the save. Requests are
 * round-robined across the cluster (and soon across instances), so without the
 * broadcast the saving user's next list request can land on a sibling worker
 * still serving their token-keyed pre-save list until its TTL lapses (the
 * Aug 27 repro only saw fresh lists within 4s by scheduling luck). The
 * broadcast goes through the primary's single relay choke point, so it also
 * crosses instances automatically whenever the cache bus is on ("bustCache"
 * types are whitelisted as busts).
 */
export function bustRecordCache(authHeader: string) {
  const tokenHash = recordCacheTokenHash(authHeader);
  bustRecordCacheLocal(tokenHash);
  broadcastBust({ type: "bustCache", fn: "recordToken", tokenHash });
  console.log(`[records] Cache busted for token hash ${tokenHash.slice(0, 8)}…`);
}

/**
 * Bust EVERY proxy cache that could serve a stale project record after a
 * write. Call this from any handler that mutates a PMM/OPM/COM/CON record
 * outside the local PUT /project route (e.g. /api/decision/defer-pursuit
 * which calls RM ONE UpdateRecord directly). Without it, the project card
 * keeps showing the pre-write TargetCompletionDate / value / status for up
 * to ~5 min until the per-token cache expires, even though RM ONE already
 * has the new value.
 *
 * Mirrors the bust set the local PUT /project handler performs (lines
 * ~388-395) so callers do not need to re-derive that list.
 */
export function bustAllProjectCaches(authHeader: string, tid?: string): void {
  bustRecordCache(authHeader);
  bustModuleCache();
  utilCache.clear();
  bustResourceAllocCache(authHeader);
  bustAllProjectTeamLocal();
  broadcastBust({ type: "bustCache", fn: "allProject" });
  // RDS tenants are served from tid-keyed caches (recordsCache / resAllocsCache
  // / resDemandsCache / org / users / task-data / weekly-alloc / project-detail),
  // which the auth-keyed busts above never touch. Without this, the
  // Pipeline/Projects/Resources pages keep serving the pre-import snapshot for
  // up to the full TTL + stale grace after an onboarding import completes.
  // Imports can create org units, users, schedule phases, and allocations, so
  // bust the full tid-keyed set (each helper broadcasts to the other workers).
  if (tid) {
    bustRdsRecordsCache(tid);
    bustResAllocsRouteCache(tid);
    bustOrgCache(tid);
    usersCache.delete(tid); usersInFlight.delete(tid);
    // Also the rds-provider getUsersRds cache backing /user-list — imports can
    // reactivate people (roster wins over deactivation), and the picker must
    // show them immediately, not after the 5-min TTL.
    bustUsersRdsCache(tid);
    bustResourceMasterLocal(tid);
    broadcastBust({ type: "bustCache", fn: "users", tid });
    bustTaskDataCache(tid);
    bustWeeklyAllocCache(tid);
    bustProjectDetailCache(tid);
    bustProjectAllocsCache(tid);
    // Imports can create lifecycle templates via the pipeline's
    // findOrCreateLifecycleForPhasesRds calls — drop the cached list too.
    bustLifecyclesCache(tid);
    // Imports can move people between BU/Division/Department — the live
    // org-audience membership map must not serve pre-import placements.
    bustStaffOrgEverywhere(tid);
  }
}

/** Re-warm the home/forecast source caches for a tenant right after an
 *  onboarding import wipes them (bustAllProjectCaches). Without this the first
 *  post-import visit to Home / Forecast / Alerts pays the full cold-query cost
 *  (30s+) and can render "NO LIVE DATA". Mirrors the login-time warm: warm this
 *  worker, then broadcast so the other workers warm too. */
export function warmTenantCachesAfterImport(tid: string, tenant: string): void {
  try {
    warmHomeCaches(tid, tenant);
    broadcastBust({ type: "warmHome", tid, tenant });
  } catch { /* warming is best-effort */ }
}

// How many of the imported tenant's projects get their detail/team/task-data
// caches pre-warmed right after an import. Deliberately small: the warm runs
// while post-import processing is still settling, and most of the cold cost is
// process/tenant-scoped one-shots (DDL probes, custom-ticket scan, division
// hierarchy, org maps) — warming even one project removes the bulk of the
// first-click penalty for every project on that worker.
const IMPORT_PROJECT_WARM_CAP = 5;

/** Bust the per-tenant extra-fields row cache on THIS worker and every
 *  sibling. Must be called after ANY write to the onboarding extra-fields
 *  store (import pipeline, admin edit/delete) or other workers serve up to
 *  60s-stale extra fields on project/opportunity detail reads. */
export function bustExtraFieldsEverywhere(tenant: string): void {
  try {
    bustExtraFieldsCache(tenant);
    broadcastBust({ type: "bustExtraFields", tenant });
  } catch { /* best-effort */ }
}

/** Warm the imported tenant's TOP project detail/team/task caches so the first
 *  post-import project open is served hot instead of paying the ~10s cold
 *  chain. MUST be called AFTER onboarding persists extra fields
 *  (saveExtraFields) — warming earlier would bake a pre-write (empty)
 *  extra-fields snapshot into projectDetailCache. Busts the extra-fields row
 *  cache on every worker first for the same reason, then warms sequentially
 *  (never fans the heavy 7-join team query into the pool) and broadcasts so
 *  sibling workers heat their own maps. */
export function warmImportedProjectsAfterImport(tid: string, tenant: string): void {
  bustExtraFieldsEverywhere(tenant);
  void (async () => {
    try {
      // Ranked by open allocation count — the projects users drill into first.
      const payload = await getRecordsCached(tid, tenant, "PMM") as { data?: Array<Record<string, unknown>> } | null;
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      const ids = rows
        .map((r) => ({ id: typeof r.TicketId === "string" ? r.TicketId.trim() : "", n: Number(r.NumAllocations) || 0 }))
        .filter((x) => x.id)
        .sort((a, b) => b.n - a.n)
        .slice(0, IMPORT_PROJECT_WARM_CAP)
        .map((x) => x.id);
      if (!ids.length) return;
      await warmProjectsSequentially(tid, tenant, ids, IMPORT_PROJECT_WARM_CAP);
      broadcastBust({ type: "warmDemandProjects", tid, tenant, ids });
      console.log(`[import-warm] warmed ${ids.length} project(s) for ${tenant}`);
    } catch (e) {
      console.warn(`[import-warm] project warm failed for ${tenant}: ${String(e)}`);
    }
  })();
}

// NOTE: Different tenants populate different value / sector field names. We pass
// every plausible value field through so the client-side fallback can pick the
// first non-empty one (see getProjectValue / getProjectSector in app/(tabs)/index.tsx).
const VALUE_FIELDS = ["ApproxContractValue","ContractValue","ProjectValue","EstimatedValue","EstimatedRevenue","TotalValue","RevenueAmount","OpportunityValue","ForecastedProjectCost","LaborContractAmount","ContractLimit","Fee"];
const SECTOR_FIELDS = ["SectorChoice","Sector","SectorName","MarketSector","IndustryChoice","Industry","CRMSectorChoice","SectorTagsChoice"];

const SLIM_FIELDS: Record<string, string[]> = {
  PMM: ["TicketId","Title","ERPJobID","CRMProjectStatusChoice","Status","Closed","ModuleStepLookup","StageActionUsersUser","City",
        ...VALUE_FIELDS, ...SECTOR_FIELDS,
        "TargetStartDate","TargetCompletionDate","ActualStartDate","ActualCompletionDate","CloseDate",
        "ProjectLifeCycleLookup","ProjectLifeCycleLookup$Id","ProjectLifecycleID","ProjectLifeCycleID","LifecycleID","LifeCycleID",
        "NumAllocations","CRMBusinessUnitChoice","DivisionLookup","DivisionLookupName","BusinessUnit","BusinessUnitName","ShortName","GroupID",
        "CRMCompanyLookup","CRMCompanyLookupName","CompanyLookup","ClientName","Owner","OwnerName",
        "OwnerContractTypeChoice","ContractTypeChoice","ContractType",
        "RequestTypeCategory","RequestTypeSubCategory","RequestTypeLookup","RequestTypeLookupName",
        // Key Personnel — used for "My Open" filter
        "ProjectManagerUser","SeniorProjectManagerUser","ProgramManagerUser","SeniorMEPManagerUser",
        "SeniorEstimatorUser","SuperintendentUser","SeniorSuperintendentUser",
        "OwnerUser","ProjectLeadUser","BusinessLeadUser","EstimatorUser",
        "ProjectManagerUserName","SeniorProjectManagerUserName","ProjectManagerUserEmail","SeniorProjectManagerUserEmail"],
  OPM: ["TicketId","Title","ERPJobID","CRMOpportunityStatusChoice","CRMOpportunityStageChoice","Status","Closed","ModuleStepLookup","City",
        ...VALUE_FIELDS, ...SECTOR_FIELDS,
        "BidDueDate","SuccessChance","ChanceOfSuccessChoice",
        "TargetStartDate","TargetCompletionDate","ActualStartDate","ActualCompletionDate",
        "ProjectLifeCycleLookup","ProjectLifeCycleLookup$Id","ProjectLifecycleID","ProjectLifeCycleID","LifecycleID","LifeCycleID",
        "CRMBusinessUnitChoice","ShortName","CRMCompanyLookup",
        "OwnerUser","ProjectManagerUser","SeniorProjectManagerUser","BusinessLeadUser","EstimatorUser","SeniorEstimatorUser",
        "OwnerUserName","ProjectManagerUserName","OwnerUserEmail","ProjectManagerUserEmail"],
  LEM: ["TicketId","Title","LeadStatus","Status","Closed","City",
        ...VALUE_FIELDS, ...SECTOR_FIELDS,
        "TargetStartDate","TargetCompletionDate","CRMBusinessUnitChoice","ShortName",
        "CRMCompanyLookup","CRMCompanyLookupName",
        "OwnerUser","BusinessLeadUser","ProjectManagerUser","OwnerUserName","OwnerUserEmail"],
  COM: ["TicketId","Title","Status","City","Telephone","EmailAddress","WebsiteUrl",
        "CPRCounts","OPMCounts","LEMCounts","PrimaryRelationshipTypeChoice"],
  CON: ["TicketId","Title","FirstName","LastName","FullName","ContactName","DisplayName","ShortName",
        "EmailAddress","Email","Mobile","Telephone","PhoneNumber","Phone",
        "JobTitle","Title2","Position","CompanyName","AccountName","Company",
        "City","CRMContactType","DecisionMaker","CRMCompanyLookup"],
};

const VALID_MODULES = new Set(["OPM","LEM","PMM","COM","CON"]);

/**
 * GET /api/rmone/status-history
 * Tenant-scoped status/stage change ledger (RMOneStatusHistory) written by
 * every status write path — picker edits, schedule auto-advance, imports.
 * The Reports pages use it for TRUE per-period conversion counts instead of
 * the all-time fallback. `since` = the tenant's earliest recorded change, so
 * the client can tell whether history covers a chosen report period.
 */
router.get("/status-history", async (req: Request, res: Response) => {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    try {
      const modRaw = String(req.query["module"] ?? "").toUpperCase();
      const module = modRaw === "PMM" || modRaw === "OPM" || modRaw === "LEM" ? modRaw : undefined;
      const limRaw = Number(req.query["limit"]);
      const limit = Number.isFinite(limRaw) && limRaw >= 1 ? Math.floor(limRaw) : undefined;
      const { rows, since, truncated } = await fetchStatusHistory(rds.tid, { module, limit });
      res.json({ rows, since, truncated });
    } catch (e) {
      console.warn(`[status-history] fetch failed: ${String(e).slice(0, 200)}`);
      res.status(502).json({ error: "Error fetching status history" });
    }
  });

/**
 * GET /api/rmone/record-field-history?record=<ticketId>
 * Contract-value change trail (RMOneFieldHistory) for ONE record — who
 * changed ContractValue / ApproxContractValue / LaborContractAmount (plus
 * schema-drift landing column ProjectValue), when, old → new. Appended
 * best-effort by updateRecordFieldsRds; imports land as snapshot+diff rows
 * (source "import").
 * Access: the trail exposes financial values, so the SAME server-side rules
 * that govern financial WRITES apply (custom-level editFinancials caps +
 * tenant "restrict financial edits to admins" rule). Both gates fail closed
 * (503) when the policy can't be read — never leak values on a cold cache.
 */
router.get("/record-field-history", async (req: Request, res: Response) => {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const record = String(req.query["record"] ?? "").trim();
    if (!record) { res.status(400).json({ error: "record (ticket ID) required" }); return; }
    const finProbe = [{ FieldName: "ContractValue", Value: "" }];
    if (await blockIfFieldWriteDenied(req, res, finProbe)) return;
    if (await blockIfFinancialRestricted(req, res, finProbe)) return;
    try {
      const limRaw = Number(req.query["limit"]);
      const limit = Number.isFinite(limRaw) && limRaw >= 1 ? Math.floor(limRaw) : undefined;
      const { rows, truncated } = await fetchFieldHistory(rds.tid, record, { limit });
      res.json({ rows, truncated });
    } catch (e) {
      console.warn(`[field-history] fetch failed: ${String(e).slice(0, 200)}`);
      res.status(502).json({ error: "Error fetching value history" });
    }
  });

router.get("/records/:module", async (req: Request, res: Response) => {
    const module = String(req.params.module ?? "").toUpperCase();
    if (!VALID_MODULES.has(module)) {
      res.status(400).json({ error: `Invalid module. Valid: ${[...VALID_MODULES].join(", ")}` });
      return;
    }
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }

    // Shared SWR + single-flight read (same helper backs /projects).
    try {
      // ?fresh=1 → drop THIS worker's cached copy first (sent by the client
      // once right after a STATUS save). The save busts every worker via IPC,
      // but that broadcast is async — an instant refetch can land on a
      // sibling worker BEFORE its bust arrives and re-serve a pre-save
      // snapshot (which the browser then caches for minutes). Same pattern
      // as /resource-allocations.
      if (String(req.query["fresh"] ?? "") === "1") bustRdsRecordsLocal(rds.tid, module);
      res.json(await getRecordsCached(rds.tid, rds.tenant, module));
    } catch (e) {
      console.warn(`[records][rds] ${module} failed: ${String(e)}`);
      res.status(502).json({ Status: false, total: 0, data: [], error: "Error fetching records from core2" });
    }
  });

router.get("/resource-demands", async (req: Request, res: Response) => {
    try {
      const rds = resolveRequestSource(req);
      if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
      const cacheKey = rds.tid;
      const now = Date.now();
      const hit = resDemandsCache.get(cacheKey);

      // Fresh hit → instant
      if (hit && hit.expiresAt > now) {
        res.json(hit.data);
        // A demand-page view means "View project" clicks are likely next —
        // warm the top demand projects' caches now (throttled, all workers).
        kickDemandWarm(rds.tid, rds.tenant, hit.data);
        return;
      }

      // Stale within grace → instant + background refresh
      if (hit && hit.expiresAt + RES_DEMANDS_STALE_MS > now) {
        res.json(hit.data);
        if (!resDemandsInFlight.has(cacheKey)) {
          const bg: Promise<unknown> = (rdsGetResourceDemands(rds.tid, rds.tenant) as Promise<unknown>)
            .then((d) => { resDemandsCache.set(cacheKey, { data: d, expiresAt: Date.now() + RES_DEMANDS_TTL_MS }); capMap(resDemandsCache, CACHE_MAX_ORG); resDemandsInFlight.delete(cacheKey); return d; })
            .catch((e) => { resDemandsInFlight.delete(cacheKey); console.warn(`[resource-demands][rds] bg-refresh: ${String(e)}`); return null; });
          resDemandsInFlight.set(cacheKey, bg);
        }
        kickDemandWarm(rds.tid, rds.tenant, hit.data);
        return;
      }

      // Cold miss → single-flight
      try {
        let inflight = resDemandsInFlight.get(cacheKey);
        if (!inflight) {
          inflight = (rdsGetResourceDemands(rds.tid, rds.tenant) as Promise<unknown>)
            .then((d) => { resDemandsCache.set(cacheKey, { data: d, expiresAt: Date.now() + RES_DEMANDS_TTL_MS }); capMap(resDemandsCache, CACHE_MAX_ORG); resDemandsInFlight.delete(cacheKey); return d; })
            .catch((e) => { resDemandsInFlight.delete(cacheKey); throw e; });
          resDemandsInFlight.set(cacheKey, inflight);
        }
        const data = await inflight;
        // A shared background-refresh promise resolves null on failure (its
        // .catch swallows to avoid unhandled rejections). Never 200 that null
        // to the client — fall through to the stale/502 handling instead.
        if (data == null) throw new Error("resource-demands refresh failed (shared in-flight)");
        res.json(data);
        kickDemandWarm(rds.tid, rds.tenant, data);
      } catch (e) {
        console.warn(`[resource-demands][rds] failed: ${String(e)}`);
        // Stale-if-error: any cached snapshot (even expired) beats an error —
        // the client would otherwise render an empty demand board.
        const stale = resDemandsCache.get(cacheKey);
        if (stale) { res.json(stale.data); kickDemandWarm(rds.tid, rds.tenant, stale.data); return; }
        res.status(502).json({ error: "Error fetching demand from core2" });
      }
    } catch (e) {
      res.status(502).json({ error: "Upstream error", detail: String(e) });
    }
  });

router.post("/bench-resources", async (req: Request, res: Response) => {
    try {
      const rds = resolveRequestSource(req);
      if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
      const now = new Date();
      const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      const defaultEnd   = new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString().split("T")[0];
      const {
        startDate = defaultStart,
        endDate = defaultEnd,
        mode = "Weekly",
      } = req.body ?? {};
      res.json(await benchResourcesRds(rds.tid, { startDate, endDate, mode }));
    } catch (e) {
      res.status(502).json({ error: "Upstream error", detail: String(e) });
    }
  });

router.get("/allocations", async (req: Request, res: Response) => {
    try {
      const projectID = req.query["projectID"] as string;
      const rds = resolveRequestSource(req);
      if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
      const cacheKey = `${rds.tid}:${projectID}`;
      const now = Date.now();
      const hit = projectAllocsCache.get(cacheKey);

      if (hit && hit.expiresAt > now) { res.json(hit.data); return; }

      if (hit && hit.expiresAt + PROJECT_ALLOCS_STALE_GRACE_MS > now) {
        res.json(hit.data);
        if (!projectAllocsInFlight.has(cacheKey)) {
          const bg = (allocationsRds(rds.tid, projectID) as Promise<unknown>)
            .then((d) => { projectAllocsCache.set(cacheKey, { data: d, expiresAt: Date.now() + PROJECT_ALLOCS_TTL_MS }); capMap(projectAllocsCache, CACHE_MAX_PROJECTS); projectAllocsInFlight.delete(cacheKey); return d; })
            .catch((e) => { projectAllocsInFlight.delete(cacheKey); console.warn(`[allocations][rds] bg-refresh failed: ${String(e)}`); return null; });
          projectAllocsInFlight.set(cacheKey, bg);
        }
        return;
      }

      let inflight = projectAllocsInFlight.get(cacheKey);
      if (!inflight) {
        inflight = (allocationsRds(rds.tid, projectID) as Promise<unknown>)
          .then((d) => { projectAllocsCache.set(cacheKey, { data: d, expiresAt: Date.now() + PROJECT_ALLOCS_TTL_MS }); capMap(projectAllocsCache, CACHE_MAX_PROJECTS); projectAllocsInFlight.delete(cacheKey); return d; })
          .catch((e) => { projectAllocsInFlight.delete(cacheKey); throw e; });
        projectAllocsInFlight.set(cacheKey, inflight);
      }
      res.json(await inflight);
    } catch (e) {
      res.status(502).json({ error: "Upstream error", detail: String(e) });
    }
  });


// ── Bulk team copy for Opp→Project / Lead→Opp conversion ────────────────────
// Single endpoint that copies a full team onto a newly-created record in two
// SQL round-trips (batch RWI INSERT + batch RA INSERT) instead of one
// /assign-resource call per member. The destination record MUST be fresh —
// no duplicate check is performed. The caller (project-create.tsx) adds the
// team BEFORE copying the schedule, matching the existing ordering constraint.
router.post("/bulk-copy-team", async (req: Request, res: Response) => {
  try {
    if (await blockIfNoStaffCap(req, res)) return;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const { destProjectId, members, defaultStart, defaultEnd } = req.body as {
      destProjectId?: string;
      members?: Array<{
        resourceId: string; name: string;
        role?: string | null; title?: string | null; bu?: string | null;
        startDate?: string | null; endDate?: string | null;
        hours?: number; divisionId?: string | null;
      }>;
      defaultStart?: string;
      defaultEnd?: string;
    };
    if (!destProjectId || !Array.isArray(members) || members.length === 0) {
      res.status(400).json({ ok: false, error: "destProjectId and members[] are required" });
      return;
    }
    const result = await bulkCopyTeamRds(
      destProjectId, members, rds.tid, rds.username, defaultStart, defaultEnd,
    );
    setAuditTarget(res, { entityType: "allocation", entityId: destProjectId });
    handoffTrustedAuditChanges(res, "auditChanges" in result ? result : undefined);
    if (result.ok) {
      // Mirror the same cache busts as /assign-resource so every view
      // (team card, resources page, financial analytics) reflects the copy.
      bustProjectTeamCache(rds.tid, destProjectId);
      bustWeeklyAllocCache(rds.tid, destProjectId);
      bustResourceAllocCache(req.headers.authorization ?? "");
      bustResAllocsRouteCache(rds.tid);
      bustFinancialCache(rds.tid);
      broadcastBust({ type: "bustCache", fn: "finAnalytics", tid: rds.tid });
      warmProjectHoursCaches(rds.tid, rds.tenant, destProjectId);
    }
    res.json(result);
  } catch (e) {
    console.warn("[bulk-copy-team] failed:", String(e));
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/audit-interaction", (req: Request, res: Response) => {
  // The global observer is deliberately the sole writer, so each accepted (or
  // rejected) request has one audit event.
  if (!resolveRequestSource(req)) return res.status(401).json({ error: "Authentication required" });
  if (!parseAuditInteraction(req.body)) {
    return res.status(400).json({
      error: "interactionType and optional entityType/entityId must be valid semantic identifiers",
    });
  }
  return res.status(204).end();
});

router.post("/audit-email", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) return res.status(401).json({ error: "Authentication required" });

  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  const to = Array.isArray(body.to)
    ? body.to
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
    : [];
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const message = typeof body.body === "string" ? body.body.trim() : "";
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const uniqueTo = [...new Set(to)];

  if (uniqueTo.length === 0 || uniqueTo.length > 50 || uniqueTo.some((email) => !emailPattern.test(email))) {
    return res.status(400).json({ error: "Please provide between 1 and 50 valid recipients" });
  }
  if (!subject || subject.length > 240) {
    return res.status(400).json({ error: "Please provide a subject of 1 to 240 characters" });
  }
  if (!message || message.length > 100_000) {
    return res.status(400).json({ error: "Please provide a message of 1 to 100,000 characters" });
  }

  try {
    const result = await sendEmail({
      to: uniqueTo,
      subject,
      body: message,
      sentBy: rds.username,
      senderDisplayName: "RM ONE Audit Trail",
    });
    if (result.ok) {
      const requestedEntityType = String(body.entityType ?? body.EntityType ?? "").trim();
      const requestedEntityId = String(body.entityId ?? body.EntityId ?? body.ticketId ?? body.TicketId ?? "").trim();
      const requestedEntityName = String(body.entityName ?? body.EntityName ?? "").trim();
      const scope = message.match(/^Audit (?:history|change) for (.+)$/m)?.[1]?.trim()
        || subject.replace(/^Audit (?:history|change)\s*[—-]\s*/i, "").trim()
        || "Audit trail";
      const rowCount = (message.match(/^Who:/gm) ?? []).length;
      setAuditTarget(res, {
        action: "email.audit-trail",
        entityType: requestedEntityType || "record",
        entityId: requestedEntityId || undefined,
        entityName: requestedEntityName || "Audit email",
      });
      setTrustedAuditChanges(res, boundedAuditChanges([
        { FieldName: "Recipients", OldValue: null, NewValue: uniqueTo.join(", ") },
        { FieldName: "Audit row count", OldValue: null, NewValue: rowCount },
        { FieldName: "Audit scope", OldValue: null, NewValue: scope },
      ], 3));
    }
    return result.ok
      ? res.json(result)
      : res.status(502).json(result);
  } catch {
    return res.status(502).json({ error: "The audit email could not be sent" });
  }
});

// Entity Audit Trails must show every write that touched the record, not only
// events classified under the record's own type: schedule saves, weekly-hour
// edits and allocation flag/lock writes carry the record's ticket ID but their
// own entity types. Family expansion applies ONLY together with an entityId,
// so type-filtered tenant browsing stays exact.
const AUDIT_ENTITY_FAMILIES: Record<string, string[]> = {
  project: ["project", "schedule", "allocation", "record"],
  opportunity: ["opportunity", "schedule", "allocation", "record"],
  lead: ["lead", "schedule", "allocation", "record"],
  company: ["company", "record"],
  contact: ["contact", "record"],
  staff: ["staff", "resource", "record"],
};

router.get("/audit-trail", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) return res.status(401).json({ error: "Authentication required" });
  try {
    const root = isSuperAdminSource(rds);
    let live: LiveAcl;
    if (root) {
      live = { acl: rds.accessLevel, canEdit: true, identityGone: false };
    } else {
      const fresh = await lookupUserForLogin(rds.tenant, rds.username);
      if (!fresh || fresh.enabled === false) return res.status(403).json({ error: "Account is no longer active" });
      live = { acl: fresh.accessLevel, canEdit: canEditFromAcl(fresh.accessLevel), identityGone: false };
    }
    const caps = root ? null : (await resolveAccessCaps(live, rds.tenant)).caps;
    const admin = root || ["admin", "administrator"].includes(String(live.acl ?? "").toLowerCase());
    const canBrowseTenantAudit = admin || caps?.manageSettings === true;
    const includeFinancial = admin || caps?.editFinancials === true;
    const includeNetwork = canBrowseTenantAudit;
    const requestedEntityId = typeof req.query.entityId === "string" ? req.query.entityId.slice(0, 200) : undefined;
    const requestedActorId = typeof req.query.actorId === "string" ? req.query.actorId.slice(0, 200) : undefined;
    const requestedActorEmail = typeof req.query.actorEmail === "string" ? req.query.actorEmail.slice(0, 320) : undefined;
    // Subject mode: events performed BY this person OR affecting this person's
    // staff record. The staff popup uses it so a manager's edit to an employee
    // appears in that employee's history, not only in the manager's.
    const requestedSubjectId = typeof req.query.subjectId === "string" ? req.query.subjectId.slice(0, 200) : undefined;
    const requestedSubjectEmail = typeof req.query.subjectEmail === "string" ? req.query.subjectEmail.slice(0, 320) : undefined;
    if (!canBrowseTenantAudit) {
      const ownActor = requestedActorId && requestedActorId.toLowerCase() === rds.userId.toLowerCase();
      const ownEmail = requestedActorEmail && requestedActorEmail.toLowerCase() === rds.username.toLowerCase();
      // A non-admin may use subject mode only for THEMSELVES: their own audit
      // story legitimately includes changes other people made to their record.
      const ownSubject = requestedSubjectId && requestedSubjectId.toLowerCase() === rds.userId.toLowerCase();
      const ownSubjectEmail = requestedSubjectEmail && requestedSubjectEmail.toLowerCase() === rds.username.toLowerCase();
      if ((requestedActorId && !ownActor)
        || (requestedActorEmail && !ownEmail)
        || (requestedSubjectId && !ownSubject)
        || (requestedSubjectEmail && !ownSubjectEmail)) {
        return res.status(403).json({ error: "Audit access is limited to your own activity" });
      }
    }
    const outcome = typeof req.query.outcome === "string" ? req.query.outcome : undefined;
    const allowedOutcomes = new Set(["success", "failed", "denied", "partial", "cancelled"]);
    if (outcome && !allowedOutcomes.has(outcome)) {
      return res.status(400).json({ error: "Invalid audit outcome" });
    }
    const eventKind = typeof req.query.eventKind === "string"
      ? req.query.eventKind
      : typeof req.query.activity === "string"
        ? req.query.activity
        : typeof req.query.kind === "string"
          ? req.query.kind
          : typeof req.query.type === "string"
            ? req.query.type
            : undefined;
    if (eventKind && eventKind !== "interaction" && eventKind !== "change") {
      return res.status(400).json({ error: "Invalid audit event kind" });
    }
    const parseDate = (value: unknown, endOfDay = false): string | undefined => {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
      const date = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime())) return undefined;
      if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
      return date.toISOString();
    };
    const requestedEntityType = typeof req.query.entityType === "string" ? req.query.entityType.slice(0, 64) : undefined;
    const familyTypes = requestedEntityType && requestedEntityId
      ? AUDIT_ENTITY_FAMILIES[requestedEntityType.toLowerCase()]
      : undefined;
    const subjectMode = Boolean(requestedSubjectId || requestedSubjectEmail);
    const result = await fetchAuditTrail(rds.tid, {
      entityType: familyTypes ? undefined : requestedEntityType,
      entityTypes: familyTypes,
      entityId: requestedEntityId,
      subjectId: requestedSubjectId,
      subjectEmail: requestedSubjectEmail,
      actorId: canBrowseTenantAudit ? requestedActorId : (requestedActorId ? rds.userId : undefined),
      // Subject mode already restricts a non-admin to their own activity (the
      // subject was clamped to their own identity above) — forcing the actor
      // filter on top would hide edits OTHERS made to their record.
      actorEmail: canBrowseTenantAudit ? requestedActorEmail : (!requestedActorId && !subjectMode ? rds.username : undefined),
      outcome: outcome as AuditOutcome | undefined,
      action: typeof req.query.action === "string" ? req.query.action.slice(0, 160) : undefined,
      source: typeof req.query.source === "string" ? req.query.source.slice(0, 80) : undefined,
      search: typeof req.query.search === "string" ? req.query.search.slice(0, 120) : undefined,
      startAt: parseDate(req.query.start),
      endAt: parseDate(req.query.end, true),
      beforeId: typeof req.query.before === "string" ? Number(req.query.before) : undefined,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
      eventKind: eventKind as AuditTrailEventKind | undefined,
      includeFinancial,
      includeNetwork,
    });
    const { health: _health, ...page } = result;
    // networkDetailsIncluded is the honest signal for IP/user-agent visibility:
    // sensitiveDetailsIncluded also covers financial visibility, so a
    // financial-only editor would otherwise look like they can see IPs.
    return res.json({
      ...page,
      sensitiveDetailsIncluded: includeFinancial || includeNetwork,
      networkDetailsIncluded: includeNetwork,
    });
  } catch (error) {
    console.error(`[audit-trail] read failed for tenant ${rds.tid}:`, error);
    return res.status(500).json({ error: "Could not load the audit trail" });
  }
});

router.get("/audit-health", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) return res.status(401).json({ error: "Authentication required" });
  if (!isSuperAdminSource(rds)) {
    try {
      const fresh = await lookupUserForLogin(rds.tenant, rds.username);
      if (!fresh || fresh.enabled === false) return res.status(403).json({ error: "Account is no longer active" });
      const live: LiveAcl = { acl: fresh.accessLevel, canEdit: canEditFromAcl(fresh.accessLevel), identityGone: false };
      const caps = (await resolveAccessCaps(live, rds.tenant)).caps;
      if (!["admin", "administrator"].includes(String(live.acl ?? "").toLowerCase()) && caps?.manageSettings !== true) {
        return res.status(403).json({ error: "Administrator access required" });
      }
    } catch {
      return res.status(503).json({ error: "Cannot verify audit access right now" });
    }
  }
  return res.json({ ok: true, ...(await fetchAuditTrailHealth(rds.tid)) });
});

router.get("/bulk-team-assignments", async (req: Request, res: Response) => {
    try {
      const rds = resolveRequestSource(req);
      if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
      const rows = await getBulkTeamAssignmentsRds(rds.tid);
      res.json({ ok: true, total: rows.length, data: rows });
    } catch (e) {
      console.warn(`[bulk-team-assignments][rds] failed: ${String(e)}`);
      res.status(502).json({ ok: false, total: 0, data: [], error: "Error fetching team assignments from core2" });
    }
  });

router.get("/bulk-schedule", async (req: Request, res: Response) => {
    try {
      const rds = resolveRequestSource(req);
      if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
      const rows = await getBulkScheduleRds(rds.tid);
      res.json({ ok: true, total: rows.length, data: rows });
    } catch (e) {
      console.warn(`[bulk-schedule][rds] failed: ${String(e)}`);
      res.status(502).json({ ok: false, total: 0, data: [], error: "Error fetching schedule from core2" });
    }
  });

// ── Low-priority lane for list-page team-count fan-outs (?bulk=1) ─────────
// The Projects/Opportunities lists fire one /project-team request per visible
// row (hundreds after scrolling a big list). Uncapped, those cache-miss DB
// queries hog the shared SQL pool and starve interactive detail-page loads
// on EVERY tenant — the "stuck Loading team…" symptom. bulk=1 requests queue
// through this small semaphore before hitting the DB; cache hits, SWR-stale
// responses, and interactive (non-bulk) requests bypass it entirely.
const BULK_TEAM_MAX_CONCURRENT = 4;
let bulkTeamActive = 0;
const bulkTeamWaiters: Array<() => void> = [];
function acquireBulkTeamSlot(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (bulkTeamActive < BULK_TEAM_MAX_CONCURRENT) { bulkTeamActive++; resolve(); }
    else bulkTeamWaiters.push(() => { bulkTeamActive++; resolve(); });
  });
}
function releaseBulkTeamSlot(): void {
  bulkTeamActive = Math.max(0, bulkTeamActive - 1);
  const next = bulkTeamWaiters.shift();
  if (next) next();
}

router.get("/project-team", async (req: Request, res: Response) => {
    try {
      const projectID = req.query["projectID"] as string;
      if (!projectID) { res.status(400).json({ error: "projectID is required" }); return; }
      const rds = resolveRequestSource(req);
      if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
      try {
        const cacheKey = `${rds.tid}:${projectID}`;
        const now = Date.now();
        // ?fresh=1 → bypass this worker's cache entirely and query the DB.
        // Sent by the client immediately after an allocation save: the save
        // busts caches on all workers via IPC, but that broadcast is async —
        // an instant refetch can land on a sibling worker BEFORE its bust
        // arrives and be served a pre-save snapshot (which the browser then
        // caches for minutes). ForceFresh makes the post-save read race-proof.
        const forceFresh = String(req.query["fresh"] ?? "") === "1";
        // bulk=1 → list-page count fan-out (one request per visible row).
        // These are throttled through the low-priority semaphore below so
        // they can't hog the shared SQL pool.
        const isBulk = String(req.query["bulk"] ?? "") === "1";
        const cached = projectTeamCache.get(cacheKey);

        // ── Stale-while-revalidate ────────────────────────────────────────────
        // Fresh hit → return immediately.
        if (!forceFresh && cached && cached.expiresAt > now) {
          res.json(cached.data);
          return;
        }
        // Stale but within grace window → return stale data INSTANTLY and kick
        // off a background refresh so the next request gets fresh data.
        if (!forceFresh && cached && cached.expiresAt + PROJECT_TEAM_STALE_GRACE_MS > now) {
          res.json(cached.data); // instant response
          if (!projectTeamInFlight.has(cacheKey)) {
            const startGen = projectTeamGen.get(cacheKey) ?? 0;
            // defaultRate omitted → derived inside getProjectTeamRds from its
            // own parallel settings read (saves a sequential DB round-trip).
            const runBgRefresh = () => {
              console.log(`[project-team][rds] bg-refresh tid=${rds.tid} projectID=${projectID}${isBulk ? " (bulk)" : ""}`);
              return getProjectTeamRds(rds.tid, projectID, undefined, rds.tenant).then((data) => {
                const teamArr = (data as { team?: unknown[] })?.team;
                // Empty results cache too (short TTL inside setProjectTeamCacheIfCurrent).
                setProjectTeamCacheIfCurrent(cacheKey, startGen, data);
                console.log(`[project-team][rds] bg-refresh done tid=${rds.tid} projectID=${projectID} members=${teamArr?.length ?? 0}`);
                projectTeamInFlight.delete(cacheKey);
                return data;
              }).catch((e) => {
                projectTeamInFlight.delete(cacheKey);
                console.warn(`[project-team][rds] bg-refresh failed: ${String(e)}`);
                return cached.data; // keep stale on error
              });
            };
            if (isBulk) {
              // Bulk fan-out that lands in the stale-grace window (e.g. the
              // user scrolls the list 30min+ after first view) would kick off
              // one UNGATED background DB query per visible row — exactly the
              // pool-hogging fan-out the semaphore exists to prevent. The
              // response was already served from cache above, so the refresh
              // can safely queue behind a low-priority slot. Re-check
              // inflight/cache after the wait — another request may have
              // refreshed this key while we were queued.
              void acquireBulkTeamSlot().then(() => {
                const c2 = projectTeamCache.get(cacheKey);
                if (projectTeamInFlight.has(cacheKey) || (c2 && c2.expiresAt > Date.now())) {
                  releaseBulkTeamSlot();
                  return;
                }
                const p = runBgRefresh().finally(() => releaseBulkTeamSlot());
                projectTeamInFlight.set(cacheKey, p);
              });
            } else {
              projectTeamInFlight.set(cacheKey, runBgRefresh());
            }
          }
          return;
        }

        // Cache miss or too stale — coalesce concurrent requests into one DB hit.
        // forceFresh never reuses an existing in-flight read (it may be a
        // pre-save snapshot query) — it always starts its own DB query.
        let inflight = forceFresh ? undefined : projectTeamInFlight.get(cacheKey);
        // bulk=1 (list-page count fan-out) — throttle NEW DB queries through
        // the low-priority semaphore. Joining an existing in-flight query
        // needs no slot (it's already running / already counted).
        let holdingSlot = false;
        if (!inflight && isBulk && !forceFresh) {
          await acquireBulkTeamSlot();
          holdingSlot = true;
          // While queued, another request may have filled the cache or
          // started the same query — re-check both before spending a DB hit.
          const c2 = projectTeamCache.get(cacheKey);
          if (c2 && c2.expiresAt > Date.now()) {
            releaseBulkTeamSlot();
            res.json(c2.data);
            return;
          }
          inflight = projectTeamInFlight.get(cacheKey);
          if (inflight) { releaseBulkTeamSlot(); holdingSlot = false; }
        }
        if (!inflight) {
          const startGen = projectTeamGen.get(cacheKey) ?? 0;
          console.log(`[project-team][rds] fetch tid=${rds.tid} projectID=${projectID}${isBulk ? " (bulk)" : ""}`);
          // defaultRate omitted → derived inside getProjectTeamRds from its
          // own parallel settings read (saves a sequential DB round-trip on
          // the cold path the user is actively waiting on).
          inflight = getProjectTeamRds(rds.tid, projectID, undefined, rds.tenant).then((data) => {
            const teamArr = (data as { team?: unknown[] })?.team;
            // Empty results ARE cached, but only for PROJECT_TEAM_EMPTY_TTL_MS
            // (2 min, decided inside setProjectTeamCacheIfCurrent) — never the
            // full 30-min TTL, so a transient false-empty (cold DB pool) can't
            // lock the team invisible for long. Not caching empties at all made
            // every opportunity-detail open re-run the cold 7-join query.
            // setProjectTeamCacheIfCurrent also discards this write if a save
            // busted the key while this query was running (pre-save snapshot).
            setProjectTeamCacheIfCurrent(cacheKey, startGen, data);
            console.log(`[project-team][rds] done tid=${rds.tid} projectID=${projectID} members=${teamArr?.length ?? 0}${teamArr?.length === 0 ? " (cached short-ttl)" : ""}`);
            projectTeamInFlight.delete(cacheKey);
            if (holdingSlot) { releaseBulkTeamSlot(); holdingSlot = false; }
            return data;
          }).catch((e) => {
            projectTeamInFlight.delete(cacheKey);
            if (holdingSlot) { releaseBulkTeamSlot(); holdingSlot = false; }
            throw e;
          });
          projectTeamInFlight.set(cacheKey, inflight);
        }
        res.json(await inflight);
      }
      catch (e) { console.warn(`[project-team][rds] failed: ${String(e)}`); res.status(502).json({ error: "Error fetching project team from core2" }); }
    } catch (e) {
      console.log("[project-team] error:", String(e));
      res.status(502).json({ error: "Upstream error", detail: String(e) });
    }
  });

/**
 * Create / update a resource allocation — assigns a person to a project.
 * POST /api/rmone/assign-person
 * NOTE: SaveAllocation API has NOT been provided by the client yet.
 * This endpoint returns a clear error until the API is available.
 */
router.post("/assign-person", async (_req: Request, res: Response) => {
  res.status(501).json({
    ok: false,
    error: "Resource assignment API (SaveAllocation) is not yet available from the RM ONE platform. Please assign resources through the RM ONE web portal.",
  });
});

/**
 * Server-side smart update: fetches current dates, merges proposed change, sends full 6-field payload.
 * POST /api/rmone/smart-update
 * Body: { RecordId: string, Fields: [{FieldName, Value, IsExcluded}] }
 */
/**
 * GET /api/rmone/field-options/:field   (field = status | sector)
 * Returns { options: string[] } — the distinct values used for that field so
 * the project-detail UI can render an editable dropdown. RDS sessions read
 * core2; upstream sessions derive distinct values from the PMM/OPM record list.
 *
 * Server-side cache (5 min per tenant+field+module) so slow SQL Server round-trips
 * don't stall every page open. Pass ?bust=1 to force a fresh fetch.
 */
const _fieldOptCache = new Map<string, { opts: string[]; exp: number }>();
const FIELD_OPT_TTL = 5 * 60 * 1000;
const FIELD_OPT_STALE_GRACE_MS = 2 * 60 * 1000;
const fieldOptInFlight = new Map<string, Promise<string[]>>();

// Workflow-stage saves change the status option lists — clear this worker's
// snapshot for the tenant (siblings get the same via the stageRules IPC bust).
export function bustFieldOptionsCache(tid?: string): void {
  for (const k of [..._fieldOptCache.keys()]) if (!tid || k.split(":")[1] === tid) _fieldOptCache.delete(k);
  for (const k of [...fieldOptInFlight.keys()]) if (!tid || k.split(":")[1] === tid) fieldOptInFlight.delete(k);
}

router.get("/field-options/:field", async (req: Request, res: Response) => {
    const field = String(req.params.field || "").toLowerCase();
    // city/state/office: plain-text org/location columns — distinct record
    // values back the Stage Rules skip-condition dropdowns (free text stays
    // the fallback when a tenant's data has no values yet).
    const VALID_FIELDS = new Set(["status", "sector", "projecttype", "servicetype", "requestcategory", "city", "state", "office"]);
    if (!VALID_FIELDS.has(field)) { res.status(400).json({ options: [] }); return; }
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const moduleParam = String(req.query.module || "").toUpperCase();
    const module = moduleParam === "OPM" || moduleParam === "PMM" || moduleParam === "LEM" ? moduleParam : undefined;
    const bust = req.query.bust === "1";
    const cacheKey = `${field}:${rds.tid}:${module ?? ""}`;
    const now = Date.now();

    // Viewer-scoped stage sets: when a group-scoped workflow template (Stage
    // Rules → Save As…) — or, for OPM, a legacy oppStageSets entry — matches
    // THIS viewer, the module's status dropdown shows that set's stages
    // instead of the tenant-wide list. Resolved per request (the tenant-wide
    // cache below stays shared); no match → tenant list applies.
    // Per-stage "Applies to" audiences (stageAudiences) then drop scoped
    // stages from WHICHEVER list this viewer ends up seeing — the viewer-set
    // list here or the shared cached tenant list below. Applied per request
    // AFTER the cache so the cache never holds per-user output. Fail-visible:
    // rules/membership lookup failure → unfiltered dropdown.
    let audApply = (opts: string[]): string[] => opts;
    if (field === "status" && module) {
      try {
        const audMap: Record<string, StageAudience> | undefined =
          (await getStageRulesForTenant(rds.tenant)).stageAudiences?.[module];
        if (audMap && Object.keys(audMap).length > 0) {
          const membership = await viewerAudienceMembership(rds.tenant, rds.userId);
          if (membership) audApply = (opts) => filterStagesByAudience(opts, audMap, membership);
        }
      } catch { /* fail-visible — an unfiltered dropdown beats a broken one */ }
      const viewerStages = await resolveWorkflowStagesForViewer(rds.tenant, rds.userId, module);
      if (viewerStages && viewerStages.length > 0) {
        res.json({ options: audApply(viewerStages) });
        return;
      }
    }

    if (!bust) {
      const hit = _fieldOptCache.get(cacheKey);
      // Fresh hit
      if (hit && hit.exp > now) { res.json({ options: audApply(hit.opts) }); return; }
      // Stale within grace → return instantly, refresh async
      if (hit && hit.exp + FIELD_OPT_STALE_GRACE_MS > now) {
        res.json({ options: audApply(hit.opts) });
        if (!fieldOptInFlight.has(cacheKey)) {
          const bg: Promise<string[]> = getFieldOptionsRds(field, rds.tid, module, rds.tenant)
            .then((opts) => { _fieldOptCache.set(cacheKey, { opts, exp: Date.now() + FIELD_OPT_TTL }); fieldOptInFlight.delete(cacheKey); return opts; })
            .catch((e) => { fieldOptInFlight.delete(cacheKey); console.warn(`[field-options][rds] bg-refresh ${field}: ${String(e)}`); return [] as string[]; });
          fieldOptInFlight.set(cacheKey, bg);
        }
        return;
      }
    }

    // Cold miss (or bust=1) → single-flight dedup
    try {
      let inflight = fieldOptInFlight.get(cacheKey);
      if (!inflight) {
        inflight = getFieldOptionsRds(field, rds.tid, module, rds.tenant)
          .then((opts) => { _fieldOptCache.set(cacheKey, { opts, exp: Date.now() + FIELD_OPT_TTL }); fieldOptInFlight.delete(cacheKey); return opts; })
          .catch((e) => { fieldOptInFlight.delete(cacheKey); throw e; });
        fieldOptInFlight.set(cacheKey, inflight);
      }
      res.json({ options: audApply(await inflight) });
    } catch (e) {
      console.warn(`[field-options][rds] ${field}: ${String(e)}`);
      res.json({ options: [] });
    }
  });

/**
 * POST /api/rmone/update-fields
 * General per-field project update. Body: { RecordId, Fields:[{FieldName,Value}] }.
 * RDS sessions write to core2 (schema-drift safe); upstream sessions call the
 * RM ONE UpdateRecord API. Returns { ok, updated?, error? }.
 */
router.post("/update-fields", async (req: Request, res: Response) => {
    const { RecordId, Fields } = req.body as { RecordId: string; Fields: { FieldName: string; Value: string }[] };
    if (!RecordId || !Array.isArray(Fields) || Fields.length === 0) {
      res.status(400).json({ ok: false, error: "RecordId and Fields[] required" });
      return;
    }
    // Field-aware gate (not blockIfReadOnly): a custom "financials only" level
    // may edit financial fields here even though it can't edit anything else.
    if (await blockIfFieldWriteDenied(req, res, Fields)) return;
    if (/^\d+$/.test(RecordId)) {
      res.status(400).json({ ok: false, error: `RecordId "${RecordId}" is an internal numeric ID. Use the project code (e.g. PMM-24-001176).` });
      return;
    }

    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    // Skip-rule redirect: a status write aimed at a stage this record's own
    // values SKIP is rewritten to its real landing stage BEFORE the gates
    // below, so required-fields / locks / stage-permissions give their
    // friendly 403s for the stage actually being entered (the write choke
    // point repeats the rewrite for non-HTTP callers). Never throws.
    const skipRedirect = await applySkipRedirects(rds.tid, rds.tenant, RecordId, Fields);
    const effFields = skipRedirect.fields;
    if (await blockIfFinancialRestricted(req, res, effFields)) return;
    if (await blockIfStageLocked(req, res, RecordId, effFields)) return;
    if (await blockIfStagePermissionDenied(req, res, RecordId, effFields)) return;
    if (await blockIfWorkflowTypeDenied(req, res, RecordId, effFields)) return;
    try {
      const t0 = Date.now();
      const result = await updateRecordFieldsRds(RecordId, effFields, rds.tid, rds.tenant,
        { actor: { userId: rds.userId, acl: rds.accessLevel, username: rds.username } });
      console.log(`[update-fields][rds] ${rds.username}@${rds.tenant} ${RecordId} (${Date.now() - t0}ms) →`, JSON.stringify(result));
      recordUsage(rds, "tx", "project_save", { context: String(RecordId ?? "") }); // usage telemetry (#482)
      bustRecordCache(req.headers.authorization ?? "");
      bustRdsRecordsCache(rds.tid);
      bustProjectDetailCache(rds.tid, RecordId);
      bustDivRolesCache(rds.tid, RecordId);
      // Surface the landing stage when the ROUTE-level redirect rewrote a
      // status target — the provider only reports its own post-save advance,
      // so a redirected direct write would otherwise return no landedStage.
      if (skipRedirect.redirectedTo && !result.landedStage) result.landedStage = skipRedirect.redirectedTo;
      // Hand the authoritative before→after list to the audit observer via
      // res.locals (kept OUT of the client payload) so the audit trail shows
      // real diffs instead of body-inferred, value-only changes.
      handoffTrustedAuditChanges(res, result);
      res.json(result);
    } catch (e) {
      console.warn(`[update-fields][rds] failed: ${String(e)}`);
      res.status(502).json({ ok: false, error: String(e) });
    }
  });

// GET /staff/:guid/core → live org/access snapshot of one staff member,
// bypassing every cache. The Edit Staff modal re-seeds from this on open so
// a stale in-tab roster copy can never show empty/old dropdown values.
router.get("/staff/:guid/core", async (req: Request, res: Response) => {
  try {
    if (await blockIfNoStaffCap(req, res)) return;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const guid = String(req.params.guid ?? "").trim();
    if (!guid) { res.status(400).json({ error: "A staff member is required." }); return; }
    // Superadmins viewing another company pass ?tenantId= so we look up the
    // person in the correct company rather than the superadmin's home tenant.
    const tid = (isSuperAdminSource(rds) && typeof req.query.tenantId === "string" && req.query.tenantId)
      ? resolveTenantId(req.query.tenantId)
      : rds.tid;
    const row = await getStaffCoreRds(tid, guid);
    if (!row) { res.status(404).json({ error: "not found" }); return; }
    res.json(row);
  } catch (e) {
    console.warn(`[staff-core][rds] failed: ${String(e)}`);
    res.status(502).json({ error: "Error fetching staff details", detail: String(e) });
  }
});

// Update a staff member's Business Unit / Department / Role / Job Title in place.
// These fields are set at Add Staff and stored on AspNetUsers; this lets the
// Resources card edit them. RDS-only (core2); view-only users are blocked.
router.post("/staff/:guid/assignment", async (req: Request, res: Response) => {
    // Staff-cap gate only (NOT blockIfReadOnly): manage-staff works without
    // the edit-data capability by design.
    if (await blockIfNoStaffCap(req, res)) return;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const guid = String(req.params.guid ?? "").trim();
    if (!guid) { res.status(400).json({ ok: false, error: "A staff member is required." }); return; }
    const b = (req.body ?? {}) as {
      divisionId?: string; departmentId?: string; roleId?: string; jobTitleId?: string; roleName?: string; accessLevel?: string; tenantId?: string;
    };
    // Superadmins editing another company's staff pass tenantId in the body —
    // without it the tenant-scoped UPDATE matches ZERO rows in the superadmin's
    // home tenant and the save silently no-ops. Same guarded pattern as
    // GET /staff/:guid/core: non-superadmins can never redirect the write.
    const effTid = (isSuperAdminSource(rds) && typeof b.tenantId === "string" && b.tenantId)
      ? resolveTenantId(b.tenantId)
      : rds.tid;
    const effTenant = (isSuperAdminSource(rds) && typeof b.tenantId === "string" && b.tenantId)
      ? b.tenantId
      : rds.tenant;
    // Assigning a CUSTOM access level (#87): the level must actually exist for
    // this company — otherwise the marker would silently mean "view-only"
    // (deleted/unknown levels fail closed) and the admin wouldn't know why.
    if (b.accessLevel && isCustomAcl(b.accessLevel)) {
      try {
        const caps = await getCapsForAcl(b.accessLevel, effTenant);
        const name = await getCustomLevelName(b.accessLevel, effTenant);
        if (!caps || !name) {
          res.status(400).json({ ok: false, error: "That access level no longer exists. Refresh the page and pick another." });
          return;
        }
      } catch {
        res.status(503).json({ ok: false, error: "Cannot verify access levels right now. Please try again." });
        return;
      }
    }
    // Self-revert bookkeeping: capture the target's CURRENT level before an
    // access-level change so we can record who changed it and from what.
    let prevAcl: string | null | undefined;
    if (b.accessLevel !== undefined) {
      try {
        const rows = await getUsersByTenantAndIds(effTid, [guid.toLowerCase()]);
        prevAcl = rows[0] ? (rows[0].accessLevel ?? null) : undefined;
      } catch { /* non-fatal — skip the audit entry, never the save */ }
    }
    try {
      const result = await updateStaffAssignmentRds(effTid, guid, {
        divisionId: b.divisionId, departmentId: b.departmentId,
        roleId: b.roleId, jobTitleId: b.jobTitleId, roleName: b.roleName,
        accessLevel: b.accessLevel,
      });
      if (!result.updated) {
        res.status(404).json({ ok: false, error: "Staff member not found for this account." });
        return;
      }
      if (b.accessLevel !== undefined && prevAcl !== undefined
          && String(prevAcl ?? "").toLowerCase() !== String(b.accessLevel ?? "").toLowerCase()) {
        recordAclChange(effTenant, guid, prevAcl, String(b.accessLevel ?? ""), rds.userId).catch((e) =>
          console.warn(`[staff-assignment] acl change log failed: ${String(e).slice(0, 120)}`));
      }
      // Route-level bust (also clears the inner rds-provider cache and
      // broadcasts to all workers) — the Resources page Staff/Timeline tabs
      // read the tid-keyed resAllocsCache, which bustResourceAllocationsCache
      // alone never touched, so edits stayed invisible for up to 5 min.
      bustResAllocsRouteCache(effTid);
      // Org placement may have changed — live org audiences must see it now.
      bustStaffOrgEverywhere(effTid);
      // Title/role/access changes also flow into the /users list, the
      // /user-list picker and the Forecast /resource-master directory —
      // bust the whole users family (local + siblings via the "users"
      // signal) so every surface shows the edit immediately.
      usersCache.delete(effTid); usersInFlight.delete(effTid);
      bustUsersRdsCache(effTid);
      bustResourceMasterLocal(effTid);
      broadcastBust({ type: "bustCache", fn: "users", tid: effTid });
      utilCache.clear();
      console.log(`[staff-assignment][rds] ${rds.username}@${rds.tenant} ${guid} updated (tid=${effTid})`);
      handoffTrustedAuditChanges(res, result);
      res.json({ ok: true });
    } catch (e) {
      console.warn(`[staff-assignment][rds] failed: ${String(e)}`);
      res.status(502).json({ ok: false, error: String(e) });
    }
  });

router.post("/staff/:guid/extra", async (req: Request, res: Response) => {
    // Staff-cap gate only (NOT blockIfReadOnly) — see /staff/:guid/assignment.
    if (await blockIfNoStaffCap(req, res)) return;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const guid = String(req.params.guid ?? "").trim();
    if (!guid) { res.status(400).json({ ok: false, error: "guid required" }); return; }
    const b = (req.body ?? {}) as {
      employeeType?: string | null; phoneNumber?: string | null;
      name?: string; username?: string; tenantId?: string;
    };
    // Superadmin cross-company write — same guarded pattern as /staff/:guid/assignment.
    const effTid = (isSuperAdminSource(rds) && typeof b.tenantId === "string" && b.tenantId)
      ? resolveTenantId(b.tenantId)
      : rds.tid;
    const { tenantId: _dropTenantId, ...extraFields } = b;
    try {
      const result = await updateStaffExtraRds(effTid, guid, extraFields);
      if (result.updated === false) {
        res.status(404).json({ ok: false, error: "Staff member not found for this account." });
        return;
      }
      // Route-level bust — same reasoning as /staff/:guid/assignment above,
      // including the users family: employee-type/phone edits surface in the
      // staff pickers and the Forecast /resource-master directory too.
      bustResAllocsRouteCache(effTid);
      usersCache.delete(effTid); usersInFlight.delete(effTid);
      bustUsersRdsCache(effTid);
      bustResourceMasterLocal(effTid);
      broadcastBust({ type: "bustCache", fn: "users", tid: effTid });
      utilCache.clear();
      console.log(`[staff-extra][rds] ${rds.username}@${rds.tenant} ${guid} updated (tid=${effTid})`);
      handoffTrustedAuditChanges(res, result);
      res.json({ ok: true });
    } catch (e) {
      console.warn(`[staff-extra][rds] failed: ${String(e)}`);
      res.status(502).json({ ok: false, error: (e as Error)?.message || String(e) });
    }
  });

router.post("/smart-update", async (req: Request, res: Response) => {
    const { RecordId, Fields } = req.body as { RecordId: string; Fields: { FieldName: string; Value: string; IsExcluded: boolean }[] };

    if (!RecordId || !Array.isArray(Fields) || Fields.length === 0) {
      res.status(400).json({ error: "RecordId and Fields[] required" });
      return;
    }
    // Same field-aware partition as /update-fields: financials-only levels may
    // update money fields but not general data, and status remains its own cap.
    if (await blockIfFieldWriteDenied(req, res, Fields)) return;
    if (/^\d+$/.test(RecordId)) {
      res.status(400).json({ error: `RecordId "${RecordId}" is an internal numeric ID. Use the project code (e.g. PMM-24-001176) instead.` });
      return;
    }

    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    // Skip-rule enforcement: rewrite status targets BEFORE the friendly gates
    // (same wiring as /update-fields); sentBody reflects what was actually sent.
    const skipRedirect = await applySkipRedirects(rds.tid, rds.tenant, RecordId, Fields);
    const effFields = skipRedirect.fields;
    if (await blockIfFinancialRestricted(req, res, effFields)) return;
    if (await blockIfStageLocked(req, res, RecordId, effFields)) return;
    if (await blockIfStagePermissionDenied(req, res, RecordId, effFields)) return;
    if (await blockIfWorkflowTypeDenied(req, res, RecordId, effFields)) return;
    try {
      const result = await updateRecordFieldsRds(RecordId, effFields, rds.tid, rds.tenant,
        { actor: { userId: rds.userId, acl: rds.accessLevel, username: rds.username } });
      console.log(`[smart-update][rds] ${rds.username}@${rds.tenant} ${RecordId} →`, JSON.stringify(result));
      if (!result || result.ok === false) {
        res.status(502).json({ ok: false, error: result?.error || "update failed", sentBody: { RecordId, Fields: effFields }, rmoneResponse: result ?? {} });
        return;
      }
      bustProjectDetailCache(rds.tid, RecordId);
      bustDivRolesCache(rds.tid, RecordId);
      if (skipRedirect.redirectedTo && !result.landedStage) result.landedStage = skipRedirect.redirectedTo;
      // Same audit hand-off as /update-fields: real before→after for the
      // observer, stripped from the client payload (rmoneResponse included).
      handoffTrustedAuditChanges(res, result);
      res.json({ ok: true, sentBody: { RecordId, Fields: effFields }, rmoneResponse: result });
    } catch (e) {
      res.status(502).json({ ok: false, error: String(e) });
    }
  });

router.get("/test-update/:id", async (_req: Request, res: Response) => {
    res.status(410).json({ error: "removed" });
  });

router.get("/debug/:id", async (_req: Request, res: Response) => {
    res.status(410).json({ error: "removed" });
  });

/**
 * GET /api/rmone/allocation-utilization
 * Proxies to RM ONE GetResourceAllocationUtilization — weekly/monthly time-grid of
 * each resource's allocation % so the app can show over/under utilization over time.
 *
 * Query params (all optional, sensible defaults applied):
 *   startDate   YYYY-MM-DD  default: first day of current month
 *   endDate     YYYY-MM-DD  default: last day of month 3 months out
 *   mode        Weekly | Monthly  default: Weekly
 *   displayMode PERCENT | HOURS   default: PERCENT
 *   includeAll  true | false      default: false (only active resources)
 *   allocType   Estimated | Actual  default: Estimated
 */
const utilCache = new Map<string, { data: unknown; expiresAt: number }>();
const utilInFlight = new Map<string, Promise<unknown>>();
const UTIL_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours — warmer keeps cache fresh
const UTIL_CACHE_STALE_GRACE_MS = 2 * 60 * 60 * 1000; // serve stale up to 2h after TTL
// Empty grids get only a SHORT ttl: an empty result is either a genuinely
// empty tenant (cheap to recompute) or the residue of a partial upstream
// failure — caching it for 6h would freeze the Timeline at "all zeros".
const UTIL_CACHE_EMPTY_TTL = 2 * 60 * 1000;

function utilTtlFor(rows: unknown): number {
  return Array.isArray(rows) && rows.length > 0 ? UTIL_CACHE_TTL : UTIL_CACHE_EMPTY_TTL;
}

// The util grids each tenant most recently requested (quarter range + mode).
// Used to re-warm the cache right after an allocation write busts it, so the
// Timeline's post-save refetch gets fresh data instantly instead of paying a
// multi-second cold roster rebuild.
const lastUtilParams = new Map<string, Map<string, { startDate: string; endDate: string; mode: string; tenant?: string }>>();
// 6, not 4: the login/boot warm permanently seeds TWO default grids (Timeline
// current quarter + Forecast 52-week window, both Weekly) into this map, so
// the cap must leave room for four genuinely-viewed grids alongside them or
// the seeds evict one on every warm.
const LAST_UTIL_PARAMS_MAX = 6;

function noteUtilParams(tid: string, cacheKey: string, p: { startDate: string; endDate: string; mode: string; tenant?: string }): void {
  let m = lastUtilParams.get(tid);
  if (!m) { m = new Map(); lastUtilParams.set(tid, m); capMap(lastUtilParams, CACHE_MAX_ORG); }
  m.delete(cacheKey); // re-insert → moves to most-recent position
  m.set(cacheKey, p);
  while (m.size > LAST_UTIL_PARAMS_MAX) {
    const oldest = m.keys().next().value;
    if (oldest === undefined) break;
    m.delete(oldest);
  }
}

/** Rebuild the tenant's recently-viewed util grids in the background.
 *  Called from bustResAllocsLocal — which also runs on IPC receipt — so every
 *  worker re-warms its own utilCache after any allocation write. Results are
 *  discarded if ANOTHER write busts the tenant while the rebuild is in
 *  flight (resAllocsGen generation check, same pattern as resAllocsCache). */
function rewarmUtilForTid(tid: string, onlyStale = false): void {
  const m = lastUtilParams.get(tid);
  if (!m) return;
  const startGen = resAllocsGen.get(tid) ?? 0;
  for (const [cacheKey, p] of m) {
    if (utilInFlight.has(cacheKey)) continue;
    if (onlyStale) {
      // Login-time warming: skip grids whose cache entry is still fresh —
      // only rebuild what a Timeline open would actually have to wait for.
      const hit = utilCache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) continue;
    }
    const job = getAllocationUtilizationRds(tid, p.startDate, p.endDate, p.mode, p.tenant)
      .then((rows) => {
        utilInFlight.delete(cacheKey);
        if ((resAllocsGen.get(tid) ?? 0) === startGen) {
          utilCache.set(cacheKey, { data: rows, expiresAt: Date.now() + utilTtlFor(rows) });
          capMap(utilCache, CACHE_MAX_UTIL);
          console.log(`[alloc-util][rewarm] tid=${tid} key=${cacheKey} rows=${Array.isArray(rows) ? rows.length : "?"}`);
        } else {
          console.log(`[alloc-util][rewarm] tid=${tid} key=${cacheKey} discarded (gen changed mid-rebuild)`);
        }
        return rows;
      })
      .catch((err) => {
        utilInFlight.delete(cacheKey);
        console.warn(`[alloc-util][rewarm] tid=${tid}: ${String(err)}`);
        return null;
      });
    utilInFlight.set(cacheKey, job);
  }
}

export function getPersonGuidMap(): Map<string, string> {
  const guidMap = new Map<string, string>();
  for (const [, entry] of utilCache) {
    if (!entry.data || Date.now() > entry.expiresAt) continue;
    const rows = entry.data as Record<string, unknown>[];
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      const id = String(r.Id ?? "");
      const name = String(r.ResourceUser ?? "").trim();
      if (id && name && /^[0-9a-f]{8}-/i.test(id) && !guidMap.has(name)) {
        guidMap.set(name, id);
      }
    }
  }
  return guidMap;
}

let _warmingInProgress = false;


router.get("/allocation-utilization", async (req: Request, res: Response) => {
    try {
      const now = new Date();
      const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      const defaultEnd   = new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString().split("T")[0];

      const startDate = (req.query["startDate"] as string) || defaultStart;
      const endDate   = (req.query["endDate"]   as string) || defaultEnd;
      const mode      = (req.query["mode"]      as string) || "Weekly";

      const rds = resolveRequestSource(req);
      if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }

      const cacheKey = `util:${rds.tid}:${startDate}:${endDate}:${mode}`;
      // Remember what this tenant is viewing so post-write busts can re-warm
      // exactly these grids in the background.
      noteUtilParams(rds.tid, cacheKey, { startDate, endDate, mode, tenant: rds.tenant });
      if (String(req.query["fresh"] ?? "") === "1") {
        // ForceFresh (post-write refetch): never serve this worker's possibly
        // pre-IPC caches. The inner roster cache must go too —
        // getAllocationUtilizationRds derives the grid from
        // getResourceAllocations' _raCache, which can also be pre-write here.
        bustResourceAllocationsCache(rds.tid);
        utilCache.delete(cacheKey);
        utilInFlight.delete(cacheKey);
      }
      const nowMs = Date.now();
      const hit = utilCache.get(cacheKey);

      // Fresh hit
      if (hit && hit.expiresAt > nowMs) { res.status(200).json(hit.data); return; }

      // Stale within grace → instant response, background refresh
      if (hit && hit.expiresAt + UTIL_CACHE_STALE_GRACE_MS > nowMs) {
        res.status(200).json(hit.data);
        if (!utilInFlight.has(cacheKey)) {
          const startGen = resAllocsGen.get(rds.tid) ?? 0;
          const bg = getAllocationUtilizationRds(rds.tid, startDate, endDate, mode, rds.tenant)
            .then((rows) => {
              utilInFlight.delete(cacheKey);
              // Generation check: discard if an allocation write busted this
              // tenant while the refresh was in flight (pre-write data must
              // never repopulate the cache as "fresh").
              if ((resAllocsGen.get(rds.tid) ?? 0) === startGen) {
                utilCache.set(cacheKey, { data: rows, expiresAt: Date.now() + utilTtlFor(rows) });
                capMap(utilCache, CACHE_MAX_UTIL);
              }
              return rows;
            })
            .catch((err) => { utilInFlight.delete(cacheKey); console.warn(`[alloc-util][rds] bg-refresh: ${String(err)}`); return null; });
          utilInFlight.set(cacheKey, bg);
        }
        return;
      }

      // Cold miss → single-flight (already had this, now with SWR above)
      let inflight = utilInFlight.get(cacheKey);
      if (!inflight) {
        const startGen = resAllocsGen.get(rds.tid) ?? 0;
        inflight = getAllocationUtilizationRds(rds.tid, startDate, endDate, mode, rds.tenant)
          .then((rows) => {
            utilInFlight.delete(cacheKey);
            if ((resAllocsGen.get(rds.tid) ?? 0) === startGen) {
              utilCache.set(cacheKey, { data: rows, expiresAt: Date.now() + utilTtlFor(rows) });
              capMap(utilCache, CACHE_MAX_UTIL);
            }
            return rows;
          })
          .catch((err) => { utilInFlight.delete(cacheKey); throw err; });
        utilInFlight.set(cacheKey, inflight);
      }

      try {
        const rows = await inflight;
        // A piggybacked rewarm/bg-refresh promise resolves null on failure
        // instead of throwing — treat that as a failure here too.
        if (rows == null) throw new Error("utilization rebuild failed");
        res.status(200).json(rows);
      } catch (e) {
        console.warn(`[alloc-util][rds] ${String(e)}`);
        // NEVER answer a failure with 200 + [] — the client would cache
        // "no data" as real data and the Timeline shows all-zeros until the
        // user logs out and back in. Serve the last known grid if any exists
        // (even long-stale), otherwise a real error so the client shows its
        // retry UI instead of an empty grid.
        if (hit) { res.status(200).json(hit.data); return; }
        res.status(503).json({ error: "Utilization data temporarily unavailable", detail: String(e) });
      }
    } catch (e) {
      res.status(502).json({ error: "Upstream error", detail: String(e) });
    }
  });

router.get("/cache-status", (_req: Request, res: Response) => {
  // Report the ACTUAL utilCache contents (keys are tid-scoped:
  // util:{tid}:{startDate}:{endDate}:{mode}) rather than probing guessed
  // keys — the old probe used a pre-tenant key format and always said
  // "not cached".
  const now = Date.now();
  const entries: { key: string; fresh: boolean; expiresIn: string; rows?: number }[] = [];
  for (const [key, entry] of utilCache) {
    entries.push({
      key,
      fresh: entry.expiresAt > now,
      expiresIn: `${Math.round((entry.expiresAt - now) / 60000)}min`,
      rows: Array.isArray(entry.data) ? (entry.data as unknown[]).length : undefined,
    });
  }
  res.json({ warming: _warmingInProgress, inFlight: [...utilInFlight.keys()], entries });
});

/**
 * POST /api/rmone/resource-skills-availability
 * Proxies to RM ONE FindResourceBasedOnGroupNew — finds available resources
 * matching a skill group for a given project and date window.
 *
 * Body (all fields passed through to RM ONE):
 *   ProjectID, GroupID, AllocationStartDate, AllocationEndDate,
 *   ResourceAvailability, PctAllocation, JobTitles, etc.
 */
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

router.post("/resource-skills-availability", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  // core2 has no skill-group availability source equivalent to the upstream endpoint.
  // Return the contractually correct empty shape so callers degrade gracefully.
  res.json([]);
});

router.get("/company-projects", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  const companyName = String(req.query.name || "").toLowerCase().trim();
  const companyId = String(req.query.companyId || "").trim();
  if (!companyName && !companyId) { res.status(400).json({ error: "name or companyId is required" }); return; }

  try {
    const result = await companyProjectsRds(rds.tid, companyName, companyId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── People search (org-wide) ───────────────────────────────────────────
// Used by the email composer's recipient autocomplete. Returns a merged
// list of (1) every RM ONE internal user from GetUserList that has an
// email, (2) all CON external contacts (primary + secondary email), and
// (3) cross-references team members assigned to PMM/OPM/LEM records via
// their `*User` GUID role-owner fields so users actually staffed on
// projects bubble to the top of the dropdown with a "On N project(s)"
// hint. Empty/missing q returns the first `limit` entries so the picker
// still renders something useful. Substring match against name, email,
// title or company.
type PeopleEntry = {
  name: string;
  email: string;
  source: "user" | "contact";
  title?: string;
  company?: string;
  projectCount?: number;
  // GUID of the user record from RM ONE — needed by the per-user
  // projects-list endpoint so the mobile UI can open a "what projects
  // is this person on?" sheet from the badge.
  guid?: string;
};
type PersonProject = { id: string; title: string; module: "PMM" | "OPM" | "LEM" };
const peopleProjectsCache = new Map<string, { byGuid: Map<string, PersonProject[]>; expiresAt: number }>();
const peopleCache = new Map<string, { entries: PeopleEntry[]; expiresAt: number }>();
const PEOPLE_CACHE_TTL = 2 * 60 * 1000;


router.get("/people-search", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  const q = String(req.query.q || "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(1000, Number(req.query.limit ?? 25)));
  try {
    const result = await peopleSearchRds(rds.tid, q, limit);
    res.json(result);
  } catch (e) {
    console.warn("[people-search] error:", String(e));
    res.status(502).json({ error: "Error fetching people from core2", detail: String(e) });
  }
});

// "What projects is this person on?" — backs the tap-the-badge sheet in the
// mobile recipient picker. We resolve by either explicit GUID or email
// (looked up against the most-recent people-search cache so we don't have to
// re-fetch the entire user directory). Falls back to a fresh fetch if the
// cache is cold.
router.get("/people-projects", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  const guidParam = String(req.query.guid || "").trim().toLowerCase();
  const emailParam = String(req.query.email || "").trim().toLowerCase();
  if (!guidParam && !emailParam) { res.status(400).json({ error: "guid or email is required" }); return; }

  try {
    const result = await peopleProjectsRds(rds.tid, guidParam || emailParam);
    res.json(result);
  } catch (e) {
    console.warn("[people-projects] error:", String(e));
    res.status(502).json({ error: "Error fetching projects from core2", detail: String(e) });
  }
});

router.get("/company-contacts", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  const companyId = String(req.query.companyId || "").trim();
  const companyName = String(req.query.companyName || "").trim();
  // all=1 → tenant-wide contact list (New Company modal's Primary Contact picker).
  const allTenant = String(req.query.all || "") === "1";
  if (!allTenant && !companyId && !companyName) { res.status(400).json({ error: "companyId or companyName is required" }); return; }

  try {
    const result = await companyContactsRds(rds.tid, companyId, companyName, allTenant);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});


// ── Superadmin-only record deletion ──────────────────────────────────────────
// Removes a project/opportunity/lead plus its team assignments (RA + RWI) and
// schedule (PMMTasks) for ONE tenant. Gate: the verified JWT username must be
// on the ROOT superadmin allowlist. Root accounts act on the tenant they are
// logged into; a true rmone-tenant superadmin may additionally pass
// body.tenant to target another company (fleet cleanup).
router.post("/delete-record", async (req: Request, res: Response) => {
  try {
    // NO blockIfReadOnly here: that gate checks the caller's TENANT-USER row
    // (live ACL / account-enabled), but this route's authorization is the
    // hardcoded ROOT allowlist below — a root operator may hold a view-only
    // seat (or no seat at all) in the tenant being cleaned up and must still
    // be able to delete. Non-allowlisted callers 403 immediately regardless.
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const uname = (rds.username || "").trim().toLowerCase();
    const isRoot = (ROOT_SUPERADMIN_ACCOUNTS as readonly string[]).includes(uname);
    if (!isRoot && !isSuperAdminSource(rds)) {
      res.status(403).json({ error: "Only superadmin accounts can delete records" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ticketId = String(body.ticketId ?? body.TicketId ?? "").trim();
    const moduleRaw = String(body.module ?? body.Module ?? "").trim().toUpperCase();
    if (!ticketId || !["PMM", "OPM", "LEM"].includes(moduleRaw)) {
      res.status(400).json({ error: "ticketId and module (PMM|OPM|LEM) are required" });
      return;
    }
    // Cross-tenant targeting is reserved for the rmone superadmin login.
    let tid = rds.tid;
    let tenantLabel = rds.tenant;
    const wantTenant = String(body.tenant ?? "").trim();
    if (wantTenant && wantTenant.toLowerCase() !== rds.tenant.toLowerCase()) {
      if (!isSuperAdminSource(rds)) {
        res.status(403).json({ error: "Cross-tenant delete requires the rmone superadmin login" });
        return;
      }
      tid = resolveTenantId(wantTenant);
      tenantLabel = wantTenant;
    }
    const out = await deleteRecordRds(tid, moduleRaw as "PMM" | "OPM" | "LEM", ticketId);
    if (!out.found) {
      res.status(404).json({ error: `Record ${ticketId} not found in ${tenantLabel}` });
      return;
    }
    // Bust every surface the record fed: list grids, detail cache, allocation
    // feeds, and the legacy record cache (IPC-broadcast where applicable).
    bustRdsRecordsCache(tid);
    bustProjectDetailCache(tid, ticketId);
    bustResourceAllocationsCache(tid); // provider-level _raCache
    bustResAllocsRouteCache(tid); // route-level allocs + demands + util caches, IPC-broadcast to all workers
    // Financial analytics: deleting a record cascades to its allocations → stale.
    bustFinancialCache(tid);
    broadcastBust({ type: "bustCache", fn: "finAnalytics", tid });
    bustRecordCache(req.headers.authorization ?? "");
    bustModuleCache();
    setAuditTarget(res, {
      entityType: moduleRaw === "PMM" ? "project" : moduleRaw === "OPM" ? "opportunity" : "lead",
      entityId: ticketId,
      action: `delete.${moduleRaw === "PMM" ? "project" : moduleRaw === "OPM" ? "opportunity" : "lead"}`,
    });
    handoffTrustedAuditChanges(res, out);
    console.log(`[DeleteRecord] ${moduleRaw} ${ticketId} tenant=${tenantLabel} by ${uname} — alloc=${out.allocRows} rwi=${out.rwiRows} tasks=${out.taskRows}`);
    res.json({ Status: true, ticketId, module: moduleRaw, tenant: tenantLabel, cascaded: { allocations: out.allocRows, workItems: out.rwiRows, scheduleTasks: out.taskRows } });
  } catch (e: unknown) {
    console.error("[DeleteRecord] failed:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "delete failed" });
  }
});

// ── Companies: slim list + manual create + ID backfill ──────────────────────
// GET /companies-list → slim { id, ticketId, title }[] for CompanySearchSelect.
// id = numeric CRMCompany.ID (the CRMCompanyLookup FK value the create/update
// payloads send); ticketId = display COM-… id (null until minted/adopted).
router.get("/companies-list", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  try {
    res.json({ Status: true, data: await listCompaniesSlim(rds.tid) });
  } catch (e) {
    console.warn("[companies] list failed:", e);
    res.status(500).json({ Status: false, data: [], error: e instanceof Error ? e.message : "list failed" });
  }
});

// POST /companies → create ONE company (web New Company modal + the pickers'
// inline "+ Create new company"). Dup name/ID → 409 with the existing row so
// the UI can offer "use existing" instead of a dead end.
router.post("/companies", async (req: Request, res: Response) => {
  try {
    if (await blockIfReadOnly(req, res)) return;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const out = await createCompanyRds(rds.tid, (req.body ?? {}) as CreateCompanyBody, rds.username);
    if (!out.ok) {
      const status = out.code === "dup-title" || out.code === "dup-id" ? 409 : 400;
      res.status(status).json({ Status: false, error: out.error, code: out.code, existing: out.existing ?? null });
      return;
    }
    // COM grids + slim picker lists on EVERY worker (IPC broadcast).
    bustRdsRecordsCache(rds.tid, "COM");
    bustCompaniesSlimCache(rds.tid);
    // A stale open "needs attention" question about this company (same ID or
    // same name, raised by an earlier import) is now moot — close it so the
    // badge count drops without the admin touching the card. Best-effort.
    autoResolveAnsweredReviewItems(rds.tid, { resolvedBy: rds.username ?? "company-create" })
      .then(n => { if (n) console.log(`[companies] auto-resolved ${n} answered review item(s) after create (tenant=${rds.tenant})`); })
      .catch(e => console.warn("[companies] auto-resolve after create failed (non-fatal):", e instanceof Error ? e.message : e));
    console.log(`[companies] created "${out.title}" (${out.ticketId}) tenant=${rds.tenant} by ${rds.username}`);
    setAuditTarget(res, { entityType: "company", entityId: out.ticketId, entityName: out.title });
    handoffTrustedAuditChanges(res, out);
    res.json({ Status: true, company: { id: out.id, ticketId: out.ticketId, title: out.title }, contactWarning: out.contactWarning ?? null });
  } catch (e) {
    console.error("[companies] create failed:", e);
    res.status(500).json({ Status: false, error: e instanceof Error ? e.message : "create failed" });
  }
});

// POST /companies/ensure-ids → mint COM-YY-NNNNNN for legacy rows missing an
// ID. The Companies tab fires this on mount (editors only) — adoption-friendly
// backfill instead of a big-bang migration; imports call the same core after
// processing a companies sheet.
router.post("/companies/ensure-ids", async (req: Request, res: Response) => {
  try {
    if (await blockIfReadOnly(req, res)) return;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const out = await ensureCompanyIdsRds(rds.tid);
    setAuditTarget(res, { entityType: "company", entityId: "company-id-assignment", entityName: "Company ID assignment", action: "update.company" });
    handoffTrustedAuditChanges(res, out);
    if (out.minted > 0) {
      bustRdsRecordsCache(rds.tid, "COM");
      bustCompaniesSlimCache(rds.tid);
      console.log(`[companies] ensure-ids minted ${out.minted}/${out.total} tenant=${rds.tenant}`);
    }
    res.json({ Status: true, ...out });
  } catch (e) {
    console.error("[companies] ensure-ids failed:", e);
    res.status(500).json({ Status: false, error: e instanceof Error ? e.message : "ensure-ids failed" });
  }
});

// GET /deleted-records → superadmin-only list of recently soft-deleted records
// for a tenant. Gate: identical to POST /delete-record (root allowlist OR
// isSuperAdminSource, NOT blockIfReadOnly). Cross-tenant requires isSuperAdminSource.
// Query params: days (default 90, max 3650), module (optional PMM|OPM|LEM filter),
//               tenantId (optional, cross-tenant, rmone superadmin only).
router.get("/deleted-records", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const uname = (rds.username || "").trim().toLowerCase();
    const isRoot = (ROOT_SUPERADMIN_ACCOUNTS as readonly string[]).includes(uname);
    if (!isRoot && !isSuperAdminSource(rds)) {
      res.status(403).json({ error: "Only superadmin accounts can list deleted records" });
      return;
    }
    // Cross-tenant: only the rmone superadmin may query another company.
    let tid = rds.tid;
    const wantTenant = String(req.query.tenantId ?? "").trim();
    if (wantTenant && wantTenant !== rds.tid && wantTenant.toLowerCase() !== rds.tenant.toLowerCase()) {
      if (!isSuperAdminSource(rds)) {
        res.status(403).json({ error: "Cross-tenant query requires the rmone superadmin login" });
        return;
      }
      tid = resolveTenantId(wantTenant);
    }
    const days    = Math.max(1, Math.min(Number(req.query.days ?? 90) || 90, 3650));
    const modFilter = String(req.query.module ?? "").trim().toUpperCase();
    let rows = await listDeletedRecordsRds(tid, days);
    if (modFilter && ["PMM", "OPM", "LEM"].includes(modFilter)) {
      rows = rows.filter((r) => r.module === modFilter);
    }
    res.json({ Status: true, rows });
  } catch (e: unknown) {
    console.error("[DeletedRecords] list failed:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "query failed" });
  }
});

// POST /restore-record → superadmin-only. Reverses a soft-delete on a record
// plus its RA/RWI rows in one transaction. Gate: identical to POST /delete-record.
// Body: { rowId: number, module: "PMM"|"OPM"|"LEM", tenant?: string }
// Returns 409 if a live row with the same TicketId already exists.
// Note: PMMTasks (schedule) were HARD-deleted and cannot be restored.
router.post("/restore-record", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const uname = (rds.username || "").trim().toLowerCase();
    const isRoot = (ROOT_SUPERADMIN_ACCOUNTS as readonly string[]).includes(uname);
    if (!isRoot && !isSuperAdminSource(rds)) {
      res.status(403).json({ error: "Only superadmin accounts can restore records" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rowId    = Number(body.rowId ?? body.id ?? 0);
    const moduleRaw = String(body.module ?? "").trim().toUpperCase();
    if (!rowId || !["PMM", "OPM", "LEM"].includes(moduleRaw)) {
      res.status(400).json({ error: "rowId (integer) and module (PMM|OPM|LEM) are required" });
      return;
    }
    // Cross-tenant: only the rmone superadmin may target another company.
    let tid = rds.tid;
    let tenantLabel = rds.tenant;
    const wantTenant = String(body.tenant ?? "").trim();
    if (wantTenant && wantTenant.toLowerCase() !== rds.tenant.toLowerCase()) {
      if (!isSuperAdminSource(rds)) {
        res.status(403).json({ error: "Cross-tenant restore requires the rmone superadmin login" });
        return;
      }
      tid = resolveTenantId(wantTenant);
      tenantLabel = wantTenant;
    }
    const out = await restoreRecordRds(tid, moduleRaw as "PMM" | "OPM" | "LEM", rowId);
    if (!out.found && !out.conflict) {
      res.status(404).json({ error: `Deleted record #${rowId} not found for ${tenantLabel}` });
      return;
    }
    if (out.conflict) {
      res.status(409).json({
        Status: false,
        error: "conflict",
        error_description: `A live record with ticket ID "${out.ticketId}" already exists. Delete or archive the existing record before restoring this one.`,
        ticketId: out.ticketId,
      });
      return;
    }
    // Bust every surface the delete originally busted — same set as deleteRecord.
    bustRdsRecordsCache(tid);
    bustProjectDetailCache(tid, out.ticketId);
    bustResourceAllocationsCache(tid);
    bustResAllocsRouteCache(tid);
    // Financial analytics: restoring a record restores its allocation rows → stale.
    bustFinancialCache(tid);
    broadcastBust({ type: "bustCache", fn: "finAnalytics", tid });
    bustRecordCache(req.headers.authorization ?? "");
    bustModuleCache();
    console.log(`[RestoreRecord] ${moduleRaw} ${out.ticketId} (rowId=${rowId}) tenant=${tenantLabel} by ${uname} — alloc=${out.allocRows} rwi=${out.rwiRows}`);
    handoffTrustedAuditChanges(res, out);
    res.json({
      Status: true,
      rowId,
      ticketId: out.ticketId,
      title: out.title,
      module: moduleRaw,
      tenant: tenantLabel,
      restored: { allocations: out.allocRows, workItems: out.rwiRows, scheduleRestored: false },
    });
  } catch (e: unknown) {
    console.error("[RestoreRecord] failed:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "restore failed" });
  }
});

router.post("/new-record", async (req: Request, res: Response) => {
  try {
    if (await blockIfReadOnly(req, res)) return;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    // Accept either a flat fields array or the client's { ModuleName, Fields }
    // envelope. Normalize to a single { FieldName, Value }[] and make sure the
    // module survives (createRecordRds reads it from a Module/ModuleName field).
    const body = req.body as any;
    const moduleName = String(body?.ModuleName ?? body?.Module ?? "");
    const rawFields = Array.isArray(body)
      ? body
      : (Array.isArray(body?.Fields) ? body.Fields : []);
    const fields = (rawFields as { FieldName: string; Value: string }[])
      .filter((f) => f && f.FieldName);
    if (moduleName && !fields.some((f) => f.FieldName === "Module" || f.FieldName === "ModuleName")) {
      fields.push({ FieldName: "ModuleName", Value: moduleName });
    }
    const title = fields.find((f) => f.FieldName === "Title")?.Value ?? "";
    console.log("[NewRecord] → module:", moduleName, "title:", title);

    // Resolve this tenant's effective onboarding defaults so createRecordRds can
    // fill blank schedule dates with the admin-configured assumed window (the
    // same rules the import pipeline uses) instead of core2's 1900 sentinel. If
    // the settings read fails transiently, fall back to the built-in defaults so
    // the date fill STILL runs — a new record must never persist the 1900
    // sentinel just because Postgres hiccuped.
    let defaults: OnboardingDefaults;
    try {
      defaults = await loadEffectiveDefaults(rds.tenant);
    } catch (e) {
      defaults = BUILTIN_ONBOARDING_DEFAULTS;
      console.error("[NewRecord] settings read failed — using built-in defaults for date fill:", String(e));
    }
    // Per-audience "assumed project length" exceptions: when the CREATOR
    // belongs to a listed audience (user group or org:bu/div/dept unit), that
    // row's months override the base durationMonths for THIS create only.
    // Positive-match-only — unknown membership → base value. Never blocks the
    // create; any failure falls back to the base length. (Leads never get
    // assumed dates, so skip the lookup for LEM.)
    {
      const uid = String(rds.userId ?? "").trim().toLowerCase();
      const dur = await resolveAssumedDurationMonths(defaults, moduleName, uid, {
        getGroupIds: async () => {
          const gdoc = await getUserGroupsForTenant(rds.tenant);
          // Include the creator's own user sentinel — "Only specific people".
          return [...gdoc.groups.filter((g) => g.memberIds.includes(uid)).map((g) => g.id), userAudienceId(uid)];
        },
        getOrgAudienceIds: () => orgAudienceIdsForUserChecked(rds.tid, uid),
      });
      if (dur.note) console.warn(`[NewRecord] assumed-length: ${dur.note}`);
      if (dur.matched) {
        defaults = { ...defaults, durationMonths: dur.months };
        console.log(`[NewRecord] assumed-length exception applies for user=${uid}: ${dur.months} months`);
      }
    }
    const result = await createRecordRds(rds.tid, fields, rds.username, defaults);
    bustRecordCache(req.headers.authorization ?? ""); bustModuleCache(); bustRdsRecordsCache(rds.tid, moduleName || undefined);
    let autoLifecycleFailure: string | null = null;

    // Auto-apply the admin-configured default lifecycle phases to the new
    // record so it never lands with "No lifecycle assigned". Applies to BOTH
    // PMM and OPM. Failures are non-fatal — the record is already committed.
    if (result.Status !== false) {
      const newTicketId = String(result.Data?.TicketId ?? result.Data?.ID ?? "").trim();
      const entityType = moduleName.toUpperCase() === "OPM" ? "opportunity"
        : moduleName.toUpperCase() === "LEM" ? "lead" : "project";
      setAuditTarget(res, { entityType, entityId: newTicketId, entityName: String(title) });
      // Bust any cached negative detail for this ticket. A custom-prefixed ID
      // (e.g. a user-supplied lead ID) can be probed on a sibling worker
      // BEFORE that worker's custom-ticket cache learns about it — the probe
      // mis-routes, returns {Status:false}, and that negative result would
      // otherwise sit in projectDetailCache for the full TTL, so the user who
      // just created the record opens a "not found" detail page. The bust is
      // IPC-broadcast, so every worker drops the stale negative entry.
      if (newTicketId) bustProjectDetailCache(rds.tid, newTicketId);
      const mod = (moduleName.toUpperCase() === "OPM" ? "OPM" : "PMM");
      // ── Module-scoped phase source ──────────────────────────────────────
      // PROJECTS seed from the DEFAULT project schedule (defaultPhases).
      // OPPORTUNITIES seed from the default OPPORTUNITY stage configuration
      // (defaultOpportunityStages) — NEVER from project phases. Saved
      // schedules/stage sets are plain templates (audience scoping retired
      // Aug 2026) and never auto-apply.
      // Outcome stages (Lost / Declined / Closed…) are results, not
      // schedulable steps, so they're excluded (Awarded is a real working
      // phase and stays); when nothing schedulable
      // remains the auto-lifecycle is skipped (the record lands with
      // "No lifecycle assigned") rather than falling back to project phases.
      let phases: string[] = [];
      if (mod === "OPM") {
        try {
          const uid = String(rds.userId ?? "").trim().toLowerCase();
          const viewerStages = await resolveWorkflowStagesForViewer(rds.tenant, uid, "OPM");
          const source = viewerStages && viewerStages.length > 0
            ? viewerStages
            : String(defaults.defaultOpportunityStages ?? "").split(",").map((p) => p.trim()).filter(Boolean);
          // Per-stage "Applies to" audiences: a stage scoped away from the
          // CREATOR is omitted from the record's seeded lifecycle — same
          // creator-scoped convention as the viewer stage sets above. Inner
          // fail-open: a rules/membership hiccup degrades to UNFILTERED
          // seeding, never (via the outer catch) to no lifecycle at all.
          let scoped = source;
          try {
            const audMap = (await getStageRulesForTenant(rds.tenant)).stageAudiences?.OPM;
            if (audMap && Object.keys(audMap).length > 0) {
              scoped = filterStagesByAudience(source, audMap, await viewerAudienceMembership(rds.tenant, uid));
            }
          } catch { /* fail-visible */ }
          phases = scoped.filter((s) => !isOutcomeStageName(s));
          if (phases.length === 0) console.log(`[NewRecord] no schedulable opportunity path stages tid=${rds.tid} — skipping auto-lifecycle`);
        } catch (e) {
          phases = [];
          console.warn(`[NewRecord] opp stage resolution failed — skipping auto-lifecycle: ${String(e)}`);
        }
      } else {
        // PROJECT phases: the tenant's default schedule, always. Audience
        // scoping on saved schedules was RETIRED (Aug 2026, client request) —
        // saved schedules are plain templates now, and "Make default" on the
        // settings page is the only thing that changes what a new record
        // gets. Stored audience fields on legacy sets are ignored.
        const rawPhases = String(defaults.defaultPhases ?? "");
        phases = rawPhases.split(",").map((p) => p.trim()).filter(Boolean);
      }
      if (newTicketId && phases.length > 0) {
        try {
          const lcId = await findOrCreateLifecycleForPhasesRds(rds.tid, phases, mod);
          // findOrCreate may have INSERTED a new template — drop the cached list.
          bustLifecyclesCache(rds.tid);
          if (lcId) {
            const tasks = phases.map((title, i) => ({ Title: title, StageStep: i + 1, ItemOrder: i + 1, Status: "Not Started", PercentComplete: 0 }));
            const schedule = await createScheduleRds(rds.tid, newTicketId, String(lcId), tasks);
            if (schedule.ok) {
              handoffTrustedAuditChanges(res, schedule);
              console.log(`[NewRecord] auto-lifecycle applied tid=${rds.tid} ticket=${newTicketId} phases=${phases.length}`);
            } else {
              autoLifecycleFailure = "The record was created, but its default schedule could not be applied.";
              console.warn(`[NewRecord] auto-lifecycle returned unsuccessful tid=${rds.tid} ticket=${newTicketId}`);
            }
          }
        } catch (e) {
          autoLifecycleFailure = "The record was created, but its default schedule could not be applied.";
          console.warn(`[NewRecord] auto-lifecycle failed after record create: ${String(e)}`);
        }
      }
    }

    // If schedule dates were auto-filled, record them on the assumed-data audit
    // trail so the assumptions review stays accurate and a later settings change
    // re-derives them (reconcileAssumedScheduleDatesRds). Never fail the (already
    // committed) create if this bookkeeping write fails.
    const asm = result.assumedDates;
    if (asm && (asm.startDate || asm.endDate)) {
      try {
        await recordAssumedScheduleDates({
          tenantLabel: rds.tenant, entityType: asm.entityType, title: asm.title,
          startDate: asm.startDate, endDate: asm.endDate, actor: rds.username,
        });
      } catch (e) {
        console.error("[NewRecord] assumed-date record failed:", String(e));
      }
    }
    if (autoLifecycleFailure) {
      res.locals["auditOutcome"] = "partial";
      (result as typeof result & { Warning?: string }).Warning = autoLifecycleFailure;
    }
    handoffTrustedAuditChanges(res, result);
    delete (result as { assumedDates?: unknown }).assumedDates;
    recordUsage(rds, "tx", "record_created", { context: String((result as { Data?: { TicketId?: unknown; ID?: unknown } } | undefined)?.Data?.TicketId ?? (result as { Data?: { ID?: unknown } } | undefined)?.Data?.ID ?? "") }); // usage telemetry (#482)
    res.json(result);
  } catch (e) {
    console.log("[NewRecord] ← error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// POST /business-unit (singular) — legacy path used by some mobile/web callers;
// delegates to the same createBusinessUnitRds as /business-units (plural).
router.post("/business-unit", async (req: Request, res: Response) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    if (!name) { res.status(400).json({ error: "name required" }); return; }
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    if (await blockIfReadOnly(req, res)) return;
    try {
      const r = await createBusinessUnitRds(rds.tid, name);
      bustOrgCache(rds.tid);
      setAuditTarget(res, { entityType: "configuration", entityId: r.id, entityName: r.name });
      if (r.created) setTrustedAuditChanges(res, [{ FieldName: "Business unit name", OldValue: null, NewValue: r.name }]);
      res.json(r);
    }
    catch (e) { console.warn(`[business-unit][create][rds] failed: ${String(e)}`); res.status(502).json({ error: "Error creating business unit in core2" }); }
  } catch (e) {
    console.log("[business-unit][create] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

router.get("/lifecycles", async (req: Request, res: Response) => {
  try {
    // RDS tenants: return ONLY this tenant's own lifecycle templates from core2.
    // Served through the tid-keyed cache (10-min TTL + stale-grace + single-
    // flight) — this endpoint is hit on every project-detail open and the raw
    // core2 query costs ~0.9 s, so the cache is what makes the Schedule
    // section render instantly.
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    try {
      const list = await getLifecyclesCached(rds.tid);
      // Optional ?module=PMM|OPM scoping: the schedule pickers must only
      // offer templates for their own module (projects ≠ opportunities).
      // No param → full list (back-compat for older clients).
      const modQ = String(req.query.module ?? "").trim().toUpperCase();
      const scoped = modQ === "PMM" || modQ === "OPM"
        ? (list as { Module?: string }[]).filter((t) => (t?.Module ?? "PMM") === modQ)
        : list;
      res.status(200).json(scoped);
    }
    catch (e) { console.warn(`[lifecycles][rds] ${String(e)}`); res.status(200).json([]); }
  } catch (e) {
    console.log("[GetPMMLifeCycles] ← error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// Create a new lifecycle template (RDS tenants only — they own their config and
// have no reachable RM ONE upstream to manage it through).
router.post("/lifecycles", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) {
    res.status(501).json({ error: "Creating lifecycles is only supported for this account type." });
    return;
  }
  if (await blockIfNoSettingsCap(req, res)) return;
  try {
    const body = (req.body ?? {}) as { Name?: string; Stages?: unknown; Module?: string };
    const name = String(body.Name ?? "").trim();
    if (!name) { res.status(400).json({ error: "Lifecycle name is required" }); return; }
    const stages = Array.isArray(body.Stages)
      ? body.Stages.map((s) => (typeof s === "string" ? s : String((s as { Name?: unknown })?.Name ?? "")))
      : [];
    const module = body.Module === "OPM" ? "OPM" : "PMM";
    const created = await createLifecycleRds(rds.tid, name, stages, module);
    // Bust BEFORE responding — the Manage Lifecycles modal refetches the list
    // immediately after create, and a stale cache on this worker would make
    // the new lifecycle vanish from the picker.
    bustLifecyclesCache(rds.tid);
    handoffTrustedAuditChanges(res, created);
    res.status(200).json(created);
  } catch (e) {
    console.warn(`[lifecycles][create][rds] ${String(e)}`);
    res.status(400).json({ error: (e as Error).message || "Failed to create lifecycle" });
  }
});

// Rename a lifecycle and replace its phases (add / edit / remove). RDS only.
router.put("/lifecycles/:id", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) {
    res.status(501).json({ error: "Editing lifecycles is only supported for this account type." });
    return;
  }
  if (await blockIfNoSettingsCap(req, res)) return;
  try {
    const id = String(req.params.id ?? "").trim();
    const body = (req.body ?? {}) as { Name?: string; Stages?: unknown };
    const name = String(body.Name ?? "").trim();
    if (!name) { res.status(400).json({ error: "Lifecycle name is required" }); return; }
    const stages = Array.isArray(body.Stages)
      ? body.Stages.map((s) => (typeof s === "string" ? s : String((s as { Name?: unknown })?.Name ?? "")))
      : [];
    const updated = await updateLifecycleRds(rds.tid, id, name, stages);
    setAuditTarget(res, { entityType: "configuration", entityId: id, entityName: updated.Name });
    // Bust BEFORE responding (see POST /lifecycles above). bustTaskDataCache
    // is required here too: updateLifecycleRds now propagates phase renames
    // down to PMMTasks rows so schedule cards refresh immediately — the
    // per-project task-data cache must be dropped to surface the new titles.
    bustLifecyclesCache(rds.tid);
    bustTaskDataCache(rds.tid);
    handoffTrustedAuditChanges(res, updated);
    res.status(200).json(updated);
  } catch (e) {
    console.warn(`[lifecycles][update][rds] ${String(e)}`);
    res.status(400).json({ error: (e as Error).message || "Failed to update lifecycle" });
  }
});

// Delete a lifecycle template (soft-delete). RDS only. The caller must have
// confirmed twice client-side before this is invoked — the action is logged
// by the server (user identity from JWT + request IP) for audit purposes.
router.delete("/lifecycles/:id", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) {
    res.status(501).json({ error: "Deleting lifecycles is only supported for this account type." });
    return;
  }
  if (await blockIfNoSettingsCap(req, res)) return;
  try {
    const id = String(req.params.id ?? "").trim();
    const result = await deleteLifecycleRds(rds.tid, id);
    bustLifecyclesCache(rds.tid);
    const ip = req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "unknown";
    console.log(`[lifecycles][delete][rds] tid=${rds.tid} id=${id} by=${rds.username ?? "?"} ip=${ip}`);
    handoffTrustedAuditChanges(res, result);
    res.status(200).json(result);
  } catch (e) {
    console.warn(`[lifecycles][delete][rds] ${String(e)}`);
    res.status(400).json({ error: (e as Error).message || "Failed to delete lifecycle" });
  }
});

router.post("/schedule", async (req: Request, res: Response) => {
  try {
    if (await blockIfReadOnly(req, res)) return;

    // RDS tenants: persist the phase schedule directly to core2 and point the
    // project at the chosen lifecycle.
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const ticketID = String((req.body as any)?.TicketID ?? "");
    const lcId = String((req.body as any)?.ProjectLifecycleID ?? "");
    const tasks = Array.isArray((req.body as any)?.Tasks) ? (req.body as any).Tasks : [];
    if (!ticketID || !lcId) { res.status(400).json({ Status: false, error: "TicketID and ProjectLifecycleID are required" }); return; }
    // Moving existing team hours along with the schedule is OPT-IN: the
    // caller must send ShiftAllocations:true explicitly. Default (all current
    // UIs) leaves allocation dates untouched — repeated schedule edits used
    // to compound shifts and drag hours years into the past.
    const shiftAllocations = (req.body as { ShiftAllocations?: unknown })?.ShiftAllocations === true;
    const result = await createScheduleRds(rds.tid, ticketID, lcId, tasks, { shiftAllocations });
    if (!result.ok) { res.status(500).json({ Status: false, error: result.error ?? "Schedule creation failed" }); return; }
    console.log(`[schedule/rds] ${ticketID} → lifecycle ${lcId}, ${result.count} phases written${result.shiftedWeeks ? `, allocations shifted ${result.shiftedWeeks}w` : ""}`);
    bustModuleCache();
    bustTaskDataCache(rds.tid, ticketID);
    if (result.shiftedWeeks) {
      // Allocations moved with the schedule — bust + rewarm every cache that
      // serves allocation hours/dates (same set as /hours-allocation).
      bustResourceAllocCache(req.headers.authorization ?? "");
      bustResAllocsRouteCache(rds.tid);
      bustProjectTeamCache(rds.tid, ticketID);
      bustWeeklyAllocCache(rds.tid, ticketID);
      bustProjectAllocsCache(rds.tid, ticketID);
      // Financial analytics: schedule shifts move allocation dates → T12M window changes.
      bustFinancialCache(rds.tid);
      broadcastBust({ type: "bustCache", fn: "finAnalytics", tid: rds.tid });
      warmProjectHoursCaches(rds.tid, rds.tenant, ticketID);
    }
    // Write-through warm: repopulate taskDataCache immediately in the
    // background so the next /task-data read is a cache hit, not a miss.
    // Uses the taskDataInFlight single-flight guard so at most 1 DB query fires.
    if (!taskDataInFlight.has(`${rds.tid}:${ticketID}`)) {
      const wk = `${rds.tid}:${ticketID}`;
      const startGen = taskDataGen.get(wk) ?? 0;
      const wp: Promise<object[]> = getTaskDataRds(rds.tid, ticketID)
        .then((d) => { setTaskDataCacheShared(wk, d, { expectedGen: startGen }); taskDataInFlight.delete(wk); return d; })
        .catch(() => { taskDataInFlight.delete(wk); return [] as object[]; });
      taskDataInFlight.set(wk, wp);
    }
    handoffTrustedAuditChanges(res, result);
    res.json({ Status: true, count: result.count, shiftedWeeks: result.shiftedWeeks ?? 0 });
  } catch (e) {
    console.log("[UpdateTaskFromLifecycleSelection] ← error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

router.post("/project-allocations", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    try {
      const projId = String((req.body || {}).ProjectID ?? "");
      const cacheKey = `${rds.tid}:${projId}`;
      const now = Date.now();
      // ForceFresh:true → bypass this worker's cache and query the DB. Sent by
      // the client right after an allocation save: the save busts caches on
      // all workers via IPC, but that broadcast is async — an instant refetch
      // can land on a sibling worker BEFORE its bust arrives and be served a
      // pre-save snapshot (which the browser then caches for minutes).
      const forceFresh = (req.body || {}).ForceFresh === true;
      const hit = weeklyAllocCache.get(cacheKey);

      // ── Fresh hit → instant response ─────────────────────────────────────
      if (!forceFresh && hit && hit.expiresAt > now) { res.json(hit.data); return; }

      // ── Stale within grace window → return instantly, refresh in background
      if (!forceFresh && hit && hit.expiresAt + WEEKLY_ALLOC_STALE_GRACE_MS > now) {
        res.json(hit.data);
        if (!weeklyAllocInFlight.has(cacheKey)) {
          // Gen-guard: snapshot before the query starts; only write back if
          // no bust landed while the background refresh was in flight.
          const bgGen = weeklyAllocGen.get(cacheKey) ?? 0;
          const bg: Promise<object> = getWeeklyAllocationsRds(rds.tid, projId, rds.tenant)
            .then((data) => {
              if ((weeklyAllocGen.get(cacheKey) ?? 0) === bgGen) {
                weeklyAllocCache.set(cacheKey, { data, expiresAt: Date.now() + WEEKLY_ALLOC_TTL_MS });
                capMap(weeklyAllocCache, CACHE_MAX_PROJECTS);
              }
              weeklyAllocInFlight.delete(cacheKey);
              return data;
            })
            .catch((e) => { weeklyAllocInFlight.delete(cacheKey); console.warn(`[project-allocations][rds] bg-refresh failed: ${String(e)}`); return {} as object; });
          weeklyAllocInFlight.set(cacheKey, bg);
        }
        return;
      }

      // ── Cold miss → single-flight dedup ──────────────────────────────────
      // forceFresh never reuses an existing in-flight read (it may be a
      // pre-save snapshot query, e.g. a grace-window background refresh or the
      // post-write warm) — it always starts its own DB query.
      let inflight = forceFresh ? undefined : weeklyAllocInFlight.get(cacheKey);
      if (!inflight) {
        // Gen-guard: same protection as the background refresh path above.
        const coldGen = weeklyAllocGen.get(cacheKey) ?? 0;
        inflight = getWeeklyAllocationsRds(rds.tid, projId, rds.tenant)
          .then((data) => {
            if ((weeklyAllocGen.get(cacheKey) ?? 0) === coldGen) {
              weeklyAllocCache.set(cacheKey, { data, expiresAt: Date.now() + WEEKLY_ALLOC_TTL_MS });
              capMap(weeklyAllocCache, CACHE_MAX_PROJECTS);
            }
            weeklyAllocInFlight.delete(cacheKey);
            return data;
          })
          .catch((e) => { weeklyAllocInFlight.delete(cacheKey); throw e; });
        weeklyAllocInFlight.set(cacheKey, inflight);
      }
      res.json(await inflight);
    } catch (e) {
      console.warn(`[project-allocations][rds] failed: ${String(e)}`);
      res.json({ Status: true, NewAllocations: [], ExistingAllocations: [] });
    }
  } catch (e) {
    console.log("[GetAllRequiredDataForWeekly] ← error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

router.post("/work-item", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    if (await blockIfReadOnly(req, res)) return;
    const result = await createWorkItemRds(rds.tid, req.body, rds.username);
    const resultRecord = result as Record<string, unknown>;
    if (resultRecord.Status === true) {
      const projectId = String(req.body?.ProjectID ?? req.body?.WorkItem ?? req.body?.TicketId ?? "").trim();
      setAuditTarget(res, { entityType: "allocation", entityId: projectId });
      setTrustedAuditChanges(res, [{
        FieldName: "Resource work item ID",
        OldValue: null,
        NewValue: resultRecord.WorkItemId ?? resultRecord.ID ?? null,
      }]);
    }
    recordUsage(rds, "tx", "work_item_created"); // usage telemetry (#482)
    res.json(result);
  } catch (e) {
    console.log("[GetAllocationWorkItemIdTaskMode] ← error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

router.post("/weekly-resources", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  // No weekly resource-allocation grid source distinct from the RDS editor path (getWeeklyAllocationsRds).
  // Return the contractually correct empty shape so callers degrade gracefully.
  res.json({ Status: true, ExistingAllocations: [], NewAllocations: [] });
});

router.post("/hours-allocation", async (req: Request, res: Response) => {
  try {
    if (await blockIfNoStaffCap(req, res)) return;
    let payload = req.body;

    // Pin top-level fields to match the canonical Postman example exactly.
    // Missing/wrong values here can cause the SP to behave inconsistently
    // (e.g. leaving stale per-week records intact instead of overwriting).
    payload = {
      OverrideAllocations: false,
      IsAllocationSplitted: false,
      IsMiscellaneousAllocation: false,
      CalledFrom: "WeeklyTeamTab",
      TaskId: 0,
      ...payload,
    };

    // RDS tenants: persist the weekly hours directly into core2 (weekly
    // ResourceAllocation rows linked to the member's assignment).
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    try {
      const allocs = Array.isArray(payload.Allocations) ? payload.Allocations : [];

      // ── Telemetry: capture before hour total (best-effort, never blocks the save) ──
      // "Before" sums ALL active weekly RA rows for the affected people/project using
      // the exact clear predicate from saveWeeklyHoursRds, so it reflects what will
      // actually be removed regardless of the submitted week dates.
      // "After" is derived from the save's post-commit readback (memberUpdates), which
      // only contains rows that were actually persisted. Validated for completeness
      // before use — a partial or missing readback always produces null, never a guess.
      // Both values remain null whenever the scope cannot be fully established.

      // Hoist personIds so it's available for both pre-read and post-save validation.
      const telemetryPersonIds = [...new Set(
        (allocs as Record<string, unknown>[])
          .map((a: Record<string, unknown>) => String(a["AssignedTo"] ?? "").trim())
          .filter((s: string) => s && s !== "00000000-0000-0000-0000-000000000000"),
      )];
      // telemetryEnabled: cap at 50 person params (stays within SQL Server's 2100-param
      // limit). Beyond the cap, skip both values — full before scope is unknowable.
      const telemetryEnabled = telemetryPersonIds.length > 0 && telemetryPersonIds.length <= 50;

      let hoursBeforeTelemetry: number | null = null;
      if (telemetryEnabled) {
        try {
          const { sql: msql } = await import("../lib/db.js");
          const prePool = await getPool();
          const preReq = prePool.request()
            .input("tid", msql.VarChar, rds.tid)
            .input("pid", msql.VarChar, String(payload.ProjectID ?? ""));
          const pParams = telemetryPersonIds.map((id, i) => { preReq.input(`per${i}`, msql.VarChar, id); return `@per${i}`; }).join(",");
          // Mirror saveWeeklyHoursRds's clear predicate (no date filter — the save
          // removes ALL matching rows, not just the submitted weeks):
          //   - AllocationHour > 0  (normal weekly rows)
          //   - OR AllocationHour=0/NULL AND PctAllocation>0 AND short span (<30 days)
          //     (legacy import rows the clear also removes)
          // CASE WHEN AllocationHour > 0 THEN AllocationHour ELSE PctAllocation END
          //   matches the save's value logic (AllocationHour=0 falls through to PctAlloc).
          const preRes = await preReq.query(`
            SELECT ISNULL(SUM(
              CASE WHEN AllocationHour > 0 THEN AllocationHour ELSE PctAllocation END
            ), 0) AS total
            FROM core2.dbo.ResourceAllocation
            WHERE TenantID = @tid
              AND TicketId = @pid
              AND ResourceUser IN (${pParams})
              AND (Deleted = 0 OR Deleted IS NULL)
              AND (
                AllocationHour > 0
                OR (ISNULL(AllocationHour, 0) = 0 AND PctAllocation > 0
                    AND DATEDIFF(day, AllocationStartDate, ISNULL(AllocationEndDate, AllocationStartDate)) < 30)
              )
          `);
          hoursBeforeTelemetry = Math.round((Number(preRes.recordset?.[0]?.total) || 0) * 10) / 10;
        } catch (e) {
          console.warn("[hours-allocation] pre-read for telemetry failed (save unaffected):", String(e).slice(0, 120));
          hoursBeforeTelemetry = null; // null is always more honest than a fabricated number
        }
      }

      // ── Past-week policy enforcement ─────────────────────────────────────────
      // saveWeeklyHoursRds is a full-replacement save: it clears ALL existing
      // narrow weekly RA rows for each submitted person/project before inserting
      // the payload. A payload that simply omits a locked past week silently
      // deletes that row — identical risk to explicitly changing it.
      //
      // The guard works from the EXISTING rows outward:
      //   1. Fetch ALL existing narrow weekly RA rows for each submitted person,
      //      using the same person/project/RWI scope as the save path (covers
      //      legacy rows that carry only ResourceWorkItemLookup, not ResourceUser
      //      or TicketId, which TicketId-only probes would miss).
      //   2. Canonicalize each existing row's date window via canonicalMondayWeekWindow
      //      in JS, so legacy Wed→Tue rows share the same Monday key as the modern
      //      Mon→Sun rows that submitted payloads always contain.
      //   3. Check the UNION of existing and submitted canonical weeks: reject any
      //      locked week where existingHours ≠ submittedHours (0 on the absent side).
      //      This catches omissions (deletion of locked row), changes, and new
      //      additions (positive hours submitted for a locked week with no existing row).
      // FAIL CLOSED on policy-read failure: if tenant Settings cannot be
      // resolved we cannot know whether past weeks are locked. The STRICT
      // accessor propagates settings-store failures — the plain accessor
      // silently substitutes permissive built-in defaults, which would let a
      // configured lock be bypassed during any cold-cache Settings outage.
      // resolvePastWeekRulesOrThrow converts the failure into
      // PAST_WEEK_POLICY_UNAVAILABLE (mapped to a retryable HTTP 503 below),
      // so saveWeeklyHoursRds is never reached without a resolved policy.
      const tenantRules = await resolvePastWeekRulesOrThrow(
        () => getBusinessRulesForTenantStrict(rds.tenant),
      );
      const projectIdForPolicy = String(payload.ProjectID ?? "");
      const isOPM = projectIdForPolicy.toUpperCase().startsWith("OPM");
      const pastPolicy = resolvePastWeekPolicy(tenantRules, isOPM);

      // Fast path: unlimited past editing enabled → skip all DB probes.
      if (!(pastPolicy.allow && pastPolicy.limitWeeks === null)) {
        // Build a per-person map of SUBMITTED hours: canonical Monday YMD → hours.
        // Multiple payload rows targeting the same person+week are summed.
        //
        // IMPORTANT: register every valid AssignedTo FIRST, before attempting
        // date parsing. saveWeeklyHoursRds groups by person and clears ALL
        // their existing narrow rows even when a submitted row has no date
        // (e.g. a dateless zero-hour clear: { AssignedTo, AllocationHour: 0 }).
        // A person only added after a successful week derivation would be
        // silently omitted from the policy probe, letting the clear bypass the
        // lock. An empty submitted map for a person is correct: the union check
        // finds any existing locked rows and rejects the unpreserved hours.
        const submittedByPerson = new Map<string, Map<string, number>>();
        const policyPersonIds: string[] = [];

        for (const a of allocs as Record<string, unknown>[]) {
          const personId = String((a as Record<string, unknown>).AssignedTo ?? "").trim();
          if (!personId || personId === "00000000-0000-0000-0000-000000000000") continue;

          // Register the person unconditionally so they are always probed,
          // even if the row below turns out to have no derivable week.
          if (!submittedByPerson.has(personId)) {
            submittedByPerson.set(personId, new Map());
            policyPersonIds.push(personId);
          }

          try {
            const canon = canonicalizeWeeklyHoursRow(a);
            const validated = validateCanonicalWeeklyHoursRow(canon);
            const hours = Number(validated.AllocationHour);
            // For zero-hour rows AllocationStartDate may not be Monday-snapped;
            // use the raw date and normalize it to Monday explicitly.
            const rawStart = String(validated.AllocationStartDate ?? "").slice(0, 10)
              || String((a as Record<string, unknown>).AllocationStartDate ?? "").slice(0, 10);
            if (!rawStart) continue; // no date → no week entry (person still registered above)
            const win = canonicalMondayWeekWindow(rawStart, rawStart);
            const weekYmd = win?.startYmd ?? "";
            if (!weekYmd) continue;

            const prev = submittedByPerson.get(personId)!.get(weekYmd) ?? 0;
            submittedByPerson.get(personId)!.set(weekYmd, prev + hours);
          } catch {
            // Malformed row — saveWeeklyHoursRds will reject with INVALID_WEEKLY_*;
            // the person remains registered so they are still probed.
            continue;
          }
        }

        if (policyPersonIds.length > 0) {
          const { sql: policyMsql } = await import("../lib/db.js");
          const policyPool = await getPool();
          const nowUtcForPolicy = Date.now();

          for (const personId of policyPersonIds) {
            const existingReq = policyPool.request()
              .input("tid", policyMsql.VarChar, rds.tid)
              .input("pid", policyMsql.VarChar, projectIdForPolicy)
              .input("per", policyMsql.VarChar, personId);

            // Fetch raw start+end dates per row so canonicalMondayWeekWindow
            // can normalise them in JS. Grouping by AllocationStartDate in SQL
            // would lose the end-date context needed to snap legacy Wed→Tue rows
            // to the correct Monday. Use the same RWI-scoped person/project
            // predicate as saveWeeklyHoursRds so legacy RWI-only rows are covered.
            const existingRes = await existingReq.query(`
              SELECT
                CONVERT(char(10), AllocationStartDate, 120) AS startYmd,
                CONVERT(char(10), ISNULL(AllocationEndDate, AllocationStartDate), 120) AS endYmd,
                CASE WHEN ISNULL(AllocationHour, 0) > 0
                     THEN AllocationHour
                     ELSE ISNULL(PctAllocation, 0) END AS hours
              FROM core2.dbo.ResourceAllocation
              WHERE TenantID = @tid
                AND (Deleted = 0 OR Deleted IS NULL)
                AND DATEDIFF(day, AllocationStartDate,
                  ISNULL(AllocationEndDate, AllocationStartDate)) < 30
                AND (
                  ResourceWorkItemLookup IN (
                    SELECT ID FROM core2.dbo.ResourceWorkItems
                    WHERE TenantID = @tid AND ResourceUser = @per AND WorkItem = @pid
                  )
                  OR (ResourceUser = @per AND TicketId = @pid)
                )
            `);

            // Aggregate by canonical Monday in JS — the same identity used by
            // submitted rows. Rows with invalid date windows are silently dropped.
            const existingByWeek = new Map<string, number>();
            for (const row of (existingRes.recordset ?? []) as { startYmd: string; endYmd: string; hours: number }[]) {
              const s = String(row.startYmd ?? "").trim().slice(0, 10);
              const e = String(row.endYmd   ?? s).trim().slice(0, 10) || s;
              const w = canonicalMondayWeekWindow(s, e);
              if (!w) continue;
              existingByWeek.set(w.startYmd, (existingByWeek.get(w.startYmd) ?? 0) + (Number(row.hours) || 0));
            }
            const submittedWeeks = submittedByPerson.get(personId)!;

            // Union of all canonical weeks seen in either existing rows or the
            // submitted payload. A week absent from one side contributes 0h.
            // Locked weeks where the two sides differ are rejected.
            const allWeeks = new Set<string>([
              ...existingByWeek.keys(),
              ...submittedWeeks.keys(),
            ]);
            for (const weekYmd of allWeeks) {
              if (!isWeekLockedByPolicy(weekYmd, pastPolicy, nowUtcForPolicy)) continue;
              const existingHours  = existingByWeek.get(weekYmd)  ?? 0;
              const submittedHours = submittedWeeks.get(weekYmd) ?? 0;
              // Exact round-trip → allow. Any difference → reject.
              // Blocks: omissions (40h existing → 0h omitted), changes
              // (20h existing → 40h submitted), and new additions
              // (0h existing → 40h submitted to a locked past week).
              if (Math.round(existingHours * 100) !== Math.round(submittedHours * 100)) {
                throw buildLockedPastWeekError(weekYmd);
              }
            }
          }
        }
      }
      // ── End past-week policy enforcement ─────────────────────────────────────

      const result = await saveWeeklyHoursRds(payload.ProjectID, allocs, rds.tid, rds.username);
      handoffTrustedAuditChanges(res, result);
      console.log(`[hours-allocation][rds] ${rds.username}@${rds.tenant} project=${payload.ProjectID} →`, JSON.stringify(result));

      // ── Telemetry: derive after total from the save's post-commit readback ──
      // saveWeeklyHoursRds returns memberUpdates keyed by personId with the actual
      // persisted weekly-hour rows. We validate completeness: every person in the
      // "save scope" (payload persons minus those skipped as not-on-team) must have
      // an entry in memberUpdates. A missing entry means their readback query failed
      // inside saveWeeklyHoursRds — we cannot infer their hours, so both values stay
      // null rather than under-counting.
      let hoursAfterTelemetry: number | null = null;
      if (hoursBeforeTelemetry !== null) {
        try {
          type MemberUpdate = { weeklyHours: { hours: number }[] };
          const mu = (result as { memberUpdates?: Record<string, MemberUpdate>; skippedNotOnTeam?: string[] }).memberUpdates;
          const skippedSet = new Set((result as { skippedNotOnTeam?: string[] }).skippedNotOnTeam ?? []);
          // People who should appear in memberUpdates = payload people - skipped people.
          const savedScope = telemetryPersonIds.filter(id => !skippedSet.has(id));
          // Completeness check: every saved-scope person must have a readback entry.
          // mu absent = all readbacks failed; mu present but missing a person = partial failure.
          const muKeys = mu ? new Set(Object.keys(mu)) : new Set<string>();
          const isComplete = savedScope.every(id => muKeys.has(id));
          if (isComplete) {
            let afterSum = 0;
            if (mu) {
              for (const m of Object.values(mu)) {
                for (const w of m.weeklyHours) afterSum += w.hours;
              }
            }
            // savedScope non-empty + complete readback = trustworthy sum.
            // savedScope empty (all were skipped) = 0 is correct (nothing persisted).
            hoursAfterTelemetry = Math.round(afterSum * 10) / 10;
          } else {
            // Incomplete readback: null both values rather than log a false delta.
            hoursBeforeTelemetry = null;
          }
        } catch {
          hoursBeforeTelemetry = null; // unknown state, do not record
        }
      }

      // Build telemetry context: compact JSON {p, b?, a?}.
      // b/a are omitted when null. Legacy events stored a bare numeric project ID —
      // the alloc-edits endpoint handles both formats transparently.
      const projectIdStr = String(payload.ProjectID ?? "");
      const ctxPayload: Record<string, unknown> = { p: projectIdStr };
      if (hoursBeforeTelemetry !== null) ctxPayload["b"] = hoursBeforeTelemetry;
      if (hoursAfterTelemetry  !== null) ctxPayload["a"] = hoursAfterTelemetry;
      const usageContext = JSON.stringify(ctxPayload).slice(0, 200);

      // Bust all server-side caches that display allocation hours so the
      // Resources Timeline, Staff tab, and Project Team section immediately
      // reflect the new values without waiting for the TTL to expire.
      bustResourceAllocCache(req.headers.authorization ?? "");
      // bustResAllocsRouteCache (NOT just bustResourceAllocationsCache): the
      // Resources page's Timeline/Staff tabs are served from the tid-keyed
      // resAllocsCache route cache, which only this helper clears (it also
      // clears the inner rds-provider cache and broadcasts to all workers).
      bustResAllocsRouteCache(rds.tid);
      bustProjectTeamCache(rds.tid, String(payload.ProjectID ?? ""));
      bustWeeklyAllocCache(rds.tid, String(payload.ProjectID ?? ""));
      // Financial analytics cache: hours changed → stale until busted.
      // Broadcast to all workers so every worker's finCache entry is dropped.
      bustFinancialCache(rds.tid);
      broadcastBust({ type: "bustCache", fn: "finAnalytics", tid: rds.tid });
      // Write-through warm: rebuild the project-team AND weekly-allocations
      // caches in the background (all workers) so the next Hours View open —
      // and the next /project-allocations read — is instant instead of
      // blocking on a cold rebuild.
      warmProjectHoursCaches(rds.tid, rds.tenant, String(payload.ProjectID ?? ""));
      recordUsage(rds, "tx", "allocation_update", { context: usageContext }); // usage telemetry (#482)
      const skippedCount = (result as { skippedNotOnTeam?: string[] }).skippedNotOnTeam?.length ?? 0;
      if (skippedCount > 0) res.locals["auditOutcome"] = "partial";
      res.json(result);
    } catch (e) {
      if (String(e).includes("ALLOCATION_LOCKED")) {
        console.warn(`[hours-allocation][rds] blocked: allocation locked (project=${payload?.ProjectID})`);
        res.status(423).json({
          error: "allocation_locked",
          error_description: "This team member's allocation is locked. An admin can unlock it from the project team card.",
        });
        return;
      }
      if (String(e).includes("LOCKED_PAST_WEEK")) {
        console.warn(`[hours-allocation][rds] blocked: locked past week (project=${payload?.ProjectID})`);
        res.status(423).json({
          error: "locked_past_week",
          error_description: String(e).replace(/^Error:\s*/, ""),
        });
        return;
      }
      if (String(e).includes("PAST_WEEK_POLICY_UNAVAILABLE")) {
        // Fail-closed guard: tenant Settings could not be read, so the
        // past-week lock policy could not be evaluated. 503 (retryable) —
        // never a permissive fallback that would bypass a configured lock.
        console.warn(`[hours-allocation][rds] policy read failed — failing closed (project=${payload?.ProjectID})`);
        res.status(503).json({
          error: "policy_unavailable",
          error_description: String(e).replace(/^Error:\s*/, ""),
        });
        return;
      }
      if (
        String(e).includes("INVALID_WEEKLY_HOURS") ||
        String(e).includes("INVALID_WEEKLY_DATE")
      ) {
        res.status(400).json({
          error: "invalid_weekly_allocation",
          error_description: String(e).replace(/^Error:\s*/, ""),
        });
        return;
      }
      console.warn(`[hours-allocation][rds] failed: ${String(e)}`);
      res.status(502).json({ error: "Error saving weekly hours to core2", detail: String(e) });
    }
  } catch (e) {
    console.log("[UpdateBatchCRMAllocationsWeeklyUsingSP] ← error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// POST /allocation-lock — lock or unlock a member's allocation on one project.
// Locked = frozen against automatic changes: imports skip the pair, schedule
// moves leave the rows in place, weekly-hours saves reject. Manual removal
// stays allowed (deliberate in-app action). Gate: admins and managers pass;
// custom access levels need the "manage staff" capability — the SAME
// standalone staff gate as add/edit staff (deliberately NOT paired with
// blockIfReadOnly).
router.post("/allocation-lock", async (req: Request, res: Response) => {
  try {
    if (await blockIfNoStaffCap(req, res)) return;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const pid = String(req.body?.ProjectID ?? "").trim();
    const person = String(req.body?.ResourceGuid ?? "").trim();
    const lockedRaw = req.body?.IsLocked;
    const locked = lockedRaw === true || lockedRaw === "true" || lockedRaw === 1 || lockedRaw === "1";
    if (!pid || !person) {
      res.status(400).json({ error: "bad_request", error_description: "ProjectID and ResourceGuid are required" });
      return;
    }
    const result = await setAllocationLockRds(rds.tid, pid, person, locked, rds.username);
    console.log(`[allocation-lock] ${rds.username}@${rds.tenant} project=${pid} person=${person} → locked=${locked} (${result.updated} row(s))`);
    // Same bust set as the weekly-hours save: every surface that shows
    // allocation rows must drop its cached copy, then rewarm in background.
    bustResourceAllocCache(req.headers.authorization ?? "");
    bustResAllocsRouteCache(rds.tid);
    bustProjectTeamCache(rds.tid, pid);
    bustWeeklyAllocCache(rds.tid, pid);
    warmProjectHoursCaches(rds.tid, rds.tenant, pid);
    handoffTrustedAuditChanges(res, result);
    res.json({ ok: true, updated: result.updated, isLocked: locked });
  } catch (e) {
    console.warn(`[allocation-lock] failed: ${String(e)}`);
    res.status(502).json({ error: "Error updating allocation lock", detail: String(e) });
  }
});

// POST /allocation-flag — set or clear ONE allocation flag (soft /
// non-chargeable / locked) for a member on one project. Same manage-staff
// gate and bust set as /allocation-lock; "locked" through here is identical
// to that route (kept for older clients).
router.post("/allocation-flag", async (req: Request, res: Response) => {
  try {
    if (await blockIfNoStaffCap(req, res)) return;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const pid = String(req.body?.ProjectID ?? "").trim();
    const person = String(req.body?.ResourceGuid ?? "").trim();
    const flag = String(req.body?.Flag ?? "").trim().toLowerCase();
    const vRaw = req.body?.Value;
    const value = vRaw === true || vRaw === "true" || vRaw === 1 || vRaw === "1";
    // Optional $/hr cost rate — only meaningful for flag=nc; ignored otherwise.
    const costRateRaw = req.body?.CostRate;
    const costRate = costRateRaw != null && costRateRaw !== "" ? Number(costRateRaw) : undefined;
    if (!pid || !person || (flag !== "soft" && flag !== "nc" && flag !== "locked")) {
      res.status(400).json({ error: "bad_request", error_description: "ProjectID, ResourceGuid and Flag (soft|nc|locked) are required" });
      return;
    }
    // Toggling the flag is a staffing action (manage-staff gate above), but
    // writing a CostRate override is financial data — that part additionally
    // requires the financial capability, same as /role-rates (#87). Clearing
    // NC (value=false) always NULLs the rate as part of the flag's own
    // lifecycle, so only the set-with-rate path is gated.
    if (flag === "nc" && value && costRate !== undefined && Number.isFinite(costRate) && costRate >= 0) {
      if (await blockIfFinancialRestricted(req, res, [{ FieldName: "Rate" }])) return;
    }
    const result = await setAllocationFlagRds(rds.tid, pid, person, flag as "soft" | "nc" | "locked", value, rds.username, costRate);
    console.log(`[allocation-flag] ${rds.username}@${rds.tenant} project=${pid} person=${person} → ${flag}=${value} (${result.updated} row(s))`);
    // Same bust set as the weekly-hours save: every surface that shows
    // allocation rows must drop its cached copy, then rewarm in background.
    bustResourceAllocCache(req.headers.authorization ?? "");
    bustResAllocsRouteCache(rds.tid);
    bustProjectTeamCache(rds.tid, pid);
    bustWeeklyAllocCache(rds.tid, pid);
    // NC flag changes affect NC cost on the Financial page — bust that cache too.
    bustFinancialCache(rds.tid);
    broadcastBust({ type: "bustCache", fn: "finAnalytics", tid: rds.tid });
    warmProjectHoursCaches(rds.tid, rds.tenant, pid);
    handoffTrustedAuditChanges(res, result);
    res.json({ ok: true, updated: result.updated, flag, value });
  } catch (e) {
    console.warn(`[allocation-flag] failed: ${String(e)}`);
    res.status(502).json({ error: "Error updating allocation flag", detail: String(e) });
  }
});

router.get("/business-units", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const tid = (isSuperAdminSource(rds) && typeof req.query.tenantId === "string" && req.query.tenantId) ? resolveTenantId(req.query.tenantId) : rds.tid;
    const data = await businessUnitsRds(tid);
    console.log("[GetDivisionRoles][rds] ← count:", Array.isArray(data) ? data.length : "n/a");
    res.json(data);
  } catch (e) {
    console.log("[GetDivisionRoles] ← error:", String(e));
    res.status(502).json({ error: "Error fetching business units from core2", detail: String(e) });
  }
});

// GET /business-units-list → the tenant's standalone Business Units (separate
// from /business-units, which serves the mobile division+roles assignment view).
router.get("/business-units-list", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const tid = (isSuperAdminSource(rds) && typeof req.query.tenantId === "string" && req.query.tenantId) ? resolveTenantId(req.query.tenantId) : rds.tid;
    try {
      const now = Date.now();
      const hit = buListCache.get(tid);
      if (hit && hit.expiresAt > now) { res.json(hit.data); return; }
      if (hit && hit.expiresAt + ORG_CACHE_STALE_GRACE_MS > now) {
        res.json(hit.data);
        if (!buListInFlight.has(tid)) {
          const bg: Promise<object[]> = (getBusinessUnitsListRds(tid) as Promise<object[]>)
            .then((d) => { buListCache.set(tid, { data: d, expiresAt: Date.now() + ORG_CACHE_TTL_MS }); capMap(buListCache, CACHE_MAX_ORG); buListInFlight.delete(tid); return d; })
            .catch((e) => { buListInFlight.delete(tid); console.warn(`[business-units-list][rds] bg-refresh: ${String(e)}`); return [] as object[]; });
          buListInFlight.set(tid, bg);
        }
        return;
      }
      let inflight = buListInFlight.get(tid);
      if (!inflight) {
        inflight = (getBusinessUnitsListRds(tid) as Promise<object[]>)
          .then((d) => { buListCache.set(tid, { data: d, expiresAt: Date.now() + ORG_CACHE_TTL_MS }); capMap(buListCache, CACHE_MAX_ORG); buListInFlight.delete(tid); return d; })
          .catch((e) => { buListInFlight.delete(tid); throw e; });
        buListInFlight.set(tid, inflight);
      }
      res.json(await inflight);
    }
    catch (e) { console.warn(`[business-units-list][rds] failed: ${String(e)}`); res.status(502).json({ error: "Error fetching business units from core2" }); }
  } catch (e) {
    console.log("[GetBusinessUnitsList] ← error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

router.get("/divisions", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const tid = (isSuperAdminSource(rds) && typeof req.query.tenantId === "string" && req.query.tenantId) ? resolveTenantId(req.query.tenantId) : rds.tid;
    try {
      const now = Date.now();
      const hit = divCache.get(tid);
      if (hit && hit.expiresAt > now) { res.json(hit.data); return; }
      if (hit && hit.expiresAt + ORG_CACHE_STALE_GRACE_MS > now) {
        res.json(hit.data);
        if (!divInFlight.has(tid)) {
          const bg: Promise<object[]> = (getDivisionsRds(tid) as Promise<object[]>)
            .then((d) => { divCache.set(tid, { data: d, expiresAt: Date.now() + ORG_CACHE_TTL_MS }); capMap(divCache, CACHE_MAX_ORG); divInFlight.delete(tid); return d; })
            .catch((e) => { divInFlight.delete(tid); console.warn(`[divisions][rds] bg-refresh: ${String(e)}`); return [] as object[]; });
          divInFlight.set(tid, bg);
        }
        return;
      }
      let inflight = divInFlight.get(tid);
      if (!inflight) {
        inflight = (getDivisionsRds(tid) as Promise<object[]>)
          .then((d) => { divCache.set(tid, { data: d, expiresAt: Date.now() + ORG_CACHE_TTL_MS }); capMap(divCache, CACHE_MAX_ORG); divInFlight.delete(tid); return d; })
          .catch((e) => { divInFlight.delete(tid); throw e; });
        divInFlight.set(tid, inflight);
      }
      res.json(await inflight);
    }
    catch (e) { console.warn(`[divisions][rds] failed: ${String(e)}`); res.status(502).json({ error: "Error fetching divisions from core2" }); }
  } catch (e) {
    console.log("[GetDivisions] ← error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

router.get("/users", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }

    const cacheKey = rds.tid;
    const now = Date.now();
    const hit = usersCache.get(cacheKey);

    // Fresh hit → instant
    if (hit && hit.expiresAt > now) { res.json(hit.data); return; }

    // Stale within grace → return instantly, refresh in background
    if (hit && hit.expiresAt + USERS_CACHE_STALE_GRACE_MS > now) {
      res.json(hit.data);
      if (!usersInFlight.has(cacheKey)) {
        const bg = getUsersRds(rds.tid)
          .then((data) => { usersCache.set(cacheKey, { data, expiresAt: Date.now() + USERS_CACHE_TTL_MS }); usersInFlight.delete(cacheKey); return data; })
          .catch((e) => { usersInFlight.delete(cacheKey); console.warn(`[users][rds] bg-refresh: ${String(e)}`); return hit.data; });
        usersInFlight.set(cacheKey, bg);
      }
      return;
    }

    // Cold miss — single-flight
    let inflight = usersInFlight.get(cacheKey);
    if (!inflight) {
      inflight = getUsersRds(rds.tid)
        .then((data) => { usersCache.set(cacheKey, { data, expiresAt: Date.now() + USERS_CACHE_TTL_MS }); usersInFlight.delete(cacheKey); return data; })
        .catch((e) => { usersInFlight.delete(cacheKey); console.warn(`[users][rds] failed: ${String(e)}`); throw e; });
      usersInFlight.set(cacheKey, inflight);
    }
    res.json(await inflight);
  } catch (e) {
    console.log("[GetUsers] ← error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

router.get("/bench-resources", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const startDate = new Date().toISOString().slice(0, 10);
    const endDate = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const data = await benchResourcesRds(rds.tid, { startDate, endDate, mode: "Weekly" });
    console.log("[GetBenchResources][rds] ← count:", Array.isArray(data) ? data.length : "n/a");
    res.json(data);
  } catch (e) {
    console.log("[GetBenchResources] ← error:", String(e));
    res.status(502).json({ error: "Error fetching bench resources from core2", detail: String(e) });
  }
});

/**
 * GET /api/rmone/manager-staff
 *   ?list=1            → returns { managers: [{id, name, teamMemberCount}] }
 *   ?list=1&includeLeadershipTitles=1
 *                       → also includes title-based leaders for Manager picker counts
 *   ?managerId=<guid>  → returns project-specific manager/team flows
 */
router.get("/manager-staff", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }

    if (req.query.list === "1") {
      const managers = await getManagersListRds(rds.tid, {
        includeLeadershipTitles: req.query.includeLeadershipTitles === "1",
      });
      let managerCounts = new Map<string, number>();
      try {
        managerCounts = await getManagerTeamCountsRds(rds.tid, managers.map(manager => manager.id));
      } catch (e) {
        // Honesty rule: no count is better than a partial count. The picker
        // simply omits the suffix until a complete batch scan succeeds.
        console.warn("[manager-staff] batch count failed:", String(e).slice(0, 160));
      }
      const managersWithCounts = managers.map(manager => {
        const count = managerCounts.get(manager.id.trim().toLowerCase());
        return count === undefined ? manager : { ...manager, teamMemberCount: count };
      });
      res.json({ managers: managersWithCounts });
      return;
    }

    const managerId = String(req.query.managerId ?? "").trim();
    if (!managerId) {
      res.status(400).json({ error: "managerId or list=1 required" });
      return;
    }

    const data = await getManagerStaffRds(rds.tid, managerId);
    res.json(data);
  } catch (e) {
    console.warn("[manager-staff] error:", String(e).slice(0, 200));
    res.status(502).json({ error: "Failed to load manager staff", detail: String(e) });
  }
});

/**
 * GET /api/rmone/lead-team-context — Resources → Manager view (lead/team hierarchy)
 *   ?list=1                        → { leads: [{id,name,title,fields,recordCount}], partial }
 *   ?personId=<guid>               → { person, isLead, records:[{ticketId,title,module,leads,team}], teamError, truncated }
 *   ?personId=<guid>&hierarchy=1   → ALSO includes records where the person is a
 *       plain team member (selfIsLead:false) + `direct` (imported manager
 *       relationship) + membershipError honesty flag — Manager-tab hierarchy.
 */
router.get("/lead-team-context", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }

    if (req.query.list === "1") {
      res.json(await getLeadsDirectoryRds(rds.tid));
      return;
    }

    const personId = String(req.query.personId ?? "").trim();
    if (!personId) {
      res.status(400).json({ error: "personId or list=1 required" });
      return;
    }
    // GUID-only: person ids always come from the staff directory. Anything
    // else (esp. % / _) would just broaden the LIKE prefilter scan.
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(personId)) {
      res.status(400).json({ error: "personId must be a GUID" });
      return;
    }
    res.json(await getLeadTeamContextRds(rds.tid, personId, { hierarchy: req.query.hierarchy === "1" }));
  } catch (e) {
    console.warn("[lead-team-context] error:", String(e).slice(0, 200));
    res.status(502).json({ error: "Failed to load lead team context", detail: String(e) });
  }
});

// ── Backfill AwardedorLossDate on legacy won/lost opportunities ──────────────
// Historical opps moved to won/lost stages before the auto-stamp shipped have
// no AwardedorLossDate, causing period reports to show an inflated "undated
// decisions" note. This one-time backfill sets the date to StatusManualDate
// (or Created as a last resort) for every qualifying null row.
//
// GET  ?dryRun=1  (default) — preview: returns { eligible, samples[] }
// POST ?dryRun=0  — commit:  returns { eligible, updated }
//
// Superadmin-only. Cross-tenant via ?tenantId=<label> (superadmin only).
// Fleet-wide via ?allTenants=1 (superadmin only) — fans out across every tenant
// in one call and returns per-tenant counts plus a fleet-level summary.
router.all("/admin/backfill-decision-dates", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    if (!isSuperAdminSource(rds)) {
      res.status(403).json({ error: "Only superadmin accounts can run the decision-date backfill" });
      return;
    }

    // dryRun defaults to true for safety; pass ?dryRun=0 or body.dryRun=false to commit.
    const dryRunQuery = String(req.query.dryRun ?? "");
    const dryRunBody  = (req.body as Record<string, unknown> | undefined)?.dryRun;
    const dryRun = dryRunQuery === "0" || dryRunBody === false || dryRunBody === "false"
      ? false
      : true;

    // Fleet-wide fan-out: ?allTenants=1 (superadmin only).
    const allTenants = String(req.query.allTenants || "") === "1";
    if (allTenants) {
      const result = await backfillDecisionDatesAllTenantsRds({ dryRun });
      res.json(result);
      return;
    }

    // Single-tenant path (active tenant or ?tenantId=<label> cross-tenant).
    const queryTenantId = typeof req.query.tenantId === "string" ? req.query.tenantId.trim() : "";
    const tid = queryTenantId ? resolveTenantId(queryTenantId) : rds.tid;

    const result = await backfillDecisionDatesRds(tid, { dryRun });
    res.json(result);
  } catch (e) {
    console.log("[backfill-decision-dates] ← error:", String(e));
    res.status(502).json({ error: "Backfill failed", detail: String(e) });
  }
});

// One-time data-quality fix for pre-existing lump-sum "total hours over the
// whole assignment span" rows imported before the auto-weekly-split fix (see
// migrateLumpSumAllocationsRds). Converts them to real per-week rows so the
// header % always matches the "Hours by Phase" weekly table exactly.
router.post("/admin/migrate-lump-sum-allocations", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    // Superadmins (or an explicit ?allTenants=1) fix every tenant's historical
    // lump-sum rows in one pass; a regular company admin only fixes their own.
    const allTenants = String(req.query.allTenants || "") === "1" && isSuperAdminSource(rds);
    const result = allTenants
      ? await migrateLumpSumAllocationsAllTenantsRds(rds.username || "admin")
      : await migrateLumpSumAllocationsRds(rds.tid, rds.tenant, rds.username || "admin");
    setAuditTarget(res, {
      entityType: "configuration",
      entityId: "admin:migrate-lump-sum",
      entityName: "Migrate lump-sum allocations",
    });
    const changes = [
      ...("tenants" in result ? [{ FieldName: "Tenants examined", OldValue: null, NewValue: result.tenants }] : []),
      { FieldName: "Allocation rows migrated", OldValue: null, NewValue: result.migrated },
      { FieldName: "Weekly rows written", OldValue: null, NewValue: result.weeksWritten },
    ];
    setTrustedAuditChanges(res, boundedAuditChanges(changes, changes.length));
    res.json(result);
  } catch (e) {
    console.log("[migrate-lump-sum-allocations] ← error:", String(e));
    res.status(502).json({ error: "Migration failed", detail: String(e) });
  }
});

// Rescales existing default (non-overridden) weekly allocations to the
// tenant's current "Hours in a full week" setting. See reapplyDefaultHoursRds
// for the uniform-vs-varying heuristic used to avoid touching manual edits.
router.post("/admin/reapply-default-hours", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const body = req.body as Record<string, unknown> | undefined;
    const prevRaw = Number(body?.prevFullWeekHours);
    const prev = Number.isFinite(prevRaw) && prevRaw > 0 ? prevRaw : undefined;
    // Superadmins may target another client's tenant (settings page, scope =
    // client); everyone else is locked to their own tenant regardless of body.
    const bodyTenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : "";
    const crossTenant = Boolean(isSuperAdminSource(rds) && bodyTenantId);
    const tid = crossTenant ? resolveTenantId(bodyTenantId) : rds.tid;
    const tenantLabel = crossTenant ? bodyTenantId : rds.tenant;
    const result = await reapplyDefaultHoursRds(tid, tenantLabel, rds.username || "admin", prev);
    setAuditTarget(res, {
      entityType: "configuration",
      entityId: "admin:reapply-default-hours",
      entityName: "Reapply default hours",
    });
    const changes = [
      { FieldName: "Allocation groups changed", OldValue: null, NewValue: result.groupsRescaled },
      { FieldName: "Allocation rows changed", OldValue: null, NewValue: result.rowsUpdated },
      { FieldName: "Full week hours", OldValue: null, NewValue: result.fullWeekHours },
    ];
    setTrustedAuditChanges(res, boundedAuditChanges(changes, changes.length));
    res.json(result);
  } catch (e) {
    console.log("[reapply-default-hours] ← error:", String(e));
    res.status(502).json({ error: "Reapply failed", detail: String(e) });
  }
});

router.get("/resource-demand", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const data = await resourceDemandSingularRds(rds.tid, rds.tenant);
    console.log("[GetResourceDemandItems][rds] ← count:", Array.isArray(data) ? data.length : "n/a");
    res.json(data);
  } catch (e) {
    console.log("[GetResourceDemandItems] ← error:", String(e));
    res.status(502).json({ error: "Error fetching resource demand from core2", detail: String(e) });
  }
});

// File attachments — core2 has no blob/path storage table exposed via the
// schema we have access to. Accepting the upload and silently discarding it
// would cause data loss, so we fail explicitly.
// Product exception: 501 until a core2 attachment table or S3 target is
// confirmed; callers must surface this error to the user rather than retrying.
router.put("/attachments", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    res.status(501).json({ error: "File attachments aren't available for this account yet." });
  } catch (e) {
    console.log("[UploadAttachment] ← error:", String(e));
    res.status(502).json({ error: "Error saving attachment to core2", detail: String(e) });
  }
});

// Per product directive: the final "Project Complete" milestone always
// renders as a single-day stage starting the day AFTER closeout ends, with
// 0-week duration. This applies to every consumer of /task-data (mobile
// project details + AI chat). Mutates the array in place.
function forceProjectCompleteAfterCloseout(rows: any[]): void {
  if (!Array.isArray(rows) || rows.length < 2) return;
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  if (!last || !prev) return;
  const lastTitle = String(last?.Title ?? "").trim().toLowerCase();
  if (!lastTitle.includes("project complete") && !lastTitle.includes("complete")) return;
  const prevDue = String(prev?.DueDate ?? "");
  if (!prevDue) return;
  const d = new Date(prevDue);
  if (isNaN(d.getTime())) return;
  d.setDate(d.getDate() + 1);
  const iso = d.toISOString();
  last.StartDate = iso;
  last.DueDate = iso;
  last.Duration = 0;
  last.Weeks = 0;
}

// ── Schedule-ended auto-close (server-side) ─────────────────────────────────
// Whenever /task-data serves a PMM schedule whose LAST phase ended before
// today, the server closes the project itself (Status=Closed, close-only,
// never re-opens). Server-side so it works no matter WHO opens the project —
// view-only accounts are blocked from /update-fields but the record still
// needs to flip. Throttled per (tenant, ticket) so repeated task-data reads
// don't hammer the DB; a failed attempt clears the throttle so the next
// read retries.
const schedAutoCloseAt = new Map<string, number>();
const SCHED_AUTOCLOSE_RETRY_MS = 6 * 60 * 60 * 1000; // re-check at most every 6h
function maybeAutoCloseEndedSchedule(
  rds: { tid: string; tenant: string },
  ticketID: string,
  rows: unknown,
  auth: string,
): void {
  try {
    if (!Array.isArray(rows) || rows.length === 0) return;
    let lastMs = 0;
    for (const t of rows as { DueDate?: string }[]) {
      const n = new Date(String(t?.DueDate ?? "")).getTime();
      if (Number.isFinite(n) && n > 0 && n > lastMs) lastMs = n;
    }
    if (!lastMs) return;
    // "Ended" = last phase end DAY strictly before today's day. Phase dates
    // are stored at midnight UTC, so compare UTC day strings.
    const endDay = new Date(lastMs).toISOString().slice(0, 10);
    const todayDay = new Date().toISOString().slice(0, 10);
    if (endDay >= todayDay) return;
    const key = `${rds.tid}:${ticketID.toUpperCase()}`;
    const lastTry = schedAutoCloseAt.get(key) ?? 0;
    if (Date.now() - lastTry < SCHED_AUTOCLOSE_RETRY_MS) return;
    schedAutoCloseAt.set(key, Date.now());
    void autoCloseEndedScheduleRds(rds.tid, ticketID, rds.tenant, endDay)
      .then((r) => {
        if (!r.closed) {
          // "already-closed" / "not-pmm" / "manual-reactivation" are
          // permanent — keep the throttle so we don't re-query every read.
          // Anything else may be transient (missing row from a race, failed
          // update), so allow a retry.
          const permanent = r.reason === "already-closed" || r.reason === "manual-reactivation" || (r.reason ?? "").startsWith("not-pmm");
          if (!permanent) schedAutoCloseAt.delete(key);
          console.log(`[sched-autoclose] ${ticketID}@${rds.tenant} skipped: ${r.reason ?? "unknown"}`);
          return;
        }
        console.log(`[sched-autoclose] ${ticketID}@${rds.tenant} → Closed (schedule ended ${endDay}, was "${r.prevStatus ?? ""}")`);
        // Same bust set as a manual /update-fields save.
        bustRecordCache(auth);
        bustRdsRecordsCache(rds.tid);
        bustProjectDetailCache(rds.tid, ticketID);
      })
      .catch((e) => {
        schedAutoCloseAt.delete(key);
        console.warn(`[sched-autoclose] ${ticketID} failed: ${String(e)}`);
      });
  } catch { /* must never break /task-data */ }
}

// ── Schedule-driven status auto-advance ──────────────────────────────────────
// Sibling of the auto-close above: while the schedule is UNDERWAY (today
// inside the phase-date span), the record's status should track the phase
// whose window contains today. All skip/advance judgment lives in
// autoAdvanceScheduleStatusRds (forward-only, sub-status/custom/manual-latch
// aware); this wrapper just extracts the ordered phase windows, throttles per
// (tenant, ticket), and busts caches when a write actually landed.
const schedAutoAdvanceAt = new Map<string, number>();
const SCHED_AUTOADVANCE_RETRY_MS = 6 * 60 * 60 * 1000; // re-check at most every 6h
function maybeAutoAdvanceScheduleStatus(
  rds: { tid: string; tenant: string },
  ticketID: string,
  rows: unknown,
  auth: string,
): void {
  try {
    if (!Array.isArray(rows) || rows.length === 0) return;
    // Ordered phase windows — UTC day strings (dates are stored midnight
    // UTC; same convention as the auto-close). Duplicate titles merge to
    // one window (min start, max end) so re-visited phase names don't
    // produce a bogus later index.
    const byKey = new Map<string, { title: string; startMs: number; endMs: number; seq: number }>();
    let seq = 0;
    for (const t of rows as { Title?: string; StartDate?: string; DueDate?: string }[]) {
      const title = String(t?.Title ?? "").trim();
      if (!title) continue;
      const s = new Date(String(t?.StartDate ?? "")).getTime();
      const e = new Date(String(t?.DueDate ?? "")).getTime();
      if (!Number.isFinite(s) || s <= 0 || new Date(s).getFullYear() <= 2000) continue;
      const k = title.toLowerCase();
      const prev = byKey.get(k);
      if (prev) {
        prev.startMs = Math.min(prev.startMs, s);
        if (Number.isFinite(e) && e > prev.endMs) prev.endMs = e;
      } else {
        byKey.set(k, { title, startMs: s, endMs: Number.isFinite(e) && e > 0 ? e : s, seq: seq++ });
      }
    }
    if (byKey.size === 0) return;
    const phases = Array.from(byKey.values())
      .sort((a, b) => a.startMs - b.startMs || a.seq - b.seq)
      .map((p) => ({
        title: p.title,
        startDay: new Date(p.startMs).toISOString().slice(0, 10),
        endDay: new Date(p.endMs).toISOString().slice(0, 10),
      }));
    const todayDay = new Date().toISOString().slice(0, 10);
    // Cheap pre-checks before spending the throttle slot: schedule must be
    // underway (started, not ended — ended is the auto-close's turf).
    if (phases[0].startDay > todayDay) return;
    if (phases[phases.length - 1].endDay < todayDay) return;
    const key = `${rds.tid}:${ticketID.toUpperCase()}`;
    const lastTry = schedAutoAdvanceAt.get(key) ?? 0;
    if (Date.now() - lastTry < SCHED_AUTOADVANCE_RETRY_MS) return;
    schedAutoAdvanceAt.set(key, Date.now());
    void autoAdvanceScheduleStatusRds(rds.tid, ticketID, rds.tenant, phases)
      .then((r) => {
        if (!r.advanced) {
          // Terminal answers keep the throttle; transient ones (config
          // unavailable, race, failed update) release it for the next read.
          const transient = r.reason === "stage-cfg-unavailable" || r.reason === "record-not-found" || (r.reason ?? "").startsWith("update-failed");
          if (transient) schedAutoAdvanceAt.delete(key);
          // "already-current" is the steady state and "module-excluded"
          // fires for every LEM record — logging either would drown the log.
          if (r.reason !== "already-current" && !(r.reason ?? "").startsWith("module-excluded")) {
            console.log(`[sched-autoadvance] ${ticketID}@${rds.tenant} skipped: ${r.reason ?? "unknown"}`);
          }
          return;
        }
        console.log(`[sched-autoadvance] ${ticketID}@${rds.tenant} → "${r.newStatus}" (schedule week, was "${r.prevStatus ?? ""}")`);
        // Same bust set as a manual /update-fields save.
        bustRecordCache(auth);
        bustRdsRecordsCache(rds.tid);
        bustProjectDetailCache(rds.tid, ticketID);
      })
      .catch((e) => {
        schedAutoAdvanceAt.delete(key);
        console.warn(`[sched-autoadvance] ${ticketID} failed: ${String(e)}`);
      });
  } catch { /* must never break /task-data */ }
}

router.get("/task-data", async (req: Request, res: Response) => {
  try {
    const ticketID = req.query.ticketID as string;
    if (!ticketID) { res.status(400).json({ error: "ticketID required" }); return; }
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }

    const cacheKey = `${rds.tid}:${ticketID}`;
    const now = Date.now();
    const forceFresh = req.query.fresh === "1";

    // Post-write verification must bypass both this worker's cache and any
    // stale single-flight started before the write. Query the committed DB
    // state directly, then seed it only if no newer bust happened meanwhile.
    if (forceFresh) {
      const startGen = taskDataGen.get(cacheKey) ?? 0;
      const freshData = await getTaskDataRds(rds.tid, ticketID);
      setTaskDataCacheShared(cacheKey, freshData, { expectedGen: startGen });
      res.status(200).json(freshData);
      maybeAutoCloseEndedSchedule(rds, ticketID, freshData, req.headers.authorization ?? "");
      maybeAutoAdvanceScheduleStatus(rds, ticketID, freshData, req.headers.authorization ?? "");
      return;
    }

    const hit = taskDataCache.get(cacheKey);

    // ── Fresh hit → instant response ───────────────────────────────────────
    if (hit && hit.expiresAt > now) {
      res.status(200).json(hit.data);
      maybeAutoCloseEndedSchedule(rds, ticketID, hit.data, req.headers.authorization ?? "");
      maybeAutoAdvanceScheduleStatus(rds, ticketID, hit.data, req.headers.authorization ?? "");
      return;
    }

    // ── Stale within grace window → return instantly, refresh in background ─
    // The user sees data in <1 ms. The background fetch completes in ~200 ms
    // so the NEXT request for this project is fresh again.
    if (hit && hit.expiresAt + TASK_DATA_STALE_GRACE_MS > now) {
      res.status(200).json(hit.data);
      maybeAutoCloseEndedSchedule(rds, ticketID, hit.data, req.headers.authorization ?? "");
      maybeAutoAdvanceScheduleStatus(rds, ticketID, hit.data, req.headers.authorization ?? "");
      if (!taskDataInFlight.has(cacheKey)) {
        const startGen = taskDataGen.get(cacheKey) ?? 0;
        const bg: Promise<object[]> = getTaskDataRds(rds.tid, ticketID)
          .then((data) => {
            setTaskDataCacheShared(cacheKey, data, { expectedGen: startGen });
            taskDataInFlight.delete(cacheKey);
            return data;
          })
          .catch((e) => { taskDataInFlight.delete(cacheKey); console.warn(`[task-data][rds] bg-refresh failed: ${String(e)}`); return [] as object[]; });
        taskDataInFlight.set(cacheKey, bg);
      }
      return;
    }

    // ── Cold miss → single-flight: all concurrent requests share one DB query ─
    // 400 users opening a freshly-busted project → 1 DB query, not 400.
    let inflight = taskDataInFlight.get(cacheKey);
    if (!inflight) {
      const startGen = taskDataGen.get(cacheKey) ?? 0;
      inflight = getTaskDataRds(rds.tid, ticketID)
        .then((data) => {
          setTaskDataCacheShared(cacheKey, data, { expectedGen: startGen });
          taskDataInFlight.delete(cacheKey);
          return data;
        })
        .catch((e) => { taskDataInFlight.delete(cacheKey); throw e; });
      taskDataInFlight.set(cacheKey, inflight);
    }
    const dataCold = await inflight;
    res.status(200).json(dataCold);
    maybeAutoCloseEndedSchedule(rds, ticketID, dataCold, req.headers.authorization ?? "");
    maybeAutoAdvanceScheduleStatus(rds, ticketID, dataCold, req.headers.authorization ?? "");
  } catch (e) {
    console.log("[GetTaskData] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

router.get("/project-division-roles", async (req: Request, res: Response) => {
  try {
    const ticketID = req.query.ticketID as string;
    if (!ticketID) { res.status(400).json({ error: "ticketID required" }); return; }
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }

    const cacheKey = `${rds.tid}:${ticketID}`;
    // fresh=1 (post-save reload): bypass AND rebuild THIS worker's cache.
    // Closes the cross-worker race where the instant post-save refetch lands
    // on a cluster worker whose cache-bust IPC hasn't arrived yet — that
    // worker would serve the PRE-save BU list ("my save didn't work").
    const forceFresh = String(req.query.fresh ?? "") === "1";
    if (forceFresh) bustDivRolesLocal(cacheKey);
    const now = Date.now();
    const hit = divRolesCache.get(cacheKey);

    // Fresh hit → instant response
    if (hit && hit.expiresAt > now) {
      res.status(200).json(hit.data);
      return;
    }

    // Stale within grace window → return instantly, refresh in background
    if (hit && hit.expiresAt + DIV_ROLES_STALE_GRACE_MS > now) {
      res.status(200).json(hit.data);
      if (!divRolesInFlight.has(cacheKey)) {
        const startGen = divRolesGen.get(cacheKey) ?? 0;
        const bg = getProjectDivisionsRds(rds.tid, ticketID)
          .then((data) => {
            setDivRolesCacheIfCurrent(cacheKey, startGen, data);
            divRolesInFlight.delete(cacheKey);
            return data;
          })
          .catch((e) => { divRolesInFlight.delete(cacheKey); console.warn(`[project-division-roles][rds] bg-refresh: ${String(e)}`); return hit.data; });
        divRolesInFlight.set(cacheKey, bg);
      }
      return;
    }

    // Cold miss — single-flight: all concurrent requests share one DB query
    let inflight = divRolesInFlight.get(cacheKey);
    if (!inflight) {
      const startGen = divRolesGen.get(cacheKey) ?? 0;
      inflight = getProjectDivisionsRds(rds.tid, ticketID)
        .then((data) => {
          setDivRolesCacheIfCurrent(cacheKey, startGen, data);
          divRolesInFlight.delete(cacheKey);
          return data;
        })
        .catch((e) => { divRolesInFlight.delete(cacheKey); console.warn(`[project-division-roles][rds] ${String(e)}`); return {} as object; });
      divRolesInFlight.set(cacheKey, inflight);
    }
    res.status(200).json(await inflight);
  } catch (e) {
    console.log("[GetProjectDivisionRoles] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// Per-BU roles editor (Business Units table): writes the PM / Executive /
// Contact names and supporting-BU contract values into the record's
// DivisionRolesJson column. Gated like every other RDS write (view-only 403)
// PLUS the financial gate when the patch touches a contract value — the
// synthesized FieldName matches what the provider actually writes for
// primary rows, so the policy check and the write stay in lockstep.
router.post("/project-division-roles/update", async (req: Request, res: Response) => {
  try {
    const { ticketID, divisionKey, patch } = (req.body ?? {}) as {
      ticketID?: string; divisionKey?: string;
      patch?: { pm?: unknown; exec?: unknown; contact?: unknown; contractValue?: unknown };
    };
    if (!ticketID || !divisionKey || !patch || typeof patch !== "object") {
      res.status(400).json({ error: "ticketID, divisionKey and patch required" }); return;
    }
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    if (await blockIfReadOnly(req, res)) return;
    if (patch.contractValue !== undefined
        && await blockIfFinancialRestricted(req, res, [{ FieldName: "ApproxContractValue" }])) return;

    const clean = {
      ...(patch.pm !== undefined ? { pm: String(patch.pm) } : {}),
      ...(patch.exec !== undefined ? { exec: String(patch.exec) } : {}),
      ...(patch.contact !== undefined ? { contact: String(patch.contact) } : {}),
      ...(patch.contractValue !== undefined ? { contractValue: Number(patch.contractValue) } : {}),
    };
    if (Object.keys(clean).length === 0) { res.status(400).json({ error: "empty patch" }); return; }
    const result = await updateProjectDivisionRolesRds(rds.tid, String(ticketID), String(divisionKey), clean, rds.tenant,
      { userId: rds.userId, acl: rds.accessLevel, username: rds.username });
    if (!result.ok) { res.status(400).json({ error: result.error || "update failed" }); return; }
    bustDivRolesCache(rds.tid, String(ticketID));
    setAuditTarget(res, { entityType: "configuration", entityId: `${ticketID}:${divisionKey}`, entityName: String(divisionKey) });
    handoffTrustedAuditChanges(res, result);
    res.json({ ok: true });
  } catch (e) {
    console.log("[UpdateProjectDivisionRoles] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// CLIENT-OFFICIAL ASSIGNMENT CASCADE
// The client provided the authoritative chain for the BU → Role → Title →
// Person picker. We proxy each upstream API 1:1 and normalize the response to
// a stable { id, name } shape so the web/mobile clients don't depend on exact
// upstream field names. Because the Postman export shipped without sample
// responses, we try every plausible field name and log the real first-row keys
// on the first authenticated call so the mapping can be confirmed from logs.
//   1) Roles for a BU        → GET /api/MobileApp/GetRoleDetails?DivisionIdLookup=
//   2) Job Titles for BU+Role→ GET /api/MobileApp/GetJobTitleDetailsByRole?DivisionIdLookup=&RoleLookup=
//   3) People for a JobTitle → GET /api/MobileApp/GetResourceDetailsByJobTitle?JobTitleLookup=
// ─────────────────────────────────────────────────────────────────────────
const pickField = (row: Record<string, unknown>, names: string[]): string => {
  for (const n of names) {
    const v = row[n];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
};

router.get("/assign/roles-by-bu", async (req: Request, res: Response) => {
  try {
    const divisionIdLookup = String(req.query.divisionIdLookup ?? "").trim();
    if (!divisionIdLookup) { res.status(400).json({ error: "divisionIdLookup required" }); return; }
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    // Superadmins viewing another company (Edit Staff modal) pass ?tenantId= —
    // otherwise the Role dropdown lists the superadmin's home-tenant roles.
    const tid = (isSuperAdminSource(rds) && typeof req.query.tenantId === "string" && req.query.tenantId)
      ? resolveTenantId(req.query.tenantId)
      : rds.tid;
    try { res.json(await getRolesByBuRds(tid)); }
    catch (e) { console.warn(`[roles-by-bu][rds] failed: ${String(e)}`); res.status(502).json({ error: "Error fetching roles from core2" }); }
  } catch (e) {
    console.log("[roles-by-bu] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// GET /assign/person-org?name=<person name> → existing Business Unit / Division /
// Role / Title for a person who already has an established staff record.
// Used to PREFILL (and lock) the Assignment Setup card so the client cannot
// pick a different org placement for someone who already belongs to one —
// only brand-new people (no match) get free-choice dropdowns.
router.get("/assign/person-org", async (req: Request, res: Response) => {
  try {
    const name = String(req.query.name ?? "").trim();
    if (!name) { res.status(400).json({ error: "name required" }); return; }
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    try {
      const data = await rdsGetResourceAllocations(rds.tid, rds.tenant) as {
        resources: Array<{
          id: string; name: string; businessUnit: string; divisionName: string;
          // NOTE: `role` here is actually the JobTitle NAME (resolveRole prefers
          // the JobTitleName join), while `roleName` is the Role CATALOG name —
          // mirrors the naming already used inside getResourceAllocations.
          roleName: string; role: string; divisionId: string; roleId: string; jobTitleId: string;
          departmentName?: string; departmentId?: string;
        }>;
      };
      const nameLower = name.trim().toLowerCase();
      const match = data.resources.find((r) => r.name?.trim().toLowerCase() === nameLower)
        || data.resources.find((r) => r.name?.trim().toLowerCase().includes(nameLower) || nameLower.includes(r.name?.trim().toLowerCase() ?? ""));
      if (!match || (!match.divisionId && !match.roleId && !match.jobTitleId)) {
        res.json({ found: false });
        return;
      }
      res.json({
        found: true,
        personId: match.id,
        businessUnit: match.businessUnit || "",
        divisionName: match.divisionName || "",
        divisionId: match.divisionId || "",
        departmentName: match.departmentName || "",
        departmentId: match.departmentId || "",
        roleName: match.roleName || "",
        roleId: match.roleId || "",
        titleName: match.role || "",
        jobTitleId: match.jobTitleId || "",
      });
    } catch (e) {
      console.warn(`[assign/person-org][rds] failed: ${String(e)}`);
      res.status(502).json({ error: "Error fetching person org from core2" });
    }
  } catch (e) {
    console.log("[assign/person-org] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

router.get("/assign/job-titles", async (req: Request, res: Response) => {
  try {
    const divisionIdLookup = String(req.query.divisionIdLookup ?? "").trim();
    const roleLookup = String(req.query.roleLookup ?? "").trim();
    const departmentId = String(req.query.departmentId ?? "").trim();
    if (!divisionIdLookup) { res.status(400).json({ error: "divisionIdLookup required" }); return; }
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    try { res.json(await getJobTitlesRds(rds.tid, divisionIdLookup, roleLookup, departmentId)); }
    catch (e) { console.warn(`[job-titles][rds] failed: ${String(e)}`); res.status(502).json({ error: "Error fetching job titles from core2" }); }
  } catch (e) {
    console.log("[job-titles] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// POST /assign/roles → add a new role to the tenant catalogue (so the Add-Staff
// Role dropdown isn't limited to the seeded list).
router.post("/assign/roles", async (req: Request, res: Response) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    if (!name) { res.status(400).json({ error: "name required" }); return; }
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    if (await blockIfReadOnly(req, res)) return;
    try {
      const r = await createRoleRds(rds.tid, name);
      bustRoleRatesCache(rds.tid);
      setAuditTarget(res, { entityType: "configuration", entityId: r.id, entityName: r.name });
      handoffTrustedAuditChanges(res, r);
      res.json(r);
    }
    catch (e) { console.warn(`[assign/roles][create][rds] failed: ${String(e)}`); res.status(502).json({ error: "Error creating role in core2" }); }
  } catch (e) {
    console.log("[assign/roles][create] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// DELETE /roles/:id → remove a role from the tenant catalogue (soft-delete when
// possible) and cascade-delete all per-department billing rate overrides for it.
// Edit-gated: only admin/editor-level users may delete roles.
router.delete("/roles/:id", async (req: Request, res: Response) => {
  if (await blockIfReadOnly(req, res)) return;
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  const roleId = String(req.params.id ?? "").trim();
  if (!roleId) { res.status(400).json({ error: "roleId required" }); return; }
  try {
    let oldRole: { id: string; name: string } | undefined;
    try {
      oldRole = ((await getRolesByBuRds(rds.tid)) as Array<{ id: string; name: string }>)
        .find((x) => String(x.id) === roleId);
    } catch { /* audit best-effort */ }
    const result = await deleteRoleRds(rds.tid, roleId);
    bustRoleRatesCache(rds.tid);
    console.log(`[roles][delete][rds] ${rds.username}@${rds.tenant} deleted role ${roleId} → ${JSON.stringify(result)}`);
    setAuditTarget(res, { entityType: "configuration", entityId: roleId, entityName: oldRole?.name, action: "delete.configuration" });
    if (result.deleted && oldRole) setTrustedAuditChanges(res, [{ FieldName: "Role name", OldValue: oldRole.name, NewValue: null }]);
    res.json(result);
  } catch (e) {
    console.warn(`[roles][delete][rds] failed: ${String(e)}`);
    res.status(502).json({ error: "Could not delete role", detail: String(e) });
  }
});

// POST /assign/job-titles → add a new job title to the tenant catalogue,
// optionally scoped to a department.
router.post("/assign/job-titles", async (req: Request, res: Response) => {
  try {
    const title = String(req.body?.title ?? "").trim();
    const departmentId = String(req.body?.departmentId ?? "").trim();
    const roleId = String(req.body?.roleId ?? "").trim();
    if (!title) { res.status(400).json({ error: "title required" }); return; }
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    if (await blockIfReadOnly(req, res)) return;
    try {
      const out = await createJobTitleRds(rds.tid, title, departmentId || undefined, roleId || undefined);
      setAuditTarget(res, { entityType: "configuration", entityId: String(out.id), entityName: out.name });
      handoffTrustedAuditChanges(res, out);
      res.json(out);
    }
    catch (e) { console.warn(`[assign/job-titles][create][rds] failed: ${String(e)}`); res.status(502).json({ error: "Error creating job title in core2" }); }
  } catch (e) {
    console.log("[assign/job-titles][create] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// POST /divisions → add a new division to the tenant (CompanyDivisions).
router.post("/divisions", async (req: Request, res: Response) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    const businessUnitId = String(req.body?.businessUnitId ?? "").trim();
    if (!name) { res.status(400).json({ error: "name required" }); return; }
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    if (await blockIfReadOnly(req, res)) return;
    try {
      const r = await createDivisionRds(rds.tid, name, businessUnitId || undefined);
      bustOrgCache(rds.tid);
      // First-seen provenance for the Organization "where did this come from"
      // grid — only on REAL creation (idempotent re-adds skip). Best-effort.
      if (r.created) void recordOrgProvenance([{ tenantId: rds.tid, entityType: "division", entityName: r.name, source: "manual", createdBy: rds.username }]).catch(() => {});
      setAuditTarget(res, { entityType: "configuration", entityId: r.id, entityName: r.name });
      if (r.created) setTrustedAuditChanges(res, [
        { FieldName: "Division name", OldValue: null, NewValue: r.name },
        { FieldName: "Business unit ID", OldValue: null, NewValue: businessUnitId || null },
      ]);
      res.json(r);
    }
    catch (e) {
      if (e instanceof ParentRequiredError) { res.status(400).json({ error: e.message }); return; }
      console.warn(`[divisions][create][rds] failed: ${String(e)}`); res.status(502).json({ error: "Error creating division in core2" });
    }
  } catch (e) {
    console.log("[divisions][create] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// POST /divisions/ensure-bridge { businessUnitId?, fallbackName? } → find-or-create
// the hidden bridge division for tenants that hide the Division tier
// (showDivision=false). With a businessUnitId the bridge mirrors that BU's name;
// without one a single tenant-wide bridge is used. Idempotent and race-safe.
router.post("/divisions/ensure-bridge", async (req: Request, res: Response) => {
  try {
    const businessUnitId = String(req.body?.businessUnitId ?? "").trim();
    const fallbackName = String(req.body?.fallbackName ?? "").trim();
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    if (await blockIfReadOnly(req, res)) return;
    try {
      const r = await ensureBridgeDivisionRds(rds.tid, businessUnitId || undefined, fallbackName || undefined);
      bustOrgCache(rds.tid);
      setAuditTarget(res, { entityType: "configuration", entityId: r.id, entityName: r.name });
      res.json(r);
    } catch (e) {
      console.warn(`[divisions][ensure-bridge][rds] failed: ${String(e)}`);
      res.status(502).json({ error: "Error resolving bridge division in core2" });
    }
  } catch (e) {
    console.log("[divisions][ensure-bridge] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// POST /business-units → add a new Business Unit to the tenant. Business Units are
// now a separate entity (core2.dbo.BusinessUnit), independent of divisions.
router.post("/business-units", async (req: Request, res: Response) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    if (!name) { res.status(400).json({ error: "name required" }); return; }
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    if (await blockIfReadOnly(req, res)) return;
    try {
      const r = await createBusinessUnitRds(rds.tid, name);
      bustOrgCache(rds.tid);
      if (r.created) void recordOrgProvenance([{ tenantId: rds.tid, entityType: "bu", entityName: r.name, source: "manual", createdBy: rds.username }]).catch(() => {});
      setAuditTarget(res, { entityType: "configuration", entityId: r.id, entityName: r.name });
      if (r.created) setTrustedAuditChanges(res, [{ FieldName: "Business unit name", OldValue: null, NewValue: r.name }]);
      res.json(r);
    }
    catch (e) { console.warn(`[business-units][create][rds] failed: ${String(e)}`); res.status(502).json({ error: "Error creating business unit in core2" }); }
  } catch (e) {
    console.log("[business-units][create] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// POST /departments → add a new department to the tenant, optionally linked to a
// Division via DivisionIdLookup.
router.post("/departments", async (req: Request, res: Response) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    const divisionId = String(req.body?.divisionId ?? "").trim();
    if (!name) { res.status(400).json({ error: "name required" }); return; }
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    if (await blockIfReadOnly(req, res)) return;
    try {
      const r = await createDepartmentRds(rds.tid, name, divisionId || undefined);
      bustOrgCache(rds.tid);
      if (r.created) void recordOrgProvenance([{ tenantId: rds.tid, entityType: "department", entityName: r.name, source: "manual", createdBy: rds.username }]).catch(() => {});
      setAuditTarget(res, { entityType: "configuration", entityId: r.id, entityName: r.name });
      if (r.created) setTrustedAuditChanges(res, [{
        FieldName: "Department name",
        OldValue: null,
        NewValue: r.name,
      }]);
      res.json(r);
    }
    catch (e) {
      if (e instanceof ParentRequiredError) { res.status(400).json({ error: e.message }); return; }
      console.warn(`[departments][create][rds] failed: ${String(e)}`); res.status(502).json({ error: "Error creating department in core2" });
    }
  } catch (e) {
    console.log("[departments][create] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// PATCH /divisions/:id  { name?, businessUnitId? }  → rename and/or re-link a division.
router.patch("/divisions/:id", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  if (await blockIfReadOnly(req, res)) return;
  const id = String(req.params.id ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  const buId = req.body?.businessUnitId !== undefined ? String(req.body.businessUnitId ?? "").trim() : undefined;
  if (!id) { res.status(400).json({ error: "id required" }); return; }
  try {
    let before: Record<string, unknown> | undefined;
    try {
      before = (await getDivisionsRds(rds.tid) as Record<string, unknown>[])
        .find((row) => String(row.ID ?? row.Id ?? "") === id);
    } catch { /* audit best-effort */ }
    if (name) await renameDivisionRds(rds.tid, id, name);
    if (buId !== undefined) await relinkDivisionRds(rds.tid, id, buId || null);
    bustOrgDerivedCaches(rds.tid);
    setAuditTarget(res, { entityType: "configuration", entityId: id, entityName: name || String(before?.Title ?? "") });
    if (before) {
      try {
        const after = (await getDivisionsRds(rds.tid) as Record<string, unknown>[])
          .find((row) => String(row.ID ?? row.Id ?? "") === id);
        if (after) setTrustedAuditChanges(res, trustedAuditDiff(before, after, {
          fields: ["Title", "ShortName", "BusinessUnitIdLookup"],
          prefix: "Division",
        }));
      } catch { /* audit best-effort */ }
    }
    res.json({ ok: true });
  } catch (e) { console.warn(`[divisions][patch][rds] ${String(e)}`); res.status(502).json({ error: String(e) }); }
});

// DELETE /divisions/:id → soft-delete (or hard-delete) a division.
router.delete("/divisions/:id", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  if (await blockIfReadOnly(req, res)) return;
  const id = String(req.params.id ?? "").trim();
  const title = String(req.query.title ?? "").trim();
  if (!id) { res.status(400).json({ error: "id required" }); return; }
  try {
    let before: Record<string, unknown> | undefined;
    try {
      before = (await getDivisionsRds(rds.tid) as Record<string, unknown>[])
        .find((row) => String(row.ID ?? row.Id ?? "") === id);
    } catch { /* audit best-effort */ }
    const r = await deleteDivisionRds(rds.tid, id, title || undefined);
    bustOrgDerivedCaches(rds.tid);
    setAuditTarget(res, { entityType: "configuration", entityId: id, entityName: String(before?.Title ?? title), action: "delete.configuration" });
    if (r.deleted && before) setTrustedAuditChanges(res, trustedAuditDiff(before, null, {
      fields: ["Title", "ShortName", "BusinessUnitIdLookup"],
      prefix: "Division",
    }));
    res.json(r);
  }
  catch (e) { console.warn(`[divisions][delete][rds] ${String(e)}`); res.status(502).json({ error: String(e) }); }
});

// PATCH /business-units/:id  { name }  → rename a business unit.
router.patch("/business-units/:id", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  if (await blockIfReadOnly(req, res)) return;
  const id = String(req.params.id ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  if (!id || !name) { res.status(400).json({ error: "id and name required" }); return; }
  try {
    let before: Record<string, unknown> | undefined;
    try {
      before = (await getBusinessUnitsListRds(rds.tid) as Record<string, unknown>[])
        .find((row) => String(row.ID ?? row.Id ?? "") === id);
    } catch { /* audit best-effort */ }
    await renameBusinessUnitRds(rds.tid, id, name);
    bustOrgDerivedCaches(rds.tid);
    setAuditTarget(res, { entityType: "configuration", entityId: id, entityName: name });
    if (before) {
      try {
        const after = (await getBusinessUnitsListRds(rds.tid) as Record<string, unknown>[])
          .find((row) => String(row.ID ?? row.Id ?? "") === id);
        if (after) setTrustedAuditChanges(res, trustedAuditDiff(before, after, {
          fields: ["Title", "ShortName"],
          prefix: "Business unit",
        }));
      } catch { /* audit best-effort */ }
    }
    res.json({ ok: true });
  }
  catch (e) { console.warn(`[business-units][patch][rds] ${String(e)}`); res.status(502).json({ error: String(e) }); }
});

// DELETE /business-units/:id → soft-delete (or hard-delete) a business unit.
router.delete("/business-units/:id", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  if (await blockIfReadOnly(req, res)) return;
  const id = String(req.params.id ?? "").trim();
  const title = String(req.query.title ?? "").trim();
  if (!id) { res.status(400).json({ error: "id required" }); return; }
  try {
    let before: Record<string, unknown> | undefined;
    try {
      before = (await getBusinessUnitsListRds(rds.tid) as Record<string, unknown>[])
        .find((row) => String(row.ID ?? row.Id ?? "") === id);
    } catch { /* audit best-effort */ }
    const r = await deleteBusinessUnitRds(rds.tid, id, title || undefined);
    bustOrgDerivedCaches(rds.tid);
    setAuditTarget(res, { entityType: "configuration", entityId: id, entityName: String(before?.Title ?? title), action: "delete.configuration" });
    if (r.deleted && before) setTrustedAuditChanges(res, trustedAuditDiff(before, null, {
      fields: ["Title", "ShortName"],
      prefix: "Business unit",
    }));
    res.json(r);
  }
  catch (e) { console.warn(`[business-units][delete][rds] ${String(e)}`); res.status(502).json({ error: String(e) }); }
});

// PATCH /departments/:id  { name?, divisionId? }  → rename and/or re-link a department.
router.patch("/departments/:id", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  if (await blockIfReadOnly(req, res)) return;
  const id = String(req.params.id ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  const divId = req.body?.divisionId !== undefined ? String(req.body.divisionId ?? "").trim() : undefined;
  if (!id) { res.status(400).json({ error: "id required" }); return; }
  try {
    let before: Record<string, unknown> | undefined;
    try {
      before = (await departmentsRds(rds.tid) as Record<string, unknown>[])
        .find((x) => String(x.ID ?? x.Id ?? x.id ?? "") === id);
    } catch { /* audit best-effort */ }
    if (name) await renameDepartmentRds(rds.tid, id, name);
    if (divId !== undefined) await relinkDepartmentRds(rds.tid, id, divId || null);
    bustOrgDerivedCaches(rds.tid);
    setAuditTarget(res, { entityType: "configuration", entityId: id, entityName: name || String(before?.Title ?? before?.Name ?? "") });
    if (before) {
      try {
        const after = (await departmentsRds(rds.tid) as Record<string, unknown>[])
          .find((x) => String(x.ID ?? x.Id ?? x.id ?? "") === id);
        if (after) setTrustedAuditChanges(res, trustedAuditDiff(before, after, {
          fields: ["Title", "Name", "DivisionIdLookup", "DivisionLookup"],
          prefix: "Department",
        }));
      } catch { /* audit best-effort */ }
    }
    res.json({ ok: true });
  } catch (e) { console.warn(`[departments][patch][rds] ${String(e)}`); res.status(502).json({ error: String(e) }); }
});

// DELETE /departments/:id → soft-delete (or hard-delete) a department.
router.delete("/departments/:id", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  if (await blockIfReadOnly(req, res)) return;
  const id = String(req.params.id ?? "").trim();
  const title = String(req.query.title ?? "").trim();
  const divId = String(req.query.divId ?? "").trim();
  if (!id) { res.status(400).json({ error: "id required" }); return; }
  try {
    let before: Record<string, unknown> | undefined;
    try {
      before = (await departmentsRds(rds.tid) as Record<string, unknown>[])
        .find((x) => String(x.ID ?? x.Id ?? x.id ?? "") === id);
    } catch { /* audit best-effort */ }
    const r = await deleteDepartmentRds(rds.tid, id, title || undefined, divId || undefined);
    bustOrgDerivedCaches(rds.tid);
    setAuditTarget(res, { entityType: "configuration", entityId: id, entityName: String(before?.Title ?? before?.Name ?? title), action: "delete.configuration" });
    if (r.deleted && before) setTrustedAuditChanges(res, trustedAuditDiff(before, null, {
      fields: ["Title", "Name", "DivisionIdLookup", "DivisionLookup"],
      prefix: "Department",
    }));
    res.json(r);
  }
  catch (e) { console.warn(`[departments][delete][rds] ${String(e)}`); res.status(502).json({ error: String(e) }); }
});

// POST /organization/cleanup → soft-delete all org entities with no live staff
router.post("/organization/cleanup", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  if (await blockIfReadOnly(req, res)) return;
  try {
    const { getPool, sql: msql } = await import("../lib/db.js");
    const pool = await getPool();
    const tid = rds.tid;
    const counts = { departments: 0, divisions: 0, businessUnits: 0 };

    // Detect which optional FK columns exist on AspNetUsers
    const colRes = await pool.request().query(`
      SELECT name FROM core2.sys.columns
      WHERE object_id = OBJECT_ID('core2.dbo.AspNetUsers')
        AND name IN ('DivisionLookup','DepartmentLookup')
    `);
    const userCols = new Set((colRes.recordset as { name: string }[]).map(r => r.name));
    const hasDivLk  = userCols.has("DivisionLookup");
    const hasDeptLk = userCols.has("DepartmentLookup");

    // 1. Departments with no staff — check BOTH DepartmentLookup (direct) and
    //    JobTitle.DepartmentId (inherited via job title). A dept is only "unused"
    //    if no active tenant user references it through either path.
    const jtColRes = await pool.request().query(`
      SELECT name FROM core2.sys.columns
      WHERE object_id = OBJECT_ID('core2.dbo.JobTitle')
        AND name IN ('DepartmentId','ID')
    `);
    const jtCols = new Set((jtColRes.recordset as { name: string }[]).map(r => r.name));
    const hasJtDept = jtCols.has("DepartmentId") && jtCols.has("ID");
    const hasJtLk = userCols.has("JobTitleLookup");

    // Direct DepartmentLookup check
    const deptDirectClause = hasDeptLk
      ? `AND NOT EXISTS (SELECT 1 FROM core2.dbo.AspNetUsers u WHERE u.TenantID=@tid AND ISNULL(u.Deleted,0)=0 AND u.DepartmentLookup=dep.ID)`
      : `/* DepartmentLookup col absent — skip direct check */`;
    // JobTitle.DepartmentId check — staff whose job title is in this department
    const deptViaJtClause = (hasJtDept && hasJtLk)
      ? `AND NOT EXISTS (
          SELECT 1 FROM core2.dbo.JobTitle jt
          INNER JOIN core2.dbo.AspNetUsers u ON jt.ID = TRY_CAST(u.JobTitleLookup AS BIGINT)
          WHERE u.TenantID=@tid AND ISNULL(u.Deleted,0)=0
            AND dep.ID = TRY_CAST(jt.DepartmentId AS BIGINT)
        )`
      : `/* JobTitle.DepartmentId col absent — skip job-title check */`;

    const deptRes = await pool.request().input("tid", msql.NVarChar, tid).query(`
      SELECT CAST(dep.ID AS NVARCHAR(50)) AS id FROM core2.dbo.Department dep
      WHERE dep.TenantID=@tid AND ISNULL(dep.Deleted,0)=0
        ${deptDirectClause}
        ${deptViaJtClause}
    `);
    const deptIds = (deptRes.recordset as { id: string }[]).map(r => r.id);
    for (let i = 0; i < deptIds.length; i += 50) {
      const batch = deptIds.slice(i, i + 50);
      const req2 = pool.request().input("tid", msql.NVarChar, tid);
      const inc = batch.map((id, j) => { req2.input(`d${i+j}`, msql.NVarChar, id); return `@d${i+j}`; }).join(",");
      await req2.query(`UPDATE core2.dbo.Department SET Deleted=1 WHERE TenantID=@tid AND ID IN (${inc})`);
    }
    counts.departments = deptIds.length;

    // 2. Divisions with no staff and no remaining departments
    const divStaffClause = hasDivLk
      ? `AND NOT EXISTS (SELECT 1 FROM core2.dbo.AspNetUsers u WHERE u.TenantID=@tid AND ISNULL(u.Deleted,0)=0 AND u.DivisionLookup=cd.ID)`
      : `/* DivisionLookup col absent — skip staff check */`;
    const divRes = await pool.request().input("tid", msql.NVarChar, tid).query(`
      SELECT CAST(cd.ID AS NVARCHAR(50)) AS id FROM core2.dbo.CompanyDivisions cd
      WHERE cd.TenantID=@tid AND ISNULL(cd.Deleted,0)=0
        ${divStaffClause}
        AND NOT EXISTS (
          SELECT 1 FROM core2.dbo.Department dep
          WHERE dep.TenantID=@tid AND ISNULL(dep.Deleted,0)=0 AND dep.DivisionIdLookup=cd.ID
        )
    `);
    const divIds = (divRes.recordset as { id: string }[]).map(r => r.id);
    for (let i = 0; i < divIds.length; i += 50) {
      const batch = divIds.slice(i, i + 50);
      const req2 = pool.request().input("tid", msql.NVarChar, tid);
      const inc = batch.map((id, j) => { req2.input(`c${i+j}`, msql.NVarChar, id); return `@c${i+j}`; }).join(",");
      await req2.query(`UPDATE core2.dbo.CompanyDivisions SET Deleted=1 WHERE TenantID=@tid AND ID IN (${inc})`);
    }
    counts.divisions = divIds.length;

    // 3. Business units with no remaining divisions
    const buRes = await pool.request().input("tid", msql.NVarChar, tid).query(`
      SELECT CAST(bu.ID AS NVARCHAR(50)) AS id FROM core2.dbo.BusinessUnit bu
      WHERE bu.TenantID=@tid AND ISNULL(bu.Deleted,0)=0
        AND NOT EXISTS (
          SELECT 1 FROM core2.dbo.CompanyDivisions cd
          WHERE cd.TenantID=@tid AND ISNULL(cd.Deleted,0)=0 AND cd.BusinessUnitIdLookup=bu.ID
        )
    `);
    const buIds = (buRes.recordset as { id: string }[]).map(r => r.id);
    for (let i = 0; i < buIds.length; i += 50) {
      const batch = buIds.slice(i, i + 50);
      const req2 = pool.request().input("tid", msql.NVarChar, tid);
      const inc = batch.map((id, j) => { req2.input(`b${i+j}`, msql.NVarChar, id); return `@b${i+j}`; }).join(",");
      await req2.query(`UPDATE core2.dbo.BusinessUnit SET Deleted=1 WHERE TenantID=@tid AND ID IN (${inc})`);
    }
    counts.businessUnits = buIds.length;

    const { invalidateDivisionHierarchy } = await import("../lib/rds-provider.js");
    invalidateDivisionHierarchy(tid);
    setAuditTarget(res, { entityType: "configuration", entityId: "organization-cleanup", entityName: "Organization cleanup", action: "delete.configuration" });
    setTrustedAuditChanges(res, boundedAuditChanges([
      { FieldName: "Departments deleted", OldValue: counts.departments, NewValue: 0 },
      { FieldName: "Divisions deleted", OldValue: counts.divisions, NewValue: 0 },
      { FieldName: "Business units deleted", OldValue: counts.businessUnits, NewValue: 0 },
    ], counts.departments + counts.divisions + counts.businessUnits));
    res.json({ ok: true, deleted: counts });
  } catch (e) {
    console.warn("[organization][cleanup]", String(e));
    res.status(502).json({ error: String(e) });
  }
});

router.get("/assign/resources", async (req: Request, res: Response) => {
  try {
    const jobTitleLookup = String(req.query.jobTitleLookup ?? "").trim();
    if (!jobTitleLookup) { res.status(400).json({ error: "jobTitleLookup required" }); return; }
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    try { res.json(await getResourcesByJobTitleRds(rds.tid, jobTitleLookup)); }
    catch (e) { console.warn(`[resources][rds] failed: ${String(e)}`); res.status(502).json({ error: "Error fetching resources from core2" }); }
  } catch (e) {
    console.log("[resources] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// POST /organization/bulk-upload — idempotent bulk creation of org structure
// from a template spreadsheet. Accepts a JSON array of rows with keys:
//   business_unit, division, department, role, job_title (all optional strings)
// Creates each entity in dependency order (BU → Division → Dept → Role → Title)
// and caches IDs within the request so the same name on multiple rows only
// triggers one INSERT attempt.
router.post("/organization/bulk-upload", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  if (await blockIfReadOnly(req, res)) return;

  const rows = req.body?.rows as Array<Record<string, string>>;
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "rows array is required" }); return;
  }

  // divisionHints: divLower → chosen BU name (from disambiguation dialog)
  const divisionHints: Record<string, string> = req.body?.divisionHints ?? {};

  const tid = rds.tid;

  // ── Intra-file disambiguation check ──────────────────────────────────────
  // If the same division name appears under multiple BUs in the file and no
  // hint has been provided for it, return a conflict list so the frontend can
  // show the disambiguation dialog before any writes happen.
  const divBuInFile = new Map<string, Set<string>>(); // divLower → all BU names
  for (const row of rows) {
    const d = (row.division      ?? "").trim();
    const b = (row.business_unit ?? "").trim();
    if (d && b && d.toLowerCase() !== b.toLowerCase()) {
      const key = d.toLowerCase();
      const s = divBuInFile.get(key) ?? new Set<string>();
      s.add(b);
      divBuInFile.set(key, s);
    }
  }
  const unresolvedConflicts: Array<{ divName: string; divLower: string; busInFile: string[] }> = [];
  for (const [divLower, buSet] of divBuInFile) {
    if (buSet.size > 1 && !divisionHints[divLower]) {
      const divName = rows.find(r => (r.division ?? "").trim().toLowerCase() === divLower)
        ?.division?.trim() ?? divLower;
      unresolvedConflicts.push({ divName, divLower, busInFile: Array.from(buSet) });
    }
  }

  // ── DB-level conflict check ───────────────────────────────────────────────
  // A division may appear under exactly one BU in the file (no intra-file
  // conflict) yet already exist in the DB under a DIFFERENT BU. Without this
  // check createDivisionRds silently re-links the division to the new BU.
  // Only run when there are divisions with a single BU in the file.
  const divBuSingle = new Map<string, string>(); // divLower → the one BU name in this file
  for (const [divLower, buSet] of divBuInFile) {
    if (buSet.size === 1) divBuSingle.set(divLower, Array.from(buSet)[0]);
  }

  if (divBuSingle.size > 0) {
    // Fetch existing divisions and BUs for this tenant in parallel.
    const [existingDivs, existingBUs] = await Promise.all([
      getDivisionsRds(tid) as Promise<Array<{ Title: string; BusinessUnitIdLookup: string | null }>>,
      getBusinessUnitsListRds(tid) as Promise<Array<{ ID: string; Title: string }>>,
    ]);
    const buIdToName = new Map(existingBUs.map(b => [String(b.ID), b.Title]));
    // divLower → existing BU name in DB (null when division doesn't exist yet)
    const dbDivBu = new Map<string, string | null>();
    for (const d of existingDivs) {
      const key = (d.Title ?? "").trim().toLowerCase();
      const buName = d.BusinessUnitIdLookup ? (buIdToName.get(d.BusinessUnitIdLookup) ?? null) : null;
      dbDivBu.set(key, buName);
    }

    for (const [divLower, fileBuName] of divBuSingle) {
      if (divisionHints[divLower]) continue; // already resolved by user
      const existingBuName = dbDivBu.get(divLower);
      if (
        existingBuName &&
        existingBuName.toLowerCase() !== fileBuName.toLowerCase()
      ) {
        const divName = rows.find(r => (r.division ?? "").trim().toLowerCase() === divLower)
          ?.division?.trim() ?? divLower;
        unresolvedConflicts.push({
          divName,
          divLower,
          busInFile: [existingBuName, fileBuName],
        });
      }
    }
  }

  if (unresolvedConflicts.length > 0) {
    res.json({ Status: false, needsDisambiguation: true, conflicts: unresolvedConflicts });
    return;
  }

  const counts = { bus: 0, divs: 0, depts: 0, roles: 0, jobTitles: 0 };
  const errors: string[] = [];
  // First-seen provenance for entities REALLY created by this upload (the
  // Organization "where did this come from" grid). Flushed best-effort at the end.
  const provRows: OrgProvenanceInput[] = [];
  const provFile = String(req.body?.fileName ?? "").trim() || null;
  const provOf = (entityType: OrgProvenanceInput["entityType"], entityName: string): OrgProvenanceInput =>
    ({ tenantId: tid, entityType, entityName, source: "org-upload", fileName: provFile, createdBy: rds.username });

  // Pre-pass: create all unique BUs first so hint-based div→BU lookups always
  // find the target BU id regardless of row order.
  const buCache  = new Map<string, string>(); // lower → id
  for (const row of rows) {
    const buName = (row.business_unit ?? "").trim();
    if (!buName) continue;
    const key = buName.toLowerCase();
    if (!buCache.has(key)) {
      try {
        const r = await createBusinessUnitRds(tid, buName);
        buCache.set(key, r.id);
        counts.bus++;
        if (r.created) provRows.push(provOf("bu", r.name));
      } catch { /* already exists — fetch below */ }
    }
  }
  // Also ensure any hinted BUs are in the cache (they may not appear as a row's BU column)
  for (const hintedBu of Object.values(divisionHints)) {
    const key = hintedBu.toLowerCase();
    if (!buCache.has(key)) {
      try {
        const r = await createBusinessUnitRds(tid, hintedBu);
        buCache.set(key, r.id);
        if (r.created) provRows.push(provOf("bu", r.name));
      } catch { /* already exists */ }
    }
  }

  const divCache  = new Map<string, string>();
  const deptCache = new Map<string, string>();
  const roleCache = new Map<string, string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const buName   = (row.business_unit ?? "").trim();
    const divName  = (row.division      ?? "").trim();
    const deptName = (row.department    ?? "").trim();
    const roleName = (row.role          ?? "").trim();
    const jtName   = (row.job_title     ?? "").trim();

    try {
      const buId = buName ? buCache.get(buName.toLowerCase()) : undefined;

      let divId: string | undefined;
      if (divName) {
        const key = divName.toLowerCase();
        if (!divCache.has(key)) {
          // If the user chose a specific BU for this division, use that; otherwise
          // fall back to the BU on this row.
          const hintBuName = divisionHints[key];
          const effectiveBuId = hintBuName ? buCache.get(hintBuName.toLowerCase()) : buId;
          const r = await createDivisionRds(tid, divName, effectiveBuId);
          divCache.set(key, r.id);
          counts.divs++;
          if (r.created) provRows.push(provOf("division", r.name));
        }
        divId = divCache.get(key);
      }

      let deptId: string | undefined;
      if (deptName) {
        const key = deptName.toLowerCase();
        if (!deptCache.has(key)) {
          const r = await createDepartmentRds(tid, deptName, divId);
          deptCache.set(key, r.id);
          counts.depts++;
          if (r.created) provRows.push(provOf("department", r.name));
        }
        deptId = deptCache.get(key);
      }

      let roleId: string | undefined;
      if (roleName) {
        const key = roleName.toLowerCase();
        if (!roleCache.has(key)) {
          const r = await createRoleRds(tid, roleName);
          roleCache.set(key, r.id);
          counts.roles++;
        }
        roleId = roleCache.get(key);
      }

      if (jtName) {
        await createJobTitleRds(tid, jtName, deptId, roleId);
        counts.jobTitles++;
      }
    } catch (e) {
      errors.push(`Row ${i + 1}: ${(e as Error).message ?? String(e)}`);
    }
  }

  // New roles change the /role-billing-rates list — drop the per-tenant cache.
  if (counts.roles > 0) bustRoleRatesCache(tid);
  if (provRows.length) void recordOrgProvenance(provRows).catch(() => {});
  setAuditTarget(res, { entityType: "configuration", entityId: "organization-bulk-upload", entityName: provFile ?? "Organization bulk upload" });
  const createdChanges = provRows.map((x) => ({ FieldName: `Created ${x.entityType}`, OldValue: null, NewValue: x.entityName }));
  setTrustedAuditChanges(res, boundedAuditChanges(createdChanges, provRows.length));
  res.json({ Status: true, counts, errors });
});

// GET /status-ledger?module=OPM|LEM&since=ISO&until=ISO
// Returns status-change ledger rows for the tenant within an optional time
// window. Used by the Reports pages for per-period conversion/decision counts.
// Rows are already in-period (bounded server-side). Capped at 5 000 rows.
router.get("/status-ledger", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  try {
    const module = typeof req.query.module === "string" ? req.query.module : undefined;
    const since  = typeof req.query.since  === "string" ? req.query.since  : undefined;
    const until  = typeof req.query.until  === "string" ? req.query.until  : undefined;
    const limitQ = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
    const { rows, truncated, since: coverageSince } = await getStatusLedger(
      rds.tid, { module, since, until }, Number.isFinite(limitQ) && limitQ > 0 ? limitQ : undefined);
    res.json({ rows, truncated, since: coverageSince });
  } catch (e) {
    console.warn(`[status-ledger] query failed: ${String(e)}`);
    res.status(502).json({ error: "Error loading status ledger" });
  }
});

// GET /org/provenance — first-seen source attribution for the tenant's org
// entities (which uploaded file / manual action introduced each BU, Division,
// Department). Superadmins may inspect another tenant via ?tenantId=.
router.get("/org/provenance", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  try {
    const tid = (typeof req.query.tenantId === "string" && req.query.tenantId && isSuperAdminSource(rds))
      ? resolveTenantId(req.query.tenantId)
      : rds.tid;
    res.json({ rows: await getOrgProvenance(tid) });
  } catch (e) {
    console.warn(`[org/provenance] failed: ${String(e)}`);
    res.status(502).json({ error: "Error loading org provenance" });
  }
});

// POST /org/trace { name, entityType } — find which previously uploaded file
// FIRST mentioned an org entity by scanning the tenant's stored import files
// (oldest first, bounded by file count / size / time so one click can't hog a
// worker). A hit is persisted as source "traced" (insert-if-absent) so the
// answer shows permanently in the Organization grid without re-scanning.
router.post("/org/trace", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  const name = String(req.body?.name ?? "").trim();
  const entityTypeRaw = String(req.body?.entityType ?? "").trim();
  const entityType = (["bu", "division", "department"] as const).find((t) => t === entityTypeRaw);
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  try {
    // Jobs are keyed by the human tenant LABEL; provenance by the tenant GUID.
    const tenantLabel = (typeof req.body?.tenantId === "string" && req.body.tenantId && isSuperAdminSource(rds))
      ? String(req.body.tenantId)
      : rds.tenant;
    const provTid = resolveTenantId(tenantLabel);
    const needle = name.toLowerCase();
    // Oldest first — attribution answers "which file INTRODUCED this name".
    const jobs = (await getOnboardingHistorySlimByTenant(tenantLabel))
      .filter((j) => j.status === "success" || j.status === "partial")
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    const MAX_FILES = 12;
    const MAX_BYTES = 15 * 1024 * 1024;
    const TIME_BUDGET_MS = 20_000;
    const started = Date.now();
    let scanned = 0;
    let skipped = 0;
    const matches: Array<{ sheet: string; column: string; rows: number }> = [];
    let matchedJob: (typeof jobs)[number] | null = null;
    for (const j of jobs) {
      if (scanned >= MAX_FILES || Date.now() - started > TIME_BUDGET_MS) { skipped++; continue; }
      let bin: Buffer | null = null;
      try { bin = await getOnboardingJobFileBin(j.uploadId); } catch { bin = null; }
      if (!bin || bin.length === 0 || bin.length > MAX_BYTES) { skipped++; continue; }
      scanned++;
      let sheets: Awaited<ReturnType<typeof parseExcel>>;
      try { sheets = await parseExcel(bin); } catch { continue; }
      // Exact (case/whitespace-insensitive) cell matches only — substring hits
      // would blame files that merely contain a longer, unrelated name.
      const perCol = new Map<string, number>(); // "sheet\u0000column" → hit count
      for (const sh of sheets) {
        for (const row of sh.rows) {
          for (const [col, val] of Object.entries(row)) {
            if (val == null) continue;
            if (String(val).trim().toLowerCase() === needle) {
              const k = `${sh.sheetName}\u0000${col}`;
              perCol.set(k, (perCol.get(k) ?? 0) + 1);
            }
          }
        }
      }
      if (perCol.size > 0) {
        matchedJob = j;
        for (const [k, n] of perCol) {
          const [sheet, column] = k.split("\u0000");
          matches.push({ sheet, column, rows: n });
        }
        break; // first (oldest) file containing the name wins
      }
    }
    if (matchedJob && entityType) {
      await recordOrgProvenance([{
        tenantId: provTid,
        entityType,
        entityName: name,
        source: "traced",
        fileName: matchedJob.fileName,
        uploadId: matchedJob.uploadId,
        createdBy: matchedJob.createdBy,
      }]).catch(() => {});
    }
    res.json({
      found: !!matchedJob,
      fileName: matchedJob?.fileName ?? null,
      uploadId: matchedJob?.uploadId ?? null,
      uploadedAt: matchedJob?.createdAt ?? null,
      uploadedBy: matchedJob?.createdBy ?? null,
      matches,
      scannedFiles: scanned,
      skippedFiles: skipped,
      // Only a full scan can prove absence — any skipped file (cap, size,
      // unreadable) means "not found" is inconclusive, not definitive.
      complete: skipped === 0,
    });
  } catch (e) {
    console.warn(`[org/trace] failed: ${String(e)}`);
    res.status(502).json({ error: "Error tracing org entity" });
  }
});

// GET /division-details — sector/studio breakdown analytics. This data set was
// upstream-only and has no equivalent table in core2. Product decision: return
// an empty object so the division-detail panel renders its empty state cleanly
// rather than blocking the page with an error.
router.get("/division-details", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  res.json({});
});

router.get("/user-list", async (req: Request, res: Response) => {
  try {
    // RDS tenants must only ever see/assign people that exist in THEIR own
    // core2.dbo.AspNetUsers. The upstream GetUserList returns the shared master
    // directory, whose GUIDs do NOT exist in a tenant's core2 — assigning one
    // writes an unresolvable ResourceUser that getProjectTeamRds then drops
    // (the member silently never appears). Serve tenant users instead, shaped
    // as { Id, Name } to match what the Add-Member picker reads.
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    try {
      const users = await getUsersRds(rds.tid);
      // Org-audience sentinel ids per person (org:bu/div/dept) — the User
      // Groups bulk-add and org-audience pickers match people with these,
      // so client snapshots agree with the live server-side membership.
      let orgMap = new Map<string, string[]>();
      try { orgMap = await orgAudienceIdsByUser(rds.tid); } catch { /* display-only */ }
      res.json(users.map((u) => ({
        Id: (u as { id: string }).id,
        Name: (u as { name: string }).name,
        // Resolved job title so the assign picker can match people by role/title.
        JobProfile: (u as { title?: string }).title ?? "",
        // Raw role text — second matching signal for the picker's
        // "related people" filter (some tenants store the real job title here).
        Role: (u as any).role ?? "",
        // Access level — used by the User Groups quick-add "add everyone with
        // an access level" feature. Values: "admin" | "manager" | "user" | null
        // (null = view-only / grandfathered user-level) | "custom:<name>" for
        // tenant-defined custom levels.
        AccessLevel: (u as any).accessLevel ?? null,
        // Org fields — auto-fill BU/Division/Dept when a person is picked, and
        // fallback for the template-apply picker when the slot has no org stored.
        DivisionName: (u as any).divisionName ?? "",
        Department:   (u as any).departmentName ?? "",
        BusinessUnit: (u as any).businessUnit ?? "",
        DivisionId:   (u as any).divisionId   ?? "",
        DepartmentId: (u as any).departmentId ?? "",
        // Live org-audience sentinel ids this person belongs to.
        OrgUnitIds:   orgMap.get(String((u as { id: string }).id ?? "").toLowerCase()) ?? [],
        // Email and username — used by pickers to disambiguate two accounts
        // that share a display name (e.g. two "Matthew Johnson" entries).
        Email:    (u as any).email    ?? "",
        UserName: (u as any).username ?? "",
      })));
    } catch (e) {
      console.warn(`[user-list][rds] failed: ${String(e)}`);
      res.status(502).json({ error: "Error fetching users from core2" });
    }
  } catch (e) {
    console.log("[GetUserList] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// GET /duplicate-staff-names → list of login-identity groups that have ≥2
// enabled, non-deleted accounts. Display names are not identities: two people
// may legitimately share a name when their email/login accounts differ.
// Gated on manage-staff capability: the response contains PII (emails,
// usernames, internal IDs) and is only useful to staff managers.
router.get("/duplicate-staff-names", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  // Enforce manage-staff capability server-side — same gate as POST /create-staff
  // and PATCH /staff/:guid/assignment. Returns 403 for view-only and custom
  // levels that lack manageStaff; 503 when the policy DB is unreachable.
  if (await blockIfNoStaffCap(req, res)) return;
  try {
    const { getActiveUsersByTenant } = await import("@workspace/db");
    const rows = await getActiveUsersByTenant(rds.tid);
    // Only look at enabled accounts (enabled flag present and true, or null/
    // undefined for legacy imported accounts which were never explicitly disabled).
    const enabled = rows.filter(u => !u.deleted && u.enabled !== false);
    // Group by the actual login identity, not by display name. Email is the
    // canonical identity; legacy rows without an email fall back to username.
    // Trim/case normalization handles harmless formatting differences while
    // keeping genuinely different addresses separate.
    const byIdentity = new Map<string, typeof enabled>();
    for (const u of enabled) {
      const identity = (u.email || u.username || "").trim();
      if (!identity) continue;
      const key = identity.toLowerCase();
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key)!.push(u);
    }
    // Return only groups with ≥2 members (actual login duplicates). Include
    // each display name so admins can still tell the accounts apart.
    const duplicates: { name: string; accounts: { id: string; name: string; email: string; username: string }[] }[] = [];
    for (const [, group] of byIdentity) {
      if (group.length < 2) continue;
      duplicates.push({
        name: (group[0].name || group[0].username || "").trim(),
        accounts: group.map(u => ({
          id: u.id,
          name: (u.name || u.username || "").trim(),
          email: (u.email || "").trim(),
          username: (u.username || "").trim(),
        })),
      });
    }
    // Sort alphabetically by name for a stable list.
    duplicates.sort((a, b) => a.name.localeCompare(b.name));
    res.json(duplicates);
  } catch (e) {
    console.warn(`[duplicate-staff-names] failed: ${String(e)}`);
    res.status(502).json({ error: "Could not check for duplicate names" });
  }
});

// ── Resource-master cache ────────────────────────────────────────────────────
// GET /resource-master backs the Forecast page's office/title pivots and the
// Talent directory. It previously hit dbo.rmone_users on EVERY page open —
// 0.7-1.7 s through the remote link — despite the roster changing rarely.
// Same pattern as the users caches: TTL + long stale grace with background
// SWR refresh + single-flight. Busted alongside the users-family caches
// (locally at every users-bust site, cross-worker via the IPC "users"
// signal) so staff creates/edits/imports show up immediately.
const RESOURCE_MASTER_TTL_MS         = 10 * 60 * 1000;
const RESOURCE_MASTER_STALE_GRACE_MS = 6 * 60 * 60 * 1000;
// Empty directories are either genuinely empty tenants (cheap to recompute)
// or failure residue — never pin them for the full TTL (hollow-cache rule).
const RESOURCE_MASTER_EMPTY_TTL_MS   = 2 * 60 * 1000;
const resourceMasterCache    = new Map<string, { data: object[]; expiresAt: number }>();
const resourceMasterInFlight = new Map<string, Promise<object[]>>();
// Generation guard (same convention as the staff-org/divisionHierarchy race
// fix): a fetch that started BEFORE a bust must never write its pre-bust
// snapshot back into the cache after the bust — callers still get the rows,
// they just don't stick.
const resourceMasterGen = new Map<string, number>();

function bustResourceMasterLocal(tid: string): void {
  resourceMasterCache.delete(tid);
  resourceMasterInFlight.delete(tid);
  resourceMasterGen.set(tid, (resourceMasterGen.get(tid) ?? 0) + 1);
}

// Test seam (resourceMasterBustRace.test.ts): lets the race test control WHEN
// the underlying fetch resolves. Always null in production.
let resourceMasterTestFetcher: ((tid: string) => Promise<object[]>) | null = null;
export const __resourceMasterTestHooks = {
  cache: resourceMasterCache,
  inFlight: resourceMasterInFlight,
  gen: resourceMasterGen,
  bust: bustResourceMasterLocal,
  fetch: (tid: string): Promise<object[]> => fetchResourceMaster(tid),
  setFetcher: (fn: ((tid: string) => Promise<object[]>) | null): void => { resourceMasterTestFetcher = fn; },
};

function fetchResourceMaster(tid: string): Promise<object[]> {
  const existing = resourceMasterInFlight.get(tid);
  if (existing) return existing;
  const genAtStart = resourceMasterGen.get(tid) ?? 0;
  const p: Promise<object[]> = (resourceMasterTestFetcher ?? getResourceMasterRds)(tid)
    .then((data) => {
      // Only the CURRENT in-flight entry may clean up — a pre-bust completion
      // must not delete a newer post-bust request (would defeat single-flight).
      if (resourceMasterInFlight.get(tid) === p) resourceMasterInFlight.delete(tid);
      const rows = data as object[];
      if ((resourceMasterGen.get(tid) ?? 0) === genAtStart) {
        const ttl = rows.length > 0 ? RESOURCE_MASTER_TTL_MS : RESOURCE_MASTER_EMPTY_TTL_MS;
        resourceMasterCache.set(tid, { data: rows, expiresAt: Date.now() + ttl });
        capMap(resourceMasterCache, CACHE_MAX_ORG);
      }
      return rows;
    })
    .catch((e) => {
      if (resourceMasterInFlight.get(tid) === p) resourceMasterInFlight.delete(tid);
      throw e;
    });
  resourceMasterInFlight.set(tid, p);
  return p;
}

// GET /resource-master → ResourceMasterRow[] (Forecast page pivot enrichment).
// Best-effort: the page never blocks on this, so a failure returns 502 and the
// client defaults to an empty directory. Failures are never cached — only a
// resolved roster (or a genuinely empty one, briefly) lands in the cache.
router.get("/resource-master", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  try {
    const nowMs = Date.now();
    const hit = resourceMasterCache.get(rds.tid);
    if (hit && hit.expiresAt > nowMs) { res.json(hit.data); return; }
    if (hit && hit.expiresAt + RESOURCE_MASTER_STALE_GRACE_MS > nowMs) {
      res.json(hit.data); // instant stale response…
      void fetchResourceMaster(rds.tid).catch((e) =>       // …refresh behind it
        console.warn(`[resource-master][swr] refresh failed: ${String(e).slice(0, 200)}`));
      return;
    }
    res.json(await fetchResourceMaster(rds.tid));
  } catch (e) {
    console.warn(`[resource-master][rds] failed: ${String(e)}`);
    res.status(502).json({ error: "Error fetching resource master from core2" });
  }
});

// GET /billing-rates — per-project cost-allocation detail (upstream shape:
// { Allocations, UserProfiles }). core2 has no equivalent to the upstream
// GetProjectAllocationsWithCostDetails endpoint. Per-role billing rates are
// served by /role-billing-rates and /role-billing-rates-by-dept. Product
// decision: return the empty contractual shape so the cost panel degrades
// gracefully; it does not block project load.
router.get("/billing-rates", async (req: Request, res: Response) => {
  const projectID = req.query.projectID as string;
  if (!projectID) { res.status(400).json({ error: "projectID required" }); return; }
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  void projectID;
  res.json({ Allocations: [], UserProfiles: [] });
});

// GET /role-billing-rates → { rates: [...], hasDeptRates: boolean }.
// rates = per-role billing rates (company-wide or dept-scoped).
// hasDeptRates = whether this tenant has a RoleBillingRateByDept table;
// when false the frontend hides the department picker to avoid confusion.
router.get("/role-billing-rates", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  console.log(`[role-billing-rates] src=${rds?.src ?? "NONE"} tid=${rds?.tid ?? "NONE"} user=${rds?.username ?? "ANON"}`);
  if (!rds) { res.status(401).json({ error: "Billing rates are only available for AWS-hosted tenants." }); return; }
  const departmentId = String(req.query.departmentId ?? "").trim();
  try {
    // Dept-scoped requests bypass the cache (Billing Rates page only, rare).
    if (departmentId) {
      const [rates, hasDeptRates] = await Promise.all([
        roleBillingRatesByDeptRds(rds.tid, departmentId),
        hasDeptRatesTableRds(),
      ]);
      console.log(`[role-billing-rates] → ${rates.length} roles for tenant ${rds.tid} (dept ${departmentId})`);
      res.json({ rates, hasDeptRates });
      return;
    }
    // Company-wide path: SWR cache keyed by tid. Fresh hit → return instantly.
    // Stale-grace hit → return instantly AND refresh in the background so the
    // next open is fresh. Miss → fetch (single-flight per tenant).
    const tid = rds.tid;
    const now = Date.now();
    const hit = roleRatesCache.get(tid);
    const fetchRates = (): Promise<object> => {
      const inflight = roleRatesInFlight.get(tid);
      if (inflight) return inflight;
      const startGen = roleRatesGen.get(tid) ?? 0;
      const p = (async () => {
        const [rates, hasDeptRates] = await Promise.all([
          roleBillingRatesRds(tid),
          hasDeptRatesTableRds(),
        ]);
        const data = { rates, hasDeptRates };
        setRoleRatesCacheIfCurrent(tid, startGen, data);
        return data;
      })();
      roleRatesInFlight.set(tid, p);
      p.finally(() => {
        if (roleRatesInFlight.get(tid) === p) roleRatesInFlight.delete(tid);
      }).catch(() => { /* handled by awaiting callers */ });
      return p;
    };
    if (hit && now < hit.expiresAt) {
      res.json(hit.data);
      return;
    }
    if (hit && now < hit.expiresAt + ROLE_RATES_STALE_GRACE_MS) {
      // Serve stale instantly; background refresh (errors logged, never cached).
      void fetchRates().catch((e) => console.warn(`[role-billing-rates][refresh] failed: ${String(e)}`));
      res.json(hit.data);
      return;
    }
    const data = await fetchRates() as { rates: unknown[] };
    console.log(`[role-billing-rates] → ${data.rates.length} roles for tenant ${tid}`);
    res.json(data);
  } catch (e) {
    console.warn(`[role-billing-rates][rds] failed: ${String(e)}`);
    res.status(502).json({ error: "Could not load billing rates", detail: String(e) });
  }
});

// POST /role-billing-rate  { roleId, billingRate }  → set/clear a role's rate.
// RDS-only + edit-gated. billingRate null/"" clears the rate.
router.post("/role-billing-rate", async (req: Request, res: Response) => {
  if (await blockIfFinancialRestricted(req, res, [{ FieldName: "BillingRate" }])) return;
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "Billing rates are only available for AWS-hosted tenants." }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const roleId = String(b.roleId ?? "").trim();
  if (!roleId) { res.status(400).json({ error: "A role is required." }); return; }
  const departmentId = String(b.departmentId ?? "").trim();
  const raw = b.billingRate;
  let rate: number | null = null;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) { res.status(400).json({ error: "Billing rate must be a non-negative number." }); return; }
    rate = n;
  }
  try {
    let auditBefore: Awaited<ReturnType<typeof roleBillingRatesByDeptRds>>[number] | undefined;
    try { auditBefore = (await roleBillingRatesByDeptRds(rds.tid, departmentId)).find((x) => x.id === roleId); } catch { /* audit best-effort */ }
    // With a departmentId the rate is a per-department override; without one it
    // updates the company-wide default on the role itself.
    const r = departmentId
      ? await updateRoleBillingRateByDeptRds(rds.tid, roleId, departmentId, rate)
      : await updateRoleBillingRateRds(rds.tid, roleId, rate);
    // A cleared override that had no existing row is a successful no-op (updated
    // === false). Only treat false as "not found" in the company-wide path,
    // where a missing row genuinely means the role doesn't exist.
    if (!r.updated && !departmentId) { res.status(404).json({ error: "Role not found for this account." }); return; }
    bustRoleRatesCache(rds.tid);
    // Rates are baked into every cached /project-team payload (costRate →
    // ETC/EAC cost columns) and into financial analytics — bust both so the
    // new rate shows up immediately, not after the 30-min team TTL.
    bustProjectTeamTenant(rds.tid);
    bustFinancialCache(rds.tid);
    console.log(`[role-billing-rate][rds] ${rds.username}@${rds.tenant} set ${roleId}${departmentId ? `@dept:${departmentId}` : ""} → ${rate == null ? "(cleared)" : rate}`);
    setAuditTarget(res, { entityType: "configuration", entityId: departmentId ? `${roleId}:${departmentId}` : roleId, entityName: auditBefore?.name });
    try {
      const after = (await roleBillingRatesByDeptRds(rds.tid, departmentId)).find((x) => x.id === roleId);
      if (auditBefore && after) setTrustedAuditChanges(res, trustedAuditDiff(
        { BillingRate: departmentId ? auditBefore.billingRate : auditBefore.defaultRate },
        { BillingRate: departmentId ? after.billingRate : after.defaultRate },
      ));
    } catch { /* audit best-effort */ }
    res.json({ ok: true });
  } catch (e) {
    console.warn(`[role-billing-rate][rds] failed: ${String(e)}`);
    res.status(502).json({ error: "Could not save billing rate", detail: String(e) });
  }
});

// POST /role-rates  { roleId, laborRate?, costRate? }  → save labor/cost rates.
router.post("/role-rates", async (req: Request, res: Response) => {
  if (await blockIfFinancialRestricted(req, res, [{ FieldName: "Rate" }])) return;
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "Rate updates are only available for AWS-hosted tenants." }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const roleId = String(b.roleId ?? "").trim();
  if (!roleId) { res.status(400).json({ error: "A role is required." }); return; }
  // Validate ONLY the fields actually present in the body. The page saves one
  // field at a time ({laborRate} without costRate and vice versa) — treating an
  // ABSENT field as invalid rejected every single-field save with a misleading
  // "must be non-negative" error even though the submitted value was positive.
  function parseRate(v: unknown): number | null | "invalid" {
    if (v == null || String(v).trim() === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return "invalid";
    return n;
  }
  const laborRate = "laborRate" in b ? parseRate(b.laborRate) : undefined;
  const costRate  = "costRate"  in b ? parseRate(b.costRate)  : undefined;
  if (laborRate === "invalid" || costRate === "invalid") {
    const bad = laborRate === "invalid"
      ? `labor rate "${String(b.laborRate)}"`
      : `cost rate "${String(b.costRate)}"`;
    res.status(400).json({ error: `Invalid ${bad} — rates must be non-negative numbers.` }); return;
  }
  const fields: { laborRate?: number | null; costRate?: number | null } = {};
  if (laborRate !== undefined) fields.laborRate = laborRate;
  if (costRate  !== undefined) fields.costRate  = costRate;
  try {
    let auditBefore: Awaited<ReturnType<typeof roleBillingRatesRds>>[number] | undefined;
    try { auditBefore = (await roleBillingRatesRds(rds.tid)).find((x) => x.id === roleId); } catch { /* audit best-effort */ }
    await updateRoleRatesRds(rds.tid, roleId, fields);
    bustRoleRatesCache(rds.tid);
    bustProjectTeamTenant(rds.tid); // rates feed cached team-grid cost columns
    bustFinancialCache(rds.tid);
    console.log(`[role-rates][rds] ${rds.username}@${rds.tenant} set ${roleId} → labor:${laborRate} cost:${costRate}`);
    setAuditTarget(res, { entityType: "configuration", entityId: roleId, entityName: auditBefore?.name });
    try {
      const after = (await roleBillingRatesRds(rds.tid)).find((x) => x.id === roleId);
      if (auditBefore && after) setTrustedAuditChanges(res, trustedAuditDiff(
        { LaborRate: auditBefore.laborRate, CostRate: auditBefore.costRate },
        { LaborRate: after.laborRate, CostRate: after.costRate },
      ));
    } catch { /* audit best-effort */ }
    res.json({ ok: true });
  } catch (e) {
    console.warn(`[role-rates][rds] failed: ${String(e)}`);
    res.status(502).json({ error: "Could not save rates", detail: String(e) });
  }
});

// POST /role-rates-by-dept  { roleId, departmentId, laborRate?, costRate?, billingRate? }
// → upsert all three rate overrides for a role+department into RoleBillingRateByDept.
router.post("/role-rates-by-dept", async (req: Request, res: Response) => {
  if (await blockIfFinancialRestricted(req, res, [{ FieldName: "Rate" }])) return;
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "Rate updates are only available for AWS-hosted tenants." }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const roleId = String(b.roleId ?? "").trim();
  const deptId = String(b.departmentId ?? "").trim();
  if (!roleId || !deptId) { res.status(400).json({ error: "roleId and departmentId are required." }); return; }
  // Validate ONLY the fields present in the body (single-field saves are the
  // norm here — see /role-rates above for why absent ≠ invalid).
  function parseRate(v: unknown): number | null | "invalid" {
    if (v == null || String(v).trim() === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return "invalid";
    return n;
  }
  const billingRate = "billingRate" in b ? parseRate(b.billingRate) : undefined;
  const laborRate   = "laborRate"   in b ? parseRate(b.laborRate)   : undefined;
  const costRate    = "costRate"    in b ? parseRate(b.costRate)    : undefined;
  if (billingRate === "invalid" || laborRate === "invalid" || costRate === "invalid") {
    const bad = billingRate === "invalid" ? `billing rate "${String(b.billingRate)}"`
      : laborRate === "invalid" ? `labor rate "${String(b.laborRate)}"`
      : `cost rate "${String(b.costRate)}"`;
    res.status(400).json({ error: `Invalid ${bad} — rates must be non-negative numbers.` }); return;
  }
  const rates: { billingRate?: number | null; laborRate?: number | null; costRate?: number | null } = {};
  if (billingRate !== undefined) rates.billingRate = billingRate;
  if (laborRate   !== undefined) rates.laborRate   = laborRate;
  if (costRate    !== undefined) rates.costRate    = costRate;
  try {
    let auditBefore: Awaited<ReturnType<typeof roleBillingRatesByDeptRds>>[number] | undefined;
    try { auditBefore = (await roleBillingRatesByDeptRds(rds.tid, deptId)).find((x) => x.id === roleId); } catch { /* audit best-effort */ }
    await updateRoleRatesByDeptRds(rds.tid, roleId, deptId, rates);
    bustRoleRatesCache(rds.tid);
    bustProjectTeamTenant(rds.tid); // rates feed cached team-grid cost columns
    bustFinancialCache(rds.tid);
    console.log(`[role-rates-by-dept][rds] ${rds.username}@${rds.tenant} set ${roleId}@dept:${deptId}`);
    setAuditTarget(res, { entityType: "configuration", entityId: `${roleId}:${deptId}`, entityName: auditBefore?.name });
    try {
      const after = (await roleBillingRatesByDeptRds(rds.tid, deptId)).find((x) => x.id === roleId);
      if (auditBefore && after) setTrustedAuditChanges(res, trustedAuditDiff(
        { BillingRate: auditBefore.billingRate, LaborRate: auditBefore.laborRate, CostRate: auditBefore.costRate },
        { BillingRate: after.billingRate, LaborRate: after.laborRate, CostRate: after.costRate },
      ));
    } catch { /* audit best-effort */ }
    res.json({ ok: true });
  } catch (e) {
    console.warn(`[role-rates-by-dept][rds] failed: ${String(e)}`);
    res.status(502).json({ error: "Could not save rates", detail: String(e) });
  }
});

router.get("/departments", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const tid = (isSuperAdminSource(rds) && typeof req.query.tenantId === "string" && req.query.tenantId) ? resolveTenantId(req.query.tenantId) : rds.tid;
    const now = Date.now();
    const hit = deptCache.get(tid);
    if (hit && hit.expiresAt > now) { res.json(hit.data); return; }
    if (hit && hit.expiresAt + ORG_CACHE_STALE_GRACE_MS > now) {
      res.json(hit.data);
      if (!deptInFlight.has(tid)) {
        const bg: Promise<object[]> = (departmentsRds(tid) as Promise<object[]>)
          .then((d) => { deptCache.set(tid, { data: d, expiresAt: Date.now() + ORG_CACHE_TTL_MS }); capMap(deptCache, CACHE_MAX_ORG); deptInFlight.delete(tid); return d; })
          .catch((e) => { deptInFlight.delete(tid); console.warn(`[departments][rds] bg-refresh: ${String(e)}`); return [] as object[]; });
        deptInFlight.set(tid, bg);
      }
      return;
    }
    let inflight = deptInFlight.get(tid);
    if (!inflight) {
      inflight = (departmentsRds(tid) as Promise<object[]>)
        .then((d) => { deptCache.set(tid, { data: d, expiresAt: Date.now() + ORG_CACHE_TTL_MS }); capMap(deptCache, CACHE_MAX_ORG); deptInFlight.delete(tid); return d; })
        .catch((e) => { deptInFlight.delete(tid); throw e; });
      deptInFlight.set(tid, inflight);
    }
    res.json(await inflight);
  } catch (e) {
    console.log("[GetAllActiveDepartments] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// POST /create-staff — create a brand-new staff member (core2 AspNetUsers) for an
// RDS tenant, with org placement (BU / Department / Job Title / Role) + access
// level. The account is visible immediately on the Resources page (at 0% / bench)
// but cannot be logged into until the person sets their own password via the
// optional emailed invite link. RDS-only + edit-gated.
router.post("/create-staff", async (req: Request, res: Response) => {
  // Staff-cap gate only (NOT blockIfReadOnly): manage-staff works without the
  // edit-data capability by design.
  if (await blockIfNoStaffCap(req, res)) return;
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(400).json({ error: "Add Staff is only available for AWS-hosted tenants." }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  const email = String(b.email ?? "").trim();
  if (!name) { res.status(400).json({ error: "Please enter the person's name." }); return; }
  if (!email.includes("@")) { res.status(400).json({ error: "Please enter a valid email address." }); return; }
  // Superadmins managing onboarding for a specific client can pass tenantId in
  // the request body to create staff on that tenant instead of their own.
  const bodyTenantId = typeof b.tenantId === "string" && b.tenantId.trim() ? b.tenantId.trim() : null;
  const tid = (isSuperAdminSource(rds) && bodyTenantId) ? resolveTenantId(bodyTenantId) : rds.tid;
  const tenantLabel = (isSuperAdminSource(rds) && bodyTenantId) ? bodyTenantId : rds.tenant;
  // Creating with a CUSTOM access level: the level must actually exist for this
  // company (mirrors /staff/:guid/assignment). A stale client could otherwise
  // create a user pointing at a deleted level — an orphaned marker that fails
  // closed to view-only and displays as "—" with no hint why.
  const reqAcl = b.accessLevel == null ? null : String(b.accessLevel);
  if (reqAcl && isCustomAcl(reqAcl)) {
    try {
      const caps = await getCapsForAcl(reqAcl, tenantLabel);
      const lvlName = await getCustomLevelName(reqAcl, tenantLabel);
      if (!caps || !lvlName) {
        res.status(400).json({ error: "That access level no longer exists. Refresh the page and pick another." });
        return;
      }
    } catch {
      res.status(503).json({ error: "Cannot verify access levels right now. Please try again." });
      return;
    }
  }
  try {
    // Resolve the default-rate setting so a manually-added person's role gets the
    // configured rate filled when it has none — same rule the import pipeline uses.
    let defaultBillingRate: number | null = null;
    try {
      const d = await loadEffectiveDefaults(tenantLabel);
      if (d.enableDefaultRate && d.defaultRate != null) defaultBillingRate = d.defaultRate;
    } catch { /* settings unavailable → leave rate blank (never fabricate) */ }

    const { userGuid, filledRoleRate } = await createStaffRds(tid, {
      name, email,
      divisionId: b.divisionId == null ? null : String(b.divisionId),
      departmentId: b.departmentId == null ? null : String(b.departmentId),
      jobTitleId: b.jobTitleId == null ? null : String(b.jobTitleId),
      roleId: b.roleId == null ? null : String(b.roleId),
      roleName: b.roleName == null ? null : String(b.roleName),
      accessLevel: b.accessLevel == null ? null : String(b.accessLevel),
      defaultBillingRate,
      employeeType: b.employeeType == null ? null : String(b.employeeType),
      phoneNumber: b.phoneNumber == null ? null : String(b.phoneNumber),
      employeeId: b.employeeId == null ? null : String(b.employeeId),
    });
    // New person with an org placement — live org audiences must see them now.
    bustStaffOrgEverywhere(tid);
    if (filledRoleRate) {
      try {
        await recordAssumedRoleRate({
          tenantLabel: rds.tenant, roleName: filledRoleRate.roleName,
          rate: filledRoleRate.rate, actor: rds.username,
        });
      } catch { /* audit best-effort — the rate fill already persisted */ }
    }
    let invite: Awaited<ReturnType<typeof sendSetPasswordInvite>> | undefined;
    if (b.sendInvite) {
      try {
        invite = await sendSetPasswordInvite({ tid, tenantLabel, userGuid, email, name });
      } catch (e) {
        invite = { ok: false, emailed: false, message: String((e as Error)?.message ?? e) };
      }
    }
    // Bust with the EFFECTIVE target tenant — a superadmin creating staff on a
    // client tenant (body.tenantId) must invalidate that tenant's caches, not
    // their own, or the new person stays invisible there for up to 5 min.
    usersCache.delete(tid); usersInFlight.delete(tid);
    bustUsersRdsCache(tid); // /user-list picker cache — same reason as above
    bustResourceMasterLocal(tid);
    broadcastBust({ type: "bustCache", fn: "users", tid });
    // Bust the resource-allocation caches (route-level + rds-provider) so the
    // Resources page shows the new person immediately instead of a stale list.
    bustResourceAllocCache(req.headers.authorization ?? "");
    bustResAllocsRouteCache(tid);
    console.log(`[create-staff][rds] ${rds.username}@${rds.tenant} created ${email} (${userGuid}) invite=${b.sendInvite ? (invite?.emailed ? "emailed" : "not-emailed") : "none"}`);
    setAuditTarget(res, { entityType: "staff", entityId: userGuid, entityName: name });
    try {
      const saved = await getStaffCoreRds(tid, userGuid);
      if (saved) setTrustedAuditChanges(res, trustedAuditDiff(null, {
        Email: saved.username,
        Name: saved.name,
        JobTitleId: saved.jobTitleId,
        RoleId: saved.roleId,
        DivisionId: saved.divisionId,
        DepartmentId: saved.departmentId,
      }));
    } catch { /* audit best-effort */ }
    res.json({ ok: true, userGuid, invite });
  } catch (e) {
    if (e instanceof StaffConflictError) { res.status(409).json({ error: e.message }); return; }
    console.warn(`[create-staff][rds] failed: ${String(e)}`);
    res.status(502).json({ error: "Could not create staff member in core2", detail: String(e) });
  }
});

// GET /project-templates — project template list. Project templates are not
// modelled in core2; lifecycle templates (GET /lifecycles) serve the same need
// for RDS tenants. Product decision: return empty list so the template picker
// falls back to showing lifecycle options.
router.get("/project-templates", async (req: Request, res: Response) => {
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  res.json([]);
});

// GET /template-details — project template detail. No per-template detail source
// exists in core2; lifecycle detail (GET /lifecycles) covers this need for RDS
// tenants. Product decision: return empty object; callers must not block on it.
router.get("/template-details", async (req: Request, res: Response) => {
  const id = req.query.id as string;
  if (!id) { res.status(400).json({ error: "id required" }); return; }
  const rds = resolveRequestSource(req);
  if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
  void id;
  res.json({});
});

router.post("/update-division-roles", async (req: Request, res: Response) => {
  try {
    if (await blockIfReadOnly(req, res)) return;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const bodyStr = JSON.stringify(req.body);
    console.log("[UpdateDivisionRoles] → body:", bodyStr.slice(0, 500));
    // No core2 write target exists for division-role mappings on these tenants.
    // Report honestly instead of returning a false success.
    res.status(501).json({ error: "Editing division roles isn't available for this account yet." });
  } catch (e) {
    console.log("[UpdateDivisionRoles] ← error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

router.get("/user-profile", async (req: Request, res: Response) => {
  try {
    const userName = req.query.userName as string;
    if (!userName) { res.status(400).json({ error: "userName required" }); return; }
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    res.json(await getRdsProfile(rds.tenant, (userName as string) || rds.username));
  } catch (e) {
    console.log("[GetUserProfileAndRoles] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// ─────────────────────────────────────────────────────────────────────
// JOB TITLES & DEPARTMENT JOB-TITLE COST RATES
// Two new RM ONE endpoints (May 2026 from client):
//   GET  /api/common/GetJobTitle                       → tenant-wide catalogue
//        of job titles (ID, Title, JobTitleName, ShortName, RoleName,
//        RoleId, JobType "Billable"|"Overhead", Deleted) wrapped in
//        { Table: [...] }.
//   POST /api/MobileApp/SaveDepartmentJobTitleMapping   → upserts a
//        per-(Department × JobTitle) cost rate.
//        Body: { Id, JobTitleId, EmpCostRate, DepartmentId, Deleted }
//        Resp: { success: true, message: "Saved successfully." }
// We expose them as /api/rmone/job-titles and /api/rmone/job-title-cost-rate.
// ─────────────────────────────────────────────────────────────────────
router.get("/job-titles", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const tid = (isSuperAdminSource(rds) && typeof req.query.tenantId === "string" && req.query.tenantId) ? resolveTenantId(req.query.tenantId) : rds.tid;
    res.json(await jobTitlesTableRds(tid));
  } catch (e) {
    console.log("[GetJobTitle] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

router.post("/job-title-cost-rate", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    if (await blockIfReadOnly(req, res)) return;
    // Internal cost rates are financial data: require the financial-edit
    // capability, not just general edit access. Probe with the canonical
    // financial field name so the alias set stays single-sourced in
    // isFinancialFieldName.
    if (await blockIfFinancialRestricted(req, res, [{ FieldName: "ContractValue" }])) return;
    const body = req.body as Record<string, unknown>;
    const payload = {
      Id: Number(body.Id ?? 0),
      JobTitleId: Number(body.JobTitleId ?? 0),
      EmpCostRate: Number(body.EmpCostRate ?? 0),
      DepartmentId: Number(body.DepartmentId ?? 0),
      Deleted: body.Deleted === true,
    };
    if (!payload.JobTitleId || !payload.DepartmentId) {
      res.status(400).json({ error: "JobTitleId and DepartmentId are required" });
      return;
    }
    const { sql: msql } = await import("../lib/db.js");
    const pool = await getPool();
    const updated = await pool.request()
      // TenantID is VARCHAR — an NVarChar param would convert the COLUMN and scan.
      .input("tid", msql.VarChar, rds.tid)
      .input("id", msql.BigInt, payload.JobTitleId)
      .input("rate", msql.Decimal(19, 4), payload.EmpCostRate)
      .query(`UPDATE core2.dbo.JobTitle
              SET EmpCostRate = @rate
              OUTPUT CAST(inserted.ID AS NVARCHAR(50)) AS ID,
                     inserted.Title,
                     deleted.EmpCostRate AS OldCostRate,
                     inserted.EmpCostRate AS NewCostRate
              WHERE TenantID = @tid AND ID = @id
                AND (Deleted = 0 OR Deleted IS NULL)`);
    const saved = updated.recordset?.[0] as {
      ID?: string;
      Title?: string;
      OldCostRate?: number | null;
      NewCostRate?: number | null;
    } | undefined;
    if (!saved) {
      res.status(404).json({ error: "Job title not found" });
      return;
    }
    setAuditTarget(res, {
      entityType: "configuration",
      entityId: `job-title:${saved.ID ?? payload.JobTitleId}`,
      entityName: String(saved.Title ?? ""),
    });
    setTrustedAuditChanges(res, [{
      FieldName: "JobTitle CostRate",
      OldValue: saved.OldCostRate ?? null,
      NewValue: saved.NewCostRate ?? null,
    }]);
    res.json({ success: true, message: "Saved successfully." });
  } catch (e) {
    console.log("[SaveDepartmentJobTitleMapping] error:", String(e));
    res.status(502).json({ error: "Upstream error", detail: String(e) });
  }
});

// POST /provision-tenant — superadmin only. Creates a new tenant with a full
// company profile and admin user. Org structure (BUs, Divisions, Departments,
// Roles, Job Titles) is NOT created here — admins configure that after login.
router.post("/provision-tenant", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    if (!isSuperAdminSource(rds)) { res.status(403).json({ error: "superadmin access required" }); return; }

    const {
      companyName, adminName, adminEmail, sendInvite,
      website, phone, companyEmail,
      streetAddress, city, state, zip, country,
      industry, ownershipType, licenseNumber,
    } = req.body as {
      companyName?: string; adminName?: string; adminEmail?: string;
      sendInvite?: boolean;
      website?: string; phone?: string; companyEmail?: string;
      streetAddress?: string; city?: string; state?: string;
      zip?: string; country?: string;
      industry?: string; ownershipType?: string; licenseNumber?: string;
    };

    const cName = (companyName ?? "").trim();
    const aName  = (adminName  ?? "").trim();
    const aEmail = (adminEmail ?? "").trim();
    if (!cName) { res.status(400).json({ error: "companyName is required" }); return; }
    if (!aName) { res.status(400).json({ error: "adminName is required" }); return; }
    if (!aEmail.includes("@")) { res.status(400).json({ error: "valid adminEmail is required" }); return; }

    const tid = resolveTenantId(cName);

    // Create the admin user (no org structure).
    const { userGuid } = await createStaffRds(tid, {
      name: aName, email: aEmail,
      divisionId: null, roleId: null,
      roleName: "Admin",
      title: "Tenant Admin",
      accessLevel: "Admin",
    });

    // Write company profile fields to CRMCompany if the table exists.
    // All fields are optional — missing or blank values are silently skipped.
    try {
      const { getPool, sql: msql } = await import("../lib/db.js");
      const pool = await getPool();

      // Check if CRMCompany table exists in this schema.
      const tableCheck = await pool.request()
        .input("tbl", msql.NVarChar, "CRMCompany")
        .query(`SELECT 1 AS found FROM core2.INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @tbl`);

      if ((tableCheck.recordset ?? []).length > 0) {
        // Build a SET list for whichever CRMCompany columns are present.
        const colsRes = await pool.request()
          .input("tbl2", msql.NVarChar, "CRMCompany")
          .query(`SELECT COLUMN_NAME FROM core2.INFORMATION_SCHEMA.COLUMNS
                  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @tbl2`);
        const liveCols = new Set(
          ((colsRes.recordset ?? []) as { COLUMN_NAME: string }[]).map(r => r.COLUMN_NAME.toLowerCase()),
        );

        const fieldMap: [string, string | undefined][] = [
          ["WebsiteUrl",       website],
          ["Telephone",        phone],
          ["EmailAddress",     companyEmail],
          ["StreetAddress1",   streetAddress],
          ["Address",          streetAddress],
          ["City",             city],
          ["State",            state],
          ["Zip",              zip],
          ["Country",          country],
          ["SectorChoice",     industry],
          ["OwnershipTypeChoice", ownershipType],
          ["ContractorLicense",   licenseNumber],
        ];

        const sets: string[] = [];
        const req2 = pool.request().input("tid", msql.NVarChar, tid).input("cname", msql.NVarChar, cName);
        let pi = 0;
        for (const [col, val] of fieldMap) {
          if (!val || !liveCols.has(col.toLowerCase())) continue;
          const pname = `p${pi++}`;
          sets.push(`[${col}] = @${pname}`);
          req2.input(pname, msql.NVarChar, val.trim());
        }

        if (sets.length > 0) {
          // Upsert: update if a company record for this tenant already exists,
          // otherwise insert a minimal company row with the profile fields.
          const existing = await pool.request()
            .input("tid3", msql.NVarChar, tid)
            .query(`SELECT TOP 1 ID FROM core2.dbo.CRMCompany WHERE TenantID = @tid3`);

          if ((existing.recordset ?? []).length > 0) {
            await req2.query(`UPDATE core2.dbo.CRMCompany SET ${sets.join(", ")} WHERE TenantID = @tid`);
          } else if (liveCols.has("title") && liveCols.has("tenantid")) {
            await req2.query(`INSERT INTO core2.dbo.CRMCompany (TenantID, Title, ${sets.map(s => s.split(" =")[0]).join(", ")})
                              VALUES (@tid, @cname, ${Array.from({ length: pi }, (_, i) => `@p${i}`).join(", ")})`);
          }
          console.log(`[provision-tenant] wrote ${sets.length} profile field(s) to CRMCompany for ${tid}`);
        }
      }
    } catch (profileErr) {
      // Non-fatal — company profile fields are best-effort.
      console.warn(`[provision-tenant] company profile write skipped: ${String(profileErr).slice(0, 200)}`);
    }

    // Write Country to core2.dbo.Tenant if the table and column exist.
    if (country) {
      try {
        const { getPool, sql: msql } = await import("../lib/db.js");
        const pool = await getPool();
        const tenantColCheck = await pool.request()
          .input("tc", msql.NVarChar, "Tenant")
          .query(`SELECT 1 AS found FROM core2.INFORMATION_SCHEMA.TABLES
                  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @tc`);
        if ((tenantColCheck.recordset ?? []).length > 0) {
          const tCols = await pool.request()
            .input("tc2", msql.NVarChar, "Tenant")
            .query(`SELECT COLUMN_NAME FROM core2.INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @tc2`);
          const tLive = new Set(
            ((tCols.recordset ?? []) as { COLUMN_NAME: string }[]).map(r => r.COLUMN_NAME.toLowerCase()),
          );
          if (tLive.has("country") && tLive.has("tenantid")) {
            await pool.request()
              .input("tid4", msql.NVarChar, tid)
              .input("ctry", msql.NVarChar, country)
              .query(`UPDATE core2.dbo.Tenant SET [Country] = @ctry WHERE [TenantID] = @tid4`);
          }
        }
      } catch (tenantErr) {
        console.warn(`[provision-tenant] Tenant.Country write skipped: ${String(tenantErr).slice(0, 200)}`);
      }
    }

    let inviteSent = false; let inviteMessage = "";
    if (sendInvite) {
      const inv = await sendSetPasswordInvite({ tid, tenantLabel: cName, userGuid, email: aEmail, name: aName });
      inviteSent = inv.emailed; inviteMessage = inv.message ?? "";
    }

    // Record a sentinel job row so the tenant appears in "All Companies" even
    // before any data upload is run.
    try {
      await upsertOnboardingJob({
        uploadId:  uuidv4(),
        tenantId:  cName,
        fileName:  "(Provisioned)",
        status:    "provisioned",
        createdBy: rds.username,
        totalInserted: 0,
        totalErrors:   0,
      });
    } catch (dbErr) {
      console.warn("[provision-tenant] sentinel job insert failed (non-fatal):", String(dbErr));
    }

    console.log(`[provision-tenant] created tenant "${cName}" (${tid}) with admin ${aEmail}`);
    setAuditTarget(res, { entityType: "configuration", entityId: `tenant:${tid}`, entityName: cName });
    setTrustedAuditChanges(res, boundedAuditChanges([
      { FieldName: "Tenant name", OldValue: null, NewValue: cName },
      { FieldName: "Tenant GUID", OldValue: null, NewValue: tid },
      { FieldName: "Admin user GUID", OldValue: null, NewValue: userGuid },
      { FieldName: "Admin name", OldValue: null, NewValue: aName },
      { FieldName: "Admin email", OldValue: null, NewValue: aEmail },
    ], 5));
    res.json({ ok: true, tenantId: cName, tenantGuid: tid, adminGuid: userGuid, inviteSent, inviteMessage });
  } catch (e) {
    if (e instanceof StaffConflictError) { res.status(409).json({ error: e.message }); return; }
    console.error("[provision-tenant] error:", String(e));
    res.status(502).json({ error: "Failed to provision tenant", detail: String(e) });
  }
});

// POST /restore-admin — superadmin only. Re-creates or restores an admin
// account that was wiped by a "replace all data" import.
router.post("/restore-admin", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    if (!isSuperAdminSource(rds)) { res.status(403).json({ error: "superadmin access required" }); return; }
    const { tenant, username } = req.body as { tenant?: string; username?: string };
    if (!tenant || !username) { res.status(400).json({ error: "tenant and username are required" }); return; }
    const result = await restoreAdminUser(tenant.trim(), username.trim());
    if (!result.ok) { res.status(502).json({ error: result.message }); return; }
    setAuditTarget(res, {
      entityType: "configuration",
      entityId: `tenant:${resolveTenantId(tenant.trim())}:admin`,
      entityName: "Restore tenant admin",
    });
    setTrustedAuditChanges(res, [{
      FieldName: "Admin restore status",
      OldValue: null,
      NewValue: result.message,
    }]);
    res.json({ ok: true, message: result.message });
  } catch (e) {
    res.status(502).json({ error: "Failed to restore admin", detail: String(e) });
  }
});

// GET /diag/roles — superadmin diagnostic: raw Roles row counts + sample.
router.get("/diag/roles", async (req: Request, res: Response) => {
  const diagSrc = resolveRequestSource(req);
  if (!diagSrc || !isSuperAdminSource(diagSrc)) {
    res.status(403).json({ error: "forbidden" }); return;
  }
  try {
    const { getPool, sql: msql } = await import("../lib/db.js");
    const pool = await getPool();
    const tenant = String(req.query.tenant ?? "").trim();
    const byTenant = await pool.request().query(
      "SELECT TenantID, COUNT(*) cnt, " +
      "COUNT(CASE WHEN Deleted=0 THEN 1 END) del0, " +
      "COUNT(CASE WHEN Deleted IS NULL THEN 1 END) delNull, " +
      "COUNT(CASE WHEN Deleted=1 THEN 1 END) del1 " +
      "FROM core2.dbo.Roles GROUP BY TenantID"
    );
    let sample: unknown[] = [];
    if (tenant) {
      const r = await pool.request()
        .input("tid", msql.NVarChar, tenant)
        .query("SELECT TOP 5 Id, Name, Deleted, BillingRate, EmpLaborRate, EmpCostRate FROM core2.dbo.Roles WHERE TenantID=@tid ORDER BY Name");
      sample = r.recordset;
    }
    res.json({ byTenant: byTenant.recordset, sample });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /rate-card/download ────────────────────────────────────────────────
// Returns a pre-filled Excel workbook: Instructions tab + Rate Card tab.
// Columns: Division (user fills) | Department (user fills) | Role | Job Title |
//          Type | Billing Rate | Labor Rate | Cost Rate | Role ID (locked).
// All current rates are pre-filled from core2.dbo.Roles.
router.get("/rate-card/download", async (req: Request, res: Response) => {
  try {
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const tid = rds.tid;

    const [rates, jtDeptMap, validDeptsRaw] = await Promise.all([
      roleBillingRatesRds(tid),
      rateCardDeptMapRds(tid),
      departmentsRds(tid),
    ]);
    // Build a set of valid (non-deleted) department names — used to suppress
    // deleted depts (e.g. "test6") that may still be referenced by stale FKs.
    const validDeptNames = new Set<string>(
      (validDeptsRaw as Record<string, unknown>[])
        .map(d => String(d.Title ?? d.Name ?? "").trim().toLowerCase())
        .filter(Boolean)
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = "RM ONE Rate Card";
    wb.created = new Date();

    // ── Tab 1: Instructions ──────────────────────────────────────────────────
    const iw = wb.addWorksheet("Instructions");
    iw.getColumn(1).width = 110;
    const NAVY_I = "FF1E3A5F";
    const addInstr = (text: string, bold = false, size = 11, color = "FF000000") => {
      const row = iw.addRow([text]);
      row.getCell(1).font = { bold, size, color: { argb: color } };
      row.getCell(1).alignment = { wrapText: true, vertical: "top" };
      row.height = bold && size >= 13 ? 26 : 18;
    };
    addInstr("RM ONE Rate Card — How To Use", true, 14, NAVY_I);
    addInstr("");
    addInstr("PURPOSE", true, 11, NAVY_I);
    addInstr("This file lets you view and update cost and billing rates for all roles in your organization in bulk, " +
      "instead of editing each row one by one on the Rate Card screen.");
    addInstr("");
    addInstr("COLUMN GUIDE", true, 11, NAVY_I);
    addInstr("Division          (Column A) — Pre-filled from your organization's data. Use to filter rows by division " +
      "(e.g. Infrastructure, Buildings). For filtering only — not saved to the system.");
    addInstr("Department        (Column B) — Pre-filled from your organization's data. Use to filter rows by department " +
      "(e.g. Engineering, Architecture). For filtering only — not saved to the system.");
    addInstr("Role              (Column C) — The billing role name as configured in RM ONE. Do NOT edit.");
    addInstr("Billing Rate $/hr (Column D) — ★ EDIT THIS. The client-facing hourly charge-out rate for this role.");
    addInstr("Labor Rate $/hr   (Column E) — ★ EDIT THIS. Internal hourly labour rate (what the employee earns per hour).");
    addInstr("Cost Rate $/hr    (Column F) — ★ EDIT THIS. Internal burden / fully-loaded cost rate for this role.");
    addInstr("Role ID           (Column G, hidden) — System identifier. Do NOT edit or delete — used for import matching.");
    addInstr("");
    addInstr("DIVISION & DEPARTMENT — PRE-FILLED FOR YOU", true, 11, NAVY_I);
    addInstr("Division and Department are already filled in from your organization's data. " +
      "Use Excel's filter arrows in the header row to filter by Division or Department. " +
      "You can clear or change either column freely — these columns are for filtering only and are never saved during import.");
    addInstr("");
    addInstr("HOW TO EDIT RATES", true, 11, NAVY_I);
    addInstr("Step 1 — Division and Department are pre-filled. Use the filter dropdowns in the header to show only the rows you need.");
    addInstr("Step 2 — Use Excel's built-in filter (click the dropdown arrows in the header row) to filter by " +
      "Division or Department so you only see the rows you want.");
    addInstr("Step 3 — Edit Billing Rate (E), Labor Rate (F), and/or Cost Rate (G) for the roles you want to update. " +
      "Leave a cell blank to leave that rate unchanged.");
    addInstr("Step 4 — Save the file (keep as .xlsx).");
    addInstr("Step 5 — In RM ONE, go to Configuration → Import Data → Billing Rates → Upload.");
    addInstr("");
    addInstr("IMPORTANT NOTES", true, 11, NAVY_I);
    addInstr("• Rates are stored at the Role level. Every Job Title within the same Role shares the same rates.");
    addInstr("• Do NOT add, remove, or reorder columns — the import reads columns by header name.");
    addInstr("• The Role ID column (H) is hidden but must stay in the file; it is the match key used on import.");
    addInstr("• Rows with blank Role ID will be skipped during import.");
    addInstr("• Only rows where at least one rate cell is filled will be saved during import.");

    // ── Tab 2: Rate Card data ────────────────────────────────────────────────
    const ws = wb.addWorksheet("Rate Card");
    const NAVY   = "FF1E3A5F";
    const WHITE  = "FFFFFFFF";
    const BLUE_L = "FFD6E4F7";
    const GRN_L  = "FFE6F4D7";
    const ALT    = "FFF7F7F7";
    const GRAY_T = "FF999999";

    // Columns: Job Title removed (rates are per-role; title is not needed);
    //          Role ID moved to col G and will be hidden.
    const COLS = [
      { header: "Division",            width: 22 },  // A
      { header: "Department",          width: 22 },  // B
      { header: "Role",                width: 28 },  // C
      { header: "Billing Rate ($/hr)", width: 18 },  // D
      { header: "Labor Rate ($/hr)",   width: 18 },  // E
      { header: "Cost Rate ($/hr)",    width: 18 },  // F
      { header: "Role ID",             width:  3 },  // G — hidden match key
    ];
    COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });
    ws.getColumn(7).hidden = true; // Hide Role ID — still present for import

    const hRow = ws.addRow(COLS.map(c => c.header));
    hRow.height = 22;
    hRow.eachCell((cell, colNum) => {
      const isDivDept = colNum <= 2;
      cell.font      = { bold: true, color: { argb: isDivDept ? "FF1E3A5F" : WHITE }, size: 11 };
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: isDivDept ? BLUE_L : NAVY } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border    = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
    });
    // Add tooltip hints on Division and Department headers
    (ws.getRow(1).getCell(1) as any).note = "Fill Division OR Department — not both. For filtering only; not saved during import.";
    (ws.getRow(1).getCell(2) as any).note = "Fill Division OR Department — not both. For filtering only; not saved during import.";

    ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 6 } }; // exclude hidden Role ID

    // ── Collect all data rows, then sort by Department so same-dept rows sit together
    // One row per unique dept the role appears in (from staff assignments).
    // Deleted departments are suppressed via validDeptNames — they fall through
    // to Company-wide so they don't appear as phantom department rows.
    type DataRow = {
      dept: string; div: string;
      roleName: string; roleId: string;
      billingRate: number | string; laborRate: number | string; costRate: number | string;
    };
    const allDataRows: DataRow[] = [];
    for (const role of rates) {
      if (role.id.startsWith("unmatched:")) continue;
      const rawEntries = jtDeptMap.get(role.id.toLowerCase()) ?? [];
      // Filter to valid (non-deleted) depts; remap deleted ones to blank (Company-wide)
      type RowEntry = { dept: string; div: string };
      let rowEntries: RowEntry[];
      if (rawEntries.length > 0) {
        const validEntries = rawEntries
          .map(e => ({
            dept: validDeptNames.has(e.dept.toLowerCase()) ? e.dept : "",
            div:  e.div,
          }));
        // Dedup after remapping (several deleted-dept entries collapse to blank)
        const seen = new Set<string>();
        rowEntries = validEntries.filter(e => {
          const key = `${e.div}::${e.dept}`.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      } else {
        rowEntries = [{ dept: "", div: "" }];
      }
      for (const entry of rowEntries) {
        allDataRows.push({
          dept: entry.dept, div: entry.div,
          roleName: role.name, roleId: role.id,
          billingRate: role.billingRate != null ? role.billingRate : "",
          laborRate:   role.laborRate   != null ? role.laborRate   : "",
          costRate:    role.costRate    != null ? role.costRate    : "",
        });
      }
    }
    // Sort: blank dept last, then alphabetically by dept, then by role name
    allDataRows.sort((a, b) => {
      if (!a.dept && b.dept) return 1;
      if (a.dept && !b.dept) return -1;
      const deptCmp = a.dept.localeCompare(b.dept, undefined, { sensitivity: "base" });
      if (deptCmp !== 0) return deptCmp;
      return a.roleName.localeCompare(b.roleName, undefined, { sensitivity: "base" });
    });

    let ri = 0;
    const MAX_DATA_ROW = 300;
    let lastDept = "__INIT__";
    for (const row of allDataRows) {
      const isCompanyWide = !row.dept && !row.div;
      const displayDept   = row.dept || (isCompanyWide ? "Company-wide" : "");
      const displayDiv    = row.div  || "";

      // Insert a subtle separator row when transitioning to the company-wide group
      if (isCompanyWide && lastDept !== "" && lastDept !== "__INIT__") {
        const sepRow = ws.addRow(["", "", "", "", "", "", ""]);
        sepRow.height = 6;
        sepRow.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
        });
      }
      lastDept = row.dept;

      const isAlt = ri % 2 === 1;
      const dataRow = ws.addRow([
        displayDiv,      // A Division (pre-filled or blank)
        displayDept,     // B Department (pre-filled; "Company-wide" when unassigned)
        row.roleName,    // C Role
        row.billingRate, // D
        row.laborRate,   // E
        row.costRate,    // F
        row.roleId,      // G Role ID (hidden)
      ]);
      dataRow.height = 18;
      dataRow.eachCell({ includeEmpty: true }, (cell, col) => {
        const isDivDept = col <= 2;
        const isRate    = col >= 4 && col <= 6;
        const isRoleId  = col === 7;
        cell.fill = { type: "pattern", pattern: "solid",
          fgColor: { argb: isDivDept ? BLUE_L : isRate ? GRN_L : isAlt ? ALT : WHITE } };
        // Gray italic for "Company-wide" label so it's visually distinct
        if (isDivDept && isCompanyWide && col === 2) {
          cell.font = { size: 10, italic: true, color: { argb: "FF888888" } };
        } else {
          cell.font = { size: 10, color: { argb: isRoleId ? "FFFFFFFF" : "FF000000" } };
        }
        cell.alignment = { vertical: "middle", horizontal: isRate ? "right" : "left" };
        if (isRate && typeof cell.value === "number") cell.numFmt = "#,##0.00";
      });
      ri++;
    }

    if (ri === 0) {
      // No roles yet — add a placeholder row so the template is still useful
      const plRow = ws.addRow(["", "", "(No roles configured yet — add roles in RM ONE first)", "", "", "", ""]);
      plRow.height = 18;
      plRow.getCell(3).font = { italic: true, size: 10, color: { argb: "FF999999" } };
    }

    // ── Data validation and conditional formatting only apply when data rows exist
    if (ri > 0) {
      const lastRow = Math.min(ri + 1, MAX_DATA_ROW);

      // "stop" style means Excel rejects the entry entirely — the dialog shows
      // "Retry" (no misleading "Yes" button) so users must clear one cell first.
      const mutualExclusionRule = (r: number) => ({
        type: "custom" as const,
        formulae: [`=NOT(AND($A${r}<>"",$B${r}<>""))`],
        showErrorMessage: true,
        errorStyle: "stop" as const,
        errorTitle: "Use Division OR Department — not both",
        error: "Both Division and Department are filled in this row. Clear one of them first — use Division (A) for broad filtering or Department (B) for detailed filtering.",
        showInputMessage: true,
        promptTitle: "Division / Department — pick one",
        prompt: "Fill Division (A) OR Department (B) to filter this row — not both.",
      });
      for (let r = 2; r <= lastRow; r++) {
        ws.getCell(`A${r}`).dataValidation = mutualExclusionRule(r);
        ws.getCell(`B${r}`).dataValidation = mutualExclusionRule(r);
      }

      // ── Conditional formatting: amber highlight when both A and B are filled ─
      const AMBER = "FFFFF3CD";
      const AMBER_BORDER = "FFBF9A30";
      ws.addConditionalFormatting({
        ref: `A2:B${lastRow}`,
        rules: [{
          type: "expression",
          formulae: [`AND($A2<>"",$B2<>"")`],
          style: {
            fill: { type: "pattern", pattern: "solid", fgColor: { argb: AMBER } },
            font: { color: { argb: AMBER_BORDER }, bold: true },
            border: { bottom: { style: "thin", color: { argb: AMBER_BORDER } } },
          },
          priority: 1,
        }],
      });
    }

    // Legend row at the bottom
    ws.addRow([]);
    const legRow = ws.addRow([
      "★ Blue = Division / Department (fill ONE for filtering — amber warning if both filled)",
      "", "",
      "★ Green = edit rates here", "", "", "",
    ]);
    legRow.getCell(1).font = { italic: true, size: 9, color: { argb: "FF555555" } };
    legRow.getCell(4).font = { italic: true, size: 9, color: { argb: "FF555555" } };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="rmone_rate_card.xlsx"');
    return res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Rate Card import — shared helpers ──────────────────────────────────────
// One intended write parsed from the uploaded workbook (or sent back from the
// review popup via /rate-card/apply). roleId "" means the role doesn't exist
// yet — it is auto-created only at APPLY time, so previewing/cancelling an
// upload leaves absolutely nothing behind.
type RateCardWrite = {
  roleName: string; roleId: string; deptId: string; deptName: string;
  billing: number | null; labor: number | null; cost: number | null;
};

// Thrown for user-fixable file problems → surfaced as HTTP 400, not 500.
class RateCardFileError extends Error {}

const sameRate = (a: number | null, b: number | null) =>
  (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 0.005);

// Parse the uploaded Rate Card workbook into raw rows. Read-only: never
// creates roles or writes rates.
async function parseRateCardUpload(tid: string, buffer: Buffer): Promise<{
  rows: RateCardWrite[]; skipped: number; errors: string[]; warnings: string[];
  allRates: { id: string; name: string; billingRate: number | null; laborRate: number | null; costRate: number | null }[];
}> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);

  const ws = wb.getWorksheet("Rate Card") ?? wb.worksheets.find(s => s.name !== "Instructions");
  if (!ws) throw new RateCardFileError("Could not find a Rate Card tab in the uploaded file");

  // Map header names → column index. ExcelJS may store cell values as
  // CellRichTextValue objects ({richText:[{text:"..."}]}) when cells have
  // inline formatting — String() on those produces "[object Object]".
  const cellText = (v: ExcelJS.CellValue): string => {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "object" && "richText" in (v as object)) {
      return (v as ExcelJS.CellRichTextValue).richText.map(r => r.text ?? "").join("");
    }
    return String(v);
  };
  // Header matching is synonym-tolerant: clients upload their OWN rate
  // sheets ("Roles", "Billing Rate", "Cost Rate") at least as often as the
  // template downloaded from this page ("Role", "Billing Rate ($/hr)", …).
  // Normalize by dropping parentheticals ("($/hr)") and non-alphanumerics,
  // then match against synonym lists. NOTE: "Job Title" is deliberately NOT
  // a role synonym — job titles are a separate entity (cost rates) and must
  // never be conflated with billing roles.
  const normHeader = (s: string) =>
    s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");
  const HEADER_SYNONYMS: Record<string, string[]> = {
    role:    ["role", "roles", "rolename", "roletitle", "jobrole"],
    roleId:  ["roleid"],
    dept:    ["department", "departments", "dept"],
    billing: ["billingrate", "billingrates", "billrate", "billing"],
    labor:   ["laborrate", "laborrates", "labourrate", "labor", "labour"],
    cost:    ["costrate", "costrates", "cost", "empcostrate"],
  };
  // The header row is usually row 1, but client sheets sometimes carry a
  // title/banner row above it — scan the first 10 rows for the first row
  // that contains a recognizable role column and treat it as the header.
  let headerRowNum = 0;
  const cols: Record<string, number> = {};
  for (let hr = 1; hr <= Math.min(10, ws.rowCount) && !headerRowNum; hr++) {
    const found: Record<string, number> = {};
    ws.getRow(hr).eachCell((cell, col) => {
      const key = normHeader(cellText(cell.value).trim());
      if (!key) return;
      for (const [canon, syns] of Object.entries(HEADER_SYNONYMS)) {
        if (syns.includes(key) && !(canon in found)) found[canon] = col;
      }
    });
    if (found.role || found.roleId) {
      headerRowNum = hr;
      Object.assign(cols, found);
    }
  }
  const roleCol    = cols.role;
  const roleIdCol  = cols.roleId;
  const deptCol    = cols.dept;
  const billingCol = cols.billing;
  const laborCol   = cols.labor;
  const costCol    = cols.cost;

  if (!headerRowNum) {
    // Tell the user what we DID see so they can fix their sheet.
    const seen: string[] = [];
    ws.getRow(1).eachCell((cell) => {
      const t = cellText(cell.value).trim();
      if (t) seen.push(t);
    });
    throw new RateCardFileError(
      `Cannot find a role column — expected a header like "Role" or "Roles"` +
      (seen.length ? ` (your file's first row has: ${seen.slice(0, 12).join(", ")})` : "") +
      `. You can also use the template downloaded from this page.`,
    );
  }

  // Pre-load roles + departments for matching
  const [allRates, allDepts] = await Promise.all([
    roleBillingRatesRds(tid),
    departmentsRds(tid),
  ]);
  const roleByName = new Map(allRates.map(r => [r.name.toLowerCase().trim(), r.id]));
  // dept name → { id, name } (case-insensitive; skip "Company-wide" sentinel)
  const deptByName = new Map<string, { id: string; name: string }>();
  for (const d of allDepts as Record<string, unknown>[]) {
    const name = String(d.Title ?? d.Name ?? "").trim();
    const id   = String(d.ID ?? d.Id ?? "").trim();
    if (name && id && name.toLowerCase() !== "company-wide") deptByName.set(name.toLowerCase(), { id, name });
  }

  const getStr = (row: ExcelJS.Row, col?: number) =>
    col ? String(row.getCell(col).value ?? "").trim() : "";
  const getNum = (row: ExcelJS.Row, col?: number): number | null => {
    if (!col) return null;
    const raw = row.getCell(col).value;
    if (raw == null || raw === "") return null;
    const n = parseFloat(String(raw).replace(/[,$\s]/g, ""));
    return isNaN(n) || n < 0 ? null : n;
  };

  let skipped = 0;
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: RateCardWrite[] = [];

  for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
    const row      = ws.getRow(r);
    const roleName = getStr(row, roleCol);
    let   roleId   = getStr(row, roleIdCol);

    // 1. Validate Role ID column
    if (roleId && roleId.startsWith("unmatched:")) roleId = "";
    if (roleId && !allRates.some(x => x.id.toLowerCase() === roleId.toLowerCase())) roleId = "";
    // 2. Name lookup (creation of unknown roles is deferred to apply time)
    if (!roleId && roleName) roleId = roleByName.get(roleName.toLowerCase()) ?? "";
    if (!roleId && !roleName) { skipped++; continue; }

    const rawDept   = getStr(row, deptCol);
    // "Company-wide" is what the template writes; the page's dropdown shows
    // "Company-wide (default)" — accept both (prefix match).
    const isCompany = !rawDept || rawDept.toLowerCase().startsWith("company-wide");
    const deptMatch = isCompany ? undefined : deptByName.get(rawDept.toLowerCase());
    const billing   = getNum(row, billingCol);
    const labor     = getNum(row, laborCol);
    const cost      = getNum(row, costCol);

    if (billing == null && labor == null && cost == null) { skipped++; continue; }
    if (!isCompany && !deptMatch) {
      warnings.push(`Row ${r}: department "${rawDept}" was not found — the rate for "${roleName || roleId}" was treated as company-wide.`);
    }
    rows.push({
      roleName, roleId,
      deptId: deptMatch?.id ?? "",
      deptName: deptMatch?.name ?? "",
      billing, labor, cost,
    });
  }

  return { rows, skipped, errors, warnings, allRates };
}

// Merge duplicate rows (same role + same scope) with a consistent
// last-row-wins-per-field rule, warning when the duplicates disagreed.
// (Previously company-wide rows kept the LAST duplicate while department rows
// silently kept the FIRST — this makes both consistent and visible.)
function dedupeRateCardWrites(rows: RateCardWrite[]): { writes: RateCardWrite[]; warnings: string[] } {
  const map = new Map<string, RateCardWrite>();
  const order: string[] = [];
  const warned = new Set<string>();
  const warnings: string[] = [];
  for (const p of rows) {
    const key = `${p.roleId || `name:${p.roleName.toLowerCase().trim()}`}::${p.deptId}`;
    const w = map.get(key);
    if (!w) { map.set(key, { ...p }); order.push(key); continue; }
    for (const f of ["billing", "labor", "cost"] as const) {
      const v = p[f];
      if (v == null) continue;
      if (w[f] != null && !sameRate(w[f], v) && !warned.has(key)) {
        warned.add(key);
        warnings.push(`"${p.roleName || w.roleName}" (${p.deptName || "Company-wide"}) appears more than once in the file with different rates — the last row was used.`);
      }
      w[f] = v;
    }
  }
  return { writes: order.map(k => map.get(k)!), warnings };
}

// Execute a set of rate writes: auto-create missing roles, then one batch SQL
// for company-wide rates + parallel per-dept upserts (deduped so the same
// role+dept never races itself).
async function applyRateCardWrites(tid: string, writes: RateCardWrite[]): Promise<{ saved: number; created: number; errors: string[] }> {
  const errors: string[] = [];
  let created = 0;
  if (!writes.length) return { saved: 0, created: 0, errors };

  // Resolve or auto-create roles for rows that arrived without a role id.
  const allRates = await roleBillingRatesRds(tid);
  const roleByName = new Map(allRates.map(r => [r.name.toLowerCase().trim(), r.id]));
  const validIds = new Set(allRates.map(r => r.id.toLowerCase()));
  const resolved: RateCardWrite[] = [];
  for (const w of writes) {
    let roleId = w.roleId;
    if (roleId && !validIds.has(roleId.toLowerCase())) roleId = "";
    if (!roleId && w.roleName) roleId = roleByName.get(w.roleName.toLowerCase().trim()) ?? "";
    if (!roleId && w.roleName) {
      try {
        const newRole = await createRoleRds(tid, w.roleName);
        roleId = newRole.id;
        roleByName.set(w.roleName.toLowerCase().trim(), roleId);
        validIds.add(roleId.toLowerCase());
        created++;
      } catch (e: any) {
        errors.push(`Could not create role "${w.roleName}": ${e.message}`);
        continue;
      }
    }
    if (!roleId) continue;
    resolved.push({ ...w, roleId });
  }

  // Split company-wide vs dept-specific, merging per key (last write wins per
  // field — name-resolved rows can collapse onto id-carrying rows here).
  const cwMap = new Map<string, { billing?: number | null; labor?: number | null; cost?: number | null }>();
  type DeptRates = { billingRate?: number | null; laborRate?: number | null; costRate?: number | null };
  const deptMap = new Map<string, { roleId: string; deptId: string; roleName: string; rates: DeptRates }>();
  const deptOrder: string[] = [];
  for (const p of resolved) {
    if (p.deptId) {
      const key = `${p.roleId}::${p.deptId}`;
      let d = deptMap.get(key);
      if (!d) { d = { roleId: p.roleId, deptId: p.deptId, roleName: p.roleName, rates: {} }; deptMap.set(key, d); deptOrder.push(key); }
      if (p.billing != null) d.rates.billingRate = p.billing;
      if (p.labor   != null) d.rates.laborRate   = p.labor;
      if (p.cost    != null) d.rates.costRate    = p.cost;
    } else {
      const ex = cwMap.get(p.roleId) ?? {};
      if (p.billing != null) ex.billing = p.billing;
      if (p.labor   != null) ex.labor   = p.labor;
      if (p.cost    != null) ex.cost    = p.cost;
      cwMap.set(p.roleId, ex);
    }
  }
  const deptWrites = deptOrder.map(k => deptMap.get(k)!);

  if (cwMap.size) {
    try {
      await batchUpdateRoleRatesRds(tid,
        [...cwMap.entries()].map(([roleId, v]) => ({ roleId, ...v })));
    } catch (e: any) {
      errors.push(`Company-wide batch update failed: ${e.message}`);
    }
  }

  const deptResults = await Promise.allSettled(
    deptWrites.map(d => updateRoleRatesByDeptRds(tid, d.roleId, d.deptId, d.rates)),
  );
  deptResults.forEach((r, i) => {
    if (r.status === "rejected")
      errors.push(`Dept row (${deptWrites[i].roleName}): ${(r.reason as Error)?.message}`);
  });

  const saved = cwMap.size + deptWrites.filter((_, i) => deptResults[i].status === "fulfilled").length;
  // Any write (or newly created role) invalidates the per-tenant rates cache.
  if (created > 0 || cwMap.size > 0 || deptWrites.length > 0) bustRoleRatesCache(tid);
  return { saved, created, errors };
}

// ── POST /rate-card/import ─────────────────────────────────────────────────
// Accepts the downloaded Rate Card xlsx back, reads Billing Rate / Labor Rate /
// Cost Rate columns, matches rows by Role ID or Role name, and updates
// core2.dbo.Roles (+ RoleBillingRateByDept) for the authenticated tenant.
//
// mode=preview (form field): parses and classifies every row against the
// currently-saved rates WITHOUT writing anything:
//   "new"       — no stored rate at this scope yet (applied silently later)
//   "unchanged" — identical to what's already stored
//   "conflict"  — same role + same scope but a DIFFERENT rate → the frontend
//                 shows a per-row include/skip decision popup, then posts the
//                 approved rows to /rate-card/apply.
// Without mode=preview the old single-shot behavior is preserved.
router.post("/rate-card/import", _rcUpload.single("file"), async (req: Request, res: Response) => {
  try {
    // Rates are financial data — the financial gate alone, matching
    // /role-billing-rate (#87), so a financial-only custom level can use the
    // rate card. Covers the preview pass and the legacy single-shot write,
    // and handles deleted/disabled identities itself.
    if (await blockIfFinancialRestricted(req, res, [{ FieldName: "BillingRate" }])) return;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const tid = rds.tid;

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }

    const mode = String((req.body as Record<string, unknown> | undefined)?.mode ?? req.query.mode ?? "").toLowerCase();

    const { rows, skipped, errors, warnings, allRates } = await parseRateCardUpload(tid, file.buffer);
    const { writes, warnings: dupWarnings } = dedupeRateCardWrites(rows);
    const allWarnings = [...warnings, ...dupWarnings];

    if (mode === "preview") {
      // Compare each intended write against what is stored at the SAME scope.
      const cwById = new Map(allRates.map(r => [r.id.toLowerCase(), r]));
      const deptIds = [...new Set(writes.filter(w => w.deptId).map(w => w.deptId))];
      const deptMaps = new Map<string, Map<string, { billingRate: number | null; laborRate: number | null; costRate: number | null }>>();
      await Promise.all(deptIds.map(async (dId) => {
        const list = await roleBillingRatesByDeptRds(tid, dId);
        // billingRate/laborRate/costRate here are the EXPLICIT dept overrides
        // (null when the role only inherits the company-wide default) — a new
        // override where none existed is "new", not a conflict.
        deptMaps.set(dId, new Map(list.map(r => [r.id.toLowerCase(), { billingRate: r.billingRate, laborRate: r.laborRate, costRate: r.costRate }])));
      }));

      const classified = writes.map((w, idx) => {
        const exRow = !w.roleId
          ? undefined
          : w.deptId
            ? deptMaps.get(w.deptId)?.get(w.roleId.toLowerCase())
            : cwById.get(w.roleId.toLowerCase());
        const existing = exRow
          ? { billing: exRow.billingRate ?? null, labor: exRow.laborRate ?? null, cost: exRow.costRate ?? null }
          : null;
        const conflictFields: ("billing" | "labor" | "cost")[] = [];
        let hasNew = false, hasSame = false;
        for (const f of ["billing", "labor", "cost"] as const) {
          const inc = w[f];
          if (inc == null) continue;
          const ex = existing ? existing[f] : null;
          if (ex == null) hasNew = true;
          else if (sameRate(inc, ex)) hasSame = true;
          else conflictFields.push(f);
        }
        const status = conflictFields.length ? "conflict" : hasNew ? "new" : hasSame ? "unchanged" : "new";
        return {
          idx,
          roleName: w.roleName,
          roleId: w.roleId,
          deptId: w.deptId,
          deptName: w.deptName,
          scope: w.deptName || "Company-wide",
          isNewRole: !w.roleId,
          incoming: { billing: w.billing, labor: w.labor, cost: w.cost },
          existing,
          status,
          conflictFields,
        };
      });
      const newRoles = [...new Set(writes.filter(w => !w.roleId && w.roleName).map(w => w.roleName))];
      return res.json({ preview: true, rows: classified, skipped, newRoles, warnings: allWarnings, errors });
    }

    // Legacy single-shot path (no preview): parse → dedupe → write.
    const auditBefore = new Map(allRates.map((x) => [x.id.toLowerCase(), x]));
    const r = await applyRateCardWrites(tid, writes);
    setAuditTarget(res, { entityType: "configuration", entityId: "rate-card", entityName: "Rate card import" });
    try {
      const after = await roleBillingRatesRds(tid);
      const afterMap = new Map(after.map((x) => [x.id.toLowerCase(), x]));
      const changes = writes.flatMap((w) => {
        if (!w.roleId || w.deptId) return [];
        const before = auditBefore.get(w.roleId.toLowerCase());
        const saved = afterMap.get(w.roleId.toLowerCase());
        if (!saved) return [];
        return trustedAuditDiff(
          { BillingRate: before?.billingRate, LaborRate: before?.laborRate, CostRate: before?.costRate },
          { BillingRate: saved.billingRate, LaborRate: saved.laborRate, CostRate: saved.costRate },
          { prefix: w.roleName },
        );
      });
      setTrustedAuditChanges(res, boundedAuditChanges(changes, changes.length));
    } catch { /* audit best-effort */ }
    return res.json({ saved: r.saved, created: r.created, skipped, errors: [...errors, ...allWarnings, ...r.errors] });
  } catch (e: any) {
    if (e instanceof RateCardFileError) return res.status(400).json({ error: e.message });
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /rate-card/apply ──────────────────────────────────────────────────
// Second phase of the reviewed upload: receives the rows the user approved in
// the conflict popup (plus all non-conflicting rows) and writes them. Rows are
// re-validated server-side — unknown departments are rejected, unknown role
// ids fall back to name matching / creation, and duplicates are re-merged.
router.post("/rate-card/apply", async (req: Request, res: Response) => {
  try {
    // Rates are financial data — the financial gate alone, matching
    // /role-billing-rate (#87), so a financial-only custom level can use the
    // rate card. Handles deleted/disabled identities itself.
    if (await blockIfFinancialRestricted(req, res, [{ FieldName: "BillingRate" }])) return;
    const rds = resolveRequestSource(req);
    if (!rds) { res.status(401).json({ error: "unauthorized" }); return; }
    const tid = rds.tid;

    const rawRows = (req.body as Record<string, unknown> | undefined)?.rows;
    if (!Array.isArray(rawRows)) { res.status(400).json({ error: "rows array is required" }); return; }
    if (rawRows.length > 5000) { res.status(400).json({ error: "Too many rows (max 5000)" }); return; }

    const num = (v: unknown): number | null => {
      if (v == null || v === "") return null;
      const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,$\s]/g, ""));
      return Number.isFinite(n) && n >= 0 ? n : null;
    };

    const allDepts = await departmentsRds(tid);
    const validDeptIds = new Set(
      (allDepts as Record<string, unknown>[])
        .map(d => String(d.ID ?? d.Id ?? "").trim().toLowerCase())
        .filter(Boolean),
    );

    const errors: string[] = [];
    const rows: RateCardWrite[] = [];
    for (const raw of rawRows as Record<string, unknown>[]) {
      const roleName = String(raw?.roleName ?? "").trim().slice(0, 200);
      const roleId   = String(raw?.roleId ?? "").trim();
      const deptId   = String(raw?.deptId ?? "").trim();
      const deptName = String(raw?.deptName ?? "").trim().slice(0, 200);
      if (!roleId && !roleName) continue;
      if (deptId && !validDeptIds.has(deptId.toLowerCase())) {
        errors.push(`Skipped "${roleName || roleId}" — unknown department scope.`);
        continue;
      }
      const billing = num(raw?.billing), labor = num(raw?.labor), cost = num(raw?.cost);
      if (billing == null && labor == null && cost == null) continue;
      rows.push({ roleName, roleId, deptId, deptName, billing, labor, cost });
    }

    const { writes, warnings } = dedupeRateCardWrites(rows);
    let auditBefore: Awaited<ReturnType<typeof roleBillingRatesRds>> = [];
    try { auditBefore = await roleBillingRatesRds(tid); } catch { /* audit best-effort */ }
    const r = await applyRateCardWrites(tid, writes);
    setAuditTarget(res, { entityType: "configuration", entityId: "rate-card", entityName: "Rate card apply" });
    try {
      const after = await roleBillingRatesRds(tid);
      const beforeMap = new Map(auditBefore.map((x) => [x.id.toLowerCase(), x]));
      const afterMap = new Map(after.map((x) => [x.id.toLowerCase(), x]));
      const changes = writes.flatMap((w) => {
        if (!w.roleId || w.deptId) return [];
        const before = beforeMap.get(w.roleId.toLowerCase());
        const saved = afterMap.get(w.roleId.toLowerCase());
        if (!saved) return [];
        return trustedAuditDiff(
          { BillingRate: before?.billingRate, LaborRate: before?.laborRate, CostRate: before?.costRate },
          { BillingRate: saved.billingRate, LaborRate: saved.laborRate, CostRate: saved.costRate },
          { prefix: w.roleName },
        );
      });
      setTrustedAuditChanges(res, boundedAuditChanges(changes, changes.length));
    } catch { /* audit best-effort */ }
    return res.json({ saved: r.saved, created: r.created, errors: [...errors, ...warnings, ...r.errors] });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export async function warmCacheOnStartup() {
  // Pre-establish the SQL Server connection pool right after the server starts
  // so the first authenticated user request hits a warm pool instead of waiting
  // 30-60s for a cold connect. getPool() is idempotent and single-flighted, so
  // this races harmlessly with any concurrent first request.
  // Runs in EVERY cluster worker: each worker has its own pool, its own
  // heartbeat and its own in-memory caches, so all of them must warm up.
  if (!isConfigured()) {
    console.log("[startup-warmer] APP_DATABASE_URL not set — skipping pool warm");
    return;
  }
  console.log("[startup-warmer] pre-warming SQL Server connection pool…");
  getPool()
    .then(() => {
      console.log("[startup-warmer] pool ready ✓");
      // Start the keep-alive heartbeat AFTER the pool is established.
      // Runs SELECT 1 every 30 s so neither the mssql pool's idle timeout nor
      // AWS NAT gateway's TCP idle timeout (350 s) ever closes the connections.
      // Result: every user request — even after a long idle — hits a warm pool.
      startHeartbeat();
      console.log("[startup-warmer] heartbeat started (30 s interval)");

      // One-time schema ensure OFF the request path: the DivisionMultiLookup
      // bigint→NVARCHAR widen needs a Sch-M lock and once held a user's first
      // BU save for ~3 minutes. Run it here (idempotent — a fast SELECT once
      // the column is already text) so no user request ever pays for DDL.
      // Sequential to avoid concurrent DDL between tables.
      (async () => {
        for (const tbl of ["PMM", "Opportunity", "Lead"]) {
          await ensureDivisionMultiColumn(tbl).catch((e) =>
            console.warn(`[startup-warmer] DivisionMultiLookup ensure ${tbl} failed: ${String(e)}`));
        }
        // PMM.StatusManualDate (manual-reactivation latch): ensure at boot on
        // EVERY worker — the ALTER is a one-time no-op after the first run,
        // but the unconditional colCache bust inside is what matters here.
        // Without it a worker whose 10-min column cache was populated before
        // a sibling's ALTER silently drops the column from records payloads
        // AND skips the auto-close latch gate (live.has) — re-closing a
        // deliberately reactivated project.
        await ensureStatusManualColumn().catch((e) =>
          console.warn(`[startup-warmer] StatusManualDate ensure failed: ${String(e)}`));
      })();

      // Boot-time home-cache warm: a restart wipes the in-memory caches, so
      // without this the first login after a restart pays 30-45s of cold
      // queries. Warm every recently-active tenant (disk-persisted registry).
      //
      // STAGGERED, not simultaneous: previously every worker fired every
      // tenant's warm queries 2s after boot. On production deploys that
      // stampede (4 workers × N tenants × org-wide queries) spiked memory and
      // the container OOM-killed workers one after another (SIGKILL loop) —
      // taking any in-flight onboarding import down with them. Worker 0 still
      // starts immediately so the first login after a deploy stays instant;
      // later workers wait their turn, and tenants within a worker are spaced
      // a few seconds apart so only ~one tenant's query burst is in flight
      // per worker at a time.
      const bootWorkerId = Number(process.env["WORKER_ID"] ?? "0");
      // Dev workspace shares the SAME RDS as production. An Aug 2026 DMV
      // capture caught dev warm sweeps (boot + periodic, 13 tenants) stacking
      // 30+ concurrent tenant-wide queries onto prod's CPU-starved instance —
      // while nobody was even using dev. Dev never boot-warms now (any
      // worker, lead included) unless WARM_IN_DEV=1 is set for testing the
      // warm machinery itself; dev caches fill lazily on demand (SWR).
      const WARM_IN_DEV = process.env["WARM_IN_DEV"] === "1";
      // AWS EB environments (ENV_NAME set) run their OWN database copy and
      // must warm like production — only the local dev workspace, which
      // shares prod's RDS, skips. See lib/deploy-env.ts.
      const SKIP_BOOT_WARM =
        (!IS_DEPLOYED_SERVER && !WARM_IN_DEV) || BACKGROUND_PROFILE === "off";
      // Light profile (small nonprod EB instances): spread the boot sweep ~4×
      // wider so two workers never warm concurrently — see deploy-env.ts for
      // the 2026-08-27 t3.small wedge this prevents.
      const LIGHT_PROFILE = BACKGROUND_PROFILE === "light";
      const BOOT_WARM_WORKER_STAGGER_MS = LIGHT_PROFILE ? 180_000 : 45_000;
      const BOOT_WARM_TENANT_SPACING_MS = LIGHT_PROFILE ? 30_000 : 8_000;
      const scheduleBootWarm = (tid: string, tenant: string, idx: number) => {
        if (SKIP_BOOT_WARM) return;
        const delay = bootWorkerId * BOOT_WARM_WORKER_STAGGER_MS + idx * BOOT_WARM_TENANT_SPACING_MS;
        if (delay === 0) warmHomeCaches(tid, tenant);
        else setTimeout(() => warmHomeCaches(tid, tenant), delay);
      };
      loadActiveTenantsFromDisk();
      let bootWarmIdx = 0;
      for (const [tid, v] of activeTenants) scheduleBootWarm(tid, v.tenant, bootWarmIdx++);
      if (activeTenants.size) {
        console.log(SKIP_BOOT_WARM
          ? `[startup-warmer] worker ${bootWorkerId}: boot warm skipped (background profile ${BACKGROUND_PROFILE})`
          : `[startup-warmer] warming home caches for ${activeTenants.size} tenant(s) (staggered, worker ${bootWorkerId})…`);
      }

      // Durable copy: the DB registry survives production deploys (which wipe
      // the disk file). Merge it in and warm any tenants the disk didn't know
      // about — same staggered schedule, continuing after the disk batch.
      loadActiveTenantsFromDb()
        .then((added) => {
          for (const [tid, v] of added) scheduleBootWarm(tid, v.tenant, bootWarmIdx++);
          if (added.length && !SKIP_BOOT_WARM) console.log(`[startup-warmer] warming home caches for ${added.length} DB-registry tenant(s) (staggered)…`);
        })
        .catch((e) => console.warn(`[startup-warmer] DB registry warm failed: ${String(e)}`));

      // Periodic re-warm keeps those caches fresh around the clock (including
      // overnight), so the first login of the day is instant AND current.
      // Stagger the start per worker so workers don't fire identical query
      // bursts at the same moment.
      //
      // CADENCE IS WORKER-AWARE: only the lead worker sweeps every 10 min;
      // the rest sweep every 30 min. Every worker sweeping every tenant every
      // 10 min scales DB load linearly with vCPU count — the 8 GB VM upgrade
      // (2→4 workers) doubled the warm-query volume against RDS and saturated
      // it (July 2026 outage: pool acquire timeouts + 30 s connect failures on
      // BOTH the core2 and app pools). Non-lead caches go slightly staler
      // between sweeps; the SWR grace windows on the caches cover the gap.
      const workerId = Number(process.env["WORKER_ID"] ?? "0");
      // Dev workspace shares the SAME RDS instance as production — dev never
      // runs the re-warm scheduler (any worker) unless WARM_IN_DEV=1. See the
      // boot-warm comment above for the Aug 2026 DMV evidence.
      if ((!IS_DEPLOYED_SERVER && !WARM_IN_DEV) || BACKGROUND_PROFILE === "off") {
        console.log(`[startup-warmer] worker ${workerId}: re-warm scheduler disabled (background profile ${BACKGROUND_PROFILE})`);
      } else {
        const stagger = 60_000 + workerId * 60_000 + Math.floor(Math.random() * 30_000);
        // Lead sweeps every 10 min and adoptCache-shares the per-project
        // payloads it fetches, so sibling sweeps mostly find warm entries and
        // skip their own queries. Non-lead sweeps drop to hourly — they only
        // catch tenant-wide home caches whose TTLs lapsed between lead pushes.
        // Light profile: 6× slower (lead hourly, others six-hourly). A small
        // instance sweeping a prod-sized tenant set takes minutes per pass —
        // at the 10-min cadence the box never left mid-sweep (2026-08-27).
        const rewarmProfileScale = BACKGROUND_PROFILE === "light" ? 6 : 1;
        const rewarmEveryMs =
          (IS_LEAD_WORKER ? HOME_REWARM_INTERVAL_MS : HOME_REWARM_INTERVAL_MS * 6) * rewarmProfileScale;
        setTimeout(() => {
          void rewarmActiveTenants();
          setInterval(() => { void rewarmActiveTenants(); }, rewarmEveryMs);
        }, stagger);
        console.log(`[startup-warmer] home re-warm scheduler starts in ${Math.round(stagger / 1000)}s (every ${rewarmEveryMs / 60000} min, worker ${workerId})`);
      }
    })
    .catch(e => console.warn("[startup-warmer] pool warm failed (will retry on first request):", (e as Error).message));
}

export default router;
