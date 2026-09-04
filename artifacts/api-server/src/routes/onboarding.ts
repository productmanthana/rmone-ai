/**
 * Onboarding pipeline routes.
 * POST /api/onboarding/upload    — upload Excel → S3, return preview
 * POST /api/onboarding/run       — run full INSERT pipeline
 * GET  /api/onboarding/history   — list past uploads
 * GET  /api/onboarding/status/:id — job status
 * GET  /api/onboarding/errors/:id — download error CSV
 * GET  /api/onboarding/schema    — universal schema dictionary
 * GET  /api/onboarding/db-status — DB + S3 connection health
 */
import { Router } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import ExcelJS from "exceljs";
import { parseExcel, previewExcel } from "../lib/excel.js";
import { acquireImportSlot } from "../lib/importSlots.js";
import crypto from "crypto";
import {
  runPipeline, validateColumns, resolveTable, resolveTenantId,
  getSimplifiedTabType, resolveSimplifiedTab, analyzeSimplifiedColumns, SIMPLIFIED_CANONICAL_FIELDS,
  SIMPLIFIED_TEMPLATE_COLUMNS, SIMPLIFIED_TEMPLATE_ORDER, SIMPLIFIED_FIELD_LABELS, SIMPLIFIED_FIELD_HINTS, SIMPLIFIED_ALL_FIELD_HINTS, hashPassword,
  execInsert, execUpdate, guessTabType, normSynKey, TEMPLATE_HEADER_NORM_BY_TAB,
  checkSupplementalSchemaCompat,
  retryConstructionFields,
  dryRunValidate,
  preflightUploadChecks,
  ImportAbortedError,
  normIdentKey,
  createProjectShell,
  autoResolveAnsweredReviewItems,
} from "../lib/pipeline.js";
import type { ImportMode, PipelineProgress, SchemaIncompatibility, ConstructionRetryEntry, DryRunReport } from "../lib/pipeline.js";
import { llmMatchColumns, llmSuggestColumns } from "../lib/llm-column-match.js";
import {
  BUILTIN_ONBOARDING_DEFAULTS, sanitizeDefaults, mergeDefaults, parseProjectPhaseSets,
} from "../lib/onboarding-defaults.js";
import type { OnboardingDefaults } from "../lib/onboarding-defaults.js";
import { sanitizeDisplayDefaults } from "../lib/display-defaults.js";
import { safeRatio, resolveDataSource } from "../lib/data-quality.js";
import { invalidateBusinessRules } from "../lib/business-rules.js";
import { resolveOppStagesForViewer, resolveTemplateStageOrdersForViewer, viewerAudienceMembership } from "../lib/opp-stage-sets.js";
import { getRecords, getResourceAllocations, getResourceMasterRds, applyDefaultJobTitleToExistingRds, reconcileOppStagesRds, reconcileDefaultLifecyclePhasesRds, reconcileDefaultLifecyclesBySigRds, adoptDefaultLifecycleForBareOppsRds, resetDefaultLifecycleForNullPointerOppsRds, syncPhaseSetLifecyclesRds, reconcileAssumedScheduleDatesRds, tableColumns, getConfiguredStageOrder, getImportedDefaultsRds, bustStageRulesCache, bustStageOrderCache, stageRulesRecordScope, hasAssignedLifecycleScheduleRds, resolveLifecycleStageRuleModuleRds, detailFieldCatalog, createCompanyRds } from "../lib/rds-provider.js";
import type { AssumedDateItem } from "../lib/rds-provider.js";
import { normalizeCompanyTicketId, customCompanyIdProblem } from "../lib/company-store.js";
import { filterStagesByAudience, hasAnyStageAudiences, isOutcomeStageName, sanitizeStageRules, sanitizeWorkflowTemplates, STAGE_RULE_MODULES } from "../lib/stage-rules.js";
import { bustTaskDataCache, bustLifecyclesCache } from "./rmone-proxy.js";
import {
  sanitizeUserGroups, sanitizeAccessLevels, sanitizeStagePerms, sanitizeNavVisibility,
  USER_GROUPS_SCOPE_PREFIX, ACCESS_LEVELS_SCOPE_PREFIX, STAGE_PERMS_SCOPE_PREFIX, NAV_VISIBILITY_SCOPE_PREFIX,
  bustAccessControlCache, getCapsForAcl, getResolvedAccessCaps, isCustomAcl, getBuiltinOverrideCaps,
  getAclChangeEntry, recordAclChange, clearAclChangeEntry, getCustomLevelName,
} from "../lib/access-control.js";
import { bustAllProjectCaches, warmTenantCachesAfterImport, warmImportedProjectsAfterImport, bustExtraFieldsEverywhere, bustRoleRatesCache, bustFieldOptionsCache, bustStaffIdentityCaches } from "./rmone-proxy.js";
import { fetchAllTenantIds, fetchCompanyNames } from "./superadmin.js";
import {
  getAllSynonymMappings,
  getAllOnboardingJobsMeta,
  getRecentOnboardingJobsMeta,
  getOnboardingHistorySlim,
  getOnboardingHistorySlimByTenant,
  failOnboardingJobIfActive,
  getRunningOnboardingJobsMeta,
  getOnboardingJob,
  getOnboardingJobMeta,
  getOnboardingJobFileBin,
  upsertOnboardingJob,
  updateOnboardingJob,
  deleteOnboardingJobsBatch,
  resetAllRunningOnboardingJobs,
  stampOnboardingJobOwner,
  getOnboardingJobDbStatus,
  cancelOnboardingJobInDb,
  promotePendingOnboardingJob,
  getOnboardingTemplates,
  getOnboardingAssumedFields,
  getOnboardingAssumedFieldsFiltered,
  upsertOnboardingAssumedFieldsBatch,
  insertOnboardingAssumedHistoryBatch,
  deleteOnboardingAssumedFieldsByIds,
  getOnboardingAssumedHistory,
  upsertOnboardingTemplate,
  upsertSynonymMapping,
  updateOnboardingExtraField,
  deleteOnboardingExtraField,
  upsertOnboardingExtraFieldsBatch,
  getOnboardingExtraFields,
  getOnboardingSettings,
  getOnboardingSettingsByPrefix,
  deleteOnboardingSettings,
  deleteOnboardingSettingsWithSnapshots,
  upsertOnboardingSettings,
  upsertOnboardingSettingsWithSnapshots,
  getOfficeUsage,
  renameOfficeForTenantWithSnapshots,
  deleteTenantStatus,
  getUsersByTenant,
  getActiveUsersByTenant,
  getUserByTenantAndId,
  updateUserOfficesWithSnapshots,
  listImportReview,
  countOpenImportReview,
  getImportReviewItem,
  resolveImportReviewItem,
  upsertIdentityAlias,
} from "@workspace/db";
import { createAppUser, updateAppUser } from "../lib/user-store.js";
import { sha256, publicBaseUrl as invitePublicBaseUrl, INVITE_TTL_HOURS, upsertInviteToken, lookupInviteToken, claimInviteToken, releaseInviteToken, getInvitesByTenantKey, voidPendingInvite } from "../lib/invites.js";
import { dbStatus, getPool, getUniversalSchema } from "../lib/db.js";
import { sendEmail } from "../lib/agentmail.js";
import sql from "mssql";
import { uploadFile, buildS3Key, readFileBuffer, storageStatus } from "../lib/storage.js";
import { setupSchema } from "../lib/schema-setup.js";
import { lookupUserForLogin, resolveRequestSource, isSuperAdminSource, verifyRdsToken, type RequestSource } from "../lib/rds-auth.js";
import { recordUsage } from "../lib/usage-telemetry.js";
import { registerChunkUploadRoutes } from "../lib/upload-chunks.js";
import { ONBOARD_TABLES, TEMPLATE_TENANT_ID } from "../onboarding/roles.js";
import type { Request, Response } from "express";
import { boundedAuditChanges, recordAuditEvent, recordAuditEvents, setAuditTarget, setTrustedAuditChanges, trustedAuditDiff, type TrustedAuditChange } from "../lib/auditTrail.js";

const router = Router();
// 250MB cap: grid-exported workbooks from large client files (60k+ rows across
// multiple sheets) can exceed the old 50MB limit; multer then kills the upload
// with an opaque 500 and the import page looks "stuck".
const UPLOAD_MAX_BYTES = 250 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_MAX_BYTES } });
// Wrap multer so an oversized file returns a clear JSON error the frontend
// can show, instead of an unhandled MulterError → HTML 500.
function uploadSingleFile(req: Request, res: Response, next: () => void) {
  upload.single("file")(req, res, (err: unknown) => {
    if (err) {
      const tooBig = (err as { code?: string })?.code === "LIMIT_FILE_SIZE";
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig
          ? `File is too large to upload (limit ${Math.round(UPLOAD_MAX_BYTES / (1024 * 1024))}MB). Try splitting the file into smaller parts.`
          : `Upload failed: ${(err as Error)?.message ?? String(err)}`,
      });
    }
    return next();
  });
}

/**
 * Apply Excel's native "date" data-validation to every date-like column in a
 * template sheet. This doesn't open a calendar popup (plain .xlsx can't do
 * that without VBA/ActiveX, which is Windows-Excel-only and macro-gated) —
 * but it does reject anything typed into the column that isn't a real date,
 * which is the reliable, cross-platform way to keep date columns clean.
 */
function applyDateColumnValidation(ws: any, cols: { key: string; header: string }[], firstRow = 2, lastRow = 500) {
  const isDateCol = (c: { key: string; header: string }) => /date/i.test(c.key) || /date/i.test(c.header);
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  cols.forEach((col, i) => {
    if (!isDateCol(col)) return;
    const colLetter = ws.getColumn(i + 1).letter;
    for (let r = firstRow; r <= lastRow; r++) {
      const cell = ws.getCell(`${colLetter}${r}`);
      // Excel's built-in calendar-picker icon only activates on cells whose
      // underlying value is a real date (or a date-typed empty cell with
      // date validation) — plain text like "2026-07-01" never gets it, even
      // with numFmt + validation applied. Convert any pre-filled sample text
      // date into a real Date object so both filled AND blank cells qualify.
      if (typeof cell.value === "string" && ISO_DATE_RE.test(cell.value.trim())) {
        const [y, m, d] = cell.value.trim().split("-").map(Number);
        cell.value = new Date(y, m - 1, d);
      }
      cell.numFmt = "yyyy-mm-dd";
      cell.dataValidation = {
        type: "date",
        operator: "between",
        formulae: [new Date(1990, 0, 1), new Date(2100, 0, 1)],
        allowBlank: true,
        showErrorMessage: true,
        errorStyle: "error",
        errorTitle: "Not a valid date",
        error: "Please enter a real date (e.g. 2025-01-31). Text is not allowed in this column.",
        showInputMessage: true,
        promptTitle: "Date required",
        prompt: "Enter a date, e.g. 2025-01-31.",
      };
    }
  });
}

/**
 * Apply an Admin/Manager/User list-dropdown to every "Access Level" cell
 * in the given worksheet. Works across all three template generators.
 */
function applyAclDropdown(
  ws: ExcelJS.Worksheet,
  cols: { header: string }[],
  totalDataRows: number,
) {
  const aclIdx = cols.findIndex(c => c.header === "Access Level");
  if (aclIdx < 0) return;
  const aclLetter = ws.getColumn(aclIdx + 1).letter;
  for (let r = 2; r <= 1 + totalDataRows; r++) {
    ws.getCell(`${aclLetter}${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Admin,Manager,User"'],
      showErrorMessage: false,
      showInputMessage: true,
      promptTitle: "Access Level",
      prompt: "Admin — full edit access  |  Manager — manage projects  |  User — view only",
    };
  }
}

// Short-lived cache for core2 tenant discovery (used by /history for superadmin).
// Avoids hammering SQL Server on every 5-second poll.
let _core2TenantCache: { guids: string[]; names: Map<string, string>; expiresAt: number } | null = null;
const CORE2_TENANT_CACHE_TTL_MS = 60_000;

// In-memory job cache (write-through to PostgreSQL for persistence across restarts)
interface JobRecord {
  uploadId:  string;
  tenantId:  string;
  fileName:  string;
  s3Key?:    string;
  status:    "pending" | "running" | "success" | "partial" | "failed" | "cancelled" | "provisioned";
  createdAt: string;
  // Username of the person who kicked off this run (superadmin or company user).
  createdBy?: string;
  sheets?:   { sheetName: string; columns: string[]; totalRows: number; tableName: string | null }[];
  result?:   any;
  errorDetail?: string;
  totalInserted?: number;
  totalErrors?:   number;
  // Live, server-side progress for the status screen while status === "running".
  // In-memory only (not persisted) — it's transient and superseded by the final
  // step results once the run finishes.
  progress?: PipelineProgress;
  // Epoch-ms of the last pipeline progress event. The /active ghost sweep uses
  // this (NOT createdAt) to decide whether a running job is genuinely dead —
  // large imports legitimately run past any fixed age limit, and failing them
  // by age alone killed live imports mid-run.
  lastActivityAt?: number;
  // Set by POST /cancel/:id. Prevents the pipeline finalisation block from
  // overwriting the "failed" status after a user-initiated cancellation.
  cancelledAt?: string;
  // Set by the /run heartbeat when the DB row was flipped failed/cancelled by
  // ANOTHER process (crash reconcile after a worker death, or a cancel landing
  // on a sibling instance). The pipeline aborts at its next checkpoint and the
  // finalisation defers to the DB status instead of overwriting it. In-memory
  // only — never persisted.
  externallyStopped?: "failed" | "cancelled";
  // Base64 of the original workbook — used to re-import from history when S3 is
  // not configured. Mirrored to the DB so it survives restarts.
  fileData?: string;
  // Locked data category chosen by the user at upload time (e.g. "team",
  // "clients", "assignments"). When set, EVERY sheet in the file is treated as
  // this type — tab names are ignored. Persisted so the import run honours the
  // same intent even after a server restart.
  forcedTabType?:    "team" | "clients" | "assignments";
  forcedRecordType?: string; // "Project" | "Opportunity" | "Lead" | null
  // The import mode used when this job was run (create/update/add/replace).
  importMode?: string;
}

const _jobs = new Map<string, JobRecord>();

// ── File-blob janitor ────────────────────────────────────────────────────────
// Upload handling stashes the raw workbook Buffer (`_buffer`) and/or a base64
// copy (`fileData`) on the in-memory job record so the immediate /run and the
// preview/validate routes can reuse them without a DB round-trip. Nothing ever
// removed them, so every upload permanently pinned ~2.3x its file size PER
// WORKER until a process restart (observed in the Aug 6 2026 prod OOM storm:
// blobs from the previous evening's uploads were still resident the next
// morning, raising the baseline every worker OOM'd from). The DB row (and S3,
// when configured) holds the durable copy — the in-memory blobs are a pure
// cache and safe to drop once durability is confirmed:
//   • terminal jobs: drop immediately (history re-import reloads from the DB);
//   • running jobs >5 min in: the pipeline holds its own local buffer ref, the
//     job-record copy is dead weight for the rest of the run;
//   • pending jobs >20 min old: the user parked the wizard — /run back-fills
//     from the DB on demand.
// `fileData` is only dropped when a durable copy is confirmed (s3Key present,
// or the first DB persist succeeded / the blob was loaded FROM the DB — both
// tracked via _persistedOnce). `_buffer` may additionally be dropped whenever
// its base64 twin is still held, since it can be re-derived.
const BLOB_SWEEP_MS = 60_000;
setInterval(() => {
  const now = Date.now();
  for (const j of _jobs.values()) {
    const rec = j as JobRecord & { _buffer?: Buffer };
    if (rec._buffer === undefined && rec.fileData === undefined) continue;
    const ageMs = now - new Date(j.createdAt).getTime();
    const sweepable =
      (j.status !== "pending" && j.status !== "running") ||
      (j.status === "running" && ageMs > 5 * 60_000) ||
      (j.status === "pending" && ageMs > 20 * 60_000);
    if (!sweepable) continue;
    const durable = !!j.s3Key || _persistedOnce.has(j.uploadId);
    if (durable) {
      delete rec._buffer;
      rec.fileData = undefined;
    } else if (rec.fileData !== undefined) {
      // No confirmed durable copy — keep the base64 string as the sole copy
      // (matches pre-janitor safety) but free the redundant raw Buffer.
      delete rec._buffer;
    }
  }
}, BLOB_SWEEP_MS).unref();

// Throttle for the S3-fallback warning below — once per 10 min per process.
let _lastS3WarnAt = 0;

/**
 * Cheap synchronous check: is any import job running (or about to run) as far
 * as THIS worker knows? Used by the login route to decide whether it is safe
 * to hard-reset the shared app-DB pool after a lookup timeout — resetting the
 * pool mid-import would abort the pipeline's in-flight queries. Conservative:
 * a "running" row started by another worker also returns true (skipping the
 * reset is always safe; the login retry is still capped).
 */
export function isImportActive(): boolean {
  for (const j of _jobs.values()) {
    if (j.status === "running" || j.status === "pending") return true;
  }
  return false;
}
// Throttle for the status-poll's "is the DB already terminal?" re-check while
// a job looks running/pending on this worker (see GET /status/:id).
const _statusDbCheckAt = new Map<string, number>();
// Short-lived per-tenant cache of the /active DB fallback answer. The cluster
// runs 2 workers and each keeps its own _jobs map, so a job started on the
// other worker is invisible here — without a DB check the "import running"
// banner flickers on/off as polls alternate between workers. The cache keeps
// the answer stable between throttled DB checks (poll = 3s, TTL = 4s).
const _activeDbCache = new Map<string, { at: number; resp: Record<string, unknown> | null }>();

// Normalize a company name the same way the upload route does (spaces→_),
// case-insensitive, so "Acme Construction" and "acme_construction" collide.
function normTenant(t: string): string {
  return t.trim().replace(/\s+/g, "_").toLowerCase();
}

// ── Tenant access control ────────────────────────────────────────────────
// Company users may only touch their own company's onboarding data; a
// verified superadmin may act across companies. On failure this sends the
// 401/403 response itself and returns null so callers can simply
// `if (!src) return;`.
function requireTenantAccess(req: Request, res: Response, targetTenant?: string | null): RequestSource | null {
  const src = resolveRequestSource(req);
  if (!src) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  if (targetTenant && !isSuperAdminSource(src) && normTenant(targetTenant) !== normTenant(src.tenant)) {
    res.status(403).json({ error: "You do not have access to this company's data" });
    return null;
  }
  return src;
}

// Admin-only writes: company-wide defaults may only be changed by that
// company's admin (or a cross-company superadmin). Access-level semantics
// deliberately mirror the web shell's nav gating: an EXPLICIT
// "manager"/"user" is not an admin, while a missing/"unset" level is
// grandfathered as admin (legacy tenants whose users predate access levels
// see the admin nav in the web app too). Fails closed via 403.
async function requireTenantAdmin(req: Request, res: Response, targetTenant?: string | null): Promise<RequestSource | null> {
  const src = requireTenantAccess(req, res, targetTenant);
  if (!src) return null;
  if (isSuperAdminSource(src)) return src;
  // A JWT carries the access level from login time. Re-read the account here
  // so a promotion can use Settings immediately and a demotion cannot retain
  // Settings access until its token expires.
  let acl: string;
  try {
    const live = await lookupUserForLogin(src.tenant, src.username);
    if (!live || !live.enabled) {
      res.status(403).json({ error: "Only a company admin can change company-wide settings" });
      return null;
    }
    acl = String(live.accessLevel ?? "unset").trim().toLowerCase() || "unset";
  } catch {
    res.status(503).json({ error: "Cannot verify your current access level. Please try again." });
    return null;
  }
  if (acl === "admin" || acl === "unset") return src;
  // Custom access levels (#87): a level may include the "manage settings"
  // capability, which extends the admin gate to that user. Fails CLOSED —
  // policy unreadable or level deleted → not an admin.
  try {
    if ((await getResolvedAccessCaps(acl, src.tenant)).caps?.manageSettings === true) return src;
  } catch { /* fall through to 403 */ }
  res.status(403).json({ error: "Only a company admin can change company-wide settings" });
  return null;
}

// Staff-management gate: company admins (or custom levels holding the
// "manage staff" or "manage settings" capability) may change team member
// accounts — access levels, deactivate, delete, restore. Superadmins pass.
// Fails CLOSED like the admin gate.
async function requireStaffAdmin(req: Request, res: Response, targetTenant?: string | null): Promise<RequestSource | null> {
  const src = requireTenantAccess(req, res, targetTenant);
  if (!src) return null;
  if (isSuperAdminSource(src)) return src;
  // Keep this in lockstep with requireTenantAdmin: staff administration must
  // honor live role changes rather than a stale login token.
  let acl: string;
  try {
    const live = await lookupUserForLogin(src.tenant, src.username);
    if (!live || !live.enabled) {
      res.status(403).json({ error: "Only a company admin (or a level with the manage-staff permission) can change team member accounts" });
      return null;
    }
    acl = String(live.accessLevel ?? "unset").trim().toLowerCase() || "unset";
  } catch {
    res.status(503).json({ error: "Cannot verify your current access level. Please try again." });
    return null;
  }
  if (acl === "admin" || acl === "unset") return src;
  try {
    if ((await getResolvedAccessCaps(acl, src.tenant)).caps?.manageStaff === true) return src;
  } catch { /* fall through to 403 */ }
  res.status(403).json({ error: "Only a company admin (or a level with the manage-staff permission) can change team member accounts" });
  return null;
}

/** Importing is a distinct capability: it requires both page access and data
 * editing. Superadmins and grandfathered admin/unset accounts retain access. */
async function requireImportAccess(req: Request, res: Response, targetTenant?: string | null): Promise<RequestSource | null> {
  const src = requireTenantAccess(req, res, targetTenant);
  if (!src || isSuperAdminSource(src)) return src;
  try {
    const live = await lookupUserForLogin(src.tenant, src.username);
    if (!live || !live.enabled) throw new Error("identity unavailable");
    const acl = String(live.accessLevel ?? "unset").trim().toLowerCase() || "unset";
    if (acl === "unset") return src;
    const caps = (await getResolvedAccessCaps(acl, src.tenant)).caps;
    if (caps?.importPage && caps.editData) return src;
  } catch { /* fail closed below */ }
  res.status(403).json({ error: "import_restricted", error_description: "Your access level doesn't allow importing data." });
  return null;
}

// Admin-capable = active, not deleted, and access level admin or the
// grandfathered blank/"unset" (which the admin gate also accepts).
const isAdminishAcl = (acl: string | null | undefined): boolean => {
  const l = String(acl ?? "").trim().toLowerCase();
  return l === "" || l === "unset" || l === "admin";
};
// A custom access level holding the manage-staff / manage-settings capability
// is ALSO admin-capable — if such a user is the tenant's only privileged
// account, removing them would lock the company out of staff/settings
// administration just as surely as removing the last "admin". Custom levels
// that cannot be verified are NOT counted (over-protecting beats lockout).
async function wouldRemoveLastAdmin(tid: string, tenantLabel: string, targetGuid: string): Promise<boolean> {
  const users = await getUsersByTenant(tid);
  const activeUsers = users.filter(u => !u.deleted && u.enabled !== false);
  const capable: typeof activeUsers = [];
  for (const u of activeUsers) {
    const l = String(u.accessLevel ?? "").trim().toLowerCase();
    if (isAdminishAcl(l)) { capable.push(u); continue; }
    if (isCustomAcl(l)) {
      try {
        const caps = await getCapsForAcl(l, tenantLabel);
        if (caps?.manageStaff === true || caps?.manageSettings === true) capable.push(u);
      } catch { /* unverifiable custom level → not counted */ }
      continue;
    }
    // Built-in Manager/User whose level was customized with manage-staff /
    // company-settings also keeps the company administrable.
    try {
      const ov = await getBuiltinOverrideCaps(l, tenantLabel);
      if (ov?.manageStaff === true || ov?.manageSettings === true) capable.push(u);
    } catch { /* unverifiable → not counted (over-protecting beats lockout) */ }
  }
  if (!capable.some(u => String(u.id).toLowerCase() === targetGuid)) return false;
  return capable.length <= 1;
}

// For routes that accept a tenantId in the query/body: a company user is
// ALWAYS pinned to their own login tenant (whatever they sent), while a
// superadmin may target the requested company. This means a crafted request
// can never read or write another company's rows — it just gets its own.
function effectiveTenant(src: RequestSource, requested?: string | null): string {
  return isSuperAdminSource(src) ? (String(requested ?? "").trim() || src.tenant) : src.tenant;
}

// Access level → canonical UserRoleIdLookup value. Only an EXPLICIT
// admin/manager/user counts; anything else is left unset (null) so the person
// is grandfathered (editable). Mirrors pipeline.ts normAcl so the invite UI and
// the import pipeline agree on the source of truth for edit gating.
function normRole(raw?: string | null): "Admin" | "Manager" | "User" | null {
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "admin" ? "Admin" : s === "manager" ? "Manager" : s === "user" ? "User" : null;
}

// Per-client column mapping ("template") storage. Keyed by the normalized
// company name so it survives re-uploads regardless of spacing/casing. The
// mapping is { sheetName: { excelCol: rmoneCol } } — exactly what /run accepts.
type ClientMapping = Record<string, Record<string, string>>;

async function saveClientTemplate(
  tenantLabel: string,
  mapping: ClientMapping,
  tabOverrides?: Record<string, string>,
): Promise<void> {
  const tenantKey = normTenant(tenantLabel);
  // Embed tabOverrides inside the mapping JSON under a reserved key so no schema change is needed.
  const mappingWithMeta: Record<string, any> = { ...mapping };
  if (tabOverrides && Object.keys(tabOverrides).length > 0) {
    mappingWithMeta.__tabOverrides = tabOverrides;
  } else {
    delete mappingWithMeta.__tabOverrides;
  }
  await upsertOnboardingTemplate({ tenantKey, tenantLabel, name: "default", mapping: mappingWithMeta });
}

// ── Cross-tenant mapping memory ────────────────────────────────────────────
// After every successful import we save the confirmed column mappings back
// into the shared synonym_mappings table so future uploads from ANY company
// (not just this one) benefit from it automatically — the same way Flatfile
// learns from 5 billion decisions across all their customers.
//
// Rules:
//  • Template headers are already matched with 100% certainty — skip them.
//  • Very short normalised keys (< 3 chars) are too ambiguous — skip them.
//  • Canonical values that are blank, "skip", or start with "_" — skip.
//  • Always store with the detected tab type so tab-specific aliases don't
//    bleed over to other tabs (e.g. "Type"→AllocationType stays assignments-only).
//  • On conflict (same alias + tabType already known) we bump the hit count
//    and refresh updatedAt so the most-confirmed mappings sort to the top in
//    the admin synonym UI, but we do NOT overwrite isBuiltin rows.
async function saveLearnedSynonyms(
  sheets: Array<{ sheetName: string; columns: string[]; rows?: any[] }>,
  columnMappings: Record<string, Record<string, string>>,
): Promise<void> {
  const toSave: Array<{ alias: string; canonicalField: string; tabType: string }> = [];

  for (const sheet of sheets) {
    const mapping = columnMappings[sheet.sheetName];
    if (!mapping || Object.keys(mapping).length === 0) continue;

    const tab = resolveSimplifiedTab(sheet as any);
    if (!tab) continue;

    const templateNorm = TEMPLATE_HEADER_NORM_BY_TAB[tab] ?? {};

    for (const [rawHeader, canonical] of Object.entries(mapping)) {
      if (!canonical || canonical.startsWith("_") || canonical.toLowerCase() === "skip") continue;
      const normed = normSynKey(rawHeader);
      if (normed.length < 3) continue;
      // Template headers are already matched with certainty — no need to store
      if (templateNorm[normed]) continue;
      toSave.push({ alias: rawHeader, canonicalField: canonical, tabType: tab });
    }
  }

  if (!toSave.length) return;

  // Batch upsert: insert new rows; on conflict increment hit count + update
  // canonical + updatedAt (but only for non-builtin rows — never overwrite
  // admin-curated built-in synonyms).
  await Promise.all(
    toSave.map(entry =>
      upsertSynonymMapping({ alias: entry.alias, canonicalField: entry.canonicalField, tabType: entry.tabType, isBuiltin: false, hitCount: 1 })
        .catch(() => { /* non-fatal */ }),
    ),
  );
}

async function loadClientTemplate(tenantLabel: string) {
  const tenantKey = normTenant(tenantLabel);
  const rows = await getOnboardingTemplates(tenantKey);
  return rows[0] ?? null;
}

// ── "Keep as extra field" capture ─────────────────────────────────────────
// Columns the client chose to KEEP (not map to an RM ONE field, not skip) are
// stored in OUR Postgres — never written to RM ONE's core2 — and linked to the
// matching record by its natural key so they can be shown next to that record.
type ExtraSheet  = { sheetName: string; columns: string[]; rows: Record<string, any>[] };
type ExtraRecord = {
  entityType:  string;
  naturalKey:  string;
  recordLabel: string;
  fieldName:   string;
  value:       string | null;
  sheetName:   string;
};

function extraStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// Identify the record a row belongs to. For the client-friendly (simplified)
// tabs we use the same identifying fields the pipeline uses to build entities;
// for raw standard dumps we key off the destination table's natural key.
function resolveExtraRecordKey(
  tab: "team" | "clients" | "assignments" | null,
  table: string | null,
  row: Record<string, any>,
): { entityType: string; naturalKey: string; recordLabel: string } | null {
  if (tab === "team") {
    const key = extraStr(row.UserName ?? row.Email ?? row.FullName ?? row.Name);
    if (!key) return null;
    return { entityType: "person", naturalKey: key.toLowerCase(), recordLabel: extraStr(row.FullName ?? row.Name) ?? key };
  }
  if (tab === "clients") {
    const title = extraStr(row.ProjectTitle ?? row.Project ?? row.Title ?? row.OpportunityTitle);
    if (title) {
      const type   = (extraStr(row.Type) ?? "Project").toLowerCase();
      const isLead = type === "lead";
      const isOpp  = type === "opportunity" || type === "opp";
      const entityType = isLead ? "lead" : isOpp ? "opportunity" : "project";
      return { entityType, naturalKey: title.toLowerCase(), recordLabel: title };
    }
    const company = extraStr(row.CompanyName ?? row.Company ?? row.ClientCompany);
    if (company) return { entityType: "company", naturalKey: company.toLowerCase(), recordLabel: company };
    return null;
  }
  if (tab === "assignments") {
    const resource = extraStr(row.Resource ?? row.UserName);
    const project  = extraStr(row.Project ?? row.ProjectTitle ?? row.Title);
    if (!resource && !project) return null;
    const label = [resource, project].filter(Boolean).join(" / ");
    return { entityType: "assignment", naturalKey: label.toLowerCase(), recordLabel: label };
  }
  if (table) {
    const byTable: Record<string, { fields: string[]; entityType: string }> = {
      AspNetUsers: { fields: ["UserName", "Name"],          entityType: "person" },
      CRMCompany:  { fields: ["Title"],                       entityType: "company" },
      CRMContact:  { fields: ["Title", "PointOfContact"],   entityType: "contact" },
      PMM:         { fields: ["TicketId", "Title"],          entityType: "project" },
      Opportunity: { fields: ["TicketId", "Title"],          entityType: "opportunity" },
      Lead:        { fields: ["TicketId", "Title"],          entityType: "lead" },
    };
    const spec = byTable[table] ?? { fields: ["Title", "Name", "TicketId", "UserName"], entityType: "record" };
    for (const f of spec.fields) {
      const v = extraStr(row[f]);
      if (v) return { entityType: spec.entityType, naturalKey: v.toLowerCase(), recordLabel: v };
    }
  }
  return null;
}

// Columns whose name looks like a credential / secret must never be copied into
// our own database, regardless of what the client requests.
const SENSITIVE_KEEP_RE = /password|passwd|secret|token|api[_-]?key|credential|\bssn\b|\bpin\b/i;

// Defence-in-depth for the "keep in our database" option: only genuinely extra
// columns may be kept. A column that the user also mapped into RM ONE, or whose
// name looks sensitive, is dropped here even if it arrives in the request body.
function sanitizeKeepColumns(
  keepColumns: Record<string, string[]> | undefined,
  columnMappings: Record<string, Record<string, string>> | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!keepColumns) return out;
  for (const [sheet, cols] of Object.entries(keepColumns)) {
    const mappedCols = columnMappings?.[sheet] ?? {};
    const safe = [...new Set(cols)].filter(
      c => c && !SENSITIVE_KEEP_RE.test(c) && !(c in mappedCols),
    );
    if (safe.length) out[sheet] = safe;
  }
  return out;
}

function captureExtraFields(
  sheets: ExtraSheet[],
  keepColumns: Record<string, string[]>,
): ExtraRecord[] {
  const byKey = new Map<string, ExtraRecord>();
  for (const sheet of sheets) {
    const kept = keepColumns[sheet.sheetName];
    if (!kept || kept.length === 0) continue;
    const tab   = resolveSimplifiedTab(sheet as any);
    const table = tab ? null : resolveTable(sheet.sheetName);
    for (const row of sheet.rows) {
      const id = resolveExtraRecordKey(tab, table, row);
      if (!id) continue;
      for (const col of kept) {
        if (!(col in row)) continue;
        const value = extraStr(row[col]);
        const k = `${id.entityType}|${id.naturalKey}|${col}`;
        const prev = byKey.get(k);
        // Last non-null wins (a later row for the same record overrides a blank).
        if (!prev || (prev.value == null && value != null)) {
          byKey.set(k, {
            entityType: id.entityType, naturalKey: id.naturalKey, recordLabel: id.recordLabel,
            fieldName: col, value, sheetName: sheet.sheetName,
          });
        }
      }
    }
  }
  return [...byKey.values()];
}

async function saveExtraFields(tenantLabel: string, records: ExtraRecord[]): Promise<void> {
  if (records.length === 0) return;
  const tenantKey = normTenant(tenantLabel);
  const now = new Date();
  const rows = records.map(r => ({
    tenantKey, tenantLabel,
    entityType: r.entityType, naturalKey: r.naturalKey, recordLabel: r.recordLabel,
    fieldName: r.fieldName, value: r.value, sheetName: r.sheetName,
  }));
  // Chunk so a large file doesn't blow the parameter limit; upsert so a re-upload
  // updates the same record's field in place instead of duplicating it.
  for (let i = 0; i < rows.length; i += 500) {
    await upsertOnboardingExtraFieldsBatch(rows.slice(i, i + 500));
  }
}

// ── "Assumed Data" persistence ─────────────────────────────────────────────
// Stores the defaults the wizard applied for blank fields (Division→Unassigned,
// Job Title→Staff, project type→General …) in OUR Postgres, keyed by natural key
// so the app can flag system-generated values next to the matching record. Upsert
// on (tenantKey, entityType, naturalKey, fieldName) so re-uploads update in place.
type AssumedRecord = {
  entityType:  string;
  naturalKey:  string;
  recordLabel: string;
  fieldName:   string;
  value:       string | null;
  sheetName:   string;
  confidence?: string;  // Data Confidence tier; defaults to system_defaulted
};

async function saveAssumedFields(
  tenantLabel: string,
  records: AssumedRecord[],
  seenEntities: string[] = [],
  actor = "pipeline",
): Promise<void> {
  if (records.length === 0 && seenEntities.length === 0) return;
  const tenantKey = normTenant(tenantLabel);
  const now = new Date();
  const rows = records.map(r => ({
    tenantKey, tenantLabel,
    entityType: r.entityType, naturalKey: r.naturalKey, recordLabel: r.recordLabel,
    fieldName: r.fieldName, value: r.value, sheetName: r.sheetName,
    confidence: r.confidence ?? "system_defaulted",
  }));

  // Snapshot the CURRENT values for these exact (entity, key, field) tuples so we
  // can record an audit trail of what each one changed from. Keyed identically to
  // the upsert's unique index.
  const keyOf = (e: string, n: string, f: string) => `${e}\u0000${n}\u0000${f}`;
  const prior = new Map<string, { value: string | null; confidence: string }>();
  const existing = await getOnboardingAssumedFields(tenantKey);
  for (const e of existing) prior.set(keyOf(e.entityType, e.naturalKey, e.fieldName), { value: e.value, confidence: e.confidence });

  // Assumed → validated (spec): when this run processed a record (seenEntities)
  // but a previously-assumed field for it is NOT among the new assumed values,
  // the client has now supplied the real value. Clear that stale assumed flag and
  // append a "replaced_by_client" audit row so the trail shows the transition.
  const newKeySet = new Set(rows.map(r => keyOf(r.entityType, r.naturalKey, r.fieldName)));
  const seenSet   = new Set(seenEntities.map(s => s.toLowerCase()));
  const entOf     = (e: string, n: string) => `${e}|${n}`.toLowerCase();
  const stale = existing.filter(e =>
    seenSet.has(entOf(e.entityType, e.naturalKey)) &&
    !newKeySet.has(keyOf(e.entityType, e.naturalKey, e.fieldName)),
  );
  const staleIds = stale.map(e => e.id);
  const replacedHistory = stale.map(e => ({
    tenantKey, tenantLabel,
    entityType: e.entityType, naturalKey: e.naturalKey, recordLabel: e.recordLabel,
    fieldName: e.fieldName,
    action: "replaced_by_client",
    oldValue: e.value, newValue: null,
    oldConfidence: e.confidence, newConfidence: "client_provided",
    sheetName: null as string | null, actor,
  }));

  // Append an immutable audit/version row for each value that is new or changed.
  const history = rows
    .map(r => {
      const before = prior.get(keyOf(r.entityType, r.naturalKey, r.fieldName));
      if (before && before.value === r.value && before.confidence === r.confidence) return null; // no change
      return {
        tenantKey, tenantLabel,
        entityType: r.entityType, naturalKey: r.naturalKey, recordLabel: r.recordLabel,
        fieldName: r.fieldName,
        action: before ? "updated" : "created",
        oldValue: before?.value ?? null, newValue: r.value,
        oldConfidence: before?.confidence ?? null, newConfidence: r.confidence,
        sheetName: r.sheetName, actor,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Persist upsert, audit trail, and stale-clear (SQL Server has no cross-table transactions
  // with Postgres, but all operations are idempotent so partial failure is safe to retry).
  await upsertOnboardingAssumedFieldsBatch(rows);
  if (history.length) await insertOnboardingAssumedHistoryBatch(history);
  if (staleIds.length) await deleteOnboardingAssumedFieldsByIds(staleIds);
  if (replacedHistory.length) await insertOnboardingAssumedHistoryBatch(replacedHistory);
}

// ── Onboarding "missing-data" default settings ───────────────────────────
// Resolution: built-in (code) ← global overrides ← per-client overrides.
// Each layer stores only the keys an admin changed; we merge them so a client
// inherits everything it has not explicitly overridden.
const GLOBAL_SCOPE = "global";

async function upsertSettingsWithAudit(
  res: Response,
  row: { scope: string; label: string | null; settings: Record<string, unknown> },
): Promise<void> {
  const snapshot = await upsertOnboardingSettingsWithSnapshots(row);
  setTrustedAuditChanges(res, trustedAuditDiff(
    { Settings: snapshot.before },
    { Settings: snapshot.after },
    { fields: ["Settings"] },
  ));
}

function setConfigurationAuditTarget(res: Response, key: string, name: string): void {
  setAuditTarget(res, { entityType: "configuration", entityId: key, entityName: name });
}

async function deleteSettingsWithAudit(res: Response, scope: string): Promise<void> {
  const snapshot = await deleteOnboardingSettingsWithSnapshots(scope);
  setTrustedAuditChanges(res, trustedAuditDiff(
    { Settings: snapshot.before },
    { Settings: snapshot.after },
    { fields: ["Settings"] },
  ));
}

// Read the partial override blob stored for a given scope ("global" or a tenant
// key). Returns {} when no row exists yet.
async function readSettingsRow(scope: string): Promise<Partial<OnboardingDefaults>> {
  const row = await getOnboardingSettings(scope);
  if (!row) return {};
  return sanitizeDefaults(row.settings);
}

// Resolve the effective defaults a pipeline run should use for a given client.
async function loadEffectiveDefaults(tenantLabel?: string): Promise<OnboardingDefaults> {
  const global = await readSettingsRow(GLOBAL_SCOPE);
  const perClient = tenantLabel ? await readSettingsRow(normTenant(tenantLabel)) : {};
  return mergeDefaults(global, perClient);
}

// Upsert a scope's partial override blob (only changed keys are stored).
async function writeSettingsRow(
  scope: string,
  label: string | null,
  partial: Partial<OnboardingDefaults>,
  res?: Response,
): Promise<void> {
  const row = { scope, label, settings: partial as Record<string, unknown> };
  if (res) await upsertSettingsWithAudit(res, row);
  else await upsertOnboardingSettings(row);
}

const TAKEN_STATUSES = ["success", "partial", "running", "cancelled", "failed"] as const;

type TenantConflict = { status: string; fileName: string; createdAt: string; uploadId?: string };

// A tenant name is "taken" once it has been imported (success/partial) or is
// mid-import (running). Failed/pending names stay free so a client can retry.
// Queries the DB directly so the check is authoritative across restarts and is
// not limited by what happens to be in the in-memory cache; falls back to the
// cache only if the DB is unreachable or slow (4-second deadline prevents the
// /run endpoint from blocking for the full 120 s mssql request timeout when
// SQL Server is under load).
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timer = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error("deadline")), ms);
  });
  return Promise.race([p, timer]).finally(() => clearTimeout(t!));
}

// Does this company actually have live data? Distinguishes "the name has a
// failed/cancelled history row" from "the client really exists". Soft-deleted
// rows do NOT count — a cancelled fresh create rolls its rows back by
// soft-deleting them, so counting them would keep the false "existing client"
// prompt alive forever. Checks the Postgres users table (authoritative for
// identity) plus the main core2 record tables.
async function tenantHasDataProbe(tenantLabel: string): Promise<boolean> {
  const tid = resolveTenantId(tenantLabel);
  try {
    const pgUsers = await getActiveUsersByTenant(tid);
    if ((pgUsers?.length ?? 0) > 0) return true;
  } catch { /* Postgres unavailable — the core2 probe below still decides */ }
  const pool = await getPool();
  const parts: string[] = [];
  for (const t of ["PMM", "Opportunity", "CRMCompany", "ResourceWorkItems"]) {
    const cols = await tableColumns(t);
    if (!cols.has("TenantID")) continue;
    const del = cols.has("Deleted") ? "AND ([Deleted] = 0 OR [Deleted] IS NULL)" : "";
    parts.push(`SELECT TOP 1 1 AS x FROM core2.dbo.[${t}] WITH (NOLOCK) WHERE [TenantID] = @tid ${del}`);
  }
  if (!parts.length) return false;
  const r = await pool.request().input("tid", sql.NVarChar, tid)
    .query(`SELECT TOP 1 x FROM (${parts.join(" UNION ALL ")}) u`);
  return (r.recordset?.length ?? 0) > 0;
}

// Fail CLOSED (has data) when the check errors or times out: uncertainty must
// never let a duplicate "create" run over a client that might have live data.
async function tenantHasData(tenantLabel: string): Promise<boolean> {
  try {
    return await withDeadline(tenantHasDataProbe(tenantLabel), 6_000);
  } catch {
    return true;
  }
}

async function findTenantConflict(
  tenantId: string,
  excludeUploadId?: string,
): Promise<TenantConflict | null> {
  const norm = normTenant(tenantId);
  try {
    const allJobs = await withDeadline(getAllOnboardingJobsMeta(), 4_000);
    const candidates = allJobs.filter(j =>
      normTenant(j.tenantId) === norm &&
      (TAKEN_STATUSES as readonly string[]).includes(j.status) &&
      (!excludeUploadId || j.uploadId !== excludeUploadId),
    ).sort((a, b) => {
      // Running first, then most-recent
      const aRun = a.status === "running" ? 1 : 0;
      const bRun = b.status === "running" ? 1 : 0;
      if (bRun !== aRun) return bRun - aRun;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    if (candidates.length) {
      const r = candidates[0];
      // success/partial/running history is authoritative — those imply data
      // (or an import in flight). failed/cancelled history alone must NOT mark
      // a company as existing: those runs imported nothing or were rolled
      // back. Only treat the name as taken if the tenant really has live data
      // (e.g. a failed run whose partial inserts survived → update mode is
      // still the right default, which is what the "failed" entry preserves).
      if ((r.status === "failed" || r.status === "cancelled") && !(await tenantHasData(tenantId))) {
        return null;
      }
      return { status: r.status, fileName: r.fileName, createdAt: new Date(r.createdAt).toISOString(), uploadId: r.uploadId };
    }
    return null;
  } catch {
    // DB unavailable — fall back to the in-memory cache.
    const j = [..._jobs.values()].find(j =>
      j.uploadId !== excludeUploadId &&
      normTenant(j.tenantId) === norm &&
      (TAKEN_STATUSES as readonly string[]).includes(j.status)
    );
    return j ? { status: j.status, fileName: j.fileName, createdAt: j.createdAt } : null;
  }
}

// ── DB persistence helpers ────────────────────────────────────────────────
// Writes for the SAME upload are chained so they always apply in call order.
// Without this, the initial /upload write (which carries the multi-MB base64
// file blob and can take minutes for a 60k-row workbook) races the fast
// status updates fired by /run — the slow "pending" snapshot lands LAST and
// stomps "running", leaving the DB row stale. Cross-worker status polls then
// read "pending" and the status page flickers back to the upload screen.
// Each queued write reads the LIVE job object at write time, so the final
// state persisted is always the newest one.
const _persistChains = new Map<string, Promise<void>>();
// Upload IDs whose row already exists in the DB (a prior persist succeeded).
// The MERGE's UPDATE branch ignores file_data entirely, so re-sending the
// multi-MB base64 blob on every subsequent write only wastes wire time and
// makes fast status flips slow — send the blob on the FIRST write only.
const _persistedOnce = new Set<string>();
function persistJob(job: JobRecord): Promise<void> {
  const prev = _persistChains.get(job.uploadId) ?? Promise.resolve();
  const next = prev.then(async () => {
    try {
      // fileData gate: send the blob only once to avoid re-transmitting up to
      // 27 MB of base64 on every status-update persist.  _persistedOnce is
      // only set after a write that actually included the blob, so the slim
      // pre-parse write (fileData=null) never marks it — the subsequent blob
      // write then sends the real bytes.  The MERGE SQL uses COALESCE(@fd,
      // file_data) so a null here never overwrites an already-stored blob.
      const hasBlobNow = job.fileData != null;
      const fileDataPayload = _persistedOnce.has(job.uploadId) ? null : (job.fileData ?? null);
      const written = await upsertOnboardingJob({
        uploadId:      job.uploadId,
        tenantId:      job.tenantId,
        fileName:      job.fileName,
        s3Key:         job.s3Key ?? null,
        status:        job.status,
        createdBy:     job.createdBy ?? null,
        totalInserted: job.totalInserted ?? null,
        totalErrors:   job.totalErrors   ?? null,
        importMode:    job.importMode ?? null,
        result:        job.result != null ? JSON.stringify(job.result) : null,
        sheets:        job.sheets != null ? JSON.stringify(job.sheets) : null,
        // Upload-card intent — persisted so /active's cross-worker DB
        // fallback badges the same modules as this (owner) worker. The MERGE
        // COALESCEs these, so null never wipes an already-stored intent.
        forcedTabType:    job.forcedTabType ?? null,
        forcedRecordType: job.forcedRecordType ?? null,
        fileData:      fileDataPayload,
      });
      // Only mark as "blob persisted" once the blob was included in the write.
      if (hasBlobNow && written) _persistedOnce.add(job.uploadId);
      // The MERGE's CAS fence refused the write — the DB row is terminal with
      // a DIFFERENT status (another process cancelled/failed this job). Sync
      // the in-memory copy so the pipeline aborts at its next checkpoint: this
      // makes EVERY milestone persist double as a cancel-detection probe,
      // independent of (and usually faster than) the 60s heartbeat poll.
      if (!written) {
        const dbStatus = await getOnboardingJobDbStatus(job.uploadId).catch(() => null);
        if (dbStatus === "cancelled" || dbStatus === "failed") {
          if (job.status === "running" && !job.externallyStopped) {
            job.externallyStopped = dbStatus;
            console.warn(`[onboarding] ${job.uploadId}: persist blocked — job was marked ${dbStatus} externally; aborting the pipeline at its next checkpoint`);
          } else if (job.status !== dbStatus) {
            // Late local finalization (e.g. "success") raced a cancel that had
            // already landed in the DB. The DB is the user-facing truth.
            console.warn(`[onboarding] ${job.uploadId}: persist skipped — DB row is ${dbStatus}, discarding local ${job.status}`);
            job.status = dbStatus;
          }
        }
      }
    } catch (e) {
      console.warn("[onboarding] persistJob failed:", (e as Error).message);
    }
  });
  _persistChains.set(job.uploadId, next);
  // Drop the chain entry once this tail write settles (no unbounded growth).
  void next.finally(() => {
    if (_persistChains.get(job.uploadId) === next) _persistChains.delete(job.uploadId);
  });
  return next;
}

function jparse<T = any>(s: string | null | undefined): T | undefined {
  if (!s) return undefined;
  try { return JSON.parse(s) as T; } catch { return undefined; }
}

/** Narrow a DB-loaded forced_tab_type string to the JobRecord union. */
function asForcedTabType(v: string | null | undefined): JobRecord["forcedTabType"] {
  return v === "team" || v === "clients" || v === "assignments" ? v : undefined;
}

async function loadJobFromDb(uploadId: string, opts?: { metaOnly?: boolean }): Promise<JobRecord | null> {
  try {
    const r = opts?.metaOnly ? await getOnboardingJobMeta(uploadId) : await getOnboardingJob(uploadId);
    if (!r) return null;
    // Durability marker — ONLY when this load PROVES a durable copy exists:
    // the row carries the base64 blob (full load) or points at S3. A bare
    // "row exists" is NOT proof — meta-only loads strip file_data, and a row
    // can exist without its blob (created by a later status write after the
    // initial blob write failed). persistJob relies on this marker to skip
    // re-sending the blob (the MERGE UPDATE branch never writes file_data),
    // and the blob janitor relies on it before reclaiming memory copies.
    if (r.s3Key || (r.fileData && r.fileData.length > 0)) _persistedOnce.add(uploadId);
    return {
      uploadId:      r.uploadId,
      tenantId:      r.tenantId,
      fileName:      r.fileName,
      s3Key:         r.s3Key ?? undefined,
      status:        r.status as JobRecord["status"],
      // Carried so ghost-cancelled rows flipped by ANOTHER worker's sweep
      // still show their plain-language reason via /status's failureReason
      // fallback instead of a bare "failed".
      errorDetail:   r.errorDetail ?? undefined,
      createdAt:     r.createdAt.toISOString(),
      createdBy:     r.createdBy ?? undefined,
      sheets:        jparse<JobRecord["sheets"]>(r.sheets),
      forcedTabType:    asForcedTabType(r.forcedTabType),
      forcedRecordType: r.forcedRecordType ?? undefined,
      result:        jparse(r.result),
      totalInserted: r.totalInserted ?? undefined,
      totalErrors:   r.totalErrors   ?? undefined,
      importMode:    r.importMode ?? undefined,
      fileData:      r.fileData ?? undefined,
    };
  } catch {
    return null;
  }
}

// Get a job INCLUDING the original file bytes. The in-memory copy may be a
// meta-only row cached by the status-poll DB fallback (fileData stripped to
// keep polls cheap), so when the file is actually needed we must do a full
// DB load and back-fill the cached copy.
async function getJobWithFile(uploadId: string): Promise<JobRecord | null> {
  const cached = _jobs.get(uploadId);
  if (cached?.fileData) return cached;
  const full = await loadJobFromDb(uploadId);
  if (!full) return cached ?? null;
  // (loadJobFromDb marks _persistedOnce when the row proves a durable copy.)
  if (cached) { cached.fileData = full.fileData; return cached; }
  _jobs.set(uploadId, full);
  return full;
}

// Warm the in-memory cache from DB on startup
(async () => {
  try {
    // Reconcile orphans: a job left "running" whose owner process died can
    // never resume (the pipeline runs in-process). BUT this boot may be a NEW
    // autoscale instance starting while a sibling instance is mid-import — a
    // blanket reset used to fail LIVE runs, producing the false "session was
    // disconnected" flicker in prod. The reset is therefore staleness-gated:
    // only rows whose last write (updated_at, heartbeat ~60s) is >15 min old
    // are treated as orphaned. Fresh orphans linger as "Running" for up to
    // 15 min until the GET /active sweep or the next boot fails them.
    try {
      const n = await resetAllRunningOnboardingJobs("Your session was disconnected before the import could finish. Please upload your file again to continue.");
      if (n > 0) console.log(`[onboarding] boot reconcile: failed ${n} orphaned running job(s) (stale >15 min)`);
    } catch (e) {
      console.warn("[onboarding] reconcile running→failed failed:", (e as Error).message);
    }

    // Meta-only warm: skips the file_data blobs (several MB per row) so the
    // startup load stays fast and memory stays lean. Any route that needs the
    // original file bytes back-fills them on demand via getJobWithFile().
    const rows = await getRecentOnboardingJobsMeta(500);
    const sorted = rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 500);
    for (const r of sorted) {
      _jobs.set(r.uploadId, {
        uploadId:      r.uploadId,
        tenantId:      r.tenantId,
        fileName:      r.fileName,
        s3Key:         r.s3Key ?? undefined,
        status:        r.status as JobRecord["status"],
        createdAt:     new Date(r.createdAt).toISOString(),
        sheets:        jparse<JobRecord["sheets"]>(r.sheets),
        forcedTabType:    asForcedTabType(r.forcedTabType),
        forcedRecordType: r.forcedRecordType ?? undefined,
        result:        jparse(r.result),
        totalInserted: r.totalInserted ?? undefined,
        totalErrors:   r.totalErrors   ?? undefined,
        fileData:      undefined,
      });
    }
    console.log(`[onboarding] loaded ${sorted.length} job(s) from DB`);
  } catch (e) {
    console.warn("[onboarding] could not load jobs from DB (table may not exist yet):", (e as Error).message);
  }
})();

// ── GET /api/onboarding/has-data ─────────────────────────────────────────
// Cheap "does this tenant have any live records?" probe. Used by the web
// SetupGate as a fallback when import history is empty — e.g. tenants seeded
// by cloning, direct DB writes, or manual record creation never have a
// successful import job, but they DO have real data and must not be bounced
// back to the Import page.
//
// Each table is queried independently (Promise.allSettled) so an optional
// table that doesn't exist in every deployment (e.g. Lead) only affects its
// own check — a missing table cannot invalidate the whole probe. A TOP 1
// short-circuits the scan as soon as one matching row is found.
//
// Fails OPEN for genuine DB outages: if the pool itself is unreachable we
// return hasData:true so admins are never spuriously locked out. The redirect
// is a UX guard, not a security boundary — data is still API-gated regardless.
router.get("/has-data", async (req: Request, res: Response) => {
  const src = requireTenantAccess(req, res);
  if (!src) return;

  let pool: Awaited<ReturnType<typeof getPool>>;
  try {
    pool = await getPool();
  } catch (e) {
    console.warn("[onboarding/has-data] pool unavailable, failing open:", (e as Error).message);
    return res.json({ hasData: true });
  }

  const tid = resolveTenantId(src.tenant);

  // Query each core table independently. Promise.allSettled means a missing
  // (optional) table only rejects that one promise — the others still count.
  const makeCheck = (table: string) =>
    pool.request()
      .input("tid", sql.NVarChar, tid)
      .query(
        `SELECT TOP 1 1 AS v FROM ${table} WITH (NOLOCK)` +
        ` WHERE TenantID = @tid AND (Deleted = 0 OR Deleted IS NULL)`,
      );

  const [pmm, opp, lead] = await Promise.allSettled([
    makeCheck("core2.dbo.PMM"),
    makeCheck("core2.dbo.Opportunity"),
    makeCheck("core2.dbo.Lead"),
  ]);

  const hasData =
    (pmm.status  === "fulfilled" && pmm.value.recordset.length  > 0) ||
    (opp.status  === "fulfilled" && opp.value.recordset.length  > 0) ||
    (lead.status === "fulfilled" && lead.value.recordset.length > 0);

  return res.json({ hasData });
});

// ── GET /api/onboarding/db-status ─────────────────────────────────────────
router.get("/db-status", async (_req: Request, res: Response) => {
  const [db, s3] = await Promise.all([dbStatus(), Promise.resolve(storageStatus())]);
  res.json({ db, s3 });
});

// ── GET /api/onboarding/schema ────────────────────────────────────────────
router.get("/schema", async (_req: Request, res: Response) => {
  const schema = await getUniversalSchema();
  res.json({ schema, tableCount: Object.keys(schema).length });
});

// ── One-import-at-a-time per tenant ────────────────────────────────────────
// Ghost windows shared by every sweep (GET /active, GET /status, and the
// background timer below). Staleness is judged from the last sign of life —
// in-memory lastActivityAt or the DB heartbeat updated_at — NEVER createdAt.
// Two tiers because the two states have different liveness contracts:
//   - running: the owning process heartbeats updated_at every ~60s, so 10
//     minutes of silence (10 missed beats) means it is dead (crash / OOM /
//     redeploy). Big imports legitimately run for hours — only silence is
//     fatal, never age.
//   - pending: nothing runs and nothing heartbeats — the file was parsed and
//     is waiting for the user to press Run. 5 minutes with no /run means the
//     upload was abandoned (closed tab, dropped network, unanswered popup);
//     auto-cancel it quickly so it stops blocking the tenant's
//     one-import-at-a-time slot and stops showing as an endless import.
//     A late Run still works: /run only rejects "running" rows, so it
//     revives an auto-cancelled pending row if the user answers slowly.
const RUNNING_IMPORT_STALE_MS = 10 * 60 * 1000;
const PENDING_IMPORT_STALE_MS = 5 * 60 * 1000;
const staleMsFor = (status: string): number =>
  status === "pending" ? PENDING_IMPORT_STALE_MS : RUNNING_IMPORT_STALE_MS;
const ghostMessage = (status: string): string =>
  status === "pending"
    ? "Upload was cancelled because the import was never started (no activity for 5 minutes). Please upload the file again."
    : "Import stopped — no progress for 10 minutes. The server may have been busy or restarted. Please upload your file again.";

/** Deploy-drain probe backing GET /api/healthz/imports (routes/health.ts).
 *
 *  Counts imports active RIGHT NOW across the whole fleet — the shared jobs
 *  table is the only source that sees every worker on every instance — judged
 *  by the SAME two-tier liveness contract the ghost sweeps use above. Rows
 *  past their staleness window are reported separately (staleIgnored) and do
 *  NOT block a deploy: they are already dead and the sweeps will fail them;
 *  waiting on a ghost would wedge the pipeline for hours.
 *
 *  Aggregate counts only — no tenant labels, file names, or upload ids leak
 *  through the unauthenticated health surface. */
export interface ActiveImportsSummary {
  /** Imports executing a pipeline right now (fresh heartbeat). Replacing an
   *  instance mid-run kills the run partway through its writes. */
  running: number;
  /** Fresh uploads waiting for the user to press Run. Deploy-safe (state is
   *  persisted; /run works against the new instance) — reported so stricter
   *  pipelines MAY wait for zero. */
  pending: number;
  /** Rows inside the lookback that already exceeded their liveness window —
   *  ghosts awaiting sweep, never a reason to hold a deploy. */
  staleIgnored: number;
  /** Distinct tenants across running+pending. */
  tenants: number;
  /** Age in ms of the oldest active row (progress signal for pollers). */
  oldestActiveAgeMs: number | null;
}

export async function summarizeActiveImports(): Promise<ActiveImportsSummary> {
  const rows = await getRunningOnboardingJobsMeta();
  const nowMs = Date.now();
  let running = 0;
  let pending = 0;
  let staleIgnored = 0;
  let oldestActiveAgeMs: number | null = null;
  const tenants = new Set<string>();
  for (const r of rows) {
    const heartbeatAge = nowMs - new Date(r.updatedAt).getTime();
    if (heartbeatAge > staleMsFor(r.status)) {
      staleIgnored++;
      continue;
    }
    if (r.status === "running") running++;
    else pending++;
    tenants.add(normTenant(r.tenantId));
    const age = nowMs - new Date(r.createdAt).getTime();
    if (oldestActiveAgeMs === null || age > oldestActiveAgeMs) oldestActiveAgeMs = age;
  }
  return { running, pending, staleIgnored, tenants: tenants.size, oldestActiveAgeMs };
}

/**
 * Cross-worker check: is ANOTHER import (running, or pending and fresh)
 * already active for this tenant? Enforces one-import-at-a-time per company
 * at /upload and /run — two concurrent pipelines for the same tenant compete
 * for pool connections and can interleave writes on the same rows.
 *
 * Sources, in order:
 *  1. This worker's in-memory jobs — catches the just-uploaded window where
 *     the multi-MB pending INSERT hasn't landed in the DB yet. Liveness is
 *     judged from lastActivityAt when present (only the worker running the
 *     pipeline bumps it), else createdAt (pending rows have no activity yet).
 *  2. The shared jobs table (running + pending with a fresh heartbeat) — the
 *     only source that can see jobs owned by other workers/instances.
 *
 * NEVER throws: a DB probe failure returns null (fail-open, with a warn) so
 * a transient outage cannot lock a tenant out of uploading — the import slot
 * queue and the pipeline's own failure handling remain the backstops.
 */
async function findActiveImportForTenant(
  tenant: string,
  excludeUploadId?: string,
): Promise<{ uploadId: string; fileName: string | null; status: string } | null> {
  const norm  = normTenant(tenant);
  const nowMs = Date.now();

  for (const j of _jobs.values()) {
    if (j.uploadId === excludeUploadId) continue;
    if (normTenant(j.tenantId) !== norm) continue;
    if (j.status !== "running" && j.status !== "pending") continue;
    // Ownership rule (see GET /active): judge liveness from memory ONLY via a
    // clock that actually advances on this worker — lastActivityAt. Copies of
    // OTHER workers' jobs hydrated from the DB by /status reads carry no
    // lastActivityAt and MUST defer to the DB check below; falling back to
    // createdAt here made any worker that had merely served a /status poll
    // mid-run keep 409ing new uploads long after the import finished (its
    // hydrated copy stays "running" forever — only the DB row flips to
    // success). Uploads stamp lastActivityAt at creation, so the creating
    // worker still guards its own upload→run gap.
    const lastTick = j.lastActivityAt;
    if (lastTick === undefined) continue;
    if (nowMs - lastTick > staleMsFor(j.status)) continue;
    return { uploadId: j.uploadId, fileName: j.fileName ?? null, status: j.status };
  }

  try {
    const rows = await getRunningOnboardingJobsMeta();
    for (const r of rows) {
      if (r.uploadId === excludeUploadId) continue;
      if (normTenant(r.tenantId) !== norm) continue;
      // Ghost — the sweeps own failing it; just don't block on it.
      if (nowMs - new Date(r.updatedAt).getTime() > staleMsFor(r.status)) continue;
      // This worker may already know the job reached a terminal state (its
      // memory is fresher than a lagging DB row).
      const known = _jobs.get(r.uploadId);
      if (known && known.status !== "running" && known.status !== "pending") continue;
      return { uploadId: r.uploadId, fileName: r.fileName ?? null, status: r.status };
    }
  } catch (e) {
    console.warn("[onboarding] active-import probe failed — allowing (fail-open):", (e as Error)?.message);
  }
  return null;
}

// ── Background ghost sweep ─────────────────────────────────────────────────
// The sweeps in GET /active and GET /status are lazy — they only fire while
// someone is polling. If nobody has the import page open, a dead job used to
// sit "pending"/"running" in the shared jobs table until the next poll or a
// server boot happened to look (a real upload once showed endless progress
// for ~22 minutes this way). This timer makes cleanup punctual: each worker
// runs the same cheap meta query once a minute and fails rows whose
// heartbeat has been silent past their tier's window (5 min pending / 10 min
// running — see the tier comment above).
// Safe across workers and instances: the flip is conditional in SQL (only
// rows still pending/running are touched), so a pipeline that finishes
// between the scan and the UPDATE keeps its real terminal status, and
// overlapping sweeps are idempotent. Never flips a job whose LOCAL in-memory
// copy is fresh — the owning worker's clock (lastActivityAt) can advance
// while heartbeat UPDATEs lag under DB strain.
let _ghostSweepBusy = false;
async function sweepGhostImports(): Promise<void> {
  if (_ghostSweepBusy) return;
  _ghostSweepBusy = true;
  try {
    const nowMs = Date.now();
    const rows = await getRunningOnboardingJobsMeta();
    for (const r of rows) {
      const age = nowMs - new Date(r.updatedAt).getTime();
      if (age <= staleMsFor(r.status)) continue;
      const local = _jobs.get(r.uploadId);
      if (local?.lastActivityAt !== undefined
          && nowMs - local.lastActivityAt <= staleMsFor(local.status)) continue;
      const msg = ghostMessage(r.status);
      const flipped = await failOnboardingJobIfActive(r.uploadId, msg).catch(() => false);
      if (!flipped) continue; // reached a terminal state in the meantime
      console.warn(`[onboarding] ghost sweep: auto-${r.status === "pending" ? "cancelled never-started" : "failed silent"} job ${r.uploadId} (tenant ${r.tenantId}) after ${Math.round(age / 60_000)} min without activity`);
      if (local && (local.status === "running" || local.status === "pending")) {
        local.status = "failed";
        local.errorDetail = msg;
        local.result = { ...(local.result ?? {}), failureReason: msg };
      }
    }
  } catch { /* transient DB error — next tick retries */ }
  finally { _ghostSweepBusy = false; }
}
const _ghostSweepTimer = setInterval(() => { void sweepGhostImports(); }, 60_000);
_ghostSweepTimer.unref?.();

// ── GET /api/onboarding/active ─────────────────────────────────────────────
// Returns the currently running or pending import job for the caller's tenant.
// Used by the import page to show progress bars and block concurrent uploads.
router.get("/active", async (req: Request, res: Response) => {
  const src = resolveRequestSource(req);
  if (!src) return res.status(401).json({ error: "Authentication required" });

  const norm = normTenant(src.tenant);

  // Derive which frontend module IDs are involved in a job. Precision order:
  // 1. forcedRecordType — the exact module card the upload was submitted from
  //    (stamped at /upload and /run by the web import page).
  // 2. Sheets that actually carry rows. Grid submissions always export their
  //    EMPTY side tabs too (Team Assignments / Schedule), so a 0-row sheet
  //    must never light up a module the user didn't touch.
  // 3. Coarse card-intent / all-modules fallbacks — only when nothing above
  //    resolved (messy files whose sheets didn't map to known tables). The
  //    old code checked forcedTabType==="clients" FIRST, which flagged
  //    projects+opportunities+leads together for every grid upload.
  function deriveModules(job: JobRecord): string[] {
    const mods = new Set<string>();
    const rt = String(job.forcedRecordType ?? "");
    if      (rt === "Project")     mods.add("projects");
    else if (rt === "Opportunity") mods.add("opportunities");
    else if (rt === "Lead")        mods.add("leads");
    if (job.forcedTabType === "team" || job.forcedTabType === "assignments") {
      mods.add("team");
    }
    for (const s of (job.sheets ?? [])) {
      if (!s.totalRows) continue;
      if      (s.tableName === "PMM")              mods.add("projects");
      else if (s.tableName === "Opportunity")      mods.add("opportunities");
      else if (s.tableName === "Lead")             mods.add("leads");
      else if (s.tableName === "CRMCompany")       mods.add("companies");
      else if (s.tableName === "ResourceWorkItems" || s.tableName === "AspNetUsers") mods.add("team");
    }
    if (mods.size === 0 && job.forcedTabType === "clients") {
      ["projects", "opportunities", "leads"].forEach(m => mods.add(m));
    }
    // Fall back: if nothing resolved, treat all data modules as running.
    if (mods.size === 0) {
      ["projects", "opportunities", "leads", "team"].forEach(m => mods.add(m));
    }
    return [...mods];
  }

  // A job with no pipeline activity for more than 15 minutes means the process
  // died without cleanup. Treat it as a ghost — mark it failed so the banner
  // disappears instead of showing indefinitely after an interrupted run.
  // IMPORTANT: staleness is measured from the LAST ACTIVITY (progress events
  // bump lastActivityAt in-memory and heartbeat updated_at in the DB), never
  // from createdAt — big imports legitimately run for longer than 15 minutes,
  // and the old age-based check falsely failed them while they were still
  // actively inserting rows.
  const running = [..._jobs.values()].find(j => {
    if (normTenant(j.tenantId) !== norm) return false;
    if (j.status !== "running" && j.status !== "pending") return false;
    // OWNERSHIP RULE: lastActivityAt is only ever set on the worker actually
    // executing the pipeline (/run). Copies held by OTHER workers (created by
    // /upload, or cached from DB reads) never have it — those workers must not
    // judge liveness from memory at all: their copy's clock never advances, so
    // any fixed age check would falsely fail a live long-running import that
    // is heartbeating from the sibling worker. They defer to the DB fallback
    // below, which keys on the heartbeat-maintained updated_at.
    if (j.lastActivityAt === undefined) return false;
    const age = Date.now() - j.lastActivityAt;
    if (age > staleMsFor(j.status)) {
      // This worker owns the job and it has shown no sign of life past its
      // tier's window (10 min silent while running, 5 min never-started while
      // pending) — genuinely dead. Fail it so it stops blocking the UI and
      // the tenant's import slot.
      const msg = ghostMessage(j.status);
      j.status = "failed";
      j.errorDetail = msg;
      j.result = { ...(j.result ?? {}), failureReason: msg };
      void updateOnboardingJob(j.uploadId, { status: "failed", errorDetail: msg });
      return false;
    }
    return true;
  });

  if (running) {
    return res.json({
      active:    true,
      uploadId:  running.uploadId,
      fileName:  running.fileName,
      status:    running.status,
      modules:   deriveModules(running),
    });
  }

  // Cross-worker fallback: this worker's in-memory map only knows jobs it
  // created itself (plus the startup warm, which never contains running jobs
  // because the startup reconcile fails them first). A job started on the
  // OTHER cluster worker is invisible here, so answering active:false from
  // memory alone makes the banner flicker as the browser's polls alternate
  // between workers. Ask the DB — throttled and cached per tenant so the 3s
  // poll costs at most one cheap meta query per 4s across all clients.
  const nowMs = Date.now();
  const cached = _activeDbCache.get(norm);
  if (cached && nowMs - cached.at < 4_000) {
    return res.json(cached.resp ?? { active: false });
  }
  let resp: Record<string, unknown> | null = null;
  try {
    const dbRows = await getRunningOnboardingJobsMeta();
    for (const r of dbRows) {
      if (normTenant(r.tenantId) !== norm) continue;
      // Ghost guard mirrors the in-memory path: a DB row with no heartbeat
      // (updated_at) inside the stale window is never surfaced. The running
      // worker heartbeats updated_at every ~60s, so a live job on the OTHER
      // worker always passes this check no matter how long it has been going.
      // Rows that ARE stale get failed in the DB too — with the ownership rule
      // above, no in-memory sweep cleans up rows whose owning worker died.
      // Safe: the owning worker's sweep would have failed it already if it
      // were alive-but-hung, a live pipeline can't outlast its tier's window
      // without a heartbeat, and the flip is conditional in SQL (pending/
      // running only) so a job finishing mid-flight keeps its real status.
      if (nowMs - new Date(r.updatedAt).getTime() > staleMsFor(r.status)) {
        void failOnboardingJobIfActive(r.uploadId, ghostMessage(r.status))
          .catch(() => { /* best-effort cleanup */ });
        continue;
      }
      // Never resurrect a job this worker already knows reached a terminal
      // state (its own memory is fresher than a lagging DB row can be).
      const known = _jobs.get(r.uploadId);
      if (known && known.status !== "running" && known.status !== "pending") continue;
      const rec: JobRecord = known ?? {
        uploadId:   r.uploadId,
        tenantId:   r.tenantId,
        fileName:   r.fileName,
        s3Key:      r.s3Key ?? undefined,
        status:     r.status as JobRecord["status"],
        createdAt:  new Date(r.createdAt).toISOString(),
        createdBy:  r.createdBy ?? undefined,
        sheets:     jparse<JobRecord["sheets"]>(r.sheets),
        forcedTabType:    asForcedTabType(r.forcedTabType),
        forcedRecordType: r.forcedRecordType ?? undefined,
        importMode: r.importMode ?? undefined,
      };
      // NOTE: deliberately NOT cached into _jobs — this worker isn't running
      // the pipeline, so a cached "running" copy would go stale forever here
      // once the job finishes on the other worker. The short-TTL response
      // cache above keeps polls stable instead.
      resp = {
        active:   true,
        uploadId: rec.uploadId,
        fileName: rec.fileName,
        status:   rec.status,
        modules:  deriveModules(rec),
      };
      break;
    }
  } catch (e) {
    // DB hiccup — answer from the last cached value if we have one so the
    // banner doesn't blink off during a transient connection error.
    if (cached) return res.json(cached.resp ?? { active: false });
  }
  _activeDbCache.set(norm, { at: nowMs, resp });
  return res.json(resp ?? { active: false });
});

// ── GET /api/onboarding/data-summary ──────────────────────────────────────
// Per-area existing-data counts for the caller's tenant, read from LIVE core2
// tables. Drives the import page's "how should we apply this file?" question
// in two layers: each module CARD gates ONLY on its own primary area
// (projects → PMM, opportunities → Opportunity, leads → Lead, team → app
// users), and the grid applies a second, file-content-aware gate at submit —
// it asks only when an area the FILE actually carries rows for (per tab:
// assignments/allocations, schedules, …) already has data. Module cards must
// still NOT gate on the shared side-tables (assignments/schedules/companies)
// directly, since another module's import fills them and that caused false
// popups; only the per-tab submit gate may consult them. The login account
// lives in the app DB
// (rmone_users), NOT in core2 AspNetUsers, so a fresh tenant correctly
// reports all zeros here even though it can sign in. Short per-tenant TTL
// keeps repeat visits cheap.
const _dataSummaryCache = new Map<string, { at: number; resp: Record<string, number> }>();
router.get("/data-summary", async (req: Request, res: Response) => {
  const src = resolveRequestSource(req);
  if (!src) return res.status(401).json({ error: "Authentication required" });
  // Superadmins may pass ?tenant= to probe another company's data counts —
  // the same override pattern used by /ticket-ids. Non-superadmin callers are
  // always pinned to their own JWT tenant regardless of what they send.
  const qTenant = String((req.query.tenant as string) ?? "").trim();
  const effectiveTenantLabel = qTenant && isSuperAdminSource(src) ? qTenant : src.tenant;
  const tid = resolveTenantId(effectiveTenantLabel);
  // The staff count excludes the CALLER's own login (see below), so the cached
  // response is per tenant+viewer, not per tenant. For superadmins targeting
  // another tenant the self-exclusion uses their own username (still correct —
  // the superadmin is not a real user in the target tenant).
  const selfLower = String(src.username ?? "").trim().toLowerCase();
  const cacheKey = `${tid}|${selfLower}`;
  const cached = _dataSummaryCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 15_000) return res.json(cached.resp);
  const AREAS: Array<[key: string, table: string]> = [
    ["projects",      "PMM"],
    ["opportunities", "Opportunity"],
    ["leads",         "Lead"],
    ["companies",     "CRMCompany"],
    ["assignments",   "ResourceWorkItems"],
    ["allocations",   "ResourceAllocation"],
    ["schedules",     "PMMTasks"],
  ];
  try {
    const pool = await getPool();
    const out: Record<string, number> = {};
    const parts: string[] = [];
    for (const [key, t] of AREAS) {
      const cols = await tableColumns(t);
      if (!cols.has("TenantID")) { out[key] = 0; continue; }
      const del = cols.has("Deleted") ? "AND ([Deleted] = 0 OR [Deleted] IS NULL)" : "";
      parts.push(`SELECT '${key}' AS k, COUNT(*) AS n FROM core2.dbo.[${t}] WITH (NOLOCK) WHERE [TenantID] = @tid ${del}`);
    }
    if (parts.length) {
      const r = await pool.request().input("tid", sql.NVarChar, tid).query(parts.join(" UNION ALL "));
      for (const row of (r.recordset ?? []) as Array<{ k: string; n: number }>) out[row.k] = Number(row.n) || 0;
    }
    for (const [key] of AREAS) if (!(key in out)) out[key] = 0;
    // staff: team imports write people to the APP users table (rmone_users) —
    // the pipeline's "AspNetUsers" case name is a legacy artifact and core2's
    // AspNetUsers table is never filled by imports, so counting it left staff
    // permanently 0 and the team card silently skipped the import-mode
    // question. Count active app users EXCLUDING the caller's own login: a
    // fresh tenant has only its provisioning account(s) and must not trigger
    // the question (mirrors the frontend's exclude-self fallback badge logic).
    const users = await getActiveUsersByTenant(tid);
    out.staff = users.filter(
      (u) => String(u.username ?? "").trim().toLowerCase() !== selfLower,
    ).length;
    // Bounded eviction: keys are per tenant+viewer now, so a long-lived worker
    // could accumulate entries. Sweep expired ones past a small cap; hard-clear
    // if somehow still oversized (15s TTL makes this loss-free).
    if (_dataSummaryCache.size > 500) {
      const now = Date.now();
      for (const [k, v] of _dataSummaryCache) if (now - v.at >= 15_000) _dataSummaryCache.delete(k);
      if (_dataSummaryCache.size > 500) _dataSummaryCache.clear();
    }
    _dataSummaryCache.set(cacheKey, { at: Date.now(), resp: out });
    return res.json(out);
  } catch {
    // Fail CLOSED like tenantHasData: when we can't tell, the frontend must
    // ASK the import-mode question rather than silently fast-path to create.
    return res.status(503).json({ error: "data summary unavailable" });
  }
});

// ── GET /api/onboarding/ticket-ids ────────────────────────────────────────
// Every existing Project + Opportunity ticket ID for the caller's tenant.
// Feeds the import page's standalone Team Assignments / Schedule cards: rows
// there reference records by ID (PMM-… or OPM-…), so the grid needs the real
// ID list to flag unknown references as-you-type and to auto-correct
// separator/case drift ("pmm 26 020" → "PMM-26-020") to the DB's exact form.
// Superadmins may pass ?tenant= (the data-cleaning handoff operates on
// another tenant). Failure returns 503 rather than an empty list — an empty
// 200 means "this tenant truly has no records" and correctly flags every
// reference, which must only happen when the DB really says so.
//
// Large-tenant optimization: tenants with more than TICKET_IDS_LARGE_THRESHOLD
// records skip shipping the full ID list (which can be 500KB+ for 50k records).
// Instead the response carries { ids: [], count, large: true } and the client
// switches to server-side batch checking via POST /check-ticket-ids.
const TICKET_IDS_LARGE_THRESHOLD = 10_000;
const _ticketIdsCache = new Map<string, { at: number; ids: string[] }>();
router.get("/ticket-ids", async (req: Request, res: Response) => {
  const src = resolveRequestSource(req);
  if (!src) return res.status(401).json({ error: "Authentication required" });
  const qTenant = String((req.query.tenant as string) ?? "").trim();
  const tid = resolveTenantId(qTenant && isSuperAdminSource(src) ? qTenant : src.tenant);
  const cached = _ticketIdsCache.get(tid);
  if (cached && Date.now() - cached.at < 15_000) {
    const count = cached.ids.length;
    if (count > TICKET_IDS_LARGE_THRESHOLD) {
      return res.json({ ids: [], count, large: true });
    }
    return res.json({ ids: cached.ids, count });
  }
  try {
    const pool = await getPool();
    const parts: string[] = [];
    for (const t of ["PMM", "Opportunity"]) {
      const cols = await tableColumns(t);
      if (!cols.has("TenantID") || !cols.has("TicketId")) continue;
      const del = cols.has("Deleted") ? "AND ([Deleted] = 0 OR [Deleted] IS NULL)" : "";
      parts.push(`SELECT [TicketId] AS id FROM core2.dbo.[${t}] WITH (NOLOCK) WHERE [TenantID] = @tid AND [TicketId] IS NOT NULL AND LTRIM(RTRIM([TicketId])) <> '' ${del}`);
    }
    const ids: string[] = [];
    if (parts.length) {
      const r = await pool.request().input("tid", sql.NVarChar, tid).query(parts.join(" UNION ALL "));
      for (const row of (r.recordset ?? []) as Array<{ id: string }>) {
        const v = String(row.id ?? "").trim();
        if (v) ids.push(v);
      }
    }
    _ticketIdsCache.set(tid, { at: Date.now(), ids });
    const count = ids.length;
    if (count > TICKET_IDS_LARGE_THRESHOLD) {
      // Don't ship the full list — the client uses POST /check-ticket-ids instead.
      return res.json({ ids: [], count, large: true });
    }
    return res.json({ ids, count });
  } catch {
    // Fail OPEN on the client (it skips the check when the list is missing);
    // the server-side ghost-reference guard still blocks bad rows at import.
    return res.status(503).json({ error: "ticket ids unavailable" });
  }
});

// ── POST /api/onboarding/check-ticket-ids ─────────────────────────────────
// Batch "which of these IDs exist?" endpoint for large tenants where shipping
// the full ID list is too expensive. The client sends all the ID-column values
// from the current grid; the server returns which ones actually exist in core2
// so the client can highlight unknowns before the user submits.
// Also used by the ID-suggestion feature (task 130).
// Body: { ids: string[]; tenant?: string }   (tenant = superadmin override)
// Response: { found: string[]; notFound: string[] }
router.post("/check-ticket-ids", async (req: Request, res: Response) => {
  const src = resolveRequestSource(req);
  if (!src) return res.status(401).json({ error: "Authentication required" });
  const body = req.body ?? {};
  const qTenant = String(body.tenant ?? "").trim();
  const tid = resolveTenantId(qTenant && isSuperAdminSource(src) ? qTenant : src.tenant);
  const raw: unknown = body.ids;
  if (!Array.isArray(raw) || raw.length === 0) return res.json({ found: [], notFound: [] });
  // Cap to 5 000 IDs per call to prevent abuse / runaway queries.
  const incoming = (raw as unknown[]).slice(0, 5_000)
    .map(v => String(v ?? "").trim())
    .filter(Boolean);
  if (incoming.length === 0) return res.json({ found: [], notFound: [] });
  try {
    // Use the in-memory cache when warm (15s TTL same as GET /ticket-ids).
    const cached = _ticketIdsCache.get(tid);
    if (cached && Date.now() - cached.at < 15_000) {
      const exact = new Set(cached.ids.map(id => id.toLowerCase()));
      const found: string[] = [];
      const notFound: string[] = [];
      for (const id of incoming) {
        (exact.has(id.toLowerCase()) ? found : notFound).push(id);
      }
      return res.json({ found, notFound });
    }
    // Cache miss — query the DB directly for just the submitted IDs.
    // We use a VALUES table to avoid shipping 50k rows back when we only
    // need a membership check on the (at most 5 000) incoming IDs.
    const pool = await getPool();
    const parts: string[] = [];
    for (const t of ["PMM", "Opportunity"]) {
      const cols = await tableColumns(t);
      if (!cols.has("TenantID") || !cols.has("TicketId")) continue;
      const del = cols.has("Deleted") ? "AND ([Deleted] = 0 OR [Deleted] IS NULL)" : "";
      parts.push(
        `SELECT [TicketId] AS id FROM core2.dbo.[${t}] WITH (NOLOCK)` +
        ` WHERE [TenantID] = @tid AND [TicketId] IS NOT NULL AND LTRIM(RTRIM([TicketId])) <> '' ${del}`,
      );
    }
    if (!parts.length) return res.json({ found: [], notFound: incoming });
    const r = await pool.request().input("tid", sql.NVarChar, tid).query(parts.join(" UNION ALL "));
    // Populate the cache as a side-effect so the next GET /ticket-ids is free.
    const allIds = (r.recordset ?? []).map((row: { id: string }) => String(row.id ?? "").trim()).filter(Boolean);
    _ticketIdsCache.set(tid, { at: Date.now(), ids: allIds });
    const exact = new Set(allIds.map(id => id.toLowerCase()));
    const found: string[] = [];
    const notFound: string[] = [];
    for (const id of incoming) {
      (exact.has(id.toLowerCase()) ? found : notFound).push(id);
    }
    return res.json({ found, notFound });
  } catch {
    return res.status(503).json({ error: "ticket ids unavailable" });
  }
});

// ── POST /api/onboarding/upload ───────────────────────────────────────────
router.post("/upload", uploadSingleFile, async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file uploaded" });
  return handleOnboardingUpload(
    { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
    req, res,
  );
});

// Chunked variant for files past the ~32MB production edge cap: the frontend
// sends ~20MB pieces to /upload-chunk, then /upload-complete reassembles the
// file and flows through the EXACT same handler as the classic route above.
// (tenantId / forcedTabType / forcedRecordType ride along in the complete
// call's JSON body, which the handler already reads via req.body.)
registerChunkUploadRoutes(router, {
  maxAssembledBytes: UPLOAD_MAX_BYTES,
  onComplete: (f, cReq, cRes) => handleOnboardingUpload(f, cReq, cRes),
});

// Shared body of POST /upload and the chunked /upload-complete path.
async function handleOnboardingUpload(
  file: { buffer: Buffer; originalname: string; mimetype: string },
  req: Request,
  res: Response,
) {
  try {
    const tenantIdBody = String(req.body.tenantId ?? "").trim();
    // Trusted tenant scoping: the login token decides which company an import
    // may target. A regular company user is ALWAYS pinned to their own login
    // tenant — the body value is only a hint and is ignored if it differs, so
    // no one can import into (or probe) another company by crafting requests.
    // Only a verified superadmin (the onboarding wizard) may name another
    // company, including brand-new labels that don't exist yet.
    const jwtSrc = resolveRequestSource(req);
    if (!jwtSrc) return res.status(401).json({ error: "Authentication required" });
    const tenantId = isSuperAdminSource(jwtSrc) ? (tenantIdBody || jwtSrc.tenant) : jwtSrc.tenant;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
    if (!(await requireImportAccess(req, res, tenantId))) return;

    // One-import-at-a-time per company: while a file is importing (or is
    // freshly queued), a second upload for the same tenant is refused with a
    // clear message instead of silently racing it. The import page opens its
    // live-progress popup off this 409's code + activeUploadId.
    const activeImp = await findActiveImportForTenant(tenantId);
    if (activeImp) {
      return res.status(409).json({
        error: `A file is already importing for your company${activeImp.fileName ? ` ("${activeImp.fileName}")` : ""}. Please wait until it completes, then upload the next file.`,
        code: "IMPORT_IN_PROGRESS",
        activeUploadId: activeImp.uploadId,
        activeFileName: activeImp.fileName,
      });
    }

    // Optional hint sent by module-card uploads so the server treats every sheet
    // as this data category regardless of the sheet name.
    const VALID_FORCED = ["team", "clients", "assignments"] as const;
    const forcedTabTypeRaw = String(req.body.forcedTabType ?? "").trim();
    const forcedTabType = VALID_FORCED.includes(forcedTabTypeRaw as typeof VALID_FORCED[number])
      ? (forcedTabTypeRaw as "team" | "clients" | "assignments")
      : null;
    const forcedRecordType = String(req.body.forcedRecordType ?? "").trim() || null;

    // A client may already exist. We DON'T block here anymore — recurring uploads
    // are supported. We surface the conflict so the UI can ask the user how to
    // handle it (update matching / add new only / replace), defaulting new names
    // to a normal first-time import.
    let existing = await findTenantConflict(tenantId);
    // The jobs table only knows about imports that went through this wizard.
    // A tenant can also get data via seeding, chat-assign, or manual adds — in
    // that case there is NO job row, but silently running a "create" import
    // over live data skips every prune/dedupe path and strands stale rows.
    // Probe the real tables so the UI always asks update/add/replace whenever
    // ANY data exists, regardless of how it got there.
    if (!existing && (await tenantHasData(tenantId))) {
      existing = { status: "provisioned", fileName: "", createdAt: new Date().toISOString() };
    }

    const ext = file.originalname.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls"].includes(ext ?? "")) {
      return res.status(400).json({ error: "Only .xlsx and .xls files are accepted" });
    }

    const uploadId = uuidv4();
    const s3Key    = buildS3Key(tenantId, uploadId, file.originalname, "original");

    // ── Change 4: persist a slim metadata row BEFORE parsing ──────────────────
    // A failed previewExcel (malformed / too large without S3) used to leave no
    // trace in the jobs table. Now the row is created immediately so /history
    // always shows what was attempted, and /status never races a missing row.
    // The fileData blob (non-S3 fallback only) is persisted later, after parse,
    // and awaited before the HTTP response so cross-worker /run finds it in DB.
    const job: JobRecord = {
      uploadId,
      tenantId,
      fileName:         file.originalname,
      s3Key:            undefined,
      status:           "pending",
      createdAt:        new Date().toISOString(),
      // Stamp the ownership clock at creation: findActiveImportForTenant only
      // trusts in-memory entries that carry lastActivityAt (worker-local
      // clock), so without this the creating worker's own upload→run gap
      // would only be guarded by the DB row.
      lastActivityAt:   Date.now(),
      createdBy:        jwtSrc?.username || undefined,
      forcedTabType:    forcedTabType    ?? undefined,
      forcedRecordType: forcedRecordType ?? undefined,
    };
    _jobs.set(uploadId, job);
    // Slim write (no fileData) — fast (<100ms), ensures DB row exists before parse.
    await persistJob(job);

    // ── Durability BEFORE parse: S3 upload + no-S3 size gate ─────────────────
    // Both must run ahead of previewExcel: the gate exists to protect the
    // worker from parse/base64 memory on files that could never complete the
    // non-S3 path, so parsing first would defeat it. The slim row above keeps
    // the rejected attempt visible in /history.
    let s3Stored = false;
    try {
      await uploadFile(s3Key, file.buffer, file.mimetype);
      s3Stored = true;
    } catch (e) {
      // S3 not configured / bucket rejects writes — fall back to a base64 copy
      // in the DB row. Warn (throttled) instead of staying silent: the silent
      // catch hid a permanently broken bucket for months, so every upload rode
      // the heavier DB-blob path without anyone knowing.
      if (Date.now() - _lastS3WarnAt > 10 * 60_000) {
        _lastS3WarnAt = Date.now();
        console.warn("[onboarding] S3 upload failed — storing file in DB instead:", (e as Error).message);
      }
    }

    // Size gate: base64-in-DB costs ~2.7× the raw file size on the wire and
    // keeps a copy in every worker's heap for the duration of the run. Files
    // >20 MB must go through S3; without it, refuse before any parse work.
    const FILE_MAX_NO_S3 = 20 * 1024 * 1024; // 20 MB
    if (!s3Stored && file.buffer.length > FILE_MAX_NO_S3) {
      job.status = "failed";
      void persistJob(job); // chained after the slim write
      return res.status(400).json({
        error: `Files larger than ${Math.round(FILE_MAX_NO_S3 / (1024 * 1024))} MB require S3 storage to be configured. Please contact your administrator, or split the file into smaller parts.`,
      });
    }

    // Parse the preview. If this throws (corrupt file), the DB row above
    // records the attempt (marked failed below) so the user can see what happened.
    let preview: Awaited<ReturnType<typeof previewExcel>>;
    try {
      preview = await previewExcel(file.buffer);
    } catch (parseErr: any) {
      job.status = "failed";
      void persistJob(job); // chained after the slim write
      console.error("[onboarding] /upload parse failure:", parseErr?.stack ?? parseErr);
      return res.status(400).json({ error: `Could not parse file: ${parseErr.message ?? String(parseErr)}` });
    }

    // Load DB synonyms grouped by tab so each sheet gets the most precise match:
    // global (tabType=null) ones apply everywhere; tab-specific ones (e.g. team,
    // clients, assignments) are merged on top for the matching sheet only.
    // This way "Type" → AllocationType is only active on the assignments tab and
    // does not bleed over to clients where "Type" means something different.
    const globalSynonymMap: Record<string, string>             = {};
    const tabSynonymMap:    Record<string, Record<string, string>> = {};
    try {
      const synRows = await getAllSynonymMappings();
      for (const r of synRows) {
        if (!r.tabType) {
          globalSynonymMap[r.alias] = r.canonicalField;
        } else {
          if (!tabSynonymMap[r.tabType]) tabSynonymMap[r.tabType] = {};
          tabSynonymMap[r.tabType][r.alias] = r.canonicalField;
        }
      }
    } catch { /* ignore — built-in synonyms still work */ }

    function buildSynonymMapForTab(tab: string | null): Record<string, string> {
      return tab ? { ...globalSynonymMap, ...(tabSynonymMap[tab] ?? {}) } : { ...globalSynonymMap };
    }

    // Read the real schema from the live core2 DB once (falls back to hardcoded)
    const liveSchema = await getUniversalSchema();

    // Enrich with table resolution + column validation + simplified analysis
    const baseSheets = preview.map(s => {
      const tableName       = resolveTable(s.sheetName);
      const validation      = tableName ? validateColumns(tableName, s.columns, liveSchema) : null;
      // Auto-detect the tab type first (name → content fallback). Only use the
      // forcedTabType (upload-card intent) for sheets that can't be identified —
      // e.g. "Sheet1". Named sheets like "Team Assignments" always win.
      const simplifiedType: "team" | "clients" | "assignments" | null =
        resolveSimplifiedTab(
          { sheetName: s.sheetName, columns: s.columns, rows: [] },
          globalSynonymMap,
        ) ?? forcedTabType ?? null;
      const sheetSynonyms  = buildSynonymMapForTab(simplifiedType);
      const simplifiedAnalysis = simplifiedType
        ? analyzeSimplifiedColumns(simplifiedType, s.columns, sheetSynonyms)
        : null;
      const canonicalFields = simplifiedType
        ? SIMPLIFIED_CANONICAL_FIELDS[simplifiedType]
        : null;
      const fieldLabels   = simplifiedType ? SIMPLIFIED_FIELD_LABELS[simplifiedType]   : null;
      const templateOrder = simplifiedType ? SIMPLIFIED_TEMPLATE_ORDER[simplifiedType] : null;
      // When strict detection fails, run a loose single-hit guess so the
      // frontend can show the user a specific "rename your tab to X" hint.
      const suggestedType = simplifiedType
        ? null
        : guessTabType(s.columns, globalSynonymMap);
      return { ...s, tableName, validation, simplifiedAnalysis, canonicalFields, fieldLabels, templateOrder, simplifiedType, suggestedType };
    });

    // LLM fallback: for any column still marked "unknown", ask GPT to suggest a match
    const sheets = await Promise.all(baseSheets.map(async s => {
      if (!s.simplifiedAnalysis || !s.simplifiedType || !s.canonicalFields) return s;

      const unknownCols = s.simplifiedAnalysis
        .filter(a => a.matchType === "unknown")
        .map(a => a.col);

      if (!unknownCols.length) return s;

      // Grab several real sample values per unknown col so the LLM can judge by
      // the actual data (e.g. emails) rather than just the header name.
      const sampleValues: Record<string, string[]> = {};
      for (const col of unknownCols) {
        const vals: string[] = [];
        for (const row of s.preview ?? []) {
          const v = row[col];
          if (v != null && String(v).trim() !== "") {
            vals.push(String(v).slice(0, 80));
            if (vals.length >= 5) break;
          }
        }
        if (vals.length) sampleValues[col] = vals;
      }

      const llmMatches = await llmMatchColumns(
        s.simplifiedType,
        unknownCols,
        s.canonicalFields,
        sampleValues,
      );

      // Patch simplifiedAnalysis with LLM suggestions
      const patchedAnalysis = s.simplifiedAnalysis.map(a => {
        if (a.matchType !== "unknown") return a;
        const llmCanonical = llmMatches[a.col];
        if (llmCanonical) return { ...a, canonical: llmCanonical, matchType: "llm" as const };
        return a;
      });

      return { ...s, simplifiedAnalysis: patchedAnalysis };
    }));

    // Update job with full metadata (S3 key + sheet info).
    // (S3 upload + no-S3 size gate already ran BEFORE previewExcel above.)
    job.s3Key  = s3Stored ? s3Key : undefined;
    job.sheets = sheets.map(s => ({
      sheetName: s.sheetName,
      columns:   s.columns,
      totalRows: s.totalRows,
      tableName: s.tableName,
    }));

    // Stash buffer for /run on the same worker. When S3 is not configured,
    // also prepare the base64 blob for DB persistence so a cross-worker /run
    // or a restart can still find the file via getJobWithFile().
    if (!s3Stored) {
      (job as any)._buffer = file.buffer;
      job.fileData = file.buffer.toString("base64");
    }

    // Await the blob persist before sending the HTTP response.  Change E caps
    // non-S3 files at 20 MB (≤27 MB base64), so this write is ≤500 ms — a
    // trivial delay compared with the LLM column-match that runs just above.
    // Awaiting here guarantees the blob is in Postgres before the client ever
    // sees the uploadId, so cross-worker /run calls always find the file in DB
    // on the first try.  (S3-stored files never reach this branch.)
    await persistJob(job);
    // The DB row now owns the durable base64 copy (persistJob marks
    // _persistedOnce only on success) — drop the in-memory string (~1.33x file
    // size) right away. `_buffer` (raw bytes, 1x) stays so the immediate
    // same-worker /run skips a DB reload; the blob janitor reclaims it once
    // the run reaches a terminal state.
    if (_persistedOnce.has(job.uploadId)) job.fileData = undefined;

    // Pre-import schema compatibility check (clients sheets only).
    // Query core2 once for all PMM/Opportunity column types, then check every
    // supplemental canonical that appears in any clients sheet. The result is
    // attached to each clients sheet in the response as advisory warnings.
    let uploadSchemaIncompatibilities: SchemaIncompatibility[] = [];
    try {
      const clientsSheets = sheets.filter(s => s.simplifiedType === "clients");
      if (clientsSheets.length > 0) {
        const allMatchedCanonicals = Array.from(new Set(
          clientsSheets.flatMap(s =>
            ((s as any).simplifiedAnalysis ?? [])
              .filter((a: any) => a.matchType !== "unknown" && a.canonical)
              .map((a: any) => a.canonical as string),
          ),
        ));
        if (allMatchedCanonicals.length > 0) {
          const pool = await getPool();
          uploadSchemaIncompatibilities = await checkSupplementalSchemaCompat(pool, allMatchedCanonicals);
        }
      }
    } catch { /* non-fatal — schema check must never block the upload response */ }

    // Attach a few REAL sample values per column so the UI can show inline,
    // example-based explanations under each mapping — and DROP the raw preview
    // rows from the response. Credential-looking columns are never sampled.
    const PWD_RE = /pass\s*word|passwd|pwd|secret/i;
    const responseSheets = sheets.map(s => {
      const canonByCol: Record<string, string> = {};
      for (const a of ((s as any).simplifiedAnalysis ?? [])) {
        if (a.canonical) canonByCol[a.col] = a.canonical;
      }
      const samples: Record<string, string[]> = {};
      for (const col of s.columns) {
        if (canonByCol[col] === "Password" || PWD_RE.test(col)) continue;
        const vals: string[] = [];
        for (const row of ((s as any).preview ?? [])) {
          const v = row[col];
          if (v != null && String(v).trim() !== "") {
            vals.push(String(v).trim().slice(0, 100));
            if (vals.length >= 3) break;
          }
        }
        if (vals.length) samples[col] = vals;
      }
      const { preview, ...rest } = s as any;
      // For the clients tab, count rows by their Type value so the frontend can
      // detect entity-level gaps (0 Opportunities, 0 Leads, etc.) without needing
      // to re-parse the file.
      const typeCounts: Record<string, number> = {};
      if ((rest as any).simplifiedType === "clients") {
        for (const row of (preview ?? [])) {
          const t = String((row as any).Type ?? (row as any).type ?? "").trim();
          if (t) typeCounts[t] = (typeCounts[t] ?? 0) + 1;
        }
      }
      // First 10 rows for the "does this look right?" preview table.
      // Redact password-looking columns before sending to the client.
      const previewRows: Record<string, string>[] = ((preview ?? []) as Record<string, unknown>[])
        .slice(0, 10)
        .map(row => {
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(row)) {
            if (PWD_RE.test(k)) continue;
            out[k] = v != null ? String(v).trim().slice(0, 120) : "";
          }
          return out;
        });
      return {
        ...rest,
        samples,
        previewRows,
        ...(Object.keys(typeCounts).length ? { typeCounts } : {}),
        ...((rest as any).simplifiedType === "clients" && uploadSchemaIncompatibilities.length > 0
          ? { schemaIncompatibilities: uploadSchemaIncompatibilities }
          : {}),
      };
    });

    // Tell the UI whether this client already exists so it can offer the
    // update / add / replace choice instead of treating it as a first import.
    res.json({
      uploadId, tenantId, fileName: file.originalname, sheets: responseSheets, s3Stored,
      existingClient: existing
        ? { status: existing.status, fileName: existing.fileName, createdAt: existing.createdAt }
        : null,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
}

// ── POST /api/onboarding/validate-data ────────────────────────────────────
// Pre-flight check: reads the uploaded file, applies column mappings, and
// reports common data-quality issues (blank lookup fields, values not found in
// the file's own reference sheets) so the client can resolve them in the UI
// before triggering the import pipeline.
router.post("/validate-data", async (req: Request, res: Response) => {
  try {
    const { uploadId, columnMappings: colMaps } = req.body as {
      uploadId: string;
      columnMappings?: Record<string, Record<string, string>>;
    };
    if (!uploadId) return res.status(400).json({ error: "uploadId is required" });

    const job = _jobs.get(uploadId);
    if (!job) return res.status(404).json({ error: "Upload not found" });
    if (!requireTenantAccess(req, res, job.tenantId)) return;

    let buffer: Buffer;
    if (job.s3Key) {
      buffer = await readFileBuffer(job.s3Key);
    } else if ((job as any)._buffer) {
      buffer = (job as any)._buffer;
    } else {
      // The cached row may be meta-only (startup warm skips file blobs) —
      // back-fill the file bytes from the DB on demand.
      if (!job.fileData) {
        const full = await getJobWithFile(uploadId);
        if (full?.fileData) job.fileData = full.fileData;
      }
      if (!job.fileData) {
        return res.status(400).json({ error: "File no longer available — please re-upload." });
      }
      buffer = Buffer.from(job.fileData, "base64");
      (job as any)._buffer = buffer;
    }

    const allSheets = await parseExcel(buffer);

    // Apply column mappings so canonical field names are used below.
    const mappedSheets = allSheets.map(sheet => {
      const mapping = colMaps?.[sheet.sheetName];
      if (!mapping) return sheet;
      return {
        ...sheet,
        columns: sheet.columns.map((c: string) => mapping[c] ?? c),
        rows: sheet.rows.map((row: Record<string, unknown>) => {
          const nr: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) nr[mapping[k] ?? k] = v;
          return nr;
        }),
      };
    });

    // Lookup field definitions: canonical field → sheet table names that declare
    // valid values in the uploaded file.
    const LOOKUP_DEFS = [
      { field: "DivisionLookup",   aliases: ["Division"],    refNorms: ["companydivisions","divisions"],  label: "Division"   },
      { field: "DepartmentLookup", aliases: ["Department"],  refNorms: ["department","departments"],      label: "Department" },
      { field: "Role",             aliases: ["RoleLookup"],  refNorms: ["roles","role"],                  label: "Role"       },
      { field: "JobTitle",         aliases: ["Title"],       refNorms: ["jobtitle","jobtitles"],          label: "Job Title"  },
    ] as const;

    // Collect "known" values declared by reference sheets within the file.
    const knownByField: Record<string, Set<string>> = {};
    for (const def of LOOKUP_DEFS) knownByField[def.field] = new Set<string>();

    for (const sheet of mappedSheets) {
      const norm = sheet.sheetName.toLowerCase().replace(/[\s_\-]/g, "");
      for (const def of LOOKUP_DEFS) {
        if (def.refNorms.some((r: string) => norm === r || norm.startsWith(r) || r.startsWith(norm))) {
          for (const row of sheet.rows as Record<string, unknown>[]) {
            const v = String(row["Title"] ?? row["Name"] ?? row["ShortName"] ?? "").trim();
            if (v) knownByField[def.field].add(v.toLowerCase());
          }
        }
      }
    }

    interface ValIssue {
      id: string; field: string; label: string;
      type: "blank_rows" | "unknown_value";
      blankCount?: number;
      unknownValues?: string[];
      knownValues: string[];
      affectedSheets: string[];
    }
    const issues: ValIssue[] = [];

    for (const def of LOOKUP_DEFS) {
      const known = knownByField[def.field];

      const allFields = [def.field, ...def.aliases] as string[];
      const usedMap   = new Map<string, Set<string>>(); // normalised value → sheet names
      let blankCount  = 0;
      const blankSheets = new Set<string>();

      for (const sheet of mappedSheets) {
        for (const row of sheet.rows as Record<string, unknown>[]) {
          for (const f of allFields) {
            if (f in row) {
              const v = String(row[f] ?? "").trim();
              if (!v) { blankCount++; blankSheets.add(sheet.sheetName); }
              else {
                const lv = v.toLowerCase();
                if (!usedMap.has(lv)) usedMap.set(lv, new Set());
                usedMap.get(lv)!.add(sheet.sheetName);
              }
              break; // only count the first matching alias per row
            }
          }
        }
      }

      if (blankCount > 0) {
        issues.push({
          id: `${def.field}_blank`, field: def.field, label: def.label,
          type: "blank_rows", blankCount,
          knownValues: [...known], // may be empty when no reference sheet in file
          affectedSheets: [...blankSheets],
        });
      }

      // skip unknown-value check when no reference sheet — nothing to compare against
      if (known.size === 0) continue;

      const unknowns = [...usedMap.entries()].filter(([lv]) => !known.has(lv));
      if (unknowns.length > 0) {
        issues.push({
          id: `${def.field}_unknown`, field: def.field, label: def.label,
          type: "unknown_value",
          unknownValues: unknowns.map(([lv]) => lv),
          knownValues: [...known],
          affectedSheets: [...new Set(unknowns.flatMap(([, sheets]) => [...sheets]))],
        });
      }
    }

    return res.json({ issues, ok: issues.length === 0 });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /api/onboarding/preflight ────────────────────────────────────────
// Upload-time preflight: value-level checks that predict the after-import
// notice classes ("Partial write … type mismatch", "hours … has no end date")
// BEFORE the pipeline runs, so problems surface at upload click instead of on
// the status page after processing. Read-only — never writes anything. The
// frontend treats any failure here as "no issues found"; preflight must never
// block an import on infra trouble.
router.post("/preflight", async (req: Request, res: Response) => {
  try {
    const { uploadId, columnMappings: colMaps } = req.body as {
      uploadId: string;
      columnMappings?: Record<string, Record<string, string>>;
    };
    if (!uploadId) return res.status(400).json({ error: "uploadId is required" });

    // Two cluster workers share the job table via the DB — the upload may have
    // landed on the other worker, so fall back to the DB like /status does.
    const job = _jobs.get(uploadId) ?? await loadJobFromDb(uploadId);
    if (!job) return res.status(404).json({ error: "Upload not found" });
    if (!requireTenantAccess(req, res, job.tenantId)) return;

    // Resolve the file bytes — same fallback chain as /dry-run-validate.
    let buffer: Buffer;
    if (job.s3Key) {
      buffer = await readFileBuffer(job.s3Key);
    } else if ((job as any)._buffer) {
      buffer = (job as any)._buffer;
    } else {
      // Cross-worker retry — same pattern as /run (see comment there).
      await (_persistChains.get(uploadId) ?? Promise.resolve());
      for (let attempt = 0; attempt < 8 && !job.fileData; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, Math.min(300 * 2 ** attempt, 5_000)));
        const full = await getJobWithFile(uploadId);
        if (full?.fileData) job.fileData = full.fileData;
      }
      if (!job.fileData) {
        return res.status(400).json({ error: "File no longer available — please re-upload." });
      }
      buffer = Buffer.from(job.fileData, "base64");
      (job as any)._buffer = buffer;
    }

    const allSheets = await parseExcel(buffer);

    // Apply any user-supplied column remappings (mirrors /run) — in-place mutation.
    for (const sheet of allSheets) {
      const mapping = colMaps?.[sheet.sheetName];
      if (!mapping) continue;
      sheet.columns = sheet.columns.map((c: string) => mapping[c] ?? c);
      for (const row of sheet.rows as Record<string, unknown>[]) {
        const keys = Object.keys(row);
        for (const k of keys) {
          const mapped = mapping[k];
          if (mapped && mapped !== k) { row[mapped] = row[k]; delete row[k]; }
        }
      }
    }
    const mappedSheets = allSheets;

    // NOTE: no recordTypeOverrides here — /run never derives them from
    // job.forcedRecordType either (they only come from the request body, which
    // these flows don't send). The real pipeline routes each row via its Type
    // column + auto-detection in expandClientsSheet, so preflight must do the
    // same or its type checks would compare against the wrong table's schema.
    // Update-mode schedule ID checks (task #420): merge-only means every
    // upload into an existing client runs as "update", so schedule sheets are
    // scanned per row for missing/unknown Project/Opp IDs at review time —
    // the same scan the run-time strict gate applies. The client sends its
    // effective mode; when absent, probe the tenant like /run's mode gate
    // does. Fail-open — preflight must never block an upload on infra trouble.
    let scheduleOpts: { pool: any; tenantId: string; importMode: string } | undefined;
    try {
      const bodyMode = String((req.body as any).importMode ?? "").trim().toLowerCase();
      const isUpdate = bodyMode
        ? bodyMode !== "create"
        : await tenantHasData(job.tenantId);
      if (isUpdate) {
        scheduleOpts = { pool: await getPool(), tenantId: resolveTenantId(job.tenantId), importMode: "update" };
      }
    } catch { /* skip schedule checks — run-time strict gate still backstops */ }
    const result = await preflightUploadChecks(mappedSheets, job.forcedTabType, undefined, scheduleOpts);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /api/onboarding/run ──────────────────────────────────────────────
router.post("/run", async (req: Request, res: Response) => {
  try {
    const { uploadId, columnMappings, importMode: rawMode, keepColumns, tabTypeOverrides, recordTypeOverrides, divisionHints, mappingsSource, forcedRecordType: runForcedRecordType } = req.body as {
      uploadId: string;
      columnMappings?:      Record<string, Record<string, string>>;
      importMode?:          string;
      keepColumns?:         Record<string, string[]>;
      tabTypeOverrides?:    Record<string, "team"|"clients"|"assignments">;
      recordTypeOverrides?: Record<string, "Project" | "Opportunity" | "Lead">;
      divisionHints?:       Record<string, string>;
      /** Module card the run was started from — informational: /active's
       *  deriveModules uses it to badge ONLY that module as "Importing…".
       *  Pipeline record typing still comes from recordTypeOverrides. */
      forcedRecordType?:    string;
      /** "grid" = the mappings are the web import grid's own built-in labels
       *  (lib/importServerFields.ts) — apply them like any user mapping, but
       *  do NOT save them as the client's recurring-upload template or as
       *  learned synonyms (they'd clobber a real saved mapping / add noise). */
      mappingsSource?:      string;
    };
    if (!uploadId) return res.status(400).json({ error: "uploadId is required" });

    const VALID_MODES: ImportMode[] = ["create", "update", "add", "replace"];
    let importMode: ImportMode = VALID_MODES.includes(rawMode as ImportMode)
      ? (rawMode as ImportMode)
      : "create";
    // Merge-only uploads (Aug 2026): "add" and "replace" are retired. Every
    // upload into an existing tenant merges — adds new rows, updates matched
    // ones, and NEVER removes anything absent from the file. Old clients /
    // saved links may still send the legacy values; coerce them here — the
    // single /run entry point — so the destructive replace post-passes and
    // the add-mode "skip existing" traps can never fire again. "create"
    // (brand-new company bootstrap, with its own rollback) is unchanged.
    if (importMode === "add" || importMode === "replace") importMode = "update";

    // Two cluster workers share the job table via the DB — the upload may have
    // landed on the other worker, so fall back to the DB like /status does.
    // Cache the loaded row so the background pipeline + status writes below
    // mutate the same object the rest of this worker sees.
    let job = _jobs.get(uploadId);
    if (!job) {
      const dbJob = await loadJobFromDb(uploadId);
      if (dbJob) { _jobs.set(uploadId, dbJob); job = dbJob; }
    }
    if (!job) return res.status(404).json({ error: "Upload not found" });
    // Only the company that owns this upload (or a superadmin) may run it.
    const runSrc = resolveRequestSource(req);
    if (!runSrc) return res.status(401).json({ error: "Authentication required" });
    if (!isSuperAdminSource(runSrc) && normTenant(job.tenantId) !== normTenant(runSrc.tenant)) {
      return res.status(403).json({ error: "You do not have access to this import" });
    }
    if (!(await requireImportAccess(req, res, job.tenantId))) return;
    if (job.status === "running") return res.status(409).json({ error: "Already running" });

    // Remember which module card this run came from so /active badges only
    // that module. Harmless outside deriveModules — nothing else reads it.
    {
      const rt = String(runForcedRecordType ?? "").trim();
      if (rt === "Project" || rt === "Opportunity" || rt === "Lead") job.forcedRecordType = rt;
    }

    // One-import-at-a-time per company (cross-worker): refuse to start a
    // second pipeline while a DIFFERENT upload for this tenant is running or
    // freshly pending. This job's own uploadId is excluded — resuming after
    // the preflight dialog is the same import, not a second one.
    const otherActive = await findActiveImportForTenant(job.tenantId, uploadId);
    if (otherActive) {
      return res.status(409).json({
        error: `A file is already importing for your company${otherActive.fileName ? ` ("${otherActive.fileName}")` : ""}. Please wait until it completes, then start this one again.`,
        code: "IMPORT_IN_PROGRESS",
        activeUploadId: otherActive.uploadId,
        activeFileName: otherActive.fileName,
      });
    }

    // Record the chosen mode on the job immediately so it survives a DB round
    // trip / server restart and shows up in Upload History even if the run
    // fails partway through.
    job.importMode = importMode;
    persistJob(job);

    // Only first-time imports ("create") require an unused company name. When the
    // user chose update / add / replace they are knowingly re-importing into an
    // existing client, so a conflict is expected and must NOT block the run.
    if (importMode === "create") {
      const taken = await findTenantConflict(job.tenantId, uploadId);
      if (taken) {
        return res.status(409).json({
          error: `A client named "${job.tenantId}" has already been onboarded (${taken.status}). Choose "update existing client" to re-import, or use a different company name.`,
        });
      }
      // Backstop for data that arrived outside the wizard (seeding, manual
      // adds): never let a silent "create" run over a tenant that already has
      // live rows — that path skips all prune/dedupe logic. Force an explicit
      // mode choice instead.
      if (await tenantHasData(job.tenantId)) {
        return res.status(409).json({
          error: `"${job.tenantId}" already has data in RM ONE. Please choose how to apply this file: update existing, only add new, or replace.`,
        });
      }
    }

    // Get file buffer — from S3, the in-memory cache, or the persisted base64
    // copy (which survives restarts when S3 is not configured). Resolve the
    // buffer BEFORE flipping the job to "running" so a missing-file error does
    // not leave the row stuck showing "Running" forever.
    let buffer: Buffer;
    if (job.s3Key) {
      buffer = await readFileBuffer(job.s3Key);
    } else if ((job as any)._buffer) {
      buffer = (job as any)._buffer;
    } else {
      // The cached row may be meta-only (startup warm skips file blobs) —
      // back-fill the file bytes from the DB on demand.
      //
      // ── Change 4 (cross-worker): the /upload fire-and-forget blob write may
      // still be in flight on the upload worker when /run lands on a DIFFERENT
      // cluster worker.  _persistChains is per-worker, so we can't await it
      // here.  Instead, retry the DB lookup with exponential backoff for up to
      // ~20 s — the blob write is always a single Postgres upsert so it lands
      // well within that window.  On the same worker, _persistChains resolves
      // it instantly (first iteration succeeds with no sleep).
      await (_persistChains.get(uploadId) ?? Promise.resolve());
      for (let attempt = 0; attempt < 8 && !job.fileData; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, Math.min(300 * 2 ** attempt, 5_000)));
        const full = await getJobWithFile(uploadId);
        if (full?.fileData) job.fileData = full.fileData;
      }
      if (!job.fileData) {
        // Mark the job failed so it no longer blocks future uploads for this tenant.
        job.status = "failed";
        job.result = { fatalError: "Original file is no longer available for this upload. Please upload the file again." };
        void persistJob(job);
        return res.status(400).json({ error: "Original file is no longer available for this upload. Please upload the file again." });
      }
      buffer = Buffer.from(job.fileData, "base64");
      (job as any)._buffer = buffer;
    }

    job.status = "running";
    // Report a real phase IMMEDIATELY so the status page never has a window of
    // status="running" with progress=null (parsing + LLM column matching below
    // can take a while; a null progress makes the UI fall back to a purely
    // cosmetic stage-cycling animation that looks like an endless loop).
    job.progress = { phase: "Analysing your file…", pct: 0 };
    persistJob(job);

    // Make the DB reflect "running" ASAP even though the initial /upload write
    // (multi-MB file blob INSERT) may still be in flight on the persist chain.
    // While that INSERT runs, the DB row either doesn't exist yet or lands
    // with the stale "pending" it captured before this flip — cross-instance
    // status polls then show "pending" for minutes and the status page throws
    // a false "This import hasn't started" banner. The promotion is a
    // conditional pending→running UPDATE, so it can never demote a terminal
    // status; retry on a backoff until it lands or the run leaves "running".
    void (async () => {
      for (const delayMs of [0, 5_000, 15_000, 40_000, 90_000, 180_000]) {
        if (delayMs) await new Promise(r => setTimeout(r, delayMs));
        if (job.status !== "running") return; // finished/failed — chain writes the terminal state
        try {
          // Ghost revive: this run OWNS the job (memory says running), so a
          // 'failed' DB row here should only be a ghost-sweep auto-cancel
          // that the user revived with a late "Run" click — lift it back to
          // running or other workers would admit a second concurrent import.
          // The error_detail match limits revival to sweep-expired rows
          // (provenance guard): a REAL pipeline failure racing this retry
          // keeps its terminal status and message. 'cancelled' never lifts.
          if (await promotePendingOnboardingJob(uploadId, {
            reviveGhostMessages: [ghostMessage("pending"), ghostMessage("running")],
          })) return;
        } catch { /* transient DB error — retry on next pass */ }
      }
    })();

    // Respond NOW — validation has passed and the job is officially running.
    // Everything below (Excel parse, LLM column matching, the pipeline itself)
    // continues in the background; the client re-attaches via GET /status
    // polling. Callers therefore get a FAST answer: every 4xx (bad uploadId,
    // name conflict, missing file) is returned above BEFORE this point, so the
    // frontend can await this request and refuse to navigate on failure.
    res.json({ uploadId, status: "running", message: "Pipeline started" });

    const allSheets = await parseExcel(buffer);

    // ── Change 5: release buffer references now that parseExcel is done ───────
    // The raw buffer (up to tens of MB) is no longer needed for the rest of the
    // pipeline; dropping all references lets GC reclaim it before the multi-hour
    // write pass begins. Without this, the buffer sits in heap alongside the
    // entire expanded row set, roughly doubling peak RSS.
    buffer = Buffer.alloc(0); // replace local ref with zero-byte stub
    (job as any)._buffer   = undefined;
    job.fileData           = undefined;

    // ── Change 3: single-pass in-place column remap ───────────────────────────
    // The previous code built two full copies of allSheets (preLlmSheets then
    // mappedSheets), each with new column arrays and new row objects. For a
    // 65k-row file that is ~300–600 MB of extra heap at peak. Instead, mutate
    // columns + row keys in-place: LLM remap follows the user remap in the same
    // loop so no intermediate copy is needed.
    //
    // saveLearnedSynonyms reads columnMappings directly (never from row keys),
    // so reading it before mutation is safe. "Kept" columns are NEVER in
    // columnMappings (they keep their original header), so they are untouched.
    await Promise.all(allSheets.map(async sheet => {
      // --- user-supplied column remap ---
      const userMapping = columnMappings?.[sheet.sheetName];
      if (userMapping) {
        // Rename columns in-place
        sheet.columns = sheet.columns.map(c => userMapping[c] ?? c);
        // Rename row keys in-place (mutate each row object)
        for (const row of sheet.rows as Record<string, unknown>[]) {
          const keys = Object.keys(row);
          for (const k of keys) {
            const mapped = userMapping[k];
            if (mapped && mapped !== k) {
              row[mapped] = row[k];
              delete row[k];
            }
          }
        }
      }

      // --- LLM fallback remap (for still-unrecognised columns) ---
      // Priority: per-sheet override → upload-time locked category → auto-detect
      const tab = tabTypeOverrides?.[sheet.sheetName] ?? job.forcedTabType ?? resolveSimplifiedTab(sheet as any);
      if (!tab) return;
      const canonicalFields = SIMPLIFIED_CANONICAL_FIELDS[tab];
      const analysis = analyzeSimplifiedColumns(tab, sheet.columns, {});
      const unknownCols = analysis.filter(a => a.matchType === "unknown").map(a => a.col);
      if (!unknownCols.length) return;
      // Sample up to 5 non-blank values per column so the LLM can judge by data.
      const sampleValues: Record<string, string[]> = {};
      for (const col of unknownCols) {
        const vals: string[] = [];
        for (const row of sheet.rows) {
          const v = row[col];
          if (v != null && String(v).trim() !== "") {
            vals.push(String(v).slice(0, 80));
            if (vals.length >= 5) break;
          }
        }
        if (vals.length) sampleValues[col] = vals;
      }
      let llmMatches: Record<string, string> = {};
      try {
        const raw = await llmMatchColumns(tab, unknownCols, canonicalFields, sampleValues);
        for (const [k, v] of Object.entries(raw)) { if (v) llmMatches[k] = v; }
      } catch { /* non-fatal — fall through with unmatched columns */ }
      if (!Object.keys(llmMatches).length) return;
      // Rename columns in-place
      sheet.columns = sheet.columns.map(c => llmMatches[c] ?? c);
      // Rename row keys in-place
      for (const row of sheet.rows as Record<string, unknown>[]) {
        const keys = Object.keys(row);
        for (const k of keys) {
          const mapped = llmMatches[k];
          if (mapped && mapped !== k) {
            row[mapped] = row[k];
            delete row[k];
          }
        }
      }
    }));

    // Alias for downstream code that references mappedSheets (now the same object)
    const mappedSheets = allSheets;

    // Apply field-value overrides from the pre-import validation UI. This remaps
    // cell values (e.g. "pacific nw" → "West Coast") and fills blank lookup fields
    // with a chosen default before the pipeline resolves them — so existing lookup
    // logic works unchanged. Mutations are in-place on the row objects.
    const fieldOverrides = ((req.body as any).fieldOverrides ?? {}) as
      Record<string, { valueMap?: Record<string, string>; defaultForBlank?: string }>;
    if (Object.keys(fieldOverrides).length > 0) {
      for (const sheet of mappedSheets) {
        for (const row of sheet.rows as Record<string, unknown>[]) {
          for (const [field, fix] of Object.entries(fieldOverrides)) {
            const raw = String((row as Record<string, unknown>)[field] ?? "").trim();
            if (!raw && fix.defaultForBlank) {
              (row as Record<string, unknown>)[field] = fix.defaultForBlank;
            } else if (raw) {
              const mapped = fix.valueMap?.[raw.toLowerCase()] ?? fix.valueMap?.[raw];
              if (mapped === "__skip__") delete (row as Record<string, unknown>)[field];
              else if (mapped) (row as Record<string, unknown>)[field] = mapped;
            }
          }
        }
      }
    }

    // Columns the user chose to KEEP (store in our DB, not RM ONE). Captured from
    // the mapped sheets so the identifying columns are already canonical, while
    // the kept columns retain their original header (KEEP cols are never renamed).
    const safeKeepColumns = sanitizeKeepColumns(keepColumns, columnMappings);
    const extraRecords = Object.keys(safeKeepColumns).length > 0
      ? captureExtraFields(mappedSheets, safeKeepColumns)
      : [];

    // Resolve this client's effective missing-data defaults (built-in ← global ←
    // per-client) before kicking off the run, so blank fields are filled per the
    // admin's configuration.
    const effectiveDefaults = await loadEffectiveDefaults(job.tenantId).catch(() => BUILTIN_ONBOARDING_DEFAULTS);

    // (The HTTP response was already sent right after validation above. The run
    // is NOT tied to this request — it keeps going server-side even if the user
    // closes the tab or refreshes; the status screen just re-attaches by
    // polling GET /status. Note: a full server restart still can't resume an
    // in-flight run and reconciles it to "failed" on startup.)

    // NO AUTO-RETRY — explicit product decision. If the import fails for ANY
    // reason (including a transient DB hiccup), we stop immediately, roll back
    // everything this run wrote when it is safe to do so (first-ever import for
    // the tenant), and tell the user to retry manually. The previous behaviour
    // (auto-restarting a failed first-time "create" run in "replace" mode up to
    // 3×, replaying all import phases at the top of the status screen) confused
    // users — they preferred an explicit stop + "please re-upload" message.
    job.progress = { phase: "Starting…", pct: 0 };
    job.lastActivityAt = Date.now();
    // Stamp this process's identity on the job row so a crash reconcile can
    // fail exactly the jobs the dead worker owned — and no others. MANDATORY:
    // an unstamped running job is invisible to the owner-scoped reconcile, so
    // a crash would leave it lying "running" until the 15-min boot backstop.
    // Refuse to start the pipeline rather than run unprotected.
    const ownerToken = process.env["OWNER_TOKEN"] ?? `w${process.env["WORKER_ID"] ?? "?"}:${process.pid}`;
    try {
      try { await stampOnboardingJobOwner(uploadId, ownerToken); }
      catch { await stampOnboardingJobOwner(uploadId, ownerToken); } // one quick retry
    } catch (stampErr: any) {
      console.error(`[onboarding] ${uploadId}: owner stamp failed twice — refusing to start the pipeline:`, stampErr?.message ?? stampErr);
      job.status   = "failed";
      job.result   = { fatalError: "The import could not start because the session could not be registered. Nothing was written — please try again." } as any;
      job.progress = undefined;
      await persistJob(job);
      if (!res.headersSent) res.status(500).json({ error: "Could not start the import — please try again" });
      return;
    }
    let result: Awaited<ReturnType<typeof runPipeline>> | undefined;
    let lastError: string | undefined;
    // Timer-based DB heartbeat: bump updated_at every ~60s while this process
    // is alive and the job is still "running", so the cross-instance /active
    // sweep and the boot-time reconcile (both keyed on updated_at staleness)
    // can tell a live import apart from one whose owner died. Deliberately a
    // TIMER, not progress-driven: silent phases (big Excel parse, LLM column
    // matching, one giant batch) can emit no progress for many minutes, and a
    // progress-driven heartbeat let sibling instances falsely fail live runs.
    // Genuinely HUNG pipelines are still caught: the owner's in-memory sweep
    // keys on lastActivityAt (progress-driven only) and flips the job to
    // "failed", which stops this timer. It does NOT touch lastActivityAt.
    const heartbeatTimer = setInterval(() => {
      if (job.status !== "running") { clearInterval(heartbeatTimer); return; }
      void updateOnboardingJob(uploadId, {}).catch((e) =>
        console.warn(`[onboarding] ${uploadId}: heartbeat updated_at bump failed:`, (e as Error)?.message ?? e));
      // Zombie guard: if ANOTHER process flipped this job failed/cancelled in
      // the DB (crash reconcile, or a cancel from a sibling instance), tell
      // the pipeline to abort at its next checkpoint instead of running on as
      // a zombie writer whose completion would overwrite the terminal status.
      // Probe failures are LOGGED, not swallowed: under DB duress a silent
      // catch here hid the fact that cancel detection was down entirely.
      void getOnboardingJobDbStatus(uploadId).then(dbStatus => {
        if ((dbStatus === "failed" || dbStatus === "cancelled") && !job.externallyStopped) {
          job.externallyStopped = dbStatus;
          console.warn(`[onboarding] ${uploadId}: job was marked ${dbStatus} externally — aborting the pipeline at its next checkpoint`);
        }
      }).catch((e) =>
        console.warn(`[onboarding] ${uploadId}: heartbeat status probe failed (cancel detection degraded):`, (e as Error)?.message ?? e));
    }, 60_000);

    // Extract the authenticated user's email from the Bearer JWT so the pipeline
    // can seed them as a site admin in any newly-created tenant.
    const bearerToken = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim() || null;
    const jwtPayload  = verifyRdsToken(bearerToken);
    const initiatedByUsername = jwtPayload?.username ?? undefined;

    // Cap concurrent pipeline DB-write runs on this worker (FIFO). A burst of
    // simultaneous uploads must never demand burst×8 pool connections at once;
    // beyond the cap, runs wait here and the status screen shows the queue
    // phase. While queued, keep lastActivityAt fresh so the hung-import sweep
    // never false-fails a job that is merely waiting in line.
    const queueKeepalive = setInterval(() => { job.lastActivityAt = Date.now(); }, 45_000);
    let releaseSlot: (() => void) | null = null;
    try {
      releaseSlot = job.cancelledAt ? null : await acquireImportSlot((ahead) => {
        job.progress = { phase: `Waiting for a free import slot (${ahead} import${ahead === 1 ? "" : "s"} ahead)…`, pct: 0 };
        job.lastActivityAt = Date.now();
      });
    } finally {
      // The queued-phase keepalive must never outlive acquisition, even if
      // the acquire itself ever throws.
      clearInterval(queueKeepalive);
    }

    try {
      if (!job.cancelledAt && !job.externallyStopped) try {
        result = await runPipeline({
          uploadId,
          tenantId: job.tenantId,
          sheets:   mappedSheets,
          importMode,
          defaults: effectiveDefaults,
          initiatedByUsername,
          recordTypeOverrides,
          // Pass the upload-card intent so the pipeline treats every sheet as
          // the category the user chose, ignoring tab names entirely.
          forcedTabType: job.forcedTabType,
          // User-supplied disambiguation choices for multi-BU division conflicts.
          divisionHints: divisionHints && Object.keys(divisionHints).length > 0
            ? divisionHints
            : undefined,
          // Live progress — updates the in-memory job (read by /status every
          // ~2s) and bumps the activity clock. Progress itself is transient
          // (replaced by step results once the run finishes). The DB
          // updated_at heartbeat is handled by the 60s timer above so silent
          // phases stay covered too.
          onProgress: (p) => {
            // Abort beats progress: throwing here stops the pipeline mid-batch
            // (insertSheet rethrows ImportAbortedError instead of demoting it
            // to a sheet error) — this is what makes cancel take effect MID-run
            // instead of only before the run starts.
            if (job.externallyStopped || job.cancelledAt) {
              throw new ImportAbortedError(job.externallyStopped ?? "cancelled");
            }
            job.progress = p;
            job.lastActivityAt = Date.now();
          },
          // Phase-boundary abort probe — covers silent stretches that emit no
          // progress callbacks (big parses, chunked replace-mode wipes).
          shouldAbort: () => job.externallyStopped ?? (job.cancelledAt ? "cancelled" : null),
        });
      } catch (e: any) {
        result    = undefined;
        lastError = e?.message ?? "Import failed";
      }
    } finally {
      // Slot release + heartbeat stop are structurally guaranteed: a leaked
      // slot would permanently shrink this worker's import lane.
      releaseSlot?.();
      clearInterval(heartbeatTimer);
    }

    if (result && result.status !== "failed" && !job.cancelledAt && !job.externallyStopped) {
      job.status         = result.status;
      job.result         = result;
      job.totalInserted  = result.totalInserted;
      job.totalErrors    = result.totalErrors;
      job.progress       = undefined;
      await persistJob(job);

      const attribution = (result as typeof result & {
        auditAttribution?: import("../lib/pipeline.js").ImportRecordAttribution;
      }).auditAttribution;
      if (attribution?.records.length) {
        const uploader = job.createdBy ?? initiatedByUsername ?? "import-pipeline";
        const uploaderId = jwtPayload?.sub ?? uploader;
        const events = attribution.records.map(record => ({
          eventKey: `import-record:${uploadId}:${record.entityType}:${record.entityId}`,
          tenantId: job.tenantId,
          actorId: uploaderId,
          actorName: uploader,
          actorEmail: uploader.includes("@") ? uploader : null,
          actorType: "user" as const,
          action: "import.record-write",
          outcome: "success" as const,
          entityType: record.entityType,
          entityId: record.entityId,
          entityName: record.entityName ?? null,
          source: "import",
          metadata: {
            jobId: uploadId,
            fileName: job.fileName,
            createdTotal: attribution.createdTotal,
            updatedTotal: attribution.updatedTotal,
            truncated: attribution.truncated,
          },
        }));
        void recordAuditEvents(events).catch(error => {
          console.warn(`[onboarding] per-record import audit failed: ${String(error).slice(0, 240)}`);
        });
      }

      // Usage telemetry (#482): a completed import is SYSTEM activity — the
      // pipeline's bulk writes must never inflate human transaction counts.
      // cnt = data rows written, so the human-vs-system split shows the true
      // scale of automated data movement.
      recordUsage(
        { tenant: job.tenantId, userId: job.createdBy || "import-pipeline", username: job.createdBy || "import-pipeline" },
        "tx", "data_import",
        { system: true, cnt: Math.max(1, job.totalInserted ?? 0) },
      );

      // Bust all proxy caches so the next page load sees the newly-imported data.
      // Without this, resource-allocations / project-team / records caches serve
      // stale data for up to 5 min even though rows are already in core2.
      // Pass the tenant GUID too: RDS tenants' Pipeline/Projects lists are
      // served from tid-keyed caches that the auth-keyed busts never touch.
      bustAllProjectCaches(req.headers.authorization ?? "", resolveTenantId(job.tenantId));
      // The pipeline can insert/update Roles and dept rate overrides directly,
      // so the per-tenant role-rates SWR cache must be busted too or the
      // Budget & Costs / Billing Rates screens serve pre-import rates for up
      // to the cache TTL.
      bustRoleRatesCache(resolveTenantId(job.tenantId));
      // Immediately re-warm the just-busted home/forecast source caches so the
      // first post-import visit to Home / Forecast / Alerts is served fresh
      // data without the 30s+ cold-query wait.
      warmTenantCachesAfterImport(resolveTenantId(job.tenantId), job.tenantId);

      // Remember this client's column mapping (and tab-type overrides) so the next upload auto-applies them.
      // Grid submissions are excluded: their mappings are the app's OWN fixed
      // labels (already built-in synonyms), so "remembering" them would only
      // overwrite the client's real saved template from a genuine file upload
      // and spam the learned-synonym table with noise.
      if ((result.status === "success" || result.status === "partial") && columnMappings && mappingsSource !== "grid") {
        await saveClientTemplate(job.tenantId, columnMappings, tabTypeOverrides).catch(() => { /* non-fatal */ });
        // Also push confirmed mappings into the shared cross-tenant synonym table
        // so every future customer with the same unusual headers gets them matched
        // automatically — no synonym-map maintenance needed.
        await saveLearnedSynonyms(allSheets, columnMappings).catch(() => { /* non-fatal */ });
      }

      // Persist any "kept" extra columns to our own DB, linked by natural key.
      if ((result.status === "success" || result.status === "partial") && extraRecords.length > 0) {
        await saveExtraFields(job.tenantId, extraRecords).catch(err =>
          console.error("[onboarding] failed to save kept extra fields:", err?.message ?? err),
        );
      }

      // Persist key financial fields for Opportunity rows as Postgres fallbacks.
      // core2.Opportunity may be missing LaborContractAmount or ForecastedProjectCost
      // columns in some RM ONE schema versions — execInsert silently drops absent
      // columns. Storing them here lets applyExtraFieldMappings (rds-extra-fields.ts
      // GLOBAL_MAPPINGS) re-inject them into rawFields so Budget & Costs displays
      // them regardless of the tenant's schema.
      if (result.status === "success" || result.status === "partial") {
        const OPP_FIN_FIELDS = ["LaborContractAmount", "ForecastedProjectCost"] as const;
        const oppFinRecords: ExtraRecord[] = [];
        for (const sheet of mappedSheets) {
          if (resolveTable(sheet.sheetName) !== "Opportunity") continue;
          for (const row of (sheet.rows ?? []) as Record<string, unknown>[]) {
            const title = extraStr(
              row.Title ?? row.ProjectTitle ?? row.Project ?? row.OpportunityTitle,
            );
            if (!title) continue;
            for (const field of OPP_FIN_FIELDS) {
              const raw = row[field];
              if (raw == null || raw === "") continue;
              const n = Number(String(raw).replace(/[$,%\s]/g, "")) || 0;
              if (n <= 0) continue;
              oppFinRecords.push({
                entityType: "opportunity",
                naturalKey:  title.toLowerCase(),
                recordLabel: title,
                fieldName:   field,
                value:       String(n),
                sheetName:   sheet.sheetName,
              });
            }
          }
        }
        if (oppFinRecords.length > 0) {
          await saveExtraFields(job.tenantId, oppFinRecords).catch(err =>
            console.error("[onboarding] failed to save opp financial fallbacks:", err?.message ?? err),
          );
        }
      }

      // Persist "Assumed Data" — defaults the wizard filled for blank fields — so
      // the app can flag system-generated values for later cleanup. Pass the set
      // of records this run processed so any previously-assumed field the client
      // has now supplied is auto-cleared (assumed → validated), even when this
      // upload itself produced no new assumed values.
      if (result.status === "success" || result.status === "partial") {
        const assumed  = result.assumed ?? [];
        const entities = result.entities ?? [];
        if (assumed.length > 0 || entities.length > 0) {
          await saveAssumedFields(job.tenantId, assumed, entities).catch(err =>
            console.error("[onboarding] failed to save assumed data:", err?.message ?? err),
          );
        }
      }

      // Pre-warm the imported tenant's top project detail/team/task caches so
      // the first post-import project open is served hot instead of paying the
      // full cold chain. Deliberately AFTER saveExtraFields + the financial
      // fallbacks above: warming earlier would bake a pre-write (empty)
      // extra-fields snapshot into the detail cache. Fire-and-forget.
      if (result.status === "success" || result.status === "partial") {
        warmImportedProjectsAfterImport(resolveTenantId(job.tenantId), job.tenantId);
      }
    } else if (job.externallyStopped) {
      // The pipeline aborted because ANOTHER process flipped this job's DB row
      // (crash reconcile after a sibling worker death, or a cancel that landed
      // on a different instance). The DB status + message are the user-facing
      // truth — do NOT persist over them: a "failed" write here would clobber
      // a user's "cancelled", and a zombie "success" would resurrect a job the
      // user was already told to re-upload. Roll back when safe, mirroring the
      // normal paths: externally CANCELLED mirrors /cancel (unconditional call
      // — the internal first-ever-import gate decides); externally FAILED
      // mirrors the failure path below (create-mode only).
      job.status   = job.externallyStopped;
      job.progress = undefined;
      if (job.externallyStopped === "cancelled" || importMode === "create") {
        const { rolledBack, cleaned } = await rollbackFreshCreateRun(job).catch(() => ({ rolledBack: false, cleaned: 0 }));
        if (rolledBack) {
          if (cleaned > 0) console.log(`[onboarding] ${uploadId}: post-abort rollback cleaned ${cleaned} row(s)`);
          // Enrich the terminal row's message with the rollback outcome and
          // stamp rolledBack:true so retry paths (/history delete) know this
          // run is already clean. The upsert fence allows this: the status
          // stays exactly what the external flip already wrote (same-status
          // updates pass).
          job.result = { fatalError: job.externallyStopped === "cancelled"
            ? (cleaned > 0 ? `Import cancelled — the ${cleaned} row(s) written by this run were removed.`
                           : `Import cancelled before any data was written.`)
            : (cleaned > 0 ? `The import was stopped and the ${cleaned} row(s) written by this run were removed. Please upload your file again.`
                           : `The import was stopped before any data was written. Please upload your file again.`),
            rolledBack: true } as any;
          persistJob(job);
        }
      }
      console.warn(`[onboarding] ${uploadId}: pipeline stopped — job was externally marked ${job.externallyStopped}`);
    } else if (!job.cancelledAt) {
      // Stop immediately — no auto-retry. Roll back everything this run wrote
      // when it is safe to do so, then tell the user explicitly to fix the
      // problem and re-upload.
      //
      // AUTOMATIC rollback is gated to "create" mode ONLY: create is 409-guarded
      // by findTenantConflict, so a running create + no prior success/partial
      // job genuinely means every core2 row for this tenant came from this run.
      // For add/update/replace the tenant already has real data (possibly
      // created outside onboarding, or imported from another environment whose
      // job history we can't see) — wiping on failure would risk destroying it,
      // so those modes stop without touching the database.
      job.status = "failed";
      const { rolledBack, cleaned } = importMode === "create"
        ? await rollbackFreshCreateRun(job).catch(() => ({ rolledBack: false, cleaned: 0 }))
        : { rolledBack: false, cleaned: 0 };
      const cause = (result?.errors?.[0]?.message ?? lastError ?? "Import failed").trim().replace(/\.+$/, "");
      // Sustained DB outage detected by the pipeline (bounded recovery already
      // failed) — tell the user plainly it was a connection problem, not a
      // problem with their file.
      const connLost = result?.failureReason === "db_connection_lost";
      // Lock timeout = transient infrastructure (a competing run held locks
      // too long), NOT a file problem — never tell the user to "fix" it.
      const lockTimeout = result?.failureReason === "db_lock_timeout";
      // A result object (barring the transient reasons above) means the
      // pipeline RAN to completion and reported a real data/validation
      // problem. Show that cause directly — the old blanket "Due to a
      // session issue, your import was interrupted … please upload your file
      // again" wording sent users re-uploading an unchanged file in circles
      // (Aug 2026 Alston AI loop). "Session issue" wording is reserved for
      // genuine interruptions (no result at all).
      const dataFailure = !connLost && !lockTimeout && !!result;
      const fatal = connLost
        ? (rolledBack
          ? `The database connection was lost during the import, so the run was stopped and all changes from this run have been removed (${cleaned} rows cleaned up). Nothing is wrong with your file — please upload it again.`
          : `The database connection was lost during the import, so the run was stopped. Nothing is wrong with your file — please upload it again once the connection is stable.`)
        : lockTimeout
        ? (rolledBack
          ? `The database was busy and the import timed out waiting for it, so the run was stopped and all changes from this run have been removed (${cleaned} rows cleaned up). Nothing is wrong with your file — please try the upload again in a few minutes.`
          : `The database was busy and the import timed out waiting for it, so the run was stopped. Nothing is wrong with your file — please try the upload again in a few minutes.`)
        : dataFailure
        ? (rolledBack
          ? `${cause}. All changes from this run were removed (${cleaned} rows cleaned up) — fix this and upload the file again.`
          : `${cause}. Fix this and upload the file again.`)
        : rolledBack
        ? `Due to a session issue, your import was interrupted and all changes from this run have been removed (${cleaned} rows cleaned up). Please upload your file again to continue.`
        : `Due to a session issue, your import was interrupted: ${cause}. Please upload your file again to continue.`;
      job.result   = result
        ? { ...result, fatalError: fatal, rolledBack }
        : { fatalError: fatal, rolledBack };
      job.progress = undefined;
      persistJob(job);
    }
  } catch (e: any) {
    if (res.headersSent) {
      // We already replied "running" — this failure happened during the
      // background phase (parse / LLM matching / pipeline setup). Record it on
      // the job so the status page reports a real failure instead of spinning.
      console.error("[onboarding] /run background failure:", e?.stack ?? e?.message ?? e);
      const failedJob = _jobs.get(String((req.body as any)?.uploadId ?? ""));
      if (failedJob && failedJob.status === "running") {
        // Respect an external terminal flip: never stamp "failed" over a
        // user's cancel. (The DB-side upsert fence blocks the transition
        // anyway — this keeps the in-memory copy honest too.)
        failedJob.status   = failedJob.externallyStopped ?? "failed";
        if (!failedJob.externallyStopped) {
          failedJob.result   = { error: e?.message ?? "Import failed" } as any;
          failedJob.progress = undefined;
          persistJob(failedJob);
        } else {
          failedJob.progress = undefined;
        }
      }
      return;
    }
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── Shared fresh-create rollback ─────────────────────────────────────────
// Soft-deletes every core2 row for the job's tenant — used both when the user
// cancels a run AND when a run fails (imports never auto-retry; a failed run
// is cleaned up so the user can simply re-upload).
//
// ROLLBACK SAFETY RULE: Only wipe tenant data when this is the FIRST EVER
// import for this tenant (no prior success/partial). If the tenant already has
// data from a previous import, wiping everything would destroy pre-existing
// records the user never intended to remove. In that case we leave the
// database untouched and return { rolledBack: false }.
async function rollbackFreshCreateRun(job: JobRecord): Promise<{ rolledBack: boolean; cleaned: number }> {
  // Tenant-exclusive lease (sp_getapplock) + authoritative live-run check
  // around EVERY rollback execution. Closes the race where a brand-new import
  // starts on this tenant between a caller's decision to roll back and the
  // tombstone writes below — without this, the tenant-wide soft-deletes could
  // tombstone the NEW run's first rows. Also serializes two concurrent
  // rollbacks for the same tenant (e.g. two workers dying near-simultaneously).
  // Fail CLOSED at every step: no lease / probe error / live run ⇒ leave data.
  const { acquireTenantImportLease, hasActiveOnboardingRun } = await import("@workspace/db");
  const lease = await acquireTenantImportLease(job.tenantId, 15_000).catch(() => null);
  if (!lease) {
    console.warn(`[rollback] ${job.uploadId}: tenant lease busy or unavailable — skipping rollback`);
    return { rolledBack: false, cleaned: 0 };
  }
  try {
    let liveRun = true;
    try { liveRun = await hasActiveOnboardingRun(job.tenantId, job.uploadId); } catch { /* fail closed */ }
    if (liveRun) {
      console.log(`[rollback] ${job.uploadId}: a live import owns this tenant — skipping rollback`);
      return { rolledBack: false, cleaned: 0 };
    }
    return await rollbackFreshCreateRunInner(job);
  } finally {
    await lease.release();
  }
}

async function rollbackFreshCreateRunInner(job: JobRecord): Promise<{ rolledBack: boolean; cleaned: number }> {
  // Prior-data check MUST use the DB, not this worker's in-memory _jobs map:
  // workers only load jobs at boot, so an import completed after boot on a
  // DIFFERENT worker would be invisible here and we'd wipe real tenant data.
  // Fail CLOSED — if the check itself fails, assume prior data and skip.
  let hasPriorData = true;
  try {
    const allJobs = await withDeadline(getAllOnboardingJobsMeta(), 8_000);
    hasPriorData = allJobs.some(j =>
      normTenant(j.tenantId) === normTenant(job.tenantId) &&
      j.uploadId !== job.uploadId &&
      (j.status === "success" || j.status === "partial")
    );
  } catch (e: any) {
    console.warn(`[rollback] ${job.uploadId}: prior-data DB check failed — preserving tenant data:`, e?.message ?? e);
  }
  if (hasPriorData) {
    console.log(`[rollback] ${job.uploadId}: existing tenant — skipping rollback to preserve prior data`);
    return { rolledBack: false, cleaned: 0 };
  }

  // Fresh create — every row in core2 for this tenant came from this run,
  // so rolling back is safe and necessary.
  // Best-effort soft-delete rollback. Children first to respect FK order.
  const ROLLBACK_TABLES = [
    "TicketHours", "ResourceTimeSheet",
    "ResourceAllocation",
    "ResourceWorkItems",
    "ModuleTasks",
    "PMM", "Opportunity", "Lead",
    "CRMContact", "CRMCompany",
    "Roles", "JobTitle",
    "CompanyDivisions", "Department",
  ];
  let cleaned = 0;
  try {
    const pool = await getPool();
    const tid  = resolveTenantId(job.tenantId);
    for (const tbl of ROLLBACK_TABLES) {
      try {
        const r = await pool.request()
          .input("tid", sql.NVarChar, tid)
          .query(`UPDATE core2.dbo.[${tbl}] SET Deleted=1 WHERE TenantID=@tid AND (Deleted=0 OR Deleted IS NULL)`);
        cleaned += r.rowsAffected?.[0] ?? 0;
      } catch { /* table absent or lacks Deleted column — skip */ }
    }
    // Soft-delete non-admin users (replaces AspNetUsers UPDATE Deleted=1).
    try {
      const allPgUsers = await getUsersByTenant(tid);
      const toDelete = allPgUsers.filter(u => !u.isSiteAdmin && !u.deleted).map(u => u.id);
      await Promise.all(toDelete.map(id => updateAppUser(tid, id, { deleted: true })));
      cleaned += toDelete.length;
    } catch (e) { console.warn("[rollback] user soft-delete error:", e); }
  } catch (e) {
    console.warn("[rollback] error:", e);
  }
  console.log(`[rollback] ${job.uploadId}: fresh-create rollback, ${cleaned} rows soft-deleted`);
  return { rolledBack: true, cleaned };
}

// ── Crash reconcile (runs on ONE surviving worker) ───────────────────────
// When a sibling worker dies, the primary hands its owner token to exactly one
// survivor, which (1) fails the dead token's live job rows and (2) rolls back
// create-mode residue for its recent terminal rows. Step 2 exists because a
// worker can die BETWEEN cancel/failure detection and its finalization
// rollback (observed under OOM): the row is already terminal-cancelled, the
// upsert fence rightly blocks re-writes, but partial rows linger behind a
// message that says nothing about them. rollbackFreshCreateRun is idempotent
// and fail-closed (fresh-tenant gate), so re-running it here is safe.
// Returns true only when every reconcile step verifiably completed. The
// worker ACKs the primary (stopping re-dispatch of this duty) strictly on
// `true` — a DB blip during the owner-fail UPDATE or a failed rollback keeps
// the duty pending, and the primary re-sends it until it fully lands.
export async function reconcileCrashedWorkerJobs(deadWorkerId: unknown, deadToken: string): Promise<boolean> {
  const deadId = String(deadWorkerId ?? "?");
  let ok = true;
  // Pulled dynamically to keep this file's static import block untouched —
  // the module is already loaded in every worker.
  const { failOnboardingJobsByOwner, getCrashReconcileCandidates, updateOnboardingJobResultIfStatus } =
    await import("@workspace/db");
  try {
    const n = await failOnboardingJobsByOwner(
      deadToken,
      "Your session was disconnected before the import could finish. Please upload your file again to continue.",
    );
    if (n > 0) console.log(`[onboarding] crash-reconcile: failed ${n} job(s) owned by dead worker ${deadId}`);
  } catch (e) {
    console.warn("[onboarding] crash-reconcile: owner-fail step errored:", (e as Error).message);
    ok = false;
  }
  let candidates: Awaited<ReturnType<typeof getCrashReconcileCandidates>> = [];
  try {
    candidates = await getCrashReconcileCandidates(deadToken);
  } catch (e) {
    console.warn("[onboarding] crash-reconcile: candidate query failed:", (e as Error).message);
    return false;
  }
  for (const c of candidates) {
    try {
      // metaOnly copy is safe here: it is never persisted nor cached into
      // _jobs (a meta-only write-back would wipe the stored file blob).
      const job = _jobs.get(c.uploadId) ?? await loadJobFromDb(c.uploadId, { metaOnly: true });
      if (!job) continue;
      const { cleaned } = await rollbackFreshCreateRun(job);
      if (cleaned > 0) {
        const msg = c.status === "cancelled"
          ? `Import cancelled — the ${cleaned} row(s) written by this run were removed.`
          : `The import was stopped when its process crashed; the ${cleaned} row(s) written by this run were removed. Please upload your file again.`;
        await updateOnboardingJobResultIfStatus(c.uploadId, c.status, { fatalError: msg, rolledBack: true });
        console.log(`[onboarding] crash-reconcile: rolled back ${cleaned} residue row(s) for ${c.uploadId} (${c.status})`);
      }
    } catch (e) {
      console.warn(`[onboarding] crash-reconcile: rollback for ${c.uploadId} failed:`, (e as Error).message);
      ok = false;
    }
  }
  return ok;
}

// ── POST /api/onboarding/cancel/:id ──────────────────────────────────────
// User-initiated cancellation. Marks the job as cancelled immediately, then rolls
// back this run's rows when safe (see rollbackFreshCreateRun).
router.post("/cancel/:id", async (req: Request, res: Response) => {
  const uploadId = String(req.params.id).trim();
  let job = _jobs.get(uploadId);
  if (!job) {
    // Multi-worker: the cancel POST can land on a process that never saw the
    // upload. FULL load (not metaOnly) — persistJob below writes fileData
    // back, so a meta-only copy would wipe the stored file blob. Only adopt
    // PENDING jobs: a job RUNNING on another worker is cancelled via the
    // DB-status flip in the branch below instead — the owning pipeline's
    // heartbeat polls the DB status and aborts at its next checkpoint.
    const dbJob = await loadJobFromDb(uploadId);
    if (dbJob && dbJob.status === "pending") {
      job = dbJob;
      _jobs.set(uploadId, dbJob);
    } else if (dbJob) {
      if (!requireTenantAccess(req, res, dbJob.tenantId)) return;
      if (dbJob.status !== "running") {
        return res.status(400).json({ error: `Job is already ${dbJob.status}` });
      }
      // The job is running on ANOTHER process. Flip the DB row to "cancelled":
      // the owning pipeline polls the DB status every ~60s (see the /run
      // heartbeat) and aborts at its next checkpoint, rolling back when safe.
      // Guarded UPDATE — it can never demote a status that went terminal in
      // the meantime.
      const flipped = await cancelOnboardingJobInDb(uploadId, "Import cancelled by user").catch(() => false);
      if (!flipped) {
        const cur = await getOnboardingJobDbStatus(uploadId).catch(() => null);
        return res.status(400).json({ error: `Job is already ${cur ?? "finished"}` });
      }
      const keepNote = dbJob.importMode === "create"
        ? " Rows written by this run will be removed if this was the tenant's first import."
        : " Rows already imported before the stop will be kept.";
      return res.json({
        ok: true, uploadId, cleaned: 0,
        message: `Cancel signal sent — the import will stop at its next checkpoint.${keepNote}`,
      });
    }
  }
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (!requireTenantAccess(req, res, job.tenantId)) return;
  if (job.status !== "running" && job.status !== "pending") {
    return res.status(400).json({ error: `Job is already ${job.status}` });
  }

  // A job cancelled while still "pending" never ran the pipeline, so it wrote
  // no rows — rolling back would only endanger pre-existing tenant data.
  const wasPending = job.status === "pending";

  // Stamp before updating status — the pipeline finalization guard checks this.
  job.cancelledAt = new Date().toISOString();
  job.status      = "cancelled";
  job.result      = { fatalError: "Import cancelled by user" };
  job.progress    = undefined;
  persistJob(job);

  const { rolledBack, cleaned } = wasPending
    ? { rolledBack: false, cleaned: 0 }
    : await rollbackFreshCreateRun(job).catch(() => ({ rolledBack: false, cleaned: 0 }));

  // Rewrite the terminal message with the honest rollback outcome — for
  // update/replace/add runs partial rows REMAIN by design (wiping a tenant
  // that already had data would destroy pre-existing records). The upsert
  // fence allows this write because the status stays "cancelled".
  job.result = { fatalError: wasPending
    ? "Import cancelled before it started — nothing was written."
    : rolledBack
      ? `Import cancelled — the ${cleaned} row(s) written by this run were removed.`
      : "Import cancelled — rows already imported before the stop were kept (existing data is never removed automatically). Re-run the import to overwrite or continue." };
  persistJob(job);

  res.json({
    ok: true, uploadId, cleaned,
    message: wasPending
      ? "Import cancelled before it started"
      : rolledBack
        ? "Import cancelled and partial data rolled back"
        : "Import cancelled — rows written before the stop were kept",
  });
  return;
});

// ── PATCH /api/onboarding/history/:id/label ──────────────────────────────
// Rename an upload's display label (stored in file_name). Any tenant member
// can rename their own runs; superadmins can rename any run.
router.patch("/history/:id/label", async (req: Request, res: Response) => {
  const uploadId = String(req.params.id).trim();
  const label = String(req.body?.label ?? "").trim().slice(0, 300);
  if (!uploadId) return res.status(400).json({ error: "Missing upload id" });
  if (!label)    return res.status(400).json({ error: "label is required" });

  const meta = _jobs.get(uploadId) ?? await loadJobFromDb(uploadId, { metaOnly: true }).catch(() => null);
  if (!meta) return res.status(404).json({ error: "Upload not found" });
  if (!requireTenantAccess(req, res, meta.tenantId)) return;
  setAuditTarget(res, { entityType: "import", entityId: uploadId, entityName: meta.fileName });

  // Mirror into the in-memory copy so status polls and file downloads see the new name.
  const live = _jobs.get(uploadId);
  if (live) live.fileName = label;

  await updateOnboardingJob(uploadId, { fileName: label });
  setTrustedAuditChanges(res, trustedAuditDiff(
    { Label: meta.fileName },
    { Label: label },
    { fields: ["Label"] },
  ));
  return res.json({ ok: true, fileName: label });
});

// ── DELETE /api/onboarding/history/:id ───────────────────────────────────
// Removes a FAILED or CANCELLED run from Upload History: deletes the stored
// job row (including the uploaded file blob) from Postgres and drops this
// worker's in-memory copy. Stale copies on other workers are harmless — the
// /history list only merges running/pending in-memory jobs on top of the DB.
//
// Related core2 data: rows carry no per-upload tracking, so a surgical
// per-run wipe is impossible. Rollback of what the run wrote follows the
// SAME safety rule as /cancel and the failure path: only a CREATE-mode run
// may trigger rollbackFreshCreateRun, which itself refuses unless this is
// the tenant's first-ever import (fail closed). Failed create runs already
// rolled back automatically at failure time — the retry here only covers a
// rollback that errored out back then, and is idempotent (soft-delete only
// flips rows still marked live). Cancelled runs are NOT re-rolled-back:
// /cancel already handled the safe cases, and a run cancelled while still
// pending wrote nothing — wiping the tenant then would only endanger
// provisioned or pre-existing data.
router.delete("/history/:id", async (req: Request, res: Response) => {
  const uploadId = String(req.params.id).trim();
  if (!uploadId) return res.status(400).json({ error: "Missing upload id" });

  // metaOnly is safe here: we never persistJob this copy nor cache it into
  // _jobs (a meta-only copy written back would wipe the stored file blob).
  let job = _jobs.get(uploadId) ?? null;
  if (!job) job = await loadJobFromDb(uploadId, { metaOnly: true }).catch(() => null);
  if (!job) return res.status(404).json({ error: "Run not found" });
  if (!requireTenantAccess(req, res, job.tenantId)) return;
  setAuditTarget(res, {
    entityType: "import",
    entityId: uploadId,
    entityName: job.fileName,
    action: "delete.import",
  });

  if (job.status !== "failed" && job.status !== "cancelled" && job.status !== "provisioned") {
    return res.status(400).json({
      error: `Only failed, cancelled, or provisioned runs can be deleted — this run is ${job.status}`,
    });
  }

  let rolledBack = false;
  let cleaned = 0;
  if (job.importMode === "create" && job.status === "failed" && (job.result as any)?.rolledBack !== true) {
    const r = await rollbackFreshCreateRun(job).catch(() => ({ rolledBack: false, cleaned: 0 }));
    rolledBack = r.rolledBack;
    cleaned = r.cleaned;
  }

  try {
    await deleteOnboardingJobsBatch([uploadId]);
  } catch (e: any) {
    console.warn(`[onboarding] delete history ${uploadId}: DB delete failed:`, e?.message ?? e);
    return res.status(500).json({ error: "Could not delete the run — please try again" });
  }
  _jobs.delete(uploadId);
  setTrustedAuditChanges(res, trustedAuditDiff(
    { Status: job.status, Label: job.fileName },
    null,
    { fields: ["Status", "Label"] },
  ));
  console.log(`[onboarding] deleted ${job.status} run ${uploadId} (tenant ${job.tenantId})${rolledBack ? `, rolled back ${cleaned} rows` : ""}`);

  return res.json({
    ok: true, uploadId, rolledBack, cleaned,
    message: rolledBack
      ? `Run deleted; ${cleaned} rows from the interrupted import were cleaned up`
      : "Run deleted — the stored upload file was removed and existing company data was left untouched",
  });
});

// ── POST /api/onboarding/dev/restore-tenant ──────────────────────────────
// DEVELOPMENT ONLY — restores all soft-deleted rows for a tenant in core2.
// Used to recover from an accidental cancel-rollback on an existing tenant.
// Accessible only from localhost to prevent misuse.
router.post("/dev/restore-tenant", async (req: Request, res: Response) => {
  const host = req.headers.host ?? "";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("0.0.0.0");
  if (!isLocal) {
    return res.status(403).json({ error: "Dev-only endpoint: localhost access only" });
  }

  const { tenantId, uploadId: byUploadId } = req.body as { tenantId?: string; uploadId?: string };

  let tid = tenantId?.trim() ?? "";
  if (!tid && byUploadId) {
    const j = _jobs.get(byUploadId.trim());
    if (!j) return res.status(404).json({ error: "uploadId not found" });
    tid = resolveTenantId(j.tenantId);
  }
  if (!tid) return res.status(400).json({ error: "Provide tenantId or uploadId" });
  tid = resolveTenantId(tid);

  const RESTORE_TABLES = [
    "Department", "CompanyDivisions", "JobTitle", "Roles",
    "CRMCompany", "CRMContact",
    "Lead", "Opportunity", "PMM",
    "ModuleTasks", "ResourceWorkItems", "ResourceAllocation",
    "ResourceTimeSheet", "TicketHours",
    "AspNetUsers",
  ];
  let restored = 0;
  const detail: Record<string, number> = {};
  try {
    const pool = await getPool();
    for (const tbl of RESTORE_TABLES) {
      try {
        const r = await pool.request()
          .input("tid", sql.NVarChar, tid)
          .query(`UPDATE core2.dbo.[${tbl}] SET Deleted=0 WHERE TenantID=@tid AND Deleted=1`);
        const n = r.rowsAffected?.[0] ?? 0;
        if (n > 0) { detail[tbl] = n; restored += n; }
      } catch { /* table absent or no Deleted column */ }
    }
    console.log(`[dev/restore-tenant] ${tid}: restored ${restored} rows`, detail);
    res.json({ ok: true, tenantId: tid, restored, detail });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── GET /api/onboarding/dev/recent-jobs ──────────────────────────────────
// DEVELOPMENT ONLY — lists the 20 most recent jobs with their tenantId so
// you can find the right tenantId for a restore.
router.get("/dev/recent-jobs", async (req: Request, res: Response) => {
  const host = req.headers.host ?? "";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("0.0.0.0");
  if (!isLocal) {
    return res.status(403).json({ error: "Dev-only endpoint: localhost access only" });
  }
  const jobs = [..._jobs.values()]
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 20)
    .map(j => ({
      uploadId:  j.uploadId,
      tenantId:  j.tenantId,
      status:    j.status,
      createdAt: j.createdAt,
      cancelledAt: j.cancelledAt,
    }));
  res.json({ jobs });
  return;
});

// ── GET /api/onboarding/client-template ──────────────────────────────────
// Returns the saved column mapping for a client (by company name), if any, so
// the UI can auto-apply it on a recurring upload. (Note: GET /template returns
// an Excel download — this is the per-client mapping JSON, hence the distinct path.)
router.get("/client-template", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const tenantId = effectiveTenant(src, String(req.query.tenantId ?? "").trim());
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
    const row = await loadClientTemplate(tenantId);
    if (!row) return res.json({ template: null });
    // Extract tabOverrides from the embedded __tabOverrides key, then strip it
    // from the mapping so the frontend never sees the internal sentinel.
    const raw = (row.mapping ?? {}) as Record<string, any>;
    const { __tabOverrides: tabOverrides, ...cleanMapping } = raw;
    res.json({
      template: {
        tenantLabel: row.tenantLabel,
        name:        row.name,
        mapping:     cleanMapping,
        tabOverrides: (tabOverrides ?? {}) as Record<string, "team" | "clients" | "assignments">,
        updatedAt:   row.updatedAt,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── POST /api/onboarding/reanalyze-sheet ─────────────────────────────────
// Re-runs the full server-side column analysis (synonym match + LLM fallback)
// on a sheet using a user-chosen tab type. The frontend sends the columns and
// pre-computed sample values it already has from the upload response.
// Body: { columns: string[], tabType: "team"|"clients"|"assignments", samples?: Record<string,string[]> }
router.post("/reanalyze-sheet", async (req: Request, res: Response) => {
  try {
    const { columns, tabType, samples, uploadId: reqUploadId, sheetName: reqSheetName } = req.body as {
      columns?: string[];
      tabType?: string;
      samples?: Record<string, string[]>;
      uploadId?: string;
      sheetName?: string;
    };
    if (!Array.isArray(columns) || !columns.length)
      return res.status(400).json({ error: "columns array is required" });
    const VALID = ["team", "clients", "assignments"] as const;
    if (!tabType || !VALID.includes(tabType as (typeof VALID)[number]))
      return res.status(400).json({ error: "tabType must be team, clients, or assignments" });
    const tab = tabType as "team" | "clients" | "assignments";

    // Load the same synonym maps that the upload endpoint uses
    const globalSynonymMap: Record<string, string> = {};
    const tabSynonymMap: Record<string, Record<string, string>> = {};
    try {
      const synRows2 = await getAllSynonymMappings();
      for (const r of synRows2) {
        if (!r.tabType) {
          globalSynonymMap[r.alias] = r.canonicalField;
        } else {
          if (!tabSynonymMap[r.tabType]) tabSynonymMap[r.tabType] = {};
          tabSynonymMap[r.tabType][r.alias] = r.canonicalField;
        }
      }
    } catch { /* use built-in synonyms */ }
    const sheetSynonyms = { ...globalSynonymMap, ...(tabSynonymMap[tab] ?? {}) };

    // Re-fetch up to 10 preview rows from the stored workbook so the UI always
    // shows 10 rows regardless of what the initial upload response cached.
    let previewRows: Record<string, string>[] | undefined;
    if (reqUploadId && reqSheetName) {
      try {
        const job = await getJobWithFile(reqUploadId);
        if (job?.fileData) {
          const buf = Buffer.from(job.fileData, "base64");
          const parsed = await parseExcel(buf);
          const found = parsed.find(s => s.sheetName === reqSheetName);
          if (found) {
            previewRows = found.rows.slice(0, 10).map(row => {
              const out: Record<string, string> = {};
              for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
                if (!/pass\s*word|passwd|pwd|secret/i.test(k))
                  out[k] = v != null ? String(v).trim().slice(0, 120) : "";
              }
              return out;
            });
          }
        }
      } catch { /* non-fatal — UI just keeps existing preview */ }
    }

    const canonicalFields = SIMPLIFIED_CANONICAL_FIELDS[tab];
    const fieldLabels     = SIMPLIFIED_FIELD_LABELS[tab];
    const fieldHints      = SIMPLIFIED_ALL_FIELD_HINTS;
    const templateOrder   = SIMPLIFIED_TEMPLATE_ORDER[tab];

    // Phase 1: synonym + direct match (same as upload)
    let simplifiedAnalysis = analyzeSimplifiedColumns(tab, columns as string[], sheetSynonyms);

    // Phase 2: LLM fallback for anything still unknown — same logic as upload
    const unknownCols = simplifiedAnalysis
      .filter(a => a.matchType === "unknown")
      .map(a => a.col);

    if (unknownCols.length > 0) {
      try {
        const sampleValues: Record<string, string[]> = samples ?? {};
        const llmMatches = await llmMatchColumns(tab, unknownCols, canonicalFields, sampleValues);
        simplifiedAnalysis = simplifiedAnalysis.map(a => {
          if (a.matchType !== "unknown") return a;
          const llmCanonical = llmMatches[a.col];
          if (llmCanonical) return { ...a, canonical: llmCanonical, matchType: "llm" as const };
          return a;
        });
      } catch { /* LLM failed — keep synonym results */ }
    }

    const matched: string[] = [];
    const unknown: string[] = [];
    for (const a of simplifiedAnalysis) {
      if (a.matchType === "unknown") unknown.push(a.col);
      else                           matched.push(a.col);
    }

    // Phase 3: best-guess suggestions for columns that even LLM couldn't place.
    // These are returned as "suggestions" (not auto-applied) so the UI can
    // pre-fill the dropdown and let the user confirm or override.
    const suggestions: Record<string, string> = {};
    if (unknown.length > 0) {
      try {
        const sampleValues: Record<string, string[]> = samples ?? {};
        const raw = await llmSuggestColumns(tab, unknown, canonicalFields, sampleValues);
        for (const [k, v] of Object.entries(raw)) { if (v) suggestions[k] = v; }
      } catch { /* non-fatal */ }
    }

    // Phase 4 (clients only): check each matched supplemental column against the
    // live core2 schema for PMM / Opportunity. Any type mismatches are returned
    // as advisory warnings — the operator can still proceed to import.
    let schemaIncompatibilities: SchemaIncompatibility[] = [];
    if (tab === "clients" && matched.length > 0) {
      try {
        const pool = await getPool();
        const mappedCanonicals = simplifiedAnalysis
          .filter(a => a.matchType !== "unknown" && a.canonical)
          .map(a => a.canonical!);
        schemaIncompatibilities = await checkSupplementalSchemaCompat(pool, mappedCanonicals);
      } catch { /* non-fatal — schema check must never block the workflow */ }
    }

    res.json({
      simplifiedType:          tab,
      tableName:               `__override:${tab}`,
      validation:              { matched, unknown, missingRequired: [], suggestions },
      simplifiedAnalysis,
      canonicalFields,
      fieldLabels,
      fieldHints,
      templateOrder,
      suggestedType:           null,
      schemaIncompatibilities,
      ...(previewRows !== undefined ? { previewRows } : {}),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── POST /api/onboarding/save-synonym ────────────────────────────────────
// Immediately upsert a single user-confirmed column alias into the shared
// synonym_mappings table so the next upload auto-detects it without waiting
// for a full import run. Body: { alias, canonicalField, tabType }.
router.post("/save-synonym", async (req: Request, res: Response) => {
  try {
    const { alias, canonicalField, tabType } = req.body ?? {};
    if (!alias || !canonicalField || !tabType)
      return res.status(400).json({ error: "alias, canonicalField and tabType are required" });
    const normed = normSynKey(String(alias));
    if (normed.length < 3)
      return res.status(400).json({ error: "alias too short to be a useful synonym" });
    // Skip template headers — they already match with 100% certainty
    const templateNorm = TEMPLATE_HEADER_NORM_BY_TAB[tabType as string] ?? {};
    if (templateNorm[normed])
      return res.json({ ok: true, skipped: true, reason: "already a template header" });
    setConfigurationAuditTarget(res, `settings:synonym:${String(tabType)}:${normed}`, "Import synonym");
    let auditBefore: Record<string, unknown> | null = null;
    try {
      const row = (await getAllSynonymMappings()).find(r =>
        r.alias === normed && String(r.tabType ?? "") === String(tabType));
      if (row) auditBefore = {
        Alias: row.alias,
        CanonicalField: row.canonicalField,
        TabType: row.tabType,
      };
    } catch { /* audit before-read is best-effort */ }
    await upsertSynonymMapping({ alias: String(alias), canonicalField: String(canonicalField), tabType: String(tabType), isBuiltin: false, hitCount: 1 });
    try {
      const row = (await getAllSynonymMappings()).find(r =>
        r.alias === normed && String(r.tabType ?? "") === String(tabType));
      if (row) {
        setTrustedAuditChanges(res, trustedAuditDiff(auditBefore, {
          Alias: row.alias,
          CanonicalField: row.canonicalField,
          TabType: row.tabType,
        }));
      }
    } catch { /* target-only audit fallback */ }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── POST /api/onboarding/suggest-field ───────────────────────────────────
// On-demand LLM field suggestion: given an unrecognised column name + the list
// of canonical fields for that tab type (already held by the frontend), ask
// GPT to pick the best match.  Used by the FieldSearchCombobox "Ask AI" button.
// Body: { alias, tabType, canonicalFields, sampleValues? }
// Returns: { canonical: string | null }
router.post("/suggest-field", async (req: Request, res: Response) => {
  try {
    const { alias, tabType, canonicalFields, sampleValues } = req.body ?? {};
    if (!alias || !tabType || !Array.isArray(canonicalFields) || !canonicalFields.length)
      return res.status(400).json({ error: "alias, tabType and canonicalFields are required" });

    const aliasStr = String(alias);
    const fields   = canonicalFields as string[];

    // ── Fast path: exact case-insensitive match ──────────────────────────────
    // If the column name IS a canonical field (e.g. "Role" → "Role",
    // "jobTitle" → "JobTitle") return it immediately without calling the LLM.
    // This prevents the model from "creatively" picking a wrong field when an
    // exact answer is sitting right there in the list.
    const aliasNorm = aliasStr.toLowerCase().replace(/[\s_\-]/g, "");
    const exactHit  = fields.find(f => f.toLowerCase().replace(/[\s_\-]/g, "") === aliasNorm);
    if (exactHit) return res.json({ canonical: exactHit });

    // ── LLM path ─────────────────────────────────────────────────────────────
    // Use llmSuggestColumns (always-returns-a-best-guess variant) so the UI
    // can show a suggestion even when the match is loose. The user must
    // explicitly confirm before it is applied + saved as a synonym.
    const safeTabType = (["team", "clients", "assignments"].includes(String(tabType))
      ? String(tabType)
      : "clients") as "team" | "clients" | "assignments";

    const matches = await llmSuggestColumns(
      safeTabType,
      [aliasStr],
      fields,
      sampleValues ? { [aliasStr]: sampleValues as string[] } : undefined,
    );
    return res.json({ canonical: matches[aliasStr] ?? null });
  } catch (e: any) {
    console.error("[suggest-field]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /api/onboarding/classify-cross-tab ──────────────────────────────
// Strict cross-tab classifier: given SKIP'd column headers from one template
// tab, checks whether each column semantically belongs to ANOTHER tab's
// template (e.g. "Project Lead" on a Projects sheet → Team Assignments).
// Uses llmMatchColumns (can return null) so only genuine matches are flagged —
// unlike suggest-fields-batch which always forces a best-guess.
// Body:    { tabType, unknownCols: string[], canonicalFields: string[], sampleValues?: Record<string, string[]> }
// Returns: Record<string, string | null>  — the matched canonical label or null
router.post("/classify-cross-tab", async (req: Request, res: Response) => {
  try {
    const { tabType, unknownCols, canonicalFields, sampleValues } = req.body ?? {};
    if (!Array.isArray(unknownCols) || !unknownCols.length) return res.json({});
    if (!Array.isArray(canonicalFields) || !canonicalFields.length) return res.json({});

    const safeTabType = (["team", "clients", "assignments"].includes(String(tabType))
      ? String(tabType)
      : "assignments") as "team" | "clients" | "assignments";

    const matches = await llmMatchColumns(
      safeTabType,
      (unknownCols as unknown[]).map(String),
      (canonicalFields as unknown[]).map(String),
      typeof sampleValues === "object" && sampleValues !== null
        ? sampleValues as Record<string, string[]>
        : undefined,
    );
    return res.json(matches);
  } catch (e: any) {
    console.error("[classify-cross-tab]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /api/onboarding/suggest-fields-batch ────────────────────────────
// Batch variant of suggest-field: sends all unknown column headers in ONE
// LLM call and returns a label for each.  Used by the InlineDataGrid after
// file upload so every unmatched column gets an AI suggestion in one round-
// trip instead of N sequential requests.
// Body:    { tabType, unknownCols: string[], canonicalFields: string[], sampleValues?: Record<string, string[]> }
// Returns: Record<string, string | null>  (label from canonicalFields, or null)
router.post("/suggest-fields-batch", async (req: Request, res: Response) => {
  try {
    const { tabType, unknownCols, canonicalFields, sampleValues } = req.body ?? {};
    if (!Array.isArray(unknownCols) || !unknownCols.length) return res.json({});
    if (!Array.isArray(canonicalFields) || !canonicalFields.length) return res.json({});

    const safeTabType = (["team", "clients", "assignments"].includes(String(tabType))
      ? String(tabType)
      : "clients") as "team" | "clients" | "assignments";

    const matches = await llmSuggestColumns(
      safeTabType,
      (unknownCols as unknown[]).map(String),
      (canonicalFields as unknown[]).map(String),
      typeof sampleValues === "object" && sampleValues !== null
        ? sampleValues as Record<string, string[]>
        : undefined,
    );
    return res.json(matches);
  } catch (e: any) {
    console.error("[suggest-fields-batch]", e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /api/onboarding/client-template ─────────────────────────────────
// Manually save/replace a client's column mapping (also auto-saved on a
// successful import). Body: { tenantId, columnMappings }.
router.post("/client-template", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const { tenantId: reqTenantId, columnMappings } = req.body as {
      tenantId?: string;
      columnMappings?: ClientMapping;
    };
    const tenantId = effectiveTenant(src, reqTenantId);
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
    if (!columnMappings || typeof columnMappings !== "object") {
      return res.status(400).json({ error: "columnMappings is required" });
    }
    await saveClientTemplate(tenantId, columnMappings);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── GET /api/onboarding/extra-fields ─────────────────────────────────────
// Returns the "kept" extra-column values for a client, grouped per record, so
// the app can display them next to the matching person / company / project.
router.get("/extra-fields", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const tenantId = effectiveTenant(src, String(req.query.tenantId ?? "").trim());
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
    const rows = await getOnboardingExtraFields(normTenant(tenantId));

    type ExtraGroup = {
      entityType: string; naturalKey: string; recordLabel: string; sheetName: string | null;
      fields: { fieldName: string; value: string | null }[];
    };
    const groups = new Map<string, ExtraGroup>();
    for (const r of rows) {
      const k = `${r.entityType}::${r.naturalKey}`;
      const g: ExtraGroup = groups.get(k) ?? {
        entityType: r.entityType, naturalKey: r.naturalKey, recordLabel: r.recordLabel,
        sheetName: r.sheetName, fields: [],
      };
      g.fields.push({ fieldName: r.fieldName, value: r.value });
      groups.set(k, g);
    }
    res.json({ records: [...groups.values()], count: rows.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── PATCH /api/onboarding/extra-fields ───────────────────────────────────
// Update the value of a single kept extra field, identified by its natural
// key (tenant + entityType + naturalKey + fieldName — the unique index).
router.patch("/extra-fields", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const { tenantId, entityType, naturalKey, fieldName } = req.body ?? {};
    const value = req.body?.value;
    if (!tenantId || !entityType || !naturalKey || !fieldName) {
      return res.status(400).json({
        error: "tenantId, entityType, naturalKey and fieldName are required",
      });
    }
    const tenantLabel = normTenant(effectiveTenant(src, String(tenantId)));
    const auditKey = `settings:extra-fields:${String(entityType)}:${String(naturalKey)}:${String(fieldName)}`;
    setConfigurationAuditTarget(res, auditKey, "Extra fields");
    let before: Record<string, unknown> | null = null;
    try {
      const rows = await getOnboardingExtraFields(tenantLabel);
      const row = rows.find(r => r.entityType === String(entityType)
        && r.naturalKey === String(naturalKey) && r.fieldName === String(fieldName));
      if (row) before = { Value: row.value };
    } catch { /* audit before-read is best-effort */ }
    const updated = await updateOnboardingExtraField(
      tenantLabel, String(entityType), String(naturalKey), String(fieldName),
      value == null ? null : String(value),
    );
    if (!updated) return res.status(404).json({ error: "Field not found" });
    if (before) setTrustedAuditChanges(res, trustedAuditDiff(before, { Value: updated.value }));
    bustExtraFieldsEverywhere(tenantLabel);
    res.json({ ok: true, field: updated });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── DELETE /api/onboarding/extra-fields ──────────────────────────────────
// Remove a single kept extra field, scoped by tenant + natural key.
router.delete("/extra-fields", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const { tenantId, entityType, naturalKey, fieldName } = req.body ?? {};
    if (!tenantId || !entityType || !naturalKey || !fieldName) {
      return res.status(400).json({
        error: "tenantId, entityType, naturalKey and fieldName are required",
      });
    }
    const tenantLabel = normTenant(effectiveTenant(src, String(tenantId)));
    const auditKey = `settings:extra-fields:${String(entityType)}:${String(naturalKey)}:${String(fieldName)}`;
    setAuditTarget(res, { entityType: "configuration", entityId: auditKey, entityName: "Extra fields", action: "delete.configuration" });
    let before: Record<string, unknown> | null = null;
    try {
      const rows = await getOnboardingExtraFields(tenantLabel);
      const row = rows.find(r => r.entityType === String(entityType)
        && r.naturalKey === String(naturalKey) && r.fieldName === String(fieldName));
      if (row) before = { Value: row.value };
    } catch { /* audit before-read is best-effort */ }
    await deleteOnboardingExtraField(
      tenantLabel, String(entityType), String(naturalKey), String(fieldName),
    );
    if (before) setTrustedAuditChanges(res, trustedAuditDiff(before, null));
    bustExtraFieldsEverywhere(tenantLabel);
    res.json({ ok: true, deleted: 1 });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── GET /api/onboarding/assumed ──────────────────────────────────────────
// Returns the "Assumed Data" (defaults the wizard filled for blank fields) for
// a client, grouped per record, so the app can flag system-generated values.
router.get("/assumed", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const tenantId = effectiveTenant(src, String(req.query.tenantId ?? "").trim());
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
    const rows = await getOnboardingAssumedFields(normTenant(tenantId));

    type AssumedGroup = {
      entityType: string; naturalKey: string; recordLabel: string; sheetName: string | null;
      fields: { fieldName: string; value: string | null; confidence: string }[];
    };
    const groups = new Map<string, AssumedGroup>();
    const byConfidence: Record<string, number> = {};
    for (const r of rows) {
      const tier = r.confidence ?? "system_defaulted";
      byConfidence[tier] = (byConfidence[tier] ?? 0) + 1;
      const k = `${r.entityType}::${r.naturalKey}`;
      const g: AssumedGroup = groups.get(k) ?? {
        entityType: r.entityType, naturalKey: r.naturalKey, recordLabel: r.recordLabel,
        sheetName: r.sheetName, fields: [],
      };
      g.fields.push({ fieldName: r.fieldName, value: r.value, confidence: tier });
      groups.set(k, g);
    }
    res.json({ records: [...groups.values()], count: rows.length, byConfidence });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── GET /api/onboarding/assumed/export ────────────────────────────────────
// Machine-readable CSV export of a tenant's assumed values — the programmatic
// (API) data-egress surface. Gated by the `apiAccessEnabled` security setting
// (spec item 41): external/API access is OFF by default and returns 403 until an
// admin explicitly enables it. Tenant-scoped exactly like /assumed/history. (The
// in-app "Review assumptions" dialog exports client-side from already-loaded
// data, so admins can always export from the UI regardless of this gate.)
router.get("/assumed/export", async (req: Request, res: Response) => {
  const requested = String(req.query.tenantId ?? "").trim();
  if (!requested) { res.status(400).json({ error: "tenantId is required" }); return; }
  const src = resolveRequestSource(req);
  if (!src) { res.status(401).json({ error: "Authentication required" }); return; }
  let tenantId = requested;
  if (normTenant(requested) !== normTenant(src.tenant) && !isSuperAdminSource(src)) {
    tenantId = src.tenant;
  }
  try {
    const settings = await loadEffectiveDefaults(tenantId);
    if (!settings.apiAccessEnabled) {
      res.status(403).json({ error: "API access is disabled. Enable it in onboarding settings to use the export API." });
      return;
    }
    const rows = await getOnboardingAssumedFields(normTenant(tenantId));
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["entityType", "recordLabel", "naturalKey", "fieldName", "value", "confidence", "sheetName", "updatedAt"];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push([
        r.entityType, r.recordLabel, r.naturalKey, r.fieldName,
        r.value, r.confidence, r.sheetName, (r.updatedAt as any)?.toISOString?.() ?? r.updatedAt,
      ].map(esc).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="assumed-${normTenant(tenantId)}.csv"`);
    res.send(lines.join("\n"));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── GET /api/onboarding/assumed/history ───────────────────────────────────
// Append-only audit log / version history of assumed & AI-inferred values
// (Missing Data spec: audit logging + version history). Tenant-scoped exactly
// like /readiness and /history — a company user is forced to their own tenant,
// only a verified superadmin reads across companies, no token → 401. Optional
// filters narrow to one record/field so the UI can show "history for this value".
router.get("/assumed/history", async (req: Request, res: Response) => {
  const requested = String(req.query.tenantId ?? "").trim();
  if (!requested) { res.status(400).json({ error: "tenantId is required" }); return; }
  const src = resolveRequestSource(req);
  if (!src) { res.status(401).json({ error: "Authentication required" }); return; }
  let tenantId = requested;
  if (normTenant(requested) !== normTenant(src.tenant) && !isSuperAdminSource(src)) {
    tenantId = src.tenant;
  }
  try {
    const entityType = String(req.query.entityType ?? "").trim();
    const naturalKey = String(req.query.naturalKey ?? "").trim();
    const fieldName  = String(req.query.fieldName ?? "").trim();
    const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 500));
    const rows = await getOnboardingAssumedHistory(normTenant(tenantId), {
      entityType: entityType || undefined,
      naturalKey: naturalKey || undefined,
      fieldName:  fieldName  || undefined,
      limit,
    });
    res.json({ history: rows, count: rows.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── GET /api/onboarding/readiness ─────────────────────────────────────────
// Data Readiness dashboard (client "Missing Data Management" spec): a per-tenant
// view of how complete and trustworthy the data is. EVERY metric is computed from
// a REAL source; when no source exists we mark the metric "unavailable" rather
// than fabricate a value. The forecast-confidence score is a transparent, fully
// documented derivation of the real gaps below (not an invented number).
router.get("/readiness", async (req: Request, res: Response) => {
  const requested = String(req.query.tenantId ?? "").trim();
  if (!requested) { res.status(400).json({ error: "tenantId is required" }); return; }
  // Trusted tenant scoping — identical to /history. The query param is only a
  // hint: an authenticated company user is forced to their own login tenant so
  // they can never read another company's readiness signals (staffing, rate
  // coverage) by crafting the request. Only a verified superadmin reads across
  // companies. No valid token → 401 (never leak to anonymous callers).
  const src = resolveRequestSource(req);
  if (!src) { res.status(401).json({ error: "Authentication required" }); return; }
  let tenantId = requested;
  if (normTenant(requested) !== normTenant(src.tenant) && !isSuperAdminSource(src)) {
    tenantId = src.tenant; // force own tenant for non-superadmins
  }
  const tid = resolveTenantId(tenantId);
  // Effective admin settings for this tenant (drives the divide-by-zero fallback).
  const settings = await loadEffectiveDefaults(tenantId);

  // ── Load the client's saved column mapping (written after every successful import) ──
  type ClientMapping = Record<string, Record<string, string>>;
  type UploadedColumn = { tab: string; originalHeader: string; mappedTo: string };
  let uploadedCols: UploadedColumn[] = [];
  let uploadedSheets: Array<{ sheet: string; columns: Array<{ originalHeader: string; mappedTo: string }> }> = [];
  try {
    const tmpl = await getOnboardingTemplates(normTenant(tenantId));
    if (tmpl.length > 0) {
      const fileMapping = ((tmpl[0] as any).mapping ?? {}) as ClientMapping;
      for (const [sheet, cols] of Object.entries(fileMapping)) {
        if (sheet === "__tabOverrides" || !cols || typeof cols !== "object") continue;
        const sheetCols: Array<{ originalHeader: string; mappedTo: string }> = [];
        for (const [header, canonical] of Object.entries(cols as Record<string, string>)) {
          if (!canonical || canonical.toLowerCase() === "skip" || canonical.startsWith("_")) continue;
          uploadedCols.push({ tab: sheet, originalHeader: header, mappedTo: canonical });
          sheetCols.push({ originalHeader: header, mappedTo: canonical });
        }
        if (sheetCols.length > 0) uploadedSheets.push({ sheet, columns: sheetCols });
      }
    }
  } catch (e: any) {
    console.warn("[readiness] failed to load client template:", String(e));
  }

  type Metric = {
    key: string; label: string;
    status: "ok" | "warn" | "unavailable";
    value: number | null; total?: number | null; unit?: string;
    detail: string;
  };
  const metrics: Metric[] = [];

  const isUnassigned = (v: any) => {
    const s = String(v ?? "").trim().toLowerCase();
    return s === "" || s === "unassigned" || s === "null";
  };

  // Signals hoisted so the forecast-confidence score can reuse them.
  let totalProjects: number | null = null, unassignedProjects = 0;
  let totalPeople: number | null = null, bench = 0;
  let totalRoster = 0, orphaned = 0;
  let ratesKnown = false, totalAlloc = 0, withCost = 0, withBilling = 0;
  let assumedTotal = 0;
  const byConfidence: Record<string, number> = {};

  // ── Projects without a Division (real) ───────────────────────────────────
  try {
    const r: any = await getRecords("PMM", tid, tenantId);
    const data: any[] = Array.isArray(r?.data) ? r.data : [];
    totalProjects = data.length;
    unassignedProjects = data.filter(p => isUnassigned(p.DivisionLookup ?? p.Division)).length;
    metrics.push({
      key: "unassigned_projects", label: "Projects without a Division",
      status: unassignedProjects > 0 ? "warn" : "ok",
      value: unassignedProjects, total: totalProjects, unit: "projects",
      detail: unassignedProjects > 0
        ? `${unassignedProjects} of ${totalProjects} projects have no Division (Unassigned).`
        : `All ${totalProjects} projects have a Division assigned.`,
    });
  } catch (e: any) {
    metrics.push({ key: "unassigned_projects", label: "Projects without a Division", status: "unavailable", value: null, detail: `Project data unavailable: ${e?.message ?? e}` });
  }

  // ── People with no allocation (real) ─────────────────────────────────────
  try {
    const a: any = await getResourceAllocations(tid, tenantId);
    // Exclude admin-level accounts (superadmin-created logins) — they are
    // system users, not billable staff, and must not appear in gap metrics.
    const staffOnly = (a.resources ?? []).filter((r: any) => {
      const lvl = (r.accessLevel ?? "").toLowerCase();
      return lvl !== "admin";
    });
    totalPeople = staffOnly.length;
    bench = staffOnly.filter((r: any) => r.currentPct === 0).length;
    metrics.push({
      key: "people_no_allocation", label: "People with no allocation",
      status: bench > 0 ? "warn" : "ok",
      value: bench, total: totalPeople, unit: "people",
      detail: bench > 0
        ? `${bench} of ${totalPeople} people are at 0% allocation (no active staffing).`
        : `All ${totalPeople} people have at least one active allocation.`,
    });
  } catch (e: any) {
    metrics.push({ key: "people_no_allocation", label: "People with no allocation", status: "unavailable", value: null, detail: `Allocation data unavailable: ${e?.message ?? e}` });
  }

  // ── People missing Office or Job Title (real) ────────────────────────────
  try {
    const people = (await getResourceMasterRds(tid)) as any[];
    totalRoster = people.length;
    orphaned = people.filter(p => isUnassigned(p.office) || isUnassigned(p.jobTitle)).length;
    metrics.push({
      key: "orphaned_people", label: "People missing Office or Job Title",
      status: orphaned > 0 ? "warn" : "ok",
      value: orphaned, total: totalRoster, unit: "people",
      detail: orphaned > 0
        ? `${orphaned} of ${totalRoster} people are missing an Office or Job Title.`
        : `All ${totalRoster} people have an Office and Job Title.`,
    });
  } catch (e: any) {
    metrics.push({ key: "orphaned_people", label: "People missing Office or Job Title", status: "unavailable", value: null, detail: `Resource master unavailable: ${e?.message ?? e}` });
  }

  // ── Module-presence checks ───────────────────────────────────────────────
  // Surface a "warn" metric when an entire module has zero rows in core2 so
  // the Data Readiness page shows a "Fill template" button even before any
  // field-level quality metrics are relevant.
  try {
    const pool = await getPool();
    const [oppRes, leadRes, assignRes] = await Promise.all([
      pool.request().input("tid", tid).query(`SELECT COUNT(*) AS n FROM core2.dbo.Opportunity       WHERE TenantID=@tid AND (Deleted=0 OR Deleted IS NULL)`),
      pool.request().input("tid", tid).query(`SELECT COUNT(*) AS n FROM core2.dbo.Lead              WHERE TenantID=@tid AND (Deleted=0 OR Deleted IS NULL)`),
      pool.request().input("tid", tid).query(`SELECT COUNT(*) AS n FROM core2.dbo.ResourceAllocation WHERE TenantID=@tid AND (Deleted=0 OR Deleted IS NULL)`),
    ]);
    const oppCount    = Number(oppRes.recordset[0]?.n   ?? 0);
    const leadCount   = Number(leadRes.recordset[0]?.n  ?? 0);
    const assignCount = Number(assignRes.recordset[0]?.n ?? 0);

    if (totalProjects !== null && totalProjects === 0) {
      metrics.push({ key: "missing_projects", label: "No projects uploaded",
        status: "warn", value: 0, unit: "projects",
        detail: "No project records found. Upload your project data to enable financial reporting, scheduling, and resource planning." });
    }
    if (totalPeople !== null && totalPeople === 0) {
      metrics.push({ key: "missing_team", label: "No team members uploaded",
        status: "warn", value: 0, unit: "people",
        detail: "No staff records found. Upload your team data to enable resource assignment and allocation tracking." });
    }
    if (oppCount === 0) {
      metrics.push({ key: "missing_opportunities", label: "No opportunities uploaded",
        status: "warn", value: 0, unit: "records",
        detail: "No opportunity records found. Upload opportunity data to enable pipeline reports, win-rate tracking, and revenue forecasting." });
    }
    if (leadCount === 0) {
      metrics.push({ key: "missing_leads", label: "No leads uploaded",
        status: "warn", value: 0, unit: "records",
        detail: "No lead records found. Upload lead data to enable CRM funnel tracking and new-business pipeline." });
    }
    if (assignCount === 0) {
      metrics.push({ key: "missing_assignments", label: "No resource assignments uploaded",
        status: "warn", value: 0, unit: "records",
        detail: "No assignment records found. Upload assignment data to start tracking resource utilisation and capacity allocation." });
    }
  } catch (e: any) {
    console.warn("[readiness] module-presence check failed:", String(e));
  }

  // ── Allocation rate coverage (real; column-detected core2 aggregate) ─────
  try {
    const pool = await getPool();
    const colRes = await pool.request().query(
      `SELECT COLUMN_NAME FROM core2.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ResourceAllocation'`);
    const cols = new Set<string>(colRes.recordset.map((r: any) => String(r.COLUMN_NAME)));
    const costCol = ["EmpCostRate", "CostRate"].find(c => cols.has(c));
    const billCol = ["BillingRate"].find(c => cols.has(c));
    const delClause = cols.has("Deleted") ? "AND (Deleted=0 OR Deleted IS NULL)" : "";
    if (costCol || billCol) {
      const q = `SELECT COUNT(*) AS total`
        + (costCol ? `, SUM(CASE WHEN ISNULL([${costCol}],0)<>0 THEN 1 ELSE 0 END) AS withCost` : `, 0 AS withCost`)
        + (billCol ? `, SUM(CASE WHEN ISNULL([${billCol}],0)<>0 THEN 1 ELSE 0 END) AS withBilling` : `, 0 AS withBilling`)
        + ` FROM core2.dbo.ResourceAllocation WHERE TenantID=@tid ${delClause}`;
      const r = await pool.request().input("tid", tid).query(q);
      const row: any = r.recordset[0] ?? {};
      totalAlloc = Number(row.total ?? 0);
      withCost = Number(row.withCost ?? 0);
      withBilling = Number(row.withBilling ?? 0);
      ratesKnown = true;
      metrics.push({
        key: "allocations_with_cost_rate", label: "Allocations with a labor cost rate",
        status: totalAlloc === 0 ? "unavailable" : withCost >= totalAlloc ? "ok" : "warn",
        value: withCost, total: totalAlloc, unit: "allocations",
        detail: totalAlloc === 0 ? "No allocations on file to measure."
          : `${withCost} of ${totalAlloc} allocations have a non-zero labor cost rate.`,
      });
      metrics.push({
        key: "allocations_with_billing_rate", label: "Allocations with a billing rate",
        status: totalAlloc === 0 ? "unavailable" : withBilling >= totalAlloc ? "ok" : "warn",
        value: withBilling, total: totalAlloc, unit: "allocations",
        detail: totalAlloc === 0 ? "No allocations on file to measure."
          : `${withBilling} of ${totalAlloc} allocations have a non-zero billing rate.`,
      });
    } else {
      metrics.push({ key: "allocations_with_cost_rate", label: "Allocations with a labor cost rate", status: "unavailable", value: null, detail: "No rate columns found on ResourceAllocation." });
      metrics.push({ key: "allocations_with_billing_rate", label: "Allocations with a billing rate", status: "unavailable", value: null, detail: "No rate columns found on ResourceAllocation." });
    }
  } catch (e: any) {
    metrics.push({ key: "allocations_with_cost_rate", label: "Allocations with a labor cost rate", status: "unavailable", value: null, detail: `Rate data unavailable: ${e?.message ?? e}` });
    metrics.push({ key: "allocations_with_billing_rate", label: "Allocations with a billing rate", status: "unavailable", value: null, detail: `Rate data unavailable: ${e?.message ?? e}` });
  }

  // ── Actual vs planned hours (real; queried from core2) ───────────────────
  // Planned hours come from ResourceWorkItems.AllocationHour (entered via the
  // project-team weekly editor). Actual hours come from the timesheet table
  // (ResourceTimeSheet.TotalHours) when present, otherwise ResourceWorkItems
  // .ActualHour. Utilization = actual ÷ planned via safeRatio, so a zero/missing
  // planned figure shows N/A rather than a misleading number. We NEVER invent
  // actuals — if no actual hours are recorded we say so plainly.
  // Multiple sources can supply actual hours (timesheets, work-item actuals). We
  // pick the highest-priority real source per the admin dataSourcePriority ranking
  // (spec item 27) instead of a hard-coded preference. When NO validated actuals
  // exist, an admin may opt to use historical allocations (planned hours) as a
  // labelled "Estimated Actuals" proxy (spec item 35) — off by default, and always
  // flagged as an estimate, never presented as measured.
  let plannedHours = 0, actualHours = 0, actualSource = "", actualEstimated = false;
  try {
    const pool = await getPool();
    const rwiCols = new Set<string>(
      (await pool.request().query(
        `SELECT COLUMN_NAME FROM core2.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ResourceWorkItems'`,
      )).recordset.map((r: any) => String(r.COLUMN_NAME)),
    );
    const delClause = rwiCols.has("Deleted") ? "AND (Deleted=0 OR Deleted IS NULL)" : "";
    const candidates: { source: string; value: { hours: number; label: string } }[] = [];
    if (rwiCols.has("AllocationHour")) {
      const r = await pool.request().input("tid", tid).query(
        `SELECT SUM(ISNULL(AllocationHour,0)) AS planned`
        + (rwiCols.has("ActualHour") ? `, SUM(ISNULL(ActualHour,0)) AS actual` : `, 0 AS actual`)
        + ` FROM core2.dbo.ResourceWorkItems WHERE TenantID=@tid ${delClause}`);
      const row: any = r.recordset[0] ?? {};
      plannedHours = Number(row.planned ?? 0);
      const wiActual = Number(row.actual ?? 0);
      if (wiActual > 0) candidates.push({ source: "Manual", value: { hours: wiActual, label: "work-item actuals" } });
    }
    // Dedicated timesheet table, when it carries hours.
    const tsExists = (await pool.request().query(
      `SELECT 1 AS ok FROM core2.sys.objects WHERE name='ResourceTimeSheet' AND type='U'`,
    )).recordset.length > 0;
    if (tsExists) {
      const tsCols = new Set<string>(
        (await pool.request().query(
          `SELECT COLUMN_NAME FROM core2.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ResourceTimeSheet'`,
        )).recordset.map((r: any) => String(r.COLUMN_NAME)),
      );
      // Prefer TotalHours; fall back to Hours or ActualHours if the column name differs.
      const tsHoursCol = tsCols.has("TotalHours") ? "TotalHours"
        : tsCols.has("Hours")       ? "Hours"
        : tsCols.has("ActualHours") ? "ActualHours"
        : null;
      const tsDelClause = tsCols.has("Deleted") ? "AND (Deleted=0 OR Deleted IS NULL)" : "";
      const tsTidClause = tsCols.has("TenantID") ? "WHERE TenantID=@tid" : "WHERE 1=1";
      if (tsHoursCol) {
        const ts = await pool.request().input("tid", tid).query(
          `SELECT SUM(ISNULL(${tsHoursCol},0)) AS total FROM core2.dbo.ResourceTimeSheet ${tsTidClause} ${tsDelClause}`);
        const tsTotal = Number(ts.recordset[0]?.total ?? 0);
        if (tsTotal > 0) candidates.push({ source: "Timesheet", value: { hours: tsTotal, label: "timesheets" } });
      }
    }
    // (item 27) Highest-priority real source wins per the admin ranking.
    const chosen = resolveDataSource(candidates, settings.dataSourcePriority);
    if (chosen) { actualHours = chosen.value.hours; actualSource = chosen.value.label; }
    // (item 35) Optional historical-allocation proxy when no validated actuals.
    if (actualHours <= 0 && plannedHours > 0 && settings.useHistoricalProxyActuals) {
      actualHours = plannedHours;
      actualEstimated = true;
      actualSource = "Estimated Actuals (historical allocations — proxy, not validated)";
    }
    const util = safeRatio(actualHours, plannedHours);
    if (plannedHours <= 0 && actualHours <= 0) {
      metrics.push({
        key: "actual_labor", label: "Actual vs planned hours",
        status: "unavailable", value: null,
        detail: "No planned or actual hours are recorded for this tenant yet.",
      });
    } else if (actualHours <= 0) {
      metrics.push({
        key: "actual_labor", label: "Actual vs planned hours",
        status: "warn", value: null, total: Math.round(plannedHours), unit: "hours",
        detail: `${Math.round(plannedHours)} planned hours on file, but no actual hours have been recorded yet (utilization not yet measurable).`,
      });
    } else {
      const pct = util.value === null ? null : Math.round(util.value * 100);
      metrics.push({
        key: "actual_labor", label: "Actual vs planned hours",
        status: actualEstimated ? "warn" : (pct === null ? "unavailable" : "ok"),
        value: Math.round(actualHours), total: Math.round(plannedHours), unit: "hours",
        detail: pct === null
          ? `${Math.round(actualHours)} actual hours recorded (from ${actualSource}), but no planned hours to compare against.`
          : actualEstimated
            ? `No validated actuals on file — showing ${pct}% utilization from ${actualSource}. Treat as an estimate, not measured.`
            : `${Math.round(actualHours)} actual hours (from ${actualSource}) vs ${Math.round(plannedHours)} planned = ${pct}% utilization.`,
      });
    }
  } catch (e: any) {
    metrics.push({ key: "actual_labor", label: "Actual vs planned hours", status: "unavailable", value: null, detail: `Hours data unavailable: ${e?.message ?? e}` });
  }

  // ── Capacity overview (item 36): allocation vs availability (real) ────────
  // Available capacity = roster × work-week hours × forecast window. Allocation%
  // = planned hours ÷ available capacity (via safeRatio so a zero roster shows
  // N/A). Availability% is the honest complement (clamped to ≥0). Utilization%
  // (actual ÷ planned) is reported by the metric above; we don't restate it here.
  try {
    const availableCapacity = totalRoster > 0
      ? totalRoster * settings.workWeekHours * settings.forecastWeeks
      : null;
    const allocRatio = safeRatio(plannedHours, availableCapacity, {
      fallbackEnabled: settings.fallbackDenominatorEnabled,
      fallbackDenominator: null,
    });
    if (allocRatio.value === null) {
      metrics.push({
        key: "capacity_overview", label: "Capacity allocation vs availability",
        status: "unavailable", value: null,
        detail: totalRoster > 0
          ? "Not enough data to measure allocation against available capacity."
          : "No roster on file to measure capacity.",
      });
    } else {
      const allocPct = Math.round(allocRatio.value * 100);
      const availPct = Math.max(0, 100 - allocPct);
      metrics.push({
        key: "capacity_overview", label: "Capacity allocation vs availability",
        status: allocPct > settings.overCapacityPct ? "warn" : "ok",
        value: allocPct, total: 100, unit: "%",
        detail: `${allocPct}% of available capacity is allocated (${availPct}% available), `
          + `based on ${totalRoster} people × ${settings.workWeekHours}h × ${settings.forecastWeeks} weeks.`,
      });
    }
  } catch (e: any) {
    metrics.push({ key: "capacity_overview", label: "Capacity allocation vs availability", status: "unavailable", value: null, detail: `Capacity data unavailable: ${e?.message ?? e}` });
  }

  // ── System-filled (assumed) values (real; our Postgres) ──────────────────
  try {
    const rows = await getOnboardingAssumedFields(normTenant(tenantId));
    assumedTotal = rows.length;
    for (const r of rows) {
      const tier = (r as any).confidence ?? "system_defaulted";
      byConfidence[tier] = (byConfidence[tier] ?? 0) + 1;
    }
    metrics.push({
      key: "assumed_values", label: "System-filled (assumed) values",
      status: assumedTotal > 0 ? "warn" : "ok",
      value: assumedTotal, unit: "values",
      detail: assumedTotal > 0
        ? `${assumedTotal} field values were filled by defaults/AI rather than provided by the client.`
        : "No assumed values recorded for this tenant.",
    });
  } catch (e: any) {
    metrics.push({ key: "assumed_values", label: "System-filled (assumed) values", status: "unavailable", value: null, detail: `Assumed-data store unavailable: ${e?.message ?? e}` });
  }

  // ── Forecast confidence score — purely based on uploaded file column coverage ──
  // Score starts at 100 and deducts points for each group of important columns
  // that were absent from the client's uploaded file. This is the only honest
  // measure: we can only know what data the client actually provided.
  const allMapped = new Set(uploadedCols.map(c => c.mappedTo));
  interface KeyGroup { id: string; label: string; fields: string[]; weight: number }
  const KEY_GROUPS: KeyGroup[] = [
    { id: "project_name",   label: "Project name/title not uploaded",     fields: ["Title","ShortName"],                                                 weight: 20 },
    { id: "project_status", label: "Project status not uploaded",         fields: ["Status","CRMProjectStatusChoice"],                                   weight: 10 },
    { id: "division_bu",    label: "Division / BU not uploaded",          fields: ["DivisionLookup","Division","CRMBusinessUnitChoice","DivisionName"],  weight: 10 },
    { id: "contract_val",   label: "Contract value not uploaded",         fields: ["ApproxContractValue","ForecastedProjectCost","LaborContractAmount"], weight: 10 },
    { id: "staff_email",    label: "Staff directory not uploaded",        fields: ["EmailAddress","Email"],                                              weight: 15 },
    { id: "department",     label: "Department / org data not uploaded",  fields: ["DepartmentLookup","Department"],                                     weight: 10 },
    { id: "allocation",     label: "Allocation data not uploaded",        fields: ["PctAllocation","AllocationHour","AssigneeUser","ResourceUser"],       weight: 15 },
    { id: "schedule",       label: "Schedule / phase data not uploaded",  fields: ["Phase","StartDate","DueDate","StageStep","EstimatedConstructionDuration"], weight: 10 },
  ];
  const breakdown: { label: string; deduction: number }[] = [];
  let score = 100;
  if (uploadedCols.length === 0) {
    // No saved file mapping. Check whether live data already exists in core2
    // (e.g. RDS/upstream tenants whose data arrived via RM ONE, not a file upload).
    const hasLiveData =
      (totalProjects ?? 0) > 0 || (totalPeople ?? 0) > 0 ||
      totalRoster > 0 || totalAlloc > 0;

    if (!hasLiveData) {
      // Genuinely nothing on file
      score = 0;
      breakdown.push({ label: "No data uploaded yet", deduction: 100 });
    } else {
      // Data exists — derive column coverage from live core2 signals so the
      // score reflects what's actually present rather than just the absence of
      // a file-mapping record in our Postgres store.
      const derived = new Set<string>();

      if ((totalProjects ?? 0) > 0)                              derived.add("Title");
      if (unassignedProjects < (totalProjects ?? 1))             derived.add("DivisionLookup");
      if ((totalProjects ?? 0) > 0)                              derived.add("Status");
      if ((totalPeople ?? 0) > 0)                                derived.add("EmailAddress");
      if (orphaned < totalRoster && totalRoster > 0)             derived.add("DepartmentLookup");
      if (totalAlloc > 0)                                        derived.add("PctAllocation");

      try {
        const livePool = await getPool();
        const [schedRes, cvRes] = await Promise.all([
          livePool.request().input("tid", tid)
            .query(`SELECT TOP 1 1 AS n FROM core2.dbo.PMMTasks WHERE TenantID=@tid AND (Deleted=0 OR Deleted IS NULL)`),
          livePool.request().input("tid", tid)
            .query(`SELECT TOP 1 1 AS n FROM core2.dbo.PMM WHERE TenantID=@tid AND (Deleted=0 OR Deleted IS NULL) AND ISNULL(ApproxContractValue,0)>0`),
        ]);
        if (schedRes.recordset.length > 0) { derived.add("Phase"); derived.add("StartDate"); }
        if (cvRes.recordset.length > 0)     derived.add("ApproxContractValue");
      } catch { /* non-fatal — score without these groups */ }

      for (const grp of KEY_GROUPS) {
        const covered = grp.fields.some(f => derived.has(f));
        if (!covered) {
          score -= grp.weight;
          breakdown.push({ label: grp.label, deduction: grp.weight });
        }
      }
      score = Math.max(0, Math.min(100, score));

      // Synthesise an uploadedSheets entry so the Uploaded Columns card
      // shows what data groups were detected rather than "no file uploaded".
      if (uploadedSheets.length === 0 && derived.size > 0) {
        uploadedSheets = [{
          sheet: "RM ONE System Data",
          columns: [...derived].map(f => ({ originalHeader: f, mappedTo: f })),
        }];
      }
    }
  } else {
    for (const grp of KEY_GROUPS) {
      const covered = grp.fields.some(f => allMapped.has(f));
      if (!covered) {
        score -= grp.weight;
        breakdown.push({ label: grp.label, deduction: grp.weight });
      }
    }
    score = Math.max(0, Math.min(100, score));
  }

  // ── Named warning chips (client spec) ────────────────────────────────────
  const warnings: { code: string; label: string; reason: string }[] = [];
  if (score < 60 || actualHours <= 0) warnings.push({ code: "forecast_confidence_low", label: "Forecast Confidence Low", reason: actualHours <= 0 ? `No actual hours are recorded yet, so utilization-based forecasts are unvalidated. Composite data-readiness score is ${score}/100.` : `Composite data-readiness score is ${score}/100.` });
  if (bench > 0 || unassignedProjects > 0) warnings.push({ code: "allocation_forecasting_limited", label: "Allocation Forecasting Limited", reason: `${bench} unallocated people and ${unassignedProjects} unassigned projects reduce allocation forecast accuracy.` });
  if (!ratesKnown || (totalAlloc > 0 && withCost === 0)) warnings.push({ code: "margin_analytics_disabled", label: "Margin Analytics Disabled", reason: ratesKnown ? "No labor cost rates are present on allocations." : "Labor cost rate data could not be measured." });
  if (!ratesKnown || (totalAlloc > 0 && withBilling === 0)) warnings.push({ code: "revenue_forecasting_disabled", label: "Revenue Forecasting Disabled", reason: ratesKnown ? "No billing rates are present on allocations." : "Billing rate data could not be measured." });

  // ── Estimated-vs-validated (spec item 40) ────────────────────────────────
  // "Estimated" = values the system filled (assumedTotal, real). "Validated" =
  // client-provided field values. We have no stored count of the full field
  // universe, so the true denominator is unknown → safeRatio returns N/A rather
  // than a misleading number. If an admin enables `fallbackDenominatorEnabled`,
  // we use the count of records we actually measured above (projects + people +
  // roster + allocations) as a defensible, real fallback denominator and flag
  // the result as an estimate so the UI can asterisk it.
  const measuredRecords =
    (totalProjects ?? 0) + (totalPeople ?? 0) + totalRoster + totalAlloc;
  const estVsVal = safeRatio(assumedTotal, null, {
    fallbackEnabled: settings.fallbackDenominatorEnabled,
    fallbackDenominator: measuredRecords > 0 ? measuredRecords : null,
  });

  res.json({
    tenantLabel: tenantId,
    generatedAt: new Date().toISOString(),
    forecastConfidence: { score, breakdown },
    uploadedColumns: uploadedSheets,
    dataConfidence: {
      assumedTotal,
      byConfidence,
      estimatedVsValidated: {
        estimatedCount: assumedTotal,
        ratio: estVsVal.value,
        estimated: estVsVal.estimated,
        unavailable: estVsVal.unavailable,
        note: estVsVal.note,
      },
      note: "Tracks values the system filled (assumed). A full validated-vs-total ratio requires a client-provided field count, which is not stored; absence of an assumed flag means the value came from the client upload.",
    },
    warnings,
    metrics,
  });
  return;
});

// ── GET /api/onboarding/settings ─────────────────────────────────────────
// Returns the missing-data default settings. Without ?tenantId it returns the
// built-in + global layers; with ?tenantId it also returns that client's
// effective (merged) defaults and its own stored overrides, so the admin UI can
// show "inherited" vs "overridden".
// ── Company-wide DISPLAY defaults (record fields / list columns / view mode) ─
// Admins configure what everyone at their company sees by default; each
// user's own personalization (kept client-side) still wins over these.
// Stored in the settings-row table under scope "display:<tenant>" so it can
// never collide with the OnboardingDefaults layers handled below. There is
// deliberately NO server-side cache: reads are one indexed-row lookup, and
// skipping a cache means every cluster worker serves a fresh copy the moment
// an admin saves — no IPC bust to broadcast (or forget).
const DISPLAY_SCOPE_PREFIX = "display:";

// Last-good fallback copies, per worker. Reads still ALWAYS hit the DB first —
// the no-cache freshness rationale above is preserved — but the upstream DB
// has brief timeout bursts, and without a fallback the settings page errors
// until the user manually refreshes. Served ONLY when the fresh read fails;
// failures themselves are never stored.
const displayDefaultsLastGood = new Map<string, { ts: number; defaults: unknown }>();
const DISPLAY_LAST_GOOD_MAX_AGE_MS = 30 * 60 * 1000;

// Any authenticated company user may READ their company's display defaults
// (everyone needs them to render); superadmins may read any tenant's.
router.get("/display-defaults", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const label = effectiveTenant(src, String(req.query.tenantId ?? ""));
    const scope = DISPLAY_SCOPE_PREFIX + normTenant(label);
    try {
      const row = await getOnboardingSettings(scope);
      const defaults = sanitizeDisplayDefaults(row?.settings);
      displayDefaultsLastGood.set(scope, { ts: Date.now(), defaults });
      res.json({ tenant: label, defaults });
    } catch (readErr: any) {
      const hit = displayDefaultsLastGood.get(scope);
      if (hit && Date.now() - hit.ts < DISPLAY_LAST_GOOD_MAX_AGE_MS) {
        console.error(`[display-defaults] read failed for ${label}, serving last-good copy:`, readErr?.message ?? readErr);
        res.json({ tenant: label, defaults: hit.defaults, _degraded: true });
        return;
      }
      throw readErr;
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Writes are admin-only and fail closed: explicit manager/user accounts 403.
router.put("/display-defaults", async (req: Request, res: Response) => {
  try {
    const requested = req.body?.tenantId ? String(req.body.tenantId) : null;
    const src = await requireTenantAdmin(req, res, requested);
    if (!src) return;
    const label = effectiveTenant(src, requested);
    setConfigurationAuditTarget(res, "settings:display-defaults", "Display defaults");
    const scope = DISPLAY_SCOPE_PREFIX + normTenant(label);
    const incoming = sanitizeDisplayDefaults(req.body?.defaults);
    // Optional per-section save: the settings page auto-saves ONE card per
    // request; with `section` set the SERVER merges that card's keys onto the
    // stored doc, so the client needs a single round trip (it used to
    // GET+merge+PUT). The two sections partition the whole doc: viewMode ↔
    // columns/extraColumns/detail. Whole-doc writes (no section) remain for
    // the record-page pin/hide path.
    const section = req.body?.section === "viewMode" || req.body?.section === "fields"
      ? (req.body.section as "viewMode" | "fields")
      : null;
    let defaults = incoming;
    if (section) {
      let base: ReturnType<typeof sanitizeDisplayDefaults>;
      try {
        const row = await getOnboardingSettings(scope);
        base = sanitizeDisplayDefaults(row?.settings);
      } catch (readErr: any) {
        // NEVER merge onto the last-good fallback here. It is per-worker and
        // can be up to 30 minutes stale — writing a merge over a stale base
        // would silently resurrect old values for the OTHER section (e.g.
        // revert a viewMode another admin saved minutes ago on a different
        // worker). Reads may serve last-good; a WRITE must not persist it.
        // Fail honestly instead — the settings card toasts "Could not save"
        // and the user simply retries after the blip.
        console.error(`[display-defaults] merge-base read failed for ${label} — refusing section save:`, readErr?.message ?? readErr);
        res.status(503).json({ error: "Could not save right now — please try again in a moment." });
        return;
      }
      defaults = section === "viewMode"
        ? { ...base, viewMode: incoming.viewMode }
        : { ...base, columns: incoming.columns, extraColumns: incoming.extraColumns, detail: incoming.detail };
    }
    await upsertSettingsWithAudit(res, {
      scope,
      label,
      settings: defaults as unknown as Record<string, unknown>,
    });
    // Keep this worker's fallback copy in step with the write.
    displayDefaultsLastGood.set(scope, { ts: Date.now(), defaults });
    res.json({ ok: true, tenant: label, defaults });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/onboarding/detail-field-catalog?module=PMM|OPM|LEM ─────────────
// Which raw record fields CAN appear on a module's record detail page —
// RECORD_FIELDS ∩ live table columns, the exact set getRecordDetail returns in
// rawFields. Lets the Display Defaults settings card offer an inline
// record-page field editor without opening a record. Schema is shared across
// tenants (one core2 DB), so no tenant scoping is needed beyond auth.
// Last-good fallback (same rationale as displayDefaultsLastGood above).
const detailCatalogLastGood = new Map<string, string[]>();
router.get("/detail-field-catalog", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const mod = String(req.query.module ?? "").toUpperCase();
    if (mod !== "PMM" && mod !== "OPM" && mod !== "LEM") {
      res.status(400).json({ error: "module must be PMM, OPM, or LEM" });
      return;
    }
    try {
      const fields = await detailFieldCatalog(mod);
      detailCatalogLastGood.set(mod, fields);
      res.json({ module: mod, fields });
    } catch (readErr: any) {
      // The schema is shared across tenants and effectively static; serving
      // the last successful copy during an upstream-DB timeout burst beats a
      // 500 (the settings page would render with most field rows missing).
      const hit = detailCatalogLastGood.get(mod);
      if (hit) {
        console.error(`[detail-field-catalog] read failed for ${mod}, serving last-good copy:`, readErr?.message ?? readErr);
        res.json({ module: mod, fields: hit, _degraded: true });
        return;
      }
      throw readErr;
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Schedule STAGE RULES (field locks + conditional stage skips) ────────────
// Shared per tenant for lifecycle-assigned records: "lock these fields from/until stage X" and
// "records where <field>=<value> skip these stages". Stored like the display
// defaults above (settings row, scope "stagerules:<tenant>"); ENFORCED
// server-side in updateRecordFieldsRds, so unlike display defaults the write
// path caches these per worker — saves broadcast an IPC bust below.
const STAGE_RULES_SCOPE_PREFIX = "stagerules:";

// Ticket ID for a per-record rules override (scope key must stay sane and
// delimiter-free). Uppercased — stageRulesRecordScope stores them uppercase.
function normStageRecordId(raw: unknown): string | null {
  const rid = String(raw ?? "").trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9._-]{0,79}$/.test(rid) ? rid : null;
}

// Any authenticated company user may READ the rules (the record pages need
// them to grey out locked fields and hide skipped stages); superadmins may
// read any tenant's. Also returns the tenant-wide stage ORDER per module
// (null = no configured order) so the web evaluates locks and renders the
// lifecycle bar with the SAME sequence the server enforces with.
router.get("/stage-rules", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const label = effectiveTenant(src, String(req.query.tenantId ?? ""));
    const row = await getOnboardingSettings(STAGE_RULES_SCOPE_PREFIX + normTenant(label));
    const rules = sanitizeStageRules(row?.settings);
    const tid = resolveTenantId(label);
    const stageOrder: Record<string, string[] | null> = { PMM: null, OPM: null, LEM: null };
    for (const mod of STAGE_RULE_MODULES) {
      stageOrder[mod] = await getConfiguredStageOrder(tid, mod, label).catch(() => null);
    }
    // Viewer-scoped stage sets: when a group-scoped workflow template (Stage
    // Rules → Save As…) — or, for OPM, a legacy oppStageSets entry — matches
    // THIS viewer, that set's stages become the stage order they see for that
    // module (stage bar, pipeline board, lock evaluation) — mirroring how a
    // matching projectPhaseSets entry wins at record creation. No match → the
    // tenant-wide order above stands. Only for the viewer's OWN tenant view; a
    // superadmin inspecting another company sees its tenant-wide order (their
    // memberships aren't meaningful there).
    if (normTenant(label) === normTenant(src.tenant)) {
      // One settings + groups read for all three modules; OPM keeps its
      // legacy oppStageSets fallback when no template matched.
      const tplOrders = await resolveTemplateStageOrdersForViewer(label, src.userId);
      for (const mod of STAGE_RULE_MODULES) {
        const viewerStages = tplOrders[mod]
          ?? (mod === "OPM" ? await resolveOppStagesForViewer(label, src.userId) : null);
        if (viewerStages && viewerStages.length > 0) stageOrder[mod] = viewerStages;
      }
      // Per-stage "Applies to" audiences: drop scoped stages this viewer
      // doesn't get from the RESOLVED per-module order only. The raw `rules`
      // doc stays untouched — the settings editor reads rules.stageOrder
      // directly, and filtering THAT would silently delete stages from the
      // workflow on the admin's next save. Lock/layout evaluation
      // (checkStageFieldLocks) also keeps the full order, so a lock anchored
      // on a hidden stage never deactivates. Fail-visible on membership
      // failure (null → unfiltered).
      if (hasAnyStageAudiences(rules)) {
        const membership = await viewerAudienceMembership(label, src.userId);
        for (const mod of STAGE_RULE_MODULES) {
          const cur = stageOrder[mod];
          if (cur && cur.length > 0) {
            stageOrder[mod] = filterStagesByAudience(cur, rules.stageAudiences?.[mod], membership);
          }
        }
      }
    }
    // Per-record override read: the "Set rules" drawer on a record page seeds
    // from the EFFECTIVE doc — the record's fork when one exists, the company
     // doc otherwise. `source` tells the UI which it got (so it can offer
     // "Use schedule rules" only when a fork actually exists).
    const rawRec = String(req.query.recordId ?? "").trim();
    if (rawRec) {
      const recId = normStageRecordId(rawRec);
      if (!recId) { res.status(400).json({ error: "Invalid recordId" }); return; }
      const recRow = await getOnboardingSettings(stageRulesRecordScope(label, recId));
      if (recRow) {
        res.json({ tenant: label, rules: sanitizeStageRules(recRow.settings), stageOrder, source: "record", recordId: recId });
        return;
      }
      res.json({ tenant: label, rules, stageOrder, source: "tenant", recordId: recId });
      return;
    }
    res.json({ tenant: label, rules, stageOrder });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// The phases/statuses that ACTUALLY arrived with the tenant's imported data
// (live core2 scan — PMMTasks phase titles + record status values). The
// settings "Manage stage/phase sets" dialogs pin these as the read-only
// "Existing from import" entry; the editable default lists live in OUR
// settings and get overwritten on save, so they can't serve as this truth.
router.get("/imported-defaults", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const label = effectiveTenant(src, String(req.query.tenantId ?? ""));
    res.json(await getImportedDefaultsRds(resolveTenantId(label)));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Writes are admin-only and fail closed (same gate as display defaults).
router.put("/stage-rules", async (req: Request, res: Response) => {
  try {
    const requested = req.body?.tenantId ? String(req.body.tenantId) : null;
    const src = await requireTenantAdmin(req, res, requested);
    if (!src) return;
    const label = effectiveTenant(src, requested);
    // ── Per-record override save / reset ────────────────────────────────────
    // recordId in the body forks the rules for ONE record (copy-on-write from
    // the drawer's effective doc). rules:null deletes the fork — the company
    // doc governs the record again. Stage PERMISSIONS are NOT forked (they
    // live in their own doc and stay tenant-wide by design).
    const rawRec = req.body?.recordId != null ? String(req.body.recordId).trim() : "";
    if (rawRec) {
      const recId = normStageRecordId(rawRec);
      if (!recId) { res.status(400).json({ error: "Invalid recordId" }); return; }
      const scope = stageRulesRecordScope(label, recId);
      setAuditTarget(res, { entityType: "schedule", entityId: recId, entityName: `${recId} stage rules` });
      const tid = resolveTenantId(label);
      if (req.body?.rules === null) {
        const existed = Boolean(await getOnboardingSettings(scope));
        await deleteSettingsWithAudit(res, scope);
        bustStageRulesCache(label);
        if (process.send) {
          try { process.send({ type: "bustCache", fn: "stageRules", tenant: label, tid }); } catch { /* shutting down */ }
        }
        console.log(`[stage-rules] ${src.username}@${src.tenant} reset record rules for ${recId} @ "${label}" (${existed ? "fork deleted" : "no fork existed"})`);
        res.json({ ok: true, tenant: label, recordId: recId, source: "tenant" });
        return;
      }
      const mod = await resolveLifecycleStageRuleModuleRds(tid, recId);
      if (!mod || !(await hasAssignedLifecycleScheduleRds(tid, recId, mod))) {
        res.status(409).json({ error: "Assign a lifecycle with at least one phase before setting rules for this record." });
        return;
      }
      // A record fork of an EMPTY doc would silently disable every company
      // rule for that record — require an explicit rules object so a buggy
      // caller can never create one by omission (reset stays explicit: null).
      if (typeof req.body?.rules !== "object" || Array.isArray(req.body?.rules)) {
        res.status(400).json({ error: "Record rules save requires a rules object (or null to reset)" });
        return;
      }
      const recRules = sanitizeStageRules(req.body.rules);
      await upsertSettingsWithAudit(res, {
        scope,
        label: `${label} · ${recId}`,
        settings: recRules as unknown as Record<string, unknown>,
      });
      // Only the stage-rules enforcement cache holds record docs — the order/
      // field-option caches are tenant-level and unaffected by a record fork.
      bustStageRulesCache(label);
      if (process.send) {
        try { process.send({ type: "bustCache", fn: "stageRules", tenant: label, tid }); } catch { /* shutting down */ }
      }
      console.log(`[stage-rules] ${src.username}@${src.tenant} saved RECORD rules for ${recId} @ "${label}" (${recRules.fieldLocks.length} locks, ${recRules.stageSkips.length} skips, ${recRules.requiredFields?.length ?? 0} required)`);
      res.json({ ok: true, tenant: label, recordId: recId, source: "record", rules: recRules });
      return;
    }
    setConfigurationAuditTarget(res, "settings:stage-rules", "Stage rules");
    const rules = sanitizeStageRules(req.body?.rules);
    await upsertSettingsWithAudit(res, {
      scope: STAGE_RULES_SCOPE_PREFIX + normTenant(label),
      label,
      settings: rules as unknown as Record<string, unknown>,
    });
    // Enforcement caches: this worker now, every sibling via IPC. The order
    // cache must go too — a saved workflow (stageOrder) changes the effective
    // order that lock evaluation and the lifecycle bars read.
    bustStageRulesCache(label);
    bustStageOrderCache(resolveTenantId(label));
    // Status dropdowns embed the workflow stage names — drop the cached lists
    // on this worker too (siblings handle it via the IPC message below).
    bustFieldOptionsCache(resolveTenantId(label));
    if (process.send) {
      try { process.send({ type: "bustCache", fn: "stageRules", tenant: label, tid: resolveTenantId(label) }); } catch { /* shutting down */ }
    }
    console.log(`[stage-rules] ${src.username}@${src.tenant} saved rules for "${label}" (${rules.fieldLocks.length} locks, ${rules.stageSkips.length} skips, workflow=${rules.stageOrder ? Object.keys(rules.stageOrder).join("/") : "derived"})`);
    res.json({ ok: true, tenant: label, rules });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Per-record rules fork list (admin-only) ──────────────────────────────────
// Returns every record that has its own stage-rules override doc for this
// tenant. Backs the "Projects running custom rules" section in Settings so
// admins can see — and reset — forks without visiting each record individually.
router.get("/stage-rules/record-forks", async (req: Request, res: Response) => {
  try {
    const requested = req.query.tenantId ? String(req.query.tenantId) : null;
    const src = await requireTenantAdmin(req, res, requested);
    if (!src) return;
    const label = effectiveTenant(src, String(req.query.tenantId ?? ""));
    const tenantKey = normTenant(label);
    const prefix = `stagerules:${tenantKey}:rec:`;
    const rows = await getOnboardingSettingsByPrefix(prefix);
    const forks = rows
      .filter(r => r.scope.startsWith(prefix))
      .map(r => {
        const recordId = r.scope.slice(prefix.length);
        const rules = sanitizeStageRules(r.settings);
        const ruleCount =
          rules.fieldLocks.length +
          rules.stageSkips.length +
          (rules.requiredFields?.length ?? 0) +
          (rules.formLayout ?? []).length;
        return { recordId, ruleCount, lastChangedAt: r.updatedAt, label: r.label };
      });
    res.json({ forks });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Workflow TEMPLATES (#131): reusable named stage-list templates ──────────
// Standard-format saves of a workflow's stage list (+ colors) so admins can
// reuse a pipeline across Leads/Opportunities/Projects or re-apply it later.
// Config-only (no enforcement cache — applying a template goes through the
// normal stage-rules save above). Same storage + gating pattern as siblings.
const WORKFLOW_TEMPLATES_SCOPE_PREFIX = "stagetemplates:";

router.get("/workflow-templates", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const label = effectiveTenant(src, String(req.query.tenantId ?? ""));
    const row = await getOnboardingSettings(WORKFLOW_TEMPLATES_SCOPE_PREFIX + normTenant(label));
    res.json({ tenant: label, ...sanitizeWorkflowTemplates(row?.settings) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/workflow-templates", async (req: Request, res: Response) => {
  try {
    const requested = req.body?.tenantId ? String(req.body.tenantId) : null;
    const src = await requireTenantAdmin(req, res, requested);
    if (!src) return;
    const label = effectiveTenant(src, requested);
    setConfigurationAuditTarget(res, "settings:workflow-templates", "Workflow templates");
    const doc = sanitizeWorkflowTemplates(req.body);
    await upsertSettingsWithAudit(res, {
      scope: WORKFLOW_TEMPLATES_SCOPE_PREFIX + normTenant(label),
      label,
      settings: doc as unknown as Record<string, unknown>,
    });
    console.log(`[stage-rules] ${src.username}@${src.tenant} saved workflow templates for "${label}" (${doc.templates.length} templates)`);
    res.json({ ok: true, tenant: label, ...doc });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Company ACCESS CONTROL (#87): user groups, custom access levels, and
// per-stage permissions ──────────────────────────────────────────────────────
// Same storage + gating pattern as the stage rules above: one settings row
// per doc ("usergroups:<tenant>", "accesslevels:<tenant>",
// "stageperms:<tenant>"). Any company user may READ (pickers and the record
// pages need them); writes are admin-gated (custom levels with the
// "manage settings" capability count — see requireTenantAdmin). Enforcement
// caches live in lib/access-control.ts; every save busts this worker and
// broadcasts ONE IPC message (fn "accessControl") for the siblings.

function broadcastAccessControlBust(label: string): void {
  bustAccessControlCache(label);
  if (process.send) {
    try { process.send({ type: "bustCache", fn: "accessControl", tenant: label, tid: resolveTenantId(label) }); } catch { /* shutting down */ }
  }
}

router.get("/user-groups", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const label = effectiveTenant(src, String(req.query.tenantId ?? ""));
    const row = await getOnboardingSettings(USER_GROUPS_SCOPE_PREFIX + normTenant(label));
    res.json({ tenant: label, ...sanitizeUserGroups(row?.settings) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/user-groups", async (req: Request, res: Response) => {
  try {
    const requested = req.body?.tenantId ? String(req.body.tenantId) : null;
    const src = await requireTenantAdmin(req, res, requested);
    if (!src) return;
    const label = effectiveTenant(src, requested);
    setConfigurationAuditTarget(res, "settings:user-groups", "User groups");
    const doc = sanitizeUserGroups(req.body);
    await upsertSettingsWithAudit(res, {
      scope: USER_GROUPS_SCOPE_PREFIX + normTenant(label),
      label,
      settings: doc as unknown as Record<string, unknown>,
    });
    broadcastAccessControlBust(label);
    console.log(`[access-control] ${src.username}@${src.tenant} saved user groups for "${label}" (${doc.groups.length} groups)`);
    res.json({ ok: true, tenant: label, ...doc });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/access-levels", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const label = effectiveTenant(src, String(req.query.tenantId ?? ""));
    const row = await getOnboardingSettings(ACCESS_LEVELS_SCOPE_PREFIX + normTenant(label));
    res.json({ tenant: label, ...sanitizeAccessLevels(row?.settings) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/access-levels", async (req: Request, res: Response) => {
  try {
    const requested = req.body?.tenantId ? String(req.body.tenantId) : null;
    const src = await requireTenantAdmin(req, res, requested);
    if (!src) return;
    const label = effectiveTenant(src, requested);
    setConfigurationAuditTarget(res, "settings:access-levels", "Access levels");
    const doc = sanitizeAccessLevels(req.body);
    await upsertSettingsWithAudit(res, {
      scope: ACCESS_LEVELS_SCOPE_PREFIX + normTenant(label),
      label,
      settings: doc as unknown as Record<string, unknown>,
    });
    broadcastAccessControlBust(label);
    console.log(`[access-control] ${src.username}@${src.tenant} saved access levels for "${label}" (${doc.levels.length} levels)`);
    res.json({ ok: true, tenant: label, ...doc });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/stage-permissions", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const label = effectiveTenant(src, String(req.query.tenantId ?? ""));
    const row = await getOnboardingSettings(STAGE_PERMS_SCOPE_PREFIX + normTenant(label));
    res.json({ tenant: label, ...sanitizeStagePerms(row?.settings) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/stage-permissions", async (req: Request, res: Response) => {
  try {
    const requested = req.body?.tenantId ? String(req.body.tenantId) : null;
    const src = await requireTenantAdmin(req, res, requested);
    if (!src) return;
    const label = effectiveTenant(src, requested);
    setConfigurationAuditTarget(res, "settings:stage-permissions", "Stage permissions");
    const doc = sanitizeStagePerms(req.body);
    await upsertSettingsWithAudit(res, {
      scope: STAGE_PERMS_SCOPE_PREFIX + normTenant(label),
      label,
      settings: doc as unknown as Record<string, unknown>,
    });
    broadcastAccessControlBust(label);
    console.log(`[access-control] ${src.username}@${src.tenant} saved stage permissions for "${label}" (${doc.rules.length} rules)`);
    res.json({ ok: true, tenant: label, ...doc });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Navigation visibility (#88): show/hide menu items per tenant + group ────
// Same storage + gating pattern as the access-control docs above (one settings
// row, scope "navvis:<tenant>"). Any company user may READ the raw doc (the
// Settings UI needs it); writes are admin-gated. The sidebar itself asks
// GET /api/rmone/my-navigation for the server-RESOLVED per-user answer.
router.get("/nav-visibility", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const label = effectiveTenant(src, String(req.query.tenantId ?? ""));
    const row = await getOnboardingSettings(NAV_VISIBILITY_SCOPE_PREFIX + normTenant(label));
    res.json({ tenant: label, ...sanitizeNavVisibility(row?.settings) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/nav-visibility", async (req: Request, res: Response) => {
  try {
    const requested = req.body?.tenantId ? String(req.body.tenantId) : null;
    const src = await requireTenantAdmin(req, res, requested);
    if (!src) return;
    const label = effectiveTenant(src, requested);
    setConfigurationAuditTarget(res, "settings:nav-visibility", "Navigation visibility");
    const doc = sanitizeNavVisibility(req.body);
    await upsertSettingsWithAudit(res, {
      scope: NAV_VISIBILITY_SCOPE_PREFIX + normTenant(label),
      label,
      settings: doc as unknown as Record<string, unknown>,
    });
    broadcastAccessControlBust(label);
    console.log(`[access-control] ${src.username}@${src.tenant} saved nav visibility for "${label}" (${Object.keys(doc.items).length} rules)`);
    res.json({ ok: true, tenant: label, ...doc });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Office list management ───────────────────────────────────────────────
// The curated office master list lives in ONE settings row per tenant
// (scope "offices:<tenant>", { list: string[] }). Staff assignments keep the
// office denormalized on rmone_users.office, so the read merges both: curated
// names + any in-use names with their staff counts. Reads are open to any
// company user (dropdowns need them); writes are admin-gated.
const OFFICES_SCOPE_PREFIX = "offices:";

function sanitizeOfficeList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Map<string, string>();
  for (const raw of v as unknown[]) {
    if (typeof raw !== "string") continue;
    const name = raw.trim().slice(0, 200);
    if (!name) continue;
    if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    if (seen.size >= 500) break;
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

async function readOfficeDoc(label: string): Promise<string[]> {
  const row = await getOnboardingSettings(OFFICES_SCOPE_PREFIX + normTenant(label));
  return sanitizeOfficeList((row?.settings as Record<string, unknown> | undefined)?.list);
}

async function writeOfficeDoc(label: string, list: string[]): Promise<TrustedAuditChange[]> {
  const snapshot = await upsertOnboardingSettingsWithSnapshots({
    scope: OFFICES_SCOPE_PREFIX + normTenant(label),
    label,
    settings: { list: sanitizeOfficeList(list) },
  });
  return trustedAuditDiff(
    { "Office list": snapshot.before?.list ?? [] },
    { "Office list": snapshot.after.list ?? [] },
    { fields: ["Office list"] },
  );
}

function officeStaffAuditChanges(
  snapshots: Array<{ beforeOffice: string | null; afterOffice: string | null }>,
  submitted = snapshots.length,
): TrustedAuditChange[] {
  const changed = snapshots.filter((row) => row.beforeOffice !== row.afterOffice);
  const details: TrustedAuditChange[] = changed.map((row, index) => ({
    FieldName: `Staff office (row ${index + 1})`,
    OldValue: row.beforeOffice,
    NewValue: row.afterOffice,
  }));
  return boundedAuditChanges([
    {
      FieldName: "Staff office update coverage",
      OldValue: `${submitted} staff row${submitted === 1 ? "" : "s"} submitted`,
      NewValue: `${snapshots.length} matched; ${changed.length} changed; ${Math.max(0, submitted - snapshots.length)} skipped`,
    },
    ...details,
  ], details.length + 1);
}

router.get("/offices", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const label = effectiveTenant(src, String(req.query.tenantId ?? ""));
    const [curated, usage] = await Promise.all([
      readOfficeDoc(label),
      getOfficeUsage(resolveTenantId(label)),
    ]);
    const counts = new Map(usage.map(u => [u.office.toLowerCase(), u.count]));
    const names = new Map<string, string>();
    for (const n of curated) names.set(n.toLowerCase(), n);
    for (const u of usage) if (!names.has(u.office.toLowerCase())) names.set(u.office.toLowerCase(), u.office);
    const offices = [...names.values()]
      .sort((a, b) => a.localeCompare(b))
      .map(name => ({ name, staffCount: counts.get(name.toLowerCase()) ?? 0, curated: curated.some(c => c.toLowerCase() === name.toLowerCase()) }));
    res.json({ ok: true, tenant: label, offices });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/offices", async (req: Request, res: Response) => {
  try {
    const requested = req.body?.tenantId ? String(req.body.tenantId) : null;
    const src = await requireTenantAdmin(req, res, requested);
    if (!src) return;
    const label = effectiveTenant(src, requested);
    setConfigurationAuditTarget(res, "settings:offices", "Offices");
    const name = String(req.body?.name ?? "").trim().slice(0, 200);
    if (!name) return res.status(400).json({ error: "Office name is required" });
    const curated = await readOfficeDoc(label);
    if (curated.some(c => c.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: `"${name}" already exists` });
    }
    setTrustedAuditChanges(res, await writeOfficeDoc(label, [...curated, name]));
    console.log(`[offices] ${src.username}@${src.tenant} added office "${name}" for "${label}"`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

router.put("/offices", async (req: Request, res: Response) => {
  try {
    const requested = req.body?.tenantId ? String(req.body.tenantId) : null;
    const src = await requireTenantAdmin(req, res, requested);
    if (!src) return;
    const label = effectiveTenant(src, requested);
    setConfigurationAuditTarget(res, "settings:offices", "Offices");
    const from = String(req.body?.from ?? "").trim();
    const to = String(req.body?.to ?? "").trim().slice(0, 200);
    if (!from || !to) return res.status(400).json({ error: "Both the current and the new office name are required" });
    const curated = await readOfficeDoc(label);
    if (to.toLowerCase() !== from.toLowerCase() && curated.some(c => c.toLowerCase() === to.toLowerCase())) {
      return res.status(409).json({ error: `"${to}" already exists` });
    }
    // Rename propagates to every staff member currently assigned to it.
    const staffSnapshots = await renameOfficeForTenantWithSnapshots(resolveTenantId(label), from, to);
    const staffAudit = officeStaffAuditChanges(staffSnapshots);
    setTrustedAuditChanges(res, staffAudit);
    const next = curated.filter(c => c.toLowerCase() !== from.toLowerCase());
    next.push(to);
    let officeAudit: TrustedAuditChange[];
    try {
      officeAudit = await writeOfficeDoc(label, next);
    } catch (e) {
      res.locals["auditOutcome"] = "partial";
      throw new Error(`Staff office names were updated, but the curated office list could not be saved: ${String(e)}`);
    }
    setTrustedAuditChanges(res, boundedAuditChanges([...officeAudit, ...staffAudit], officeAudit.length + staffAudit.length));
    const moved = staffSnapshots.length;
    console.log(`[offices] ${src.username}@${src.tenant} renamed office "${from}" → "${to}" for "${label}" (${moved} staff updated)`);
    res.json({ ok: true, staffUpdated: moved });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

router.delete("/offices", async (req: Request, res: Response) => {
  try {
    const requested = req.body?.tenantId ? String(req.body.tenantId) : null;
    const src = await requireTenantAdmin(req, res, requested);
    if (!src) return;
    const label = effectiveTenant(src, requested);
    setAuditTarget(res, { entityType: "configuration", entityId: "settings:offices", entityName: "Offices", action: "delete.configuration" });
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "Office name is required" });
    // Deleting an office that still has staff would silently orphan them —
    // block it and tell the admin to move those people first.
    const usage = await getOfficeUsage(resolveTenantId(label));
    const inUse = usage.find(u => u.office.toLowerCase() === name.toLowerCase());
    if (inUse && inUse.count > 0) {
      return res.status(409).json({ error: `"${name}" still has ${inUse.count} staff member${inUse.count === 1 ? "" : "s"} assigned. Move or rename them first.` });
    }
    const curated = await readOfficeDoc(label);
    setTrustedAuditChanges(res, await writeOfficeDoc(label, curated.filter(c => c.toLowerCase() !== name.toLowerCase())));
    console.log(`[offices] ${src.username}@${src.tenant} deleted office "${name}" for "${label}"`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// Staff roster for the office editor: every active user with their current
// office so the admin can pick members and see who would be MOVED from
// another office. Admin-gated — it exposes the whole staff directory.
router.get("/offices/staff", async (req: Request, res: Response) => {
  try {
    const requested = req.query.tenantId ? String(req.query.tenantId) : null;
    const src = await requireTenantAdmin(req, res, requested);
    if (!src) return;
    const label = effectiveTenant(src, requested);
    const users = await getActiveUsersByTenant(resolveTenantId(label));
    const staff = users
      .map(u => ({
        id: u.id,
        name: (u.name ?? "").trim() || (u.username ?? "").trim() || (u.email ?? "").trim(),
        office: (u.office ?? "").trim() || null,
        title: (u.title ?? "").trim() || null,
      }))
      .filter(s => s.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ ok: true, tenant: label, staff });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// Assign (or clear, office=null) the office for a batch of staff members.
// Assigning to a name that isn't curated yet auto-adds it so the master list
// and the directory can't drift apart.
router.post("/offices/assign", async (req: Request, res: Response) => {
  try {
    const requested = req.body?.tenantId ? String(req.body.tenantId) : null;
    const src = await requireTenantAdmin(req, res, requested);
    if (!src) return;
    const label = effectiveTenant(src, requested);
    setConfigurationAuditTarget(res, "settings:offices", "Office assignments");
    const officeRaw = req.body?.office;
    const office = officeRaw == null ? null : String(officeRaw).trim().slice(0, 200) || null;
    const userIds = Array.isArray(req.body?.userIds)
      ? [...new Set((req.body.userIds as unknown[]).map(v => String(v ?? "").trim()).filter(Boolean))].slice(0, 2000)
      : [];
    if (!userIds.length) return res.status(400).json({ error: "No staff selected" });
    const tid = resolveTenantId(label);
    // Only touch users that actually belong to this tenant (updateUsersByIds
    // is tenant-scoped in SQL too — this just gives an honest updated count).
    const users = await getActiveUsersByTenant(tid);
    const known = new Set(users.map(u => u.id));
    const ids = userIds.filter(id => known.has(id));
    if (!ids.length) return res.status(400).json({ error: "None of the selected staff belong to this company" });
    const staffSnapshots = await updateUserOfficesWithSnapshots(tid, ids, office);
    const staffAudit = officeStaffAuditChanges(staffSnapshots, ids.length);
    setTrustedAuditChanges(res, staffAudit);
    const skipped = Math.max(0, ids.length - staffSnapshots.length);
    if (skipped > 0) res.locals["auditOutcome"] = "partial";
    if (office) {
      const curated = await readOfficeDoc(label);
      if (!curated.some(c => c.toLowerCase() === office.toLowerCase())) {
        try {
          const officeAudit = await writeOfficeDoc(label, [...curated, office]);
          setTrustedAuditChanges(res, boundedAuditChanges([...officeAudit, ...staffAudit], officeAudit.length + staffAudit.length));
        } catch (e) {
          res.locals["auditOutcome"] = "partial";
          throw new Error(`Staff assignments were updated, but the curated office list could not be saved: ${String(e)}`);
        }
      }
    }
    console.log(`[offices] ${src.username}@${src.tenant} set office ${office ? `"${office}"` : "(none)"} for ${ids.length} staff in "${label}"`);
    res.json({
      ok: true,
      updated: staffSnapshots.length,
      submitted: ids.length,
      skipped,
      ...(skipped > 0 ? { partial: true } : {}),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── Billable classifications (per-role) ─────────────────────────────────────
// One settings row per tenant (scope "rolebillable:<tenant>") mapping role id
// → "billable" | "nonbillable". Roles without an entry are unclassified.
// Reads open to company users (the Billing Rates screen needs them); writes
// admin-gated.
const ROLE_CLASS_SCOPE_PREFIX = "rolebillable:";

function sanitizeRoleClassifications(v: unknown): Record<string, "billable" | "nonbillable"> {
  const out: Record<string, "billable" | "nonbillable"> = {};
  if (!v || typeof v !== "object") return out;
  let n = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const id = k.trim().slice(0, 100);
    if (!id) continue;
    if (val === "billable" || val === "nonbillable") { out[id] = val; if (++n >= 2000) break; }
  }
  return out;
}

router.get("/role-classifications", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const label = effectiveTenant(src, String(req.query.tenantId ?? ""));
    const row = await getOnboardingSettings(ROLE_CLASS_SCOPE_PREFIX + normTenant(label));
    res.json({ ok: true, tenant: label, classifications: sanitizeRoleClassifications((row?.settings as Record<string, unknown> | undefined)?.classifications) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/role-classifications", async (req: Request, res: Response) => {
  try {
    const requested = req.body?.tenantId ? String(req.body.tenantId) : null;
    const src = await requireTenantAdmin(req, res, requested);
    if (!src) return;
    const label = effectiveTenant(src, requested);
    setConfigurationAuditTarget(res, "settings:role-classifications", "Role classifications");
    const doc = sanitizeRoleClassifications(req.body?.classifications);
    await upsertSettingsWithAudit(res, {
      scope: ROLE_CLASS_SCOPE_PREFIX + normTenant(label),
      label,
      settings: { classifications: doc },
    });
    console.log(`[role-classifications] ${src.username}@${src.tenant} saved ${Object.keys(doc).length} classifications for "${label}"`);
    res.json({ ok: true, tenant: label, classifications: doc });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/settings", async (req: Request, res: Response) => {
  try {
    let tenantId = String(req.query.tenantId ?? "").trim();
    // Tenant-specific reads require auth and are limited to your own company
    // (superadmins may read any). Global-only reads (no tenantId) stay open so
    // the live-analytics layer can read effective global defaults.
    if (tenantId) {
      const src = resolveRequestSource(req);
      if (!src) return res.status(401).json({ error: "Authentication required" });
      if (!isSuperAdminSource(src)) tenantId = src.tenant;
    }
    const globalOverrides = await readSettingsRow(GLOBAL_SCOPE);
    const globalEffective  = mergeDefaults(globalOverrides);

    if (!tenantId) {
      return res.json({
        scope: GLOBAL_SCOPE,
        builtin:   BUILTIN_ONBOARDING_DEFAULTS,
        global:    globalOverrides,
        effective: globalEffective,
      });
    }

    const clientOverrides = await readSettingsRow(normTenant(tenantId));
    const clientEffective  = mergeDefaults(globalOverrides, clientOverrides);
    res.json({
      scope: normTenant(tenantId),
      tenantLabel: tenantId,
      builtin:   BUILTIN_ONBOARDING_DEFAULTS,
      global:    globalOverrides,
      client:    clientOverrides,
      effective: clientEffective,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── POST /api/onboarding/settings/auto-detect-display ────────────────────
// Auto-detect and save the best display mode for this tenant when the admin
// has never manually chosen one (projectDisplayModeSource === "" or absent).
// Detection logic: tenant has PMMTasks rows → "full" (Full View), else
// "schedule-no-grid" (Schedule + Table). Source is stamped "auto" (same as
// the import-pipeline path). Idempotent: skips the write if source is already
// "manual" (an admin made a deliberate choice). Returns { detected, saved }.
router.post("/settings/auto-detect-display", async (req: Request, res: Response) => {
  try {
    const src = await requireTenantAdmin(req, res);
    if (!src) return;
    const superadmin = isSuperAdminSource(src);
    const { tenantId: bodyTenantId } = req.body ?? {};
    // Global scope has no tenant — auto-detect is meaningless without one.
    if (superadmin && !bodyTenantId) {
      return res.status(400).json({ error: "tenantId is required when operating in global scope" });
    }
    // Superadmins may target any client; regular admins are locked to their own.
    const requestedTenant = String(bodyTenantId ?? src.tenant).trim();
    if (!superadmin && normTenant(requestedTenant) !== normTenant(src.tenant)) {
      return res.status(403).json({ error: "You can only auto-detect display mode for your own company." });
    }
    const tid = requestedTenant;
    const scope = normTenant(tid);
    setConfigurationAuditTarget(res, "settings:auto-detect-display", "Display defaults");

    const globalOverrides = await readSettingsRow(GLOBAL_SCOPE);
    const clientOverrides = await readSettingsRow(scope);
    const currentSource = clientOverrides.projectDisplayModeSource ?? "";
    if (currentSource === "manual") {
      // Admin already chose — never overwrite a deliberate choice.
      const effective = mergeDefaults(globalOverrides, clientOverrides);
      return res.json({ detected: effective.projectDisplayMode, saved: false, reason: "manual" });
    }

    const pool = await getPool();
    const r = await new sql.Request(pool)
      .input("tid", sql.NVarChar, tid)
      .query(`SELECT CASE WHEN EXISTS (
        SELECT 1 FROM core2.dbo.[PMMTasks]
        WHERE [TenantID]=@tid AND ([Deleted]=0 OR [Deleted] IS NULL)
      ) THEN 1 ELSE 0 END AS hasSchedule`);
    const hasSchedule = Number(r.recordset?.[0]?.hasSchedule) === 1;
    const detected: OnboardingDefaults["projectDisplayMode"] = hasSchedule ? "full" : "schedule-no-grid";

    const overrides: Partial<OnboardingDefaults> = {
      ...clientOverrides,
      projectDisplayMode: detected,
      projectDisplayModeSource: "auto",
    };
    // Inherit: only persist keys that differ from the effective inherited layer.
    const effectiveInherited = mergeDefaults(globalOverrides);
    const toWrite: Partial<OnboardingDefaults> = {};
    for (const k of Object.keys(overrides) as (keyof OnboardingDefaults)[]) {
      if ((overrides as any)[k] !== (effectiveInherited as any)[k]) (toWrite as any)[k] = (overrides as any)[k];
    }
    await writeSettingsRow(scope, tid, toWrite, res);
    invalidateBusinessRules();
    return res.json({ detected, saved: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/onboarding/settings ─────────────────────────────────────────
// Save default-setting overrides. Body: { tenantId?, settings }.
// Without tenantId the global layer is updated; with tenantId that client's
// per-client overrides are updated. Only known keys are stored (sanitized), and
// only keys that DIFFER from the inherited layer are persisted, so a client row
// stays a true "override" set.
router.put("/settings", async (req: Request, res: Response) => {
  try {
    const src = resolveRequestSource(req);
    if (!src) return res.status(401).json({ error: "Authentication required" });
    const superadmin = isSuperAdminSource(src);
    // Company-wide defaults are ADMIN-set: an explicit manager/user account is
    // rejected (the web hides the Settings page from them too; missing/"unset"
    // levels stay grandfathered as admin — see requireTenantAdmin).
    if (!superadmin) {
      const acl = String(src.accessLevel ?? "unset").trim().toLowerCase() || "unset";
      if (acl !== "admin" && acl !== "unset") {
        // Custom levels (#87): "manage settings" capability extends the gate.
        // Built-in Manager/User customized with "Company settings" (Access
        // Levels page builtinOverrides) pass the same way. Fails closed.
        let allowed = false;
        if (isCustomAcl(acl)) {
          try { allowed = (await getCapsForAcl(acl, src.tenant))?.manageSettings === true; }
          catch { allowed = false; /* fails closed */ }
        } else {
          try { allowed = (await getBuiltinOverrideCaps(acl, src.tenant))?.manageSettings === true; }
          catch { allowed = false; /* fails closed */ }
        }
        if (!allowed)
          return res.status(403).json({ error: "Only a company admin can change company-wide settings" });
      }
    }

    const { tenantId, settings } = req.body ?? {};
    // The client sends the full effective settings document so unrelated edits
    // are not lost. Keep that payload from looking like an intentional project
    // save: the project-only live reconciles below can scan many core2 rows and
    // must not run when the admin only saved staff or forecast settings.
    const settingsSection = String(req.body?.settingsSection ?? "").trim();
    const allowProjectReconciles =
      !settingsSection || settingsSection === "projects";
    setConfigurationAuditTarget(res, "settings:defaults", "Onboarding defaults");
    const incoming = sanitizeDefaults(settings);
    // The display-mode *Source markers are SERVER-managed ("auto" = written by
    // the import pipeline, "manual" = admin saved the field). Never accept them
    // from the client body — they are derived below from WHICH fields the save
    // carried.
    delete incoming.projectDisplayModeSource;
    delete incoming.oppDisplayModeSource;

    if (!tenantId) {
      // The global layer is the starting point for every client — only a
      // cross-company superadmin may change it.
      if (!superadmin)
        return res.status(403).json({ error: "Only a superadmin can change global defaults." });
      await writeSettingsRow(GLOBAL_SCOPE, null, incoming, res);
      invalidateBusinessRules(); // live analytics read the global layer
      const globalEffective = mergeDefaults(incoming);
      return res.json({ ok: true, scope: GLOBAL_SCOPE, global: incoming, effective: globalEffective });
    }

    const label = String(tenantId).trim();
    const scope = normTenant(label);
    // A client may only edit their own company's defaults; superadmins may edit any.
    if (!superadmin && scope !== normTenant(src.tenant))
      return res.status(403).json({ error: "You can only change your own company's defaults." });
    const globalOverrides = await readSettingsRow(GLOBAL_SCOPE);
    const inheritedEffective = mergeDefaults(globalOverrides);
    // Snapshot what was in effect BEFORE this save so the live-reconcile steps
    // below can be skipped when their inputs didn't actually change — they each
    // cost slow core2 round-trips and used to run on EVERY save.
    const prevClientOverrides = await readSettingsRow(scope);
    const prevEffective = mergeDefaults(globalOverrides, prevClientOverrides);

    // Keep only the keys that actually differ from what this client would inherit,
    // so unchanged values keep tracking the global/built-in layer.
    const overrides: Partial<OnboardingDefaults> = {};
    for (const k of Object.keys(incoming) as (keyof OnboardingDefaults)[]) {
      if (incoming[k] !== inheritedEffective[k]) (overrides as any)[k] = incoming[k];
    }

    // Display-mode auto/manual markers: writeSettingsRow REPLACES the stored
    // row, so carry the previous marker forward on every save, and flip it to
    // "manual" only on real admin intent. The web client sends the FULL
    // effective baseline on every card save, so "the body carried the field"
    // is NOT intent — instead flip when (a) the client says the admin actually
    // touched the dropdown this session (touchedDisplayKeys), or (b) the saved
    // value genuinely differs from what was in effect before (covers direct
    // API clients). An empty settings body (the "Reset to inherited" button)
    // clears the markers too, so a reset re-enables import auto-select.
    {
      const bodySettings = (settings ?? {}) as Record<string, unknown>;
      const touchedRaw = (req.body ?? {}).touchedDisplayKeys;
      const touched = new Set(Array.isArray(touchedRaw) ? touchedRaw.map(String) : []);
      const isReset = Object.keys(bodySettings).length === 0;
      const mark = (
        field: "projectDisplayMode" | "oppDisplayMode",
        key: "projectDisplayModeSource" | "oppDisplayModeSource",
      ) => {
        if (isReset) return; // reset wipes overrides AND markers
        const bodyHas = Object.prototype.hasOwnProperty.call(bodySettings, field);
        const valueChanged =
          bodyHas && incoming[field] !== undefined && incoming[field] !== prevEffective[field];
        const next =
          (bodyHas && touched.has(field)) || valueChanged ? "manual" : prevClientOverrides[key];
        if (next === "auto" || next === "manual") overrides[key] = next;
      };
      mark("projectDisplayMode", "projectDisplayModeSource");
      mark("oppDisplayMode", "oppDisplayModeSource");
    }

    await writeSettingsRow(scope, label, overrides, res);
    // Live analytics (getBusinessRulesForTenant) cache the effective rules per
    // scope for 30s — without this the tenant's own workWeekHours/thresholds
    // edits wouldn't take effect on the live app until that TTL expired.
    invalidateBusinessRules();
    const clientEffective = mergeDefaults(globalOverrides, overrides);

    // Make the saved "Opportunity stage set" authoritative on this tenant's LIVE
    // core2 stage list so the OPM stage dropdown reflects it (add new stages,
    // retire removed ones). Per the tenant's explicit choice, retiring a stage
    // ALSO clears it from existing opportunity records (their Stage is blanked)
    // so a removed stage disappears everywhere. This runs for the CLIENT-scoped
    // save only; a global save has no single tenant to reconcile and a
    // cross-company cascade would be destructive, so it is intentionally skipped
    // there. Reconcile failures never fail the (already-saved) settings.
    // Normalized list compare — the reconciles below are skipped when their
    // driving setting is unchanged, so saving an unrelated card is fast.
    const normList = (v: unknown) =>
      String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean).join("|");

    let stageSync: { added: number; removed: number; kept: number; recordsCleared: number } | null = null;
    let stageSyncError: string | null = null;
    let oppScheduleSync: { updated: number; templateIds: number[]; phases: string[]; failed: number } | null = null;
    let oppScheduleSyncError: string | null = null;
    if (normList(clientEffective.defaultOpportunityStages) !== normList(prevEffective.defaultOpportunityStages)) {
      try {
        const tid = resolveTenantId(label);
        const desiredStages = String(clientEffective.defaultOpportunityStages ?? "")
          .split(",").map((s) => s.trim()).filter(Boolean);
        stageSync = await reconcileOppStagesRds(tid, desiredStages);
        // The tenant-wide OPM stage ORDER may have changed (StageStep rewrite):
        // refresh the stage-rules/stage-order caches on every worker so lock
        // evaluation and the /stage-rules payload see the new order promptly.
        bustStageRulesCache(label);
        bustStageOrderCache(tid);
        bustFieldOptionsCache(tid);
        if (process.send) {
          try { process.send({ type: "bustCache", fn: "stageRules", tenant: label, tid }); } catch { /* shutting down */ }
        }
      } catch (e: any) {
        stageSyncError = e?.message ?? String(e);
        console.error(`[onboarding] OPM stage reconcile failed for "${label}":`, stageSyncError);
      }
      // The Stage dropdown is fixed above — but the SCHEDULE tab of an existing
      // opportunity walks its assigned lifecycle template, which nothing updated
      // until now. Projects get this via reconcileDefaultLifecyclePhasesRds
      // rewriting the PMM "Standard" template; the OPM analog is signature-
      // matched, because opportunity templates are minted per stage list.
      try {
        const tid = resolveTenantId(label);
        const toList = (v: unknown) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const newList = toList(clientEffective.defaultOpportunityStages);
        const prevList = toList(prevEffective.defaultOpportunityStages);
        // Outcome stages (Lost / Won / …) are results, not schedulable phases —
        // seeding excludes them, so template signatures exclude them too; the
        // raw variant covers templates seeded before the outcome filter existed.
        oppScheduleSync = await reconcileDefaultLifecyclesBySigRds(
          tid,
          [prevList.filter((s) => !isOutcomeStageName(s)), prevList],
          newList.filter((s) => !isOutcomeStageName(s)),
          "OPM",
        );
        if (oppScheduleSync.updated > 0) {
          // Schedule tabs cache task-data per record and templates per tenant —
          // bust both (IPC-broadcast) so existing opportunities show the new
          // default immediately, not after a TTL.
          bustTaskDataCache(tid);
          bustLifecyclesCache(tid);
        }
        // Per-template failures don't abort the loop (committed templates are
        // still reported + busted above) — but they must not stay silent.
        if ((oppScheduleSync.failed ?? 0) > 0) {
          oppScheduleSyncError = `${oppScheduleSync.failed} opportunity schedule template(s) failed to update`;
        }
      } catch (e: any) {
        oppScheduleSyncError = e?.message ?? String(e);
        console.error(`[onboarding] OPM default schedule reconcile failed for "${label}":`, oppScheduleSyncError);
      }
    }

    // Opportunities that predate ANY schedule default have no lifecycle at all —
    // the signature-matched reconcile above can't reach them (nothing to match),
    // so their Schedule tab stays "No lifecycle assigned". Seed those with the
    // CURRENT default whenever the schedule card is saved — deliberately NOT
    // gated on "the list changed", so an admin can re-save the same default to
    // heal records imported before it existed. Runs AFTER the reconcile so the
    // find-or-create matches the freshly rewritten template instead of minting
    // a duplicate. Failures never fail the (already-saved) settings.
    let oppScheduleAdopt: { adopted: number; failed: number } | null = null;
    let oppScheduleAdoptError: string | null = null;
    const bodyCarriedOppStages = Object.prototype.hasOwnProperty.call(
      (settings ?? {}) as Record<string, unknown>,
      "defaultOpportunityStages",
    );
    // Also trigger when oppStageSets is saved — "Make default" swaps which set
    // is "everyone" without necessarily changing the phase names, so the stages
    // diff alone won't catch it. Audience-only saves (adding groups/people to a
    // set) also re-run adoption so newly-covered opps get the lifecycle.
    const bodyCarriedOppStageSets = Object.prototype.hasOwnProperty.call(
      (settings ?? {}) as Record<string, unknown>,
      "oppStageSets",
    );
    // AUTO-SAVES are the exception: the stage editor now persists on its own
    // while the admin is still typing, so "the body carried the field" fires on
    // every keystroke burst. For those, require a real VALUE change (the stage
    // list, or the named sets — which is how "make default" and audience-only
    // edits show up). A deliberate button press keeps the heal-by-resave path.
    const isAutoSave = (req.body ?? {}).auto === true;
    const oppStageValuesChanged =
      normList(clientEffective.defaultOpportunityStages) !== normList(prevEffective.defaultOpportunityStages) ||
      String(clientEffective.oppStageSets ?? "") !== String(prevEffective.oppStageSets ?? "");
    if (allowProjectReconciles && (isAutoSave
      ? oppStageValuesChanged
      : (bodyCarriedOppStages || bodyCarriedOppStageSets || oppStageValuesChanged))) {
      try {
        const tid = resolveTenantId(label);
        // Outcome stages (Lost / Won / …) are results, not schedulable phases —
        // same filter as /new-record seeding and the reconcile above.
        const newList = String(clientEffective.defaultOpportunityStages ?? "")
          .split(",").map((s) => s.trim()).filter(Boolean)
          .filter((s) => !isOutcomeStageName(s));
        if (newList.length > 0) {
          // Step A: bare opps (null pointer + no task rows) — conservative seed.
          const r = await adoptDefaultLifecycleForBareOppsRds(tid, newList);
          // Step B: opps with null pointer but pre-existing task rows (e.g. a
          // legacy "Proposal" row imported before a default was set). These are
          // also missing a lifecycle pointer, so re-seeding them with the current
          // default matches what the user expects after changing the default.
          const r2 = await resetDefaultLifecycleForNullPointerOppsRds(tid, newList);
          const totalAdopted = r.adopted + r2.reset;
          const totalFailed = r.failed + r2.failed;
          oppScheduleAdopt = { adopted: totalAdopted, failed: totalFailed };
          // findOrCreate may have INSERTED a template; adopted records got new
          // task rows — refresh both caches on every worker (IPC-broadcast).
          if (r.lifecycleId != null || r2.lifecycleId != null) bustLifecyclesCache(tid);
          if (totalAdopted > 0) bustTaskDataCache(tid);
          if (totalFailed > 0) {
            oppScheduleAdoptError = `${totalFailed} opportunit${totalFailed === 1 ? "y" : "ies"} couldn't be given the default schedule`;
          }
        }
      } catch (e: any) {
        oppScheduleAdoptError = e?.message ?? String(e);
        console.error(`[onboarding] OPM default schedule adoption failed for "${label}":`, oppScheduleAdoptError);
      }
    }

    // Same treatment for "Default lifecycle phases": editing it must update the
    // tenant's live "Standard" lifecycle template so the project-detail picker
    // reflects the new phase list (renames, adds, removals). CLIENT-scoped only.
    let phaseSync: { updated: boolean; templateId: number | null; phases: string[] } | null = null;
    let phaseSyncError: string | null = null;
    if (allowProjectReconciles &&
        normList(clientEffective.defaultPhases) !== normList(prevEffective.defaultPhases)) {
      try {
        const tid = resolveTenantId(label);
        const desiredPhases = String(clientEffective.defaultPhases ?? "")
          .split(",").map((s) => s.trim()).filter(Boolean);
        // Previous list lets the reconcile reach IMPORTED tenants too: they
        // have no "Standard" template — their projects point at auto-minted
        // "Imported: …" templates that are found by the OLD phases' signature.
        const prevDefaultPhases = String(prevEffective.defaultPhases ?? "")
          .split(",").map((s) => s.trim()).filter(Boolean);
        phaseSync = await reconcileDefaultLifecyclePhasesRds(tid, desiredPhases, prevDefaultPhases);
        if (phaseSync.updated) {
          // Template was rewritten and PMMTasks titles were propagated — bust
          // the lifecycle picker list AND the per-project task-data cache so
          // project schedule cards immediately show the renamed phases without
          // waiting for the 6 h TTL to expire.
          bustLifecyclesCache(tid);
          bustTaskDataCache(tid);
        }
      } catch (e: any) {
        phaseSyncError = e?.message ?? String(e);
        console.error(`[onboarding] lifecycle phase reconcile failed for "${label}":`, phaseSyncError);
      }
    }

    // Named schedule sets (Settings → Schedules, BOTH modules) sync into the
    // record page's "Manage Lifecycles" templates: the sets live as JSON in
    // OnboardingSettings while that picker lists core2 lifecycle templates,
    // so without this bridge a schedule saved in Settings never showed up
    // there. Runs AFTER the default reconciles above so signature matching
    // sees the freshly rewritten templates instead of minting duplicates.
    // Same auto-save convention as the adoption block: keystroke auto-saves
    // sync only on a real value change; a deliberate Save also heals by
    // re-save. Failures never fail the (already-saved) settings.
    let setLifecycleSync: { created: number; updated: number; renamed: number; failed: number } | null = null;
    let setLifecycleSyncError: string | null = null;
    const bodyCarriedProjPhaseSets = Object.prototype.hasOwnProperty.call(
      (settings ?? {}) as Record<string, unknown>,
      "projectPhaseSets",
    );
    const projPhaseSetsChanged =
      String(clientEffective.projectPhaseSets ?? "") !== String(prevEffective.projectPhaseSets ?? "");
    const oppStageSetsChangedForSync =
      String(clientEffective.oppStageSets ?? "") !== String(prevEffective.oppStageSets ?? "");
    if (allowProjectReconciles && (isAutoSave
      ? (projPhaseSetsChanged || oppStageSetsChangedForSync)
      : (bodyCarriedProjPhaseSets || bodyCarriedOppStageSets || projPhaseSetsChanged || oppStageSetsChangedForSync))) {
      try {
        const tid = resolveTenantId(label);
        const toSets = (raw: unknown) => parseProjectPhaseSets(String(raw ?? ""))
          .map((s) => ({ name: s.name, phases: s.phases }));
        const splitList = (raw: unknown) =>
          String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);

        // Named exception sets from the JSON blob. If the admin gave the
        // default list a custom name (stored in the hidden __default_scope__
        // entry's "name" field), also sync it as a named lifecycle template so
        // it appears in the record-page picker under that name. Without this,
        // naming the default card "test3" in Settings never created a "test3"
        // template — the picker kept showing only "Standard". Injected only if
        // not already covered by a named set with the same name.
        const buildProjSets = (eff: typeof clientEffective) => {
          const base = toSets(eff.projectPhaseSets);
          const scopeEntry = parseProjectPhaseSets(String(eff.projectPhaseSets ?? ""))
            .find((s) => (s as any).id === "__default_scope__");
          const customName = (
            scopeEntry?.name && scopeEntry.name !== "__default__" && scopeEntry.name.trim()
          ) || null;
          const defPhases = splitList(eff.defaultPhases);
          return [
            ...base,
            ...(customName && defPhases.length > 0
              && !base.some((s) => s.name.toLowerCase() === customName.toLowerCase())
              ? [{ name: customName, phases: defPhases }]
              : []),
          ];
        };

        // Outcome stages (Lost / Won / …) are results, not schedulable phases —
        // same filter every OPM seeding/reconcile path applies, so the synced
        // template matches what /new-record would mint for those stages.
        const buildOppSets = (eff: typeof clientEffective) => {
          const base = toSets(eff.oppStageSets)
            .map((s) => ({ name: s.name, phases: s.phases.filter((p) => !isOutcomeStageName(p)) }));
          const scopeEntry = parseProjectPhaseSets(String(eff.oppStageSets ?? ""))
            .find((s) => (s as any).id === "__default_scope__");
          const customName = (
            scopeEntry?.name && scopeEntry.name !== "__default__" && scopeEntry.name.trim()
          ) || null;
          const defPhases = splitList(eff.defaultOpportunityStages)
            .filter((p) => !isOutcomeStageName(p));
          return [
            ...base,
            ...(customName && defPhases.length > 0
              && !base.some((s) => s.name.toLowerCase() === customName.toLowerCase())
              ? [{ name: customName, phases: defPhases }]
              : []),
          ];
        };
        // Previous sets let the sync find a template by the OLD phases'
        // signature when a set's phases were renamed before its template was
        // ever adopted (still auto-minted "Imported: …") — rewrite-and-adopt
        // instead of minting a duplicate that strands records on stale titles.
        const projSets = buildProjSets(clientEffective);
        const oppSets = buildOppSets(clientEffective);
        const rProj = await syncPhaseSetLifecyclesRds(tid, projSets, "PMM", buildProjSets(prevEffective));
        const rOpp = await syncPhaseSetLifecyclesRds(tid, oppSets, "OPM", buildOppSets(prevEffective));
        setLifecycleSync = {
          created: rProj.created + rOpp.created,
          updated: rProj.updated + rOpp.updated,
          renamed: rProj.renamed + rOpp.renamed,
          failed: rProj.failed + rOpp.failed,
        };
        // New/renamed templates change the picker list; in-place stage rewrites
        // also change what assigned records' Schedule tabs render — bust the
        // matching caches (IPC-broadcast) so every worker serves fresh lists.
        if (setLifecycleSync.created + setLifecycleSync.renamed + setLifecycleSync.updated > 0)
          bustLifecyclesCache(tid);
        if (setLifecycleSync.updated > 0) bustTaskDataCache(tid);
        if (setLifecycleSync.failed > 0)
          setLifecycleSyncError = `${setLifecycleSync.failed} schedule template(s) failed to sync`;
      } catch (e: any) {
        setLifecycleSyncError = e?.message ?? String(e);
        console.error(`[onboarding] schedule-set template sync failed for "${label}":`, setLifecycleSyncError);
      }
    }

    // Same treatment for the schedule-date settings ("When a start date is
    // missing" / "Assumed project length" / "Default forecast window"): they used
    // to fill blanks only at import time. Re-derive the ASSUMED start/finish dates
    // on existing records (never client-provided ones) so a settings change shows
    // up on live projects. CLIENT-scoped only.
    let dateSync: { scanned: number; recordsUpdated: number } | null = null;
    let dateSyncError: string | null = null;
    // Only re-derive when a date-driving setting actually changed (these are
    // the inputs of deriveScheduleDates) — this reconcile scans records in
    // core2 and is the slowest part of a save.
    const dateSettingsChanged =
      clientEffective.startRule !== prevEffective.startRule ||
      clientEffective.durationMonths !== prevEffective.durationMonths ||
      clientEffective.oppDurationMonths !== prevEffective.oppDurationMonths ||
      clientEffective.durationMonthsBack !== prevEffective.durationMonthsBack ||
      clientEffective.forecastHorizonDays !== prevEffective.forecastHorizonDays;
    if (allowProjectReconciles && dateSettingsChanged) {
    try {
      const tid = resolveTenantId(label);
      const _allAssumed = await getOnboardingAssumedFields(scope);
      const assumedRows = _allAssumed.filter(r =>
        ["project", "opportunity", "lead"].includes(r.entityType) &&
        ["Start Date", "Completion Date"].includes(r.fieldName),
      );
      // Group the per-field assumed rows into one item per record.
      const itemMap = new Map<string, AssumedDateItem>();
      for (const r of assumedRows) {
        const key = `${r.entityType}::${r.naturalKey}`;
        let it = itemMap.get(key);
        if (!it) {
          it = { entityType: r.entityType as AssumedDateItem["entityType"], naturalKey: r.naturalKey, recordLabel: r.recordLabel, startAssumed: false, endAssumed: false };
          itemMap.set(key, it);
        }
        if (r.fieldName === "Start Date") it.startAssumed = true;
        else if (r.fieldName === "Completion Date") it.endAssumed = true;
      }
      const result = await reconcileAssumedScheduleDatesRds(tid, [...itemMap.values()], clientEffective);
      dateSync = { scanned: result.scanned, recordsUpdated: result.updated.length };

      // Keep the assumed-data audit trail in step with the live records: update
      // each changed field's current value and append an audit-history entry, so
      // the assumptions review still shows these dates as system-defaulted.
      if (result.updated.length) {
        const actor = `settings-reconcile:${src.tenant || "admin"}`;
        // Build upsert rows for the updated assumed values
        const updatedAssumedRows: Parameters<typeof upsertOnboardingAssumedFieldsBatch>[0] = [];
        const updatedHistoryRows: Parameters<typeof insertOnboardingAssumedHistoryBatch>[0] = [];
        for (const u of result.updated) {
          const changes: { field: string; oldVal: string | null; newVal: string }[] = [];
          if (u.newStart) changes.push({ field: "Start Date", oldVal: u.oldStart, newVal: u.newStart });
          if (u.newEnd) changes.push({ field: "Completion Date", oldVal: u.oldEnd, newVal: u.newEnd });
          for (const c of changes) {
            updatedAssumedRows.push({
              tenantKey: scope, tenantLabel: label, entityType: u.entityType,
              naturalKey: u.naturalKey, recordLabel: u.recordLabel,
              fieldName: c.field, value: c.newVal, confidence: "system_defaulted",
              sheetName: "Settings reconcile",
            });
            updatedHistoryRows.push({
              tenantKey: scope, tenantLabel: label, entityType: u.entityType,
              naturalKey: u.naturalKey, recordLabel: u.recordLabel,
              fieldName: c.field, action: "updated",
              oldValue: c.oldVal, newValue: c.newVal,
              oldConfidence: "system_defaulted", newConfidence: "system_defaulted",
              sheetName: "Settings reconcile", actor,
            });
          }
        }
        if (updatedAssumedRows.length) await upsertOnboardingAssumedFieldsBatch(updatedAssumedRows);
        if (updatedHistoryRows.length) await insertOnboardingAssumedHistoryBatch(updatedHistoryRows);
        // The project pages read records through per-token caches; bust the
        // requester's caches so the re-derived dates show without waiting for TTL.
        // Pass the tenant GUID too: RDS tenants read from tid-keyed caches that
        // the auth-keyed busts never touch.
        bustAllProjectCaches(req.headers.authorization ?? "", resolveTenantId(label));
      }
    } catch (e: any) {
      dateSyncError = e?.message ?? String(e);
      console.error(`[onboarding] schedule-date reconcile failed for "${label}":`, dateSyncError);
    }
    }

    res.json({ ok: true, scope, tenantLabel: label, client: overrides, effective: clientEffective, stageSync, stageSyncError, oppScheduleSync, oppScheduleSyncError, oppScheduleAdopt, oppScheduleAdoptError, phaseSync, phaseSyncError, setLifecycleSync, setLifecycleSyncError, dateSync, dateSyncError });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── POST /api/onboarding/apply-defaults ──────────────────────────────────
// Backfill the configured defaults onto EXISTING records for one company.
// Strictly fills BLANKS — a record that already has a real value is never
// overwritten. Currently the only person field with a writable core2 column is
// Job Title (Role is stored in that same field, so it is covered by the same
// backfill). Every change is written to the assumed-data audit trail (current
// value + append-only history) so the fill stays visible as a system-defaulted
// value, not client-provided.
router.post("/apply-defaults", async (req: Request, res: Response) => {
  try {
    const src = resolveRequestSource(req);
    if (!src) return res.status(401).json({ error: "Authentication required" });
    const tenantId = String(req.body?.tenantId ?? "").trim();
    if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
    if (normTenant(tenantId) !== normTenant(src.tenant) && !isSuperAdminSource(src))
      return res.status(403).json({ error: "You can only apply defaults to your own company." });
    setConfigurationAuditTarget(res, "settings:apply-defaults", "Apply defaults");

    const settings  = await loadEffectiveDefaults(tenantId);
    const tenantKey = normTenant(tenantId);
    // RDS writes are scoped by the resolved tenant GUID; the label is only used
    // for settings lookup and the (label-keyed) assumed-data audit trail.
    const tid       = resolveTenantId(tenantId);
    const actor     = `apply-defaults:${src.tenant || "admin"}`;
    const fields: { field: string; applied: number; status: string; note: string }[] = [];

    // ── Job Title (the one person field with a real writable column) ─────────
    const jt = await applyDefaultJobTitleToExistingRds(tid, settings.defaultJobTitle);
    let auditFailed = false;
    if (jt.updated.length > 0) {
      const now = new Date();
      const assumedRows = jt.updated.map(p => ({
        tenantKey, tenantLabel: tenantId, entityType: "person",
        naturalKey: (p.userName || p.name).toLowerCase(), recordLabel: p.name,
        fieldName: "Job Title", value: jt.jobTitleName, confidence: "system_defaulted",
        sheetName: "Apply to existing data",
      }));
      const historyRows = jt.updated.map(p => ({
        tenantKey, tenantLabel: tenantId, entityType: "person",
        naturalKey: (p.userName || p.name).toLowerCase(), recordLabel: p.name,
        fieldName: "Job Title", action: "created",
        oldValue: null, newValue: jt.jobTitleName,
        oldConfidence: null, newConfidence: "system_defaulted",
        sheetName: "Apply to existing data", actor,
      }));
      // The RDS write already happened, so the audit MUST reflect it. SQL Server
      // and Postgres can't share one transaction, so on audit failure we don't
      // pretend nothing changed — we flag it loudly and report a partial result.
      try {
        await upsertOnboardingAssumedFieldsBatch(assumedRows);
        if (historyRows.length) await insertOnboardingAssumedHistoryBatch(historyRows);
      } catch (auditErr: any) {
        auditFailed = true;
        console.error(
          `[apply-defaults] AUDIT WRITE FAILED for tenant "${tenantId}" after updating ` +
          `${jt.updated.length} Job Title row(s) in RDS — data changed but audit trail is incomplete:`,
          auditErr?.message ?? auditErr,
        );
      }
    }
    fields.push({
      field: "Job Title", applied: jt.updated.length,
      status: auditFailed ? "applied_audit_failed" : "applied",
      note: jt.updated.length
        ? (auditFailed
            ? `Set "${jt.jobTitleName}" on ${jt.updated.length} ${jt.updated.length === 1 ? "person" : "people"}, but the assumptions-review log could not be written — please re-run to reconcile.`
            : `Set "${jt.jobTitleName}" on ${jt.updated.length} ${jt.updated.length === 1 ? "person" : "people"} who had no job title.`)
        : "No people were missing a job title — nothing to fill.",
    });

    // ── Role mirrors Job Title — same stored column, so already covered above ─
    fields.push({
      field: "Role", applied: 0,
      status: settings.roleMirrorsTitle ? "covered" : "skipped",
      note: settings.roleMirrorsTitle
        ? "Role is stored in the same field as Job Title, so it is covered by the Job Title backfill above."
        : "“Role mirrors job title” is turned off, so role was left untouched.",
    });

    // The Resources/Forecast pages read job title through the per-token
    // resource-allocations cache (5-min TTL). Without busting it, a successful
    // backfill looks like it did nothing until the cache expires. Clear the
    // requester's caches so their next read is live — including the tid-keyed
    // RDS caches, which is where RDS tenants' Resources pages actually read.
    if (jt.updated.length > 0) {
      bustAllProjectCaches(req.headers.authorization ?? "", tid);
    }

    const totalApplied = fields.reduce((n, f) => n + f.applied, 0);
    setTrustedAuditChanges(res, boundedAuditChanges(jt.updated.map(p => ({
      FieldName: `Job Title · ${p.name}`,
      OldValue: null,
      NewValue: jt.jobTitleName,
    })), jt.updated.length));
    res.json({ ok: true, tenantLabel: tenantId, totalApplied, fields });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
  return;
});

// ════════════════════════════════════════════════════════════════════════
// Secure invite-link ("set your own password") flow
// Replaces the insecure default-password (Welcome@123) onboarding. The admin
// reviews the team list and clicks "Send invites"; each member gets a one-time
// expiring link to set their OWN password. Sending also scrambles the account's
// stored password so the old shared default can no longer be used. Invite emails
// are tagged no-reply (see agentmail) so replies never reach the shared inbox.
// ════════════════════════════════════════════════════════════════════════

// ── GET /api/onboarding/invites?tenantId= ────────────────────────────────
// Team members for a client + their current invite status, for the review list.
router.get("/invites", async (req: Request, res: Response) => {
  const rawTid = String(req.query.tenantId ?? "").trim();
  if (!rawTid) return res.status(400).json({ error: "tenantId is required" });
  if (!requireTenantAccess(req, res, rawTid)) return;
  const tid = resolveTenantId(rawTid);
  const tenantKey = normTenant(rawTid);
  try {
    // Read users (replaces AspNetUsers query). Invite rows are independent
    // of the user list — fetch them in parallel instead of tail-to-tail.
    const [pgMembers, invites] = await Promise.all([
      getActiveUsersByTenant(tid),
      getInvitesByTenantKey(tenantKey),
    ]);

    // Best-effort org name lookups from SQL Server for display.
    const pool = await getPool();
    const jtIds = [...new Set(pgMembers.map(u => u.jobTitleId).filter(Boolean) as string[])];
    const divIds = [...new Set(pgMembers.map(u => u.divisionId).filter(Boolean) as string[])];
    const deptIds = [...new Set(pgMembers.map(u => u.departmentId).filter(Boolean) as string[])];
    const jtMap = new Map<string, string>();
    const divMap = new Map<string, string>();
    const deptMap = new Map<string, string>();
    // The three lookups are independent — run them in parallel (each stays
    // individually best-effort so one failing table never blanks the list).
    await Promise.all([
      (async () => {
        if (!jtIds.length) return;
        try {
          const jtList = jtIds.map((_, i) => `@j${i}`).join(",");
          const jtReq = pool.request().input("tid", sql.NVarChar, tid);
          jtIds.forEach((v, i) => jtReq.input(`j${i}`, v));
          const jtR = await jtReq.query(`SELECT ID, Title FROM core2.dbo.Jobtitle WHERE TenantID=@tid AND ID IN (${jtList})`);
          jtR.recordset.forEach((r: any) => jtMap.set(String(r.ID), String(r.Title ?? "")));
        } catch { /* best-effort */ }
      })(),
      (async () => {
        if (!divIds.length) return;
        try {
          const divList = divIds.map((_, i) => `@dv${i}`).join(",");
          const dvReq = pool.request().input("tid", sql.NVarChar, tid);
          divIds.forEach((v, i) => dvReq.input(`dv${i}`, v));
          const dvR = await dvReq.query(`SELECT ID, COALESCE(ShortName, Title) AS Title FROM core2.dbo.CompanyDivisions WHERE TenantID=@tid AND ID IN (${divList})`);
          dvR.recordset.forEach((r: any) => divMap.set(String(r.ID), String(r.Title ?? "")));
        } catch { /* best-effort */ }
      })(),
      (async () => {
        if (!deptIds.length) return;
        try {
          const deptList = deptIds.map((_, i) => `@dp${i}`).join(",");
          const dpReq = pool.request().input("tid", sql.NVarChar, tid);
          deptIds.forEach((v, i) => dpReq.input(`dp${i}`, v));
          const dpR = await dpReq.query(`SELECT ID, Title FROM core2.dbo.Department WHERE TenantID=@tid AND ID IN (${deptList})`);
          dpR.recordset.forEach((r: any) => deptMap.set(String(r.ID), String(r.Title ?? "")));
        } catch { /* best-effort */ }
      })(),
    ]);

    const byGuid = new Map(invites.map(i => [i.userGuid?.toLowerCase(), i]));
    const now = Date.now();

    const EXAMPLE_RE = /EXAMPLE DATA/i;
    const members = pgMembers
      .filter(u => !EXAMPLE_RE.test(u.name) && !EXAMPLE_RE.test(u.username))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(u => {
        const inv = byGuid.get(u.id.toLowerCase());
        let inviteStatus: "none" | "sent" | "accepted" | "expired" = "none";
        if (inv) {
          if (inv.status === "accepted") inviteStatus = "accepted";
          else if (new Date(inv.expiresAt).getTime() < now) inviteStatus = "expired";
          else inviteStatus = "sent";
        }
        const email = (u.email || u.username || "").trim();
        const jobTitle = (u.jobTitleId ? jtMap.get(u.jobTitleId) : null) || u.title || "";
        const divisionName = u.divisionId ? divMap.get(u.divisionId) || null : null;
        const departmentName = u.departmentId ? deptMap.get(u.departmentId) || null : null;
        return {
          userGuid: u.id,
          name: u.name,
          email,
          username: u.username,
          jobTitle,
          divisionName,
          departmentName,
          hasEmail: email.includes("@"),
          inviteStatus,
          accessLevel: u.accessLevel || null,
          enabled: u.enabled !== false,
          sentAt: inv?.sentAt ?? null,
          acceptedAt: inv?.acceptedAt ?? null,
        };
      });
    res.json({ tenantId: tid, tenantLabel: rawTid, members });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── POST /api/onboarding/invites/link  { tenantId, userGuid } ────────────
// Generate a set-password invite link for ONE member and return it directly
// (no email sent). Lets admins share the link manually when email is not
// configured or the member's inbox isn't accessible.
router.post("/invites/link", async (req: Request, res: Response) => {
  const rawTid   = String(req.body?.tenantId  ?? "").trim();
  const userGuid = String(req.body?.userGuid  ?? "").trim();
  if (!rawTid)   return res.status(400).json({ error: "tenantId is required" });
  if (!userGuid) return res.status(400).json({ error: "userGuid is required" });
  if (!requireTenantAccess(req, res, rawTid)) return;

  const base = invitePublicBaseUrl();
  if (!base) return res.status(500).json({ error: "Public app URL is not configured (set APP_PUBLIC_URL)." });

  const tid        = resolveTenantId(rawTid);
  const tenantKey  = normTenant(rawTid);
  const tenantLabel = rawTid;

  try {
    const pool = await getPool();
    // Lookup user (replaces AspNetUsers query).
    const pgRow = await getUserByTenantAndId(tid, userGuid.toLowerCase());
    if (!pgRow || pgRow.deleted) return res.status(404).json({ error: "Member not found" });

    const u = pgRow;
    const email = (u.email || u.username || "").trim();
    if (!email.includes("@")) return res.status(400).json({ error: "No valid email address on file for this member." });

    const rawToken  = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600_000);
    const scrambled = hashPassword(crypto.randomBytes(24).toString("hex"));

    // Scramble password (replaces UPDATE AspNetUsers SET PasswordHash).
    await updateAppUser(tid, u.id, { passwordHash: scrambled });

    await upsertInviteToken({ tenantKey, tenantLabel, userGuid: u.id, email, name: u.name, tokenHash, expiresAt });
    setAuditTarget(res, { entityType: "staff", entityId: u.id, entityName: u.name || email });
    setTrustedAuditChanges(res, trustedAuditDiff(
      null,
      { Email: email, Role: u.accessLevel ?? null, Enabled: u.enabled !== false },
      { fields: ["Email", "Role", "Enabled"] },
    ));

    const link = `${base}/set-password?token=${rawToken}`;
    res.json({ ok: true, link, expiresAt });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── POST /api/onboarding/invites/send  { tenantId, userGuids? } ──────────
// Generate one-time tokens, scramble each account's password, email each member
// a secure "set your own password" link (sender = company name, no-reply).
router.post("/invites/send", async (req: Request, res: Response) => {
  const rawTid = String(req.body?.tenantId ?? "").trim();
  const userGuids: string[] | undefined =
    Array.isArray(req.body?.userGuids) ? req.body.userGuids.map(String) : undefined;
  if (!rawTid) return res.status(400).json({ error: "tenantId is required" });
  if (!requireTenantAccess(req, res, rawTid)) return;

  const base = invitePublicBaseUrl();
  if (!base) {
    return res.status(500).json({
      error: "Public app URL is not configured. Set APP_PUBLIC_URL and retry.",
    });
  }
  const tid = resolveTenantId(rawTid);
  const tenantKey = normTenant(rawTid);
  const tenantLabel = rawTid;

  try {
    const pool = await getPool();
    // Fetch users (replaces AspNetUsers SELECT).
    let targets = await getActiveUsersByTenant(tid);
    if (userGuids && userGuids.length) {
      const want = new Set(userGuids.map(g => g.toLowerCase()));
      targets = targets.filter(u => want.has(u.id.toLowerCase()));
    }
    if (targets.length > 0) {
      const first = targets[0];
      setAuditTarget(res, {
        entityType: "staff",
        entityId: first.id,
        entityName: targets.length === 1 ? (first.name || first.email || first.username) : `${targets.length} staff invites`,
      });
    }

    const sent: string[] = [];
    const failed: { name: string; reason: string }[] = [];
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600_000);

    for (const u of targets) {
      const email = (u.email || u.username || "").trim();
      if (!email.includes("@")) {
        failed.push({ name: u.name, reason: "No valid email address on file" });
        continue;
      }
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = sha256(rawToken);
      // Scramble the stored password so the old shared default stops working
      // the moment an invite goes out; the person regains access only via their link.
      const scrambled = hashPassword(crypto.randomBytes(24).toString("hex"));
      try {
        await updateAppUser(tid, u.id, { passwordHash: scrambled });

        await upsertInviteToken({ tenantKey, tenantLabel, userGuid: u.id, email, name: u.name, tokenHash, expiresAt });

        const link = `${base}/set-password?token=${rawToken}`;
        const firstName = (u.name || "").split(/\s+/)[0] || "there";
        const body = [
          `Hi ${firstName},`,
          ``,
          `An account has been created for you on ${tenantLabel}'s RM ONE workspace.`,
          `To finish setting up, please choose your own password using the secure link below:`,
          ``,
          link,
          ``,
          `This link is unique to you and expires in ${INVITE_TTL_HOURS} hours. For your security, please don't share it with anyone.`,
          ``,
          `Please do not reply to this email — it is sent from an automated, unmonitored address.`,
        ].join("\n");

        const result = await sendEmail({
          to: [email],
          subject: `Set up your ${tenantLabel} RM ONE account`,
          body,
          senderDisplayName: tenantLabel,
          noReply: true,
        });
        if (result.ok) sent.push(email);
        else failed.push({ name: u.name, reason: result.message });
      } catch (err: any) {
        failed.push({ name: u.name, reason: err.message || String(err) });
      }
    }
    const sentSet = new Set(sent.map(v => v.toLowerCase()));
    const inviteChanges = targets
      .filter(u => sentSet.has((u.email || u.username || "").trim().toLowerCase()))
      .map(u => ({
        FieldName: `Invite sent · ${u.name || u.email || u.username}`,
        OldValue: null,
        NewValue: {
          Email: (u.email || u.username || "").trim(),
          Role: u.accessLevel ?? null,
          Enabled: u.enabled !== false,
        },
      }));
    setTrustedAuditChanges(res, boundedAuditChanges(inviteChanges, inviteChanges.length));

    res.json({ ok: true, sentCount: sent.length, failedCount: failed.length, sent, failed });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── POST /api/onboarding/members/add  { tenantId, name, email } ──────────
// Create a brand-new login account for a team member who was not in the import.
// The account starts disabled with a scrambled password — it becomes usable only
// after the person accepts an invite and chooses their own password.
router.post("/members/add", async (req: Request, res: Response) => {
  const rawTid = String(req.body?.tenantId ?? "").trim();
  const name   = String(req.body?.name ?? "").trim();
  const email  = String(req.body?.email ?? "").trim();
  // Optional access level. Anything other than an explicit admin/manager/user is
  // left unset (null) so the person is grandfathered (editable), matching import.
  const accessLevel = normRole(req.body?.role ?? req.body?.accessLevel);
  if (!rawTid) return res.status(400).json({ error: "tenantId is required" });
  if (!name)   return res.status(400).json({ error: "Please enter the person's name." });
  if (!email.includes("@")) return res.status(400).json({ error: "Please enter a valid email address." });
  if (!requireTenantAccess(req, res, rawTid)) return;

  const tid = resolveTenantId(rawTid);

  try {
    // Reject duplicates by login name OR email within this tenant.
    const emailLow = email.toLowerCase();
    const existingPg = await getActiveUsersByTenant(tid);
    if (existingPg.some(u =>
      (u.username || "").toLowerCase() === emailLow ||
      (u.email    || "").toLowerCase() === emailLow
    )) {
      return res.status(409).json({ error: "A team member with that email already exists." });
    }

    const userGuid = uuidv4().toLowerCase();
    setAuditTarget(res, { entityType: "staff", entityId: userGuid, entityName: name || email });
    const scrambled = hashPassword(crypto.randomBytes(24).toString("hex"));
    const normAcl = (s: string | null): "admin" | "manager" | "user" | null => {
      const l = (s || "").trim().toLowerCase();
      return l === "admin" ? "admin" : l === "manager" ? "manager" : l === "user" ? "user" : null;
    };
    const aclLow = normAcl(accessLevel);

    // Insert user (replaces execInsert to AspNetUsers).
    await createAppUser({
      id:          userGuid,
      tenantId:    tid,
      username:    email,
      name,
      email,
      passwordHash: scrambled,
      role:        "User",
      accessLevel: aclLow ?? undefined,
      isSiteAdmin: aclLow === "admin",
      isManager:   aclLow === "manager",
      startDate:   new Date(),
      enabled:     false,
      deleted:     false,
    });
    try {
      const written = await getUserByTenantAndId(tid, userGuid);
      if (written) setTrustedAuditChanges(res, trustedAuditDiff(null, {
        Email: written.email,
        Role: written.accessLevel,
        Enabled: written.enabled !== false,
      }, { fields: ["Email", "Role", "Enabled"] }));
    } catch { /* target-only audit fallback */ }

    // Return the GUID upper-cased for compatibility with SQL Server reporting style.
    res.json({ ok: true, userGuid: userGuid.toUpperCase(), name, email, accessLevel });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── POST /api/onboarding/members/role  { tenantId, userGuid, role } ───────
// Change an existing team member's access level. role 'Admin'|'Manager'|'User'
// sets the canonical UserRoleIdLookup (and keeps IsSiteAdmin in sync so the
// edit-gating fallback can't disagree). role '' / 'unset' clears it back to
// grandfathered (editable).
router.post("/members/role", async (req: Request, res: Response) => {
  const rawTid   = String(req.body?.tenantId ?? "").trim();
  const userGuid = String(req.body?.userGuid ?? "").trim();
  const rawRole  = String(req.body?.role ?? req.body?.accessLevel ?? "").trim();
  if (!rawTid)   return res.status(400).json({ error: "tenantId is required" });
  if (!userGuid) return res.status(400).json({ error: "userGuid is required" });
  // Hardened: changing someone's access level is a staff-admin action (it was
  // previously open to any signed-in member of the tenant).
  const src = await requireStaffAdmin(req, res, rawTid);
  if (!src) return;

  const isUnset = rawRole === "" || rawRole.toLowerCase() === "unset";
  // Built-ins normalize; a custom level marker ("custom:<id>", #87) passes
  // through verbatim so the inline selector can assign admin-defined levels
  // too (matches normAcl in lib/staff.ts).
  const isCustomLevel = /^custom:[a-z0-9][a-z0-9-]{0,12}$/.test(rawRole.toLowerCase());
  const accessLevel = isUnset ? null : isCustomLevel ? rawRole.toLowerCase() : normRole(rawRole);
  if (!isUnset && !accessLevel) {
    return res.status(400).json({ error: "role must be Admin, Manager, User, a custom level marker, or unset" });
  }

  const tid = resolveTenantId(rawTid);
  try {
    // Update role / access level (replaces AspNetUsers UPDATE).
    const normAcl2 = (s: string | null): "admin" | "manager" | "user" | null => {
      const l = (s || "").trim().toLowerCase();
      return l === "admin" ? "admin" : l === "manager" ? "manager" : l === "user" ? "user" : null;
    };
    const aclLow2 = isUnset ? null : normAcl2(accessLevel);
    // Never leave the company without an active admin: demoting the last
    // admin-capable account would lock everyone out of Settings.
    if (!isUnset && aclLow2 !== "admin" && await wouldRemoveLastAdmin(tid, rawTid, userGuid.toLowerCase())) {
      return res.status(403).json({ error: "This is the company's only active admin — make someone else an admin first." });
    }
    // Self-revert bookkeeping: remember the CURRENT level and who changed it,
    // so a user who downgraded THEMSELVES can revert without an admin.
    let prevAclForLog: string | null | undefined;
    let targetName: string | null = null;
    try {
      const prevRow = await getUserByTenantAndId(tid, userGuid.toLowerCase());
      prevAclForLog = prevRow ? (prevRow.accessLevel ?? null) : undefined;
      targetName = prevRow ? (prevRow.name || prevRow.email || prevRow.username) : null;
    } catch { /* non-fatal — skip the log entry, never the save */ }
    setAuditTarget(res, { entityType: "staff", entityId: userGuid.toLowerCase(), entityName: targetName });
    // Custom markers are stored verbatim (aclLow2 stays null for them — the
    // built-in isSiteAdmin/isManager flags never apply to a custom level).
    const newAclStored = isUnset ? null : isCustomLevel ? accessLevel : aclLow2;
    // Canonical write + best-effort legacy AspNetUsers mirror — BUILT-IN
    // levels only (a custom marker is meaningless there); unset mirrors as
    // NULL. Role changes never touch deleted legacy rows.
    // NOTE: the pre-refactor 404 ("Team member not found") was unreachable —
    // the canonical write reports no row count and throws on real failures;
    // legacy-mirror row counts are advisory only.
    await updateAppUser(tid, userGuid.toLowerCase(), {
      accessLevel: newAclStored ?? undefined,
      isSiteAdmin: aclLow2 === "admin",
      isManager:   aclLow2 === "manager",
    }, isCustomLevel ? undefined : {
      accessLevel: accessLevel,
      isSiteAdmin: accessLevel === "Admin",
      onlyIfNotDeleted: true,
    });
    if (prevAclForLog !== undefined
        && String(prevAclForLog ?? "").toLowerCase() !== String(newAclStored ?? "").toLowerCase()) {
      recordAclChange(rawTid, userGuid.toLowerCase(), prevAclForLog, newAclStored, src.userId).catch((e: unknown) =>
        console.warn(`[members/role] acl change log failed: ${String(e).slice(0, 120)}`));
    }
    if (prevAclForLog !== undefined) {
      setTrustedAuditChanges(res, trustedAuditDiff(
        { Role: prevAclForLog },
        { Role: newAclStored },
        { fields: ["Role"] },
      ));
    }
    res.json({ ok: true, userGuid, accessLevel });
  } catch (e: any) {
    console.error("[members/role] error:", e.message);
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── POST /api/onboarding/my-access-level/revert ───────────────────────────
// Self-lockout escape hatch: a user whose access level was LAST changed BY
// THEMSELVES (e.g. an admin testing a restricted custom level) may revert to
// their previous level without another admin. A level set by someone else
// stays locked — only the "I did this to myself" case gets the way back.
// Deliberately NOT behind requireStaffAdmin: the whole point is that the
// caller may have just dropped their own staff-management capability.
router.post("/my-access-level/revert", async (req: Request, res: Response) => {
  const src = requireTenantAccess(req, res);
  if (!src) return;
  const selfId = String(src.userId ?? "").trim().toLowerCase();
  if (!selfId) return res.status(400).json({ error: "Your session has no user id — please sign out and back in." });
  const tid = resolveTenantId(src.tenant);
  try {
    const entry = await getAclChangeEntry(src.tenant, selfId);
    if (!entry || entry.by !== selfId) {
      return res.status(403).json({ error: "Your access level was set by an administrator, so only an administrator can change it back." });
    }
    const target = await getUserByTenantAndId(tid, selfId);
    if (!target || target.deleted || target.enabled === false) {
      return res.status(404).json({ error: "Account not found for this company." });
    }
    const curLow = String(target.accessLevel ?? "").trim().toLowerCase() || null;
    const prevLow = entry.prev; // sanitized: lowercased or null (= unset)
    // The entry only authorizes undoing ITS OWN transition: the current level
    // must still be the one the self-change produced (entry.next). If someone
    // changed the level since — even if that change's own log write failed
    // (the log is best-effort) — the stale entry must NOT roll it back.
    const curNorm = curLow ?? "unset";
    if (entry.next === null || entry.next !== curNorm) {
      await clearAclChangeEntry(src.tenant, selfId).catch(() => { /* non-fatal */ });
      return res.status(403).json({ error: "Your access level was changed again since, so this undo no longer applies. Ask an administrator if it needs changing." });
    }
    if ((curLow ?? "") === (prevLow ?? "")) {
      // Already back — just retire the offer.
      await clearAclChangeEntry(src.tenant, selfId).catch(() => { /* non-fatal */ });
      return res.json({ ok: true, accessLevel: prevLow ?? "unset" });
    }
    // A previous CUSTOM level must still exist — a deleted level would
    // silently mean view-only (fail-closed), trading one lockout for another.
    let prevAdminCapable = prevLow === null || prevLow === "admin";
    if (isCustomAcl(prevLow)) {
      const name = await getCustomLevelName(prevLow, src.tenant);
      if (!name) {
        return res.status(400).json({ error: "Your previous access level no longer exists. Ask an administrator to set your level." });
      }
      try {
        const prevCaps = await getCapsForAcl(prevLow, src.tenant);
        prevAdminCapable = prevCaps?.manageStaff === true || prevCaps?.manageSettings === true;
      } catch { /* treated as not capable — the guard below over-protects */ }
    }
    // Never leave the company without an admin-capable account (matters only
    // when someone self-PROMOTED and is now the sole admin).
    if (!prevAdminCapable && await wouldRemoveLastAdmin(tid, src.tenant, selfId)) {
      return res.status(403).json({ error: "This is the company's only active admin — make someone else an admin before changing your own level." });
    }
    // Canonical write + best-effort legacy mirror for BUILT-IN levels
    // (matches members/role — a custom marker leaves the legacy row alone).
    await updateAppUser(tid, selfId, {
      accessLevel: prevLow,        // null clears back to grandfathered/unset
      isSiteAdmin: prevLow === "admin",
      isManager:   prevLow === "manager",
    }, isCustomAcl(prevLow) ? undefined : {
      accessLevel: prevLow === "admin" ? "Admin" : prevLow === "manager" ? "Manager" : prevLow === "user" ? "User" : null,
      isSiteAdmin: prevLow === "admin",
      onlyIfNotDeleted: true,
    });
    // Retire the entry — reverting is a one-shot undo, not a toggle.
    await clearAclChangeEntry(src.tenant, selfId).catch((e: unknown) =>
      console.warn(`[my-access-level/revert] entry clear failed: ${String(e).slice(0, 120)}`));
    console.log(`[my-access-level/revert] ${src.username}@${src.tenant} reverted ${curLow ?? "unset"} → ${prevLow ?? "unset"}`);
    res.json({ ok: true, accessLevel: prevLow ?? "unset" });
  } catch (e: any) {
    console.error("[my-access-level/revert] error:", e.message);
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── POST /api/onboarding/members/active  { tenantId, userGuid, active } ───
// Deactivate (active:false) or reactivate (active:true) a team member.
// Deactivation blocks login immediately (the token route rejects disabled
// accounts before checking the password, and the live-ACL gate blocks writes
// within its 30s cache) while keeping every allocation, hour and history row
// intact. Pending invite links are voided on deactivation. Staff-admin only.
router.post("/members/active", async (req: Request, res: Response) => {
  const requestedTid = String(req.body?.tenantId ?? "").trim();
  const userGuid = String(req.body?.userGuid ?? "").trim().toLowerCase();
  const active   = req.body?.active === true;
  if (!userGuid) return res.status(400).json({ error: "userGuid is required" });
  // Normal tenant admins already have an authoritative tenant in their signed
  // request. Some staffing projections historically omitted tenantId, so do
  // not make those screens resend information the server already knows.
  // Superadmin cross-tenant actions still retain the explicitly requested
  // target through requireTenantAccess.
  const src = await requireStaffAdmin(req, res, requestedTid || null);
  if (!src) return;
  const rawTid = requestedTid || String(src.tenant ?? "").trim();
  if (!rawTid) return res.status(400).json({ error: "tenantId is required" });
  const tid = resolveTenantId(rawTid);
  try {
    if (!active && String(src.userId ?? "").toLowerCase() === userGuid) {
      return res.status(400).json({ error: "You can't deactivate your own account." });
    }
    // Reactivation is a common recovery action from project/team screens.
    // The canonical UPDATE below both validates the identity and changes the
    // authoritative row, so avoid an additional read before returning. Keep
    // the old read for deactivation because its admin-safety checks need the
    // current target snapshot.
    const target = active ? null : await getUserByTenantAndId(tid, userGuid);
    if (!active && (!target || target.deleted)) {
      return res.status(404).json({ error: "Team member not found for this client." });
    }
    setAuditTarget(res, { entityType: "staff", entityId: userGuid, entityName: target?.name || target?.email || target?.username || userGuid });
    if (!active && await wouldRemoveLastAdmin(tid, rawTid, userGuid)) {
      return res.status(403).json({ error: "This is the company's only active admin — make someone else an admin first." });
    }
    if (!active) {
      // Void any pending invite BEFORE disabling the account. Accepting an
      // invite re-enables login, so a failed void must fail the whole action
      // (fail closed) rather than leave a self-reactivation path open.
      try {
        await voidPendingInvite(userGuid);
      } catch (e: any) {
        console.error("[members/active] could not void pending invite:", e.message);
        return res.status(503).json({ error: "Couldn't fully deactivate this account — try again in a moment." });
      }
    }
    // Canonical write + best-effort legacy mirror so old fallback reads agree.
    const updated = await updateAppUser(
      tid,
      userGuid,
      { enabled: active },
      { enabled: active },
      active ? { mirrorAsync: true } : undefined,
    );
    if (updated.canonicalRows === 0) {
      return res.status(404).json({ error: "Team member not found for this client." });
    }
    // Resource, project-team and picker payloads embed canonical app-user
    // lifecycle state. Bust locally and publish the established cache signals
    // before replying so an immediate web/mobile refresh cannot receive the
    // pre-change roster from another worker.
    bustStaffIdentityCaches(tid);
    setTrustedAuditChanges(res, trustedAuditDiff(
      { Enabled: active ? false : target?.enabled !== false },
      { Enabled: active },
      { fields: ["Enabled"] },
    ));
    res.json({ ok: true, userGuid, enabled: active });
  } catch (e: any) {
    console.error("[members/active] error:", e.message);
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── POST /api/onboarding/members/delete  { tenantId, userGuid } ───────────
// Soft-delete a team member — meant for mistakes (duplicate or wrongly
// created accounts). Anyone who has EVER held a project assignment is
// protected: the route refuses (fail closed — even when the history check
// itself errors) and the UI offers Deactivate instead, so project history is
// never orphaned. Deleted people leave the active lists and appear under
// Archive → Users, where an admin can restore them.
router.post("/members/delete", async (req: Request, res: Response) => {
  const rawTid   = String(req.body?.tenantId ?? "").trim();
  const userGuid = String(req.body?.userGuid ?? "").trim().toLowerCase();
  if (!rawTid)   return res.status(400).json({ error: "tenantId is required" });
  if (!userGuid) return res.status(400).json({ error: "userGuid is required" });
  const src = await requireStaffAdmin(req, res, rawTid);
  if (!src) return;
  const tid = resolveTenantId(rawTid);
  try {
    if (String(src.userId ?? "").toLowerCase() === userGuid) {
      return res.status(400).json({ error: "You can't delete your own account." });
    }
    const target = await getUserByTenantAndId(tid, userGuid);
    if (!target || target.deleted) {
      return res.status(404).json({ error: "Team member not found for this client." });
    }
    setAuditTarget(res, {
      entityType: "staff",
      entityId: userGuid,
      entityName: target.name || target.email || target.username,
      action: "delete.staff",
    });
    if (await wouldRemoveLastAdmin(tid, rawTid, userGuid)) {
      return res.status(403).json({ error: "This is the company's only active admin — make someone else an admin first." });
    }
    // History guard — any allocation row (even soft-deleted ones) counts.
    // ResourceAllocation holds the weekly/assignment rows ("RA"); there is no
    // table named ResourceAssignment.
    try {
      const pool = await getPool();
      const h = await pool.request()
        .input("tid", sql.NVarChar, tid)
        .input("id",  sql.NVarChar, userGuid)
        .query(`
          SELECT TOP 1 1 AS x FROM core2.dbo.ResourceAllocation WHERE TenantID=@tid AND ResourceUser=@id
          UNION ALL
          SELECT TOP 1 1 FROM core2.dbo.ResourceWorkItems WHERE TenantID=@tid AND ResourceUser=@id`);
      if ((h.recordset?.length ?? 0) > 0) {
        return res.status(409).json({
          error: "has_history",
          message: `${target.name || "This person"} has project assignments on record. Deactivate them instead so their history stays intact.`,
        });
      }
    } catch (e: any) {
      console.warn("[members/delete] history check failed:", e.message);
      return res.status(503).json({ error: "Couldn't verify this person's project history — try again in a moment." });
    }
    // Void any pending invite BEFORE deleting — invite-accept re-enables the
    // account, so a failed void must fail the delete (fail closed).
    try {
      await voidPendingInvite(userGuid);
    } catch (e: any) {
      console.error("[members/delete] could not void pending invite:", e.message);
      return res.status(503).json({ error: "Couldn't fully remove this account — try again in a moment." });
    }
    // Canonical write + best-effort legacy mirror.
    await updateAppUser(tid, userGuid, { deleted: true, enabled: false }, { deleted: true, enabled: false });
    // Deleted people must vanish from rosters/pickers/directories on every
    // worker now, not after the 10-min users TTL — same signal as
    // members/active above.
    bustStaffIdentityCaches(tid);
    setTrustedAuditChanges(res, trustedAuditDiff(
      { Email: target.email, Role: target.accessLevel, Enabled: target.enabled !== false },
      null,
      { fields: ["Email", "Role", "Enabled"] },
    ));
    res.json({ ok: true, userGuid, deleted: true });
  } catch (e: any) {
    console.error("[members/delete] error:", e.message);
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── POST /api/onboarding/members/restore  { tenantId, userGuid } ──────────
// Bring a deleted team member back: clears the deleted flag and re-enables
// login. Restored people reappear in Manage Staff immediately.
router.post("/members/restore", async (req: Request, res: Response) => {
  const rawTid   = String(req.body?.tenantId ?? "").trim();
  const userGuid = String(req.body?.userGuid ?? "").trim().toLowerCase();
  if (!rawTid)   return res.status(400).json({ error: "tenantId is required" });
  if (!userGuid) return res.status(400).json({ error: "userGuid is required" });
  if (!(await requireStaffAdmin(req, res, rawTid))) return;
  const tid = resolveTenantId(rawTid);
  try {
    const target = await getUserByTenantAndId(tid, userGuid);
    if (!target) return res.status(404).json({ error: "Team member not found for this client." });
    setAuditTarget(res, { entityType: "staff", entityId: userGuid, entityName: target.name || target.email || target.username });
    // Canonical write + best-effort legacy mirror.
    await updateAppUser(tid, userGuid, { deleted: false, enabled: true }, { deleted: false, enabled: true });
    // Restored people must reappear in rosters/pickers/directories on every
    // worker now — same signal as members/active above.
    bustStaffIdentityCaches(tid);
    setTrustedAuditChanges(res, trustedAuditDiff(
      { Enabled: target.enabled !== false, Deleted: target.deleted },
      { Enabled: true, Deleted: false },
      { fields: ["Enabled", "Deleted"] },
    ));
    res.json({ ok: true, userGuid, restored: true });
  } catch (e: any) {
    console.error("[members/restore] error:", e.message);
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── GET /api/onboarding/members/archived?tenantId= ────────────────────────
// Deleted team members for the Archive → Users tab. Read-only; restore is a
// separate staff-admin action.
router.get("/members/archived", async (req: Request, res: Response) => {
  const rawTid = String(req.query.tenantId ?? "").trim();
  if (!rawTid) return res.status(400).json({ error: "tenantId is required" });
  if (!requireTenantAccess(req, res, rawTid)) return;
  const tid = resolveTenantId(rawTid);
  try {
    const users = await getUsersByTenant(tid);
    const members = users
      .filter(u => u.deleted)
      .map(u => ({
        userGuid: u.id,
        name: u.name || u.username || "",
        email: (u.email || u.username || "").trim(),
        username: u.username,
        jobTitle: u.title || "",
        // updated_at is stamped by the delete write, so it doubles as the
        // "removed on" date for display.
        removedAt: (u as any).updatedAt ?? null,
      }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    res.json({ tenantId: tid, members });
  } catch (e: any) {
    console.error("[members/archived] error:", e.message);
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── GET /api/onboarding/invite/:token ── PUBLIC ──────────────────────────
// Validate a one-time token and report who it belongs to (for the set-password page).
router.get("/invite/:token", async (req: Request, res: Response) => {
  try {
    const tokenHash = sha256(String(req.params.token || ""));
    const inv = await lookupInviteToken(tokenHash);
    if (!inv) return res.status(404).json({ ok: false, error: "This link is not valid." });
    if (inv.status === "accepted")
      return res.status(410).json({ ok: false, error: "This link has already been used. Please log in, or ask for a new invite." });
    if (new Date(inv.expiresAt).getTime() < Date.now())
      return res.status(410).json({ ok: false, error: "This link has expired. Please ask for a new invite." });
    res.json({ ok: true, name: inv.name, email: inv.email, company: inv.tenantLabel });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
  return;
});

// ── POST /api/onboarding/invite/:token  { password } ── PUBLIC ───────────
// Set the member's own password and consume the token (one-time use).
router.post("/invite/:token", async (req: Request, res: Response) => {
  try {
    const password = String(req.body?.password ?? "");
    if (password.length < 8)
      return res.status(400).json({ ok: false, error: "Password must be at least 8 characters." });
    const tokenHash = sha256(String(req.params.token || ""));

    // Atomically CLAIM the token: only one concurrent request can flip a row
    // from "sent" → "accepted" while it is still unexpired. The guard lives in
    // the WHERE clause so a replay/race finds no eligible row and gets nothing
    // back. We claim BEFORE writing the password and compensate (revert to
    // "sent") if the password write fails, so a failed attempt stays retryable.
    const inv = await claimInviteToken(tokenHash);

    if (!inv) {
      // Nothing claimed — look up why so the user gets a precise message.
      const existing = await lookupInviteToken(tokenHash);
      if (!existing) return res.status(404).json({ ok: false, error: "This link is not valid." });
      if (existing.status === "accepted")
        return res.status(410).json({ ok: false, error: "This link has already been used." });
      return res.status(410).json({ ok: false, error: "This link has expired." });
    }

    let acceptedUserGuid = (inv.userGuid || "").toLowerCase();
    let acceptedTenantId = resolveTenantId(inv.tenantLabel || inv.tenantKey);
    try {
      const pwHash = hashPassword(password);
      const invGuidLow = (inv.userGuid || "").toLowerCase();
      const tid = resolveTenantId(inv.tenantLabel || inv.tenantKey);

      // Lifecycle guard: a deleted account must never come back through an
      // old invite link (restore via Archive → Users is the only path back),
      // and a deactivated account must not self-reactivate off a stale
      // invite. Release the claim so the same link works again if the
      // account is later restored/reactivated. Lookup failure → fail closed.
      if (invGuidLow) {
        let row: Awaited<ReturnType<typeof getUserByTenantAndId>> = null;
        try {
          row = await getUserByTenantAndId(tid, invGuidLow);
        } catch {
          await releaseInviteToken(inv.id).catch(() => {});
          return res.status(503).json({ ok: false, error: "Couldn't verify this account right now — try again in a moment." });
        }
        if (row?.deleted) {
          await releaseInviteToken(inv.id).catch(() => {});
          return res.status(403).json({ ok: false, error: "This account was removed by an administrator." });
        }
        if (row && row.enabled === false) {
          await releaseInviteToken(inv.id).catch(() => {});
          return res.status(403).json({ ok: false, error: "This account has been deactivated. Ask your administrator to reactivate it." });
        }
      }

      // Try primary update by GUID.
      let pgUpdCount = 0;
      if (invGuidLow) {
        try {
          await updateAppUser(tid, invGuidLow, { passwordHash: pwHash, enabled: true, emailConfirmed: true });
          pgUpdCount = 1;
        } catch { pgUpdCount = 0; }
      }

      if (!pgUpdCount) {
        // GUID-drift fallback: re-resolve by tenant + email (unique within a tenant).
        // This never broadens access — it targets exactly the account the token was minted for.
        if (tid && (inv.email || "").includes("@")) {
          const emailLow = (inv.email || "").toLowerCase();
          const candsFull = await getActiveUsersByTenant(tid);
          const matchedFull = candsFull.filter(u =>
            // Same lifecycle guard as the GUID path: never re-enable a
            // deleted or deactivated account through the drift fallback.
            !u.deleted && u.enabled !== false && (
              (u.username || "").toLowerCase() === emailLow ||
              (u.email    || "").toLowerCase() === emailLow
            )
          );
          if (matchedFull.length === 1) {
            const resolvedId = matchedFull[0].id;
            acceptedUserGuid = resolvedId;
            console.warn(`[onboarding] invite accept: userGuid drift for invite=${inv.id} tenant=${inv.tenantKey} storedGuid=${inv.userGuid} -> resolved by email to ${resolvedId}`);
            try {
              await updateAppUser(tid, resolvedId, { passwordHash: pwHash, enabled: true, emailConfirmed: true });
              pgUpdCount = 1;
            } catch { pgUpdCount = 0; }
          } else {
            console.warn(`[onboarding] invite accept: userGuid drift for invite=${inv.id} tenant=${inv.tenantKey} email=${inv.email} matched ${matchedFull.length} rows — not resolving`);
          }
        }
      }

      if (!pgUpdCount) {
        // Account row genuinely missing — release the claim so the link can be retried.
        await releaseInviteToken(inv.id);
        return res.status(404).json({ ok: false, error: "Account not found." });
      }
    } catch (inner: any) {
      // Password write failed — release the claim so the link stays usable.
      await releaseInviteToken(inv.id).catch(() => {});
      throw inner;
    }
    void recordAuditEvent({
      tenantId: acceptedTenantId,
      actorId: acceptedUserGuid,
      actorName: inv.name || inv.email,
      actorEmail: inv.email,
      actorType: "user",
      action: "update.staff",
      outcome: "success",
      entityType: "staff",
      entityId: acceptedUserGuid,
      entityName: inv.name || inv.email,
      source: "web",
      changes: [{ FieldName: "Invite accepted", OldValue: "invite_pending", NewValue: "active" }],
    }).catch((error) => console.warn("[onboarding] invite acceptance audit failed:", error));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
  return;
});

// ── GET /api/onboarding/status/:id ───────────────────────────────────────
// IMPORTANT: must fall back to the DB. In production (and any multi-worker /
// multi-instance setup) the poll can land on a process that never ran the
// pipeline, so its in-memory _jobs map either lacks the job entirely (→ the
// status page spun on "Not found" forever while history showed Success) or
// holds a stale pre-completion copy. The DB row — written by persistJob when
// the run finishes — is the source of truth for terminal states.
router.get("/status/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  let job = _jobs.get(id);
  if (!job) {
    // Meta-only load: the status response never needs the raw Excel blob and
    // fetching it (up to tens of MB base64) would make every poll slow.
    const dbJob = await loadJobFromDb(id, { metaOnly: true });
    if (dbJob) { job = dbJob; _jobs.set(id, dbJob); }
  } else if (job.status === "running" || job.status === "pending") {
    // This process thinks the job is still going — but that may be a stale
    // copy on a worker that isn't the one running the pipeline. If the DB
    // already has a terminal result, prefer it. (On the worker actually
    // running the job the DB row still says "running", so live progress is
    // untouched.) Throttled to one DB check per 10s per upload so the 2s
    // poll doesn't hammer the DB while the pipeline is working.
    const now = Date.now();
    const last = _statusDbCheckAt.get(id) ?? 0;
    if (now - last >= 10_000) {
      _statusDbCheckAt.set(id, now);
      const dbJob = await loadJobFromDb(id, { metaOnly: true });
      // Adopt the DB row when it is terminal, OR when this worker still says
      // "pending" and the DB has moved to "running" — /run may have landed on
      // a different worker, and serving the stale "pending" copy makes the
      // status page show a false "this import hasn't started" banner.
      const dbTerminal = dbJob && dbJob.status !== "running" && dbJob.status !== "pending";
      const dbAdvanced = dbJob && job.status === "pending" && dbJob.status !== "pending";
      if (dbJob && (dbTerminal || dbAdvanced)) {
        // Keep any fileData the in-memory copy already had (meta load strips it).
        dbJob.fileData = job.fileData;
        job = dbJob;
        _jobs.set(id, dbJob);
      } else if (dbJob && dbJob.status === "running" && job.lastActivityAt === undefined) {
        // Ghost guard, mirroring GET /active's DB sweep: the DB row still says
        // "running", no process HERE owns the run (lastActivityAt is only ever
        // set on the worker executing the pipeline), and the row's heartbeat
        // (updated_at, bumped ~60s by the owning process) has been silent past
        // the stale window — the owner is dead. Fail the row and serve
        // "failed" so the import popup (which polls only /status; the App
        // /active watcher is silenced while it is open) stops showing
        // "processing" forever. Never applied on the owning worker: its own
        // heartbeat can lapse under memory duress while the run is alive.
        try {
          const row = (await getRunningOnboardingJobsMeta()).find(r => r.uploadId === id);
          if (row && now - new Date(row.updatedAt).getTime() > staleMsFor(row.status)) {
            const errorDetail = ghostMessage(row.status);
            void failOnboardingJobIfActive(id, errorDetail).catch(() => { /* best-effort cleanup */ });
            const failed: JobRecord = { ...job, status: "failed", result: { ...(job.result ?? {}), failureReason: errorDetail } };
            job = failed;
            _jobs.set(id, failed);
          }
        } catch { /* best-effort — keep serving the running copy this poll */ }
      }
    }
  }
  if (!job) return res.status(404).json({ error: "Not found" });
  if (!requireTenantAccess(req, res, job.tenantId)) return;
  const { uploadId, tenantId, fileName, status, createdAt, totalInserted, totalErrors, importMode } = job;
  // Merge step-level errors + top-level result.errors so the status page
  // always has the full list regardless of which path recorded them.
  const stepErrors = (job.result?.steps ?? []).flatMap((s: any) => s.errors ?? []);
  const topErrors  = (job.result?.errors ?? []) as any[];
  const seenKeys   = new Set(stepErrors.map((e: any) => `${e.table}|${e.rowIndex}|${e.message}`));
  const extraErrors = topErrors.filter((e: any) => !seenKeys.has(`${e.table}|${e.rowIndex}|${e.message}`));
  const allErrors  = [...stepErrors, ...extraErrors];
  res.json({ uploadId, tenantId, fileName, status, createdAt, totalInserted, totalErrors,
    // Setup/config seed writes (Config_* seeds, portal-config clone, tenant/
    // admin seed) — counted separately from data rows so a 0-data-row run is
    // never presented as "N records inserted" (#390).
    configInserted: job.result?.configInserted ?? null,
    // Last pipeline activity (epoch ms) — lets the status page distinguish a
    // long-but-alive import from a genuinely stalled one. Only the worker
    // actually running the pipeline has this in memory; elsewhere it's null
    // and the frontend falls back to createdAt.
    lastActivityAt: job.lastActivityAt ?? null,
    importMode: importMode ?? null,
    failureReason: job.result?.failureReason ?? job.errorDetail ?? null,
    // errorDetail last — lets ghost-sweep auto-cancel reasons reach the
    // wizard's terminal card (it renders fatalError), not just the status
    // page (which renders failureReason).
    fatalError: job.result?.fatalError ?? job.result?.error ?? job.errorDetail ?? null,
    rolledBack: job.result?.rolledBack ?? false,
    progress: job.progress ?? null,
    steps: job.result?.steps ?? [],
    errors: allErrors,
    warnings: job.result?.warnings ?? [],
    constructionRetryEntries: job.result?.constructionRetryEntries ?? [] });
  return;
});

// ── POST /api/onboarding/retry-construction/:id ───────────────────────────
// Re-runs supplementalRecordUpdate for only the fields that failed during the
// original import. Fields that previously succeeded are untouched. The job's
// warnings and constructionRetryEntries are updated in-place so the status
// page reflects the new state after retry.
router.post("/retry-construction/:id", async (req: Request, res: Response) => {
  const uploadId = String(req.params.id).trim();
  const job = _jobs.get(uploadId) ?? await loadJobFromDb(uploadId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (!requireTenantAccess(req, res, job.tenantId)) return;

  const entries: ConstructionRetryEntry[] = job.result?.constructionRetryEntries ?? [];
  if (entries.length === 0) {
    return res.json({ ok: true, warnings: [], constructionRetryEntries: [], message: "No construction field failures to retry" });
  }

  let retryResult: Awaited<ReturnType<typeof retryConstructionFields>>;
  try {
    retryResult = await retryConstructionFields(job.tenantId, entries);
  } catch (e: any) {
    console.error(`[onboarding] retry-construction ${uploadId} failed:`, e);
    return res.status(500).json({ ok: false, error: e.message });
  }

  // Update the job's result in-memory (and persist) so subsequent GET /status
  // calls reflect the new state without a re-upload.
  if (job.result) {
    job.result.warnings = retryResult.warnings;
    job.result.constructionRetryEntries = retryResult.remainingEntries;
    // If all fields are now resolved, upgrade a "partial" status to "success".
    if (retryResult.warnings.length === 0 && job.status === "partial") {
      job.status = "success";
      job.result.status = "success";
    }
    persistJob(job);
  }

  console.log(`[onboarding] retry-construction ${uploadId}: ${entries.length} entries → ${retryResult.remainingEntries.length} still failing`);
  return res.json({
    ok: true,
    warnings: retryResult.warnings,
    constructionRetryEntries: retryResult.remainingEntries,
    message: retryResult.warnings.length === 0
      ? "All construction fields written successfully."
      : `${retryResult.remainingEntries.length} field group(s) still failing — check schema type mismatches.`,
  });
});

// ── Needs-attention review queue ──────────────────────────────────────────
// Rows an upload could not place safely are HELD OUT — never guessed, never
// imported — until an admin decides here. Every decision is remembered as an
// alias (rmone_identity_aliases) so the same spelling never asks twice.
// v1: resolving does NOT replay the held rows; re-uploading the same file
// places them silently. The UI copy says exactly that.

const REVIEW_GUID_RE   = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const REVIEW_TICKET_RE = /^[A-Za-z]{2,6}-\d{2,10}(-\d{2,10})?$/;

// GET /api/onboarding/review?status=open|resolved|dismissed|all&uploadId=&tenant=
router.get("/review", async (req: Request, res: Response) => {
  try {
    const src = await requireTenantAdmin(req, res);
    if (!src) return;
    const qTenant = String(req.query.tenant ?? "").trim();
    const tid = resolveTenantId(qTenant && isSuperAdminSource(src) ? qTenant : src.tenant);
    const status = String(req.query.status ?? "open").trim().toLowerCase();
    const uploadId = String(req.query.uploadId ?? "").trim();
    // Lazily close items answered since the last upload (alias saved, or the
    // person/project created through a path that never touched the review row)
    // so answered questions vanish immediately instead of waiting for the next
    // import run. Best-effort: a failure must never break the list response.
    if (status === "open") {
      try {
        await autoResolveAnsweredReviewItems(tid);
      } catch (e: any) {
        console.warn("[onboarding] lazy auto-resolve of review items failed (non-fatal):", e?.message ?? e);
      }
    }
    const items = await listImportReview(tid, {
      status: status === "all" ? undefined : status,
      uploadId: uploadId || undefined,
    });
    const openCount = status === "open" && !uploadId
      ? items.length
      : await countOpenImportReview(tid);
    res.json({ items, openCount });
  } catch (e: any) {
    console.error("[onboarding] review list failed:", e?.message ?? e);
    res.status(500).json({ error: "Could not load the needs-attention list" });
  }
});

// POST /api/onboarding/review/:id/resolve
// body: { action: "merge-person" | "new-person" | "map-project" | "create-project"
//                 | "map-company" | "create-company" | "dismiss",
//         targetKey?, targetLabel? }
router.post("/review/:id/resolve", async (req: Request, res: Response) => {
  try {
    const src = await requireTenantAdmin(req, res);
    if (!src) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: "Bad review item id" }); return; }
    const item = await getImportReviewItem(id);
    if (!item) { res.status(404).json({ error: "Review item not found" }); return; }
    if (!isSuperAdminSource(src) && item.tenantId !== resolveTenantId(src.tenant)) {
      res.status(403).json({ error: "You do not have access to this company's data" });
      return;
    }
    if (item.status !== "open") { res.status(409).json({ error: "This item was already handled" }); return; }

    const action      = String(req.body?.action ?? "").trim();
    const targetKey   = String(req.body?.targetKey ?? "").trim();
    const targetLabel = String(req.body?.targetLabel ?? "").trim() || item.displayLabel || null;
    const tid = item.tenantId;
    const by  = (src as any).username ?? null;
    const isPerson  = item.kind === "person-match";
    const isCompany = item.kind === "company-ref";
    // Alias both the canonical key and the raw lowercase spelling — pipeline
    // lookups use normIdentKey, but older row keys may carry uncollapsed
    // whitespace.
    const aliasKeys = Array.from(new Set(
      [normIdentKey(item.rowKey), item.rowKey.trim().toLowerCase()].filter(Boolean),
    ));
    let resolution: Record<string, unknown> = { action };

    if (action === "dismiss") {
      // No alias — the same spelling will ask again on the next upload.
    } else if (action === "merge-person") {
      if (!isPerson) { res.status(400).json({ error: "This item isn't a person question" }); return; }
      if (!REVIEW_GUID_RE.test(targetKey)) { res.status(400).json({ error: "Pick the existing team member to match with" }); return; }
      for (const ak of aliasKeys) {
        await upsertIdentityAlias({ tenantId: tid, kind: "person", aliasKey: ak, targetKey, targetLabel, decision: "merge", createdBy: by });
      }
      resolution = { action, targetKey, targetLabel };
    } else if (action === "new-person") {
      if (!isPerson) { res.status(400).json({ error: "This item isn't a person question" }); return; }
      // Create the account now so the person exists immediately; their held
      // rows land on it when the file is uploaded again.
      const samples = (item.row as any)?.samples;
      const sample  = (Array.isArray(samples) ? samples[0] : null) as Record<string, unknown> | null;
      const sv = (v: unknown) => { const s = String(v ?? "").trim(); return s || null; };
      const uname = sv(sample?.UserName) ?? sv(sample?.Email) ?? sv(sample?.Resource) ?? item.rowKey;
      const email = sv(sample?.Email) ?? (uname.includes("@") ? uname : null);
      const disp  = sv(sample?.Name) ?? (((item.displayLabel || "").replace(/\s*\(.*\)\s*$/, "").trim()) || uname);
      const userGuid = uuidv4().toLowerCase();
      await createAppUser({
        id:           userGuid,
        tenantId:     tid,
        username:     uname.toLowerCase(),
        name:         disp,
        email,
        passwordHash: sha256(uuidv4()),
        role:         "User",
        startDate:    new Date(),
        enabled:      true,
        deleted:      false,
      });
      for (const ak of aliasKeys) {
        await upsertIdentityAlias({ tenantId: tid, kind: "person", aliasKey: ak, targetKey: userGuid, targetLabel: disp, decision: "new", createdBy: by });
      }
      resolution = { action, createdUserId: userGuid, name: disp };
    } else if (action === "map-project") {
      if (isPerson || isCompany) { res.status(400).json({ error: "This item isn't a project question" }); return; }
      if (!REVIEW_TICKET_RE.test(targetKey)) { res.status(400).json({ error: "Pick the record these rows belong to" }); return; }
      for (const ak of aliasKeys) {
        await upsertIdentityAlias({ tenantId: tid, kind: "project", aliasKey: ak, targetKey, targetLabel, decision: "merge", createdBy: by });
      }
      resolution = { action, targetKey, targetLabel };
    } else if (action === "create-project") {
      if (isPerson || isCompany) { res.status(400).json({ error: "This item isn't a project question" }); return; }
      if (item.kind === "project-collision") { res.status(400).json({ error: "This name matches existing records — pick one instead" }); return; }
      const title = (item.displayLabel || item.rowKey).trim();
      const shell = await createProjectShell(tid, title, by);
      for (const ak of aliasKeys) {
        await upsertIdentityAlias({ tenantId: tid, kind: "project", aliasKey: ak, targetKey: shell.ticketId, targetLabel: title, decision: "new", createdBy: by });
      }
      resolution = { action, createdTicketId: shell.ticketId, title };
    } else if (action === "map-company") {
      if (!isCompany) { res.status(400).json({ error: "This item isn't a company question" }); return; }
      if (!/^\d+$/.test(targetKey)) { res.status(400).json({ error: "Pick the company these rows belong to" }); return; }
      const pool = await getPool();
      const coq = await pool.request()
        .input("tid", sql.NVarChar, tid)
        .input("cid", sql.BigInt, Number(targetKey))
        .query("SELECT TOP 1 ID, Title FROM core2.dbo.CRMCompany WHERE TenantID=@tid AND ID=@cid AND (Deleted=0 OR Deleted IS NULL)");
      const co = coq.recordset[0] as { ID: number; Title: string | null } | undefined;
      if (!co) { res.status(400).json({ error: "That company no longer exists — refresh the list and pick again" }); return; }
      const label = (co.Title ?? "").trim() || targetLabel || targetKey;
      for (const ak of aliasKeys) {
        await upsertIdentityAlias({ tenantId: tid, kind: "company", aliasKey: ak, targetKey: String(co.ID), targetLabel: label, decision: "merge", createdBy: by });
      }
      resolution = { action, targetKey: String(co.ID), targetLabel: label };
    } else if (action === "create-company") {
      if (!isCompany) { res.status(400).json({ error: "This item isn't a company question" }); return; }
      // Display label is "Name (ID)" when the file carried an ID — strip it.
      const rawName = (item.displayLabel || "").replace(/\s*\([^()]*\)\s*$/, "").trim();
      if (!rawName) { res.status(400).json({ error: "These rows carry no company name — pick an existing company instead" }); return; }
      // A row key that looks like a Company ID becomes the new company's ID
      // (ID-carrying refs use the ID as their row key; name-only refs use the name).
      const keyTok = normalizeCompanyTicketId(item.rowKey);
      const useId = !!keyTok && !customCompanyIdProblem(keyTok) && keyTok.toLowerCase() !== rawName.toLowerCase();
      const made = await createCompanyRds(tid, { title: rawName, ticketId: useId ? keyTok : undefined }, by ?? undefined);
      let coIdStr: string; let coLabel = rawName; let coTicket: string | null = null;
      if (made.ok) {
        coIdStr = String(made.id); coLabel = made.title; coTicket = made.ticketId ?? null;
      } else if ((made.code === "dup-title" || made.code === "dup-id") && (made as any).existing) {
        // Already there — answer the question by mapping to the existing row.
        const ex = (made as any).existing;
        coIdStr = String(ex.id ?? ex.ID);
        coLabel = String(ex.title ?? ex.Title ?? rawName);
      } else {
        res.status(400).json({ error: made.error || "Could not create the company" });
        return;
      }
      for (const ak of aliasKeys) {
        await upsertIdentityAlias({ tenantId: tid, kind: "company", aliasKey: ak, targetKey: coIdStr, targetLabel: coLabel, decision: made.ok ? "new" : "merge", createdBy: by });
      }
      resolution = { action, targetKey: coIdStr, targetLabel: coLabel, ticketId: coTicket };
    } else {
      res.status(400).json({ error: "Unknown action" });
      return;
    }

    const newStatus = action === "dismiss" ? "dismissed" as const : "resolved" as const;
    const ok = await resolveImportReviewItem(id, { status: newStatus, resolution, resolvedBy: by });
    if (!ok) { res.status(409).json({ error: "This item was already handled" }); return; }
    // A company answered here may make OTHER open company questions moot
    // (an earlier upload asked about the same ID or the same name under a
    // different row key). Close them now so the needs-attention count drops
    // immediately instead of waiting for the next list refresh. Best-effort.
    if (isCompany && newStatus === "resolved") {
      try {
        const n = await autoResolveAnsweredReviewItems(tid, { resolvedBy: by ?? "review-resolve" });
        if (n) console.log(`[onboarding] auto-resolved ${n} sibling review item(s) after company answer (tenant=${tid})`);
      } catch (e: any) {
        console.warn("[onboarding] sibling auto-resolve after company answer failed (non-fatal):", e?.message ?? e);
      }
    }
    res.json({ ok: true, status: newStatus, resolution });
  } catch (e: any) {
    console.error("[onboarding] review resolve failed:", e?.message ?? e);
    res.status(500).json({ error: "Could not save this decision — please try again" });
  }
});

// ── GET /api/onboarding/history ───────────────────────────────────────────
router.get("/history", async (req: Request, res: Response) => {
  const requested = req.query.tenantId as string | undefined;
  // Trusted tenant scoping. The query param is only a *hint*: for any
  // authenticated company user we ignore it and force their own login tenant so
  // they can never enumerate other companies' onboarding runs by crafting the
  // request. Only a verified superadmin may see across companies (and may then
  // optionally narrow by the requested tenantId).
  const src = resolveRequestSource(req);
  if (!src) {
    // No valid session token — never leak any company's runs to an anonymous or
    // invalid-token caller. The two callers (onboarding history + settings pages)
    // both send the bearer token.
    return res.status(401).json({ error: "Authentication required" });
  }
  let effectiveFilter = requested;
  const wantsOthers = !requested?.trim() || normTenant(requested) !== normTenant(src.tenant);
  if (wantsOthers) {
    // Cross-tenant read requested — only allow it for a real superadmin.
    const superAdmin = isSuperAdminSource(src);
    if (!superAdmin) effectiveFilter = src.tenant; // force own tenant
  }
  // Normalize both sides: the login tenant key (already normalized) vs jobs stored
  // under the company *label* (e.g. "Acme Construction"). Compare on normTenant.
  const tenantFilter = effectiveFilter;
  const normFilter = tenantFilter?.trim() ? normTenant(tenantFilter) : undefined;

  // DB is the source of truth — query Postgres directly so the full history is
  // always visible regardless of how many restarts the server has had. The
  // in-memory _jobs map is only a startup cache; reading from it here would
  // lose any records that weren't loaded at boot time. Fall back to _jobs only
  // if DB is unreachable.
  //
  // Tenant filtering is pushed into the WHERE clause so a specific tenant's
  // complete history is never truncated by a row limit. The normTenant()
  // normalization (lowercase + spaces→underscores) is mirrored in SQL so the
  // comparison is consistent with what was stored. The global (all-tenants)
  // view used by superadmins is capped at 1000 rows; pagination is a follow-up.
  type HistoryRow = {
    uploadId: string; tenantId: string; fileName: string;
    status: string; createdAt: string; createdBy?: string | null;
    totalInserted: number | null | undefined; totalErrors: number | null | undefined;
    warningsCount: number;
    importMode?: string | null;
  };
  let rawJobs: HistoryRow[] = [];
  // Set when the DB history query failed and we served the (possibly empty)
  // in-memory fallback — the frontend must not render "No uploads yet" then.
  let historyDegraded = false;

  try {
    // Fast path: slim query — scalar columns + SQL-side warnings COUNT only.
    // The older "meta" query still shipped the result/sheets/column_mapping
    // JSON blobs (MBs per big import × every run ever made), which made the
    // history page crawl in production. OPENJSON needs DB compat >= 130, so
    // fall back to the heavier meta query if the slim one errors.
    let dbRows: HistoryRow[];
    try {
      // When scoped to one tenant, push the WHERE into SQL so only that
      // tenant's rows are read and OPENJSON runs on ~10-50 rows instead of
      // the full table (which grows with every import ever made).
      const slimRows = tenantFilter?.trim()
        ? await getOnboardingHistorySlimByTenant(tenantFilter)
        : await getOnboardingHistorySlim();
      dbRows = slimRows.map(r => ({
        uploadId:      r.uploadId,
        tenantId:      r.tenantId,
        fileName:      r.fileName,
        status:        r.status,
        createdAt:     new Date(r.createdAt).toISOString(),
        createdBy:     r.createdBy ?? undefined,
        totalInserted: r.totalInserted,
        totalErrors:   r.totalErrors,
        importMode:    r.importMode ?? undefined,
        warningsCount: r.warningsCount,
      }));
    } catch (slimErr) {
      console.warn("[onboarding] /history slim query failed, falling back to full meta:", (slimErr as Error).message);
      dbRows = (await getAllOnboardingJobsMeta()).map(r => ({
        uploadId:      r.uploadId,
        tenantId:      r.tenantId,
        fileName:      r.fileName,
        status:        r.status,
        createdAt:     new Date(r.createdAt).toISOString(),
        createdBy:     r.createdBy ?? undefined,
        totalInserted: r.totalInserted,
        totalErrors:   r.totalErrors,
        importMode:    r.importMode ?? undefined,
        warningsCount: ((jparse<any>(r.result))?.warnings ?? []).length,
      }));
    }

    // Filter and sort in JS: mirrors the Postgres WHERE/ORDER BY logic.
    const filtered = dbRows
      .filter(r => r.status !== "pending" && (!normFilter || normTenant(r.tenantId) === normFilter))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // All-tenant superadmin view capped at 1000; tenant-scoped view is uncapped.
    rawJobs = normFilter ? filtered : filtered.slice(0, 1000);

    // Merge in any in-memory jobs (running OR pending) not yet reflected in DB.
    // "pending" jobs are filtered out of the DB query above but the user expects
    // to see a job they just uploaded appear in history immediately (before the
    // pipeline has been kicked off and the DB row transitions to "running").
    // Only in-memory jobs are used here so stale pending rows from before a
    // server restart are not surfaced. DB rows take precedence for everything else.
    const dbIds = new Set(rawJobs.map(j => j.uploadId));
    for (const j of _jobs.values()) {
      if (!["running", "pending"].includes(j.status) || dbIds.has(j.uploadId)) continue;
      // Honour the same tenant scope as the DB query.
      if (normFilter && normTenant(j.tenantId) !== normFilter) continue;
      rawJobs.push({
        uploadId:      j.uploadId,
        tenantId:      j.tenantId,
        fileName:      j.fileName,
        status:        j.status,
        createdAt:     j.createdAt,
        createdBy:     j.createdBy,
        totalInserted: j.totalInserted,
        totalErrors:   j.totalErrors,
        importMode:    j.importMode ?? undefined,
        warningsCount: (j.result?.warnings ?? []).length,
      });
    }
  } catch (e) {
    // DB unavailable — fall back to the in-memory cache so the page doesn't
    // go blank during a transient Postgres outage. Mark the response degraded
    // so the frontend can say "history is temporarily unavailable" instead of
    // rendering a false "No uploads yet" empty state (this worker's memory
    // may be empty right after a boot even though runs exist in the DB).
    historyDegraded = true;
    console.warn("[onboarding] /history DB query failed, falling back to _jobs:", (e as Error).message);
    rawJobs = [..._jobs.values()]
      .filter(j => j.status !== "pending")
      .filter(j => !normFilter || normTenant(j.tenantId) === normFilter)
      .map(j => ({
        uploadId:      j.uploadId,
        tenantId:      j.tenantId,
        fileName:      j.fileName,
        status:        j.status,
        createdAt:     j.createdAt,
        createdBy:     j.createdBy,
        totalInserted: j.totalInserted,
        totalErrors:   j.totalErrors,
        importMode:    j.importMode ?? undefined,
        warningsCount: (j.result?.warnings ?? []).length,
      }));
  }

  // ── Superadmin: discover core2 tenants that have no onboarding jobs yet ──
  // This surfaces provisioned-but-never-uploaded tenants (e.g. created via the
  // "New Company" wizard) without relying solely on the sentinel job row that
  // future provisions now insert automatically.
  if (!normFilter) {
    try {
      const now = Date.now();
      if (!_core2TenantCache || _core2TenantCache.expiresAt <= now) {
        const guids  = await fetchAllTenantIds();
        const names  = await fetchCompanyNames(guids);
        _core2TenantCache = { guids, names, expiresAt: now + CORE2_TENANT_CACHE_TTL_MS };
      }
      const { guids, names } = _core2TenantCache;

      // Build a set of GUIDs already covered by existing job rows.
      const knownGuids = new Set(rawJobs.map(j => resolveTenantId(j.tenantId)));

      for (const guid of guids) {
        if (knownGuids.has(guid)) continue;
        // Use CRMCompany.Title as the display name; fall back to an empty
        // string so the frontend knows to render "Unnamed Company".
        const displayName = names.get(guid) || "";
        rawJobs.push({
          uploadId:      `phantom-${guid}`,
          // *** Store the GUID as tenantId so /tenant/delete can resolve it. ***
          // The displayName is sent separately so the UI can show the company
          // name without relying on tenantId being human-readable. Using the
          // display-name string here used to break delete (resolveTenantId
          // couldn't map a CRMCompany Title back to a GUID → DELETE matched 0
          // rows). Phantom job tenantId = GUID, real job tenantId = friendly
          // label, both are handled by resolveTenantId on the delete path.
          tenantId:      guid,
          // Sent as a dedicated field so the frontend can render the company
          // name even though tenantId is now a GUID.
          ...(displayName ? { displayName } : {}),
          fileName:      "(Provisioned)",
          status:        "provisioned",
          // These tenants predate sentinel-row tracking or were provisioned
          // outside the wizard — we have no stored creation timestamp.
          // Use the epoch sentinel so the frontend can show "Unknown" and
          // these cards sort to the BOTTOM (newest-first sort, so 1970 < any
          // real date → appear last). Using request-time (new Date()) here
          // made every provisioned card show today's date on every page load.
          createdAt:     "1970-01-01T00:00:00.000Z",
          createdBy:     undefined,
          totalInserted: 0,
          totalErrors:   0,
          warningsCount: 0,
        });
      }
    } catch {
      // non-fatal — core2 may be unreachable; history still works without it
    }
  }

  const jobs = rawJobs
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  res.json({ jobs, total: jobs.length, ...(historyDegraded ? { degraded: true } : {}) });
  return;
});

// ── POST /api/onboarding/tenant/delete ────────────────────────────────────
// Superadmin-only FULL tenant removal — works even when the tenant has real
// uploaded data. Removes, in order:
//   • every core2 row keyed to the tenant (config + org + txn + settings —
//     ALL tables with a TenantID column, not just the pipeline set),
//   • invite tokens (core2.dbo.RMOneInviteTokens — keyed by TenantKey/Label),
//   • every app-DB row keyed to the tenant, INCLUDING user accounts and
//     credentials (rmone_users), aliases, review items, provenance and the
//     active-tenant registry,
//   • our onboarding job history + tenant status bookkeeping.
// Safety rails:
//   1. Superadmin gate + template/rmone refusal + self-tenant refusal.
//   2. Tenant import lease + live-run check (never delete mid-import).
//   3. Tenants WITH uploaded data require body.confirm = the company name
//      (same typed-confirm contract as /tenant/start-over) AND get a full
//      NDJSON.gz snapshot of every row (both DBs) written to S3 FIRST —
//      no snapshot, no wipe. Provisioned/no-data tenants skip confirm +
//      snapshot (clone-config rows are re-creatable), which keeps the bulk
//      "Delete all provisioned" flow one-click.
router.post("/tenant/delete", async (req: Request, res: Response) => {
  const src = resolveRequestSource(req);
  if (!src) { res.status(401).json({ error: "unauthorized" }); return; }
  if (!isSuperAdminSource(src)) { res.status(403).json({ error: "superadmin access required" }); return; }

  const rawTid = String(req.body?.tenantId ?? "").trim();
  if (!rawTid) { res.status(400).json({ error: "tenantId is required" }); return; }

  const guid = resolveTenantId(rawTid);
  if (guid === TEMPLATE_TENANT_ID || normTenant(rawTid) === normTenant("rmone")) {
    res.status(400).json({ error: "refusing to delete the template or rmone superadmin tenant" });
    return;
  }
  // Self-lockout guard: deleting the tenant your own login lives in would
  // remove your credentials mid-session.
  if (src.tenant && resolveTenantId(String(src.tenant)) === guid) {
    res.status(400).json({ error: "self_tenant", message: "You can't delete the company you are signed into." });
    return;
  }

  const { acquireTenantImportLease, hasActiveOnboardingRun, deleteIdentityAliasesByKind, dismissAllOpenImportReview } =
    await import("@workspace/db");
  // Same rails as start-over: a running import blocks the delete (409) and
  // the lease blocks a new import from starting mid-delete.
  const lease = await acquireTenantImportLease(rawTid, 5_000).catch(() => null);
  if (!lease) {
    res.status(409).json({ error: "busy", message: "An import is running for this company right now — wait for it to finish, then try again." });
    return;
  }
  try {
    const t0 = Date.now();
    const dbg = (m: string) => console.log(`[tenant-delete:${rawTid}] ${m} +${Date.now() - t0}ms`);
    dbg("lease acquired");
    let liveRun = true;
    try { liveRun = await hasActiveOnboardingRun(rawTid); } catch { /* fail closed */ }
    if (liveRun) {
      res.status(409).json({ error: "busy", message: "An import is running for this company right now — wait for it to finish, then try again." });
      return;
    }
    dbg("liveRun checked");

    const pool = await getPool();
    dbg("core2 pool ready");
    // Bracket-safe identifier quoting for names sourced from INFORMATION_SCHEMA.
    const bq = (s: string) => `[${String(s).replace(/\]/g, "]]")}]`;

    // ── Discover per-tenant rows: core2 (ALL tables with TenantID) ────────
    const colsR = await pool.request().query(`
      SELECT TABLE_SCHEMA s, TABLE_NAME t FROM core2.INFORMATION_SCHEMA.COLUMNS
      WHERE LOWER(COLUMN_NAME)='tenantid'`);
    dbg("core2 discovery done");
    const schemaByTable = new Map<string, string>();
    const nameByLower = new Map<string, string>();
    for (const r of (colsR.recordset ?? []) as any[]) {
      schemaByTable.set(String(r.t).toLowerCase(), String(r.s));
      nameByLower.set(String(r.t).toLowerCase(), String(r.t));
    }
    // Children-first ordering hint so the FK convergence loop finishes fast;
    // unknown tables go last alphabetically.
    const orderHint = [...START_OVER_TABLES, ...ONBOARD_TABLES].map(t => t.toLowerCase());
    const core2Tables = [...nameByLower.keys()].sort((a, b) => {
      const ia = orderHint.indexOf(a), ib = orderHint.indexOf(b);
      return (ia === -1 ? orderHint.length : ia) - (ib === -1 ? orderHint.length : ib) || a.localeCompare(b);
    });
    const fqOf = (lt: string) => `[core2].${bq(schemaByTable.get(lt)!)}.${bq(nameByLower.get(lt)!)}`;

    // ── Fast-path for provisioned (no-data) tenants ───────────────────────
    // Probe only the 12 key START_OVER_TABLES in a single UNION ALL before
    // running the full 415-table scan. If all are zero the tenant is
    // provisioned-only: skip the expensive full scan entirely (saves 30-60 s
    // of lock-contended COUNT queries that would all return 0 anyway).
    const startOverSet = new Set(START_OVER_TABLES.map(t => t.toLowerCase()));
    const knownStartOver = START_OVER_TABLES.filter(t => schemaByTable.has(t.toLowerCase()));
    let dataRows = 0;
    const tableCounts: Record<string, number> = {};
    {
      const probeQ = knownStartOver.map((t, j) =>
        `SELECT ${j} i, COUNT(*) n FROM ${fqOf(t.toLowerCase())} WHERE TenantID=@tid`
      ).join("\nUNION ALL\n");
      if (probeQ) {
        const r = await pool.request().input("tid", sql.VarChar(64), guid).query(probeQ);
        for (const row of (r.recordset ?? []) as any[]) {
          const n = Number(row.n) || 0;
          if (n > 0) {
            tableCounts[knownStartOver[row.i]] = n;
            dataRows += n;
          }
        }
      }
    }
    dbg(`data-row fast-probe done: dataRows=${dataRows}`);

    // Only run the full 415-table scan when the tenant actually has data —
    // provisioned tenants skip it entirely and go straight to cleanup.
    if (dataRows > 0) {
      // Row counts per table, BATCHED as UNION ALL chunks — core2 has 400+
      // tenant-keyed tables and one round trip per table takes minutes, while
      // ~7 batched queries finish in a few seconds. VarChar params on purpose:
      // core2 TenantID columns are varchar and an NVarChar param would force a
      // column-side conversion (scans + lock timeouts).
      for (let i = 0; i < core2Tables.length; i += 60) {
        const chunk = core2Tables.slice(i, i + 60);
        const q = chunk.map((lt, j) => `SELECT ${i + j} i, COUNT(*) n FROM ${fqOf(lt)} WHERE TenantID=@tid`).join("\nUNION ALL\n");
        const r = await pool.request().input("tid", sql.VarChar(64), guid).query(q);
        for (const row of (r.recordset ?? []) as any[]) {
          const n = Number(row.n) || 0;
          if (n > 0) tableCounts[nameByLower.get(core2Tables[row.i])!] = n;
        }
      }
      // Recompute dataRows from the full scan (may have caught more tables).
      dataRows = Object.entries(tableCounts)
        .filter(([t]) => startOverSet.has(t.toLowerCase()))
        .reduce((a, [, n]) => a + n, 0);
      dbg(`full core2 scan done: dataRows=${dataRows}`);
    }

    // ── Discover per-tenant rows: app DB (accounts, aliases, registry…) ───
    // The app catalog holds rmone_users (credentials) and friends. Our pool's
    // default catalog is core2, so locate the catalog that owns rmone_users
    // instead of hard-coding its name.
    let appDb = "rmoneapp";
    try {
      const dbs = await pool.request().query(`SELECT name FROM sys.databases WHERE database_id > 4`);
      for (const d of (dbs.recordset ?? []) as any[]) {
        const nm = String(d.name);
        if (nm.toLowerCase() === "core2") continue;
        try {
          const probe = await pool.request().query(
            `SELECT COUNT(*) n FROM ${bq(nm)}.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='rmone_users'`);
          if ((probe.recordset[0]?.n ?? 0) > 0) { appDb = nm; break; }
        } catch { /* no access to that catalog — skip */ }
      }
    } catch { /* sys.databases blocked — fall back to the conventional name */ }
    dbg(`app catalog resolved: ${appDb}`);

    // App tables store the tenant as the GUID or the friendly label (raw or
    // normalized) depending on vintage — match every candidate spelling.
    const candidates = [...new Set(
      [guid, rawTid, normTenant(rawTid)].map(s => String(s ?? "").trim().toLowerCase()).filter(Boolean),
    )];
    const candList = candidates.map((_, i) => `@v${i}`).join(",");
    const bindCands = (rq: ReturnType<typeof pool.request>) => {
      candidates.forEach((v, i) => rq.input(`v${i}`, sql.NVarChar, v));
      return rq;
    };
    const appColsR = await pool.request().query(`
      SELECT TABLE_NAME t, COLUMN_NAME c FROM ${bq(appDb)}.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA='dbo'
        AND LOWER(COLUMN_NAME) IN ('tenant_id','tenantid','tenant_key','tenant_guid','tenant')`);
    // A table may carry MORE THAN ONE tenant-ish column (e.g. a GUID tenant_id
    // AND a label tenant_key) — sweep them ALL, OR-combined, or rows keyed only
    // via the second column survive the wipe.
    const appTenantCols = new Map<string, string[]>();
    for (const r of (appColsR.recordset ?? []) as any[]) {
      const t = String(r.t);
      const list = appTenantCols.get(t) ?? [];
      list.push(String(r.c));
      appTenantCols.set(t, list);
    }
    const appFq = (t: string) => `${bq(appDb)}.[dbo].${bq(t)}`;
    const appWhere = (cols: string[]) =>
      cols.map(c => `LOWER(CAST(${bq(c)} AS nvarchar(200))) IN (${candList})`).join(" OR ");
    const appCounts: Record<string, number> = {};
    {
      const appList = [...appTenantCols.entries()];
      for (let i = 0; i < appList.length; i += 40) {
        const chunk = appList.slice(i, i + 40);
        const q = chunk.map(([t, cols], j) => `SELECT ${i + j} i, COUNT(*) n FROM ${appFq(t)} WHERE ${appWhere(cols)}`).join("\nUNION ALL\n");
        const r = await bindCands(pool.request()).query(q);
        for (const row of (r.recordset ?? []) as any[]) {
          if (row.n > 0) appCounts[appList[row.i][0]] = row.n;
        }
      }
    }
    dbg("app counts done — evaluating gates");

    // ── Typed confirmation + snapshot for tenants WITH uploaded data ──────
    let snapshotKey: string | null = null;
    let inviteRows = 0;
    if (dataRows > 0) {
      const confirm = String(req.body?.confirm ?? "").trim();
      const confirmOk = !!confirm && (
        resolveTenantId(confirm) === guid ||
        normTenant(confirm) === normTenant(rawTid) ||
        confirm.toLowerCase() === guid.toLowerCase()
      );
      if (!confirmOk) {
        res.status(400).json({
          error: "confirm_required",
          message: `This company has ${dataRows} data row(s). Type the company name exactly to confirm permanent deletion of ALL its data and user logins.`,
          dataRows,
        });
        return;
      }

      // No row-count cap for superadmin full-tenant deletes — the superadmin
      // is explicitly authorised to wipe any tenant regardless of size.
      // The uncompressed-bytes cap during snapshot streaming is the only
      // hard backstop (a snapshot too large to write safely to S3 aborts
      // before any rows are deleted).
      // Invite tokens have no TenantID column, so the discovery above missed
      // them — count them here so the snapshot covers every row this
      // operation will remove.
      try {
        const r = await bindCands(pool.request()).query(`
          SELECT COUNT(*) n FROM core2.dbo.RMOneInviteTokens
          WHERE LOWER(TenantKey) IN (${candList}) OR LOWER(TenantLabel) IN (${candList})`);
        inviteRows = r.recordset[0]?.n ?? 0;
      } catch { /* table may not exist yet */ }
      // Catalog-prefixed keys: a core2 and an app table with the same name
      // must not overwrite each other in the caps accounting.
      const allCounts: Record<string, number> = {};
      for (const [t, n] of Object.entries(tableCounts)) allCounts[`core2:${t}`] = n;
      for (const [t, n] of Object.entries(appCounts)) allCounts[`app:${t}`] = n;
      if (inviteRows > 0) allCounts["core2:RMOneInviteTokens"] = inviteRows;

      // Snapshot to S3 FIRST (best-effort for large tenants).
      // Snapshot is buffered in memory before upload — very large tenants can
      // exceed available RAM. We stream up to DELETE_MAX_SNAPSHOT_BYTES of
      // uncompressed payload; if that limit is hit we flush whatever we have
      // (a partial snapshot is still useful for recovery) and continue with
      // the delete. snapshotKey stays set so the partial file is retrievable.
      const DELETE_MAX_SNAPSHOT_BYTES = START_OVER_MAX_SNAPSHOT_BYTES; // 250 MB uncompressed
      const { createGzip } = await import("node:zlib");
      const { finished } = await import("node:stream/promises");
      const { uploadFile } = await import("../lib/storage.js");
      snapshotKey = `tenant-delete/${guid}/${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson.gz`;
      const gz = createGzip({ level: 6 });
      const chunks: Buffer[] = [];
      gz.on("data", (c: Buffer) => chunks.push(c));
      const write = (s: string) => new Promise<void>((ok, bad) => { gz.write(s, (e) => (e ? bad(e) : ok())); });
      let snapshotBytes = 0, snapshotTruncated = false;
      await write(JSON.stringify({
        v: 1, kind: "tenant-delete-snapshot", tenantId: guid, tenantLabel: rawTid,
        takenAt: new Date().toISOString(), by: src.userId ?? null, tables: allCounts,
      }) + "\n");
      // Per-table row cap: mssql materialises the full recordset before returning;
      // tables with >50k rows would OOM the worker before the byte-cap can fire.
      // Skip those tables in the snapshot — the counts header still tells us what
      // was there, and deletion still proceeds.
      const SNAPSHOT_MAX_TABLE_ROWS = 50_000;
      const streamRows = async (db: "core2" | "app", label: string, rows: any[]) => {
        for (let i = 0; i < rows.length && !snapshotTruncated; i += 500) {
          const payload = rows.slice(i, i + 500).map(rw => JSON.stringify({ db, t: label, r: rw }) + "\n").join("");
          snapshotBytes += payload.length;
          if (snapshotBytes > DELETE_MAX_SNAPSHOT_BYTES) { snapshotTruncated = true; break; }
          await write(payload);
        }
      };
      for (const lt of core2Tables) {
        const label = nameByLower.get(lt)!;
        const n = tableCounts[label] ?? 0;
        if (!n || snapshotTruncated) continue;
        if (n > SNAPSHOT_MAX_TABLE_ROWS) {
          // Too large to buffer safely — record the skip, counts header already has totals
          await write(JSON.stringify({ kind: "table_skipped", db: "core2", t: label, rows: n, reason: "too_large" }) + "\n");
          continue;
        }
        const rowsR = await pool.request().input("tid", sql.VarChar(64), guid)
          .query(`SELECT * FROM ${fqOf(lt)} WHERE TenantID=@tid`);
        await streamRows("core2", label, rowsR.recordset ?? []);
      }
      if (inviteRows > 0 && !snapshotTruncated) {
        try {
          const rowsR = await bindCands(pool.request()).query(`
            SELECT * FROM core2.dbo.RMOneInviteTokens
            WHERE LOWER(TenantKey) IN (${candList}) OR LOWER(TenantLabel) IN (${candList})`);
          await streamRows("core2", "RMOneInviteTokens", rowsR.recordset ?? []);
        } catch { /* table may not exist yet */ }
      }
      for (const [t, cols] of appTenantCols) {
        const n = appCounts[t] ?? 0;
        if (!n || snapshotTruncated) continue;
        if (n > SNAPSHOT_MAX_TABLE_ROWS) {
          await write(JSON.stringify({ kind: "table_skipped", db: "app", t, rows: n, reason: "too_large" }) + "\n");
          continue;
        }
        const rowsR = await bindCands(pool.request())
          .query(`SELECT * FROM ${appFq(t)} WHERE ${appWhere(cols)}`);
        await streamRows("app", t, rowsR.recordset ?? []);
      }
      if (snapshotTruncated) {
        // Write a truncation marker so anyone reading the snapshot knows it
        // is incomplete. Deletion still proceeds — superadmin confirmed it.
        await write(JSON.stringify({ kind: "truncated", reason: "snapshot_too_large", bytesWritten: snapshotBytes }) + "\n");
        console.warn(`[tenant-delete:${rawTid}] snapshot truncated at ${snapshotBytes} bytes — partial backup saved, proceeding with delete`);
      }
      gz.end();
      await finished(gz);
      await uploadFile(snapshotKey, Buffer.concat(chunks), "application/gzip");
    }

    // ── Delete: core2, multi-pass children→parents for FK stragglers ──────
    // Use a large batch (500k) to minimise round-trips and GC pressure.
    // Don't issue a UNION-ALL count across all 415 tables on each pass —
    // instead track whether any rows were deleted this pass to decide if
    // another pass is needed.
    const DELETE_BATCH = 500_000;
    let deletedThisPass = 1, pass = 0, totalDeleted = 0;
    // Tables whose DELETE failed (FK constraint) in the LAST pass — surfaced
    // in the response when rows survive so the caller can see what's stuck.
    const fkBlocked: string[] = [];
    const withRows = core2Tables.filter(lt => tableCounts[nameByLower.get(lt)!]);
    while (deletedThisPass > 0 && pass < 12 && withRows.length) {
      pass++;
      deletedThisPass = 0;
      fkBlocked.length = 0;
      for (const lt of withRows) {
        try {
          for (;;) {
            const r = await pool.request().input("tid", sql.VarChar(64), guid)
              .query(`DELETE TOP (${DELETE_BATCH}) FROM ${fqOf(lt)} WHERE TenantID = @tid`);
            const n = r.rowsAffected[0] || 0;
            totalDeleted += n;
            deletedThisPass += n;
            if (n < DELETE_BATCH) break;
          }
        } catch {
          // FK constraint — next pass will retry after children are gone.
          fkBlocked.push(nameByLower.get(lt) ?? lt);
        }
      }
      console.log(`[tenant-delete:${rawTid}] pass ${pass} done: ${deletedThisPass} rows this pass, ${totalDeleted} total${fkBlocked.length ? `, blocked: ${fkBlocked.join(",")}` : ""}`);
    }

    // Verified survivor re-count — the loop above exits when a pass deletes 0
    // rows, which is NOT proof of zero survivors (a pass can delete nothing
    // because every remaining table is FK-blocked). Recount only the tables
    // that had rows to begin with; provisioned tenants (withRows empty) skip
    // this entirely. A failed recount counts as "unknown" (-1) → NOT clean.
    let remaining = 0;
    if (withRows.length) {
      try {
        const rc = await pool.request().input("tid", sql.VarChar(64), guid).query(
          withRows.map(lt => `SELECT COUNT(*) n FROM ${fqOf(lt)} WHERE TenantID = @tid`).join("\nUNION ALL\n"));
        remaining = (rc.recordset as any[]).reduce((a, x) => a + x.n, 0);
      } catch { remaining = -1; }
    }

    // Invite tokens are keyed by TenantKey/TenantLabel (no TenantID column),
    // so the sweep above can't catch them.
    let invitesDeleted = 0;
    try {
      const r = await bindCands(pool.request()).query(`
        DELETE FROM core2.dbo.RMOneInviteTokens
        WHERE LOWER(TenantKey) IN (${candList}) OR LOWER(TenantLabel) IN (${candList})`);
      invitesDeleted = r.rowsAffected[0] || 0;
    } catch { /* table may not exist yet */ }

    // ── Bookkeeping helpers (in-memory job state, aliases, review items) ──
    const allRows = await getAllOnboardingJobsMeta();
    const jobIdsToDelete = allRows.filter(r => resolveTenantId(r.tenantId) === guid).map(r => r.uploadId);
    if (jobIdsToDelete.length) {
      await deleteOnboardingJobsBatch(jobIdsToDelete);
    }
    for (const id of jobIdsToDelete) _jobs.delete(id);
    await deleteTenantStatus(guid).catch(() => {});
    if (rawTid !== guid) await deleteTenantStatus(rawTid).catch(() => {});
    await deleteIdentityAliasesByKind(guid, "project").catch(() => {});
    await deleteIdentityAliasesByKind(guid, "person").catch(() => {});
    await dismissAllOpenImportReview(guid, src.userId ?? null).catch(() => {});

    // ── Delete: app DB sweep (accounts/credentials, registry, the rest) ───
    // Multi-pass like core2; helper-managed tables are already empty and
    // simply report 0 here.
    let appDeleted = 0, usersDeleted = 0;
    const appBlocked: string[] = [];
    for (let p = 0; p < 4; p++) {
      appBlocked.length = 0;
      let progressed = false;
      for (const [t, cols] of appTenantCols) {
        try {
          // TOP-batched like the core2 sweep — bounded transactions.
          for (;;) {
            const r = await bindCands(pool.request())
              .query(`DELETE TOP (20000) FROM ${appFq(t)} WHERE ${appWhere(cols)}`);
            const n = r.rowsAffected[0] || 0;
            appDeleted += n;
            if (n > 0) progressed = true;
            if (t.toLowerCase() === "rmone_users") usersDeleted += n;
            if (n < 20000) break;
          }
        } catch {
          appBlocked.push(t);
        }
      }
      if (!appBlocked.length || !progressed) break;
    }

    // ── Every worker drops its caches for this tenant ──────────────────────
    // Skip the IPC fan-out for provisioned (zero-data) tenants — they never
    // had records loaded into any worker cache, so broadcasting 10 bust
    // messages immediately after heavy DB work only adds GC pressure that can
    // crash workers. Data-bearing tenants still get the full bust.
    if (process.send && dataRows > 0) {
      for (const fn of ["records", "resAllocs", "taskData", "weeklyAlloc", "lifecycles", "users", "org", "staffOrg", "stageRules", "accessControl"]) {
        try { process.send({ type: "bustCache", fn, tid: guid, tenant: rawTid }); } catch { /* shutting down */ }
      }
    }
    // Bust the phantom-tenant discovery cache so /history reflects the deletion immediately.
    _core2TenantCache = null;

    // ── Verified-zero gate: never claim success while rows survive ────────
    // core2 `remaining` comes from the sweep's own final recount; recount the
    // app tables that had rows, and the invite tokens, the same way. A failed
    // recount counts as "unknown" (-1) and therefore NOT clean.
    // Skip the re-count for provisioned tenants — they had no data rows so
    // the verify queries would all return 0, and the extra round-trips add
    // latency after the GC-heavy work that precedes them.
    let appRemaining = 0;
    const appHadRows = dataRows > 0
      ? [...appTenantCols.entries()].filter(([t]) => appCounts[t])
      : [];
    if (appHadRows.length) {
      try {
        const rc = await bindCands(pool.request()).query(
          appHadRows.map(([t, cols]) => `SELECT COUNT(*) n FROM ${appFq(t)} WHERE ${appWhere(cols)}`).join("\nUNION ALL\n"));
        appRemaining = (rc.recordset as any[]).reduce((a, x) => a + x.n, 0);
      } catch { appRemaining = -1; }
    }
    let invitesRemaining = 0;
    if (inviteRows > 0) {
      try {
        const rc = await bindCands(pool.request()).query(`
          SELECT COUNT(*) n FROM core2.dbo.RMOneInviteTokens
          WHERE LOWER(TenantKey) IN (${candList}) OR LOWER(TenantLabel) IN (${candList})`);
        invitesRemaining = rc.recordset[0]?.n ?? -1;
      } catch { invitesRemaining = -1; }
    }
    const clean = remaining === 0 && appRemaining === 0 && invitesRemaining === 0;

    console.log(`[tenant-delete] ${rawTid} (${guid}): ${clean ? "OK" : "PARTIAL"} core2=${totalDeleted} app=${appDeleted} (users=${usersDeleted}) invites=${invitesDeleted} jobs=${jobIdsToDelete.length} remaining=${remaining}/${appRemaining}/${invitesRemaining}${snapshotKey ? ` snapshot=${snapshotKey}` : ""} by ${src.userId ?? "?"}`);
    setAuditTarget(res, {
      entityType: "configuration",
      entityId: `tenant:${rawTid || guid}`,
      entityName: rawTid || guid,
      action: "delete.tenant",
    });
    setTrustedAuditChanges(res, boundedAuditChanges([
      { FieldName: "Core rows deleted", OldValue: totalDeleted, NewValue: null },
      { FieldName: "Application rows deleted", OldValue: appDeleted, NewValue: null },
      { FieldName: "Users deleted", OldValue: usersDeleted, NewValue: null },
      { FieldName: "Invites deleted", OldValue: invitesDeleted, NewValue: null },
      { FieldName: "Import jobs removed", OldValue: jobIdsToDelete.length, NewValue: null },
      { FieldName: "Recovery snapshot", OldValue: snapshotKey, NewValue: null },
    ]));
    res.status(clean ? 200 : 500).json({
      ok: clean,
      ...(clean ? {} : {
        error: "partial_delete",
        message: "Deletion incomplete — some rows could not be removed. A recovery snapshot was saved first, so nothing is lost. Try again, or contact support.",
      }),
      tenantId: guid,
      rowsDeleted: totalDeleted,
      appRowsDeleted: appDeleted,
      usersDeleted,
      invitesDeleted,
      jobsRemoved: jobIdsToDelete.length,
      dataRows,
      snapshotKey,
      remaining,
      appRemaining,
      invitesRemaining,
      fkBlocked: remaining > 0 ? fkBlocked : [],
      appBlocked,
    });
  } catch (e: any) {
    res.status(500).json({ error: "delete_failed", detail: String(e?.message ?? e).slice(0, 300) });
  } finally {
    await lease.release().catch(() => {});
  }
});

// ── POST /api/onboarding/tenant/start-over ────────────────────────────────
// Company-admin "start over": permanently removes the tenant's UPLOADED DATA
// (projects, opportunities, leads, client companies/contacts, assignments,
// allocations, schedule/task rows) so imports can begin from a clean slate,
// while KEEPING people/logins, access levels, org structure (business units,
// divisions, departments, job titles, roles/rates) and every setting.
// Safety rails, in order:
//   1. Admin gate (superadmins may target another tenant via body.tenantId).
//   2. Typed confirmation: body.confirm must equal the company name.
//   3. Tenant import lease + live-run check — a running import blocks the
//      wipe (409), and the lease blocks a new import starting mid-wipe.
//   4. Full JSON snapshot (NDJSON.gz) of every row about to be removed is
//      written to S3 FIRST — no snapshot, no wipe. Outsized tenants are
//      refused rather than risking the server.
// Remembered project aliases and open "needs attention" items are cleared —
// their targets no longer exist. Person aliases, import history, and saved
// column mappings survive. Unlike /tenant/delete this is NOT superadmin-only
// and never touches org/config tables or user accounts.
const START_OVER_TABLES: readonly string[] = [
  // children first so the multi-pass FK loop converges quickly.
  // NOTE: lifecycle pointers need no entry here — ProjectLifeCycleLookup is a
  // COLUMN on PMM/Opportunity (template id), so it dies with the record rows,
  // and the lifecycle templates themselves are settings that survive.
  "TicketHours", "ResourceTimeSheet",
  "ResourceAllocation", "ResourceWorkItems",
  "ModuleTasks", "PMMTasks",
  "PMM", "Opportunity", "Lead",
  "CRMContact", "CRMCompany",
];
const START_OVER_MAX_TABLE_ROWS = 100_000;
const START_OVER_MAX_TOTAL_ROWS = 400_000;
// Hard uncompressed-byte gate for the snapshot: row COUNTS don't bound row
// SIZE (MAX/text columns), and the snapshot must never OOM the worker. Hit
// during snapshot ⇒ abort BEFORE any delete (snapshot-first ordering).
const START_OVER_MAX_SNAPSHOT_BYTES = 250_000_000;

router.post("/tenant/start-over", async (req: Request, res: Response) => {
  const bodyTenant = typeof req.body?.tenantId === "string" && req.body.tenantId.trim() ? req.body.tenantId.trim() : null;
  const src = await requireTenantAdmin(req, res, bodyTenant);
  if (!src) return;
  const label = String(bodyTenant ?? src.tenant ?? "").trim();
  if (!label) { res.status(400).json({ error: "tenantId is required" }); return; }
  const guid = resolveTenantId(label);
  if (guid === TEMPLATE_TENANT_ID || normTenant(label) === normTenant("rmone")) {
    res.status(400).json({ error: "refusing to reset the template or superadmin tenant" });
    return;
  }
  const confirm = String(req.body?.confirm ?? "");
  if (!confirm.trim() || normTenant(confirm) !== normTenant(label)) {
    res.status(400).json({ error: "confirm_mismatch", message: `Type the company name exactly ("${label}") to confirm.` });
    return;
  }

  const { acquireTenantImportLease, hasActiveOnboardingRun, deleteIdentityAliasesByKind, dismissAllOpenImportReview } =
    await import("@workspace/db");
  const lease = await acquireTenantImportLease(label, 5_000).catch(() => null);
  if (!lease) {
    res.status(409).json({ error: "busy", message: "An import is running for this company right now — wait for it to finish, then try again." });
    return;
  }
  try {
    let liveRun = true;
    try { liveRun = await hasActiveOnboardingRun(label); } catch { /* fail closed */ }
    if (liveRun) {
      res.status(409).json({ error: "busy", message: "An import is running for this company right now — wait for it to finish, then try again." });
      return;
    }

    const pool = await getPool();
    // Which data tables exist with a TenantID column (mirrors /tenant/delete;
    // anything lacking the column is reported, never silently skipped).
    const colsR = await pool.request().query(`
      SELECT TABLE_SCHEMA s, TABLE_NAME t FROM core2.INFORMATION_SCHEMA.COLUMNS
      WHERE LOWER(COLUMN_NAME)='tenantid'`);
    const schemaByTable = new Map<string, string>(
      (colsR.recordset ?? []).map((r: any) => [String(r.t).toLowerCase(), r.s]),
    );
    const scoped = START_OVER_TABLES.filter(t => schemaByTable.has(t.toLowerCase()));
    const noTenantColumn = START_OVER_TABLES.filter(t => !schemaByTable.has(t.toLowerCase()));
    const fqOf = (t: string) => `[core2].[${schemaByTable.get(t.toLowerCase())}].[${t}]`;

    // Preflight counts — size gate before any work. VarChar params on purpose:
    // core2 TenantID columns are varchar and an NVarChar param would force a
    // column-side conversion (scans + lock timeouts).
    const tableCounts: Record<string, number> = {};
    let totalRows = 0;
    for (const t of scoped) {
      const r = await pool.request().input("tid", sql.VarChar(64), guid)
        .query(`SELECT COUNT(*) n FROM ${fqOf(t)} WHERE TenantID=@tid`);
      const n = r.recordset[0]?.n ?? 0;
      tableCounts[t] = n;
      totalRows += n;
    }
    if (totalRows > START_OVER_MAX_TOTAL_ROWS || Object.values(tableCounts).some(n => n > START_OVER_MAX_TABLE_ROWS)) {
      res.status(413).json({ error: "tenant_too_large", message: "This company has too much data for self-service start-over — please contact support.", tables: tableCounts });
      return;
    }

    // Snapshot to S3 FIRST — any failure here aborts the wipe.
    const { createGzip } = await import("node:zlib");
    const { finished } = await import("node:stream/promises");
    const { uploadFile } = await import("../lib/storage.js");
    const snapshotKey = `start-over/${guid}/${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson.gz`;
    {
      // Memory profile: one table's recordset at a time (row caps above bound
      // it), NDJSON written into gzip in slices (never one giant string), and
      // only the COMPRESSED bytes are buffered for upload. A running
      // uncompressed-byte counter aborts oversized tenants before any delete.
      const gz = createGzip({ level: 6 });
      const chunks: Buffer[] = [];
      gz.on("data", (c: Buffer) => chunks.push(c));
      const write = (s: string) => new Promise<void>((ok, bad) => { gz.write(s, (e) => (e ? bad(e) : ok())); });
      let sBytes = 0;
      await write(JSON.stringify({
        v: 1, kind: "start-over-snapshot", tenantId: guid, tenantLabel: label,
        takenAt: new Date().toISOString(), by: src.userId ?? null, tables: tableCounts,
      }) + "\n");
      let tooBig = false;
      for (const t of scoped) {
        if (!tableCounts[t]) continue;
        const rowsR = await pool.request().input("tid", sql.VarChar(64), guid)
          .query(`SELECT * FROM ${fqOf(t)} WHERE TenantID=@tid`);
        const rows: any[] = rowsR.recordset ?? [];
        for (let i = 0; i < rows.length && !tooBig; i += 500) {
          const payload = rows.slice(i, i + 500).map(rw => JSON.stringify({ t, r: rw }) + "\n").join("");
          sBytes += payload.length;
          if (sBytes > START_OVER_MAX_SNAPSHOT_BYTES) { tooBig = true; break; }
          await write(payload);
        }
        if (tooBig) break;
      }
      if (tooBig) {
        gz.destroy();
        res.status(413).json({ error: "tenant_too_large", message: "This company's data is too large for self-service start-over — please contact support.", tables: tableCounts });
        return;
      }
      gz.end();
      await finished(gz);
      await uploadFile(snapshotKey, Buffer.concat(chunks), "application/gzip");
    }

    // Hard delete, children→parents, multi-pass to clear FK stragglers
    // (same convergence loop as /tenant/delete).
    let remaining = 1, pass = 0, totalDeleted = 0;
    const fkBlocked: string[] = [];
    while (remaining > 0 && pass < 8) {
      pass++;
      fkBlocked.length = 0;
      for (const t of scoped) {
        try {
          const r = await pool.request().input("tid", sql.VarChar(64), guid)
            .query(`DELETE FROM ${fqOf(t)} WHERE TenantID = @tid`);
          totalDeleted += r.rowsAffected[0] || 0;
        } catch {
          fkBlocked.push(t);
        }
      }
      const rc = await pool.request().input("tid", sql.VarChar(64), guid)
        .query(scoped.map(t => `SELECT COUNT(*) n FROM ${fqOf(t)} WHERE TenantID=@tid`).join("\nUNION ALL\n"));
      remaining = (rc.recordset as any[]).reduce((a, x) => a + x.n, 0);
    }

    // Every worker drops its data caches for this tenant — even on a partial
    // wipe (stale caches over half-deleted data would be worse). Lifecycle
    // TEMPLATES are kept, but per-record pointers died with the records, so
    // that cache goes too.
    if (process.send) {
      for (const fn of ["records", "resAllocs", "taskData", "weeklyAlloc", "lifecycles"]) {
        try { process.send({ type: "bustCache", fn, tid: guid }); } catch { /* shutting down */ }
      }
    }

    if (remaining > 0) {
      // FK-blocked rows survived every pass: this is a PARTIAL wipe. Keep the
      // project aliases and review items (their targets may still exist) and
      // fail loudly — never report a clean reset that didn't happen. The
      // snapshot has everything support needs.
      console.warn(`[start-over] ${label} (${guid}): INCOMPLETE — ${remaining} rows survived (${fkBlocked.join(", ") || "unknown tables"}), removed ${totalDeleted}, snapshot ${snapshotKey}`);
      setAuditTarget(res, { entityType: "configuration", entityId: `tenant:${label || guid}`, entityName: label || guid, action: "update.tenant" });
      setTrustedAuditChanges(res, boundedAuditChanges([
        { FieldName: "Rows deleted", OldValue: totalDeleted, NewValue: null },
        { FieldName: "Rows remaining", OldValue: null, NewValue: remaining },
        { FieldName: "Recovery snapshot", OldValue: null, NewValue: snapshotKey },
      ]));
      res.status(500).json({
        error: "incomplete",
        message: `Some rows could not be removed (${remaining} left) — nothing else was changed. Please contact support and mention snapshot ${snapshotKey}.`,
        rowsDeleted: totalDeleted,
        tables: tableCounts,
        snapshotKey,
        remaining,
        fkBlocked,
      });
      return;
    }

    // Import memory tied to the wiped records: project aliases would silently
    // redirect future uploads to dead TicketIds, and open review items hold
    // suggestions against rows that no longer exist. Person aliases stay.
    const aliasesCleared = await deleteIdentityAliasesByKind(guid, "project").catch(() => -1);
    const reviewDismissed = await dismissAllOpenImportReview(guid, src.userId ?? null).catch(() => -1);

    console.log(`[start-over] ${label} (${guid}): ${totalDeleted} rows removed, snapshot ${snapshotKey}, aliases ${aliasesCleared}, review ${reviewDismissed}, by ${src.userId ?? "?"}`);
    setAuditTarget(res, { entityType: "configuration", entityId: `tenant:${label || guid}`, entityName: label || guid, action: "update.tenant" });
    setTrustedAuditChanges(res, boundedAuditChanges([
      { FieldName: "Rows deleted", OldValue: totalDeleted, NewValue: null },
      { FieldName: "Project aliases cleared", OldValue: aliasesCleared, NewValue: null },
      { FieldName: "Review items dismissed", OldValue: reviewDismissed, NewValue: null },
      { FieldName: "Recovery snapshot", OldValue: null, NewValue: snapshotKey },
    ]));
    res.json({
      ok: true,
      tenantId: guid,
      rowsDeleted: totalDeleted,
      tables: tableCounts,
      snapshotKey,
      aliasesCleared,
      reviewDismissed,
      remaining: 0,
      fkBlocked: [],
      noTenantColumn,
    });
  } catch (e: any) {
    res.status(500).json({ error: "start_over_failed", detail: String(e?.message ?? e).slice(0, 300) });
  } finally {
    await lease.release().catch(() => {});
  }
});

// ── GET /api/onboarding/check-tenant ─────────────────────────────────────
// Returns whether a company name is still available (not already onboarded).
router.get("/check-tenant", async (req: Request, res: Response) => {
  // Requires a valid login (any tenant) — availability of a company name is
  // not sensitive per se, but unauthenticated probing of job history is.
  if (!requireTenantAccess(req, res)) return;
  const raw = String(req.query.tenantId ?? "").trim();
  if (!raw) return res.json({ available: false, reason: "empty" });

  // 1. Check our Postgres jobs table (covers imports + provisioned sentinel rows).
  const conflict = await findTenantConflict(raw);
  if (conflict) {
    return res.json({
      available: false,
      conflict: { status: conflict.status, fileName: conflict.fileName, createdAt: conflict.createdAt, uploadId: conflict.uploadId },
    });
  }

  // 2. Fall through to the live-data probe (Postgres users + core2 record
  //    tables) — catches tenants provisioned or populated outside the wizard,
  //    keeping this check consistent with the upload/run enforcement points.
  try {
    if (await tenantHasDataProbe(raw)) {
      return res.json({ available: false, conflict: { status: "provisioned" } });
    }
  } catch {
    // DB unreachable — fail open (don't block the form on a connectivity blip)
  }

  res.json({ available: true });
  return;
});

// ── GET /api/onboarding/verify/:id ───────────────────────────────────────
// Live count query against the SQL Server — accepts either uploadId (in-memory job)
// or ?tenantId=xxx directly (works even after server restarts)
router.get("/verify/:id", async (req: Request, res: Response) => {
  const verifySrc = requireTenantAccess(req, res);
  if (!verifySrc) return;
  const job = _jobs.get(String(req.params.id));
  const tidFromQuery = req.query.tenantId as string | undefined;
  const rawTid = effectiveTenant(verifySrc, tidFromQuery ?? job?.tenantId);
  if (!rawTid) return res.status(404).json({ error: "Job not found and no tenantId provided" });
  // Rows are stored under the resolved GUID, not the friendly label — resolve it
  // the same way the pipeline does, or counts come back as all-zeros.
  const tid = resolveTenantId(rawTid);
  try {
    const pool = await getPool();

    const tables: { label: string; query: string }[] = [
      { label: "Team Members",           query: `` }, // counted from Postgres below
      { label: "Divisions",              query: `SELECT COUNT(*) AS n FROM core2.dbo.CompanyDivisions  WHERE TenantID=@tid AND Deleted=0` },
      { label: "Departments",            query: `SELECT COUNT(*) AS n FROM core2.dbo.Department        WHERE TenantID=@tid AND Deleted=0` },
      { label: "Roles",                  query: `SELECT COUNT(*) AS n FROM core2.dbo.Roles             WHERE TenantID=@tid` },
      { label: "Job Titles",             query: `SELECT COUNT(*) AS n FROM core2.dbo.Jobtitle          WHERE TenantID=@tid AND Deleted=0` },
      { label: "Client Companies",       query: `SELECT COUNT(*) AS n FROM core2.dbo.CRMCompany        WHERE TenantID=@tid AND Deleted=0` },
      { label: "Client Contacts",        query: `SELECT COUNT(*) AS n FROM core2.dbo.CRMContact        WHERE TenantID=@tid AND Deleted=0` },
      { label: "Projects (PMM)",         query: `SELECT COUNT(*) AS n FROM core2.dbo.PMM               WHERE TenantID=@tid AND Deleted=0` },
      { label: "Opportunities",          query: `SELECT COUNT(*) AS n FROM core2.dbo.Opportunity       WHERE TenantID=@tid AND Deleted=0` },
      { label: "Resource-Project Links", query: `SELECT COUNT(*) AS n FROM core2.dbo.ResourceWorkItems WHERE TenantID=@tid AND Deleted=0` },
      { label: "Allocations",            query: `SELECT COUNT(*) AS n FROM core2.dbo.ResourceAllocation WHERE TenantID=@tid AND Deleted=0` },
    ];

    const counts: { label: string; count: number }[] = [];
    // Team Members counted from Postgres (source of truth for users).
    try {
      const pgTeamMembers = await getActiveUsersByTenant(tid);
      counts.push({ label: "Team Members", count: pgTeamMembers.length });
    } catch {
      counts.push({ label: "Team Members", count: -1 });
    }
    for (const t of tables) {
      if (!t.query) continue; // skip placeholder rows
      try {
        const r = await pool.request().input("tid", sql.NVarChar, tid).query(t.query);
        counts.push({ label: t.label, count: r.recordset[0]?.n ?? 0 });
      } catch {
        counts.push({ label: t.label, count: -1 });
      }
    }
    res.json({ tenantId: tid, counts });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── GET /api/onboarding/verify/:id/rows ──────────────────────────────────
// Returns actual rows for a given table + tenant (for popup drill-down)
// `display` (when present) limits the drill-down popup to a curated set of
// human-readable columns instead of dumping all 100+ columns (mostly null).
// Order is preserved as listed. Tables without `display` show all columns.
const ALLOWED_TABLES: Record<string, { sqlTable: string; exclude?: string[]; display?: string[] }> = {
  AspNetUsers:        { sqlTable: "AspNetUsers",        exclude: ["PasswordHash","SecurityStamp"],
                        display: ["Name","Email","UserName","EmployeeId","Designation","CurrentJobTitle","HourlyRate","IsManager","IsConsultant","Enabled"] },
  CompanyDivisions:   { sqlTable: "CompanyDivisions" },
  Department:         { sqlTable: "Department" },
  Roles:              { sqlTable: "Roles" },
  Jobtitle:           { sqlTable: "Jobtitle" },
  CRMCompany:         { sqlTable: "CRMCompany",
                        display: ["Title","LegalName","ShortName","EmailAddress","Telephone","City","State","Country","WebsiteUrl"] },
  CRMContact:         { sqlTable: "CRMContact",
                        display: ["FirstName","LastName","EmailAddress","SecondaryEmail","Mobile","Telephone","Title","City","State","Country"] },
  PMM:                { sqlTable: "PMM",
                        display: ["TicketId","Title","Status","SectorChoice","ApproxContractValue","ContractLimit","ProjectCost","City","TargetStartDate","TargetCompletionDate","PctComplete"] },
  Opportunity:        { sqlTable: "Opportunity",
                        display: ["TicketId","Title","Status","ChanceOfSuccessChoice","ApproxContractValue","ProposalAmount","BidAmount","City","BidDueDate","TargetStartDate","TargetCompletionDate"] },
  ResourceWorkItems:  { sqlTable: "ResourceWorkItems",
                        display: ["ResourceUser","WorkItem","WorkItemType","SubWorkItem","Title","StartDate","EndDate","JobTitleLookup","DivisionLookup"] },
  ResourceAllocation: { sqlTable: "ResourceAllocation",
                        display: ["TicketId","ResourceUser","AllocationStartDate","AllocationEndDate","PctAllocation","AllocationHour","BillingRate","CostRate","JobTitleLookup"] },
};

router.get("/verify/:id/rows", async (req: Request, res: Response) => {
  const rowsSrc = requireTenantAccess(req, res);
  if (!rowsSrc) return;
  const rawTid = effectiveTenant(rowsSrc, (req.query.tenantId as string) ?? _jobs.get(String(req.params.id))?.tenantId);
  const table = req.query.table as string;
  const limit = Math.min(parseInt(req.query.limit as string ?? "200", 10), 500);

  if (!rawTid) return res.status(400).json({ error: "tenantId is required" });
  // Rows are stored under the resolved GUID, not the friendly label.
  const tid = resolveTenantId(rawTid);
  if (!table || !ALLOWED_TABLES[table])
    return res.status(400).json({ error: `Unknown table '${table}'` });

  const { sqlTable, exclude = [], display } = ALLOWED_TABLES[table];
  try {
    const pool = await getPool();
    const hasDel = !["Roles"].includes(table);
    const whereClause = hasDel
      ? `WHERE TenantID=@tid AND Deleted=0`
      : `WHERE TenantID=@tid`;
    const result = await pool.request()
      .input("tid", sql.NVarChar, tid)
      .query(`SELECT TOP ${limit} * FROM core2.dbo.[${sqlTable}] ${whereClause} ORDER BY ID DESC`);

    // When a curated `display` list is set, only keep those columns that
    // actually exist in the live schema; otherwise keep all (minus exclude).
    // `recordset.columns` is populated from result metadata even when 0 rows.
    const present = new Set(Object.keys(result.recordset.columns ?? {}));
    let keep = display
      ? display.filter(c => present.has(c) && !exclude.includes(c))
      : null;
    // Safety net: if a curated list resolves to too few real columns (schema
    // drift, renamed fields), fall back to showing all columns rather than an
    // almost-empty popup.
    if (keep && keep.length < 3) keep = null;

    const rows = result.recordset.map(row => {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        if (exclude.includes(k)) continue;
        if (keep && !keep.includes(k)) continue;
        clean[k] = v;
      }
      return clean;
    });

    const columns = keep
      ? keep
      : rows.length > 0
      ? Object.keys(rows[0]).filter(k => !exclude.includes(k))
      : [];

    res.json({ table: sqlTable, tenantId: tid, columns, rows, total: rows.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
  return;
});

// ── GET /api/onboarding/file/:id — download the original uploaded file ───
// Access is checked on cheap METADATA first: the blob pull is a multi-second
// 50+ MB fetch from the remote DB for big uploads, and an unauthorized caller
// must never be able to trigger that cost. The bytes then come either from
// this worker's in-memory copy (job ran here recently) or straight from SQL
// Server decoded to binary server-side (getOnboardingJobFileBin — ~30% less
// wire traffic than pulling the base64 text and decoding in Node). The blob
// is deliberately NOT back-filled into _jobs: a 100+ MB base64 string per
// viewed file across 2 workers is heap we don't need — the browser caches
// the downloaded file in IndexedDB, so repeat views skip the server anyway.
router.get("/file/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const meta = _jobs.get(id) ?? await loadJobFromDb(id, { metaOnly: true });
  if (!meta) return res.status(404).json({ error: "Upload not found" });
  if (!requireTenantAccess(req, res, meta.tenantId)) return;
  const cached = _jobs.get(id)?.fileData;
  let buf: Buffer | null = null;
  if (cached) {
    buf = Buffer.from(cached, "base64");
  } else if (meta.s3Key) {
    // Newer uploads are stored in S3 — the in-memory fileData is dropped after
    // the first persist. Fetch straight from S3; fall through to the SQL blob
    // only if S3 fails (e.g. migration window for very old jobs).
    try { buf = await readFileBuffer(meta.s3Key); } catch (e) {
      console.warn(`[onboarding] /file/${id}: S3 fetch failed (${String(e).slice(0, 120)}), trying SQL blob`);
    }
  }
  if (!buf || buf.length === 0) {
    // Historical uploads (pre-S3) stored the raw file as a base64 blob in SQL.
    buf = await getOnboardingJobFileBin(id);
  }
  if (!buf || buf.length === 0) return res.status(404).json({ error: "Original file not stored for this upload" });
  const safeName = (meta.fileName ?? `upload-${id}.xlsx`).replace(/[^\w\s.\-]/g, "_");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  res.setHeader("Content-Length", String(buf.length));
  return res.send(buf);
});

router.get("/errors/:id", (req: Request, res: Response) => {
  const job = _jobs.get(String(req.params.id));
  if (!job) return res.status(404).json({ error: "Not found" });
  if (!requireTenantAccess(req, res, job.tenantId)) return;
  const errors = job.result?.errors ?? [];
  if (req.query.format === "csv") {
    const header = "table,rowIndex,column,message\n";
    const rows = errors.map((e: any) =>
      `"${e.table}",${e.rowIndex},"${e.column ?? ""}","${e.message.replace(/"/g, "'")}"`
    ).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="errors-${job.uploadId}.csv"`);
    return res.send(header + rows);
  }
  res.json({ uploadId: job.uploadId, errors, total: errors.length });
  return;
});

// ── POST /api/onboarding/setup-schema ────────────────────────────────────
router.post("/setup-schema", async (req: Request, res: Response) => {
  const src = resolveRequestSource(req);
  if (!src || !isSuperAdminSource(src)) {
    res.status(403).json({ error: "Superadmin access required" });
    return;
  }
  try {
    const result = await setupSchema();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/onboarding/gap-template ─────────────────────────────────────
// Downloads a fill template for the requested gap.
// - field gaps  (gapId="field:…"): re-parses the uploaded file and pre-fills
//   existing rows; highlights only the missing column in yellow.
// - module gaps (gapId="module:…"): full template columns + italic sample rows.

// Slim essential-only column sets per module-gap type.
// Only the fields a brand-new user needs — no Job IDs, service types, categories, etc.
interface GapColumn { header: string; key: string; width: number; hint?: string }
const GAP_ESSENTIAL_COLUMNS: Record<string, GapColumn[]> = {
  "module:team": [
    { header: "Full Name",    key: "FullName",               hint: "★ Full name of the team member (e.g. James Okafor)",              width: 24 },
    { header: "Login Email",  key: "UserName",               hint: "★ Login email — used as the RM ONE account (e.g. j.o@sample-demo-co.com)", width: 30 },
    { header: "Phone Number", key: "PhoneNumber",            hint: "Phone / mobile number (optional)",                                width: 18 },
    { header: "Business Unit",key: "CRMBusinessUnitChoice",  hint: "Top-level business unit (e.g. Buildings, Infrastructure)",        width: 24 },
    { header: "Division",     key: "Division",               hint: "Division or practice area (e.g. Architecture, Engineering)",      width: 24 },
    { header: "Department",   key: "Department",             hint: "Sub-department within division (e.g. Design, Structural)",       width: 24 },
    { header: "Role",         key: "Role",                   hint: "Staff role (e.g. Senior Architect, Project Manager)",            width: 22 },
    { header: "Job Title",    key: "JobTitle",               hint: "Job title (e.g. Lead Architect, Engineer II)",                   width: 22 },
    { header: "Manager",      key: "Manager",                hint: "Manager's Login Email — who this person reports to (optional)",  width: 28 },
    { header: "Access Level", key: "UserRole",               hint: "admin / manager / user",                                        width: 14 },
    { header: "Start Date",   key: "StartDate",              hint: "YYYY-MM-DD — hire / join date",                                 width: 14 },
    { header: "End Date",     key: "EndDate",                hint: "YYYY-MM-DD — leave blank for permanent staff (optional)",        width: 14 },
    { header: "Groups",       key: "Groups",                 hint: "User groups separated by ; (e.g. PMO; Directors) — new names are created automatically (optional)", width: 26 },
  ],
  "module:clients": [
    { header: "Company Name",           key: "CompanyName",           width: 26, hint: "★ Client / owner company name (e.g. City General Hospital)" },
    { header: "Project Title",          key: "ProjectTitle",          width: 34, hint: "★ Full project name (e.g. Surgical Wing Expansion)" },
    { header: "Market Sector",          key: "MarketSector",          width: 20, hint: "e.g. Transportation, Healthcare, Education, Real Estate" },
    { header: "Business Unit",          key: "CRMBusinessUnitChoice", width: 22, hint: "e.g. Buildings, Infrastructure, Civil & Transit" },
    { header: "Division",               key: "Division",              width: 20, hint: "e.g. Architecture, Engineering, Commercial" },
    { header: "Department",             key: "Department",            width: 18, hint: "e.g. Design, Structural, Airside" },
    { header: "Status",                 key: "Status",                width: 16, hint: "Active / On Hold / Complete / Pending / Cancelled" },
    { header: "Contract Type",          key: "ContractType",          width: 16, hint: "GMP / Lump Sum / Cost Plus / Fixed Fee / T&M / IDIQ" },
    { header: "Priority",               key: "Priority",              width: 12, hint: "Low / Medium / High / Critical" },
    { header: "Start Date",             key: "StartDate",             width: 14, hint: "YYYY-MM-DD" },
    { header: "End Date",               key: "EndDate",               width: 14, hint: "YYYY-MM-DD" },
    { header: "Contract Value",         key: "ContractValue",         width: 18, hint: "Number only — no $ signs (e.g. 4850000)" },
    { header: "Labor Budget",           key: "LaborBudget",           width: 16, hint: "Labor portion of contract — number only" },
    { header: "Description",            key: "Description",           width: 40, hint: "Brief scope summary (optional)" },
  ],
  "module:opportunities": [
    { header: "Opportunity Title",      key: "ProjectTitle",               width: 34, hint: "★ Full opportunity name (e.g. Harbor District Mixed-Use)" },
    { header: "Company Name",           key: "CompanyName",                width: 26, hint: "★ Client / prospect company" },
    { header: "Contact Name",           key: "ContactName",                width: 22, hint: "Primary client contact (optional)" },
    { header: "Market Sector",          key: "MarketSector",               width: 20, hint: "e.g. Real Estate, Aviation, Education, Technology" },
    { header: "Stage",                  key: "CRMOpportunityStageChoice",  width: 18, hint: "Prospecting / Qualifying / Proposal / Negotiation / Awarded / Lost" },
    { header: "Status",                 key: "Status",                     width: 16, hint: "Active / On Hold / Closed" },
    { header: "Chance of Success (%)",  key: "ChanceOfSuccessChoice",      width: 22, hint: "0–100 — estimated probability of winning" },
    { header: "Business Unit",          key: "CRMBusinessUnitChoice",      width: 22, hint: "e.g. Buildings, Civil & Transit, Higher Education" },
    { header: "Division",               key: "Division",                   width: 20, hint: "e.g. Architecture, Engineering, Interiors" },
    { header: "Contract Type",          key: "ContractType",               width: 16, hint: "GMP / Fixed / Cost-Plus / T&M" },
    { header: "Target Start",           key: "TargetStartDate",            width: 14, hint: "YYYY-MM-DD — expected project start if won" },
    { header: "Target End",             key: "TargetCompletionDate",       width: 14, hint: "YYYY-MM-DD — expected project end if won" },
    { header: "Approx Contract Value",  key: "ContractValue",              width: 22, hint: "Rough value estimate — number only (e.g. 31500000)" },
    { header: "% Complete",             key: "ProjectPhasePctComplete",    width: 14, hint: "Progress % of the current phase — number only, e.g. 45 (optional)" },
    { header: "Description",            key: "Description",                width: 40, hint: "Opportunity scope notes (optional)" },
  ],
  "module:leads": [
    { header: "Lead Name",           key: "ProjectTitle",               hint: "★ Name of the lead / early-stage inquiry",                              width: 36 },
    { header: "Company Name",        key: "CompanyName",                hint: "★ Prospect company name",                                               width: 28 },
    { header: "Contact Name",        key: "ContactName",                hint: "Client contact (optional)",                                             width: 24 },
    { header: "Stage",               key: "CRMOpportunityStatusChoice", hint: "★ Prospecting / Qualifying / Proposal / Negotiation",                   width: 18 },
    { header: "Status",              key: "Status",                     hint: "Active / On Hold (optional)",                                           width: 14 },
    { header: "Market Sector",       key: "MarketSector",               hint: "e.g. Transportation, Healthcare (optional)",                            width: 20 },
    { header: "Business Unit",       key: "CRMBusinessUnitChoice",      hint: "Business unit pursuing this lead (optional)",                           width: 22 },
    { header: "Division",            key: "Division",                   hint: "Division managing this lead (optional)",                                width: 22 },
    { header: "Department",          key: "Department",                 hint: "Department within the division (optional)",                             width: 22 },
    { header: "Bid Due Date",        key: "BidDueDate",                 hint: "YYYY-MM-DD — date the bid or proposal must be submitted (optional)",    width: 14 },
    { header: "Forecast Start",      key: "StartDate",                  hint: "YYYY-MM-DD — expected project start if this lead is won (optional)",    width: 14 },
    { header: "Forecast End",        key: "EndDate",                    hint: "YYYY-MM-DD — expected project end if this lead is won (optional)",      width: 14 },
    { header: "Est. Contract Value", key: "ContractValue",              hint: "Rough value estimate — number only, no $ signs (optional)",             width: 18 },
    { header: "Description",         key: "Description",                hint: "Lead summary / scope notes (optional)",                                 width: 36 },
  ],
  "module:assignments": [
    { header: "Project",         key: "Project",             width: 34 },
    { header: "Team Member",     key: "Resource",            width: 30 },
    { header: "Employee ID",     key: "EmployeeId",          hint: "Optional — matches the person when the email/name doesn't (case and hyphens ignored)", width: 14 },
    { header: "Start Date",      key: "AllocationStartDate", width: 14 },
    { header: "End Date",        key: "AllocationEndDate",   width: 14 },
    { header: "Total Hours",     key: "AllocationHour",      width: 14 },
    { header: "Soft Allocation", key: "SoftAllocation",      hint: "TRUE/FALSE or 1/0 — TRUE = tentative (pencilled-in) booking (optional)",               width: 15 },
    { header: "Non Chargeable",  key: "NonChargeable",       hint: "TRUE/FALSE or 1/0 — TRUE = hours are not billable (optional)",                        width: 15 },
    { header: "Is Locked",       key: "IsLocked",            hint: "TRUE/FALSE or 1/0 — TRUE = protected from re-imports and schedule moves (optional)",  width: 12 },
  ],
  "module:demand": [
    { header: "Division",     key: "Division",            width: 24 },
    { header: "Department",   key: "Department",          width: 24 },
    { header: "Role",         key: "Role",                width: 22 },
    { header: "Project",      key: "Project",             width: 34 },
    { header: "Start Date",   key: "AllocationStartDate", width: 14 },
    { header: "End Date",     key: "AllocationEndDate",   width: 14 },
    { header: "Total Hours",  key: "AllocationHour",      width: 14 },
  ],
  "module:companies": [
    { header: "Company Name",     key: "CompanyName",       hint: "★ Client / prospect company name",                                       width: 30 },
    { header: "Company ID",       key: "CompanyId",         hint: "Existing Company ID (e.g. COM-26-000123) — leave blank for new companies (assigned automatically)", width: 20 },
    { header: "Abbreviated Name", key: "ShortName",         hint: "Short display name / abbreviation (optional)",                           width: 20 },
    { header: "Relationship Type", key: "RelationshipType", hint: "e.g. Client, Prospect, Partner, Vendor, Subcontractor (optional)",       width: 20 },
    { header: "Business Type",    key: "BusinessType",      hint: "Primary business type, e.g. General Contractor, Architect, Owner / Developer (optional)", width: 22 },
    { header: "Secondary Business Type", key: "SecondaryBusinessType", hint: "Secondary business type, if any (optional)",                  width: 24 },
    { header: "Industry",         key: "MarketSector",      hint: "e.g. Real Estate, Infrastructure, Government (optional)",                width: 22 },
    { header: "CRM Health",       key: "CRMHealth",         hint: "Relationship health: Good / At Risk / Poor (optional)",                  width: 14 },
    { header: "Contact Name",     key: "ContactName",       hint: "Primary contact full name (optional)",                                   width: 24 },
    { header: "Contact Email",    key: "ContactEmail",      hint: "Contact email address (optional)",                                       width: 30 },
    { header: "Contact Title",    key: "ContactTitle",      hint: "Contact's job title, e.g. Director of Capital Projects (optional)",      width: 26 },
    { header: "Phone",            key: "Phone",             hint: "Company main phone number (optional)",                                   width: 18 },
    { header: "Fax",              key: "Fax",               hint: "Company fax number (optional)",                                          width: 16 },
    { header: "Address",          key: "Address1",          hint: "Street address (optional)",                                              width: 28 },
    { header: "Street 2",         key: "Address2",          hint: "Suite / floor / unit (optional)",                                        width: 20 },
    { header: "City",             key: "City",              hint: "City (optional)",                                                        width: 18 },
    { header: "State",            key: "State",             hint: "State or province (optional)",                                           width: 12 },
    { header: "Zip",              key: "Zip",               hint: "ZIP / postal code (optional)",                                           width: 12 },
    { header: "Assigned To",      key: "OwnerUser",         hint: "Person at your firm this company is assigned to (optional)",             width: 22 },
    { header: "Client Rep",       key: "ClientRep",         hint: "Your firm's relationship owner / account manager for this company",      width: 24 },
    { header: "Division",         key: "Division",          hint: "Division that manages this client relationship (optional)",              width: 22 },
    { header: "Description",      key: "Description",       hint: "Notes about this company (optional)",                                    width: 32 },
  ],
};

// Which column is "missing" for each field gap
const GAP_MISSING_COL: Record<string, { header: string; hint: string; width: number }> = {
  "field:team:login-email":       { header: "Login Email",    hint: "★ Login email — used as the RM ONE account (e.g. john@firm.com)", width: 30 },
  "field:team:job-title":         { header: "Job Title",      hint: "Job title for this person (e.g. Senior Architect, Engineer II)", width: 26 },
  "field:team:office":            { header: "Office",         hint: "Office location for this person (e.g. New York, London)",        width: 22 },
  "field:clients:contract-value": { header: "Contract Value", hint: "Total contract value in dollars — numbers only (e.g. 450000)",   width: 18 },
  "field:clients:division":       { header: "Division",       hint: "Business division / BU for this project (e.g. Architecture)",    width: 24 },
};

// Sample rows shown (greyed italic) inside module-gap templates
const MODULE_SAMPLE_ROWS: Record<string, Record<string, string>[]> = {
  "module:team": [
    { FullName: "Tom Reeves",    UserName: "tom.reeves@sample-demo-co.com",    PhoneNumber: "+1 212-555-0140", CRMBusinessUnitChoice: "Leadership",      Division: "Leadership",   Department: "Management",   Role: "Principal",           JobTitle: "Principal",          UserRole: "Admin",   StartDate: "2019-03-01", EndDate: "",           FirstName: "Tom",   LastName: "Reeves",  Email: "tom.reeves@sample-demo-co.com",    Manager: "",                                Groups: "Leadership; PMO", JobProfile: "Firm principal — oversees delivery, staffing and client relationships" },
    { FullName: "James Okafor",  UserName: "james.okafor@sample-demo-co.com",  PhoneNumber: "+1 212-555-0184", CRMBusinessUnitChoice: "Buildings",       Division: "Architecture", Department: "Design",       Role: "Senior Architect",    JobTitle: "Lead Architect",     UserRole: "Manager", StartDate: "2022-06-01", EndDate: "2027-12-31", FirstName: "James", LastName: "Okafor",  Email: "james.okafor@sample-demo-co.com",  Manager: "tom.reeves@sample-demo-co.com",   Groups: "Design Leads", JobProfile: "Leads architectural design packages and client presentations" },
    { FullName: "Priya Sharma",  UserName: "priya.sharma@sample-demo-co.com",  PhoneNumber: "+1 415-555-0172", CRMBusinessUnitChoice: "Infrastructure",  Division: "Engineering",  Department: "Structural",   Role: "Structural Engineer", JobTitle: "Engineer II",        UserRole: "User",    StartDate: "2023-01-15", EndDate: "2026-12-31", FirstName: "Priya", LastName: "Sharma",  Email: "priya.sharma@sample-demo-co.com",  Manager: "james.okafor@sample-demo-co.com", JobProfile: "Structural analysis, calculations and drawing production" },
  ],
  "module:clients": [
    { CompanyName:"Metro Transit Authority",     OwnerName:"Regional Transit Commission",   ProjectTitle:"Downtown Rail Extension — Phase 2",  ProjectId:"PRJ-2024-001", ShortName:"Rail Ext Ph2",  MarketSector:"Transportation", ProjectType:"Design-Build", ServiceType:"Engineering",   Category:"Rail Infrastructure",      CRMBusinessUnitChoice:"Civil & Transit",   Division:"Infrastructure", Department:"Rail",              Status:"Active",  StartDate:"2024-03-01", EndDate:"2026-09-30", ActualStartDate:"2024-03-15", ActualCompletionDate:"", ConstStartDate:"2024-06-01", SubstantialCompletion:"2026-08-31", CloseoutDate:"2026-11-30", ContractValue:"48500000", LaborContractAmount:"18000000", GrossMargin:"28", ContractType:"GMP",         ContractedAmount:"48500000", ProposalAmount:"51000000", BidAmount:"49200000", ChangeOrders:"850000", ApprovedChangeOrders:"420000", Retainage:"2425000", FeePct:"8.5", Contingency:"1500000", ProjectCost:"38000000", ProjectPhasePctComplete:"45", PriorityLookup:"High",   NextMilestone:"Tunnel boring completion",       NextMilestoneDate:"2025-11-30", Description:"Three-tunnel heavy-rail extension; 3.2 km bore connecting downtown to Northside interchange.", StreetAddress1:"500 Transit Plaza",           City:"New York",     StateLookup:"NY", LinkedOpportunity:"Downtown Rail Extension Pursuit",       Office:"New York",    NonOperatingCost:"1400000", ProjectSummaryNote:"Tunnel boring 45% complete; utility relocation remains on the critical path.", Priority:"High",   LaborBudget:"18000000" },
    { CompanyName:"City General Hospital",       OwnerName:"Hospital Authority Board",      ProjectTitle:"Surgical Wing Expansion",            ProjectId:"PRJ-2024-002", ShortName:"Surg Wing",     MarketSector:"Healthcare",     ProjectType:"Construction", ServiceType:"Architecture",  Category:"Healthcare Facilities",    CRMBusinessUnitChoice:"Healthcare Studio", Division:"Healthcare",     Department:"Design",            Status:"Active",  StartDate:"2024-06-15", EndDate:"2025-12-31", ActualStartDate:"2024-07-01", ActualCompletionDate:"", ConstStartDate:"2024-09-01", SubstantialCompletion:"2025-11-30", CloseoutDate:"2026-02-28", ContractValue:"22750000", LaborContractAmount:"8500000",  GrossMargin:"32", ContractType:"Fixed",       ContractedAmount:"22750000", ProposalAmount:"23500000", BidAmount:"22750000", ChangeOrders:"310000", ApprovedChangeOrders:"310000", Retainage:"1137500", FeePct:"7.2", Contingency:"800000",  ProjectCost:"17000000", ProjectPhasePctComplete:"65", PriorityLookup:"High",   NextMilestone:"Steel topping out",              NextMilestoneDate:"2025-03-31", Description:"48-bed surgical wing with four OR suites, sterile processing, and recovery — OSHPD-compliant.", StreetAddress1:"1200 Medical Center Drive",   City:"Los Angeles",  StateLookup:"CA", LinkedOpportunity:"Surgical Wing Expansion RFP",            Office:"Los Angeles", NonOperatingCost:"620000",  ProjectSummaryNote:"Steel topping-out on schedule; OR fit-out packages in buyout.",               Priority:"High",   LaborBudget:"8500000" },
    { CompanyName:"State Dept of Aviation",      OwnerName:"Airport Capital Projects Office",ProjectTitle:"Terminal B Modernization",           ProjectId:"PRJ-2025-001", ShortName:"TermB Mod",     MarketSector:"Aviation",       ProjectType:"Design-Build", ServiceType:"Architecture",  Category:"Airport Infrastructure",   CRMBusinessUnitChoice:"Aviation Group",    Division:"Terminals",      Department:"Airside",           Status:"Active",  StartDate:"2025-01-20", EndDate:"2027-06-30", ActualStartDate:"2025-02-01", ActualCompletionDate:"", ConstStartDate:"2025-04-01", SubstantialCompletion:"2027-05-31", CloseoutDate:"2027-08-31", ContractValue:"61000000", LaborContractAmount:"22000000", GrossMargin:"26", ContractType:"GMP",         ContractedAmount:"61000000", ProposalAmount:"63500000", BidAmount:"62100000", ChangeOrders:"1200000",ApprovedChangeOrders:"750000",  Retainage:"3050000", FeePct:"9.0", Contingency:"2500000", ProjectCost:"49000000", ProjectPhasePctComplete:"22", PriorityLookup:"High",   NextMilestone:"Gate hold structural complete",  NextMilestoneDate:"2026-08-31", Description:"Full renovation of Terminal B concourse: gate hold rooms, retail, wayfinding, and ADA upgrades.", StreetAddress1:"One Airport Boulevard",       City:"Houston",      StateLookup:"TX", LinkedOpportunity:"Terminal B Modernization Pursuit",      Office:"Houston",     NonOperatingCost:"1750000", ProjectSummaryNote:"Phasing plan keeps 60% of gates operational through construction.",           Priority:"High",   LaborBudget:"22000000" },
    { CompanyName:"Westfield University",        OwnerName:"Board of Trustees",             ProjectTitle:"STEM Research & Innovation Hub",     ProjectId:"PRJ-2025-002", ShortName:"STEM Hub",      MarketSector:"Education",      ProjectType:"Design-Build", ServiceType:"Architecture",  Category:"Higher Education",         CRMBusinessUnitChoice:"Higher Education",  Division:"Academic",       Department:"Design",            Status:"Active",  StartDate:"2025-02-01", EndDate:"2027-03-31", ActualStartDate:"2025-02-15", ActualCompletionDate:"", ConstStartDate:"2025-06-15", SubstantialCompletion:"2027-02-28", CloseoutDate:"2027-05-31", ContractValue:"34800000", LaborContractAmount:"13000000", GrossMargin:"30", ContractType:"Design-Build",ContractedAmount:"34800000", ProposalAmount:"36000000", BidAmount:"35200000", ChangeOrders:"520000", ApprovedChangeOrders:"520000", Retainage:"1740000", FeePct:"8.0", Contingency:"1200000", ProjectCost:"27000000", ProjectPhasePctComplete:"18", PriorityLookup:"Medium", NextMilestone:"Foundation work complete",       NextMilestoneDate:"2025-10-31", Description:"180,000 sq ft STEM building with maker-spaces, wet labs, collaborative studios, and observatory.", StreetAddress1:"100 University Avenue",       City:"Boston",       StateLookup:"MA", LinkedOpportunity:"STEM Hub Design-Build Competition",     Office:"Boston",      NonOperatingCost:"950000",  ProjectSummaryNote:"Foundations underway; long-lead lab casework released early.",                Priority:"Medium", LaborBudget:"13000000" },
    { CompanyName:"Harborview Development Corp", OwnerName:"Harborview Development Corp",   ProjectTitle:"Waterfront Mixed-Use Redevelopment", ProjectId:"PRJ-2025-003", ShortName:"Waterfront MU", MarketSector:"Real Estate",    ProjectType:"Cost Plus",    ServiceType:"Architecture",  Category:"Mixed-Use Development",    CRMBusinessUnitChoice:"Buildings",         Division:"Commercial",     Department:"Development",       Status:"Active",  StartDate:"2025-04-01", EndDate:"2028-08-31", ActualStartDate:"2025-04-15", ActualCompletionDate:"", ConstStartDate:"2025-09-01", SubstantialCompletion:"2028-07-31", CloseoutDate:"2028-10-31", ContractValue:"92000000", LaborContractAmount:"34000000", GrossMargin:"24", ContractType:"Cost Plus",   ContractedAmount:"92000000", ProposalAmount:"96000000", BidAmount:"93500000", ChangeOrders:"2100000",ApprovedChangeOrders:"1500000", Retainage:"4600000", FeePct:"7.5", Contingency:"4000000", ProjectCost:"74000000", ProjectPhasePctComplete:"8",  PriorityLookup:"High",   NextMilestone:"Site preparation complete",      NextMilestoneDate:"2025-12-31", Description:"10-acre waterfront redevelopment: 420 residential units, 85k sq ft retail, promenade, and marina.", StreetAddress1:"Marina District Harbor Front", City:"Seattle",      StateLookup:"WA", LinkedOpportunity:"Harbor District Mixed-Use Development", Office:"Seattle",     NonOperatingCost:"2600000", ProjectSummaryNote:"Entitlements secured; marina permits pending federal review.",                Priority:"High",   LaborBudget:"34000000" },
  ],
  "module:opportunities": [
    { ProjectTitle:"Harbor District Mixed-Use Development", CompanyName:"Harbor Realty Group",           ContactName:"Mike Torres",    ERPJobID:"OPP-2025-001", CRMOpportunityStatusChoice:"Proposal",    ChanceOfSuccessChoice:"60", MarketSector:"Real Estate",   CRMBusinessUnitChoice:"Buildings",        Division:"Commercial",     Department:"Business Development", BidDueDate:"2025-08-15", InterviewDate:"2025-07-20", ProposalPhaseDueDate:"2025-08-01", StartDate:"2026-01-01", EndDate:"2027-06-30", TargetStartDate:"2026-01-01", TargetCompletionDate:"2027-06-30", AwardedorLossDate:"",         ApproxContractValue:"31500000", ForecastedProjectCost:"27000000", LaborContractAmount:"9500000",  GrossMargin:"14", ContractType:"GMP",      Description:"18-story mixed-use tower with ground-floor retail, 200 units, and structured parking in the Harbor District.", PointOfContact:"Mike Torres",    Status:"Active", Office:"Seattle",     NonOperatingCost:"2100000", Note:"Strong local partner secured; decision expected after the July interview.",       CRMOpportunityStageChoice:"Proposal",    ContractValue:"31500000" },
    { ProjectTitle:"Regional Airport Concourse Expansion",  CompanyName:"Metro Airport Authority",       ContactName:"Lisa Park",      ERPJobID:"OPP-2025-002", CRMOpportunityStatusChoice:"Negotiation", ChanceOfSuccessChoice:"80", MarketSector:"Aviation",      CRMBusinessUnitChoice:"Civil & Transit",  Division:"Infrastructure", Department:"Business Development", BidDueDate:"2025-07-01", InterviewDate:"2025-06-10", ProposalPhaseDueDate:"2025-06-25", StartDate:"2025-10-01", EndDate:"2027-03-31", TargetStartDate:"2025-10-01", TargetCompletionDate:"2027-03-31", AwardedorLossDate:"",         ApproxContractValue:"67000000", ForecastedProjectCost:"55000000", LaborContractAmount:"20000000", GrossMargin:"18", ContractType:"Cost-Plus", Description:"Concourse D expansion with 12 new gate hold rooms, 40k sq ft retail, and consolidated security checkpoint.", PointOfContact:"Lisa Park",      Status:"Active", Office:"Houston",     NonOperatingCost:"3800000", Note:"Preferred proponent — commercial terms in final negotiation.",                    CRMOpportunityStageChoice:"Negotiation", ContractValue:"67000000" },
    { ProjectTitle:"K-12 STEM Campus — Phase 1",           CompanyName:"Unified School District No. 9", ContactName:"Dr Angela Ross", ERPJobID:"OPP-2025-003", CRMOpportunityStatusChoice:"Qualifying",  ChanceOfSuccessChoice:"45", MarketSector:"Education",     CRMBusinessUnitChoice:"Higher Education", Division:"Academic",       Department:"Business Development", BidDueDate:"2025-10-31", InterviewDate:"2025-10-01", ProposalPhaseDueDate:"2025-10-15", StartDate:"2026-04-01", EndDate:"2027-08-31", TargetStartDate:"2026-04-01", TargetCompletionDate:"2027-08-31", AwardedorLossDate:"",         ApproxContractValue:"18200000", ForecastedProjectCost:"15500000", LaborContractAmount:"5800000",  GrossMargin:"15", ContractType:"Fixed",    Description:"New 95,000 sq ft campus with robotics lab, biology suites, maker-space, and 400-seat performing arts theatre.", PointOfContact:"Dr Angela Ross", Status:"Active", Office:"Boston",      NonOperatingCost:"1100000", Note:"Bond measure passed; shortlist announcement expected in October.",                CRMOpportunityStageChoice:"Qualifying",  ContractValue:"18200000" },
    { ProjectTitle:"Municipal Water Treatment Upgrade",     CompanyName:"City of Clearwater",            ContactName:"Brian Nguyen",   ERPJobID:"OPP-2025-004", CRMOpportunityStatusChoice:"Prospecting", ChanceOfSuccessChoice:"35", MarketSector:"Utilities",     CRMBusinessUnitChoice:"Civil & Transit",  Division:"Infrastructure", Department:"Business Development", BidDueDate:"2026-01-15", InterviewDate:"",           ProposalPhaseDueDate:"2026-01-01", StartDate:"2026-06-01", EndDate:"2028-05-31", TargetStartDate:"2026-06-01", TargetCompletionDate:"2028-05-31", AwardedorLossDate:"",         ApproxContractValue:"44000000", ForecastedProjectCost:"37000000", LaborContractAmount:"14000000", GrossMargin:"16", ContractType:"GMP",      Description:"WTP capacity upgrade 20→38 MGD with new membrane filtration, SCADA controls, and secondary clarifier.", PointOfContact:"Brian Nguyen",   Status:"Active", Office:"Los Angeles", NonOperatingCost:"2600000", Note:"Pre-RFP positioning — attending the city's industry day in November.",            CRMOpportunityStageChoice:"Prospecting", ContractValue:"44000000" },
    { ProjectTitle:"Corporate HQ Interior Fit-Out",        CompanyName:"NovaTech Solutions Inc.",        ContactName:"Sandra Lee",     ERPJobID:"OPP-2025-005", CRMOpportunityStatusChoice:"Awarded",     ChanceOfSuccessChoice:"95", MarketSector:"Technology",    CRMBusinessUnitChoice:"Buildings",        Division:"Interiors",      Department:"Business Development", BidDueDate:"2025-06-01", InterviewDate:"2025-05-15", ProposalPhaseDueDate:"2025-05-25", StartDate:"2025-08-01", EndDate:"2026-02-28", TargetStartDate:"2025-08-01", TargetCompletionDate:"2026-02-28", AwardedorLossDate:"2025-06-15", ApproxContractValue:"9800000",  ForecastedProjectCost:"8200000",  LaborContractAmount:"3100000",  GrossMargin:"16", ContractType:"T&M",      Description:"Full fit-out of 4 floors (82,000 sq ft): open-plan offices, 24 conference rooms, café, and wellness centre.", PointOfContact:"Sandra Lee",     Status:"Active", Office:"New York",    NonOperatingCost:"640000",  Note:"Won on design quality; project kickoff scheduled for August.",                    CRMOpportunityStageChoice:"Awarded",     ContractValue:"9800000" },
    { ProjectTitle:"Suburban Office Park Repositioning",    CompanyName:"Gateway Commercial REIT",       ContactName:"Paul Iverson",   ERPJobID:"OPP-2025-006", CRMOpportunityStatusChoice:"Lost",        ChanceOfSuccessChoice:"0",  MarketSector:"Commercial",    CRMBusinessUnitChoice:"Buildings",        Division:"Commercial",     Department:"Business Development", BidDueDate:"2025-04-15", InterviewDate:"2025-04-01", ProposalPhaseDueDate:"2025-04-10", StartDate:"2025-09-01", EndDate:"2026-12-31", TargetStartDate:"2025-09-01", TargetCompletionDate:"2026-12-31", AwardedorLossDate:"2025-05-02", ApproxContractValue:"12500000", ForecastedProjectCost:"10800000", LaborContractAmount:"4100000",  GrossMargin:"14", ContractType:"Cost-Plus", Description:"Repositioning of a three-building office park: lobby renovations, amenity centre, and site upgrades.", PointOfContact:"Paul Iverson",   Status:"Closed", Office:"New York",    NonOperatingCost:"900000",  Note:"Lost on fee — incumbent underbid by 12%; revisit for tenant-improvement work in Q3.", CRMOpportunityStageChoice:"Lost",        ContractValue:"12500000" },
  ],
  "module:leads": [
    { ProjectTitle: "Corporate HQ Feasibility Study",    CompanyName: "Highline Properties",    ContactName: "Marcus Webb",      CRMOpportunityStatusChoice: "Prospecting",   Status: "Active", MarketSector: "Commercial",      CRMBusinessUnitChoice: "Buildings",      Division: "Architecture", BidDueDate: "2025-09-15", StartDate: "2026-01-01", EndDate: "2026-12-31", ContractValue: "320000",  Description: "Pre-design feasibility for a 12-storey HQ building on the client's downtown lot.", TicketId: "EX-LD-1001", RequestCategory: "Service Projects (CNS)",      Department: "Design",      Office: "New York",    StreetAddress1: "88 Highline Ave",         City: "New York",    State: "NY", TargetStartDate: "2026-01-01", TargetCompletionDate: "2026-12-31", Note: "Client evaluating build vs lease; decision expected Q4 2025." },
    { ProjectTitle: "Metro Greenway Trail Phase 3",      CompanyName: "City of Riverdale",       ContactName: "Sandra Lim",       CRMOpportunityStatusChoice: "Qualifying",    Status: "Active", MarketSector: "Infrastructure",  CRMBusinessUnitChoice: "Infrastructure", Division: "Engineering",  BidDueDate: "2025-10-30", StartDate: "2026-03-01", EndDate: "2027-06-30", ContractValue: "1850000", Description: "Extension of the existing greenway corridor through the northeast precinct.", TicketId: "EX-LD-1002", RequestCategory: "Construction Projects (CPR)", Department: "Civil",       Office: "Los Angeles", StreetAddress1: "1 City Hall Plaza",       City: "Riverdale",   State: "CA", TargetStartDate: "2026-03-01", TargetCompletionDate: "2027-06-30", Note: "Phase 2 reference project delivered on budget — strong repeat-client position." },
    { ProjectTitle: "Waterside Mixed-Use Redevelopment", CompanyName: "Greenfield Capital",      ContactName: "J. Osei",          CRMOpportunityStatusChoice: "Proposal",      Status: "Active", MarketSector: "Real Estate",     CRMBusinessUnitChoice: "Buildings",      Division: "Architecture", BidDueDate: "2025-08-22", StartDate: "2025-11-01", EndDate: "2027-09-30", ContractValue: "4700000", Description: "Mixed-use residential + retail development on former industrial waterfront site.", TicketId: "EX-LD-1003", RequestCategory: "Construction Projects (CPR)", Department: "Development", Office: "Seattle",     StreetAddress1: "400 Harbor Front Road",   City: "Seattle",     State: "WA", TargetStartDate: "2025-11-01", TargetCompletionDate: "2027-09-30", Note: "Awaiting rezoning approval; proposal to follow planning decision." },
    { ProjectTitle: "Bridge Rehabilitation Study",       CompanyName: "State DOT Region 4",      ContactName: "Carol Diaz",       CRMOpportunityStatusChoice: "Negotiation",   Status: "Active", MarketSector: "Transportation",  CRMBusinessUnitChoice: "Infrastructure", Division: "Engineering",  BidDueDate: "2025-11-14", StartDate: "2025-10-01", EndDate: "2026-09-30", ContractValue: "690000",  Description: "Structural assessment and rehabilitation design for three ageing highway bridges.", TicketId: "EX-LD-1004", RequestCategory: "Service Projects (CNS)",      Department: "Structural",  Office: "Boston",      StreetAddress1: "Region 4 Depot, Route 9", City: "Springfield", State: "MA", TargetStartDate: "2025-10-01", TargetCompletionDate: "2026-09-30", Note: "Sole-source negotiation — fee proposal under review." },
  ],
  "module:assignments": [
    { Project: "Downtown Rail Extension — Phase 2", TicketId: "PRJ-2024-001", Resource: "james.okafor@sample-demo-co.com", FullName: "James Okafor", UserName: "james.okafor@sample-demo-co.com", AllocationStartDate: "2024-03-01", AllocationEndDate: "2026-09-30", AllocationHour: "6240", AllocationType: "Hard", Role: "Senior Architect",    JobTitle: "Lead Architect", CRMBusinessUnitChoice: "Civil & Transit",   Division: "Infrastructure", Department: "Rail",   BillingRate: "185", EmpLaborRate: "95",  EmpCostRate: "120", BilledHours: "1750", UserRole: "Manager" },
    { Project: "Downtown Rail Extension — Phase 2", TicketId: "PRJ-2024-001", Resource: "priya.sharma@sample-demo-co.com", FullName: "Priya Sharma", UserName: "priya.sharma@sample-demo-co.com", AllocationStartDate: "2024-06-01", AllocationEndDate: "2026-09-30", AllocationHour: "3900", AllocationType: "Hard", Role: "Structural Engineer", JobTitle: "Engineer II",    CRMBusinessUnitChoice: "Civil & Transit",   Division: "Infrastructure", Department: "Rail",   BillingRate: "155", EmpLaborRate: "75",  EmpCostRate: "95",  BilledHours: "1000", UserRole: "User" },
    { Project: "Surgical Wing Expansion",           TicketId: "PRJ-2024-002", Resource: "tom.reeves@sample-demo-co.com",   FullName: "Tom Reeves",   UserName: "tom.reeves@sample-demo-co.com",   AllocationStartDate: "2024-06-15", AllocationEndDate: "2025-12-31", AllocationHour: "3640", AllocationType: "Hard", Role: "Principal",           JobTitle: "Principal",      CRMBusinessUnitChoice: "Healthcare Studio", Division: "Healthcare",     Department: "Design", BillingRate: "220", EmpLaborRate: "110", EmpCostRate: "140", BilledHours: "1180", UserRole: "Admin" },
  ],
  "module:demand": [
    { Division: "Infrastructure", Department: "Rail",   Role: "Senior Architect",    Project: "Downtown Rail Extension — Phase 2", AllocationStartDate: "2025-06-01", AllocationEndDate: "2025-12-31", AllocationHour: "1040" },
    { Division: "Infrastructure", Department: "Rail",   Role: "Structural Engineer", Project: "Downtown Rail Extension — Phase 2", AllocationStartDate: "2025-07-01", AllocationEndDate: "2026-03-31", AllocationHour: "1400" },
    { Division: "Healthcare",     Department: "Design", Role: "Interior Designer",   Project: "Surgical Wing Expansion",           AllocationStartDate: "2025-08-01", AllocationEndDate: "2025-11-30", AllocationHour: "280"  },
  ],
  "module:companies": [
    { CompanyName: "Apex Development Group",  MarketSector: "Real Estate",    CRMHealth: "Good",    ContactName: "Michael Torres",  ContactEmail: "m.torres@apex.com",       ContactTitle: "VP Real Estate",              Phone: "+1 212 555 0100", Address1: "123 Main Street",   City: "New York",    State: "NY", ClientRep: "james.okafor@sample-demo-co.com",   Division: "Architecture" },
    { CompanyName: "City of Riverdale",       MarketSector: "Government",     CRMHealth: "Good",    ContactName: "Sarah Chen",      ContactEmail: "s.chen@riverdale.gov",    ContactTitle: "Director of Capital Works",   Phone: "+1 310 555 0200", Address1: "1 City Hall Plaza", City: "Riverdale",   State: "CA", ClientRep: "priya.sharma@sample-demo-co.com",   Division: "Engineering"  },
    { CompanyName: "Metro Transit Authority", MarketSector: "Infrastructure", CRMHealth: "Good",    ContactName: "David Okonkwo",   ContactEmail: "d.okonkwo@mta.gov",       ContactTitle: "Head of Engineering",         Phone: "+1 213 555 0300", Address1: "500 Transit Way",   City: "Los Angeles", State: "CA", ClientRep: "priya.sharma@sample-demo-co.com",   Division: "Engineering"  },
    { CompanyName: "Highline Properties",     MarketSector: "Commercial",     CRMHealth: "At Risk", ContactName: "Marcus Webb",     ContactEmail: "m.webb@highlineprops.com", ContactTitle: "CEO",                         Phone: "+1 646 555 0400", Address1: "88 Highline Ave",   City: "New York",    State: "NY", ClientRep: "james.okafor@sample-demo-co.com",   Division: "Architecture" },
  ],
};

// ── Module counts (lightweight — used by gap panel to filter which modules are empty) ──
router.get("/module-counts", async (req: Request, res: Response) => {
  try {
    const src = requireTenantAccess(req, res);
    if (!src) return;
    const tenantId = effectiveTenant(src, String(req.query.rdsTenant ?? req.query.tenantId ?? ""));
    if (!tenantId) { res.status(400).json({ error: "tenantId required" }); return; }
    const tid = resolveTenantId(tenantId);
    const pool = await getPool();
    // Team Members counted from Postgres (source of truth).
    const teamPgCount = await getActiveUsersByTenant(tid).then(u => u.length).catch(() => 0);
    const [projR, oppR, leadR, assignR, demandR, coR] = await Promise.all([
      pool.request().input("tid", tid).query(`SELECT COUNT(*) AS n FROM core2.dbo.PMM WHERE TenantID=@tid AND (Deleted=0 OR Deleted IS NULL)`),
      pool.request().input("tid", tid).query(`SELECT COUNT(*) AS n FROM core2.dbo.Opportunity WHERE TenantID=@tid AND (Deleted=0 OR Deleted IS NULL)`),
      pool.request().input("tid", tid).query(`SELECT COUNT(*) AS n FROM core2.dbo.Lead WHERE TenantID=@tid AND (Deleted=0 OR Deleted IS NULL)`),
      pool.request().input("tid", tid).query(`SELECT COUNT(*) AS n FROM core2.dbo.ResourceAllocation WHERE TenantID=@tid AND (Deleted=0 OR Deleted IS NULL)`),
      pool.request().input("tid", tid).query(`SELECT COUNT(*) AS n FROM core2.dbo.ResourceAllocation WHERE TenantID=@tid AND (Deleted=0 OR Deleted IS NULL) AND ResourceUserLookup IS NULL`),
      pool.request().input("tid", tid).query(`SELECT COUNT(*) AS n FROM core2.dbo.CRMCompany WHERE TenantID=@tid AND (Deleted=0 OR Deleted IS NULL)`),
    ]);
    res.json({
      team:          teamPgCount,
      clients:       Number(projR.recordset[0]?.n    ?? 0),
      opportunities: Number(oppR.recordset[0]?.n     ?? 0),
      leads:         Number(leadR.recordset[0]?.n    ?? 0),
      assignments:   Number(assignR.recordset[0]?.n  ?? 0),
      demand:        Number(demandR.recordset[0]?.n  ?? 0),
      companies:     Number(coR.recordset[0]?.n      ?? 0),
    });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

router.get("/gap-template", async (req: Request, res: Response) => {
  try {
    const module    = String(req.query.module    ?? "").toLowerCase();
    const uploadId  = String(req.query.uploadId  ?? "");
    const gapId     = String(req.query.gapId     ?? "");
    const metricKey = String(req.query.metricKey ?? "");
    const rdsTenant = String(req.query.tenantId  ?? "");

    const VALID_MODULES = ["team", "clients", "opportunities", "leads", "assignments", "demand", "companies"];
    if (!VALID_MODULES.includes(module)) {
      return res.status(400).json({ error: `module must be one of: ${VALID_MODULES.join(", ")}` });
    }

    const NAVY  = "FF1E3A5F";
    const WHITE = "FFFFFFFF";
    const ALT   = "FFF0F4FA";
    const YAMB  = "FFFFE082"; // amber header for the missing column
    const YLOW  = "FFFFF3CD"; // pale yellow fill for the missing column cells

    const TAB_NAMES: Record<string, string> = {
      team:          "Staff Roster",
      clients:       "Projects",
      opportunities: "Opportunities",
      leads:         "Leads",
      assignments:   "Assignments",
      demand:        "Open Positions",
      companies:     "Companies",
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = "RM ONE Auto-Onboarding";
    wb.created = new Date();
    const ws = wb.addWorksheet(TAB_NAMES[module] ?? module);

    const isFieldGap  = gapId.startsWith("field:");
    const missingDef  = GAP_MISSING_COL[gapId];

    // ── READINESS-PAGE METRIC BRANCH: generate from live DB data ─────────────
    // Called by the Data Readiness page with ?metricKey=…&tenantId=…
    // Field gaps → pre-fill existing rows + highlight missing column(s).
    // Module gaps → provide sample rows so the user sees the expected format.
    if (metricKey && rdsTenant) {
      const tid  = resolveTenantId(rdsTenant);
      const pool = await getPool();

      // Helper: write header + optional hint row + data rows, highlighting cols after anchorCount
      function renderPrefilled(
        anchorCols:    GapColumn[],
        highlightCols: GapColumn[],
        dataRows:      Record<string, string>[],
        highlightHint: string,
      ) {
        const allCols = [...anchorCols, ...highlightCols];
        allCols.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

        const hRow = ws.addRow(allCols.map(c => c.header));
        hRow.height = 22;
        hRow.eachCell((cell, colNum) => {
          const hi = colNum > anchorCols.length;
          cell.font      = { bold: true, color: { argb: hi ? "FF7C4A00" : WHITE }, size: 11 };
          cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: hi ? YAMB : NAVY } };
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border    = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
        });

        // Hint text goes ONLY in the first anchor column so the pipeline never
        // mistakes the hint row for a real data row (data columns stay empty).
        const hintRow = ws.addRow(allCols.map((_, i) => i === 0 ? highlightHint : ""));
        hintRow.height = 14;
        hintRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
          const isAnchor = colNum <= anchorCols.length;
          cell.font = { italic: true, size: 8, color: { argb: isAnchor ? "FFBF9A30" : "FFDDDDDD" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isAnchor ? "FFFFF8E1" : "FFF8F8F8" } };
        });

        const rows: Record<string, string>[] = dataRows.length > 0 ? dataRows : Array.from({ length: 8 }, () => ({}));
        rows.forEach((rowData, idx) => {
          const vals = allCols.map(col => rowData[col.key] ?? "");
          const row = ws.addRow(vals);
          row.height = 18;
          row.eachCell({ includeEmpty: true }, (cell, colNum) => {
            const hi = colNum > anchorCols.length;
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hi ? YLOW : (idx % 2 === 0 ? "FFFFFFFF" : ALT) } };
            cell.font = { size: 10 };
            cell.alignment = { vertical: "middle" };
          });
        });
      }

      // Helper: write a pure sample-rows template (module gap)
      function renderSampleRows(cols: GapColumn[], sampleRows: Record<string, string>[]) {
        cols.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });
        const hRow = ws.addRow(cols.map(c => c.header));
        hRow.height = 22;
        hRow.eachCell(cell => {
          cell.font      = { bold: true, color: { argb: WHITE }, size: 11 };
          cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border    = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
        });
        // hint row — text only in col 1 so data columns stay empty (won't be
        // mistaken for real rows by the import pipeline)
        const hintRow = ws.addRow(cols.map((_, i) => i === 0 ? "← example rows — replace with your data" : ""));
        hintRow.height = 13;
        hintRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
          if (colNum === 1) {
            cell.font = { italic: true, size: 8, color: { argb: "FF888888" } };
          }
        });
        sampleRows.forEach((rowData, idx) => {
          const row = ws.addRow(cols.map(c => rowData[c.key] ?? ""));
          row.height = 18;
          row.eachCell({ includeEmpty: true }, cell => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: idx % 2 === 0 ? "FFFFFFFF" : ALT } };
            cell.font = { size: 10, italic: true, color: { argb: "FF666666" } };
            cell.alignment = { vertical: "middle" };
          });
        });
        // blank rows for user input
        for (let r = 0; r < 8; r++) {
          const row = ws.addRow(cols.map(() => ""));
          row.height = 18;
          row.eachCell({ includeEmpty: true }, cell => {
            cell.font = { size: 10 };
            cell.alignment = { vertical: "middle" };
          });
        }
        applyDateColumnValidation(ws, cols);
      }

      if (metricKey === "unassigned_projects") {
        // Use the same upstream-aware source as the readiness endpoint so the
        // template works for both upstream and RDS tenants.  Direct pool queries
        // against core2.dbo.PMM only return rows for RDS tenants; getRecords()
        // routes to the correct data source automatically.
        const isUnassigned = (v: any) => {
          const s = String(v ?? "").trim().toLowerCase();
          return s === "" || s === "unassigned" || s === "null";
        };

        let dataRows: Record<string, string>[] = [];
        let hasCV = false, hasSD = false;
        try {
          const r: any = await getRecords("PMM", tid, rdsTenant);
          const allProjects: any[] = Array.isArray(r?.data) ? r.data : [];
          // Only include projects that are actually missing a division
          const missing = allProjects.filter(p =>
            isUnassigned(p.DivisionLookup ?? p.CRMBusinessUnitChoice ?? p.Division)
          );
          // Detect which optional columns have real data in this tenant's records
          hasCV = missing.some(p => p.ContractValue != null && String(p.ContractValue).trim() !== "");
          hasSD = missing.some(p => p.StartDate    != null && String(p.StartDate).trim()    !== "");
          dataRows = missing.slice(0, 500).map(p => ({
            ProjectTitle:  String(p.Title          ?? ""),
            Status:        String(p.Status          ?? ""),
            ...(hasCV ? { ContractValue: String(p.ContractValue ?? "") } : {}),
            ...(hasSD ? { StartDate:     String(p.StartDate     ?? "") } : {}),
          }));
        } catch (e) {
          console.warn("[gap-template] unassigned_projects fetch failed, using blank rows:", String(e));
        }

        const anchorCols: GapColumn[] = [
          { header: "Project Title", key: "ProjectTitle", width: 34 },
          { header: "Status",        key: "Status",       width: 16 },
          ...(hasCV ? [{ header: "Contract Value", key: "ContractValue", width: 18 } as GapColumn] : []),
          ...(hasSD ? [{ header: "Start Date",     key: "StartDate",     width: 14 } as GapColumn] : []),
        ];
        renderPrefilled(
          anchorCols,
          [{ header: "Division", key: "Division", width: 22 }],
          dataRows,
          "Enter the division for each project",
        );
      }

      else if (metricKey === "orphaned_people") {
        // Pre-fill staff names/emails via getResourceMasterRds (handles dynamic cols internally)
        const people = (await getResourceMasterRds(tid)) as { name: string; email: string | null; jobTitle: string | null; office: string | null }[];
        // Only include people who are ACTUALLY missing Job Title or Office — so the
        // template is scoped to the affected records, not the entire staff list.
        const missing = people.filter(p => !p.jobTitle || !p.office);
        const dataRows = missing.slice(0, 500).map(p => ({
          FullName: p.name ?? "",
          UserName: p.email ?? "",
        }));
        // Show Office column when at least one person is missing their office
        const hasOfficeData = missing.some(p => !p.office);
        renderPrefilled(
          [
            { header: "Full Name",   key: "FullName", width: 28 },
            { header: "Login Email", key: "UserName", width: 32 },
          ],
          [
            { header: "Job Title", key: "JobTitle", width: 24 },
            ...(hasOfficeData ? [{ header: "Office", key: "Office", width: 20 } as GapColumn] : []),
          ],
          dataRows,
          "Enter Job Title (and Office if applicable)",
        );
      }

      else if (metricKey === "people_no_allocation") {
        // Pre-fill with real bench people using getResourceAllocations — exactly
        // the same source as the readiness metric — so the list matches what
        // the metric reported. Filter to currentPct === 0 (no active allocation).
        let benchRows: Record<string, string>[] = [];
        try {
          const allocData = await getResourceAllocations(tid, rdsTenant) as {
            resources?: { username: string; name: string; currentPct: number }[];
          };
          const benchPeople = (allocData.resources ?? [])
            .filter((p: any) => p.currentPct === 0 && p.accessLevel !== "Admin" && p.accessLevel !== "admin")
            .sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username));

          // For each bench person, find their most recent past allocation so
          // the template can pre-fill Project / Start Date / End Date / Allocation %.
          // This gives the user a real starting point rather than blank rows.
          benchRows = benchPeople.map(p => {
            const allocs: { projectId: string; projectName: string; pct: number; startDate: string; endDate: string }[]
              = (p as any).allAllocations ?? [];
            const last = allocs.sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""))[0];
            return {
              Resource:             p.username || p.name,
              Project:              last?.projectName || last?.projectId || "",
              AllocationStartDate:  last?.startDate  || "",
              AllocationEndDate:    last?.endDate     || "",
            };
          });
        } catch (e) {
          console.warn("[gap-template] bench query failed:", String(e));
        }

        renderPrefilled(
          [{ header: "Team Member", key: "Resource", width: 30 }],
          [
            { header: "Project",      key: "Project",             width: 34 },
            { header: "Start Date",   key: "AllocationStartDate", width: 14 },
            { header: "End Date",     key: "AllocationEndDate",   width: 14 },
            { header: "Total Hours",  key: "AllocationHour",      width: 14 },
          ],
          benchRows,
          "Fill in assignment details for each person",
        );
      }

      else if (metricKey === "capacity_overview") {
        // 0 % capacity allocated — same assignments template as people_no_allocation
        // but includes ALL resources (everyone needs to be assigned something)
        let benchRows: Record<string, string>[] = [];
        try {
          const allocData = await getResourceAllocations(tid, rdsTenant) as {
            resources?: { username: string; name: string; currentPct: number }[];
          };
          benchRows = (allocData.resources ?? [])
            .filter(p => p.currentPct === 0)
            .sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username))
            .map(p => {
              const allocs: { projectId: string; projectName: string; pct: number; startDate: string; endDate: string }[]
                = (p as any).allAllocations ?? [];
              const last = allocs.sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""))[0];
              return {
                Resource:            p.username || p.name,
                Project:             last?.projectName || last?.projectId || "",
                AllocationStartDate: last?.startDate  || "",
                AllocationEndDate:   last?.endDate     || "",
              };
            });
        } catch (e) {
          console.warn("[gap-template] capacity_overview bench query failed:", String(e));
        }
        renderPrefilled(
          [{ header: "Team Member", key: "Resource", width: 30 }],
          [
            { header: "Project",      key: "Project",             width: 34 },
            { header: "Start Date",   key: "AllocationStartDate", width: 14 },
            { header: "End Date",     key: "AllocationEndDate",   width: 14 },
            { header: "Total Hours",  key: "AllocationHour",      width: 14 },
          ],
          benchRows,
          "Fill in assignment details for each person",
        );
      }

      else if (metricKey === "missing_projects") {
        renderSampleRows(GAP_ESSENTIAL_COLUMNS["module:clients"]       ?? [], MODULE_SAMPLE_ROWS["module:clients"]       ?? []);
      }
      else if (metricKey === "missing_team") {
        renderSampleRows(GAP_ESSENTIAL_COLUMNS["module:team"]          ?? [], MODULE_SAMPLE_ROWS["module:team"]          ?? []);
      }
      else if (metricKey === "missing_opportunities") {
        renderSampleRows(GAP_ESSENTIAL_COLUMNS["module:opportunities"] ?? [], MODULE_SAMPLE_ROWS["module:opportunities"] ?? []);
      }
      else if (metricKey === "missing_leads") {
        renderSampleRows(GAP_ESSENTIAL_COLUMNS["module:leads"]         ?? [], MODULE_SAMPLE_ROWS["module:leads"]         ?? []);
      }
      else if (metricKey === "missing_assignments") {
        renderSampleRows(GAP_ESSENTIAL_COLUMNS["module:assignments"]   ?? [], MODULE_SAMPLE_ROWS["module:assignments"]   ?? []);
      }
      else if (metricKey === "allocations_with_cost_rate" || metricKey === "allocations_with_billing_rate") {
        const isCost = metricKey === "allocations_with_cost_rate";

        // Detect which rate + join columns actually exist on this tenant's RA table
        const colChk = await pool.request().query(
          `SELECT COLUMN_NAME FROM core2.INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='ResourceAllocation'
           AND COLUMN_NAME IN ('EmpCostRate','CostRate','BillingRate','ResourceUser','TicketId','Deleted')`
        );
        const raCols  = new Set((colChk.recordset ?? []).map((c: any) => String(c.COLUMN_NAME)));
        const costCol = ["EmpCostRate", "CostRate"].find(c => raCols.has(c));
        const billCol = raCols.has("BillingRate") ? "BillingRate" : null;
        const rateCol = isCost ? costCol : billCol;
        const delClause = raCols.has("Deleted") ? "AND (ra.Deleted=0 OR ra.Deleted IS NULL)" : "";
        const hasRU  = raCols.has("ResourceUser");
        const hasTkt = raCols.has("TicketId");

        let dataRows: Record<string, string>[] = [];
        if (rateCol) {
          try {
            // Drive from AspNetUsers so people with NO allocation row at all are
            // included (they show up with a blank Project). The WHERE condition
            // catches both: (a) no RA row → ra.ResourceUser IS NULL, and
            // (b) RA row exists but rate is 0 / null.
            const raJoin = hasRU
              ? `LEFT JOIN core2.dbo.ResourceAllocation ra
                   ON ra.ResourceUser = u.Id
                   AND ra.TenantID=@tid ${delClause}`
              : "";
            const pJoin = hasTkt && hasRU
              ? `LEFT JOIN core2.dbo.PMM p ON p.TicketId=ra.TicketId AND p.TenantID=@tid`
              : "";
            const rateFilter = hasRU
              ? `AND (ra.ResourceUser IS NULL OR ISNULL(ra.[${rateCol}],0)=0)`
              : "";
            const q = `
              SELECT TOP 500
                ISNULL(u.Name, ISNULL(u.UserName,'')) AS Resource,
                ISNULL(${hasTkt && hasRU ? "p.Title" : "''"},'') AS Project
              FROM core2.dbo.AspNetUsers u
              ${raJoin}
              ${pJoin}
              WHERE u.TenantID=@tid AND (u.Deleted=0 OR u.Deleted IS NULL)
              ${rateFilter}
              ORDER BY u.Name, ${hasTkt && hasRU ? "p.Title" : "u.Name"}`;
            const r = await pool.request().input("tid", tid).query(q);
            dataRows = (r.recordset ?? []).map((row: any) => ({
              Resource: String(row.Resource ?? ""),
              Project:  String(row.Project  ?? ""),
            }));
          } catch (e) {
            console.warn(`[gap-template] ${metricKey} rate-prefill query failed:`, String(e));
          }
        }

        renderPrefilled(
          [
            { header: "Team Member", key: "Resource", width: 30 },
            { header: "Project",     key: "Project",  width: 34 },
          ],
          isCost
            ? [{ header: "Cost Rate ($/hr)",    key: "CostRate",    width: 20 }]
            : [{ header: "Billing Rate ($/hr)", key: "BillingRate", width: 20 }],
          dataRows,
          isCost
            ? "Enter the labor cost rate ($/hr) for each person"
            : "Enter the billing rate ($/hr) for each person",
        );
      }

      else {
        // Fallback — anything not handled above
        const cols = GAP_ESSENTIAL_COLUMNS["module:team"] ?? [];
        const sample = MODULE_SAMPLE_ROWS["module:team"] ?? [];
        renderSampleRows(cols, sample);
      }

    } else if (isFieldGap && missingDef && uploadId) {
      // ── FIELD GAP: re-parse uploaded file → pre-fill rows + highlight the one missing column ──

      let anchorHeaders: string[] = [];
      let existingRows:  string[][] = [];

      const job = await getJobWithFile(uploadId);
      if (job?.fileData) {
        try {
          const buf = Buffer.from(job.fileData, "base64");
          // Streaming parse (see lib/excel.ts) — a full ExcelJS load here has
          // OOM-killed production on large client files.
          const parsedSheets = await parseExcel(buf);

          // Pick the sheet whose tableName best matches the module
          const matchSheet = (job.sheets ?? []).find(s => {
            const tn = (s.tableName ?? s.sheetName ?? "").toLowerCase();
            if (module === "team")          return tn.includes("team") || tn.includes("staff") || tn.includes("person") || tn.includes("employ");
            if (module === "clients")       return tn.includes("client") || tn.includes("project");
            if (module === "opportunities") return tn.includes("opportunit") || tn.includes("opp") || tn.includes("pipeline");
            if (module === "leads")         return tn.includes("lead") || tn.includes("bid") || tn.includes("tender");
            if (module === "assignments")   return tn.includes("assign") || tn.includes("alloc") || tn.includes("schedule");
            if (module === "demand")        return tn.includes("demand") || tn.includes("open") || tn.includes("position");
            if (module === "companies")     return tn.includes("compan") || tn.includes("client") || tn.includes("account");
            return false;
          });
          const srcSheet = (matchSheet
            ? parsedSheets.find(s => s.sheetName === matchSheet.sheetName)
            : undefined) ?? parsedSheets[0];

          if (srcSheet) {
            const cols = srcSheet.columns.filter(c => c !== "");
            anchorHeaders = cols;
            existingRows = srcSheet.rows.map(r =>
              cols.map(c => {
                const v = r[c];
                return v == null ? "" : String(v).trim();
              }),
            );
          }
        } catch { /* if re-parse fails, fall through to blank rows */ }
      }

      // Remove the missing column from anchorHeaders so it does NOT appear twice.
      // If it was already present in the uploaded file we extract its existing values
      // and pre-populate them into the amber highlight column so the user only needs
      // to fill the cells that are still blank.
      const missingHeaderNorm = missingDef.header.toLowerCase();
      const missingColIdx     = anchorHeaders.findIndex(h => h.toLowerCase() === missingHeaderNorm);
      const keepIndices       = anchorHeaders.map((_, i) => i).filter(i => i !== missingColIdx);
      const filteredHeaders   = keepIndices.map(i => anchorHeaders[i]);

      // Columns: de-duped anchor cols + the one missing column at the end
      const allHeaders = [...filteredHeaders, missingDef.header];
      allHeaders.forEach((_, i) => {
        ws.getColumn(i + 1).width = i < filteredHeaders.length ? 22 : missingDef.width;
      });

      // Header row — missing column gets amber background
      const hRow = ws.addRow(allHeaders);
      hRow.height = 22;
      hRow.eachCell((cell, colNum) => {
        const isMissing = colNum === allHeaders.length;
        cell.font      = { bold: true, color: { argb: isMissing ? "FF7C4A00" : WHITE }, size: 11 };
        cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: isMissing ? YAMB : NAVY } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border    = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
      });

      // Hint row — only the missing column shows a hint; all others are blank
      const hintRow = ws.addRow(allHeaders.map((_, i) => i === allHeaders.length - 1 ? missingDef.hint : ""));
      hintRow.height = 14;
      hintRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
        const isMissing = colNum === allHeaders.length;
        cell.font  = { italic: true, size: 8, color: { argb: isMissing ? "FFBF9A30" : "FFDDDDDD" } };
        cell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: isMissing ? "FFFFF8E1" : "FFF8F8F8" } };
      });

      // Data rows — anchor columns pre-filled; missing column uses existing value if present
      // (so only the truly-blank cells stay empty for the user to fill in)
      const blankRow = () => ({ kept: filteredHeaders.map(() => ""), missingVal: "" });
      const dataRows = existingRows.length > 0
        ? existingRows.map(vals => ({
            kept:       keepIndices.map(i => vals[i] ?? ""),
            missingVal: missingColIdx >= 0 ? (vals[missingColIdx] ?? "") : "",
          }))
        : Array.from({ length: 5 }, blankRow);

      dataRows.forEach(({ kept, missingVal }, idx) => {
        const row = ws.addRow([...kept, missingVal]);
        row.height = 18;
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
          const isMissing = colNum === allHeaders.length;
          // Cells that already have a value use a lighter tint; truly empty ones are full amber
          const fill = isMissing
            ? (cell.value ? "FFFFF3CD" : YLOW)
            : (idx % 2 === 0 ? "FFFFFFFF" : ALT);
          cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
          cell.font      = { size: 10 };
          cell.alignment = { vertical: "middle" };
        });
      });

    } else {
      // ── MODULE GAP (or fallback): use full SIMPLIFIED_TEMPLATE_COLUMNS so the downloaded
      // Excel matches the InlineDataGrid template exactly (same columns, same order).
      // opportunities and leads share the "clients" column set — InlineDataGrid uses PROJECT_COLS for all three.
      const SIMP_KEY: Record<string, string> = {
        team: "team", clients: "clients", opportunities: "opportunities",
        leads: "leads", assignments: "assignments", demand: "demand",
        companies: "companies",
      };
      const simpKey = SIMP_KEY[module];
      const templateCols = simpKey ? (SIMPLIFIED_TEMPLATE_COLUMNS[simpKey] ?? []) : [];
      const fallbackCols = GAP_ESSENTIAL_COLUMNS[gapId] ?? GAP_ESSENTIAL_COLUMNS[`module:${module}`] ?? [];
      const cols: GapColumn[] = templateCols.length > 0
        ? templateCols.map(c => ({ header: c.header, key: c.key, width: c.width, hint: c.hint }))
        : fallbackCols;
      cols.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

      // Header row — navy background, white bold text
      const hRow = ws.addRow(cols.map(c => c.header));
      hRow.height = 22;
      hRow.eachCell(cell => {
        cell.font      = { bold: true, color: { argb: WHITE }, size: 11 };
        cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border    = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
        if ((cell as any).note) (cell as any).note = undefined;
      });
      // Add column hints as Excel comments on header cells
      cols.forEach((col, i) => {
        if (col.hint) {
          const cell = ws.getRow(1).getCell(i + 1);
          (cell as any).note = { texts: [{ text: col.hint }] };
        }
      });

      // ── Live data: when tenantId provided, populate with real records ──────
      // Converts a raw Date object, ISO string, or any value to YYYY-MM-DD.
      const fmtDate = (v: any): string => {
        if (!v) return "";
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        const s = String(v).trim();
        return s.length >= 10 ? s.slice(0, 10) : s;
      };
      let liveRows: Record<string, string>[] = [];
      if (rdsTenant && !gapId) {
        const tid2 = resolveTenantId(rdsTenant);
        try {
          if (module === "team") {
            const pool = await getPool();
            const r = await pool.request().input("tid", sql.NVarChar, tid2).query(`
              SELECT TOP 500
                ISNULL(u.Name, LTRIM(ISNULL(u.FirstName,'') + ' ' + ISNULL(u.LastName,''))) AS FullName,
                ISNULL(u.FirstName, '') AS FirstName,
                ISNULL(u.LastName,  '') AS LastName,
                u.UserName,
                ISNULL(u.Email, u.UserName) AS Email,
                ISNULL(CAST(u.UserRole AS NVARCHAR(50)), '') AS UserRole,
                ISNULL(CONVERT(NVARCHAR(10), TRY_CONVERT(DATE, u.StartDate)), '') AS StartDate,
                ISNULL(CONVERT(NVARCHAR(10), TRY_CONVERT(DATE, u.EndDate)),   '') AS EndDate,
                ISNULL(cd.Title,  '') AS Division,
                ISNULL(dept.Title,'') AS Department,
                ISNULL(ro.Title,  '') AS Role,
                ISNULL(jt.Title, ISNULL(CAST(u.Title AS NVARCHAR(200)), '')) AS JobTitle,
                ISNULL(bu.Title,  '') AS BusinessUnit
              FROM core2.dbo.AspNetUsers u
              LEFT JOIN core2.dbo.CompanyDivisions cd
                ON cd.ID = TRY_CAST(u.DivisionLookup AS BIGINT)
                AND cd.TenantID = @tid AND (cd.Deleted=0 OR cd.Deleted IS NULL)
              LEFT JOIN core2.dbo.Department dept
                ON dept.ID = TRY_CAST(u.DepartmentLookup AS BIGINT)
                AND (dept.Deleted=0 OR dept.Deleted IS NULL)
              LEFT JOIN core2.dbo.Roles ro
                ON ro.Id = u.GlobalRoleID
                AND ro.TenantID = @tid
              LEFT JOIN core2.dbo.JobTitle jt
                ON jt.ID = TRY_CAST(u.JobTitleLookup AS BIGINT)
              LEFT JOIN core2.dbo.BusinessUnit bu
                ON bu.ID = TRY_CAST(cd.BusinessUnitIdLookup AS BIGINT)
              WHERE u.TenantID = @tid AND (u.Deleted=0 OR u.Deleted IS NULL) AND ISNULL(u.Enabled,1)=1
              ORDER BY u.UserName
            `);
            liveRows = (r.recordset ?? []).map((u: any) => ({
              FullName:             String(u.FullName   ?? "").trim(),
              FirstName:            String(u.FirstName  ?? ""),
              LastName:             String(u.LastName   ?? ""),
              UserName:             String(u.UserName   ?? ""),
              Email:                String(u.Email      ?? u.UserName ?? ""),
              UserRole:             String(u.UserRole   ?? ""),
              StartDate:            String(u.StartDate  ?? ""),
              EndDate:              String(u.EndDate    ?? ""),
              Division:             String(u.Division   ?? ""),
              Department:           String(u.Department ?? ""),
              Role:                 String(u.Role       ?? ""),
              JobTitle:             String(u.JobTitle   ?? ""),
              CRMBusinessUnitChoice:String(u.BusinessUnit ?? ""),
            }));
          } else if (module === "clients") {
            const res: any = await getRecords("PMM", tid2, rdsTenant);
            liveRows = (Array.isArray(res?.data) ? res.data : []).slice(0, 300).map((p: any) => ({
              ProjectTitle:         String(p.Title                ?? ""),
              CompanyName:          String(p.CRMCompanyLookup     ?? p.CompanyName ?? ""),
              Status:               String(p.Status               ?? ""),
              ContractValue:        String(p.ContractValue        ?? ""),
              LaborContractAmount:  String(p.LaborContractAmount  ?? ""),
              GrossMargin:          String(p.GrossMargin          ?? ""),
              ContractType:         String(p.ContractType         ?? ""),
              MarketSector:         String(p.MarketSector         ?? p.SectorChoice ?? ""),
              ProjectType:          String(p.ProjectType          ?? ""),
              ServiceType:          String(p.ServiceType          ?? ""),
              CRMBusinessUnitChoice:String(p.CRMBusinessUnitChoice ?? ""),
              Division:             String(p.Division             ?? p.CRMBusinessUnitChoice ?? ""),
              Department:           String(p.Department           ?? ""),
              StartDate:            fmtDate(p.StartDate),
              EndDate:              fmtDate(p.EndDate),
              Description:          String(p.Description          ?? p.ProjectSummaryNote ?? ""),
            }));
          } else if (module === "opportunities") {
            const res: any = await getRecords("OPM", tid2, rdsTenant);
            liveRows = (Array.isArray(res?.data) ? res.data : []).slice(0, 300).map((p: any) => ({
              ProjectTitle:              String(p.Title                       ?? ""),
              CompanyName:               String(p.CRMCompanyLookup            ?? p.CompanyName ?? ""),
              CRMOpportunityStatusChoice:String(p.CRMOpportunityStatusChoice  ?? p.Status ?? ""),
              ChanceOfSuccessChoice:     String(p.ChanceOfSuccessChoice       ?? ""),
              ContractValue:             String(p.ContractValue               ?? p.ApproxContractValue ?? ""),
              MarketSector:              String(p.MarketSector                ?? p.SectorChoice ?? ""),
              CRMBusinessUnitChoice:     String(p.CRMBusinessUnitChoice       ?? ""),
              Division:                  String(p.Division                    ?? p.CRMBusinessUnitChoice ?? ""),
              Department:                String(p.Department                  ?? ""),
              BidDueDate:                fmtDate(p.BidDueDate),
              InterviewDate:             fmtDate(p.InterviewDate),
              ProposalPhaseDueDate:      fmtDate(p.ProposalPhaseDueDate),
              StartDate:                 fmtDate(p.StartDate),
              EndDate:                   fmtDate(p.EndDate),
              Description:               String(p.Description                 ?? ""),
            }));
          } else if (module === "leads") {
            const res: any = await getRecords("LEM", tid2, rdsTenant);
            liveRows = (Array.isArray(res?.data) ? res.data : []).slice(0, 300).map((p: any) => ({
              ProjectTitle:              String(p.Title                       ?? ""),
              CompanyName:               String(p.CRMCompanyLookup            ?? p.CompanyName ?? ""),
              Status:                    String(p.Status                      ?? ""),
              CRMOpportunityStatusChoice:String(p.CRMOpportunityStatusChoice  ?? ""),
              ContractValue:             String(p.ContractValue               ?? ""),
              MarketSector:              String(p.MarketSector                ?? ""),
              CRMBusinessUnitChoice:     String(p.CRMBusinessUnitChoice       ?? ""),
              Division:                  String(p.Division                    ?? ""),
              Department:                String(p.Department                  ?? ""),
              StartDate:                 fmtDate(p.StartDate),
              EndDate:                   fmtDate(p.EndDate),
              Description:               String(p.Description                 ?? ""),
            }));
          }
        } catch (e) {
          console.warn(`[gap-template] live data fetch failed for module=${module}:`, String(e));
          liveRows = [];
        }
      }

      const usingLive = liveRows.length > 0;

      if (usingLive) {
        // Real data — styled as normal rows so users can edit in-place and re-upload
        liveRows.forEach((rowData, idx) => {
          const row = ws.addRow(cols.map(c => rowData[c.key] ?? ""));
          row.height = 18;
          row.eachCell({ includeEmpty: true }, cell => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: idx % 2 === 0 ? "FFFFFFFF" : ALT } };
            cell.font = { size: 10 };
            cell.alignment = { vertical: "middle" };
          });
        });
      } else {
        // No tenant data yet (or no tenantId passed) — show greyed italic sample rows
        const sampleRows = MODULE_SAMPLE_ROWS[`module:${module}`] ?? [];
        sampleRows.forEach((rowData, idx) => {
          const row = ws.addRow(cols.map(c => rowData[c.key] ?? ""));
          row.height = 18;
          row.eachCell({ includeEmpty: true }, cell => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: idx % 2 === 0 ? "FFFFFFFF" : ALT } };
            cell.font = { size: 10, italic: true, color: { argb: "FF666666" } };
            cell.alignment = { vertical: "middle" };
          });
        });
      }

      // Blank rows for the user to add new entries
      for (let r = 0; r < 8; r++) {
        const row = ws.addRow(cols.map(() => ""));
        row.height = 18;
        row.eachCell({ includeEmpty: true }, cell => {
          cell.font      = { size: 10 };
          cell.alignment = { vertical: "middle" };
        });
      }

      applyDateColumnValidation(ws, cols);

      // ── Access Level dropdown (main sheet) ─────────────────────────────
      // Apply to any module whose main sheet has an "Access Level" column.
      {
        const sampleCount = usingLive
          ? liveRows.length
          : (MODULE_SAMPLE_ROWS[`module:${module}`] ?? []).length;
        applyAclDropdown(ws, cols, sampleCount + 8);
      }
    }

    ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];

    // ── "From Opportunity" dropdown (clients/projects tab only) ───────────
    // Fetches live opportunity titles from the tenant's DB and bakes them in
    // as a hidden lookup sheet so the user gets a pick-list instead of typing.
    if (module === "clients" && !metricKey) {
      const fromOppIdx = (SIMPLIFIED_TEMPLATE_COLUMNS.clients ?? []).findIndex(c => c.header === "From Opportunity");
      if (fromOppIdx >= 0) {
        let oppTitles: string[] = [];
        try {
          if (rdsTenant) {
            const tid  = resolveTenantId(rdsTenant);
            const pool = await getPool();
            const r = await pool.request()
              .input("tid", sql.NVarChar, tid)
              .query("SELECT TOP 200 Title FROM core2.dbo.Opportunity WHERE TenantID=@tid AND (Deleted IS NULL OR Deleted=0) AND Title IS NOT NULL ORDER BY Title");
            oppTitles = (r.recordset as any[]).map(row => String(row.Title ?? "")).filter(Boolean);
          }
        } catch { /* no tenant/DB — skip dropdown */ }

        if (oppTitles.length > 0) {
          // Hidden lookup sheet avoids the 255-char inline limit
          const lws = wb.addWorksheet("__OppList__");
          lws.state = "veryHidden";
          oppTitles.forEach((t, i) => { lws.getCell(`A${i + 1}`).value = t; });
          const formula  = `'__OppList__'!$A$1:$A$${oppTitles.length}`;
          const fromOppL = ws.getColumn(fromOppIdx + 1).letter;
          const sampleCount = (MODULE_SAMPLE_ROWS[`module:${module}`] ?? []).length;
          const lastRow  = 2 + sampleCount + 9; // header + hint + samples + blank rows
          for (let r = 2; r <= lastRow; r++) {
            ws.getCell(`${fromOppL}${r}`).dataValidation = {
              type: "list", allowBlank: true, formulae: [formula],
              showErrorMessage: false,
              showInputMessage: true,
              promptTitle: "From Opportunity",
              prompt: "Select the opportunity this project was created from (optional)",
            };
          }
        }
      }
    }

    // For Projects and Opportunities, add a second "Team Assignments" tab so the
    // user can fill in team allocations in the same file without needing a separate
    // Assignments upload.
    if ((module === "clients" || module === "opportunities") && !metricKey) {
      const asgCols = SIMPLIFIED_TEMPLATE_COLUMNS.assignments ?? [];
      const asgWs   = wb.addWorksheet("Team Assignments");
      asgCols.forEach((c, i) => { asgWs.getColumn(i + 1).width = c.width ?? 20; });

      const asgHdr = asgWs.addRow(asgCols.map(c => c.header));
      asgHdr.height = 22;
      asgHdr.eachCell((cell, colNum) => {
        cell.font      = { bold: true, color: { argb: WHITE }, size: 11 };
        cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border    = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
        const col = asgCols[colNum - 1];
        if (col?.hint) cell.note = col.hint;
      });

      // Sample rows referencing the project names from the first tab (5 rows each, all columns filled)
      const asgSamples: Record<string, string>[] = module === "clients" ? [
        { Project: "Downtown Rail Extension — Phase 2",  TicketId: "PRJ-2024-001", FullName: "James Okafor", UserName: "james.okafor@sample-demo-co.com",  AllocationStartDate: "2024-03-01", AllocationEndDate: "2026-09-30", AllocationHour: "6240", AllocationType: "Hard", Role: "Senior Architect",    JobTitle: "Lead Architect",  CRMBusinessUnitChoice: "Civil & Transit",   Division: "Infrastructure", Department: "Rail",               BillingRate: "185", EmpLaborRate: "95",  EmpCostRate: "120", ActualStartDate: "2024-03-15", ActualEndDate: "2026-09-30",   ActualHour: "1820", BilledHours: "1750", UserRole: "Manager" },
        { Project: "Downtown Rail Extension — Phase 2",  TicketId: "PRJ-2024-001", FullName: "Priya Sharma", UserName: "priya.sharma@sample-demo-co.com",  AllocationStartDate: "2024-06-01", AllocationEndDate: "2026-09-30", AllocationHour: "3900", AllocationType: "Hard", Role: "Structural Engineer", JobTitle: "Engineer II",     CRMBusinessUnitChoice: "Civil & Transit",   Division: "Infrastructure", Department: "Rail",               BillingRate: "155", EmpLaborRate: "75",  EmpCostRate: "95",  ActualStartDate: "2024-06-01", ActualEndDate: "2026-09-30",   ActualHour: "1040", BilledHours: "1000", UserRole: "User" },
        { Project: "Surgical Wing Expansion",            TicketId: "PRJ-2024-002", FullName: "Tom Reeves",   UserName: "tom.reeves@sample-demo-co.com",    AllocationStartDate: "2024-06-15", AllocationEndDate: "2025-12-31", AllocationHour: "3640", AllocationType: "Hard", Role: "Principal",           JobTitle: "Principal",       CRMBusinessUnitChoice: "Healthcare Studio", Division: "Healthcare",     Department: "Design",             BillingRate: "220", EmpLaborRate: "110", EmpCostRate: "140", ActualStartDate: "2024-07-01", ActualEndDate: "2025-12-31",   ActualHour: "1200", BilledHours: "1180", UserRole: "Admin" },
        { Project: "Terminal B Modernization",           TicketId: "PRJ-2025-001", FullName: "James Okafor", UserName: "james.okafor@sample-demo-co.com",  AllocationStartDate: "2025-01-20", AllocationEndDate: "2027-06-30", AllocationHour: "3120", AllocationType: "Hard", Role: "Senior Architect",    JobTitle: "Lead Architect",  CRMBusinessUnitChoice: "Aviation Group",    Division: "Terminals",      Department: "Airside",            BillingRate: "185", EmpLaborRate: "95",  EmpCostRate: "120", ActualStartDate: "2025-02-01", ActualEndDate: "2027-06-30",   ActualHour: "340",  BilledHours: "320",  UserRole: "Manager" },
        { Project: "STEM Research & Innovation Hub",     TicketId: "PRJ-2025-002", FullName: "Priya Sharma", UserName: "priya.sharma@sample-demo-co.com",  AllocationStartDate: "2025-02-01", AllocationEndDate: "2027-03-31", AllocationHour: "5200", AllocationType: "Hard", Role: "Structural Engineer", JobTitle: "Engineer II",     CRMBusinessUnitChoice: "Higher Education",  Division: "Academic",       Department: "Design",             BillingRate: "155", EmpLaborRate: "75",  EmpCostRate: "95",  ActualStartDate: "2025-02-15", ActualEndDate: "2027-03-31",   ActualHour: "520",  BilledHours: "500",  UserRole: "User" },
      ] : [
        { Project: "Harbor District Mixed-Use Development", TicketId: "OPP-2025-001", FullName: "James Okafor", UserName: "james.okafor@sample-demo-co.com", AllocationStartDate: "2026-01-01", AllocationEndDate: "2027-06-30", AllocationHour: "3120", AllocationType: "Soft", Role: "Senior Architect",    JobTitle: "Lead Architect",  CRMBusinessUnitChoice: "Buildings",        Division: "Commercial",     Department: "Design",      BillingRate: "185", EmpLaborRate: "95",  EmpCostRate: "120", ActualStartDate: "", ActualEndDate: "", ActualHour: "", BilledHours: "0", UserRole: "Manager" },
        { Project: "Regional Airport Concourse Expansion", TicketId: "OPP-2025-002", FullName: "Priya Sharma", UserName: "priya.sharma@sample-demo-co.com", AllocationStartDate: "2025-10-01", AllocationEndDate: "2027-03-31", AllocationHour: "3900", AllocationType: "Soft", Role: "Structural Engineer", JobTitle: "Engineer II",     CRMBusinessUnitChoice: "Civil & Transit",  Division: "Infrastructure", Department: "Structural",  BillingRate: "155", EmpLaborRate: "75",  EmpCostRate: "95",  ActualStartDate: "", ActualEndDate: "", ActualHour: "", BilledHours: "0", UserRole: "User" },
        { Project: "K-12 STEM Campus — Phase 1",          TicketId: "OPP-2025-003", FullName: "Tom Reeves",   UserName: "tom.reeves@sample-demo-co.com",   AllocationStartDate: "2026-04-01", AllocationEndDate: "2027-08-31", AllocationHour: "1560", AllocationType: "Soft", Role: "Principal",           JobTitle: "Principal",       CRMBusinessUnitChoice: "Higher Education", Division: "Academic",       Department: "Management",  BillingRate: "220", EmpLaborRate: "110", EmpCostRate: "140", ActualStartDate: "", ActualEndDate: "", ActualHour: "", BilledHours: "0", UserRole: "Admin" },
        { Project: "Municipal Water Treatment Upgrade",    TicketId: "OPP-2025-004", FullName: "Priya Sharma", UserName: "priya.sharma@sample-demo-co.com", AllocationStartDate: "2026-06-01", AllocationEndDate: "2028-05-31", AllocationHour: "5200", AllocationType: "Soft", Role: "Structural Engineer", JobTitle: "Engineer II",     CRMBusinessUnitChoice: "Civil & Transit",  Division: "Infrastructure", Department: "Structural",  BillingRate: "155", EmpLaborRate: "75",  EmpCostRate: "95",  ActualStartDate: "", ActualEndDate: "", ActualHour: "", BilledHours: "0", UserRole: "User" },
        { Project: "Corporate HQ Interior Fit-Out",        TicketId: "OPP-2025-005", FullName: "James Okafor", UserName: "james.okafor@sample-demo-co.com", AllocationStartDate: "2025-08-01", AllocationEndDate: "2026-02-28", AllocationHour: "1560", AllocationType: "Soft", Role: "Senior Architect",    JobTitle: "Lead Architect",  CRMBusinessUnitChoice: "Buildings",        Division: "Interiors",      Department: "Design",      BillingRate: "185", EmpLaborRate: "95",  EmpCostRate: "120", ActualStartDate: "", ActualEndDate: "", ActualHour: "", BilledHours: "0", UserRole: "Manager" },
      ];

      asgSamples.forEach((s, idx) => {
        const row = asgWs.addRow(asgCols.map(c => s[c.key] ?? ""));
        row.height = 18;
        row.eachCell({ includeEmpty: true }, cell => {
          cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: idx % 2 === 0 ? "FFFFFFFF" : ALT } };
          cell.font      = { size: 10, italic: true, color: { argb: "FF666666" } };
          cell.alignment = { vertical: "middle" };
        });
      });

      for (let r = 0; r < 8; r++) {
        const row = asgWs.addRow(asgCols.map(() => ""));
        row.height = 18;
        row.eachCell({ includeEmpty: true }, cell => {
          cell.font = { size: 10 }; cell.alignment = { vertical: "middle" };
        });
      }
      asgWs.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];
      applyDateColumnValidation(asgWs, asgCols, 2, 1 + asgSamples.length + 8);

      // ── Access Level dropdown ─────────────────────────────────────────────
      // Add an Excel list-dropdown on every Access Level cell in the data area
      // so the user can pick Admin / Manager / User from a menu instead of typing.
      {
        const aclIdx = asgCols.findIndex(c => c.header === "Access Level");
        if (aclIdx >= 0) {
          const aclLetter = asgWs.getColumn(aclIdx + 1).letter;
          const lastDataRow = 1 + asgSamples.length + 8; // header + samples + blank rows
          for (let r = 2; r <= lastDataRow; r++) {
            asgWs.getCell(`${aclLetter}${r}`).dataValidation = {
              type: "list",
              allowBlank: true,
              formulae: ['"Admin,Manager,User"'],
              showErrorMessage: false,
              showInputMessage: true,
              promptTitle: "Access Level",
              prompt: "Admin — full edit access  |  Manager — manage projects  |  User — view only",
            };
          }
        }
      }

      // ── Schedule tab ──────────────────────────────────────────────────────
      const SCHED_COLS = [
        { header: "Project Title",   key: "ProjectTitle", hint: "★ Exact project/opportunity title from the main tab — must match exactly",  width: 36 },
        { header: "Phase Name",      key: "PhaseName",    hint: "★ Phase or stage name — e.g. Design, Construction, Closeout",               width: 26 },
        { header: "Phase Order",     key: "PhaseOrder",   hint: "Sequence number (1, 2, 3…) — controls display order",                       width: 14 },
        { header: "Start Date",      key: "StartDate",    hint: "YYYY-MM-DD — phase start date",                                             width: 14 },
        { header: "End Date",        key: "EndDate",      hint: "YYYY-MM-DD — phase end date",                                               width: 14 },
        { header: "Duration (days)", key: "Duration",     hint: "Calendar days this phase spans (optional when Start + End are both set)",    width: 16 },
        { header: "Milestone",       key: "Milestone",    hint: "Yes / No — is this a key milestone?",                                       width: 12 },
        { header: "% Complete",      key: "PctComplete",  hint: "0–100 — current phase completion percentage",                               width: 12 },
        { header: "Notes",           key: "Notes",        hint: "Any notes about this phase (optional)",                                     width: 36 },
      ];
      const schedWs = wb.addWorksheet("Schedule");
      SCHED_COLS.forEach((c, i) => { schedWs.getColumn(i + 1).width = c.width; });
      const schedHdr = schedWs.addRow(SCHED_COLS.map(c => c.header));
      schedHdr.height = 22;
      schedHdr.eachCell((cell, colNum) => {
        cell.font      = { bold: true, color: { argb: WHITE }, size: 11 };
        cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border    = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
        const col = SCHED_COLS[colNum - 1];
        if (col?.hint) cell.note = col.hint;
      });
      const schedSamples: Record<string, string>[] = module === "clients" ? [
        { ProjectTitle: "Downtown Rail Extension — Phase 2",  PhaseName: "Survey & Design",       PhaseOrder: "1", StartDate: "2024-03-01", EndDate: "2024-05-31", Duration: "91",  Milestone: "No",  PctComplete: "100", Notes: "Geotechnical surveys and schematic design complete" },
        { ProjectTitle: "Downtown Rail Extension — Phase 2",  PhaseName: "Tunnel Boring",          PhaseOrder: "2", StartDate: "2024-06-01", EndDate: "2025-12-31", Duration: "579", Milestone: "No",  PctComplete: "45",  Notes: "" },
        { ProjectTitle: "Downtown Rail Extension — Phase 2",  PhaseName: "Fit-Out & Testing",      PhaseOrder: "3", StartDate: "2026-01-01", EndDate: "2026-09-30", Duration: "272", Milestone: "Yes", PctComplete: "0",   Notes: "Revenue service milestone" },
        { ProjectTitle: "Surgical Wing Expansion",            PhaseName: "Schematic Design",       PhaseOrder: "1", StartDate: "2024-06-15", EndDate: "2024-09-30", Duration: "107", Milestone: "No",  PctComplete: "100", Notes: "" },
        { ProjectTitle: "Surgical Wing Expansion",            PhaseName: "Construction",           PhaseOrder: "2", StartDate: "2024-10-01", EndDate: "2025-11-30", Duration: "425", Milestone: "No",  PctComplete: "65",  Notes: "" },
        { ProjectTitle: "Surgical Wing Expansion",            PhaseName: "Closeout",               PhaseOrder: "3", StartDate: "2025-12-01", EndDate: "2025-12-31", Duration: "30",  Milestone: "Yes", PctComplete: "0",   Notes: "Final OSHPD inspection" },
        { ProjectTitle: "Terminal B Modernization",           PhaseName: "Design & Permit",        PhaseOrder: "1", StartDate: "2025-01-20", EndDate: "2025-06-30", Duration: "161", Milestone: "No",  PctComplete: "100", Notes: "" },
        { ProjectTitle: "Terminal B Modernization",           PhaseName: "Construction",           PhaseOrder: "2", StartDate: "2025-07-01", EndDate: "2027-05-31", Duration: "699", Milestone: "Yes", PctComplete: "22",  Notes: "Substantial completion milestone" },
        { ProjectTitle: "STEM Research & Innovation Hub",     PhaseName: "Design Development",     PhaseOrder: "1", StartDate: "2025-02-01", EndDate: "2025-06-14", Duration: "132", Milestone: "No",  PctComplete: "100", Notes: "" },
        { ProjectTitle: "STEM Research & Innovation Hub",     PhaseName: "Construction",           PhaseOrder: "2", StartDate: "2025-06-15", EndDate: "2027-02-28", Duration: "624", Milestone: "Yes", PctComplete: "18",  Notes: "Building systems commissioning milestone" },
        { ProjectTitle: "Waterfront Mixed-Use Redevelopment", PhaseName: "Pre-Construction",      PhaseOrder: "1", StartDate: "2025-04-01", EndDate: "2025-08-31", Duration: "152", Milestone: "No",  PctComplete: "100", Notes: "Site clearance and enabling works" },
        { ProjectTitle: "Waterfront Mixed-Use Redevelopment", PhaseName: "Construction Phase 1",  PhaseOrder: "2", StartDate: "2025-09-01", EndDate: "2027-03-31", Duration: "576", Milestone: "Yes", PctComplete: "8",   Notes: "Residential towers structural completion" },
      ] : [
        { ProjectTitle: "Harbor District Mixed-Use Development", PhaseName: "Schematic Design",  PhaseOrder: "1", StartDate: "2026-01-01", EndDate: "2026-06-30", Duration: "180", Milestone: "No",  PctComplete: "0", Notes: "Subject to contract award" },
        { ProjectTitle: "Harbor District Mixed-Use Development", PhaseName: "Construction",      PhaseOrder: "2", StartDate: "2026-07-01", EndDate: "2027-06-30", Duration: "364", Milestone: "Yes", PctComplete: "0", Notes: "Substantial completion milestone" },
        { ProjectTitle: "Regional Airport Concourse Expansion",  PhaseName: "Design",            PhaseOrder: "1", StartDate: "2025-10-01", EndDate: "2026-03-31", Duration: "181", Milestone: "No",  PctComplete: "0", Notes: "" },
        { ProjectTitle: "Regional Airport Concourse Expansion",  PhaseName: "Construction",      PhaseOrder: "2", StartDate: "2026-04-01", EndDate: "2027-03-31", Duration: "364", Milestone: "Yes", PctComplete: "0", Notes: "Phased handover milestone" },
        { ProjectTitle: "K-12 STEM Campus — Phase 1",           PhaseName: "Design Development", PhaseOrder: "1", StartDate: "2026-04-01", EndDate: "2026-09-30", Duration: "182", Milestone: "No",  PctComplete: "0", Notes: "" },
        { ProjectTitle: "K-12 STEM Campus — Phase 1",           PhaseName: "Construction",       PhaseOrder: "2", StartDate: "2026-10-01", EndDate: "2027-08-31", Duration: "333", Milestone: "Yes", PctComplete: "0", Notes: "School opening milestone" },
        { ProjectTitle: "Municipal Water Treatment Upgrade",     PhaseName: "Engineering",        PhaseOrder: "1", StartDate: "2026-06-01", EndDate: "2027-05-31", Duration: "364", Milestone: "No",  PctComplete: "0", Notes: "" },
        { ProjectTitle: "Municipal Water Treatment Upgrade",     PhaseName: "Construction",       PhaseOrder: "2", StartDate: "2027-06-01", EndDate: "2028-05-31", Duration: "365", Milestone: "Yes", PctComplete: "0", Notes: "Plant commissioning milestone" },
        { ProjectTitle: "Corporate HQ Interior Fit-Out",         PhaseName: "Design",             PhaseOrder: "1", StartDate: "2025-08-01", EndDate: "2025-09-30", Duration: "60",  Milestone: "No",  PctComplete: "0", Notes: "" },
        { ProjectTitle: "Corporate HQ Interior Fit-Out",         PhaseName: "Construction",       PhaseOrder: "2", StartDate: "2025-10-01", EndDate: "2026-02-28", Duration: "150", Milestone: "Yes", PctComplete: "0", Notes: "Tenant handover milestone" },
      ];
      schedSamples.forEach((s, idx) => {
        const row = schedWs.addRow(SCHED_COLS.map(c => s[c.key] ?? ""));
        row.height = 18;
        row.eachCell({ includeEmpty: true }, cell => {
          cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: idx % 2 === 0 ? "FFFFFFFF" : ALT } };
          cell.font      = { size: 10, italic: true, color: { argb: "FF666666" } };
          cell.alignment = { vertical: "middle" };
        });
      });
      for (let r = 0; r < 8; r++) {
        const row = schedWs.addRow(SCHED_COLS.map(() => ""));
        row.height = 18;
        row.eachCell({ includeEmpty: true }, cell => {
          cell.font = { size: 10 }; cell.alignment = { vertical: "middle" };
        });
      }
      schedWs.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];
      applyDateColumnValidation(schedWs, SCHED_COLS, 2, 1 + schedSamples.length + 8);
    }

    // Derive a descriptive filename from the specific gap, not just the module.
    const GAP_FILENAMES: Record<string, string> = {
      // field-level gaps
      "field:team:office":       "office_locations_fill",
      "field:team:job-title":    "job_titles_fill",
      "field:team:login-email":  "staff_login_emails_fill",
      "field:clients:division":  "projects_division_fill",
      "field:clients:contract-value": "projects_contract_values_fill",
      // readiness metric gaps
      "unassigned_projects":     "projects_division_fill",
      "orphaned_people":         "staff_assignments_fill",
      "no_login_email":          "staff_login_emails_fill",
      "missing_contract_value":  "projects_contract_values_fill",
      "missing_office":          "office_locations_fill",
      "missing_job_title":       "job_titles_fill",
      // module-level gaps
      "module:team":             "staff_roster_template",
      "module:clients":          "projects_template",
      "module:opportunities":    "opportunities_template",
      "module:leads":            "leads_template",
      "module:assignments":      "assignments_template",
      "module:demand":           "open_positions_template",
      "module:companies":        "companies_template",
    };
    const gapKey = gapId || (metricKey ? metricKey : "");
    const specificName = GAP_FILENAMES[gapKey]
      ?? (TAB_NAMES[module] ?? module).toLowerCase().replace(/[^a-z ]/g, "").trim().replace(/\s+/g, "_") + "_fill";
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="rmone_${specificName}.xlsx"`);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return res.send(buf);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /api/onboarding/full-template ─────────────────────────────────────
// One Excel file, every module as a separate tab, each tab seeded with
// dummy data rows so the user can see the expected format immediately.
router.get("/full-template", async (_req: Request, res: Response) => {
  try {
    const NAVY  = "FF1E3A5F";
    const WHITE = "FFFFFFFF";
    const ALT   = "FFF0F4FA";

    const wb = new ExcelJS.Workbook();
    wb.creator = "RM ONE Auto-Onboarding";
    wb.created = new Date();

    const TABS: Array<{ key: string; name: string }> = [
      { key: "module:team",          name: "Staff & Team"   },
      { key: "module:clients",       name: "Projects"       },
      { key: "module:opportunities", name: "Opportunities"  },
      { key: "module:leads",         name: "Leads"          },
      { key: "module:demand",        name: "Open Positions" },
      { key: "module:assignments",   name: "Assignments"    },
      { key: "module:companies",     name: "Companies"      },
    ];

    const FULL_SIMP_KEY: Record<string, string> = {
      "module:team":          "team",
      "module:clients":       "clients",
      "module:opportunities": "opportunities",
      "module:leads":         "leads",
      "module:assignments":   "assignments",
      "module:demand":        "demand",
      "module:companies":     "companies",
    };
    for (const { key, name } of TABS) {
      const sk = FULL_SIMP_KEY[key];
      const simpCols = sk ? (SIMPLIFIED_TEMPLATE_COLUMNS[sk] ?? []) : [];
      const cols: GapColumn[] = simpCols.length > 0
        ? simpCols.map(c => ({ header: c.header, key: c.key, width: c.width, hint: c.hint }))
        : (GAP_ESSENTIAL_COLUMNS[key] ?? []);
      const dummyRows = MODULE_SAMPLE_ROWS[key] ?? [];

      const ws = wb.addWorksheet(name);
      cols.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

      // Header row
      const hRow = ws.addRow(cols.map(c => c.header));
      hRow.height = 22;
      hRow.eachCell(cell => {
        cell.font      = { bold: true, color: { argb: WHITE }, size: 11 };
        cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border    = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
      });

      // Dummy data rows
      dummyRows.forEach((rowData, idx) => {
        const row = ws.addRow(cols.map(c => rowData[c.key] ?? ""));
        row.height = 18;
        row.eachCell({ includeEmpty: true }, cell => {
          cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: idx % 2 === 0 ? WHITE : ALT } };
          cell.font      = { size: 10 };
          cell.alignment = { vertical: "middle" };
        });
      });

      // Extra blank rows for user input
      for (let r = 0; r < 7; r++) {
        const row = ws.addRow(cols.map(() => ""));
        row.height = 18;
        row.eachCell({ includeEmpty: true }, cell => {
          cell.font      = { size: 10 };
          cell.alignment = { vertical: "middle" };
        });
      }

      ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];
      applyDateColumnValidation(ws, cols, 2, 1 + dummyRows.length + 7);

      // ── Access Level dropdown ─────────────────────────────────────────────
      {
        const aclIdx = cols.findIndex(c => c.header === "Access Level");
        if (aclIdx >= 0) {
          const aclLetter = ws.getColumn(aclIdx + 1).letter;
          const lastDataRow = 1 + dummyRows.length + 7;
          for (let r = 2; r <= lastDataRow; r++) {
            ws.getCell(`${aclLetter}${r}`).dataValidation = {
              type: "list",
              allowBlank: true,
              formulae: ['"Admin,Manager,User"'],
              showErrorMessage: false,
              showInputMessage: true,
              promptTitle: "Access Level",
              prompt: "Admin — full edit access  |  Manager — manage projects  |  User — view only",
            };
          }
        }
      }
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="rmone_import_template.xlsx"');
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return res.send(buf);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /api/onboarding/template ──────────────────────────────────────────
router.get("/template", async (_req: Request, res: Response) => {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = "RM ONE Auto-Onboarding";
    wb.created = new Date();

    const NAVY  = "FF1E3A5F";
    const WHITE = "FFFFFFFF";
    const HINT  = "FF888888";
    const ALT   = "FFF0F4FA";

    function styleHeader(ws: ExcelJS.Worksheet, row: ExcelJS.Row) {
      row.height = 22;
      row.eachCell(cell => {
        cell.font      = { bold: true, color: { argb: WHITE }, size: 11 };
        cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border    = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
      });
    }
    function styleData(row: ExcelJS.Row, even: boolean) {
      row.height = 18;
      row.eachCell({ includeEmpty: true }, cell => {
        cell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: even ? "FFFFFFFF" : ALT } };
        cell.font  = { size: 10 };
        cell.alignment = { vertical: "middle" };
      });
    }

    // ── 📋 Instructions ───────────────────────────────────────────────
    // A styled, colour-coded cover sheet: title banner, coloured section
    // bands, alternating row shading, and soft separators for readability.
    const instr = wb.addWorksheet("📋 Instructions", {
      views: [{ showGridLines: false }],
    });
    instr.getColumn(1).width = 34;
    instr.getColumn(2).width = 74;

    const GREEN  = "FF2E7D32"; // core (required)
    const TEAL   = "FF0F766E"; // how to use
    const AMBER  = "FFB45309"; // history (optional)
    const PURPLE = "FF6D28D9"; // tips
    const LABEL  = "FF1E3A5F"; // label text
    const BODY   = "FF374151"; // body text
    const BAND   = "FFEFF4FA"; // subtitle band
    const RULE   = "FFDDE3EC"; // row separator

    type Line =
      | { t: "title"; a: string }
      | { t: "subtitle"; a: string }
      | { t: "section"; a: string; color: string }
      | { t: "row"; a: string; b: string }
      | { t: "spacer" };

    const lines: Line[] = [
      { t: "title",    a: "RM ONE Client Data Upload Template" },
      { t: "subtitle", a: "Fill in your data on the tabs below, then upload this file on the Import page." },
      { t: "spacer" },
      { t: "section",  a: "HOW TO USE THIS FILE", color: TEAL },
      { t: "row", a: "1.  Fill in the 3 core tabs", b: "Your Team · Clients & Projects · Assignments" },
      { t: "row", a: "2.  (Optional) Add history",  b: "Fill the 6 history tabs only if importing past activity — see below." },
      { t: "row", a: "3.  Use the sample rows as a guide", b: "Delete them before uploading, or leave them — we'll ignore duplicates." },
      { t: "row", a: "4.  Upload to RM ONE", b: "Enter your company name on the Import page, then drop this file." },
      { t: "row", a: "5.  Confirm & Import", b: "Review the summary and click Import. Done!" },
      { t: "spacer" },
      { t: "section",  a: "TAB GUIDE — CORE (required)", color: GREEN },
      { t: "row", a: "Your Team", b: "All staff — divisions, departments, roles, and user accounts in one place." },
      { t: "row", a: "Clients & Projects", b: "Client companies (with contacts), active projects, opportunities, and leads." },
      { t: "row", a: "Assignments", b: "Who works on which project, at what allocation %. Includes per-assignment role, division, actual hours, and billed hours." },
      { t: "row", a: "Open Positions", b: "Open headcount / demand — roles you need to hire or fill per project." },
      { t: "spacer" },
      { t: "section",  a: "TAB GUIDE — HISTORY (optional)", color: AMBER },
      { t: "row", a: "Leave blank unless importing past data", b: "" },
      { t: "row", a: "Tasks", b: "Workflow tasks per project — title, stage, due date, owner." },
      { t: "row", a: "Logged Hours", b: "Hours logged by a person against a project on a date." },
      { t: "row", a: "Timesheets", b: "Weekly total hours per person." },
      { t: "row", a: "Service Requests", b: "Service desk requests — title, status, priority, assignee." },
      { t: "row", a: "Action Requests", b: "Action / change / approval requests." },
      { t: "row", a: "Portfolio", b: "Portfolio initiatives linked to a client." },
      { t: "spacer" },
      { t: "section",  a: "TIPS", color: PURPLE },
      { t: "row", a: "Multiple contacts per company?", b: "Separate them with a semicolon: John Smith; Sarah Lee; Tom Brown" },
      { t: "row", a: "Project or Opportunity?", b: "Set the Type column to 'Project' or 'Opportunity' on the Clients tab." },
      { t: "row", a: "Assign by name", b: "Use the project title in Assignments — no ticket IDs needed." },
      { t: "row", a: "Dates", b: "All dates must be in YYYY-MM-DD format (e.g. 2026-03-15)." },
      { t: "row", a: "Need help?", b: "Contact your RM ONE implementation team." },
    ];

    let even = false;
    lines.forEach(line => {
      if (line.t === "spacer") {
        instr.addRow(["", ""]).height = 7;
        return;
      }
      const r = instr.addRow([line.a, line.t === "row" ? line.b : ""]);
      const ref = `A${r.number}:B${r.number}`;

      if (line.t === "title") {
        instr.mergeCells(ref);
        r.height = 34;
        const c = r.getCell(1);
        c.font = { bold: true, size: 16, color: { argb: WHITE } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        c.alignment = { horizontal: "center", vertical: "middle" };
      } else if (line.t === "subtitle") {
        instr.mergeCells(ref);
        r.height = 22;
        const c = r.getCell(1);
        c.font = { italic: true, size: 10, color: { argb: HINT } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } };
        c.alignment = { horizontal: "center", vertical: "middle" };
      } else if (line.t === "section") {
        instr.mergeCells(ref);
        r.height = 24;
        const c = r.getCell(1);
        c.font = { bold: true, size: 11, color: { argb: WHITE } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: line.color } };
        c.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
        even = false;
      } else {
        r.height = 21;
        const bg = even ? "FFFFFFFF" : ALT;
        even = !even;
        const ca = r.getCell(1);
        const cb = r.getCell(2);
        ca.font = { bold: true, size: 10, color: { argb: LABEL } };
        cb.font = { size: 10, color: { argb: BODY } };
        ca.alignment = { vertical: "middle", indent: 1, wrapText: true };
        cb.alignment = { vertical: "middle", indent: 1, wrapText: true };
        ca.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        cb.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        ca.border = { bottom: { style: "hair", color: { argb: RULE } } };
        cb.border = { bottom: { style: "hair", color: { argb: RULE } } };
      }
    });

    instr.views = [{ showGridLines: false, state: "frozen", ySplit: 2 }];

    // ── Helper: build a data sheet ────────────────────────────────────
    // ROW 1 holds the real column name (e.g. "Division"); the friendly
    // guidance/example is attached as a hover comment on that cell rather
    // than as a second header row. The parser reads row 1 as the header,
    // so whatever the user names a column — kept or renamed — is exactly
    // what gets extracted and shown on the mapping screen. Every tab uses
    // this single-header layout.
    function buildPlainSheet(
      tabName: string,
      cols: { header: string; key: string; hint: string; width?: number }[],
      samples: Record<string, string>[],
    ): ExcelJS.Worksheet {
      const ws = wb.addWorksheet(tabName);

      // Row 1 — headers (canonical), with the hint as a hover comment
      const hdr = ws.addRow(cols.map(c => c.header));
      styleHeader(ws, hdr);
      hdr.eachCell((cell, i) => {
        const c = cols[i - 1];
        if (c?.hint) cell.note = c.hint;
      });

      // Sample rows
      samples.forEach((s, i) => {
        ws.addRow(cols.map(c => s[c.key] ?? ""));
        styleData(ws.lastRow!, i % 2 === 0);
      });

      // Widths
      cols.forEach((c, i) => {
        ws.getColumn(i + 1).width = c.width ?? Math.max(c.header.length + 6, 20);
      });

      applyDateColumnValidation(ws, cols, 2, 1 + samples.length + 20);

      return ws;
    }

    // ── Tab 1: Your Team ──────────────────────────────────────────────
    const teamSamples = [
      { Division: "Infrastructure", Department: "Engineering",        Role: "Senior Engineer",  BillingRate: "180", EmpLaborRate: "95", EmpCostRate: "115", JobTitle: "Lead Engineer",   JobProfile: "Leads structural design work",                    UserName: "alice@company.com",  FullName: "Alice Smith",  Email: "alice@company.com",  Password: "Welcome@123", UserRole: "Admin",   Manager: "",                  StartDate: "2022-01-10", EndDate: "",           IsManager: "1", CRMBusinessUnitChoice: "Infrastructure BU", FirstName: "Alice", LastName: "Smith" },
      { Division: "Infrastructure", Department: "Project Management", Role: "Project Manager",  BillingRate: "150", EmpLaborRate: "80", EmpCostRate: "95",  JobTitle: "Project Manager", JobProfile: "Runs project delivery and client coordination",   UserName: "bob@company.com",    FullName: "Bob Jones",    Email: "bob@company.com",    Password: "Welcome@123", UserRole: "Manager", Manager: "alice@company.com", StartDate: "2022-03-15", EndDate: "2028-12-31", IsManager: "1", CRMBusinessUnitChoice: "Infrastructure BU", FirstName: "Bob",   LastName: "Jones" },
      { Division: "Infrastructure", Department: "Engineering",        Role: "Junior Engineer",  BillingRate: "120", EmpLaborRate: "60", EmpCostRate: "72",  JobTitle: "Engineer II",     JobProfile: "Production engineering and drawing packages",     UserName: "carol@company.com",  FullName: "Carol White",  Email: "carol@company.com",  Password: "Welcome@123", UserRole: "User",    Manager: "bob@company.com",   StartDate: "2023-06-01", EndDate: "2027-12-31", IsManager: "0", CRMBusinessUnitChoice: "Infrastructure BU", FirstName: "Carol", LastName: "White" },
    ];
    const teamWs = buildPlainSheet("Your Team", SIMPLIFIED_TEMPLATE_COLUMNS.team, teamSamples);
    applyAclDropdown(teamWs, SIMPLIFIED_TEMPLATE_COLUMNS.team, teamSamples.length + 20);

    // ── Tab 2: Clients & Projects ─────────────────────────────────────
    buildPlainSheet("Clients & Projects", SIMPLIFIED_TEMPLATE_COLUMNS.clients, [
      { Type: "Project",     CompanyName: "Metro Transit Authority", ContactName: "John Metro; Sarah Metro", ClientRep: "alice@company.com", CRMHealth: "Good", MarketSector: "Transportation", ProjectTitle: "Downtown Transit Expansion",   ERPJobID: "ERP-1001", ProjectType: "Design",      ServiceType: "Engineering",  RequestCategory: "", Category: "Transit Infrastructure", ProjectTag: "transit", ContractValue: "4500000",  ContractLimit: "",        GrossMargin: "32", ContractType: "T&M",   ChanceOfSuccessChoice: "",   Status: "Active", CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Engineering",        StartDate: "2026-02-01", EndDate: "2027-08-31", ProposalPhaseDueDate: "",         PreconStartDate: "",           PreconEndDate: "",        ConstStartDate: "",          EstimatedConstructionStart: "2026-06-01", EstimatedConstructionEnd: "2027-08-31", CloseoutStartDate: "", ClosedDate: "", ApproxContractValue: "4800000", LaborContractAmount: "3200000", SectorChoice: "Transportation", PointOfContact: "John Metro",  ProjectLeadUser: "alice@company.com", ProjectManagerUser: "bob@company.com",   SeniorProjectManagerUser: "alice@company.com", BusinessLeadUser: "alice@company.com", OwnerUser: "alice@company.com", LeadEstimatorUser: "",            LeadSuperintendentUser: "",            EstimatorUser: "",            BidDueDate: "",           InterviewDate: "",           CRMOpportunityStatusChoice: "", OwnerName: "City Transit Commission", ProjectId: "ERP-1001", ShortName: "Transit Expansion", CloseoutDate: "2027-11-30", NonOperatingCost: "180000", ContractedAmount: "4500000", ProposalAmount: "4800000", BidAmount: "4650000", ChangeOrders: "120000", ApprovedChangeOrders: "60000", Retainage: "225000", FeePct: "8", Contingency: "200000", ProjectCost: "3600000", ProjectPhasePctComplete: "15", PriorityLookup: "High", NextMilestone: "30% design submission", NextMilestoneDate: "2026-04-15", Description: "Corridor transit expansion adding two light-rail stations and signal upgrades.", ProjectSummaryNote: "Design kickoff complete; survey and geotech underway.", StreetAddress1: "100 Transit Way", City: "Chicago", StateLookup: "IL", Office: "Chicago", LinkedOpportunity: "Downtown Transit Expansion Bid" },
      { Type: "Project",     CompanyName: "Skyline Developers",      ContactName: "Sarah Skyline",           ClientRep: "bob@company.com",   CRMHealth: "Good", MarketSector: "Construction",   ProjectTitle: "Skyline Tower Phase 2",        ERPJobID: "ERP-1002", ProjectType: "Construction", ServiceType: "PM",           RequestCategory: "", Category: "Commercial High-Rise", ProjectTag: "highrise",        ContractValue: "8200000",  ContractLimit: "8500000", GrossMargin: "28", ContractType: "Fixed", ChanceOfSuccessChoice: "",   Status: "Active", CRMBusinessUnitChoice: "Buildings BU",      Division: "Buildings",      Department: "Project Management", StartDate: "2026-03-15", EndDate: "2028-12-31", ProposalPhaseDueDate: "",         PreconStartDate: "2026-01-01", PreconEndDate: "2026-03-14", ConstStartDate: "2026-03-15", EstimatedConstructionStart: "2026-03-15", EstimatedConstructionEnd: "2028-10-31", CloseoutStartDate: "", ClosedDate: "", ApproxContractValue: "8500000", LaborContractAmount: "6000000", SectorChoice: "Construction",   PointOfContact: "Sarah Skyline", ProjectLeadUser: "bob@company.com",   ProjectManagerUser: "bob@company.com",   SeniorProjectManagerUser: "alice@company.com", BusinessLeadUser: "alice@company.com", OwnerUser: "bob@company.com",   LeadEstimatorUser: "",            LeadSuperintendentUser: "",            EstimatorUser: "",            BidDueDate: "",           InterviewDate: "",           CRMOpportunityStatusChoice: "", OwnerName: "Skyline Developers LLC", ProjectId: "ERP-1002", ShortName: "Skyline Ph2", CloseoutDate: "2029-03-31", NonOperatingCost: "260000", ContractedAmount: "8200000", ProposalAmount: "8500000", BidAmount: "8200000", ChangeOrders: "150000", ApprovedChangeOrders: "90000", Retainage: "410000", FeePct: "6.5", Contingency: "350000", ProjectCost: "6800000", ProjectPhasePctComplete: "10", PriorityLookup: "Medium", NextMilestone: "Foundation pour complete", NextMilestoneDate: "2026-06-30", Description: "28-story mixed-use tower — phase 2 core and shell plus tenant improvements.", ProjectSummaryNote: "Precon complete; early site works mobilized on schedule.", StreetAddress1: "800 Skyline Avenue", City: "Seattle", StateLookup: "WA", Office: "Seattle", LinkedOpportunity: "Skyline Tower Phase 2 Pursuit" },
      { Type: "Opportunity", CompanyName: "Harbor Bridge Corp",       ContactName: "Mike Harbor",             ClientRep: "alice@company.com", CRMHealth: "Fair", MarketSector: "Infrastructure", ProjectTitle: "Waterfront Redevelopment Bid", ERPJobID: "OPP-2001", ProjectType: "Consulting",   ServiceType: "Architecture", RequestCategory: "", Category: "Urban Redevelopment", ProjectTag: "waterfront",        ContractValue: "12000000", ContractLimit: "",        GrossMargin: "40", ContractType: "GMP",   ChanceOfSuccessChoice: "65", Status: "Active", CRMBusinessUnitChoice: "Infrastructure BU", Division: "Infrastructure", Department: "Engineering",        StartDate: "2026-09-01", EndDate: "2029-06-30", ProposalPhaseDueDate: "2026-07-15", PreconStartDate: "",           PreconEndDate: "",        ConstStartDate: "",          EstimatedConstructionStart: "",           EstimatedConstructionEnd: "",           CloseoutStartDate: "", ClosedDate: "", ApproxContractValue: "11500000",        LaborContractAmount: "4200000",        SectorChoice: "Infrastructure", PointOfContact: "Mike Harbor",   ProjectLeadUser: "alice@company.com", ProjectManagerUser: "alice@company.com", SeniorProjectManagerUser: "",                  BusinessLeadUser: "alice@company.com", OwnerUser: "alice@company.com", LeadEstimatorUser: "carol@company.com", LeadSuperintendentUser: "carol@company.com", EstimatorUser: "carol@company.com", BidDueDate: "2026-07-01", InterviewDate: "2026-07-10", CRMOpportunityStatusChoice: "Prospecting", OwnerName: "Harbor Bridge Corp", ProjectId: "OPP-2001", ShortName: "Waterfront Bid", CloseoutDate: "2029-09-30", NonOperatingCost: "350000", ContractedAmount: "0", ProposalAmount: "11500000", BidAmount: "11800000", ChangeOrders: "0", ApprovedChangeOrders: "0", Retainage: "0", FeePct: "9", Contingency: "500000", ProjectCost: "9600000", ProjectPhasePctComplete: "0", PriorityLookup: "Medium", NextMilestone: "Proposal submission", NextMilestoneDate: "2026-07-15", Description: "Waterfront district redevelopment — marina, esplanade and mixed-use parcels.", ProjectSummaryNote: "Pursuit team assembled; proposal narrative in progress.", StreetAddress1: "1 Harbor Front Road", City: "Boston", StateLookup: "MA", Office: "Boston", LinkedOpportunity: "Waterfront Redevelopment Bid" },
    ]);

    // ── Tab 3: Assignments ────────────────────────────────────────────
    const asgSamples = [
      { Project: "Downtown Transit Expansion", Resource: "bob@company.com",   AllocationStartDate: "2026-02-01", AllocationEndDate: "2027-08-31", AllocationHour: "1600", AllocationType: "Hard", Role: "Project Manager",  JobTitle: "Project Manager", Division: "Infrastructure", Department: "Engineering",        BillingRate: "150", EmpLaborRate: "",  EmpCostRate: "", ActualStartDate: "2026-02-01", ActualEndDate: "",           ActualHour: "",    BilledHours: "", UserRole: "Admin" },
      { Project: "Downtown Transit Expansion", Resource: "carol@company.com", AllocationStartDate: "2026-02-01", AllocationEndDate: "2027-08-31", AllocationHour: "1600", AllocationType: "Hard", Role: "Junior Engineer",  JobTitle: "Engineer II",     Division: "Infrastructure", Department: "Engineering",        BillingRate: "120", EmpLaborRate: "",  EmpCostRate: "", ActualStartDate: "2026-02-01", ActualEndDate: "",           ActualHour: "",    BilledHours: "", UserRole: "User" },
      { Project: "Skyline Tower Phase 2",      Resource: "bob@company.com",   AllocationStartDate: "2026-03-15", AllocationEndDate: "2028-12-31", AllocationHour: "2400", AllocationType: "Hard", Role: "Project Manager",  JobTitle: "Project Manager", Division: "Buildings",      Department: "Project Management", BillingRate: "150", EmpLaborRate: "",  EmpCostRate: "", ActualStartDate: "2026-03-15", ActualEndDate: "2028-11-30", ActualHour: "2200", BilledHours: "2100", UserRole: "Admin" },
    ];
    const asgWs = buildPlainSheet("Assignments", SIMPLIFIED_TEMPLATE_COLUMNS.assignments, asgSamples);
    applyAclDropdown(asgWs, SIMPLIFIED_TEMPLATE_COLUMNS.assignments, asgSamples.length + 20);

    // ── Tab 4: Open Positions (Demand) ───────────────────────────────
    buildPlainSheet("Open Positions", SIMPLIFIED_TEMPLATE_COLUMNS.demand, [
      { Division: "Infrastructure", Department: "Engineering",        Role: "Senior Engineer",  Project: "Downtown Transit Expansion", AllocationStartDate: "2026-06-01", AllocationEndDate: "2027-08-31", AllocationHour: "2080" },
      { Division: "Buildings",      Department: "Project Management", Role: "Project Manager",  Project: "Skyline Tower Phase 2",      AllocationStartDate: "2026-05-01", AllocationEndDate: "2028-12-31", AllocationHour: "1760" },
      { Division: "Infrastructure", Department: "Engineering",        Role: "CAD Technician",   Project: "Downtown Transit Expansion", AllocationStartDate: "2026-07-01", AllocationEndDate: "2026-12-31", AllocationHour: "960" },
    ]);

    // ══════════════════════════════════════════════════════════════════
    //  OPTIONAL HISTORY TABS — only fill these to import past activity.
    //  Headers match RM ONE column names so they import with no mapping.
    //  Lookup values are friendly: enter a project title, a username/email,
    //  or a company name and the pipeline resolves it automatically.
    // ══════════════════════════════════════════════════════════════════

    // ── Tab 4: Tasks (→ ModuleTasks) ──────────────────────────────────
    buildPlainSheet("Tasks", [
      { header: "TicketId",    key: "TicketId",    hint: "Project title (from Clients & Projects) — or ticket ID if known", width: 34 },
      { header: "Title",       key: "Title",       hint: "★ Task name (e.g. Submit 30% design)",                            width: 30 },
      { header: "Description", key: "Description", hint: "Task details (optional)",                                         width: 34 },
      { header: "StageStep",   key: "StageStep",   hint: "Workflow stage / step (optional)",                                width: 18 },
      { header: "DueDate",     key: "DueDate",     hint: "YYYY-MM-DD — due date",                                           width: 14 },
      { header: "AssignedTo",  key: "AssignedTo",  hint: "Username (email) from Your Team — who owns the task",             width: 28 },
      { header: "Status",      key: "Status",      hint: "e.g. Open / In Progress / Done",                                  width: 16 },
    ], [
      { TicketId: "Downtown Transit Expansion", Title: "Submit 30% design package", Description: "Issue for client review", StageStep: "Design", DueDate: "2026-04-15", AssignedTo: "bob@company.com",   Status: "In Progress" },
      { TicketId: "Skyline Tower Phase 2",      Title: "Foundation inspection",     Description: "Coordinate third-party inspection of tower footings", StageStep: "Construction", DueDate: "2026-05-01", AssignedTo: "carol@company.com", Status: "Open" },
    ]);

    // ── Tab 5: Logged Hours (→ TicketHours) ───────────────────────────
    buildPlainSheet("Logged Hours", [
      { header: "TicketId",   key: "TicketId",   hint: "★ Project title (from Clients & Projects) — or ticket ID if known", width: 34 },
      { header: "ResourceID", key: "ResourceID", hint: "★ Username (email) of the person who logged the hours",             width: 28 },
      { header: "Hours",      key: "Hours",      hint: "Hours logged (number, e.g. 8)",                                     width: 12 },
      { header: "LogDate",    key: "LogDate",    hint: "YYYY-MM-DD — date worked",                                          width: 14 },
    ], [
      { TicketId: "Downtown Transit Expansion", ResourceID: "carol@company.com", Hours: "8", LogDate: "2026-02-03" },
      { TicketId: "Downtown Transit Expansion", ResourceID: "bob@company.com",   Hours: "4", LogDate: "2026-02-03" },
    ]);

    // ── Tab 6: Timesheets (→ ResourceTimeSheet) ───────────────────────
    buildPlainSheet("Timesheets", [
      { header: "ResourceID",    key: "ResourceID",    hint: "★ Username (email) from Your Team",            width: 28 },
      { header: "WeekStartDate", key: "WeekStartDate", hint: "YYYY-MM-DD — Monday the week starts",          width: 16 },
      { header: "TotalHours",    key: "TotalHours",    hint: "Total hours that week (number)",               width: 14 },
      { header: "Status",        key: "Status",        hint: "e.g. Draft / Submitted / Approved",            width: 16 },
    ], [
      { ResourceID: "carol@company.com", WeekStartDate: "2026-02-02", TotalHours: "40", Status: "Submitted" },
      { ResourceID: "bob@company.com",   WeekStartDate: "2026-02-02", TotalHours: "38", Status: "Approved" },
    ]);

    // ── Tab 7: Service Requests (→ SVCRequests) ───────────────────────
    buildPlainSheet("Service Requests", [
      { header: "Title",       key: "Title",       hint: "★ Request title (e.g. VPN access for new hire)", width: 32 },
      { header: "Description", key: "Description", hint: "Details (optional)",                             width: 34 },
      { header: "Status",      key: "Status",      hint: "e.g. Open / In Progress / Closed",               width: 16 },
      { header: "Priority",    key: "Priority",    hint: "Low / Medium / High",                            width: 12 },
      { header: "AssignedTo",  key: "AssignedTo",  hint: "Username (email) of assignee (optional)",        width: 28 },
      { header: "CreatedDate", key: "CreatedDate", hint: "YYYY-MM-DD — date raised",                       width: 14 },
    ], [
      { Title: "VPN access for new hire", Description: "Provision VPN and badge access for engineer starting 2026-02-16", Status: "Open",        Priority: "Medium", AssignedTo: "alice@company.com", CreatedDate: "2026-02-05" },
      { Title: "Laptop replacement",      Description: "Replace aging field laptop; migrate project files and licenses",  Status: "In Progress", Priority: "High",   AssignedTo: "bob@company.com",   CreatedDate: "2026-02-06" },
    ]);

    // ── Tab 8: Action Requests (→ ACR) ────────────────────────────────
    buildPlainSheet("Action Requests", [
      { header: "Title",       key: "Title",       hint: "★ Request title (e.g. Approve scope change)", width: 32 },
      { header: "RequestType", key: "RequestType", hint: "e.g. Change / Action / Approval",            width: 16 },
      { header: "Status",      key: "Status",      hint: "e.g. Open / Approved / Rejected",            width: 16 },
      { header: "RequestedBy", key: "RequestedBy", hint: "Username (email) of the requester",          width: 28 },
      { header: "CreatedDate", key: "CreatedDate", hint: "YYYY-MM-DD — date raised",                   width: 14 },
    ], [
      { Title: "Approve scope change",   RequestType: "Change",   Status: "Open",     RequestedBy: "bob@company.com",   CreatedDate: "2026-02-06" },
      { Title: "Extend contract budget", RequestType: "Approval", Status: "Approved", RequestedBy: "alice@company.com", CreatedDate: "2026-02-08" },
    ]);

    // ── Tab 9: Portfolio (→ POR) ──────────────────────────────────────
    buildPlainSheet("Portfolio", [
      { header: "Title",            key: "Title",            hint: "★ Initiative / portfolio name",          width: 32 },
      { header: "CompanyLookup",    key: "CompanyLookup",    hint: "Client company name (from Clients tab)", width: 30 },
      { header: "InitiativeLookup", key: "InitiativeLookup", hint: "Parent initiative name (optional)",      width: 28 },
      { header: "Status",           key: "Status",           hint: "e.g. Active / Planned / Closed",         width: 16 },
      { header: "TargetStartDate",  key: "TargetStartDate",  hint: "YYYY-MM-DD — target start",              width: 16 },
      { header: "TargetEndDate",    key: "TargetEndDate",    hint: "YYYY-MM-DD — target end",                width: 16 },
    ], [
      { Title: "Transit Modernization Program", CompanyLookup: "Metro Transit Authority", InitiativeLookup: "Regional Mobility Initiative", Status: "Active",  TargetStartDate: "2026-02-01", TargetEndDate: "2028-12-31" },
      { Title: "Downtown Renewal Portfolio",    CompanyLookup: "Skyline Developers",      InitiativeLookup: "Urban Core Revitalization",    Status: "Planned", TargetStartDate: "2026-06-01", TargetEndDate: "2029-06-30" },
    ]);

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=\"RMOne_Client_Data_Upload.xlsx\"");
    res.send(buf);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/onboarding/template/opportunities ────────────────────────────
// Opportunities-specific Excel template: OPM columns only (forecast dates,
// approx/forecasted values, chance of success, bid dates, etc.)
router.get("/template/opportunities", async (_req: Request, res: Response) => {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = "RM ONE Auto-Onboarding";
    wb.created = new Date();

    const NAVY  = "FF1E3A5F";
    const WHITE = "FFFFFFFF";
    const HINT  = "FF888888";
    const ALT   = "FFF0F4FA";

    function styleHeader(ws: ExcelJS.Worksheet, row: ExcelJS.Row) {
      row.height = 22;
      row.eachCell(cell => {
        cell.font      = { bold: true, color: { argb: WHITE }, size: 11 };
        cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border    = { bottom: { style: "thin", color: { argb: "FFAAAAAA" } } };
      });
    }
    function styleData(row: ExcelJS.Row, even: boolean) {
      row.height = 18;
      row.eachCell({ includeEmpty: true }, cell => {
        cell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: even ? "FFFFFFFF" : ALT } };
        cell.font  = { size: 10 };
        cell.alignment = { vertical: "middle" };
      });
    }
    function buildPlainSheet(
      tabName: string,
      cols: { header: string; key: string; hint: string; width?: number }[],
      samples: Record<string, string>[],
    ) {
      const ws = wb.addWorksheet(tabName);
      const hdr = ws.addRow(cols.map(c => c.header));
      styleHeader(ws, hdr);
      hdr.eachCell((cell, i) => { const c = cols[i - 1]; if (c?.hint) cell.note = c.hint; });
      samples.forEach((s, i) => { ws.addRow(cols.map(c => s[c.key] ?? "")); styleData(ws.lastRow!, i % 2 === 0); });
      cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width ?? Math.max(c.header.length + 6, 20); });
      applyDateColumnValidation(ws, cols, 2, 1 + samples.length + 20);
      return ws;
    }

    // ── Instructions ──────────────────────────────────────────────────
    const instr = wb.addWorksheet("📋 Instructions", { views: [{ showGridLines: false }] });
    instr.getColumn(1).width = 34; instr.getColumn(2).width = 74;
    const TEAL = "FF0F766E"; const GREEN = "FF2E7D32"; const PURPLE = "FF6D28D9";
    const LABEL = "FF1E3A5F"; const BODY = "FF374151"; const BAND = "FFEFF4FA"; const RULE = "FFDDE3EC";
    type Line = { t: "title"|"subtitle"|"section"; a: string; color?: string } | { t: "row"; a: string; b: string } | { t: "spacer"; a: "" };
    const lines: Line[] = [
      { t: "title",    a: "RM ONE Opportunities Upload Template" },
      { t: "subtitle", a: "Fill in the tabs below, then upload this file on the Import page." },
      { t: "spacer", a: "" },
      { t: "section",  a: "HOW TO USE THIS FILE", color: TEAL },
      { t: "row", a: "1.  Fill Opportunities tab",    b: "One row per pursuit — stage, dates, values, win probability, description." },
      { t: "row", a: "2.  (Optional) Assignments tab", b: "Team members working on the opportunity — their allocation %, hours, role, and access level." },
      { t: "row", a: "3.  Upload to RM ONE",           b: "Enter your company name on the Import page, then drop this file." },
      { t: "spacer", a: "" },
      { t: "section", a: "KEY OPPORTUNITY COLUMNS", color: GREEN },
      { t: "row", a: "Stage",                 b: "Pursuit stage: Prospecting / Proposal / Negotiation / Awarded / Lost" },
      { t: "row", a: "Chance of Success",     b: "Win probability as a number 0–100 (e.g. 65 for 65%)" },
      { t: "row", a: "Approx Contract Value", b: "Estimated revenue if won — used for pipeline roll-up" },
      { t: "row", a: "Forecasted Project Cost", b: "Internal cost estimate — shown as primary OPM value in the app" },
      { t: "row", a: "Target Start / End",    b: "Expected project dates if the opportunity is won" },
      { t: "spacer", a: "" },
      { t: "section", a: "TIPS", color: PURPLE },
      { t: "row", a: "All dates", b: "YYYY-MM-DD format (e.g. 2026-07-15)" },
      { t: "row", a: "Values",    b: "Numbers only — no $ signs or commas (e.g. 4500000)" },
      { t: "row", a: "Closed opps", b: "Set Stage to 'Awarded' or 'Lost' to mark as closed" },
    ];
    let even = false;
    lines.forEach(line => {
      if (line.t === "spacer") { instr.addRow(["", ""]).height = 7; return; }
      const r = instr.addRow([line.a, line.t === "row" ? (line as any).b : ""]);
      const ref = `A${r.number}:B${r.number}`;
      if (line.t === "title") {
        instr.mergeCells(ref); r.height = 34;
        const c = r.getCell(1); c.font = { bold: true, size: 16, color: { argb: WHITE } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        c.alignment = { horizontal: "center", vertical: "middle" };
      } else if (line.t === "subtitle") {
        instr.mergeCells(ref); r.height = 22;
        const c = r.getCell(1); c.font = { italic: true, size: 10, color: { argb: HINT } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } };
        c.alignment = { horizontal: "center", vertical: "middle" };
      } else if (line.t === "section") {
        instr.mergeCells(ref); r.height = 24; even = false;
        const c = r.getCell(1); c.font = { bold: true, size: 11, color: { argb: WHITE } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: (line as any).color } };
        c.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      } else {
        r.height = 21;
        const bg = even ? "FFFFFFFF" : ALT; even = !even;
        const ca = r.getCell(1); const cb = r.getCell(2);
        ca.font = { bold: true, size: 10, color: { argb: LABEL } };
        cb.font = { size: 10, color: { argb: BODY } };
        ca.alignment = { vertical: "middle", indent: 1, wrapText: true };
        cb.alignment = { vertical: "middle", indent: 1, wrapText: true };
        ca.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        cb.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        ca.border = { bottom: { style: "hair", color: { argb: RULE } } };
        cb.border = { bottom: { style: "hair", color: { argb: RULE } } };
      }
    });

    // ── Tab 1: Opportunities ──────────────────────────────────────────
    const OPP_COLS = [
      { header: "Opportunity Title",      key: "ProjectTitle",               hint: "★ Name of the opportunity / pursuit",                                                  width: 36 },
      { header: "Opportunity ID",         key: "TicketId",                   hint: "★ Your opportunity reference ID (e.g. OPP-2026-014) — required; updates match by this ID (a new ID creates a new opportunity)", width: 18 },
      { header: "Type",                   key: "Type",                       hint: "Always 'Opportunity' — tells the importer this is a pursuit (not a project)",          width: 14 },
      { header: "Company Name",           key: "CompanyName",                hint: "★ Client company name",                                                                width: 28 },
      { header: "Contact Name",           key: "ContactName",                hint: "Client contact(s). Separate multiple with ; (optional)",                               width: 26 },
      { header: "ERP Job ID",            key: "ERPJobID",                   hint: "Your internal job/ERP number (optional)",                                              width: 14 },
      { header: "Stage",                  key: "CRMOpportunityStatusChoice", hint: "★ Pursuit stage: Prospecting / Proposal / Negotiation / Awarded / Lost",               width: 18 },
      { header: "Chance of Success",      key: "ChanceOfSuccessChoice",      hint: "Win probability as a number 0–100 (e.g. 65 for 65%)",                                  width: 20 },
      { header: "Market Sector",          key: "MarketSector",               hint: "e.g. Transportation / Healthcare / Education (optional)",                              width: 20 },
      { header: "Business Unit",          key: "CRMBusinessUnitChoice",      hint: "Business unit pursuing this opportunity (optional)",                                   width: 24 },
      { header: "Division",               key: "Division",                   hint: "Division managing this pursuit (optional)",                                            width: 22 },
      { header: "Department",             key: "Department",                 hint: "Department within the division (optional)",                                            width: 22 },
      { header: "Target Start",           key: "TargetStartDate",            hint: "YYYY-MM-DD — expected project start date if opportunity is won (optional)",            width: 16 },
      { header: "Target End",             key: "TargetCompletionDate",       hint: "YYYY-MM-DD — expected project completion date if won (optional)",                      width: 14 },
      { header: "Award / Loss Date",      key: "AwardedorLossDate",          hint: "YYYY-MM-DD — date the outcome (win or loss) was determined (optional)",               width: 18 },
      { header: "Approx Contract Value",  key: "ApproxContractValue",        hint: "Estimated contract revenue in dollars — number only, no $ or commas (optional)",      width: 22 },
      { header: "Forecasted Project Cost",key: "ForecastedProjectCost",      hint: "★ Internal cost estimate — number only. Shown as the primary OPM value in the app",   width: 26 },
      { header: "Labor Contract Amount",  key: "LaborContractAmount",        hint: "Labor-only cost estimate — number only (optional)",                                   width: 22 },
      { header: "Non-Operating Cost",     key: "NonOperatingCost",           hint: "Overhead / non-billable cost estimate — number only (optional)",                     width: 22 },
      { header: "Gross Margin",           key: "GrossMargin",                hint: "Target gross margin % — number only, e.g. 35 for 35% (optional)",                     width: 14 },
      { header: "% Complete",             key: "ProjectPhasePctComplete",    hint: "Progress % of the current phase — number only, e.g. 45 (optional)",                   width: 14 },
      { header: "Contract Type",          key: "ContractType",               hint: "Fixed / T&M / Cost-Plus / GMP (optional)",                                            width: 14 },
      { header: "Description",            key: "Description",                hint: "Opportunity scope summary (optional)",                                                 width: 40 },
      { header: "Services",               key: "ServicesDescription",        hint: "Services being offered / scope of services (optional)",                                 width: 36 },
      { header: "Client Ask",             key: "ClientAskDescription",       hint: "What the client is asking for (optional)",                                             width: 36 },
      { header: "Analysis Details",       key: "AnalysisDetails",            hint: "Internal pursuit analysis notes (optional)",                                           width: 36 },
      { header: "Contract Notes",         key: "ContractNotes",              hint: "Contract or commercial notes (optional)",                                              width: 36 },
      { header: "Notes",                  key: "Note",                       hint: "General notes (optional)",                                                             width: 36 },
      { header: "Comments",               key: "Comment",                    hint: "Additional comments (optional)",                                                       width: 36 },
      { header: "Point of Contact",       key: "PointOfContact",             hint: "Client point of contact name (optional)",                                              width: 28 },
      { header: "Status",                 key: "Status",                     hint: "Active / On Hold — overall record status (optional; distinct from Stage)",             width: 14 },
    ];
    buildPlainSheet("Opportunities", OPP_COLS, [
      { Type: "Opportunity", CompanyName: "Metro Transit Authority", ContactName: "John Metro",    ProjectTitle: "Waterfront Redevelopment Bid",    TicketId: "OPP-2001", ERPJobID: "OPP-2001", CRMOpportunityStatusChoice: "Proposal",    ChanceOfSuccessChoice: "65", MarketSector: "Transportation", CRMBusinessUnitChoice: "Infrastructure", Division: "Infrastructure", Department: "Engineering",   BidDueDate: "2026-07-01", InterviewDate: "2026-07-10", ProposalPhaseDueDate: "2026-06-25", TargetStartDate: "2026-09-01", TargetCompletionDate: "2029-06-30", AwardedorLossDate: "",  ApproxContractValue: "12000000", ForecastedProjectCost: "9500000",  LaborContractAmount: "7000000", NonOperatingCost: "850000",  GrossMargin: "21", ProjectPhasePctComplete: "40", ContractType: "T&M",   Description: "Waterfront redevelopment project bid",       ServicesDescription: "Civil engineering and design",      ClientAskDescription: "Full EPC delivery by Q4 2029",  AnalysisDetails: "Strong incumbent relationship", ContractNotes: "T&M capped at $12M",    Note: "Pursuit board approved the bid budget in the March review.",  Comment: "Teaming agreement signed with marine works subcontractor.",  PointOfContact: "John Metro",   Status: "Active" },
      { Type: "Opportunity", CompanyName: "Skyline Developers",      ContactName: "Sarah Skyline", ProjectTitle: "Convention Centre Expansion Bid", TicketId: "OPP-2002", ERPJobID: "OPP-2002", CRMOpportunityStatusChoice: "Prospecting", ChanceOfSuccessChoice: "30", MarketSector: "Construction",   CRMBusinessUnitChoice: "Buildings",      Division: "Buildings",      Department: "Business Dev", BidDueDate: "2026-09-15", InterviewDate: "",           ProposalPhaseDueDate: "2026-09-10", TargetStartDate: "2027-01-01", TargetCompletionDate: "2028-12-31", AwardedorLossDate: "",  ApproxContractValue: "18000000", ForecastedProjectCost: "15000000", LaborContractAmount: "9000000", NonOperatingCost: "1750000", GrossMargin: "17", ProjectPhasePctComplete: "10", ContractType: "GMP",   Description: "Convention centre expansion — design+build", ServicesDescription: "Architecture and construction mgmt", ClientAskDescription: "Design+build fixed price",     AnalysisDetails: "Competitive — 4 bidders expected",  ContractNotes: "GMP with shared savings clause proposed", Note: "Waiting on final RFP addendum before locking pricing.",  Comment: "Consider JV partner if scope expands to parking structure.",  PointOfContact: "Sarah Skyline", Status: "Active" },
      { Type: "Opportunity", CompanyName: "Harbor Bridge Corp",       ContactName: "Mike Harbor",   ProjectTitle: "Bridge Rehabilitation Study",    TicketId: "OPP-2003", ERPJobID: "OPP-2003", CRMOpportunityStatusChoice: "Negotiation", ChanceOfSuccessChoice: "80", MarketSector: "Infrastructure", CRMBusinessUnitChoice: "Infrastructure", Division: "Infrastructure", Department: "Engineering",   BidDueDate: "2026-05-30", InterviewDate: "2026-05-20", ProposalPhaseDueDate: "2026-05-15", TargetStartDate: "2026-08-01", TargetCompletionDate: "2028-03-31", AwardedorLossDate: "",  ApproxContractValue: "5500000",  ForecastedProjectCost: "4200000",  LaborContractAmount: "3500000", NonOperatingCost: "420000",  GrossMargin: "24", ProjectPhasePctComplete: "70", ContractType: "Fixed", Description: "Detailed study + design for bridge rehab",   ServicesDescription: "Structural assessment and design",  ClientAskDescription: "Rehab plan with cost estimate", AnalysisDetails: "Sole-source negotiation in progress", ContractNotes: "Fixed fee, no change orders", Note: "Client counsel reviewing final contract language.", Comment: "Mobilization can start within 30 days of signature.", PointOfContact: "Mike Harbor",  Status: "Active" },
      { Type: "Opportunity", CompanyName: "Riverside Medical Group",  ContactName: "Dana Rivers",   ProjectTitle: "Outpatient Clinic Fit-Out",      ERPJobID: "OPP-2004", CRMOpportunityStatusChoice: "Awarded",     ChanceOfSuccessChoice: "100", MarketSector: "Healthcare",    CRMBusinessUnitChoice: "Buildings",      Division: "Buildings",      Department: "Design",       BidDueDate: "2026-01-15", InterviewDate: "2026-01-28", ProposalPhaseDueDate: "2026-01-10", TargetStartDate: "2026-04-01", TargetCompletionDate: "2027-03-31", AwardedorLossDate: "2026-02-15", ApproxContractValue: "3800000",  ForecastedProjectCost: "3100000",  LaborContractAmount: "2200000", NonOperatingCost: "240000",  GrossMargin: "18", ProjectPhasePctComplete: "15", ContractType: "Fixed", Description: "Fit-out of a 22,000 sf outpatient clinic — exam rooms, imaging suite and lobby.", ServicesDescription: "Interior architecture and MEP coordination", ClientAskDescription: "Turnkey fit-out ready for occupancy by Q1 2027", AnalysisDetails: "Won on schedule guarantee and healthcare portfolio", ContractNotes: "Fixed fee with milestone billing", Note: "Kickoff scheduled for first week of April.", Comment: "Long-lead imaging equipment ordered by client.", PointOfContact: "Dana Rivers",  Status: "Active" },
      { Type: "Opportunity", CompanyName: "Northgate Logistics",      ContactName: "Sam North",     ProjectTitle: "Distribution Hub Expansion",     ERPJobID: "OPP-2005", CRMOpportunityStatusChoice: "Lost",        ChanceOfSuccessChoice: "0",   MarketSector: "Industrial",    CRMBusinessUnitChoice: "Infrastructure", Division: "Infrastructure", Department: "Engineering",  BidDueDate: "2026-02-20", InterviewDate: "2026-03-05", ProposalPhaseDueDate: "2026-02-14", TargetStartDate: "2026-06-01", TargetCompletionDate: "2027-12-31", AwardedorLossDate: "2026-03-20", ApproxContractValue: "9500000",  ForecastedProjectCost: "8200000",  LaborContractAmount: "5400000", NonOperatingCost: "600000",  GrossMargin: "14", ContractType: "GMP",   Description: "400,000 sf distribution hub expansion with automated sortation.",                 ServicesDescription: "Civil, structural and site logistics design",  ClientAskDescription: "Design-build under GMP with early works package", AnalysisDetails: "Lost on price — winning bid 8% lower",              ContractNotes: "N/A — not awarded",                Note: "Debrief held; pricing feedback logged for future industrial bids.", Comment: "Maintain relationship — client re-bids fit-out phase in 2027.", PointOfContact: "Sam North",    Status: "Closed" },
    ]);

    // ── Tab 3: Assignments ────────────────────────────────────────────
    const oppAsgSamples = [
      { Project: "Waterfront Redevelopment Bid",    TicketId: "OPP-2001", FullName: "Alice Smith",  UserName: "alice@company.com", AllocationStartDate: "2026-05-01", AllocationEndDate: "2026-07-01", AllocationHour: "200", AllocationType: "Soft", Role: "Project Lead",    JobTitle: "Lead Engineer",  CRMBusinessUnitChoice: "Infrastructure", Division: "Infrastructure", Department: "Engineering",   BillingRate: "180", EmpLaborRate: "95", EmpCostRate: "115", ActualStartDate: "", ActualEndDate: "", ActualHour: "", BilledHours: "0", UserRole: "Admin" },
      { Project: "Waterfront Redevelopment Bid",    TicketId: "OPP-2001", FullName: "Carol White",  UserName: "carol@company.com", AllocationStartDate: "2026-05-15", AllocationEndDate: "2026-07-01", AllocationHour: "160", AllocationType: "Soft", Role: "Lead Estimator",  JobTitle: "Lead Estimator", CRMBusinessUnitChoice: "Infrastructure", Division: "Infrastructure", Department: "Engineering",   BillingRate: "120", EmpLaborRate: "60", EmpCostRate: "72",  ActualStartDate: "", ActualEndDate: "", ActualHour: "", BilledHours: "0", UserRole: "User" },
      { Project: "Bridge Rehabilitation Study",     TicketId: "OPP-2003", FullName: "Bob Jones",    UserName: "bob@company.com",   AllocationStartDate: "2026-04-01", AllocationEndDate: "2026-05-30", AllocationHour: "80",  AllocationType: "Soft", Role: "Business Lead",   JobTitle: "Business Lead",  CRMBusinessUnitChoice: "Infrastructure", Division: "Infrastructure", Department: "Business Dev", BillingRate: "150", EmpLaborRate: "80", EmpCostRate: "95",  ActualStartDate: "", ActualEndDate: "", ActualHour: "", BilledHours: "0", UserRole: "User" },
    ];
    const oppAsgWs = buildPlainSheet("Assignments", SIMPLIFIED_TEMPLATE_COLUMNS.assignments, oppAsgSamples);
    applyAclDropdown(oppAsgWs, SIMPLIFIED_TEMPLATE_COLUMNS.assignments, oppAsgSamples.length + 20);

    // ── Tab 4: Schedule ───────────────────────────────────────────────
    buildPlainSheet("Schedule", [
      { header: "Project Title",   key: "ProjectTitle", hint: "Opportunity title (display only — the Project ID column does the matching)",  width: 36 },
      { header: "Project ID",      key: "TicketId",     hint: "★ Opportunity ID (your custom ID or RM ONE ticket) — required; rows link by ID only", width: 18 },
      { header: "Phase Name",      key: "PhaseName",    hint: "★ Phase or stage name — e.g. Schematic Design, Design Development, Construction", width: 26 },
      { header: "Phase Order",     key: "PhaseOrder",   hint: "Sequence number (1, 2, 3…) — controls display order",                        width: 14 },
      { header: "Start Date",      key: "StartDate",    hint: "YYYY-MM-DD — phase start date",                                              width: 14 },
      { header: "End Date",        key: "EndDate",      hint: "YYYY-MM-DD — phase end date",                                                width: 14 },
      { header: "Duration (days)", key: "Duration",     hint: "Calendar days this phase spans (optional when Start + End are both set)",     width: 16 },
      { header: "Milestone",       key: "Milestone",    hint: "Yes / No — is this a key milestone?",                                        width: 12 },
      { header: "% Complete",      key: "PctComplete",  hint: "0–100 — current phase completion percentage",                                width: 12 },
      { header: "Notes",           key: "Notes",        hint: "Any notes about this phase (optional)",                                      width: 36 },
    ], [
      { ProjectTitle: "Waterfront Redevelopment Bid", TicketId: "OPP-2001", PhaseName: "Schematic Design",   PhaseOrder: "1", StartDate: "2026-09-01", EndDate: "2026-12-31", Duration: "121", Milestone: "No",  PctComplete: "0", Notes: "Concept options and client workshops" },
      { ProjectTitle: "Waterfront Redevelopment Bid", TicketId: "OPP-2001", PhaseName: "Design Development", PhaseOrder: "2", StartDate: "2027-01-01", EndDate: "2027-09-30", Duration: "272", Milestone: "No",  PctComplete: "0", Notes: "Coordinated design across all disciplines" },
      { ProjectTitle: "Waterfront Redevelopment Bid", TicketId: "OPP-2001", PhaseName: "Closeout",           PhaseOrder: "3", StartDate: "2027-10-01", EndDate: "2029-06-30", Duration: "637", Milestone: "Yes", PctComplete: "0", Notes: "Project delivery milestone" },
      { ProjectTitle: "Bridge Rehabilitation Study",  TicketId: "OPP-2003", PhaseName: "Assessment",         PhaseOrder: "1", StartDate: "2026-08-01", EndDate: "2026-11-30", Duration: "121", Milestone: "No",  PctComplete: "0", Notes: "Condition survey and load rating" },
      { ProjectTitle: "Bridge Rehabilitation Study",  TicketId: "OPP-2003", PhaseName: "Final Design",       PhaseOrder: "2", StartDate: "2026-12-01", EndDate: "2028-03-31", Duration: "485", Milestone: "Yes", PctComplete: "0", Notes: "Final design milestone" },
    ]);

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=\"RMOne_Opportunities_Template.xlsx\"");
    res.send(buf);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/onboarding/dry-run-validate ─────────────────────────────────
// 3-point pre-import check — no DB writes.
// 1. Schema drop: which columns will execInsert silently skip for this tenant
// 2. Data quality: blank required fields, invalid date/email/number formats
// 3. Live DB lookup: does Division / Project / User exist in core2 already?
router.post("/dry-run-validate", async (req: Request, res: Response) => {
  try {
    const { uploadId, columnMappings: colMaps } = req.body as {
      uploadId: string;
      columnMappings?: Record<string, Record<string, string>>;
    };
    if (!uploadId) return res.status(400).json({ error: "uploadId is required" });

    const job = _jobs.get(uploadId);
    if (!job) return res.status(404).json({ error: "Upload not found" });
    if (!requireTenantAccess(req, res, job.tenantId)) return;

    let buffer: Buffer;
    if (job.s3Key) {
      buffer = await readFileBuffer(job.s3Key);
    } else if ((job as any)._buffer) {
      buffer = (job as any)._buffer;
    } else {
      // The cached row may be meta-only (startup warm skips file blobs) —
      // back-fill the file bytes from the DB on demand.
      if (!job.fileData) {
        const full = await getJobWithFile(uploadId);
        if (full?.fileData) job.fileData = full.fileData;
      }
      if (!job.fileData) {
        return res.status(400).json({ error: "File no longer available — please re-upload." });
      }
      buffer = Buffer.from(job.fileData, "base64");
      (job as any)._buffer = buffer;
    }

    const allSheets = await parseExcel(buffer);

    // Apply any user-supplied column remappings
    const mappedSheets = allSheets.map(sheet => {
      const mapping = colMaps?.[sheet.sheetName];
      if (!mapping) return sheet;
      return {
        ...sheet,
        columns: sheet.columns.map((c: string) => mapping[c] ?? c),
        rows: sheet.rows.map((row: Record<string, unknown>) => {
          const nr: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) nr[mapping[k] ?? k] = v;
          return nr;
        }),
      };
    });

    const pool      = await getPool();
    const tenantId  = resolveTenantId(job.tenantId);
    if (!tenantId) return res.status(401).json({ error: "Tenant not resolved" });

    const report: DryRunReport = await dryRunValidate(pool, tenantId, mappedSheets);
    return res.json(report);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /api/onboarding/validate ────────────────────────────────────────
router.post("/validate", async (req: Request, res: Response) => {
  const { sheets } = req.body as { sheets: { sheetName: string; columns: string[] }[] };
  if (!Array.isArray(sheets)) return res.status(400).json({ error: "sheets array required" });

  // Read the real schema from the live core2 DB once (falls back to hardcoded)
  const liveSchema = await getUniversalSchema();

  const results = sheets.map(s => {
    const tableName = resolveTable(s.sheetName);
    if (!tableName) return { sheetName: s.sheetName, tableName: null, status: "unknown" };
    const v = validateColumns(tableName, s.columns, liveSchema);
    return {
      sheetName: s.sheetName,
      tableName,
      matched:         v.matched,
      unknown:         v.unknown,
      missingRequired: v.missingRequired,
      status: v.missingRequired.length > 0 ? "error"
            : v.unknown.length > 0         ? "warning"
            : "ok",
    };
  });

  res.json({ results });
  return;
});

// ── GET /api/onboarding/test-files/:name ──────────────────────────────────
// Generates and streams a test Excel file with proper download headers.
// Supported names: org_setup.xlsx, ambiguity_trigger.xlsx
router.get("/test-files/:name", async (req: Request, res: Response) => {
  const name = req.params.name;
  const wb = new ExcelJS.Workbook();
  wb.creator = "RM ONE";
  wb.created = new Date();

  if (name === "org_setup.xlsx") {
    const ws = wb.addWorksheet("Organization");
    ws.columns = [
      { header: "Business Unit", key: "bu",   width: 22 },
      { header: "Division",      key: "div",  width: 20 },
      { header: "Department",    key: "dept", width: 22 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.addRow({ bu: "Healthcare", div: "Design", dept: "Digital Health"  });
    ws.addRow({ bu: "Buildings",  div: "Design", dept: "Interior Design" });

  } else if (name === "ambiguity_trigger.xlsx") {
    const org = wb.addWorksheet("Organization");
    org.columns = [
      { header: "Business Unit", key: "bu",   width: 22 },
      { header: "Division",      key: "div",  width: 20 },
      { header: "Department",    key: "dept", width: 22 },
    ];
    org.getRow(1).font = { bold: true };
    org.addRow({ bu: "Civil & Transit", div: "Design", dept: "Transit Systems" });

    const proj = wb.addWorksheet("Clients & Projects");
    proj.columns = [
      { header: "Project Title",   key: "title",  width: 30 },
      { header: "Business Unit",   key: "bu",     width: 22 },
      { header: "Division",        key: "div",    width: 20 },
      { header: "Department",      key: "dept",   width: 22 },
      { header: "Status",          key: "status", width: 14 },
      { header: "Project Manager", key: "pm",     width: 20 },
      { header: "Start Date",      key: "start",  width: 14 },
      { header: "End Date",        key: "end",    width: 14 },
    ];
    proj.getRow(1).font = { bold: true };
    proj.addRow({ title: "Transit HQ Renovation", bu: "Civil & Transit", div: "Design", dept: "Transit Systems", status: "Active", pm: "Jane Smith", start: "2026-01-01", end: "2026-12-31" });
    proj.addRow({ title: "Civic Bridge Upgrade",  bu: "Civil & Transit", div: "Design", dept: "Transit Systems", status: "Active", pm: "Alex Lee",   start: "2026-03-01", end: "2026-11-30" });

  } else {
    return res.status(404).json({ error: "Unknown test file" });
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  await wb.xlsx.write(res);
  res.end();
  return;
});

// ── Production seed: testrmone tenant Postgres users ─────────────────────────
// One-shot endpoint to seed 6 login users into Postgres for the testrmone tenant.
// Protected by a static secret token in the X-Seed-Token header.
// Safe to call multiple times (idempotent).
router.post("/seed-testrmone-users", async (req: Request, res: Response): Promise<void> => {
  const SEED_TOKEN = "rmone-testrmone-seed-2026";
  const TESTRMONE_TID = "07160b5c-7a8f-5e55-84ce-7499c981cb87";
  const PW = "rmone@8723";

  if (req.headers["x-seed-token"] !== SEED_TOKEN) {
    res.status(401).json({ ok: false, error: "invalid token" });
    return;
  }
  const seedSrc = resolveRequestSource(req);
  if (!seedSrc || !isSuperAdminSource(seedSrc)) {
    res.status(403).json({ ok: false, error: "Superadmin access required" });
    return;
  }

  const pwHash = hashPassword(PW);

  const USERS: Array<{
    guid: string; username: string; name: string;
    isSiteAdmin: boolean; acl: "admin" | "manager";
  }> = [
    { guid: "seed-ceo-testrmone-000001",  username: "ceo@testrmone.com",  name: "Alexandra Chen",  isSiteAdmin: true,  acl: "admin"   },
    { guid: "seed-cfo-testrmone-000002",  username: "cfo@testrmone.com",  name: "Robert Kumar",    isSiteAdmin: true,  acl: "admin"   },
    { guid: "seed-coo-testrmone-000003",  username: "coo@testrmone.com",  name: "Sarah Mitchell",  isSiteAdmin: true,  acl: "admin"   },
    { guid: "seed-rm--testrmone-000004",  username: "rm@testrmone.com",   name: "David Torres",    isSiteAdmin: false, acl: "manager" },
    { guid: "seed-exec-testrmone-000005", username: "exec@testrmone.com", name: "Jennifer Park",   isSiteAdmin: true,  acl: "admin"   },
    { guid: "seed-pm--testrmone-000006",  username: "pm@testrmone.com",   name: "Marcus Johnson",  isSiteAdmin: false, acl: "manager" },
  ];

  const results: string[] = [];

  // Get existing users for this tenant to check for duplicates
  const existing = await getUsersByTenant(TESTRMONE_TID).catch(() => [] as typeof USERS);
  const existingByUsername = new Map((existing as any[]).map((u: any) => [u.username, u]));

  for (const u of USERS) {
    const found = existingByUsername.get(u.username.toLowerCase());
    if (found) {
      await updateAppUser(TESTRMONE_TID, found.id, {
        passwordHash: pwHash,
        isSiteAdmin: u.isSiteAdmin,
        accessLevel: u.acl,
        enabled: true,
        deleted: false,
        name: u.name,
      }).catch(e => results.push(`update-fail:${u.username}:${e.message}`));
      results.push(`updated:${u.username}`);
    } else {
      await createAppUser({
        id:           u.guid,
        tenantId:     TESTRMONE_TID,
        username:     u.username.toLowerCase(),
        name:         u.name,
        email:        u.username,
        passwordHash: pwHash,
        isSiteAdmin:  u.isSiteAdmin,
        accessLevel:  u.acl,
        isManager:    false,
        enabled:      true,
        deleted:      false,
      }).catch(e => results.push(`insert-fail:${u.username}:${e.message}`));
      results.push(`inserted:${u.username}`);
    }
  }

  res.json({ ok: true, results });
});

export default router;
