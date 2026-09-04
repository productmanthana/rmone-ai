import { compactUsd } from "../lib/money";
import { ownContractValues } from "../lib/contractValueDisplay";
import { isClosedishStatus } from "../lib/closedish";
import { KP_LEAD_ROLES } from "@/lib/quickActions";
import { CUSTOM_LEADS_FIELD, CUSTOM_ROLE_PREFIX, addCustomLead, listCustomLeads, removeCustomLead } from "@/lib/customLeads";
import { synthesizeTeamLeads } from "@/lib/leadSynthesis";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { RmOneProcessing } from "@/components/CommandCentreLoader";
import { useLocation, useSearch } from "wouter";
import {
  ArrowLeft, Sparkles, Activity, Calendar, Users, Target, DollarSign, MapPin,
  Tag, Briefcase, Home, Phone, Mail, Globe, ExternalLink, Folder, FileText,
  UserPlus, AlertTriangle, Clock, Search, X, Edit2, ChevronUp, ChevronDown,
  CheckCircle, PlayCircle, Circle, Plus, Minus, Info, Award, Grid as GridIcon, GripVertical,
  Flag, ArrowRight, UserX, AlertCircle, User, Layers, Lock, Building2,
  Loader2, XCircle, ChevronsRight, ChevronsLeft, Trash2, Check, Archive, Lightbulb, SlidersHorizontal,
  Pencil,
} from "lucide-react";
import { Lock as LockIcon } from "lucide-react";
import {
  getProjectDetails, getProjectAllocations, getResourceAllocations, getProjectTeam,
  getCompanyProjects, getCompanyContacts, bustCache, getTaskData, updateProjectSchedule,
  getFullProjectAllocations, recordRecentProject, peekCached, removeTeamMember, removeOpenPosition, notifyAllocationChanged,
  updateFields, getFieldOptions, tenantScopedKey, markProjectDetailRefetchFresh,
  createSchedule, getBillingRates, getProjectDivisionRoles, updateProjectDivisionRoles, getLifecycles,
  createLifecycle, updateLifecycle,
  getDivisions, getDepartments, getBusinessUnits, createBusinessUnit, ensureBridgeDivision, getUserList, getJobTitles, getModuleRecords,
  getRoleBillingRates, getRoleBillingRatesSeed, chatStream, getAllocTemplates,
  getStageCfg as apiGetStageCfg, saveStageCfg as apiSaveStageCfg,
  type LiveResource, type ProjectTeamMember, type OpenRole, type RoleBillingRate,
} from "@/lib/api";
import { ensureCustomStatusInStageCfg, parseStageCfg } from "@/lib/stageStatus";
import { AddTeamMemberModal } from "@/components/AddTeamMemberModal";
import { AddOpenPositionModal } from "@/components/AddOpenPositionModal";
import { AllocationTemplateModal } from "@/components/AllocationTemplateModal";
import { AuditTrailCard } from "@/components/AuditTrailCard";
import { TeamScheduleGrid } from "@/components/TeamScheduleGrid";
import { ScheduleStageRulesHost, type ScheduleRuleTarget } from "@/components/StageRulesSettings";
import { PhaseBreakdown } from "@/components/PhaseBreakdown";
import { TeamGantt } from "@/components/TeamGantt";
import { TeamViewModePicker, type TeamViewModePickerHandle } from "@/components/TeamViewModePicker";
import { getDisplayModeForRecord, useProjectViewModeVersion } from "@/lib/projectViewMode";
import { SimpleTeamTable } from "@/components/SimpleTeamTable";
import { PhaseCardsStrip } from "@/components/PhaseCardsStrip";
import { EditAllocationModal, type EditAllocPerson } from "@/components/EditAllocationModal";
import { setChatPrompt, onScheduleChanged, notifyScheduleChanged } from "@/lib/chatBridge";
import { writeConvertSeed } from "@/lib/convertSeed";
import { scoreSameJobRaw, pickBestSameJobMatch } from "@/lib/sameJob";
import { useAuth } from "@/lib/useAuth";
import { useTheme } from "@/lib/theme";
import { useToast } from "@/hooks/use-toast";
import { subscribeDataChanged } from "@/lib/dataSync";
import { isRootAccount } from "@/lib/roleResolver";
import {
  loadStageRules, getStageRules, useStageRulesVersion, lockNoteForFields, EMPTY_STAGE_RULES,
  readRawField, skippedStagesFor, computeLockedFields, FALLBACK_STAGE_ORDER,
  computeLayoutFields, layoutNoteForFields, layoutHiddenKeys, workflowTypesFor, workflowTypeDefsFor,
  workflowStagesFor, guidanceFor,
  fetchStageRulesFor, RECORD_STAGE_RULES_EVENT,
  type StageRuleModule, type StageRules,
  requiredBlankNote,
} from "@/lib/stageRules";
import { getRecordPermissions, bustRecordPermissions, usePermissionsVersion, isFinancialFieldName, getMyCapabilities, getMyCapabilitiesChecked, useEditFinancialsCap, type RecordPermissions } from "@/lib/permissions";
import {
  adminDetailDefaults, adminColumnHiddenFields, fetchDisplayDefaultsFor, loadDisplayDefaults, saveDisplayDefaults,
  useDisplayDefaultsVersion, hasUserCustomized, markUserCustomized, clearUserCustomization,
  type DisplayDefaults, type DisplayModule,
} from "@/lib/displayDefaults";
import {
  CONSTRUCTION_FINANCIAL_FIELDS, CONSTRUCTION_DATE_FIELDS, CONSTRUCTION_TEXT_FIELDS,
  NOTES_FIELD_KEYS, BUDGET_TEXT_FIELD_KEYS, AUTO_SHOWN_KEYS, SUPPRESSED_FIELD_KEYS,
  BUDGET_AUTO_KEYS, BUDGET_SUPPRESSED_FIELD_KEYS, humanizeFieldKey,
} from "@/lib/recordFieldCatalog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  computeHealth as sharedComputeHealth,
  durationMonths as sharedDurationMonths,
  durationLabel as sharedDurationLabel,
  type HealthIssue,
  type HealthCheck,
} from "@workspace/health";
import { getBusinessRules, getDisplayModeFor, loadBusinessRules, useBusinessRulesVersion } from "@/lib/businessRules";
import { empTypeColor } from "@/lib/employmentColor";
import { readProjectSnapshot, writeProjectSnapshot, readSectionSeed, writeSectionSeed } from "@/lib/projectDetailCache";
import { memSeed } from "@/lib/memSeed";
import { warmAddMemberRoster } from "@/lib/addMemberRoster";
import { abbrevRole } from "@/lib/roleAbbrev";
import AppDateField, { type DateFieldHandle } from "@/components/DateField";
import { Z } from "@/lib/zLayers";
import { derivePlannerSchedule } from "@/lib/phaseHours";
import { queryClient } from "@/lib/queryClient";
import {
  applyOptimisticProjectTeamMember,
  refreshProjectTeamCache,
} from "@/lib/teamCache";
import { fmtHours, fmtNumber, fmtPct } from "@/lib/utils";

/* ──────────────── Brand palette (mirrors mobile Colors) ──────────────── */
import { getStoredUser, getMyUserGuid, setAllocationLock, setAllocationFlag, deleteRecord as apiDeleteRecord, getRecordFieldHistory, type FieldChangeItem } from "@/lib/api";
const Colors = {
  dark: "var(--rm-bg)",
  darkDeep: "var(--rm-bg)",
  darkCard: "var(--rm-panel)",
  green: "#6BA539",
  greenBg: "var(--rm-green)",
  greenLight: "#A9C23F",
  orange: "#E87722",
  white: "var(--rm-text)",
  textPrimary: "var(--rm-text)",
  textSecondary: "var(--rm-text-muted)",
  textMuted: "var(--rm-text-faint)",
  border: "var(--rm-panel-border)",
};

const ACCENT_BLUE = "var(--rm-accent-blue)";
const ACCENT_PURPLE = "#A78BFA";
const ACCENT_TEAL = "#2DD4BF";
const ACCENT_PINK = "#F472B6";
const ACCENT_AMBER = "#FBBF24";
const GRADIENT_GREEN: [string, string] = ["#84CC16", "#BEF264"];
const GRADIENT_ORANGE: [string, string] = ["#FB923C", "#FDBA74"];
const GRADIENT_BLUE: [string, string] = ["#38BDF8", "#7DD3FC"];
const GRADIENT_RED: [string, string] = ["#F87171", "#FCA5A5"];

const ALLOC_COLORS = ["#84CC16", "#38BDF8", "#FB923C", "#A78BFA", "#2DD4BF", "#F472B6", "#FBBF24", "#F87171"];
// In-memory only: prevents a historical, data-free allocation marker from
// forcing the same record to revalidate again after every unmount/remount.
const allocationMarkerReconciledByProject = new Map<string, string>();

/* ──────────────── Sub-section pre-warm cache ────────────────
 * Schedule, Business Units, and Budget sub-sections each fire their own
 * RM ONE upstream call when first opened — historically that meant 1-3s
 * of "Loading…" every time the user expanded one. We now pre-fetch all
 * three IN PARALLEL the moment a project's ticketId is known and cache
 * the raw responses here, keyed by ticketId. Each sub-section consults
 * the cache on mount: cache hit → render instantly with no spinner;
 * cache miss → fetch + populate cache + render. The in-memory map is
 * capped at 30 entries via simple FIFO eviction so a power user clicking
 * through hundreds of projects can't leak memory; every fresh fetch is
 * ALSO persisted to localStorage (tenant+user scoped, see
 * lib/projectDetailCache) so a return visit after a reload renders the
 * sections instantly from the seed and silently revalidates.
 * ────────────────────────────────────────────────────────────────── */
const PREFETCH_CACHE_LIMIT = 30;
type SubSection = "biz" | "budget" | "schedule";
const subSectionCache = new Map<string, unknown>();
// Keys whose current in-memory value came from the PERSISTED seed
// (localStorage) rather than a fresh fetch this session. Sections render
// these instantly but must silently revalidate in the background.
const seededSectionKeys = new Set<string>();
try {
  window.addEventListener("rmone:bustCache", () => {
    subSectionCache.clear();
    seededSectionKeys.clear();
  });
} catch { /* ignore */ }
// A BU was appended to a project record from the add-member flow's
// "Different Business Unit" popup (useAssignMemberCascade). Refresh the
// "biz" section cache so the Business Units card shows the new BU without a
// manual page reload — even if the card has never been opened this session.
try {
  window.addEventListener("rmone:projectBuChanged", (e) => {
    const d = (e as CustomEvent).detail as { ticketId?: string; rows?: unknown } | undefined;
    const tid = d?.ticketId;
    if (!tid) return;
    if (Array.isArray(d?.rows)) {
      // Fresh rows came with the event — prime the cache + persisted seed.
      setCachedSection("biz", tid, d.rows);
    } else {
      // No rows (background refetch failed) — drop the stale entry so the
      // next open revalidates instead of trusting a pre-change cache hit.
      subSectionCache.delete(cacheKey("biz", tid));
      seededSectionKeys.delete(cacheKey("biz", tid));
    }
  });
} catch { /* ignore */ }
// Timestamp of the most recent schedule mutation (any save that fires
// notifyScheduleChanged). loadProject's Phase-2 schedule cache warm checks
// this: a getTaskData fetch launched BEFORE a save must never overwrite the
// post-save optimistic cache write with its pre-save (now stale) result.
let lastScheduleMutationTs = 0;
onScheduleChanged(() => { lastScheduleMutationTs = Date.now(); });

function cacheKey(section: SubSection, ticketId: string): string {
  return `${section}:${ticketId}`;
}
function getCachedSection<T = unknown>(section: SubSection, ticketId: string): T | undefined {
  const key = cacheKey(section, ticketId);
  if (subSectionCache.has(key)) return subSectionCache.get(key) as T;
  // Fall back to the persisted seed (survives page reloads). Hydrate it
  // into the in-memory map so repeated render-time reads don't re-parse
  // JSON, and mark it "seeded" so consumers know to revalidate.
  const seed = readSectionSeed<T>(section, ticketId);
  if (seed === undefined) return undefined;
  subSectionCache.set(key, seed);
  seededSectionKeys.add(key);
  return seed;
}
/** True when the cached value is a persisted seed from a previous session
 *  (possibly stale) — the section should show it AND refetch silently. */
function isSectionSeeded(section: SubSection, ticketId: string): boolean {
  return seededSectionKeys.has(cacheKey(section, ticketId));
}
function setCachedSection(section: SubSection, ticketId: string, value: unknown): void {
  const key = cacheKey(section, ticketId);
  if (subSectionCache.has(key)) subSectionCache.delete(key); // refresh LRU position
  subSectionCache.set(key, value);
  seededSectionKeys.delete(key); // fresh fetch — no longer a stale seed
  // Persist so the next visit (even after a reload) renders instantly.
  writeSectionSeed(section, ticketId, value);
  // Trim oldest entries if we exceed the soft cap.
  while (subSectionCache.size > PREFETCH_CACHE_LIMIT) {
    const oldest = subSectionCache.keys().next().value;
    if (oldest === undefined) break;
    subSectionCache.delete(oldest);
  }
}
/** Warm one sub-section. Resolves when the data is available (immediately
 *  on any cache hit — fresh or seeded — since seeded sections render
 *  instantly and revalidate themselves). Never rejects. */
function prefetchSubSection(section: SubSection, ticketId: string, fetcher: () => Promise<unknown>): Promise<void> {
  if (!ticketId) return Promise.resolve();
  if (getCachedSection(section, ticketId) !== undefined) return Promise.resolve();
  // Store result on success, swallow errors silently (the section's own
  // fetch will surface the error if the user opens it).
  return fetcher().then(
    (v) => setCachedSection(section, ticketId, v),
    () => { /* ignore */ },
  );
}

/* ──────────────── Types ──────────────── */
export interface Allocation {
  name: string;
  role: string;
  title: string;
  dept?: string;
  pct: number;
  startDate: string;
  endDate: string;
  eacHrs: number;
  etcHrs: number;
  costRate: number; laborRate: number;
  eacCost: number;
  etcCost: number;
  ncHrs: number;
  ncCost: number;
  /** Cost rate selected when this member was marked non-chargeable. */
  ncRate?: number;
  hasWeeklyHours: boolean;
  /** Raw weekly hour rows from the team payload (week = Monday ISO date).
   *  Optional: the quick first render may not have them yet; the Gantt view
   *  falls back to a solid bar until they arrive. */
  weeklyHours?: { week: string; hours: number }[];
  bu: string;
  divisionId?: string;
  memberBu?: string;
  email: string;
  resourceId?: string;
  rwiId?: number;
  /** Allocation flags (OR across the member's allocation rows). isLocked =
   *  frozen against imports, schedule moves and weekly-hours edits until an
   *  admin (or manage-staff user) unlocks from the team card. */
  softAllocation?: boolean;
  nonChargeable?: boolean;
  isLocked?: boolean;
  /** Raw Employee Type label (e.g. "Part-Time") — drives name color coding. */
  employeeType?: string;
  /** Per-assignment-period detail from the team payload (imports can assign
   *  the same person several periods at different %). The no-grid team table
   *  renders one row per period when a member has 2+. `weeks` counts the weeks
   *  that actually carry hours — the hours-breakdown popup shows the math. */
  slices?: { startDate: string; endDate: string; pct: number; hours: number; weeks?: number; rwiId?: number | null }[];
  /** Tenant work-week basis in hours (Settings → workWeekHours, default 40). */
  weekHrsBasis?: number;
  enabled?: boolean;
  tenantId?: string;
}

export interface ProjectData {
  id: string;
  name: string;
  status: string;
  phase: string;
  city: string;
  sector: string;
  value: number;
  laborValue: number;
  company: string;
  bu: string;
  groupId: string;
  targetStart: string;
  targetEnd: string;
  actualStart: string;
  actualEnd: string;
  scheduleStart: string;
  scheduleEnd: string;
  closeDate: string;
  bidDate: string;
  probability: number;
  module: string;
  allocations: Allocation[];
  keyPersonnel: KeyPersonnelEntry[];
  guidToName: Record<string, string>;
  healthScore: number;
  healthIssues: HealthIssue[];
  healthChecks: HealthCheck[];
  rawFields: Record<string, unknown>;
}

/** One entry in the "Project Leads" (Key Personnel) card. `field` is the
 *  record column the entry came from (e.g. "ProjectManagerUser") — set for
 *  entries backed by a *User field so the card's remove button knows what to
 *  clear; absent for entries synthesised from team-member job titles. */
interface KeyPersonnelEntry { name: string; role: string; guid: string; field?: string }

/** Canonical role ↔ record-column map for the Project Leads card. Used to
 *  parse the record's *User fields at load time, as the render-time fallback,
 *  and as the role dropdown of the card's "Add Lead" flow (PMM + OPM + LEM —
 *  the backend lazily adds any missing column on the target table).
 *  ONE shared catalogue with Quick Actions so both Add Lead flows always show
 *  the exact same role list. */
const KP_FIELD_ROLES: { field: string; role: string }[] = KP_LEAD_ROLES;

interface ScheduleTask {
  ID: number;
  Title: string;
  StartDate: string;
  DueDate: string;
  Status: string;
  PercentComplete: number;
  ItemOrder: number;
  TicketId: string;
  AssignedTo: string;
  isSelected: boolean;
  StageStep: number;
}

interface LifecycleStage { ID: number; Name: string; StageStep: number }
interface LifecycleInfo { ID: number; Name: string; Stages: LifecycleStage[] }

interface BillingResource {
  name: string; role: string; bu: string;
  billingRate: number; costRate: number;
  hours: number; billingTotal: number; costTotal: number;
}
interface DivisionBudget {
  /** Server row key for per-BU role edits: division id, or "name:<lower>"
   *  for text-fallback rows. Empty on client-only rows (Team / fallback) —
   *  those rows are not editable. */
  divisionKey: string;
  divisionName: string; type: string; contractValue: number;
  pmName: string; execName: string; contactOverride: string;
  blName: string; preconLead: string;
}

/* ──────────────── Helpers ──────────────── */
function fmtM(v: number): string {
  if (!v || v <= 0) return "—";
  if (v >= 1_000_000_000) return compactUsd(v);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

// Construction field catalogs + auto-shown/suppressed key sets — shared with
// Settings → Display Defaults (record-page field editor) via lib/recordFieldCatalog.

/** Local-calendar day (YYYY-MM-DD) from an ISO timestamp. Schedule-derived
 * dates (project.scheduleStart/scheduleEnd) are toISOString() of locally
 * parsed phase dates, so slicing the UTC string directly could shift the day
 * backward in UTC+ timezones — format via local getters instead. */
function schedDay(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Construction date fields that editors can update inline from the detail page
// using a native date picker. All are saved via /update-fields by exact column
// name (schema-drift-safe via updateRecordFieldsRds).
const EDITABLE_CONSTRUCTION_DATE_KEYS = new Set<string>([
  "TargetStartDate",
  "TargetCompletionDate",
  "ActualStartDate",
  "ActualCompletionDate",
  "ProposalPhaseDueDate",
  "BidDueDate",
  "PreconStartDate",
  "PreconEndDate",
  "ConstStartDate",
  "EstimatedConstructionStart",
  "EstimatedConstructionEnd",
  "SubstantialCompletion",
  "CloseoutDate",
  "CloseoutStartDate",
  "ClosedDate",
  "CloseDate",
  "NextMilestoneDate",
  "InterviewDate",
  "AwardedorLossDate",
  "DesiredCompletionDate",
]);

// Construction financial fields that editors can update inline from the detail
// page. The backend's updateRecordFieldsRds writes them by exact column name
// (schema-drift-safe). Retainage lives in CONSTRUCTION_TEXT_FIELDS but is
// also listed here so the text-field render block can look it up with a single
// shared set.
const EDITABLE_CONSTRUCTION_KEYS = new Set<string>([
  // Money — always editable
  "ContractedAmount",
  "ProposalAmount",
  "BidAmount",
  "ApprovedChangeOrders",
  "ChangeOrders",
  "LiquidatedDamages",
  "Contingency",
  "NonOperatingCost",
  // Pct — user-entered target values from the import template
  "GrossMargin",
  "FeePct",
  "ProjectPhasePctComplete",
  // Text — user-entered labels
  "ContractType",
  // Text in budget section
  "Retainage",
]);


function fmtDate(d: string | null | undefined): string {
  if (!d || (typeof d === "string" && d.startsWith("0001"))) return "—";
  // Date-only strings must parse as LOCAL time — new Date("YYYY-MM-DD") is
  // UTC midnight, which renders as the previous day in timezones behind UTC.
  // Midnight timestamps (with or without Z) are calendar dates by contract
  // (core2 stores date-only values at T00:00:00), so their DATE PART is
  // authoritative — parsing "2026-08-05T00:00:00.000Z" as a UTC instant
  // shifts the displayed day for US viewers while looking fine from IST.
  const dateOnly = /^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.0+)?(?:Z|\+00:00)?)?$/.exec(d);
  const s = dateOnly ? `${dateOnly[1]}T00:00:00` : d;
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ── Persisted key-list state with a company-default fallback ──
   Small string[] state backed by localStorage, keyed per module, layered on
   the admin-set company defaults (Settings → Display Defaults): until the
   user actually edits the list on this browser (tracked via a tenant-scoped
   ":custom" marker — see lib/displayDefaults), the value FOLLOWS the company
   default, including the moment the async defaults fetch lands. Any edit
   marks the list customized and persists it; reset() clears the marker and
   returns to following the company default. Handles the module-switch reload
   race the same way as the original customFieldKeys wiring: when the storage
   key changes we reload from the NEW key before the save effect can
   overwrite it with the previous module's state. */
function useDefaultableKeys(
  storageKey: string,
  adminKeys: string[],
  clean?: (keys: string[]) => string[],
): { keys: string[]; setKeys: Dispatch<SetStateAction<string[]>>; reset: () => void; customized: boolean } {
  const cleanRef = useRef(clean);
  cleanRef.current = clean;
  const adminRef = useRef(adminKeys);
  adminRef.current = adminKeys;
  const applyClean = (list: string[]) => (cleanRef.current ? cleanRef.current(list) : list);
  const readStored = (key: string): string[] => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? applyClean(JSON.parse(raw) as string[]) : [];
    } catch { return []; }
  };
  const [customized, setCustomized] = useState<boolean>(() => hasUserCustomized(storageKey));
  const [keys, rawSetKeys] = useState<string[]>(() =>
    hasUserCustomized(storageKey) ? readStored(storageKey) : applyClean(adminKeys));
  const loadedRef = useRef(storageKey);
  // Module switch: reload the customized flag + keys from the NEW key before
  // the save effect below can overwrite it with the previous module's state.
  useEffect(() => {
    if (loadedRef.current === storageKey) return;
    loadedRef.current = storageKey;
    const cust = hasUserCustomized(storageKey);
    setCustomized(cust);
    rawSetKeys(cust ? readStored(storageKey) : applyClean(adminRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  // Follow the company default while not customized — fires when the async
  // defaults fetch lands, or when an admin saves new defaults this session.
  const adminSig = adminKeys.join("\u0000");
  useEffect(() => {
    if (customized || loadedRef.current !== storageKey) return;
    rawSetKeys(applyClean(adminRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminSig, customized, storageKey]);
  // Persist ONLY customized lists — an untouched user keeps inheriting.
  useEffect(() => {
    if (!customized || loadedRef.current !== storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(keys)); } catch { /* ignore */ }
  }, [keys, customized, storageKey]);
  const setKeys = useCallback<Dispatch<SetStateAction<string[]>>>((next) => {
    markUserCustomized(storageKey);
    setCustomized(true);
    rawSetKeys(next);
  }, [storageKey]);
  const reset = useCallback(() => {
    clearUserCustomization(storageKey);
    setCustomized(false);
    rawSetKeys(cleanRef.current ? cleanRef.current(adminRef.current) : adminRef.current);
  }, [storageKey]);
  return { keys, setKeys, reset, customized };
}

/* ── Shared field helpers for user-pinned custom cells ── */
function formatRawFieldValue(k: string, v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s || s === "false" || s === "null" || s.startsWith("0001-")) return "";
  // ISO date heuristic — render as human-readable "Jul 12, 2026"
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtDate(s);
  // Currency heuristic
  if (/(Amount|Value|Cost|Price)$/.test(k) && !isNaN(Number(s))) {
    const n = Number(s);
    if (n > 0) {
      return n >= 1_000_000_000 ? compactUsd(n) : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` : `$${n.toFixed(0)}`;
    }
  }
  return s;
}

/* ── Shared "Customize fields" panel ──
   Used by both the Project/Opportunity Details card and the Budget & Costs
   card. NOTHING is locked: fields the card shows by default are listed with
   a ticked checkbox (untick to hide), and optional raw fields are listed
   with an unticked checkbox (tick to pin them onto the card). */
function FieldCustomizePanel({ rf, alwaysKeys, optionalKeys, pinnedKeys, hiddenKeys, onTogglePin, onToggleHide, search, onSearch, showReset, onReset, extraAction }: {
  rf: Record<string, unknown>;
  alwaysKeys: string[];
  optionalKeys: string[];
  pinnedKeys: string[];
  hiddenKeys: string[];
  onTogglePin: (k: string) => void;
  onToggleHide: (k: string) => void;
  search: string;
  onSearch: (v: string) => void;
  showReset: boolean;
  onReset: () => void;
  /** Optional extra header button (e.g. the admin "Set as company default"). */
  extraAction?: ReactElement | null;
}) {
  const q = search.trim().toLowerCase();
  // Always show every field — when searching, dim non-matches so the user
  // can still see context (what's above and below the result) instead of
  // having everything else disappear.
  const totalCount = alwaysKeys.length + optionalKeys.length;
  const matches = (k: string) => !q || k.toLowerCase().includes(q);
  const previewOf = (k: string) => {
    const s = String(rf[k] ?? "").trim();
    return (/^\d{4}-\d{2}-\d{2}T/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s) ? fmtDate(s) : s).slice(0, 60);
  };
  const groupHeader = (text: string) => (
    <div style={{ color: Colors.textMuted, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", padding: "6px 8px 4px", textTransform: "uppercase" }}>
      {text}
    </div>
  );
  const fieldRow = (k: string, checked: boolean, onToggle: () => void) => {
    const preview = previewOf(k);
    const hit = matches(k);
    return (
      <label key={k} style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "6px 8px", borderRadius: 6, cursor: "pointer",
        backgroundColor: hit && checked ? ACCENT_PURPLE + "14" : "transparent",
        border: `1px solid ${hit && q ? ACCENT_PURPLE + "88" : checked ? ACCENT_PURPLE + "55" : "transparent"}`,
        opacity: q && !hit ? 0.3 : checked ? 1 : 0.7,
        transition: "opacity 0.15s",
      }}>
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: checked ? Colors.white : Colors.textSecondary, fontSize: 12, fontWeight: 600 }}>{k}</div>
          {preview && (
            <div style={{ color: Colors.textMuted, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preview}</div>
          )}
        </div>
      </label>
    );
  };
  return (
    <div style={{
      marginBottom: 12, padding: 12, borderRadius: 10,
      backgroundColor: "var(--rm-panel-soft)", border: `1px solid ${Colors.border}`,
    }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <Search size={12} color={Colors.textMuted} />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={`Search ${totalCount} fields…`}
          style={{
            flex: 1, padding: "6px 8px", borderRadius: 8,
            backgroundColor: "rgba(255,255,255,0.04)",
            border: `1px solid ${Colors.border}`,
            color: Colors.white, fontSize: 12, outline: "none",
          }}
        />
        {showReset && (
          <button onClick={onReset} title="Return to your company's default fields" style={{
            padding: "6px 10px", borderRadius: 8,
            backgroundColor: "rgba(255,255,255,0.04)",
            border: `1px solid ${Colors.border}`,
            color: Colors.textSecondary, fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
          }}>Reset to defaults</button>
        )}
        {extraAction}
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        {alwaysKeys.length === 0 && optionalKeys.length === 0 ? (
          <div style={{ color: Colors.textMuted, fontSize: 12, padding: 8 }}>No fields available.</div>
        ) : (
          <>
            {alwaysKeys.length > 0 && (
              <>
                {groupHeader("Shown by default — untick to hide")}
                {alwaysKeys.map((k) => fieldRow(k, !hiddenKeys.includes(k), () => onToggleHide(k)))}
              </>
            )}
            {optionalKeys.length > 0 && (
              <>
                {groupHeader("Optional fields — tick to show")}
                {optionalKeys.map((k) => fieldRow(k, pinnedKeys.includes(k), () => onTogglePin(k)))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function getModule(id: string): string {
  const u = (id || "").toUpperCase();
  if (u.startsWith("PMM")) return "PMM";
  if (u.startsWith("OPM")) return "OPM";
  if (u.startsWith("LEM")) return "LEM";
  if (u.startsWith("COM")) return "COM";
  if (u.startsWith("CON")) return "CON";
  return "PMM";
}

// Server rows carry entityType ("lead" | "opportunity" | "project") even when
// ModuleName is absent (older cached rows / snapshots). Use it as a module
// signal before falling back to the prefix guess — a custom TicketId like
// "LD-0003" has no PMM/OPM/LEM prefix, and the getModule() "PMM" default would
// paint a lead as a project page.
const ENTITY_TYPE_MODULE: Record<string, string> = { lead: "LEM", opportunity: "OPM", project: "PMM" };
function moduleFromEntityType(v: unknown): string | undefined {
  return typeof v === "string" ? ENTITY_TYPE_MODULE[v.trim().toLowerCase()] : undefined;
}

function standardModuleFromId(id: string): string | undefined {
  const u = (id || "").toUpperCase();
  if (u.startsWith("PMM")) return "PMM";
  if (u.startsWith("OPM")) return "OPM";
  if (u.startsWith("LEM")) return "LEM";
  return undefined;
}

function computeHealth(d: ProjectData, ctx?: { lifecycleAssigned?: boolean; scheduleLastPhaseEnd?: string }) {
  return sharedComputeHealth(
    {
      status: d.status,
      value: d.value,
      targetStart: d.targetStart,
      targetEnd: d.targetEnd,
      actualEnd: d.actualEnd,
      probability: d.probability,
      module: d.module,
      allocations: d.allocations.map((a) => ({ name: a.name, role: a.role, pct: a.pct })),
    },
    ctx,
  );
}

function healthColor(score: number): string {
  if (score < 0) return "var(--rm-text-faint)";
  if (score >= 80) return "var(--rm-health-good)";
  if (score >= 60) return "var(--rm-health-warn)";
  return "var(--rm-health-bad)";
}
function healthLabel(score: number): string {
  if (score < 0) return "N/A";
  if (score >= 80) return "Healthy";
  if (score >= 60) return "At Risk";
  return "Critical";
}
function phaseColor(phase: string): string {
  const p = (phase || "").toLowerCase();
  if (p.includes("construct") || p.includes("progress")) return "#84CC16";
  if (p.includes("precon") || p.includes("design") || p.includes("awarded")) return "#FB923C";
  if (p.includes("bid") || p.includes("await") || p.includes("rom")) return "#38BDF8";
  if (p.includes("close")) return "#2DD4BF";
  return Colors.textSecondary;
}
function moduleColor(m: string): string {
  switch (m) {
    case "PMM": return "#84CC16";
    case "OPM": return "#FB923C";
    case "LEM": return "#38BDF8";
    case "COM": return "#A78BFA";
    case "CON": return "#2DD4BF";
    default: return "#84CC16";
  }
}

function shadeColor(input: string, amount: number): string {
  let r = 0, g = 0, b = 0;
  const m = input.trim();
  if (m.startsWith("#")) {
    const h = m.slice(1);
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
  } else if (m.startsWith("rgb")) {
    const nums = m.replace(/[^\d,]/g, "").split(",").map((n) => parseInt(n, 10));
    [r, g, b] = [nums[0] || 0, nums[1] || 0, nums[2] || 0];
  }
  const adj = (c: number) => {
    const v = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  return `rgb(${adj(r)},${adj(g)},${adj(b)})`;
}

const durationMonths = sharedDurationMonths;
const durationLabel = sharedDurationLabel;

/* ──────────────── HealthGauge (SVG, 270° arc, 3D layers) ──────────────── */
function HealthGauge({ score, issues = [], size = 130 }: { score: number; issues?: HealthIssue[]; size?: number }) {
  const padding = 26;
  const totalSize = size + padding * 2;
  const strokeW = 14;
  const r = (size - strokeW) / 2;
  const cx = totalSize / 2;
  const cy = totalSize / 2;
  const startAngle = 135;
  const arcDegrees = 270;
  const hc = healthColor(score);

  const deductionColor = "rgba(148, 163, 184, 0.55)";
  const segments: { value: number; color: string; label?: string }[] = [];
  const safeScore = Math.max(0, Math.min(100, score));
  if (safeScore > 0) segments.push({ value: safeScore, color: hc });
  issues.forEach((iss) => {
    if (iss.deduction > 0) {
      segments.push({ value: iss.deduction, color: deductionColor, label: `−${iss.deduction}` });
    }
  });

  const total = 100;
  const gapDeg = segments.length > 1 ? 3 : 0;
  const totalGap = gapDeg * Math.max(0, segments.length - 1);
  const usableDeg = arcDegrees - totalGap;

  function polar(angleDeg: number, radius: number) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }
  function arcPath(startA: number, endA: number, radius: number, dx = 0, dy = 0) {
    const s = polar(startA, radius);
    const e = polar(endA, radius);
    const largeArc = endA - startA > 180 ? 1 : 0;
    return `M ${s.x + dx} ${s.y + dy} A ${radius} ${radius} 0 ${largeArc} 1 ${e.x + dx} ${e.y + dy}`;
  }

  let cursor = startAngle;
  const rendered = segments.map((seg) => {
    const segDeg = (seg.value / total) * usableDeg;
    const segStart = cursor;
    const segEnd = cursor + segDeg;
    cursor = segEnd + gapDeg;
    return { ...seg, segStart, segEnd };
  });

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={totalSize} height={totalSize} viewBox={`0 0 ${totalSize} ${totalSize}`}>
        <path d={arcPath(startAngle, startAngle + arcDegrees, r, 1, 2)}
          stroke="rgba(0,0,0,0.45)" strokeWidth={strokeW + 2} fill="none" strokeLinecap="round" />
        <path d={arcPath(startAngle, startAngle + arcDegrees, r)}
          stroke="rgba(255,255,255,0.06)" strokeWidth={strokeW} fill="none" strokeLinecap="round" />
        {rendered.map((s, i) => (
          <path key={`shadow-${i}`} d={arcPath(s.segStart, s.segEnd, r, 1.5, 2.5)}
            stroke={shadeColor(s.color, -0.55)} strokeWidth={strokeW + 1} fill="none"
            strokeLinecap="round" opacity={0.55} />
        ))}
        {rendered.map((s, i) => (
          <path key={`base-${i}`} d={arcPath(s.segStart, s.segEnd, r)}
            stroke={s.color} strokeWidth={strokeW} fill="none" strokeLinecap="round" />
        ))}
        {rendered.map((s, i) => (
          <path key={`hi-${i}`} d={arcPath(s.segStart, s.segEnd, r, -0.6, -1.2)}
            stroke={shadeColor(s.color, 0.55)} strokeWidth={strokeW * 0.45} fill="none"
            strokeLinecap="round" opacity={0.7} />
        ))}
        {rendered.map((s, i) => (
          <path key={`gloss-${i}`} d={arcPath(s.segStart, s.segEnd, r, -0.3, -2)}
            stroke={shadeColor(s.color, 0.85)} strokeWidth={strokeW * 0.18} fill="none"
            strokeLinecap="round" opacity={0.6} />
        ))}
        {rendered.map((s, i) => {
          if (!s.label) return null;
          const midA = (s.segStart + s.segEnd) / 2;
          const labelPos = polar(midA, r + 16);
          return (
            <text key={`lbl-${i}`} x={labelPos.x} y={labelPos.y + 3}
              fontSize="10" fontWeight="bold" fill="rgba(226, 232, 240, 0.85)" textAnchor="middle">
              {s.label}
            </text>
          );
        })}
        <text x={cx + 1} y={cy - 2} fontSize="34" fontWeight="bold" fill="rgba(0,0,0,0.5)" textAnchor="middle">{score}</text>
        <text x={cx} y={cy - 4} fontSize="34" fontWeight="bold" fill={hc} textAnchor="middle">{score}</text>
        <text x={cx} y={cy + 16} fontSize="10" fontWeight={700} fill={hc} textAnchor="middle" opacity={0.85}>
          {healthLabel(score).toUpperCase()}
        </text>
      </svg>
    </div>
  );
}

/* ──────────────── HeroBg (animated gradient + glow) ──────────────── */
function HeroBg({ accent = Colors.green }: { accent?: string }) {
  return (
    <>
      <div style={{
        position: "absolute", inset: 0, borderRadius: 20, pointerEvents: "none",
        background: `linear-gradient(135deg, ${accent}22 0%, transparent 50%, ${ACCENT_BLUE}18 100%)`,
      }} />
      <div style={{
        position: "absolute", inset: 0, borderRadius: 20, pointerEvents: "none",
        background: "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, transparent 40%)",
      }} />
      <div style={{
        position: "absolute", top: -50, right: -50, width: 160, height: 160, borderRadius: 80,
        backgroundColor: accent, opacity: 0.16, pointerEvents: "none",
        animation: "rmone-pulse 6.4s ease-in-out infinite",
      }} />
      <style>{`
        @keyframes rmone-pulse {
          0%,100% { transform: scale(1) translate(0,0); opacity: 0.10; }
          50%     { transform: scale(1.25) translate(14px,-10px); opacity: 0.22; }
        }
        @keyframes rmone-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes rmone-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}

/* ──────────────── StatCard (count-up animation) ──────────────── */
function StatCard({ icon: Icon, iconColor, label, value, sub }: {
  icon: typeof Activity; iconColor: string; label: string; value: string; sub?: string;
}) {
  const [displayValue, setDisplayValue] = useState(value);
  const parsed = useMemo(() => {
    const m = value.match(/^(\D*)(-?[\d,.]+)(.*)$/);
    if (!m) return null;
    const num = parseFloat(m[2].replace(/,/g, ""));
    if (!isFinite(num)) return null;
    return { prefix: m[1], num, suffix: m[3] };
  }, [value]);

  useEffect(() => {
    if (!parsed) { setDisplayValue(value); return; }
    let raf: number; const start = performance.now(); const dur = 700;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const ease = 1 - Math.pow(1 - t, 3);
      const cur = parsed.num * ease;
      const formatted = Math.abs(parsed.num) >= 10 || parsed.num % 1 === 0
        ? Math.round(cur).toLocaleString() : cur.toFixed(1);
      setDisplayValue(`${parsed.prefix}${formatted}${parsed.suffix}`);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [parsed, value]);

  return (
    <div style={{
      flex: 1, backgroundColor: Colors.darkCard, borderRadius: 18, border: `1px solid ${Colors.border}`,
      padding: "20px 14px", display: "flex", flexDirection: "column", alignItems: "center",
      minHeight: 130, overflow: "hidden", boxShadow: "0 8px 16px rgba(0,0,0,0.35)",
      animation: "rmone-fade-in 0.5s ease-out",
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 14, backgroundColor: iconColor + "20",
        display: "flex", alignItems: "center", justifyContent: "center",
        border: `1px solid ${iconColor}30`, marginBottom: 10,
      }}>
        <Icon size={20} color={iconColor} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: Colors.white, marginBottom: 4 }}>{displayValue}</div>
      <div style={{ fontSize: 10, color: Colors.textMuted, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: iconColor, marginTop: 4, fontWeight: 600 }}>{sub}</div>}
    </div>
  );
}

/* ──────────────── Graphical stat cards ──────────────── */

// Team card with stacked avatar pile + average allocation bar so the team
// summary reads visually at a glance instead of as a single number.
function TeamStatCard({ allocations, avgAlloc, hidePct = false, loading = false }: {
  allocations: { name: string; pct?: number }[];
  avgAlloc: number;
  hidePct?: boolean;
  loading?: boolean;
}) {
  const palette = ["#6BA539", "#3B82F6", "#E87722", "#8E5BD9", "#16A6B0", "#A9C23F", "#F59E0B"];
  const initialsOf = (n: string) => (n || "?")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(s => s[0]?.toUpperCase() ?? "").join("") || "?";
  const visible = allocations.slice(0, 4);
  const hidden = Math.max(0, allocations.length - visible.length);
  const isEmpty = allocations.length === 0;
  const barColor = avgAlloc > 100 ? "#F9AB33" : avgAlloc >= 75 ? "var(--rm-health-warn)" : ACCENT_BLUE;
  const barPct = Math.min(100, Math.max(0, avgAlloc));

  return (
    <div style={{
      flex: 1, backgroundColor: Colors.darkCard, borderRadius: 18,
      border: `1px solid ${Colors.border}`, padding: "16px 14px",
      display: "flex", flexDirection: "column", alignItems: "center",
      minHeight: 130, overflow: "hidden", boxShadow: "0 8px 16px rgba(0,0,0,0.35)",
      animation: "rmone-fade-in 0.5s ease-out",
    }}>
      {/* Avatar pile (or shimmer while loading, or dashed-outline placeholder
          pile when no team yet — still gives the card a graphic rather than
          collapsing to a bare "0 TEAM" label). */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        {loading ? (
          [0, 1, 2, 3].map((i) => (
            <div
              key={i}
              aria-hidden
              style={{
                width: 32, height: 32, borderRadius: "50%",
                background: "linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.13) 50%, rgba(255,255,255,0.06) 75%)",
                backgroundSize: "200% 100%",
                animation: "rmone-shimmer 1.4s infinite",
                marginLeft: i === 0 ? 0 : -10,
              }}
            />
          ))
        ) : isEmpty ? (
          [0, 1, 2, 3].map((i) => (
            <div
              key={i}
              aria-hidden
              style={{
                width: 32, height: 32, borderRadius: "50%",
                backgroundColor: "transparent",
                border: `2px dashed rgba(255,255,255,0.18)`,
                marginLeft: i === 0 ? 0 : -10,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "rgba(255,255,255,0.30)", fontSize: 13, fontWeight: 700,
              }}
            >
              +
            </div>
          ))
        ) : (
          <>
            {visible.map((a, i) => (
              <div key={i} title={hidePct ? a.name : `${a.name} · ${a.pct ?? 0}%`} style={{
                width: 32, height: 32, borderRadius: "50%",
                backgroundColor: palette[i % palette.length],
                border: `2px solid ${Colors.darkCard}`,
                marginLeft: i === 0 ? 0 : -10,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#FFF", fontSize: 11, fontWeight: 700,
                boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
              }}>{initialsOf(a.name)}</div>
            ))}
            {hidden > 0 && (
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                backgroundColor: "rgba(255,255,255,0.10)",
                border: `2px solid ${Colors.darkCard}`, marginLeft: -10,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: Colors.white, fontSize: 11, fontWeight: 700,
              }}>+{hidden}</div>
            )}
          </>
        )}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: Colors.white, lineHeight: 1, marginBottom: 4 }}>
        {loading ? "·· ·" : allocations.length}
      </div>
      <div style={{ fontSize: 10, color: Colors.textMuted, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>
        Team
      </div>
      {loading ? (
        <div style={{ width: "70%", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div style={{ width: "100%", height: 4, borderRadius: 2, backgroundColor: "var(--rm-panel-border)", overflow: "hidden" }}>
            <div style={{ width: "40%", height: "100%", background: "rgba(255,255,255,0.12)", animation: "rmone-shimmer 1.4s infinite" }} />
          </div>
          <div style={{ fontSize: 10, color: Colors.textMuted, fontWeight: 600 }}>Loading…</div>
        </div>
      ) : avgAlloc > 0 ? (
        <div style={{ width: "70%", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div style={{ width: "100%", height: 4, borderRadius: 2, backgroundColor: "var(--rm-panel-border)", overflow: "hidden" }}>
            <div style={{
              width: `${barPct}%`, height: "100%", backgroundColor: barColor,
              transition: "width 0.6s cubic-bezier(0.2,0.8,0.2,1)",
            }} />
          </div>
          <div style={{ fontSize: 10, color: barColor, fontWeight: 700 }}>{avgAlloc}% avg</div>
        </div>
      ) : isEmpty ? (
        <div style={{ width: "70%", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div style={{ width: "100%", height: 4, borderRadius: 2, backgroundColor: "var(--rm-panel-border)", overflow: "hidden" }} />
          <div style={{ fontSize: 10, color: Colors.textMuted, fontWeight: 600 }}>No team yet</div>
        </div>
      ) : null}
    </div>
  );
}

// Health card with a circular ring gauge that fills based on score, sized to
// match the other StatCards. Renders the score in the centre and a status
// label below — purely presentational, no extra fetches.
function HealthStatCard({ score, color, label }: {
  score: number; color: string; label: string;
}) {
  const SIZE = 64;
  const STROKE = 7;
  const R = (SIZE - STROKE) / 2;
  const C = 2 * Math.PI * R;
  const clamped = Math.max(0, Math.min(100, score));
  const dash = (clamped / 100) * C;

  return (
    <div style={{
      flex: 1, backgroundColor: Colors.darkCard, borderRadius: 18,
      border: `1px solid ${Colors.border}`, padding: "16px 14px",
      display: "flex", flexDirection: "column", alignItems: "center",
      minHeight: 130, overflow: "hidden", boxShadow: "0 8px 16px rgba(0,0,0,0.35)",
      animation: "rmone-fade-in 0.5s ease-out",
    }}>
      <div style={{ position: "relative", width: SIZE, height: SIZE, marginBottom: 8 }}>
        <svg width={SIZE} height={SIZE} style={{ transform: "rotate(-90deg)" }}>
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={R}
            fill="none" stroke="var(--rm-panel-border)" strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={R}
            fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round"
            strokeDasharray={`${dash} ${C - dash}`}
            style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.2,0.8,0.2,1)" }}
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16, fontWeight: 700, color,
        }}>{score}</div>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: Colors.white, lineHeight: 1, marginBottom: 4 }}>
        {score}%
      </div>
      <div style={{ fontSize: 10, color: Colors.textMuted, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>
        Health
      </div>
      <div style={{ fontSize: 10, color, marginTop: 4, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

/* ──────────────── SectionCard (collapsible) ──────────────── */
function SectionCard({ id, icon: Icon, iconColor, title, subtitle, badge, expanded, onToggle, order, children }: {
  id?: string; icon: typeof Activity; iconColor: string; title: string;
  /** Optional single-line subtitle shown below the title inside the header button. */
  subtitle?: string | null;
  badge?: React.ReactNode; expanded: boolean;
  // Receives the click event so callers can detect Shift / Ctrl / Cmd
  // modifiers (used for the multi-card "extend selection" gesture).
  onToggle: (e: React.MouseEvent<HTMLButtonElement>) => void;
  // CSS grid order — use negative values to promote a card to the top.
  order?: number;
  children: React.ReactNode;
}) {
  // Auto-scroll the section into view the first time it expands so users
  // don't have to manually scroll down past the page header.
  const cardRef = useRef<HTMLDivElement>(null);
  const wasExpandedRef = useRef(expanded);
  // Track whether the body has ever been opened. Once it has, we keep the
  // child component mounted (just hidden via display:none on collapse) so
  // its data fetches run exactly once per session instead of re-firing
  // every time the user re-expands the card. Combined with the per-project
  // cache in lib/api.ts, this makes opening any card feel instant after the
  // first time.
  const [everOpened, setEverOpened] = useState(expanded);
  useEffect(() => {
    if (expanded) setEverOpened(true);
    if (expanded && !wasExpandedRef.current) {
      // Defer to next frame so the expanded body has been mounted.
      requestAnimationFrame(() => {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    wasExpandedRef.current = expanded;
  }, [expanded]);
  return (
    <div id={id} ref={cardRef} style={{
      gridColumn: expanded ? "1 / -1" : undefined,
      order,
      backgroundColor: Colors.darkCard, borderRadius: 18,
      border: `2px solid ${expanded ? iconColor + "66" : "var(--rm-panel-border)"}`, overflow: "hidden",
      boxShadow: "0 6px 14px rgba(0,0,0,0.3)",
      transition: "border-color 0.2s ease, box-shadow 0.2s ease",
      scrollMarginTop: 80,
    }}>
      <button onClick={onToggle} title="Click to open · Shift-click to keep others open" style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: "14px 16px", background: "transparent", border: "none", cursor: "pointer",
        color: "inherit", textAlign: "left",
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10, backgroundColor: iconColor + "20",
          display: "flex", alignItems: "center", justifyContent: "center",
          border: `1px solid ${iconColor}30`,
        }}>
          <Icon size={15} color={iconColor} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: Colors.white }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 11, color: Colors.textMuted, fontWeight: 500, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {subtitle}
            </div>
          )}
        </div>
        {badge}
        {expanded ? <ChevronUp size={18} color={Colors.textMuted} /> : <ChevronDown size={18} color={Colors.textMuted} />}
      </button>
      {everOpened && <div style={{ padding: "0 16px 16px", display: expanded ? "block" : "none" }}>{children}</div>}
    </div>
  );
}

/* Preset choice lists for the module-section dropdowns. Merged with the
   tenant's live values (getFieldOptions scrape) so the dropdowns are never
   empty on a fresh tenant. Kept in lockstep with the option lists in
   ManualEntryModal / InlineDataGrid. */
const PROJECT_TYPE_PRESETS = ["New Construction", "Renovation", "Design-Build", "Reconstruction", "Rehabilitation", "Addition", "Retrofit", "Interior Fit-Out"];
const SERVICE_TYPE_PRESETS = ["Architecture", "Engineering", "Construction Management", "General Contracting", "Program Management", "Inspection", "Owner's Representative", "Design-Build"];
const REQUEST_CATEGORY_PRESETS = ["Service Projects (CNS)", "Construction Projects (CPR)"];

/* ──────────────── ValueHistoryModal ────────────────
 * Financial-value audit trail: who changed Contract Value / Approx Contract
 * Value / Labor Contract / Forecasted Project Cost / Non-Operating Cost, when,
 * and old → new — served by the
 * RMOneFieldHistory ledger (appended best-effort on every save path;
 * imports land as snapshot+diff rows tagged "File import"). Only financial
 * editors get the affordance (canEditFinancialFields) and the endpoint
 * re-checks the same rules server-side, failing closed.
 */
const FIELD_HISTORY_LABELS: Record<string, string> = {
  ContractValue: "Contract Value",
  ApproxContractValue: "Approx Contract Value",
  ProjectValue: "Project Value",
  LaborContractAmount: "Labor Contract",
  ForecastedProjectCost: "Forecasted Project Cost",
  NonOperatingCost: "Non-Operating Cost",
};
function DetailCell({ label, value, color, fixedHalfWidth, editable, editType, options, editValue, onSave, formatOptimistic, disableBlank, onDraftChange, searchable, lockedNote, onHistory, disabledOptions, actionOptions, searchPlaceholder, customHint, indentedOptions, optionAction }: {
  label: string; value: string; color?: string;
  fixedHalfWidth?: boolean;
  editable?: boolean;
  editType?: "text" | "number" | "select" | "date";
  options?: string[];
  // Searchable-select only: pinned rows at the top of the option list that
  // perform an action instead of picking a value (e.g. the Status cell's
  // "Select a lifecycle schedule…" jump when no lifecycle is assigned yet).
  // Picking one closes the editor without saving.
  actionOptions?: { label: string; onPick: () => void }[];
  // Searchable-select only: overrides the combobox placeholder.
  searchPlaceholder?: string;
  // Select-only: option value → tooltip explaining WHY it can't be chosen
  // (e.g. a group-restricted workflow type the user may keep but not re-set,
  // #121). Disabled options still display when selected as the current draft,
  // but Save is blocked while one is picked.
  disabledOptions?: Record<string, string>;
  editValue?: string;
  onSave?: (v: string) => Promise<void> | void;
  // Company stage-rule lock: when set, the cell renders read-only with a lock
  // icon whose tooltip explains WHY (e.g. "locked once a record reaches
  // Awarded"). The server enforces the same rule — this is the courteous
  // up-front version of the 403 the save would get.
  lockedNote?: string;
  // Contract-value cells only (#724): opens the record's value-change history
  // popup (who changed it, when, old → new). Passed only when the viewer may
  // see financials — the server enforces the same gate on the endpoint.
  onHistory?: () => void;
  // Select-only: replaces the native <select> with a searchable combobox — a
  // text input that filters the option list AND doubles as free-text entry, so
  // long lists (e.g. Status) are searchable and custom values can be typed in.
  searchable?: boolean;
  // Formats the raw edited value for the optimistic display after a save, so
  // currency/number fields don't briefly show the unformatted number (e.g. "326"
  // instead of "$326K") until the background reload reconciles.
  formatOptimistic?: (raw: string) => string;
  // When true, the Save button is disabled while the draft is empty. Prevents
  // accidentally clearing a field that previously had a value.
  disableBlank?: boolean;
  // Called on every select-change so the parent can cascade-filter dependent fields
  // (e.g. BU → Division → Department) in real time as the user picks values.
  onDraftChange?: (v: string) => void;
  // Searchable selects only: a muted hint row pinned at the BOTTOM of the
  // option list while the input is untouched, telling users they can type a
  // value that isn't listed (the "Use … as a custom value" row only appears
  // once they start typing — this makes that path discoverable up front).
  customHint?: string;
  // Set of option VALUES (exact, as they appear in the list) that should render
  // indented under their parent phase — used for schedule sub-statuses so the
  // dropdown visually groups them below the phase they belong to.
  indentedOptions?: Set<string>;
  // Small trailing "+ <label>" pill on every NON-indented option row (e.g.
  // schedule phases): one-click entry into a per-option action — used by the
  // STATUS cell to jump straight into that phase's sub-status input without
  // opening the customize modal and hunting for the phase first.
  optionAction?: { title: string; label: string; onPick: (option: string) => void };
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Optimistic value shown immediately after a successful save, while the
  // canonical project data refreshes in the background. Reset whenever the
  // incoming `value` prop changes (the background reload reconciled it).
  const [localValue, setLocalValue] = useState<string | null>(null);
  useEffect(() => { setLocalValue(null); }, [value]);

  const start = () => {
    setDraft(editValue != null ? editValue : (value === "—" ? "" : value));
    setError("");
    setEditing(true);
  };
  const cancel = () => {
    if (!saving) {
      setEditing(false);
      setError("");
      onDraftChange?.("");   // reset parent cascade tracking when cancelled
    }
  };
  const blankBlocked = !!(disableBlank && draft.trim() === "");
  // A disabled option picked as the draft (only possible when it's the cell's
  // CURRENT value) — saving it would just earn the server's 403, so block the
  // commit and explain via the Save button tooltip.
  const draftRestricted = editType === "select" && !!draft && disabledOptions?.[draft] != null;
  const saveBlocked = blankBlocked || draftRestricted;
  // Date editors only report their value on blur/Enter/pick — the Save button
  // preventDefaults its mousedown (no blur), so it must flush the field itself.
  const dateFieldRef = useRef<DateFieldHandle | null>(null);
  const commit = async (override?: string) => {
    if (blankBlocked || draftRestricted) return;
    if (!onSave) { setEditing(false); return; }
    const savedDraft = (override ?? draft).trim();
    // Optimistic close: dismiss the editor immediately so the UI feels instant.
    // The new value is shown right away via localValue; if the API call fails we
    // revert localValue and re-open the editor so the user can fix the problem.
    setLocalValue(formatOptimistic ? formatOptimistic(savedDraft) : savedDraft);
    setEditing(false);
    setSaving(true); setError("");
    try {
      await onSave(savedDraft);
    } catch (e) {
      // Revert: put the editor back with the user's draft and the error message.
      setLocalValue(null);
      setDraft(savedDraft);
      setError(e instanceof Error ? e.message : "Save failed");
      setEditing(true);
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    flex: 1, minWidth: 0, padding: "5px 7px", borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.06)", border: `1px solid ${Colors.border}`,
    color: Colors.white, fontSize: 13, fontWeight: 600, outline: "none",
  };
  // The native <select> popup renders on the OS's default (white) background, so
  // the white inputStyle text is invisible there — force dark-on-white options.
  const optStyle: React.CSSProperties = { color: "#111827", backgroundColor: "#fff" };
  const iconBtn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 24, height: 24, borderRadius: 6, border: "none", cursor: "pointer",
    backgroundColor: "transparent",
  };

  return (
    <div style={{
      flex: `${fixedHalfWidth ? "0 1" : "1 1"} calc(50% - 4px)`, minWidth: 140, padding: 10,
      backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 10,
      border: `1px solid ${editing ? ACCENT_PURPLE + "66" : saving ? Colors.green + "44" : Colors.border}`,
      position: "relative", transition: "border-color 0.15s",
    }}>
      {/* Subtle saving indicator — spins while the API write is in-flight
          after the editor has already closed (optimistic close). */}
      {saving && !editing && (
        <div style={{ position: "absolute", top: 6, right: 6 }}>
          <Loader2 size={10} className="rmone-spin" style={{ color: Colors.green }} />
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {onHistory && !editing && (
            <button onClick={onHistory} title={`${label} — change history`} style={{ ...iconBtn, width: 20, height: 20 }}>
              <Clock size={11} color={Colors.textMuted} />
            </button>
          )}
          {lockedNote ? (
            <span title={lockedNote} aria-label={lockedNote}
              style={{ display: "inline-flex", alignItems: "center", cursor: "help", padding: 2 }}>
              <LockIcon size={11} color={Colors.textMuted} />
            </span>
          ) : editable && !editing && !saving && (
            <button onClick={start} title={`Edit ${label}`} style={{ ...iconBtn, width: 20, height: 20 }}>
              <Edit2 size={11} color={Colors.textMuted} />
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div style={{ marginTop: 4 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {editType === "select" && searchable ? (
              // Searchable combobox: the input filters the list below AND is
              // itself the value — typing something not in the list and saving
              // stores it as a custom option.
              <input
                type="text"
                value={draft}
                onChange={(e) => { setDraft(e.target.value); onDraftChange?.(e.target.value); }}
                disabled={saving}
                autoFocus
                placeholder={searchPlaceholder ?? "Search or type a custom value…"}
                onKeyDown={(e) => { if (e.key === "Enter" && !blankBlocked) { e.preventDefault(); void commit(); } if (e.key === "Escape") cancel(); }}
                style={inputStyle}
              />
            ) : editType === "select" ? (
              <select
                value={draft}
                onChange={(e) => { setDraft(e.target.value); onDraftChange?.(e.target.value); }}
                disabled={saving || !options?.length}
                autoFocus
                style={inputStyle}
                onKeyDown={(e) => { if (e.key === "Enter" && !blankBlocked) { e.preventDefault(); void commit(); } if (e.key === "Escape") cancel(); }}
              >
                {(!options || options.length === 0) ? (
                  <option value="" style={optStyle}>Loading options…</option>
                ) : (
                  <>
                    <option value="" style={optStyle}>—</option>
                    {options.map((o) => {
                      const restrictedNote = disabledOptions?.[o];
                      return (
                        <option key={o} value={o} style={optStyle} disabled={restrictedNote != null} title={restrictedNote}>
                          {o}{restrictedNote != null ? " (restricted)" : ""}
                        </option>
                      );
                    })}
                    {/* This record's current value is no longer in the configured list
                        (e.g. a stage removed from the pipeline). Keep it selectable so
                        the real value isn't lost, but flag it as retired so it doesn't
                        look like a normal choice. */}
                    {draft && !options.includes(draft) && <option value={draft} style={optStyle}>{draft} (retired)</option>}
                  </>
                )}
              </select>
            ) : editType === "date" ? (
              <AppDateField
                ref={dateFieldRef}
                value={draft}
                onChange={setDraft}
                disabled={saving}
                autoFocus
                onEnter={(v) => { void commit(v); }}
                onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}
                style={inputStyle}
                wrapStyle={{ flex: 1, minWidth: 0, width: "auto" }}
              />
            ) : (
              <input
                type={editType === "number" ? "number" : "text"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={saving}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && !blankBlocked) commit(); if (e.key === "Escape") cancel(); }}
                style={inputStyle}
              />
            )}
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                if (saving || saveBlocked) return;
                // Date fields: parse whatever is typed right now so the click
                // saves the fresh value, not the last blur-committed draft.
                const override = editType === "date" ? dateFieldRef.current?.commitNow() : undefined;
                if (disableBlank && override !== undefined && override.trim() === "") return;
                void commit(override);
              }}
              disabled={saving || saveBlocked}
              title={blankBlocked ? "Enter a value to save" : draftRestricted ? (disabledOptions?.[draft] ?? "You can't set this value") : "Save"}
              style={{ ...iconBtn, backgroundColor: saveBlocked ? "transparent" : Colors.green + "22", opacity: saveBlocked ? 0.35 : 1 }}
            >
              <CheckCircle size={15} color={Colors.green} />
            </button>
            <button onMouseDown={(e) => { e.preventDefault(); cancel(); }} disabled={saving} title="Cancel" style={iconBtn}>
              <X size={15} color={Colors.textMuted} />
            </button>
          </div>
          {editType === "select" && searchable && (() => {
            const q = draft.trim().toLowerCase();
            const opts = options ?? [];
            // When the input still holds the record's CURRENT value — whether
            // or not it's in the configured list (e.g. a retired stage like
            // "Closed") — show the FULL option list so the user can browse
            // every choice. Only narrow the list once they actually type
            // something different that isn't an exact option match.
            const current = String((localValue ?? value) ?? "").trim().toLowerCase();
            const untouched = q === current;
            const exact = opts.some((o) => o.toLowerCase() === q);
            const filtered = untouched || exact || !q ? opts : opts.filter((o) => o.toLowerCase().includes(q));
            return (
              <div style={{
                marginTop: 6, maxHeight: 190, overflowY: "auto", borderRadius: 8,
                border: `1px solid ${Colors.border}`, backgroundColor: "rgba(255,255,255,0.03)",
              }}>
                {(actionOptions ?? []).map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    // onMouseDown + preventDefault keeps focus in the input so
                    // the editor doesn't blur-close before onPick runs.
                    onMouseDown={(e) => { e.preventDefault(); if (saving) return; cancel(); a.onPick(); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, width: "100%",
                      padding: "8px 10px", border: "none", borderBottom: `1px solid ${Colors.border}`,
                      backgroundColor: ACCENT_PURPLE + "14", color: ACCENT_PURPLE,
                      fontSize: 12, fontWeight: 700, cursor: "pointer", textAlign: "left",
                    }}>
                    <Layers size={12} /> {a.label}
                  </button>
                ))}
                {draft.trim() !== "" && !exact && !untouched && (
                  <button
                    type="button"
                    // onMouseDown + preventDefault keeps focus in the input so
                    // the editor doesn't blur-close before the commit runs.
                    onMouseDown={(e) => { e.preventDefault(); if (!saving) void commit(); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, width: "100%",
                      padding: "7px 10px", border: "none", borderBottom: `1px solid ${Colors.border}`,
                      backgroundColor: "transparent", color: ACCENT_PURPLE,
                      fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left",
                    }}>
                    <Plus size={12} /> Use “{draft.trim()}” as a custom value
                  </button>
                )}
                {filtered.map((o) => {
                  const isSel = o === draft;
                  // indentedOptions holds LOWERCASE keys (getSubStatusKeys) —
                  // compare case-insensitively or mixed-case subs lose their indent.
                  const isIndented = indentedOptions?.has(o.trim().toLowerCase());
                  return (
                    <button
                      key={o}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); setDraft(o); onDraftChange?.(o); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 5, width: "100%",
                        padding: isIndented ? "5px 10px 5px 26px" : "7px 10px",
                        border: "none",
                        backgroundColor: isSel ? ACCENT_PURPLE + "22" : "transparent",
                        color: isSel ? ACCENT_PURPLE : isIndented ? Colors.textMuted : Colors.white,
                        fontSize: isIndented ? 11.5 : 12, fontWeight: isSel ? 700 : 500,
                        cursor: "pointer", textAlign: "left",
                      }}>
                      {isIndented && <span style={{ opacity: 0.5, fontSize: 10, flexShrink: 0 }}>└</span>}
                      <span style={{ flex: 1, minWidth: 0 }}>{o}</span>
                      {optionAction && !isIndented && (
                        // span, not <button>: the row itself is a button — nested
                        // buttons are invalid HTML and break click handling.
                        <span
                          role="button"
                          title={optionAction.title}
                          onMouseDown={(e) => {
                            // stopPropagation: don't select the row; preventDefault:
                            // keep focus so the editor doesn't blur-close early.
                            e.preventDefault(); e.stopPropagation();
                            if (saving) return;
                            cancel();
                            optionAction.onPick(o);
                          }}
                          style={{
                            display: "flex", alignItems: "center", gap: 3, flexShrink: 0,
                            padding: "2px 7px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                            color: ACCENT_PURPLE, backgroundColor: ACCENT_PURPLE + "14",
                            border: `1px solid ${ACCENT_PURPLE}33`,
                          }}
                        >
                          <Plus size={10} /> {optionAction.label}
                        </span>
                      )}
                    </button>
                  );
                })}
                {customHint && (untouched || q === "") && (
                  <div style={{
                    padding: "7px 10px", fontSize: 11, color: Colors.textMuted,
                    borderTop: `1px solid ${Colors.border}`, display: "flex", alignItems: "center", gap: 6,
                  }}>
                    <Edit2 size={11} style={{ flexShrink: 0 }} /> {customHint}
                  </div>
                )}
                {opts.length === 0 && draft.trim() === "" && !(actionOptions && actionOptions.length > 0) && (
                  <div style={{ padding: "8px 10px", fontSize: 11, color: Colors.textMuted }}>Loading options…</div>
                )}
                {opts.length > 0 && filtered.length === 0 && draft.trim() !== "" && (
                  <div style={{ padding: "8px 10px", fontSize: 11, color: Colors.textMuted }}>
                    No matching options — save to use your custom value.
                  </div>
                )}
              </div>
            );
          })()}
          {error && <div style={{ fontSize: 10, color: "#F87171", marginTop: 4 }}>{error}</div>}
        </div>
      ) : (
        <div style={{ fontSize: 13, fontWeight: 600, color: color || Colors.white, marginTop: 4 }}>{(localValue ?? value) || "—"}</div>
      )}
    </div>
  );
}

/* ──────────────── AiActionCard ──────────────── */
function AiActionCard({ icon: Icon, label, gradient, onClick, index }: {
  icon: typeof Activity; label: string; gradient: [string, string]; onClick: () => void; index: number;
}) {
  // Compact horizontal pill — 2 per row, ~56px tall instead of the previous
  // 180px tile. Replaces the gap-heavy "icon + label + RUN AI footer" layout
  // that ate ~400px of vertical space. Icon, label and arrow now sit on one
  // row, so the whole AI Quick Actions section fits in ~140px.
  const flat = label.replace(/\n/g, " ");
  return (
    <button onClick={onClick} style={{
      // Auto-fit: ~4 per row on desktop, 2 per row on tablet, 1 on narrow.
      flex: "1 1 200px", minWidth: 180,
      minHeight: 52, padding: "8px 12px", borderRadius: 10,
      backgroundColor: "rgba(255,255,255,0.03)",
      border: `2px solid ${gradient[0]}55`,
      cursor: "pointer", textAlign: "left", color: Colors.white,
      animation: "rmone-fade-in 0.4s ease-out both", animationDelay: `${index * 50}ms`,
      transition: "transform 120ms ease, background-color 120ms ease, border-color 120ms ease",
      display: "flex", alignItems: "center", gap: 10,
    }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.backgroundColor = gradient[0] + "10";
        e.currentTarget.style.borderColor = gradient[0] + "AA";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.03)";
        e.currentTarget.style.borderColor = gradient[0] + "55";
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 9, flexShrink: 0,
        background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon size={15} color="#FFF" />
      </div>
      <span style={{
        flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: Colors.white,
        lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{flat}</span>
      <ArrowRight size={13} color={gradient[0]} style={{ flexShrink: 0, opacity: 0.85 }} />
    </button>
  );
}

/* ──────────────── TeamMemberCard (expandable) ──────────────── */
function TeamMemberCard({ member, color, expanded, onToggle, onEdit, canEdit = true, lockedNote = null, projectId, module, scheduleStart = "", scheduleEnd = "", onReload, onSetupSchedule, hideHours = false, hideSchedule = false, refreshToken }: {
  member: Allocation; color: string; expanded: boolean; onToggle: () => void; onEdit: () => void; canEdit?: boolean; lockedNote?: string | null; projectId: string; module?: string | null; scheduleStart?: string; scheduleEnd?: string; onReload?: (fetchTeam?: boolean) => void; onSetupSchedule?: () => void; hideHours?: boolean; hideSchedule?: boolean; refreshToken?: number;
}) {
  // Rates are financial data — only show "Set cost rate" to users who can
  // actually set them (the import + rate routes are server-gated anyway).
  const canSetRates = useEditFinancialsCap();
  const initials = member.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const fmtD = (d: string) => {
    if (!d) return "—";
    const dt = new Date(d.length === 10 ? d + "T00:00:00" : d);
    return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  const parseMs = (d: string) => (d ? Date.parse(d.length === 10 ? d + "T00:00:00" : d) : NaN);
  // Always use the member's own last-allocated week as the displayed end date.
  const displayEnd = member.endDate;
  // Use the member's own stored start date when it is a valid modern date.
  // Only fall back to the schedule start when the member has no start at all,
  // or carries a SQL sentinel (e.g. "Jan 1, 1900") — detected as pre-2000.
  // Do NOT replace a valid early start (e.g. Aug 20) with a later schedule
  // start (e.g. Nov 1) — the member genuinely began before the schedule.
  const SENTINEL_CUTOFF_MS = Date.parse("2000-01-01T00:00:00");
  const memStartMs = parseMs(member.startDate);
  const schedStartIso = scheduleStart ? scheduleStart.slice(0, 10) : "";
  const schedStartMs = parseMs(schedStartIso);
  const memStartValid = !isNaN(memStartMs) && memStartMs > SENTINEL_CUTOFF_MS;
  const displayStart = memStartValid ? member.startDate : schedStartIso;
  const fmtCost = (v: number) => {
    if (!v) return "$0";
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 10_000) return `$${(v / 1000).toFixed(1)}K`;
    return `$${Math.round(v).toLocaleString("en-US")}`;
  };

  // Sparkline: 12 pseudo-bars derived from member name hash (no weekly data on this type)
  const nameHash = member.name.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffff, 0);
  const sparkBars = Array.from({ length: 12 }, (_, i) => {
    const v = Math.sin((nameHash + i * 137) * 0.04) * 0.4 + Math.sin(i * 0.7) * 0.3 + 0.5;
    return Math.max(0.15, Math.min(1, v));
  });
  // Derive per-segment hours and period labels for tooltip
  const sparkTotal = sparkBars.reduce((s, v) => s + v, 0);
  const sparkSegments = (() => {
    const startMs = displayStart ? Date.parse(displayStart.length === 10 ? displayStart + "T00:00:00" : displayStart) : NaN;
    const endMs   = displayEnd   ? Date.parse(displayEnd.length   === 10 ? displayEnd   + "T00:00:00" : displayEnd)   : NaN;
    const spanMs  = (!isNaN(startMs) && !isNaN(endMs)) ? endMs - startMs : 0;
    const segMs   = spanMs > 0 ? spanMs / 12 : 0;
    const fmt = (ms: number) => {
      const d = new Date(ms);
      return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    };
    let cum = 0;
    return sparkBars.map((v, i) => {
      const hrs = member.eacHrs > 0 ? Math.round((v / sparkTotal) * member.eacHrs) : null;
      cum += hrs ?? 0;
      const label = segMs > 0 ? fmt(startMs + segMs * i) : `Period ${i + 1}`;
      return { hrs, cum, label };
    });
  })();
  const [hoveredBar, setHoveredBar] = useState<{ idx: number; x: number; y: number } | null>(null);
  const buLabel = (member.memberBu || member.bu || "").trim();
  const buTag = buLabel.length > 0 ? buLabel.slice(0, 3).toUpperCase() : null;

  return (
    <div style={{
      backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12,
      border: `1px solid ${Colors.border}`,
      borderLeft: `3px solid ${color}`,
      overflow: "hidden", display: "flex", flexDirection: "column",
      gridColumn: expanded ? "1 / -1" : undefined,
    }}>
      {/* ── Card collapsed header (click to expand) ── */}
      <button onClick={onToggle} style={{
        flex: 1, background: "transparent", border: "none", cursor: "pointer",
        color: "inherit", textAlign: "left", padding: 0,
      }}>
        {/* Top row: avatar + name/role + allocation % */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 12px 6px" }}>
          <div style={{
            width: 36, height: 36, borderRadius: 18, flexShrink: 0,
            backgroundColor: color + "22",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: `1.5px solid ${color}55`,
          }}>
            <span style={{ color, fontWeight: 700, fontSize: 12 }}>{initials || "?"}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: empTypeColor(member.employeeType) ?? Colors.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{member.name}</div>
            {/* Role line: compact abbreviation ("Sr PM") so long role names
                never truncate; full text on hover via the title attribute. */}
            <div
              title={member.role || member.title || "Team Member"}
              style={{ fontSize: 11, color: Colors.textSecondary, fontWeight: 500, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >{abbrevRole(member.role || member.title || "Team Member")}</div>
          </div>
          {!hideHours && (
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: member.pct > 100 ? "#F9AB33" : color, lineHeight: 1 }}>
                {+member.pct.toFixed(0)}%
              </div>
              <div style={{ fontSize: 9, color: Colors.textMuted, marginTop: 1 }}>allocation</div>
              {member.eacHrs > 0 && (
                <div style={{ fontSize: 11, fontWeight: 700, color: Colors.white, marginTop: 3 }}>
                  {Math.round(member.eacHrs)}h
                </div>
              )}
            </div>
          )}
        </div>

        {/* Middle row: dates + BU tag + chevron */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 8px", gap: 6 }}>
          {(displayStart || displayEnd) ? (
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: Colors.textMuted, minWidth: 0 }}>
              <Calendar size={10} color={Colors.textMuted} style={{ flexShrink: 0 }} />
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {fmtD(displayStart)} – {fmtD(displayEnd)}
              </span>
            </div>
          ) : <div />}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {buTag && (
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
                padding: "2px 7px", borderRadius: 20,
                backgroundColor: color + "20", color, border: `1px solid ${color}40`,
              }}>{buTag}</span>
            )}
            {/* Edit pencil — lives inline with the BU tag/chevron so the card
                doesn't need a separate bottom row. Rendered inside the toggle
                <button> so we stop propagation to avoid expanding the card. */}
            {(canEdit || lockedNote) && (
              <span
                role="button"
                tabIndex={0}
                aria-disabled={lockedNote ? true : undefined}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (!lockedNote) onEdit(); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); if (!lockedNote) onEdit(); } }}
                title={lockedNote ?? "Edit allocation"}
                aria-label={lockedNote ?? `Edit allocation for ${member.name}`}
                style={{
                  // Pill-shaped to exactly match the BU tag's geometry so the
                  // right-side group (tag + pencil + chevron) sits on one
                  // clean baseline: same padding, radius and implied height.
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  padding: "3px 8px", borderRadius: 20, lineHeight: 1,
                  backgroundColor: Colors.green + "22", border: `1px solid ${Colors.green}55`,
                  color: Colors.green, cursor: lockedNote ? "not-allowed" : "pointer",
                  opacity: lockedNote ? 0.45 : 1,
                }}
              >
                <Edit2 size={10} />
              </span>
            )}
            {expanded ? <ChevronUp size={13} color={Colors.textMuted} /> : <ChevronDown size={13} color={Colors.textMuted} />}
          </div>
        </div>

      </button>

      {/* Sparkline bars — outside the toggle button so hover doesn't trigger expand */}
      {member.hasWeeklyHours && !hideHours && (
        <div
          style={{ display: "flex", alignItems: "flex-end", gap: 2, padding: "0 12px 10px", height: 26, position: "relative" }}
          onMouseLeave={() => setHoveredBar(null)}
        >
          {sparkBars.map((h, i) => (
            <div
              key={i}
              onMouseEnter={(e) => {
                const r = (e.target as HTMLElement).getBoundingClientRect();
                setHoveredBar({ idx: i, x: r.left + r.width / 2, y: r.top });
              }}
              style={{
                flex: 1, borderRadius: 2,
                height: Math.round(h * 14) + 2,
                backgroundColor: color,
                opacity: hoveredBar?.idx === i ? 1 : 0.35 + h * 0.55,
                cursor: "default",
                transition: "opacity 0.1s",
              }}
            />
          ))}
        </div>
      )}

      {expanded && (
        <div style={{ padding: "0 12px 14px", borderTop: `1px solid ${Colors.border}` }}>
          {/* Compact meta row: Role · Title · Department · BU as inline chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
            {[
              { icon: Briefcase, label: "Role",     value: member.role,     color: "#60a5fa" },
              { icon: Award,     label: "Title",    value: member.title,    color: "#a78bfa" },
              { icon: Building2, label: "Dept",     value: member.dept,     color: "#34d399" },
              { icon: GridIcon,  label: "Division", value: member.bu,                   color: "#fbbf24" },
              { icon: Building2, label: "BU",       value: member.memberBu, color: "#f97316" },
            ].filter(r => r.value && r.value !== "—" && r.value.trim())
             .filter(r => r.label !== "Division" || getBusinessRules().showDivision)
             .map((row, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "4px 10px", borderRadius: 20,
                background: row.color + "14", border: `1px solid ${row.color}40`,
              }}>
                <row.icon size={10} color={row.color} />
                <span style={{ fontSize: 9, color: row.color, fontWeight: 700, letterSpacing: "0.04em", opacity: 0.8 }}>{row.label}</span>
                <span style={{ fontSize: 11, color: Colors.textPrimary, fontWeight: 500 }}>{row.value}</span>
              </div>
            ))}
            {/* Weekly hours status chip — hours-derived, hidden in
                "Without schedule and hours" mode. */}
            {!hideHours && (
              <div style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "3px 8px", borderRadius: 20,
                background: member.hasWeeklyHours ? Colors.green + "20" : Colors.orange + "20",
                border: `1px solid ${member.hasWeeklyHours ? Colors.green + "50" : Colors.orange + "50"}`,
              }}>
                <span style={{ fontSize: 11, color: member.hasWeeklyHours ? Colors.green : Colors.orange, fontWeight: 600 }}>
                  {member.hasWeeklyHours ? "Hours allocated" : "No weekly hours"}
                </span>
              </div>
            )}
          </div>

          {/* EAC / ETC summary — single compact 2-col row */}
          {!hideHours && (member.eacHrs > 0 || member.etcHrs > 0) && (
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {member.eacHrs > 0 && (
                <div style={{
                  padding: "8px 10px", borderRadius: 8,
                  background: ACCENT_BLUE + "12", border: `1px solid ${ACCENT_BLUE}30`,
                }}>
                  <div style={{ fontSize: 9, color: Colors.textMuted, fontWeight: 600, letterSpacing: 0.4 }}>TOTAL HOURS</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
                    <span style={{ fontSize: 14, color: ACCENT_BLUE, fontWeight: 700 }}>{member.eacHrs.toFixed(0)}h</span>
                    {member.eacCost > 0 && (
                      <span style={{ fontSize: 10, color: Colors.orange, fontWeight: 600 }}>{fmtCost(member.eacCost)}</span>
                    )}
                  </div>
                  <div style={{ marginTop: 2, display: "flex", flexDirection: "column", gap: 1 }}>
                    {member.costRate > 0 ? (
                      <div style={{ fontSize: 11, color: Colors.textSecondary, fontWeight: 600 }}>@ ${fmtNumber(member.costRate)}/hr cost</div>
                    ) : canSetRates ? (
                      <a
                        href={`/import`}
                        style={{ fontSize: 11, color: Colors.green, textDecoration: "none", fontWeight: 600 }}
                      >Set cost rate →</a>
                    ) : null}
                    {member.laborRate > 0 && (
                      <div style={{ fontSize: 11, color: Colors.textSecondary, fontWeight: 600 }}>@ ${fmtNumber(member.laborRate)}/hr labor</div>
                    )}
                  </div>
                </div>
              )}
              {member.etcHrs > 0 && (
                <div style={{
                  padding: "8px 10px", borderRadius: 8,
                  background: Colors.green + "12", border: `1px solid ${Colors.green}30`,
                }}>
                  <div style={{ fontSize: 9, color: Colors.textMuted, fontWeight: 600, letterSpacing: 0.4 }}>REMAINING</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
                    <span style={{ fontSize: 14, color: Colors.green, fontWeight: 700 }}>{member.etcHrs.toFixed(0)}h</span>
                    {member.etcCost > 0 && (
                      <span style={{ fontSize: 10, color: Colors.green, fontWeight: 600 }}>{fmtCost(member.etcCost)}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* NC hours/cost — only when present, compact inline */}
          {!hideHours && (member.ncHrs > 0 || member.ncCost > 0) && (
            <div style={{
              marginTop: 6, padding: "6px 10px", borderRadius: 8, display: "flex", gap: 12, flexWrap: "wrap",
              background: Colors.orange + "10", border: `1px solid ${Colors.orange}30`,
            }}>
              <span style={{ fontSize: 9, color: Colors.orange, fontWeight: 700, letterSpacing: 0.4, alignSelf: "center" }}>NOT CONFIRMED</span>
              {member.ncHrs > 0 && <span style={{ fontSize: 12, color: Colors.orange, fontWeight: 700 }}>{member.ncHrs.toFixed(0)}h</span>}
              {member.ncCost > 0 && <span style={{ fontSize: 12, color: Colors.orange, fontWeight: 700 }}>{fmtCost(member.ncCost)}</span>}
            </div>
          )}

          {!hideHours && !hideSchedule && (
            <PhaseBreakdown
              projectId={projectId}
              module={module}
              person={{ name: member.name, resourceId: member.resourceId, pct: member.pct, memberStart: member.startDate, memberEnd: member.endDate }}
              canEdit={canEdit}
              onSaved={onReload}
              onSetupSchedule={onSetupSchedule}
              refreshToken={refreshToken}
            />
          )}
        </div>
      )}

      {/* Sparkline hover tooltip */}
      {hoveredBar !== null && member.hasWeeklyHours && createPortal(
        <div style={{
          position: "fixed",
          left: Math.min(hoveredBar.x, window.innerWidth - 160),
          top: hoveredBar.y - 8,
          transform: "translate(-50%, -100%)",
          zIndex: Z.POPUP,
          background: "rgba(14,22,36,0.97)",
          border: `1px solid ${color}55`,
          borderRadius: 8,
          padding: "8px 12px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          pointerEvents: "none",
          minWidth: 140,
        }}>
          <div style={{ fontSize: 10, color, fontWeight: 700, marginBottom: 4, letterSpacing: 0.4 }}>
            {sparkSegments[hoveredBar.idx].label}
          </div>
          {sparkSegments[hoveredBar.idx].hrs !== null && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11 }}>
              <span style={{ color: "rgba(255,255,255,0.55)" }}>Period hrs</span>
              <span style={{ color: "#fff", fontWeight: 700 }}>{sparkSegments[hoveredBar.idx].hrs}h</span>
            </div>
          )}
          {member.eacHrs > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11, marginTop: 2 }}>
              <span style={{ color: "rgba(255,255,255,0.55)" }}>Cumulative</span>
              <span style={{ color: color, fontWeight: 700 }}>{sparkSegments[hoveredBar.idx].cum}h</span>
            </div>
          )}
          {member.eacHrs > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11, marginTop: 2 }}>
              <span style={{ color: "rgba(255,255,255,0.55)" }}>Total</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{Math.round(member.eacHrs)}h</span>
            </div>
          )}
          {member.pct > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11, marginTop: 2 }}>
              <span style={{ color: "rgba(255,255,255,0.55)" }}>Allocation</span>
              <span style={{ color: member.pct > 100 ? "#F9AB33" : "rgba(255,255,255,0.7)", fontWeight: 600 }}>{+member.pct.toFixed(0)}%</span>
            </div>
          )}
          {/* small arrow */}
          <div style={{
            position: "absolute", bottom: -5, left: "50%",
            width: 8, height: 8, background: "rgba(14,22,36,0.97)",
            borderRight: `1px solid ${color}55`, borderBottom: `1px solid ${color}55`,
            transform: "translateX(-50%) rotate(45deg)",
          }} />
        </div>,
        document.body
      )}
    </div>
  );
}

export function TeamMemberList({ allocations, onEdit, searchQuery, canEdit = true, lockedNote = null, projectId, module, scheduleStart = "", scheduleEnd = "", onReload, onSetupSchedule, hideHours = false, hideSchedule = false, refreshToken }: {
  allocations: Allocation[]; onEdit: (a: Allocation) => void; searchQuery: string; canEdit?: boolean; lockedNote?: string | null; projectId: string; module?: string | null; scheduleStart?: string; scheduleEnd?: string; onReload?: (fetchTeam?: boolean) => void; onSetupSchedule?: () => void; hideHours?: boolean; hideSchedule?: boolean; refreshToken?: number;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (allocations.length === 0) return null;
  const q = searchQuery.toLowerCase().trim();
  const filtered = q
    ? allocations.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        (a.role  || "").toLowerCase().includes(q) ||
        (a.title || "").toLowerCase().includes(q) ||
        (a.dept  || "").toLowerCase().includes(q) ||
        (a.bu    || "").toLowerCase().includes(q) ||
        (a.memberBu || "").toLowerCase().includes(q)
      )
    : allocations;
  return (
    <div>
      {filtered.length === 0 && q && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
          padding: "24px 12px", color: Colors.textMuted, fontSize: 13,
        }}>
          <Search size={20} color={Colors.textMuted} style={{ opacity: 0.4 }} />
          <span>No members match <strong style={{ color: Colors.textSecondary }}>"{searchQuery}"</strong></span>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {filtered.map((a, i) => {
          const stableId = a.resourceId || (a.name + i);
          const c = a.pct > 100 ? "#F08C22" : ALLOC_COLORS[i % ALLOC_COLORS.length];
          return (
            <TeamMemberCard
              key={stableId} member={a} color={c}
              expanded={expandedId === stableId}
              onToggle={() => setExpandedId(expandedId === stableId ? null : stableId)}
              onSetupSchedule={onSetupSchedule}
              onEdit={() => onEdit(a)}
              canEdit={canEdit}
              lockedNote={lockedNote}
              projectId={projectId}
              module={module}
              scheduleStart={scheduleStart}
              scheduleEnd={scheduleEnd}
              onReload={onReload}
              hideHours={hideHours}
              hideSchedule={hideSchedule}
              refreshToken={refreshToken}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ──────────────── WizardTeamListView (compact list for conversion wizard) ───── */
export function WizardTeamListView({
  allocations,
  onEdit,
}: {
  allocations: Allocation[];
  onEdit: (a: Allocation) => void;
}) {
  const fmtDate = (d: string) =>
    d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }) : "—";
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {(["Member", "Role", "Alloc", "Hours", "Dates", ""] as const).map((h, i) => (
              <th key={i} style={{ padding: "8px 12px", textAlign: i === 2 || i === 3 ? "right" : "left", fontWeight: 600, color: "var(--muted-foreground)", background: "var(--muted)", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allocations.map((a, i) => {
            const c = a.pct > 100 ? "#F08C22" : ALLOC_COLORS[i % ALLOC_COLORS.length];
            const initials = a.name.split(" ").filter(Boolean).map(p => p[0]).slice(0, 2).join("").toUpperCase();
            return (
              <tr key={a.resourceId || (a.name + i)} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: c + "33", border: `2px solid ${c}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: c, flexShrink: 0 }}>
                      {initials}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--foreground)", lineHeight: 1.3 }}>{a.name}</div>
                      {a.title && <div style={{ fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.3 }}>{a.title}</div>}
                    </div>
                  </div>
                </td>
                <td style={{ padding: "10px 12px", color: "var(--foreground)" }}>{a.role || "—"}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: a.pct > 100 ? "#F08C22" : "var(--foreground)" }}>{fmtPct(a.pct)}</td>
                <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--foreground)" }}>{a.eacHrs > 0 ? `${fmtHours(a.eacHrs)}h` : "—"}</td>
                <td style={{ padding: "10px 12px", color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{fmtDate(a.startDate)} – {fmtDate(a.endDate)}</td>
                <td style={{ padding: "10px 6px", textAlign: "center" }}>
                  <button type="button" title="Edit allocation" onClick={() => onEdit(a)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", padding: 4, borderRadius: 4, display: "inline-flex", alignItems: "center" }}>
                    <Pencil size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ──────────────── GanttTimeline (Target/Actual bands + delay) ──────────────── */
function GanttTimeline({ project }: { project: ProjectData }) {
  // Compulsory date-display rule (client mandate, Jul 2026): when a phase
  // schedule exists — and the tenant's display mode includes schedules — the
  // schedule range IS the actual timeline, so only the Actual band renders
  // (derived from the schedule's first/last phase, same as the Project
  // Schedule card below). Without a schedule (or for leads) only the Target
  // band renders; the raw record Actual fields are never shown on their own.
  useProjectViewModeVersion(); // re-render when the per-project layout changes
  const displayMode = getDisplayModeForRecord(project.id, project.module);
  const useActual = (displayMode === "full" || displayMode === "schedule-no-grid") && project.module !== "LEM"
    && !!(project.scheduleStart || project.scheduleEnd);
  const effActualStart = project.scheduleStart;
  const effActualEnd = project.scheduleEnd;
  const phases = [
    !useActual ? { label: "Target", start: project.targetStart, end: project.targetEnd, color: "#6BA539", bg: "rgba(107,165,57,0.15)" } : null,
    useActual ? { label: "Schedule", start: effActualStart, end: effActualEnd, color: "#E87722", bg: "rgba(232,119,34,0.15)" } : null,
  ].filter((p): p is { label: string; start: string; end: string; color: string; bg: string } => !!p && (!!p.start || !!p.end));

  if (phases.length === 0) {
    // Project-level target/actual fields are empty. Don't render an "empty"
    // banner here — the SchedulePhases section directly below derives Actual
    // Start / Actual End from the lifecycle task list and shows them in
    // their own cards, so a "no timeline data" message above filled-in
    // dates would contradict what the user sees.
    return null;
  }

  // Delay = displayed (schedule-derived) end running past the Target end.
  // Only meaningful when the Actual band is showing.
  const hasDelay = useActual && project.targetEnd && effActualEnd
    && new Date(effActualEnd).getTime() > new Date(project.targetEnd).getTime();
  const delayMonths = hasDelay ? durationMonths(project.targetEnd, effActualEnd) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {phases.map((p, i) => (
        <div key={i} style={{
          backgroundColor: p.bg, borderRadius: 22, border: `1.5px solid ${p.color}50`,
          padding: "10px 16px", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.color, marginRight: 10, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: p.color, marginRight: 6 }}>{p.label}:</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: Colors.white }}>
            {fmtDate(p.start)} – {fmtDate(p.end)}
          </span>
          {/* Delay badge merged into the last phase row — saves a full pill of vertical space */}
          {hasDelay && delayMonths > 0 && i === phases.length - 1 && (
            <span style={{
              marginLeft: 10, display: "inline-flex", alignItems: "center", gap: 4,
              backgroundColor: "rgba(248,113,113,0.15)", borderRadius: 10,
              padding: "2px 8px", border: "1px solid rgba(248,113,113,0.3)", flexShrink: 0,
            }}>
              <AlertTriangle size={11} color="#F87171" />
              <span style={{ fontSize: 11, fontWeight: 700, color: "#F87171" }}>+{durationLabel(delayMonths)} over target</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ──────────────── LifecyclePickerModal helpers ──────────────────────────── */
const LC_NAVY   = "#24384A";
const LC_GREEN  = "#6BA539";
const LC_LIME   = "#AAC23E";
const LC_ORANGE = "#F2921F";
const LC_INK    = "#16222E";
const LC_MUTE   = "#6B7A83";
const LC_LINE   = "#E1E6E5";
const LC_PAPER  = "#F7F9F8";

type PhaseFam = "design" | "procure" | "build" | "close" | "custom";
const FAM_COLORS: Record<PhaseFam, string> = {
  design:  LC_NAVY,
  procure: LC_ORANGE,
  build:   LC_LIME,
  close:   LC_GREEN,
  custom:  "#8C99A2",
};
const FAM_LABELS: Record<PhaseFam, string> = {
  design:  "Design",
  procure: "Bid",
  build:   "Build",
  close:   "Closeout",
  custom:  "Custom",
};

function phaseFamily(name: string): PhaseFam {
  const n = name.toLowerCase();
  if (/design|schematic|pre.schemati|document|^dd\b|^cd\b/.test(n)) return "design";
  if (/bid|procure|lump.sum|encumbran|award|rfp|rfq/.test(n)) return "procure";
  if (/construct|build|admin|\bca\b|\bcm\b/.test(n)) return "build";
  if (/close|complete|finish|turnover/.test(n)) return "close";
  return "custom";
}

function phaseCode(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.map((w) => w[0]).join("").toUpperCase().slice(0, 4);
  return name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4) || "?";
}

/* ──────────────── LifecyclePickerModal ──────────────────────────────────────
 * Full redesign matching the lifecycle-library HTML mock:
 * navy title block + stats, search + family filter chips, phase rail per row,
 * selected row expands phase pills, footer Apply/Cancel buttons.
 * ──────────────────────────────────────────────────────────────────────────── */
function LifecyclePickerModal({ lifecycles, selectedId, onSelect, hideLabel, onLightBg, module: modProp, tenantLabel, forceOpen, onClose, onApply }: {
  lifecycles: LifecycleInfo[];
  selectedId: string;
  onSelect: (id: string) => void;
  hideLabel?: boolean;
  /** Pass true when the component sits on a light/white background so the
   *  phase-preview strip uses dark ink instead of white text. */
  onLightBg?: boolean;
  module?: string;
  tenantLabel?: string;
  /** When set, the modal is always open and the trigger button is hidden. */
  forceOpen?: boolean;
  /** Called when the modal requests close (Cancel or ✕) in forceOpen mode. */
  onClose?: () => void;
  /** Called with the chosen id instead of onSelect when in forceOpen mode,
   *  so the parent can run the full apply action immediately. */
  onApply?: (id: string) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  // When forceOpen is provided the parent controls visibility.
  const open = forceOpen !== undefined ? forceOpen : internalOpen;
  const closeModal = () => { if (forceOpen !== undefined) { onClose?.(); } else { setInternalOpen(false); } };

  const [query, setQuery] = useState("");
  const [activeFams, setActiveFams] = useState<Set<PhaseFam>>(new Set());
  const [internalId, setInternalId] = useState(selectedId);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = lifecycles.find((l) => String(l.ID) === selectedId);
  const triggerLabel = selected
    ? `${selected.Name} (${selected.Stages?.length ?? 0} phases)`
    : "Select a lifecycle template\u2026";

  useEffect(() => {
    if (open) {
      setQuery(""); setActiveFams(new Set()); setInternalId(selectedId);
      setTimeout(() => searchRef.current?.focus(), 40);
    }
  }, [open, selectedId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lifecycles.filter((lc) => {
      const stages = [...(lc.Stages ?? [])].sort((a, b) => (a.StageStep ?? 0) - (b.StageStep ?? 0));
      const hitQ = !q || lc.Name.toLowerCase().includes(q) || stages.map((s) => s.Name).join(" ").toLowerCase().includes(q);
      const hitF = activeFams.size === 0 || [...activeFams].every((f) => stages.some((s) => phaseFamily(s.Name) === f));
      return hitQ && hitF;
    });
  }, [lifecycles, query, activeFams]);

  const allPhaseCounts = lifecycles.map((l) => l.Stages?.length ?? 0).filter((n) => n > 0);
  const phaseMin = allPhaseCounts.length ? Math.min(...allPhaseCounts) : 0;
  const phaseMax = allPhaseCounts.length ? Math.max(...allPhaseCounts) : 0;
  const appliesTo = modProp === "OPM" ? "Opportunities" : "Projects";

  const toggleFam = (f: PhaseFam) => setActiveFams((prev) => {
    const next = new Set(prev); next.has(f) ? next.delete(f) : next.add(f); return next;
  });

  const applyAndClose = () => {
    if (!internalId) return;
    if (onApply) { onApply(internalId); closeModal(); }
    else { onSelect(internalId); closeModal(); }
  };

  const chosenLc = lifecycles.find((l) => String(l.ID) === internalId);
  const chosenStages = chosenLc ? [...(chosenLc.Stages ?? [])].sort((a, b) => (a.StageStep ?? 0) - (b.StageStep ?? 0)) : [];

  const modal = open ? createPortal(
    <div
      role="dialog" aria-modal="true" aria-label="Pick a lifecycle template"
      onKeyDown={(e) => { if (e.key === "Escape") closeModal(); }}
      onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
      style={{
        position: "fixed", inset: 0, zIndex: Z.DRAWER,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div style={{
        background: "#fff", borderRadius: 12,
        boxShadow: "0 40px 80px -20px rgba(11,20,28,.55), 0 0 0 1px rgba(11,20,28,.18)",
        width: "100%", maxWidth: 860, maxHeight: "min(860px, 92vh)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>

        {/* ── Navy title block ── */}
        <header style={{
          background: LC_NAVY, color: "#fff", flexShrink: 0,
          backgroundImage: "repeating-linear-gradient(0deg,rgba(255,255,255,.055) 0 27px,transparent 27px 28px),repeating-linear-gradient(90deg,rgba(255,255,255,.055) 0 27px,transparent 27px 28px)",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 18, padding: "20px 22px 0" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 10.5, letterSpacing: "0.18em", textTransform: "uppercase", color: LC_LIME, margin: "0 0 6px" }}>
                Lifecycle library
              </p>
              <h2 style={{ fontWeight: 700, fontSize: 24, letterSpacing: "-0.01em", margin: 0, lineHeight: 1.15, color: "#fff" }}>
                Pick a lifecycle template
              </h2>
              <p style={{ margin: "7px 0 0", fontSize: 13.5, color: "#B8C6CE", maxWidth: "52ch", lineHeight: 1.5 }}>
                Each template sets the phase sequence a project moves through. You can rename or reorder phases after applying it.
              </p>
            </div>
            <button onClick={closeModal} aria-label="Close" style={{
              flexShrink: 0, width: 34, height: 34, borderRadius: 7,
              background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.16)",
              color: "#fff", fontSize: 17, lineHeight: 1, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>&#215;</button>
          </div>
          {/* Stats cells */}
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", margin: "18px 0 0", borderTop: "1px solid rgba(255,255,255,.16)" }}>
            {([
              ["Templates", String(filtered.length)],
              ["Phase range", phaseMin === phaseMax ? String(phaseMin) : `${phaseMin} \u2013 ${phaseMax}`],
              ["Applies to", appliesTo],
              ["Scope", tenantLabel ?? "\u2014"],
            ] as [string, string][]).map(([label, val], ci) => (
              <div key={label} style={{ padding: ci === 0 ? "9px 22px 10px" : "9px 14px 10px", borderRight: ci < 3 ? "1px solid rgba(255,255,255,.16)" : "none" }}>
                <dt style={{ fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 9.5, letterSpacing: "0.15em", textTransform: "uppercase", color: "#8FA3AE", margin: 0 }}>{label}</dt>
                <dd style={{ margin: "3px 0 0", fontWeight: 700, fontSize: 15, letterSpacing: "0.01em", color: "#fff" }}>{val}</dd>
              </div>
            ))}
          </dl>
        </header>

        {/* ── Controls ── */}
        <div style={{ padding: "16px 22px 13px", borderBottom: `1px solid ${LC_LINE}`, background: LC_PAPER, flexShrink: 0 }}>
          <div style={{ position: "relative" }}>
            <Search size={14} color={LC_MUTE} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
            <input
              ref={searchRef} type="search" value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={'Search a template or a phase name \u2014 try \u201cbid\u201d'}
              style={{
                width: "100%", boxSizing: "border-box", padding: "11px 14px 11px 38px",
                fontSize: 14, color: LC_INK, background: "#fff",
                border: "1px solid #C9D2D1", borderRadius: 8, outline: "none",
              }}
            />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7, marginTop: 11 }}>
            <span style={{ fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: LC_MUTE, marginRight: 3 }}>Covers</span>
            {(["design", "procure", "build", "close", "custom"] as PhaseFam[]).map((f) => {
              const on = activeFams.has(f);
              return (
                <button key={f} type="button" onClick={() => toggleFam(f)} style={{
                  fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 11,
                  letterSpacing: "0.06em", textTransform: "uppercase",
                  padding: "5px 10px 5px 8px", borderRadius: 999,
                  border: on ? "1px solid transparent" : "1px solid #C9D2D1",
                  background: on ? FAM_COLORS[f] : "#fff",
                  color: on ? "#fff" : LC_MUTE, cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 6,
                  transition: "background .14s, color .14s, border-color .14s",
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: on ? "#fff" : FAM_COLORS[f], display: "block", flexShrink: 0 }} />
                  {FAM_LABELS[f]}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── List ── */}
        <div role="listbox" aria-label="Lifecycle templates" style={{ overflowY: "auto", flex: 1, background: "#fff", padding: "6px 0 4px" }}>
          {filtered.length === 0 && (
            <div style={{ padding: "46px 22px", textAlign: "center", color: LC_MUTE, fontSize: 13.5 }}>
              <strong style={{ display: "block", fontSize: 15, color: LC_INK, marginBottom: 6 }}>No template matches that</strong>
              Clear the filters, or search a phase name like &ldquo;closeout&rdquo;.
            </div>
          )}
          {filtered.map((lc) => {
            const isActive = String(lc.ID) === internalId;
            const stages = [...(lc.Stages ?? [])].sort((a, b) => (a.StageStep ?? 0) - (b.StageStep ?? 0));
            const customCount = stages.filter((s) => phaseFamily(s.Name) === "custom").length;
            const displayName = lc.Name.startsWith("Imported:") && stages.length ? stages.map((s) => s.Name).join(", ") : lc.Name;
            const hilite = (text: string) => {
              const q = query.trim();
              if (!q) return <>{text}</>;
              const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
              const parts = text.split(re);
              return <>{parts.map((p, pi) => re.test(p) ? <em key={pi} style={{ fontStyle: "normal", background: "#E8F0D8", boxShadow: "0 0 0 2px #E8F0D8" }}>{p}</em> : p)}</>;
            };
            return (
              <button
                key={lc.ID} role="option" aria-selected={isActive}
                onClick={() => setInternalId(String(lc.ID))}
                style={{
                  display: "grid", gridTemplateColumns: "64px 1fr", gap: 16, alignItems: "start",
                  width: "100%", textAlign: "left", background: isActive ? "#F4F8EF" : "transparent",
                  border: "none", borderBottom: `1px solid ${LC_LINE}`,
                  borderLeft: `3px solid ${isActive ? LC_GREEN : "transparent"}`,
                  padding: "15px 22px", cursor: "pointer", color: "inherit", position: "relative",
                  transition: "background .14s",
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "#F2F5F3"; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >
                <span style={{ textAlign: "right", paddingTop: 1 }}>
                  <b style={{ display: "block", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontWeight: 500, fontSize: 26, lineHeight: 1, color: isActive ? LC_GREEN : LC_NAVY, fontVariantNumeric: "tabular-nums" }}>
                    {String(stages.length).padStart(2, "0")}
                  </b>
                  <span style={{ display: "block", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: LC_MUTE, marginTop: 4 }}>Phases</span>
                </span>
                <span>
                  <span style={{ display: "block", fontWeight: 500, fontSize: 14.5, lineHeight: 1.4, letterSpacing: "-0.005em", margin: "0 0 12px", color: LC_INK }}>
                    {hilite(displayName)}
                  </span>
                  {/* Phase rail */}
                  <span style={{ display: "flex", alignItems: "flex-start", overflowX: "auto", paddingBottom: 2 }}>
                    {stages.map((s, si) => {
                      const fam = phaseFamily(s.Name);
                      const col = FAM_COLORS[fam];
                      const prevCol = si > 0 ? FAM_COLORS[phaseFamily(stages[si - 1].Name)] : col;
                      return (
                        <Fragment key={s.ID}>
                          {si > 0 && (
                            <span style={{ flex: 1, minWidth: 14, height: 2, marginTop: 4.5, background: `linear-gradient(90deg,${prevCol},${col})`, display: "block" }} />
                          )}
                          <span style={{ flexShrink: 0, minWidth: 46, textAlign: "center" }} title={s.Name}>
                            <span style={{
                              width: 11, height: 11, borderRadius: "50%", margin: "0 auto", display: "block",
                              background: fam === "custom" ? "#fff" : col,
                              border: fam === "custom" ? "1.5px dashed #8C99A2" : "none",
                              boxShadow: fam === "custom" ? "0 0 0 3px #fff" : `0 0 0 3px #fff,0 0 0 4px ${col}4D`,
                            }} />
                            <span style={{ display: "block", marginTop: 7, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 10, letterSpacing: "0.07em", color: LC_MUTE, whiteSpace: "nowrap", fontStyle: fam === "custom" ? "italic" : "normal" }}>
                              {phaseCode(s.Name)}
                            </span>
                          </span>
                        </Fragment>
                      );
                    })}
                  </span>
                  {/* Expand pills on selection */}
                  {isActive && (
                    <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 13 }}>
                      {stages.map((s, si) => (
                        <span key={s.ID} style={{ fontSize: 11.5, padding: "4px 9px", borderRadius: 5, background: "#fff", border: "1px solid #C9D2D1", color: "#33454F" }}>
                          <b style={{ fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontWeight: 500, color: LC_MUTE, marginRight: 6, fontSize: 10 }}>{String(si + 1).padStart(2, "0")}</b>
                          {s.Name}
                        </span>
                      ))}
                      {customCount > 0 && (
                        <span style={{ fontSize: 11.5, padding: "4px 9px", borderRadius: 5, background: "#fff", border: "1px dashed #C9D2D1", color: LC_MUTE }}>
                          {customCount} phase{customCount > 1 ? "s" : ""} not in the standard set
                        </span>
                      )}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Footer ── */}
        <footer style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 22px", borderTop: `1px solid ${LC_LINE}`, background: LC_PAPER, flexShrink: 0 }}>
          <div style={{ fontSize: 13, color: LC_MUTE, lineHeight: 1.4, minWidth: 0, flex: 1 }}>
            <b style={{ display: "block", color: LC_INK, fontWeight: 700, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {chosenLc ? chosenLc.Name : "No template selected"}
            </b>
            <span>
              {chosenLc && chosenStages.length > 0
                ? `${chosenStages.length} phase${chosenStages.length === 1 ? "" : "s"} \u00b7 starts at ${chosenStages[0].Name} \u00b7 ends at ${chosenStages[chosenStages.length - 1].Name}`
                : "Choose a template to see its phase sequence."}
            </span>
          </div>
          <span style={{ fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "#93A2AA", flexShrink: 0 }}>
            \u2191 \u2193 to move \u00b7 \u21b5 to apply
          </span>
          <div style={{ display: "flex", gap: 9, flexShrink: 0 }}>
            <button type="button" onClick={closeModal} style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1, padding: "11px 17px", borderRadius: 7, cursor: "pointer", border: "1px solid #C9D2D1", background: "#fff", color: "#33454F" }}>
              Cancel
            </button>
            <button type="button" onClick={applyAndClose} disabled={!internalId} style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1, padding: "11px 17px", borderRadius: 7, cursor: internalId ? "pointer" : "not-allowed", border: `1px solid ${LC_GREEN}`, background: LC_GREEN, color: "#fff", opacity: internalId ? 1 : 0.45 }}>
              Apply template
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div style={{ marginBottom: hideLabel ? 0 : 10 }}>
      {!hideLabel && (
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: Colors.textMuted, marginBottom: 6 }}>
          Lifecycle template
        </div>
      )}
      {forceOpen === undefined && <button
        onClick={() => setInternalOpen(true)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          borderRadius: 10, border: `1.5px solid ${selectedId ? Colors.green : "var(--rm-panel-border)"}`,
          backgroundColor: "var(--rm-panel-soft)", padding: "12px 12px 12px 14px",
          color: selectedId ? Colors.textPrimary : Colors.textMuted,
          fontSize: 13, fontWeight: 600, cursor: "pointer",
          boxShadow: selectedId ? "0 0 0 2px rgba(107,165,57,0.12)" : "0 1px 2px rgba(0,0,0,0.05)",
          transition: "border-color .15s, box-shadow .15s",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Layers size={15} color={selectedId ? Colors.green : Colors.textMuted} style={{ flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{triggerLabel}</span>
        </span>
        <ChevronDown size={15} color={selectedId ? Colors.green : Colors.textMuted} style={{ flexShrink: 0 }} />
      </button>}
      {selected && (selected.Stages?.length ?? 0) > 0 && forceOpen === undefined && (
        <div style={{ marginTop: 8, borderRadius: 10, border: "1px solid rgba(107,165,57,0.25)", backgroundColor: "rgba(107,165,57,0.06)", padding: "10px 12px", display: "flex", flexWrap: "wrap", gap: "6px 10px", alignItems: "center" }}>
          {[...selected.Stages].sort((a, b) => (a.StageStep ?? 0) - (b.StageStep ?? 0)).map((stage, idx) => (
            <span key={stage.ID} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 17, height: 17, borderRadius: 9, backgroundColor: "rgba(107,165,57,0.22)", border: "1px solid rgba(107,165,57,0.45)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: Colors.green, flexShrink: 0 }}>{idx + 1}</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: onLightBg ? "#33454F" : Colors.white }}>{stage.Name}</span>
            </span>
          ))}
        </div>
      )}
      {modal}
    </div>
  );
}

/* ──────────────── ManageLifecyclesModal ──────────────── */
function ManageLifecyclesModal({ lifecycles, canEdit, module, onClose, onSaved }: {
  lifecycles: LifecycleInfo[]; canEdit: boolean; module: "PMM" | "OPM"; onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  const [view, setView] = useState<"list" | "form">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [phases, setPhases] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [lcSearch, setLcSearch] = useState("");

  const openNew = () => { setEditingId(null); setName(""); setPhases([""]); setError(""); setView("form"); };
  const openEdit = (lc: LifecycleInfo) => {
    setEditingId(lc.ID); setName(lc.Name);
    const sorted = [...(lc.Stages ?? [])].sort((a, b) => (a.StageStep ?? 0) - (b.StageStep ?? 0)).map((s) => s.Name);
    setPhases(sorted.length > 0 ? sorted : [""]);
    setError(""); setView("form");
  };

  const setPhaseAt = (i: number, val: string) => setPhases((p) => p.map((x, idx) => (idx === i ? val : x)));
  const addPhase = () => setPhases((p) => [...p, ""]);
  const removePhase = (i: number) => setPhases((p) => (p.length <= 1 ? [""] : p.filter((_, idx) => idx !== i)));
  const movePhase = (i: number, dir: -1 | 1) => setPhases((p) => {
    const j = i + dir;
    if (j < 0 || j >= p.length) return p;
    const next = [...p]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });

  const handleSave = async () => {
    const cleanName = name.trim();
    const cleanPhases = phases.map((p) => p.trim()).filter(Boolean);
    if (!cleanName) { setError("Please enter a lifecycle name."); return; }
    if (cleanPhases.length === 0) { setError("Add at least one phase."); return; }
    setSaving(true); setError("");
    try {
      // New templates belong to the module of the page that opened the modal —
      // they'd otherwise default to PMM and vanish from the opportunity picker.
      if (editingId == null) await createLifecycle({ Name: cleanName, Stages: cleanPhases, Module: module });
      else await updateLifecycle(editingId, { Name: cleanName, Stages: cleanPhases });
      await onSaved();
      setView("list");
    } catch (e) {
      setError((e as Error)?.message || "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // The modal card is hard white (see the wrapper below), so the editor uses
  // hard dark-on-white colors like the list view — theme tokens (Colors.*)
  // resolve to light text in dark mode and vanish on this card.
  const inputStyle: React.CSSProperties = {
    flex: 1, padding: "9px 10px", borderRadius: 8, border: "1px solid rgba(15,25,35,0.25)",
    backgroundColor: "#fff", color: "#0F1923", fontSize: 13, outline: "none",
  };
  const iconBtn: React.CSSProperties = {
    width: 30, height: 30, borderRadius: 7, border: "1px solid rgba(15,25,35,0.2)",
    backgroundColor: "#F5F6F8", color: "#33404C", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  };

  // Deduplicate by phase signature — same logic as the list body so the stats
  // bar reflects the number of distinct lifecycles actually shown, not the raw
  // count (which can include duplicates with identical phase sets).
  const dedupedLifecycles = useMemo(() => lifecycles.filter((lc, idx, arr) => {
    const sig = (lc.Stages ?? []).slice().sort((a, b) => (a.StageStep ?? 0) - (b.StageStep ?? 0)).map(s => s.Name.trim().toLowerCase()).join("\u0001");
    return arr.findIndex(x => {
      const xs = (x.Stages ?? []).slice().sort((a, b) => (a.StageStep ?? 0) - (b.StageStep ?? 0)).map(s => s.Name.trim().toLowerCase()).join("\u0001");
      return xs === sig;
    }) === idx;
  }), [lifecycles]);

  // Computed for stats bar
  const allStageCounts = dedupedLifecycles.map(lc => lc.Stages?.length ?? 0).filter(n => n > 0);
  const mlPhaseMin = allStageCounts.length ? Math.min(...allStageCounts) : 0;
  const mlPhaseMax = allStageCounts.length ? Math.max(...allStageCounts) : 0;
  const appliesTo = module === "OPM" ? "Opportunities" : "Projects";

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)", zIndex: Z.DRAWER,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 12,
        boxShadow: "0 40px 80px -20px rgba(11,20,28,.55), 0 0 0 1px rgba(11,20,28,.18)",
        width: "100%", maxWidth: 860, maxHeight: "min(860px,92vh)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>

        {view === "list" ? (
          <>
            {/* ── Navy header ── */}
            <header style={{ background: LC_NAVY, color: "#fff", flexShrink: 0, backgroundImage: "repeating-linear-gradient(0deg,rgba(255,255,255,.055) 0 27px,transparent 27px 28px),repeating-linear-gradient(90deg,rgba(255,255,255,.055) 0 27px,transparent 27px 28px)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 18, padding: "20px 22px 0" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 10.5, letterSpacing: "0.18em", textTransform: "uppercase", color: LC_LIME, margin: "0 0 6px" }}>Lifecycle library</p>
                  <h2 style={{ fontWeight: 700, fontSize: 24, letterSpacing: "-0.01em", margin: 0, lineHeight: 1.15, color: "#fff" }}>Manage Lifecycles</h2>
                  <p style={{ margin: "7px 0 0", fontSize: 13.5, color: "#B8C6CE", maxWidth: "52ch", lineHeight: 1.5 }}>
                    Edit, rename or create lifecycle templates. Changes take effect on any record that uses them.
                  </p>
                </div>
                <button onClick={onClose} aria-label="Close" style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 7, background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.16)", color: "#fff", fontSize: 17, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>&#215;</button>
              </div>
              <dl style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", margin: "18px 0 0", borderTop: "1px solid rgba(255,255,255,.16)" }}>
                {([
                  ["Lifecycles", String(lifecycles.length)],
                  ["Phase range", mlPhaseMin === mlPhaseMax ? String(mlPhaseMin || "—") : `${mlPhaseMin} – ${mlPhaseMax}`],
                  ["Applies to", appliesTo],
                  ["Access", canEdit ? "Full edit" : "Read only"],
                ] as [string, string][]).map(([label, val], ci) => (
                  <div key={label} style={{ padding: ci === 0 ? "9px 22px 10px" : "9px 14px 10px", borderRight: ci < 3 ? "1px solid rgba(255,255,255,.16)" : "none" }}>
                    <dt style={{ fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 9.5, letterSpacing: "0.15em", textTransform: "uppercase", color: "#8FA3AE", margin: 0 }}>{label}</dt>
                    <dd style={{ margin: "3px 0 0", fontWeight: 700, fontSize: 15, letterSpacing: "0.01em", color: "#fff" }}>{val}</dd>
                  </div>
                ))}
              </dl>
            </header>

            {/* ── Search ── */}
            <div style={{ padding: "16px 22px 13px", borderBottom: `1px solid ${LC_LINE}`, background: LC_PAPER, flexShrink: 0 }}>
              <div style={{ position: "relative" }}>
                <Search size={14} color={LC_MUTE} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                <input
                  value={lcSearch} onChange={(e) => setLcSearch(e.target.value)}
                  placeholder="Search a lifecycle or phase name…"
                  style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px 11px 38px", fontSize: 14, color: LC_INK, background: "#fff", border: `1px solid ${LC_LINE}`, borderRadius: 8, outline: "none" }}
                />
                {lcSearch && (
                  <button onClick={() => setLcSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: LC_MUTE, display: "flex", padding: 0 }}>
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* ── List ── */}
            <div style={{ overflowY: "auto", flex: 1, background: "#fff", padding: "6px 0 4px" }}>
              {(() => {
                const q = lcSearch.trim().toLowerCase();
                const deduped = lifecycles.filter((lc, idx, arr) => {
                  const sig = (lc.Stages ?? []).slice().sort((a, b) => (a.StageStep ?? 0) - (b.StageStep ?? 0)).map(s => s.Name.trim().toLowerCase()).join("\u0001");
                  return arr.findIndex(x => {
                    const xs = (x.Stages ?? []).slice().sort((a, b) => (a.StageStep ?? 0) - (b.StageStep ?? 0)).map(s => s.Name.trim().toLowerCase()).join("\u0001");
                    return xs === sig;
                  }) === idx;
                });
                const visible = q ? deduped.filter(lc => lc.Name.toLowerCase().includes(q) || (lc.Stages ?? []).some(s => s.Name.toLowerCase().includes(q))) : deduped;
                return (<>
                  {visible.length === 0 && (
                    <div style={{ padding: "46px 22px", textAlign: "center", color: LC_MUTE, fontSize: 13.5 }}>
                      <strong style={{ display: "block", fontSize: 15, color: LC_INK, marginBottom: 6 }}>
                        {deduped.length === 0 ? "No lifecycles yet" : `No match for "${lcSearch}"`}
                      </strong>
                      {deduped.length === 0 ? "Create your first lifecycle below." : "Try a different name or phase name."}
                    </div>
                  )}
                  {visible.map((lc) => {
                    const stages = [...(lc.Stages ?? [])].sort((a, b) => (a.StageStep ?? 0) - (b.StageStep ?? 0));
                    const displayName = lc.Name.startsWith("Imported:") && stages.length ? stages.map(s => s.Name).join(", ") : lc.Name;
                    return (
                      <div key={lc.ID} style={{ display: "grid", gridTemplateColumns: "64px 1fr auto", gap: 16, alignItems: "start", borderBottom: `1px solid ${LC_LINE}`, padding: "15px 22px" }}>
                        <span style={{ textAlign: "right", paddingTop: 1 }}>
                          <b style={{ display: "block", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontWeight: 500, fontSize: 26, lineHeight: 1, color: LC_NAVY, fontVariantNumeric: "tabular-nums" }}>{String(stages.length).padStart(2, "0")}</b>
                          <span style={{ display: "block", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: LC_MUTE, marginTop: 4 }}>Phases</span>
                        </span>
                        <span>
                          <span style={{ display: "block", fontWeight: 500, fontSize: 14.5, lineHeight: 1.4, letterSpacing: "-0.005em", margin: "0 0 12px", color: LC_INK }}>{displayName}</span>
                          {/* Phase rail */}
                          <span style={{ display: "flex", alignItems: "flex-start", overflowX: "auto", paddingBottom: 2 }}>
                            {stages.map((s, si) => {
                              const fam = phaseFamily(s.Name);
                              const col = FAM_COLORS[fam];
                              const prevCol = si > 0 ? FAM_COLORS[phaseFamily(stages[si - 1].Name)] : col;
                              return (
                                <Fragment key={s.ID}>
                                  {si > 0 && <span style={{ flex: 1, minWidth: 14, height: 2, marginTop: 4.5, background: `linear-gradient(90deg,${prevCol},${col})`, display: "block" }} />}
                                  <span style={{ flexShrink: 0, minWidth: 46, textAlign: "center" }} title={s.Name}>
                                    <span style={{ width: 11, height: 11, borderRadius: "50%", margin: "0 auto", display: "block", background: fam === "custom" ? "#fff" : col, border: fam === "custom" ? "1.5px dashed #8C99A2" : "none", boxShadow: fam === "custom" ? "0 0 0 3px #fff" : `0 0 0 3px #fff,0 0 0 4px ${col}4D` }} />
                                    <span style={{ display: "block", marginTop: 7, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: 10, letterSpacing: "0.07em", color: LC_MUTE, whiteSpace: "nowrap" }}>{phaseCode(s.Name)}</span>
                                  </span>
                                </Fragment>
                              );
                            })}
                          </span>
                        </span>
                        <button onClick={() => openEdit(lc)} disabled={!canEdit} style={{
                          display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 8,
                          border: `1px solid ${LC_GREEN}40`, backgroundColor: `${LC_GREEN}14`,
                          color: LC_GREEN, fontSize: 13, fontWeight: 700, cursor: canEdit ? "pointer" : "default",
                          opacity: canEdit ? 1 : 0.5, flexShrink: 0, marginTop: 4,
                          transition: "background .12s",
                        }}
                          onMouseEnter={e => { if (canEdit) (e.currentTarget as HTMLButtonElement).style.background = `${LC_GREEN}22`; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = `${LC_GREEN}14`; }}>
                          <Edit2 size={14} /> Edit
                        </button>
                      </div>
                    );
                  })}
                </>);
              })()}
            </div>

            {/* ── Footer ── */}
            <footer style={{ padding: "12px 22px 16px", borderTop: `1px solid ${LC_LINE}`, background: LC_PAPER, flexShrink: 0 }}>
              <button onClick={openNew} disabled={!canEdit} style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                padding: 12, borderRadius: 10, border: `1px dashed ${LC_GREEN}80`,
                backgroundColor: `${LC_GREEN}0D`, color: LC_GREEN, fontSize: 13, fontWeight: 700,
                cursor: canEdit ? "pointer" : "default", opacity: canEdit ? 1 : 0.5,
                transition: "background .12s",
              }}
                onMouseEnter={e => { if (canEdit) (e.currentTarget as HTMLButtonElement).style.background = `${LC_GREEN}18`; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = `${LC_GREEN}0D`; }}>
                <Plus size={15} /> New Lifecycle
              </button>
            </footer>
          </>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", padding: "0 18px 18px" }}>
            <h3 style={{ margin: "16px 0 14px", fontSize: 17, fontWeight: 800, color: "#0F1923", letterSpacing: "-0.01em" }}>
              {editingId == null ? "New Lifecycle" : "Edit Lifecycle"}
            </h3>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#6B7A87", letterSpacing: 0.4, textTransform: "uppercase" }}>Lifecycle name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 8 Phase AIA"
              style={{ ...inputStyle, width: "100%", margin: "6px 0 16px", boxSizing: "border-box" }} />

            <label style={{ fontSize: 11, fontWeight: 700, color: "#6B7A87", letterSpacing: 0.4, textTransform: "uppercase" }}>Phases</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "6px 0 12px" }}>
              {phases.map((ph, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: Colors.green, width: 18, textAlign: "center" }}>{i + 1}</span>
                  <input value={ph} onChange={(e) => setPhaseAt(i, e.target.value)} placeholder={`Phase ${i + 1} name`} style={inputStyle} />
                  <button onClick={() => movePhase(i, -1)} disabled={i === 0} style={{ ...iconBtn, opacity: i === 0 ? 0.35 : 1 }}><ChevronUp size={15} /></button>
                  <button onClick={() => movePhase(i, 1)} disabled={i === phases.length - 1} style={{ ...iconBtn, opacity: i === phases.length - 1 ? 0.35 : 1 }}><ChevronDown size={15} /></button>
                  <button onClick={() => removePhase(i)} style={{ ...iconBtn, color: "#F87171" }}><Minus size={15} /></button>
                </div>
              ))}
            </div>
            <button onClick={addPhase} style={{
              display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 8,
              border: "1px dashed rgba(15,25,35,0.3)", backgroundColor: "transparent",
              color: "#4A5A66", fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: 14,
            }}>
              <Plus size={14} /> Add phase
            </button>

            {error && <div style={{ fontSize: 12, color: "#DC2626", marginBottom: 10 }}>{error}</div>}

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setView("list")} disabled={saving} style={{
                flex: 1, padding: 11, borderRadius: 10, border: "1px solid rgba(15,25,35,0.25)",
                backgroundColor: "transparent", color: "#33404C", fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}>Cancel</button>
              <button onClick={handleSave} disabled={saving || !canEdit} style={{
                flex: 1, padding: 11, borderRadius: 10, border: "none",
                backgroundColor: saving || !canEdit ? "rgba(107,165,57,0.4)" : Colors.green,
                color: "#FFF", fontSize: 13, fontWeight: 800, cursor: saving || !canEdit ? "default" : "pointer",
              }}>{saving ? "Saving…" : editingId == null ? "Create" : "Save changes"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────── SchedulePhases (full editor with cascade) ──────────────── */
/** Ordered phase titles from raw /task-data rows (same field conventions as
 *  lib/phaseHours) — feeds the Status picker, where a record's own schedule
 *  phases double as its statuses. Returns null when there are no rows at all
 *  (no schedule), [] when rows exist but carry no usable titles. */
// ── Per-record status-list customization (shared) ──
// The Override Status modal (OppLifecycleFooter) lets users drag-reorder, add
// and remove statuses for ONE record; the STATUS detail cell applies the SAME
// saved config so the dropdown and the lifecycle bar act as one system.
// Stored client-side per tenant + status field + record id (the footer's
// stageCfgKey): ordering is a display preference, and a custom status only
// becomes real data when it's saved onto the record.
type StageCfg = {
  order: string[];
  custom: string[];
  removed: string[];
  // Sub-statuses keyed by parent PHASE NAME (lowercase). These are user-defined
  // refinements shown indented under a schedule phase in the dropdown and in the
  // Override modal — e.g. "Construction" → ["30%","60%","Punch list"]. The
  // saved record value IS the sub-status string itself ("30%"), not a compound.
  subStatuses?: Record<string, string[]>;
};
// Fired (window event) after every config save so sibling components on the
// page — the footer and the STATUS cell share no React state — re-read it
// immediately.
const STAGE_CFG_EVENT = "rmone:stageCfgChanged";
function readStageCfg(key: string): StageCfg {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null");
    if (raw && Array.isArray(raw.order) && Array.isArray(raw.custom)) {
      const sub: Record<string, string[]> = {};
      if (raw.subStatuses && typeof raw.subStatuses === "object" && !Array.isArray(raw.subStatuses)) {
        for (const [k, v] of Object.entries(raw.subStatuses)) {
          if (Array.isArray(v)) sub[k] = (v as unknown[]).map(String);
        }
      }
      return {
        order: raw.order.map(String),
        custom: raw.custom.map(String),
        removed: Array.isArray(raw.removed) ? raw.removed.map(String) : [],
        subStatuses: sub,
      };
    }
  } catch { /* corrupt or unavailable storage — fall back to defaults */ }
  return { order: [], custom: [], removed: [], subStatuses: {} };
}
// Returns the flat set of all sub-status values across all phases (for indent rendering).
function getSubStatusKeys(cfg: StageCfg): Set<string> {
  const s = new Set<string>();
  for (const arr of Object.values(cfg.subStatuses ?? {})) for (const v of arr) s.add(v.trim().toLowerCase());
  return s;
}
// Applies a record's saved customization to an option list: custom statuses
// merge in, removed ones drop out, and a dragged order wins (names missing
// from the saved order keep their base position after the ordered ones).
// Matching is case-insensitive with base casing preferred, mirroring the
// footer's own effective-stage merge.
// Injects each phase's sub-statuses directly after it in the flat list.
// Sub-statuses are keyed by the phase name (lowercase) in cfg.subStatuses.
function injectSubStatuses(phases: string[], cfg: StageCfg): string[] {
  const sub = cfg.subStatuses;
  if (!sub || Object.keys(sub).length === 0) return phases;
  // Global uniqueness: a sub colliding (case-insensitively) with any phase or
  // custom status — or repeated under two parents — is skipped, so the list
  // never renders duplicate rows (which would also collide on React key={o}).
  const seen = new Set(phases.map((p) => p.trim().toLowerCase()));
  const out: string[] = [];
  for (const s of phases) {
    out.push(s);
    const children = sub[s.trim().toLowerCase()] ?? [];
    for (const c of children) {
      const k = c.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}
function applyStageCfgToOptions(base: string[], cfg: StageCfg, opts?: { lockedBase?: boolean }): string[] {
  // lockedBase (record has an assigned lifecycle): the base entries ARE
  // schedule phases with real start/end dates — the schedule owns their
  // sequence, so cfg.order entries naming phases are ignored and cfg.removed
  // never hides a phase (phases change via the Project Schedule card, not
  // here). Only the user's manually-added custom statuses order freely, and
  // they always sit AFTER the phases.
  const lockedKeys = opts?.lockedBase ? new Set(base.map((s) => s.trim().toLowerCase())) : null;
  const removed = new Set(cfg.removed.map((s) => s.trim().toLowerCase()));
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const s of [...base, ...cfg.custom]) {
    const k = s ? s.trim().toLowerCase() : "";
    if (!k || seen.has(k)) continue;
    if (removed.has(k) && !(lockedKeys && lockedKeys.has(k))) continue;
    seen.add(k); merged.push(s);
  }
  const orderNames = lockedKeys
    ? cfg.order.filter((o) => !lockedKeys.has(o.trim().toLowerCase()))
    : cfg.order;
  if (!lockedKeys && orderNames.length === 0) return injectSubStatuses(merged, cfg);
  const out: string[] = [];
  if (lockedKeys) for (const s of merged) if (lockedKeys.has(s.trim().toLowerCase())) out.push(s);
  for (const o of orderNames) {
    const m = merged.find((s) => s.trim().toLowerCase() === o.trim().toLowerCase());
    if (m && !out.includes(m)) out.push(m);
  }
  for (const s of merged) if (!out.includes(s)) out.push(s);
  return injectSubStatuses(out, cfg);
}

function extractSchedulePhaseTitles(rawTasks: unknown): string[] | null {
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) return null;
  return (rawTasks as Record<string, unknown>[])
    .map((t) => ({
      title: String((t as { Title?: unknown }).Title ?? (t as { Alias?: unknown }).Alias ?? "").trim(),
      step: Number((t as { StageStep?: unknown }).StageStep ?? (t as { ItemOrder?: unknown }).ItemOrder ?? 0) || 0,
    }))
    .filter((p) => p.title)
    .sort((a, b) => a.step - b.step)
    .map((p) => p.title);
}

// Phase → date-window map from the same task rows (lowercased title → UTC day
// strings, duplicate titles merged to min-start/max-end). Powers the
// "scheduled for later" guard: manually picking a phase whose start day
// hasn't arrived warns instead of silently saving.
function extractSchedulePhaseDates(rawTasks: unknown): Record<string, { start: string; end: string }> | null {
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) return null;
  const out: Record<string, { start: string; end: string }> = {};
  for (const t of rawTasks as Record<string, unknown>[]) {
    const title = String((t as { Title?: unknown }).Title ?? (t as { Alias?: unknown }).Alias ?? "").trim();
    if (!title) continue;
    const sMs = new Date(String((t as { StartDate?: unknown }).StartDate ?? "")).getTime();
    const eMs = new Date(String((t as { DueDate?: unknown }).DueDate ?? "")).getTime();
    // Ignore the "0001-…" sentinel dates some rows carry.
    if (!Number.isFinite(sMs) || sMs <= 0 || new Date(sMs).getFullYear() <= 2000) continue;
    const k = title.toLowerCase();
    const start = new Date(sMs).toISOString().slice(0, 10);
    const end = Number.isFinite(eMs) && eMs > 0 ? new Date(eMs).toISOString().slice(0, 10) : start;
    const prev = out[k];
    out[k] = prev
      ? { start: prev.start < start ? prev.start : start, end: prev.end > end ? prev.end : end }
      : { start, end };
  }
  return Object.keys(out).length > 0 ? out : null;
}

// "YYYY-MM-DD" must parse LOCAL (the bare form parses as UTC and can shift a
// day) — same rule as every other date-only parse in this file.
function fmtDayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// "Scheduled for later" gate: while the schedule drives the status list,
// saving a status that is a schedule PHASE (or a sub-status of one) whose
// start day hasn't arrived should warn — status follows the schedule week, so
// the fix is moving the phase dates, not relabeling the record. Custom
// statuses and terminal outcomes are never date-gated. Returns the offending
// phase + its start day, or null when the save is fine.
function futurePhaseGate(
  target: string,
  phases: string[] | null | undefined,
  phaseDates: Record<string, { start: string; end: string }> | null | undefined,
  subStatuses: Record<string, string[]> | undefined,
  currentStatus: string,
): { phase: string; startDay: string } | null {
  if (!phases || phases.length === 0 || !phaseDates) return null;
  const t = target.trim().toLowerCase();
  if (!t || t === currentStatus.trim().toLowerCase()) return null;
  // Resolve the target to a phase: itself, or the parent of a sub-status.
  let phase = phases.find((p) => p.trim().toLowerCase() === t);
  if (!phase && subStatuses) {
    for (const [parent, subs] of Object.entries(subStatuses)) {
      if (Array.isArray(subs) && subs.some((s) => s.trim().toLowerCase() === t)) {
        const pk = parent.trim().toLowerCase();
        phase = phases.find((p) => p.trim().toLowerCase() === pk);
        break;
      }
    }
  }
  if (!phase) return null;
  const d = phaseDates[phase.trim().toLowerCase()];
  if (!d?.start) return null;
  // UTC day compare — phase dates are stored midnight UTC (same convention
  // as the server's schedule auto-close/advance).
  const todayDay = new Date().toISOString().slice(0, 10);
  return d.start > todayDay ? { phase, startDay: d.start } : null;
}

// ── "Scheduled for later" popup ─────────────────────────────────────────────
// Raised by the STATUS detail cell and the lifecycle footer when a manual
// status pick targets a phase whose schedule window hasn't started. One
// shared component so both paths say exactly the same thing, with the jump
// link to the schedule card (the place the dates actually change).
function ScheduledLaterModal({ info, onOpenSchedule, onClose }: {
  info: { stage: string; phase: string; startDay: string };
  onOpenSchedule: () => void;
  onClose: () => void;
}) {
  const isSub = info.stage.trim().toLowerCase() !== info.phase.trim().toLowerCase();
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Status scheduled for later"
      style={{
        position: "fixed", inset: 0, zIndex: 10050,
        display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.60)", backdropFilter: "blur(4px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "min(440px, calc(100vw - 32px))",
        backgroundColor: "var(--rm-card, #1E2530)",
        border: "1px solid rgba(245,158,11,0.40)",
        borderRadius: 16, overflow: "hidden",
        boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
      }}>
        <div style={{ padding: "18px 20px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <Clock size={18} style={{ color: "#F59E0B", flexShrink: 0, marginTop: 2 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--rm-text, #F1F5F9)" }}>
              This status is scheduled for later
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--rm-text-muted, #94A3B8)", marginTop: 6 }}>
              {isSub ? (
                <>“{info.stage}” belongs to the <b style={{ color: "var(--rm-text, #F1F5F9)" }}>“{info.phase}”</b> phase, which starts{" "}</>
              ) : (
                <>The <b style={{ color: "var(--rm-text, #F1F5F9)" }}>“{info.phase}”</b> phase starts{" "}</>
              )}
              <b style={{ color: "#F59E0B" }}>{fmtDayLabel(info.startDay)}</b> in this record’s schedule.
              Status follows the schedule week — to move there now, change the phase’s schedule dates first.
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "0 16px 16px" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 14px", borderRadius: 10, cursor: "pointer",
              fontSize: 12.5, fontWeight: 600,
              background: "transparent", color: "var(--rm-text-muted, #94A3B8)",
              border: "1px solid var(--rm-border, rgba(255,255,255,0.14))",
            }}>
            Keep current status
          </button>
          <button
            type="button"
            onClick={onOpenSchedule}
            style={{
              padding: "8px 14px", borderRadius: 10, cursor: "pointer",
              fontSize: 12.5, fontWeight: 700,
              background: ACCENT_PURPLE, color: "#FFFFFF", border: "1px solid transparent",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}>
            <Calendar size={13} />
            Change schedule dates
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Wizard "Skip for now" support ──────────────────────────────────────────
   Skip must mean SKIP (Aug 2026 report): every edit inside SchedulePhases
   saves to the server immediately — there is no draft state — so a user who
   set phase dates on the wizard's Schedule tab and then clicked "Skip for
   now" still ended up with a fully dated schedule. This rewrites the SAME
   phase rows with blank dates: the phase list (the auto-applied default
   lifecycle) stays, but nothing is scheduled. Server-side this is safe —
   blank dates store as NULL, the allocations-follow-schedule shift only runs
   when the new schedule has a real start, and status auto-advance ignores
   dateless schedules.
   Returns "cleared" when dates were removed, "nothing" when the schedule was
   already dateless or has no rows (the common skip case — no write happens). */
export async function clearScheduleDates(ticketId: string): Promise<"cleared" | "nothing"> {
  // Sentinel-aware date check (mirrors SchedulePhases' dayOf): core2 stores
  // "0001-01-01"/"1900-*" placeholders for blanks — those are NOT real dates.
  const realDay = (v?: string): boolean => {
    const d = v ? String(v).split("T")[0] : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && d > "1971-01-01";
  };
  bustCache(`project:tasks:${ticketId}`);
  const raw = await getTaskData(ticketId, "0");
  const rows = (Array.isArray(raw)
    ? raw
    : ((raw as { Data?: unknown })?.Data ?? (raw as { data?: unknown })?.data ?? [])) as ScheduleTask[];
  const savable = rows.filter((t) => typeof t.ID === "number" && t.ID > 0);
  if (savable.length === 0 || !savable.some((t) => realDay(t.StartDate) || realDay(t.DueDate))) return "nothing";

  // The /schedule save re-points the record at ProjectLifecycleID, so it must
  // be the record's CURRENT lifecycle — never a guessed "0" (that would
  // silently unassign the lifecycle while clearing the dates).
  const details = await getProjectDetails(ticketId);
  const rf = (((details as { Data?: Record<string, unknown> })?.Data ?? details) ?? {}) as Record<string, unknown>;
  const lcRaw = rf.ProjectLifeCycleLookup ?? rf.ScrumLifeCycle ?? rf.scrumLifeCycle
    ?? rf.ProjectLifecycleID ?? rf.ProjectLifeCycleID ?? rf.LifecycleID ?? rf.LifeCycleID;
  const lcId = lcRaw != null && String(lcRaw).trim() !== "" && String(lcRaw) !== "false" && String(lcRaw) !== "0" ? String(lcRaw) : "";
  if (!lcId) throw new Error("Could not resolve this record's lifecycle — the dates were left unchanged.");

  const cleared: ScheduleTask[] = savable.map((t, i) => ({
    ID: t.ID, Title: t.Title, StartDate: "", DueDate: "",
    Status: t.Status || "Not Started", PercentComplete: t.PercentComplete ?? 0,
    ItemOrder: t.ItemOrder ?? i + 1, TicketId: ticketId, AssignedTo: t.AssignedTo || "",
    isSelected: true, StageStep: t.StageStep ?? t.ItemOrder ?? i + 1,
  }));
  await createSchedule({
    TicketID: ticketId,
    ProjectLifecycleID: lcId,
    ProjectScheduleExists: true,
    TargetStartDate: "0001-01-01T00:00:00",
    TargetCompletionDate: "0001-01-01T00:00:00",
    Tasks: cleared,
  });
  // Keep the schedule section cache honest so re-opening the Schedule tab
  // (wizard or project page) can't re-show the old dated rows from the warm
  // seed — persistBuiltTasks seeded it with the dated schedule on every save.
  setCachedSection("schedule", ticketId, cleared);
  notifyScheduleChanged();
  return "cleared";
}

/** Wipe the ENTIRE schedule for a record — soft-deletes all phase rows and
 *  inserts nothing. Used by the wizard "Skip for now" action so users see a
 *  truly empty schedule section, not a phase list they didn't ask for.
 *
 *  Passes lifecycle "0" so the server ALSO clears the lifecycle pointer. This
 *  is intentional: without it, getTaskDataRds always re-seeds placeholder rows
 *  (ID=0) for every template stage whenever the lifecycle is still assigned,
 *  which makes the skip appear to do nothing. The user can re-pick a lifecycle
 *  from "Change lifecycle" when they're ready to set up the schedule.
 *
 *  Returns "cleared" when the server call was made, "nothing" when getTaskData
 *  returned zero rows (no schedule at all — no write needed). */
export async function clearScheduleEntirely(ticketId: string): Promise<"cleared" | "nothing"> {
  bustCache(`project:tasks:${ticketId}`);
  const raw = await getTaskData(ticketId, "0");
  const rows = (Array.isArray(raw)
    ? raw
    : ((raw as { Data?: unknown })?.Data ?? (raw as { data?: unknown })?.data ?? [])) as ScheduleTask[];
  // Include template placeholder rows (ID=0): if the server returned ANY rows
  // it means a lifecycle is assigned and placeholders are being auto-seeded.
  // We must clear + unassign even when no PMMTasks rows exist in the DB yet.
  if (rows.length === 0) return "nothing";

  // ProjectLifecycleID "0" signals the server to set ProjectLifeCycleLookup=0
  // (unassign). Without this, the lifecycle stays and getTaskDataRds re-seeds
  // the same placeholder rows on every subsequent fetch.
  await createSchedule({
    TicketID: ticketId,
    ProjectLifecycleID: "0",
    ProjectScheduleExists: false,
    TargetStartDate: "0001-01-01T00:00:00",
    TargetCompletionDate: "0001-01-01T00:00:00",
    Tasks: [],
  });
  setCachedSection("schedule", ticketId, []);
  notifyScheduleChanged();
  return "cleared";
}

export function SchedulePhases({ ticketId, module, project, onRefresh, onDatesSaved, parentLcAssigned, canEdit = true, isAdmin = false, onActiveLcTitle }: {
  ticketId: string; module: string; project: ProjectData; onRefresh?: (fast?: boolean) => void; onDatesSaved?: (startIso: string, endIso: string) => void; parentLcAssigned?: boolean; canEdit?: boolean; isAdmin?: boolean;
  /** Called with the display name of the active lifecycle template (or null when none is assigned). */
  onActiveLcTitle?: (name: string | null) => void;
}) {
  const [tasks, setTasks] = useState<ScheduleTask[]>(() => {
    const hit = getCachedSection<unknown>("schedule", ticketId);
    return Array.isArray(hit) ? (hit as ScheduleTask[]) : [];
  });
  const savedTasksByLcId = useRef<Record<string, ScheduleTask[]>>({});
  const [loading, setLoading] = useState(() => getCachedSection("schedule", ticketId) === undefined);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editWeeks, setEditWeeks] = useState("");
  const [saving, setSaving] = useState(false);
  // Admin-only inline phase rename + add-phase-row (both also sync the
  // assigned lifecycle template so Manage Lifecycles reflects the change).
  const [renameIdx, setRenameIdx] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [renSaving, setRenSaving] = useState(false);
  const [addingPhase, setAddingPhase] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState("");
  const [newPhaseStart, setNewPhaseStart] = useState("");
  const [newPhaseEnd, setNewPhaseEnd] = useState("");
  const [newPhaseWeeks, setNewPhaseWeeks] = useState("2");
  const [addSaving, setAddSaving] = useState(false);
  // A schedule write deliberately seeds the just-saved rows before notifying
  // the rest of the app. Ignore that synchronous self-notification and do one
  // explicit fresh read after the lifecycle/template write is also complete;
  // otherwise an older in-flight read can briefly restore the old final phase.
  const suppressScheduleRefresh = useRef(false);
  const lifecycleSyncInFlight = useRef(false);
  // Add/rename actions can be saved back-to-back. Template updates must be
  // serialized and each must start from the latest template, otherwise a
  // second add can overwrite a first phase that is still propagating.
  const lifecycleSyncQueueRef = useRef<Promise<void>>(Promise.resolve());
  // "Project Length" quick-fill: type a total number of weeks and distribute
  // it across all phases starting from a chosen date (default today).
  const [lenWeeks, setLenWeeks] = useState("");
  const [lenStart, setLenStart] = useState(() => todayLocalStr());
  const lenStartTouched = useRef(false);
  const [lenMode, setLenMode] = useState<"smart" | "even" | "per">("smart");
  const [applyingLen, setApplyingLen] = useState(false);
  // Editable preview popup for "Project Length" — user confirms (or tweaks
  // per-phase weeks) before anything is written.
  const [lenPreview, setLenPreview] = useState<LenPreviewRow[] | null>(null);
  const [lifecycleId, setLifecycleId] = useState("");
  const [lifecycles, setLifecycles] = useState<LifecycleInfo[]>([]);
  const [selectedLcId, setSelectedLcId] = useState<string>("");
  const [assigning, setAssigning] = useState(false);
  const [showChangeLc, setShowChangeLc] = useState(false);
  const [isLcAssigned, setIsLcAssigned] = useState(parentLcAssigned ?? false);
  // Once a lifecycle is assigned AND the project has real team allocations
  // (any member with weekly/EAC/ETC hours or a non-zero allocation), changing
  // the lifecycle is locked — a change rebuilds the phase schedule underneath
  // live allocations. Before anything is allocated the user can freely pick
  // and re-pick a lifecycle. "Manage lifecycles" (template editing) stays
  // available either way.
  const hasAllocations = (project?.allocations ?? []).some(
    (a) => a.hasWeeklyHours || (a.pct ?? 0) > 0,
  );
  // Only lock "Change lifecycle" when a specific template ID is already wired
  // up AND the record has live allocations AND there are actual phase rows —
  // in that case switching rebuilds the phase schedule underneath existing
  // hours, so we surface a warning instead of hiding the button entirely.
  // When there are NO phases (e.g. schedule was skipped during conversion, or
  // the lifecycle was cleared), there is nothing to rebuild and the user must
  // be able to pick a lifecycle freely regardless of allocations.
  // If there is no template ID yet (imported phases, manually added) the user
  // should always be able to pick a template freely.
  const lockLcChange = !!lifecycleId && hasAllocations && tasks.length > 0;
  const { toast } = useToast();
  // In-app confirmation dialog (replaces the browser-native confirm() popup).
  const [confirmDialog, setConfirmDialog] = useState<
    { title: string; message: string; confirmLabel: string; resolve: (v: boolean) => void } | null
  >(null);
  const askConfirm = (title: string, message: string, confirmLabel = "Confirm") =>
    new Promise<boolean>((resolve) => setConfirmDialog({ title, message, confirmLabel, resolve }));
  const [phaseActionDialog, setPhaseActionDialog] = useState<{
    title: string;
    message: string;
    resolve: (action: "clear" | "delete" | "cancel") => void;
  } | null>(null);
  const askPhaseAction = (title: string, message: string) =>
    new Promise<"clear" | "delete" | "cancel">((resolve) => setPhaseActionDialog({ title, message, resolve }));
  const resolvePhaseAction = (action: "clear" | "delete" | "cancel") => {
    const dialog = phaseActionDialog;
    if (!dialog) return;
    setPhaseActionDialog(null);
    dialog.resolve(action);
  };
  const [editingDates, setEditingDates] = useState(false);
  const [savingDates, setSavingDates] = useState(false);
  const [dateTargetStart, setDateTargetStart] = useState("");
  const [dateTargetEnd, setDateTargetEnd] = useState("");
  const [showManageLc, setShowManageLc] = useState(false);
  // True when the cold-path task fetch timed out or failed — renders a retry
  // state instead of an endless spinner or a wrong "no lifecycle" guess.
  const [loadFailed, setLoadFailed] = useState(false);
  // Guards late-arriving task data (see cold path) against a record switch —
  // this component instance is reused across record→record navigation.
  const liveTicketRef = useRef(ticketId);
  useEffect(() => { liveTicketRef.current = ticketId; }, [ticketId]);

  // Lifecycle templates are module-scoped: projects must never be offered
  // opportunity templates and vice versa (server filters via ?module=).
  const lcModule: "PMM" | "OPM" = module === "OPM" ? "OPM" : "PMM";

  // ── Per-phase "Set rules" (admin) — record-scoped drawer ─────────────────
  // Same drawer the Settings schedule cards host, but scoped to THIS record:
  // the first save forks the company rules into a doc that governs only this
  // project; "Use company rules instead" (in the drawer) deletes the fork.
  // Deliberately available on Complete projects and independent of canEdit —
  // rules govern FUTURE edits, so an admin configuring a finished phase (or
  // one they can't edit data on) is legitimate.
  const [ruleTarget, setRuleTarget] = useState<ScheduleRuleTarget | null>(null);
  const [ruleCountFn, setRuleCountFn] = useState<((mod: StageRuleModule, stage: string) => number) | null>(null);
  const handleRuleCounts = useCallback((fn: ((mod: StageRuleModule, stage: string) => number) | null) => {
    setRuleCountFn(() => fn);
  }, []);
  const openPhaseRules = (phaseName: string) => {
    if (!phaseName) return;
    const order = tasks.map((t) => String(t.Title ?? "")).filter(Boolean);
    setRuleTarget({ mod: lcModule, stage: phaseName, order });
  };

  const reloadLifecycles = useCallback(async (): Promise<LifecycleInfo[]> => {
    bustCache("lifecycles");
    // Brief pause so the server-side IPC bust reaches all workers before the
    // GET fires — without this, a different worker can still serve the stale
    // cached list and the newly-created lifecycle doesn't appear.
    await new Promise<void>((r) => setTimeout(r, 200));
    const lcRes = await getLifecycles(lcModule).catch(() => [] as LifecycleInfo[]);
    const lcList = (Array.isArray(lcRes) ? lcRes : []) as LifecycleInfo[];
    setLifecycles(lcList);
    return lcList;
  }, [lcModule]);

  // Live refresh: Settings saves of named phase/stage sets (and template
  // create/rename/delete anywhere in the app) fire notifyLifecyclesChanged()
  // — same-tab via a window event, other tabs via the rmone:lifecyclesTs
  // localStorage tick. Re-pull the list so the "Pick a lifecycle template"
  // picker shows the new/edited templates immediately, even if it's already
  // open, instead of waiting for a page refresh or cache TTL.
  useEffect(() => {
    const onChanged = () => { void reloadLifecycles(); };
    const onStorage = (e: StorageEvent) => { if (e.key === "rmone:lifecyclesTs") onChanged(); };
    window.addEventListener("rmone:lifecyclesChanged", onChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("rmone:lifecyclesChanged", onChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, [reloadLifecycles]);

  // Report the active lifecycle template name to the parent (used for the
  // card-header subtitle) whenever it changes.
  useEffect(() => {
    if (!onActiveLcTitle) return;
    if (!lifecycleId || lifecycles.length === 0) { onActiveLcTitle(null); return; }
    const lc = lifecycles.find((l) => String(l.ID) === lifecycleId);
    const name = lc
      ? (lc.Name.startsWith("Imported:") && (lc.Stages ?? []).length > 0
          ? [...(lc.Stages ?? [])].sort((a, b) => (a.StageStep ?? 0) - (b.StageStep ?? 0)).map((s) => s.Name).join(", ")
          : lc.Name)
      : null;
    onActiveLcTitle(name);
  }, [lifecycleId, lifecycles, onActiveLcTitle]);

  const loadTasks = useCallback(async (force = false, opts?: { silent?: boolean }) => {
    // ── Fast path: subsection cache is warm ──────────────────────────────────
    // The project-detail page pre-warms this cache the moment the ticketId is
    // known (via prefetchSubSection). When the Schedule tab opens and the cache
    // is already populated we can show the tasks immediately without any spinner.
    // Lifecycle + project-detail metadata still refresh in the background so
    // the lifecycle picker and save paths stay accurate.
    const cachedTasks = force ? undefined : getCachedSection("schedule", ticketId);
    if (cachedTasks !== undefined) {
      // Seeded = persisted from a previous session → also refetch the task
      // data itself in the background so a reload can't pin stale phases.
      const seededHit = isSectionSeeded("schedule", ticketId);
      const raw = Array.isArray(cachedTasks)
        ? cachedTasks
        : (cachedTasks as { Data?: unknown })?.Data ?? (cachedTasks as { data?: unknown })?.data ?? [];
      const hasTasks = Array.isArray(raw) && raw.length > 0;
      if (hasTasks) {
        setTasks(raw as ScheduleTask[]);
        setIsLcAssigned(true);
      }
      setLoading(false);

      // Background refresh: update lifecycle list + scrumLc field without blocking
      void (async () => {
        try {
          const [lcRes, freshRes, taskFreshRes] = await Promise.allSettled([
            getLifecycles(lcModule).catch(() => [] as LifecycleInfo[]),
            getProjectDetails(ticketId).catch(() => null),
            seededHit ? getTaskData(ticketId, "0") : Promise.resolve(undefined),
          ]);
          const lcList = (lcRes.status === "fulfilled" && Array.isArray(lcRes.value) ? lcRes.value : []) as LifecycleInfo[];
          if (lcList.length > 0) setLifecycles(lcList);
          // Silent task revalidation: replace the seed with fresh data.
          let effectiveHasTasks = hasTasks;
          if (seededHit && taskFreshRes.status === "fulfilled" && taskFreshRes.value !== undefined) {
            const freshTasks = taskFreshRes.value;
            setCachedSection("schedule", ticketId, freshTasks);
            const rawFresh = Array.isArray(freshTasks)
              ? freshTasks
              : (freshTasks as { Data?: unknown })?.Data ?? (freshTasks as { data?: unknown })?.data ?? [];
            if (Array.isArray(rawFresh)) {
              effectiveHasTasks = rawFresh.length > 0;
              setTasks(rawFresh as ScheduleTask[]);
            }
          }
          const freshRaw = freshRes.status === "fulfilled" ? freshRes.value : null;
          const freshData = freshRaw ? ((freshRaw as { Data?: Record<string, unknown> })?.Data ?? freshRaw) : null;
          const liveRf: Record<string, unknown> = { ...(project.rawFields || {}), ...(freshData && typeof freshData === "object" ? freshData as Record<string, unknown> : {}) };
          const scrumLc = liveRf.ProjectLifeCycleLookup ?? liveRf.ScrumLifeCycle ?? liveRf.scrumLifeCycle
            ?? liveRf.ProjectLifecycleID ?? liveRf.ProjectLifeCycleID ?? liveRf.LifecycleID ?? liveRf.LifeCycleID;
          const activeLcId = scrumLc && String(scrumLc).trim() !== "" && String(scrumLc) !== "false" && String(scrumLc) !== "0" ? String(scrumLc) : "";
          setIsLcAssigned(!!(activeLcId || effectiveHasTasks));
          setSelectedLcId(activeLcId);
          if (activeLcId) setLifecycleId(activeLcId);
        } catch { /* ignore */ }
      })();
      return;
    }

    // ── Cold path: cache miss → fire all three fetches in parallel, render
    // TASK-FIRST: the schedule rows appear the moment task-data lands instead
    // of waiting on the slower lifecycles + record-detail calls (those only
    // feed the lifecycle picker and the empty-state decision).
    try {
      // silent = revalidate without blanking the section (the already-rendered
      // tasks stay visible; state is swapped in place when fresh data lands).
      if (!opts?.silent) setLoading(true);
      const lcPromise = getLifecycles(lcModule).catch(() => [] as LifecycleInfo[]);
      const freshPromise = getProjectDetails(ticketId).catch(() => null);
      const taskPromise = getTaskData(ticketId, "0");

      // Cap the task wait at 15s so a hung call can never pin the spinner
      // (the raw fetch timeout is 90s). A timeout/failure shows a retry state
      // and is NEVER written to the section cache — a cached timeout-empty
      // would make every later open instantly claim "no schedule" for a
      // project that has one.
      let taskOk = false;
      let taskRes: unknown = [];
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 15000);
        taskPromise
          .then((v) => { taskOk = true; taskRes = v; clearTimeout(t); resolve(); })
          .catch(() => { clearTimeout(t); resolve(); });
      });

      let hasTasks = false;
      if (taskOk) {
        setLoadFailed(false);
        setCachedSection("schedule", ticketId, taskRes);
        const raw = Array.isArray(taskRes) ? taskRes : (taskRes as { Data?: unknown })?.Data ?? (taskRes as { data?: unknown })?.data ?? [];
        hasTasks = Array.isArray(raw) && raw.length > 0;
        if (hasTasks) {
          // Render NOW — non-empty tasks alone prove a lifecycle is assigned.
          setTasks(raw as ScheduleTask[]);
          setIsLcAssigned(true);
          setLoading(false);
        } else {
          setTasks([]);
        }
      } else {
        setLoadFailed(true);
        // If the slow fetch eventually lands, apply it (unless the user moved
        // to a different record) so the retry state self-heals.
        void taskPromise.then((v) => {
          if (liveTicketRef.current !== ticketId) return;
          setCachedSection("schedule", ticketId, v);
          const rawLate = Array.isArray(v) ? v : (v as { Data?: unknown })?.Data ?? (v as { data?: unknown })?.data ?? [];
          if (Array.isArray(rawLate)) {
            setTasks(rawLate as ScheduleTask[]);
            if (rawLate.length > 0) setIsLcAssigned(true);
            setLoadFailed(false);
          }
        }).catch(() => { /* retry button covers it */ });
      }

      // Lifecycle list + record-field hint — feeds the picker and the
      // empty-tasks empty-state decision; never blocks the first paint above.
      const [lcSettled, freshSettled] = await Promise.allSettled([lcPromise, freshPromise]);
      const lcRes = lcSettled.status === "fulfilled" ? lcSettled.value : [] as LifecycleInfo[];
      const lcList = (Array.isArray(lcRes) ? lcRes : []) as LifecycleInfo[];
      if (lcList.length > 0) setLifecycles(lcList);

      const freshRaw = freshSettled.status === "fulfilled" ? freshSettled.value : null;
      const freshData = freshRaw ? ((freshRaw as { Data?: Record<string, unknown> })?.Data ?? freshRaw) : null;
      let liveRf: Record<string, unknown> = project.rawFields || {};
      if (freshData && typeof freshData === "object") liveRf = { ...liveRf, ...(freshData as Record<string, unknown>) };

      const rf = liveRf;
      const scrumLc = rf.ProjectLifeCycleLookup ?? rf.ScrumLifeCycle ?? rf.scrumLifeCycle
        ?? rf.ProjectLifecycleID ?? rf.ProjectLifeCycleID ?? rf.LifecycleID ?? rf.LifeCycleID;
      const fieldHint = !!(scrumLc && String(scrumLc).trim() !== "" && String(scrumLc) !== "false" && String(scrumLc) !== "0");

      if (taskOk) setIsLcAssigned(fieldHint || hasTasks);
      else if (fieldHint || parentLcAssigned) setIsLcAssigned(true);
      const activeLcId = fieldHint ? String(scrumLc) : "";
      setSelectedLcId(activeLcId);
      if (activeLcId) setLifecycleId(activeLcId);
    } catch {
      setTasks([]);
      if (parentLcAssigned) setIsLcAssigned(true);
    } finally {
      setLoading(false);
    }
  }, [ticketId, lcModule, project.rawFields, parentLcAssigned]);

  useEffect(() => { loadTasks(); }, [loadTasks]);
  useEffect(() => onScheduleChanged(() => {
    if (suppressScheduleRefresh.current) return;
    bustCache();
    loadTasks(true, { silent: true });
  }), [loadTasks]);

  // Auto-refresh phase names when Settings renames them:
  // 1. Settings save fires notifyLifecyclesChanged() → rmone:lifecyclesChanged window event
  //    + rmone:lifecyclesTs localStorage tick (cross-tab). We reload task data so the
  //    renamed phase names appear in the schedule rows without a manual page refresh.
  // 2. visibilitychange: user switches to Settings in another tab, saves, then comes back —
  //    the storage event fires before they switch back, but the component may have missed it
  //    if it wasn't yet mounted; polling on tab re-focus catches that edge case.
  useEffect(() => {
    const reload = () => {
      if (lifecycleSyncInFlight.current) return;
      void loadTasks(true, { silent: true });
    };
    const onStorage = (e: StorageEvent) => { if (e.key === "rmone:lifecyclesTs") reload(); };
    const onVisible = () => { if (!document.hidden) reload(); };
    window.addEventListener("rmone:lifecyclesChanged", reload);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("rmone:lifecyclesChanged", reload);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadTasks]);

  const daysToWeeks = (days: number) => days > 0 ? Math.ceil(days / 7) : 0;
  const formatDuration = (days: number, sameDay = false) => {
    if (days <= 0) return sameDay ? "1 day" : "—";
    if (days < 7) return `${days} day${days === 1 ? "" : "s"}`;
    const wholeWeeks = Math.floor(days / 7);
    const remainingDays = days % 7;
    const weeksLabel = `${wholeWeeks} wk${wholeWeeks === 1 ? "" : "s"}`;
    return remainingDays > 0 ? `${weeksLabel} ${remainingDays}d` : weeksLabel;
  };
  const weeksToDays = (wks: number) => wks * 7;
  // The three helpers below work on CALENDAR date parts, never UTC instants:
  // toISOString()/bare new Date("YYYY-MM-DD") round trips render a day early
  // for viewers west of UTC and drift across US daylight-saving boundaries
  // (invisible from IST — India has no DST).
  const calcDays = (start: string, end: string): number => {
    const ms = (v: string) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || "");
      return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
    };
    const s = ms(start); const e = ms(end);
    if (isNaN(s) || isNaN(e)) return 0;
    return Math.max(0, Math.ceil((e - s) / 86400000));
  };
  const addDaysStr = (d: string, n: number) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (!m) return d;
    // Local-calendar arithmetic anchored at noon: setDate() on a UTC-parsed
    // date slides a day when a US clock change falls inside the span.
    const dt = new Date(+m[1], +m[2] - 1, +m[3] + n, 12);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  };
  const formatDateOffset = (offset: number): string => addDaysStr(todayLocalStr(), offset);
  // Returns the date-only part of a task date when it's a real date (filters
  // the "0001-01-01" / "1900-*" placeholder sentinels core2 stores for blanks).
  const dayOf = (v?: string): string => {
    const d = v ? v.split("T")[0] : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && d > "1971-01-01" ? d : "";
  };
  // "Start From" defaults to the schedule's existing start (earliest phase
  // start date) once tasks load; today's date when there's no schedule yet.
  // A manual pick by the user is never overwritten.
  useEffect(() => {
    if (lenStartTouched.current) return;
    let earliest = "";
    for (const t of tasks) {
      const s = dayOf(t.StartDate);
      if (s && (!earliest || s < earliest)) earliest = s;
    }
    setLenStart(earliest || todayLocalStr());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  // Weeks-first entry: when a phase has no start date yet, chain it from the
  // nearest earlier phase that has an end date (next day); first phase → today.
  const deriveStartForIdx = (idx: number | null): string => {
    if (idx != null) {
      for (let i = idx - 1; i >= 0; i--) {
        const prevEnd = dayOf(tasks[i]?.DueDate);
        if (prevEnd) return addDaysStr(prevEnd, 1);
      }
    }
    return todayLocalStr();
  };

  const handleAssignLifecycle = async (overrideLcId?: string) => {
    const lcId = overrideLcId ?? selectedLcId;
    const activeLc = lifecycles.find((l) => String(l.ID) === lcId);
    if (!activeLc?.Stages?.length) {
      toast({ title: "Select a lifecycle first", description: "Pick a lifecycle template before assigning.", variant: "destructive" });
      return;
    }

    if (isLcAssigned || parentLcAssigned) {
      const ok = await askConfirm(
        "Replace existing schedule?",
        "This project already has a lifecycle assigned. Reassigning will overwrite the existing schedule dates. Are you sure you want to replace the current schedule?",
        "Replace",
      );
      if (!ok) return;
    } else {
      const ok = await askConfirm(
        "Assign lifecycle?",
        `Assign "${activeLc.Name}" (${activeLc.Stages.length} phases) to this project? This is permanent.`,
        "Assign",
      );
      if (!ok) return;
    }

    try {
      setAssigning(true);
      const stages = [...activeLc.Stages].sort((a, b) => a.StageStep - b.StageStep);
      let filtered = stages;
      if (module === "OPM") filtered = stages.filter((s) => s.Name !== "Project Complete");

      if (lifecycleId && tasks.length > 0) savedTasksByLcId.current[lifecycleId] = tasks;
      const sourceTasks = savedTasksByLcId.current[lcId] ?? (lcId === lifecycleId ? tasks : []);
      const scheduleTasks: ScheduleTask[] = [];
      filtered.forEach((stage, i) => {
        const existing = sourceTasks.find((t) => t.Title === stage.Name);
        const baseOffset = i * 14;
        scheduleTasks.push({
          ID: existing?.ID ?? -(i + 1),
          Title: stage.Name,
          StartDate: existing?.StartDate ?? formatDateOffset(baseOffset),
          DueDate: existing?.DueDate ?? formatDateOffset(baseOffset + 13),
          Status: existing?.Status ?? "Not Started",
          PercentComplete: existing?.PercentComplete ?? 0,
          ItemOrder: stage.StageStep || (i + 1),
          TicketId: ticketId, AssignedTo: "",
          isSelected: true,
          StageStep: stage.StageStep || (i + 1),
        });
      });

      await createSchedule({
        TicketID: ticketId,
        ProjectLifecycleID: lcId,
        ProjectScheduleExists: tasks.length > 0 || isLcAssigned || !!parentLcAssigned,
        TargetStartDate: "0001-01-01T00:00:00",
        TargetCompletionDate: "0001-01-01T00:00:00",
        Tasks: scheduleTasks,
      });

      toast({ title: "Lifecycle assigned", description: `${activeLc.Name} assigned with ${scheduleTasks.length} phases.` });
      setShowChangeLc(false);
      setLifecycleId(lcId);
      setIsLcAssigned(true);
      bustCache();
      notifyScheduleChanged();
      await loadTasks(true);
      onRefresh?.();
    } catch (e: unknown) {
      toast({ title: "Assign failed", description: e instanceof Error ? e.message : "Could not assign lifecycle", variant: "destructive" });
    } finally {
      setAssigning(false);
    }
  };

  const startEdit = (idx: number) => {
    const t = tasks[idx];
    setRenameIdx(null);
    setEditingIdx(idx);
    // dayOf() filters legacy "1900-*"/"0001-*" sentinel dates so they prefill
    // as blank — otherwise a sentinel start blocks the weeks-first derivation.
    const s = dayOf(t.StartDate);
    const e = dayOf(t.DueDate);
    setEditStart(s); setEditEnd(e);
    setEditWeeks(String(daysToWeeks(calcDays(s, e))));
  };
  const cancelEdit = () => { setEditingIdx(null); setEditStart(""); setEditEnd(""); setEditWeeks(""); };

  const handleEditStartChange = (v: string) => {
    setEditStart(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const wks = parseInt(editWeeks) || 0;
      if (wks > 0) setEditEnd(addDaysStr(v, weeksToDays(wks)));
    }
  };
  const handleEditEndChange = (v: string) => {
    setEditEnd(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && /^\d{4}-\d{2}-\d{2}$/.test(editStart)) {
      setEditWeeks(String(daysToWeeks(calcDays(editStart, v))));
    }
  };
  const handleEditWeeksChange = (v: string) => {
    setEditWeeks(v);
    const wks = parseInt(v);
    if (isNaN(wks) || wks <= 0) return;
    let start = editStart;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      // Weeks-first: no start date yet — auto-chain from the previous phase's
      // end date (first phase falls back to today), then compute the end.
      start = deriveStartForIdx(editingIdx);
      setEditStart(start);
    }
    setEditEnd(addDaysStr(start, weeksToDays(wks)));
  };

  // ── Business rule: warn before moving schedule dates into the past ──────
  // If a save would set a CHANGED phase date to before today, the save is
  // held and a confirmation popup opens; the schedule only changes after the
  // user confirms. Unchanged dates already in the past never re-trigger it.
  const [pastConfirm, setPastConfirm] = useState<{ msg: string; resolve: (ok: boolean) => void } | null>(null);
  const confirmPastDates = (built: ScheduleTask[]): Promise<boolean> => {
    const t = new Date();
    const todayStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    const byId = new Map(tasks.map((x) => [x.ID, x]));
    const hits: string[] = [];
    for (const b of built) {
      const old = byId.get(b.ID);
      const ns = dayOf(b.StartDate); const ne = dayOf(b.DueDate);
      const os = old ? dayOf(old.StartDate) : ""; const oe = old ? dayOf(old.DueDate) : "";
      if ((ns && ns !== os && ns < todayStr) || (ne && ne !== oe && ne < todayStr)) {
        hits.push(String(b.Title ?? "Phase"));
      }
    }
    if (hits.length === 0) return Promise.resolve(true);
    const msg = hits.slice(0, 3).join(", ") + (hits.length > 3 ? ` and ${hits.length - 3} more` : "");
    return new Promise<boolean>((resolve) => setPastConfirm({ msg, resolve }));
  };

  // Shared save path for full-schedule writes (single-phase edit + project
  // length quick-fill). POSTs the built task list, then optimistically seeds
  // local state from what was just sent. Ordering is deliberate: seed AFTER
  // notifyScheduleChanged() so the listener's bustCache() can't wipe the cache
  // seed; the listener performs the ONE silent background revalidation.
  const persistBuiltTasks = async (
    built: ScheduleTask[],
    opts?: { omitPlaceholderTitles?: string[] },
  ) => {
    const toIso = (d: string | undefined) => {
      if (!d) return "0001-01-01T00:00:00";
      if (d.includes("T")) return d.split(".")[0];
      return `${d.slice(0, 10)}T00:00:00`;
    };
    const resp = await updateProjectSchedule({
      TicketID: ticketId,
      ProjectLifecycleID: lifecycleId,
      ProjectScheduleExists: true,
      TargetStartDate: toIso(project.targetStart),
      TargetCompletionDate: toIso(project.targetEnd),
      ActualStartDate: toIso(project.actualStart),
      ActualCompletionDate: toIso(project.actualEnd),
      BidDueDate: toIso(project.bidDate),
      Tasks: built,
    });
    // Business rule: when the whole schedule moved, the server shifts the
    // team's allocations with it (whole weeks) — tell the user it happened.
    const shifted = Number((resp as Record<string, unknown>)?.shiftedWeeks ?? 0) || 0;
    if (shifted !== 0) {
      const n = Math.abs(shifted);
      toast({
        title: "Team allocations moved with the schedule",
        description: `Assignment dates and weekly hours shifted ${n} week${n === 1 ? "" : "s"} ${shifted > 0 ? "later" : "earlier"}.`,
      });
    }
    suppressScheduleRefresh.current = true;
    try {
      bustCache();
      notifyScheduleChanged();
    } finally {
      suppressScheduleRefresh.current = false;
    }
    // The server replaces the whole schedule with `built`, so the optimistic
    // seed mirrors built's order/content (covers renames and brand-new rows —
    // temp negative IDs get corrected by the silent background revalidation).
    const byOld = new Map(tasks.filter((t) => typeof t.ID === "number").map((t) => [t.ID, t]));
    const builtTitles = new Set(built.map((b) => String(b.Title ?? "").trim().toLowerCase()));
    const omittedPlaceholderTitles = new Set(
      (opts?.omitPlaceholderTitles ?? []).map((title) => title.trim().toLowerCase()),
    );
    const optimistic: ScheduleTask[] = built.map((b) => {
      const t = byOld.get(b.ID);
      return t ? { ...t, Title: b.Title, StartDate: b.StartDate, DueDate: b.DueDate } : { ...b };
    });
    // Untouched ID<=0 placeholder rows (template stages with no DB row yet)
    // normally stay out of `built`; keep those visible at their original spots
    // so they don't blink out between the save and silent revalidation. A
    // placeholder being assigned dates IS included in `built` and therefore
    // gets promoted into a real PMMTasks row.
    tasks.forEach((t, i) => {
      if (typeof t.ID === "number" && t.ID > 0) return;
      const titleKey = String(t.Title ?? "").trim().toLowerCase();
      if (omittedPlaceholderTitles.has(titleKey)) return;
      if (builtTitles.has(titleKey)) return;
      optimistic.splice(Math.min(i, optimistic.length), 0, t);
    });
    setTasks(optimistic);
    setCachedSection("schedule", ticketId, optimistic);
    onRefresh?.();
  };

  // "Project Length (weeks)" quick-fill: distribute a total number of weeks
  // across all phases, chained back-to-back from the chosen start date.
  const applyProjectLength = async () => {
    if (!lifecycleId) {
      toast({ title: "No lifecycle", description: "Assign a lifecycle before setting the project length.", variant: "destructive" });
      return;
    }
    const weeks = parseFloat(lenWeeks);
    if (isNaN(weeks) || weeks <= 0) {
      toast({ title: "Enter total weeks", description: "Type the total project length in weeks first.", variant: "destructive" });
      return;
    }
    // Project Length explicitly schedules every lifecycle phase. Include
    // lifecycle-only placeholder rows so this bulk action can restore dates
    // after a row was previously removed from PMMTasks.
    const savable = tasks.filter((t) => String(t.Title ?? "").trim().length > 0);
    const isMilestone = (t: ScheduleTask) => isMilestoneTitle(t.Title);
    const phases = savable.filter((t) => !isMilestone(t));
    if (phases.length === 0) {
      toast({ title: "No phases", description: "This schedule has no editable phases to distribute weeks across.", variant: "destructive" });
      return;
    }
    // No inline confirm here — the editable preview popup IS the confirmation
    // step (the user can tweak per-phase weeks there before applying).

    // ── Distribute the total days across phases ──
    const totalDays = Math.max(phases.length, Math.round(weeks * 7));
    const existingDays = phases.map((t) => {
      const s = dayOf(t.StartDate); const e = dayOf(t.DueDate);
      return s && e ? Math.max(0, calcDays(s, e)) : 0;
    });
    const sumExisting = existingDays.reduce((a, b) => a + b, 0);
    // Smart split keeps the current phase proportions (phases without dates
    // get an average share); even split gives every phase the same share.
    // Smart falls back to even when no phase has dates yet.
    const avg = sumExisting > 0 ? sumExisting / existingDays.filter((d) => d > 0).length : 1;
    // "Per phase" mode: every phase gets exactly the entered weeks each.
    // Total is ignored in this mode — the user typed weeks-per-phase.
    let alloc: number[];
    if (lenMode === "per") {
      const perDays = Math.max(1, Math.round(totalDays)); // totalDays = perPhaseWeeks×7
      alloc = phases.map(() => perDays);
    } else {
      const weights = lenMode === "smart" && sumExisting > 0
        ? existingDays.map((d) => (d > 0 ? d : avg))
        : phases.map(() => 1);
      const sumW = weights.reduce((a, b) => a + b, 0);
      alloc = weights.map((w) => Math.max(1, Math.floor((totalDays * w) / sumW)));
      // Rounding remainder goes to the longest phase so the end lands exactly.
      const diff = totalDays - alloc.reduce((a, b) => a + b, 0);
      if (diff !== 0) {
        const longest = alloc.indexOf(Math.max(...alloc));
        alloc[longest] = Math.max(1, alloc[longest] + diff);
      }
      // The min-1-day clamps can leave the sum a hair over the target when the
      // total is tiny vs. the phase count — trim from the largest phases until
      // the end lands exactly (or every phase is at the 1-day floor).
      let excess = alloc.reduce((a, b) => a + b, 0) - totalDays;
      while (excess > 0) {
        const li = alloc.indexOf(Math.max(...alloc));
        if (alloc[li] <= 1) break;
        alloc[li]--; excess--;
      }
    }

    // Build the editable PREVIEW rows and open the popup — nothing is saved
    // until the user confirms there.
    let pi = 0;
    const rows: LenPreviewRow[] = savable.map((t, i) => {
      const milestone = isMilestone(t);
      const cs = dayOf(t.StartDate), ce = dayOf(t.DueDate);
      let curWeeks = "";
      if (!milestone && cs && ce) {
        const days = (new Date(ce).getTime() - new Date(cs).getTime()) / 86400000 + 1;
        curWeeks = String(Math.round((days / 7) * 10) / 10);
      }
      return {
        id: typeof t.ID === "number" ? t.ID : -(i + 1), title: String(t.Title ?? ""), milestone,
        weeksStr: milestone ? "" : String(Math.round((alloc[pi++] / 7) * 10) / 10),
        curStart: cs, curEnd: ce, curWeeks,
      };
    });
    cancelEdit();
    setLenPreview(rows);
  };

  // Chain preview rows back-to-back from the start date (inclusive spans;
  // milestone rows sit on the day after the final phase ends).
  const chainLenPreview = (rows: LenPreviewRow[], startStr: string) => {
    let cursor = startStr;
    return rows.map((r) => {
      if (r.milestone) return { ...r, start: cursor, end: cursor };
      const start = cursor;
      const end = addDaysStr(start, lenPreviewDays(r) - 1);
      cursor = addDaysStr(end, 1);
      return { ...r, start, end };
    });
  };

  const confirmProjectLength = async () => {
    if (!lenPreview) return;
    const startStr = /^\d{4}-\d{2}-\d{2}$/.test(lenStart) ? lenStart : todayLocalStr();
    const chained = chainLenPreview(lenPreview, startStr);
    const byId = new Map(tasks.map((t) => [t.ID, t]));
    const built: ScheduleTask[] = chained.map((r) => {
      const t = byId.get(r.id);
      return {
        ID: r.id, Title: t?.Title ?? r.title, StartDate: r.start, DueDate: r.end,
        Status: t?.Status || "Not Started", PercentComplete: t?.PercentComplete ?? 0,
        ItemOrder: t?.ItemOrder ?? 0, TicketId: ticketId, AssignedTo: t?.AssignedTo || "",
        isSelected: true, StageStep: t?.StageStep ?? t?.ItemOrder ?? 0,
      };
    });
    const phaseCount = chained.filter((r) => !r.milestone).length;
    const totalDays = lenPreview.reduce((a, r) => a + lenPreviewDays(r), 0);
    const totalWeeks = Math.round((totalDays / 7) * 10) / 10;
    // Past-date guard: hold the save until the user confirms the move.
    if (!(await confirmPastDates(built))) return;
    try {
      setApplyingLen(true);
      await persistBuiltTasks(built);
      setLenPreview(null);
      setLenWeeks("");
      toast({ title: "Schedule updated", description: `${totalWeeks} weeks distributed across ${phaseCount} phases starting ${fmtDate(startStr)}.` });
    } catch (e: unknown) {
      toast({ title: "Apply failed", description: e instanceof Error ? e.message : "Could not update the schedule", variant: "destructive" });
    } finally {
      setApplyingLen(false);
    }
  };

  const saveEdit = async () => {
    if (editingIdx === null || !lifecycleId) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editStart) || !/^\d{4}-\d{2}-\d{2}$/.test(editEnd)) {
      toast({ title: "Invalid date", description: "Dates must be in YYYY-MM-DD format.", variant: "destructive" }); return;
    }
    if (new Date(editEnd) < new Date(editStart)) { toast({ title: "Invalid range", description: "End must be on or after start.", variant: "destructive" }); return; }

    // dayOf() (sentinel-aware) — a legacy "1900-*" end date must not produce a
    // ~46,000-day shift that catapults every later phase into garbage dates.
    const tgtOrigEnd = dayOf(tasks[editingIdx]?.DueDate);
    let shiftDays = tgtOrigEnd && editEnd
      ? Math.round((new Date(editEnd).getTime() - new Date(tgtOrigEnd).getTime()) / 86400000) : 0;
    if (!tgtOrigEnd && /^\d{4}-\d{2}-\d{2}$/.test(editEnd)) {
      // Weeks-first fill on a previously blank phase: re-chain later dated
      // phases so the first of them starts the day after the new end, and the
      // rest keep their relative spacing (same slide the normal ripple does).
      for (let i = editingIdx + 1; i < tasks.length; i++) {
        const laterStart = dayOf(tasks[i]?.StartDate);
        if (laterStart) {
          shiftDays = Math.round((new Date(addDaysStr(editEnd, 1)).getTime() - new Date(laterStart).getTime()) / 86400000);
          break;
        }
      }
    }

    const built: ScheduleTask[] = [];
    let builtEditedIdx = -1;
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const hasPersistedRow = typeof t.ID === "number" && t.ID > 0;
      // Lifecycle stages without PMMTasks rows use a non-positive placeholder
      // ID. When the user dates that exact row, include it in the full-replace
      // payload so createScheduleRds creates the missing row instead of saving
      // the other phases and silently dropping this edit.
      if (!hasPersistedRow && i !== editingIdx) continue;
      const origStart = dayOf(t.StartDate);
      const origEnd = dayOf(t.DueDate);
      let start: string; let end: string;
      if (i === editingIdx) { start = editStart; end = editEnd; builtEditedIdx = built.length; }
      else if (i > editingIdx && origStart && origEnd && shiftDays !== 0) {
        start = addDaysStr(origStart, shiftDays); end = addDaysStr(origEnd, shiftDays);
      } else { start = origStart; end = origEnd; }
      built.push({
        ID: typeof t.ID === "number" ? t.ID : -(i + 1), Title: t.Title, StartDate: start, DueDate: end,
        Status: t.Status || "Not Started", PercentComplete: t.PercentComplete ?? 0,
        ItemOrder: t.ItemOrder, TicketId: ticketId, AssignedTo: t.AssignedTo || "",
        isSelected: true, StageStep: t.StageStep ?? t.ItemOrder,
      });
    }

    // Cascade-fill: once a phase gets dates, every LATER phase still blank
    // chains back-to-back after it (start = previous end + 1 day), inheriting
    // the edited phase's span — one edit fills the whole schedule and the
    // user only tweaks the phases that differ. Phases that already have dates
    // keep them (the ripple above shifted them) and the chain continues from
    // their end. Half-dated rows (one of start/end missing — broken data this
    // UI can't produce) are DELIBERATELY re-chained in full, which self-heals
    // them. Milestone rows are glued separately below.
    if (builtEditedIdx >= 0) {
      const spanDays = Math.max(1, calcDays(editStart, editEnd));
      let cursor = dayOf(built[builtEditedIdx].DueDate);
      for (let i = builtEditedIdx + 1; i < built.length; i++) {
        const b = built[i];
        if (isMilestoneTitle(b.Title)) continue;
        const bs = dayOf(b.StartDate); const be = dayOf(b.DueDate);
        if (bs && be) { cursor = be; continue; }
        if (!cursor) break;
        const start = addDaysStr(cursor, 1);
        const end = addDaysStr(start, spanDays);
        b.StartDate = start; b.DueDate = end;
        cursor = end;
      }
    }

    // "Project Complete"-style milestone rows have no edit button — trailing
    // ones are always glued to the day after the last real phase ends, so any
    // edit that moves the final phase drags the milestone along automatically.
    // Only rows AFTER the last real phase are glued: custom lifecycles can
    // legally have mid-schedule "… Complete" stages that must keep their spot.
    let lastPhaseIdx = -1;
    for (let i = built.length - 1; i >= 0; i--) {
      if (!isMilestoneTitle(built[i].Title)) { lastPhaseIdx = i; break; }
    }
    const lastPhaseEnd = lastPhaseIdx >= 0 ? dayOf(built[lastPhaseIdx].DueDate) : "";
    if (lastPhaseEnd) {
      const md = addDaysStr(lastPhaseEnd, 1);
      for (let i = lastPhaseIdx + 1; i < built.length; i++) {
        built[i].StartDate = md; built[i].DueDate = md;
      }
    }

    // Past-date guard: hold the save until the user confirms the move.
    if (!(await confirmPastDates(built))) return;

    try {
      setSaving(true);
      // Optimistic close: persistBuiltTasks POSTs, busts, notifies, then seeds
      // the grid from what was just sent — no blocking refetch (see the helper
      // for the ordering rules). cancelEdit() lands in the same commit.
      await persistBuiltTasks(built);
      cancelEdit();
    } catch (e: unknown) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : "Could not update schedule", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  /* ── Admin-only: inline phase rename + add-phase-row ─────────────────────
     Both write the full schedule via persistBuiltTasks, then mirror the change
     into the assigned lifecycle template (Manage Lifecycles) when one exists.
     Template sync is surgical — rename swaps the one stage name, add inserts
     the new stage at the matching position — so unrelated stages (e.g. the
     OPM-filtered "Project Complete") are never dropped from the template. */
  const syncLifecycleTemplate = (mutate: (stages: string[]) => string[] | null): Promise<boolean> => {
    const run = async (): Promise<boolean> => {
      lifecycleSyncInFlight.current = true;
      try {
        // The list captured when the form opened can be stale after a prior
        // add. Always mutate the freshly-read template inside the queue.
        const freshLifecycles = await reloadLifecycles();
        let lc = freshLifecycles.find((l) => String(l.ID) === String(lifecycleId));
        // A few legacy records point at a template tagged for the opposite
        // module. It is intentionally excluded from that module's picker, but
        // it is still the template that renders this record's schedule and
        // therefore must be editable by phase add/rename/delete actions.
        if (!lc && lifecycleId) {
          bustCache("lifecycles");
          await new Promise<void>((resolve) => setTimeout(resolve, 200));
          const allLifecycles = await getLifecycles().catch(() => [] as LifecycleInfo[]);
          const fallbackLifecycles = (Array.isArray(allLifecycles) ? allLifecycles : []) as LifecycleInfo[];
          lc = fallbackLifecycles
            .find((candidate) => String(candidate.ID) === String(lifecycleId));
        }
        if (!lc) throw new Error("The assigned lifecycle template could not be loaded.");
        const cur = [...(lc.Stages ?? [])]
          .sort((a, b) => (a.StageStep ?? 0) - (b.StageStep ?? 0))
          .map((s) => s.Name);
        const next = mutate(cur);
        if (!next || next.length === 0 || next.join("\u0000") === cur.join("\u0000")) return false;
        await updateLifecycle(lc.ID, { Name: lc.Name, Stages: next });
        await reloadLifecycles();
        return true;
      } catch {
        return false; // template sync is best-effort — the schedule save already landed
      } finally {
        lifecycleSyncInFlight.current = false;
      }
    };
    const queued = lifecycleSyncQueueRef.current.then(run, run);
    lifecycleSyncQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  };

  const startRename = (idx: number) => {
    cancelEdit();
    setRenameIdx(idx);
    setRenameVal(String(tasks[idx]?.Title ?? ""));
  };
  const cancelRename = () => { setRenameIdx(null); setRenameVal(""); };

  const saveRename = async () => {
    if (renameIdx === null || renSaving) return;
    const oldTitle = String(tasks[renameIdx]?.Title ?? "");
    const newTitle = renameVal.trim();
    if (!newTitle || newTitle === oldTitle) { cancelRename(); return; }
    if (!lifecycleId) {
      toast({ title: "No lifecycle", description: "Assign a lifecycle before renaming phases.", variant: "destructive" });
      return;
    }
    if (tasks.some((t, i) => i !== renameIdx && String(t.Title ?? "").trim().toLowerCase() === newTitle.toLowerCase())) {
      toast({ title: "Duplicate name", description: `A phase named "${newTitle}" already exists in this schedule.`, variant: "destructive" });
      return;
    }
    const built: ScheduleTask[] = [];
    tasks.forEach((t, i) => {
      if (!(typeof t.ID === "number" && t.ID > 0)) return;
      built.push({
        ID: t.ID, Title: i === renameIdx ? newTitle : t.Title,
        StartDate: dayOf(t.StartDate), DueDate: dayOf(t.DueDate),
        Status: t.Status || "Not Started", PercentComplete: t.PercentComplete ?? 0,
        ItemOrder: t.ItemOrder, TicketId: ticketId, AssignedTo: t.AssignedTo || "",
        isSelected: true, StageStep: t.StageStep ?? t.ItemOrder,
      });
    });
    try {
      setRenSaving(true);
      await persistBuiltTasks(built);
      // Case-insensitive stage match: placeholder rows (no DB row) rename
      // ONLY through this template path, so a case/whitespace mismatch must
      // not silently no-op the whole rename.
      const oldKey = oldTitle.trim().toLowerCase();
      const tplUpdated = await syncLifecycleTemplate((stages) =>
        stages.some((s) => s.trim().toLowerCase() === oldKey)
          ? stages.map((s) => (s.trim().toLowerCase() === oldKey ? newTitle : s))
          : null);
      toast({
        title: "Phase renamed",
        description: tplUpdated
          ? `"${oldTitle}" is now "${newTitle}" — the lifecycle template was updated too.`
          : `"${oldTitle}" is now "${newTitle}".`,
      });
      cancelRename();
    } catch (e: unknown) {
      toast({ title: "Rename failed", description: e instanceof Error ? e.message : "Could not rename the phase", variant: "destructive" });
    } finally {
      setRenSaving(false);
    }
  };

  const suggestedNewPhaseDates = (weeksValue = newPhaseWeeks) => {
    const wks = Math.max(1, Math.round(parseFloat(weeksValue) || 2));
    const savable = tasks.filter((t) => typeof t.ID === "number" && t.ID > 0);
    let lastPhaseIdx = -1;
    for (let i = savable.length - 1; i >= 0; i--) {
      if (!isMilestoneTitle(savable[i].Title)) { lastPhaseIdx = i; break; }
    }
    const lastEnd = lastPhaseIdx >= 0 ? dayOf(savable[lastPhaseIdx].DueDate) : "";
    const start = lastEnd ? addDaysStr(lastEnd, 1) : todayLocalStr();
    return { start, end: addDaysStr(start, weeksToDays(wks)) };
  };

  const resetNewPhaseForm = () => {
    setAddingPhase(false);
    setNewPhaseName("");
    setNewPhaseStart("");
    setNewPhaseEnd("");
    setNewPhaseWeeks("2");
  };

  const beginAddingPhase = () => {
    if (delSaving) {
      toast({
        title: "Finishing phase deletion",
        description: "Wait for the delete confirmation, then this phase name can be used again.",
      });
      return;
    }
    const dates = suggestedNewPhaseDates();
    setNewPhaseStart(dates.start);
    setNewPhaseEnd(dates.end);
    setAddingPhase(true);
  };

  const handleNewPhaseWeeksChange = (value: string) => {
    setNewPhaseWeeks(value);
    const wks = parseFloat(value);
    if (newPhaseStart && Number.isFinite(wks) && wks > 0) {
      setNewPhaseEnd(addDaysStr(newPhaseStart, weeksToDays(Math.max(1, Math.round(wks)))));
    }
  };

  const handleNewPhaseStartChange = (value: string) => {
    setNewPhaseStart(value);
    const wks = parseFloat(newPhaseWeeks);
    if (value && Number.isFinite(wks) && wks > 0) {
      setNewPhaseEnd(addDaysStr(value, weeksToDays(Math.max(1, Math.round(wks)))));
    }
  };

  const handleNewPhaseEndChange = (value: string) => {
    setNewPhaseEnd(value);
    if (newPhaseStart && value >= newPhaseStart) {
      setNewPhaseWeeks(String(Math.max(1, daysToWeeks(calcDays(newPhaseStart, value)))));
    }
  };

  const addNewPhase = async () => {
    if (addSaving) return;
    if (delSaving) {
      toast({
        title: "Finishing phase deletion",
        description: "Wait for the delete confirmation, then add the phase again with its dates.",
      });
      return;
    }
    const title = newPhaseName.trim();
    if (!title) {
      toast({ title: "Enter a phase name", description: "Type a name for the new phase first.", variant: "destructive" });
      return;
    }
    if (!lifecycleId) {
      toast({ title: "No lifecycle", description: "Assign a lifecycle before adding phases.", variant: "destructive" });
      return;
    }
    if (tasks.some((t) => String(t.Title ?? "").trim().toLowerCase() === title.toLowerCase())) {
      toast({ title: "Duplicate name", description: `A phase named "${title}" already exists in this schedule.`, variant: "destructive" });
      return;
    }
    const wks = Math.max(1, Math.round(parseFloat(newPhaseWeeks) || 2));
    const savable = tasks.filter((t) => typeof t.ID === "number" && t.ID > 0);
    // New phases land after the last real phase, before trailing milestone
    // rows ("Project Complete") which then re-glue to the new end date.
    let lastPhaseIdx = -1;
    for (let i = savable.length - 1; i >= 0; i--) {
      if (!isMilestoneTitle(savable[i].Title)) { lastPhaseIdx = i; break; }
    }
    const suggested = suggestedNewPhaseDates(String(wks));
    const start = newPhaseStart || suggested.start;
    const end = newPhaseEnd || suggested.end;
    if (!start || !end || end < start) {
      toast({ title: "Check the dates", description: "The end date must be on or after the start date.", variant: "destructive" });
      return;
    }
    const cloneRow = (t: ScheduleTask): ScheduleTask => ({
      ID: t.ID, Title: t.Title, StartDate: dayOf(t.StartDate), DueDate: dayOf(t.DueDate),
      Status: t.Status || "Not Started", PercentComplete: t.PercentComplete ?? 0,
      ItemOrder: t.ItemOrder, TicketId: ticketId, AssignedTo: t.AssignedTo || "",
      isSelected: true, StageStep: t.StageStep ?? t.ItemOrder,
    });
    const head = savable.slice(0, lastPhaseIdx + 1).map(cloneRow);
    const md = addDaysStr(end, 1);
    const trailing = savable.slice(lastPhaseIdx + 1).map((t) => ({ ...cloneRow(t), StartDate: md, DueDate: md }));
    const newRow: ScheduleTask = {
      ID: -1, Title: title, StartDate: start, DueDate: end,
      Status: "Not Started", PercentComplete: 0, ItemOrder: 0,
      TicketId: ticketId, AssignedTo: "", isSelected: true, StageStep: 0,
    };
    const built = [...head, newRow, ...trailing].map((t, i) => ({ ...t, ItemOrder: i + 1, StageStep: i + 1 }));
    try {
      setAddSaving(true);
      await persistBuiltTasks(built);
      const prevTitle = lastPhaseIdx >= 0 ? String(savable[lastPhaseIdx].Title ?? "") : "";
      // The record's schedule is already saved, so close the form now. The
      // template propagation can be slow because it updates other records
      // using the lifecycle; it must never keep this form on "Updating…".
      resetNewPhaseForm();
      setAddSaving(false);
      toast({
        title: "Phase added",
        description: `"${title}" added (${wks} wks).`,
      });
      void syncLifecycleTemplate((stages) => {
        if (stages.some((s) => s.trim().toLowerCase() === title.toLowerCase())) return null;
        const next = [...stages];
        const at = prevTitle ? next.indexOf(prevTitle) : -1;
        if (at >= 0) next.splice(at + 1, 0, title);
        else {
          let ins = next.length;
          while (ins > 0 && isMilestoneTitle(next[ins - 1])) ins--;
          next.splice(ins, 0, title);
        }
        return next;
      }).finally(() => {
        // Revalidate only after queued lifecycle propagation, avoiding the
        // older response that caused the final phase to blink in and out.
        void loadTasks(true, { silent: true });
      });
    } catch (e: unknown) {
      toast({ title: "Add failed", description: e instanceof Error ? e.message : "Could not add the phase", variant: "destructive" });
    } finally {
      setAddSaving(false);
    }
  };

  const [delSaving, setDelSaving] = useState(false);
  const clearPhaseDates = async (idx: number) => {
    if (delSaving) return;
    const target = tasks[idx];
    const title = String(target?.Title ?? "Phase");
    if (!target || isMilestoneTitle(title)) return;
    const action = await askPhaseAction(
      `Manage "${title}"`,
      "Choose whether to clear this phase's dates or remove the phase entirely. Removing it also removes the stage from the assigned lifecycle template.",
    );
    if (action === "cancel") return;
    if (action === "delete") {
      await deletePhase(idx);
      return;
    }
    if (typeof target.ID !== "number" || target.ID <= 0) {
      toast({ title: "No dates to clear", description: `"${title}" is not scheduled yet.` });
      return;
    }
    if (!dayOf(target.StartDate) && !dayOf(target.DueDate)) {
      toast({ title: "No dates to clear", description: `"${title}" already has no schedule dates.` });
      return;
    }
    const built: ScheduleTask[] = tasks
      .filter((t) => typeof t.ID === "number" && t.ID > 0)
      .map((t, i) => {
        const isTarget = t.ID === target.ID;
        return {
          ID: t.ID, Title: t.Title,
          StartDate: isTarget ? "" : dayOf(t.StartDate),
          DueDate: isTarget ? "" : dayOf(t.DueDate),
          Status: t.Status || "Not Started", PercentComplete: t.PercentComplete ?? 0,
          ItemOrder: i + 1, TicketId: ticketId, AssignedTo: t.AssignedTo || "",
          isSelected: true, StageStep: i + 1,
        };
      });
    const previousTasks = tasks;
    const immediateTasks = tasks.map((t, i) =>
      i === idx ? { ...t, StartDate: "", DueDate: "" } : t);
    try {
      setDelSaving(true);
      // Clear the dates in the visible row immediately. The server still owns
      // the final result; restore the previous row if the write fails.
      setTasks(immediateTasks);
      setCachedSection("schedule", ticketId, immediateTasks);
      await persistBuiltTasks(built);
      toast({
        title: "Dates cleared",
        description: `"${title}" remains in the schedule; only its dates were removed.`,
      });
    } catch (e: unknown) {
      setTasks(previousTasks);
      setCachedSection("schedule", ticketId, previousTasks);
      toast({ title: "Clear dates failed", description: e instanceof Error ? e.message : "Could not clear the phase dates", variant: "destructive" });
    } finally {
      setDelSaving(false);
    }
  };

  const deletePhase = async (idx: number) => {
    if (delSaving) return;
    const target = tasks[idx];
    const title = String(target?.Title ?? "Phase");
    if (!target || isMilestoneTitle(title)) return;
    const remainingPhases = tasks.filter((t) => !isMilestoneTitle(t.Title));
    if (remainingPhases.length <= 1) {
      toast({ title: "Cannot delete", description: "At least one phase must remain in the schedule.", variant: "destructive" });
      return;
    }
    const built: ScheduleTask[] = tasks
      .filter((t, i) => i !== idx && typeof t.ID === "number" && t.ID > 0)
      .map((t, i) => ({
        ID: t.ID, Title: t.Title,
        StartDate: dayOf(t.StartDate), DueDate: dayOf(t.DueDate),
        Status: t.Status || "Not Started", PercentComplete: t.PercentComplete ?? 0,
        ItemOrder: i + 1, TicketId: ticketId, AssignedTo: t.AssignedTo || "",
        isSelected: true, StageStep: i + 1,
      }));
    const previousTasks = tasks;
    const immediateTasks = tasks.filter((_, i) => i !== idx);
    let scheduleSaved = false;
    try {
      setDelSaving(true);
      // Full phase deletion is optimistic: remove the row as soon as the user
      // confirms. A lifecycle-only placeholder must also be omitted from
      // persistBuiltTasks' normal placeholder re-splice behavior.
      setTasks(immediateTasks);
      setCachedSection("schedule", ticketId, immediateTasks);
      await persistBuiltTasks(built, { omitPlaceholderTitles: [title] });
      scheduleSaved = true;
      // A full deletion is not complete until the lifecycle stage is gone as
      // well. Unlike Add Phase, do not leave this as an unobserved background
      // write: a stale stage is deliberately synthesized back into the grid as
      // a blank row on the next task-data read.
      const lifecycleSynced = !lifecycleId || await syncLifecycleTemplate((stages) => {
        const delKey = title.trim().toLowerCase();
        const next = stages.filter((s) => s.trim().toLowerCase() !== delKey);
        return next.length < stages.length ? next : null;
      });
      // A false result can also mean another writer already removed the stage,
      // so verify the actual merged schedule instead of reporting failure or
      // success from the template call alone.
      bustCache(`project:tasks:${ticketId}`);
      const freshResult = await getTaskData(ticketId, "0", undefined, { fresh: true });
      const freshRaw = Array.isArray(freshResult)
        ? freshResult
        : (freshResult as { Data?: unknown })?.Data ?? (freshResult as { data?: unknown })?.data ?? [];
      const freshTasks = Array.isArray(freshRaw) ? freshRaw as ScheduleTask[] : [];
      const titleKey = title.trim().toLowerCase();
      const phaseStillExists = freshTasks.some((t) => String(t.Title ?? "").trim().toLowerCase() === titleKey);
      setTasks(freshTasks);
      setCachedSection("schedule", ticketId, freshTasks);
      if (phaseStillExists) {
        throw new Error(lifecycleSynced
          ? "The lifecycle update completed, but the phase is still present. Please retry."
          : "The schedule row was removed, but its lifecycle stage could not be removed. Please retry.");
      }
      toast({
        title: "Phase deleted",
        description: `"${title}" was removed from this schedule and its lifecycle template.`,
      });
    } catch (e: unknown) {
      if (!scheduleSaved) {
        setTasks(previousTasks);
        setCachedSection("schedule", ticketId, previousTasks);
      } else {
        // The schedule write landed but lifecycle removal failed. Pull the
        // authoritative merged rows so the UI cannot claim the old dated row
        // still exists or falsely claim the phase is fully gone.
        bustCache(`project:tasks:${ticketId}`);
        try {
          const freshResult = await getTaskData(ticketId, "0", undefined, { fresh: true });
          const freshRaw = Array.isArray(freshResult)
            ? freshResult
            : (freshResult as { Data?: unknown })?.Data ?? (freshResult as { data?: unknown })?.data ?? [];
          if (Array.isArray(freshRaw)) {
            setTasks(freshRaw as ScheduleTask[]);
            setCachedSection("schedule", ticketId, freshRaw);
          }
        } catch {
          // Keep the already-honest optimistic state; the next section open
          // performs the ordinary revalidation.
        }
      }
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : "Could not delete the phase", variant: "destructive" });
    } finally {
      setDelSaving(false);
    }
  };

  /* Date summary derived values */
  const sv = (v: unknown): string => (v != null && String(v).trim() && String(v).trim() !== "0001-01-01T00:00:00" ? String(v).trim() : "");
  const rfDates = project.rawFields || {};
  const sumTargetStart = sv(project.targetStart) || sv(rfDates.TargetStartDate);
  const sumTargetEnd = sv(project.targetEnd) || sv(rfDates.TargetCompletionDate);
  const hasScheduleRows = tasks.length > 0;
  let sumActualStart = ""; let sumActualEnd = "";
  if (hasScheduleRows) {
    // Min/max on the date-part STRINGS (ISO dates sort lexicographically) —
    // the old getTime() → toISOString() round trip re-interpreted local-parsed
    // dates as UTC instants and shifted the summary row a day for US viewers.
    for (const t of tasks) {
      const s = dayOf(t.StartDate); const e = dayOf(t.DueDate);
      if (s && (!sumActualStart || s < sumActualStart)) sumActualStart = s;
      if (e && (!sumActualEnd || e > sumActualEnd)) sumActualEnd = e;
    }
    if (!sumActualStart) sumActualStart = sv(project.actualStart) || sv(rfDates.ActualStartDate);
    if (!sumActualEnd) sumActualEnd = sv(project.actualEnd) || sv(rfDates.ActualCompletionDate);
  }
  const totalDaysSum = (sumTargetStart && sumTargetEnd) ? calcDays(sumTargetStart.slice(0, 10), sumTargetEnd.slice(0, 10)) : 0;
  // Schedule duration = sum of the phase rows' day spans (same math as the
  // per-row Wks column), so the header always matches the table total and
  // re-renders automatically whenever a phase's weeks change.
  const schedDaysSum = hasScheduleRows
    ? tasks.reduce((a, t) => { const d = calcDays(t.StartDate, t.DueDate); return a + (d > 0 ? d : 0); }, 0)
    : 0;
  const scheduleBuilt = isLcAssigned && !!(sumActualStart || sumActualEnd);
  const activeLc = lifecycles.find((l) => String(l.ID) === (lifecycleId || selectedLcId));
  const activeLcName = activeLc?.Name ?? "";

  const startEditDates = () => {
    setEditingDates(true);
    setDateTargetStart(sumTargetStart ? sumTargetStart.slice(0, 10) : "");
    setDateTargetEnd(sumTargetEnd ? sumTargetEnd.slice(0, 10) : "");
  };
  const cancelEditDates = () => {
    setEditingDates(false);
    setDateTargetStart(""); setDateTargetEnd("");
  };
  const saveDates = async () => {
    if (dateTargetStart && dateTargetEnd && new Date(dateTargetEnd) < new Date(dateTargetStart)) {
      toast({ title: "Invalid range", description: "Target End must be on or after Target Start.", variant: "destructive" }); return;
    }
    try {
      setSavingDates(true);
      const toIso = (d: string) => d ? `${d}T00:00:00` : "0001-01-01T00:00:00";
      // Target dates live on the project record itself, independent of any
      // lifecycle/schedule. Persist them directly via /update-fields so they
      // can be set even when no lifecycle is assigned — the /schedule endpoint
      // requires a ProjectLifecycleID (rejecting no-lifecycle projects) and
      // never wrote the target dates to the record anyway.
      const fields: { FieldName: string; Value: string }[] = [
        { FieldName: "TargetStartDate", Value: toIso(dateTargetStart) },
        { FieldName: "TargetCompletionDate", Value: toIso(dateTargetEnd) },
      ];
      const r = await updateFields(ticketId, fields);
      if (!r.ok) throw new Error(r.error || "Could not update dates");
      cancelEditDates();
      bustCache();
      // Patch the page-level project state IMMEDIATELY with the values we
      // just wrote — the summary card and the Target band above both read
      // from the project prop, and waiting on the background refetch left
      // the pre-save dates on screen (looked like the save didn't work).
      // This also keeps persistBuiltTasks (which echoes project.targetStart
      // back to the server on schedule saves) from reverting the edit.
      onDatesSaved?.(toIso(dateTargetStart), toIso(dateTargetEnd));
      await loadTasks(true);
      notifyScheduleChanged();
      // FULL refresh (fast=false): Target dates are RECORD fields, and the
      // fast post-save path deliberately skips re-fetching record fields.
      // The one-shot fresh flag makes that refetch bypass the serving
      // worker's cache too, so a sibling worker whose bust IPC hasn't
      // landed yet can't hand back the pre-save dates.
      markProjectDetailRefetchFresh();
      onRefresh?.(false);
    } catch (e: unknown) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : "Could not update dates", variant: "destructive" });
    } finally {
      setSavingDates(false);
    }
  };

  const DateSummaryCard = () => (
    <div style={{
      backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10, marginBottom: 12,
      padding: "10px 14px",
      border: editingDates ? "1px solid rgba(107,165,57,0.3)" : "1px solid rgba(255,255,255,0.08)",
    }}>
      {scheduleBuilt && !editingDates ? (
        <button onClick={startEditDates} disabled={!canEdit} style={{
          width: "100%", display: "grid", gridTemplateColumns: "2.4fr 1.8fr 1.8fr 1.4fr", alignItems: "center",
          background: "transparent", border: "none", padding: 0, cursor: canEdit ? "pointer" : "default", color: "inherit",
          textAlign: "left", columnGap: 0,
        }}>
          <div style={{ padding: "0 8px", textAlign: "left", minWidth: 0 }}>
            <div style={{ fontSize: 10, color: Colors.textPrimary, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>Lifecycle</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: Colors.green, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeLcName || "—"}</div>
          </div>
          <div style={{ padding: "0 8px", textAlign: "left" }}>
            <div style={{ fontSize: 10, color: Colors.textPrimary, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>Schedule Start</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: Colors.orange, marginTop: 2 }}>{fmtDate(sumActualStart)}</div>
          </div>
          <div style={{ padding: "0 8px", textAlign: "left" }}>
            <div style={{ fontSize: 10, color: Colors.textPrimary, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>Schedule End</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: Colors.orange, marginTop: 2 }}>{fmtDate(sumActualEnd)}</div>
          </div>
          <div style={{ padding: "0 8px", textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ fontSize: 10, color: Colors.textPrimary, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>Duration</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: Colors.green, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
              <span>{schedDaysSum > 0 ? `${daysToWeeks(schedDaysSum)} wks` : "—"}</span>
              <span style={{ color: "var(--rm-text-faint)", fontSize: 11 }}>🔒</span>
              {canEdit && <Edit2 size={11} color="var(--rm-text-faint)" />}
            </div>
          </div>
        </button>
      ) : !editingDates ? (
        <div>
          <button onClick={startEditDates} disabled={!canEdit} style={{
            width: "100%", display: "grid", gridTemplateColumns: "3fr 2fr 2fr 1fr", alignItems: "center",
            background: "transparent", border: "none", padding: 0, cursor: canEdit ? "pointer" : "default", color: "inherit",
            marginBottom: 0, columnGap: 0,
          }}>
            <div style={{ padding: "0 8px" }} />
            <div style={{ padding: "0 8px", textAlign: "left" }}>
              <div style={{ fontSize: 10, color: Colors.textPrimary, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>Target Start</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: Colors.textPrimary, marginTop: 2 }}>{fmtDate(sumTargetStart)}</div>
            </div>
            <div style={{ padding: "0 8px", textAlign: "left" }}>
              <div style={{ fontSize: 10, color: Colors.textPrimary, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>Target End</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: Colors.textPrimary, marginTop: 2 }}>{fmtDate(sumTargetEnd)}</div>
            </div>
            <div style={{ padding: "0 8px", textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <div style={{ fontSize: 10, color: Colors.textPrimary, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>Duration</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: Colors.green, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                <span>{totalDaysSum > 0 ? `${daysToWeeks(totalDaysSum)} wks` : "—"}</span>
                <Edit2 size={11} color="var(--rm-text-faint)" />
              </div>
            </div>
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: Colors.white }}>{project.module === "OPM" ? "Edit Target Dates" : "Edit Project Dates"}</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <DateField label="Target Start" value={dateTargetStart} onChange={setDateTargetStart} />
            <DateField label="Target End" value={dateTargetEnd} onChange={setDateTargetEnd} />
          </div>
          {isLcAssigned && (sumActualStart || sumActualEnd) && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {sumActualStart ? (
                <div style={{
                  flex: 1, minWidth: 140, display: "flex", alignItems: "center", justifyContent: "space-between",
                  backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px",
                }}>
                  <div>
                    <div style={{ fontSize: 10, color: Colors.textMuted }}>Schedule Start</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: Colors.orange, marginTop: 2 }}>{fmtDate(sumActualStart)}</div>
                  </div>
                  <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 11 }}>🔒</span>
                </div>
              ) : <div style={{ flex: 1, minWidth: 140 }} />}
              {sumActualEnd ? (
                <div style={{
                  flex: 1, minWidth: 140, display: "flex", alignItems: "center", justifyContent: "space-between",
                  backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px",
                }}>
                  <div>
                    <div style={{ fontSize: 10, color: Colors.textMuted }}>Schedule End</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: Colors.orange, marginTop: 2 }}>{fmtDate(sumActualEnd)}</div>
                  </div>
                  <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 11 }}>🔒</span>
                </div>
              ) : <div style={{ flex: 1, minWidth: 140 }} />}
            </div>
          )}
          {dateTargetStart && dateTargetEnd && (
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 500 }}>
              Target Duration: {daysToWeeks(calcDays(dateTargetStart, dateTargetEnd))} weeks
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={cancelEditDates} style={{
              padding: "8px 16px", borderRadius: 8, backgroundColor: "rgba(255,255,255,0.06)",
              color: "rgba(255,255,255,0.6)", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
            }}>Cancel</button>
            <button onClick={saveDates} disabled={savingDates} style={{
              padding: "8px 16px", borderRadius: 8,
              backgroundColor: savingDates ? "rgba(107,165,57,0.3)" : Colors.green,
              color: "#FFF", border: "none", cursor: savingDates ? "default" : "pointer",
              fontSize: 12, fontWeight: 700,
            }}>{savingDates ? "Saving…" : "Save Dates"}</button>
          </div>
        </div>
      )}
    </div>
  );

  // Shared in-app confirm dialog (replaces browser confirm()). Rendered in every
  // SchedulePhases return path so askConfirm()'s promise always has a dialog to
  // resolve it — assignment is triggered from the no-schedule branch below.
  const confirmDialogEl = (
    <AlertDialog
      open={!!confirmDialog}
      onOpenChange={(o) => {
        if (!o && confirmDialog) { confirmDialog.resolve(false); setConfirmDialog(null); }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmDialog?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirmDialog?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => { confirmDialog?.resolve(false); setConfirmDialog(null); }}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => { confirmDialog?.resolve(true); setConfirmDialog(null); }}>
            {confirmDialog?.confirmLabel ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  const phaseActionDialogEl = (
    <AlertDialog
      open={!!phaseActionDialog}
      onOpenChange={(open) => { if (!open) resolvePhaseAction("cancel"); }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{phaseActionDialog?.title}</AlertDialogTitle>
          <AlertDialogDescription>{phaseActionDialog?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => resolvePhaseAction("cancel")}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => resolvePhaseAction("clear")}
            style={{ backgroundColor: Colors.green, color: "#FFF" }}
          >
            Clear dates
          </AlertDialogAction>
          <AlertDialogAction
            onClick={() => resolvePhaseAction("delete")}
            style={{ backgroundColor: "#DC2626", color: "#FFF" }}
          >
            Delete phase
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 24, gap: 8 }}>
        <Spinner color={Colors.green} />
        <span style={{ color: Colors.textMuted, fontSize: 12 }}>Loading schedule…</span>
      </div>
    );
  }

  /* ── Task fetch timed out / failed — offer a retry, never guess ── */
  if (loadFailed && tasks.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 24, gap: 10 }}>
        <span style={{ color: Colors.textMuted, fontSize: 12 }}>
          The schedule is taking longer than expected to load.
        </span>
        <button
          onClick={() => { setLoadFailed(false); void loadTasks(true); }}
          style={{
            padding: "8px 16px", borderRadius: 8, backgroundColor: Colors.green,
            color: "#FFF", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700,
          }}
        >Try Again</button>
      </div>
    );
  }

  /* ── No-schedule state with optional lifecycle picker ── */
  if (!isLcAssigned && tasks.length === 0) {
    return (
      <div style={{ padding: 4 }}>
        <DateSummaryCard />
        {!isLcAssigned ? (
          <div style={{
            padding: "12px 14px", borderRadius: 12,
            backgroundColor: "rgba(232,119,34,0.07)", border: "1px solid rgba(232,119,34,0.22)",
            marginBottom: 12,
          }}>
            {/* Header row: icon + label + manage link */}
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: lifecycles.length > 0 ? 10 : 0 }}>
              <AlertCircle size={13} color={Colors.orange} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: Colors.orange, flex: 1 }}>
                No lifecycle assigned
              </span>
              {canEdit && (
                <button onClick={() => setShowManageLc(true)} style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  color: Colors.textMuted, fontSize: 11, fontWeight: 600,
                  display: "flex", alignItems: "center", gap: 4, padding: "2px 4px",
                }}>
                  <Plus size={11} /> {lifecycles.length > 0 ? "Manage" : "Create lifecycle"}
                </button>
              )}
            </div>
            {/* Rules attach to schedule phases. With no lifecycle there is
                nothing to configure and no schedule rules are active. */}
            {isAdmin && (
              <div style={{ fontSize: 11, color: Colors.textMuted, lineHeight: 1.5, marginTop: 6, marginBottom: lifecycles.length > 0 ? 10 : 0 }}>
                Schedule rules are inactive until a lifecycle is assigned. Each phase row will then show a “Set rules” button for this record.
              </div>
            )}
            {/* Dropdown then Assign button below */}
            {lifecycles.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <LifecyclePickerModal
                  lifecycles={lifecycles}
                  selectedId={selectedLcId}
                  onSelect={setSelectedLcId}
                  hideLabel
                />
                <button
                  onClick={() => handleAssignLifecycle()}
                  disabled={assigning || !selectedLcId || !canEdit}
                  style={{
                    width: "100%", height: 42, borderRadius: 10,
                    backgroundColor: assigning || !selectedLcId || !canEdit ? "rgba(107,165,57,0.4)" : Colors.green,
                    color: "#FFF", fontSize: 13, fontWeight: 700, border: "none",
                    cursor: assigning || !selectedLcId || !canEdit ? "default" : "pointer",
                  }}
                >
                  {assigning ? "Assigning…" : "Assign"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: Colors.textMuted, textAlign: "center", padding: 12 }}>
            No tasks in current schedule.
          </div>
        )}

        {showManageLc && (
          <ManageLifecyclesModal lifecycles={lifecycles} canEdit={canEdit} module={lcModule}
            onClose={() => setShowManageLc(false)} onSaved={() => { void reloadLifecycles(); }} />
        )}
        {confirmDialogEl}
        {phaseActionDialogEl}
      </div>
    );
  }

  const BORDER_COLOR = "rgba(255,255,255,0.22)";
  const GRID_BORDER = "1px solid var(--rm-panel-border)";
  const PHASE_COLORS = [Colors.green, ACCENT_BLUE, ACCENT_PURPLE, Colors.orange, ACCENT_TEAL, ACCENT_PINK, ACCENT_AMBER, "#F87171", "#818CF8", "#34D399", "#FB923C"];

  const headerCellStyle: React.CSSProperties = { fontSize: 10, color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 800 };

  return (
    <div style={{ marginTop: 4 }}>
      {/* Past-date confirmation — the save that triggered it is held until
          the user answers; Cancel leaves the schedule untouched. */}
      {pastConfirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: Z.POPUP_CHILD, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 22, width: 440, maxWidth: "92vw", boxShadow: "0 12px 40px rgba(0,0,0,0.35)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <AlertTriangle size={18} color="#d97706" />
              <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Move schedule into the past?</div>
            </div>
            <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.5, marginBottom: 16 }}>
              You&apos;re setting dates before today for: <b>{pastConfirm.msg}</b>.
              Nothing is saved yet — the schedule only changes after you confirm.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button"
                onClick={() => { pastConfirm.resolve(false); setPastConfirm(null); }}
                style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
              <button type="button"
                onClick={() => { pastConfirm.resolve(true); setPastConfirm(null); }}
                style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#d97706", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                Yes, move to past
              </button>
            </div>
          </div>
        </div>
      )}
      {!canEdit && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", marginBottom: 8,
          backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 8, border: `1px solid ${BORDER_COLOR}`,
          fontSize: 11, color: Colors.textMuted, fontWeight: 600,
        }}>
          <Lock size={11} color={Colors.textMuted} /> View only
        </div>
      )}
      <DateSummaryCard />

      {canEdit && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <button
              onClick={lockLcChange ? undefined : () => setShowChangeLc((v) => !v)}
              disabled={lockLcChange}
              title={lockLcChange ? "Remove team allocations before switching the lifecycle — changing it would rebuild the phase schedule under existing hours." : undefined}
              style={{
                padding: "7px 12px", borderRadius: 9,
                border: `1px solid ${lockLcChange ? "rgba(255,255,255,0.08)" : showChangeLc ? Colors.green : "rgba(255,255,255,0.14)"}`,
                backgroundColor: lockLcChange ? "transparent" : showChangeLc ? "rgba(107,165,57,0.12)" : "transparent",
                color: lockLcChange ? Colors.textMuted : showChangeLc ? Colors.green : Colors.textSecondary,
                fontSize: 12, fontWeight: 700, cursor: lockLcChange ? "not-allowed" : "pointer",
                display: "inline-flex", alignItems: "center", gap: 6, opacity: lockLcChange ? 0.5 : 1,
              }}>
              <Layers size={14} /> Change lifecycle
            </button>
            {!showChangeLc && (
              <button onClick={() => setShowManageLc(true)} style={{
                padding: "7px 14px", borderRadius: 9,
                border: "1px solid rgba(107,165,57,0.45)",
                backgroundColor: "rgba(107,165,57,0.18)",
                color: Colors.green, fontSize: 12, fontWeight: 700, cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}>
                <Layers size={14} /> Manage lifecycles
              </button>
            )}
          </div>
          {/* Context: which template is active and who it applies to */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 10.5, color: Colors.textMuted }}>
            {lifecycleId && lifecycles.length > 0 && (() => {
              const cur = lifecycles.find((l) => String(l.ID) === lifecycleId);
              return cur ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Layers size={10} color={Colors.textMuted} />
                  <span style={{ fontWeight: 600 }}>Template:</span> {cur.Name}
                </span>
              ) : null;
            })()}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontWeight: 600 }}>Applies to:</span>
              All {module === "OPM" ? "opportunity" : "project"} users
            </span>
          </div>
        </div>
      )}
      {/* "Change lifecycle" opens the full library picker directly — no intermediate wrapper */}
      {canEdit && !lockLcChange && showChangeLc && (
        <LifecyclePickerModal
          lifecycles={lifecycles}
          selectedId={selectedLcId}
          onSelect={setSelectedLcId}
          forceOpen
          onClose={() => setShowChangeLc(false)}
          onApply={(id) => { setSelectedLcId(id); handleAssignLifecycle(id); }}
          module={lcModule}
        />
      )}
      {showManageLc && (
        <ManageLifecyclesModal lifecycles={lifecycles} canEdit={canEdit} module={lcModule}
          onClose={() => setShowManageLc(false)} onSaved={() => { void reloadLifecycles(); }} />
      )}

      {canEdit && tasks.some((t) => typeof t.ID === "number" && t.ID > 0) && (
        <div style={{
          marginBottom: 12, padding: "12px 14px", borderRadius: 10,
          border: "1px solid rgba(107,165,57,0.25)", backgroundColor: "rgba(107,165,57,0.05)",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: Colors.textMuted, letterSpacing: 0.5, marginBottom: 10 }}>
            PHASE LENGTH
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", justifyContent: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 100 }}>
              <span style={{ color: Colors.textMuted, fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}>
                {lenMode === "per" ? "WKS / PHASE" : "TOTAL WEEKS"}
              </span>
              <input
                type="number" min={1} value={lenWeeks} placeholder={lenMode === "per" ? "—" : "—"}
                onChange={(e) => setLenWeeks(e.target.value)}
                style={{
                  backgroundColor: "var(--rm-panel-soft)", borderRadius: 10, color: "var(--rm-text)",
                  padding: "9px 10px", fontSize: 14, fontWeight: 700, textAlign: "center",
                  border: "0.5px solid var(--rm-panel-border)", width: "100%", height: 40, boxSizing: "border-box",
                }}
              />
            </div>
            {/* Fixed-width wrapper — DateField is flex:1 and would otherwise
                stretch across the whole panel. */}
            <div style={{ width: 170, display: "flex" }}>
              <DateField
                label="Start From"
                value={lenStart}
                onChange={(v) => { lenStartTouched.current = true; setLenStart(v); }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ color: Colors.textMuted, fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}>SPLIT</span>
              <div style={{
                display: "flex", gap: 3, padding: 3, height: 40, boxSizing: "border-box",
                borderRadius: 10, backgroundColor: "var(--rm-panel-soft)",
                border: "0.5px solid var(--rm-panel-border)", alignItems: "stretch",
              }}>
                {([["smart", "Keep proportions"], ["even", "Split evenly"], ["per", "Per phase"]] as const).map(([mode, label]) => (
                  <button key={mode} onClick={() => setLenMode(mode)} style={{
                    padding: "0 12px", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer",
                    borderRadius: 8, transition: "background-color 120ms, color 120ms",
                    backgroundColor: lenMode === mode ? Colors.green : "transparent",
                    color: lenMode === mode ? "#FFF" : Colors.textSecondary,
                    whiteSpace: "nowrap",
                  }}>{label}</button>
                ))}
              </div>
            </div>
            <button
              onClick={applyProjectLength}
              disabled={applyingLen || !lenWeeks}
              style={{
                height: 40, padding: "0 22px", borderRadius: 10,
                backgroundColor: applyingLen || !lenWeeks ? "rgba(107,165,57,0.35)" : Colors.green,
                color: "#FFF", border: "none", fontSize: 13, fontWeight: 700,
                cursor: applyingLen || !lenWeeks ? "default" : "pointer",
                boxShadow: applyingLen || !lenWeeks ? "none" : "0 1px 3px rgba(107,165,57,0.4)",
              }}
            >Preview &amp; apply</button>
          </div>
          <div style={{ fontSize: 11, color: Colors.textMuted, marginTop: 8, textAlign: "center" }}>
            {lenMode === "per"
              ? "Every phase gets exactly the weeks you enter. Total duration = weeks × number of phases."
              : "Distributes the total across all phases back-to-back from the start date." +
                (lenMode === "smart" ? " Phases keep their current proportions (or split evenly when blank)." : " Every phase gets an equal share.")}
            {" "}You'll see a Preview before anything is saved.
          </div>
        </div>
      )}

      {/* Project Length preview popup — shows the resulting dates before
          saving; each phase's weeks can still be tweaked here. */}
      {lenPreview && (() => {
        const pvStart = /^\d{4}-\d{2}-\d{2}$/.test(lenStart) ? lenStart : todayLocalStr();
        const pvRows = chainLenPreview(lenPreview, pvStart);
        const pvTotalDays = lenPreview.reduce((a, r) => a + lenPreviewDays(r), 0);
        const pvTotalWeeks = Math.round((pvTotalDays / 7) * 10) / 10;
        const pvEnd = pvRows.length ? pvRows[pvRows.length - 1].end : pvStart;
        const th: React.CSSProperties = {
          padding: "8px 10px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5,
          color: Colors.textMuted, textAlign: "left", borderBottom: `1px solid ${Colors.border}`,
        };
        const td: React.CSSProperties = { padding: "9px 10px", borderBottom: `1px solid ${Colors.border}` };
        return (
          <div
            onClick={(e) => { if (e.target === e.currentTarget && !applyingLen) setLenPreview(null); }}
            style={{
              position: "fixed", inset: 0, zIndex: Z.MODAL_TOAST, backgroundColor: "rgba(0,0,0,0.55)",
              backdropFilter: "blur(3px)",
              display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px",
            }}
          >
            <div style={{
              width: "min(620px, calc(100vw - 32px))", maxHeight: "84vh", overflowY: "auto",
              backgroundColor: "var(--rm-panel, #1a1f1a)", borderRadius: 16,
              border: `1px solid ${Colors.border}`, padding: 20,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: Colors.white }}>Preview new schedule</span>
                <button
                  onClick={() => !applyingLen && setLenPreview(null)}
                  style={{ background: "none", border: "none", color: Colors.textMuted, fontSize: 17, cursor: "pointer", padding: 2, lineHeight: 1 }}
                >✕</button>
              </div>
              <div style={{ fontSize: 12, color: Colors.textSecondary, marginBottom: 14 }}>
                {lenMode === "per"
                  ? `${parseFloat(lenWeeks) || 0} wks/phase from ${fmtDate(pvStart)} · each phase gets the same allocation.`
                  : `${pvTotalWeeks} weeks from ${fmtDate(pvStart)} · ${lenMode === "smart" ? "keeping proportions" : "split evenly"}.`}
                 Adjust any phase's weeks below — dates re-chain instantly. Nothing is saved until you click Apply.
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={th}>PHASE</th>
                    <th style={th}>CURRENT</th>
                    <th style={th}>NEW</th>
                    <th style={{ ...th, textAlign: "right" }}>WKS</th>
                  </tr>
                </thead>
                <tbody>
                  {pvRows.map((r, i) => (
                    <tr key={`${r.id}-${i}`}>
                      <td style={{ ...td, fontWeight: 700, color: Colors.white }}>{r.title || `Phase ${i + 1}`}</td>
                      <td style={{ ...td, color: Colors.textMuted, fontSize: 12 }}>
                        {r.curStart && r.curEnd ? (
                          <span>
                            {fmtDate(r.curStart)} – {fmtDate(r.curEnd)}
                            {r.curWeeks ? (
                              <span style={{
                                marginLeft: 6, fontSize: 11, fontWeight: 700,
                                color: Colors.textSecondary, whiteSpace: "nowrap",
                              }}>
                                ({r.curWeeks} wks)
                              </span>
                            ) : null}
                          </span>
                        ) : "—"}
                      </td>
                      <td style={{ ...td, color: Colors.green, fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap" }}>
                        {r.milestone ? fmtDate(r.end) : `${fmtDate(r.start)} – ${fmtDate(r.end)}`}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {r.milestone ? (
                          <span style={{ color: Colors.textMuted }}>—</span>
                        ) : (
                          <input
                            type="number" min={0.2} step={0.5}
                            value={r.weeksStr}
                            onChange={(e) => {
                              const v = e.target.value;
                              setLenPreview((prev) => prev
                                ? prev.map((row, ri) => (ri === i ? { ...row, weeksStr: v } : row))
                                : prev);
                            }}
                            style={{
                              width: 62, textAlign: "center", padding: "6px 4px", fontSize: 13, fontWeight: 700,
                              backgroundColor: "var(--rm-panel-soft)", color: "var(--rm-text)",
                              border: "0.5px solid var(--rm-panel-border)", borderRadius: 8,
                            }}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: Colors.textSecondary }}>
                  Total <b style={{ color: Colors.white }}>{pvTotalWeeks} wks</b> · Ends <b style={{ color: Colors.white }}>{fmtDate(pvEnd)}</b>
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => setLenPreview(null)}
                    disabled={applyingLen}
                    style={{
                      padding: "9px 16px", borderRadius: 10, background: "transparent",
                      border: `1px solid ${Colors.border}`, color: Colors.textSecondary,
                      fontSize: 13, fontWeight: 700, cursor: applyingLen ? "default" : "pointer",
                    }}
                  >Cancel</button>
                  <button
                    onClick={confirmProjectLength}
                    disabled={applyingLen}
                    style={{
                      padding: "9px 18px", borderRadius: 10, border: "none",
                      backgroundColor: applyingLen ? "rgba(107,165,57,0.35)" : Colors.green,
                      color: "#FFF", fontSize: 13, fontWeight: 700,
                      cursor: applyingLen ? "default" : "pointer",
                    }}
                  >{applyingLen ? "Applying…" : "Apply"}</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}


      <div style={{ borderRadius: 10, overflow: "hidden", border: GRID_BORDER }}>
        <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr 2fr 1fr 110px", backgroundColor: "var(--rm-panel-soft)" }}>
          <div style={{ padding: "9px 12px", borderRight: GRID_BORDER, borderBottom: GRID_BORDER, ...headerCellStyle }}>Phase</div>
          <div style={{ padding: "9px 12px", borderRight: GRID_BORDER, borderBottom: GRID_BORDER, ...headerCellStyle }}>Start</div>
          <div style={{ padding: "9px 12px", borderRight: GRID_BORDER, borderBottom: GRID_BORDER, ...headerCellStyle }}>End</div>
          <div style={{ padding: "9px 12px", borderRight: GRID_BORDER, borderBottom: GRID_BORDER, textAlign: "right", ...headerCellStyle }}>Wks</div>
          <div style={{ padding: "9px 12px", borderBottom: GRID_BORDER, ...headerCellStyle }}>Rules</div>
        </div>
        {tasks.map((task, idx) => {
          const isEditing = editingIdx === idx;
          const days = calcDays(task.StartDate, task.DueDate);
          const color = PHASE_COLORS[idx % PHASE_COLORS.length];
          const isProjectComplete = String(task.Title ?? "").trim().toLowerCase().includes("complete");
          const rowBg = isEditing ? "rgba(107,165,57,0.06)" : idx % 2 === 0 ? "var(--rm-panel)" : "var(--rm-panel-soft)";
          const isRenaming = renameIdx === idx;

          if (isRenaming) {
            return (
              <div key={task.ID ?? idx} style={{
                display: "grid", gridTemplateColumns: "3fr 2fr 2fr 1fr 110px",
                backgroundColor: "rgba(107,165,57,0.06)",
                borderBottom: idx < tasks.length - 1 ? GRID_BORDER : "none",
              }}>
                <div style={{ padding: "6px 8px 6px 12px", borderRight: GRID_BORDER, display: "flex", alignItems: "center", gap: 7 }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: 4, backgroundColor: color + "22", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    border: `1px solid ${color}55`,
                  }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color }}>{idx + 1}</span>
                  </div>
                  <input
                    autoFocus
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveRename(); else if (e.key === "Escape") cancelRename(); }}
                    placeholder="Phase name"
                    style={{
                      flex: 1, minWidth: 0, padding: "6px 8px", borderRadius: 6,
                      border: "1px solid rgba(107,165,57,0.55)", backgroundColor: "var(--rm-panel-soft)",
                      fontSize: 12, fontWeight: 600, color: "var(--rm-text)", outline: "none",
                    }}
                  />
                  <button
                    onClick={saveRename}
                    disabled={renSaving}
                    title="Save name"
                    style={{
                      width: 24, height: 24, borderRadius: 5, border: "1px solid rgba(107,165,57,0.45)",
                      backgroundColor: "rgba(107,165,57,0.15)", cursor: renSaving ? "default" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
                      flexShrink: 0, opacity: renSaving ? 0.6 : 1,
                    }}>
                    <Check size={14} color={Colors.green} />
                  </button>
                  <button
                    onClick={cancelRename}
                    disabled={renSaving}
                    title="Cancel"
                    style={{
                      width: 24, height: 24, borderRadius: 5, border: "1px solid var(--rm-panel-border)",
                      backgroundColor: "transparent", cursor: "pointer", padding: 0, flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                    <X size={14} color={Colors.textSecondary} />
                  </button>
                </div>
                <div style={{ padding: "10px 12px", borderRight: GRID_BORDER, fontSize: 12, fontWeight: 500, color: Colors.textSecondary }}>
                  {fmtDate(task.StartDate)}
                </div>
                <div style={{ padding: "10px 12px", borderRight: GRID_BORDER, fontSize: 12, fontWeight: 500, color: Colors.textSecondary }}>
                  {fmtDate(task.DueDate)}
                </div>
                <div style={{ padding: "10px 12px", borderRight: GRID_BORDER }} />
                <div style={{ padding: "10px 12px" }} />
              </div>
            );
          }

          return (
            <div key={task.ID ?? idx}>
              {/* Outer wrapper: grid that spans ALL 5 columns */}
              <div style={{
                display: "grid", gridTemplateColumns: "3fr 2fr 2fr 1fr 110px",
                backgroundColor: isEditing ? "rgba(107,165,57,0.04)" : rowBg,
                borderBottom: idx < tasks.length - 1 ? GRID_BORDER : "none",
                borderTop: isEditing ? `1px solid rgba(107,165,57,0.25)` : "none",
              }}>
                {isEditing ? (
                  /* ── Inline edit mode: inputs replace text cells ── */
                  <>
                    {/* Col 1: phase name (read-only while editing) */}
                    <div style={{ padding: "8px 12px", borderRight: GRID_BORDER, display: "flex", alignItems: "center", gap: 7 }}>
                      <div style={{
                        width: 20, height: 20, borderRadius: 4, backgroundColor: color + "22", flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        border: `1px solid ${color}55`,
                      }}>
                        <span style={{ fontSize: 9, fontWeight: 800, color }}>{idx + 1}</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: Colors.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{task.Title}</span>
                    </div>
                    {/* Col 2: start date input */}
                    <div style={{ padding: "6px 8px", borderRight: GRID_BORDER, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: Colors.textMuted, letterSpacing: 0.4 }}>START DATE</span>
                      <AppDateField
                        value={editStart}
                        onChange={handleEditStartChange}
                        style={{
                          backgroundColor: "var(--rm-panel-soft)", borderRadius: 6,
                          color: "var(--rm-text)", padding: "5px 7px",
                          fontSize: 12, fontWeight: 600,
                          border: "1px solid var(--rm-panel-border)", width: "100%",
                        }}
                      />
                    </div>
                    {/* Col 3: end date input */}
                    <div style={{ padding: "6px 8px", borderRight: GRID_BORDER, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: Colors.textMuted, letterSpacing: 0.4 }}>END DATE</span>
                      <AppDateField
                        value={editEnd}
                        onChange={handleEditEndChange}
                        style={{
                          backgroundColor: "var(--rm-panel-soft)", borderRadius: 6,
                          color: "var(--rm-text)", padding: "5px 7px",
                          fontSize: 12, fontWeight: 600,
                          border: "1px solid var(--rm-panel-border)", width: "100%",
                        }}
                      />
                    </div>
                    {/* Col 4: weeks compact spinner */}
                    <div style={{ padding: "6px 8px", borderRight: GRID_BORDER, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: Colors.textMuted, letterSpacing: 0.4 }}>WKS</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                        <button
                          type="button"
                          onClick={() => { const w = Math.max(1, (parseInt(editWeeks) || 1) - 1); handleEditWeeksChange(String(w)); }}
                          style={{ width: 20, height: 24, borderRadius: 4, border: "1px solid var(--rm-panel-border)", background: "var(--rm-panel-soft)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Minus size={11} color={Colors.textSecondary} />
                        </button>
                        <input
                          type="number"
                          value={editWeeks}
                          onChange={(e) => handleEditWeeksChange(e.target.value)}
                          style={{
                            flex: 1, minWidth: 0, width: 0,
                            backgroundColor: "var(--rm-panel-soft)", borderRadius: 4,
                            color: "var(--rm-text)", padding: "4px 2px",
                            fontSize: 12, fontWeight: 700, textAlign: "center",
                            border: "1px solid var(--rm-panel-border)",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => { const w = (parseInt(editWeeks) || 0) + 1; handleEditWeeksChange(String(w)); }}
                          style={{ width: 20, height: 24, borderRadius: 4, border: "1px solid var(--rm-panel-border)", background: "var(--rm-panel-soft)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Plus size={11} color={Colors.textSecondary} />
                        </button>
                      </div>
                    </div>
                    {/* Col 5: Save / Cancel icons */}
                    <div style={{ padding: "6px 8px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        title="Cancel"
                        style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--rm-panel-border)", background: "var(--rm-panel-soft)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <X size={14} color={Colors.textSecondary} />
                      </button>
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={saving}
                        title="Save"
                        style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: saving ? "rgba(107,165,57,0.4)" : Colors.green, cursor: saving ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {saving ? <Loader2 size={13} color="#fff" style={{ animation: "spin 1s linear infinite" }} /> : <Check size={14} color="#fff" />}
                      </button>
                    </div>
                  </>
                ) : (
                  /* ── Normal display mode ── */
                  <>
                    <button
                      onClick={() => { if (isProjectComplete || !canEdit) return; startEdit(idx); }}
                      disabled={isProjectComplete || !canEdit}
                      style={{
                        display: "contents",
                        color: "inherit", cursor: (isProjectComplete || !canEdit) ? "default" : "pointer",
                        padding: 0, opacity: isProjectComplete ? 0.85 : 1, textAlign: "left",
                        background: "none", border: "none",
                      }}>
                      <div style={{ padding: "10px 12px", borderRight: GRID_BORDER, display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{
                          width: 20, height: 20, borderRadius: 4, backgroundColor: color + "22", flexShrink: 0,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          border: `1px solid ${color}55`,
                        }}>
                          <span style={{ fontSize: 9, fontWeight: 800, color }}>{idx + 1}</span>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: Colors.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{task.Title}</span>
                      </div>
                      <div style={{ padding: "10px 12px", borderRight: GRID_BORDER, fontSize: 12, fontWeight: 500, color: Colors.textSecondary }}>
                        {fmtDate(task.StartDate)}
                      </div>
                      <div style={{ padding: "10px 12px", borderRight: GRID_BORDER, fontSize: 12, fontWeight: 500, color: Colors.textSecondary }}>
                        {fmtDate(task.DueDate)}
                      </div>
                      <div style={{ padding: "10px 12px", borderRight: GRID_BORDER, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color, whiteSpace: "nowrap" }}>
                          {formatDuration(days, !isProjectComplete && dayOf(task.StartDate) === dayOf(task.DueDate) && !!dayOf(task.StartDate))}
                        </span>
                        {!isProjectComplete && canEdit && (
                          <span style={{
                            width: 22, height: 22, borderRadius: 4, flexShrink: 0,
                            backgroundColor: "rgba(107,165,57,0.10)",
                            border: `1px solid rgba(107,165,57,0.35)`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            <Edit2 size={13} color={Colors.green} />
                          </span>
                        )}
                      </div>
                    </button>
                    {/* Column 5: admin-only rules + Edit-data phase management */}
                    <div style={{ padding: "6px 10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {(isAdmin || (canEdit && !isProjectComplete && !isMilestoneTitle(task.Title))) && (() => {
                        const phaseName = String(task.Title ?? "");
                        const n = ruleCountFn?.(lcModule, phaseName) ?? 0;
                        return (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                            {isAdmin && (
                              <button
                                type="button"
                                title={`Set rules for "${phaseName}" — this project only (admin)`}
                                onClick={() => openPhaseRules(phaseName)}
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                  padding: "4px 3px", cursor: "pointer",
                                  fontSize: 11.5, fontWeight: 600,
                                  border: "none", background: "none",
                                  color: "hsl(var(--primary))",
                                  whiteSpace: "nowrap",
                                  textDecoration: "none",
                                }}
                                onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")}
                                onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}
                              >
                                Set rules{n > 0 && (
                                  <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "ui-monospace,monospace",
                                    padding: "1px 5px", borderRadius: 9, background: "rgba(107,165,57,0.18)", color: Colors.green }}>
                                    {n}
                                  </span>
                                )}
                              </button>
                            )}
                            {canEdit && !isProjectComplete && !isMilestoneTitle(task.Title) && (
                              <button
                                type="button"
                                title={`Manage "${phaseName}"`}
                                aria-label={`Manage ${phaseName}`}
                                disabled={delSaving}
                                onClick={() => { void clearPhaseDates(idx); }}
                                style={{
                                  width: 24, height: 24, flexShrink: 0, padding: 0, borderRadius: 5,
                                  border: "1px solid rgba(248,113,113,0.4)", background: "rgba(248,113,113,0.08)",
                                  color: "#F87171", cursor: delSaving ? "default" : "pointer",
                                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                                  opacity: delSaving ? 0.5 : 1,
                                }}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {canEdit && tasks.length > 0 && (
          addingPhase ? (
            <div style={{
              display: "grid", gridTemplateColumns: "3fr 2fr 2fr 1fr 110px",
              borderTop: GRID_BORDER, backgroundColor: "rgba(107,165,57,0.05)",
            }}>
              {(() => {
                const newPhaseNumber = tasks.filter((t) => !isMilestoneTitle(t.Title)).length + 1;
                const newPhaseColor = PHASE_COLORS[(newPhaseNumber - 1) % PHASE_COLORS.length];
                return (
                  <div style={{ padding: "7px 12px", borderRight: GRID_BORDER, display: "flex", alignItems: "center", gap: 7 }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: 4, backgroundColor: newPhaseColor + "22", flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      border: `1px solid ${newPhaseColor}55`,
                    }}>
                      <span style={{ fontSize: 9, fontWeight: 800, color: newPhaseColor }}>{newPhaseNumber}</span>
                    </div>
                    <input
                      autoFocus
                      value={newPhaseName}
                      onChange={(e) => setNewPhaseName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") addNewPhase(); else if (e.key === "Escape") resetNewPhaseForm(); }}
                      placeholder="New phase name"
                      aria-label="New phase name"
                      style={{
                        width: "100%", minWidth: 0, padding: "7px 9px", borderRadius: 6,
                        border: "1px solid rgba(107,165,57,0.55)", backgroundColor: "var(--rm-panel-soft)",
                        fontSize: 12, fontWeight: 600, color: "var(--rm-text)", outline: "none",
                      }}
                    />
                  </div>
                );
              })()}
              <div style={{ padding: "7px 8px", borderRight: GRID_BORDER, display: "flex", alignItems: "center" }}>
                <AppDateField
                  value={newPhaseStart}
                  onChange={handleNewPhaseStartChange}
                  aria-label="New phase start date"
                  style={{
                    width: "100%", backgroundColor: "var(--rm-panel-soft)", borderRadius: 6,
                    color: "var(--rm-text)", padding: "6px 7px", fontSize: 12, fontWeight: 600,
                    border: "1px solid var(--rm-panel-border)",
                  }}
                />
              </div>
              <div style={{ padding: "7px 8px", borderRight: GRID_BORDER, display: "flex", alignItems: "center" }}>
                <AppDateField
                  value={newPhaseEnd}
                  onChange={handleNewPhaseEndChange}
                  aria-label="New phase end date"
                  style={{
                    width: "100%", backgroundColor: "var(--rm-panel-soft)", borderRadius: 6,
                    color: "var(--rm-text)", padding: "6px 7px", fontSize: 12, fontWeight: 600,
                    border: "1px solid var(--rm-panel-border)",
                  }}
                />
              </div>
              <div style={{ padding: "7px 8px", borderRight: GRID_BORDER, display: "flex", alignItems: "center" }}>
                <input
                  type="number"
                  min={1}
                  value={newPhaseWeeks}
                  onChange={(e) => handleNewPhaseWeeksChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addNewPhase(); else if (e.key === "Escape") resetNewPhaseForm(); }}
                  title="Length in weeks"
                  aria-label="New phase length in weeks"
                  style={{
                    width: "100%", minWidth: 0, padding: "7px 5px", borderRadius: 6, textAlign: "center",
                    border: "1px solid var(--rm-panel-border)", backgroundColor: "var(--rm-panel-soft)",
                    fontSize: 12, fontWeight: 700, color: "var(--rm-text)", outline: "none",
                  }}
                />
              </div>
              <div style={{ padding: "7px 8px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <button onClick={addNewPhase} disabled={!!addSaving || delSaving} style={{
                  padding: "7px 10px", borderRadius: 7, border: "none",
                  backgroundColor: (addSaving || delSaving) ? "rgba(107,165,57,0.4)" : Colors.green,
                  color: "#FFF", fontSize: 12, fontWeight: 700, cursor: (addSaving || delSaving) ? "default" : "pointer",
                }}>{delSaving ? "Deleting…" : addSaving ? "Saving…" : "Add"}</button>
                <button onClick={resetNewPhaseForm} disabled={!!addSaving} title="Cancel" aria-label="Cancel adding phase" style={{
                  width: 28, height: 28, borderRadius: 7, border: "1px solid var(--rm-panel-border)",
                  backgroundColor: "transparent", color: Colors.textSecondary, cursor: addSaving ? "default" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
                }}><X size={14} /></button>
              </div>
            </div>
          ) : (
            <button
              onClick={beginAddingPhase}
              disabled={delSaving}
              title={delSaving ? "Finishing phase deletion" : "Add phase"}
              style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              padding: "9px 12px", borderTop: GRID_BORDER, borderLeft: "none", borderRight: "none", borderBottom: "none",
              backgroundColor: "var(--rm-panel-soft)", color: Colors.green, fontSize: 12, fontWeight: 700,
              cursor: delSaving ? "default" : "pointer", opacity: delSaving ? 0.65 : 1,
            }}>
              {delSaving ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Plus size={14} />}
              {delSaving ? "Finishing deletion…" : "Add phase"}
            </button>
          )
        )}
      </div>

      {String(module ?? "").toUpperCase() === "OPM" && (
        <div style={{ fontSize: 10.5, color: Colors.textMuted, margin: "6px 2px 0" }}>
          Ending stages (like Lost or cancelled) never appear on this timeline — they're set with the finish buttons on the opportunity itself.
        </div>
      )}

      {/* Per-record "Set rules" drawer — forks the company stage rules for
          THIS project only (ScheduleStageRulesHost record mode). */}
      {isAdmin && (
        <ScheduleStageRulesHost
          recordId={ticketId}
          recordLabel={project?.name || ticketId}
          open={ruleTarget}
          onOpenChange={setRuleTarget}
          onCountsChange={handleRuleCounts}
        />
      )}

      {confirmDialogEl}
      {phaseActionDialogEl}
    </div>
  );
}

function todayLocalStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function iconBtnStyle(): React.CSSProperties {
  return {
    width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.1)",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0, border: "none", cursor: "pointer",
  };
}

/* "Project Length" preview popup row: weeksStr is the user-editable weeks
   value (free text so typing doesn't fight the computed display). */
type LenPreviewRow = { id: number; title: string; milestone: boolean; weeksStr: string; curStart: string; curEnd: string; curWeeks: string };
const lenPreviewDays = (r: LenPreviewRow): number => {
  if (r.milestone) return 0;
  const w = parseFloat(r.weeksStr);
  return isNaN(w) || w <= 0 ? 1 : Math.max(1, Math.round(w * 7));
};
const isMilestoneTitle = (title: unknown) => String(title ?? "").trim().toLowerCase().includes("complete");

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ flex: 1, minWidth: 140, display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ color: Colors.textMuted, fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}>{label.toUpperCase()}</span>
      <AppDateField
        value={value}
        onChange={onChange}
        style={{
          backgroundColor: "var(--rm-panel-soft)", borderRadius: 10, color: "var(--rm-text)",
          padding: 10, fontSize: 14, fontWeight: 600,
          border: "0.5px solid var(--rm-panel-border)",
        }}
      />
    </div>
  );
}

/* ──────────────── BusinessUnitsSection ──────────────── */
function transformBizDivisions(raw: unknown): DivisionBudget[] {
  const items = Array.isArray(raw) ? raw : (raw as { Data?: unknown })?.Data ?? (raw as { data?: unknown })?.data ?? [];
  if (!Array.isArray(items)) return [];
  return (items as Record<string, unknown>[]).map((d) => ({
    divisionKey: String(d.DivisionKey || d.DivisionIDLookup || ""),
    divisionName: String(d.DivisionShortName || d.DivisionName || "—"),
    type: String(d.Type || (d.IsPrimary ? "Primary" : "Supporting")),
    contractValue: Number(d.ContractValue || 0),
    pmName: String(d.ProjectManagerUser || d.ProjectManager || ""),
    execName: String(d.ExecutiveUser || ""),
    contactOverride: String(d.ContactName || ""),
    blName: String(d.BusinessLeadUser || d.BusinessLead || ""),
    preconLead: String(d.PreconLeadUser || d.PreconLead || ""),
  }));
}

/** Seniority tier for the "All staff" list: top executives first, then
 *  descending through the org to regular roles, untitled staff last. */
function seniorityRank(title: string): number {
  const t = title.trim().toLowerCase();
  if (!t || t === "staff") return 6; // no title / onboarding placeholder
  if (/(^|\W)(ceo|cfo|coo|cto|cio|cmo)(\W|$)|chief|president|chairman|founder|owner|managing director|managing principal/.test(t)) return 0;
  if (/vice president|(^|\W)vp(\W|$)|executive/.test(t)) return 1;
  if (/director|principal|head of/.test(t)) return 2;
  if (/manager|supervisor|lead(\W|$)/.test(t)) return 3;
  if (/senior|(^|\W)sr(\W|$)/.test(t)) return 4;
  return 5;
}

/** Person picker dropdown for the BU table: search bar, "On this team"
 *  (from the project's allocations) first, then "All staff" ordered by
 *  seniority (executives at the top, regular roles below). Fixed-position
 *  so it can't be clipped by the table's horizontal scroll container. */
function PersonPickerDropdown({ allocations, value, onSelect, onClose, anchor }: {
  allocations: Allocation[];
  value: string;
  onSelect: (name: string) => void;
  onClose: () => void;
  anchor: { top: number; left: number };
}) {
  const [q, setQ] = useState("");
  const [staff, setStaff] = useState<{ id: string; name: string; title: string }[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    getUserList()
      .then((rows) => {
        if (!alive || !Array.isArray(rows)) return;
        const seen = new Set<string>();
        const ppl: { id: string; name: string; title: string }[] = [];
        for (const u of rows as Record<string, unknown>[]) {
          const uid = String(u.Id ?? "").toLowerCase();
          const name = String(u.Name ?? "").trim();
          if (!uid || !name || u.Deleted === true) continue;
          if (/^[0-9a-f]{8}-/i.test(name)) continue; // GUID-as-name import artifacts
          if (seen.has(uid)) continue;
          seen.add(uid);
          // Two staff can legitimately share a display name → list keys use id.
          ppl.push({ id: uid, name, title: String(u.JobProfile ?? "").trim() });
        }
        // Executives first, then down the org chart; alphabetical within a tier.
        ppl.sort((a, b) => {
          const ra = seniorityRank(a.title), rb = seniorityRank(b.title);
          return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
        });
        setStaff(ppl);
      })
      .catch(() => { /* section shows team-only list */ })
      .finally(() => { if (alive) setLoadingStaff(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // The popup is anchored at fixed coordinates captured on open — if the
    // page scrolls underneath it, it would float detached from its cell and
    // feel "stuck". Close it instead (scrolls INSIDE the list are fine).
    // Brief grace period so the autoFocus scroll-into-view on open (if any)
    // can never self-close the popup the instant it appears.
    const openedAt = Date.now();
    const onScroll = (e: Event) => {
      if (Date.now() - openedAt < 300) return;
      if (boxRef.current && e.target instanceof Node && boxRef.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const team = useMemo(() => {
    const byName = new Map<string, { name: string; role: string; hours: number }>();
    for (const a of allocations) {
      const nm = (a.name || "").trim();
      if (!nm || /^[0-9a-f]{8}-/i.test(nm)) continue;
      const cur = byName.get(nm.toLowerCase());
      if (cur) cur.hours += a.eacHrs || 0;
      else byName.set(nm.toLowerCase(), { name: nm, role: a.role || a.title || "", hours: a.eacHrs || 0 });
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allocations]);

  const qq = q.trim().toLowerCase();
  const teamF = qq ? team.filter((p) => p.name.toLowerCase().includes(qq)) : team;
  const teamNames = new Set(team.map((p) => p.name.toLowerCase()));
  const staffF = staff.filter((p) => !teamNames.has(p.name.toLowerCase()) && (!qq || p.name.toLowerCase().includes(qq)));

  // Keep the popup on-screen (it opens near the bottom of tall tables).
  const maxH = 320;
  const top = Math.min(anchor.top, Math.max(8, window.innerHeight - maxH - 8));
  const left = Math.min(anchor.left, Math.max(8, window.innerWidth - 288));

  const rowBtn: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
    padding: "9px 10px", borderRadius: 8, border: "none", cursor: "pointer",
    backgroundColor: "transparent", color: "var(--rm-text)",
  };
  const sectionLbl: React.CSSProperties = {
    fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.8,
    color: "var(--rm-text)", padding: "8px 10px 2px",
  };

  return createPortal(
    <div ref={boxRef} style={{
      position: "fixed", top, left, zIndex: Z.DRAWER, width: 280, maxHeight: maxH,
      display: "flex", flexDirection: "column",
      backgroundColor: "var(--rm-panel)", border: "0.5px solid var(--rm-panel-border)",
      borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.45)", overflow: "hidden",
    }}>
      <div style={{ padding: 8, borderBottom: "0.5px solid var(--rm-panel-border)" }}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // Enter picks the top match — type a few letters, hit Enter, done.
            if (e.key !== "Enter") return;
            const first = teamF[0]?.name ?? staffF[0]?.name;
            if (first) onSelect(first);
          }}
          placeholder="Search people… (Enter picks top match)"
          style={{
            width: "100%", boxSizing: "border-box", background: "var(--rm-panel-soft)",
            border: "0.5px solid var(--rm-panel-border)", borderRadius: 8,
            padding: "7px 10px", fontSize: 12, color: "var(--rm-text)", outline: "none",
          }}
        />
      </div>
      <div style={{ overflowY: "auto", padding: 4 }}>
        {value && (
          <button type="button" style={{ ...rowBtn, color: "rgba(248,113,113,0.9)" }} onClick={() => onSelect("")}>
            <X size={13} /> <span style={{ fontSize: 12, fontWeight: 600 }}>Clear ({value})</span>
          </button>
        )}
        {teamF.length > 0 && <div style={sectionLbl}>On this team</div>}
        {teamF.map((p) => (
          <button key={`t:${p.name}`} type="button" style={rowBtn} onClick={() => onSelect(p.name)}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(107,165,57,0.12)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
              <span style={{ display: "block", fontSize: 10.5, color: Colors.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.role || "Team member"}{p.hours > 0 ? ` · ${Math.round(p.hours)}h` : ""}
              </span>
            </span>
          </button>
        ))}
        <div style={sectionLbl}>All staff</div>
        {loadingStaff ? (
          <div style={{ padding: "8px 10px", fontSize: 12, color: Colors.textMuted }}>Loading…</div>
        ) : staffF.length === 0 ? (
          <div style={{ padding: "8px 10px", fontSize: 12, color: Colors.textMuted }}>No matches</div>
        ) : staffF.map((p) => (
          <button key={`s:${p.id}`} type="button" style={rowBtn} onClick={() => onSelect(p.name)}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(107,165,57,0.12)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
              {p.title && <span style={{ display: "block", fontSize: 10.5, color: Colors.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export function BusinessUnitsSection({ ticketId, canEdit = false, allocations = [], buFallback = "", contactName = "", pmFallback = "", contractValueFallback = 0, forecastFallback = 0, dateMode = "target", startDate = "", endDate = "", cvLockNote = "" }: {
  ticketId: string; canEdit?: boolean; allocations?: Allocation[]; buFallback?: string;
  /** #124: lock/layout note when the record's EFFECTIVE contract-value column
   *  is locked by stage rules — the Primary row's value writes the record
   *  field (ApproxContractValue, which may resolve to ContractValue on
   *  tenants without the Approx column), so its cell greys to match the
   *  server's enforcement. Supporting rows (JSON-stored) stay editable. */
  cvLockNote?: string;
  /** Key Client Contact from the record (same for every BU row). */
  contactName?: string;
  /** Project-level PM (Key Personnel) used when the BU row has no own PM. */
  pmFallback?: string;
  /** Record ContractValue — shown on the Primary row when the BU carries no own value. */
  contractValueFallback?: number;
  /** Record ForecastedProjectCost — shown (marked as forecast) on the Primary row when no contract value exists at all. */
  forecastFallback?: number;
  /** "actual" when a phase schedule exists (schedule-derived, read-only rule) else "target". */
  dateMode?: "actual" | "target";
  startDate?: string;
  endDate?: string;
}) {
  // Consult the pre-warm cache first — populated on project page mount —
  // so the section opens INSTANTLY when the data is already in memory.
  const cached = getCachedSection("biz", ticketId);
  const [divisions, setDivisions] = useState<DivisionBudget[]>(() =>
    cached ? transformBizDivisions(cached) : []
  );
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState("");
  // BU inline editor state.
  const [allDivs, setAllDivs] = useState<{ id: string; name: string }[]>([]);
  // "+ Add Row" inline editor (BU dropdown + optional PM / Executive / value).
  const [adding, setAdding] = useState(false);
  const [addDivId, setAddDivId] = useState("");
  const [addPm, setAddPm] = useState("");
  const [addExec, setAddExec] = useState("");
  const [addCv, setAddCv] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [newBuName, setNewBuName] = useState("");
  const [creatingBu, setCreatingBu] = useState(false);
  // Click-to-edit cells. personPick anchors the shared PersonPickerDropdown;
  // target "row" saves the pick immediately, target "add" fills the add-row form.
  const [personPick, setPersonPick] = useState<{ target: "row" | "add"; key: string; field: "pm" | "exec" | "contact"; top: number; left: number; value: string } | null>(null);
  const [editCell, setEditCell] = useState<{ key: string; field: "cv" } | null>(null);
  const [editVal, setEditVal] = useState("");
  const cancelEditRef = useRef(false);
  // divisionKey currently saving/removing (dims that row); "" = idle.
  const [rowBusy, setRowBusy] = useState("");
  const [confirmDel, setConfirmDel] = useState("");
  // divisionKey whose BU-name cell is showing the change-BU dropdown; "" = none.
  const [buEdit, setBuEdit] = useState("");
  // Staged (not yet applied) BU pick inside that dropdown — saved only when
  // the user clicks the ✓ button, so a mis-click never fires a write.
  const [buEditVal, setBuEditVal] = useState("");
  // A pre-save request can still be in flight when add/remove forces a fresh
  // read. Only the newest request may update this section, otherwise the older
  // response can visually resurrect a business unit that was just removed.
  const loadSeqRef = useRef(0);

  const load = useCallback(async (force = false) => {
    const requestSeq = ++loadSeqRef.current;
    // Cache hit → render instantly. A FRESH hit (fetched this session) is
    // trusted as-is; a persisted SEED (previous session) is shown but then
    // silently revalidated below so the numbers can't stay stale.
    let seededHit = false;
    if (!force) {
      const hit = getCachedSection("biz", ticketId);
      if (hit) {
        setDivisions(transformBizDivisions(hit)); setLoading(false); setError("");
        if (!isSectionSeeded("biz", ticketId)) return;
        seededHit = true;
      }
    }
    if (!seededHit) { setLoading(true); setError(""); setDivisions([]); }
    try {
      // force (post-save reload) → bypass BOTH the client _cache and the
      // server's per-worker cache, so the just-saved BU list is what renders.
      const raw = await getProjectDivisionRoles(ticketId, force ? { fresh: true } : undefined);
      if (requestSeq !== loadSeqRef.current) return;
      setCachedSection("biz", ticketId, raw);
      setDivisions(transformBizDivisions(raw));
    } catch (e: unknown) {
      if (requestSeq !== loadSeqRef.current) return;
      // A failed silent revalidation keeps showing the seed — never
      // replace rendered data with an error banner.
      if (!seededHit) setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (requestSeq === loadSeqRef.current && !seededHit) setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => { void load(); }, [load]);

  // Record→record nav reuses this component instance (route never remounts
  // ProjectDetail), and division ids are tenant-global — an editor/picker left
  // open on project A could otherwise attach to a matching row on project B
  // and save against the wrong record. Reset all transient editor state.
  useEffect(() => {
    setAdding(false); setEditCell(null); setPersonPick(null);
    setConfirmDel(""); setSaveErr(""); setRowBusy(""); setBuEdit(""); setBuEditVal("");
    cancelEditRef.current = false;
  }, [ticketId]);

  // Live-update when the add-member flow appends a BU via the "Different
  // Business Unit" popup: apply the event's fresh rows directly (no second
  // fetch); if the popup's background refetch failed, force-reload instead.
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { ticketId?: string; rows?: unknown } | undefined;
      if (!d?.ticketId || d.ticketId !== ticketId) return;
      if (Array.isArray(d.rows)) {
        setDivisions(transformBizDivisions(d.rows));
        setLoading(false); setError("");
      } else {
        void load(true);
      }
    };
    window.addEventListener("rmone:projectBuChanged", handler);
    return () => window.removeEventListener("rmone:projectBuChanged", handler);
  }, [ticketId, load]);

  // Shared tenant BU-list loader (used by "+ Add Row" and the row pencil).
  const [divsLoading, setDivsLoading] = useState(false);
  const loadDivs = useCallback(async () => {
    if (allDivs.length > 0) return;
    setDivsLoading(true);
    try {
      const raw = await getDivisions();
      const rows = (Array.isArray(raw) ? raw : (raw as { data?: unknown })?.data ?? []) as Record<string, unknown>[];
      const list = rows
        .map((d) => ({ id: String(d.ID ?? d.Id ?? "").trim(), name: String(d.ShortName ?? d.Title ?? "").trim() }))
        .filter((d) => d.id && d.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      // Only set when non-empty: writing a fresh [] reference would recreate
      // loadDivs → re-run the prefetch effect → refetch forever on a tenant
      // with zero divisions. Empty result keeps the same [] and stays quiet.
      if (list.length > 0) setAllDivs(list);
    } catch { /* leave empty; user sees no options */ }
    finally { setDivsLoading(false); }
  }, [allDivs]);

  // Prefetch the pickers' data the moment the card mounts for an editor, so
  // the change-BU pencil dropdown and person pickers open INSTANTLY instead
  // of showing an empty list while the first on-click fetch is in flight.
  // Both calls hit session-level client caches, so repeat visits are free.
  useEffect(() => {
    if (!canEdit) return;
    void loadDivs();
    void getUserList().catch(() => { /* picker falls back to its own load */ });
  }, [canEdit, loadDivs]);

  const openAdd = useCallback(async () => {
    setAdding(true); setSaveErr("");
    setAddDivId(""); setAddPm(""); setAddExec(""); setAddCv(""); setNewBuName("");
    void loadDivs();
  }, [loadDivs]);

  // Membership writes stay on the record's lookup columns: DivisionLookup =
  // Primary id, DivisionMultiLookup = comma-separated Supporting ids.
  // Only id-keyed rows participate — "name:" fallback / Team rows have no id.
  const idRowsOf = (rows: DivisionBudget[]) =>
    rows.filter((x) => x.divisionKey && !x.divisionKey.startsWith("name:"));

  const saveAddRow = useCallback(async () => {
    if (!addDivId || saving) return;
    setSaving(true); setSaveErr("");
    try {
      const idRows = idRowsOf(divisions);
      if (idRows.some((x) => x.divisionKey === addDivId)) throw new Error("That business unit is already on the project");
      const curPrimary = idRows.find((x) => x.type === "Primary")?.divisionKey ?? "";
      const curSupporting = idRows.filter((x) => x.type !== "Primary").map((x) => x.divisionKey);
      const fields = curPrimary
        ? [{ FieldName: "DivisionLookup", Value: curPrimary },
           { FieldName: "DivisionMultiLookup", Value: [...curSupporting, addDivId].join(",") }]
        : [{ FieldName: "DivisionLookup", Value: addDivId },
           { FieldName: "DivisionMultiLookup", Value: curSupporting.join(",") }];
      const r = await updateFields(ticketId, fields);
      if (!r.ok) throw new Error(r.error || "Could not add the business unit");
      const patch: { pm?: string; exec?: string; contractValue?: number } = {};
      if (addPm) patch.pm = addPm;
      if (addExec) patch.exec = addExec;
      const cvRaw = addCv.replace(/[$,\s]/g, "");
      if (cvRaw !== "") {
        const num = Number(cvRaw);
        if (!Number.isFinite(num) || num < 0) throw new Error("Contract value must be a non-negative number");
        patch.contractValue = num;
      }
      if (Object.keys(patch).length > 0) {
        const rr = await updateProjectDivisionRoles(ticketId, addDivId, patch);
        if (!rr.ok) throw new Error(rr.error || "Business unit added, but its details could not be saved");
      }
      setAdding(false);
      await load(true);
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : "Could not add the business unit");
    } finally {
      setSaving(false);
    }
  }, [addDivId, addPm, addExec, addCv, saving, divisions, ticketId, load]);

  const removeRow = useCallback(async (d: DivisionBudget) => {
    if (rowBusy || !d.divisionKey || d.divisionKey.startsWith("name:")) return;
    const idRows = idRowsOf(divisions);
    if (idRows.length <= 1) {
      setSaveErr("A project needs at least one business unit — add another before removing this one.");
      setConfirmDel("");
      return;
    }
    setRowBusy(d.divisionKey); setSaveErr("");
    try {
      const curPrimary = idRows.find((x) => x.type === "Primary")?.divisionKey ?? "";
      const curSupporting = idRows.filter((x) => x.type !== "Primary").map((x) => x.divisionKey);
      let fields: { FieldName: string; Value: string }[];
      if (d.divisionKey === curPrimary) {
        // Removing the Primary promotes the first Supporting unit.
        const [next, ...rest] = curSupporting;
        fields = [{ FieldName: "DivisionLookup", Value: next },
                  { FieldName: "DivisionMultiLookup", Value: rest.join(",") }];
      } else {
        fields = [{ FieldName: "DivisionLookup", Value: curPrimary },
                  { FieldName: "DivisionMultiLookup", Value: curSupporting.filter((x) => x !== d.divisionKey).join(",") }];
      }
      const r = await updateFields(ticketId, fields);
      if (!r.ok) throw new Error(r.error || "Could not remove the business unit");
      // Reflect the successful write immediately. If the deleted row was
      // Primary, mirror the server write by promoting the first Supporting
      // row. The forced read below reconciles names/details from DB, while the
      // request generation guard prevents an older response restoring d.
      setDivisions((current) => current
        .filter((row) => row.divisionKey !== d.divisionKey)
        .map((row) => d.divisionKey === curPrimary && row.divisionKey === fields[0]?.Value
          ? { ...row, type: "Primary" }
          : row));
      await load(true);
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : "Could not remove the business unit");
    } finally {
      setRowBusy(""); setConfirmDel("");
    }
  }, [rowBusy, divisions, ticketId, load]);

  // Swap a row's business unit for another tenant BU (pencil → dropdown).
  // Membership write mirrors add/remove: Primary swap rewrites DivisionLookup,
  // Supporting swap replaces the id inside DivisionMultiLookup. The row's own
  // people/value (DivisionRolesJson, keyed by division id) are carried over to
  // the new id so they don't silently vanish.
  // Swap a Supporting BU into the Primary slot (and the old Primary becomes
  // Supporting). Only valid when the row has a real server key.
  const promoteToPrimary = useCallback(async (d: DivisionBudget) => {
    if (!d.divisionKey || d.type === "Primary" || rowBusy) return;
    const idRows = idRowsOf(divisions);
    const curPrimary = idRows.find((x) => x.type === "Primary")?.divisionKey ?? "";
    const curSupporting = idRows.filter((x) => x.type !== "Primary").map((x) => x.divisionKey);
    // New Primary = this BU; new Supporting = old Primary + remaining supporting (minus this BU).
    const newSupporting = [curPrimary, ...curSupporting.filter((x) => x !== d.divisionKey)].filter(Boolean);
    setRowBusy(d.divisionKey); setSaveErr("");
    try {
      const r = await updateFields(ticketId, [
        { FieldName: "DivisionLookup", Value: d.divisionKey },
        { FieldName: "DivisionMultiLookup", Value: newSupporting.join(",") },
      ]);
      if (!r.ok) throw new Error(r.error || "Could not change the Primary business unit");
      await load(true);
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : "Could not change the Primary business unit");
    } finally {
      setRowBusy("");
    }
  }, [rowBusy, divisions, ticketId, load]);

  const changeBu = useCallback(async (d: DivisionBudget, newId: string) => {
    setBuEdit("");
    if (!newId || newId === d.divisionKey || rowBusy) return;
    const idRows = idRowsOf(divisions);
    if (idRows.some((x) => x.divisionKey === newId)) {
      setSaveErr("That business unit is already on the project");
      return;
    }
    setRowBusy(d.divisionKey); setSaveErr("");
    try {
      const curPrimary = idRows.find((x) => x.type === "Primary")?.divisionKey ?? "";
      const curSupporting = idRows.filter((x) => x.type !== "Primary").map((x) => x.divisionKey);
      const fields = d.divisionKey === curPrimary
        ? [{ FieldName: "DivisionLookup", Value: newId },
           { FieldName: "DivisionMultiLookup", Value: curSupporting.join(",") }]
        : [{ FieldName: "DivisionLookup", Value: curPrimary },
           { FieldName: "DivisionMultiLookup", Value: curSupporting.map((x) => (x === d.divisionKey ? newId : x)).join(",") }];
      const r = await updateFields(ticketId, fields);
      if (!r.ok) throw new Error(r.error || "Could not change the business unit");
      // Carry over the row's saved details. Primary contract value lives on the
      // record itself (not the per-BU JSON), so it follows automatically.
      // The membership write already landed, so a carry-over failure must NOT
      // skip the reload — otherwise the table would keep showing the old BU.
      const patch: { pm?: string; exec?: string; contact?: string; contractValue?: number } = {};
      if (d.pmName) patch.pm = d.pmName;
      if (d.execName) patch.exec = d.execName;
      if (d.contactOverride) patch.contact = d.contactOverride;
      if (d.type !== "Primary" && d.contractValue > 0) patch.contractValue = d.contractValue;
      if (Object.keys(patch).length > 0) {
        try {
          const rr = await updateProjectDivisionRoles(ticketId, newId, patch);
          if (!rr.ok) throw new Error(rr.error || "carry-over failed");
        } catch {
          setSaveErr("Business unit changed, but its saved details (people/value) could not be carried over — re-add them on the row.");
        }
      }
      await load(true);
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : "Could not change the business unit");
    } finally {
      setRowBusy("");
    }
  }, [rowBusy, divisions, ticketId, load]);

  const saveRoles = useCallback(async (divisionKey: string, patch: { pm?: string; exec?: string; contact?: string; contractValue?: number }) => {
    setRowBusy(divisionKey); setSaveErr("");
    try {
      const r = await updateProjectDivisionRoles(ticketId, divisionKey, patch);
      if (!r.ok) throw new Error(r.error || "Could not save the change");
      await load(true);
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : "Could not save the change");
    } finally {
      setRowBusy("");
    }
  }, [ticketId, load]);

  const commitCell = useCallback(async (d: DivisionBudget) => {
    const cell = editCell;
    setEditCell(null);
    if (!cell || cell.key !== d.divisionKey) return;
    const raw = editVal.trim().replace(/[$,\s]/g, "");
    if (raw === "") return; // blank = no change (clearing a value is not meaningful here)
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) { setSaveErr("Contract value must be a non-negative number"); return; }
    const curCv = d.contractValue > 0 ? d.contractValue : (d.type === "Primary" ? contractValueFallback : 0);
    if (num === curCv) return;
    await saveRoles(d.divisionKey, { contractValue: num });
  }, [editCell, editVal, saveRoles, contractValueFallback]);

  const createBu = useCallback(async () => {
    const name = newBuName.trim();
    if (!name || creatingBu) return;
    setCreatingBu(true); setSaveErr("");
    try {
      const created = await createBusinessUnit(name);
      // Project membership is persisted through DivisionLookup columns. A
      // standalone BusinessUnit ID cannot be written there directly; use the
      // linked mirror/bridge division so the project read path can resolve the
      // new BU immediately and keep the hierarchy relationally valid.
      const bridge = await ensureBridgeDivision(String(created.id), String(created.name || name));
      const entry = { id: String(bridge.id), name: String(created.name || name) };
      setAllDivs((prev) => [...prev, entry].sort((a, b) => a.name.localeCompare(b.name)));
      setAddDivId(entry.id);
      setNewBuName("");
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : "Could not create business unit");
    } finally {
      setCreatingBu(false);
    }
  }, [newBuName, creatingBu]);

  const existingIds = new Set(idRowsOf(divisions).map((x) => x.divisionKey));
  const hasPrimaryId = idRowsOf(divisions).some((x) => x.type === "Primary");

  const fieldInput: React.CSSProperties = {
    background: "var(--rm-panel-soft)", border: "0.5px solid var(--rm-panel-border)",
    borderRadius: 8, padding: "7px 10px", fontSize: 12, color: "var(--rm-text)", outline: "none",
  };

  const addEditor = canEdit && adding ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, marginTop: 8, backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 12 }}>
      <div style={{ fontSize: 11, color: Colors.textMuted, fontWeight: 600 }}>
        {hasPrimaryId
          ? "Add a supporting business unit to this project."
          : "Add a business unit — the first one becomes the Primary unit."}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <select value={addDivId} onChange={(e) => setAddDivId(e.target.value)}
          style={{ ...fieldInput, minWidth: 180, cursor: "pointer" }}>
          <option value="">{allDivs.length === 0 && divsLoading ? "Loading business units…" : "Select business unit…"}</option>
          {allDivs.filter((dv) => !existingIds.has(dv.id)).map((dv) => (
            <option key={dv.id} value={dv.id}>{dv.name}</option>
          ))}
        </select>
        <button type="button"
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPersonPick({ target: "add", key: "", field: "pm", top: r.bottom + 4, left: r.left, value: addPm }); }}
          style={{ ...fieldInput, minWidth: 150, cursor: "pointer", textAlign: "left", color: addPm ? "var(--rm-text)" : Colors.textMuted }}>
          {addPm || "Project Manager…"}
        </button>
        <button type="button"
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPersonPick({ target: "add", key: "", field: "exec", top: r.bottom + 4, left: r.left, value: addExec }); }}
          style={{ ...fieldInput, minWidth: 150, cursor: "pointer", textAlign: "left", color: addExec ? "var(--rm-text)" : Colors.textMuted }}>
          {addExec || "Executive…"}
        </button>
        <input
          value={addCv}
          onChange={(e) => setAddCv(e.target.value)}
          placeholder="Contract value ($)"
          inputMode="decimal"
          style={{ ...fieldInput, width: 140 }}
        />
      </div>
      {/* Inline create-new BU */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          value={newBuName}
          onChange={(e) => setNewBuName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void createBu(); } }}
          placeholder="Or create a new business unit…"
          disabled={creatingBu}
          style={{ ...fieldInput, flex: 1 }}
        />
        <button
          onClick={() => void createBu()}
          disabled={!newBuName.trim() || creatingBu}
          title="Create business unit"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 30, height: 30, borderRadius: 8, border: "none", flexShrink: 0,
            backgroundColor: newBuName.trim() && !creatingBu ? Colors.green : "rgba(107,165,57,0.3)",
            color: "#fff", cursor: newBuName.trim() && !creatingBu ? "pointer" : "default",
          }}
        >
          {creatingBu
            ? <span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid #fff", borderTopColor: "transparent", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
            : <Plus size={14} />}
        </button>
      </div>
      {saveErr && <span style={{ color: "rgba(248,113,113,0.9)", fontSize: 12 }}>{saveErr}</span>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => void saveAddRow()} disabled={!addDivId || saving}
          style={{ flex: 1, backgroundColor: !addDivId || saving ? "rgba(107,165,57,0.4)" : Colors.green, color: "#fff", border: "none", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 700, cursor: !addDivId || saving ? "default" : "pointer" }}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={() => { setAdding(false); setSaveErr(""); }} disabled={saving}
          style={{ backgroundColor: "transparent", color: Colors.textMuted, border: "0.5px solid var(--rm-panel-border)", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </div>
  ) : null;

  const addButton = canEdit && !adding ? (
    <button onClick={() => void openAdd()}
      style={{ marginTop: 8, width: "100%", backgroundColor: "rgba(107,165,57,0.12)", color: Colors.green, border: "0.5px dashed rgba(107,165,57,0.5)", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
      + Add Row
    </button>
  ) : null;

  const personPickEl = personPick ? (
    <PersonPickerDropdown
      allocations={allocations}
      value={personPick.value}
      anchor={{ top: personPick.top, left: personPick.left }}
      onClose={() => setPersonPick(null)}
      onSelect={(name) => {
        const p = personPick;
        setPersonPick(null);
        if (!p) return;
        if (p.target === "add") {
          if (p.field === "pm") setAddPm(name); else setAddExec(name);
        } else {
          void saveRoles(p.key, p.field === "pm" ? { pm: name } : p.field === "exec" ? { exec: name } : { contact: name });
        }
      }}
    />
  ) : null;

  // The explicit project-level BUs (PMM DivisionLookup) are the source of truth.
  // Team member allocations carry their DIVISION name (CompanyDivisions.Title) in
  // `a.bu`, which is not the same as a Business Unit. Only use them as a last-resort
  // fallback when no project-level BUs were loaded at all — otherwise Division names
  // (e.g. "Transportation") would leak into the Business Units section alongside the
  // real primary BU (e.g. "Infrastructure").
  const teamBus: DivisionBudget[] = [];
  if (divisions.length === 0) {
    const seenBu = new Set<string>();
    for (const a of allocations) {
      const bu = (a.bu || "").trim();
      if (!bu || seenBu.has(bu.toLowerCase())) continue;
      seenBu.add(bu.toLowerCase());
      teamBus.push({ divisionKey: "", divisionName: bu, type: "Team", contractValue: 0, pmName: "", execName: "", contactOverride: "", blName: "", preconLead: "" });
    }
  }
  // Last-resort fallback: if the server returned no BU data at all but the
  // project record itself carries a BU text (e.g. CRMBusinessUnitChoice from
  // the import), surface it directly so the section is never blank.
  const fallbackBus: DivisionBudget[] =
    divisions.length === 0 && teamBus.length === 0 && buFallback && !loading
      ? [{ divisionKey: "", divisionName: buFallback, type: "Primary", contractValue: 0, pmName: "", execName: "", contactOverride: "", blName: "", preconLead: "" }]
      : [];
  const merged = divisions.concat(teamBus).concat(fallbackBus);

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: 20 }}><Spinner color={Colors.green} /></div>;
  if (error && merged.length === 0) return (
    <div>
      <div style={{ color: "rgba(248,113,113,0.7)", fontSize: 12, textAlign: "center", padding: 16 }}>{error}</div>
      {addButton}{addEditor}{personPickEl}
    </div>
  );
  if (merged.length === 0) return (
    <div>
      <div style={{ color: Colors.textMuted, fontSize: 12, textAlign: "center", padding: 16 }}>No business units assigned</div>
      {addButton}{addEditor}{personPickEl}
    </div>
  );

  // Date columns are project-level (same on every BU row). The header label
  // makes the source explicit per the app-wide date rule: a phase schedule
  // present → "Schedule" (schedule-derived); no schedule → "Target" (record).
  const dateLbl = dateMode === "actual" ? "Schedule" : "Target";
  const startDisp = startDate ? fmtDate(startDate) : "—";
  const endDisp = endDate ? fmtDate(endDate) : "—";
  const thStyle: React.CSSProperties = {
    textAlign: "left", padding: "8px 10px", fontSize: 10, fontWeight: 700,
    color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5,
    borderBottom: "0.5px solid var(--rm-panel-border)", whiteSpace: "nowrap",
  };
  const tdStyle: React.CSSProperties = {
    padding: "10px 10px", fontSize: 12, color: "var(--rm-text)",
    borderBottom: "0.5px solid var(--rm-panel-border)", whiteSpace: "nowrap",
  };
  // Click-to-edit affordance: dotted underline, inherits the cell's color.
  const cellBtn: React.CSSProperties = {
    background: "transparent", border: "none", padding: 0, font: "inherit",
    color: "inherit", cursor: "pointer",
    textDecoration: "underline dotted rgba(148,163,184,0.55)", textUnderlineOffset: 3,
  };
  const cellInput: React.CSSProperties = {
    background: "var(--rm-panel-soft)", border: "0.5px solid var(--rm-panel-border)",
    borderRadius: 6, padding: "4px 8px", fontSize: 12, color: "var(--rm-text)",
    outline: "none", width: 130,
  };
  const inputKeys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") { cancelEditRef.current = true; e.currentTarget.blur(); }
  };
  const setPlaceholder = <span style={{ color: Colors.textMuted }}>+ Set</span>;

  return (
    <div>
      <div style={{ overflowX: "auto", backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Business Unit</th>
              <th style={thStyle}>Contact</th>
              <th style={thStyle}>Project Manager</th>
              <th style={thStyle}>Executive</th>
              <th style={thStyle}>Contract Value</th>
              <th style={thStyle}>{dateLbl} Start</th>
              <th style={thStyle}>{dateLbl} End</th>
              {canEdit && <th style={{ ...thStyle, width: 36 }} aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {merged.map((d, i) => {
              const isPrimary = d.type === "Primary";
              const cv = d.contractValue > 0 ? d.contractValue : (isPrimary ? contractValueFallback : 0);
              // No contract value anywhere → fall back to the record's Forecasted
              // Project Cost on the Primary row, clearly marked as a forecast.
              const fcv = cv <= 0 && isPrimary && forecastFallback > 0 ? forecastFallback : 0;
              const cvDisp = fcv > 0 ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: Colors.orange, fontWeight: 700 }}>{fmtM(fcv)}</span>
                  <span style={{
                    padding: "1px 6px", borderRadius: 6,
                    backgroundColor: "rgba(232,119,34,0.15)", color: Colors.orange,
                    fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
                  }}>FORECAST</span>
                </span>
              ) : fmtM(cv);
              const pm = d.pmName || pmFallback;
              const contact = d.contactOverride || contactName;
              const isLast = i === merged.length - 1;
              const cellStyle = isLast ? { ...tdStyle, borderBottom: "none" } : tdStyle;
              // Rows without a server key (Team fallback rows) are display-only.
              const editable = canEdit && !!d.divisionKey;
              const busy = !!d.divisionKey && rowBusy === d.divisionKey;
              const canDelete = canEdit && !!d.divisionKey && !d.divisionKey.startsWith("name:");
              const isEditing = (f: "cv") =>
                editable && editCell?.key === d.divisionKey && editCell.field === f;
              return (
                <tr key={i} style={busy ? { opacity: 0.55 } : undefined}>
                  <td style={{ ...cellStyle, borderLeft: `3px solid ${isPrimary ? Colors.green : Colors.orange}` }}>
                    {canDelete && buEdit === d.divisionKey ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <select
                          autoFocus
                          value={buEditVal}
                          onChange={(e) => setBuEditVal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setBuEdit("");
                            if (e.key === "Enter" && buEditVal && buEditVal !== d.divisionKey) void changeBu(d, buEditVal);
                          }}
                          style={{ ...cellInput, width: 180, cursor: "pointer" }}
                        >
                          <option value={d.divisionKey}>{d.divisionName}</option>
                          {allDivs.length === 0 && divsLoading && (
                            <option value="" disabled>Loading business units…</option>
                          )}
                          {allDivs.filter((dv) => dv.id !== d.divisionKey && !existingIds.has(dv.id)).map((dv) => (
                            <option key={dv.id} value={dv.id}>{dv.name}</option>
                          ))}
                        </select>
                        <button type="button" title="Apply change"
                          disabled={busy || !buEditVal || buEditVal === d.divisionKey}
                          onClick={() => void changeBu(d, buEditVal)}
                          style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            width: 26, height: 26, borderRadius: 8, border: "none",
                            backgroundColor: (!buEditVal || buEditVal === d.divisionKey) ? "rgba(107,165,57,0.25)" : Colors.green,
                            color: "#fff",
                            cursor: (!buEditVal || buEditVal === d.divisionKey || busy) ? "default" : "pointer",
                          }}>
                          <Check size={15} strokeWidth={3} />
                        </button>
                        <button type="button" title="Cancel" disabled={busy}
                          onClick={() => setBuEdit("")}
                          style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            width: 26, height: 26, borderRadius: 8,
                            border: "0.5px solid var(--rm-panel-border)", backgroundColor: "transparent",
                            color: Colors.textMuted, cursor: busy ? "default" : "pointer",
                          }}>
                          <X size={14} />
                        </button>
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{d.divisionName}</span>
                        {canDelete && !isPrimary ? (
                          <button
                            type="button"
                            title="Make this the Primary BU"
                            disabled={busy}
                            onClick={() => { setSaveErr(""); void promoteToPrimary(d); }}
                            style={{
                              padding: "2px 8px", borderRadius: 8,
                              backgroundColor: "rgba(232,119,34,0.15)",
                              color: Colors.orange,
                              fontSize: 10, fontWeight: 700,
                              border: "none", cursor: "pointer",
                              transition: "background 0.15s",
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(232,119,34,0.35)"; (e.currentTarget as HTMLButtonElement).textContent = "↑ Make Primary"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(232,119,34,0.15)"; (e.currentTarget as HTMLButtonElement).textContent = d.type || "Supporting"; }}
                          >{d.type || "Supporting"}</button>
                        ) : (
                          <span style={{
                            padding: "2px 8px", borderRadius: 8,
                            backgroundColor: isPrimary ? "rgba(107,165,57,0.15)" : "rgba(232,119,34,0.15)",
                            color: isPrimary ? Colors.green : Colors.orange,
                            fontSize: 10, fontWeight: 700,
                          }}>{d.type || "Supporting"}</span>
                        )}
                        {canDelete && (
                          <button type="button" title="Change business unit" disabled={busy}
                            onClick={() => { setSaveErr(""); setBuEdit(d.divisionKey); setBuEditVal(d.divisionKey); void loadDivs(); }}
                            style={{ background: "transparent", border: "none", padding: 2, cursor: "pointer", color: Colors.textMuted, display: "inline-flex", alignItems: "center" }}>
                            <Edit2 size={12} />
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                  <td style={cellStyle}>
                    {editable ? (
                      <button type="button" style={cellBtn} title="Edit contact"
                        onClick={(e) => { setSaveErr(""); const r = e.currentTarget.getBoundingClientRect(); setPersonPick({ target: "row", key: d.divisionKey, field: "contact", top: r.bottom + 4, left: r.left, value: d.contactOverride || "" }); }}>
                        {contact || setPlaceholder}
                      </button>
                    ) : (contact || "—")}
                  </td>
                  <td style={cellStyle}>
                    {editable ? (
                      <button type="button" style={cellBtn} title="Edit project manager"
                        onClick={(e) => { setSaveErr(""); const r = e.currentTarget.getBoundingClientRect(); setPersonPick({ target: "row", key: d.divisionKey, field: "pm", top: r.bottom + 4, left: r.left, value: d.pmName || "" }); }}>
                        {pm || setPlaceholder}
                      </button>
                    ) : (pm || "—")}
                  </td>
                  <td style={cellStyle}>
                    {editable ? (
                      <button type="button" style={cellBtn} title="Edit executive"
                        onClick={(e) => { setSaveErr(""); const r = e.currentTarget.getBoundingClientRect(); setPersonPick({ target: "row", key: d.divisionKey, field: "exec", top: r.bottom + 4, left: r.left, value: d.execName || "" }); }}>
                        {d.execName || setPlaceholder}
                      </button>
                    ) : (d.execName || "—")}
                  </td>
                  <td style={{ ...cellStyle, color: cv > 0 ? Colors.green : "var(--rm-text)", fontWeight: cv > 0 ? 700 : 400 }}>
                    {isPrimary && cvLockNote ? (
                      // #124: the Primary row's value writes the RECORD field —
                      // locked by stage rules, so display matches enforcement.
                      <span title={cvLockNote} aria-label={cvLockNote} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: Colors.textMuted, cursor: "not-allowed" }}>
                        {cvDisp} <LockIcon size={11} />
                      </span>
                    ) : isEditing("cv") ? (
                      <input autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)}
                        inputMode="decimal" onKeyDown={inputKeys}
                        onBlur={() => { if (cancelEditRef.current) { cancelEditRef.current = false; setEditCell(null); return; } void commitCell(d); }}
                        placeholder="$" style={{ ...cellInput, width: 110 }} />
                    ) : editable ? (
                      <button type="button" style={cellBtn} title="Edit contract value"
                        onClick={() => { setSaveErr(""); setEditCell({ key: d.divisionKey, field: "cv" }); setEditVal(cv > 0 ? String(cv) : ""); }}>
                        {cvDisp}
                      </button>
                    ) : cvDisp}
                  </td>
                  <td style={cellStyle}>{startDisp}</td>
                  <td style={cellStyle}>{endDisp}</td>
                  {canEdit && (
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {canDelete && (confirmDel === d.divisionKey ? (
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <button type="button" onClick={() => void removeRow(d)} disabled={busy}
                            style={{ background: "rgba(248,113,113,0.15)", color: "rgba(248,113,113,0.95)", border: "none", borderRadius: 7, padding: "4px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            Remove
                          </button>
                          <button type="button" onClick={() => setConfirmDel("")} disabled={busy}
                            style={{ background: "transparent", color: Colors.textMuted, border: "0.5px solid var(--rm-panel-border)", borderRadius: 7, padding: "4px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button type="button" title="Remove business unit" disabled={busy}
                          onClick={() => { setSaveErr(""); setConfirmDel(d.divisionKey); }}
                          style={{ background: "transparent", border: "none", padding: 4, cursor: "pointer", color: Colors.textMuted }}>
                          <Trash2 size={13} />
                        </button>
                      ))}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {saveErr && !adding && <div style={{ color: "rgba(248,113,113,0.9)", fontSize: 12, marginTop: 8 }}>{saveErr}</div>}
      {addButton}{addEditor}{personPickEl}
    </div>
  );
}

/* ──────────────── BudgetSection ──────────────── */
function transformBillingData(raw: unknown): BillingResource[] {
  if (!raw) return [];
  const items = Array.isArray(raw) ? raw : (raw as { Data?: unknown })?.Data ?? (raw as { data?: unknown })?.data ?? [];
  if (!Array.isArray(items)) return [];
  return (items as Record<string, unknown>[]).map((r) => {
    const billingRate = Number(r.BillingRate || r.Rate || 0);
    const costRate = Number(r.CostRate || r.Cost || 0);
    const hours = Number(r.TotalHours || r.Hours || r.TotalHrs || 0);
    const billingAmt = Number(r.BillingAmount || r.TotalBilling || 0);
    const costAmt = Number(r.CostAmount || r.TotalCost || 0);
    return {
      name: String(r.AssignedToName || r.ResourceName || r.Name || "—"),
      role: String(r.TypeName || r.RoleName || r.SubWorkItem || ""),
      bu: String(r.DivisionName || r.Division || ""),
      billingRate, costRate, hours,
      billingTotal: billingAmt > 0 ? billingAmt : billingRate * hours,
      costTotal: costAmt > 0 ? costAmt : costRate * hours,
    };
  });
}

interface PersonFinancials {
  name: string; role: string; bu: string;
  hours: number; chargeableHours: number; nonChargeableHours: number;
  revenue: number; laborCost: number; jobCost: number; nonJobCost: number; fullCost: number;
  billingRate: number; laborRate: number; costRate: number;
  hasRates: boolean;
}

const fmtCurrency = (v: number) => {
  if (v === 0) return "$0";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};
const fmtHrs = (v: number) => {
  if (v === 0) return "0h";
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K h`;
  return `${v.toFixed(0)}h`;
};

/* Excel-style column layout for the FINANCIALS BY PERSON table:
 * numeric cells get a full-height left border (vertical grid line),
 * right-aligned tabular numerals, and their own padding so the
 * separator spans the entire row height. */
const FIN_GRID_COLS = "minmax(0,1fr) 74px 90px 90px 90px 96px";
const finNumHead: React.CSSProperties = {
  padding: "8px 10px", textAlign: "right",
  borderLeft: "1px solid var(--rm-panel-border)",
  whiteSpace: "nowrap",
};
const finNumCell: React.CSSProperties = {
  padding: "8px 10px", minWidth: 0,
  borderLeft: "1px solid var(--rm-panel-border)",
  display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

export function BudgetSection({ ticketId, projectName = "", contractValue, laborValue = 0, forecastedCost = 0, allocations, allocationsLoading = false }: {
  ticketId: string; projectName?: string; contractValue: number; laborValue?: number; forecastedCost?: number; allocations: Allocation[];
  /** True while the parent's Phase-2 team fetch is still in flight AND no
   *  allocations have arrived yet — lets the empty state wait instead of
   *  flashing "Add team members…" on a project that has a team. */
  allocationsLoading?: boolean;
}) {
  const cached = getCachedSection("budget", ticketId);
  const [billingData, setBillingData] = useState<BillingResource[]>(() =>
    cached ? transformBillingData(cached) : []
  );
  const [loading, setLoading] = useState(!cached);
  // Role rates seed instantly from the persisted per-tenant copy (when one
  // exists) so FINANCIALS BY PERSON renders without a network wait; the mount
  // effect always fetches and silently reconciles. ratesLoading is true only
  // while we have NO rates at all and the fetch hasn't settled — it gates the
  // empty-state copy, never a full-section spinner.
  const [roleRates, setRoleRates] = useState<RoleBillingRate[]>(() => getRoleBillingRatesSeed()?.rates ?? []);
  const [ratesLoading, setRatesLoading] = useState(() => !getRoleBillingRatesSeed());
  const [showAll, setShowAll] = useState(false);
  const [showAI, setShowAI] = useState(false);

  useEffect(() => {
    // Fresh cache hit → trust it. Persisted seed → render it instantly
    // but silently revalidate so a reload can't pin stale rates.
    const hit = getCachedSection("budget", ticketId);
    const seededHit = hit !== undefined && isSectionSeeded("budget", ticketId);
    if (hit) {
      setBillingData(transformBillingData(hit)); setLoading(false);
      if (!seededHit) return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (!seededHit) setLoading(true);
        const raw = await getBillingRates(ticketId).catch(() => null);
        if (!cancelled && raw) { setCachedSection("budget", ticketId, raw); setBillingData(transformBillingData(raw)); }
      } finally { if (!cancelled && !seededHit) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [ticketId]);

  useEffect(() => {
    let cancelled = false;
    getRoleBillingRates()
      .then((p) => { if (!cancelled) { setRoleRates(p.rates); setRatesLoading(false); } })
      .catch(() => { if (!cancelled) setRatesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const rateMap = useMemo(() => {
    const m = new Map<string, { billing: number; labor: number; cost: number }>();
    for (const r of roleRates) {
      if (r.name) m.set(r.name.toLowerCase().trim(), {
        billing: r.billingRate ?? 0,
        labor:   r.laborRate  ?? 0,
        cost:    r.costRate   ?? 0,
      });
    }
    return m;
  }, [roleRates]);

  const personFinancials = useMemo((): PersonFinancials[] => {
    return allocations
      .filter((a) => a.eacHrs > 0)
      .map((a) => {
        const key = (a.role || "").toLowerCase().trim();
        const rates = rateMap.get(key) ?? { billing: 0, labor: 0, cost: 0 };
        // Prefer the precise NC hours returned by the team source. When only
        // the member-level flag is available, the grid's project-wide flag
        // means all of this member's planned hours are non-chargeable.
        const nonChargeableHours = Math.min(
          a.eacHrs,
          a.ncHrs > 0 ? a.ncHrs : a.nonChargeable ? a.eacHrs : 0,
        );
        const chargeableHours = Math.max(0, a.eacHrs - nonChargeableHours);
        const nonJobCostRate = a.ncRate && a.ncRate > 0 ? a.ncRate : rates.cost;
        const nonJobCost = a.ncCost > 0
          ? a.ncCost
          : nonChargeableHours * nonJobCostRate;
        const jobCost = chargeableHours * rates.cost;
        return {
          name: a.name, role: a.role, bu: a.bu,
          hours: a.eacHrs,
          chargeableHours, nonChargeableHours,
          // NC work still happened, but is explicitly not client-billable.
          revenue:   chargeableHours * rates.billing,
          laborCost: a.eacHrs * rates.labor,
          jobCost, nonJobCost,
          fullCost:  jobCost + nonJobCost,
          billingRate: rates.billing, laborRate: rates.labor, costRate: rates.cost,
          hasRates: rates.billing > 0 || rates.labor > 0 || rates.cost > 0 || nonJobCostRate > 0,
        };
      });
  }, [allocations, rateMap]);

  const totalHrs     = personFinancials.reduce((s, p) => s + p.hours, 0);
  const totalRevenue = personFinancials.reduce((s, p) => s + p.revenue, 0);
  const totalLabor   = personFinancials.reduce((s, p) => s + p.laborCost, 0);
  const totalJobCost = personFinancials.reduce((s, p) => s + p.jobCost, 0);
  const totalNonJobCost = personFinancials.reduce((s, p) => s + p.nonJobCost, 0);
  const totalCost    = personFinancials.reduce((s, p) => s + p.fullCost, 0);
  const margin       = totalRevenue > 0 && totalCost > 0
    ? ((totalRevenue - totalCost) / totalRevenue * 100) : 0;
  const marginColor  = margin >= 30 ? Colors.green : margin >= 15 ? Colors.orange : "#F87171";

  const totalEacHrs  = allocations.reduce((s, a) => s + (a.eacHrs || 0), 0);
  const totalEtcHrs  = allocations.reduce((s, a) => s + (a.etcHrs || 0), 0);

  const hasFinancials = personFinancials.some((p) => p.hasRates);

  // Only hold the whole section behind a spinner when there is truly nothing
  // to render yet. The old gate waited on the /billing-rates fetch even though
  // the summary tiles + FINANCIALS BY PERSON only need `allocations` (already
  // loaded by the parent) and the role rates (seeded from localStorage) — so
  // the section sat on "Loading budget…" for seconds for no reason.
  const nothingRenderable = billingData.length === 0 && allocations.length === 0;
  if (nothingRenderable && (loading || allocationsLoading)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 24, gap: 8 }}>
        <Spinner color={Colors.green} /><span style={{ color: Colors.textMuted, fontSize: 12 }}>Loading budget…</span>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 4 }}>
      {/* ── Summary tiles ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <BudgetTile color={Colors.green}  bg="rgba(107,165,57,0.1)"   label="CONTRACT VALUE" value={contractValue > 0 ? fmtCurrency(contractValue) : "—"} />
        {totalRevenue > 0 && <BudgetTile color={ACCENT_BLUE}   bg="rgba(56,189,248,0.08)"  label="REVENUE (EAC)"  value={fmtCurrency(totalRevenue)} />}
        {totalCost    > 0 && <BudgetTile color={Colors.orange} bg="rgba(232,119,34,0.1)"   label="FULL COST (EAC)" value={fmtCurrency(totalCost)} />}
        {totalNonJobCost > 0 && <BudgetTile color={ACCENT_AMBER} bg="rgba(245,158,11,0.12)" label="NON-CHARGEABLE COST" value={fmtCurrency(totalNonJobCost)} />}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <BudgetTile color={ACCENT_BLUE}   bg="rgba(56,189,248,0.08)"  label="EAC HOURS"  value={totalEacHrs > 0 ? fmtHrs(totalEacHrs) : "—"} small />
        <BudgetTile color={ACCENT_PURPLE} bg="rgba(167,139,250,0.1)"  label="ETC HOURS"  value={totalEtcHrs > 0 ? fmtHrs(totalEtcHrs) : "—"} small />
        {totalLabor > 0 && <BudgetTile color="#a78bfa" bg="rgba(167,139,250,0.08)" label="LABOUR COST" value={fmtCurrency(totalLabor)} small />}
        {margin > 0 && <BudgetTile color={marginColor} bg={`${marginColor}14`} label="MARGIN" value={`${margin.toFixed(1)}%`} small />}
      </div>

      {/* ── Per-person financials (from role rates) ── */}
      {hasFinancials && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <div style={{ color: Colors.textMuted, fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>
              FINANCIALS BY PERSON
            </div>
            <button
              onClick={() => setShowAI(true)}
              title="AI analysis of this project's per-person financials"
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "5px 12px", borderRadius: 8, cursor: "pointer",
                border: "1px solid rgba(139,92,246,0.4)",
                background: "rgba(139,92,246,0.10)",
                color: "#8B5CF6", fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
              }}
            >
              <Sparkles size={12} /> AI Analysis
            </button>
          </div>
          {/* table wrapper */}
          <div style={{ border: `1px solid ${Colors.border}`, borderRadius: 10, overflow: "hidden" }}>
            {/* header row */}
            <div style={{
              display: "grid", gridTemplateColumns: FIN_GRID_COLS,
              background: "rgba(0,0,0,0.06)",
              borderBottom: `1px solid ${Colors.border}`,
              color: Colors.textMuted, fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
            }}>
              <span style={{ padding: "8px 12px", display: "flex", alignItems: "center" }}>NAME / ROLE</span>
              <span style={finNumHead}>HRS</span>
              <span style={{ ...finNumHead, color: Colors.green }}>REVENUE</span>
              <span style={{ ...finNumHead, color: "#a78bfa" }}>LABOUR</span>
              <span style={{ ...finNumHead, color: Colors.orange }}>JOB COST</span>
              <span style={{ ...finNumHead, color: ACCENT_AMBER }}>NON-CHG</span>
            </div>
            {(showAll ? personFinancials : personFinancials.slice(0, 6)).map((p, i) => (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: FIN_GRID_COLS,
                borderBottom: `1px solid ${Colors.border}`,
                background: i % 2 === 1 ? "rgba(0,0,0,0.02)" : "transparent",
              }}>
                <div style={{ minWidth: 0, padding: "8px 12px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div style={{ color: "var(--rm-text)", fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                  <div style={{ color: Colors.textMuted, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.role}{p.bu ? ` • ${p.bu}` : ""}{p.nonChargeableHours > 0 ? ` • ${fmtHrs(p.nonChargeableHours)} non-chargeable` : ""}
                  </div>
                </div>
                <div style={finNumCell}>
                  <span style={{ color: Colors.textMuted, fontSize: 12, fontWeight: 600 }}>{fmtHrs(p.hours)}</span>
                </div>
                <div style={finNumCell}>
                  {p.revenue > 0
                    ? <span style={{ color: Colors.green, fontSize: 12, fontWeight: 700 }}>{fmtCurrency(p.revenue)}</span>
                    : <span style={{ color: Colors.textMuted, fontSize: 10 }}>—</span>}
                  {p.billingRate > 0 && p.chargeableHours > 0 && <span style={{ color: Colors.textMuted, fontSize: 9 }}>${fmtNumber(p.billingRate)}/hr billable</span>}
                </div>
                <div style={finNumCell}>
                  {p.laborCost > 0
                    ? <span style={{ color: "#a78bfa", fontSize: 12, fontWeight: 700 }}>{fmtCurrency(p.laborCost)}</span>
                    : <span style={{ color: Colors.textMuted, fontSize: 10 }}>—</span>}
                  {p.laborRate > 0 && <span style={{ color: Colors.textMuted, fontSize: 9 }}>${fmtNumber(p.laborRate)}/hr</span>}
                </div>
                <div style={finNumCell}>
                  {p.jobCost > 0
                    ? <span style={{ color: Colors.orange, fontSize: 12, fontWeight: 700 }}>{fmtCurrency(p.jobCost)}</span>
                    : <span style={{ color: Colors.textMuted, fontSize: 10 }}>—</span>}
                  {p.costRate > 0 && <span style={{ color: Colors.textMuted, fontSize: 9 }}>${fmtNumber(p.costRate)}/hr</span>}
                </div>
                <div style={finNumCell}>
                  {p.nonJobCost > 0
                    ? <span style={{ color: ACCENT_AMBER, fontSize: 12, fontWeight: 700 }}>{fmtCurrency(p.nonJobCost)}</span>
                    : <span style={{ color: Colors.textMuted, fontSize: 10 }}>—</span>}
                  {p.nonChargeableHours > 0 && <span style={{ color: Colors.textMuted, fontSize: 9 }}>{fmtHrs(p.nonChargeableHours)}</span>}
                </div>
              </div>
            ))}
            {/* totals row */}
            {personFinancials.length > 1 && (
              <div style={{
                display: "grid", gridTemplateColumns: FIN_GRID_COLS,
                background: "rgba(0,0,0,0.05)",
              }}>
                <div style={{ padding: "9px 12px", color: Colors.textMuted, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, display: "flex", alignItems: "center" }}>TOTAL</div>
                <div style={finNumCell}><span style={{ color: "var(--rm-text)", fontSize: 12, fontWeight: 700 }}>{fmtHrs(totalHrs)}</span></div>
                <div style={finNumCell}><span style={{ color: Colors.green, fontSize: 12, fontWeight: 700 }}>{totalRevenue > 0 ? fmtCurrency(totalRevenue) : "—"}</span></div>
                <div style={finNumCell}><span style={{ color: "#a78bfa", fontSize: 12, fontWeight: 700 }}>{totalLabor > 0 ? fmtCurrency(totalLabor) : "—"}</span></div>
                <div style={finNumCell}><span style={{ color: Colors.orange, fontSize: 12, fontWeight: 700 }}>{totalJobCost > 0 ? fmtCurrency(totalJobCost) : "—"}</span></div>
                <div style={finNumCell}><span style={{ color: ACCENT_AMBER, fontSize: 12, fontWeight: 700 }}>{totalNonJobCost > 0 ? fmtCurrency(totalNonJobCost) : "—"}</span></div>
              </div>
            )}
          </div>
          {personFinancials.length > 6 && (
            <button onClick={() => setShowAll(!showAll)} style={{
              display: "block", margin: "4px auto 0", padding: "8px 16px",
              background: "transparent", border: "none", color: Colors.green,
              fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>
              {showAll ? "Show Less" : `Show All ${personFinancials.length} People`}
            </button>
          )}
          {showAI && (
            <FinancialAIModal
              projectName={projectName || ticketId}
              ticketId={ticketId}
              people={personFinancials}
              contractValue={contractValue}
              laborValue={laborValue}
              forecastedCost={forecastedCost}
              totalHrs={totalHrs}
              totalRevenue={totalRevenue}
              totalLabor={totalLabor}
              totalCost={totalCost}
              margin={margin}
              onClose={() => setShowAI(false)}
            />
          )}
        </div>
      )}

      {/* ── Upstream billing data (fallback) ── */}
      {billingData.length > 0 && !hasFinancials && (
        <div>
          <div style={{ color: Colors.textMuted, fontSize: 11, fontWeight: 700, marginBottom: 8 }}>BILLING & COST BREAKDOWN</div>
          {billingData.slice(0, 5).map((r, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: 10, backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 10, marginBottom: 4,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "var(--rm-text)", fontSize: 12, fontWeight: 600 }}>{r.name}</div>
                <div style={{ color: Colors.textMuted, fontSize: 10 }}>{r.role}{r.bu ? ` • ${r.bu}` : ""}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                {r.billingTotal > 0 && <div style={{ color: Colors.green, fontSize: 11, fontWeight: 600 }}>{fmtCurrency(r.billingTotal)}</div>}
                {r.hours > 0 && <div style={{ color: Colors.textMuted, fontSize: 10 }}>{r.hours.toFixed(0)}h @ ${r.billingRate.toFixed(0)}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {!hasFinancials && billingData.length === 0 && (
        ratesLoading && allocations.length > 0 ? (
          // Rates still in flight for a project that HAS a team: a quiet
          // placeholder instead of prematurely claiming rates aren't set —
          // the tiles above are already visible, so no full-section spinner.
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: 16 }}>
            <Spinner color={Colors.green} size={14} />
            <span style={{ color: Colors.textMuted, fontSize: 12 }}>Loading rates…</span>
          </div>
        ) : (
        <div style={{ color: "#374151", fontSize: 12, fontWeight: 600, textAlign: "center", padding: 16, lineHeight: 1.6 }}>
          {allocations.length === 0
            ? "Add team members and assign hours on the Team tab — revenue, cost and margin will calculate automatically once role rates are set."
            : roleRates.length > 0 && !personFinancials.some((p) => p.hasRates)
              ? <>Team hours are set but no rates are configured for their roles yet.{" "}
                  <a href="/import" style={{ color: Colors.green, textDecoration: "underline", fontWeight: 700 }}>
                    Go to Import Data → Billing Rates
                  </a>{" "}to add billing, labour and cost rates.</>
              : "Assign weekly hours to team members on the Team tab to see financials here."}
        </div>
        )
      )}
    </div>
  );
}

function BudgetTile({ color, bg, label, value, small }: { color: string; bg: string; label: string; value: string; small?: boolean }) {
  return (
    <div style={{ flex: 1, minWidth: 100, backgroundColor: bg, borderRadius: 12, padding: 12 }}>
      <div style={{ color: Colors.textMuted, fontSize: 10, fontWeight: 600 }}>{label}</div>
      <div style={{ color, fontSize: small ? 16 : 18, fontWeight: 800, marginTop: 4 }}>{value}</div>
    </div>
  );
}

/* ──────────────── Financial AI Analysis modal ────────────────
 * Sends the FINANCIALS BY PERSON table (names, hours, rates, revenue,
 * labour and full cost) plus contract figures to the AI and renders a
 * structured verdict: status pill, headline, deterministic charts built
 * from the REAL table data (never AI-generated numbers), current-state
 * insights and optimization recommendations. */

/* Session cache: reopening the popup for the same project + unchanged
 * financials shows the previous analysis instantly instead of re-running. */
const finAiCache = new Map<string, string>();

function FinancialAIModal({
  projectName, ticketId, people, contractValue, laborValue, forecastedCost,
  totalHrs, totalRevenue, totalLabor, totalCost, margin, onClose,
}: {
  projectName: string; ticketId: string; people: PersonFinancials[];
  contractValue: number; laborValue: number; forecastedCost: number;
  totalHrs: number; totalRevenue: number; totalLabor: number; totalCost: number;
  margin: number; onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [aiLoading, setAiLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cardText = "#253746";
  const cardMuted = "#6B7E8A";
  const cardBorder = "#E5EAEF";
  const PURPLE = "#8B5CF6";
  const GREEN = "#6BA539";
  const AMBER = "#D97706";
  const ORANGE = "#E87722";

  const missingRates = useMemo(() => people.filter((p) => !p.hasRates).map((p) => p.name), [people]);

  const prompt = useMemo(() => {
    const money = (v: number) => (v > 0 ? `$${Math.round(v).toLocaleString()}` : "not set");
    const L: string[] = [];
    L.push(`You are a senior financial analyst reviewing per-person staffing financials for a construction project.`);
    L.push(`PROJECT: "${projectName}" (${ticketId})`);
    L.push(`CONTRACT VALUE: ${money(contractValue)}`);
    L.push(`LABOR CONTRACT: ${money(laborValue)}`);
    L.push(`FORECASTED PROJECT COST: ${money(forecastedCost)}`);
    L.push(`TOTALS: hours=${Math.round(totalHrs)} | revenue(EAC)=${money(totalRevenue)} | labour cost=${money(totalLabor)} | full cost=${money(totalCost)} | margin=${totalRevenue > 0 && totalCost > 0 ? margin.toFixed(1) + "%" : "not computable"}`);
    L.push(`TEAM (name | role | hours | billing $/hr | labour $/hr | cost $/hr | revenue | labour cost | full cost):`);
    for (const p of people) {
      L.push(`- ${p.name} | ${p.role || "no role"} | ${Math.round(p.hours)}h | $${p.billingRate} | $${p.laborRate} | $${p.costRate} | ${money(p.revenue)} | ${money(p.laborCost)} | ${money(p.fullCost)}`);
    }
    if (missingRates.length) {
      L.push(`PEOPLE WITH NO RATES CONFIGURED (their revenue/cost is invisible to the project financials): ${missingRates.join(", ")}`);
    }
    L.push(``);
    L.push(`Respond IMMEDIATELY in EXACTLY this plain-text line format — no markdown, no headers, no extra prose, no preamble:`);
    L.push(`STATUS: HEALTHY or AT-RISK or CRITICAL`);
    L.push(`HEADLINE: one sentence on the overall financial position`);
    L.push(`INSIGHT: one specific observation about the current state (write exactly 3 INSIGHT lines)`);
    L.push(`REC: one specific, actionable step to optimize cost, margin or data quality (write exactly 3 REC lines)`);
    L.push(`Be brief. Every figure you cite must come from the data above — never invent numbers. Keep each line under 180 characters.`);
    return L.join("\n");
  }, [projectName, ticketId, people, contractValue, laborValue, forecastedCost, totalHrs, totalRevenue, totalLabor, totalCost, margin, missingRates]);

  const cacheKey = `${ticketId}|${people.length}|${Math.round(totalHrs)}|${Math.round(totalRevenue)}|${Math.round(totalLabor)}|${Math.round(totalCost)}`;

  useEffect(() => {
    // Instant path: same project + unchanged numbers → reuse last analysis.
    const cached = finAiCache.get(cacheKey);
    if (cached) {
      setText(cached); setError(null); setAiLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setText(""); setError(null); setAiLoading(true);
    let acc = "";
    let hadError = false;
    (async () => {
      try {
        await chatStream(
          [{ role: "user", content: prompt }],
          (e) => {
            if (e.type === "token" || e.type === "content") { acc += e.text; setText((t) => t + e.text); }
            else if (e.type === "error") { hadError = true; setError(e.message); setAiLoading(false); }
            else if (e.type === "done") {
              setAiLoading(false);
              if (acc.trim() && !hadError) finAiCache.set(cacheKey, acc);
            }
          },
          ctrl.signal,
        );
      } catch (err) {
        if (!ctrl.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to analyze");
          setAiLoading(false);
        }
      }
    })();
    return () => { ctrl.abort(); };
  }, [prompt, cacheKey]);

  const clean = text
    .replace(/\[(?:WEEKLY_ALLOC|BUTTONS|ROSTER_TABLE|LIFECYCLE_PICKER|SCHEDULE_TABLE|PROJECT_DATES|SELECT_PROJECT|PMM_TABLE|OPP_TABLE|PERSON_PROFILE|PROJECT_PROFILE|FORECAST_TABLE|CAPACITY_HEATMAP)[^\]]*\]/g, "")
    .replace(/^\s*\[[A-Z_]+\]\s*$/gm, "");

  const parsed = useMemo(() => {
    let status: "healthy" | "at-risk" | "critical" | null = null;
    let headline = "";
    const insights: string[] = [];
    const recs: string[] = [];
    for (const raw of clean.split("\n")) {
      const m = raw.match(/^\s*(STATUS|HEADLINE|INSIGHT|REC)\s*:\s*(.*)$/i);
      if (!m) continue;
      const val = m[2].trim().replace(/^[-*•]\s*/, "").replace(/\*\*/g, "");
      if (!val) continue;
      const key = m[1].toUpperCase();
      if (key === "STATUS") {
        const s = val.toLowerCase();
        status = s.includes("critical") ? "critical" : s.includes("risk") ? "at-risk" : s.includes("healthy") ? "healthy" : null;
      } else if (key === "HEADLINE") headline = val;
      else if (key === "INSIGHT") insights.push(val);
      else if (key === "REC") recs.push(val);
    }
    return { status, headline, insights, recs };
  }, [clean]);

  const statusTheme =
    parsed.status === "critical" ? { bg: "#FEE2E2", fg: "#B91C1C", label: "CRITICAL", icon: <AlertTriangle size={13} /> }
    : parsed.status === "at-risk" ? { bg: "#FEF3C7", fg: AMBER, label: "AT-RISK", icon: <AlertTriangle size={13} /> }
    : parsed.status === "healthy" ? { bg: "#DCFCE7", fg: "#15803D", label: "HEALTHY", icon: <CheckCircle size={13} /> }
    : null;
  const anyParsed = parsed.headline || parsed.insights.length > 0 || parsed.recs.length > 0 || statusTheme;

  /* Chart data — computed from the REAL table, never from the AI text. */
  const chartPeople = useMemo(() =>
    [...people]
      .sort((a, b) => (b.revenue + b.laborCost + b.fullCost) - (a.revenue + a.laborCost + a.fullCost) || b.hours - a.hours)
      .slice(0, 8),
  [people]);
  const chartMax = Math.max(1, ...chartPeople.flatMap((p) => [p.revenue, p.laborCost, p.fullCost]));

  const budgetBars = useMemo(() => {
    const bars: { label: string; used: number; budget: number }[] = [];
    if (laborValue > 0 && totalRevenue > 0) bars.push({ label: "Revenue (EAC) vs Labor Contract", used: totalRevenue, budget: laborValue });
    else if (contractValue > 0 && totalRevenue > 0) bars.push({ label: "Revenue (EAC) vs Contract Value", used: totalRevenue, budget: contractValue });
    if (forecastedCost > 0 && totalCost > 0) bars.push({ label: "Full Cost (EAC) vs Forecasted Cost", used: totalCost, budget: forecastedCost });
    return bars;
  }, [laborValue, contractValue, forecastedCost, totalRevenue, totalCost]);

  const marginOk = totalRevenue > 0 && totalCost > 0;
  const summaryTiles = [
    { label: "REVENUE (EAC)", value: totalRevenue > 0 ? fmtCurrency(totalRevenue) : "—", color: GREEN },
    { label: "LABOUR COST", value: totalLabor > 0 ? fmtCurrency(totalLabor) : "—", color: PURPLE },
    { label: "FULL COST", value: totalCost > 0 ? fmtCurrency(totalCost) : "—", color: ORANGE },
    { label: "MARGIN", value: marginOk ? `${margin.toFixed(1)}%` : "—", color: marginOk ? (margin >= 30 ? "#15803D" : margin >= 15 ? AMBER : "#B91C1C") : cardMuted },
  ];

  const sectionLabel = (txt: string, color: string) => (
    <div style={{ fontSize: 10, fontWeight: 800, color, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>{txt}</div>
  );

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: Z.MODAL,
        backgroundColor: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      <style>{`
        @keyframes rmoneFinBarGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes rmoneFinPulse { 0%,100% { opacity: 0.45; } 50% { opacity: 1; } }
        @keyframes rmoneFinSpin { to { transform: rotate(360deg); } }
        @keyframes rmoneFinDot { 0%,60%,100% { opacity: 0.25; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
        @keyframes rmoneFinSweep { 0% { left: -45%; } 100% { left: 100%; } }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 620,
          backgroundColor: "#FFFFFF", borderRadius: 16,
          maxHeight: "88vh", display: "flex", flexDirection: "column",
          boxShadow: "0 12px 36px rgba(0,0,0,0.35)", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "14px 18px 12px", borderBottom: `1px solid ${cardBorder}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: PURPLE, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}>
              <Sparkles size={12} /> AI Financial Analysis
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: cardText, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 340 }}>{projectName}</span>
              {statusTheme && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
                  color: statusTheme.fg, backgroundColor: statusTheme.bg,
                  borderRadius: 999, padding: "3px 10px",
                }}>
                  {statusTheme.icon} {statusTheme.label}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: cardMuted, marginTop: 2 }}>
              {ticketId} • {people.length} team member{people.length === 1 ? "" : "s"} • {fmtHrs(totalHrs)} EAC
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            width: 28, height: 28, borderRadius: 14, border: "none",
            backgroundColor: "#F0F3F6", display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", flexShrink: 0,
          }}>
            <X size={14} color={cardMuted} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: "auto", padding: "14px 18px 18px" }}>
          {/* Summary metric tiles */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 14 }}>
            {summaryTiles.map((t) => (
              <div key={t.label} style={{ backgroundColor: "#F7F9FA", border: `1px solid ${cardBorder}`, borderRadius: 10, padding: "8px 10px" }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: cardMuted, letterSpacing: 0.5 }}>{t.label}</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: t.color, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{t.value}</div>
              </div>
            ))}
          </div>

          {/* Budget consumption bars */}
          {budgetBars.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              {sectionLabel("Budget consumption", cardMuted)}
              {budgetBars.map((b) => {
                const pct = (b.used / b.budget) * 100;
                const over = pct > 100;
                const fill = over ? "#DC2626" : pct > 85 ? "#D97706" : GREEN;
                return (
                  <div key={b.label} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: cardText, fontWeight: 600, marginBottom: 3 }}>
                      <span>{b.label}</span>
                      <span style={{ color: fill, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                        {pct.toFixed(0)}% <span style={{ color: cardMuted, fontWeight: 600 }}>({fmtCurrency(b.used)} of {fmtCurrency(b.budget)})</span>
                      </span>
                    </div>
                    <div style={{ height: 8, borderRadius: 4, backgroundColor: "#EEF1F4", overflow: "hidden" }}>
                      <div style={{
                        width: `${Math.min(100, pct)}%`, height: "100%", borderRadius: 4,
                        backgroundColor: fill, transformOrigin: "left",
                        animation: "rmoneFinBarGrow 0.6s ease-out",
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Per-person chart — real table data */}
          <div style={{ marginBottom: 14 }}>
            {sectionLabel("Revenue vs cost by person", cardMuted)}
            <div style={{ display: "flex", gap: 12, marginBottom: 6 }}>
              {[{ c: GREEN, l: "Revenue" }, { c: PURPLE, l: "Labour" }, { c: ORANGE, l: "Full cost" }].map((x) => (
                <span key={x.l} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: cardMuted, fontWeight: 600 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: x.c }} /> {x.l}
                </span>
              ))}
            </div>
            {chartPeople.map((p) => {
              const rows = [
                { v: p.revenue, c: GREEN },
                { v: p.laborCost, c: PURPLE },
                { v: p.fullCost, c: ORANGE },
              ].filter((r) => r.v > 0);
              return (
                <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                  <div style={{ width: 120, flexShrink: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cardText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div style={{ fontSize: 9, color: cardMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.role || "—"} • {fmtHrs(p.hours)}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    {rows.length > 0 ? rows.map((r, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ flex: 1, height: 7, borderRadius: 3.5, backgroundColor: "#F1F4F6", overflow: "hidden" }}>
                          <div style={{
                            width: `${Math.max(2, (r.v / chartMax) * 100)}%`, height: "100%", borderRadius: 3.5,
                            backgroundColor: r.c, transformOrigin: "left",
                            animation: "rmoneFinBarGrow 0.6s ease-out",
                          }} />
                        </div>
                        <span style={{ width: 52, fontSize: 9.5, fontWeight: 700, color: r.c, textAlign: "right", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{fmtCurrency(r.v)}</span>
                      </div>
                    )) : (
                      <span style={{ fontSize: 10, color: "#B45309", backgroundColor: "#FEF3C7", borderRadius: 6, padding: "2px 8px", alignSelf: "flex-start", fontWeight: 600 }}>
                        No rates configured — financials invisible
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {people.length > chartPeople.length && (
              <div style={{ fontSize: 10, color: cardMuted, marginTop: 2 }}>Showing top {chartPeople.length} of {people.length} people by financial impact.</div>
            )}
          </div>

          {/* AI verdict */}
          {aiLoading && !text ? (
            <div style={{
              backgroundColor: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 12,
              padding: "14px 16px", display: "flex", alignItems: "center", gap: 12,
            }}>
              <Loader2 size={20} color={PURPLE} style={{ animation: "rmoneFinSpin 0.9s linear infinite", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#4C1D95", display: "flex", alignItems: "center", gap: 4 }}>
                  AI is analyzing project financials
                  <span style={{ display: "inline-flex", gap: 3, marginLeft: 2, alignItems: "flex-end" }}>
                    {[0, 1, 2].map((i) => (
                      <span key={i} style={{
                        width: 4, height: 4, borderRadius: 2, backgroundColor: PURPLE, display: "inline-block",
                        animation: `rmoneFinDot 1.2s ease-in-out ${i * 0.18}s infinite`,
                      }} />
                    ))}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#7C6BAE", marginTop: 2 }}>Reviewing team hours, rates, revenue and cost…</div>
                <div style={{ marginTop: 8, height: 4, borderRadius: 2, backgroundColor: "#EDE9FE", overflow: "hidden", position: "relative" }}>
                  <div style={{
                    position: "absolute", top: 0, left: 0, height: "100%", width: "45%", borderRadius: 2,
                    background: `linear-gradient(90deg, transparent, ${PURPLE}, transparent)`,
                    animation: "rmoneFinSweep 1.1s ease-in-out infinite",
                  }} />
                </div>
              </div>
            </div>
          ) : error ? (
            <div style={{ backgroundColor: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: 12, color: "#B91C1C", fontSize: 12, fontWeight: 600 }}>
              Couldn't complete the AI analysis: {error}
            </div>
          ) : anyParsed ? (
            <>
              {parsed.headline && (
                <div style={{
                  backgroundColor: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 10,
                  padding: "10px 12px", marginBottom: 12,
                  fontSize: 13, fontWeight: 700, color: "#4C1D95", lineHeight: 1.45,
                }}>
                  {parsed.headline}
                </div>
              )}
              {parsed.insights.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {sectionLabel("How it's going now", "#3B82F6")}
                  {parsed.insights.map((s, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
                      <Activity size={13} color="#3B82F6" style={{ flexShrink: 0, marginTop: 2 }} />
                      <span style={{ fontSize: 12.5, color: cardText, lineHeight: 1.5 }}>{s}</span>
                    </div>
                  ))}
                </div>
              )}
              {parsed.recs.length > 0 && (
                <div>
                  {sectionLabel("What's needed to optimize", "#15803D")}
                  {parsed.recs.map((s, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
                      <Target size={13} color="#15803D" style={{ flexShrink: 0, marginTop: 2 }} />
                      <span style={{ fontSize: 12.5, color: cardText, lineHeight: 1.5 }}>{s}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : clean.trim() ? (
            <div style={{ fontSize: 12.5, color: cardText, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{clean.trim()}</div>
          ) : null}
          {aiLoading && text && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 10, fontSize: 11, fontWeight: 600, color: PURPLE }}>
              <Loader2 size={12} color={PURPLE} style={{ animation: "rmoneFinSpin 0.9s linear infinite" }} />
              Still analyzing
              <span style={{ display: "inline-flex", gap: 3, alignItems: "flex-end" }}>
                {[0, 1, 2].map((i) => (
                  <span key={i} style={{
                    width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: PURPLE, display: "inline-block",
                    animation: `rmoneFinDot 1.2s ease-in-out ${i * 0.18}s infinite`,
                  }} />
                ))}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ──────────────── Spinner ──────────────── */
function Spinner({ color = Colors.green, size = 24 }: { color?: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      border: `2px solid ${color}40`, borderTopColor: color,
      animation: "rmone-spin 0.8s linear infinite",
    }} />
  );
}

/** Returns the list-page path to navigate back to based on module or ticket ID. */
function moduleListPath(moduleOrId: string | undefined): string {
  const s = (moduleOrId ?? "").toUpperCase();
  if (s === "OPM" || s.startsWith("OPM-")) return "/projects?view=Opportunities";
  if (s === "LEM" || s.startsWith("LEM-")) return "/projects?view=Leads";
  if (s === "COM" || s.startsWith("COM-")) return "/projects?view=Companies";
  return "/projects";
}

/* ──────────────── AddLeadModal ────────────────
   "Add Lead" flow of the Project Leads card. Mirrors the AddTeamMemberModal
   look (white sheet, role + person pickers) instead of the old inline form,
   and adds an explicit "add a new person" path for names that aren't on the
   roster — the *User columns store display names, so any typed name is legal. */
const LM = {
  bg: "#FFFFFF", card: "#F5F8FA", border: "#D5DEE5", borderSoft: "#E8EDF2",
  green: "#6BA539", text: "#253746", muted: "#6B7E8A",
};

/** Sentinel value for the "Add your own role…" entry in the Lead Role picker. */
const CUSTOM_ROLE_OPTION = "__custom_role__";

function AddLeadModal({ open, onClose, roles, people, saving, error, onSave }: {
  open: boolean;
  onClose: () => void;
  roles: { field: string; role: string }[];
  people: { id: string; name: string; title: string }[];
  saving: boolean;
  error: string;
  onSave: (roleField: string, name: string) => void;
}) {
  const [roleField, setRoleField] = useState("");
  const [customRole, setCustomRole] = useState("");
  const [query, setQuery] = useState("");
  const [selName, setSelName] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [customName, setCustomName] = useState("");

  // Fresh form every time the modal opens; pre-select the role when only
  // one lead role is still available.
  useEffect(() => {
    if (!open) return;
    setRoleField(roles.length === 1 ? roles[0].field : "");
    setCustomRole("");
    setQuery(""); setSelName(""); setCustomMode(false); setCustomName("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const matches = q ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;
  const shown = matches.slice(0, 60);
  const name = (customMode ? customName : selName).trim();
  // "Add your own role" saves as `custom:<label>` — the page routes it into
  // the record's CustomLeadsJson column instead of a *User column.
  const isCustomRole = roleField === CUSTOM_ROLE_OPTION;
  const roleLabel = isCustomRole ? customRole.trim() : (roles.find((r) => r.field === roleField)?.role ?? "");
  const saveFieldKey = isCustomRole
    ? (customRole.trim() ? `${CUSTOM_ROLE_PREFIX}${customRole.trim()}` : "")
    : roleField;
  const canSave = !!saveFieldKey && !!name && !saving;

  const fieldBox: React.CSSProperties = {
    width: "100%", padding: "9px 11px", borderRadius: 10, fontSize: 13,
    backgroundColor: LM.card, color: LM.text,
    border: `1px solid ${LM.border}`, outline: "none",
  };
  const label: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: LM.muted, textTransform: "uppercase",
    letterSpacing: 0.4, marginBottom: 6,
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.78)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: Z.MODAL_CHILD, padding: 20,
    }}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-lead-title"
        style={{
          backgroundColor: LM.bg, color: LM.text, borderRadius: 16,
          width: "min(560px, 100%)", maxHeight: "85vh",
          display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
        }}>
        <div style={{
          display: "flex", alignItems: "center", padding: 16,
          borderBottom: `1px solid ${LM.border}`, gap: 10,
        }}>
          <UserPlus size={18} color={LM.green} />
          <div id="add-lead-title" style={{ flex: 1, fontWeight: 700, fontSize: 16 }}>Add Lead</div>
          <button onClick={onClose} aria-label="Close add lead"
            style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4, color: LM.muted }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16, paddingBottom: 20 }}>
          <div style={{ marginBottom: 14 }}>
            <div style={label}>Lead Role</div>
            <select value={roleField} onChange={(e) => setRoleField(e.target.value)} style={fieldBox}>
              <option value="">Select a role…</option>
              {roles.map((r) => <option key={r.field} value={r.field}>{r.role}</option>)}
              <option value={CUSTOM_ROLE_OPTION}>＋ Add your own role…</option>
            </select>
            {isCustomRole && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <input
                  value={customRole}
                  onChange={(e) => setCustomRole(e.target.value)}
                  placeholder="Type the role name — e.g. Design Lead…"
                  autoFocus
                  style={fieldBox}
                />
                <div style={{ fontSize: 11, color: LM.muted }}>
                  Saved exactly as typed on this record's leads.
                </div>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 4 }}>
            <div style={label}>Person</div>
            {customMode ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Type the person's full name…"
                  autoFocus
                  style={fieldBox}
                />
                <div style={{ fontSize: 11, color: LM.muted }}>
                  This name will be saved exactly as typed — use it for people who aren't on the roster yet.
                </div>
                <button onClick={() => { setCustomMode(false); setCustomName(""); }} style={{
                  alignSelf: "flex-start", background: "transparent", border: "none", cursor: "pointer",
                  color: LM.green, fontSize: 12, fontWeight: 600, padding: 0,
                }}>
                  ← Choose from the roster instead
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "0 11px",
                  backgroundColor: LM.card, borderRadius: 10, border: `1px solid ${LM.border}`,
                }}>
                  <Search size={14} color={LM.muted} />
                  <input
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setSelName(""); }}
                    placeholder="Search the roster…"
                    style={{ flex: 1, padding: "9px 0", background: "transparent", border: "none", outline: "none", fontSize: 13, color: LM.text }}
                  />
                </div>
                <div style={{
                  maxHeight: 220, overflowY: "auto", borderRadius: 10,
                  border: `1px solid ${LM.borderSoft}`,
                }}>
                  {shown.length === 0 && (
                    <div style={{ padding: "14px 12px", fontSize: 12, color: LM.muted }}>
                      {people.length === 0 ? "Loading roster…" : "No roster match — you can add them as a new person below."}
                    </div>
                  )}
                  {shown.map((p) => {
                    const selected = selName === p.name;
                    return (
                      <button key={p.id} onClick={() => setSelName(selected ? "" : p.name)} style={{
                        display: "flex", alignItems: "baseline", gap: 8, width: "100%",
                        padding: "9px 12px", textAlign: "left", cursor: "pointer",
                        backgroundColor: selected ? LM.green + "1A" : "transparent",
                        border: "none", borderLeft: `3px solid ${selected ? LM.green : "transparent"}`,
                        color: LM.text, fontSize: 13,
                      }}>
                        <span style={{ fontWeight: 600 }}>{p.name}</span>
                        {p.title && <span style={{ color: LM.muted, fontSize: 11 }}>{p.title}</span>}
                      </button>
                    );
                  })}
                  {matches.length > shown.length && (
                    <div style={{ padding: "8px 12px", fontSize: 11, color: LM.muted }}>
                      {matches.length - shown.length} more — type to narrow the list.
                    </div>
                  )}
                </div>
                <button onClick={() => { setCustomMode(true); setSelName(""); }} style={{
                  alignSelf: "flex-start", background: "transparent", border: "none", cursor: "pointer",
                  color: LM.green, fontSize: 12, fontWeight: 600, padding: 0,
                }}>
                  + Add a new person (not on the roster)
                </button>
              </div>
            )}
          </div>

          {/* Clear confirmation of who's about to be added — the row
              highlight alone was easy to miss. */}
          {name && (
            <div style={{
              marginTop: 12, display: "flex", alignItems: "center", gap: 8,
              padding: "9px 11px", borderRadius: 10,
              backgroundColor: LM.green + "14", border: `1px solid ${LM.green}`,
            }}>
              <UserPlus size={14} color={LM.green} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: LM.text }}>
                {roleLabel
                  ? <>Adding <b>{name}</b> as <b>{roleLabel}</b> — hit “Save Lead” to confirm.</>
                  : <>Adding <b>{name}</b> — choose a role above first.</>}
              </span>
            </div>
          )}

          {error && <div style={{ color: "#DC2626", fontSize: 12, marginTop: 10 }}>{error}</div>}
        </div>

        <div style={{ display: "flex", gap: 10, padding: 16, borderTop: `1px solid ${LM.border}` }}>
          <button disabled={!canSave} onClick={() => onSave(saveFieldKey, name)} style={{
            flex: 1, padding: "11px 14px", backgroundColor: LM.green, color: "#FFF", border: "none",
            borderRadius: 10, fontSize: 13, fontWeight: 700,
            cursor: canSave ? "pointer" : "default", opacity: canSave ? 1 : 0.5,
          }}>
            {saving ? "Saving…" : "Save Lead"}
          </button>
          <button disabled={saving} onClick={onClose} style={{
            padding: "11px 18px", backgroundColor: "transparent", color: LM.muted,
            border: `1px solid ${LM.border}`, borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* Browser-integration seam (same pattern as resources.tsx): the
   record-detail fallback harness registers an observer to read the page's
   live state after each render. Normal application mounts never register
   one, so production renders only pay a null check. Read-only — the
   harness can observe but never drive state through this. */
export interface ProjectDetailIntegrationSnapshot {
  id: string;
  name: string;
  status: string;
  city: string;
  sector: string;
  company: string;
  module: string;
  /** Object.keys(project.rawFields).length — 0 means an empty shell. */
  rawFieldCount: number;
  allocationNames: string[];
  healthScore: number;
  loading: boolean;
  teamPending: boolean;
  coreDataSettled: boolean;
  initialLoadComplete: boolean;
  error: string;
}
export default function ProjectDetail({ projectId }: { projectId: string }) {
  const id = projectId;
  const { user } = useAuth();
  // Per-stage permissions: what THIS user may do to THIS record at its
  // current stage, resolved by the server (custom access levels + per-stage
  // rules, plain-language reason included). This UI is deliberately closed
  // while that answer is loading or degraded; the server independently
  // enforces every write, but a disabled stage/data/financial control is much
  // clearer than an optimistic control which later fails on save.
  // ProjectDetail stays mounted while the route changes from one record to
  // another. Keep the record identity beside the response so a permission
  // verdict from record A can never briefly gate (or unlock) record B while
  // the new request is still in flight.
  const [recPermState, setRecPermState] = useState<{
    recordId: string;
    value: RecordPermissions | null;
  }>({ recordId: "", value: null });
  const recPerms = recPermState.recordId === id ? recPermState.value : null;
  const setRecPerms = useCallback((value: RecordPermissions | null) => {
    setRecPermState({ recordId: id, value });
  }, [id]);
  // permsVer bumps when access levels / staff assignments / stage permissions
  // change anywhere (this tab or a sibling tab) — re-ask the server through
  // the freshly busted cache so edit gating updates without a manual refresh.
  const permsVer = usePermissionsVersion();
  const settledPerms = recPerms && !recPerms.degraded ? recPerms : null;
  const permsDenyEdit = !settledPerms || !settledPerms.canEditData;
  const permsDenyAdvance = !settledPerms || !settledPerms.canAdvanceStage;
  // Effective capabilities come from the LIVE server verdict. Do NOT combine
  // these with user.canEdit: that legacy login flag means only "built-in User"
  // and therefore stays false even when Settings explicitly grants that level
  // Edit data / Move stages / Edit financials.
  const canEdit = settledPerms?.canEditData === true;
  const canAdvanceStage = canEdit && settledPerms?.canAdvanceStage === true;
  // Financial fields (contract values and similar) have their own capability:
  // a custom "financials only" level edits exactly those while everything
  // else stays locked — and a data editor without the financial capability
  // gets the opposite split.
  const canEditFinancialFields = settledPerms?.canEditFinancials === true;
  // Plain-language note for the stage/status controls (lifecycle footer):
  // no-edit blankets everything; no-advance covers just the stage moves.
  const stageLockNote = !settledPerms
    ? "Checking your access for this record…"
    : permsDenyEdit
    ? (recPerms?.reason || "Only this stage's assigned people can edit this record.")
    : permsDenyAdvance
      ? (recPerms?.reason || "Only this stage's assigned people can move this record to another stage.")
      : null;
  // Standard plain-language reason for DATA-edit controls (buttons, pencils,
  // add flows) when the stage-permission verdict blocks edits. Non-null ONLY
  // for users whose effective capability or stage rule blocks editing.
  const editLockNote = settledPerms && permsDenyEdit
    ? (recPerms?.reason || "Only this stage's assigned people can edit this record.")
    : null;
  useBusinessRulesVersion();
  // ProjectDetail is reused for record-to-record navigation. A verdict for the
  // previous record must never leave the next record briefly editable.
  useEffect(() => { setRecPerms(null); }, [id]);
  const [location, navigate] = useLocation();
  const requestedModule = (() => {
    const value = new URLSearchParams(location.split("?")[1] ?? "").get("module")?.toUpperCase();
    return value === "PMM" || value === "OPM" || value === "LEM" ? value : undefined;
  })();
  // Billing Rates returns here with this one-shot flag after a role-rate save.
  // It forces this page's first team fetch through fresh=1, avoiding a stale
  // response from a sibling API worker whose cache-bust IPC is still in transit.
  const [forceFreshTeamOnEntry, setForceFreshTeamOnEntry] = useState(() => {
    try { return new URLSearchParams(location.split("?")[1] ?? "").get("ratesRefreshed") === "1"; }
    catch { return false; }
  });
  // The state above preserves the one-shot flag for this mount; remove the
  // transport query parameter immediately so refreshes and copied URLs resume
  // normal cache behavior.
  useEffect(() => {
    if (!forceFreshTeamOnEntry) return;
    const [path, query = ""] = location.split("?");
    const params = new URLSearchParams(query);
    params.delete("ratesRefreshed");
    navigate(`${path}${params.toString() ? `?${params}` : ""}`, { replace: true });
  }, [forceFreshTeamOnEntry, location, navigate]);
  const { toast } = useToast();
  // One-shot read of the persisted page snapshot from the previous visit
  // (tenant+user scoped, 4h TTL — see lib/projectDetailCache). When present
  // the whole page — record fields, team, health gauge — renders instantly
  // with NO overlay, and the normal load below refreshes it silently.
  const [initialSnap] = useState<{ project: ProjectData; openRoles: OpenRole[] } | undefined>(() => {
    if (!id) return undefined;
    const snap = readProjectSnapshot<{ project: ProjectData; openRoles: OpenRole[] }>(id);
    // Sanity: only trust a snapshot whose payload really is this project.
    if (!snap?.project || String(snap.project.id).toUpperCase() !== id.toUpperCase()) return undefined;
    // A custom TicketId may exist in more than one module. When navigation
    // explicitly chose Project/Opportunity, never paint a cached Lead record
    // for the same text ID while the authoritative module-scoped fetch runs.
    if (requestedModule && snap.project.module !== requestedModule) return undefined;
    // Validate every snapshot's identity before using it. A stale snapshot
    // can be wrong for both standard and custom IDs (not just LD-####):
    // ModuleName/entityType must agree with the built shell, and a standard
    // PMM/OPM/LEM prefix must agree too. For custom IDs, one of the server
    // identity signals is mandatory — never trust the old PMM fallback.
    if (!/^(PMM|OPM|LEM)/i.test(String(snap.project.id ?? ""))) {
      const raw = (snap.project.rawFields ?? {}) as Record<string, unknown>;
      const claimed = String(raw.ModuleName ?? "").trim();
      const viaEntity = moduleFromEntityType(raw.entityType);
      const backed = (["PMM", "OPM", "LEM"].includes(claimed) && claimed === snap.project.module)
        || (!!viaEntity && viaEntity === snap.project.module);
      if (!backed) return undefined;
    }
    const raw = (snap.project.rawFields ?? {}) as Record<string, unknown>;
    const rawModule = String(raw.ModuleName ?? "").trim();
    const entityModule = moduleFromEntityType(raw.entityType);
    const expectedModule = standardModuleFromId(id);
    if (["PMM", "OPM", "LEM"].includes(rawModule) && rawModule !== snap.project.module) return undefined;
    if (entityModule && entityModule !== snap.project.module) return undefined;
    if (expectedModule && expectedModule !== snap.project.module) return undefined;
    return snap;
  });
  const projectRef = useRef<ProjectData | null>(initialSnap?.project ?? null);
  // Last full (non-fast) resource/team payload. In "fast" refreshes (right
  // after an hours/allocation save) these portfolio-wide/team-roster calls
  // are skipped and this cached copy is reused instead — a save only
  // changes weekly hours, never the resource master list or team roster,
  // so re-fetching them added multi-second latency for no visible change.
  const resDataRef = useRef<{ resources?: LiveResource[]; userGuidToName?: Record<string, string> }>({});
  const teamDataRef = useRef<{ team: ProjectTeamMember[]; openRoles: OpenRole[] }>({ team: [], openRoles: [] });
  const [project, setProject] = useState<ProjectData>(() => initialSnap?.project ?? ({
    id,
    name: id,
    status: "—",
    phase: "—",
    city: "",
    sector: "—",
    value: 0,
    laborValue: 0,
    company: "",
    bu: "",
    groupId: "",
    targetStart: "",
    targetEnd: "",
    actualStart: "",
    actualEnd: "",
    scheduleStart: "",
    scheduleEnd: "",
    closeDate: "",
    bidDate: "",
    probability: 0,
    module: getModule(id),
    allocations: [],
    keyPersonnel: [],
    guidToName: {},
    healthScore: -1,
    healthIssues: [],
    healthChecks: [],
    rawFields: {},
  }));
  // Display mode is module-aware: OPM/LEM records follow the opportunity-side
  // setting, PMM the project-side one (each with its own "applies to" audience).
  // A per-project override (the Schedule View dropdown on the team card) wins
  // over the company-wide setting; "Default" clears it back to Settings /
  // import auto-detect.
  useProjectViewModeVersion(); // re-render when the per-project layout changes
  const displayMode = getDisplayModeForRecord(project.id, project.module);
  // "no weekly grid" modes: team renders as a plain table with a Table↔Gantt toggle.
  // "schedule-no-grid" keeps phase cards; "no-schedule-no-grid" hides them.
  const noGridMode = displayMode === "no-schedule-no-grid" || displayMode === "schedule-no-grid";
  // Summary Only: no dates, no hours — a Gantt (timeline bars) would be empty,
  // so this mode gets just a plain table with no toggle at all.
  const summaryOnlyMode = displayMode === "no-schedule-no-hours";
  // "Lifecycle/schedule OFF" for the STATUS pickers: derived from the COMPANY
  // module-aware setting (getDisplayModeFor) — deliberately IGNORING the
  // per-record "Schedule View" layout override — using the exact same
  // expression as the Project Schedule card's render gate below, so the card
  // and the Status dropdown can never disagree about whether schedules are
  // shown. The per-record override is a LAYOUT preference for the team
  // section; statuses-follow-schedules is a company-wide data-model rule —
  // keying it off the override made the picker dump the full status pile on a
  // record whose card was simultaneously prompting "No lifecycle assigned".
  const companyDisplayMode = getDisplayModeFor(project.module);
  const scheduleOff = companyDisplayMode === "no-schedule" || companyDisplayMode === "no-schedule-no-grid" || companyDisplayMode === "no-schedule-no-hours";
  // Leads never have a phase schedule or weekly grid — regardless of the
  // tenant display mode their team renders as the plain no-grid table
  // (start date + end date + hours) with the Table ↔ Gantt toggle, and all
  // member editing goes through the dates + total-hours Edit Assignment
  // modal. `teamNoGrid` is the union flag the team section branches on.
  const isLeadRecord = project.module === "LEM";
  const teamNoGrid = noGridMode || isLeadRecord;
  // A snapshot can seed the record data, but it must not mark the page ready
  // before this session's per-record permission verdict arrives. Otherwise a
  // complete-looking read-only page flashes on first navigation and only gains
  // its edit controls after a later refresh.
  const [loading, setLoading] = useState(!initialSnap);
  const [error, setError] = useState("");
  // One-way latch: goes true once BOTH Phase 1 (`loading` → false, record
  // fields arrived) AND Phase 2 (`coreDataSettled` — team + schedule +
  // allocations settled) complete, or the 10s safety timer fires — whichever
  // comes first. Controls the initial full-screen overlay. Unlike directly
  // using `loading`, this never re-triggers: once the latch fires it stays
  // true, so background retries and silent refreshes can't re-show the overlay.
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  // True once loadProject's Phase 2 Promise.all settles (every call carries
  // its own 8-12s timeout, so this is bounded). All six calls launch in
  // parallel at mount, so waiting for Phase 2 adds no serial latency — the
  // overlay simply stays up until the team + schedule data it fetched is on
  // screen, instead of dropping early and exposing a second round of
  // spinners (user mandate: when the processing bar finishes, the page must
  // be complete). NOT gated on teamPending — the empty-team retry cycle can
  // run for ~40s and must never hold the overlay (old lesson: reads as
  // "page is stuck").
  const [coreDataSettled, setCoreDataSettled] = useState(() => Boolean(initialSnap));
  // "Schedule already ended" popup (PMM + has a schedule only): when the last
  // phase's end date is in the past, the project is auto-marked Closed (once,
  // close-only — never re-opened) and this prompt tells the user, offering
  // Close (dismiss) or Edit Schedule (jump to the schedule section). Refs are
  // keyed by record id so background refreshes/retries never re-pop the modal
  // for the same record. The status WRITE happens server-side (task-data
  // route) — the client only patches the display and shows the popup.
  const [schedEndedPrompt, setSchedEndedPrompt] = useState<{ endDate: string; autoClosed: boolean } | null>(null);
  const schedPromptShownRef = useRef("");
  // Live draft values for BU and Division so the cascade filters update in
  // real time as the user picks from the dropdown — before the value is saved
  // and the background reload reconciles. Reset when editing is cancelled.
  const [activeBuDraft, setActiveBuDraft] = useState<string>("");
  const [activeDivDraft, setActiveDivDraft] = useState<string>("");
  const [buOptions, setBuOptions] = useState<string[]>([]);
  const [buList, setBuList] = useState<{ id: string; title: string }[]>([]);
  const [divData, setDivData] = useState<{ ID: number; Title: string; BusinessUnitIdLookup?: string | null }[]>([]);
  const [deptData, setDeptData] = useState<{ ID: number; Title: string; DivisionIdLookup?: string | null }[]>([]);
  // All sections start collapsed (including Schedule/Timeline — per user
  // preference the page should open clean with nothing pre-expanded). The
  // two summary stat cards at the top of the page (Team avatar pile +
  // Health ring) already convey the highest-signal info graphically and
  // load instantly from the main project payload. Heavy sections
  // (Schedule, Business Units, Budget, Team, Details) stay minimised until
  // the user opens them. Their underlying data is pre-warmed in the
  // background so the first open is instant.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(),
  );
  const [auditOpen, setAuditOpen] = useState(false);
  // Active lifecycle template name reported up from SchedulePhases — shown as
  // a subtitle in the "Project / Opportunity Schedule" card header.
  const [schedLcTitle, setSchedLcTitle] = useState<string | null>(null);

  // The /project/:id route reuses this SAME component instance when the user
  // navigates from one record to another (only the projectId prop changes),
  // so React state survives the navigation. Without this reset, a section
  // left open on one record (e.g. the Schedule on a project) would still be
  // open when the user lands on the next record — which read as "the
  // Opportunity Schedule opens by default". Reset the accordion whenever the
  // record id changes so every record opens fully collapsed. The ref guard
  // skips the initial mount so the ?section=notes deep-link below still works.
  const prevRecordIdRef = useRef(projectId);
  useEffect(() => {
    if (prevRecordIdRef.current !== projectId) {
      prevRecordIdRef.current = projectId;
      setExpandedSections(new Set());
      setAuditOpen(false);
      setSchedLcTitle(null);
      // Record→record navigation reuses this component instance — clear the
      // previous record's "schedule ended" popup so it can't linger (the
      // show-once refs compare against the CURRENT id, so the new record
      // still gets its own popup if its schedule has also ended).
      setSchedEndedPrompt(null);
      // Team-fetch state is also per-record: without these resets, a team
      // load failure on record A leaks into record B — B would flash A's
      // failure card AND inherit A's exhausted retry budget (its first
      // timed-out fetch would give up immediately with zero retries).
      teamRetryCount.current = 0;
      teamUnreliableRef.current = false;
      setTeamLoadFailed(false);
    }
  }, [projectId]);

  // ?section= deep links. "notes" opens the Notes card; "team" (used by the
  // demand "resolve" flows on Home, Daily Briefing and Resources → Demand)
  // opens the Project Team card, and &highlight=open pulses the open-position
  // rows inside it. Re-evaluated on record change because this route reuses
  // the same component instance for record→record navigation (the reset
  // effect above runs first and collapses everything).
  const [highlightOpenRoles, setHighlightOpenRoles] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const section = params.get("section");
    setHighlightOpenRoles(section === "team" && params.get("highlight") === "open");
    if (section === "notes") {
      setExpandedSections((prev) => { const s = new Set(prev); s.add("notes-section"); return s; });
      setTimeout(() => {
        document.getElementById("notes-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
    } else if (section === "team") {
      // Expanding the card is enough to bring it into view — SectionCard
      // auto-scrolls itself the first time it expands.
      setExpandedSections((prev) => { const s = new Set(prev); s.add("team"); return s; });
    }
  }, [projectId]);

  const [openRoles, setOpenRoles] = useState<OpenRole[]>(() => initialSnap?.openRoles ?? []);
  const [assignSlot, setAssignSlot] = useState<OpenRole | null>(null);

  // Team deep-link phase 2: once the open-position rows are actually on
  // screen (they arrive async with the team payload), center them and let
  // the pulse run for a few seconds before settling down.
  useEffect(() => {
    if (!highlightOpenRoles) return;
    if (openRoles.length === 0) {
      // Nothing to highlight (yet) — drop the flag after a grace period so
      // a position added manually later in the same visit doesn't pulse.
      const t = setTimeout(() => setHighlightOpenRoles(false), 15000);
      return () => clearTimeout(t);
    }
    // Wait for the SectionCard's own smooth-scroll animation (~400–600ms) to
    // finish before scrolling to the open-positions block, then retry every
    // 150ms until the element is in the DOM and visible (it renders only when
    // openRoles.length > 0 and the card body is display:block).
    let attempts = 0;
    let retryT: ReturnType<typeof setTimeout>;
    const tryScroll = () => {
      const el = document.getElementById("open-roles-block");
      if (el && el.offsetParent !== null) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (attempts < 20) {
        attempts++;
        retryT = setTimeout(tryScroll, 150);
      }
    };
    const scrollT = setTimeout(tryScroll, 800);
    const clearT = setTimeout(() => setHighlightOpenRoles(false), 9000);
    return () => { clearTimeout(scrollT); clearTimeout(retryT); clearTimeout(clearT); };
  }, [highlightOpenRoles, openRoles.length]);
  const [editAllocPerson, setEditAllocPerson] = useState<EditAllocPerson | null>(null);
  const [editMemberAlloc, setEditMemberAlloc] = useState<Allocation | null>(null);
  // Set when the pencil was clicked on ONE period row of a multi-period
  // assignment (SimpleTeamTable) — the Edit Assignment modal then prefills and
  // saves THAT period only, leaving the member's other periods untouched.
  const [editMemberPeriod, setEditMemberPeriod] = useState<{ startDate: string; endDate: string; hours: number; rwiId?: number | null } | null>(null);
  // Change Resource: the outgoing member whose remaining weeks are being
  // handed to someone else (opens the role-first modal in change mode).
  const [changeResourceFor, setChangeResourceFor] = useState<{ name: string; resourceId: string; role?: string; title?: string; bu?: string; divisionId?: string } | null>(null);
  // Error line for a failed remove-from-team (shown above the team table).
  const [removeMemberErr, setRemoveMemberErr] = useState("");
  const [showAddMember, setShowAddMember] = useState(false);
  // Contract-value audit trail popup (#724) — opened from the tiny clock on
  // the money DetailCells; affordance + endpoint both gated on financials.
  const [valueHistoryOpen, setValueHistoryOpen] = useState(false);
  // Person seed for the Add Team Member modal — set when the user picks a
  // person from the schedule grid's toolbar search ("Search & add member…"),
  // so the modal opens with that person pre-selected + their org auto-filled.
  const [addMemberSeed, setAddMemberSeed] = useState<{ personId: string; personName: string; title: string } | null>(null);
  // Project Leads card — add/remove state
  const [kpAdding, setKpAdding] = useState(false);
  const [kpSaving, setKpSaving] = useState(false);
  const [kpErr, setKpErr] = useState("");
  const [kpConfirmField, setKpConfirmField] = useState("");
  const [kpPeople, setKpPeople] = useState<{ id: string; name: string; title: string }[]>([]);
  const [showOpenPos, setShowOpenPos] = useState(false);
  const [templateModal, setTemplateModal] = useState<{ mode: "save" | "apply" } | null>(null);
  // Pre-warm the allocation-templates cache the moment the page mounts so the
  // Apply Template modal opens instantly. Without this, the first open each
  // session fires the fetch late — queued behind the page's slower data loads
  // (browser per-origin connection limit) — and the list can take a minute to
  // appear. The call is tiny (~1s server-side) when it runs up-front.
  useEffect(() => { void getAllocTemplates().catch(() => undefined); }, []);

  // Seed team search from ?member= URL param — set when navigating from "Edit Allocation"
  const urlSearch = useSearch();
  const memberParam = useMemo(() => new URLSearchParams(urlSearch).get("member") ?? "", [urlSearch]);
  const [teamSearch, setTeamSearch] = useState(memberParam);
  useEffect(() => { if (memberParam) setTeamSearch(memberParam); }, [memberParam]);
  const [teamViewTab, setTeamViewTab] = useState<"list" | "schedule">("schedule");
  // For the two no-weekly-grid display modes the team section offers a
  // Table ↔ Gantt toggle (mirrors the Schedule/Gantt toggle in full mode).
  const [noGridView, setNoGridView] = useState<"table" | "gantt">("table");
  const layoutPickerRef = useRef<TeamViewModePickerHandle>(null);
  // Choosing a no-grid layout from the Layout picker should land on the
  // primary table immediately, even if this reused record view was previously
  // left on Gantt.
  useEffect(() => {
    if (noGridMode) setNoGridView("table");
  }, [noGridMode]);
  const [companyProjects, setCompanyProjects] = useState<{ id: string; name: string; module: string; status: string; value: number; city?: string; sector?: string }[]>([]);
  const [companyContacts, setCompanyContacts] = useState<{ id: string; name: string; title?: string; email?: string; phone?: string }[]>([]);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [showHealthMath, setShowHealthMath] = useState(false);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
  const [sectorOptions, setSectorOptions] = useState<string[]>([]);
  const [opmStageOptions, setOpmStageOptions] = useState<string[]>([]);
  // PMM ticket ID whose title matches THIS opportunity — set when a project
  // with the same name already exists (likely a prior conversion of this opp).
  // Derived on mount and whenever project.name changes: peeks the client-side
  // PMM list cache first (instant); falls back to a background fetch on miss.
  const [linkedPmmId, setLinkedPmmId] = useState<string | null>(null);
  useEffect(() => {
    if (project.module !== "OPM" || !project.name) { setLinkedPmmId(null); return; }
    const title = project.name.trim().toLowerCase();
    const findIn = (rows: Record<string, unknown>[]) =>
      rows.find(r => String(r.Title ?? "").trim().toLowerCase() === title);
    const peek = peekCached<{ data?: Record<string, unknown>[] }>("module:PMM");
    const hit = findIn(peek?.data ?? []);
    if (hit) { setLinkedPmmId(String(hit.TicketId ?? hit.ID ?? "") || null); return; }
    // Cache miss — load PMM list silently in the background.
    getModuleRecords("PMM").then(res => {
      const m = findIn((res as { data?: Record<string, unknown>[] })?.data ?? []);
      if (m) setLinkedPmmId(String(m.TicketId ?? m.ID ?? "") || null);
    }).catch(() => undefined);
  }, [project.module, project.name]);
  // Ordered phase titles from the record's OWN schedule (/task-data) — the
  // Status picker folds these in as statuses while the display mode actually
  // shows a schedule (same model as opportunities, where the pipeline stage
  // IS the status), and filters them back out when the schedule is hidden.
  // Tri-state: null = UNKNOWN (loading / just navigated), [] = CONFIRMED no
  // lifecycle assigned. The picker only switches to its "Select a lifecycle
  // schedule…" prompt on a confirmed empty, never while the fetch is in
  // flight.
  const [schedulePhases, setSchedulePhases] = useState<string[] | null>(null);
  // Monotonic load generation for schedulePhases: only the NEWEST loadProject
  // call may write it. This component instance is reused across record→record
  // navigation, so a LATE task-data answer from the previous record's load
  // must never overwrite the fresh reset (it would show record A's phases —
  // or its "no lifecycle" prompt — on record B).
  const schedPhaseGenRef = useRef(0);
  // Phase → {start,end} UTC-day map from the same task rows — drives the
  // "scheduled for later" guard on manual status picks (STATUS cell + the
  // lifecycle footer). Kept in lockstep with schedulePhases under the same
  // generation guard; null while unknown or when no schedule exists.
  const [schedulePhaseDates, setSchedulePhaseDates] = useState<Record<string, { start: string; end: string }> | null>(null);
  const [lemStatusOptions, setLemStatusOptions] = useState<string[]>([]);
  // ── Configurable Project Details fields ──
  // Users can pick any rawField key to surface as a DetailCell in the
  // Project Details card. Selections are persisted per-module so a PMM
  // user's chosen fields don't leak into OPM/LEM views. Until the user
  // customizes a list themselves, it FOLLOWS the admin-set company default
  // (Settings → Display Defaults) — see useDefaultableKeys.
  const detailFieldsStorageKey = `projectDetail.customFields.${getModule(id)}`;
  const { toast: notifyToast } = useToast();
  const displayDefaultsVersion = useDisplayDefaultsVersion();
  useEffect(() => { void loadDisplayDefaults(); }, []);
  const moduleAdminDefaults = useMemo(
    () => adminDetailDefaults(getModule(id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, displayDefaultsVersion],
  );
  // Drop suppressed keys (e.g. TicketId) that may have been pinned before
  // they were blocked — keeps the count badge honest.
  const stripSuppressed = useCallback((list: string[]) => list.filter((k) => !SUPPRESSED_FIELD_KEYS.has(k)), []);
  const stripBudgetSuppressed = useCallback(
    (list: string[]) => list.filter((k) => !BUDGET_SUPPRESSED_FIELD_KEYS.has(k)),
    [],
  );
  const { keys: customFieldKeys, setKeys: setCustomFieldKeys, reset: resetCustomFieldKeys, customized: customFieldsCustomized } =
    useDefaultableKeys(detailFieldsStorageKey, moduleAdminDefaults.pinned, stripSuppressed);
  const [showCustomizeFields, setShowCustomizeFields] = useState(false);
  const [customFieldSearch, setCustomFieldSearch] = useState("");
  // Navigating to a record in a different module closes/clears the panel
  // (the key lists themselves reload inside useDefaultableKeys).
  useEffect(() => {
    setCustomFieldSearch("");
    setShowCustomizeFields(false);
  }, [detailFieldsStorageKey]);
  // ── Hidden default fields + Budget & Costs customization ──
  // hiddenFieldKeys: default-shown fields the user has unticked in a
  // Customize panel. Shared by the Details and Budget cards so a field is
  // hidden wherever it would render. Persisted per-module like the pins.
  const { keys: hiddenFieldKeys, setKeys: setHiddenFieldKeys, reset: resetHiddenFieldKeys, customized: hiddenFieldsCustomized } =
    useDefaultableKeys(`projectDetail.hiddenFields.${getModule(id)}`, moduleAdminDefaults.hidden);
  const { keys: budgetCustomFieldKeys, setKeys: setBudgetCustomFieldKeys, reset: resetBudgetFieldKeys, customized: budgetFieldsCustomized } =
    useDefaultableKeys(`projectDetail.budgetCustomFields.${getModule(id)}`, moduleAdminDefaults.budgetPinned, stripBudgetSuppressed);
  // Admins can promote their CURRENT field setup (pins + hidden + budget pins
  // for this module) to the company-wide default everyone else inherits.
  // "unset" access level counts as admin — same grandfathering as the shell
  // nav; the server enforces the real gate on save.
  const isCompanyAdmin = getStoredUser()?.isAdmin !== false;
  const [savingCompanyDefault, setSavingCompanyDefault] = useState(false);
  const saveCompanyFieldDefaults = useCallback(async () => {
    setSavingCompanyDefault(true);
    try {
      // Merge onto the LATEST server copy — and fail HARD if we can't fetch
      // it. loadDisplayDefaults() never throws, so merging onto the local
      // snapshot after a failed refresh could silently erase the list-column
      // / view-mode defaults another admin saved. fetchDisplayDefaultsFor()
      // throws on any HTTP failure → we abort with the error toast instead.
      const cur = await fetchDisplayDefaultsFor();
      const next: DisplayDefaults = {
        ...cur,
        detail: {
          ...cur.detail,
          [getModule(id) as DisplayModule]: {
            pinned: customFieldKeys,
            hidden: hiddenFieldKeys,
            budgetPinned: budgetCustomFieldKeys,
          },
        },
      };
      await saveDisplayDefaults(next);
      notifyToast({ title: "Company default saved", description: "Everyone at your company now starts with these fields. Anyone who customized their own view keeps it." });
    } catch (e) {
      notifyToast({ title: "Could not save company default", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
    } finally {
      setSavingCompanyDefault(false);
    }
  }, [id, customFieldKeys, hiddenFieldKeys, budgetCustomFieldKeys, notifyToast]);
  const companyDefaultButton = isCompanyAdmin ? (
    <button
      onClick={() => { void saveCompanyFieldDefaults(); }}
      disabled={savingCompanyDefault}
      title="Make this exact field setup the starting default for everyone at your company (people who customized their own view keep it)"
      style={{
        padding: "6px 10px", borderRadius: 8,
        backgroundColor: ACCENT_PURPLE + "22",
        border: `1px solid ${ACCENT_PURPLE}66`,
        color: ACCENT_PURPLE, fontSize: 11, fontWeight: 700,
        cursor: savingCompanyDefault ? "default" : "pointer",
        opacity: savingCompanyDefault ? 0.6 : 1,
        whiteSpace: "nowrap",
      }}
    >{savingCompanyDefault ? "Saving…" : "Set as company default"}</button>
  ) : null;
  const [showCustomizeBudget, setShowCustomizeBudget] = useState(false);
  const [budgetFieldSearch, setBudgetFieldSearch] = useState("");
  const hiddenFieldSet = useMemo(() => new Set(hiddenFieldKeys), [hiddenFieldKeys]);
  // Fields whose LIST COLUMN an admin hid in Settings → Display Defaults:
  // hidden everywhere, including here on the record page (user mandate —
  // hiding "Client" from the grid must also hide the Client detail cell).
  const adminColHiddenSet = useMemo(
    () => new Set(adminColumnHiddenFields(getModule(id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, displayDefaultsVersion],
  );
  const fieldHidden = useCallback(
    (...keys: string[]) => keys.some((k) => hiddenFieldSet.has(k) || adminColHiddenSet.has(k)),
    [hiddenFieldSet, adminColHiddenSet],
  );
  // ModuleSpecificDetails takes a Set — give it the SAME user+admin union the
  // main details card gates on, or admin-hidden fields leak into module cells.
  const combinedHiddenSet = useMemo(
    () => (adminColHiddenSet.size ? new Set([...hiddenFieldSet, ...adminColHiddenSet]) : hiddenFieldSet),
    [hiddenFieldSet, adminColHiddenSet],
  );
  const toggleHiddenKey = useCallback((k: string) => {
    setHiddenFieldKeys((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);
  }, [setHiddenFieldKeys]);
  const fadeRef = useRef<HTMLDivElement>(null);
  // Counts silent background retries after an initial team-data timeout, so
  // we keep polling until the team actually loads (cold RDS pools can take
  // 30-60s on the very first call) instead of giving up after one attempt —
  // capped so a genuinely-empty team doesn't retry forever.
  const teamRetryCount = useRef(0);
  const TEAM_MAX_RETRIES = 6;
  // True when the last settled team fetch TIMED OUT and returned empty.
  // Such a state must never be persisted to the page snapshot — we don't
  // know whether the team is really empty (same rule as the rmone:v1:team
  // cache below).
  const teamUnreliableRef = useRef(false);
  // True while a background team-data retry is in flight (see loadProject's
  // silent-retry block below). Without this, the FIRST load's `loading` flag
  // flips false as soon as it resolves — even when it came back empty and a
  // retry was just scheduled — so the Project Team card briefly flashes
  // "No Team Assigned" before the retry lands a few seconds later. Keeping
  // the section in its loading state across retries removes that flash.
  // Starts false on snapshot-seeded visits: a snapshot is only ever written
  // in a settled state (see the persist effect below), so the seeded team —
  // even a genuinely-empty one — renders immediately with no spinner while
  // the silent refresh revalidates in the background.
  const [teamPending, setTeamPending] = useState(!initialSnap);
  // True when the team fetch exhausted ALL its retries and every attempt
  // timed out — the team state is UNKNOWN, not confirmed-empty. Renders an
  // honest "taking longer than usual — Retry" card instead of silently
  // settling on "No Team Assigned" (which forced users to refresh the whole
  // page to find out their team actually exists).
  const [teamLoadFailed, setTeamLoadFailed] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadProject = useCallback(async (silent = false, fast = false, fetchTeam = false) => {
    if (!id) return;
    // Claim the schedule-phases write slot: any previously in-flight load
    // (same record or a prior one) becomes stale and must not write phases.
    const schedPhaseGen = ++schedPhaseGenRef.current;
    try {
      if (!silent) { setLoading(true); setError(""); }
      // Track this project as recently visited so the login prefetcher can
      // warm its cache proactively on next sign-in (just stores the ID string).
      // Runs for silent loads too (snapshot-seeded visits are silent) — only
      // fast post-save refreshes skip it.
      if (!fast) { try { recordRecentProject(id); } catch { /* ignore */ } }

      // ── Instant team from the in-memory seed cache (stale-while-revalidate) ──
      // On a repeat visit within this session (non-silent, non-fast), seed the
      // team section from the last successful fetch so the user sees names
      // immediately instead of a spinner while the server round-trip completes.
      // The real fetch below will overwrite this with up-to-date data.
      if (!silent && !fast) {
        try {
          const lsRaw = memSeed.getItem(`rmone:v1:team:${id}`);
          if (lsRaw) {
            const { allocations: ca, openRoles: cr, ts } = JSON.parse(lsRaw) as {
              allocations: Allocation[]; openRoles: OpenRole[]; ts: number;
            };
            const age = Date.now() - ts;
            if (Array.isArray(ca) && ca.length > 0 && age < 30 * 60 * 1000) {
              // Non-empty team: stale-while-revalidate up to 30 min.
              setProject(prev => ({ ...prev, allocations: ca }));
              setOpenRoles(cr ?? []);
              setTeamPending(false);
            } else if (Array.isArray(ca) && ca.length === 0 && age < 60_000) {
              // Confirmed-empty team: skip spinner for 60 s so re-opening the
              // same project (back → forward) shows "No Team Assigned" instantly
              // instead of spinning through the retry cycle again.
              setTeamPending(false);
            }
          }
        } catch { /* localStorage unavailable */ }
      }

      // Per-call timeout so a single slow/hung RM ONE upstream call can
      // never stall the whole page. Previously a 30s+ stall on any one
      // of these six calls would freeze the overlay on "Rendering
      // dashboard" indefinitely; now each call resolves to its empty
      // default after 12s and the page renders with whatever data is
      // available.
      // Tracks whether the team-data call specifically hit its timeout (vs.
      // resolving normally with a genuinely-empty team). Only a real timeout
      // means the RDS pool/query didn't answer in time; a normal resolve with
      // 0 members is a legitimate "no team assigned" result and must not
      // trigger the cold-pool retry loop below.
      let teamCallTimedOut = false;
      const withTimeout = <T,>(p: Promise<T>, fallback: T, ms = 25000, onTimeout?: () => void): Promise<T> =>
        new Promise<T>((resolve) => {
          let done = false;
          const t = setTimeout(() => { if (!done) { done = true; onTimeout?.(); resolve(fallback); } }, ms);
          p.then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } })
           .catch(() => { if (!done) { done = true; clearTimeout(t); resolve(fallback); } });
        });

      // Also pull the module's records list — its row for this project
      // carries Title/Description/Sector/etc. that the single-record
      // /project/:id endpoint sometimes omits. The list is cached
      // page-wide (5-min server cache + sessionStorage on the client) so
      // this call is essentially free when the user navigated in from
      // the Pipeline page. We MERGE the list row UNDER the single-record
      // response so any field the detail endpoint does return still wins.
      // Use the already-known module from the current ref when it belongs to
      // this same record — avoids fetching the wrong module's records list for
      // custom-prefix IDs (e.g. LD-XXXX leads whose prefix isn't in getModule).
      // Falls back to getModule only for cold first loads with no prior data.
      const knownModule = projectRef.current?.id?.toUpperCase() === id.toUpperCase()
        ? projectRef.current?.module
        : undefined;
      let mod = ((knownModule && ["PMM", "OPM", "LEM"].includes(knownModule))
        ? knownModule
        : getModule(id)) as "PMM" | "OPM" | "LEM";
      const emptyRecords = { total: 0, data: [] as Record<string, unknown>[] };

      const sv = (v: unknown): string => (v != null && String(v).trim() && !String(v).startsWith("0001") ? String(v).trim() : "");
      const num = (v: unknown): number => Number(v) || 0;
      // Build the page-level ProjectData shell from a raw field bag. Shared by
      // the instant list-row seed just below AND the authoritative Phase-1
      // merge further down, so the two mappings can never drift apart.
      const buildShell = (d: Record<string, unknown>): ProjectData => ({
        id,
        name: sv(d.Title) || sv(d.RecordTitle) || sv(d.Name) || id,
        status: sv(d.CRMProjectStatusChoice) || sv(d.Status) || sv(d.CRMOpportunityStatusChoice) || "—",
        phase: sv(d.CRMProjectStatusChoice) || sv(d.Phase) || sv(d.Status) || "—",
        city: sv(d.City) || sv(d.ProjectCity),
        sector: sv(d.SectorChoice) || sv(d.Sector) || sv(d.MarketSector) || "—",
        value: num(d.ApproxContractValue) || num(d.ContractValue) || num(d.ContractedAmount) || num(d.EstContractValue) || 0,
        laborValue: num(d.LaborContractAmount) || 0,
        company: sv(d.CompanyName) || sv(d.CRMCompanyLookupName) || sv(d.ClientName) || sv(d.Client),
        // If CRMBusinessUnitChoice is present (even as "") the user explicitly set/cleared
        // it — use its value directly without falling through to the sibling columns.
        // Sibling fallback (BusinessUnit / BusinessUnitName) only applies when the field
        // is absent (null/undefined), i.e. schema predates the CRM column or was never written.
        bu: (d.CRMBusinessUnitChoice !== null && d.CRMBusinessUnitChoice !== undefined)
          ? sv(d.CRMBusinessUnitChoice)
          : sv(d.BusinessUnit) || sv(d.BusinessUnitName),
        groupId: sv(d.GroupId),
        targetStart: sv(d.TargetStartDate), targetEnd: sv(d.TargetCompletionDate),
        actualStart: sv(d.ActualStartDate), actualEnd: sv(d.ActualCompletionDate),
        // Seed the schedule window from the list row's _ScheduleStart/_ScheduleEnd
        // (attached server-side to PMM/OPM list rows). Without this the instant
        // seed + Phase-1 shell render with an empty schedule, so GanttTimeline
        // briefly shows the raw Target band (often a single date on imported
        // records) and then flips to the schedule-derived Actual band once the
        // task fetch lands — a visible "wrong dates" flash. The Phase-2 task
        // fetch remains authoritative and overwrites these below.
        scheduleStart: sv(d._ScheduleStart), scheduleEnd: sv(d._ScheduleEnd),
        closeDate: sv(d.CloseDate),
        bidDate: sv(d.BidDate) || sv(d.BidDueDate),
        probability: num(d.SuccessChance) || num(d.ChanceofSuccessChoice) || num(d.WinProbability) || 0,
        // Prefer the server-reported module — a custom (user-supplied)
        // TicketId has no PMM/OPM prefix for getModule to sniff.
        // Secondary: use a module already confirmed by a prior API response
        // (in projectRef) so that an absent ModuleName never overwrites a
        // correct "LEM"/"OPM" with the "PMM" getModule fallback and
        // poisons the snapshot on the next write.
        module: (["PMM", "OPM", "LEM"].includes(sv(d.ModuleName))
          ? sv(d.ModuleName)
          : (moduleFromEntityType((d as Record<string, unknown>)["entityType"]) ?? knownModule ?? getModule(id))),
        allocations: [], keyPersonnel: [], guidToName: {},
        healthScore: 0, healthIssues: [], healthChecks: [],
        rawFields: d,
      });

      // ── Instant Details from the cached Projects-list row ──────────────────
      // Cold visits (no in-session snapshot) used to render every Details
      // field as "—" until the detail + list fetches landed — and the 8s
      // overlay safety latch could expose that blank state whenever those
      // calls were slow. When the user navigated in from the Projects page the
      // module records list is already in the client cache, so paint this
      // record's list row NOW; the Phase-1 merge below overwrites it with
      // authoritative detail fields the moment they arrive.
      if (!silent && !fast) {
        const cur = projectRef.current;
        const alreadyShown = !!cur && cur.id === id && Object.keys(cur.rawFields ?? {}).length > 0;
        if (!alreadyShown) {
          try {
            // Peek ALL module list caches, guessed module first: a custom
            // TicketId ("LD-0003") guesses PMM but its row lives in the LEM
            // list — finding it there paints the correct Lead layout
            // immediately (the row's ModuleName/entityType wins in buildShell).
            let row: Record<string, unknown> | undefined;
            // Explicit navigation (?module=) pins the seed to that list —
            // a custom TicketId may exist in more than one module.
            const seedCandidates = requestedModule
              ? [requestedModule]
              : [mod, "PMM", "OPM", "LEM"].filter((v, i, a) => a.indexOf(v) === i);
            for (const m of seedCandidates) {
              const peek = peekCached<{ data?: Record<string, unknown>[] }>(`module:${m}`);
              const candidate = (peek?.data ?? []).find((r) =>
                String(r.TicketId ?? r.Code ?? r.ProjectCode ?? r.RecordCode ?? "").toUpperCase() === id.toUpperCase());
              if (!candidate) continue;
              const candidateModule = String(candidate.ModuleName ?? "").trim();
              const entityModule = moduleFromEntityType(candidate.entityType);
              const idModule = standardModuleFromId(id);
              const resolved = ["PMM", "OPM", "LEM"].includes(candidateModule)
                ? candidateModule
                : entityModule ?? (idModule && idModule === m ? idModule : undefined);
              // A custom ID has no safe module inference. If an old cache
              // contains it under the guessed PMM list without identity
              // metadata, skip it and continue looking for the real row in
              // the other module caches.
              if (!resolved) continue;
              if (requestedModule && resolved !== requestedModule) continue;
              if (idModule && resolved !== idModule) continue;
              if (entityModule && entityModule !== resolved) continue;
              if (candidateModule && candidateModule !== resolved) continue;
              row = candidateModule ? candidate : { ...candidate, ModuleName: resolved };
              break;
            }
            if (row && Object.keys(row).length > 0) {
              // Adopt the seeded row's module so Phase-1's list fetch below
              // targets the RIGHT list — otherwise a detail failure would
              // rebuild from the guessed (PMM) list result and clobber this
              // correctly-seeded Lead/Opportunity shell.
              const seededMod = String(row.ModuleName ?? "").trim();
              if (["PMM", "OPM", "LEM"].includes(seededMod)) {
                mod = seededMod as "PMM" | "OPM" | "LEM";
              } else {
                const em = moduleFromEntityType(row.entityType);
                if (em) mod = em as "PMM" | "OPM" | "LEM";
              }
              setProject(buildShell({ ...row }));
              // Dismiss the overlay — the page renders with real list-row
              // data. The snapshot-persist effect cannot capture this partial
              // state: teamPending is still true and only fully-settled
              // states are ever written.
              setLoading(false);
            }
          } catch { /* seed is best-effort */ }
        }
      }

      // "fast" mode is used right after a hours/allocation mutation we just
      // made ourselves (Edit Allocation, Distribute evenly, Assign, etc) —
      // the project's own record fields (Title/Sector/Status/...) can't have
      // changed from that action, so skip re-fetching them (getProjectDetails,
      // getModuleRecords) and reuse what's already on screen. This cuts two
      // of the six calls — including the slowest 30s-timeout one — so the
      // team/hours grid updates in seconds instead of waiting on unrelated
      // data. Also uses shorter timeouts since our own write already
      // succeeded moments ago, so a fresh read should be fast too.
      // ── Launch all 6 calls immediately (fully parallel) ────────────────────
      // getProjectDetails + getModuleRecords are awaited first (Phase 1) so the
      // overlay is dismissed as soon as we have the page title / basic fields
      // (~1-3s). The four team/alloc/task calls are already in-flight during
      // Phase 1 so there is zero extra latency — Phase 2 just collects results
      // that have been resolving in the background.
      const detPromise  = fast ? Promise.resolve(null as unknown)
        : withTimeout(getProjectDetails(id, requestedModule ? { module: requestedModule } : undefined), null as unknown, 12000);
      const allocPromise = withTimeout(getProjectAllocations(id), { allocations: [] }, fast ? 8000 : 12000);
      const resPromise  = fast
        ? Promise.resolve(resDataRef.current)
        : withTimeout(getResourceAllocations(), { total: 0, bench: 0, underUtil: 0, healthy: 0, overAllocated: 0, resources: [] as LiveResource[] }, 12000);
      const teamPromise = fast && !fetchTeam
        ? Promise.resolve(teamDataRef.current)
        : withTimeout(getProjectTeam(id, forceFreshTeamOnEntry), { team: [] as ProjectTeamMember[], openRoles: [] as OpenRole[] }, 10000, () => { teamCallTimedOut = true; });
      // The returned page and its grid share this first cache-bypassing read.
      // Once it settles, restore normal cache behavior for subsequent reloads.
      if (forceFreshTeamOnEntry) {
        void teamPromise.finally(() => setForceFreshTeamOnEntry(false));
      }
      // Like teamCallTimedOut above: distinguishes a task fetch that did NOT
      // answer (timeout OR network error/5xx — schedule state UNKNOWN, keep the
      // list-row _ScheduleStart seed) from a normal resolve with zero tasks
      // (schedule genuinely absent — clear it). The rejection is caught HERE,
      // before withTimeout, because withTimeout's own .catch resolves the
      // fallback without invoking the onTimeout hook.
      let taskCallTimedOut = false;
      // Captured BEFORE the fetch launches — compared against
      // lastScheduleMutationTs when Phase 2 warms the schedule cache, so a
      // fetch that raced a schedule save can't write back stale tasks.
      const taskFetchLaunchTs = Date.now();
      const rawTaskPromise = getTaskData(id, "0");
      // Warm the Schedule section cache the moment the task data ACTUALLY
      // lands — attached to the RAW fetch promise so it (a) fires without
      // waiting for the slower team/alloc calls in Phase 2's Promise.all,
      // and (b) still fires when the fetch answers AFTER the 8-12s timeout
      // bound below (the old Phase-2 warm skipped that case entirely, so
      // the next section open cold-spun again). Errors never warm (the
      // .then only runs on a real resolve), and a schedule save that raced
      // this fetch wins via the mutation-timestamp guard.
      void rawTaskPromise.then((v) => {
        if (lastScheduleMutationTs < taskFetchLaunchTs) {
          try { setCachedSection("schedule", id, v); } catch { /* best-effort */ }
        }
      }).catch(() => { /* handled by taskCallTimedOut below */ });
      const taskPromise = withTimeout(
        rawTaskPromise.catch(() => { taskCallTimedOut = true; return [] as unknown[]; }),
        [] as unknown[], fast ? 8000 : 12000, () => { taskCallTimedOut = true; });
      const listPromise = fast || !(mod === "PMM" || mod === "OPM" || mod === "LEM")
        ? Promise.resolve(emptyRecords)
        : withTimeout(getModuleRecords(mod), emptyRecords, 12000);

      // ── Team-first: show team as soon as teamPromise resolves ────────────────
      // Don't wait for the slower allocPromise/resPromise to finish before
      // rendering the team section. As soon as team data arrives we build a
      // quick allocation list (no email/resData enrichment yet — that fills in
      // during Phase 2's full update moments later) and dismiss the spinner.
      let earlyTeamFired = false;
      void teamPromise.then((tRes) => {
        if (earlyTeamFired) return;
        const td = ((tRes as any)?.team ?? (Array.isArray(tRes) ? tRes : [])) as ProjectTeamMember[];
        if (td.length === 0) return;
        earlyTeamFired = true;
        const quickAllocs: Allocation[] = [];
        const seenQ = new Set<string>();
        for (const tm of td) {
          if (!tm.name) continue;
          const k = tm.resourceId ? `id:${tm.resourceId.toLowerCase()}` : `${tm.name.toLowerCase()}::${(tm.role ?? "").toLowerCase()}::${(tm.bu ?? "").toLowerCase()}`;
          if (seenQ.has(k)) continue;
          seenQ.add(k);
          quickAllocs.push({
            name: tm.name, role: tm.role || "", title: tm.title || "",
            dept: tm.dept ?? "", pct: tm.pctAllocation ?? 0,
            startDate: tm.startDate ?? "", endDate: tm.endDate ?? "",
            eacHrs: tm.eacHrs ?? 0, etcHrs: tm.etcHrs ?? 0,
            costRate: tm.costRate ?? 0, laborRate: tm.laborRate ?? 0,
            eacCost: tm.eacCost ?? 0, etcCost: tm.etcCost ?? 0,
            ncHrs: tm.ncHrs ?? 0, ncCost: tm.ncCost ?? 0,
            ncRate: (tm as any).ncRate ?? 0,
            hasWeeklyHours: (tm as any).weeklyHours?.length > 0 || (tm.eacHrs ?? 0) > 0 || (tm.etcHrs ?? 0) > 0,
            weeklyHours: (tm as any).weeklyHours ?? [],
            bu: tm.bu ?? "", divisionId: (tm as any).divisionId ?? "",
            memberBu: tm.memberBu ?? "", email: "",
            resourceId: tm.resourceId ?? "", rwiId: tm.rwiId ?? undefined,
            employeeType: tm.employeeType ?? "",
            softAllocation: tm.softAllocation === true,
            nonChargeable: tm.nonChargeable === true,
            isLocked: tm.isLocked === true,
            slices: tm.slices,
            weekHrsBasis: (tm as any).weekHrsBasis,
            enabled: tm.enabled,
            tenantId: tm.tenantId,
          });
        }
        if (quickAllocs.length === 0) return;
        setProject(prev => ({ ...prev, allocations: quickAllocs }));
        setOpenRoles(((tRes as any)?.openRoles ?? []) as OpenRole[]);
        setTeamPending(false);
        setTeamLoadFailed(false);
        // Seed the in-memory cache so the next visit this session shows the
        // team instantly (nothing persisted to browser storage).
        try {
          memSeed.setItem(`rmone:v1:team:${id}`, JSON.stringify({
            allocations: quickAllocs,
            openRoles: (tRes as any)?.openRoles ?? [],
            ts: Date.now(),
          }));
        } catch { /* non-serializable */ }
      }).catch(() => { /* team promise rejection already handled in Phase 2 */ });

      // ── Phase 1: project record fields → dismiss overlay immediately ────────
      // The detail response (a few KB) has everything the header + details
      // card needs, but the module records list (MBs on large tenants) used
      // to gate first paint too — seconds of "—" shell on cold opens. Wait
      // for the list ONLY when the detail failed/timed out (the list row is
      // then the sole rebuild source). When detail wins, the list still lands
      // moments later and back-fills blank fields silently (below).
      const detRes = await detPromise;
      const detHasData = Object.keys(
        ((detRes as { Data?: Record<string, unknown> | null })?.Data ?? {}) as Record<string, unknown>
      ).length > 0;
      const listRes = detHasData ? emptyRecords : await listPromise;

      // detRes = { Status: boolean, Data: Record|null }. When the project is not
      // found (e.g. old TicketId after a replace-mode import), the API returns
      // { Status: false, Data: null }. Falling back to `detRes` would merge the
      // wrapper { Status: false } into the record fields, making STATUS show "false".
      // Use {} instead of detRes so the wrapper never leaks into record display.
      const detD = ((detRes as { Data?: Record<string, unknown> | null })?.Data ?? {}) as Record<string, unknown>;
      const listRow = ((listRes as { data?: Record<string, unknown>[] })?.data ?? [])
        .find((r) => String(r.TicketId ?? r.Code ?? r.ProjectCode ?? r.RecordCode ?? "").toUpperCase() === id.toUpperCase()) || {};
      // Field-aware merge: detail endpoint wins for any field where it has
      // a meaningful value, but the list-row value fills in when detail
      // returns undefined / null / empty-string / whitespace.
      const isBlank = (v: unknown) =>
        v === undefined || v === null || (typeof v === "string" && v.trim() === "");
      // fast mode: detRes/listRes were never fetched (both null/empty), so
      // just reuse the record fields already on screen instead of merging
      // in blanks that would wipe out Title/Sector/etc.
      // Same protection when BOTH phase-1 sources came back empty (timed out
      // or failed — e.g. a background refresh after returning to a throttled
      // tab) and the page already shows this record: keep the fields on
      // screen instead of replacing every detail cell with blanks.
      const noNewData = !fast && Object.keys(detD).length === 0
        && Object.keys(listRow).length === 0;
      const prevGood = projectRef.current && projectRef.current.id === id
        && Object.keys(projectRef.current.rawFields ?? {}).length > 0
        ? projectRef.current : null;
      // STRICT id match: never fall back to projectRef.current when it holds a
      // DIFFERENT record (record→record navigation reuses this component
      // instance) — that would render and cache the previous project's fields
      // under this project's key. An id mismatch falls through to the blank
      // listRow, which the snapshot guard below refuses to persist.
      const base = fast ? projectRef.current : (noNewData ? prevGood : null);
      const d: Record<string, unknown> = base
        ? { ...base.rawFields }
        : { ...listRow };
      if (!fast) {
        for (const [k, v] of Object.entries(detD)) {
          if (!isBlank(v)) d[k] = v;
        }
      }

      // Render the page shell NOW — overlay disappears, user sees the project
      // title/header immediately. Team/health/allocations fill in during Phase 2.
      if (!fast) {
        const projShell: ProjectData = buildShell(d);
        if (silent && projectRef.current?.id === id) {
          // Silent refresh of an already-populated page (snapshot-seeded
          // visit, or a background reload after a field save): update the
          // record fields but KEEP the currently-rendered team + health so
          // the team section never flashes empty / respins while Phase 2
          // fetches the authoritative data.
          const prev = projectRef.current;
          const merged: ProjectData = {
            ...projShell,
            allocations: prev.allocations,
            keyPersonnel: prev.keyPersonnel,
            guidToName: prev.guidToName,
            healthScore: prev.healthScore,
            healthIssues: prev.healthIssues,
            healthChecks: prev.healthChecks,
            scheduleStart: prev.scheduleStart,
            scheduleEnd: prev.scheduleEnd,
          };
          projectRef.current = merged;
          setProject(merged);
        } else {
          // Record→record nav reuses this component instance: the previous
          // record's schedule phases must not leak into THIS record's Status
          // options while its task fetch is still in flight (and must not
          // survive a task-fetch timeout). Clear in the same render as the
          // shell swap; Phase 2 refills from this record's /task-data.
          if (projectRef.current && projectRef.current.id !== id) {
            setSchedulePhases((prev) => (prev === null ? prev : null));
            setSchedulePhaseDates((prev) => (prev === null ? prev : null));
          }
          projectRef.current = projShell;
          setProject(projShell);
          setTeamPending(true);  // team section shows its own inline spinner
        }
        setLoading(false);     // overlay gone — page is visible
      }

      // Late list merge: Phase 1 rendered on detail alone, so back-fill any
      // fields the detail left blank from this record's list row once the
      // (potentially large) module list arrives. Silent, id-guarded,
      // blank-fill only — never overwrites a detail value, and preserves the
      // live team/health/schedule parts exactly like the silent-refresh merge.
      if (!fast && detHasData) {
        void listPromise.then((lr) => {
          const row = ((lr as { data?: Record<string, unknown>[] })?.data ?? [])
            .find((r) => String(r.TicketId ?? r.Code ?? r.ProjectCode ?? r.RecordCode ?? "").toUpperCase() === id.toUpperCase());
          if (!row) return;
          // Merge into `d` — the SAME raw-field bag Phase 2 builds its final
          // project (and keyPersonnel/health inputs) from. If the list lands
          // BEFORE Phase 2 settles, Phase 2 simply builds from the enriched
          // bag; if AFTER, the setProject below re-applies the fields on top.
          // Either ordering converges — merging into a copy instead would let
          // Phase 2's unconditional setProject wipe a merge that landed in
          // between (list-only fields lost for the whole visit).
          let adds = 0;
          for (const [k, v] of Object.entries(row)) {
            if (isBlank(v) || !isBlank(d[k])) continue;
            d[k] = v; adds++;
          }
          if (adds === 0) return;
          if (projectRef.current?.id !== id) return;
          const shell = buildShell({ ...d });
          setProject((prev) => {
            if (prev.id !== id) return prev;
            const merged: ProjectData = {
              ...shell,
              allocations: prev.allocations,
              keyPersonnel: prev.keyPersonnel,
              guidToName: prev.guidToName,
              healthScore: prev.healthScore,
              healthIssues: prev.healthIssues,
              healthChecks: prev.healthChecks,
              scheduleStart: prev.scheduleStart,
              scheduleEnd: prev.scheduleEnd,
            };
            projectRef.current = merged;
            return merged;
          });
        }).catch(() => { /* enrichment only — detail already rendered */ });
      }

      // ── Phase 2: await remaining calls (already in-flight since Phase 1) ───
      const [allocRes, resRes, teamRes, taskRes] = await Promise.all([allocPromise, resPromise, teamPromise, taskPromise]);
      // Release the initial overlay gate: team + schedule answers are in hand
      // (or hit their bounded per-call timeouts). One-way — see state decl.
      setCoreDataSettled(true);
      // (Schedule section cache is warmed by the rawTaskPromise.then hook
      // above — it fires the moment the task data lands, even when that is
      // after this Promise.all settles or after the task timeout bound.)
      if (!fast) {
        resDataRef.current = resRes as { resources?: LiveResource[]; userGuidToName?: Record<string, string> };
        teamDataRef.current = teamRes as { team: ProjectTeamMember[]; openRoles: OpenRole[] };
      } else if (fetchTeam) {
        teamDataRef.current = teamRes as { team: ProjectTeamMember[]; openRoles: OpenRole[] };
      }

      const allocArr = ((allocRes as { allocations?: unknown[] })?.allocations ?? []) as Record<string, unknown>[];
      const resData = resRes as { resources?: LiveResource[]; userGuidToName?: Record<string, string> };
      const teamData = ((teamRes as any)?.team ?? (Array.isArray(teamRes) ? teamRes : [])) as ProjectTeamMember[];
      setOpenRoles(((teamRes as any)?.openRoles ?? []) as OpenRole[]);

      const resMap = new Map<string, LiveResource>();
      const resById = new Map<string, LiveResource>();
      if (resData?.resources) {
        for (const r of resData.resources) {
          if (r.username) resMap.set(r.username.toLowerCase(), r);
          if (r.name) resMap.set(r.name.toLowerCase(), r);
          if (r.id) resById.set(r.id.toLowerCase(), r);
        }
      }

      const allocByName = new Map<string, Record<string, unknown>>();
      for (const a of allocArr) {
        let name = String(a.AssignedToName ?? a.ResourceUser ?? a.Name ?? "");
        if (/^[0-9a-f]{8}-/.test(name) || !name) {
          const userId = String(a.AssignedTo ?? "").toLowerCase();
          const res = resById.get(userId) ?? resMap.get(userId);
          if (res) name = res.name;
        }
        if (name && !allocByName.has(name.toLowerCase())) allocByName.set(name.toLowerCase(), a);
      }

      const allocations: Allocation[] = [];
      const seen = new Set<string>();

      if (teamData && teamData.length > 0) {
        for (const tm of teamData) {
          if (!tm.name) continue;
          const tmKey = tm.resourceId ? `id:${tm.resourceId.toLowerCase()}` : `${tm.name.toLowerCase()}::${(tm.role || "").toLowerCase()}::${(tm.bu || "").toLowerCase()}`;
          if (seen.has(tmKey)) continue;
          seen.add(tmKey);
          const resTm = resMap.get(tm.name.toLowerCase());
          const allocEntry = allocByName.get(tm.name.toLowerCase());
          let role = tm.role || "";
          if (!role && allocEntry) role = String(allocEntry.TypeName ?? allocEntry.RoleName ?? "");
          allocations.push({
            name: tm.name, role, title: tm.title || "",
            dept: tm.dept ?? "",
            pct: tm.pctAllocation ?? Number(allocEntry?.PctAllocation ?? 0),
            startDate: tm.startDate ?? String(allocEntry?.AllocationStartDate ?? "").slice(0, 10),
            endDate: tm.endDate ?? String(allocEntry?.AllocationEndDate ?? "").slice(0, 10),
            eacHrs: tm.eacHrs ?? 0, etcHrs: tm.etcHrs ?? 0,
            costRate: tm.costRate ?? 0, laborRate: tm.laborRate ?? 0, eacCost: tm.eacCost ?? 0, etcCost: tm.etcCost ?? 0,
            ncHrs: tm.ncHrs ?? 0, ncCost: tm.ncCost ?? 0,
            ncRate: (tm as any).ncRate ?? 0,
            hasWeeklyHours: (tm.weeklyHours?.length ?? 0) > 0 || (tm.eacHrs ?? 0) > 0 || (tm.etcHrs ?? 0) > 0,
            weeklyHours: tm.weeklyHours ?? [],
            bu: tm.bu ?? "", divisionId: (tm as any).divisionId ?? "", memberBu: tm.memberBu ?? "", email: resTm?.username ?? "",
            resourceId: tm.resourceId ?? String(allocEntry?.ResourceId ?? allocEntry?.ResourceID ?? ""),
            rwiId: tm.rwiId ?? undefined,
            employeeType: tm.employeeType ?? "",
            softAllocation: tm.softAllocation === true,
            nonChargeable: tm.nonChargeable === true,
            isLocked: tm.isLocked === true,
            slices: tm.slices,
            weekHrsBasis: (tm as any).weekHrsBasis,
            enabled: tm.enabled,
            tenantId: tm.tenantId,
          });
        }
      }

      const seenNames = new Set(allocations.map((a) => a.name.toLowerCase()));
      // When the team call TIMED OUT (common right after a save — the fresh
      // DB fetch can exceed the 10s budget) do NOT rebuild the cards from the
      // raw allocations list: its PctAllocation column stores raw HOURS (see
      // memory/pctallocation-is-hours-not-percent), which renders as absurd
      // values like "326%". Keep the previously rendered team instead — the
      // retry cycle below fetches the fresh team and replaces it moments later.
      const prevAllocs = (teamCallTimedOut && projectRef.current?.id === id)
        ? (projectRef.current?.allocations ?? [])
        : [];
      if ((!teamData || teamData.length === 0) && prevAllocs.length > 0) {
        for (const p of prevAllocs) {
          if (!p.name || seenNames.has(p.name.toLowerCase())) continue;
          seenNames.add(p.name.toLowerCase());
          allocations.push(p);
        }
      }
      const useAllocFallback = (!teamData || teamData.length === 0) && allocations.length === 0;
      for (const a of (useAllocFallback ? allocArr : [])) {
        let name = String(a.AssignedToName ?? a.ResourceUser ?? a.Name ?? "");
        if (/^[0-9a-f]{8}-/.test(name) || !name) {
          const userId = String(a.AssignedTo ?? "").toLowerCase();
          const res = resById.get(userId) ?? resMap.get(userId);
          if (res) name = res.name;
        }
        if (!name || seenNames.has(name.toLowerCase())) continue;
        seenNames.add(name.toLowerCase());
        let role = String(a.TypeName ?? a.RoleName ?? "");
        if (!role) {
          const userId = String(a.AssignedTo ?? "").toLowerCase();
          const resPerson = resById.get(userId) ?? resMap.get(name.toLowerCase());
          if (resPerson) role = resPerson.role || "";
        }
        const userId = String(a.AssignedTo ?? "").toLowerCase();
        const resMember = resById.get(userId) ?? resMap.get(name.toLowerCase());
        const titleFromAlloc = String(a.Title ?? a.JobTitle ?? a.Position ?? "").trim();
        const buFromAlloc = String(a.DivisionName ?? a.Division ?? a.Department ?? "").trim();
        allocations.push({
          name, role, title: titleFromAlloc || resMember?.role || "",
          pct: Number(a.PctAllocation ?? 0),
          startDate: String(a.AllocationStartDate ?? "").slice(0, 10),
          endDate: String(a.AllocationEndDate ?? "").slice(0, 10),
          eacHrs: 0, etcHrs: 0, costRate: 0, laborRate: 0, eacCost: 0, etcCost: 0, ncHrs: 0, ncCost: 0,
          hasWeeklyHours: false, bu: buFromAlloc, email: resMember?.username ?? "",
          resourceId: String(a.ResourceId ?? a.ResourceID ?? ""),
        });
      }

      const guidToName = (resData as { userGuidToName?: Record<string, string> })?.userGuidToName ?? {};
      const keyPersonnel: KeyPersonnelEntry[] = [];
      for (const { field, role: roleName } of KP_FIELD_ROLES) {
        const val = typeof d[field] === "string" ? (d[field] as string) : "";
        if (!val.trim()) continue;
        // A *User column can hold MULTIPLE people as a comma/semicolon-separated
        // list (the Add Lead flow appends; legacy imports stored GUID lists).
        // Emit one entry per resolved token so every lead shows on the card.
        const seenTok = new Set<string>();
        for (const rawTok of val.split(/[,;]+/)) {
          const tok = rawTok.replace(/^#/, "").trim();
          if (!tok) continue;
          const tokKey = tok.toLowerCase();
          if (seenTok.has(tokKey)) continue;
          seenTok.add(tokKey);
          if (/^[0-9a-f]{8}-/.test(tokKey)) {
            // GUID token (upstream data stores GUIDs) — resolve to a name;
            // unresolvable GUIDs are skipped (never show a raw GUID).
            const name = guidToName[tokKey] || guidToName[tok] || "";
            if (name) keyPersonnel.push({ name, role: roleName, guid: tokKey, field });
          } else {
            // Imported / user-added data stores email or display name directly
            keyPersonnel.push({ name: tok, role: roleName, guid: tok, field });
          }
        }
      }
      // Custom (user-typed) roles — stored as ONE JSON column on the record
      // (names only, never GUIDs). Sentinel field `custom:<role>` lets the
      // add/remove flows tell them apart from real *User columns.
      for (const { role, name } of listCustomLeads(d[CUSTOM_LEADS_FIELD])) {
        keyPersonnel.push({ name, role, guid: name, field: `${CUSTOM_ROLE_PREFIX}${role}` });
      }
      // NOTE: entries set via the *User fields are shown verbatim, even when
      // the same person also appears in the Project Team — leads are now
      // user-managed (add/remove on the card), so what was explicitly set must
      // stay visible. (The old dedup-against-team pass was removed; it also
      // never applied to the render-time fallback path, so partial dedup made
      // the two paths inconsistent.)
      // ── Team-role fallback ─────────────────────────────────────────────────
      // Synthesise Key Personnel from team members whose job title matches a
      // standard lead label. These entries carry no `field`, so the card shows
      // them without a remove button (they follow the team assignment, not a
      // record column). This pass is ADDITIVE: it always runs, and only skips
      // people already listed explicitly. It must NOT be gated on
      // keyPersonnel.length === 0 — that made every synthesised lead vanish
      // the moment the first explicit lead was added, which read as "adding a
      // lead REPLACED the existing ones".
      // (Mapping + additive pass live in lib/leadSynthesis.ts — the projects
      // Data Grid mirrors this card from the same module, so the two surfaces
      // cannot drift.)
      for (const s of synthesizeTeamLeads(teamData, keyPersonnel)) {
        keyPersonnel.push({ name: s.name, role: s.role, guid: s.guid });
      }

      // Retry when team comes back empty for two distinct reasons:
      //
      // 1. teamCallTimedOut — the RDS pool was cold and the 10s timeout fired
      //    before the query answered. Keep retrying (up to TEAM_MAX_RETRIES)
      //    so the team appears once the pool warms up.
      //
      // 2. Fast-empty on first attempt — the server replied quickly with []
      //    without timing out. This happens when the pool returns early before
      //    all rows land, or a connection-level race clears the result set.
      //    Since api.ts already busts the cache for empty results, the retry
      //    issues a fresh network call. One single retry is enough: if that
      //    also comes back empty the project genuinely has no team.
      //    We only do this on the FIRST attempt (retryCount === 0) to avoid
      //    adding a delay to every project that truly has no members.
      // Retry on any empty result (not only the first attempt) so a cold pool
      // that returns [] on the first AND second call still eventually fills in
      // the team, up to TEAM_MAX_RETRIES. api.ts busts the cache for empty
      // results so each retry issues a real network call.
      const fastEmptyFirstTry = !teamCallTimedOut && teamData.length === 0;
      // Guard: we're on a valid project page if detD has fields OR the project
      // is already in projectRef (which happens on every retry after the first
      // load). Checking ONLY detD was too strict — for RDS tenants the upstream
      // getProjectDetails call can be slow/unavailable on retries, returning {}
      // even though the project is fully loaded, which silently stopped all
      // further retries.
      const validProjectPage = (detD && Object.keys(detD).length > 0) || projectRef.current?.id === id;
      // Separate retry budgets for the two distinct empty-team causes:
      //   • teamCallTimedOut → DB pool was cold; retry up to TEAM_MAX_RETRIES.
      //   • fastEmptyFirstTry → got a quick [] back; almost always a genuine
      //     no-team project. One single re-check is enough to rule out a
      //     transient race. Without this cap the old code spun for ~40 s on
      //     every newly-created (empty) project.
      const maxRetriesForCase = teamCallTimedOut ? TEAM_MAX_RETRIES : 1;
      if (teamData.length === 0 && (teamCallTimedOut || fastEmptyFirstTry) && teamRetryCount.current < maxRetriesForCase && validProjectPage) {
        const attempt = teamRetryCount.current + 1;
        teamRetryCount.current = attempt;
        setTeamPending(true);
        setTeamLoadFailed(false);
        // Faster first retry — the query is usually just momentarily slow
        // right after a bulk import, not a genuinely cold connection, so
        // don't make the user wait a fixed 10s+ before the first re-check.
        const delay = attempt === 1 ? 1500 : Math.min(2000 + attempt * 2000, 10000);
        setTimeout(() => {
          // The cold-pool window that caused the initial team-timeout also
          // means getFullProjectAllocations likely cached partial data.
          // Bust it so PhaseBreakdown fetches fresh when person props update.
          bustCache("project-allocations-full:" + id);
          bustCache("project:allocations:" + id);
          bustCache("project:tasks:" + id);
          // CRITICAL: also refetch the team entry itself FRESH. api.ts keeps
          // empty team results cached for 30s (back→forward reuse), so
          // without this the retry reads back the SAME cached empty — e.g.
          // one fetched moments earlier by the hover prefetch — and wrongly
          // settles on "No Team Assigned" for a project that has a team.
          // fresh=true busts the client entry AND sends fresh=1 so a cluster
          // worker's per-worker cache can't serve the same transient empty;
          // loadProject's own getProjectTeam(id) below joins this in-flight
          // fetch via cached() (same pattern as refreshAfterMutation).
          void getProjectTeam(id, true).catch(() => { /* retry loop handles */ });
          // Use fast+fetchTeam mode so retries only hit the team endpoint —
          // firing all 6 upstream calls on every retry was both slow and
          // would return detD={} (upstream unavailable), which broke the
          // guard above and stopped all subsequent retries.
          void loadProject(true, true, true);
        }, delay);
      } else {
        // Either the team came back non-empty, or we've exhausted retries —
        // in both cases stop showing the "still loading" state and let the
        // real allocations.length branch (populated or genuinely empty) render.
        teamRetryCount.current = teamData.length > 0 ? 0 : teamRetryCount.current;
        // Record whether this settled team state is trustworthy — an empty
        // team off a timed-out call must not be persisted to the snapshot.
        teamUnreliableRef.current = teamData.length === 0 && teamCallTimedOut;
        setTeamPending(false);
        // Timed out on the FINAL attempt → team state unknown. Surface the
        // retry card instead of a false "No Team Assigned". A real answer
        // (empty or populated) clears any earlier failure state.
        setTeamLoadFailed(teamData.length === 0 && teamCallTimedOut);
        // Persist confirmed-empty state so a back→forward re-open within 60 s
        // skips the retry cycle and renders "No Team Assigned" immediately.
        // Never record "empty" off a TIMED-OUT call — a timeout means we don't
        // know; caching it as empty would wrongly flash "No Team Assigned".
        if (teamData.length === 0 && !teamCallTimedOut) {
          try {
            memSeed.setItem(`rmone:v1:team:${id}`, JSON.stringify({
              allocations: [], openRoles: [], ts: Date.now(),
            }));
          } catch { /* non-serializable */ }
        }
      }

      const proj: ProjectData = {
        id,
        name: sv(d.Title) || sv(d.RecordTitle) || sv(d.Name) || id,
        status: sv(d.CRMProjectStatusChoice) || sv(d.Status) || sv(d.CRMOpportunityStatusChoice) || "—",
        phase: sv(d.CRMProjectStatusChoice) || sv(d.Phase) || sv(d.Status) || "—",
        city: sv(d.City) || sv(d.ProjectCity),
        sector: sv(d.SectorChoice) || sv(d.Sector) || sv(d.MarketSector) || "—",
        value: num(d.ApproxContractValue) || num(d.ContractValue) || num(d.ContractedAmount) || num(d.EstContractValue) || 0,
        laborValue: num(d.LaborContractAmount) || 0,
        company: sv(d.CompanyName) || sv(d.CRMCompanyLookupName) || sv(d.ClientName) || sv(d.Client),
        bu: (d.CRMBusinessUnitChoice !== null && d.CRMBusinessUnitChoice !== undefined)
          ? sv(d.CRMBusinessUnitChoice)
          : sv(d.BusinessUnit) || sv(d.BusinessUnitName),
        groupId: sv(d.GroupId),
        targetStart: sv(d.TargetStartDate),
        targetEnd: sv(d.TargetCompletionDate),
        actualStart: sv(d.ActualStartDate),
        actualEnd: sv(d.ActualCompletionDate),
        // Same list-row seed as buildShell — the task-fetch result below
        // overwrites this whenever it actually answered (see hasTasks logic).
        scheduleStart: sv(d._ScheduleStart),
        scheduleEnd: sv(d._ScheduleEnd),
        closeDate: sv(d.CloseDate),
        bidDate: sv(d.BidDate) || sv(d.BidDueDate),
        probability: num(d.SuccessChance) || num(d.ChanceofSuccessChoice) || num(d.WinProbability) || 0,
        // Prefer the server-reported module — a custom (user-supplied)
        // TicketId has no PMM/OPM prefix for getModule to sniff.
        module: (["PMM", "OPM", "LEM"].includes(sv(d.ModuleName))
          ? sv(d.ModuleName)
          : (moduleFromEntityType((d as Record<string, unknown>)["entityType"]) ?? getModule(id))),
        allocations,
        keyPersonnel,
        guidToName,
        healthScore: 0,
        healthIssues: [],
        healthChecks: [],
        rawFields: d,
      };

      const scrumLc = d.ProjectLifeCycleLookup ?? d.ScrumLifeCycle ?? d.ProjectLifecycleID ?? d.ProjectLifeCycleID ?? d.LifecycleID ?? d.LifeCycleID;
      const fieldHint = !!(scrumLc && String(scrumLc).trim() !== "" && String(scrumLc) !== "false" && String(scrumLc) !== "0");
      let scheduleLastPhaseEnd = ""; let scheduleFirstPhaseStart = ""; let hasTasks = false;
      let schedulePhaseTitles: string[] | null = null;
      let schedulePhaseDateMap: Record<string, { start: string; end: string }> | null = null;
      try {
        const rawTasks = Array.isArray(taskRes) ? taskRes : ((taskRes as { Data?: unknown })?.Data ?? (taskRes as { data?: unknown })?.data ?? []);
        if (Array.isArray(rawTasks) && rawTasks.length > 0) {
          hasTasks = true;
          // Use the same normalized phase source as the allocation planner.
          // In particular, older schedules may store a phase end in EndDate
          // instead of DueDate. Reading only DueDate made the record's
          // schedule boundary stop at an earlier phase while the planner
          // correctly showed the later one, then blocked a valid assignment.
          // The helper also keeps date-only values local, avoiding a timezone
          // shift when the values are fed back into date inputs.
          const normalizedSchedule = derivePlannerSchedule(rawTasks);
          if (normalizedSchedule.phases.length > 0) {
            scheduleFirstPhaseStart = normalizedSchedule.phases
              .map((phase) => phase.start)
              .sort()[0] || "";
            scheduleLastPhaseEnd = normalizedSchedule.phases
              .map((phase) => phase.end)
              .sort()
              .at(-1) || "";
          }
          // Ordered phase titles (same field conventions as lib/phaseHours) —
          // feeds the Status picker, where phases double as statuses while
          // the display mode actually shows a schedule.
          schedulePhaseTitles = extractSchedulePhaseTitles(rawTasks);
          schedulePhaseDateMap = extractSchedulePhaseDates(rawTasks);
        }
      } catch { /* ignore */ }
      // Record's own schedule phases → Status picker. A timeout means the
      // schedule state is UNKNOWN — keep the previous list rather than
      // flashing phase options away on a slow fetch.
      if (schedPhaseGenRef.current === schedPhaseGen) {
        if (schedulePhaseTitles) {
          const titles = Array.from(new Set(schedulePhaseTitles));
          setSchedulePhases((prev) =>
            prev != null && prev.length === titles.length && prev.every((v, i) => v === titles[i]) ? prev : titles);
          // Phase→date map rides along for the "scheduled for later" guard.
          setSchedulePhaseDates(schedulePhaseDateMap);
        } else if (!taskCallTimedOut || (!fieldHint && !hasTasks && Object.keys(d).length > 0)) {
          // CONFIRMED no lifecycle assigned ([] ≠ null) — flips the Status
          // picker to its assign-a-lifecycle prompt + direct custom entry.
          // Two confirmations count: the task fetch ANSWERED with no rows, or
          // it timed out but the record's own detail fields (which did
          // answer) carry no lifecycle lookup — the SAME signal the schedule
          // card's "No lifecycle assigned" banner uses (fieldHint||hasTasks),
          // so the banner and the picker can never disagree on a slow fetch.
          setSchedulePhases((prev) => (prev != null && prev.length === 0 ? prev : []));
          setSchedulePhaseDates(null);
        } else if (fieldHint) {
          // Task fetch TIMED OUT while the record's own fields say a
          // lifecycle IS assigned: phases stay UNKNOWN (null) and the
          // lifecycle footer suppresses its status strip meanwhile — fire ONE
          // background retry so it doesn't stay pending until the next
          // schedule write or full page reload. The generation guard makes a
          // late answer harmless after any navigation or newer load.
          const gen = schedPhaseGen;
          const retryId = id;
          window.setTimeout(() => {
            if (schedPhaseGenRef.current !== gen) return; // superseded
            getTaskData(retryId, "0").then((tRes) => {
              if (schedPhaseGenRef.current !== gen) return;
              if (projectRef.current && projectRef.current.id !== retryId) return;
              const raw2 = Array.isArray(tRes) ? tRes
                : ((tRes as { Data?: unknown })?.Data ?? (tRes as { data?: unknown })?.data ?? []);
              const titles2 = extractSchedulePhaseTitles(raw2);
              if (titles2) {
                setSchedulePhases(Array.from(new Set(titles2)));
                setSchedulePhaseDates(extractSchedulePhaseDates(raw2));
              }
              // An ANSWERED empty here contradicts fieldHint (schedule may be
              // mid-write) — keep UNKNOWN; the next schedule event reconciles.
            }).catch(() => { /* still unknown — keep null */ });
          }, 1200);
        }
      }
      if (hasTasks) {
        // Live task data is the truth — it wins over the list-row seed.
        proj.scheduleEnd = scheduleLastPhaseEnd;
        proj.scheduleStart = scheduleFirstPhaseStart;
      } else if (!taskCallTimedOut) {
        // The task fetch ANSWERED with zero tasks: the schedule genuinely does
        // not exist (e.g. just deleted), so clear any stale list-row seed.
        // On a timeout we keep the seed — an unanswered call is not evidence
        // the schedule is gone, and flipping to the Target band would repaint
        // the exact wrong-dates flash this seed exists to prevent.
        proj.scheduleEnd = "";
        proj.scheduleStart = "";
      }
      const lifecycleAssigned = fieldHint || hasTasks;
      const health = computeHealth(proj, { lifecycleAssigned, scheduleLastPhaseEnd });
      proj.healthScore = health.score;
      proj.healthIssues = health.issues;
      proj.healthChecks = health.checks;

      // ── Schedule-ended auto-close (PMM + has a schedule only) ──
      // When the LAST phase's end date is strictly before today (local-day
      // compare via schedDay — date-only strings parse as UTC otherwise),
      // the project is done: mark it Closed automatically (close-only, never
      // re-open) and tell the user via a one-time popup. Skipped entirely
      // for tenants whose display mode hides schedules, for OPM/LEM records,
      // and for records without a real schedule (hasTasks=false).
      try {
        const dm = getBusinessRules().projectDisplayMode;
        const schedVisible = dm !== "no-schedule" && dm !== "no-schedule-no-hours" && dm !== "no-schedule-no-grid";
        // UTC-day compare — the SAME rule the server auto-close and the
        // projects list use (phase dates are stored midnight UTC), so all
        // three surfaces flip to Closed on the same calendar day.
        const endDay = scheduleLastPhaseEnd ? scheduleLastPhaseEnd.slice(0, 10) : "";
        const todayDay = new Date().toISOString().slice(0, 10);
        // Manual-reactivation latch — same rule as the server auto-close and
        // mapPMM: StatusManualDate is stamped whenever a HUMAN sets the
        // status. A stamp ON/AFTER the schedule-end day means the user
        // deliberately reopened this ended project, so skip the auto-close
        // patch AND the popup entirely.
        const manualDay = String((proj.rawFields as Record<string, unknown> | undefined)?.StatusManualDate ?? "").slice(0, 10);
        const manualReopen = /^\d{4}-\d{2}-\d{2}/.test(manualDay) && !manualDay.startsWith("0001")
          && !!endDay && manualDay >= endDay;
        if (!fast && proj.module === "PMM" && hasTasks && schedVisible && endDay && !endDay.startsWith("0001") && endDay < todayDay && !manualReopen) {
          // "cancel" included: a Cancelled project is already terminal — the
          // display patch must not repaint it as "Closed".
          const alreadyClosed = isClosedishStatus(proj.status);
          if (!alreadyClosed) {
            // The SERVER closes ended-schedule projects itself whenever
            // /task-data is fetched (works even for view-only accounts,
            // which are blocked from /update-fields). Here we only patch the
            // in-memory record so the STATUS chip flips immediately — the
            // patch re-applies on every reload until the server value
            // catches up, so a slow write can never "revert" the display.
            proj.status = "Closed";
            proj.phase = "Closed";
            proj.rawFields = { ...proj.rawFields, CRMProjectStatusChoice: "Closed" };
          }
          // One popup per record visit — background refreshes never re-pop
          // it. The cache busts + list-refresh nudge fire once here too.
          if (schedPromptShownRef.current !== id) {
            schedPromptShownRef.current = id;
            if (!alreadyClosed) {
              bustCache("project:details:" + id);
              bustCache("module:PMM");
              try { window.dispatchEvent(new CustomEvent("rmone:moduleFieldSaved", { detail: { mod: "PMM" } })); } catch { /* ignore */ }
            }
            setSchedEndedPrompt({ endDate: scheduleLastPhaseEnd, autoClosed: !alreadyClosed });
          }
        }
      } catch { /* the auto-close hook must never break page load */ }

      projectRef.current = proj;
      setProject(proj);
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load project");
      setTeamPending(false);
      // A failed load must still release the overlay gate so the error
      // screen (or partial page) is visible — never a stuck processing bar.
      setCoreDataSettled(true);
      return false;
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Bumped on every mutation so cards that fetch their OWN data (e.g.
  // PhaseBreakdown's hours grid) know to refetch even though their own
  // props (projectId/person) didn't change — otherwise Edit Assignment
  // updates the dates but the hours grid stays stale until manual refresh.
  const [mutationTick, setMutationTick] = useState(0);
  const refreshAfterMutation = useCallback(async (fast = true, fetchTeam = false) => {
    // Scoped bust: previously this cleared the ENTIRE app cache (every other
    // project, the resource master list, divisions, etc.), which made a
    // simple hours save force unrelated pages to hit the network again on
    // their next read. Only THIS project's data actually changed.
    bustCache("project:allocations:" + id);
    bustCache("project-allocations-full:" + id);
    bustCache("project:tasks:" + id);
    bustCache("resource-allocations:");
    if (fetchTeam) bustCache("project:team:" + id);
    // Immediately re-prime the two caches PhaseBreakdown needs so any
    // newly-mounted member card (e.g. after template apply) finds data
    // already in-flight and never has to cold-start from the spinner.
    // fresh:true bypasses the server-side per-worker cache too — right after
    // a save, a sibling cluster worker may not have processed the cache-bust
    // IPC yet and would otherwise hand back (and let us re-cache) pre-save data.
    void getFullProjectAllocations(id, { fresh: true }).catch(() => {});
    void getTaskData(id, "0").catch(() => {});
    if (fetchTeam) void getProjectTeam(id, true).catch(() => {});
    setIsRefreshing(true);
    try {
      return await loadProject(true, fast, fetchTeam);
    } finally {
      setIsRefreshing(false);
      setMutationTick((t) => t + 1);
    }
  }, [loadProject]);

  // A page opened after an allocation save missed its transient window event.
  // Reconcile once for that record when it has not seen the latest marker.
  // The refresh is project-scoped and fresh; the marker contains no app data.
  useEffect(() => {
    let cancelled = false;
    try {
      const marker = localStorage.getItem("rmone:allocationTs");
      if (!marker || allocationMarkerReconciledByProject.get(id) === marker) return;
      const reconcile = async (attempt: number) => {
        const refreshed = await refreshAfterMutation(true, true);
        if (cancelled) return;
        if (refreshed) {
          allocationMarkerReconciledByProject.set(id, marker);
          return;
        }
        if (attempt < 2) {
          window.setTimeout(() => {
            if (!cancelled) void reconcile(attempt + 1);
          }, 1000 * (attempt + 1));
        }
      };
      void reconcile(0);
    } catch { /* storage unavailable */ }
    return () => { cancelled = true; };
  }, [id, refreshAfterMutation]);

  // Allocation writes can originate in any editor (Resources, phase hours,
  // assignment modal, or this record's Team Schedule). Keep this record's
  // schedule, Gantt, phase, financial, and derived sections converged both at
  // POST time and after a direct weekly edit is verified. The cross-tab marker
  // is timestamp-only, so it carries no project or allocation data.
  useEffect(() => {
    const refreshForAllocation = (event?: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }> | undefined)?.detail;
      // The confirmed event is project-scoped; skip other records' saves.
      if (detail?.projectId && detail.projectId !== id) return;
      void refreshAfterMutation(true, true);
    };
    // Unified data-sync bus: allocation/team/demand writes made ANYWHERE
    // (Resources, Home risk panel, Quick Actions, another tab) refresh this
    // record's team + derived sections. Record-scope publishes (status /
    // field edits) refresh only when THIS record was touched — an edit to a
    // different record must not respin every open detail page. Cross-tab
    // markers carry scopes only (no record IDs), so they refresh broadly.
    const unsubscribe = subscribeDataChanged(
      ["allocation", "team", "demand", "staff", "record"],
      (change) => {
        const recordOnly = change.scopes.every((scope) => scope === "record");
        if (recordOnly && change.recordIds.length > 0 && !change.recordIds.includes(id)) return;
        void refreshAfterMutation(true, true);
      },
    );
    window.addEventListener("rmone:allocationConfirmed", refreshForAllocation);
    return () => {
      unsubscribe();
      window.removeEventListener("rmone:allocationConfirmed", refreshForAllocation);
    };
  }, [id, refreshAfterMutation]);

  // Status picker ↔ schedule sync (projects AND opportunities): every
  // schedule write — assign/change lifecycle, phase rename/add/delete,
  // length apply, date edits — fires notifyScheduleChanged() AFTER busting
  // the client cache, so re-pulling this record's task rows here gets fresh
  // data and remaps the phase titles IMMEDIATELY. Without this, the Status
  // dropdown kept its pre-save list until the (slower, sometimes task-
  // skipping) record refresh landed. The generation bump makes any
  // in-flight pre-save task answer stale, and a load that starts after us
  // supersedes us with the same fresh data — either order converges. A
  // failed refetch keeps the previous list (an unanswered call is not
  // evidence the schedule changed); an ANSWERED empty means the schedule
  // really is gone → confirmed-none ([]).
  useEffect(() => onScheduleChanged(() => {
    const tid = id;
    const gen = ++schedPhaseGenRef.current;
    getTaskData(tid, "0").then((taskRes) => {
      if (gen !== schedPhaseGenRef.current) return;             // superseded
      if (projectRef.current && projectRef.current.id !== tid) return; // navigated away
      const raw = Array.isArray(taskRes) ? taskRes
        : ((taskRes as { Data?: unknown })?.Data ?? (taskRes as { data?: unknown })?.data ?? []);
      const next = extractSchedulePhaseTitles(raw) ?? [];
      setSchedulePhases((prev) =>
        prev != null && prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next);
      setSchedulePhaseDates(extractSchedulePhaseDates(raw));
    }).catch(() => { /* keep previous list */ });
  }), [id]);

  // ── Per-record status-list customization (Override Status modal) ──
  // The footer's modal saves drag order / custom adds / removals to
  // localStorage; this version tick re-reads it so the STATUS dropdown
  // reflects every save instantly (footer and cell are sibling components
  // with no shared React state).
  const [stageCfgVer, setStageCfgVer] = useState(0);
  useEffect(() => {
    const bump = () => setStageCfgVer((v) => v + 1);
    window.addEventListener(STAGE_CFG_EVENT, bump);
    return () => window.removeEventListener(STAGE_CFG_EVENT, bump);
  }, []);
  // Each bump opens the footer's Override Status modal — the STATUS
  // dropdown's "Customize this list…" action row lands there, so reorder/
  // add/remove live in ONE editor instead of a second competing one.
  const [overrideSignal, setOverrideSignal] = useState(0);
  // What the Override Status modal should open INTO when the signal fires:
  // a specific phase's sub-status input ("+ Sub" pill on a dropdown row) or
  // the add-a-new-status input ("+ Add statuses…"). {} = plain open.
  const [overrideFocus, setOverrideFocus] = useState<{ subFor?: string; addStage?: boolean }>({});
  // "Scheduled for later" popup — raised when a manual status pick targets a
  // phase whose schedule window hasn't started (STATUS cell + footer paths).
  const [futureWarn, setFutureWarn] = useState<{ stage: string; phase: string; startDay: string } | null>(null);
  const jumpToScheduleCard = () => {
    setExpandedSections((prev) => { const s = new Set(prev); s.add("timeline"); return s; });
    setTimeout(() => document.getElementById("schedule-section")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
  };
  const recordStageCfg = useMemo<StageCfg>(() => {
    if (!project?.id) return { order: [], custom: [], removed: [], subStatuses: {} };
    const field = project.module === "OPM" ? "CRMOpportunityStatusChoice" : "CRMProjectStatusChoice";
    return readStageCfg(tenantScopedKey(`rmone:stageCfg:${field}:${project.id}`));
    // stageCfgVer forces a re-read after every Override-modal save.
  }, [project?.id, project?.module, stageCfgVer]);
  // Flat set of all sub-status values for the current record — used by both
  // STATUS detail cells to render sub-statuses indented in the dropdown.
  const recordSubStatusKeys = useMemo(() => getSubStatusKeys(recordStageCfg), [recordStageCfg]);
  // A free-typed status becomes a reusable option on this record's Override
  // cfg — SAME contract as the projects-list Change Status modal and Quick
  // Actions, so a custom typed on ANY surface lists on all of them.
  // Serialized queue + fresh STRICT server re-read inside each queued step:
  // saveStageCfg replaces the whole document, so merging into anything but
  // the LATEST copy could wipe an option added meanwhile by the footer
  // Override modal or another surface. Fire-and-forget: never blocks the
  // status save itself.
  const stageCfgTypedQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistTypedCustomStatus = useCallback((value: string) => {
    if (!project?.id) return;
    // Phases unresolved = we can't tell a base phase from a custom yet —
    // skip the reusable-option persist rather than misfile a real phase.
    if (schedulePhases === null) return;
    const recId = project.id;
    const phases = schedulePhases;
    const field = project.module === "OPM" ? "CRMOpportunityStatusChoice" : "CRMProjectStatusChoice";
    const key = tenantScopedKey(`rmone:stageCfg:${field}:${recId}`);
    stageCfgTypedQueueRef.current = stageCfgTypedQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const cfg = await apiGetStageCfg(recId, field, { strict: true })
          .then((raw) => parseStageCfg(raw))
          .catch(() => readStageCfg(key)); // offline fallback: local copy
        const next = ensureCustomStatusInStageCfg(cfg, phases, value);
        if (JSON.stringify(next) === JSON.stringify(cfg)) return;
        try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable */ }
        await apiSaveStageCfg(recId, field, next);
        // Both the STATUS dropdown (recordStageCfg) and the footer Override
        // modal re-read on this event, so every on-page reader converges.
        try { window.dispatchEvent(new CustomEvent(STAGE_CFG_EVENT, { detail: { key } })); } catch { /* non-browser */ }
      })
      .catch((e) => console.warn("[project] status saved but reusable option sync failed", e));
  }, [project?.id, project?.module, schedulePhases]);

  // Remove a member from the team (admin/manager only — the trash icon is
  // only rendered when canEdit, and the server 403s view-only users anyway).
  // Soft-deletes every allocation + work-item row for the person on this
  // record, then refetches the team so the row disappears.
  // ── Allocation lock (IsLocked flag) ───────────────────────────────────────
  // Unlock authority mirrors the server gate: admins pass outright; everyone
  // else needs the manage-staff capability (fail-closed — stays false until
  // the server confirms).
  const [canUnlockAlloc, setCanUnlockAlloc] = useState(false);
  useEffect(() => {
    let live = true;
    setCanUnlockAlloc(false);
    if (getStoredUser()?.isAdmin === true) { setCanUnlockAlloc(true); return; }
    void getMyCapabilitiesChecked()
      .then((mc) => { if (live) setCanUnlockAlloc(mc?.caps.manageStaff === true); })
      .catch(() => { /* stay false */ });
    return () => { live = false; };
  }, [permsVer]);
  const canManageStaff = canUnlockAlloc;
  const staffingLockNote = canManageStaff
    ? null
    : "Your access level doesn't include staffing changes (team members, open positions and allocations).";
  const handleToggleAllocLock = useCallback(async (m: { name: string; resourceId?: string }, locked: boolean): Promise<boolean> => {
    if (!m.resourceId) {
      alert(`Can't change the lock for ${m.name}: this member has no linked staff record.`);
      return false;
    }
    try {
      await setAllocationLock(project.id, m.resourceId, locked);
      void refreshAfterMutation(true, true);
      return true;
    } catch (e) {
      alert(`Couldn't ${locked ? "lock" : "unlock"} ${m.name}'s allocation: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }, [project.id]);

  // Generic flag toggle (soft / non-chargeable / locked) from the FLAGS
  // column sub-slots — same manage-staff gate as the lock.
  const handleToggleAllocFlag = useCallback(async (m: { name: string; resourceId?: string }, flag: "soft" | "nc" | "locked", value: boolean, costRate?: number): Promise<boolean> => {
    if (!m.resourceId) {
      alert(`Can't change flags for ${m.name}: this member has no linked staff record.`);
      return false;
    }
    try {
      // The NC cost-rate write is financial data — the server rejects it for
      // users without the financial capability, so strip it client-side and
      // let the flag itself (a staffing action) still go through.
      let rateToSend = costRate;
      if (flag === "nc" && value && rateToSend != null) {
        try {
          const mc = await getMyCapabilitiesChecked();
          if (mc?.caps?.editFinancials !== true) rateToSend = undefined;
        } catch { rateToSend = undefined; }
      }
      await setAllocationFlag(project.id, m.resourceId, flag, value, rateToSend);
      // The grid already applied an optimistic patch (badge flips instantly).
      // Just quietly bust the relevant caches and re-prime in the background —
      // no spinner, no full loadProject round-trip.
      bustCache("project:team:" + id);
      bustCache("project:allocations:" + id);
      bustCache("project-allocations-full:" + id);
      bustCache("resource-allocations:");
      void getProjectTeam(id, true).catch(() => {});
      void getFullProjectAllocations(id, { fresh: true }).catch(() => {});
      // Note: do NOT increment mutationTick here — that triggers a team reload
      // whose in-flight response races the optimistic NC/soft/lock patch that
      // the grid already applied, and whichever resolves last wins. The flag
      // write is cache-busted + background-refreshed above; no reload needed.
      return true;
    } catch (e) {
      const label = flag === "soft" ? "soft allocation" : flag === "nc" ? "non-chargeable" : "lock";
      alert(`Couldn't ${value ? "set" : "clear"} the ${label} flag for ${m.name}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }, [project.id, id]);

  // Accepts any {name, resourceId} shape so the Team View grid's
  // ProjectTeamMember rows reuse the SAME remove path as the table/Gantt
  // Allocation rows (rule: one remove path, never fork it).
  const handleRemoveMember = useCallback(async (a: { name: string; resourceId?: string }) => {
    setRemoveMemberErr("");
    if (!a.resourceId) {
      const msg = `Couldn't remove ${a.name} — this member has no linked person record.`;
      setRemoveMemberErr(msg);
      alert(msg);
      return;
    }
    try {
      await removeTeamMember(id, a.resourceId);
      // Close the confirm popup as soon as the removal is committed — the
      // full page refresh can crawl during upstream DB brownouts and must
      // not hold the modal in "Removing…" (the page shows its own
      // refreshing indicator while rows update in the background).
      void refreshAfterMutation(true, true);
    } catch (e) {
      console.warn("[remove-member] failed:", e);
      // The inline error div only renders near the table/Gantt surfaces —
      // the Team View grid has none, so surface failures loudly everywhere.
      const msg = `Couldn't remove ${a.name}. Please try again.`;
      setRemoveMemberErr(msg);
      alert(msg);
    }
  }, [id, refreshAfterMutation]);

  // Change resource: swap WHO does the remaining (future) weeks of an
  // assignment. Accepts the same loose {name, resourceId} shape as
  // handleRemoveMember so all three team surfaces (table, Gantt, weekly
  // grid) share ONE path; enriches the role/division prefills from the
  // matching Allocation row when the caller passed a slimmer grid row.
  const handleChangeResource = useCallback((a: { name: string; resourceId?: string; role?: string; title?: string; bu?: string; divisionId?: string }) => {
    if (!a.resourceId) {
      alert(`Couldn't start a resource change for ${a.name} — this member has no linked person record.`);
      return;
    }
    const full = projectRef.current?.allocations.find(x =>
      (x.resourceId && x.resourceId === a.resourceId) ||
      x.name.trim().toLowerCase() === a.name.trim().toLowerCase());
    setChangeResourceFor({
      name: a.name,
      resourceId: a.resourceId,
      role: a.role || full?.role || "",
      title: a.title || full?.title || "",
      bu: a.bu ?? full?.bu ?? "",
      divisionId: a.divisionId ?? full?.divisionId,
    });
  }, []);

  // Remove an OPEN (unfilled) position — soft-deletes the still-open demand
  // rows by RA id. The server only ever touches rows with nobody assigned,
  // so a stale click can never delete a real person's allocation.
  const handleRemoveOpenPosition = useCallback(async (r: OpenRole) => {
    setRemoveMemberErr("");
    const ids = (r.raIds ?? []).filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) {
      const msg = `Couldn't remove the open ${r.role || r.title || "position"} — it has no linked demand rows. Refresh the page and try again.`;
      setRemoveMemberErr(msg);
      alert(msg);
      return;
    }
    try {
      const out = await removeOpenPosition(id, ids);
      // Demand rows feed the Resources page too — bust its caches as well.
      notifyAllocationChanged();
      // Background refresh (same reason as handleRemoveMember): never hold
      // the confirm popup open waiting for the full page reload.
      void refreshAfterMutation(true, true);
      if (out.alreadyGone) {
        // A previous (timed-out) attempt or another user already removed or
        // filled this position — the refresh shows the current truth.
        alert("That position is no longer open — it was already removed or has just been filled. The team list is refreshing.");
      }
    } catch (e) {
      console.warn("[remove-open-position] failed:", e);
      const msg = `Couldn't remove the open ${r.role || "position"}. Please try again.`;
      setRemoveMemberErr(msg);
      alert(msg);
    }
  }, [id, refreshAfterMutation]);

  // Silent team refresh — used after optimistic member insert so the real
  // data fills in without showing any spinner or "refreshing" overlay.
  const silentTeamRefresh = useCallback(() => {
    bustCache("project:allocations:" + id);
    bustCache("project-allocations-full:" + id);
    bustCache("project:team:" + id);
    bustCache("resource-allocations:");
    // fresh:true → bypass server per-worker caches (post-save race guard).
    void getFullProjectAllocations(id, { fresh: true }).catch(() => {});
    refreshProjectTeamCache(queryClient, id);
    // Use .finally() so mutationTick ALWAYS increments (and TeamScheduleGrid
    // always gets a fresh reloadKey) even when loadProject throws — matches
    // the try/finally pattern used in refreshAfterMutation.
    void loadProject(true, true, true).finally(() => {
      setMutationTick((t) => t + 1);
    });
  }, [loadProject, id]);

  // Refresh business rules on every project-detail mount so the projectDisplayMode
  // setting (schedule/hours visibility) always reflects the latest admin configuration,
  // even when settings were changed in another tab or after app startup.
  useEffect(() => { void loadBusinessRules(); }, []);
  // Snapshot-seeded visits load silently (page already rendered from the
  // persisted snapshot); cold visits show the normal overlay.
  useEffect(() => { void loadProject(Boolean(initialSnap)); }, [loadProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // One-way latch: fire once Phase 1 (`loading` → false, record fields on
  // screen), Phase 2 (`coreDataSettled` — team + schedule + allocation
  // answers collected), AND the per-record permission verdict have completed.
  // User mandate: when the
  // processing bar finishes, the page must show its data — no second round
  // of "Loading…" cards behind it. This is bounded (every Phase-2 call has
  // its own 8-12s timeout and all of them run in parallel from mount), and
  // it deliberately does NOT wait on the empty-team retry cycle (up to 6
  // retries × 10s — holding the overlay through that read as "the page is
  // stuck, I have to refresh"). Once fired, the latch stays true so
  // background retries never re-trigger the overlay.
  useEffect(() => {
    if (!loading && coreDataSettled && settledPerms && !initialLoadComplete) {
      setInitialLoadComplete(true);
    }
  }, [loading, coreDataSettled, settledPerms, initialLoadComplete]);

  // Absolute safety net: no matter what any fetch or retry loop does, the
  // initial overlay force-dismisses after 13s. Must stay LONGER than the
  // slowest Phase-2 per-call timeout (12s) — if it fired earlier, the
  // overlay would drop while Phase 2 is still settling and the user would
  // see exactly the "second loading step" this flow exists to prevent.
  // The page shell underneath is always mounted, so the worst case is a
  // briefly sparse page that fills in — never a stuck "Loading…" popup.
  useEffect(() => {
    if (initialLoadComplete) return;
    const t = window.setTimeout(() => setInitialLoadComplete(true), 13000);
    return () => window.clearTimeout(t);
  }, [initialLoadComplete]);

  // Persist the fully-settled page state so the NEXT visit — even after a
  // full reload — renders instantly with no overlay. Only write settled
  // states: never while anything is still loading, and never an empty team
  // that came from a timed-out call (we don't know if it's really empty).
  useEffect(() => {
    if (!id || loading || teamPending || !initialLoadComplete) return;
    if (!project || project.id !== id) return;
    if (project.allocations.length === 0 && teamUnreliableRef.current) return;
    // Never persist an empty-fields shell (failed/timed-out refresh) — it
    // would seed every return visit this session with a blank page.
    if (Object.keys(project.rawFields ?? {}).length < 3) return;
    writeProjectSnapshot(id, { project, openRoles });
  }, [id, project, openRoles, loading, teamPending, initialLoadComplete]);

  // When billing rates change anywhere in the app (same tab OR another tab),
  // silently re-fetch so team-member cost figures update without a manual reload.
  useEffect(() => {
    const onRatesChanged = () => { loadProject(true); };
    const onStorage = (e: StorageEvent) => { if (e.key === "rmone:ratesTs") loadProject(true); };
    window.addEventListener("rmone:billingRatesChanged", onRatesChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("rmone:billingRatesChanged", onRatesChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, [loadProject]);

  // Same pattern for "Hours in a full week" / reapply-default-hours from the
  // Settings page: whether the settings tab is a different browser tab or the
  // same tab, force the project (AND every PhaseBreakdown card via
  // mutationTick → refreshToken) to refetch so the new hours show up
  // immediately instead of needing a manual page reload.
  useEffect(() => {
    const onHoursSettingsChanged = () => { loadProject(true); setMutationTick((t) => t + 1); };
    const onStorage = (e: StorageEvent) => { if (e.key === "rmone:hoursSettingsTs") onHoursSettingsChanged(); };
    window.addEventListener("rmone:hoursSettingsChanged", onHoursSettingsChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("rmone:hoursSettingsChanged", onHoursSettingsChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, [loadProject]);

  // Company stage-rules version — bumps when the rules change (a save in this
  // tab, a cross-tab sync ping, or a background refetch). Declared before the
  // option effects below so they can re-run: the status lists embed the
  // workflow stage names server-side, so a rules change must refetch them.
  const stageRulesVer = useStageRulesVersion();
  useEffect(() => { void loadStageRules(); }, []);

  // Load dropdown option lists for the editable Status / Sector fields.
  // Keyed on stageRulesVer: when rules change the sync layer busts the
  // field-options cache, so this refetch serves fresh lists; otherwise the
  // client cache answers instantly (no extra network).
  useEffect(() => {
    let alive = true;
    getFieldOptions("status").then((o) => { if (alive) setStatusOptions(o); }).catch(() => {});
    getFieldOptions("sector").then((o) => { if (alive) setSectorOptions(o); }).catch(() => {});
    // Force-fetch the OPM stage list so it always reflects the latest onboarding
    // "Opportunity stage set" (added/removed stages), even if a stale copy is cached.
    getFieldOptions("status", "OPM", { force: true }).then((o) => { if (alive) setOpmStageOptions(o); }).catch(() => {});
    // Lead statuses are their own list (scraped from the tenant's Lead records)
    // so lead detail dropdowns show the tenant's actual lead statuses.
    getFieldOptions("status", "LEM").then((o) => { if (alive) setLemStatusOptions(o); }).catch(() => {});
    return () => { alive = false; };
  }, [stageRulesVer]);

  // Choice-field option lists for the module detail sections (Project Type /
  // Service Type / Project Category). Module-scoped so a project's dropdown is
  // scraped from PMM records, an opp's from Opportunity records, etc. The
  // presets are merged in at the render site, so the lists are never empty.
  const [projectTypeOptions, setProjectTypeOptions] = useState<string[]>([]);
  const [serviceTypeOptions, setServiceTypeOptions] = useState<string[]>([]);
  const [requestCategoryOptions, setRequestCategoryOptions] = useState<string[]>([]);
  useEffect(() => {
    const mod = project.module === "OPM" || project.module === "LEM" || project.module === "PMM" ? project.module : null;
    if (!mod) return undefined;
    let alive = true;
    getFieldOptions("projecttype", mod).then((o) => { if (alive) setProjectTypeOptions(o); }).catch(() => {});
    getFieldOptions("servicetype", mod).then((o) => { if (alive) setServiceTypeOptions(o); }).catch(() => {});
    getFieldOptions("requestcategory", mod).then((o) => { if (alive) setRequestCategoryOptions(o); }).catch(() => {});
    return () => { alive = false; };
  }, [project.module, stageRulesVer]);

  // User-group memberships (#121/#122) — declared ABOVE stageRuleInfo because
  // lock/skip evaluation folds group exemptions in (#122); also filters
  // group-restricted workflow types from the dropdown (#121). Starts EMPTY
  // (no exemptions, restricted types hidden) until the real memberships
  // arrive — display-only either way: the server re-checks on every write.
  const [myGroupIds, setMyGroupIds] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    getMyCapabilities()
      .then((c) => { if (alive) setMyGroupIds(c.groupIds); })
      .catch(() => { /* keep [] — no exemptions, restricted options stay hidden */ });
    return () => { alive = false; };
  }, [permsVer]);
  // Lowercased set — the shape ruleExempts compares against.
  const myGroupIdSet = useMemo(() => new Set(myGroupIds.map((g) => g.trim().toLowerCase())), [myGroupIds]);

  // ── Per-RECORD stage-rule override (forked from the schedule card) ───────
  // When this record has its OWN rules doc, locks/skips/layout must evaluate
  // from that doc — mirroring the server's getEffectiveStageRules, which
  // replaces the company doc wholesale for the record. `forId` guards
  // record→record navigation (this page instance is reused, see route-reuse).
  const [recRules, setRecRules] = useState<{ forId: string; rules: StageRules } | null>(null);
  const [recRulesVer, setRecRulesVer] = useState(0);
  useEffect(() => {
    // Same-tab save/reset from the schedule card's drawer host.
    const onChanged = (e: Event) => {
      const rid = String((e as CustomEvent).detail?.recordId ?? "").trim().toUpperCase();
      if (!rid || rid === String(project?.id ?? "").trim().toUpperCase()) setRecRulesVer((v) => v + 1);
    };
    window.addEventListener(RECORD_STAGE_RULES_EVENT, onChanged);
    return () => window.removeEventListener(RECORD_STAGE_RULES_EVENT, onChanged);
  }, [project?.id]);
  useEffect(() => {
    if (!project?.id) { setRecRules(null); return undefined; }
    let alive = true;
    fetchStageRulesFor(undefined, project.id)
      .then((r) => {
        if (!alive) return;
        setRecRules(r.source === "record" ? { forId: project.id, rules: r.rules } : null);
      })
      .catch(() => { /* keep last known — the forId guard voids stale docs, and
                        company-doc evaluation (server-enforced anyway) stands */ });
    return () => { alive = false; };
  }, [project?.id, recRulesVer, stageRulesVer]);

  // ── Company stage rules (admin-configured field locks + stage skips) ─────
  // Locks are ENFORCED server-side on every write path; this client mirror
  // greys locked cells out up front (lock icon + tooltip) and hides skipped
  // stages from status pickers and the lifecycle bar. Evaluation must stay in
  // lockstep with the server — both live behind lib/stageRules.ts.
  // (stageRulesVer + loadStageRules live above the option-list effects.)
  const stageRuleInfo = useMemo(() => {
    const mod: StageRuleModule = project.module === "OPM" ? "OPM" : project.module === "LEM" ? "LEM" : "PMM";
    const rfs = (project.rawFields ?? {}) as Record<string, unknown>;
    const fromProject = project.status && project.status !== "—" ? project.status : "";
    // First NON-EMPTY value wins — mirrors the server's COALESCE(NULLIF(…))
    // chains in getCurrentStageRds exactly (same columns, same order).
    const pick = (...vals: unknown[]) => {
      for (const v of vals) { const s = String(v ?? "").trim(); if (s) return s; }
      return "";
    };
    const currentStage = mod === "OPM"
      ? pick(rfs.CRMOpportunityStatusChoice, rfs.CRMOpportunityStageChoice, rfs.Status)
      : mod === "LEM"
        ? (pick(rfs.LeadStatus, rfs.Status) || fromProject)
        : (pick(rfs.CRMProjectStatusChoice, rfs.Status) || fromProject);
    const { rules: sharedScheduleRules, stageOrder } = getStageRules();
    // PMM and OPM rules exist only for a record's assigned lifecycle phases.
    // Keep the client mirror permissive until task data confirms phases; the
    // server applies the same gate before every rule-driven write decision.
    const rulesActive = mod === "LEM" || !!(schedulePhases && schedulePhases.length > 0);
    // Per-record fork (if any) replaces the company doc WHOLESALE — the same
    // copy-on-write semantics the server enforces with (getEffectiveStageRules).
    const recDoc = recRules && recRules.forId === project.id ? recRules.rules : null;
    const rules = rulesActive ? (recDoc ?? sharedScheduleRules) : EMPTY_STAGE_RULES;
    // #131: a workflow type with its OWN stage list overrides the module
    // order for records carrying it — the server's checkStageFieldLocks
    // resolves the order the same way, so locks/stepper/pickers stay aligned.
    const wfOwnStages = workflowStagesFor(rules, mod, readRawField(rfs as Record<string, unknown>, "WorkflowTypeName"));
    // Record forks stamp the project's own phase list at save; for lock/skip
    // EVALUATION it wins (mirrors the server's recStamp-first resolution).
    // tenantOrder below deliberately ignores the stamp — the stepper and
    // status pickers keep showing the workflow/company stage order.
    const recStampRaw = recDoc?.stageOrder?.[mod];
    const recStamp = recStampRaw && recStampRaw.length >= 2 ? recStampRaw : null;
    const order = recStamp ?? wfOwnStages ?? stageOrder[mod] ?? FALLBACK_STAGE_ORDER[mod];
    // A scheduled record's own phase list is a SECOND evaluation sequence
    // (mirrors the server's checkStageFieldLocks): the status picker offers
    // exactly those phases, so rules are routinely anchored on them while
    // the tenant/workflow order doesn't contain those names. A rule applies
    // when it applies under EITHER sequence — union, failing toward the
    // rule. Skipped when the fork stamp already IS the phase list.
    const altOrder = !recStamp && schedulePhases && schedulePhases.length > 0 ? schedulePhases : null;
    const locked = computeLockedFields(rules, mod, currentStage, order, myGroupIdSet);
    if (altOrder) {
      for (const [k, v] of computeLockedFields(rules, mod, currentStage, altOrder, myGroupIdSet)) {
        if (!locked.has(k)) locked.set(k, v);
      }
    }
    // Form layout: fields hidden / read-only at the record's current stage —
    // exact-stage by default, optional from/until scopes evaluate on the SAME
    // order as locks (mirrors the server's checkStageFieldLocks).
    const layout = computeLayoutFields(rules, mod, currentStage, order, myGroupIdSet);
    if (altOrder) {
      for (const [k, v] of computeLayoutFields(rules, mod, currentStage, altOrder, myGroupIdSet)) {
        if (!layout.has(k)) layout.set(k, v);
      }
    }
    // evalOrder is the stage list used for lock evaluation — kept so lockNote
    // can pass it to lockMessage for the plain-language "why" tooltip.
    // Skip-rule conditions must match the value the page DISPLAYS. Each field
    // resolves through the SAME fallback chain (same columns, same order) the
    // page renders, and only the FIRST non-empty value counts. Matching ANY
    // populated candidate (the old behavior) kept rules latched onto stale
    // shadowed columns — e.g. after editing an opp's BU from Architecture to
    // Administration, the derived BusinessUnitName (from the division link)
    // still said "Architecture", so the "BU is Architecture" skip never
    // released even though the page showed Administration.
    const condFieldValues = (f: string): string[] => {
      const fl = f.trim().toLowerCase();
      // Display chains per field kind — keep in lockstep with the render
      // sites: bu/sector (record mapping), division/department (details
      // card), project/service type (ModuleSpecificDetails).
      const chain =
        fl.includes("businessunit") ? ["CRMBusinessUnitChoice", "BusinessUnit", "BusinessUnitName"]
        : fl.includes("sector") ? ["SectorChoice", "Sector", "MarketSector"]
        : fl.includes("division") ? ["CompanyDivisionsTitle", "DivisionName", "Division", "DivTitle"]
        : fl.includes("department") ? ["DepartmentName", "Department"]
        : fl.includes("projecttype") ? ["ProjectType", "ProjectTypeChoice", "CRMProjectTypeChoice"]
        : fl.includes("servicetype") ? ["ServiceType", "ServiceTypeChoice", "ServiceTypeText"]
        : null;
      if (chain) {
        // First non-empty column in display order IS the displayed value. A
        // fully blank chain means the page shows "—", so no rule may match —
        // falling back to the raw configured field here would compare against
        // lookup IDs (e.g. DivisionLookup), which users never see.
        for (const col of chain) {
          const v = readRawField(rfs, col);
          if (v) return [v];
        }
        return [];
      }
      // Fields without a display chain (WorkflowTypeName, RequestCategory)
      // display the raw column itself.
      const raw = readRawField(rfs, f);
      return raw ? [raw] : [];
    };
    const skipped = skippedStagesFor(rules, mod, condFieldValues, myGroupIdSet);
    // NOTE: the record's CURRENT stage stays in this set on purpose — every
    // consumer (pickers, lifecycle bar) exempts the current stage itself, and
    // the bar uses membership to show a "skipped" hint on the current pill.
    return {
      // tenantOrder feeds the stepper, option lists and display sorting — for
      // a record on a custom-stage workflow it IS that workflow's list (#131).
      mod, currentStage, locked, skipped, tenantOrder: wfOwnStages ?? stageOrder[mod], evalOrder: order,
      // The EFFECTIVE rules doc every consumer must read (record fork when
      // present, company doc otherwise) — e.g. the required-blank guard.
      effRules: rules,
      layout, layoutHidden: layoutHiddenKeys(layout),
      // Admin-named workflow types for this module (record page dropdown).
      wfTypes: workflowTypesFor(rules, mod),
      // Same list with group restrictions (#121) — the dropdown hides
      // restricted types from non-members.
      wfDefs: workflowTypeDefsFor(rules, mod),
      // Admin-written team tip for the record's CURRENT stage (#137) —
      // display-only banner under the workflow stepper.
      guidanceTip: guidanceFor(rules, mod, currentStage),
      // Display-only workflow styling from the same doc: custom stage colors
      // (lowercased-name → hex) and renamed action buttons for THIS module.
      stageColors: rules.stageColors?.[mod] ?? null,
      buttonLabels: rules.buttonLabels?.[mod] ?? null,
    };
  }, [project, stageRulesVer, myGroupIdSet, recRules, schedulePhases]);

  // Admin-defined workflow stages (Settings → Stage Rules → Workflow stages)
  // must appear in the status picker and lifecycle bar even before any record
  // carries them — the fetched option lists are otherwise scraped from record
  // data, so a freshly configured stage would be missing everywhere until the
  // first record used it. Workflow order leads; extra observed values follow.
  const withWorkflowStages = useCallback((opts: string[]): string[] => {
    const order = stageRuleInfo.tenantOrder;
    if (!order || order.length === 0) return opts;
    const seen = new Set(order.map((s) => s.trim().toLowerCase()));
    return [...order, ...opts.filter((o) => !seen.has(o.trim().toLowerCase()))];
  }, [stageRuleInfo.tenantOrder]);

  // Fetch the per-stage permission verdict (state + derived flags live near
  // the top of the component so the page-wide `canEdit` can fold them in).
  useEffect(() => {
    if (!project?.id) return undefined;
    let alive = true;
    getRecordPermissions(project.id)
      .then((p) => { if (alive) setRecPerms(p); })
      .catch(() => { /* optimistic — server still enforces */ });
    return () => { alive = false; };
  }, [project?.id, permsVer]);

  // (myGroupIds — user-group memberships — now lives above stageRuleInfo.)

  // Lock note (human message) for the first locked field among `names`.
  // Stage permissions (#87) come first: no-edit blankets every editable cell,
  // no-advance covers just the stage/status cells.
  const lockNote = useCallback(
    (...names: string[]) => {
      if (recPerms && !recPerms.degraded) {
        // Financial cells answer to canEditFinancials, everything else to
        // canEditData — same partition the server applies on write.
        const allFinancial = names.length > 0 && names.every((n) => isFinancialFieldName(n));
        if (allFinancial ? !recPerms.canEditFinancials : !recPerms.canEditData) {
          return recPerms.reason || (allFinancial
            ? "Your access level doesn't allow editing contract values and other financial fields."
            : "Only this stage's assigned people can edit this record.");
        }
        if (!recPerms.canAdvanceStage && names.some((n) => /status/i.test(n))) {
          return recPerms.reason || "Only this stage's assigned people can move this record to another stage.";
        }
      }
      return lockNoteForFields(stageRuleInfo.locked, names, stageRuleInfo.currentStage, stageRuleInfo.evalOrder)
        ?? layoutNoteForFields(stageRuleInfo.layout, names)
        ?? undefined;
    },
    [stageRuleInfo, recPerms],
  );

  // A bare PMM record deliberately falls back to Pipeline → Active. Those are
  // project-status stages, not lifecycle-template phases, so an administrator
  // needs an explicit configuration destination when one is locked. Without
  // this context, searching Saved Schedules for "Active" misleadingly returns
  // nothing even though the status is working as configured.
  const projectStatusLockNote = useMemo(() => {
    const note = lockNote("CRMProjectStatusChoice");
    if (!note || project.module !== "PMM" || scheduleOff || schedulePhases === null || schedulePhases.length > 0) return note;
    return `${note} “Active” is a built-in project status, not a saved schedule phase. An administrator can manage its access and field locks in Settings → Projects & Opportunities schedule.`;
  }, [lockNote, project.module, scheduleOff, schedulePhases]);

  // Hide admin-skipped stages from a dropdown option list (the current stage
  // always stays visible), and order it by the tenant-configured stage order
  // when one exists — so pickers, the footer and the server all agree.
  const applyStageDisplayRules = useCallback((opts: string[], preserveOrder?: boolean): string[] => {
    const { skipped, tenantOrder, currentStage } = stageRuleInfo;
    const curKey = currentStage.trim().toLowerCase();
    let out = opts.filter((s) => { const k = s.trim().toLowerCase(); return !skipped.has(k) || k === curKey; });
    // When the options come from an assigned lifecycle (schedule phases), the
    // schedule's StageStep sequence IS the right order — don't re-sort by the
    // tenant workflow order or "Pending Assignmentss" (step 1) would sink to
    // the bottom while "Proposal Development" (step 2) floats to the top.
    if (!preserveOrder && tenantOrder && tenantOrder.length > 0) {
      const idx = new Map(tenantOrder.map((s, i) => [s.trim().toLowerCase(), i] as const));
      // Stable sort: options missing from the configured order keep their
      // relative position after the configured ones.
      out = [...out].sort((a, b) => (idx.get(a.trim().toLowerCase()) ?? 1e9) - (idx.get(b.trim().toLowerCase()) ?? 1e9));
    }
    return out;
  }, [stageRuleInfo]);

  // Render gate: fields hidden by the user/admin display config PLUS fields
  // hidden by the company form layout at the record's CURRENT stage.
  const layoutFieldHidden = useCallback((...keys: string[]) =>
    fieldHidden(...keys) || keys.some((k) => stageRuleInfo.layoutHidden.has(k.trim().toLowerCase())),
    [fieldHidden, stageRuleInfo]);

  // Persist a single editable Project Details field, then refresh silently.
  const saveField = useCallback(async (fieldName: string, value: string) => {
    // Company stage rules: fail fast with the explanation — the server
    // enforces the same rule, this just avoids a doomed network round-trip
    // for cells not wired to the lockedNote UI (custom fields, dates, module
    // sections).
    const lockedMsg = lockNoteForFields(stageRuleInfo.locked, [fieldName]);
    if (lockedMsg) throw new Error(lockedMsg);
    // Form layout (hidden or read-only at the CURRENT stage) — same fail-fast.
    const layoutMsg = layoutNoteForFields(stageRuleInfo.layout, [fieldName]);
    if (layoutMsg) throw new Error(layoutMsg);
    // A field required for the record's CURRENT stage can't be emptied (#137
    // blank-guard) — the server rejects it at the write choke point; this
    // mirror explains it without the doomed round-trip.
    if (value.trim() === "") {
      const reqMsg = requiredBlankNote(stageRuleInfo.effRules, stageRuleInfo.mod, stageRuleInfo.currentStage, fieldName, myGroupIdSet);
      if (reqMsg) throw new Error(reqMsg);
    }
    // Per-stage / access-level permissions (#87): same fail-fast for users who
    // aren't allowed to touch this field (server enforces too). Financial
    // fields answer to canEditFinancials, everything else to canEditData.
    if (recPerms && !recPerms.degraded) {
      const fin = isFinancialFieldName(fieldName);
      if (fin ? !recPerms.canEditFinancials : !recPerms.canEditData) {
        throw new Error(recPerms.reason || (fin
          ? "Your access level doesn't allow editing contract values and other financial fields."
          : "Only this stage's assigned people can edit this record."));
      }
      if (!recPerms.canAdvanceStage && /status/i.test(fieldName)) {
        throw new Error(recPerms.reason || "Only this stage's assigned people can move this record to another stage.");
      }
    }
    let r: { ok: boolean; updated?: string[]; error?: string };
    try {
      r = await updateFields(project.id, [{ FieldName: fieldName, Value: value }]);
    } catch (e) {
      // Non-2xx responses throw with a parsed friendlyMessage (e.g. the 403
      // from the server's stage-rules gate when this client's rules copy was
      // stale) — surface that instead of the raw `403: {json}` blob.
      const fm = (e as { friendlyMessage?: string } | null)?.friendlyMessage;
      throw fm ? new Error(fm) : e;
    }
    if (!r.ok) throw new Error(r.error || "Could not save change");
    // Bust ONLY the caches that a project field edit actually affects:
    //   1. The project detail record (the field value lives here)
    //   2. The module records list (its row for this project also carries the field)
    // DO NOT call bustCache() with no args — that nukes resource-allocations,
    // project-team, task-data, etc., forcing all 6 loadProject calls to run cold.
    // Those datasets are unchanged by a single field edit, so keeping them warm
    // means loadProject only makes 2 cold network calls instead of 6, cutting
    // the perceived "slow reload" after saving BU / Division / Dept etc.
    bustCache("project:details:" + project.id);
    const mod = getModule(project.id);
    if (mod) bustCache("module:" + mod);
    // Notify the Projects list page (if mounted) so it can invalidate its
    // React Query cache for this module. bustCache only clears the api.ts
    // in-memory layer — without this event the ["lem"] / ["opm"] / ["pmm"]
    // RQ cache holds stale values until its 5-min stale time expires.
    if (mod) {
      try {
        window.dispatchEvent(new CustomEvent("rmone:moduleFieldSaved", { detail: { mod } }));
      } catch { /* ignore */ }
    }
    // A save may have MOVED the record to a different stage — the permission
    // verdict can flip (e.g. into a stage governed by another team), so
    // refresh it alongside the record itself.
    bustRecordPermissions(project.id);
    getRecordPermissions(project.id).then(setRecPerms).catch(() => { /* keep last */ });
    void loadProject(true);
  }, [project.id, loadProject, stageRuleInfo, recPerms, myGroupIdSet]);

  // ── Project Leads (Key Personnel) add/remove ─────────────────────────────
  // Pre-populate the Add Lead roster as soon as we know the project id. The
  // same getUserList() call is already fired by the warmup effect, so this is
  // usually a client-side cache hit and completes in < 1 ms. Loading eagerly
  // (not lazily on modal open) eliminates the "Loading roster…" spinner.
  useEffect(() => {
    if (!id || kpPeople.length > 0) return undefined;
    let alive = true;
    getUserList().then((rows) => {
      if (!alive || !Array.isArray(rows)) return;
      const seen = new Set<string>();
      const ppl: { id: string; name: string; title: string }[] = [];
      for (const u of rows as Record<string, unknown>[]) {
        const uid = String(u.Id ?? "").toLowerCase();
        const name = String(u.Name ?? "").trim();
        if (!uid || !name || u.Deleted === true) continue;
        if (/^[0-9a-f]{8}-/.test(name)) continue;
        if (seen.has(uid)) continue;
        seen.add(uid);
        ppl.push({ id: uid, name, title: String(u.JobProfile ?? "").trim() });
      }
      ppl.sort((a, b) => a.name.localeCompare(b.name));
      setKpPeople(ppl);
    }).catch(() => { /* picker degrades to free-typed names */ });
    return () => { alive = false; };
  }, [id, kpPeople.length]);

  const kpResetForm = useCallback(() => {
    setKpAdding(false); setKpErr("");
  }, []);

  // Optimistically patch the *User column in local state BEFORE the save's
  // reload runs. The post-save fast reload rebuilds the card from
  // projectRef.current.rawFields — patching it first means the recompute (and
  // the card) reflect the change instantly instead of after a full page load.
  // Returns the previous project state so a failed save can restore it.
  const kpPatchField = useCallback((field: string, newVal: string): ProjectData | null => {
    const cur = projectRef.current;
    if (!cur) return null;
    const rawFields = { ...cur.rawFields, [field]: newVal };
    const g2n = cur.guidToName || {};
    const entries: KeyPersonnelEntry[] = [];
    if (field === CUSTOM_LEADS_FIELD) {
      // Custom-role save: rebuild EVERY custom:* entry from the new JSON blob.
      for (const { role, name } of listCustomLeads(newVal)) {
        entries.push({ name, role, guid: name, field: `${CUSTOM_ROLE_PREFIX}${role}` });
      }
    } else {
      const role = KP_FIELD_ROLES.find((r) => r.field === field)?.role ?? "";
      for (const rawTok of newVal.split(/[,;]+/)) {
        const tok = rawTok.replace(/^#/, "").trim();
        if (!tok) continue;
        if (/^[0-9a-f]{8}-/i.test(tok)) {
          const nm = g2n[tok.toLowerCase()] || g2n[tok] || "";
          if (nm) entries.push({ name: nm, role, guid: tok.toLowerCase(), field });
        } else {
          entries.push({ name: tok, role, guid: tok, field });
        }
      }
    }
    // Keep every entry from other columns and every synthesised entry whose
    // name isn't now explicitly listed; splice this column's entries in. (For
    // the custom-leads JSON, "this column" = every custom:* entry.)
    const explicitNames = new Set(entries.map((e) => e.name.toLowerCase().trim()));
    const replacesEntry = (k: KeyPersonnelEntry) =>
      field === CUSTOM_LEADS_FIELD ? !!k.field?.startsWith(CUSTOM_ROLE_PREFIX) : k.field === field;
    const keep = cur.keyPersonnel.filter(
      (k) => !replacesEntry(k) && (k.field || !explicitNames.has(k.name.toLowerCase().trim())),
    );
    const next: ProjectData = { ...cur, rawFields, keyPersonnel: [...keep, ...entries] };
    projectRef.current = next;
    setProject(next);
    return cur;
  }, []);

  // Both save paths reuse saveField — it writes the *User column via
  // /update-fields, busts only the affected caches and reloads the record.
  // The AddLeadModal owns the role/person form state and hands the final
  // (column, display name) pair here. Adding APPENDS to the column's
  // comma-separated list — it must never overwrite people already there.
  const kpSave = useCallback(async (field: string, name: string) => {
    const nm = name.trim();
    if (!field || !nm) return;
    const cur = projectRef.current;
    // Custom (user-typed) role — append into the record's JSON column instead
    // of a *User column. Same optimistic-patch + rollback shape as below.
    if (field.startsWith(CUSTOM_ROLE_PREFIX)) {
      const customRole = field.slice(CUSTOM_ROLE_PREFIX.length).trim();
      if (!customRole) return;
      const nextJson = addCustomLead(cur?.rawFields?.[CUSTOM_LEADS_FIELD], customRole, nm);
      if (nextJson == null) {
        setKpErr(`${nm} is already listed as ${customRole}.`);
        return;
      }
      setKpSaving(true); setKpErr("");
      const prevState = kpPatchField(CUSTOM_LEADS_FIELD, nextJson);
      try {
        await saveField(CUSTOM_LEADS_FIELD, nextJson);
        kpResetForm();
      } catch (e) {
        if (prevState) { projectRef.current = prevState; setProject(prevState); }
        setKpErr(e instanceof Error ? e.message : "Could not add the lead");
      } finally { setKpSaving(false); }
      return;
    }
    const raw = String(cur?.rawFields?.[field] ?? "").trim();
    // Duplicate guard: same person already on this role (as a name token or a
    // GUID token that resolves to the same name).
    const g2n = cur?.guidToName || {};
    const existingNames = raw.split(/[,;]+/)
      .map((t) => t.replace(/^#/, "").trim())
      .filter(Boolean)
      .map((t) => (/^[0-9a-f]{8}-/i.test(t) ? (g2n[t.toLowerCase()] || "") : t));
    const roleLabel = KP_FIELD_ROLES.find((r) => r.field === field)?.role ?? "this role";
    if (existingNames.some((n) => n.toLowerCase() === nm.toLowerCase())) {
      setKpErr(`${nm} is already listed as ${roleLabel}.`);
      return;
    }
    const newVal = raw ? `${raw.replace(/[,;\s]+$/, "")}, ${nm}` : nm;
    // The underlying column is NVARCHAR(510) — refuse appends that would
    // overflow it with a clear message instead of a cryptic save error.
    if (newVal.length > 500) {
      setKpErr(`Too many people on ${roleLabel} — remove someone before adding more.`);
      return;
    }
    setKpSaving(true); setKpErr("");
    const prev = kpPatchField(field, newVal);
    try {
      await saveField(field, newVal);
      kpResetForm();
    } catch (e) {
      // Roll the optimistic patch back so the card matches the DB again.
      if (prev) { projectRef.current = prev; setProject(prev); }
      setKpErr(e instanceof Error ? e.message : "Could not add the lead");
    } finally { setKpSaving(false); }
  }, [saveField, kpResetForm, kpPatchField]);

  // Removes ONE person from the column's list (matched by GUID or name token),
  // leaving everyone else on that role in place.
  const kpRemove = useCallback(async (kp: KeyPersonnelEntry) => {
    const field = kp.field;
    if (!field) return;
    // Custom-role entry — strip the name out of the record's JSON column.
    if (field.startsWith(CUSTOM_ROLE_PREFIX)) {
      const customRole = field.slice(CUSTOM_ROLE_PREFIX.length);
      const nextJson = removeCustomLead(projectRef.current?.rawFields?.[CUSTOM_LEADS_FIELD], customRole, kp.name);
      setKpSaving(true); setKpErr("");
      const prevState = kpPatchField(CUSTOM_LEADS_FIELD, nextJson);
      try {
        await saveField(CUSTOM_LEADS_FIELD, nextJson);
        setKpConfirmField("");
      } catch (e) {
        if (prevState) { projectRef.current = prevState; setProject(prevState); }
        setKpErr(e instanceof Error ? e.message : "Could not remove the lead");
      } finally { setKpSaving(false); }
      return;
    }
    const raw = String(projectRef.current?.rawFields?.[field] ?? "").trim();
    // Match by GUID, by name, or by the name a GUID token resolves to — the
    // entry's guid may be a resolved display name (render fallback path)
    // while the column still stores the raw GUID.
    const g2n = projectRef.current?.guidToName || {};
    const isMatch = (t: string) => {
      const orig = t.replace(/^#/, "").trim();
      const c = orig.toLowerCase();
      if (c === kp.guid.toLowerCase() || c === kp.name.toLowerCase().trim()) return true;
      const resolved = (g2n[c] || g2n[orig] || "").toLowerCase().trim();
      return !!resolved && resolved === kp.name.toLowerCase().trim();
    };
    const rest = raw.split(/[,;]+/).map((t) => t.trim()).filter(Boolean).filter((t) => !isMatch(t));
    const newVal = rest.join(", ");
    setKpSaving(true); setKpErr("");
    const prev = kpPatchField(field, newVal);
    try {
      await saveField(field, newVal);
      setKpConfirmField("");
    } catch (e) {
      if (prev) { projectRef.current = prev; setProject(prev); }
      setKpErr(e instanceof Error ? e.message : "Could not remove the lead");
    } finally { setKpSaving(false); }
  }, [saveField, kpPatchField]);

  // Pre-warm caches the AddTeamMemberModal needs (BUs, project roles,
  // user roster, JobTitle catalogue) so the modal opens with data already
  // resolved instead of showing a multi-second "Loading roles & roster…".
  useEffect(() => {
    if (!id) return;
    void Promise.all([
      getDivisions().catch(() => null).then((divs) => {
        if (divs) setDivData(divs.filter((d) => d.Title).sort((a, b) => a.Title.localeCompare(b.Title)));
      }),
      getDepartments().catch(() => null).then((depts) => {
        if (depts) {
          const d = (depts as { ID?: number; Title?: string; Name?: string; DivisionIdLookup?: string | null }[])
            .map((r) => ({ ID: Number(r.ID ?? 0), Title: String(r.Title ?? r.Name ?? ""), DivisionIdLookup: r.DivisionIdLookup ?? null }))
            .filter((r) => r.Title)
            .sort((a, b) => a.Title.localeCompare(b.Title));
          setDeptData(d);
        }
      }),
      getBusinessUnits().catch(() => null).then((bus) => {
        if (bus) {
          const list = (bus as { ID?: string; Id?: string; Title?: string; Name?: string }[])
            .map((b) => ({ id: String(b.ID ?? b.Id ?? ""), title: b.Title ?? b.Name ?? "" }))
            .filter((b) => b.title);
          setBuList(list);
          setBuOptions(list.map((b) => b.title).sort());
        }
      }),
      getProjectDivisionRoles(id).catch(() => null),
      getUserList().catch(() => null),
      getJobTitles().catch(() => null),
    ]);
    // Also write the in-memory roster seed the assign-member cascade reads —
    // the calls above only warm the api-level cached() layer (5-min TTL);
    // the seed is what lets the modal skip the "Loading roles & roster…"
    // spinner entirely. Shares the same in-flight fetches via cached().
    void warmAddMemberRoster(id);
  }, [id]);

  // Pre-warm the THREE collapsed sub-sections (Schedule, Business Units,
  // Budget & Costs) the moment we know the ticketId. Fires in parallel
  // with the main project load so by the time the user clicks any of
  // these sections to expand it, the data is already in the in-memory
  // cache and the section opens INSTANTLY (no spinner). Project Team
  // and Project Health both use data from the main loadProject() call,
  // so they were already fast — this closes the gap on the rest.
  // LEM (lead) records do not render Budget & Costs or Schedule sections,
  // so skip those two prefetches to avoid unnecessary DB round-trips and
  // let the overlay gate resolve on "biz" alone (much faster).
  useEffect(() => {
    if (!id) return;
    const isLem = initialSnap?.project?.module === "LEM";
    const warm = [
      prefetchSubSection("biz", id, () => getProjectDivisionRoles(id)),
      ...(!isLem ? [
        prefetchSubSection("budget", id, () => getBillingRates(id)),
        prefetchSubSection("schedule", id, () => getTaskData(id, "0")),
      ] : []),
    ];
    // Prime the phase-hours cache so the first team-member card expansion
    // is instant instead of waiting for a cold network round-trip.
    void getFullProjectAllocations(id).catch(() => {});
    // Warm the company-wide role rates (session cache + localStorage seed) so
    // the Budget & Costs financials table renders instantly when expanded.
    void getRoleBillingRates().catch(() => {});
    // Fire-and-forget: these warm the section caches in the background so
    // the first expand is instant. They no longer gate the initial overlay —
    // the page must never wait on collapsed sections the user hasn't opened.
    void Promise.allSettled(warm);
  }, [id]);

  useEffect(() => {
    if (!project || project.module !== "COM") return;
    setCompanyLoading(true);
    Promise.all([
      getCompanyProjects(project.name, id).catch(() => ({ data: [] })),
      getCompanyContacts(id).catch(() => ({ data: [] })),
    ]).then(([projRes, conRes]) => {
      setCompanyProjects(((projRes as { data?: unknown })?.data || []) as typeof companyProjects);
      setCompanyContacts(((conRes as { data?: unknown })?.data || []) as typeof companyContacts);
    }).finally(() => setCompanyLoading(false));
  }, [project?.module, project?.name, id]);

  // Accordion behavior with a power-user escape hatch:
  //   • Plain click → open this section, close all others.
  //   • Shift / Ctrl / Cmd / Alt click → toggle this section without
  //     touching the rest, so the user can keep multiple cards open at
  //     once (useful for comparing e.g. Schedule + Budget side-by-side).
  // The header tooltip ("Click to open · Shift-click to keep others
  // open") surfaces the gesture without adding visual noise.
  const toggleSection = (s: string, e?: React.MouseEvent) => {
    const extend = !!(e && (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey));
    setExpandedSections((prev) => {
      if (extend) {
        const next = new Set(prev);
        if (next.has(s)) next.delete(s); else next.add(s);
        return next;
      }
      if (prev.has(s) && prev.size === 1) return new Set();
      return new Set([s]);
    });
  };
  const isExpanded = (s: string) => expandedSections.has(s);

  const askAI = (prompt: string) => {
    setChatPrompt(prompt, { newSession: true, autoSend: true });
    navigate("/chat");
  };

  if (error && !loading) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: Colors.dark, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, padding: 16 }}>
        <button onClick={() => navigate(moduleListPath(project?.module ?? id))} style={backBtnStyle()}><ArrowLeft size={20} /></button>
        <AlertCircle size={40} color="#E03C3C" />
        <div style={{ color: "#E03C3C", fontSize: 15, fontWeight: 600 }}>{error}</div>
        <button onClick={() => loadProject()} style={{
          padding: "10px 20px", backgroundColor: Colors.green, color: "#FFF", border: "none",
          borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 8,
        }}>Retry</button>
      </div>
    );
  }

  // Initial load: the page itself renders normally underneath, but we
  // overlay the same RM ONE processing animation (orbits + breathing
  // core + sweeping bar) on top until the project payload arrives. This
  // way the page (header, hero, summary stat cards) is already mounted
  // and populated when the overlay fades, instead of mounting from
  // scratch and flashing empty cards. Silent background refreshes
  // (loadProject(true)) do NOT re-show the overlay.
  // Keep the popup processing overlay up until the record fields AND the
  // Phase-2 data (team + schedule + allocations) have all landed, so the
  // page is complete — team names, health score, warm schedule cache — the
  // moment the overlay fades. All calls run in parallel from mount (waiting
  // costs no extra serial time) and a 10s safety timer force-dismisses the
  // overlay no matter what. `initialLoadComplete` is a one-way latch (see
  // useEffect above) that only fires once, so background retries (where
  // teamPending cycles back to true) and silent refreshes never re-trigger
  // the overlay.
  const showInitialOverlay = !initialLoadComplete;

  // Publish a read-only snapshot to the browser-test seam after every render.
  // No dependency array on purpose: any state change publishes fresh values.
  // With no observer registered (every production mount) this is a no-op.
  useEffect(() => {
    projectDetailIntegrationObserver?.({
      id: project.id,
      name: project.name,
      status: project.status,
      city: project.city,
      sector: project.sector,
      company: project.company,
      module: project.module,
      rawFieldCount: Object.keys(project.rawFields ?? {}).length,
      allocationNames: project.allocations.map((a) => a.name),
      healthScore: project.healthScore,
      loading,
      teamPending,
      coreDataSettled,
      initialLoadComplete,
      error,
    });
  });

  const hc = healthColor(project.healthScore);
  const pc = phaseColor(project.status);
  const mc = moduleColor(project.module);
  // Avg allocation % is hours-derived — suppress it entirely in
  // "Without schedule and hours" mode (Team card then shows count only).
  const avgAlloc = displayMode !== "no-schedule-no-hours" && project.allocations.length > 0
    ? Math.round(project.allocations.reduce((s, a) => s + a.pct, 0) / project.allocations.length) : 0;

  /* ───── COM (Company) variant ───── */
  if (project.module === "COM") {
    return (
      <>
        <CompanyView project={project} navigate={navigate} askAI={askAI}
          companyProjects={companyProjects} companyContacts={companyContacts} companyLoading={companyLoading}
          isExpanded={isExpanded} toggleSection={toggleSection} mc={mc} />
        {showInitialOverlay && <RmOneProcessing label="Loading project…" sublabel="FETCHING PROJECT DATA" light />}
      </>
    );
  }

  /* ───── CON (Contact) variant ───── */
  if (project.module === "CON") {
    return (
      <>
        <ContactView project={project} navigate={navigate} askAI={askAI}
          isExpanded={isExpanded} toggleSection={toggleSection} />
        {showInitialOverlay && <RmOneProcessing label="Loading project…" sublabel="FETCHING PROJECT DATA" light />}
        {isRefreshing && (
          <div style={{
            position: "fixed", bottom: 24, right: 24, zIndex: Z.POPUP,
            background: "rgba(20,20,30,0.97)", border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12, padding: "10px 16px",
            display: "flex", alignItems: "center", gap: 8,
            boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
            fontSize: 13, color: "#fff", fontWeight: 600,
            pointerEvents: "none",
          }}>
            <Loader2 size={14} className="rmone-spin" style={{ color: "var(--rm-green)" }} />
            Syncing…
          </div>
        )}
      </>
    );
  }

  /* ───── PMM / OPM / LEM (Project / Opportunity / Lead) ───── */
  return (
    <div ref={fadeRef} style={{ minHeight: "100vh", backgroundColor: Colors.dark, color: "var(--rm-text)", animation: "rmone-fade-in 0.4s ease-out" }}>
      {/* Branded full-bleed processing overlay — sits ON TOP of the
          normally-rendered page during the initial fetch so that when
          it fades away the header, hero, and the two summary stat
          cards (Team avatar pile + Health ring) are already populated
          underneath. No mount flash, no empty-card flicker. */}
      {showInitialOverlay && <RmOneProcessing label="Loading project…" sublabel="FETCHING PROJECT DATA" light />}

      {/* "Schedule already ended" popup — shown once per visit when this
          project's phase schedule finished in the past. Close = dismiss and
          stay on the page; Edit Schedule = open + scroll to the schedule
          section. Waits for the initial overlay to clear first. */}
      {schedEndedPrompt && !showInitialOverlay && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: Z.MODAL_CHILD_2,
            backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setSchedEndedPrompt(null); }}>
          <div style={{
            width: "min(440px, calc(100vw - 32px))",
            backgroundColor: "var(--rm-panel, #1a1f1a)",
            border: `1px solid ${Colors.border}`,
            borderRadius: 16, padding: 20,
            boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                backgroundColor: "rgba(232,119,34,0.14)", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Calendar size={18} color={Colors.orange} />
              </div>
              <span style={{ fontSize: 15, fontWeight: 800, color: Colors.white }}>Project schedule ended</span>
            </div>
            <div style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 1.55, marginBottom: 6 }}>
              This project&apos;s phase schedule has already ended — the last phase finished on{" "}
              <span style={{ color: Colors.white, fontWeight: 700 }}>{fmtDate(schedEndedPrompt.endDate)}</span>.
            </div>
            <div style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 1.55, marginBottom: 16 }}>
              {schedEndedPrompt.autoClosed
                ? "Its status has been updated to Closed automatically. If the project is still running, extend the schedule."
                : "This project is marked as Closed. If it's still running, extend the schedule."}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setSchedEndedPrompt(null)}
                style={{
                  padding: "9px 18px", borderRadius: 10, cursor: "pointer",
                  border: `1px solid ${Colors.border}`, backgroundColor: "transparent",
                  color: Colors.textSecondary, fontSize: 13, fontWeight: 700,
                }}>
                Close
              </button>
              <button
                onClick={() => {
                  setSchedEndedPrompt(null);
                  setExpandedSections(new Set(["timeline"]));
                  setTimeout(() => {
                    document.getElementById("schedule-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 150);
                }}
                style={{
                  padding: "9px 18px", borderRadius: 10, cursor: "pointer",
                  border: "none", backgroundColor: Colors.orange,
                  color: "#fff", fontSize: 13, fontWeight: 700,
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                <Calendar size={14} color="#fff" /> Edit Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading progress bar */}
      {loading && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 3, zIndex: 50, overflow: "hidden", backgroundColor: Colors.green + "20" }}>
          <div style={{ height: "100%", width: "40%", backgroundColor: Colors.green, borderRadius: 2, animation: "rmone-shimmer 1.2s ease-in-out infinite" }} />
        </div>
      )}

      {/* Header bar */}
      <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", gap: 8, position: "sticky", top: 0, zIndex: 30, backgroundColor: Colors.dark }}>
        <button onClick={() => navigate(moduleListPath(project.module))} style={backBtnStyle()}><ArrowLeft size={20} /></button>
        <div style={{ flex: 1, fontSize: 15, fontWeight: 600, color: Colors.white, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 10px" }}>{project.name}</div>
        {isRootAccount(user?.username) && (
          <button
            title="Delete Record (superadmin only)"
            onClick={async () => {
              const noun = project.module === "OPM" ? "opportunity" : project.module === "LEM" ? "lead" : "project";
              const displayId = String(project.rawFields?.ProjectId ?? "").trim() || project.id;
              if (!window.confirm(
                `Delete ${noun} "${project.name}" (${displayId})?\n\nThis removes the record plus its team assignments and schedule for this company. This cannot be undone.`
              )) return;
              try {
                const mod = project.module === "OPM" ? "OPM" : project.module === "LEM" ? "LEM" : "PMM";
                await apiDeleteRecord(project.id, mod);
                toast({ title: "Record Deleted", description: `"${project.name}" (${displayId}) was removed.` });
                navigate(moduleListPath(project.module));
              } catch (e: any) {
                toast({ title: "Delete Failed", description: e?.message || "Could not delete the record.", variant: "destructive" });
              }
            }}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 10px", borderRadius: 8, border: "1px solid #EF444440",
              backgroundColor: "#EF444415", color: "#EF4444",
              fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0,
            }}
          >
            <Trash2 size={13} />
            Delete
          </button>
        )}
      </div>

      {/* Hero card */}
      <div style={{
        margin: "4px 16px 16px", padding: 20, backgroundColor: Colors.darkCard, borderRadius: 20,
        border: `1px solid ${Colors.border}`, position: "relative", overflow: "hidden",
        boxShadow: "0 12px 22px rgba(0,0,0,0.4)",
      }}>
        <HeroBg accent={mc} />
        <div style={{ position: "relative", zIndex: 1 }}>
          {(() => {
            // Hide the phase/status pill entirely when the underlying value
            // is missing or just the "—" placeholder — otherwise the user
            // sees an orphan "• —" badge with no meaning. The MODULE chip on
            // the right still renders so the header doesn't collapse.
            const phaseLabel = (project.phase || project.status || "").trim();
            const hasPhase = phaseLabel && phaseLabel !== "—";
            return (
              <div style={{ display: "flex", justifyContent: hasPhase ? "space-between" : "flex-end", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                {hasPhase && (
                  <div style={{
                    display: "flex", alignItems: "center", padding: "5px 10px", borderRadius: 20, gap: 6,
                    backgroundColor: pc + "18", border: `1px solid ${pc}40`,
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: pc }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: pc, textTransform: "uppercase", letterSpacing: 0.5 }}>{phaseLabel}</span>
                  </div>
                )}
                {(() => {
                  const sn = String(project.rawFields?.ShortName ?? "").trim();
                  return (
                    <div style={{ padding: "4px 10px", borderRadius: 8, backgroundColor: mc + "20", border: `1px solid ${mc}30`, textAlign: "right" }}>
                      {sn ? (
                        <>
                          <div style={{ fontSize: 12, fontWeight: 700, color: mc, lineHeight: 1.3 }}>{sn}</div>
                          <div style={{ fontSize: 9, fontWeight: 600, color: mc, opacity: 0.6, letterSpacing: 0.8, textTransform: "uppercase" }}>{project.module}</div>
                        </>
                      ) : (
                        <span style={{ fontSize: 10, fontWeight: 700, color: mc, letterSpacing: 0.8 }}>{project.module}</span>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })()}
          {(() => {
            // Render the real Title up top; only show the PMM/OPM/LEM
            // record ID as a secondary line when it differs from the
            // title (so freshly-created records with no Title yet don't
            // display the ID twice).
            const hasTitle = project.name && project.name !== project.id;
            return (
              <>
                <div style={{ fontSize: 22, fontWeight: 700, color: Colors.white, marginBottom: 4, lineHeight: 1.3 }}>
                  {hasTitle ? project.name : project.id}
                </div>
                {hasTitle && (
                  <div style={{ fontSize: 12, color: Colors.textMuted, marginBottom: 4 }}>
                    {String(project.rawFields?.ProjectId ?? "").trim() || project.id}
                  </div>
                )}
              </>
            );
          })()}
          {(() => {
            const rf = project.rawFields || {};
            const desc = String(
              rf.Description ?? rf.LongDescription ?? rf.ProjectDescription ?? rf.RecordDescription ?? "",
            ).trim();
            if (!desc) return null;
            return (
              <div style={{
                fontSize: 13, color: Colors.textSecondary, marginTop: 8, marginBottom: 6,
                lineHeight: 1.5, whiteSpace: "pre-wrap",
              }}>{desc}</div>
            );
          })()}
          <div style={{ marginBottom: 14 }} />

          {project.company && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              backgroundColor: "rgba(255,255,255,0.04)", padding: "10px 12px", borderRadius: 12,
              border: `1px solid ${Colors.border}`, marginTop: 14,
            }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(132,204,22,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Home size={14} color={Colors.green} />
              </div>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: Colors.white }}>{project.company}</span>
            </div>
          )}

          {(() => {
            const rf = project.rawFields || {};
            const sv2 = (v: unknown) => v != null && String(v).trim() ? String(v).trim() : "";
            const pType = sv2(rf.ProjectType) || sv2(rf.ProjectTypeChoice) || sv2(rf.CRMProjectTypeChoice);
            const sType = sv2(rf.ServiceType) || sv2(rf.ServiceTypeChoice) || sv2(rf.ServiceTypeText);
            const hasChips = project.city || (project.sector && project.sector !== "—") || project.bu || pType || sType;
            if (!hasChips) return null;
            return (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {project.city && <Chip icon={MapPin}>{project.city}</Chip>}
                {project.sector && project.sector !== "—" && <Chip icon={Tag}>{project.sector}</Chip>}
                {pType && <Chip icon={Layers}>{pType}</Chip>}
                {sType && <Chip icon={Briefcase}>{sType}</Chip>}
                {project.bu && <Chip icon={Building2}>{project.bu}</Chip>}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Stats row — hidden during initial load so the user never sees a
          misleading "0 TEAM" card before allocations finish fetching.
          Team + Health always render once loading completes (with an
          empty/zero state) so the layout stays consistent across
          projects rather than a card silently disappearing on records
          that happen to have no team or no health score yet. */}
      {!loading && (
        <div style={{ display: "flex", margin: "0 16px 12px", gap: 8, flexWrap: "wrap" }}>
          {(() => {
            // #124 follow-up: the "Contract" header chip shows the OWN
            // ContractValue column when both live columns exist.
            const cv = ownContractValues(project.rawFields, project.value).contract;
            return cv > 0 ? <StatCard icon={DollarSign} iconColor={Colors.green} label="Contract" value={fmtM(cv)} /> : null;
          })()}
          {/* Shimmer ONLY while we have nothing to show — during the silent
              empty-team retry cycle teamPending flips back to true, but when
              members are already rendered (early-team fill, fallback rows, or
              a previous fetch) showing "Loading…" NEXT TO a populated Project
              Team section read as contradictory/stuck. The retry replaces the
              rendered list silently when it lands. */}
          {project.module !== "LEM" && <TeamStatCard allocations={project.allocations} avgAlloc={avgAlloc} hidePct={displayMode === "no-schedule-no-hours"} loading={teamPending && project.allocations.length === 0} />}
          <HealthStatCard score={project.healthScore} color={hc} label={healthLabel(project.healthScore)} />
          {project.probability > 0 && <StatCard icon={Target} iconColor={ACCENT_PURPLE} label="Win Prob" value={`${project.probability}%`} />}
        </div>
      )}

      {/* ── Up-front view-only banner (#87): people whose access level would
          normally allow edits learn immediately that this record's current
          stage (or a custom access level) blocks changes — instead of
          discovering it pencil by pencil through failed saves. Display-only:
          the server re-enforces on every write path. ── */}
      {editLockNote && (
        <div style={{
          margin: "0 16px 12px", padding: "12px 16px", borderRadius: 12,
          border: "1px solid rgba(217,164,65,0.5)", backgroundColor: "rgba(217,164,65,0.10)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <LockIcon size={16} color="#a8842c" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "var(--rm-text)", fontWeight: 500 }}>
            {editLockNote} You can still view everything on this page.
          </span>
        </div>
      )}

      {/* ── Section cards grid ──
          `dense` packing lets later cards backfill any hole left when an
          expanded card spans both columns or a conditional card is absent,
          so the two columns always stay balanced with no empty cells. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gridAutoFlow: "row dense", gap: 12, margin: "0 16px 12px" }}>

      {/* ── Project Details ── */}
      <SectionCard icon={Layers} iconColor={ACCENT_PURPLE}
        order={-4}
        title={project.module === "LEM" ? "Lead Details" : project.module === "OPM" ? "Opportunity Details" : "Project Details"}
        expanded={isExpanded("details")} onToggle={(e) => toggleSection("details", e)}>
        {/* Customize bar — lets the user pick any RM ONE field returned
            by the upstream API to surface as an extra DetailCell. The
            selection persists per-module in localStorage so power users
            can build their own "General tab" view. */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button onClick={() => setShowCustomizeFields((v) => !v)} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 10px", borderRadius: 8,
            backgroundColor: "rgba(255,255,255,0.04)",
            border: `1px solid ${Colors.border}`,
            color: Colors.textSecondary, fontSize: 11, fontWeight: 600, cursor: "pointer",
          }}>
            <Edit2 size={11} color={Colors.textMuted} />
            {showCustomizeFields ? "Done" : "Customize fields"}
            {(customFieldKeys.length + hiddenFieldKeys.length) > 0 && (
              <span style={{
                marginLeft: 4, padding: "1px 6px", borderRadius: 8,
                backgroundColor: ACCENT_PURPLE + "33", color: ACCENT_PURPLE, fontSize: 10, fontWeight: 700,
              }}>{customFieldKeys.length + hiddenFieldKeys.length}</span>
            )}
          </button>
        </div>

        {showCustomizeFields && (() => {
          const rf = project.rawFields || {};
          function isUsableField(k: string, inAuto: boolean) {
            if (k.startsWith("_")) return false;
            if (SUPPRESSED_FIELD_KEYS.has(k)) return false;
            const v = rf[k];
            if (v == null || typeof v === "object") return false;
            const s = String(v).trim();
            if (!s.length || s === "false" || s === "null" || s.startsWith("0001-")) return false;
            if (k.endsWith("Lookup") && (
              /^\d+$/.test(s) ||
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
            )) return false;
            return inAuto === AUTO_SHOWN_KEYS.has(k);
          }
          // Fields displayed by default as dedicated cells — now toggleable
          // (untick to hide) instead of locked.
          const alwaysKeys = Object.keys(rf).filter((k) => isUsableField(k, true)).sort((a, b) => a.localeCompare(b));
          // Optional extra fields — user can pin/unpin them
          const optionalKeys = Object.keys(rf).filter((k) => isUsableField(k, false)).sort((a, b) => a.localeCompare(b));
          return (
            <FieldCustomizePanel
              rf={rf as Record<string, unknown>}
              alwaysKeys={alwaysKeys}
              optionalKeys={optionalKeys}
              pinnedKeys={customFieldKeys}
              hiddenKeys={hiddenFieldKeys}
              onTogglePin={(k) => setCustomFieldKeys((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k])}
              onToggleHide={toggleHiddenKey}
              search={customFieldSearch}
              onSearch={setCustomFieldSearch}
              showReset={customFieldsCustomized || hiddenFieldsCustomized || customFieldKeys.length > 0 || hiddenFieldKeys.length > 0}
              onReset={() => { resetCustomFieldKeys(); resetHiddenFieldKeys(); }}
              extraAction={companyDefaultButton}
            />
          );
        })()}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {/* Project ID — always the FIRST cell. Falls back to the record's
              ticket ID when the ProjectId column is empty so the identifier
              is never missing from the card. */}
          {!layoutFieldHidden("ProjectId") && (() => {
            const pidVal = String(project.rawFields?.ProjectId ?? "").trim() || project.id;
            return <DetailCell label="Project ID" value={pidVal} />;
          })()}
          {project.module === "OPM" ? (() => {
            // Opportunities: STATUS *is* the sales-pipeline stage — one
            // dropdown with the opp-scoped stage options (never the global
            // PMM status list), saved to CRMOpportunityStatusChoice. The
            // separate STAGE row was removed in favour of this single cell.
            const rfs = project.rawFields ?? {};
            // First NON-EMPTY wins — same columns + order as the server's
            // stage-rules evaluation (getCurrentStageRds), so the lock icon
            // and the displayed stage always agree with enforcement.
            const stageVal = [rfs.CRMOpportunityStatusChoice, rfs.CRMOpportunityStageChoice, rfs.Status]
              .map((v) => String(v ?? "").trim()).find(Boolean) ?? "";
            if (!(canEdit || stageVal) || layoutFieldHidden("Status", "CRMProjectStatusChoice", "CRMOpportunityStatusChoice", "Stage", "StageChoice")) return null;
            return (
              <DetailCell label="Status" value={stageVal || "—"} color={pc}
                editable={canEdit} editType="select" searchable
                options={applyStageDisplayRules((() => {
                  const base = opmStageOptions.length > 0 ? opmStageOptions : OPM_FALLBACK_STAGES;
                  if (!scheduleOff) {
                    // Schedule shown + this opportunity has its OWN assigned
                    // lifecycle: those phases ARE the status choices — purely
                    // this record's schedule (client mandate: no stage pile
                    // mixed in, and the current value is NOT injected — the
                    // closed cell and the edit input still display it). The
                    // record's saved customization (Override Status modal:
                    // sub-statuses, custom adds, removals) applies on top.
                    if (schedulePhases !== null && schedulePhases.length > 0) {
                      return applyStageCfgToOptions(schedulePhases, recordStageCfg, { lockedBase: true });
                    }
                    // CONFIRMED no lifecycle assigned ([]): mirrors projects —
                    // no pipeline pile; the pinned action row jumps to the
                    // schedule card to assign one, and typing saves a custom
                    // status directly. null = still unknown (loading) → the
                    // configured pipeline list, never a flash of the prompt.
                    if (schedulePhases !== null && schedulePhases.length === 0) {
                      // Custom statuses the user already added (Override modal
                      // "+ Add statuses…") still list — with no schedule the
                      // record's own additions ARE the status choices.
                      return applyStageCfgToOptions([], recordStageCfg);
                    }
                    return withWorkflowStages(base);
                  }
                  // Schedule display is OFF for this record: the pipeline
                  // stage list is a schedule artifact, so the picker offers
                  // only the tenant's own CUSTOM statuses (observed values
                  // that are not configured stages). The current value always
                  // stays selectable so the cell never lies about it.
                  const stageSet = new Set(
                    [...(stageRuleInfo.tenantOrder ?? []), ...OPM_FALLBACK_STAGES]
                      .map((s) => s.trim().toLowerCase()));
                  const custom = base.filter((s) => !stageSet.has(s.trim().toLowerCase()));
                  const curKey = stageVal.trim().toLowerCase();
                  return curKey && !custom.some((s) => s.trim().toLowerCase() === curKey)
                    ? [stageVal, ...custom] : custom;
                })(), !scheduleOff && schedulePhases !== null && schedulePhases.length > 0)}
                editValue={stageVal}
                lockedNote={lockNote("CRMOpportunityStatusChoice")}
                customHint="Need a different status? Type it above — custom entries save too."
                indentedOptions={!scheduleOff && schedulePhases !== null && schedulePhases.length > 0 ? recordSubStatusKeys : undefined}
                {...(
                  // Confirmed no lifecycle assigned while the display mode
                  // shows a schedule: pin an action row that jumps to the
                  // Opportunity Schedule card's lifecycle picker, and make
                  // free-text entry the primary path (mirrors projects).
                  !scheduleOff && schedulePhases !== null && schedulePhases.length === 0 ? {
                  actionOptions: [
                    {
                      label: "Select a lifecycle schedule…",
                      onPick: () => {
                        setExpandedSections((prev) => { const s = new Set(prev); s.add("timeline"); return s; });
                        setTimeout(() => document.getElementById("schedule-section")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
                      },
                    },
                    // No schedule = free-form statuses: adding stages is a
                    // first-class action, straight into the add input.
                    ...(canAdvanceStage ? [{
                      label: "+ Add statuses…",
                      onPick: () => { setOverrideFocus({ addStage: true }); setOverrideSignal((v) => v + 1); },
                    }] : []),
                  ],
                  searchPlaceholder: "Type a custom status…",
                }
                // Phases-driven list: each phase row carries its own "+ Sub"
                // pill (straight into that phase's sub-status input); the
                // single action row is just the full customize editor.
                : !scheduleOff && schedulePhases !== null && schedulePhases.length > 0 && canAdvanceStage ? {
                  actionOptions: [{
                    label: "Customize this list…",
                    onPick: () => { setOverrideFocus({}); setOverrideSignal((v) => v + 1); },
                  }],
                  optionAction: {
                    title: "Add a sub-status under this phase",
                    label: "Sub",
                    onPick: (phase: string) => { setOverrideFocus({ subFor: phase }); setOverrideSignal((v) => v + 1); },
                  },
                } : {})}
                onSave={(v) => {
                  // "Scheduled for later" guard: a phase (or sub-status of a
                  // phase) whose schedule window hasn't started can't be
                  // picked manually — status follows the schedule week.
                  const gate = !scheduleOff
                    ? futurePhaseGate(v, schedulePhases, schedulePhaseDates, recordStageCfg.subStatuses, stageVal)
                    : null;
                  if (gate) {
                    setFutureWarn({ stage: v, ...gate });
                    return Promise.reject(new Error(`"${gate.phase}" starts ${fmtDayLabel(gate.startDay)} in the schedule.`));
                  }
                  return saveField("CRMOpportunityStatusChoice", v).then((res) => {
                    persistTypedCustomStatus(v);
                    return res;
                  });
                }} />
            );
          })() : (project.status && project.status !== "—") && !layoutFieldHidden("Status", "CRMProjectStatusChoice", "CRMOpportunityStatusChoice") && (
            <DetailCell label="Status" value={project.status} color={pc}
              editable={canEdit} editType="select" searchable
              // Projects must always offer the contract designations —
              // Pipeline (committed, no contract) and Active (contracted) —
              // even when no record has used them yet (the option list is
              // otherwise data-driven and would omit them).
              // Branch on project.module (the record's canonical module), not
              // the ticket-ID prefix — custom IDs can misclassify by prefix,
              // and withWorkflowStages injects the module's workflow order, so
              // both must follow the SAME module signal.
              options={applyStageDisplayRules(project.module === "PMM"
                ? (() => {
                    const uniqCI = (arr: string[]) => {
                      const seen = new Set<string>(); const out: string[] = [];
                      for (const s of arr) { const k = s.trim().toLowerCase(); if (!k || seen.has(k)) continue; seen.add(k); out.push(s); }
                      return out;
                    };
                    if (scheduleOff) {
                      // Schedule display OFF: phases are not statuses here —
                      // offer the contract designations plus the tenant's own
                      // status values, filtering back out any phase names
                      // scraped from record data. The current value always
                      // stays selectable so the cell never lies about it.
                      const phaseSet = new Set((schedulePhases ?? []).map((s) => s.trim().toLowerCase()));
                      const curKey = (project.status === "—" ? "" : (project.status ?? "")).trim().toLowerCase();
                      return withWorkflowStages(uniqCI(["Pipeline", "Active", ...statusOptions]
                        .filter((s) => { const k = s.trim().toLowerCase(); return !phaseSet.has(k) || k === curKey; })));
                    }
                    // Schedule ON but this record has CONFIRMED no lifecycle
                    // assigned (task fetch answered empty): no tenant-wide
                    // status pile — the pinned action row jumps to the
                    // schedule card to assign a lifecycle, and typing saves a
                    // custom status directly. null = still unknown (loading)
                    // → fall through to the full list rather than flashing
                    // the prompt at every record open.
                    if (schedulePhases !== null && schedulePhases.length === 0) {
                      // Custom statuses the user already added (Override modal
                      // "+ Add statuses…") still list — with no schedule the
                      // record's own additions ARE the status choices.
                      return applyStageCfgToOptions([], recordStageCfg);
                    }
                    // Schedule ON with phases known: the record's OWN
                    // schedule phases ARE the status choices — purely the
                    // schedule (client mandate: no Pipeline/Active or tenant
                    // pile mixed in, and the current value is NOT injected —
                    // the closed cell and the edit input still display it).
                    // The record's saved customization (Override Status
                    // modal: drag order, custom adds, removals) applies on
                    // top, so dragging there reorders THIS dropdown too.
                    if (schedulePhases !== null) {
                      return applyStageCfgToOptions(schedulePhases, recordStageCfg, { lockedBase: true });
                    }
                    // null = still unknown (loading / just navigated) → the
                    // full list, never a flash of the wrong set.
                    return withWorkflowStages(uniqCI(["Pipeline", "Active", ...statusOptions]));
                  })()
                : project.module === "LEM" && (lemStatusOptions.length > 0 || (stageRuleInfo.tenantOrder?.length ?? 0) > 0)
                // "Converted" is stamped only by the To Opportunity flow — hand-
                // picking it here would fake a conversion (blue chip, locked bar).
                ? withWorkflowStages(lemStatusOptions).filter((s) => s.trim().toLowerCase() !== "converted")
                : statusOptions,
                project.module === "PMM" && !scheduleOff && schedulePhases !== null && schedulePhases.length > 0)}
              editValue={project.status === "—" ? "" : project.status}
              lockedNote={projectStatusLockNote}
              customHint={project.module === "PMM" && !scheduleOff && schedulePhases !== null && schedulePhases.length === 0
                ? "Pipeline and Active are built-in project statuses, not saved schedule phases. Assign a lifecycle to use dated phases instead."
                : "Need a different status? Type it above — custom entries save too."}
              indentedOptions={project.module === "PMM" && !scheduleOff && schedulePhases !== null && schedulePhases.length > 0 ? recordSubStatusKeys : undefined}
              {...(
                // Confirmed no lifecycle assigned while the display mode
                // shows a schedule: pin an action row that jumps to the
                // Project Schedule card's lifecycle picker, and make the
                // free-text entry the primary path.
                project.module === "PMM" && !scheduleOff && schedulePhases !== null && schedulePhases.length === 0 ? {
                  actionOptions: [
                    {
                      label: "Select a lifecycle schedule…",
                      onPick: () => {
                        setExpandedSections((prev) => { const s = new Set(prev); s.add("timeline"); return s; });
                        setTimeout(() => document.getElementById("schedule-section")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
                      },
                    },
                    ...(user?.isAdmin === true ? [{
                      label: "Configure project status rules…",
                      onPick: () => navigate("/onboarding/settings"),
                    }] : []),
                    // No schedule = free-form statuses: adding stages is a
                    // first-class action, straight into the add input.
                    ...(canAdvanceStage ? [{
                      label: "+ Add statuses…",
                      onPick: () => { setOverrideFocus({ addStage: true }); setOverrideSignal((v) => v + 1); },
                    }] : []),
                  ],
                  searchPlaceholder: "Type a custom status…",
                }
                // Phases-driven list: each phase row carries its own "+ Sub"
                // pill (straight into that phase's sub-status input); the
                // single action row is just the full customize editor.
                : project.module === "PMM" && !scheduleOff && schedulePhases !== null && schedulePhases.length > 0 && canAdvanceStage ? {
                  actionOptions: [{
                    label: "Customize this list…",
                    onPick: () => { setOverrideFocus({}); setOverrideSignal((v) => v + 1); },
                  }],
                  optionAction: {
                    title: "Add a sub-status under this phase",
                    label: "Sub",
                    onPick: (phase: string) => { setOverrideFocus({ subFor: phase }); setOverrideSignal((v) => v + 1); },
                  },
                } : {})}
              onSave={(v) => {
                // Same "scheduled for later" guard as the footer stepper.
                const gate = !scheduleOff
                  ? futurePhaseGate(v, schedulePhases, schedulePhaseDates, recordStageCfg.subStatuses,
                      project.status === "—" ? "" : (project.status ?? ""))
                  : null;
                if (gate) {
                  setFutureWarn({ stage: v, ...gate });
                  return Promise.reject(new Error(`"${gate.phase}" starts ${fmtDayLabel(gate.startDay)} in the schedule.`));
                }
                return saveField("CRMProjectStatusChoice", v).then((res) => {
                  persistTypedCustomStatus(v);
                  return res;
                });
              }} />
          )}
          <DetailCell label="Module" value={project.module} color={mc} />
          {(canEdit || project.bu) && !layoutFieldHidden("CRMBusinessUnitChoice", "BusinessUnitName") && (
            <DetailCell label="Business Unit" value={project.bu || "—"}
              editable={canEdit}
              editType="select"
              options={buOptions.length > 0 ? buOptions : undefined}
              editValue={project.bu}
              // Track live draft so Division options cascade immediately
              onDraftChange={(v) => { setActiveBuDraft(v); setActiveDivDraft(""); }}
              lockedNote={lockNote("CRMBusinessUnitChoice")}
              onSave={(v) => { setActiveBuDraft(""); setActiveDivDraft(""); return saveField("CRMBusinessUnitChoice", v); }} />
          )}
          {(() => {
            const rf = project.rawFields || {};
            const div  = String(rf.CompanyDivisionsTitle ?? rf.DivisionName ?? rf.Division ?? "").trim();
            // DepartmentName comes from the DepartmentLookup FK resolution;
            // Department (text) is the raw fallback stored when FK column absent on PMM.
            const dept = String(rf.DepartmentName ?? rf.Department ?? "").trim();

            // Use the live draft value (if user is currently picking) or the
            // saved value for computing cascade-filtered option lists.
            const buForFilter  = activeBuDraft  || project.bu;
            const divForFilter = activeDivDraft || div;

            const buId  = buList.find((b) => b.title === buForFilter)?.id;
            const filteredDivs = buId
              ? divData.filter((d) => !d.BusinessUnitIdLookup || d.BusinessUnitIdLookup === buId)
              : divData;
            const divOptions = (filteredDivs.length > 0 ? filteredDivs : divData).map((d) => d.Title);

            const divId = divData.find((d) => d.Title === divForFilter)?.ID;
            const filteredDepts = divId
              ? deptData.filter((d) => !d.DivisionIdLookup || d.DivisionIdLookup === String(divId))
              : deptData;
            const deptOptions = (filteredDepts.length > 0 ? filteredDepts : deptData).map((d) => d.Title);

            return (
              <>
                {getBusinessRules().showDivision && (canEdit || div) && !layoutFieldHidden("DivisionLookup", "DivisionName", "CompanyDivisionsTitle", "Division") && (
                  <DetailCell label="Division" value={div || "—"}
                    editable={canEdit}
                    editType="select"
                    options={divOptions.length > 0 ? divOptions : undefined}
                    editValue={div}
                    // Track live draft so Department options cascade immediately
                    onDraftChange={(v) => setActiveDivDraft(v)}
                    lockedNote={lockNote("DivisionLookup")}
                    onSave={(v) => {
                      setActiveDivDraft("");
                      const found = divData.find((d) => d.Title === v);
                      return saveField("DivisionLookup", found ? String(found.ID) : v);
                    }} />
                )}
                {(canEdit || dept) && !layoutFieldHidden("DepartmentLookup", "DepartmentName", "Department") && (
                  <DetailCell label="Department" value={dept || "—"}
                    editable={canEdit}
                    editType="select"
                    options={deptOptions.length > 0 ? deptOptions : undefined}
                    editValue={dept}
                    lockedNote={lockNote("DepartmentLookup")}
                    onSave={(v) => {
                      const found = deptData.find((d) => d.Title === v);
                      return saveField("DepartmentLookup", found ? String(found.ID) : v);
                    }} />
                )}
              </>
            );
          })()}
          {(() => {
            if (layoutFieldHidden("CompanyName", "CRMCompanyLookupName", "CRMCompanyLookup")) return null;
            // Editable "Client Name" on all modules (PMM included, July 2026) —
            // saving a name find-or-creates the CRMCompany row server-side
            // (CRMClientName is rewritten to CRMCompanyLookup by the backend).
            if (!canEdit && !project.company) return null;
            return (
              <DetailCell label="Client Name" value={project.company || "—"}
                editable={canEdit} editType="text" editValue={project.company}
                lockedNote={lockNote("CRMClientName")}
                onSave={(v) => saveField("CRMClientName", v)} />
            );
          })()}
          {(() => {
            const rf = project.rawFields || {};
            const street = String(rf.StreetAddress1 ?? "").trim();
            const city   = String(rf.City ?? project.city ?? "").trim();
            const state  = String(rf.StateLookup ?? "").trim();
            const office = String(rf.Office ?? "").trim();
            return (
              <>
                {street && !layoutFieldHidden("StreetAddress1") && <DetailCell label="Street Address" value={street} />}
                {city   && !layoutFieldHidden("City")           && <DetailCell label="City"           value={city} />}
                {state  && !layoutFieldHidden("StateLookup")    && <DetailCell label="State"          value={state} />}
                {office && !layoutFieldHidden("Office")         && <DetailCell label="Office"         value={office} />}
              </>
            );
          })()}
          {/* Sector shows whenever the user could SET one (editors see an
              empty "—" cell with a pencil) — hiding it while blank made it
              impossible to ever fill in, and stage rules that lock Sector
              looked broken because the field was nowhere on the page. */}
          {(canEdit || (project.sector && project.sector !== "—")) && !layoutFieldHidden("SectorChoice", "Sector") && (
            <DetailCell label="Sector" value={project.sector && project.sector !== "—" ? project.sector : "—"}
              editable={canEdit} editType="select"
              options={sectorOptions.length > 0 ? sectorOptions : undefined}
              editValue={project.sector === "—" ? "" : project.sector}
              lockedNote={lockNote("SectorChoice")}
              onSave={(v) => saveField("SectorChoice", v)} />
          )}
          {/* Workflow Type — admin-named workflow variant (Settings → Stage
              Rules → Workflow tab). Drives per-type stage skips. Only shows
              when the company defined types for this module (or the record
              already carries a value, e.g. from an import). */}
          {(() => {
            if (layoutFieldHidden("WorkflowTypeName")) return null;
            const wfCur = String(project.rawFields?.WorkflowTypeName ?? "").trim();
            const wfDefs = stageRuleInfo.wfDefs;
            if (wfDefs.length === 0 && !wfCur) return null;
            if (!canEdit && !wfCur) return null;
            // Restricted types (#121/#131): only members of an allowed group
            // OR an explicitly listed person may SET a restricted type, so
            // others don't get it as a choice. The record's CURRENT value
            // always stays visible — if the user couldn't set it themselves it
            // renders as a disabled option with a tooltip (they can keep it,
            // not re-pick it), and when nothing at all is pickable the cell
            // simply goes read-only.
            const myUserGuid = getMyUserGuid();
            const canPickDef = (d: { allowedGroupIds: string[]; allowedUserIds: string[] }) =>
              (d.allowedGroupIds.length === 0 && d.allowedUserIds.length === 0)
              || d.allowedGroupIds.some((gid) => myGroupIds.includes(gid))
              || (myUserGuid !== "" && d.allowedUserIds.some((uid) => uid.trim().toLowerCase() === myUserGuid));
            const pickable = wfDefs.filter(canPickDef).map((d) => d.name);
            const curDef = wfDefs.find((d) => d.name.trim().toLowerCase() === wfCur.toLowerCase());
            const curBlocked = !!wfCur && !!curDef && !canPickDef(curDef);
            const inPickable = !!wfCur && pickable.some((t) => t.trim().toLowerCase() === wfCur.toLowerCase());
            const opts = wfCur && !inPickable ? [wfCur, ...pickable] : pickable;
            return (
              <DetailCell label="Workflow Type" value={wfCur || "—"}
                editable={canEdit && pickable.length > 0} editType="select"
                options={opts}
                disabledOptions={curBlocked ? {
                  [wfCur]: "This workflow type is limited to specific groups or people, and you're not on the list — you can keep it, but once changed you can't set it back.",
                } : undefined}
                editValue={wfCur}
                lockedNote={lockNote("WorkflowTypeName")}
                onSave={(v) => saveField("WorkflowTypeName", v)} />
            );
          })()}
          {(() => {
            // #124 follow-up: show the OWN ContractValue column when the live
            // table carries both contract-value columns (see ownContractValues).
            const cv = ownContractValues(project.rawFields, project.value).contract;
            if ((!canEditFinancialFields && cv <= 0) || layoutFieldHidden("ContractValue")) return null;
            return (
              <DetailCell label="Contract Value" value={fmtM(cv)} color={Colors.green}
                editable={canEditFinancialFields} editType="number" editValue={String(cv)}
                formatOptimistic={(v) => fmtM(Number(v) || 0)}
                lockedNote={lockNote("ContractValue")}
                onHistory={canEditFinancialFields ? () => setValueHistoryOpen(true) : undefined}
                onSave={(v) => saveField("ContractValue", v)} />
            );
          })()}
          {(() => {
            const av = Number(project.rawFields?.ApproxContractValue ?? 0) || 0;
            if ((!canEditFinancialFields && av <= 0) || layoutFieldHidden("ApproxContractValue")) return null;
            return (
              <DetailCell label="Approx Contract Value" value={fmtM(av)} color={Colors.green}
                editable={canEditFinancialFields} editType="number" editValue={String(av)}
                formatOptimistic={(v) => fmtM(Number(v) || 0)}
                lockedNote={lockNote("ApproxContractValue")}
                onHistory={canEditFinancialFields ? () => setValueHistoryOpen(true) : undefined}
                onSave={(v) => saveField("ApproxContractValue", v)} />
            );
          })()}
          {(() => {
            const cl = Number(project.rawFields?.ContractLimit ?? 0) || 0;
            if (cl <= 0 || layoutFieldHidden("ContractLimit")) return null;
            return (
              <DetailCell label="Contract Limit" value={fmtM(cl)} color={Colors.green}
                editable={canEditFinancialFields} editType="number" editValue={String(cl)}
                formatOptimistic={(v) => fmtM(Number(v) || 0)}
                lockedNote={lockNote("ContractLimit")}
                onSave={(v) => saveField("ContractLimit", v)} />
            );
          })()}
          {project.probability > 0 && !layoutFieldHidden("SuccessChance", "ChanceofSuccessChoice", "ChanceOfSuccessChoice") && <DetailCell label="Win Probability" value={`${project.probability}%`} color={ACCENT_PURPLE} />}
          {(() => {
            const pc = Number(project.rawFields?.PctComplete ?? 0) || 0;
            if (pc <= 0 || layoutFieldHidden("PctComplete")) return null;
            return <DetailCell label="% Complete" value={`${pc}%`} color={Colors.green} />;
          })()}
          {(() => {
            const sn = String(project.rawFields?.ShortName ?? "").trim();
            if (!sn || sn === "null" || layoutFieldHidden("ShortName")) return null;
            return <DetailCell label="Short Name" value={sn} />;
          })()}
          <ModuleSpecificDetails project={project} canEdit={canEdit} lockedNote={editLockNote} stageLockNote={lockNote} opmStageOptions={opmStageOptions} onSaveField={saveField} hiddenKeys={combinedHiddenSet}
            projectTypeOptions={Array.from(new Set([...PROJECT_TYPE_PRESETS, ...projectTypeOptions]))}
            serviceTypeOptions={Array.from(new Set([...SERVICE_TYPE_PRESETS, ...serviceTypeOptions]))}
            requestCategoryOptions={Array.from(new Set([...REQUEST_CATEGORY_PRESETS, ...requestCategoryOptions]))} />
          {/* ── Auto-displayed date fields from rawFields ── */}
          {(() => {
            const rf = project.rawFields || {};
            const fmtD = (v: unknown): string => {
              if (!v) return "";
              const s = String(v).trim();
              if (!s || s.startsWith("0001-") || s.startsWith("1900-") || s === "null" || s === "false") return "";
              const yr = parseInt(s.slice(0, 4), 10);
              if (yr < 2000) return "";
              return /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 10) : /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
            };
            const isLEM = project.module === "LEM";
            // "Awarded / Loss Date" is a single column whose meaning depends on
            // the opportunity's outcome. Relabel it: "Awarded Date" when the opp
            // was won/awarded, "Loss Date" when it was lost. Only keep the
            // combined label if the outcome can't be read from the status.
            const outcomeStr = `${project.status || ""} ${rf["CRMOpportunityStatusChoice"] ?? rf["Stage"] ?? rf["StageChoice"] ?? ""}`;
            const wonOutcome = /\b(won|awarded)\b/i.test(outcomeStr);
            const lostOutcome = /\b(lost|loss)\b/i.test(outcomeStr);
            const OPM_EXCLUDED_DATE_KEYS = new Set(["EstimatedConstructionStart", "EstimatedConstructionEnd", "BidDueDate", "InterviewDate", "ProposalPhaseDueDate"]);
            // Date-display rule (client request, Jul 2026 — matches the
            // chatbot's get_project_details logic and the mobile page):
            //   • Leads: Target dates ONLY — Schedule was retired for leads.
            //   • PMM/OPM WITH a phase schedule: BOTH pairs — Target dates
            //     (the record baseline from the Projects tab, inline-editable)
            //     AND Schedule dates derived from the schedule's first/last
            //     phase (read-only — edit path is the schedule card).
            //   • No schedule — or a tenant display mode without schedules —
            //     Target ONLY (Schedule dates have no meaning yet).
            const SCHED_ACTUAL_OVERRIDE: Record<string, string> = {
              ActualStartDate: schedDay(project.scheduleStart),
              ActualCompletionDate: schedDay(project.scheduleEnd),
            };
            const TARGET_DATE_KEYS = new Set(["TargetStartDate", "TargetCompletionDate"]);
            const ACTUAL_DATE_KEYS = new Set(["ActualStartDate", "ActualCompletionDate"]);
            const useSchedActual = (displayMode === "full" || displayMode === "schedule-no-grid") && !isLEM
              && !!(SCHED_ACTUAL_OVERRIDE.ActualStartDate || SCHED_ACTUAL_OVERRIDE.ActualCompletionDate);
            // Force-show the active keys so blanks still render as editable
            // "—" cells (Target is inline-editable; Schedule is
            // schedule-derived and read-only).
            // AwardedorLossDate is always shown for decided OPM records
            // (won or lost) so users can see and correct it even when the
            // date was never recorded (pre-stamp legacy rows).
            const decidedOpm = project.module === "OPM" && (wonOutcome || lostOutcome);
            const ALWAYS_SHOW_DATE_KEYS = useSchedActual
              ? new Set([...TARGET_DATE_KEYS, ...ACTUAL_DATE_KEYS, ...(decidedOpm ? ["AwardedorLossDate"] : [])])
              : new Set([...TARGET_DATE_KEYS, ...(decidedOpm ? ["AwardedorLossDate"] : [])]);
            return CONSTRUCTION_DATE_FIELDS.map(({ key, label }) => {
              if (layoutFieldHidden(key)) return null;
              // Leads share the opportunity exclusions (Bid Due etc. retired).
              if ((project.module === "OPM" || isLEM) && OPM_EXCLUDED_DATE_KEYS.has(key)) return null;
              if (ACTUAL_DATE_KEYS.has(key) && !useSchedActual) return null;
              const isActualKey = ACTUAL_DATE_KEYS.has(key);
              const schedVal = SCHED_ACTUAL_OVERRIDE[key] || "";
              // Actual cells are schedule-derived ONLY — even with a partial
              // schedule (one end blank) they never fall back to the raw
              // record fields and never become editable; the edit path is
              // the schedule card.
              const val = isActualKey ? schedVal : fmtD(rf[key]);
              const isEditable = canEdit && EDITABLE_CONSTRUCTION_DATE_KEYS.has(key) && !isActualKey;
              if (!val && !ALWAYS_SHOW_DATE_KEYS.has(key)) return null;
              const displayLabel = key === "AwardedorLossDate"
                ? (wonOutcome && !lostOutcome ? "Awarded Date"
                  : lostOutcome && !wonOutcome ? "Loss Date"
                  : label)
                : label;
              const displayValue = val || "—";
              if (isEditable) {
                return (
                  <DetailCell key={`date-${key}`} label={displayLabel} value={displayValue}
                    editable editType="date" editValue={val}
                    onSave={(v) => saveField(key, v)}
                    formatOptimistic={(raw) => raw ? fmtDate(raw) : "—"} />
                );
              }
              // Stage-blocked (would be editable otherwise): show lock + reason.
              const dateLock = editLockNote && EDITABLE_CONSTRUCTION_DATE_KEYS.has(key) && !isActualKey ? editLockNote : undefined;
              return <DetailCell key={`date-${key}`} label={displayLabel} value={displayValue} lockedNote={dateLock} />;
            });
          })()}
          {/* ── Auto-displayed text fields from rawFields ──
              Skip notes (shown in Notes & Description) and budget/finance fields
              (shown in Budget & Costs) to avoid duplication. */}
          {(() => {
            const rf = project.rawFields || {};
            return CONSTRUCTION_TEXT_FIELDS.map(({ key, label }) => {
              if (NOTES_FIELD_KEYS.has(key) || BUDGET_TEXT_FIELD_KEYS.has(key)) return null;
              if (layoutFieldHidden(key)) return null;
              const v = rf[key];
              const isEditable = canEdit && EDITABLE_CONSTRUCTION_KEYS.has(key);
              let s = v != null ? String(v).trim() : "";
              if (!s || s === "null" || s === "false" || s === "0") return null;
              // Skip raw FK IDs stored in *Lookup columns — numeric IDs and GUIDs
              // have no human-readable meaning in the UI (e.g. PriorityLookup = 3052,
              // MasterAgreementLookup = a GUID).
              if (key.endsWith("Lookup") && (/^\d+$/.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))) return null;
              // Skip values that are only punctuation / separators (e.g. "," from a blank
              // LastName, FirstName formatted field in the database).
              if (s.replace(/[,.\s;:/\\-]/g, "").length === 0) return null;
              if (s === "true" || s === "True") s = "Yes";
              const displayValue = (!s || s === "null" || s === "false" || s === "0") ? "—" : s;
              if (isEditable) {
                return (
                  <DetailCell key={`text-${key}`} label={label} value={displayValue}
                    editable editType="text" editValue={displayValue === "—" ? "" : displayValue}
                    disableBlank={displayValue !== "—"}
                    onSave={(val) => saveField(key, val)} />
                );
              }
              // Stage-blocked (would be editable otherwise): show lock + reason.
              const textLock = editLockNote && EDITABLE_CONSTRUCTION_KEYS.has(key) ? editLockNote : undefined;
              return <DetailCell key={`text-${key}`} label={label} value={displayValue} lockedNote={textLock} />;
            });
          })()}
          {(() => {
            // Extra fields the user has chosen via the Customize panel.
            // Pulls the raw RM ONE value verbatim — light formatting only
            // (ISO date trimming, currency on *Amount/*Value fields).
            const rf = project.rawFields || {};
            const builtinLabels = new Set([
              "Status", "Module", "Business Unit", "Company", "Location",
              "Sector", "Contract Value", "Approx Contract Value", "Labor Contract", "Win Probability",
            ]);
            const humanize = (k: string): string => {
              const stripped = k.replace(/(Choice|Lookup|User|Id|ID)$/g, "").replace(/^CRM/, "");
              return stripped.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim();
            };
            const formatValue = (k: string, v: unknown): string => {
              if (v == null) return "";
              const s = String(v).trim();
              if (!s || s === "false" || s === "null" || s.startsWith("0001-")) return "";
              // ISO date heuristic — render as human-readable "Jul 12, 2026"
              if (/^\d{4}-\d{2}-\d{2}T/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtDate(s);
              // Currency heuristic
              if (/(Amount|Value|Cost|Price)$/.test(k) && !isNaN(Number(s))) {
                const n = Number(s);
                if (n > 0) return fmtM(n);
              }
              return s;
            };
            return customFieldKeys.map((k) => {
              if (AUTO_SHOWN_KEYS.has(k) || SUPPRESSED_FIELD_KEYS.has(k)) return null;
              const label = humanize(k);
              if (builtinLabels.has(label)) return null;
              const value = formatValue(k, rf[k]);
              if (!value) return null;
              const rawStr = String(rf[k] ?? "").trim();
              const isDateField = /Date$/.test(k) || /^\d{4}-\d{2}-\d{2}T/.test(rawStr) || /^\d{4}-\d{2}-\d{2}$/.test(rawStr);
              const isNumField = !isDateField && /(Amount|Value|Cost|Price|Budget)$/.test(k);
              const inferredType: "date" | "number" | "text" = isDateField ? "date" : isNumField ? "number" : "text";
              const rawForEdit = isDateField ? rawStr.slice(0, 10) : (value === "—" ? "" : value);
              return (
                <DetailCell key={`custom-${k}`} label={label} value={value}
                  editable={canEdit} editType={inferredType}
                  lockedNote={lockNote(k)}
                  editValue={rawForEdit}
                  formatOptimistic={isDateField ? (v) => fmtDate(v) || "—" : isNumField ? (v) => fmtM(Number(v) || 0) : undefined}
                  onSave={(v) => saveField(k, v)} />
              );
            });
          })()}
        </div>

      </SectionCard>

      {/* ── Notes & Description ── */}
      {(() => {
        const rf = project.rawFields || {};
        const str = (v: unknown) => (v == null ? "" : String(v).trim());

        const pmmFields: Array<{ label: string; fieldName: string }> = [
          { label: "Description", fieldName: "Description" },
          { label: "Notes",       fieldName: str(rf.ProjectSummaryNote) ? "ProjectSummaryNote" : str(rf.Comment) ? "Comment" : "Note" },
        ];

        const opmNoteField = str(rf.Note) ? "Note" : str(rf.Comment) ? "Comment" : "Note";
        const opmFields: Array<{ label: string; fieldName: string }> = [
          { label: "Description", fieldName: "Description" },
          { label: "Notes",       fieldName: opmNoteField },
        ];

        // LEM (Leads): Lead table uses Comment as the canonical notes column (Note does not
        // exist on the Lead table). Only prefer Note over Comment if Comment is absent but Note
        // has data (rare legacy schema). Default to Comment so new leads without existing data
        // save to the correct column (avoids "No matching columns to update" on empty leads).
        const lemNoteField = str(rf.Comment) ? "Comment" : str(rf.Note) ? "Note" : "Comment";
        const lemFields: Array<{ label: string; fieldName: string }> = [
          { label: "Description", fieldName: "Description" },
          { label: "Notes",       fieldName: lemNoteField },
        ];

        const fields = project.module === "OPM" ? opmFields : project.module === "LEM" ? lemFields : pmmFields;
        const hasAny = fields.some(f => str(rf[f.fieldName]));

        if (!hasAny && !canEdit) return null;

        return (
          <SectionCard
            icon={FileText}
            iconColor={ACCENT_BLUE}
            title="Notes & Description"
            expanded={isExpanded("notes-section")}
            onToggle={() => toggleSection("notes-section")}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 0 8px" }}>
              {fields.map(({ label, fieldName }) => (
                <NoteField
                  key={fieldName}
                  label={label}
                  fieldName={fieldName}
                  value={str(rf[fieldName])}
                  canEdit={canEdit}
                  lockedNote={editLockNote}
                  onSave={async (field, val) => {
                    await saveField(field, val);
                  }}
                />
              ))}
            </div>
          </SectionCard>
        );
      })()}

      {/* ── Key Personnel ── */}
      {(() => {
        // Primary source: computed at load time from PMM *User fields + team fallback.
        // Render-time fallback: read person fields directly from rawFields so the card
        // appears even when the load-time computation ran before those fields were
        // populated (e.g. after a fresh import that updated the DB record).
        const rf = project.rawFields || {};
        const g2n = project.guidToName || {};
        const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s);
        // Resolve every person in a *User column (comma/semicolon-separated
        // list — the Add Lead flow appends). Unresolvable GUIDs are skipped.
        const resolvePersonNames = (v: unknown): string[] => {
          const raw = String(v ?? "").trim().replace(/^,+|,+$/g, "").trim();
          if (!raw || raw === "null" || raw.startsWith("0001-")) return [];
          const names: string[] = [];
          const seen = new Set<string>();
          for (const token of raw.split(/[,;]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean)) {
            const name = isUuid(token) ? (g2n[token.toLowerCase()] || g2n[token] || "") : token;
            if (!name || seen.has(name.toLowerCase())) continue;
            seen.add(name.toLowerCase());
            names.push(name);
          }
          return names;
        };
        const renderKP: KeyPersonnelEntry[] =
          project.keyPersonnel.length > 0
            ? project.keyPersonnel
            : [
                ...[...KP_FIELD_ROLES, { field: "OwnerName", role: "Owner" }]
                  .flatMap(({ field, role }): KeyPersonnelEntry[] =>
                    resolvePersonNames(rf[field]).map((name) =>
                      // OwnerName doubles as the Key Client Contact storage column
                      // on Opportunity — don't stamp `field`, so the row renders
                      // WITHOUT a remove button (removing "Owner" here must never
                      // silently clear the record's client contact).
                      field === "OwnerName"
                        ? { name, role, guid: name }
                        : { name, role, guid: name, field },
                    ),
                  ),
                // Custom (user-typed) roles from the record's JSON column.
                ...listCustomLeads(rf[CUSTOM_LEADS_FIELD]).map(({ role, name }): KeyPersonnelEntry =>
                  ({ name, role, guid: name, field: `${CUSTOM_ROLE_PREFIX}${role}` })),
              ];
        // Editors always see the card (they need the Add Lead flow even when
        // the record has no leads yet); read-only users only when populated.
        if (renderKP.length === 0 && !canEdit) return null;
        // Every role is always offered — a role can hold several people (the
        // column stores a comma-separated list), so "occupied" roles must not
        // disappear from the dropdown. Duplicate person+role adds are rejected
        // in kpSave instead.
        const availableRoles = KP_FIELD_ROLES;
        return (
          <SectionCard icon={Award} iconColor={ACCENT_AMBER} title="Project Leads"
            badge={String(renderKP.length)}
            order={-2}

            expanded={isExpanded("keyPersonnel")} onToggle={(e) => toggleSection("keyPersonnel", e)}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {renderKP.map((kp, idx) => {
                const initials = kp.name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
                const color = ALLOC_COLORS[idx % ALLOC_COLORS.length];
                return (
                  <div key={`${kp.role}-${kp.guid}-${idx}`} style={{
                    display: "flex", alignItems: "center", gap: 12, padding: 10,
                    backgroundColor: "var(--rm-panel-soft)", borderRadius: 10,
                    border: `1px solid ${Colors.border}`,
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 18, backgroundColor: color + "33",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      border: `1px solid ${color}`, flexShrink: 0,
                    }}>
                      <span style={{ color, fontWeight: 700, fontSize: 12 }}>{initials || "?"}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kp.name}</div>
                      <div style={{ color: Colors.textSecondary, fontSize: 12, marginTop: 2 }}>{kp.role}</div>
                    </div>
                    {editLockNote && kp.field ? (
                      <span title={editLockNote} aria-label={editLockNote}
                        style={{ display: "inline-flex", alignItems: "center", cursor: "help", padding: 2, flexShrink: 0 }}>
                        <LockIcon size={12} color={Colors.textMuted} />
                      </span>
                    ) : canEdit && kp.field ? (
                      kpConfirmField === `${kp.field}|${kp.guid}` ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                          <button disabled={kpSaving} onClick={() => void kpRemove(kp)} style={{
                            padding: "5px 10px", borderRadius: 8, border: "none", backgroundColor: "#EF4444",
                            color: "#FFF", fontSize: 11, fontWeight: 600, cursor: "pointer",
                          }}>
                            {kpSaving ? "Removing…" : "Remove"}
                          </button>
                          <button disabled={kpSaving} onClick={() => setKpConfirmField("")} style={{
                            padding: "5px 10px", borderRadius: 8, border: `1px solid ${Colors.border}`,
                            backgroundColor: "transparent", color: Colors.textSecondary, fontSize: 11, fontWeight: 600, cursor: "pointer",
                          }}>
                            Keep
                          </button>
                        </div>
                      ) : (
                        <button title={`Remove ${kp.role}`} onClick={() => { setKpErr(""); setKpConfirmField(`${kp.field}|${kp.guid}`); }} style={{
                          display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26,
                          borderRadius: 8, border: `1px solid ${Colors.border}`, backgroundColor: "transparent",
                          color: Colors.textMuted, cursor: "pointer", flexShrink: 0,
                        }}>
                          <X size={13} />
                        </button>
                      )
                    ) : null}
                  </div>
                );
              })}
              {renderKP.length === 0 && (
                <div style={{ fontSize: 12, color: Colors.textMuted, textAlign: "center", padding: "8px 0" }}>
                  No leads assigned yet — add the first one below.
                </div>
              )}
              {kpErr && !kpAdding && <div style={{ color: "#F87171", fontSize: 12 }}>{kpErr}</div>}
              {(canEdit || editLockNote) && !kpAdding && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button disabled={!!editLockNote} title={editLockNote ?? undefined}
                    onClick={() => { if (!editLockNote) { setKpErr(""); setKpAdding(true); } }} style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    padding: "8px 14px", backgroundColor: Colors.green, color: "#FFF", border: "none",
                    borderRadius: 10, fontSize: 12, fontWeight: 600,
                    cursor: editLockNote ? "not-allowed" : "pointer", opacity: editLockNote ? 0.45 : 1,
                  }}>
                    <UserPlus size={12} /> Add Lead
                  </button>
                </div>
              )}
              {canEdit && (
                <AddLeadModal
                  open={kpAdding}
                  onClose={kpResetForm}
                  roles={availableRoles}
                  people={kpPeople}
                  saving={kpSaving}
                  error={kpErr}
                  onSave={(field, name) => void kpSave(field, name)}
                />
              )}
            </div>
          </SectionCard>
        );
      })()}

      {/* ── Additional Information (onboarding extra columns) ── */}
      {(() => {
        const raw = (project.rawFields?.ExtraFields ?? []) as Array<{ label?: unknown; value?: unknown }>;
        const items = Array.isArray(raw)
          ? raw
              .map((e) => ({ label: String(e?.label ?? "").trim(), value: String(e?.value ?? "").trim() }))
              .filter((e) => e.label && e.value)
          : [];
        if (items.length === 0) return null;
        return (
          <SectionCard icon={Layers} iconColor={ACCENT_AMBER} title="Additional Information"
            expanded={isExpanded("additional")} onToggle={(e) => toggleSection("additional", e)}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {items.map((e, i) => (
                <DetailCell key={`extra-${i}-${e.label}`} label={e.label} value={e.value} />
              ))}
            </div>
          </SectionCard>
        );
      })()}

      {/* ── Project Health ── */}
      {project.healthScore >= 0 && (
        <SectionCard
          icon={Activity} iconColor={hc}
          title={project.module === "OPM" ? "Opportunity Health" : project.module === "LEM" ? "Lead Health" : "Project Health"}
          badge={<div style={{ padding: "4px 10px", borderRadius: 12, backgroundColor: hc + "20" }}>
            <span style={{ color: hc, fontSize: 11, fontWeight: 700 }}>{healthLabel(project.healthScore)}</span>
          </div>}
          expanded={isExpanded("overview")} onToggle={(e) => toggleSection("overview", e)}
        >
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <HealthGauge score={project.healthScore} issues={project.healthIssues} size={140} />
          </div>
          <div>
            {project.healthIssues.length > 0 ? project.healthIssues.map((issue, i) => {
              const issueColors = ["#E03C3C", "#F87171", Colors.orange, "#F59E0B", "#FBBF24"];
              const c = issueColors[i % issueColors.length];
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", padding: "8px 0", gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13, color: Colors.white, lineHeight: 1.4 }}>{issue.text}</span>
                  {issue.deduction > 0 && (
                    <div style={{ padding: "2px 7px", borderRadius: 6, backgroundColor: c + "22" }}>
                      <span style={{ color: c, fontWeight: 700, fontSize: 11, letterSpacing: 0.3 }}>−{issue.deduction}</span>
                    </div>
                  )}
                </div>
              );
            }) : (
              <div style={{ display: "flex", alignItems: "center", padding: "8px 0", gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.green }} />
                <span style={{ fontSize: 13, color: Colors.green }}>All checks passed</span>
              </div>
            )}
          </div>

          <button onClick={() => setShowHealthMath((v) => !v)} style={{
            marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 10px", borderRadius: 8,
            backgroundColor: "rgba(255,255,255,0.04)", border: `1px solid ${Colors.border}`,
            color: Colors.textSecondary, fontSize: 11, fontWeight: 600, cursor: "pointer",
          }}>
            <Info size={11} color={Colors.textMuted} />
            {showHealthMath ? "Hide" : "Show"} health math
          </button>

          {showHealthMath && (
            <div style={{
              marginTop: 8, padding: 12, borderRadius: 10,
              backgroundColor: "var(--rm-panel-soft)", border: `1px solid ${Colors.border}`,
            }}>
              {project.healthChecks.map((c, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", padding: "6px 0",
                  borderBottom: i < project.healthChecks.length - 1 ? `1px solid ${Colors.border}` : "none",
                }}>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: c.passed ? Colors.green : "#F87171" }}>
                    {c.passed ? "✓" : "✗"} {c.label}
                  </span>
                  <span style={{ fontSize: 11, color: Colors.textPrimary, fontWeight: 700 }}>
                    {c.passed ? `+${c.weight}` : `0 / ${c.weight}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Project Schedule (PMM only) ──
          Opportunities (OPM) have no schedule: lifecycle/phase assignment is a
          OPM now supports phase schedules (same as PMM), so surface the section
          for both. The bid due date row is already gated on project.bidDate below. */}
      {(project.module === "PMM" || project.module === "OPM") && (() => { const cm = getDisplayModeFor(project.module); return cm !== "no-schedule" && cm !== "no-schedule-no-hours" && cm !== "no-schedule-no-grid"; })() && (
        <SectionCard id="schedule-section" icon={Calendar} iconColor={Colors.orange} title={project.module === "OPM" ? "Opportunity Schedule" : "Project Schedule"}
          subtitle={schedLcTitle}
          order={-3}
          expanded={isExpanded("timeline")} onToggle={(e) => toggleSection("timeline", e)}>
          {project.bidDate && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: 10, marginBottom: 12,
              backgroundColor: "rgba(56,189,248,0.08)", borderRadius: 10, border: "1px solid rgba(56,189,248,0.2)",
            }}>
              <Flag size={12} color={ACCENT_BLUE} />
              <span style={{ fontSize: 11, color: Colors.textMuted, fontWeight: 600 }}>BID DUE</span>
              <span style={{ fontSize: 12, color: Colors.white, fontWeight: 600 }}>{fmtDate(project.bidDate)}</span>
            </div>
          )}
          <GanttTimeline project={project} />
          <div style={{ marginTop: 14 }}>
            <SchedulePhases ticketId={id} module={project.module} project={project} onRefresh={refreshAfterMutation} onActiveLcTitle={setSchedLcTitle}
              onDatesSaved={(startIso, endIso) => {
                // "0001-01-01…" is the cleared-date sentinel → blank display.
                const clean = (v: string) => (v && !v.startsWith("0001") ? v : "");
                setProject(prev => ({
                  ...prev,
                  targetStart: clean(startIso), targetEnd: clean(endIso),
                  rawFields: { ...prev.rawFields, TargetStartDate: startIso, TargetCompletionDate: endIso },
                }));
              }}
              canEdit={canEdit} isAdmin={user?.isAdmin === true} parentLcAssigned={!!(project.rawFields?.ProjectLifeCycleLookup && String(project.rawFields.ProjectLifeCycleLookup).trim() !== "" && String(project.rawFields.ProjectLifeCycleLookup) !== "0" && String(project.rawFields.ProjectLifeCycleLookup) !== "false")} />
          </div>
        </SectionCard>
      )}

      {/* ── Business Units ── */}
      {(project.module === "PMM" || project.module === "OPM") && (
        <SectionCard icon={GridIcon} iconColor={Colors.orange} title="Business Units"
          expanded={isExpanded("businessUnits")} onToggle={(e) => toggleSection("businessUnits", e)}>
          {(() => {
            // Same date rule as the details card: schedule present → Actual
            // (schedule-derived, read-only); no schedule → Target from record.
            const buSchedActual = (displayMode === "full" || displayMode === "schedule-no-grid")
              && !!(schedDay(project.scheduleStart) || schedDay(project.scheduleEnd));
            const svc = (v: unknown): string => {
              if (v == null) return "";
              const s = String(v).trim();
              return !s || s === "null" || s === "false" || s.startsWith("0001") ? "" : s;
            };
            const buPm = ["Project Manager", "Senior Project Manager", "Project Lead"]
              .map((r) => project.keyPersonnel.find((k) => k.role === r)?.name)
              .find(Boolean) || "";
            return (
              <BusinessUnitsSection ticketId={id} canEdit={canEdit} allocations={project.allocations} buFallback={project.bu}
                contactName={svc(project.rawFields?.ContactName) || svc(project.rawFields?.ContactLookup) || svc(project.rawFields?.CRMContactLookup) || svc(project.rawFields?.Contact) || svc(project.rawFields?.OwnerName)}
                pmFallback={buPm}
                contractValueFallback={
                  // #124: this Primary-row value WRITES ApproxContractValue, so
                  // with both live columns present it must also DISPLAY the
                  // Approx column, not the Approx||Contract headline coalesce.
                  ownContractValues(project.rawFields, project.value).approx
                }
                forecastFallback={Number(project.rawFields?.ForecastedProjectCost) || 0}
                dateMode={buSchedActual ? "actual" : "target"}
                startDate={buSchedActual ? schedDay(project.scheduleStart) : svc(project.targetStart)}
                endDate={buSchedActual ? schedDay(project.scheduleEnd) : svc(project.targetEnd)}
                cvLockNote={(() => {
                  // #124: the Primary row's value writes "ApproxContractValue".
                  // When the record's live table carries only ONE of the two
                  // contract-value columns (e.g. Opportunity has no
                  // ContractValue), both FieldNames land on the SAME stored
                  // column — so a lock on either name must grey the cell.
                  // rawFields keys mirror the live columns (the read path
                  // selects the live table), so key absence = column absence.
                  const rfKeys = new Set(Object.keys(project.rawFields ?? {}).map((k) => k.trim().toLowerCase()));
                  const distinctCols = rfKeys.has("approxcontractvalue") && rfKeys.has("contractvalue");
                  return (distinctCols
                    ? lockNote("ApproxContractValue")
                    : lockNote("ApproxContractValue", "ContractValue")) || "";
                })()} />
            );
          })()}
        </SectionCard>
      )}

      {/* ── Budget & Costs ── */}
      {(project.module === "PMM" || project.module === "OPM") && (
        <SectionCard icon={DollarSign} iconColor={ACCENT_AMBER} title="Budget & Costs"
          expanded={isExpanded("budget")} onToggle={(e) => toggleSection("budget", e)}>
          {/* Customize bar — same panel as Project Details: untick default
              budget fields to hide them, tick optional raw fields to pin
              extra cells onto this card. */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <button onClick={() => setShowCustomizeBudget((v) => !v)} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 10px", borderRadius: 8,
              backgroundColor: "rgba(255,255,255,0.04)",
              border: `1px solid ${Colors.border}`,
              color: Colors.textSecondary, fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}>
              <Edit2 size={11} color={Colors.textMuted} />
              {showCustomizeBudget ? "Done" : "Customize fields"}
              {(() => {
                const n = budgetCustomFieldKeys.length + hiddenFieldKeys.filter((k) => BUDGET_AUTO_KEYS.has(k)).length;
                return n > 0 ? (
                  <span style={{
                    marginLeft: 4, padding: "1px 6px", borderRadius: 8,
                    backgroundColor: ACCENT_PURPLE + "33", color: ACCENT_PURPLE, fontSize: 10, fontWeight: 700,
                  }}>{n}</span>
                ) : null;
              })()}
            </button>
          </div>
          {showCustomizeBudget && (() => {
            const rf = (project.rawFields || {}) as Record<string, unknown>;
            const usable = (k: string) => {
              if (k.startsWith("_")) return false;
              const v = rf[k];
              if (v == null || typeof v === "object") return false;
              const s = String(v).trim();
              if (!s.length || s === "false" || s === "null" || s.startsWith("0001-")) return false;
              if (k.endsWith("Lookup") && (
                /^\d+$/.test(s) ||
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
              )) return false;
              return true;
            };
            // Default budget fields: manual money cells are always listed
            // (they render even when blank for editors); the rest only when
            // the record actually carries a value.
            const manualKeys = ["LaborContractAmount", "ForecastedProjectCost", "NonOperatingCost",
              ...(project.module === "OPM" ? ["ApproxContractValue"] : [])];
            const alwaysKeys = Array.from(new Set([
              ...manualKeys,
              ...Object.keys(rf).filter((k) => BUDGET_AUTO_KEYS.has(k) && usable(k)),
            ])).sort((a, b) => a.localeCompare(b));
             const optionalKeys = Object.keys(rf)
               .filter((k) => !BUDGET_SUPPRESSED_FIELD_KEYS.has(k) && !AUTO_SHOWN_KEYS.has(k) && usable(k))
               .sort((a, b) => a.localeCompare(b));
            const budgetHiddenCount = hiddenFieldKeys.filter((k) => BUDGET_AUTO_KEYS.has(k)).length;
            return (
              <FieldCustomizePanel
                rf={rf}
                alwaysKeys={alwaysKeys}
                optionalKeys={optionalKeys}
                pinnedKeys={budgetCustomFieldKeys}
                hiddenKeys={hiddenFieldKeys}
                onTogglePin={(k) => setBudgetCustomFieldKeys((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k])}
                onToggleHide={toggleHiddenKey}
                search={budgetFieldSearch}
                onSearch={setBudgetFieldSearch}
                showReset={budgetFieldsCustomized || budgetCustomFieldKeys.length > 0 || budgetHiddenCount > 0}
                onReset={() => {
                  resetBudgetFieldKeys();
                  setHiddenFieldKeys((prev) => prev.filter((k) => !BUDGET_AUTO_KEYS.has(k)));
                }}
                extraAction={companyDefaultButton}
              />
            );
          })()}
          {project.module === "PMM" && (
            <BudgetSection ticketId={id} projectName={project.name} contractValue={ownContractValues(project.rawFields, project.value).contract}
              laborValue={project.laborValue} forecastedCost={Number(project.rawFields?.ForecastedProjectCost) || 0}
              allocations={project.allocations}
              allocationsLoading={teamPending && project.allocations.length === 0} />
          )}
          {/* ── Key manual-entry financials (Approx Contract Value [OPM],
              Labor Contract, Forecasted Project Cost, Non-Operating Cost) —
              always shown for editors even when blank. Rendered together in
              ONE flex-wrap container so they pair up two per row (each
              DetailCell is flex-basis 50%), instead of each stretching
              full-width in its own separate row container. ── */}
          {(() => {
            const cells: ReactElement[] = [];
            // Same #124 follow-up as the Project Details card: when the live
            // table carries BOTH contract-value columns, each cell shows its
            // OWN column instead of the Approx-first headline coalesce.
            const { contract: cvOwn, approx: avOwn } = ownContractValues(project.rawFields, project.value);
            if (project.module === "PMM" && (canEdit || canEditFinancialFields || cvOwn > 0) && !layoutFieldHidden("ContractValue")) {
              cells.push(
                <DetailCell key="contractValue" label="Contract Value" value={cvOwn > 0 ? fmtM(cvOwn) : "—"} color={Colors.green}
                  editable={canEditFinancialFields} editType="number" editValue={String(cvOwn)}
                  formatOptimistic={(v) => fmtM(Number(v) || 0)}
                  lockedNote={lockNote("ContractValue")}
                  onHistory={canEditFinancialFields ? () => setValueHistoryOpen(true) : undefined}
                  onSave={(v) => saveField("ContractValue", v)} />,
              );
            }
            if (project.module === "OPM" && (canEdit || canEditFinancialFields || avOwn > 0) && !layoutFieldHidden("ApproxContractValue")) {
              cells.push(
                <DetailCell key="approxCV" label="Approx Contract Value" value={avOwn > 0 ? fmtM(avOwn) : "—"} color={Colors.green}
                  editable={canEditFinancialFields} editType="number" editValue={String(avOwn)}
                  formatOptimistic={(v) => fmtM(Number(v) || 0)}
                  lockedNote={lockNote("ApproxContractValue")}
                  onHistory={canEditFinancialFields ? () => setValueHistoryOpen(true) : undefined}
                  onSave={(v) => saveField("ApproxContractValue", v)} />,
              );
            }
            if ((canEdit || canEditFinancialFields || project.laborValue > 0) && !layoutFieldHidden("LaborContractAmount")) {
              cells.push(
                <DetailCell key="laborContract" label="Labor Contract" value={project.laborValue > 0 ? fmtM(project.laborValue) : "—"} color={Colors.green}
                  editable={canEditFinancialFields} editType="number" editValue={String(project.laborValue)}
                  formatOptimistic={(v) => fmtM(Number(v) || 0)}
                  lockedNote={lockNote("LaborContractAmount")}
                  onHistory={canEditFinancialFields ? () => setValueHistoryOpen(true) : undefined}
                  onSave={(v) => saveField("LaborContractAmount", v)} />,
              );
            }
            const fpc = Number(project.rawFields?.ForecastedProjectCost) || 0;
            if ((canEdit || canEditFinancialFields || fpc > 0) && !layoutFieldHidden("ForecastedProjectCost")) {
              cells.push(
                <DetailCell key="forecastedCost" label="Forecasted Project Cost" value={fpc > 0 ? fmtM(fpc) : "—"} color={Colors.green}
                  editable={canEditFinancialFields} editType="number" editValue={String(fpc)}
                  formatOptimistic={(v) => fmtM(Number(v) || 0)}
                  lockedNote={lockNote("ForecastedProjectCost")}
                  onHistory={canEditFinancialFields ? () => setValueHistoryOpen(true) : undefined}
                  onSave={(v) => saveField("ForecastedProjectCost", v)} />,
              );
            }
            const noc = Number(project.rawFields?.NonOperatingCost) || 0;
            if ((canEdit || canEditFinancialFields || noc > 0) && !layoutFieldHidden("NonOperatingCost")) {
              cells.push(
                <DetailCell key="nonOpCost" label="Non-Operating Cost" value={noc > 0 ? fmtM(noc) : "—"} color={Colors.green}
                  editable={canEditFinancialFields} editType="number" editValue={String(noc)}
                  formatOptimistic={(v) => fmtM(Number(v) || 0)}
                  lockedNote={lockNote("NonOperatingCost")}
                  onHistory={canEditFinancialFields ? () => setValueHistoryOpen(true) : undefined}
                  onSave={(v) => saveField("NonOperatingCost", v)} />,
              );
            }
            if (cells.length === 0) return null;
            return <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>{cells}</div>;
          })()}
          {/* ── Construction financial fields (money / pct / sqft / text) ── */}
          {(() => {
            const rf = project.rawFields || {};
            const cells = CONSTRUCTION_FINANCIAL_FIELDS.map((f) => {
              if (layoutFieldHidden(f.key)) return null;
              const raw = rf[f.key];
              // Financial keys (server's financial-fields list) answer to the
              // financial capability; the rest to plain edit access.
              const isEditable = (isFinancialFieldName(f.key) ? canEditFinancialFields : canEdit)
                && EDITABLE_CONSTRUCTION_KEYS.has(f.key);
              if (f.kind === "text") {
                const s = String(raw ?? "").trim();
                if (!s || s === "null" || s === "false" || s === "0") return null;
                if (isEditable) {
                  return (
                    <DetailCell key={f.key} label={f.label} value={s}
                      editable editType="text" editValue={s}
                      lockedNote={lockNote(f.key)}
                      onSave={(v) => saveField(f.key, v)} />
                  );
                }
                return <DetailCell key={f.key} label={f.label} value={s}
                  lockedNote={editLockNote && EDITABLE_CONSTRUCTION_KEYS.has(f.key) ? editLockNote : undefined} />;
              }
              const n = Number(raw) || 0;
              if (raw == null || n <= 0) return null;
              const pctDisplay = `${n <= 1 ? Math.round(n * 1000) / 10 : n}%`;
              const editPctVal = String(n <= 1 ? Math.round(n * 1000) / 10 : n);
              const value = f.kind === "money"
                ? fmtM(n)
                : f.kind === "pct"
                  ? pctDisplay
                  : `${n.toLocaleString("en-US")} sq ft`;
              if (isEditable && f.kind === "money") {
                 return (
                   <DetailCell key={f.key} label={f.label} value={value}
                     fixedHalfWidth={f.key === "ContractedAmount"}
                    color={Colors.green}
                    editable editType="number" editValue={String(n)}
                    formatOptimistic={(v) => fmtM(Number(v) || 0)}
                    disableBlank
                    lockedNote={lockNote(f.key)}
                    onSave={(v) => saveField(f.key, v)} />
                );
              }
              if (isEditable && f.kind === "pct") {
                return (
                  <DetailCell key={f.key} label={f.label} value={value}
                    editable editType="number" editValue={editPctVal}
                    formatOptimistic={(v) => `${Number(v) || 0}%`}
                    disableBlank
                    lockedNote={lockNote(f.key)}
                    onSave={(v) => saveField(f.key, v)} />
                );
              }
               return <DetailCell key={f.key} label={f.label} value={value}
                 fixedHalfWidth={f.key === "ContractedAmount"}
                 color={f.kind === "money" ? Colors.green : undefined}
                lockedNote={editLockNote && EDITABLE_CONSTRUCTION_KEYS.has(f.key) ? editLockNote : undefined} />;
            }).filter(Boolean);
            if (cells.length === 0) return null;
            return <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>{cells}</div>;
          })()}
          {/* ── Contract / insurance / bond text fields ── */}
          {(() => {
            const rf = project.rawFields || {};
            const cells = CONSTRUCTION_TEXT_FIELDS
              .filter(f => BUDGET_TEXT_FIELD_KEYS.has(f.key))
              .map(({ key, label }) => {
                if (layoutFieldHidden(key)) return null;
                const v = rf[key];
                const isEditable = (isFinancialFieldName(key) ? canEditFinancialFields : canEdit)
                  && EDITABLE_CONSTRUCTION_KEYS.has(key);
                let s = v != null ? String(v).trim() : "";
                if (!s || s === "null" || s === "false" || s === "0") return null;
                if (s === "true" || s === "True") s = "Yes";
                // Retainage can be stored as a raw dollar amount — format it as money
                // when it looks like a plain number (no % already present).
                let displayValue = s;
                if (key === "Retainage" && /^\d+(\.\d+)?$/.test(s)) {
                  const n = Number(s);
                  displayValue = n > 100 ? fmtM(n) : `${n}%`;
                }
                if (isEditable) {
                  return (
                    <DetailCell key={`budgettxt-${key}`} label={label} value={displayValue}
                      editable editType="text" editValue={s}
                      disableBlank
                      lockedNote={lockNote(key)}
                      onSave={(val) => saveField(key, val)} />
                  );
                }
                return <DetailCell key={`budgettxt-${key}`} label={label} value={displayValue}
                  lockedNote={editLockNote && EDITABLE_CONSTRUCTION_KEYS.has(key) ? editLockNote : undefined} />;
              }).filter(Boolean);
            if (cells.length === 0) return null;
            return <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>{cells}</div>;
          })()}
          {/* ── User-pinned custom budget fields (Customize panel picks) ── */}
          {budgetCustomFieldKeys.length > 0 && (() => {
            const rf = (project.rawFields || {}) as Record<string, unknown>;
            const cells = budgetCustomFieldKeys.map((k) => {
               if (BUDGET_AUTO_KEYS.has(k) || BUDGET_SUPPRESSED_FIELD_KEYS.has(k)) return null;
              const value = formatRawFieldValue(k, rf[k]);
              if (!value) return null;
              const rawStr = String(rf[k] ?? "").trim();
              const isDateField = /Date$/.test(k) || /^\d{4}-\d{2}-\d{2}T/.test(rawStr) || /^\d{4}-\d{2}-\d{2}$/.test(rawStr);
              const isNumField = !isDateField && /(Amount|Value|Cost|Price|Budget)$/.test(k);
              const inferredType: "date" | "number" | "text" = isDateField ? "date" : isNumField ? "number" : "text";
              const rawForEdit = isDateField ? rawStr.slice(0, 10) : rawStr;
              return (
                <DetailCell key={`budgetcustom-${k}`} label={humanizeFieldKey(k)} value={value}
                  color={isNumField ? Colors.green : undefined}
                  editable={isFinancialFieldName(k) ? canEditFinancialFields : canEdit} editType={inferredType} editValue={rawForEdit}
                  lockedNote={lockNote(k)}
                  formatOptimistic={isDateField ? ((v) => v ? fmtDate(v) : "—") : isNumField ? ((v) => fmtM(Number(v) || 0)) : undefined}
                  onSave={(v) => saveField(k, v)} />
              );
            }).filter(Boolean);
            if (cells.length === 0) return null;
            return <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>{cells}</div>;
          })()}
        </SectionCard>
      )}

      {/* ── Audit Trail ──
          Collapsed: auto-placed like every other card so it fills whichever
          column has room (pinning it to column 1 used to leave an empty cell
          beside Budget & Costs). When opened, it spans both columns so the
          audit table has room to breathe. */}
      <div style={{ gridColumn: auditOpen ? "1 / -1" : undefined, minWidth: 0 }}>
        <AuditTrailCard
          key={project.id}
          entityType={project.module === "PMM" ? "project" : project.module === "OPM" ? "opportunity" : "lead"}
          entityId={project.id}
          compact
          onOpenChange={setAuditOpen}
        />
      </div>

      {/* ── Project Team ── */}
      {project.module !== "LEM" && (
        <SectionCard id="team-section" icon={Users} iconColor={Colors.green} title="Project Team"
          badge={<CountBadge n={project.allocations.length + openRoles.length} />}
          order={-1}
          expanded={isExpanded("team")} onToggle={(e) => toggleSection("team", e)}>
          {(loading || teamPending) && project.allocations.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "24px 12px", color: Colors.textMuted, fontSize: 13 }}>
              <span style={{ display: "inline-block", width: 14, height: 14, border: `2px solid ${Colors.green}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              Loading team…
            </div>
          ) : teamLoadFailed && project.allocations.length === 0 ? (
            // Every fetch attempt timed out — team state is UNKNOWN. Never
            // claim "No Team Assigned" here; offer an in-place retry so the
            // user doesn't have to reload the whole page.
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "24px 12px", textAlign: "center" }}>
              <AlertTriangle size={20} color="#F59E0B" />
              <div style={{ fontSize: 13, color: Colors.textPrimary, fontWeight: 600 }}>Team data is taking longer than usual</div>
              <div style={{ fontSize: 12, color: Colors.textMuted, maxWidth: 340 }}>
                The server didn't answer in time — this can happen right after a new import while things warm up. Your team data is safe.
              </div>
              <button
                onClick={() => {
                  teamRetryCount.current = 0;
                  setTeamLoadFailed(false);
                  setTeamPending(true);
                  bustCache("project-allocations-full:" + id);
                  bustCache("project:allocations:" + id);
                  void getProjectTeam(id!, true).catch(() => { /* retry cycle reports */ });
                  void loadProject(true, true, true);
                }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px",
                  borderRadius: 8, border: `1px solid ${Colors.green}`, background: "rgba(107,165,57,0.08)",
                  color: Colors.green, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                }}>
                Retry loading team
              </button>
            </div>
          ) : project.allocations.length === 0 ? (
            // No team yet — but the project may still carry OPEN positions
            // (imported demand rows: role + hours, no person). Always render
            // them here or the Demand page's "View project" link lands on a
            // card that claims there is nothing to staff.
            <>
              <EmptyState icon={UserX} title="No Team Assigned"
                desc={openRoles.length > 0
                  ? `${openRoles.length} open ${openRoles.length === 1 ? "position needs" : "positions need"} to be filled`
                  : canManageStaff ? "Tap below to add the first team member" : "No team members have been assigned"}
                actionLabel={canManageStaff ? "Add Member" : undefined}
                onAction={canManageStaff ? () => setShowAddMember(true) : undefined} />
              <OpenRolesBlock roles={openRoles} highlight={highlightOpenRoles}
                canEdit={canManageStaff} lockedNote={staffingLockNote} hidePct={displayMode === "no-schedule-no-hours"}
                onAssign={setAssignSlot} />
            </>
          ) : (
            <>
              <div style={{
                display: "flex", alignItems: "center", gap: 6, padding: "8px 12px",
                backgroundColor: "rgba(107,165,57,0.08)", borderRadius: 10, marginBottom: 10,
              }}>
                <Users size={13} color={Colors.green} />
                <span style={{ fontSize: 11, color: Colors.green, fontWeight: 600 }}>
                  {project.allocations.length} resources currently allocated to this project.
                </span>
              </div>

              {/* Visual team summary: avatar strip + allocation distribution
                  bar so the section reads as a dashboard tile, not just a
                  list. Pure presentational — no extra fetches. */}
              {(() => {
                // In "Without schedule and hours" mode every %-allocation figure
                // (avg, over-100 count, distribution bands, tooltips) is hidden —
                // only the avatar strip + open-roles count remain.
                const hidePct = displayMode === "no-schedule-no-hours";
                const palette = ["#6BA539", "#E87722", "#3B82F6", "#8E5BD9", "#16A6B0", "#A9C23F", "#F59E0B", "#E03C3C"];
                const initialsOf = (n: string) => (n || "?")
                  .split(/\s+/).filter(Boolean).slice(0, 2)
                  .map(s => s[0]?.toUpperCase() ?? "").join("") || "?";
                const totalPct = project.allocations.reduce((s, a) => s + (Number(a.pct) || 0), 0);
                const avgPct = project.allocations.length
                  ? Math.round(totalPct / project.allocations.length)
                  : 0;
                const overAllocated = project.allocations.filter(a => Number(a.pct) > 100).length;
                const visible = project.allocations.slice(0, 6);
                const hidden = Math.max(0, project.allocations.length - visible.length);
                // Group allocations into bands so the distribution bar is
                // meaningful at a glance.
                const bands = [
                  { label: "≤25%", color: "#16A6B0", count: 0 },
                  { label: "26–75%", color: "#6BA539", count: 0 },
                  { label: "76–100%", color: "#E87722", count: 0 },
                  { label: ">100%", color: "#C2410C", count: 0 },
                ];
                for (const a of project.allocations) {
                  const p = Number(a.pct) || 0;
                  if (p > 100) bands[3].count++;
                  else if (p >= 76) bands[2].count++;
                  else if (p >= 26) bands[1].count++;
                  else bands[0].count++;
                }
                const total = project.allocations.length || 1;
                return (
                  <div style={{
                    padding: 12, marginBottom: 10, borderRadius: 12,
                    border: `1px solid ${Colors.border}`,
                    backgroundColor: "rgba(255,255,255,0.025)",
                  }}>
                    {/* Avatar strip — centered */}
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "center" }}>
                        {visible.map((a, i) => (
                          <div key={i} title={hidePct ? a.name : `${a.name} · ${a.pct ?? 0}%`} style={{
                            width: 34, height: 34, borderRadius: "50%",
                            backgroundColor: palette[i % palette.length],
                            border: "2px solid #0F1A24",
                            marginLeft: i === 0 ? 0 : -10,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: "#FFF", fontSize: 12, fontWeight: 700,
                          }}>{initialsOf(a.name)}</div>
                        ))}
                        {hidden > 0 && (
                          <div style={{
                            width: 34, height: 34, borderRadius: "50%",
                            backgroundColor: "rgba(255,255,255,0.08)",
                            border: "2px solid #0F1A24",
                            marginLeft: -10,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: Colors.textSecondary, fontSize: 11, fontWeight: 700,
                          }}>+{hidden}</div>
                        )}
                      </div>
                    </div>
                    {/* Stat columns — %-based stats drop out in no-hours mode */}
                    <div style={{ display: "grid", gridTemplateColumns: hidePct ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 8, marginBottom: hidePct ? 0 : 14 }}>
                      <div style={{ textAlign: "center" }}>
                        {/* Same source as the avatar strip; pending-aware like
                            OPEN ROLES so it never flashes "0" mid-load.
                            When open positions exist the headline shows the
                            combined total (filled + open) with a small
                            breakdown beneath so the stat stays comparable. */}
                        <div style={{ fontSize: 22, fontWeight: 700, color: Colors.white, lineHeight: 1 }}>
                          {teamPending && project.allocations.length === 0
                            ? "·· ·"
                            : project.allocations.length + openRoles.length}
                        </div>
                        <div style={{ fontSize: 9, color: Colors.textMuted, fontWeight: 700, letterSpacing: 0.5, marginTop: 4 }}>MEMBERS</div>
                        {openRoles.length > 0 && (
                          <div style={{ fontSize: 8, color: Colors.textMuted, marginTop: 2, letterSpacing: 0 }}>
                            {project.allocations.length} + {openRoles.length} open
                          </div>
                        )}
                      </div>
                      {!hidePct && (
                        <div style={{ textAlign: "center", borderLeft: `1px solid ${Colors.border}` }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color: Colors.white, lineHeight: 1 }}>{avgPct}%</div>
                          <div style={{ fontSize: 9, color: Colors.textMuted, fontWeight: 700, letterSpacing: 0.5, marginTop: 4 }}>AVG ALLOC</div>
                        </div>
                      )}
                      {!hidePct && (
                        <div style={{ textAlign: "center", borderLeft: `1px solid ${Colors.border}` }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color: overAllocated > 0 ? "#F9AB33" : Colors.white, lineHeight: 1 }}>{overAllocated}</div>
                          <div style={{ fontSize: 9, color: Colors.textMuted, fontWeight: 700, letterSpacing: 0.5, marginTop: 4 }}>OVER 100%</div>
                        </div>
                      )}
                      <div style={{ textAlign: "center", borderLeft: `1px solid ${Colors.border}` }}>
                        {/* Pending-aware: never flash "0" while the team fetch is
                            still settling on first load. A genuine zero (load
                            complete, no open roles) still renders as 0. */}
                        <div style={{ fontSize: 22, fontWeight: 700, color: Colors.white, lineHeight: 1 }}>
                          {teamPending && openRoles.length === 0 ? "·· ·" : openRoles.length}
                        </div>
                        <div style={{ fontSize: 9, color: Colors.textMuted, fontWeight: 700, letterSpacing: 0.5, marginTop: 4 }}>OPEN ROLES</div>
                      </div>
                    </div>
                    {/* Distribution bar + legend — %-derived, hidden in no-hours mode */}
                    {!hidePct && (
                      <>
                        <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.05)" }}>
                          {bands.map((b, i) => b.count > 0 && (
                            <div key={i} title={`${b.label}: ${b.count}`} style={{
                              flex: b.count / total,
                              backgroundColor: b.color,
                            }} />
                          ))}
                        </div>
                        <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 12, marginTop: 10 }}>
                          {bands.filter(b => b.count > 0).map((b, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: b.color }} />
                              <span style={{ fontSize: 10, color: Colors.textSecondary }}>{b.label}</span>
                              <span style={{ fontSize: 10, color: Colors.textMuted, fontWeight: 600 }}>· {b.count}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              {/* Add Member button — shown on Gantt View tab for normal modes;
                  no-grid modes have their own Add Member in the toggle bar;
                  summaryOnlyMode has it inline below */}
              {canManageStaff && teamViewTab === "list" && !teamNoGrid && !summaryOnlyMode && (
                <div style={{ display: "flex", marginBottom: 10 }}>
                  <button style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    padding: "8px 14px", backgroundColor: Colors.green, color: "#FFF", border: "none",
                    borderRadius: 10, fontSize: 12, fontWeight: 600,
                    cursor: "pointer",
                  }} onClick={() => setShowAddMember(true)}>
                    <UserPlus size={12} /> Add Member
                  </button>
                </div>
              )}

              {/* ── No-grid Table / Gantt toggle ──
                  The two "no weekly grid" modes get a Table ↔ Gantt View toggle
                  (mirrors the Schedule/Gantt toggle in full mode). */}
              {teamNoGrid && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                {canManageStaff && (
                  <button style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    padding: "8px 14px", backgroundColor: Colors.green, color: "#FFF", border: "none",
                    borderRadius: 10, fontSize: 12, fontWeight: 600,
                    cursor: "pointer",
                  }} onClick={() => setShowAddMember(true)}>
                    <UserPlus size={12} /> Add Member
                  </button>
                )}
                {!canManageStaff && <span />}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* Leads always use this layout — no per-project picker for them */}
                {!isLeadRecord && (
                  <TeamViewModePicker ref={layoutPickerRef} key={project.id} recordId={project.id} module={project.module} variant="pill" />
                )}
                <div style={{ display: "flex", gap: 2, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 3, border: `1px solid ${Colors.border}` }}>
                  {([
                    { key: "table" as const, label: "Table View",  Icon: Users },
                    { key: "gantt" as const, label: "Gantt View",  Icon: Calendar },
                  ] as const).map(({ key, label, Icon }) => {
                    const active = noGridView === key;
                    return (
                      <button
                        type="button"
                        key={key}
                        title={active && key === "table" ? "Table View is selected — open layout options" : `Show ${label}`}
                        aria-pressed={active}
                        onClick={() => {
                          setNoGridView(key);
                          if (active && key === "table") layoutPickerRef.current?.open();
                        }}
                        style={{
                        display: "flex", alignItems: "center", gap: 5,
                        padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                        fontSize: 11, fontWeight: 600,
                        backgroundColor: active ? Colors.green : "transparent",
                        color: active ? "#FFF" : Colors.textMuted,
                        transition: "background 0.15s, color 0.15s",
                        whiteSpace: "nowrap",
                      }}>
                        <Icon size={11} /> {label}
                      </button>
                    );
                  })}
                </div>
                </div>
              </div>
              )}

              {/* ── Schedule View / Gantt View tab switcher ──
                  When settings hide the schedule the tab becomes "Hours View";
                  when hours are hidden too — or the mode has no weekly grid —
                  the switcher disappears entirely. Clicking Schedule View also
                  opens the per-project layout dropdown: the same five "Visible
                  sections" modes as Settings, applied to THIS project only. */}
              {!teamNoGrid && !summaryOnlyMode && (
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 2, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 3, border: `1px solid ${Colors.border}` }}>
                  <TeamViewModePicker
                    key={project.id}
                    recordId={project.id}
                    module={project.module}
                    variant="tab"
                    tabLabel="Team View"
                    TabIcon={displayMode === "no-schedule" ? Clock : Calendar}
                    tabActive={teamViewTab === "schedule"}
                    onTabSelect={() => setTeamViewTab("schedule")}
                  />
                  <button onClick={() => setTeamViewTab("list")} style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                    fontSize: 11, fontWeight: 600,
                    backgroundColor: teamViewTab === "list" ? Colors.green : "transparent",
                    color: teamViewTab === "list" ? "#FFF" : Colors.textMuted,
                    transition: "background 0.15s, color 0.15s",
                    whiteSpace: "nowrap",
                  }}>
                    <Users size={11} /> Gantt View
                  </button>
                </div>
              </div>
              )}

              {/* ── no-grid Table view ── plain members table + search */}
              {teamNoGrid && noGridView === "table" && (<>
                {canManageStaff && project.allocations.length > 0 && (
                  <button style={{
                    display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "none",
                    cursor: "pointer",
                    color: Colors.textMuted, fontSize: 11, padding: "0 2px 8px", marginTop: -4,
                  }} onClick={() => setTemplateModal({ mode: "save" })}>
                    <Layers size={11} /> Save current team as template
                  </button>
                )}
                {!canManageStaff && (
                  <div title={staffingLockNote ?? undefined} style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", marginBottom: 10,
                    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 8, border: `1px solid ${Colors.border}`,
                    fontSize: 11, color: Colors.textMuted, fontWeight: 600, cursor: "help",
                  }}>
                    <Lock size={11} color={Colors.textMuted} /> {staffingLockNote}
                  </div>
                )}
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 10,
                  backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10, border: `1px solid ${Colors.border}`,
                }}>
                  <Search size={14} color={Colors.textMuted} />
                  <input
                    type="text" placeholder="Search team member..." value={teamSearch}
                    onChange={(e) => setTeamSearch(e.target.value)}
                    style={{ flex: 1, background: "transparent", border: "none", color: Colors.textPrimary, fontSize: 13, outline: "none" }}
                  />
                  {teamSearch.length > 0 && (
                    <button onClick={() => setTeamSearch("")} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                      <X size={14} color={Colors.textMuted} />
                    </button>
                  )}
                </div>
                {displayMode === "schedule-no-grid" && !isLeadRecord && (
                  <PhaseCardsStrip projectId={project.id} refreshToken={mutationTick} canEdit={canEdit} />
                )}
                {removeMemberErr && (
                  <div style={{ color: "rgba(248,113,113,0.9)", fontSize: 12, marginBottom: 8 }}>{removeMemberErr}</div>
                )}
                <SimpleTeamTable
                  allocations={project.allocations}
                  searchQuery={teamSearch}
                  module={project.module}
                  projectId={displayMode === "schedule-no-grid" && !isLeadRecord ? project.id : undefined}
                  phasesRefreshToken={mutationTick}
                  canEdit={canManageStaff}
                  lockedNote={staffingLockNote}
                  onEditMember={(a, period) => { setEditMemberAlloc(a); setEditMemberPeriod(period ?? null); }}
                  onRemoveMember={canUnlockAlloc ? handleRemoveMember : undefined}
                  onChangeResource={canUnlockAlloc ? handleChangeResource : undefined}
                  canUnlock={canUnlockAlloc}
                  onToggleLock={handleToggleAllocLock}
                />
              </>)}

              {/* ── no-grid Gantt view ── TeamGantt with flags per mode */}
              {teamNoGrid && noGridView === "gantt" && (<>
                {displayMode === "schedule-no-grid" && !isLeadRecord && (
                  <PhaseCardsStrip projectId={project.id} refreshToken={mutationTick} canEdit={canEdit} />
                )}
                <TeamGantt allocations={project.allocations} searchQuery={teamSearch} refreshToken={mutationTick}
                  openRoles={openRoles}
                  projectId={project.id} module={project.module} scheduleStart={project.scheduleStart} scheduleEnd={project.scheduleEnd}
                  hideHours={false}
                  hideSchedule={displayMode === "no-schedule-no-grid" || isLeadRecord}
                  canEdit={canManageStaff}
                  lockedNote={staffingLockNote}
                  onRemoveMember={canUnlockAlloc ? handleRemoveMember : undefined}
                  onChangeResource={canUnlockAlloc ? handleChangeResource : undefined}
                  canUnlock={canUnlockAlloc}
                  onToggleLock={handleToggleAllocLock}
                  onToggleFlag={handleToggleAllocFlag}
                  onRemoveOpenPosition={canUnlockAlloc ? handleRemoveOpenPosition : undefined}
                  onReload={() => void refreshAfterMutation(true, true)} />
              </>)}

              {/* ── Summary Only mode: no dates, no hours — just a plain member table, no Gantt ── */}
              {/* Leads are excluded — teamNoGrid already renders their
                  dates + hours table, so without this guard a lead under the
                  summary-only tenant mode would show BOTH tables. */}
              {summaryOnlyMode && !isLeadRecord && (<>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  {canManageStaff ? (
                    <button style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      padding: "8px 14px", backgroundColor: Colors.green, color: "#FFF", border: "none",
                      borderRadius: 10, fontSize: 12, fontWeight: 600,
                      cursor: "pointer",
                    }} onClick={() => setShowAddMember(true)}>
                      <UserPlus size={12} /> Add Member
                    </button>
                  ) : (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
                      backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 8, border: `1px solid ${Colors.border}`,
                      fontSize: 11, color: Colors.textMuted, fontWeight: 600,
                    }}>
                      <Lock size={11} color={Colors.textMuted} /> View only
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {canManageStaff && project.allocations.length > 0 && (
                      <button style={{
                        display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "none",
                        cursor: "pointer",
                        color: Colors.textMuted, fontSize: 11, padding: "0 2px 0",
                      }} onClick={() => setTemplateModal({ mode: "save" })}>
                        <Layers size={11} /> Save as template
                      </button>
                    )}
                    <TeamViewModePicker key={project.id} recordId={project.id} module={project.module} variant="pill" />
                  </div>
                </div>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 10,
                  backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10, border: `1px solid ${Colors.border}`,
                }}>
                  <Search size={14} color={Colors.textMuted} />
                  <input
                    type="text" placeholder="Search team member..." value={teamSearch}
                    onChange={(e) => setTeamSearch(e.target.value)}
                    style={{ flex: 1, background: "transparent", border: "none", color: Colors.textPrimary, fontSize: 13, outline: "none" }}
                  />
                  {teamSearch.length > 0 && (
                    <button onClick={() => setTeamSearch("")} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                      <X size={14} color={Colors.textMuted} />
                    </button>
                  )}
                </div>
                {removeMemberErr && (
                  <div style={{ color: "rgba(248,113,113,0.9)", fontSize: 12, marginBottom: 8 }}>{removeMemberErr}</div>
                )}
                <SimpleTeamTable
                  allocations={project.allocations}
                  searchQuery={teamSearch}
                  hideDates
                  hideHours
                  module={project.module}
                  canEdit={canManageStaff}
                  lockedNote={staffingLockNote}
                  onEditMember={(a, period) => { setEditMemberAlloc(a); setEditMemberPeriod(period ?? null); }}
                  onRemoveMember={canUnlockAlloc ? handleRemoveMember : undefined}
                  onChangeResource={canUnlockAlloc ? handleChangeResource : undefined}
                  canUnlock={canUnlockAlloc}
                  onToggleLock={handleToggleAllocLock}
                />
              </>)}

              {/* ── Normal modes: Gantt view (list tab) ── */}
              {!teamNoGrid && !summaryOnlyMode && teamViewTab === "list" && (<>
                {canManageStaff && project.allocations.length > 0 && (
                  <button style={{
                    display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "none",
                    cursor: "pointer",
                    color: Colors.textMuted, fontSize: 11, padding: "0 2px 8px", marginTop: -4,
                  }} onClick={() => setTemplateModal({ mode: "save" })}>
                    <Layers size={11} /> Save current team as template
                  </button>
                )}
                {!canManageStaff && (
                  <div title={staffingLockNote ?? undefined} style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", marginBottom: 10,
                    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 8, border: `1px solid ${Colors.border}`,
                    fontSize: 11, color: Colors.textMuted, fontWeight: 600, cursor: "help",
                  }}>
                    <Lock size={11} color={Colors.textMuted} /> {staffingLockNote}
                  </div>
                )}
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 10,
                  backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10, border: `1px solid ${Colors.border}`,
                }}>
                  <Search size={14} color={Colors.textMuted} />
                  <input
                    type="text" placeholder="Search team member..." value={teamSearch}
                    onChange={(e) => setTeamSearch(e.target.value)}
                    style={{ flex: 1, background: "transparent", border: "none", color: Colors.textPrimary, fontSize: 13, outline: "none" }}
                  />
                  {teamSearch.length > 0 && (
                    <button onClick={() => setTeamSearch("")} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                      <X size={14} color={Colors.textMuted} />
                    </button>
                  )}
                </div>
                {/* Phase overview cards (clickable, full detail) in Gantt view */}
                <TeamScheduleGrid
                  overviewOnly
                  projectId={project.id}
                  forceFreshTeam={forceFreshTeamOnEntry}
                  module={project.module}
                  reloadKey={mutationTick}
                  canEdit={false}
                  hideSchedule={displayMode === "no-schedule"}
                />
                <TeamGantt allocations={project.allocations} searchQuery={teamSearch} refreshToken={mutationTick}
                  openRoles={openRoles}
                  projectId={project.id} module={project.module} scheduleStart={project.scheduleStart} scheduleEnd={project.scheduleEnd}
                  hideHours={false}
                  hideSchedule={displayMode === "no-schedule"}
                  canEdit={canManageStaff}
                  lockedNote={staffingLockNote}
                  onRemoveMember={canUnlockAlloc ? handleRemoveMember : undefined}
                  onChangeResource={canUnlockAlloc ? handleChangeResource : undefined}
                  canUnlock={canUnlockAlloc}
                  onToggleLock={handleToggleAllocLock}
                  onToggleFlag={handleToggleAllocFlag}
                  onRemoveOpenPosition={canUnlockAlloc ? handleRemoveOpenPosition : undefined}
                  onReload={() => void refreshAfterMutation(true, true)} />
              </>)}

              {teamViewTab === "schedule" && !teamNoGrid && !summaryOnlyMode && (
                <TeamScheduleGrid
                  projectId={project.id}
                  forceFreshTeam={forceFreshTeamOnEntry}
                  module={project.module}
                  reloadKey={mutationTick}
                  canEdit={canManageStaff}
                  onReload={() => void refreshAfterMutation(true, true)}
                  hideSchedule={displayMode === "no-schedule"}
                  openRoles={openRoles}
                  projectName={project.name}
                  projectStartDate={(project.scheduleStart || project.targetStart || new Date().toISOString()).slice(0, 10)}
                  projectEndDate={(project.scheduleEnd || project.targetEnd || new Date(Date.now() + 365 * 86400000).toISOString()).slice(0, 10)}
                  scheduleStart={project.scheduleStart || ""}
                  scheduleEnd={project.scheduleEnd || ""}
                  existingAllocations={project.allocations.map(a => ({ personId: a.resourceId || "", bu: a.bu || "", role: a.role || "", title: a.title || "", hours: a.eacHrs || 0, allocationId: a.rwiId, startDate: a.startDate, endDate: a.endDate }))}
                  canUnlock={canUnlockAlloc}
                  onToggleLock={handleToggleAllocLock}
                  onToggleFlag={handleToggleAllocFlag}
                  onRemoveMember={canUnlockAlloc ? handleRemoveMember : undefined}
                  onChangeResource={canUnlockAlloc ? handleChangeResource : undefined}
                  onRemoveOpenPosition={canUnlockAlloc ? handleRemoveOpenPosition : undefined}
                  onAddMember={(seed) => {
                    // Open the Add Team Member POPUP (same modal as the
                    // open-position Assign flow) instead of the inline row.
                    setAddMemberSeed(seed ?? null);
                    setShowAddMember(true);
                  }}
                  onMemberAdded={(_name, optimistic) => {
                    // Mirror the Add Member modal's optimistic insert so the
                    // new person appears immediately in the grid and team list.
                    if (optimistic && project) {
                      applyOptimisticProjectTeamMember(queryClient, project.id, {
                        ...optimistic,
                        name: _name,
                      });
                      const newEntry: Allocation = {
                        name: _name,
                        role: optimistic.role,
                        bu: optimistic.bu,
                        title: optimistic.title,
                        pct: optimistic.pct,
                        startDate: optimistic.startDate,
                        endDate: optimistic.endDate,
                        eacHrs: 0, etcHrs: 0, costRate: 0, laborRate: 0,
                        eacCost: 0, etcCost: 0, ncHrs: 0, ncCost: 0,
                        hasWeeklyHours: false,
                        email: "",
                        resourceId: optimistic.id,
                        memberBu: "",
                      };
                      const alreadyIn = project.allocations.some(
                        a => a.name.toLowerCase() === _name.toLowerCase()
                      );
                      if (!alreadyIn) {
                        setProject(prev => prev ? {
                          ...prev,
                          allocations: [...prev.allocations, newEntry],
                        } : prev);
                      }
                    }
                    // Silent background refresh fills in real hours/costs data
                    silentTeamRefresh();
                  }}
                  onManageAI={() => askAI(`Analyze team allocation for project "${project.name}" (${project.id}). Who is under or over-allocated? Recommend changes.`)}
                  onApplyTemplate={() => setTemplateModal({ mode: "apply" })}
                  onAddOpenPosition={canManageStaff ? () => setShowOpenPos(true) : undefined}
                />
              )}

              <OpenRolesBlock roles={openRoles} highlight={highlightOpenRoles}
                canEdit={canManageStaff} lockedNote={staffingLockNote} hidePct={displayMode === "no-schedule-no-hours"}
                onAssign={setAssignSlot} />
            </>
          )}

          {valueHistoryOpen && project && (
            <ValueHistoryModal recordId={project.id} onClose={() => setValueHistoryOpen(false)} />
          )}

          {templateModal && project && (
            <AllocationTemplateModal
              open={!!templateModal}
              mode={templateModal.mode}
              projectId={project.id}
              projectTitle={project.name}
              projectStartDate={(project.scheduleStart || project.targetStart || new Date().toISOString()).slice(0, 10)}
              projectEndDate={(project.scheduleEnd || project.targetEnd || new Date(Date.now() + 365 * 86400000).toISOString()).slice(0, 10)}
              scheduleStart={project.scheduleStart || undefined}
              scheduleEnd={project.scheduleEnd || undefined}
              currentTeam={project.allocations}
              assignedPersonIds={project.allocations.map((a: { resourceId?: string }) => a.resourceId || "").filter(Boolean)}
              onClose={() => setTemplateModal(null)}
              /* Refresh only — the modal closes itself on full success but stays
                 open (with a plain-language error) when a slot is rejected. */
              onApplied={() => { void refreshAfterMutation(true, true); }}
            />
          )}

          {showOpenPos && project && (
            <AddOpenPositionModal
              open={showOpenPos}
              onClose={() => setShowOpenPos(false)}
              projectId={project.id}
              projectName={project.name}
              defaultStartDate={project.scheduleStart || project.targetStart}
              defaultEndDate={project.scheduleEnd || project.targetEnd}
              onCreated={(_role) => {
                setShowOpenPos(false);
                void refreshAfterMutation(true, true);
              }}
            />
          )}

          {(showAddMember || assignSlot) && project && (
            <AddTeamMemberModal
              key={addMemberSeed ? `seed-${addMemberSeed.personId}` : "add"}
              open={showAddMember || !!assignSlot}
              onClose={() => { setShowAddMember(false); setAssignSlot(null); setAddMemberSeed(null); }}
              projectId={project.id}
              module={project.module}
              projectName={project.name}
              projectStartDate={(project.scheduleStart || project.targetStart || new Date().toISOString()).slice(0, 10)}
              projectEndDate={(project.scheduleEnd || project.targetEnd || new Date(Date.now() + 365 * 86400000).toISOString()).slice(0, 10)}
              scheduleStart={project.scheduleStart || ""}
              scheduleEnd={project.scheduleEnd || ""}
              existingAllocations={project.allocations.map(a => ({ personId: a.resourceId || "", bu: a.bu || "", role: a.role || "", title: a.title || "", hours: a.eacHrs || 0, allocationId: a.rwiId, startDate: a.startDate, endDate: a.endDate }))}
              onAssigned={(_name, optimistic) => {
                const filledSlot = assignSlot; // capture before clearing
                setAssignSlot(null);
                // Optimistic insert: show the new member immediately without
                // waiting for the server round-trip.
                if (optimistic && project) {
                  applyOptimisticProjectTeamMember(queryClient, project.id, {
                    ...optimistic,
                    name: _name,
                  });
                  const newEntry: Allocation = {
                    name: _name,
                    role: optimistic.role,
                    bu: optimistic.bu,
                    title: optimistic.title,
                    pct: optimistic.pct,
                    startDate: optimistic.startDate,
                    endDate: optimistic.endDate,
                    eacHrs: 0, etcHrs: 0, costRate: 0, laborRate: 0,
                    eacCost: 0, etcCost: 0, ncHrs: 0, ncCost: 0,
                    hasWeeklyHours: false,
                    email: "",
                    resourceId: optimistic.id,
                    memberBu: "",
                  };
                  // Only insert if not already in the list
                  const alreadyIn = project.allocations.some(
                    a => a.name.toLowerCase() === _name.toLowerCase()
                  );
                  if (!alreadyIn) {
                    setProject(prev => prev ? {
                      ...prev,
                      allocations: [...prev.allocations, newEntry],
                    } : prev);
                  }
                }
                // Optimistic open-position removal: if we just filled a
                // specific open slot (assignSlot carried its raIds), drop it
                // from openRoles immediately so the row and the "N open roles"
                // panel disappear without waiting for the background refetch.
                if (filledSlot?.raIds?.length) {
                  const filledRaSet = new Set(filledSlot.raIds);
                  setOpenRoles(prev =>
                    // Rows without raIds can't be matched to the filled slot — keep them.
                    prev.filter(or => !(or.raIds ?? []).some(id => filledRaSet.has(id)))
                  );
                }
                // Silent background refresh fills in real hours/costs data
                // and confirms (or corrects) the optimistic state above.
                silentTeamRefresh();
              }}
              prefillBuShort={assignSlot?.bu}
              prefillRole={assignSlot?.role}
              prefillTitle={assignSlot?.title || assignSlot?.role}
              prefillStartDate={assignSlot?.startDate ? assignSlot.startDate.slice(0, 10) : undefined}
              prefillEndDate={assignSlot?.endDate ? assignSlot.endDate.slice(0, 10) : undefined}
              prefillPct={assignSlot?.pct}
              prefillAllocationId={assignSlot?.allocationId}
              prefillTypeGuid={assignSlot?.typeGuid}
              prefillGroupId={assignSlot?.groupId}
              consumeRaIds={assignSlot?.raIds}
              seedPersonId={assignSlot ? undefined : addMemberSeed?.personId}
              openRoles={openRoles}
              /* No-weekly-grid modes (and leads, which never have a grid):
                 there is no hours grid to fill in later, so the Add modal
                 itself takes the member's Total Hours. */
              showHoursField={teamNoGrid}
              forceDates={isLeadRecord}
               displayMode={displayMode}
               onSetupSchedule={() => {
                 setShowAddMember(false);
                 setAssignSlot(null);
                 setAddMemberSeed(null);
                 setExpandedSections((prev) => { const next = new Set(prev); next.add("timeline"); return next; });
                 setTimeout(() => document.getElementById("schedule-section")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
               }}
            />
          )}

          {/* Change Resource modal — opened from the ⋯ menu on a member row.
              Pick who takes over: hours up to & incl. this week stay with the
              outgoing member; everything from next Monday onward moves to the
              picked person (the server owns the cutover + hand-over). */}
          {changeResourceFor && project && (
            <AddTeamMemberModal
              key={`change-${changeResourceFor.resourceId}`}
              open
              onClose={() => setChangeResourceFor(null)}
              projectId={project.id}
              module={project.module}
              projectName={project.name}
              projectStartDate={(project.scheduleStart || project.targetStart || new Date().toISOString()).slice(0, 10)}
              projectEndDate={(project.scheduleEnd || project.targetEnd || new Date(Date.now() + 365 * 86400000).toISOString()).slice(0, 10)}
              scheduleStart={project.scheduleStart || ""}
              scheduleEnd={project.scheduleEnd || ""}
              existingAllocations={project.allocations.map(a => ({ personId: a.resourceId || "", bu: a.bu || "", role: a.role || "", title: a.title || "", hours: a.eacHrs || 0, allocationId: a.rwiId, startDate: a.startDate, endDate: a.endDate }))}
              changeFrom={{ personId: changeResourceFor.resourceId, name: changeResourceFor.name }}
              prefillBuShort={changeResourceFor.bu}
              prefillDivisionId={changeResourceFor.divisionId}
              prefillRole={changeResourceFor.role}
              prefillTitle={changeResourceFor.title}
              onAssigned={(_name, optimistic) => {
                setChangeResourceFor(null);
                // Optimistic: show the incoming person right away (0h — their
                // moved hours arrive with the refresh) unless already listed.
                if (optimistic && project && !project.allocations.some(a => a.name.toLowerCase() === _name.toLowerCase())) {
                  const newEntry: Allocation = {
                    name: _name, role: optimistic.role, bu: optimistic.bu, title: optimistic.title,
                    pct: 0, startDate: optimistic.startDate, endDate: optimistic.endDate,
                    eacHrs: 0, etcHrs: 0, costRate: 0, laborRate: 0,
                    eacCost: 0, etcCost: 0, ncHrs: 0, ncCost: 0,
                    hasWeeklyHours: false, email: "", resourceId: optimistic.id, memberBu: "",
                  };
                  setProject(prev => prev ? { ...prev, allocations: [...prev.allocations, newEntry] } : prev);
                }
                // Full refresh pulls the moved hours + the outgoing member's
                // new end date (or removal, when nothing remained).
                void refreshAfterMutation(true, true);
              }}
            />
          )}

          {/* Edit Assignment modal — pencil icon opens this to change
              role / division / title / dates for an existing team member. */}
          {editMemberAlloc && project && (
            <AddTeamMemberModal
              open={!!editMemberAlloc}
              onClose={() => { setEditMemberAlloc(null); setEditMemberPeriod(null); }}
              onSetupSchedule={() => {
                setEditMemberAlloc(null); setEditMemberPeriod(null);
                setExpandedSections((prev) => { const next = new Set(prev); next.add("timeline"); return next; });
                setTimeout(() => document.getElementById("schedule-section")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
              }}
              projectId={project.id}
              module={project.module}
              projectName={project.name}
              projectStartDate={(project.scheduleStart || project.targetStart || new Date().toISOString()).slice(0, 10)}
              projectEndDate={(project.scheduleEnd || project.targetEnd || new Date(Date.now() + 365 * 86400000).toISOString()).slice(0, 10)}
              scheduleStart={project.scheduleStart || ""}
              scheduleEnd={project.scheduleEnd || ""}
              existingAllocations={project.allocations.map(a => ({ personId: a.resourceId || "", bu: a.bu || "", role: a.role || "", title: a.title || "", hours: a.eacHrs || 0, allocationId: a.rwiId, startDate: a.startDate, endDate: a.endDate }))}
              onAssigned={(_name, optimistic) => {
                // Optimistically patch the edited member's card in place so the
                // new hours / dates / implied allocation % show INSTANTLY. The
                // fresh team fetch right after a save can exceed its 10s budget
                // (cold server cache + post-save DB contention), which used to
                // leave stale — or worse, raw-hours-as-percent — values on the
                // card until a manual refresh.
                const target = editMemberAlloc;
                if (optimistic && target) {
                  const patch = (prev: ProjectData | null): ProjectData | null => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      allocations: prev.allocations.map((a) => {
                        const match = (target.rwiId !== undefined && a.rwiId === target.rwiId) ||
                          (a.name === target.name && a.role === target.role);
                        if (!match) return a;
                        const startDate = optimistic.startDate || a.startDate;
                        const endDate = optimistic.endDate || a.endDate;
                        // The modal sends `hours` ONLY when its Total Hours field
                        // was shown AND filled — when absent, optimistic.pct may
                        // be a percentage fallback, so only patch the dates.
                        // Period edit: also patch the edited period row in the
                        // member's slices (matched by its ORIGINAL window) so
                        // the table shows the new period instantly — otherwise
                        // stale rows linger until the refresh lands.
                        const slices = optimistic.period && editMemberPeriod && a.slices
                          ? a.slices.map((s) =>
                              (s.startDate || "").slice(0, 10) === editMemberPeriod.startDate.slice(0, 10) &&
                              (s.endDate || "").slice(0, 10) === editMemberPeriod.endDate.slice(0, 10)
                                ? { ...s, startDate: optimistic.period!.startDate, endDate: optimistic.period!.endDate, hours: optimistic.period!.hours }
                                : s)
                          : a.slices;
                        if (optimistic.hours === undefined) return { ...a, startDate, endDate, slices };
                        const hours = Math.max(0, Number(optimistic.hours) || 0);
                        const weeks = Math.max(1, Math.round(
                          (new Date(endDate).getTime() - new Date(startDate).getTime()) / (7 * 86400000)
                        ) || 1);
                        const impliedPct = Math.round((hours / weeks / 40) * 100);
                        return { ...a, startDate, endDate, slices, eacHrs: hours, etcHrs: hours, pct: impliedPct };
                      }),
                    };
                  };
                  setProject((prev) => patch(prev) ?? prev);
                  // Keep projectRef in sync — the timeout-preserve path in
                  // loadProject reads projectRef.current.allocations, and a
                  // stale ref would overwrite this optimistic patch seconds
                  // later with the pre-save values.
                  projectRef.current = patch(projectRef.current);
                }
                setEditMemberAlloc(null);
                setEditMemberPeriod(null);
                void refreshAfterMutation(true, true);
              }}
              prefillPersonId={editMemberAlloc.resourceId}
              prefillPersonName={editMemberAlloc.name}
              prefillBuShort={editMemberAlloc.bu}
              prefillDivisionId={editMemberAlloc.divisionId}
              prefillMemberBu={editMemberAlloc.memberBu}
              prefillRole={editMemberAlloc.role}
              prefillTitle={editMemberAlloc.title}
              prefillDept={editMemberAlloc.dept}
              prefillStartDate={(editMemberPeriod?.startDate ?? editMemberAlloc.startDate)?.slice(0, 10)}
              prefillEndDate={(editMemberPeriod?.endDate ?? editMemberAlloc.endDate)?.slice(0, 10)}
              prefillPct={editMemberAlloc.pct}
              prefillAllocationId={editMemberPeriod?.rwiId ?? editMemberAlloc.rwiId}
              showHoursField={displayMode === "no-schedule" || displayMode === "no-schedule-no-hours" || teamNoGrid}
              forceDates={isLeadRecord}
              prefillHours={editMemberPeriod ? editMemberPeriod.hours : editMemberAlloc.eacHrs}
              periodScope={editMemberPeriod ? (() => {
                const ps = editMemberPeriod.startDate.slice(0, 10);
                const pe = editMemberPeriod.endDate.slice(0, 10);
                // Every OTHER period window this member has — across ALL their
                // allocation entries (same person can hold two roles). The
                // save path rejects new dates that overlap any of these, since
                // weekly rows carry no per-period identity — except same-RWI
                // siblings a replace-all hours save is about to merge away.
                const personKey = editMemberAlloc.resourceId || editMemberAlloc.name;
                const otherPeriods: { start: string; end: string; rwiId?: number | null }[] = [];
                for (const al of project.allocations) {
                  if ((al.resourceId || al.name) !== personKey) continue;
                  const sl = al.slices && al.slices.length > 0
                    ? al.slices
                    : [{ startDate: al.startDate, endDate: al.endDate, rwiId: al.rwiId }];
                  for (const s of sl) {
                    const ss = (s.startDate || "").slice(0, 10);
                    const se = (s.endDate || "").slice(0, 10);
                    if (!ss || !se) continue;
                    if (ss === ps && se === pe) continue; // the clicked period itself
                    otherPeriods.push({ start: ss, end: se, rwiId: s.rwiId ?? null });
                  }
                }
                return {
                  periodStart: ps,
                  periodEnd: pe,
                  periodHours: editMemberPeriod.hours,
                  assignStart: editMemberAlloc.startDate?.slice(0, 10),
                  assignEnd: editMemberAlloc.endDate?.slice(0, 10),
                  assignHours: editMemberAlloc.eacHrs,
                  rwiId: editMemberPeriod.rwiId ?? null,
                  otherPeriods,
                };
              })() : undefined}
            />
          )}

          {/* Inline Edit Allocation modal — "Edit Allocation" button inside
              expanded card opens this for the phase-hours editor. */}
          {editAllocPerson && project && (
            <EditAllocationModal
              person={editAllocPerson}
              projectId={project.id}
              projectName={project.name}
              onClose={() => setEditAllocPerson(null)}
              onSaved={() => { setEditAllocPerson(null); void refreshAfterMutation(); }}
              onSetupSchedule={() => {
                setEditAllocPerson(null);
                setExpandedSections((prev) => { const s = new Set(prev); s.add("timeline"); return s; });
                setTimeout(() => document.getElementById("schedule-section")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
              }}
            />
          )}
        </SectionCard>
      )}

      </div>{/* end section cards grid */}

      {/* ── "Scheduled for later" popup — raised by the STATUS cell and the
          lifecycle footers when a manual pick targets a phase whose schedule
          window hasn't started. Offers the jump to the schedule card. ── */}
      {futureWarn && (
        <ScheduledLaterModal
          info={futureWarn}
          onClose={() => setFutureWarn(null)}
          onOpenSchedule={() => { setFutureWarn(null); jumpToScheduleCard(); }}
        />
      )}

      {/* ── Opportunity Lifecycle Action Bar.
          Gated on effective Edit data: stage-permission denials keep the bar
          VISIBLE but disabled with the plain-language reason (lockedNote),
          so people learn up front they can't act at this stage. ── */}
      {project.module === "OPM" && canEdit && linkedPmmId ? (
        /* ── Already-converted banner: mirrors the LEM pattern at line below.
               Shows whenever a PMM with the same title is found — regardless
               of whether the OPM stage was updated to "Converted". ── */
        <div style={{
          margin: "0 16px 16px", padding: "14px 18px", borderRadius: 12,
          border: "1px solid rgba(16,185,129,0.45)", backgroundColor: "rgba(16,185,129,0.10)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <CheckCircle size={18} color="#10B981" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "var(--rm-text)", fontWeight: 500 }}>
            This opportunity has already been converted to project{" "}
            <button
              onClick={() => navigate(`/project/${linkedPmmId}`)}
              style={{
                background: "none", border: "none", padding: 0, cursor: "pointer",
                color: "#10B981", fontWeight: 700, fontSize: 13, textDecoration: "underline",
              }}
            >{linkedPmmId}</button>.
            {" "}The action bar is locked to prevent a duplicate project.
          </span>
        </div>
      ) : project.module === "OPM" && canEdit && (
        <OppLifecycleFooter
          project={project}
          lockedNote={stageLockNote}
          // Status follows the schedule: when this opp has its own lifecycle
          // phases they ARE the status list — the stepper, the Override
          // Status modal and the STATUS dropdown all operate on ONE list.
          // Confirmed no lifecycle ([]): the record's OWN list (custom adds
          // only) — same source as the STATUS dropdown's no-schedule branch,
          // so the editor never offers statuses the dropdown won't show.
          opmStageOptions={!scheduleOff && schedulePhases !== null
            ? schedulePhases
            : withWorkflowStages(opmStageOptions)}
          lockedBase={!scheduleOff && schedulePhases !== null && schedulePhases.length > 0}
          fallbackStages={!scheduleOff && schedulePhases !== null && schedulePhases.length === 0
            ? [] : OPM_FALLBACK_STAGES}
          schedulePending={!scheduleOff && schedulePhases === null}
          phaseDates={schedulePhaseDates}
          onOpenSchedule={jumpToScheduleCard}
          onFuturePhase={(stage, phase, startDay) => setFutureWarn({ stage, phase, startDay })}
          openOverrideSignal={overrideSignal}
          openOverrideFocus={overrideFocus}
          isAdmin={canAdvanceStage}
          canRemoveAnyStage={user?.isAdmin === true}
          onSaveField={saveField}
          onNavigate={navigate}
          onRefresh={() => void loadProject(true)}
          tenantStageOrder={stageRuleInfo.tenantOrder}
          hiddenStages={stageRuleInfo.skipped}
          stageColors={stageRuleInfo.stageColors}
          buttonLabels={stageRuleInfo.buttonLabels}
          guidanceTip={stageRuleInfo.guidanceTip}
        />
      )}

      {/* ── Project Lifecycle Action Bar — Advance walks the status options
          (Pipeline → Active → tenant statuses); Close Project marks the
          record Closed, filing it under Archive → Closed Records. ── */}
      {project.module === "PMM" && canEdit && (
        <OppLifecycleFooter
          project={project}
          lockedNote={stageLockNote}
          // Same list as the STATUS detail cell: the record's own schedule
          // phases when a lifecycle is assigned (status follows schedule —
          // stepper, Override modal and dropdown operate on ONE list);
          // otherwise the contract designations + live status values.
          // Confirmed no lifecycle ([]): the record's OWN list (custom adds
          // only) — same source as the STATUS dropdown's no-schedule branch,
          // so the editor never offers statuses the dropdown won't show.
          opmStageOptions={!scheduleOff && schedulePhases !== null
            ? schedulePhases
            : withWorkflowStages(Array.from(new Set(["Pipeline", "Active", ...statusOptions])))}
          lockedBase={!scheduleOff && schedulePhases !== null && schedulePhases.length > 0}
          schedulePending={!scheduleOff && schedulePhases === null}
          phaseDates={schedulePhaseDates}
          onOpenSchedule={jumpToScheduleCard}
          onFuturePhase={(stage, phase, startDay) => setFutureWarn({ stage, phase, startDay })}
          openOverrideSignal={overrideSignal}
          openOverrideFocus={overrideFocus}
          isAdmin={canAdvanceStage}
          canRemoveAnyStage={user?.isAdmin === true}
          onSaveField={saveField}
          onNavigate={navigate}
          onRefresh={() => void loadProject(true)}
          statusField="CRMProjectStatusChoice"
          nounLabel="project"
          convertLabel="Close Project"
          fallbackStages={!scheduleOff && schedulePhases !== null && schedulePhases.length === 0
            ? [] : PMM_FALLBACK_STAGES}
          mode="close"
          tenantStageOrder={stageRuleInfo.tenantOrder}
          hiddenStages={stageRuleInfo.skipped}
          stageColors={stageRuleInfo.stageColors}
          buttonLabels={stageRuleInfo.buttonLabels}
          guidanceTip={stageRuleInfo.guidanceTip}
        />
      )}

      {/* ── Lead Lifecycle Action Bar — Lost / Cancel / To Opportunity ── */}
      {project.module === "LEM" && canEdit && (
        // Already-converted leads get a locked notice instead of the action
        // bar: re-running "To Opportunity" would create a duplicate opp, and
        // Lost/Cancel/Override would overwrite the "Converted" sentinel the
        // Leads grid relies on for its blue chip + popup intercept.
        String(project.rawFields?.LeadStatus ?? "").trim() === "Converted" ? (
          <div style={{
            margin: "0 16px 16px", padding: "14px 18px", borderRadius: 12,
            border: "1px solid rgba(75,156,211,0.55)", backgroundColor: "rgba(75,156,211,0.10)",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <CheckCircle size={18} color="#2f7fb5" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: "var(--rm-text)", fontWeight: 500 }}>
              This lead has been converted into an opportunity — its status is locked.
              Find the opportunity under <strong style={{ color: "#2f7fb5" }}>Leads &amp; Opps → Opps</strong>.
            </span>
          </div>
        ) : (
          <OppLifecycleFooter
            project={project}
            lockedNote={stageLockNote}
            // Live tenant lead statuses (scraped from Lead records) so custom
            // statuses participate in Advance / Go Back sequencing; the footer
            // itself filters terminals + the "Converted" sentinel.
            opmStageOptions={withWorkflowStages(lemStatusOptions)}
            isAdmin={canAdvanceStage}
            canRemoveAnyStage={user?.isAdmin === true}
            onSaveField={saveField}
            onNavigate={navigate}
            onRefresh={() => void loadProject(true)}
            statusField="LeadStatus"
            nounLabel="lead"
            convertLabel="Advance to Opportunity"
            convertPath={(id) => `/opportunity/create?fromLead=${encodeURIComponent(id)}`}
            fallbackStages={LEM_FALLBACK_STAGES}
            tenantStageOrder={stageRuleInfo.tenantOrder}
            hiddenStages={stageRuleInfo.skipped}
            stageColors={stageRuleInfo.stageColors}
            buttonLabels={stageRuleInfo.buttonLabels}
            guidanceTip={stageRuleInfo.guidanceTip}
          />
        )
      )}

      {/* ── AI Quick Actions — hidden for leads (LEM) per client request ── */}
      {project.module !== "LEM" && (
        <AiQuickActions project={project} askAI={askAI} />
      )}

      <div style={{ height: 60 }} />
    </div>
  );
}

const OPM_FALLBACK_STAGES = [
  "Pending Assignment", "Proposal Development", "Contract Negotiations", "Awarded", "Lost",
];
// Project (PMM) contract designations — the canonical forward order for the
// project lifecycle footer's Advance / Go Back sequencing. Tenant statuses
// from the live option list append after these; "Closed" is the terminal
// handled by the dedicated Close Project button.
const PMM_FALLBACK_STAGES = ["Pipeline", "Active"];
// Lead funnel used by the lead lifecycle footer's Advance / Override actions.
// Lost / Declined are deliberately excluded — Lost and Cancel are dedicated
// buttons, and "Converted" is stamped only by the To Opportunity flow.
const LEM_FALLBACK_STAGES = [
  "New", "Prospecting", "Qualifying", "Proposal", "Negotiation", "Awarded",
];

/* ──────────────── OppLifecycleFooter ──────────────── */
// Shared by OPM (defaults) and LEM (statusField="LeadStatus" + lead-specific
// convert action) — the lifecycle bars are intentionally identical in look.
function OppLifecycleFooter({
  project, opmStageOptions, isAdmin, onSaveField, onNavigate, onRefresh,
  statusField = "CRMOpportunityStatusChoice",
  nounLabel = "opportunity",
  convertLabel = "Advance to Project",
  convertPath = (id: string) => `/project/create?fromOpp=${encodeURIComponent(id)}`,
  fallbackStages = OPM_FALLBACK_STAGES,
  // Strict admin-only capability (fail-closed): unlike isAdmin, which is
  // grandfathered true for unset access levels to keep the Override link
  // available, removing pipeline statuses requires an explicit admin level.
  canRemoveAnyStage = false,
  // "convert" (opps/leads): the green terminal button creates a downstream
  // record. "close" (projects): no downstream record exists — the green
  // button marks the project Closed, which moves it to Archive →
  // Closed Projects; Lost/Cancel are hidden (Closed IS the project terminal).
  mode = "convert",
  // Company stage rules (admin-configured): the tenant-wide stage order (used
  // as the default sequencing when the user hasn't dragged a personal order)
  // and the stages skipped for THIS record (hidden from the bar + Advance,
  // except the record's current stage).
  tenantStageOrder = null,
  hiddenStages,
  // Display-only styling from the Workflow Stages configurator: custom stage
  // colors (lowercased stage name → hex) and renamed action buttons.
  stageColors = null,
  buttonLabels = null,
  // Per-stage permissions (#87): when set, THIS user may not move the record
  // at its current stage — every action button and the Override link render
  // disabled with this plain-language reason as the tooltip. The server
  // enforces the same rule; this is the courteous up-front version.
  lockedNote = null,
  // Admin-written team tip for the record's current stage (#137): renders as
  // a banner under the stepper. Display-only — never gates any action.
  guidanceTip = null,
  // Monotonic page-level signal: each NEW bump opens the Override Status
  // modal (the STATUS dropdown's "Customize this list…" action row).
  openOverrideSignal = 0,
  openOverrideFocus,
  // True when opmStageOptions are the record's SCHEDULE phases: those carry
  // the schedule's start/end dates, so they can't be dragged, removed or
  // resorted here — only manually-added custom statuses stay editable.
  lockedBase = false,
  // True while the record's schedule phases are still UNKNOWN (task fetch in
  // flight or retrying): the stepper suppresses the status pile and the
  // Advance/Go Back cards until the real phase list resolves.
  schedulePending = false,
  // Phase title (lowercased) → {start,end} UTC-day window; powers the
  // "scheduled for later" save guard.
  phaseDates = null,
  onOpenSchedule,
  // Parent shows the shared ScheduledLaterModal when a save targets a phase
  // whose window hasn't started.
  onFuturePhase,
}: {
  project: ProjectData;
  opmStageOptions: string[];
  isAdmin: boolean;
  canRemoveAnyStage?: boolean;
  onSaveField: (field: string, value: string) => Promise<void>;
  onNavigate: (to: string) => void;
  onRefresh: () => void;
  statusField?: string;
  nounLabel?: string;
  convertLabel?: string;
  convertPath?: (id: string) => string;
  fallbackStages?: string[];
  mode?: "convert" | "close";
  tenantStageOrder?: string[] | null;
  hiddenStages?: Set<string>;
  stageColors?: Record<string, string> | null;
  buttonLabels?: { advance?: string; back?: string; lost?: string; cancel?: string } | null;
  lockedNote?: string | null;
  guidanceTip?: string | null;
  openOverrideSignal?: number;
  openOverrideFocus?: { subFor?: string; addStage?: boolean };
  lockedBase?: boolean;
  schedulePending?: boolean;
  phaseDates?: Record<string, { start: string; end: string }> | null;
  onOpenSchedule?: () => void;
  onFuturePhase?: (stage: string, phase: string, startDay: string) => void;
}) {
  // "cancel" saves per mode (convert → files as "Closed", close → "Cancelled");
  // { custom } confirms a tenant-configured ending stage (e.g. "Declined").
  const [confirming, setConfirming] = useState<null | "lost" | "cancel" | "close" | "archive" | { custom: string }>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideStage, setOverrideStage] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  // Stepper collapse — tenants with many observed statuses (projects can have
  // dozens) show only the configured workflow + the current stage by default.
  const [showAllStages, setShowAllStages] = useState(false);
  // ── PMM title-match check (OPM only, non-blocking) ─────────────────────
  // When this opportunity's name exactly matches an existing PMM project title,
  // show a notice near "Advance to Project". Title alone is a WEAK signal —
  // different jobs legitimately share names ("Renovation", "Holiday") — so we
  // also compare client, business unit, division and lead users where BOTH
  // sides have a value. Only when no comparable field conflicts do we suggest
  // "may already be converted"; a same-name project whose fields differ gets a
  // softer duplicate-title heads-up instead (the create path rejects dup
  // titles, so the user still benefits from knowing early).
  const [matchedPmm, setMatchedPmm] = useState<{ id: string; same: string[]; diff: string[] } | null>(null);
  // "same" = user confirmed the matched project IS this opp's conversion.
  // "different" = user confirmed it is a separate job sharing the name.
  // null = not yet answered (shown only when diff.length === 0).
  const [verifiedSame, setVerifiedSame] = useState<null | "same" | "different">(null);
  // Signature of the compared secondary fields: the effect must recompute when
  // any of them changes (editing the opp's client/BU/division/leads with the
  // title unchanged must refresh the verdict, not show a stale one). Leads are
  // restricted to entries backed by a real *User column (`field` set) — the
  // Project Leads card also synthesizes entries from team-member job titles,
  // and those must NOT vote (a blank lead field is a no-vote, not the team).
  const matchRaw = (project.rawFields ?? {}) as Record<string, unknown>;
  const matchDivSig = String(matchRaw.DivisionName ?? matchRaw.DivisionLookup ?? "");
  const matchLeadsSig = (project.keyPersonnel ?? [])
    .filter(k => k.field)
    .map(k => `${k.guid}|${k.name}`)
    .join(",");
  useEffect(() => {
    // Only relevant for OPM → PMM conversion flow (not leads, not projects).
    // Reset on every non-applicable path so no stale verdict survives.
    if (mode !== "convert" || statusField === "LeadStatus") { setMatchedPmm(null); return; }
    const oppTitle = (project.name ?? "").trim().toLowerCase();
    if (!oppTitle) { setMatchedPmm(null); return; }
    let cancelled = false;
    const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
    void getModuleRecords("PMM").then(({ data }) => {
      if (cancelled) return;
      const titleMatches = data.filter((r) => {
        const t = norm(r.Title ?? r.ShortName);
        return t && t === oppTitle;
      });
      if (titleMatches.length === 0) { setMatchedPmm(null); return; }
      const raw = (project.rawFields ?? {}) as Record<string, unknown>;
      const oppClient = norm(project.company);
      const oppBu = norm(project.bu);
      const oppDiv = norm(raw.DivisionName ?? raw.DivisionLookup);
      // Opp leads: match by GUID or display name (the *User columns store
      // comma lists of either — same tolerance as the Project Leads card).
      // Only *User-backed entries (`field` set) — never team-synthesized ones.
      const oppLeads = new Set(
        (project.keyPersonnel ?? [])
          .filter(k => k.field)
          .flatMap(k => [norm(k.guid), norm(k.name)])
          .filter(Boolean),
      );
      // Comparison + best-candidate logic live in the shared lib (also
      // exercised by the check:same-job script) — never fork the voting rules.
      const oppSide = { client: oppClient, bu: oppBu, division: oppDiv, leads: oppLeads };
      const kpFields = KP_FIELD_ROLES.map(({ field }) => field);
      const best = pickBestSameJobMatch(titleMatches.map((r) => {
        const rec = r as Record<string, unknown>;
        return {
          id: String(rec.TicketId ?? rec.ID ?? ""),
          ...scoreSameJobRaw(oppSide, rec, kpFields),
        };
      }));
      setMatchedPmm(best);
      setVerifiedSame(null); // reset answer whenever the candidate changes
    }).catch(() => { /* non-blocking — ignore errors */ });
    return () => { cancelled = true; };
    // Re-check when the record changes (record-to-record nav reuses the
    // component) AND when any compared field changes — client, BU, division
    // or *User-backed leads — so the verdict never goes stale after an edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.name, project.company, project.bu, matchDivSig, matchLeadsSig, mode, statusField]);
  // ── Stage customization (drag-drop order + custom stages) ──
  // Persisted PER RECORD (tenant + record type + record id): adding a custom
  // status, removing one, or dragging a new order applies to THIS record
  // only — it must never restyle every other record's pipeline (tenant-wide
  // workflows are configured in Settings instead). Stored client-side: the
  // server stage list is data-derived (there is no per-record stage-config
  // store), so ordering is a display preference and a custom stage becomes
  // real data the moment it is saved onto this record.
  // StageCfg + readStageCfg live at MODULE scope — the STATUS detail cell
  // reads the same saved config so the dropdown mirrors this modal.
  const stageCfgKey = tenantScopedKey(`rmone:stageCfg:${statusField}:${project.id}`);
  // Record→record nav REUSES this component instance (ProjectDetail never
  // remounts), so the config is keyed in state and reloaded mid-render when
  // the record changes — otherwise record B would inherit record A's
  // in-memory customization and persist it under B's key on the next write.
  const [stageCfgState, setStageCfgState] = useState<{ key: string; cfg: StageCfg }>(
    () => ({ key: stageCfgKey, cfg: readStageCfg(stageCfgKey) }));
  const stageCfg = stageCfgState.key === stageCfgKey ? stageCfgState.cfg : readStageCfg(stageCfgKey);
  const setStageCfg = (updater: StageCfg | ((prev: StageCfg) => StageCfg)) => {
    setStageCfgState((prev) => {
      const base = prev.key === stageCfgKey ? prev.cfg : readStageCfg(stageCfgKey);
      return { key: stageCfgKey, cfg: typeof updater === "function" ? updater(base) : updater };
    });
  };
  // Local-edit generation counter: bumped on every local save so an in-flight
  // background GET (initial seed or focus refetch) that started BEFORE the
  // edit can never clobber the newer local state with its older response.
  const stageCfgGenRef = useRef(0);
  const persistStageCfg = (next: StageCfg) => {
    stageCfgGenRef.current++;
    setStageCfg(next);
    try { localStorage.setItem(stageCfgKey, JSON.stringify(next)); } catch { /* storage unavailable */ }
    // Sync to server (fire-and-forget) so the config is shared across devices.
    void apiSaveStageCfg(project.id, statusField ?? "Status", next);
    // Let the STATUS dropdown (a sibling component) re-read the config now.
    try { window.dispatchEvent(new CustomEvent(STAGE_CFG_EVENT, { detail: { key: stageCfgKey } })); } catch { /* non-browser env */ }
  };
  // Adopt EXTERNAL cfg writes for this record (typed STATUS-cell customs
  // persist via ProjectDetail's queue and only touch localStorage + this
  // event). Without this, our React-state copy goes stale and the next
  // footer edit would save the whole document WITHOUT the new custom —
  // silently wiping it. Self-dispatched events are harmless: localStorage
  // already holds what we just wrote, so re-adopting is a no-op.
  useEffect(() => {
    const onExternalCfgWrite = (e: Event) => {
      if ((e as CustomEvent).detail?.key !== stageCfgKey) return;
      // Join the local-edit generation guard so an in-flight background
      // seed launched before this write can't clobber the adopted copy.
      stageCfgGenRef.current++;
      setStageCfg(readStageCfg(stageCfgKey));
    };
    window.addEventListener(STAGE_CFG_EVENT, onExternalCfgWrite);
    return () => window.removeEventListener(STAGE_CFG_EVENT, onExternalCfgWrite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageCfgKey]);
  // ── Server seed: load the canonical config on record change ──────────────
  // Fetches the server-stored StageCfg when the record changes and seeds both
  // localStorage (the optimistic write-through cache) and React state. This
  // ensures a user who saved customizations on another device sees them here.
  // The fetch is background-only and never blocks the initial render; the
  // localStorage seed already provided the instant read on mount.
  // ALSO re-fetches on window focus while the record stays open: two users
  // with the same record open converge without a reopen (one small GET per
  // focus, throttled so tab-flipping doesn't hammer the endpoint).
  useEffect(() => {
    let cancelled = false;
    const keyAtLaunch = stageCfgKey;
    const refresh = (migrateLocal: boolean) => {
      const genAtLaunch = stageCfgGenRef.current;
      void apiGetStageCfg(project.id, statusField ?? "Status").then((serverCfg) => {
        if (cancelled) return; // record changed while fetch was in-flight
        // A local edit landed while this GET was in flight — its response is
        // older than the user's state; drop it (the edit's PUT is canonical).
        if (stageCfgGenRef.current !== genAtLaunch) return;
        if (!serverCfg) {
          // No server config yet: if this browser has a non-empty local one
          // (pre-sync sessions), push it up once so it migrates to all devices.
          if (!migrateLocal) return;
          const local = readStageCfg(keyAtLaunch);
          if (local.order.length || local.custom.length || local.removed.length ||
              Object.values(local.subStatuses ?? {}).some((a) => a.length > 0)) {
            void apiSaveStageCfg(project.id, statusField ?? "Status", local);
          }
          return;
        }
        // Validate minimal shape before trusting server data.
        const c = serverCfg as Record<string, unknown>;
        if (!Array.isArray(c.order) || !Array.isArray(c.custom)) return;
        const next: StageCfg = {
          order:  (c.order as unknown[]).map(String),
          custom: (c.custom as unknown[]).map(String),
          removed: Array.isArray(c.removed) ? (c.removed as unknown[]).map(String) : [],
          subStatuses: (() => {
            const sub: Record<string, string[]> = {};
            if (c.subStatuses && typeof c.subStatuses === "object" && !Array.isArray(c.subStatuses)) {
              for (const [k, v] of Object.entries(c.subStatuses as Record<string, unknown>)) {
                if (Array.isArray(v)) sub[k] = (v as unknown[]).map(String);
              }
            }
            return sub;
          })(),
        };
        // Did this refetch actually CHANGE the config vs what's rendered?
        // Compare against the normalized localStorage copy (write-through keeps
        // it in lockstep with React state) so a no-op response stays silent.
        const changed = JSON.stringify(readStageCfg(keyAtLaunch)) !== JSON.stringify(next);
        // Write-through: keep localStorage in sync with the server's canonical value.
        try { localStorage.setItem(keyAtLaunch, JSON.stringify(next)); } catch { /* unavailable */ }
        // Focus refetch changed the list mid-session — a teammate saved edits
        // while this tab was open. A brief note explains the visible change so
        // it doesn't feel like a glitch. (Initial seed stays silent: that's a
        // normal load, not a mid-session change.)
        if (!migrateLocal && changed) {
          toast({ title: "Status list updated", description: "Status list updated by a teammate." });
        }
        // Only update React state if the key still matches (no record switch mid-flight).
        setStageCfgState((prev) => prev.key === keyAtLaunch ? { key: keyAtLaunch, cfg: next } : prev);
        // Notify the STATUS dropdown sibling so it re-reads the freshly seeded config.
        try { window.dispatchEvent(new CustomEvent(STAGE_CFG_EVENT, { detail: { key: keyAtLaunch } })); } catch { /* non-browser env */ }
      });
    };
    refresh(true); // initial seed — the only trigger allowed to migrate local up
    // Focus refetch: min 15s between fetches so rapid tab switches stay cheap.
    let lastFetch = Date.now();
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastFetch < 15_000) return;
      lastFetch = Date.now();
      refresh(false);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, statusField]);
  // Mirrors the rendered stageCfg for non-drag persistence fallbacks.
  const stageCfgRef = useRef(stageCfg);
  stageCfgRef.current = stageCfg;
  // Drag state is identity-based (stage NAME, not row index): rapid dragOver
  // events can outrun React commits, and a lagging re-render must never
  // misroute an index. dragName drives row styling; dragNameRef carries the
  // in-flight drag synchronously between events.
  const [dragName, setDragName] = useState<string | null>(null);
  const dragNameRef = useRef<string | null>(null);
  // The exact computed order of the in-flight drag, updated synchronously on
  // every move — the render-time stageCfgRef can lag the last dragOver, so
  // drag end persists THIS (key-guarded against record switches mid-drag).
  const liveDragCfgRef = useRef<{ key: string; cfg: StageCfg } | null>(null);
  const [addingStage, setAddingStage] = useState(false);
  const [newStage, setNewStage] = useState("");
  // Sub-status management: which locked phase is currently accepting a new
  // sub-status entry, and the typed name.
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);
  const [newSubStage, setNewSubStage] = useState("");
  const addSubStatus = (parentPhase: string, name: string) => {
    const nm = name.trim(); if (!nm) return;
    const pk = parentPhase.trim().toLowerCase();
    const nk = nm.toLowerCase();
    // Global uniqueness (case-insensitive): a sub-status may not duplicate a
    // phase, a custom status, or a sub under ANY phase — the dropdown renders
    // one flat list keyed by the string, and injectSubStatuses would drop the
    // colliding entry at render, making the add look like a silent failure.
    // (baseStages/stageCfg are read at call time — event handlers only.)
    const subsAll = stageCfg.subStatuses ?? {};
    const clashes = baseStages.some((s) => s.trim().toLowerCase() === nk)
      || stageCfg.custom.some((s) => s.trim().toLowerCase() === nk)
      || Object.values(subsAll).some((arr) => arr.some((s) => s.trim().toLowerCase() === nk));
    if (clashes) { setNewSubStage(""); setAddingSubFor(null); return; }
    persistStageCfg({ ...stageCfg, subStatuses: { ...subsAll, [pk]: [...(subsAll[pk] ?? []), nm] } });
    setNewSubStage(""); setAddingSubFor(null);
  };
  const removeSubStatus = (parentPhase: string, name: string) => {
    const pk = parentPhase.trim().toLowerCase();
    const existing = stageCfg.subStatuses?.[pk] ?? [];
    persistStageCfg({ ...stageCfg, subStatuses: { ...(stageCfg.subStatuses ?? {}), [pk]: existing.filter((s) => s.trim().toLowerCase() !== name.trim().toLowerCase()) } });
    if (overrideStage.trim().toLowerCase() === name.trim().toLowerCase()) setOverrideStage("");
  };
  // The STATUS dropdown's "Customize this list…" action row bumps a page-
  // level signal; each NEW bump opens the Override Status modal from here
  // (same entry as the stepper's own Override link — one editor, not two).
  const lastOverrideSignalRef = useRef(0);
  useEffect(() => {
    if (openOverrideSignal > lastOverrideSignalRef.current) {
      lastOverrideSignalRef.current = openOverrideSignal;
      setOverrideStage("");
      // Focused entry: land straight in the requested input — a phase's
      // sub-status field ("+ Sub" pill on a dropdown row) or the add-status
      // field ("+ Add statuses…") — instead of a bare list to hunt through.
      setAddingSubFor(openOverrideFocus?.subFor ?? null);
      setNewSubStage("");
      setAddingStage(!!openOverrideFocus?.addStage);
      setNewStage("");
      setOverrideOpen(true);
    }
  }, [openOverrideSignal, openOverrideFocus]);
  // Record changed under this reused instance: reload the new record's saved
  // config and drop ALL record-local interaction state, so record B never
  // inherits A's modal selection, drag state, or draft input.
  if (stageCfgState.key !== stageCfgKey) {
    setStageCfgState({ key: stageCfgKey, cfg: stageCfg });
    setOverrideOpen(false);
    setOverrideStage("");
    setConfirming(null);
    setShowAllStages(false);
    setAddingStage(false);
    setNewStage("");
    setAddingSubFor(null);
    setNewSubStage("");
    setSaveError("");
    setDragName(null);
    dragNameRef.current = null;
    liveDragCfgRef.current = null;
  }
  const { toast } = useToast();
  // In dark mode the translucent tinted cards read well against the dark
  // panel; in light mode those same translucent fills look washed-out next
  // to the solid green "To Project" button. Light mode therefore uses solid,
  // saturated fills with white text (matching the To Project button's look)
  // while dark mode keeps its existing styling untouched.
  const { mode: themeMode } = useTheme();
  const isLight = themeMode === "light";

  const raw = project.rawFields ?? {};
  const currentStage = statusField === "CRMOpportunityStatusChoice"
    // Same column fallback chain as the server's stage-rules evaluation
    // (CRMOpportunityStatusChoice → CRMOpportunityStageChoice → Status).
    ? String(raw.CRMOpportunityStatusChoice || raw.CRMOpportunityStageChoice || raw.Status || "")
    : statusField === "CRMProjectStatusChoice"
      // Projects: the edit-save writes CRMProjectStatusChoice but many
      // tenants' rows carry the value in Status — same fallback chain as the
      // projects grid; the derived display status covers auto-closed rows.
      ? String(raw.CRMProjectStatusChoice || raw.Status
          || (project.status && project.status !== "—" ? project.status : "") || "")
      : String(raw[statusField] ?? "");
  // Use loaded options when available; fall back to hardcoded defaults so the
  // modal and action buttons always work even before the fetch resolves or when
  // no stages are configured in Settings.
  const baseStages = opmStageOptions.length > 0 ? opmStageOptions : fallbackStages;
  // Locked-base mode: base entries are schedule phases (dated) — fixed order,
  // no drag/remove; only the user's own custom statuses stay editable.
  const lockedKeys = lockedBase ? new Set(baseStages.map((s) => s.trim().toLowerCase())) : null;
  const isLockedStage = (s: string) => !!lockedKeys && lockedKeys.has(s.trim().toLowerCase());
  // Apply the user's saved customization: saved drag-drop order first (dropping
  // stages that no longer exist), then any new server-side stages appended, so
  // "Advance" and the Override modal both follow the customized sequence.
  // All matching is case-insensitive with server casing preferred, so a saved
  // custom "won" never duplicates a later server-derived "Won".
  const mergedStages: string[] = [];
  const seenStage = new Set<string>();
  // Admin-removed statuses are hidden everywhere (list, Advance/Go Back)
  // EXCEPT when the record currently sits on one — the current status must
  // stay visible or the modal would show a phantom "Current" value.
  const removedSet = new Set(stageCfg.removed.map((s) => s.trim().toLowerCase()));
  const curStageKey = currentStage.trim().toLowerCase();
  // Conversion sentinels ("Closed – Won" for opps, "Converted" for leads) are
  // stamped ONLY by the To Project / To Opportunity flow. The live stage list
  // now scrapes record values, so converted records leak the sentinel into it —
  // it must never be an Advance/Override target (that would mark a record as
  // converted without creating the downstream record). Visible only when the
  // record already sits on it (so the modal never shows a phantom "Current").
  const isConvertSentinel = (s: string) => {
    const n = s.trim().toLowerCase().replace(/\u2013/g, "-");
    return n === "closed - won" || n === "converted";
  };
  for (const s of [...baseStages, ...stageCfg.custom]) {
    const k = s ? s.trim().toLowerCase() : "";
    if (!k || seenStage.has(k)) continue;
    if (removedSet.has(k) && k !== curStageKey && !(lockedKeys && lockedKeys.has(k))) continue;
    // Company stage-skip rules: stages this record skips (e.g. "Federal
    // projects skip Contract Negotiations") vanish from the bar and from
    // Advance/Override — but the current stage always stays visible.
    if (hiddenStages?.has(k) && k !== curStageKey) continue;
    if (isConvertSentinel(s) && k !== curStageKey) continue;
    seenStage.add(k); mergedStages.push(s);
  }
  const canonStage = new Map(mergedStages.map((s) => [s.trim().toLowerCase(), s]));
  const effectiveStages: string[] = [];
  if (lockedKeys) {
    // Locked base: phases first, in SCHEDULE order — cfg.order entries naming
    // phases are ignored (the schedule owns their sequence); the user's
    // custom statuses follow in their dragged order.
    for (const s of mergedStages) if (lockedKeys.has(s.trim().toLowerCase())) effectiveStages.push(s);
  }
  for (const o of stageCfg.order) {
    const c = canonStage.get(o.trim().toLowerCase());
    if (c && !effectiveStages.includes(c)) effectiveStages.push(c);
  }
  for (const s of mergedStages) if (!effectiveStages.includes(s)) effectiveStages.push(s);
  // Negative terminal statuses (Lost, Closed, Archived, …) are outcomes, not
  // pipeline steps — they have dedicated buttons and must never be Advance targets.
  const NEGATIVE_TERMINAL = new Set(["lost", "closed", "cancelled", "cancel", "declined", "archived"]);
  // Close-mode (projects): any closed-ish status counts as a terminal too —
  // the grids treat closed/complete/closeout as "in the Closed library", so
  // Advance must never silently archive the project; the dedicated Close
  // Project button (with its confirm step) owns that move.
  const isTerminalStage = (s: string) => {
    const k = s.trim().toLowerCase();
    if (NEGATIVE_TERMINAL.has(k)) return true;
    return mode === "close" && /closed|complete|closeout/i.test(k);
  };
  // ── Config-driven ending buttons: ending names the admin added to the
  // workflow list (Settings → Stage Rules) surface as real buttons here, so
  // the stage list and the record page act as one system. Built-ins never
  // disappear: opps/leads always keep Lost + Cancel, projects always keep
  // Cancel + Close Project. Only names RM ONE recognizes as endings classify
  // (NEGATIVE_TERMINAL — "Awarded" is a path step, not an ending).
  const cfgEndingNames = (tenantStageOrder ?? []).filter((s) => NEGATIVE_TERMINAL.has(s.trim().toLowerCase()));
  const cfgHasLost = cfgEndingNames.some((s) => s.trim().toLowerCase() === "lost");
  // Endings already owned by a dedicated button dedupe away: lost → Lost,
  // cancel/cancelled → Cancel, closed* → Close/green, archived → the lead
  // Archive flow. What remains (e.g. "Declined") renders as its own button.
  const OWNED_ENDINGS = new Set(["lost", "cancel", "cancelled", "canceled", "archived"]);
  const seenCfgEnd = new Set<string>();
  const cfgExtraEndings = cfgEndingNames.filter((s) => {
    const k = s.trim().toLowerCase();
    if (OWNED_ENDINGS.has(k) || k.startsWith("closed") || seenCfgEnd.has(k)) return false;
    seenCfgEnd.add(k);
    return true;
  });
  // Default ordering when the user hasn't dragged a custom order yet: the
  // server-derived list is often ALPHABETICAL (e.g. Awarded, Contract
  // Negotiations, Lost, Pending Assignment, …), which numbers the Override
  // modal nonsensically and breaks Advance/Go Back sequencing. Known names
  // follow the canonical pipeline sequence; unknown ones keep their server
  // order after those; negative terminals always sink to the end.
  if (stageCfg.order.length === 0 && !lockedKeys) {
    // The tenant's configured stage order (Settings → "Opportunity stage
    // set") is authoritative when present; the hardcoded canonical list is
    // only the no-config fallback.
    const baseOrder = tenantStageOrder && tenantStageOrder.length > 0 ? tenantStageOrder : fallbackStages;
    const canonIdx = (s: string) => {
      const i = baseOrder.findIndex((f) => f.trim().toLowerCase() === s.trim().toLowerCase());
      return i === -1 ? baseOrder.length : i;
    };
    effectiveStages.sort((a, b) => {
      const at = isTerminalStage(a) ? 1 : 0;
      const bt = isTerminalStage(b) ? 1 : 0;
      if (at !== bt) return at - bt;
      return canonIdx(a) - canonIdx(b);
    });
  }
  // Advance / Go Back walk the FORWARD pipeline only — terminals excluded.
  const navStages = effectiveStages.filter((s) => !isTerminalStage(s));
  // Expand nav to include sub-statuses in position (each phase is immediately
  // followed by its subs). This lets Advance/Go Back step through sub-statuses
  // rather than skipping over them to the next main phase.
  const expandedNavStages = navStages.flatMap((stage) => {
    const k = stage.trim().toLowerCase();
    const subs: string[] = [];
    if (lockedBase) {
      for (const [p, list] of Object.entries(stageCfg.subStatuses ?? {})) {
        if (p.trim().toLowerCase() === k && Array.isArray(list)) { subs.push(...list); break; }
      }
    }
    return [stage, ...subs];
  });
  // subParentStage: when the current status IS a sub, identifies the parent
  // phase for bar-positioning and the "currently in" label in the bar header.
  const subParentStage = (() => {
    for (const [parent, list] of Object.entries(stageCfg.subStatuses ?? {})) {
      if ((list as string[]).some((s) => s.trim().toLowerCase() === curStageKey)) {
        return canonStage.get(parent.trim().toLowerCase()) ?? null;
      }
    }
    return null;
  })();
  // Navigation index uses the expanded list so subs are reachable steps.
  const currentIdx = expandedNavStages.findIndex((s) => s.trim().toLowerCase() === curStageKey);
  // Converted records must never move backward: the created downstream record
  // (project / opportunity) is independent and would NOT be removed, leaving a
  // live project whose opp looks like it's still in the pipeline. The opp
  // sentinel is "Closed – Won" (en-dash — normalize dashes for the compare
  // only, never for writes); the lead sentinel is "Converted".
  const curNorm = currentStage.trim().toLowerCase().replace(/\u2013/g, "-");
  const isConverted = curNorm === "closed - won" || curNorm === "converted";
  // Legacy stage (#173): the record's current stage isn't in the viewer's
  // workflow at all — typically because the record was created under an
  // older/other workflow before a group-scoped template (Stage Rules →
  // Save As…) replaced the stage list this viewer sees. The stage bar marks
  // it explicitly (amber "legacy" pill) and Advance moves the record onto the
  // viewer's workflow's FIRST stage; Go Back stays unavailable (a legacy
  // stage has no position, so there is no "before").
  const isLegacyStage = currentIdx === -1 && !!currentStage
    && !isConverted && !isTerminalStage(currentStage);
  const nextStage = currentIdx >= 0 && currentIdx < expandedNavStages.length - 1
    ? expandedNavStages[currentIdx + 1]
    : isLegacyStage && expandedNavStages.length > 0 ? expandedNavStages[0] : null;
  const prevStage = currentIdx > 0 ? expandedNavStages[currentIdx - 1] : null;
  // Close-mode terminal state: the project already sits on a closed-ish (or
  // cancelled) status, so Close Project / Cancel grey out (Override re-opens).
  const isClosedish = isClosedishStatus(currentStage);

  // During a drag, reorders update state for the live preview while
  // liveDragCfgRef tracks the exact computed order synchronously — each move
  // rebases on the ref (seeded from the rendered order at drag start), never
  // on a possibly-stale render's effectiveStages, and matches by stage NAME
  // (unique within the list) so lagging commits can't misroute an index.
  const moveStageByName = (name: string, targetName: string) => {
    // Schedule phases never move — their order comes from the schedule dates.
    if (isLockedStage(name) || isLockedStage(targetName)) return;
    const live = liveDragCfgRef.current;
    const cur = live && live.key === stageCfgKey ? live.cfg.order : [...effectiveStages];
    const fromIdx = cur.indexOf(name);
    const toIdx = cur.indexOf(targetName);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const next = [...cur];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, name);
    const cfg: StageCfg = { ...(live && live.key === stageCfgKey ? live.cfg : stageCfg), order: next };
    liveDragCfgRef.current = { key: stageCfgKey, cfg };
    setStageCfg(cfg);
  };
  const removeStage = (name: string) => {
    // Schedule phases can't be removed here — edit the schedule instead.
    if (isLockedStage(name)) return;
    const k = name.trim().toLowerCase();
    // Same guard as the render's isCustom: a re-added server status lands in
    // stageCfg.custom too, but it is NOT custom — removing it must go through
    // the removed-list or it reappears (still present in baseStages).
    const isCustomStage = stageCfg.custom.some((c) => c.trim().toLowerCase() === k)
      && !baseStages.some((b) => b.trim().toLowerCase() === k);
    persistStageCfg({
      order: stageCfg.order.filter((s) => s.trim().toLowerCase() !== k),
      custom: stageCfg.custom.filter((s) => s.trim().toLowerCase() !== k),
      // Server-derived statuses can't be deleted from the data source (the
      // list is derived from live records), so admin removal HIDES them via a
      // persisted removed-list instead; custom ones are simply dropped.
      removed: isCustomStage
        ? stageCfg.removed
        : [...stageCfg.removed.filter((s) => s.trim().toLowerCase() !== k), name],
      // Sub-statuses always survive top-level edits — omitting this field
      // would silently wipe every phase's sub-statuses on the next read.
      subStatuses: stageCfg.subStatuses,
    });
    if (overrideStage.trim().toLowerCase() === k) setOverrideStage("");
  };
  const addCustomStage = () => {
    const name = newStage.trim();
    if (!name) return;
    const k = name.toLowerCase();
    // Re-adding a previously removed status restores it instead of duplicating.
    const restoredRemoved = stageCfg.removed.filter((s) => s.trim().toLowerCase() !== k);
    const existing = effectiveStages.find((s) => s.toLowerCase() === k);
    if (!existing) {
      persistStageCfg({ order: [...effectiveStages, name], custom: [...stageCfg.custom, name], removed: restoredRemoved, subStatuses: stageCfg.subStatuses });
    } else if (restoredRemoved.length !== stageCfg.removed.length) {
      persistStageCfg({ ...stageCfg, removed: restoredRemoved });
    }
    // Pre-select the (new or already-existing) stage so "Set Stage" is one click away.
    setOverrideStage(existing ?? name);
    setNewStage("");
    setAddingStage(false);
  };

  // Central save for every lifecycle action (Advance / Go Back / Lost /
  // Cancel / Override). Success feedback is a toast passed by the caller so
  // silent one-click actions (Advance, Go Back) visibly confirm; failures
  // ALWAYS surface — inline in the Override modal, as an error toast for the
  // one-click buttons (which have no other place to show an error message).
  // Returns success so callers only advance their own UI on a real save.
  // Sub-statuses configured under a given phase (Override Status modal) —
  // rendered as nested chips after their parent pill in locked-base mode.
  const subsOfStage = (stage: string): string[] => {
    if (!lockedBase) return [];
    const k = stage.trim().toLowerCase();
    for (const [p, subs] of Object.entries(stageCfg.subStatuses ?? {})) {
      if (p.trim().toLowerCase() === k && Array.isArray(subs)) return subs;
    }
    return [];
  };
  const doSave = async (value: string, okTitle?: string, okDesc?: string): Promise<boolean> => {
    // "Scheduled for later" gate: while the schedule drives the status list,
    // a phase (or a sub-status of one) whose start day hasn't arrived is not
    // saveable — the parent shows the explainer popup with the jump to the
    // schedule card (status follows the schedule week; the fix is moving the
    // dates, not relabeling the record). Terminal outcomes (Lost/Cancelled/
    // Closed) and custom statuses are never date-gated.
    if (lockedBase) {
      const gate = futurePhaseGate(value, opmStageOptions, phaseDates, stageCfg.subStatuses, currentStage);
      if (gate) {
        onFuturePhase?.(value, gate.phase, gate.startDay);
        return false;
      }
    }
    setSaving(true);
    setSaveError("");
    try {
      await onSaveField(statusField, value);
      // Close the modal BEFORE firing the background reload.
      // Doing this in a .then() chain risks the reload re-mounting this
      // component first, which would make setOverrideOpen a no-op on the
      // old instance and leave the modal visually open.
      setOverrideOpen(false);
      if (okTitle) toast({ title: okTitle, description: okDesc });
      onRefresh();
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not save status";
      setSaveError(msg);
      // The inline saveError banner renders only inside the Override modal —
      // when the save came from a footer button, toast the failure instead.
      if (!overrideOpen) {
        toast({ title: "Status not changed", description: msg, variant: "destructive" });
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Stage-permission lock (#87) blankets EVERY action: buttons stay visible
  // but disabled, with the plain-language reason on hover.
  const permLocked = !!lockedNote;
  const actionCard = (
    color: string, bg: string, border: string,
    onClick: () => void, disabled: boolean,
    children: React.ReactNode,
    disabledTitle?: string,
  ): React.ReactNode => (
    <button
      type="button"
      onClick={permLocked ? undefined : onClick}
      disabled={disabled || permLocked}
      title={permLocked ? (lockedNote ?? undefined) : disabled && disabledTitle ? disabledTitle : undefined}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 6, padding: "12px 14px", borderRadius: 12,
        backgroundColor: bg, border: `1px solid ${border}`,
        color, fontSize: 12, fontWeight: 700,
        cursor: disabled || permLocked ? "not-allowed" : "pointer",
        opacity: disabled || permLocked ? 0.45 : 1, minWidth: 90, flex: 1,
        transition: "opacity 0.15s",
        boxShadow: isLight ? "0 2px 8px rgba(15,23,42,0.14)" : undefined,
      }}
    >{children}</button>
  );

  /* ── Stage Override Modal (portal — renders outside button tree) ── */
  const stageModal = overrideOpen && createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Override ${nounLabel} status`}
      style={{
        position: "fixed", inset: 0, zIndex: Z.POPUP,
        display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.60)", backdropFilter: "blur(4px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) setOverrideOpen(false); }}
    >
      <div style={{
        width: "min(440px, calc(100vw - 32px))",
        backgroundColor: "var(--rm-card, #1E2530)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 16, overflow: "hidden",
        boxShadow: "0 24px 64px rgba(0,0,0,0.60)",
      }}>
        {/* Header */}
        <div style={{
          padding: "18px 20px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--rm-text, #F1F5F9)" }}>
              Override Status
            </div>
            {currentStage && (
              <div style={{ fontSize: 12, color: "var(--rm-text-muted, #94A3B8)", marginTop: 3 }}>
                Current:{" "}
                {subParentStage && subParentStage !== currentStage ? (
                  <>
                    <span style={{ color: "var(--rm-text-muted, #94A3B8)" }}>{subParentStage}</span>
                    <span style={{ color: "var(--rm-text-muted, #94A3B8)", margin: "0 4px" }}>›</span>
                    <span style={{ color: ACCENT_PURPLE, fontWeight: 600 }}>{currentStage}</span>
                  </>
                ) : (
                  <span style={{ color: ACCENT_PURPLE, fontWeight: 600 }}>{currentStage}</span>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOverrideOpen(false)}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: 8,
              color: "var(--rm-text-muted, #94A3B8)", display: "flex", alignItems: "center",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Stage options — capped height so long stage lists scroll instead of
            pushing the modal footer off-screen. */}
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8, maxHeight: "min(52vh, 460px)", overflowY: "auto" }}>
          {effectiveStages.map((s, idx) => {
            const isCurrent = s === currentStage;
            const isSelected = s === overrideStage;
            // Custom (user-added) statuses can be removed by anyone; admins
            // can remove ANY status (server-derived ones are hidden via the
            // persisted removed-list). The record's current status can never
            // be removed, and the list is never emptied below one entry.
            const isCustom = stageCfg.custom.some((c) => c.trim().toLowerCase() === s.trim().toLowerCase())
              && !baseStages.some((b) => b.trim().toLowerCase() === s.trim().toLowerCase());
            // Schedule phases (locked base) can't be dragged or removed —
            // they carry the schedule's start/end dates, so rearranging or
            // deleting them happens in the Project Schedule card. Only
            // manually-added custom statuses stay fully editable.
            const isLockedRow = isLockedStage(s);
            const canRemove = !isCurrent && !isLockedRow && (isCustom || canRemoveAnyStage) && effectiveStages.length > 1;
            // Sub-statuses stored under this phase (locked rows only)
            const phaseSubs = isLockedRow ? (stageCfg.subStatuses?.[s.trim().toLowerCase()] ?? []) : [];
            const isAddingSubHere = addingSubFor === s;
            return (
              <Fragment key={s}>
                <button
                  type="button"
                  onClick={() => setOverrideStage(s === overrideStage ? "" : s)}
                  title={isLockedRow ? "Schedule phase — fixed dates; use + to add sub-statuses" : undefined}
                  draggable={!saving && !isLockedRow}
                  onDragStart={(e) => {
                    if (isLockedRow) { e.preventDefault(); return; }
                    dragNameRef.current = s;
                    // Seed the live ref with the fully-resolved rendered order
                    // so every move in this drag rebases on exact state.
                    liveDragCfgRef.current = { key: stageCfgKey, cfg: { ...stageCfgRef.current, order: [...effectiveStages] } };
                    setDragName(s);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    // Live reorder: as the dragged row hovers another row they
                    // swap positions immediately, so the list previews its final
                    // order during the drag (persisted once on drag end).
                    e.preventDefault();
                    const dn = dragNameRef.current;
                    if (!dn || dn === s) return;
                    moveStageByName(dn, s);
                  }}
                  onDragEnd={() => {
                    // Persist the exact final computed order from the live ref —
                    // the render-time stageCfgRef can lag the last dragOver's
                    // commit. Key guard: a record switch mid-drag falls back to
                    // the NEW record's own (untouched) config, never stale drag.
                    const live = liveDragCfgRef.current;
                    dragNameRef.current = null;
                    liveDragCfgRef.current = null;
                    setDragName(null);
                    const cfg = live && live.key === stageCfgKey ? live.cfg : stageCfgRef.current;
                    // Join the local-edit generation guard: a background GET
                    // in flight during the drag must not clobber this reorder.
                    stageCfgGenRef.current++;
                    try { localStorage.setItem(stageCfgKey, JSON.stringify(cfg)); } catch { /* storage unavailable */ }
                    // Sync drag-reorder to server (fire-and-forget).
                    void apiSaveStageCfg(project.id, statusField ?? "Status", cfg);
                    try { window.dispatchEvent(new CustomEvent(STAGE_CFG_EVENT, { detail: { key: stageCfgKey } })); } catch { /* non-browser env */ }
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "11px 14px", borderRadius: 10, textAlign: "left",
                    border: isSelected
                      ? `1px solid ${ACCENT_PURPLE}`
                      : "1px solid rgba(255,255,255,0.08)",
                    backgroundColor: isSelected
                      ? `${ACCENT_PURPLE}18`
                      : isCurrent
                        ? "rgba(255,255,255,0.04)"
                        : "transparent",
                    cursor: "pointer",
                    transition: "all 0.15s",
                    opacity: dragName === s ? 0.45 : 1,
                  }}
                >
                  {/* Drag handle — hidden for schedule phases (fixed order) */}
                  {isLockedRow
                    ? <span style={{ width: 14, flexShrink: 0 }} />
                    : <GripVertical size={14} style={{ color: "var(--rm-text-muted, #94A3B8)", flexShrink: 0, cursor: "grab" }} />}
                  {/* Step number */}
                  <span style={{
                    width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700,
                    backgroundColor: isSelected ? ACCENT_PURPLE : isCurrent ? "rgba(167,139,250,0.25)" : "rgba(255,255,255,0.08)",
                    color: isSelected ? "#FFF" : isCurrent ? ACCENT_PURPLE : "var(--rm-text-muted, #94A3B8)",
                  }}>
                    {idx + 1}
                  </span>
                  <span style={{
                    flex: 1, fontSize: 13, fontWeight: isCurrent || isSelected ? 600 : 400,
                    color: isSelected ? ACCENT_PURPLE : "var(--rm-text, #F1F5F9)",
                  }}>
                    {s}
                    {phaseSubs.length > 0 && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: "var(--rm-text-muted, #94A3B8)" }}>
                        ({phaseSubs.length})
                      </span>
                    )}
                  </span>
                  {isCurrent && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
                      padding: "2px 8px", borderRadius: 20,
                      backgroundColor: "rgba(167,139,250,0.15)", color: ACCENT_PURPLE,
                    }}>
                      CURRENT
                    </span>
                  )}
                  {isSelected && !isCurrent && (
                    <CheckCircle size={15} style={{ color: ACCENT_PURPLE, flexShrink: 0 }} />
                  )}
                  {/* "+ Sub" pill — labeled so nobody has to select the row
                      first to discover it; span avoids nesting <button> in <button> */}
                  {isLockedRow && !saving && (
                    <span
                      role="button"
                      title="Add a sub-status under this phase"
                      onClick={(e) => { e.stopPropagation(); setAddingSubFor(isAddingSubHere ? null : s); setNewSubStage(""); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 3, flexShrink: 0,
                        padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                        color: isAddingSubHere ? "#FFF" : ACCENT_PURPLE,
                        backgroundColor: isAddingSubHere ? ACCENT_PURPLE : "rgba(167,139,250,0.12)",
                        border: `1px solid ${ACCENT_PURPLE}33`,
                        cursor: "pointer",
                      }}
                    >
                      <Plus size={11} /> Sub
                    </span>
                  )}
                  {canRemove && (
                    // span, not <button>: nesting a button inside the row button
                    // would be invalid HTML and break click handling.
                    <span
                      role="button"
                      title="Remove status"
                      onClick={(e) => { e.stopPropagation(); removeStage(s); }}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                        color: "var(--rm-text-muted, #94A3B8)", cursor: "pointer",
                      }}
                    >
                      <X size={13} />
                    </span>
                  )}
                </button>

                {/* Sub-status rows — indented under this phase */}
                {phaseSubs.map((sub) => {
                  const isSubCurrent = sub === currentStage;
                  const isSubSel = sub === overrideStage;
                  return (
                    <button
                      key={`${s}__${sub}`}
                      type="button"
                      onClick={() => setOverrideStage(sub === overrideStage ? "" : sub)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 14px 6px 46px", borderRadius: 8, textAlign: "left",
                        border: isSubSel ? `1px solid ${ACCENT_PURPLE}66` : "1px solid transparent",
                        backgroundColor: isSubSel ? `${ACCENT_PURPLE}10` : isSubCurrent ? "rgba(255,255,255,0.025)" : "transparent",
                        cursor: "pointer", transition: "all 0.12s",
                      }}
                    >
                      <span style={{ fontSize: 10, color: "var(--rm-text-muted, #94A3B8)", flexShrink: 0 }}>└</span>
                      <span style={{
                        flex: 1, fontSize: 12,
                        fontWeight: isSubCurrent || isSubSel ? 600 : 400,
                        color: isSubSel ? ACCENT_PURPLE : "var(--rm-text-muted, #94A3B8)",
                      }}>
                        {sub}
                      </span>
                      {isSubCurrent && (
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 20, backgroundColor: "rgba(167,139,250,0.15)", color: ACCENT_PURPLE }}>
                          CURRENT
                        </span>
                      )}
                      {isSubSel && !isSubCurrent && <CheckCircle size={13} style={{ color: ACCENT_PURPLE, flexShrink: 0 }} />}
                      <span
                        role="button"
                        title="Remove sub-status"
                        onClick={(e) => { e.stopPropagation(); removeSubStatus(s, sub); }}
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: 5, flexShrink: 0, color: "var(--rm-text-muted, #94A3B8)", cursor: "pointer" }}
                      >
                        <X size={11} />
                      </span>
                    </button>
                  );
                })}

                {/* Inline input to type a new sub-status for this phase */}
                {isAddingSubHere && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", paddingLeft: 42, paddingBottom: 4 }}>
                    <input
                      autoFocus
                      value={newSubStage}
                      onChange={(e) => setNewSubStage(e.target.value)}
                      placeholder={`Sub-status under "${s}"…`}
                      disabled={saving}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); addSubStatus(s, newSubStage); }
                        if (e.key === "Escape") { setAddingSubFor(null); setNewSubStage(""); }
                      }}
                      style={{
                        flex: 1, minWidth: 0, padding: "7px 10px", borderRadius: 8, fontSize: 12,
                        border: `1px solid ${ACCENT_PURPLE}66`, backgroundColor: "rgba(255,255,255,0.05)",
                        color: "var(--rm-text, #F1F5F9)", outline: "none",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => addSubStatus(s, newSubStage)}
                      disabled={saving || !newSubStage.trim()}
                      style={{ padding: "6px 12px", borderRadius: 7, fontSize: 11, fontWeight: 700, border: "none", backgroundColor: ACCENT_PURPLE, color: "#FFF", opacity: !newSubStage.trim() ? 0.5 : 1, cursor: !newSubStage.trim() ? "default" : "pointer" }}
                    >Add</button>
                    <button
                      type="button"
                      onClick={() => { setAddingSubFor(null); setNewSubStage(""); }}
                      disabled={saving}
                      style={{ padding: 5, borderRadius: 7, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "var(--rm-text-muted, #94A3B8)", cursor: "pointer", display: "flex", alignItems: "center" }}
                    ><X size={13} /></button>
                  </div>
                )}
              </Fragment>
            );
          })}

          {/* Add custom stage */}
          {addingStage ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                autoFocus
                value={newStage}
                onChange={(e) => setNewStage(e.target.value)}
                placeholder="New status name…"
                disabled={saving}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addCustomStage(); }
                  if (e.key === "Escape") { setAddingStage(false); setNewStage(""); }
                }}
                style={{
                  flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 10, fontSize: 13,
                  border: `1px solid ${ACCENT_PURPLE}66`, backgroundColor: "rgba(255,255,255,0.05)",
                  color: "var(--rm-text, #F1F5F9)", outline: "none",
                }}
              />
              <button
                type="button"
                onClick={addCustomStage}
                disabled={saving || !newStage.trim()}
                style={{
                  padding: "9px 16px", borderRadius: 9, fontSize: 12, fontWeight: 700, border: "none",
                  backgroundColor: ACCENT_PURPLE, color: "#FFF",
                  opacity: !newStage.trim() ? 0.5 : 1,
                  cursor: !newStage.trim() ? "default" : "pointer",
                }}
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => { setAddingStage(false); setNewStage(""); }}
                disabled={saving}
                style={{
                  padding: 8, borderRadius: 9, border: "1px solid rgba(255,255,255,0.15)",
                  background: "transparent", color: "var(--rm-text-muted, #94A3B8)",
                  cursor: "pointer", display: "flex", alignItems: "center",
                }}
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingStage(true)}
              disabled={saving}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "10px 14px", borderRadius: 10,
                border: `1px dashed ${ACCENT_PURPLE}66`, backgroundColor: "transparent",
                color: ACCENT_PURPLE, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              }}
            >
              <Plus size={14} /> Add custom status
            </button>
          )}
          <div style={{ fontSize: 11, color: "var(--rm-text-muted, #94A3B8)", textAlign: "center", marginTop: 2 }}>
            {lockedBase
            ? "Schedule phases are fixed (they follow the schedule dates). Add your own statuses and drag those to arrange — changes apply to this record only."
            : "Drag to reorder or add custom statuses — changes apply to this record only."}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 16px 16px",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          display: "flex", gap: 8, justifyContent: "flex-end",
        }}>
          <button
            type="button"
            onClick={() => setOverrideOpen(false)}
            disabled={saving}
            style={{
              padding: "9px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600,
              border: "1px solid rgba(255,255,255,0.15)", background: "transparent",
              color: "var(--rm-text-muted, #94A3B8)", cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (!overrideStage || overrideStage === currentStage) return;
              void doSave(
                overrideStage,
                `Status set to ${overrideStage}`,
                `"${project.name || project.id}" is now "${overrideStage}".`,
              );
            }}
            disabled={saving || !overrideStage || overrideStage === currentStage}
            style={{
              padding: "9px 22px", borderRadius: 9, fontSize: 13, fontWeight: 700,
              border: "none", backgroundColor: ACCENT_PURPLE, color: "#FFF",
              opacity: saving || !overrideStage || overrideStage === currentStage ? 0.5 : 1,
              cursor: saving || !overrideStage || overrideStage === currentStage ? "default" : "pointer",
              transition: "opacity 0.15s",
            }}
          >
            {saving ? "Saving…" : "Set Status"}
          </button>
        </div>
        {saveError && (
          <div style={{
            padding: "10px 20px 14px",
            fontSize: 12, color: "#F87171",
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}>
            {saveError}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );

  /* ── Confirm strip for Lost / Cancel / Archive ── */
  if (confirming) {
    const isCustom = typeof confirming === "object";
    const customName = isCustom ? confirming.custom : "";
    const isLost = confirming === "lost";
    const isClose = confirming === "close";
    const isArchive = confirming === "archive";
    // Close-mode Cancel is a real cancellation (status "Cancelled") — a
    // project stopped early, distinct from the green Close Project
    // ("Closed" = finished). Convert mode keeps the long-standing behavior:
    // Cancel files the opp/lead as "Closed".
    const isCancelled = confirming === "cancel" && mode === "close";
    const label = isCustom ? customName : isLost ? "Lost" : isArchive ? "Archived" : isCancelled ? "Cancelled" : "Closed";
    const accent = isCustom ? (stageColors?.[customName.trim().toLowerCase()] || "#B91C1C")
      : isLost ? "#EF4444" : isClose ? "#22C55E" : isArchive ? "#8B5CF6" : "#9CA3AF";
    return (
      <div style={{ margin: "0 16px 12px", padding: "12px 16px", borderRadius: 12, border: `1px solid ${accent}40`, backgroundColor: `${accent}10`, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ flex: 1, fontSize: 13, color: "var(--rm-text)", fontWeight: 500 }}>
          {isClose ? (
            <>Close this {nounLabel}? It moves to <strong style={{ color: accent }}>Archive → Closed Records</strong>.</>
          ) : isCancelled ? (
            <>Cancel this {nounLabel}? It leaves the active list — find it under <strong style={{ color: accent }}>Archive → Closed Records</strong>.</>
          ) : isArchive ? (
            <>Move this {nounLabel} to the <strong style={{ color: accent }}>Archive</strong>? It will leave the active list — find it under Archive in the sidebar.</>
          ) : (
            <>Mark this {nounLabel} as <strong style={{ color: accent }}>{label}</strong>?</>
          )}
        </span>
        <button
          type="button"
          onClick={() => void doSave(
            label,
            isClose
              ? `${nounLabel.charAt(0).toUpperCase() + nounLabel.slice(1)} closed`
              : isArchive
                ? `${nounLabel.charAt(0).toUpperCase() + nounLabel.slice(1)} archived`
                : `${nounLabel.charAt(0).toUpperCase() + nounLabel.slice(1)} marked as ${label}`,
            isClose
              ? `"${project.name || project.id}" now lives under Archive → Closed Records.`
              : isArchive
                ? `"${project.name || project.id}" has been moved to the Archive.`
                : `"${project.name || project.id}" has been marked ${label}.`,
          ).then((ok) => { if (ok) setConfirming(null); })}
          disabled={saving}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "8px 14px", borderRadius: 9, border: "none",
            backgroundColor: accent, color: "#FFF", fontSize: 12, fontWeight: 700,
            opacity: saving ? 0.6 : 1, cursor: saving ? "default" : "pointer",
          }}>
          {saving ? "Saving…" : "Confirm"}
        </button>
        <button type="button" onClick={() => setConfirming(null)} disabled={saving}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "8px 14px", borderRadius: 9,
            backgroundColor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
            color: "var(--rm-text-muted)", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>
          Back
        </button>
      </div>
    );
  }

  return (
    <>
      {stageModal}
      <div style={{ margin: "0 16px 12px" }}>
        {/* ── Numbered workflow stepper — mirrors the Settings → Stage Rules
               "Workflow stages" preview so every record page shows WHERE the
               record sits in the company workflow at a glance. Read-only:
               the buttons below (Advance / Go Back / Override) do the moves.
               Terminal outcomes (Lost / Closed / Converted) aren't steps, so
               they render as a status note instead of a numbered bubble. ── */}
        {schedulePending ? (
          /* Schedule phases still loading (or retrying after a timeout): the
             status universe is UNKNOWN, so showing the tenant-wide status
             pile here would lie. Slim strip with just the current status
             until this record's own phases resolve. */
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", marginBottom: 10, borderRadius: 10,
            background: isLight ? "rgba(15,23,42,0.04)" : "rgba(255,255,255,0.04)",
            border: isLight ? "1px solid rgba(15,23,42,0.08)" : "1px solid rgba(255,255,255,0.08)",
          }}>
            {currentStage && (
              <span style={{
                fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                whiteSpace: "nowrap",
                background: isLight ? "#8B5CF6" : "rgba(139,92,246,0.18)",
                border: `1px solid ${isLight ? "#7C3AED" : "rgba(139,92,246,0.55)"}`,
                color: isLight ? "#FFFFFF" : "#E9D5FF",
              }}>{currentStage}</span>
            )}
            <span style={{ fontSize: 11.5, fontWeight: 500, color: isLight ? "rgba(15,23,42,0.45)" : "rgba(255,255,255,0.45)" }}>
              Syncing schedule phases…
            </span>
          </div>
        ) : navStages.length > 1 && (() => {
          // Collapse when the status universe is huge (projects can carry
          // dozens of observed statuses): by default show only the
          // configured-workflow prefix + the current stage, with a "+N more"
          // expander. Bubbles keep their ORIGINAL position numbers so the
          // collapsed view stays honest about where the record sits.
          const COLLAPSE_AT = 14;
          const collapsible = navStages.length > COLLAPSE_AT;
          let shownIdx = navStages.map((_, i) => i);
          if (collapsible && !showAllStages) {
            const orderSet = new Set((tenantStageOrder ?? []).map((s) => s.trim().toLowerCase()));
            // Workflow stages are PREPENDED to the option list, so the
            // configured workflow is the leading run of in-order matches.
            let core = 0;
            while (core < navStages.length && orderSet.has(navStages[core].trim().toLowerCase())) core++;
            if (core < 2) core = Math.min(10, navStages.length);
            const keep = new Set<number>();
            for (let k = 0; k < core; k++) keep.add(k);
            if (currentIdx >= 0) keep.add(currentIdx);
            shownIdx = shownIdx.filter((i) => keep.has(i));
          }
          const hiddenCount = navStages.length - shownIdx.length;
          return (
          <div style={{
            display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 8,
            padding: "10px 12px", marginBottom: 10, borderRadius: 10,
            background: isLight ? "rgba(15,23,42,0.04)" : "rgba(255,255,255,0.04)",
            border: isLight ? "1px solid rgba(15,23,42,0.08)" : "1px solid rgba(255,255,255,0.08)",
          }}>
            {shownIdx.map((i, pos) => {
              const s = navStages[i];
              const done = currentIdx >= 0 && i < currentIdx;
              const active = i === currentIdx;
              // A collapsed jump (hidden stages between this pill and the
              // previous one) renders as an ellipsis on the connector.
              const gap = pos > 0 && shownIdx[pos - 1] !== i - 1;
              // Admin-picked stage color (Workflow Stages configurator) —
              // falls back to the brand purple when none is set.
              const cc = stageColors?.[s.trim().toLowerCase()] ?? null;
              const accent = cc ?? "#8B5CF6";
              const accentDark = cc ?? "#7C3AED";
              return (
                // Stages distribute across the FULL bar width: every wrapper
                // after the first grows equally and its connector line absorbs
                // the growth, so the pills never cluster on the left half.
                // EXCEPT in the collapsed view — with only a handful of pills
                // plus the "+N more" toggle, stretching produces huge empty
                // connector runs, so collapsed pills stay compact on the left.
                <div key={s} style={{ display: "flex", alignItems: "center", flex: pos > 0 && !(collapsible && !showAllStages) ? "1 1 auto" : "0 0 auto", minWidth: 0 }}>
                  {pos > 0 && (
                    <div style={{
                      flex: 1, minWidth: 18, height: 2, margin: "0 4px",
                      background: done || active
                        ? (isLight ? accent : `${accent}B3`)
                        : (isLight ? "rgba(15,23,42,0.12)" : "rgba(255,255,255,0.12)"),
                    }} />
                  )}
                  {gap && (
                    <>
                      <span style={{
                        fontSize: 13, fontWeight: 700, flexShrink: 0, lineHeight: 1,
                        color: isLight ? "rgba(15,23,42,0.35)" : "rgba(255,255,255,0.35)",
                      }}>⋯</span>
                      <div style={{
                        flex: 1, minWidth: 18, height: 2, margin: "0 4px",
                        background: isLight ? "rgba(15,23,42,0.12)" : "rgba(255,255,255,0.12)",
                      }} />
                    </>
                  )}
                  <div title={active ? `Current stage: ${s}` : done ? `Completed: ${s}` : `Upcoming: ${s}`}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 9px 3px 4px", borderRadius: 999,
                      background: active ? (isLight ? accent : `${accent}2E`) : "transparent",
                      border: active ? `1px solid ${isLight ? accentDark : `${accent}8C`}` : "1px solid transparent",
                    }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700,
                      background: done ? (cc ?? "#10B981")
                        : active ? (isLight ? "#FFFFFF" : accent)
                        : (isLight ? "rgba(15,23,42,0.08)" : "rgba(255,255,255,0.10)"),
                      color: done ? "#FFFFFF"
                        : active ? (isLight ? accentDark : "#FFFFFF")
                        : (isLight ? "rgba(15,23,42,0.55)" : "rgba(255,255,255,0.55)"),
                    }}>
                      {done ? <Check size={12} /> : i + 1}
                    </span>
                    <span style={{
                      fontSize: 11.5, fontWeight: active ? 700 : 500, whiteSpace: "nowrap",
                      color: active ? (isLight ? "#FFFFFF" : "#E9D5FF")
                        : done ? (isLight ? "#0F172A" : "rgba(255,255,255,0.85)")
                        : (isLight ? "rgba(15,23,42,0.5)" : "rgba(255,255,255,0.5)"),
                    }}>{s}</span>
                    {/* Company skip rules hide this stage for records like
                         this one — it only shows because the record currently
                         sits here. Advance jumps straight past it. */}
                    {active && hiddenStages?.has(s.trim().toLowerCase()) && (
                      <span
                        title={`Your company's rules skip "${s}" for records like this one — it only shows because the record is currently here. Advance moves it straight to the next stage.`}
                        style={{
                          fontSize: 9, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
                          padding: "1px 6px", borderRadius: 999, flexShrink: 0, cursor: "help",
                          background: isLight ? "rgba(245,158,11,0.9)" : "rgba(245,158,11,0.25)",
                          color: isLight ? "#FFFFFF" : "#FCD34D",
                          border: isLight ? "none" : "1px solid rgba(245,158,11,0.45)",
                        }}>
                        skipped
                      </span>
                    )}
                  </div>
                  {/* Sub-statuses configured under this phase render as
                      nested chips right after their parent pill — the bar
                      mirrors the STATUS dropdown's indented list. */}
                  {lockedBase && subsOfStage(s).map((sub) => {
                    const subActive = curNorm === sub.trim().toLowerCase().replace(/\u2013/g, "-");
                    return (
                      <span key={`sub-${sub}`} title={`Sub-status of ${s}`}
                        style={{
                          marginLeft: 4, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap",
                          fontSize: 10, fontWeight: subActive ? 700 : 500, flexShrink: 0,
                          background: subActive
                            ? (isLight ? accent : `${accent}2E`)
                            : (isLight ? "rgba(15,23,42,0.05)" : "rgba(255,255,255,0.06)"),
                          border: subActive
                            ? `1px solid ${accent}`
                            : `1px dashed ${isLight ? "rgba(15,23,42,0.20)" : "rgba(255,255,255,0.20)"}`,
                          color: subActive
                            ? (isLight ? "#FFFFFF" : "#E9D5FF")
                            : (isLight ? "rgba(15,23,42,0.55)" : "rgba(255,255,255,0.55)"),
                        }}>{sub}</span>
                    );
                  })}
                </div>
              );
            })}
            {collapsible && (
              <button type="button"
                onClick={() => setShowAllStages((v) => !v)}
                title={showAllStages ? "Collapse back to the configured workflow" : `Show all ${navStages.length} statuses`}
                style={{
                  marginLeft: 6, padding: "3px 10px", borderRadius: 999, cursor: "pointer",
                  fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0,
                  border: isLight ? "1px dashed rgba(15,23,42,0.30)" : "1px dashed rgba(255,255,255,0.30)",
                  background: "transparent",
                  color: isLight ? "#475569" : "#CBD5E1",
                }}>
                {showAllStages ? "Show fewer" : `+${hiddenCount} more`}
              </button>
            )}
            {currentIdx === -1 && currentStage && (
              <span
                title={isLegacyStage
                  ? `"${currentStage}" comes from a previous workflow and isn't a step in your current workflow.${navStages.length > 0 ? ` Advance moves this record to "${navStages[0]}".` : ""}`
                  : undefined}
                style={{
                  marginLeft: "auto", fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                  display: "inline-flex", alignItems: "center", gap: 6,
                  cursor: isLegacyStage ? "help" : undefined,
                  background: isConverted ? "rgba(16,185,129,0.14)" : isLegacyStage ? "rgba(245,158,11,0.14)" : "rgba(239,68,68,0.12)",
                  border: isConverted ? "1px solid rgba(16,185,129,0.35)" : isLegacyStage ? "1px solid rgba(245,158,11,0.40)" : "1px solid rgba(239,68,68,0.35)",
                  color: isConverted ? "#10B981" : isLegacyStage ? "#D97706" : "#EF4444",
                }}>
                {isConverted ? (curNorm === "converted" ? "Converted" : "Won — converted") : currentStage}
                {isLegacyStage && (
                  <span style={{
                    fontSize: 9, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
                    padding: "1px 6px", borderRadius: 999, flexShrink: 0,
                    background: isLight ? "rgba(245,158,11,0.9)" : "rgba(245,158,11,0.25)",
                    color: isLight ? "#FFFFFF" : "#FCD34D",
                    border: isLight ? "none" : "1px solid rgba(245,158,11,0.45)",
                  }}>
                    legacy
                  </span>
                )}
              </span>
            )}
          </div>
          );
        })()}
        {/* ── Team tip (#137): admin-written guidance for this stage, set in
               Settings → Stage Rules ("Tip for your team"). Display-only —
               it never gates any action; the server enforces real rules. ── */}
        {guidanceTip && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            padding: "8px 12px", marginBottom: 10, borderRadius: 10,
            background: isLight ? "rgba(139,92,246,0.07)" : "rgba(139,92,246,0.12)",
            border: isLight ? "1px solid rgba(139,92,246,0.25)" : "1px solid rgba(139,92,246,0.35)",
          }}>
            <Lightbulb size={14} style={{ flexShrink: 0, marginTop: 2, color: isLight ? "#7C3AED" : "#C4B5FD" }} />
            <span style={{ fontSize: 12.5, lineHeight: 1.5, color: isLight ? "#4C1D95" : "#DDD6FE", fontWeight: 500 }}>
              {guidanceTip}
            </span>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>

          {/* ── Lost — opps/leads always; projects only when the tenant's
                 workflow list includes a "Lost" ending (Settings → Stage
                 Rules). Greyed out once already Lost. ── */}
          {(mode === "convert" || cfgHasLost) && actionCard(
            isLight ? "#FFFFFF" : "#F87171",
            isLight ? "#EF4444" : "rgba(220,38,38,0.12)",
            isLight ? "#DC2626" : "rgba(220,38,38,0.40)",
            () => setConfirming("lost"),
            currentStage.toLowerCase() === "lost",
            <><XCircle size={15} /><span>{buttonLabels?.lost || "Lost"}</span></>,
            `This ${nounLabel} is already marked as Lost`,
          )}

          {/* ── Cancel — every record type. Opps/leads: files the record as
                 Closed (long-standing behavior). Projects: marks it
                 Cancelled — stopped early, distinct from a finished Close.
                 Greyed out when already Closed/Cancelled. ── */}
          {actionCard(
            isLight ? "#FFFFFF" : "#9CA3AF",
            isLight ? "#6B7280" : "rgba(107,114,128,0.10)",
            isLight ? "#4B5563" : "rgba(107,114,128,0.35)",
            () => setConfirming("cancel"),
            mode === "close" ? isClosedish : ["closed","cancelled","cancel"].includes(currentStage.toLowerCase()),
            <><X size={15} /><span>{buttonLabels?.cancel || "Cancel"}</span></>,
            mode === "close"
              ? `This ${nounLabel} is already ${currentStage || "closed"} — use Override status to re-open it first`
              : `This ${nounLabel} is already Closed`,
          )}

          {/* ── Tenant-configured extra endings (e.g. "Declined") — any
                 recognized ending name in the workflow list beyond the
                 built-in buttons gets its own confirm-then-save button,
                 writing the configured stage name verbatim. ── */}
          {cfgExtraEndings.map((endStage) => {
            const ek = endStage.trim().toLowerCase();
            return (
              <Fragment key={`cfg-end-${ek}`}>
                {actionCard(
                  isLight ? "#FFFFFF" : "#FCA5A5",
                  isLight ? (stageColors?.[ek] || "#B91C1C") : "rgba(185,28,28,0.12)",
                  isLight ? (stageColors?.[ek] || "#991B1B") : "rgba(185,28,28,0.40)",
                  () => setConfirming({ custom: endStage }),
                  currentStage.trim().toLowerCase() === ek,
                  <><XCircle size={15} /><span>{endStage}</span></>,
                  `This ${nounLabel} is already marked as ${endStage}`,
                )}
              </Fragment>
            );
          })}

          {/* ── Archive — leads only, and only once the lead is terminally
                 dead (Lost or Closed). Files the lead under Archive in the
                 sidebar and removes it from the active Leads list. Other
                 statuses stay archiving-free: they can still advance and
                 eventually become opportunities / projects. ── */}
          {mode === "convert" && statusField === "LeadStatus"
            && ["lost", "closed", "cancelled", "declined"].includes(currentStage.trim().toLowerCase())
            && actionCard(
              isLight ? "#FFFFFF" : "#C4B5FD",
              isLight ? "#8B5CF6" : "rgba(139,92,246,0.12)",
              isLight ? "#7C3AED" : "rgba(139,92,246,0.40)",
              () => setConfirming("archive"),
              saving,
              <><Archive size={15} /><span>Archive</span></>,
            )}

          {/* ── Go Back one status — blocked once converted (industry norm:
                 the created project/opportunity is independent and would NOT
                 be removed, so regression past conversion is locked) ── */}
          {!schedulePending && (prevStage || isConverted) && actionCard(
            isLight ? "#FFFFFF" : "#93C5FD",
            isLight ? "#3B82F6" : "rgba(59,130,246,0.12)",
            isLight ? "#2563EB" : "rgba(59,130,246,0.40)",
            () => {
              if (prevStage && !isConverted) {
                void doSave(
                  prevStage,
                  `Moved back to ${prevStage}`,
                  `"${project.name || project.id}" is now "${prevStage}".`,
                );
              }
            },
            saving || isConverted || !prevStage,
            <>
              <ChevronsLeft size={15} />
              <span>{buttonLabels?.back || "Go Back"}</span>
              <span style={{ fontWeight: 400, fontSize: 10, color: isLight ? "rgba(255,255,255,0.9)" : "#BFDBFE" }}>
                {isConverted ? "converted — locked" : `← ${prevStage}`}
              </span>
            </>,
            isConverted
              ? `This ${nounLabel} has already been converted — the record it created stays either way, so it can't move backward.`
              : undefined,
          )}

          {/* ── Advance stage — amber (solid in light mode). Hidden once
                 converted, even if the sentinel status appears in the tenant's
                 stage list — a converted record must not move off the sentinel
                 or the grid's "converted" link breaks. ── */}
          {!schedulePending && nextStage && !isConverted && actionCard(
            isLight ? "#FFFFFF" : "#FBBF24",
            isLight ? "#F59E0B" : "rgba(251,191,36,0.12)",
            isLight ? "#D97706" : "rgba(251,191,36,0.40)",
            () => void doSave(
              nextStage,
              `Advanced to ${nextStage}`,
              `"${project.name || project.id}" is now "${nextStage}".`,
            ), saving,
            <>
              <ChevronsRight size={15} />
              <span>{buttonLabels?.advance || "Advance"}</span>
              <span style={{ fontWeight: 400, fontSize: 10, color: isLight ? "rgba(255,255,255,0.9)" : "#FCD34D" }}>→ {nextStage}</span>
            </>,
          )}

          {/* ── Terminal green button. Convert mode: Advance to Project /
                 Opportunity. Hidden once converted (a disabled full-size button
                 is confusing — a small note suffices). Close mode: Close
                 Project — confirm strip, then status → Closed. ── */}
          {mode === "close" ? actionCard(
            "#FFFFFF", Colors.green, Colors.green,
            () => { if (!isClosedish) setConfirming("close"); },
            isClosedish,
            <><ArrowRight size={15} /><span>{convertLabel}</span></>,
            `This ${nounLabel} is already closed — find it under Archive → Closed Records.`,
          ) : isConverted ? (
            <div style={{
              textAlign: "center", fontSize: 11, color: "#10B981",
              padding: "8px 12px", borderRadius: 8,
              background: "rgba(16,185,129,0.10)",
              border: "1px solid rgba(16,185,129,0.25)",
            }}>
              ✓ Already converted — find the linked project in the pipeline grid
            </div>
          ) : verifiedSame === "same" ? (
            // User confirmed this opp maps to the matched project — block
            // the advance. Show a clear reason and a link to the project.
            <div style={{
              textAlign: "center", fontSize: 11.5, color: "var(--rm-text-muted)",
              padding: "10px 14px", borderRadius: 8,
              background: "rgba(251,191,36,0.08)",
              border: "1px solid rgba(251,191,36,0.40)",
              lineHeight: 1.6,
            }}>
              🚫 Advance blocked — this opportunity was already converted by creating{" "}
              <button
                type="button"
                onClick={() => onNavigate(`/project/${encodeURIComponent(matchedPmm!.id)}`)}
                style={{
                  background: "none", border: "none", padding: 0,
                  color: "var(--rm-accent-blue)", fontWeight: 700,
                  cursor: "pointer", fontSize: "inherit", textDecoration: "underline",
                }}
              >{matchedPmm!.id}</button>
              {" "}directly (not through Advance to Project).{" "}
              <button
                type="button"
                onClick={() => { setVerifiedSame("different"); }}
                style={{
                  background: "none", border: "none", padding: 0,
                  color: "var(--rm-text-muted)", fontWeight: 500,
                  cursor: "pointer", fontSize: "inherit", textDecoration: "underline",
                }}
              >Undo — it's a different project</button>
            </div>
          ) : (() => {
            // Pending verification: a same-name project exists and the user
            // hasn't confirmed yet. Advance still works (it's their choice to
            // skip the notice) but the button is visually muted to encourage
            // the verification below.
            const pendingVerify = !!(matchedPmm && matchedPmm.diff.length === 0 && verifiedSame === null);
            return actionCard(
              "#FFFFFF", pendingVerify ? "#6B7280" : Colors.green, pendingVerify ? "#4B5563" : Colors.green,
              () => {
                writeConvertSeed(project.id, project.rawFields || {});
                onNavigate(convertPath(project.id));
              }, false,
              <><ArrowRight size={15} /><span>{convertLabel}{pendingVerify ? " (verify below first)" : ""}</span></>,
            );
          })()}
        </div>

        {/* ── PMM title-match notice — a project with the same name as this
               opportunity already exists and the opp hasn't been stamped
               "Closed – Won" yet.

               Three cases decided by the secondary-field comparison:

               1. diff.length > 0 (fields conflict) — likely a DIFFERENT job
                  sharing the name. Soft duplicate-title heads-up only; the
                  create path rejects dup titles so the user needs a slightly
                  different name when advancing.

               2. diff.length === 0, same.length > 0 (fields agree) — strong
                  match. User must verify before Advance is unblocked.
                  Reason shown: project was likely created directly, bypassing
                  Advance to Project.

               3. diff.length === 0, same.length === 0 (all blank, couldn't
                  compare) — uncertain. Same verify prompt, softer wording.

               The verify prompt shows Yes/No buttons. "Yes" sets verifiedSame
               → "same", which blocks the Advance button with a clear reason
               and a link to the matched project. "No" clears the notice. ── */}
        {mode === "convert" && statusField !== "LeadStatus" && !isConverted && matchedPmm?.id && verifiedSame !== "different" && (
          <div style={{
            margin: "8px 0 0",
            padding: "10px 14px",
            borderRadius: 10,
            border: matchedPmm.diff.length > 0
              ? "1px solid rgba(148,163,184,0.35)"
              : "1px solid rgba(251,191,36,0.40)",
            backgroundColor: matchedPmm.diff.length > 0
              ? "rgba(148,163,184,0.06)"
              : "rgba(251,191,36,0.08)",
            display: "flex", alignItems: "flex-start", gap: 8,
          }}>
            <AlertTriangle
              size={14}
              color={matchedPmm.diff.length > 0 ? "#94A3B8" : "#FBBF24"}
              style={{ flexShrink: 0, marginTop: 1 }}
            />
            <span style={{ fontSize: 12, color: "var(--rm-text-muted)", lineHeight: 1.6, flex: 1 }}>
              {matchedPmm.diff.length > 0 ? (
                // Case 1 — conflicting fields: different job, just a heads-up
                <>
                  A project named <strong style={{ color: "var(--rm-text)" }}>{project.name}</strong> already
                  exists (<button
                    type="button"
                    onClick={() => onNavigate(`/project/${encodeURIComponent(matchedPmm.id)}`)}
                    style={{
                      background: "none", border: "none", padding: 0,
                      color: "var(--rm-accent-blue)", fontWeight: 700,
                      cursor: "pointer", fontSize: "inherit", textDecoration: "underline",
                    }}
                  >{matchedPmm.id}</button>) but
                  with a different {matchedPmm.diff.join(", ")} — it looks like a separate
                  job. You can still advance, but you'll need a slightly different project title.
                </>
              ) : verifiedSame === "same" ? null : (
                // Cases 2 & 3 — agree or blank: show verify prompt
                <>
                  <strong style={{ color: "var(--rm-text)" }}>Please verify —</strong>{" "}
                  a project named <strong style={{ color: "var(--rm-text)" }}>{project.name}</strong> already
                  exists (<button
                    type="button"
                    onClick={() => onNavigate(`/project/${encodeURIComponent(matchedPmm.id)}`)}
                    style={{
                      background: "none", border: "none", padding: 0,
                      color: "var(--rm-accent-blue)", fontWeight: 700,
                      cursor: "pointer", fontSize: "inherit", textDecoration: "underline",
                    }}
                  >{matchedPmm.id}</button>)
                  {matchedPmm.same.length > 0
                    ? <> with the same {matchedPmm.same.join(", ")}</>
                    : <> but we couldn't compare other details</>
                  }.{" "}
                  We think this opportunity may have already been converted by creating that
                  project <em>directly</em>, bypassing the "Advance to Project" flow.
                  <br />
                  <span style={{ marginTop: 6, display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => setVerifiedSame("same")}
                      style={{
                        padding: "3px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 700,
                        cursor: "pointer",
                        background: "rgba(251,191,36,0.18)",
                        border: "1px solid rgba(251,191,36,0.55)",
                        color: "var(--rm-text)",
                      }}
                    >Yes, {matchedPmm.id} is the project from this opportunity</button>
                    <button
                      type="button"
                      onClick={() => setVerifiedSame("different")}
                      style={{
                        padding: "3px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 600,
                        cursor: "pointer",
                        background: "transparent",
                        border: "1px solid var(--rm-panel-border)",
                        color: "var(--rm-text-muted)",
                      }}
                    >No, it's a different project</button>
                  </span>
                </>
              )}
            </span>
          </div>
        )}

        {/* ── Override (admin only) ── */}
        {isAdmin && (
          <div style={{ textAlign: "center", marginTop: 6 }}>
            <button
              type="button"
              disabled={permLocked}
              title={permLocked ? (lockedNote ?? undefined) : undefined}
              onClick={() => { if (permLocked) return; setOverrideStage(""); setOverrideOpen(true); }}
              style={{
                background: "none", border: "none", color: ACCENT_PURPLE, fontSize: 13,
                cursor: permLocked ? "not-allowed" : "pointer", textDecoration: "underline", fontWeight: 600,
                opacity: permLocked ? 0.45 : 1,
              }}
            >
              Override status
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/* ──────────────── NoteField (inline editable textarea) ──────────────── */
function NoteField({ label, value, fieldName, canEdit, onSave, lockedNote = null }: {
  label: string;
  value: string;
  fieldName: string;
  canEdit?: boolean;
  onSave?: (fieldName: string, value: string) => Promise<void>;
  /** Stage-permission reason: when set (and canEdit is false) the field shows
   *  a lock hint with this tooltip instead of silently being read-only. */
  lockedNote?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  // Optimistic display: show the saved value immediately without waiting for
  // the parent's loadProject refresh cycle (which can take 1–3 s).
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const displayed = optimistic ?? value;

  if (!displayed && !canEdit) return null;

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: Colors.textPrimary,
        textTransform: "uppercase", letterSpacing: 1, marginBottom: 7,
      }}>{label}</div>

      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => { setDraft(e.target.value); if (saveErr) setSaveErr(""); }}
            rows={5}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "10px 14px", borderRadius: 10,
              border: `1.5px solid ${saveErr ? "#e53e3e" : ACCENT_BLUE}`,
              background: "var(--rm-panel-soft)",
              color: Colors.textPrimary, fontSize: 14, lineHeight: 1.65,
              resize: "vertical", outline: "none", fontFamily: "inherit",
            }}
            autoFocus
          />
          {saveErr && (
            <div style={{ color: "#e53e3e", fontSize: 12, marginTop: 4 }}>{saveErr}</div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button
              onClick={() => { setDraft(displayed); setEditing(false); setSaveErr(""); }}
              style={{
                padding: "6px 14px", borderRadius: 8,
                border: `1px solid ${Colors.border}`,
                background: "transparent", color: Colors.textSecondary,
                cursor: "pointer", fontSize: 13,
              }}
            >Cancel</button>
            <button
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                setSaveErr("");
                try {
                  await onSave?.(fieldName, draft);
                  // Show the new value immediately; the parent refresh will
                  // eventually push the same value via props and we clear.
                  setOptimistic(draft);
                  setEditing(false);
                } catch (e) {
                  setSaveErr(e instanceof Error ? e.message : "Could not save — please try again");
                } finally {
                  setSaving(false);
                }
              }}
              style={{
                padding: "6px 16px", borderRadius: 8, border: "none",
                background: ACCENT_BLUE, color: Colors.white,
                cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600,
                opacity: saving ? 0.7 : 1,
              }}
            >{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      ) : (
        <div
          onClick={canEdit ? () => { setDraft(displayed); setEditing(true); setSaveErr(""); } : undefined}
          title={canEdit ? `Click to edit ${label}` : (lockedNote ?? undefined)}
          style={{
            padding: "10px 14px", borderRadius: 10,
            border: `1px solid ${displayed ? Colors.border : Colors.border + "55"}`,
            background: "var(--rm-panel-soft)",
            cursor: canEdit ? "text" : lockedNote ? "not-allowed" : "default",
            minHeight: 46, position: "relative",
            transition: "border-color 0.15s",
          }}
        >
          {displayed ? (
            <div style={{
              color: Colors.textPrimary, fontSize: 14, fontWeight: 500,
              lineHeight: 1.65, whiteSpace: "pre-wrap",
            }}>{displayed}</div>
          ) : (
            <div style={{ color: Colors.textMuted, fontSize: 13, fontStyle: "italic" }}>
              Click to add {label.toLowerCase()}…
            </div>
          )}
          {canEdit && displayed && (
            <div style={{
              position: "absolute", bottom: 8, right: 10,
              color: ACCENT_BLUE, fontSize: 11, opacity: 0.7,
            }}>Edit</div>
          )}
          {!canEdit && lockedNote && (
            <div title={lockedNote} style={{
              position: "absolute", bottom: 8, right: 10,
              display: "inline-flex", alignItems: "center", gap: 4,
              color: Colors.textMuted, fontSize: 11, opacity: 0.8, cursor: "help",
            }}><LockIcon size={10} /> Locked</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ──────────────── Module-specific detail rows ──────────────── */
function ModuleSpecificDetails({ project, canEdit, lockedNote = null, stageLockNote, opmStageOptions = [], onSaveField, hiddenKeys,
  projectTypeOptions = PROJECT_TYPE_PRESETS, serviceTypeOptions = SERVICE_TYPE_PRESETS, requestCategoryOptions = REQUEST_CATEGORY_PRESETS }: {
  project: ProjectData;
  canEdit?: boolean;
  /** Stage-permission reason: when set (and canEdit is false) editable cells
   *  show a lock icon with this tooltip instead of hiding the edit pencil. */
  lockedNote?: string | null;
  /** Per-field stage-rule lock resolver (the page's lockNote helper) — lets
   *  "can't change in this stage" rules grey the EXACT cell they cover
   *  (parity with the Sector/BU cells) instead of only failing on save. */
  stageLockNote?: (...names: string[]) => string | undefined;
  opmStageOptions?: string[];
  onSaveField?: (fieldName: string, value: string) => Promise<void>;
  hiddenKeys?: Set<string>;
  // Merged preset ∪ live option lists (module-scoped) for the classification
  // dropdowns below — Project Type / Service Type / Project Category.
  projectTypeOptions?: string[];
  serviceTypeOptions?: string[];
  requestCategoryOptions?: string[];
}) {
  const raw = project.rawFields;
  // True when the user has hidden ANY of the raw-field keys backing a cell.
  const hid = (...ks: string[]) => ks.some((k) => hiddenKeys?.has(k) ?? false);
  // Cell lock note: per-field stage-rule/permission note when the page passed
  // the resolver (it already folds in the permissions blanket), else the
  // blanket note alone — never both, the per-field answer wins.
  const ln = (...names: string[]) => stageLockNote?.(...names) ?? lockedNote ?? undefined;
  const sv = (v: unknown): string => {
    if (v == null) return "";
    const s = String(v).trim();
    if (!s) return "";
    // Filter SQL Server sentinel / epoch dates (1900-01-01, 0001-01-01, etc.)
    if (/^\d{4}-\d{2}-\d{2}/.test(s) && parseInt(s.slice(0, 4), 10) < 2000) return "";
    return s;
  };

  if (project.module === "LEM") {
    const urgency = sv(raw.Urgency) || sv(raw.UrgencyChoice);
    const priority = sv(raw.LeadPriority) || sv(raw.Priority) || sv(raw.LeadPriorityChoice);
    const score = sv(raw.Score) || sv(raw.LeadScore);
    const projectType = sv(raw.ProjectType) || sv(raw.ProjectTypeChoice) || sv(raw.CRMProjectTypeChoice);
    const netRentable = sv(raw.NetRentableSqFt) || sv(raw.NetRentableSF) || sv(raw.SquareFeet) || sv(raw.SQFT);
    const contactLookup = sv(raw.ContactLookup) || sv(raw.CRMContactLookup) || sv(raw.Contact);
    const contactName = sv(raw.ContactName);
    const estStartDate = sv(raw.EstimatedStartDate) || sv(raw.EstStartDate);
    const createdOn = sv(raw.Created) || sv(raw.CreationDate);
    const requestCategory = sv(raw.RequestCategory);
    const office = sv(raw.Office);
    const address = sv(raw.StreetAddress1);
    const city = sv(raw.City);
    const stateVal = sv(raw.State);
    return (
      <>
        {(canEdit || requestCategory) && !hid("RequestCategory") && (
          <DetailCell label="Project Category" value={requestCategory || "—"} color={ACCENT_BLUE}
            editable={canEdit} lockedNote={lockedNote ?? undefined} editType="select"
            options={requestCategoryOptions}
            editValue={requestCategory}
            onSave={onSaveField ? (v) => onSaveField("RequestCategory", v) : undefined} />
        )}
        {urgency && !hid("Urgency", "UrgencyChoice") && <DetailCell label="Urgency" value={urgency} color={urgency.toLowerCase().includes("hot") ? "#F87171" : urgency.toLowerCase().includes("warm") ? Colors.orange : ACCENT_BLUE} />}
        {priority && !hid("LeadPriority", "Priority", "LeadPriorityChoice") && <DetailCell label="Lead Priority" value={priority} color={priority.toLowerCase() === "high" ? "#F87171" : priority.toLowerCase() === "medium" ? Colors.orange : undefined} />}
        {score && !hid("Score", "LeadScore") && <DetailCell label="Score" value={score} color={Colors.green} />}
        {(canEdit || projectType) && !hid("ProjectType", "ProjectTypeChoice", "CRMProjectTypeChoice") && (
          <DetailCell label="Project Type" value={projectType || "—"}
            editable={canEdit} lockedNote={lockedNote ?? undefined} editType="select" searchable
            options={projectTypeOptions}
            editValue={projectType}
            onSave={onSaveField ? (v) => onSaveField("ProjectType", v) : undefined} />
        )}
        {netRentable && !hid("NetRentableSqFt", "NetRentableSF", "SquareFeet", "SQFT") && <DetailCell label="Net Rentable Sq Ft" value={Number(netRentable).toLocaleString()} />}
        {(canEdit || contactLookup || contactName) && !hid("ContactLookup", "CRMContactLookup", "Contact", "ContactName") && (
          <DetailCell label="Key Client Contact" value={contactName || contactLookup || "—"}
            editable={canEdit} lockedNote={lockedNote ?? undefined} editType="text" editValue={contactName}
            onSave={onSaveField ? (v) => onSaveField("ContactName", v) : undefined} />
        )}
        {(canEdit || office) && !hid("Office") && (
          <DetailCell label="Office" value={office || "—"}
            editable={canEdit} lockedNote={lockedNote ?? undefined} editType="text" editValue={office}
            onSave={onSaveField ? (v) => onSaveField("Office", v) : undefined} />
        )}
        {(canEdit || address) && !hid("StreetAddress1") && (
          <DetailCell label="Address" value={address || "—"}
            editable={canEdit} lockedNote={lockedNote ?? undefined} editType="text" editValue={address}
            onSave={onSaveField ? (v) => onSaveField("StreetAddress1", v) : undefined} />
        )}
        {(canEdit || city) && !hid("City") && (
          <DetailCell label="City" value={city || "—"}
            editable={canEdit} lockedNote={lockedNote ?? undefined} editType="text" editValue={city}
            onSave={onSaveField ? (v) => onSaveField("City", v) : undefined} />
        )}
        {(canEdit || stateVal) && !hid("State") && (
          <DetailCell label="State" value={stateVal || "—"}
            editable={canEdit} lockedNote={lockedNote ?? undefined} editType="text" editValue={stateVal}
            onSave={onSaveField ? (v) => onSaveField("State", v) : undefined} />
        )}
        {estStartDate && !hid("EstimatedStartDate", "EstStartDate") && <DetailCell label="Est. Start Date" value={estStartDate.slice(0, 10)} />}
        {createdOn && !hid("Created", "CreationDate") && <DetailCell label="Created" value={createdOn.slice(0, 10)} />}
      </>
    );
  }

  if (project.module === "OPM") {
    const stage = sv(raw.CRMOpportunityStatusChoice) || sv(raw.Stage) || sv(raw.StageChoice);
    const projectType = sv(raw.ProjectType) || sv(raw.ProjectTypeChoice) || sv(raw.CRMProjectTypeChoice);
    const serviceType = sv(raw.ServiceType) || sv(raw.ServiceTypeChoice) || sv(raw.ServiceTypeText);
    const requestCategory = sv(raw.RequestCategory);
    const ownerName = sv(raw.OwnerName);
    const ownersRepOPM = sv(raw.OwnersRepresentative);
    const successChance = sv(raw.SuccessChance) || sv(raw.ChanceofSuccessChoice) || sv(raw.ChanceOfSuccessChoice);
    const cmicNumber = sv(raw.CMICProjectNumber) || sv(raw.CMICNumber) || sv(raw.CMIC);
    const createdOn = sv(raw.Created) || sv(raw.CreationDate);
    const erpJobId = sv(raw.ERPJobID);
    const erpJobIdNC = sv(raw.ERPJobIDNC);
    const studioChoice = sv(raw.StudioChoice);
    const projectId = sv(raw.ProjectId);
    const actProjCost = Number(raw.ActualProjectCost ?? 0) || 0;
    const actAcqCost = Number(raw.ActualAcquisitionCost ?? 0) || 0;
    const acqCost = Number(raw.AcquisitionCost ?? 0) || 0;
    const retailSqft = Number(raw.RetailSqftNum ?? 0) || 0;
    const contingency = sv(raw.Contingency);
    const fmtM = (n: number) => n >= 1_000_000_000 ? compactUsd(n) : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` : `$${n.toFixed(0)}`;
    return (
      <>
        {/* STAGE row removed — the stage now lives in the single STATUS
            dropdown on the main details card (saved to
            CRMOpportunityStatusChoice with opp-scoped options). */}
        {!hid("RequestCategory") && (
          <DetailCell label="Project Category" value={requestCategory || "—"} color={ACCENT_BLUE}
            editable={canEdit} lockedNote={ln("RequestCategory")} editType="select"
            options={requestCategoryOptions}
            editValue={requestCategory}
            onSave={onSaveField ? (v) => onSaveField("RequestCategory", v) : undefined} />
        )}
        {(canEdit || projectType) && !hid("ProjectType", "ProjectTypeChoice", "CRMProjectTypeChoice") && (
          <DetailCell label="Project Type" value={projectType || "—"}
            editable={canEdit} lockedNote={ln("ProjectType", "ProjectTypeChoice", "CRMProjectTypeChoice")} editType="select" searchable
            options={projectTypeOptions}
            editValue={projectType}
            onSave={onSaveField ? (v) => onSaveField("ProjectType", v) : undefined} />
        )}
        {(canEdit || serviceType) && !hid("ServiceType", "ServiceTypeChoice", "ServiceTypeText") && (
          <DetailCell label="Service Type" value={serviceType || "—"}
            editable={canEdit} lockedNote={ln("ServiceType", "ServiceTypeChoice", "ServiceTypeText")} editType="select" searchable
            options={serviceTypeOptions}
            editValue={serviceType}
            onSave={onSaveField ? (v) => onSaveField("ServiceType", v) : undefined} />
        )}
        {(canEdit || ownerName) && !hid("OwnerName") && (
          <DetailCell label="Key Client Contact" value={ownerName || "—"}
            editable={canEdit} lockedNote={ln("OwnerName")} editType="text" editValue={ownerName}
            onSave={onSaveField ? (v) => onSaveField("OwnerName", v) : undefined} />
        )}
        {(canEdit || ownersRepOPM) && !hid("OwnersRepresentative") && (
          <DetailCell label="Owner's Rep" value={ownersRepOPM || "—"}
            editable={canEdit} lockedNote={ln("OwnersRepresentative")} editType="text" editValue={ownersRepOPM}
            onSave={onSaveField ? (v) => onSaveField("OwnersRepresentative", v) : undefined} />
        )}
        {(canEdit || successChance) && !hid("SuccessChance", "ChanceofSuccessChoice", "ChanceOfSuccessChoice") && (
          <DetailCell label="Success Chance" value={successChance ? `${successChance}%` : "—"} color={ACCENT_PURPLE}
            editable={canEdit} lockedNote={ln("ChanceOfSuccessChoice", "SuccessChance")} editType="text" editValue={successChance}
            onSave={onSaveField ? (v) => onSaveField("ChanceOfSuccessChoice", v.replace(/%$/, "")) : undefined} />
        )}
        {cmicNumber && !hid("CMICProjectNumber", "CMICNumber", "CMIC") && <DetailCell label="CMIC #" value={cmicNumber} />}
        {/* Single consolidated "ERP Job ID" cell — the legacy ERPJobIDNC
            duplicate card was removed; NC value only used as a display
            fallback when ERPJobID itself is empty. Edits write ERPJobID. */}
        {(canEdit || erpJobId || erpJobIdNC) && !hid("ERPJobID", "ERPJobIDNC") && (
          <DetailCell label="ERP Job ID" value={erpJobId || erpJobIdNC || "—"}
            editable={canEdit} lockedNote={ln("ERPJobID")} editType="text" editValue={erpJobId || erpJobIdNC}
            onSave={onSaveField ? (v) => onSaveField("ERPJobID", v) : undefined} />
        )}
        {/* ProjectId renders as the dedicated FIRST cell of the Project Details card — omitted here to avoid duplication. */}
        {studioChoice && !hid("StudioChoice") && <DetailCell label="Studio" value={studioChoice} />}
        {actProjCost > 0 && !hid("ActualProjectCost") && <DetailCell label="Actual Project Cost" value={fmtM(actProjCost)} color="#E87722" />}
        {actAcqCost > 0 && !hid("ActualAcquisitionCost") && <DetailCell label="Actual Acquisition Cost" value={fmtM(actAcqCost)} color="#E87722" />}
        {acqCost > 0 && !hid("AcquisitionCost") && <DetailCell label="Acquisition Cost" value={fmtM(acqCost)} />}
        {retailSqft > 0 && !hid("RetailSqftNum") && <DetailCell label="Retail Sq Ft" value={retailSqft.toLocaleString()} />}
        {contingency && !hid("Contingency") && <DetailCell label="Contingency" value={contingency} />}
        {/* Actual Start / Actual Completion cells intentionally removed here —
            the shared date-field loop below ModuleSpecificDetails renders the
            Target-vs-Actual pair with the compulsory schedule gating, so
            rendering them here again duplicated the cells. */}
        {createdOn && !hid("Created", "CreationDate") && <DetailCell label="Created" value={createdOn.slice(0, 10)} />}
      </>
    );
  }

  // PMM
  const cmicEs = sv(raw.CMIC_ES_Number) || sv(raw.CMICESNumber);
  const cmicNumber = sv(raw.CMICProjectNumber) || sv(raw.CMICNumber) || sv(raw.CMIC);
  const projExec = sv(raw.ProjectExec) || sv(raw.ProjectExecutive) || sv(raw.ProjectExecutiveUser);
  const createdOn = sv(raw.Created) || sv(raw.CreationDate);
  const riskScore = Number(raw.RiskScore ?? 0) || 0;
  const projScore = Number(raw.ProjectScore ?? 0) || 0;
  // TotalCost: template column "Total Project Cost" writes to ProjectCost in DB,
  // but some upstream tenants store it as TotalCost — check both.
  const totalCost = Number(raw.TotalCost ?? raw.ProjectCost ?? 0) || 0;
  // EstProjectSpend / ApprovedRFEAmount are not in the import template —
  // only show them when the DB actually has a value (data-only, not editable-empty).
  const estSpend = Number(raw.EstProjectSpend ?? 0) || 0;
  const approvedRFEAmt = Number(raw.ApprovedRFEAmount ?? 0) || 0;
  const contingencyPMM = sv(raw.Contingency);
  const projectType = sv(raw.ProjectType) || sv(raw.ProjectTypeChoice) || sv(raw.CRMProjectTypeChoice);
  const serviceType = sv(raw.ServiceType) || sv(raw.ServiceTypeChoice) || sv(raw.ServiceTypeText);
  const requestCategoryPMM = sv(raw.RequestCategory);
  const ownerNamePMM = sv(raw.OwnerName);
  const ownersRepPMM = sv(raw.OwnersRepresentative);
  const fmtM = (n: number) => n >= 1_000_000_000 ? compactUsd(n) : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` : `$${n.toFixed(0)}`;
  const fmtVal = (s: string) => { const n = Number(s.replace(/[$,%]/g, "")); return !isNaN(n) && n > 0 ? (s.includes("%") ? s : fmtM(n)) : s; };
  return (
    <>
      {/* Request Category — workflow skip rules can key off it ("skip stage
          when Request Category = …"), so PMM records must surface it like
          OPM/LEM already do. Labelled "Request Category" to match the
          stage-rules editor wording (OPM/LEM historically say "Project
          Category" for the same column). */}
      {requestCategoryPMM && !hid("RequestCategory") && (
        <DetailCell label="Request Category" value={requestCategoryPMM} color={ACCENT_BLUE}
          editable={canEdit} lockedNote={ln("RequestCategory")} editType="select"
          options={requestCategoryOptions}
          editValue={requestCategoryPMM}
          onSave={onSaveField ? (v) => onSaveField("RequestCategory", v) : undefined} />
      )}
      {(canEdit || projectType) && !hid("ProjectType", "ProjectTypeChoice", "CRMProjectTypeChoice") && (
        <DetailCell label="Project Type" value={projectType || "—"}
          editable={canEdit} lockedNote={ln("ProjectType", "ProjectTypeChoice", "CRMProjectTypeChoice")} editType="select" searchable
          options={projectTypeOptions}
          editValue={projectType}
          onSave={onSaveField ? (v) => onSaveField("ProjectType", v) : undefined} />
      )}
      {(canEdit || serviceType) && !hid("ServiceType", "ServiceTypeChoice", "ServiceTypeText") && (
        <DetailCell label="Service Type" value={serviceType || "—"}
          editable={canEdit} lockedNote={ln("ServiceType", "ServiceTypeChoice", "ServiceTypeText")} editType="select" searchable
          options={serviceTypeOptions}
          editValue={serviceType}
          onSave={onSaveField ? (v) => onSaveField("ServiceType", v) : undefined} />
      )}
      {(canEdit || ownerNamePMM) && !hid("OwnerName") && (
        <DetailCell label="Client Contact" value={ownerNamePMM || "—"}
          editable={canEdit} lockedNote={ln("OwnerName")} editType="text" editValue={ownerNamePMM}
          onSave={onSaveField ? (v) => onSaveField("OwnerName", v) : undefined} />
      )}
      {(canEdit || ownersRepPMM) && !hid("OwnersRepresentative") && (
        <DetailCell label="Owner's Rep" value={ownersRepPMM || "—"}
          editable={canEdit} lockedNote={ln("OwnersRepresentative")} editType="text" editValue={ownersRepPMM}
          onSave={onSaveField ? (v) => onSaveField("OwnersRepresentative", v) : undefined} />
      )}
      {/* CMIC / exec fields are not in the import template — only show when populated */}
      {cmicEs && !hid("CMIC_ES_Number", "CMICESNumber") && (
        <DetailCell label="CMIC ES #" value={cmicEs}
          editable={canEdit} lockedNote={ln("CMICESNumber", "CMIC_ES_Number")} editType="text" editValue={cmicEs}
          onSave={onSaveField ? (v) => onSaveField("CMICESNumber", v) : undefined} />
      )}
      {cmicNumber && !hid("CMICProjectNumber", "CMICNumber", "CMIC") && (
        <DetailCell label="CMIC #" value={cmicNumber}
          editable={canEdit} lockedNote={ln("CMICProjectNumber", "CMICNumber")} editType="text" editValue={cmicNumber}
          onSave={onSaveField ? (v) => onSaveField("CMICProjectNumber", v) : undefined} />
      )}
      {projExec && !hid("ProjectExec", "ProjectExecutive", "ProjectExecutiveUser") && (
        <DetailCell label="Project Exec" value={projExec}
          editable={canEdit} lockedNote={ln("ProjectExecutiveUser", "ProjectExec", "ProjectExecutive")} editType="text" editValue={projExec}
          onSave={onSaveField ? (v) => onSaveField("ProjectExecutiveUser", v) : undefined} />
      )}
      {contingencyPMM && !hid("Contingency") && (
        <DetailCell label="Contingency" value={fmtVal(contingencyPMM)} color={ACCENT_BLUE}
          editable={canEdit} lockedNote={ln("Contingency")} editType="text" editValue={contingencyPMM}
          onSave={onSaveField ? (v) => onSaveField("Contingency", v) : undefined} />
      )}
      {riskScore > 0 && !hid("RiskScore") && <DetailCell label="Risk Score" value={String(riskScore)} color="#F87171" />}
      {projScore > 0 && !hid("ProjectScore") && <DetailCell label="Project Score" value={String(projScore)} color={ACCENT_PURPLE} />}
      {totalCost > 0 && !hid("TotalCost", "ProjectCost") && (
        <DetailCell label="Total Cost" value={fmtM(totalCost)} color="#E87722" />
      )}
      {estSpend > 0 && !hid("EstProjectSpend") && (
        <DetailCell label="Est. Project Spend" value={fmtM(estSpend)} />
      )}
      {approvedRFEAmt > 0 && !hid("ApprovedRFEAmount") && (
        <DetailCell label="Approved RFE Amount" value={fmtM(approvedRFEAmt)} color={ACCENT_BLUE} />
      )}
      {createdOn && !hid("Created", "CreationDate") && <DetailCell label="Created" value={createdOn.slice(0, 10)} />}
    </>
  );
}

/* ──────────────── AiQuickActions grid ──────────────── */
function AiQuickActions({ project, askAI }: { project: ProjectData; askAI: (p: string) => void }) {
  const rawD = project.rawFields || {};
  const sv = (v: unknown): string => {
    if (v == null) return "";
    const s = String(v).trim();
    if (!s || s === "null" || s === "false" || s === "undefined") return "";
    return s;
  };
  const projName = (project.name || "").trim();
  const contactName = sv(rawD.FullName) || sv(rawD.ContactName) || sv(rawD.DisplayName) || sv(rawD.Title) || (projName && projName !== project.id ? projName : "") || `Contact ${project.id}`;
  const jobTitle = sv(rawD.NameTitle) || sv(rawD.JobTitle) || sv(rawD.Title2) || sv(rawD.Position);
  const companyName = sv(rawD.CRMCompanyLookup) || sv(rawD.CompanyName) || sv(rawD.AccountName) || sv(rawD.Company) || project.company;
  const email = sv(rawD.EmailAddress) || sv(rawD.Email);

  const actions = project.module === "LEM" ? [
    { icon: FileText, label: "Lead\nSummary", gradient: GRADIENT_GREEN,
      prompt: `Give me a comprehensive summary of lead "${project.name}" (${project.id}). Include status, company, urgency, priority, estimated value, project type, and any related contacts or projects.` },
    { icon: Briefcase, label: "Company\nProfile", gradient: GRADIENT_BLUE,
      prompt: `Tell me about the company associated with lead "${project.name}" (${project.id}). What's our history with them? How many projects, opportunities, and leads do we have? What's the total relationship value?` },
    { icon: Target, label: "Conversion\nStrategy", gradient: GRADIENT_RED,
      prompt: `Analyze lead "${project.name}" (${project.id}) and suggest a conversion strategy. What's the urgency, priority, and value? Who should be the point of contact? What similar leads have we won before?` },
    { icon: Mail, label: "Draft\nOutreach", gradient: GRADIENT_ORANGE,
      prompt: `Draft an outreach email for lead "${project.name}" (${project.id}) via AgentMail. Look up the contact and company details, then ask me what angle to take before drafting.` },
  ] : project.module === "OPM" ? [
    { icon: FileText, label: "Opp.\nSummary", gradient: GRADIENT_GREEN,
      prompt: `Give me a comprehensive summary of opportunity "${project.name}" (${project.id}). Include stage, bid date, estimated value, win probability, company, and team assigned.` },
    { icon: UserPlus, label: "Find\nStaff", gradient: GRADIENT_BLUE,
      prompt: `Find available staff for opportunity "${project.name}" (${project.id}). Show best candidates from the bench with name, title, current allocation %, and why they're a good fit.` },
    { icon: Target, label: "Win\nStrategy", gradient: GRADIENT_RED,
      prompt: `Analyze opportunity "${project.name}" (${project.id}) and provide a win strategy. What's the competition like? What similar projects have we won? What's our win rate for this client and sector?` },
    { icon: AlertTriangle, label: "Risk\nAnalysis", gradient: GRADIENT_ORANGE,
      prompt: `Perform a risk analysis for opportunity "${project.name}" (${project.id}). Identify bid risks, staffing gaps, and competitive threats. Rate each risk as High/Medium/Low with mitigations.` },
  ] : project.module === "CON" ? [
    { icon: Layers, label: "Related\nProjects", gradient: GRADIENT_BLUE,
      prompt: `Use the RM ONE portfolio data to find every project (PMM), opportunity (OPM), and lead (LEM) where the CRMContactLookup, ContactID, or any contact reference equals "${project.id}"${companyName ? ` or where the company is "${companyName}"` : ""}. List each match with its ID, name, status, and value. If none are found, say so explicitly. Do not ask me for the contact's name — use the contact ID "${project.id}" directly.` },
    { icon: Mail, label: "Draft\nEmail", gradient: GRADIENT_GREEN,
      prompt: `Draft and send an email via AgentMail to ${contactName}${jobTitle ? ` (${jobTitle})` : ""}${companyName ? ` at ${companyName}` : ""} at ${email || "their email"}. Ask me what the email should be about before sending.` },
    { icon: Briefcase, label: "Company\nAnalysis", gradient: GRADIENT_ORANGE,
      prompt: `Analyze our relationship with ${companyName || `the company linked to contact ID "${project.id}"`}. Search RM ONE data for all PMM/OPM/LEM records tied to this company or contact ID. Report total project count, total value, active vs closed status, and growth opportunities. If no data exists, state that clearly.` },
    { icon: Search, label: "Enrich\nContact", gradient: GRADIENT_RED,
      prompt: `Research the contact record ${project.id} (${contactName}) and propose enriched details: likely full name, job title, company affiliation, and any public contact info. Cite sources.` },
  ] : [
    { icon: FileText, label: "Status\nReport", gradient: GRADIENT_GREEN,
      prompt: `Give me a comprehensive status report for project "${project.name}" (${project.id}). Include phase, timeline progress, budget, team composition, and key metrics. Format with clear sections.` },
    { icon: UserPlus, label: "Find\nStaff", gradient: GRADIENT_BLUE,
      prompt: `Find available staff for project "${project.name}" (${project.id}). Show best candidates from the bench with name, title, current allocation %, and why they're a good fit. Prioritize by relevance.` },
    { icon: AlertTriangle, label: "Risk\nReview", gradient: GRADIENT_RED,
      prompt: `Perform a risk analysis for project "${project.name}" (${project.id}). Identify staffing gaps, schedule risks, budget concerns, and missing data. Rate each risk as High/Medium/Low and suggest mitigations.` },
    { icon: Clock, label: "Timeline\nImpact", gradient: GRADIENT_ORANGE,
      prompt: `Analyze what happens if project "${project.name}" (${project.id}) is delayed by 2 months. Which team members are affected? What downstream impacts on other projects? Quantify the impact.` },
  ];

  return (
    <div style={{ margin: "0 16px 12px", padding: 16, backgroundColor: Colors.darkCard, borderRadius: 18, border: `1px solid ${Colors.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.green, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Sparkles size={14} color="#FFF" />
        </div>
        <span style={{ fontSize: 14, fontWeight: 700, color: Colors.white }}>AI Quick Actions</span>
      </div>
      <div style={{ fontSize: 11, color: Colors.textMuted, marginBottom: 12 }}>Tap to get instant AI-powered insights</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {actions.map((a, i) => (
          <AiActionCard key={i} index={i} icon={a.icon} label={a.label} gradient={a.gradient} onClick={() => askAI(a.prompt)} />
        ))}
      </div>
    </div>
  );
}

/* ──────────────── Helper Components ──────────────── */
function Chip({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      backgroundColor: "rgba(255,255,255,0.05)", padding: "4px 8px", borderRadius: 6,
    }}>
      <Icon size={10} color={Colors.textSecondary} />
      <span style={{ fontSize: 11, color: Colors.textSecondary }}>{children}</span>
    </div>
  );
}

function CountBadge({ n }: { n: number }) {
  // Hide entirely when the count is zero — collapsed section headers
  // were showing a "0" badge before the user expanded them, which read
  // as "this is empty" rather than "loading / not yet opened".
  if (!n || n <= 0) return null;
  return (
    <div style={{ padding: "3px 9px", borderRadius: 11, backgroundColor: "rgba(255,255,255,0.08)" }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: Colors.white }}>{n}</span>
    </div>
  );
}

/* Open-positions list for the Project Team card. Rendered from BOTH branches
   of the card — with a team AND when the team is empty ("No Team Assigned").
   The empty-team case matters: imported opportunities routinely carry unfilled
   demand rows (role + hours, no person), and hiding them behind the empty
   state made the Demand page and the project detail disagree (the "resolve"
   deep-link landed on a card showing nothing). */
function OpenRolesBlock({ roles, highlight, canEdit, hidePct, onAssign, lockedNote = null }: {
  roles: OpenRole[]; highlight: boolean; canEdit: boolean; hidePct: boolean;
  onAssign: (r: OpenRole) => void;
  /** Stage-permission reason: when set (and canEdit is false) the Assign
   *  button renders disabled with this tooltip instead of hidden. */
  lockedNote?: string | null;
}) {
  if (roles.length === 0) return null;
  return (
    <>
      {highlight && (
        <style>{`@keyframes rmOpenPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(232,119,34,0.55); } 50% { box-shadow: 0 0 0 7px rgba(232,119,34,0.10); } }`}</style>
      )}
      <div id="open-roles-block" style={{
        display: "flex", alignItems: "center", gap: 6, padding: "8px 12px",
        backgroundColor: "rgba(232,119,34,0.08)", borderRadius: 10, marginTop: 14, marginBottom: 8,
        scrollMarginTop: 90,
        ...(highlight ? { animation: "rmOpenPulse 1.5s ease-in-out infinite", border: "1px solid rgba(232,119,34,0.55)" } : {}),
      }}>
        <UserPlus size={13} color="#E87722" />
        <span style={{ fontSize: 11, color: "#E87722", fontWeight: 600 }}>
          {roles.length} open {roles.length === 1 ? "role" : "roles"} to fill
        </span>
      </div>
      {roles.map((or, i) => {
        // Parse the date-only slice at LOCAL midnight — a bare
        // "YYYY-MM-DD" parses as UTC and shifts a day in US timezones.
        const sd = or.startDate ? String(or.startDate).slice(0, 10) : "";
        const sdLocal = sd ? new Date(sd + "T00:00:00") : null;
        const todayLocal = new Date(new Date().toDateString());
        const overdue = !!sdLocal && sdLocal.getTime() < todayLocal.getTime();
        const sub = [
          or.bu,
          sdLocal ? `starts ${sdLocal.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : "",
          or.pct && !hidePct ? `${+or.pct.toFixed(2)}%` : "",
        ].filter(Boolean).join(" · ");
        return (
          <div key={i} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 14px", marginBottom: 4, borderRadius: 10,
            border: `1px solid ${highlight ? "rgba(232,119,34,0.60)" : Colors.border}`,
            backgroundColor: highlight ? "rgba(232,119,34,0.10)" : "rgba(232,119,34,0.04)",
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: Colors.textPrimary }}>
                {or.title || or.role}
              </div>
              {sub && (
                <div style={{ fontSize: 11, color: Colors.textMuted }}>
                  {sub}
                </div>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {overdue && (
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: "#F87171",
                  backgroundColor: "rgba(248,113,113,0.12)", padding: "3px 8px", borderRadius: 6,
                }}>OVERDUE</span>
              )}
              {(canEdit || lockedNote) && (
                <button
                  disabled={!canEdit}
                  title={!canEdit ? (lockedNote ?? undefined) : undefined}
                  onClick={() => { if (canEdit) onAssign(or); }} style={{
                  padding: "5px 14px", fontSize: 11, fontWeight: 600,
                  backgroundColor: Colors.green, color: "#FFF", border: "none",
                  borderRadius: 8, cursor: canEdit ? "pointer" : "not-allowed",
                  opacity: canEdit ? 1 : 0.45,
                }}>Assign</button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

function EmptyState({ icon: Icon, title, desc, actionLabel, onAction }: {
  icon: typeof UserX; title: string; desc: string; actionLabel?: string; onAction?: () => void;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", padding: 24, gap: 10,
      backgroundColor: "rgba(255,255,255,0.02)", borderRadius: 12,
    }}>
      <Icon size={28} color={Colors.textMuted} />
      <div style={{ fontSize: 14, fontWeight: 600, color: Colors.white }}>{title}</div>
      <div style={{ fontSize: 12, color: Colors.textMuted, textAlign: "center" }}>{desc}</div>
      {actionLabel && onAction && (
        <button onClick={onAction} style={{
          marginTop: 6, padding: "8px 16px", borderRadius: 10, backgroundColor: Colors.green,
          color: "#FFF", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <UserPlus size={13} /> {actionLabel}
        </button>
      )}
    </div>
  );
}

function backBtnStyle(): React.CSSProperties {
  return {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "var(--rm-panel-soft)",
    border: "1px solid var(--rm-panel-border)",
    color: "var(--rm-text)",
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer",
  };
}

/* ──────────────── COM (Company) View ──────────────── */
function CompanyView({ project, navigate, askAI, companyProjects, companyContacts, companyLoading, isExpanded, toggleSection }: {
  project: ProjectData; navigate: (p: string) => void; askAI: (p: string) => void;
  companyProjects: { id: string; name: string; module: string; status: string; value: number; city?: string; sector?: string }[];
  companyContacts: { id: string; name: string; title?: string; email?: string; phone?: string }[];
  companyLoading: boolean; isExpanded: (s: string) => boolean; toggleSection: (s: string, e?: React.MouseEvent) => void; mc: string;
}) {
  const rawD = project.rawFields;
  const sv = (v: unknown): string => (v != null && String(v) !== "null" ? String(v) : "");
  const companyType = sv(rawD.CRMCompanyTypeChoice) || sv(rawD.CompanyType) || sv(rawD.AccountType);
  const companyPhone = sv(rawD.PhoneNumber) || sv(rawD.Phone) || sv(rawD.OfficePhone);
  const companyEmail = sv(rawD.Email) || sv(rawD.EmailAddress);
  const companyAddr = [sv(rawD.Address), sv(rawD.City), sv(rawD.State), sv(rawD.ZipCode)].filter(Boolean).join(", ");
  const companyWebsite = sv(rawD.Website) || sv(rawD.WebAddress);
  const totalValue = companyProjects.reduce((s, p) => s + (p.value || 0), 0);

  const comStatusColor = (s: string) => {
    const sl = s.toLowerCase();
    if (sl.includes("progress") || sl.includes("construction") || sl.includes("active") || sl.includes("awarded")) return Colors.green;
    if (sl.includes("close")) return Colors.orange;
    if (sl.includes("precon") || sl.includes("design")) return "#FB923C";
    if (sl.includes("bid") || sl.includes("rom")) return ACCENT_BLUE;
    return Colors.textMuted;
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: Colors.dark, color: "#FFF" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", gap: 8, position: "sticky", top: 0, zIndex: 30, backgroundColor: Colors.dark }}>
        <button onClick={() => navigate(moduleListPath(project.module))} style={backBtnStyle()}><ArrowLeft size={20} /></button>
        <div style={{ flex: 1, fontSize: 15, fontWeight: 600, color: Colors.white, padding: "0 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</div>
      </div>

      <div style={{
        margin: "4px 16px 16px", padding: 20, backgroundColor: Colors.darkCard, borderRadius: 20,
        border: `1px solid ${Colors.border}`, position: "relative", overflow: "hidden", boxShadow: "0 12px 22px rgba(0,0,0,0.4)",
      }}>
        <HeroBg accent={ACCENT_PURPLE} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <div style={{ padding: "4px 10px", borderRadius: 8, backgroundColor: ACCENT_PURPLE + "20", border: `1px solid ${ACCENT_PURPLE}30` }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: ACCENT_PURPLE, letterSpacing: 0.8 }}>COM</span>
            </div>
            {companyType && (
              <div style={{ display: "flex", alignItems: "center", padding: "5px 10px", borderRadius: 20, gap: 6, backgroundColor: Colors.green + "18", border: `1px solid ${Colors.green}40` }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.green }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: Colors.green, textTransform: "uppercase", letterSpacing: 0.5 }}>{companyType}</span>
              </div>
            )}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: Colors.white, marginBottom: 4, lineHeight: 1.3 }}>{project.name}</div>
          <div style={{ fontSize: 12, color: Colors.textMuted, marginBottom: 14 }}>{project.id}</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {companyPhone && (
              <a href={`tel:${companyPhone}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: Colors.textSecondary, textDecoration: "none" }}>
                <Phone size={11} color={Colors.textSecondary} /><span style={{ fontSize: 11 }}>{companyPhone}</span>
              </a>
            )}
            {companyEmail && (
              <a href={`mailto:${companyEmail}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: Colors.green, textDecoration: "none" }}>
                <Mail size={11} color={Colors.green} /><span style={{ fontSize: 11 }}>{companyEmail}</span>
              </a>
            )}
            {companyAddr && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, color: Colors.textSecondary }}>
                <Home size={11} color={Colors.textSecondary} /><span style={{ fontSize: 11 }}>{companyAddr}</span>
              </div>
            )}
            {companyWebsite && (
              <a href={companyWebsite.startsWith("http") ? companyWebsite : `https://${companyWebsite}`} target="_blank" rel="noreferrer"
                 style={{ display: "inline-flex", alignItems: "center", gap: 5, color: Colors.green, textDecoration: "none" }}>
                <Globe size={11} color={Colors.green} /><span style={{ fontSize: 11 }}>{companyWebsite}</span>
              </a>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", margin: "0 16px 12px", gap: 8, flexWrap: "wrap" }}>
        <StatCard icon={Folder} iconColor={Colors.green} label="Total Projects" value={`${companyProjects.length}`} />
        <StatCard icon={DollarSign} iconColor={ACCENT_BLUE} label="Total Value" value={fmtM(totalValue)} />
        <StatCard icon={Users} iconColor={ACCENT_PURPLE} label="Contacts" value={`${companyContacts.length}`} />
      </div>

      <SectionCard icon={Folder} iconColor={Colors.green} title="Linked Projects"
        badge={<CountBadge n={companyProjects.length} />}
        expanded={isExpanded("overview")} onToggle={(e) => toggleSection("overview", e)}>
        {companyLoading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 24, gap: 8 }}>
            <Spinner color={Colors.green} /><span style={{ color: Colors.textMuted, fontSize: 12 }}>Loading projects…</span>
          </div>
        ) : companyProjects.length === 0 ? (
          <EmptyState icon={Folder} title="No Projects Found" desc="No projects linked to this company" />
        ) : (
          <>
            <div style={{ backgroundColor: Colors.green + "10", borderRadius: 10, padding: 10, marginBottom: 10, border: `1px solid ${Colors.green}20` }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: Colors.green }}>{companyProjects.length} projects · {fmtM(totalValue)} total value</span>
            </div>
            {companyProjects.map((p) => {
              const sc = comStatusColor(p.status);
              return (
                <button key={p.id} onClick={() => navigate(`/project/${p.id}`)} style={{
                  width: "100%", textAlign: "left", backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10,
                  padding: 12, marginBottom: 8, border: `1px solid ${Colors.green}25`, color: "inherit", cursor: "pointer",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, marginRight: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: Colors.white }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: Colors.textMuted, marginTop: 2 }}>{p.id} · {p.module}</div>
                    </div>
                    {p.value > 0 && <div style={{ fontSize: 13, fontWeight: 700, color: Colors.green }}>{fmtM(p.value)}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ backgroundColor: sc + "20", borderRadius: 6, padding: "3px 8px" }}>
                      <span style={{ fontSize: 10, fontWeight: 500, color: sc }}>{p.status || "—"}</span>
                    </div>
                    {p.city && <span style={{ fontSize: 10, color: Colors.textMuted }}>📍 {p.city}</span>}
                    {p.sector && p.sector !== "—" && <span style={{ fontSize: 10, color: Colors.textMuted }}>{p.sector}</span>}
                  </div>
                </button>
              );
            })}
          </>
        )}
      </SectionCard>

      <SectionCard icon={Users} iconColor={ACCENT_PURPLE} title="Contacts"
        badge={<CountBadge n={companyContacts.length} />}
        expanded={isExpanded("team")} onToggle={(e) => toggleSection("team", e)}>
        {companyLoading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 24, gap: 8 }}>
            <Spinner color={Colors.green} /><span style={{ color: Colors.textMuted, fontSize: 12 }}>Loading contacts…</span>
          </div>
        ) : companyContacts.length === 0 ? (
          <EmptyState icon={Users} title="No Contacts Found" desc="No contacts linked to this company" />
        ) : (
          companyContacts.map((ct) => (
            <div key={ct.id} style={{ backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 12, marginBottom: 8, border: `1px solid ${ACCENT_PURPLE}25` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: Colors.white }}>{ct.name}</div>
              {ct.title && ct.title !== "—" && <div style={{ fontSize: 11, color: Colors.textMuted, marginTop: 2 }}>{ct.title}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                {ct.email && (
                  <a href={`mailto:${ct.email}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: ACCENT_BLUE, textDecoration: "none" }}>
                    <Mail size={11} color={ACCENT_BLUE} /> {ct.email}
                  </a>
                )}
                {ct.phone && (
                  <a href={`tel:${ct.phone}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: Colors.green, textDecoration: "none" }}>
                    <Phone size={11} color={Colors.green} /> {ct.phone}
                  </a>
                )}
              </div>
            </div>
          ))
        )}
      </SectionCard>

      {/* AI Quick Actions hidden for companies (CMM) per client request */}
      <div style={{ height: 60 }} />
    </div>
  );
}

/* ──────────────── CON (Contact) View ──────────────── */
function ContactView({ project, navigate, askAI, isExpanded, toggleSection }: {
  project: ProjectData; navigate: (p: string) => void; askAI: (p: string) => void;
  isExpanded: (s: string) => boolean; toggleSection: (s: string, e?: React.MouseEvent) => void;
}) {
  const raw = project.rawFields;
  const sv = (v: unknown): string => (v != null && String(v) !== "null" ? String(v) : "");
  const contactName = sv(raw.RecordTitle) || sv(raw.Title) || sv(raw.FullName) || sv(raw.ContactName) || project.name;
  const jobTitle = sv(raw.Title) || sv(raw.JobTitle) || sv(raw.Position);
  const companyName = sv(raw.CompanyName) || sv(raw.Company);
  const contactType = sv(raw.CRMContactTypeChoice) || sv(raw.ContactType);
  const email = sv(raw.Email) || sv(raw.EmailAddress);
  const secondaryEmail = sv(raw.SecondaryEmail);
  const phone = sv(raw.PhoneNumber) || sv(raw.Phone) || sv(raw.OfficePhone);
  const mobile = sv(raw.Mobile) || sv(raw.CellPhone);
  const fullAddress = [sv(raw.Address), sv(raw.City), sv(raw.State), sv(raw.ZipCode)].filter(Boolean).join(", ");
  const initials = contactName.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");

  const infoRows: { icon: typeof Mail; label: string; value: string; action?: () => void }[] = [];
  if (email) infoRows.push({ icon: Mail, label: "Email", value: email, action: () => askAI(`Draft and send an email to ${contactName} at ${email}.`) });
  if (secondaryEmail) infoRows.push({ icon: Mail, label: "Secondary Email", value: secondaryEmail, action: () => askAI(`Draft and send an email to ${contactName} at ${secondaryEmail}.`) });
  if (phone) infoRows.push({ icon: Phone, label: "Phone", value: phone, action: () => window.open(`tel:${phone}`) });
  if (mobile) infoRows.push({ icon: Phone, label: "Mobile", value: mobile, action: () => window.open(`tel:${mobile}`) });

  return (
    <div style={{ minHeight: "100vh", backgroundColor: Colors.dark, color: "#FFF" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", gap: 8, position: "sticky", top: 0, zIndex: 30, backgroundColor: Colors.dark }}>
        <button onClick={() => navigate(moduleListPath(project.module))} style={backBtnStyle()}><ArrowLeft size={20} /></button>
        <div style={{ flex: 1, fontSize: 15, fontWeight: 600, color: Colors.white, padding: "0 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{contactName}</div>
      </div>

      <div style={{
        margin: "4px 16px 16px", padding: 20, backgroundColor: Colors.darkCard, borderRadius: 20,
        border: `1px solid ${Colors.border}`, position: "relative", overflow: "hidden", boxShadow: "0 12px 22px rgba(0,0,0,0.4)",
      }}>
        <HeroBg accent={ACCENT_TEAL} />
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: "100%", display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ padding: "4px 10px", borderRadius: 8, backgroundColor: ACCENT_TEAL + "20", border: `1px solid ${ACCENT_TEAL}30` }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: ACCENT_TEAL, letterSpacing: 0.8 }}>CON</span>
            </div>
            {contactType && (
              <div style={{ display: "flex", alignItems: "center", padding: "5px 10px", borderRadius: 20, gap: 6, backgroundColor: Colors.green + "18", border: `1px solid ${Colors.green}40` }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.green }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: Colors.green, textTransform: "uppercase", letterSpacing: 0.5 }}>{contactType}</span>
              </div>
            )}
          </div>

          <div style={{
            width: 72, height: 72, borderRadius: 36, backgroundColor: ACCENT_TEAL + "20",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: `2px solid ${ACCENT_TEAL}40`, marginBottom: 12,
          }}>
            {initials ? <span style={{ fontSize: 26, fontWeight: 700, color: ACCENT_TEAL }}>{initials}</span> : <User size={28} color={ACCENT_TEAL} />}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: Colors.white, textAlign: "center" }}>{contactName}</div>
          {jobTitle && <div style={{ fontSize: 14, color: Colors.textSecondary, marginTop: 4 }}>{jobTitle}</div>}
          {companyName && <div style={{ fontSize: 13, color: Colors.textMuted, marginTop: 2 }}>{companyName}</div>}
          <div style={{ fontSize: 12, color: Colors.textMuted, marginTop: 8 }}>{project.id}</div>
        </div>
      </div>

      {infoRows.length > 0 && (
        <SectionCard icon={Mail} iconColor={ACCENT_BLUE} title="Contact Information"
          expanded={isExpanded("overview")} onToggle={(e) => toggleSection("overview", e)}>
          {infoRows.map((row, i) => (
            <button key={i} onClick={row.action} style={{
              width: "100%", display: "flex", alignItems: "center", padding: "12px 0",
              borderBottom: i < infoRows.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
              background: "transparent", border: "none", color: "inherit", cursor: row.action ? "pointer" : "default", textAlign: "left",
            }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                <row.icon size={14} color={ACCENT_BLUE} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: Colors.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{row.label}</div>
                <div style={{ color: Colors.white, fontSize: 14, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" }}>{row.value}</div>
              </div>
              {row.action && <ExternalLink size={14} color="rgba(255,255,255,0.2)" />}
            </button>
          ))}
        </SectionCard>
      )}

      {(companyName || fullAddress) && (
        <SectionCard icon={Briefcase} iconColor={Colors.orange} title="Company Details"
          expanded={isExpanded("company-info")} onToggle={(e) => toggleSection("company-info", e)}>
          {companyName && (
            <div style={{ display: "flex", alignItems: "center", padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.orange + "15", display: "flex", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                <Home size={16} color={Colors.orange} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: Colors.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Company</div>
                <div style={{ color: Colors.white, fontSize: 16, fontWeight: 600, marginTop: 2 }}>{companyName}</div>
              </div>
            </div>
          )}
          {fullAddress && (
            <div style={{ display: "flex", alignItems: "flex-start", padding: "12px 0" }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                <MapPin size={14} color={Colors.orange} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: Colors.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Address</div>
                <div style={{ color: Colors.white, fontSize: 14, marginTop: 2 }}>{fullAddress}</div>
              </div>
            </div>
          )}
        </SectionCard>
      )}

      <AiQuickActions project={project} askAI={askAI} />
      <div style={{ height: 60 }} />
    </div>
  );
}

function ValueHistoryModal({ recordId, onClose }: { recordId: string; onClose: () => void }) {
  const [rows, setRows] = useState<FieldChangeItem[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(false);
  // Deliberately fetched fresh on every open (uncached) so a value saved
  // seconds ago already shows in the trail.
  useEffect(() => {
    let alive = true;
    void getRecordFieldHistory(recordId).then((r) => {
      if (!alive) return;
      if (!r) { setError(true); return; }
      setRows(r.rows ?? []);
      setTruncated(r.truncated === true);
    });
    return () => { alive = false; };
  }, [recordId]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return createPortal(
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: Z.DRAWER, background: "rgba(0,0,0,0.55)",
      backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(540px, 94vw)", maxHeight: "76vh", display: "flex", flexDirection: "column",
        background: Colors.darkCard, border: `1px solid ${Colors.border}`, borderRadius: 14,
        boxShadow: "0 24px 64px rgba(0,0,0,0.5)", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: `1px solid ${Colors.border}` }}>
          <Clock size={15} color={ACCENT_TEAL} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: Colors.textPrimary }}>Financial value history</div>
            <div style={{ fontSize: 10.5, color: Colors.textMuted, marginTop: 1 }}>{recordId} · who changed each value, and when</div>
          </div>
          <button onClick={onClose} title="Close" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, display: "inline-flex" }}>
            <X size={15} color={Colors.textMuted} />
          </button>
        </div>
        <div style={{ overflowY: "auto", padding: "4px 18px 10px" }}>
          {error ? (
            <div style={{ padding: "22px 0", fontSize: 12, color: Colors.textSecondary }}>
              Couldn't load the change history. Please try again.
            </div>
          ) : rows == null ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "22px 0", fontSize: 12, color: Colors.textMuted }}>
              <Loader2 size={13} className="rmone-spin" /> Loading history…
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: "22px 0", fontSize: 12, color: Colors.textSecondary, lineHeight: 1.55 }}>
              No value changes recorded yet.<br />
              <span style={{ color: Colors.textMuted }}>
                Edits to contract values, labor contract, forecasted project cost and
                non-operating cost are tracked from here on — including who made them and when.
              </span>
            </div>
          ) : (
            rows.map((r, idx) => {
              const who = r.changedBy
                ?? (r.source === "import" ? "File import" : r.source === "auto" ? "System (automatic)" : "Unknown user");
              const when = new Date(r.changedAt).toLocaleString(undefined, {
                month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
              });
              return (
                <div key={idx} style={{ padding: "10px 0", borderBottom: idx < rows.length - 1 ? `1px solid ${Colors.border}` : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.4 }}>
                      {FIELD_HISTORY_LABELS[r.fieldName] ?? r.fieldName}
                    </span>
                    {(r.source === "import" || r.source === "auto") && (
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: ACCENT_AMBER, border: "1px solid #FBBF2455", borderRadius: 999, padding: "1px 7px" }}>
                        {r.source === "import" ? "File import" : "Automatic"}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4, fontSize: 13 }}>
                    <span style={{ color: r.oldValue == null ? Colors.textMuted : Colors.textPrimary, fontStyle: r.oldValue == null ? "italic" : "normal" }}>
                      {fmtHistoryValue(r.oldValue)}
                    </span>
                    <ArrowRight size={12} color={Colors.textMuted} style={{ flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, color: Colors.greenLight, fontStyle: r.newValue == null ? "italic" : "normal" }}>
                      {fmtHistoryValue(r.newValue)}
                    </span>
                  </div>
                  <div style={{ marginTop: 3, fontSize: 10.5, color: Colors.textMuted }}>{who} · {when}</div>
                </div>
              );
            })
          )}
          {truncated && rows != null && rows.length > 0 && (
            <div style={{ padding: "8px 0 4px", fontSize: 10.5, color: Colors.textMuted }}>
              Showing the most recent {rows.length} changes.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function fmtHistoryValue(v: string | null): string {
  if (v == null || v === "") return "blank";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (Math.abs(n) >= 1_000_000_000) return compactUsd(n);
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

let projectDetailIntegrationObserver:
  | ((snapshot: ProjectDetailIntegrationSnapshot) => void)
  | null = null;

/** Browser-integration seam; normal application mounts never register one. */
export function observeProjectDetailIntegration(
  observer: ((snapshot: ProjectDetailIntegrationSnapshot) => void) | null,
): void {
  projectDetailIntegrationObserver = observer;
}
